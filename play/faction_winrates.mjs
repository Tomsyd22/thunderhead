// Faction win rates across the AI batches (play/test_ai.mjs results on both seed sets): per faction, wins / games, split
// 1v1 and 2v1, plus Normal vs Normal by faction.  node play/faction_winrates.mjs [--before DIR]  → play/results/faction_winrates.md
// A draw counts as a game and not a win. In 2v1 both factions of the pair get the pair's result.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), RES = path.join(HERE, 'results'), args = process.argv.slice(2);
const BEFORE = args.includes('--before') ? args[args.indexOf('--before') + 1] : null;
const FAC = ['compact', 'lattice', 'helix'], NAME = { compact: 'Compact', lattice: 'Lattice', helix: 'Helix' };
const FILES = { '1v1': ['ai.json', 'ai_seed2.json'], '2v1': ['ai_2v1.json', 'ai_2v1_seed2.json'] };
function tally(dir) {
  const T = {}; const z = () => ({ w: 0, n: 0 }); for (const f of FAC) T[f] = { all1: z(), nn: z(), hard: z(), normalVsHard: z(), all2: z(), solo: z(), pair: z() };
  const add = (c, win) => { c.n++; if (win) c.w++; };
  for (const f of FILES['1v1']) { const p = path.join(dir, f); if (!fs.existsSync(p)) continue; const R = JSON.parse(fs.readFileSync(p));
    for (const [batch, rs] of Object.entries(R)) for (const r of rs) for (const s of [0, 1]) { const fac = r.factions[s], win = r.winner === s, lv = (r.levels || [])[s];
      add(T[fac].all1, win); if (batch === 'Normal vs Normal') add(T[fac].nn, win); else if (lv === 'hard') add(T[fac].hard, win); else add(T[fac].normalVsHard, win); } }
  for (const f of FILES['2v1']) { const p = path.join(dir, f); if (!fs.existsSync(p)) continue; const R = JSON.parse(fs.readFileSync(p));
    for (const rs of Object.values(R)) for (const r of rs) { const solo = r.factions[0], pair = String(r.factions[1]).split('+');
      add(T[solo].all2, r.winner === 0); add(T[solo].solo, r.winner === 0); for (const q of pair) { add(T[q].all2, r.winner === 1); add(T[q].pair, r.winner === 1); } } }
  return T;
}
const cell = (c) => c.n ? `${c.w}/${c.n} (${Math.round(c.w / c.n * 100)} %)` : '–';
const A = tally(RES), B = BEFORE ? tally(BEFORE) : null, md = ['# Faction win rates in the AI batches', '',
  `From play/results/${[...FILES['1v1'], ...FILES['2v1']].join(', ')} (seed sets 1 and 2). Wins / games; a draw is a game without a win. 1v1 = Hard vs Normal and Normal vs Normal on maps 01 and 03; 2v1 = Normal vs 2 Easy and Hard vs 2 Normal on maps 02, 04 and 05 (both factions of the pair share its result). Factions rotate by match index, so each faction plays a similar number of games but not always the same opponents.`, ''];
const table = (T, title) => { md.push(`## ${title}`, '', '| faction | 1v1 all | 1v1 Normal vs Normal | 1v1 as Hard (vs Normal) | 1v1 as Normal (vs Hard) | 2v1 all | 2v1 as the single AI | 2v1 in the pair |', '|---|---|---|---|---|---|---|---|');
  for (const f of FAC) { const t = T[f]; md.push(`| ${NAME[f]} | ${cell(t.all1)} | ${cell(t.nn)} | ${cell(t.hard)} | ${cell(t.normalVsHard)} | ${cell(t.all2)} | ${cell(t.solo)} | ${cell(t.pair)} |`); } md.push(''); };
table(A, 'After this pass');
if (B) table(B, 'Before this pass (the results that were in play/results before the re-run)');
fs.writeFileSync(path.join(RES, 'faction_winrates.md'), md.join('\n') + '\n'); console.log(md.join('\n'));
