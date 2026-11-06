// Thunderhead Stage 2 game layer on top of the engine's World (mech.js): players, credits, power, structures, production
// queues, placement rules, unit spawning through real doors, refinery docks for harvesters, rally points, win / lose.
// Runs once per simulation tick (game time), after world.step().
import { RULES, STRUCTURES, FACTIONS, BUILDING_FOR, CATEGORY_OF } from './rules.js';

const D90 = Math.PI / 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** local (x, y) in a structure's model axes → world, for rotation rot (multiples of 90°) */
export const toWorld = (b, lx, ly) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [b.x + c * lx - s * ly, b.y + s * lx + c * ly]; };
const rectOf = (x, y, rot, w, d) => { const q = Math.abs(Math.sin(rot)) > 0.5; return { x, y, w: q ? d : w, d: q ? w : d }; };
const rectGap = (a, b) => Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.y - b.y) - (a.d + b.d) / 2);

export class Game {
  /**
   * world: engine World on the game map; T: map terrain (mapdata.js); setup: { players: [{ faction, isAI, name, start: pad }], deposits, dockSites }
   * events emitted to `this.events` for the UI / audio: { type, player, ... }
   */
  constructor({ world, T, players, deposits, dockSites, pace }) {
    this.world = world; this.T = T; this.pace = pace; this.t = 0; this.events = []; this.over = null;
    this.deposits = deposits.map((d) => ({ ...d, svc: d.service_point, ore: d.ore ?? 100000, busy: null }));
    this.dockSites = dockSites || [];
    this.players = players.map((p, i) => ({
      id: i, team: p.team ?? i, faction: p.faction, name: p.name || FACTIONS[p.faction].name, isAI: !!p.isAI, color: p.color || FACTIONS[p.faction].color,
      credits: RULES.startCredits, shown: RULES.startCredits, power: { made: 0, used: 0 }, start: p.start,
      queues: { structure: [], infantry: [], vehicle: [], air: [], naval: [] }, ready: null, primary: {}, lost: false,
      stats: { built: 0, lostUnits: 0, killed: 0, harvested: 0 }, lowPowerWarned: false, fundsWarned: 0,
    }));
    this.nextItem = 1;
    world.hooks = { harvestDock: (u) => this.bestDock(u), harvestDepleted: (u) => this.nextDeposit(u) };
  }
  emit(type, o = {}) { this.events.push(Object.assign({ type, t: this.t, seq: this.seq = (this.seq || 0) + 1 }, o)); }
  /** events after seq (the UI / audio keep their own cursor) */
  since(seq) { const out = []; for (let i = this.events.length - 1; i >= 0 && this.events[i].seq > seq; i--) out.push(this.events[i]); return out.reverse(); }
  structures(p) { return this.world.buildings.filter((b) => b.alive && b.owner === p.id); }
  has(p, kind) { return this.structures(p).some((b) => b.kind === kind); }
  /** a player's own units (allies share a team id for vision and targeting, so ownership goes by owner) */
  ownerOf(o) { return this.players[o.owner != null ? o.owner : this.players.findIndex((q) => q.team === o.team)] || null; }
  unitsOf(p) { return this.world.units.filter((u) => u.alive && (u.owner != null ? u.owner === p.id : u.team === p.team)); }
  enemiesOf(p) { return this.players.filter((q) => q.team !== p.team && !q.lost); }

  // ───────────── structures ─────────────
  /** start structure (no cost): the construction yard at the player's start pad */
  addStart(p, kind, x, y, rot = 0) { return this._spawnStructure(p, kind, x, y, rot, true); }
  _spawnStructure(p, kind, x, y, rot, instant = false) {
    const S = STRUCTURES[kind], r = rectOf(x, y, rot, S.size[0], S.size[1]);
    const blocks = (S.blocks || [[0, 0, S.size[0], S.size[1]]]).map(([lx, ly, w, d]) => { const [wx, wy] = toWorld({ x, y, rot }, lx, ly); return rectOf(wx, wy, rot, w, d); });
    const z = S.naval ? 0 : this._padHeight(r);
    const b = this.world.placeBuilding({ name: S.name, kind, owner: p.id, team: p.team, x, y, z, rot, w: r.w, d: r.d, hp: S.hp, cost: S.cost, power: S.power, model: S.model, h: S.h, blocks: S.naval ? [] : blocks, noFootprint: !!S.naval });
    b.z = z; b.born = instant ? -10 : this.t; b.rally = null;
    if (S.dock) { const g = toWorld(b, ...S.dock.grate), a = toWorld(b, ...S.dock.approach); b.dock = { grate: g, approach: a, face: Math.atan2(a[1] - g[1], a[0] - g[0]), busy: null, refinery: b.id }; }
    if (S.pad) b.pad = { pos: toWorld(b, ...S.pad), occupant: null, id: b.id };
    if (!instant) { p.stats.built++; this.emit('built', { player: p.id, kind, id: b.id }); }
    if (S.freeUnit && !instant) this._spawnHarvesterAtDock(p, b);
    this._power(p); return b;
  }
  _padHeight(r) { // structures sit on the highest ground under their footprint (foundations sink into the rest)
    let hi = -1e9; for (let x = r.x - r.w / 2; x <= r.x + r.w / 2 + 0.01; x += 4) for (let y = r.y - r.d / 2; y <= r.y + r.d / 2 + 0.01; y += 4) hi = Math.max(hi, this.T.height(x, y)); return hi;
  }
  /** best orientation: refinery bays face the nearest ore field, doors face the middle of the map, docks use their site */
  autoRot(p, kind, x, y) {
    const S = STRUCTURES[kind]; let want;
    if (S.dock) { const d = this.deposits.filter((q) => q.ore > 0).sort((a, b) => Math.hypot(a.svc[0] - x, a.svc[1] - y) - Math.hypot(b.svc[0] - x, b.svc[1] - y))[0]; want = d ? Math.atan2(d.svc[1] - y, d.svc[0] - x) - D90 : 0; }   // model +y toward the field
    else if (S.exit) want = Math.atan2(this.T.H / 2 - y, this.T.W / 2 - x) + D90;   // model −y (door) toward the map centre
    else return 0;
    return Math.round(wrap(want) / D90) * D90;
  }
  /** a structure's keep-clear lanes in world space: { rect (axis-aligned), dom, end: [x, y] } */
  lanesOf(kind, x, y, rot) {
    const S = STRUCTURES[kind], b = { x, y, rot }; return (S.lanes || []).map((L) => { const [ax, ay] = toWorld(b, L.x, L.y0), [ex, ey] = toWorld(b, L.x, L.y1);
      const len = Math.abs(L.y1 - L.y0), q = Math.abs(Math.sin(rot)) > 0.5; return { rect: { x: (ax + ex) / 2, y: (ay + ey) / 2, w: q ? len : L.w, d: q ? L.w : len }, dom: L.dom, end: [ex, ey] }; });
  }
  /** lanes of every standing structure (cached until the set of structures changes) */
  _allLanes() {
    const key = this.world.buildings.filter((b) => b.alive).map((b) => b.id).join(',');
    if (this._lanesKey !== key) { this._lanesKey = key; this._lanes = []; for (const b of this.world.buildings) if (b.alive && STRUCTURES[b.kind]) for (const L of this.lanesOf(b.kind, b.x, b.y, b.rot)) this._lanes.push({ ...L, b }); }
    return this._lanes;
  }
  /** lanes stay usable: the candidate covers no lane; its own lanes lie on open ground clear of other structures; and with
   * its footprint stamped into the nav grid, every lane end of the player's base that reached the yard still does */
  _laneCheck(p, kind, x, y, rot, rect) {
    const nav = this.world.nav, rects = (S0, x0, y0, r0) => (S0.blocks || [[0, 0, S0.size[0], S0.size[1]]]).map(([lx, ly, w, d]) => { const [wx, wy] = toWorld({ x: x0, y: y0, rot: r0 }, lx, ly); return rectOf(wx, wy, r0, w, d); });
    const S = STRUCTURES[kind], mine = rects(S, x, y, rot);
    for (const L of this._allLanes()) if (mine.some((r) => rectGap(r, L.rect) < 0.5)) return `Blocks the ${L.b.kind === 'refinery' ? 'refinery dock' : (STRUCTURES[L.b.kind].name || 'structure').toLowerCase() + ' door'}`;
    const own = this.lanesOf(kind, x, y, rot);
    for (const L of own) {
      for (const b of this.world.buildings) if (b.alive && rectGap(L.rect, b) < 1) return S.dock ? 'Dock lane blocked by a structure' : 'Door blocked by a structure';
      const R = L.rect; for (let sx = R.x - R.w / 2 + 1; sx <= R.x + R.w / 2 - 1 + 0.01; sx += 2) for (let sy = R.y - R.d / 2 + 1; sy <= R.y + R.d / 2 - 1 + 0.01; sy += 2) {
        if (!nav.base[L.dom][nav.cellOf(sx, sy)]) return S.dock ? 'Dock lane is not open ground' : 'Door faces blocked ground'; }
    }
    // connectivity, judged before and after stamping the candidate (only lanes that reached the yard count)
    const yard = this.world.buildings.find((b) => b.alive && b.kind === 'yard' && b.owner === p.id); if (!yard) return null;
    const ref = this.lanesOf('yard', yard.x, yard.y, yard.rot)[0].end;
    const lanes = this._allLanes().filter((L) => L.b.owner === p.id && L.b !== yard).map((L) => ({ ...L, old: true })).concat(own);
    if (!lanes.length) return null;
    const lab = (dom, pt) => { const k = nav.cellOf(pt[0], pt[1]); const Lb = nav.labels(dom); if (Lb[k]) return Lb[k]; const q = nav.nearestOk(dom, pt[0], pt[1], 0.5, 12); return q ? Lb[nav.cellOf(q[0], q[1])] : 0; };
    const before = lanes.map((L) => L.old && lab(L.dom, L.end) && lab(L.dom, L.end) === lab(L.dom, ref));
    for (const r of mine) nav.footprint(r, true);
    let bad = null;
    try { lanes.forEach((L, i) => { if (bad) return; const ok = lab(L.dom, L.end) && lab(L.dom, L.end) === lab(L.dom, ref); if (!ok && (before[i] || !L.old)) bad = L.old ? `Cuts off the ${L.b.kind === 'refinery' ? 'refinery dock' : STRUCTURES[L.b.kind].name.toLowerCase() + ' door'}` : (S.dock ? 'Dock lane cannot be reached' : 'Door cannot be reached'); }); }
    finally { for (const r of mine) nav.footprint(r, false); }
    return bad;
  }
  /** placement check: returns { ok, reason, x, y, rot, rect } (x, y snapped to 2 m; naval yards snap to the player's dock site).
   * rot: a multiple of 90° chosen by the player (null = automatic: doors toward the map centre, refinery bays toward ore) */
  canPlace(p, kind, x, y, rotIn = null) {
    const S = STRUCTURES[kind]; x = Math.round(x / 2) * 2; y = Math.round(y / 2) * 2;
    const key = `${p.id}|${kind}|${x}|${y}|${rotIn}|${this.world.buildings.length}|${this._allLanes().length}|${this.world.units.length}`;
    if (this._pcKey === key) return this._pc;
    const res = this._canPlace(p, kind, x, y, rotIn); this._pcKey = key; this._pc = res; return res;
  }
  _canPlace(p, kind, x, y, rotIn) {
    const S = STRUCTURES[kind];
    let rot = rotIn == null ? this.autoRot(p, kind, x, y) : Math.round(wrap(rotIn) / D90) * D90;
    if (S.naval) {
      const site = this.dockSites.filter((s) => !this.world.buildings.some((b) => b.alive && b.kind === 'naval' && Math.hypot(b.x - s.water_center[0], b.y - s.water_center[1]) < 5))
        .sort((a, b) => Math.hypot(a.water_center[0] - x, a.water_center[1] - y) - Math.hypot(b.water_center[0] - x, b.water_center[1] - y))[0];
      if (!site || Math.hypot(site.water_center[0] - x, site.water_center[1] - y) > 140) return { ok: false, reason: 'Naval yards go on a dock site at the shore', x, y, rot, rect: rectOf(x, y, rot, ...S.size) };
      x = site.water_center[0]; y = site.water_center[1]; rot = site.rot;   // the pier's own frame: model −y (the berth) faces open water
      const rect = rectOf(x, y, rot, ...S.size); const mine = site.player && p.start.pad && site.player === p.start.pad.id;   // each start owns the dock on its spur road
      const near = mine || this.structures(p).some((b) => rectGap(rect, b) <= RULES.buildGap + 120);
      return near ? { ok: true, x, y, rot, rect, site } : { ok: false, reason: 'Too far from your base', x, y, rot, rect };
    }
    const rect = rectOf(x, y, rot, ...S.size), T = this.T, nav = this.world.nav;
    if (rect.x - rect.w / 2 < 4 || rect.y - rect.d / 2 < 4 || rect.x + rect.w / 2 > T.W - 4 || rect.y + rect.d / 2 > T.H - 4) return { ok: false, reason: 'Off the map', x, y, rot, rect };
    let lo = 1e9, hi = -1e9;
    for (let sx = rect.x - rect.w / 2 + 1; sx <= rect.x + rect.w / 2 - 1 + 0.01; sx += 2) for (let sy = rect.y - rect.d / 2 + 1; sy <= rect.y + rect.d / 2 - 1 + 0.01; sy += 2) {
      const h = T.height(sx, sy); lo = Math.min(lo, h); hi = Math.max(hi, h); const k = nav.cellOf(sx, sy);
      if (h < 0.3) return { ok: false, reason: 'Needs dry ground', x, y, rot, rect };
      if (!nav.base.foot[k]) return { ok: false, reason: 'Blocked ground', x, y, rot, rect };
    }
    if (hi - lo > RULES.maxSlope) return { ok: false, reason: 'Ground too uneven', x, y, rot, rect };
    for (const b of this.world.buildings) if (b.alive && rectGap(rect, b) < RULES.footprintGap) return { ok: false, reason: 'Too close to a structure', x, y, rot, rect };
    for (const d of this.deposits) if (Math.abs(d.pos[0] - x) < 25 + rect.w / 2 && Math.abs(d.pos[1] - y) < 25 + rect.d / 2) return { ok: false, reason: 'On an ore field', x, y, rot, rect };
    for (const u of this.world.units) if (u.alive && u.team !== p.team && u.dom !== 'air' && Math.abs(u.x - x) < rect.w / 2 + u.r && Math.abs(u.y - y) < rect.d / 2 + u.r) return { ok: false, reason: 'Enemy units in the way', x, y, rot, rect };
    if (!this.structures(p).some((b) => rectGap(rect, b) <= RULES.buildGap)) return { ok: false, reason: 'Outside your build radius', x, y, rot, rect };
    const lane = this._laneCheck(p, kind, x, y, rot, rect); if (lane) return { ok: false, reason: lane, x, y, rot, rect };
    return { ok: true, x, y, rot, rect };
  }
  /** place the structure that finished building (player.ready); rot as in canPlace */
  place(p, x, y, rot = null) {
    const it = p.ready; if (!it) return { ok: false, reason: 'Nothing ready' };
    const c = this.canPlace(p, it.key, x, y, rot); if (!c.ok) { this.emit('cannot_place', { player: p.id, reason: c.reason }); return c; }
    p.ready = null; p.queues.structure.shift(); this._spawnStructure(p, it.key, c.x, c.y, c.rot); return c;
  }

  // ───────────── production ─────────────
  available(p, cat, key) {
    if (cat === 'structure') { const S = STRUCTURES[key]; if (!S || S.buildable === false || !this.has(p, 'yard')) return false; return (S.requires || []).every((r) => this.has(p, r)); }
    if (key === 'A04' && !this.freePad(p) && !p.queues.air.some((q) => q.key === 'A04')) return false;   // one jet per airpad
    return FACTIONS[p.faction][cat].includes(key) && this.has(p, BUILDING_FOR[cat]);
  }
  options(p, cat) { return cat === 'structure' ? Object.keys(STRUCTURES).filter((k) => STRUCTURES[k].buildable !== false) : FACTIONS[p.faction][cat]; }
  costOf(cat, key) { return cat === 'structure' ? STRUCTURES[key].cost : this.world.spec[key].cost; }
  enqueue(p, cat, key, n = 1) {
    if (!this.available(p, cat, key)) return false; const Q = p.queues[cat];
    for (let k = 0; k < n; k++) { if (Q.length >= RULES.maxQueue || (cat === 'structure' && Q.length >= 1)) break; Q.push({ id: this.nextItem++, cat, key, cost: this.costOf(cat, key), spent: 0, onHold: false }); }
    this.emit('queued', { player: p.id, cat, key }); return true;
  }
  /** cancel the last queued item of `key` (or a specific item): every credit spent on it comes back */
  cancel(p, cat, key, itemId = null) {
    const Q = p.queues[cat]; let i = -1;
    for (let k = Q.length - 1; k >= 0; k--) if ((itemId != null ? Q[k].id === itemId : Q[k].key === key)) { i = k; break; }
    if (i < 0) return false; const it = Q[i]; p.credits += it.spent; Q.splice(i, 1); if (p.ready === it) p.ready = null;
    this.emit('cancelled', { player: p.id, cat, key: it.key, refund: it.spent }); return true;
  }
  _producers(p, cat) { const kind = BUILDING_FOR[cat]; return this.structures(p).filter((b) => b.kind === kind && this.t - b.born > 1); }
  _power(p) {
    let made = 0, used = 0; for (const b of this.structures(p)) { const pw = STRUCTURES[b.kind].power; if (pw > 0) made += pw * Math.max(0.25, b.hp / b.maxHp); else used -= pw; }
    const was = p.power.used > p.power.made; p.power = { made: Math.round(made), used }; const low = used > made;
    if (low && !was && this.t > 1) this.emit('low_power', { player: p.id });
  }
  _produce(p, dt) {
    const low = p.power.used > p.power.made;
    for (const cat of Object.keys(p.queues)) {
      const Q = p.queues[cat]; if (!Q.length) continue; const it = Q[0];
      if (cat === 'structure') { if (!this.has(p, 'yard')) continue; if (p.ready === it) continue; }
      else if (!this._producers(p, cat).length) continue;
      if (it.onHold) continue;
      const rate = RULES.buildRate * (low ? RULES.lowPowerRate : 1) * (cat === 'structure' ? 1 : Math.min(2, 1 + 0.5 * (this._producers(p, cat).length - 1)));
      const want = Math.min(rate * dt, it.cost - it.spent), pay = Math.min(want, p.credits);
      p.credits -= pay; it.spent += pay; it.stalled = pay + 1e-9 < want;
      if (it.stalled && this.t - p.fundsWarned > 12) { p.fundsWarned = this.t; this.emit('no_funds', { player: p.id }); }
      if (it.spent >= it.cost - 1e-6) {
        if (cat === 'structure') { p.ready = it; this.emit('structure_ready', { player: p.id, key: it.key }); }
        else { Q.shift(); this._deliver(p, cat, it.key); }
      }
    }
  }
  freePad(p) { const used = new Set(this.world.units.filter((u) => u.alive && u.jet && u.jet.pad).map((u) => u.jet.pad.id)); return this._producers(p, 'air').find((b) => !used.has(b.id)) || null; }
  _deliver(p, cat, uid) {
    const prods = this._producers(p, cat); let b = prods.find((x) => x.id === p.primary[cat]) || prods[0]; if (!b) return;
    if (uid === 'A04') { b = this.freePad(p); if (!b) { p.queues[cat].unshift({ id: this.nextItem++, cat, key: uid, cost: this.costOf(cat, uid), spent: this.costOf(cat, uid), onHold: false, waitPad: true }); return; } }   // jets need a free pad: wait finished
    const u = this.spawnFrom(b, uid); if (u) this.emit('unit_ready', { player: p.id, uid, id: u.id, cat });
  }
  /** a new unit comes out of building b: through the door (scripted roll-out), off the berth, or off the airpad */
  spawnFrom(b, uid) {
    const W = this.world, S = STRUCTURES[b.kind], p = this.players[b.owner]; const face = b.rot - D90;   // model −y in world
    let u;
    if (S.produces === 'air') {
      const [x, y] = b.pad.pos; const jet = W.spec[uid] && uid === 'A04';
      u = W.spawn(uid, p.team, x, y, { hdg: b.rot + D90, noSnap: true, pad: jet ? { x, y, id: b.id } : undefined });
    } else if (S.naval) {
      const [x, y] = toWorld(b, ...S.exit); u = W.spawn(uid, p.team, x, y, { hdg: face });
    } else {
      const [ix, iy] = toWorld(b, 0, -(STRUCTURES[b.kind].size[1] / 2) + 2), [ex, ey] = toWorld(b, ...S.exit);
      u = W.spawn(uid, p.team, ix, iy, { hdg: face, noSnap: true }); u.scripted = true; u.rollOut = { to: [ex, ey], b: b.id };
    }
    if (!u) return null; u.born = this.t; u.owner = p.id;
    u.afterSpawn = uid === 'HV' ? { harvest: true } : { rally: b.rally || toWorld(b, S.exit ? S.exit[0] : 0, (S.exit ? S.exit[1] : -20) - 14) };
    if (!u.rollOut) this._afterSpawn(u);
    return u;
  }
  _afterSpawn(u) {
    const a = u.afterSpawn; u.afterSpawn = null; if (!a) return;
    if (a.harvest) { const d = this.nextDeposit(u); const dock = this.bestDock(u); if (d && dock) this.world.harvest(u, d, dock); return; }
    if (a.rally) this.world.order(u, { type: u.dom === 'air' ? 'move' : 'attackMove', x: a.rally[0], y: a.rally[1] });
  }
  _rollOut(u, dt) { // drive straight out of the door at walking pace, then hand over to the simulation
    const [tx, ty] = u.rollOut.to, dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy), m = u.m;
    const vmax = Math.min(u.sp.speed_mps * 0.6, 4), acc = (m.accel || 3);
    u.v = Math.min(vmax, u.v + acc * dt, Math.sqrt(2 * acc * 1.6 * Math.max(0, d - 0.5)) + 0.6);
    const st = Math.min(d, u.v * dt); u.x += dx / (d || 1) * st; u.y += dy / (d || 1) * st; u.vx = u.v * Math.cos(u.hdg); u.vy = u.v * Math.sin(u.hdg);
    if (u.trackL != null) { u.trackL += st; u.trackR += st; } u.z = this.T.height(u.x, u.y);
    if (d < 0.6) { u.rollOut = null; u.scripted = false; u.v = Math.min(u.v, 2); this._afterSpawn(u); }
  }
  _spawnHarvesterAtDock(p, b) {
    const u = this.world.spawn('HV', p.team, b.dock.grate[0], b.dock.grate[1], { hdg: b.dock.face, noSnap: true, passive: true }); u.owner = p.id; u.born = this.t;
    const d = this.nextDeposit(u); if (d) this.world.harvest(u, d, b.dock);
  }

  // ───────────── harvesting ─────────────
  docksOf(owner) { return this.world.buildings.filter((b) => b.alive && b.dock && b.owner === owner && this.t - b.born > 1).map((b) => b.dock); }
  bestDock(u) { // nearest refinery, with a penalty for a busy bay so harvesters spread across refineries instead of queueing
    let best = null, bc = 1e18;
    for (const d of this.docksOf(u.owner != null ? u.owner : (this.ownerOf(u) || { id: -1 }).id)) { const c = Math.hypot(d.approach[0] - u.x, d.approach[1] - u.y) + (d.busy && d.busy !== u.id ? 160 : 0); if (c < bc) { bc = c; best = d; } }
    return best || (u.harv && u.harv.dock);
  }
  nextDeposit(u) { // nearest field with ore, preferring ones no other harvester of the team is working
    const working = new Map(); for (const h of this.world.units) if (h.alive && h.harv && h.team === u.team && h !== u && h.harv.dep) working.set(h.harv.dep.id, (working.get(h.harv.dep.id) || 0) + 1);
    // ore fields: the nearest one with a patch left (measured from the rig, the field's centre), never the one just emptied
    const cur = u.harv && u.harv.dep, has = (d) => (d.field && this.ore ? this.ore.hasPatch(d.field) : d.ore > 0);
    let best = null, bc = 1e18; for (const d of this.deposits) { if (!has(d) || (d === cur && u.harv && u.harv.state !== 'idle' && !this.ore.hasPatch(d.field || { cells: [] }))) continue; const at = d.field ? d.field.src : d.svc; const c = Math.hypot(at[0] - u.x, at[1] - u.y) + (working.get(d.id) || 0) * 120; if (c < bc) { bc = c; best = d; } }
    return best;
  }

  // ───────────── repair ─────────────
  /** wrench: start / stop repairing one of p's structures. Returns the new state, or null when it can't be repaired */
  toggleRepair(p, b) {
    if (!b || !b.alive || !b.isBuilding || b.owner !== p.id) return null;
    if (b.repairing) { b.repairing = false; this.emit('repair_stop', { player: p.id, id: b.id }); return false; }
    if (b.hp >= b.maxHp - 0.5) { this.emit('repair_full', { player: p.id, id: b.id }); return null; }
    b.repairing = true; this.emit('repair_start', { player: p.id, id: b.id }); return true;
  }
  repairCost(b, hp = b.maxHp - b.hp) { return (STRUCTURES[b.kind].cost * RULES.repairCost) * hp / b.maxHp; }
  _repair(p, dt) {
    for (const b of this.structures(p)) {
      if (!b.repairing) continue;
      if (b.hp >= b.maxHp - 1e-6) { b.repairing = false; b.hp = b.maxHp; this.emit('repair_done', { player: p.id, id: b.id }); continue; }
      const want = Math.min(b.maxHp / RULES.repairTime * dt, b.maxHp - b.hp), cost = this.repairCost(b, want);
      if (p.credits < cost) { b.repairStalled = true; if (this.t - p.fundsWarned > 12) { p.fundsWarned = this.t; this.emit('no_funds', { player: p.id }); } continue; }
      p.credits -= cost; b.hp += want; b.repairStalled = false; p.stats.repairSpent = (p.stats.repairSpent || 0) + cost;
    }
  }

  // ───────────── per tick ─────────────
  tick(dt) {
    this.t += dt; const W = this.world;
    if (this.events.length > 400 || (this.events.length && this.t - this.events[0].t > 20)) this.events = this.events.filter((e) => this.t - e.t <= 20);
    for (const e of W.events) {
      if (e.type === 'engineer_enter') { const b = W.byId.get(e.b); if (b && b.alive) { const p = this.players[b.owner]; b.hp = b.maxHp; b.repairing = false; this._power(p); this.emit('engineer_repair', { player: p.id, id: b.id, x: b.x, y: b.y }); } }
      if (e.type === 'harvest_cycle' && e.amount) { const h = W.byId.get(e.id), p = h ? this.ownerOf(h) : this.players[e.team]; if (p) { p.credits += e.amount; p.stats.harvested += e.amount; } }
      if (e.type === 'death') { const o = W.byId.get(e.id); if (!o) continue; const p = this.ownerOf(o); if (!p) continue;
        if (o.isBuilding) { this._power(p); this.emit('structure_lost', { player: p.id, kind: o.kind, id: o.id, x: o.x, y: o.y });
          if (p.ready && !this.has(p, 'yard')) { /* keeps the finished structure; it can be placed once a yard exists */ } }
        else { p.stats.lostUnits++; this.emit('unit_lost', { player: p.id, uid: o.uid, x: o.x, y: o.y }); } }
      if (e.type === 'damage') { const o = W.byId.get(e.id); if (o) o.lastHitT = this.t; }
      if (e.type === 'damage' && e.src != null) { const o = W.byId.get(e.id), s = W.byId.get(e.src);   // at most one alert per victim per 2 s
        if (o && s && o.team !== s.team && o.team >= 0 && !(o.lastAlertT > this.t - 2)) { o.lastAlertT = this.t; const op = this.ownerOf(o); if (!op) continue; this.emit('under_attack', { player: op.id, x: o.x, y: o.y, building: !!o.isBuilding, harvester: o.uid === 'HV', id: o.id, src: s.id }); } }
    }
    for (const u of W.units) if (u.alive && u.rollOut) this._rollOut(u, dt);
    if (this.ore) { this.ore.tick(dt);   // harvesters that stopped for want of ore go back to work when some has regrown
      if ((this.tick5 = (this.tick5 || 0) + dt) > 5) { this.tick5 = 0; for (const u of W.units) if (u.alive && u.harv && u.harv.noOre && u.order.type === 'idle') { const d = this.nextDeposit(u), dock = this.bestDock(u); if (d && dock) { u.harv.noOre = false; W.harvest(u, d, dock); } } } }
    for (const p of this.players) {
      if (p.lost) continue; this._repair(p, dt); this._power(p); this._produce(p, dt);
      // credits counter ticks toward the real balance (fast for big jumps, never overshoots)
      const diff = p.credits - p.shown; p.shown += Math.sign(diff) * Math.min(Math.abs(diff), Math.max(40, Math.abs(diff) * 3) * dt);
      if (!this.structures(p).length) { p.lost = true; this.emit('defeated', { player: p.id }); }
    }
    const alive = this.players.filter((p) => !p.lost);
    const teams = new Set(alive.map((p) => p.team));   // last team standing wins (allies share a team)
    if (!this.over && teams.size <= 1 && new Set(this.players.map((p) => p.team)).size > 1) { this.over = { winner: alive[0] ? alive[0].id : null, team: alive[0] ? alive[0].team : null, t: this.t }; this.emit('game_over', this.over); }
  }
}
