// Thunderhead Easy AI (round 1). The Normal AI's base building with deliberate handicaps, for new players:
//   reacts half as often (thinks every second game second), one refinery and one harvester per refinery,
//   one item at a time in each queue and only after saving up a reserve, a small army (12 at most, no aircraft or ships),
//   slow defence (answers an attack on its base at most every 20 s), first attack at 7 game minutes with 4 units,
//   then every 4 minutes, growing by one. No repairs, no engineers. Same rules and economy as everyone else.
// Round 2: the same fog of war as Normal (targets only enemy structures it has seen, else the enemy start pad) and only
//   units that can get to the target go in a wave. Round 3 (AI.pickUnit): anti-air-only units (the Halo) only once enemy
//   aircraft are seen, and then only while it owns less than half the enemy air it has seen; unlike Normal it does not switch its
//   dual-role infantry (Rocket Troopers, Nullifiers) to anti-air duty. When no enemy can be reached by land it adds a naval yard and keeps up
//   to three ships, which sail out together (no aircraft, still no more than 12 units).
import { STRUCTURES, FACTIONS } from './rules.js';
import { AI } from './ai.js';

const ORDER_EASY = ['power', 'refinery', 'barracks', 'power', 'factory', 'power'];

export class EasyAI extends AI {
  constructor(game, p, kitItems) { super(game, p, kitItems); this.level = 'easy'; this.tick2 = false; this.aaShare = 0.5; this.aaDual = false; }   // answers seen aircraft late and lightly: only anti-air specialists (Halo), half as much as Normal
  think() { this.tick2 = !this.tick2; if (this.tick2) return; const g = this.g, p = this.p; if (p.lost || g.over) return; this.seeEnemy(); this.crossCheck(); if (p.ready) this.placeReady(); this.buildStructures(); this.produce(); this.army(); this.navyThink(); }
  wantStructure() {
    const pw = this.p.power; if (this.p.queues.structure.length || this.p.ready) return null;
    if (pw.made - pw.used < 20 && this.count('power') < 4) return 'power';
    const O = this.cross && this.g.dockSites.some((s) => this.nearMe(s.water_center, 700)) ? ORDER_EASY.concat(['naval']) : ORDER_EASY;
    for (let i = 0; i < O.length; i++) { const k = O[i], need = O.slice(0, i + 1).filter((x) => x === k).length; if (this.count(k) < need) return this.g.available(this.p, 'structure', k) ? k : null; }
    return null;
  }
  buildStructures() { const k = this.wantStructure(); if (k && this.p.credits > STRUCTURES[k].cost) this.g.enqueue(this.p, 'structure', k); }
  produce() {
    const g = this.g, p = this.p, W = g.world, F = FACTIONS[p.faction], harv = g.unitsOf(p).filter((u) => u.uid === 'HV').length, refs = this.structs.filter((b) => b.kind === 'refinery').length;
    if (g.has(p, 'factory') && harv < refs && !p.queues.vehicle.some((i) => i.key === 'HV')) g.enqueue(p, 'vehicle', 'HV');
    const mine = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer), army = mine.length; if (army >= 12 || p.credits < 1200) return;
    const pickFrom = (list) => list.filter((k) => W.spec[k] && W.spec[k].weapons.length);
    const ships = this.cross && g.has(p, 'naval') && mine.filter((u) => u.dom === 'ship').length < 3 ? pickFrom(F.naval) : [];
    for (const [cat, list] of [['infantry', pickFrom(F.infantry)], ['vehicle', pickFrom(F.vehicle.filter((u) => u !== 'HV'))], ['naval', ships]]) {
      if (!g.has(p, { infantry: 'barracks', vehicle: 'factory', naval: 'naval' }[cat]) || p.queues[cat].length || !list.length) continue; const k = this.pickUnit(list); if (k && p.credits > g.costOf(cat, k) + 1000) g.enqueue(p, cat, k);
    }
  }
  army() {
    const g = this.g, W = g.world, p = this.p; const units = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer && !u.rollOut);
    const threat = g.events.filter((e) => e.type === 'under_attack' && e.player === p.id && e.building && g.t - e.t < 3).pop();
    if (threat && g.t - this.defending > 20) { this.defending = g.t; W.orderGroup(units.filter((u) => !this.wave.has(u.id) && (!this.cross || u.dom !== 'ship')), { type: 'attackMove', x: threat.x, y: threat.y }); return; }
    for (const u of units) if (u.order.type === 'idle' && !this.wave.has(u.id) && !(this.cross && u.dom === 'ship') && Math.hypot(u.x - this.stage[0], u.y - this.stage[1]) > 40) W.order(u, { type: 'attackMove', x: this.stage[0] + (Math.random() - 0.5) * 40, y: this.stage[1] + (Math.random() - 0.5) * 40 });
    this.wave = new Set([...this.wave].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    const enemy = this.foe(); if (!enemy) return; const ept = [enemy.start.x, enemy.start.y];
    const size = Math.min(10, 4 + this.waves), ready = units.filter((u) => !this.wave.has(u.id) && (!this.cross || this.canGo(u, ept)));
    if (g.t > 420 && g.t - this.lastWave > 240 && ready.length >= size) {
      const tgt = this.targetFor(enemy, [p.start.x, p.start.y]); if (!tgt) return;
      this.waves++; this.lastWave = g.t; for (const u of ready) this.wave.add(u.id); W.orderGroup(ready, { type: 'attackMove', x: tgt[0], y: tgt[1] }); g.emit('ai_wave', { player: p.id, n: ready.length });
    }
    const idle = [...this.wave].map((id) => W.byId.get(id)).filter((u) => u && u.order.type === 'idle');
    if (idle.length) { this.markSwept(idle); const s = this.targetFor(enemy, [idle[0].x, idle[0].y]); if (s) for (const u of idle) W.order(u, { type: 'attackMove', x: s[0], y: s[1] }); }
  }
}
