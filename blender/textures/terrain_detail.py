"""Tileable terrain detail texture (RGBA = ground, sand, rock, road heights, 0..1, mean ~0.5).
The shader uses each channel both as an albedo modulator and as a height field for per-pixel normals and
height-based splat blending. One tile spans 4 map cells. Run: python3 blender/textures/terrain_detail.py [size]"""
import sys, os, numpy as np
from PIL import Image
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:N, 0:N] / N  # 0..1, tile = 4 cells

def vnoise(freq, seed):
    """Periodic value noise with smoothstep interpolation; freq = lattice points per tile (int)."""
    g = np.random.default_rng(seed).random((freq, freq))
    x = xx * freq; y = yy * freq; i = np.floor(x).astype(int); j = np.floor(y).astype(int); fx = x - i; fy = y - j
    u = fx * fx * (3 - 2 * fx); v = fy * fy * (3 - 2 * fy)
    a = g[j % freq, i % freq]; b = g[j % freq, (i + 1) % freq]; c = g[(j + 1) % freq, i % freq]; d = g[(j + 1) % freq, (i + 1) % freq]
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v

def fbm(f0, oct, seed, gain=0.5):
    s = 0; a = 1; t = 0
    for k in range(oct): s = s + a * vnoise(f0 * 2 ** k, seed + k); t += a; a *= gain
    return s / t

def worley(cells, seed):
    """Periodic F1/F2 cellular noise; cells per tile."""
    r = np.random.default_rng(seed); pts = r.random((cells, cells, 2))
    x = xx * cells; y = yy * cells; i = np.floor(x).astype(int); j = np.floor(y).astype(int)
    F1 = np.full(x.shape, 9.0); F2 = np.full(x.shape, 9.0); ID = np.zeros(x.shape)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ci = i + di; cj = j + dj; p = pts[cj % cells, ci % cells]
            d = np.hypot(ci + p[..., 0] - x, cj + p[..., 1] - y)
            m = d < F1; F2 = np.where(m, F1, np.minimum(F2, d)); ID = np.where(m, (cj % cells) * cells + ci % cells, ID); F1 = np.where(m, d, F1)
    return F1, F2, ID

def norm(a):
    a = a - a.mean(); a = a / (np.abs(a).max() + 1e-6); return np.clip(0.5 + a * 0.5, 0, 1)

# ground: lumpy soil, grass tufts (dense high-freq clumps), scattered pebbles
soil = fbm(8, 5, 10)
Ft, _, IDt = worley(90, 20); keep = np.random.default_rng(21).random(8100)[IDt.astype(int) % 8100]
tuft = np.clip(1 - Ft / 0.55, 0, 1) ** 1.5 * (keep < np.clip((fbm(6, 2, 25) - 0.3) * 2.0, 0, 1))
F1, F2, _ = worley(48, 30); peb = np.clip(1 - F1 / 0.28, 0, 1) ** 2 * (vnoise(48, 31) > 0.62)
ground = norm(soil * 0.55 + tuft * 0.45 + peb * 0.5)

# sand: wind ripples (warped sine), dune swell, fine grain
warp = fbm(4, 3, 40) * 2.2
rip = np.sin((xx * 0.35 + yy) * 2 * np.pi * 22 + warp * 6.0) * 0.5 + 0.5
rip = rip ** 1.6 * (0.35 + 0.65 * fbm(6, 2, 41))
sand = norm(rip * 0.45 + fbm(2, 3, 42) * 0.35 + fbm(128, 2, 43) * 0.18)

# rock: cellular plates with cracks, strata, rough surface
F1, F2, ID = worley(10, 50); crack = np.clip((F2 - F1) / 0.07, 0, 1)
plate = (np.random.default_rng(51).random(100)[ID.astype(int) % 100]) * 0.3
strata = np.sin(yy * 2 * np.pi * 9 + fbm(4, 3, 52) * 5) * 0.5 + 0.5
rock = norm(crack * 0.45 + plate + strata * 0.15 + fbm(16, 5, 53) * 0.7)

# road: concrete slabs (joint every cell), aggregate, hairline cracks, tyre wear
gx = np.minimum(np.mod(xx * 4, 1), 1 - np.mod(xx * 4, 1)); gy = np.minimum(np.mod(yy * 4, 1), 1 - np.mod(yy * 4, 1))
joint = np.clip(np.minimum(gx, gy) / 0.02, 0, 1)
F1r, F2r, _ = worley(6, 60); hair = 1 - np.clip(1 - (F2r - F1r) / 0.012, 0, 1) * (fbm(8, 2, 61) > 0.55)
road = norm(joint * 0.5 + hair * 0.25 + fbm(96, 2, 62) * 0.3 + fbm(4, 3, 63) * 0.25)

img = np.stack([ground, sand, rock, road], -1)
out = os.path.join(os.path.dirname(__file__), '..', 'out', 'terrain_detail.png')
Image.fromarray((img * 255).astype(np.uint8), 'RGBA').save(out, optimize=True)
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
# preview: the four channels side by side as greyscale
Image.fromarray((np.concatenate([ground, sand, rock, road], 1) * 255).astype(np.uint8)).resize((2048, 512)).save(os.path.join(os.path.dirname(__file__), '..', 'preview', 'terrain_detail.png'))
