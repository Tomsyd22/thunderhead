/* Thunderhead map generator + civilian/tech structures. Global out: MAPGEN, CIV. */
const CIV = [
  { id: 'civ_house', faction: 'civ', cls: 'structure', name: 'Townhouse', role: 'Civilian building', cost: 0, hp: 450, armour: 'wood', power: 0, tier: 0, prereq: [], garrison: 4, foot: [2, 2], desc: 'Two-storey brick house. Holds 4 infantry.' },
  { id: 'civ_shop', faction: 'civ', cls: 'structure', name: 'Corner Shop', role: 'Civilian building', cost: 0, hp: 550, armour: 'wood', power: 0, tier: 0, prereq: [], garrison: 5, foot: [2, 2], desc: 'Shopfront with a flat above. Holds 5 infantry.' },
  { id: 'civ_tower', faction: 'civ', cls: 'structure', name: 'Office Tower', role: 'Civilian building', cost: 0, hp: 900, armour: 'concrete', power: 0, tier: 0, prereq: [], garrison: 8, foot: [2, 3], desc: 'Concrete office block. Holds 8 infantry and takes a beating.' },
  { id: 'civ_warehouse', faction: 'civ', cls: 'structure', name: 'Warehouse', role: 'Civilian building', cost: 0, hp: 700, armour: 'steel', power: 0, tier: 0, prereq: [], garrison: 6, foot: [3, 2], desc: 'Steel-framed warehouse. Holds 6 infantry.' },
  { id: 'civ_derrick', faction: 'civ', cls: 'structure', name: 'Oil Derrick', role: 'Tech structure', cost: 0, hp: 600, armour: 'steel', power: 0, tier: 0, prereq: [], foot: [2, 2], tech: true, desc: 'Capture with an engineer: $1,000 at once, then $25 every 5 s.' },
];
const MAPGEN = (() => {
  const T = { GRASS: 0, ROCK: 1, SCRUB: 2, WATER: 3, BRIDGE: 4, CLIFF: 5, ROAD: 6, SHORE: 7 };
  /* Six presets built from shared pieces. Symmetry: 'point' (2 players, 180° rotation) or 'quad' (4 players, mirrored in x and y).
     Every preset returns { civ: [[id,x,y]...], starts: [{x,y}...], theme, name, players }. */
  const PRESETS = {
    riverlands: { name: 'Riverlands', players: 2, theme: 'grass', desc: 'A meandering river with three bridges, a town at the centre crossing, cliff plateaus with ramps, two derricks a side.' },
    island:     { name: 'Archipelago', players: 2, theme: 'grass', desc: 'Two home islands linked to a rich central island by narrow causeways. Navies decide it.' },
    urban:      { name: 'Grid City', players: 2, theme: 'urban', desc: 'A dense city block of garrisonable buildings and road grid between the bases. Infantry heaven.' },
    desert:     { name: 'Tantalum Flats', players: 2, theme: 'desert', desc: 'Open sand with rock outcrops, sparse ore but rich cobalt veins at the centre. Fast, armour-heavy.' },
    crossfire:  { name: 'Crossfire (2v2)', players: 4, theme: 'grass', desc: 'Two allied bases on each side of a river valley, shared centre town. Team game.' },
    quadrant:   { name: 'Quadrant (FFA)', players: 4, theme: 'desert', desc: 'Four corner bases, cliffs between them, every road leads to the central cobalt field. Free-for-all.' },
  };
  function generate(G, seed, MAPW, MAPH, idx, inMap, preset = 'riverlands') {
    const P = PRESETS[preset] || PRESETS.riverlands; const quad = P.players === 4 && preset === 'quadrant'; const sym = P.players === 4 ? 'quad' : 'point';
    let s = (seed >>> 0) + 1; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const mirrors = (x, y) => sym === 'quad' ? [[x, y], [MAPW - 1 - x, y], [x, MAPH - 1 - y], [MAPW - 1 - x, MAPH - 1 - y]] : [[x, y], [MAPW - 1 - x, MAPH - 1 - y]];
    const set = (x, y, v, only) => { for (const [xx, yy] of mirrors(x, y)) if (inMap(xx, yy) && (!only || G.terrain[idx(xx, yy)] === only)) G.terrain[idx(xx, yy)] = v; };
    const get = (x, y) => inMap(x, y) ? G.terrain[idx(x, y)] : T.WATER;
    G.terrain.fill(T.GRASS); G.ore.fill(0); G.oreKind.fill(0);
    const civ = []; const civAt = (id, x, y) => { const d = CIV.find(c => c.id === id); for (const [xx, yy] of mirrors(x, y)) civ.push([id, Math.min(xx, MAPW - 1 - x) === xx ? xx : xx - d.foot[0] + 1, Math.min(yy, MAPH - 1 - y) === yy ? yy : yy - d.foot[1] + 1]); };
    const lake = (cx, cy, rx, ry) => { for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let y = cy - ry - 1; y <= cy + ry + 1; y++) if (inMap(x, y) && ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1 + (r() - 0.5) * 0.3) set(x, y, T.WATER); };
    const bridgeAt = (y, horizontal = true) => { if (horizontal) { let x0 = -1, x1 = -1; for (let x = 0; x < MAPW; x++) if (get(x, y) === T.WATER) { if (x0 < 0) x0 = x; x1 = x; } if (x0 < 0) return; for (let x = x0 - 1; x <= x1 + 1; x++) for (let yy = y; yy <= y + 1; yy++) if (inMap(x, yy)) G.terrain[idx(x, yy)] = T.BRIDGE; } else { const x = y; let y0 = -1, y1 = -1; for (let yy = 0; yy < MAPH; yy++) if (get(x, yy) === T.WATER) { if (y0 < 0) y0 = yy; y1 = yy; } if (y0 < 0) return; for (let yy = y0 - 1; yy <= y1 + 1; yy++) for (let xx = x; xx <= x + 1; xx++) if (inMap(xx, yy)) G.terrain[idx(xx, yy)] = T.BRIDGE; } };
    const cliff = (x0, y0, x1, y1, gapAt) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); if (Math.abs(i - gapAt) <= 1) continue; set(x, y, T.CLIFF, T.GRASS); } };
    const road = (x0, y0, x1, y1, w = 2) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); for (let k = 0; k < w; k++) { const hx = Math.abs(x1 - x0) >= Math.abs(y1 - y0); set(hx ? x : x + k, hx ? y + k : y, T.ROAD, T.GRASS); set(hx ? x : x + k, hx ? y + k : y, T.ROAD, T.SCRUB); } } };
    const rocks = (n, avoid) => { for (let i = 0; i < n; i++) { const x = 3 + Math.floor(r() * (MAPW - 6)), y = 3 + Math.floor(r() * (MAPH - 6)); if (avoid(x, y)) continue; const w = 1 + Math.floor(r() * 2), h = 1 + Math.floor(r() * 2); for (let xx = x; xx < x + w; xx++) for (let yy = y; yy < y + h; yy++) set(xx, yy, T.ROCK, T.GRASS); } };
    const scrub = n => { for (let i = 0; i < n; i++) { const x = Math.floor(r() * MAPW), y = Math.floor(r() * MAPH); set(x, y, T.SCRUB, T.GRASS); } };
    const shores = () => { for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const t = get(x, y); if (t !== T.GRASS && t !== T.SCRUB) continue; let near = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + dx, y + dy) === T.WATER) near = true; if (near) G.terrain[idx(x, y)] = T.SHORE; } };
    const field = (cx, cy, rad, kind, amt) => { for (let x = cx - rad; x <= cx + rad; x++) for (let y = cy - rad; y <= cy + rad; y++) if (inMap(x, y) && Math.hypot(x - cx, y - cy) <= rad + r() * 0.8) for (const [xx, yy] of mirrors(x, y)) { if (!inMap(xx, yy)) continue; const t = G.terrain[idx(xx, yy)]; if (t === T.WATER || t === T.CLIFF || t === T.BRIDGE || t === T.ROAD) continue; G.ore[idx(xx, yy)] = amt * (0.6 + r() * 0.8); G.oreKind[idx(xx, yy)] = kind; if (t === T.ROCK || t === T.SCRUB) G.terrain[idx(xx, yy)] = T.GRASS; } };
    const clear = (x0, y0, x1, y1) => { for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) { for (const [xx, yy] of mirrors(x, y)) if (inMap(xx, yy)) { const t = G.terrain[idx(xx, yy)]; if (t === T.ROCK || t === T.CLIFF || t === T.SCRUB) G.terrain[idx(xx, yy)] = T.GRASS; } } };
    const nearStart = (x, y) => (x < 18 && y < 16) || (x > MAPW - 19 && y > MAPH - 17) || (sym === 'quad' && ((x > MAPW - 19 && y < 16) || (x < 18 && y > MAPH - 17)));
    let starts;
    if (preset === 'riverlands') {
      const phase = r() * 6.28; for (let y = 0; y < MAPH; y++) { const cx = MAPW / 2 + Math.sin(y / 7 + phase) * 4 + Math.sin(y / 3.1 + phase * 2) * 1.5; const w = 1.6 + 0.5 * Math.sin(y / 5); for (let x = 0; x < MAPW; x++) if (Math.abs(x + 0.5 - cx) < w) G.terrain[idx(x, y)] = T.WATER; }
      lake(13, 36, 5, 3); bridgeAt(11); bridgeAt(Math.floor(MAPH / 2) - 1); bridgeAt(MAPH - 13);
      cliff(4, 19, 20, 19, 8); cliff(20, 19, 20, 27, 20); cliff(26, 4, 26, 14, 5);
      const cy = Math.floor(MAPH / 2) - 1; let bx0 = -1, bx1 = -1; for (let x = 0; x < MAPW; x++) if (get(x, cy) === T.BRIDGE) { if (bx0 < 0) bx0 = x; bx1 = x; }
      for (let x = Math.max(0, bx0 - 12); x <= Math.min(MAPW - 1, bx1 + 12); x++) for (let yy = cy; yy <= cy + 1; yy++) if (get(x, yy) === T.GRASS) G.terrain[idx(x, yy)] = T.ROAD;
      for (const [id, x, y] of [['civ_tower', bx0 - 5, cy - 4], ['civ_shop', bx0 - 8, cy + 3], ['civ_house', bx0 - 11, cy - 3], ['civ_warehouse', bx0 - 7, cy - 8], ['civ_house', bx0 - 4, cy + 3]]) civAt(id, x, y);
      civAt('civ_derrick', 8, 28); civAt('civ_derrick', 30, 6);
      rocks(26, nearStart); scrub(140); shores();
      field(15, 10, 3, 1, 40); field(8, 24, 3, 1, 45); field(28, 24, 3, 1, 50); field(22, 44, 2, 2, 28); field(MAPW / 2 - 8, MAPH / 2 - 10, 2, 2, 30);
      clear(3, 3, 16, 14); starts = [{ x: 6, y: 6 }, { x: MAPW - 9, y: MAPH - 9 }];
    } else if (preset === 'island') {
      G.terrain.fill(T.WATER);
      const land = (cx, cy, rx, ry) => { for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let y = cy - ry - 1; y <= cy + ry + 1; y++) if (inMap(x, y) && ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1 + (r() - 0.5) * 0.25) set(x, y, T.GRASS); };
      land(11, 10, 12, 10); land(MAPW / 2, MAPH / 2, 11, 9); land(14, MAPH - 12, 7, 5);
      const causeway = (x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); for (let k = -1; k <= 1; k++) { set(x + (Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? 0 : k), y + (Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? k : 0), T.BRIDGE, T.WATER); } } };
      causeway(22, 14, 30, 22); causeway(16, MAPH - 16, 28, MAPH / 2 + 4);
      civAt('civ_derrick', 16, MAPH - 13); civAt('civ_derrick', MAPW / 2 - 9, MAPH / 2 - 2);
      civAt('civ_house', MAPW / 2 - 3, MAPH / 2 - 7); civAt('civ_shop', MAPW / 2 + 1, MAPH / 2 - 4);
      rocks(14, nearStart); scrub(80); shores();
      field(16, 14, 3, 1, 40); field(6, 16, 3, 1, 40); field(MAPW / 2 - 5, MAPH / 2, 3, 2, 32); field(14, MAPH - 10, 2, 1, 36);
      clear(3, 3, 16, 14); starts = [{ x: 6, y: 6 }, { x: MAPW - 9, y: MAPH - 9 }];
    } else if (preset === 'urban') {
      for (let gx = 18; gx <= MAPW - 20; gx += 10) road(gx, 6, gx, MAPH - 7, 2); for (let gy = 10; gy <= MAPH - 12; gy += 10) road(4, gy, MAPW - 5, gy, 2);
      const blocks = [['civ_tower', 22, 13], ['civ_house', 26, 13], ['civ_shop', 22, 18], ['civ_warehouse', 25, 19], ['civ_tower', 32, 13], ['civ_house', 36, 15], ['civ_shop', 32, 19], ['civ_house', 36, 19], ['civ_warehouse', 22, 24], ['civ_tower', 27, 23], ['civ_house', 32, 24], ['civ_shop', 35, 23]];
      for (const [id, x, y] of blocks) civAt(id, x, y);
      civAt('civ_derrick', 8, 30); civAt('civ_derrick', 40, 6);
      lake(MAPW / 2, 6, 6, 2); rocks(8, (x, y) => nearStart(x, y) || (x > 18 && x < MAPW - 18 && y > 10 && y < MAPH - 10)); scrub(40); shores();
      field(14, 12, 3, 1, 45); field(8, 24, 3, 1, 45); field(MAPW / 2 - 2, MAPH / 2 - 7, 2, 2, 30); field(30, 30, 2, 1, 40);
      clear(3, 3, 16, 14); starts = [{ x: 6, y: 6 }, { x: MAPW - 9, y: MAPH - 9 }];
    } else if (preset === 'desert') {
      const dune = (cx, cy, rx, ry) => { for (let x = cx - rx; x <= cx + rx; x++) for (let y = cy - ry; y <= cy + ry; y++) if (inMap(x, y) && ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1) set(x, y, T.ROCK, T.GRASS); };
      dune(24, 16, 5, 2); dune(14, 30, 2, 5); dune(34, 36, 6, 2); lake(MAPW / 2 - 10, MAPH / 2 + 12, 4, 2);
      cliff(28, 24, 44, 24, 8); road(8, 8, MAPW - 9, MAPH - 9, 2);
      civAt('civ_derrick', 10, 26); civAt('civ_derrick', 30, 8); civAt('civ_warehouse', 20, 36); civAt('civ_house', 44, 18);
      rocks(40, nearStart); scrub(60); shores();
      field(14, 12, 2, 1, 30); field(8, 24, 2, 1, 32); field(MAPW / 2 - 4, MAPH / 2 - 4, 4, 2, 40); field(40, 10, 2, 1, 30);
      clear(3, 3, 16, 14); starts = [{ x: 6, y: 6 }, { x: MAPW - 9, y: MAPH - 9 }];
    } else if (preset === 'crossfire') {
      for (let x = 0; x < MAPW; x++) { const cy = MAPH / 2 + Math.sin(x / 9) * 3; for (let y = 0; y < MAPH; y++) if (Math.abs(y + 0.5 - cy) < 2) G.terrain[idx(x, y)] = T.WATER; }
      bridgeAt(12, false); bridgeAt(MAPW / 2 - 1, false); bridgeAt(MAPW - 14, false);
      cliff(18, 6, 18, 18, 6); cliff(24, 22, 48, 22, 12);
      for (const [id, x, y] of [['civ_tower', MAPW / 2 - 6, MAPH / 2 - 7], ['civ_house', MAPW / 2 - 10, MAPH / 2 - 5], ['civ_shop', MAPW / 2 - 3, MAPH / 2 - 5]]) civAt(id, x, y);
      civAt('civ_derrick', MAPW / 2 - 12, 8); civAt('civ_derrick', 8, MAPH / 2 - 8);
      rocks(20, nearStart); scrub(100); shores();
      field(12, 12, 3, 1, 40); field(MAPW / 2 - 14, 14, 3, 1, 40); field(MAPW / 2 - 4, MAPH / 2 - 10, 2, 2, 30); field(26, 10, 2, 1, 36);
      clear(3, 3, 16, 14); clear(MAPW / 2 - 16, 3, MAPW / 2 - 3, 14);
      starts = [{ x: 6, y: 6 }, { x: MAPW / 2 - 12, y: 6 }, { x: MAPW - 9, y: MAPH - 9 }, { x: MAPW / 2 + 9, y: MAPH - 9 }];
    } else { // quadrant
      cliff(20, 4, 20, 20, 8); cliff(4, 20, 20, 20, 8); lake(MAPW / 2 - 8, 8, 4, 2);
      road(10, 10, MAPW / 2 - 1, MAPH / 2 - 1, 2);
      civAt('civ_derrick', 28, 8); civAt('civ_derrick', 8, 22); civAt('civ_warehouse', MAPW / 2 - 8, MAPH / 2 - 8); civAt('civ_tower', MAPW / 2 - 3, MAPH / 2 - 10);
      rocks(30, nearStart); scrub(60); shores();
      field(12, 12, 3, 1, 40); field(MAPW / 2 - 4, MAPH / 2 - 4, 3, 2, 36); field(26, 16, 2, 1, 34);
      clear(3, 3, 16, 14);
      starts = [{ x: 6, y: 6 }, { x: MAPW - 9, y: 6 }, { x: 6, y: MAPH - 9 }, { x: MAPW - 9, y: MAPH - 9 }];
    }
    return { civ, starts, theme: P.theme, name: P.name, players: P.players, preset };
  }
  // ── serialisation ──
  function toData(G, MAPW, MAPH, idx, meta) { const civ = G.ents.filter(e => !e.dead && e.def.faction === 'civ').map(e => [e.def.id, e.cx, e.cy]); const ore = []; for (let i = 0; i < MAPW * MAPH; i++) if (G.ore[i] > 0) ore.push([i, Math.round(G.ore[i]), G.oreKind[i]]); let rle = ''; let run = 0, last = -1; for (let i = 0; i < MAPW * MAPH; i++) { const t = G.terrain[i]; if (t === last) run++; else { if (last >= 0) rle += last + ':' + run + ','; last = t; run = 1; } } rle += last + ':' + run; return Object.assign({ v: 1, w: MAPW, h: MAPH, terrain: rle, ore, civ, starts: G.starts || [], theme: G.theme || 'grass', name: G.mapName || 'Custom map' }, meta || {}); }
  function fromData(G, data, MAPW, MAPH, idx, inMap) { G.terrain.fill(T.GRASS); G.ore.fill(0); G.oreKind.fill(0); let i = 0; for (const tok of data.terrain.split(',')) { const [t, n] = tok.split(':').map(Number); for (let k = 0; k < n && i < MAPW * MAPH; k++) G.terrain[i++] = t; } for (const [ci, amt, kind] of data.ore || []) { G.ore[ci] = amt; G.oreKind[ci] = kind; } const starts = (data.starts && data.starts.length >= 2) ? data.starts : [{ x: 6, y: 6 }, { x: MAPW - 9, y: MAPH - 9 }]; return { civ: (data.civ || []).map(c => c.slice()), starts, theme: data.theme || 'grass', name: data.name || 'Custom map', players: starts.length, preset: 'custom' }; }
  return { T, PRESETS, generate, toData, fromData };
})();
if (typeof module !== 'undefined') module.exports = { CIV, MAPGEN };
