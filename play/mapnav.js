// Game map navigation: the engine's Nav (units/sandbox/nav.js) on the Map Lab's baked 4 m nav layers.
// nav.grid.png bits (map.json nav_bits): infantry 1, tank 2, harvester 4, amphibious 8, ship 16 — each already shrunk by its
// class radius (map.json unit_radius_m), so the clearance field gets that radius back as a bonus.
// Engine domains: foot ← infantry, veh ← tank (tanks and harvesters), hover ← amphibious (the Wisp crosses shallow and open
// water like the map's hovercraft class), ship ← ship. Air ignores the grid.
// The map's base kits (team-owned instances: instances.json row[5] = 1 for B, 2 for R) are not built: players build their own bases, so the kit footprints are re-opened
// on the pads (re-eroded by each class radius against the real obstacles around them).
import { Nav } from './engine/nav.js';

// footprints of the kit buildings (maps/assets/measured_bounds.json, model x × y)
const KIT_SIZE = { bld_hq: [30, 24], bld_barracks: [24, 12], bld_vehicle_factory: [40, 30], bld_ore_refinery: [36, 28], bld_power_substation: [20, 16], bld_radar_control: [16, 12] };

export function kitRects(T) {
  const out = [];
  for (const [asset, rows] of Object.entries(T.instances || {})) {
    const sz = KIT_SIZE[asset]; if (!sz) continue;
    for (const r of rows) if (r.length > 5 && r[5] > 0) { const q = Math.abs(Math.sin(r[3])) > 0.5; out.push({ asset, team: r[5], x: r[0], y: r[1], z: r[2], rot: r[3], w: q ? sz[1] : sz[0], d: q ? sz[0] : sz[1] }); }
  }
  return out;
}

export function makeMapNav(T) {
  const nn = T.nn, g = T.g, off = T.navOff, B = T.meta.nav_bits, R = T.meta.unit_radius_m, bits = T.navBits;
  const mask = (bit) => { const m = new Uint8Array(nn * nn); for (let k = 0; k < m.length; k++) m[k] = bits[k] & bit ? 1 : 0; return m; };
  const foot = mask(B.infantry), veh = mask(B.tank), hover = mask(B.amphibious), ship = mask(B.ship);
  const cx = (i) => i * g - off + g / 2;
  const kits = kitRects(T);
  // 1. infantry: every cell whose centre lies in (or within 1 m of) a kit footprint is open pad
  const inRect = (r, x, y, m) => Math.abs(x - r.x) <= r.w / 2 + m && Math.abs(y - r.y) <= r.d / 2 + m;
  const span = (r, m) => [Math.max(0, Math.floor((r.x - r.w / 2 - m + off) / g)), Math.min(nn - 1, Math.floor((r.x + r.w / 2 + m + off) / g)), Math.max(0, Math.floor((r.y - r.d / 2 - m + off) / g)), Math.min(nn - 1, Math.floor((r.y + r.d / 2 + m + off) / g))];
  let opened = 0;
  for (const r of kits) { const [i0, i1, j0, j1] = span(r, 1); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inRect(r, cx(i), cx(j), 1)) { const k = j * nn + i; if (!foot[k]) { foot[k] = 1; opened++; } } }
  // 2. vehicles: re-erode around the opened pads by the class radius (distance from the cell centre to the nearest obstacle cell's square)
  // only flat pad ground at the kit's own height is re-opened; anything else (slopes infantry can climb but vehicles cannot,
  // water, rock) stays as baked and counts as an obstacle
  const erode = (dst, rad, also) => {
    const reach = Math.ceil((rad + g) / g);
    for (const r of kits) { const [i0, i1, j0, j1] = span(r, rad + 8);
      const flat = (q) => foot[q] && Math.abs(T.terrain(cx(q % nn), cx((q / nn) | 0)) - r.z) < 0.4;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * nn + i; if (!flat(k)) continue;
        let ok = true;
        for (let dj = -reach; dj <= reach && ok; dj++) for (let di = -reach; di <= reach; di++) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nn || b >= nn) { ok = false; break; }
          const q = b * nn + a; if (also[q] || flat(q)) continue;
          const dx = Math.max(0, Math.abs(di) * g - g / 2), dy = Math.max(0, Math.abs(dj) * g - g / 2);
          if (dx * dx + dy * dy < rad * rad) { ok = false; break; }
        }
        dst[k] = ok ? 1 : also[k];
      } }
  };
  const veh0 = veh.slice(), hov0 = hover.slice();
  erode(veh, R.tank, veh0); erode(hover, R.amphibious, hov0);
  const nav = new Nav(T, [], { cell: g, off, gw: nn, gh: nn, pullWin: 40, labels: true, labelR: { ship: 12 }, maxIter: 120000, masks: { foot, veh, hover, ship }, bonus: { foot: R.infantry, veh: R.tank, hover: R.amphibious, ship: R.ship } });
  nav.kits = kits; nav.opened = opened;
  return nav;
}
