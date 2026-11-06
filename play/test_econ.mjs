// Economy and travel-time balance on every map (round 1 ore fields): headless engine + game rules on the Map Lab's
// baked maps 01–05 (maps/lab/data/<id>). Results go to play/results/econ.md and econ.json.
//   node play/test_econ.mjs [--maps 01,02] [--quick]
// Per map, for the first blue and first red start (and every start on 4-player maps), with a refinery on the start's
// base-kit refinery slot and its free harvester:
//   fields: every deposit grows a patch field of the kind's size around its rig
//   round trip: the first full load from the nearest home field, in real seconds at the pace setting (target band 20–40)
//   income: credits per real minute for one harvester, then two on the same refinery
//   patches: a load is gathered from several patches (the harvester moves on by itself)
//   depletion: three harvesters strip a home field with regrowth off; when it is empty they move to the next field
//   regrowth: an emptied field regrows at the set share of the loading rate, from the rig outward, never above its start
//   symmetry: paired starts get the same ore and round trips within 10 %
let __s = +(process.env.SEED || 7); Math.random = () => { __s |= 0; __s = (__s + 0x6D2B79F5) | 0; let t = Math.imul(__s ^ (__s >>> 15), 1 | __s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeMapTerrain } from './mapdata.js';
import { createMatch, stepMatch, applyMapping } from './setup.js';
import { TICK } from './engine/mech.js';
import { STRUCTURES } from './rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2);
const MAPS = (args.includes('--maps') ? args[args.indexOf('--maps') + 1] : '01,02,03,04,05').split(','), QUICK = args.includes('--quick');
const J = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'data', f)));
const spec = applyMapping(J('unit_specs.json'), J('faction_mapping.json')), geom = J('sockets.json'), pace = J('pace.json'), combat = J('combat.json'), economy = J('economy.json');
const GS = pace.game_speed, CAP = pace.harvester.capacity_bails * 25;
let pass = 0, fail = 0; const out = [], rows = {};
const check = (name, ok, info = '') => { (ok ? pass++ : fail++); const l = `${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`; out.push(l); console.log(l); };

function loadMap(id) {
  const D = path.join(HERE, '..', 'maps', 'lab', 'data', id), rd = (f) => fs.readFileSync(path.join(D, f));
  const meta = JSON.parse(rd('map.json')), instances = JSON.parse(rd('instances.json')); const h = rd('height.f32');
  const u8 = (f) => { try { const b = rd(f); return new Uint8Array(b.buffer, b.byteOffset, b.length); } catch (e) { return null; } };
  return makeMapTerrain({ meta, height: new Float32Array(h.buffer, h.byteOffset, h.length / 4), surface: u8('surface.u8'), nav: u8('nav.u8'), deck: u8('deck.u8'), instances });
}
const run = (M, sec, fn) => { for (let i = 0; i < Math.round(sec / TICK); i++) { stepMatch(M, TICK); if (fn) fn(M.world.events); M.world.events.length = 0; } };
/** a refinery for player p: its base-kit slot if free, else the nearest valid spot toward its nearest home field */
function refineryFor(M, p) {
  const G = M.game, W = M.world, pad = p.start.pad; const kit = M.nav.kits.filter((r) => r.asset === 'bld_ore_refinery' && Math.abs(r.x - pad.center[0]) < pad.size[0] / 2 + 20 && Math.abs(r.y - pad.center[1]) < pad.size[1] / 2 + 20);
  for (const r of kit) { const c = G.canPlace(p, 'refinery', r.x, r.y); if (c.ok) return G._spawnStructure(p, 'refinery', c.x, c.y, c.rot); }
  const y = W.byId.get(p.yard), home = G.deposits.filter((d) => d.nearest === pad.id).sort((a, b) => Math.hypot(a.pos[0] - y.x, a.pos[1] - y.y) - Math.hypot(b.pos[0] - y.x, b.pos[1] - y.y))[0];
  const tx = home ? y.x + (home.pos[0] - y.x) * 0.5 : y.x, ty = home ? y.y + (home.pos[1] - y.y) * 0.5 : y.y;
  for (let r = 0; r < 200; r += 4) for (let a = 0; a < 24; a++) { const c = G.canPlace(p, 'refinery', tx + Math.cos(a / 24 * 6.283) * r, ty + Math.sin(a / 24 * 6.283) * r); if (c.ok) return G._spawnStructure(p, 'refinery', c.x, c.y, c.rot); }
  return null;
}

for (const id of MAPS) {
  const T = loadMap(id), pads = T.meta.pads.map((q) => q.id); const R = rows[id] = { pads: {} };
  console.log(`\n── map ${id} (${T.meta.name || ''}, ${pads.join(' ')}) ──`);
  // fields
  { const M = createMatch({ T, spec, geom, pace, combat, economy, players: [{ faction: 'compact', pad: pads[0] }, { faction: 'lattice', pad: pads.find((q) => q[0] !== pads[0][0]) || pads[1] }], startUnits: false });
    const F = M.game.ore.fields; const thin = F.filter((f) => f.cells.length < 30);
    R.fields = F.map((f) => ({ id: f.id, kind: f.dep.kind, patches: f.cells.length, total: Math.round(f.total) }));
    check(`${id}: every deposit has an ore field around its rig`, F.length === T.meta.deposits.length && !thin.length, `${F.length} fields, patches ${Math.min(...F.map((f) => f.cells.length))}–${Math.max(...F.map((f) => f.cells.length))}${thin.length ? ', thin: ' + thin.map((f) => f.id).join(' ') : ''}`); }
  // per start: one harvester, then two (fresh match per start so nothing else competes for the fields)
  const starts = QUICK ? [pads[0], pads.find((q) => q[0] !== pads[0][0])] : pads;
  for (const pad of starts) {
    const other = pads.find((q) => q[0] !== pad[0]) || pads.find((q) => q !== pad);
    const M = createMatch({ T, spec, geom, pace, combat, economy, players: [{ faction: 'compact', pad }, { faction: 'lattice', pad: other }], startUnits: false });
    const G = M.game, W = M.world, p = G.players[0]; M.game.ore.regrowScale = 0;
    const ref = refineryFor(M, p); if (!ref) { check(`${id} ${pad}: refinery placed`, false); continue; }
    const hv = W.units.find((u) => u.alive && u.uid === 'HV' && u.team === p.team); const cyc = [], hops = { n: 0 }; let loads = 0;
    run(M, 300, (ev) => { for (const e of ev) { if (e.type === 'harvest_cycle' && e.id === hv.id) cyc.push(e); if (e.type === 'harvest_hop' && e.id === hv.id) hops.n++; if (e.type === 'harvest_load' && e.id === hv.id) loads++; } });
    const first = cyc[0] ? cyc[0].total / GS : null, rt = cyc.slice(1).map((c) => c.total / GS), inc1 = rt.length ? CAP / (rt.reduce((a, b) => a + b, 0) / rt.length) * 60 : 0;   // steady state: one load per round trip
    // a second harvester on the same refinery
    const h2 = W.spawn('HV', p.team, ref.dock.approach[0], ref.dock.approach[1], { hdg: ref.dock.face }); h2.owner = p.id; W.harvest(h2, G.nextDeposit(h2), ref.dock);
    let got2 = 0; run(M, 60); run(M, 360, (ev) => { for (const e of ev) if (e.type === 'harvest_cycle' && e.team === p.team) got2 += e.amount; });
    const inc2 = got2 / (360 / GS / 60), dep = hv.harv && hv.harv.dep;
    R.pads[pad] = { first, rt, inc1, inc2, hopsPerLoad: cyc.length ? hops.n / cyc.length : 0, field: dep && dep.id };
    check(`${id} ${pad}: round trip to the nearest home field in the 20–40 s band`, rt.length > 0 && rt.every((x) => x >= 15 && x <= 40), `${rt.map((x) => x.toFixed(1)).join(', ')} s real (first, from the bay: ${first ? first.toFixed(1) : '—'} s) · field ${dep && dep.id}`);
    check(`${id} ${pad}: a load comes from several patches, the harvester moving on by itself`, cyc.length >= 2 && hops.n >= cyc.length, `${(hops.n / Math.max(1, cyc.length)).toFixed(1)} patch moves per load`);
    check(`${id} ${pad}: two harvesters per refinery earn more than one`, inc2 > inc1 * 1.5, `one $${inc1.toFixed(0)}/min, two $${inc2.toFixed(0)}/min (real minutes)`);
  }
  // symmetry between paired starts
  const P = R.pads, prs = Object.keys(P); if (prs.length >= 2) {
    const avg = (k) => { const v = P[k].rt; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; }; const vals = prs.map(avg), lo = Math.min(...vals), hi = Math.max(...vals);
    check(`${id}: home round trips match across starts (within 10 %)`, hi / lo <= 1.1, prs.map((k, i) => `${k} ${vals[i].toFixed(1)} s`).join(', '));
  }
  // depletion and regrowth on one home field
  { const M = createMatch({ T, spec, geom, pace, combat, economy, players: [{ faction: 'compact', pad: pads[0] }, { faction: 'lattice', pad: pads.find((q) => q[0] !== pads[0][0]) }], startUnits: false });
    const G = M.game, W = M.world, p = G.players[0], O = G.ore; O.regrowScale = 0; const ref = refineryFor(M, p);
    const hv0 = W.units.find((u) => u.alive && u.uid === 'HV' && u.team === p.team), F = (G.nextDeposit(hv0) || G.deposits[0]).field;
    const hs = [hv0]; for (let k = 0; k < 2; k++) { const h = W.spawn('HV', p.team, ref.dock.approach[0] + k * 6, ref.dock.approach[1], { hdg: ref.dock.face }); h.owner = p.id; hs.push(h); }
    for (const h of hs) W.harvest(h, F.dep, ref.dock);
    let tEmpty = null, idle = 0, moved = false; const lim = QUICK ? 1500 : 2400;
    for (let s = 0; s < lim && !(tEmpty != null && moved); s += 5) { run(M, 5, (ev) => { for (const e of ev) if (e.type === 'harvest_idle' && e.team === p.team) idle++; });
      if (tEmpty == null && !O.hasPatch(F)) tEmpty = W.t; if (tEmpty != null && hs.every((h) => h.harv && h.harv.dep !== F.dep)) moved = true; }
    R.deplete = { field: F.id, total: Math.round(F.total), minutes3: tEmpty ? tEmpty / GS / 60 : null };
    check(`${id}: three harvesters empty a home field, then move on to the next field by themselves`, tEmpty != null && moved && idle === 0, `${F.id} (${F.total.toFixed(0)}) empty after ${tEmpty ? (tEmpty / GS / 60).toFixed(1) : '—'} real min; next fields ${[...new Set(hs.map((h) => h.harv && h.harv.dep.id))].join(', ')}; ${idle} idle events`);
    // regrowth (harvesters parked): rate, spreading from the rig, cap
    for (const h of hs) W.order(h, { type: 'stop' }); O.regrowScale = 1; const o0 = F.ore; run(M, 120);
    const rate = (F.ore - o0) / 120, want = economy.regrow_share * economy.load_rate;
    const grown = F.cells.filter((c) => c.amt > 1), rIn = grown.reduce((a, c) => a + c.r, 0) / Math.max(1, grown.length), rAll = F.cells.reduce((a, c) => a + c.r, 0) / F.cells.length;
    check(`${id}: an empty field regrows at 5 % of the loading rate, from the rig outward`, Math.abs(rate - want) / want < 0.05 && grown.length > 0 && rIn < rAll, `${rate.toFixed(2)} credits / game s (want ${want.toFixed(2)}), regrown patches ${grown.length}/${F.cells.length}, mean distance ${rIn.toFixed(0)} m vs field ${rAll.toFixed(0)} m`);
    O.regrowScale = 4; run(M, 3600); const capped = F.cells.every((c) => c.amt <= c.max + 1e-6) && F.ore <= F.total + 1e-6;
    O.regrowScale = 0; const o1 = F.ore; run(M, 60); const off = F.ore === o1;
    check(`${id}: regrowth stops at the starting amount; slider at 0 stops it`, capped && off, `${(F.ore / F.total * 100).toFixed(0)} % of start after a long regrow at 4×`);
    R.regrow = { rate, front: rIn, field: rAll };
  }
}
const md = ['# Economy balance (round 1 ore fields)', '', `Game speed ${GS}× · harvester ${CAP} credits per load, loading ${economy.load_rate} credits / game s · regrowth ${(economy.regrow_share * 100).toFixed(0)} % of that per field (${(economy.regrow_share * economy.load_rate).toFixed(1)} / game s)`, '',
  '| map | start | home round trip (real s) | income, 1 harvester ($/real min) | 2 harvesters | patch moves per load |', '|---|---|---|---|---|---|'];
for (const [id, R] of Object.entries(rows)) for (const [pad, P] of Object.entries(R.pads)) md.push(`| ${id} | ${pad} | ${P.rt.length ? (P.rt.reduce((a, b) => a + b, 0) / P.rt.length).toFixed(1) : '—'} | ${P.inc1.toFixed(0)} | ${P.inc2.toFixed(0)} | ${P.hopsPerLoad.toFixed(1)} |`);
md.push('', '| map | fields (kind: patches, ore) | 3 harvesters strip a home field in (real min) |', '|---|---|---|');
for (const [id, R] of Object.entries(rows)) md.push(`| ${id} | ${R.fields.map((f) => `${f.id} ${f.kind}: ${f.patches}, ${f.total}`).join('<br>')} | ${R.deplete && R.deplete.minutes3 ? R.deplete.minutes3.toFixed(1) : '—'} (${R.deplete ? R.deplete.field : ''}) |`);
md.push('', out.join('  \n'), '', `${pass}/${pass + fail} checks passed`);
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true }); fs.writeFileSync(path.join(HERE, 'results', 'econ.md'), md.join('\n') + '\n'); fs.writeFileSync(path.join(HERE, 'results', 'econ.json'), JSON.stringify(rows, null, 1));
console.log(`\n${pass}/${pass + fail} checks passed`); process.exit(fail ? 1 : 0);
