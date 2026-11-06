// Effects: one instanced billboard pool per blend mode (alpha smoke/dust/spray, additive fire/sparks/glow), tracer and
// beam segments, ground rings (bomb warning, EMP, scan) and persistent wake foam. No realtime light per projectile.
import * as THREE from 'three';

function spriteTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}
function puffTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  for (let k = 0; k < 9; k++) { const x = 32 + Math.cos(k * 2.1) * 9, y = 32 + Math.sin(k * 1.7) * 9, r = 14 + (k % 3) * 4; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  return new THREE.CanvasTexture(c);
}

class Pool {
  constructor(scene, n, tex, additive) {
    this.n = n; this.live = 0;
    const geo = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1); geo.index = q.index; geo.attributes.position = q.attributes.position; geo.attributes.uv = q.attributes.uv;
    this.off = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.sz = new Float32Array(n * 2);
    geo.setAttribute('ioff', new THREE.InstancedBufferAttribute(this.off, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('icol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('isz', new THREE.InstancedBufferAttribute(this.sz, 2).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      vertexShader: `attribute vec3 ioff; attribute vec4 icol; attribute vec2 isz; varying vec2 vUv; varying vec4 vCol;
        void main(){ vUv = uv; vCol = icol; vec4 mv = modelViewMatrix * vec4(ioff, 1.0); float c = cos(isz.y), s = sin(isz.y);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * isz.x; mv.xy += p; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vCol; void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(vCol.rgb, vCol.a * t.a); if (gl_FragColor.a < 0.004) discard; }`,
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 5 : 4; scene.add(this.mesh);
    this.p = []; // particle records
  }
  add(o) { if (this.p.length >= this.n) this.p.shift(); this.p.push(o); }
  update(dt) {
    const keep = []; let k = 0;
    for (const p of this.p) {
      p.age += dt; if (p.age >= p.life) continue; keep.push(p);
      p.vy -= (p.g || 0) * dt; const dr = Math.exp(-(p.drag || 0) * dt); p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.floor != null && p.y < p.floor) { p.y = p.floor; p.vy = 0; }
      const t = p.age / p.life; const a = p.a0 * (p.fadeIn ? Math.min(1, t / p.fadeIn) : 1) * (1 - Math.pow(t, p.fp || 1.4));
      this.off[k * 3] = p.x; this.off[k * 3 + 1] = p.y; this.off[k * 3 + 2] = p.z;
      const c = p.c1 ? [p.c0[0] + (p.c1[0] - p.c0[0]) * t, p.c0[1] + (p.c1[1] - p.c0[1]) * t, p.c0[2] + (p.c1[2] - p.c0[2]) * t] : p.c0;
      this.col[k * 4] = c[0]; this.col[k * 4 + 1] = c[1]; this.col[k * 4 + 2] = c[2]; this.col[k * 4 + 3] = a;
      this.sz[k * 2] = p.s0 + (p.s1 - p.s0) * t; this.sz[k * 2 + 1] = p.rot + (p.spin || 0) * p.age; k++;
    }
    this.p = keep; const g = this.mesh.geometry; g.instanceCount = k;
    for (const n of ['ioff', 'icol', 'isz']) g.attributes[n].needsUpdate = true;
  }
}

export class FX {
  constructor(scene, T) {
    this.scene = scene; this.T = T; const st = spriteTex(), pt = puffTex();
    this.smoke = new Pool(scene, 2600, pt, false); this.glow = new Pool(scene, 1600, st, true);
    // tracers / beams: line segments with per-vertex colour, additive
    this.segMax = 400; const g = new THREE.BufferGeometry(); this.segPos = new Float32Array(this.segMax * 6); this.segCol = new Float32Array(this.segMax * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.segPos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('color', new THREE.BufferAttribute(this.segCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.lines.frustumCulled = false; scene.add(this.lines);
    this.segs = []; this.rings = []; this.t = 0;
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 64); this.ringGeo.rotateX(-Math.PI / 2); this.discGeo = new THREE.CircleGeometry(1, 48); this.discGeo.rotateX(-Math.PI / 2);
  }
  // ── primitives ──
  puff(x, y, z, o) { this.smoke.add(Object.assign({ x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life: 1.5, a0: 0.5, s0: 0.5, s1: 2, rot: Math.random() * 6.28, c0: [0.5, 0.5, 0.5] }, o)); }
  spark(x, y, z, o) { this.glow.add(Object.assign({ x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.2, a0: 1, s0: 0.3, s1: 0.1, rot: 0, c0: [1, 0.7, 0.3] }, o)); }
  seg(a, b, c, life, o = {}) { this.segs.push(Object.assign({ a: a.clone(), b: b.clone(), c, life, age: 0 }, o)); if (this.segs.length > this.segMax) this.segs.shift(); }
  ring(x, z, y, r0, r1, life, color, o = {}) {
    const m = new THREE.Mesh(o.disc ? this.discGeo : this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o.a || 0.8, depthWrite: false, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide }));
    m.position.set(x, y + 0.15, z); m.scale.setScalar(r0); m.renderOrder = 3; this.scene.add(m); this.rings.push(Object.assign({ m, r0, r1, life, age: 0, a0: o.a || 0.8 }, o)); return m;
  }
  // ── composite effects ──
  muzzle(p, dir, kind = 'rifle') {
    const big = kind === 'cannon' ? 1 : kind === 'naval' ? 1.1 : kind === 'rocket' ? 0.7 : kind === 'pulse' ? 0.25 : 0.18;
    const col = kind === 'pulse' ? [0.45, 1, 0.95] : [1, 0.75, 0.35];
    this.spark(p.x, p.y, p.z, { life: kind === 'cannon' || kind === 'naval' ? 0.05 : 0.04, s0: 2.2 * big, s1: 1.2 * big, c0: col, a0: 1 });
    this.spark(p.x + dir.x * 0.5 * big, p.y + dir.y * 0.5 * big, p.z + dir.z * 0.5 * big, { life: 0.05, s0: 1.4 * big, s1: 0.4 * big, c0: [1, 0.9, 0.6] });
    if (kind === 'cannon' || kind === 'naval') { for (let k = 0; k < 10; k++) { const s = 2 + Math.random() * 6; this.puff(p.x + dir.x, p.y, p.z + dir.z, { vx: dir.x * s + (Math.random() - 0.5) * 3, vy: 0.6 + Math.random(), vz: dir.z * s + (Math.random() - 0.5) * 3, drag: 1.8, life: 0.35 + Math.random() * 0.3, s0: 0.8, s1: 3.5, a0: 0.45, c0: [0.62, 0.58, 0.52] }); } }
    if (kind === 'rocket') for (let k = 0; k < 6; k++) this.puff(p.x - dir.x * 1.2, p.y, p.z - dir.z * 1.2, { vx: -dir.x * (3 + Math.random() * 4), vy: 0.4, vz: -dir.z * (3 + Math.random() * 4), drag: 2, life: 0.8, s0: 0.4, s1: 2, a0: 0.4, c0: [0.75, 0.73, 0.7] });
  }
  dustKick(p, amount, wet) {
    for (let k = 0; k < amount; k++) this.puff(p.x + (Math.random() - 0.5) * 1.2, p.y + 0.2, p.z + (Math.random() - 0.5) * 1.2, wet
      ? { vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, g: 6, life: 0.7, s0: 0.4, s1: 1.4, a0: 0.45, c0: [0.85, 0.92, 0.95] }
      : { vx: (Math.random() - 0.5) * 1.5, vy: 0.4 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 1.5, drag: 1, life: 1.6 + Math.random(), s0: 0.6, s1: 3.2, a0: 0.22, c0: [0.62, 0.55, 0.43] });
  }
  impact(p, kind, wet, scale = 1) {
    if (wet) { for (let k = 0; k < 14 * scale; k++) this.puff(p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 3, vy: 4 + Math.random() * 6 * scale, vz: (Math.random() - 0.5) * 3, g: 9.8, life: 1.0, s0: 0.5 * scale, s1: 1.6 * scale, a0: 0.55, c0: [0.88, 0.93, 0.96], floor: p.y }); this.ring(p.x, p.z, p.y - 0.1, 0.5, 3 * scale, 1.2, 0xe8f2f4, { a: 0.5 }); return; }
    const cyan = kind === 'pulse'; const n = kind === 'hitscan' || cyan ? 4 : 10;
    for (let k = 0; k < n * scale; k++) this.spark(p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 9, vy: Math.random() * 7, vz: (Math.random() - 0.5) * 9, g: 14, life: 0.18 + Math.random() * 0.2, s0: 0.15, s1: 0.05, c0: cyan ? [0.4, 1, 0.95] : [1, 0.75, 0.35] });
    this.spark(p.x, p.y, p.z, { life: 0.08, s0: (cyan ? 0.6 : 1.2) * scale, s1: 0.2, c0: cyan ? [0.5, 1, 1] : [1, 0.85, 0.55] });
    if (!cyan && kind !== 'hitscan') for (let k = 0; k < 6 * scale; k++) this.puff(p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 2, drag: 1.2, life: 0.9, s0: 0.4 * scale, s1: 2.2 * scale, a0: 0.4, c0: [0.35, 0.33, 0.3] });
  }
  explosion(p, r, wet) {
    this.spark(p.x, p.y + 0.5, p.z, { life: 0.12, s0: r * 2.4, s1: r * 1.2, c0: [1, 0.85, 0.55] });
    for (let k = 0; k < 26; k++) { const a = Math.random() * 6.283, s = 4 + Math.random() * 10; this.spark(p.x, p.y + 0.5, p.z, { vx: Math.cos(a) * s, vy: 2 + Math.random() * 9, vz: Math.sin(a) * s, g: 9.8, life: 0.4 + Math.random() * 0.5, s0: 0.35, s1: 0.1, c0: [1, 0.7, 0.3] }); }
    for (let k = 0; k < 16; k++) this.spark(p.x + (Math.random() - 0.5) * r, p.y + Math.random() * 2, p.z + (Math.random() - 0.5) * r, { vy: 1.5, life: 0.35 + Math.random() * 0.25, s0: 2.5, s1: 1, c0: [1, 0.55, 0.2], c1: [0.6, 0.15, 0.05] });
    for (let k = 0; k < 22; k++) this.puff(p.x + (Math.random() - 0.5) * r * 0.8, p.y + Math.random() * 1.5, p.z + (Math.random() - 0.5) * r * 0.8, wet
      ? { vx: (Math.random() - 0.5) * 4, vy: 7 + Math.random() * 9, vz: (Math.random() - 0.5) * 4, g: 9.8, life: 1.6, s0: 1, s1: 3.5, a0: 0.6, c0: [0.9, 0.94, 0.97], floor: p.y }
      : { vx: (Math.random() - 0.5) * 3, vy: 1.5 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, drag: 0.8, life: 2.6 + Math.random() * 1.5, s0: 1.4, s1: 6.5, a0: 0.5, c0: [0.25, 0.22, 0.2], c1: [0.42, 0.4, 0.38] });
    this.ring(p.x, p.z, p.y, 0.5, r * 1.6, 0.45, 0xffd8a0, { a: 0.55, add: true });
  }
  smokeColumn(p, n = 1, dark = true) { for (let k = 0; k < n; k++) this.puff(p.x + (Math.random() - 0.5), p.y, p.z + (Math.random() - 0.5), { vx: 0.6 + (Math.random() - 0.5) * 0.6, vy: 2 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 0.6, drag: 0.4, life: 3.5, s0: 0.8, s1: 5, a0: dark ? 0.4 : 0.25, c0: dark ? [0.13, 0.12, 0.11] : [0.6, 0.6, 0.6], c1: [0.38, 0.37, 0.36] }); }
  trail(p, kind) { // missile / rocket trail sample
    const c = kind === 'cyan' ? [0.75, 0.95, 0.95] : [0.78, 0.77, 0.74];
    this.puff(p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 0.3, vy: 0.2, vz: (Math.random() - 0.5) * 0.3, drag: 0.6, life: kind === 'cyan' ? 0.5 : 0.6 + Math.random() * 0.2, s0: 0.3, s1: 1.3, a0: 0.42, c0: c });
    this.spark(p.x, p.y, p.z, { life: 0.06, s0: 0.5, s1: 0.2, c0: kind === 'cyan' ? [0.5, 1, 1] : [1, 0.8, 0.45] });
  }
  wake(p, s, side = 0) { this.puff(p.x, 0.06, p.z, { vx: side * 0.8, vy: 0, vz: 0, drag: 0.5, life: 3.2 + s * 0.2, s0: 0.6 + s * 0.12, s1: 2.5 + s * 0.35, a0: Math.min(0.5, 0.12 + s * 0.04), c0: [0.9, 0.95, 0.97], fadeIn: 0.05, fp: 1.0 }); }
  update(dt, camera) {
    this.t += dt; this.smoke.update(dt); this.glow.update(dt);
    let k = 0; const keep = [];
    for (const s of this.segs) { s.age += dt; if (s.age >= s.life) continue; keep.push(s); if (k >= this.segMax) continue; const f = 1 - s.age / s.life;
      let a = s.a, b = s.b; if (s.travel) { const t0 = Math.min(1, s.age / s.life * 1.0), t1 = Math.min(1, t0 + s.travel); a = s.a.clone().lerp(s.b, t0); b = s.a.clone().lerp(s.b, t1); }
      this.segPos.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6); this.segCol.set([s.c[0] * f, s.c[1] * f, s.c[2] * f, s.c[0] * f * 0.6, s.c[1] * f * 0.6, s.c[2] * f * 0.6], k * 6); k++; }
    this.segs = keep; this.lines.geometry.setDrawRange(0, k * 2); this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
    const rk = [];
    for (const r of this.rings) { r.age += dt; const t = Math.min(1, r.age / r.life); if (r.age >= r.life && !r.hold) { this.scene.remove(r.m); r.m.material.dispose(); continue; } rk.push(r);
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * (r.ease === false ? t : 1 - (1 - t) * (1 - t))); r.m.material.opacity = r.hold ? r.a0 : r.a0 * (1 - t * t); if (r.follow) r.m.position.copy(r.follow()); }
    this.rings = rk;
  }
  removeRing(m) { const r = this.rings.find((q) => q.m === m); if (r) { r.hold = false; r.age = r.life; } }
}
