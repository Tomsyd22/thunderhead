// RTS camera: north-up view of a ground focus point. Smooth zoom toward the cursor (the ground point under the cursor stays
// put), edge scrolling, middle-button grab-pan, arrow-key pan, minimap jumps, smooth fly-to, terrain-following focus height,
// tilt that flattens a little as you zoom in, and the presenter's shake offset on top. Real-time (not game-time) motion.
import * as THREE from 'three';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class RTSCamera {
  constructor(camera, T, opts = {}) {
    this.cam = camera; this.T = T; this.fx = T.W / 2; this.fy = T.H / 2; this.fz = 10; this.dist = 220; this.distT = 220;
    this.minD = opts.minD || 35; this.maxD = opts.maxD || 900; this.edge = true; this.edgePx = 10; this.edgeSpeed = 1.25;
    this.mouse = null; this.keys = {}; this.drag = null; this.fly = null; this.zoomAnchor = null; this.shake = new THREE.Vector3(); this.viewRight = 0;
  }
  get el() { const f = (this.dist - this.minD) / (this.maxD - this.minD); return (40 + 18 * Math.sqrt(clamp(f, 0, 1))) * Math.PI / 180; }
  setFocus(x, y) { this.fx = clamp(x, 0, this.T.W); this.fy = clamp(y, 0, this.T.H); this.fly = null; }
  flyTo(x, y, dur = 0.35) { this.fly = { x0: this.fx, y0: this.fy, x1: clamp(x, 0, this.T.W), y1: clamp(y, 0, this.T.H), t: 0, dur }; }
  /** wheel: positive dy zooms out; cx, cy = cursor (zoom toward the ground point under it) */
  wheel(dy, cx, cy, ground) { const k = Math.pow(1.0018, dy); this.distT = clamp(this.distT * k, this.minD, this.maxD); this.zoomAnchor = ground ? { gx: ground.x, gy: ground.y, gz: ground.z, cx, cy } : null; }
  mpp() { return 2 * this.dist * Math.tan(this.cam.fov * Math.PI / 360) / innerHeight; }   // metres per screen pixel at the focus
  dragStart(cx, cy) { this.drag = { cx, cy, fx: this.fx, fy: this.fy, mpp: this.mpp() }; this.fly = null; }
  dragMove(cx, cy) { const d = this.drag; if (!d) return; this.setFocus(d.fx - (cx - d.cx) * d.mpp, d.fy + (cy - d.cy) * d.mpp / Math.sin(this.el)); this.drag = d; }
  dragEnd() { this.drag = null; }
  update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    // zoom (exponential smoothing) keeping the anchored ground point under the cursor
    this.dist += (this.distT - this.dist) * (1 - Math.exp(-dt * 14));
    // pan: keys + screen edges (speed scales with zoom)
    const sp = this.dist * this.edgeSpeed * dt; let vx = 0, vy = 0; const K = this.keys;
    if (K.ArrowLeft) vx -= 1; if (K.ArrowRight) vx += 1; if (K.ArrowUp) vy += 1; if (K.ArrowDown) vy -= 1;
    if (this.edge && this.mouse && !this.drag && document.hasFocus()) { const m = this.mouse, e = this.edgePx, W = innerWidth - this.viewRight;
      if (m.x <= e) vx -= 1; else if (m.x >= W - e && m.x < W + 2) vx += 1; if (m.y <= e) vy += 1; else if (m.y >= innerHeight - e) vy -= 1; }
    if (vx || vy) { const l = Math.hypot(vx, vy); this.setFocus(this.fx + vx / l * sp, this.fy + vy / l * sp); }
    if (this.fly) { const f = this.fly; f.t += dt; const t = clamp(f.t / f.dur, 0, 1), e = 1 - Math.pow(1 - t, 3); this.fx = f.x0 + (f.x1 - f.x0) * e; this.fy = f.y0 + (f.y1 - f.y0) * e; if (t >= 1) this.fly = null; }
    this.fx = clamp(this.fx, 0, this.T.W); this.fy = clamp(this.fy, 0, this.T.H);
    // focus height follows the ground smoothly (sampled over a small cross so cliffs don't jerk the view)
    const T = this.T, s = (x, y) => Math.max(T.surface(clamp(x, 0, T.W), clamp(y, 0, T.H)), 0);
    const gz = (s(this.fx, this.fy) * 2 + s(this.fx + 20, this.fy) + s(this.fx - 20, this.fy) + s(this.fx, this.fy + 20) + s(this.fx, this.fy - 20)) / 6;
    this.fz += (gz - this.fz) * (1 - Math.exp(-dt * 4));
    this.pose();
    // zoom toward the cursor: move the focus so the anchored ground point stays under the cursor (exact, two passes)
    if (this.zoomAnchor) { const a = this.zoomAnchor; for (let it = 0; it < 2; it++) { const p = this.cursorGround(a.cx, a.cy, a.gz); if (!p) break; this.fx = clamp(this.fx + a.gx - p[0], 0, this.T.W); this.fy = clamp(this.fy + a.gy - p[1], 0, this.T.H); this.pose(); }
      if (Math.abs(this.distT - this.dist) < 0.05) this.zoomAnchor = null; }
    const c = this.cam;
    // never inside a hill: lift the camera over the ground under it
    const under = s(c.position.x, -c.position.z); if (c.position.y < under + 4) c.position.y = under + 4;
    c.near = clamp(this.dist * 0.01, 0.3, 4); c.far = Math.max(3000, this.dist * 6); c.updateProjectionMatrix();
  }
  pose() { const el = this.el, c = this.cam; c.position.set(this.fx, this.fz + Math.sin(el) * this.dist, -this.fy + Math.cos(el) * this.dist).add(this.shake); c.lookAt(this.fx + this.shake.x * 0.5, this.fz + this.shake.y * 0.5, -this.fy + this.shake.z * 0.5); c.updateMatrixWorld(); }
  cursorGround(cx, cy, gz) { const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), this.cam); const p = new THREE.Vector3(); return r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -gz), p) ? [p.x, -p.z] : null; }
  /** camera footprint on the ground (4 corners, sim coords) for the minimap frame */
  footprint() {
    const out = [], ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.fz);
    for (const [x, y] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { ray.setFromCamera(new THREE.Vector2(x, y), this.cam); const p = new THREE.Vector3(); if (ray.ray.intersectPlane(plane, p)) out.push([p.x, -p.z]); else { const d = ray.ray.direction; out.push([this.cam.position.x + d.x * 3000, -(this.cam.position.z + d.z * 3000)]); } }
    return out;
  }
}
