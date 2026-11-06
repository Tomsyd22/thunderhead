// Navigation for the Unit Sandbox: per-domain passability masks on a 2 m grid, clearance fields (distance to the
// nearest blocked cell), A* with clearance and a shore/edge penalty, and line-of-sight string pulling.
// Domains: foot (land, slope ≤ 35°), veh (land, slope ≤ 25°), hover (veh land + water ≤ 1.2 m deep),
// ship (authored deep water ≥ 3 m), air (everything inside the map).
export const CELL = 2; const CELL0 = CELL;   // sandbox default; a Nav instance may use another cell size (this.cell)
export const DOMAINS = ['foot', 'veh', 'hover', 'ship'];
export const LIMITS = { footSlope: 35, vehSlope: 25, hoverDepth: 1.2, shipDepth: 3.0, landMin: 0.05 };

class Heap { // binary min-heap of node indices keyed by f
  constructor(n) { this.a = new Int32Array(n); this.f = new Float32Array(n); this.n = 0; }
  push(i, f) { let k = this.n++; this.a[k] = i; this.f[k] = f; while (k > 0) { const p = (k - 1) >> 1; if (this.f[p] <= this.f[k]) break; this.sw(p, k); k = p; } }
  pop() { const r = this.a[0]; this.n--; if (this.n > 0) { this.a[0] = this.a[this.n]; this.f[0] = this.f[this.n]; let k = 0; for (;;) { const l = 2 * k + 1, rr = l + 1; let m = k; if (l < this.n && this.f[l] < this.f[m]) m = l; if (rr < this.n && this.f[rr] < this.f[m]) m = rr; if (m === k) break; this.sw(m, k); k = m; } } return r; }
  sw(i, j) { const a = this.a[i]; this.a[i] = this.a[j]; this.a[j] = a; const f = this.f[i]; this.f[i] = this.f[j]; this.f[j] = f; }
}

export class Nav {
  // opts (game maps): { cell: grid metres, masks: { domain: Uint8Array(gw*gh) } baked passability, bonus: { domain: metres } added to
  // clearance where the baked layer already excludes a class radius }. Without opts this is the sandbox's 2 m nav from terrain samples.
  constructor(T, blockers = [], opts = {}) {
    const CELL = this.cell = opts.cell || CELL0; this.off = opts.off || 0;   // off: grid origin shift (cell i covers [i·cell − off, (i+1)·cell − off))
    this.pullWin = opts.pullWin || Infinity;   // string pulling looks at most this many cells ahead (bounds the cost on big maps)
    this.T = T; this.gw = opts.gw || Math.floor(T.W / CELL); this.gh = opts.gh || Math.floor(T.H / CELL); const n = this.gw * this.gh; this.n = n;
    this.useLabels = !!opts.labels; this.labR = opts.labelR || {}; this.lab = {}; this.maxIter = opts.maxIter || 400000;   // connected regions (game maps): unreachable goals retarget instead of flooding the map
    this.pass = {}; this.clear = {}; this.bonus = opts.bonus || {}; this.domains = opts.masks ? Object.keys(opts.masks) : DOMAINS;
    this.dyn = new Uint8Array(n); this.base = {};   // runtime footprints (buildings): count of blockers per cell, and the unblocked masks
    if (opts.masks) {
      for (const d of this.domains) { this.base[d] = opts.masks[d]; const p = this.pass[d] = opts.masks[d].slice(); this.clear[d] = this._clearance(p, this.bonus[d] || 0); }
      this.g = new Float32Array(n); this.from = new Int32Array(n); this.stamp = new Uint32Array(n); this.closed = new Uint32Array(n); this.run = 0; this.heap = new Heap(n * 4);
      return;
    }
    // conservative per-cell samples (centre + 4 corners): lowest ground, highest ground, steepest slope
    const slope = new Float32Array(n), hgt = new Float32Array(n), hmax = new Float32Array(n), blocked = new Uint8Array(n);
    const P5 = [[0.5, 0.5], [0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]];
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
      const k = j * this.gw + i; let lo = 1e9, hi = -1e9, sl = 0;
      for (const [a, b] of P5) { const x = (i + a) * CELL, y = (j + b) * CELL, h = T.height(x, y); lo = Math.min(lo, h); hi = Math.max(hi, h); sl = Math.max(sl, T.slopeDeg(x, y)); }
      hgt[k] = lo; hmax[k] = hi; slope[k] = sl;
    }
    // static blockers: rocks (circles) and buildings (rectangles, already inflated by nothing — clearance does the rest)
    for (const r of T.rocks) this._stamp(blocked, (x, y) => Math.hypot(x - r.x, y - r.y) < r.r + 0.3);
    for (const b of blockers) this._stamp(blocked, (x, y) => Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.d / 2);
    this.blocked = blocked; this.hgt = hgt; this.slope = slope;
    const L = LIMITS;
    const def = {
      foot: (k) => !blocked[k] && hgt[k] > L.landMin && slope[k] <= L.footSlope,
      veh: (k) => !blocked[k] && hgt[k] > L.landMin && slope[k] <= L.vehSlope,
      hover: (k) => !blocked[k] && ((hgt[k] > L.landMin && slope[k] <= L.vehSlope) || (hgt[k] <= L.landMin && -hgt[k] <= L.hoverDepth && (hmax[k] <= L.landMin || slope[k] <= L.vehSlope))),
      ship: (k) => -hmax[k] >= L.shipDepth,
    };
    for (const d of DOMAINS) {
      const p = new Uint8Array(n); for (let k = 0; k < n; k++) p[k] = def[d](k) ? 1 : 0;
      this.pass[d] = p; this.base[d] = p.slice(); this.clear[d] = this._clearance(p);
    }
    this.g = new Float32Array(n); this.from = new Int32Array(n); this.stamp = new Uint32Array(n); this.closed = new Uint32Array(n); this.run = 0;
    this.heap = new Heap(n * 4);
  }
  _stamp(arr, inside) {
    const CELL = this.cell; for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) if (inside((i + 0.5) * CELL, (j + 0.5) * CELL)) arr[j * this.gw + i] = 1;
  }
  // chamfer distance (metres) from each passable cell centre to the nearest blocked cell edge or map edge, plus `bonus`;
  // win = [i0, j0, i1, j1] recomputes only that window, keeping the window's outer ring as fixed seeds (runtime footprints)
  _clearance(p, bonus = 0, out = null, win = null) {
    const { gw, gh } = this, CELL = this.cell, INF = 1e9, S = Math.SQRT2, d = out || new Float32Array(gw * gh);
    const [i0, j0, i1, j1] = win || [0, 0, gw - 1, gh - 1];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * gw + i, ring = win && (i === i0 || j === j0 || i === i1 || j === j1);
      d[k] = !p[k] ? 0 : ring ? (d[k] > 0 ? (d[k] - bonus + CELL / 2) / CELL : INF) : INF; }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * gw + i; if (!d[k]) continue;
      let v = Math.min(d[k], i + 1, j + 1, gw - i, gh - j); // map edges count as blocked
      if (i > i0) v = Math.min(v, d[k - 1] + 1); if (j > j0) v = Math.min(v, d[k - gw] + 1);
      if (i > i0 && j > j0) v = Math.min(v, d[k - gw - 1] + S); if (i < i1 && j > j0) v = Math.min(v, d[k - gw + 1] + S);
      d[k] = v;
    }
    for (let j = j1; j >= j0; j--) for (let i = i1; i >= i0; i--) {
      const k = j * gw + i; if (!d[k]) continue; let v = d[k];
      if (i < i1) v = Math.min(v, d[k + 1] + 1); if (j < j1) v = Math.min(v, d[k + gw] + 1);
      if (i < i1 && j < j1) v = Math.min(v, d[k + gw + 1] + S); if (i > i0 && j < j1) v = Math.min(v, d[k + gw - 1] + S);
      d[k] = v;
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * gw + i; d[k] = d[k] ? d[k] * CELL - CELL / 2 + bonus : -CELL / 2; }
    return d;
  }
  /** Runtime footprint (a placed building): rect {x, y, w, d} axis-aligned, blocks every domain except air. on=false removes it. */
  footprint(rect, on = true) {
    const C = this.cell, o = this.off, i0 = Math.max(0, Math.floor((rect.x - rect.w / 2 + o) / C)), i1 = Math.min(this.gw - 1, Math.floor((rect.x + rect.w / 2 + o) / C)),
      j0 = Math.max(0, Math.floor((rect.y - rect.d / 2 + o) / C)), j1 = Math.min(this.gh - 1, Math.floor((rect.y + rect.d / 2 + o) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * this.gw + i; this.dyn[k] = Math.max(0, this.dyn[k] + (on ? 1 : -1)); }
    const m = Math.ceil(64 / C), win = [Math.max(0, i0 - m), Math.max(0, j0 - m), Math.min(this.gw - 1, i1 + m), Math.min(this.gh - 1, j1 + m)];
    this.lab = {}; this.rtc = null;   // regions change with footprints: relabel lazily (and forget the cached retargets)
    for (const dom of this.domains) {
      const P = this.pass[dom], B = this.base[dom];
      for (let j = win[1]; j <= win[3]; j++) for (let i = win[0]; i <= win[2]; i++) { const k = j * this.gw + i; P[k] = B[k] && !this.dyn[k] ? 1 : 0; }
      this._clearance(P, this.bonus[dom] || 0, this.clear[dom], win);
    }
  }
  cellOf(x, y) { const C = this.cell, o = this.off, i = Math.min(this.gw - 1, Math.max(0, Math.floor((x + o) / C))), j = Math.min(this.gh - 1, Math.max(0, Math.floor((y + o) / C))); return j * this.gw + i; }
  centre(k) { const C = this.cell, o = this.off; return [((k % this.gw) + 0.5) * C - o, (Math.floor(k / this.gw) + 0.5) * C - o]; }
  ok(dom, k, r) { return dom === 'air' || (this.pass[dom][k] && this.clear[dom][k] >= r); }
  okAt(dom, x, y, r) { if (x < 0 || y < 0 || x >= this.T.W || y >= this.T.H) return false; return this.ok(dom, this.cellOf(x, y), r); }
  // nearest cell to (x, y) that a unit of radius r may occupy (BFS ring search)
  nearestOk(dom, x, y, r, maxR = 200, label = 0) {
    const L = label ? this.labels(dom) : null, okL = (k) => this.ok(dom, k, r) && (!L || L[k] === label);
    const k0 = this.cellOf(x, y); if (okL(k0)) return [x, y];
    const i0 = k0 % this.gw, j0 = Math.floor(k0 / this.gw), gw = this.gw, gh = this.gh;
    const radMax = Math.min(Math.ceil(maxR / this.cell), Math.max(gw, gh) + 1);
    for (let rad = 1; rad * this.cell < maxR && rad <= radMax; rad++) {
      // only the ring's perimeter (8·rad cells), visited in the same row-major order as a full square scan would
      let best = -1, bd = 1e9;
      for (let dj = -rad; dj <= rad; dj++) { const j = j0 + dj; if (j < 0 || j >= gh) continue; const edge = dj === -rad || dj === rad, step = edge ? 1 : 2 * rad;
        for (let di = -rad; di <= rad; di += step) { const i = i0 + di; if (i < 0 || i >= gw) continue; const k = j * gw + i;
          if (okL(k)) { const dd = di * di + dj * dj; if (dd < bd) { bd = dd; best = k; } } } }
      if (best >= 0) return this.centre(best);
    }
    return null;
  }
  /** region id (labels) of the cell a unit of radius r at (x, y) stands on, or 0 */
  regionAt(dom, x, y, r = 0) { if (dom === 'air') return 1; const L = this.labels(dom); const k = this.cellOf(x, y); if (L[k]) return L[k]; const q = this.nearestOk(dom, x, y, r, 60); return q ? L[this.cellOf(q[0], q[1])] : 0; }
  /** can a unit of this domain get from a to b (same connected region)? Cheap after the first call per footprint change */
  reachable(dom, ax, ay, bx, by, r = 0) { if (dom === 'air') return true; const a = this.regionAt(dom, ax, ay, r), b = this.regionAt(dom, bx, by, r); return a > 0 && a === b; }
  /** the point of region `label` nearest to (gx, gy) for a unit of radius r: where a unit goes for a goal it cannot reach.
   * Cached per 16 m block of the goal until the regions change (a placed or removed footprint), so repeated orders to an
   * unreachable goal cost a lookup instead of a search across the map */
  retarget(dom, label, gx, gy, r) {
    const B = 16, key = `${dom}|${label}|${Math.round(r * 4)}|${Math.floor(gx / B)},${Math.floor(gy / B)}`, C = this.rtc || (this.rtc = new Map());
    if (C.has(key)) return C.get(key);
    const big = Math.max(this.gw, this.gh) * this.cell * 1.5;
    const q = this.nearestOk(dom, gx, gy, r, 900, label) || this.nearestOk(dom, gx, gy, r, big, label);   // always inside the region: never a flood fill towards an unreachable goal
    if (C.size > 4000) C.clear(); C.set(key, q); return q;
  }
  /** connected regions of a domain (4-neighbour flood over cells passable at the domain's label radius); 0 = blocked */
  labels(dom) {
    if (this.lab[dom]) return this.lab[dom];
    const { gw, gh } = this, P = this.pass[dom], C = this.clear[dom], r = this.labR[dom] || 0, L = new Int32Array(gw * gh), st = new Int32Array(gw * gh); let id = 0;
    for (let k0 = 0; k0 < L.length; k0++) {
      if (L[k0] || !P[k0] || C[k0] < r) continue; id++; let sp = 0; st[sp++] = k0; L[k0] = id;
      while (sp) { const k = st[--sp], i = k % gw, j = (k / gw) | 0;
        if (i > 0) { const q = k - 1; if (!L[q] && P[q] && C[q] >= r) { L[q] = id; st[sp++] = q; } }
        if (i < gw - 1) { const q = k + 1; if (!L[q] && P[q] && C[q] >= r) { L[q] = id; st[sp++] = q; } }
        if (j > 0) { const q = k - gw; if (!L[q] && P[q] && C[q] >= r) { L[q] = id; st[sp++] = q; } }
        if (j < gh - 1) { const q = k + gw; if (!L[q] && P[q] && C[q] >= r) { L[q] = id; st[sp++] = q; } } }
    }
    return (this.lab[dom] = L);
  }
  // straight-line passability at 1 m steps for a unit of radius r
  lineOk(dom, ax, ay, bx, by, r) {
    if (dom === 'air') return true;
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 1.0));
    for (let s = 0; s <= n; s++) { const t = s / n; if (!this.okAt(dom, ax + (bx - ax) * t, ay + (by - ay) * t, r)) return false; }
    return true;
  }
  // A* → smoothed waypoint list [[x, y], ...] (excluding the start). If the goal is unreachable, goes to the reachable
  // cell closest to it. pref = preferred clearance (cost rises inside it, keeping big hulls off the banks).
  path(dom, sx, sy, gx, gy, r, pref = 0) {
    if (dom === 'air') return { pts: [[gx, gy]], reached: true };
    const g0 = this.nearestOk(dom, gx, gy, r); if (!g0) return { pts: [], reached: false };
    let s0 = this.okAt(dom, sx, sy, r) ? [sx, sy] : this.nearestOk(dom, sx, sy, r, 60); if (!s0) return { pts: [], reached: false };
    let unreach = false;
    if (this.useLabels) { const L = this.labels(dom), ls = L[this.cellOf(s0[0], s0[1])]; if (ls > 0 && L[this.cellOf(g0[0], g0[1])] !== ls) { unreach = true; const q = this.retarget(dom, ls, gx, gy, r); if (q) { g0[0] = q[0]; g0[1] = q[1]; } } }
    if (this.lineOk(dom, s0[0], s0[1], g0[0], g0[1], r)) return { pts: [[g0[0], g0[1]]], reached: !unreach && Math.hypot(g0[0] - gx, g0[1] - gy) < 3, goal: g0, unreach };
    const { gw, gh } = this, CELL = this.cell; const run = ++this.run; const start = this.cellOf(s0[0], s0[1]), goal = this.cellOf(g0[0], g0[1]);
    const P = this.pass[dom], C = this.clear[dom], G = this.g, F = this.from, H = this.heap; H.n = 0;
    const hx = goal % gw, hy = Math.floor(goal / gw);
    const heur = (k) => { const dx = Math.abs((k % gw) - hx), dy = Math.abs(Math.floor(k / gw) - hy); return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * CELL; };
    G[start] = 0; F[start] = -1; this.stamp[start] = run; H.push(start, heur(start));
    let best = start, bestH = heur(start), found = false, iter = 0;
    const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (H.n > 0 && iter++ < this.maxIter) {
      const k = H.pop(); if (this.closed[k] === run) continue; this.closed[k] = run;
      if (k === goal) { found = true; break; }
      const hk = heur(k); if (hk < bestH) { bestH = hk; best = k; }
      const i = k % gw, j = Math.floor(k / gw);
      for (const [di, dj, c] of N8) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue; const nk = nj * gw + ni;
        if (!P[nk] || C[nk] < r || this.closed[nk] === run) continue;
        if (di && dj && (!P[j * gw + ni] || !P[nj * gw + i] || C[j * gw + ni] < r || C[nj * gw + i] < r)) continue; // no corner cutting
        const pen = pref > r && C[nk] < pref ? (pref - C[nk]) / (pref - r) * 1.5 : 0;
        const ng = G[k] + c * CELL * (1 + pen);
        if (this.stamp[nk] !== run || ng < G[nk]) { this.stamp[nk] = run; G[nk] = ng; F[nk] = k; H.push(nk, ng + 1.25 * heur(nk)); }   // weighted A* (ε = 1.25): far fewer expansions, path ≤ 25 % longer before smoothing
      }
    }
    const end = found ? goal : best; const cells = [];
    for (let k = end; k !== -1; k = F[k]) { cells.push(k); if (k === start) break; }
    cells.reverse();
    const raw = cells.map((k) => this.centre(k)); if (found) raw[raw.length - 1] = [g0[0], g0[1]];
    // string pulling
    const pts = []; let cur = s0, idx = 0;
    while (idx < raw.length - 1) {
      let far = idx + 1;
      for (let t = Math.min(raw.length - 1, idx + this.pullWin); t > idx + 1; t--) if (this.lineOk(dom, cur[0], cur[1], raw[t][0], raw[t][1], r)) { far = t; break; }
      pts.push(raw[far]); cur = raw[far]; idx = far;
    }
    if (!pts.length && raw.length) pts.push(raw[raw.length - 1]);
    return { pts, reached: !unreach && found && Math.hypot(g0[0] - gx, g0[1] - gy) < 3, goal: g0, unreach };
  }
}
