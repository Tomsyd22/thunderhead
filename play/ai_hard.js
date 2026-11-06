// Thunderhead Hard AI (round 1 playtest). Same rules, same economy and the same fog of war as the player: it only knows
// what its own units and structures can see (World.visible), plus the map's start pads and ore rigs that every player
// sees on the minimap. No resource bonus, no build-time bonus, no map reveal.
//
// On top of the Normal AI's base building and upkeep (ai.js) it:
//   scouts   — sends its first infantry round the enemy start and the expansion fields, then keeps a memory of what it saw
//   expands  — a third refinery by an expansion field once its home ore runs low (or from 7 game minutes), more harvesters
//   counters — weighs every unit it can build by damage per credit against the enemy army it has seen, and builds the best
//   raids    — a small fast group hunts enemy harvesters at the fields it has seen them working
//   focus    — each engaged group picks one target at a time (the one it can kill fastest, worth the most) and shoots it together
//   pulls back damaged units (under 35 % health) to the base before they die, then reuses them for defence
//   flanks   — splits its main attack into two prongs that close on the target base from different sides at the same time
import { STRUCTURES, FACTIONS } from './rules.js';
import { AI } from './ai.js';

const CLASS = { infantry: 'infantry', light: 'light', medium: 'heavy', heavy: 'heavy', aircraft: 'air', ship: 'naval', structure: 'building' };
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class HardAI extends AI {
  constructor(game, p, kitItems) {
    super(game, p, kitItems); this.level = 'hard';
    this.intel = { structs: new Map(), units: new Map(), harv: new Map() };   // last sightings: id → { x, y, t, ... }
    this.scout = null; this.scoutPlan = null; this.raid = new Set(); this.lastRaid = -999; this.prongs = null; this.retreating = new Set(); this.focus = new Map();
    const others = game.players.filter((q) => q.id !== p.id); this.enemyStart = others[0] ? [others[0].start.x, others[0].start.y] : this.stage;
  }
  think() {
    const g = this.g, p = this.p; if (p.lost || g.over) return;
    this.observe(); if (p.ready) this.placeReady();
    this.buildStructures(); this.expand(); this.produce(); this.repair();
    this.scoutThink(); this.retreat(); this.raidThink(); this.army(); this.focusFire(); this.deployMicro();
  }
  // ── deployable infantry (Helix MG teams): set up when a fight starts, the next move order packs them up again ──
  deployMicro() {
    const W = this.W; for (const u of this.g.unitsOf(this.p)) { if (!u.m.deploy || u.deploy !== 'mobile' || u.target == null || this.retreating.has(u.id)) continue;
      const tg = W.byId.get(u.target); if (tg && tg.alive && D([u.x, u.y], [tg.x, tg.y]) < 40 && !(this.prongs && this.prongs.stage === 'flank' && this.wave.has(u.id))) W.order(u, { type: 'deploy' }); }
  }
  get W() { return this.g.world; }
  enemyOf(o) { return o.team !== this.p.team && o.team >= 0; }

  // ── intel: remember what our side sees ──
  observe() {
    const W = this.W, t = this.g.t, I = this.intel, me = this.p.team;
    for (const b of W.buildings) if (b.alive && this.enemyOf(b) && W.visible(me, b)) I.structs.set(b.id, { x: b.x, y: b.y, kind: b.kind, t });
    for (const [id, s] of I.structs) { const b = W.byId.get(id); if ((!b || !b.alive) && this.seesPoint(s.x, s.y)) I.structs.delete(id); }   // gone when we look again
    for (const u of W.units) if (u.alive && !u.hidden && this.enemyOf(u) && W.visible(me, u)) {
      I.units.set(u.id, { x: u.x, y: u.y, uid: u.uid, armour: u.sp.armour_type || u.sp.armor, cost: u.sp.cost, t });
      if (u.uid === 'HV') I.harv.set(u.id, { x: u.x, y: u.y, t, dep: u.harv && u.harv.dep ? u.harv.dep.id : null });
    }
    for (const [id, s] of I.units) { const u = W.byId.get(id); if (!u || !u.alive || t - s.t > 240) I.units.delete(id); }
    for (const [id, s] of I.harv) { const u = W.byId.get(id); if (!u || !u.alive || t - s.t > 300) I.harv.delete(id); }
  }
  seesPoint(x, y) { return this.g.unitsOf(this.p).some((u) => Math.hypot(u.x - x, u.y - y) < (u.sp.sight_m || 30) * 0.8) || this.structs.some((b) => Math.hypot(b.x - x, b.y - y) < 40); }

  // ── economy: three refineries, the third by the nearest expansion field once home ore runs low ──
  expand() {
    const g = this.g, p = this.p, refs = this.structs.filter((b) => b.kind === 'refinery');
    if (!g.has(p, 'factory') || refs.length >= 3 || p.queues.structure.length || p.ready) return;
    const home = g.deposits.filter((d) => d.nearest === p.start.pad.id), low = home.length && home.reduce((a, d) => a + (d.ore || 0), 0) < 0.4 * home.reduce((a, d) => a + (d.field ? d.field.total : 100000), 0);
    if ((low || g.t > 420) && refs.length === 2 && p.credits > 2400) { g.enqueue(p, 'structure', 'refinery'); this.wantExpansion = true; }
  }
  placeReady() {
    const g = this.g, p = this.p, kind = p.ready.key;
    if (kind === 'refinery' && this.wantExpansion) {   // the expansion refinery: as close to the richest reachable non-home field as the build radius allows
      const fields = g.deposits.filter((d) => d.nearest !== p.start.pad.id && (d.ore || 0) > 3000 && !g.deposits.some((q) => q === d && q.nearest && q.nearest !== p.start.pad.id && q.kind === 'home'))
        .sort((a, b) => D(a.pos, [p.start.x, p.start.y]) - D(b.pos, [p.start.x, p.start.y]));
      for (const d of fields.slice(0, 3)) for (let r = 30; r < 160; r += 8) for (let a = 0; a < 16; a++) {
        const c = g.canPlace(p, kind, d.pos[0] + Math.cos(a / 16 * 6.283) * r, d.pos[1] + Math.sin(a / 16 * 6.283) * r); if (c.ok) { g.place(p, c.x, c.y); this.wantExpansion = false; return; } }
      this.wantExpansion = false;
    }
    super.placeReady();
  }

  // ── production: counter what we've seen ──
  dpsVs(spec, armour) {
    const T = this.W.combat && this.W.combat.table, cls = CLASS[armour] || armour; let s = 0;
    for (const w of spec.weapons || []) { if (w.targets && !w.targets.includes(cls)) continue; const m = T && w.wtype && T[w.wtype] ? T[w.wtype][armour] || 0 : (w.multipliers[cls] || 0);
      s += w.damage * (w.burst || 1) / Math.max(0.1, w.cycle_s + (w.burst > 1 ? (w.burst - 1) * (w.burst_gap_s || 0) : 0)) * m; }
    return s;
  }
  pick(cat, list) {
    const W = this.W, seen = [...this.intel.units.values()].filter((u) => u.armour && u.uid !== 'HV'); if (!seen.length) return null;
    const mix = {}; for (const u of seen) mix[u.armour] = (mix[u.armour] || 0) + (u.cost || 500); const tot = Object.values(mix).reduce((a, b) => a + b, 0);
    let best = null, bs = -1; const army = this.g.unitsOf(this.p).filter((u) => u.uid !== 'HV' && u.sys.length), share = (k) => army.length < 6 ? 0 : army.filter((u) => u.uid === k).length / army.length;
    for (const k of list) { const sp = W.spec[k]; if (!sp || !sp.weapons.length || (list.length > 1 && share(k) > 0.6)) continue; let sc = 0; for (const [a, c] of Object.entries(mix)) sc += c / tot * this.dpsVs(sp, a);
      sc = sc / sp.cost + 0.15 * sp.health / sp.cost / 10; if (sc > bs) { bs = sc; best = k; } }
    return best;
  }
  produce() {
    const g = this.g, p = this.p, W = this.W, F = FACTIONS[p.faction], harv = g.unitsOf(p).filter((u) => u.uid === 'HV').length, refs = this.structs.filter((b) => b.kind === 'refinery').length;
    const vq = p.queues.vehicle, hvq = vq.filter((i) => i.key === 'HV').length, wantHv = Math.min(8, refs * 2 + 1);
    if (g.has(p, 'factory') && harv + hvq < wantHv && hvq < 1) { g.enqueue(p, 'vehicle', 'HV'); const i = vq.findIndex((x) => x.key === 'HV'); if (i > 0) vq.unshift(vq.splice(i, 1)[0]); }
    if (harv + hvq < Math.min(4, wantHv) && p.credits < 1200) return;
    const army = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer).length; if (army > 50) return;
    const sq = p.queues.structure[0]; if (sq && !p.ready && p.credits < Math.min(1500, sq.cost - sq.spent)) return;
    // second barracks / factory when rich, so the army keeps pace with the economy
    if (!p.queues.structure.length && !p.ready && p.credits > 3500 && g.t > 360) { for (const k of ['factory', 'barracks']) if (this.count(k) < 2 && g.available(p, 'structure', k)) { g.enqueue(p, 'structure', k); break; } }
    const armed = (list) => list.filter((k) => W.spec[k] && W.spec[k].weapons.length);
    const keep = (cat, list, max) => { if (!g.has(p, { infantry: 'barracks', vehicle: 'factory', air: 'airpad', naval: 'naval' }[cat])) return; if (p.queues[cat].length >= max || !list.length) return;
      const k = this.pick(cat, list) || list[(this.next++) % list.length]; if (p.credits > g.costOf(cat, k) + 200) g.enqueue(p, cat, k); };
    keep('infantry', armed(F.infantry), 2); keep('vehicle', armed(F.vehicle.filter((u) => u !== 'HV')), 2);
    if (army > 6) keep('air', armed(F.air), 1); if (army > 10 && this.intel.units.size && [...this.intel.units.values()].some((u) => u.armour === 'ship')) keep('naval', armed(F.naval), 1);
  }

  // ── scouting: the first rifleman tours the enemy start and the expansions ──
  scoutThink() {
    const g = this.g, W = this.W, p = this.p;
    if (this.scout != null) { const u = W.byId.get(this.scout); if (!u || !u.alive) { this.scout = null; this.scouted = true; return; }
      if (!u.path && Math.hypot(u.x - this.scoutPlan[0][0], u.y - this.scoutPlan[0][1]) < 30) this.scoutPlan.shift();
      if (!this.scoutPlan.length) { this.scout = null; this.scouted = true; W.order(u, { type: 'move', x: this.stage[0], y: this.stage[1] }); return; }
      if (!u.path) W.order(u, { type: 'move', x: this.scoutPlan[0][0], y: this.scoutPlan[0][1] }); return; }
    if (this.scouted || g.t < 15) return;
    const u = g.unitsOf(p).filter((q) => q.kind === 'foot' && q.sys.length && !q.rollOut).sort((a, b) => b.sp.speed_mps - a.sp.speed_mps)[0]; if (!u) return;
    const es = this.enemyStart, ex = g.deposits.filter((d) => d.kind !== 'home').map((d) => d.pos).sort((a, b) => D(a, es) - D(b, es)).slice(0, 2);
    this.scout = u.id; this.scoutPlan = [...ex, [es[0] + (this.p.start.x - es[0]) * 0.2, es[1] + (this.p.start.y - es[1]) * 0.2], es]; W.order(u, { type: 'move', x: this.scoutPlan[0][0], y: this.scoutPlan[0][1] });
  }

  // ── pull back: badly damaged units go home before they die ──
  retreat() {
    const W = this.W, home = [this.p.start.x, this.p.start.y];
    for (const id of this.retreating) { const u = W.byId.get(id); if (!u || !u.alive) this.retreating.delete(id); }
    for (const u of this.g.unitsOf(this.p)) {
      if (u.uid === 'HV' || u.m.engineer || u.dom === 'ship' || u.kind === 'jet' || u.id === this.scout) continue;
      const f = u.hp / u.maxHp, near = D([u.x, u.y], home) < 140;
      if (!this.retreating.has(u.id) && f < 0.35 && !near && u.lastHitT != null) { this.retreating.add(u.id); this.wave.delete(u.id); this.raid.delete(u.id); W.order(u, { type: 'move', x: home[0] + (Math.random() - 0.5) * 50, y: home[1] + (Math.random() - 0.5) * 50 }); }
      else if (this.retreating.has(u.id) && (near || !u.alive)) { this.retreating.delete(u.id); if (u.alive) W.order(u, { type: 'guard', x: u.x, y: u.y }); }
    }
  }

  // ── harvester raids: a few fast units at a field where enemy harvesters were seen ──
  raidThink() {
    const g = this.g, W = this.W; this.raid = new Set([...this.raid].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    if (this.raid.size) { const us = [...this.raid].map((id) => W.byId.get(id)); const hv = W.units.filter((h) => h.alive && h.uid === 'HV' && this.enemyOf(h) && W.visible(this.p.team, h));
      const c = this.centroid(us); const tgt = hv.sort((a, b) => D([a.x, a.y], c) - D([b.x, b.y], c))[0];
      const danger = W.units.filter((e) => e.alive && this.enemyOf(e) && e.uid !== 'HV' && e.sys.length && W.visible(this.p.team, e) && D([e.x, e.y], c) < 70).reduce((a, e) => a + e.sp.cost, 0);
      if (danger > us.reduce((a, u) => a + u.sp.cost, 0) * 1.4) { for (const u of us) { this.raid.delete(u.id); W.order(u, { type: 'move', x: this.stage[0], y: this.stage[1] }); } return; }   // outgunned: break off
      if (tgt) for (const u of us) if (u.target !== tgt.id) W.order(u, { type: 'attack', target: tgt.id });
      if (!tgt && us.every((u) => !u.path && u.target == null)) { const s = [...this.intel.harv.values()].sort((a, b) => b.t - a.t)[1]; if (s) W.orderGroup(us, { type: 'attackMove', x: s.x, y: s.y }); else for (const u of us) this.raid.delete(u.id); }
      return; }
    if (g.t < 300 || g.t - this.lastRaid < 150 || !this.intel.harv.size) return;
    const fast = g.unitsOf(this.p).filter((u) => u.uid !== 'HV' && !u.m.engineer && (u.dom === 'veh' || u.dom === 'hover') && !this.wave.has(u.id) && !this.retreating.has(u.id) && u.hp > 0.7 * u.maxHp && !u.rollOut)
      .sort((a, b) => b.sp.speed_mps - a.sp.speed_mps).slice(0, 4);
    if (fast.length < 3) return; const s = [...this.intel.harv.values()].sort((a, b) => b.t - a.t)[0];
    this.lastRaid = g.t; for (const u of fast) this.raid.add(u.id); W.orderGroup(fast, { type: 'attackMove', x: s.x, y: s.y }); g.emit('ai_raid', { player: this.p.id, n: fast.length });
  }

  // ── main army: defend, gather, then attack in two prongs that converge on the target ──
  army() {
    const g = this.g, W = this.W, p = this.p;
    const units = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer && !u.rollOut && !this.raid.has(u.id) && !this.retreating.has(u.id) && u.id !== this.scout);
    const threat = g.events.filter((e) => e.type === 'under_attack' && e.player === p.id && g.t - e.t < 3 && this.nearMe([e.x, e.y], 450)).pop();
    if (threat && g.t - this.defending > 6) {
      this.defending = g.t; let home = units.filter((u) => !this.wave.has(u.id) && u.dom !== 'ship');
      const foes = W.units.filter((e) => e.alive && this.enemyOf(e) && e.sys.length && W.visible(p.team, e) && D([e.x, e.y], [threat.x, threat.y]) < 120).reduce((a, e) => a + e.sp.cost, 0);
      if (threat.building && foes > home.reduce((a, u) => a + u.sp.cost, 0) * 0.8 && this.wave.size) {   // the base is losing: bring the attack home
        this.prongs = null; this.wave.clear(); home = units.filter((u) => u.dom !== 'ship'); g.emit('ai_recall', { player: p.id }); }
      if (home.length) W.orderGroup(home, { type: 'attackMove', x: threat.x, y: threat.y });
    }
    for (const u of units) if (u.order.type === 'idle' && !this.wave.has(u.id) && D([u.x, u.y], this.stage) > 40 && u.dom !== 'ship' && g.t - this.defending > 10) W.order(u, { type: 'attackMove', x: this.stage[0] + (Math.random() - 0.5) * 40, y: this.stage[1] + (Math.random() - 0.5) * 40 });
    this.wave = new Set([...this.wave].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    if (this.prongs) return this.prongThink(units);
    const size = Math.min(24, 8 + 2 * this.waves), pool = units.filter((u) => !this.wave.has(u.id) && u.dom !== 'ship' && u.hp > 0.6 * u.maxHp);
    const me0 = [p.start.x, p.start.y], guardN = Math.max(3, Math.ceil(pool.length * 0.25)), ready = pool.slice().sort((a, b) => D([b.x, b.y], me0) - D([a.x, a.y], me0)).slice(0, Math.max(0, pool.length - guardN));
    const mine = ready.reduce((a, u) => a + u.sp.cost * u.hp / u.maxHp, 0), theirs = [...this.intel.units.values()].filter((u) => u.uid !== 'HV').reduce((a, u) => a + (u.cost || 0), 0);
    if (g.t > 270 && g.t - this.lastWave > 120 && ready.length >= size && (mine > theirs * 1.2 || g.t > 540)) {
      const tgt = this.attackTarget(); if (!tgt) return; this.waves++; this.lastWave = g.t; for (const u of ready) this.wave.add(u.id);
      // two prongs: a flank waypoint on either side of the straight line, a third of the way out from the target
      const c = this.centroid(ready), dx = tgt[0] - c[0], dy = tgt[1] - c[1], L = Math.hypot(dx, dy) || 1, off = Math.min(220, L * 0.35);
      const mid = [tgt[0] - dx / L * L * 0.3, tgt[1] - dy / L * L * 0.3], wp = [-1, 1].map((sg) => this.landPoint([mid[0] - dy / L * off * sg, mid[1] + dx / L * off * sg]));
      const sorted = ready.slice().sort((a, b) => ((a.x - c[0]) * -dy + (a.y - c[1]) * dx) - ((b.x - c[0]) * -dy + (b.y - c[1]) * dx)), half = Math.ceil(sorted.length / 2);
      this.prongs = { tgt, t0: g.t, stage: 'flank', groups: [{ ids: sorted.slice(0, half).map((u) => u.id), wp: wp[0] }, { ids: sorted.slice(half).map((u) => u.id), wp: wp[1] }] };
      for (const G of this.prongs.groups) W.orderGroup(G.ids.map((id) => W.byId.get(id)), { type: 'move', x: G.wp[0], y: G.wp[1] });
      g.emit('ai_wave', { player: p.id, n: ready.length, prongs: 2 });
    }
  }
  prongThink() {
    const g = this.g, W = this.W, P = this.prongs; const alive = (G) => G.ids.map((id) => W.byId.get(id)).filter((u) => u && u.alive && !this.retreating.has(u.id));
    if (P.stage === 'flank') {   // wait for both prongs at their waypoints (or 60 game s), then close in together
      const there = P.groups.map((G) => { const us = alive(G); return us.length ? us.filter((u) => D([u.x, u.y], G.wp) < 50).length / us.length : 1; });
      const hit = P.groups.some((G) => alive(G).some((u) => u.lastHitT != null && g.t - u.lastHitT < 2));
      if (there.every((f) => f > 0.6) || g.t - P.t0 > 60 || hit) { P.stage = 'assault'; P.t1 = g.t; for (const G of P.groups) { const us = alive(G); if (us.length) W.orderGroup(us, { type: 'attackMove', x: P.tgt[0], y: P.tgt[1] }); } }
      return;
    }
    const left = P.groups.flatMap(alive);
    if (!left.length) { this.prongs = null; this.wave.clear(); return; }
    if (left.every((u) => u.order.type === 'idle' || (!u.path && u.target == null))) { const nt = this.attackTarget(); if (nt) { P.tgt = nt; W.orderGroup(left, { type: 'attackMove', x: nt[0], y: nt[1] }); } else { this.prongs = null; this.wave.clear(); } }
    if (g.t - P.t1 > 300) { this.prongs = null; this.wave.clear(); }   // the wave is spent; survivors rejoin the pool
  }
  attackTarget() {   // the enemy structure we know about nearest to us (production first); else the enemy start
    const S = [...this.intel.structs.values()]; if (!S.length) return this.enemyStart;
    const pr = (k) => ({ factory: 0, barracks: 1, refinery: 2, yard: 3 }[k] ?? 4); const me = [this.p.start.x, this.p.start.y];
    const s = S.sort((a, b) => pr(a.kind) - pr(b.kind) || D([a.x, a.y], me) - D([b.x, b.y], me))[0]; return s.kind === "naval" ? this.landPoint([s.x, s.y]) : [s.x, s.y];
  }
  landPoint(pt) { const q = this.W.nav.nearestOk('veh', Math.max(20, Math.min(this.g.T.W - 20, pt[0])), Math.max(20, Math.min(this.g.T.H - 20, pt[1])), 3, 200); return q || pt; }
  centroid(us) { return us.length ? [us.reduce((a, u) => a + u.x, 0) / us.length, us.reduce((a, u) => a + u.y, 0) / us.length] : this.stage; }

  // ── focus fire: every engaged group shoots one target at a time ──
  focusFire() {
    const W = this.W, me = this.p.team; const mine = this.g.unitsOf(this.p).filter((u) => u.sys.length && u.uid !== 'HV' && !this.retreating.has(u.id) && u.id !== this.scout && u.dom !== 'ship');
    const groups = []; for (const u of mine) { let G = groups.find((q) => D(q.c, [u.x, u.y]) < 45); if (!G) { G = { c: [u.x, u.y], us: [] }; groups.push(G); } G.us.push(u); }
    for (const G of groups) {
      if (G.us.length < 2) continue; const c = this.centroid(G.us), reach = Math.max(...G.us.map((u) => Math.max(...u.sp.weapons.map((w) => w.range_m)))) + 10;
      const foes = W.units.filter((e) => e.alive && !e.hidden && this.enemyOf(e) && W.visible(me, e) && D([e.x, e.y], c) < reach); if (!foes.length) continue;
      let best = null, bs = -1;
      for (const e of foes) { const arm = e.sp.armour_type || e.sp.armor; let dps = 0; for (const u of G.us) dps += this.dpsVs(u.sp, arm) * (W.dmgScale || 1); if (dps <= 0) continue;
        const ttk = e.hp / dps, threat = e.sys.length ? e.sp.cost : e.uid === 'HV' ? e.sp.cost * 0.8 : 50; const sc = threat / (ttk + 2); if (sc > bs) { bs = sc; best = e; } }
      if (!best) continue;
      for (const u of G.us) { const w = W._weaponFor(u, u.sys[0], best, true); if (!w || u.target === best.id || D([u.x, u.y], [best.x, best.y]) > w.range_m * 1.6) continue;
        const prev = u.order.type === 'attackMove' || u.order.type === 'guard' ? { ...u.order } : u.order.type === 'attack' && u.queue && u.queue.length ? u.queue[0] : null;
        W.order(u, { type: 'attack', target: best.id }); if (prev) u.queue = [prev]; }   // then carry on with what it was doing
    }
  }
}
