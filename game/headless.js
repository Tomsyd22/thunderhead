/* Headless AI-vs-AI harness. node headless.js [matches] [seconds] */
const fs = require('fs'), p = __dirname;
const strip = s => s.replace(/if \(typeof module !== 'undefined'\) module\.exports = \w+;\n?/g, '');
const data = ['../data/rules.js', '../data/lattice.js', '../data/compact.js', '../data/helix.js', '../proto/voice.js'].map(f => strip(fs.readFileSync(p + '/' + f, 'utf8'))).join('\n');
const depth = fs.readFileSync(p + '/depth.js', 'utf8'), ai = fs.readFileSync(p + '/ai.js', 'utf8');
const sim = fs.readFileSync(p + '/sim.js', 'utf8').replace('function newGame(', depth + '\nfunction newGame(').replace('/*AI_SPLICE*/', ai);
const map = fs.readFileSync(p + '/map.js', 'utf8');
const SIM = new Function(data + '\n' + map + '\n' + sim + '\nreturn SIM;')();
function match(fA, dA, fB, dB, seed, maxT = 2400, log = false) {
  const G = SIM.G; const me = SIM.newGame(fA, fB, dB, seed);
  me.ai = true; me.difficulty = dA; SIM.aiInit(me); const en = G.players[1];
  const t0 = Date.now(); let ticks = 0; const DT = SIM.DT; const trace = [];
  while (G.t < maxT && !me.lost && !en.lost) { SIM.step(DT); ticks++; G.events.length = 0; G.msgs.length = 0; if (log && ticks % 1800 === 0) trace.push(snapshot(G, me, en)); }
  const val = q => G.ents.filter(e => !e.dead && e.owner === q && !SIM.isStruct(e.def)).reduce((s, e) => s + e.def.cost, 0);
  const sv = q => G.ents.filter(e => !e.dead && e.owner === q && SIM.isStruct(e.def) && e.def.faction !== 'civ').reduce((s, e) => s + e.def.cost, 0);
  const winner = me.lost ? 'B' : en.lost ? 'A' : (val(me) + sv(me) > val(en) + sv(en) ? 'A*' : 'B*');
  return { winner, t: Math.round(G.t), ms: Date.now() - t0, a: { army: val(me), structs: sv(me), credits: Math.round(me.credits), wave: me.ai2.wave }, b: { army: val(en), structs: sv(en), credits: Math.round(en.credits), wave: en.ai2.wave }, trace };
}
function snapshot(G, me, en) { const c = q => ({ units: G.ents.filter(e => !e.dead && e.owner === q && !SIM.isStruct(e.def)).length, structs: G.ents.filter(e => !e.dead && e.owner === q && SIM.isStruct(e.def) && e.def.faction !== 'civ').length, cr: Math.round(q.credits), st: q.ai2.state, wave: q.ai2.wave }); return { t: Math.round(G.t), A: c(me), B: c(en) }; }
module.exports = { match, SIM };
if (require.main === module) {
  const [, , mode = 'matrix', n = '2', secs = '2400'] = process.argv; const N = +n, T = +secs;
  const diffs = ['recruit', 'easy', 'normal', 'hard', 'brutal'], facs = ['lattice', 'compact', 'helix'];
  if (mode === 'one') { const a = process.argv; const r = match(a[3] || 'compact', a[4] || 'normal', a[5] || 'lattice', a[6] || 'normal', +(a[7] || 11), +(a[8] || 1500), true); console.log(JSON.stringify(r, null, 1)); return; }
  const table = {}; let errors = 0;
  for (let i = 0; i < diffs.length; i++) for (let j = 0; j < diffs.length; j++) { const key = diffs[i] + ' vs ' + diffs[j]; table[key] = { A: 0, B: 0, draw: 0, t: 0, n: 0 };
    for (let k = 0; k < N; k++) { const fa = facs[(i + k) % 3], fb = facs[(j + k + 1) % 3]; try { const r = match(fa, diffs[i], fb, diffs[j], 100 + i * 31 + j * 7 + k * 13, T); const row = table[key]; row.n++; row.t += r.t; if (r.winner === 'A') row.A++; else if (r.winner === 'B') row.B++; else { row.draw++; row[r.winner === 'A*' ? 'A' : 'B'] += 0.5; } } catch (e) { errors++; console.error('ERR', key, e.stack.split('\n').slice(0, 3).join(' | ')); } }
    const row = table[key]; console.log(key.padEnd(20), `A ${row.A}  B ${row.B}  undecided ${row.draw}  avg ${Math.round(row.t / Math.max(1, row.n))}s`); }
  console.log('errors', errors);
}
