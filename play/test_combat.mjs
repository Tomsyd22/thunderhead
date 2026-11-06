// Fit and verify the damage table (data/combat.json) with real engine duels on Emerald Strait's blue pad.
//   node play/test_combat.mjs [--fit]      (--fit rewrites the fitted cells in data/combat.json, then verifies)
// Targets (playtest round 1, real seconds at the default game speed):
//   · a rifle squad (5 of a faction's rifle infantry) kills a basic tank in 25–30 s
//   · a tank needs 5–6 shots per rifleman
//   · tank vs tank: 10–15 s
// Within each band the cost of the two sides sets where a pairing lands (dearer units last longer / kill faster).
// Then the full single-unit matchup table checks that the counters still work.
let __s = 11; Math.random = () => { __s |= 0; __s = (__s + 0x6D2B79F5) | 0; let t = Math.imul(__s ^ (__s >>> 15), 1 | __s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeMapTerrain } from './mapdata.js';
import { createMatch, applyMapping } from './setup.js';
import { applyCombat, packTable, ARMOURS } from './combat.js';
import { TICK } from './engine/mech.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..'), FIT = process.argv.includes('--fit');
const M01 = path.join(ROOT, 'maps', 'lab', 'data', '01'); const rd = (f) => fs.readFileSync(path.join(M01, f));
const meta = JSON.parse(rd('map.json')), instances = JSON.parse(rd('instances.json')); const hb = rd('height.f32');
const u8 = (f) => { const b = rd(f); return new Uint8Array(b.buffer, b.byteOffset, b.length); };
const T = makeMapTerrain({ meta, height: new Float32Array(hb.buffer, hb.byteOffset, hb.length / 4), surface: u8('surface.u8'), nav: u8('nav.u8'), deck: u8('deck.u8'), instances });
const spec = applyMapping(JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'unit_specs.json'))), JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'faction_mapping.json'))));
const geom = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'sockets.json'))), pace = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pace.json')));
const CPATH = path.join(ROOT, 'data', 'combat.json');
let combat = fs.existsSync(CPATH) ? JSON.parse(fs.readFileSync(CPATH)) : null;
if (!combat) combat = { _doc: '', ttk_scale: 1, table: packTable(spec), fitted: {} };
const GS = pace.game_speed;   // targets are real seconds at the default game speed
const M = createMatch({ T, spec, geom, pace, players: [{ faction: 'compact', pad: 'B1' }, { faction: 'lattice', pad: 'R1' }], startUnits: false });
const W = M.world; W.dmgScale = 1 / (combat.ttk_scale || 1);
const setTable = () => { W.damageMul = applyCombat({ units: Object.values(W.spec) }, combat); };
setTable();
const SP = (id) => W.spec[id], X0 = 470, Y0 = 1420;
function clear() { for (const u of W.units) W.byId.delete(u.id); W.units = []; W.proj = []; W.events.length = 0; W.vis = new Map(); }
/** time (game s) for `att` units to kill a passive `def`; also returns shots that hit */
function duel(attIds, defId, gap = 14, opts = {}) {
  clear(); const def = W.spawn(defId, 1, X0, Y0, { hdg: Math.PI }); def.passive = !opts.fightBack; const air = def.dom === 'air' || def.kind === 'ship';
  if (def.kind === 'ship') return null;
  const att = attIds.map((id, k) => { const off = (k - (attIds.length - 1) / 2) * 2.2; const u = W.spawn(id, 0, X0 - gap - def.r - (SP(id).collision_radius_m), Y0 + off, { hdg: 0 }); return u; });
  for (const u of att) W.order(u, { type: 'attack', target: def.id });
  let t0 = null, hits = 0;
  for (let i = 0; i < 400 / TICK; i++) {
    W.step(); for (const e of W.events) if (e.type === 'damage' && e.id === def.id) { if (t0 == null) t0 = W.t; hits++; } W.events.length = 0;
    if (!def.alive) return { t: W.t - t0, hits, att: att.filter((u) => u.alive).length };
    if (opts.fightBack && att.every((u) => !u.alive)) return { t: null, lost: true, defHp: def.hp / def.maxHp };
  }
  return { t: null, hits, timeout: true, air };
}
const real = (g) => g / GS;
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
const RIFLE = { compact: ['H01', 'rifle'], helix: ['A01', 'carbine'], lattice: ['T01', 'pulse'] };
const TANK = { compact: 'H03', helix: 'A03', lattice: 'T03' };
const CANNON = { H03: 'cannon_heavy', A03: 'cannon_precision', T03: 'accelerator' };
const squadTarget = (rid, tid) => clip(27.5 * Math.pow(SP(tid).cost / 850, 0.3) * Math.pow(750 / (SP(rid).cost * 5), 0.2), 25, 30);
const duelTarget = (aid, did) => clip(12.5 * Math.pow(SP(did).cost / SP(aid).cost, 0.6), 10, 15);

const lines = []; const say = (s) => { lines.push(s); console.log(s); };
if (FIT) {
  // tank shells vs infantry: 23 damage per hit → 5 shots on 100 HP, 6 on 125–130 HP
  for (const [tid, c] of Object.entries(CANNON)) combat.table[c].infantry = +(23 / SP(tid).weapons[0].damage).toFixed(4);
  for (let it = 0; it < 4; it++) {
    setTable(); let worst = 0;
    for (const [, [rid, rt]] of Object.entries(RIFLE)) for (const tid of Object.values(TANK)) {
      const r = duel([rid, rid, rid, rid, rid], tid, 10); const a = SP(tid).armour_type, want = squadTarget(rid, tid);
      if (r.t) { const k = real(r.t) / want; combat.table[rt][a] = +(combat.table[rt][a] * k).toFixed(4); worst = Math.max(worst, Math.abs(k - 1)); }
    }
    for (const aid of Object.values(TANK)) for (const did of Object.values(TANK)) {
      const r = duel([aid], did, 30); const a = SP(did).armour_type, want = duelTarget(aid, did);
      if (r.t) { const k = real(r.t) / want; combat.table[CANNON[aid]][a] = +(combat.table[CANNON[aid]][a] * k).toFixed(4); worst = Math.max(worst, Math.abs(k - 1)); }
    }
    console.log(`fit pass ${it + 1}: worst correction ${(worst * 100).toFixed(1)} %`); if (worst < 0.02) break;
  }
  combat._doc = 'Weapon type × armour type damage table (play/combat.js). Damage per hit = weapon base damage × table[type][armour] × veterancy / ttk_scale. Cells for rifles vs tanks, tank cannons vs tanks and tank cannons vs infantry are fitted by play/test_combat.mjs --fit to the round-1 playtest targets (real seconds at the default game speed); the rest come from the pack\'s per-weapon multipliers. ttk_scale is the in-game time-to-kill slider (1 = these targets; 2 = fights last twice as long).';
  combat.fitted = { date: new Date().toISOString().slice(0, 10), game_speed: GS, rifle_squad: 5, targets: { rifle_squad_vs_tank_s: [25, 30], tank_shots_per_rifleman: [5, 6], tank_vs_tank_s: [10, 15] } };
  combat.ttk_scale = combat.ttk_scale || 1;
  fs.writeFileSync(CPATH, JSON.stringify(combat, null, 1)); setTable();
}

// ── verification ──
let pass = 0, fail = 0; const check = (name, ok, info) => { ok ? pass++ : fail++; say(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
say(`\n## Targets (real seconds at ${GS}×, ttk_scale ${combat.ttk_scale})\n`);
say('| Rifle squad (5) | vs Bastion | vs Arbiter | vs Wisp |'); say('|---|---|---|---|');
const rs = [];
for (const [, [rid]] of Object.entries(RIFLE)) { const row = [SP(rid).name]; for (const tid of [TANK.compact, TANK.helix, TANK.lattice]) { const r = duel([rid, rid, rid, rid, rid], tid, 10); rs.push(real(r.t)); row.push(`${real(r.t).toFixed(1)} s`); } say(`| ${row.join(' | ')} |`); }
check('rifle squad vs basic tank: 25–30 s', rs.every((x) => x >= 24.5 && x <= 30.5), `${Math.min(...rs).toFixed(1)}–${Math.max(...rs).toFixed(1)} s`);
say('\n| Tank shells per rifleman | Conscript | Ranger | Pulse Trooper |'); say('|---|---|---|---|'); const sh = [];
for (const tid of Object.values(TANK)) { const row = [SP(tid).name]; for (const rid of ['H01', 'A01', 'T01']) { const r = duel([tid], rid, 30); sh.push(r.hits); row.push(`${r.hits} (${real(r.t).toFixed(1)} s)`); } say(`| ${row.join(' | ')} |`); }
check('tank shells per rifleman: 5–6', sh.every((x) => x >= 5 && x <= 6), sh.join(', '));
say('\n| Tank vs tank (attacker ↓, target →) | Bastion | Arbiter | Wisp |'); say('|---|---|---|---|'); const tt = [];
for (const aid of Object.values(TANK)) { const row = [SP(aid).name]; for (const did of [TANK.compact, TANK.helix, TANK.lattice]) { const r = duel([aid], did, 30); tt.push(real(r.t)); row.push(`${real(r.t).toFixed(1)} s`); } say(`| ${row.join(' | ')} |`); }
check('tank vs tank: 10–15 s', tt.every((x) => x >= 9.7 && x <= 15.3), `${Math.min(...tt).toFixed(1)}–${Math.max(...tt).toFixed(1)} s`);
// actual fights with return fire, for information
const fights = [];
for (const [f, [rid]] of Object.entries(RIFLE)) { const tid = TANK[f]; const r = duel([rid, rid, rid, rid, rid], tid, 10, { fightBack: true }); fights.push(`${SP(rid).name} ×5 vs ${SP(tid).name}: ${r.lost ? `tank wins with ${(r.defHp * 100).toFixed(0)} % HP left` : `squad wins in ${real(r.t).toFixed(1)} s with ${r.att} left`}`); }
say('\nWith the tank firing back: ' + fights.join('; ') + '.');

// ── matchup table: single unit vs single passive unit, cost efficiency ──
const ROSTER = ['H01', 'H02', 'H03', 'H04', 'A01', 'A03', 'A04', 'T01', 'T02', 'T03', 'T04'];
const ttk = {}; for (const a of ROSTER) for (const d of ROSTER) { if (a === 'A04' || d === 'A04') continue; const r = duel([a], d, Math.min(...SP(a).weapons.map((w) => w.range_m)) * 0.6); ttk[a + d] = r && r.t ? real(r.t) : null; }
// value: share of the defender's cost destroyed per second per 1000 spent on the attacker
const val = (a, d) => ttk[a + d] ? SP(d).cost / ttk[a + d] / SP(a).cost * 1000 : 0;
say('\n## Matchup table: seconds for one attacker (row) to kill one target (column); — = cannot attack\n');
const R2 = ROSTER.filter((x) => x !== 'A04');
say('| | ' + R2.map((d) => SP(d).name).join(' | ') + ' |'); say('|---|' + R2.map(() => '---').join('|') + '|');
for (const a of R2) say(`| **${SP(a).name}** | ` + R2.map((d) => ttk[a + d] ? ttk[a + d].toFixed(0) : '—').join(' | ') + ' |');
const beats = (a, d) => val(a, d) > val(d, a);
/** equal-money group fight with return fire: side A (left) vs side B (right); returns the winning side and survivors */
function fight(A, B) {
  clear(); const mk = (ids, team, x0, dir) => ids.map((id, k) => { const col = k % 4, row = Math.floor(k / 4); return W.spawn(id, team, x0 + dir * row * 1.7, Y0 + (col - 1.5) * 1.7, { hdg: dir > 0 ? Math.PI : 0 }); });
  const a = mk(A, 0, X0 - 22, -1), b = mk(B, 1, X0 + 22, 1);
  for (const u of a) W.order(u, { type: 'attackMove', x: X0 + 40, y: Y0 }); for (const u of b) W.order(u, { type: 'attackMove', x: X0 - 40, y: Y0 });
  const t0 = W.t; for (let i = 0; i < 300 / TICK; i++) { W.step(); W.events.length = 0; const la = a.filter((u) => u.alive), lb = b.filter((u) => u.alive); if (!la.length || !lb.length) return { win: la.length ? 'A' : 'B', left: (la.length ? la : lb).map((u) => u.uid + ' ' + Math.round(u.hp / u.maxHp * 100) + '%'), t: real(W.t - t0) }; }
  return { win: 'none' };
}
const n = (inf, tank) => Math.round(SP(tank).cost / SP(inf).cost);
const FIGHTS = [
  ['Bastion beats its cost in Conscripts', ['H03'], Array(n('H01', 'H03')).fill('H01'), 'A'], ['Arbiter beats its cost in Pulse Troopers', ['A03'], Array(n('T01', 'A03')).fill('T01'), 'A'],
  ['Wisp beats its cost in Rangers', ['T03'], Array(n('A01', 'T03')).fill('A01'), 'A'], ['Bastion beats its cost in Rangers', ['H03'], Array(n('A01', 'H03')).fill('A01'), 'A'],
  ['Rocket Troopers beat their cost in Bastions', Array(n('H02', 'H03')).fill('H02'), ['H03'], 'A'], ['Nullifiers beat their cost in Arbiters', Array(n('T02', 'A03')).fill('T02'), ['A03'], 'A'],
  ['Rocket Troopers beat their cost in Wisps', Array(n('H02', 'T03')).fill('H02'), ['T03'], 'A'],
  ['Conscripts beat their cost in Rocket Troopers', ['H01', 'H01', 'H01', 'H01', 'H01', 'H01'], ['H02', 'H02'], 'A'], ['Pulse Troopers beat their cost in Nullifiers', ['T01', 'T01', 'T01', 'T01', 'T01', 'T01', 'T01', 'T01'], ['T02', 'T02', 'T02', 'T02', 'T02'], 'A'],
];
say('\n## Equal-money fights with return fire\n');
for (const [name, A, B, want] of FIGHTS) { const r = fight(A, B); check(name, r.win === want, `${A.length}× ${SP(A[0]).name} vs ${B.length}× ${SP(B[0]).name}: ${r.win === 'A' ? SP(A[0]).name : r.win === 'B' ? SP(B[0]).name : 'nobody'} wins in ${r.t ? r.t.toFixed(0) : '–'} s (${(r.left || []).join(', ')})`); }
const C = [
  ['Rocket Trooper beats Bastion', 'H02', 'H03'], ['Rocket Trooper beats Wisp', 'H02', 'T03'], ['Nullifier beats Bastion', 'T02', 'H03'], ['Nullifier beats Arbiter', 'T02', 'A03'],
  ['Conscript beats Rocket Trooper', 'H01', 'H02'], ['Pulse Trooper beats Rocket Trooper', 'T01', 'H02'], ['Ranger beats Nullifier', 'A01', 'T02'],
  ['Rocket Trooper beats Hammer (AA)', 'H02', 'H04'], ['Rocket Trooper beats Mote (AA)', 'H02', 'T04'], ['Nullifier beats Hammer (AA)', 'T02', 'H04'], ['Hammer beats Bastion', 'H04', 'H03'], ['Hammer beats Arbiter', 'H04', 'A03'],
];
say('\n## Counters, single units (cost-for-cost: money destroyed per second per 1000 spent)\n');
for (const [name, a, d] of C) check(name, beats(a, d), `${val(a, d).toFixed(1)} vs ${val(d, a).toFixed(1)}`);
say(`\n${pass}/${pass + fail} checks passed`);
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true }); fs.writeFileSync(path.join(HERE, 'results', 'combat.md'), '# Combat tuning\n' + lines.join('\n') + '\n');
process.exit(fail ? 1 : 0);
