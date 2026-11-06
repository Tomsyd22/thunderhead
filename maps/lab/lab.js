// Thunderhead Map Lab: interactive inspection and movement-testing scene for the five metric RTS maps.
// World axes (data): x east, y north, z up, metres. three.js axes: (x, z_up, -y).
// Everything shown is read from data/ or measured from the renderer; missing inputs are labelled as missing.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
function fatal(html) {
  $('#fatalText').innerHTML = html; $('#fatal').style.display = 'grid'; $('#loading').classList.add('hide');
}

let THREE, GLTFLoader, MapControls, BGU, Line2, LineMaterial, LineGeometry, RoomEnvironment;
try {
  const m = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/controls/MapControls.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
    import('three/addons/lines/Line2.js'),
    import('three/addons/lines/LineMaterial.js'),
    import('three/addons/lines/LineGeometry.js'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]);
  THREE = m[0]; GLTFLoader = m[1].GLTFLoader; MapControls = m[2].MapControls; BGU = m[3];
  Line2 = m[4].Line2; LineMaterial = m[5].LineMaterial; LineGeometry = m[6].LineGeometry; RoomEnvironment = m[7].RoomEnvironment;
} catch (e) {
  fatal(`three.js r160 could not be loaded from <span class="mono">cdn.jsdelivr.net</span>.<br><span class="muted">${esc(e.message || e)}</span>`);
  throw e;
}

// ───────────────────────────── pace (game speed) ─────────────────────────────
// data/pace.json: one global game speed (uniform time scale) and the harvester's speed relative to the tank class.
// Route times are computed in GAME seconds and shown in real seconds (game ÷ game speed). Model: pace.js (shared with the Unit Sandbox).
const PACE = await import('./pace.js');
const PACE_FILE = await PACE.loadPace('data/pace.json');
const P = structuredClone(PACE_FILE);
try { const sv = JSON.parse(localStorage.getItem('maplab.pace') || 'null'); if (sv) { if (isFinite(sv.g)) P.game_speed = sv.g; if (isFinite(sv.r)) P.harvester_speed_ratio = sv.r; if (isFinite(sv.load)) P.harvester.load_s = sv.load; if (isFinite(sv.unload)) P.harvester.unload_s = sv.unload; } } catch (e) { /* storage unavailable */ }
function savePace() { try { localStorage.setItem('maplab.pace', JSON.stringify({ g: P.game_speed, r: P.harvester_speed_ratio, load: P.harvester.load_s, unload: P.harvester.unload_s })); } catch (e) { /* ignore */ } }
const realT = (gameS) => (gameS == null ? null : gameS / P.game_speed);

// ───────────────────────────── constants ─────────────────────────────
const TEAM_HEX = { 1: '#2B6FD6', 2: '#C8322B' };
const MISSING_HEX = '#E08A3C';
const CLASSES = ['infantry', 'tank', 'harvester', 'amphibious', 'ship'];
const CLASS_NAME = { infantry: 'Infantry', tank: 'Tank', harvester: 'Harvester', amphibious: 'Amphibious', ship: 'Ship' };
const CLASS_MODEL = { infantry: 'unit_infantry_walk', tank: 'unit_mbt', harvester: 'unit_harvester', amphibious: 'unit_apc', ship: 'unit_patrol_boat' };
const SURF_NAME = { 0: 'grass', 1: 'meadow', 2: 'dirt', 3: 'sand', 4: 'rock', 5: 'concrete', 6: 'gravel', 7: 'asphalt', 8: 'mud', 9: 'farm', 10: 'soil', 11: 'forest', 12: 'wet sand', 13: 'quarry', 255: 'water' };
// Biome palettes (linear RGB) — the same values the Blender assembler uses (maps/blender/scene.py PAL), sun = (elevation°, azimuth°).
const PAL = {
  '01': { grass: [0.19, 0.30, 0.07], grass2: [0.32, 0.38, 0.11], dry: [0.47, 0.45, 0.22], sand: [0.72, 0.66, 0.50], rock: [0.62, 0.60, 0.55], rock2: [0.45, 0.44, 0.41], soil: [0.36, 0.31, 0.24], sun: [42, 215] },
  '02': { grass: [0.20, 0.33, 0.08], grass2: [0.30, 0.40, 0.10], dry: [0.42, 0.42, 0.20], sand: [0.55, 0.47, 0.33], rock: [0.35, 0.33, 0.30], rock2: [0.25, 0.24, 0.22], soil: [0.33, 0.27, 0.19], sun: [48, 205] },
  '03': { grass: [0.20, 0.30, 0.09], grass2: [0.30, 0.34, 0.12], dry: [0.42, 0.40, 0.24], sand: [0.55, 0.52, 0.45], rock: [0.50, 0.49, 0.47], rock2: [0.36, 0.35, 0.34], soil: [0.30, 0.27, 0.22], sun: [38, 200] },
  '04': { grass: [0.22, 0.38, 0.08], grass2: [0.36, 0.45, 0.12], dry: [0.55, 0.52, 0.30], sand: [0.92, 0.88, 0.76], rock: [0.22, 0.21, 0.21], rock2: [0.15, 0.15, 0.15], soil: [0.42, 0.36, 0.26], sun: [58, 220] },
  '05': { grass: [0.26, 0.32, 0.09], grass2: [0.40, 0.40, 0.16], dry: [0.55, 0.48, 0.25], sand: [0.66, 0.58, 0.44], rock: [0.58, 0.40, 0.27], rock2: [0.42, 0.28, 0.19], soil: [0.48, 0.32, 0.20], sun: [34, 235] },
};
// Water: shallow / deep (linear RGB), biome-tinted.
const WATER = {
  '01': { shallow: [0.10, 0.42, 0.38], deep: [0.012, 0.075, 0.11] },
  '02': { shallow: [0.15, 0.28, 0.18], deep: [0.025, 0.085, 0.085] },
  '03': { shallow: [0.06, 0.22, 0.30], deep: [0.006, 0.035, 0.085] },
  '04': { shallow: [0.18, 0.66, 0.62], deep: [0.010, 0.11, 0.24] },
  '05': { shallow: [0.08, 0.30, 0.36], deep: [0.010, 0.060, 0.14] },
};
const QUALITY = {
  low: { pr: () => Math.min(devicePixelRatio, 1) * 0.75, shadows: false, shadowMap: 0, terrLod: [200, 600], dist: { tree: 5000, smallveg: 220, rock: 700, smallprop: 300, struct: 1e9 }, lod1: 160, note: 'Pixel ratio ×0.75, no shadows, shrubs/crops to 220 m, small props to 300 m, rocks to 700 m, tree LOD1 beyond 160 m.' },
  medium: { pr: () => Math.min(devicePixelRatio, 1.5), shadows: true, shadowMap: 1024, terrLod: [400, 1100], dist: { tree: 7000, smallveg: 450, rock: 1400, smallprop: 700, struct: 1e9 }, lod1: 320, note: 'Pixel ratio ≤1.5, 1024² shadows near the camera, shrubs/crops to 450 m, rocks to 1.4 km, tree LOD1 beyond 320 m.' },
  high: { pr: () => Math.min(devicePixelRatio, 2), shadows: true, shadowMap: 2048, terrLod: [900, 2400], dist: { tree: 12000, smallveg: 900, rock: 3000, smallprop: 1400, struct: 1e9 }, lod1: 600, note: 'Pixel ratio ≤2, 2048² shadows (trees cast), shrubs/crops to 900 m, rocks to 3 km, tree LOD1 beyond 600 m.' },
};
const OVERLAYS = [
  { key: 'grid', label: 'Metric grid', hint: '10 m and 100 m lines on the ground', sw: '#e9c46a' },
  { key: 'bounds', label: 'Asset bounds', hint: 'box per drawn instance (measured / default size)', sw: '#8db3cf' },
  { key: 'reserve', label: 'Base reservations', hint: '220 m pads, 30 m grading band, 12 m aisle, 50 m service areas', sw: '#d6a24c' },
  { key: 'nav', label: 'Navigation (impassable)', hint: 'tints cells the movement class cannot enter', sw: '#db3328' },
  { key: 'height', label: 'Height ramp + contours', hint: '5 m and 25 m contours', sw: '#b7b46a' },
  { key: 'depth', label: 'Water depth', hint: 'bands with the 3 m ship-depth line', sw: '#3f8fb8' },
  { key: 'resources', label: 'Resource IDs', hint: 'deposit labels and pins', sw: '#d6a24c' },
  { key: 'roads', label: 'Road corridors', hint: 'clear width + 6 m safety band', sw: '#7fa6c4' },
  { key: 'starts', label: 'Player starts + radar', hint: 'start markers, 220 m radar reveal', sw: '#2b6fd6' },
  { key: 'collision', label: 'Collision shapes', hint: 'coarse static boxes (same as the Blender COLLISION mesh)', sw: '#e76f51' },
];
const PRESETS = [
  { key: 'overview', name: 'Overview', scale: 'strategic overview' },
  { key: 'gameplay', name: 'Gameplay', scale: 'gameplay' },
  { key: 'base', name: 'Base close-up', scale: 'close-up' },
  { key: 'harbor', name: 'Harbour close-up', scale: 'close-up' },
  { key: 'detail', name: 'Biome detail', scale: 'close-up · free' },
];

// ───────────────────────────── UI state ─────────────────────────────
const S = {
  quality: 'medium', cls: 'tank', tool: 'select', showMissing: true, dots: true, rTab: 'move', drawer: null,
  ov: { grid: false, bounds: false, reserve: false, nav: false, height: false, depth: false, resources: true, roads: false, starts: true },
};
try {
  const saved = JSON.parse(localStorage.getItem('maplab.ui') || 'null');
  if (saved) {
    if (QUALITY[saved.quality]) S.quality = saved.quality;
    if (CLASSES.includes(saved.cls)) S.cls = saved.cls;
    if (saved.ov) for (const k in S.ov) if (typeof saved.ov[k] === 'boolean') S.ov[k] = saved.ov[k];
    if (typeof saved.showMissing === 'boolean') S.showMissing = saved.showMissing;
    if (typeof saved.dots === 'boolean') S.dots = saved.dots;
  }
} catch (e) { /* storage unavailable: defaults */ }
const qp = new URLSearchParams(location.search);
if (QUALITY[qp.get('quality')]) S.quality = qp.get('quality');
function saveUI() {
  try { localStorage.setItem('maplab.ui', JSON.stringify({ quality: S.quality, cls: S.cls, ov: S.ov, showMissing: S.showMissing, dots: S.dots })); } catch (e) { /* ignore */ }
}

// ───────────────────────────── renderer & scene ─────────────────────────────
const canvas = $('#view');
// MSAA is decided before the real context exists: a probe context reads the GPU string, and software rasterisers
// (SwiftShader, llvmpipe) get MSAA off because multisampling multiplies their CPU cost. ?aa=1 / ?aa=0 overrides.
const AA = (() => {
  const q = new URLSearchParams(location.search).get('aa');
  if (q === '0' || q === '1') return { on: q === '1', why: 'set by ?aa' };
  try {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c && c.getExtension('WEBGL_debug_renderer_info');
    const r = c ? String(c.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : c.RENDERER)) : '';
    c?.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software/i.test(r)) return { on: false, why: 'software GPU' };
  } catch (e) { /* probe failed: keep MSAA */ }
  return { on: true, why: 'default' };
})();
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: AA.on, powerPreference: 'high-performance' });
} catch (e) {
  fatal(`WebGL could not be initialised in this browser.<br><span class="muted">${esc(e.message || e)}</span>`);
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const gl = renderer.getContext();
const GPU = (() => {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  let r = null, v = null;
  if (ext) { r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); v = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); }
  const masked = !r;
  if (!r) { r = gl.getParameter(gl.RENDERER); v = gl.getParameter(gl.VENDOR); }
  return { renderer: String(r), vendor: String(v), masked, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(r)), webgl2: renderer.capabilities.isWebGL2 };
})();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 40000);
camera.position.set(900, 2000, -880);
const controls = new MapControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.14; controls.screenSpacePanning = false;
controls.maxPolarAngle = THREE.MathUtils.degToRad(88); controls.minDistance = 2; controls.maxDistance = 9000;
controls.zoomToCursor = true; controls.zoomSpeed = 1.2;

const hemi = new THREE.HemisphereLight(0xd3e2ee, 0x564b3a, 1.15);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
scene.add(hemi, sun, sun.target);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
const HAZE = new THREE.Color(0.52, 0.62, 0.70);
scene.fog = new THREE.Fog(HAZE, 2000, 9000);

const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
  uniforms: { uTop: { value: new THREE.Color(0.16, 0.30, 0.52) }, uHorizon: { value: HAZE.clone() }, uBottom: { value: new THREE.Color(0.018, 0.022, 0.027) } },
  vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.9999; }`,
  fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; varying vec3 vDir;
    void main() { float y = normalize(vDir).y; vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, y), 0.75)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.06, y));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
}));
sky.renderOrder = -1000; sky.frustumCulled = false; sky.material.userData.shared = true; sky.geometry.userData.shared = true;
scene.add(sky);

const G = {};
for (const k of ['terrain', 'water', 'roads', 'structs', 'inst', 'overlay', 'route', 'tests', 'sel', 'dots']) { G[k] = new THREE.Group(); G[k].name = k; scene.add(G[k]); }
const OVG = {};
for (const o of OVERLAYS) { OVG[o.key] = new THREE.Group(); OVG[o.key].name = 'ov_' + o.key; G.overlay.add(OVG[o.key]); }

// ───────────────────────────── shared shader uniforms ─────────────────────────────
const U = {
  uSurf: { value: null }, uNav: { value: null }, uH: { value: null },
  uCell: { value: 4 }, uN: { value: 2 }, uNN: { value: 1 }, uNavOff: { value: 1 }, uS: { value: 1000 },
  uPal: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
  uGridOn: { value: 0 }, uHeightOn: { value: 0 }, uDepthOn: { value: 0 }, uNavBit: { value: 0 },
  uHR: { value: new THREE.Vector2(0, 50) }, uTime: { value: 0 },
  uShallow: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uSky: { value: new THREE.Color(0.45, 0.58, 0.70) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
};
const GLSL_COMMON = /* glsl */`
uniform sampler2D uNav; uniform float uCell; uniform float uNN; uniform float uNavOff; uniform float uGridOn; uniform int uNavBit; uniform float uS;
float lh_hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lh_noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh_hash(i), lh_hash(i + vec2(1.0, 0.0)), u.x), mix(lh_hash(i + vec2(0.0, 1.0)), lh_hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float lh_fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int k = 0; k < 3; k++) { s += a * lh_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s * 1.143; }
float lh_line(float v, float spacing, float px) { float fw = max(fwidth(v), 1e-5); float d = abs(fract(v / spacing + 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(px * 0.5 * fw, (px * 0.5 + 1.0) * fw, d); }
float lh_dens(float v, float spacing) { float fw = max(fwidth(v), 1e-5); return smoothstep(3.0, 9.0, spacing / fw); }
float lh_band(float x, float c, float w) { float fw = max(fwidth(x), 1e-5); float d = abs(x - c) - w * 0.5; return clamp(0.5 - d / fw, 0.0, 1.0) * clamp(w / fw, 0.0, 1.0); }
vec3 lh_overlay(vec3 col, vec2 w) {
  if (uNavBit > 0) {
    vec2 c = floor((w + uNavOff) / uCell);
    if (c.x >= 0.0 && c.y >= 0.0 && c.x < uNN && c.y < uNN) {
      int v = int(texelFetch(uNav, ivec2(c), 0).r * 255.0 + 0.5);
      if ((v & uNavBit) == 0) { float st = step(0.5, fract((w.x + w.y) / 8.0)); col = mix(col, vec3(0.86, 0.20, 0.16), 0.40 + 0.18 * st); }
    }
  }
  if (uGridOn > 0.5 && w.x >= -0.01 && w.y >= -0.01 && w.x <= uS + 0.01 && w.y <= uS + 0.01) {
    float g10 = max(lh_line(w.x, 10.0, 1.0), lh_line(w.y, 10.0, 1.0)) * min(lh_dens(w.x, 10.0), lh_dens(w.y, 10.0));
    float g100 = max(lh_line(w.x, 100.0, 1.7), lh_line(w.y, 100.0, 1.7));
    col = mix(col, vec3(0.93, 0.95, 0.96), g10 * 0.30);
    col = mix(col, vec3(1.0, 0.84, 0.42), g100 * 0.8);
  }
  return col;
}`;
function hookUniforms(shader, extra = {}) {
  for (const k of ['uNav', 'uCell', 'uNN', 'uNavOff', 'uGridOn', 'uNavBit', 'uS']) shader.uniforms[k] = U[k];
  Object.assign(shader.uniforms, extra);
}

function terrainMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    hookUniforms(sh, { uSurf: U.uSurf, uN: U.uN, uPal: U.uPal, uHeightOn: U.uHeightOn, uHR: U.uHR });
    sh.vertexShader = 'varying vec3 vW; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'varying vec3 vW; varying vec3 vWN;\nuniform sampler2D uSurf; uniform float uN; uniform vec3 uPal[16]; uniform float uHeightOn; uniform vec2 uHR;\n' + GLSL_COMMON + /* glsl */`
      int lh_id(float r) { return int(r * 255.0 + 0.5); }
      vec3 lh_pal(int k) { return uPal[k > 15 ? 15 : k]; }
      float lh_isveg(int k) { return (k == 0 || k == 1 || k == 9 || k == 11) ? 1.0 : 0.0; }
      vec3 lh_ramp(float t) {
        vec3 a = vec3(0.13, 0.33, 0.27), b = vec3(0.30, 0.52, 0.30), c = vec3(0.72, 0.70, 0.42), d = vec3(0.78, 0.53, 0.32), e = vec3(0.56, 0.36, 0.28), f = vec3(0.93, 0.91, 0.88);
        if (t < 0.2) return mix(a, b, t / 0.2); if (t < 0.45) return mix(b, c, (t - 0.2) / 0.25); if (t < 0.7) return mix(c, d, (t - 0.45) / 0.25);
        if (t < 0.88) return mix(d, e, (t - 0.7) / 0.18); return mix(e, f, (t - 0.88) / 0.12); }
      vec3 lh_terrain(vec2 w, float h, vec3 nrm) {
        float nj = lh_noise(w * 0.09);
        vec2 jit = (vec2(nj, fract(nj * 7.13 + 0.37)) - 0.5) * 1.3;
        vec2 p = w / uCell + jit;
        vec2 i0 = clamp(floor(p), vec2(0.0), vec2(uN - 2.0)); vec2 f = clamp(p - i0, 0.0, 1.0);
        ivec2 a = ivec2(i0);
        int k00 = lh_id(texelFetch(uSurf, a, 0).r), k10 = lh_id(texelFetch(uSurf, a + ivec2(1, 0), 0).r);
        int k01 = lh_id(texelFetch(uSurf, a + ivec2(0, 1), 0).r), k11 = lh_id(texelFetch(uSurf, a + ivec2(1, 1), 0).r);
        vec3 c = mix(mix(lh_pal(k00), lh_pal(k10), f.x), mix(lh_pal(k01), lh_pal(k11), f.x), f.y);
        float veg = mix(mix(lh_isveg(k00), lh_isveg(k10), f.x), mix(lh_isveg(k01), lh_isveg(k11), f.x), f.y);
        float farm = mix(mix(float(k00 == 9), float(k10 == 9), f.x), mix(float(k01 == 9), float(k11 == 9), f.x), f.y);
        float n1 = lh_fbm(w * 0.013), n2 = lh_noise(w * 0.35), n3 = lh_noise(w * 1.9), n0 = lh_noise(w * 0.0045 + 5.0);
        c *= 0.84 + 0.26 * n1 + 0.10 * (n2 - 0.5) + 0.06 * (n3 - 0.5);
        c = mix(c, uPal[14], veg * smoothstep(0.52, 0.80, n0 * 0.7 + n1 * 0.45) * 0.5);
        c *= 1.0 - farm * 0.16 * smoothstep(0.35, 0.65, abs(fract(w.x / 3.2) - 0.5) * 2.0);
        float sl = 1.0 - clamp(nrm.y, 0.0, 1.0);
        c = mix(c, uPal[4] * (0.78 + 0.32 * n2), smoothstep(0.17, 0.40, sl) * 0.8 * step(0.4, h));
        c *= 1.0 - 0.10 * smoothstep(0.05, 0.3, sl);
        c *= 1.0 - 0.32 * (1.0 - smoothstep(-0.2, 1.3, h)) * step(-0.6, h);
        c *= mix(1.0, 0.45, smoothstep(0.0, 18.0, -h));
        return c;
      }
    ` + sh.fragmentShader
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( lh_terrain(vec2(vW.x, -vW.z), vW.y, normalize(vWN)), opacity );')
      .replace('#include <dithering_fragment>', /* glsl */`#include <dithering_fragment>
        {
          vec2 w = vec2(vW.x, -vW.z); vec3 col = gl_FragColor.rgb;
          if (uHeightOn > 0.5) {
            float t = clamp((vW.y - uHR.x) / max(uHR.y - uHR.x, 1.0), 0.0, 1.0);
            col = mix(col, lh_ramp(t), 0.74);
            float c5 = lh_line(vW.y, 5.0, 1.0) * lh_dens(vW.y, 5.0);
            float c25 = lh_line(vW.y, 25.0, 1.6) * lh_dens(vW.y, 25.0);
            col = mix(col, vec3(0.05, 0.06, 0.07), max(c5 * 0.45, c25 * 0.85));
          }
          gl_FragColor.rgb = lh_overlay(col, w);
        }`);
  };
  m.customProgramCacheKey = () => 'lab-terrain-v1';
  return m;
}

// Road and lane surface: paint from (across metres, along metres).
function roadMaterial(clearW, style) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const uClear = { value: clearW }, uStyle = { value: style };
  m.onBeforeCompile = (sh) => {
    hookUniforms(sh, { uClear, uStyle });
    sh.vertexShader = 'attribute vec2 rc; varying vec2 vRC; varying vec3 vW;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vRC = rc; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec2 vRC; varying vec3 vW; uniform float uClear; uniform float uStyle;\n' + GLSL_COMMON + /* glsl */`
      vec3 lh_road(vec2 rc, vec2 w) {
        float a = rc.x; float L = rc.y; float ha = abs(a); float hc = uClear * 0.5;
        float n1 = lh_noise(w * 0.7), n2 = lh_fbm(w * 0.045);
        if (uStyle > 0.5) { // concrete service lane / aisle
          vec3 c = vec3(0.30, 0.30, 0.285) * (0.86 + 0.22 * n2 + 0.06 * (n1 - 0.5));
          float j = max(lh_band(fract(L / 6.0) * 6.0, 3.0, 0.06), lh_band(a, 0.0, 0.05));
          c *= 1.0 - 0.35 * j;
          float y = lh_band(ha, hc - 0.45, 0.25) * step(0.5, fract(L / 2.0));
          return mix(c, vec3(0.62, 0.42, 0.04), y);
        }
        vec3 asph = vec3(0.080, 0.082, 0.086) * (0.82 + 0.30 * n2 + 0.12 * (n1 - 0.5));
        vec3 shoulder = vec3(0.19, 0.18, 0.165) * (0.85 + 0.25 * n1);
        vec3 c = mix(asph, shoulder, smoothstep(hc + 0.2, hc + 0.45, ha));
        float edge = lh_band(ha, hc - 0.6, 0.2);
        float dash = step(fract(L / 12.0), 0.25);
        float centre = lh_band(a, 0.0, 0.18) * dash;
        float lanes = hc > 10.0 ? lh_band(ha, hc * 0.5, 0.15) * step(fract(L / 9.0 + 0.5), 0.33) : 0.0;
        float paint = max(edge, max(centre, lanes));
        return mix(c, vec3(0.60, 0.60, 0.56), paint * 0.9);
      }
    ` + sh.fragmentShader
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( lh_road(vRC, vec2(vW.x, -vW.z)), opacity );')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.rgb = lh_overlay(gl_FragColor.rgb, vec2(vW.x, -vW.z));');
  };
  m.customProgramCacheKey = () => 'lab-road-v1';
  return m;
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: 'varying vec3 vW; uniform sampler2D uH; uniform float uN; uniform float uDepthOn; uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunDir;\n#include <common>\n#include <fog_pars_fragment>\n' + GLSL_COMMON + /* glsl */`
      vec3 lh_depthRamp(float d) {
        if (d < 1.0) return vec3(0.75, 0.91, 0.89); if (d < 3.0) return vec3(0.50, 0.80, 0.82); if (d < 6.0) return vec3(0.25, 0.56, 0.72);
        if (d < 10.0) return vec3(0.16, 0.39, 0.63); if (d < 20.0) return vec3(0.11, 0.26, 0.51); return vec3(0.07, 0.16, 0.35); }
      void main() {
        vec2 w = vec2(vW.x, -vW.z);
        float h = texture2D(uH, (w / uCell + 0.5) / uN).r;
        float depth = max(-h, 0.0); // no discard: land always sits above this plane, so early depth testing rejects it
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 16.0, depth));
        float alpha = mix(0.42, 0.93, smoothstep(0.0, 7.0, depth));
        vec2 q = w * 0.08 + vec2(uTime * 0.05, uTime * 0.03);
        vec3 N = normalize(vec3((lh_noise(q) - 0.5) * 0.10 + (lh_noise(q * 3.1 - uTime * 0.07) - 0.5) * 0.05, 1.0, (lh_noise(q + 9.1) - 0.5) * 0.10));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col = mix(col, uSky, fres * 0.55);
        float spec = pow(max(dot(reflect(-uSunDir, N), V), 0.0), 160.0);
        col += spec * vec3(1.0, 0.95, 0.85) * 0.45;
        float foam = (1.0 - smoothstep(0.0, 0.35, depth)) * (0.45 + 0.55 * lh_noise(w * 0.5 + uTime * 0.25));
        col = mix(col, vec3(0.78, 0.84, 0.84), foam * 0.32);
        alpha = max(alpha, foam * 0.45);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        vec3 o = gl_FragColor.rgb;
        if (uDepthOn > 0.5) {
          o = lh_depthRamp(depth);
          float c5 = lh_line(depth, 5.0, 1.0) * lh_dens(depth, 5.0);
          o = mix(o, vec3(0.05, 0.08, 0.12), c5 * 0.35);
          float l3 = 1.0 - smoothstep(1.2 * fwidth(depth), 2.6 * fwidth(depth), abs(depth - 3.0));
          o = mix(o, vec3(0.97, 0.73, 0.29), l3);
          gl_FragColor.a = 0.94;
        }
        gl_FragColor.rgb = lh_overlay(o, w);
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
}

function wallMaterial() { return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); }
const concreteMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.40, 0.40, 0.38) });
concreteMat.userData.shared = true;
const missingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
missingMat.defines = { USE_UV: '' };
missingMat.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */`
    vec2 e2 = min(vUv, 1.0 - vUv); vec2 fw = max(fwidth(vUv), vec2(1e-5)); vec2 ee = e2 / fw;
    float edge = 1.0 - smoothstep(0.8, 2.0, min(ee.x, ee.y));
    vec4 diffuseColor = vec4(mix(diffuse, vec3(1.0, 0.9, 0.75), edge * 0.35), mix(opacity, 0.9, edge));`);
};
missingMat.customProgramCacheKey = () => 'lab-missing-v1';
missingMat.userData.shared = true;

// ───────────────────────────── coordinate helpers ─────────────────────────────
const w2t = (x, y, z = 0, v = new THREE.Vector3()) => v.set(x, z, -y);
let M = null;            // current map state
let mapLoadToken = 0;
const LINE_MATS = new Set();

function hAt(x, y) {
  const { n, g, H } = M;
  const fx = clamp(x / g, 0, n - 1), fy = clamp(y / g, 0, n - 1);
  const i = Math.min(Math.floor(fx), n - 2), j = Math.min(Math.floor(fy), n - 2);
  const u = fx - i, v = fy - j, k = j * n + i;
  return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + n] * (1 - u) + H[k + n + 1] * u) * v;
}
function cellOf(x, y) { // nav/deck cell index (see navOff in loadMap)
  const i = clamp(Math.floor((x + M.navOff) / M.g), 0, M.nn - 1), j = clamp(Math.floor((y + M.navOff) / M.g), 0, M.nn - 1);
  return j * M.nn + i;
}
const cellX = (i) => i * M.g - M.navOff + M.g / 2;
function surfAt(x, y) { const i = clamp(Math.round(x / M.g), 0, M.n - 1), j = clamp(Math.round(y / M.g), 0, M.n - 1); return M.surf ? M.surf[j * M.n + i] : null; }
function surfZ(x, y) { // walkable surface: deck if any, else terrain, water surface at 0
  if (M.deck) { const c = cellOf(x, y); if (M.deck[c] && !Number.isNaN(M.deckZ[c])) return M.deckZ[c]; }
  return Math.max(hAt(x, y), 0);
}

// ───────────────────────────── data loading ─────────────────────────────
const A = { manifest: null, manifestErr: null, sizes: null, sizesErr: null, maps: null, protos: new Map(), failed: {}, loader: new GLTFLoader() };
async function getRes(url, type) {
  if (type === 'bin') return getGrid(url);
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'json' ? r.json() : r.arrayBuffer();
}
// Raw grids ship as lossless PNGs in data order (row 0 = south), because the host serves only web file types:
// height.grid.png = RGB 24-bit fixed point, z = (R·65536 + G·256 + B) / 10000 − 40; *.u8 grids = 8-bit grey (R channel).
async function getGrid(url) {
  const png = url.replace(/\.(f32|u8)$/, '.grid.png'); const r = await fetch(png, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} (${png.split('/').pop()})`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); const px = cx.getImageData(0, 0, bmp.width, bmp.height).data; const n = bmp.width * bmp.height;
  if (url.endsWith('.f32')) { const out = new Float32Array(n); for (let i = 0, k = 0; i < n; i++, k += 4) out[i] = (px[k] * 65536 + px[k + 1] * 256 + px[k + 2]) / 10000 - 40; return out.buffer; }
  const out = new Uint8Array(n); for (let i = 0, k = 0; i < n; i++, k += 4) out[i] = px[k]; return out.buffer;
}
async function rec(files, name, url, type) {
  try {
    const v = await getRes(url, type);
    files.push({ name, url, ok: true, bytes: type === 'json' ? null : v.byteLength });
    return v;
  } catch (e) { files.push({ name, url, ok: false, error: e.message }); return null; }
}

function loadingText(t, p) { $('#loading').classList.remove('hide'); $('#loadingText').textContent = t; if (p != null) $('#loadingBar').style.width = `${Math.round(p * 100)}%`; }
function loadingDone() { $('#loading').classList.add('hide'); }

async function boot() {
  loadingText('Loading map list…', 0.05);
  const [maps, manifest, sizes] = await Promise.all([
    getRes('data/maps.json', 'json').catch((e) => { A.mapsErr = e.message; return null; }),
    getRes('data/assets/manifest.json', 'json').catch((e) => { A.manifestErr = e.message; return null; }),
    getRes('data/assets/sizes.json', 'json').catch((e) => { A.sizesErr = e.message; return null; }),
  ]);
  if (!maps) { fatal(`<span class="mono">data/maps.json</span> could not be loaded (${esc(A.mapsErr)}). Serve this folder over HTTP.`); return; }
  A.maps = maps;
  A.manifest = new Set(Array.isArray(manifest) ? manifest : (manifest && manifest.assets) || []);
  A.sizes = sizes || {};
  buildStaticUI();
  layout();
  window.addEventListener('hashchange', onHash);
  onHash();
}

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const [id, preset] = h.split('/');
  return { id: A.maps.some((m) => m.id === id) ? id : A.maps[0].id, preset: PRESETS.some((p) => p.key === preset) ? preset : null };
}
function onHash() {
  const { id, preset } = parseHash();
  if (M && M.id === id) { if (preset) applyPreset(preset, false); return; }
  loadMap(id, preset);
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (!m.userData.shared) { LINE_MATS.delete(m); m.dispose(); } }
  });
  while (root.children.length) root.remove(root.children[0]);
}
function clearMap() {
  for (const k of ['terrain', 'water', 'roads', 'structs', 'inst', 'route', 'tests', 'sel', 'dots']) disposeTree(G[k]);
  for (const k in OVG) disposeTree(OVG[k]);
  for (const t of ['uSurf', 'uNav', 'uH']) { if (U[t].value) U[t].value.dispose(); U[t].value = null; }
  labels.clear(); missLabels.length = 0;
  TESTS.focus = null;
  routeState.result = null; routeState.start = null; routeState.end = null; routeState.anim = null;
  selection = null;
}

async function loadMap(id, preset) {
  const token = ++mapLoadToken;
  const info = A.maps.find((m) => m.id === id);
  setReadyState(null);
  loadingText(`Loading ${info.name}…`, 0.1);
  clearMap();
  $$('#mapTabs button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  $('#mapSelect').value = id;
  const files = [];
  const base = `data/${id}/`;
  const [meta, hb, sb, nb, db, inst] = await Promise.all([
    rec(files, 'map.json', base + 'map.json', 'json'), rec(files, 'height.f32', base + 'height.f32', 'bin'),
    rec(files, 'surface.u8', base + 'surface.u8', 'bin'), rec(files, 'nav.u8', base + 'nav.u8', 'bin'),
    rec(files, 'deck.u8', base + 'deck.u8', 'bin'), rec(files, 'instances.json', base + 'instances.json', 'json'),
  ]);
  if (token !== mapLoadToken) return;
  if (!meta || !hb) {
    loadingDone();
    fatal(`Map ${esc(id)} cannot be shown: ${!meta ? '<span class="mono">map.json</span>' : '<span class="mono">height.f32</span>'} is missing (${esc(files.filter((f) => !f.ok).map((f) => f.name + ': ' + f.error).join('; '))}).`);
    return;
  }
  const n = meta.grid_n, g = meta.grid_m;
  const H = new Float32Array(hb);
  const notes = [];
  if (H.length !== n * n) notes.push(`height.f32 has ${H.length} values, expected grid_n² = ${n * n}`);
  let nav = nb ? new Uint8Array(nb) : null, deck = db ? new Uint8Array(db) : null;
  const nn = nav ? Math.round(Math.sqrt(nav.length)) : n - 1;
  if (nav && nn * nn !== nav.length) { notes.push(`nav.u8 is not square (${nav.length} bytes): nav disabled`); nav = null; }
  if (deck && deck.length !== nn * nn) { notes.push(`deck.u8 has ${deck.length} bytes, nav grid is ${nn}²: deck ignored`); deck = null; }
  // nav.u8 / deck.u8 are (grid_n−1)² cells: each is the AND (deck: max) of 2×2 samples of the 2 m source grid at
  // x ∈ {4i, 4i+2} m, so cell i covers [4i−1, 4i+3) m → offset g/4. If a full-resolution grid_n² raster appears, cells sit on vertices.
  const navOff = nn === n - 1 ? g / 4 : g / 2;
  M = {
    id, info, meta, files, notes, n, g, H, S: meta.size_m, nn, navOff, nav, deck,
    surf: sb && new Uint8Array(sb).length === n * n ? new Uint8Array(sb) : null,
    inst: inst || {}, sets: [], presets: {}, ready: false,
  };
  if (sb && !M.surf) notes.push('surface.u8 size does not match grid_n²: surface colours unavailable');
  let hmin = Infinity, hmax = -Infinity;
  for (let k = 0; k < H.length; k++) { const v = H[k]; if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
  M.hmin = hmin; M.hmax = hmax;
  $('#mapMeta').innerHTML = `<b>${esc(meta.name)}</b> · ${fmt(meta.size_m)} × ${fmt(meta.size_m)} m · ${esc(meta.mode)} · seed ${esc(meta.seed)} · ${n}² samples @ ${g} m`;
  document.title = `${meta.name} · Thunderhead Map Lab`;

  loadingText('Building terrain…', 0.25);
  await tick();
  setupBiome();
  buildRasters();
  buildTextures();
  buildTerrain();
  buildWalls();
  buildWater();
  loadingText('Roads, bridges, docks…', 0.4);
  await tick();
  buildRoads();
  buildStructures();
  buildOverlays();
  if (token !== mapLoadToken) return;

  // assets
  const needed = Object.keys(M.inst);
  const glbs = new Set();
  for (const a of needed) { if (A.manifest.has(a)) glbs.add(a); if (A.manifest.has(a + '_lod1')) glbs.add(a + '_lod1'); }
  for (const c of CLASSES) if (A.manifest.has(CLASS_MODEL[c])) glbs.add(CLASS_MODEL[c]);
  let done = 0;
  loadingText(`Loading ${glbs.size} asset GLBs…`, 0.5);
  await Promise.all([...glbs].map((nm) => loadProto(nm).then(() => { done++; loadingText(`Loading asset GLBs ${done}/${glbs.size}…`, 0.5 + 0.35 * done / Math.max(glbs.size, 1)); })));
  if (token !== mapLoadToken) return;
  loadingText('Placing instances…', 0.9);
  await tick();
  await buildInstances();
  buildDots();
  computePresets();
  applyPaceSpeeds(); PM.map = null; PM.res = null;
  renderChecks(); renderAssets(); renderInspect(); renderRouteOut(); renderTests(); renderClassInfo(); renderPace();
  applyOverlayState();
  applyQuality(false);
  M.ready = true;
  buildMinimap();
  M.instDirty = true;
  loadingDone();
  applyPreset(preset || 'overview', true);
  if (!location.hash.startsWith('#' + id)) history.replaceState(null, '', '#' + id);
  await settle(2);
  setReadyState(id);
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ───────────────────────────── per-map rasters ─────────────────────────────
function setupBiome() {
  const P = PAL[M.id] || PAL['01'], W = WATER[M.id] || WATER['01'];
  const mix = (a, b, t) => a.map((x, i) => x * (1 - t) + b[i] * t);
  const pal = [];
  pal[0] = P.grass; pal[1] = P.grass2; pal[2] = mix(P.soil, P.dry, 0.35); pal[3] = P.sand; pal[4] = P.rock;
  pal[5] = [0.40, 0.40, 0.38]; pal[6] = [0.25, 0.24, 0.22]; pal[7] = [0.05, 0.05, 0.055]; pal[8] = [0.14, 0.11, 0.07];
  pal[9] = mix(P.grass2, P.dry, 0.45); pal[10] = P.soil; pal[11] = mix(P.grass, P.soil, 0.45).map((x) => x * 0.72);
  pal[12] = P.sand.map((x) => x * 0.58); pal[13] = M.id === '05' ? [0.50, 0.30, 0.18] : mix(P.rock, P.soil, 0.5);
  pal[14] = P.dry; pal[15] = mix(P.sand, P.soil, 0.35);
  pal.forEach((c, i) => U.uPal.value[i].set(c[0], c[1], c[2]));
  U.uShallow.value.setRGB(...W.shallow); U.uDeep.value.setRGB(...W.deep);
  const [el, az] = P.sun.map((d) => THREE.MathUtils.degToRad(d));
  M.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  U.uSunDir.value.copy(M.sunDir);
  U.uCell.value = M.g; U.uN.value = M.n; U.uNN.value = M.nn; U.uNavOff.value = M.navOff; U.uS.value = M.S;
  U.uHR.value.set(Math.floor(Math.min(M.hmin, 0) / 5) * 5, Math.ceil(M.hmax / 5) * 5);
}

function stampDisc(arr, x, y, r, fn) {
  const { g, nn, navOff } = M;
  const i0 = clamp(Math.floor((x - r + navOff) / g), 0, nn - 1), i1 = clamp(Math.floor((x + r + navOff) / g), 0, nn - 1);
  const j0 = clamp(Math.floor((y - r + navOff) / g), 0, nn - 1), j1 = clamp(Math.floor((y + r + navOff) / g), 0, nn - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cx = cellX(i), cy = cellX(j);
    if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) fn(j * nn + i);
  }
}
function stampRect(arr, c, size, rot, fn) {
  const r = Math.hypot(size[0], size[1]) / 2, cs = Math.cos(rot), sn = Math.sin(rot);
  stampDisc(arr, c[0], c[1], r, (k) => {
    const i = k % M.nn, j = (k / M.nn) | 0, dx = cellX(i) - c[0], dy = cellX(j) - c[1];
    const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    if (Math.abs(lx) <= size[0] / 2 && Math.abs(ly) <= size[1] / 2) fn(k);
  });
}
function densify(pts, zs, step) { // polyline (+ optional z) resampled every ≤ step metres
  const P = [], Z = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L / step));
    for (let t = 0; t < m; t++) { const u = t / m; P.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); if (zs) Z.push(zs[k] + (zs[k + 1] - zs[k]) * u); }
  }
  P.push(pts[pts.length - 1]); if (zs) Z.push(zs[zs.length - 1]);
  return { P, Z };
}

function buildRasters() {
  const { nn, meta } = M;
  // road-speed cells: rasterised road clear corridors, deck cells and asphalt-class samples
  M.roadMask = new Uint8Array(nn * nn);
  M.deckZ = new Float32Array(nn * nn).fill(NaN);
  for (const r of meta.roads || []) {
    const { P, Z } = densify(r.xy, r.z, 3);
    const onBeach = r.on_beach || [];
    // map densified points back to source flags approximately by nearest source index
    let src = 0;
    for (let k = 0; k < P.length; k++) {
      while (src < r.xy.length - 1 && Math.hypot(r.xy[src + 1][0] - P[k][0], r.xy[src + 1][1] - P[k][1]) < Math.hypot(r.xy[src][0] - P[k][0], r.xy[src][1] - P[k][1])) src++;
      if (onBeach[src]) continue;
      stampDisc(M.roadMask, P[k][0], P[k][1], r.clear_w / 2, (c) => { M.roadMask[c] = 1; });
      if ((r.bridge || [])[src]) stampDisc(M.deckZ, P[k][0], P[k][1], r.clear_w / 2 + 3, (c) => { M.deckZ[c] = Number.isNaN(M.deckZ[c]) ? Z[k] : Math.max(M.deckZ[c], Z[k]); });
    }
  }
  for (const d of meta.docks || []) stampRect(M.deckZ, d.water_center, [80, 40], d.rot, (c) => { M.deckZ[c] = d.deck_z ?? 3; });
  for (const ln of meta.lanes || []) {
    if (ln.kind !== 'trestle') continue;
    const zs = Array.isArray(ln.z) ? ln.z : ln.pts.map(() => ln.z);
    const { P, Z } = densify(ln.pts, zs, 2);
    P.forEach((p, k) => stampDisc(M.deckZ, p[0], p[1], ln.w / 2 + 1, (c) => { M.deckZ[c] = Number.isNaN(M.deckZ[c]) ? Z[k] : Math.max(M.deckZ[c], Z[k]); }));
  }
  if (M.deck) for (let c = 0; c < nn * nn; c++) if (M.deck[c]) M.roadMask[c] = 1;
  if (M.surf) for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) if (surfAt(cellX(i), cellX(j)) === 7) M.roadMask[j * nn + i] = 1;
}

function buildTextures() {
  const { n, nn, H } = M;
  const half = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) half[k] = THREE.DataUtils.toHalfFloat(H[k]);
  const th = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  th.minFilter = th.magFilter = THREE.LinearFilter; th.needsUpdate = true; U.uH.value = th;
  const ts = new THREE.DataTexture(M.surf || new Uint8Array(n * n), n, n, THREE.RedFormat, THREE.UnsignedByteType);
  ts.needsUpdate = true; U.uSurf.value = ts;
  const tn = new THREE.DataTexture(M.nav || new Uint8Array(nn * nn).fill(255), nn, nn, THREE.RedFormat, THREE.UnsignedByteType);
  tn.needsUpdate = true; U.uNav.value = tn;
}

// ───────────────────────────── terrain, walls, water ─────────────────────────────
function buildTerrain() {
  const { n, g, H } = M, CH = 32;
  const NRM = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const il = Math.max(i - 1, 0), ir = Math.min(i + 1, n - 1), jd = Math.max(j - 1, 0), ju = Math.min(j + 1, n - 1);
    const dx = (H[j * n + ir] - H[j * n + il]) / ((ir - il) * g), dy = (H[ju * n + i] - H[jd * n + i]) / ((ju - jd) * g);
    const l = Math.hypot(dx, 1, dy), o = (j * n + i) * 3;
    NRM[o] = -dx / l; NRM[o + 1] = 1 / l; NRM[o + 2] = dy / l;
  }
  const mat = terrainMaterial();
  const nc = Math.ceil((n - 1) / CH);
  const ld = QUALITY[S.quality].terrLod;
  M.terrainLods = [];
  for (let cj = 0; cj < nc; cj++) for (let ci = 0; ci < nc; ci++) {
    const i0 = ci * CH, i1 = Math.min(i0 + CH, n - 1), j0 = cj * CH, j1 = Math.min(j0 + CH, n - 1);
    const cx = (i0 + i1) / 2 * g, cy = (j0 + j1) / 2 * g;
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, -cy);
    [1, 2, 4].forEach((s, li) => {
      const mesh = new THREE.Mesh(chunkGeo(i0, i1, j0, j1, s, cx, cy, NRM), mat);
      mesh.receiveShadow = true; mesh.userData.terrain = true;
      lod.addLevel(mesh, li === 0 ? 0 : ld[li - 1]);
    });
    lod.updateMatrix(); lod.matrixAutoUpdate = false;
    M.terrainLods.push(lod);
    G.terrain.add(lod);
  }
  M.nChunks = nc * nc;
}
function chunkGeo(i0, i1, j0, j1, s, cx, cy, NRM) {
  const { n, g, H } = M;
  const is = []; for (let i = i0; i < i1; i += s) is.push(i); is.push(i1);
  const js = []; for (let j = j0; j < j1; j += s) js.push(j); js.push(j1);
  const nx = is.length, ny = js.length, per = [];
  for (let a = 0; a < nx; a++) per.push([a, 0]);
  for (let b = 1; b < ny; b++) per.push([nx - 1, b]);
  for (let a = nx - 2; a >= 0; a--) per.push([a, ny - 1]);
  for (let b = ny - 2; b > 0; b--) per.push([0, b]);
  const nv = nx * ny + per.length;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const k = js[b] * n + is[a], o = (b * nx + a) * 3;
    pos[o] = is[a] * g - cx; pos[o + 1] = H[k]; pos[o + 2] = -(js[b] * g - cy);
    nrm[o] = NRM[k * 3]; nrm[o + 1] = NRM[k * 3 + 1]; nrm[o + 2] = NRM[k * 3 + 2];
  }
  const D = 2 + 6 * s;
  per.forEach(([a, b], q) => {
    const src = (b * nx + a) * 3, o = (nx * ny + q) * 3;
    pos[o] = pos[src]; pos[o + 1] = pos[src + 1] - D; pos[o + 2] = pos[src + 2];
    nrm[o] = nrm[src]; nrm[o + 1] = nrm[src + 1]; nrm[o + 2] = nrm[src + 2];
  });
  const idx = [];
  for (let b = 0; b < ny - 1; b++) for (let a = 0; a < nx - 1; a++) {
    const v00 = b * nx + a, v10 = v00 + 1, v01 = v00 + nx, v11 = v01 + 1;
    idx.push(v00, v10, v11, v00, v11, v01);
  }
  for (let q = 0; q < per.length; q++) {
    const p0 = per[q][1] * nx + per[q][0], p1 = per[(q + 1) % per.length][1] * nx + per[(q + 1) % per.length][0];
    const s0 = nx * ny + q, s1 = nx * ny + (q + 1) % per.length;
    idx.push(p0, p1, s1, p0, s1, s0, p0, s1, p1, p0, s0, s1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
function buildWalls() { // nonplayable cut faces at the map boundary (makes the playable bounds explicit)
  const { n, g, H } = M, BOT = Math.min(M.hmin, 0) - 22;
  const P = PAL[M.id], W = WATER[M.id];
  const earthTop = new THREE.Color(...P.soil).multiplyScalar(0.55), earthBot = new THREE.Color(0.03, 0.028, 0.026), water = new THREE.Color(...W.deep).multiplyScalar(1.4);
  const pos = [], col = [], idx = [];
  const edges = [
    (t) => [t, 0], (t) => [n - 1, t], (t) => [n - 1 - t, n - 1], (t) => [0, n - 1 - t],
  ];
  for (const e of edges) {
    const base = pos.length / 3;
    for (let t = 0; t < n; t++) {
      const [i, j] = e(t), h = H[j * n + i], x = i * g, y = j * g;
      const top = Math.max(h, 0);
      for (const [z, c] of [[top, h < 0 ? water : earthTop], [h, h < 0 ? water : earthTop], [h, earthTop], [BOT, earthBot]]) { pos.push(x, z, -y); col.push(c.r, c.g, c.b); }
    }
    for (let t = 0; t < n - 1; t++) {
      const a = base + t * 4, b = a + 4;
      idx.push(a, b, b + 1, a, b + 1, a + 1, a + 2, b + 2, b + 3, a + 2, b + 3, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  G.terrain.add(new THREE.Mesh(geo, wallMaterial()));
}
function buildWater() {
  if (M.hmin >= 0) return;
  const geo = new THREE.PlaneGeometry(M.S, M.S, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(M.S / 2, 0, -M.S / 2);
  const mat = waterMaterial();
  for (const k of ['uH', 'uN', 'uDepthOn', 'uTime', 'uShallow', 'uDeep', 'uSky', 'uSunDir', 'uNav', 'uCell', 'uNN', 'uNavOff', 'uGridOn', 'uNavBit', 'uS']) mat.uniforms[k] = U[k];
  const w = new THREE.Mesh(geo, mat); w.renderOrder = 2;
  G.water.add(w);
}

// ───────────────────────────── roads, lanes, structures ─────────────────────────────
function ribbonGeo(pts, zs, halfW) {
  const n = pts.length; if (n < 2) return null;
  const pos = new Float32Array(n * 6), rc = new Float32Array(n * 4), nrm = new Float32Array(n * 6), idx = [];
  let L = 0;
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, p = pts[k], z = zs[k];
    pos.set([p[0] + nx * halfW, z, -(p[1] + ny * halfW), p[0] - nx * halfW, z, -(p[1] - ny * halfW)], k * 6);
    nrm.set([0, 1, 0, 0, 1, 0], k * 6);
    rc.set([halfW, L, -halfW, L], k * 4);
    if (k < n - 1) { L += Math.hypot(pts[k + 1][0] - p[0], pts[k + 1][1] - p[1]); const v = k * 2; idx.push(v, v + 1, v + 3, v, v + 3, v + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('rc', new THREE.BufferAttribute(rc, 2));
  geo.setIndex(idx); geo.computeBoundingSphere();
  return geo;
}
function runsOf(flags, n) { // contiguous runs where !flags[k]
  const out = []; let cur = null;
  for (let k = 0; k < n; k++) { if (!flags[k]) { if (!cur) cur = []; cur.push(k); } else if (cur) { out.push(cur); cur = null; } }
  if (cur) out.push(cur);
  return out;
}
function buildRoads() {
  const mats = {};
  const roadMat = (w) => (mats['r' + w] ||= roadMaterial(w, 0));
  const laneMat = (w) => (mats['l' + w] ||= roadMaterial(w, 1));
  (M.meta.roads || []).forEach((r) => {
    for (const run of runsOf(r.on_beach || [], r.xy.length)) {
      if (run.length < 2) continue;
      const pts = run.map((k) => r.xy[k]), zs = run.map((k) => r.z[k] + (r.kind === 'main' ? 0.03 : 0.06));
      const geo = ribbonGeo(pts, zs, r.clear_w / 2 + 2);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, roadMat(r.clear_w)); mesh.receiveShadow = true; mesh.userData.road = r.id;
      G.roads.add(mesh);
    }
  });
  for (const ln of M.meta.lanes || []) {
    if (ln.kind === 'trestle') continue;
    const zs0 = Array.isArray(ln.z) ? ln.z : ln.pts.map(() => ln.z);
    const { P, Z } = densify(ln.pts, zs0, 2);
    const zz = P.map((p, k) => Math.max(Z[k] ?? 0, hAt(p[0], p[1])) + 0.05);
    const geo = ribbonGeo(P, zz, ln.w / 2);
    if (geo) { const mesh = new THREE.Mesh(geo, laneMat(ln.w)); mesh.receiveShadow = true; G.roads.add(mesh); }
  }
}
function boxGeo(cx, cy, ang, lx, ly, z0, z1) {
  const geo = new THREE.BoxGeometry(lx, Math.max(z1 - z0, 0.01), ly);
  geo.rotateY(ang); geo.translate(cx, (z0 + z1) / 2, -cy);
  return geo;
}
function cylGeo(cx, cy, r, z0, z1) {
  const geo = new THREE.CylinderGeometry(r, r, Math.max(z1 - z0, 0.01), 10);
  geo.translate(cx, (z0 + z1) / 2, -cy);
  return geo;
}
function buildStructures() {
  const parts = [];
  M.structNotes = [];
  // bridges / causeways: road segments flagged as bridge (deck = graded z of the flagged points)
  for (const r of M.meta.roads || []) {
    const br = r.bridge || [];
    const runs = runsOf(br.map((b) => !b), r.xy.length);
    for (const run of runs) {
      if (run.length < 2) continue;
      const a = r.xy[run[0]], e = r.xy[run[run.length - 1]], L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      const ang = Math.atan2(e[1] - a[1], e[0] - a[0]), c = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      const nrm = [-Math.sin(ang), Math.cos(ang)], deck = run.reduce((s, k) => s + r.z[k], 0) / run.length, W = r.clear_w + 3;
      parts.push(boxGeo(c[0], c[1], ang, L + 16, W, deck - 2.0, deck - 0.05));
      for (const sgn of [-1, 1]) parts.push(boxGeo(c[0] + nrm[0] * sgn * (W / 2 - 0.25), c[1] + nrm[1] * sgn * (W / 2 - 0.25), ang, L + 16, 0.5, deck, deck + 1.1));
      const low = deck - 2.0 < 12.0;
      const ts = low ? Array.from({ length: Math.floor(L / 30) + 1 }, (_, k) => Math.min(k * 30 / L, 1)) : [0, 0.17, 0.33, 0.67, 0.83, 1];
      for (const t of ts) {
        const p = [a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t];
        const bed = Math.min(hAt(p[0], p[1]), 0) - 1;
        for (const sgn of [-1, 1]) parts.push(boxGeo(p[0] + nrm[0] * sgn * W * 0.3, p[1] + nrm[1] * sgn * W * 0.3, ang, 2.5, 2.5, bed, deck - 2.0));
        parts.push(boxGeo(p[0], p[1], ang, 3.0, W, deck - 3.2, deck - 2.0));
      }
      M.structNotes.push(`${r.id}: ${low ? 'causeway' : 'bridge'} deck ${deck.toFixed(1)} m, span ${L.toFixed(0)} m, ${ts.length} pier rows`);
    }
  }
  // docks: 80 × 40 m deck, top at deck_z (3 m), on piles — a procedural stand-in only when bld_naval_dock.glb is not available
  M.dockProcedural = !A.manifest.has('bld_naval_dock');
  for (const d of M.meta.docks || []) {
    if (!M.dockProcedural) break;
    const top = d.deck_z ?? 3, cs = Math.cos(d.rot), sn = Math.sin(d.rot);
    parts.push(boxGeo(d.water_center[0], d.water_center[1], d.rot, 80, 40, top - 1.2, top));
    for (let u = -36; u <= 36; u += 12) for (const v of [-16, 0, 16]) {
      const x = d.water_center[0] + u * cs - v * sn, y = d.water_center[1] + u * sn + v * cs;
      parts.push(cylGeo(x, y, 0.55, Math.min(hAt(x, y), -1) - 1, top - 1.2));
    }
  }
  // trestles: deck from shore to dock, slab + piles every 8 m (as the Blender assembler)
  const laneMat = roadMaterial(16, 1);
  for (const ln of M.meta.lanes || []) {
    if (ln.kind !== 'trestle') continue;
    const zs = Array.isArray(ln.z) ? ln.z : ln.pts.map(() => ln.z);
    const { P, Z } = densify(ln.pts, zs, 2);
    const geo = ribbonGeo(P, Z.map((z) => z + 0.02), ln.w / 2);
    if (geo) G.structs.add(new THREE.Mesh(geo, laneMat));
    const a = ln.pts[0], e = ln.pts[ln.pts.length - 1], L = Math.hypot(e[0] - a[0], e[1] - a[1]), ang = Math.atan2(e[1] - a[1], e[0] - a[0]);
    const zmin = Math.min(...zs);
    parts.push(boxGeo((a[0] + e[0]) / 2, (a[1] + e[1]) / 2, ang, L, ln.w, zmin - 1.2, zmin - 0.02));
    for (let t = 4; t < L - 2; t += 8) for (const sgn of [-1, 1]) {
      const s = sgn * (ln.w / 2 - 1.2), x = a[0] + (e[0] - a[0]) * t / L - Math.sin(ang) * s, y = a[1] + (e[1] - a[1]) * t / L + Math.cos(ang) * s;
      parts.push(cylGeo(x, y, 0.45, Math.min(hAt(x, y), 0) - 1, zmin - 1.2));
    }
  }
  if (parts.length) {
    const merged = BGU.mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p), false);
    parts.forEach((p) => p.dispose());
    if (merged) { const mesh = new THREE.Mesh(merged, concreteMat); mesh.castShadow = true; mesh.receiveShadow = true; G.structs.add(mesh); }
  }
}

// ───────────────────────────── overlays ─────────────────────────────
function lineMat(color, width, opts = {}) {
  const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity: opts.opacity ?? 1, depthTest: opts.depthTest ?? true, depthWrite: false, dashed: !!opts.dashed, dashSize: opts.dash ?? 8, gapSize: opts.gap ?? 6, worldUnits: false });
  m.resolution.set(innerWidth, innerHeight);
  LINE_MATS.add(m);
  return m;
}
function line2(flat, color, width, opts = {}) {
  const geo = new LineGeometry(); geo.setPositions(flat);
  const l = new Line2(geo, lineMat(color, width, opts));
  if (opts.dashed) l.computeLineDistances();
  l.renderOrder = opts.order ?? 30; l.frustumCulled = false;
  return l;
}
function drape(pts, dz, closed = false, step = 4) {
  const P = closed ? [...pts, pts[0]] : pts;
  const { P: D } = densify(P, null, step);
  const out = [];
  for (const p of D) out.push(p[0], surfZ(p[0], p[1]) + dz, -p[1]);
  return out;
}
function rectPts(c, size, rot = 0) {
  const cs = Math.cos(rot), sn = Math.sin(rot), hx = size[0] / 2, hy = size[1] / 2;
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([u, v]) => [c[0] + u * cs - v * sn, c[1] + u * sn + v * cs]);
}
function circlePts(c, r, seg = 96) { return Array.from({ length: seg }, (_, k) => [c[0] + r * Math.cos(k / seg * Math.PI * 2), c[1] + r * Math.sin(k / seg * Math.PI * 2)]); }
function fillMat(color, opacity) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, fog: false });
}
function drapedRibbon(pts, offs, zFn, mat) { // cross-section offsets (metres, left positive), draped on the surface
  const n = pts.length, m = offs.length; if (n < 2) return null;
  const pos = new Float32Array(n * m * 3), idx = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    for (let q = 0; q < m; q++) {
      const x = pts[k][0] - ty * offs[q], y = pts[k][1] + tx * offs[q];
      pos.set([x, zFn(k, x, y), -y], (k * m + q) * 3);
    }
    if (k < n - 1) for (let q = 0; q < m - 1; q++) { const v = k * m + q; idx.push(v, v + 1, v + m + 1, v, v + m + 1, v + m); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 25; return mesh;
}

function buildOverlays() {
  const meta = M.meta;
  const teamCol = (t) => (t === 'R' ? TEAM_HEX[2] : TEAM_HEX[1]);
  // base reservations
  {
    const og = OVG.reserve;
    for (const p of meta.pads || []) {
      const z = p.h + 0.35;
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]).rotateX(-Math.PI / 2).translate(p.center[0], z, -p.center[1]), fillMat(teamCol(p.team), 0.10));
      fill.renderOrder = 24; og.add(fill);
      og.add(line2(rectPts(p.center, p.size).concat([rectPts(p.center, p.size)[0]]).flatMap(([x, y]) => [x, z + 0.1, -y]), teamCol(p.team), 2.2));
      og.add(line2(drape(rectPts(p.center, [p.size[0] + 60, p.size[1] + 60]), 0.6, true), '#d6a24c', 1.4, { dashed: true, dash: 10, gap: 6 }));
      labels.add('reserve', p.center[0] - p.size[0] / 2 - 30, p.center[1] + p.size[1] / 2 + 30, p.h + 2, `${esc(p.id)} pad 220 × 220 m<small>dashed: 30 m grading band</small>`, p.team);
    }
    for (const ln of meta.lanes || []) {
      if (ln.kind !== 'aisle') continue;
      const { P } = densify(ln.pts, null, 3);
      const rb = drapedRibbon(P, [-ln.w / 2, 0, ln.w / 2], (k, x, y) => Math.max(ln.z ?? 0, hAt(x, y)) + 0.45, fillMat('#d6a24c', 0.30));
      if (rb) og.add(rb);
      const m = P[Math.floor(P.length / 2)];
      labels.add('reserve', m[0], m[1], (ln.z ?? 0) + 1, `service aisle ${ln.w} m<small>26 m from the pad centre, refinery side</small>`, 'res');
    }
    for (const d of meta.deposits || []) {
      og.add(line2(drape(rectPts(d.pos, [50, 50]), 0.7, true, 3), '#d6a24c', 1.6));
      og.add(line2(drape(circlePts(d.service_point, 3, 24), 0.8, true, 1), '#f1d39a', 2));
    }
    for (const l of meta.landmarks || []) {
      og.add(line2(drape(rectPts(l.center, l.size), 0.8, true, 3), '#8db3cf', 1.6, { dashed: true, dash: 6, gap: 4 }));
      labels.add('reserve', l.center[0], l.center[1] + l.size[1] / 2, (l.h ?? hAt(...l.center)) + 2, `${esc(l.id)}<small>${esc(l.role)} · ${l.size[0]} × ${l.size[1]} m</small>`, 'res');
    }
  }
  // collision shapes: one wire box per blocking footprint (map.json collision = Blender COLLISION_static)
  {
    const og = OVG.collision, B = meta.collision || [];
    if (B.length) {
      const pos = new Float32Array(B.length * 24 * 3), E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      B.forEach(([x, y, z, x0, y0, z0, x1, y1, z1, r], k) => {
        const cs = Math.cos(r), sn = Math.sin(r), C = [];
        for (const zz of [z0, z1]) for (const [u, v] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) C.push([x + u * cs - v * sn, z + zz + 0.05, -(y + u * sn + v * cs)]);
        E.forEach(([a, e], t) => pos.set([...C[a], ...C[e]], (k * 24 + t * 2) * 3));
      });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe76f51, transparent: true, opacity: 0.95, fog: false }));
      ls.renderOrder = 29; ls.frustumCulled = false; og.add(ls);
    }
    labels.add('collision', M.S / 2, M.S - 30, 4, `${B.length} collision boxes<small>blocking footprints; dense forest interiors are in the navigation overlay</small>`, 'res');
  }
  // harvester test routes (refinery bay → home deposit), shown with the resource overlay
  for (const r of meta.routes || []) {
    OVG.resources.add(line2(drape(r.pts, 1.2, false, 4), '#f4c95d', 2.4, { dashed: true, dash: 9, gap: 5 }));
    const m = r.pts[Math.floor(r.pts.length / 2)];
    labels.add('resources', m[0], m[1], surfZ(m[0], m[1]) + 3, `${esc(r.id)}<small>harvester test route · ${esc(r.from)} → ${esc(r.to)} · ${Math.round(r.length_m)} m</small>`, 'res');
  }
  // road corridors: clear width + 6 m safety band, draped on max(road profile, surface)
  {
    const og = OVG.roads, clearM = fillMat('#7fa6c4', 0.26), bandM = fillMat('#d6a24c', 0.22);
    for (const r of meta.roads || []) {
      for (const run of runsOf(r.on_beach || [], r.xy.length)) {
        if (run.length < 2) continue;
        const pts = run.map((k) => r.xy[k]), zs = run.map((k) => r.z[k]), hw = r.clear_w / 2;
        const zf = (k, x, y) => Math.max(zs[k], surfZ(x, y)) + 0.5;
        const cross = []; for (let o = -hw; o <= hw + 1e-6; o += Math.min(4, hw)) cross.push(o);
        const a = drapedRibbon(pts, cross, zf, clearM); if (a) og.add(a);
        for (const sgn of [-1, 1]) { const b = drapedRibbon(pts, [sgn * hw, sgn * (hw + 3), sgn * (hw + 6)], zf, bandM); if (b) og.add(b); }
        for (const sgn of [-1, 1]) {
          const flat = []; pts.forEach((p, k) => {
            const pa = pts[Math.max(k - 1, 0)], pb = pts[Math.min(k + 1, pts.length - 1)]; let tx = pb[0] - pa[0], ty = pb[1] - pa[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
            const x = p[0] - ty * hw * sgn, y = p[1] + tx * hw * sgn; flat.push(x, zf(k, x, y) + 0.1, -y);
          });
          og.add(line2(flat, '#a9c6dc', 1.2, { opacity: 0.9 }));
        }
      }
      const mid = r.xy[Math.floor(r.xy.length / 2)];
      labels.add('roads', mid[0], mid[1], r.z[Math.floor(r.xy.length / 2)] + 2, `${esc(r.id)}<small>${r.clear_w} m clear + 6 m band</small>`, 'res');
    }
  }
  // player starts + capturable radar reveal circles
  {
    const og = OVG.starts;
    for (const p of meta.pads || []) {
      og.add(line2(drape(circlePts(p.center, 30, 48), 0.8, true), teamCol(p.team), 3));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 8).translate(p.center[0], p.h + 30, -p.center[1]), new THREE.MeshBasicMaterial({ color: new THREE.Color(teamCol(p.team)), fog: false }));
      pole.userData.strategicOnly = true; // a 60 m marker reads at overview scale but hides the base in close-ups
      og.add(pole);
      labels.add('starts', p.center[0], p.center[1], p.h + 62, `${esc(p.id)} start<small>${p.team === 'B' ? 'Blue' : 'Red'} · pad ${p.h} m</small>`, p.team);
    }
    for (const l of meta.landmarks || []) {
      if (l.role !== 'capturable') continue;
      og.add(line2(drape(circlePts(l.center, 220, 160), 1.0, true, 6), '#8db3cf', 2, { dashed: true, dash: 12, gap: 7 }));
      og.add(line2(drape(rectPts(l.center, l.size), 1.0, true, 2), '#8db3cf', 2));
      labels.add('starts', l.center[0], l.center[1], (l.h ?? hAt(...l.center)) + 18, `${esc(l.id)} · capture radar<small>220 m reveal (dashed)</small>`, 'radar');
    }
  }
  // resource IDs
  {
    const og = OVG.resources;
    const pinMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d6a24c'), fog: false });
    for (const d of meta.deposits || []) {
      const z = surfZ(...d.pos);
      og.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 20, 6).translate(d.pos[0], z + 10, -d.pos[1]), pinMat));
      const moved = Math.hypot(d.pos[0] - d.spec_pos[0], d.pos[1] - d.spec_pos[1]);
      labels.add('resources', d.pos[0], d.pos[1], z + 21, `${esc(d.id)}<small>${esc(d.kind)}${d.nearest ? ' · ' + esc(d.nearest) : ''}${moved > 0.5 ? ` · offset ${moved.toFixed(0)} m` : ''}</small>`, 'dep');
    }
  }
}

// ───────────────────────────── HTML labels ─────────────────────────────
const labels = {
  items: [], root: $('#labels'), v: new THREE.Vector3(),
  add(group, x, y, z, html, cls = '') {
    const el = document.createElement('div'); el.className = `lbl ${cls}`; el.innerHTML = html; el.style.display = 'none';
    this.root.appendChild(el);
    const it = { group, p: w2t(x, y, z), el, shown: false };
    this.items.push(it); return it;
  },
  remove(it) { it.el.remove(); this.items = this.items.filter((x) => x !== it); },
  clearGroup(group) { for (const it of this.items.filter((x) => x.group === group)) it.el.remove(); this.items = this.items.filter((x) => x.group !== group); },
  clear() { for (const it of this.items) it.el.remove(); this.items = []; },
  update() {
    const W = innerWidth, H = innerHeight;
    // in close-up and gameplay views, overlay labels more than ~700 m away would float over nearby geometry (HTML is not depth-tested)
    const far = M && M.dist != null && M.dist < 400 ? 700 : Infinity;
    for (const it of this.items) {
      const always = it.group === 'route' || it.group === 'anim';
      const on = !it.off && (it.group === 'missing' ? S.showMissing : always ? true : !!S.ov[it.group]) && (always || it.p.distanceTo(camera.position) < far);
      let show = false;
      if (on) {
        this.v.copy(it.p).project(camera);
        if (this.v.z > -1 && this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05) {
          show = true;
          it.el.style.transform = `translate(${((this.v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - this.v.y) / 2 * H).toFixed(1)}px) translate(-50%, -100%)`;
        }
      }
      if (show !== it.shown) { it.el.style.display = show ? '' : 'none'; it.shown = show; }
    }
  },
};

// ───────────────────────────── assets & instances ─────────────────────────────
function loadProto(name) {
  if (A.protos.has(name)) return A.protos.get(name);
  // glTF JSON with an embedded buffer (each GLB repackaged for web serving by make_web_safe.py)
  const p = A.loader.loadAsync(`data/assets/${name}.gltf.json`).then((gltf) => makeProto(name, gltf)).catch((e) => { A.failed[name] = String(e.message || e); return null; });
  A.protos.set(name, p);
  return p;
}
function makeProto(name, gltf) {
  const root = gltf.scene; root.updateMatrixWorld(true);
  const groups = new Map(); const box = new THREE.Box3(); let tris = 0, prims = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    prims++;
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color', 'tangent'].includes(k)) geo.deleteAttribute(k);
    geo.morphAttributes = {};
    const key = o.material.uuid + '|' + Object.keys(geo.attributes).sort().join(',') + '|' + (geo.index ? 'i' : 'n');
    if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
    groups.get(key).geos.push(geo);
    geo.computeBoundingBox(); box.union(geo.boundingBox);
    tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  });
  const parts = [];
  for (const { mat, geos } of groups.values()) {
    let list = geos;
    if (geos.length > 1) { const mg = BGU.mergeGeometries(geos, false); if (mg) { list = [mg]; geos.forEach((x) => x.dispose()); } }
    const team = /^TEAM/i.test(mat.name || '');
    let m = mat;
    if (team) { m = mat.clone(); m.name = mat.name; m.userData.teamBase = mat.color.clone(); m.color.set(0xffffff); }
    if ('envMapIntensity' in m) m.envMapIntensity = 0.55;
    m.userData.shared = true;
    for (const geo of list) { geo.userData.shared = true; geo.computeBoundingSphere(); parts.push({ geo, mat: m, team }); }
  }
  return { name, parts, box, tris: Math.round(tris), prims };
}
function catOf(name, info) {
  if (name.startsWith('veg_')) return info && info.source === 'species-height' ? 'tree' : (name === 'veg_oak' || /pine|palm|poplar|mangrove|broadleaf|jungle/.test(name) ? 'tree' : 'smallveg');
  if (name.startsWith('coral')) return 'smallveg';
  if (name.startsWith('rock_cliff')) return 'struct';
  if (name.startsWith('rock_')) return 'rock';
  if (name.startsWith('prop_') && info && Math.max(...info.size) < 4.5) return 'smallprop';
  return 'struct';
}
function sizeBox(info) { // asset-local Blender min/max (x east, y north, z up) → three Box3
  const mn = info.min, mx = info.max;
  return new THREE.Box3(new THREE.Vector3(mn[0], mn[2], -mx[1]), new THREE.Vector3(mx[0], mx[2], -mn[1]));
}
const missingGeoCache = new Map();
function missingGeo(name, box) {
  if (missingGeoCache.has(name)) return missingGeoCache.get(name);
  const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const geo = new THREE.BoxGeometry(Math.max(s.x, 0.05), Math.max(s.y, 0.05), Math.max(s.z, 0.05)); geo.translate(c.x, c.y, c.z);
  geo.userData.shared = true; missingGeoCache.set(name, geo);
  return geo;
}

class InstSet {
  constructor(name, rows, proto, proto1) {
    this.name = name; this.n = rows.length;
    this.info = A.sizes[name] || null;
    this.cat = catOf(name, this.info);
    this.proto = proto; this.proto1 = proto1; this.missing = !proto;
    this.procedural = this.missing && name === 'bld_naval_dock' && M.dockProcedural;
    this.lbox = proto ? proto.box.clone() : sizeBox(this.info || { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] });
    const n = this.n;
    this.X = new Float32Array(n); this.Y = new Float32Array(n); this.Z = new Float32Array(n);
    this.ROT = new Float32Array(n); this.SXY = new Float32Array(n); this.SZ = new Float32Array(n); this.TEAM = new Uint8Array(n);
    this.MAT = new Float32Array(n * 16); this.R = new Float32Array(n); this.COL = new Float32Array(n * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const corners = [];
    for (const x of [this.lbox.min.x, this.lbox.max.x]) for (const y of [this.lbox.min.y, this.lbox.max.y]) for (const z of [this.lbox.min.z, this.lbox.max.z]) corners.push(Math.hypot(x, y, z));
    const r0 = Math.max(...corners);
    let teamBase = null;
    if (proto) { const tp = proto.parts.find((x) => x.team); if (tp) teamBase = tp.mat.userData.teamBase; }
    const cols = { 1: new THREE.Color(TEAM_HEX[1]), 2: new THREE.Color(TEAM_HEX[2]), 0: this.missing ? new THREE.Color(MISSING_HEX) : (teamBase || new THREE.Color(0.5, 0.5, 0.5)) };
    rows.forEach((r, i) => {
      // [x, y, z, rotZ, scale, team, zScale?]. export_web.py writes scale = s·sz when zScale is present (the Blender assembler
      // uses xy = s, z = sz), so the horizontal scale is recovered as scale / zScale.
      const sz = r.length > 6 ? r[6] : r[4], sxy = r.length > 6 && r[6] ? r[4] / r[6] : r[4];
      this.X[i] = r[0]; this.Y[i] = r[1]; this.Z[i] = r[2]; this.ROT[i] = r[3]; this.SXY[i] = sxy; this.SZ[i] = sz; this.TEAM[i] = r[5] || 0;
      m4.compose(p.set(r[0], r[2], -r[1]), q.setFromAxisAngle(Y, r[3]), s.set(sxy, sz, sxy));
      m4.toArray(this.MAT, i * 16);
      this.R[i] = r0 * Math.max(sxy, sz);
      const c = cols[this.TEAM[i]] || cols[0]; this.COL.set([c.r, c.g, c.b], i * 3);
    });
    this.levels = [];
    if (!this.procedural) {
      this.levels.push(this.makeLevel(proto));
      if (proto && proto1) this.levels.push(this.makeLevel(proto1));
    }
  }
  makeLevel(proto) {
    const n = this.n;
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16); attr.setUsage(THREE.DynamicDrawUsage);
    let colAttr = null;
    const parts = proto ? proto.parts : [{ geo: missingGeo(this.name, this.lbox), mat: missingMat, team: true }];
    const meshes = [];
    for (const pt of parts) {
      const m = new THREE.InstancedMesh(pt.geo, pt.mat, n);
      m.instanceMatrix = attr;
      if (pt.team) { if (!colAttr) { colAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); colAttr.setUsage(THREE.DynamicDrawUsage); } m.instanceColor = colAttr; }
      m.frustumCulled = false; m.count = 0; m.userData.set = this;
      m.castShadow = false; m.receiveShadow = !this.missing;
      if (this.missing) m.renderOrder = 5;
      meshes.push(m); G.inst.add(m);
    }
    return { meshes, attr, colAttr, idx: new Int32Array(n), count: 0 };
  }
  setShadows(q) {
    const cast = !this.missing && q.shadows && (this.cat === 'struct' || (this.cat === 'tree' && S.quality === 'high'));
    for (const L of this.levels) for (const m of L.meshes) m.castShadow = cast;
  }
  update(cam, frustum, q, sph) {
    const lv = this.levels; if (!lv.length) return 0;
    for (const L of lv) L.count = 0;
    const visible = !this.missing || S.showMissing;
    if (visible) {
      const maxD = q.dist[this.cat] ?? 1e9, maxD2 = maxD * maxD, l1 = lv[1], lod2 = q.lod1 * q.lod1;
      const cx = cam.x, cy = cam.y, cz = cam.z;
      for (let i = 0; i < this.n; i++) {
        const dx = this.X[i] - cx, dy = this.Z[i] - cy, dz = -this.Y[i] - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD2) continue;
        sph.center.set(this.X[i], this.Z[i], -this.Y[i]); sph.radius = this.R[i];
        if (!frustum.intersectsSphere(sph)) continue;
        const L = l1 && d2 > lod2 ? l1 : lv[0];
        L.attr.array.set(this.MAT.subarray(i * 16, i * 16 + 16), L.count * 16);
        if (L.colAttr) L.colAttr.array.set(this.COL.subarray(i * 3, i * 3 + 3), L.count * 3);
        L.idx[L.count++] = i;
      }
    }
    let total = 0;
    for (const L of lv) {
      for (const m of L.meshes) m.count = L.count;
      if (L.count) {
        L.attr.clearUpdateRanges(); L.attr.addUpdateRange(0, L.count * 16); L.attr.needsUpdate = true;
        if (L.colAttr) { L.colAttr.clearUpdateRanges(); L.colAttr.addUpdateRange(0, L.count * 3); L.colAttr.needsUpdate = true; }
      }
      total += L.count;
    }
    this.drawn = total;
    return total;
  }
}

async function buildInstances() {
  M.sets = [];
  for (const [name, rows] of Object.entries(M.inst)) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const proto = A.manifest.has(name) ? await loadProto(name) : null;
    const proto1 = A.manifest.has(name + '_lod1') ? await loadProto(name + '_lod1') : null;
    M.sets.push(new InstSet(name, rows, proto, proto1));
  }
  M.instTotal = M.sets.reduce((s, x) => s + x.n, 0);
}
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
let lastInstCam = new THREE.Matrix4(), lastInstT = 0;
function updateInstances(force) {
  if (!M || !M.ready) return;
  const now = performance.now();
  camera.updateMatrixWorld();
  const moved = !camera.matrixWorld.equals(lastInstCam);
  if (!force && !M.instDirty && (!moved || now - lastInstT < 110)) return;
  lastInstCam.copy(camera.matrixWorld); lastInstT = now; M.instDirty = false;
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
  const q = QUALITY[S.quality];
  let drawn = 0, lod1 = 0;
  for (const set of M.sets) { drawn += set.update(camera.position, _frustum, q, _sph); if (set.levels[1]) lod1 += set.levels[1].count; }
  M.instDrawn = drawn; M.instLod1 = lod1;
  if (S.ov.bounds) rebuildBounds();
  updateMissingLabels();
}

// bounds overlay: one LineSegments over the currently drawn instances (within 1.2 km, ≤ 12k boxes)
let boundsLines = null;
function rebuildBounds() {
  const MAXB = 12000; const cam = camera.position;
  if (!boundsLines) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXB * 24 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXB * 24 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    boundsLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: true, fog: false }));
    boundsLines.frustumCulled = false; boundsLines.renderOrder = 28;
    boundsLines.geometry.userData.shared = true; boundsLines.material.userData.shared = true;
  }
  if (boundsLines.parent !== OVG.bounds) OVG.bounds.add(boundsLines);
  const pos = boundsLines.geometry.attributes.position.array, col = boundsLines.geometry.attributes.color.array;
  const E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cc = { struct: [0.55, 0.75, 0.88], unit: [0.95, 0.80, 0.35], tree: [0.45, 0.80, 0.45], smallveg: [0.40, 0.65, 0.40], rock: [0.70, 0.68, 0.62], smallprop: [0.75, 0.75, 0.80], missing: [0.95, 0.55, 0.25] };
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  let nb = 0;
  for (const set of M.sets) {
    const b = set.lbox, c = set.missing ? cc.missing : set.name.startsWith('unit_') ? cc.unit : cc[set.cat] || cc.struct;
    for (const L of set.levels) for (let k = 0; k < L.count && nb < MAXB; k++) {
      const i = L.idx[k];
      if ((set.X[i] - cam.x) ** 2 + (set.Z[i] - cam.y) ** 2 + (-set.Y[i] - cam.z) ** 2 > 1200 * 1200) continue;
      m4.fromArray(set.MAT, i * 16);
      let q = 0; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners[q++].set(x, y, z).applyMatrix4(m4);
      const o = nb * 72;
      E.forEach(([a, e], t) => { pos.set([corners[a].x, corners[a].y, corners[a].z, corners[e].x, corners[e].y, corners[e].z], o + t * 6); col.set([...c, ...c], o + t * 6); });
      nb++;
    }
  }
  boundsLines.geometry.setDrawRange(0, nb * 24);
  boundsLines.geometry.attributes.position.needsUpdate = true; boundsLines.geometry.attributes.color.needsUpdate = true;
  M.boundsCount = nb;
}

// "missing asset" labels for the nearest drawn stand-ins
const missLabels = [];
function updateMissingLabels() {
  if (!M) return;
  const cam = camera.position, cand = [];
  if (S.showMissing) for (const set of M.sets) {
    if (!set.missing || set.procedural || !set.levels.length) continue;
    const L = set.levels[0];
    for (let k = 0; k < L.count; k++) {
      const i = L.idx[k], d2 = (set.X[i] - cam.x) ** 2 + (set.Z[i] - cam.y) ** 2 + (-set.Y[i] - cam.z) ** 2;
      if (d2 < 260 * 260) cand.push([d2, set, i]);
    }
  }
  // one label per asset type (its nearest stand-in), larger footprints first, at most 8
  cand.sort((a, b) => a[0] - b[0]);
  const seen = new Set(), first = [];
  for (const c of cand) { if (seen.has(c[1].name)) continue; seen.add(c[1].name); first.push(c); }
  const vol = (s) => (s.info ? s.info.size[0] * s.info.size[1] * s.info.size[2] : 0);
  const pick = first.sort((a, b) => vol(b[1]) - vol(a[1])).slice(0, 8);
  while (missLabels.length < pick.length) missLabels.push(labels.add('missing', 0, 0, 0, '', 'miss'));
  missLabels.forEach((lb, k) => {
    const c = pick[k];
    lb.off = !c;
    if (!c) return;
    const [, set, i] = c, sz = set.info ? set.info.size : [1, 1, 1];
    w2t(set.X[i], set.Y[i], set.Z[i] + set.lbox.max.y * set.SZ[i] + 0.5, lb.p);
    const html = `missing asset · ${esc(set.name)}<small>${sz.map((v) => fmt(v * (set.SXY[i] || 1), v < 10 ? 2 : 1)).join(' × ')} m · ${esc(set.info ? set.info.source : 'size unknown')}</small>`;
    if (lb.html !== html) { lb.el.innerHTML = html; lb.html = html; }
  });
}

// strategic-scale unit dots
function buildDots() {
  const pos = [], col = [], refs = [];
  for (const set of M.sets) {
    if (!set.name.startsWith('unit_')) continue;
    for (let i = 0; i < set.n; i++) {
      pos.push(set.X[i], set.Z[i] + 1, -set.Y[i]);
      const c = new THREE.Color(set.TEAM[i] ? TEAM_HEX[set.TEAM[i]] : '#bbbbbb'); col.push(c.r, c.g, c.b); refs.push([set, i]);
    }
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 7 } },
    vertexShader: 'attribute vec3 aCol; varying vec3 vC; uniform float uSize; void main() { vC = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'varying vec3 vC; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard; gl_FragColor = vec4(r > 0.6 ? vec3(0.02) : vC, 1.0);\n#include <colorspace_fragment>\n}',
    depthTest: false, transparent: true,
  });
  const pts = new THREE.Points(geo, mat); pts.renderOrder = 40; pts.frustumCulled = false;
  G.dots.add(pts); M.dots = { pts, refs, mat };
}

// ───────────────────────────── camera presets ─────────────────────────────
function freeRect() {
  const W = innerWidth, H = innerHeight;
  if (isMobile()) return { l: 0, r: W, t: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 44, b: H - 48 };
  const L = $('#colL').getBoundingClientRect(), R = $('#colR').getBoundingClientRect();
  return { l: L.right + 8, r: R.left - 8, t: $('#top').getBoundingClientRect().bottom, b: H };
}
function applyViewOffset() {
  const W = innerWidth, H = innerHeight, f = freeRect();
  const sx = (f.l + f.r) / 2 - W / 2, sy = (f.t + f.b) / 2 - H / 2;
  for (const id of ['#camchip', '#scalebar', '#hover']) $(id).style.left = isMobile() ? '' : `${(f.l + f.r) / 2}px`;
  $('#compass').style.left = isMobile() ? '' : `${f.r - 46}px`;
  if (Math.abs(sx) < 1 && Math.abs(sy) < 1) { camera.clearViewOffset(); camera.userData.fullH = H; return; }
  const fw = W + 2 * Math.abs(sx), fh = H + 2 * Math.abs(sy);
  camera.setViewOffset(fw, fh, Math.abs(sx) - sx, Math.abs(sy) - sy, W, H);
  camera.userData.fullH = fh; // the vertical fov spans the full virtual height
}
function computePresets() {
  const P = {};
  for (const p of M.meta.presets || []) P[p.key] = { key: p.key, title: p.title, pos: p.pos, target: p.target, source: 'map.json' };
  // Overview: whole map, top-down, height fitted to the free viewport area (the map.json preset height is kept as a minimum reference).
  P.overview = { ...(P.overview || {}), key: 'overview', title: 'Entire-map overview (top-down)', fit: true, source: P.overview ? 'map.json, height fitted to viewport' : 'computed' };
  const d = findForestEdge();
  if (d) P.detail = { key: 'detail', title: `Biome detail: ${d.what}`, pos: d.pos, target: d.target, source: 'computed (forest edge from instances.json)' };
  M.presets = P;
  $$('#presetBtns .btn').forEach((b) => { b.disabled = !P[b.dataset.key]; });
}
function findForestEdge() {
  const trees = [];
  for (const set of M.sets) if (set.cat === 'tree') for (let i = 0; i < set.n; i++) trees.push([set.X[i], set.Y[i], set.name]);
  if (!trees.length) return null;
  const cell = 20, hash = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const t of trees) { const k = key(t[0], t[1]); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(t); }
  const near = (x, y, r) => { let c = 0; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const t of hash.get(`${Math.floor(x / cell) + a},${Math.floor(y / cell) + b}`) || []) if ((t[0] - x) ** 2 + (t[1] - y) ** 2 < r * r) c++; return c; };
  const pad = (M.meta.pads || []).find((p) => p.team === 'B') || { center: [M.S / 2, M.S / 2] };
  let best = null;
  const step = Math.max(1, Math.floor(trees.length / 600));
  for (let k = 0; k < trees.length; k += step) {
    const [x, y, nm] = trees[k];
    const dens = near(x, y, 25);
    if (dens < 6) continue;
    for (let a = 0; a < 12; a++) {
      const ang = a / 12 * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      // open ground all the way out to the camera position (58 m): sample at 30, 45 and 58 m
      let open = true;
      for (const [r, clear] of [[30, 10], [45, 14], [58, 20]]) {
        const px = x + c * r, py = y + s * r;
        const slope = Math.abs(hAt(px + 4, py) - hAt(px - 4, py)) + Math.abs(hAt(px, py + 4) - hAt(px, py - 4));
        if (px < 20 || py < 20 || px > M.S - 20 || py > M.S - 20 || hAt(px, py) < 0.8 || near(px, py, clear) > 0 || surfAt(px, py) === 11 || slope > 3) { open = false; break; }
      }
      if (!open) continue;
      const score = dens - Math.hypot(x - pad.center[0], y - pad.center[1]) / 400;
      if (!best || score > best.score) best = { score, x, y, ang, nm, dens };
    }
  }
  if (!best) return null;
  const { x, y, ang } = best, px = x + Math.cos(ang) * 58, py = y + Math.sin(ang) * 58;
  return { pos: [px, py, surfZ(px, py) + 6], target: [x - Math.cos(ang) * 6, y - Math.sin(ang) * 6, surfZ(x, y) + 5], what: `${best.nm} edge (${best.dens} trees within 25 m)` };
}
let tween = null;
function setCamera(posW, tgtW, instant) {
  const p = w2t(...posW), t = w2t(...tgtW);
  if (instant) { tween = null; camera.position.copy(p); controls.target.copy(t); resetControls(); return; }
  tween = { t0: performance.now(), dur: 650, p0: camera.position.clone(), t0v: controls.target.clone(), p1: p, t1: t };
}
function resetControls() { const d = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = d; }
function applyPreset(key, instant = false) {
  if (!M || !M.presets) return;
  const P = M.presets[key]; if (!P) return;
  S.preset = key;
  if (P.fit) {
    const f = freeRect(), fy = ((camera.userData.fullH || innerHeight) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const half = Math.min(f.r - f.l, f.b - f.t) / 2;
    const h = (M.S / 2) * 1.05 * fy / Math.max(half, 50) + Math.max(M.hmax, 0);
    setCamera([M.S / 2, M.S / 2 - 0.5, h], [M.S / 2, M.S / 2, 0], instant);
  } else setCamera(P.pos, P.target, instant);
  $$('#presetBtns .btn').forEach((b) => b.classList.toggle('on', b.dataset.key === key));
  M.instDirty = true;
}

// ───────────────────────────── picking ─────────────────────────────
const raycaster = new THREE.Raycaster();
function rayAt(px, py) {
  raycaster.setFromCamera(new THREE.Vector2(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
  return raycaster.ray;
}
function pickGround(ray) { // march the ray against the walkable surface (terrain, water at 0, decks)
  if (!M) return null;
  const o = ray.origin, d = ray.direction;
  const f = (t) => { const x = o.x + d.x * t, y = -(o.z + d.z * t); return (o.y + d.y * t) - surfZ(x, y); };
  // clip to the map volume
  let t0 = 0, t1 = 60000;
  const lo = [0, Math.min(M.hmin, 0) - 1, -M.S], hi = [M.S, Math.max(M.hmax, 20) + 30, 0], oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(da[k]) < 1e-9) { if (oa[k] < lo[k] || oa[k] > hi[k]) return null; continue; }
    let a = (lo[k] - oa[k]) / da[k], b = (hi[k] - oa[k]) / da[k]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
  }
  let prev = t0, fp = f(t0);
  if (fp < 0) return null;
  for (let t = t0; t <= t1;) {
    const step = Math.max(0.5, Math.min(8, t * 0.002, fp * 0.7));
    t = Math.min(t + step, t1);
    const ft = f(t);
    if (ft <= 0) {
      let a = prev, b = t;
      for (let k = 0; k < 22; k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
      const tt = (a + b) / 2, x = o.x + d.x * tt, y = -(o.z + d.z * tt);
      return { x, y, z: surfZ(x, y), t: tt };
    }
    if (t >= t1) break;
    prev = t; fp = ft;
  }
  return null;
}
function pickInstance(ray) {
  if (!M) return null;
  let best = null;
  const lo = new THREE.Vector3(), ld = new THREE.Vector3();
  for (const set of M.sets) {
    const b = set.lbox;
    for (const L of set.levels) for (let k = 0; k < L.count; k++) {
      const i = L.idx[k];
      const cx = set.X[i], cy = set.Z[i], cz = -set.Y[i];
      const ox = ray.origin.x - cx, oy = ray.origin.y - cy, oz = ray.origin.z - cz;
      const tb = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z, c2 = ox * ox + oy * oy + oz * oz - set.R[i] * set.R[i];
      if (tb * tb - c2 < 0) continue;
      const cs = Math.cos(-set.ROT[i]), sn = Math.sin(-set.ROT[i]), sxy = set.SXY[i] || 1, sz = set.SZ[i] || 1;
      lo.set((ox * cs + oz * sn) / sxy, oy / sz, (-ox * sn + oz * cs) / sxy);
      ld.set((ray.direction.x * cs + ray.direction.z * sn) / sxy, ray.direction.y / sz, (-ray.direction.x * sn + ray.direction.z * cs) / sxy);
      let t0 = 0, t1 = Infinity; let hit = true;
      for (const ax of ['x', 'y', 'z']) {
        if (Math.abs(ld[ax]) < 1e-12) { if (lo[ax] < b.min[ax] || lo[ax] > b.max[ax]) { hit = false; break; } continue; }
        let a = (b.min[ax] - lo[ax]) / ld[ax], e = (b.max[ax] - lo[ax]) / ld[ax]; if (a > e) [a, e] = [e, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, e); if (t0 > t1) { hit = false; break; }
      }
      if (hit && (!best || t0 < best.t)) best = { set, i, t: t0 };
    }
  }
  return best;
}
function pickDot(px, py) {
  if (!M.dots || !M.dots.pts.visible) return null;
  const v = new THREE.Vector3(); let best = null;
  for (const [set, i] of M.dots.refs) {
    v.set(set.X[i], set.Z[i] + 1, -set.Y[i]).project(camera);
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight, d = Math.hypot(sx - px, sy - py);
    if (d < 12 && (!best || d < best.d)) best = { set, i, d };
  }
  return best;
}

// ───────────────────────────── selection / inspect ─────────────────────────────
let selection = null;
function select(hit, ground) {
  disposeTree(G.sel);
  selection = hit ? { set: hit.set, i: hit.i } : ground ? { ground } : null;
  if (hit) {
    const set = hit.set, i = hit.i, m4 = new THREE.Matrix4().fromArray(set.MAT, i * 16);
    const s = set.lbox.getSize(new THREE.Vector3()), c = set.lbox.getCenter(new THREE.Vector3());
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x, s.y, s.z).translate(c.x, c.y, c.z));
    const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xd6a24c, depthTest: false, transparent: true, fog: false }));
    ls.applyMatrix4(m4); ls.renderOrder = 60; G.sel.add(ls);
  }
  renderInspect();
  showPane('inspect');
}
function renderInspect() {
  const out = $('#inspectOut'); if (!out) return;
  if (!M || !selection) { out.innerHTML = '<p class="muted">Click an object in the view to inspect it. Unit dots can be clicked at strategic scale.</p>'; return; }
  if (selection.ground) {
    const g = selection.ground; const c = cellOf(g.x, g.y), bits = M.nav ? M.nav[c] : null;
    out.innerHTML = `<h4>Ground point</h4><dl class="kv">
      <dt>Position</dt><dd>${fmt(g.x, 1)} E, ${fmt(g.y, 1)} N m</dd><dt>Terrain height</dt><dd>${fmt(hAt(g.x, g.y), 2)} m</dd>
      <dt>Surface</dt><dd>${esc(M.surf ? SURF_NAME[surfAt(g.x, g.y)] ?? surfAt(g.x, g.y) : 'surface.u8 missing')}</dd>
      <dt>Deck</dt><dd>${M.deck ? (M.deck[c] ? `yes${Number.isNaN(M.deckZ[c]) ? '' : ' · ' + fmt(M.deckZ[c], 1) + ' m'}` : 'no') : 'deck.u8 missing'}</dd>
      <dt>Passable for</dt><dd>${bits == null ? 'nav.u8 missing' : CLASSES.filter((k) => bits & M.meta.nav_bits[k]).map((k) => CLASS_NAME[k]).join(', ') || 'none'}</dd>
      <dt>Road speed cell</dt><dd>${M.roadMask[c] ? 'yes' : 'no'}</dd></dl>`;
    return;
  }
  const { set, i } = selection, info = set.info;
  const sz = info ? info.size : null;
  const glbSize = set.proto ? set.proto.box.getSize(new THREE.Vector3()) : null;
  const team = set.TEAM[i] === 1 ? 'Blue (B)' : set.TEAM[i] === 2 ? 'Red (R)' : 'none';
  const dimsScaled = sz ? sz.map((v, k) => fmt(v * (k === 2 ? set.SZ[i] : set.SXY[i]), 2)).join(' × ') : 'unknown';
  out.innerHTML = `<h4>${esc(set.name)}</h4><dl class="kv">
    <dt>Instance</dt><dd>#${i} of ${fmt(set.n)}</dd><dt>Category</dt><dd>${esc(set.cat)}</dd><dt>Team</dt><dd>${team}</dd>
    <dt>Position</dt><dd>${fmt(set.X[i], 1)} E, ${fmt(set.Y[i], 1)} N, z ${fmt(set.Z[i], 2)} m</dd>
    <dt>Heading</dt><dd>${fmt(THREE.MathUtils.radToDeg(set.ROT[i]), 1)}° CCW from east</dd>
    <dt>Scale</dt><dd>${fmt(set.SXY[i], 3)}${set.SZ[i] !== set.SXY[i] ? ` · z ${fmt(set.SZ[i], 3)}` : ''}</dd>
    <dt>Size L × W × H</dt><dd>${dimsScaled} m</dd>
    <dt>Size source</dt><dd>${esc(info ? info.source : 'no entry in sizes.json')}</dd>
    ${info && info.spec ? `<dt>Spec</dt><dd>${info.spec.map((v) => fmt(v, 2)).join(' × ')} m</dd>` : ''}
    <dt>GLB</dt><dd>${set.proto ? `loaded · ${fmt(set.proto.tris)} tris · ${set.proto.prims} primitives → ${set.proto.parts.length} instanced meshes${set.proto1 ? ' · LOD1 ' + fmt(set.proto1.tris) + ' tris' : ''}` : `<span class="st-miss">missing</span>${set.procedural ? ' · procedural 80 × 40 m deck drawn' : ' · drawn as a dimensioned box'}`}</dd>
    ${glbSize ? `<dt>GLB bounds</dt><dd>${fmt(glbSize.x, 2)} × ${fmt(glbSize.z, 2)} × ${fmt(glbSize.y, 2)} m (all meshes)</dd>` : ''}
    ${info && info.excluded && info.excluded.length ? `<dt>Excluded from size</dt><dd>${esc(info.excluded.join(', '))}</dd>` : ''}
  </dl>${!set.proto ? '<div class="note warn">This asset has no web GLB yet. The box shows its footprint from sizes.json; it is a stand-in, not the asset.</div>' : ''}`;
}

// ───────────────────────────── pathfinding (A*, 8-connected) ─────────────────────────────
const SQ2 = Math.SQRT2;
class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(v, k) {
    if (this.n >= this.v.length) { const k2 = new Float64Array(this.n * 2), v2 = new Int32Array(this.n * 2); k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2; }
    let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= k) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = k; this.v[i] = v;
  }
  pop() {
    const top = this.v[0], n = --this.n; if (n === 0) return top;
    const k = this.k[n], v = this.v[n]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && this.k[c + 1] < this.k[c]) c++; if (this.k[c] >= k) break; this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c; }
    this.k[i] = k; this.v[i] = v; return top;
  }
}
let SEARCH = null;
function searchBuf() {
  const N = M.nn * M.nn;
  if (!SEARCH || SEARCH.N !== N) SEARCH = { N, g: new Float64Array(N), came: new Int32Array(N), stamp: new Uint32Array(N), closed: new Uint32Array(N), gen: 0, heap: new Heap(1 << 16) };
  SEARCH.gen++; SEARCH.heap.n = 0;
  return SEARCH;
}
function snap(bit, x, y, rmax = 40) {
  const { nn, g, nav } = M;
  const c0 = cellOf(x, y);
  if (nav[c0] & bit) return { cell: c0, dist: 0 };
  const ci = c0 % nn, cj = (c0 / nn) | 0, R = Math.ceil(rmax / g);
  let best = null;
  for (let j = Math.max(cj - R, 0); j <= Math.min(cj + R, nn - 1); j++) for (let i = Math.max(ci - R, 0); i <= Math.min(ci + R, nn - 1); i++) {
    const c = j * nn + i; if (!(nav[c] & bit)) continue;
    const d = Math.hypot(cellX(i) - x, cellX(j) - y);
    if (d <= rmax && (!best || d < best.dist)) best = { cell: c, dist: d };
  }
  return best;
}
function astar(cls, from, to) { // to = [x, y] or 'edge'
  const t0 = performance.now();
  const bitv = M.meta.nav_bits?.[cls], sp = M.meta.speeds_mps?.[cls];
  if (!M.nav) return { found: false, reason: 'nav.u8 missing', ms: 0 };
  if (!bitv || !sp) return { found: false, reason: `no nav bit or speed for ${cls} in map.json`, ms: 0 };
  const { nn, g, nav, roadMask } = M, bit = bitv;
  const vr = sp[0], vo = sp[1], vmax = Math.max(vr, vo), invR = 1 / vr, invO = 1 / vo;
  const s = snap(bit, from[0], from[1]);
  if (!s) return { found: false, reason: 'no passable cell within 40 m of the start', ms: performance.now() - t0, expanded: 0 };
  let goalCell = -1, e = null;
  const edge = to === 'edge';
  if (!edge) { e = snap(bit, to[0], to[1]); if (!e) return { found: false, reason: 'no passable cell within 40 m of the end', snapStart: s.dist, ms: performance.now() - t0, expanded: 0 }; goalCell = e.cell; }
  const gi = edge ? 0 : goalCell % nn, gj = edge ? 0 : (goalCell / nn) | 0;
  const H = edge
    ? (i, j) => Math.min(i, j, nn - 1 - i, nn - 1 - j) * g / vmax
    : (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return (Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy)) * g / vmax; };
  const B = searchBuf(), gen = B.gen, gs = B.g, came = B.came, stamp = B.stamp, closed = B.closed, heap = B.heap;
  const sc = s.cell; gs[sc] = 0; stamp[sc] = gen; came[sc] = -1;
  heap.push(sc, H(sc % nn, (sc / nn) | 0));
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = -1, expanded = 0;
  while (heap.n) {
    const c = heap.pop();
    if (closed[c] === gen) continue;
    closed[c] = gen; expanded++;
    const i = c % nn, j = (c / nn) | 0;
    if (edge ? (i === 0 || j === 0 || i === nn - 1 || j === nn - 1) : c === goalCell) { found = c; break; }
    const cc = roadMask[c] ? invR : invO, gc = gs[c];
    for (let k = 0; k < 8; k++) {
      const ni = i + DI[k], nj = j + DJ[k];
      if (ni < 0 || nj < 0 || ni >= nn || nj >= nn) continue;
      const nc = nj * nn + ni;
      if (!(nav[nc] & bit) || closed[nc] === gen) continue;
      let len = g;
      if (k >= 4) { if (!(nav[j * nn + ni] & bit) || !(nav[nj * nn + i] & bit)) continue; len = g * SQ2; }
      const ng = gc + len * 0.5 * (cc + (roadMask[nc] ? invR : invO));
      if (stamp[nc] !== gen || ng < gs[nc]) { stamp[nc] = gen; gs[nc] = ng; came[nc] = c; heap.push(nc, ng + H(ni, nj)); }
    }
  }
  const ms = performance.now() - t0;
  const res = { cls, found: found >= 0, expanded, ms, snapStart: s.dist, snapEnd: e ? e.dist : null, from, to };
  if (found < 0) { res.reason = edge ? 'no route to any map-edge cell' : 'no route (start and end are not connected on this layer)'; return res; }
  const cells = []; for (let c = found; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  let len = 0, roadLen = 0; const cum = [0];
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k], d = (a % nn !== b % nn && ((a / nn) | 0) !== ((b / nn) | 0)) ? g * SQ2 : g;
    len += d; if (roadMask[a] && roadMask[b]) roadLen += d;
    cum.push(gs[b]);
  }
  Object.assign(res, { cells, length: len, roadLength: roadLen, time: gs[found], cum, endCell: found });
  return res;
}
function pathPoints(res) { // cell centres as world [x, y, z] on the class's surface
  return res.cells.map((c) => { const x = cellX(c % M.nn), y = cellX((c / M.nn) | 0); return [x, y, res.cls === 'ship' ? 0 : surfZ(x, y)]; });
}
function simplify(pts) { // drop collinear points for drawing
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1], b = pts[k], c = pts[k + 1];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cr) > 1e-6 || Math.abs(b[2] - a[2]) > 0.5) out.push(b);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}
function pathLine(res, color, width = 3) {
  const pts = simplify(pathPoints(res));
  const flat = []; for (const p of pts) flat.push(p[0], p[2] + 1.6, -p[1]);
  return line2(flat, color, width, { order: 45, depthTest: false });
}
function endpointMarker(x, y, color, ring = 6) {
  return line2(drape(circlePts([x, y], ring, 32), 1.2, true, 1), color, 2.5, { order: 46, depthTest: false });
}
const fmtTime = (s) => (s == null ? '–' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} (${s.toFixed(0)} s)`);
const fmtLen = (m) => (m == null ? '–' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);

// manual route tool
const routeState = { start: null, end: null, result: null, anim: null, speed: 10 };
function routeClick(p) {
  if (!routeState.start || routeState.end) { routeState.start = [p.x, p.y]; routeState.end = null; routeState.result = null; stopAnim(); }
  else { routeState.end = [p.x, p.y]; routeState.result = astar(S.cls, routeState.start, routeState.end); }
  drawRoute(); renderRouteOut();
}
function drawRoute() {
  disposeTree(G.route); labels.clearGroup('route');
  const st = routeState;
  if (st.start) { G.route.add(endpointMarker(st.start[0], st.start[1], '#6db67a')); labels.add('route', st.start[0], st.start[1], surfZ(...st.start) + 4, 'start', 'route'); }
  if (st.end) { G.route.add(endpointMarker(st.end[0], st.end[1], '#e0645c')); labels.add('route', st.end[0], st.end[1], surfZ(...st.end) + 4, 'end', 'route'); }
  if (st.result && st.result.found) G.route.add(pathLine(st.result, '#d6a24c', 4));
}
function renderRouteOut() {
  const out = $('#routeOut'); if (!out) return;
  const st = routeState, r = st.result;
  let html = '';
  if (S.tool === 'route') html += `<p class="note">${!st.start || st.end ? 'Click the map to set the <b>start</b>.' : 'Click the map to set the <b>end</b>.'}</p>`;
  if (st.start) html += `<dl class="kv"><dt>Start</dt><dd>${fmt(st.start[0], 0)} E, ${fmt(st.start[1], 0)} N</dd>${st.end ? `<dt>End</dt><dd>${fmt(st.end[0], 0)} E, ${fmt(st.end[1], 0)} N</dd>` : ''}</dl>`;
  if (r) {
    if (r.found) {
      html += `<div class="summary"><span class="chip PASS">ROUTE</span><span class="big">${fmtLen(r.length)}</span><span class="muted">${fmtTime(realT(r.time))} at ${P.game_speed.toFixed(2)}× · game ${fmtTime(r.time)}</span></div>
      <dl class="kv"><dt>Class</dt><dd>${CLASS_NAME[r.cls]} · ${M.meta.speeds_mps[r.cls].map((v) => +v.toFixed(2)).join(' / ')} m/s (game)</dd><dt>On road-speed cells</dt><dd>${fmtLen(r.roadLength)}</dd>
      <dt>Snap start / end</dt><dd>${fmt(r.snapStart, 1)} / ${fmt(r.snapEnd, 1)} m</dd><dt>Cells expanded</dt><dd>${fmt(r.expanded)} · ${fmt(r.ms, 0)} ms</dd></dl>
      <div class="row"><button class="btn sm" id="animPlay">${st.anim && st.anim.playing ? 'Pause' : 'Play along route'}</button>
      <div class="seg" id="animSpeed" style="flex:1">${[1, 10, 60].map((v) => `<button data-v="${v}" class="${st.speed === v ? 'on' : ''}">×${v}</button>`).join('')}</div></div>
      <p class="muted" id="animStatus" style="font-size:11px"></p>`;
    } else {
      html += `<div class="summary"><span class="chip FAIL">NO ROUTE</span><span class="muted">${esc(r.reason || '')}</span></div>
      <dl class="kv"><dt>Class</dt><dd>${CLASS_NAME[r.cls]}</dd><dt>Cells expanded</dt><dd>${fmt(r.expanded || 0)} · ${fmt(r.ms, 0)} ms</dd>${r.snapStart != null ? `<dt>Start snap</dt><dd>${fmt(r.snapStart, 1)} m</dd>` : ''}</dl>`;
    }
  }
  html += `<p class="muted" style="font-size:11px">Time = Σ step length ÷ speed (road speed on asphalt, deck and road-corridor cells), in game seconds; the real time divides by the game speed (Pace tab). No acceleration or turning here: the Pace tab drives the path with the sandbox's vehicle rules. Path length is the 8-connected grid path on ${M ? M.g : 4} m cells; endpoints snap to the nearest passable cell within 40 m, as in navcheck.py.</p>`;
  out.innerHTML = html;
  $('#animPlay')?.addEventListener('click', toggleAnim);
  $$('#animSpeed button').forEach((b) => b.addEventListener('click', () => { st.speed = +b.dataset.v; renderRouteOut(); }));
}
function renderClassInfo() {
  const el = $('#classInfo'); if (!el || !M) return;
  const sp = M.meta.speeds_mps?.[S.cls], r = M.meta.unit_radius_m?.[S.cls], bit = M.meta.nav_bits?.[S.cls];
  let pass = 0; if (M.nav) for (let k = 0; k < M.nav.length; k++) if (M.nav[k] & bit) pass++;
  el.innerHTML = `<dt>Speed road / off-road</dt><dd>${sp ? sp.map((v) => +v.toFixed(2)).join(' / ') + ' m/s game' : 'missing'}</dd>${sp ? `<dt>At game speed ${P.game_speed.toFixed(2)}×</dt><dd>${sp.map((v) => (v * P.game_speed).toFixed(1)).join(' / ')} m/s on screen</dd>` : ''}<dt>Clearance radius</dt><dd>${r != null ? r + ' m (baked)' : 'missing'}</dd>
    <dt>Nav bit</dt><dd>${bit ?? 'missing'} · ${M.nav ? fmt(pass * M.g * M.g / 1e6, 2) + ' km² passable' : 'nav.u8 missing'}</dd>`;
}
// animation along the route
function stopAnim() { if (routeState.anim) { G.route.remove(routeState.anim.obj); labels.clearGroup('anim'); } routeState.anim = null; }
function toggleAnim() {
  const st = routeState;
  if (!st.result || !st.result.found) return;
  if (st.anim) { st.anim.playing = !st.anim.playing; renderRouteOut(); return; }
  const r = st.result, pts = pathPoints(r);
  const obj = makeMover(r.cls);
  G.route.add(obj);
  const lb = labels.add('anim', 0, 0, 0, '', 'route');
  st.anim = { obj, pts, cum: r.cum, t: 0, playing: true, label: lb };
  renderRouteOut();
}
function makeMover(cls) {
  const grp = new THREE.Group();
  const nm = CLASS_MODEL[cls];
  const protoP = A.protos.get(nm);
  let ok = false;
  if (protoP) protoP.then((p) => { if (p && !ok) { ok = true; for (const pt of p.parts) { const m = new THREE.Mesh(pt.geo, pt.mat); m.castShadow = true; grp.add(m); } } });
  const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd6a24c, depthTest: false, transparent: true, fog: false }));
  ring.position.y = 0.6; ring.renderOrder = 50; grp.add(ring);
  if (!A.manifest.has(nm)) {
    const info = A.sizes[nm]; const box = info ? sizeBox(info) : new THREE.Box3(new THREE.Vector3(-3, 0, -1.5), new THREE.Vector3(3, 3, 1.5));
    const m = new THREE.Mesh(missingGeo(nm, box), missingMat); grp.add(m);
  }
  return grp;
}
function stepAnim(dt) {
  const a = routeState.anim; if (!a) return;
  if (a.playing) a.t += dt * routeState.speed * P.game_speed;   // a.t is game time; ×1 = real time at the current game speed
  const T = a.cum[a.cum.length - 1];
  if (a.t >= T) { a.t = T; a.playing = false; }
  let k = 1; while (k < a.cum.length - 1 && a.cum[k] < a.t) k++;
  const t0 = a.cum[k - 1], t1 = a.cum[k], u = t1 > t0 ? clamp((a.t - t0) / (t1 - t0), 0, 1) : 1;
  const p = a.pts[k - 1], q = a.pts[k] || p;
  const x = p[0] + (q[0] - p[0]) * u, y = p[1] + (q[1] - p[1]) * u, z = routeState.result.cls === 'ship' ? 0 : surfZ(x, y);
  a.obj.position.set(x, z, -y);
  if (q !== p) a.obj.rotation.y = Math.atan2(q[1] - p[1], q[0] - p[0]);
  w2t(x, y, z + 14, a.label.p);
  const html = `${CLASS_NAME[routeState.result.cls]} · ${fmtTime(realT(a.t))} / ${fmtTime(realT(T))}`;
  if (a.label.html !== html) { a.label.el.innerHTML = html; a.label.html = html; }
  const st = $('#animStatus'); if (st) st.textContent = `${fmtTime(realT(a.t))} of ${fmtTime(realT(T))} real (game speed ${P.game_speed.toFixed(2)}×), playback ×${routeState.speed}${a.playing ? '' : ' (paused)'}`;
}

// ───────────────────────────── standard route tests ─────────────────────────────
function standardTests() {
  const meta = M.meta, T = [], pads = meta.pads || [];
  const rally = (p) => p.rally || [p.center[0] + 30, p.center[1] - 10]; // the base kit is mirrored per start; map.json carries each rally point
  for (const a of pads) for (const b of pads) {
    if (a === b) continue;
    const cross = a.team !== b.team, none = M.id === '04' && cross;
    T.push({ group: 'Tank: rally → other bases', cls: 'tank', name: `${a.id} → ${b.id}`, from: rally(a), to: rally(b), expect: none ? 'none' : 'route', cross });
  }
  for (const p of pads) {
    const deps = (meta.deposits || []).filter((d) => d.kind === 'home' && d.nearest === p.id);
    for (const d of deps) T.push({ group: 'Harvester: base → home deposits', cls: 'harvester', name: `${p.id} → ${d.id}`, from: rally(p), to: d.service_point, expect: 'route' });
  }
  for (const d of meta.docks || []) {
    const ly = [-Math.sin(d.rot), Math.cos(d.rot)], berth = [d.water_center[0] - ly[0] * 26, d.water_center[1] - ly[1] * 26];
    T.push({ group: 'Ship: dock berth → map edge', cls: 'ship', name: `${d.player} berth`, from: berth, to: 'edge', expect: 'route' });
  }
  (meta.beaches || []).forEach((b, k) => {
    const c = b.center, u = b.dir;
    T.push({ group: 'Amphibious: beach 120 m offshore → 120 m inland', cls: 'amphibious', name: `beach ${k + 1} @ ${c[0].toFixed(0)}, ${c[1].toFixed(0)}`, from: [c[0] + u[0] * 120, c[1] + u[1] * 120], to: [c[0] - u[0] * 120, c[1] - u[1] * 120], expect: 'route' });
  });
  return T;
}
// ───────────────────────────── pace: game speed, harvest round trips, base to base ─────────────────────────────
function applyPaceSpeeds() { if (M && M.meta && M.meta.speeds_mps) M.meta.speeds_mps.harvester = PACE.harvesterMapsSpeeds(P); }
const PM = { map: null, res: null, running: false, focus: null };   // per-map cache of planned polylines (independent of the speed sliders)
function losOk(bit, a, b, road) { // every half-cell sample on the layer; when `road` is given, every sample must also match that road state
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / (M.g * 0.5)));
  for (let k = 0; k <= n; k++) { const c = cellOf(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); if (!(M.nav[c] & bit)) return false; if (road != null && !!M.roadMask[c] !== road) return false; }
  return true;
}
function pullPath(res, bit) { // string-pull the 8-connected cell path within road / off-road runs, so roads are still followed
  const cells = res.cells, pts = cells.map((c) => [cellX(c % M.nn), cellX((c / M.nn) | 0)]), road = cells.map((c) => !!M.roadMask[c]);
  const out = [pts[0]]; let a = 0;
  while (a < pts.length - 1) {
    let b = a + 1;
    for (let j = a + 2; j < pts.length && road[j] === road[a]; j++) { if (losOk(bit, pts[a], pts[j], road[a])) b = j; else break; }
    out.push(pts[b]); a = b;
  }
  return out;
}
function planned(cls, from, to) { const r = astar(cls, from, to); if (!r.found) return { found: false, reason: r.reason }; const bit = M.meta.nav_bits[cls]; return { found: true, pts: pullPath(r, bit), gridTime: r.time, length: r.length, res: r }; }
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
async function planPace(progress) { // plan once per map: harvester dock→service point for every deposit from every base's docks, tank rally→rally for every base pair
  const meta = M.meta, pads = (meta.pads || []).filter((p) => p.refinery_docks), deps = meta.deposits || [];
  const jobs = []; for (const d of deps) for (const p of pads) if (d.kind !== 'home' || d.nearest === p.id) p.refinery_docks.forEach((dk, k) => jobs.push({ d, p, dk, k }));
  const harv = []; let last = performance.now();
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]; const pl = planned('harvester', j.dk.approach, j.d.service_point);
    harv.push({ dep: j.d.id, kind: j.d.kind, base: j.p.id, team: j.p.team, dock: j.k, grate: j.dk.grate, approach: j.dk.approach, plan: pl });
    if (performance.now() - last > 150) { progress && progress(i / jobs.length * 0.8); await yieldUI(); last = performance.now(); }
  }
  const b2b = []; const rp = meta.pads || [];
  for (let a = 0; a < rp.length; a++) for (let b = a + 1; b < rp.length; b++) {
    if (rp[a].team === rp[b].team) continue;
    let cls = 'tank', pl = planned('tank', rp[a].rally, rp[b].rally);
    if (!pl.found) { cls = 'amphibious'; pl = planned('amphibious', rp[a].rally, rp[b].rally); }
    b2b.push({ a: rp[a].id, b: rp[b].id, cls, plan: pl }); progress && progress(0.8 + 0.2 * b2b.length / 8); await yieldUI();
  }
  return { harv, b2b };
}
function evalPace(plans) { // drive every planned path with the current sliders (fast: no search)
  const H = PACE.harvesterMapsSpeeds(P), dopt = { roadAt: (x, y) => !!M.roadMask[cellOf(x, y)], heightAt: (x, y) => surfZ(x, y) };
  const rows = [];
  for (const h of plans.harv) {
    if (!h.plan.found) { rows.push({ ...h, cycle: null }); continue; }
    const cyc = PACE.harvestCycle({ grate: h.grate, approach: h.approach, out: h.plan.pts, back: h.plan.pts.slice().reverse(), roadSpeeds: H }, P, dopt);
    rows.push({ ...h, cycle: cyc });
  }
  // keep each base's faster dock; for expansions and contested fields keep the nearest base of each team
  const best = new Map(); for (const r of rows) { if (!r.cycle) continue; const key = r.dep + '|' + r.base; const o = best.get(key); if (!o || r.cycle.game_s < o.cycle.game_s) best.set(key, r); }
  const perDep = new Map(); for (const r of best.values()) { const key = r.dep + '|' + (r.kind === 'home' ? r.base : r.team); const o = perDep.get(key); if (!o || r.cycle.game_s < o.cycle.game_s) perDep.set(key, r); }
  for (const d of new Set(plans.harv.map((h) => h.dep))) if (![...perDep.values()].some((r) => r.dep === d)) { const h = plans.harv.find((x) => x.dep === d); perDep.set(d + '|none', { ...h, base: '–', cycle: null, unreachable: true }); }   // e.g. island fields: transport delivery only
  const harv = [...perDep.values()].sort((x, y) => (!x.cycle) - (!y.cycle) || 0).sort((x, y) => (x.kind === 'home') !== (y.kind === 'home') ? (x.kind === 'home' ? -1 : 1) : (!x.cycle || !y.cycle) ? (!x.cycle) - (!y.cycle) : x.cycle.game_s - y.cycle.game_s);
  const T = P.tank, tk = (cls) => { const sp = M.meta.speeds_mps[cls]; return { road: sp[0], off: sp[1], accel: T.accel_mps2, brake: T.brake_mps2, turnDps: T.hull_turn_dps }; };
  const b2b = plans.b2b.map((x) => { if (!x.plan.found) return { ...x, game_s: null }; const dv = PACE.drive(x.plan.pts, tk(x.cls), { ...dopt, cornerR: P.drive.corner_radius_m, dt: 1 / P.drive.tick_hz }); return { ...x, game_s: dv.t, dist: dv.dist, grid_s: x.plan.gridTime }; });
  return { map: M.id, game_speed: P.game_speed, harvester_ratio: P.harvester_speed_ratio, harvester_mps: H, harv, b2b };
}
async function measurePace() {
  if (!M || PM.running) return PM.res; PM.running = true; const btn = $('#paceRun'); if (btn) btn.disabled = true;
  const prog = $('#paceProg'); if (prog) prog.hidden = false;
  try {
    if (PM.map !== M.id || !PM.plans) { PM.plans = await planPace((f) => { if (prog) prog.firstElementChild.style.width = `${f * 100}%`; }); PM.map = M.id; }
    PM.res = evalPace(PM.plans);
  } finally { PM.running = false; if (btn) btn.disabled = false; if (prog) setTimeout(() => { prog.hidden = true; }, 300); }
  renderPace(); return PM.res;
}
function repace() { applyPaceSpeeds(); savePace(); if (PM.plans && PM.map === M?.id) PM.res = evalPace(PM.plans); renderPace(); renderClassInfo(); renderRouteOut(); renderTests(); }
function buildPaceUI() {
  const el = $('#paceCtl'); if (!el) return;
  const [g0, g1] = P.game_speed_range, [r0, r1] = P.harvester_ratio_range;
  el.innerHTML = `
    <label class="sl"><span>Game speed</span><output id="paceGv"></output><input type="range" id="paceG" min="${g0}" max="${g1}" step="0.05" value="${P.game_speed}" aria-label="Game speed"></label>
    <p class="muted sm" id="paceGnote"></p>
    <label class="sl"><span>Harvester speed</span><output id="paceRv"></output><input type="range" id="paceR" min="${r0}" max="${r1}" step="0.01" value="${P.harvester_speed_ratio}" aria-label="Harvester speed relative to the tank"></label>
    <p class="muted sm" id="paceRnote"></p>
    <details class="adv"><summary>Harvest cycle settings</summary>
      <div class="grid2" style="margin-top:6px"><label class="num">Load (game s)<input type="number" id="paceLoad" min="0" max="120" step="0.5" value="${P.harvester.load_s}"></label>
      <label class="num">Unload (game s)<input type="number" id="paceUnload" min="0" max="60" step="0.5" value="${P.harvester.unload_s}"></label></div>
      <p class="muted sm">Accel ${P.harvester.accel_mps2} m/s², pivot ${P.harvester.hull_turn_dps}°/s, reverse ${P.harvester.reverse_mps} m/s onto the grate. All values are game time.</p>
      <button class="btn sm" id="paceReset">Reset to pace.json</button></details>`;
  const sync = () => {
    $('#paceGv').textContent = `${P.game_speed.toFixed(2)}×`; $('#paceRv').textContent = `${P.harvester_speed_ratio.toFixed(2)}× tank`;
    const H = PACE.harvesterMapsSpeeds(P), t = P.reference_tank.maps;
    $('#paceGnote').textContent = `Everything in the simulation runs ${P.game_speed.toFixed(2)}× faster: movement, turning, reloads, harvesting, unloading and build times. Distances and turning circles stay the same. 1 real second = ${P.game_speed.toFixed(2)} game seconds.`;
    $('#paceRnote').textContent = `${H[0].toFixed(1)} / ${H[1].toFixed(1)} m/s road / off-road (tank ${t.road_mps} / ${t.offroad_mps}), game time.`;
  };
  $('#paceG').addEventListener('input', (e) => { P.game_speed = +e.target.value; sync(); repace(); });
  $('#paceR').addEventListener('input', (e) => { P.harvester_speed_ratio = +e.target.value; sync(); repace(); });
  $('#paceLoad').addEventListener('change', (e) => { P.harvester.load_s = Math.max(0, +e.target.value || 0); repace(); });
  $('#paceUnload').addEventListener('change', (e) => { P.harvester.unload_s = Math.max(0, +e.target.value || 0); repace(); });
  $('#paceReset').addEventListener('click', () => { Object.assign(P, structuredClone(PACE_FILE)); buildPaceUI(); repace(); });
  $('#paceRun').addEventListener('click', () => measurePace());
  sync();
}
const inT = (v, [a, b]) => (v == null ? 'NONE' : v < a ? 'WARN' : v > b ? 'WARN' : 'PASS');
function renderPace() {
  const out = $('#paceOut'); if (!out) return; const R = PM.res;
  if (!M) { out.innerHTML = ''; return; }
  if (!R || R.map !== M.id) { out.innerHTML = `<p class="muted">Measures every deposit's harvester round trip and every base-to-enemy-base drive on this map. It plans each route on the baked nav grid, then drives it with the sandbox's vehicle rules (acceleration, braking, corner speeds, pivot turns, slopes). Harvesters also load, dock and unload. Targets: base to enemy base ${P.targets.base_to_enemy_base_s.join('–')} s, nearest home deposit round trip ${P.targets.harvest_round_trip_nearest_home_s.join('–')} s.</p>`; setBadge('pace', null); return; }
  const tB = P.targets.base_to_enemy_base_s, tH = P.targets.harvest_round_trip_nearest_home_s;
  let html = `<h4>Base to enemy base <span class="aside">rally → rally</span></h4><div class="list">`;
  for (const x of R.b2b) {
    const rs = realT(x.game_s);
    html += `<div class="li"><span class="chip ${inT(rs, tB)}">${rs == null ? 'NONE' : inT(rs, tB) === 'PASS' ? 'IN' : rs < tB[0] ? 'FAST' : 'SLOW'}</span><div class="nm">${esc(x.a)} → ${esc(x.b)}<small>${CLASS_NAME[x.cls]}${x.cls !== 'tank' ? ' (no tank route)' : ''}${x.dist ? ' · ' + fmtLen(x.dist) : ''}</small></div><div class="rt"><b>${fmtTime(rs)}</b><br><span class="muted">game ${fmtTime(x.game_s)}</span></div></div>`;
  }
  html += `</div><h4>Harvester round trips <span class="aside">grate → field → grate</span></h4><div class="list">`;
  R.harv.forEach((h, k) => {
    const c = h.cycle, rs = c ? c.real_s : null, home = h.kind === 'home';
    const ch = !c ? 'FAIL' : home ? inT(rs, tH) : 'INFO';
    const leg = c ? `out ${fmtTime(realT(c.legs.out))} · load ${fmtTime(realT(c.legs.load))} · back ${fmtTime(realT(c.legs.back))} · dock ${fmtTime(realT(c.legs.dock))} · unload ${fmtTime(realT(c.legs.unload))} (real); ${fmtLen(c.out_m)} each way` : esc(h.plan.reason || 'no route');
    html += `<div class="li click${PM.focus === k ? ' sel' : ''}" data-k="${k}"><span class="chip ${ch}">${!c ? 'NONE' : home ? (ch === 'PASS' ? 'IN' : rs < tH[0] ? 'FAST' : 'SLOW') : h.kind.slice(0, 4).toUpperCase()}</span>
      <div class="nm">${esc(h.dep)}<small>${home ? 'home' : h.kind} · ${h.unreachable ? 'no harvester route from any refinery (island: transport delivery)' : `from ${esc(h.base)} refinery ${'AB'[h.dock]}`}</small></div><div class="rt"><b>${fmtTime(rs)}</b><br><span class="muted">game ${fmtTime(c && c.game_s)}</span></div><div class="det">${leg}</div></div>`;
  });
  html += `</div><p class="muted sm">Real seconds at game speed ${P.game_speed.toFixed(2)}×. Expansion and contested fields show the nearest base of each team. Click a row to show its route.</p>`;
  out.innerHTML = html;
  const homes = R.harv.filter((h) => h.kind === 'home' && h.cycle).map((h) => h.cycle.real_s);
  if (homes.length) setBadge('pace', `${Math.min(...homes).toFixed(0)}–${Math.max(...homes).toFixed(0)}s`);
  $$('#paceOut .li.click').forEach((el) => el.addEventListener('click', () => {
    const k = +el.dataset.k, h = R.harv[k]; PM.focus = k; el.classList.toggle('open'); $$('#paceOut .li').forEach((x) => x.classList.toggle('sel', x === el));
    disposeTree(G.tests); if (h.plan.found) { G.tests.add(pathLine(h.plan.res, '#d6a24c', 4)); G.tests.add(endpointMarker(h.grate[0], h.grate[1], '#6db67a', 5)); flyToPoints(pathPoints(h.plan.res)); }
  }));
}

const TESTS = { running: false, results: null };
async function runTests() {
  if (!M || TESTS.running) return TESTS.results;
  TESTS.running = true;
  const T = standardTests();
  const prog = $('#testProg'); prog.hidden = false;
  $('#runTests').disabled = true;
  const res = [];
  const t0 = performance.now();
  let lastYield = performance.now();
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    // yield to the page only every ~200 ms of search work: each yield lets a frame render, which is slow on software GL
    if (performance.now() - lastYield > 200) {
      $('#testsAside').textContent = `running ${k + 1}/${T.length}`;
      prog.firstElementChild.style.width = `${(k / T.length) * 100}%`;
      await new Promise((r) => setTimeout(r, 0)); lastYield = performance.now();
    }
    const r = astar(t.cls, t.from, t.to);
    const pass = t.expect === 'route' ? r.found : !r.found;
    res.push({ ...t, result: r, pass });
  }
  if (M.id === '04') {
    const cross = res.filter((x) => x.cls === 'tank' && x.cross);
    const none = cross.every((x) => !x.result.found);
    res.push({ group: 'Sunbreak rule', cls: 'tank', name: 'No tank route between B and R bases', summary: true, pass: none, expect: 'none', result: { found: !none, expanded: Math.max(...cross.map((x) => x.result.expanded || 0)), ms: cross.reduce((s, x) => s + (x.result.ms || 0), 0) }, detail: `${cross.length} B↔R rally pairs searched; ${cross.filter((x) => x.result.found).length} found a route` });
  }
  prog.firstElementChild.style.width = '100%';
  setTimeout(() => { prog.hidden = true; }, 400);
  $('#runTests').disabled = false;
  TESTS.running = false;
  TESTS.results = { map: M.id, at: new Date().toISOString(), ms: performance.now() - t0, tests: res };
  drawTests(); renderTests();
  return TESTS.results;
}
function drawTests() {
  disposeTree(G.tests);
  if (!TESTS.results || TESTS.results.map !== M.id || !$('#showTestPaths').checked) return;
  for (const t of TESTS.results.tests) {
    if (t.summary) continue;
    const r = t.result;
    if (r.found) G.tests.add(pathLine(r, t.pass ? '#6db67a' : '#e0645c', t === TESTS.focus ? 5 : 2.5));
    G.tests.add(endpointMarker(t.from[0], t.from[1], t.pass ? '#6db67a' : '#e0645c', 8));
    if (t.to !== 'edge') G.tests.add(endpointMarker(t.to[0], t.to[1], t.pass ? '#a9d8b2' : '#f0a39c', 5));
  }
}
function renderTests() {
  const out = $('#testsOut'); if (!out) return;
  const R = TESTS.results;
  if (!R || !M || R.map !== M.id) {
    const T = M ? standardTests() : [];
    out.innerHTML = `<p class="muted">Runs this map's ${T.length} standard tests on the baked nav grid: factory rally points (in front of each factory; the base kit is mirrored per start) to every other base by tank, bases to their two home deposits' service points by harvester, dock berths (26 m off the berth side) to the map edge by ship, and landing beaches 120 m offshore to 120 m inland by amphibious.${M && M.id === '04' ? ' On Sunbreak Atoll the B↔R tank pairs must find <b>no</b> route.' : ''}</p>`;
    $('#testsAside').textContent = ''; setBadge('tests', null);
    return;
  }
  const pass = R.tests.filter((t) => t.pass).length, n = R.tests.length;
  let html = `<div class="summary"><span class="chip ${pass === n ? 'PASS' : 'FAIL'}">${pass === n ? 'ALL PASS' : 'FAILURES'}</span><span class="big">${pass}/${n}</span><span class="muted">${fmt(R.ms, 0)} ms total</span></div>`;
  let grp = null;
  html += '<div class="list">';
  R.tests.forEach((t, k) => {
    if (t.group !== grp) { grp = t.group; html += `<h4>${esc(grp)}</h4>`; }
    const r = t.result;
    const res = r.found ? `<b>${fmtLen(r.length)}</b><br>${fmtTime(realT(r.time))}` : t.summary ? '' : 'no route';
    const exp = t.expect === 'none' ? 'expect: no route' : '';
    const det = t.summary ? t.detail : r.found
      ? `snap ${fmt(r.snapStart, 1)} / ${t.to === 'edge' ? 'edge' : fmt(r.snapEnd, 1)} m · ${fmt(r.roadLength ? r.roadLength / r.length * 100 : 0, 0)}% on road-speed cells · ${fmt(r.expanded)} cells · ${fmt(r.ms, 0)} ms`
      : `${esc(r.reason || '')} · ${fmt(r.expanded || 0)} cells expanded · ${fmt(r.ms || 0, 0)} ms`;
    html += `<div class="li click${TESTS.focus === t ? ' sel' : ''}" data-k="${k}"><span class="chip ${t.pass ? 'PASS' : 'FAIL'}">${t.pass ? 'PASS' : 'FAIL'}</span>
      <div class="nm">${esc(t.name)}<small>${CLASS_NAME[t.cls]}${exp ? ' · ' + exp : ''}</small></div><div class="rt">${res}</div><div class="det">${det}</div></div>`;
  });
  html += '</div>';
  out.innerHTML = html;
  $('#testsAside').textContent = `${pass}/${n} pass`;
  setBadge('tests', `${pass}/${n}`);
  $$('#testsOut .li').forEach((el) => el.addEventListener('click', () => {
    const t = R.tests[+el.dataset.k];
    el.classList.toggle('open');
    if (t.summary) return;
    TESTS.focus = t; drawTests();
    $$('#testsOut .li').forEach((x) => x.classList.toggle('sel', x === el));
    flyToPoints(t.result.found ? pathPoints(t.result) : [[...t.from, 0], ...(t.to === 'edge' ? [] : [[...t.to, 0]])]);
  }));
}
function flyToPoints(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ext = Math.max(x1 - x0, y1 - y0, 120);
  const h = ext * 1.25 + 60, z = surfZ(cx, cy);
  setCamera([cx, cy - h * 0.35, z + h], [cx, cy, z], false);
}

// ───────────────────────────── panels ─────────────────────────────
function setBadge(tab, text) { const b = $(`#rTabs button[data-pane="${tab}"] .badge`); if (b) { b.textContent = text ?? ''; b.style.display = text ? '' : 'none'; } }
function renderChecks() {
  const out = $('#checksOut'); if (!out) return;
  const V = M.meta.validation || [], C = M.meta.conflicts || [];
  const cnt = { PASS: 0, WARN: 0, FAIL: 0 }; V.forEach((v) => { cnt[v.status] = (cnt[v.status] || 0) + 1; });
  let html = `<div class="summary"><span class="chip PASS">PASS ${cnt.PASS}</span><span class="chip WARN">WARN ${cnt.WARN}</span><span class="chip FAIL">FAIL ${cnt.FAIL}</span></div>`;
  html += V.length ? '<div class="list">' + V.map((v) => `<div class="li click"><span class="chip ${esc(v.status)}">${esc(v.status)}</span><div class="nm">${esc(v.check)}</div><div class="rt">›</div><div class="det">${esc(v.detail)}</div></div>`).join('') + '</div>'
    : '<p class="note warn">map.json has no validation entries.</p>';
  html += `<h4>Conflicts (${C.length})</h4>` + (C.length ? C.map((c) => `<p class="note warn">${esc(c)}</p>`).join('') : '<p class="muted">None recorded.</p>');
  html += '<p class="muted" style="font-size:11px">These results were computed by maps/gen/navcheck.py on the 2 m source grid and are shown as exported. The lab\'s own route tests run separately on the 4 m nav.u8.</p>';
  out.innerHTML = html;
  setBadge('checks', cnt.FAIL ? `${cnt.FAIL} FAIL` : `${cnt.PASS}`);
  $$('#checksOut .li').forEach((el) => el.addEventListener('click', () => el.classList.toggle('open')));
}
function renderAssets() {
  const out = $('#assetsOut'); if (!out) return;
  const sets = [...M.sets].sort((a, b) => (a.missing === b.missing ? a.name.localeCompare(b.name) : a.missing ? -1 : 1));
  const miss = sets.filter((s) => s.missing), missN = miss.reduce((s, x) => s + x.n, 0);
  let html = `<dl class="kv"><dt>GLBs in manifest</dt><dd>${A.manifestErr ? `<span class="st-miss">manifest.json missing</span>` : A.manifest.size}</dd>
    <dt>Asset types on this map</dt><dd>${sets.length} (${sets.length - miss.length} with GLB)</dd>
    <dt>Instances</dt><dd>${fmt(M.instTotal)} (${fmt(missN)} as stand-ins)</dd>
    <dt>sizes.json</dt><dd>${A.sizesErr ? '<span class="st-miss">missing</span>' : Object.keys(A.sizes).length + ' entries'}</dd></dl>`;
  if (Object.keys(A.failed).length) html += Object.entries(A.failed).map(([k, v]) => `<p class="note fail">${esc(k)}.glb failed to load: ${esc(v)}</p>`).join('');
  html += `<table class="t"><thead><tr><th>Asset</th><th class="r">n</th><th>GLB</th><th class="r">Size m · source</th></tr></thead><tbody>`;
  for (const s of sets) {
    const sz = s.info ? s.info.size.map((v) => fmt(v, v < 10 ? 1 : 0)).join('×') : '?';
    html += `<tr><td class="mono">${esc(s.name)}</td><td class="r num">${fmt(s.n)}</td><td>${s.missing ? (s.procedural ? '<span class="st-warn">procedural deck</span>' : '<span class="st-miss">missing</span>') : `<span class="st-ok">ok</span>${s.proto1 ? ' +LOD1' : ''}`}</td><td class="r num">${sz}<br><span class="dim">${esc(s.info ? s.info.source : 'none')}</span></td></tr>`;
  }
  html += '</tbody></table><h4>Data files</h4><table class="t"><tbody>';
  for (const f of M.files) html += `<tr><td class="mono">${esc(f.name)}</td><td class="r">${f.ok ? `<span class="st-ok">ok</span>${f.bytes != null ? ' · ' + fmt(f.bytes / 1024, 0) + ' KB' : ''}` : `<span class="st-miss">missing (${esc(f.error)})</span>`}</td></tr>`;
  html += '</tbody></table>';
  html += `<p class="muted" style="font-size:11px">Grid: ${M.n}² height/surface samples at ${M.g} m; nav/deck ${M.nn}² cells (cell i spans ${fmt(-M.navOff, 0)}…${fmt(M.g - M.navOff, 0)} m around ${M.g}·i). deck.u8 values: ${M.deck ? [...new Set(M.deck)].sort((a, b) => a - b).join(', ') : 'n/a'} (non-zero = deck).</p>`;
  if (M.notes.length) html += M.notes.map((x) => `<p class="note warn">${esc(x)}</p>`).join('');
  if (M.structNotes && M.structNotes.length) html += '<h4>Structures</h4>' + M.structNotes.map((x) => `<p class="muted mono" style="margin:2px 0">${esc(x)}</p>`).join('');
  if (M.dockProcedural && (M.meta.docks || []).length) html += '<p class="note">Docks are drawn as procedural 80 × 40 m decks (top at deck_z = 3 m) on piles until bld_naval_dock.glb is exported.</p>';
  out.innerHTML = html;
  setBadge('assets', miss.length ? `${miss.length}` : 'ok');
  const ab = $('#rTabs button[data-pane="assets"]'); if (ab) ab.title = miss.length ? `${miss.length} asset types on this map have no GLB yet` : 'all GLBs present';
}

// ───────────────────────────── static UI ─────────────────────────────
function buildStaticUI() {
  $('#mapTabs').innerHTML = A.maps.map((m) => `<button data-id="${esc(m.id)}" title="${esc(m.name)} · ${m.size_m} m · ${esc(m.mode)}"><span class="id">${esc(m.id)}</span>${esc(m.name)}</button>`).join('');
  $$('#mapTabs button').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.dataset.id; }));
  $('#mapSelect').innerHTML = A.maps.map((m) => `<option value="${esc(m.id)}">${esc(m.id)} ${esc(m.name)}</option>`).join('');
  $('#mapSelect').addEventListener('change', (e) => { location.hash = '#' + e.target.value; });
  $('#presetBtns').innerHTML = PRESETS.map((p) => `<button class="btn" data-key="${p.key}">${esc(p.name)}<small>${esc(p.scale)}</small></button>`).join('');
  $$('#presetBtns .btn').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.key)));
  $('#overlayList').innerHTML = OVERLAYS.map((o) => `<label class="tg"><input type="checkbox" data-ov="${o.key}"${S.ov[o.key] ? ' checked' : ''}><span class="box"></span><span class="t">${esc(o.label)}<small>${esc(o.hint)}</small></span><span class="sw" style="background:${o.sw}"></span></label>`).join('');
  $$('#overlayList input').forEach((i) => i.addEventListener('change', () => setOverlay(i.dataset.ov, i.checked)));
  $$('#qualitySeg button').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.q)));
  $('#optMissing').checked = S.showMissing;
  $('#optMissing').addEventListener('change', (e) => { S.showMissing = e.target.checked; if (M) M.instDirty = true; saveUI(); });
  $('#optDots').checked = S.dots;
  $('#optDots').addEventListener('change', (e) => { S.dots = e.target.checked; saveUI(); });
  $('#classSeg').innerHTML = CLASSES.map((c) => `<button data-c="${c}">${CLASS_NAME[c]}</button>`).join('');
  $$('#classSeg button').forEach((b) => b.addEventListener('click', () => setClass(b.dataset.c)));
  setClass(S.cls, true);
  $('#navFollow').checked = S.ov.nav;
  $('#navFollow').addEventListener('change', (e) => setOverlay('nav', e.target.checked));
  $('#routeTool').addEventListener('click', () => setTool(S.tool === 'route' ? 'select' : 'route'));
  $('#routeClear').addEventListener('click', () => { routeState.start = routeState.end = routeState.result = null; stopAnim(); drawRoute(); renderRouteOut(); });
  $('#runTests').addEventListener('click', () => runTests());
  $('#showTestPaths').addEventListener('change', drawTests);
  const tabs = [['move', 'Move'], ['tests', 'Tests'], ['pace', 'Pace'], ['inspect', 'Inspect'], ['checks', 'Checks'], ['assets', 'Assets']];
  $('#rTabs').innerHTML = tabs.map(([k, t]) => `<button data-pane="${k}">${t}<span class="badge" style="display:none"></span></button>`).join('');
  $$('#rTabs button').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.pane)));
  const all = [['views', 'Views'], ['layers', 'Layers'], ...tabs];
  $('#drawerBar').innerHTML = all.map(([k, t]) => `<button data-pane="${k}">${t}</button>`).join('');
  $$('#drawerBar button').forEach((b) => b.addEventListener('click', () => toggleDrawer(b.dataset.pane)));
  $('#hud').addEventListener('click', () => { $('#hud').classList.toggle('min'); S.hudToggled = true; updateHUD(); });
  buildPaceUI();
  showPane('move');
  syncQualityUI();
}
function setClass(c, quiet) {
  S.cls = c; saveUI();
  $$('#classSeg button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
  if (M && M.meta.nav_bits) U.uNavBit.value = S.ov.nav ? M.meta.nav_bits[c] : 0;
  if (!quiet) { renderClassInfo(); if (routeState.start && routeState.end) { routeState.result = astar(c, routeState.start, routeState.end); stopAnim(); drawRoute(); renderRouteOut(); } }
}
function setTool(t) {
  S.tool = t; canvas.classList.toggle('route-tool', t === 'route');
  $('#routeTool').classList.toggle('on', t === 'route');
  $('#routeTool').textContent = t === 'route' ? 'Route tool on (click map)' : 'Pick start & end';
  renderRouteOut();
}
// ───────────────────────────── minimap ─────────────────────────────
// Top-down map (surface classes, water depth), pads, deposits, radar reveal, harvester routes, and the camera's ground footprint.
// Click or drag to move the camera over that point (same distance and angle).
const MM = { cv: $('#minimap'), base: null, drag: false, t: 0, ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit: new THREE.Vector3() };
const SURF_RGB = { 0: [92, 122, 60], 1: [108, 136, 68], 2: [126, 108, 80], 3: [214, 200, 158], 4: [128, 124, 116], 5: [168, 168, 164], 6: [150, 138, 120],
  7: [64, 66, 70], 8: [98, 84, 62], 9: [124, 132, 72], 10: [120, 100, 76], 11: [52, 84, 46], 12: [170, 156, 118], 13: [158, 98, 60] };
function buildMinimap() {
  if (!MM.cv || !M) return;
  const W = 256, off = document.createElement('canvas'); off.width = off.height = W;
  const ctx = off.getContext('2d'), img = ctx.createImageData(W, W);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const x = (px + 0.5) / W * M.S, y = (1 - (py + 0.5) / W) * M.S, h = hAt(x, y), k = (py * W + px) * 4;
    let c;
    if (h <= 0 && !(M.deck && M.deck[cellOf(x, y)])) { const d = Math.min(-h / 18, 1); c = [44 - 26 * d, 112 - 62 * d, 138 - 48 * d]; }
    else { const sc = M.surf ? surfAt(x, y) : 0, sh = 0.82 + Math.min(Math.max(h, 0), 50) / 160; c = (SURF_RGB[sc] || SURF_RGB[0]).map((v) => v * sh); }
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tp = (x, y) => [x / M.S * W, (1 - y / M.S) * W], meta = M.meta;
  ctx.lineWidth = 1.5;
  for (const r of meta.routes || []) { ctx.strokeStyle = 'rgba(244,201,93,0.9)'; ctx.setLineDash([3, 2]); ctx.beginPath(); r.pts.forEach((q, k) => { const [a, b] = tp(...q); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke(); }
  ctx.setLineDash([]);
  for (const l of meta.landmarks || []) if (l.role === 'capturable') { const [a, b] = tp(...l.center); ctx.strokeStyle = '#b388ff'; ctx.beginPath(); ctx.arc(a, b, 220 / M.S * W, 0, Math.PI * 2); ctx.stroke(); }
  for (const p of meta.pads || []) { const [a, b] = tp(...p.center), s = p.size[0] / M.S * W; ctx.strokeStyle = p.team === 'R' ? '#e05252' : '#4f8ff7'; ctx.lineWidth = 2; ctx.strokeRect(a - s / 2, b - s / 2, s, s); }
  for (const d of meta.deposits || []) { const [a, b] = tp(...d.pos); ctx.fillStyle = '#f4c95d'; ctx.fillRect(a - 2, b - 2, 4, 4); }
  MM.base = off;
  const dpr = Math.min(devicePixelRatio || 1, 2), r = MM.cv.getBoundingClientRect();
  MM.cv.width = Math.round((r.width || 184) * dpr); MM.cv.height = Math.round((r.height || 184) * dpr);
  drawMinimap();
}
function camFootprint() { // camera view corners on the ground plane at the target height (world x, y)
  MM.plane.constant = -controls.target.y; const out = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    MM.ray.setFromCamera({ x: u, y: v }, camera);
    const p = MM.ray.ray.intersectPlane(MM.plane, MM.hit) ? MM.hit : MM.ray.ray.at(6000, MM.hit);
    out.push([p.x, -p.z]);
  }
  return out;
}
function drawMinimap() {
  if (!MM.base || !MM.cv.width) return;
  const ctx = MM.cv.getContext('2d'), W = MM.cv.width, tp = (x, y) => [x / M.S * W, (1 - y / M.S) * W];
  ctx.imageSmoothingEnabled = true; ctx.drawImage(MM.base, 0, 0, W, W);
  const fp = camFootprint().map((q) => tp(...q));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1.2, W / 140);
  ctx.beginPath(); fp.forEach(([a, b], k) => (k ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill(); ctx.stroke();
  const [tx, ty] = tp(controls.target.x, -controls.target.z); ctx.fillStyle = '#d6a24c'; ctx.beginPath(); ctx.arc(tx, ty, Math.max(2.5, W / 70), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function minimapGo(e) {
  if (!M || !M.ready) return;
  const r = MM.cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * M.S, y = (1 - (e.clientY - r.top) / r.height) * M.S;
  const d = new THREE.Vector3(x - controls.target.x, surfZ(x, y) - controls.target.y, -y - controls.target.z);
  tween = null; camera.position.add(d); controls.target.add(d); resetControls(); drawMinimap();
}
if (MM.cv) {
  MM.cv.addEventListener('pointerdown', (e) => { MM.drag = true; MM.cv.setPointerCapture(e.pointerId); minimapGo(e); e.preventDefault(); });
  MM.cv.addEventListener('pointermove', (e) => { if (MM.drag) minimapGo(e); });
  MM.cv.addEventListener('pointerup', () => { MM.drag = false; });
  addEventListener('resize', () => { if (M && M.ready) buildMinimap(); });
}

function setOverlay(k, v) {
  S.ov[k] = v; saveUI();
  const i = $(`#overlayList input[data-ov="${k}"]`); if (i) i.checked = v;
  if (k === 'nav') $('#navFollow').checked = v;
  applyOverlayState();
}
function applyOverlayState() {
  U.uGridOn.value = S.ov.grid ? 1 : 0; U.uHeightOn.value = S.ov.height ? 1 : 0; U.uDepthOn.value = S.ov.depth ? 1 : 0;
  U.uNavBit.value = S.ov.nav && M && M.meta.nav_bits ? M.meta.nav_bits[S.cls] : 0;
  for (const o of OVERLAYS) OVG[o.key].visible = !!S.ov[o.key];
  if (S.ov.bounds && M && M.ready) rebuildBounds();
}
function setQuality(q) { S.quality = q; saveUI(); syncQualityUI(); applyQuality(true); }
function syncQualityUI() {
  $$('#qualitySeg button').forEach((b) => b.classList.toggle('on', b.dataset.q === S.quality));
  $('#qualityNote').textContent = QUALITY[S.quality].note;
}
function applyQuality(rebuildMats) {
  const q = QUALITY[S.quality];
  renderer.setPixelRatio(q.pr());
  renderer.setSize(innerWidth, innerHeight, false);
  const wasShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = q.shadows;
  if (q.shadows) { sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (rebuildMats && wasShadow !== q.shadows) scene.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; ms.forEach((m) => { m.needsUpdate = true; }); });
  if (M && M.terrainLods) for (const lod of M.terrainLods) { lod.levels[1].distance = q.terrLod[0]; lod.levels[2].distance = q.terrLod[1]; }
  if (M && M.sets) { for (const s of M.sets) s.setShadows(q); M.instDirty = true; }
  resizeLines();
}

// layout: desktop columns vs. mobile drawer
const mq = matchMedia('(max-width: 699px)');
const isMobile = () => mq.matches;
const homes = {};
function layout() {
  const panes = $$('.pane[data-pane]');
  for (const p of panes) if (!homes[p.dataset.pane]) homes[p.dataset.pane] = p.parentElement;
  if (isMobile()) {
    for (const p of panes) { $('#drawer').appendChild(p); p.hidden = p.dataset.pane !== S.drawer; }
    $('#drawer').classList.toggle('open', !!S.drawer);
    document.body.appendChild($('#hud'));
    if (!S.hudToggled) $('#hud').classList.add('min'); // narrow screens start with the compact HUD
  } else {
    for (const p of panes) homes[p.dataset.pane].appendChild(p);
    $('#colR').appendChild($('#hud'));
    $('#drawer').classList.remove('open');
    showPane(S.rTab);
    for (const k of ['views', 'layers']) $(`.pane[data-pane="${k}"]`).hidden = false;
  }
  $$('#drawerBar button').forEach((b) => b.classList.toggle('on', b.dataset.pane === S.drawer));
  onResize();
}
mq.addEventListener('change', layout);
function showPane(k) {
  if (isMobile()) { if (S.drawer && S.drawer !== k) toggleDrawer(k, true); return; }
  if (['views', 'layers'].includes(k)) return;
  S.rTab = k;
  for (const p of $$('#rBody .pane')) p.hidden = p.dataset.pane !== k;
  $$('#rTabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === k));
}
function toggleDrawer(k, force) {
  S.drawer = force ? k : S.drawer === k ? null : k;
  for (const p of $$('#drawer .pane')) p.hidden = p.dataset.pane !== S.drawer;
  $('#drawer').classList.toggle('open', !!S.drawer);
  $$('#drawerBar button').forEach((b) => b.classList.toggle('on', b.dataset.pane === S.drawer));
}

// ───────────────────────────── input ─────────────────────────────
const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys[k] = true; tween = null; e.preventDefault(); }
  if (k === 'escape') setTool('select');
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let down = null, hoverPx = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button, id: e.pointerId }; tween = null; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t, b = down.b; down = null;
  if (moved > 6 || dt > 600 || b !== 0 || !M || !M.ready) return;
  onClick(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => { hoverPx = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerleave', () => { hoverPx = null; $('#hover').style.display = 'none'; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function onClick(px, py) {
  const ray = rayAt(px, py);
  if (S.tool === 'route') { const p = pickGround(ray); if (p) routeClick(p); return; }
  const dot = isStrategic() ? pickDot(px, py) : null;
  if (dot) { select(dot); return; }
  const hit = pickInstance(ray), gp = pickGround(ray);
  if (hit && (!gp || hit.t <= gp.t + 0.5)) select(hit);
  else if (gp) select(null, gp);
}
function isStrategic() { return camera.position.distanceTo(controls.target) > 700; }

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  applyViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  resizeLines();
}
function resizeLines() { for (const m of LINE_MATS) m.resolution.set(innerWidth, innerHeight); }
addEventListener('resize', onResize);

// ───────────────────────────── per-frame updates ─────────────────────────────
const _v = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function applyKeys(dt) {
  const k = keys;
  const fwd = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0), side = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0), rot = (k.q ? 1 : 0) - (k.e ? 1 : 0);
  if (!fwd && !side && !rot) return;
  const dist = camera.position.distanceTo(controls.target);
  if (fwd || side) {
    camera.getWorldDirection(_fwd); _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize(); _right.crossVectors(_fwd, UP).normalize();
    _v.set(0, 0, 0).addScaledVector(_fwd, fwd).addScaledVector(_right, side).multiplyScalar(Math.max(dist, 25) * 0.9 * dt);
    camera.position.add(_v); controls.target.add(_v);
  }
  if (rot) { _v.subVectors(camera.position, controls.target).applyAxisAngle(UP, rot * 1.3 * dt); camera.position.copy(controls.target).add(_v); }
}
let nearSet = 0;
function updateCamPlanes() {
  if (!M) return;
  const wx = camera.position.x, wy = -camera.position.z;
  const ground = wx >= 0 && wy >= 0 && wx <= M.S && wy <= M.S ? surfZ(wx, wy) : 0;
  const hag = Math.max(camera.position.y - ground, 0.3);
  const near = clamp(hag * 0.2, 0.15, 30);
  if (Math.abs(near - nearSet) / Math.max(nearSet, 1e-3) > 0.08) { camera.near = near; camera.far = 40000; camera.updateProjectionMatrix(); nearSet = near; }
  const dist = camera.position.distanceTo(controls.target);
  scene.fog.near = Math.max(1600, dist * 1.6); scene.fog.far = scene.fog.near + 9000;
  M.hag = hag; M.dist = dist;
}
function updateSun() {
  if (!M) return;
  const q = QUALITY[S.quality], dist = M.dist || 1000;
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(M.sunDir, 2500);
  const want = q.shadows && dist < 1400;
  if (sun.castShadow !== want) sun.castShadow = want;
  if (want) {
    const half = clamp(dist * 0.9, 60, 450), c = sun.shadow.camera;
    if (Math.abs(c.right - half) > half * 0.1) { c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 100; c.far = 5200; c.updateProjectionMatrix(); }
  }
}
function scaleClass(dist) { return dist > 700 ? ['strategic overview', ''] : dist > 140 ? ['gameplay scale', 'gameplay'] : ['close-up', 'close']; }
function updateCamChip() {
  if (!M) return;
  const [txt, cls] = scaleClass(M.dist);
  const tilt = THREE.MathUtils.radToDeg(Math.acos(clamp(-camera.getWorldDirection(_v).y, -1, 1)));
  const tool = S.tool === 'route' ? `<span class="tool">· route tool: click ${!routeState.start || routeState.end ? 'start' : 'end'}</span>` : '';
  $('#camchip').innerHTML = `<span class="scale ${cls}">${txt}</span><span class="num">alt ${fmt(M.hag, M.hag < 20 ? 1 : 0)} m · range ${fmt(M.dist, 0)} m · ${fmt(tilt, 0)}° from vertical</span>${tool}`;
  $('#needle').setAttribute('transform', `rotate(${THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()).toFixed(1)})`);
}
function updateScaleBar() {
  const el = $('#scalebar');
  if (!M) { el.innerHTML = ''; return; }
  const tilt = THREE.MathUtils.radToDeg(Math.acos(clamp(-camera.getWorldDirection(_v).y, -1, 1)));
  if (tilt > 45) { el.innerHTML = `<div class="warn">Scale bar hidden: view is ${tilt.toFixed(0)}° from vertical (limit 45°), so the ground scale varies too much across the screen.</div>`; return; }
  const f = freeRect(), cx = (f.l + f.r) / 2;
  // measured at the bottom-centre (just above the bar); if that misses the map (zoomed out, portrait), at the view centre
  let where = 'bottom-centre', a = null, b = null;
  for (const [y, w] of [[f.b - (isMobile() ? 70 : 74), 'bottom-centre'], [(f.t + f.b) / 2, 'view centre']]) {
    a = pickGround(rayAt(cx - 50, y)); b = pickGround(rayAt(cx + 50, y)); where = w;
    if (a && b) break;
  }
  if (!a || !b) { el.innerHTML = '<div class="warn">Scale bar hidden: the view does not show the map ground.</div>'; return; }
  const mpp = Math.hypot(a.x - b.x, a.y - b.y) / 100;
  let best = null;
  for (let e = -1; e <= 5; e++) for (const m of [1, 2, 5]) { const L = m * 10 ** e, px = L / mpp; if (px >= 70 && px <= 190) best = best && Math.abs(best.px - 120) < Math.abs(px - 120) ? best : { L, px }; }
  if (!best) { el.innerHTML = ''; return; }
  const lab = best.L >= 1000 ? `${best.L / 1000} km` : `${best.L} m`;
  el.innerHTML = `<div class="bar" style="width:${best.px.toFixed(1)}px"></div>${lab}<div class="hint">ground scale at ${where} · ${mpp < 1 ? (mpp * 100).toFixed(1) + ' cm' : mpp.toFixed(2) + ' m'}/px</div>`;
  M.mpp = mpp;
}
function updateHover() {
  const el = $('#hover');
  if (!hoverPx || !M || !M.ready || isMobile()) { el.style.display = 'none'; return; }
  const p = pickGround(rayAt(...hoverPx));
  if (!p) { el.style.display = 'none'; return; }
  const c = cellOf(p.x, p.y), bits = M.nav ? M.nav[c] : null, sc = M.surf ? surfAt(p.x, p.y) : null;
  const passable = bits == null ? 'nav missing' : CLASSES.filter((k) => bits & M.meta.nav_bits[k]).map((k) => k.slice(0, 4)).join(' ') || 'none';
  el.innerHTML = `<b>${fmt(p.x, 1)}</b> E <b>${fmt(p.y, 1)}</b> N · z <b>${fmt(p.z, 2)}</b> m · ${esc(sc == null ? 'surface ?' : SURF_NAME[sc] ?? sc)}${M.deck && M.deck[c] ? ' · deck' : ''} · nav: ${passable}`;
  el.style.display = 'block';
}
const perf = { frames: 0, t0: performance.now(), fps: 0, frameMs: 0, renderMs: [], lastFrame: [] };
function updateHUD() {
  const info = renderer.info, el = $('#hud');
  const q = QUALITY[S.quality];
  const rs = perf.renderMs.length ? perf.renderMs.reduce((s, x) => s + x, 0) / perf.renderMs.length : 0;
  el.innerHTML = `<div class="hh">Performance<span>measured · ${el.classList.contains('min') ? '+' : '−'}</span></div>
    <div><b>${fmt(perf.fps, 1)}</b> fps · frame <b>${fmt(perf.frameMs, 1)}</b> ms <span class="dim">(render call ${fmt(rs, 1)} ms CPU)</span></div>
    <div>draw calls <b>${fmt(info.render.calls)}</b> · tris <b>${fmt(info.render.triangles / 1e6, 2)}</b> M${info.render.lines ? ` · lines ${fmt(info.render.lines)}` : ''}</div>
    <div>instances <b>${fmt(M ? M.instDrawn : 0)}</b> / ${fmt(M ? M.instTotal : 0)} drawn${M && M.instLod1 ? ` · LOD1 ${fmt(M.instLod1)}` : ''}</div>
    <div class="more">geometries ${fmt(info.memory.geometries)} · textures ${fmt(info.memory.textures)} · programs ${fmt(info.programs ? info.programs.length : 0)}</div>
    <div class="more">${S.quality} · pixel ratio ${renderer.getPixelRatio().toFixed(2)} · ${canvas.width}×${canvas.height} · MSAA ${AA.on ? 'on' : 'off (' + AA.why + ')'} · shadows ${sun.castShadow ? 'on' : 'off'}</div>
    <div class="more gpu">${GPU.software ? '<span class="sw">software GPU · </span>' : ''}${esc(GPU.renderer)}${GPU.masked ? ' (unmasked string unavailable)' : ''}</div>`;
}

const frameWaiters = [];
function settle(n = 3) { if (M) M.instDirty = true; return new Promise((r) => frameWaiters.push({ n, r })); }
let lastT = performance.now(), slowT = 0, hudT = 0, loopErrors = 0;
renderer.setAnimationLoop((now) => {
  // an exception here would stop three's animation loop for good, so it is caught and reported instead
  try { frame(now); } catch (e) { if (loopErrors++ < 5) console.error('Map Lab frame error:', e); }
});
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.25); lastT = now;
  const live = !!(M && M.ready);
  perf.lastFrame.push(dt * 1000); if (perf.lastFrame.length > 240) perf.lastFrame.shift();
  if (tween) {
    const u = clamp((now - tween.t0) / tween.dur, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0v, tween.t1, e);
    if (u >= 1) { tween = null; resetControls(); }
  }
  applyKeys(dt);
  if (!tween) controls.update();
  else camera.lookAt(controls.target);
  sky.position.copy(camera.position);
  if (live) {
    updateCamPlanes();
    updateSun();
    updateInstances(false);
    const strat = isStrategic();
    if (M.dots) { M.dots.pts.visible = strat && S.dots; M.dots.mat.uniforms.uSize.value = 7 * renderer.getPixelRatio(); }
    for (const o of OVG.starts.children) if (o.userData.strategicOnly) o.visible = strat;
    stepAnim(dt);
  }
  U.uTime.value = now / 1000;
  const t0 = performance.now();
  renderer.render(scene, camera);
  perf.renderMs.push(performance.now() - t0); if (perf.renderMs.length > 60) perf.renderMs.shift();
  labels.update();
  perf.frames++;
  if (now - perf.t0 >= 1000) { perf.fps = perf.frames * 1000 / (now - perf.t0); perf.frameMs = (now - perf.t0) / perf.frames; perf.frames = 0; perf.t0 = now; }
  if (live && now - slowT > 220) { slowT = now; updateCamChip(); updateScaleBar(); updateHover(); drawMinimap(); }
  if (now - hudT > 500) { hudT = now; updateHUD(); }
  for (let k = frameWaiters.length - 1; k >= 0; k--) { if (--frameWaiters[k].n <= 0) { frameWaiters[k].r(); frameWaiters.splice(k, 1); } }
}

// ───────────────────────────── test / automation hooks ─────────────────────────────
let readyId = null; const readyWaiters = [];
function setReadyState(id) { readyId = id; if (id) for (const w of readyWaiters.splice(0)) if (w.id === id) w.r(); }
async function measure(ms = 3000) {
  await settle(2);
  const times = [], rms0 = perf.renderMs.length;
  let last = null; const t0 = performance.now();
  await new Promise((res) => { const f = (t) => { if (last !== null) times.push(t - last); last = t; if (t - t0 < ms || times.length < 3) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const info = renderer.info, sorted = [...times].sort((a, b) => a - b), avg = times.reduce((s, x) => s + x, 0) / times.length;
  const rms = perf.renderMs.slice(-Math.min(times.length, 60));
  return {
    preset: S.preset, quality: S.quality, frames: times.length, fps: 1000 / avg, frame_ms_avg: avg, frame_ms_p95: sorted[Math.floor(sorted.length * 0.95)] ?? avg,
    render_call_cpu_ms_avg: rms.reduce((s, x) => s + x, 0) / Math.max(rms.length, 1),
    draw_calls: info.render.calls, triangles: info.render.triangles, lines: info.render.lines, points: info.render.points,
    geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null,
    instances_drawn: M.instDrawn, instances_total: M.instTotal, instances_lod1: M.instLod1, terrain_chunks: M.nChunks,
    shadows: sun.castShadow, msaa: AA.on, pixel_ratio: renderer.getPixelRatio(), canvas: [canvas.width, canvas.height],
    camera: { altitude_m: M.hag, range_m: M.dist }, gpu: GPU.renderer, gpu_vendor: GPU.vendor, software_gpu: GPU.software, js_heap_mb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    _rms0: rms0,
  };
}
window.__lab = {
  gpu: GPU,
  get readyId() { return readyId; },
  ready: (id) => (readyId === id ? Promise.resolve() : new Promise((r) => readyWaiters.push({ id, r }))),
  loadMap: (id) => { location.hash = '#' + id; return window.__lab.ready(id); },
  setPreset: (k) => { applyPreset(k, true); return settle(2); },
  setQuality: (q) => { setQuality(q); return settle(3); },
  setOverlay: (k, v) => { setOverlay(k, v); return settle(2); },
  setClass: (c) => setClass(c),
  settle, measure,
  runRouteTests: async () => {
    const r = await runTests();
    return { map: r.map, ms: r.ms, tests: r.tests.map((t) => ({ group: t.group, name: t.name, cls: t.cls, expect: t.expect, pass: t.pass, found: t.result.found, length_m: t.result.length ?? null, time_s: t.result.time ?? null, snap_start_m: t.result.snapStart ?? null, snap_end_m: t.result.snapEnd ?? null, expanded: t.result.expanded ?? null, ms: t.result.ms ?? null, reason: t.result.reason || t.detail || null })) };
  },
  pace: () => ({ ...structuredClone(P), file: structuredClone(PACE_FILE) }),
  setPace: (o) => { if (o.game_speed != null) P.game_speed = o.game_speed; if (o.harvester_speed_ratio != null) P.harvester_speed_ratio = o.harvester_speed_ratio; if (o.load_s != null) P.harvester.load_s = o.load_s; if (o.unload_s != null) P.harvester.unload_s = o.unload_s; buildPaceUI(); repace(); return PM.res; },
  measurePace: async () => { const R = await measurePace(); return R && { map: R.map, game_speed: R.game_speed, harvester_ratio: R.harvester_ratio, harvester_mps: R.harvester_mps,
    harv: R.harv.map((h) => ({ dep: h.dep, kind: h.kind, base: h.base, unreachable: !!h.unreachable, team: h.team, dock: 'AB'[h.dock], found: !!h.cycle, real_s: h.cycle ? h.cycle.real_s : null, game_s: h.cycle ? h.cycle.game_s : null, legs: h.cycle ? h.cycle.legs : null, out_m: h.cycle ? h.cycle.out_m : null, pivots: h.cycle ? h.cycle.pivots : null, timedOut: h.cycle ? h.cycle.timedOut : null, grid_out_s: h.plan.found ? h.plan.gridTime : null })),
    b2b: R.b2b.map((x) => ({ a: x.a, b: x.b, cls: x.cls, found: x.game_s != null, real_s: realT(x.game_s), game_s: x.game_s, grid_s: x.grid_s ?? null, dist_m: x.dist ?? null })) }; },
  route: (cls, from, to) => { const r = astar(cls, from, to); return { found: r.found, length_m: r.length ?? null, time_s: r.time ?? null, reason: r.reason || null }; },
  showTestPaths: (v) => { $('#showTestPaths').checked = v; drawTests(); return settle(1); },
  // screen position (CSS px) of a world point, and of the nearest drawn instance of an asset to the view centre
  screenOf: (x, y, z) => { const v = w2t(x, y, z).project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, visible: v.z > -1 && v.z < 1 }; },
  drawnInstance: (name) => {
    const set = M.sets.find((s) => s.name === name); if (!set) return null;
    let best = null; // the on-screen instance nearest the camera (least likely to be occluded)
    for (const L of set.levels) for (let k = 0; k < L.count; k++) {
      const i = L.idx[k], p = new THREE.Vector3(set.X[i], set.Z[i] + set.lbox.max.y * 0.5, -set.Y[i]), d = p.distanceTo(camera.position), v = p.project(camera);
      const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight, f = freeRect();
      if (x > f.l + 10 && x < f.r - 10 && y > f.t + 10 && y < f.b - 10 && v.z < 1 && (!best || d < best.d)) best = { d, i, x, y };
    }
    return best;
  },
  state: () => ({ map: M && M.id, preset: S.preset, quality: S.quality, overlays: { ...S.ov }, missing: M ? M.sets.filter((s) => s.missing).map((s) => s.name) : [], glbs: M ? M.sets.filter((s) => !s.missing).map((s) => s.name) : [] }),
};

boot().catch((e) => { console.error(e); fatal(`Unexpected error while starting: <span class="mono">${esc(e.message || e)}</span>`); });
