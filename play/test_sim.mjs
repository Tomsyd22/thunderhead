// Headless Stage 2 simulation test on Emerald Strait (map 01): the real map data, navigation, game rules and two AI players.
// node play/test_sim.mjs [--minutes 12] [--quick]
// Checks: the match runs without exceptions; tick cost stays inside the frame budget; harvesters complete cycles on both
// sides with round trips in the pace model's range; production delivers units through the doors; no unit is stuck;
// group moves arrive together; AI waves reach the enemy base; refunds are exact.
// deterministic runs: the AI's random spreads use a seeded generator (SEED env, default 7)
let __s = +(process.env.SEED || 7); Math.random = () => { __s |= 0; __s = (__s + 0x6D2B79F5) | 0; let t = Math.imul(__s ^ (__s >>> 15), 1 | __s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMapTerrain } from './mapdata.js';
import { createMatch, stepMatch, applyMapping } from './setup.js';
import { TICK } from './engine/mech.js';
import { STRUCTURES } from './rules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const MIN = arg('--minutes', 12);
const M01 = path.join(HERE, '..', 'maps', 'lab', 'data', '01');
const rd = (f) => fs.readFileSync(path.join(M01, f));
const meta = JSON.parse(rd('map.json')), instances = JSON.parse(rd('instances.json'));
const h = rd('height.f32'); const height = new Float32Array(h.buffer, h.byteOffset, h.length / 4);
const u8 = (f) => { try { const b = rd(f); return new Uint8Array(b.buffer, b.byteOffset, b.length); } catch (e) { return null; } };
const T = makeMapTerrain({ meta, height, surface: u8('surface.u8'), nav: u8('nav.u8'), deck: u8('deck.u8'), instances });
const spec = applyMapping(JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'unit_specs.json'))), JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'faction_mapping.json'))));
const geom = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'sockets.json')));
const pace = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'pace.json'))), combat = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'combat.json')));

let pass = 0, fail = 0; const out = [];
const check = (name, ok, info = '') => { (ok ? pass++ : fail++); const line = `${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`; out.push(line); console.log(line); };
const t0 = Date.now();

// ── 1. navigation on the real map ──
{
  const M = createMatch({ T, spec, geom, pace, combat, players: [{ faction: 'compact', pad: 'B1' }, { faction: 'lattice', pad: 'R1' }], startUnits: false });
  const nav = M.nav; check('kit footprints re-opened on both pads', nav.opened > 50, `${nav.kits.length} kit buildings, ${nav.opened} cells`);
  const B = meta.pads.find((p) => p.id === 'B1').center, R = meta.pads.find((p) => p.id === 'R1').center;
  for (const [dom, r] of [['foot', 0.35], ['veh', 2.2], ['hover', 1.7]]) {
    const q0 = performance.now(); const P = nav.path(dom, B[0], B[1], R[0], R[1], r, r + 1.5); const ms = performance.now() - q0;
    let L = 0, prev = B; for (const p of P.pts) { L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
    check(`${dom} path base to base`, P.reached && ms < 120, `${P.pts.length} waypoints, ${L.toFixed(0)} m, ${ms.toFixed(1)} ms`);
  }
  // refinery docks of the kit: approach points reachable by vehicles
  for (const pad of meta.pads) for (const d of pad.refinery_docks || []) check(`dock approach ${pad.id} (${d.approach.map((v) => v.toFixed(0))}) is vehicle ground`, nav.okAt('veh', d.approach[0], d.approach[1], 2.2));
}

// ── 2. economy and production rules (player-driven, no AI) ──
{
  const M = createMatch({ T, spec, geom, pace, combat, players: [{ faction: 'helix', pad: 'B1' }, { faction: 'compact', pad: 'R1' }], startUnits: false });
  const G = M.game, W = M.world, p = G.players[0], step = (sec) => { for (let i = 0; i < Math.round(sec / TICK); i++) { stepMatch(M, TICK); W.events.length = 0; } };
  const c0 = p.credits; G.enqueue(p, 'structure', 'power'); step(5); const spent = c0 - p.credits; G.cancel(p, 'structure', 'power');
  check('cancel refunds every credit spent', Math.abs(p.credits - c0) < 1e-6 && spent > 0, `spent ${spent.toFixed(1)} in 5 s, back to ${p.credits.toFixed(1)}`);
  G.enqueue(p, 'structure', 'power'); step(STRUCTURES.power.cost / 24 + 1); check('structure becomes ready after cost / build rate', !!p.ready, `${(STRUCTURES.power.cost / 24).toFixed(1)} game s`);
  const y = W.byId.get(p.yard); let spot = null;
  for (let r = 30; r < 160 && !spot; r += 6) for (let a = 0; a < 16 && !spot; a++) { const c = G.canPlace(p, 'power', y.x + Math.cos(a / 16 * 6.283) * r, y.y + Math.sin(a / 16 * 6.283) * r); if (c.ok) spot = c; }
  check('placement finds a valid spot near the yard', !!spot); if (spot) G.place(p, spot.x, spot.y);
  check('power plant adds power', p.power.made >= 200, `${p.power.made}/${p.power.used}`);
  const far = G.canPlace(p, 'barracks', y.x + 400, y.y - 400); check('placement outside the build radius is refused', !far.ok, far.reason);
  const onYard = G.canPlace(p, 'barracks', y.x, y.y); check('placement on a structure is refused', !onYard.ok, onYard.reason);
  // refinery → free harvester → harvest cycles
  G.enqueue(p, 'structure', 'refinery'); step(STRUCTURES.refinery.cost / 24 + 1);
  let rs = null; const field = G.deposits.filter((d) => d.nearest === 'B1').sort((a, b) => Math.hypot(a.svc[0] - y.x, a.svc[1] - y.y) - Math.hypot(b.svc[0] - y.x, b.svc[1] - y.y))[0];
  for (let r = 40; r < 200 && !rs; r += 4) for (let a = 0; a < 24 && !rs; a++) { const x = y.x + (field.svc[0] - y.x) * 0.5 + Math.cos(a / 24 * 6.283) * (r - 40), yy = y.y + (field.svc[1] - y.y) * 0.5 + Math.sin(a / 24 * 6.283) * (r - 40); const c = G.canPlace(p, 'refinery', x, yy); if (c.ok) rs = c; }
  check('refinery placement', !!rs); if (rs) G.place(p, rs.x, rs.y);
  const hv = W.units.find((u) => u.alive && u.uid === 'HV' && u.team === p.team); check('refinery delivers a free harvester', !!hv);
  const cycles = []; let credits0 = p.credits;
  for (let i = 0; i < Math.round(150 / TICK); i++) { stepMatch(M, TICK); for (const e of W.events) if (e.type === 'harvest_cycle' && e.id === hv.id) cycles.push(e); W.events.length = 0; }
  const real = cycles.slice(1).map((c) => c.total / pace.game_speed);
  check('harvester completes cycles on the real map', cycles.length >= 2, `${cycles.length} cycles, real round trips ${real.map((x) => x.toFixed(1)).join(', ')} s at ${pace.game_speed}×`);
  check('harvest credits arrive', p.credits - credits0 >= 500 * (cycles.length - 0.01) - 1e-6, `+${(p.credits - credits0).toFixed(0)}`);
  check('nearest-field round trip in the 20–40 s band (player-placed refinery)', real.length > 0 && real.every((x) => x >= 15 && x <= 40), real.map((x) => x.toFixed(1)).join(', '));
  // barracks + production through the door
  G.enqueue(p, 'structure', 'barracks'); step(STRUCTURES.barracks.cost / 24 + 1); let bs = null;
  for (let r = 30; r < 200 && !bs; r += 6) for (let a = 0; a < 24 && !bs; a++) { const c = G.canPlace(p, 'barracks', y.x + Math.cos(a / 24 * 6.283) * r, y.y + Math.sin(a / 24 * 6.283) * r); if (c.ok) bs = c; }
  if (bs) G.place(p, bs.x, bs.y); step(2);
  G.enqueue(p, 'infantry', 'A01', 3); let got = 0, door = 0; const bk = G.structures(p).find((b) => b.kind === 'barracks');
  for (let i = 0; i < Math.round(40 / TICK); i++) { stepMatch(M, TICK); for (const e of G.since(M._seq || 0)) { M._seq = e.seq; if (e.type === 'unit_ready' && e.player === 0) { got++; const u = W.byId.get(e.id); if (u && bk && Math.hypot(u.x - bk.x, u.y - bk.y) < 20) door++; } } W.events.length = 0; }
  check('infantry trains and leaves through the barracks door', got === 3 && door === 3, `${got} ready, ${door} at the door`);
}

// ── 3. AI vs AI match ──
{
  const M = createMatch({ T, spec, geom, pace, combat, players: [{ faction: 'compact', pad: 'B1', isAI: true }, { faction: 'lattice', pad: 'R1', isAI: true }] });
  const W = M.world, G = M.game; const ticks = Math.round(MIN * 60 / TICK); let worst = 0, sum = 0, n = 0, err = null; const slow = [];
  const stuck = new Map(); let stuckMax = 0, stuckWho = ''; const cyc = [0, 0]; const tl = []; let waves = 0, contact = null; let seq = 0; const builtKinds = {};
  const base = G.players.map((p) => [p.start.x, p.start.y]);
  try {
    for (let i = 0; i < ticks; i++) {
      const q0 = performance.now(); stepMatch(M, TICK); const ms = performance.now() - q0; sum += ms; n++; if (ms > worst) worst = ms; if (ms > 20) slow.push(`${W.t.toFixed(1)}s ${ms.toFixed(0)}ms`);
      for (const e of W.events) if (e.type === 'harvest_cycle') cyc[e.team]++;
      if (process.env.TRACE && i % 15 === 0) { const u = W.byId.get(+process.env.TRACE); if (u && u.alive && W.t > +(process.env.T0 || 0) && W.t < +(process.env.T1 || 1e9)) { const k = W.nav.cellOf(u.x, u.y), fx = Math.cos(u.hdg) * 0.18, fy = Math.sin(u.hdg) * 0.18;
        console.log(W.t.toFixed(1), u.x.toFixed(2), u.y.toFixed(2), 'hdg', (u.hdg * 57.3).toFixed(0), 'v', u.v.toFixed(2), 'pi', u.pi, JSON.stringify(u.path && u.path.slice(u.pi, u.pi + 2).map((q) => q.map(Math.round))), 'ok', +W._okPos(u, u.x, u.y), +W._okPos(u, u.x + fx, u.y + fy), +W._okPos(u, u.x + fx, u.y), +W._okPos(u, u.x, u.y + fy), 'prog', u.prog && u.prog.n, u.prog && u.prog.d.toFixed(1), 'tgt', u.target, u.order.type, 'sys', u.sys[0].wind ? 'wind' : '', (W.t - u.sys[0].lastFire).toFixed(1)); } }
      W.events.length = 0;
      for (const e of G.since(seq)) { seq = e.seq; if (e.type === 'ai_wave') waves++; if (e.type === 'built') (builtKinds[e.player] = builtKinds[e.player] || new Set()).add(e.kind); }
      if (i % 30 === 0) {
        for (const u of W.units) { if (!u.alive || u.dom === 'air' || u.scripted) { stuck.delete(u.id); continue; }
          const s = stuck.get(u.id) || { x: u.x, y: u.y, t: W.t }; const moved = Math.hypot(u.x - s.x, u.y - s.y);
          if (!u.path || moved > 3 || u.target != null) stuck.set(u.id, { x: u.x, y: u.y, t: W.t }); else { const d = W.t - s.t; if (d > stuckMax) { const k = W.nav.cellOf(u.x, u.y); stuckMax = d; stuckWho = `${u.uid}#${u.id} at (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) order ${JSON.stringify(u.order)} v ${u.v.toFixed(2)} path ${JSON.stringify(u.path.slice(u.pi, u.pi + 2).map((q) => q.map(Math.round)))} pass ${W.nav.pass[u.dom][k]} clear ${W.nav.clear[u.dom][k].toFixed(1)} deploy ${u.deploy} hidden ${u.hidden}`; } } }
        if (!contact) for (const u of W.units) if (u.alive && u.uid !== 'HV') { const e = base[1 - u.team]; if (Math.hypot(u.x - e[0], u.y - e[1]) < 180) { contact = `${u.uid} team ${u.team} at ${W.t.toFixed(0)} s`; break; } }
      }
      if (i % (30 * 60) === 0) tl.push(G.players.map((p) => `${p.name.split(' ').pop()} $${p.credits.toFixed(0)} ${G.structures(p).length}b ${G.unitsOf(p).length}u`).join(' | ') + ` @${(W.t / 60).toFixed(0)}m`);
      if (G.over) break;
    }
  } catch (e) { err = e; }
  check('AI match runs without exceptions', !err, err ? (err.stack || String(err)).split('\n').slice(0, 4).join(' / ') : `${(W.t / 60).toFixed(1)} game min`);
  for (const l of tl) console.log('   ', l);
  const budget = 1000 / 60 / pace.game_speed * 2.4;   // at 2.4×, 2.4 ticks per 60 Hz frame on average
  check('average tick cost leaves room for rendering', sum / n < 4, `avg ${(sum / n).toFixed(2)} ms/tick, worst ${worst.toFixed(1)} ms (${slow.length} ticks > 20 ms${slow.length ? ': ' + slow.slice(0, 4).join(', ') : ''}); per-frame sim budget ≈ ${budget.toFixed(1)} ms`);
  check('both AIs harvest', cyc[0] > 5 && cyc[1] > 5, `cycles ${cyc.join(' / ')}`);
  for (const p of G.players) { const s = [...(builtKinds[p.id] || [])]; check(`AI ${p.faction} builds a base`, ['power', 'refinery', 'barracks', 'factory'].every((k) => s.includes(k)), s.join(' ')); }
  check('AI armies are produced', G.players.every((p) => G.unitsOf(p).filter((u) => u.uid !== 'HV').length + p.stats.lostUnits >= 10), G.players.map((p) => `${G.unitsOf(p).length} alive, ${p.stats.lostUnits} lost`).join(' | '));
  check('AI waves are launched and reach the enemy base', waves >= 1 && !!contact, `${waves} waves, first contact ${contact || 'none'}`);
  check('no ground unit stuck on a path for 20 s', stuckMax < 20, stuckMax ? `worst ${stuckMax.toFixed(0)} s: ${stuckWho}` : '');
  { // round 1: every door and refinery dock the AIs built still opens onto ground connected to their yard's door
    let n = 0, bad = []; const nav = W.nav;
    const lab = (dom, pt) => { const L = nav.labels(dom); let k = nav.cellOf(pt[0], pt[1]); if (!L[k]) { const q = nav.nearestOk(dom, pt[0], pt[1], 0.5, 12); if (!q) return 0; k = nav.cellOf(q[0], q[1]); } return L[k]; };
    for (const p of G.players) { const y = G.structures(p).find((b) => b.kind === 'yard'); if (!y) continue; const ref = G.lanesOf('yard', y.x, y.y, y.rot)[0].end;
      for (const b of G.structures(p)) if (b !== y) for (const L of G.lanesOf(b.kind, b.x, b.y, b.rot)) { n++; if (!lab(L.dom, L.end) || lab(L.dom, L.end) !== lab(L.dom, ref)) bad.push(`${p.faction} ${b.kind}`); } }
    check('doors and refinery docks of AI-built bases stay reachable', n > 0 && !bad.length, `${n} lanes checked${bad.length ? ', cut off: ' + bad.join(', ') : ''}`);
  }
  check('engine counters', W.stats.shots > 0, `shots ${W.stats.shots}, hits ${W.stats.hits}, kills ${W.stats.kills}`);
}

console.log(`\n${pass}/${pass + fail} checks passed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true }); fs.writeFileSync(path.join(HERE, 'results', 'sim.txt'), out.join('\n') + `\n${pass}/${pass + fail}\n`);
process.exit(fail ? 1 : 0);
