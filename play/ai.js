// Thunderhead Stage 2 AI opponent (one difficulty). Same rules and economy as the player; it thinks once per game second.
// Base layout: the map's own base-kit slots for this start (instances with the team flag), then a spiral search for the rest.
// Economy: keeps power ahead of demand, two refineries, about two harvesters per refinery.
// Army: mixed production, rallies at a staging point toward the enemy, defends structures under attack, attacks in waves
// that grow over time. Round 3: Helix Rangers set up their machine guns when an enemy is in range (deployMicro).
// Fog of war (round 2): it only knows the enemy structures its own side has seen (World.visible) plus public map info (the
// start pads, ore fields, dock sites and the map's land / water regions). Waves go for the nearest enemy structure it knows
// about, else the enemy's start pad, and sweep the enemy's side of the map when they run out of known targets.
// Across water (round 2): only units that can get to the target go in a wave (the nav regions are public map info). When no
// enemy can be reached by land it builds a naval yard and aircraft early, keeps a small home guard of land units, and
// attacks with what can cross: hovercraft and aircraft in the waves, ships as a fleet, jets on bombing runs. On maps where
// an enemy can be reached by land none of this changes what it does. Across water a wave first meets 300 m short of its
// target (aircraft are faster than hovercraft) and then goes in together.
// Outnumbered (round 2: more living opponents than players on its own side, e.g. alone against two): a second barracks
// and factory before the radar / airpad / naval yard, no more than one infantry per vehicle (plus a few), the first wave
// not before 9 game minutes and bigger, a third of the army stays home, production structures are the first targets, and
// a wave far from its target comes home when the base starts losing structures. In 1v1 and as one of a pair it plays as before.
// Anti-air (round 3): production lists hold anti-air-only units (Helix's Halo) and dual-role ones (Rocket Troopers, Nullifiers).
// The round-robin skips anti-air-only units until enemy aircraft have been seen, and while the anti-air it owns is worth less
// than the enemy aircraft it has seen lately (credit for credit, capped at half its army but never below $1,200) the next
// pick in a list that has an anti-air unit is that unit. Fog of war only: aircraft our side saw.
import { STRUCTURES, FACTIONS } from './rules.js';
import { MECH } from './engine/mech.js';

const KIT_KIND = { bld_power_substation: 'power', bld_ore_refinery: 'refinery', bld_barracks: 'barracks', bld_vehicle_factory: 'factory', bld_naval_dock: 'naval', bld_radar_control: 'radar' };
const ORDER = ['power', 'refinery', 'barracks', 'power', 'refinery', 'factory', 'power', 'radar', 'airpad', 'naval', 'power', 'barracks', 'factory', 'power'];
// no enemy reachable by land: the core base, then the yards for whatever of the faction can cross and hit structures
const ORDER_CORE = ['power', 'refinery', 'barracks', 'power', 'refinery', 'factory'];
// outnumbered on land: a second barracks and factory before the radar, airpad and naval yard (army first)
const ORDER_OUT = ORDER_CORE.concat(['power', 'barracks', 'factory', 'power', 'radar', 'airpad', 'naval', 'power']);
const LAND = ['foot', 'veh', 'hover'];
const PRIO = { factory: 0, barracks: 20, yard: 60, airpad: 120, naval: 160, refinery: 160, radar: 200, power: 220 };   // metres of detour a target kind is worth
const DOM = { foot: 'foot', tracked: 'veh', hover: 'hover', ship: 'ship', heli: 'air', jet: 'air', drone: 'air' };
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class AI {
  constructor(game, p, kitItems) {
    this.g = game; this.p = p; this.next = 0; this.waves = 0; this.lastWave = 0; this.defending = 0; this.wave = new Set();
    this.slots = kitItems.map(([asset, x, y]) => ({ kind: KIT_KIND[asset], x, y })).filter((s) => s.kind);
    const c = p.start; const foes = game.players.filter((q) => q.team !== p.team), enemy = (foes.sort((a, b) => Math.hypot(a.start.x - c.x, a.start.y - c.y) - Math.hypot(b.start.x - c.x, b.start.y - c.y))[0] || game.players.find((q) => q.id !== p.id)).start;
    const dx = enemy.x - c.x, dy = enemy.y - c.y, L = Math.hypot(dx, dy) || 1; this.toward = [dx / L, dy / L];
    this.stage = [c.x + this.toward[0] * 150, c.y + this.toward[1] * 150];
    this.known = new Map(); this.airSeen = new Map(); this.swept = new Map(); this.reachC = new Map(); this.cross = false; this.outnum = false; this.crossT = -99; this.navy = new Set(); this.navyT = -999; this.navyPts = new Map();
  }
  get structs() { return this.g.structures(this.p); }
  /** living players on other teams, nearest start first (1v1: just the opponent) */
  enemies() { const c = this.p.start; return this.g.enemiesOf(this.p).sort((a, b) => Math.hypot(a.start.x - c.x, a.start.y - c.y) - Math.hypot(b.start.x - c.x, b.start.y - c.y)); }
  count(kind) { return this.structs.filter((b) => b.kind === kind).length + (this.p.queues.structure[0] && this.p.queues.structure[0].key === kind ? 1 : 0) + (this.p.ready && this.p.ready.key === kind ? 1 : 0); }
  think() {
    const g = this.g, p = this.p; if (p.lost || g.over) return;
    this.seeEnemy(); this.crossCheck();
    if (p.ready) this.placeReady();
    this.buildStructures(); this.produce(); this.repair(); this.army(); this.navyThink(); this.jetThink(); this.deployMicro();
  }

  // ── what our side knows: enemy structures it has seen, and which of our movement domains reach a point ──
  seeEnemy() {
    const W = this.g.world, me = this.p.team, K = this.known, t = this.g.t;
    for (const b of W.buildings) if (b.alive && b.team !== me && b.team >= 0 && W.visible(me, b)) { const s = K.get(b.id); if (s) s.t = t; else K.set(b.id, { id: b.id, x: b.x, y: b.y, kind: b.kind, owner: b.owner, t }); }
    for (const [id, s] of K) { const b = W.byId.get(id); if ((!b || !b.alive) && this.looksAt(s.x, s.y)) K.delete(id); }   // gone when we look again
    // enemy aircraft our side can see (armed ones), forgotten after 4 game minutes unseen or when we see the spot it died
    const A = this.airSeen; for (const u of W.units) if (u.alive && u.dom === 'air' && u.team !== me && u.sys.length && W.visible(me, u)) A.set(u.id, { x: u.x, y: u.y, cost: u.sp.cost, t });
    for (const [id, s] of A) { const u = W.byId.get(id); if (t - s.t > 240 || ((!u || !u.alive) && this.looksAt(s.x, s.y))) A.delete(id); }
  }
  /** credits of enemy aircraft seen lately (an enemy airpad alone does not count: anti-air with nothing to shoot is wasted money) */
  airThreatValue() { let v = 0; for (const s of this.airSeen.values()) v += s.cost; return v; }
  /** can this unit type shoot aircraft / is it an anti-air specialist */
  hitsAir(k) { const sp = this.g.world.spec[k]; return !!sp && sp.weapons.some((w) => w.targets.includes('air')); }
  aaOnly(k) { const sp = this.g.world.spec[k]; return this.hitsAir(k) && !sp.weapons.some((w) => !w.targets.includes('air') && ['heavy', 'building', 'naval'].some((c) => w.targets.includes(c))); }   // anti-air specialist: its ground mode (if any) can't fight tanks, structures or ships (Halo)
  /** true while the anti-air we own (and have queued) is worth less than the enemy air seen, capped at half the army */
  wantAA() {
    const air = this.airThreatValue(); if (!air) return false; const p = this.p, mine = this.g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer);
    let aa = 0, army = 0; for (const u of mine) { army += u.sp.cost; if (this.hitsAir(u.uid)) aa += u.sp.cost; }
    for (const cat of ['infantry', 'vehicle', 'air', 'naval']) for (const it of p.queues[cat] || []) if (it.key !== 'HV' && this.hitsAir(it.key)) aa += it.cost;
    return aa < Math.min(air * (this.aaShare ?? 1), Math.max(1200, army * 0.5));
  }
  /** the next unit from a production list: anti-air-only units only against seen aircraft; anti-air first while short of it */
  pickUnit(list) {
    if (!list.length) return null; const aaL = list.filter((k) => (this.aaDual === false ? this.aaOnly(k) : this.hitsAir(k)));   // Easy: only specialists answer aircraft
    if (aaL.length && this.wantAA()) return aaL[(this.next++) % aaL.length];
    const ground = list.filter((k) => !this.aaOnly(k)); if (!ground.length) return null;
    return ground[(this.next++) % ground.length];
  }
  looksAt(x, y) { return this.g.unitsOf(this.p).some((u) => Math.hypot(u.x - x, u.y - y) < (u.sp.sight_m || 30) * 0.8) || this.structs.some((b) => Math.hypot(b.x - x, b.y - y) < 40); }
  /** land domains that can get from our base to pt (public map info: the nav regions) */
  reachDoms(pt) {
    const key = `${pt[0] | 0},${pt[1] | 0}`, hit = this.reachC.get(key); if (hit && this.g.t - hit.t < 30) return hit.d;
    const N = this.g.world.nav, s = this.p.start, d = new Set(N && N.reachable ? LAND.filter((dm) => N.reachable(dm, s.x, s.y, pt[0], pt[1], 3)) : LAND);
    if (this.reachC.size > 500) this.reachC.clear(); this.reachC.set(key, { d, t: this.g.t }); return d;
  }
  canGo(u, pt) { return u.dom === 'air' || (u.dom !== 'ship' && this.reachDoms(pt).has(u.dom)); }
  domOfUid(uid) { return DOM[(MECH[uid] || {}).kind] || 'veh'; }
  /** across water: no living enemy can be reached by infantry or tanks */
  crossCheck() {
    if (this.g.t - this.crossT < 10) return; this.crossT = this.g.t;
    const es = this.enemies(); if (!es.length) return;
    this.outnum = es.length > this.g.players.filter((q) => q.team === this.p.team && !q.lost).length;   // e.g. alone against two
    this.cross = !es.some((e) => { const r = this.reachDoms([e.start.x, e.start.y]); return r.has('foot') || r.has('veh'); });
  }
  /** the enemy the waves go for: the nearest one our land army can walk to; across water, the nearest */
  foe() { const es = this.enemies(); if (this.cross) return es[0]; return es.find((e) => { const r = this.reachDoms([e.start.x, e.start.y]); return r.has('foot') || r.has('veh'); }) || es[0]; }
  /** where a wave goes: the known structure of that enemy nearest `from`, else a point of the enemy's side we have not
   * looked at lately (its start pad first) */
  targetFor(enemy, from, ok = () => true) {
    let best = null, bd = 1e18; const pr = this.outnum ? (k) => PRIO[k] ?? 150 : () => 0;   // outnumbered: production first (it stops the reinforcements)
    for (const s of this.known.values()) if (s.owner === enemy.id && ok([s.x, s.y])) { const d = D([s.x, s.y], from) + pr(s.kind); if (d < bd) { bd = d; best = s; } }
    if (best && best.kind === 'naval') { const q = this.g.world.nav.nearestOk('veh', best.x, best.y, 3, 120); if (q) return q; }   // a pier stands in the water: go to the shore by it, not onto it
    return best ? [best.x, best.y] : this.sweepPoint(enemy, from, ok);
  }
  sweepPoints(enemy) {
    const C = this.sweepC || (this.sweepC = new Map()); if (C.has(enemy.id)) return C.get(enemy.id); const pts = this._sweepPoints(enemy); C.set(enemy.id, pts); return pts;
  }
  _sweepPoints(enemy) {
    const g = this.g, es = [enemy.start.x, enemy.start.y], N = g.world.nav, home = [this.p.start.x, this.p.start.y], pts = [es];
    for (const d of g.deposits) if (D(d.pos, es) < D(d.pos, home) * 0.9) pts.push(d.pos);
    for (const s of g.dockSites || []) if (D(s.water_center, es) < D(s.water_center, home) * 0.9) { const q = N.nearestOk('veh', s.water_center[0], s.water_center[1], 3, 200); if (q) pts.push(q); }
    for (const r of [120, 230]) for (let a = 0; a < 8; a++) { const q = N.nearestOk('veh', Math.max(20, Math.min(g.T.W - 20, es[0] + Math.cos(a * 0.785 + r) * r)), Math.max(20, Math.min(g.T.H - 20, es[1] + Math.sin(a * 0.785 + r) * r)), 3, 120); if (q) pts.push(q); }
    return pts;
  }
  sweepPoint(enemy, from, ok) {
    const t = this.g.t, es = [enemy.start.x, enemy.start.y]; let best = null, bs = 1e18;
    const pts = this.sweepPoints(enemy).filter((q) => ok(q));
    for (const q of pts) { const last = this.swept.get(`${q[0] | 0},${q[1] | 0}`); if (last != null && t - last < 600) continue; const s = D(q, from) + 0.5 * D(q, es); if (s < bs) { bs = s; best = q; } }
    if (!best && pts.length) { for (const q of pts) this.swept.delete(`${q[0] | 0},${q[1] | 0}`); best = pts[0]; }
    return best;
  }
  markSwept(us) {   // sweep points our units stand on count as looked at
    if (!us.length) return; const e = this.foe(); if (!e) return;
    for (const q of this.sweepPoints(e)) if (us.some((u) => Math.hypot(u.x - q[0], u.y - q[1]) < 45)) this.swept.set(`${q[0] | 0},${q[1] | 0}`, this.g.t);
  }

  // ── upkeep: wrench on damaged structures while it can afford it; an engineer for a badly damaged one ──
  repair() {
    const g = this.g, p = this.p, W = g.world;
    for (const b of this.structs) { const f = b.hp / b.maxHp; if (!b.repairing && f < 0.75 && p.credits > 1500) g.toggleRepair(p, b); else if (b.repairing && p.credits < 400 && f > 0.5) g.toggleRepair(p, b); }
    const eng = g.unitsOf(p).filter((u) => u.m.engineer), worst = this.structs.filter((b) => b.hp / b.maxHp < 0.4).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const F = FACTIONS[p.faction], eid = F.infantry.find((k) => W.spec[k] && !W.spec[k].weapons.length);
    if (worst && !eng.length && eid && g.has(p, 'barracks') && !p.queues.infantry.some((i) => i.key === eid) && p.credits > 800) { g.enqueue(p, 'infantry', eid); const q = p.queues.infantry; q.unshift(q.pop()); }
    for (const u of eng) if (u.order.type !== 'enter' && worst && !u.rollOut) W.order(u, { type: 'enter', building: worst.id });
  }
  // ── structures ──
  wantStructure() {
    const pw = this.p.power; const queued = this.p.queues.structure.length || this.p.ready;
    if (queued) return null;
    if (pw.made - pw.used < 40 && this.count('power') < 8) return 'power';
    const O = this.cross ? this.crossOrder() : this.outnum ? ORDER_OUT : ORDER;
    for (let i = 0; i < O.length; i++) {
      const k = O[i], need = O.slice(0, i + 1).filter((x) => x === k).length;
      if (this.count(k) < need) { if (k === 'naval' && !this.g.dockSites.some((s) => this.nearMe(s.water_center, 700))) continue; if (this.g.available(this.p, 'structure', k)) return k; return null; }
    }
    return null;
  }
  crossOrder() {
    const F = FACTIONS[this.p.faction], O = ORDER_CORE.concat(['naval', 'power', 'radar', 'airpad', 'power', 'airpad']);
    if (F.air.includes('A04')) O.push('power', 'airpad');   // jets need a pad each
    return O.concat(['power']);
  }
  nearMe(pt, r) { return Math.hypot(pt[0] - this.p.start.x, pt[1] - this.p.start.y) < r; }
  buildStructures() { const k = this.wantStructure(); if (k && this.p.credits > STRUCTURES[k].cost * 0.4) this.g.enqueue(this.p, 'structure', k); }
  placeReady() {
    const g = this.g, p = this.p, kind = p.ready.key;
    const cands = [];
    for (const s of this.slots) if (s.kind === kind) cands.push([s.x, s.y]);
    if (STRUCTURES[kind].naval) for (const s of g.dockSites) cands.push(s.water_center);
    for (const [x, y] of cands) { const c = g.canPlace(p, kind, x, y); if (c.ok) { g.place(p, c.x, c.y); return; } }
    const c0 = p.start, S = STRUCTURES[kind];   // spiral out from the yard, staying behind the front where possible
    for (let r = 30; r < 260; r += 8) for (let a = 0; a < 24; a++) {
      const th = a / 24 * Math.PI * 2, x = c0.x + Math.cos(th) * r - this.toward[0] * 20, y = c0.y + Math.sin(th) * r - this.toward[1] * 20;
      const c = g.canPlace(p, kind, x, y); if (c.ok) { g.place(p, c.x, c.y); return; }
    }
    g.cancel(p, 'structure', kind);   // nowhere to put it: refund
  }
  // ── production ──
  produce() {
    const g = this.g, p = this.p, W = g.world, F = FACTIONS[p.faction], harv = g.unitsOf(p).filter((u) => u.uid === 'HV').length, refs = this.structs.filter((b) => b.kind === 'refinery').length;
    const vq = p.queues.vehicle, hvq = vq.filter((i) => i.key === 'HV').length, wantHv = Math.min(5, refs * 2);
    // economy first: a harvester is always in the queue while short of two per refinery (production pays as it goes)
    if (g.has(p, 'factory') && harv + hvq < wantHv && hvq < 1) { g.enqueue(p, 'vehicle', 'HV'); const q = p.queues.vehicle, i = q.findIndex((x) => x.key === 'HV'); if (i > 0) q.unshift(q.splice(i, 1)[0]); }
    if (harv + hvq < wantHv && p.credits < 1200) return;   // save up rather than starve the harvester
    const mine = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer), army = mine.length; if (army > 40) return;
    const sq = p.queues.structure[0]; if (sq && !p.ready && p.credits < Math.min(1500, sq.cost - sq.spent)) return;   // the base comes first
    const keep = (cat, list, max) => { if (!list.length || !g.has(p, { infantry: 'barracks', vehicle: 'factory', air: 'airpad', naval: 'naval' }[cat])) return; if (p.queues[cat].length >= max) return; const k = this.pickUnit(list); if (k && g.available(p, cat, k) && p.credits > g.costOf(cat, k) + 300) g.enqueue(p, cat, k); };
    const inf = F.infantry.filter((k) => W.spec[k] && W.spec[k].weapons.length), veh = F.vehicle.filter((u) => u !== 'HV');
    if (!this.cross) {   // outnumbered: tanks take the money before more infantry (infantry at most one per vehicle, plus a few)
      const nInf = mine.filter((u) => u.dom === 'foot').length, nVeh = mine.filter((u) => u.dom === 'veh' || u.dom === 'hover').length;
      if (!this.outnum || nInf < nVeh + 4) keep('infantry', inf, 1); keep('vehicle', veh, 1); if (army > 8) keep('air', F.air, 1); if (army > 10) keep('naval', F.naval, 1); return; }
    // across water: a small home guard of land units that cannot cross; the rest goes into what can cross — aircraft and
    // hovercraft every time, and a few ships (enough to meet the enemy's)
    const e = this.foe(), ept = e ? [e.start.x, e.start.y] : null, crosses = (k) => { const d = this.domOfUid(k); return d === 'air' || (ept && LAND.includes(d) && this.reachDoms(ept).has(d)); };
    const guard = mine.filter((u) => LAND.includes(u.dom) && !(ept && this.reachDoms(ept).has(u.dom))).length, ships = mine.filter((u) => u.dom === 'ship').length;
    const infX = inf.filter(crosses), vehX = veh.filter(crosses), armedAir = F.air.filter((k) => W.spec[k] && W.spec[k].weapons.length);
    keep('infantry', infX.length ? infX : guard < 6 ? inf : [], 1); keep('vehicle', vehX.length ? vehX : guard < 6 ? veh : [], 1);
    const hitsB = (k) => W.spec[k].weapons.some((w) => w.targets.includes('building')), goesX = (u) => u.dom === 'air' || (LAND.includes(u.dom) && ept && this.reachDoms(ept).has(u.dom));
    const strikers = mine.filter((u) => goesX(u) && hitsB(u.uid)).length, support = mine.filter((u) => u.dom === 'air' && !hitsB(u.uid)).length;   // support aircraft: at most one per striker
    keep('air', armedAir.filter((k) => hitsB(k) || support < Math.max(3, strikers)), 1); if (ships < (armedAir.length || vehX.length ? 4 : 8)) keep('naval', F.naval.filter((k) => W.spec[k] && W.spec[k].weapons.length), 1);
  }
  // ── deployable infantry (round 3; Helix Rangers): set up when a visible enemy ground unit the machine gun can hurt is
  // inside its range; a set-up gun that is shooting (or shot in the last 3 s) gets no new orders, and the next order after
  // that packs it up (the engine queues the order behind the pack-up). Plain moves and garrison orders never set up.
  deployMicro() {
    const W = this.g.world;
    for (const u of this.g.unitsOf(this.p)) { if (!u.m.deploy || u.deploy !== 'mobile' || u.garrisonIn || u.rollOut || u.order.type === 'move' || u.order.type === 'garrison') continue;
      const set = u.m.deploy.deployed.map((i) => u.sp.weapons[i]).filter(Boolean);
      for (const e of W.units) { if (!e.alive || e.team === u.team || e.hidden || e.dom === 'air' || !W.visible(u.team, e)) continue;
        const r = Math.max(0, ...set.filter((w) => w.targets.includes(e.sp.armor) && W.mult(w, e) > 0).map((w) => w.range_m));
        if (r > 0 && W.surfDist(u, e) <= r) { W.order(u, { type: 'deploy' }); break; } } }
  }
  gunBusy(u) { return !!u.deploy && (u.deploy === 'deploying' || (u.deploy === 'deployed' && (u.target != null || this.g.world.t - (u.sys[0] ? u.sys[0].lastFire : -99) < 3))); }
  // ── army ──
  army() {
    const g = this.g, W = g.world, p = this.p;
    const units = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer && !u.rollOut && !this.gunBusy(u));   // a set-up gun in a fight is left alone
    const free = units.filter((u) => !this.wave.has(u.id) && (u.order.type === 'idle' || u.order.type === 'attackMove' && Math.hypot(u.x - this.stage[0], u.y - this.stage[1]) < 60));
    // defend: anything hitting our structures or harvesters near the base draws the free units
    const threat = g.events.filter((e) => e.type === 'under_attack' && e.player === p.id && g.t - e.t < 3 && this.nearMe([e.x, e.y], 450)).pop();
    // outnumbered: the base is losing structures while the wave is still far from its target — the wave comes home
    const lost = threat && threat.building && g.events.some((e) => e.type === 'structure_lost' && e.player === p.id && g.t - e.t < 20);
    if (this.outnum && lost && this.wave.size && g.t - (this.recallT || -99) > 60) {
      const ws = [...this.wave].map((id) => W.byId.get(id)).filter((u) => u && u.alive), c = ws.length ? [ws.reduce((a, u) => a + u.x, 0) / ws.length, ws.reduce((a, u) => a + u.y, 0) / ws.length] : null, e = this.foe();
      if (c && e && D(c, [e.start.x, e.start.y]) > 350) { this.recallT = g.t; this.wave.clear(); this.lastWave = g.t; W.orderGroup(ws.filter((u) => u.dom !== 'ship'), { type: 'attackMove', x: threat.x, y: threat.y }); }
    }
    if (threat && g.t - this.defending > 6) { this.defending = g.t; W.orderGroup(units.filter((u) => !this.wave.has(u.id) && u.dom !== 'ship' && !(u.kind === 'jet' && this.cross)), { type: 'attackMove', x: threat.x, y: threat.y }); return; }
    // idle units gather at the staging point
    for (const u of free) if (u.order.type === 'idle' && Math.hypot(u.x - this.stage[0], u.y - this.stage[1]) > 40 && u.dom !== 'ship' && !(u.kind === 'jet' && this.cross)) W.order(u, { type: 'attackMove', x: this.stage[0] + (Math.random() - 0.5) * 40, y: this.stage[1] + (Math.random() - 0.5) * 40 });
    // waves: first after 4 game minutes, then every 2.5 game minutes, growing; only units that can get to the target
    this.wave = new Set([...this.wave].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    const enemy = this.foe(); if (!enemy) return;
    const ept = [enemy.start.x, enemy.start.y], goes = (u) => !this.cross || (u.kind !== 'jet' && this.canGo(u, ept));
    const size = Math.min(18, 6 + 2 * this.waves); let ready = units.filter((u) => !this.wave.has(u.id) && u.dom !== 'ship' && goes(u));
    // outnumbered: the first wave waits until 9 game minutes (the base has to hold the first pushes), waves are bigger, and
    // a third of the army stays home to meet the other side's waves
    const first = this.outnum ? 540 : 240, need = this.cross ? Math.max(10, size) : this.outnum ? Math.max(15, size + 6) : size;
    if (g.t > first && g.t - this.lastWave > 150 && ready.length >= need) {
      const tgt = this.targetFor(enemy, [p.start.x, p.start.y]);
      if (!tgt) return;
      if (this.outnum && !this.cross) { const home = [p.start.x, p.start.y]; ready = ready.slice().sort((a, b) => D([a.x, a.y], home) - D([b.x, b.y], home)).slice(Math.floor(ready.length / 3)); }
      this.waves++; this.lastWave = g.t; for (const u of ready) this.wave.add(u.id);
      if (this.cross) {   // across water the wave meets 300 m short of the target first (aircraft are faster than hovercraft), then goes in together
        const c = [ready.reduce((a, u) => a + u.x, 0) / ready.length, ready.reduce((a, u) => a + u.y, 0) / ready.length], L = D(c, tgt) || 1, k = Math.min(1, 300 / L);
        const q = [tgt[0] + (c[0] - tgt[0]) * k, tgt[1] + (c[1] - tgt[1]) * k], gp = W.nav.nearestOk('hover', q[0], q[1], 3, 150) || q;
        this.gather = { pt: gp, t0: g.t, tgt }; W.orderGroup(ready, { type: 'move', x: gp[0], y: gp[1] });
      } else W.orderGroup(ready, { type: 'attackMove', x: tgt[0], y: tgt[1] });
      g.emit('ai_wave', { player: p.id, n: ready.length });
    }
    if (this.gather) {
      const G = this.gather, ws = [...this.wave].map((id) => W.byId.get(id)).filter((u) => u && u.alive), there = ws.filter((u) => Math.hypot(u.x - G.pt[0], u.y - G.pt[1]) < 60).length;
      if (!ws.length || there >= 0.75 * ws.length || g.t - G.t0 > 100 || ws.some((u) => u.lastHitT != null && g.t - u.lastHitT < 2)) { this.gather = null; if (ws.length) W.orderGroup(ws.filter((u) => !this.gunBusy(u)), { type: 'attackMove', x: G.tgt[0], y: G.tgt[1] }); }
      return;
    }
    // waves that ran out of targets push on to the next structure we know about (or look for one)
    // across water, also count as done: aircraft circling on their point and units standing on it with nothing to shoot
    const done = (u) => u.order.type === 'idle' || (this.cross && u.target == null && u.order.type === 'attackMove' && (u.dom === 'air' ? Math.hypot(u.order.x - u.x, u.order.y - u.y) < 20 : !u.path && Math.hypot(u.order.x - u.x, u.order.y - u.y) < 10));
    const idle = [...this.wave].map((id) => W.byId.get(id)).filter((u) => u && done(u) && !this.gunBusy(u));   // a set-up gun still shooting stays put
    if (idle.length) { this.markSwept(idle); const c = [idle.reduce((a, u) => a + u.x, 0) / idle.length, idle.reduce((a, u) => a + u.y, 0) / idle.length];
      const s = this.targetFor(enemy, c); if (s) for (const u of idle) W.order(u, { type: 'attackMove', x: s[0], y: s[1] }); }
  }
  // ── fleet (across water only; elsewhere the ships guard the dock as before): sails out in batches and shells what it
  // can reach from the water — known structures near the shore, then the enemy's dock sites and shore ──
  shipPoint(u, from) {
    const g = this.g, W = g.world, N = W.nav, e = this.foe(); if (!e) return null; const r = W._navR(u), t = g.t;
    const reach = Math.max(10, ...u.sp.weapons.filter((w) => w.targets.includes('building')).map((w) => w.range_m)) - 6;
    const water = (x, y) => { const q = N.nearestOk('ship', x, y, r, reach + 40); return q && Math.hypot(q[0] - x, q[1] - y) < reach ? q : null; };
    let best = null, bd = 1e18; const fresh = (q) => { const last = this.navyPts.get(`${q[0] | 0},${q[1] | 0}`); return last == null || t - last > 240; };
    if (u.sp.weapons.some((w) => w.targets.includes('building'))) for (const s of this.known.values()) if (s.owner === e.id) { const q = water(s.x, s.y); if (q && fresh(q)) { const d = D(q, from); if (d < bd) { bd = d; best = q; } } }
    if (best) return best;
    const es = [e.start.x, e.start.y], home = [this.p.start.x, this.p.start.y], pts = [];
    for (const s of g.dockSites || []) if (D(s.water_center, es) < D(s.water_center, home)) pts.push(s.water_center);
    pts.push(N.nearestOk('ship', es[0], es[1], r, 1200));
    for (const q0 of pts) { if (!q0) continue; const q = N.nearestOk('ship', q0[0], q0[1], r, 300); if (!q || !fresh(q)) continue; const d = D(q, from); if (d < bd) { bd = d; best = q; } }
    if (!best) { this.navyPts.clear(); return pts[0] ? N.nearestOk('ship', pts[0][0], pts[0][1], r, 300) : null; }
    return best;
  }
  navyThink() {
    if (!this.cross) return;
    const g = this.g, W = g.world, ships = g.unitsOf(this.p).filter((u) => u.dom === 'ship' && u.sys.length && !u.rollOut);
    this.navy = new Set([...this.navy].filter((id) => ships.some((u) => u.id === id)));
    const port = ships.filter((u) => !this.navy.has(u.id)), at = this.navy.size ? ships.filter((u) => this.navy.has(u.id)) : [];
    if (port.length >= 3 || (port.length && at.length && port.length >= 2) || (port.length && g.t - this.navyT > 300 && port.length >= 2)) {   // sail out together
      this.navyT = g.t; const c = at.length ? [at[0].x, at[0].y] : null; for (const u of port) this.navy.add(u.id);
      const q = c || this.shipPoint(port[0], [port[0].x, port[0].y]); if (q) W.orderGroup(port, { type: 'attackMove', x: q[0], y: q[1] }); g.emit('ai_fleet', { player: this.p.id, n: port.length });
    }
    const idle = ships.filter((u) => this.navy.has(u.id) && u.order.type === 'idle' && u.target == null);
    if (!idle.length) return; const c = [idle.reduce((a, u) => a + u.x, 0) / idle.length, idle.reduce((a, u) => a + u.y, 0) / idle.length];
    // idle at a point with nothing left to shoot: that point is done for a while, sail for the next
    let q = this.shipPoint(idle[0], c); if (q && Math.hypot(q[0] - c[0], q[1] - c[1]) < 80) { this.navyPts.set(`${q[0] | 0},${q[1] | 0}`, g.t); q = this.shipPoint(idle[0], c); }
    if (q) W.orderGroup(idle, { type: 'attackMove', x: q[0], y: q[1] });
  }
  // ── jets (across water only): bombing runs on the nearest enemy structure it knows about, one target per sortie ──
  jetThink() {
    if (!this.cross) return;
    const g = this.g, W = g.world, e = this.foe(); if (!e) return;
    for (const u of g.unitsOf(this.p)) { if (u.kind !== 'jet' || !u.jet || !u.jet.armed || (u.jet.phase !== 'landed' && u.jet.phase !== 'reload') || g.t - (u.sortieT || -99) < 4) continue;
      let tgt = null, bd = 1e18; for (const s of this.known.values()) if (s.owner === e.id) { const d = Math.hypot(s.x - u.x, s.y - u.y); if (d < bd) { bd = d; tgt = s; } }
      if (!tgt) continue; u.sortieT = g.t; const b = W.byId.get(tgt.id);
      W.order(u, b && b.alive && W.visible(this.p.team, b) ? { type: 'attack', target: b.id } : { type: 'attack', x: tgt.x, y: tgt.y }); }
  }
}
