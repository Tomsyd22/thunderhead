// Thunderhead game client — map renderer: terrain, boundary walls, water, roads / bridges / trestles, instanced props,
// vegetation and rocks with distance culling and tree LOD swap, and a top-down minimap base image.
// The look is the Map Lab's (maps/lab/lab.js), which is the approved one; this module only adds to the scene it is given.
//
// Ported from maps/lab/lab.js:
//   PAL / WATER / QUALITY tables 50–70 · hemisphere + sun + room environment + fog + sky 157–181 (→ addMapLighting)
//   shared uniforms + GLSL helpers 188–227 · terrain material 229–282 · road material 285–319 · water material 321–366
//   wall / concrete materials 368–370 · setupBiome 572–588 · buildTextures 645–655 · buildTerrain + chunkGeo 658–725
//   buildWalls 726–751 · buildWater 752–759 · ribbonGeo / runsOf / buildRoads 762–810 · boxGeo / cylGeo /
//   buildStructures 811–878 · makeProto / catOf 1071–1106 · InstSet + updateInstances 1120–1234 · minimap base 2055–2076
//   applyQuality 2131–2142 · updateCamPlanes (fog) + updateSun 2241–2263.
// Glb loading follows units/sandbox/app.js loadGltfJson (77–91): the .gltf.json files embed their buffer as base64, which
// is rebuilt into an in-memory GLB and parsed, because strict content-security policies refuse data: fetches.
//
// Not ported (Lab inspection tooling): overlays drawn as lines/labels, unit dots, picking, route tests, missing-asset
// stand-in boxes (assets without a GLB are skipped and listed in stats().assets.missing).

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LAYER_TILE, LAYER_ORGANIC, generateTerrainDataAsync, makeTerrainTextures, neutralTerrainTextures } from './terraintex.js';

export const TEAM_HEX = { 1: '#2B6FD6', 2: '#C8322B' };
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
const pal = (T) => PAL[T.id] || PAL['01'];
const wat = (T) => WATER[T.id] || WATER['01'];

/**
 * Quality presets (lab.js QUALITY). Map-side values (terrLod, dist, lod1, tree shadows) are applied by setQuality();
 * renderer-side values are hints for the game, which owns the renderer:
 *   pixelRatio(devicePixelRatio), shadows (renderer.shadowMap.enabled), shadowMapSize (sun shadow map, see addMapLighting).
 * texRes: terrain detail texture tile resolution (px, fixed at build time); terrainHQ: two-scale texture sampling, per-pixel
 * relief normals and triplanar cliff rock; aniso: max anisotropic filtering of the terrain textures.
 * dist: per-category cull distance (m); lod1: distance (m) beyond which trees use their _lod1 mesh; terrLod: distances (m)
 * at which terrain chunks switch to every 2nd / 4th vertex.
 */
export const MAP_QUALITY = {
  low: { pixelRatio: (dpr) => Math.min(dpr, 1) * 0.75, shadows: false, shadowMapSize: 0, texRes: 256, terrainHQ: false, aniso: 2, terrLod: [200, 600], dist: { tree: 5000, smallveg: 220, rock: 700, smallprop: 300, struct: 1e9 }, lod1: 160 },
  medium: { pixelRatio: (dpr) => Math.min(dpr, 1.5), shadows: true, shadowMapSize: 2048, texRes: 256, terrainHQ: true, aniso: 4, terrLod: [400, 1100], dist: { tree: 7000, smallveg: 450, rock: 1400, smallprop: 700, struct: 1e9 }, lod1: 320 },
  high: { pixelRatio: (dpr) => Math.min(dpr, 2), shadows: true, shadowMapSize: 4096, texRes: 512, terrainHQ: true, aniso: 8, terrLod: [900, 2400], dist: { tree: 12000, smallveg: 900, rock: 3000, smallprop: 1400, struct: 1e9 }, lod1: 600 },
};
const qOf = (name) => MAP_QUALITY[name] || MAP_QUALITY.medium;

/** Unit vector toward the sun in three.js axes, from the biome's (elevation, azimuth) (lab.js setupBiome). */
export function mapSunDir(THREE, T) {
  const [el, az] = pal(T).sun.map((d) => THREE.MathUtils.degToRad(d));
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

// ───────────────────────────── lighting, environment, fog, sky (optional helper for the game) ─────────────────────────────
/**
 * Adds the Map Lab's lighting to `scene`: hemisphere light, sun (directional, shadow-capable), a room-environment map as
 * scene.environment (the asset materials' reflections), distance fog as scene.fog and the gradient sky dome.
 * The Lab's look also assumes renderer.toneMapping = ACESFilmicToneMapping, toneMappingExposure = 1, outputColorSpace =
 * SRGBColorSpace and shadowMap.type = PCFSoftShadowMap; the game sets those (this helper does not touch the renderer).
 * Returns { sun, hemi, sky, sunDir, update(camera, target?), setQuality(name), dispose() }.
 *   update: call once per frame; target (three.js Vector3) is the point the camera looks at (e.g. controls.target) —
 *   the sun's shadow camera is centred there and sized from the camera distance. Without it the view ray's hit on the
 *   water plane is used.
 */
export function addMapLighting(THREE, scene, renderer, T, { quality = 'medium' } = {}) {
  const hemi = new THREE.HemisphereLight(0xd3e2ee, 0x564b3a, 1.15);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
  hemi.name = 'map_hemi'; sun.name = 'map_sun';
  scene.add(hemi, sun, sun.target);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  pmrem.dispose(); room.dispose?.();
  const prevEnv = scene.environment, prevFog = scene.fog;
  scene.environment = envRT.texture;
  const HAZE = new THREE.Color(0.52, 0.62, 0.70);
  scene.fog = new THREE.Fog(HAZE, 2000, 9000);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(0.16, 0.30, 0.52) }, uHorizon: { value: HAZE.clone() }, uBottom: { value: new THREE.Color(0.018, 0.022, 0.027) } },
    // pinned to the far plane (z = w · 0.9999), so it works with any camera.far
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.9999; }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; varying vec3 vDir;
      void main() { float y = normalize(vDir).y; vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, y), 0.75)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.06, y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  }));
  sky.name = 'map_sky'; sky.renderOrder = -1000; sky.frustumCulled = false;
  scene.add(sky);
  const sunDir = mapSunDir(THREE, T);
  let q = qOf(quality);
  function setQuality(name) {
    q = qOf(name);
    if (q.shadows) { sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    else sun.castShadow = false;
  }
  setQuality(quality);
  const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(T.waterLevel || 0)), _ray = new THREE.Ray();
  // light-space basis of the shadow camera (it looks from the sun at its target with up = +Y): right, up, toward-sun
  const _lr = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize(), _lu = new THREE.Vector3().crossVectors(sunDir, _lr).normalize();
  const _g = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1]];
  const fit = { half: [0, 0], center: [0, 0], texel: 0 };
  /**
   * Fit the sun's shadow camera to the ground the camera sees (the view frustum's footprint on the plane through the
   * focus, plus a margin for casters outside it), in light space. The box size is quantised in 6 % steps and its centre
   * snapped to whole shadow-map texels, so panning does not make shadow edges crawl. Returns false when nothing fits.
   */
  function fitShadow(camera, target, dist) {
    _g.constant = -target.y; let amin = 1e9, amax = -1e9, bmin = 1e9, bmax = -1e9;
    const far = Math.min(Math.max(dist * 3, 300), 1600);
    for (const [x, y] of _ndc) {
      _v.set(x, y, 0.5).unproject(camera).sub(_p).normalize(); _ray.set(_p, _v);
      if (!_ray.intersectPlane(_g, _c) || _c.distanceTo(_p) > far) _c.copy(_p).addScaledVector(_v, far);
      const a = _c.dot(_lr), b = _c.dot(_lu);
      // the same point lifted 20 m (tall structures standing at the view edge) also has to be inside
      const a2 = a + 20 * _lr.y, b2 = b + 20 * _lu.y;
      amin = Math.min(amin, a, a2); amax = Math.max(amax, a, a2); bmin = Math.min(bmin, b, b2); bmax = Math.max(bmax, b, b2);
    }
    const m = 12, size = q.shadowMapSize || 1024;
    let ha = (amax - amin) / 2 + m, hb = (bmax - bmin) / 2 + m;
    const qz = (h) => Math.pow(1.06, Math.ceil(Math.log(Math.min(Math.max(h, 40), 900)) / Math.log(1.06)));
    ha = qz(ha); hb = qz(hb);
    const ta = 2 * ha / size, tb = 2 * hb / size;
    const ca = Math.round((amin + amax) / 2 / ta) * ta, cb = Math.round((bmin + bmax) / 2 / tb) * tb;
    fit.half[0] = ha; fit.half[1] = hb; fit.center[0] = ca; fit.center[1] = cb; fit.texel = Math.max(ta, tb);
    // centre: (ca, cb) in the light plane, at the focus' depth along the sun direction
    _t.copy(_lr).multiplyScalar(ca).addScaledVector(_lu, cb).addScaledVector(sunDir, target.dot(sunDir));
    return true;
  }
  function update(camera, target) {
    camera.updateMatrixWorld();
    _p.setFromMatrixPosition(camera.matrixWorld);
    if (target) _t.copy(target);
    else { camera.getWorldDirection(_d); _ray.set(_p, _d); if (!_ray.intersectPlane(_plane, _t)) _t.copy(_p).addScaledVector(_d, 300); }
    const dist = _p.distanceTo(_t);
    sky.position.copy(_p);
    scene.fog.near = Math.max(1600, dist * 1.6); scene.fog.far = scene.fog.near + 9000;   // lab.js updateCamPlanes
    const want = q.shadows && dist < 1400;
    if (sun.castShadow !== want) sun.castShadow = want;
    if (want) {
      fitShadow(camera, _d.copy(_t), dist);
      const c = sun.shadow.camera, [ha, hb] = fit.half;
      if (c.right !== ha || c.top !== hb) { c.left = -ha; c.right = ha; c.top = hb; c.bottom = -hb; c.near = 100; c.far = 5200; c.updateProjectionMatrix(); }
      // biases follow the texel size: tight contact shadows up close, no acne when zoomed out
      sun.shadow.normalBias = Math.min(Math.max(fit.texel * 1.2, 0.04), 0.5); sun.shadow.bias = -0.00025;
    }
    sun.target.position.copy(_t); sun.target.updateMatrixWorld();                         // lab.js updateSun
    sun.position.copy(_t).addScaledVector(sunDir, 2500);
  }
  function dispose() {
    scene.remove(hemi, sun, sun.target, sky);
    sun.shadow.map?.dispose(); sky.geometry.dispose(); sky.material.dispose(); envRT.dispose();
    if (scene.environment === envRT.texture) scene.environment = prevEnv || null;
    if (scene.fog && scene.fog.color.equals(HAZE)) scene.fog = prevFog || null;
  }
  return { sun, hemi, sky, sunDir, update, setQuality, dispose, shadowFit: fit };
}

// ───────────────────────────── shaders (lab.js 198–366) ─────────────────────────────
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

function makeUniforms(THREE) {
  return {
    uSurf: { value: null }, uNav: { value: null }, uH: { value: null },
    uCell: { value: 4 }, uN: { value: 2 }, uNN: { value: 1 }, uNavOff: { value: 1 }, uS: { value: 1000 },
    uPal: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
    uGridOn: { value: 0 }, uHeightOn: { value: 0 }, uDepthOn: { value: 0 }, uNavBit: { value: 0 },
    uHR: { value: new THREE.Vector2(0, 50) }, uTime: { value: 0 }, uWL: { value: 0 },
    uShallow: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uSky: { value: new THREE.Color(0.45, 0.58, 0.70) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTexA: { value: null }, uTexD: { value: null },
  };
}
function hookUniforms(U, shader, extra = {}) {
  for (const k of ['uNav', 'uCell', 'uNN', 'uNavOff', 'uGridOn', 'uNavBit', 'uS']) shader.uniforms[k] = U[k];
  Object.assign(shader.uniforms, extra);
}

// Terrain: lit, textured ground (MeshStandardMaterial). Surface classes (uSurf, 4 m cells) pick layers of the procedural
// tiling texture arrays (terraintex.js); the four surrounding cells are height-blended per pixel (soft, texture-shaped
// transitions), each layer tinted by the biome palette (uPal). HQ (medium / high): organic layers also sampled at a
// rotated ×4.3 scale to hide the repeat, per-pixel relief normals from the height grid (independent of chunk LOD),
// triplanar rock on cliffs. Detail normals, roughness and cavity come from the detail array. The Lab's overlays
// (nav / grid / height ramp), shoreline darkening and the underwater tint are kept.
// Ring banding fix: the old class-lookup jitter used fract(noise · 7.13) for its second axis, which wraps seven times
// across every noise blob, so class borders were shifted in concentric bands; the jitter is now two independent noises.
const TERRAIN_GLSL = /* glsl */`
  const int LH_LAYER[16] = int[16](0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 3, 4, 3, 3);
  const float LH_TILE[12] = float[12](${LAYER_TILE.map((x) => x.toFixed(1)).join(', ')});
  const float LH_ORG[12] = float[12](${LAYER_ORGANIC.map((x) => x.toFixed(1)).join(', ')});
  const float LH_SOFT = 0.42;   // height-blend softness (fraction of a cell's bilinear weight)
  const mat2 LH_ROT = mat2(0.79864, 0.60181, -0.60181, 0.79864);   // 37°
  float lh_rough = 1.0; vec3 lh_nW = vec3(0.0, 1.0, 0.0);
  vec2 lh_dx = vec2(0.0), lh_dy = vec2(0.0);
  int lh_id(float r) { return int(r * 255.0 + 0.5); }
  vec3 lh_pal(int k) { return uPal[k > 15 ? 15 : k]; }
  float lh_roughMul(int k) { return k == 12 ? 0.62 : 1.0; }   // wet sand
  // one layer at world xy w: a = colour multiplier (×1 mean) + height; d = normal xy (−1…1), roughness, cavity
  void lh_sample(int L, vec2 w, out vec4 a, out vec4 d) {
    float t = LH_TILE[L]; vec3 uv = vec3(w / t, float(L));
    a = textureGrad(uTexA, uv, lh_dx / t, lh_dy / t); d = textureGrad(uTexD, uv, lh_dx / t, lh_dy / t);
    a.rgb *= 2.0; d.xy = d.xy * 2.0 - 1.0;
#if LH_HQ == 1
    if (LH_ORG[L] > 0.5) {
      float tf = t * 4.3; vec3 uf = vec3(LH_ROT * w / tf + 0.37, float(L));
      vec2 gx = LH_ROT * lh_dx / tf, gy = LH_ROT * lh_dy / tf;
      vec4 a2 = textureGrad(uTexA, uf, gx, gy), d2 = textureGrad(uTexD, uf, gx, gy);
      a.rgb *= mix(vec3(1.0), a2.rgb * 2.0, 0.55); a.a = mix(a.a, a2.a, 0.35);
      d.xy += (transpose(LH_ROT) * (d2.xy * 2.0 - 1.0)) * 0.6; d.zw = mix(d.zw, d2.zw, 0.35);
    }
#endif
  }
  // rock (layer 4) projected along the dominant axes: a, d as lh_sample, d.xyz = world-space normal perturbation
  void lh_rockTri(vec3 p, vec3 n, vec3 pdx, vec3 pdy, out vec4 a, out vec4 d) {
    vec3 bw = pow(abs(n), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
    float t = LH_TILE[4];
    vec4 ax = textureGrad(uTexA, vec3(p.zy / t, 4.0), pdx.zy / t, pdy.zy / t), dx = textureGrad(uTexD, vec3(p.zy / t, 4.0), pdx.zy / t, pdy.zy / t);
    vec4 ay = textureGrad(uTexA, vec3(vec2(p.x, -p.z) / t, 4.0), vec2(pdx.x, -pdx.z) / t, vec2(pdy.x, -pdy.z) / t), dy = textureGrad(uTexD, vec3(vec2(p.x, -p.z) / t, 4.0), vec2(pdx.x, -pdx.z) / t, vec2(pdy.x, -pdy.z) / t);
    vec4 az = textureGrad(uTexA, vec3(p.xy / t, 4.0), pdx.xy / t, pdy.xy / t), dz = textureGrad(uTexD, vec3(p.xy / t, 4.0), pdx.xy / t, pdy.xy / t);
    a = (ax * bw.x + ay * bw.y + az * bw.z); a.rgb *= 2.0;
    vec2 nx = dx.xy * 2.0 - 1.0, ny = dy.xy * 2.0 - 1.0, nz = dz.xy * 2.0 - 1.0;
    vec3 pert = vec3(0.0, nx.y, nx.x) * sign(n.x) * bw.x + vec3(ny.x, 0.0, -ny.y) * bw.y + vec3(nz.x, nz.y, 0.0) * bw.z;
    d = vec4(pert, dx.z * bw.x + dy.z * bw.y + dz.z * bw.z); d.w = dx.w * bw.x + dy.w * bw.y + dz.w * bw.z;
  }
  vec3 lh_ramp(float t) {
    vec3 a = vec3(0.13, 0.33, 0.27), b = vec3(0.30, 0.52, 0.30), c = vec3(0.72, 0.70, 0.42), d = vec3(0.78, 0.53, 0.32), e = vec3(0.56, 0.36, 0.28), f = vec3(0.93, 0.91, 0.88);
    if (t < 0.2) return mix(a, b, t / 0.2); if (t < 0.45) return mix(b, c, (t - 0.2) / 0.25); if (t < 0.7) return mix(c, d, (t - 0.45) / 0.25);
    if (t < 0.88) return mix(d, e, (t - 0.7) / 0.18); return mix(e, f, (t - 0.88) / 0.12); }
  vec3 lh_terrain(vec2 w, float h, vec3 nGeo) {
    lh_dx = dFdx(w); lh_dy = dFdy(w);
    vec3 pdx = dFdx(vW), pdy = dFdy(vW);
    vec3 nG = nGeo;
#if LH_HQ == 1
    { // per-pixel relief normal from the height grid (the far chunks' LOD meshes drop most of it)
      vec2 uvh = (w / uCell + 0.5) / uN; float e = 1.0 / uN;
      float hl = texture(uH, uvh - vec2(e, 0.0)).r, hr = texture(uH, uvh + vec2(e, 0.0)).r, hd = texture(uH, uvh - vec2(0.0, e)).r, hu = texture(uH, uvh + vec2(0.0, e)).r;
      nG = normalize(vec3(-(hr - hl) / (2.0 * uCell), 1.0, (hu - hd) / (2.0 * uCell)));
    }
#endif
    // surface classes of the four surrounding cells (jittered lookup breaks up the 4 m grid)
    vec2 jit = (vec2(lh_noise(w * 0.09), lh_noise(w * 0.09 + vec2(31.7, 17.3))) - 0.5) * 1.3
             + (vec2(lh_noise(w * 0.31 + 7.3), lh_noise(w * 0.31 + vec2(3.1, 41.9))) - 0.5) * 0.45;
    vec2 p = w / uCell + jit;
    vec2 i0 = clamp(floor(p), vec2(0.0), vec2(uN - 2.0)); vec2 f = clamp(p - i0, 0.0, 1.0);
    ivec2 ia = ivec2(i0);
    int K[4] = int[4](lh_id(texelFetch(uSurf, ia, 0).r), lh_id(texelFetch(uSurf, ia + ivec2(1, 0), 0).r), lh_id(texelFetch(uSurf, ia + ivec2(0, 1), 0).r), lh_id(texelFetch(uSurf, ia + ivec2(1, 1), 0).r));
    float B[4] = float[4]((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    for (int i = 1; i < 4; i++) for (int j = 0; j < 3; j++) { if (j < i && B[j] > 0.0 && K[i] == K[j]) { B[j] += B[i]; B[i] = 0.0; break; } }
    vec4 SA[4], SD[4]; float S[4]; float mx = -1.0;
    for (int i = 0; i < 4; i++) {
      SA[i] = vec4(1.0, 1.0, 1.0, 0.5); SD[i] = vec4(0.0, 0.0, 0.9, 1.0); S[i] = -1.0;
      if (B[i] > 0.0) { lh_sample(LH_LAYER[min(K[i], 15)], w, SA[i], SD[i]); S[i] = B[i] + 0.3 * SA[i].a; mx = max(mx, S[i]); }
    }
    vec3 c = vec3(0.0); vec2 nT = vec2(0.0); float rough = 0.0, cav = 0.0, veg = 0.0, farm = 0.0, rockC = 0.0, wsum = 0.0;
    for (int i = 0; i < 4; i++) {
      float wt = max(S[i] - mx + LH_SOFT, 0.0);
      if (wt <= 0.0) continue;
      int k = K[i];
      c += wt * lh_pal(k) * SA[i].rgb; nT += wt * SD[i].xy; rough += wt * SD[i].z * lh_roughMul(k); cav += wt * SD[i].w;
      veg += wt * float(k == 0 || k == 1 || k == 9 || k == 11); farm += wt * float(k == 9); rockC += wt * float(k == 4 || k == 13);
      wsum += wt;
    }
    float iw = 1.0 / max(wsum, 1e-4); c *= iw; nT *= iw; rough *= iw; cav *= iw; veg *= iw; farm *= iw; rockC *= iw;
    // far away the tiles' own variation turns into a visible repeat: fade it (and the detail normals) toward the plain tint
    float far = smoothstep(220.0, 900.0, length(vW - cameraPosition));
    vec3 tint = vec3(0.0); for (int i = 0; i < 4; i++) { float wt = max(S[i] - mx + LH_SOFT, 0.0); tint += wt * lh_pal(K[i]); }
    c = mix(c, tint * iw, far * 0.8); nT *= 1.0 - far * 0.7; cav = mix(cav, 1.0, far * 0.7);
    // macro variation (broad, low frequency) and the Lab's dry patches on vegetation
    float n1 = lh_fbm(w * 0.013), n2 = lh_noise(w * 0.35), n0 = lh_noise(w * 0.0045 + 5.0);
    c *= (0.86 + 0.24 * n1 + 0.08 * (n2 - 0.5)) * (0.93 + 0.14 * lh_noise(w * 0.041 + 3.7)) * (0.95 + 0.10 * lh_noise(w * 0.13 + 9.1));
    c = mix(c, uPal[14] * (0.8 + 0.4 * n2), veg * smoothstep(0.52, 0.80, n0 * 0.7 + n1 * 0.45) * 0.45);
    c *= 1.0 - farm * 0.16 * smoothstep(0.35, 0.65, abs(fract(w.x / 3.2) - 0.5) * 2.0);
    vec3 pert = vec3(nT.x, 0.0, -nT.y);
    // rock on steep ground
    float sl = 1.0 - clamp(nG.y, 0.0, 1.0);
    float rk = max(smoothstep(0.17, 0.40, sl) * 0.85 * smoothstep(0.0, 0.8, h - uWL), rockC * smoothstep(0.06, 0.22, sl));
    if (rk > 0.002) {
      vec4 ra, rd;
#if LH_HQ == 1
      lh_rockTri(vW, nG, pdx, pdy, ra, rd);
#else
      lh_sample(4, w, ra, rd); rd.xyz = vec3(rd.x, 0.0, -rd.y);
#endif
      c = mix(c, uPal[4] * ra.rgb * (0.85 + 0.3 * n2), rk);
      pert = mix(pert, rd.xyz * 1.4, rk); rough = mix(rough, rd.z, rk) ; cav = mix(cav, rd.w, rk);
    }
    c *= mix(1.0, cav, 0.7);
    c *= 1.0 - 0.06 * smoothstep(0.05, 0.3, sl);
    // shoreline: wet, darker, glossier band at the waterline (smooth both ways: no hard contour under the water)
    float hw = h - uWL, wet = (1.0 - smoothstep(-0.2, 1.3, hw)) * smoothstep(-1.8, -0.4, hw);
    c *= 1.0 - 0.30 * wet; rough = mix(rough, rough * 0.45, wet);
    c *= mix(1.0, 0.45, smoothstep(0.0, 18.0, -hw));
    lh_rough = clamp(rough, 0.08, 1.0);
    lh_nW = normalize(nG + pert);
    return c;
  }
`;
function terrainMaterial(THREE, U, hq) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.04 });
  m.defines = Object.assign(m.defines || {}, { LH_HQ: hq ? 1 : 0 });
  m.onBeforeCompile = (sh) => {
    hookUniforms(U, sh, { uSurf: U.uSurf, uN: U.uN, uPal: U.uPal, uHeightOn: U.uHeightOn, uHR: U.uHR, uH: U.uH, uTexA: U.uTexA, uTexD: U.uTexD, uWL: U.uWL });
    sh.vertexShader = 'varying vec3 vW; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'varying vec3 vW; varying vec3 vWN;\nuniform sampler2D uSurf; uniform float uN; uniform vec3 uPal[16]; uniform float uHeightOn; uniform vec2 uHR;\n' +
      'uniform sampler2D uH; uniform sampler2DArray uTexA; uniform sampler2DArray uTexD; uniform float uWL;\n' + GLSL_COMMON + TERRAIN_GLSL + sh.fragmentShader
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( lh_terrain(vec2(vW.x, -vW.z), vW.y, normalize(vWN)), opacity );')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = lh_rough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize((viewMatrix * vec4(lh_nW, 0.0)).xyz);')
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
  m.customProgramCacheKey = () => 'lab-terrain-v2';
  return m;
}

// Road and lane surface: paint from (across metres, along metres). style 0 = asphalt road, 1 = concrete lane / aisle / trestle.
function roadMaterial(THREE, U, clearW, style) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const uClear = { value: clearW }, uStyle = { value: style };
  m.onBeforeCompile = (sh) => {
    hookUniforms(U, sh, { uClear, uStyle });
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

// Depth-tinted transparent water with animated normals, Fresnel sky tint, sun glint and shore foam. Depth comes from the
// height texture, so the plane needs no per-vertex data. (uWL: water level; the Lab hard-codes 0.)
function waterMaterial(THREE, U) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: 'varying vec3 vW; uniform sampler2D uH; uniform float uN; uniform float uDepthOn; uniform float uTime; uniform float uWL; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunDir;\n#include <common>\n#include <fog_pars_fragment>\n' + GLSL_COMMON + /* glsl */`
      vec3 lh_depthRamp(float d) {
        if (d < 1.0) return vec3(0.75, 0.91, 0.89); if (d < 3.0) return vec3(0.50, 0.80, 0.82); if (d < 6.0) return vec3(0.25, 0.56, 0.72);
        if (d < 10.0) return vec3(0.16, 0.39, 0.63); if (d < 20.0) return vec3(0.11, 0.26, 0.51); return vec3(0.07, 0.16, 0.35); }
      void main() {
        vec2 w = vec2(vW.x, -vW.z);
        float h = texture2D(uH, (w / uCell + 0.5) / uN).r;
        float depth = max(uWL - h, 0.0); // no discard: land always sits above this plane, so early depth testing rejects it
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
  for (const k of ['uH', 'uN', 'uDepthOn', 'uTime', 'uWL', 'uShallow', 'uDeep', 'uSky', 'uSunDir', 'uNav', 'uCell', 'uNN', 'uNavOff', 'uGridOn', 'uNavBit', 'uS']) m.uniforms[k] = U[k];
  return m;
}

// ───────────────────────────── glTF assets ─────────────────────────────
// .gltf.json (glTF JSON with its buffer as a base64 data URI) → in-memory GLB → GLTFLoader.parse (units/sandbox/app.js 77–91)
async function loadGltfJson(loader, url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const js = await r.json(); let bin = new Uint8Array(0);
  if (js.buffers && js.buffers[0] && js.buffers[0].uri && js.buffers[0].uri.startsWith('data:')) {
    const b64 = js.buffers[0].uri.slice(js.buffers[0].uri.indexOf(',') + 1); const raw = atob(b64); bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    delete js.buffers[0].uri;
  }
  const enc = new TextEncoder().encode(JSON.stringify(js)); const jl = (enc.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const glb = new Uint8Array(12 + 8 + jl + (bl ? 8 + bl : 0)); const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); glb.set(enc, 20); for (let i = enc.length; i < jl; i++) glb[20 + i] = 0x20;
  if (bl) { dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004E4942, true); glb.set(bin, 28 + jl); }
  return new Promise((res, rej) => loader.parse(glb.buffer, '', res, rej));
}

// One prototype per asset: every mesh baked into asset space and merged per material, so each asset level draws as one
// InstancedMesh per material (lab.js makeProto). Materials named TEAM* take the instance colour (team tint).
function makeProto(THREE, name, gltf) {
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
    if (geos.length > 1) { const mg = mergeGeometries(geos, false); if (mg) { list = [mg]; geos.forEach((x) => x.dispose()); } }
    const team = /^TEAM/i.test(mat.name || '');
    let m = mat;
    if (team) { m = mat.clone(); m.name = mat.name; m.userData.teamBase = mat.color.clone(); m.color.set(0xffffff); }
    if ('envMapIntensity' in m) m.envMapIntensity = 0.55;
    for (const geo of list) { geo.computeBoundingSphere(); parts.push({ geo, mat: m, team }); }
  }
  // dispose the loader's originals (geometries were cloned; materials not used by a part)
  const used = new Set(parts.map((p) => p.mat));
  root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (!used.has(o.material)) o.material.dispose(); } });
  return { name, parts, box, tris: Math.round(tris), prims };
}

// draw-distance category (lab.js catOf)
function catOf(name, info) {
  if (name.startsWith('veg_')) return info && info.source === 'species-height' ? 'tree' : (name === 'veg_oak' || /pine|palm|poplar|mangrove|broadleaf|jungle/.test(name) ? 'tree' : 'smallveg');
  if (name.startsWith('coral')) return 'smallveg';
  if (name.startsWith('rock_cliff')) return 'struct';
  if (name.startsWith('rock_')) return 'rock';
  if (name.startsWith('prop_') && info && Math.max(...info.size) < 4.5) return 'smallprop';
  return 'struct';
}

// ───────────────────────────── geometry helpers (lab.js 607–615, 762–820) ─────────────────────────────
function densify(pts, zs, step) {
  const P = [], Z = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L / step));
    for (let t = 0; t < m; t++) { const u = t / m; P.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); if (zs) Z.push(zs[k] + (zs[k + 1] - zs[k]) * u); }
  }
  P.push(pts[pts.length - 1]); if (zs) Z.push(zs[zs.length - 1]);
  return { P, Z };
}
function runsOf(flags, n) { // contiguous runs where !flags[k]
  const out = []; let cur = null;
  for (let k = 0; k < n; k++) { if (!flags[k]) { if (!cur) cur = []; cur.push(k); } else if (cur) { out.push(cur); cur = null; } }
  if (cur) out.push(cur);
  return out;
}
function ribbonGeo(THREE, pts, zs, halfW) { // flat ribbon with rc = (across, along) metres for the road shader
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
function boxGeo(THREE, cx, cy, ang, lx, ly, z0, z1) {
  const geo = new THREE.BoxGeometry(lx, Math.max(z1 - z0, 0.01), ly);
  geo.rotateY(ang); geo.translate(cx, (z0 + z1) / 2, -cy);
  return geo;
}
function cylGeo(THREE, cx, cy, r, z0, z1) {
  const geo = new THREE.CylinderGeometry(r, r, Math.max(z1 - z0, 0.01), 10);
  geo.translate(cx, (z0 + z1) / 2, -cy);
  return geo;
}

// minimap surface-class colours (lab.js SURF_RGB)
const SURF_RGB = { 0: [92, 122, 60], 1: [108, 136, 68], 2: [126, 108, 80], 3: [214, 200, 158], 4: [128, 124, 116], 5: [168, 168, 164], 6: [150, 138, 120],
  7: [64, 66, 70], 8: [98, 84, 62], 9: [124, 132, 72], 10: [120, 100, 76], 11: [52, 84, 46], 12: [170, 156, 118], 13: [158, 98, 60] };

/**
 * Top-down base image of the whole map (lab.js buildMinimap): surface-class colours shaded by height, water by depth.
 * Pixel (0, 0) is the north-west corner: x = (px + 0.5) / size · S, y = (1 − (py + 0.5) / size) · S.
 * marks: any of 'capturable' (220 m reveal circle of capturable landmarks), 'deposits', 'pads', 'routes' (the Lab's
 * harvester test routes) drawn on top as the Lab does.
 */
export function drawMinimapBase(T, size = 512, marks = ['capturable', 'deposits']) {
  const W = size, S = T.S, wl = T.waterLevel || 0;
  const cv = document.createElement('canvas'); cv.width = cv.height = W;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, W);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const x = (px + 0.5) / W * S, y = (1 - (py + 0.5) / W) * S, h = T.terrainBilinear(x, y), k = (py * W + px) * 4;
    let c;
    if (h <= wl && !(T.deckBits && T.deckBits[T.cellOf(x, y)])) { const d = Math.min((wl - h) / 18, 1); c = [44 - 26 * d, 112 - 62 * d, 138 - 48 * d]; }
    else {
      // decks over water (surface class 255) are drawn as concrete; the Lab falls back to the grass colour there
      const sc = T.surfaceClass ? T.surfaceAt(x, y) : 0, sh = 0.82 + Math.min(Math.max(h - wl, 0), 50) / 160;
      c = (SURF_RGB[sc] || (sc === 255 ? SURF_RGB[5] : SURF_RGB[0])).map((v) => v * sh);
    }
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tp = (x, y) => [x / S * W, (1 - y / S) * W], meta = T.meta, ks = W / 256;   // line widths scaled from the Lab's 256 px map
  const on = new Set(marks || []);
  ctx.lineWidth = 1.5 * ks;
  if (on.has('routes')) for (const r of meta.routes || []) { ctx.strokeStyle = 'rgba(244,201,93,0.9)'; ctx.setLineDash([3 * ks, 2 * ks]); ctx.beginPath(); r.pts.forEach((q, k) => { const [a, b] = tp(...q); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke(); }
  ctx.setLineDash([]);
  if (on.has('capturable')) for (const l of meta.landmarks || []) if (l.role === 'capturable') { const [a, b] = tp(...l.center); ctx.strokeStyle = '#b388ff'; ctx.beginPath(); ctx.arc(a, b, 220 / S * W, 0, Math.PI * 2); ctx.stroke(); }
  if (on.has('pads')) for (const p of meta.pads || []) { const [a, b] = tp(...p.center), s = p.size[0] / S * W; ctx.strokeStyle = p.team === 'R' ? '#e05252' : '#4f8ff7'; ctx.lineWidth = 2 * ks; ctx.strokeRect(a - s / 2, b - s / 2, s, s); }
  if (on.has('deposits')) for (const d of meta.deposits || []) { const [a, b] = tp(...d.pos); ctx.fillStyle = '#f4c95d'; ctx.fillRect(a - 2 * ks, b - 2 * ks, 4 * ks, 4 * ks); }
  return cv;
}

// ───────────────────────────── the map view ─────────────────────────────
/**
 * Build the map's visuals into `scene` (one Group named 'map').
 *   THREE: the game's three.js module; scene, renderer: the game's; T: from loadMapData();
 *   assetBase: URL prefix of <asset>.gltf.json, manifest.json and sizes.json (e.g. 'assets/map/');
 *   exclude(assetName, row) → true to skip an instance (row = [x, y, z, rotZ, scale, team, zScale?], team 0 neutral / 1 / 2);
 *   quality: 'low' | 'medium' | 'high'; onProgress(stage, fraction 0…1);
 *   minimapSize (px, default 512), minimapMarks (see drawMinimapBase).
 * Returns { update(camera, dt), setQuality(q), setOverlay(o), minimapCanvas, terrainMesh, water, group, stats(), dispose() }.
 */
export async function buildMapView({ THREE, scene, renderer, T, assetBase = 'assets/map/', exclude = null, quality = 'medium', onProgress = null,
  minimapSize = 512, minimapMarks = ['capturable', 'deposits'] }) {
  const tStart = performance.now();
  const progress = (stage, f) => { try { onProgress && onProgress(stage, f); } catch (e) { /* ignore UI errors */ } };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let qName = MAP_QUALITY[quality] ? quality : 'medium', Q = qOf(qName);
  const { n, g, nn, S } = T, H = T.h, wl = T.waterLevel || 0;
  const U = makeUniforms(THREE);
  // terrain detail textures: generated in a worker while the models download; neutral stand-ins until then
  const texJob = generateTerrainDataAsync(Q.texRes || 256);
  { const nt = neutralTerrainTextures(THREE); U.uTexA.value = nt.albedo; U.uTexD.value = nt.detail; }
  const owned = { geos: new Set(), mats: new Set(), tex: new Set() };   // everything disposed by dispose()

  const root = new THREE.Group(); root.name = 'map';
  const G = {};
  for (const k of ['terrain', 'water', 'roads', 'structs', 'inst']) { G[k] = new THREE.Group(); G[k].name = 'map_' + k; root.add(G[k]); }
  scene.add(root);
  progress('terrain', 0.02);

  // ── biome (lab.js setupBiome) ──
  {
    const P = pal(T), W = wat(T);
    const mix = (a, b, t) => a.map((x, i) => x * (1 - t) + b[i] * t);
    const p = [];
    p[0] = P.grass; p[1] = P.grass2; p[2] = mix(P.soil, P.dry, 0.35); p[3] = P.sand; p[4] = P.rock;
    p[5] = [0.40, 0.40, 0.38]; p[6] = [0.25, 0.24, 0.22]; p[7] = [0.05, 0.05, 0.055]; p[8] = [0.14, 0.11, 0.07];
    p[9] = mix(P.grass2, P.dry, 0.45); p[10] = P.soil; p[11] = mix(P.grass, P.soil, 0.45).map((x) => x * 0.72);
    p[12] = P.sand.map((x) => x * 0.58); p[13] = T.id === '05' ? [0.50, 0.30, 0.18] : mix(P.rock, P.soil, 0.5);
    p[14] = P.dry; p[15] = mix(P.sand, P.soil, 0.35);
    p.forEach((c, i) => U.uPal.value[i].set(c[0], c[1], c[2]));
    U.uShallow.value.setRGB(...W.shallow); U.uDeep.value.setRGB(...W.deep);
    U.uSunDir.value.copy(mapSunDir(THREE, T));
    U.uCell.value = g; U.uN.value = n; U.uNN.value = nn; U.uNavOff.value = T.navOff; U.uS.value = S; U.uWL.value = wl;
    U.uHR.value.set(Math.floor(Math.min(T.hmin, 0) / 5) * 5, Math.ceil(T.hmax / 5) * 5);
  }
  // ── data textures (lab.js buildTextures): height (half float, linear), surface classes, nav bits ──
  {
    const half = new Uint16Array(n * n);
    for (let k = 0; k < n * n; k++) half[k] = THREE.DataUtils.toHalfFloat(H[k]);
    const th = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
    th.minFilter = th.magFilter = THREE.LinearFilter; th.needsUpdate = true; U.uH.value = th;
    const ts = new THREE.DataTexture(T.surfaceClass || new Uint8Array(n * n), n, n, THREE.RedFormat, THREE.UnsignedByteType);
    ts.needsUpdate = true; U.uSurf.value = ts;
    const tn = new THREE.DataTexture(T.navBits || new Uint8Array(nn * nn).fill(255), nn, nn, THREE.RedFormat, THREE.UnsignedByteType);
    tn.needsUpdate = true; U.uNav.value = tn;
    for (const t of [th, ts, tn]) owned.tex.add(t);
  }

  // ── terrain (lab.js buildTerrain + chunkGeo): 32-cell chunks, 3 LOD levels (every 1st / 2nd / 4th vertex) with skirts ──
  const terrainMesh = new THREE.Group(); terrainMesh.name = 'map_terrain_chunks';
  let terrainMat = null;
  const terrainLods = [];
  {
    const CH = 32;
    const NRM = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const il = Math.max(i - 1, 0), ir = Math.min(i + 1, n - 1), jd = Math.max(j - 1, 0), ju = Math.min(j + 1, n - 1);
      const dx = (H[j * n + ir] - H[j * n + il]) / ((ir - il) * g), dy = (H[ju * n + i] - H[jd * n + i]) / ((ju - jd) * g);
      const l = Math.hypot(dx, 1, dy), o = (j * n + i) * 3;
      NRM[o] = -dx / l; NRM[o + 1] = 1 / l; NRM[o + 2] = dy / l;
    }
    const mat = terrainMat = terrainMaterial(THREE, U, Q.terrainHQ); owned.mats.add(mat);
    const nc = Math.ceil((n - 1) / CH);
    for (let cj = 0; cj < nc; cj++) for (let ci = 0; ci < nc; ci++) {
      const i0 = ci * CH, i1 = Math.min(i0 + CH, n - 1), j0 = cj * CH, j1 = Math.min(j0 + CH, n - 1);
      const cx = (i0 + i1) / 2 * g, cy = (j0 + j1) / 2 * g;
      const lod = new THREE.LOD();
      lod.position.set(cx, 0, -cy);
      [1, 2, 4].forEach((s, li) => {
        const geo = chunkGeo(i0, i1, j0, j1, s, cx, cy, NRM); owned.geos.add(geo);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true; mesh.userData.terrain = true; mesh.userData.lodStep = s;
        lod.addLevel(mesh, li === 0 ? 0 : Q.terrLod[li - 1]);
      });
      lod.updateMatrix(); lod.matrixAutoUpdate = false;
      terrainLods.push(lod); terrainMesh.add(lod);
    }
    G.terrain.add(terrainMesh);
  }
  function chunkGeo(i0, i1, j0, j1, s, cx, cy, NRM) {
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
    const D = 2 + 6 * s;   // skirt depth hides cracks between chunks at different LOD levels
    per.forEach(([a, b], q) => {
      const src = (b * nx + a) * 3, o = (nx * ny + q) * 3;
      pos[o] = pos[src]; pos[o + 1] = pos[src + 1] - D; pos[o + 2] = pos[src + 2];
      nrm[o] = nrm[src]; nrm[o + 1] = nrm[src + 1]; nrm[o + 2] = nrm[src + 2];
    });
    const idx = [];
    for (let b = 0; b < ny - 1; b++) for (let a = 0; a < nx - 1; a++) {
      const v00 = b * nx + a, v10 = v00 + 1, v01 = v00 + nx, v11 = v01 + 1;
      idx.push(v00, v10, v11, v00, v11, v01);   // diagonal (i, j)–(i+1, j+1): T.terrain() interpolates the same triangles
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

  // ── boundary walls (lab.js buildWalls): cut faces at the map edge make the playable bounds explicit ──
  {
    const BOT = Math.min(T.hmin, wl) - 22;
    const P = pal(T), W = wat(T);
    const earthTop = new THREE.Color(...P.soil).multiplyScalar(0.55), earthBot = new THREE.Color(0.03, 0.028, 0.026), water = new THREE.Color(...W.deep).multiplyScalar(1.4);
    const pos = [], col = [], idx = [];
    const edges = [(t) => [t, 0], (t) => [n - 1, t], (t) => [n - 1 - t, n - 1], (t) => [0, n - 1 - t]];
    for (const e of edges) {
      const base = pos.length / 3;
      for (let t = 0; t < n; t++) {
        const [i, j] = e(t), h = H[j * n + i], x = i * g, y = j * g;
        const top = Math.max(h, wl);
        for (const [z, c] of [[top, h < wl ? water : earthTop], [h, h < wl ? water : earthTop], [h, earthTop], [BOT, earthBot]]) { pos.push(x, z, -y); col.push(c.r, c.g, c.b); }
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
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    owned.geos.add(geo); owned.mats.add(mat);
    const walls = new THREE.Mesh(geo, mat); walls.name = 'map_walls';
    G.terrain.add(walls);
  }

  // ── water (lab.js buildWater): one plane over the whole map at the water level ──
  let water = null;
  if (T.hmin < wl) {
    const geo = new THREE.PlaneGeometry(S, S, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(S / 2, wl, -S / 2);
    const mat = waterMaterial(THREE, U);
    owned.geos.add(geo); owned.mats.add(mat);
    water = new THREE.Mesh(geo, mat); water.renderOrder = 2; water.name = 'map_water';
    G.water.add(water);
  }
  progress('roads', 0.12);
  await tick();

  // ── roads and service lanes (lab.js buildRoads) ──
  const roadMats = {};
  const roadMat = (w) => roadMats['r' + w] || (roadMats['r' + w] = roadMaterial(THREE, U, w, 0));
  const laneMat = (w) => roadMats['l' + w] || (roadMats['l' + w] = roadMaterial(THREE, U, w, 1));
  for (const r of T.meta.roads || []) {
    for (const run of runsOf(r.on_beach || [], r.xy.length)) {
      if (run.length < 2) continue;
      const pts = run.map((k) => r.xy[k]), zs = run.map((k) => r.z[k] + (r.kind === 'main' ? 0.03 : 0.06));
      const geo = ribbonGeo(THREE, pts, zs, r.clear_w / 2 + 2);
      if (!geo) continue;
      owned.geos.add(geo);
      const mesh = new THREE.Mesh(geo, roadMat(r.clear_w)); mesh.receiveShadow = true; mesh.userData.road = r.id;
      G.roads.add(mesh);
    }
  }
  for (const ln of T.meta.lanes || []) {
    if (ln.kind === 'trestle') continue;
    const zs0 = Array.isArray(ln.z) ? ln.z : ln.pts.map(() => ln.z);
    const { P, Z } = densify(ln.pts, zs0, 2);
    const zz = P.map((p, k) => Math.max(Z[k] ?? 0, T.terrain(p[0], p[1])) + 0.05);
    const geo = ribbonGeo(THREE, P, zz, ln.w / 2);
    if (geo) { owned.geos.add(geo); const mesh = new THREE.Mesh(geo, laneMat(ln.w)); mesh.receiveShadow = true; G.roads.add(mesh); }
  }

  // ── manifest + sizes (which GLBs exist, LOD1 variants, measured sizes for draw-distance categories) ──
  const getJSON = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [manifestJs, sizesJs] = await Promise.all([getJSON(assetBase + 'manifest.json'), getJSON(assetBase + 'sizes.json')]);
  const manifest = manifestJs ? new Set(Array.isArray(manifestJs) ? manifestJs : manifestJs.assets || []) : null;
  const sizes = sizesJs || {};
  const has = (name) => (manifest ? manifest.has(name) : true);   // without a manifest every asset is tried

  // ── bridges, docks (procedural only without the dock GLB), trestles (lab.js buildStructures) ──
  const concreteMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.40, 0.40, 0.38) }); owned.mats.add(concreteMat);
  const structNotes = [];
  {
    const parts = [];
    for (const r of T.meta.roads || []) {
      const br = r.bridge || [];
      for (const run of runsOf(br.map((b) => !b), r.xy.length)) {
        if (run.length < 2) continue;
        const a = r.xy[run[0]], e = r.xy[run[run.length - 1]], L = Math.hypot(e[0] - a[0], e[1] - a[1]);
        const ang = Math.atan2(e[1] - a[1], e[0] - a[0]), c = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
        const nrm = [-Math.sin(ang), Math.cos(ang)], deck = run.reduce((s, k) => s + r.z[k], 0) / run.length, W = r.clear_w + 3;
        parts.push(boxGeo(THREE, c[0], c[1], ang, L + 16, W, deck - 2.0, deck - 0.05));
        for (const sgn of [-1, 1]) parts.push(boxGeo(THREE, c[0] + nrm[0] * sgn * (W / 2 - 0.25), c[1] + nrm[1] * sgn * (W / 2 - 0.25), ang, L + 16, 0.5, deck, deck + 1.1));
        const low = deck - 2.0 < 12.0;
        const ts = low ? Array.from({ length: Math.floor(L / 30) + 1 }, (_, k) => Math.min(k * 30 / L, 1)) : [0, 0.17, 0.33, 0.67, 0.83, 1];
        for (const t of ts) {
          const p = [a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t];
          const bed = Math.min(T.terrain(p[0], p[1]), wl) - 1;
          for (const sgn of [-1, 1]) parts.push(boxGeo(THREE, p[0] + nrm[0] * sgn * W * 0.3, p[1] + nrm[1] * sgn * W * 0.3, ang, 2.5, 2.5, bed, deck - 2.0));
          parts.push(boxGeo(THREE, p[0], p[1], ang, 3.0, W, deck - 3.2, deck - 2.0));
        }
        structNotes.push(`${r.id}: ${low ? 'causeway' : 'bridge'} deck ${deck.toFixed(1)} m, span ${L.toFixed(0)} m, ${ts.length} pier rows`);
      }
    }
    const dockProcedural = !has('bld_naval_dock');
    for (const d of T.meta.docks || []) {
      if (!dockProcedural) break;
      const top = d.deck_z ?? 3, cs = Math.cos(d.rot), sn = Math.sin(d.rot);
      parts.push(boxGeo(THREE, d.water_center[0], d.water_center[1], d.rot, 80, 40, top - 1.2, top));
      for (let u = -36; u <= 36; u += 12) for (const v of [-16, 0, 16]) {
        const x = d.water_center[0] + u * cs - v * sn, y = d.water_center[1] + u * sn + v * cs;
        parts.push(cylGeo(THREE, x, y, 0.55, Math.min(T.terrain(x, y), -1) - 1, top - 1.2));
      }
      structNotes.push(`dock ${d.player}: procedural 80 × 40 m deck (no bld_naval_dock GLB)`);
    }
    for (const ln of T.meta.lanes || []) {
      if (ln.kind !== 'trestle') continue;
      const zs = Array.isArray(ln.z) ? ln.z : ln.pts.map(() => ln.z);
      const { P, Z } = densify(ln.pts, zs, 2);
      const geo = ribbonGeo(THREE, P, Z.map((z) => z + 0.02), ln.w / 2);
      if (geo) { owned.geos.add(geo); const deckMesh = new THREE.Mesh(geo, laneMat(16)); deckMesh.receiveShadow = true; G.structs.add(deckMesh); }
      const a = ln.pts[0], e = ln.pts[ln.pts.length - 1], L = Math.hypot(e[0] - a[0], e[1] - a[1]), ang = Math.atan2(e[1] - a[1], e[0] - a[0]);
      const zmin = Math.min(...zs);
      parts.push(boxGeo(THREE, (a[0] + e[0]) / 2, (a[1] + e[1]) / 2, ang, L, ln.w, zmin - 1.2, zmin - 0.02));
      for (let t = 4; t < L - 2; t += 8) for (const sgn of [-1, 1]) {
        const s = sgn * (ln.w / 2 - 1.2), x = a[0] + (e[0] - a[0]) * t / L - Math.sin(ang) * s, y = a[1] + (e[1] - a[1]) * t / L + Math.cos(ang) * s;
        parts.push(cylGeo(THREE, x, y, 0.45, Math.min(T.terrain(x, y), wl) - 1, zmin - 1.2));
      }
    }
    if (parts.length) {
      const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
      parts.forEach((p) => p.dispose());
      if (merged) { owned.geos.add(merged); const mesh = new THREE.Mesh(merged, concreteMat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'map_structures'; G.structs.add(mesh); }
    }
  }
  for (const m of Object.values(roadMats)) owned.mats.add(m);
  progress('assets', 0.2);
  await tick();

  // ── instances: filter, load the GLBs the map needs (+ _lod1 variants), build instanced sets ──
  const loader = new GLTFLoader();
  const failed = {}, protoCache = new Map();
  const loadProto = (name) => {
    if (!protoCache.has(name)) protoCache.set(name, loadGltfJson(loader, `${assetBase}${name}.gltf.json`).then((gl) => makeProto(THREE, name, gl)).catch((e) => { failed[name] = String(e.message || e); return null; }));
    return protoCache.get(name);
  };
  const wanted = [];   // [name, rows]
  let excludedCount = 0;
  for (const [name, rows0] of Object.entries(T.instances || {})) {
    if (!Array.isArray(rows0) || !rows0.length) continue;
    const rows = exclude ? rows0.filter((r) => !exclude(name, r)) : rows0;
    excludedCount += rows0.length - rows.length;
    if (rows.length) wanted.push([name, rows]);
  }
  const glbs = new Set();
  for (const [name] of wanted) { if (has(name)) glbs.add(name); if (manifest && manifest.has(name + '_lod1')) glbs.add(name + '_lod1'); }
  let done = 0;
  const tAssets = performance.now();
  await Promise.all([...glbs].map((nm) => loadProto(nm).then(() => { done++; progress('assets', 0.2 + 0.7 * done / Math.max(glbs.size, 1)); })));
  const assetsMs = performance.now() - tAssets;
  progress('instances', 0.92);
  await tick();

  const sets = [], missing = [];
  const teamCols = { 1: new THREE.Color(TEAM_HEX[1]), 2: new THREE.Color(TEAM_HEX[2]) };
  for (const [name, rows] of wanted) {
    const proto = glbs.has(name) ? await loadProto(name) : null;
    if (!proto) { missing.push(name); continue; }
    const proto1 = glbs.has(name + '_lod1') ? await loadProto(name + '_lod1') : null;
    sets.push(makeSet(name, rows, proto, proto1));
  }
  const instTotal = sets.reduce((s, x) => s + x.n, 0);

  // One instanced set per asset (lab.js InstSet): per-instance transforms precomputed; each frame the visible ones (inside
  // the category's draw distance and the camera frustum) are packed into LOD0 or — beyond q.lod1, when a _lod1 GLB exists —
  // LOD1 buffers. Each level is one InstancedMesh per material, all sharing that level's matrix / colour buffers.
  function makeSet(name, rows, proto, proto1) {
    const info = sizes[name] || null;
    const set = { name, n: rows.length, info, cat: catOf(name, info), proto, proto1, lbox: proto.box.clone(), drawn: 0 };
    const N = set.n;
    set.X = new Float32Array(N); set.Y = new Float32Array(N); set.Z = new Float32Array(N); set.ROT = new Float32Array(N);
    set.SXY = new Float32Array(N); set.SZ = new Float32Array(N); set.TEAM = new Uint8Array(N);
    set.MAT = new Float32Array(N * 16); set.R = new Float32Array(N); set.COL = new Float32Array(N * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Yax = new THREE.Vector3(0, 1, 0);
    const corners = [];
    for (const x of [set.lbox.min.x, set.lbox.max.x]) for (const y of [set.lbox.min.y, set.lbox.max.y]) for (const z of [set.lbox.min.z, set.lbox.max.z]) corners.push(Math.hypot(x, y, z));
    const r0 = Math.max(...corners);
    const tp = proto.parts.find((x) => x.team);
    const neutral = (tp && tp.mat.userData.teamBase) || new THREE.Color(0.5, 0.5, 0.5);
    rows.forEach((r, i) => {
      // [x, y, z, rotZ, scale, team, zScale?]. export_web.py writes scale = s·sz when zScale is present (the Blender assembler
      // uses xy = s, z = sz), so the horizontal scale is recovered as scale / zScale.
      const sz = r.length > 6 ? r[6] : r[4], sxy = r.length > 6 && r[6] ? r[4] / r[6] : r[4];
      set.X[i] = r[0]; set.Y[i] = r[1]; set.Z[i] = r[2]; set.ROT[i] = r[3]; set.SXY[i] = sxy; set.SZ[i] = sz; set.TEAM[i] = r[5] || 0;
      m4.compose(p.set(r[0], r[2], -r[1]), q.setFromAxisAngle(Yax, r[3]), s.set(sxy, sz, sxy));
      m4.toArray(set.MAT, i * 16);
      set.R[i] = r0 * Math.max(sxy, sz);
      const c = teamCols[set.TEAM[i]] || neutral; set.COL.set([c.r, c.g, c.b], i * 3);
    });
    set.levels = [makeLevel(set, proto)];
    if (proto1) set.levels.push(makeLevel(set, proto1));
    return set;
  }
  function makeLevel(set, proto) {
    const N = set.n;
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 16), 16); attr.setUsage(THREE.DynamicDrawUsage);
    let colAttr = null;
    const meshes = [];
    for (const pt of proto.parts) {
      const m = new THREE.InstancedMesh(pt.geo, pt.mat, 0);   // count 0: the shared buffers below replace the per-mesh ones
      m.instanceMatrix = attr;
      if (pt.team) { if (!colAttr) { colAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); colAttr.setUsage(THREE.DynamicDrawUsage); } m.instanceColor = colAttr; }
      m.frustumCulled = false; m.count = 0; m.visible = false; m.name = `${proto.name}`;
      m.castShadow = false; m.receiveShadow = true; m.userData.set = set;
      meshes.push(m); G.inst.add(m);
      owned.geos.add(pt.geo); owned.mats.add(pt.mat);
    }
    return { meshes, attr, colAttr, idx: new Int32Array(N), count: 0 };
  }
  function setShadows(set) {
    const cast = Q.shadows && (set.cat === 'struct' || (set.cat === 'tree' && qName === 'high'));
    for (const L of set.levels) for (const m of L.meshes) m.castShadow = cast;
  }
  function updateSet(set, cam, frustum, sph) {
    const lv = set.levels;
    for (const L of lv) L.count = 0;
    const maxD = Q.dist[set.cat] ?? 1e9, maxD2 = maxD * maxD, l1 = lv[1], lod2 = Q.lod1 * Q.lod1;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let i = 0; i < set.n; i++) {
      const dx = set.X[i] - cx, dy = set.Z[i] - cy, dz = -set.Y[i] - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxD2) continue;
      sph.center.set(set.X[i], set.Z[i], -set.Y[i]); sph.radius = set.R[i];
      if (!frustum.intersectsSphere(sph)) continue;
      const L = l1 && d2 > lod2 ? l1 : lv[0];
      L.attr.array.set(set.MAT.subarray(i * 16, i * 16 + 16), L.count * 16);
      if (L.colAttr) L.colAttr.array.set(set.COL.subarray(i * 3, i * 3 + 3), L.count * 3);
      L.idx[L.count++] = i;
    }
    let total = 0;
    for (const L of lv) {
      // no zero-instance draw calls; the bounds go stale when the visible subset changes (only raycasts use them)
      for (const m of L.meshes) { m.count = L.count; m.visible = L.count > 0; m.boundingSphere = null; m.boundingBox = null; }
      if (L.count) {
        L.attr.clearUpdateRanges(); L.attr.addUpdateRange(0, L.count * 16); L.attr.needsUpdate = true;
        if (L.colAttr) { L.colAttr.clearUpdateRanges(); L.colAttr.addUpdateRange(0, L.count * 3); L.colAttr.needsUpdate = true; }
      }
      total += L.count;
    }
    set.drawn = total;
    return total;
  }

  // terrain textures (usually long done by now)
  let texInfo = null;
  { const tt0 = performance.now(), d = await texJob, waitMs = performance.now() - tt0;
    const old = [U.uTexA.value, U.uTexD.value], aniso = Math.min(Q.aniso || 1, renderer.capabilities.getMaxAnisotropy());
    const tx = makeTerrainTextures(THREE, d, aniso); U.uTexA.value = tx.albedo; U.uTexD.value = tx.detail; old.forEach((t) => t.dispose());
    owned.tex.add(tx.albedo); owned.tex.add(tx.detail);
    texInfo = { res: d.R, layers: d.L, genMs: d.ms, worker: d.worker, waitMs: Math.round(waitMs) }; }
  progress('minimap', 0.96);
  const minimapCanvas = drawMinimapBase(T, minimapSize, minimapMarks);

  // ── quality, per-frame update, stats, disposal ──
  let dirty = true, instDrawn = 0, instLod1 = 0, lastUpdateMs = 0;
  const lastCam = new THREE.Matrix4(), lastProj = new THREE.Matrix4();
  const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), _cam = new THREE.Vector3();
  function setQuality(name) {
    qName = MAP_QUALITY[name] ? name : 'medium'; Q = qOf(qName);
    for (const lod of terrainLods) { lod.levels[1].distance = Q.terrLod[0]; lod.levels[2].distance = Q.terrLod[1]; }
    if (terrainMat && terrainMat.defines.LH_HQ !== (Q.terrainHQ ? 1 : 0)) { terrainMat.defines.LH_HQ = Q.terrainHQ ? 1 : 0; terrainMat.needsUpdate = true; }
    for (const s of sets) setShadows(s);
    dirty = true;
  }
  setQuality(qName);
  /** per frame: water animation; instance culling + LOD whenever the camera (or its projection) changed */
  function update(camera, dt = 0) {
    U.uTime.value += dt;
    camera.updateMatrixWorld();
    if (!dirty && camera.matrixWorld.equals(lastCam) && camera.projectionMatrix.equals(lastProj)) return;
    const t0 = performance.now();
    lastCam.copy(camera.matrixWorld); lastProj.copy(camera.projectionMatrix); dirty = false;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    let drawn = 0, lod1 = 0;
    for (const s of sets) { drawn += updateSet(s, _cam, _frustum, _sph); if (s.levels[1]) lod1 += s.levels[1].count; }
    instDrawn = drawn; instLod1 = lod1;
    lastUpdateMs = performance.now() - t0;
  }
  /** debug overlays drawn by the terrain / water shaders (Lab layers): { grid, navBit, height, depth } */
  function setOverlay({ grid, navBit, height, depth } = {}) {
    if (grid !== undefined) U.uGridOn.value = grid ? 1 : 0;
    if (navBit !== undefined) U.uNavBit.value = navBit | 0;
    if (height !== undefined) U.uHeightOn.value = height ? 1 : 0;
    if (depth !== undefined) U.uDepthOn.value = depth ? 1 : 0;
  }
  const buildMs = performance.now() - tStart;
  function stats() {
    const info = renderer.info, byCat = {};
    for (const s of sets) { const c = byCat[s.cat] || (byCat[s.cat] = { total: 0, drawn: 0 }); c.total += s.n; c.drawn += s.drawn; }
    let imeshes = 0, ivis = 0; for (const s of sets) for (const L of s.levels) for (const m of L.meshes) { imeshes++; if (m.visible) ivis++; }
    return {
      quality: qName,
      lastRender: { drawCalls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines },
      memory: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null },
      instances: { total: instTotal, excluded: excludedCount, drawn: instDrawn, lod1: instLod1, byCategory: byCat, sets: sets.length, instancedMeshes: imeshes, instancedMeshesVisible: ivis, lastUpdateMs },
      terrain: { chunks: terrainLods.length, levels: terrainLods.map((l) => l.getCurrentLevel()).reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {}) },
      assets: { glbs: glbs.size, missing, failed: { ...failed }, assetsMs: Math.round(assetsMs) },
      structures: structNotes,
      terrainTextures: texInfo,
      buildMs: Math.round(buildMs),
    };
  }
  function dispose() {
    scene.remove(root);
    for (const s of sets) for (const L of s.levels) for (const m of L.meshes) m.dispose();
    for (const geo of owned.geos) geo.dispose();
    for (const m of owned.mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
    for (const t of owned.tex) t.dispose();
    sets.length = 0;
  }
  progress('done', 1);
  return { update, setQuality, setOverlay, minimapCanvas, terrainMesh, water, group: root, uniforms: U, stats, dispose };
}
