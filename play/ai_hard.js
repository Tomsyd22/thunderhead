// Thunderhead Hard AI (round 2). Same rules, same economy and the same fog of war as the player: it only knows what its
// own units and structures can see (World.visible), plus public information every player has (the map's start pads, ore
// fields and dock sites on the minimap, and the opponent's faction from the lobby). No resource bonus, no build-time bonus,
// no map reveal.
//
// On top of the Normal AI's base building and upkeep (ai.js) it:
//   economy  — skips Normal's early radar / airpad / naval yard / spare power plants and puts that money into harvesters
//              and the army; a third refinery by an expansion field; second factory and barracks once it is banking
//   scouts   — sends its first infantry round the expansions and the enemy start, then keeps a memory of what it saw
//   counters — for each enemy unit type it has seen (weighted by value) it builds the unit that trades best against it
//              (damage × health per credit², with a range factor), so the army mirrors the enemy's mix
//   defends  — keeps the army at home until it out-values the enemy army it knows about; any enemy that comes near the
//              base meets the whole home army
//   attacks  — one concentrated force; big forces split into two prongs that wait for each other at flank points and
//              then close on the target together; production structures and the yard first; new units stream in as
//              reinforcements; when it runs out of known structures it sweeps the enemy's side of the map until it
//              finds the rest; it falls back if it is clearly outgunned
//   raids    — a small fast group hunts enemy harvesters at the fields it has seen them working
//   focus    — each engaged group picks one target at a time (the one it can kill fastest, worth the most) and shoots it
//              together, without chasing beyond weapon range
//   pulls back damaged units (under 30 % health) to the base before they die, then reuses them for defence
//   deploys  — deployable infantry (Helix MG teams) set up when an enemy is within machine-gun range
// Round 3 (2v1 and across water; none of this is active in a 1v1 on a map where the enemy can be reached by land, so the
// 1v1 tuning above is unchanged):
//   across water it scouts with its first aircraft or hovercraft, waits for a real force (10 units, 9000 credits) before
//   attacking when it faces several opponents, goes first for the opponent whose army can hurt its hovercraft least (from
//   what it has seen of each), approaches a naval yard from the water, raids harvesters with hovercraft, and does not keep
//   rebuilding a naval yard that keeps being sunk (3, 6, 12 game min waits)
//   outnumbered or across water, with enemy aircraft about: anti-air infantry may grow past the home-guard cap, stands
//   among the structures (yard first), and meets an air raid alone — the rest of the army neither stays home for it nor
//   is called back; two engineers wait by the yard for the yard or a war factory that is going down
//   several opponents: the enemy-army estimate counts only units of the opponent it is going for
import { STRUCTURES, FACTIONS } from './rules.js';
import { MECH } from './engine/mech.js';
import { AI } from './ai.js';

const CLASS = { infantry: 'infantry', light: 'light', medium: 'heavy', heavy: 'heavy', aircraft: 'air', air: 'air', ship: 'naval', naval: 'naval', structure: 'building' };
const TKEY = { naval: 'ship', air: 'aircraft' };   // spec armour name → combat-table column
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const HORDER = ['power', 'refinery', 'barracks', 'refinery', 'factory'];   // the core base; power plants come as demand needs them
const PRIO = { factory: 0, barracks: 10, yard: 60, airpad: 140, naval: 160, refinery: 180, radar: 220, power: 240 };   // target order (metres of detour it is worth)

export class HardAI extends AI {
  constructor(game, p, kitItems) {
    super(game, p, kitItems); this.level = 'hard';
    this.intel = { structs: new Map(), units: new Map(), harv: new Map() };   // last sightings: id → { x, y, t, ... }
    this.scout = null; this.scoutPlan = null; this.raid = new Set(); this.lastRaid = -999; this.op = null; this.retreating = new Set();
    this.focusPrev = new Map(); this.effCache = new Map(); this.killed = 0; this.lastDefend = -99; this.lastRecall = -999;
    this.home = [p.start.x, p.start.y];
    this.searched = new Map();   // sweep point "x,y" → game time we last looked there
    this.updateFront();
  }
  // ── opponents: every living player on another team (2v1 and free-for-all as well as 1v1) ──
  foes() { const g = this.g; return typeof AI.prototype.enemies === 'function' ? this.enemies() : g.players.filter((q) => q.team !== this.p.team && !q.lost); }
  landLinked(pt) { return this.reaches('veh', pt); }
  reaches(dom, pt) {   // can a unit of this movement domain get from our base to pt (public map info: the nav regions)
    const N = this.W.nav; if (!N || !N.labels || dom === 'air') return true; if (dom === 'ship') return false; const key = `${dom}:${pt[0] | 0},${pt[1] | 0}`; (this._link || (this._link = new Map()));
    if (!this._link.has(key)) { const L = N.labels(dom), a = N.nearestOk(dom, this.home[0], this.home[1], 3, 200), b = N.nearestOk(dom, pt[0], pt[1], 3, 200);
      this._link.set(key, !!(a && b && L[N.cellOf(a[0], a[1])] === L[N.cellOf(b[0], b[1])])); }
    return this._link.get(key);
  }
  domOf(uid) { const k = (MECH[uid] || {}).kind; return k === 'foot' ? 'foot' : k === 'hover' ? 'hover' : k === 'ship' ? 'ship' : k === 'heli' || k === 'jet' || k === 'drone' ? 'air' : 'veh'; }
  get enemyStart() { return this._front || this.home; }   // start pad of the opponent we're working on: the nearest one still alive
  updateFront() {
    const f = this.foes().map((q) => [q.start.x, q.start.y]).sort((a, b) => D(a, this.home) - D(b, this.home)); if (!f.length) return;
    // opponents our ground army can walk to (the map is public: its land regions are part of it); none → ships and aircraft
    const land = f.filter((e) => this.landLinked(e) || this.reaches('foot', e)); this.naval = !land.length;
    const reach = f.filter((e) => ['foot', 'veh', 'hover'].some((d) => this.reaches(d, e)));
    let pool = land.length ? land : reach.length ? reach : f; const fresh0 = pool.filter((e) => !(this.g.t - ((this.avoid || {})[e.join()] ?? -1e9) < 300));   // skip a base we just failed to crack, for a while
    // across water against several opponents: the one whose known army can hurt what we send across the least goes first
    // (distance breaks ties: 1 m ≈ 4 credits of their army)
    if (this.naval && f.length > 1 && this.intel) { const t = this.g.t, who = (e) => this.foes().find((q) => q.start.x === e[0] && q.start.y === e[1]);   // a unit's colours show whose it is
      const thr = (e) => { const q = who(e), A = q && this.armyOf && this.armyOf.get(q.id); let v = 0; if (A) for (const u of A.values()) if (u.hurts) v += u.cost; return v + 4 * D(e, this.home); };
      pool = pool.slice().sort((a, b) => thr(a) - thr(b));
      const cur = this._front && pool.find((e) => e.join() === this._front.join()); if (cur && thr(cur) < thr(pool[0]) + 2500) pool = [cur, ...pool.filter((e) => e !== cur)];   // no flip-flopping between two close calls
    }
    const fresh = this.naval && f.length > 1 ? pool.filter((e) => fresh0.includes(e)) : fresh0;
    const prev = this._front; this._front = (fresh.length ? fresh : pool)[0]; this.enemyStarts = f;
    if (prev && prev.join() !== this._front.join() && this.op) {   // one down (or a base we gave up on): regroup at home before the next
      const us = [...this.wave].map((id) => this.W.byId.get(id)).filter((u) => u && u.alive); this.op = null; this.wave.clear(); this.lastWave = this.g.t;
      if (us.length) this.W.orderGroup(us, { type: 'attackMove', x: this.stage[0], y: this.stage[1] }); }
    this.goDoms = new Set(['foot', 'veh', 'hover'].filter((d) => this.reaches(d, this._front)));   // ground units that can get to it (hovercraft cross water)
    // stage toward the middle of the living opponents (where their waves come from), a little in front of the base
    const m = [f.reduce((a, q) => a + q[0], 0) / f.length, f.reduce((a, q) => a + q[1], 0) / f.length], dx = m[0] - this.home[0], dy = m[1] - this.home[1], L = Math.hypot(dx, dy) || 1;
    this.toward = [dx / L, dy / L]; this.stage = this.landPoint([this.home[0] + dx / L * (this.naval ? 40 : 140), this.home[1] + dy / L * (this.naval ? 40 : 140)]);   // across water: guard the base itself (raids come by air)
  }
  get prongs() { return this.op && this.op.groups.length > 1 ? this.op : null; }
  think() {
    const g = this.g, p = this.p; if (p.lost || g.over) return;
    if (!this._front || (this._frontT || 0) < g.t - 10) { this._frontT = g.t; this.updateFront(); }
    this.observe(); this.trackLosses(); if (p.ready) this.placeReady();
    this.buildStructures(); this.expand(); this.produce(); this.repair();
    this.scoutThink(); this.retreat(); this.raidThink(); this.army(); this.fleetThink(); this.focusFire(); this.deployMicro();
  }
  get W() { return this.g.world; }
  enemyOf(o) { return o.team !== this.p.team && o.team >= 0; }
  armed(u) { return u.alive && u.sys && u.sys.length && u.uid !== 'HV' && !(u.m && u.m.engineer); }
  val(u) { return u.sp.cost * u.hp / u.maxHp; }

  // ── upkeep: Normal's wrench and engineer; outnumbered or across water with enemy aircraft about, two engineers wait by the
  // yard and go into the yard or a war factory that is going down (aircraft can knock the yard flat in seconds) ──
  repair() {
    const g = this.g, p = this.p, W = this.W;
    if (!((this.naval || this.foes().length > 1) && this.airThreat())) return super.repair();
    for (const b of this.structs) { const f = b.hp / b.maxHp; if (!b.repairing && f < 0.75 && p.credits > 1500) g.toggleRepair(p, b); else if (b.repairing && p.credits < 400 && f > 0.5) g.toggleRepair(p, b); }
    const F = FACTIONS[p.faction], eid = F.infantry.find((k) => W.spec[k] && !W.spec[k].weapons.length), eng = g.unitsOf(p).filter((u) => u.m.engineer && !u.rollOut), yard = this.structs.find((b) => b.kind === 'yard');
    if (eid && eng.length < 2 && g.has(p, 'barracks') && !p.queues.infantry.some((i) => i.key === eid) && p.credits > 600) { g.enqueue(p, 'infantry', eid); const q = p.queues.infantry; q.unshift(q.pop()); }
    const key = this.structs.filter((b) => (b.kind === 'yard' || b.kind === 'factory') && b.hp / b.maxHp < 0.5).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const worst = key || this.structs.filter((b) => b.hp / b.maxHp < 0.3).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const busy = eng.filter((u) => u.order.type === 'enter'), free = eng.filter((u) => u.order.type !== 'enter');
    if (worst && free.length && !busy.some((u) => u.order.building === worst.id) && (key || free.length > 1)) W.order(free.shift(), { type: 'enter', building: worst.id });   // the last one is kept for the yard
    if (yard) for (const u of free) if (!u.path && Math.hypot(u.x - yard.x, u.y - yard.y) > 30) W.order(u, { type: 'move', x: yard.x + 16, y: yard.y + 16 });
  }
  trackLosses() {   // our own naval yards sunk (we know our own losses): see wantStructure
    for (const e of this.g.events) if (e.type === 'structure_lost' && e.player === this.p.id && e.kind === 'naval' && e.seq > (this._navSeq || 0)) { this._navSeq = e.seq; this._navLosses = (this._navLosses || 0) + 1; this._navLostT = e.t; }
  }
  // ── intel: remember what our side sees ──
  observe() {
    const W = this.W, t = this.g.t, I = this.intel, me = this.p.team;
    for (const b of W.buildings) if (b.alive && this.enemyOf(b) && W.visible(me, b)) I.structs.set(b.id, { x: b.x, y: b.y, kind: b.kind, t });
    for (const [id, s] of I.structs) { const b = W.byId.get(id); if ((!b || !b.alive) && this.seesPoint(s.x, s.y)) { I.structs.delete(id); this.killed += (STRUCTURES[s.kind] || {}).cost || 0; } }   // gone when we look again
    this.visEnemies = [];
    for (const u of W.units) if (u.alive && !u.hidden && this.enemyOf(u) && W.visible(me, u)) {
      this.visEnemies.push(u);
      I.units.set(u.id, { x: u.x, y: u.y, uid: u.uid, armour: u.sp.armour_type || u.sp.armor, cost: u.sp.cost, t, armed: !!u.sys.length, owner: u.owner });
      if (u.uid === 'HV') I.harv.set(u.id, { x: u.x, y: u.y, t, dep: u.harv && u.harv.dep ? u.harv.dep.id : null });
    }
    // a unit we were watching a moment ago and is now dead died in front of us; anything else is forgotten when stale
    for (const [id, s] of I.units) { const u = W.byId.get(id); const dead = !u || !u.alive;
      if (dead && t - s.t <= 2) { I.units.delete(id); if (s.armed) this.killed += s.cost || 0; } else if (t - s.t > 240) I.units.delete(id); }
    // what each opponent has fielded that we have seen (kept until we see it die, or 10 min unseen): picks the front across water
    const A = this.armyOf || (this.armyOf = new Map());
    for (const u of this.visEnemies) if (u.sys.length && u.owner != null) { let m = A.get(u.owner); if (!m) A.set(u.owner, m = new Map()); m.set(u.id, { cost: u.sp.cost, t, hurts: this.hurts(u, 'hover') }); }
    for (const m of A.values()) for (const [id, s] of m) { const u = W.byId.get(id); if ((!u || !u.alive) && t - s.t <= 2 || t - s.t > 600) m.delete(id); }
    for (const [id, s] of I.harv) { const u = W.byId.get(id); if (((!u || !u.alive) && t - s.t <= 2) || t - s.t > 300) I.harv.delete(id); }
  }
  seesPoint(x, y) { return this.g.unitsOf(this.p).some((u) => Math.hypot(u.x - x, u.y - y) < (u.sp.sight_m || 30) * 0.8) || this.structs.some((b) => Math.hypot(b.x - x, b.y - y) < 40); }
  enemyArmyEstimate() {   // several opponents: only what we've seen around the one we're going for (the other's army is not in the way)
    const t = this.g.t, near = this.foes().length > 1 && this._front ? this._front : null, q = near && this.foes().find((o) => o.start.x === near[0] && o.start.y === near[1]); let s = 0;
    for (const u of this.intel.units.values()) if (u.armed && t - u.t < 200 && (!near || (q ? u.owner === q.id : D([u.x, u.y], near) < 700))) s += u.cost || 0; return s; }

  // ── base: Normal's order without the early luxuries; extra production once it is banking ──
  wantStructure() {
    const g = this.g, p = this.p, pw = p.power; if (p.queues.structure.length || p.ready) return null;
    if (pw.made - pw.used < 40 && this.count('power') < 10) return 'power';
    const need = {}; for (const k of HORDER) { need[k] = (need[k] || 0) + 1; if (this.count(k) < need[k]) return g.available(p, 'structure', k) ? k : null; }
    // a naval yard that keeps being sunk at its pier is not rebuilt straight away (each loss doubles the wait: 3, 6, 12 min)
    const navOk = !this._navLosses || g.t - this._navLostT > 180 * 2 ** Math.min(2, this._navLosses - 1);
    if (this.naval) {   // opponents across the water: a naval yard as soon as the core base stands, then aircraft, then a second yard
      const dock = navOk && g.dockSites.some((s) => this.nearMe(s.water_center, 800));
      if (dock && this.count('naval') < 1 && g.available(p, 'structure', 'naval')) return 'naval';
      if (p.credits > 1200) for (const k of ['radar', 'airpad']) if (this.count(k) < 1 && g.available(p, 'structure', k)) return k;
      if (dock && p.credits > 2500 && this.count('naval') < 2 && g.available(p, 'structure', 'naval')) return 'naval';
    }
    if (navOk && this.shipsSeen() && this.count('naval') < 1 && p.credits > 1500 && g.dockSites.some((s) => this.nearMe(s.water_center, 700)) && g.available(p, 'structure', 'naval')) return 'naval';
    if (p.credits > 2600 && g.t > 420) for (const [k, n] of [['factory', 2], ['barracks', 2]]) if (this.count(k) < n && g.available(p, 'structure', k)) return k;
    if (p.credits > 4000 && g.t > 900) for (const k of ['radar', 'airpad']) if (this.count(k) < 1 && g.available(p, 'structure', k)) return k;
    return null;
  }
  airThreat() { const t = this.g.t; for (const u of this.intel.units.values()) if (u.armed && (u.armour === 'aircraft' || u.armour === 'air') && t - u.t < 240) return true; return false; }
  shipsSeen() { for (const u of this.intel.units.values()) if (u.armour === 'naval' || u.armour === 'ship') return true; return false; }

  // ── economy: three refineries, the third by the nearest expansion field once home ore runs low ──
  expand() {
    const g = this.g, p = this.p, refs = this.structs.filter((b) => b.kind === 'refinery');
    if (!g.has(p, 'factory') || refs.length >= 4 || refs.length < 2 || p.queues.structure.length || p.ready || this.homeThreat) return;
    const home = g.deposits.filter((d) => d.nearest === p.start.pad.id), low = home.length && home.reduce((a, d) => a + (d.ore || 0), 0) < 0.4 * home.reduce((a, d) => a + (d.field ? d.field.total : 100000), 0);
    // third refinery once the home ore runs low (or from 8 game min); a fourth from 15 game min when there's a free field
    if (refs.length === 2 ? (low || g.t > 480) && p.credits > 2000 : g.t > 780 && p.credits > 1800 && this.expansionFields().length) { g.enqueue(p, 'structure', 'refinery'); this.wantExpansion = true; }
  }
  expansionFields() {   // fields with ore left, nearer us than any opponent, without one of our refineries by them yet
    const g = this.g, p = this.p, refs = this.structs.filter((b) => b.kind === 'refinery');
    return g.deposits.filter((d) => d.nearest !== p.start.pad.id && (d.ore || 0) > 3000 && (this.enemyStarts || []).every((e) => D(d.pos, this.home) < D(d.pos, e) * 0.95) && this.landLinked(d.pos) && !refs.some((b) => D([b.x, b.y], d.pos) < 170))
      .sort((a, b) => D(a.pos, this.home) - D(b.pos, this.home));
  }
  placeReady() {
    const g = this.g, p = this.p, kind = p.ready.key;
    if (kind === 'refinery' && this.wantExpansion) {   // the expansion refinery: as close to the richest reachable non-home field as the build radius allows
      const fields = this.expansionFields();
      for (const d of fields.slice(0, 3)) for (let r = 30; r < 160; r += 8) for (let a = 0; a < 16; a++) {
        const c = g.canPlace(p, kind, d.pos[0] + Math.cos(a / 16 * 6.283) * r, d.pos[1] + Math.sin(a / 16 * 6.283) * r); if (c.ok) { g.place(p, c.x, c.y); this.wantExpansion = false; return; } }
      this.wantExpansion = false;
    }
    super.placeReady();
  }

  // ── production: counter what we've seen ──
  weaponSets(uid, sp) {   // weapon index sets usable at once (deployables: mobile or deployed, never both)
    const m = MECH[uid], all = (sp.weapons || []).map((_, i) => i);
    return m && m.deploy ? [m.deploy.mobile, m.deploy.deployed] : [all];
  }
  wDps(w, armour) {
    const T = this.W.combat && this.W.combat.table, cls = CLASS[armour] || armour, col = TKEY[cls] || armour;
    if (w.targets && !w.targets.includes(cls)) return 0;
    const m = T && w.wtype && T[w.wtype] ? (T[w.wtype][col] ?? T[w.wtype][armour] ?? 0) : (w.multipliers[cls] || 0);
    return w.damage * (w.burst || 1) / Math.max(0.1, w.cycle_s + (w.burst > 1 ? (w.burst - 1) * (w.burst_gap_s || 0) : 0)) * m;
  }
  dpsVs(spec, armour, uid = spec.id) {   // best weapon-set dps against an armour class, and that set's reach (cached per unit type)
    const key = uid + '|' + armour, hit = this.dpsCache && this.dpsCache.get(key); if (hit) { this._reach = hit[1]; return hit[0]; }
    let best = 0, reach = 0;
    for (const set of this.weaponSets(uid, spec)) { let s = 0, r = 0; for (const i of set) { const w = spec.weapons[i]; if (!w) continue; const d = this.wDps(w, armour); if (d > 0) { s += d; r = Math.max(r, w.range_m); } }
      if (s > best) { best = s; reach = r; } }
    (this.dpsCache || (this.dpsCache = new Map())).set(key, [best, reach]); this._reach = reach; return best;
  }
  eff(a, b) {   // how well `a` trades against `b` for equal credits (Lanchester square: dps × hp / cost², with a range factor)
    const key = a + '>' + b; if (this.effCache.has(key)) return this.effCache.get(key);
    const W = this.W, A = W.spec[a], B = W.spec[b]; let r = 0;
    if (A && B) {
      const da = this.dpsVs(A, B.armour_type || B.armor, a), ra = this._reach, db = this.dpsVs(B, A.armour_type || A.armor, b), rb = this._reach;
      if (da <= 0) r = 0; else if (db <= 0) r = 4;
      else r = Math.min(4, (da * A.health / (A.cost * A.cost)) / (db * B.health / (B.cost * B.cost)) * Math.max(0.4, Math.min(2.5, Math.pow(ra / rb, 0.8))));
    }
    this.effCache.set(key, r); return r;
  }
  enemyMix() {   // value share by enemy unit type: what we've seen, topped up by the enemy faction's roster while we've seen little
    const mix = {}, t = this.g.t; let tot = 0;
    for (const u of this.intel.units.values()) if (u.armed && t - u.t < 240) { mix[u.uid] = (mix[u.uid] || 0) + (u.cost || 300); tot += u.cost || 300; }
    if (tot < 4000) { const ros = []; for (const q of this.foes()) { const F = FACTIONS[q.faction]; for (const k of [...F.infantry, ...F.vehicle, ...(this.naval ? [...F.air, ...F.naval] : [])]) if (this.W.spec[k] && this.W.spec[k].weapons.length) ros.push(k); }
      for (const k of ros) mix[k] = (mix[k] || 0) + (4000 - tot) / ros.length; }
    return mix;
  }
  composition(cands) {   // desired value share per candidate unit: each enemy type's share goes to its best counters
    const mix = this.enemyMix(), tot = Object.values(mix).reduce((a, b) => a + b, 0) || 1, want = {}; let used = 0;
    for (const [e, v] of Object.entries(mix)) {
      const isAir = /^(air|aircraft)$/.test(this.W.spec[e] ? this.W.spec[e].armour_type || this.W.spec[e].armor : '');
      const reach = (c) => !this.naval || isAir || c.cat === 'air' || c.cat === 'naval' || this.goDoms.has(this.domOf(c.k));   // across the water: ships, aircraft and hovercraft
      let effs = cands.map((c) => reach(c) ? this.eff(c.k, e) * (c.cat === 'air' ? 0.6 : 1) : 0), best = Math.max(...effs);
      if (best <= 0.05) { effs = cands.map((c) => this.eff(e, c.k) <= 0 ? 1 : 0); best = Math.max(...effs); if (!best) continue; }   // nothing hits it: build what it can't hurt
      const w = effs.map((x) => Math.max(0, x - 0.7 * best) ** 2), sw = w.reduce((a, b) => a + b, 0) || 1;
      cands.forEach((c, i) => { want[c.k] = (want[c.k] || 0) + v / tot * w[i] / sw; }); used += v / tot;
    }
    for (const k in want) want[k] /= used || 1;
    if (this.naval) {   // across water, keep a share of whatever can reach their base and knock down structures (else nothing can finish)
      const sg = cands.filter((c) => c.cat !== 'naval' && (c.cat === 'air' || this.goDoms.has(this.domOf(c.k))) && this.dpsVs(this.W.spec[c.k], 'structure', c.k) > 0).sort((a, b) => this.W.spec[b.k].health - this.W.spec[a.k].health)[0];
      if (sg) { for (const k in want) want[k] *= 0.6; want[sg.k] = (want[sg.k] || 0) + 0.4; }
    }
    return want;
  }
  produce() {
    const g = this.g, p = this.p, W = this.W, F = FACTIONS[p.faction], mine = g.unitsOf(p), harv = mine.filter((u) => u.uid === 'HV').length, refs = this.structs.filter((b) => b.kind === 'refinery').length;
    const vq = p.queues.vehicle, hvq = vq.filter((i) => i.key === 'HV').length, wantHv = Math.min(10, refs * 2 + 1);
    if (g.has(p, 'factory') && harv + hvq < wantHv && hvq < 1) { g.enqueue(p, 'vehicle', 'HV'); const i = vq.findIndex((x) => x.key === 'HV'); if (i > 0) vq.unshift(vq.splice(i, 1)[0]); }
    if (harv + hvq < Math.min(4, wantHv) && p.credits < 1200) return;
    if (hvq && g.t > 540 && p.credits < 1400 && !this.homeThreat) return;   // a harvester being bought: don't let new army orders starve it (queues pay in turn)
    const army = mine.filter((u) => u.uid !== 'HV' && !u.m.engineer); if (army.length > 56) return;
    const sq = p.queues.structure[0]; if (sq && !p.ready && p.credits < Math.min(1500, sq.cost - sq.spent)) return;
    const has = { infantry: g.has(p, 'barracks'), vehicle: g.has(p, 'factory'), air: g.has(p, 'airpad'), naval: g.has(p, 'naval') && (this.shipsSeen() || this.naval) };
    const cands = []; for (const cat of ['infantry', 'vehicle', 'air', 'naval']) if (has[cat]) for (const k of F[cat]) if (k !== 'HV' && W.spec[k] && W.spec[k].weapons.length && g.available(p, cat, k)) cands.push({ cat, k });
    // across water a small home guard is enough — except anti-air, which may keep growing while enemy aircraft are about
    const guardN = army.filter((u) => u.dom !== 'ship' && u.dom !== 'air' && !this.goDoms.has(u.dom)).length, aa = (k) => this.dpsVs(W.spec[k], 'aircraft', k) > 0;
    if (this.naval && guardN >= 12) for (let i = cands.length - 1; i >= 0; i--) if ((cands[i].cat === 'infantry' || cands[i].cat === 'vehicle') && !this.goDoms.has(this.domOf(cands[i].k)) && !(this.airThreat() && guardN < 45 && aa(cands[i].k))) cands.splice(i, 1);
    if (!cands.length) return;
    const want = this.composition(cands), have = {}; let tot = 0;
    for (const u of army) { have[u.uid] = (have[u.uid] || 0) + u.sp.cost; tot += u.sp.cost; }
    for (const cat of ['infantry', 'vehicle', 'air', 'naval']) for (const it of p.queues[cat]) if (it.key !== 'HV') { have[it.key] = (have[it.key] || 0) + it.cost; tot += it.cost; }
    const deficit = (k) => (want[k] || 0) - (have[k] || 0) / (tot + W.spec[k].cost);
    const ranked = cands.filter((c) => (want[c.k] || 0) > 0.03).sort((a, b) => deficit(b.k) - deficit(a.k)); if (!ranked.length) return;
    const top = ranked[0];
    // the most-needed unit always has its queue running; other queues only when there is money to spare (production pays
    // as it goes, so two starving queues would each build at half speed)
    for (const cat of ['infantry', 'vehicle', 'air', 'naval']) {
      const Q = p.queues[cat], armedQ = Q.filter((i) => i.key !== 'HV').length; if (!has[cat] || armedQ >= (p.credits > 3000 ? 2 : 1)) continue;
      const c = cat === top.cat ? top : ranked.find((x) => x.cat === cat); if (!c) continue;
      if (cat === top.cat ? p.credits > 50 : p.credits > g.costOf(cat, c.k) + 500) g.enqueue(p, cat, c.k);
    }
  }

  // ── scouting: the first rifleman tours the enemy start and the expansions ──
  scoutThink() {
    const g = this.g, W = this.W, p = this.p;
    if (this.scout != null) { const u = W.byId.get(this.scout); if (!u || !u.alive) { this.scout = null; this.scouted = true; return; }
      let next = false; if ((!u.path || u.dom === 'air') && Math.hypot(u.x - this.scoutPlan[0][0], u.y - this.scoutPlan[0][1]) < 30) { this.scoutPlan.shift(); next = true; }   // aircraft circle: near is there
      if (!this.scoutPlan.length) { this.scout = null; this.scouted = true; W.order(u, { type: 'move', x: this.stage[0], y: this.stage[1] }); return; }
      if (!u.path || next) W.order(u, { type: 'move', x: this.scoutPlan[0][0], y: this.scoutPlan[0][1] }); return; }
    if (this.scouted || g.t < 15) return;
    // across water: the first aircraft (or hovercraft) does the tour — infantry cannot get there
    const u = g.unitsOf(p).filter((q) => (this.naval ? q.dom === 'air' && q.kind !== 'jet' || q.dom === 'hover' : q.kind === 'foot') && q.sys.length && !q.rollOut).sort((a, b) => (b.dom === 'air') - (a.dom === 'air') || b.sp.speed_mps - a.sp.speed_mps)[0]; if (!u) return;
    this.scoutPlan = [];   // per opponent (nearest first): the expansions by its start, a point on its doorstep, its start
    for (const es of this.enemyStarts || [this.enemyStart]) { const ex = g.deposits.filter((d) => d.kind !== 'home').map((d) => d.pos).sort((a, b) => D(a, es) - D(b, es)).slice(0, 2);
      this.scoutPlan.push(...ex, [es[0] + (this.p.start.x - es[0]) * 0.2, es[1] + (this.p.start.y - es[1]) * 0.2], es); }
    this.scoutPlan = this.scoutPlan.filter((q) => u.dom === 'air' || this.reaches(u.dom, q)); if (!this.scoutPlan.length) { this.scouted = true; return; }   // only where it can get to
    this.scout = u.id; W.order(u, { type: 'move', x: this.scoutPlan[0][0], y: this.scoutPlan[0][1] });
  }

  // ── pull back: badly damaged units go home before they die ──
  retreat() {
    const W = this.W, home = this.home;
    for (const id of this.retreating) { const u = W.byId.get(id); if (!u || !u.alive) this.retreating.delete(id); }
    for (const u of this.g.unitsOf(this.p)) {
      if (u.uid === 'HV' || u.m.engineer || u.dom === 'ship' || u.kind === 'jet' || u.id === this.scout) continue;
      const f = u.hp / u.maxHp, near = D([u.x, u.y], home) < 140;
      if (!this.retreating.has(u.id) && f < 0.3 && !near && u.lastHitT != null && this.g.t - u.lastHitT < 3) { this.retreating.add(u.id); this.wave.delete(u.id); this.raid.delete(u.id); this.focusPrev.delete(u.id); W.order(u, { type: 'move', x: home[0] + (Math.random() - 0.5) * 50, y: home[1] + (Math.random() - 0.5) * 50 }); }
      else if (this.retreating.has(u.id) && near) { this.retreating.delete(u.id); W.order(u, { type: 'guard', x: u.x, y: u.y }); }
    }
  }

  // ── harvester raids: a few fast units at a field where enemy harvesters were seen ──
  raidThink() {
    const g = this.g, W = this.W; this.raid = new Set([...this.raid].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    if (this.raid.size) { const us = [...this.raid].map((id) => W.byId.get(id)); const hv = (this.visEnemies || []).filter((h) => h.alive && h.uid === 'HV');
      const c = this.centroid(us); const tgt = hv.sort((a, b) => D([a.x, a.y], c) - D([b.x, b.y], c))[0];
      const danger = (this.visEnemies || []).filter((e) => this.armed(e) && D([e.x, e.y], c) < 70).reduce((a, e) => a + e.sp.cost, 0);
      if (danger > us.reduce((a, u) => a + u.sp.cost, 0) * 1.2) { for (const u of us) { this.raid.delete(u.id); W.order(u, { type: 'move', x: this.stage[0], y: this.stage[1] }); } return; }   // outgunned: break off
      if (tgt) for (const u of us) if (u.target !== tgt.id) W.order(u, { type: 'attack', target: tgt.id });
      if (!tgt && us.every((u) => !u.path && u.target == null)) { const s = [...this.intel.harv.values()].sort((a, b) => b.t - a.t)[1]; if (s && g.t - s.t < 120) W.orderGroup(us, { type: 'attackMove', x: s.x, y: s.y }); else for (const u of us) { this.raid.delete(u.id); W.order(u, { type: 'move', x: this.stage[0], y: this.stage[1] }); } }
      return; }
    if (g.t < 330 || g.t - this.lastRaid < 150 || !this.intel.harv.size || this.homeThreat) return;
    const fast = g.unitsOf(this.p).filter((u) => u.uid !== 'HV' && !u.m.engineer && (u.dom === 'veh' || u.dom === 'hover') && !this.wave.has(u.id) && !this.retreating.has(u.id) && u.hp > 0.7 * u.maxHp && !u.rollOut && u.sp.speed_mps >= 9.5)
      .sort((a, b) => b.sp.speed_mps - a.sp.speed_mps).slice(0, 3);
    if (fast.length < 2) return; const s = [...this.intel.harv.values()].filter((h) => fast.every((u) => this.reaches(u.dom, [h.x, h.y]))).sort((a, b) => b.t - a.t)[0]; if (!s || g.t - s.t > 200) return;   // hovercraft raid across water too
    this.lastRaid = g.t; for (const u of fast) this.raid.add(u.id); W.orderGroup(fast, { type: 'attackMove', x: s.x, y: s.y }); g.emit('ai_raid', { player: this.p.id, n: fast.length });
  }

  // ── main army ──
  sendGroup(us, x, y) {   // attack-move a group, leaving alone units already headed there and set-up gunners busy shooting
    const go = us.filter((u) => !(u.deploy === 'deployed' && u.target != null) && !(u.order.type === 'attackMove' && Math.hypot(u.order.x - x, u.order.y - y) < 25) && !(u.order.type === 'attack' && this.focusPrev.has(u.id)));
    if (go.length) this.W.orderGroup(go, { type: 'attackMove', x, y });
  }
  army() {
    const g = this.g, W = this.W, p = this.p;
    const units = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer && !u.rollOut && !this.raid.has(u.id) && !this.retreating.has(u.id) && u.id !== this.scout && u.dom !== 'ship' && !(this.naval && u.dom === 'air'));
    this.wave = new Set([...this.wave].filter((id) => { const u = W.byId.get(id); return u && u.alive && !this.retreating.has(id); }));
    const home = units.filter((u) => !this.wave.has(u.id));
    // threat: enemy fighters seen near the base, or anything hitting our structures / harvesters near the base
    // (outnumbered or across water, enemy aircraft over the base count too: the home army goes for them, not for the building they hit)
    const airToo = this.naval || this.foes().length > 1;
    const foes = (this.visEnemies || []).filter((e) => this.armed(e) && (e.dom !== 'air' || airToo) && e.dom !== 'ship' && (D([e.x, e.y], this.home) < 420 || this.structs.some((b) => Math.hypot(b.x - e.x, b.y - e.y) < 110)));
    const ev = g.events.filter((e) => e.type === 'under_attack' && e.player === p.id && g.t - e.t < 3 && this.nearMe([e.x, e.y], 450)).pop();
    // outnumbered or across water: a raid by aircraft alone is met by the anti-air guns only — the rest of the army can't
    // shoot it, so it neither stays home for it nor is called back from an attack (the raiders' own base is emptier now)
    const srcAir = (e) => { const s0 = e && e.src != null ? W.byId.get(e.src) : null; return !!s0 && s0.dom === 'air'; };
    const airOnly = airToo && (foes.length > 0 || !!ev) && foes.every((e) => e.dom === 'air') && (!ev || srcAir(ev));
    this.homeThreat = !airOnly && (foes.length > 0 || !!ev); if (ev && ev.building && !airOnly) this.homeThreatT = g.t;
    if (airOnly) { const pt = foes.length ? this.centroid(foes.slice().sort((a, b) => D([a.x, a.y], this.home) - D([b.x, b.y], this.home)).slice(0, 6)) : [ev.x, ev.y];
      this.lastDefend = g.t; this.sendGroup(home.filter((u) => u.dom === 'foot' && this.dpsVs(u.sp, 'aircraft', u.uid) > 0), pt[0], pt[1]); }
    else if (this.homeThreat) {
      const tv = foes.reduce((a, e) => a + this.val(e), 0), hv = home.reduce((a, u) => a + this.val(u), 0);
      this.raidSeen = Math.max(this.raidSeen && g.t - this.raidSeenT < 300 ? this.raidSeen : 0, tv); if (tv >= this.raidSeen) this.raidSeenT = g.t;   // biggest push on the base lately
      const pt = foes.length ? (() => { const f = foes.slice().sort((a, b) => D([a.x, a.y], this.home) - D([b.x, b.y], this.home)); const n = f.slice(0, 6); return this.centroid(n); })() : [ev.x, ev.y];
      // the base is losing and the attack is out: bring it home (not when it is nearly there — the base trade favours us)
      const lostB = g.events.some((e) => e.type === 'structure_lost' && e.player === p.id && g.t - e.t < 20);   // our own losses: we know those
      if (this.op && tv > hv * 1.1 + 400 && ((ev && ev.building) || lostB) && g.t - this.lastRecall > 60) {
        const wv = [...this.wave].reduce((a, id) => a + this.val(W.byId.get(id)), 0); const c = this.centroid([...this.wave].map((id) => W.byId.get(id)));
        const finishing = this.intel.structs.size <= 3 && [...this.intel.structs.values()].some((q) => D([q.x, q.y], c) < 250);   // about to end it: press on
        if (D(c, this.home) < D(c, this.enemyStart) * 1.2 || wv < tv * 1.5 || (lostB && !finishing)) { this.op = null; this.wave.clear(); this.lastRecall = g.t; g.emit('ai_recall', { player: p.id }); return this.sendGroup(units, pt[0], pt[1]); }
      }
      this.lastDefend = g.t; this.sendGroup(home, pt[0], pt[1]);
    } else if (g.t - this.lastDefend > 6) {
      // outnumbered or across water, with enemy aircraft about: anti-air infantry stands among the structures (aircraft hit
      // buildings from ~36 m, so the guns have to be close by): the yard first, then production and refineries
      if (airToo && this.airThreat()) { const DEF = { yard: 0, factory: 1, refinery: 2, barracks: 3, airpad: 4, radar: 5, power: 6 }, bs = this.structs.filter((b) => b.kind !== 'naval').sort((a, b) => (DEF[a.kind] ?? 9) - (DEF[b.kind] ?? 9));
        const aa = home.filter((u) => u.dom === 'foot' && u.sys.length && this.dpsVs(u.sp, 'aircraft', u.uid) > 0 && u.target == null && !u.path && (u.order.type === 'idle' || u.order.type === 'guard' || u.order.type === 'attackMove')).sort((a, b) => a.id - b.id);
        if (bs.length) aa.forEach((u, i) => { const b = bs[i % bs.length], a = (u.id * 2.39996) % 6.2832, pt = [b.x + Math.cos(a) * 20, b.y + Math.sin(a) * 20];
          if (!(u.order.type === 'guard' && Math.hypot(u.order.x - pt[0], u.order.y - pt[1]) < 10)) W.order(u, { type: 'guard', x: pt[0], y: pt[1] }); }); }
      for (const u of home) if (u.order.type === 'idle' && u.target == null && !u.path && D([u.x, u.y], this.stage) > 45 && !(u.deploy === 'deployed')) W.order(u, { type: 'attackMove', x: this.stage[0] + ((u.id * 37) % 41 - 20), y: this.stage[1] + ((u.id * 53) % 41 - 20) });
    }
    if (this.op) return this.opThink(home);
    // launch when the healthy home army clearly out-values the enemy army we know about (only units that can get there)
    const pool = home.filter((u) => u.hp > 0.55 * u.maxHp && u.kind !== 'jet' && (u.dom === 'air' || this.goDoms.has(u.dom))), pv = pool.reduce((a, u) => a + this.val(u), 0), est = this.enemyArmyEstimate();
    const maxed = units.length >= 50;
    const met = this.killed >= 1500 || g.t > 660;   // hold until we've beaten their first push (or 11 game min): crossing armies lose the base
    if (this.foes().length > 1 && !this.naval) {   // outnumbered: the base must hold against the other side's waves while the army is out
      const guardV = Math.max(this.raidSeen && g.t - this.raidSeenT < 300 ? this.raidSeen : 0, 0.3 * pv), go = pool.slice().sort((a, b) => D([b.x, b.y], this.home) - D([a.x, a.y], this.home));
      let gv = 0; while (go.length && gv < guardV) gv += this.val(go.pop()); const lv = pv - gv;
      if (g.t > 300 && met && !this.homeThreat && g.t - this.lastWave > 20 && go.length >= 12 && ((lv > est * 1.35 + 1000 && lv > 9000) || (maxed && lv > est * 0.8))) this.launch(go);
      return;
    }
    // across water against several opponents we see little of their armies: go only with a real force, never in dribs
    const big = this.naval && this.foes().length > 1, minN = big ? 10 : this.naval ? 6 : 8, minV = big ? 9000 : 0;
    if (g.t > 300 && met && !this.homeThreat && g.t - this.lastWave > 20 && pool.length >= minN && pv >= minV && (pv > est * 1.35 + 1000 || (maxed && pv > est * 0.8))) this.launch(pool);
  }
  launch(ready) {
    const g = this.g, W = this.W, p = this.p; const tgt = this.attackTarget(this.centroid(ready)); if (!tgt) return;
    this.waves++; this.lastWave = g.t; for (const u of ready) this.wave.add(u.id);
    const c = this.centroid(ready);
    if (ready.length >= 14) {   // two prongs: flank points either side of the line, a third of the way out from the target
      const dx = tgt[0] - c[0], dy = tgt[1] - c[1], L = Math.hypot(dx, dy) || 1, off = Math.min(170, L * 0.3);
      const mid = [tgt[0] - dx * 0.35, tgt[1] - dy * 0.35], dom = ready.every((u) => u.dom === 'hover' || u.dom === 'air') ? 'hover' : 'veh', wp = [-1, 1].map((sg) => this.landPoint([mid[0] - dy / L * off * sg, mid[1] + dx / L * off * sg], dom));
      const sorted = ready.slice().sort((a, b) => ((a.x - c[0]) * -dy + (a.y - c[1]) * dx) - ((b.x - c[0]) * -dy + (b.y - c[1]) * dx));
      // mixed halves: split each unit type evenly so both prongs can fight anything
      const A = [], B = []; const byType = {}; for (const u of sorted) (byType[u.uid] = byType[u.uid] || []).push(u);
      for (const list of Object.values(byType)) list.forEach((u, i) => ((i < list.length / 2) ? A : B).push(u));
      this.op = { tgt, t0: g.t, stage: 'flank', groups: [{ ids: A.map((u) => u.id), wp: wp[0] }, { ids: B.map((u) => u.id), wp: wp[1] }] };
      for (const G of this.op.groups) W.orderGroup(G.ids.map((id) => W.byId.get(id)), { type: 'attackMove', x: G.wp[0], y: G.wp[1] });
      g.emit('ai_wave', { player: p.id, n: ready.length, prongs: 2 });
    } else {
      this.op = { tgt, t0: g.t, t1: g.t, stage: 'assault', groups: [{ ids: ready.map((u) => u.id) }] };
      W.orderGroup(ready, { type: 'attackMove', x: tgt[0], y: tgt[1] }); g.emit('ai_wave', { player: p.id, n: ready.length });
    }
  }
  opThink(home) {
    const g = this.g, W = this.W, P = this.op, alive = (G) => G.ids.map((id) => W.byId.get(id)).filter((u) => u && u.alive && this.wave.has(u.id));
    const left = P.groups.flatMap(alive); if (!left.length) { this.op = null; this.wave.clear(); return; }
    const c = this.centroid(left), mv = left.reduce((a, u) => a + this.val(u), 0);
    // bookkeeping: what the attack has cost us and what it has destroyed over the last two minutes; a losing trade ends it
    if (!P.win) { P.win = g.t; P.k0 = this.killed; P.lost = 0; P.prev = new Map(); }
    for (const [id, cost] of P.prev) { const u = W.byId.get(id); if (!u || !u.alive) P.lost += cost; } P.prev = new Map(left.map((u) => [u.id, u.sp.cost]));
    if (this.foes().length > 1 && g.t - P.t0 > 480 && this.homeThreatT && g.t - this.homeThreatT < 30) {   // outnumbered and the base is being hit again: a long attack comes home
      this.lastRecall = g.t; W.orderGroup(left, { type: 'attackMove', x: this.stage[0], y: this.stage[1] }); this.op = null; this.wave.clear(); this.lastWave = g.t; g.emit('ai_recall', { player: this.p.id }); return; }
    if (g.t - P.win > 120) { const kill = this.killed - P.k0;
      if (P.lost > 1.5 * kill + 1500) { (this.avoid || (this.avoid = {}))[this.enemyStart.join()] = g.t; this._frontT = -99; W.orderGroup(left, { type: 'move', x: this.stage[0], y: this.stage[1] }); this.op = null; this.wave.clear(); this.lastWave = g.t; return; }
      P.win = g.t; P.k0 = this.killed; P.lost = 0; }
    // outgunned: fall back to the staging point and rebuild
    const danger = (this.visEnemies || []).filter((e) => this.armed(e) && D([e.x, e.y], c) < 160).reduce((a, e) => a + this.val(e), 0);
    if (danger > mv * 1.6 && danger > 1500) { W.orderGroup(left, { type: 'move', x: this.stage[0], y: this.stage[1] }); this.op = null; this.wave.clear(); this.lastWave = g.t; return; }
    if (P.stage === 'flank') {   // wait for both prongs at their flank points (or 50 game s, or the first shots), then close in together
      const there = P.groups.map((G) => { const us = alive(G); return us.length ? us.filter((u) => D([u.x, u.y], G.wp) < 55).length / us.length : 1; });
      const hit = left.some((u) => u.lastHitT != null && g.t - u.lastHitT < 2);
      if (there.every((f) => f > 0.65) || g.t - P.t0 > 50 || hit) { P.stage = 'assault'; P.t1 = g.t; W.orderGroup(left, { type: 'attackMove', x: P.tgt[0], y: P.tgt[1] }); }
      return;
    }
    // reinforcements: new units at home join the attack in batches when the base is quiet
    if (!this.homeThreat) { const fresh = home.filter((u) => u.hp > 0.6 * u.maxHp && u.kind !== 'jet' && (u.dom === 'air' || this.goDoms.has(u.dom)) && !(u.deploy === 'deployed' && u.target != null));
      // keep enough at home for the biggest push we've had lately (the attackers' base may still be sending waves)
      const guard = Math.min(this.raidSeen && g.t - this.raidSeenT < 300 ? this.raidSeen * 0.8 : 0, fresh.reduce((a, u) => a + this.val(u), 0) * 0.6);
      fresh.sort((a, b) => D([a.x, a.y], this.home) - D([b.x, b.y], this.home)); let kept = 0; while (fresh.length && kept < guard) kept += this.val(fresh.shift());
      if (fresh.length >= 4 || (fresh.length >= 2 && left.length < 6)) { for (const u of fresh) { this.wave.add(u.id); P.groups[0].ids.push(u.id); } W.orderGroup(fresh, { type: 'attackMove', x: c[0], y: c[1] }); } }
    // retarget: when the current target is gone (or every few seconds, to pick up anything nearer and more valuable)
    if (!P.retT || g.t - P.retT > 4) { P.retT = g.t; const nt = this.attackTarget(c); if (nt) P.tgt = nt; }
    const idle = left.filter((u) => u.target == null && !u.path && (u.order.type === 'idle' || u.order.type === 'attackMove' || u.order.type === 'guard'));
    if (P.search != null) {   // a sweep point counts as looked at once the army is there (or has been trying to get there for a while)
      if (P.searchFor !== P.search) { P.searchFor = P.search; P.searchT = g.t; }
      if (left.some((u) => D([u.x, u.y], P.tgt) < 35) || D(c, P.tgt) < 80 || g.t - P.searchT > 60) { this.searched.set(P.search, g.t); P.retT = 0; }
    }
    this.sendGroup(idle.filter((u) => u.deploy !== 'deployed' || u.target == null), P.tgt[0], P.tgt[1]);
  }
  attackTarget(from) {   // the enemy structure we know about that is nearest and most important; else sweep the enemy's side
    const S = [...this.intel.structs.values()];
    const air = this.airThreat(), pr = (k) => (k === 'airpad' && air ? 0 : PRIO[k] ?? 200);   // aircraft we can't shoot down: their airpads go first
    if (S.length) { this.op && (this.op.search = null); const fr = (this.enemyStarts || []).length > 1 ? (q) => 0.5 * D([q.x, q.y], this.enemyStart) : () => 0;   // several opponents: stay on the one we're working on
      const s = S.sort((a, b) => (D([a.x, a.y], from) + pr(a.kind) + fr(a)) - (D([b.x, b.y], from) + pr(b.kind) + fr(b)))[0]; return s.kind === 'naval' ? this.pierPoint(s) : [s.x, s.y]; }
    const pts = this.searchPoints(), t = this.g.t; let best = null, bs = 1e9;
    for (const q of pts) { const last = this.searched.get(q.key); if (last != null && t - last < 600) continue; const sc = D(q, from) + 0.5 * D(q, this.enemyStart) - (q.dock ? 250 : 0); if (sc < bs) { bs = sc; best = q; } }
    if (best == null) { this.searched.clear(); return this.enemyStart; }
    if (this.op) this.op.search = best.key; return best;
  }
  searchPoints() {   // public map info only: the enemy start, rings round it, dock sites and ore fields on its side
    const es = this.enemyStart; if (this._pts && this._ptsFor === es) return this._pts; const pts = [es];
    for (const r of [110, 200, 290]) for (let a = 0; a < 8; a++) pts.push(this.landPoint([es[0] + Math.cos(a / 8 * 6.283 + r) * r, es[1] + Math.sin(a / 8 * 6.283 + r) * r]));
    for (const s of this.g.dockSites || []) if (D(s.water_center, es) < 700) { const q = [...this.landPoint(s.water_center)]; q.dock = true; pts.push(q); }
    for (const d of this.g.deposits) if (D(d.pos, es) < D(d.pos, this.home) * 1.3) pts.push(this.landPoint(d.pos));
    this._ptsFor = es; this._pts = pts.filter((q, i) => q && q[0] > 0 && !pts.slice(0, i).some((o) => D(o, q) < 40)).map((q) => { const o = [q[0], q[1]]; o.dock = q.dock; o.key = `${q[0] | 0},${q[1] | 0}`; return o; });
    return this._pts;
  }
  pierPoint(s) {   // a naval yard stands in the water: the shore by it, or (hovercraft only, across water) the water 30 m off its middle
    const lp = this.landPoint([s.x, s.y]), d = D(lp, [s.x, s.y]); if (d <= 36 || !this.naval || !this.goDoms.has('hover')) return lp;
    const k = 30 / d; return this.landPoint([s.x + (lp[0] - s.x) * k, s.y + (lp[1] - s.y) * k], 'hover');
  }
  landPoint(pt, dom = 'veh') { const q = this.W.nav.nearestOk(dom, Math.max(20, Math.min(this.g.T.W - 20, pt[0])), Math.max(20, Math.min(this.g.T.H - 20, pt[1])), 3, 200); return q || pt; }
  centroid(us) { us = us.filter(Boolean); return us.length ? [us.reduce((a, u) => a + u.x, 0) / us.length, us.reduce((a, u) => a + u.y, 0) / us.length] : this.stage; }

  // ── fleet: ships (and, across water, aircraft) hit whatever they can reach from the water ──
  homeDock() { const y = this.structs.find((b) => b.kind === 'naval'); if (y) return [y.x, y.y]; const d = (this.g.dockSites || []).map((s) => s.water_center).sort((a, b) => D(a, this.home) - D(b, this.home))[0]; return d || this.home; }
  hurts(e, dom) { const sp = e.sp || this.W.spec[e.uid]; return sp ? this.dpsVs(sp, dom === 'ship' ? 'naval' : dom === 'air' ? 'aircraft' : 'heavy', e.uid) > 0 : false; }   // can this enemy damage that kind of unit
  fleetThink() {
    const g = this.g, W = this.W, mine = g.unitsOf(this.p), dock = this.homeDock();
    const ships = mine.filter((u) => u.dom === 'ship' && u.sys.length);
    for (const u of ships) {   // damaged ships limp home
      if (!this.retreating.has(u.id) && u.hp < 0.35 * u.maxHp && u.lastHitT != null && g.t - u.lastHitT < 3) { this.retreating.add(u.id); W.order(u, { type: 'move', x: dock[0], y: dock[1] }); }
      else if (this.retreating.has(u.id) && D([u.x, u.y], dock) < 120) { this.retreating.delete(u.id); W.order(u, { type: 'guard', x: u.x, y: u.y }); }
    }
    const air = this.naval ? mine.filter((u) => u.dom === 'air' && u.sys.length && !this.retreating.has(u.id)) : [];
    const ok = ships.filter((u) => !this.retreating.has(u.id)); if (!ok.length && !air.length) { this.fleet = null; return; }
    const F = this.fleet || (this.fleet = { on: false, ids: new Set(), tgt: null, retT: -99 });
    F.ids = new Set([...F.ids].filter((id) => ok.some((u) => u.id === id)));
    const sh = ok.filter((u) => F.ids.has(u.id)), spare = ok.filter((u) => !F.ids.has(u.id)), sv = (us) => us.reduce((a, u) => a + this.val(u), 0);
    // new ships wait by the home dock and sail out in batches, so the fleet never arrives one ship at a time
    const batch = spare.filter((u) => u.hp > 0.6 * u.maxHp);
    if (batch.length && sv(batch) >= (F.on && sh.length ? 2000 : 3500) && (this.naval || this.shipsSeen())) {
      for (const u of batch) F.ids.add(u.id); const to = sh.length ? this.centroid(sh) : null;
      if (to) W.orderGroup(batch, { type: 'move', x: to[0], y: to[1] }); if (!F.on) { F.on = true; F.tgt = null; F.retT = -99; } g.emit('ai_fleet', { player: this.p.id, n: batch.length });
    } else for (const u of spare) if (u.order.type === 'idle' && u.target == null && D([u.x, u.y], dock) > 90 && !this.retreating.has(u.id)) W.order(u, { type: 'move', x: dock[0], y: dock[1] });
    const all = F.ids.size ? ok.filter((u) => F.ids.has(u.id)) : []; if (!all.length) F.on = false;
    const c = this.centroid(all.length ? all : air), fv = sv(all) + sv(air);
    // fall back when the guns that can actually hurt ships outweigh the fleet
    const danger = (this.visEnemies || []).filter((e) => this.armed(e) && D([e.x, e.y], c) < 110 && this.hurts(e, 'ship')).reduce((a, e) => a + this.val(e), 0);
    if (F.on && danger > fv * 1.6 && danger > 1500) { F.on = false; for (const u of all) W.order(u, { type: 'move', x: dock[0], y: dock[1] }); F.ids.clear(); return; }
    if (air.length && (g.t - (F.airT || -99) > 4 || !F.atgt)) { F.airT = g.t; F.atgt = this.fleetTarget(this.centroid(air), air[0]); }
    for (const u of air) { const A = F.atgt; if (!A) break; const [tx, ty] = A.at;
      if (u.kind === 'jet') { if (u.order.type === 'idle' && u.target == null) W.order(u, A.id != null ? { type: 'attack', target: A.id } : { type: 'attack', x: tx, y: ty }); continue; }
      if (u.target == null && !(u.order.type === 'attackMove' && Math.hypot(u.order.x - tx, u.order.y - ty) < 30)) W.order(u, { type: 'attackMove', x: tx, y: ty }); }
    if (!F.on || !all.length) return;
    if (g.t - F.retT > 4 || !F.tgt) { F.retT = g.t; F.tgt = this.fleetTarget(c, all[0]); }
    if (!F.tgt) return;
    const [wx, wy] = F.tgt.water;
    // members that have caught up take the target together; stragglers first close on the fleet
    const lead = all.filter((u) => D([u.x, u.y], c) < 140), lag = all.filter((u) => D([u.x, u.y], c) >= 140);
    const go = lead.filter((u) => u.target == null && !(u.order.type === 'attackMove' && Math.hypot(u.order.x - wx, u.order.y - wy) < 30)); if (go.length) W.orderGroup(go, { type: 'attackMove', x: wx, y: wy });
    for (const u of lag) if (u.target == null && !(u.order.type === 'move' && Math.hypot(u.order.x - c[0], u.order.y - c[1]) < 60)) W.order(u, { type: 'move', x: c[0], y: c[1] });
  }
  fleetTarget(c, ref) {   // the enemy structure or unit group a ship can shoot from the water that is nearest and least defended; else patrol their docks
    const W = this.W, N = W.nav, t = this.g.t, r = ref.dom === 'ship' ? W._navR(ref) : 0, reach = Math.max(...ref.sp.weapons.map((w) => w.range_m)) - 4; let best = null, bs = 1e9;
    const guns = [...this.intel.units.values()].filter((u) => u.armed && t - u.t < 90 && this.hurts(u, ref.dom));
    const water = (x, y) => { if (ref.dom !== 'ship') return [x, y]; const q = N.nearestOk('ship', x, y, r, reach + 30); return q && Math.hypot(q[0] - x, q[1] - y) < reach + 8 ? q : null; };
    const consider = (x, y, extra, id) => { if (D([x, y], c) + extra > bs) return; const q = water(x, y); if (!q) return; const thr = guns.reduce((a, u) => a + (Math.hypot(u.x - q[0], u.y - q[1]) < 70 ? u.cost : 0), 0);
      const sc = D(q, c) + extra + thr * 0.15; if (sc < bs) { bs = sc; best = { water: q, at: [x, y], id }; } };
    if (this.dpsVs(ref.sp, 'structure', ref.uid) > 0) for (const [id, s] of this.intel.structs) consider(s.x, s.y, PRIO[s.kind] ?? 200, id);
    for (const [id, u] of this.intel.units) if (t - u.t < 20 && u.uid !== 'HV' && (ref.dom !== 'air' || this.dpsVs(ref.sp, u.armour, ref.uid) > 0)) consider(u.x, u.y, u.armed ? 0 : 150, id);
    if (best) return best;
    // patrol: ships along the enemy's shore (their docks, the water nearest their bases); aircraft over their bases
    const key = ref.dom === 'ship' ? 'ship' : 'air', P = this._patrol || (this._patrol = {});
    if (!P[key]) { const es = this.enemyStarts || [];
      P[key] = ref.dom === 'ship' ? [...(this.g.dockSites || []).map((s) => s.water_center).filter((q) => es.some((e) => D(q, e) < D(q, this.home))), ...es.map((e) => N.nearestOk('ship', e[0], e[1], r, 900)).filter(Boolean)].map((q) => N.nearestOk('ship', q[0], q[1], r, 300)).filter(Boolean)
        : es.flatMap((e) => [e, [e[0] + (this.home[0] - e[0]) * 0.25, e[1] + (this.home[1] - e[1]) * 0.25]]);
      P[key + 'i'] = 0; P[key + 't'] = t; }
    const pts = P[key]; if (!pts.length) return null; let q = pts[P[key + 'i'] % pts.length];
    if (D(c, q) < 140 || t - P[key + 't'] > 75) { P[key + 'i']++; P[key + 't'] = t; q = pts[P[key + 'i'] % pts.length]; }
    return { water: q, at: q, id: null };
  }

  // ── focus fire: every engaged group shoots one target at a time, without chasing beyond weapon range ──
  focusFire() {
    const W = this.W;
    for (const [id, prev] of this.focusPrev) {   // finished or the target ran: carry on with what it was doing
      const u = W.byId.get(id); if (!u || !u.alive) { this.focusPrev.delete(id); continue; }
      if (u.order.type !== 'attack') { this.focusPrev.delete(id); continue; }
      const tg = W.byId.get(u.target), w = tg && tg.alive ? W._weaponFor(u, u.sys[0], tg, true) : null;
      if (!w || D([u.x, u.y], [tg.x, tg.y]) > w.range_m * 1.25) { this.focusPrev.delete(id); u.queue = null; W.order(u, prev || { type: 'guard', x: u.x, y: u.y }); }
    }
    const foesAll = (this.visEnemies || []).filter((e) => e.alive && !e.hidden); if (!foesAll.length) return;
    const mine = this.g.unitsOf(this.p).filter((u) => u.sys.length && u.uid !== 'HV' && !this.retreating.has(u.id) && u.id !== this.scout && u.dom !== 'ship' && u.kind !== 'jet' && u.deploy !== 'deploying' && u.deploy !== 'packing');
    const groups = []; for (const u of mine) { let G = groups.find((q) => D(q.c, [u.x, u.y]) < 45); if (!G) { G = { c: [u.x, u.y], us: [] }; groups.push(G); } G.us.push(u); }
    for (const G of groups) {
      if (G.us.length < 2) continue; const c = this.centroid(G.us), reach = Math.max(...G.us.map((u) => Math.max(...u.sp.weapons.map((w) => w.range_m)))) + 8;
      const foes = foesAll.filter((e) => D([e.x, e.y], c) < reach); if (!foes.length) continue;
      let best = null, bs = -1;
      for (const e of foes) { const arm = e.sp.armour_type || e.sp.armor; let dps = 0; for (const u of G.us) dps += this.dpsVs(u.sp, arm, u.uid) * (W.dmgScale || 1); if (dps <= 0) continue;
        const ttk = e.hp / dps, threat = e.sys.length ? e.sp.cost : e.uid === 'HV' ? e.sp.cost * 0.8 : 50; const sc = threat / (ttk + 2); if (sc > bs) { bs = sc; best = e; } }
      if (!best) continue;
      for (const u of G.us) { if (u.target === best.id) continue; const w = W._weaponFor(u, u.sys[0], best, true); if (!w || D([u.x, u.y], [best.x, best.y]) > w.range_m * 1.05) continue;
        if (u.deploy === 'deployed') { u.target = best.id; continue; }   // a set-up gun just swings round
        const prev = this.focusPrev.has(u.id) ? this.focusPrev.get(u.id) : (u.order.type === 'attackMove' || u.order.type === 'guard' ? { ...u.order } : null);
        W.order(u, { type: 'attack', target: best.id }); this.focusPrev.set(u.id, prev); }
    }
  }
  // ── deployable infantry (Helix MG teams): set up when an enemy is inside machine-gun range; the next move packs up ──
  deployMicro() {
    const W = this.W, P = this.op;
    for (const u of this.g.unitsOf(this.p)) { if (!u.m.deploy || u.deploy !== 'mobile' || u.target == null || this.retreating.has(u.id) || u.id === this.scout) continue;
      if (P && P.stage === 'flank' && this.wave.has(u.id)) continue;
      const tg = W.byId.get(u.target); if (!tg || !tg.alive || tg.isBuilding) continue; const set = MECH[u.uid].deploy.deployed.map((i) => u.sp.weapons[i]).filter(Boolean);
      const r = Math.max(0, ...set.filter((w) => this.wDps(w, tg.sp.armour_type || tg.sp.armor) > 0).map((w) => w.range_m)); if (r > 0 && D([u.x, u.y], [tg.x, tg.y]) < Math.min(30, r * 1.2)) { this.focusPrev.delete(u.id); W.order(u, { type: 'deploy' }); } }
  }
}
