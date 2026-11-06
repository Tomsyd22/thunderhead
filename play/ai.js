// Thunderhead Stage 2 AI opponent (one difficulty). Same rules and economy as the player; it thinks once per game second.
// Base layout: the map's own base-kit slots for this start (instances with the team flag), then a spiral search for the rest.
// Economy: keeps power ahead of demand, two refineries, about two harvesters per refinery.
// Army: mixed production, rallies at a staging point toward the enemy, defends structures under attack, attacks in waves
// that grow over time.
import { STRUCTURES, FACTIONS } from './rules.js';

const KIT_KIND = { bld_power_substation: 'power', bld_ore_refinery: 'refinery', bld_barracks: 'barracks', bld_vehicle_factory: 'factory', bld_naval_dock: 'naval', bld_radar_control: 'radar' };
const ORDER = ['power', 'refinery', 'barracks', 'power', 'refinery', 'factory', 'power', 'radar', 'airpad', 'naval', 'power', 'barracks', 'factory', 'power'];

export class AI {
  constructor(game, p, kitItems) {
    this.g = game; this.p = p; this.next = 0; this.waves = 0; this.lastWave = 0; this.defending = 0; this.wave = new Set();
    this.slots = kitItems.map(([asset, x, y]) => ({ kind: KIT_KIND[asset], x, y })).filter((s) => s.kind);
    const c = p.start; const enemy = game.players.find((q) => q.id !== p.id).start;
    const dx = enemy.x - c.x, dy = enemy.y - c.y, L = Math.hypot(dx, dy) || 1; this.toward = [dx / L, dy / L];
    this.stage = [c.x + this.toward[0] * 150, c.y + this.toward[1] * 150];
  }
  get structs() { return this.g.structures(this.p); }
  count(kind) { return this.structs.filter((b) => b.kind === kind).length + (this.p.queues.structure[0] && this.p.queues.structure[0].key === kind ? 1 : 0) + (this.p.ready && this.p.ready.key === kind ? 1 : 0); }
  think() {
    const g = this.g, p = this.p; if (p.lost || g.over) return;
    if (p.ready) this.placeReady();
    this.buildStructures(); this.produce(); this.army();
  }
  // ── structures ──
  wantStructure() {
    const P = p => p; const pw = this.p.power; const queued = this.p.queues.structure.length || this.p.ready;
    if (queued) return null;
    if (pw.made - pw.used < 40 && this.count('power') < 8) return 'power';
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], need = ORDER.slice(0, i + 1).filter((x) => x === k).length;
      if (this.count(k) < need) { if (k === 'naval' && !this.g.dockSites.some((s) => this.nearMe(s.water_center, 700))) continue; if (this.g.available(this.p, 'structure', k)) return k; return null; }
    }
    return null;
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
    const g = this.g, p = this.p, F = FACTIONS[p.faction], harv = g.unitsOf(p).filter((u) => u.uid === 'HV').length, refs = this.structs.filter((b) => b.kind === 'refinery').length;
    const vq = p.queues.vehicle, hvq = vq.filter((i) => i.key === 'HV').length, wantHv = Math.min(5, refs * 2);
    // economy first: a harvester is always in the queue while short of two per refinery (production pays as it goes)
    if (g.has(p, 'factory') && harv + hvq < wantHv && hvq < 1) { g.enqueue(p, 'vehicle', 'HV'); const q = p.queues.vehicle, i = q.findIndex((x) => x.key === 'HV'); if (i > 0) q.unshift(q.splice(i, 1)[0]); }
    if (harv + hvq < wantHv && p.credits < 1200) return;   // save up rather than starve the harvester
    const army = g.unitsOf(p).filter((u) => u.uid !== 'HV').length; if (army > 40) return;
    const sq = p.queues.structure[0]; if (sq && !p.ready && p.credits < Math.min(1500, sq.cost - sq.spent)) return;   // the base comes first
    const keep = (cat, list, max) => { if (!g.has(p, { infantry: 'barracks', vehicle: 'factory', air: 'airpad', naval: 'naval' }[cat])) return; if (p.queues[cat].length >= max) return; const k = list[(this.next++) % list.length]; if (p.credits > g.costOf(cat, k) + 300) g.enqueue(p, cat, k); };
    keep('infantry', F.infantry, 1); keep('vehicle', F.vehicle.filter((u) => u !== 'HV'), 1);
    if (army > 8) keep('air', F.air, 1); if (army > 10) keep('naval', F.naval, 1);
  }
  // ── army ──
  army() {
    const g = this.g, W = g.world, p = this.p;
    const units = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.rollOut);
    const free = units.filter((u) => !this.wave.has(u.id) && (u.order.type === 'idle' || u.order.type === 'attackMove' && Math.hypot(u.x - this.stage[0], u.y - this.stage[1]) < 60));
    // defend: anything hitting our structures or harvesters near the base draws the free units
    const threat = g.events.filter((e) => e.type === 'under_attack' && e.player === p.id && g.t - e.t < 3 && this.nearMe([e.x, e.y], 450)).pop();
    if (threat && g.t - this.defending > 6) { this.defending = g.t; W.orderGroup(units.filter((u) => !this.wave.has(u.id) && u.dom !== 'ship'), { type: 'attackMove', x: threat.x, y: threat.y }); return; }
    // idle units gather at the staging point
    for (const u of free) if (u.order.type === 'idle' && Math.hypot(u.x - this.stage[0], u.y - this.stage[1]) > 40 && u.dom !== 'ship') W.order(u, { type: 'attackMove', x: this.stage[0] + (Math.random() - 0.5) * 40, y: this.stage[1] + (Math.random() - 0.5) * 40 });
    // waves: first after 4 game minutes, then every 2.5 game minutes, growing
    this.wave = new Set([...this.wave].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    const size = Math.min(18, 6 + 2 * this.waves), ready = units.filter((u) => !this.wave.has(u.id) && u.dom !== 'ship');
    if (g.t > 240 && g.t - this.lastWave > 150 && ready.length >= size) {
      const enemy = g.players.find((q) => q.id !== p.id && !q.lost); if (!enemy) return;
      const tgt = g.structures(enemy).sort((a, b) => Math.hypot(a.x - p.start.x, a.y - p.start.y) - Math.hypot(b.x - p.start.x, b.y - p.start.y))[0];
      if (!tgt) return; this.waves++; this.lastWave = g.t; for (const u of ready) this.wave.add(u.id);
      W.orderGroup(ready, { type: 'attackMove', x: tgt.x, y: tgt.y }); g.emit('ai_wave', { player: p.id, n: ready.length });
    }
    // waves that ran out of targets push on to the next structure
    for (const id of this.wave) { const u = W.byId.get(id); if (u && u.order.type === 'idle') { const enemy = g.players.find((q) => q.id !== p.id && !q.lost); const s = enemy && g.structures(enemy)[0]; if (s) W.order(u, { type: 'attackMove', x: s.x, y: s.y }); } }
  }
}
