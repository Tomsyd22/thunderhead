// Unit views: every visual motion is driven from interpolated simulation state (positions, headings, turret
// angles, track/stride distances) plus timed events (fire, charge, deploy, death). Nothing here changes gameplay.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MECH } from './mech.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const D2R = Math.PI / 180;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _q = new Q(), _q2 = new Q(), _m = new THREE.Matrix4();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerpA = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
export const TEAM_COLORS = [new THREE.Color(0x3d8bff), new THREE.Color(0xff4a3d), new THREE.Color(0x52d273), new THREE.Color(0xffc23d)];

// ───────── generic helpers ─────────
function findAll(root) { const m = {}; root.traverse((o) => { if (o.name && !m[o.name]) m[o.name] = o; }); return m; }
// world-space helpers that read matrixWorld directly (kept current by updating each modified bone's subtree), instead of
// getWorldPosition/Quaternion which re-walk the parent chain on every call
const _p = new V3(), _s = new V3();
function wpos(o, v = new V3()) { return v.setFromMatrixPosition(o.matrixWorld); }
function wquat(o, q = new Q()) { o.matrixWorld.decompose(_p, q, _s); return q; }
function setWorldQuat(o, qw) { wquat(o.parent, _q2); o.quaternion.copy(_q2.invert().multiply(qw)); o.updateMatrixWorld(true); }
function rotateWorld(o, qd) { wquat(o, _q); setWorldQuat(o, qd.clone().multiply(_q)); }
/** two-bone IK: rotate `up` and `lo` so that the end joint `end` reaches `target`; the middle joint bends toward `pole` */
function ik2(up, lo, end, target, pole, stretch = 0.0) {
  const a = wpos(up), b = wpos(lo), c = wpos(end);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c); const t = target.clone().sub(a); let d = t.length();
  const dmax = (l1 + l2) * (0.999 + stretch); if (d > dmax) { t.setLength(dmax); d = dmax; } d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const dir = t.clone().normalize(); const pv = pole.clone().sub(a); const pn = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const bNew = a.clone().add(dir.clone().multiplyScalar(cosA * l1)).add(pn.multiplyScalar(sinA * l1));
  rotateWorld(up, new Q().setFromUnitVectors(b.clone().sub(a).normalize(), bNew.clone().sub(a).normalize()));
  const b2 = wpos(lo), c2 = wpos(end);
  rotateWorld(lo, new Q().setFromUnitVectors(c2.clone().sub(b2).normalize(), a.clone().add(t).sub(b2).normalize()));
}

// shared per-team materials (TEAM tint) and per-instance clones for animated materials
function prepareMaterials(root, team, opts = {}) {
  const per = {}; root.traverse((o) => {
    if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (!m) return m; const n = m.name || '';
      if (n === 'TEAM') { const k = 'TEAM'; if (!per[k]) { per[k] = m.clone(); per[k].color = TEAM_COLORS[team % 4].clone().lerp(new THREE.Color(1, 1, 1), 0.15); } return per[k]; }
      if (n.startsWith('TRACK') || n.startsWith('GLOW') || n.startsWith('DISC') || opts.fade) {
        if (!per[n]) { per[n] = m.clone(); if (m.map && n.startsWith('TRACK')) { per[n].map = m.map.clone(); per[n].map.wrapS = per[n].map.wrapT = THREE.RepeatWrapping; per[n].map.needsUpdate = true; } }
        if (n.startsWith('DISC')) { per[n].transparent = true; per[n].depthWrite = false; per[n].side = THREE.DoubleSide; }
        return per[n];
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    if (mats.every((m) => m && /^(DISC|GLOW)/.test(m.name || ''))) o.castShadow = false;   // rotor discs and pure glow parts cast no shadow
  });
  return per;
}

class BaseView {
  constructor(app, u, proto) {
    this.app = app; this.u = u; this.uid = u.uid; this.m = MECH[u.uid]; this.id = u.id;
    this.group = new THREE.Group(); this.tilt = new THREE.Group(); this.group.add(this.tilt);
    this.model = proto.isSkinned ? SkeletonUtils.clone(proto.scene) : proto.scene.clone(true); this.tilt.add(this.model);
    this.N = findAll(this.model); this.mats = prepareMaterials(this.model, u.team, { fade: true });
    app.scene.add(this.group); this.t = 0; this.events = []; this.dead = false; this.fade = 1;
    this.fireT = -9; this.lastShot = null; this.pitchV = 0; this.rollV = 0; this.bob = Math.random() * 10;
    this.allMats = []; this.model.traverse((o) => { if (o.isMesh) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (!this.allMats.includes(m)) this.allMats.push(m); });
    // distant-view levels: the LOD GLBs share this model's node tree and material names, so each mesh just swaps geometry
    // (materials, bones, sockets and animation stay on the LOD0 objects)
    this.lod = 0; this.lodMeshes = []; const sz = u.sp.dimensions_m; this.lodSize = Math.max(sz.length, sz.width, sz.height);
    if (proto.lods && proto.lods.length) {
      const key = (o) => `${o.parent ? o.parent.name : ''}/${o.name.replace(/_\d+$/, '')}/${(Array.isArray(o.material) ? o.material[0] : o.material)?.name || ''}`;
      const index = (root) => { const mp = new Map(); root.traverse((o) => { if (o.isMesh) { const k = key(o); (mp.get(k) || mp.set(k, []).get(k)).push(o.geometry); } }); return mp; };
      const L = proto.lods.map(index), seen = new Map();
      this.model.traverse((o) => { if (!o.isMesh) return; const k = key(o), i = seen.get(k) || 0; seen.set(k, i + 1); this.lodMeshes.push({ o, g: [o.geometry, ...L.map((m) => (m.get(k) || [])[i] || null)] }); });
    }
    for (const m of this.allMats) m.userData.baseOpacity = m.opacity;
  }
  setLod(l) { for (const m of this.lodMeshes) { const g = m.g[l] || m.g[l - 1] || m.g[0]; if (m.o.geometry !== g) m.o.geometry = g; } this.lod = l; }
  sock(name, v = new V3()) { const n = this.N[name]; return n ? n.getWorldPosition(v) : this.group.getWorldPosition(v); }
  dirOf(name, v = new V3()) { const n = this.N[name]; if (!n) return v.set(0, 0, -1).applyQuaternion(this.group.quaternion); n.getWorldQuaternion(_q); return v.set(0, 0, -1).applyQuaternion(_q); }
  place(S) { this.group.position.set(S.x, S.z, -S.y); this.group.rotation.set(0, S.hdg - Math.PI / 2, 0); }
  setOpacity(a) { for (const m of this.allMats) { m.transparent = a < 1 || m.userData.baseOpacity < 1 || (m.name || '').startsWith('DISC'); m.opacity = m.userData.baseOpacity * a; m.depthWrite = a > 0.5 && !(m.name || '').startsWith('DISC'); } }
  dispose() { this.app.scene.remove(this.group); }
  onEvent(e) {}
  update(S, dt) {}
}

// ───────── infantry: procedural IK gait, aim, recoil, deploy, death ─────────
export class InfantryView extends BaseView {
  constructor(app, u, proto) {
    super(app, u, proto);
    this.bones = {}; this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.rest = {}; for (const [n, b] of Object.entries(this.bones)) this.rest[n] = { q: b.quaternion.clone(), p: b.position.clone() };
    this.weapon = this.N.weapon; this.wRest = this.weapon ? { p: this.weapon.position.clone(), q: this.weapon.quaternion.clone() } : null;
    const ex = (this.N.root && this.N.root.userData) || {}; this.J = ex.joints ? (typeof ex.joints === 'string' ? JSON.parse(ex.joints) : ex.joints) : null;
    this.loop = ex.run_loop_s || this.m.run || 0.8; this.cycle = u.sp.speed_mps * this.loop;     // metres per gait cycle at spec speed
    this.aimW = 0; this.kneel = 0; this.gaitW = 0; this.phase = Math.random(); this.C = 1; this.duty = 0.5; this.lastStride = null; this.reloadT = -9; this.empT = -9; this.chargeT = -9;
    this.deployT = -9; this.deployState = 'mobile'; this.lockT = -9; this.enterT = -9; this.lookYaw = 0;
    this.launcher = u.uid === 'H02' || u.uid === 'A02'; this.lance = u.uid === 'T02';
    if (this.N.shield) this.N.shield.visible = false; if (this.N.tripod) this.N.tripod.visible = false;
    this.feet = { R: null, L: null }; this.footWorld = { R: new V3(), L: new V3() }; this.lock = { R: { on: false, p: new V3() }, L: { on: false, p: new V3() } }; this.fstate = { R: {}, L: {} };
  }
  onEvent(e) {
    const t = this.app.simTime;
    if (e.type === 'fire') { this.fireT = t; this.lastShot = e; if (this.launcher) this.reloadT = t + 0.35; }
    if (e.type === 'aim') this.lockT = t;
    if (e.type === 'charge') this.chargeT = t;
    if (e.type === 'deploy') { this.deployState = e.state; this.deployT = t; }
    if (e.type === 'emp_wind') this.empT = t;
    if (e.type === 'garrison_enter') this.enterT = t;
    if (e.type === 'death') { this.dead = true; this.deathT = t; this.deathDir = e.dir; }
  }
  update(S, dt) {
    const u = this.u, t = this.app.simTime; this.place(S);
    for (const [n, b] of Object.entries(this.bones)) { b.quaternion.copy(this.rest[n].q); b.position.copy(this.rest[n].p); }
    // gait phase from distance actually travelled: stride shortens at walking pace, the spec run loop sets the cycle at
    // full speed (H01: 0.8 s × 4.4 m/s = 3.52 m per two steps). Planted feet move back at exactly body speed.
    // distance actually covered on the ground this frame (includes separation nudges and obstacle slides)
    if (!this.lastPos) this.lastPos = [S.x, S.y]; const ds = S.hidden ? 0 : Math.hypot(S.x - this.lastPos[0], S.y - this.lastPos[1]); this.lastPos = [S.x, S.y];
    const spd = Math.hypot(S.vx, S.vy); const rr = clamp(spd / u.sp.speed_mps, 0, 1);
    // cadence rises from a 0.9 Hz walk to the spec run loop; stance (ground contact) length is capped at 0.62 m for reach
    const f = 0.9 + (1 / this.loop - 0.9) * rr; this.C = Math.max(0.6, spd / f); this.duty = Math.min(0.6 - 0.4 * rr, 0.62 / this.C);
    this.phase = (this.phase + ds / this.C) % 1;
    const deployed = S.deploy === 'deployed' || S.deploy === 'deploying' || S.deploy === 'packing';
    const kneelT = S.deploy === 'deployed' ? 1 : S.deploy === 'deploying' ? smooth((t - this.deployT) / (this.m.deploy ? this.m.deploy.setup : 1)) : S.deploy === 'packing' ? 1 - smooth((t - this.deployT) / (this.m.deploy ? this.m.deploy.pack : 1)) : 0;
    this.kneel = kneelT; this.gaitW = damp(this.gaitW, clamp(spd / 1.2, 0, 1), 10, dt);
    const engaged = S.target != null && !S.path && spd < 0.3;
    this.aimW = damp(this.aimW, engaged || deployed ? 1 : 0, 9, dt);
    if (this.dead) { this.feet.R = this.feet.L = false; return this.deathPose(S, t, dt); }
    // animation LOD: off-screen infantry only move; beyond 160 m the pose updates every third frame
    const cam = this.app.camera; this.frameN = (this.frameN || 0) + 1; const dcam = cam.position.distanceTo(this.group.position);
    if (!this.app.noLod && this.app.frustum && !this.app.frustum.containsPoint(this.group.position) && dcam > 25) { this.feet.R = this.feet.L = false; return; }
    if (!this.app.noLod && dcam > 160 && this.frameN % 3) { this.feet.R = this.feet.L = false; return; }
    this.group.updateMatrixWorld(true);
    const B = this.bones; const up = new V3(0, 1, 0).applyQuaternion(this.group.quaternion), fwd = new V3(0, 0, -1).applyQuaternion(this.group.quaternion), right = new V3(1, 0, 0).applyQuaternion(this.group.quaternion);
    // ── pelvis: run bob (0.04 m, twice per cycle), forward lean with speed, kneel drop ──
    const bob = this.gaitW * (0.04 * -Math.cos((this.phase - this.duty / 2) * 4 * Math.PI) - 0.05 * rr) + (1 - this.gaitW) * 0.006 * Math.sin(t * 2 * Math.PI / (this.m.idle || 2.4)); // lowest at mid-stance; run crouch
    const pel = B.pelvis; if (pel) { const dy = bob - 0.44 * kneelT; pel.position.addScaledVector(new V3(0, 1, 0), dy); pel.updateMatrixWorld(true);
      rotateWorld(pel, new Q().setFromAxisAngle(right, -(0.12 * this.gaitW * clamp(spd / 4, 0, 1.2)) - 0.12 * kneelT)); }
    // ── spine: twist toward aim, breathing ──
    const tgt = S.target != null ? this.app.world.byId.get(S.target) : null;
    let aimYaw = 0, aimPitch = 0;
    if (tgt) { const hp = this.app.world.hitPoint(tgt); const mz = this.app.world.muzzle(u, u.sys[0]); aimYaw = clamp(lerpA(0, Math.atan2(hp[1] - S.y, hp[0] - S.x) - S.hdg, 1), -0.6, 0.6); aimPitch = clamp(Math.atan2(hp[2] - mz[2], Math.hypot(hp[0] - mz[0], hp[1] - mz[1])), -0.5, 0.9); }
    this.lookYaw = damp(this.lookYaw, aimYaw * this.aimW, 10, dt);
    const breathe = Math.sin(t * 2 * Math.PI / (this.m.idle || 2.4)) * 0.012;
    const twist = (this.launcher ? -0.18 : this.lance ? -0.1 : -0.38) * this.aimW * (1 - kneelT * 0.4);
    if (B.spine_02) rotateWorld(B.spine_02, new Q().setFromAxisAngle(up, twist * 0.5 + this.lookYaw * 0.5).multiply(new Q().setFromAxisAngle(right, -0.05 * this.aimW - breathe)));
    if (B.spine_03) rotateWorld(B.spine_03, new Q().setFromAxisAngle(up, twist * 0.5 + this.lookYaw * 0.5));
    if (B.neck) rotateWorld(B.neck, new Q().setFromAxisAngle(up, -twist * 0.9 + Math.sin(t * 0.7 + this.bob) * 0.15 * (1 - this.aimW) * (1 - this.gaitW)));
    // ── legs: the ball of the foot is the planted point. Stance: it moves back at body speed (fixed in the world) while
    // the heel rises for toe-off; swing: an arc forward with toe-off pitch then dorsiflexion before touchdown ──
    for (const [side, sx, off] of [['R', 1, 0], ['L', -1, 0.5]]) {
      const th = B['thigh_' + side], sh = B['shin_' + side], ft = B['foot_' + side]; if (!th || !sh || !ft) continue;
      const ph = (this.phase + off) % 1, C = this.C * this.gaitW;
      // the duty factor is latched once per cycle (at touchdown) so a speed change can't flip a foot between stance and swing
      const FS = this.fstate[side]; if (FS.ph == null || ph < FS.ph - 0.5) FS.duty = this.duty; FS.ph = ph; const duty = FS.duty;
      let by, lift = 0, heel = 0, stance = ph < duty;
      if (stance) { const s = ph / duty; by = C * (duty / 2 - ph); heel = 0.85 * smooth((s - 0.45) / 0.55) * this.gaitW; }
      else { const s = (ph - duty) / (1 - duty); by = C * (-duty / 2 + duty * smooth(s)); lift = Math.sin(s * Math.PI) * (0.08 + 0.12 * rr) * this.gaitW; heel = (0.85 * (1 - smooth(s / 0.35)) - 0.25 * smooth((s - 0.6) / 0.4)) * this.gaitW; }
      let lx = sx * (0.1 + 0.03 * (1 - this.gaitW)), ly = by + 0.02 + (side === 'L' ? 0.06 : -0.08) * (1 - this.gaitW) * this.aimW, lz = 0.03 + lift;
      if (kneelT > 0) { // kneel: right knee down behind, left foot planted forward
        const kx = side === 'R' ? 0.12 : -0.1, ky = side === 'R' ? -0.3 : 0.42; lx += (kx - lx) * kneelT; ly += (ky - ly) * kneelT; lz += ((side === 'R' ? 0.06 : 0.03) - lz) * kneelT; heel *= 1 - kneelT;
        if (side === 'R') heel += 1.0 * kneelT;
      }
      const ground = this.app.T.height(S.x + (lx * Math.sin(S.hdg) + ly * Math.cos(S.hdg)), S.y + (-lx * Math.cos(S.hdg) + ly * Math.sin(S.hdg))) - S.z;
      // ankle from the ball point and the heel pitch (foot: ball 0.13 m ahead of and 0.065 m below the ankle)
      const al = 0.145, a0 = Math.atan2(0.065, 0.13) + heel; const ballM = new V3(lx, lz + clamp(ground, -0.3, 0.3), -ly);
      // foot lock: at touchdown the ball point is pinned in the world for the whole stance (turns and separation nudges
      // then rotate the leg instead of sliding the foot); released at toe-off or if the leg would over-reach
      const L = this.lock[side]; let ballW = this.group.localToWorld(ballM.clone());
      if (stance && this.gaitW > 0.3 && kneelT === 0) { if (!L.on) { L.on = true; L.p.copy(ballW); L.rel = null; } else { const hip = wpos(th); if (L.p.distanceTo(hip) > 0.98) { L.on = false; L.rel = { t, p: L.p.clone() }; FS.duty = ph; stance = false; } else ballW = L.p.clone(); } }  // would over-reach: lift early (take the next step) rather than slide
      else if (L.on) { L.on = false; L.rel = { t, p: L.p.clone() }; }
      if (!L.on && L.rel) { const k = smooth((t - L.rel.t) / 0.15); if (k >= 1) L.rel = null; else ballW = L.rel.p.clone().lerp(ballW, k); }  // released: ease the foot over 0.15 s instead of snapping
      const fq0 = this.group.getWorldQuaternion(new Q());
      let target = ballW.clone().add(new V3(0, al * Math.sin(a0), al * Math.cos(a0)).applyQuaternion(fq0));
      if (L.on) { const hip = wpos(th); if (hip.distanceTo(target) > this.legLen(side) * 0.995) { // the planted foot is about to over-reach: lift it now (next step) instead of sliding
        L.on = false; L.rel = { t, p: L.p.clone() }; FS.duty = ph; stance = false; } }
      const pole = this.group.localToWorld(new V3(lx * 1.3, 0.6, -(side === 'R' && kneelT > 0.5 ? 0.6 : 1.2)));
      ik2(th, sh, ft, target, pole);
      { const e = wpos(ft).distanceTo(target); if (stance && this.gaitW > 0.6) { this.app.ikErr = this.app.ikErr || { n: 0, max: 0, over2: 0, by: {} }; const IE = this.app.ikErr; IE.n++; IE.max = Math.max(IE.max, e); if (e > 0.02) { IE.over2++; IE.by[this.uid] = (IE.by[this.uid] || 0) + 1; } } }
      const fq = wquat(this.group); setWorldQuat(ft, fq.multiply(this._restModelQuat('foot_' + side)));
      rotateWorld(ft, new Q().setFromAxisAngle(right, -heel));
      const toe = B['toe_' + side]; if (toe && stance && this.gaitW > 0.6 && kneelT === 0) { wpos(toe, this.footWorld[side]); this.feet[side] = true; } else this.feet[side] = false;
    }
    // ── weapon placement (model space) ──
    this.poseWeapon(S, t, aimYaw, aimPitch, kneelT, tgt);
    // ── arms to the grips ──
    if (this.weapon) this.weapon.updateMatrixWorld(true);
    if (this.weapon && this.N.grip_R && this.N.grip_L) {
      const gR = wpos(this.N.grip_R), gL = wpos(this.N.grip_L);
      let tL = gL; if (this.launcher && this.reloading(t)) { const k = Math.sin(clamp((t - this.reloadT) / 1.6, 0, 1) * Math.PI); tL = gL.clone().lerp(this.group.localToWorld(new V3(-0.12, 1.3, 0.28)), k); }
      if (this.empAnim(t) > 0 && this.lance) tL = gL; // lance arm extension handled by the weapon pose
      const pR = this.group.localToWorld(new V3(0.55, 0.9, 0.35)), pL = this.group.localToWorld(new V3(-0.6, 0.8, 0.15));
      if (B.upperarm_R) ik2(B.upperarm_R, B.forearm_R, B.hand_R, gR, pR);
      if (B.upperarm_L) ik2(B.upperarm_L, B.forearm_L, B.hand_L, tL, pL);
    }
    // ── head looks along the aim ──
    if (B.head) rotateWorld(B.head, new Q().setFromAxisAngle(right, -aimPitch * 0.6 * this.aimW));
    // garrison entry: weapon lowered, step in and fade out
    if (S.order === 'garrison' && this.enterT > 0 && S.hidden !== true) { const k = clamp((t - this.enterT) / (this.m.garrison || 1), 0, 1); this.setOpacity(1 - k); } else if (!S.hidden) this.setOpacity(1);
    this.group.visible = !S.hidden;
    this.deployables(S, t, kneelT);
  }
  _restModelQuat(name) { // the bone's rest orientation relative to the model root, cached
    this._rmq = this._rmq || {}; if (this._rmq[name]) return this._rmq[name].clone();
    const b = this.bones[name]; const chain = []; for (let o = b; o && o !== this.model; o = o.parent) chain.unshift(o);
    const q = new Q(); for (const o of chain) q.multiply(o.isBone && this.rest[o.name] ? this.rest[o.name].q : o.quaternion);
    this._rmq[name] = q; return q.clone();
  }
  legLen(side) { this._ll = this._ll || {}; if (!this._ll[side]) { const a = wpos(this.bones['thigh_' + side]), b = wpos(this.bones['shin_' + side]), c = wpos(this.bones['foot_' + side]); this._ll[side] = a.distanceTo(b) + b.distanceTo(c); } return this._ll[side]; }
  reloading(t) { return this.launcher && t >= this.reloadT && t < this.reloadT + 1.6; }
  empAnim(t) { return t - this.empT < 0.6 ? Math.sin(clamp((t - this.empT) / 0.6, 0, 1) * Math.PI) : 0; }
  poseWeapon(S, t, aimYaw, aimPitch, kneelT, tgt) {
    const w = this.weapon; if (!w) return; const u = this.u, gw = this.gaitW, a = this.aimW;
    const run = Math.sin(this.phase * 4 * Math.PI) * 0.012 * gw;
    // carry (low ready) → aim (stock to shoulder). Positions are model space: x right, y up, z back(+)/front(−)
    let carry, aim;
    if (this.launcher) { carry = new V3(0.17, 1.58 + run, -0.38); aim = new V3(0.15, 1.6, -0.42); }
    else if (this.lance) { carry = new V3(0.12, 1.12 + run, -0.3); aim = new V3(0.06, 1.3, -0.36); }
    else { carry = new V3(0.12, 1.18 + run, -0.28); aim = new V3(0.13, 1.44, -0.3); }
    const p = carry.clone().lerp(aim, a);
    let pitch = (-0.32 * (1 - a)) + aimPitch * a, yaw = (0.12 * (1 - a)) + (this.lookYaw + (this.launcher ? 0 : 0.03)) * a;
    if (this.launcher) pitch = aimPitch * a * 0.9 + 0.02;
    if (this.lance) { pitch = -0.25 * (1 - a) + aimPitch * a; const e = this.empAnim(t); if (e > 0) { p.z -= 0.25 * e; pitch += 0.15 * e; } }
    // kneeling / deployed: weapon low and forward on its bipod / tripod
    if (kneelT > 0) {
      const dp = this.uid === 'A01' ? new V3(0.05, 0.7, -0.62) : this.uid === 'A02' ? new V3(0.0, 0.8, -0.62) : new V3(0.1, 0.9, -0.3);
      p.lerp(dp, kneelT); pitch = pitch * (1 - kneelT) + aimPitch * kneelT; yaw = yaw * (1 - kneelT) + this.lookYaw * kneelT;
    }
    // recoil: kick back and up, recover before the next shot (H01: 0.015 m / 3°; T01: 0.008 m)
    const since = t - this.fireT; const rk = this.uid === 'T01' ? 0.008 : this.launcher ? 0.03 : this.uid === 'A01' && S.deploy === 'deployed' ? 0.01 : 0.015;
    const rr = since >= 0 && since < 0.3 ? Math.exp(-since * 18) * (since < 0.03 ? since / 0.03 : 1) : 0;
    p.z += rk * rr; pitch += (this.launcher ? 0.06 : 3 * D2R) * rr;
    w.position.copy(p); w.quaternion.setFromEuler(new THREE.Euler(pitch, -yaw, 0, 'YXZ'));
    // A01 bipod legs swing down when deployed
    if (this.N.bipod_L) { const k = kneelT * (this.uid === 'A01' ? 1 : 0); this.N.bipod_L.rotation.x = -1.4 * k; this.N.bipod_R.rotation.x = -1.4 * k; }
    // glow pulses on shots / charge
    const g = this.mats.GLOW_cyan || this.mats.GLOW_charge; const cg = this.mats.GLOW_charge;
    if (this.mats.GLOW_cyan) this.mats.GLOW_cyan.emissiveIntensity = 1 + 3 * Math.exp(-Math.max(0, since) * 8);
    if (cg) cg.emissiveIntensity = 0.6 + 5 * (t - this.chargeT < 0.25 ? (t - this.chargeT) / 0.2 : Math.exp(-(t - this.chargeT - 0.25) * 4)) + 6 * this.empAnim(t);
    void g;
  }
  deployables(S, t, kneelT) {
    if (this.N.shield) { this.N.shield.visible = kneelT > 0.02; this.N.shield.rotation.x = -(1 - kneelT) * Math.PI / 2; }
    if (this.N.tripod) { this.N.tripod.visible = kneelT > 0.02; for (let k = 0; k < 3; k++) { const l = this.N['leg_' + k]; if (l) l.rotation.z = (1 - kneelT) * 1.2 * (k - 1); } this.N.tripod.scale.setScalar(0.4 + 0.6 * kneelT); }
  }
  deathPose(S, t, dt) {
    // directional fall over the death time, knees buckle, weapon drops; body fades after 6 s
    const k = smooth((t - this.deathT) / (this.m.death || 0.8)); const fall = k * k * (Math.PI / 2 - 0.08);
    const dir = this.deathDir - S.hdg; const ax = new V3(Math.cos(dir), 0, Math.sin(dir)); // horizontal axis perpendicular to the fall, model space
    this.tilt.quaternion.setFromAxisAngle(new V3(-Math.sin(dir), 0, -Math.cos(dir)).cross(new V3(0, 1, 0)).normalize(), fall); void ax;
    this.tilt.position.y = -0.1 * k;
    const B = this.bones; const right = new V3(1, 0, 0);
    if (B.thigh_R) { B.thigh_R.quaternion.multiply(new Q().setFromAxisAngle(right, -0.6 * k)); B.shin_R.quaternion.multiply(new Q().setFromAxisAngle(right, 1.0 * k)); }
    if (B.thigh_L) { B.thigh_L.quaternion.multiply(new Q().setFromAxisAngle(right, -0.3 * k)); B.shin_L.quaternion.multiply(new Q().setFromAxisAngle(right, 0.5 * k)); }
    if (this.weapon) { this.weapon.position.set(0.35 + 0.2 * k, 1.1 - 1.05 * k, -0.4); this.weapon.quaternion.setFromEuler(new THREE.Euler(-0.3 + 0.3 * k, 0.4 * k, 1.5 * k)); }
    const dead = t - this.deathT; this.setOpacity(dead > 6 ? Math.max(0, 1 - (dead - 6) / 1.5) : 1);
    if (this.mats.GLOW_cyan) this.mats.GLOW_cyan.emissiveIntensity = Math.max(0, 1 - dead / 0.4);   // battery light fades over 0.4 s
  }
  footSlideSample() { return this.feet; }
}

// ───────── tracked / hover vehicles ─────────
export class GroundView extends BaseView {
  constructor(app, u, proto) {
    super(app, u, proto); this.hover = u.kind === 'hover';
    const axle = this.m.wheelAxis === 'z' ? new V3(0, 0, 1) : new V3(1, 0, 0);   // maps assets (+X forward) roll about their local Y = glTF Z
    this.wheels = []; for (const [n, o] of Object.entries(this.N)) if (/^(wheel|sprocket|idler)_[LR]/.test(n)) this.wheels.push({ o, side: n.includes('_L') ? 'L' : 'R', r: (o.userData && o.userData.r) || this.m.wheelR || 0.4, q0: o.quaternion.clone(), axle });
    this.drumA = 0; this.drum0 = this.N.drum ? this.N.drum.quaternion.clone() : null; this.oreAcc = 0;
    this.tracks = {}; for (const s of ['L', 'R']) { const tr = this.N['track_' + s]; this.tracks[s] = { mat: this.mats['TRACK_' + s], uvm: (tr && tr.userData && tr.userData.uv_m) || 1 }; }
    this.recoil0 = this.N.recoil ? this.N.recoil.position.clone() : null; this.chargeT = -9; this.pods0 = {}; for (const n of ['pod_L', 'pod_R']) if (this.N[n]) this.pods0[n] = this.N[n].position.clone();
    this.fin0 = {}; for (const n of ['fin_L', 'fin_R']) if (this.N[n]) this.fin0[n] = this.N[n].position.clone();
    this.ant0 = this.N.antenna ? this.N.antenna.quaternion.clone() : null; this.antV = 0; this.antA = 0; this.smokeAcc = 0; this.dustAcc = 0; this.prevV = 0;
  }
  onEvent(e) { const t = this.app.simTime; if (e.type === 'fire') { this.fireT = t; } if (e.type === 'charge') this.chargeT = t; if (e.type === 'death') { this.dead = true; this.deathT = t; } }
  update(S, dt) {
    const t = this.app.simTime, m = this.m; this.place(S);
    // hull attitude: terrain normal under the hull + acceleration squat/dive (≤ maxHullPitch) + hover bank
    const nrm = this.app.T.normal(S.x, S.y, this.hover ? 2.5 : 3.0); const c = Math.cos(S.hdg), s = Math.sin(S.hdg);
    const slopeF = Math.atan2(-(nrm[0] * c + nrm[1] * s), nrm[2]), slopeR = Math.atan2(-(nrm[0] * s - nrm[1] * c), nrm[2]);
    const accP = clamp(-S.accelF * 0.012, -(m.maxHullPitch || 3) * D2R, (m.maxHullPitch || 3) * D2R);
    let bank = 0; if (this.hover) bank = clamp(S.accelS * 0.03 + S.w * S.v * 0.004, -m.bank * D2R, m.bank * D2R);
    this.pitchV = damp(this.pitchV, (this.hover ? 0 : slopeF) + accP, 8, dt); this.rollV = damp(this.rollV, (this.hover ? 0 : slopeR) + bank, 8, dt);
    this.tilt.rotation.set(this.pitchV, 0, this.rollV, 'YXZ');   // +x = nose up, +z = right side up (three: unit faces −Z)
    if (this.hover) { this.tilt.position.y = (m.bob[0]) * Math.sin(t * 2 * Math.PI / m.bob[1] + this.bob); }
    // turret / gun / recoil
    if (this.N.turret) this.N.turret.rotation.y = S.turret;
    if (this.N.gun) this.N.gun.rotation.x = S.pitch;
    if (this.N.recoil && this.recoil0 && m.recoil) {
      const [dist, back, ret] = m.recoil; const since = t - this.fireT; let off = 0;
      if (since >= 0 && since < back) off = dist * since / back; else if (since >= back && since < back + ret) off = dist * (1 - smooth((since - back) / ret));
      this.N.recoil.position.copy(this.recoil0).add(new V3(0, 0, off));   // Blender −Y (rearward) = glTF +Z
    }
    if (this.hover && this.N.fin_L) { const ch = t - this.chargeT < (m.precharge || 0.25) ? smooth((t - this.chargeT) / (m.precharge || 0.25)) : Math.max(0, 1 - (t - this.chargeT - (m.precharge || 0.25)) / 0.35);
      const spread = (m.finSpread || 0.08) / 2 * clamp(ch, 0, 1); this.N.fin_L.position.copy(this.fin0.fin_L).add(new V3(-spread, 0, 0)); this.N.fin_R.position.copy(this.fin0.fin_R).add(new V3(spread, 0, 0));
      if (this.mats.GLOW_cyan) this.mats.GLOW_cyan.emissiveIntensity = 1 + 4 * clamp(ch, 0, 1); }
    if (this.hover) for (const [n, p0] of Object.entries(this.pods0)) this.N[n].position.copy(p0).add(new V3(0, 0.02 * Math.sin(t * 3.1 + (n === 'pod_L' ? 0 : 1.7)), 0));
    // tracks: scroll each belt by its own ground distance; wheels roll with r
    for (const sd of ['L', 'R']) { const T_ = this.tracks[sd]; const d = sd === 'L' ? S.trackL : S.trackR; if (T_.mat && T_.mat.map) T_.mat.map.offset.x = d / T_.uvm; }   // U grows toward the front on the ground run, so +offset moves the pattern rearward: the contact run stays still on the ground
    for (const w of this.wheels) { const d = w.side === 'L' ? S.trackL : S.trackR; w.o.quaternion.copy(w.q0).multiply(new Q().setFromAxisAngle(w.axle, -d / w.r)); }
    // harvester: cutter drum spins while loading; ore dust at the hopper while loading and at the grate while unloading
    if (this.N.drum && this.drum0) { this.drumW = damp(this.drumW || 0, S.loading ? 3.2 : 0, 2.5, dt); this.drumA += this.drumW * dt; this.N.drum.quaternion.copy(this.drum0).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), -this.drumA)); }
    if ((S.loading || S.harv === 'unload') && this.app.fx && !this.dead) { this.oreAcc += dt * 9; while (this.oreAcc > 1) { this.oreAcc -= 1; const p = this.group.localToWorld(new V3((Math.random() - 0.5) * 2.2, S.loading ? 3.6 : 0.4, (Math.random() - 0.5) * 3.0 + (S.loading ? 0.6 : 0)));
      this.app.fx.puff(p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 0.8, vy: S.loading ? 0.6 : 1.4, vz: (Math.random() - 0.5) * 0.8, drag: 0.8, life: 1.6, s0: 0.8, s1: 2.6, c0: [0.52, 0.46, 0.38], a0: 0.35 }); } }
    // antenna sway: spring driven by acceleration (cosmetic)
    if (this.N.antenna && this.ant0) { this.antA += (-this.antV * 28 - this.antA * 3 - S.accelF * 0.02) * dt; this.antV += this.antA * dt; this.antV = clamp(this.antV, -0.4, 0.4); this.N.antenna.quaternion.copy(this.ant0).multiply(new Q().setFromAxisAngle(new V3(1, 0, 0), this.antV)); }
    // exhaust, dust / spray
    const spd = Math.hypot(S.vx, S.vy); const fx = this.app.fx;
    if (!this.dead && fx) {
      this.smokeAcc += dt * (this.hover ? 0 : (1.5 + Math.max(0, S.accelF) * 3 + spd * 0.15));
      while (this.smokeAcc > 1) { this.smokeAcc -= 1; for (const n of ['fx_exhaust_L', 'fx_exhaust_R']) if (this.N[n]) { const p = this.sock(n); fx.puff(p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 0.4, vy: 1.2, vz: (Math.random() - 0.5) * 0.4, drag: 0.6, life: 1.4, s0: 0.25, s1: 1.4, a0: 0.18 + Math.max(0, S.accelF) * 0.05, c0: [0.25, 0.24, 0.23] }); } }
      this.dustAcc += dt * spd * (this.hover ? 0.9 : 0.5);
      while (this.dustAcc > 1) { this.dustAcc -= 1; const wet = this.app.T.height(S.x, S.y) < 0.05; const names = this.hover ? ['fx_thrust_0', 'fx_thrust_1', 'fx_thrust_2', 'fx_thrust_3'] : ['fx_dust_L', 'fx_dust_R']; const n = names[(Math.random() * names.length) | 0]; const p = this.N[n] ? this.sock(n) : this.group.position.clone(); p.y = Math.max(this.app.T.height(S.x, S.y), 0) + 0.1; fx.dustKick(p, wet ? 3 : 1, wet); }
    }
    if (this.dead) this.deathAnim(S, t, dt);
  }
  deathAnim(S, t, dt) {
    const d = t - this.deathT;
    if (!this.blackened) { this.blackened = true; for (const m of this.allMats) if (m.color && !(m.name || '').startsWith('GLOW')) m.color.multiplyScalar(0.35); for (const m of this.allMats) if ((m.name || '').startsWith('GLOW')) m.emissiveIntensity = 0; }
    if (this.hover) this.tilt.position.y = -this.m.clearance * smooth(d / this.m.death);     // hover stops: hull drops 0.45 m
    if (d < 10 && Math.random() < dt * 6) this.app.fx.smokeColumn(this.group.position.clone().add(new V3(0, 1.5, 0)), 1, true);
    const fadeAt = this.m.fade || 12; this.setOpacity(d > fadeAt - 1.5 ? Math.max(0, (fadeAt - d) / 1.5) : 1);
  }
}

// ───────── aircraft ─────────
export class AirView extends BaseView {
  constructor(app, u, proto) {
    super(app, u, proto); this.rotA = 0; this.tailA = 0; this.gear = {}; for (const n of ['gear_N', 'gear_L', 'gear_R']) if (this.N[n]) this.gear[n] = { o: this.N[n], q0: this.N[n].quaternion.clone(), r: (this.N[n].userData && this.N[n].userData.retract) || 1.5 };
    this.surf = {}; for (const n of ['aileron_L', 'aileron_R', 'elevator_L', 'elevator_R', 'rudder_L', 'rudder_R']) if (this.N[n]) this.surf[n] = { o: this.N[n], q0: this.N[n].quaternion.clone() };
    this.rot0 = {}; for (const n of ['rotor', 'tail_rotor', 'rotor_FL', 'rotor_FR', 'rotor_RL', 'rotor_RR', 'gimbal', 'gimbal_pitch', 'pod_L', 'pod_R']) if (this.N[n]) this.rot0[n] = this.N[n].quaternion.clone();
    this.bombs = { L: this.N.bomb_L, R: this.N.bomb_R }; this.trailAcc = 0;
  }
  onEvent(e) { const t = this.app.simTime; if (e.type === 'fire') { this.fireT = t; this.lastShot = e; } if (e.type === 'bomb') { const b = this.bombs[e.side === 0 ? 'L' : 'R']; if (b) b.visible = false; } if (e.type === 'rearmed') { for (const b of Object.values(this.bombs)) if (b) b.visible = true; } if (e.type === 'death') { this.dead = true; this.deathT = t; } }
  spin(n, axis, a) { if (this.N[n] && this.rot0[n]) this.N[n].quaternion.copy(this.rot0[n]).multiply(new Q().setFromAxisAngle(axis, a)); }
  update(S, dt) {
    const t = this.app.simTime, m = this.m, k = this.u.kind; this.place(S);
    const spd = Math.hypot(S.vx, S.vy); const c = Math.cos(S.hdg), s = Math.sin(S.hdg); const vf = S.vx * c + S.vy * s;
    let pitch = 0, bank = 0;
    if (k === 'heli' || k === 'drone') { pitch = clamp(-(vf / this.u.sp.speed_mps) * m.pitchMax * 0.7 * D2R - S.accelF * 0.012, -m.pitchMax * D2R, m.pitchMax * D2R); bank = clamp(S.accelS * 0.02 + S.w * spd * 0.012, -m.bankMax * D2R, m.bankMax * D2R); }
    if (k === 'jet') { bank = clamp(S.w * Math.max(spd, 5) * 0.03, -m.bankMax * D2R, m.bankMax * D2R); pitch = clamp((S.climb || 0) * 0.02, -0.2, 0.2); }
    if (this.dead) { const d = t - this.deathT; pitch -= d * 0.4; bank += d * (k === 'heli' ? 2.5 : 1.2); }
    this.pitchV = damp(this.pitchV, pitch, 6, dt); this.rollV = damp(this.rollV, bank, 6, dt);
    this.tilt.rotation.set(this.pitchV, 0, this.rollV, 'YXZ');      // nose down when accelerating forward; bank into turns
    if (k !== 'jet') this.tilt.position.y = m.bob[0] * Math.sin(t * 2 * Math.PI / m.bob[1] + this.bob);
    // rotors: main rotor ~ 300 rpm; translucent disc above a threshold (blades hidden), tail rotor separate
    if (k === 'heli') {
      this.rotA += dt * 31; this.tailA += dt * 140; this.spin('rotor', new V3(0, 1, 0), -this.rotA); this.spin('tail_rotor', new V3(1, 0, 0), this.tailA);
      const disc = this.dead ? 0 : 1; if (this.N.rotor_disc) this.N.rotor_disc.visible = disc > 0.5; if (this.mats.DISC_main) this.mats.DISC_main.opacity = 0.32; if (this.mats.DISC_tail) this.mats.DISC_tail.opacity = 0.3;
      for (let i = 0; i < 4; i++) if (this.N['blade_' + i]) this.N['blade_' + i].visible = true;
      if (this.N.pod_L) { this.spin('pod_L', new V3(0, 1, 0), S.podYaw); this.spin('pod_R', new V3(0, 1, 0), S.podYaw); }
    }
    if (k === 'drone') {
      this.rotA += dt * (60 + spd * 3); for (const [n, sg] of [['rotor_FL', 1], ['rotor_FR', -1], ['rotor_RL', -1], ['rotor_RR', 1]]) this.spin(n, new V3(0, 1, 0), sg * this.rotA);
      if (this.mats.DISC_rotor) this.mats.DISC_rotor.opacity = 0.18 + 0.2 * clamp(spd / 22, 0, 1);
      this.spin('gimbal', new V3(0, 1, 0), S.gimbal); this.spin('gimbal_pitch', new V3(1, 0, 0), S.gimbalPitch);
      if (this.mats.GLOW_cyan) this.mats.GLOW_cyan.emissiveIntensity = 1 + 4 * Math.exp(-(t - this.fireT) * 10);
    }
    if (k === 'jet') {
      const g = S.gear == null ? 0 : S.gear; for (const v of Object.values(this.gear)) v.o.quaternion.copy(v.q0).multiply(new Q().setFromAxisAngle(new V3(1, 0, 0), v.r * (1 - g)));
      const roll = clamp(S.w * 0.5, -0.35, 0.35); for (const [n, v] of Object.entries(this.surf)) { let a = 0; if (n.startsWith('aileron')) a = (n.endsWith('L') ? 1 : -1) * roll; if (n.startsWith('elevator')) a = -this.pitchV * 0.8; if (n.startsWith('rudder')) a = clamp(S.w * 0.2, -0.3, 0.3); v.o.quaternion.copy(v.q0).multiply(new Q().setFromAxisAngle(n.startsWith('rudder') ? new V3(0, 1, 0) : new V3(1, 0, 0), a)); }
      if (this.mats.GLOW_afterburner) this.mats.GLOW_afterburner.emissiveIntensity = 1.5 + 2.5 * clamp(spd / 35, 0, 1);
      if (!this.dead && spd > 20) { this.trailAcc += dt * 12; while (this.trailAcc > 1) { this.trailAcc -= 1; const p = this.sock('fx_exhaust'); this.app.fx.puff(p.x, p.y, p.z, { drag: 0.3, life: 0.8, s0: 0.3, s1: 1.4, a0: 0.12, c0: [0.75, 0.75, 0.75] }); } }
    }
    if (this.dead) { const d = t - this.deathT; this.tilt.position.y = -Math.min(S.z - Math.max(this.app.T.height(S.x, S.y), 0), 4.9 * d * d); if (Math.random() < dt * 20) this.app.fx.smokeColumn(this.group.position.clone().add(this.tilt.position), 1, true); this.setOpacity(d > m.death ? Math.max(0, 1 - (d - m.death) / 0.8) : 1); }
  }
}

// ───────── ships ─────────
export class ShipView extends BaseView {
  constructor(app, u, proto) {
    super(app, u, proto); this.propA = 0; this.radarA = 0; this.recoil0 = this.N.recoil ? this.N.recoil.position.clone() : null;
    this.lids = []; for (const n of ['lid_0', 'lid_1', 'lid_2', 'lid_3', 'lid_L', 'lid_R']) if (this.N[n]) this.lids.push({ n, o: this.N[n], q0: this.N[n].quaternion.clone(), open: 0, openAt: -9, closeAt: -9 });
    this.q0 = {}; for (const n of ['prop_L', 'prop_R', 'radar', 'aa', 'aa_pitch', 'sensor', 'sensor_pitch', 'jet_L', 'jet_R']) if (this.N[n]) this.q0[n] = this.N[n].quaternion.clone();
    this.wakeAcc = 0;
  }
  onEvent(e) {
    const t = this.app.simTime;
    if (e.type === 'fire') { this.fireT = t; this.lastShot = e; const L = this.lids.find((l) => l.n === (this.uid === 'A05' ? 'lid_' + e.muzzle : e.muzzle === 0 ? 'lid_L' : 'lid_R')); if (L) { L.openAt = Math.min(L.openAt > t - 1 ? L.openAt : t, t); L.closeAt = t + (this.m.lidClose || 0.3); } }
    if (e.type === 'charge' && e.sys === 0) { const idx = e.lid; const L = this.lids.find((l) => l.n === (this.uid === 'A05' ? 'lid_' + idx : idx === 0 ? 'lid_L' : 'lid_R')); if (L) { L.openAt = t; L.closeAt = t + e.dur + (this.m.lidClose || 0.3); }
      if (this.uid === 'A05') { const L2 = this.lids.find((l) => l.n === 'lid_' + ((idx + 1) % 4)); if (L2) { L2.openAt = t + 0.2; L2.closeAt = t + e.dur + 0.2 + 0.3; } } }
    if (e.type === 'death') { this.dead = true; this.deathT = t; }
  }
  rot(n, axis, a) { if (this.N[n] && this.q0[n]) this.N[n].quaternion.copy(this.q0[n]).multiply(new Q().setFromAxisAngle(axis, a)); }
  update(S, dt) {
    const t = this.app.simTime, m = this.m; this.place(S); const spd = S.v;
    // float: roll ±, pitch ± (cosmetic), bank outward in turns
    const roll = m.roll * D2R * Math.sin(t * 0.9 + this.bob) + clamp(-S.accelS * 0.02, -m.roll * 2 * D2R, m.roll * 2 * D2R) * (m.outsideBank ? 1 : 0.6);
    const pitch = (m.pitchAmp || 0.5) * D2R * Math.sin(t * 0.63 + this.bob * 1.7) - clamp(spd * 0.002, 0, 0.02);
    this.tilt.rotation.set(pitch, 0, roll, 'YXZ'); this.tilt.position.y = 0.08 * Math.sin(t * 0.8 + this.bob);   // roll < 0 = right side down (outward in a left turn)
    if (this.N.turret) this.N.turret.rotation.y = S.turret; if (this.N.gun) this.N.gun.rotation.x = S.pitch;
    if (this.N.recoil && this.recoil0 && m.recoil) { const [dist, back, ret] = m.recoil; const since = t - this.fireT; let off = 0; if (since >= 0 && since < back) off = dist * since / back; else if (since >= back && since < back + ret) off = dist * (1 - smooth((since - back) / ret)); this.N.recoil.position.copy(this.recoil0).add(new V3(0, 0, off)); }
    this.propA += dt * spd * 4; this.rot('prop_L', new V3(0, 0, 1), this.propA); this.rot('prop_R', new V3(0, 0, 1), -this.propA);
    if (this.N.radar) { this.radarA += dt * 2 * Math.PI / (m.radarPeriod || 12); this.rot('radar', new V3(0, 1, 0), this.radarA); }
    if (this.N.aa) { this.rot('aa', new V3(0, 1, 0), S.aaYaw); this.rot('aa_pitch', new V3(1, 0, 0), S.aaPitch); }
    if (this.N.sensor) { const tg = S.target != null ? this.app.world.byId.get(S.target) : null; const y = tg ? Math.atan2(tg.y - S.y, tg.x - S.x) - S.hdg : 0.3 * Math.sin(t * 0.5); this.sensY = damp(this.sensY || 0, Math.atan2(Math.sin(y), Math.cos(y)), 4, dt); this.rot('sensor', new V3(0, 1, 0), this.sensY); }
    if (this.N.jet_L) { const st = clamp(-S.w * 1.5, -0.4, 0.4); this.rot('jet_L', new V3(0, 1, 0), st); this.rot('jet_R', new V3(0, 1, 0), st); }
    for (const L of this.lids) { const want = t >= L.openAt && t < L.closeAt ? 1 : 0; L.open = damp(L.open, want, 14, dt); L.o.quaternion.copy(L.q0).multiply(new Q().setFromAxisAngle(new V3(1, 0, 0), L.open * 1.4)); }   // aft hinge; +X opens (model contract)
    // wake: foam from the stern and bow sockets, scaled with speed
    if (!this.dead && this.app.fx && spd > 0.4) { this.wakeAcc += dt * (4 + spd * 1.6); while (this.wakeAcc > 1) { this.wakeAcc -= 1; for (const [n, sd] of [['fx_wake_stern', 0], ['fx_wake_L', -1], ['fx_wake_R', 1]]) if (this.N[n]) { const p = this.sock(n); this.app.fx.wake(p, spd, sd * 0.5); } } }
    if (this.dead) { const d = t - this.deathT; const k = smooth(d / m.death); this.tilt.rotation.z += k * 0.35; this.tilt.rotation.x += k * 0.12; this.tilt.position.y -= k * (this.u.sp.dimensions_m.height * 0.9); if (Math.random() < dt * 10 && d < m.death) this.app.fx.smokeColumn(this.group.position.clone().add(new V3(0, 3, 0)), 1, true); this.setOpacity(d > m.death ? Math.max(0, 1 - (d - m.death) / 4) : 1); }
  }
}

export function makeView(app, u, proto) {
  const k = u.kind; if (k === 'foot') return new InfantryView(app, u, proto); if (k === 'tracked' || k === 'hover') return new GroundView(app, u, proto);
  if (k === 'ship') return new ShipView(app, u, proto); return new AirView(app, u, proto);
}
