// Ore fields (round 1 playtest): RA2-style ore around each extraction rig (the "ore mine", the field's source point).
// A field is a scatter of patches on the 4 m nav grid. Harvesters load from one patch at a time and move to the next
// patch by themselves; an empty field sends them to the next field. Fields deplete, then regrow from the rig outward
// at a fraction of the extraction rate, up to their starting amount.
//
// Numbers (data/economy.json):
//   field totals by kind (home / expansion / contested); patch richness falls off from the rig to the field's edge.
//   regrowth per field = regrow_share × one harvester's loading rate (capacity / load_s = 500 / 10 s = 50 credits per
//   game second), so the default 5 % gives 2.5 credits per game second per field (one harvester load in 200 game s).
//   The slider scales regrow_share from 0 to 4× (0–20 %).
//   Spreading: ore only comes back on a patch whose inner neighbour (toward the rig) holds at least spread_min of its own
//   maximum, or that touches the rig; each patch refills at most at patch_rate of its maximum per game second, so the
//   regrowth creeps outward ring by ring instead of refilling the whole field at once.

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export class OreFields {
  /** T: terrain; nav: World nav; deposits: game deposit objects (pos = rig centre, kind); E: economy settings; rigs: [[x, y, rot]] */
  constructor(T, nav, deposits, E, rigs = []) {
    this.E = E; this.fields = []; this.version = 0; this.regrowScale = 1; this.cellSize = nav.cell;
    const taken = new Set();
    for (const d of deposits) {
      const R = E.field_radius_m, src = d.pos, rand = rng(hash(d.id)), cells = [];
      const rig = rigs.reduce((a, r) => (Math.hypot(r[0] - src[0], r[1] - src[1]) < (a ? Math.hypot(a[0] - src[0], a[1] - src[1]) : 40) ? r : a), null) || [src[0], src[1], 0];
      const rc = Math.cos(rig[2] || 0), rs = Math.sin(rig[2] || 0), onRig = (x, y) => { const lx = (x - rig[0]) * rc + (y - rig[1]) * rs, ly = -(x - rig[0]) * rs + (y - rig[1]) * rc; return Math.abs(lx) < 8 + E.rig_clear_m && Math.abs(ly) < 6 + E.rig_clear_m; };
      const k0 = nav.cellOf(src[0], src[1]), gw = nav.gw, i0 = k0 % gw, j0 = Math.floor(k0 / gw), n = Math.ceil(R / nav.cell) + 1;
      for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
        const k = (j0 + dj) * gw + (i0 + di); if (k < 0 || k >= nav.gw * nav.gh || taken.has(k)) continue;
        const [x, y] = nav.centre(k), r = Math.hypot(x - src[0], y - src[1]); if (r > R || onRig(x, y)) continue;
        if (!nav.ok('veh', k, E.harvester_clear_m) || T.height(x, y) < 0.2) continue;
        const f = r / R; if (rand() < E.edge_gaps * f * f) continue;   // scattered edge: more gaps toward the rim
        const w = (1 - E.falloff * Math.pow(f, 1.5)) * (1 + E.noise * (rand() * 2 - 1));
        cells.push({ k, x, y, r, w, amt: 0, max: 0, busy: null, field: null, ox: (rand() - 0.5) * 1.6, oy: (rand() - 0.5) * 1.6, rot: rand() * 6.283 }); taken.add(k);
      }
      const total = E.field_total[d.kind] || E.field_total.home, W = cells.reduce((a, c) => a + c.w, 0) || 1;
      cells.sort((a, b) => a.r - b.r);
      const byK = new Map(cells.map((c) => [c.k, c]));
      for (const c of cells) { c.max = c.amt = total * c.w / W; // inner neighbour: the 8-neighbour closest to the rig (spreading parent)
        let best = null; for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) { const q = byK.get(c.k + dj * gw + di); if (q && q.r < c.r - 0.5 && (!best || q.r < best.r)) best = q; }
        c.parent = best; }
      const F = { id: d.id, dep: d, src, cells, total, ore: total, rig };
      for (const c of cells) c.field = F; d.field = F; d.ore = total; d.svc = cells.length ? [cells[0].x, cells[0].y] : d.svc;
      this.fields.push(F);
    }
  }
  /** regrowth for dt game seconds */
  tick(dt) {
    const E = this.E, budget0 = E.regrow_share * this.regrowScale * E.load_rate * dt; if (budget0 <= 0) return;
    for (const F of this.fields) {
      if (F.ore >= F.total - 1e-6) continue; let b = budget0;
      for (const c of F.cells) {   // nearest the rig first: the regrowth front moves outward
        if (b <= 0) break; if (c.amt >= c.max - 1e-6) continue;
        if (c.parent && c.parent.amt < E.spread_min * c.parent.max && c.r > E.core_m) continue;
        const add = Math.min(b, c.max - c.amt, c.max * E.patch_rate * dt); if (add <= 0) continue;
        const was = c.amt; c.amt += add; F.ore += add; b -= add; if (was < 1 && c.amt >= 1) this.version++;
      }
      F.dep.ore = F.ore; this.dirty = true;
    }
  }
  /** nearest patch with ore in field F from point p that no other harvester holds (null: the field is empty) */
  patch(u, F, p) {
    let best = null, bc = 1e18; for (const c of F.cells) { if (c.amt < this.E.min_patch || (c.busy != null && c.busy !== u.id)) continue; const d = Math.hypot(c.x - p[0], c.y - p[1]); if (d < bc) { bc = d; best = c; } }
    if (!best) { // every patch is held: share the nearest one rather than wait
      for (const c of F.cells) { if (c.amt < this.E.min_patch) continue; const d = Math.hypot(c.x - p[0], c.y - p[1]); if (d < bc) { bc = d; best = c; } } }
    return best;
  }
  hasPatch(F) { const m = this.E.min_patch; for (const c of F.cells) if (c.amt >= m) return true; return false; }
  take(c, amount) { const got = Math.min(amount, c.amt); c.amt -= got; c.field.ore -= got; c.field.dep.ore = c.field.ore; this.dirty = true; if (c.amt < this.E.min_patch && got > 0) this.version++; return got; }
  fieldAt(x, y, r = 6) {
    for (const F of this.fields) { if (Math.hypot(F.src[0] - x, F.src[1] - y) > this.E.field_radius_m + r) continue; for (const c of F.cells) if (Math.hypot(c.x - x, c.y - y) < r) return { F, c }; if (Math.hypot(F.src[0] - x, F.src[1] - y) < 14) return { F, c: null }; }
    return null;
  }
}

/** engine hooks for patch harvesting (World.hooks.harvestPatch / harvestTake / harvestRelease) */
export function oreHooks(ore) {
  return {
    harvestPatch: (u, dep, from) => { const F = dep.field; if (!F) return null; const c = ore.patch(u, F, from || [u.x, u.y]); if (!c) return null; c.busy = u.id; return { x: c.x, y: c.y, cell: c }; },
    harvestTake: (u, patch, amount) => ore.take(patch.cell, amount),
    harvestRelease: (u, patch) => { if (patch && patch.cell && patch.cell.busy === u.id) patch.cell.busy = null; },
  };
}
