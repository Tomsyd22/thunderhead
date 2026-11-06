// Unit Sandbox test range — shared by the simulation (node + browser) and the renderer.
// Metric, x east → y north, z up (the renderer maps sim (x, y, z) → three (x, z, -y)). Water surface z = 0.
// 640 × 480 m: western highlands with a cliff ridge and a gentle pass, a 20° test ramp, rock fields, an airfield,
// a garrison bunker, a shallow lagoon (≤1.2 m, Wisp only) with a deep dredged mouth, a beach, a shallow sandbar,
// open sea (6–14 m) and an offshore island with a shore target.
export const RANGE = { W: 640, H: 480, res: 1 };

function hash(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, s = 1, oct = 4) { let a = 0, amp = 0.5, f = 1; for (let o = 0; o < oct; o++) { a += amp * vnoise(x * f, y * f, s + o * 17); f *= 2.03; amp *= 0.5; } return a; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// authored features (also used by the renderer for props and labels)
export const FEATURES = {
  airfield: { x: 80, y: 70, w: 120, h: 70, pads: [{ x: 50, y: 60, hdg: 0 }, { x: 80, y: 60, hdg: 0 }, { x: 110, y: 60, hdg: 0 }, { x: 140, y: 60, hdg: 0 }], heli: [{ x: 60, y: 100 }, { x: 100, y: 100 }] },
  bunker: { x: 300, y: 190, w: 12, d: 12, h: 4.2, slots: 4, hp: 2400 },
  island_target: { x: 602, y: 372, w: 10, d: 10, h: 4, hp: 3000 },
  ridge: { x0: 205, x1: 235, y0: 0, y1: 300, pass: [130, 160] },
  ramp: { x: 110, y: 380, len: 60, grade_deg: 20 },
  lagoon: { x0: 330, x1: 470, y0: 290, y1: 370, mouth: [310, 350] },
  sandbar: { x0: 490, x1: 560, y0: 50, y1: 130 },
  coast_x: 470,
  // economy (harvester test): one drive-through ore refinery (bay along +y, field side north) and two extraction rigs.
  // dir = unit vector from the rig to its service point, as in the maps (service point 21 m from the rig centre).
  econ: { refinery: { x: 400, y: 28 }, deposits: [{ id: 'near', name: 'Near field', rig: [300, 20], dir: [0, 1] }, { id: 'far', name: 'Far field (over the pass)', rig: [150, 165], dir: [0, -1] }] },
  spawns: {
    foot: { x: 150, y: 230 }, tracked: { x: 120, y: 290 }, hover: { x: 300, y: 330 }, heli: { x: 60, y: 100 }, drone: { x: 100, y: 100 },
    ship: { x: 560, y: 250 }, enemy_land: { x: 330, y: 150 }, enemy_sea: { x: 590, y: 160 },
  },
};

// flat pads for the refinery and the two 50 × 50 m deposit service areas, levelled to the ground height at their centre
const ECON_PADS = (() => { const E = FEATURES.econ; return [{ x: E.refinery.x, y: E.refinery.y, hw: 22, hh: 18 }, ...E.deposits.map((d) => ({ x: d.rig[0] + d.dir[0] * 8, y: d.rig[1] + d.dir[1] * 8, hw: 25, hh: 25 }))]; })();
export function rawHeight(x, y) {
  let h = baseHeight(x, y);
  for (const p of ECON_PADS) { const k = sstep(8, 0, Math.max(Math.abs(x - p.x) - p.hw, Math.abs(y - p.y) - p.hh)); if (k > 0) h = lerp(h, p.h ?? (p.h = baseHeight(p.x, p.y)), k); }
  return h;
}
function baseHeight(x, y) {
  const F = FEATURES;
  // base rolling land 3–9 m
  let h = 4 + 5 * fbm(x / 140, y / 140, 3) + 1.2 * (fbm(x / 35, y / 35, 9) - 0.5);
  // coastline wiggle and beach down to the sea floor
  const cx = F.coast_x + 14 * (fbm(0.5, y / 90, 21) - 0.5);
  const tBeach = sstep(cx - 30, cx + 10, x);                         // 0 inland → 1 at the waterline
  const sea = -6 - 8 * sstep(cx + 10, cx + 120, x) - 2 * fbm(x / 60, y / 60, 5);
  h = lerp(h, 0.6, sstep(cx - 45, cx - 15, x));                       // flatten into a beach
  h = lerp(h, sea, sstep(cx - 5, cx + 25, x) * 1);
  void tBeach;
  // sandbar: shallow shelf 0.5–1.0 m deep off the south beach, joined to the beach (organic ellipse)
  {
    const S = F.sandbar; const ex = (x - (S.x0 + S.x1) / 2 + 20) / ((S.x1 - S.x0) / 2 + 30), ey = (y - (S.y0 + S.y1) / 2) / ((S.y1 - S.y0) / 2);
    const r = Math.hypot(ex, ey) + 0.35 * (fbm(x / 30, y / 30, 31) - 0.5);
    const k = sstep(1.0, 0.75, r); if (k > 0) h = lerp(h, Math.max(h, -0.5 - 0.45 * fbm(x / 20, y / 20, 33)), k);
  }
  // lagoon: shallow (0.4–1.1 m) inlet with sloping banks; its mouth is a dredged deep channel (4 m) ships can enter
  {
    const L = F.lagoon; const ex = (x - (L.x0 + L.x1) / 2) / ((L.x1 - L.x0) / 2), ey = (y - (L.y0 + L.y1) / 2) / ((L.y1 - L.y0) / 2);
    const r = Math.hypot(Math.min(ex, 0) * 1.0 + Math.max(ex, 0) * 0.6, ey) + 0.3 * (fbm(x / 40, y / 40, 41) - 0.5);
    const k = sstep(1.7, 0.85, r); if (k > 0) h = lerp(h, -0.4 - 0.65 * fbm(x / 25, y / 25, 44), k);
    const mx = sstep(L.x1 - 25, L.x1 + 10, x), my = sstep(0, 12, Math.min(y - L.mouth[0], L.mouth[1] - y));
    if (mx * my > 0) h = Math.min(h, lerp(h, -4.0, mx * my));
  }
  // ridge: rounded crest with cliff faces on both sides and a gentle pass
  {
    const R = F.ridge; const c = (R.x0 + R.x1) / 2 + 8 * (fbm(0.3, y / 70, 52) - 0.5); const hw = (R.x1 - R.x0) / 2;
    const across = Math.abs(x - c);
    if (across < hw + 14 && y < R.y1 + 30) {
      const cliff = sstep(hw + 10, hw - 2, across);                       // steep faces
      const crest = 1 - 0.35 * (across / hw) ** 2;                          // rounded top
      const along = sstep(R.y1 + 30, R.y1 - 10, y);
      const pc = (R.pass[0] + R.pass[1]) / 2, ph = (R.pass[1] - R.pass[0]) / 2;
      const pass = 1 - 0.88 * sstep(40, 0, Math.abs(y - pc) - ph);         // ~12–15° approach slopes into the pass
      h += 17 * cliff * Math.max(crest, 0.2) * along * pass * (0.85 + 0.3 * fbm(x / 18, y / 18, 51));
    }
  }
  // 20° test ramp (north-facing) up to a small plateau
  {
    const P = F.ramp; const g = Math.tan(P.grade_deg * Math.PI / 180); const u = y - P.y, wv = Math.abs(x - P.x);
    if (wv < 26 && u > -P.len && u < 30) {
      const ramp = u < 0 ? g * (u + P.len) : g * P.len; const side = sstep(26, 18, wv);
      h = Math.max(h, lerp(h, 4 + ramp, side));
    }
  }
  // airfield apron, bunker pad, island
  { const A = F.airfield; const k = sstep(8, 0, Math.max(Math.abs(x - A.x) - A.w / 2, Math.abs(y - A.y) - A.h / 2)); h = lerp(h, 5.0, k); }
  { const B = F.bunker; const k = sstep(10, 0, Math.max(Math.abs(x - B.x) - 10, Math.abs(y - B.y) - 10)); h = lerp(h, 5.5, k); }
  { const I = F.island_target; const r = Math.hypot(x - I.x, y - I.y); if (r < 46) h = Math.max(h, lerp(-6, 3.5 + fbm(x / 12, y / 12, 61), sstep(40, 16, r))); }
  return h;
}

export function makeTerrain(opts = {}) {
  const W = opts.W || RANGE.W, H = opts.H || RANGE.H, res = opts.res || RANGE.res;
  const nx = Math.round(W / res) + 1, ny = Math.round(H / res) + 1;
  const h = new Float32Array(nx * ny);
  const fn = opts.heightFn || rawHeight;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = fn(i * res, j * res);
  // obstacles: boulder fields (circles) — blocked for ground units, cosmetic rocks for the renderer
  const rocks = [];
  const fields = opts.heightFn ? [] : [[60, 200, 40], [300, 90, 35], [150, 330, 25], [380, 240, 30]];
  let s = 1;
  for (const [fx, fy, fr] of fields) for (let k = 0; k < 9; k++) {
    s++; const a = hash(k, s, 3) * 6.283, r = Math.sqrt(hash(s, k, 4)) * fr, x = fx + Math.cos(a) * r, y = fy + Math.sin(a) * r;
    const rr = 1.2 + 2.2 * hash(k, s, 5); rocks.push({ x, y, r: rr, rot: hash(s, s, 6) * 6.283, kind: k % 3 });
  }
  const T = {
    W, H, res, nx, ny, h, rocks, features: FEATURES,
    height(x, y) { // bilinear
      const fx = Math.min(Math.max(x / res, 0), nx - 1.001), fy = Math.min(Math.max(y / res, 0), ny - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, o = j * nx + i;
      return (h[o] * (1 - u) + h[o + 1] * u) * (1 - v) + (h[o + nx] * (1 - u) + h[o + nx + 1] * u) * v;
    },
    surface(x, y) { return Math.max(0, T.height(x, y)); },            // ground or water surface
    depth(x, y) { return Math.max(0, -T.height(x, y)); },
    slopeDeg(x, y) { const e = 1.0; const dx = (T.height(x + e, y) - T.height(x - e, y)) / (2 * e), dy = (T.height(x, y + e) - T.height(x, y - e)) / (2 * e); return Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI; },
    normal(x, y, e = 1.0) { const dx = (T.height(x + e, y) - T.height(x - e, y)) / (2 * e), dy = (T.height(x, y + e) - T.height(x, y - e)) / (2 * e); const l = Math.hypot(dx, dy, 1); return [-dx / l, -dy / l, 1 / l]; },
    // terrain line of sight: true if the straight segment a→b (3D) stays above the ground (water doesn't block)
    los(ax, ay, az, bx, by, bz, step = 2) {
      const d = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k < n; k++) { const t = k / n; if (T.height(ax + (bx - ax) * t, ay + (by - ay) * t) > az + (bz - az) * t) return false; }
      return true;
    },
  };
  return T;
}
