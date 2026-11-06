// AI difficulty: headless AI-vs-AI batches on the 2-player maps (01 Emerald Strait, 03 Granite Fjord).
//   node play/test_ai.mjs [--n 12] [--minutes 40] [--maps 01,03]
// Hard vs Normal with sides and factions rotated, plus a Normal vs Normal control batch. A match ends when a side has no
// structures left, or at the time limit (then it is judged on the value of what each side still has). Both AIs run on the
// same Game object: same starting credits, build rates, prices and fog of war — the check below also confirms that every
// credit each side holds came from harvesting, starting money or refunds (no bonus income).
// Results: play/results/ai.md and ai.json.
//   node play/test_ai.mjs --mode 2v1 [--n 6] [--only normal|hard]   one AI against two allied AIs on the 4-player maps
//   (02, 04, 05): Normal vs two Easy, Hard vs two Normal → play/results/ai_2v1.md
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeMapTerrain } from './mapdata.js';
import { createMatch, stepMatch, applyMapping } from './setup.js';
import { TICK } from './engine/mech.js';
import { RULES, STRUCTURES } from './rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MODE = arg('--mode', '1v1'), N = +arg('--n', MODE === '2v1' ? 6 : 12), MIN = +arg('--minutes', MODE === '2v1' ? 60 : 40), MAPS = arg('--maps', MODE === '2v1' ? '02,04,05' : '01,03').split(',');
const J = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'data', f)));
const spec = applyMapping(J('unit_specs.json'), J('faction_mapping.json')), geom = J('sockets.json'), pace = J('pace.json'), combat = J('combat.json'), economy = J('economy.json');
const T = {}; for (const id of MAPS) { const D = path.join(HERE, '..', 'maps', 'lab', 'data', id), rd = (f) => fs.readFileSync(path.join(D, f)); const h = rd('height.f32');
  const u8 = (f) => { try { const b = rd(f); return new Uint8Array(b.buffer, b.byteOffset, b.length); } catch (e) { return null; } };
  T[id] = makeMapTerrain({ meta: JSON.parse(rd('map.json')), height: new Float32Array(h.buffer, h.byteOffset, h.length / 4), surface: u8('surface.u8'), nav: u8('nav.u8'), deck: u8('deck.u8'), instances: JSON.parse(rd('instances.json')) }); }
const FAC = ['compact', 'lattice', 'helix'];
let pass = 0, fail = 0; const out = [];
const check = (name, ok, info = '') => { (ok ? pass++ : fail++); const l = `${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`; out.push(l); console.log(l); };

function value(G, p) { return G.structures(p).reduce((a, b) => a + (STRUCTURES[b.kind].cost || 0) * b.hp / b.maxHp, 0) + G.unitsOf(p).reduce((a, u) => a + u.sp.cost * u.hp / u.maxHp, 0) + p.credits; }
function match(k, levels) {
  const id = MAPS[k % MAPS.length], swap = Math.floor(k / MAPS.length) % 2 === 1, fa = FAC[k % 3], fb = FAC[(k + 1 + Math.floor(k / 3)) % 3] === fa ? FAC[(k + 2) % 3] : FAC[(k + 1 + Math.floor(k / 3)) % 3];
  const pads = T[id].meta.pads.map((q) => q.id), A = { faction: fa, pad: swap ? pads[1] : pads[0], isAI: true, level: levels[0] }, B = { faction: fb, pad: swap ? pads[0] : pads[1], isAI: true, level: levels[1] };
  const M = createMatch({ T: T[id], spec, geom, pace, combat, economy, players: [A, B] }); const G = M.game, W = M.world;
  const income = [0, 0], spent = [0, 0], t0 = Date.now(); let raids = 0, waves = [0, 0], prongs = 0, seq = 0;
  const c0 = G.players.map((p) => p.credits);
  for (let i = 0; i < MIN * 60 / TICK && !G.over; i++) {
    stepMatch(M, TICK); for (const e of W.events) if (e.type === 'harvest_cycle' && e.amount) income[e.team] += e.amount; W.events.length = 0;
    for (const e of G.since(seq)) { seq = e.seq; if (e.type === 'ai_raid') raids++; if (e.type === 'ai_wave') { waves[e.player]++; if (e.prongs) prongs++; } }
  }
  const P = G.players, val = P.map((p) => value(G, p)); const winner = G.over ? G.over.winner : (val[0] > val[1] * 1.15 ? 0 : val[1] > val[0] * 1.15 ? 1 : null);
  // no bonus money: credits now ≤ start + harvested (spending and refunds can only lower it)
  const honest = P.every((p, i) => p.credits <= c0[i] + income[i] + 1e-6);
  return { k, map: id, levels, factions: [fa, fb], pads: [A.pad, B.pad], winner, decided: !!G.over, t: (G.over ? G.over.t : W.t) / 60, val: val.map(Math.round), income: income.map(Math.round), lost: P.map((p) => p.stats.lostUnits), raids, waves, prongs, honest, wall: (Date.now() - t0) / 1000 };
}

/** 2v1 on a 4-player map: one AI (team 0) on a start of one side against two allied AIs (team 1) on the other side's starts */
function match2v1(k, solo, duo) {
  const id = MAPS[k % MAPS.length], pads = T[id].meta.pads.map((q) => q.id), side = Math.floor(k / MAPS.length) % 2 ? 'R' : 'B', mine = pads.filter((q) => q[0] === side), theirs = pads.filter((q) => q[0] !== side);
  const fs = FAC[k % 3], fd = [FAC[(k + 1) % 3], FAC[(k + 2) % 3]];
  const players = [{ faction: fs, pad: mine[k % mine.length], isAI: true, level: solo, team: 0 }, { faction: fd[0], pad: theirs[0], isAI: true, level: duo, team: 1 }, { faction: fd[1], pad: theirs[1], isAI: true, level: duo, team: 1 }];
  const M = createMatch({ T: T[id], spec, geom, pace, combat, economy, players }); const G = M.game, W = M.world, t0 = Date.now(); const income = [0, 0, 0]; let seq = 0, raids = 0, prongs = 0;
  const c0 = G.players.map((p) => p.credits);
  for (let i = 0; i < MIN * 60 / TICK && !G.over; i++) { stepMatch(M, TICK); for (const e of W.events) if (e.type === 'harvest_cycle' && e.amount) { const h = W.byId.get(e.id); const o = h ? G.ownerOf(h) : null; if (o) income[o.id] += e.amount; } W.events.length = 0;
    for (const e of G.since(seq)) { seq = e.seq; if (e.type === 'ai_raid' && e.player === 0) raids++; if (e.type === 'ai_wave' && e.prongs && e.player === 0) prongs++; } }
  const val = G.players.map((p) => value(G, p)), soloV = val[0], duoV = val[1] + val[2];
  const winner = G.over ? (G.over.team === 0 ? 0 : 1) : (soloV > duoV * 1.15 ? 0 : duoV > soloV * 1.15 ? 1 : null);
  return { k, map: id, levels: [solo, duo], factions: [fs, fd.join('+')], pads: [players[0].pad, theirs.join('+')], winner, decided: !!G.over, t: (G.over ? G.over.t : W.t) / 60, val: [Math.round(soloV), Math.round(duoV)], income: [income[0], income[1] + income[2]].map(Math.round), raids, prongs, honest: G.players.every((p, i) => p.credits <= c0[i] + income[i] + 1e-6), wall: (Date.now() - t0) / 1000 };
}
if (MODE === '2v1') {
  const R2 = {}; const B2 = { 'Normal vs 2 Easy': ['normal', 'easy'], 'Hard vs 2 Normal': ['hard', 'normal'] };
  const ONLY = arg('--only', ''); for (const [name, lv] of Object.entries(B2)) { if (ONLY && !name.toLowerCase().startsWith(ONLY.toLowerCase())) continue; R2[name] = []; console.log(`\n── ${name} (${N} matches, ${MAPS.join(' + ')}, up to ${MIN} game min) ──`);
    for (let k = 0; k < N; k++) { const r = match2v1(k, lv[0], lv[1]); R2[name].push(r);
      console.log(`  #${k + 1} ${r.map} ${r.pads.join(' vs ')} ${r.factions.join(' vs ')}: ${r.winner == null ? 'draw' : r.winner === 0 ? lv[0] + ' (solo) wins' : lv[1] + ' pair wins'} ${r.decided ? 'by destroying the bases' : 'on value'} at ${r.t.toFixed(1)} min · value ${r.val.join(' / ')} · mined ${r.income.join(' / ')} · ${r.wall.toFixed(0)} s`); } }
  for (const [name, rs] of Object.entries(R2)) { const w = rs.filter((r) => r.winner === 0).length, d = rs.filter((r) => r.winner === 0 && r.decided).length; check(`${name}: the single AI wins every match`, w === rs.length, `${w}/${rs.length} wins (${d} by destroying both bases), avg ${(rs.reduce((a, r) => a + r.t, 0) / rs.length).toFixed(1)} game min`); }
  check('2v1: no resource cheating', Object.values(R2).flat().every((r) => r.honest));
  const md = ['# AI difficulty, 2v1 (round 1)', '', `One AI against two allied AIs on ${MAPS.join(', ')}; ${N} matches per batch, up to ${MIN} game minutes; the single AI's side and the factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw).`, ''];
  for (const [name, rs] of Object.entries(R2)) { md.push(`## ${name}`, '', '| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined |', '|---|---|---|---|---|---|---|---|');
    for (const r of rs) md.push(`| ${r.k + 1} | ${r.map} | ${r.pads.join(' vs ')} | ${r.factions.join(' vs ')} | ${r.winner == null ? 'draw' : (r.winner === 0 ? 'solo ' + r.levels[0] : r.levels[1] + ' pair') + ' wins' + (r.decided ? '' : ' on value')} | ${r.t.toFixed(1)} | ${r.val.join(' / ')} | ${r.income.join(' / ')} |`); md.push(''); }
  md.push(out.join('  \n'), '', `${pass}/${pass + fail} checks passed`); fs.writeFileSync(path.join(HERE, 'results', 'ai_2v1.md'), md.join('\n') + '\n'); fs.writeFileSync(path.join(HERE, 'results', 'ai_2v1.json'), JSON.stringify(R2, null, 1));
  console.log(`\n${pass}/${pass + fail} checks passed`); process.exit(fail ? 1 : 0);
}
const batches = { 'Hard vs Normal': ['hard', 'normal'], 'Normal vs Normal': ['normal', 'normal'] }, R = {};
for (const [name, lv] of Object.entries(batches)) {
  R[name] = []; console.log(`\n── ${name} (${N} matches, ${MAPS.join(' + ')}, up to ${MIN} game min) ──`);
  for (let k = 0; k < N; k++) { const r = match(k, lv); R[name].push(r);
    console.log(`  #${k + 1} ${r.map} ${r.pads.join('/')} ${r.factions.join(' vs ')}: ${r.winner == null ? 'draw' : (r.winner === 0 ? lv[0] : lv[1]) + ' (' + r.factions[r.winner] + ')'} ${r.decided ? 'destroyed the base' : 'on value'} at ${r.t.toFixed(1)} min · value ${r.val.join(' / ')} · mined ${r.income.join(' / ')} · raids ${r.raids}, flank waves ${r.prongs} · ${r.wall.toFixed(0)} s`); }
}
const hv = R['Hard vs Normal'], wins = hv.filter((r) => r.winner === 0).length, losses = hv.filter((r) => r.winner === 1).length, nn = R['Normal vs Normal'], nnA = nn.filter((r) => r.winner === 0).length, nnB = nn.filter((r) => r.winner === 1).length;
const ratio = (k) => hv.reduce((a, r) => a + r.val[0] / Math.max(1, r.val[1]), 0) / hv.length; void ratio;
check('Hard beats Normal in most matches', wins >= Math.ceil(N * 0.7), `${wins} wins, ${losses} losses, ${N - wins - losses} draws of ${N} (${(wins / N * 100).toFixed(0)} %)`);
check('Hard uses its tools: scouting, raids and two-pronged waves', hv.some((r) => r.raids > 0) && hv.some((r) => r.prongs > 0), `raids in ${hv.filter((r) => r.raids > 0).length}/${N} matches, two-pronged waves in ${hv.filter((r) => r.prongs > 0).length}/${N}`);
check('no resource cheating: every credit held came from start money or harvesting', hv.concat(nn).every((r) => r.honest));
check('control: Normal vs Normal is roughly even (side and faction rotation)', Math.abs(nnA - nnB) <= Math.ceil(N * 0.5), `side A ${nnA}, side B ${nnB}, draws ${N - nnA - nnB}`);
const md = ['# AI difficulty (round 1)', '', `Headless AI-vs-AI on ${MAPS.join(' and ')}; ${N} matches per batch, up to ${MIN} game minutes; sides and factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw).`, ''];
for (const [name, rs] of Object.entries(R)) { md.push(`## ${name}`, '', '| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) md.push(`| ${r.k + 1} | ${r.map} | ${r.pads.join(' / ')} | ${r.factions.join(' vs ')} | ${r.winner == null ? 'draw' : r.levels[r.winner] + ' wins' + (r.decided ? '' : ' on value')} | ${r.t.toFixed(1)} | ${r.val.join(' / ')} | ${r.income.join(' / ')} | ${r.raids} | ${r.prongs} |`); md.push(''); }
md.push(out.join('  \n'), '', `${pass}/${pass + fail} checks passed`);
fs.writeFileSync(path.join(HERE, 'results', 'ai.md'), md.join('\n') + '\n'); fs.writeFileSync(path.join(HERE, 'results', 'ai.json'), JSON.stringify(R, null, 1));
console.log(`\n${pass}/${pass + fail} checks passed`);
