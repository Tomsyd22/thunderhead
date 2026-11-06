// Thunderhead Easy AI (round 1). The Normal AI's base building with deliberate handicaps, for new players:
//   reacts half as often (thinks every second game second), one refinery and one harvester per refinery,
//   one item at a time in each queue and only after saving up a reserve, a small army (12 at most, no aircraft or ships),
//   slow defence (answers an attack on its base at most every 20 s), first attack at 7 game minutes with 4 units,
//   then every 4 minutes, growing by one. No repairs, no engineers. Same rules and economy as everyone else.
import { STRUCTURES, FACTIONS } from './rules.js';
import { AI } from './ai.js';

const ORDER_EASY = ['power', 'refinery', 'barracks', 'power', 'factory', 'power'];

export class EasyAI extends AI {
  constructor(game, p, kitItems) { super(game, p, kitItems); this.level = 'easy'; this.tick2 = false; }
  think() { this.tick2 = !this.tick2; if (this.tick2) return; const g = this.g, p = this.p; if (p.lost || g.over) return; if (p.ready) this.placeReady(); this.buildStructures(); this.produce(); this.army(); }
  wantStructure() {
    const pw = this.p.power; if (this.p.queues.structure.length || this.p.ready) return null;
    if (pw.made - pw.used < 20 && this.count('power') < 4) return 'power';
    for (let i = 0; i < ORDER_EASY.length; i++) { const k = ORDER_EASY[i], need = ORDER_EASY.slice(0, i + 1).filter((x) => x === k).length; if (this.count(k) < need) return this.g.available(this.p, 'structure', k) ? k : null; }
    return null;
  }
  buildStructures() { const k = this.wantStructure(); if (k && this.p.credits > STRUCTURES[k].cost) this.g.enqueue(this.p, 'structure', k); }
  produce() {
    const g = this.g, p = this.p, W = g.world, F = FACTIONS[p.faction], harv = g.unitsOf(p).filter((u) => u.uid === 'HV').length, refs = this.structs.filter((b) => b.kind === 'refinery').length;
    if (g.has(p, 'factory') && harv < refs && !p.queues.vehicle.some((i) => i.key === 'HV')) g.enqueue(p, 'vehicle', 'HV');
    const army = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer).length; if (army >= 12 || p.credits < 1200) return;
    const pickFrom = (list) => list.filter((k) => W.spec[k] && W.spec[k].weapons.length);
    for (const [cat, list] of [['infantry', pickFrom(F.infantry)], ['vehicle', pickFrom(F.vehicle.filter((u) => u !== 'HV'))]]) {
      if (!g.has(p, cat === 'infantry' ? 'barracks' : 'factory') || p.queues[cat].length || !list.length) continue; const k = list[(this.next++) % list.length]; if (p.credits > g.costOf(cat, k) + 1000) g.enqueue(p, cat, k);
    }
  }
  army() {
    const g = this.g, W = g.world, p = this.p; const units = g.unitsOf(p).filter((u) => u.uid !== 'HV' && !u.m.engineer && !u.rollOut);
    const threat = g.events.filter((e) => e.type === 'under_attack' && e.player === p.id && e.building && g.t - e.t < 3).pop();
    if (threat && g.t - this.defending > 20) { this.defending = g.t; W.orderGroup(units.filter((u) => !this.wave.has(u.id)), { type: 'attackMove', x: threat.x, y: threat.y }); return; }
    for (const u of units) if (u.order.type === 'idle' && !this.wave.has(u.id) && Math.hypot(u.x - this.stage[0], u.y - this.stage[1]) > 40) W.order(u, { type: 'attackMove', x: this.stage[0] + (Math.random() - 0.5) * 40, y: this.stage[1] + (Math.random() - 0.5) * 40 });
    this.wave = new Set([...this.wave].filter((id) => { const u = W.byId.get(id); return u && u.alive; }));
    const size = Math.min(10, 4 + this.waves), ready = units.filter((u) => !this.wave.has(u.id));
    if (g.t > 420 && g.t - this.lastWave > 240 && ready.length >= size) {
      const enemy = this.enemies()[0]; if (!enemy) return; const tgt = g.structures(enemy).sort((a, b) => Math.hypot(a.x - p.start.x, a.y - p.start.y) - Math.hypot(b.x - p.start.x, b.y - p.start.y))[0]; if (!tgt) return;
      this.waves++; this.lastWave = g.t; for (const u of ready) this.wave.add(u.id); W.orderGroup(ready, { type: 'attackMove', x: tgt.x, y: tgt.y }); g.emit('ai_wave', { player: p.id, n: ready.length });
    }
    for (const id of this.wave) { const u = W.byId.get(id); if (u && u.order.type === 'idle') { const enemy = this.enemies()[0]; const s = enemy && g.structures(enemy)[0]; if (s) W.order(u, { type: 'attackMove', x: s.x, y: s.y }); } }
  }
}
