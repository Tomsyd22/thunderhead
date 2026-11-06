// Thunderhead pace model, shared by the Map Lab and the Unit Sandbox.
// Source of truth: data/pace.js + data/pace.json. data/sync_pace.py copies both into maps/lab/ and units/sandbox/,
// so edit the source and re-sync (the tools' tests check that the copies match).
//
// Game speed is a uniform time scale (RA2's game-speed setting): the simulation runs game_speed times faster against
// the wall clock. Every number in pace.json is in GAME seconds; real seconds = game seconds / game_speed.
// drive() follows a path with the same rules as the sandbox's tracked-vehicle model (units/sandbox/mech.js _trackMove):
// pure-pursuit look-ahead, pivot in place when more than 45° off course, corner speed limits, braking to a stop,
// and slowing on climbs. It steps at the sandbox's 30 Hz tick, so the Lab's estimates and the sandbox agree.

export const D2R = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, s) => (v < t ? Math.min(t, v + s) : Math.max(t, v - s));

export const PACE_FALLBACK = {
  version: 1, game_speed: 2.4, game_speed_range: [1, 4], harvester_speed_ratio: 1.25, harvester_ratio_range: [1, 1.6],
  reference_tank: { maps: { class: 'tank', road_mps: 12, offroad_mps: 7 }, sandbox: { unit: 'A03', mps: 10 } },
  harvester: { capacity_bails: 20, load_s: 10, unload_s: 1.5, accel_mps2: 3, brake_mps2: 4.8, hull_turn_dps: 45, reverse_mps: 4, dock_reverse_m: 25.2 },
  tank: { accel_mps2: 4.5, brake_mps2: 7.2, hull_turn_dps: 75 },
  drive: { corner_radius_m: 6, pivot_over_deg: 45, tick_hz: 30 },
  targets: { base_to_enemy_base_s: [45, 60], harvest_round_trip_nearest_home_s: [20, 30] },
};

export async function loadPace(url = 'data/pace.json') {
  try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return Object.assign(structuredClone(PACE_FALLBACK), await r.json()); }
  catch (e) { const P = structuredClone(PACE_FALLBACK); P._loadError = String(e.message || e); return P; }
}

export const realS = (gameS, P) => (gameS == null ? null : gameS / P.game_speed);
/** Harvester [road, off-road] top speed in m/s (game time) for the Map Lab's surfaces. */
export const harvesterMapsSpeeds = (P) => [P.reference_tank.maps.road_mps * P.harvester_speed_ratio, P.reference_tank.maps.offroad_mps * P.harvester_speed_ratio];
/** Harvester top speed in m/s (game time) on the sandbox range (no road bonus there). */
export const harvesterSandboxSpeed = (P) => P.reference_tank.sandbox.mps * P.harvester_speed_ratio;

/**
 * Drive a polyline from path[0] to its last point and stop there.
 * k: { road, off (m/s), accel, brake (m/s²), turnDps }. o: { hdg (start heading, rad), roadAt(x, y), heightAt(x, y), cornerR, pivotDeg, dt, maxT, trace }
 * Returns { t (game s), hdg, dist, pivots, trace? }.
 */
export function drive(path, k, o = {}) {
  const n = path.length; if (n < 2) return { t: 0, hdg: o.hdg ?? 0, dist: 0, pivots: 0 };
  const dt = o.dt || 1 / 30, wmax = k.turnDps * D2R, acc = k.accel, dec = k.brake, cornerR = o.cornerR ?? 6, piv = (o.pivotDeg ?? 45) * D2R, CELL = 2;
  let x = path[0][0], y = path[0][1], hdg = o.hdg ?? Math.atan2(path[1][1] - y, path[1][0] - x), v = 0, w = 0, pi = 1, t = 0, dist = 0, pivots = 0, pivoting = false;
  const segLen = []; for (let i = 0; i < n - 1; i++) segLen.push(Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]));
  const tail = new Float64Array(n); for (let i = n - 2; i >= 0; i--) tail[i] = tail[i + 1] + segLen[i];   // path length from vertex i to the end
  const trace = o.trace ? [[0, x, y, hdg, 0]] : null; const maxT = o.maxT || 900;
  while (t < maxT) {
    const look = Math.max(3, v * 0.8);
    while (pi < n - 1 && Math.hypot(path[pi][0] - x, path[pi][1] - y) < Math.max(look * 0.6, CELL)) pi++;
    const p = path[pi]; const rem = Math.hypot(p[0] - x, p[1] - y) + tail[pi];
    if (pi >= n - 1 && rem < 0.8 && Math.abs(v) < 1.0) break;
    let vCap = o.roadAt && o.roadAt(x, y) ? k.road : k.off;
    if (o.heightAt) { const fx = Math.cos(hdg), fy = Math.sin(hdg); const grade = (o.heightAt(x + fx * 2, y + fy * 2) - o.heightAt(x - fx * 2, y - fy * 2)) / 4; vCap *= clamp(1 - Math.max(0, grade), 0.55, 1); }
    const e = wrap(Math.atan2(p[1] - y, p[0] - x) - hdg); let vDes, wDes;
    if (Math.abs(e) > piv) { vDes = 0; wDes = Math.sign(e) * wmax; if (Math.abs(v) > 1.0) wDes *= 0.5; if (!pivoting) { pivots++; pivoting = true; } }
    else {
      pivoting = false; wDes = clamp(e * 2.5, -wmax, wmax);
      let vc = Infinity;   // corner speed at the next vertex (sandbox _cornerSpeed, with a fixed corner radius instead of the clearance field)
      if (pi < n - 1) { const q = path[pi + 1]; const th = Math.abs(wrap(Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.atan2(p[1] - y, p[0] - x))); if (th >= 12 * D2R) { const R = cornerR * (th < 40 * D2R ? 1.6 : 1), vv = wmax * R, d = Math.hypot(p[0] - x, p[1] - y); vc = Math.sqrt(vv * vv + 2 * dec * 0.8 * d); } }
      vDes = Math.min(vCap * (1 - 0.35 * Math.abs(wDes) / wmax), Math.sqrt(2 * dec * rem), vc) * Math.cos(e);
    }
    v = approach(v, vDes, (Math.abs(vDes) > Math.abs(v) ? acc : dec) * dt);
    w = approach(w, wDes, wmax * 3.5 * dt); hdg = wrap(hdg + w * dt);
    x += v * Math.cos(hdg) * dt; y += v * Math.sin(hdg) * dt; dist += Math.abs(v) * dt; t += dt;
    if (trace && Math.round(t / dt) % 3 === 0) trace.push([t, x, y, hdg, v]);
  }
  return { t, hdg, dist, pivots, x, y, trace, timedOut: t >= maxT };
}

/** Time to pivot in place through `angle` rad (turn-rate ramp as in the sandbox: angular accel = 3.5 × max rate). */
export function pivotTime(angle, turnDps, dt = 1 / 30) {
  const wmax = turnDps * D2R; let a = Math.abs(angle), w = 0, t = 0;
  while (a > 0.02 && t < 60) { const wDes = Math.min(wmax, Math.max(0.15, a * 2.5)); w = approach(w, wDes, wmax * 3.5 * dt); a -= w * dt; t += dt; }
  return t;
}

/** Straight-line move of `dist` m from rest to rest (accelerate, cruise, brake), stepped at the sandbox tick. */
export function straightTime(dist, vmax, acc, brk, dt = 1 / 30) {
  let s = 0, v = 0, t = 0;
  while (t < 300) { const rem = dist - s; if (rem < 0.05 && v < 0.3) break; const vDes = Math.min(vmax, Math.sqrt(2 * brk * Math.max(0, rem))); v = approach(v, vDes, (vDes > v ? acc : brk) * dt); s += v * dt; t += dt; }
  return t;
}

/**
 * One harvester round trip, in game seconds: leave the unloading grate facing the field → drive to the rig's service point →
 * load → drive back to the bay's approach point → pivot to face the field → reverse onto the grate → unload.
 * a: { grate:[x,y], approach:[x,y], out: path approach→service point, back: path service point→approach, roadSpeeds:[road, off] }
 */
export function harvestCycle(a, P, o = {}) {
  const H = P.harvester, k = { road: a.roadSpeeds[0], off: a.roadSpeeds[1], accel: H.accel_mps2, brake: H.brake_mps2, turnDps: H.hull_turn_dps };
  const dopt = { roadAt: o.roadAt, heightAt: o.heightAt, cornerR: P.drive.corner_radius_m, pivotDeg: P.drive.pivot_over_deg, dt: 1 / P.drive.tick_hz };
  const face = Math.atan2(a.approach[1] - a.grate[1], a.approach[0] - a.grate[0]);   // grate → approach point: facing the field
  const outPath = [a.grate, ...a.out]; const lo = drive(outPath, k, { ...dopt, hdg: face });
  const back = drive(a.back, k, { ...dopt, hdg: lo.hdg });
  const pivot = pivotTime(wrap(face - back.hdg), H.hull_turn_dps);
  const rev = straightTime(Math.hypot(a.approach[0] - a.grate[0], a.approach[1] - a.grate[1]), H.reverse_mps, H.accel_mps2, H.brake_mps2);
  const legs = { out: lo.t, load: H.load_s, back: back.t, dock: pivot + rev, unload: H.unload_s };
  const game = legs.out + legs.load + legs.back + legs.dock + legs.unload;
  return { legs, game_s: game, real_s: game / P.game_speed, out_m: lo.dist, back_m: back.dist, pivots: lo.pivots + back.pivots, timedOut: lo.timedOut || back.timedOut };
}
