// Unit mechanics for the 15-unit design pack (mechanics baseline v0.1).
// Pure simulation: no DOM, no three.js. A fixed 30 Hz tick, and the renderer interpolates. Rate of fire does not depend on FPS.
// Numbers come from data/unit_specs.json (`weapons`, `speed_mps`, `collision_radius_m`, ...) and from the sheets'
// movement/animation text, which is transcribed into MECH below with the source wording. test_mech.mjs re-parses
// that text to check the transcription.
import { Nav, CELL } from './nav.js';

export const TICK = 1 / 30;
const D2R = Math.PI / 180, R2D = 180 / Math.PI, G = 9.81, EPS = 1e-6; // EPS absorbs float drift in summed 1/30 s ticks
export const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

// ───────────── per-unit mechanics transcribed from the sheets (movement / animations / ability text) ─────────────
// Values marked "assumed" are not in the pack. They're conservative choices, listed in VALIDATION.md.
export const MECH = {
  H01: { kind: 'foot', aim: 0.12, run: 0.8, idle: 2.4, fire: 0.8, death: 0.8, fade: 6, garrison: 1.0, exit: 0.8, tracer: 3, garrisonable: true },
  H02: { kind: 'foot', aim: 0.35, lockLOS: true, run: 1.0, idle: 2.6, death: 0.9, fade: 6, preferAir: true },
  A01: { kind: 'foot', aim: 0.12, run: 0.8, idle: 2.4, death: 0.8, fade: 6, garrison: 1.0, exit: 0.8, tracer: 3, garrisonable: true,
         deploy: { setup: 0.8, pack: 0.6, mobile: [0], deployed: [1], hitZ: 0.72 } },
  A02: { kind: 'foot', aim: 0.30, lockLOS: true, run: 0.9, death: 0.9, fade: 6, airOnlyMobile: true,
         deploy: { setup: 1.0, pack: 0.7, mobile: [0], deployed: [0, 1], hitZ: 0.72 } },
  // engineers (game client, round 1): unarmed; walk into a friendly structure and are used up repairing it fully (RA2)
  HE: { kind: 'foot', aim: 0.12, run: 0.8, idle: 2.4, death: 0.8, fade: 6, garrison: 1.0, engineer: true },
  AE: { kind: 'foot', aim: 0.12, run: 0.8, idle: 2.4, death: 0.8, fade: 6, garrison: 1.0, engineer: true },
  TE: { kind: 'foot', aim: 0.10, run: 0.7, idle: 2.2, death: 0.75, fade: 6, garrison: 0.9, engineer: true },
  T01: { kind: 'foot', aim: 0.10, run: 0.7, idle: 2.2, fire: 0.8, death: 0.75, fade: 6, garrison: 0.9, exit: 0.8, garrisonable: true },
  T02: { kind: 'foot', aim: 0.20, precharge: 0.2, run: 0.8, idle: 2.5, death: 0.8, fade: 6,
         emp: { range: 30, wind: 0.3, dur: 3, cd: 20, immune: 6, speed: 0.70, cycle: 1.25 } },
  H03: { kind: 'tracked', accel: 3, hullTurn: 55, turretYaw: 85, pitch: [-7, 20], tol: 5, recoil: [0.22, 0.08, 0.32], wheels: 7,
         death: 1.4, wreckNoCollide: 2, fade: 12, maxHullPitch: 3 },
  A03: { kind: 'tracked', accel: 4.5, hullTurn: 75, turretYaw: 110, pitch: [-8, 22], tol: 4, recoil: [0.16, 0.06, 0.25], wheels: 6,
         death: 1.2, wreckNoCollide: 2, fade: 12, maxHullPitch: 3, antenna: true },
  T03: { kind: 'hover', accel: 5, hullTurn: 110, turretYaw: 140, pitch: [-6, 15] /* assumed */, tol: 4 /* assumed */, clearance: 0.45,
         precharge: 0.25, recovery: 0.35, chargeSpeed: 0.65, bank: 5, bob: [0.06, 1.8], death: 1.1, fade: 10, finSpread: 0.08 },
  H04: { kind: 'heli', accel: 7, hullTurn: 95, alt: 12, fireSpeed: 0.5, hold: 36, podYaw: 10, pitchMax: 12, bankMax: 15, bob: [0.15, 2.4], death: 1.8 },
  A04: { kind: 'jet', alt: 20, rmin: 12, align: 10, fall: 0.8, land: 1.2, reload: 6, takeoff: 1.0, death: 1.5, bankMax: 55 },
  T04: { kind: 'drone', accel: 12, hullTurn: 180, alt: 8, fireSpeed: 0.6, pitchMax: 12, bankMax: 12, bob: [0.04, 1.6], death: 0.6, hold: 21,
         scan: { range: 60, radius: 18, dur: 8, act: 0.25, cd: 30 } },
  H05: { kind: 'ship', accel: 2, hullTurn: 28, turretYaw: 70, pitch: [-5, 25] /* assumed */, tol: 5 /* assumed */, yawLimit: 135 /* model hard stop: beyond ~145° the muzzle meets the deckhouse */, waterline: 1.4,
         roll: 1.5, pitchAmp: 0.8, recoil: [0.18, 0.09, 0.35], death: 3.0, outsideBank: true },
  A05: { kind: 'ship', accel: 1.5, hullTurn: 18, waterline: 2.2, roll: 1.0, pitchAmp: 0.5, lidLead: 0.2, lidClose: 0.3, radarPeriod: 12, death: 4.0,
         aaYaw: 180 /* assumed */, aaPitch: [0, 85] /* assumed */, aaTol: 15 /* assumed */, independent: true },
  T05: { kind: 'ship', accel: 3.5, hullTurn: 45, waterline: 1.0, roll: 0.7, pitchAmp: 0.4, lidLead: 0.15, lidClose: 0.25, death: 2.2, alternate: true },
  // harvester (not in the pack): six-wheel skid steer on the tracked model; accel / turn / docking from data/pace.json (set by setPace)
  HV: { kind: 'tracked', harvester: true, accel: 3, hullTurn: 45, wheels: 3, wheelAxis: 'z', wheelR: 1.0, modelFwd: 'x', death: 1.4, wreckNoCollide: 2, fade: 12, maxHullPitch: 2 },
};
// Each kind maps to a navigation domain. Air units ignore the ground masks.
const DOMAIN = { foot: 'foot', tracked: 'veh', hover: 'hover', ship: 'ship', heli: 'air', jet: 'air', drone: 'air' };
const FOOT = { accel: 14, decel: 18, turn: 540 }; // assumed: infantry reach run speed in ~0.3 s and turn in place fast but not instantly

export function classOf(u) { return u.sp.armor; } // infantry | light | heavy | air | naval | building
export const isAir = (u) => u.sp.armor === 'air';

// default socket geometry (unit-local: x right, y forward, z up). sockets.json from the GLBs overrides it.
function defaultGeom(sp, m) {
  const L = sp.dimensions_m.length, W = sp.dimensions_m.width, H = sp.dimensions_m.height;
  if (m.kind === 'foot') return { muzzle: [[0.14, 0.78, 1.42]], eye: 1.65, hitZ: 1.15 };
  if (m.kind === 'tracked' || m.kind === 'hover') return { turret: [0, -0.06 * L, 0.68 * H], gun: [0, 0.18 * L, 0.12 * H], muzzle: [[0, 0.5 * L, 0.0]], eye: H, hitZ: 0.5 * H };
  if (m.kind === 'heli') return { muzzle: [[-1.8, 1.5, 0.6], [1.8, 1.5, 0.6]], eye: 2, hitZ: 1.6 };
  if (m.kind === 'jet') return { muzzle: [[-2.2, 0.5, 0.0], [2.2, 0.5, 0.0]], eye: 2, hitZ: 1.2 };
  if (m.kind === 'drone') return { muzzle: [[0, 1.0, -0.25]], eye: 0.5, hitZ: 0.4 };
  // ships
  return { turret: [0, 0.25 * L, 2.2], gun: [0, 0.6, 0.6], muzzle: [[0, 2.2, 0], [0, 2.2, 0], [0, 2.2, 0], [0, 2.2, 0]], aa: [0, -0.35 * L, 4], eye: H * 0.6, hitZ: 1.5 };
}


export class World {
  /** spec: parsed unit_specs.json; T: terrain from makeTerrain(); geom: optional sockets.json; opts.buildings: static structures */
  constructor({ spec, T, geom = {}, buildings = [], nav = null }) {
    this.spec = {}; for (const u of spec.units) this.spec[u.id] = u;
    this.T = T; this.geomIn = geom; this.t = 0; this.tick = 0; this.nextId = 1;   // ids are per world, so runs are reproducible
    this.units = []; this.byId = new Map(); this.proj = []; this.events = []; this.scans = []; this.buildings = [];
    for (const b of buildings) this.addBuilding(b);
    if (nav) { this.nav = nav; for (const b of this.buildings) this._stampBuilding(b, true); }   // game map: baked layers, buildings stamped at runtime
    else this.nav = new Nav(T, this.buildings.flatMap((b) => b.blocks || [{ x: b.x, y: b.y, w: b.w, d: b.d }]));
    this.pace = null; this.econ = null;   // set by the app / tests: data/pace.json settings and the econ layout (econ.js)
    this.vis = new Map(); // team → Set of visible enemy ids
    this.stats = { shots: 0, hits: 0, misses: 0, kills: 0 };
  }
  emit(type, o) { this.events.push(Object.assign({ type, t: this.t }, o)); }

  addBuilding(b) {
    const bb = Object.assign({ id: this.nextId++, isBuilding: true, team: -1, hp: 2000, maxHp: 2000, slots: 0, occupants: [], alive: true }, b);
    bb.sp = { armor: 'building', name: b.name || 'Building', cost: b.cost || 1000, collision_radius_m: Math.max(b.w, b.d) / 2 };
    bb.maxHp = bb.hp; bb.z = this.T ? this.T.surface(b.x, b.y) : 0; bb.ports = b.ports || [[-b.w / 2, b.d / 2], [b.w / 2, b.d / 2], [b.w / 2, -b.d / 2], [-b.w / 2, -b.d / 2]];
    this.buildings.push(bb); this.byId.set(bb.id, bb); return bb;
  }

  /** Runtime structure (game): registers it and blocks its footprint on every navigation layer. */
  placeBuilding(b) { const bb = this.addBuilding(b); this._stampBuilding(bb, true); this.emit('building', { id: bb.id }); return bb; }
  _stampBuilding(b, on) {
    if (on === !!b.stamped || b.noFootprint) return; b.stamped = on;
    for (const r of b.blocks || [{ x: b.x, y: b.y, w: b.w, d: b.d }]) this.nav.footprint(r, on);
    if (on) for (const u of this.units) {   // units standing on a new footprint step off it
      if (!u.alive || u.dom === 'air' || u.hidden) continue; const inside = (b.blocks || [b]).some((r) => Math.abs(u.x - r.x) < r.w / 2 + u.r && Math.abs(u.y - r.y) < r.d / 2 + u.r);
      if (inside) { const p = this.nav.nearestOk(u.dom, u.x, u.y, u.r, 80); if (p) { u.x = p[0]; u.y = p[1]; u.path = null; } }
    }
  }
  /** Removes a structure without destroying it (sold / cancelled placement). */
  removeBuilding(b) { this._stampBuilding(b, false); b.alive = false; this.buildings = this.buildings.filter((x) => x !== b); this.byId.delete(b.id); }

  // ───────────── spawning ─────────────
  spawn(uid, team, x, y, opts = {}) {
    const sp = this.spec[uid], m = MECH[uid]; if (!sp || !m) throw new Error('unknown unit ' + uid);
    const geom = Object.assign(defaultGeom(sp, m), this.geomIn[uid] || {});
    if (DOMAIN[m.kind] !== 'air' && !opts.noSnap) { const r0 = m.kind === 'ship' ? sp.collision_radius_m + sp.dimensions_m.length * 0.45 : sp.collision_radius_m; const p = this.nav.okAt(DOMAIN[m.kind], x, y, r0) ? null : this.nav.nearestOk(DOMAIN[m.kind], x, y, r0, 300); if (p) { x = p[0]; y = p[1]; } }
    const u = {
      id: this.nextId++, uid, sp, m, geom, team, kind: m.kind, dom: DOMAIN[m.kind], r: sp.collision_radius_m,
      x, y, z: 0, hdg: opts.hdg ?? 0, v: 0, vx: 0, vy: 0, w: 0, side: 0, alive: true, hp: sp.health, maxHp: sp.health,
      path: null, pi: 0, goal: null, order: { type: 'idle' }, target: null, manual: false,
      turret: 0, pitch: 0, aaYaw: 0, aaPitch: 0, podYaw: 0, gimbal: 0, gimbalPitch: 0,
      trackL: 0, trackR: 0, stride: 0, dist: 0, pitchVis: 0, bankVis: 0, accelF: 0, accelS: 0,
      emp: null, empImmune: -1, abilityReady: 0, xp: 0, rank: 0, dmgLog: [],
      deploy: m.deploy ? 'mobile' : null, deployT: 0, garrisonIn: null, enterT: 0, hidden: false,
      sys: [], stuckT: 0, lastProg: 0, repathAt: 0, formation: null,
    };
    // weapon systems: one shared firing lock, except the Sentinel, whose anti-ship and AA systems are independent
    const W = sp.weapons.map((w, i) => Object.assign({ i }, w));
    const sysW = !W.length ? [] : m.independent ? W.map((w) => [w.i]) : [W.map((w) => w.i)];
    u.sys = sysW.map((ws) => ({ ws, cd: 0, wind: null, aimed: null, burst: 0, burstAt: 0, burstT: null, burstW: null, lastFire: -99, shotN: 0, target: null, lid: 0 }));
    // altitude / vertical placement
    if (u.kind === 'heli' || u.kind === 'drone') { u.z = this.T.surface(x, y) + m.alt; u.hover = true; }
    else if (u.kind === 'jet') { u.z = this.T.surface(x, y); u.jet = { phase: 'landed', pad: opts.pad ?? null, armed: true, t: 0, aim: null, gear: 1 }; u.v = 0; }
    else if (u.kind === 'ship') u.z = 0;
    else if (u.kind === 'hover') u.z = this.T.surface(x, y) + m.clearance;
    else u.z = this.T.height(x, y);
    if (u.kind === 'jet' && opts.airborne) { u.jet.phase = 'cruise'; u.jet.gear = 0; u.v = this.spec[uid].speed_mps; u.z = this.T.surface(x, y) + m.alt; }
    if (opts.passive) u.passive = true;
    if (opts.hp) { u.hp = u.maxHp = opts.hp; }
    this.units.push(u); this.byId.set(u.id, u);
    this.emit('spawn', { id: u.id, uid, team });
    return u;
  }

  // ───────────── orders ─────────────
  order(u, o) {
    if (!u.alive) return;
    if (u.garrisonIn && o.type !== 'ungarrison' && o.type !== 'stop') return;
    // a move/attack order while deployed requests pack-up first and keeps the order queued
    if (u.deploy && (u.deploy === 'deployed' || u.deploy === 'deploying') && (o.type === 'move' || o.type === 'attackMove' || o.type === 'garrison' || (o.type === 'attack' && !this._canHitFromDeploy(u, o)))) {
      u.queued = o; this._setDeploy(u, 'packing'); return;
    }
    if (u.deploy === 'packing') { u.queued = o; return; }
    if (u.harv && o.type !== 'harvest') { this._harvRelease(u); u.harv.state = 'idle'; u.loading = false; u.scripted = false; }
    switch (o.type) {
      case 'harvest': this.harvest(u, o.dep, o.dock); break;
      case 'move': case 'attackMove':
        u.order = { type: o.type, x: o.x, y: o.y }; u.target = null; u.manual = false; u.groupCap = null; if (!o.noPlan) this._plan(u, o.x, o.y); else u.goal = { x: o.x, y: o.y, stop: 0 }; break;
      case 'attack':
        if (o.target) { const tg = this.byId.get(o.target); if (!tg || !tg.alive || tg.team === u.team) return; u.order = { type: 'attack', target: tg.id }; u.target = tg.id; u.manual = true; }
        else if (o.x != null && u.kind === 'jet') { u.order = { type: 'attack', x: o.x, y: o.y }; u.target = null; u.manual = true; }
        else return;
        u.path = null; if (u.kind === 'jet') this._sortie(u); break;
      case 'stop': u.order = { type: 'idle' }; u.path = null; u.target = null; u.manual = false; u.queue = null; u.groupCap = null; for (const s of u.sys) { s.wind = null; } break;
      case 'guard': u.order = { type: 'guard', x: o.x ?? u.x, y: o.y ?? u.y }; u.target = null; u.manual = false; if (Math.hypot(u.order.x - u.x, u.order.y - u.y) > 4) this._plan(u, u.order.x, u.order.y); else u.path = null; break;
      case 'deploy': if (u.m.deploy && u.deploy === 'mobile') { u.path = null; u.order = { type: 'idle' }; this._setDeploy(u, 'deploying'); } break;
      case 'undeploy': if (u.m.deploy && u.deploy === 'deployed') this._setDeploy(u, 'packing'); break;
      case 'emp': if (u.m.emp) { u.order = { type: 'emp', target: o.target }; u.path = null; } break;
      case 'scan': if (u.m.scan) u.order = { type: 'scan', x: o.x, y: o.y, t0: null }; break;
      case 'garrison': {
        const b = this.byId.get(o.building); if (!b || !u.m.garrisonable || b.slots <= 0) return;
        u.order = { type: 'garrison', building: b.id }; u.target = null; this._plan(u, b.x, b.y, 0); break;
      }
      case 'enter': {   // engineer into a friendly structure
        const b = this.byId.get(o.building); if (!b || !b.isBuilding || !u.m.engineer || b.team !== u.team) return;
        u.order = { type: 'enter', building: b.id }; u.target = null; u.enterT = 0; this._plan(u, b.x, b.y, 0); break;
      }
      case 'ungarrison': if (u.garrisonIn) { u.order = { type: 'exiting' }; u.enterT = this.t; this.emit('garrison_exit', { id: u.id, b: u.garrisonIn }); } break;
      case 'return': if (u.kind === 'jet') { u.order = { type: 'idle' }; this._jetReturn(u); } break;
    }
  }
  /** Shift-queue: run `o` after the unit's current orders finish (or now, if it is idle). */
  queueOrder(u, o) { if (!u.alive) return; const busy = u.order.type !== 'idle' || u.path || (u.queue && u.queue.length); if (!busy) { this.order(u, o); return; } (u.queue || (u.queue = [])).push(o); }
  /** group move/attack-move with formation slots: spacing ≥ 2 × collision radius + 0.25 m (shared rules) */
  orderGroup(list, o) {
    list = list.filter((u) => u.alive); if (!list.length) return;
    if (o.type !== 'move' && o.type !== 'attackMove') { for (const u of list) this.order(u, o); return; }
    const cx = list.reduce((a, u) => a + u.x, 0) / list.length, cy = list.reduce((a, u) => a + u.y, 0) / list.length;
    const dir = Math.atan2(o.y - cy, o.x - cx); const groups = new Map();
    for (const u of list) { const k = u.dom; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
    // mixed land groups (game): one speed for all (the slowest member), vehicles form up in front and infantry behind
    const land = list.filter((u) => u.dom === 'foot' || u.dom === 'veh' || u.dom === 'hover'), mixed = this.sharedPaths && new Set(land.map((u) => u.dom)).size > 1;
    const slowLand = land.length ? Math.min(...land.map((u) => u.sp.speed_mps)) : 0; let back = 0;
    const order = [...groups.keys()].sort((a, b) => ['veh', 'hover', 'foot', 'ship', 'air'].indexOf(a) - ['veh', 'hover', 'foot', 'ship', 'air'].indexOf(b));
    for (const dom of order) { const us = groups.get(dom);
      const sp = Math.max(...us.map((u) => (u.kind === 'ship' ? u.sp.dimensions_m.width * 1.6 : 2 * u.r + 0.25) + (u.kind === 'tracked' || u.kind === 'hover' ? 2.5 : 0.6)));
      const cols = Math.ceil(Math.sqrt(us.length)); const rows = Math.ceil(us.length / cols);
      us.sort((a, b) => a.id - b.id);
      const slow = mixed && dom !== 'ship' && dom !== 'air' ? slowLand : Math.min(...us.map((u) => u.sp.speed_mps));
      const shift = mixed && dom !== 'ship' && dom !== 'air' ? back + (rows - 1) / 2 * sp : 0; if (mixed && dom !== 'ship' && dom !== 'air') back += rows * sp + 2;   // later bands stand behind earlier ones
      let lead = null;
      if (this.sharedPaths && us.length > 1 && (dom === 'foot' || dom === 'veh' || dom === 'hover')) {
        const gx = us.reduce((a, u) => a + u.x, 0) / us.length, gy = us.reduce((a, u) => a + u.y, 0) / us.length, rr = Math.max(...us.map((u) => this._navR(u)));
        const st = this.nav.nearestOk(dom, gx, gy, rr, 60); if (st) lead = this.nav.path(dom, st[0], st[1], o.x, o.y, rr, rr + 1.5);
      }
      us.forEach((u, k) => {
        const c = k % cols - (cols - 1) / 2, r = Math.floor(k / cols) - (rows - 1) / 2;
        const lx = c * sp, ly = -r * sp * (u.kind === 'ship' ? 2.2 : 1);
        let tx = o.x + lx * Math.sin(dir) + (ly - shift) * Math.cos(dir), ty = o.y - lx * Math.cos(dir) + (ly - shift) * Math.sin(dir);
        if (dom !== 'air') { const p = this.nav.nearestOk(dom, tx, ty, u.r); if (p) [tx, ty] = p; }
        // one shared route for the group (game maps): follow the leader path, then peel off to the formation slot
        const pts = lead && lead.pts.length > 1 ? lead.pts.slice(0, -1) : null;
        const share = pts && Math.hypot(tx - u.x, ty - u.y) > 60 && this.nav.lineOk(dom, u.x, u.y, pts[0][0], pts[0][1], this._navR(u));
        this.order(u, { type: o.type, x: tx, y: ty, noPlan: share });
        if (share) { u.path = pts.map((p) => p.slice()).concat([[tx, ty]]); u.pi = 0; u.repathAt = this.t + 4; }
        u.groupCap = (us.length > 1 || mixed) && dom !== 'air' ? slow : null;   // the group keeps together at its slowest member's speed
      });
    }
  }
  _canHitFromDeploy(u, o) { const tg = this.byId.get(o.target); if (!tg) return false; return this._weaponFor(u, u.sys[0], tg) != null; }
  _setDeploy(u, st) { u.deploy = st; u.deployT = this.t; for (const s of u.sys) { s.wind = null; s.aimed = null; } this.emit('deploy', { id: u.id, state: st }); }
  _plan(u, x, y, stopDist = 0) {
    // a goal in another region (an island it cannot drive to) that this unit has already gone as near to as it can: no new
    // search, it stays put; a plain move / attack-move counts as arrived. Ordering it there again costs nothing.
    const N = this.nav, U = u.unreach, bx = Math.floor(x / 16), by = Math.floor(y / 16);
    if (U && u.dom !== 'air' && U.bx === bx && U.by === by && Math.hypot(u.x - U.at[0], u.y - U.at[1]) < 12 + 2 * u.r) {
      u.path = null; u.pi = 0; u.needPlan = false; u.goal = { x: u.x, y: u.y, stop: stopDist }; u.pathReached = false;
      if ((u.order.type === 'move' || u.order.type === 'attackMove') && u.target == null) { u.order = { type: 'idle' }; u.groupCap = null; }
      return;
    }
    // over this tick's search budget: head straight for the goal now (the order is visibly taken) and plan on a later tick
    if (u.dom !== 'air' && this.planBudget <= 0) { u.goal = { x, y, stop: stopDist }; u.needPlan = true; if (!u.path || !this.deferKeep) { u.path = [[x, y]]; u.pi = 0; } u.repathAt = this.t + 0.1; return; }
    this.planBudget--; u.needPlan = false;
    u.goal = { x, y, stop: stopDist };
    if (u.dom === 'air') { u.path = [[x, y]]; u.pi = 0; return; }
    const pref = u.kind === 'ship' ? u.r + u.sp.dimensions_m.length * 0.6 + 8 : u.kind === 'foot' ? u.r + 0.4 : u.r + 1.5;
    if (u.kind === 'ship') { // ships pick a roomy berth near the ordered point (or the nearest reachable water for an inland order)
      const L = u.sp.dimensions_m.length; const g = this.nav.nearestOk('ship', x, y, this._navR(u) + 0.25 * L, 300) || this.nav.nearestOk('ship', x, y, this._navR(u), 700);
      if (g) { x = g[0]; y = g[1]; }
    }
    const P = N.path(u.dom, u.x, u.y, x, y, this._navR(u), pref);
    u.path = P.pts.length ? P.pts : null; u.pi = 0; u.pathReached = P.reached; u.repathAt = this.t + 4; u.stuckT = 0;
    u.unreach = P.unreach && P.goal ? { bx, by, at: [P.goal[0], P.goal[1]] } : null;
    if (u.path) u.goal = { x: u.path[u.path.length - 1][0], y: u.path[u.path.length - 1][1], stop: stopDist };
  }
  // ships plan with room to swing their hull (≈ 45 % of the length beyond the beam), so they never nose into water
  // they cannot turn around in; other units plan with their collision radius (+0.2 m)
  _navR(u) { return u.kind === 'ship' ? u.r + u.sp.dimensions_m.length * 0.45 : u.kind === 'foot' ? u.r : u.r + 0.2; }

  // ───────────── harvesters: grate → field → grate, the same cycle data/pace.js harvestCycle() predicts ─────────────
  /** Start a harvester on a deposit. dep: deposit object or id (sandbox econ layout); dock: refinery dock { grate, approach, face }.
   *  Docks and deposits are reserved (busy = harvester id) so harvesters queue instead of piling into a bay or a chute.
   *  Hooks (game): this.hooks.harvestDock(u) picks the refinery dock after loading; this.hooks.harvestDepleted(u) picks a new field.
   *  Patch mode (game ore fields, hooks.harvestPatch present): a field is a scatter of patches; the harvester loads from one
   *  patch at a time (harvestTake), hops to the next patch when it runs dry (harvestPatch), and goes to the next field when
   *  the whole field is empty — with partial cargo it heads home if that field is far. */
  harvest(u, dep, dock) {
    const E = this.econ || {};
    if (dep == null || typeof dep === 'string') dep = (E.deposits || []).find((d) => d.id === dep) || (E.deposits || [])[0];
    dock = dock || (u.harv && u.harv.dock) || E.dock; if (!dep || !dock) return;
    this._harvRelease(u);
    const keep = u.harv ? { history: u.harv.history } : { history: [] };
    const cargo = u.harv ? u.harv.cargo || 0 : 0;
    u.harv = Object.assign(keep, { dock, dep, state: 'out', legT: this.t, cycleStart: this.t, legs: {}, last: null, cycles: 0, cargo, patch: null });
    u.order = { type: 'harvest' }; u.scripted = false; u.loading = false;
    const atGrate = Math.hypot(u.x - dock.grate[0], u.y - dock.grate[1]) < 3, from = atGrate ? dock.approach : [u.x, u.y];
    if (this._patchMode()) { if (!this._nextPatch(u, from)) { u.harv.state = 'idle'; u.order = { type: 'idle' }; return; } }
    this._harvPlan(u, from, this._harvGoal(u), atGrate);
  }
  _patchMode() { return !!(this.hooks && this.hooks.harvestPatch); }
  _harvGoal(u) { const H = u.harv; return H.patch ? [H.patch.x, H.patch.y] : H.dep.svc; }
  /** patch mode: hold the nearest patch with ore in the current field (or the next field); false when there is none */
  _nextPatch(u, from) {
    const H = u.harv; if (H.patch) { this.hooks.harvestRelease(u, H.patch); H.patch = null; }
    let p = this.hooks.harvestPatch(u, H.dep, from);
    if (!p) { const nd = this.hooks.harvestDepleted && this.hooks.harvestDepleted(u); if (nd && nd !== H.dep) { H.dep = nd; p = this.hooks.harvestPatch(u, nd, from); } }
    H.patch = p || null; return !!p;
  }
  setHarvesterSpeed(v) { for (const sp of Object.values(this.spec)) if (sp.id === 'HV') sp.speed_mps = v; }
  _harvRelease(u) { const H = u.harv; if (!H) return; if (H.dock && H.dock.busy === u.id) H.dock.busy = null; if (H.dep && H.dep.busy === u.id) H.dep.busy = null; if (H.patch && this.hooks && this.hooks.harvestRelease) { this.hooks.harvestRelease(u, H.patch); H.patch = null; } }
  _harvPlan(u, from, to, viaFrom) { // plan from a fixed point (the bay approach), so the start never depends on the bay's narrow clearance
    const P = this.nav.path('veh', from[0], from[1], to[0], to[1], this._navR(u), u.r + 1.5);
    u.path = (viaFrom ? [from.slice()] : []).concat(P.pts); if (!u.path.length) u.path = [to.slice()];
    u.pi = 0; u.goal = { x: to[0], y: to[1], stop: 0 }; u.repathAt = this.t + 1e9; u.stuckT = 0;
  }
  _harvToDock(u) { // after loading: reserve a refinery dock, or wait at its queue spot
    const H = u.harv, d = (this.hooks && this.hooks.harvestDock && this.hooks.harvestDock(u)) || H.dock; H.dock = d;
    if (!d.busy || d.busy === u.id) { d.busy = u.id; H.state = 'back'; this._harvPlan(u, [u.x, u.y], d.approach, false); }
    else { H.state = 'queue'; const q = d.queue || [d.approach[0] + Math.cos(d.face) * 16 - Math.sin(d.face) * 12, d.approach[1] + Math.sin(d.face) * 16 + Math.cos(d.face) * 12]; this._harvPlan(u, [u.x, u.y], q, false); }
  }
  _harvestThink(u, dt) {
    const H = u.harv; if (!H || u.order.type !== 'harvest') return; const P = this.pace.harvester, t = this.t, near = (p, r = 3) => Math.hypot(u.x - p[0], u.y - p[1]) < r;
    if (this._patchMode() && (H.state === 'out' || H.state === 'load')) return this._patchThink(u, dt, P, near);
    if (H.state === 'out') {
      if (H.dep.ore != null && H.dep.ore <= 0) { const nd = this.hooks && this.hooks.harvestDepleted && this.hooks.harvestDepleted(u); if (nd) { H.dep = nd; this._harvPlan(u, [u.x, u.y], nd.svc, false); } else { this._harvRelease(u); u.order = { type: 'idle' }; u.path = null; u.harv.state = 'idle'; return; } }
      if (H.dep.busy && H.dep.busy !== u.id && near(H.dep.svc, 22)) { u.path = null; H.state = 'waitField'; }   // another harvester at the chute: wait clear of it
      else if (!u.path && near(H.dep.svc)) { H.legs.out = t - H.legT; H.state = 'load'; H.legT = t; u.loading = true; H.dep.busy = u.id; this.emit('harvest_load', { id: u.id, dur: P.load_s }); }
      else if (!u.path && !near(H.dep.svc)) this._harvPlan(u, [u.x, u.y], H.dep.svc, false);
    } else if (H.state === 'waitField') { if (!H.dep.busy || H.dep.busy === u.id) { H.state = 'out'; this._harvPlan(u, [u.x, u.y], H.dep.svc, false); } }
    else if (H.state === 'load' && t - H.legT >= P.load_s - EPS) {
      H.legs.load = t - H.legT; u.loading = false; if (H.dep.busy === u.id) H.dep.busy = null;
      const want = P.capacity_bails * (P.bail_value || 25); H.cargo = H.dep.ore == null ? want : Math.min(want, H.dep.ore); if (H.dep.ore != null) H.dep.ore -= H.cargo;
      H.legT = t; this._harvToDock(u);
    } else if (H.state === 'queue') { if (!H.dock.busy || H.dock.busy === u.id) { H.dock.busy = u.id; H.state = 'back'; this._harvPlan(u, [u.x, u.y], H.dock.approach, false); } }
    else if (H.state === 'back' && !u.path && near(H.dock.approach)) { H.legs.back = t - H.legT; H.state = 'pivot'; H.legT = t; u.scripted = true; u.v = 0; }
    else if (H.state === 'back' && !u.path && !near(H.dock.approach)) this._harvPlan(u, [u.x, u.y], H.dock.approach, false);
    else if (H.state === 'pivot') { // pivot in place to face the field (turn-rate ramp as in _trackMove)
      const wmax = u.m.hullTurn * D2R, e = wrap(H.dock.face - u.hdg); const wDes = Math.sign(e) * Math.min(wmax, Math.max(0.15, Math.abs(e) * 2.5));
      u.w = approach(u.w, wDes, wmax * 3.5 * dt); u.hdg = wrap(u.hdg + u.w * dt); const g = u.sp.dimensions_m.width * 0.78; u.trackL -= u.w * g / 2 * dt; u.trackR += u.w * g / 2 * dt;
      u.vx = u.vy = 0; if (Math.abs(wrap(H.dock.face - u.hdg)) < 0.02) { u.hdg = H.dock.face; u.w = 0; H.state = 'reverse'; }
    } else if (H.state === 'reverse') { // reverse straight down the bay onto the grate
      const [gx, gy] = H.dock.grate, c = Math.cos(u.hdg), sn = Math.sin(u.hdg), rem = Math.max(0, (u.x - gx) * c + (u.y - gy) * sn);
      const vDes = -Math.min(P.reverse_mps, Math.sqrt(2 * P.brake_mps2 * rem)); u.v = approach(u.v, vDes, (Math.abs(vDes) > Math.abs(u.v) ? P.accel_mps2 : P.brake_mps2) * dt);
      u.x += u.v * c * dt; u.y += u.v * sn * dt; u.trackL += u.v * dt; u.trackR += u.v * dt; u.vx = u.v * c; u.vy = u.v * sn; u.z = this.T.height(u.x, u.y);
      if ((rem < 0.05 && Math.abs(u.v) < 0.3) || (u.x - gx) * c + (u.y - gy) * sn <= 0) { u.x = gx; u.y = gy; u.v = 0; u.vx = u.vy = 0; H.legs.dock = t - H.legT; H.state = 'unload'; H.legT = t; this.emit('harvest_unload', { id: u.id, dur: P.unload_s }); }
    } else if (H.state === 'unload' && t - H.legT >= P.unload_s - EPS) {
      H.legs.unload = t - H.legT; H.last = { total: t - H.cycleStart, legs: { ...H.legs }, dep: H.dep.id }; H.cycles++; H.history.push(H.last); if (H.history.length > 20) H.history.shift();
      this.emit('harvest_cycle', { id: u.id, team: u.team, total: H.last.total, legs: H.last.legs, dep: H.dep.id, amount: H.cargo }); H.cargo = 0;
      if (H.dock.busy === u.id) H.dock.busy = null;
      H.cycleStart = t; H.legs = {}; H.legT = t;
      // game maps: the bay is narrower than a nav cell, so the drive out of it is scripted (straight along the bay axis)
      if (!this.nav.lineOk('veh', H.dock.grate[0], H.dock.grate[1], H.dock.approach[0], H.dock.approach[1], u.r * 0.6)) { H.state = 'exit'; u.scripted = true; return; }
      u.scripted = false; H.state = 'out'; if (this._patchMode() && !this._nextPatch(u, H.dock.approach)) { this._harvIdle(u); return; } this._harvPlan(u, H.dock.approach, this._harvGoal(u), true);
      if (H.next) { const n = H.next; H.next = null; this.harvest(u, n); }
    } else if (H.state === 'exit') { // drive forward out of the bay to the approach point, then on to the field
      const [ax, ay] = H.dock.approach, c = Math.cos(u.hdg), sn = Math.sin(u.hdg), rem = Math.max(0, (ax - u.x) * c + (ay - u.y) * sn);
      const vMax = this.spec.HV ? this.spec.HV.speed_mps : 8, vDes = Math.min(vMax, Math.sqrt(2 * P.brake_mps2 * rem) + 2.5);
      u.v = approach(u.v, vDes, (vDes > u.v ? P.accel_mps2 : P.brake_mps2) * dt);
      u.x += u.v * c * dt; u.y += u.v * sn * dt; u.trackL += u.v * dt; u.trackR += u.v * dt; u.vx = u.v * c; u.vy = u.v * sn; u.z = this.T.height(u.x, u.y);
      if (rem <= u.v * dt + 0.05) { u.scripted = false; H.state = 'out'; if (this._patchMode() && !H.patch && !this._nextPatch(u, [u.x, u.y])) { this._harvIdle(u); return; } this._harvPlan(u, [u.x, u.y], this._harvGoal(u), false); if (H.next) { const n = H.next; H.next = null; this.harvest(u, n); } }
    }
  }
  _harvIdle(u) { this._harvRelease(u); u.order = { type: 'idle' }; u.path = null; u.loading = false; u.scripted = false; u.harv.state = 'idle'; u.harv.noOre = true; this.emit('harvest_idle', { id: u.id, team: u.team }); }
  /** patch mode: drive to the held patch, load from it at the loading rate, hop to the next patch when it runs dry */
  _patchThink(u, dt, P, near) {
    const H = u.harv, t = this.t, cap = P.capacity_bails * (P.bail_value || 25);
    if (H.state === 'out') {
      if (!H.patch || H.patch.cell && H.patch.cell.amt <= 0) { if (!this._nextPatch(u, [u.x, u.y])) { if (H.cargo > 0) { H.legT = t; this._harvToDock(u); } else this._harvIdle(u); return; } this._harvPlan(u, [u.x, u.y], this._harvGoal(u), false); }
      const g = this._harvGoal(u);
      if (!u.path && near(g, 3.2)) { if (H.legs.out == null) H.legs.out = t - H.legT; H.state = 'load'; H.loadT = H.loadT || t; u.loading = true; u.v = 0; u.vx = u.vy = 0; this.emit('harvest_load', { id: u.id, dur: (cap - H.cargo) / (cap / P.load_s) }); }
      else if (!u.path) this._harvPlan(u, [u.x, u.y], g, false);
      return;
    }
    // load: take ore from the patch at the loading rate
    const want = Math.min(cap / P.load_s * dt, cap - H.cargo), got = this.hooks.harvestTake(u, H.patch, want); H.cargo += got;
    if (H.cargo >= cap - 1e-6) { H.legs.load = t - (H.loadT || t); H.loadT = null; u.loading = false; this.hooks.harvestRelease(u, H.patch); H.patch = null; H.legT = t; this._harvToDock(u); return; }
    if (got < want - 1e-9) {   // this patch ran dry: on to the next one (another field if this one is empty)
      u.loading = false; const dep0 = H.dep;
      if (!this._nextPatch(u, [u.x, u.y])) { H.legs.load = t - (H.loadT || t); H.loadT = null; if (H.cargo > 0) { H.legT = t; this._harvToDock(u); } else this._harvIdle(u); return; }
      const far = Math.hypot(H.patch.x - u.x, H.patch.y - u.y);
      if (H.dep !== dep0 && far > 150 && H.cargo >= cap * 0.5) { this.hooks.harvestRelease(u, H.patch); H.patch = null; H.legs.load = t - (H.loadT || t); H.loadT = null; H.legT = t; this._harvToDock(u); return; }   // half full and the next field is far: unload first
      H.state = 'out'; this._harvPlan(u, [u.x, u.y], [H.patch.x, H.patch.y], false); this.emit('harvest_hop', { id: u.id, d: far });
    }
  }

  // ───────────── main step ─────────────
  step() {
    const dt = TICK; this.t += dt; this.tick++; this.planBudget = this.planPerTick || 3;
    for (const u of this.units) if (u.needPlan && this.planBudget > 0) { if (u.alive && u.goal && u.path) this._plan(u, u.goal.x, u.goal.y, u.goal.stop); else u.needPlan = false; }
    if (this.tick % 3 === 1) this._visibility();
    for (const u of this.units) if (u.alive) this._think(u, dt);
    for (const u of this.units) if (u.alive) this._move(u, dt);
    this._separate(dt);
    for (const u of this.units) if (u.alive) this._combat(u, dt);
    this._projectiles(dt);
    for (const u of this.units) if (!u.alive && !u.removed && this.t - u.deathT > (u.m.fade || u.m.death) + 1) { u.removed = true; this.emit('remove', { id: u.id }); }
    this.scans = this.scans.filter((s) => s.until > this.t);
  }

  // ───────────── visibility (sight = centre-to-centre; terrain occludes except scan reveals) ─────────────
  _visibility() {
    const teams = new Set(this.units.map((u) => u.team)); this.vis = new Map();
    const all = this.units.filter((u) => u.alive && !u.hidden).concat(this.buildings.filter((b) => b.alive));
    for (const tm of teams) {
      const seen = new Set(); const eyes = this.units.filter((u) => u.alive && u.team === tm);
      for (const b of this.buildings) if (b.alive && b.team === tm) eyes.push(Object.assign({}, b, { sp: { sight_m: 30 }, geom: { eye: b.h } }));
      for (const o of all) {
        if (o.team === tm) continue;
        if (this.scans.some((s) => s.team === tm && Math.hypot(o.x - s.x, o.y - s.y) <= s.r + (o.r || 0))) { seen.add(o.id); continue; }
        for (const e of eyes) {
          const d = Math.hypot(o.x - e.x, o.y - e.y); if (d > e.sp.sight_m) continue;
          const ez = (e.z || 0) + (e.geom ? e.geom.eye : 1.6), oz = (o.z || 0) + (o.isBuilding ? o.h : o.geom.hitZ + 0.3);
          if (this.T.los(e.x, e.y, ez, o.x, o.y, oz, 3)) { seen.add(o.id); break; }
        }
      }
      this.vis.set(tm, seen);
    }
  }
  visible(team, o) { const s = this.vis.get(team); return !!(s && s.has(o.id)); }

  // ───────────── geometry helpers ─────────────
  axis(u) { // collision axis segment (2D) for capsules: tanks 65 % of L, ships 85 % of L, minus the radius at each end
    const st = u.sp.collision_shape; if (!st || st.type !== 'horizontal_capsule') return [u.x, u.y, u.x, u.y];
    const half = Math.max(0, st.total_length_m / 2 - st.radius_m), c = Math.cos(u.hdg), s = Math.sin(u.hdg);
    return [u.x - c * half, u.y - s * half, u.x + c * half, u.y + s * half];
  }
  surfDist(a, b) { // horizontal distance between collision surfaces (rules: range uses this)
    if (b.isBuilding || a.isBuilding) { const bb = b.isBuilding ? b : a, o = b.isBuilding ? a : b; const [ax, ay, cx, cy] = this.axis(o); return Math.max(0, segRect(ax, ay, cx, cy, bb) - (o.r || 0)); }
    const A = this.axis(a), B = this.axis(b); return Math.max(0, segSeg(A, B) - a.r - b.r);
  }
  local(u, lx, ly, lz) { const c = Math.cos(u.hdg), s = Math.sin(u.hdg); return [u.x + lx * s + ly * c, u.y - lx * c + ly * s, u.z + lz]; }
  hitPoint(o) { if (o.isBuilding) return [o.x, o.y, o.z + o.h * 0.55]; const z = o.deploy === 'deployed' && o.m.deploy ? o.m.deploy.hitZ : o.geom.hitZ; return [o.x, o.y, o.z + z]; }
  muzzle(u, s, k = 0) {
    const g = u.geom, mz = g.muzzle[k % g.muzzle.length];
    if (u.garrisonIn) { const b = this.byId.get(u.garrisonIn); const p = b.ports[u.port % b.ports.length]; return [b.x + p[0], b.y + p[1], b.z + b.h * 0.6]; }
    if ((u.kind === 'tracked' || u.kind === 'hover' || (u.kind === 'ship' && g.turret && u.uid === 'H05')) && g.turret) {
      const cp = Math.cos(u.pitch), sp = Math.sin(u.pitch); const my = g.gun[1] + mz[1] * cp - mz[2] * sp, mzz = g.gun[2] + mz[1] * sp + mz[2] * cp;
      const ct = Math.cos(u.turret), st = Math.sin(u.turret); const lx = g.turret[0] + (g.gun[0] + mz[0]) * ct - my * st, ly = g.turret[1] + (g.gun[0] + mz[0]) * st + my * ct;
      return this.local(u, lx, ly, g.turret[2] + mzz);
    }
    if (u.uid === 'A05' && s && s.ws[0] === 1 && g.aa) { return this.local(u, g.aa[0], g.aa[1], g.aa[2] + 1.2); }
    if (u.kind === 'foot') { const dz = u.deploy === 'deployed' ? -0.62 : 0; return this.local(u, mz[0], mz[1], mz[2] + dz); }
    return this.local(u, mz[0], mz[1], mz[2]);
  }

  // ───────────── thinking: targets, order progress, abilities ─────────────
  _think(u, dt) {
    const m = u.m;
    if (u.emp && this.t >= u.emp.until) { u.emp = null; this.emit('emp_end', { id: u.id }); }
    if (m.harvester) return this._harvestThink(u, dt);
    // deploy transitions
    if (u.deploy === 'deploying' && this.t - u.deployT >= m.deploy.setup - EPS) this._setDeploy(u, 'deployed');
    if (u.deploy === 'packing' && this.t - u.deployT >= m.deploy.pack - EPS) { this._setDeploy(u, 'mobile'); if (u.queued) { const q = u.queued; u.queued = null; this.order(u, q); } }
    // garrison entry / exit
    if (u.order.type === 'garrison') {
      const b = this.byId.get(u.order.building);
      if (!b || !b.alive || b.occupants.length >= b.slots) { u.order = { type: 'idle' }; u.path = null; }
      else if (this.surfDist(u, b) <= 2.0) {
        if (!u.enterT) { u.enterT = this.t; u.path = null; u.v = 0; this.emit('garrison_enter', { id: u.id, b: b.id, dur: m.garrison }); }
        if (this.t - u.enterT >= m.garrison - EPS) { u.garrisonIn = b.id; u.hidden = true; u.port = b.occupants.length; b.occupants.push(u.id); { const pp = b.ports[u.port % b.ports.length]; u.x = b.x + pp[0]; u.y = b.y + pp[1]; u.v = 0; u.vx = u.vy = 0; } u.order = { type: 'idle' }; u.enterT = 0; this.emit('garrisoned', { id: u.id, b: b.id }); }
      } else if (!u.path) this._plan(u, b.x, b.y, 0);
    }
    // engineer entry: same step-in as a garrison; then the unit is used up and the game layer applies the repair
    if (u.order.type === 'enter') {
      const b = this.byId.get(u.order.building);
      if (!b || !b.alive || (!u.enterT && b.hp >= b.maxHp - 0.5)) { u.order = { type: 'idle' }; u.path = null; u.enterT = 0; }   // nothing left to repair: stay out
      else if (u.enterT || this.surfDist(u, b) <= 2.0 || (!u.path && this.surfDist(u, b) <= 6)) {   // at the wall, or as close as the 4 m nav grid allows
        if (!u.enterT) { u.enterT = this.t; u.path = null; u.v = 0; u.vx = u.vy = 0; this.emit('garrison_enter', { id: u.id, b: b.id, dur: m.garrison }); }
        if (this.t - u.enterT >= m.garrison - EPS) { u.alive = false; u.removed = true; u.hidden = true; u.deathT = this.t; this.emit('engineer_enter', { id: u.id, b: b.id, team: u.team }); this.emit('remove', { id: u.id }); }
      } else if (!u.path) this._plan(u, b.x, b.y, 0);
    }
    if (u.order.type === 'exiting' && this.t - u.enterT >= m.exit - EPS) {
      const b = this.byId.get(u.garrisonIn); b.occupants = b.occupants.filter((i) => i !== u.id);
      const p = this.nav.nearestOk('foot', b.x, b.y - b.d / 2 - 2, u.r) || [b.x, b.y - b.d / 2 - 2];
      u.x = p[0]; u.y = p[1]; u.z = this.T.height(u.x, u.y); u.hidden = false; u.garrisonIn = null; u.order = { type: 'idle' }; u.enterT = 0; this.emit('ungarrisoned', { id: u.id });
    }
    // EMP ability (Disruptor): stationary, 0.3 s wind-up, visible enemy vehicle/ship/aircraft within 30 m
    if (u.order.type === 'emp') {
      const tg = this.byId.get(u.order.target), E = m.emp;
      const valid = tg && tg.alive && !tg.isBuilding && tg.team !== u.team && tg.sp.armor !== 'infantry' && this.visible(u.team, tg);
      if (!valid || this.t < u.abilityReady || u.garrisonIn) { u.order = { type: 'idle' }; u.empWind = null; }
      else if (this.surfDist(u, tg) > E.range) { if (!u.path || this.t > u.repathAt) this._plan(u, tg.x, tg.y); u.empWind = null; }
      else {
        u.path = null;
        if (u.v > 0.05) u.empWind = null;            // cannot use EMP while moving
        else if (!u.empWind) { u.empWind = this.t; this.emit('emp_wind', { id: u.id, target: tg.id, dur: E.wind }); }
        else if (this.t - u.empWind >= E.wind - EPS) {
          u.empWind = null; u.abilityReady = this.t + E.cd; u.order = { type: 'idle' };
          const immune = this.t < tg.empImmune || (tg.emp && this.t < tg.emp.until);
          this.emit('emp', { id: u.id, target: tg.id, applied: !immune, x: tg.x, y: tg.y });
          if (!immune) { tg.emp = { until: this.t + E.dur, speed: E.speed, cycle: E.cycle }; tg.empImmune = this.t + E.dur + E.immune; }
        }
      }
    }
    // Scan (Mote): point within 60 m, 0.25 s activation with the drone held still, reveal 18 m for 8 s through terrain
    if (u.order.type === 'scan') {
      const S = m.scan, o = u.order; const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (this.t < u.abilityReady) u.order = { type: 'idle' };
      else if (d > S.range) { if (!u.path) this._plan(u, o.x, o.y); }
      else {
        u.path = null; if (o.t0 == null) { o.t0 = this.t; this.emit('scan_wind', { id: u.id, x: o.x, y: o.y, dur: S.act }); }
        if (this.t - o.t0 >= S.act - EPS) { this.scans.push({ team: u.team, x: o.x, y: o.y, r: S.radius, until: this.t + S.dur }); u.abilityReady = this.t + S.cd; u.order = { type: 'idle' }; this.emit('scan', { id: u.id, x: o.x, y: o.y, r: S.radius, dur: S.dur }); this._visibility(); }
      }
    }
    if (u.kind === 'jet') return this._jetThink(u, dt);
    if (!u.sys.length) u.target = null;   // unarmed (engineers): never hold a target
    // target maintenance: invalid/out of leash → drop (manual targets persist while valid and visible)
    if (u.target != null) {
      const tg = this.byId.get(u.target);
      if (!tg || !tg.alive || tg.hidden || !this.visible(u.team, tg)) { u.target = null; u.manual = false; if (u.order.type === 'attack') u.order = { type: 'idle' }; }
      else if (!u.manual && u.order.type !== 'attackMove') { const w = this._weaponFor(u, u.sys[0], tg, true); if (!w || this.surfDist(u, tg) > w.range_m * 1.25) u.target = null; }
    }
    // auto-acquire: idle, guarding and attack-moving units; plain move orders ignore enemies
    // scan for targets every 0.2 s (staggered per unit) rather than every tick
    if (u.target == null && u.sys.length && (this.tick + u.id) % 6 === 0 && u.order.type !== 'move' && u.order.type !== 'garrison' && u.order.type !== 'emp' && u.order.type !== 'scan' && !(u.deploy && u.deploy !== 'mobile' && u.deploy !== 'deployed')) {
      const tg = this._acquire(u, u.sys[0]); if (tg) u.target = tg.id;
    }
    // pursuit for manual attack / leash for auto targets
    if (u.target != null && !u.garrisonIn && u.deploy !== 'deployed') {
      const tg = this.byId.get(u.target), w = this._weaponFor(u, u.sys[0], tg, true);
      if (w) {
        const d = this.surfDist(u, tg); const want = u.kind === 'heli' ? m.hold : u.kind === 'drone' ? m.hold : w.range_m * 0.92;
        const air = u.kind === 'heli' || u.kind === 'drone';
        if (air) {
          // hover-and-fire: hold near the stand-off distance on the line to the target
          const dd = Math.hypot(tg.x - u.x, tg.y - u.y) || 1; const holdC = want + (tg.r || 0) + u.r;
          if (Math.abs(dd - holdC) > 3) { const k = (dd - holdC) / dd; u.path = [[u.x + (tg.x - u.x) * k, u.y + (tg.y - u.y) * k]]; u.pi = 0; u.goal = { x: u.path[0][0], y: u.path[0][1], stop: 0 }; }
        } else if (d > w.range_m || !this._los(u, tg, w)) {
          if (u.manual || u.order.type === 'attackMove' || d <= w.range_m * 1.25) { if (!u.path || this.t > u.repathAt) this._plan(u, tg.x, tg.y, Math.min(w.range_m * 0.8, d)); }
        } else if (u.kind === 'foot' && u.path) { u.path = null; } // infantry stop to fire
      }
    }
    // attack-move: resume the march when no target
    if (u.order.type === 'attackMove' && u.target == null && !u.path && Math.hypot(u.order.x - u.x, u.order.y - u.y) > 4) this._plan(u, u.order.x, u.order.y);
    // guard: engage anything that comes within the guard radius of the anchor, never chase beyond it, then return
    if (u.order.type === 'guard') {
      const R = this._guardR(u), o = u.order;
      if (u.target != null) { const tg = this.byId.get(u.target); if (!tg || !tg.alive || Math.hypot(tg.x - o.x, tg.y - o.y) > R + 15) { u.target = null; u.path = null; } }
      if (u.target == null && !u.path && Math.hypot(o.x - u.x, o.y - u.y) > 4 && u.dom !== 'air') this._plan(u, o.x, o.y);
    }
    // shift-queued orders start once the unit is idle
    if (u.order.type === 'idle' && !u.path && u.target == null && u.queue && u.queue.length) this.order(u, u.queue.shift());
    // A05 independent AA system keeps its own target
    if (u.sys.length > 1) for (let k = 1; k < u.sys.length; k++) {
      const s = u.sys[k]; let tg = s.target != null ? this.byId.get(s.target) : null;
      if (!tg || !tg.alive || !this.visible(u.team, tg) || this.surfDist(u, tg) > this.spec[u.uid].weapons[s.ws[0]].range_m * 1.25) s.target = null;
      if (s.target == null && (this.tick + u.id) % 6 === 3) { tg = this._acquire(u, s); s.target = tg ? tg.id : null; }
    }
  }
  _avail(u, s) { // weapons usable now (deploy modes)
    let ws = s.ws; const D = u.m.deploy;
    if (D) ws = u.deploy === 'deployed' ? D.deployed : u.deploy === 'mobile' ? D.mobile : [];
    if (u.garrisonIn) ws = D ? D.mobile : ws;
    return ws.filter((i) => s.ws.includes(i));
  }
  _weaponFor(u, s, tg, ignoreRange = false) {
    if (!tg) return null; const cls = classOf(tg); const d = ignoreRange ? 0 : this.surfDist(u, tg);
    for (const i of this._avail(u, s)) {
      const w = u.sp.weapons[i]; if (!w.targets.includes(cls)) continue;
      if (!ignoreRange && (d > w.range_m || d < (w.minimum_range_m || 0))) continue;
      return Object.assign({ i }, w);
    }
    return null;
  }
  _acquire(u, s) {
    let best = null, bd = 1e9, bestAir = null, bad = 1e9;
    const cands = this.units.concat(this.buildings);
    for (const o of cands) {
      if (!o.alive || o.team === u.team || o.team < 0 || o.hidden || !this.visible(u.team, o)) continue;
      if (u.order.type === 'guard' && Math.hypot(o.x - u.order.x, o.y - u.order.y) > this._guardR(u)) continue;
      const w = this._weaponFor(u, s, o); if (!w) continue;
      let d = this.surfDist(u, o); if (o.isBuilding) d += 30; // prefer units over structures
      if (isAir(o) && d < bad) { bad = d; bestAir = o; }
      if (d < bd) { bd = d; best = o; }
    }
    if ((u.m.preferAir || (u.m.deploy && u.uid === 'A02')) && bestAir) return bestAir;
    return best;
  }
  _los(u, tg, w) {
    if (w.targets.length === 1 && w.targets[0] === 'air') return true; // air interception ignores terrain
    if (u.kind === 'heli' || u.kind === 'drone' || u.kind === 'jet') return true;
    const a = this.muzzle(u, u.sys[0]), b = this.hitPoint(tg); return this.T.los(a[0], a[1], a[2], b[0], b[1], b[2], 2);
  }

  // ───────────── movement ─────────────
  // speed allowed now so the hull can make the turn at the next waypoint: corner radius ≈ half the free water / ground
  // around it, corner speed = yaw rate × radius, and braking distance to the corner at the unit's deceleration
  _cornerSpeed(u, w, dec) {
    if (!u.path || u.pi >= u.path.length - 1) return Infinity;
    const p = u.path[u.pi], q = u.path[u.pi + 1]; const a1 = Math.atan2(p[1] - u.y, p[0] - u.x), a2 = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const th = Math.abs(wrap(a2 - a1)); if (th < 12 * D2R) return Infinity;
    const clr = this.nav.clear[u.dom][this.nav.cellOf(p[0], p[1])]; const R = Math.max(3, 0.5 * clr) * (th < 40 * D2R ? 1.6 : 1);
    const vc = w * R; const d = Math.hypot(p[0] - u.x, p[1] - u.y);
    return Math.sqrt(vc * vc + 2 * dec * 0.8 * d);
  }
  _guardR(u) { const r = Math.max(0, ...u.sp.weapons.map((w) => w.range_m || 0)); return r * 1.5 + 10; }
  _speedCap(u) {
    let v = u.sp.speed_mps; if (u.emp) v *= u.emp.speed; if (u.groupCap) v = Math.min(v, u.groupCap);   // group moves at the slowest member's speed
    if (u.kind === 'hover') {
      const s = u.sys[0], m = u.m; const lead = u.sp.speed_mps * (1 - m.chargeSpeed) / (m.accel * 2);   // time to brake down to 65 %
      const tg = u.target != null ? this.byId.get(u.target) : null;
      const soon = tg && tg.alive && s.cd <= m.precharge + lead + 0.05 && this._weaponFor(u, s, tg) && this.visible(u.team, tg);
      if (soon || (s.wind && s.wind.kind === 'charge') || this.t - s.lastFire < m.recovery) v *= m.chargeSpeed;
    }
    return v;
  }
  _desired(u) { // pure-pursuit look-ahead point along the path; returns [tx, ty, distRemaining] or null
    if (!u.path || u.pi >= u.path.length) return null;
    const look = u.kind === 'ship' ? Math.max(10, u.v * 2.0) : u.kind === 'foot' ? 1.2 : Math.max(3, u.v * 0.8);
    while (u.pi < u.path.length - 1) { const p = u.path[u.pi], dp = Math.hypot(p[0] - u.x, p[1] - u.y); if (dp >= Math.max(look * 0.6, this.nav.cell)) break;
      // cut to the next waypoint early only with a clear line to it from here (big cells: the corner it rounds may be a wall)
      if (dp > 1.0 && this.nav.cell > 2 && u.dom !== 'air') { const q = u.path[u.pi + 1]; if (!this.nav.lineOk(u.dom, u.x, u.y, q[0], q[1], Math.min(u.r, u.kind === 'foot' ? u.r : u.r * 0.6))) break; }
      u.pi++; }
    // ships: if the lookahead point would leave water, aim at the waypoint itself
    let p = u.path[u.pi];
    let rem = Math.hypot(p[0] - u.x, p[1] - u.y); for (let k = u.pi; k < u.path.length - 1; k++) rem += Math.hypot(u.path[k + 1][0] - u.path[k][0], u.path[k + 1][1] - u.path[k][1]);
    return [p[0], p[1], Math.max(0, rem - (u.goal ? u.goal.stop : 0))];
  }
  _move(u, dt) {
    if (u.hidden || u.scripted) return;
    const busy = (u.order.type === 'garrison' || u.order.type === 'enter') && u.enterT || u.order.type === 'exiting' || (u.deploy && u.deploy !== 'mobile');
    const kind = u.kind;
    if (kind === 'jet') return this._jetMove(u, dt);
    const D = busy ? null : this._desired(u);
    const x0 = u.x, y0 = u.y;
    if (kind === 'foot') this._footMove(u, D, dt);
    else if (kind === 'tracked') this._trackMove(u, D, dt);
    else if (kind === 'ship') this._shipMove(u, D, dt);
    else this._vectorMove(u, D, dt);   // hover, heli, drone
    // path completion
    if (D && D[2] < (kind === 'ship' ? Math.max(2.5, 0.12 * u.sp.dimensions_m.length) : kind === 'foot' ? 0.25 : 0.8) && Math.hypot(u.vx, u.vy) < (kind === 'foot' ? 0.3 : 1.0) && u.pi >= u.path.length - 1) {
      u.path = null; u.groupCap = null; if (u.order.type === 'move' || (u.order.type === 'attackMove' && u.target == null)) u.order = { type: 'idle' }; this.emit('arrive', { id: u.id });
    }
    // progress watchdog (game maps, crowds): no metre of progress toward the end of the path in 1.5 s → close enough to a
    // crowded goal counts as arrived; otherwise replan, and after two fruitless replans step aside to a free spot
    if (u.path && D && kind !== 'ship') {
      let P = u.prog; const gl = u.goal || { x: 0, y: 0 };
      if (!P || Math.hypot(P.gx - gl.x, P.gy - gl.y) > 2) P = u.prog = { path: u.path, gx: gl.x, gy: gl.y, t: this.t, d: D[2], n: 0 };   // new goal: fresh count
      else if (P.path !== u.path) { P.path = u.path; P.d = Math.max(P.d, D[2]); }                                                   // replanned (any reason): keep the count
      if (D[2] < P.d - 1.0) { P.t = this.t; P.d = D[2]; }
      else if (this.t - P.t > 1.5) {
        P.t = this.t; P.n++;
        const crowd = kind === 'foot' ? 5 : 3 + 2 * u.r;
        if (D[2] < crowd && !u.m.harvester) { u.path = null; u.groupCap = null; if (u.order.type === 'move' || (u.order.type === 'attackMove' && u.target == null)) u.order = { type: 'idle' }; this.emit('arrive', { id: u.id, early: true }); }
        else if (P.n <= 2 && u.goal) { this._plan(u, u.goal.x, u.goal.y, u.goal.stop); P.path = u.path; P.d = 1e9; }
        else if (u.goal) { const a = ((u.id * 7919 + this.tick * 104729) % 360) * Math.PI / 180, q = this.nav.nearestOk(u.dom, u.x + Math.cos(a) * 3 * u.r + Math.cos(a), u.y + Math.sin(a) * 3 * u.r + Math.sin(a), this._navR(u), 40);
          if (q) { const g = u.goal; u.path = [q, ...(this.nav.path(u.dom, q[0], q[1], g.x, g.y, this._navR(u), this._navR(u) + 1.5).pts)]; u.pi = 0; P.path = u.path; P.d = 1e9; P.n = 0; } }
      }
    }
    // stuck detection → repath
    const moved = Math.hypot(u.x - x0, u.y - y0); u.dist += moved;
    if (u.path) { if (moved < 0.15 * dt && Math.abs(u.w) < 0.02) u.stuckT += dt; else u.stuckT = Math.max(0, u.stuckT - dt); if (u.stuckT > 2.5 && u.goal) { u.stuckT = 0; if (kind === 'ship') u.astern = this.t + 4; this._plan(u, u.goal.x, u.goal.y, u.goal.stop); } }
  }
  _footMove(u, D, dt) {
    const s = u.sys[0]; const firing = !!s && (s.wind || this.t - s.lastFire < 0.25);
    let vDes = 0, hDes = u.hdg;
    if (D) { hDes = Math.atan2(D[1] - u.y, D[0] - u.x); const e = Math.abs(wrap(hDes - u.hdg)); vDes = Math.min(this._speedCap(u), Math.sqrt(2 * FOOT.decel * D[2])) * Math.max(0, Math.cos(e)) ** 1.5; }
    else if (u.target != null) { const tg = this.byId.get(u.target); if (tg) hDes = Math.atan2(tg.y - u.y, tg.x - u.x); }
    if (firing && !D) vDes = 0;
    const e = wrap(hDes - u.hdg), wmax = (u.deploy === 'deployed' ? 90 : FOOT.turn) * D2R; u.w = clamp(e / dt, -wmax, wmax); u.hdg = wrap(u.hdg + u.w * dt); // deployed traverse 90°/s (assumed)
    u.v = approach(u.v, vDes, (vDes > u.v ? FOOT.accel : FOOT.decel) * dt);
    this._advance(u, u.v * Math.cos(u.hdg) * dt, u.v * Math.sin(u.hdg) * dt);
    u.vx = u.v * Math.cos(u.hdg); u.vy = u.v * Math.sin(u.hdg); u.stride += u.v * dt; u.z = this.T.height(u.x, u.y);
  }
  _trackMove(u, D, dt) {
    const m = u.m, wmax = m.hullTurn * D2R * (u.emp ? 1 : 1), acc = m.accel * (u.emp ? u.emp.speed : 1), dec = m.accel * 1.6;
    let vDes = 0, wDes = 0; let vCap = this._speedCap(u);
    // grade: climbing slows the tank (up to 45 % on a 25° slope)
    const n = this.T.normal(u.x, u.y, 2), fx = Math.cos(u.hdg), fy = Math.sin(u.hdg); const grade = -(n[0] * fx + n[1] * fy) / n[2];
    vCap *= clamp(1 - Math.max(0, grade) * 1.0, 0.55, 1);
    if (D) {
      const hDes = Math.atan2(D[1] - u.y, D[0] - u.x); const e = wrap(hDes - u.hdg);
      if (Math.abs(e) > 45 * D2R) { vDes = 0; wDes = Math.sign(e) * wmax; } // pivot (tracks counter-rotate) once slowed
      else { wDes = clamp(e * 2.5, -wmax, wmax); vDes = Math.min(vCap * (1 - 0.35 * Math.abs(wDes) / wmax), Math.sqrt(2 * dec * D[2]), this._cornerSpeed(u, wmax, dec)) * Math.cos(e); }
      if (Math.abs(e) > 45 * D2R && Math.abs(u.v) > 1.0) wDes *= 0.5; // still braking: turn gently
    }
    u.v = approach(u.v, vDes, (Math.abs(vDes) > Math.abs(u.v) ? acc : dec) * dt);
    const wa = wmax * 3.5; u.w = approach(u.w, wDes, wa * dt); u.hdg = wrap(u.hdg + u.w * dt);
    this._advance(u, u.v * Math.cos(u.hdg) * dt, u.v * Math.sin(u.hdg) * dt);
    u.vx = u.v * Math.cos(u.hdg); u.vy = u.v * Math.sin(u.hdg);
    const gauge = u.sp.dimensions_m.width * 0.78; u.trackL += (u.v - u.w * gauge / 2) * dt; u.trackR += (u.v + u.w * gauge / 2) * dt;
    // NB hdg is CCW-positive: turning left (w > 0) speeds up the right track
    u.accelF = approach(u.accelF, (u.v - (u._pv ?? u.v)) / dt, 20 * dt); u._pv = u.v;
    u.z = this.T.height(u.x, u.y); if (m.turretYaw) this._turret(u, dt);
  }
  _vectorMove(u, D, dt) { // hover tank, helicopter, drone: velocity vector with an acceleration limit; heading turns separately
    const m = u.m, air = u.kind !== 'hover', vCap = this._speedCap(u), acc = m.accel * (u.emp ? u.emp.speed : 1);
    let dvx = 0, dvy = 0, hDes = u.hdg;
    if (D) {
      const dx = D[0] - u.x, dy = D[1] - u.y, d = Math.hypot(dx, dy) || 1; const vd = Math.min(vCap, Math.sqrt(2 * acc * 0.9 * D[2]));
      dvx = dx / d * vd; dvy = dy / d * vd;
    }
    const braking = Math.hypot(dvx, dvy) < Math.hypot(u.vx, u.vy) - 0.01;
    const ax = dvx - u.vx, ay = dvy - u.vy, al = Math.hypot(ax, ay), lim = acc * (u.kind === 'hover' && braking ? 2 : 1) * dt; // hover brakes at 2× accel (assumed)
    const k = al > lim ? lim / al : 1; const nvx = u.vx + ax * k, nvy = u.vy + ay * k;
    const sp = Math.hypot(nvx, nvy);
    // heading: face the target when attacking (air) / the turret does it (hover); otherwise face the velocity
    const tg = u.target != null ? this.byId.get(u.target) : null;
    if (air && tg && sp < vCap * (m.fireSpeed || 0.5) * 1.6) hDes = Math.atan2(tg.y - u.y, tg.x - u.x);
    else if (sp > 0.8) hDes = Math.atan2(nvy, nvx);
    else if (D) hDes = Math.atan2(D[1] - u.y, D[0] - u.x);
    const e = wrap(hDes - u.hdg), wmax = m.hullTurn * D2R; const wDes = clamp(e * 3, -wmax, wmax); u.w = approach(u.w, wDes, wmax * 4 * dt); u.hdg = wrap(u.hdg + u.w * dt);
    // body-frame acceleration for visual pitch/bank
    const axw = (nvx - u.vx) / dt, ayw = (nvy - u.vy) / dt, c = Math.cos(u.hdg), s = Math.sin(u.hdg);
    u.accelF = approach(u.accelF, axw * c + ayw * s, 30 * dt); u.accelS = approach(u.accelS, -axw * s + ayw * c, 30 * dt);
    const ox = u.x, oy = u.y; this._advance(u, nvx * dt, nvy * dt);
    if (u.x === ox && u.y === oy && (nvx || nvy)) { u.vx = 0; u.vy = 0; } else { u.vx = nvx; u.vy = nvy; }
    u.v = Math.hypot(u.vx, u.vy);
    if (u.kind === 'hover') { u.z = this.T.surface(u.x, u.y) + m.clearance; u.trackL += u.v * dt; this._turret(u, dt); }
    else {
      // terrain-following altitude with a 2 s look-ahead so ridges are cleared early
      let g = this.T.surface(u.x, u.y); for (let t = 0.5; t <= 2.0; t += 0.5) g = Math.max(g, this.T.surface(u.x + u.vx * t, u.y + u.vy * t));
      const zt = g + m.alt; u.z = approach(u.z, zt, 6 * dt); u.climb = (zt - u.z);
      if (u.kind === 'heli') { const tg2 = tg; if (tg2) { const b = wrap(Math.atan2(tg2.y - u.y, tg2.x - u.x) - u.hdg); u.podYaw = clamp(b, -m.podYaw * D2R, m.podYaw * D2R); } else u.podYaw = approach(u.podYaw, 0, dt); }
      if (u.kind === 'drone') { if (tg) { const b = wrap(Math.atan2(tg.y - u.y, tg.x - u.x) - u.hdg); u.gimbal = approach(u.gimbal, b, 6 * dt); const hp = this.hitPoint(tg); u.gimbalPitch = Math.atan2(hp[2] - u.z, Math.hypot(tg.x - u.x, tg.y - u.y)); } else { u.gimbal = approach(u.gimbal, 0, 3 * dt); u.gimbalPitch = approach(u.gimbalPitch, 0, 2 * dt); } }
    }
  }
  _shipMove(u, D, dt) {
    const m = u.m, vmax = this._speedCap(u), acc = m.accel * (u.emp ? u.emp.speed : 1);
    let vDes = 0, wDes = 0;
    // rudder authority grows with speed; twin screws still give 30 % at rest
    const eff = clamp(0.3 + 0.7 * Math.abs(u.v) / (0.5 * u.sp.speed_mps), 0.3, 1); const wmax = m.hullTurn * D2R * eff;
    if (D) {
      const hDes = Math.atan2(D[1] - u.y, D[0] - u.x), e = wrap(hDes - u.hdg);
      wDes = clamp(e * 1.6, -wmax, wmax);
      vDes = Math.min(vmax * (1 - 0.3 * Math.abs(wDes) / (m.hullTurn * D2R)), Math.sqrt(2 * acc * 0.85 * D[2]), this._cornerSpeed(u, m.hullTurn * D2R, acc));
      // turning-circle check: reaching a point at distance d off the bow by e needs radius d / (2 sin e). Slow until
      // speed / effective yaw rate fits inside it (authority falls with speed), so ships never orbit a goal
      const dl = Math.hypot(D[0] - u.x, D[1] - u.y), Rq = dl / (2 * Math.max(Math.sin(Math.min(Math.abs(e), Math.PI / 2)), 0.02));
      let vt = Math.min(vmax, m.hullTurn * D2R * Rq); const effOf = (v) => clamp(0.3 + 0.7 * v / (0.5 * u.sp.speed_mps), 0.3, 1);
      for (let it = 0; it < 3; it++) vt = Math.min(vt, m.hullTurn * D2R * effOf(vt) * Rq);
      if (Math.abs(e) > 90 * D2R) vt = Math.min(vt, vmax * 0.35);
      vDes = Math.min(vDes, Math.max(vt, 0.4));
      // goal well astern at low speed: pivot on the twin screws (30 % yaw authority) instead of creeping into the bank
      if (Math.abs(e) > 110 * D2R && Math.abs(u.v) < 1.5) { vDes = 0; u.pivot = true; } else if (Math.abs(e) < 60 * D2R) u.pivot = false;
      if (u.pivot) { vDes = 0; wDes = Math.sign(e) * wmax; }
      if (u.astern > this.t) { vDes = -vmax * 0.3; }                       // wedged: go astern for a few seconds
    }
    u.v = approach(u.v, vDes, acc * dt);
    if (u.v < 0) wDes = -wDes;                                              // going astern reverses the rudder effect
    u.w = approach(u.w, wDes, (m.hullTurn * D2R) * 0.8 * dt);
    { const h0 = u.hdg; u.hdg = wrap(u.hdg + u.w * dt); if (!this._okPos(u, u.x, u.y) && this._okPos(Object.assign({}, u, { hdg: h0 }), u.x, u.y)) { u.hdg = h0; u.w = 0; } }
    // sideslip decays with a 0.8 s time constant, pushing the stern out in turns
    u.side = approach(u.side, -u.w * u.v * 0.25, 2 * dt); u.side *= Math.exp(-dt / 0.8);
    const c = Math.cos(u.hdg), s = Math.sin(u.hdg); const vx = u.v * c - u.side * s, vy = u.v * s + u.side * c;
    const ox = u.x, oy = u.y; this._advance(u, vx * dt, vy * dt);
    if (u.x === ox && u.y === oy && u.v > 0.1) u.v *= 0.5; // grounding guard: the capsule may not leave authored water
    u.vx = vx; u.vy = vy; u.z = 0; u.accelS = approach(u.accelS, u.w * u.v, 3 * dt);
    if (u.uid === 'H05') this._turret(u, dt);
    if (u.uid === 'A05') this._aaTurret(u, dt);
    u.trackL += u.v * dt;
  }
  _advance(u, dx, dy) {
    if (u.dom === 'air') { u.x = clamp(u.x + dx, 2, this.T.W - 2); u.y = clamp(u.y + dy, 2, this.T.H - 2); return; }
    const nx = u.x + dx, ny = u.y + dy;
    if (this._okPos(u, nx, ny) || (u.kind !== 'ship' && !this._okPos(u, u.x, u.y))) { u.x = nx; u.y = ny; return; }   // already inside a blocked cell (a new footprint, a door): free to walk out
    if (this._okPos(u, nx, u.y)) { u.x = nx; return; }   // slide along obstacles
    if (this._okPos(u, u.x, ny)) { u.y = ny; return; }
  }
  _okPos(u, x, y) {
    if (u.kind === 'ship') { // the whole capsule axis must stay on authored water
      const st = u.sp.collision_shape, half = st.total_length_m / 2 - st.radius_m * 0.5, c = Math.cos(u.hdg), s = Math.sin(u.hdg);
      return this.nav.okAt('ship', x, y, 0) && this.nav.okAt('ship', x + c * half, y + s * half, 0) && this.nav.okAt('ship', x - c * half, y - s * half, 0);
    }
    return this.nav.okAt(u.dom, x, y, Math.min(u.r, u.kind === 'foot' ? u.r : u.r * 0.6));
  }
  _turret(u, dt) { // independent turret yaw / gun pitch toward the target (no hull snap)
    const m = u.m; const tg = u.target != null ? this.byId.get(u.target) : null;
    let yDes = 0, pDes = 0;
    if (tg && tg.alive) {
      const g = u.geom; const tp = this.local(u, g.turret[0], g.turret[1], g.turret[2]);
      const h = this.hitPoint(tg); yDes = wrap(Math.atan2(h[1] - tp[1], h[0] - tp[0]) - u.hdg);
      pDes = Math.atan2(h[2] - tp[2], Math.hypot(h[0] - tp[0], h[1] - tp[1]));
    } else if (u.kind === 'tracked' && !u.path && this.t > 3) { yDes = u.turret; } // hold
    if (m.yawLimit) yDes = clamp(yDes, -m.yawLimit * D2R, m.yawLimit * D2R);
    const ry = m.turretYaw * D2R * dt; let e = wrap(yDes - u.turret);
    if (m.yawLimit) e = yDes - u.turret; // can't wrap through the hard stops
    u.turret = m.yawLimit ? clamp(u.turret + clamp(e, -ry, ry), -m.yawLimit * D2R, m.yawLimit * D2R) : wrap(u.turret + clamp(e, -ry, ry));
    const pr = 25 * D2R * dt; pDes = clamp(pDes, m.pitch[0] * D2R, m.pitch[1] * D2R); u.pitch += clamp(pDes - u.pitch, -pr, pr);
  }
  _aaTurret(u, dt) {
    const s = u.sys[1]; const tg = s && s.target != null ? this.byId.get(s.target) : null; const m = u.m;
    let yDes = u.aaYaw, pDes = 0.4;
    if (tg) { const a = this.local(u, u.geom.aa[0], u.geom.aa[1], u.geom.aa[2]); const h = this.hitPoint(tg); yDes = wrap(Math.atan2(h[1] - a[1], h[0] - a[0]) - u.hdg); pDes = Math.atan2(h[2] - a[2], Math.hypot(h[0] - a[0], h[1] - a[1])); }
    const ry = m.aaYaw * D2R * dt; u.aaYaw = wrap(u.aaYaw + clamp(wrap(yDes - u.aaYaw), -ry, ry));
    u.aaPitch += clamp(clamp(pDes, m.aaPitch[0] * D2R, m.aaPitch[1] * D2R) - u.aaPitch, -60 * D2R * dt, 60 * D2R * dt);
  }

  // ───────────── Kestrel sortie cycle ─────────────
  _pad(u) { return u.jet.pad; }
  _sortie(u) { const J = u.jet; if (!J.armed) { J.pending = true; return; } J.aim = null; if (J.phase === 'landed' || J.phase === 'reload') { J.phase = 'takeoff'; J.t = this.t; this.emit('takeoff', { id: u.id }); } else if (J.phase === 'return' || J.phase === 'approach') J.phase = 'cruise'; }
  _jetReturn(u) { const J = u.jet; if (J.phase === 'cruise' || J.phase === 'attack' || J.phase === 'loiter') { J.phase = 'return'; J.gate = null; } }
  _jetThink(u, dt) {
    const J = u.jet;
    if (u.order.type === 'attack') {
      if (u.target != null) { const tg = this.byId.get(u.target); if (!tg || !tg.alive) { u.target = null; u.order = { type: 'idle' }; if (J.phase !== 'landed' && J.phase !== 'reload' && J.phase !== 'landing') this._jetReturn(u); } }
      if (J.phase === 'reload' && this.t - J.t >= u.m.reload - EPS && !J.armed) { J.armed = true; this.emit('rearmed', { id: u.id }); }
      if (J.armed && (J.pending || (J.phase === 'reload' && u.target != null))) { J.pending = false; this._sortie(u); }
    }
    if (J.phase === 'reload' && this.t - J.t >= u.m.reload - EPS && !J.armed) { J.armed = true; this.emit('rearmed', { id: u.id }); }
  }
  _jetMove(u, dt) {
    const J = u.jet, m = u.m, V = u.sp.speed_mps * (u.emp ? u.emp.speed : 1), pad = J.pad;
    const vtol = J.phase === 'approach' || J.phase === 'landing' || J.phase === 'takeoff';
    const wmax = vtol ? Math.max(u.v / m.rmin, 30 * D2R) : u.v / m.rmin;   // minimum turn radius 12 m at the current speed
    const surf = this.T.surface(u.x, u.y);
    const steer = (tx, ty) => { const e = wrap(Math.atan2(ty - u.y, tx - u.x) - u.hdg); const wDes = clamp(e * 4, -wmax, wmax); u.w = approach(u.w, wDes, wmax * 3 * dt); u.hdg = wrap(u.hdg + u.w * dt); return e; };
    const fly = (v) => { u.v = approach(u.v, v, 15 * dt); u.x = clamp(u.x + Math.cos(u.hdg) * u.v * dt, 2, this.T.W - 2); u.y = clamp(u.y + Math.sin(u.hdg) * u.v * dt, 2, this.T.H - 2); };
    const alt = (zt, rate) => { u.z = approach(u.z, zt, rate * dt); };
    const cruiseZ = () => { let g = surf; for (let t = 0.5; t <= 2; t += 0.5) g = Math.max(g, this.T.surface(u.x + Math.cos(u.hdg) * V * t, u.y + Math.sin(u.hdg) * V * t)); return g + m.alt; };
    switch (J.phase) {
      case 'landed': case 'reload': u.v = 0; u.w = 0; J.gear = 1; if (pad) { u.x = pad.x; u.y = pad.y; u.z = this.T.surface(pad.x, pad.y); } break;
      case 'takeoff': { // 1.0 s: lift off the pad and accelerate; gear retracts once clear (z > 3 m above the pad)
        const t = this.t - J.t; fly(Math.min(V, V * t / 1.6)); alt((pad ? this.T.surface(pad.x, pad.y) : surf) + m.alt * Math.min(1, t / 1.6), 14);
        if (u.z - surf > 3) J.gear = Math.max(0, J.gear - dt / 0.6);
        if (t >= m.takeoff - EPS && u.v >= V * 0.6) { J.phase = 'cruise'; }
        break;
      }
      case 'cruise': case 'attack': {
        fly(V); alt(cruiseZ(), 8); J.gear = Math.max(0, J.gear - dt / 0.6);
        let P = null; const tg = u.target != null ? this.byId.get(u.target) : null;
        if (tg && tg.alive && this.visible(u.team, tg)) P = [tg.x, tg.y]; else if (u.order.type === 'attack' && u.order.x != null) P = [u.order.x, u.order.y];
        if (!P || !J.armed) { if (u.order.type === 'move') { const e = steer(u.order.x, u.order.y); if (Math.hypot(u.order.x - u.x, u.order.y - u.y) < 30) { J.phase = 'loiter'; J.lc = [u.order.x, u.order.y]; } void e; } else J.phase = 'return'; break; }
        // attack run: release when the 0.8 s fall reaches the aim point and the nose is within 10° of it
        const d = Math.hypot(P[0] - u.x, P[1] - u.y); const rel = V * m.fall; let e;
        J.phase = 'attack';
        if (J.go && this.t > J.go) J.go = null;
        if (J.go) { u.w = approach(u.w, 0, wmax * 3 * dt); u.hdg = wrap(u.hdg + u.w * dt); e = wrap(Math.atan2(P[1] - u.y, P[0] - u.x) - u.hdg); }
        else e = steer(P[0], P[1]);
        if (!J.go && d <= rel + 1.5 && d >= rel - 6) {
          if (Math.abs(e) <= m.align * D2R) this._release(u, P[0], P[1]);
          else J.go = this.t + 2.2; // misaligned: go around (straight out, then turn back)
        } else if (!J.go && d < rel - 6) J.go = this.t + 1.6;
        break;
      }
      case 'loiter': { fly(V); alt(cruiseZ(), 8); const c = J.lc; const ang = Math.atan2(u.y - c[1], u.x - c[0]) + 0.6; steer(c[0] + Math.cos(ang) * 45, c[1] + Math.sin(ang) * 45); if (u.order.type === 'attack') J.phase = 'cruise'; break; }
      case 'return': { // fly to an approach gate behind the pad, then a decelerating VTOL approach
        if (!pad) { J.phase = 'loiter'; J.lc = [u.x, u.y]; break; }
        fly(V); alt(cruiseZ(), 8);
        // approach gate 70 m out from the pad on the side the jet is coming from (kept inside the map); the final
        // approach heading is gate → pad
        if (!J.gate) { const a0 = Math.atan2(u.y - pad.y, u.x - pad.x); let gx = pad.x + Math.cos(a0) * 70, gy = pad.y + Math.sin(a0) * 70;
          gx = clamp(gx, 20, this.T.W - 20); gy = clamp(gy, 20, this.T.H - 20); J.gate = [gx, gy]; }
        steer(J.gate[0], J.gate[1]);
        if (Math.hypot(J.gate[0] - u.x, J.gate[1] - u.y) < 14) { J.phase = 'approach'; J.gate = null; }
        break;
      }
      case 'approach': {
        const d = Math.hypot(pad.x - u.x, pad.y - u.y); steer(pad.x, pad.y);
        const vt = Math.min(V, Math.sqrt(2 * 9.0 * Math.max(0, d - 0.5))); u.v = approach(u.v, vt, 12 * dt);
        u.x += Math.cos(u.hdg) * u.v * dt; u.y += Math.sin(u.hdg) * u.v * dt; alt(this.T.surface(pad.x, pad.y) + 6, 5);
        if (d < 1.0 && u.v < 1.0) { J.phase = 'landing'; J.t = this.t; J.z0 = u.z; this.emit('landing', { id: u.id }); }
        break;
      }
      case 'landing': { // 1.2 s: gear lowers, the jet settles onto the pad
        const t = Math.min(1, (this.t - J.t + EPS) / m.land); const pz = this.T.surface(pad.x, pad.y);
        u.x += (pad.x - u.x) * 0.2; u.y += (pad.y - u.y) * 0.2; u.v = 0; u.w = approach(u.w, 0, 3 * dt);

        u.z = J.z0 + (pz - J.z0) * (t * t * (3 - 2 * t)); J.gear = Math.min(1, t * 1.5);
        if (t >= 1) { J.phase = 'reload'; J.t = this.t; u.z = pz; this.emit('landed', { id: u.id }); }
        break;
      }
    }
    u.vx = Math.cos(u.hdg) * u.v; u.vy = Math.sin(u.hdg) * u.v; u.accelS = u.w * u.v;
  }
  _release(u, ax, ay) {
    const J = u.jet, w = u.sp.weapons[0]; J.armed = false; J.phase = 'return'; J.gate = null; J.lastRelease = this.t; this.stats.shots += 2;
    J.drops = [{ at: this.t, side: 0 }, { at: this.t + w.burst_gap_s, side: 1 }]; J.aimPt = [ax, ay, this.T.surface(ax, ay)];
    if (u.order.x != null) u.order = { type: 'idle' };   // ground-point sortie: one payload
    this.emit('attack_run', { id: u.id, x: ax, y: ay });
  }

  // ───────────── combat ─────────────
  _combat(u, dt) {
    if (u.passive) return;
    if (u.kind === 'jet') return this._jetCombat(u);
    if (u.order.type === 'exiting' || ((u.order.type === 'garrison' || u.order.type === 'enter') && u.enterT)) return;
    for (let k = 0; k < u.sys.length; k++) this._system(u, u.sys[k], k, dt);
  }
  _jetCombat(u) {
    const J = u.jet; if (!J.drops) return;
    for (const d of J.drops) if (!d.done && this.t >= d.at) {
      d.done = true; const w = u.sp.weapons[0]; const mz = this.muzzle(u, null, d.side);
      // bombs keep the horizontal heading, fall 0.8 s to the fixed aim point and never track after release
      this.proj.push({ kind: 'bomb', owner: u.id, team: u.team, w, x: mz[0], y: mz[1], z: mz[2], x0: mz[0], y0: mz[1], z0: mz[2], t0: this.t, T: u.m.fall, ax: J.aimPt[0], ay: J.aimPt[1], az: J.aimPt[2], side: d.side });
      this.emit('bomb', { id: u.id, side: d.side, x: J.aimPt[0], y: J.aimPt[1], r: w.splash_radius_m });
    }
    if (J.drops.every((d) => d.done)) J.drops = null;
  }
  _system(u, s, k, dt) {
    // cooldown: "first shot to next first shot"; under EMP the interval stretches by ×1.25
    const slow = u.emp ? u.emp.cycle : 1; const pcd = s.cd; s.cd = Math.max(-1, s.cd - dt / slow); if (pcd > EPS && s.cd <= EPS) s.readyT = this.t;
    // burst follow-ups at their burst gap (Hammer 0.15 s, Sentinel 0.2 s)
    if (s.burst > 0 && this.t >= s.burstAt) {
      const tg = this.byId.get(s.burstT); if (tg && tg.alive) this._fire(u, s, s.burstW, tg, s.shotN++); s.burst--; s.burstAt = this.t + s.burstW.burst_gap_s;
    }
    if (s.burst > 0) return;
    if (u.deploy && u.deploy !== 'mobile' && u.deploy !== 'deployed') return; // no firing during deploy/pack transitions
    const tgId = k === 0 ? u.target : s.target; const tg = tgId != null ? this.byId.get(tgId) : null;
    if (!tg || !tg.alive) { s.wind = null; s.aimed = null; s.aimTg = null; return; }
    const w = this._weaponFor(u, s, tg);
    const m = u.m;
    // engagement conditions per locomotion kind
    let ok = !!w && this.visible(u.team, tg) && this._los(u, tg, w);
    if (ok && u.kind === 'foot') {
      if (u.v > 0.05 || u.path) ok = false;                                   // infantry stop to fire
      else { const b = wrap(Math.atan2(tg.y - u.y, tg.x - u.x) - u.hdg); if (Math.abs(b) > 8 * D2R && !u.garrisonIn) ok = false; }
      if (u.uid === 'A02' && u.deploy === 'mobile' && !isAir(tg)) ok = false; // mobile mode attacks aircraft only
    }
    if (ok && (u.kind === 'tracked' || u.kind === 'hover' || u.uid === 'H05')) {
      const g = u.geom, tp = this.local(u, g.turret[0], g.turret[1], g.turret[2]), h = this.hitPoint(tg);
      const yErr = wrap(Math.atan2(h[1] - tp[1], h[0] - tp[0]) - u.hdg - u.turret); const pNeed = Math.atan2(h[2] - tp[2], Math.hypot(h[0] - tp[0], h[1] - tp[1]));
      if (Math.abs(yErr) > m.tol * D2R) ok = false;
      if (pNeed < m.pitch[0] * D2R - 0.02 || pNeed > m.pitch[1] * D2R + 0.02 || Math.abs(pNeed - u.pitch) > 3 * D2R) ok = false;
    }
    if (ok && u.uid === 'A05' && k === 1) { const a = this.local(u, u.geom.aa[0], u.geom.aa[1], u.geom.aa[2]); const h = this.hitPoint(tg); if (Math.abs(wrap(Math.atan2(h[1] - a[1], h[0] - a[0]) - u.hdg - u.aaYaw)) > m.aaTol * D2R) ok = false; }
    if (ok && u.kind === 'heli') { if (u.v > u.sp.speed_mps * m.fireSpeed) ok = false; const b = wrap(Math.atan2(tg.y - u.y, tg.x - u.x) - u.hdg); if (Math.abs(b) > m.podYaw * D2R) ok = false; }
    if (ok && u.kind === 'drone') { if (u.v > u.sp.speed_mps * m.fireSpeed) ok = false; }
    if (!ok) { // interrupted wind-up deals no damage and consumes no cycle
      if (s.wind) { this.emit('wind_cancel', { id: u.id, sys: k }); s.wind = null; }
      if ((u.kind === 'foot' && (u.v > 0.05 || u.path)) || m.lockLOS) { s.aimed = null; s.aimTg = null; } // movement (or lost LOS for a lock) cancels it
      return;
    }
    // aim / lock wind-up once per target (infantry). Line of sight must hold for the whole lock.
    if (m.aim && s.aimed !== tg.id) {
      if (s.aimTg !== tg.id) { s.aimTg = tg.id; s.aimT0 = this.t; this.emit('aim', { id: u.id, target: tg.id, dur: m.aim }); }
      if (this.t - s.aimT0 >= m.aim - EPS) s.aimed = tg.id;
    }
    const aimedOk = !m.aim || s.aimed === tg.id;
    // per-shot pre-fire charge (Disruptor 0.2 s, Wisp fins 0.25 s, Sentinel/Spectre lid opening) overlaps the cooldown tail
    const pre = (k === 0 || !m.independent) ? (m.precharge || m.lidLead || 0) : 0;
    if (pre > 0) {
      if (s.cd > pre) return;
      if (!s.wind && u.kind === 'hover' && u.v > u.sp.speed_mps * m.chargeSpeed * (u.emp ? u.emp.speed : 1) + 0.15) return; // slow to 65 % before charging
      if (!s.wind) { s.wind = { kind: 'charge', t0: this.t, dur: s.cd > EPS ? s.cd * slow : pre, tg: tg.id, w: w.i }; this.emit('charge', { id: u.id, sys: k, dur: s.wind.dur, w: w.i, lid: s.lid }); }
      if (this.t - s.wind.t0 < s.wind.dur - EPS || s.cd > EPS || !aimedOk) return;
      s.wind = null;
    } else if (s.cd > EPS || !aimedOk) return;
    // release: a released projectile consumes its full cycle. If it fires on the tick the cooldown expired, the
    // sub-tick remainder carries over so cycles that aren't tick multiples (0.45 s, 2.2 s ...) stay exact on average
    this._fire(u, s, w, tg, s.shotN++);
    s.cd = (s.cd <= EPS && this.t - s.readyT < EPS) ? s.cd + w.cycle_s : w.cycle_s; s.lastFire = this.t;
    if (w.burst > 1) { s.burst = w.burst - 1; s.burstAt = this.t + w.burst_gap_s; s.burstT = tg.id; s.burstW = w; }
  }
  _fire(u, s, w, tg, n) {
    const muzzleIdx = u.kind === 'heli' ? n % 2 : (u.uid === 'T05' ? n % 2 : (u.uid === 'A05' && w.i === 0 ? n % 4 : 0));
    const mz = this.muzzle(u, s, muzzleIdx); const hp = this.hitPoint(tg); this.stats.shots++;
    const vet = [1, 1.12, 1.25][u.rank]; const ev = { id: u.id, w: w.i, sys: u.sys.indexOf(s), n, muzzle: muzzleIdx, x: mz[0], y: mz[1], z: mz[2], tx: hp[0], ty: hp[1], tz: hp[2], target: tg.id };
    if (u.uid === 'A05' || u.uid === 'T05') s.lid = (s.lid + 1) % (u.uid === 'A05' ? 4 : 2);
    if (w.kind === 'hitscan') {
      ev.tracer = !u.m.tracer || n % u.m.tracer === 0; this.emit('fire', ev);
      this._damage(u, tg, w.damage * this.mult(w, tg) * vet, w); this.stats.hits++;
      this.emit('impact', { x: hp[0], y: hp[1], z: hp[2], kind: 'hitscan', uid: u.uid, w: w.i, target: tg.id });
      return;
    }
    this.emit('fire', ev);
    if (w.kind === 'ballistic') {
      // straight trajectory at constant speed toward the intercept point (linear lead); no homing, so turning targets can be missed
      let ax = hp[0], ay = hp[1], az = hp[2]; const tvx = tg.vx || 0, tvy = tg.vy || 0;
      for (let it = 0; it < 3; it++) { const t = Math.hypot(ax - mz[0], ay - mz[1], az - mz[2]) / w.projectile_speed_mps; ax = hp[0] + tvx * t; ay = hp[1] + tvy * t; }
      const d = Math.hypot(ax - mz[0], ay - mz[1], az - mz[2]) || 1, sp = w.projectile_speed_mps;
      this.proj.push({ kind: 'shell', owner: u.id, team: u.team, w, vet, target: tg.id, x: mz[0], y: mz[1], z: mz[2], vx: (ax - mz[0]) / d * sp, vy: (ay - mz[1]) / d * sp, vz: (az - mz[2]) / d * sp, life: (d + 8) / sp, t0: this.t, uid: u.uid });
    } else if (w.kind === 'guided') {
      // homing with a turn limit; self-destructs harmlessly if the target dies (no retarget)
      const sp = w.projectile_speed_mps; let dx = hp[0] - mz[0], dy = hp[1] - mz[1], dz = hp[2] - mz[2];
      if (u.uid === 'A05' && w.i === 0) dz += 6 + Math.hypot(dx, dy) * 0.15;     // anti-ship: launch climbs out of the cell, low arc
      else if (u.uid === 'T05') dz += 3;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.proj.push({ kind: 'missile', owner: u.id, team: u.team, w, vet, target: tg.id, x: mz[0], y: mz[1], z: mz[2], vx: dx / l * sp, vy: dy / l * sp, vz: dz / l * sp, life: w.life_s, t0: this.t, turn: (w.turn_deg_s || 180) * D2R, uid: u.uid });
    }
  }
  _projectiles(dt) {
    const keep = [];
    for (const p of this.proj) {
      const age = this.t - p.t0; const px = p.x, py = p.y, pz = p.z;
      if (p.kind === 'bomb') {
        const t = Math.min(1, age / p.T); p.x = p.x0 + (p.ax - p.x0) * t; p.y = p.y0 + (p.ay - p.y0) * t; p.z = p.z0 + (p.az - p.z0) * t * t;
        if (t >= 1) { this._splash(p); continue; } keep.push(p); continue;
      }
      const tg = this.byId.get(p.target);
      if (p.kind === 'missile') {
        if (!tg || !tg.alive) { this.emit('proj_end', { x: p.x, y: p.y, z: p.z, reason: 'selfdestruct', uid: p.uid }); continue; }
        const h = this.hitPoint(tg); const dx = h[0] - p.x, dy = h[1] - p.y, dz = h[2] - p.z, dl = Math.hypot(dx, dy, dz) || 1;
        const sp = p.w.projectile_speed_mps, vl = Math.hypot(p.vx, p.vy, p.vz) || 1;
        // rotate the velocity toward the target by at most turn·dt
        const cx = p.vx / vl, cy = p.vy / vl, cz = p.vz / vl, tx = dx / dl, ty = dy / dl, tz = dz / dl;
        const ang = Math.acos(clamp(cx * tx + cy * ty + cz * tz, -1, 1)), mx = p.turn * dt;
        if (ang > 1e-4) { const f = Math.min(1, mx / ang); const nx = cx + (tx - cx) * f, ny = cy + (ty - cy) * f, nz = cz + (tz - cz) * f, nl = Math.hypot(nx, ny, nz) || 1; p.vx = nx / nl * sp; p.vy = ny / nl * sp; p.vz = nz / nl * sp; }
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      // swept hit test against the target's collision shape
      if (tg && tg.alive && this._segHits(px, py, pz, p.x, p.y, p.z, tg)) {
        const vet = p.vet || 1, own = this.byId.get(p.owner) || { team: p.team, rank: 0 }; this._damage(own, tg, p.w.damage * this.mult(p.w, tg) * vet, p.w); this.stats.hits++;
        if (p.w.shell_splash_m > 0) this._shellSplash(p, own, tg, vet);
        this.emit('impact', { x: p.x, y: p.y, z: p.z, kind: p.kind, uid: p.uid, target: tg.id }); continue;
      }
      const g = this.T.height(p.x, p.y);
      if (p.z < Math.max(g, 0) - 0.05 && age > 0.08) { this.stats.misses++; this.emit('miss', { x: p.x, y: p.y, z: Math.max(g, 0), water: g < 0, uid: p.uid }); continue; }
      if (age > p.life) { this.stats.misses++; this.emit(p.kind === 'missile' ? 'proj_end' : 'miss', { x: p.x, y: p.y, z: p.z, reason: 'expired', water: g < 0, uid: p.uid }); continue; }
      keep.push(p);
    }
    this.proj = keep;
  }
  _segHits(ax, ay, az, bx, by, bz, o) {
    if (o.isBuilding) { const t = 0.5, x = (ax + bx) / 2, y = (ay + by) / 2, z = (az + bz) / 2; void t; return Math.abs(x - o.x) <= o.w / 2 + 0.3 && Math.abs(y - o.y) <= o.d / 2 + 0.3 && z <= o.z + o.h + 0.3; }
    const st = o.sp.collision_shape; const r = o.r + 0.15;
    if (st.type === 'target_sphere') return segPointDist(ax, ay, az, bx, by, bz, o.x, o.y, o.z + o.geom.hitZ) <= r;
    if (st.type === 'vertical_capsule') { const h = o.deploy === 'deployed' ? 1.0 : st.height_m; return segSegDist3(ax, ay, az, bx, by, bz, o.x, o.y, o.z + r * 0.5, o.x, o.y, o.z + h - r * 0.5) <= r; }
    const [x0, y0, x1, y1] = this.axis(o); const zc = o.kind === 'ship' ? o.z + 1.0 : o.z + o.geom.hitZ;
    return segSegDist3(ax, ay, az, bx, by, bz, x0, y0, zc, x1, y1, zc) <= r + (o.kind === 'ship' ? 0.8 : 0.4);
  }
  _splash(p) {
    const w = p.w, R = w.splash_radius_m, edge = w.splash_edge_multiplier; const owner = this.byId.get(p.owner) || { team: p.team, rank: 0 };
    this.emit('explosion', { x: p.ax, y: p.ay, z: p.az, r: R, uid: 'A04', water: this.T.height(p.ax, p.ay) < 0 });
    const vet = [1, 1.12, 1.25][owner.rank || 0];
    for (const o of this.units.concat(this.buildings)) {
      if (!o.alive || o.team === p.team || (o.sp && o.sp.armor === 'air') || o.hidden) continue;
      // radius measured from impact point to the target's collision surface; linear 1 → edge, 0 outside
      const d = o.isBuilding ? segRect(p.ax, p.ay, p.ax, p.ay, o) : Math.max(0, segPointDist2(p.ax, p.ay, this.axis(o)) - o.r);
      if (d > R) continue; const f = 1 - (1 - edge) * (d / R); const mult = this.mult(w, o); if (!mult) continue;
      this._damage(owner, o, w.damage * mult * f * vet, w); this.stats.hits++;
    }
  }
  /** damage multiplier of weapon w against target o: the game's weapon-type × armour-type table when set (this.damageMul),
   *  else the pack's per-weapon multipliers by target class */
  mult(w, o) { return this.damageMul ? this.damageMul(w, o) : (w.multipliers[classOf(o)] || 0); }
  /** shell fragments (game damage table: weapon.shell_splash_m): units near the hit take damage falling to
   *  shell_splash_edge at the radius; the struck target is not hit twice; aircraft are never caught */
  _shellSplash(p, own, hit, vet) {
    const w = p.w, R = w.shell_splash_m, edge = w.shell_splash_edge ?? 0.3;
    for (const o of this.units) {
      if (o === hit || !o.alive || o.team === p.team || o.dom === 'air' || o.hidden) continue;
      const d = Math.max(0, segPointDist2(p.x, p.y, this.axis(o)) - o.r); if (d > R) continue;
      const m = this.mult(w, o); if (!m) continue; this._damage(own, o, w.damage * m * vet * (1 - (1 - edge) * d / R), w);
    }
  }
  _damage(src, o, amt, w) {
    if (!o.alive || amt <= 0) return; if (this.dmgScale) amt *= this.dmgScale;   // global time-to-kill setting (game)
    const before = o.hp; o.hp = Math.max(0, o.hp - amt); const dealt = before - o.hp;
    if (src && src.id) { o.dmgLog = o.dmgLog || []; o.dmgLog.push({ id: src.id, a: dealt, t: this.t }); }
    this.emit('damage', { id: o.id, amt: dealt, hp: o.hp, src: src && src.id });
    if (o.hp <= 0) this._kill(o, src);
  }
  _kill(o, src) {
    o.alive = false; o.deathT = this.t; this.stats.kills++;
    const dir = src && src.x != null ? Math.atan2(o.y - src.y, o.x - src.x) : 0;
    this.emit('death', { id: o.id, uid: o.uid, dir, building: !!o.isBuilding });
    if (o.isBuilding) { for (const id of o.occupants) { const q = this.byId.get(id); if (q && q.alive) { q.hidden = false; q.garrisonIn = null; this._kill(q, src); } } o.occupants = []; }
    // veterancy: XP split by share of damage in the preceding 20 s; unit kill = its cost, building = 25 %
    const log = (o.dmgLog || []).filter((e) => this.t - e.t <= 20); const tot = log.reduce((a, e) => a + e.a, 0) || 1;
    const value = o.isBuilding ? 0.25 * (o.sp.cost || 1000) : o.sp.cost;
    const share = new Map(); for (const e of log) share.set(e.id, (share.get(e.id) || 0) + e.a / tot);
    for (const [id, f] of share) {
      const a = this.byId.get(id); if (!a || !a.alive || a.team === o.team || a.isBuilding) continue;
      a.xp += value * f; const want = a.xp >= 4 * a.sp.cost ? 2 : a.xp >= 1.5 * a.sp.cost ? 1 : 0;
      if (want > a.rank) { const pct = a.hp / a.maxHp; a.rank = want; a.maxHp = a.sp.health * [1, 1.1, 1.2][want]; a.hp = pct * a.maxHp; this.emit('promote', { id: a.id, rank: want }); }
    }
    if (o.isBuilding) { this._stampBuilding(o, false); return; }
    if (o.harv) { this._harvRelease(o); o.loading = false; }
    if (o.garrisonIn) { const b = this.byId.get(o.garrisonIn); if (b) b.occupants = b.occupants.filter((i) => i !== o.id); }
  }

  // ───────────── separation: capsule push-apart; infantry are never pushed into blocked cells ─────────────
  _separate(dt) {
    const all = []; for (const u of this.units) if (!u.hidden && u.kind !== 'jet' && (u.alive || (u.m.wreckNoCollide && this.t - u.deathT < u.m.wreckNoCollide))) all.push(u);
    const ext = (u) => u.r + (u.sp.collision_shape && u.sp.collision_shape.total_length_m ? u.sp.collision_shape.total_length_m / 2 : 0);
    for (let i = 0; i < all.length; i++) {
      const a = all[i]; const ea = ext(a);
      for (let k = i + 1; k < all.length; k++) {
        const b = all[k]; if (!a.alive && !b.alive) continue;
        const airA = a.dom === 'air', airB = b.dom === 'air'; if (airA !== airB) continue;
        const dx = b.x - a.x, dy = b.y - a.y, lim = ea + ext(b) + 0.4; if (dx * dx + dy * dy > lim * lim) continue;   // cheap reject
        if (airA && Math.abs(a.z - b.z) > 4) continue;
        const A = this.axis(a), B = this.axis(b); const [d, nx, ny] = segSegN(A, B);
        const want = a.r + b.r + (a.kind === 'foot' && b.kind === 'foot' ? 0.25 : 0.35);
        if (d >= want) continue;
        const pen = want - d; const ma = a.alive ? mass(a) : 1e9, mb = b.alive ? mass(b) : 1e9; const fa = mb / (ma + mb), fb = ma / (ma + mb);
        const push = Math.min(pen * 0.5, 2.5 * dt); // gentle: at most 2.5 m/s of separation drift, so it never reads as a jolt
        if (a.alive) this._nudge(a, -nx * push * fa, -ny * push * fa); if (b.alive) this._nudge(b, nx * push * fb, ny * push * fb);
      }
    }
  }
  _nudge(u, dx, dy) { if (!dx && !dy) return; const nx = u.x + dx, ny = u.y + dy; if (u.dom === 'air' || this._okPos(u, nx, ny) || (u.kind !== 'ship' && !this._okPos(u, u.x, u.y))) { u.x = nx; u.y = ny; } else if (this._okPos(u, nx, u.y)) u.x = nx; else if (this._okPos(u, u.x, ny)) u.y = ny; }
}

// ───────────── geometry ─────────────
function mass(u) { return { foot: 1, tracked: 40, hover: 25, heli: 10, drone: 2, ship: 200, jet: 15 }[u.kind] || 1; }
function segPointDist2(px, py, S) { const [ax, ay, bx, by] = S; const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - dx * t, py - ay - dy * t); }
function segSeg(A, B) { return segSegN(A, B)[0]; }
function segSegN(A, B) { // 2D closest distance between segments + unit normal from A to B
  const [p1x, p1y, q1x, q1y] = A, [p2x, p2y, q2x, q2y] = B;
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry; let s, t;
  if (a < 1e-9 && e < 1e-9) { s = t = 0; }
  else if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else { const c = d1x * rx + d1y * ry; if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); } else { const b = d1x * d2x + d1y * d2y, den = a * e - b * b; s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e; if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); } } }
  const cx = p1x + d1x * s, cy = p1y + d1y * s, dx = p2x + d2x * t, dy = p2y + d2y * t; const d = Math.hypot(dx - cx, dy - cy);
  if (d < 1e-6) return [0, 1, 0]; return [d, (dx - cx) / d, (dy - cy) / d];
}
function segRect(ax, ay, bx, by, R) { // distance from a 2D segment to an axis-aligned rectangle
  const n = 8; let best = 1e9; for (let k = 0; k <= n; k++) { const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t; const dx = Math.max(0, Math.abs(x - R.x) - R.w / 2), dy = Math.max(0, Math.abs(y - R.y) - R.d / 2); best = Math.min(best, Math.hypot(dx, dy)); } return best;
}
function segPointDist(ax, ay, az, bx, by, bz, px, py, pz) { const dx = bx - ax, dy = by - ay, dz = bz - az, l = dx * dx + dy * dy + dz * dz; let t = l ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t); }
function segSegDist3(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  let best = 1e9; const n = 6; for (let k = 0; k <= n; k++) { const t = k / n; best = Math.min(best, segPointDist(ax, ay, az, bx, by, bz, cx + (dx - cx) * t, cy + (dy - cy) * t, cz + (dz - cz) * t)); }
  return best;
}
export { segSegN, segRect };
