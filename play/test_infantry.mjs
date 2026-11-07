// Infantry / anti-air balance harness (playtest round 2). Headless engine fights on Emerald Strait's blue pad (open, flat;
// the start yards are removed), with the game's damage table (data/combat.json) and the real unit specs (play/data).
//   node play/test_infantry.mjs --tag before|after [--runs 20]
// Writes play/results/infantry_<tag>.json; with both tags present it also writes play/results/infantry.md (BEFORE and
// AFTER side by side) and play/results/infantry.json (both runs).
// Every run re-seeds Math.random from the matchup name and the run index, and the world clock and ids restart, so a run
// reproduces on its own. Start offsets (gap, lateral shift, per-unit jitter) are drawn from that seed.
// (a) equal-cost rifle fights: floor($1000 / cost) of each rifleman, both sides attack-move into each other from out of range.
//     Ranger three ways: "moving" (never deploys), "set up" (deployed as a machine gun at the start, holds), "in battle"
//     (advances and deploys as the Hard AI's deployMicro() does: once a second, a mobile Ranger with a target inside
//     min(30 m, 1.2 × MG range) is given the engine's deploy order and pays the 0.8 s setup; a deployed Ranger left with
//     nothing to shoot for 3 s attack-moves on, which packs it up — the AI's wave logic does the same).
// (b) $1000 of each rifleman (and the 5-man squad the fit target is defined for) against one basic tank of each faction:
//     the passive-tank kill time (the fit's 25–30 s measure) and a real fight with the tank firing back.
// (c) $2000 mixed groups, faction against faction: a third of the money to the specialist slot (whole units), the rest to
//     riflemen; Helix uses Rangers (in battle) + the Halo, and a Rangers-only list.
// (d) anti-air over a base: a Hammer wave attack-moves onto a construction yard (3000 HP) guarded by anti-air.
// Money's worth surviving = Σ cost × hp / maxHp over survivors + money left unspent by the whole-unit purchase (counted
// at face value, it is still in the bank). Fight length = first damage to the last kill, in REAL seconds at game speed 2.4.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeMapTerrain } from './mapdata.js';
import { createMatch, applyMapping } from './setup.js';
import { HardAI } from './ai_hard.js';
import { TICK } from './engine/mech.js';

let __s = 1; Math.random = () => { __s |= 0; __s = (__s + 0x6D2B79F5) | 0; let t = Math.imul(__s ^ (__s >>> 15), 1 | __s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const seed = (name, k) => { let h = 2166136261; for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619); __s = (h ^ (k * 7919)) | 0; };
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..'), args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TAG = arg('--tag', 'after'), RUNS = +arg('--runs', 20), RES = path.join(HERE, 'results');
const M01 = path.join(ROOT, 'maps', 'lab', 'data', '01'); const rd = (f) => fs.readFileSync(path.join(M01, f));
const meta = JSON.parse(rd('map.json')), instances = JSON.parse(rd('instances.json')); const hb = rd('height.f32');
const u8 = (f) => { const b = rd(f); return new Uint8Array(b.buffer, b.byteOffset, b.length); };
const T = makeMapTerrain({ meta, height: new Float32Array(hb.buffer, hb.byteOffset, hb.length / 4), surface: u8('surface.u8'), nav: u8('nav.u8'), deck: u8('deck.u8'), instances });
const J = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'data', f)));
const spec = applyMapping(J('unit_specs.json'), J('faction_mapping.json')), pace = J('pace.json'), combat = J('combat.json');
// --patch file.json: try a variant without editing the data ({ units: { H01: { health: 90, weapons: [{ damage: 8 }] } }, table: { rifle: { infantry: 1 } } })
const PATCH = arg('--patch', null), ONLY = arg('--only', 'a,b,c,d').split(',');
if (PATCH) { const P = JSON.parse(fs.readFileSync(PATCH)); for (const [id, o] of Object.entries(P.units || {})) { const u = spec.units.find((x) => x.id === id); const { weapons, ...rest } = o; Object.assign(u, rest); (weapons || []).forEach((w, i) => w && Object.assign(u.weapons[i], w)); }
  for (const [t, row] of Object.entries(P.table || {})) combat.table[t] = Object.assign(combat.table[t] || {}, row); }
const GS = pace.game_speed, real = (g) => g / GS;
const M = createMatch({ T, spec, geom: J('sockets.json'), pace, combat, players: [{ faction: 'compact', pad: 'B1' }, { faction: 'lattice', pad: 'R1' }], startUnits: false });
const W = M.world; for (const b of W.buildings.slice()) W.removeBuilding(b);   // open ground: no start yards
const SP = (id) => W.spec[id], has = (id) => !!W.spec[id];
const X0 = 470, Y0 = 1420, PAD = meta.pads.find((p) => p.id === 'B1').center;
function reset() { for (const u of W.units) W.byId.delete(u.id); for (const b of W.buildings.slice()) W.removeBuilding(b); W.units = []; W.proj = []; W.events.length = 0; W.vis = new Map(); W.t = 0; W.tick = 0; W.nextId = 1000; W.scans = []; }
const rnd = (a, b) => a + (b - a) * Math.random();

// ── a side: a list of { id, mode } with the money it was bought from ──
/** whole units only: n = floor(money / cost); returns { ids, spent, left } */
function buy(money, parts) {   // parts: [[id, share of the money], ...] — the last part takes what is left
  const ids = []; let left = money;
  parts.forEach(([id, share], i) => { const m = i === parts.length - 1 ? left : money * share; const n = Math.floor(m / SP(id).cost + 1e-9); for (let k = 0; k < n; k++) ids.push(id); left -= n * SP(id).cost; });
  return { ids, spent: money - left, left };
}
function spawnGroup(ids, team, cx, cy, dir, setUp) {
  const out = []; const nInf = ids.filter((id) => SP(id).armor === 'infantry').length;
  let ki = 0, kv = 0;
  for (const id of ids) {
    const veh = SP(id).armor !== 'infantry'; let x, y;
    if (veh) { x = cx + dir * 3 - dir * kv * 9; y = cy + (kv % 2 ? 6 : -6); kv++; }   // vehicles a few metres ahead of / beside the infantry
    else { const col = ki % 4, row = Math.floor(ki / 4); x = cx - dir * row * 1.8 + rnd(-0.4, 0.4); y = cy + (col - 1.5) * 1.8 + rnd(-0.4, 0.4); ki++; }
    const u = W.spawn(id, team, x, y, { hdg: dir > 0 ? 0 : Math.PI }); u.owner = team;
    if (setUp && u.m.deploy) W._setDeploy(u, 'deployed');
    out.push(u);
  }
  void nInf; return out;
}
const value = (us) => us.reduce((a, u) => a + (u.alive ? u.sp.cost * u.hp / u.maxHp : 0), 0);
// the Hard AI's deploy micro, run on this side's units (same method, same engine order)
const microCtx = (list) => ({ W, op: null, g: { unitsOf: () => list.filter((u) => u.alive) }, p: null, retreating: new Set(), scout: null, focusPrev: new Map(), wave: new Set(), wDps: HardAI.prototype.wDps });
function inBattle(list, foes) {
  HardAI.prototype.deployMicro.call(microCtx(list));
  const alive = foes.filter((u) => u.alive); if (!alive.length) return;
  const c = [alive.reduce((a, u) => a + u.x, 0) / alive.length, alive.reduce((a, u) => a + u.y, 0) / alive.length];
  const stale = list.filter((u) => u.alive && u.deploy === 'deployed' && u.target == null && W.t - (u.lastShotT ?? u.deployT) > 3);
  if (stale.length) W.orderGroup(stale, { type: 'attackMove', x: c[0], y: c[1] });
}
/** one fight: A (left, moving right) vs B (right, moving left). spec: { ids, left, mode: 'moving' | 'setup' | 'battle' } */
function fight(name, k, A, B, opts = {}) {
  seed(name, k); reset();
  const gap = rnd(52, 64), lat = rnd(-6, 6), yA = Y0 + lat + rnd(-2, 2), yB = Y0 + lat + rnd(-2, 2);
  const a = spawnGroup(A.ids, 0, X0 - gap / 2, yA, 1, A.mode === 'setup'), b = spawnGroup(B.ids, 1, X0 + gap / 2, yB, -1, B.mode === 'setup');
  if (A.mode !== 'setup') W.orderGroup(a, { type: 'attackMove', x: X0 + 90, y: Y0 });
  if (B.mode !== 'setup' && !opts.passiveB) W.orderGroup(b, { type: 'attackMove', x: X0 - 90, y: Y0 });
  if (opts.passiveB) { for (const u of b) u.passive = true; if (A.mode === 'setup') W.orderGroup(b, { type: 'move', x: X0 - gap / 2 + 16, y: yA }); }   // a passive target drives through a set-up gun line
  const push = (us, foes) => {   // like an AI wave that ran out of targets: idle units attack-move onto what is left of the enemy
    const al = foes.filter((u) => u.alive); if (!al.length) return; const c = [al.reduce((x, u) => x + u.x, 0) / al.length, al.reduce((x, u) => x + u.y, 0) / al.length];
    const idle = us.filter((u) => u.alive && u.order.type === 'idle' && u.target == null && !u.path && (!u.deploy || u.deploy === 'mobile')); if (idle.length) W.orderGroup(idle, { type: 'attackMove', x: c[0], y: c[1] }); };
  let t0 = null, tEnd = null; const LIM = (opts.limit || 240) / TICK;
  for (let i = 0; i < LIM; i++) {
    W.step();
    for (const e of W.events) { if (e.type === 'damage' && t0 == null) t0 = W.t; if (e.type === 'fire') { const u = W.byId.get(e.id); if (u) u.lastShotT = W.t; } } W.events.length = 0;
    if (W.tick % 30 === 0) { if (A.mode === 'battle') inBattle(a, b); if (B.mode === 'battle') inBattle(b, a); if (A.mode !== 'setup') push(a, b); if (B.mode !== 'setup' && !opts.passiveB) push(b, a); }
    const la = a.some((u) => u.alive), lb = b.some((u) => u.alive);
    if (!la || !lb) { tEnd = W.t; break; }
  }
  const la = a.some((u) => u.alive), lb = b.some((u) => u.alive);
  const win = la && !lb ? 'A' : lb && !la ? 'B' : 'none';
  return { win, t: t0 != null && tEnd != null ? real(tEnd - t0) : null, valA: value(a) + A.left, valB: value(b) + B.left, nA: a.filter((u) => u.alive).length, nB: b.filter((u) => u.alive).length };
}
function series(name, A, B, opts = {}) {
  const runs = []; for (let k = 0; k < (opts.runs || RUNS); k++) runs.push(fight(name, k, A, B, opts));
  const wa = runs.filter((r) => r.win === 'A').length, wb = runs.filter((r) => r.win === 'B').length, n = runs.length;
  const ts = runs.filter((r) => r.t != null).map((r) => r.t), avg = (xs) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null;
  const winVal = avg(runs.filter((r) => r.win !== 'none').map((r) => r.win === 'A' ? r.valA : r.valB)), loseVal = avg(runs.filter((r) => r.win !== 'none').map((r) => r.win === 'A' ? r.valB : r.valA));
  const wonBy = wa >= wb ? 'A' : 'B', aVal = avg(runs.map((r) => r.valA)), bVal = avg(runs.map((r) => r.valB));
  const flag = Math.max(wa, wb) / n > 0.65;
  return { name, A: { label: A.label, ids: count(A.ids), spent: A.spent, left: A.left, mode: A.mode }, B: { label: B.label, ids: count(B.ids), spent: B.spent, left: B.left, mode: B.mode }, n, winA: wa / n, winB: wb / n, draws: n - wa - wb,
    t: avg(ts), tMin: ts.length ? Math.min(...ts) : null, tMax: ts.length ? Math.max(...ts) : null, valWinner: winVal, valLoser: loseVal, valA: aVal, valB: bVal, wonBy, flag, runs: runs.map((r) => ({ win: r.win, t: r.t && +r.t.toFixed(2), valA: Math.round(r.valA), valB: Math.round(r.valB) })) };
}
const count = (ids) => { const c = {}; for (const id of ids) c[id] = (c[id] || 0) + 1; return c; };
const side = (label, money, parts, mode = 'moving') => Object.assign({ label, mode }, buy(money, parts));

const R = { tag: TAG, date: new Date().toISOString().slice(0, 10), game_speed: GS, runs: RUNS, units: {}, a: [], b: [], c: [], d: [] };
for (const id of ['H01', 'H02', 'H03', 'H04', 'A01', 'A03', 'A06', 'T01', 'T02', 'T03']) if (has(id)) { const s = SP(id); R.units[id] = { name: s.name, cost: s.cost, hp: s.health, speed: s.speed_mps, weapons: s.weapons.map((w) => ({ name: w.name, damage: w.damage, cycle: w.cycle_s, range: w.range_m, type: w.wtype, targets: w.targets })) }; }
R.table = combat.table;
const RIFLE = { H01: 'Conscript', A01: 'Ranger', T01: 'Pulse Trooper' };
const RANGER = [['moving', 'Ranger (moving)'], ['setup', 'Ranger (set up)'], ['battle', 'Ranger (in battle)']];

// ── (a) equal-cost rifle fights ──
console.log(`\n(a) equal-cost rifle fights, $1000 a side, ${RUNS} runs each`);
const A_PAIRS = [[side('Conscript', 1000, [['H01', 1]]), side('Pulse Trooper', 1000, [['T01', 1]])]];
for (const [mode, lab] of RANGER) { A_PAIRS.push([side('Conscript', 1000, [['H01', 1]]), side(lab, 1000, [['A01', 1]], mode)]); }
for (const [mode, lab] of RANGER) { A_PAIRS.push([side('Pulse Trooper', 1000, [['T01', 1]]), side(lab, 1000, [['A01', 1]], mode)]); }
if (ONLY.includes('a')) for (const [A, B] of A_PAIRS) { const r = series(`a:${A.label}|${B.label}`, A, B); R.a.push(r); console.log(`  ${A.label} ×${A.ids.length} vs ${B.label} ×${B.ids.length}: ${pct(r.winA)} / ${pct(r.winB)}, ${fmt(r.t)} s, winner keeps $${fmt(r.valWinner, 0)}${r.flag ? '  ⚑' : ''}`); }

// ── (b) infantry vs one basic tank ──
console.log('\n(b) rifles vs one basic tank');
const TANKS = ['H03', 'A03', 'T03'];
const B_SIDES = [['H01', 'moving', 'Conscript'], ['T01', 'moving', 'Pulse Trooper'], ...RANGER.map(([m, l]) => ['A01', m, l])];
if (ONLY.includes('b')) for (const [rid, mode, lab] of B_SIDES) for (const tid of TANKS) for (const squad of [false, true]) {
  const A = squad ? Object.assign({ label: lab + ' ×5', mode, ids: Array(5).fill(rid), spent: 5 * SP(rid).cost, left: 0 }) : side(lab, 1000, [[rid, 1]], mode);
  const Bt = { label: SP(tid).name, mode: 'moving', ids: [tid], spent: SP(tid).cost, left: 0 };
  const passive = series(`bp:${A.label}|${tid}`, A, Bt, { passiveB: true, runs: Math.min(RUNS, 10) });
  const r = series(`b:${A.label}|${tid}`, A, Bt);
  r.passiveT = passive.t; r.squad = squad; r.rifle = rid; r.tank = tid; R.b.push(r);
  console.log(`  ${A.label} ${squad ? '' : `×${A.ids.length} `}vs ${SP(tid).name}: passive tank dies in ${fmt(passive.t)} s · real fight ${pct(r.winA)} rifles win, ${fmt(r.t)} s`);
}

// ── (c) equal-cost mixed groups, $2000 a side ──
console.log('\n(c) mixed groups, $2000 a side');
// a third of the money buys whole specialists, the rest whole riflemen; what is left stays in the bank
const MIX = { compact: side('Compact: Conscripts + Rocket Troopers', 2000, [['H02', 1 / 3], ['H01', 1]]), lattice: side('Lattice: Pulse Troopers + Nullifiers', 2000, [['T02', 1 / 3], ['T01', 1]]),
  helixR: side('Helix: Rangers only', 2000, [['A01', 1]], 'battle') };
if (has('A06')) MIX.helix = side('Helix: Rangers + Halo', 2000, [['A06', 1 / 3], ['A01', 1]], 'battle');
const C_PAIRS = [['compact', 'lattice'], ['compact', 'helix'], ['lattice', 'helix'], ['compact', 'helixR'], ['lattice', 'helixR']];
if (ONLY.includes('c')) for (const [x, y] of C_PAIRS) { if (!MIX[x] || !MIX[y]) { R.c.push({ name: `c:${x}|${y}`, missing: true, A: { label: (MIX[x] || {}).label || x }, B: { label: (MIX[y] || {}).label || 'Helix: Rangers + Halo (A06 not in the game yet)' } }); continue; }
  const r = series(`c:${x}|${y}`, MIX[x], MIX[y], { limit: 300 }); R.c.push(r); console.log(`  ${MIX[x].label} vs ${MIX[y].label}: ${pct(r.winA)} / ${pct(r.winB)}, ${fmt(r.t)} s${r.flag ? '  ⚑' : ''}`); }

// ── (d) anti-air over a base ──
// A Hammer wave attack-moves onto a construction yard (30 × 24 m, 3000 HP) from 160 m out (random bearing within ±40° of
// east); the defenders guard spots 16–30 m from the yard's centre (guard: engage anything within 1.5 × range + 10 m of the
// spot), and once a second a defender with nothing to shoot attack-moves toward the nearest Hammer within 150 m (the Hard
// AI sends its anti-air to an air raid the same way). Defenders win if every Hammer dies before the yard falls.
console.log('\n(d) anti-air over a base');
function airRaid(name, k, nH, defIds) {
  seed(name, k); reset();
  const yard = W.placeBuilding({ x: PAD[0], y: PAD[1], w: 30, d: 24, h: 10, hp: 3000, team: 1, kind: 'yard', name: 'Construction Yard', cost: 3000 });
  const defs = defIds.map((id) => { const a = rnd(0, Math.PI * 2), r = rnd(16, 30); const u = W.spawn(id, 1, PAD[0] + Math.cos(a) * r, PAD[1] + Math.sin(a) * r, { hdg: 0 }); W.order(u, { type: 'guard', x: u.x, y: u.y }); return u; });
  const brg = rnd(-0.7, 0.7), hs = []; for (let i = 0; i < nH; i++) { const col = i % 5, row = Math.floor(i / 5); const cx = PAD[0] + Math.cos(brg) * (160 + row * 8), cy = PAD[1] + Math.sin(brg) * (160 + row * 8); const off = (col - 2) * 9;
    const u = W.spawn('H04', 0, cx - Math.sin(brg) * off, cy + Math.cos(brg) * off, { hdg: brg + Math.PI }); hs.push(u); }
  W.orderGroup(hs, { type: 'attackMove', x: PAD[0], y: PAD[1] });
  let t0 = null, tEnd = null;
  for (let i = 0; i < 180 / TICK; i++) { W.step(); for (const e of W.events) if (e.type === 'damage' && t0 == null) t0 = W.t; W.events.length = 0; if (!yard.alive || !hs.some((u) => u.alive)) { tEnd = W.t; break; }
    if (W.tick % 30 === 0) for (const u of defs) {   // as the Hard AI does with its anti-air: idle guards go for the nearest aircraft over the base
      if (!u.alive || u.target != null) continue; let best = null, bd = 150; for (const h of hs) if (h.alive) { const d = Math.hypot(h.x - u.x, h.y - u.y); if (d < bd) { bd = d; best = h; } }
      if (best && W.t > 2) W.order(u, { type: 'attackMove', x: best.x, y: best.y }); } }
  return { win: !yard.alive ? 'A' : !hs.some((u) => u.alive) ? 'B' : 'none', tGame: t0 != null && tEnd != null ? tEnd - t0 : null, yardHp: yard.alive ? yard.hp / yard.maxHp : 0, hLeft: hs.filter((u) => u.alive).length, defVal: value(defs), defLeft: defs.filter((u) => u.alive).length };
}
function raidSeries(label, nH, defIds, runs = Math.min(RUNS, 10)) {
  const name = `d:${label}`, rs = []; for (let k = 0; k < runs; k++) rs.push(airRaid(name, k, nH, defIds));
  const avg = (xs) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null, tg = rs.filter((r) => r.tGame != null).map((r) => r.tGame);
  return { name: label, nH, hammerCost: nH * SP('H04').cost, defenders: count(defIds), defCost: defIds.reduce((a, id) => a + SP(id).cost, 0), n: rs.length, defWin: rs.filter((r) => r.win === 'B').length / rs.length, hWin: rs.filter((r) => r.win === 'A').length / rs.length,
    tGame: avg(tg), tReal: tg.length ? avg(tg) / GS : null, yardHp: avg(rs.map((r) => r.yardHp)), hLeft: avg(rs.map((r) => r.hLeft)), defVal: avg(rs.map((r) => r.defVal)), runs: rs.map((r) => ({ win: r.win, tGame: r.tGame && +r.tGame.toFixed(2), yardHp: +r.yardHp.toFixed(3), hLeft: r.hLeft })) };
}
const D_CASES = [['14 Hammers vs an undefended yard', 14, []], ['14 Hammers vs 26 Nullifiers', 14, Array(26).fill('T02')],
  ['3 Hammers ($3,600) vs 8 Nullifiers ($3,200)', 3, Array(8).fill('T02')], ['3 Hammers ($3,600) vs 9 Nullifiers ($3,600)', 3, Array(9).fill('T02')], ['14 Hammers ($16,800) vs 42 Nullifiers ($16,800)', 14, Array(42).fill('T02')],
  ['3 Hammers ($3,600) vs 12 Rocket Troopers ($3,600)', 3, Array(12).fill('H02')], ['14 Hammers ($16,800) vs 56 Rocket Troopers ($16,800)', 14, Array(56).fill('H02')]];
if (has('A06')) D_CASES.push(['3 Hammers ($3,600) vs 5 Halos ($3,250)', 3, Array(5).fill('A06')], ['14 Hammers ($16,800) vs 25 Halos ($16,250)', 14, Array(25).fill('A06')]);
else D_CASES.push(['3 Hammers ($3,600) vs 5 Halos ($3,250)', 3, null], ['14 Hammers ($16,800) vs 25 Halos ($16,250)', 14, null]);
if (ONLY.includes('d')) for (const [label, nH, defs] of D_CASES) { if (!defs) { R.d.push({ name: label, missing: true }); continue; } const r = raidSeries(label, nH, defs); R.d.push(r);
  console.log(`  ${label}: defenders win ${pct(r.defWin)}, ${fmt(r.tGame)} game s (${fmt(r.tReal)} real), yard ${pct(r.yardHp)} left, Hammers left ${fmt(r.hLeft)}`); }

function pct(x) { return x == null ? '–' : `${Math.round(x * 100)} %`; }
function fmt(x, d = 1) { return x == null ? '–' : x.toFixed(d); }
fs.mkdirSync(RES, { recursive: true }); if (!PATCH) fs.writeFileSync(path.join(RES, `infantry_${TAG}.json`), JSON.stringify(R, null, 1));
console.log(`\nwrote play/results/infantry_${TAG}.json`);

// ── side-by-side report (when both runs exist) ──
const fB = path.join(RES, 'infantry_before.json'), fA = path.join(RES, 'infantry_after.json');
if (!PATCH && (TAG === 'before' || TAG === 'after') && fs.existsSync(fB) && fs.existsSync(fA)) {
  const Bf = JSON.parse(fs.readFileSync(fB)), Af = JSON.parse(fs.readFileSync(fA)), md = [];
  const find = (L, n) => L.find((x) => x.name === n);
  const wr = (r) => !r || r.missing ? '–' : `${pct(r.winA)} / ${pct(r.winB)}${r.draws ? ` (${r.draws} draw${r.draws > 1 ? 's' : ''})` : ''}${r.flag ? ' ⚑' : ''}`;
  const sv = (r) => !r || r.missing || r.valWinner == null ? '–' : `$${Math.round(r.valWinner)} / $${Math.round(r.valLoser)}`;
  const grp = (s) => !s ? '' : Object.entries(s.ids || {}).map(([id, n]) => `${n} ${id}`).join(' + ') + (s.left ? ` (+$${s.left})` : '');
  md.push('# Infantry and anti-air balance — before / after', '', `Headless engine fights (play/test_infantry.mjs) on Emerald Strait's blue pad, open flat ground with the start yards removed. ${Af.runs} runs per matchup with seeded random start offsets (gap 52–64 m, lateral ±6 m, per-unit jitter); both sides attack-move into each other from out of range. Times are REAL seconds at game speed ${Af.game_speed} (first damage to last kill). BEFORE = data as of ${Bf.date} before this pass; AFTER = this pass.`, '',
    '**Money\'s worth surviving** = Σ cost × hp / maxHp of the survivors + money the whole-unit purchase left unspent (it stays in the bank, so it counts at face value for both sides). Shown as winner / loser, averaged over decided runs. ⚑ = one side wins more than 65 % at equal cost.', '',
    'Ranger modes: **moving** never deploys; **set up** starts deployed as a machine gun and holds its ground; **in battle** advances and deploys with the Hard AI\'s deployMicro() (engine deploy order, 0.8 s setup), and attack-moves on (packing up) after 3 s with nothing to shoot.', '');
  md.push('## Unit stats', '', '| unit | BEFORE cost / HP / speed / weapons | AFTER cost / HP / speed / weapons |', '|---|---|---|');
  const wtxt = (u) => u ? `$${u.cost} · ${u.hp} HP · ${u.speed} m/s · ` + u.weapons.map((w) => `${w.name}: ${w.damage} / ${w.cycle} s, ${w.range} m`).join('; ') : '–';
  for (const id of Object.keys(Object.assign({}, Bf.units, Af.units))) md.push(`| ${id} ${(Af.units[id] || Bf.units[id]).name} | ${wtxt(Bf.units[id])} | ${wtxt(Af.units[id])} |`);
  md.push('', '## (a) Equal-cost rifle fights, $1,000 a side', '', '| matchup (A vs B) | groups BEFORE | groups AFTER | A / B win BEFORE | A / B win AFTER | length s BEFORE | length s AFTER | money surviving BEFORE (win / lose) | AFTER |', '|---|---|---|---|---|---|---|---|---|');
  const flags = [];
  for (const r of Af.a) { const b = find(Bf.a, r.name); md.push(`| ${r.A.label} vs ${r.B.label} | ${grp(b && b.A)} vs ${grp(b && b.B)} | ${grp(r.A)} vs ${grp(r.B)} | ${wr(b)} | ${wr(r)} | ${fmt(b && b.t)} | ${fmt(r.t)} | ${sv(b)} | ${sv(r)} |`);
    if (r.flag) flags.push(`AFTER (a) ${r.A.label} vs ${r.B.label}: ${r.wonBy === 'A' ? r.A.label : r.B.label} wins ${pct(Math.max(r.winA, r.winB))}`); if (b && b.flag) flags.push(`BEFORE (a) ${b.A.label} vs ${b.B.label}: ${b.wonBy === 'A' ? b.A.label : b.B.label} wins ${pct(Math.max(b.winA, b.winB))}`); }
  md.push('', '## (b) Rifles against one basic tank', '', 'Passive = the tank does not fire (the fit target: a 5-man squad kills it in 25–30 s). Fight = the tank fires back; rifles\' win rate and length.', '',
    '| rifles | tank | passive kill s BEFORE | AFTER | fight: rifles win BEFORE | AFTER | fight s BEFORE | AFTER |', '|---|---|---|---|---|---|---|---|');
  for (const r of Af.b) { const b = find(Bf.b, r.name); md.push(`| ${r.A.label}${r.squad ? '' : ` (${grp(r.A)})`} | ${r.B.label} | ${fmt(b && b.passiveT)} | ${fmt(r.passiveT)} | ${b ? pct(b.winA) : '–'} | ${pct(r.winA)} | ${fmt(b && b.t)} | ${fmt(r.t)} |`); }
  md.push('', '## (c) Equal-cost mixed groups, $2,000 a side', '', '| matchup (A vs B) | groups BEFORE | groups AFTER | A / B win BEFORE | AFTER | length s BEFORE | AFTER | money surviving BEFORE | AFTER |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of Af.c) { const b = find(Bf.c, r.name); md.push(`| ${r.A.label} vs ${r.B.label} | ${b && !b.missing ? grp(b.A) + ' vs ' + grp(b.B) : 'n/a (no A06)'} | ${grp(r.A)} vs ${grp(r.B)} | ${wr(b)} | ${wr(r)} | ${fmt(b && b.t)} | ${fmt(r.t)} | ${sv(b)} | ${sv(r)} |`);
    if (r.flag) flags.push(`AFTER (c) ${r.A.label} vs ${r.B.label}: ${r.wonBy === 'A' ? r.A.label : r.B.label} wins ${pct(Math.max(r.winA, r.winB))}`); if (b && b.flag) flags.push(`BEFORE (c) ${b.A.label} vs ${b.B.label}: ${b.wonBy === 'A' ? b.A.label : b.B.label} wins ${pct(Math.max(b.winA, b.winB))}`); }
  md.push('', '## (d) Anti-air over a base', '', 'A Hammer wave attack-moves onto a construction yard (3,000 HP) from 160 m; the defenders guard spots 16–30 m from the yard, and idle defenders attack-move toward the nearest Hammer (as the Hard AI\'s anti-air does). Defenders win when every Hammer is down before the yard falls. Times in GAME seconds (real = game / 2.4).', '',
    '| case | defenders win BEFORE | AFTER | time game s BEFORE | AFTER | yard HP left BEFORE | AFTER | Hammers left BEFORE | AFTER |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of Af.d) { const b = find(Bf.d, r.name); const c = (x) => !x || x.missing; md.push(`| ${r.name} | ${c(b) ? 'n/a' : pct(b.defWin)} | ${c(r) ? 'n/a' : pct(r.defWin)} | ${c(b) ? '–' : fmt(b.tGame)} | ${c(r) ? '–' : fmt(r.tGame)} | ${c(b) ? '–' : pct(b.yardHp)} | ${c(r) ? '–' : pct(r.yardHp)} | ${c(b) ? '–' : fmt(b.hLeft)} | ${c(r) ? '–' : fmt(r.hLeft)} |`); }
  md.push('', '## Flagged matchups (one side > 65 % at equal cost)', '', ...(flags.length ? flags.map((f) => `- ${f}`) : ['- none']), '');
  fs.writeFileSync(path.join(RES, 'infantry.md'), md.join('\n') + '\n'); fs.writeFileSync(path.join(RES, 'infantry.json'), JSON.stringify({ before: Bf, after: Af }, null, 1));
  console.log('wrote play/results/infantry.md and infantry.json');
}
