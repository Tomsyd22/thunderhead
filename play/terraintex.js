// Thunderhead — procedural tiling ground textures for the terrain splat (play/maprender.js terrainMaterial).
// Generated on the CPU at load (no image downloads): every layer is a seamless tile built from periodic value noise and
// periodic Voronoi cells, so it wraps without seams and mipmaps cleanly.
//
// Two RGBA8 texture arrays, one layer per ground material (LAYERS):
//   albedo: rgb = colour multiplier × 0.5 (0.5 = ×1 of the surface-class palette colour; each layer is normalised to a
//           mean of exactly 0.5 per channel, so the biome palettes keep their average colour), a = height (0…1, used for
//           height-based blending between classes)
//   detail: rg = tangent-space normal xy × 0.5 + 0.5 (u = east, v = north), b = roughness, a = cavity (local occlusion)
// Normals are physically scaled: bump depth in metres over the tile's metres per pixel, so they do not depend on R.

export const LAYERS = ['grass', 'meadow', 'dirt', 'sand', 'rock', 'concrete', 'gravel', 'asphalt', 'mud', 'farm', 'soil', 'forest'];
/** metres covered by one tile of each layer (near scale; the shader adds a rotated ×4.3 far scale for organic layers) */
export const LAYER_TILE = [6, 7, 6, 8, 10, 16, 3, 4, 6, 6, 7, 5];
/** 1 = organic (sampled at two scales to hide tiling); 0 = man-made pattern that must stay grid-aligned (concrete slabs, asphalt, farm) */
export const LAYER_ORGANIC = [1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1];
// bump depth (m) per layer
const BUMP = [0.035, 0.05, 0.05, 0.03, 0.30, 0.025, 0.07, 0.012, 0.04, 0.05, 0.035, 0.05];

// ── periodic noise ──
function hash2(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
const tables = new Map();
function table(P, Q, s) {
  const k = (P * 1024 + Q) * 8192 + s; let t = tables.get(k);
  if (!t) { t = new Float32Array(P * Q); for (let j = 0; j < Q; j++) for (let i = 0; i < P; i++) t[j * P + i] = hash2(i, j, s); tables.set(k, t); }
  return t;
}
/** periodic value noise in [0, 1]: P × Q lattice cells per tile */
function vn(u, v, P, s, Q = P) {
  const t = table(P, Q, s), x = u * P, y = v * Q, xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const i0 = ((xi % P) + P) % P, j0 = ((yi % Q) + Q) % Q, i1 = i0 + 1 === P ? 0 : i0 + 1, j1 = j0 + 1 === Q ? 0 : j0 + 1;
  const a = t[j0 * P + i0], b = t[j0 * P + i1], c = t[j1 * P + i0], d = t[j1 * P + i1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** periodic fBm in [0, 1], spread out to roughly fill the range */
function fbm(u, v, P, oct, s, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vn(u, v, P, s + o * 101); norm += amp; amp *= gain; P *= 2; }
  return clamp01((sum / norm - 0.5) * (1.6 + 0.25 * oct) + 0.5);
}
/** periodic Voronoi: f1, f2 distances (cell units), nearest cell id, offset to its point */
const VOR = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
function vor(u, v, P, s, jit = 0.9) {
  const tx = table(P, P, s), ty = table(P, P, s + 7), x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ci = xi + di, cj = yi + dj, wi = ((ci % P) + P) % P, wj = ((cj % P) + P) % P, k = wj * P + wi;
    const dx = ci + 0.5 + (tx[k] - 0.5) * jit - x, dy = cj + 0.5 + (ty[k] - 0.5) * jit - y, d = dx * dx + dy * dy;
    if (d < f1) { f2 = f1; f1 = d; id = k; bx = dx; by = dy; } else if (d < f2) f2 = d;
  }
  VOR.f1 = Math.sqrt(f1); VOR.f2 = Math.sqrt(f2); VOR.id = id; VOR.dx = bx; VOR.dy = by; return VOR;
}
const cell = (id, s) => hash2(id, 977, s);
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function sstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
const lerp = (a, b, t) => a + (b - a) * t;

// ── layers: f(u, v, o) fills o = { r, g, b, h, ro } (colour multiplier, height 0…1, roughness) ──
const GEN = {
  grass(u, v, o) {
    const clump = fbm(u, v, 12, 4, 11), blade = vn(u, v, 192, 12), blade2 = vn(u, v, 96, 13, 384), dry = 0.35 * sstep(0.55, 0.8, fbm(u, v, 8, 3, 14));
    const l = 0.62 + 0.42 * blade + 0.22 * blade2 + 0.16 * (clump - 0.5);
    o.r = l * lerp(0.92, 1.30, dry); o.g = l * lerp(1.0, 1.08, dry); o.b = l * lerp(0.85, 0.55, dry);
    const dark = sstep(0.62, 0.3, clump) * 0.12; o.r *= 1 - dark; o.g *= 1 - dark * 0.7; o.b *= 1 - dark;
    o.h = 0.45 * blade + 0.25 * blade2 + 0.3 * clump; o.ro = 0.96;
  },
  meadow(u, v, o) {
    const c = vor(u, v, 28, 21), tuft = sstep(0.75, 0.0, c.f1), cr = cell(c.id, 22);
    const blade = vn(u, v, 160, 23), patch = fbm(u, v, 10, 3, 24), dry = 0.45 * sstep(0.4, 0.75, patch);
    let l = 0.72 + 0.16 * tuft + 0.34 * blade + 0.10 * (cr - 0.5) + 0.1 * (patch - 0.5);
    o.r = l * lerp(0.95, 1.35, dry); o.g = l * lerp(1.0, 1.08, dry); o.b = l * lerp(0.8, 0.5, dry);
    if (cr < 0.05 && c.f1 < 0.16) { const f = hash2(c.id, 5, 25); if (f < 0.5) { o.r = 2.4; o.g = 2.3; o.b = 1.9; } else if (f < 0.8) { o.r = 2.6; o.g = 2.0; o.b = 0.4; } else { o.r = 1.6; o.g = 0.9; o.b = 2.2; } l = 1; }
    o.h = 0.35 * tuft + 0.45 * blade + 0.2 * patch; o.ro = 0.95;
  },
  dirt(u, v, o) {
    const base = fbm(u, v, 4, 5, 31), grain = vn(u, v, 256, 32), cr = vor(u, v, 5, 33), crack = sstep(0.04, 0.0, cr.f2 - cr.f1) * sstep(0.55, 0.75, fbm(u, v, 8, 2, 34));
    const p = vor(u, v, 44, 35), isStone = cell(p.id, 36) < 0.35, stone = isStone ? sstep(0.42, 0.25, p.f1) : 0, st = cell(p.id, 37);
    let l = 0.72 + 0.28 * (base - 0.5) + 0.18 * grain;
    l = lerp(l, 0.75 + 0.6 * st, stone); l *= 1 - 0.45 * crack;
    o.r = l * (1.0 + 0.08 * (base - 0.5)); o.g = l; o.b = l * (0.94 - 0.1 * stone);
    o.h = 0.35 * base + 0.15 * grain + 0.55 * stone - 0.35 * crack + 0.2; o.ro = 0.92;
  },
  sand(u, v, o) {
    const warp = fbm(u, v, 2, 3, 41), amp = 0.35 + 0.65 * sstep(0.25, 0.75, fbm(u, v, 2, 2, 42));
    const rip = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (11 * u + 3 * v) + warp * 3.5), ripS = Math.pow(rip, 1.6);
    const grain = vn(u, v, 320, 43), grain2 = vn(u, v, 128, 44), damp = sstep(0.55, 0.85, fbm(u, v, 4, 3, 45));
    let l = 0.92 + 0.10 * (ripS - 0.5) * amp + 0.16 * (grain - 0.5) + 0.10 * (grain2 - 0.5) - 0.10 * damp;
    o.r = l; o.g = l * 0.995; o.b = l * (0.97 - 0.03 * damp);
    const sh = vor(u, v, 70, 46); if (cell(sh.id, 47) < 0.025 && sh.f1 < 0.18) { o.r = 1.5; o.g = 1.48; o.b = 1.42; }
    o.h = 0.6 * ripS * amp + 0.25 * grain + 0.15 * grain2; o.ro = lerp(0.92, 0.75, damp);
  },
  rock(u, v, o) {
    const c = vor(u, v, 4, 51, 1.0), edge = (c.f2 - c.f1) + 0.12 * (fbm(u, v, 16, 3, 58) - 0.5), gate = sstep(0.3, 0.55, fbm(u, v, 4, 3, 57)), crack = sstep(0.05, 0.0, edge) * (0.2 + 0.6 * gate), tone = cell(c.id, 53);
    const crackFine = sstep(0.04, 0.0, vor(u, v, 13, 52).f2 - VOR.f1) * 0.45 * gate;
    const rough = fbm(u, v, 8, 5, 54), strata = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (7 * v + 1 * u) + rough * 5.0);
    const lichen = sstep(0.68, 0.82, fbm(u, v, 6, 4, 55)), grain = vn(u, v, 256, 56);
    let l = 0.80 + 0.18 * (tone - 0.5) + 0.55 * (rough - 0.5) + 0.10 * (strata - 0.5) + 0.12 * (grain - 0.5);
    l *= 1 - 0.55 * Math.max(crack, crackFine);
    o.r = l * lerp(1.0, 0.9, lichen); o.g = l * lerp(1.0, 0.97, lichen); o.b = l * lerp(1.0, 0.84, lichen);
    o.h = clamp01(0.55 + 0.30 * (rough - 0.5) * 2 * 0.5 + 0.15 * (tone - 0.5) + 0.08 * strata - 0.55 * crack - 0.25 * crackFine + 0.08 * grain); o.ro = 0.86;
  },
  concrete(u, v, o) {   // 16 m tile = 4 × 4 slabs of 4 m with recessed joints
    const R = this.R, px = 1 / R, su = u * 4, sv = v * 4, iu = Math.floor(su), iv = Math.floor(sv);
    const du = Math.min(su - iu, 1 - (su - iu)) / 4, dv = Math.min(sv - iv, 1 - (sv - iv)) / 4, dj = Math.min(du, dv);
    const joint = sstep(1.6 * px, 0.4 * px, dj), slab = hash2(iu & 3, iv & 3, 61);
    const stain = fbm(u, v, 6, 5, 62), agg = vn(u, v, 512, 63), agg2 = vn(u, v, 192, 64);
    const cr = vor(u, v, 6, 65), crack = sstep(0.025, 0.0, cr.f2 - cr.f1) * sstep(0.7, 0.85, fbm(u, v, 5, 2, 66));
    let l = 0.92 + 0.12 * (slab - 0.5) + 0.32 * (stain - 0.5) + 0.12 * (agg - 0.5) + 0.06 * (agg2 - 0.5);
    l *= 1 - 0.5 * joint - 0.35 * crack;
    o.r = l * (1.0 + 0.03 * (stain - 0.5)); o.g = l; o.b = l * (0.98 + 0.03 * slab);
    o.h = 0.7 - 0.6 * joint - 0.3 * crack + 0.08 * agg + 0.1 * slab; o.ro = 0.88 - 0.08 * (1 - stain);
  },
  gravel(u, v, o) {
    const c = vor(u, v, 30, 71, 0.95), t = cell(c.id, 72), t2 = cell(c.id, 73), r = 0.36 + 0.14 * t2;
    const dome = Math.max(0, 1 - (c.f1 / r) * (c.f1 / r)), gap = sstep(0.02, 0.0, (c.f2 - c.f1) * 0.5);
    let l = (0.68 + 0.6 * (t - 0.5)) * (0.55 + 0.45 * Math.sqrt(dome)) * (1 - 0.35 * gap) + 0.05 * (vn(u, v, 256, 74) - 0.5);
    o.r = l * (1.0 + 0.10 * (t2 - 0.5)); o.g = l; o.b = l * (0.95 - 0.08 * (t2 - 0.5));
    o.h = 0.85 * Math.sqrt(dome) * (0.7 + 0.3 * t2) + 0.1 * (1 - gap); o.ro = 0.9;
  },
  asphalt(u, v, o) {
    const agg = vn(u, v, 220, 81), agg2 = vn(u, v, 96, 82), patch = fbm(u, v, 3, 4, 83), cr = vor(u, v, 3, 84), crack = sstep(0.025, 0.0, cr.f2 - cr.f1) * sstep(0.6, 0.8, fbm(u, v, 4, 2, 85));
    const stone = sstep(0.78, 0.92, agg) * 0.5;
    const l = (0.9 + 0.25 * (patch - 0.5) + 0.2 * (agg - 0.5) + 0.1 * (agg2 - 0.5) + stone) * (1 - 0.4 * crack);
    o.r = l; o.g = l; o.b = l * 1.02;
    o.h = 0.5 + 0.3 * agg + 0.15 * agg2 - 0.5 * crack; o.ro = 0.82 - 0.1 * stone;
  },
  mud(u, v, o) {
    const base = fbm(u, v, 3, 5, 91), wet = sstep(0.55, 0.30, fbm(u, v, 2, 4, 92)), grain = vn(u, v, 200, 93);
    const rut = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (5 * u + 1 * v) + base * 3);
    const l = (0.85 + 0.35 * (base - 0.5) + 0.12 * (grain - 0.5)) * (1 - 0.25 * wet);
    o.r = l * 1.03; o.g = l; o.b = l * 0.95;
    o.h = clamp01(0.5 + 0.35 * (base - 0.5) + 0.12 * rut - 0.3 * wet + 0.08 * grain); o.ro = lerp(0.8, 0.3, wet);
  },
  farm(u, v, o) {
    const c = vor(u, v, 40, 101), clod = Math.max(0, 1 - c.f1 / 0.55), t = cell(c.id, 102), base = fbm(u, v, 4, 4, 103);
    const sp = vor(u, v, 24, 104), sprout = cell(sp.id, 105) < 0.35 ? sstep(0.3, 0.1, sp.f1) : 0;
    const l = (0.78 + 0.3 * (base - 0.5) + 0.2 * (t - 0.5)) * (0.75 + 0.3 * clod);
    o.r = lerp(l, l * 0.75, sprout); o.g = lerp(l, l * 1.45, sprout); o.b = lerp(l * 0.95, l * 0.5, sprout);
    o.h = 0.55 * clod + 0.25 * base + 0.3 * sprout; o.ro = 0.93;
  },
  soil(u, v, o) {   // compacted earth: the base pads' ground
    const base = fbm(u, v, 4, 5, 111), grain = vn(u, v, 256, 112), grain2 = vn(u, v, 100, 113);
    const p = vor(u, v, 52, 114), isStone = cell(p.id, 115) < 0.22, stone = isStone ? sstep(0.36, 0.2, p.f1) : 0, st = cell(p.id, 116);
    const cr = vor(u, v, 7, 117), crack = sstep(0.03, 0.0, cr.f2 - cr.f1) * sstep(0.68, 0.82, fbm(u, v, 5, 2, 118));
    let l = 0.82 + 0.22 * (base - 0.5) + 0.12 * (grain - 0.5) + 0.1 * (grain2 - 0.5);
    l = lerp(l, 0.7 + 0.6 * st, stone) * (1 - 0.25 * crack);
    o.r = l * (1 + 0.05 * (base - 0.5)); o.g = l; o.b = l * 0.96;
    o.h = 0.35 + 0.25 * base + 0.15 * grain + 0.45 * stone - 0.3 * crack; o.ro = 0.93;
  },
  forest(u, v, o) {   // leaf litter: overlapping leaves of mixed colour, moss patches
    let l = 0.55, r = 1, g = 1, b = 1, h = 0.2;
    for (let k = 0; k < 2; k++) {
      const c = vor(u, v, 34 + k * 9, 121 + k * 10), a = cell(c.id, 122 + k) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      const x = c.dx * ca + c.dy * sa, y = -c.dx * sa + c.dy * ca, e = (x * x) / 0.16 + (y * y) / 0.05;
      if (e < 1) { const t = cell(c.id, 124 + k); l = 0.75 + 0.55 * t * (1 - 0.3 * e); r = lerp(1.25, 0.95, t); g = lerp(0.95, 1.05, t); b = lerp(0.6, 0.85, t); h = 0.5 + 0.25 * k + 0.2 * (1 - e); }
    }
    const moss = 0.5 * sstep(0.62, 0.8, fbm(u, v, 8, 4, 128)), grain = vn(u, v, 200, 129);
    l *= 0.9 + 0.2 * grain;
    o.r = lerp(l * r, l * 0.75, moss); o.g = lerp(l * g, l * 1.3, moss); o.b = lerp(l * b, l * 0.55, moss);
    o.h = lerp(h, 0.45 + 0.2 * grain, moss); o.ro = 0.95;
  },
};

/** Generate the raw texel data (no three.js; runs in a worker). R: tile resolution in pixels. */
export function generateTerrainData(R = 256) {
  const t0 = performance.now(), L = LAYERS.length, N = R * R;
  const A = new Uint8Array(N * 4 * L), D = new Uint8Array(N * 4 * L);
  const col = new Float32Array(N * 3), hgt = new Float32Array(N), rough = new Float32Array(N), tmp = new Float32Array(N), blur = new Float32Array(N);
  const o = { r: 1, g: 1, b: 1, h: 0.5, ro: 0.9 };
  for (let li = 0; li < L; li++) {
    const gen = GEN[LAYERS[li]], ctx = { R };
    let sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < R; y++) {
      const v = (y + 0.5) / R;
      for (let x = 0; x < R; x++) {
        const u = (x + 0.5) / R, k = y * R + x;
        gen.call(ctx, u, v, o);
        col[k * 3] = o.r; col[k * 3 + 1] = o.g; col[k * 3 + 2] = o.b; hgt[k] = clamp01(o.h); rough[k] = o.ro;
        sr += o.r; sg += o.g; sb += o.b;
      }
    }
    // normalise the mean colour multiplier to exactly 1 (stored as 0.5)
    const kr = 0.5 * N / sr, kg = 0.5 * N / sg, kb = 0.5 * N / sb, off = li * N * 4;
    // cavity: height below its local (wrapped box-blurred) mean
    boxBlur(hgt, tmp, blur, R, Math.max(2, R >> 6));
    const pxm = LAYER_TILE[li] / R, s = BUMP[li] / (2 * pxm);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const k = y * R + x, q = off + k * 4;
      A[q] = to8(col[k * 3] * kr); A[q + 1] = to8(col[k * 3 + 1] * kg); A[q + 2] = to8(col[k * 3 + 2] * kb); A[q + 3] = to8(hgt[k]);
      const xl = (x + R - 1) % R, xr = (x + 1) % R, yd = (y + R - 1) % R, yu = (y + 1) % R;
      const nx = -(hgt[y * R + xr] - hgt[y * R + xl]) * s, ny = -(hgt[yu * R + x] - hgt[yd * R + x]) * s, il = 1 / Math.hypot(nx, ny, 1);
      D[q] = to8(nx * il * 0.5 + 0.5); D[q + 1] = to8(ny * il * 0.5 + 0.5); D[q + 2] = to8(rough[k]);
      D[q + 3] = to8(1 - Math.min(Math.max((blur[k] - hgt[k]) * 2.2, 0), 0.6));
    }
  }
  tables.clear();
  return { A, D, R, L, ms: Math.round(performance.now() - t0) };
}

/** Wrap generated data as two DataArrayTextures (mipmapped, repeat-wrapped). */
export function makeTerrainTextures(THREE, { A, D, R, L }, anisotropy = 1) {
  const mk = (data) => {
    const t = new THREE.DataArrayTexture(data, R, R, L);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = anisotropy; t.needsUpdate = true; return t;
  };
  return { albedo: mk(A), detail: mk(D) };
}
/** 1 × 1 neutral stand-ins (×1 colour, flat normal) used until the generated textures arrive */
export function neutralTerrainTextures(THREE) {
  const L = LAYERS.length, A = new Uint8Array(4 * L).fill(128), D = new Uint8Array(4 * L);
  for (let i = 0; i < L; i++) D.set([128, 128, 235, 255], i * 4);
  return makeTerrainTextures(THREE, { A, D, R: 1, L });
}
/**
 * Generate the textures off the main thread (a module worker running this file) so it overlaps the map's model downloads;
 * falls back to this thread where module workers are unavailable. Resolves to { A, D, R, L, ms, worker }.
 */
export function generateTerrainDataAsync(R = 256) {
  return new Promise((resolve) => {
    const local = () => resolve(Object.assign(generateTerrainData(R), { worker: false }));
    let w = null;
    try { w = new Worker(new URL('./terraintex.js', import.meta.url), { type: 'module' }); } catch (e) { local(); return; }
    const done = (fn) => { try { w.terminate(); } catch (e) { /* ignore */ } fn(); };
    w.onmessage = (e) => done(() => resolve(Object.assign(e.data, { worker: true })));
    w.onerror = (e) => { e.preventDefault?.(); done(local); };
    w.postMessage({ R });
  });
}
// worker entry point
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => { const d = generateTerrainData(e.data.R); self.postMessage(d, [d.A.buffer, d.D.buffer]); };
}
function to8(x) { x = Math.round(x * 255); return x < 0 ? 0 : x > 255 ? 255 : x; }
/** wrapped separable box blur of src (R × R) with radius r into dst (tmp: scratch) */
function boxBlur(src, tmp, dst, R, r) {
  const w = 1 / (2 * r + 1);
  for (let y = 0; y < R; y++) { let s = 0; const row = y * R; for (let i = -r; i <= r; i++) s += src[row + ((i + R) % R)];
    for (let x = 0; x < R; x++) { tmp[row + x] = s * w; s += src[row + (x + r + 1) % R] - src[row + (x - r + R) % R]; } }
  for (let x = 0; x < R; x++) { let s = 0; for (let i = -r; i <= r; i++) s += tmp[((i + R) % R) * R + x];
    for (let y = 0; y < R; y++) { dst[y * R + x] = s * w; s += tmp[((y + r + 1) % R) * R + x] - tmp[((y - r + R) % R) * R + x]; } }
}
