// Thunderhead game client — map data: the Map Lab's baked map (map.json, instances.json, grid PNGs) as a terrain object
// that is a drop-in for units/sandbox/terrain.js makeTerrain() (W, H, height, surface, depth, slopeDeg, normal, los,
// rocks, features), plus the map's baked layers (nav bits, decks, surface classes, road mask) for the game.
//
// Axes: sim x east, y north, z up, metres; three.js position = (x, z, -y). Water surface at T.waterLevel (0 on all maps).
//
// Ported from maps/lab/lab.js:
//   decodeGridPNG      ← getGrid (416–424): lossless PNG rasters in data order (row 0 = south)
//   makeMapTerrain     ← loadMap (504–523: sizes, nav cell layout), hAt (388–394), cellOf/cellX (395–399), surfAt (400),
//                        surfZ (401–404), stampDisc/stampRect/densify (590–615), buildRasters (617–643)
//   terrain()          interpolates exactly like the Lab's rendered LOD0 terrain mesh (chunkGeo 687–725: each 4 m quad is
//                      split along its (i, j)–(i+1, j+1) diagonal), so units stand on the drawn ground. The Lab's bilinear
//                      hAt() is kept as terrainBilinear(); it differs from the drawn mesh by |h00 + h11 − h10 − h01| / 4
//                      inside non-planar quads (up to 2.5 m on Emerald's cliffs, 99th percentile 0.15 m).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** height.grid.png: RGB 24-bit fixed point, z = (R·65536 + G·256 + B) · 1e-4 − 40 (maps/lab/make_web_safe.py).
 *  map.json height_encoding (scale 0.002) describes the 16-bit height.png preview, not this grid. */
export const HEIGHT_PNG = { scale: 1e-4, offset: -40 };

/**
 * Fetch and decode one Map Lab grid PNG (as lab.js getGrid). kind 'height' → Float32Array (metres), else Uint8Array
 * (R channel). Returns { data, w, h }.
 */
export async function decodeGridPNG(url, kind = 'u8') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} (${url.split('/').pop()})`);
  // colour management off: the bytes are data, not colours
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const w = bmp.width, h = bmp.height;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0); bmp.close?.();
  const px = cx.getImageData(0, 0, w, h).data, n = w * h;
  if (kind === 'height') {
    const out = new Float32Array(n);
    for (let i = 0, k = 0; i < n; i++, k += 4) out[i] = (px[k] * 65536 + px[k + 1] * 256 + px[k + 2]) * HEIGHT_PNG.scale + HEIGHT_PNG.offset;
    return { data: out, w, h };
  }
  const out = new Uint8Array(n);
  for (let i = 0, k = 0; i < n; i++, k += 4) out[i] = px[k];
  return { data: out, w, h };
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} (${url.split('/').pop()})`);
  return r.json();
}

/**
 * Load a map folder (base = URL prefix ending in '/', e.g. 'maps/01/') and build the terrain object.
 * map.json and height.grid.png are required; surface / nav / deck grids and instances.json are optional (a note is
 * recorded in T.notes when one is missing or malformed, as the Lab does).
 */
export async function loadMapData(base) {
  const t0 = now();
  const notes = [];
  const opt = (p, what) => p.catch((e) => { notes.push(`${what} unavailable: ${e.message || e}`); return null; });
  const [meta, instances, hg, sg, ng, dg] = await Promise.all([
    fetchJSON(base + 'map.json'),
    opt(fetchJSON(base + 'instances.json'), 'instances.json'),
    decodeGridPNG(base + 'height.grid.png', 'height'),
    opt(decodeGridPNG(base + 'surface.grid.png'), 'surface.grid.png'),
    opt(decodeGridPNG(base + 'nav.grid.png'), 'nav.grid.png'),
    opt(decodeGridPNG(base + 'deck.grid.png'), 'deck.grid.png'),
  ]);
  const T = makeMapTerrain({ meta, height: hg.data, surface: sg && sg.data, nav: ng && ng.data, deck: dg && dg.data, instances: instances || {}, notes });
  T.base = base;
  T.loadMs = now() - t0;
  return T;
}

/**
 * Build the terrain object from decoded grids (no I/O, so it also runs in Node with the raw .f32/.u8 files).
 *   meta: parsed map.json; height: Float32Array grid_n² (row 0 = south); surface: Uint8Array grid_n² surface classes;
 *   nav: Uint8Array nn² nav bits; deck: Uint8Array nn² deck flags; instances: parsed instances.json.
 */
export function makeMapTerrain({ meta, height: Hg, surface = null, nav = null, deck = null, instances = {}, notes = [] }) {
  const n = meta.grid_n, g = meta.grid_m, S = meta.size_m;
  const wl = meta.water_level ?? 0;
  if (!Hg || Hg.length !== n * n) throw new Error(`height grid has ${Hg ? Hg.length : 0} values, expected grid_n² = ${n * n}`);
  let navBits = nav, deckBits = deck;
  // nav / deck are (grid_n − 1)² cells: each is the AND (deck: max) of 2×2 samples of the 2 m source grid at x ∈ {4i, 4i+2} m,
  // so cell i covers [4i − 1, 4i + 3) m → offset g/4. A full-resolution grid_n² raster would sit on vertices (offset g/2).
  const nn = navBits ? Math.round(Math.sqrt(navBits.length)) : n - 1;
  if (navBits && nn * nn !== navBits.length) { notes.push(`nav grid is not square (${navBits.length} cells): nav disabled`); navBits = null; }
  if (deckBits && deckBits.length !== nn * nn) { notes.push(`deck grid has ${deckBits.length} cells, nav grid is ${nn}²: deck ignored`); deckBits = null; }
  const navOff = nn === n - 1 ? g / 4 : g / 2;
  const surfaceClass = surface && surface.length === n * n ? surface : null;
  if (surface && !surfaceClass) notes.push('surface grid size does not match grid_n²: surface classes unavailable');
  let hmin = Infinity, hmax = -Infinity;
  for (let k = 0; k < Hg.length; k++) { const v = Hg[k]; if (v < hmin) hmin = v; if (v > hmax) hmax = v; }

  // ── grid helpers (lab.js 388–400) ──
  const cellOf = (x, y) => {
    const i = clamp(Math.floor((x + navOff) / g), 0, nn - 1), j = clamp(Math.floor((y + navOff) / g), 0, nn - 1);
    return j * nn + i;
  };
  const cellX = (i) => i * g - navOff + g / 2;   // centre of nav cell column/row i, metres
  const surfAt = (x, y) => { const i = clamp(Math.round(x / g), 0, n - 1), j = clamp(Math.round(y / g), 0, n - 1); return surfaceClass ? surfaceClass[j * n + i] : null; };

  // terrain exactly as the LOD0 mesh draws it: two triangles per quad, diagonal (i, j)–(i+1, j+1)
  function terrain(x, y) {
    const fx = clamp(x / g, 0, n - 1), fy = clamp(y / g, 0, n - 1);
    const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fy), n - 2);
    const u = fx - i, v = fy - j, k = j * n + i;
    const h00 = Hg[k], h11 = Hg[k + n + 1];
    if (u >= v) { const h10 = Hg[k + 1]; return h00 + (h10 - h00) * u + (h11 - h10) * v; }
    const h01 = Hg[k + n]; return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  // the Lab's hAt(): bilinear (used by the Lab for picking, drapes and the minimap)
  function terrainBilinear(x, y) {
    const fx = clamp(x / g, 0, n - 1), fy = clamp(y / g, 0, n - 1);
    const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fy), n - 2);
    const u = fx - i, v = fy - j, k = j * n + i;
    return (Hg[k] * (1 - u) + Hg[k + 1] * u) * (1 - v) + (Hg[k + n] * (1 - u) + Hg[k + n + 1] * u) * v;
  }

  // ── rasters (lab.js buildRasters 617–643): road-speed mask and deck heights on the nav cells ──
  const roadMask = new Uint8Array(nn * nn);
  const deckZ = new Float32Array(nn * nn).fill(NaN);
  const deckD2 = new Float32Array(nn * nn).fill(Infinity);   // squared distance of the source point that set deckZ (−1 = dock, fixed)
  function stampDisc(x, y, r, fn) {
    const i0 = clamp(Math.floor((x - r + navOff) / g), 0, nn - 1), i1 = clamp(Math.floor((x + r + navOff) / g), 0, nn - 1);
    const j0 = clamp(Math.floor((y - r + navOff) / g), 0, nn - 1), j1 = clamp(Math.floor((y + r + navOff) / g), 0, nn - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d2 = (cellX(i) - x) ** 2 + (cellX(j) - y) ** 2;
      if (d2 <= r * r) fn(j * nn + i, d2);
    }
  }
  function stampRect(c, size, rot, fn) {
    const r = Math.hypot(size[0], size[1]) / 2, cs = Math.cos(rot), sn = Math.sin(rot);
    stampDisc(c[0], c[1], r, (k) => {
      const dx = cellX(k % nn) - c[0], dy = cellX((k / nn) | 0) - c[1];
      const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      if (Math.abs(lx) <= size[0] / 2 && Math.abs(ly) <= size[1] / 2) fn(k);
    });
  }
  // Deck cells are the Lab's (within clear_w/2 + 3 m of a bridge-flagged road point, docks, trestles), but the height of a
  // cell is the z of the NEAREST point of the drawn deck line — for bridges any point of the same road, ramps included —
  // instead of the Lab's max within the stamp radius. The Lab's rule sits up to 0.5 m above the drawn trestle decks and
  // leaves a 0.6 m step where a bridge ramp enters the deck cells (Delta Grid); this one follows the drawn ribbon.
  // Docks are flat at deck_z and fixed.
  const nearestDeck = (z) => (c, d2) => { if (d2 < deckD2[c]) { deckD2[c] = d2; deckZ[c] = z; } };
  const cand = new Uint8Array(nn * nn);   // this road's deck cells
  for (const r of meta.roads || []) {
    const { P, Z } = densify(r.xy, r.z, 3);
    const onBeach = r.on_beach || [], bridge = r.bridge || [];
    const srcOf = [];   // densified point → nearest source vertex (for the per-vertex beach / bridge flags), as the Lab
    let src = 0, anyBridge = false;
    for (let k = 0; k < P.length; k++) {
      while (src < r.xy.length - 1 && Math.hypot(r.xy[src + 1][0] - P[k][0], r.xy[src + 1][1] - P[k][1]) < Math.hypot(r.xy[src][0] - P[k][0], r.xy[src][1] - P[k][1])) src++;
      srcOf.push(src);
      if (onBeach[src]) continue;
      stampDisc(P[k][0], P[k][1], r.clear_w / 2, (c) => { roadMask[c] = 1; });
      if (bridge[src]) { anyBridge = true; stampDisc(P[k][0], P[k][1], r.clear_w / 2 + 3, (c) => { cand[c] = 1; }); }
    }
    if (!anyBridge) continue;
    for (let k = 0; k < P.length; k++) if (!onBeach[srcOf[k]]) {
      const set = nearestDeck(Z[k]);
      stampDisc(P[k][0], P[k][1], r.clear_w / 2 + 3, (c, d2) => { if (cand[c]) set(c, d2); });
    }
    cand.fill(0);
  }
  for (const d of meta.docks || []) stampRect(d.water_center, [80, 40], d.rot, (c) => { deckZ[c] = d.deck_z ?? 3; deckD2[c] = -1; });
  for (const ln of meta.lanes || []) {
    if (ln.kind !== 'trestle') continue;
    const zs = Array.isArray(ln.z) ? ln.z : ln.pts.map(() => ln.z);
    const { P, Z } = densify(ln.pts, zs, 2);
    P.forEach((p, k) => stampDisc(p[0], p[1], ln.w / 2 + 1, nearestDeck(Z[k])));
  }
  if (deckBits) for (let c = 0; c < nn * nn; c++) if (deckBits[c]) roadMask[c] = 1;
  if (surfaceClass) for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) if (surfAt(cellX(i), cellX(j)) === 7) roadMask[j * nn + i] = 1;
  // a cell is walkable deck where the baked deck flag is set and a deck height is known (lab.js surfZ)
  const deckMask = new Uint8Array(nn * nn);
  let deckCells = 0;
  if (deckBits) for (let c = 0; c < nn * nn; c++) if (deckBits[c] && !Number.isNaN(deckZ[c])) { deckMask[c] = 1; deckCells++; }

  // Deck height at a point, or null: bilinear over the surrounding deck-cell centres (non-deck neighbours drop out and the
  // weights are renormalised), so units roll smoothly along ramped decks instead of stepping 4 m cell by 4 m cell.
  function deckAt(x, y) {
    if (!deckCells) return null;
    if (!deckMask[cellOf(x, y)]) return null;
    const fx = (x + navOff) / g - 0.5, fy = (y + navOff) / g - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0;
    let s = 0, w = 0;
    const add = (i, j, wt) => { if (wt <= 0 || i < 0 || j < 0 || i >= nn || j >= nn) return; const c = j * nn + i; if (deckMask[c]) { s += deckZ[c] * wt; w += wt; } };
    add(i0, j0, (1 - u) * (1 - v)); add(i0 + 1, j0, u * (1 - v)); add(i0, j0 + 1, (1 - u) * v); add(i0 + 1, j0 + 1, u * v);
    return w > 0 ? s / w : deckZ[cellOf(x, y)];
  }

  const T = {
    // ── makeTerrain() interface ──
    W: S, H: S, res: g, nx: n, ny: n, h: Hg, rocks: [], features: {},
    /** ground a land unit stands on: the deck where one is (never below the drawn terrain), else terrain; negative under water */
    height(x, y) {
      const t = terrain(x, y);
      if (deckCells) { const d = deckAt(x, y); if (d !== null && d > t) return d; }
      return t;
    },
    /** ground or water surface: the water level wherever the terrain is under water (also under bridges and docks, so
     *  ships and hovercraft never ride up onto a deck), else height() */
    surface(x, y) {
      const t = terrain(x, y);
      if (t <= wl) return wl;
      if (deckCells) { const d = deckAt(x, y); if (d !== null && d > t) return d; }
      return t;
    },
    /** water depth below the water level (terrain, not decks) */
    depth(x, y) { return Math.max(0, wl - terrain(x, y)); },
    slopeDeg(x, y) { const e = 1.0; const dx = (T.height(x + e, y) - T.height(x - e, y)) / (2 * e), dy = (T.height(x, y + e) - T.height(x, y - e)) / (2 * e); return Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI; },
    /** unit normal [nx, ny, nz] in sim axes (central differences over ±e metres of height()) */
    normal(x, y, e = 1.0) { const dx = (T.height(x + e, y) - T.height(x - e, y)) / (2 * e), dy = (T.height(x, y + e) - T.height(x, y - e)) / (2 * e); const l = Math.hypot(dx, dy, 1); return [-dx / l, -dy / l, 1 / l]; },
    /** terrain line of sight: true if the segment a→b (3D) stays above height() (water doesn't block; decks do) */
    los(ax, ay, az, bx, by, bz, step = 2) {
      const d = Math.hypot(bx - ax, by - ay); const k1 = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k < k1; k++) { const t = k / k1; if (T.height(ax + (bx - ax) * t, ay + (by - ay) * t) > az + (bz - az) * t) return false; }
      return true;
    },

    // ── map extras ──
    meta, id: meta.id, name: meta.name, S, g, n, nn, navOff, waterLevel: wl, hmin, hmax, notes,
    instances, navBits, deckBits, deckMask, deckZ, deckCells, surfaceClass, roadMask,
    /** raw terrain (no decks), as the LOD0 mesh draws it */
    terrain,
    /** the Lab's bilinear hAt() */
    terrainBilinear,
    deckAt,
    /** nav / deck cell index of a point (0 … nn²−1) */
    cellOf,
    /** centre of a nav / deck cell → [x, y] */
    cellCenter(c) { return [cellX(c % nn), cellX((c / nn) | 0)]; },
    /** surface class at a point (nearest grid vertex; 255 = water), or null without the surface grid */
    surfaceAt: surfAt,
    /** nav bits at a point (255 when the nav grid is missing) */
    navAt(x, y) { return navBits ? navBits[cellOf(x, y)] : 255; },
    /** can movement class cls ('infantry' | 'tank' | 'harvester' | 'amphibious' | 'ship') occupy (x, y)? */
    passable(cls, x, y) { const b = (meta.nav_bits || {})[cls]; return b ? (T.navAt(x, y) & b) !== 0 : false; },
    isRoad(x, y) { return roadMask[cellOf(x, y)] === 1; },
  };
  return T;
}

// polyline (+ optional z) resampled every ≤ step metres (lab.js densify 607–615)
export function densify(pts, zs, step) {
  const P = [], Z = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L / step));
    for (let t = 0; t < m; t++) { const u = t / m; P.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); if (zs) Z.push(zs[k] + (zs[k + 1] - zs[k]) * u); }
  }
  P.push(pts[pts.length - 1]); if (zs) Z.push(zs[zs.length - 1]);
  return { P, Z };
}
