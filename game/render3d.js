/* Thunderhead real-time 3D renderer (Three.js r160).
   Same interface as the old 2D renderer — init, bakeTerrain, frame, handleEvent, screenToWorld, worldToScreen, clampCam, centerOn,
   speech, updateFog, explosion, setStarts — so the simulation, AI and UI are untouched.
   World mapping: 1 scene unit = 1 map cell (32 px). Sim x → scene X, sim y → scene Z, height → scene Y. Global out: RENDER. */
const RENDER = (() => {
'use strict';
const { G, CELL, MAPW, MAPH, FOOT, isAir, isInf, isStruct, hasTag, idx, inMap, visibleTo, canSee } = SIM;
const T = THREE, TT = SIM.TT, U = 1 / CELL;
const { MODELS, PAL } = ARTMODELS;
const S = { cam: { x: 0, y: 0, zoom: 1 }, views: new Map(), fx: [], time: 0, sel: [], placing: null, box: null, marker: null, shake: 0, shakeX: 0, shakeY: 0, reduced: false, app: { screen: { width: 1, height: 1 } }, decals: [], lowEnd: false };
const AT = { ready: false, promise: null };
const GLBP = {};
function loadGLBs() { const keys = typeof GLB_MODELS !== 'undefined' ? Object.keys(GLB_MODELS) : []; if (!keys.length) { AT.ready = true; return; } const loader = new T.GLTFLoader(); AT.promise = Promise.all(keys.map(k => new Promise(res => { try { const bin = Uint8Array.from(atob(GLB_MODELS[k]), c => c.charCodeAt(0)); loader.parse(bin.buffer, '', g => { GLBP[k] = g; res(); }, err => { console.error('glb', k, err); res(); }); } catch (err) { console.error('glb', k, err); res(); } }))).then(() => { AT.ready = true; PROTO.clear(); }); }
const FOV = 32, ELEV = 54 * Math.PI / 180, AIR_H = 1.75, WATER_Y = -0.16;
let R, scene, camera, sun, hemi, ovc, ov, world, terrain, water, decorGroup, oreGold, oreGem, startG, ghostG, markerMesh;
const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0), _v2 = new T.Vector2(), _v3 = new T.Vector3(), _hit = new T.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16); return (h >>> 0) / 4294967296; }
const rgb = hex => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// ───────── fog of war: every world material samples the visibility texture by world position ─────────
const fogData = new Uint8Array(MAPW * MAPH * 4);
const fogTex = new T.DataTexture(fogData, MAPW, MAPH, T.RGBAFormat); fogTex.magFilter = T.LinearFilter; fogTex.minFilter = T.LinearFilter; fogTex.needsUpdate = true;
const FOGU = { uFog: { value: fogTex }, uMap: { value: new T.Vector2(MAPW, MAPH) } };
const VS_DECL = '\nvarying vec3 vWPos;\nvarying vec3 vWN;\n';
const VS_BODY = '\n#ifdef USE_INSTANCING\n vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif\n vWN = normalize(mat3(modelMatrix) * objectNormal);\n';
const FS_DECL = '\nvarying vec3 vWPos;\nvarying vec3 vWN;\nuniform sampler2D uFog;\nuniform vec2 uMap;\n';
const FS_FOG = '\n gl_FragColor.rgb *= texture2D(uFog, vWPos.xz / uMap).r;\n';
function fogify(mat, extra, key) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uFog = FOGU.uFog; sh.uniforms.uMap = FOGU.uMap;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + VS_DECL).replace('#include <project_vertex>', '#include <project_vertex>' + VS_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + FS_DECL).replace('#include <dithering_fragment>', '#include <dithering_fragment>' + FS_FOG);
    if (extra) extra(sh);
  };
  mat.customProgramCacheKey = () => 'fog:' + (key || '') + ':' + mat.type;
  return mat;
}
// MeshBasicMaterial has no normals in its vertex stage → provide objectNormal there
const BASIC_FIX = sh => { sh.vertexShader = sh.vertexShader.replace('vWN = normalize(mat3(modelMatrix) * objectNormal);', 'vWN = vec3(0.0, 1.0, 0.0);'); };

// ───────── terrain themes ─────────
const THEMES = {
  grass:  { ground0: 0x3d5c2c, ground1: 0x557a3c, scrub: 0x2a4520, sand0: 0x8f8460, sand1: 0xa89d72, rock0: 0x58524b, rock1: 0x746b60, road0: 0x56564f, road1: 0x6a6a62, bush: 0x2f5a26, tree: 0x2c5222, trunk: 0x4a3828 },
  desert: { ground0: 0xbf9f62, ground1: 0xd6b676, scrub: 0x9a8a52, sand0: 0xd7c08a, sand1: 0xe7d4a2, rock0: 0x86684a, rock1: 0xa4805c, road0: 0x988a72, road1: 0xaa9c84, bush: 0x8a8448, tree: 0x6e7a3a, trunk: 0x5a4430 },
  urban:  { ground0: 0x4d5d42, ground1: 0x627452, scrub: 0x34502c, sand0: 0x8a8a70, sand1: 0x9c9c82, rock0: 0x55555a, rock1: 0x6c6c70, road0: 0x56564f, road1: 0x6e6e68, bush: 0x355a2e, tree: 0x2f5428, trunk: 0x4a3828 },
};
const TERRAIN_GLSL = `
uniform sampler2D uSplat; uniform sampler2D uAux; uniform sampler2D uDecal; uniform sampler2D uDetail; uniform float uDetailOn;
vec2 th_grad; float th_ws;
uniform vec3 uGround0, uGround1, uScrub, uSand0, uSand1, uRock0, uRock1, uRoad0, uRoad1;
float th_hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float th_noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(th_hash(i), th_hash(i+vec2(1.,0.)), u.x), mix(th_hash(i+vec2(0.,1.)), th_hash(i+vec2(1.,1.)), u.x), u.y); }
float th_fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * th_noise(p); p *= 2.03; a *= .5; } return v; }
`;
const TERRAIN_FRAG = `
  vec2 cuv = vWPos.xz / uMap;
  vec2 warp = (vec2(th_noise(vWPos.xz * 1.1), th_noise(vWPos.xz * 1.1 + 17.3)) - 0.5) * 0.85 + (vec2(th_noise(vWPos.xz * 3.7 + 5.1), th_noise(vWPos.xz * 3.7 + 9.7)) - 0.5) * 0.3;
  vec2 wuv = (vWPos.xz + warp) / uMap;
  vec4 sp = texture2D(uSplat, wuv); vec4 ax = texture2D(uAux, wuv);
  float n1 = th_fbm(vWPos.xz * 0.45); float n2 = th_noise(vWPos.xz * 5.0); float n4 = th_noise(vWPos.xz * 1.7);
  // tileable detail (4 cells per tile) sampled at two scales/rotations to hide repetition
  vec2 duv = vWPos.xz * 0.25; vec2 duv2 = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz * 0.11 + 0.37;
  vec4 dA = texture2D(uDetail, duv), dB = texture2D(uDetail, duv2); vec4 det = mix(vec4(0.5), mix(dA, dB, 0.35 + 0.3 * n4), uDetailOn);
  float n3 = det.r;
  vec3 grd = mix(uGround0, uGround1, smoothstep(0.25, 0.75, n1));
  grd *= 0.72 + 0.56 * det.r;
  grd = mix(grd, uScrub, ax.r * smoothstep(0.3, 0.62, n4 * 0.7 + n2 * 0.3));
  float ore = ax.b * smoothstep(0.32, 0.62, th_fbm(vWPos.xz * 2.3) * 0.75 + n4 * 0.35);
  vec3 snd = mix(uSand0, uSand1, n2 * 0.5 + det.g * 0.5) * (0.84 + 0.3 * det.g);
  vec3 rck = mix(uRock0, uRock1, n1 * 0.5 + det.b * 0.5) * (0.6 + 0.7 * det.b);
  vec3 rd = mix(uRoad0, uRoad1, n2) * (0.7 + 0.5 * det.a);
  // height-based splat blending: the higher material wins at boundaries (sand settles into rock cracks etc.)
  vec4 hw = sp * pow(det + 0.35, vec4(4.0)) ; hw = mix(sp, hw, uDetailOn * 0.85);
  float ws = hw.r + hw.g + hw.b + hw.a + 1e-4;
  vec3 col = (grd * hw.r + snd * hw.g + rck * hw.b + rd * hw.a) / ws;
  // per-pixel bump from the blended height (finite differences in detail space)
  vec2 e = vec2(1.5 / 1024.0, 0.0);
  vec4 dx = texture2D(uDetail, duv + e.xy) - dA, dy = texture2D(uDetail, duv + e.yx) - dA; vec4 bw = hw / ws;
  th_grad = vec2(dot(dx, bw), dot(dy, bw)) * uDetailOn; th_ws = 1.0;
  float kerb = sp.a * (1.0 - sp.a) * 4.0; col = mix(col, uRoad1 * 1.35, smoothstep(0.6, 0.95, kerb) * 0.55);
  float slope = 1.0 - clamp(vWN.y, 0.0, 1.0); col = mix(col, rck * 0.8, smoothstep(0.22, 0.5, slope));
  col *= mix(1.0, 0.5, smoothstep(-0.04, -0.4, vWPos.y));
  vec3 oreCol = mix(vec3(0.42, 0.27, 0.06), vec3(0.75, 0.5, 0.12), n3); if (ax.a < 0.99) oreCol = mix(vec3(0.1, 0.25, 0.5), vec3(0.25, 0.5, 0.85), n3); col = mix(col, oreCol, ore * 0.72);
  vec4 dc = texture2D(uDecal, cuv); col = mix(col, dc.rgb, dc.a);
  diffuseColor.rgb = col;
`;
let terrainUniforms = null;
let DETAIL = null; function detailTex() { if (DETAIL) return DETAIL; const src = typeof TEX_ASSETS !== 'undefined' && TEX_ASSETS.terrain_detail; if (!src) return (DETAIL = null, new T.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, T.RGBAFormat)); DETAIL = new T.Texture(); const img = new Image(); img.onload = () => { DETAIL.image = img; DETAIL.needsUpdate = true; if (terrainUniforms) terrainUniforms.uDetailOn.value = 1; }; img.src = src; DETAIL.wrapS = DETAIL.wrapT = T.RepeatWrapping; DETAIL.colorSpace = T.NoColorSpace; DETAIL.generateMipmaps = true; DETAIL.minFilter = T.LinearMipmapLinearFilter; DETAIL.magFilter = T.LinearFilter; DETAIL.anisotropy = R ? Math.min(8, R.capabilities.getMaxAnisotropy()) : 1; return DETAIL; }
function themeOf() { return THEMES[G.theme] || THEMES.grass; }

// ───────── init / resize / camera ─────────
function init(canvas) {
  S.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  S.lowEnd = coarse && Math.min(screen.width, screen.height) < 500;
  R = new T.WebGLRenderer({ canvas, antialias: !navigator.webdriver, powerPreference: 'high-performance' });
  S.pr = navigator.webdriver ? 1 : Math.min(S.lowEnd ? 1.5 : 2, window.devicePixelRatio || 1); R.setPixelRatio(S.pr);
  R.outputColorSpace = T.SRGBColorSpace; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1.08;
  R.shadowMap.enabled = !S.lowEnd; R.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene(); scene.background = new T.Color(0x07090c);
  camera = new T.PerspectiveCamera(FOV, 1, 0.5, 500);
  hemi = new T.HemisphereLight(0xdde8ff, 0x3a3428, 0.85); scene.add(hemi);
  sun = new T.DirectionalLight(0xfff1dc, 2.6); sun.castShadow = R.shadowMap.enabled; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025; scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xa8c0ff, 0.5); fill.position.set(40, 25, -30); scene.add(fill);
  world = new T.Group(); scene.add(world);
  ovc = document.createElement('canvas'); ovc.id = 'ov'; ovc.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;'; canvas.after(ovc); ov = ovc.getContext('2d');
  PARTS.add = new Particles(3500, true); PARTS.smoke = new Particles(3000, false); loadGLBs();
  resize(); window.addEventListener('resize', resize);
}
function resize() { const w = window.innerWidth, h = window.innerHeight; S.app.screen.width = w; S.app.screen.height = h; R.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); const pr = Math.min(2, window.devicePixelRatio || 1); ovc.width = Math.round(w * pr); ovc.height = Math.round(h * pr); ov.setTransform(pr, 0, 0, pr, 0, 0); PSCALE.value = h * S.pr / (2 * Math.tan(FOV * Math.PI / 360)); }
function camTarget(withShake) { const W = S.app.screen.width, H = S.app.screen.height; return { x: (S.cam.x + W / S.cam.zoom / 2 + (withShake ? S.shakeX : 0)) * U, z: (S.cam.y + H / S.cam.zoom / 2 + (withShake ? S.shakeY : 0)) * U }; }
function camDist() { const span = S.app.screen.height / S.cam.zoom * U; return span * Math.sin(ELEV) / (2 * Math.tan(FOV * Math.PI / 360)); }
function updateCamera(withShake) { const t = camTarget(withShake), d = camDist(); camera.position.set(t.x, d * Math.sin(ELEV), t.z + d * Math.cos(ELEV)); camera.lookAt(t.x, 0, t.z); camera.far = d * 4 + 60; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); return t; }
function screenToWorld(sx, sy) { updateCamera(false); _v2.set(sx / S.app.screen.width * 2 - 1, -(sy / S.app.screen.height) * 2 + 1); ray.setFromCamera(_v2, camera); if (!ray.ray.intersectPlane(ground, _hit)) return { x: S.cam.x, y: S.cam.y }; return { x: _hit.x * CELL, y: _hit.z * CELL }; }
function worldToScreen(x, y, h = 0) { _v3.set(x * U, h, y * U).project(camera); return { x: (_v3.x + 1) / 2 * S.app.screen.width, y: (1 - _v3.y) / 2 * S.app.screen.height, z: _v3.z }; }
function clampCam() { const hw = S.app.screen.width / S.cam.zoom / 2, hh = S.app.screen.height / S.cam.zoom / 2; S.cam.x = clamp(S.cam.x, -hw + CELL * 2, MAPW * CELL - hw - CELL * 2); S.cam.y = clamp(S.cam.y, -hh + CELL * 2, MAPH * CELL - hh + CELL * 2); }
function centerOn(x, y) { S.cam.x = x - S.app.screen.width / S.cam.zoom / 2; S.cam.y = y - S.app.screen.height / S.cam.zoom / 2; clampCam(); }

// ───────── terrain ─────────
const SUB = 4; let HV = null; const VW = MAPW * SUB + 1, VH = MAPH * SUB + 1;
function cellH(x, y) { if (!inMap(x, y)) return -0.5; const t = G.terrain[idx(x, y)]; if (t === TT.WATER || t === TT.BRIDGE) return -0.55; if (t === TT.CLIFF) return 0.8 + hash2(x, y) * 0.25; if (t === TT.ROCK) return 0.08 + hash2(x, y) * 0.06; if (t === TT.SHORE) return -0.05; return 0; }
function groundAt(px, py) { if (!HV) return 0; const gx = clamp(px * U * SUB, 0, VW - 1.001), gy = clamp(py * U * SUB, 0, VH - 1.001); const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j; const h = (a, b) => HV[b * VW + a]; return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy; }
function unitY(e) { const cx = Math.floor(e.x * U), cy = Math.floor(e.y * U); const t = inMap(cx, cy) ? G.terrain[idx(cx, cy)] : 0; if (t === TT.BRIDGE) return 0.06; const g = groundAt(e.x, e.y); if (SIM.isNaval(e.def) || t === TT.WATER) return Math.max(g, WATER_Y); return Math.max(g, -0.06); }
function disposeTree(o) { o.traverse(c => { if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); }); }
function bakeTerrain() {
  for (const v of S.views.values()) world.remove(v.root); S.views.clear(); for (const f of S.fx) { if (f.obj) world.remove(f.obj); } S.fx = []; S.decals = []; PARTS.add.clear(); PARTS.smoke.clear();
  for (const o of [terrain, water, decorGroup, oreGold, oreGem]) if (o) { world.remove(o); disposeTree(o); }
  for (const m of crateViews.values()) world.remove(m); crateViews.clear(); if (mineMesh) { world.remove(mineMesh); mineMesh = null; } if (ghostG) { if (ghostG.userData.radius) world.remove(ghostG.userData.radius); world.remove(ghostG); ghostG = null; S.ghostKey = null; }
  const P = themeOf(); const tAt = (x, y) => inMap(x, y) ? G.terrain[idx(x, y)] : TT.WATER;
  // heights at half-cell vertices
  HV = new Float32Array(VW * VH);
  const C = new Float32Array(MAPW * MAPH); for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) C[idx(x, y)] = cellH(x, y);
  const B = new Float32Array(MAPW * MAPH); for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const w = (dx ? 1 : 2) * (dy ? 1 : 2); s += cellH(x + dx, y + dy) * w; n += w; } const t = G.terrain[idx(x, y)]; B[idx(x, y)] = t === TT.CLIFF ? C[idx(x, y)] * 0.7 + (s / n) * 0.3 : t === TT.ROCK ? C[idx(x, y)] * 0.5 + (s / n) * 0.5 : s / n; }
  const cb = (x, y) => B[idx(clamp(x, 0, MAPW - 1), clamp(y, 0, MAPH - 1))]; const ss = t => t * t * (3 - 2 * t);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) { const fx = i / SUB - 0.5, fy = j / SUB - 0.5; const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = ss(fx - x0), ty = ss(fy - y0); let h = (cb(x0, y0) * (1 - tx) + cb(x0 + 1, y0) * tx) * (1 - ty) + (cb(x0, y0 + 1) * (1 - tx) + cb(x0 + 1, y0 + 1) * tx) * ty; const wx = i / SUB, wy = j / SUB; if (h > -0.35 && h < 0.2) h += (hash2(i * 3, j * 5) - 0.5) * 0.025 + (Math.sin(wx * 2.7 + wy * 1.3) * 0.5 + Math.sin(wy * 3.1 - wx * 0.7) * 0.5) * 0.035; HV[j * VW + i] = h; }
  const pos = new Float32Array(VW * VH * 3); for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) { const k = (j * VW + i) * 3; pos[k] = i / SUB; pos[k + 1] = HV[j * VW + i]; pos[k + 2] = j / SUB; }
  const ind = []; for (let j = 0; j < VH - 1; j++) for (let i = 0; i < VW - 1; i++) { const a = j * VW + i, b = a + 1, c = a + VW, d = c + 1; ind.push(a, c, b, b, c, d); }
  const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(pos, 3)); tg.setIndex(ind); tg.computeVertexNormals();
  // splat (ground, sand, rock, road) and aux (scrub, water depth)
  const sp = new Uint8Array(MAPW * MAPH * 4), ax = new Uint8Array(MAPW * MAPH * 4);
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const t = G.terrain[idx(x, y)], k = idx(x, y) * 4; let g = 0, s = 0, r = 0, d = 0; if (t === TT.GRASS || t === TT.SCRUB) g = 255; else if (t === TT.SHORE || t === TT.WATER || t === TT.BRIDGE) s = 255; else if (t === TT.ROCK || t === TT.CLIFF) r = 255; else if (t === TT.ROAD) d = 255; sp[k] = g; sp[k + 1] = s; sp[k + 2] = r; sp[k + 3] = d; ax[k] = t === TT.SCRUB ? 255 : 0; let w = 0; if (t === TT.WATER || t === TT.BRIDGE) { w = 255; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const tt = tAt(x + dx, y + dy); if (tt !== TT.WATER && tt !== TT.BRIDGE) w = Math.min(w, 60 + 50 * Math.max(Math.abs(dx), Math.abs(dy))); } } ax[k + 1] = w; ax[k + 2] = 0; ax[k + 3] = 255; }
  const mkTex = data => { const t = new T.DataTexture(data, MAPW, MAPH, T.RGBAFormat); t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter; t.needsUpdate = true; return t; };
  const splatTex = mkTex(sp), auxTex = mkTex(ax); S.auxData = ax; S.auxTex = auxTex;
  S.decalCanvas = document.createElement('canvas'); S.decalCanvas.width = MAPW * 8; S.decalCanvas.height = MAPH * 8; S.decalCtx = S.decalCanvas.getContext('2d');
  S.decalTex = new T.CanvasTexture(S.decalCanvas); S.decalTex.flipY = false; S.decalTex.colorSpace = T.SRGBColorSpace;
  const col = h => new T.Color(h);
  terrainUniforms = { uDetail: { value: detailTex() }, uDetailOn: { value: DETAIL && DETAIL.image ? 1 : 0 }, uSplat: { value: splatTex }, uAux: { value: auxTex }, uDecal: { value: S.decalTex }, uGround0: { value: col(P.ground0) }, uGround1: { value: col(P.ground1) }, uScrub: { value: col(P.scrub) }, uSand0: { value: col(P.sand0) }, uSand1: { value: col(P.sand1) }, uRock0: { value: col(P.rock0) }, uRock1: { value: col(P.rock1) }, uRoad0: { value: col(P.road0) }, uRoad1: { value: col(P.road1) } };
  const tm = fogify(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 }), sh => { Object.assign(sh.uniforms, terrainUniforms); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + TERRAIN_GLSL).replace('#include <map_fragment>', TERRAIN_FRAG).replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(normal - mat3(viewMatrix) * vec3(th_grad.x, 0.0, th_grad.y) * 9.0);'); }, 'terrain');
  terrain = new T.Mesh(tg, tm); terrain.receiveShadow = true; world.add(terrain);
  // water
  const wm = fogify(new T.MeshStandardMaterial({ color: 0x1d4a6e, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.86 }), sh => {
    sh.uniforms.uAux = { value: auxTex }; sh.uniforms.uTime = WATER_T;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uAux; uniform float uTime;\n' + TERRAIN_GLSL.split('\n').filter(l => /th_/.test(l)).join('\n'))
      .replace('#include <map_fragment>', `vec4 ax = texture2D(uAux, vWPos.xz / uMap); float depth = ax.g; vec2 q = vWPos.xz * 1.3 + vec2(uTime * 0.25, uTime * 0.17); float w1 = th_fbm(q), w2 = th_noise(vWPos.xz * 6.0 - uTime * 0.6);
        diffuseColor.rgb = mix(vec3(0.16, 0.42, 0.45), vec3(0.04, 0.17, 0.3), smoothstep(0.2, 0.9, depth)) * (0.85 + 0.3 * w1);
        float foam = smoothstep(0.42, 0.24, depth) * smoothstep(0.45, 0.75, w2 + w1 * 0.4); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.92), foam * 0.7); diffuseColor.a = mix(0.55, 0.9, smoothstep(0.15, 0.7, depth));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n { float e = 0.12; vec2 p = vWPos.xz * 2.2 + uTime * 0.35; float hx = th_noise(p + vec2(e, 0.)) - th_noise(p - vec2(e, 0.)); float hz = th_noise(p + vec2(0., e)) - th_noise(p - vec2(0., e)); normal = normalize(normal + (viewMatrix * vec4(hx * 1.4, 0.0, hz * 1.4, 0.0)).xyz); }`);
  }, 'water');
  water = new T.Mesh(new T.PlaneGeometry(MAPW, MAPH), wm); water.rotation.x = -Math.PI / 2; water.position.set(MAPW / 2, WATER_Y, MAPH / 2); water.receiveShadow = true; world.add(water);
  // decor: rocks, bushes, trees, bridges
  decorGroup = new T.Group(); world.add(decorGroup);
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e3 = new T.Euler(), sc = new T.Vector3(), ps = new T.Vector3(), cc = new T.Color();
  const rocks = [], bushes = [], trees = [];
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const t = G.terrain[idx(x, y)], h = hash2(x, y), h2 = hash2(x + 17, y + 3), h3 = hash2(x + 5, y + 41);
    if (t === TT.ROCK) for (let k = 0; k < 2 + (h > 0.5 ? 1 : 0); k++) rocks.push([x + 0.2 + hash2(x + k, y) * 0.6, y + 0.2 + hash2(x, y + k) * 0.6, 0.18 + hash2(x + k * 3, y + 9) * 0.22, cellH(x, y)]);
    if (t === TT.CLIFF && h < 0.45) rocks.push([x + 0.5, y + 0.5, 0.3 + h2 * 0.2, cellH(x, y) - 0.1]);
    if (t === TT.SCRUB) { bushes.push([x + 0.3 + h * 0.4, y + 0.3 + h2 * 0.4, 0.2 + h3 * 0.15]); if (h2 > 0.45) bushes.push([x + 0.7 - h3 * 0.3, y + 0.75 - h * 0.3, 0.14 + h * 0.1]); if (h3 > 0.62 && G.theme !== 'desert') trees.push([x + 0.5, y + 0.5, 0.8 + h * 0.5]); }
    if ((t === TT.GRASS) && h > 0.985 && G.theme !== 'desert') trees.push([x + 0.5, y + 0.5, 0.9 + h2 * 0.4]); }
  const inst = (geo, mat, list, place) => { if (!list.length) return null; const im = new T.InstancedMesh(geo, mat, list.length); list.forEach((it, i) => { place(it, i); im.setMatrixAt(i, m4.compose(ps, q, sc)); im.setColorAt(i, cc); }); im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; decorGroup.add(im); return im; };
  const PG = propGeo(); const pmap = PG.map;
  const rockMat = fogify(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: !PG.rock_a, map: pmap }), null, 'rock');
  const rockRot = i => PG.rock_a ? e3.set((hash2(i, 1) - 0.5) * 0.3, hash2(i, 2) * 6, (hash2(i, 3) - 0.5) * 0.3) : e3.set(hash2(i, 1) * 6, hash2(i, 2) * 6, hash2(i, 3) * 6);
  const rockA = rocks.filter((r, i) => !PG.rock_b || i % 2 === 0), rockB = PG.rock_b ? rocks.filter((r, i) => i % 2 === 1) : [];
  for (const [list, geo] of [[rockA, PG.rock_a || new T.IcosahedronGeometry(1, 0)], [rockB, PG.rock_b]]) if (geo) inst(geo, rockMat, list, (r, i) => { ps.set(r[0], r[3] + r[2] * (PG.rock_a ? 0.14 : 0.35), r[1]); q.setFromEuler(rockRot(i + (list === rockB ? 1000 : 0))); sc.set(r[2] * (1 + hash2(i, 4) * 0.5), r[2] * 0.7, r[2] * (1 + hash2(i, 5) * 0.4)); cc.set(P.rock1).multiplyScalar(0.75 + hash2(i, 6) * 0.4); });
  const bushMat = fogify(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: !PG.bush, map: pmap }), null, 'bush');
  const trunkMat = fogify(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), null, 'trunk');
  inst(PG.bush || new T.IcosahedronGeometry(1, 1), bushMat, bushes, (b, i) => { ps.set(b[0], b[2] * (PG.bush ? 0.3 : 0.55), b[1]); q.setFromEuler(e3.set(0, hash2(i, 7) * 6, 0)); sc.set(b[2], b[2] * 0.75, b[2]); cc.set(P.bush).multiplyScalar(0.75 + hash2(i, 8) * 0.5); });
  inst(PG.conifer || new T.ConeGeometry(1, 1, 7), bushMat, trees, (t, i) => { ps.set(t[0], t[2] * (PG.conifer ? 0.95 : 0.75), t[1]); q.setFromEuler(e3.set(0, hash2(i, 11) * 6, 0)); sc.set(t[2] * 0.42, t[2] * 1.1, t[2] * 0.42); cc.set(P.tree).multiplyScalar(0.8 + hash2(i, 9) * 0.4); });
  inst(new T.CylinderGeometry(1, 1, 1, 6), trunkMat, trees, (t, i) => { ps.set(t[0], 0.12, t[1]); q.identity(); sc.set(0.06, 0.26, 0.06); cc.set(P.trunk); });
  // bridges
  const bparts = []; const add = (x, y, z, sx, sy, sz, c) => bparts.push({ t: 'box', x, y, z, sx, sy, sz, col: c });
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { if (G.terrain[idx(x, y)] !== TT.BRIDGE) continue; const horiz = tAt(x - 1, y) === TT.BRIDGE || tAt(x + 1, y) === TT.BRIDGE; add(x + 0.5, 0.0, y + 0.5, 1.01, 0.1, 1.01, 0x6a5038); for (let k = 0; k < 4; k++) horiz ? add(x + 0.125 + k * 0.25, 0.055, y + 0.5, 0.2, 0.02, 0.96, 0x7d6248) : add(x + 0.5, 0.055, y + 0.125 + k * 0.25, 0.96, 0.02, 0.2, 0x7d6248); if (horiz) { if (tAt(x, y - 1) !== TT.BRIDGE) add(x + 0.5, 0.15, y + 0.04, 1.0, 0.18, 0.06, 0x3a3a3a); if (tAt(x, y + 1) !== TT.BRIDGE) add(x + 0.5, 0.15, y + 0.96, 1.0, 0.18, 0.06, 0x3a3a3a); } else { if (tAt(x - 1, y) !== TT.BRIDGE) add(x + 0.04, 0.15, y + 0.5, 0.06, 0.18, 1.0, 0x3a3a3a); if (tAt(x + 1, y) !== TT.BRIDGE) add(x + 0.96, 0.15, y + 0.5, 0.06, 0.18, 1.0, 0x3a3a3a); } if ((x + y) % 2 === 0) add(x + 0.5, -0.32, y + 0.5, 0.24, 0.55, 0.24, 0x4a4540); }
  if (bparts.length) { const g = mergeParts(bparts); const m = new T.Mesh(g, fogify(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), null, 'bridge')); m.castShadow = m.receiveShadow = true; decorGroup.add(m); }
  oreGold = oreGem = null; S.oreSig = -1; refreshOre(true);
  if (startG) world.add(startG);
  updateFog();
}
const WATER_T = { value: 0 };
// ore crystals, rebuilt when the ore amounts or exploration change
const oreGeo = new T.OctahedronGeometry(1, 0); oreGeo.userData.shared = true;
// Blender-built props (blender/out/props.glb): boulders, crystal cluster, shrub, conifer canopy, sharing one baked atlas
let PROPG = null; function propGeo() { if (PROPG) return PROPG; const g = GLBP.props; if (!g) return {}; PROPG = {}; g.scene.updateMatrixWorld(true); g.scene.traverse(o => { if (o.isMesh) { const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.userData.shared = true; PROPG[o.name] = geo; if (o.material.map && !PROPG.map) PROPG.map = o.material.map; } }); return PROPG; }
const oreMatGold = fogify(new T.MeshStandardMaterial({ color: 0xe8a83a, emissive: 0x6a3a08, roughness: 0.3, metalness: 0.4, flatShading: true }), null, 'oreg');
const oreMatGem = fogify(new T.MeshStandardMaterial({ color: 0x5aa7ff, emissive: 0x16407a, roughness: 0.15, metalness: 0.3, flatShading: true }), null, 'orem');
function refreshOre(force) {
  const me = S.me; let sig = 0, ng = 0, nm = 0; for (let i = 0; i < MAPW * MAPH; i++) if (G.ore[i] > 0 && (!me || me.vis[i])) { const n = Math.min(3, Math.ceil(G.ore[i] / 18)); sig += n * (i % 97 + 1); if (G.oreKind[i] === 2) nm += n; else ng += n; }
  if (!force && sig === S.oreSig) return; S.oreSig = sig;
  if (S.auxData) { for (let i = 0; i < MAPW * MAPH; i++) { const a = G.ore[i] > 0 ? Math.min(255, 90 + G.ore[i] * 3.5) : 0; S.auxData[i * 4 + 2] = a; S.auxData[i * 4 + 3] = G.oreKind[i] === 2 && a ? 200 : 255; } S.auxTex.needsUpdate = true; }
  for (const o of [oreGold, oreGem]) if (o) world.remove(o);
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e3 = new T.Euler(), sc = new T.Vector3(), ps = new T.Vector3();
  const og = propGeo().crystal || oreGeo; oreGold = new T.InstancedMesh(og, oreMatGold, Math.max(1, ng)); oreGem = new T.InstancedMesh(og, oreMatGem, Math.max(1, nm)); let a = 0, b = 0;
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const i = idx(x, y); if (!(G.ore[i] > 0) || (me && !me.vis[i])) continue; const n = Math.min(3, Math.ceil(G.ore[i] / 18)); const cx0 = 0.3 + hash2(x, y) * 0.4, cz0 = 0.3 + hash2(y, x) * 0.4; for (let k = 0; k < n; k++) { const h = hash2(x * 7 + k, y * 13 + k), h2 = hash2(x + k * 31, y + 5); const s = (0.045 + h * 0.045) * (og === oreGeo ? 1 : 1.25); ps.set(x + cx0 + (h - 0.5) * 0.3, groundAt((x + 0.5) * CELL, (y + 0.5) * CELL) + s * 0.9, y + cz0 + (h2 - 0.5) * 0.3); q.setFromEuler(e3.set(h * 0.6, h2 * 6, h * 0.5)); og === oreGeo ? sc.set(s, s * (1.4 + h2), s) : sc.set(s, s * (1.0 + h2 * 0.5), s); m4.compose(ps, q, sc); if (G.oreKind[i] === 2) oreGem.setMatrixAt(b++, m4); else oreGold.setMatrixAt(a++, m4); } }
  oreGold.count = a; oreGem.count = b; for (const o of [oreGold, oreGem]) { o.castShadow = true; o.instanceMatrix.needsUpdate = true; world.add(o); }
}
function updateFog() { const me = S.me; if (!me) { fogData.fill(255); fogTex.needsUpdate = true; return; } const v = me.vis; for (let i = 0; i < v.length; i++) { const a = v[i] === 2 ? 255 : v[i] === 1 ? 105 : 0; fogData[i * 4] = a; fogData[i * 4 + 3] = 255; } fogTex.needsUpdate = true; }

// ───────── model building (from art/models.js parts) ─────────
const BASE = {};
function baseGeo(t) { if (BASE[t]) return BASE[t]; let g; if (t === 'box') g = new T.BoxGeometry(1, 1, 1); else if (t === 'cyl') g = new T.CylinderGeometry(1, 1, 1, 14); else if (t === 'sph') g = new T.SphereGeometry(1, 14, 10); else if (t === 'cone') g = new T.ConeGeometry(1, 1, 14); else { g = new T.BoxGeometry(1, 1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getX(i) > 0 && p.getY(i) > 0) p.setY(i, -0.42); } g = g.toNonIndexed(); g.deleteAttribute('uv'); g.computeVertexNormals(); return BASE[t] = g; }
const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
function partGeo(p, offset, colorHex, scale = 1) { const g = baseGeo(p.t).clone(); _e.set(p.rx || 0, p.rotor ? 0 : (p.ry || 0), p.rz || 0); _q.setFromEuler(_e); _s.set(p.sx, p.sy, p.sz); _p.set(p.x - offset.x, p.y - offset.y, p.z - offset.z); _m4.compose(_p, _q, _s); g.applyMatrix4(_m4); const n = g.attributes.position.count, c = new Float32Array(n * 3); const col = new T.Color(colorHex).multiplyScalar(scale); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute('color', new T.BufferAttribute(c, 3)); return g; }
function mergeParts(list, offset = { x: 0, y: 0, z: 0 }) { const gs = list.map(p => partGeo(p, offset, p.col)); const g = T.mergeGeometries(gs); gs.forEach(x => x.dispose()); g.userData.shared = true; return g; }
const PROTO = new Map();
function proto(defId, faction) {
  if (GLBP[defId]) return glbProto(defId);
  const key = defId + ':' + faction; if (PROTO.has(key)) return PROTO.get(key);
  const fn = MODELS[defId]; if (!fn) return null; ARTMODELS.setAnim({ t: 0, pose: 'idle' }); const parts = fn(faction); const pal = PAL[faction] || PAL.civ;
  const buckets = () => ({ body: [], team: [], glow: [] });
  const bucketOf = p => p.team || p.m === 'team' ? 'team' : (p.m === 'neon' || p.m === 'glass') ? 'glow' : 'body';
  const colOf = p => p.m === 'glass' ? pal.glass : (pal[p.m] != null ? pal[p.m] : pal.base);
  const main = buckets(), tur = buckets(); const legs = [], rotors = new Map();
  const tparts = parts.filter(p => p.turret); const tpiv = tparts.length ? { x: tparts[0].x, y: 0, z: tparts[0].z } : null;
  for (const p of parts) { const q = Object.assign({}, p, { col: colOf(p) }); if (p.leg) legs.push(q); else if (p.rotor) { if (!rotors.has(p.rotor)) rotors.set(p.rotor, []); rotors.get(p.rotor).push(q); } else (p.turret ? tur : main)[bucketOf(p)].push(q); }
  const build = (b, off) => ({ body: b.body.length ? mergeParts(b.body, off) : null, team: b.team.length ? mergeParts(b.team, off) : null, glow: b.glow.length ? mergeParts(b.glow.map(p => Object.assign({}, p, { col: p.m === 'glass' ? (p.col & 0xfefefe) : p.col })), off) : null });
  const pr = { faction, main: build(main, { x: 0, y: 0, z: 0 }), turret: tpiv ? Object.assign(build(tur, tpiv), { pivot: tpiv }) : null, legs: legs.map(l => ({ geo: mergeParts([l], { x: l.x, y: l.hip, z: l.z }), pivot: { x: l.x, y: l.hip, z: l.z }, side: l.leg })), rotors: [...rotors.values()].map(rs => { const c = rs[0]; return { geo: mergeParts(rs, { x: c.x, y: c.y, z: c.z }), pivot: { x: c.x, y: c.y, z: c.z } }; }), anim: parts.anim };
  // bounds and muzzle
  const bb = new T.Box3(); for (const g of [pr.main.body, pr.main.team, pr.main.glow]) if (g) { g.computeBoundingBox(); bb.union(g.boundingBox); }
  pr.height = bb.max.y; pr.radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.55; pr.front = bb.max.x;
  if (pr.turret) { const tb = new T.Box3(); for (const g of [pr.turret.body, pr.turret.team, pr.turret.glow]) if (g) { g.computeBoundingBox(); tb.union(g.boundingBox); } pr.muzzle = { x: tb.max.x, y: (tb.min.y + tb.max.y) / 2 + 0.02, z: 0, inTurret: true }; pr.height = Math.max(pr.height, tb.max.y); }
  else pr.muzzle = { x: bb.max.x * 0.9, y: bb.max.y * 0.62, z: 0, inTurret: false };
  PROTO.set(key, pr); return pr;
}
function glbProto(id) { const key = 'glb:' + id; if (PROTO.has(key)) return PROTO.get(key); const g = GLBP[id]; const sc = g.scene; sc.updateMatrixWorld(true); const bb = new T.Box3(); sc.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); bb.union(b); } }); const pr = { glb: true, scene: sc, anims: g.animations || [], height: bb.max.y, radius: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5, front: bb.max.x, matCache: new Map() }; PROTO.set(key, pr); return pr; }
const FMAT = {}; function factionMat(f) { return FMAT[f] || (FMAT[f] = fogify(new T.MeshStandardMaterial({ vertexColors: true, roughness: f === 'helix' ? 0.36 : f === 'lattice' ? 0.52 : 0.78, metalness: f === 'helix' ? 0.5 : f === 'lattice' ? 0.12 : 0.22 }), null, 'unit')); }
const GLOW = fogify(new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), BASIC_FIX, 'glow');
const TMAT = new Map(); function teamMat(color) { if (!TMAT.has(color)) { const m = fogify(new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.42, metalness: 0.2 }), null, 'team'); m.userData.isTeam = true; TMAT.set(color, m); } return TMAT.get(color); }
const CHAR = fogify(new T.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.95, metalness: 0.1 }), null, 'char');
const FLASHES = new Map(); function flashOf(m) { if (!FLASHES.has(m)) { const f = m.clone(); f.onBeforeCompile = m.onBeforeCompile; f.customProgramCacheKey = m.customProgramCacheKey; if (f.emissive) { f.emissive = new T.Color(0xffe2b0); f.emissiveIntensity = 0.32; } else f.color = new T.Color(0xffffff); FLASHES.set(m, f); } return FLASHES.get(m); }
const GHOSTS = new Map(); function ghostOf(m) { if (!GHOSTS.has(m)) { const g = m.clone(); g.transparent = true; g.opacity = 0.38; g.depthWrite = false; g.onBeforeCompile = m.onBeforeCompile; g.customProgramCacheKey = m.customProgramCacheKey; GHOSTS.set(m, g); } return GHOSTS.get(m); }
function meshesFor(set, color, faction, parent, pos) { const out = []; const add = (g, mat, kind) => { if (!g) return; const m = new T.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.userData.kind = kind; m.userData.base = mat; if (pos) m.position.set(pos.x, pos.y, pos.z); parent.add(m); out.push(m); }; add(set.body, factionMat(faction), 'body'); add(set.team, teamMat(color), 'team'); add(set.glow, GLOW, 'glow'); return out; }
function scaleFor(d) { return isStruct(d) ? 1 : d.cls === 'infantry' ? 0.95 : d.cls === 'drone' ? 1.05 : d.cls === 'aircraft' ? 1.1 : 1.08; }
function makeView(e) {
  const d = e.def, f = d.faction === 'civ' ? 'civ' : d.faction; const pr = proto(d.id, f); const color = e.owner.color || 0x9a9a8a;
  const root = new T.Group(); root.rotation.order = 'YXZ'; const body = new T.Group(); root.add(body); const sc = scaleFor(d); body.scale.setScalar(sc);
  const v = { e, root, body, pr, faction: f, color, meshes: [], legs: [], rotors: [], face: e.facing || 0, phase: Math.random() * 6, scale: sc, last: { x: e.x, y: e.y }, speed: 0, pitch: 0, roll: 0, recoil: 0, hitT: 0, smokeT: 0 };
  if (pr && pr.glb) {
    const inst = T.SkeletonUtils.clone(pr.scene); body.add(inst); v.tracks = []; v.wheels = [];
    inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false; const conv = m => { if (m.name === 'TEAM') return teamMat(color); if (m.name === 'TRACK' && m.map) { const t = m.clone(); t.map = m.map.clone(); t.map.wrapS = T.RepeatWrapping; t.map.needsUpdate = true; fogify(t, null, 'trk'); v.tracks.push(t.map); return t; } if (!pr.matCache.has(m)) pr.matCache.set(m, fogify(m.clone(), null, 'glb')); return pr.matCache.get(m); }; o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material); o.userData.base = o.material; o.userData.kind = 'glb'; v.meshes.push(o); } if (/^wheel_/.test(o.name)) { o.userData.rest = o.quaternion.clone(); v.wheels.push(o); } });
    v.turret = inst.getObjectByName('turret') || null; v.gun = inst.getObjectByName('gun') || null; if (v.gun) v.gunRest = v.gun.position.clone(); if (v.turret) v.turretRest = v.turret.rotation.y;
    v.muzzle = inst.getObjectByName('muzzle') || (() => { const m = new T.Object3D(); m.position.set(pr.front * 0.9, pr.height * 0.6, 0); body.add(m); return m; })();
    if (pr.anims.length) { v.mixer = new T.AnimationMixer(inst); v.actions = {}; for (const clip of pr.anims) v.actions[clip.name] = v.mixer.clipAction(clip); playBase(v, 'idle'); }
  } else if (pr) {
    v.meshes.push(...meshesFor(pr.main, color, f, body));
    if (pr.turret) { v.turret = new T.Group(); v.turret.position.set(pr.turret.pivot.x, 0, pr.turret.pivot.z); body.add(v.turret); v.gun = new T.Group(); v.turret.add(v.gun); v.meshes.push(...meshesFor(pr.turret, color, f, v.gun)); }
    for (const l of pr.legs) { const g = new T.Group(); g.position.set(l.pivot.x, l.pivot.y, l.pivot.z); const m = new T.Mesh(l.geo, factionMat(f)); m.castShadow = true; m.userData.base = m.material; m.userData.kind = 'body'; g.add(m); body.add(g); v.legs.push({ g, side: l.side }); v.meshes.push(m); }
    for (const r of pr.rotors) { const g = new T.Group(); g.position.set(r.pivot.x, r.pivot.y, r.pivot.z); const m = new T.Mesh(r.geo, factionMat(f)); m.userData.base = m.material; m.userData.kind = 'body'; g.add(m); body.add(g); v.rotors.push(g); v.meshes.push(m); }
    v.muzzle = new T.Object3D(); v.muzzle.position.set(pr.muzzle.x - (pr.muzzle.inTurret ? 0 : 0), pr.muzzle.y, pr.muzzle.z); (pr.muzzle.inTurret ? v.gun : body).add(v.muzzle);
  } else { const m = new T.Mesh(new T.BoxGeometry(0.6, 0.4, 0.6), factionMat('compact')); body.add(m); v.meshes.push(m); v.muzzle = new T.Object3D(); body.add(v.muzzle); }
  if (isAir(d) && S.lowEnd) { v.blob = new T.Mesh(BLOB_GEO, BLOB_MAT); v.blob.rotation.x = -Math.PI / 2; root.add(v.blob); }
  world.add(root); S.views.set(e.id, v); return v;
}
const BLOB_GEO = new T.CircleGeometry(0.45, 20); const BLOB_MAT = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
const RING_GEO = new T.RingGeometry(0.92, 1, 40); RING_GEO.rotateX(-Math.PI / 2);
const ringMat = (c, o) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, toneMapped: false });
const SEL_MAT = ringMat(0xffffff, 0.85), BUFF_MAT = ringMat(0xc9bcff, 0.7), EMP_MAT = ringMat(0x9ad7ff, 0.8), GOLD_MAT = ringMat(0xd9a441, 0.75), SAND_MAT = new T.MeshStandardMaterial({ color: 0xb79a66, roughness: 0.95 });
function playBase(v, name, fade = 0.25) { const a = v.actions && (v.actions[name] || v.actions.idle); if (!a || v.base === a) return; a.enabled = true; a.setLoop(T.LoopRepeat); a.reset().setEffectiveWeight(1).fadeIn(fade).play(); if (v.base) v.base.fadeOut(fade); v.base = a; v.baseName = name; }
function playOnce(v, name, after) { const a = v.actions && v.actions[name]; if (!a) return false; a.reset(); a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = !after; a.setEffectiveWeight(1); a.fadeIn(0.04).play(); if (v.base && v.base !== a) v.base.fadeOut(0.04); const prev = v.baseName; v.base = a; v.baseName = name; v.onceUntil = S.time + a.getClip().duration; if (after) v.after = after; return true; }
const _qz = new T.Quaternion(), _zAxis = new T.Vector3(0, 0, 1);
function dropView(e) { const v = S.views.get(e.id); if (!v) return; world.remove(v.root); S.views.delete(e.id); }
function setMeshMode(v, mode) { if (v.mode === mode) return; v.mode = mode; const f = base => mode === 'flash' ? flashOf(base) : mode === 'ghost' ? ghostOf(base) : mode === 'char' ? CHAR : base; for (const m of v.meshes) { const base = m.userData.base; m.material = Array.isArray(base) ? base.map(f) : f(base); } }
function recolor(v, color) { v.color = color; const tm = teamMat(color); for (const m of v.meshes) { const b = m.userData.base; if (Array.isArray(b)) { m.userData.base = b.map(x => x.userData.isTeam ? tm : x); } else if (m.userData.kind === 'team' || (b && b.userData.isTeam)) m.userData.base = tm; } v.mode = null; setMeshMode(v, 'normal'); }

// ───────── per-frame entity sync ─────────
function syncViews(dt) {
  const me = S.me;
  for (const e of G.ents) {
    if (e.dead) { dropView(e); continue; }
    let v = S.views.get(e.id);
    const vis = e.owner === me || visibleTo(me, e); const cloakHidden = e.cloaked && e.owner !== me && !canSee(me, e);
    if (!vis || cloakHidden || e.inside) { if (v) v.root.visible = false; continue; }
    if (!v) v = makeView(e); v.root.visible = true; const d = e.def;
    if ((e.owner.color || 0x9a9a8a) !== v.color) recolor(v, e.owner.color || 0x9a9a8a);
    const mode = v.hitT > 0 ? 'flash' : (e.cloaked ? 'ghost' : 'normal'); setMeshMode(v, mode); if (v.hitT > 0) v.hitT -= dt;
    if (isStruct(d)) {
      v.root.position.set(e.x * U, 0, e.y * U);
      const b = e.building || 0; v.body.scale.set(1, Math.max(0.04, 1 - b * 0.96), 1);
      if (b > 0 && !S.reduced && Math.random() < dt * 6) PARTS.add.spark((e.x + (Math.random() - 0.5) * e.fw * CELL * 0.8) * U, v.pr ? v.pr.height * (1 - b) : 0.5, (e.y + (Math.random() - 0.5) * e.fh * CELL * 0.8) * U, 0xffe6a0, 2);
      if (v.turret) { const want = e.aim != null ? e.aim : (v.tang == null ? 0 : v.tang); v.tang = lerpAngle(v.tang == null ? want : v.tang, want, Math.min(1, dt * 6)); v.turret.rotation.y = -v.tang; }
    } else {
      const dx = e.x - v.last.x, dy = e.y - v.last.y; v.last.x = e.x; v.last.y = e.y; const sp = dt > 0 ? Math.hypot(dx, dy) * U / dt : 0; const acc = (sp - v.speed) / Math.max(dt, 1e-3); v.speed += (sp - v.speed) * Math.min(1, dt * 8);
      const prevFace = v.face; v.face = lerpAngle(v.face, e.facing || 0, Math.min(1, dt * 10)); let turn = 0; { let df = v.face - prevFace; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; turn = df / Math.max(dt, 1e-3); }
      let y = unitY(e); const air = isAir(d), hover = d.hover && !air, naval = SIM.isNaval(d);
      if (air) y = Math.max(y, 0) + AIR_H - 0.45 + Math.sin(S.time * 1.7 + e.id) * 0.05;
      else if (hover) y += 0.06 + Math.sin(S.time * 4 + e.id) * 0.025;
      else if (naval) y += Math.sin(S.time * 1.4 + e.id) * 0.02 - (d.submerged && e.cloaked ? 0.22 : 0);
      if (isInf(d) || d.cls === 'drone' && v.legs.length) { if (v.speed > 0.05 && !e.deployed) { v.phase += dt * (5.5 + v.speed * 2.2); y += Math.abs(Math.sin(v.phase)) * 0.025; } else v.phase = lerpAngle(v.phase, Math.round(v.phase / Math.PI) * Math.PI, Math.min(1, dt * 8)); for (const l of v.legs) l.g.rotation.z = Math.sin(v.phase) * 0.55 * l.side * (v.speed > 0.05 && !e.deployed ? 1 : 0); }
      v.root.position.set(e.x * U, y, e.y * U); v.root.rotation.y = -v.face;
      // body dynamics: pitch on acceleration and recoil, roll into turns for hover and air
      const targetPitch = clamp(-acc * 0.012, -0.08, 0.08) * (isInf(d) ? 0 : 1) + v.recoil * 0.06; v.pitch += (targetPitch - v.pitch) * Math.min(1, dt * 7);
      const targetRoll = (air || hover) ? clamp(turn * 0.12, -0.45, 0.45) : naval ? Math.sin(S.time * 1.1 + e.id) * 0.03 : 0; v.roll += (targetRoll - v.roll) * Math.min(1, dt * 5);
      v.body.rotation.z = v.pitch; v.body.rotation.x = v.roll;
      if (isInf(d)) v.body.scale.set(v.scale, v.scale * (e.deployed ? 0.82 : 1), v.scale);
      if (v.turret) { const want = e.aim != null ? e.aim : v.face; const ta = e.turret == null ? want : e.turret; v.tang = ta; v.turret.rotation.y = (v.turretRest || 0) + v.face - ta; }
      if (v.gun) { if (v.gunRest) { v.gun.position.x = v.gunRest.x - v.recoil * 0.09; const tgt = e.target; const want = tgt && isAir(tgt.def) ? 0.5 : 0.03; v.gun.rotation.z += (want - v.gun.rotation.z) * Math.min(1, dt * 4); } else v.gun.position.x = -v.recoil * 0.09; }
      if (v.wheels && v.wheels.length) { v.wheelAng = (v.wheelAng || 0) + v.speed * dt / 0.06; for (const w of v.wheels) w.quaternion.copy(w.userData.rest).premultiply(_qz.setFromAxisAngle(_zAxis, -v.wheelAng)); }
      if (v.tracks && v.tracks.length) { v.trackPos = (v.trackPos || 0) + v.speed * dt / 0.44; for (const t of v.tracks) t.offset.x = -v.trackPos; }
      if (v.mixer) { const moving = v.speed > 0.08 && !e.deployed; const aiming = !!(e.target && !e.target.dead); if (!v.onceUntil || S.time >= v.onceUntil) { v.onceUntil = 0; playBase(v, moving ? (aiming && v.actions.walk_aim ? 'walk_aim' : 'walk') : aiming && v.actions.aim ? 'aim' : 'idle'); } if (v.base && v.baseName === 'walk' || v.baseName === 'walk_aim') v.base.timeScale = clamp(v.speed / 1.4, 0.6, 1.8); v.mixer.update(dt); }
      for (const r of v.rotors) r.rotation.y += dt * (air ? 28 : 34);
      if (v.recoil > 0) v.recoil = Math.max(0, v.recoil - dt * 6);
      if (v.blob) { v.blob.position.y = -y + 0.02; v.blob.scale.setScalar(0.8); }
      // track dust and hover spray
      if (!S.reduced && v.speed > 0.6 && !air && !isInf(d) && Math.random() < dt * 14) { const bx = e.x * U - Math.cos(v.face) * 0.45, bz = e.y * U - Math.sin(v.face) * 0.45; if (naval) PARTS.smoke.puff(bx, WATER_Y + 0.05, bz, 0xdfe8ee, 0.25, 0.7, 0.45); else PARTS.smoke.puff(bx, 0.06, bz, G.theme === 'desert' ? 0xc8ae7a : 0x8a7e66, 0.28, 0.8, hover ? 0.25 : 0.45); }
      // deployed infantry: sandbag ring
      if (isInf(d) && e.deployed && !v.sand) { v.sand = new T.Mesh(SAND_GEO, SAND_MAT); v.sand.castShadow = true; v.root.add(v.sand); } else if (!e.deployed && v.sand) { v.root.remove(v.sand); v.sand = null; }
    }
    // damage states: smoke under 50 %, fire under 25 %
    if (!e.building && e.hp < d.hp * 0.5 && !S.reduced) { v.smokeT -= dt; if (v.smokeT <= 0) { const crit = e.hp < d.hp * 0.25; v.smokeT = crit ? 0.12 : 0.35; const st = isStruct(d); const sx = e.x * U + (Math.random() - 0.5) * (st ? e.fw * 0.6 : 0.3), sz = e.y * U + (Math.random() - 0.5) * (st ? e.fh * 0.5 : 0.3), sy = v.root.position.y + (v.pr ? v.pr.height * v.scale * 0.85 : 0.5); PARTS.smoke.puff(sx, sy, sz, 0x262626, st ? 0.55 : 0.32, st ? 2.4 : 1.6, 0.6); if (crit) PARTS.add.fire(sx, sy, sz, st ? 0.45 : 0.25); } }
    // rings: selection, buff, EMP
    const sel = S.sel.includes(e); ring(v, 'selR', sel && !isStruct(d), SEL_MAT, (v.pr ? v.pr.radius * v.scale : 0.4) + 0.08);
    if (isStruct(d)) structOutline(v, sel);
    ring(v, 'buffR', !!(e.buff && e.buff.until > G.t), e.buff && e.buff.invuln ? GOLD_MAT : BUFF_MAT, (v.pr ? v.pr.radius * v.scale : 0.4) + 0.2, isStruct(d) ? Math.max(e.fw, e.fh) * 0.6 : 0);
    ring(v, 'empR', e.disabled > 0, EMP_MAT, (v.pr ? v.pr.radius * v.scale : 0.4) + 0.14);
    if (v.empR && v.empR.visible) v.empR.material.opacity = 0.5 + 0.4 * Math.sin(S.time * 20);
  }
}
const SAND_GEO = new T.TorusGeometry(0.34, 0.07, 6, 18); SAND_GEO.rotateX(Math.PI / 2); SAND_GEO.translate(0, 0.06, 0);
function ring(v, key, on, mat, r, rs) { if (!on) { if (v[key]) v[key].visible = false; return; } if (!v[key]) { v[key] = new T.Mesh(RING_GEO, mat); v[key].renderOrder = 4; v.root.add(v[key]); } const m = v[key]; m.visible = true; m.material = mat; const R2 = rs || r; m.scale.set(R2, 1, R2); m.position.y = isAir(v.e.def) ? -(v.root.position.y - 0.03) : 0.03; }
function structOutline(v, on) { if (!on) { if (v.outline) v.outline.visible = false; return; } if (!v.outline) { const e = v.e, w = e.fw / 2 + 0.05, h = e.fh / 2 + 0.05; const g = new T.BufferGeometry().setFromPoints([new T.Vector3(-w, 0.05, -h), new T.Vector3(w, 0.05, -h), new T.Vector3(w, 0.05, h), new T.Vector3(-w, 0.05, h)]); v.outline = new T.LineLoop(g, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })); v.root.add(v.outline); } v.outline.visible = true; }

// ───────── particles ─────────
const PSCALE = { value: 500 };
const P_VS = `attribute float size; attribute vec4 pcol; varying vec4 vC; uniform float uScale; void main(){ vC = pcol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * uScale / -mv.z, 1.0, 512.0); gl_Position = projectionMatrix * mv; }`;
const P_FS_ADD = `varying vec4 vC; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); a *= a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb * vC.a * a, 1.0); }`;
const P_FS_SMOKE = `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.15, r); if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }`;
class Particles {
  constructor(cap, additive) { this.cap = cap; this.n = 0; this.p = new Float32Array(cap * 16); this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.siz = new Float32Array(cap); const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage)); g.setAttribute('pcol', new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage)); g.setAttribute('size', new T.BufferAttribute(this.siz, 1).setUsage(T.DynamicDrawUsage)); g.setDrawRange(0, 0); this.geo = g; this.mat = new T.ShaderMaterial({ uniforms: { uScale: PSCALE }, vertexShader: P_VS, fragmentShader: additive ? P_FS_ADD : P_FS_SMOKE, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending }); this.obj = new T.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = additive ? 6 : 5; scene.add(this.obj); this.additive = additive; }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
  add(x, y, z, vx, vy, vz, life, s0, s1, hex, a, grav = 0, drag = 0) { if (this.n >= this.cap) return; const o = this.n++ * 16, P = this.p; const c = rgb(hex); P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = vx; P[o + 4] = vy; P[o + 5] = vz; P[o + 6] = 0; P[o + 7] = life; P[o + 8] = s0; P[o + 9] = s1; P[o + 10] = c[0]; P[o + 11] = c[1]; P[o + 12] = c[2]; P[o + 13] = a; P[o + 14] = grav; P[o + 15] = drag; }
  puff(x, y, z, hex, s, life, a = 0.5) { this.add(x, y, z, (Math.random() - 0.5) * 0.25, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.25, life * (0.7 + Math.random() * 0.6), s, s * 2.6, hex, a, -0.05, 0.6); }
  spark(x, y, z, hex, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3.5; this.add(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 0.25 + Math.random() * 0.35, 0.09, 0.03, hex, 1.4, 9, 0.5); } }
  fire(x, y, z, s) { this.add(x + (Math.random() - 0.5) * s * 0.4, y, z + (Math.random() - 0.5) * s * 0.4, (Math.random() - 0.5) * 0.2, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2, 0.45 + Math.random() * 0.3, s, s * 0.4, Math.random() < 0.5 ? 0xff8a2a : 0xffc04a, 1.1, -0.4, 0.8); }
  update(dt) { const P = this.p; let i = 0; while (i < this.n) { const o = i * 16; P[o + 6] += dt; if (P[o + 6] >= P[o + 7]) { const l = (this.n - 1) * 16; for (let k = 0; k < 16; k++) P[o + k] = P[l + k]; this.n--; continue; } P[o + 4] -= P[o + 14] * dt; const dr = Math.max(0, 1 - P[o + 15] * dt); P[o + 3] *= dr; P[o + 4] *= dr; P[o + 5] *= dr; P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt; if (P[o + 1] < 0.02 && P[o + 14] > 0) { P[o + 1] = 0.02; P[o + 4] *= -0.35; P[o + 3] *= 0.6; P[o + 5] *= 0.6; } const k = P[o + 6] / P[o + 7]; this.pos[i * 3] = P[o]; this.pos[i * 3 + 1] = P[o + 1]; this.pos[i * 3 + 2] = P[o + 2]; this.siz[i] = P[o + 8] + (P[o + 9] - P[o + 8]) * k; this.col[i * 4] = P[o + 10]; this.col[i * 4 + 1] = P[o + 11]; this.col[i * 4 + 2] = P[o + 12]; this.col[i * 4 + 3] = P[o + 13] * Math.min(1, k * (this.additive ? 12 : 5)) * (1 - k); i++; } const g = this.geo; g.attributes.position.needsUpdate = true; g.attributes.pcol.needsUpdate = true; g.attributes.size.needsUpdate = true; g.setDrawRange(0, this.n); }
}
const PARTS = {};

// ───────── effects ─────────
function fxAdd(obj, life, upd, onEnd) { if (obj) world.add(obj); S.fx.push({ obj, t: 0, life, upd, onEnd }); }
function updateFx(dt) { const keep = []; for (const f of S.fx) { f.t += dt; const k = Math.min(1, f.t / f.life); if (f.upd) f.upd(f, k, dt); if (f.t >= f.life) { if (f.onEnd) f.onEnd(); if (f.obj) { world.remove(f.obj); f.obj.traverse(c => { if (c.material && c.material.userData.temp) c.material.dispose(); if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); }); } } else keep.push(f); } S.fx = keep; }
const tmpMat = (o) => { const m = new T.MeshBasicMaterial(Object.assign({ transparent: true, depthWrite: false, toneMapped: false }, o)); m.userData.temp = true; return m; };
const UNIT_CYL = new T.CylinderGeometry(1, 1, 1, 8, 1, true); UNIT_CYL.userData.shared = true; const UNIT_SPH = new T.SphereGeometry(1, 12, 8); UNIT_SPH.userData.shared = true; const UNIT_BOX = new T.BoxGeometry(1, 1, 1); UNIT_BOX.userData.shared = true;
const _a = new T.Vector3(), _b = new T.Vector3(), _up = new T.Vector3(0, 1, 0);
function beamMesh(a, b, r, color, op) { const len = a.distanceTo(b); const m = new T.Mesh(UNIT_CYL, tmpMat({ color, opacity: op, blending: T.AdditiveBlending })); m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(r, len, r); m.quaternion.setFromUnitVectors(_up, _b.copy(b).sub(a).normalize()); return m; }
function decal(x, y, r, kind) { S.decals.push({ x, y, r, kind, t: 0, life: kind === 'crater' ? 240 : 120 }); if (S.decals.length > 200) S.decals.shift(); S.decalDirty = true; }
function drawDecals(dt) { if (!S.decalCtx) return; let dirty = S.decalDirty; for (const d of S.decals) { d.t += dt; if (d.t > d.life * 0.8) dirty = true; } S.decals = S.decals.filter(d => d.t < d.life); S.decalAcc = (S.decalAcc || 0) + dt; if (!dirty || S.decalAcc < 0.25) return; S.decalAcc = 0; S.decalDirty = false; const c = S.decalCtx, k = 8 / CELL; c.clearRect(0, 0, S.decalCanvas.width, S.decalCanvas.height); for (const d of S.decals) { const a = d.t > d.life * 0.8 ? (1 - d.t / d.life) / 0.2 : 1; const x = d.x * k, y = d.y * k, r = d.r * k * 1.3; const g = c.createRadialGradient(x, y, 0, x, y, r); if (d.kind === 'crater') { g.addColorStop(0, `rgba(18,14,10,${0.9 * a})`); g.addColorStop(0.55, `rgba(30,24,18,${0.75 * a})`); g.addColorStop(0.75, `rgba(92,78,60,${0.55 * a})`); g.addColorStop(1, 'rgba(40,32,24,0)'); } else { g.addColorStop(0, `rgba(12,12,12,${0.7 * a})`); g.addColorStop(0.6, `rgba(20,18,16,${0.45 * a})`); g.addColorStop(1, 'rgba(20,18,16,0)'); } c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r, r * 0.9, (d.x * 7) % 3, 0, 6.29); c.fill(); } S.decalTex.needsUpdate = true; }
function shake(x, y, amt) { if (S.reduced) return; const t = camTarget(false); const d = Math.hypot(x * U - t.x, y * U - t.z) * CELL; S.shake = Math.max(S.shake, amt * Math.max(0, 1 - d / 900)); }
function shockRing(x, z, r, color, life) { const m = new T.Mesh(RING_GEO, tmpMat({ color, opacity: 0.9, blending: T.AdditiveBlending })); m.position.set(x, 0.06, z); fxAdd(m, life, (f, k) => { const s = 0.2 + r * k; m.scale.set(s, 1, s); m.material.opacity = 0.9 * (1 - k); }); }
function explosion(x, y, big, h) { const X = x * U, Z = y * U, Y = h == null ? Math.max(0.05, groundAt(x, y)) + 0.1 : h; const A = PARTS.add, Sm = PARTS.smoke;
  A.add(X, Y + 0.1, Z, 0, 0, 0, big ? 0.16 : 0.1, big ? 2.6 : 1.1, big ? 3.4 : 1.4, 0xfff4d0, 1.6);
  for (let i = 0; i < (big ? 16 : 6); i++) { const a = Math.random() * 6.28, s = Math.random() * (big ? 1.4 : 0.6); A.add(X + Math.cos(a) * s * 0.3, Y + Math.random() * 0.2, Z + Math.sin(a) * s * 0.3, Math.cos(a) * s, 0.5 + Math.random() * (big ? 1.5 : 0.8), Math.sin(a) * s, 0.35 + Math.random() * 0.4, big ? 0.9 : 0.5, big ? 1.6 : 0.8, i % 3 ? 0xff7a22 : 0xffc04a, 1.2, -0.3, 1.5); }
  for (let i = 0; i < (big ? 14 : 5); i++) Sm.add(X + (Math.random() - 0.5) * (big ? 1 : 0.4), Y + 0.1, Z + (Math.random() - 0.5) * (big ? 1 : 0.4), (Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5, 1.4 + Math.random() * 1.4, big ? 0.8 : 0.45, big ? 2.6 : 1.4, i % 2 ? 0x2a2622 : 0x4a3c30, 0.6, -0.1, 0.7);
  A.spark(X, Y + 0.1, Z, 0xffd27a, big ? 26 : 10); if (big) { shockRing(X, Z, 2.2, 0xffb060, 0.45); debris(X, Y, Z, 6); } shake(x, y, big ? 8 : 2); }
function debris(X, Y, Z, n) { if (S.reduced) n = Math.min(n, 2); for (let i = 0; i < n; i++) { const m = new T.Mesh(UNIT_BOX, CHAR); const s = 0.05 + Math.random() * 0.1; m.scale.set(s, s * 0.6, s * 1.3); m.position.set(X, Y + 0.2, Z); m.castShadow = true; const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3; const vel = { x: Math.cos(a) * sp, y: 3 + Math.random() * 4, z: Math.sin(a) * sp }; const spin = { x: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 }; fxAdd(m, 1.4 + Math.random() * 0.6, (f, k, dt) => { vel.y -= 14 * dt; m.position.x += vel.x * dt; m.position.y += vel.y * dt; m.position.z += vel.z * dt; m.rotation.x += spin.x * dt; m.rotation.z += spin.z * dt; if (m.position.y < 0.03) { m.position.y = 0.03; vel.y *= -0.3; vel.x *= 0.5; vel.z *= 0.5; spin.x *= 0.5; spin.z *= 0.5; } if (k < 0.5 && Math.random() < 0.4) PARTS.smoke.puff(m.position.x, m.position.y, m.position.z, 0x333333, 0.12, 0.6, 0.5); }); } }
function muzzlePos(e, out) { const v = S.views.get(e.id); if (v && v.muzzle && v.root.visible) { v.root.updateMatrixWorld(true); return v.muzzle.getWorldPosition(out); } return out.set(e.x * U, isAir(e.def) ? AIR_H : 0.4, e.y * U); }
function hitHeight(t) { const v = S.views.get(t.id); if (isAir(t.def)) return (v ? v.root.position.y : AIR_H) + 0.1; if (isStruct(t.def)) return 0.45; return (v ? v.root.position.y : 0) + (v && v.pr ? v.pr.height * v.scale * 0.55 : 0.3); }
function projectile(ev) {
  const w = ev.w, e = ev.e, v = S.views.get(e.id); if (v) { v.recoil = 1; v.flashT = 0.06; if (v.mixer && v.speed < 0.08) playOnce(v, 'fire', true); }
  const a = muzzlePos(e, new T.Vector3()); const b = new T.Vector3(ev.x2 * U, ev.tgt ? hitHeight(ev.tgt) : 0.2, ev.y2 * U);
  const dir = _a.copy(b).sub(a).normalize();
  // muzzle flash and smoke
  const big = w.wh === 'AP' || w.wh === 'HE' || w.wh === 'SIEGE'; PARTS.add.add(a.x + dir.x * 0.05, a.y, a.z + dir.z * 0.05, dir.x * 0.5, 0.1, dir.z * 0.5, big ? 0.09 : 0.05, big ? 0.55 : 0.28, big ? 0.2 : 0.1, 0xfff0b0, 1.6); if (big) { for (let i = 0; i < 3; i++) PARTS.smoke.add(a.x, a.y, a.z, dir.x * 0.8 + (Math.random() - 0.5) * 0.3, 0.2, dir.z * 0.8 + (Math.random() - 0.5) * 0.3, 0.7, 0.18, 0.55, 0x8a8478, 0.45, -0.05, 2); }
  if (w.wh === 'BEAM' || w.wh === 'EMP' || w.wh === 'HACK' || w.wh === 'TOXIN') { const col = w.wh === 'HACK' ? 0xff4fb4 : w.wh === 'EMP' ? 0x9ad7ff : w.wh === 'TOXIN' ? 0x8fff6a : 0x9ff3ff; const g = new T.Group(); g.add(beamMesh(a, b, w.wh === 'EMP' ? 0.09 : 0.065, col, 0.35), beamMesh(a, b, 0.018, 0xffffff, 0.95)); fxAdd(g, w.wh === 'TOXIN' ? 0.35 : 0.16, (f, k) => g.children.forEach((c, i) => c.material.opacity = (i ? 0.95 : 0.35) * (1 - k))); PARTS.add.spark(b.x, b.y, b.z, col, 5); PARTS.add.add(b.x, b.y, b.z, 0, 0, 0, 0.12, 0.35, 0.2, col, 1.4); if (w.wh === 'TOXIN') for (let i = 0; i < 4; i++) PARTS.smoke.puff(b.x, b.y, b.z, 0x6adf4a, 0.3, 1.0, 0.4); return; }
  if (w.wh === 'SA' || w.wh === 'FLAK') { const end = b.clone().add(new T.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.25)); const len = a.distanceTo(end), life = Math.max(0.05, len / 40); const tr = beamMesh(a, a.clone().add(_b.copy(end).sub(a).normalize().multiplyScalar(Math.min(0.5, len))), 0.012, w.wh === 'FLAK' ? 0xffd27a : 0xfff4c8, 0.95); const from = a.clone(), d2 = end.clone().sub(a); fxAdd(tr, life, (f, k) => { tr.position.copy(from).addScaledVector(d2, k); }, () => { if (w.wh === 'FLAK') { PARTS.smoke.puff(end.x, end.y, end.z, 0x2a2a2a, 0.22, 0.8, 0.7); PARTS.add.add(end.x, end.y, end.z, 0, 0, 0, 0.08, 0.35, 0.15, 0xffc060, 1.4); } else PARTS.add.spark(end.x, end.y, end.z, 0xffe6a0, 2); }); return; }
  // shells and rockets: arc, glow, trail
  const len = a.distanceTo(b); const speed = w.wh === 'SIEGE' ? 9 : w.wh === 'ROCKET' ? 14 : 22; const life = Math.min(0.9, Math.max(0.08, len / speed)); const arc = w.wh === 'SIEGE' ? Math.min(3, len * 0.35) : w.wh === 'ROCKET' ? 0.4 : 0.08;
  const m = new T.Group(); const core = new T.Mesh(UNIT_SPH, tmpMat({ color: w.wh === 'ROCKET' ? 0xffb050 : 0xffe6a0, opacity: 1, blending: T.AdditiveBlending })); core.scale.setScalar(w.wh === 'SIEGE' ? 0.07 : 0.045); m.add(core); if (w.wh === 'ROCKET') { const body = new T.Mesh(UNIT_BOX, tmpMat({ color: 0xdddddd, opacity: 1, transparent: false })); body.scale.set(0.16, 0.035, 0.035); m.add(body); }
  const from = a.clone(), d2 = b.clone().sub(a), prev = a.clone();
  fxAdd(m, life, (f, k) => { m.position.copy(from).addScaledVector(d2, k); m.position.y += Math.sin(k * Math.PI) * arc; m.lookAt(prev); m.rotateY(Math.PI / 2); if ((w.wh === 'ROCKET' || w.wh === 'SIEGE') && !S.reduced) PARTS.smoke.add(m.position.x, m.position.y, m.position.z, 0, 0.05, 0, 0.6, 0.06, 0.25, 0x9a948a, 0.5, 0, 1); prev.copy(m.position); }, () => { if (w.splash) { explosion(ev.x2, ev.y2, w.splash >= 1.5, b.y); decal(ev.x2, ev.y2, w.splash >= 1.5 ? 16 : 9, 'scorch'); } else { PARTS.add.spark(b.x, b.y, b.z, 0xffb347, 6); PARTS.add.add(b.x, b.y, b.z, 0, 0, 0, 0.08, 0.4, 0.2, 0xffc060, 1.4); PARTS.smoke.puff(b.x, b.y, b.z, 0x444444, 0.2, 0.7, 0.5); } });
}
function wreck(e) {
  const d = e.def; const v = S.views.get(e.id); if (!v) { if (isAir(d)) explosion(e.x, e.y, false, AIR_H); else explosion(e.x, e.y, d.armour === 'heavy'); return; }
  S.views.delete(e.id); const root = v.root;
  if (isAir(d)) { const vel = { x: Math.cos(v.face) * 2, y: 0, z: Math.sin(v.face) * 2 }; explosion(e.x, e.y, false, root.position.y); fxAdd(null, 2.5, (f, k, dt) => { vel.y -= 6 * dt; root.position.x += vel.x * dt; root.position.y += vel.y * dt; root.position.z += vel.z * dt; root.rotation.x += dt * 3; if (Math.random() < 0.6) { PARTS.smoke.puff(root.position.x, root.position.y, root.position.z, 0x222222, 0.3, 1.2, 0.7); PARTS.add.fire(root.position.x, root.position.y, root.position.z, 0.3); } if (root.position.y <= 0.05 && !f.boom) { f.boom = true; explosion(root.position.x * CELL, root.position.z * CELL, true); decal(root.position.x * CELL, root.position.z * CELL, 16, 'crater'); world.remove(root); } }, () => world.remove(root)); return; }
  if (isStruct(d)) { setMeshMode(v, 'normal'); const w = e.fw, h = e.fh; for (let i = 0; i < 4; i++) setTimeout(() => explosion(e.x + (Math.random() - 0.5) * w * CELL * 0.7, e.y + (Math.random() - 0.5) * h * CELL * 0.7, i % 2 === 0), i * 160); decal(e.x, e.y, Math.max(w, h) * CELL * 0.55, 'scorch'); debris(e.x * U, 0.4, e.y * U, 8);
    fxAdd(null, 1.0, (f, k) => { v.body.scale.y = Math.max(0.12, 1 - k * 0.88); if (Math.random() < 0.8) PARTS.smoke.puff(e.x * U + (Math.random() - 0.5) * w, 0.3 + Math.random() * 0.5, e.y * U + (Math.random() - 0.5) * h, 0x6b6456, 0.7, 2.2, 0.6); }, () => { setMeshMode(v, 'char'); fxAdd(null, 60, (f, k) => { if (k > 0.85) root.position.y = -(k - 0.85) * 2; if (f.t < 8 && Math.random() < 0.15) PARTS.add.fire(e.x * U + (Math.random() - 0.5) * w * 0.6, 0.2, e.y * U + (Math.random() - 0.5) * h * 0.6, 0.4); }, () => world.remove(root)); }); return; }
  if ((isInf(d) || d.cls === 'drone') && v.mixer && v.actions.die) { setMeshMode(v, 'normal'); playOnce(v, 'die'); PARTS.add.spark(root.position.x, 0.4, root.position.z, 0xd94b3b, 4); fxAdd(null, 25, (f, k, dt) => { v.mixer.update(dt); if (k > 0.8) root.position.y = -(k - 0.8) * 0.6; }, () => world.remove(root)); return; }
  if (isInf(d)) { setMeshMode(v, 'normal'); for (const l of v.legs) l.g.rotation.z = 0; const dir = Math.random() < 0.5 ? 1 : -1; PARTS.add.spark(root.position.x, 0.4, root.position.z, 0xd94b3b, 4); fxAdd(null, 25, (f, k) => { const kk = Math.min(1, f.t / 0.45); v.body.rotation.z = -1.45 * kk * dir; v.body.position.y = 0.05 * kk; if (k > 0.8) root.position.y = -(k - 0.8) * 0.6; }, () => world.remove(root)); return; }
  // vehicles and drones: burning charred hull, turret thrown
  setMeshMode(v, 'char'); explosion(e.x, e.y, d.armour === 'heavy'); decal(e.x, e.y, 14, 'scorch'); debris(root.position.x, root.position.y + 0.2, root.position.z, d.armour === 'heavy' ? 7 : 4);
  if (v.turret) { const tv = { y: 4, r: (Math.random() - 0.5) * 6 }; fxAdd(null, 0.9, (f, k, dt) => { tv.y -= 12 * dt; v.turret.position.y = Math.max(0, v.turret.position.y + tv.y * dt); v.turret.rotation.y += tv.r * dt; v.turret.rotation.z += dt * 2; }); }
  fxAdd(null, 40, (f, k) => { if (f.t < 5 && Math.random() < 0.35) PARTS.add.fire(root.position.x, root.position.y + 0.25, root.position.z, 0.3); if (f.t < 12 && Math.random() < 0.25) PARTS.smoke.puff(root.position.x, root.position.y + 0.3, root.position.z, 0x1e1e1e, 0.3, 2.2, 0.55); if (k > 0.85) root.position.y -= 0.004; }, () => world.remove(root));
}
function nuke(x, y, small) { const X = x * U, Z = y * U, r = small ? 2.5 : 4; S.flash = small ? 0.4 : 0.9; const ball = new T.Mesh(UNIT_SPH, tmpMat({ color: 0xfff1b8, opacity: 1, blending: T.AdditiveBlending })); ball.position.set(X, 0.3, Z); fxAdd(ball, 1.6, (f, k) => { ball.scale.setScalar(0.2 + r * 0.9 * Math.sqrt(k)); ball.material.opacity = 1 - k; ball.material.color.setHex(k < 0.3 ? 0xfff1b8 : 0xff8a3a); }); shockRing(X, Z, r * 2.2, 0xff9a40, 1.4); for (let i = 0; i < (small ? 40 : 90); i++) { const a = Math.random() * 6.28, s = Math.random() * r; PARTS.smoke.add(X + Math.cos(a) * s * 0.4, 0.2 + Math.random() * 0.5, Z + Math.sin(a) * s * 0.4, Math.cos(a) * s * 0.6, 1.5 + Math.random() * 2.5, Math.sin(a) * s * 0.6, 3 + Math.random() * 3, 1.0, 3.2, i % 3 ? 0x3a2e26 : 0x7a5a3a, 0.7, 0, 0.5); PARTS.add.add(X, 0.3, Z, Math.cos(a) * s * 2, 0.5 + Math.random() * 3, Math.sin(a) * s * 2, 0.6 + Math.random() * 0.6, 0.8, 1.6, 0xff7a22, 1.2, 0, 1); } shake(x, y, small ? 10 : 20); }
function speech(e, text) { const v = S.views.get(e.id); if (!v) return; v.speech = text; v.speechT = 2.2; }
function setStarts(starts) { if (startG) { world.remove(startG); startG = null; } if (!starts || !starts.length) return; startG = new T.Group(); starts.forEach((st, i) => { const c = SIM.SLOT_COLORS[i]; const g = new T.BufferGeometry().setFromPoints([new T.Vector3(st.x, 0.08, st.y), new T.Vector3(st.x + 3, 0.08, st.y), new T.Vector3(st.x + 3, 0.08, st.y + 3), new T.Vector3(st.x, 0.08, st.y + 3)]); startG.add(new T.LineLoop(g, new T.LineBasicMaterial({ color: c }))); const p = new T.Mesh(new T.PlaneGeometry(3, 3), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, depthWrite: false })); p.rotation.x = -Math.PI / 2; p.position.set(st.x + 1.5, 0.06, st.y + 1.5); startG.add(p); }); world.add(startG); }

// ───────── decor objects: mines, crates, hazard fields ─────────
const crateViews = new Map(); const CRATE_MAT = fogify(new T.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 }), null, 'crate'); const MINE_MAT = new T.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.5 }); const MINE_GEO = new T.CylinderGeometry(0.1, 0.12, 0.05, 10);
let mineMesh = null;
function syncDecor(dt) {
  const me = S.me; const seen = new Set();
  for (const c of G.crates || []) { const i = idx(Math.floor(c.x * U), Math.floor(c.y * U)); if (!me || !me.vis[i]) continue; seen.add(c); let m = crateViews.get(c); if (!m) { m = new T.Mesh(UNIT_BOX, CRATE_MAT); m.scale.set(0.38, 0.32, 0.38); m.castShadow = true; world.add(m); crateViews.set(c, m); } m.position.set(c.x * U, 0.16 + Math.sin(S.time * 3) * 0.03, c.y * U); m.rotation.y = S.time * 0.6; if (Math.random() < dt * 4) PARTS.add.add(c.x * U, 0.45, c.y * U, 0, 0.4, 0, 0.6, 0.18, 0.05, 0xffe08a, 0.8); }
  for (const [c, m] of crateViews) if (!seen.has(c)) { world.remove(m); crateViews.delete(c); }
  const mines = (G.mines || []).filter(m => m.owner === me); const msig = mines.length + ':' + (mines[0] ? mines[0].x : 0); if (msig !== S.mineSig) { S.mineSig = msig; if (mineMesh) { world.remove(mineMesh); mineMesh = null; } } if (mines.length && !mineMesh) { mineMesh = new T.InstancedMesh(MINE_GEO, MINE_MAT, mines.length); mines.forEach((m, i) => mineMesh.setMatrixAt(i, _m4.makeTranslation(m.x * U, 0.03, m.y * U))); world.add(mineMesh); }
  for (const f of G.fields || []) { if (S.reduced || Math.random() > dt * 18) continue; const a = Math.random() * 6.28, r = Math.random() * f.r * U; PARTS.smoke.add(f.x * U + Math.cos(a) * r, 0.1, f.y * U + Math.sin(a) * r, 0, 0.12, 0, 1.6, 0.3, 0.8, f.kind === 'nano' ? 0xe0479e : 0x9be37a, 0.35, 0, 0.5); }
}

// ───────── placement ghost, order marker ─────────
const GHOST_OK = new T.MeshBasicMaterial({ color: 0x64ff8c, transparent: true, opacity: 0.32, depthWrite: false }), GHOST_BAD = new T.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.35, depthWrite: false });
function syncPlacing() {
  if (!S.placing) { if (ghostG) { if (ghostG.userData.radius) world.remove(ghostG.userData.radius); world.remove(ghostG); ghostG = null; S.ghostKey = null; } return; }
  const d = S.placing.d, [w, h] = FOOT(d); const key = d.id; if (S.ghostKey !== key) { if (ghostG) { if (ghostG.userData.radius) world.remove(ghostG.userData.radius); world.remove(ghostG); } ghostG = new T.Group(); S.ghostKey = key; const pad = new T.Mesh(new T.PlaneGeometry(w, h), GHOST_OK); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.04; ghostG.add(pad); ghostG.userData.pad = pad; const pr = proto(d.id, d.faction); if (pr && pr.glb) { const g2 = T.SkeletonUtils.clone(pr.scene); g2.traverse(o => { if (o.isMesh) o.material = ghostOf(factionMat(d.faction)); }); ghostG.add(g2); } else if (pr) { const b = new T.Group(); for (const set of [pr.main, pr.turret]) if (set) for (const g of [set.body, set.team, set.glow]) if (g) { const m = new T.Mesh(g, ghostOf(factionMat(d.faction))); if (set === pr.turret) m.position.set(pr.turret.pivot.x, 0, pr.turret.pivot.z); b.add(m); } ghostG.add(b); }
    const pts = []; const rr = RULES.base.buildRadiusCells; for (const e of G.ents) if (!e.dead && e.owner === S.me && e.def.cls === 'structure') { const x0 = e.x * U - rr, x1 = e.x * U + rr, z0 = e.y * U - rr, z1 = e.y * U + rr; pts.push(x0, 0.05, z0, x1, 0.05, z0, x1, 0.05, z0, x1, 0.05, z1, x1, 0.05, z1, x0, 0.05, z1, x0, 0.05, z1, x0, 0.05, z0); } const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); const ls = new T.LineSegments(lg, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })); ls.userData.abs = true; world.add(ls); ghostG.userData.radius = ls; world.add(ghostG); }
  const ok = SIM.canPlace(S.me, d, S.placing.cx, S.placing.cy); ghostG.position.set(S.placing.cx + w / 2, 0, S.placing.cy + h / 2); ghostG.userData.pad.material = ok ? GHOST_OK : GHOST_BAD;
  if (ghostG.userData.radius && !ghostG.userData.radius.parent) world.add(ghostG.userData.radius);
}
function syncMarker(dt) { if (!S.marker) { if (markerMesh) markerMesh.visible = false; return; } if (!markerMesh) { markerMesh = new T.Mesh(RING_GEO, ringMat(0xffffff, 0.9)); world.add(markerMesh); } S.marker.t -= dt; if (S.marker.t <= 0) { S.marker = null; markerMesh.visible = false; return; } markerMesh.visible = true; markerMesh.material.color.setHex(S.marker.col); markerMesh.material.opacity = Math.min(1, S.marker.t * 2); const s = 0.25 + (0.6 - Math.min(0.6, S.marker.t)) * 1.2; markerMesh.scale.set(s, 1, s); markerMesh.position.set(S.marker.x * U, groundAt(S.marker.x, S.marker.y) + 0.05, S.marker.y * U); }

// ───────── 2D overlay: health bars, ranks, badges, speech, box selection ─────────
function hpColor(f) { return f > 0.5 ? '#3fdc5a' : f > 0.25 ? '#f2d03b' : '#ef4b4b'; }
function drawOverlay() {
  const W = S.app.screen.width, H = S.app.screen.height; ov.clearRect(0, 0, W, H); const me = S.me;
  for (const v of S.views.values()) { const e = v.e; if (!v.root.visible || e.dead) continue; const d = e.def; const sel = S.sel.includes(e); const show = sel || e.hp < d.hp || (d.shield && e.shield < d.shield.hp);
    const topH = v.root.position.y + (v.pr ? v.pr.height * v.scale * v.body.scale.y : 0.6) + 0.18; const p = worldToScreen(e.x, e.y, topH); if (p.z > 1 || p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
    const px = S.cam.zoom; const bw = isStruct(d) ? Math.max(30, e.fw * CELL * px * 0.8) : 30;
    if (show && !e.building) { const f = Math.max(0, e.hp / d.hp); ov.fillStyle = 'rgba(0,0,0,0.65)'; ov.fillRect(p.x - bw / 2 - 1, p.y - 6, bw + 2, 6); ov.fillStyle = hpColor(f); ov.fillRect(p.x - bw / 2, p.y - 5, bw * f, 4); if (d.shield) { ov.fillStyle = '#5aa7ff'; ov.fillRect(p.x - bw / 2, p.y - 9, bw * Math.max(0, e.shield / d.shield.hp), 2); } }
    if (e.building) { ov.fillStyle = 'rgba(0,0,0,0.6)'; ov.fillRect(p.x - bw / 2, p.y - 5, bw, 3); ov.fillStyle = '#c9bcff'; ov.fillRect(p.x - bw / 2, p.y - 5, bw * (1 - e.building), 3); }
    if (e.rank) { ov.fillStyle = '#ffd86b'; for (let i = 0; i < e.rank; i++) { const bx = p.x + bw / 2 + 3, by = p.y - 2 - i * 5; ov.beginPath(); ov.moveTo(bx, by); ov.lineTo(bx + 4, by - 4); ov.lineTo(bx + 8, by); ov.lineTo(bx + 4, by - 2); ov.fill(); } }
    if (d.garrison && e.occupants && e.occupants.length) { ov.font = '600 11px Sora, system-ui, sans-serif'; ov.textAlign = 'center'; ov.lineWidth = 3; ov.strokeStyle = '#000'; const t = `${e.occupants.length}/${d.garrison}`; ov.strokeText(t, p.x, p.y - 9); ov.fillStyle = e.owner === me ? '#9be37a' : '#ff8a8a'; ov.fillText(t, p.x, p.y - 9); }
    if (v.speech) { v.speechT -= 1 / 60; if (v.speechT <= 0) v.speech = null; else { ov.font = '500 11px Sora, system-ui, sans-serif'; ov.textAlign = 'center'; ov.lineWidth = 3; ov.strokeStyle = 'rgba(0,0,0,0.85)'; ov.strokeText(v.speech, p.x, p.y - 12); ov.fillStyle = '#fff'; ov.fillText(v.speech, p.x, p.y - 12); } } }
  if (S.box) { const a = worldToScreen(S.box.x0, S.box.y0), b = worldToScreen(S.box.x1, S.box.y1); ov.strokeStyle = 'rgba(255,255,255,0.9)'; ov.lineWidth = 1; ov.fillStyle = 'rgba(201,188,255,0.08)'; ov.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); ov.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  if (S.flash > 0) { ov.fillStyle = `rgba(255,248,225,${Math.min(1, S.flash)})`; ov.fillRect(0, 0, W, H); }
}

// ───────── frame ─────────
function frame(dt) {
  S.time += dt; WATER_T.value = S.time;
  if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 24); S.shakeX = (Math.random() - 0.5) * S.shake; S.shakeY = (Math.random() - 0.5) * S.shake; } else S.shakeX = S.shakeY = 0;
  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 2.5);
  const t = updateCamera(true);
  const span = S.app.screen.height / S.cam.zoom * U; const half = clamp(span * 0.9, 12, 60); const sc = sun.shadow.camera; if (Math.abs(sc.right - half) > 0.5) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
  sun.position.set(t.x - 14, 30, t.z + 9); sun.target.position.set(t.x, 0, t.z); sun.target.updateMatrixWorld();
  if (G.fogT != null && G.fogT < 0.05) updateFog();
  S.oreT = (S.oreT || 0) + dt; if (S.oreT > 0.8) { S.oreT = 0; refreshOre(false); }
  const c0 = performance.now(); syncViews(dt); syncDecor(dt); syncPlacing(); syncMarker(dt); updateFx(dt); drawDecals(dt);
  PARTS.add.update(dt); PARTS.smoke.update(dt); const c1 = performance.now();
  R.render(scene, camera); const c2 = performance.now(); drawOverlay(); S.prof = { cpu: c1 - c0, gpuSubmit: c2 - c1, overlay: performance.now() - c2, calls: R.info.render.calls, tris: R.info.render.triangles, particles: PARTS.add.n + PARTS.smoke.n, fx: S.fx.length };
}

// ───────── events from the simulation ─────────
function handleEvent(ev) {
  const me = S.me; const seen = e => e && (e.owner === me || visibleTo(me, e));
  switch (ev.type) {
    case 'shot': if (me && (seen(ev.e) || seen(ev.tgt))) projectile(ev); else { const v = S.views.get(ev.e.id); if (v) v.recoil = 1; } break;
    case 'death': if (seen(ev.e)) wreck(ev.e); else dropView(ev.e); break;
    case 'hit': { const e = ev.e; const v = S.views.get(e.id); if (v && ev.dmg > 0 && (v.hitCd || 0) <= S.time) { v.hitT = 0.06; v.hitCd = S.time + 0.3; } break; }
    case 'crush': PARTS.add.spark(ev.x * U, 0.2, ev.y * U, 0xd94b3b, 6); break;
    case 'promote': PARTS.add.spark(ev.e.x * U, 0.8, ev.e.y * U, 0xffd86b, 14); break;
    case 'sold': { const e = ev.e; PARTS.add.spark(e.x * U, 0.6, e.y * U, 0x9be37a, 14); for (let i = 0; i < 6; i++) PARTS.smoke.puff(e.x * U + (Math.random() - 0.5) * (e.fw || 1), 0.3, e.y * U + (Math.random() - 0.5) * (e.fh || 1), 0x7a7468, 0.5, 1.5, 0.5); dropView(e); break; }
    case 'unload': PARTS.add.spark(ev.e.x * U, 0.6, ev.e.y * U, 0xffd86b, 5); break;
    case 'built': PARTS.add.spark(ev.e.x * U, 1.0, ev.e.y * U, 0xffffff, 10); break;
    case 'cratepick': PARTS.add.spark(ev.x * U, 0.4, ev.y * U, 0xe8b84a, 16); break;
    case 'impact': { const X = ev.x * U, Z = ev.y * U; const g = beamMesh(new T.Vector3(X + 3, 14, Z - 6), new T.Vector3(X, 0.1, Z), 0.04, 0xffd27a, 0.9); fxAdd(g, 0.22, (f, k) => g.material.opacity = 0.9 * (1 - k)); explosion(ev.x, ev.y, ev.big); decal(ev.x, ev.y, ev.big ? 22 : 12, ev.big ? 'crater' : 'scorch'); break; }
    case 'nuke': nuke(ev.x, ev.y, ev.small); decal(ev.x, ev.y, ev.small ? 40 : 70, 'crater'); break;
    case 'dome': { const m = new T.Mesh(UNIT_SPH, tmpMat({ color: ev.col, opacity: 0.16, blending: T.AdditiveBlending, side: T.DoubleSide })); m.position.set(ev.x * U, 0, ev.y * U); m.scale.set(ev.r * U, ev.r * U * 0.6, ev.r * U); fxAdd(m, ev.seconds, (f, k) => m.material.opacity = 0.16 * (k > 0.85 ? (1 - k) / 0.15 : 1) * (0.8 + 0.2 * Math.sin(S.time * 4))); break; }
    case 'pulse': shockRing(ev.x * U, ev.y * U, ev.r * U, ev.col, 0.6); break;
    case 'teleport': PARTS.add.spark(ev.x1 * U, 0.5, ev.y1 * U, 0xe0479e, 14); PARTS.add.spark(ev.x2 * U, 0.5, ev.y2 * U, 0xe0479e, 14); shockRing(ev.x2 * U, ev.y2 * U, 1.3, 0xe0479e, 0.6); break;
    case 'drop': PARTS.add.spark(ev.e.x * U, 1.2, ev.e.y * U, 0xffffff, 10); break;
    case 'mines': shockRing(ev.x * U, ev.y * U, 1.6, 0xd9a441, 0.6); break;
    case 'mine': explosion(ev.x, ev.y, false); decal(ev.x, ev.y, 12, 'crater'); break;
    case 'absorb': PARTS.add.spark(ev.e.x * U, 0.5, ev.e.y * U, 0xd9a441, 3); break;
    case 'emp': if (seen(ev.e)) PARTS.add.spark(ev.e.x * U, 0.5, ev.e.y * U, 0x9ad7ff, 8); break;
    case 'hack': PARTS.add.spark(ev.e.x * U, 0.5, ev.e.y * U, 0xe0479e, 12); break;
    case 'garrison': PARTS.add.spark(ev.b.x * U, 0.8, ev.b.y * U, 0x9be37a, 8); break;
    case 'capture': PARTS.add.spark(ev.e.x * U, 0.8, ev.e.y * U, 0x9be37a, 18); break;
    case 'infiltrate': PARTS.add.spark(ev.e.x * U, 0.8, ev.e.y * U, 0xe0479e, 22); shockRing(ev.e.x * U, ev.e.y * U, 1.4, 0xe0479e, 0.6); break;
  }
}
return { S, AT, THEMES, init, bakeTerrain, frame, handleEvent, screenToWorld, worldToScreen, clampCam, centerOn, speech, updateFog, explosion, setStarts, airPick: AIR_H * CELL / Math.tan(ELEV), structPick: 0.9 * CELL, groundAt, proto };
})();
