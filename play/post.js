// Thunderhead — post-processing for the in-game view: multisampled HDR scene buffer, screen-space ambient occlusion,
// then one output pass that applies the AO, the renderer's tone mapping (ACES), a colour grade, a light vignette, the
// sRGB transfer and dithering, straight to the canvas.
//
// Per quality preset (POST_QUALITY): low = none (the game renders straight to the canvas, as before);
// medium = MSAA ×4 + grade + cheap AO (6 samples at half resolution); high = MSAA ×4 + grade + AO (12 samples, half res).
// URL overrides: ?post=0 (off), ?ao=0, ?grade=0, ?msaa=0|2|4|8, ?aodebug=1 (show the AO buffer).
//
// Built from three's Pass / FullScreenQuad pieces rather than EffectComposer: the composer's ping-pong pair would clone the
// multisampled HDR target (a second MSAA colour + depth buffer at full size) and every extra pass would resolve it again.
// Here the scene is drawn once into its own MSAA target (colour + depth texture, resolved once), the AO runs at half
// resolution and reads that depth (normals are rebuilt from depth, so there is no extra scene pass), and the output
// pass writes the canvas. Passes per frame: scene + 2 half-res (AO, blur) + 1 full-res (output); medium/high only.
//
// AO: normalised "alchemy" obscurance over a Vogel disc of `radius` metres, rotated per pixel by a 4 × 4 Bayer pattern
// and cleaned by a 4 × 4 depth-aware blur (which exactly averages that pattern), range-checked so distant occluders do
// not leave dark halos, and upsampled depth-aware. Sky (depth 1) is never occluded.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const POST_QUALITY = {
  low: null,
  medium: { msaa: 4, grade: true, ao: { samples: 6, radius: 2.6, intensity: 1.1, bias: 0.12, mix: 0.8 } },
  high: { msaa: 4, grade: true, ao: { samples: 12, radius: 3.2, intensity: 1.3, bias: 0.10, mix: 0.9 } },
};
/** the default grade (display-referred, after tone mapping): subtle — warm highlights, cool shadows, a touch more contrast and saturation */
export const GRADE = {
  lift: [0.004, 0.006, 0.016], gamma: [1.0, 1.0, 1.0], gain: [1.0, 0.995, 0.98],
  contrast: 0.14, saturation: 1.03, shadowTint: [-0.012, -0.002, 0.014], highlightTint: [0.016, 0.006, -0.014], vignette: 0.16,
};

/** true when `quality` (low / medium / high) uses the post chain, honouring ?post=0 */
export function postWanted(quality, Q = null) { return !!POST_QUALITY[quality] && !(Q && Q.get('post') === '0'); }

const VERT = /* glsl */`
  in vec3 position; in vec2 uv; out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */`
  precision highp float; precision highp sampler2D;
  uniform vec2 uFull; uniform float uNear; uniform float uFar; uniform vec2 uProj;   // full-res size, camera planes, P[0][0], P[1][1]
  float lh_viewZ(float d) { return (uNear * uFar) / ((uFar - uNear) * d - uFar); }   // negative in front of the camera
  vec3 lh_viewPos(vec2 uv, float d) { float z = lh_viewZ(d); return vec3((uv * 2.0 - 1.0) * (-z) / uProj, z); }
`;

const AO_FRAG = /* glsl */`${COMMON}
  uniform sampler2D tDepth; uniform float uRadius; uniform float uIntensity; uniform float uBias;
  in vec2 vUv; out vec4 fragColor;
  vec3 posAt(ivec2 p) { p = clamp(p, ivec2(0), ivec2(uFull) - 1); return lh_viewPos((vec2(p) + 0.5) / uFull, texelFetch(tDepth, p, 0).r); }
  void main() {
    ivec2 hp = ivec2(gl_FragCoord.xy), ip = min(hp * 2, ivec2(uFull) - 1);
    float d = texelFetch(tDepth, ip, 0).r;
    if (d >= 1.0) { fragColor = vec4(1.0, uFar, 0.0, 1.0); return; }
    vec3 P = lh_viewPos((vec2(ip) + 0.5) / uFull, d);
    // normal from depth: the smaller of the one-sided differences on each axis (no smearing across silhouettes)
    vec3 pl = posAt(ip - ivec2(2, 0)), pr = posAt(ip + ivec2(2, 0)), pd = posAt(ip - ivec2(0, 2)), pu = posAt(ip + ivec2(0, 2));
    vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl, dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
    vec3 N = normalize(cross(dx, dy)); if (dot(N, -P) < 0.0) N = -N;
    // 4 × 4 Bayer rotation (the blur pass averages exactly this footprint)
    int bx = hp.x & 3, by = hp.y & 3;
    const float BAY[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    float rot = (BAY[by * 4 + bx] + 0.5) / 16.0 * 6.2831853;
    float rPx = clamp(uRadius * uProj.y * 0.5 * uFull.y / (-P.z), 2.0, 96.0), R2 = uRadius * uRadius, occ = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float t = (float(i) + 0.5) / float(SAMPLES), a = float(i) * 2.3999632 + rot;
      vec2 o = vec2(cos(a), sin(a)) * rPx * sqrt(t);
      vec3 v = posAt(ip + ivec2(o)) - P; float vv = dot(v, v);
      occ += max(dot(v, N) * inversesqrt(vv + 1e-4) - uBias, 0.0) * max(1.0 - vv / R2, 0.0);
    }
    float ao = clamp(1.0 - uIntensity * 1.6 * occ / float(SAMPLES), 0.0, 1.0);
    fragColor = vec4(ao, -P.z, 0.0, 1.0);
  }`;

const BLUR_FRAG = /* glsl */`
  precision highp float; precision highp sampler2D;
  uniform sampler2D tAO; in vec2 vUv; out vec4 fragColor;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(tAO, 0);
    vec2 c = texelFetch(tAO, p, 0).rg; float tol = 0.04 * c.g + 0.25, s = 0.0, w = 0.0;
    for (int j = -2; j < 2; j++) for (int i = -2; i < 2; i++) {
      vec2 q = texelFetch(tAO, clamp(p + ivec2(i, j), ivec2(0), sz - 1), 0).rg;
      float k = max(1.0 - abs(q.g - c.g) / tol, 0.0); s += q.r * k; w += k;
    }
    fragColor = vec4(w > 0.0 ? s / w : c.r, c.g, 0.0, 1.0);
  }`;

const OUT_FRAG = /* glsl */`${COMMON}
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tAO; uniform float uAOMix;
  uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform float uContrast; uniform float uSat;
  uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uVignette;
  in vec2 vUv; out vec4 fragColor;
  float lh_ao(ivec2 fp) {
    float z = -lh_viewZ(texelFetch(tDepth, fp, 0).r);
    ivec2 sz = textureSize(tAO, 0); vec2 hp = (vec2(fp) + 0.5) * 0.5 - 0.5; ivec2 b = ivec2(floor(hp)); vec2 f = hp - vec2(b);
    float s = 0.0, w = 0.0, tol = 0.04 * z + 0.25;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec2 q = texelFetch(tAO, clamp(b + ivec2(i, j), ivec2(0), sz - 1), 0).rg;
      float k = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * max(1.0 - abs(q.g - z) / tol, 0.0) + 1e-4;
      s += q.r * k; w += k;
    }
    return s / w;
  }
  float lh_hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    ivec2 fp = ivec2(gl_FragCoord.xy);
    vec4 col = texelFetch(tColor, fp, 0);
#ifdef USE_AO
    col.rgb *= mix(1.0, lh_ao(fp), uAOMix);
#endif
#if defined( ACES_FILMIC_TONE_MAPPING )
    col.rgb = ACESFilmicToneMapping(col.rgb);
#elif defined( AGX_TONE_MAPPING )
    col.rgb = AgXToneMapping(col.rgb);
#elif defined( REINHARD_TONE_MAPPING )
    col.rgb = ReinhardToneMapping(col.rgb);
#elif defined( LINEAR_TONE_MAPPING )
    col.rgb = LinearToneMapping(col.rgb);
#endif
    col = sRGBTransferOETF(col);
    vec3 c = clamp(col.rgb, 0.0, 1.0);
#ifdef USE_GRADE
    c = uGain * (c + uLift * (1.0 - c));
    c = pow(max(c, 0.0), 1.0 / uGamma);
    c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c += uShadowTint * (1.0 - l) * (1.0 - l) + uHighTint * l * l;
    vec2 q = (vUv - 0.5) * vec2(uFull.x / uFull.y, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
#endif
    c += (lh_hash(gl_FragCoord.xy) - 0.5) / 255.0;   // dither: no 8-bit banding in the sky and fog gradients
    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
#ifdef DEBUG_AO
    fragColor = vec4(vec3(lh_ao(fp)), 1.0);
#endif
  }`;

/**
 * Create the post chain for `renderer` / `scene` / `camera` at `quality`, or null when that preset uses none (or WebGL2
 * is missing). Q: the page's URLSearchParams (optional overrides). Returns
 * { enabled, render(), setSize(w, h), setQuality(name), stats(), dispose(), grade, settings }.
 * render() draws the frame to the canvas; renderer.info then counts every pass of the frame (autoReset is turned off and
 * reset at the start of each frame instead).
 */
export function createPost(renderer, scene, camera, { quality = 'medium', Q = null } = {}) {
  if (!postWanted(quality, Q) || !renderer.capabilities.isWebGL2) return null;
  const qp = (k) => (Q && Q.has(k) ? Q.get(k) : null);
  const hdr = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  let P = null, aoOn = false, gradeOn = false, msaa = 0;
  const size = new THREE.Vector2(1, 1);
  const depthTex = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType); depthTex.format = THREE.DepthFormat;
  depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: hdr, depthTexture: depthTex, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const halfOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
  const aoRT = new THREE.WebGLRenderTarget(1, 1, halfOpts), blurRT = new THREE.WebGLRenderTarget(1, 1, halfOpts);
  const common = () => ({ uFull: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 }, uProj: { value: new THREE.Vector2(1, 1) } });
  const raw = (frag, uniforms, defines = {}) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
  const aoMat = raw(AO_FRAG, Object.assign(common(), { tDepth: { value: depthTex }, uRadius: { value: 2.5 }, uIntensity: { value: 1 }, uBias: { value: 0.1 } }), { SAMPLES: 8 });
  const blurMat = raw(BLUR_FRAG, { tAO: { value: aoRT.texture } });
  const G = Object.assign({}, GRADE);
  const outMat = raw(OUT_FRAG, Object.assign(common(), {
    tColor: { value: sceneRT.texture }, tDepth: { value: depthTex }, tAO: { value: blurRT.texture }, uAOMix: { value: 0.8 }, toneMappingExposure: { value: 1 },
    uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3() }, uContrast: { value: 0 }, uSat: { value: 1 },
    uShadowTint: { value: new THREE.Vector3() }, uHighTint: { value: new THREE.Vector3() }, uVignette: { value: 0 },
  }));
  const quad = new FullScreenQuad(null);
  let lastTone = null;
  function applyGrade() {
    const u = outMat.uniforms; u.uLift.value.fromArray(G.lift); u.uGamma.value.fromArray(G.gamma); u.uGain.value.fromArray(G.gain);
    u.uContrast.value = G.contrast; u.uSat.value = G.saturation; u.uShadowTint.value.fromArray(G.shadowTint); u.uHighTint.value.fromArray(G.highlightTint); u.uVignette.value = G.vignette;
  }
  function defines() {
    const d = {}, tm = renderer.toneMapping;
    if (tm === THREE.ACESFilmicToneMapping) d.ACES_FILMIC_TONE_MAPPING = ''; else if (tm === THREE.AgXToneMapping) d.AGX_TONE_MAPPING = '';
    else if (tm === THREE.ReinhardToneMapping) d.REINHARD_TONE_MAPPING = ''; else if (tm === THREE.LinearToneMapping) d.LINEAR_TONE_MAPPING = '';
    if (aoOn) d.USE_AO = ''; if (gradeOn) d.USE_GRADE = ''; if (aoOn && qp('aodebug')) d.DEBUG_AO = '';
    outMat.defines = d; outMat.needsUpdate = true; lastTone = tm;
  }
  function setQuality(name) {
    P = POST_QUALITY[name] || null;
    if (!P) { api.enabled = false; return; }
    api.enabled = true;
    msaa = qp('msaa') != null ? +qp('msaa') : P.msaa; msaa = Math.min(Math.max(msaa | 0, 0), renderer.capabilities.maxSamples || 4);
    if (sceneRT.samples !== msaa) { sceneRT.samples = msaa; sceneRT.dispose(); }
    aoOn = !!P.ao && qp('ao') !== '0'; gradeOn = P.grade && qp('grade') !== '0';
    if (aoOn) {
      const a = P.ao, u = aoMat.uniforms;
      if (aoMat.defines.SAMPLES !== a.samples) { aoMat.defines.SAMPLES = a.samples; aoMat.needsUpdate = true; }
      u.uRadius.value = a.radius; u.uIntensity.value = a.intensity; u.uBias.value = a.bias; outMat.uniforms.uAOMix.value = a.mix;
    }
    applyGrade(); defines();
    api.settings = { quality: name, msaa, ao: aoOn ? { ...P.ao } : null, grade: gradeOn, hdr: hdr === THREE.HalfFloatType ? 'half-float' : 'rgba8' };
  }
  function setSize() {
    renderer.getDrawingBufferSize(size);
    const W = Math.max(1, size.x | 0), H = Math.max(1, size.y | 0), hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
    sceneRT.setSize(W, H); aoRT.setSize(hw, hh); blurRT.setSize(hw, hh);
    for (const m of [aoMat, outMat]) m.uniforms.uFull.value.set(W, H);
  }
  function render() {
    if (lastTone !== renderer.toneMapping) defines();
    renderer.getDrawingBufferSize(_s); if (_s.x !== sceneRT.width || _s.y !== sceneRT.height) setSize();
    const info = renderer.info; info.autoReset = false; info.reset();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
    for (const m of [aoMat, outMat]) { const u = m.uniforms; u.uNear.value = camera.near; u.uFar.value = camera.far; u.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]); }
    if (aoOn) {
      quad.material = aoMat; renderer.setRenderTarget(aoRT); quad.render(renderer);
      quad.material = blurMat; renderer.setRenderTarget(blurRT); quad.render(renderer);
    }
    outMat.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    quad.material = outMat; renderer.setRenderTarget(null); quad.render(renderer);
    renderer.setRenderTarget(prev);
  }
  const _s = new THREE.Vector2();
  function dispose() {
    for (const x of [sceneRT, aoRT, blurRT, aoMat, blurMat, outMat, depthTex, quad]) x.dispose();
    renderer.info.autoReset = true;
  }
  const stats = () => ({ ...api.settings, passes: 2 + (aoOn ? 2 : 0), size: [sceneRT.width, sceneRT.height] });
  const api = { enabled: true, render, setSize, setQuality, stats, dispose, grade: G, applyGrade, settings: null };
  setQuality(quality); setSize();
  return api;
}
