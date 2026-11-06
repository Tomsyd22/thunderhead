// Terrain, water, sky and props for the Unit Sandbox. Sim (x east, y north, z up) → three (x, z, -y).
import * as THREE from 'three';
import { fbm, FEATURES } from './terrain.js';

export const toV = (x, y, z, v = new THREE.Vector3()) => v.set(x, z, -y);

function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noiseImage(size, scale, oct, seed, f) {
  // tileable value-noise fBm: lattice indices wrap at the period, so the texture repeats without seams or rings
  const img = new ImageData(size, size);
  const h = (i, j, s) => { let x = (i * 374761393 + j * 668265263 + s * 982451653) | 0; x = (x ^ (x >>> 13)) * 1274126177 | 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, P, s) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const I = (k) => ((k % P) + P) % P;
    const a = h(I(i), I(j), s), b = h(I(i + 1), I(j), s), c = h(I(i), I(j + 1), s), d = h(I(i + 1), I(j + 1), s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let n = 0, amp = 0.5, P = Math.max(2, Math.round(scale)); for (let o = 0; o < oct; o++) { n += amp * vn(i / size * P, j / size * P, P, seed + o * 7); P *= 2; amp *= 0.5; }
    const c = f(n, i, j); const k = (j * size + i) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  return img;
}

export function buildTerrain(T, scene, quality = 1) {
  const step = quality >= 1 ? 2 : 4; const nx = Math.floor(T.W / step) + 1, ny = Math.floor(T.H / step) + 1;
  const geo = new THREE.BufferGeometry(); const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
  const C = { grass: [0.30, 0.36, 0.19], grass2: [0.38, 0.40, 0.22], dirt: [0.42, 0.35, 0.25], rock: [0.42, 0.40, 0.37], sand: [0.72, 0.64, 0.48], wetsand: [0.52, 0.46, 0.35], bed: [0.46, 0.43, 0.33], pad: [0.55, 0.55, 0.53] };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const F = T.features;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * step, y = j * step, h = T.height(x, y), k = j * nx + i, s = T.slopeDeg(x, y);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -y; uv[k * 2] = x / 9; uv[k * 2 + 1] = y / 9;
    let c = mix(C.grass, C.grass2, fbm(x / 40, y / 40, 71));
    c = mix(c, C.dirt, Math.min(1, Math.max(0, (fbm(x / 25, y / 25, 73) - 0.55) * 4)));
    if (h < 1.6) c = mix(c, C.sand, Math.min(1, (1.6 - h) / 1.2));
    if (h < 0.3) c = mix(c, C.wetsand, Math.min(1, (0.3 - h) / 0.5));
    if (h < -0.8) c = mix(c, C.bed, Math.min(1, (-0.8 - h) / 2));
    if (s > 22) c = mix(c, C.rock, Math.min(1, (s - 22) / 12));
    const A = F.airfield; if (Math.abs(x - A.x) < A.w / 2 && Math.abs(y - A.y) < A.h / 2) c = mix(c, C.pad, 0.85);
    const B = F.bunker; if (Math.abs(x - B.x) < 11 && Math.abs(y - B.y) < 11) c = mix(c, C.pad, 0.7);
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let q = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }  // CCW seen from above (+Y)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  const detail = canvasTex(256, (g, n) => g.putImageData(noiseImage(n, 6, 5, 3, (v) => { const c = 165 + (v - 0.5) * 170; return [c, c, c]; }), 0, 0));
  detail.colorSpace = THREE.NoColorSpace;
  const bump = canvasTex(256, (g, n) => g.putImageData(noiseImage(n, 12, 4, 11, (v) => { const c = v * 255; return [c, c, c]; }), 0, 0)); bump.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, bumpMap: bump, bumpScale: 1.2, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'terrain'; scene.add(mesh);
  return mesh;
}

export function buildWater(T, scene) {
  // water surface at z = 0 over the wet part of the range; colour/alpha from depth, shore foam, scrolling ripples
  const step = 4, nx = Math.floor(T.W / step) + 1, ny = Math.floor(T.H / step) + 1;
  const geo = new THREE.PlaneGeometry(T.W, T.H, nx - 1, ny - 1); geo.rotateX(-Math.PI / 2); geo.translate(T.W / 2, 0, -T.H / 2);
  const p = geo.attributes.position; const col = new Float32Array(p.count * 4);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = -p.getZ(k), d = -T.height(x, y);
    const t = Math.min(1, Math.max(0, d / 9));
    const shallow = [0.32, 0.62, 0.62], deep = [0.04, 0.17, 0.27]; let c = [shallow[0] + (deep[0] - shallow[0]) * t, shallow[1] + (deep[1] - shallow[1]) * t, shallow[2] + (deep[2] - shallow[2]) * t];
    let a = d <= -0.3 ? 0 : Math.min(0.92, 0.28 + d * 0.22);
    if (d > -0.3 && d < 0.35) { const f = 1 - Math.abs(d - 0.05) / 0.35; c = [c[0] + (0.9 - c[0]) * f * 0.7, c[1] + (0.93 - c[1]) * f * 0.7, c[2] + (0.92 - c[2]) * f * 0.7]; a = Math.max(a, 0.55 * f); }
    col[k * 4] = c[0]; col[k * 4 + 1] = c[1]; col[k * 4 + 2] = c[2]; col[k * 4 + 3] = a;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const nrm = canvasTex(256, (g, n) => {
    const img = noiseImage(n, 8, 4, 21, (v, i, j) => [0, 0, v * 255]); const h = new Float32Array(n * n); for (let k = 0; k < n * n; k++) h[k] = img.data[k * 4 + 2] / 255;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, dx = h[j * n + (i + 1) % n] - h[j * n + (i - 1 + n) % n], dy = h[((j + 1) % n) * n + i] - h[((j - 1 + n) % n) * n + i]; const v = [-dx * 3, -dy * 3, 1]; const l = Math.hypot(...v); img.data[k * 4] = (v[0] / l * 0.5 + 0.5) * 255; img.data[k * 4 + 1] = (v[1] / l * 0.5 + 0.5) * 255; img.data[k * 4 + 2] = (v[2] / l * 0.5 + 0.5) * 255; }
    g.putImageData(img, 0, 0);
  });
  nrm.colorSpace = THREE.NoColorSpace; nrm.repeat.set(T.W / 18, T.H / 18);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.12, metalness: 0.15, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'water'; mesh.renderOrder = 2; mesh.receiveShadow = true; scene.add(mesh);
  mesh.userData.tick = (t) => { nrm.offset.set(t * 0.012, t * 0.007); };
  return mesh;
}

export function buildProps(T, scene, world) {
  const grp = new THREE.Group(); grp.name = 'props'; scene.add(grp);
  // boulders: displaced icosahedra, instanced by kind
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d776d, roughness: 0.92, flatShading: true });
  const kinds = [0, 1, 2].map((k) => { const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const n = 0.75 + 0.5 * fbm(v.x * 2 + k * 7, v.y * 2 + v.z * 1.3, 90 + k); v.multiplyScalar(n); v.y *= 0.62; p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; });
  for (let k = 0; k < 3; k++) {
    const list = T.rocks.filter((r) => r.kind === k); const im = new THREE.InstancedMesh(kinds[k], rockMat, list.length); im.castShadow = im.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    list.forEach((r, i) => { q.setFromEuler(new THREE.Euler(0, r.rot, 0)); s.set(r.r, r.r * 0.9, r.r); m.compose(new THREE.Vector3(r.x, T.height(r.x, r.y) + r.r * 0.15, -r.y), q, s); im.setMatrixAt(i, m); });
    grp.add(im);
  }
  // shrubs and conifers on gentle grass
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x5f8248, roughness: 0.9, flatShading: true }), trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4e38, roughness: 0.9 });
  const cone = new THREE.ConeGeometry(2.4, 5.5, 8); cone.translate(0, 4.6, 0); const cone2 = new THREE.ConeGeometry(1.7, 4.2, 8); cone2.translate(0, 7.4, 0);
  { const merged = [cone, cone2]; const pos = []; const nor = []; for (const g of merged) { const gg = g.toNonIndexed(); pos.push(...gg.attributes.position.array); nor.push(...gg.attributes.normal.array); } const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); var coneM = mg; } const trunk = new THREE.CylinderGeometry(0.25, 0.32, 2.5, 6); trunk.translate(0, 1.25, 0);
  const pts = []; for (let k = 0; k < 420 && pts.length < 140; k++) { const x = fbm(k * 1.7, 3.3, 5) * T.W * 1.6 - T.W * 0.3, y = fbm(2.1, k * 1.3, 7) * T.H * 1.6 - T.H * 0.3; if (x < 5 || y < 5 || x > T.W - 5 || y > T.H - 5) continue; const h = T.height(x, y); if (h < 2 || T.slopeDeg(x, y) > 14) continue; if (world.nav.okAt('veh', x, y, 0) && fbm(x / 60, y / 60, 3) < 0.48) continue; const F = T.features; if (Math.abs(x - F.airfield.x) < 80 && Math.abs(y - F.airfield.y) < 55) continue; if (Math.abs(x - F.bunker.x) < 25 && Math.abs(y - F.bunker.y) < 25) continue; if (Math.hypot(x - F.econ.refinery.x, y - F.econ.refinery.y) < 60 || F.econ.deposits.some((d) => Math.hypot(x - d.rig[0] - d.dir[0] * 8, y - d.rig[1] - d.dir[1] * 8) < 45)) continue; pts.push([x, y, h]); }
  const imT = new THREE.InstancedMesh(coneM, treeMat, pts.length), imK = new THREE.InstancedMesh(trunk, trunkMat, pts.length); imT.castShadow = true; imK.castShadow = true;
  const m = new THREE.Matrix4(); pts.forEach(([x, y, h], i) => { const s = 0.7 + 0.6 * fbm(x, y, 2); m.makeScale(s, s, s).setPosition(x, h - 0.2, -y); imT.setMatrixAt(i, m); imK.setMatrixAt(i, m); });
  grp.add(imT, imK);
  // airfield pads with markings
  const A = T.features.airfield; const padMat = new THREE.MeshStandardMaterial({ color: 0x6d6c68, roughness: 0.8 }), lineMat = new THREE.MeshBasicMaterial({ color: 0xe6d690 });
  for (const p of A.pads) {
    const z = T.height(p.x, p.y) + 0.05; const pad = new THREE.Mesh(new THREE.BoxGeometry(22, 0.12, 22), padMat); pad.position.set(p.x, z, -p.y); pad.receiveShadow = true; grp.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.2, 7.8, 40), lineMat); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, z + 0.08, -p.y); grp.add(ring);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 9), lineMat); bar.rotation.x = -Math.PI / 2; bar.rotation.z = Math.PI / 2 + p.hdg; bar.position.set(p.x, z + 0.081, -p.y); grp.add(bar);
  }
  for (const h of A.heli) { const z = T.height(h.x, h.y) + 0.05; const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.12, 32), padMat); pad.position.set(h.x, z, -h.y); pad.receiveShadow = true; grp.add(pad); const r = new THREE.Mesh(new THREE.RingGeometry(6, 6.6, 40), lineMat); r.rotation.x = -Math.PI / 2; r.position.set(h.x, z + 0.08, -h.y); grp.add(r); }
  return grp;
}

export function buildStructure(b, T) {
  // bunker / shore target: concrete block with chamfered roof, firing ports, sandbags
  const g = new THREE.Group(); const z = T.height(b.x, b.y);
  const conc = new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.85 }), dark = new THREE.MeshStandardMaterial({ color: 0x1d1d1c, roughness: 0.9 }), bag = new THREE.MeshStandardMaterial({ color: 0x8c7a55, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), conc); body.position.y = b.h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(b.w * 0.36, b.w * 0.5, 0.8, 4, 1), conc); roof.rotation.y = Math.PI / 4; roof.position.y = b.h + 0.4; roof.castShadow = true; g.add(roof);
  for (const p of b.ports || []) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.4), dark); const ax = Math.abs(p[0]) > Math.abs(p[1]); s.position.set(p[0] * 0.98, b.h * 0.6, -p[1] * 0.98); s.rotation.y = Math.atan2(p[0], -p[1]); g.add(s); }
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; const sb = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 2, 6), bag); sb.rotation.z = Math.PI / 2; sb.rotation.y = a; const r = b.w * 0.82; sb.position.set(Math.cos(a) * r, 0.28, Math.sin(a) * r); sb.castShadow = true; g.add(sb); }
  g.position.set(b.x, z, -b.y); return g;
}

export function buildSky(scene, renderer) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#6d8fb3'); gr.addColorStop(0.55, '#a9bfd2'); gr.addColorStop(1, '#d9dcd6'); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; scene.background = t;
  scene.fog = new THREE.Fog(0xc4cdd3, 380, 1250);
  const hemi = new THREE.HemisphereLight(0xcfe0f0, 0x5a5440, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-160, 260, 120); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 700; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun); scene.add(sun.target);
  return { sun, hemi };
}

// ore field at an extraction rig: the 50 × 50 m service area (gravel), ore mounds beside the rig and two gravel piles,
// laid out as the maps place them (maps/gen/place.py deposits()): rig at centre − dir·8, service point at centre + dir·13
export function buildOreField(d, T) {
  const g = new THREE.Group(); g.name = 'ore_' + d.id; const [cx, cy] = d.centre, z = T.height(cx, cy);
  const tex = canvasTex(256, (c, n) => c.putImageData(noiseImage(n, 9, 4, 71, (v, x, y) => { const sp = ((x * 73 + y * 151) % 97) / 97; const k = 0.62 + 0.38 * v + (sp > 0.93 ? 0.18 : 0); return [140 * k, 128 * k, 108 * k]; }), 0, 0));
  tex.repeat.set(4, 4);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(cx, z + 0.04, -cy); pad.receiveShadow = true; g.add(pad);
  const ore = new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.45, metalness: 0.55, flatShading: true }), grav = new THREE.MeshStandardMaterial({ color: 0x8b8170, roughness: 0.95, flatShading: true });
  const u = d.dir, v = [-u[1], u[0]]; const at = (a, b) => [cx + u[0] * a + v[0] * b, cy + u[1] * a + v[1] * b];
  const mounds = [[-14, -15, 3.2], [-12, -8, 2.4], [-16, 7, 2.8], [-10, 13, 2.2], [-18, 16, 1.8], [-6, -18, 1.6], [-20, -4, 2.0]];
  mounds.forEach(([a, b, r], k) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), ore); const [x, y] = at(a, b); m.scale.set(1, 0.45, 1.15); m.rotation.y = k * 1.3; m.position.set(x, z + r * 0.3, -y); m.castShadow = m.receiveShadow = true; g.add(m); });
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.ConeGeometry(4.2, 3.4, 9), grav); const [x, y] = at(-6, s * 17); m.position.set(x, z + 1.7, -y); m.castShadow = m.receiveShadow = true; g.add(m); }
  // service-point marker: painted bay lines where the harvester parks
  const line = new THREE.MeshBasicMaterial({ color: 0xe0b84a }); const [sx, sy] = d.svc;
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(13, 0.3), line); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(v[1], v[0]); const p = [sx + u[0] * s * 3, sy + u[1] * s * 3]; m.position.set(p[0], z + 0.06, -p[1]); g.add(m); }
  return g;
}
