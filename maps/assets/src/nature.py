#!/usr/bin/env python3
"""Thunderhead maps - nature asset library: trees, shrubs, grass, flowers, rocks, cliffs, coral.

Usage (headless Blender 4.5 as a Python module):
    /home/claude/blender-env/bin/python maps/assets/src/nature.py [name ...|all] [--glb] [--quick] [--no-preview]

  name        one or more asset names (veg_oak, veg_palm, ...), or 'all' (= every veg_* asset)
  --glb       also bake the procedural materials into the 1024 px atlas and write <name>.glb (+ <name>_lod1.glb for trees)
  --glb-only  rebuild deterministically and only bake/export the GLBs (no .blend/.json/preview rewrite)
  --allow-rocks  the rock_/coral_ generators in this file are legacy; those assets are owned by the rock builder
  --quick     single low-resolution preview panel (iteration mode)
  --no-preview  skip the Cycles preview render

Outputs follow maps/ASSET_CONTRACT.md: blend/<name>.blend (collection <name>, trees also <name>_lod1),
glb/<name>.glb, bounds/<name>.json, preview/<name>.png.  1 BU = 1 m, +Z up, origin at the trunk base / ground contact.
Vegetation colour lives in a per-asset atlas: numpy-generated leaf/needle/frond/blade tiles (colour + alpha, several
shade levels so crowns get a dark interior and light sun-facing tips) plus a Cycles-baked region for bark.  The .blend
keeps the fully procedural bark/rock/coral shaders (noise + voronoi bump, strata, moss by normal Z, wetness, dirt).
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, json, time, argparse, tempfile
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
DIRS = {k: os.path.join(ASSETS, k) for k in ('blend', 'glb', 'bounds', 'preview')}
for _d in DIRS.values(): os.makedirs(_d, exist_ok=True)
TMP = os.path.join(tempfile.gettempdir(), 'thunderhead_nature'); os.makedirs(TMP, exist_ok=True)
SUN_DIR = np.array([0.35, -0.45, 0.82]); SUN_DIR = SUN_DIR / np.linalg.norm(SUN_DIR)
THREADS = 2

# ══════════════════════════════════════════════════════════════════════ basic helpers
def nrm(v):
    v = np.asarray(v, float); n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v

def perp(v):
    a = np.array([0, 0, 1.0]) if abs(v[2]) < 0.9 else np.array([1.0, 0, 0])
    return nrm(np.cross(v, a))

def rot(v, axis, ang):
    """Rodrigues rotation of v about unit axis by ang radians."""
    axis = nrm(axis); c, s = math.cos(ang), math.sin(ang)
    return v * c + np.cross(axis, v) * s + axis * np.dot(axis, v) * (1 - c)

def noise3(p, scale=1.0, octaves=3, seed=0.0):
    """Fractal Perlin noise in [-1, 1] (approx)."""
    q = Vector((p[0] * scale + seed * 17.13, p[1] * scale - seed * 5.71, p[2] * scale + seed * 3.37))
    tot, amp, norm = 0.0, 1.0, 0.0
    for _ in range(octaves):
        tot += amp * mnoise.noise(q, noise_basis='PERLIN_NEW'); norm += amp; amp *= 0.5; q = q * 2.03
    return tot / norm

def lin(c):
    """sRGB colour (what we pick by eye) -> linear value for shader-node defaults."""
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def link_obj(o, col=None):
    (col or bpy.context.scene.collection).objects.link(o); return o

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
    sc.render.engine = 'CYCLES'; use_gpu(sc)
    sc.render.threads_mode = 'FIXED'; sc.render.threads = THREADS
    try: bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backups
    except Exception: pass

# ══════════════════════════════════════════════════════════════════════ mesh builder
class MB:
    """Accumulates vertices / faces / per-corner UVs / material indices / point attributes; builds one Blender mesh."""
    def __init__(self, attrs=None):
        self.co, self.faces, self.fuv, self.fmat, self.fln = [], [], [], [], []
        self.attrs = dict(attrs or {}); self.av = {k: [] for k in self.attrs}

    def v(self, co, **at):
        self.co.append((float(co[0]), float(co[1]), float(co[2])))
        for k, dim in self.attrs.items():
            val = at.get(k)
            self.av[k].append(tuple(val) if val is not None else (0.0,) * dim)
        return len(self.co) - 1

    def f(self, idx, uv=None, mat=0, ln=None):
        self.faces.append(tuple(idx)); self.fuv.append(list(uv) if uv else [(0.0, 0.0)] * len(idx)); self.fmat.append(mat)
        self.fln.append(ln)

    def tris(self): return sum(len(f) - 2 for f in self.faces)

    def build(self, name, mats):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.co, [], self.faces)
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', [c for uvs in self.fuv for uv in uvs for c in uv])
        me.polygons.foreach_set('material_index', self.fmat)
        for k, dim in self.attrs.items():
            if dim == 3:
                a = me.attributes.new(k, 'FLOAT_VECTOR', 'POINT'); a.data.foreach_set('vector', [c for t in self.av[k] for c in t])
            elif dim == 1:
                a = me.attributes.new(k, 'FLOAT', 'POINT'); a.data.foreach_set('value', [t[0] for t in self.av[k]])
        for m in mats: me.materials.append(m)
        me.update()
        if any(l is not None for l in self.fln):
            ln = []
            for fi, l in enumerate(self.fln):
                if l is None:
                    vs = [np.array(self.co[i]) for i in self.faces[fi]]; n = nrm(np.cross(vs[1] - vs[0], vs[2] - vs[0])); l = [n] * len(vs)
                ln.extend(tuple(map(float, x)) for x in l)
            me.shade_smooth(); me.normals_split_custom_set(ln)
        return bpy.data.objects.new(name, me)

def parallel_frames(pts):
    n = len(pts); T = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        T.append(nrm(t))
    N = [perp(T[0])]
    for i in range(1, n):
        b = np.cross(T[i - 1], T[i]); bl = np.linalg.norm(b); Np = N[-1]
        if bl > 1e-6:
            ang = math.acos(max(-1.0, min(1.0, float(np.dot(T[i - 1], T[i])))))
            Np = rot(Np, b / bl, ang)
        Np = nrm(Np - T[i] * np.dot(Np, T[i])); N.append(Np)
    B = [np.cross(T[i], N[i]) for i in range(n)]
    return T, N, B

def tube(mb, pts, radii, sides, mat=0, tip=True, s0=0.0, rfun=None, tex_r=None):
    """Tapered tube along pts. Writes 'barkco' = (cos*r, sin*r, length) for seamless branch-aligned bark textures.
    rfun(i, theta) -> radius multiplier (root flare, ring scars)."""
    pts = [np.asarray(p, float) for p in pts]
    T, N, B = parallel_frames(pts)
    rings, s = [], s0
    for i, (p, r) in enumerate(zip(pts, radii)):
        if i: s += float(np.linalg.norm(pts[i] - pts[i - 1]))
        ring = []
        for k in range(sides):
            th = 2 * math.pi * k / sides; d = math.cos(th) * N[i] + math.sin(th) * B[i]
            rr = r * (rfun(i, th) if rfun else 1.0); tr = tex_r if tex_r else r
            ring.append(mb.v(p + d * rr, barkco=(math.cos(th) * tr, math.sin(th) * tr, s)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            mb.f([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], mat=mat)
    if tip:
        tp = pts[-1] + T[-1] * radii[-1] * 1.2
        ti = mb.v(tp, barkco=(0, 0, s + radii[-1]))
        for k in range(sides): mb.f([rings[-1][k], rings[-1][(k + 1) % sides], ti], mat=mat)
    return s

def card(mb, p, up, nm, w, h, rect, anchor=0.12, mat=0, flip=False, sc=None, round_=0.7):
    """Alpha card: anchored at p (the twig end), extends along 'up', facing 'nm'. rect = atlas (u0, v0, u1, v1).
    sc = shading centre: corner normals bend toward (corner - sc) so a crown shades like a rounded volume instead of
    a heap of flat planes (the card is also turned to face away from sc so front faces are seen from outside)."""
    up = nrm(up); nm = nrm(nm - up * np.dot(nm, up))
    if np.linalg.norm(nm) < 1e-6: nm = perp(up)
    base = p - up * h * anchor
    if sc is not None and np.dot(nm, base + up * h * 0.5 - sc) < 0: nm = -nm
    rt = nrm(np.cross(up, nm))
    cs = [base - rt * w / 2, base + rt * w / 2, base + up * h + rt * w / 2, base + up * h - rt * w / 2]
    ids = [mb.v(c) for c in cs]
    u0, v0, u1, v1 = rect
    if flip: u0, u1 = u1, u0
    ln = None
    if sc is not None:
        ln = [nrm(nrm(c - sc) * round_ + nm * (1 - round_)) for c in cs]
    mb.f(ids, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)], mat=mat, ln=ln)

def strip(mb, pts, widths, normals, rect, mat=0, fold=0.0, uv_v=None):
    """Ribbon (grass blade, frond, strap leaf) along pts. widths[i] full width; normals[i] ribbon face normal.
    fold > 0 adds a centre spine (V-shaped cross section) lifted by fold*width along the normal."""
    u0, v0, u1, v1 = rect; n = len(pts)
    T, _, _ = parallel_frames([np.asarray(p, float) for p in pts])
    rows = []
    for i in range(n):
        nm = nrm(np.asarray(normals[i], float) - T[i] * np.dot(normals[i], T[i]))
        rt = nrm(np.cross(T[i], nm)); w = widths[i]; t = uv_v[i] if uv_v else i / (n - 1)
        vv = v0 + (v1 - v0) * t
        if fold > 0:
            row = [(pts[i] - rt * w / 2, u0), (pts[i] + nm * w * fold, (u0 + u1) / 2), (pts[i] + rt * w / 2, u1)]
        else:
            row = [(pts[i] - rt * w / 2, u0), (pts[i] + rt * w / 2, u1)]
        rows.append([(mb.v(c), (u, vv)) for c, u in row])
    for i in range(n - 1):
        A, Bn = rows[i], rows[i + 1]
        for j in range(len(A) - 1):
            if i == n - 2 and widths[-1] < 1e-4 and len(A) == 2:   # pointed tip -> triangle
                mb.f([A[j][0], A[j + 1][0], Bn[j][0]], uv=[A[j][1], A[j + 1][1], ((u0 + u1) / 2, Bn[j][1][1])], mat=mat)
            else:
                mb.f([A[j][0], A[j + 1][0], Bn[j + 1][0], Bn[j][0]], uv=[A[j][1], A[j + 1][1], Bn[j + 1][1], Bn[j][1]], mat=mat)

# ══════════════════════════════════════════════════════════════════════ textures (numpy rasteriser)
class Canvas:
    """RGBA-ish painting surface in card space (u right, v up; row 0 = bottom like Blender images).
    A: alpha, S: shade multiplier, K: 0 = leaf/blade, 1 = twig/stem, Hh: per-element hue shift (-1..1),
    C: optional explicit colour layer (flowers) with its own weight Cw."""
    def __init__(self, w, h):
        self.w, self.h = w, h
        z = lambda: np.zeros((h, w), np.float32)
        self.A, self.S, self.K, self.Hh, self.Cw = z(), z(), z(), z(), z()
        self.C = np.zeros((h, w, 3), np.float32)

    def _box(self, xs, ys, pad):
        x0 = max(0, int(min(xs) - pad)); x1 = min(self.w, int(max(xs) + pad) + 1)
        y0 = max(0, int(min(ys) - pad)); y1 = min(self.h, int(max(ys) + pad) + 1)
        return x0, x1, y0, y1

    def _over(self, sl, a, shade, kind, hue, col=None):
        ys, xs = sl
        A = self.A[ys, xs]; inv = 1 - a
        self.S[ys, xs] = shade * a + self.S[ys, xs] * inv
        self.K[ys, xs] = kind * a + self.K[ys, xs] * inv
        self.Hh[ys, xs] = hue * a + self.Hh[ys, xs] * inv
        cw = 1.0 if col is not None else 0.0
        if col is not None:
            self.C[ys, xs] = np.asarray(col, np.float32)[None, None, :] * a[..., None] + self.C[ys, xs] * inv[..., None] if np.ndim(col) == 1 else col * a[..., None] + self.C[ys, xs] * inv[..., None]
        self.Cw[ys, xs] = cw * a + self.Cw[ys, xs] * inv
        self.A[ys, xs] = a + A * inv

    def seg(self, p0, p1, r0, r1, shade=0.6, kind=1.0, hue=0.0, col=None):
        """Tapered line from p0 to p1 (card units), radii in card units."""
        W, H = self.w, self.h
        x0p, y0p, x1p, y1p = p0[0] * W, p0[1] * H, p1[0] * W, p1[1] * H
        R0, R1 = r0 * W, r1 * W
        bx = self._box([x0p, x1p], [y0p, y1p], max(R0, R1) + 2)
        if bx[0] >= bx[1] or bx[2] >= bx[3]: return
        ys, xs = np.mgrid[bx[2]:bx[3], bx[0]:bx[1]].astype(np.float32) + 0.5
        dx, dy = x1p - x0p, y1p - y0p; L2 = dx * dx + dy * dy + 1e-9
        t = np.clip(((xs - x0p) * dx + (ys - y0p) * dy) / L2, 0, 1)
        dist = np.hypot(xs - (x0p + t * dx), ys - (y0p + t * dy)); r = R0 + (R1 - R0) * t
        a = np.clip(r - dist + 0.5, 0, 1) * np.clip(r * 2.0, 0.35, 1.0)
        if not a.any(): return
        sh = shade * (0.85 + 0.3 * np.clip(1 - dist / np.maximum(r, 0.5), 0, 1))
        self._over((slice(bx[2], bx[3]), slice(bx[0], bx[1])), a, sh, kind, hue, col)

    def leaf(self, p, ang, L, Wd, shape='ellipse', shade=1.0, hue=0.0, col=None, vein=0.12, fold=0.12):
        """Leaf blade starting at p, pointing at angle ang (radians, 0 = +u), length L / max width Wd (card units)."""
        W, H = self.w, self.h; ca, sa = math.cos(ang), math.sin(ang)
        px, py = p[0] * W, p[1] * H; Lp, Wp = L * W, Wd * W
        ex = [px, px + ca * Lp, px - sa * Wp / 2, px + sa * Wp / 2 + ca * Lp]
        ey = [py, py + sa * Lp, py + ca * Wp / 2, py - ca * Wp / 2 + sa * Lp]
        bx = self._box(ex, ey, Wp * 0.6 + 2)
        if bx[0] >= bx[1] or bx[2] >= bx[3]: return
        ys, xs = np.mgrid[bx[2]:bx[3], bx[0]:bx[1]].astype(np.float32) + 0.5
        dx, dy = xs - px, ys - py
        lx = dx * ca + dy * sa; ly = -dx * sa + dy * ca
        t = lx / max(Lp, 1e-3); tc = np.clip(t, 0, 1)
        base = np.power(np.clip(4 * tc * (1 - tc), 0, 1), 0.6)
        if shape == 'oak':
            w = np.power(np.clip(4 * tc * (1 - tc), 0, 1), 0.5) * (0.84 + 0.16 * np.cos(2 * math.pi * 4.0 * tc)) * (0.9 + 0.2 * tc)
        elif shape == 'lance':
            w = np.power(np.clip(4 * tc * (1 - tc), 0, 1), 0.8) * (1.25 - 0.5 * tc)
        elif shape == 'rhomb':
            w = np.where(tc < 0.38, np.power(tc / 0.38, 0.7), np.power(np.clip((1 - tc) / 0.62, 0, 1), 1.15))
        elif shape == 'round':
            w = np.sqrt(np.clip(1 - (2 * tc - 1) ** 2, 0, 1))
        elif shape == 'strap':
            w = np.clip(np.minimum(tc / 0.06, 1) * np.power(np.clip((1 - tc) / 0.35, 0, 1), 0.7), 0, 1)
        elif shape == 'needle':
            w = np.clip(1 - tc, 0.15, 1)
        else:
            w = base
        hw = w * Wp / 2
        a = np.clip(hw - np.abs(ly) + 0.5, 0, 1) * ((t >= 0) & (t <= 1))
        if not a.any(): return
        rel = np.abs(ly) / np.maximum(hw, 0.5)
        sh = shade * (1 + fold * np.sign(ly)) * (0.86 + 0.26 * tc) * (0.86 + 0.14 * np.clip((1 - rel) * 3, 0, 1))
        sh = sh + vein * np.exp(-(ly / max(Wp * 0.045, 0.55)) ** 2) * (1 - tc)
        self._over((slice(bx[2], bx[3]), slice(bx[0], bx[1])), a, sh, 0.0, hue, col)

    def disc(self, p, r, shade=1.0, col=None, kind=0.0, hue=0.0, soft=0.5):
        W, H = self.w, self.h; px, py, R = p[0] * W, p[1] * H, r * W
        bx = self._box([px], [py], R + 2)
        if bx[0] >= bx[1] or bx[2] >= bx[3]: return
        ys, xs = np.mgrid[bx[2]:bx[3], bx[0]:bx[1]].astype(np.float32) + 0.5
        d = np.hypot(xs - px, ys - py); a = np.clip(R - d + soft, 0, 1)
        sh = shade * (0.8 + 0.25 * np.clip(1 - d / max(R, 0.5), 0, 1))
        self._over((slice(bx[2], bx[3]), slice(bx[0], bx[1])), a, sh, kind, hue, col)

def bezier(p0, p1, p2, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * np.asarray(p0) + 2 * (1 - t) * t * np.asarray(p1) + t * t * np.asarray(p2)

def _twig_tree(rng, cv, n_side=7, side_len=(0.28, 0.44), spread=(0.6, 1.25), twig_w=0.008, second=0.5, top_x=0.12):
    """Branching twig skeleton from the bottom centre; returns list of polylines (card units)."""
    top = np.array([0.5 + rng.uniform(-top_x, top_x), 0.9])
    main = bezier((0.5, 0.0), (0.5 + rng.uniform(-0.08, 0.08), 0.5), top, 24)
    twigs = [main]
    for k in range(n_side):
        t = 0.16 + 0.7 * (k + rng.uniform(0, 0.7)) / n_side
        i = int(t * (len(main) - 1)); p = main[i]
        d = nrm(main[min(i + 1, len(main) - 1)] - main[max(i - 1, 0)])
        side = 1 if k % 2 == 0 else -1
        ang = math.atan2(d[1], d[0]) + side * rng.uniform(*spread)
        ln = rng.uniform(*side_len) * (1.15 - 0.55 * t)
        e = np.clip(p + ln * np.array([math.cos(ang), math.sin(ang)]), 0.1, 0.9)
        tw = bezier(p, (p + e) / 2 + rng.normal(0, 0.025, 2), e, 12); twigs.append(tw)
        if rng.uniform() < second:
            j = rng.integers(4, 9); q = tw[j]; d2 = nrm(tw[j + 1] - tw[j])
            a2 = math.atan2(d2[1], d2[0]) - side * rng.uniform(0.5, 1.0); l2 = ln * rng.uniform(0.35, 0.6)
            e2 = np.clip(q + l2 * np.array([math.cos(a2), math.sin(a2)]), 0.1, 0.9)
            twigs.append(bezier(q, (q + e2) / 2, e2, 6))
    for tw in twigs:
        for j in range(len(tw) - 1):
            r = twig_w * (1 - 0.6 * j / len(tw)) * (1.4 if tw is main else 1.0)
            cv.seg(tw[j], tw[j + 1], r, r * 0.92, shade=rng.uniform(0.55, 0.7), kind=1.0)
    return twigs

def tex_broadleaf(rng, T, shape='ellipse', leaf_len=0.11, leaf_w=0.055, n_side=7, rosette=(4, 7), cover=0.5,
                  along=0.06, petiole=0.12, fan=1.2, twig_w=0.008, droop=0.0, side_len=(0.28, 0.44)):
    """Leaf-cluster card: twigs from the bottom centre, leaves in rosettes at twig tips plus alternate leaves along
    the twigs; extra rosettes are added until the alpha coverage reaches 'cover'."""
    cv = Canvas(T, T)
    twigs = _twig_tree(rng, cv, n_side, side_len, twig_w=twig_w)
    leaves = []
    def rosette_at(p, d, k):
        base = math.atan2(d[1], d[0])
        for a in np.linspace(-fan, fan, k) + rng.normal(0, 0.12, k):
            leaves.append((p, base + a - droop * math.copysign(1, a) * abs(a), rng.uniform(0.75, 1.2)))
    for tw in twigs:
        rosette_at(tw[-1], nrm(tw[-1] - tw[-2]), rng.integers(*rosette))
        L = np.sum(np.linalg.norm(np.diff(tw, axis=0), axis=1)); n = int(L / along)
        for j in range(n):
            t = 0.2 + 0.75 * (j + rng.uniform(0, 0.6)) / max(n, 1)
            i = min(int(t * (len(tw) - 1)), len(tw) - 2); d = nrm(tw[i + 1] - tw[i])
            leaves.append((tw[i], math.atan2(d[1], d[0]) + (1 if j % 2 else -1) * rng.uniform(0.6, 1.2), rng.uniform(0.7, 1.05)))
    def draw(batch):
        for oi in rng.permutation(len(batch)):
            p, ang, s = batch[oi]; L, Wd = leaf_len * s, leaf_w * s
            dv = np.array([math.cos(ang), math.sin(ang)])
            pe = np.asarray(p) + petiole * L * dv; tipp = pe + L * dv
            if not (0.02 < tipp[0] < 0.98 and 0.02 < tipp[1] < 0.98): continue
            cv.seg(p, pe, 0.0028, 0.0024, shade=0.6, kind=1.0)
            cv.leaf(pe, ang, L, Wd, shape, shade=rng.uniform(0.84, 1.08), hue=rng.uniform(-1, 1), fold=0.08)
    draw(leaves)
    for _ in range(12):
        if cv.A.mean() >= cover: break
        extra = []
        for _ in range(10):
            tw = twigs[rng.integers(len(twigs))]; i = rng.integers(3, len(tw) - 1)
            p = tw[i]; d = nrm(tw[i] - tw[i - 1])
            base = math.atan2(d[1], d[0])
            for a in rng.uniform(-fan * 1.2, fan * 1.2, rng.integers(3, 6)):
                extra.append((p, base + a, rng.uniform(0.75, 1.15)))
        draw(extra)
    return cv

def tex_needles(rng, T, n_twigs=7, needle_len=0.13, density=1.0, needle_w=0.0055, tuft_from=0.35, cover=0.42,
                spread=(0.45, 1.15), side_len=(0.3, 0.42), radiate=1.0):
    """Pine branchlet: fanned shoots, each a bottlebrush of long needles, densest toward the shoot tip."""
    cv = Canvas(T, T)
    twigs = _twig_tree(rng, cv, n_twigs, side_len, spread, 0.0065, 0.35, 0.06)
    def needles(n_per):
        segs = []
        for tw in twigs:
            L = np.sum(np.linalg.norm(np.diff(tw, axis=0), axis=1)); n = int(n_per * density * L / 0.3)
            for _ in range(n):
                t = tuft_from + (1 - tuft_from) * math.sqrt(rng.uniform(0, 1))
                i = min(int(t * (len(tw) - 1)), len(tw) - 2); p = tw[i] + (tw[i + 1] - tw[i]) * rng.uniform(0, 1)
                d = nrm(tw[i + 1] - tw[i]); base = math.atan2(d[1], d[0])
                ang = base + rng.choice((-1, 1)) * rng.uniform(0.35, radiate)
                ln = needle_len * rng.uniform(0.7, 1.15)
                e = p + ln * np.array([math.cos(ang), math.sin(ang)])
                if not (0.01 < e[0] < 0.99 and 0.01 < e[1] < 0.99): continue
                segs.append((p, e, rng.uniform(0.72, 1.15), rng.uniform(-1, 1)))
            d = nrm(tw[-1] - tw[-2]); base = math.atan2(d[1], d[0])
            for _ in range(int(26 * density)):
                ang = base + rng.normal(0, 0.5) * radiate; ln = needle_len * rng.uniform(0.6, 1.05)
                e = tw[-1] + ln * np.array([math.cos(ang), math.sin(ang)])
                if 0.01 < e[0] < 0.99 and 0.01 < e[1] < 0.99: segs.append((tw[-1], e, rng.uniform(0.95, 1.3), rng.uniform(-1, 1)))
        for oi in rng.permutation(len(segs)):
            p, e, s, h = segs[oi]
            cv.seg(p, e, needle_w, needle_w * 0.4, shade=s, kind=0.0, hue=h)
    needles(80)
    for _ in range(4):
        if cv.A.mean() >= cover: break
        needles(30)
    return cv

def bleed(rgb, a):
    """Fill transparent texels with the mean opaque colour (avoids dark fringes when filtered)."""
    m = a > 0.5
    if m.any():
        mean = rgb[m].mean(axis=0); rgb[~m] = mean * 0.85 + rgb[~m] * 0.15
    return rgb

def colourize(cv, col, twig_col=(0.30, 0.22, 0.15), hue_amt=0.06, hue_dir=(1.0, 0.75, -0.6), sat=1.0):
    """Turn a Canvas into an RGBA tile: leaf colour * shade, per-leaf hue jitter, twigs in bark colour."""
    col = np.asarray(col, np.float32); tw = np.asarray(twig_col, np.float32)
    leafc = col[None, None, :] * cv.S[..., None]
    leafc = leafc + cv.Hh[..., None] * hue_amt * np.asarray(hue_dir, np.float32)[None, None, :] * col.mean()
    twc = tw[None, None, :] * (cv.S[..., None] / 0.6)
    rgb = leafc * (1 - cv.K[..., None]) + twc * cv.K[..., None]
    if cv.Cw.any():
        rgb = rgb * (1 - cv.Cw[..., None]) + cv.C * cv.S[..., None] * cv.Cw[..., None]
    rgb = np.clip(rgb, 0, 1)
    rgb = bleed(rgb, cv.A)
    return np.concatenate([rgb, cv.A[..., None]], axis=2)

class Atlas:
    """1024 px atlas assembled from tiles (numpy RGBA, sRGB values). Cells of 64 px, first-fit allocation."""
    def __init__(self, name, size=1024, cell=64):
        self.name, self.size, self.cell = name, size, cell
        self.px = np.zeros((size, size, 4), np.float32); self.px[..., 3] = 1.0
        self.occ = np.zeros((size // cell, size // cell), bool); self.rects = {}; self.img = None

    def alloc(self, key, w, h):
        cw, ch = -(-w // self.cell), -(-h // self.cell); n = self.size // self.cell
        for cy in range(n - ch + 1):
            for cx in range(n - cw + 1):
                if not self.occ[cy:cy + ch, cx:cx + cw].any():
                    self.occ[cy:cy + ch, cx:cx + cw] = True
                    x, y = cx * self.cell, cy * self.cell
                    hp = 1.5 / self.size
                    self.rects[key] = (x / self.size + hp, y / self.size + hp, (x + w) / self.size - hp, (y + h) / self.size - hp)
                    self.rects[key + '#px'] = (x, y, w, h)
                    return self.rects[key]
        raise RuntimeError('atlas full: ' + key)

    def put(self, key, rgba):
        h, w = rgba.shape[:2]
        if key not in self.rects: self.alloc(key, w, h)
        x, y, _, _ = self.rects[key + '#px']; self.px[y:y + h, x:x + w] = rgba
        return self.rects[key]

    def image(self):
        if self.img is None:
            self.img = bpy.data.images.new(self.name, self.size, self.size, alpha=True)
            self.img.colorspace_settings.name = 'sRGB'; self.img.alpha_mode = 'STRAIGHT'
        self.img.pixels.foreach_set(self.px.ravel())
        self.img.update(); self.img.pack()
        return self.img

    def blit_image(self, key, img):
        """Copy a Blender image (e.g. a bake result) into a reserved rect."""
        x, y, w, h = self.rects[key + '#px']
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a)
        a = a.reshape(img.size[1], img.size[0], 4)
        if a.shape[0] != h or a.shape[1] != w:
            yi = (np.arange(h) * a.shape[0] / h).astype(int); xi = (np.arange(w) * a.shape[1] / w).astype(int)
            a = a[yi][:, xi]
        a[..., 3] = 1.0; self.px[y:y + h, x:x + w] = a

def remap_uv(obj, rect):
    u0, v0, u1, v1 = rect; uv = obj.data.uv_layers['UVMap']
    a = np.empty(len(uv.data) * 2, np.float32); uv.data.foreach_get('uv', a); a = a.reshape(-1, 2)
    a[:, 0] = u0 + a[:, 0] * (u1 - u0); a[:, 1] = v0 + a[:, 1] * (v1 - v0)
    uv.data.foreach_set('uv', a.ravel())

def shade_tiles(atlas, key, canvases, palette, twig_col, hue_amt=0.06):
    """palette: list of shade-level colours (dark interior -> sunlit). canvases: one per layout variant.
    Returns rects[layout][level]."""
    out = []
    for li, cv in enumerate(canvases):
        row = []
        for si, c in enumerate(palette):
            row.append(atlas.put('%s_%d_%d' % (key, li, si), colourize(cv, c, twig_col, hue_amt)))
        out.append(row)
    return out

# ══════════════════════════════════════════════════════════════════════ shader helpers
def _set(nt, sock, val):
    if val is None: return
    if isinstance(val, bpy.types.NodeSocket): nt.links.new(val, sock); return
    dv = sock.default_value
    if hasattr(dv, '__len__'):
        if isinstance(val, (int, float)): val = (val,) * len(dv)
        elif len(val) == 3 and len(dv) == 4: val = (*val, 1.0)
    sock.default_value = val

class G:
    """Tiny shader-graph builder.  Methods return output sockets."""
    def __init__(self, mat):
        mat.use_nodes = True; self.m = mat; self.nt = mat.node_tree; self.N = self.nt.nodes
        for n in list(self.N):
            if n.bl_idname != 'ShaderNodeOutputMaterial': self.N.remove(n)
        self.out = [n for n in self.N if n.bl_idname == 'ShaderNodeOutputMaterial'][0]

    def node(self, t, **kw):
        n = self.N.new(t)
        for k, v in kw.items():
            if k.startswith('i_'): _set(self.nt, n.inputs[k[2:].replace('_', ' ')], v)
            else: setattr(n, k, v)
        return n

    def math(self, op, a, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp); _set(self.nt, n.inputs[0], a)
        if b is not None: _set(self.nt, n.inputs[1], b)
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        _set(self.nt, n.inputs[0], fac); _set(self.nt, n.inputs[6], a); _set(self.nt, n.inputs[7], b); return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.node('ShaderNodeMix', data_type='FLOAT'); _set(self.nt, n.inputs[0], fac); _set(self.nt, n.inputs[2], a); _set(self.nt, n.inputs[3], b); return n.outputs[0]

    def mr(self, v, a, b, c=0.0, d=1.0, clamp=True):
        n = self.node('ShaderNodeMapRange', clamp=clamp); _set(self.nt, n.inputs['Value'], v)
        for k, x in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)): _set(self.nt, n.inputs[k], x)
        return n.outputs['Result']

    def noise(self, vec=None, scale=5.0, detail=4.0, rough=0.55, dist=0.0, out='Fac'):
        n = self.node('ShaderNodeTexNoise'); _set(self.nt, n.inputs['Vector'], vec)
        for k, x in (('Scale', scale), ('Detail', detail), ('Roughness', rough), ('Distortion', dist)): _set(self.nt, n.inputs[k], x)
        return n.outputs[out]

    def voronoi(self, vec=None, scale=5.0, feature='F1', rnd=1.0, out='Distance', metric='EUCLIDEAN'):
        n = self.node('ShaderNodeTexVoronoi', feature=feature, distance=metric); _set(self.nt, n.inputs['Vector'], vec)
        _set(self.nt, n.inputs['Scale'], scale); _set(self.nt, n.inputs['Randomness'], rnd); return n.outputs[out]

    def wave(self, vec=None, scale=1.0, dist=4.0, detail=3.0, direction='Z', out='Fac'):
        n = self.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction=direction); _set(self.nt, n.inputs['Vector'], vec)
        for k, x in (('Scale', scale), ('Distortion', dist), ('Detail', detail)): _set(self.nt, n.inputs[k], x)
        return n.outputs[out]

    def ramp(self, fac, stops):
        n = self.node('ShaderNodeValToRGB'); _set(self.nt, n.inputs[0], fac); el = n.color_ramp.elements
        el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1); el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
        for pos, c in stops[1:-1]:
            e = el.new(pos); e.color = (*c, 1)
        return n.outputs[0]

    def xyz(self, vec):
        n = self.node('ShaderNodeSeparateXYZ'); _set(self.nt, n.inputs[0], vec); return n.outputs

    def vmath(self, op, a, b=None):
        n = self.node('ShaderNodeVectorMath', operation=op); _set(self.nt, n.inputs[0], a)
        if b is not None: _set(self.nt, n.inputs[1], b)
        return n.outputs[0] if op not in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs[1]

    def coord(self, kind='Object'):
        return self.node('ShaderNodeTexCoord').outputs[kind]

    def geo(self, kind):
        if not hasattr(self, '_geo'): self._geo = self.node('ShaderNodeNewGeometry')
        return self._geo.outputs[kind]

    def attr(self, name, out='Vector'):
        return self.node('ShaderNodeAttribute', attribute_name=name).outputs[out]

    def bump(self, h, strength=0.5, dist=0.05, normal=None):
        n = self.node('ShaderNodeBump'); _set(self.nt, n.inputs['Height'], h); _set(self.nt, n.inputs['Strength'], strength)
        _set(self.nt, n.inputs['Distance'], dist); _set(self.nt, n.inputs['Normal'], normal); return n.outputs['Normal']

    def bsdf(self, col, rough=0.8, spec=0.4, normal=None, metal=0.0, alpha=None):
        n = self.node('ShaderNodeBsdfPrincipled'); _set(self.nt, n.inputs['Base Color'], col); _set(self.nt, n.inputs['Roughness'], rough)
        _set(self.nt, n.inputs['Specular IOR Level'], spec); _set(self.nt, n.inputs['Metallic'], metal)
        _set(self.nt, n.inputs['Normal'], normal); _set(self.nt, n.inputs['Alpha'], alpha); return n.outputs[0]

    def output(self, shader):
        self.nt.links.new(shader, self.out.inputs['Surface'])

# ══════════════════════════════════════════════════════════════════════ materials
def bark_mat(name, crack, plate_a, plate_b, scale=3.0, aniso=0.35, moss=0.0, moss_col=(0.22, 0.30, 0.10),
             upper=None, rings=None, mud=None, bump=0.7, rough=0.88, lichen=0.0):
    """Procedural bark: voronoi plates + fissures (noise distorted) with bump, optional moss on up-facing sides,
    upper-trunk colour change (Scots pine), ring scars (palm) and a mud line (mangrove)."""
    m = bpy.data.materials.new(name); g = G(m); m['bake'] = True
    crack, plate_a, plate_b, moss_col = lin(crack), lin(plate_a), lin(plate_b), lin(moss_col)
    if upper: upper = dict(upper, crack=lin(upper['crack']), a=lin(upper['a']), b=lin(upper['b']))
    if rings: rings = dict(rings, col=lin(rings['col']), fibre=lin(rings.get('fibre', (0.2, 0.17, 0.14))))
    bc = g.attr('barkco'); vec = g.node('ShaderNodeMapping', vector_type='POINT')
    _set(g.nt, vec.inputs['Vector'], bc); vec.inputs['Scale'].default_value = (1.0, 1.0, aniso)
    v = vec.outputs[0]
    wob = g.noise(v, scale * 0.9, 3, 0.5, out='Color')
    vd = g.mix(0.18, v, wob)
    vor = g.voronoi(vd, scale, 'DISTANCE_TO_EDGE')
    fis = g.mr(vor, 0.0, 0.07)                         # 0 in cracks -> 1 on plates
    n1 = g.noise(v, scale * 3.5, 6, 0.6); n2 = g.noise(g.coord('Object'), 0.6, 2, 0.5)
    plate = g.mix(n1, plate_a, plate_b)
    plate = g.mix(g.mr(n2, 0.35, 0.65, 0, 0.35), plate, plate_b)
    col = g.mix(fis, crack, plate)
    z = g.xyz(g.coord('Object'))[2]
    if upper:
        up_m = g.mr(g.math('ADD', z, g.math('MULTIPLY', n2, upper.get('wobble', 1.5))), upper['z0'], upper['z1'])
        vor2 = g.voronoi(g.vmath('MULTIPLY', v, (1, 1, 2.2)), upper.get('scale', 7.0), 'DISTANCE_TO_EDGE')
        flake = g.mix(g.mr(vor2, 0, 0.05), upper['crack'], g.mix(n1, upper['a'], upper['b']))
        col = g.mix(up_m, col, flake)
    h = g.math('ADD', g.math('MULTIPLY', fis, 0.75), g.math('MULTIPLY', n1, 0.25))
    if rings:
        rz = g.xyz(bc)[2]
        rw = g.math('SINE', g.math('MULTIPLY', rz, 2 * math.pi / rings['spacing']))
        ring = g.mr(rw, rings.get('sharp', 0.75), 1.0)
        col = g.mix(g.math('MULTIPLY', ring, 0.8), col, rings['col'])
        h = g.math('SUBTRACT', h, g.math('MULTIPLY', ring, 0.9))
        fib = g.noise(g.vmath('MULTIPLY', bc, (30, 30, 1.5)), 1.0, 3, 0.5)
        col = g.mix(g.math('MULTIPLY', fib, 0.35), col, rings.get('fibre', crack))
    if moss > 0:
        nz = g.xyz(g.geo('Normal'))[2]
        mm = g.math('MULTIPLY', g.mr(nz, 0.1, 0.7), g.mr(g.noise(g.coord('Object'), 1.8, 4, 0.6), 0.45, 0.65))
        mm = g.math('MULTIPLY', mm, g.math('ADD', g.mr(z, 3.0, 0.0, 0.0, 0.6), 0.4))
        col = g.mix(g.math('MULTIPLY', mm, moss), col, moss_col)
    if lichen > 0:
        lm = g.mr(g.noise(g.vmath('MULTIPLY', v, 1.0), scale * 1.3, 3, 0.6), 0.62, 0.7)
        col = g.mix(g.math('MULTIPLY', lm, lichen), col, lin((0.62, 0.64, 0.55)))
    if mud:
        mm = g.mr(g.math('ADD', z, g.math('MULTIPLY', n2, 0.25)), mud + 0.15, mud - 0.1)
        col = g.mix(mm, col, lin((0.26, 0.22, 0.17)))
    nb = g.bump(h, bump, 0.04)
    g.output(g.bsdf(col, rough, 0.3, nb))
    return m

def leaf_mat(name, img, trans=0.32, rough=0.6, var=0.12, tint=(1.0, 1.15, 0.55), spec=0.25):
    """Card / blade material: atlas colour + alpha clip, mixed with a translucent lobe (no SSS) and
    position-noise variation so neighbouring clusters differ slightly in value and hue."""
    m = bpy.data.materials.new(name); g = G(m)
    tex = g.node('ShaderNodeTexImage', image=img, interpolation='Linear', extension='EXTEND')
    _set(g.nt, tex.inputs['Vector'], g.node('ShaderNodeUVMap', uv_map='UVMap').outputs[0])
    nz = g.noise(g.coord('Object'), 0.35, 2, 0.5)
    hsv = g.node('ShaderNodeHueSaturation')
    _set(g.nt, hsv.inputs['Hue'], g.mr(nz, 0.3, 0.7, 0.49, 0.51)); _set(g.nt, hsv.inputs['Value'], g.mr(nz, 0.3, 0.7, 1 - var, 1 + var))
    _set(g.nt, hsv.inputs['Saturation'], 1.0); _set(g.nt, hsv.inputs['Color'], tex.outputs['Color'])
    col = hsv.outputs[0]
    p = g.bsdf(col, rough, spec)
    tc = g.mix(1.0, col, tint, 'MULTIPLY')
    tr = g.node('ShaderNodeBsdfTranslucent'); _set(g.nt, tr.inputs['Color'], tc)
    mx = g.node('ShaderNodeMixShader'); _set(g.nt, mx.inputs[0], trans); g.nt.links.new(p, mx.inputs[1]); g.nt.links.new(tr.outputs[0], mx.inputs[2])
    a = g.math('GREATER_THAN', tex.outputs['Alpha'], 0.5)
    tp = g.node('ShaderNodeBsdfTransparent')
    mx2 = g.node('ShaderNodeMixShader'); _set(g.nt, mx2.inputs[0], a); g.nt.links.new(tp.outputs[0], mx2.inputs[1]); g.nt.links.new(mx.outputs[0], mx2.inputs[2])
    g.output(mx2.outputs[0])
    m['atlas_leaf'] = True
    return m

def gltf_mat(name, img, alpha_clip=False, rough=0.6, metal=0.0):
    """glTF-friendly material: atlas texture -> base colour, optional alpha mask (Round node => alphaMode MASK)."""
    m = bpy.data.materials.new(name); g = G(m)
    tex = g.node('ShaderNodeTexImage', image=img, interpolation='Linear')
    _set(g.nt, tex.inputs['Vector'], g.node('ShaderNodeUVMap', uv_map='UVMap').outputs[0])
    b = g.node('ShaderNodeBsdfPrincipled'); g.nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    b.inputs['Specular IOR Level'].default_value = 0.35
    if alpha_clip:
        g.nt.links.new(g.math('ROUND', tex.outputs['Alpha']), b.inputs['Alpha'])
        try: m.blend_method = 'CLIP'
        except Exception: pass
    g.output(b.outputs[0])
    return m

# ══════════════════════════════════════════════════════════════════════ tree growth (space colonisation)
class Skeleton:
    def __init__(self, pos, par, n_fixed):
        self.pos = np.asarray(pos, float); self.par = np.asarray(par, int); self.n = len(pos); self.n_fixed = n_fixed
        self.ch = [[] for _ in range(self.n)]
        for i, p in enumerate(self.par):
            if p >= 0: self.ch[p].append(i)
        self.r = np.zeros(self.n)

    def radii(self, r_tip, exp, r_base):
        r = np.zeros(self.n)
        for i in range(self.n - 1, -1, -1):
            r[i] = r_tip if not self.ch[i] else sum(r[c] ** exp for c in self.ch[i]) ** (1 / exp)
        k = r_base / r[0]; self.r = np.maximum(r * k, r_tip)
        return self

    def smooth(self, it=3):
        for _ in range(it):
            P = self.pos.copy()
            for i in range(self.n_fixed, self.n):
                if self.ch[i]:
                    P[i] = 0.5 * self.pos[i] + 0.25 * self.pos[self.par[i]] + 0.25 * np.mean(self.pos[self.ch[i]], axis=0)
            self.pos = P
        return self

    def chains(self):
        out, stack = [], [(0, None)]
        while stack:
            s, attach = stack.pop(); c = [attach] if attach is not None else []; i = s
            while True:
                c.append(i)
                if not self.ch[i]: break
                cs = sorted(self.ch[i], key=lambda q: -self.r[q])
                for q in cs[1:]: stack.append((q, i))
                i = cs[0]
            out.append(c)
        return out

    def growdir(self, i):
        p = self.par[i]
        return nrm(self.pos[i] - self.pos[p]) if p >= 0 else np.array([0, 0, 1.0])

def space_colonize(rng, trunk, att, step, d_inf, d_kill, tropism=(0, 0, 0), jitter=0.15, grow_min_z=-1e9,
                   max_iter=220, max_nodes=7000, max_children=3):
    pos = [np.asarray(p, float) for p in trunk]; par = [-1] + list(range(len(trunk) - 1)); nfix = len(pos)
    growable = [p[2] >= grow_min_z for p in pos]; nch = [1] * (nfix - 1) + [0]
    att = np.asarray(att, float); alive = np.ones(len(att), bool); trop = np.asarray(tropism, float)
    for it in range(max_iter):
        ids = [i for i in range(len(pos)) if growable[i]]
        if not ids or not alive.any(): break
        kd = KDTree(len(ids))
        for j, i in enumerate(ids): kd.insert(pos[i], j)
        kd.balance()
        acc = {}
        for ai in np.nonzero(alive)[0]:
            co, j, dist = kd.find(att[ai])
            if dist < d_kill: alive[ai] = False; continue
            if dist < d_inf:
                i = ids[j]; d = (att[ai] - pos[i]) / max(dist, 1e-6)
                if i in acc: acc[i] += d
                else: acc[i] = d.copy()
        if not acc: break
        new = []
        for i, v in acc.items():
            d = nrm(nrm(v) + trop + rng.normal(0, jitter, 3))
            new.append((pos[i] + d * step, i))
        kd2 = KDTree(len(new))
        for j, (p, i) in enumerate(new):
            pos.append(p); par.append(i); growable.append(True); nch.append(0); nch[i] += 1
            if nch[i] >= max_children: growable[i] = False
            kd2.insert(p, j)
        kd2.balance()
        for ai in np.nonzero(alive)[0]:
            if kd2.find(att[ai])[2] < d_kill: alive[ai] = False
        if len(pos) > max_nodes: break
    return Skeleton(pos, par, nfix)

def resample_chain(sk, chain, seg_fn):
    """Keep a subset of chain nodes so ring spacing follows seg_fn(radius)."""
    keep = [chain[0]]; acc = 0.0
    for a, b in zip(chain[:-1], chain[1:]):
        acc += np.linalg.norm(sk.pos[b] - sk.pos[a])
        if acc >= seg_fn(sk.r[b]) or b == chain[-1]:
            keep.append(b); acc = 0.0
    return keep

def sides_for(r, table):
    for thr, s in table:
        if r >= thr: return s
    return 0

def skeleton_bark(sk, mb, r_min, sides_table, seg_fn, flare=None, mat=0, r_scale=1.0, first_chain_extra=None, skip=None):
    """Mesh every chain whose own start radius >= r_min. Returns count of chains meshed."""
    cnt = 0
    for ci, ch in enumerate(sk.chains()):
        own = ch[1] if len(ch) > 1 and ci > 0 else ch[0]
        r0 = sk.r[own]
        if (r0 < r_min and ci > 0) or len(ch) < 2: continue
        if skip and skip(ch): continue
        keep = resample_chain(sk, ch, seg_fn)
        if ci == 0 and first_chain_extra: keep = first_chain_extra(keep)
        pts = [sk.pos[i] for i in keep]
        rad = [sk.r[i] * r_scale for i in keep]
        if ci > 0: rad[0] = sk.r[own] * r_scale * 1.05
        if len(pts) < 2: continue
        sides = sides_for(r0, sides_table)
        if sides < 3: continue
        rf = flare if ci == 0 else None
        tube(mb, pts, rad, sides, mat=mat, rfun=(lambda i, th, pts=pts, rf=rf: rf(pts[i][2], th)) if rf else None)
        cnt += 1
    return cnt

def root_flare(r_amp=0.6, height=0.9, lobes=5, phase=0.3):
    def f(z, th):
        k = math.exp(-max(z, 0) / (height * 0.45))
        return 1 + r_amp * k * (0.55 + 0.45 * max(0.0, math.cos(lobes * th + phase)) ** 2)
    return f

# ══════════════════════════════════════════════════════════════════════ card crowns
class Card:
    __slots__ = ('p', 'up', 'nm', 'w', 'h', 'lvl', 'var', 'anchor', 'sc')
    def __init__(self, p, up, nm, w, h, lvl=1, var=0, anchor=0.12, sc=None):
        self.p, self.up, self.nm, self.w, self.h, self.lvl, self.var, self.anchor = np.asarray(p, float), nrm(up), nrm(nm), w, h, lvl, var, anchor
        self.sc = None if sc is None else np.asarray(sc, float)

def emit_cards(mb, cards, tiles, mat=0, sc_default=None, round_=0.7):
    for c in cards:
        rect = tiles[c.var % len(tiles)][min(c.lvl, len(tiles[0]) - 1)]
        sc = c.sc if c.sc is not None else sc_default
        card(mb, c.p, c.up, c.nm, c.w, c.h, rect, anchor=c.anchor, mat=mat, flip=bool((int(c.p[0] * 13.7 + c.p[1] * 7.1)) % 2),
             sc=sc, round_=round_)

def light_level(light, nlev=4):
    return int(np.clip(light * nlev, 0, nlev - 0.001))

def var_index(p, nvar, seed=0.0, scale=0.22):
    v = noise3(p, scale, 2, seed)
    return int(np.clip((v * 1.6 + 1) / 2 * nvar, 0, nvar - 0.001))

def lod1_cards(cards, k, rng, size_mul=0.82, min_size=1.0):
    """Cluster cards with k-means; one larger card per cluster (keeps the crown silhouette at distance)."""
    P = np.array([c.p for c in cards]); k = min(k, len(cards))
    C = P[rng.choice(len(P), k, replace=False)]
    for _ in range(14):
        d = ((P[:, None, :] - C[None, :, :]) ** 2).sum(-1); lab = d.argmin(1)
        for j in range(k):
            m = lab == j
            if m.any(): C[j] = P[m].mean(0)
    out = []
    for j in range(k):
        idx = np.nonzero(lab == j)[0]
        if not len(idx): continue
        area = sum(cards[i].w * cards[i].h for i in idx)
        nm = nrm(sum(cards[i].nm for i in idx)); up = nrm(sum(cards[i].up for i in idx))
        if np.linalg.norm(nm) < 1e-3: nm = cards[idx[0]].nm
        if np.linalg.norm(up) < 1e-3: up = cards[idx[0]].up
        if abs(np.dot(nm, up)) > 0.95: nm = perp(up)
        s = max(min_size, math.sqrt(area) * size_mul)
        lv = int(round(np.mean([cards[i].lvl for i in idx]))); var = cards[idx[0]].var
        cen = C[j]; scs = [cards[i].sc for i in idx if cards[i].sc is not None]
        out.append(Card(cen - up * s * 0.38, up, nm, s, s, lv, var, anchor=0.12, sc=np.mean(scs, axis=0) if scs else None))
    return out

def finish_tree_cards(rng, cards, n_target):
    if len(cards) > n_target:
        idx = rng.choice(len(cards), n_target, replace=False); cards = [cards[i] for i in sorted(idx)]
    return cards

# ══════════════════════════════════════════════════════════════════════ asset registry & common output
REG = {}
def asset(name, order):
    def deco(fn):
        REG[name] = (order, fn); return fn
    return deco

class Asset:
    """What a generator returns."""
    def __init__(self, name, lod0, spec, lod1=None, kind='veg', notes='', extra=None, atlas=None, bake_objs=None,
                 bake_rect=None, ground='grass', glb_mats=None, preview=None, height_range=None, sink=0.0):
        self.name, self.lod0, self.lod1, self.spec, self.kind, self.notes = name, lod0, lod1 or [], spec, kind, notes
        self.extra = extra or {}; self.atlas = atlas; self.bake_objs = bake_objs or []; self.bake_rect = bake_rect
        self.ground = ground; self.glb_mats = glb_mats or {}; self.preview = preview or {}; self.height_range = height_range
        self.sink = sink

def obj_bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get(); lo = np.full(3, np.inf); hi = np.full(3, -np.inf); tris = 0
    for o in objs:
        if o.type != 'MESH' or o.get('exclude_bounds'): continue
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        M = np.array(o.matrix_world); co = co @ M[:3, :3].T + M[:3, 3]
        lo = np.minimum(lo, co.min(0)); hi = np.maximum(hi, co.max(0))
        lt = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', lt); tris += int((lt - 2).sum())
        oe.to_mesh_clear()
    return lo, hi, tris

def transform_objs(objs, M):
    for o in objs: o.data.transform(Matrix(M.tolist())); o.data.update()

def fit_to_spec(objs, spec, others=(), mode='xyz', anchor_xy=None, zmin=None):
    """Scale meshes about the origin so their bounds match spec (per axis). anchor: keep origin where it is."""
    lo, hi, _ = obj_bounds(objs); size = hi - lo
    s = np.ones(3)
    for i in range(3):
        if spec[i] and size[i] > 1e-6: s[i] = spec[i] / size[i]
    if mode == 'uniform_z': s[:] = s[2]
    M = np.diag([s[0], s[1], s[2], 1.0])
    transform_objs(list(objs) + list(others), M)
    if zmin is not None:
        lo, hi, _ = obj_bounds(objs); T = np.eye(4); T[2, 3] = zmin - lo[2]; transform_objs(list(objs) + list(others), T)
    return s

def center_xy(objs, others=()):
    lo, hi, _ = obj_bounds(objs); T = np.eye(4); T[0, 3] = -(lo[0] + hi[0]) / 2; T[1, 3] = -(lo[1] + hi[1]) / 2
    transform_objs(list(objs) + list(others), T)

# ══════════════════════════════════════════════════════════════════════ TREES
def leaf_palette(deep, mid, light, sun):
    return [deep, mid, light, sun]

def crown_light(p, centre, radii, sun=SUN_DIR, seed=0.0, outer=None):
    """0..1 light value for a card at p: outer shell + sun-facing + high = light; deep interior = dark."""
    q = (p - centre) / radii; dist = np.linalg.norm(q)
    outer_v = np.clip(dist, 0, 1.2) if outer is None else outer
    facing = np.dot(nrm(q), sun) if dist > 1e-6 else 0
    hgt = np.clip((p[2] - (centre[2] - radii[2])) / (2 * radii[2]), 0, 1)
    v = 0.42 * outer_v ** 1.5 + 0.30 * max(facing, -0.3) + 0.22 * hgt + 0.10 * noise3(p, 0.6, 2, seed) + 0.02
    return float(np.clip(v, 0, 1))

def sc_crown_tree(rng, *, H, trunk_top, trunk_bend, lobes, n_att, step, d_inf, d_kill, tropism, jitter, grow_min_z,
                  r_base, r_tip=0.012, exp=2.45, shell=0.35, att_filter=None, max_children=3, extra_trunk=None, squash=0.92):
    """Lobed crown via space colonisation. Returns Skeleton + attractor-lobe list."""
    tp = np.asarray(trunk_top, float); n_tr = max(4, int(tp[2] / 0.45))
    trunk = []
    for i in range(n_tr + 1):
        t = i / n_tr
        b = np.array([trunk_bend[0] * math.sin(t * math.pi * 0.9), trunk_bend[1] * math.sin(t * math.pi * 0.7), 0])
        trunk.append(np.array([tp[0] * t ** 1.6, tp[1] * t ** 1.6, -0.25 + (tp[2] + 0.25) * t]) + b)
    att = []
    tot = sum(r ** 3 for c, r in lobes)
    for c, r in lobes:
        n = int(n_att * r ** 3 / tot) + 4
        for _ in range(n * 3):
            if n <= 0: break
            d = nrm(rng.normal(0, 1, 3)); f = rng.uniform(shell, 1.0) ** (1 / 3)
            p = np.asarray(c) + d * r * f * np.array([1, 1, squash])
            if att_filter and not att_filter(p): continue
            att.append(p); n -= 1
    sk = space_colonize(rng, trunk, att, step, d_inf, d_kill, tropism, jitter, grow_min_z, max_children=max_children)
    sk.radii(r_tip, exp, r_base).smooth(3)
    return sk

def lobe_depth(p, lobes):
    """0 at/outside the lobe-union surface, ->1 deep inside."""
    best = 0.0
    for c, r in lobes:
        d = np.linalg.norm(np.asarray(p) - np.asarray(c)) / r
        best = max(best, 1 - d)
    return float(np.clip(best, 0, 1))

def tree_outputs(name, rng, sk, cards, tiles, atlas, barkm, leafm, *, H, spec_xy, r_min_geo, sides_table, seg_fn, flare,
                 budget=4000, bark_budget=1300, lod1_budget=500, lod1_rmin=None, lod1_extra=None, extra_bark=None, notes='',
                 height_range=None, extra=None, ground='grass', lod1_card_mul=0.82, lod1_extra_cards=None):
    """Common tree assembly: bark mesh within budget, cards to fill, LOD1, normalisation to spec."""
    rmin = r_min_geo
    for _ in range(40):
        bmb = MB({'barkco': 3}); skeleton_bark(sk, bmb, rmin, sides_table, seg_fn, flare)
        if extra_bark: extra_bark(bmb, 'lod0')
        if bmb.tris() <= bark_budget: break
        rmin *= 1.12
    n_cards = (budget - bmb.tris() - 4) // 2
    cards = finish_tree_cards(rng, cards, n_cards)
    lmb = MB(); emit_cards(lmb, cards, tiles)
    bark = bmb.build(name + '_bark', [barkm]); leaves = lmb.build(name + '_leaves', [leafm])
    # LOD1
    b1 = MB({'barkco': 3}); lr = lod1_rmin or max(rmin * 3, 0.06)
    for _ in range(40):
        b1 = MB({'barkco': 3})
        skeleton_bark(sk, b1, lr, [(0.25, 6), (0.1, 4), (0.0, 3)], lambda r: max(1.6, seg_fn(r) * 2.2), None)
        if lod1_extra: lod1_extra(b1)
        if b1.tris() <= 130: break
        lr *= 1.15
    k = (lod1_budget - b1.tris() - 6) // 2
    c1 = lod1_cards(cards, k, rng, lod1_card_mul) if not lod1_extra_cards else lod1_extra_cards(cards, k)
    l1 = MB(); emit_cards(l1, c1, tiles)
    bark1 = b1.build(name + '_lod1_bark', [barkm]); leaves1 = l1.build(name + '_lod1_leaves', [leafm])
    lod0 = [bark, leaves]; lod1 = [bark1, leaves1]
    for o in lod0 + lod1: link_obj(o)
    # normalise: height exactly H (z from -0.2), crown width to spec
    lo, hi, _ = obj_bounds(lod0)
    s = np.array([spec_xy[0] / (hi[0] - lo[0]), spec_xy[1] / (hi[1] - lo[1]), H / (hi[2] - lo[2])])
    transform_objs(lod0 + lod1, np.diag([*s, 1.0]))
    lo, hi, _ = obj_bounds(lod0); T = np.eye(4); T[2, 3] = -0.2 - lo[2]; transform_objs(lod0 + lod1, T)
    ex = {'trunk_base_radius_m': round(float(sk.r[0] * s[0]), 3), 'axis_scale_applied': [round(float(x), 3) for x in s]}
    ex.update(extra or {})
    return Asset(name, lod0, [spec_xy[0], spec_xy[1], H], lod1=lod1, kind='tree', atlas=atlas, bake_objs=[bark, bark1],
                 notes=notes, extra=ex, ground=ground, height_range=height_range, sink=0.2)

def std_leaf_setup(name, rng, kind_fn, palette, twig_col, nlayouts=3, T=256, bark_px=512, hue_amt=0.06):
    atlas = Atlas(name + '_atlas')
    atlas.alloc('bark', bark_px, bark_px)
    canv = [kind_fn(np.random.default_rng(rng.integers(1 << 30)), T) for _ in range(nlayouts)]
    tiles = shade_tiles(atlas, 'leaf', canv, palette, twig_col, hue_amt)
    return atlas, tiles

@asset('veg_oak', 10)
def gen_oak(name):
    rng = np.random.default_rng(1401); H = 14.0
    pal = leaf_palette((0.13, 0.19, 0.07), (0.22, 0.32, 0.11), (0.32, 0.43, 0.14), (0.44, 0.54, 0.19))
    atlas, tiles = std_leaf_setup(name, rng, lambda r, T: tex_broadleaf(r, T, 'oak', 0.088, 0.05, 8, (5, 8), 0.56), pal, (0.27, 0.21, 0.15))
    lobes = ring_lobes(rng, [(7, (4.8, 6.0), (6.4, 7.3), (2.4, 3.1), 0.0), (6, (2.6, 3.8), (8.8, 9.8), (2.8, 3.4), 0.5),
                             (3, (0.0, 1.8), (10.9, 11.6), (2.6, 3.0), 1.1)])
    C = np.array([0.0, 0.0, 8.8]); R = np.array([8.0, 8.0, 5.5])
    sk = sc_crown_tree(rng, H=H, trunk_top=(0.35, 0.1, 4.3), trunk_bend=(0.18, -0.12), lobes=lobes, n_att=2000, step=0.45,
                       d_inf=3.6, d_kill=0.95, tropism=(0, 0, 0.0), jitter=0.3, grow_min_z=3.4, r_base=0.55, shell=0.5,
                       att_filter=lambda p: p[2] > 5.0, squash=0.72)
    cards = lobe_cards(rng, sk, lobes, C, R, 2800, (1.15, 1.7), r_card=0.07, zmin=4.2, seed=1.0, nm_noise=1.1)
    barkm = bark_mat(name + '_bark', (0.05, 0.045, 0.04), (0.20, 0.19, 0.16), (0.31, 0.29, 0.25), 3.2, 0.32, moss=0.8, lichen=0.22)
    leafm = leaf_mat(name + '_leaf', atlas.image())
    return tree_outputs(name, rng, sk, cards, tiles, atlas, barkm, leafm, H=H, spec_xy=(16.0, 15.5), r_min_geo=0.03,
                        sides_table=BROAD_SIDES, seg_fn=broad_seg, flare=root_flare(0.55, 1.0, 5), bark_budget=1150,
                        height_range=[11.0, 17.0], notes='English oak: short heavy trunk forking at ~4.3 m into crooked, '
                        'spreading limbs; broad lobed crown (15 sub-domes in three rings) of oak-leaf cluster cards.',
                        extra={'crown_base_m': 4.6, 'biomes': ['emerald_strait']})

BROAD_SIDES = [(0.3, 10), (0.14, 7), (0.07, 5), (0.03, 4), (0.0, 3)]
def broad_seg(r): return 0.7 if r >= 0.2 else float(min(1.8, 0.9 + (0.2 - r) * 5))

def ring_lobes(rng, rings):
    """rings: [(count, (rho0, rho1), (z0, z1), (r0, r1), phase)] -> list of (centre, radius)."""
    out = []
    for cnt, rho, zz, rr, ph in rings:
        for i in range(cnt):
            az = ph + i * 2 * math.pi / cnt + rng.uniform(-0.35, 0.35); rh = rng.uniform(*rho)
            out.append((np.array([math.cos(az) * rh, math.sin(az) * rh, rng.uniform(*zz)]), rng.uniform(*rr)))
    return out

def lobe_cards(rng, sk, lobes, C, R, n, size, r_card=0.07, zmin=0.0, max_depth=0.5, seed=1.0, nvar=3, up_z=0.35,
               nm_noise=0.9, nm_up=0.5, jitter=0.25, aspect=1.0):
    """Cards on the thin twigs of a space-colonised crown, weighted toward the lobe surfaces."""
    rc = max(r_card, float(sk.r.min()) * 2.5)
    cand = [i for i in range(sk.n) if sk.r[i] < rc and sk.pos[i][2] > zmin]
    dep = np.array([lobe_depth(sk.pos[i], lobes) for i in cand])
    w = (1 - dep) ** 3 + 0.02; w /= w.sum()
    cards = []
    for i in rng.choice(cand, n, p=w):
        p = sk.pos[i] + rng.normal(0, jitter, 3); d = lobe_depth(p, lobes)
        if d > max_depth: continue
        near = min(lobes, key=lambda l: np.linalg.norm(p - l[0]) / l[1])
        out = nrm(nrm(p - near[0]) * 0.7 + nrm(p - C) * 0.3)
        up = nrm(sk.growdir(i) * 0.8 + out * 0.9 + np.array([0, 0, up_z]) + rng.normal(0, 0.35, 3))
        nm = nrm(out + np.array([0, 0, nm_up]) + rng.normal(0, nm_noise, 3))
        light = crown_light(p, C, R, seed=seed, outer=1 - d)
        s = rng.uniform(*size)
        cards.append(Card(p, up, nm, s, s * aspect, light_level(light), var_index(p, nvar, seed + 1),
                          sc=near[0] * 0.6 + C * 0.4))
    return cards

# ─────────────────────────────── conifer whorl generator
def whorl_conifer(rng, *, H, r_base, crown_base, top, Lmax, profile, whorl_dz=(0.55, 0.8), per_whorl=(4, 6),
                  elev=(-0.15, 0.55), tip_up=0.35, sub=2, sub_len=(0.4, 0.9), dead_stubs=8, lean=(0.0, 0.0)):
    """Monopodial conifer skeleton: leader + whorled branches. Returns (trunk pts, branches list of (pts, radii, t))."""
    n = int(top / 0.5) + 1; trunk = []
    for i in range(n + 1):
        t = i / n; z = -0.25 + (top + 0.25) * t
        trunk.append(np.array([lean[0] * t * t + 0.12 * math.sin(t * 5.1), lean[1] * t * t + 0.1 * math.sin(t * 4.3 + 1), z]))
    trunk = np.array(trunk)
    def trunk_at(z):
        i = np.clip(np.searchsorted(trunk[:, 2], z), 1, len(trunk) - 1); a, b = trunk[i - 1], trunk[i]
        t = (z - a[2]) / max(b[2] - a[2], 1e-6); return a + (b - a) * t
    branches = []; z = crown_base; phase = rng.uniform(0, 6.28)
    while z < top - 0.4:
        t = (z - crown_base) / (top - crown_base)
        k = rng.integers(per_whorl[0], per_whorl[1] + 1)
        for j in range(k):
            az = phase + j * 2 * math.pi / k + rng.normal(0, 0.25)
            L = Lmax * profile(t) * rng.uniform(0.8, 1.15)
            if L < 0.35: continue
            e0 = elev[0] + (elev[1] - elev[0]) * t + rng.normal(0, 0.08)
            d0 = np.array([math.cos(az) * math.cos(e0), math.sin(az) * math.cos(e0), math.sin(e0)])
            p0 = trunk_at(z); pts = [p0]; segs = 4 if L > 1.5 else 3
            for s in range(1, segs + 1):
                f = s / segs
                el = e0 - 0.12 * math.sin(f * math.pi) * (1 - t) + tip_up * f ** 2
                d = np.array([math.cos(az + 0.15 * f * rng.normal()) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)])
                pts.append(pts[-1] + nrm(d) * L / segs + rng.normal(0, 0.05, 3))
            rb = 0.018 + 0.05 * (L / Lmax) * (1 - 0.3 * t)
            branches.append((np.array(pts), rb, t, L, az))
        z += rng.uniform(*whorl_dz); phase += 0.7
    stubs = []
    for _ in range(dead_stubs):
        zz = rng.uniform(1.2, crown_base - 0.2); az = rng.uniform(0, 6.28); L = rng.uniform(0.25, 0.9)
        p0 = trunk_at(zz); d = np.array([math.cos(az), math.sin(az), rng.uniform(-0.3, 0.1)])
        stubs.append((np.array([p0, p0 + nrm(d) * L]), rng.uniform(0.018, 0.03)))
    return trunk, branches, stubs, trunk_at

def pine_clumps(rng, brs, C, R, seed, size=(1.1, 1.6), per_tip=(6, 10), sub_every=1.0, along=0.6, nm_up=1.0, flat=0.6):
    """Pine foliage: needle-card rosettes at branch tips and on short side branchlets (clumpy pads with gaps).
    Returns (cards, sub-branch list [(pts, r)])."""
    cards, subs = [], []
    def at(pts, f):
        seg = f * (len(pts) - 1); i = min(int(seg), len(pts) - 2)
        return pts[i] + (pts[i + 1] - pts[i]) * (seg - i), nrm(pts[i + 1] - pts[i])
    for pts, rb, t, L, az in brs:
        tips = [(pts[-1], nrm(pts[-1] - pts[-2]), 1.0)]
        for j in range(int(L / sub_every)):
            p, d = at(pts, rng.uniform(0.4, 0.9)); side = rng.choice((-1, 1))
            sd = nrm(rot(d, np.array([0, 0, 1.0]), side * rng.uniform(0.5, 1.1)) + np.array([0, 0, rng.uniform(0.05, 0.35)]))
            e = p + sd * rng.uniform(0.5, 1.1) * min(1.0, L / 2.0)
            tips.append((e, sd, 0.85)); subs.append((np.array([p, e]), max(0.012, rb * 0.35)))
        for e, d, sc in tips:
            for q in range(rng.integers(*per_tip)):
                up = nrm(d + rng.normal(0, 0.55, 3) + np.array([0, 0, 0.3]))
                if q < 2:   # horizontal pad cards: what an elevated RTS camera sees
                    up = nrm(np.array([d[0], d[1], 0.15]) + rng.normal(0, 0.3, 3)); nm = nrm(np.array([0, 0, 1.0]) + rng.normal(0, 0.2, 3))
                else:
                    nm = nrm(np.array([0, 0, nm_up]) + rng.normal(0, flat, 3))
                pp = e - d * rng.uniform(0.05, 0.55) + rng.normal(0, 0.15, 3)
                s = rng.uniform(*size) * sc
                cards.append(Card(pp, up, nm, s * 0.95, s, light_level(crown_light(pp, C, R, seed=seed) + 0.05), var_index(pp, 3, seed + 1),
                                  sc=np.array([0, 0, pp[2] - 1.2])))
        if along > 0:
            for j in range(int(L * along)):
                p, d = at(pts, rng.uniform(0.35, 0.8))
                up = nrm(d + rng.normal(0, 0.4, 3)); nm = nrm(np.array([0, 0, 1.0]) + rng.normal(0, 0.5, 3))
                s = rng.uniform(*size) * 0.85
                cards.append(Card(p, up, nm, s, s, light_level(crown_light(p, C, R, seed=seed) - 0.1), var_index(p, 3, seed + 1),
                                  sc=np.array([0, 0, p[2] - 1.2])))
    return cards, subs

@asset('veg_pine', 11)
def gen_pine(name):
    rng = np.random.default_rng(1602); H = 16.0
    pal = leaf_palette((0.07, 0.11, 0.07), (0.12, 0.19, 0.11), (0.18, 0.26, 0.13), (0.26, 0.34, 0.16))
    atlas, tiles = std_leaf_setup(name, rng, lambda r, T: tex_needles(r, T, 7, 0.12, 0.9, needle_w=0.0048, tuft_from=0.45, radiate=1.9, cover=0.38),
                                  pal, (0.30, 0.20, 0.13))
    top = 15.6; cb = 5.0
    prof = lambda t: max(0.1, min(1.0, 0.85 + 1.5 * t) * (1 - t) ** 0.55)   # conical below, rounded top
    trunk, brs, stubs, trunk_at = whorl_conifer(rng, H=H, r_base=0.34, crown_base=cb, top=top, Lmax=4.6, profile=prof,
                                                elev=(-0.12, 0.55), tip_up=0.45, whorl_dz=(0.6, 0.95), per_whorl=(3, 5))
    C = np.array([0, 0, (cb + top) / 2]); R = np.array([4.6, 4.6, (top - cb) / 2])
    cards, subs = pine_clumps(rng, brs, C, R, 3.0)
    for j in range(14):   # leader tuft
        z = top - 1.4 + rng.uniform(0, 1.4); p = trunk_at(min(z, top)); az = rng.uniform(0, 6.28)
        up = nrm(np.array([math.cos(az) * 0.6, math.sin(az) * 0.6, 1.0])); nm = nrm(np.array([math.cos(az + 1.57), math.sin(az + 1.57), 0.3]))
        cards.append(Card(p, up, nm, 1.0, 1.3, 3, var_index(p, 3, 4.0), sc=np.array([0, 0, p[2] - 1.5])))
    barkm = bark_mat(name + '_bark', (0.10, 0.07, 0.05), (0.36, 0.25, 0.18), (0.48, 0.35, 0.25), 2.2, 0.5, moss=0.3, lichen=0.15)
    leafm = leaf_mat(name + '_leaf', atlas.image(), trans=0.25, rough=0.78, spec=0.1)
    return conifer_outputs(name, rng, trunk, brs, stubs, cards, tiles, atlas, barkm, leafm, H=H, spec_xy=(9.2, 9.2), r_base=0.34,
                           top=top, subs=subs, height_range=[14.0, 18.0], notes='Temperate pine: straight trunk with dead stubs, '
                           'whorled branches carrying clumpy needle pads; conical crown rounding off at the top.',
                           extra={'crown_base_m': cb, 'biomes': ['emerald_strait', 'copperhead_bay']})

def conifer_outputs(name, rng, trunk, brs, stubs, cards, tiles, atlas, barkm, leafm, *, H, spec_xy, r_base, top, notes,
                    height_range, extra=None, budget=4000, bark_budget=1100, r_top=0.03, flare=None, ground='grass', subs=(),
                    trunk_sides=8):
    def trunk_r(i): return r_base * (1 - 0.92 * (trunk[i][2] / top)) ** 0.9 + r_top * (trunk[i][2] / top)
    def build_bark(lod):
        mb = MB({'barkco': 3})
        keep = [i for i in range(len(trunk)) if (trunk[i][2] < 2.0 or i % 2 == 0)] if lod == 0 else list(range(0, len(trunk), 4))
        if keep[-1] != len(trunk) - 1: keep.append(len(trunk) - 1)
        if lod == 0:
            fl = flare or root_flare(0.45, 0.8, 5)
            # extra rings near the base for the flare
            tube(mb, [trunk[i] for i in keep], [trunk_r(i) for i in keep], trunk_sides, rfun=lambda i, th, k=keep: fl(trunk[k[i]][2], th))
            for pts, rb, t, L, az in sorted(brs, key=lambda b: -b[1]):
                if mb.tris() > bark_budget - 30: break
                sides = 5 if rb > 0.05 else (4 if rb > 0.03 else 3)
                rr = [rb * (1 - 0.8 * j / (len(pts) - 1)) for j in range(len(pts))]
                tube(mb, pts, rr, sides)
            for pts, r in stubs:
                if mb.tris() > bark_budget - 10: break
                tube(mb, pts, [r, r * 0.5], 3)
            for pts, r in subs:
                if mb.tris() > bark_budget - 10: break
                tube(mb, pts, [r, r * 0.4], 3)
        else:
            tube(mb, [trunk[i] for i in keep], [trunk_r(i) * 1.05 for i in keep], 5, tip=True)
            for pts, rb, t, L, az in sorted(brs, key=lambda b: -b[3])[:10]:
                tube(mb, [pts[0], pts[-1]], [rb * 1.2, rb * 0.4], 3, tip=False)
        return mb
    bmb = build_bark(0)
    cards = finish_tree_cards(rng, cards, (budget - bmb.tris() - 4) // 2)
    lmb = MB(); emit_cards(lmb, cards, tiles)
    b1 = build_bark(1)
    c1 = lod1_cards(cards, (500 - b1.tris() - 6) // 2, rng, 0.8)
    l1 = MB(); emit_cards(l1, c1, tiles)
    lod0 = [bmb.build(name + '_bark', [barkm]), lmb.build(name + '_leaves', [leafm])]
    lod1 = [b1.build(name + '_lod1_bark', [barkm]), l1.build(name + '_lod1_leaves', [leafm])]
    for o in lod0 + lod1: link_obj(o)
    lo, hi, _ = obj_bounds(lod0)
    s = np.array([spec_xy[0] / (hi[0] - lo[0]), spec_xy[1] / (hi[1] - lo[1]), H / (hi[2] - lo[2])])
    transform_objs(lod0 + lod1, np.diag([*s, 1.0]))
    lo, hi, _ = obj_bounds(lod0); T = np.eye(4); T[2, 3] = -0.2 - lo[2]; transform_objs(lod0 + lod1, T)
    ex = {'trunk_base_radius_m': round(r_base * float(s[0]), 3), 'axis_scale_applied': [round(float(x), 3) for x in s]}
    ex.update(extra or {})
    return Asset(name, lod0, [spec_xy[0], spec_xy[1], H], lod1=lod1, kind='tree', atlas=atlas, bake_objs=[lod0[0], lod1[0]],
                 notes=notes, extra=ex, ground=ground, height_range=height_range, sink=0.2)

# ══════════════════════════════════════════════════════════════════════ SMALL VEGETATION
def tex_blade(rng, w=32, h=256, streak=0.12, dry=0.0, dry_col=(0.62, 0.55, 0.32), base=0.55, top=1.12, alpha_tip=False):
    """Grass / reed / strap-leaf tile: dark base -> light tip gradient, longitudinal veins, optional dry (straw) tip."""
    cv = Canvas(w, h); v = (np.arange(h) + 0.5) / h; u = (np.arange(w) + 0.5) / w
    ph = rng.uniform(0, 6.28, 3)
    veins = 1 + streak * (np.sin(u * 2 * math.pi * 3.2 + ph[0]) * 0.6 + np.sin(u * 2 * math.pi * 7.1 + ph[1]) * 0.4)
    mid = 1 + 0.12 * np.exp(-((u - 0.5) / 0.06) ** 2)
    cv.S[:] = (base + (top - base) * v ** 0.85)[:, None] * (veins * mid)[None, :]
    cv.A[:] = 1.0
    if dry > 0:
        m = smoothstep(1 - dry, 1 - dry * 0.35, v)[:, None] * np.ones((1, w))
        cv.C[:] = np.asarray(dry_col, np.float32); cv.Cw[:] = m
    if alpha_tip:
        hw = np.clip((1 - v) / 0.25, 0, 1)[:, None] * 0.5
        cv.A[:] = np.clip((hw - np.abs(u - 0.5)[None, :]) * w + 0.5, 0, 1)
    return cv

def tex_seedhead(rng, w=64, h=256, kind='panicle', col=(0.55, 0.50, 0.30), stalk=(0.35, 0.42, 0.18)):
    cv = Canvas(w, h); top = 0.98
    sx = 0.5 + rng.uniform(-0.05, 0.05)
    ar = h / w   # leaf() lengths are in units of canvas width
    cv.seg((0.5, 0.0), (sx, top), 0.03, 0.02, shade=0.8, kind=0.0, col=stalk)
    if kind == 'spike':      # timothy-like dense cylindrical spike on the top 40 %
        for _ in range(140):
            v = rng.uniform(0.58, 0.97); x = sx + rng.normal(0, 0.06)
            ang = math.pi / 2 + rng.normal(0, 0.5)
            cv.leaf((x, v), ang, 0.16, 0.09, 'ellipse', shade=rng.uniform(0.75, 1.15), col=col, vein=0, fold=0)
    elif kind == 'panicle':  # open nodding panicle
        for k in range(9):
            v0 = 0.45 + 0.5 * k / 9; side = 1 if k % 2 else -1; ang = math.pi / 2 - side * rng.uniform(0.35, 0.8)
            L = rng.uniform(0.25, 0.45) * (1.2 - 0.6 * k / 9)
            e = (sx + side * L * 0.9, min(0.98, v0 + L * 0.5 / ar * 2))
            cv.seg((sx, v0), e, 0.012, 0.008, shade=0.8, col=stalk)
            for j in range(4):
                t = 0.35 + 0.65 * j / 3; p = (sx + (e[0] - sx) * t, v0 + (e[1] - v0) * t)
                cv.leaf(p, ang + rng.normal(0, 0.3), 0.22, 0.10, 'ellipse', shade=rng.uniform(0.8, 1.15), col=col, vein=0, fold=0)
    elif kind == 'plume':    # reed plume: feathery, drooping to one side
        for _ in range(260):
            v = rng.uniform(0.5, 0.98); x0 = sx + (v - 0.5) * 0.25
            ang = rng.uniform(0.2, 1.2) if rng.uniform() < 0.7 else rng.uniform(1.9, 2.9)
            L = rng.uniform(0.15, 0.45) * (1.1 - (v - 0.5))
            e = (x0 + math.cos(ang) * L, v + math.sin(ang) * L / ar - 0.03)
            cv.seg((x0, v), e, 0.012, 0.004, shade=rng.uniform(0.7, 1.2), col=col)
    return cv

def tex_flower(rng, kind, T=128):
    cv = Canvas(T, T); c = (0.5, 0.5)
    if kind == 'daisy':
        n = 21
        for i in range(n):
            a = 2 * math.pi * i / n + rng.normal(0, 0.06)
            cv.leaf(c, a, 0.40 * rng.uniform(0.9, 1.05), 0.10, 'strap', shade=rng.uniform(0.88, 1.05), col=(0.94, 0.94, 0.90), vein=0.05, fold=0.04)
        cv.disc(c, 0.13, shade=1.0, col=(0.96, 0.72, 0.10))
        for _ in range(40):
            q = (0.5 + rng.normal(0, 0.05), 0.5 + rng.normal(0, 0.05)); cv.disc(q, 0.012, shade=rng.uniform(0.7, 0.95), col=(0.85, 0.55, 0.05))
    elif kind == 'buttercup':
        for cc, s in (((0.42, 0.45), 1.0), ((0.74, 0.70), 0.55), ((0.25, 0.78), 0.45)):
            for i in range(5):
                a = 2 * math.pi * i / 5 + rng.normal(0, 0.1) + s
                cv.leaf(cc, a, 0.27 * s, 0.30 * s, 'round', shade=rng.uniform(0.85, 1.1), col=(0.98, 0.82, 0.08), vein=0.0, fold=0.1)
            cv.disc(cc, 0.06 * s, shade=0.9, col=(0.75, 0.70, 0.15))
    elif kind == 'purple':   # knapweed / clover style tufted head, seen from the side (vertical card)
        cv.seg((0.5, 0.0), (0.5, 0.35), 0.03, 0.025, shade=0.8, col=(0.30, 0.40, 0.16))
        cv.disc((0.5, 0.36), 0.13, shade=0.8, col=(0.36, 0.33, 0.16))
        for _ in range(120):
            a = math.pi / 2 + rng.normal(0, 0.75); L = rng.uniform(0.18, 0.38)
            p0 = (0.5 + rng.normal(0, 0.04), 0.42)
            e = (p0[0] + math.cos(a) * L, p0[1] + math.sin(a) * L)
            cv.seg(p0, e, 0.012, 0.007, shade=rng.uniform(0.7, 1.15), col=(0.62, 0.26, 0.72))
    return cv

def grass_blades(mb, rng, n, rect_fn, h_range, base_r, width, lean=(0.05, 0.55), bend=0.9, segs=3, z0=-0.02, twist=0.5,
                 mat=0, wtaper=1.3, centre=(0.0, 0.0), stiff=1.0):
    """Clump of blade ribbons. rect_fn(i, L, lean) -> atlas rect. Blades arch outward, pointed tips."""
    for i in range(n):
        rr = base_r * math.sqrt(rng.uniform()); a = rng.uniform(0, 2 * math.pi)
        b = np.array([centre[0] + rr * math.cos(a), centre[1] + rr * math.sin(a), z0])
        az = a + rng.normal(0, 0.6); o = np.array([math.cos(az), math.sin(az), 0.0])
        L = rng.uniform(*h_range); l0 = rng.uniform(*lean); side = np.cross([0, 0, 1.0], o)
        pts, nms, ws = [b], [], []
        k = bend * rng.uniform(0.6, 1.3) / stiff
        for s in range(1, segs + 1):
            t = s / segs; ang = l0 + k * t * t * (L / h_range[1])
            d = o * math.sin(ang) + np.array([0, 0, 1.0]) * math.cos(ang)
            pts.append(pts[-1] + d * L / segs)
        for s in range(segs + 1):
            t = s / segs; ang = l0 + k * t * t * (L / h_range[1])
            d = o * math.sin(ang) + np.array([0, 0, 1.0]) * math.cos(ang)
            nm = np.cross(side, d); nm = rot(nm, d, twist * t * rng.uniform(-1, 1))
            nms.append(nm); ws.append(width * rng.uniform(0.8, 1.2) * (1 - t ** wtaper) if s < segs else 0.0)
        strip(mb, pts, ws, nms, rect_fn(i, L, l0), mat=mat)

def veg_outputs(name, parts, spec, *, atlas, notes, height_range=None, extra=None, ground='grass', bake=(), zmin=-0.02,
                center=True, kind='veg', lod1=None):
    objs = []
    for mb, suf, mats in parts:
        if mb.faces: o = mb.build(name + suf, mats); link_obj(o); objs.append(o)
    l1 = []
    if lod1:
        for mb, suf, mats in lod1:
            if mb.faces: o = mb.build(name + suf, mats); link_obj(o); l1.append(o)
    if center: center_xy(objs, l1)
    fit_to_spec(objs, spec, others=l1, zmin=zmin)
    ex = {'biomes': []}; ex.update(extra or {})
    return Asset(name, objs, list(spec), lod1=l1, kind='tree' if l1 else kind, atlas=atlas,
                 bake_objs=[o for o in objs + l1 if any(o.name.endswith(b) for b in bake)],
                 notes=notes, extra=ex, ground=ground, height_range=height_range, sink=-zmin)

def grass_atlas(name, rng, palette, dry=(0.0, 0.0, 0.25, 0.0), seed_kind='panicle', seed_col=(0.55, 0.50, 0.30), extra=None, bark=False):
    at = Atlas(name + '_atlas')
    if bark: at.alloc('bark', 256, 256)
    blades = []
    for i, c in enumerate(palette):
        cv = tex_blade(np.random.default_rng(rng.integers(1 << 30)), dry=dry[i % len(dry)])
        blades.append(at.put('blade%d' % i, colourize(cv, c, hue_amt=0.0)))
    seeds = []
    if seed_kind:
        for i in range(2):
            cv = tex_seedhead(np.random.default_rng(rng.integers(1 << 30)), kind=seed_kind, col=seed_col)
            seeds.append(at.put('seed%d' % i, colourize(cv, (0.5, 0.5, 0.5), hue_amt=0.0)))
    ex = {}
    for k, fn in (extra or {}).items():
        ex[k] = at.put(k, fn(np.random.default_rng(rng.integers(1 << 30))))
    return at, blades, seeds, ex

def seed_stalks(mb, rng, n, seeds, blade_rect, h_range, base_r, head=0.09, head_w=0.025, z0=-0.02):
    for i in range(n):
        rr = base_r * math.sqrt(rng.uniform()); a = rng.uniform(0, 6.28)
        b = np.array([rr * math.cos(a), rr * math.sin(a), z0]); L = rng.uniform(*h_range)
        d = nrm(np.array([math.cos(a) * 0.25, math.sin(a) * 0.25, 1.0]) + rng.normal(0, 0.08, 3))
        tip = b + d * (L - head * 0.8)
        side = nrm(np.cross(d, [0, 0, 1.0]) + 1e-3)
        strip(mb, [b, (b + tip) / 2 + rng.normal(0, 0.01, 3), tip], [0.0035, 0.003, 0.0025], [side, side, side], blade_rect)
        nm = nrm(np.array([math.cos(a + 1.3), math.sin(a + 1.3), 0.0]))
        card(mb, tip, nrm(d + np.array([math.cos(a), math.sin(a), 0]) * 0.15), nm, head_w, head, seeds[i % len(seeds)], anchor=0.1)

@asset('veg_grass_meadow', 12)
def gen_grass_meadow(name):
    rng = np.random.default_rng(2001)
    pal = [(0.30, 0.43, 0.14), (0.38, 0.50, 0.16), (0.24, 0.36, 0.13), (0.34, 0.45, 0.15)]
    at, blades, seeds, _ = grass_atlas(name, rng, pal, dry=(0.0, 0.0, 0.0, 0.3), seed_kind='panicle', seed_col=(0.58, 0.52, 0.36))
    mb = MB()
    grass_blades(mb, rng, 56, lambda i, L, l: blades[(0 if L > 0.27 else 2) if i % 3 else (1 if L > 0.3 else 3)],
                 (0.13, 0.33), 0.07, 0.009, lean=(0.05, 0.5), bend=1.0)
    seed_stalks(mb, rng, 4, seeds, blades[3], (0.30, 0.36), 0.05, head=0.08, head_w=0.03)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.3, rough=0.55, var=0.08)
    return veg_outputs(name, [(mb, '_blades', [m])], (0.42, 0.42, 0.35), atlas=at, height_range=[0.25, 0.45],
                       notes='Meadow grass clump: 56 arching pointed blades (dark base, light tips) plus 4 seed stalks with open panicles.',
                       extra={'biomes': ['emerald_strait', 'copperhead_bay']})

@asset('veg_flowers_meadow', 13)
def gen_flowers_meadow(name):
    rng = np.random.default_rng(2101)
    pal = [(0.30, 0.43, 0.14), (0.36, 0.48, 0.16), (0.25, 0.37, 0.13)]
    fl = {k: (lambda r, k=k: colourize(tex_flower(r, k), (0.5, 0.5, 0.5), hue_amt=0.0)) for k in ('daisy', 'buttercup', 'purple')}
    at, blades, seeds, fx = grass_atlas(name, rng, pal, seed_kind=None, extra=fl)
    mb = MB()
    grass_blades(mb, rng, 52, lambda i, L, l: blades[i % 3], (0.10, 0.28), 0.09, 0.009, lean=(0.05, 0.6), bend=1.0)
    kinds = ['daisy'] * 5 + ['buttercup'] * 5 + ['purple'] * 4
    for i, k in enumerate(kinds):
        rr = 0.13 * math.sqrt(rng.uniform()); a = rng.uniform(0, 6.28)
        b = np.array([rr * math.cos(a), rr * math.sin(a), -0.02])
        L = {'daisy': (0.30, 0.38), 'buttercup': (0.22, 0.34), 'purple': (0.24, 0.32)}[k]; L = rng.uniform(*L)
        d = nrm(np.array([math.cos(a) * 0.22, math.sin(a) * 0.22, 1.0]) + rng.normal(0, 0.07, 3))
        mid = b + d * L * 0.5 + rng.normal(0, 0.01, 3); tip = b + d * L
        side = nrm(np.cross(d, [0, 0, 1.0]) + 1e-3)
        strip(mb, [b, mid, tip], [0.004, 0.0035, 0.003], [side] * 3, blades[0])
        if k == 'purple':
            for j in range(2):
                nm = np.array([math.cos(a + j * 1.57), math.sin(a + j * 1.57), 0.0])
                card(mb, tip - d * 0.005, d, nm, 0.075, 0.075, fx['purple'], anchor=0.36)
        else:
            s = 0.085 if k == 'daisy' else 0.075
            nm = nrm(np.array([0, 0, 1.0]) + rng.normal(0, 0.35, 3) + np.array([math.cos(a), math.sin(a), 0]) * 0.3)
            up = perp(nm)
            card(mb, tip + nm * 0.004, up, nm, s, s, fx[k], anchor=0.5)
            card(mb, tip, up, -nm, s * 0.35, s * 0.35, blades[0], anchor=0.5)   # green calyx underneath
    m = leaf_mat(name + '_leaf', at.image(), trans=0.3, rough=0.5, var=0.06)
    return veg_outputs(name, [(mb, '_plants', [m])], (0.36, 0.36, 0.40), atlas=at, height_range=[0.35, 0.45],
                       notes='Meadow flower cluster in grass: 4 ox-eye daisies (white), 4 buttercups (yellow), 3 knapweed heads '
                       '(purple, crossed cards) on stems, 34 grass blades.', extra={'biomes': ['emerald_strait', 'copperhead_bay']})

@asset('veg_shrub_temperate', 14)
def gen_shrub_temperate(name):
    rng = np.random.default_rng(2201); H = 1.2
    pal = leaf_palette((0.11, 0.17, 0.07), (0.19, 0.28, 0.10), (0.27, 0.37, 0.13), (0.37, 0.47, 0.17))
    at = Atlas(name + '_atlas'); at.alloc('bark', 256, 256)
    canv = [tex_broadleaf(np.random.default_rng(rng.integers(1 << 30)), 256, 'ellipse', 0.085, 0.045, 8, (5, 8), 0.55) for _ in range(3)]
    tiles = shade_tiles(at, 'leaf', canv, pal, (0.28, 0.22, 0.16))
    lobes = ring_lobes(rng, [(5, (0.28, 0.42), (0.45, 0.6), (0.32, 0.42), 0.0), (2, (0.0, 0.15), (0.82, 0.92), (0.32, 0.38), 0.5)])
    C = np.array([0, 0, 0.6]); R = np.array([0.7, 0.7, 0.6])
    sk = sc_crown_tree(rng, H=H, trunk_top=(0.0, 0.0, 0.08), trunk_bend=(0, 0), lobes=lobes, n_att=700, step=0.07, d_inf=0.4,
                       d_kill=0.1, tropism=(0, 0, 0.1), jitter=0.3, grow_min_z=-1, r_base=0.045, r_tip=0.004, shell=0.4,
                       att_filter=lambda p: p[2] > 0.12, max_children=4)
    bmb = MB({'barkco': 3}); rmin = 0.006
    for _ in range(30):
        bmb = MB({'barkco': 3}); skeleton_bark(sk, bmb, rmin, [(0.02, 5), (0.008, 4), (0, 3)], lambda r: 0.18, None)
        if bmb.tris() <= 380: break
        rmin *= 1.15
    cards = lobe_cards(rng, sk, lobes, C, R, 900, (0.34, 0.5), r_card=0.012, zmin=0.1, seed=7.0, nm_noise=1.0, jitter=0.04)
    cards = finish_tree_cards(rng, cards, (1500 - bmb.tris()) // 2)
    lmb = MB(); emit_cards(lmb, cards, tiles)
    barkm = bark_mat(name + '_bark', (0.12, 0.10, 0.08), (0.30, 0.26, 0.21), (0.40, 0.35, 0.28), 14.0, 0.5, lichen=0.2)
    leafm = leaf_mat(name + '_leaf', at.image(), trans=0.3)
    return veg_outputs(name, [(bmb, '_stems', [barkm]), (lmb, '_leaves', [leafm])], (1.45, 1.4, 1.2), atlas=at, bake=('_stems',),
                       height_range=[0.9, 1.5], notes='Temperate shrub (hazel/hawthorn type): multi-stemmed from the ground, '
                       'rounded lobed mass of small-leaf cluster cards, darker inside.', extra={'biomes': ['emerald_strait', 'granite_fjord', 'copperhead_bay']})

# ══════════════════════════════════════════════════════════════════════ ROCKS
def rock_mat(name, H, base_a, base_b, dark, *, strata=0.0, strata_freq=3.0, streak=0.3, lichen=0.3, lichen_col=(0.78, 0.76, 0.62),
             moss=0.0, moss_col=(0.30, 0.38, 0.14), dirt=0.6, dirt_col=(0.36, 0.30, 0.22), edge=0.3, ao=0.5, wet=None,
             speckle=None, bump=0.6, rough=0.85, crack=0.4, scale=1.0, stain=None, groove=None, z0=0.0):
    """Layered procedural rock: big/mid/fine noise colour, strata bands, vertical weathering streaks, cracks, AO-dark
    cavities, pointiness edge highlights, lichen + moss on up-facing surfaces (normal Z), dirt at the base, optional
    wet zone below a spray line (dark, low roughness, algae + barnacle speckle), granite speckle, mineral stains."""
    m = bpy.data.materials.new(name); g = G(m); m['bake'] = True
    base_a, base_b, dark = lin(base_a), lin(base_b), lin(dark)
    co = g.coord('Object'); xyz = g.xyz(co); z = g.math('SUBTRACT', xyz[2], z0); nz = g.xyz(g.geo('Normal'))[2]
    nb = g.noise(co, 0.25 * scale, 4, 0.55); nm_ = g.noise(co, 1.3 * scale, 6, 0.6); nf = g.noise(co, 7.0 * scale, 4, 0.6)
    col = g.mix(g.mr(nb, 0.3, 0.7), base_a, base_b)
    col = g.mix(g.mr(nm_, 0.35, 0.65, 0.0, 0.35), col, g.mix(0.5, base_a, dark))
    col = g.mix(1.0, col, g.mix(g.mr(nf, 0.3, 0.7), (0.86, 0.86, 0.86), (1.12, 1.12, 1.12)), 'MULTIPLY')
    if strata > 0:
        wv = g.wave(g.mix(0.35, co, g.noise(co, 0.3, 3, 0.55, out='Color')), strata_freq / max(H, 1.0), 6.0, 2.0, 'Z')
        sm = g.math('MULTIPLY', g.mr(wv, 0.45, 0.95), g.mr(g.noise(co, 0.5, 2, 0.5), 0.35, 0.7))
        col = g.mix(g.math('MULTIPLY', sm, strata), col, g.mix(0.55, base_a, dark))
        wv2 = g.wave(g.mix(0.3, co, g.noise(co, 0.6, 2, 0.5, out='Color')), strata_freq * 2.7 / max(H, 1.0), 8.0, 3.0, 'Z')
        col = g.mix(g.math('MULTIPLY', g.mr(wv2, 0.75, 1.0), strata * 0.25), col, g.mix(0.5, base_b, (1, 1, 1)))
    if streak > 0:
        sv = g.noise(g.vmath('MULTIPLY', co, (5.0 * scale, 5.0 * scale, 0.45 * scale)), 1.0, 3, 0.5)
        steep = g.mr(g.math('ABSOLUTE', nz), 0.75, 0.2)
        col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.mr(sv, 0.52, 0.72), steep), streak), col, dark)
    if crack > 0:
        cv = g.voronoi(g.mix(0.45, co, g.noise(co, 0.8, 3, 0.6, out='Color')), 1.6 * scale, 'DISTANCE_TO_EDGE')
        cl = g.math('MULTIPLY', g.mr(cv, 0.02, 0.0), g.mr(g.noise(co, 0.7 * scale, 2, 0.5), 0.45, 0.6))
        col = g.mix(g.math('MULTIPLY', cl, crack), col, g.mix(0.5, dark, (0, 0, 0)))
    if speckle:
        vc = g.voronoi(co, speckle.get('scale', 30.0), 'F1', out='Color'); r = g.xyz(vc)[0]
        col = g.mix(g.math('MULTIPLY', g.math('LESS_THAN', r, speckle.get('black', 0.12)), 0.5), col, lin((0.08, 0.08, 0.08)))
        col = g.mix(g.math('MULTIPLY', g.math('GREATER_THAN', r, 1 - speckle.get('white', 0.15)), 0.35), col, lin((0.80, 0.79, 0.76)))
        pk = g.math('MULTIPLY', g.math('GREATER_THAN', r, 0.45), g.math('LESS_THAN', r, 0.45 + speckle.get('pink', 0.2)))
        col = g.mix(g.math('MULTIPLY', pk, 0.55), col, lin(speckle.get('pink_col', (0.72, 0.52, 0.45))))
    if groove:   # brain-coral / glacial striation style fine grooves
        gs = g.noise(g.vmath('MULTIPLY', co, groove.get('stretch', (1, 1, 1))), groove['scale'], 2, 0.5)
        gl = g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', gs, 0.5)), 0.0, groove.get('width', 0.03), 1.0, 0.0)
        col = g.mix(g.math('MULTIPLY', gl, groove.get('amt', 0.5)), col, lin(groove.get('col', (0.2, 0.2, 0.2))))
    if stain:
        st = g.mr(g.noise(co, stain.get('scale', 1.2), 4, 0.6), stain.get('lo', 0.58), stain.get('hi', 0.68))
        col = g.mix(g.math('MULTIPLY', st, stain.get('amt', 0.7)), col, lin(stain['col']))
    if ao > 0:
        aon = g.node('ShaderNodeAmbientOcclusion', samples=6); aon.inputs['Distance'].default_value = max(0.3, H * 0.12)
        col = g.mix(g.math('MULTIPLY', g.mr(aon.outputs['AO'], 1.0, 0.4), ao), col, g.mix(0.6, dark, (0, 0, 0)))
    if edge > 0:   # edge highlight from bevel-normal deviation (works on low- and high-poly meshes alike)
        bev = g.node('ShaderNodeBevel', samples=6); bev.inputs['Radius'].default_value = float(np.clip(H * 0.02, 0.015, 0.12))
        em = g.mr(g.vmath('DOT_PRODUCT', bev.outputs['Normal'], g.geo('Normal')), 0.99, 0.88)
        col = g.mix(g.math('MULTIPLY', em, edge), col, g.mix(0.35, base_b, (1, 1, 1)))
    up = g.mr(nz, 0.35, 0.85)
    if lichen > 0:
        lp = g.mr(g.noise(co, 2.2 * scale, 5, 0.65), 0.52, 0.62)
        lm = g.math('MULTIPLY', g.math('MAXIMUM', up, 0.25), lp)
        col = g.mix(g.math('MULTIPLY', lm, lichen), col, lin(lichen_col))
        dots = g.math('LESS_THAN', g.voronoi(co, 9.0 * scale, 'F1'), 0.18)
        col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', dots, lp), lichen * 0.6), col, lin((0.85, 0.80, 0.55)))
    if moss > 0:
        mp = g.mr(g.noise(co, 0.9 * scale, 5, 0.6), 0.45, 0.6)
        mm = g.math('MULTIPLY', g.mr(nz, 0.55, 0.9), mp)
        col = g.mix(g.math('MULTIPLY', mm, moss), col, g.mix(g.mr(nf, 0.3, 0.7), lin(moss_col), lin(tuple(c * 1.3 for c in moss_col))))
    if dirt > 0:
        dz = g.math('ADD', z, g.math('MULTIPLY', g.math('SUBTRACT', nm_, 0.5), H * 0.12))
        dm = g.mr(dz, H * 0.16, H * 0.0)
        col = g.mix(g.math('MULTIPLY', dm, dirt), col, lin(dirt_col))
    rgh = rough
    if wet:
        wz = g.math('ADD', z, g.math('MULTIPLY', g.math('SUBTRACT', g.noise(co, 0.8, 3, 0.5), 0.5), H * 0.12))
        wm = g.mr(wz, wet['z'] + H * 0.02, wet['z'] - H * 0.03)
        wc = g.mix(1.0, col, (0.36, 0.36, 0.34), 'MULTIPLY')
        wc = g.mix(g.mr(z, wet['z'] * 0.55, 0.0, 0.0, 0.8), wc, lin((0.06, 0.08, 0.05)))
        bar = g.math('MULTIPLY', g.math('LESS_THAN', g.voronoi(co, 22.0, 'F1'), 0.2), g.mr(z, wet['z'] * 0.4, wet['z'] * 0.75))
        wc = g.mix(g.math('MULTIPLY', bar, g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', z, wet['z'] * 0.6)), wet['z'] * 0.35, 0.0)), wc, lin((0.62, 0.60, 0.55)))
        col = g.mix(wm, col, wc)
        rgh = g.mixf(wm, rough, wet.get('rough', 0.12))
    h = g.math('ADD', g.math('MULTIPLY', nm_, 0.6), g.math('MULTIPLY', nf, 0.4))
    if crack > 0: h = g.math('SUBTRACT', h, g.math('MULTIPLY', cl, 0.5))
    if groove: h = g.math('SUBTRACT', h, g.math('MULTIPLY', gl, groove.get('depth', 0.6)))
    nbump = g.bump(h, bump, max(0.02, H * 0.012))
    g.output(g.bsdf(col, rgh, 0.35, nbump))
    return m

def bm_obj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(name, me); link_obj(o); return o

def get_co(o):
    a = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('co', a); return a.reshape(-1, 3)

def set_co(o, co):
    o.data.vertices.foreach_set('co', np.asarray(co, float).ravel()); o.data.update()

def apply_modifiers(o):
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data; o.modifiers.clear(); o.data = me; bpy.data.meshes.remove(old); return o

def decimate_to(o, target):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n <= target: return o
    m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = target / n; m.use_collapse_triangulate = True
    return apply_modifiers(o)

def vnoise(P, scale, octaves=3, seed=0.0):
    return np.array([noise3(p, scale, octaves, seed) for p in P])

def rock_shape(rng, P, planes=14, pd=(0.55, 0.85), round_=0.1, chips=10, chip_pd=(0.86, 0.96), noise_amp=0.05,
               noise_scale=1.4, strata=None, bottom=-0.55, horiz_bias=0.0, seed=0.0):
    """Fractured boulder from a dense unit sphere: random plane cuts (big facets + small chips), noise, optional ledges."""
    p = P.copy()
    def cut(n, frac, rnd):
        proj = p @ n; d = frac * proj.max(); over = proj - d; msk = over > 0
        p[msk] -= np.outer(over[msk] * (1 - rnd), n)
    for k in range(planes):
        n = rng.normal(0, 1, 3)
        if rng.uniform() < horiz_bias: n[2] *= 0.15
        cut(nrm(n), rng.uniform(*pd), round_)
    for k in range(chips):
        cut(nrm(rng.normal(0, 1, 3)), rng.uniform(*chip_pd), round_ * 0.5)
    d = p / np.linalg.norm(p, axis=1)[:, None]
    p += d * (noise_amp * vnoise(p, noise_scale, 4, seed))[:, None]
    p += d * (noise_amp * 0.35 * vnoise(p, noise_scale * 4.0, 2, seed + 3))[:, None]
    if strata:
        z = p[:, 2]; zz = (z - z.min()) / (np.ptp(z) + 1e-9)
        ph = zz * strata['layers'] + 0.35 * vnoise(p, 0.7, 2, seed + 7)
        f = ph % 1.0; layer = np.floor(ph)
        per = np.array([((int(l) * 7919) % 13) / 13.0 for l in layer])   # per-bed hardness
        rec = strata['depth'] * (0.35 * per + smoothstep(0.62, 0.98, f))
        w = 1 - np.abs(d[:, 2]) ** 2
        p[:, :2] *= (1 - rec * w)[:, None]
    p[:, 2] = np.maximum(p[:, 2], bottom + 0.03 * vnoise(p, 2.0, 2, seed + 11))
    return p

def make_rock(name, rng, dims, target_tris, mat, sink_frac=0.1, subdiv=5, **kw):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    o = bm_obj(name, bm)
    P = rock_shape(rng, get_co(o), **kw); set_co(o, P)
    decimate_to(o, target_tris)
    o.data.materials.append(mat)
    return o

def rock_outputs(name, objs, dims, *, notes, sink_frac=0.1, extra=None, ground='rock', glb=None, center=True, smooth=40):
    if center: center_xy(objs)
    fit_to_spec(objs, dims, zmin=-dims[2] * sink_frac)
    for o in objs:
        o.data.shade_smooth()
        try: o.data.set_sharp_from_angle(angle=math.radians(smooth))
        except Exception: pass
        o['flat'] = True; o.data['smoothed'] = True   # already smoothed; skip apply_smooth
    ex = {'sink_m': round(dims[2] * sink_frac, 3), 'scale_range': [0.7, 1.3]}; ex.update(extra or {})
    return Asset(name, objs, list(dims), kind='rock', notes=notes, extra=ex, ground=ground, glb_mats=glb or {}, sink=dims[2] * sink_frac)

LIME = dict(base_a=(0.58, 0.57, 0.53), base_b=(0.69, 0.68, 0.63), dark=(0.33, 0.32, 0.30))

@asset('rock_limestone_a', 30)
def gen_rock_limestone_a(name):
    rng = np.random.default_rng(3001); dims = (4.4, 3.6, 3.0)
    m = rock_mat(name + '_mat', dims[2], LIME['base_a'], LIME['base_b'], LIME['dark'], strata=0.45, strata_freq=4.0, streak=0.45,
                 lichen=0.45, moss=0.35, crack=0.35, edge=0.35)
    o = make_rock(name, rng, dims, 1800, m, planes=12, pd=(0.42, 0.75), round_=0.03, chips=16, noise_amp=0.035, horiz_bias=0.5,
                  strata={'layers': 4, 'depth': 0.035}, bottom=-0.5, seed=1.0)
    return rock_outputs(name, [o], dims, notes='Pale limestone boulder: blocky fracture facets, 5 strata ledges, dark rain streaks, '
                        'lichen and moss on top faces, dirt at the base.', extra={'biomes': ['emerald_strait']}, ground='grass')

@asset('rock_limestone_b', 31)
def gen_rock_limestone_b(name):
    rng = np.random.default_rng(3101); dims = (5.8, 4.2, 2.6)
    m = rock_mat(name + '_mat', dims[2], (0.62, 0.61, 0.57), (0.72, 0.71, 0.66), (0.36, 0.35, 0.33), strata=0.35, strata_freq=3.0,
                 streak=0.35, lichen=0.5, moss=0.45, crack=0.45, edge=0.3)
    o = make_rock(name, rng, dims, 1800, m, planes=10, pd=(0.5, 0.8), round_=0.12, chips=12, noise_amp=0.05, horiz_bias=0.6,
                  strata={'layers': 3, 'depth': 0.05}, bottom=-0.35, seed=2.0)
    return rock_outputs(name, [o], dims, notes='Low, weathered limestone outcrop: rounded bedding ledges, crack network, '
                        'heavier lichen/moss cover on the flatter top.', extra={'biomes': ['emerald_strait']}, ground='grass')

@asset('rock_coastal_wet', 32)
def gen_rock_coastal_wet(name):
    rng = np.random.default_rng(3201); dims = (5.0, 4.1, 3.4)
    wz = dims[2] * 0.4 - dims[2] * 0.08   # spray line at 40 % of the height above the bottom (object z)
    m = rock_mat(name + '_mat', dims[2], (0.40, 0.39, 0.36), (0.50, 0.49, 0.45), (0.18, 0.18, 0.17), strata=0.15, streak=0.4,
                 lichen=0.35, lichen_col=(0.80, 0.72, 0.40), moss=0.0, crack=0.5, edge=0.35, dirt=0.0,
                 wet={'z': wz, 'rough': 0.1}, z0=0.0)
    o = make_rock(name, rng, dims, 1800, m, planes=15, pd=(0.5, 0.82), round_=0.06, chips=16, noise_amp=0.05, bottom=-0.7, seed=3.0)
    return rock_outputs(name, [o], dims, sink_frac=0.08, ground='sand',
                        notes='Dark coastal rock. Below the spray line (40 % of height, wobbly) it is darker, glossy (roughness 0.1), '
                        'with an algae-dark base and barnacle speckle; dry upper part has yellow-grey lichen.',
                        glb={'wet': {'z': wz, 'rough': 0.2}, 'rough': 0.85}, extra={'spray_line_z_m': round(wz, 3), 'biomes': ['emerald_strait', 'granite_fjord', 'copperhead_bay']})

# ─────────────────────────────── cliffs
def box_grid(W, D, Hh, nx, ny, nz, z0=0.0):
    """Closed box surface with per-axis grid resolution (verts shared along edges)."""
    bm = bmesh.new(); vmap = {}
    def V(i, j, k):
        key = (i, j, k)
        if key not in vmap: vmap[key] = bm.verts.new((-W / 2 + W * i / nx, -D / 2 + D * j / ny, z0 + Hh * k / nz))
        return vmap[key]
    def face(a, b, c, d): bm.faces.new((a, b, c, d))
    for i in range(nx):
        for k in range(nz):
            face(V(i, 0, k), V(i + 1, 0, k), V(i + 1, 0, k + 1), V(i, 0, k + 1))           # front (-Y)
            face(V(i + 1, ny, k), V(i, ny, k), V(i, ny, k + 1), V(i + 1, ny, k + 1))        # back
        for j in range(ny):
            face(V(i, j, nz), V(i + 1, j, nz), V(i + 1, j + 1, nz), V(i, j + 1, nz))        # top
            face(V(i, j + 1, 0), V(i + 1, j + 1, 0), V(i + 1, j, 0), V(i, j, 0))            # bottom
    for j in range(ny):
        for k in range(nz):
            face(V(0, j + 1, k), V(0, j, k), V(0, j, k + 1), V(0, j + 1, k + 1))            # -X
            face(V(nx, j, k), V(nx, j + 1, k), V(nx, j + 1, k + 1), V(nx, j, k + 1))        # +X
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm

def cliff_mesh(name, rng, W, D, Hh, recess_fn, top_amp=0.5, noise_amp=0.18, end_len=4.5, end_recess=3.5, end_drop=3.0,
               lean=0.8, target=6000, res=(80, 30, 52), seed=0.0):
    """Cliff chunk: front face at -Y (the sea / low side), back (+Y) is buried in terrain. recess_fn(x, z) -> metres the
    face is pushed back at (x, z). Ends taper back and down so neighbouring instances can overlap."""
    o = bm_obj(name, box_grid(W, D, Hh, *res, z0=0.0))
    P = get_co(o); x, y, z = P[:, 0], P[:, 1], P[:, 2]
    g = (D / 2 - y) / D                                  # 1 at the front face, 0 at the back
    rec = np.array([recess_fn(xi, zi) for xi, zi in zip(x, z)])
    t = np.clip((np.abs(x) - (W / 2 - end_len)) / end_len, 0, 1)
    rec = rec + end_recess * t ** 1.5 + lean * (z / Hh)
    y2 = y + rec * g
    topdrop = top_amp * (0.5 + 0.5 * vnoise(P * np.array([1, 1, 0]), 0.12, 3, seed + 1)) + end_drop * t ** 2
    edge = np.clip(1 - (y2 + D / 2 - rec) / 3.0, 0, 1) * 0.0
    z2 = z - (topdrop + edge) * (z / Hh)
    Q = np.stack([x, y2, z2], 1)
    nn = vnoise(Q, 0.35, 4, seed + 2) + 0.5 * vnoise(Q, 1.3, 2, seed + 4)
    Q[:, 1] -= noise_amp * nn * g * 1.0
    Q[:, 2] += noise_amp * 0.6 * vnoise(Q, 0.5, 3, seed + 3) * (z / Hh)
    set_co(o, Q)
    decimate_to(o, target)
    return o

def layered_recess(rng, W, Hh, beds=(0.5, 2.2), max_rec=1.6, joints=(2.0, 7.0), seed=0.0):
    zs = [0.0]
    while zs[-1] < Hh: zs.append(zs[-1] + rng.uniform(*beds))
    bed_rec = np.cumsum(rng.normal(0, 0.45, len(zs))); bed_rec = (bed_rec - bed_rec.min()) * (max_rec / max(np.ptp(bed_rec), 1e-3))
    bed_soft = rng.uniform(0, 1, len(zs)) < 0.3
    zs = np.array(zs)
    xj = {}
    for k in range(len(zs)):           # joints are offset bed to bed (staggered blocks)
        xs = [-W / 2 - rng.uniform(0, 3)]
        while xs[-1] < W / 2 + 3: xs.append(xs[-1] + rng.uniform(*joints))
        xj[k] = (np.array(xs), rng.uniform(0, 0.6, len(xs)))
    scoops = [(rng.uniform(-W / 2, W / 2), rng.uniform(0.5, Hh), rng.uniform(0.8, 2.2), rng.uniform(0.4, 1.1)) for _ in range(10)]
    def f(x, z):
        k = max(0, min(len(zs) - 2, int(np.searchsorted(zs, z) - 1)))
        xs, off = xj[k]; j = max(0, min(len(xs) - 2, int(np.searchsorted(xs, x) - 1)))
        t = (z - zs[k]) / (zs[k + 1] - zs[k])
        r = bed_rec[k] + off[j] + (0.55 if bed_soft[k] else 0.0)
        r += 0.18 * smoothstep(0.88, 1.0, t)                                      # weathered top arris of each bed
        dj = min(abs(x - xs[j]), abs(x - xs[j + 1]))
        r += 0.45 * math.exp(-(dj / 0.18) ** 2)                                   # narrow vertical joints
        for sx, sz, sr, sd in scoops:
            r += sd * math.exp(-((x - sx) ** 2 + ((z - sz) * 1.6) ** 2) / (sr * sr))
        r += 0.22 * noise3((x, 0, z), 0.45, 3, seed) + 0.08 * noise3((x, 0, z), 1.7, 2, seed + 1)
        return r
    return f

@asset('rock_cliff_limestone', 33)
def gen_rock_cliff_limestone(name):
    rng = np.random.default_rng(3301); W, D, Hh = 24.0, 10.0, 12.0
    m = rock_mat(name + '_mat', Hh, (0.60, 0.59, 0.55), (0.71, 0.70, 0.65), (0.34, 0.33, 0.31), strata=0.4, strata_freq=7.0,
                 streak=0.55, lichen=0.4, moss=0.55, crack=0.25, edge=0.35, scale=0.6)
    o = cliff_mesh(name, rng, W, D, Hh, layered_recess(rng, W, Hh, seed=1.0), seed=1.0)
    o.data.materials.append(m)
    return rock_outputs(name, [o], (W, D, Hh), sink_frac=0.05, center=False, smooth=45,
                        notes='Layered limestone cliff chunk for steep shores: 24 m wide (X) x 10 m deep (Y) x 12 m tall. The cliff '
                        'face looks -Y (toward the water); +Y side is meant to be buried in the terrain. Bedding ledges with soft '
                        'recessed beds, vertical joints, rain streaks, moss/lichen on ledge tops. Ends taper back and down so '
                        'instances can overlap 3-5 m along a shoreline.', extra={'face': '-Y', 'biomes': ['emerald_strait'], 'overlap_m': 4.0},
                        ground='sand')

# ══════════════════════════════════════════════════════════════════════ TIER 4: Granite Fjord
@asset('veg_scots_pine', 15)
def gen_scots_pine(name):
    rng = np.random.default_rng(4001); H = 17.0
    pal = leaf_palette((0.08, 0.12, 0.09), (0.14, 0.21, 0.15), (0.21, 0.29, 0.19), (0.30, 0.38, 0.22))
    atlas, tiles = std_leaf_setup(name, rng, lambda r, T: tex_needles(r, T, 7, 0.09, 1.0, needle_w=0.0048, tuft_from=0.4,
                                  radiate=1.6, cover=0.4), pal, (0.45, 0.25, 0.14))
    pads = [(3.6, 0.3, 13.3, 1.5), (3.9, 1.6, 14.5, 1.6), (3.2, 2.9, 12.7, 1.35), (4.0, 4.0, 13.9, 1.6), (3.4, 5.2, 15.1, 1.5),
            (1.9, 0.9, 16.0, 1.6), (2.1, 3.4, 15.8, 1.5), (0.3, 0.0, 16.2, 1.4), (2.6, 5.9, 12.1, 1.15), (2.5, 2.2, 16.1, 1.3),
            (4.4, 4.9, 15.6, 1.2)]
    lobes = [(np.array([rh * math.cos(az), rh * math.sin(az), z]) + rng.normal(0, 0.15, 3) * np.array([1, 1, 0.3]), r) for rh, az, z, r in pads]
    C = np.array([0.0, 0.0, 14.2]); R = np.array([4.6, 4.6, 2.2])
    sk = sc_crown_tree(rng, H=H, trunk_top=(0.5, -0.2, 11.6), trunk_bend=(0.25, 0.1), lobes=lobes, n_att=1400, step=0.4,
                       d_inf=4.5, d_kill=0.7, tropism=(0, 0, 0.12), jitter=0.4, grow_min_z=10.0, r_base=0.36, shell=0.2,
                       squash=0.32, att_filter=lambda p: p[2] > 11.4)
    cards = lobe_cards(rng, sk, lobes, C, R, 2600, (0.9, 1.3), r_card=0.06, zmin=11.0, seed=9.0, nm_noise=0.5, nm_up=2.5,
                       up_z=-0.1, max_depth=0.75, jitter=0.14)
    stubs = []
    for _ in range(9):
        z = rng.uniform(3.5, 10.8); az = rng.uniform(0, 6.28); L = rng.uniform(0.3, 1.1)
        t = (z + 0.25) / 11.85; p0 = np.array([0.5 * t ** 1.6 + 0.25 * math.sin(t * math.pi * 0.9), -0.2 * t ** 1.6 + 0.1 * math.sin(t * math.pi * 0.7), z])
        stubs.append((np.array([p0, p0 + nrm(np.array([math.cos(az), math.sin(az), rng.uniform(-0.4, 0.2)])) * L]), rng.uniform(0.02, 0.035)))
    def extra_bark(mb, lod):
        if lod == 'lod0':
            for pts, r in stubs: tube(mb, pts, [r, r * 0.4], 3)
    barkm = bark_mat(name + '_bark', (0.12, 0.09, 0.07), (0.34, 0.27, 0.22), (0.46, 0.37, 0.30), 2.0, 0.45, lichen=0.25,
                     upper={'z0': 7.5, 'z1': 10.0, 'a': (0.80, 0.44, 0.24), 'b': (0.88, 0.56, 0.33), 'crack': (0.50, 0.26, 0.15), 'scale': 6.0})
    leafm = leaf_mat(name + '_leaf', atlas.image(), trans=0.25, rough=0.78, spec=0.1)
    return tree_outputs(name, rng, sk, cards, tiles, atlas, barkm, leafm, H=H, spec_xy=(10.0, 9.4), r_min_geo=0.03,
                        sides_table=[(0.25, 9), (0.12, 6), (0.06, 5), (0.03, 4), (0.0, 3)], seg_fn=broad_seg,
                        flare=root_flare(0.4, 0.8, 5), bark_budget=1150, extra_bark=extra_bark, height_range=[16.0, 18.0],
                        notes='Scots pine: tall bare trunk (grey-brown fissured below, orange-red flaky above ~8 m) with dead stubs, '
                        'a few crooked upturned limbs carrying a high, flat, irregular crown of blue-green needle pads.',
                        extra={'crown_base_m': 11.5, 'biomes': ['granite_fjord']})

def tex_frond(rng, w=64, h=256, pinnae=26, col=None, lobed=True, leaflet_w=0.16, angle=1.15, gap=0.0, rachis=0.035, kind=0.0):
    """Pinnate frond (fern) / palm frond: rachis along the centre line (u=0.5, v 0->1), leaflets to both edges."""
    cv = Canvas(w, h); ar = h / w
    cv.seg((0.5, 0.0), (0.5, 0.995), rachis, rachis * 0.3, shade=0.75, kind=kind, col=col)
    for i in range(pinnae):
        v = 0.04 + 0.94 * (i + 0.5) / pinnae
        for side in (-1, 1):
            if gap and rng.uniform() < gap: continue
            vv = v + rng.normal(0, 0.15 / pinnae)
            ang = math.pi / 2 - side * (angle + rng.normal(0, 0.06))
            # leaflet length reaches the card edge: horizontal half-width 0.47
            L = 0.47 / max(abs(math.cos(ang)), 0.2) * rng.uniform(0.85, 1.0)
            cv.leaf((0.5, vv), ang, L, leaflet_w * rng.uniform(0.85, 1.1), 'oak' if lobed else 'lance',
                    shade=rng.uniform(0.85, 1.1), hue=rng.uniform(-1, 1), vein=0.1, fold=0.1)
    return cv

def arch_path(base, az, L, n, rise, droop, rng=None, curl=0.0):
    """Arching frond/leaf path: starts at 'rise' angle from vertical, bends outward and down by 'droop' (radians)."""
    o = np.array([math.cos(az), math.sin(az), 0.0]); pts = [np.asarray(base, float)]
    for s in range(1, n + 1):
        t = s / n; ang = rise + droop * t ** 1.4
        d = o * math.sin(ang) + np.array([0, 0, 1.0]) * math.cos(ang)
        pts.append(pts[-1] + d * L / n)
    return pts, o

@asset('veg_fern', 17)
def gen_fern(name):
    rng = np.random.default_rng(4101)
    at = Atlas(name + '_atlas')
    cols = [(0.22, 0.38, 0.12), (0.30, 0.45, 0.14), (0.18, 0.31, 0.11)]
    fr = [at.put('frond%d' % i, colourize(tex_frond(np.random.default_rng(i + 7), pinnae=24), c, hue_amt=0.05)) for i, c in enumerate(cols)]
    mb = MB(); n = 15
    for i in range(n):
        az = i * 2.39996 + rng.normal(0, 0.15); L = rng.uniform(0.55, 0.78)
        inner = i < 4
        rise = rng.uniform(0.15, 0.35) if inner else rng.uniform(0.45, 0.8)
        pts, o = arch_path(np.array([0.02 * math.cos(az), 0.02 * math.sin(az), -0.02]), az, L, 6, rise, rng.uniform(0.7, 1.3))
        side = np.cross([0, 0, 1.0], o); ws, nms = [], []
        for s, p in enumerate(pts):
            t = s / (len(pts) - 1); ws.append(0.22 * math.sin(math.pi * min(1, t * 0.95 + 0.05) ** 0.75) * (L / 0.7) + 0.005)
            d = nrm(pts[min(s + 1, len(pts) - 1)] - pts[max(s - 1, 0)]); nms.append(np.cross(side, d))
        ws[-1] = 0.004
        strip(mb, pts, ws, nms, fr[0 if inner else (1 + i % 2)], fold=0.18)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.35, rough=0.6, var=0.08)
    return veg_outputs(name, [(mb, '_fronds', [m])], (1.15, 1.1, 0.6), atlas=at, height_range=[0.4, 0.8],
                       notes='Bracken/shield-fern clump: 15 arching pinnate fronds (V-folded ribbons with alpha pinnae), '
                       'younger brighter fronds upright in the centre.', extra={'biomes': ['granite_fjord', 'emerald_strait']})

@asset('veg_grass_summer', 16)
def gen_grass_summer(name):
    rng = np.random.default_rng(4201)
    pal = [(0.42, 0.48, 0.18), (0.50, 0.52, 0.22), (0.36, 0.44, 0.16), (0.55, 0.53, 0.28)]
    at, blades, seeds, _ = grass_atlas(name, rng, pal, dry=(0.15, 0.35, 0.0, 0.6), seed_kind='spike', seed_col=(0.66, 0.60, 0.42))
    mb = MB()
    grass_blades(mb, rng, 62, lambda i, L, l: blades[i % 4], (0.10, 0.27), 0.065, 0.0075, lean=(0.08, 0.6), bend=1.2)
    seed_stalks(mb, rng, 7, seeds, blades[3], (0.24, 0.30), 0.05, head=0.07, head_w=0.02)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.3, rough=0.6, var=0.08)
    return veg_outputs(name, [(mb, '_blades', [m])], (0.38, 0.38, 0.30), atlas=at, height_range=[0.15, 0.45],
                       notes='Northern summer grass clump: finer, yellower blades with straw tips and 7 timothy-like seed spikes.',
                       extra={'biomes': ['granite_fjord', 'copperhead_bay']})

GRANITE = dict(base_a=(0.47, 0.45, 0.43), base_b=(0.57, 0.54, 0.51), dark=(0.25, 0.24, 0.23),
               speckle={'scale': 48.0, 'black': 0.12, 'white': 0.10, 'pink': 0.2, 'pink_col': (0.62, 0.48, 0.43)})

@asset('rock_granite_a', 43)
def gen_rock_granite_a(name):
    rng = np.random.default_rng(4301); dims = (4.2, 3.5, 2.7)
    m = rock_mat(name + '_mat', dims[2], GRANITE['base_a'], GRANITE['base_b'], GRANITE['dark'], speckle=GRANITE['speckle'],
                 streak=0.3, lichen=0.55, lichen_col=(0.70, 0.74, 0.58), moss=0.35, crack=0.25, edge=0.25)
    o = make_rock(name, rng, dims, 1800, m, planes=8, pd=(0.6, 0.88), round_=0.42, chips=5, noise_amp=0.035, bottom=-0.45, seed=4.0)
    return rock_outputs(name, [o], dims, notes='Rounded glacial granite boulder: soft joint facets, pink-grey speckled granite '
                        '(biotite, quartz, feldspar), grey-green lichen and moss on top.', extra={'biomes': ['granite_fjord']}, ground='grass')

@asset('rock_granite_slab', 44)
def gen_rock_granite_slab(name):
    rng = np.random.default_rng(4401); dims = (8.0, 6.0, 1.5)
    m = rock_mat(name + '_mat', dims[2] * 2, GRANITE['base_a'], GRANITE['base_b'], GRANITE['dark'], speckle=GRANITE['speckle'],
                 streak=0.15, lichen=0.5, lichen_col=(0.72, 0.75, 0.60), moss=0.4, crack=0.3, edge=0.2,
                 groove={'scale': 1.0, 'stretch': (0.12, 9.0, 1.0), 'width': 0.012, 'amt': 0.25, 'col': (0.42, 0.40, 0.38), 'depth': 0.2})
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0); o = bm_obj(name, bm)
    P = get_co(o) * np.array([1.0, 1.0, 0.32])
    for k in range(5):   # near-vertical joint planes give the straight slab edges
        a = k * 1.26 + rng.normal(0, 0.2); n = nrm(np.array([math.cos(a), math.sin(a), rng.normal(0, 0.15)]))
        proj = P @ n; d = rng.uniform(0.72, 0.88) * proj.max(); over = proj - d; msk = over > 0; P[msk] -= np.outer(over[msk] * 0.8, n)
    P[:, 2] += 0.025 * vnoise(P, 1.5, 4, 5.0) + 0.012 * vnoise(P, 6.0, 2, 6.0)
    # one open crack across the slab (V groove on the top surface)
    cn = nrm(np.array([0.35, 1.0, 0.0])); dist = np.abs((P[:, :2] - np.array([0.25, -0.1])) @ cn[:2]) + 0.04 * vnoise(P, 3.0, 2, 7.0)
    top = P[:, 2] > 0.05
    P[top, 2] -= 0.09 * np.exp(-(dist[top] / 0.035) ** 2)
    P[:, 2] = np.maximum(P[:, 2], -0.16)
    set_co(o, P); decimate_to(o, 1800); o.data.materials.append(m)
    return rock_outputs(name, [o], dims, sink_frac=0.12, notes='Flat glacially polished granite slab (8 x 6 x 1.5 m): domed '
                        'smooth top with faint striations, straight joint edges, one open crack, lichen rosettes and moss.',
                        extra={'biomes': ['granite_fjord']}, ground='grass', smooth=50)

@asset('rock_scree_cluster', 45)
def gen_rock_scree_cluster(name):
    rng = np.random.default_rng(4501); dims = (6.0, 4.6, 0.75)
    m = rock_mat(name + '_mat', 0.6, (0.42, 0.41, 0.39), (0.52, 0.50, 0.47), (0.22, 0.21, 0.20), speckle=GRANITE['speckle'],
                 streak=0.0, lichen=0.35, moss=0.0, crack=0.0, edge=0.45, dirt=0.3, ao=0.8, scale=2.5)
    bm = bmesh.new(); n = 0
    while n < 110:
        s = 0.1 + 0.6 * rng.uniform() ** 3.2
        r = math.sqrt(rng.uniform()); a = rng.uniform(0, 6.28)
        c = np.array([math.cos(a) * r * (3.0 - s), math.sin(a) * r * (2.3 - s), 0.0])
        if np.hypot(c[0] / 3.0, c[1] / 2.3) > 1: continue
        tmp = bmesh.new(); bmesh.ops.create_icosphere(tmp, subdivisions=2, radius=1.0)
        P = np.array([v.co[:] for v in tmp.verts]) * np.array([1.0, rng.uniform(0.7, 1.0), rng.uniform(0.55, 0.85)])
        for k in range(6):   # fracture facets
            nn = nrm(rng.normal(0, 1, 3)); pr = P @ nn; d = rng.uniform(0.35, 0.75) * pr.max(); ov = pr - d; mk = ov > 0
            P[mk] -= np.outer(ov[mk], nn)
        R3 = np.array(Matrix.Rotation(rng.uniform(0, 6.28), 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 3, 'X'))
        P = (P * s * 0.5) @ R3.T + c; P[:, 2] -= P[:, 2].min() + s * 0.1
        for v, p in zip(tmp.verts, P): v.co = p
        me = bpy.data.meshes.new('_t'); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
        n += 1
    o = bm_obj(name, bm); decimate_to(o, 1900); o.data.materials.append(m)
    obj = rock_outputs(name, [o], dims, sink_frac=0.08, smooth=30, notes='Scree patch ~6 m across: 110 angular granite stones '
                       '(power-law sizes 0.1-0.7 m), partly sunk.', extra={'stones': 110, 'biomes': ['granite_fjord']},
                       ground='grass')
    return obj

def granite_recess(rng, W, Hh, joints=(3.0, 9.0), sheets=(2.5, 6.0), seed=0.0):
    """Massive jointed granite: flat-faced blocks with rounded joint edges; vertical joints staggered per sheet."""
    zs = [0.0]
    while zs[-1] < Hh: zs.append(zs[-1] + rng.uniform(*sheets))
    zs = np.array(zs); sh = {}
    for k in range(len(zs)):
        xs = [-W / 2 - rng.uniform(0, 4)]
        while xs[-1] < W / 2 + 4: xs.append(xs[-1] + rng.uniform(*joints))
        sh[k] = (np.array(xs), rng.uniform(0, 3.0, len(xs)), rng.uniform(-0.35, 0.35, len(xs)))
    def f(x, z):
        k = max(0, min(len(zs) - 2, int(np.searchsorted(zs, z) - 1)))
        xs, blk, slope = sh[k]; j = max(0, min(len(xs) - 2, int(np.searchsorted(xs, x) - 1)))
        dx = min(x - xs[j], xs[j + 1] - x); dz = min(z - zs[k], zs[k + 1] - z)
        rnd = 0.3 * (1 - smoothstep(0.0, 0.45, dx)) + 0.2 * (1 - smoothstep(0.0, 0.35, dz))
        return (blk[j] + slope[j] * (z - zs[k]) + rnd + 0.8 * noise3((x, 0, z), 0.12, 3, seed)
                + 0.15 * noise3((x, 0, z), 0.9, 2, seed + 1))
    return f

@asset('rock_cliff_granite', 46)
def gen_rock_cliff_granite(name):
    rng = np.random.default_rng(4601); W, D, Hh = 24.0, 10.0, 12.0
    m = rock_mat(name + '_mat', Hh, GRANITE['base_a'], GRANITE['base_b'], GRANITE['dark'], speckle=GRANITE['speckle'],
                 streak=0.5, lichen=0.45, lichen_col=(0.70, 0.74, 0.58), moss=0.5, crack=0.2, edge=0.3, scale=0.6)
    o = cliff_mesh(name, rng, W, D, Hh, granite_recess(rng, W, Hh, seed=2.0), lean=1.6, top_amp=0.9, noise_amp=0.12, seed=2.0)
    o.data.materials.append(m)
    return rock_outputs(name, [o], (W, D, Hh), sink_frac=0.05, center=False, smooth=35,
                        notes='Granite cliff chunk 24 x 10 x 12 m, face toward -Y: massive rounded joint blocks and sheeting joints, '
                        'dark seep streaks, lichen/moss on ledges. Ends taper so instances overlap ~4 m along the shore.',
                        extra={'face': '-Y', 'biomes': ['granite_fjord'], 'overlap_m': 4.0}, ground='sand')

# ══════════════════════════════════════════════════════════════════════ TIER 5: Sunbreak Atoll (tropical)
def palm_atlas(name, rng, greens, dead=(0.50, 0.38, 0.22), bark=512, extra_tiles=None):
    at = Atlas(name + '_atlas'); at.alloc('bark', bark, bark)
    tiles = []
    for i, c in enumerate(greens):
        cv = tex_frond(np.random.default_rng(rng.integers(1 << 30)), 64, 512, pinnae=78, lobed=False, leaflet_w=0.085,
                       angle=0.95, gap=0.06, rachis=0.05, col=None)
        v = (np.arange(512) + 0.5) / 512; cv.S *= (0.82 + 0.3 * v)[:, None]          # lighter toward the frond tip
        tiles.append(at.put('frond%d' % i, colourize(cv, c, hue_amt=0.05)))
    cv = tex_frond(np.random.default_rng(5), 64, 512, pinnae=60, lobed=False, leaflet_w=0.06, angle=0.5, gap=0.25, rachis=0.05)
    dead_t = at.put('frond_dead', colourize(cv, dead, twig_col=dead, hue_amt=0.1))
    ex = {}
    for k, fn in (extra_tiles or {}).items(): ex[k] = at.put(k, fn(np.random.default_rng(rng.integers(1 << 30))))
    return at, tiles, dead_t, ex

def palm_frond(mb, rng, base, az, L, rise, droop, wmax, rect, segs=12, petiole=0.14, twist=0.0, fold=-0.22, mat=0):
    pts, o = arch_path(base, az, L, segs, rise, droop)
    side = np.cross([0, 0, 1.0], o); ws, nms = [], []
    for s in range(segs + 1):
        t = s / segs
        w = 0.06 if t < petiole else wmax * math.sin(math.pi * min(1.0, (t - petiole) / (1 - petiole) * 0.92 + 0.08)) ** 0.6
        d = nrm(pts[min(s + 1, segs)] - pts[max(s - 1, 0)]); nm = rot(np.cross(side, d), d, twist * t)
        ws.append(w); nms.append(nm)
    ws[-1] = 0.03
    strip(mb, pts, ws, nms, rect, fold=fold if fold else 0.0, mat=mat)
    return pts

def palm_trunk_path(H, lean, lean_az, curve=1.3, n=40, wobble=0.04, rng=None):
    o = np.array([math.cos(lean_az), math.sin(lean_az), 0.0]); pts = [np.array([0, 0, -0.25])]; L = H * 1.03
    for s in range(1, n + 1):
        t = s / n; ang = lean * (1 - t) ** curve
        d = o * math.sin(ang) + np.array([0, 0, 1.0]) * math.cos(ang)
        if rng is not None: d = nrm(d + rng.normal(0, wobble, 3) * np.array([1, 1, 0]))
        pts.append(pts[-1] + d * L / n)
    return pts

def build_palm(rng, mb_bark, mb_leaf, tiles, dead_t, *, H, lean, lean_az, n_fronds=14, frond_L=(4.2, 5.0), r_base=0.3, r_top=0.15,
               coconuts=10, dead=3, rings=True, n_seg=40, frond_segs=12, origin=(0, 0, 0), sides=8, lod=0):
    org = np.asarray(origin, float)
    pts = palm_trunk_path(H, lean, lean_az, n=n_seg if lod == 0 else 7, rng=rng)
    pts = [p + org for p in pts]
    rad = []
    for i, p in enumerate(pts):
        t = i / (len(pts) - 1)
        rad.append(r_top + (r_base - r_top) * math.exp(-t * 9) * 0.8 + (r_base - r_top) * 0.2 * (1 - t))
    rf = (lambda i, th: 1.0 + 0.045 * math.cos(i * math.pi)) if (rings and lod == 0) else None
    tube(mb_bark, pts, rad, sides if lod == 0 else 5, rfun=rf)
    top = pts[-1]; up = nrm(pts[-1] - pts[-3])
    # fronds: phyllotaxis around the crown; young ones upright, old ones horizontal + drooping
    nf = n_fronds
    for i in range(nf):
        age = i / (nf - 1)                       # 0 = youngest (centre, upright)
        az = i * 2.39996 + rng.normal(0, 0.1)
        rise = 0.15 + 1.45 * age ** 0.8 + rng.normal(0, 0.08)
        droop = 0.5 + 1.4 * age + rng.normal(0, 0.15)
        L = rng.uniform(*frond_L) * (0.7 + 0.3 * min(1, age * 3))
        lvl = 3 if age < 0.25 else (2 if age < 0.55 else (1 if age < 0.8 else 0))
        base = top + up * 0.15 + np.array([math.cos(az), math.sin(az), 0]) * 0.12
        palm_frond(mb_leaf, rng, base, az, L, rise, droop, rng.uniform(1.75, 2.1), tiles[lvl], segs=frond_segs if lod == 0 else 4,
                   twist=rng.normal(0, 0.25), fold=-0.22 if lod == 0 else -0.15)
    for i in range(dead if lod == 0 else 0):
        az = rng.uniform(0, 6.28); base = top - up * 0.1
        palm_frond(mb_leaf, rng, base, az, rng.uniform(2.6, 3.2), rng.uniform(2.3, 2.7), rng.uniform(0.1, 0.3), 0.7, dead_t, segs=6, fold=-0.3)
    if coconuts and lod == 0:
        for i in range(coconuts):
            az = i * 2.4 + rng.normal(0, 0.2); r = rng.uniform(0.16, 0.26)
            c = top - up * rng.uniform(0.15, 0.55) + np.array([math.cos(az), math.sin(az), 0]) * r
            s = rng.uniform(0.11, 0.14)
            bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=s)
            for v in bm.verts:
                ii = mb_bark.v(np.array(v.co) * np.array([1, 1, 1.15]) + c, barkco=(9.0 + v.co.x, 9.0 + v.co.y, 9.0 + v.co.z))
                v.index = ii
            for f in bm.faces: mb_bark.f([v.index for v in f.verts], mat=1)
            bm.free()
    return pts

def palm_outputs(name, rng, H, lean, lean_az, notes, height_range, spec_xy, n_fronds=15, coconuts=10, extra=None, frond_L=(4.2, 5.0)):
    greens = [(0.20, 0.30, 0.10), (0.27, 0.38, 0.12), (0.34, 0.45, 0.15), (0.42, 0.52, 0.18)]
    at, tiles, dead_t, _ = palm_atlas(name, rng, greens)
    b0, l0, b1, l1 = MB({'barkco': 3}), MB(), MB({'barkco': 3}), MB()
    st = rng.bit_generator.state
    build_palm(rng, b0, l0, tiles, dead_t, H=H, lean=lean, lean_az=lean_az, n_fronds=n_fronds, coconuts=coconuts, frond_L=frond_L)
    rng.bit_generator.state = st
    build_palm(rng, b1, l1, tiles, dead_t, H=H, lean=lean, lean_az=lean_az, n_fronds=min(n_fronds, 12), coconuts=0, lod=1, frond_L=frond_L)
    barkm = bark_mat(name + '_bark', (0.24, 0.21, 0.18), (0.46, 0.42, 0.37), (0.56, 0.52, 0.46), 9.0, 0.6, lichen=0.25,
                     rings={'spacing': 0.11, 'col': (0.22, 0.19, 0.16), 'sharp': 0.6, 'fibre': (0.36, 0.30, 0.24)}, bump=0.9)
    nutm = bpy.data.materials.new(name + '_coconut'); g = G(nutm); nutm['bake'] = True
    co = g.coord('Object'); n = g.noise(co, 6.0, 3, 0.5)
    g.output(g.bsdf(g.mix(g.mr(g.noise(co, 1.5, 2, 0.5), 0.35, 0.65), lin((0.36, 0.42, 0.14)), lin((0.52, 0.40, 0.18))), 0.55, 0.3,
                    g.bump(n, 0.3, 0.01)))
    leafm = leaf_mat(name + '_leaf', at.image(), trans=0.35, rough=0.5, spec=0.3)
    lod0 = [b0.build(name + '_bark', [barkm, nutm]), l0.build(name + '_leaves', [leafm])]
    lod1 = [b1.build(name + '_lod1_bark', [barkm]), l1.build(name + '_lod1_leaves', [leafm])]
    for o in lod0 + lod1: link_obj(o)
    lo, hi, _ = obj_bounds(lod0)
    s = np.array([spec_xy[0] / (hi[0] - lo[0]), spec_xy[1] / (hi[1] - lo[1]), H / (hi[2] - lo[2])])
    transform_objs(lod0 + lod1, np.diag([*s, 1.0]))
    lo, hi, _ = obj_bounds(lod0); T = np.eye(4); T[2, 3] = -0.2 - lo[2]; transform_objs(lod0 + lod1, T)
    ex = {'axis_scale_applied': [round(float(x), 3) for x in s], 'trunk_base_radius_m': 0.3, 'biomes': ['sunbreak_atoll', 'delta_grid']}
    ex.update(extra or {})
    return Asset(name, lod0, [spec_xy[0], spec_xy[1], H], lod1=lod1, kind='tree', atlas=at, bake_objs=[lod0[0], lod1[0]], notes=notes,
                 extra=ex, ground='sand', height_range=height_range, sink=0.2)

@asset('veg_palm', 18)
def gen_palm(name):
    rng = np.random.default_rng(5001)
    return palm_outputs(name, rng, 13.0, 0.36, 0.4, 'Coconut palm: slender curved trunk (swollen bole, ring leaf scars), '
                        '15 pinnate fronds (young upright to old drooping, V-folded with hanging leaflets), 3 dead hanging fronds, '
                        'coconut cluster.', [10.0, 16.0], (10.4, 10.0))

@asset('veg_palm_b', 19)
def gen_palm_b(name):
    rng = np.random.default_rng(5101)
    return palm_outputs(name, rng, 10.0, 0.72, -2.2, 'Leaning coconut palm (~35 deg lean at the base curving upright), '
                        '13 fronds, coconuts. Base height 10 m; instance range 8.5-11.5 m.', [8.5, 11.5], (11.0, 9.0), n_fronds=13,
                        coconuts=7, frond_L=(3.8, 4.6), extra={'lean_direction': 'toward azimuth -126 deg (from +X, CCW)'})

def tex_paddle(rng, w=128, h=512, tears=9, col=None):
    """Banana-type paddle leaf filling the tile (petiole at v=0), lateral veins and torn slits."""
    cv = Canvas(w, h); ar = h / w
    cv.leaf((0.5, 0.02), math.pi / 2, 0.96 * ar, 0.94, 'strap', shade=1.0, vein=0.18, fold=0.1)
    v = (np.arange(h) + 0.5) / h; u = (np.arange(w) + 0.5) / w
    lat = 1 + 0.06 * np.sin((v[:, None] * ar * 22 + np.abs(u[None, :] - 0.5) * 6) * 2 * math.pi)
    cv.S *= lat
    for _ in range(tears):   # tears run from the edge toward the midrib along the lateral veins
        vv = rng.uniform(0.15, 0.9); side = rng.choice((-1, 1)); depth = rng.uniform(0.15, 0.42)
        x0 = 0.5 + side * 0.5; x1 = 0.5 + side * (0.5 - depth)
        ys = (v - vv) * ar; band = np.abs(ys[:, None] - (u[None, :] - 0.5) * side * 0.35) < 0.012
        span = ((u[None, :] - x1) * side > 0)
        cv.A[band & span] = 0
    return cv

@asset('veg_jungle_cluster', 22)
def gen_jungle_cluster(name):
    rng = np.random.default_rng(5201); H = 12.0
    at = Atlas(name + '_atlas'); at.alloc('bark', 512, 512)
    pal = leaf_palette((0.07, 0.15, 0.06), (0.13, 0.26, 0.08), (0.21, 0.36, 0.11), (0.31, 0.46, 0.15))
    canv = [tex_broadleaf(np.random.default_rng(rng.integers(1 << 30)), 256, 'lance', 0.15, 0.06, 6, (4, 7), 0.6, along=0.08, fan=1.0)
            for _ in range(2)]
    tiles = shade_tiles(at, 'leaf', canv, pal, (0.30, 0.24, 0.16))
    fr = [at.put('frond%d' % i, colourize(tex_frond(np.random.default_rng(i), 64, 256, pinnae=40, lobed=False, leaflet_w=0.08, angle=0.95, gap=0.08, rachis=0.05), c))
          for i, c in enumerate([(0.22, 0.34, 0.11), (0.32, 0.44, 0.14)])]
    pad = [at.put('paddle%d' % i, colourize(tex_paddle(np.random.default_rng(i + 3), 128, 256, tears=7), c, hue_amt=0.04)) for i, c in enumerate([(0.30, 0.48, 0.14), (0.24, 0.40, 0.12)])]
    bark, leaf = MB({'barkco': 3}), MB()
    cards = []
    # canopy tree A (12 m) and B (8.5 m)
    for (ox, oy), top, lob_rings, nat, rb in (((0.0, 0.0), 6.5, [(5, (1.6, 2.8), (8.6, 9.6), (1.8, 2.3), 0.0), (2, (0.0, 0.8), (10.0, 10.4), (1.8, 2.0), 0.4)], 900, 0.24),
                                              ((3.4, -2.2), 4.2, [(4, (1.0, 1.8), (6.0, 6.8), (1.4, 1.8), 0.6), (1, (0.0, 0.3), (7.4, 7.6), (1.5, 1.5), 0.0)], 600, 0.16)):
        lobes = [(c + np.array([ox, oy, 0]), r) for c, r in ring_lobes(rng, lob_rings)]
        sk = sc_crown_tree(rng, H=H, trunk_top=(ox + 0.3, oy - 0.2, top), trunk_bend=(0.2, 0.1), lobes=lobes, n_att=nat, step=0.4,
                           d_inf=2.6, d_kill=0.8, tropism=(0, 0, 0.08), jitter=0.3, grow_min_z=top - 1.0, r_base=rb, squash=0.7,
                           att_filter=lambda p, t=top: p[2] > t + 0.5)
        sk.pos[:, 0] += np.where(np.arange(sk.n) < sk.n_fixed, ox * 0, 0)
        tr = np.array([[ox * t, oy * t, 0] for t in [1.0]])
        sk.pos[:sk.n_fixed, :2] += 0   # trunk already starts at origin; shift whole tree
        sk.pos[:, 0] += 0
        rmin = 0.04
        b = MB({'barkco': 3}); skeleton_bark(sk, b, rmin, [(0.18, 7), (0.08, 5), (0.04, 4), (0.0, 3)], broad_seg, root_flare(0.7, 0.9, 4))
        while b.tris() > (420 if top > 5 else 260):
            rmin *= 1.15; b = MB({'barkco': 3}); skeleton_bark(sk, b, rmin, [(0.18, 7), (0.08, 5), (0.04, 4), (0.0, 3)], broad_seg, root_flare(0.7, 0.9, 4))
        C = np.mean([l[0] for l in lobes], axis=0); R = np.array([3.0, 3.0, 1.8])
        cards += lobe_cards(rng, sk, lobes, C, R, 700 if top > 5 else 420, (1.1, 1.7), r_card=0.05, zmin=top, seed=11.0 + top)
        # shift: trunk was grown at the origin, move the lot
        off = np.array([ox, oy, 0.0])
        for i in range(len(b.co)): b.co[i] = tuple(np.array(b.co[i]) + off)
        for c in cards[-(700 if top > 5 else 420):]: c.p = c.p + off; c.sc = c.sc + off
        bark.co += b.co; base = len(bark.co) - len(b.co)
        for f, uv, mt in zip(b.faces, b.fuv, b.fmat): bark.faces.append(tuple(i + base for i in f)); bark.fuv.append(uv); bark.fmat.append(mt); bark.fln.append(None)
        bark.av['barkco'] += b.av['barkco']
    # small palm (6 m) at the back-left
    pts = palm_trunk_path(5.6, 0.25, 2.6, n=10, rng=rng); pts = [p + np.array([-3.0, 1.8, 0]) for p in pts]
    tube(bark, pts, [0.16 - 0.05 * i / 10 for i in range(len(pts))], 6)
    for i in range(8):
        age = i / 7; az = i * 2.39996
        palm_frond(leaf, rng, pts[-1], az, rng.uniform(2.6, 3.2), 0.2 + 1.3 * age, 0.6 + 1.1 * age, 1.1, fr[i % 2], segs=6)
    # understory: paddle (banana / heliconia) leaves around the trunks + low leaf cards
    for i in range(10):
        a = rng.uniform(0, 6.28); r = rng.uniform(1.5, 4.0); base = np.array([math.cos(a) * r + 0.6, math.sin(a) * r - 0.4, -0.05])
        L = rng.uniform(1.6, 2.6)
        pts2, o = arch_path(base, a + rng.normal(0, 0.6), L, 5, rng.uniform(0.15, 0.5), rng.uniform(0.6, 1.4))
        side = np.cross([0, 0, 1.0], o); ws = [0.05, 0.25, 0.42, 0.45, 0.35, 0.05]
        strip(leaf, pts2, ws, [np.cross(side, nrm(pts2[min(s + 1, 5)] - pts2[max(s - 1, 0)])) for s in range(6)], pad[i % 2], fold=0.12)
    C0 = np.array([0.8, -0.5, 1.2])
    for j in range(340):
        a = rng.uniform(0, 6.28); r = 4.6 * math.sqrt(rng.uniform(0.15, 1.0))
        p = np.array([math.cos(a) * r * 1.05 + 0.6, math.sin(a) * r * 0.9 - 0.4, rng.uniform(0.2, 2.6) * (1.2 - r / 5)])
        out = nrm(p - C0); s = rng.uniform(0.9, 1.4)
        lv = light_level(0.25 + 0.35 * (p[2] / 2.6) + 0.25 * max(0, np.dot(out, SUN_DIR)) + 0.1 * noise3(p, 0.5, 2, 3.0))
        cards.append(Card(p, nrm(out * 0.4 + np.array([0, 0, 1.0])), nrm(out + rng.normal(0, 0.6, 3)), s, s, lv, rng.integers(2), sc=C0))
    nb = bark.tris(); nl = leaf.tris()
    cards = finish_tree_cards(rng, cards, (4000 - nb - nl - 4) // 2)
    emit_cards(leaf, cards, tiles)
    barkm = bark_mat(name + '_bark', (0.14, 0.12, 0.10), (0.36, 0.33, 0.28), (0.48, 0.45, 0.38), 4.0, 0.4, moss=1.0, lichen=0.3,
                     moss_col=(0.26, 0.34, 0.12))
    leafm = leaf_mat(name + '_leaf', at.image(), trans=0.35, rough=0.45, spec=0.35)
    # LOD1: trunks + palm + k-means cards
    b1 = MB({'barkco': 3})
    tube(b1, [np.array([0, 0, -0.2]), np.array([0.3, -0.2, 7.5])], [0.25, 0.12], 4, tip=False)
    tube(b1, [np.array([3.4, -2.2, -0.2]), np.array([3.7, -2.4, 5.0])], [0.17, 0.08], 4, tip=False)
    tube(b1, [pts[0], pts[-1]], [0.15, 0.1], 3, tip=False)
    l1 = MB(); emit_cards(l1, lod1_cards(cards, (500 - b1.tris() - 6) // 2, rng, 0.85), tiles)
    return veg_outputs(name, [(bark, '_bark', [barkm]), (leaf, '_leaves', [leafm])], (11.0, 10.0, H), atlas=at, bake=('_bark',),
                       zmin=-0.2, center=False, lod1=[(b1, '_lod1_bark', [barkm]), (l1, '_lod1_leaves', [leafm])], height_range=[10.0, 14.0],
                       notes='Dense mixed jungle clump: 12 m and 8.5 m broadleaf trees with lance-leaf crowns, a 6 m understory palm, '
                       '10 torn banana/heliconia paddle leaves and low understory foliage cards. Treat as one blocking footprint ~9 m.',
                       extra={'biomes': ['sunbreak_atoll', 'delta_grid']}, ground='grass')

@asset('veg_shrub_tropical', 20)
def gen_shrub_tropical(name):
    rng = np.random.default_rng(5301)
    at = Atlas(name + '_atlas')
    def big_leaf(r, c, variegate=False):
        cv = Canvas(128, 256); cv.leaf((0.5, 0.01), math.pi / 2, 1.96, 0.9, 'ellipse', shade=1.0, vein=0.2, fold=0.14)
        v = (np.arange(256) + 0.5) / 256; u = (np.arange(128) + 0.5) / 128
        cv.S *= 1 + 0.07 * np.sin((v[:, None] * 9 - np.abs(u[None, :] - 0.5) * 3) * 2 * math.pi)
        if variegate:
            m = (np.abs(u[None, :] - 0.5) < 0.05 + 0.03 * np.sin(v[:, None] * 20)) * np.ones_like(cv.S)
            cv.C[:] = (0.85, 0.78, 0.30); cv.Cw[:] = m * 0.8
        return colourize(cv, c, hue_amt=0.05)
    tl = [at.put('leaf%d' % i, big_leaf(rng, c, i == 2)) for i, c in enumerate([(0.15, 0.32, 0.10), (0.22, 0.40, 0.12), (0.20, 0.36, 0.11)])]
    stem = at.put('stem', colourize(tex_blade(rng, 16, 64, base=0.7, top=0.9), (0.30, 0.40, 0.15), hue_amt=0))
    mb = MB()
    for i in range(18):
        az = i * 2.39996 + rng.normal(0, 0.2); age = i / 17
        base = np.array([math.cos(az) * 0.05, math.sin(az) * 0.05, -0.03])
        pl = rng.uniform(0.35, 0.65) * (1.1 - 0.4 * age)
        pts, o = arch_path(base, az, pl, 3, 0.15 + 0.6 * age, 0.3)
        side = np.cross([0, 0, 1.0], o)
        strip(mb, pts, [0.016, 0.013, 0.011, 0.01], [side] * 4, stem)
        L = rng.uniform(0.38, 0.55)
        lp, o2 = arch_path(pts[-1], az + rng.normal(0, 0.15), L, 4, 0.5 + 0.7 * age + rng.normal(0, 0.1), rng.uniform(0.5, 1.0))
        ws = [0.03, 0.22, 0.26, 0.2, 0.02]
        strip(mb, lp, [w * L / 0.5 for w in ws], [np.cross(side, nrm(lp[min(s + 1, 4)] - lp[max(s - 1, 0)])) for s in range(5)], tl[i % 3], fold=0.15)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.3, rough=0.35, spec=0.45, var=0.06)
    return veg_outputs(name, [(mb, '_leaves', [m])], (1.6, 1.5, 1.0), atlas=at, height_range=[0.5, 1.5],
                       notes='Tropical understory shrub: rosette of 18 large glossy veined leaves (one variegated tile) on arching '
                       'petioles, V-folded along the midrib.', extra={'biomes': ['sunbreak_atoll', 'delta_grid']})

@asset('veg_grass_beach', 21)
def gen_grass_beach(name):
    rng = np.random.default_rng(5401)
    pal = [(0.50, 0.58, 0.40), (0.58, 0.62, 0.44), (0.44, 0.52, 0.36), (0.66, 0.62, 0.44)]
    at, blades, seeds, _ = grass_atlas(name, rng, pal, dry=(0.2, 0.3, 0.0, 0.85), seed_kind='spike', seed_col=(0.72, 0.66, 0.48))
    mb = MB()
    grass_blades(mb, rng, 72, lambda i, L, l: blades[i % 4], (0.16, 0.38), 0.1, 0.0068, lean=(0.1, 0.8), bend=0.65, stiff=1.4, twist=0.2)
    seed_stalks(mb, rng, 3, seeds, blades[3], (0.32, 0.38), 0.05, head=0.1, head_w=0.022)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.25, rough=0.5, var=0.07)
    return veg_outputs(name, [(mb, '_blades', [m])], (0.55, 0.55, 0.38), atlas=at, height_range=[0.31, 0.45], ground='sand',
                       notes='Dune / beach grass (marram-spinifex type): stiff, narrow, rolled blue-grey-green blades fanning out, '
                       'many straw-dry tips, 3 seed spikes.', extra={'biomes': ['sunbreak_atoll', 'delta_grid']})

BASALT = dict(base_a=(0.22, 0.21, 0.20), base_b=(0.29, 0.28, 0.26), dark=(0.10, 0.10, 0.10))

def hex_column(mb, c, r, z0, z1, tilt=(0.0, 0.0), top_tilt=(0.0, 0.0), rings=1, rot0=0.0, rng=None, chip=0.0):
    """Hexagonal prism (basalt column): 6 sides, 'rings' vertical segments, tilted top cap."""
    ax = nrm(np.array([tilt[0], tilt[1], 1.0])); ring_ids = []
    for k in range(rings + 1):
        t = k / rings; z = z0 + (z1 - z0) * t; ids = []
        for s in range(6):
            a = rot0 + s * math.pi / 3
            p = np.asarray(c, float) + ax * (z - z0) + np.array([math.cos(a) * r, math.sin(a) * r, z0])
            if k == rings: p[2] += top_tilt[0] * math.cos(a) * r + top_tilt[1] * math.sin(a) * r
            if rng is not None and chip and 0 < k: p += rng.normal(0, chip, 3)
            ids.append(mb.v(p))
        ring_ids.append(ids)
    for k in range(rings):
        for s in range(6):
            a, b = ring_ids[k][s], ring_ids[k][(s + 1) % 6]; c2, d = ring_ids[k + 1][(s + 1) % 6], ring_ids[k + 1][s]
            mb.f([a, b, c2, d])
    t = ring_ids[-1]; mb.f([t[0], t[1], t[2], t[3]]); mb.f([t[3], t[4], t[5], t[0]])

@asset('rock_basalt_a', 55)
def gen_rock_basalt_a(name):
    rng = np.random.default_rng(5501); dims = (3.4, 3.0, 2.9)
    m = rock_mat(name + '_mat', dims[2], BASALT['base_a'], BASALT['base_b'], BASALT['dark'], streak=0.25, lichen=0.35,
                 lichen_col=(0.72, 0.60, 0.34), moss=0.3, crack=0.3, edge=0.25, dirt=0.4, scale=1.5)
    mb = MB(); r = 0.42; cells = [(0, 0)] + [(math.cos(a) * 0.74, math.sin(a) * 0.74) for a in np.arange(6) * math.pi / 3 + math.pi / 6]
    cells += [(1.48 * math.cos(a), 1.48 * math.sin(a)) for a in (0.5, 2.6, 4.4)]
    for i, (x, y) in enumerate(cells):
        h = rng.uniform(1.4, 3.0) * (1.0 if i < 7 else 0.6)
        hex_column(mb, (x, y, 0), r * rng.uniform(0.93, 0.98), -0.3, h, tilt=(0.18, 0.05), top_tilt=(rng.normal(0, 0.25), rng.normal(0, 0.25)),
                   rings=3, rot0=math.pi / 6, rng=rng, chip=0.03)
    o = mb.build(name, [m]); link_obj(o)
    sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.subdivision_type = 'SIMPLE'; apply_modifiers(o)
    P = get_co(o); d = P - P.mean(0); P += nrm(np.array([1, 1, 1.0])) * 0 + (0.05 * vnoise(P, 1.8, 3, 1.0))[:, None] * np.array([1, 1, 0.5])
    set_co(o, P); decimate_to(o, 1600)
    return rock_outputs(name, [o], dims, sink_frac=0.1, smooth=35, notes='Dark basalt outcrop: 10 fused hexagonal columns of '
                        'different heights, tilted ~10 deg, chipped tops, orange lichen and pale weathered edges.',
                        extra={'biomes': ['sunbreak_atoll']}, ground='sand')

@asset('rock_cliff_basalt', 56)
def gen_rock_cliff_basalt(name):
    rng = np.random.default_rng(5601); W, D, Hh = 24.0, 10.0, 12.0
    m = rock_mat(name + '_mat', Hh, BASALT['base_a'], BASALT['base_b'], BASALT['dark'], streak=0.45, lichen=0.35,
                 lichen_col=(0.72, 0.60, 0.34), moss=0.4, moss_col=(0.26, 0.34, 0.12), crack=0.2, edge=0.25, scale=0.8)
    mb = MB(); r = 0.6; dx = r * math.sqrt(3) * 1.0; dy = r * 1.5
    rows = int(D / dy) + 1; cols = int(W / dx) + 2
    for j in range(rows):
        y = -D / 2 + 0.3 + j * dy
        for i in range(cols):
            x = -W / 2 + (i + 0.5 * (j % 2)) * dx
            if abs(x) > W / 2 - 0.2: continue
            t = np.clip((abs(x) - (W / 2 - 5.0)) / 5.0, 0, 1)
            top = Hh - 0.6 * rng.uniform() - 4.5 * t ** 1.5 + 0.4 * noise3((x, y, 0), 0.15, 2, 3.0)
            if j == 0: top = rng.uniform(0.6, 5.5) * (1 - 0.5 * t)
            elif j == 1: top = min(top, rng.uniform(3.5, 9.5))
            elif j == 2 and rng.uniform() < 0.4: top = min(top, rng.uniform(7.0, 10.5))
            rings = 3 if j < 3 else 1
            hex_column(mb, (x, y, 0), r * rng.uniform(0.9, 0.97), -0.6, top, tilt=(0.0, 0.03), top_tilt=(rng.normal(0, 0.2), rng.normal(0, 0.2)),
                       rings=rings, rot0=math.pi / 6, rng=rng, chip=0.04 if j < 3 else 0.0)
    o = mb.build(name, [m]); link_obj(o); decimate_to(o, 6000)
    return rock_outputs(name, [o], (W, D, Hh), sink_frac=0.05, center=False, smooth=30,
                        notes='Columnar basalt cliff chunk 24 x 10 x 12 m, face toward -Y: ~150 hexagonal columns (1.1 m), front rows '
                        'broken into steps, ends taper; orange lichen, moss on column tops.',
                        extra={'face': '-Y', 'biomes': ['sunbreak_atoll'], 'overlap_m': 4.0}, ground='sand')

def coral_branch(mb, rng, p, d, L, r, depth, maxd, kids=(1, 3), mat=0, spread=(0.35, 0.8), up=0.35):
    e = p + d * L
    mid = (p + e) / 2 + rng.normal(0, L * 0.06, 3)
    tube(mb, [p, mid, e], [r, r * 0.9, r * 0.78], 5 if r > 0.055 else 4, mat=mat, tip=depth >= maxd)
    if depth >= maxd: return
    for k in range(rng.integers(kids[0], kids[1] + 1)):
        nd = nrm(rot(d, perp(d), rng.uniform(*spread) * rng.choice((-1, 1))) + np.array([0, 0, up]))
        nd = rot(nd, d, rng.uniform(0, 6.28))
        coral_branch(mb, rng, e, nrm(nd), L * rng.uniform(0.7, 0.95), r * 0.78, depth + 1, maxd, kids, mat, spread, up)

def coral_plate(mb, rng, c, R, h_stalk, mat=0, segs=16, rings=3, cup=0.12):
    tube(mb, [c, c + np.array([0, 0, h_stalk * 0.5]), c + np.array([0, 0, h_stalk])], [0.12, 0.09, 0.08], 6, mat=mat, tip=False)
    top = c + np.array([0, 0, h_stalk]); ph = rng.uniform(0, 6.28, 3)
    grid = []
    for k in range(rings + 1):
        rr = R * (0.08 + 0.92 * k / rings); row = []
        for s in range(segs):
            a = 2 * math.pi * s / segs
            wob = 1 + 0.12 * math.sin(3 * a + ph[0]) + 0.07 * math.sin(7 * a + ph[1])
            z = cup * (k / rings) ** 2 * R + 0.06 * math.sin(5 * a + ph[2]) * (k / rings)
            row.append((top + np.array([math.cos(a) * rr * wob, math.sin(a) * rr * wob, z])))
        grid.append(row)
    for sgn, dz in ((1, 0.0), (-1, -0.05)):
        ids = [[mb.v(p + np.array([0, 0, dz])) for p in row] for row in grid]
        for k in range(rings):
            for s in range(segs):
                q = [ids[k][s], ids[k][(s + 1) % segs], ids[k + 1][(s + 1) % segs], ids[k + 1][s]]
                mb.f(q if sgn > 0 else q[::-1], mat=mat)

def rubble_mound(name, rng, dims, mat, tris=500):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0); o = bm_obj(name, bm)
    P = get_co(o) * np.array([dims[0] / 2, dims[1] / 2, dims[2]])
    P += (0.12 * vnoise(P, 1.2, 4, 3.0))[:, None] * nrm(np.array([0, 0, 1.0]))
    P[:, 2] = np.maximum(P[:, 2], -0.15); set_co(o, P); decimate_to(o, tris); o.data.materials.append(mat); return o

def coral_mat(name, H, a, b, dark, tip, groove=None, stain=None, speckle=True, edge=0.3):
    return rock_mat(name, H, a, b, dark, streak=0.0, lichen=0.0, moss=0.0, dirt=0.25, dirt_col=(0.55, 0.52, 0.45), crack=0.0,
                    edge=edge, ao=0.6, rough=0.7, scale=3.0, groove=groove, stain=stain,
                    speckle={'scale': 60.0, 'black': 0.0, 'white': 0.35, 'pink': 0.0} if speckle else None)

@asset('coral_cluster_a', 57)
def gen_coral_a(name):
    rng = np.random.default_rng(5701); dims = (3.6, 3.0, 1.5)
    stag = coral_mat(name + '_staghorn', 1.0, (0.60, 0.45, 0.30), (0.70, 0.54, 0.36), (0.34, 0.24, 0.16), None,
                     stain={'col': (0.55, 0.42, 0.68), 'scale': 1.6, 'lo': 0.55, 'hi': 0.65, 'amt': 0.7}, edge=0.2)
    plate = coral_mat(name + '_plate', 1.0, (0.46, 0.50, 0.34), (0.56, 0.58, 0.40), (0.24, 0.26, 0.18), None,
                      stain={'col': (0.70, 0.62, 0.40), 'scale': 3.0, 'lo': 0.55, 'hi': 0.7, 'amt': 0.6})
    rub = rock_mat(name + '_rubble', 0.5, (0.72, 0.69, 0.60), (0.80, 0.77, 0.68), (0.45, 0.42, 0.36), lichen=0.0, moss=0.0,
                   streak=0.0, crack=0.2, dirt=0.0, edge=0.3, scale=3.0, stain={'col': (0.40, 0.48, 0.30), 'scale': 2.5, 'amt': 0.5})
    mb = MB({'barkco': 3})
    for c in ((-0.7, 0.3), (0.5, -0.4), (0.2, 0.8), (-0.3, -0.9), (0.0, 0.0), (-1.0, -0.3)):
        base = np.array([c[0], c[1], 0.15])
        for k in range(2):
            d = nrm(np.array([rng.normal(0, 0.6), rng.normal(0, 0.6), 1.0]))
            coral_branch(mb, rng, base + rng.normal(0, 0.12, 3) * np.array([1, 1, 0]), d, rng.uniform(0.26, 0.36), 0.06, 0, 2,
                         (2, 3), mat=0, spread=(0.4, 0.8), up=0.25)
    for c, R in (((1.2, 0.6, 0.1), 0.75), ((-1.15, -0.5, 0.05), 0.6)):
        coral_plate(mb, rng, np.array(c), R, rng.uniform(0.35, 0.55), mat=1)
    o = mb.build(name + '_coral', [stag, plate]); link_obj(o); o.data.shade_smooth()
    mound = rubble_mound(name + '_base', rng, (3.0, 2.5, 0.35), rub, 450)
    return rock_outputs(name, [o, mound], dims, sink_frac=0.08, smooth=60, ground='seafloor',
                        notes='Branching coral cluster on a rubble mound: 4 staghorn colonies (cream-tan, lilac patches, pale tips) and '
                        '2 olive table corals. Origin at sea-floor contact; place under shallow water.',
                        extra={'biomes': ['sunbreak_atoll'], 'underwater': True})

@asset('coral_cluster_b', 58)
def gen_coral_b(name):
    rng = np.random.default_rng(5801); dims = (3.2, 2.7, 1.3)
    brain = coral_mat(name + '_brain', 1.2, (0.66, 0.56, 0.34), (0.74, 0.64, 0.40), (0.36, 0.30, 0.18), None,
                      groove={'scale': 9.0, 'stretch': (1, 1, 1), 'width': 0.06, 'amt': 0.75, 'col': (0.30, 0.38, 0.22), 'depth': 1.0}, speckle=False)
    finger = coral_mat(name + '_finger', 1.0, (0.62, 0.50, 0.60), (0.72, 0.60, 0.68), (0.34, 0.26, 0.32), None)
    rub = rock_mat(name + '_rubble', 0.5, (0.72, 0.69, 0.60), (0.80, 0.77, 0.68), (0.45, 0.42, 0.36), lichen=0.0, moss=0.0,
                   streak=0.0, crack=0.2, dirt=0.0, edge=0.3, scale=3.0, stain={'col': (0.40, 0.48, 0.30), 'scale': 2.5, 'amt': 0.5})
    objs = []
    for i, (c, r, h) in enumerate((((-0.2, 0.0, 0.0), 1.1, 1.15), ((1.05, 0.65, 0.0), 0.45, 0.5), ((0.95, -0.7, 0.0), 0.38, 0.4))):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=4 if i == 0 else 3, radius=1.0); o = bm_obj(name + '_dome%d' % i, bm)
        P = get_co(o); P[:, 2] = np.maximum(P[:, 2], -0.25)
        P = P * np.array([r, r * 0.92, h]) + np.array(c)
        P += (0.04 * vnoise(P, 2.0, 3, i))[:, None] * nrm(np.array([0, 0, 1.0]))
        set_co(o, P); decimate_to(o, 900 if i == 0 else 260); o.data.materials.append(brain); o.data.shade_smooth(); objs.append(o)
    mb = MB({'barkco': 3})
    for k in range(14):
        a = rng.uniform(0, 6.28); rr = rng.uniform(1.0, 1.5); base = np.array([math.cos(a) * rr - 0.2, math.sin(a) * rr * 0.9, -0.05])
        if base[0] > 0.6 and abs(base[1]) > 0.3: continue
        hgt = rng.uniform(0.35, 0.8)
        tube(mb, [base, base + np.array([rng.normal(0, 0.05), rng.normal(0, 0.05), hgt * 0.5]), base + np.array([rng.normal(0, 0.08), rng.normal(0, 0.08), hgt])],
             [0.07, 0.065, 0.055], 6, mat=0)
    f = mb.build(name + '_fingers', [finger]); link_obj(f); f.data.shade_smooth(); objs.append(f)
    objs.append(rubble_mound(name + '_base', rng, (3.0, 2.6, 0.3), rub, 400))
    return rock_outputs(name, objs, dims, sink_frac=0.08, smooth=60, ground='seafloor',
                        notes='Massive coral cluster: a 2.2 m brain coral dome and two small domes (meandering grooves in the shader), '
                        'mauve finger/pillar corals and a rubble base. Origin at sea-floor contact.',
                        extra={'biomes': ['sunbreak_atoll'], 'underwater': True})

# ══════════════════════════════════════════════════════════════════════ TIER 6: Delta Grid
@asset('veg_mangrove', 23)
def gen_mangrove(name):
    rng = np.random.default_rng(6001); H = 9.0
    pal = leaf_palette((0.08, 0.14, 0.07), (0.14, 0.24, 0.10), (0.21, 0.33, 0.13), (0.30, 0.42, 0.17))
    atlas, tiles = std_leaf_setup(name, rng, lambda r, T: tex_broadleaf(r, T, 'ellipse', 0.1, 0.05, 7, (4, 7), 0.55, along=0.07, fan=1.1),
                                  pal, (0.32, 0.25, 0.18))
    lobes = ring_lobes(rng, [(6, (2.0, 2.9), (5.6, 6.4), (1.7, 2.2), 0.0), (3, (0.0, 1.3), (7.0, 7.5), (1.8, 2.1), 0.5)])
    C = np.array([0, 0, 6.4]); R = np.array([3.8, 3.8, 1.9])
    sk = sc_crown_tree(rng, H=H, trunk_top=(0.2, 0.1, 3.4), trunk_bend=(0.2, -0.15), lobes=lobes, n_att=1200, step=0.35, d_inf=2.5,
                       d_kill=0.7, tropism=(0, 0, 0.06), jitter=0.35, grow_min_z=2.4, r_base=0.2, squash=0.75, att_filter=lambda p: p[2] > 4.0)
    cards = lobe_cards(rng, sk, lobes, C, R, 2400, (1.0, 1.5), r_card=0.05, zmin=3.6, seed=13.0)
    roots = []
    for i in range(15):
        az = i * 2 * math.pi / 15 + rng.normal(0, 0.15); h0 = rng.uniform(0.7, 2.6); Rr = rng.uniform(1.6, 3.7) * (0.6 + 0.4 * h0 / 2.6)
        o = np.array([math.cos(az), math.sin(az), 0.0]); p0 = np.array([0.0, 0.0, h0]) + o * 0.12
        p1 = p0 + o * Rr * 0.55 + np.array([0, 0, 0.35]); p2 = o * Rr + np.array([0, 0, -0.25])
        pts = list(bezier(p0, p1, p2, 7)); r0 = rng.uniform(0.045, 0.07)
        roots.append((pts, [r0 * (1 - 0.25 * j / 6) for j in range(7)]))
        if rng.uniform() < 0.45:   # secondary arch from the root
            q0 = pts[3]; q2 = q0 + o * rng.uniform(0.6, 1.2) + np.array([0, 0, -q0[2] - 0.25])
            roots.append((list(bezier(q0, (q0 + q2) / 2 + np.array([0, 0, 0.25]), q2, 5)), [r0 * 0.7] * 5))
    def extra_bark(mb, lod):
        for pts, rr in roots:
            if lod == 'lod0': tube(mb, pts, rr, 4, tip=False)
    def lod1_extra(mb):
        for pts, rr in roots[::2]:
            tube(mb, [pts[0], pts[3], pts[-1]], [rr[0], rr[3], rr[-1]], 3, tip=False)
    barkm = bark_mat(name + '_bark', (0.16, 0.13, 0.10), (0.38, 0.33, 0.27), (0.48, 0.42, 0.34), 6.0, 0.6, lichen=0.35, mud=0.55)
    leafm = leaf_mat(name + '_leaf', atlas.image(), trans=0.25, rough=0.5, spec=0.28)
    return tree_outputs(name, rng, sk, cards, tiles, atlas, barkm, leafm, H=H, spec_xy=(8.2, 7.8), r_min_geo=0.03,
                        sides_table=[(0.15, 7), (0.07, 5), (0.03, 4), (0.0, 3)], seg_fn=broad_seg, flare=None, bark_budget=1300,
                        extra_bark=extra_bark, lod1_extra=lod1_extra, height_range=[7.5, 10.5], ground='mud',
                        notes='Red mangrove: ~15 arching prop roots springing from 0.7-2.6 m up the trunk into the mud (some with '
                        'secondary arches), mud-stained bark below 0.55 m, dense rounded crown of leathery glossy leaves. Base '
                        'height 9 m; instance range 7.5-10.5 m.', extra={'crown_base_m': 4.0, 'root_spread_m': 7.4, 'biomes': ['delta_grid']})

@asset('veg_reeds', 24)
def gen_reeds(name):
    rng = np.random.default_rng(6101)
    pal = [(0.40, 0.48, 0.20), (0.48, 0.52, 0.24), (0.34, 0.42, 0.18), (0.60, 0.55, 0.34)]
    at, blades, seeds, _ = grass_atlas(name, rng, pal, dry=(0.15, 0.3, 0.0, 0.7), seed_kind='plume', seed_col=(0.50, 0.38, 0.32))
    mb = MB()
    for i in range(32):
        rr = 0.32 * math.sqrt(rng.uniform()); a = rng.uniform(0, 6.28)
        b = np.array([rr * math.cos(a), rr * math.sin(a), -0.05]); Hs = rng.uniform(1.3, 2.0)
        d = nrm(np.array([math.cos(a) * 0.08, math.sin(a) * 0.08, 1.0]) + rng.normal(0, 0.03, 3))
        tip = b + d * Hs; side = nrm(np.cross(d, [0, 0, 1.0]) + 1e-3)
        mids = [b + d * Hs * t + np.array([math.cos(a), math.sin(a), 0]) * 0.04 * t * t for t in (0.0, 0.35, 0.7, 1.0)]
        strip(mb, mids, [0.011, 0.009, 0.007, 0.004], [side] * 4, blades[3 if i % 5 == 0 else 2])
        for j in range(3):
            z0 = rng.uniform(0.25, 0.75); p0 = b + d * Hs * z0; az = a + rng.uniform(-2.5, 2.5)
            L = rng.uniform(0.35, 0.55)
            pts, o = arch_path(p0, az, L, 3, rng.uniform(0.4, 0.8), rng.uniform(0.4, 1.0))
            sd = np.cross([0, 0, 1.0], o)
            strip(mb, pts, [0.022, 0.02, 0.014, 0.0], [np.cross(sd, nrm(pts[min(s + 1, 3)] - pts[max(s - 1, 0)])) for s in range(4)], blades[j % 3])
        if Hs > 1.55:
            for k in range(2):
                nm = np.array([math.cos(a + k * 1.57), math.sin(a + k * 1.57), 0.0])
                card(mb, tip - d * 0.32, nrm(d + np.array([math.cos(a), math.sin(a), 0]) * 0.25), nm, 0.09, 0.36, seeds[i % 2], anchor=0.05)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.3, rough=0.55, var=0.08)
    return veg_outputs(name, [(mb, '_reeds', [m])], (1.2, 1.2, 2.0), atlas=at, height_range=[1.6, 2.4], zmin=-0.05, ground='mud',
                       notes='Common reed (Phragmites) clump: 32 culms 1.3-2.0 m with arching strap leaves and purple-brown feathery '
                       'plumes on the tallest. Base sinks 5 cm for waterline placement.', extra={'biomes': ['delta_grid']})

@asset('veg_broadleaf_tropical', 25)
def gen_broadleaf_tropical(name):
    rng = np.random.default_rng(6201); H = 14.0
    pal = leaf_palette((0.09, 0.16, 0.06), (0.16, 0.27, 0.09), (0.25, 0.38, 0.12), (0.36, 0.48, 0.16))
    atlas, tiles = std_leaf_setup(name, rng, lambda r, T: tex_broadleaf(r, T, 'ellipse', 0.055, 0.032, 9, (8, 13), 0.55, along=0.03, fan=1.3, petiole=0.05),
                                  pal, (0.30, 0.24, 0.17))
    lobes = ring_lobes(rng, [(10, (6.8, 9.0), (8.8, 10.0), (2.4, 3.1), 0.0), (6, (3.4, 5.2), (10.6, 11.4), (2.6, 3.2), 0.3),
                             (2, (0.0, 1.5), (11.6, 12.0), (2.6, 2.9), 1.0)])
    C = np.array([0, 0, 10.5]); R = np.array([10.5, 10.5, 2.6])
    sk = sc_crown_tree(rng, H=H, trunk_top=(0.3, -0.2, 3.4), trunk_bend=(0.2, 0.1), lobes=lobes, n_att=3400, step=0.5, d_inf=9.5,
                       d_kill=0.95, tropism=(0, 0, 0.0), jitter=0.25, grow_min_z=2.6, r_base=0.62, squash=0.55, shell=0.45, exp=2.2,
                       att_filter=lambda p: p[2] > 7.6)
    cards = lobe_cards(rng, sk, lobes, C, R, 2600, (1.5, 2.2), r_card=0.07, zmin=6.5, seed=15.0, nm_up=1.0)
    barkm = bark_mat(name + '_bark', (0.10, 0.09, 0.07), (0.30, 0.27, 0.23), (0.40, 0.36, 0.30), 4.5, 0.4, moss=0.9, lichen=0.4,
                     moss_col=(0.28, 0.36, 0.13))
    leafm = leaf_mat(name + '_leaf', atlas.image(), trans=0.32)
    return tree_outputs(name, rng, sk, cards, tiles, atlas, barkm, leafm, H=H, spec_xy=(22.0, 21.0), r_min_geo=0.035,
                        sides_table=BROAD_SIDES, seg_fn=broad_seg, flare=root_flare(0.8, 1.2, 6), bark_budget=1150,
                        height_range=[11.0, 17.0], notes='Rain tree (Samanea saman type): short massive buttressed trunk forking at '
                        '~3.4 m into a few huge low-angled limbs; very wide flat-domed umbrella crown (~22 m) of fine bipinnate leaflets.',
                        extra={'crown_base_m': 7.0, 'biomes': ['delta_grid', 'sunbreak_atoll']})

@asset('veg_crop', 26)
def gen_crop(name):
    rng = np.random.default_rng(6301)
    pal = [(0.30, 0.48, 0.14), (0.36, 0.54, 0.16), (0.26, 0.42, 0.12)]
    at, blades, seeds, _ = grass_atlas(name, rng, pal, seed_kind=None)
    mb = MB()
    for k, x in enumerate((-0.32, 0.0, 0.3)):
        b = np.array([x + rng.normal(0, 0.03), rng.normal(0, 0.03), -0.03]); Hs = rng.uniform(0.38, 0.55)
        st = [b + np.array([0, 0, Hs * t]) + rng.normal(0, 0.005, 3) * t for t in (0.0, 0.5, 1.0)]
        side = np.array([0, 1.0, 0])
        strip(mb, st, [0.03, 0.026, 0.02], [side] * 3, blades[2]); strip(mb, st, [0.03, 0.026, 0.02], [np.array([1.0, 0, 0])] * 3, blades[2])
        phase = rng.uniform(0, 6.28)
        for j in range(8):
            z0 = Hs * (0.12 + 0.85 * j / 8); az = phase + (j % 2) * math.pi + rng.normal(0, 0.35) + j * 0.15
            L = rng.uniform(0.45, 0.72) * (1.0 - 0.35 * (j / 8) ** 2)
            pts, o = arch_path(b + np.array([0, 0, z0]), az, L, 5, rng.uniform(0.25, 0.6) - 0.2 * (j < 2), rng.uniform(0.8, 1.5))
            sd = np.cross([0, 0, 1.0], o)
            ws = [0.025, 0.065, 0.075, 0.065, 0.04, 0.0]
            strip(mb, pts, ws, [np.cross(sd, nrm(pts[min(s + 1, 5)] - pts[max(s - 1, 0)])) for s in range(6)], blades[(j + k) % 2], fold=0.12)
    m = leaf_mat(name + '_leaf', at.image(), trans=0.35, rough=0.5, var=0.06)
    return veg_outputs(name, [(mb, '_plants', [m])], (1.1, 0.9, 0.8), atlas=at, height_range=[0.6, 1.0], ground='mud',
                       notes='Farm crop clump (young maize/sorghum): three plants in a short row along X, each with ~8 arching '
                       'strap leaves with a folded midrib. Tile along X at ~1 m spacing for crop rows.', extra={'row_axis': 'X', 'biomes': ['delta_grid']})

# ══════════════════════════════════════════════════════════════════════ TIER 7: Copperhead Bay
@asset('veg_poplar', 27)
def gen_poplar(name):
    rng = np.random.default_rng(7001); H = 17.0
    pal = leaf_palette((0.12, 0.18, 0.07), (0.21, 0.31, 0.10), (0.31, 0.42, 0.13), (0.43, 0.53, 0.18))
    atlas, tiles = std_leaf_setup(name, rng, lambda r, T: tex_broadleaf(r, T, 'rhomb', 0.075, 0.07, 9, (5, 8), 0.55, along=0.05, fan=1.0,
                                  side_len=(0.2, 0.32)), pal, (0.32, 0.26, 0.18))
    top = 16.7; n = 46
    trunk = np.array([[0.05 * math.sin(t * 4), 0.04 * math.cos(t * 3), -0.25 + (top + 0.25) * t] for t in np.linspace(0, 1, n)])
    spindle = lambda t: max(0.08, math.sin(math.pi * min(1, max(0, t)) ** 0.62) ** 0.7)
    brs = []; z = 1.6; k = 0
    while z < top - 0.5:
        t = (z - 1.0) / (top - 1.0); az = k * 2.39996 + rng.normal(0, 0.2); ang = rng.uniform(0.18, 0.42)
        R = 1.85 * spindle(t) * rng.uniform(0.75, 1.05); L = R / math.sin(ang)
        p0 = trunk[min(n - 1, int((z + 0.25) / (top + 0.25) * (n - 1)))]
        d = np.array([math.cos(az) * math.sin(ang), math.sin(az) * math.sin(ang), math.cos(ang)])
        pts = [p0 + d * L * f + np.array([0, 0, 0.0]) for f in (0, 0.5, 1.0)]
        pts[1] += np.array([math.cos(az), math.sin(az), 0]) * L * 0.06
        brs.append((np.array(pts), 0.015 + 0.04 * min(1, L / 4), t, L, az))
        z += rng.uniform(0.28, 0.42); k += 1
    cards = []
    C = np.array([0, 0, 8.5]); Rr = np.array([1.9, 1.9, 8.0])
    for pts, rb, t, L, az in brs:
        for j in range(int(8 + L * 6)):
            f = rng.uniform(0.25, 1.0); p = pts[0] + (pts[-1] - pts[0]) * f + rng.normal(0, 0.18, 3)
            out = nrm(np.array([p[0], p[1], 0.0]) + 1e-6)
            up = nrm(np.array([0, 0, 1.0]) + out * 0.35 + rng.normal(0, 0.3, 3))
            nm = nrm(out + rng.normal(0, 0.7, 3)); s = rng.uniform(0.9, 1.35)
            rad = math.hypot(p[0], p[1]) / max(0.3, 1.9 * spindle((p[2] - 1.0) / (top - 1.0)))
            lv = light_level(0.45 * min(rad, 1.1) + 0.3 * max(0, np.dot(out, SUN_DIR)) + 0.2 * (p[2] / top) + 0.08 * noise3(p, 0.5, 2, 1.0))
            cards.append(Card(p, up, nm, s, s * 1.1, lv, var_index(p, 3, 21.0), sc=np.array([0, 0, p[2] - 0.5])))
    barkm = bark_mat(name + '_bark', (0.12, 0.11, 0.09), (0.36, 0.34, 0.30), (0.48, 0.46, 0.40), 3.0, 0.25, lichen=0.3, moss=0.3)
    leafm = leaf_mat(name + '_leaf', atlas.image(), trans=0.35)
    return conifer_outputs(name, rng, trunk, brs, [], cards, tiles, atlas, barkm, leafm, H=H, spec_xy=(4.0, 4.0), r_base=0.32, top=top,
                           height_range=[16.0, 18.0], trunk_sides=8,
                           notes='Lombardy poplar: straight trunk with steeply ascending branches packed into a narrow spindle-shaped '
                           'column (~4 m wide), rhombic fluttering leaves. For windbreak rows: plant 3-4 m apart.',
                           extra={'crown_base_m': 1.5, 'biomes': ['copperhead_bay']})

@asset('rock_copper_a', 71)
def gen_rock_copper_a(name):
    rng = np.random.default_rng(7101); dims = (4.0, 3.4, 2.6)
    m = rock_mat(name + '_mat', dims[2], (0.47, 0.25, 0.15), (0.58, 0.34, 0.20), (0.25, 0.13, 0.08), strata=0.3, strata_freq=5.0,
                 streak=0.45, lichen=0.15, lichen_col=(0.70, 0.66, 0.50), moss=0.15, crack=0.45, edge=0.35, dirt=0.7,
                 dirt_col=(0.50, 0.32, 0.20), stain={'col': (0.26, 0.52, 0.44), 'scale': 2.2, 'lo': 0.62, 'hi': 0.7, 'amt': 0.75})
    o = make_rock(name, rng, dims, 1800, m, planes=13, pd=(0.45, 0.8), round_=0.05, chips=18, noise_amp=0.06, horiz_bias=0.3,
                  bottom=-0.5, seed=7.0)
    return rock_outputs(name, [o], dims, notes='Copper-ore earth rock: craggy fractured boulder in iron-oxide reds and ochres with '
                        'faint bedding, dark streaks and blue-green malachite staining in patches; dusty base.',
                        extra={'biomes': ['copperhead_bay']}, ground='dry')

# ══════════════════════════════════════════════════════════════════════ preview
def figure(col=(0.85, 0.32, 0.06)):
    """1.80 m reference figure (high-vis orange top, dark trousers)."""
    mb = MB()
    def cyl(p0, p1, r, sides=8, mat=0): tube(mb, [np.array(p0), np.array(p1)], [r, r * 0.9], sides, mat=mat)
    for sx in (-0.1, 0.1):
        cyl((sx, 0, 0.0), (sx, 0, 0.86), 0.075, mat=1)
    cyl((0, 0, 0.82), (0, 0, 1.45), 0.19, 10, 0)
    for sx in (-0.25, 0.25):
        cyl((sx, 0, 1.42), (sx * 1.15, 0.02, 0.84), 0.05, 6, 0)
    cyl((0, 0, 1.45), (0, 0, 1.56), 0.06, 6, 2)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.115)
    for v in bm.verts: v.co.z += 1.685
    o = mb.build('_figure', [bpy.data.materials.new('_fig_top'), bpy.data.materials.new('_fig_leg'), bpy.data.materials.new('_fig_skin')])
    hm = bpy.data.meshes.new('_head'); bm.to_mesh(hm); bm.free()
    head = bpy.data.objects.new('_figure_head', hm); hm.materials.append(o.data.materials[2])
    for m, c in zip(o.data.materials, (col, (0.06, 0.07, 0.09), (0.55, 0.38, 0.28))):
        m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)
        m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    return [o, head]

GROUNDS = {   # sRGB
    'grass': ((0.24, 0.30, 0.13), (0.33, 0.35, 0.19)),
    'dry': ((0.42, 0.40, 0.24), (0.50, 0.45, 0.30)),
    'sand': ((0.80, 0.75, 0.64), (0.86, 0.81, 0.70)),
    'mud': ((0.30, 0.26, 0.20), (0.38, 0.33, 0.25)),
    'seafloor': ((0.68, 0.64, 0.54), (0.76, 0.72, 0.60)),
    'rock': ((0.34, 0.34, 0.30), (0.44, 0.43, 0.38)),
}

def ground_mat(kind):
    a, b = GROUNDS.get(kind, GROUNDS['grass']); a, b = lin(a), lin(b)
    m = bpy.data.materials.new('_ground'); g = G(m)
    co = g.coord('Object'); xyz = g.xyz(co)
    col = g.mix(g.noise(co, 0.25, 4, 0.6), a, b)
    col = g.mix(g.mr(g.noise(co, 3.0, 3, 0.6), 0.4, 0.7, 0, 0.3), col, (b[0] * 1.2, b[1] * 1.1, b[2] * 1.1))
    lines = None
    for c in (xyz[0], xyz[1]):
        l = g.math('LESS_THAN', g.math('PINGPONG', c, 0.5), 0.006)
        l5 = g.math('LESS_THAN', g.math('PINGPONG', g.math('DIVIDE', c, 5.0), 0.5), 0.006)
        l = g.math('MAXIMUM', l, l5)
        lines = l if lines is None else g.math('MAXIMUM', lines, l)
    fade = g.mr(g.vmath('LENGTH', co), 18, 30, 1, 0)
    col = g.mix(g.math("MULTIPLY", lines, g.math("MULTIPLY", fade, 0.12)), col, (0.85, 0.85, 0.8))
    g.output(g.bsdf(col, 0.95, 0.2))
    return m

def setup_render(size_x, size_y, samples):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); c = sc.cycles
    c.samples = samples; c.use_adaptive_sampling = True; c.adaptive_threshold = 0.04
    c.use_denoising = True; c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 4; c.diffuse_bounces = 2; c.glossy_bounces = 1; c.transmission_bounces = 2; c.transparent_max_bounces = 24
    c.volume_bounces = 0; c.caustics_reflective = False; c.caustics_refractive = False
    sc.render.resolution_x = size_x; sc.render.resolution_y = size_y; sc.render.resolution_percentage = 100
    sc.render.threads_mode = 'FIXED'; sc.render.threads = THREADS
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.exposure = -0.35

def setup_world():
    sc = bpy.context.scene; w = bpy.data.worlds.new('_world'); sc.world = w; w.use_nodes = True
    nt = w.node_tree; N = nt.nodes; bg = N['Background']
    tc = N.new('ShaderNodeTexCoord'); sep = N.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = N.new('ShaderNodeValToRGB'); nt.links.new(sep.outputs[2], ramp.inputs[0])
    # Generated coords for world = view direction; z in [-1, 1] mapped to [0, 1]
    mr = N.new('ShaderNodeMapRange'); nt.links.new(sep.outputs[2], mr.inputs['Value']); mr.inputs['From Min'].default_value = -0.2; mr.inputs['From Max'].default_value = 1.0
    nt.links.new(mr.outputs[0], ramp.inputs[0])
    ramp.color_ramp.elements[0].color = (0.62, 0.68, 0.74, 1); ramp.color_ramp.elements[1].color = (0.20, 0.36, 0.66, 1)
    nt.links.new(ramp.outputs[0], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN')); link_obj(sun)
    sun.data.energy = 4.2; sun.data.angle = math.radians(2.0); sun.data.color = (1.0, 0.96, 0.9)
    d = -SUN_DIR; sun.rotation_euler = Vector(d).to_track_quat('-Z', 'Y').to_euler()
    return [sun]

def camera(name, target, elev, azim, dist, lens=50, ortho=None, sx=1, sy=1):
    cd = bpy.data.cameras.new(name); cam = bpy.data.objects.new(name, cd); link_obj(cam)
    e, a = math.radians(elev), math.radians(azim); t = Vector(target)
    cam.location = t + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cd.lens = lens; cd.clip_end = 3000; cd.clip_start = 0.05
    if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
    cd.sensor_fit = 'AUTO'
    bpy.context.scene.camera = cam
    return cam

def render_to(path):
    sc = bpy.context.scene; sc.render.filepath = path; bpy.ops.render.render(write_still=True); return path

def load_px(path):
    img = bpy.data.images.load(path); w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a); bpy.data.images.remove(img)
    return a.reshape(h, w, 4)

def save_px(path, px):
    h, w = px.shape[:2]; img = bpy.data.images.new('_comp', w, h, alpha=False)
    img.pixels.foreach_set(px.ravel()); img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)

def upscale(px, k): return np.repeat(np.repeat(px, k, axis=0), k, axis=1)

def preview(a, quick=False):
    """Main panel: asset + 1.8 m figure + 1 m ground grid.  Trees add an RTS-distance panel (LOD0 vs LOD1) and a
    15 m close-up panel."""
    t0 = time.time(); helpers = []
    lo, hi, _ = obj_bounds(a.lod0); size = hi - lo; ctr = (lo + hi) / 2
    helpers += setup_world()
    gp = bpy.data.meshes.new('_groundm'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=150)
    bm.to_mesh(gp); bm.free(); go = bpy.data.objects.new('_ground', gp); gp.materials.append(ground_mat(a.ground)); link_obj(go); helpers.append(go)
    azim = a.preview.get('azim', -62.0)
    ax, ay = math.radians(azim), math.radians(azim)
    right = np.array([-math.sin(ax), math.cos(ax), 0.0])   # camera right vector on the ground plane
    toward = np.array([math.cos(ax), math.sin(ax), 0.0])
    rad_xy = 0.5 * math.hypot(size[0], size[1])
    small = size[2] < 1.6 and rad_xy < 1.2
    if small:   # figure stands just behind/right so its legs give the scale next to small plants
        fpos = ctr * np.array([1, 1, 0]) + right * (rad_xy * 0.6 + 0.3) - toward * (rad_xy + 0.35)
    else:
        fpos = ctr * np.array([1, 1, 0]) + right * (rad_xy * 0.75 + 1.4) + toward * min(rad_xy * 0.4, 2.0)
    fpos[2] = 0.0
    for o in figure():
        o.location = Vector(fpos); link_obj(o); helpers.append(o)
    elev = a.preview.get('elev', 14.0 if a.kind == 'tree' else 24.0)
    R = 0.5 * float(np.linalg.norm(size)) + 0.6
    tgt = ctr.copy()
    if small:
        R = max(0.5 * float(np.linalg.norm(size)) * 1.25, 0.45) + 0.15; tgt[2] = size[2] * 0.5
        elev = a.preview.get('elev', 22.0)
    lens = 50; fov = 2 * math.atan(18 / lens)
    dist = a.preview.get("dist", R / math.sin(fov / 2) * 0.86)
    main_px = 320 if quick else (384 if a.kind == 'tree' else 448)
    setup_render(main_px, main_px, 12 if quick else 16)
    camera('_cam_main', tgt, elev, azim, dist, lens)
    pA = render_to(os.path.join(TMP, a.name + '_A.png'))
    for o in bpy.data.objects:
        if o.name.startswith('_cam'): helpers.append(o)
    if quick or a.kind != 'tree':
        px = load_px(pA)
    else:
        # RTS view: LOD0 at origin, a LOD1 copy to the right, orthographic from 55 deg at ~4-5 px/m (150-400 m camera)
        off = right * (max(size[0], size[1]) + 3.0)
        cp = []
        for o in a.lod1:
            c = bpy.data.objects.new('_l1copy', o.data); c.location = Vector(off); link_obj(c); cp.append(c)
        helpers += cp
        need = (max(size[0], size[1]) * 2 + 6.0)
        ppm = min(5.0, 64.0 / need); wpx, hpx = 64, 96
        setup_render(wpx, hpx, 16)
        tg = ctr + off / 2; tg[2] = size[2] * 0.4
        camera('_cam_rts', tg, 55, azim, 300, ortho=hpx / ppm)
        pB = render_to(os.path.join(TMP, a.name + '_B.png'))
        for c in cp: c.hide_render = True
        setup_render(128, 192, 16)
        camera('_cam_close', (0, 0, min(size[2] * 0.42, 7.0)), 4.0, azim + 20, 15.0, 24)
        pC = render_to(os.path.join(TMP, a.name + '_C.png'))
        A_, B_, C_ = load_px(pA), upscale(load_px(pB), 2), load_px(pC)
        px = np.ones((384, 512, 4), np.float32) * 0.08; px[..., 3] = 1
        px[:, :384] = A_; px[192:384, 384:512] = B_[:192, :128]; px[0:192, 384:512] = C_[:192, :128]
        px[191:193, 384:512, :3] = 0.08; px[:, 383:385, :3] = 0.08
        for o in bpy.data.objects:
            if o.name.startswith('_cam') and o not in helpers: helpers.append(o)
    out = os.path.join(DIRS['preview'], a.name + '.png') if not quick else os.path.join(TMP, a.name + '_quick.png')
    save_px(out, px)
    for o in helpers:
        try: bpy.data.objects.remove(o, do_unlink=True)
        except Exception: pass
    print('  preview %s (%.0fs)' % (out, time.time() - t0))
    return out

# ══════════════════════════════════════════════════════════════════════ save / bake / export / json
def make_collections(a):
    sc = bpy.context.scene
    for o in list(sc.collection.objects): sc.collection.objects.unlink(o)
    cols = {}
    for cname, objs in ((a.name, a.lod0), (a.name + '_lod1', a.lod1)):
        if not objs: continue
        col = bpy.data.collections.new(cname); sc.collection.children.link(col); cols[cname] = col
        for o in objs:
            for c in list(o.users_collection): c.objects.unlink(o)
            col.objects.link(o)
            o['asset'] = a.name
            if a.height_range: o['height_range_m'] = a.height_range
    return cols

def apply_smooth(objs, angle=50):
    for o in objs:
        me = o.data
        if o.name.endswith('_leaves') or o.get('flat') or o.data.get('smoothed'): continue
        me.shade_smooth()
        try: me.set_sharp_from_angle(angle=math.radians(angle))
        except Exception: pass

def write_json(a, tris0, lo, hi, tris1=None, lo1=None, hi1=None):
    size = hi - lo
    d = {'name': a.name, 'size_m': [round(float(x), 3) for x in size], 'min': [round(float(x), 3) for x in lo],
         'max': [round(float(x), 3) for x in hi], 'spec_m': a.spec, 'tris': int(tris0), 'excluded': [], 'notes': a.notes}
    if a.height_range:
        d['height_range_m'] = a.height_range; d['base_height_m'] = a.spec[2]
    if a.lod1:
        d['lod1'] = {'collection': a.name + '_lod1', 'tris': int(tris1), 'size_m': [round(float(x), 3) for x in hi1 - lo1],
                     'glb': 'glb/%s_lod1.glb' % a.name}
    d['below_ground_m'] = round(float(-lo[2]), 3) if lo[2] < 0 else 0.0
    d.update(a.extra)
    if a.spec:
        d['spec_error_pct'] = [round(100 * abs(float(size[i]) - a.spec[i]) / a.spec[i], 2) if a.spec[i] else None for i in range(3)]
    with open(os.path.join(DIRS['bounds'], a.name + '.json'), 'w') as f: json.dump(d, f, indent=1)
    return d

def smart_uv(objs, margin=0.004, angle=60):
    bpy.ops.object.select_all(action='DESELECT') if bpy.context.mode == 'OBJECT' else None
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

def bake_color(objs, img, samples=8):
    """Bake diffuse colour of every material on objs into img using the objects' current UVMap."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
    sc.render.bake.margin = 6; sc.render.bake.margin_type = 'EXTEND'
    for o in objs:
        for m in o.data.materials:
            t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img; m.node_tree.nodes.active = t
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=6)

def export_glb(path, objs, image_format='AUTO'):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format=image_format,
                              export_jpeg_quality=88, export_vertex_color='NONE', export_attributes=False, export_extras=True,
                              export_animations=False, export_cameras=False, export_lights=False)
    return path

def glb_vegetation(a):
    """Bake bark (if any) into the atlas' bark rect, then swap materials for glTF ones sharing that atlas."""
    at = a.atlas; img = at.image()
    if a.bake_objs:
        bimg = bpy.data.images.new(a.name + '_barkbake', at.rects['bark#px'][2], at.rects['bark#px'][3], alpha=False)
        bimg.colorspace_settings.name = 'sRGB'
        smart_uv(a.bake_objs, 0.006, 66)
        bake_color(a.bake_objs, bimg, 8)
        at.blit_image('bark', bimg); img = at.image()
        for o in a.bake_objs: remap_uv(o, at.rects['bark'])
    for m in list(bpy.data.materials):
        if m.name.startswith(a.name): m.name = m.name + '_src'
    leafm = gltf_mat(a.name + '_leaf', img, alpha_clip=True, rough=0.65)
    barkm = gltf_mat(a.name + '_bark', img, alpha_clip=False, rough=0.88)
    for o in a.lod0:
        for i, m in enumerate(o.data.materials):
            if m.get('atlas_leaf'): o.data.materials[i] = leafm
            elif m.get('bake'): o.data.materials[i] = barkm
    paths = [export_glb(os.path.join(DIRS['glb'], a.name + '.glb'), a.lod0)]
    if a.lod1:   # distant LOD gets a 512 px copy of the same atlas (same UV layout)
        px = at.px; half = (px[0::2, 0::2] + px[1::2, 0::2] + px[0::2, 1::2] + px[1::2, 1::2]) / 4
        i2 = bpy.data.images.new(a.name + '_atlas_512', at.size // 2, at.size // 2, alpha=True)
        i2.colorspace_settings.name = 'sRGB'; i2.alpha_mode = 'STRAIGHT'; i2.pixels.foreach_set(half.ravel()); i2.pack()
        leaf1 = gltf_mat(a.name + '_lod1_leaf', i2, alpha_clip=True, rough=0.65)
        bark1 = gltf_mat(a.name + '_lod1_bark', i2, alpha_clip=False, rough=0.88)
        for o in a.lod1:
            for i, m in enumerate(o.data.materials):
                if m.get('atlas_leaf'): o.data.materials[i] = leaf1
                elif m.get('bake'): o.data.materials[i] = bark1
        paths.append(export_glb(os.path.join(DIRS['glb'], a.name + '_lod1.glb'), a.lod1))
    return paths

def glb_baked(a, size=1024, samples=4):
    """Rocks / coral: smart-UV every object, bake all procedural colour into one 1024 atlas."""
    img = bpy.data.images.new(a.name + '_atlas', size, size, alpha=False); img.colorspace_settings.name = 'sRGB'
    objs = a.lod0
    smart_uv(objs, 0.004, 60)
    bake_color(objs, img, samples)
    img.pack()
    wet = a.glb_mats.get('wet')
    for m in list(bpy.data.materials):
        if m.name.startswith(a.name): m.name = m.name + '_src'
    base = gltf_mat(a.name + '_mat', img, rough=a.glb_mats.get('rough', 0.85))
    for o in objs:
        mats = list(o.data.materials)
        for i, m in enumerate(mats):
            o.data.materials[i] = base
        if wet:
            wm = gltf_mat(a.name + '_wet', img, rough=wet['rough'])
            o.data.materials.append(wm); wi = len(o.data.materials) - 1
            for p in o.data.polygons:
                if (o.matrix_world @ p.center).z < wet['z']: p.material_index = wi
    return [export_glb(os.path.join(DIRS['glb'], a.name + '.glb'), objs, 'JPEG')]

def run_asset(name, args):
    t0 = time.time(); reset_scene()
    a = REG[name][1](name)
    apply_smooth(a.lod0 + a.lod1)
    for o in a.lod0 + a.lod1:
        if 'flat' in o: del o['flat']
        if 'smoothed' in o.data: del o.data['smoothed']
        o.data.name = o.name
    if a.lod1:   # LOD1 occupies exactly the LOD0 box (no popping in size when switching)
        lo0, hi0, _ = obj_bounds(a.lod0); lo1, hi1, _ = obj_bounds(a.lod1)
        s = (hi0 - lo0) / np.maximum(hi1 - lo1, 1e-6)
        M = np.eye(4); M[:3, :3] = np.diag(s); M[:3, 3] = lo0 - lo1 * s
        transform_objs(a.lod1, M)
    cols = make_collections(a)
    lo, hi, tris0 = obj_bounds(a.lod0)
    lo1 = hi1 = None; tris1 = None
    if a.lod1: lo1, hi1, tris1 = obj_bounds(a.lod1)
    path = os.path.join(DIRS['blend'], name + '.blend')
    if args.glb_only:
        t1 = time.time(); (glb_vegetation if a.kind in ('tree', 'veg') else glb_baked)(a)
        print('  glb only %s (%.0fs)' % (name, time.time() - t1))
        return {'name': name, 'size_m': [round(float(x), 3) for x in hi - lo], 'spec_m': a.spec, 'tris': tris0,
                'lod1': {'tris': tris1} if a.lod1 else {}}
    if not args.quick:
        bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    info = write_json(a, tris0, lo, hi, tris1, lo1, hi1)
    print('%s: size %s tris %d%s  (%.0fs)' % (name, info['size_m'], tris0, (' lod1 %d' % tris1) if tris1 else '', time.time() - t0))
    if not args.no_preview:
        preview(a, args.quick)
    if args.glb and not args.quick:
        t1 = time.time()
        if a.kind in ('tree', 'veg'): glb_vegetation(a)
        else: glb_baked(a)
        print('  glb (%.0fs)' % (time.time() - t1))
    return info

def main():
    argv = sys.argv[1:]
    if '--' in argv: argv = argv[argv.index('--') + 1:]
    ap = argparse.ArgumentParser(description='Thunderhead nature asset generator')
    ap.add_argument('names', nargs='*', default=['all'])
    ap.add_argument('--glb', action='store_true'); ap.add_argument('--quick', action='store_true'); ap.add_argument('--no-preview', action='store_true')
    ap.add_argument('--glb-only', action='store_true', help='rebuild (deterministic) and only bake + export GLBs')
    ap.add_argument('--allow-rocks', action='store_true', help='rock_/coral_ assets are owned by the rock builder; build them anyway')
    args = ap.parse_args(argv)
    names = ([k for k in sorted(REG, key=lambda k: REG[k][0]) if k.startswith('veg_')]
             if (not args.names or args.names == ['all']) else args.names)
    if not args.allow_rocks:
        skip = [n for n in names if n.startswith(('rock_', 'coral_'))]
        if skip: print('skipping (owned by the rock builder; use --allow-rocks):', ', '.join(skip))
        names = [n for n in names if n not in skip]
    done, failed = [], []
    for n in names:
        if n not in REG: print('unknown asset', n, '- known:', ', '.join(sorted(REG))); continue
        try:
            done.append(run_asset(n, args))
        except Exception:
            import traceback; traceback.print_exc(); failed.append(n)
    print('\n%-24s %-22s %-22s %6s %5s' % ('asset', 'size_m', 'spec_m', 'tris', 'lod1'))
    for d in done:
        print('%-24s %-22s %-22s %6d %5s' % (d['name'], d['size_m'], d['spec_m'], d['tris'], d.get('lod1', {}).get('tris', '-')))
    if failed: print('FAILED:', ', '.join(failed)); sys.exit(1)

if __name__ == '__main__':
    main()
