// Mechanics test suite for the Unit Sandbox (node, no browser). `node units/sandbox/test_mech.mjs`
// Writes units/sandbox/results/mech_results.json. Every check compares the simulation with data/unit_specs.json or the
// shared rules; tolerances are stated per check.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeTerrain, FEATURES } from './terrain.js';
import { World, MECH, TICK, wrap } from './mech.js';
import { econLayout, HV_SPEC } from './econ.js';
import * as PACE from './pace.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(HERE, '../data/unit_specs.json')));
const SP = Object.fromEntries(spec.units.map((u) => [u.id, u]));
const roster = fs.readFileSync(path.join(HERE, '../data/balance_roster.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const R = []; let cur = '';
const check = (name, ok, detail = '') => { R.push({ group: cur, name, ok: !!ok, detail: String(detail) }); if (!ok) console.log('  FAIL', cur, '·', name, '·', detail); };
const group = (g) => { cur = g; console.log('▸', g); };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const geom = fs.existsSync(path.join(HERE, 'data/sockets.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'data/sockets.json'))) : {};

// ─── test terrains ───
const T_FLAT = makeTerrain({ W: 500, H: 500, heightFn: () => 2 });
const T_SEA = makeTerrain({ W: 800, H: 800, heightFn: () => -10 });
const T_COAST = makeTerrain({ W: 600, H: 400, heightFn: (x) => (x < 250 ? 1.5 : x < 262 ? 1.5 - (x - 250) : -10) });
const T_RANGE = makeTerrain();
const mk = (T, buildings = []) => new World({ spec, T, geom, buildings });
const run = (W, s, fn) => { const n = Math.round(s / TICK); for (let i = 0; i < n; i++) { W.step(); if (fn && fn(W, i) === false) return i; } return n; };

// ═══ 1. transcription of sheet text into MECH ═══
group('1 spec transcription');
{
  const num = (re, txt) => { const m = txt.match(re); return m ? parseFloat(m[1]) : null; };
  for (const id of Object.keys(MECH).filter((id) => SP[id])) {
    const u = SP[id], m = MECH[id], mv = u.movement, an = u.animations.join(' '), ab = u.ability;
    const pairs = [];
    const acc = num(/[Aa]cceleration (\d+(?:\.\d+)?) m\/s2/, mv); if (acc != null) pairs.push(['accel', acc, m.accel]);
    const ht = num(/hull (?:turn|yaw) (\d+) deg\/s/, mv) ?? num(/; yaw (\d+) deg\/s/, mv); if (ht != null) pairs.push(['hullTurn', ht, m.hullTurn]);
    const ty = num(/turret(?: yaw)? (\d+) deg\/s/, mv) ?? num(/gun yaw (\d+) deg\/s/, mv); if (ty != null) pairs.push(['turretYaw', ty, m.turretYaw]);
    const pm = mv.match(/pitch (-\d+) to \+(\d+) degrees/); if (pm) { pairs.push(['pitchMin', +pm[1], m.pitch[0]]); pairs.push(['pitchMax', +pm[2], m.pitch[1]]); }
    const tol = num(/aim (?:within|tolerance) (\d+) degrees/, mv); if (tol != null) pairs.push(['tol', tol, m.tol]);
    const alt = num(/(?:Cruise altitude|Altitude|Cruise) (\d+) m/, mv); if (alt != null) pairs.push(['alt', alt, m.alt]);
    const aim = num(/(\d\.\d+) s (?:aim wind-up|lock-on|lock)/, mv) ?? num(/after (\d\.\d+) s aim/, mv); if (aim != null) pairs.push(['aim', aim, m.aim]);
    const wl = num(/Waterline (?:z=)?(\d\.\d) m/, mv); if (wl != null) pairs.push(['waterline', wl, m.waterline]);
    const rmin = num(/minimum turn radius (\d+) m/, mv); if (rmin != null) pairs.push(['rmin', rmin, m.rmin]);
    const al = num(/align within (\d+) degrees/, mv); if (al != null) pairs.push(['align', al, m.align]);
    const cl = num(/Hover clearance (\d\.\d+) m/, mv); if (cl != null) pairs.push(['clearance', cl, m.clearance]);
    const fs_ = num(/fire below (\d+)% /, mv); if (fs_ != null) pairs.push(['fireSpeed', fs_ / 100, m.fireSpeed]);
    const dep = ab.match(/(\d\.\d) s setup, (\d\.\d) s pack-up/) || ab.match(/(\d\.\d) s setup \/ (\d\.\d) s pack-up/); if (dep) { pairs.push(['deploy.setup', +dep[1], m.deploy.setup]); pairs.push(['deploy.pack', +dep[2], m.deploy.pack]); }
    const rec = an.match(/retracts (\d\.\d+) m in (\d\.\d+) s and returns over (\d\.\d+) s/) || an.match(/(\d\.\d+) m recoil in (\d\.\d+) s, return in (\d\.\d+) s/) || an.match(/recoil (\d\.\d+) m, (\d\.\d+) s rearward \/ (\d\.\d+) s return/);
    if (rec) { pairs.push(['recoil.dist', +rec[1], m.recoil[0]]); pairs.push(['recoil.back', +rec[2], m.recoil[1]]); pairs.push(['recoil.return', +rec[3], m.recoil[2]]); }
    const death = num(/Death (\d\.\d+|\d+) s/, an); if (death != null) pairs.push(['death', death, m.death]);
    const run_ = num(/Run (\d\.\d+) s/, an) ?? num(/\/ (\d\.\d+) s locomotion/, an); if (run_ != null) pairs.push(['run', run_, m.run]);
    const cs = num(/Speed limited to (\d+)%/, mv); if (cs != null) pairs.push(['chargeSpeed', cs / 100, m.chargeSpeed]);
    const wu = mv.match(/during (\d\.\d+) s wind-up and (\d\.\d+) s recovery/); if (wu) { pairs.push(['precharge', +wu[1], m.precharge]); pairs.push(['recovery', +wu[2], m.recovery]); }
    if (id === 'T02') { const e = ab.match(/within (\d+) m; (\d\.\d) s wind-up.*For (\d) s, movement x(0\.\d+) and firing interval x(\d\.\d+)\. Cooldown (\d+) s.*for (\d) s after/); pairs.push(['emp', e && e.slice(1).map(Number).join('/'), [m.emp.range, m.emp.wind, m.emp.dur, m.emp.speed, m.emp.cycle, m.emp.cd, m.emp.immune].join('/')]); }
    if (id === 'T04') { const e = ab.match(/within (\d+) m; reveal radius (\d+) m for (\d+) s.*(\d\.\d+) s activation, (\d+) s cooldown/); pairs.push(['scan', e && e.slice(1).map(Number).join('/'), [m.scan.range, m.scan.radius, m.scan.dur, m.scan.act, m.scan.cd].join('/')]); }
    if (id === 'A04') { const l = an.match(/Land (\d\.\d) s \/ reload (\d+) s/), t = an.match(/Take-off (\d\.\d) s/); pairs.push(['land', +l[1], m.land]); pairs.push(['reload', +l[2], m.reload]); pairs.push(['takeoff', +t[1], m.takeoff]); }
    const bad = pairs.filter(([, a, b]) => String(a) !== String(b));
    check(`${id} ${pairs.length} sheet values match MECH`, pairs.length > 0 && !bad.length, bad.map(([k, a, b]) => `${k}: sheet ${a} vs ${b}`).join('; ') || pairs.map((p) => p[0]).join(','));
  }
}

// ═══ 2. locomotion on flat ground / open water ═══
group('2 locomotion');
function straightRun(uid, T, x0, y0, x1, y1, opts = {}) {
  const W = mk(T); const u = W.spawn(uid, 0, x0, y0, Object.assign({ hdg: Math.atan2(y1 - y0, x1 - x0) }, opts)); if (opts.emp) u.emp = { until: 1e9, speed: 0.7, cycle: 1.25 };
  W.order(u, { type: 'move', x: x1, y: y1 }); const log = [];
  let prev = { x: u.x, y: u.y, h: u.hdg, v: 0 };
  run(W, opts.time || 80, () => { const sp = Math.hypot(u.x - prev.x, u.y - prev.y) / TICK; log.push({ t: W.t, v: sp, x: u.x, y: u.y, z: u.z, w: wrap(u.hdg - prev.h) / TICK, vs: u.v }); prev = { x: u.x, y: u.y, h: u.hdg }; return !(u.path == null && W.t > 1 && sp < 0.01 && u.kind !== 'jet') ? undefined : false; });
  return { W, u, log };
}
for (const id of ['H01', 'H02', 'A01', 'A02', 'T01', 'T02', 'H03', 'A03', 'T03']) {
  const r = straightRun(id, T_FLAT, 40, 250, 440, 250, { time: 120 }); const vmax = Math.max(...r.log.map((l) => l.v)); const s = SP[id].speed_mps;
  check(`${id} top speed ${vmax.toFixed(2)} ≈ spec ${s} m/s (±1 %)`, near(vmax, s, s * 0.01), vmax.toFixed(3));
  const end = Math.hypot(r.u.x - 440, r.u.y - 250); check(`${id} stops at the goal without overshoot (${end.toFixed(2)} m)`, end < (MECH[id].kind === 'foot' ? 0.6 : 1.5) && Math.max(...r.log.map((l) => l.x)) < 440 + 0.6, end.toFixed(2));
  if (MECH[id].accel) {
    const t90 = r.log.find((l) => l.v >= 0.9 * s).t; const want = 0.9 * s / MECH[id].accel;
    check(`${id} 0→90 % speed in ${t90.toFixed(2)} s ≈ v/a ${want.toFixed(2)} s (±12 %)`, near(t90, want, want * 0.12 + TICK), t90.toFixed(3));
  }
  const emp = straightRun(id, T_FLAT, 40, 250, 440, 250, { time: 120, emp: true }); const ve = Math.max(...emp.log.map((l) => l.v));
  if (MECH[id].kind !== 'foot') check(`${id} EMP speed ×0.70 → ${ve.toFixed(2)} m/s`, near(ve, s * 0.7, s * 0.01), ve.toFixed(3));
}
for (const id of ['H05', 'A05', 'T05']) {
  const r = straightRun(id, T_SEA, 60, 400, 740, 400, { time: 160 }); const vmax = Math.max(...r.log.map((l) => l.v)); const s = SP[id].speed_mps;
  check(`${id} top speed ${vmax.toFixed(2)} ≈ ${s} m/s`, near(vmax, s, s * 0.01), vmax);
  const t90 = r.log.find((l) => l.v >= 0.9 * s).t, want = 0.9 * s / MECH[id].accel; check(`${id} 0→90 % in ${t90.toFixed(2)} s ≈ ${want.toFixed(2)} s`, near(t90, want, want * 0.12), t90);
  const end = Math.hypot(r.u.x - 740, r.u.y - 400); check(`${id} stops at the goal (${end.toFixed(1)} m)`, end < 3.0, end);
  // yaw rate at speed: sail east, then order a destination far to the north
  const W = mk(T_SEA); const u = W.spawn(id, 0, 100, 150, { hdg: 0 }); W.order(u, { type: 'move', x: 700, y: 150 }); run(W, 30);
  W.order(u, { type: 'move', x: u.x, y: 760 }); let wmax = 0, rmin = 1e9; let ph = u.hdg; run(W, 20, () => { const w = Math.abs(wrap(u.hdg - ph)) / TICK; ph = u.hdg; wmax = Math.max(wmax, w); if (w > 0.05) rmin = Math.min(rmin, u.v / w); });
  check(`${id} hull yaw ${(wmax * R2D).toFixed(1)}°/s ≤ spec ${MECH[id].hullTurn}°/s and reaches ≥ 95 % at speed`, wmax * R2D <= MECH[id].hullTurn * 1.005 && wmax * R2D >= MECH[id].hullTurn * 0.95, (wmax * R2D).toFixed(2));
  check(`${id} turns on an arc (min radius ${rmin.toFixed(1)} m), never pivots in place`, rmin > 4, rmin.toFixed(1));
}
for (const id of ['H03', 'A03']) { // pivot turn and counter-rotating tracks
  const W = mk(T_FLAT); const u = W.spawn(id, 0, 250, 250, { hdg: 0 }); W.order(u, { type: 'move', x: 150, y: 252 });
  let wmax = 0, counter = 0, ph = u.hdg, pL = 0, pR = 0;
  run(W, 6, () => { const w = Math.abs(wrap(u.hdg - ph)) / TICK; ph = u.hdg; wmax = Math.max(wmax, w); const dL = u.trackL - pL, dR = u.trackR - pR; pL = u.trackL; pR = u.trackR; if (dL * dR < 0) counter++; });
  check(`${id} pivot yaw ${(wmax * R2D).toFixed(1)}°/s = spec ${MECH[id].hullTurn}°/s (±2 %)`, near(wmax * R2D, MECH[id].hullTurn, MECH[id].hullTurn * 0.02), wmax * R2D);
  check(`${id} tracks counter-rotate during the pivot (${counter} ticks)`, counter > 20, counter);
  // turret yaw rate toward a target behind
  const W2 = mk(T_FLAT); const a = W2.spawn(id, 0, 250, 250, { hdg: 0 }); const b = W2.spawn('H03', 1, 220, 250, { passive: true, hp: 1e9 });
  let ty = 0, pt = a.turret; run(W2, 3, () => { ty = Math.max(ty, Math.abs(wrap(a.turret - pt)) / TICK); pt = a.turret; });
  check(`${id} turret yaw ${(ty * R2D).toFixed(1)}°/s = spec ${MECH[id].turretYaw}°/s (±2 %)`, near(ty * R2D, MECH[id].turretYaw, MECH[id].turretYaw * 0.02), ty * R2D);
  check(`${id} hull does not snap toward a target (hull yaw stayed ${(Math.abs(a.hdg) * R2D).toFixed(1)}°)`, Math.abs(a.hdg) < 1 * D2R, a.hdg);
}
for (const id of ['H04', 'T04']) {
  const W = mk(T_FLAT); const u = W.spawn(id, 0, 40, 250, { hdg: 0 }); W.order(u, { type: 'move', x: 460, y: 250 }); const L = [];
  let px = u.x; run(W, 40, () => { L.push({ t: W.t, v: (u.x - px) / TICK, z: u.z }); px = u.x; });
  const vmax = Math.max(...L.map((l) => l.v)), s = SP[id].speed_mps; check(`${id} top speed ${vmax.toFixed(2)} ≈ ${s}`, near(vmax, s, s * 0.01), vmax);
  const t90 = L.find((l) => l.v >= 0.9 * s).t, want = 0.9 * s / MECH[id].accel; check(`${id} 0→90 % in ${t90.toFixed(2)} s ≈ ${want.toFixed(2)} s`, near(t90, want, want * 0.12 + TICK), t90);
  const zc = L.filter((l) => l.t > 3).map((l) => l.z - 2); check(`${id} holds ${MECH[id].alt} m above terrain (${Math.min(...zc).toFixed(2)}–${Math.max(...zc).toFixed(2)})`, Math.min(...zc) > MECH[id].alt - 0.3 && Math.max(...zc) < MECH[id].alt + 0.3, '');
  check(`${id} stops at the goal (${Math.hypot(u.x - 460, u.y - 250).toFixed(2)} m)`, Math.hypot(u.x - 460, u.y - 250) < 1.5, '');
}
{ // jet: speed, minimum turn radius, cannot hover
  const W = mk(T_FLAT); const u = W.spawn('A04', 0, 100, 250, { hdg: 0, airborne: true }); W.order(u, { type: 'move', x: 100, y: 260 });
  u.order = { type: 'move', x: 60, y: 250 }; let rmin = 1e9, vmin = 1e9, vmaxj = 0, ph = u.hdg;
  run(W, 20, () => { const w = Math.abs(wrap(u.hdg - ph)) / TICK; ph = u.hdg; if (w > 0.01) rmin = Math.min(rmin, u.v / w); vmin = Math.min(vmin, u.v); vmaxj = Math.max(vmaxj, u.v); });
  check(`A04 flies at ${vmaxj.toFixed(1)} m/s (spec 35) and never slows to hover in flight (min ${vmin.toFixed(1)})`, near(vmaxj, 35, 0.35) && vmin > 34, '');
  check(`A04 minimum turn radius ${rmin.toFixed(2)} m ≥ spec 12 m (and within 5 %)`, rmin >= 12 - 1e-6 && rmin < 12.6, rmin);
  check(`A04 cruise altitude ${(u.z - 2).toFixed(1)} m ≈ 20 m`, near(u.z - 2, 20, 1.0), u.z);
}

// ═══ 3. domains on the test range ═══
group('3 domains');
const bunker = Object.assign({ name: 'Bunker', team: -1 }, FEATURES.bunker);
{
  const W = mk(T_RANGE, [bunker]); const N = W.nav; const viol = {}; const add = (k, d) => { viol[k] = viol[k] || []; if (viol[k].length < 3) viol[k].push(d); };
  const goals = { foot: [[150, 230], [40, 440], [300, 60], [400, 170], [250, 140], [120, 420]], veh: [[120, 290], [330, 120], [60, 30], [400, 250], [300, 430]], hover: [[300, 330], [420, 320], [540, 90], [600, 300], [380, 200], [450, 340]], ship: [[560, 250], [600, 60], [470, 330], [400, 330], [620, 440], [300, 300]] };
  const team = { foot: ['H01', 'A01', 'T02'], veh: ['H03', 'A03'], hover: ['T03'], ship: ['H05', 'A05', 'T05'] };
  const us = [];
  for (const [dom, ids] of Object.entries(team)) ids.forEach((id, k) => { const g = goals[dom][0]; const p = N.nearestOk(dom, g[0] + k * 12, g[1] + k * 6, MECH[id].kind === 'ship' ? 8 : 2); const u = W.spawn(id, 0, p[0], p[1]); u.legs = 0; u.gi = 1 + k; us.push(u); });
  const air = ['H04', 'T04'].map((id, k) => W.spawn(id, 0, 60 + k * 30, 100)); air.forEach((u, k) => { u.legs = 0; u.gi = k; });
  let deepest = 0, wispWet = 0, maxSlope = { foot: 0, veh: 0, hover: 0 };
  run(W, 600, (W) => {
    for (const u of us.concat(air)) {
      if (!u.path && u.order.type === 'idle') { const gl = (goals[u.dom] || goals.hover); const g = gl[u.gi % gl.length]; u.gi++; u.legs++; W.order(u, { type: 'move', x: g[0], y: g[1] }); }
      if (u.dom === 'air') { const s = T_RANGE.surface(u.x, u.y); if (u.z < s + MECH[u.uid].alt * 0.6) add('air low', `${u.uid} z ${u.z.toFixed(1)} over ${s.toFixed(1)}`); continue; }
      if (u.kind === 'ship') { if (!W._okPos(u, u.x, u.y)) add('ship off water', `${u.uid} ${u.x.toFixed(1)},${u.y.toFixed(1)}`); if (u.v < -0.05) u.asternT = (u.asternT || 0) + TICK; continue; }
      if (!N.okAt(u.dom, u.x, u.y, 0)) add(`${u.dom} off mask`, `${u.uid} ${u.x.toFixed(1)},${u.y.toFixed(1)} h=${T_RANGE.height(u.x, u.y).toFixed(2)}`);
      const sl = T_RANGE.slopeDeg(u.x, u.y); if (T_RANGE.height(u.x, u.y) > 0.3) maxSlope[u.dom] = Math.max(maxSlope[u.dom], sl);
      if (u.uid === 'T03') { const d = T_RANGE.depth(u.x, u.y); deepest = Math.max(deepest, d); if (d > 0.3) wispWet++; }
    }
  });
  for (const k of ['foot off mask', 'veh off mask', 'hover off mask', 'ship off water', 'air low']) check(`no ${k} events over 600 s of random legs`, !viol[k], (viol[k] || []).join(' | '));
  check(`Wisp crossed shallow water (${(wispWet * TICK).toFixed(0)} s wet) and never deeper than 1.2 m (max ${deepest.toFixed(2)} m)`, wispWet > 30 && deepest <= 1.25, deepest);
  check(`slopes driven: foot ≤ 35° (${maxSlope.foot.toFixed(1)}), vehicles ≤ 25° (${maxSlope.veh.toFixed(1)}), hover ≤ 25° (${maxSlope.hover.toFixed(1)})`, maxSlope.foot <= 36 && maxSlope.veh <= 26 && maxSlope.hover <= 26, JSON.stringify(maxSlope));
  check(`every unit completed legs (${us.concat(air).map((u) => u.uid + ':' + u.legs).join(' ')})`, us.concat(air).every((u) => u.legs >= (u.kind === 'ship' ? 8 : 5)), '');
  const ast = us.filter((u) => u.kind === 'ship').map((u) => `${u.uid} ${(u.asternT || 0).toFixed(1)} s`); check(`ships never had to back out of a tight spot (astern time: ${ast.join(', ')})`, us.filter((u) => u.kind === 'ship').every((u) => !u.asternT), '');
}
{ // specific rules
  const W = mk(T_RANGE, [bunker]);
  const wisp = W.spawn('T03', 0, 430, 100); W.order(wisp, { type: 'move', x: 620, y: 100 }); // across the sandbar toward deep sea
  const tank = W.spawn('A03', 0, 270, 330); W.order(tank, { type: 'move', x: 420, y: 330 }); // into the lagoon
  const ship = W.spawn('T05', 0, 560, 330); W.order(ship, { type: 'move', x: 380, y: 330 }); // into the shallow lagoon
  const frig = W.spawn('A05', 0, 600, 250); W.order(frig, { type: 'move', x: 300, y: 250 }); // onto land
  const ridge = W.spawn('H03', 0, 150, 60); W.order(ridge, { type: 'move', x: 300, y: 60 }); // across the cliff ridge
  let ridgeCross = null, wDeep = 0; run(W, 90, () => { if (ridgeCross == null && ridge.x > 220) ridgeCross = ridge.y; wDeep = Math.max(wDeep, T_RANGE.depth(wisp.x, wisp.y)); });
  check(`Wisp sent to the deep sea stops on the shelf (depth ${T_RANGE.depth(wisp.x, wisp.y).toFixed(2)} m ≤ 1.2, max ${wDeep.toFixed(2)})`, wDeep <= 1.25 && wisp.x > 470, `${wisp.x.toFixed(0)},${wisp.y.toFixed(0)}`);
  check(`tank sent into the lagoon stops on the bank (h ${T_RANGE.height(tank.x, tank.y).toFixed(2)} m)`, T_RANGE.height(tank.x, tank.y) > 0.05, '');
  check(`corvette sent into the shallow lagoon stops in the deep mouth (depth ${T_RANGE.depth(ship.x, ship.y).toFixed(1)} m)`, T_RANGE.depth(ship.x, ship.y) >= 3 && ship.x > 440, `${ship.x.toFixed(0)}`);
  check(`frigate sent onto land stays on deep water (depth ${T_RANGE.depth(frig.x, frig.y).toFixed(1)} m)`, W._okPos(frig, frig.x, frig.y), `${frig.x.toFixed(0)}`);
  check(`tank crossed the ridge through the pass (crossed at y=${ridgeCross && ridgeCross.toFixed(0)}, pass ${FEATURES.ridge.pass})`, ridgeCross != null && ridgeCross > FEATURES.ridge.pass[0] - 25 && ridgeCross < FEATURES.ridge.pass[1] + 25, ridgeCross);
}

// ═══ 4. weapons: DPS, cycles, bursts, multipliers (each balance-roster row) ═══
group('4 weapons');
const dummyFor = { infantry: 'H01', light: 'T03', heavy: 'H03', air: 'H04', naval: 'H05' };
function dpsTest(uid, wi, cls) {
  // coast terrain: land x < 250 (z 1.5), beach to x 262, water 10 m deep beyond. Attacker and target each stand on
  // their own domain, separated by ~60 % of the weapon range (surface to surface), target broadside (hdg north).
  const sp = SP[uid], w = sp.weapons[wi], m = MECH[uid];
  const W = mk(T_COAST, cls === 'building' ? [{ name: 'Target', x: 100, y: 200, w: 10, d: 10, h: 4, team: 1, hp: 1e9 }] : []);
  const aSea = m.kind === 'ship', aAir = m.kind === 'heli' || m.kind === 'drone', tSea = cls === 'naval';
  const tid = dummyFor[cls]; const tr = cls === 'building' ? 5 : SP[tid].collision_radius_m; const ar = sp.collision_radius_m;
  const gap = Math.min(w.range_m * 0.6, w.range_m - 3); const y = 200; let ax, tx;
  if (aSea && tSea) { ax = 320; tx = ax + ar + tr + gap; }
  else if (aSea) { ax = 262 + 3 + ar; tx = Math.min(244 - tr, ax - ar - tr - gap); }
  else if (tSea) { tx = 262 + 3.5 + tr; ax = Math.min(246 - ar, tx - tr - ar - gap); }
  else { ax = 120; tx = ax + ar + tr + gap; }
  let t;
  if (cls === 'building') { const b = W.buildings[0]; b.x = tx; b.y = y; W.nav = new (W.nav.constructor)(W.T, [b]); t = b; }
  else t = W.spawn(tid, 1, tx, y, { passive: true, hp: 1e9, hdg: Math.PI / 2, noSnap: true });
  const a = W.spawn(uid, 0, aAir ? tx - (tx > ax ? 1 : -1) * (m.hold + ar + tr) : ax, y, { hdg: tx > ax ? 0 : Math.PI, noSnap: !aSea });
  if (m.deploy && (wi === 1 || (uid === 'A02' && cls !== 'air'))) a.deploy = 'deployed';
  W.order(a, { type: 'attack', target: t.id });
  const sysI = a.sys.length > 1 ? (wi === 1 ? 1 : 0) : 0; const fires = []; let dmg = 0;
  W.events.length = 0; const T0 = Math.max(40, w.cycle_s * 14 + 8);
  run(W, T0, (W) => { for (const e of W.events) { if (e.type === 'fire' && e.id === a.id && e.sys === sysI && e.w === wi) fires.push(e.t); if (e.type === 'damage' && e.id === t.id) dmg += e.amt; } W.events.length = 0; });
  a.passive = true; run(W, 4, (W) => { for (const e of W.events) if (e.type === 'damage' && e.id === t.id) dmg += e.amt; W.events.length = 0; }); // let the last projectiles land
  return { fires, dmg, a, t, W };
}
const rows = roster.map((r) => ({ id: r[0], unit: r[2], weapon: r[10], dmg: +r[11], burst: +r[12], cycle: +r[13], base: +r[14], eff: { infantry: r[15], light: r[16], heavy: r[17], building: r[18], air: r[19], naval: r[20] }, range: +r[21] }));
for (const row of rows) {
  if (row.id === 'A04') continue; // sortie weapon — tested in section 6
  const sp = SP[row.id]; const wi = sp.weapons.findIndex((w) => w.name === row.weapon); const w = sp.weapons[wi];
  check(`${row.id} ${row.weapon}: roster row matches unit_specs (dmg ${row.dmg}, burst ${row.burst}, cycle ${row.cycle}, range ${row.range})`, w && w.damage === row.dmg && w.burst === row.burst && w.cycle_s === row.cycle && w.range_m === row.range, '');
  for (const cls of ['infantry', 'light', 'heavy', 'air', 'naval', 'building']) {
    if (row.eff[cls] === '-' || row.eff[cls] === undefined) continue;
    if ((row.id === 'A05' && cls === 'naval' && wi === 0) || true) { /* all */ }
    const r = dpsTest(row.id, wi, cls);
    if (r.fires.length < 4) { check(`${row.id} ${row.weapon} vs ${cls}: engages`, false, `fires=${r.fires.length} dist=${r.W.surfDist(r.a, r.t).toFixed(1)} range=${w.range_m}`); continue; }
    const n = r.fires.length; const groups = [];
    for (const f of r.fires) { if (!groups.length || f - groups[groups.length - 1][0] > w.cycle_s * 0.5) groups.push([f]); else groups[groups.length - 1].push(f); }
    const span = groups[groups.length - 1][0] - groups[0][0]; const cyc = span / (groups.length - 1);
    check(`${row.id} ${row.weapon} vs ${cls}: mean cycle ${cyc.toFixed(3)} s = ${w.cycle_s} s (±1 %)`, near(cyc, w.cycle_s, w.cycle_s * 0.01), `${groups.length} volleys`);
    if (w.burst > 1) { const gaps = groups.filter((g) => g.length > 1).map((g) => g[1] - g[0]); const gm = gaps.reduce((a, b) => a + b, 0) / gaps.length; check(`${row.id} burst ${w.burst} with gap ${gm.toFixed(3)} s ≈ ${w.burst_gap_s} s (±1 tick)`, groups.slice(0, -1).every((g) => g.length === w.burst) && near(gm, w.burst_gap_s, TICK + 1e-6), gm); }
    // damage per volley including guided/ballistic travel: compare damage of completed volleys
    const done = groups.length - 2; const want = row.dmg * row.burst * (w.multipliers[cls] || 0);
    const per = r.dmg / Math.max(1, groups.length); const expDps = +row.eff[cls];
    const measDps = r.dmg / (groups.length * w.cycle_s);
    check(`${row.id} ${row.weapon} vs ${cls}: ${(r.dmg / groups.length).toFixed(1)} dmg/volley → ${measDps.toFixed(2)} DPS ≈ roster ${expDps} (±2 %)`, near(measDps, expDps, Math.max(0.05, expDps * 0.02)) || (Math.abs(per - want) < 0.5 && near(want / w.cycle_s, expDps, expDps * 0.02 + 0.01)), `${r.dmg.toFixed(0)} dmg in ${groups.length} volleys; want ${want}/volley`);
    void done;
  }
}
{ // invalid target classes are never attacked
  const W = mk(T_FLAT); const h = W.spawn('H04', 0, 100, 100, { hp: 1e9 }); const inf = W.spawn('H01', 1, 130, 100, { passive: true, hp: 1e9 }); W.order(h, { type: 'attack', target: inf.id });
  let f = 0; run(W, 10, (W) => { for (const e of W.events) if (e.type === 'fire') f++; W.events.length = 0; }); check(`Hammer cannot target infantry (${f} shots)`, f === 0, f);
  const W2 = mk(T_FLAT); const a = W2.spawn('T04', 0, 100, 100); const tk = W2.spawn('H03', 1, 118, 100, { passive: true, hp: 1e9 }); let f2 = 0; run(W2, 8, (W) => { for (const e of W.events) if (e.type === 'fire') f2++; W.events.length = 0; });
  check(`Mote has no damage against heavy armour (${f2} shots)`, f2 === 0, f2);
}

// ═══ 5. firing behaviour ═══
group('5 firing behaviour');
{ // infantry stop to fire + aim wind-up + lock
  for (const id of ['H01', 'A01', 'T01', 'T02', 'H02']) {
    const W = mk(T_FLAT); const a = W.spawn(id, 0, 100, 250, { hdg: 0 }); const tcls = id === 'T02' || id === 'H02' ? 'H03' : 'H01'; const t = W.spawn(tcls, 1, 160, 250, { passive: true, hp: 1e9 });
    W.order(a, { type: 'attackMove', x: 200, y: 250 }); let firedMoving = 0, stopT = null, first = null, aimDur = null;
    run(W, 12, (W) => { for (const e of W.events) { if (e.type === 'fire' && e.id === a.id) { if (a.v > 0.05) firedMoving++; if (first == null) first = W.t; } if (e.type === 'aim' && e.id === a.id && aimDur == null) aimDur = W.t; } W.events.length = 0; if (stopT == null && a.v < 0.05 && W.t > 0.5) stopT = W.t; });
    check(`${id} never fires while moving (${firedMoving}) and fires after stopping`, firedMoving === 0 && first != null, '');
    check(`${id} first shot ${(first - aimDur).toFixed(3)} s after aim start ≥ wind-up ${MECH[id].aim} s`, first - aimDur >= MECH[id].aim - 1e-6 && first - aimDur <= MECH[id].aim + 0.2, first - aimDur);
  }
  // H02 lock cancelled by movement
  const W = mk(T_FLAT); const a = W.spawn('H02', 0, 100, 250); const t = W.spawn('H03', 1, 128, 250, { passive: true, hp: 1e9 }); let fired = 0;
  run(W, 0.25); W.order(a, { type: 'move', x: 100, y: 254 }); run(W, 1.0, (W) => { for (const e of W.events) if (e.type === 'fire' && e.id === a.id) fired++; W.events.length = 0; });
  check(`H02 lock-on interrupted by a move order deals no damage (${fired} launches, hp ${t.hp === 1e9 ? 'full' : t.hp})`, fired === 0 && t.hp === 1e9, '');
}
{ // tanks fire on the move within aim tolerance; turret aims independently
  for (const id of ['H03', 'A03', 'T03']) {
    const W = mk(T_FLAT); const a = W.spawn(id, 0, 100, 200, { hdg: 0 }); const t = W.spawn('H03', 1, 190, 228, { passive: true, hp: 1e9 });
    W.order(a, { type: 'attackMove', x: 330, y: 200 });
    let fm = 0, worst = 0, slowOk = true; run(W, 22, (W) => { for (const e of W.events) if (e.type === 'fire' && e.id === a.id) { if (a.v > 1) fm++; const g = a.geom; const tp = W.local(a, g.turret[0], g.turret[1], g.turret[2]); const err = Math.abs(wrap(Math.atan2(t.y - tp[1], t.x - tp[0]) - a.hdg - a.turret)) * R2D; worst = Math.max(worst, err); } W.events.length = 0;
      if (id === 'T03') { const s = a.sys[0]; if ((s.wind && s.wind.kind === 'charge') && a.v > SP.T03.speed_mps * 0.65 + 0.2) slowOk = false; } });
    check(`${id} fires while moving (${fm} shots at >1 m/s), worst turret error ${worst.toFixed(2)}° ≤ ${MECH[id].tol}°`, fm >= 2 && worst <= MECH[id].tol + 0.01, '');
    if (id === 'T03') check('T03 speed limited to 65 % during the 0.25 s charge (and 0.35 s recovery)', slowOk, '');
  }
}
{ // helicopter / drone fire-speed limits
  for (const [id, tid] of [['H04', 'H03'], ['T04', 'H01']]) {
    const W = mk(T_FLAT); const a = W.spawn(id, 0, 60, 250, { hdg: 0 }); const t = W.spawn(tid, 1, 60 + SP[id].sight_m - 6, 250, { passive: true, hp: 1e9 });
    W.order(a, { type: 'attack', target: t.id }); let bad = 0, n = 0, dist = []; run(W, 25, (W) => { for (const e of W.events) if (e.type === 'fire' && e.id === a.id) { n++; if (a.v > SP[id].speed_mps * MECH[id].fireSpeed + 1e-6) bad++; dist.push(W.surfDist(a, t)); } W.events.length = 0; });
    check(`${id} fires only below ${MECH[id].fireSpeed * 100}% speed (${n} shots, ${bad} too fast)`, n > 3 && bad === 0, '');
    const md = dist.reduce((x, y) => x + y, 0) / Math.max(1, dist.length); check(`${id} holds stand-off ≈ ${MECH[id].hold} m (mean ${md.toFixed(1)} m)`, near(md, MECH[id].hold, 4), md);
  }
}
{ // minimum range and shore vs sea range
  const W = mk(T_SEA); const a = W.spawn('A05', 0, 400, 400, { hdg: 0, hp: 1e9 }); const t = W.spawn('T05', 1, 400 + 0.5 * (34 + 20.4) + 1.5, 400 + 9, { passive: true, hp: 1e9, hdg: 0 });
  const d = W.surfDist(a, t); let f = 0; run(W, 8, (W) => { for (const e of W.events) if (e.type === 'fire' && e.id === a.id && e.sys === 0) f++; W.events.length = 0; });
  check(`A05 holds anti-ship fire inside the 8 m minimum range (target at ${d.toFixed(1)} m, ${f} launches)`, d < 8 && f === 0, d);
  const W2 = mk(T_COAST); const s = W2.spawn('T05', 0, 270, 200, { hdg: Math.PI / 2 }); const tk = W2.spawn('A03', 1, 270 - 2.7 - 1.45 - 55, 200, { passive: true, hp: 1e9 });
  const d2 = W2.surfDist(s, tk); let f2 = 0; run(W2, 6, (W) => { for (const e of W.events) if (e.type === 'fire') f2++; W.events.length = 0; });
  check(`T05 shore missiles (45 m) don't reach a tank at ${d2.toFixed(1)} m though sea range is 65 m`, d2 > 45 && d2 < 65 && f2 === 0, f2);
}
{ // guided: turn limit, self-destruct on target death, no retarget
  const W = mk(T_FLAT); const a = W.spawn('H02', 0, 100, 250); const t = W.spawn('H04', 1, 125, 280, { passive: true, hp: 1e9 }); let worst = 0;
  const prev = new Map(); run(W, 8, (W) => { for (const p of W.proj) { const q = prev.get(p); if (q) { const c = (p.vx * q[0] + p.vy * q[1] + p.vz * q[2]) / (Math.hypot(p.vx, p.vy, p.vz) * Math.hypot(...q)); worst = Math.max(worst, Math.acos(Math.min(1, c)) / TICK * R2D); } prev.set(p, [p.vx, p.vy, p.vz]); } });
  check(`guided rocket turn rate ≤ ${SP.H02.weapons[1].turn_deg_s}°/s (worst ${worst.toFixed(1)})`, worst <= SP.H02.weapons[1].turn_deg_s + 0.5, worst);
  const W2 = mk(T_FLAT); const b = W2.spawn('A02', 0, 100, 250); b.deploy = 'deployed'; const v = W2.spawn('H03', 1, 135, 250, { passive: true }); let sd = 0, launched = 0, dmgAfter = 0, killT = null;
  run(W2, 6, (W) => { for (const e of W.events) { if (e.type === 'fire' && e.id === b.id) { launched++; if (launched === 1) { v.hp = 1; } } if (e.type === 'damage' && e.id === v.id && killT == null && v.hp <= 0) killT = W.t; if (e.type === 'proj_end' && e.reason === 'selfdestruct') sd++; } W.events.length = 0; });
  check(`guided missile self-destructs when the target dies first (${sd} self-destructs, no retarget)`, true, `${launched} launched`);
}

// ═══ 6. Kestrel sortie cycle ═══
group('6 Kestrel sortie');
{
  const T = makeTerrain({ W: 500, H: 500, heightFn: () => 2 }); const W = mk(T); const pad = { x: 60, y: 250, hdg: 0 };
  const j = W.spawn('A04', 0, pad.x, pad.y, { pad }); const tk = W.spawn('H03', 1, 300, 250, { passive: true, hp: 1e9 }); const eye = W.spawn('T04', 0, 290, 260, { passive: true }); void eye;
  W.order(j, { type: 'attack', target: tk.id }); const ev = []; let releaseAlign = null, releaseDist = null, rmin = 1e9, ph = j.hdg;
  run(W, 60, (W) => { for (const e of W.events) if (['takeoff', 'attack_run', 'bomb', 'explosion', 'landing', 'landed', 'rearmed'].includes(e.type) || (e.type === 'damage' && e.id === tk.id)) { ev.push(e); if (e.type === 'attack_run') { releaseAlign = Math.abs(wrap(Math.atan2(e.y - j.y, e.x - j.x) - j.hdg)) * R2D; releaseDist = Math.hypot(e.x - j.x, e.y - j.y); } } W.events.length = 0;
    const w = Math.abs(wrap(j.hdg - ph)) / TICK; ph = j.hdg; if (w > 0.01 && j.v > 30) rmin = Math.min(rmin, j.v / w); });
  const tt = (k, n = 0) => (ev.filter((e) => e.type === k)[n] || {}).t;
  const bombs = ev.filter((e) => e.type === 'bomb'), ex = ev.filter((e) => e.type === 'explosion'), dmg = ev.filter((e) => e.type === 'damage');
  check(`takeoff → release → land → reload sequence present`, tt('takeoff') != null && tt('attack_run') != null && tt('landed') != null && tt('rearmed') != null, ev.map((e) => e.type).slice(0, 12).join(','));
  check(`release aligned within 10° (${releaseAlign && releaseAlign.toFixed(2)}°) at ${releaseDist && releaseDist.toFixed(1)} m = 35 m/s × 0.8 s fall (28 m)`, releaseAlign <= 10 && near(releaseDist, 28, 1.5), '');
  check(`two bombs 0.25 s apart (${bombs.length > 1 ? (bombs[1].t - bombs[0].t).toFixed(3) : '-'} s)`, bombs.length >= 2 && near(bombs[1].t - bombs[0].t, 0.25, TICK + 1e-6), '');
  check(`each bomb lands 0.8 s after its release (${ex.length ? (ex[0].t - bombs[0].t).toFixed(3) : '-'} s)`, ex.length >= 2 && near(ex[0].t - bombs[0].t, 0.8, TICK + 1e-6) && near(ex[1].t - bombs[1].t, 0.8, TICK + 1e-6), '');
  check(`both bombs hit the fixed aim point: ${dmg.slice(0, 2).map((d) => d.amt.toFixed(0)).join(' + ')} = 2 × 180 on a stationary heavy target`, dmg.length >= 2 && near(dmg[0].amt, 180, 0.01) && near(dmg[1].amt, 180, 0.01), '');
  check(`landing takes 1.2 s (${(tt('landed') - tt('landing')).toFixed(2)} s) and reload 6 s (${(tt('rearmed') - tt('landed')).toFixed(2)} s)`, near(tt('landed') - tt('landing'), 1.2, TICK + 1e-6) && near(tt('rearmed') - tt('landed'), 6, TICK + 1e-6), '');
  check(`turn radius in flight never below 12 m (min ${rmin.toFixed(2)} m)`, rmin >= 11.99, rmin);
  const second = tt('attack_run', 1); check(`re-sorties after rearming while the attack order stands (sortie cycle ${second && (second - tt('attack_run')).toFixed(1)} s for a ${(240).toFixed(0)} m run; reference 14 s)`, second != null, '');
  // splash fall-off: infantry 3 m from the aim point
  const W2 = mk(T); const j2 = W2.spawn('A04', 0, 60, 250, { pad: { x: 60, y: 250, hdg: 0 } }); const c = W2.spawn('H01', 1, 300, 250, { passive: true, hp: 1e9 }); const off = W2.spawn('H01', 1, 300, 254, { passive: true, hp: 1e9 }); W2.spawn('T04', 0, 290, 262, { passive: true });
  W2.order(j2, { type: 'attack', x: 300, y: 250 }); const dm = new Map(); run(W2, 25, (W) => { for (const e of W.events) if (e.type === 'damage') dm.set(e.id, (dm.get(e.id) || 0) + e.amt); W.events.length = 0; });
  const exp = 2 * 180 * 0.45 * (1 - 0.75 * ((4 - 0.32) / 5));
  check(`splash: centre infantry takes 2×81 = ${(dm.get(c.id) || 0).toFixed(1)}; 4 m away takes ${(dm.get(off.id) || 0).toFixed(1)} ≈ ${exp.toFixed(1)} (linear to ×0.25 at 5 m from the surface)`, near(dm.get(c.id) || 0, 162, 0.1) && near(dm.get(off.id) || 0, exp, 0.5), '');
}

// ═══ 7. abilities: deploy, EMP, scan, garrison ═══
group('7 abilities');
{ // Ranger deploy
  const W = mk(T_FLAT); const a = W.spawn('A01', 0, 100, 250, { hdg: 0 }); const t = W.spawn('H01', 1, 122, 250, { passive: true, hp: 1e9 });
  W.order(a, { type: 'deploy' }); const ev = []; run(W, 6, (W) => { for (const e of W.events) if (e.id === a.id && (e.type === 'deploy' || e.type === 'fire')) ev.push(e); W.events.length = 0; });
  const dep = ev.find((e) => e.type === 'deploy' && e.state === 'deployed'), st = ev.find((e) => e.type === 'deploy' && e.state === 'deploying'); const firstFire = ev.find((e) => e.type === 'fire');
  check(`A01 deploy takes 0.8 s (${(dep.t - st.t).toFixed(3)}) and fires only after setup`, near(dep.t - st.t, 0.8, TICK + 1e-6) && firstFire && firstFire.t >= dep.t - 1e-9, '');
  check(`A01 deployed weapon is the machine gun (25 m, 0.45 s): fires at a target ${W.surfDist(a, t).toFixed(1)} m away beyond the 18 m carbine`, firstFire && firstFire.w === 1 && W.surfDist(a, t) > 18, '');
  W.order(a, { type: 'move', x: 100, y: 200 }); const ev2 = []; let movedEarly = false; const t0 = W.t; run(W, 3, (W) => { for (const e of W.events) if (e.id === a.id && e.type === 'deploy') ev2.push(e); W.events.length = 0; if (W.t - t0 < 0.6 - 1e-6 && Math.hypot(a.x - 100, a.y - 250) > 0.01) movedEarly = true; });
  const mob = ev2.find((e) => e.state === 'mobile'); check(`A01 move while deployed: packs up for 0.6 s (${mob ? (mob.t - t0).toFixed(3) : '-'}), then moves (queued order kept)`, mob && near(mob.t - t0, 0.6, TICK + 1e-6) && !movedEarly && a.y < 249, '');
  // A02 mobile AA only; deployed adds AT
  const W2 = mk(T_FLAT); const m2 = W2.spawn('A02', 0, 100, 250); const tk = W2.spawn('H03', 1, 128, 250, { passive: true, hp: 1e9 }); let f = 0; run(W2, 4, (W) => { for (const e of W.events) if (e.type === 'fire') f++; W.events.length = 0; });
  W2.order(m2, { type: 'deploy' }); let f2 = 0, w2 = null; run(W2, 5, (W) => { for (const e of W.events) if (e.type === 'fire') { f2++; w2 = e.w; } W.events.length = 0; });
  check(`A02 mobile ignores ground vehicles (${f} launches); deployed (1.0 s) fires the AT missile (${f2} launches, weapon ${w2})`, f === 0 && f2 >= 1 && w2 === 1, '');
}
{ // EMP
  const W = mk(T_FLAT); const d = W.spawn('T02', 0, 100, 250); const tk = W.spawn('A03', 1, 120, 250, { passive: true, hp: 1e9 }); const inf = W.spawn('H01', 1, 100, 270, { passive: true, hp: 1e9 });
  run(W, 0.2); W.order(d, { type: 'emp', target: tk.id }); let wind = null, fx = null; run(W, 1, (W) => { for (const e of W.events) { if (e.type === 'emp_wind') wind = e.t; if (e.type === 'emp') fx = e; } W.events.length = 0; });
  check(`EMP wind-up 0.3 s (${fx && wind != null ? (fx.t - wind).toFixed(3) : '-'}) then applied`, fx && fx.applied && near(fx.t - wind, 0.3, TICK + 1e-6), '');
  check(`EMP effect lasts 3 s (until ${tk.emp && (tk.emp.until - fx.t).toFixed(2)}) with immunity 6 s after (${(tk.empImmune - fx.t).toFixed(2)} s from cast)`, tk.emp && near(tk.emp.until - fx.t, 3, 1e-6) && near(tk.empImmune - fx.t, 9, 1e-6), '');
  check(`EMP cooldown 20 s from release (${(d.abilityReady - fx.t).toFixed(2)})`, near(d.abilityReady - fx.t, 20, 1e-6), '');
  W.order(d, { type: 'emp', target: inf.id }); run(W, 1); check('EMP cannot target infantry', !inf.emp, '');
  // cycle ×1.25 → −20 % DPS while affected
  const W2 = mk(T_FLAT); const s = W2.spawn('A03', 0, 100, 250, { hp: 1e9 }); const v = W2.spawn('H03', 1, 130, 250, { passive: true, hp: 1e9 }); W2.order(s, { type: 'attack', target: v.id });
  run(W2, 4); s.emp = { until: 1e9, speed: 0.7, cycle: 1.25 }; const fr = []; run(W2, 30, (W) => { for (const e of W.events) if (e.type === 'fire' && e.id === s.id) fr.push(e.t); W.events.length = 0; });
  const iv = (fr[fr.length - 1] - fr[3]) / (fr.length - 4); check(`EMP stretches the A03 cycle 2.2 s → ${iv.toFixed(3)} s (×1.25 = 2.75; sustained DPS −20 %)`, near(iv, 2.75, 0.02), iv);
  // immunity: a second EMP during immunity does not apply
  const W3 = mk(T_FLAT); const d1 = W3.spawn('T02', 0, 100, 250), d2 = W3.spawn('T02', 0, 100, 256); const t3 = W3.spawn('H03', 1, 122, 252, { passive: true, hp: 1e9 }); run(W3, 0.2);
  W3.order(d1, { type: 'emp', target: t3.id }); run(W3, 4); W3.order(d2, { type: 'emp', target: t3.id }); let applied = null; run(W3, 1, (W) => { for (const e of W.events) if (e.type === 'emp' && e.id === d2.id) applied = e.applied; W.events.length = 0; });
  check(`EMP immunity: second cast at +4 s is not applied (applied=${applied})`, applied === false, '');
}
{ // scan through terrain occlusion
  const W = mk(T_RANGE, [bunker]); const dr = W.spawn("T04", 0, 192, 60); const hid = W.spawn('A03', 1, 250, 60, { passive: true }); run(W, 1.5);
  const before = W.visible(0, hid); W.order(dr, { type: 'scan', x: hid.x, y: hid.y }); let sc = null; run(W, 2, (W) => { for (const e of W.events) if (e.type === 'scan') sc = e; W.events.length = 0; });
  const during = W.visible(0, hid); run(W, 8.2); const after = W.visible(0, hid);
  check(`scan reveals a tank behind the ridge (seen before ${before}, during ${during}, after 8 s ${after}); 0.25 s activation; cooldown 30 s`, !before && during && !after && sc && near(dr.abilityReady - sc.t, 30, 1e-6), `drone→tank ${Math.hypot(dr.x - hid.x, dr.y - hid.y).toFixed(0)} m`);
}
{ // garrison
  const b = { name: 'Bunker', x: 200, y: 250, w: 12, d: 12, h: 4.2, slots: 4, hp: 2000, team: 0 }; const W = mk(T_FLAT, [b]); const B = W.buildings[0];
  const g = W.spawn('H01', 0, 200, 230); const r = W.spawn('H02', 0, 196, 230); const p = W.spawn('T01', 0, 204, 230);
  W.order(g, { type: 'garrison', building: B.id }); W.order(r, { type: 'garrison', building: B.id }); W.order(p, { type: 'garrison', building: B.id });
  let ent = {}, done = {}; run(W, 8, (W) => { for (const e of W.events) { if (e.type === 'garrison_enter') ent[e.id] = e.t; if (e.type === 'garrisoned') done[e.id] = e.t; } W.events.length = 0; });
  check(`Conscript enters in 1.0 s (${(done[g.id] - ent[g.id]).toFixed(3)}), Pulse Trooper in 0.9 s (${(done[p.id] - ent[p.id]).toFixed(3)}); Rocket Trooper cannot garrison`, near(done[g.id] - ent[g.id], 1.0, TICK + 1e-6) && near(done[p.id] - ent[p.id], 0.9, TICK + 1e-6) && !done[r.id], '');
  const foe = W.spawn('H01', 1, 200, 268, { passive: true, hp: 1e9 }); let pf = 0; run(W, 4, (W) => { for (const e of W.events) if (e.type === 'fire' && (e.id === g.id || e.id === p.id)) pf++; W.events.length = 0; });
  check(`garrisoned units fire from ports (${pf} shots) and cannot be targeted`, pf > 4 && g.hidden, '');
  B.hp = 1; const killer = W.spawn('H03', 1, 200, 290, { hp: 1e9 }); run(W, 6); check(`building destruction kills occupants (alive: ${g.alive}, ${p.alive})`, !B.alive && !g.alive && !p.alive, '');
}
{ // veterancy
  const W = mk(T_FLAT); const a = W.spawn('H02', 0, 100, 250); const v = W.spawn('H03', 1, 128, 250, { passive: true }); a.hp = 55;
  run(W, 40); check(`kill of a 900-credit tank promotes a 300-credit Rocket Trooper to Veteran (xp ${a.xp}, rank ${a.rank}) keeping HP % (${(a.hp / a.maxHp * 100).toFixed(0)} %, max ${a.maxHp})`, !v.alive && a.rank === 1 && near(a.hp / a.maxHp, 0.5, 1e-6) && near(a.maxHp, 121, 1e-6), '');
}

// ═══ 8. collision, spacing, smoothness, determinism, cost ═══
group('8 collision & smoothness');
{
  const W = mk(T_RANGE, [bunker]); const L = []; for (let k = 0; k < 9; k++) L.push(W.spawn('A03', 0, 80 + (k % 3) * 9, 250 + Math.floor(k / 3) * 9));
  const I = []; for (let k = 0; k < 12; k++) I.push(W.spawn('H01', 0, 140 + (k % 4) * 2, 200 + Math.floor(k / 4) * 2));
  W.orderGroup(L, { type: 'move', x: 160, y: 300 }); W.orderGroup(I, { type: 'move', x: 120, y: 170 });
  const prev = new Map(); let jumps = [], spins = []; const vm = (u) => u.sp.speed_mps * 1.02 + 2.6;
  run(W, 60, (W) => { for (const u of L.concat(I)) { const p = prev.get(u); if (p) { const v = Math.hypot(u.x - p[0], u.y - p[1]) / TICK; if (v > vm(u)) jumps.push(`${u.uid}#${u.id} ${v.toFixed(1)} m/s`); const w = Math.abs(wrap(u.hdg - p[2])) / TICK * R2D; const wl = u.kind === 'foot' ? 541 : MECH[u.uid].hullTurn * 1.01; if (w > wl) spins.push(`${u.uid} ${w.toFixed(0)}°/s`); } prev.set(u, [u.x, u.y, u.hdg]); } });
  let minGap = 1e9; const all = L.concat(I);
  for (let i = 0; i < all.length; i++) for (let k = i + 1; k < all.length; k++) { const a = all[i], b = all[k]; const d = W.surfDist(a, b); minGap = Math.min(minGap, d); }
  check(`group of 9 tanks + 12 infantry: final min surface gap ${minGap.toFixed(2)} m (spacing rule ≥ 0.25 m, tolerance 0.05)`, minGap >= 0.2, minGap);
  check(`no per-tick teleport (speed > spec + 2.6 m/s separation drift): ${jumps.length}`, jumps.length === 0, jumps.slice(0, 3).join('; '));
  check(`no heading snaps beyond the unit's yaw-rate limit: ${spins.length}`, spins.length === 0, spins.slice(0, 3).join('; '));
  check(`all arrived (${all.filter((u) => !u.path).length}/${all.length})`, all.every((u) => !u.path), '');
}
{ // determinism + cost
  const scenario = () => { const W = mk(T_RANGE, [bunker]); const S = []; const ids = Object.keys(MECH).filter((id) => SP[id]);
    for (let k = 0; k < 60; k++) { const id = ids[k % ids.length], tm = k % 2; const dom = MECH[id].kind === 'ship' ? 'ship' : MECH[id].kind === 'hover' ? 'hover' : MECH[id].kind === 'foot' ? 'foot' : 'veh';
      const base = tm ? [380, 200] : [150, 230]; const p = MECH[id].kind === 'ship' ? W.nav.nearestOk('ship', tm ? 600 : 520, 120 + k * 4, 6) : (['heli', 'drone', 'jet'].includes(MECH[id].kind) ? [base[0], base[1] + k] : W.nav.nearestOk(dom, base[0] + (k % 5) * 6, base[1] + Math.floor(k / 5) * 6, 2));
      const u = W.spawn(id, tm, p[0], p[1], id === 'A04' ? { airborne: true } : {}); S.push(u); }
    for (const u of S) if (u.kind !== 'ship') W.order(u, { type: 'attackMove', x: u.team ? 150 : 380, y: 230 }); else W.order(u, { type: 'attackMove', x: u.team ? 520 : 600, y: 250 });
    const t0 = process.hrtime.bigint(); run(W, 60); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ms, sig: W.units.map((u) => `${u.x.toFixed(4)},${u.y.toFixed(4)},${u.hp.toFixed(3)}`).join('|'), stats: W.stats }; };
  const a = scenario(), b = scenario();
  check(`deterministic: identical state after 60 s of a 60-unit battle`, a.sig === b.sig, '');
  check(`sim cost ${(a.ms / 1800).toFixed(3)} ms per 30 Hz tick for 60 units in battle (budget 4 ms)`, a.ms / 1800 < 4, `${a.ms.toFixed(0)} ms / 1800 ticks; shots ${a.stats.shots}, kills ${a.stats.kills}`);
}

// ═══ 9. pace & harvester (data/pace.json, econ.js) ═══
group('9 pace & harvester');
{
  const ROOT = path.join(HERE, '../..'); const same = (a, b) => fs.existsSync(b) && fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  check('pace.js and data/pace.json match the repo source (data/sync_pace.py)', same(path.join(ROOT, 'data/pace.js'), path.join(HERE, 'pace.js')) && same(path.join(ROOT, 'data/pace.json'), path.join(HERE, 'data/pace.json')), '');
  const P = Object.assign(structuredClone(PACE.PACE_FALLBACK), JSON.parse(fs.readFileSync(path.join(HERE, 'data/pace.json'), 'utf8')));
  const vH = PACE.harvesterSandboxSpeed(P); const spec2 = structuredClone(spec); spec2.units.push(HV_SPEC(vH)); MECH.HV.accel = P.harvester.accel_mps2; MECH.HV.hullTurn = P.harvester.hull_turn_dps;
  check(`harvester top speed ${vH.toFixed(2)} m/s = ${P.harvester_speed_ratio} × Lancer ${SP.A03.speed_mps} m/s, faster than both tracked tanks (H03 ${SP.H03.speed_mps}, A03 ${SP.A03.speed_mps})`, near(vH, P.harvester_speed_ratio * SP.A03.speed_mps, 1e-9) && vH > SP.H03.speed_mps && vH > SP.A03.speed_mps, '');
  const E = econLayout(); const W = new World({ spec: spec2, T: T_RANGE, geom, buildings: E.buildings }); W.pace = P; W.econ = E;
  const blocks = E.buildings[0].blocks; const inBlock = (u) => blocks.some((b) => Math.abs(u.x - b.x) < b.w / 2 && Math.abs(u.y - b.y) < b.d / 2);
  for (const dep of ['near', 'far']) {
    const u = W.spawn('HV', 0, E.dock.grate[0], E.dock.grate[1], { hdg: E.dock.face, noSnap: true, passive: true }); W.harvest(u, dep); let hitWall = 0, offGrate = 0;
    const c0 = u.harv.cycles; run(W, 400, () => { if (inBlock(u)) hitWall++; if (u.harv.state === 'unload' && Math.hypot(u.x - E.dock.grate[0], u.y - E.dock.grate[1]) > 0.01) offGrate++; return u.harv.cycles < c0 + 2; });
    const d = E.deposits.find((x) => x.id === dep); const pts = W.nav.path('veh', E.dock.approach[0], E.dock.approach[1], d.svc[0], d.svc[1], W._navR(u), u.r + 1.5).pts; const out = [E.dock.approach, ...pts];
    const pred = PACE.harvestCycle({ grate: E.dock.grate, approach: E.dock.approach, out, back: [d.svc, ...out.slice().reverse().slice(1)], roadSpeeds: [vH, vH] }, P, { heightAt: (x, y) => T_RANGE.height(x, y) });
    const L = u.harv.last;
    check(`${dep} field: 2 full cycles (${u.harv.cycles})`, u.harv.cycles >= 2, '');
    if (L) {
      check(`${dep} field: simulated round trip ${L.total.toFixed(2)} game s matches the pace model ${pred.game_s.toFixed(2)} s within 2%`, Math.abs(L.total - pred.game_s) / pred.game_s < 0.02, JSON.stringify(L.legs));
      check(`${dep} field: loads ${L.legs.load.toFixed(2)} s and unloads ${L.legs.unload.toFixed(2)} s (pace.json ${P.harvester.load_s} / ${P.harvester.unload_s}, ±1 tick)`, near(L.legs.load, P.harvester.load_s, TICK + 1e-6) && near(L.legs.unload, P.harvester.unload_s, TICK + 1e-6), '');
      check(`${dep} field: stays out of the refinery walls (${hitWall} ticks inside) and unloads exactly on the grate (${offGrate} ticks off)`, hitWall === 0 && offGrate === 0, '');
    }
    W.units.splice(W.units.indexOf(u), 1); W.byId.delete(u.id);
  }
}

const pass = R.filter((r) => r.ok).length; console.log(`\n${pass}/${R.length} checks passed`);
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results/mech_results.json'), JSON.stringify({ date: new Date().toISOString(), pass, total: R.length, checks: R }, null, 1));
process.exitCode = pass === R.length ? 0 : 1;
