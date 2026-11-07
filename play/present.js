// Presentation of the simulation: unit views (engine views.js) interpolated between fixed ticks, projectiles, structures with
// construction / damage / destruction states, hit reactions, debris and turret tosses, flash lights, camera shake, and the
// sound cues for all of it. Nothing here changes gameplay: it only reads world state and world events.
import * as THREE from 'three';
import { makeView, TEAM_COLORS } from './engine/views.js';
import { FX } from './engine/fx.js';
import { STRUCTURES } from './rules.js';
import { toWorld } from './game.js';

const V3 = THREE.Vector3;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpA = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

export function snapshot(u) {
  return { x: u.x, y: u.y, z: u.z, hdg: u.hdg, turret: u.turret, pitch: u.pitch, aaYaw: u.aaYaw, aaPitch: u.aaPitch, podYaw: u.podYaw, gimbal: u.gimbal, gimbalPitch: u.gimbalPitch,
    trackL: u.trackL, trackR: u.trackR, stride: u.stride, v: u.v, vx: u.vx, vy: u.vy, w: u.w, accelF: u.accelF, accelS: u.accelS, climb: u.climb || 0, gear: u.jet ? u.jet.gear : null,
    deploy: u.deploy, target: u.target, path: !!u.path, order: u.order.type, hidden: u.hidden, alive: u.alive, loading: !!u.loading, harv: u.harv ? u.harv.state : null };
}
export function interp(a, b, t) {
  const o = Object.assign({}, b);
  for (const k of ['x', 'y', 'z', 'trackL', 'trackR', 'stride', 'v', 'vx', 'vy', 'w', 'accelF', 'accelS', 'climb', 'pitch', 'aaPitch', 'gimbalPitch', 'podYaw']) if (typeof a[k] === 'number' && typeof b[k] === 'number') o[k] = lerp(a[k], b[k], t);
  if (a.gear != null && b.gear != null) o.gear = lerp(a.gear, b.gear, t);
  for (const k of ['hdg', 'turret', 'aaYaw', 'gimbal']) o[k] = lerpA(a[k], b[k], t);
  return o;
}

// sound per shooter (audio.js names)
const FIRE_SFX = { H01: 'rifle', A01: 'carbine', T01: 'pulse', H02: 'rocket_launch', T02: 'lance', H03: 'cannon_heavy', A03: 'cannon_medium', T03: 'energy_cannon', H04: 'rocket_launch', T04: 'pulse', H05: 'deck_gun', A05: 'missile_launch', T05: 'missile_launch' };
const BIG_GUN = { H03: 1, A03: 0.8, T03: 0.9, H05: 1.1 };
const PROJ_GEO = { shell: new THREE.CylinderGeometry(0.045, 0.045, 0.6, 6).rotateX(Math.PI / 2), missile: new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8).rotateX(Math.PI / 2), bomb: new THREE.CapsuleGeometry(0.17, 0.85, 4, 8).rotateX(Math.PI / 2) };
const PROJ_MAT = { shell: new THREE.MeshBasicMaterial({ color: 0xffd28a }), cyan: new THREE.MeshBasicMaterial({ color: 0x9ffcf2 }), missile: new THREE.MeshStandardMaterial({ color: 0xcfd2d4, metalness: 0.4, roughness: 0.4 }), bomb: new THREE.MeshStandardMaterial({ color: 0x4d5257, metalness: 0.5, roughness: 0.5 }) };
const DEBRIS_GEO = [new THREE.BoxGeometry(0.5, 0.18, 0.4), new THREE.BoxGeometry(0.8, 0.12, 0.3), new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.TetrahedronGeometry(0.35), new THREE.BoxGeometry(1.2, 0.1, 0.6)];
const DEBRIS_MAT = { metal: new THREE.MeshStandardMaterial({ color: 0x2c2e30, metalness: 0.6, roughness: 0.6 }), hot: new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: 0x6a2a08, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.7 }), concrete: new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.95 }), dark: new THREE.MeshStandardMaterial({ color: 0x3b3a37, roughness: 0.9 }) };

export class Presenter {
  constructor({ scene, camera, T, world, game, protos, bprotos, playerTeam = 0, audio = null }) {
    Object.assign(this, { scene, camera, T, world, game, protos, bprotos, playerTeam, audio });
    this.fx = new FX(scene, T); this.views = new Map(); this.unitScale = 1; this.snap = new Map(); this.projV = new Map(); this.structs = new Map();
    this.debris = []; this.decals = []; this.simTime = 0; this.frustum = new THREE.Frustum(); this.noLod = false; this.ikErr = null; this.forceLod = null;
    this.trauma = 0; this.shakeOff = new V3(); this.lodStats = [0, 0, 0]; this.lodSwitches = 0; this.errors = [];
    this.stats = { hitReactions: 0, debris: 0, tossed: 0, flashes: 0, shakes: 0, structsBuilt: 0, sfx: 0 };
    // muzzle / explosion flash lights: a fixed pool that is always in the scene (no shader recompiles), lit on demand
    this.lights = []; for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffc27a, 0, 45, 2); l.userData = { t0: -9, dur: 0.1, peak: 0 }; scene.add(l); this.lights.push(l); }
    this.app = this;   // views.js reads app.T, app.fx, app.scene, app.camera, app.frustum, app.simTime, app.world
  }
  sfx(name, x, y, o = {}) { if (!this.audio) return; try { this.audio.sfx(name, Object.assign({ x, y }, o)); this.stats.sfx++; } catch (e) { /* audio is optional */ } }
  visibleTo(o) { return o.team === this.playerTeam || o.isBuilding || this.world.visible(this.playerTeam, o); }

  // ───────────── after every simulation tick (world events of this tick still present) ─────────────
  afterStep() {
    const w = this.world;
    for (const [, s] of this.snap) s.prev = s.cur;
    for (const u of w.units) { const s = this.snap.get(u.id); if (s) s.cur = snapshot(u); }
    for (const e of w.events) { try { this.handleEvent(e); } catch (err) { this.errors.push(`event ${e.type}: ${err.message}`); } }
    const live = new Set();
    for (const p of w.proj) { live.add(p); let v = this.projV.get(p); if (!v) { v = this.makeProj(p); this.projV.set(p, v); } v.prev = v.cur || [p.x, p.y, p.z]; v.cur = [p.x, p.y, p.z]; }
    for (const [p, v] of this.projV) if (!live.has(p)) { this.scene.remove(v.mesh); this.projV.delete(p); }
  }
  addUnitView(u) {
    if (this.views.has(u.id)) return; const proto = this.protos[u.uid]; if (!proto) return;
    const v = makeView(this, u, proto); this.views.set(u.id, v); v.setVisualScale(visScale(u, this.unitScale)); const s = snapshot(u); this.snap.set(u.id, { prev: s, cur: s });
    v.hit = null; v.flash = 0; v.flashMats = v.allMats.filter((m) => m.emissive && !/^(GLOW|DISC)/.test(m.name || '')); for (const m of v.flashMats) m.userData.e0 = m.emissive.clone();
  }
  setUnitScale(s) { this.unitScale = s; for (const v of this.views.values()) v.setVisualScale(visScale(v.u, s)); }
  makeProj(p) {
    const cyan = p.uid && p.uid[0] === 'T'; const k = p.kind === 'bomb' ? 'bomb' : p.kind === 'shell' ? 'shell' : 'missile'; const bolt = p.uid === 'T02';
    const mat = bolt ? PROJ_MAT.cyan : k === 'shell' ? (cyan ? PROJ_MAT.cyan : PROJ_MAT.shell) : PROJ_MAT[k];
    const mesh = new THREE.Mesh(bolt ? PROJ_GEO.shell : PROJ_GEO[k], mat); mesh.castShadow = k !== 'shell' && !bolt;
    if (k === 'missile' && p.uid === 'A05') mesh.scale.set(1.6, 1.6, 2.2); if (k === 'missile' && p.uid === 'T05') mesh.scale.set(1.2, 1.2, 1.0); if (p.uid === 'H04') mesh.scale.set(1.1, 1.1, 0.7);
    if (k === 'shell' && BIG_GUN[p.uid]) mesh.scale.set(2.2, 2.2, 3);
    this.scene.add(mesh); const v = { mesh, p, kind: k, cyan, born: this.world.t, off: null, trailAcc: 0 };
    const view = this.views.get(p.owner); if (view && p.kind !== 'bomb') { const mz = view.lastMuzzle; if (mz) v.off = new V3(mz.x - p.x, mz.y - p.z, mz.z + p.y); }
    const owner = this.world.byId.get(p.owner); mesh.visible = !owner || this.visibleTo(owner) || this.world.visible(this.playerTeam, owner);
    return v;
  }
  flashLight(x, y, z, peak, dur, color = 0xffc27a) {
    const l = this.lights.reduce((a, b) => (a.userData.t0 < b.userData.t0 ? a : b)); l.position.set(x, z, -y); l.color.setHex(color);
    l.userData = { t0: this.simTime, dur, peak }; l.intensity = peak; this.stats.flashes++;
  }
  shake(amount, x, y) {   // trauma model: amount 0..1, attenuated by distance from the camera's ground focus
    const c = this.focus || { x, y }; const d = Math.hypot(x - c.x, y - c.y), H = this.viewH || 150;
    const k = amount / (1 + Math.pow(d / (120 + H * 0.6), 2)); if (k < 0.02) return; this.trauma = Math.min(1, this.trauma + k); this.stats.shakes++;
  }

  // ───────────── world events → views, effects, sound ─────────────
  handleEvent(e) {
    const w = this.world, fx = this.fx; const view = e.id != null ? this.views.get(e.id) : null;
    if (e.type === 'spawn') { const u = w.byId.get(e.id); if (u) this.addUnitView(u); return; }
    if (e.type === 'building') { const b = w.byId.get(e.id); if (b) this.addStructView(b); return; }
    if (view) view.onEvent(e);
    const seen = (o) => o && this.visibleTo(o);
    if (e.type === 'fire' && view) {
      const u = view.u; const names = muzzleNames(u, e); let mz = null; for (const n of names) if (view.N[n]) { mz = view.sock(n); break; }
      if (!mz) mz = new V3(e.x, e.z, -e.y); view.lastMuzzle = mz;
      const tp = new V3(e.tx, e.tz, -e.ty); const dir = tp.clone().sub(mz).normalize();
      const kind = u.kind === 'tracked' || u.kind === 'hover' ? 'cannon' : u.uid === 'H05' ? 'naval' : (u.uid === 'T01' || u.uid === 'T04' || u.uid === 'T02') ? 'pulse' : (u.kind === 'ship' || u.uid === 'H02' || u.uid === 'H04') ? 'rocket' : 'rifle';
      if (!seen(u)) return;
      fx.muzzle(mz, dir, kind);
      const W = u.sp.weapons[e.w];
      if (W.kind === 'hitscan') {
        const end = tp.clone().add(new V3(rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(-0.15, 0.15)));
        if (kind === 'pulse') fx.seg(mz, end, [0.4, 1, 0.95], u.uid === 'T04' ? 0.05 : 0.08, { travel: 0.35 });
        else if (e.tracer) fx.seg(mz, end, [1, 0.7, 0.3], u.uid === 'A01' ? 0.06 : 0.07, { travel: 0.25 });
        if (u.kind === 'foot' && kind !== 'pulse' && Math.random() < 0.5) { const r = new V3(1, 0, 0).applyQuaternion(view.group.quaternion); fx.spark(mz.x, mz.y, mz.z, { vx: r.x * 2.5, vy: 2.2, vz: r.z * 2.5, g: 9.8, life: 0.5, s0: 0.05, s1: 0.05, c0: [0.95, 0.75, 0.35] }); }   // ejected brass
      }
      if (BIG_GUN[u.uid]) { this.flashLight(mz.x, -mz.z, mz.y, 900 * BIG_GUN[u.uid], 0.09, u.uid[0] === 'T' ? 0x8ff6ff : 0xffc27a); this.shake(0.05 * BIG_GUN[u.uid], u.x, u.y);
        // blast overpressure kicks dust off the ground in front of the muzzle
        const g = Math.max(this.T.height(u.x, u.y), 0); if (u.kind !== 'ship') for (let k = 0; k < 5; k++) fx.puff(mz.x + dir.x * 2 + rnd(-1, 1), g + 0.3, mz.z + dir.z * 2 + rnd(-1, 1), { vx: dir.x * 4 + rnd(-1, 1), vy: 0.6, vz: dir.z * 4 + rnd(-1, 1), drag: 2, life: 1.1, s0: 0.8, s1: 3.2, a0: 0.25, c0: [0.62, 0.56, 0.45] }); }
      this.sfx(FIRE_SFX[u.uid] || 'rifle', u.x, u.y, u.uid === 'A01' && u.deploy === 'deployed' ? { alt: 'mg' } : undefined);
      if (u.uid === 'A01' && u.deploy === 'deployed') this.sfx('mg', u.x, u.y);
      return;
    }
    if (e.type === 'impact') {
      const tg = w.byId.get(e.target); if (!seen(tg)) return; const p = new V3(e.x, e.z, -e.y);
      const cls = tg && tg.sp ? tg.sp.armor : 'heavy', metal = cls !== 'infantry';
      fx.impact(p, e.uid && e.uid[0] === 'T' && e.kind === 'hitscan' ? 'pulse' : e.kind, false, e.kind === 'shell' ? (BIG_GUN[e.uid] ? 1.6 : 1.2) : e.kind === 'missile' ? 1 : 0.5);
      if (e.kind !== 'hitscan') { this.flashLight(e.x, e.y, e.z + 0.5, e.kind === 'shell' ? 700 : 500, 0.12); this.sfx(e.kind === 'shell' ? 'impact_metal' : 'explosion_small', e.x, e.y); if (BIG_GUN[e.uid]) this.shake(0.08, e.x, e.y); }
      else if (Math.random() < 0.6) this.sfx(metal ? 'impact_metal' : 'impact_small', e.x, e.y, { vol: 0.5 });
      if (e.kind === 'shell' && metal && tg && !tg.isBuilding) this.spall(p, 6);
      return;
    }
    if (e.type === 'miss') { const p = new V3(e.x, e.z, -e.y); fx.impact(p, 'shell', !!e.water, 1); if (!e.water) this.groundBurst(p, 0.8); this.sfx(e.water ? 'impact_water' : 'impact_dirt', e.x, e.y); return; }
    if (e.type === 'proj_end') { fx.impact(new V3(e.x, e.z, -e.y), 'pulse', false, 0.4); return; }
    if (e.type === 'explosion') { const p = new V3(e.x, e.z, -e.y); fx.explosion(p, e.r, !!e.water); if (!e.water) this.groundBurst(p, 1.6); this.flashLight(e.x, e.y, e.z + 2, 2600, 0.25); this.shake(0.35, e.x, e.y); this.scorch(e.x, e.y, e.r * 0.9); this.sfx('explosion_large', e.x, e.y); return; }
    if (e.type === 'bomb') { fx.ring(e.x, -e.y, this.T.surface(e.x, e.y), e.r, e.r, 0.8, 0xff5040, { a: 0.6, ease: false }); this.sfx('bomb_drop', e.x, e.y); return; }
    if (e.type === 'emp' && e.applied) { const tg = w.byId.get(e.target); fx.ring(e.x, -e.y, tg ? tg.z + 0.5 : 0.5, 0.5, 9, 0.6, 0x6fe6d4, { a: 0.9, add: true }); this.sfx('emp', e.x, e.y); return; }
    if (e.type === 'emp_wind' && view) { const p = view.sock('muzzle'); fx.spark(p.x, p.y, p.z, { life: 0.3, s0: 0.3, s1: 1.4, c0: [0.5, 1, 1] }); return; }
    if (e.type === 'scan') { fx.ring(e.x, -e.y, this.T.surface(e.x, e.y), 1, e.r, 0.6, 0x6fe6d4, { a: 0.9, add: true }); fx.ring(e.x, -e.y, this.T.surface(e.x, e.y), e.r, e.r, e.dur, 0x6fe6d4, { a: 0.18, disc: true, ease: false }); return; }
    if (e.type === 'deploy' && view && e.state === 'deploying') { this.sfx(view.u.uid === 'A01' ? 'shield_deploy' : 'deploy', view.u.x, view.u.y); return; }
    if (e.type === 'harvest_load' && view && seen(view.u)) { this.sfx('harvest_load', view.u.x, view.u.y); return; }
    if (e.type === 'harvest_unload' && view && seen(view.u)) { this.sfx('harvest_unload', view.u.x, view.u.y); return; }
    if (e.type === 'takeoff' && view) { this.sfx('jet_pass', view.u.x, view.u.y, { vol: 0.6 }); return; }
    if (e.type === 'damage') { this.onDamage(e); return; }
    if (e.type === 'death') {
      if (e.building) { const sv = this.structs.get(e.id); if (sv) this.destroyStruct(sv); return; }
      if (view) this.onUnitDeath(view, e); return;
    }
    if (e.type === 'remove') { const v = this.views.get(e.id); if (v) { v.dispose(); this.views.delete(e.id); this.snap.delete(e.id); } }
  }
  // hit reactions: a damped spring kick on the hull / a flinch for infantry / a quick warm flash on the materials
  onDamage(e) {
    const w = this.world, o = w.byId.get(e.id); if (!o) return; const src = e.src != null ? w.byId.get(e.src) : null;
    const frac = clamp(e.amt / (o.maxHp || 1), 0, 1); const dir = src ? Math.atan2(o.y - src.y, o.x - src.x) : Math.random() * 6.28;
    if (o.isBuilding) { const sv = this.structs.get(o.id); if (sv) { sv.hit = { t: this.simTime, amp: clamp(frac * 6, 0.15, 1), dir }; if (frac > 0.02) this.sfx('debris', o.x, o.y, { vol: 0.5 }); } return; }
    const v = this.views.get(o.id); if (!v) return;
    const amp = o.kind === 'foot' ? clamp(0.4 + frac * 3, 0.4, 1) : clamp(frac * 5, 0.15, 1);
    v.hit = { t: this.simTime, amp, dir }; v.flash = Math.max(v.flash, 0.6 + 0.4 * amp); this.stats.hitReactions++;
  }
  onUnitDeath(view, e) {
    const u = view.u, fx = this.fx, p = view.group.position.clone(); if (!this.visibleTo(u)) return;
    if (u.kind === 'foot') { this.sfx('impact_small', u.x, u.y, { vol: 0.6 }); return; }
    const big = u.kind === 'ship' ? 1.6 : u.kind === 'drone' ? 0.35 : u.kind === 'tracked' || u.kind === 'hover' ? 1 : 0.8;
    fx.explosion(p.clone().add(new V3(0, u.kind === 'ship' ? 2 : 1, 0)), u.kind === 'ship' ? 6 : u.kind === 'drone' ? 1.5 : 4, u.kind === 'ship');
    this.flashLight(u.x, u.y, u.z + 2, 3200 * big, 0.3); this.shake(0.3 * big, u.x, u.y);
    this.sfx(big >= 1 ? 'explosion_large' : 'explosion_small', u.x, u.y);
    if (u.kind === 'tracked' || u.kind === 'hover') {
      this.scorch(u.x, u.y, 4.5); this.burst(p, 10, ['metal', 'hot', 'dark'], 9, 1);
      // the turret comes off (ammunition cook-off): detach it from the model and let it fly
      const tur = view.N.turret; if (tur && u.uid !== 'HV' && Math.random() < 0.85) {
        this.scene.attach(tur); const a = e.dir + rnd(-0.8, 0.8), s = rnd(1.5, 4);
        this.debris.push({ o: tur, v: new V3(Math.cos(a) * s, rnd(7, 11), -Math.sin(a) * s), w: new V3(rnd(-3, 3), rnd(-4, 4), rnd(-3, 3)), t: 0, life: (u.m.fade || 12) + 1, r: 0.9, rest: false, smoke: 4, keep: true, mats: view.allMats });
        view.tossed = tur; this.stats.tossed++;
      }
    } else if (u.kind === 'heli' || u.kind === 'jet') this.burst(p, 8, ['metal', 'hot'], 7, 0.8);
    else if (u.kind === 'ship') this.burst(p.clone().add(new V3(0, 2, 0)), 12, ['metal', 'hot', 'dark'], 8, 1.2);
  }
  // debris helpers
  burst(p, n, mats, speed, size = 1, opts = {}) {
    for (let k = 0; k < n; k++) {
      if (this.debris.length > 220) { const old = this.debris.find((d) => !d.keep); if (old) { this.scene.remove(old.o); this.debris.splice(this.debris.indexOf(old), 1); } }
      const m = new THREE.Mesh(DEBRIS_GEO[(Math.random() * DEBRIS_GEO.length) | 0], DEBRIS_MAT[mats[(Math.random() * mats.length) | 0]]); m.castShadow = true;
      const sc = size * rnd(0.6, 1.5); m.scale.setScalar(sc); m.position.copy(p).add(new V3(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)));
      const a = Math.random() * 6.283, s = speed * rnd(0.3, 1);
      this.scene.add(m); this.debris.push({ o: m, v: new V3(Math.cos(a) * s, rnd(3, 1.4 * speed), Math.sin(a) * s), w: new V3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), t: 0, life: opts.life || rnd(5, 9), r: 0.15 * sc, rest: false, smoke: Math.random() < 0.3 ? 1.5 : 0 });
      this.stats.debris++;
    }
  }
  spall(p, n) { for (let k = 0; k < n; k++) this.fx.spark(p.x, p.y, p.z, { vx: rnd(-6, 6), vy: rnd(1, 8), vz: rnd(-6, 6), g: 14, life: rnd(0.25, 0.5), s0: 0.22, s1: 0.06, c0: [1, 0.85, 0.5] }); }
  groundBurst(p, k) {   // dirt thrown up by a ground hit
    for (let i = 0; i < 8 * k; i++) this.fx.puff(p.x + rnd(-0.5, 0.5), p.y, p.z + rnd(-0.5, 0.5), { vx: rnd(-2, 2) * k, vy: rnd(4, 9) * k, vz: rnd(-2, 2) * k, g: 9.8, life: rnd(0.8, 1.3), s0: 0.5 * k, s1: 1.8 * k, a0: 0.5, c0: [0.42, 0.36, 0.28], floor: p.y });
  }
  scorch(x, y, r) { const g = Math.max(this.T.height(x, y), 0.02); const m = this.fx.ring(x, -y, g + 0.05, r, r, 30, 0x1a130c, { a: 0.32, disc: true, ease: false }); m.renderOrder = 2; }

  // ───────────── structures ─────────────
  addStructView(b) {
    if (this.structs.has(b.id)) return; const S = STRUCTURES[b.kind]; if (!S) return;
    let model;
    if (b.kind === 'airpad') model = buildAirpad(b);
    else if (b.kind === 'naval') model = buildNavalYard(this.bprotos, b);
    else { const p = this.bprotos[S.model]; model = p ? p.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(b.w, S.h, b.d).translate(0, S.h / 2, 0), new THREE.MeshStandardMaterial({ color: 0x999999 })); }
    const g = new THREE.Group(); const lift = new THREE.Group(); g.add(lift); lift.add(model);
    const mats = []; const team = TEAM_COLORS[b.team % 4];
    model.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
      o.material = [].concat(o.material).map((m) => { const c = m.clone(); if (/^TEAM/i.test(m.name || '')) c.color = team.clone(); if (c.emissive) c.userData.e0 = c.emissive.clone(); if (c.color) c.userData.c0 = c.color.clone(); mats.push(c); return c; });
      if (o.material.length === 1) o.material = o.material[0]; });
    g.position.set(b.x, b.z, -b.y); g.rotation.y = b.rot; this.scene.add(g);
    // team marker: a slim pole with a pennant at a back corner, so ownership reads at a glance
    const flag = teamFlag(team); flag.position.set(S.size[0] / 2 - 1.5, b.kind === 'naval' ? 3 : 0, -(S.size[1] / 2 - 1.5)); lift.add(flag);   // model-local corner (the group carries the rotation)
    const sv = { b, g, lift, mats, born: b.born || 0, rise: b.born > 0 ? 0 : 1, hit: null, dead: false, smokeAcc: 0, h: S.h };
    this.structs.set(b.id, sv);
    if (b.born > 0) { this.sfx('place_building', b.x, b.y); this.sfx('building_rise', b.x, b.y, { vol: 0.6 }); this.stats.structsBuilt++;
      for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, rx = Math.cos(a) * b.w * 0.55, ry = Math.sin(a) * b.d * 0.55; this.fx.puff(b.x + rx, b.z + 0.3, -(b.y + ry), { vx: Math.cos(a) * 3, vy: 0.8, vz: -Math.sin(a) * 3, drag: 1.4, life: 2.2, s0: 1.5, s1: 5, a0: 0.35, c0: [0.62, 0.57, 0.48] }); } }
    return sv;
  }
  destroyStruct(sv) {
    if (sv.dead) return; sv.dead = true; sv.deathT = this.simTime; const b = sv.b, fx = this.fx;
    sv.booms = []; const n = 4 + Math.round(b.w * b.d / 300); for (let k = 0; k < n; k++) sv.booms.push({ t: this.simTime + k * rnd(0.12, 0.3), x: b.x + rnd(-0.4, 0.4) * b.w, y: b.y + rnd(-0.4, 0.4) * b.d });
    fx.explosion(new V3(b.x, b.z + sv.h * 0.5, -b.y), 10, false); this.flashLight(b.x, b.y, b.z + sv.h, 5000, 0.4); this.shake(0.7, b.x, b.y);
    this.burst(new V3(b.x, b.z + sv.h * 0.6, -b.y), 26, ['concrete', 'dark', 'metal', 'hot'], 12, 1.8, { life: 14 });
    this.scorch(b.x, b.y, Math.max(b.w, b.d) * 0.7); this.sfx('explosion_building', b.x, b.y);
    for (const m of sv.mats) if (m.color) m.color.multiplyScalar(0.32);
  }

  // ───────────── per presentation frame ─────────────
  /** alpha: interpolation fraction between the last two ticks; rdt: game seconds this frame; dt: real seconds */
  frame(dt, alpha, rdt) {
    const w = this.world, cam = this.camera; this.alpha = alpha; this.simTime = w.t - (1 - alpha) * (1 / 30);
    cam.updateMatrixWorld(); this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.lodUpdate();
    for (const [id, v] of this.views) {
      const s = this.snap.get(id); if (!s) continue; const u = v.u;
      const show = !s.cur.hidden && (this.visibleTo(u) || (!u.alive && v.wasSeen)); v.group.visible = show; if (show && u.alive) v.wasSeen = true; else if (u.alive) v.wasSeen = false;
      if (!show && u.alive) continue;
      const S = interp(s.prev, s.cur, alpha);
      v.update(S, rdt); this.reaction(v, rdt);
    }
    this.repairFx(rdt);
    for (const [, v] of this.projV) {
      const a = v.prev, b = v.cur; const x = lerp(a[0], b[0], alpha), y = lerp(a[1], b[1], alpha), z = lerp(a[2], b[2], alpha);
      const pos = new V3(x, z, -y); const age = this.simTime - v.born; if (v.off && age < 0.15 && age > 0) pos.add(v.off.clone().multiplyScalar(1 - age / 0.15));
      const dir = new V3(b[0] - a[0], b[2] - a[2], -(b[1] - a[1])); if (dir.lengthSq() > 1e-6) v.mesh.quaternion.setFromUnitVectors(new V3(0, 0, 1), dir.normalize());
      v.mesh.position.copy(pos); if (!v.mesh.visible) continue;
      if (v.kind === 'missile') { v.trailAcc += rdt * 40; while (v.trailAcc > 1) { v.trailAcc -= 1; this.fx.trail(pos, v.cyan ? 'cyan' : 'smoke'); } }
      if (v.kind === 'shell' && Math.random() < 0.6) this.fx.spark(pos.x, pos.y, pos.z, { life: v.cyan ? 0.12 : 0.06, s0: BIG_GUN[v.p.uid] ? 0.8 : 0.35, s1: 0.1, c0: v.cyan ? [0.5, 1, 1] : [1, 0.8, 0.45] });
    }
    this.structFrame(rdt); this.debrisFrame(rdt);
    for (const l of this.lights) { const u = l.userData, t = (this.simTime - u.t0) / u.dur; l.intensity = t >= 0 && t < 1 ? u.peak * (1 - t) * (1 - t) : 0; }
    this.fx.update(rdt, cam);
    // camera shake: trauma² × smooth noise, decays ~1.6/s (real time so it feels the same at any game speed)
    this.trauma = Math.max(0, this.trauma - dt * 1.6); const s = this.trauma * this.trauma, T = performance.now() / 1000;
    this.shakeOff.set(Math.sin(T * 41.3) + Math.sin(T * 23.1) * 0.5, Math.sin(T * 37.7 + 1.3) * 0.6, Math.sin(T * 29.9 + 2.1) + Math.sin(T * 17.3) * 0.5).multiplyScalar(s * 1.6 * (1 + (this.viewH || 150) / 300));
  }
  reaction(v, dt) {
    if (v.flash > 0.01) { v.flash *= Math.exp(-dt * 22); for (const m of v.flashMats) { const e0 = m.userData.e0; m.emissive.setRGB(e0.r + v.flash * 0.55, e0.g + v.flash * 0.42, e0.b + v.flash * 0.3); } }
    else if (v.flash) { v.flash = 0; for (const m of v.flashMats) m.emissive.copy(m.userData.e0); }
    const h = v.hit; if (!h || v.dead) return; const t = this.simTime - h.t; if (t > 1.2) { v.hit = null; return; }
    const u = v.u, k = u.kind; const hx = Math.cos(h.dir), hy = Math.sin(h.dir);   // hit travels along (hx, hy) in sim axes
    if (k === 'foot') {   // flinch: torso snaps back from the hit and recovers in ~0.3 s
      const a = h.amp * 0.22 * Math.exp(-t * 11) * Math.sin(Math.min(t * 18, Math.PI / 2) + 0.3);
      v.group.rotateOnWorldAxis(new V3(-hy, 0, -hx).normalize(), a); v.group.position.x += hx * a * 0.25; v.group.position.z -= hy * a * 0.25; return;
    }
    // vehicles, ships, aircraft: under-damped spring on hull attitude + a small shove (heavier / bigger = slower, smaller)
    const f = k === 'ship' ? 1.1 : k === 'tracked' ? 3.6 : 4.4, z = k === 'ship' ? 1.6 : 5.5, A = (k === 'ship' ? 0.035 : k === 'tracked' ? 0.05 : 0.07) * h.amp;
    const s = A * Math.exp(-t * z) * Math.sin(t * f * 6.283);
    const hd = u.hdg; const along = hx * Math.cos(hd) + hy * Math.sin(hd), side = -hx * Math.sin(hd) + hy * Math.cos(hd);
    v.tilt.rotation.x += -along * s; v.tilt.rotation.z += side * s;   // nose kicks up from a frontal hit; rolls away from a side hit
    const sh = 0.18 * h.amp * Math.exp(-t * 9); v.group.position.x += hx * sh; v.group.position.z -= hy * sh;
  }
  structFrame(dt) {
    const t = this.simTime;
    for (const [id, sv] of this.structs) {
      const b = sv.b;
      if (sv.rise < 1) {   // construction: the building rises out of its foundation in 2 game s, with dust at the base
        sv.rise = clamp((t - sv.born) / 2.0, 0, 1); const e = 1 - Math.pow(1 - sv.rise, 3);
        sv.lift.scale.set(1, Math.max(0.02, e), 1); sv.lift.position.y = -(1 - e) * 0.4;
        if (Math.random() < dt * 30) { const a = Math.random() * 6.283; const [x, y] = toWorld(b, Math.cos(a) * b.w * 0.5, Math.sin(a) * b.d * 0.5); this.fx.puff(x, b.z + 0.4, -y, { vx: rnd(-1, 1), vy: 1.2, vz: rnd(-1, 1), drag: 1, life: 1.6, s0: 1, s1: 3.5, a0: 0.3, c0: [0.6, 0.56, 0.48] }); }
        if (Math.random() < dt * 16) this.fx.spark(b.x + rnd(-0.4, 0.4) * b.w, b.z + sv.h * e, -(b.y + rnd(-0.4, 0.4) * b.d), { life: 0.15, s0: 0.5, s1: 0.1, c0: [1, 0.85, 0.5] });   // welding sparks on the rising edge
      }
      if (sv.hit) { const ht = t - sv.hit.t; if (ht > 0.5) sv.hit = null; else { const a = 0.06 * sv.hit.amp * Math.exp(-ht * 12) * Math.sin(ht * 50); sv.lift.position.x = a * Math.cos(sv.hit.dir); sv.lift.position.z = -a * Math.sin(sv.hit.dir); } }
      if (!sv.dead) {
        const f = b.hp / b.maxHp; if (f < 0.55) { sv.smokeAcc += dt * (f < 0.25 ? 9 : 4); while (sv.smokeAcc > 1) { sv.smokeAcc -= 1; const [x, y] = toWorld(b, rnd(-0.3, 0.3) * b.w, rnd(-0.3, 0.3) * b.d);
          this.fx.smokeColumn(new V3(x, b.z + sv.h * 0.8, -y), 1, true); if (f < 0.25) this.fx.spark(x, b.z + sv.h * 0.7, -y, { vy: 2.5, life: 0.5, s0: 1.6, s1: 0.6, c0: [1, 0.55, 0.15], c1: [0.6, 0.15, 0.05] }); } }
        continue;
      }
      // destruction: chained explosions, the shell sinks and tilts into its foundation, then the rubble smoulders and goes
      const d = t - sv.deathT;
      for (const bm of sv.booms) if (!bm.done && t >= bm.t) { bm.done = true; this.fx.explosion(new V3(bm.x, b.z + rnd(1, sv.h), -bm.y), rnd(4, 8), false); this.flashLight(bm.x, bm.y, b.z + sv.h * 0.6, 2200, 0.2); this.shake(0.25, bm.x, bm.y); this.sfx('explosion_large', bm.x, bm.y, { vol: 0.7 }); this.burst(new V3(bm.x, b.z + sv.h * 0.5, -bm.y), 5, ['concrete', 'dark', 'hot'], 9, 1.3); }
      const k = smooth(d / 2.4); sv.lift.scale.y = Math.max(0.22, 1 - 0.7 * k); sv.lift.rotation.z = 0.05 * k; sv.lift.rotation.x = -0.03 * k;
      if (d < 18 && Math.random() < dt * 5) { const [x, y] = toWorld(b, rnd(-0.35, 0.35) * b.w, rnd(-0.35, 0.35) * b.d); this.fx.smokeColumn(new V3(x, b.z + sv.h * 0.3, -y), 1, true); }
      if (d > 26) { sv.lift.position.y = -(d - 26) * 0.6; if (d > 34) { this.scene.remove(sv.g); this.structs.delete(id); } }
    }
  }
  debrisFrame(dt) {
    const T = this.T, keep = [];
    for (const d of this.debris) {
      d.t += dt; if (d.t > d.life) { this.scene.remove(d.o); continue; } keep.push(d);
      const o = d.o;
      if (!d.rest) {
        d.v.y -= 9.81 * dt; o.position.addScaledVector(d.v, dt);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.w.x * dt, d.w.y * dt, d.w.z * dt)); o.quaternion.premultiply(q);
        const gx = o.position.x, gy = -o.position.z, g = Math.max(T.height(gx, gy), 0) + d.r;
        if (o.position.y < g) {   // bounce: restitution 0.3, ground friction, spin damping; settles below 0.6 m/s
          o.position.y = g; if (T.height(gx, gy) < 0) { d.rest = true; d.sink = true; this.fx.impact(o.position.clone(), 'shell', true, 0.4); continue; }
          if (Math.abs(d.v.y) > 2) { this.fx.puff(gx, g, -gy, { vx: 0, vy: 0.5, vz: 0, drag: 1, life: 1, s0: 0.4, s1: 1.6, a0: 0.3, c0: [0.5, 0.45, 0.37] }); if (d.keep && Math.abs(d.v.y) > 4) { this.sfx('debris', gx, gy); this.shake(0.06, gx, gy); } }
          d.v.y = -d.v.y * 0.3; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.5);
          if (d.v.length() < 0.6) d.rest = true;
        }
        if (d.smoke > 0 && d.t < d.smoke && Math.random() < dt * 20) this.fx.puff(o.position.x, o.position.y, o.position.z, { vx: 0, vy: 0.6, vz: 0, drag: 0.6, life: 1.2, s0: 0.3, s1: 1.6, a0: 0.3, c0: [0.2, 0.19, 0.18] });
      } else if (d.sink) o.position.y -= dt * 0.8;
      if (!d.keep && d.t > d.life - 1.5) o.scale.multiplyScalar(Math.max(0.2, 1 - dt * 1.5));
    }
    this.debris = keep;
  }
  /** structures under repair: welding sparks on the roof and a tool clank about once a second (paused while out of funds) */
  repairFx(dt) {
    if (!(dt > 0)) return;
    for (const [, sv] of this.structs) { const b = sv.b; if (!b.alive || !b.repairing || b.repairStalled) continue; if (!this.world.visible(this.playerTeam, b) && b.team !== this.playerTeam) continue;
      sv.repAcc = (sv.repAcc || 0) + dt * 5; sv.clank = (sv.clank || 0) + dt;
      while (sv.repAcc > 1) { sv.repAcc -= 1; const x = b.x + (Math.random() - 0.5) * b.w * 0.7, y = b.y + (Math.random() - 0.5) * b.d * 0.7, z = b.z + sv.h * (0.55 + Math.random() * 0.4);
        for (let k = 0; k < 5; k++) this.fx.spark(x, z, -y, { vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.25 + Math.random() * 0.25, s0: 0.35, s1: 0.05, g: 9.8, c0: [1, 0.85, 0.5] }); }
      if (sv.clank > 1.1) { sv.clank = 0; this.sfx('impact_metal', b.x, b.y, { vol: 0.35, pitch: 1.3 }); } }
  }
  // distant-view level by on-screen size (pixels the unit's largest dimension covers), ±12 % hysteresis
  lodUpdate() {
    const cam = this.camera, k = innerHeight / (2 * Math.tan(cam.fov * Math.PI / 360)), st = this.lodStats = [0, 0, 0]; let sw = 0; const LP = [110, 36];
    for (const v of this.views.values()) {
      if (!v.lodMeshes || !v.lodMeshes.length) continue; let lv;
      if (this.forceLod != null) lv = this.forceLod;
      else { const d = Math.max(1, cam.position.distanceTo(v.group.position)), px = v.lodSize * k / d, cur = v.lod; lv = px > LP[0] ? 0 : px > LP[1] ? 1 : 2;
        if (lv < cur && px < LP[lv] * 1.12) lv = cur; if (lv > cur && px > LP[cur] * 0.88) lv = cur; }
      if (lv !== v.lod) { v.setLod(lv); sw++; } st[v.lod]++;
    }
    this.lodSwitches += sw;
  }
}

/** drawn size for a unit at the readability setting s. Infantry get the full factor; vehicles and aircraft 70 % of it
 * (1.75 → 1.53×) so parked columns don't merge, tapering off between 8 m and 20 m long so ships and other big hulls
 * stay near true size (they read well already and would crowd the docks) */
export function visScale(u, s) {
  if (u.kind === 'foot') return s;
  const L = Math.max(u.sp.dimensions_m.length, u.sp.dimensions_m.width); const k = 0.7 * Math.max(0, Math.min(1, (20 - L) / 12));
  return 1 + (s - 1) * k;
}
export function muzzleNames(u, e) {
  if (u.uid === 'H04') return [e.muzzle === 0 ? 'muzzle_L' : 'muzzle_R', 'muzzle'];
  if (u.uid === 'A05') return e.sys === 1 ? ['muzzle_aa'] : ['muzzle_cell_' + e.muzzle, 'muzzle_cell_0'];
  if (u.uid === 'T05') return [e.muzzle === 0 ? 'muzzle_L' : 'muzzle_R'];
  if (u.uid === 'A06') return ['muzzle_' + ((e.muzzle || 0) % 2), 'muzzle_0'];   // twin coil-laser emitters
  return ['muzzle'];
}

function teamFlag(color) {
  const g = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.4 })); pole.position.y = 3.5; pole.castShadow = true; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, emissive: color, emissiveIntensity: 0.15 })); cloth.position.set(1.15, 6.25, 0); g.add(cloth); return g;
}
// procedural airpad (no maps asset): concrete pad with a painted landing circle, edge lights, a control hut and a fuel bowser
function buildAirpad(b) {
  const g = new THREE.Group(), S = 26; const conc = new THREE.MeshStandardMaterial({ color: 0x8e8c86, roughness: 0.92 }), paint = new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.8 }), dark = new THREE.MeshStandardMaterial({ color: 0x3e4247, roughness: 0.6, metalness: 0.4 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(S, 0.5, S), conc); pad.position.y = 0.25; pad.receiveShadow = true; g.add(pad);
  const ring = new THREE.Mesh(new THREE.RingGeometry(8.2, 9, 48).rotateX(-Math.PI / 2), paint); ring.position.y = 0.52; g.add(ring);
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 6), paint); h1.position.set(-1.8, 0.52, 0); g.add(h1); const h2 = h1.clone(); h2.position.x = 1.8; g.add(h2); const h3 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 0.9), paint); h3.position.y = 0.52; g.add(h3);
  const lampM = new THREE.MeshStandardMaterial({ color: 0x223322, emissive: 0x46ff8a, emissiveIntensity: 2 });
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283; const l = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 6), lampM); l.position.set(Math.cos(a) * 11.5, 0.65, Math.sin(a) * 11.5); g.add(l); }
  const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.7, name: 'TEAM_trim' })); hut.position.set(S / 2 - 2.5, 1.5 + 0.5, S / 2 - 2); hut.castShadow = true; g.add(hut);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.3, 3.3), dark); roof.position.set(S / 2 - 2.5, 3.65, S / 2 - 2); g.add(roof);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9c2a8, roughness: 0.5, metalness: 0.3 })); tank.position.set(-S / 2 + 3, 1.6, S / 2 - 2); tank.castShadow = true; g.add(tank);
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; }); g.rotation.x = 0; return g;
}
// naval yard: the map's pier is already there (scenery); the yard adds a slewing crane, a harbour-master tower and berth
// lights on the deck (pier-local frame: x along the pier, −y toward open water, deck 3 m above the water)
function buildNavalYard(P, b) {
  const g = new THREE.Group(), deck = 3 - b.z; const steel = new THREE.MeshStandardMaterial({ color: 0xd8a23a, roughness: 0.55, metalness: 0.4 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.5 });
  const team = new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.6, name: 'TEAM_trim' }), wall = new THREE.MeshStandardMaterial({ color: 0xb9bcbc, roughness: 0.8 }), glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.2, metalness: 0.6, emissive: 0x0a1a24 });
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, deck + z, -y); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // slewing jib crane on the berth side
  add(new THREE.CylinderGeometry(2.2, 2.6, 1.2, 16), dark, 18, -12, 0.6); add(new THREE.BoxGeometry(2.2, 14, 2.2), steel, 18, -12, 7.6);
  const cab = add(new THREE.BoxGeometry(4.5, 3, 4), team, 18, -12, 15.5); void cab;
  const jib = add(new THREE.BoxGeometry(1.2, 1.2, 24), steel, 18, -12 - 10, 16.6); jib.rotation.x = -0.18;
  add(new THREE.BoxGeometry(3, 2.4, 3.5), dark, 18, -12 + 4, 15.2);   // counterweight
  add(new THREE.CylinderGeometry(0.05, 0.05, 12, 4), dark, 18, -33, 10.5);   // hoist line
  // harbour-master tower at the shore end
  add(new THREE.BoxGeometry(7, 9, 7), wall, -30, 12, 4.5); add(new THREE.BoxGeometry(8, 3, 8), glass, -30, 12, 10.5); add(new THREE.BoxGeometry(8.6, 0.5, 8.6), team, -30, 12, 12.25);
  add(new THREE.CylinderGeometry(0.08, 0.08, 6, 4), dark, -30, 12, 15.5);
  // berth lights along the seaward edge
  const lampM = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffc070, emissiveIntensity: 2.2 });
  for (let x = -36; x <= 36; x += 12) add(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 6), lampM, x, -19, 0.3);
  void P; return g;
}
