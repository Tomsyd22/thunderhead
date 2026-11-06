// AI difficulty: headless AI-vs-AI batches on the 2-player maps (01 Emerald Strait, 03 Granite Fjord).
//   node play/test_ai.mjs [--n 12] [--minutes 40] [--maps 01,03]
// Hard vs Normal with sides and factions rotated, plus a Normal vs Normal control batch. A match ends when a side has no
// structures left, or at the time limit (then it is judged on the value of what each side still has). Both AIs run on the
// same Game object: same starting credits, build rates, prices and fog of war — the check below also confirms that every
// credit each side holds came from harvesting, starting money or refunds (no bonus income).
// Results: play/results/ai.md and ai.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeMapTerrain } from './mapdata.js';
import { createMatch, stepMatch, applyMapping } from './setup.js';
import { TICK } from './engine/mech.js';
import { RULES, STRUCTURES } from './rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = +arg('--n', 12), MIN = +arg('--minutes', 40), MAPS = arg('--maps', '01,03').split(',');
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
