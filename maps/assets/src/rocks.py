#!/usr/bin/env python3
"""Thunderhead maps - rock, cliff and coral generator.

Usage (headless Blender 4.5 as a Python module):
    /home/claude/blender-env/bin/python maps/assets/src/rocks.py [name ...|name,name|all] [--glb] [--quick] [--no-preview]

  name          rock_limestone_b, rock_coastal_wet, rock_cliff_limestone, rock_granite_a, rock_granite_slab,
                rock_scree_cluster, rock_cliff_granite, rock_basalt_a, rock_cliff_basalt, coral_cluster_a,
                coral_cluster_b, rock_copper_a  (or 'all', in that priority order)
  --glb         also bake the procedural material into a 1024 px atlas (+ tangent normal map, + roughness map for wet
                rock) and write glb/<name>.glb
  --quick       small iteration preview written to $ROCKS_TMP (does not touch maps/assets/preview)
  --no-preview  skip the Cycles preview
  --out DIR     write blend/glb/bounds/preview under DIR instead of maps/assets (staging)

'all' builds every asset except rock_limestone_a, whose original outputs belong to the nature builder; name it
explicitly (ideally with --out) to build the rebuilt version.

Outputs follow maps/ASSET_CONTRACT.md: blend/<name>.blend (one collection <name>), glb/<name>.glb, bounds/<name>.json,
preview/<name>.png (with a 1.8 m figure and a 1 m ground grid).  1 BU = 1 m, +X east, +Y north, +Z up.  Rocks and
coral: origin at the ground contact under the bounding-box centre, sunk 5-12 % of their height below z = 0.
Cliff chunks: 24 m (X) x 10 m (Y) x 12 m (Z), sea face toward -Y, base 1.5 m below z = 0, flat-ish top ~10.3-10.5 m;
the geometry is exactly periodic in X with a 24 m pitch, so instances placed side by side meet without a seam.

Geometry recipe (boulders): subdivided ico/cube -> low-frequency warp -> planar fracture cuts (bisect + fill) ->
bevel modifier on the hard fracture edges -> voxel remesh -> displacement along normals (layered Perlin fBm, ridged
noise, Voronoi cracks, bedding strata, karst pits) -> collapse-decimate to <= 2k tris.  Cliffs: dense swept profile
whose sea face is a field of bevelled, tilted planar blocks (beds x staggered joints) + strata, overhangs, noise and
Voronoi cracks, decimated to <= 6k tris with the two seam columns protected.  Basalt: explicit Voronoi columns.
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, json, time, argparse, tempfile
import bpy, bmesh
import numpy as np
from mathutils import Vector
from scipy.spatial import ConvexHull, Voronoi

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
DIRS = {k: os.path.join(ASSETS, k) for k in ('blend', 'glb', 'bounds', 'preview')}
for _d in DIRS.values(): os.makedirs(_d, exist_ok=True)
TMP = os.environ.get('ROCKS_TMP') or os.path.join(tempfile.gettempdir(), 'thunderhead_rocks')
os.makedirs(TMP, exist_ok=True)
THREADS = 2
PREVIEW_PX, PREVIEW_SAMPLES = 512, 16          # CPU budget agreed for this builder
BAKE_PX, BAKE_SAMPLES = 1024, 4
BOULDER_TRIS, CLIFF_TRIS = 1950, 5900


def nrm(v):
    v = np.asarray(v, float); n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0); return t * t * (3 - 2 * t)


def lin(c):
    """sRGB (picked by eye) -> linear for shader defaults."""
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


# ══════════════════════════════════════════════════════════════════ numpy noise (vectorised, periodic in X)
_M1, _M2, _M3 = np.uint64(0x9E3779B97F4A7C15), np.uint64(0xBF58476D1CE4E5B9), np.uint64(0x94D049BB133111EB)
_GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]], float)


def _mix64(h):
    h = (h ^ (h >> np.uint64(30))) * _M2
    h = (h ^ (h >> np.uint64(27))) * _M3
    return h ^ (h >> np.uint64(31))


def hash3(ix, iy, iz, seed=0):
    with np.errstate(over='ignore'):
        h = np.asarray(ix, np.int64).astype(np.uint64) * _M1 + np.uint64(seed * 2 + 1)
        h = _mix64(h ^ (np.asarray(iy, np.int64).astype(np.uint64) * _M2))
        h = _mix64(h ^ (np.asarray(iz, np.int64).astype(np.uint64) * _M3))
    return h


def u01(h, k=0):
    with np.errstate(over='ignore'):
        x = _mix64(h + np.uint64(k + 1) * _M1)
    return (x >> np.uint64(11)).astype(np.float64) * (1.0 / 9007199254740992.0)


def perlin(P, seed=0, per=None):
    """3-D gradient noise in ~[-1, 1].  per: lattice period along x (integer) for tileable noise."""
    P = np.asarray(P, float); i0 = np.floor(P).astype(np.int64); f = P - i0
    u = f * f * f * (f * (f * 6 - 15) + 10); out = np.zeros(len(P))
    for dx in (0, 1):
        ix = i0[:, 0] + dx
        if per: ix = np.mod(ix, per)
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                g = _GRAD[(hash3(ix, i0[:, 1] + dy, i0[:, 2] + dz, seed) & np.uint64(15)).astype(np.int64)]
                out += wx * wy * wz * ((f[:, 0] - dx) * g[:, 0] + (f[:, 1] - dy) * g[:, 1] + (f[:, 2] - dz) * g[:, 2])
    return out


def fbm(P, scale, octaves=4, gain=0.5, seed=0, period=None, ridged=False):
    """Fractal noise ~[-1, 1].  period (metres, along x) makes it exactly tileable."""
    P = np.asarray(P, float); tot = np.zeros(len(P)); amp, norm = 1.0, 0.0
    for o in range(octaves):
        s = scale * 2.0 ** o; sv = np.array([s, s, s]); per = None
        if period:
            per = max(1, int(round(period * s))); sv[0] = per / period
        n = perlin(P * sv + np.array([0.0, 31.7, 17.3]) * (o + 1), seed + 101 * o, per)
        if ridged: n = 1.0 - 2.0 * np.abs(n)
        tot += amp * n; norm += amp; amp *= gain
    return tot / norm


_OFF3 = np.array([(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)])
_OFF2 = np.array([(a, b, 0) for a in (-1, 0, 1) for b in (-1, 0, 1)])


def voronoi(P, scale, seed=0, jitter=0.9, period=None, aniso=(1.0, 1.0, 1.0), flat=False):
    """Jittered-grid Voronoi.  Returns (F1 distance m, distance to the nearest cell border m, cell hash)."""
    sv = np.array(aniso, float) * scale; per = None
    if period:
        per = max(1, int(round(period * sv[0]))); sv[0] = per / period
    Q = np.asarray(P, float) * sv
    if flat: Q = Q.copy(); Q[:, 2] = 0.0
    c = np.floor(Q).astype(np.int64); n = len(Q)
    d1 = np.full(n, np.inf); d2 = np.full(n, np.inf); p1 = np.zeros((n, 3)); p2 = np.zeros((n, 3)); h1 = np.zeros(n, np.uint64)
    for off in (_OFF2 if flat else _OFF3):
        cc = c + off; cx = np.mod(cc[:, 0], per) if per else cc[:, 0]
        h = hash3(cx, cc[:, 1], cc[:, 2], seed)
        fp = cc + 0.5 + jitter * (np.stack([u01(h, 1), u01(h, 2), u01(h, 3)], 1) - 0.5)
        if flat: fp[:, 2] = 0.0
        d = np.linalg.norm(Q - fp, axis=1)
        m1 = d < d1; m2 = (~m1) & (d < d2)
        d2 = np.where(m1, d1, np.where(m2, d, d2)); p2 = np.where(m1[:, None], p1, np.where(m2[:, None], fp, p2))
        d1 = np.where(m1, d, d1); p1 = np.where(m1[:, None], fp, p1); h1 = np.where(m1, h, h1)
    nv = p2 - p1; edge = np.einsum('ij,ij->i', (p1 + p2) / 2 - Q, nv) / (np.linalg.norm(nv, axis=1) + 1e-9)
    s = float(np.exp(np.log(sv).mean()))
    return d1 / s, np.abs(edge) / s, h1


# ══════════════════════════════════════════════════════════════════ mesh helpers
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for x in list(coll):
            try: coll.remove(x)
            except Exception: pass


def link_obj(o):
    bpy.context.scene.collection.objects.link(o); return o


def bm_obj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return link_obj(bpy.data.objects.new(name, me))


def get_co(o):
    a = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('co', a); return a.reshape(-1, 3)


def set_co(o, P):
    o.data.vertices.foreach_set('co', np.asarray(P, float).ravel()); o.data.update()


def get_nrm(o):
    o.data.update(); a = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('normal', a); return a.reshape(-1, 3)


def tri_count(o):
    lt = np.empty(len(o.data.polygons), np.int32); o.data.polygons.foreach_get('loop_total', lt); return int((lt - 2).sum())


def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data; o.modifiers.clear(); o.data = me; bpy.data.meshes.remove(old); return o


def mod_bevel(o, width, segs=2, angle=28):
    m = o.modifiers.new('bev', 'BEVEL'); m.width = width; m.segments = segs; m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle); m.use_clamp_overlap = True; m.profile = 0.5
    return apply_mods(o)


def mod_remesh(o, voxel):
    m = o.modifiers.new('rm', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = voxel; m.adaptivity = 0.0
    return apply_mods(o)


def smooth_mesh(o, iters=1, fac=0.4):
    bm = bmesh.new(); bm.from_mesh(o.data)
    for _ in range(iters): bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=fac, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(o.data); bm.free(); o.data.update()


def decimate(o, target):
    for _ in range(3):
        n = tri_count(o)
        if n <= target: break
        m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = target / n * (0.99 if _ else 1.0)
        m.use_collapse_triangulate = True; apply_mods(o)
    return o


def select_only(objs, active=None):
    bpy.context.view_layer.update()
    for ob in list(bpy.context.view_layer.objects):
        if ob is not None: ob.select_set(False)
    for ob in objs: ob.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def decimate_protected(o, target, protect):
    """Collapse-decimate everything except faces touching vertices where protect(co) is True (tile seams)."""
    select_only([o]); bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(o.data); keep = 0
    for f in bm.faces:
        p = any(protect(v.co) for v in f.verts); f.select_set(not p)
        if p: keep += len(f.verts) - 2
    bmesh.update_edit_mesh(o.data)
    tot = sum(len(f.verts) - 2 for f in bm.faces)
    ratio = max(0.02, min(1.0, (target - keep) / max(1, tot - keep)))
    bpy.ops.mesh.decimate(ratio=ratio)
    bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.quads_convert_to_tris(quad_method='BEAUTY', ngon_method='BEAUTY')
    bpy.ops.object.mode_set(mode='OBJECT')
    return o


def plane_cut(bm, co, no):
    """Remove everything on the +no side of the plane and cap the hole with a flat fracture face."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector(co), plane_no=Vector(no), clear_outer=True)
    bnd = [e for e in bm.edges if e.is_boundary]
    if bnd: bmesh.ops.holes_fill(bm, edges=bnd, sides=0)


def plane_cut_frac(bm, n, frac):
    """Cut at frac of the support distance from the centroid along n (frac 1 = touches the extreme point)."""
    co = np.array([v.co[:] for v in bm.verts]); c = co.mean(0); n = nrm(n)
    d = frac * ((co - c) @ n).max(); plane_cut(bm, c + n * d, n)


def rand_cuts(rng, n, frac=(0.6, 0.85), side=0.0, up=0.0, down_ok=False):
    out = []
    for _ in range(n):
        v = rng.normal(size=3)
        if rng.uniform() < side: v[2] *= 0.18                  # near-vertical joint faces
        elif rng.uniform() < up: v[2] = abs(v[2]) + 0.8        # top fractures
        if not down_ok and v[2] < -0.25: v[2] = -v[2] * 0.4     # bottoms are buried anyway
        out.append((nrm(v), rng.uniform(*frac)))
    return out


# ══════════════════════════════════════════════════════════════════ displacement terms (metres, + = outward)
def strata_term(P, N, sp, depth, tilt=(0.0, 0.0), wob=0.08, soft=0.35, groove=0.5, seed=0):
    zt = P[:, 2] + tilt[0] * P[:, 0] + tilt[1] * P[:, 1] + wob * fbm(P, 0.4, 2, seed=seed)
    bn = nrm([tilt[0], tilt[1], 1.0]); steep = 1.0 - np.abs(N @ bn) ** 2
    k = np.floor(zt / sp); t = zt / sp - k; hk = u01(hash3(k.astype(np.int64), 0, 0, seed))
    r_bed = depth * np.where(hk < soft, 1.0, 0.25 * hk)
    g = groove * depth * (1.0 - smoothstep(0.0, 0.14, np.minimum(t, 1 - t)))
    return (r_bed * np.sin(np.pi * t) ** 0.6 + g) * steep


def crack_term(P, scale, width, depth, cover=0.6, aniso=(1, 1, 1), seed=0, period=None):
    _, e, _ = voronoi(P, scale, seed, 0.9, period=period, aniso=aniso)
    keep = smoothstep(1.0 - cover - 0.12, 1.0 - cover + 0.12, 0.5 + 0.5 * fbm(P, scale * 0.6, 2, seed=seed + 3, period=period))
    return depth * (1.0 - smoothstep(0.0, width, e)) ** 1.5 * keep


def pit_term(P, N, scale, radius, depth, up=0.55, seed=0):
    f1, _, h = voronoi(P, scale, seed, 0.95)
    m = 1.0 - smoothstep(radius * 0.25, radius, f1)
    return depth * m * smoothstep(up - 0.2, up + 0.2, N[:, 2]) * (u01(h, 7) < 0.65)


def rock_disp(P, N, s, seed=0):
    D = np.zeros(len(P))
    for i, (sc, amp, octv) in enumerate(s.get('fbm', [])): D += amp * fbm(P, sc, octv, seed=seed + 11 * i)
    if 'ridge' in s:
        sc, amp = s['ridge']; D += amp * fbm(P, sc, 3, seed=seed + 7, ridged=True)
    if 'zfade' in s:     # wave-polished lower part: noise fades out below z1
        z0, z1, f = s['zfade']; D *= f + (1 - f) * smoothstep(z0, z1, P[:, 2])
    if 'strata' in s: D -= strata_term(P, N, seed=seed + 23, **s['strata'])
    if 'crack' in s: D -= crack_term(P, seed=seed + 29, **s['crack'])
    if 'crack2' in s: D -= crack_term(P, seed=seed + 31, **s['crack2'])
    if 'pits' in s: D -= pit_term(P, N, seed=seed + 37, **s['pits'])
    return D


def boulder(name, rng, size, *, base='ico', round_=0.5, warp=0.15, warp_scale=0.5, pre=None, cuts=(), bevel=0.06,
            bevel_angle=28, voxel=0.045, disp=None, target=BOULDER_TRIS, seed=0, smooth=1):
    """Subdivided base -> warp -> planar fracture cuts -> bevel -> voxel remesh -> displacement -> decimate."""
    bm = bmesh.new()
    if base == 'ico':
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    else:
        bmesh.ops.create_cube(bm, size=2.0); bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=9, use_grid_fill=True)
    P = np.array([v.co[:] for v in bm.verts])
    if base != 'ico' and round_: P = P * (1 - round_) + P / np.linalg.norm(P, axis=1)[:, None] * round_ * np.sqrt(3) ** 0.5
    P = P / np.abs(P).max(0) * (np.array(size) / 2)
    dirs = P / np.linalg.norm(P, axis=1)[:, None]
    P += dirs * (warp * min(size) / 2 * fbm(P, warp_scale, 3, seed=seed + 1))[:, None]
    if pre: P = pre(P)
    for v, p in zip(bm.verts, P): v.co = p
    for n, frac in cuts: plane_cut_frac(bm, n, frac)
    o = bm_obj(name, bm)
    if bevel: mod_bevel(o, bevel, 2, bevel_angle)
    mod_remesh(o, voxel)
    if disp:
        P = get_co(o); N = get_nrm(o); set_co(o, P + N * rock_disp(P, N, disp, seed)[:, None])
    if smooth: smooth_mesh(o, smooth, 0.2)
    return decimate(o, target)


# ══════════════════════════════════════════════════════════════════ shader graph builder
def _set(nt, sock, val):
    if val is None: return
    if isinstance(val, bpy.types.NodeSocket): nt.links.new(val, sock); return
    dv = sock.default_value
    if hasattr(dv, '__len__'):
        if isinstance(val, (int, float)): val = (val,) * len(dv)
        elif len(val) == 3 and len(dv) == 4: val = (*val, 1.0)
    sock.default_value = val


class G:
    def __init__(self, mat):
        mat.use_nodes = True; self.nt = mat.node_tree; self.N = self.nt.nodes
        for n in list(self.N):
            if n.bl_idname != 'ShaderNodeOutputMaterial': self.N.remove(n)
        self.out = [n for n in self.N if n.bl_idname == 'ShaderNodeOutputMaterial'][0]

    def node(self, t, **kw):
        n = self.N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n

    def math(self, op, a, b=None):
        n = self.node('ShaderNodeMath', operation=op); _set(self.nt, n.inputs[0], a)
        if b is not None: _set(self.nt, n.inputs[1], b)
        return n.outputs[0]

    def mul(self, *xs):
        r = xs[0]
        for x in xs[1:]: r = self.math('MULTIPLY', r, x)
        return r

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        _set(self.nt, n.inputs[0], fac); _set(self.nt, n.inputs[6], a); _set(self.nt, n.inputs[7], b); return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.node('ShaderNodeMix', data_type='FLOAT'); _set(self.nt, n.inputs[0], fac); _set(self.nt, n.inputs[2], a)
        _set(self.nt, n.inputs[3], b); return n.outputs[0]

    def mr(self, v, a, b, c=0.0, d=1.0):
        n = self.node('ShaderNodeMapRange', clamp=True); _set(self.nt, n.inputs['Value'], v)
        for k, x in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)): _set(self.nt, n.inputs[k], x)
        return n.outputs['Result']

    def noise(self, vec, scale, detail=4.0, rough=0.55, out='Fac'):
        n = self.node('ShaderNodeTexNoise'); _set(self.nt, n.inputs['Vector'], vec)
        for k, x in (('Scale', scale), ('Detail', detail), ('Roughness', rough)): _set(self.nt, n.inputs[k], x)
        return n.outputs[out]

    def voronoi(self, vec, scale, feature='F1', out='Distance', rnd=1.0):
        n = self.node('ShaderNodeTexVoronoi', feature=feature); _set(self.nt, n.inputs['Vector'], vec)
        _set(self.nt, n.inputs['Scale'], scale); _set(self.nt, n.inputs['Randomness'], rnd); return n.outputs[out]

    def white1(self, w):
        n = self.node('ShaderNodeTexWhiteNoise', noise_dimensions='1D'); _set(self.nt, n.inputs['W'], w); return n.outputs['Value']

    def xyz(self, vec):
        n = self.node('ShaderNodeSeparateXYZ'); _set(self.nt, n.inputs[0], vec); return n.outputs

    def vmath(self, op, a, b=None):
        n = self.node('ShaderNodeVectorMath', operation=op); _set(self.nt, n.inputs[0], a)
        if b is not None: _set(self.nt, n.inputs[1], b)
        return n.outputs[1] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs[0]

    def coord(self):
        return self.node('ShaderNodeTexCoord').outputs['Object']

    def geo(self, kind):
        if not hasattr(self, '_geo'): self._geo = self.node('ShaderNodeNewGeometry')
        return self._geo.outputs[kind]

    def attr(self, name):
        return self.node('ShaderNodeAttribute', attribute_name=name).outputs['Fac']

    def ao(self, dist, samples=8):
        n = self.node('ShaderNodeAmbientOcclusion', samples=samples, only_local=True); n.inputs['Distance'].default_value = dist
        return n.outputs['AO']

    def bump(self, h, strength, dist):
        n = self.node('ShaderNodeBump'); _set(self.nt, n.inputs['Height'], h); _set(self.nt, n.inputs['Strength'], strength)
        _set(self.nt, n.inputs['Distance'], dist); return n.outputs['Normal']

    def bsdf(self, col, rough, normal=None, spec=0.45):
        n = self.node('ShaderNodeBsdfPrincipled'); _set(self.nt, n.inputs['Base Color'], col); _set(self.nt, n.inputs['Roughness'], rough)
        _set(self.nt, n.inputs['Specular IOR Level'], spec); _set(self.nt, n.inputs['Normal'], normal); return n.outputs[0]

    def output(self, sh):
        self.nt.links.new(sh, self.out.inputs['Surface'])


# ══════════════════════════════════════════════════════════════════ materials
def rock_mat(name, H, pal, **o):
    """Layered procedural rock.  pal: sRGB a/b (base pair), dark, optional light.  Options (all optional):
    scale, mottle, facet, strata=(amt, spacing_m, (tilt_x, tilt_y)), streak, crack, crack_scale, speckle={...},
    veins={...}, stain={...}, vesicles, striation={...}, ao, ao_dist, edge, lichen, lichen_col, lichen2, lichen2_col,
    moss, moss_col, dust, dust_col, dust_h, wet={'z', 'rough'}, rough, bump, band={'z', 'h', 'col'}"""
    a, b, dk = lin(pal['a']), lin(pal['b']), lin(pal['dark'])
    lt = lin(pal.get('light', tuple(min(1.0, c * 1.18) for c in pal['b'])))
    s = o.get('scale', 1.0)
    m = bpy.data.materials.new(name); g = G(m); m['bake'] = True; m['rough'] = o.get('rough', 0.85)
    co = g.coord(); X = g.xyz(co); z = X[2]; nz = g.xyz(g.geo('Normal'))[2]
    wv = g.noise(co, 0.35 * s, 2, 0.5, out='Color')
    cw = g.vmath('ADD', co, g.vmath('MULTIPLY', g.vmath('SUBTRACT', wv, (0.5, 0.5, 0.5)), (0.7 / s,) * 3))
    nM = g.noise(cw, 0.2 * s, 3, 0.5); nm = g.noise(cw, 1.2 * s, 5, 0.6); nf = g.noise(co, 7.0 * s, 4, 0.62)
    col = g.mix(g.mr(nM, 0.3, 0.7), a, b)
    col = g.mix(g.mr(nm, 0.42, 0.75, 0.0, o.get('mottle', 0.5)), col, g.mix(0.55, a, dk))
    fv = g.xyz(g.voronoi(cw, 0.7 * s, 'F1', 'Color'))[0]                       # fracture-face tint
    col = g.mix(o.get('facet', 0.6), col, g.mr(fv, 0.0, 1.0, 0.84, 1.12), 'MULTIPLY')
    col = g.mix(1.0, col, g.mr(nf, 0.3, 0.7, 0.86, 1.1), 'MULTIPLY')
    h = g.math('ADD', g.mul(nm, 0.6), g.mul(nf, 0.4))
    if o.get('strata'):
        amt, sp, tilt = o['strata']
        zt = g.math('ADD', z, g.math('ADD', g.mul(X[0], tilt[0]), g.mul(X[1], tilt[1])))
        zt = g.math('ADD', zt, g.mul(g.math('SUBTRACT', nm, 0.5), sp * 0.45))
        u = g.math('DIVIDE', zt, sp); bed = g.math('FLOOR', u); t = g.math('FRACT', u)
        col = g.mix(amt, col, g.mr(g.white1(bed), 0.0, 1.0, 0.8, 1.14), 'MULTIPLY')
        lam = g.mr(g.math('SINE', g.mul(u, 2 * math.pi * 5.0)), 0.3, 1.0)
        col = g.mix(g.mul(lam, amt * 0.25), col, lt)
        part = g.mul(g.mr(g.math('MINIMUM', t, g.math('SUBTRACT', 1.0, t)), 0.0, 0.05, 1.0, 0.0),
                     g.mr(g.noise(co, 1.1 * s, 3, 0.6), 0.38, 0.6))
        col = g.mix(g.mul(part, amt * 0.75), col, g.mix(0.35, dk, (0, 0, 0)))
        h = g.math('SUBTRACT', h, g.mul(part, 0.5))
    if o.get('streak', 0) > 0:
        sv = g.noise(g.vmath('MULTIPLY', co, (4.0 * s, 4.0 * s, 0.3 * s)), 1.0, 3, 0.5)
        steep = g.mr(g.math('ABSOLUTE', nz), 0.8, 0.25)
        col = g.mix(g.mul(g.mr(sv, 0.52, 0.72), steep, o['streak']), col, g.mix(0.6, col, dk))
    if o.get('crack', 0) > 0:
        cv = g.voronoi(cw, o.get('crack_scale', 1.3) * s, 'DISTANCE_TO_EDGE')
        cw2 = g.mr(g.noise(co, 2.5 * s, 3, 0.6), 0.3, 0.7, 0.008, 0.03)
        cl = g.mul(g.mr(g.math('DIVIDE', cv, cw2), 0.0, 1.0, 1.0, 0.0), g.mr(g.noise(co, 0.6 * s, 3, 0.55), 0.5, 0.62))
        col = g.mix(g.mul(cl, o['crack']), col, g.mix(0.5, dk, (0, 0, 0)))
        h = g.math('SUBTRACT', h, g.mul(cl, 0.7))
    sp_ = o.get('speckle')
    if sp_:
        vc = g.xyz(g.voronoi(co, sp_.get('scale', 45.0), 'F1', 'Color'))[0]
        col = g.mix(g.mul(g.math('LESS_THAN', vc, sp_.get('black', 0.13)), 0.85), col, lin((0.07, 0.07, 0.07)))
        col = g.mix(g.mul(g.math('GREATER_THAN', vc, 1 - sp_.get('white', 0.2)), 0.5), col, lin((0.80, 0.79, 0.76)))
        pk = g.mul(g.math('GREATER_THAN', vc, 0.45), g.math('LESS_THAN', vc, 0.45 + sp_.get('pink', 0.15)))
        col = g.mix(g.mul(pk, 0.5), col, lin(sp_.get('pink_col', (0.70, 0.56, 0.50))))
        vc2 = g.xyz(g.voronoi(co, sp_.get('scale', 45.0) * 2.4, 'F1', 'Color'))[1]
        col = g.mix(g.mul(g.math('LESS_THAN', vc2, 0.08), 0.7), col, lin((0.06, 0.06, 0.06)))
    vn_ = o.get('veins')
    if vn_:
        vs = vn_.get('scale', 0.9) * s
        v1 = g.noise(g.vmath('MULTIPLY', cw, (1.0, 1.0, 2.3)), vs, 3, 0.5)
        l1 = g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', v1, 0.5)), 0.0, vn_.get('width', 0.03), 1.0, 0.0)
        v2 = g.noise(g.vmath('MULTIPLY', cw, (2.0, 1.0, 1.0)), vs * 2.3, 2, 0.5)
        l2 = g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', v2, 0.5)), 0.0, vn_.get('width', 0.03) * 0.6, 0.8, 0.0)
        vm = g.math('MAXIMUM', l1, l2)
        cv2 = g.voronoi(cw, o.get('crack_scale', 1.3) * s, 'DISTANCE_TO_EDGE')
        vm = g.math('MAXIMUM', vm, g.mr(cv2, 0.0, vn_.get('halo', 0.09), 0.9, 0.0))       # halo along cracks
        pa = vn_.get('patch', (0.36, 0.56))
        vm = g.mul(vm, g.mr(g.noise(co, 0.45 * s, 3, 0.5), pa[0], pa[1]), vn_.get('amt', 0.8))
        vcol = g.mix(g.mr(g.noise(co, 9.0, 3, 0.6), 0.3, 0.7), lin(vn_.get('dark', (0.10, 0.34, 0.22))), lin(vn_.get('light', (0.36, 0.62, 0.44))))
        col = g.mix(vm, col, vcol)
        az = g.mul(g.mr(g.noise(co, 2.6 * s, 4, 0.6), 0.66, 0.71), vm)
        col = g.mix(az, col, lin(vn_.get('azurite', (0.17, 0.30, 0.55))))
        h = g.math('ADD', h, g.mul(vm, 0.15))
    st_ = o.get('stain')
    if st_:
        sm = g.mr(g.noise(cw, st_.get('scale', 1.0) * s, 4, 0.6), st_.get('lo', 0.55), st_.get('hi', 0.68), 0.0, st_.get('amt', 0.6))
        col = g.mix(sm, col, lin(st_['col']))
    if o.get('vesicles', 0) > 0:
        vv = g.voronoi(co, 16.0, 'F1')
        ves = g.mul(g.mr(vv, 0.16, 0.05), g.mr(g.noise(co, 1.5, 2, 0.5), 0.45, 0.6))
        col = g.mix(g.mul(ves, o['vesicles']), col, g.mix(0.5, dk, (0, 0, 0)))
        h = g.math('SUBTRACT', h, g.mul(ves, 0.5))
    bd_ = o.get('band')       # palaeosol / bole layer in basalt
    if bd_:
        bm_ = g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ADD', z, g.mul(g.math('SUBTRACT', nM, 0.5), 0.8)), bd_['z'])), bd_['h'] * 0.6, bd_['h'])
        col = g.mix(g.mul(g.math('SUBTRACT', 1.0, bm_), bd_.get('amt', 0.75)), col, g.mix(g.mr(nm, 0.3, 0.7), lin(bd_['col']), lin(bd_.get('col2', bd_['col']))))
    sr_ = o.get('striation')
    if sr_:
        sv2 = g.noise(g.vmath('MULTIPLY', co, sr_.get('stretch', (0.25, 14.0, 14.0))), 1.0, 2, 0.5)
        sl = g.mul(g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', sv2, 0.5)), 0.0, 0.035, 1.0, 0.0), g.mr(nz, 0.5, 0.85))
        col = g.mix(g.mul(sl, sr_.get('amt', 0.35)), col, lt)
        h = g.math('SUBTRACT', h, g.mul(sl, 0.25))
    # crevices: AO (object only) + pointiness
    ao = g.ao(o.get('ao_dist', max(0.25, H * 0.12)))
    col = g.mix(g.mul(g.mr(ao, 1.0, 0.25), o.get('ao', 0.65)), col, g.mix(0.6, dk, (0, 0, 0)))
    pt = g.geo('Pointiness')
    col = g.mix(g.mul(g.mr(pt, 0.5, 0.42), 0.35), col, g.mix(0.5, dk, (0, 0, 0)))
    col = g.mix(g.mul(g.mr(pt, 0.52, 0.6), o.get('edge', 0.3)), col, lt)
    rough = g.math('ADD', o.get('rough', 0.85), g.mul(g.math('SUBTRACT', nf, 0.5), 0.12))
    if o.get('lichen', 0) > 0:
        up = g.mr(nz, -0.15, 0.6)
        lp = g.noise(co, 2.1 * s, 5, 0.65)
        lm = g.mul(g.mr(lp, 0.55, 0.61), up, o['lichen'])
        lc = lin(o.get('lichen_col', (0.72, 0.74, 0.62)))
        col = g.mix(lm, col, g.mix(g.mr(nf, 0.3, 0.7), lc, tuple(min(1, c * 1.15) for c in lc)))
        dots = g.mul(g.math('LESS_THAN', g.voronoi(co, 7.0 * s, 'F1'), 0.22), g.mr(lp, 0.45, 0.55), up, o['lichen'] * 0.7)
        col = g.mix(dots, col, lc)
        if o.get('lichen2', 0) > 0:
            lp2 = g.noise(g.vmath('ADD', co, (7.1, 3.3, 1.7)), 3.2 * s, 4, 0.6)
            l2 = g.mul(g.mr(lp2, 0.62, 0.66), g.mr(nz, 0.0, 0.7), o['lichen2'])
            col = g.mix(l2, col, lin(o.get('lichen2_col', (0.80, 0.50, 0.18))))
    if o.get('moss', 0) > 0:
        mm = g.mul(g.mr(nz, 0.5, 0.85), g.mr(g.noise(co, 0.8 * s, 5, 0.6), 0.44, 0.58), o['moss'])
        mc = lin(o.get('moss_col', (0.28, 0.34, 0.13)))
        col = g.mix(mm, col, g.mix(g.mr(nf, 0.3, 0.7), mc, tuple(c * 1.35 for c in mc)))
        rough = g.mixf(mm, rough, 0.95)
    if o.get('dust', 0) > 0:
        dh = o.get('dust_h', max(0.25, H * 0.12))
        dz = g.math('ADD', z, g.mul(g.math('SUBTRACT', nm, 0.5), dh * 1.2))
        dm = g.mul(g.mr(dz, dh, 0.0), o['dust'])
        col = g.mix(dm, col, lin(o.get('dust_col', (0.44, 0.39, 0.31))))
        col = g.mix(g.mul(g.mr(nz, 0.8, 0.98), g.mr(nm, 0.5, 0.7), o['dust'] * 0.25), col, lin(o.get('dust_col', (0.44, 0.39, 0.31))))
    wet = o.get('wet')
    if wet:
        wz = wet['z']; zz = g.math('ADD', z, g.mul(g.math('SUBTRACT', g.noise(co, 0.9, 3, 0.5), 0.5), 0.45))
        wm = g.mr(zz, wz + 0.05, wz - 0.1)                                      # 1 below the spray line
        wc = g.mix(1.0, col, (0.40, 0.40, 0.38), 'MULTIPLY')
        tide = g.mr(g.math('ABSOLUTE', g.math('SUBTRACT', zz, wz + 0.12)), 0.3, 0.05)   # black Verrucaria band
        col = g.mix(g.mul(tide, 0.7), col, lin((0.06, 0.06, 0.06)))
        alg = g.mul(g.mr(zz, wz * 0.55, 0.05), g.mr(g.noise(co, 1.6, 4, 0.6), 0.35, 0.55))
        wc = g.mix(alg, wc, g.mix(g.mr(nf, 0.3, 0.7), lin((0.07, 0.10, 0.05)), lin((0.16, 0.20, 0.08))))
        bz = g.mul(g.mr(zz, -0.1, 0.25), g.mr(zz, wz * 0.85, wz * 0.45))
        bf = g.voronoi(co, 24.0, 'F1')
        bar = g.mul(g.math('LESS_THAN', bf, 0.3), g.mr(g.noise(co, 2.2, 3, 0.6), 0.4, 0.55), bz)
        wc = g.mix(bar, wc, g.mix(g.mr(bf, 0.05, 0.25), lin((0.30, 0.29, 0.26)), lin((0.66, 0.64, 0.58))))
        col = g.mix(wm, col, wc)
        rough = g.mixf(wm, rough, wet.get('rough', 0.1)); rough = g.mixf(bar, rough, 0.7)
        h = g.math('ADD', h, g.mul(bar, 0.6))
    bmp = g.bump(h, o.get('bump', 0.35), o.get('bump_dist', 0.04))
    g.output(g.bsdf(col, rough, bmp))
    return m


def coral_mat(name, H, body, body2, tip, dark, *, polyp=38.0, groove=None, rough=0.72, tip_attr='tip', hue_attr=None,
              palette=None, sediment=0.45):
    """Coral: muted body colour (optionally per-colony palette via attribute), paler/rosier tips, polyp pits,
    optional brain-coral meander grooves, AO-dark crevices, sediment at the base."""
    m = bpy.data.materials.new(name); g = G(m); m['bake'] = True; m['rough'] = rough
    co = g.coord(); z = g.xyz(co)[2]
    nm = g.noise(co, 2.5, 4, 0.6); nf = g.noise(co, 11.0, 3, 0.6)
    col = g.mix(g.mr(nm, 0.3, 0.7), lin(body), lin(body2))
    if hue_attr and palette:
        hu = g.attr(hue_attr); pc = lin(palette[0])
        for i, c in enumerate(palette[1:], 1):
            w = g.mr(hu, (i - 0.5) / len(palette), (i - 0.1) / len(palette))
            pc = g.mix(w, pc, lin(c))
        col = g.mix(0.75, col, g.mix(g.mr(nm, 0.3, 0.7), pc, g.mix(1.0, pc, (1.12, 1.1, 1.06), 'MULTIPLY')))
    if tip_attr:
        col = g.mix(g.mr(g.attr(tip_attr), 0.45, 1.0), col, lin(tip))
    col = g.mix(1.0, col, g.mr(nf, 0.3, 0.7, 0.88, 1.08), 'MULTIPLY')
    pv = g.voronoi(co, polyp, 'F1')
    pit = g.mr(pv, 0.28, 0.0)
    col = g.mix(g.mul(pit, 0.45), col, lin(dark))
    h = g.math('SUBTRACT', g.mul(nm, 0.3), g.mul(pit, 0.5))
    if groove:
        wn = g.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', wave_profile='SIN')
        _set(g.nt, wn.inputs['Vector'], co); _set(g.nt, wn.inputs['Scale'], groove['scale'])
        _set(g.nt, wn.inputs['Distortion'], groove.get('distort', 14.0)); _set(g.nt, wn.inputs['Detail'], 2.0)
        _set(g.nt, wn.inputs['Detail Scale'], 0.6)
        ridge = g.mul(wn.outputs['Fac'], 0.5)
        val = g.mr(ridge, 0.0, groove.get('width', 0.05), 1.0, 0.0)
        crest = g.mr(ridge, groove.get('width', 0.05) * 1.6, groove.get('width', 0.05) * 3.2)
        col = g.mix(g.mul(val, 0.85), col, lin(groove.get('col', dark)))
        col = g.mix(g.mul(crest, 0.35), col, lin(groove.get('crest', tip)))
        h = g.math('SUBTRACT', h, g.mul(val, 1.2))
    ao = g.ao(max(0.12, H * 0.12))
    col = g.mix(g.mul(g.mr(ao, 1.0, 0.3), 0.7), col, g.mix(0.5, lin(dark), (0, 0, 0)))
    sd = g.mul(g.mr(g.math('ADD', z, g.mul(g.math('SUBTRACT', nm, 0.5), 0.12)), 0.14, 0.0), sediment)
    col = g.mix(sd, col, lin((0.70, 0.66, 0.55)))
    bmp = g.bump(h, 0.45 if groove else 0.3, 0.02)
    g.output(g.bsdf(col, g.math('ADD', rough, g.mul(g.math('SUBTRACT', nf, 0.5), 0.1)), bmp, 0.4))
    return m


# ══════════════════════════════════════════════════════════════════ asset registry / common output
REG = {}
NOT_IN_ALL = {'rock_limestone_a'}      # original outputs owned by the nature builder; build only when named


def asset(name, order):
    def deco(fn):
        REG[name] = (order, fn); return fn
    return deco


class Asset:
    def __init__(self, name, objs, spec, *, kind='rock', notes='', extra=None, ground='grass', sink=0.0, smooth=40,
                 wet_rough=False, rough=0.85, preview=None):
        self.name, self.objs, self.spec, self.kind, self.notes = name, objs, list(spec), kind, notes
        self.extra = extra or {}; self.ground = ground; self.sink = sink; self.smooth = smooth
        self.wet_rough = wet_rough; self.rough = rough; self.preview = preview or {}


def obj_bounds(objs):
    lo = np.full(3, np.inf); hi = np.full(3, -np.inf); tris = 0
    for o in objs:
        if o.type != 'MESH' or o.get('exclude_bounds'): continue
        P = get_co(o); M = np.array(o.matrix_world); P = P @ M[:3, :3].T + M[:3, 3]
        lo = np.minimum(lo, P.min(0)); hi = np.maximum(hi, P.max(0)); tris += tri_count(o)
    return lo, hi, tris


def fit(objs, spec, zmin, center=True):
    """Scale each axis about the origin so the mesh bounds equal spec, centre XY, put the lowest point at zmin."""
    lo, hi, _ = obj_bounds(objs); s = np.array(spec) / np.maximum(hi - lo, 1e-9)
    for o in objs: set_co(o, get_co(o) * s)
    lo, hi, _ = obj_bounds(objs)
    t = np.array([-(lo[0] + hi[0]) / 2 if center else 0.0, -(lo[1] + hi[1]) / 2 if center else 0.0, zmin - lo[2]])
    for o in objs: set_co(o, get_co(o) + t)


def finish_rock(name, objs, spec, sink_frac, **kw):
    fit(objs, spec, -spec[2] * sink_frac)
    return Asset(name, objs, spec, sink=spec[2] * sink_frac, **kw)


# ══════════════════════════════════════════════════════════════════ 1. limestone boulder B
LIME = dict(a=(0.73, 0.72, 0.67), b=(0.82, 0.80, 0.74), dark=(0.45, 0.44, 0.40))     # sRGB; linear ~0.45-0.58 before AO/weathering
LIME_STAIN = {'col': (0.74, 0.62, 0.42), 'amt': 0.35, 'scale': 0.7, 'lo': 0.54, 'hi': 0.7}   # ochre iron staining


@asset('rock_limestone_b', 4)
def gen_rock_limestone_b(name):
    """Tilted bedding wedge: one tall end, a sloping bedding-plane top with solution pits, near-vertical joint faces."""
    rng = np.random.default_rng(41011); spec = (4.2, 3.0, 3.5); tilt = (-0.42, -0.08)
    bed_n = nrm([tilt[0], tilt[1], 1.0])

    def wedge(P):
        hx = spec[0] / 2; t = np.clip((P[:, 0] + hx) / (2 * hx), 0, 1)
        P[:, 2] = np.where(P[:, 2] > 0, P[:, 2] * (0.35 + 0.65 * t ** 0.8), P[:, 2]); return P
    cuts = [(bed_n, 0.62), ((0, 0, -1), 0.55)]
    cuts += [(nrm([1.0, 0.15, 0.1]), 0.86), (nrm([-0.2, 1.0, 0.05]), 0.8), (nrm([0.1, -1.0, -0.05]), 0.82),
             (nrm([-1.0, -0.3, 0.25]), 0.84)]
    cuts += rand_cuts(rng, 5, (0.72, 0.9), side=0.6) + rand_cuts(rng, 5, (0.88, 0.96))
    m = rock_mat(name + '_mat', spec[2], LIME, strata=(0.4, 0.42, tilt), streak=0.55, crack=0.3, crack_scale=1.1,
                 mottle=0.65, stain=LIME_STAIN, lichen=0.55, lichen_col=(0.74, 0.76, 0.64), lichen2=0.12, moss=0.45,
                 dust=0.55, edge=0.35, rough=0.84, bump=0.45)
    o = boulder(name, rng, spec, base='cube', round_=0.35, warp=0.12, pre=wedge, cuts=cuts, bevel=0.07, voxel=0.04, seed=11,
                disp={'fbm': [(0.6, 0.07, 3), (2.4, 0.022, 3)], 'ridge': (1.3, 0.03),
                      'strata': dict(sp=0.42, depth=0.12, tilt=tilt, wob=0.05, soft=0.45, groove=0.7),
                      'crack': dict(scale=0.75, width=0.06, depth=0.06, cover=0.55),
                      'pits': dict(scale=2.2, radius=0.09, depth=0.04, up=0.55)})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.1, ground='grass', smooth=38,
                       notes='Pale limestone wedge boulder (different silhouette from rock_limestone_a): tall +X end, '
                             'bedding planes dipping ~23 deg toward -X form the sloping top (solution pits), near-vertical '
                             'joint faces, recessed soft beds, rain streaks, lichen/moss on top faces, dust at the base.',
                       extra={'biomes': ['emerald_strait'], 'scale_range': [0.7, 1.3]})


@asset('rock_limestone_a', 3)
def gen_rock_limestone_a(name):
    """Blocky limestone boulder: flat-lying beds stepped into ledges, near-vertical joint faces, squat silhouette
    (rebuilt here with a darker, physically plausible albedo; same 4.4 x 3.6 x 3.0 m spec as the original)."""
    rng = np.random.default_rng(40011); spec = (4.4, 3.6, 3.0); tilt = (0.04, -0.03)
    cuts = [((0, 0, -1), 0.55), (nrm([0.05, 0.02, 1.0]), 0.7), (nrm([1.0, 0.1, 0.05]), 0.82), (nrm([-1.0, 0.25, 0.1]), 0.8),
            (nrm([0.2, 1.0, 0.0]), 0.84), (nrm([-0.15, -1.0, 0.1]), 0.8)]
    cuts += rand_cuts(rng, 6, (0.7, 0.88), side=0.7) + rand_cuts(rng, 6, (0.88, 0.96))
    m = rock_mat(name + '_mat', spec[2], LIME, strata=(0.35, 0.5, tilt), streak=0.55, crack=0.3, crack_scale=1.0,
                 mottle=0.6, stain=LIME_STAIN, lichen=0.5, lichen_col=(0.74, 0.76, 0.64), lichen2=0.1, moss=0.5,
                 dust=0.55, edge=0.35, rough=0.85, bump=0.45)
    o = boulder(name, rng, spec, base='cube', round_=0.45, warp=0.14, cuts=cuts, bevel=0.07, voxel=0.042, seed=1,
                disp={'fbm': [(0.55, 0.07, 3), (2.4, 0.022, 3)], 'ridge': (1.2, 0.03),
                      'strata': dict(sp=0.5, depth=0.13, tilt=tilt, wob=0.06, soft=0.45, groove=0.7),
                      'crack': dict(scale=0.7, width=0.06, depth=0.06, cover=0.55),
                      'pits': dict(scale=2.2, radius=0.09, depth=0.04, up=0.6)})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.1, ground='grass', smooth=38,
                       notes='Pale limestone boulder (rebuilt by rocks.py): squat blocky form, flat-lying beds stepped into '
                             'undercut ledges, near-vertical joint faces, solution pits on top, grey/ochre mottling, rain '
                             'streaks, darker crevices, lichen and moss on top faces, dirt at the base.',
                       extra={'biomes': ['emerald_strait'], 'scale_range': [0.7, 1.3]})


# ══════════════════════════════════════════════════════════════════ 2. coastal wet boulder
@asset('rock_coastal_wet', 1)
def gen_rock_coastal_wet(name):
    rng = np.random.default_rng(42022); spec = (5.0, 4.2, 3.2); sink = 0.3 / 3.2
    zw = round(-0.3 + 0.4 * spec[2], 2)                 # spray line: 40 % of the full height above the bottom
    cuts = [((0, 0, -1), 0.6)] + rand_cuts(rng, 9, (0.55, 0.85), side=0.45) + rand_cuts(rng, 6, (0.85, 0.95))
    m = rock_mat(name + '_mat', spec[2], dict(a=(0.38, 0.37, 0.35), b=(0.48, 0.47, 0.44), dark=(0.17, 0.17, 0.16)),
                 strata=(0.15, 0.55, (0.15, -0.3)), streak=0.35, crack=0.45, lichen=0.35, lichen_col=(0.62, 0.62, 0.55),
                 lichen2=0.28, lichen2_col=(0.76, 0.54, 0.22), moss=0.0, dust=0.0, edge=0.3, rough=0.82,
                 wet={'z': zw, 'rough': 0.1}, bump=0.4)
    o = boulder(name, rng, spec, warp=0.2, cuts=cuts, bevel=0.1, voxel=0.05, seed=22,
                disp={'fbm': [(0.45, 0.09, 3), (1.8, 0.03, 3)], 'ridge': (1.1, 0.025), 'zfade': (-0.4, 0.4, 0.35),
                      'strata': dict(sp=0.55, depth=0.035, tilt=(0.15, -0.3), soft=0.3),
                      'crack': dict(scale=0.6, width=0.06, depth=0.07, cover=0.6)})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, sink, ground='sand', smooth=40, wet_rough=True, rough=0.82,
                       notes='Dark coastal boulder (greywacke). Below the wobbly spray line at z=%.2f m (40 %% of its height) '
                             'it is darker and glossy (roughness 0.1) with green-brown algae at the base, barnacle crust and a '
                             'black lichen tide band; the dry top has orange Xanthoria and grey lichen. Lower part is '
                             'wave-polished (less surface noise). The glb carries a baked roughness map.' % zw,
                       extra={'spray_line_z_m': zw, 'biomes': ['emerald_strait', 'granite_fjord', 'copperhead_bay'],
                              'scale_range': [0.6, 1.4]})


# ══════════════════════════════════════════════════════════════════ cliffs (swept, tileable)
def periodic_positions(rng, W, step):
    """Sorted positions in [-W/2, W/2) whose gaps (including the wrap-around gap) are drawn from step."""
    gaps = []
    while sum(gaps) < W: gaps.append(rng.uniform(*step))
    gaps = np.array(gaps) * W / sum(gaps)
    x = (rng.uniform(-W / 2, W / 2) + np.concatenate([[0.0], np.cumsum(gaps)[:-1]])) % W - W / 2
    return np.sort(x)


class BlockFace:
    """Recess field (metres pushed back into the cliff) for a sea face built of beds/sheets cut by vertical joints into
    blocks.  Every block is a slightly tilted planar fracture face with bevelled edges; soft beds are undercut (giving
    overhangs under the hard bed above); some blocks are missing (alcoves).  Exactly periodic in x with period W."""

    def __init__(self, rng, W, z0, z1, *, bed=(0.5, 1.6), soft_p=0.3, soft_d=(0.35, 0.8), walk=0.3, walk_max=1.2,
                 joint=(1.5, 5.0), stagger=True, jjit=0.3, block_r=(0.0, 0.35), missing_p=0.0, missing_d=(1.0, 1.8),
                 tilt=0.06, bev_w=0.25, bev_d=0.15, jw=0.15, jd=0.25, extra_joint_p=0.0, jbev=1.0, soft_pow=0.7):
        self.W = W; zs = [z0 - 0.4]
        while zs[-1] < z1 + 0.4: zs.append(zs[-1] + rng.uniform(*bed))
        self.zs = np.array(zs); K = len(zs) - 1; self.K = K
        rw = np.cumsum(rng.normal(0, walk, K)); rw -= rw.min()
        if rw.max() > walk_max: rw *= walk_max / rw.max()
        self.bed_r = rw
        self.soft = np.where(rng.uniform(size=K) < soft_p, rng.uniform(*soft_d, K), 0.0)
        master = periodic_positions(rng, W, joint)
        self.joints, self.blocks = [], []
        for k in range(K):
            if stagger: js = periodic_positions(rng, W, joint)
            else:
                js = (master + rng.normal(0, jjit, len(master)) + W / 2) % W - W / 2
                if extra_joint_p and rng.uniform() < extra_joint_p:
                    js = np.concatenate([js, rng.uniform(-W / 2, W / 2, 1)])
                js = np.sort(js)
            n = len(js)
            r0 = rng.uniform(*block_r, n) + (rng.uniform(size=n) < missing_p) * rng.uniform(*missing_d, n)
            self.joints.append(js); self.blocks.append((r0, rng.normal(0, tilt, n), rng.normal(0, tilt, n)))
        self.bev_w, self.bev_d, self.jw, self.jd, self.jbev, self.soft_pow = bev_w, bev_d, jw, jd, jbev, soft_pow

    def recess(self, X, Z):
        X = np.asarray(X, float).ravel(); Z = np.asarray(Z, float).ravel(); R = np.zeros(len(X)); W = self.W
        k = np.clip(np.searchsorted(self.zs, Z, 'right') - 1, 0, self.K - 1)
        for kk in np.unique(k):
            msk = k == kk; x = X[msk]; z = Z[msk]; js = self.joints[kk]; n = len(js)
            jr = np.searchsorted(js, x, 'right'); jl = jr - 1
            xl = np.where(jl >= 0, js[np.clip(jl, 0, n - 1)], js[-1] - W)
            xr = np.where(jr < n, js[np.clip(jr, 0, n - 1)], js[0] + W)
            bi = np.mod(jl, n); r0, gx, gz = self.blocks[kk]
            za, zb = self.zs[kk], self.zs[kk + 1]; t = (z - za) / (zb - za)
            r = self.bed_r[kk] + r0[bi] + gx[bi] * (x - (xl + xr) / 2) + gz[bi] * (z - (za + zb) / 2)
            r += self.soft[kk] * np.sin(np.pi * t) ** self.soft_pow
            dj = np.minimum(x - xl, xr - x); db = np.minimum(z - za, zb - z)
            r += self.bev_d * np.maximum((1 - np.clip(db / self.bev_w, 0, 1)) ** 2,
                                         self.jbev * (1 - np.clip(dj / self.bev_w, 0, 1)) ** 2)
            r += self.jd * (1 - np.clip(dj / self.jw, 0, 1)) ** 2
            R[msk] = r
        return R

    def rows(self, zlo, zhi, eps=0.035, step=0.32):
        out = [zlo, zhi]
        for k in range(self.K):
            za, zb = self.zs[k], self.zs[k + 1]
            n_int = max(1, int((zb - za) / step))
            for c in [za + eps, zb - eps, za + 0.12, zb - 0.12] + list(np.linspace(za, zb, n_int + 2)[1:-1]):
                if zlo + 0.02 < c < zhi - 0.02: out.append(c)
        out = np.sort(np.array(out)); keep = [out[0]]
        for v in out[1:]:
            if v - keep[-1] > 0.015: keep.append(v)
        return np.array(keep)


def cliff_sweep(name, rng, bf, *, W=24.0, D=10.0, zb=-1.5, ztop=10.5, brink_drop=0.5, brink_r=0.6, brink_h=1.2,
                bay_amp=0.9, noise_amp=0.12, noise_scale=0.45, crack=None, lean=0.5, wob=0.12, top_amp=0.12,
                nx=121, n_top=16, seed=0, target=CLIFF_TRIS, toe=0.3):
    """Closed swept profile (bottom -> sea face -> top -> back) along X with flat end caps at x = +-W/2.  Every
    x-dependent term is periodic in W, so the two caps carry the identical profile and chunks tile seamlessly."""
    xs = np.linspace(-W / 2, W / 2, nx); zbr = ztop - brink_drop
    zr = bf.rows(zb, zbr); zr = np.unique(np.concatenate([zr, zbr - np.array([0.25, 0.5, 0.8])]))
    nf = len(zr); XX, ZZ = np.meshgrid(xs, zr, indexing='ij')
    Xf, Zf = XX.ravel(), ZZ.ravel(); P2 = np.stack([Xf, Zf, np.zeros_like(Xf)], 1)
    R = bf.recess(Xf, Zf)
    R += bay_amp * fbm(np.stack([Xf, np.zeros_like(Xf), np.zeros_like(Xf)], 1), 1 / 9.0, 2, seed=seed + 1, period=W)
    R += noise_amp * fbm(P2, noise_scale, 4, seed=seed + 2, period=W) + noise_amp * 0.35 * fbm(P2, noise_scale * 4, 2, seed=seed + 3, period=W)
    if crack: R += crack_term(P2, seed=seed + 4, period=W, **crack)
    R += lean * (Zf - zb) / (zbr - zb) + brink_r * smoothstep(zbr - brink_h, zbr, Zf) ** 2 - toe * smoothstep(0.8, zb, Zf)
    R = (R - R.min()).reshape(nx, nf)
    wf = smoothstep(zb, zb + 1.5, ZZ) * smoothstep(zbr, zbr - 1.0, ZZ)
    ZW = ZZ + wob * fbm(np.stack([xs, np.zeros(nx), np.zeros(nx)], 1), 0.22, 2, seed=seed + 5, period=W)[:, None] * wf
    YF = -D / 2 + R
    t = (np.arange(1, n_top + 1) / n_top) ** 1.7
    YT = YF[:, -1:] + (D / 2 - YF[:, -1:]) * t[None, :]
    XT = np.repeat(xs[:, None], n_top, 1)
    tn = top_amp * fbm(np.stack([XT.ravel(), YT.ravel(), np.zeros(XT.size)], 1), 0.25, 3, seed=seed + 6, period=W).reshape(nx, n_top)
    ZT = ztop - brink_drop * (1 - smoothstep(0.0, 0.16, t))[None, :] + tn * smoothstep(0.0, 0.2, t)[None, :]
    rows_y = np.concatenate([np.full((nx, 1), D / 2), np.full((nx, 1), 0.0), YF, YT], 1)
    rows_z = np.concatenate([np.full((nx, 1), zb), np.full((nx, 1), zb), ZW, ZT], 1)
    bm = bmesh.new(); Rn = rows_y.shape[1]
    V = [[bm.verts.new((xs[i], rows_y[i, j], rows_z[i, j])) for j in range(Rn)] for i in range(nx)]
    for i in range(nx - 1):
        for j in range(Rn):
            j2 = (j + 1) % Rn
            bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][j2], V[i][j2]))
    caps = [bm.faces.new(V[0][::-1]), bm.faces.new(V[nx - 1])]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=caps, quad_method='BEAUTY', ngon_method='BEAUTY')
    o = bm_obj(name, bm)
    dense = tri_count(o)
    decimate_protected(o, target, lambda c: abs(abs(c.x) - W / 2) < 1e-4)
    o['dense_tris'] = dense
    return o


def check_seam(o, W):
    """Max distance between the -X and +X cap profiles (should be ~0)."""
    P = get_co(o); L = P[np.abs(P[:, 0] + W / 2) < 1e-4][:, 1:]; Rr = P[np.abs(P[:, 0] - W / 2) < 1e-4][:, 1:]
    if not len(L) or not len(Rr): return None
    d = np.sqrt(((L[:, None, :] - Rr[None, :, :]) ** 2).sum(-1)).min(1)
    return float(d.max())


def finish_cliff(name, o, notes, extra, W=24.0, D=10.0, H=12.0, zb=-1.5, kind='cliff'):
    objs = o if isinstance(o, list) else [o]
    fit(objs, (W, D, H), zb, center=False)
    lo, hi, _ = obj_bounds(objs)
    for ob in objs: set_co(ob, get_co(ob) - np.array([0.0, (lo[1] + hi[1]) / 2, 0.0]))
    seam = max((check_seam(ob, W) or 0.0) for ob in objs)
    ex = {'face': '-Y', 'tile_pitch_m': W, 'seamless_x': True, 'seam_mismatch_m': round(seam, 5),
          'base_z_m': zb, 'scale_range_z': [0.6, 1.4]}
    ex.update(extra)
    return Asset(name, objs, (W, D, H), kind=kind, notes=notes, extra=ex, ground='sand', sink=-zb, smooth=42)


CLIFF_NOTE = ('Instance along steep shores with local -Y toward the sea; chunks tile seamlessly side by side at a %g m pitch '
              '(both end caps carry the identical profile; flat caps at x=+-12 are hidden when tiled - on tight curves '
              'overlap ~1 m). Base runs to z=-1.5 (below the beach/water line); the flat-ish top sits at z~%s and is '
              'meant to be just below the grass surface. Vertical instance scaling keeps the tiling.')


@asset('rock_cliff_limestone', 2)
def gen_rock_cliff_limestone(name):
    rng = np.random.default_rng(43033); W, ztop = 24.0, 10.5
    bf = BlockFace(rng, W, -1.5, ztop, bed=(0.35, 1.9), soft_p=0.32, soft_d=(0.5, 1.3), walk=0.55, walk_max=1.9,
                   joint=(2.0, 6.5), stagger=True, block_r=(0.0, 0.3), missing_p=0.05, missing_d=(0.8, 1.4), tilt=0.05,
                   bev_w=0.13, bev_d=0.09, jw=0.12, jd=0.4, jbev=0.5, soft_pow=0.3)
    o = cliff_sweep(name, rng, bf, W=W, ztop=ztop, brink_drop=0.45, brink_r=0.7, brink_h=1.2, bay_amp=1.7, noise_amp=0.16,
                    crack=dict(scale=0.45, width=0.06, depth=0.09, cover=0.45), lean=0.7, wob=0.14, seed=33)
    m = rock_mat(name + '_mat', 12.0, LIME, scale=0.6, strata=(0.4, 0.9, (0.0, 0.0)), streak=0.7, crack=0.3, mottle=0.7,
                 stain=dict(LIME_STAIN, amt=0.45), lichen=0.4, lichen2=0.08, moss=0.6,
                 dust=0.5, dust_h=0.9, dust_col=(0.62, 0.58, 0.48), edge=0.3, ao_dist=1.2, rough=0.86, bump=0.4, bump_dist=0.06)
    o.data.materials.append(m)
    return finish_cliff(name, o, 'Layered limestone cliff chunk 24 x 10 x 12 m. Sea face: horizontal beds (0.45-1.5 m) cut by '
                        'staggered joints into bevelled, slightly tilted planar blocks; soft beds are undercut so the hard '
                        'bed above overhangs; rain streaks, moss/lichen on ledges, sand-dust at the toe. ' + CLIFF_NOTE % (W, '10.0-10.5'),
                        {'biomes': ['emerald_strait'], 'top_z_m': [10.0, 10.5], 'dense_tris': o['dense_tris']})


# ══════════════════════════════════════════════════════════════════ 4. granite boulder
GRANITE = dict(a=(0.55, 0.54, 0.52), b=(0.65, 0.64, 0.61), dark=(0.29, 0.29, 0.28))
SPECKLE = {'scale': 48.0, 'black': 0.14, 'white': 0.2, 'pink': 0.12}


@asset('rock_granite_a', 5)
def gen_rock_granite_a(name):
    rng = np.random.default_rng(44044); spec = (4.2, 3.6, 2.7)
    cuts = [((0, 0, -1), 0.55)] + rand_cuts(rng, 8, (0.66, 0.9), side=0.3) + rand_cuts(rng, 2, (0.8, 0.9), up=1.0)
    m = rock_mat(name + '_mat', spec[2], GRANITE, speckle=SPECKLE, streak=0.25, crack=0.15, lichen=0.55,
                 lichen_col=(0.70, 0.74, 0.60), lichen2=0.12, moss=0.35, dust=0.5, edge=0.25, rough=0.8, bump=0.3, facet=0.4)
    o = boulder(name, rng, spec, warp=0.24, warp_scale=0.4, cuts=cuts, bevel=0.3, bevel_angle=20, voxel=0.05, seed=44,
                disp={'fbm': [(0.45, 0.08, 3), (2.0, 0.014, 2)],
                      'crack': dict(scale=0.32, width=0.05, depth=0.05, cover=0.35)})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.1, ground='grass', smooth=45,
                       notes='Rounded glacial granite boulder (erratic): softly rounded joint facets, speckled grey granite '
                             '(black biotite, white quartz/feldspar, pink K-feldspar), a sealed joint crack, pale lichen '
                             'rosettes, moss on the top, dust at the base.',
                       extra={'biomes': ['granite_fjord'], 'scale_range': [0.6, 1.4]})


# ══════════════════════════════════════════════════════════════════ 5. granite slab
@asset('rock_granite_slab', 6)
def gen_rock_granite_slab(name):
    """Whaleback slab: smooth glacially polished stoss side (+X), plucked steep lee side (-X)."""
    rng = np.random.default_rng(45055); spec = (8.0, 6.0, 1.5)

    def dome(P):
        hx, hy, hz = spec[0] / 2, spec[1] / 2, spec[2] / 2
        r2 = (P[:, 0] / hx) ** 2 + (P[:, 1] / hy) ** 2
        top = P[:, 2] > -hz * 0.3
        P[:, 2] = np.where(top, P[:, 2] - hz * 0.55 * r2 - hz * 0.25 * np.clip(P[:, 0] / hx, 0, 1) ** 2, P[:, 2]); return P
    cuts = [((0, 0, -1), 0.5), (nrm([-1.0, 0.2, 0.15]), 0.62), (nrm([-1.0, -0.5, 0.35]), 0.7), (nrm([-0.7, 0.8, 0.2]), 0.75),
            (nrm([-0.4, -1.0, 0.1]), 0.78), (nrm([0.15, -1.0, 0.15]), 0.84), (nrm([0.3, 1.0, 0.2]), 0.86),
            (nrm([1.0, 0.3, 0.6]), 0.9), (nrm([0.1, 0.1, 1.0]), 0.86)] + rand_cuts(rng, 5, (0.86, 0.95), side=0.8)
    m = rock_mat(name + '_mat', spec[2] * 2, GRANITE, speckle=SPECKLE, striation={'amt': 0.35}, streak=0.2, crack=0.25,
                 crack_scale=0.5, lichen=0.45, lichen_col=(0.70, 0.74, 0.60), lichen2=0.1, moss=0.3, dust=0.45, dust_h=0.3,
                 edge=0.3, rough=0.72, bump=0.3, facet=0.35)
    o = boulder(name, rng, spec, base='cube', round_=0.25, warp=0.12, warp_scale=0.25, pre=dome, cuts=cuts, bevel=0.1,
                bevel_angle=22, voxel=0.055, seed=55,
                disp={'fbm': [(0.35, 0.05, 3), (1.6, 0.012, 2)], 'ridge': (0.9, 0.025),
                      'strata': dict(sp=0.42, depth=0.11, tilt=(0.0, 0.0), soft=0.45, groove=0.8),
                      'crack': dict(scale=0.17, width=0.09, depth=0.2, cover=0.75),
                      'crack2': dict(scale=0.5, width=0.04, depth=0.04, cover=0.35)})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.13, ground='grass', smooth=40,
                       notes='Flat glacial granite slab (roche moutonnee type, 8 x 6 x 1.5 m): domed, glacially polished '
                             'top with fine striations along X, steep plucked lee face toward -X, horizontal sheeting joints '
                             'on the sides, two through-going fissures, speckled granite with lichen and moss patches.',
                       extra={'biomes': ['granite_fjord'], 'scale_range': [0.7, 1.3]})


# ══════════════════════════════════════════════════════════════════ 6. scree
@asset('rock_scree_cluster', 7)
def gen_rock_scree_cluster(name):
    rng = np.random.default_rng(46066); spec = (6.0, 5.0, 0.55)
    n = 104; placed = []; verts = []; faces = []; stone_id = []
    # fan-shaped patch: denser along the long axis, coarser stones toward +X (the toe of the fan)
    while len(placed) < n:
        u, v = rng.uniform(-1, 1, 2)
        if u * u + (v / (0.75 + 0.15 * u)) ** 2 > 1: continue
        if rng.uniform() > 0.35 + 0.65 * (1 - (u * u + v * v)) ** 0.5: continue
        size = float(np.clip(rng.lognormal(np.log(0.24 + 0.09 * (u + 1)), 0.45), 0.09, 0.62))
        p = np.array([u * 2.9, v * 2.4]); ok = True
        for q, sq in placed:
            if np.linalg.norm(p - q) < 0.3 * (size + sq): ok = False; break
        if ok: placed.append((p, size))
    for k, (p, size) in enumerate(placed):
        pts = rng.normal(size=(10, 3)); pts /= np.linalg.norm(pts, axis=1)[:, None]
        pts *= np.array([1.0, rng.uniform(0.6, 0.95), rng.uniform(0.35, 0.65)]) * rng.uniform(0.8, 1.0, (10, 1))
        pts[:, 2] = np.maximum(pts[:, 2], -0.25)                  # flat-ish underside (fracture)
        a = rng.uniform(0, 2 * np.pi); c, s_ = math.cos(a), math.sin(a)
        Rz = np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]]); tilt = rng.normal(0, 0.18, 2)
        pts = pts @ Rz.T; pts[:, 2] += pts[:, 0] * tilt[0] + pts[:, 1] * tilt[1]
        pts *= size / 2
        hull = ConvexHull(pts); base = len(verts)
        h = pts[:, 2].max() - pts[:, 2].min()
        lift = -pts[:, 2].min() - h * rng.uniform(0.15, 0.4)       # partly buried / bedded
        for q, sq in placed[:k]:                                   # small stones resting on bigger neighbours
            if sq > size * 1.6 and np.linalg.norm(p - q) < 0.5 * (sq + size): lift += sq * 0.25
        verts += [tuple(x) for x in pts + np.array([p[0], p[1], lift])]
        faces += [tuple(base + i for i in f) for f in hull.simplices]; stone_id += [k] * len(hull.simplices)
    # gravel bed: low noisy fan-shaped mound of fines under the stones
    gx, gy = 15, 12; base = len(verts); gid = len(placed)
    for j in range(gy + 1):
        for i in range(gx + 1):
            u, v = -1 + 2 * i / gx, -1 + 2 * j / gy
            r = math.sqrt(u * u + (v / (0.75 + 0.15 * u)) ** 2)
            z = 0.1 * max(0.0, 1 - r) ** 0.7 - 0.05 + 0.03 * fbm(np.array([[u * 3, v * 3, 0.0]]), 1.2, 2, seed=7)[0]
            sc = 1.06 if r > 1 else 1.0
            verts.append((u * 2.9 * sc, v * 2.4 * sc, z if r < 1 else -0.06))
    for j in range(gy):
        for i in range(gx):
            a0 = base + j * (gx + 1) + i
            faces.append((a0, a0 + 1, a0 + gx + 2, a0 + gx + 1)); stone_id.append(gid)
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    o = link_obj(bpy.data.objects.new(name, me))
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    decimate(o, BOULDER_TRIS)
    # per-stone tint attribute (connected components)
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table(); comp = np.full(len(bm.verts), -1); cid = 0
    for v0 in bm.verts:
        if comp[v0.index] >= 0: continue
        stack = [v0]; comp[v0.index] = cid
        while stack:
            v = stack.pop()
            for e in v.link_edges:
                w = e.other_vert(v)
                if comp[w.index] < 0: comp[w.index] = cid; stack.append(w)
        cid += 1
    bm.free()
    at = o.data.attributes.new('stone', 'FLOAT', 'POINT'); at.data.foreach_set('value', u01(hash3(comp, 1, 2, 9)).astype(np.float32))
    m = rock_mat(name + '_mat', 0.5, dict(a=(0.47, 0.46, 0.44), b=(0.58, 0.57, 0.54), dark=(0.24, 0.24, 0.23)),
                 speckle=SPECKLE, scale=2.0, facet=0.9, crack=0.0, streak=0.0, lichen=0.35, lichen_col=(0.72, 0.74, 0.60),
                 lichen2=0.08, moss=0.15, dust=0.7, dust_h=0.12, dust_col=(0.48, 0.44, 0.37), ao=0.8, ao_dist=0.25,
                 edge=0.35, rough=0.84, bump=0.25, bump_dist=0.015)
    # per-stone brightness/hue variation through the 'stone' attribute
    nt = m.node_tree; bsdf = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'][0]
    src = bsdf.inputs['Base Color'].links[0].from_socket; g = G.__new__(G); g.nt = nt; g.N = nt.nodes
    tint = g.mix(g.mr(g.attr('stone'), 0.0, 1.0), (0.82, 0.80, 0.78), (1.16, 1.12, 1.06))
    nt.links.new(g.mix(1.0, src, tint, 'MULTIPLY'), bsdf.inputs['Base Color'])
    o.data.materials.append(m)
    a = finish_rock(name, [o], spec, 0.1, ground='grass', smooth=25,
                    notes='Scree patch ~6 x 5 m: %d angular granite fragments (convex fracture hulls, 0.07-0.55 m, coarser '
                          'toward +X like a talus fan toe), partly bedded and stacked, one mesh. Per-stone tint, lichen, '
                          'dust between stones. Place at cliff toes / slope feet.' % len(placed),
                    extra={'biomes': ['granite_fjord'], 'stones': len(placed), 'scale_range': [0.6, 1.5]})
    return a


# ══════════════════════════════════════════════════════════════════ 7. granite cliff
@asset('rock_cliff_granite', 8)
def gen_rock_cliff_granite(name):
    rng = np.random.default_rng(47077); W, ztop = 24.0, 10.5
    bf = BlockFace(rng, W, -1.5, ztop, bed=(1.8, 4.5), soft_p=0.0, walk=0.6, walk_max=1.6, joint=(2.8, 8.0), stagger=False,
                   jjit=0.45, extra_joint_p=0.5, block_r=(0.0, 1.4), missing_p=0.18, missing_d=(1.0, 1.8), tilt=0.16,
                   bev_w=0.35, bev_d=0.22, jw=0.18, jd=0.55, jbev=0.8)
    o = cliff_sweep(name, rng, bf, W=W, ztop=ztop, brink_drop=0.8, brink_r=1.2, brink_h=2.0, bay_amp=1.4, noise_amp=0.12,
                    noise_scale=0.3, crack=dict(scale=0.3, width=0.08, depth=0.14, cover=0.45), lean=0.4, wob=0.35, seed=77)
    m = rock_mat(name + '_mat', 12.0, GRANITE, scale=0.7, speckle=SPECKLE, streak=0.45, crack=0.2, crack_scale=0.8,
                 lichen=0.5, lichen_col=(0.70, 0.74, 0.60), lichen2=0.1, moss=0.5, dust=0.45, dust_h=0.8, edge=0.3,
                 ao_dist=1.2, rough=0.8, bump=0.3, bump_dist=0.05, facet=0.5)
    o.data.materials.append(m)
    return finish_cliff(name, o, 'Jointed granite cliff chunk 24 x 10 x 12 m: sub-horizontal sheeting joints (1.8-4.5 m) and '
                        'through-going vertical joints cut the sea face into big, edge-rounded, tilted planar blocks; missing '
                        'blocks leave alcoves under overhanging blocks; rounded whaleback brink; speckled granite, lichen, '
                        'moss on ledges. ' + CLIFF_NOTE % (W, '9.7-10.5'),
                        {'biomes': ['granite_fjord'], 'top_z_m': [9.7, 10.5], 'dense_tris': o['dense_tris']})


# ══════════════════════════════════════════════════════════════════ basalt helpers (explicit Voronoi columns)
def poly_area(p):
    return 0.5 * float(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1]))


def clip_poly(p, axis, val, keep_less):
    out = []; n = len(p)
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        ia = (a[axis] <= val) if keep_less else (a[axis] >= val); ib = (b[axis] <= val) if keep_less else (b[axis] >= val)
        if ia: out.append(a)
        if ia != ib:
            t = (val - a[axis]) / (b[axis] - a[axis]); out.append(a + t * (b - a))
    if len(out) < 3: return None
    out = np.array(out); keep = [0]
    for i in range(1, len(out)):
        if np.linalg.norm(out[i] - out[keep[-1]]) > 1e-6: keep.append(i)
    out = out[keep]
    if len(out) > 1 and np.linalg.norm(out[0] - out[-1]) < 1e-6: out = out[:-1]
    return out if len(out) >= 3 else None


def inset_poly(p, d, fixed=None):
    """Offset a convex CCW polygon inward by d (per edge; edges flagged in fixed keep offset 0)."""
    n = len(p); lines = []
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]; e = b - a; L = np.linalg.norm(e)
        if L < 1e-9: continue
        nn = np.array([-e[1], e[0]]) / L; dd = 0.0 if (fixed is not None and fixed[i]) else d
        lines.append((a + nn * dd, e / L))
    out = []
    for i in range(len(lines)):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-9: out.append(p2); continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; out.append(p1 + d1 * t)
    return np.array(out)


def periodic_cells(C, W):
    """Voronoi cells of centres C (x in [-W/2, W/2)), periodic in x.  Yields (index, CCW polygon clipped to the tile)."""
    n = len(C); pts = np.concatenate([C - [W, 0], C, C + [W, 0]]); vor = Voronoi(pts); out = []
    for cp in range(3):
        for i in range(n):
            reg = vor.regions[vor.point_region[cp * n + i]]
            if not reg or -1 in reg: continue
            poly = vor.vertices[reg]
            if poly_area(poly) < 0: poly = poly[::-1]
            poly = clip_poly(poly, 0, -W / 2, False)
            if poly is None: continue
            poly = clip_poly(poly, 0, W / 2, True)
            if poly is None or poly_area(poly) < 1e-3: continue
            out.append((i, poly, pts[cp * n + i]))
    return out


def hex_centres(rng, W, s, rows, y0, jit, back_shift=0.0):
    """Jittered hex lattice rows (x periodic in W).  The last (shape-only) row is pushed back by back_shift so the
    cells in front of it are elongated toward +Y and overlap the solid back block."""
    out = []; nx = int(round(W / s)); s = W / nx
    for r in rows:
        for i in range(nx):
            x = -W / 2 + (i + 0.5 * (r % 2) + 0.25) * s + rng.normal(0, jit * s)
            y = y0 + r * s * 0.866 + rng.normal(0, jit * s) + (back_shift if r == max(rows) else 0.0)
            out.append(((x + W / 2) % W - W / 2, y, r))
    return np.array(out), s


def prism(bm, poly, z0, segs, chamfer, top_plane, W=None, yoff=None, gap=0.0):
    """Column from z0 up through segment joints segs (list of segment top heights); each segment top edge is chamfered.
    top_plane=(ax, ay, cx, cy) tilts the last top.  Edges lying on the tile seam get no gap and no chamfer."""
    n = len(poly)
    fixed = None
    if W is not None:
        fixed = [abs(abs(poly[i][0]) - W / 2) < 1e-6 and abs(abs(poly[(i + 1) % n][0]) - W / 2) < 1e-6 for i in range(n)]
    if gap: poly = inset_poly(poly, gap, fixed)
    inner = inset_poly(poly, chamfer, fixed)
    ax, ay, cx, cy = top_plane
    prev = [bm.verts.new((p[0], p[1], z0)) for p in poly]
    for si, zt in enumerate(segs):
        last = si == len(segs) - 1; dy = (yoff[si] if yoff is not None else 0.0)
        def zz(p): return zt + ((ax * (p[0] - cx) + ay * (p[1] - cy)) if last else 0.0)
        ring_o = [bm.verts.new((p[0], p[1] + dy, zz(p) - chamfer)) for p in poly]
        ring_i = [bm.verts.new((p[0], p[1] + dy, zz(p))) for p in inner]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((prev[i], prev[j], ring_o[j], ring_o[i]))
            bm.faces.new((ring_o[i], ring_o[j], ring_i[j], ring_i[i]))
        bm.faces.new(ring_i)
        if not last:
            prev = [bm.verts.new((p[0], p[1] + (yoff[si + 1] if yoff is not None else 0.0), zt + 0.002)) for p in poly]


# ══════════════════════════════════════════════════════════════════ 8. basalt boulder
BASALT = dict(a=(0.24, 0.235, 0.225), b=(0.32, 0.31, 0.29), dark=(0.09, 0.09, 0.09), light=(0.42, 0.41, 0.39))


@asset('rock_basalt_a', 9)
def gen_rock_basalt_a(name):
    """Broken chunk of a colonnade: fused hexagonal columns of stepped heights, tilted, cut by oblique fractures."""
    rng = np.random.default_rng(48088); spec = (3.9, 3.2, 3.1); s = 0.8
    C = []
    for r in range(-4, 5):
        for i in range(-4, 5):
            x = (i + 0.5 * (r % 2)) * s + rng.normal(0, 0.07); y = r * s * 0.866 + rng.normal(0, 0.07)
            C.append((x, y))
    C = np.array(C); vor = Voronoi(C); bm = bmesh.new(); built = 0
    for k, c in enumerate(C):
        rr = (c[0] / 1.75) ** 2 + (c[1] / 1.45) ** 2
        if rr > 1.0: continue
        reg = vor.regions[vor.point_region[k]]
        if not reg or -1 in reg: continue
        poly = vor.vertices[reg]
        if poly_area(poly) < 0: poly = poly[::-1]
        poly = inset_poly(poly, 0.012)
        top = 2.75 * (1 - 0.3 * rr) + rng.normal(0, 0.28) - (rng.uniform(0.6, 1.4) if rng.uniform() < 0.2 else 0.0)
        segs = sorted(set([top] + [z for z in np.cumsum(rng.uniform(0.5, 1.1, 5)) - 0.4 if z < top - 0.35]))
        prism(bm, poly, -0.6, segs, 0.06, (rng.normal(0, 0.12), rng.normal(0, 0.12), c[0], c[1]))
        built += 1
    # tilt the bundle 12 deg and break it along two oblique fractures
    a = math.radians(12); M = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    for v in bm.verts: v.co = Vector(M @ np.array(v.co[:]))
    for n, f in ((nrm([0.9, -0.3, 0.55]), 0.6), (nrm([-0.5, 0.85, 0.4]), 0.75), (nrm([0.0, 0.0, -1.0]), 0.75)):
        plane_cut_frac(bm, n, f)
    o = bm_obj(name, bm)
    mod_remesh(o, 0.028)
    P = get_co(o); N = get_nrm(o)
    D = 0.025 * fbm(P, 0.8, 3, seed=88) + 0.008 * fbm(P, 3.0, 2, seed=89) - crack_term(P, 0.9, 0.035, 0.04, 0.5, (1, 1, 2.5), 90)
    set_co(o, P + N * D[:, None]); smooth_mesh(o, 1, 0.3); decimate(o, BOULDER_TRIS)
    m = rock_mat(name + '_mat', spec[2], BASALT, streak=0.35, crack=0.25, crack_scale=1.6, vesicles=0.5, lichen=0.4,
                 lichen_col=(0.62, 0.66, 0.56), lichen2=0.3, lichen2_col=(0.78, 0.48, 0.18), moss=0.25, dust=0.5,
                 dust_col=(0.42, 0.36, 0.28), edge=0.45, rough=0.74, bump=0.35, facet=0.5,
                 stain={'col': (0.40, 0.27, 0.18), 'amt': 0.35, 'scale': 0.9})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.1, ground='grass', smooth=38,
                       notes='Dark basalt outcrop: %d fused hexagonal columns (0.8 m) of stepped heights, bundle tilted 12 deg, '
                             'broken along two oblique fracture planes; chamfered column tops, cross joints, vesicles, brown '
                             'weathering rind, orange/grey lichen.' % built,
                       extra={'biomes': ['sunbreak_atoll'], 'scale_range': [0.6, 1.4]})


# ══════════════════════════════════════════════════════════════════ 9. basalt cliff
@asset('rock_cliff_basalt', 10)
def gen_rock_cliff_basalt(name):
    """Columnar basalt cliff: lower colonnade of thick columns (cross joints), upper entablature of thinner irregular
    columns that overhangs where colonnade columns have broken away, flat-ish top, solid back block."""
    rng = np.random.default_rng(49099); W, D, zb, ztop = 24.0, 10.0, -1.5, 10.5
    zc = lambda x: 5.6 + 0.45 * fbm(np.stack([x, np.zeros_like(x), np.zeros_like(x)], 1), 1 / 8.0, 2, seed=91, period=W)
    bm = bmesh.new()
    # colonnade: rows -1 (shape only), 0 front, 1 behind, 2 (shape only)
    C1, s1 = hex_centres(rng, W, 1.15, (-1, 0, 1, 2), -D / 2 + 0.7, 0.13, back_shift=1.6)
    cells = periodic_cells(C1[:, :2], W); par = {}
    for i in range(len(C1)): par[i] = dict(broken=rng.uniform() < 0.24, h=rng.uniform(0.2, 3.5), ax=rng.normal(0, 0.05),
                                           ay=rng.normal(0, 0.05), segs=np.cumsum(rng.uniform(1.0, 2.4, 9)) + zb, dy=rng.normal(0, 0.05, 10))
    nb = 0
    for i, poly, cen in cells:
        r = int(C1[i, 2])
        if r not in (0, 1): continue
        p = par[i]; top = float(zc(np.array([cen[0]]))[0])
        if r == 0 and p['broken']: top = zb + 1.5 + p['h']
        segs = [z for z in p['segs'] if z < top - 0.5] + [top] if r == 0 else [top]
        prism(bm, poly, zb, segs, 0.07, (p['ax'], p['ay'], cen[0], cen[1]), W=W, yoff=p['dy'] if r == 0 else None, gap=0.012)
        nb += 1
    # entablature: thinner, more irregular columns sitting on the colonnade, slightly proud of it (overhang)
    C2, s2 = hex_centres(rng, W, 0.8, (-1, 0, 1, 2), -D / 2 + 0.45, 0.22, back_shift=1.6)
    cells2 = periodic_cells(C2[:, :2], W); par2 = {}
    for i in range(len(C2)): par2[i] = dict(drop=rng.uniform(0.0, 1.1) if rng.uniform() < 0.6 else 0.0, ax=rng.normal(0, 0.1),
                                            ay=rng.normal(0, 0.1), mid=rng.uniform(0.35, 0.7), dy=rng.normal(0, 0.06, 3))
    for i, poly, cen in cells2:
        r = int(C2[i, 2])
        if r not in (0, 1): continue
        p = par2[i]; z0 = float(zc(np.array([cen[0]]))[0]) - 0.06
        top = ztop - (p['drop'] if r == 0 else p['drop'] * 0.25)
        segs = [z0 + (top - z0) * p['mid'], top] if r == 0 else [top]
        prism(bm, poly, z0, segs, 0.06, (p['ax'], p['ay'], cen[0], cen[1]), W=W, yoff=p['dy'] if r == 0 else None, gap=0.01)
        nb += 1
    # back block (hidden front face), flat-ish top just under the grass
    yb = C1[C1[:, 2] == 1][:, 1].mean() + 0.15     # inside the row-1 colonnade and the stretched row-1 entablature cells
    nxb, nyb = 25, 5; xs = np.linspace(-W / 2, W / 2, nxb); ys = np.linspace(yb, D / 2, nyb)
    TOP = [[None] * nyb for _ in range(nxb)]
    tz = 0.06 * fbm(np.stack(np.meshgrid(xs, ys, indexing='ij') + [np.zeros((nxb, nyb))], -1).reshape(-1, 3), 0.3, 2, seed=95, period=W).reshape(nxb, nyb)
    for i in range(nxb):
        for j in range(nyb): TOP[i][j] = bm.verts.new((xs[i], ys[j], ztop - 0.12 + tz[i, j]))
    for i in range(nxb - 1):
        for j in range(nyb - 1): bm.faces.new((TOP[i][j], TOP[i + 1][j], TOP[i + 1][j + 1], TOP[i][j + 1]))
    BOT = [bm.verts.new((xs[i], ys[j], zb)) for i, j in ((0, 0), (nxb - 1, 0), (nxb - 1, nyb - 1), (0, nyb - 1))]
    bm.faces.new([BOT[0], BOT[1]] + [TOP[i][0] for i in range(nxb)][::-1])
    bm.faces.new([BOT[3], BOT[2]] + [TOP[i][nyb - 1] for i in range(nxb)][::-1])
    bm.faces.new([BOT[0]] + [TOP[0][j] for j in range(nyb)] + [BOT[3]])
    bm.faces.new([BOT[1], BOT[2]] + [TOP[nxb - 1][j] for j in range(nyb)][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method='BEAUTY', ngon_method='BEAUTY')
    o = bm_obj(name, bm)
    dense = tri_count(o)
    if dense > CLIFF_TRIS: decimate_protected(o, CLIFF_TRIS, lambda c: abs(abs(c.x) - W / 2) < 1e-4)
    m = rock_mat(name + '_mat', 12.0, BASALT, scale=0.8, streak=0.5, crack=0.2, crack_scale=1.4, vesicles=0.4, lichen=0.35,
                 lichen_col=(0.62, 0.66, 0.56), lichen2=0.25, moss=0.55, moss_col=(0.26, 0.34, 0.12), dust=0.45, dust_h=0.8,
                 dust_col=(0.80, 0.76, 0.66), edge=0.45, ao_dist=0.9, rough=0.74, bump=0.35, bump_dist=0.05, facet=0.6,
                 stain={'col': (0.40, 0.27, 0.18), 'amt': 0.3, 'scale': 0.6},
                 band={'z': 5.6, 'h': 0.45, 'col': (0.42, 0.24, 0.15), 'col2': (0.52, 0.32, 0.20), 'amt': 0.7})
    o.data.materials.append(m)
    a = finish_cliff(name, o, 'Columnar basalt cliff chunk 24 x 10 x 12 m: lower colonnade of ~1.15 m hexagonal columns with '
                     'cross joints and chamfered tops, some broken low (stepping-stone stumps at the toe); a reddish bole '
                     'band at ~5.6 m; upper entablature of thinner irregular columns that overhangs where the colonnade has '
                     'broken away; flat-ish top. Columns are explicit Voronoi prisms (periodic Voronoi, so the tile seam '
                     'cuts the same columns on both ends). ' + CLIFF_NOTE % (W, '10.0-10.5'),
                     {'biomes': ['sunbreak_atoll'], 'top_z_m': [9.4, 10.5], 'columns': nb, 'dense_tris': dense})
    return a


# ══════════════════════════════════════════════════════════════════ 10. coral
def tube_bm(bm, p0, p1, r0, r1, sides=7):
    d = nrm(np.array(p1) - np.array(p0)); a = nrm(np.cross(d, [0, 0, 1] if abs(d[2]) < 0.9 else [1, 0, 0])); b = np.cross(d, a)
    ring = lambda p, r: [bm.verts.new(tuple(np.array(p) + r * (math.cos(t) * a + math.sin(t) * b)))
                         for t in np.linspace(0, 2 * np.pi, sides, endpoint=False)]
    R0, R1 = ring(p0, r0), ring(p1, r1)
    for i in range(sides):
        j = (i + 1) % sides; bm.faces.new((R0[i], R0[j], R1[j], R1[i]))
    bm.faces.new(R0[::-1]); bm.faces.new(R1)


def ball_bm(bm, c, r):
    g = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for v in g['verts']: v.co += Vector(c)


def tip_attr(o, fn, name='tip'):
    P = get_co(o); at = o.data.attributes.new(name, 'FLOAT', 'POINT'); at.data.foreach_set('value', fn(P).astype(np.float32))


CORAL_PAL = [(0.74, 0.58, 0.34), (0.73, 0.53, 0.50), (0.58, 0.63, 0.49), (0.85, 0.80, 0.66)]    # ochre, rose, sage, cream


@asset('coral_cluster_a', 11)
def gen_coral_cluster_a(name):
    """Branching coral thicket: four finger/staghorn colonies of thick forked branches on a dead-coral rubble mound."""
    rng = np.random.default_rng(50100); spec = (3.0, 2.7, 1.35); bm = bmesh.new()
    cols = [((-0.55, 0.35), 1.0, 0.0), ((0.6, -0.15), 0.9, 0.25), ((-0.25, -0.75), 0.75, 0.5), ((0.45, 0.8), 0.65, 0.75)]
    tips = []

    def grow(p, d, r, depth, maxd):
        L = rng.uniform(0.16, 0.3) * (1.15 if depth < 2 else 1.0); q = p + d * L
        tube_bm(bm, p, q, r, r * 0.9); ball_bm(bm, q, r * 0.92)
        if depth >= maxd or r < 0.04:
            tips.append(q); return
        kids = 2 if rng.uniform() < 0.45 else 1
        for _ in range(kids):
            nd = nrm(d + rng.normal(0, 0.45, 3) + np.array([0, 0, 0.25]) + 0.25 * nrm(np.array([q[0], q[1], 0.0]) - c0))
            grow(q, nd, r * rng.uniform(0.84, 0.94), depth + 1, maxd)
    for (cx, cy), sc, hue in cols:
        c0 = np.array([cx, cy, 0.0])
        for k in range(int(5 + 4 * sc)):
            a = rng.uniform(0, 2 * np.pi); off = np.array([math.cos(a), math.sin(a), 0]) * rng.uniform(0, 0.25 * sc)
            d = nrm(np.array([math.cos(a) * 0.6, math.sin(a) * 0.6, 1.0]) + rng.normal(0, 0.2, 3))
            grow(c0 + off + np.array([0, 0, -0.05]), d, 0.095 * sc ** 0.3, 0, 3)
    for _ in range(16):    # rubble mound
        c = np.array([rng.normal(0, 0.6), rng.normal(0, 0.5), -0.14]); r = rng.uniform(0.3, 0.5)
        g = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in g['verts']: v.co = Vector(np.array(v.co[:]) * [1.0, 1.0, 0.45] + c)
    o = bm_obj(name, bm)
    mod_remesh(o, 0.022); smooth_mesh(o, 2, 0.4)
    P = get_co(o); N = get_nrm(o); set_co(o, P + N * (0.006 * fbm(P, 6.0, 2, seed=101))[:, None])
    decimate(o, BOULDER_TRIS)
    T = np.array(tips); hues = np.array([c[2] for c in cols]); C0 = np.array([c[0] for c in cols])
    tip_attr(o, lambda P: np.clip(P[:, 2] / 1.1, 0, 1) ** 1.5 * 0.6 + 0.6 * smoothstep(0.3, 0.05, np.min(np.linalg.norm(P[:, None, :] - T[None], axis=2), 1)))
    tip_attr(o, lambda P: hues[np.argmin(np.linalg.norm(P[:, None, :2] - C0[None], axis=2), 1)], 'hue')
    m = coral_mat(name + '_mat', spec[2], (0.76, 0.66, 0.48), (0.70, 0.60, 0.44), (0.88, 0.78, 0.70), (0.30, 0.25, 0.20),
                  polyp=45.0, hue_attr='hue', palette=CORAL_PAL)
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.08, kind='coral', ground='seafloor', smooth=60, rough=0.72,
                       notes='Branching coral thicket (~3 m): four finger/staghorn colonies of thick forked branches with '
                             'rounded tips on a dead-coral rubble mound; muted per-colony ochre / rose / sage / cream with '
                             'paler tips, polyp pits, sediment at the base. Sits on the sea floor at z=0.',
                       extra={'biomes': ['sunbreak_atoll'], 'tips': len(tips), 'scale_range': [0.6, 1.4], 'placement': 'seafloor'})


@asset('coral_cluster_b', 12)
def gen_coral_cluster_b(name):
    """Brain coral dome + three tiered plate (table) corals + rubble."""
    rng = np.random.default_rng(51111); spec = (2.5, 2.2, 1.05)
    # brain dome
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    for v in bm.verts:
        p = np.array(v.co[:]); p *= [0.68, 0.6, 0.78]; p[2] = max(p[2], -0.05); v.co = Vector(p + [-0.38, 0.15, 0.0])
    brain = bm_obj(name + '_brain', bm); mod_remesh(brain, 0.03)
    P = get_co(brain); N = get_nrm(brain)
    ridge = fbm(P * [1.0, 1.0, 1.0], 4.5, 2, seed=111)
    D = 0.05 * fbm(P, 1.2, 3, seed=112) - 0.025 * (1 - smoothstep(0.0, 0.12, np.abs(ridge)))
    set_co(brain, P + N * D[:, None]); smooth_mesh(brain, 1, 0.3); decimate(brain, 900)
    # plates: thin wavy discs on short stalks, gently cupped
    bm = bmesh.new(); plates = [((0.62, -0.35), 0.55, 0.42), ((0.45, 0.6), 0.45, 0.28), ((-0.75, -0.55), 0.42, 0.22)]
    for (cx, cy), R, hgt in plates:
        tube_bm(bm, (cx, cy, -0.05), (cx, cy, hgt), 0.09, 0.06, 8)
        segs, rings, th = 18, 3, 0.05; ph = rng.uniform(0, 6.28)
        def pt(ri, si, up):
            rr = R * ri / rings; a = 2 * np.pi * si / segs
            wav = 0.03 * math.sin(3 * a + ph) * (ri / rings) ** 2 + 0.05 * (ri / rings) ** 2
            rr *= 1 + 0.08 * math.sin(5 * a + ph * 2)
            return (cx + rr * math.cos(a), cy + rr * math.sin(a) * 0.9, hgt + wav + (th if up else 0) * (1 - 0.5 * ri / rings))
        top = [[bm.verts.new(pt(ri, si, True)) for si in range(segs)] for ri in range(1, rings + 1)]
        bot = [[bm.verts.new(pt(ri, si, False)) for si in range(segs)] for ri in range(1, rings + 1)]
        ct = bm.verts.new((cx, cy, hgt + th)); cb = bm.verts.new((cx, cy, hgt))
        for si in range(segs):
            sj = (si + 1) % segs
            bm.faces.new((ct, top[0][si], top[0][sj])); bm.faces.new((cb, bot[0][sj], bot[0][si]))
            for ri in range(rings - 1):
                bm.faces.new((top[ri][si], top[ri + 1][si], top[ri + 1][sj], top[ri][sj]))
                bm.faces.new((bot[ri][sj], bot[ri + 1][sj], bot[ri + 1][si], bot[ri][si]))
            bm.faces.new((top[-1][si], bot[-1][si], bot[-1][sj], top[-1][sj]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    plat = bm_obj(name + '_plates', bm)
    # rubble
    bm = bmesh.new()
    for _ in range(7):
        c = np.array([rng.normal(0.1, 0.6), rng.normal(0, 0.5), -0.08]); r = rng.uniform(0.12, 0.25)
        g = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        for v in g['verts']: v.co = Vector(np.array(v.co[:]) * [1, 1, 0.5] + c)
    rub = bm_obj(name + '_rubble', bm); decimate(rub, 280)
    tip_attr(brain, lambda P: smoothstep(0.1, 0.62, P[:, 2]) * 0.5)
    tip_attr(plat, lambda P: smoothstep(0.25, 0.65, np.min([np.hypot(P[:, 0] - cx, P[:, 1] - cy) / R for (cx, cy), R, _ in plates], 0)))
    mb = coral_mat(name + '_brain_mat', 0.7, (0.60, 0.62, 0.47), (0.70, 0.62, 0.42), (0.84, 0.80, 0.64), (0.28, 0.27, 0.18),
                   polyp=60.0, groove={'scale': 9.0, 'width': 0.07, 'distort': 16.0, 'col': (0.34, 0.33, 0.21), 'crest': (0.78, 0.74, 0.58)})
    mp = coral_mat(name + '_plate_mat', 0.6, (0.70, 0.50, 0.47), (0.72, 0.58, 0.40), (0.80, 0.68, 0.58), (0.34, 0.24, 0.22), polyp=50.0)
    mr_ = coral_mat(name + '_rubble_mat', 0.3, (0.74, 0.70, 0.60), (0.66, 0.62, 0.52), (0.80, 0.76, 0.66), (0.40, 0.37, 0.30),
                    polyp=30.0, tip_attr=None, sediment=0.6)
    brain.data.materials.append(mb); plat.data.materials.append(mp); rub.data.materials.append(mr_)
    return finish_rock(name, [brain, plat, rub], spec, 0.07, kind='coral', ground='seafloor', smooth=50, rough=0.72,
                       notes='Brain + plate coral group (~2.5 m): meandering-groove brain coral dome (sage/ochre with cream '
                             'crests), three tiered table/plate corals on short stalks (muted rose/cream, paler rims), coral '
                             'rubble at the base. Sits on the sea floor at z=0.',
                       extra={'biomes': ['sunbreak_atoll'], 'scale_range': [0.6, 1.4], 'placement': 'seafloor'})


# ══════════════════════════════════════════════════════════════════ 11. copper-ore rock
@asset('rock_copper_a', 13)
def gen_rock_copper_a(name):
    rng = np.random.default_rng(52122); spec = (4.2, 3.4, 2.9)
    cuts = [((0, 0, -1), 0.55)] + rand_cuts(rng, 9, (0.5, 0.78), side=0.55) + rand_cuts(rng, 4, (0.6, 0.8), up=1.0) \
        + rand_cuts(rng, 12, (0.82, 0.94))
    m = rock_mat(name + '_mat', spec[2], dict(a=(0.52, 0.31, 0.21), b=(0.63, 0.41, 0.27), dark=(0.25, 0.14, 0.09),
                 light=(0.74, 0.56, 0.40)), strata=(0.25, 0.38, (0.3, 0.5)), streak=0.3, crack=0.45, crack_scale=1.2,
                 veins={'amt': 0.6, 'scale': 0.7, 'width': 0.018, 'halo': 0.035, 'patch': (0.45, 0.6)},
                 stain={'col': (0.72, 0.53, 0.24), 'amt': 0.55},
                 lichen=0.12, moss=0.1, dust=0.6, dust_col=(0.52, 0.37, 0.25), edge=0.35, rough=0.86, bump=0.4)
    o = boulder(name, rng, spec, warp=0.3, warp_scale=0.6, cuts=cuts, bevel=0.035, bevel_angle=30, voxel=0.045, seed=122,
                disp={'fbm': [(0.5, 0.08, 3), (2.5, 0.025, 3)], 'ridge': (0.9, 0.07),
                      'strata': dict(sp=0.38, depth=0.09, tilt=(0.3, 0.5), soft=0.4, groove=0.7),
                      'crack': dict(scale=0.9, width=0.05, depth=0.08, cover=0.6)})
    o.data.materials.append(m)
    return finish_rock(name, [o], spec, 0.1, ground='dry', smooth=36,
                       notes='Copper-ore earth rock: craggy, sharply fractured boulder in iron-oxide reds and limonite '
                             'ochres, faint tilted bedding, green malachite veins and crack halos with hints of blue azurite, '
                             'reddish dust at the base.',
                       extra={'biomes': ['copperhead_bay'], 'scale_range': [0.6, 1.4]})


# ══════════════════════════════════════════════════════════════════ preview
GROUNDS = {'grass': ((0.25, 0.31, 0.14), (0.33, 0.36, 0.20)), 'sand': ((0.78, 0.73, 0.62), (0.85, 0.80, 0.69)),
           'seafloor': ((0.70, 0.66, 0.55), (0.78, 0.74, 0.62)), 'dry': ((0.50, 0.40, 0.28), (0.58, 0.47, 0.33))}


def ground_mat(kind):
    a, b = GROUNDS.get(kind, GROUNDS['grass']); m = bpy.data.materials.new('_ground'); g = G(m)
    co = g.coord(); X = g.xyz(co)
    col = g.mix(g.noise(co, 0.3, 4, 0.6), lin(a), lin(b)); lines = None
    for c in (X[0], X[1]):
        l = g.math('LESS_THAN', g.math('PINGPONG', c, 0.5), 0.007)
        l5 = g.math('LESS_THAN', g.math('PINGPONG', g.math('DIVIDE', c, 5.0), 0.5), 0.004)
        l = g.math('MAXIMUM', l, l5); lines = l if lines is None else g.math('MAXIMUM', lines, l)
    col = g.mix(g.mul(lines, 0.16), col, (0.9, 0.9, 0.85))
    g.output(g.bsdf(col, 0.95)); return m


def figure(pos):
    bm = bmesh.new()

    def cyl(x, y, z0, z1, r0, r1, seg=10):
        g = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=z1 - z0)
        for v in g['verts']: v.co += Vector((x, y, (z0 + z1) / 2))
        return g['verts']
    parts = []
    parts.append(('leg', cyl(-0.1, 0, 0.0, 0.86, 0.08, 0.07) + cyl(0.1, 0, 0.0, 0.86, 0.08, 0.07)))
    parts.append(('top', cyl(0, 0, 0.84, 1.46, 0.19, 0.17) + cyl(-0.255, 0, 0.88, 1.42, 0.045, 0.055) + cyl(0.255, 0, 0.88, 1.42, 0.045, 0.055)))
    g = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.115)
    for v in g['verts']: v.co += Vector((0, 0, 1.685))
    parts.append(('skin', g['verts'] + cyl(0, 0, 1.44, 1.58, 0.055, 0.055)))
    mats = {'leg': (0.08, 0.09, 0.12), 'top': (0.85, 0.33, 0.07), 'skin': (0.55, 0.38, 0.28)}
    vmat = {}
    for k, vs in parts:
        for v in vs: vmat[v] = k
    keys = list(mats); me = bpy.data.meshes.new('_figure')
    for f in bm.faces: f.material_index = keys.index(vmat.get(f.verts[0], 'top'))
    bm.to_mesh(me); bm.free()
    for k in keys:
        mm = bpy.data.materials.new('_fig_' + k); mm.use_nodes = True; b = mm.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*lin(mats[k]), 1); b.inputs['Roughness'].default_value = 0.65; me.materials.append(mm)
    o = bpy.data.objects.new('_figure', me); o.location = Vector(pos); return link_obj(o)


def setup_render(px_x, px_y, samples):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; c = sc.cycles; use_gpu(sc)
    c.samples = samples; c.use_adaptive_sampling = True; c.adaptive_threshold = 0.05
    c.use_denoising = True; c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 4; c.diffuse_bounces = 2; c.glossy_bounces = 2; c.transmission_bounces = 1; c.volume_bounces = 0
    c.caustics_reflective = False; c.caustics_refractive = False
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = px_x, px_y, 100
    sc.render.threads_mode = 'FIXED'; sc.render.threads = THREADS
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    sc.view_settings.exposure = -0.3; sc.render.image_settings.file_format = 'PNG'


def setup_world():
    sc = bpy.context.scene; w = bpy.data.worlds.new('_world'); sc.world = w; w.use_nodes = True
    nt = w.node_tree; N = nt.nodes; bg = N['Background']
    tc = N.new('ShaderNodeTexCoord'); sep = N.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    mr = N.new('ShaderNodeMapRange'); nt.links.new(sep.outputs[2], mr.inputs['Value'])
    mr.inputs['From Min'].default_value = -0.2; mr.inputs['From Max'].default_value = 1.0
    ramp = N.new('ShaderNodeValToRGB'); nt.links.new(mr.outputs[0], ramp.inputs[0])
    ramp.color_ramp.elements[0].color = (0.62, 0.68, 0.74, 1); ramp.color_ramp.elements[1].color = (0.20, 0.36, 0.66, 1)
    nt.links.new(ramp.outputs[0], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
    sun = link_obj(bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN')))
    sun.data.energy = 4.2; sun.data.angle = math.radians(2.0); sun.data.color = (1.0, 0.96, 0.9)
    sd = nrm([-0.55, -0.45, 0.70]); sun.rotation_euler = Vector(-sd).to_track_quat('-Z', 'Y').to_euler()
    return [sun]


def camera(target, elev, azim, dist, lens=50):
    cd = bpy.data.cameras.new('_cam'); cam = link_obj(bpy.data.objects.new('_cam', cd))
    e, a = math.radians(elev), math.radians(azim); t = Vector(target)
    cam.location = t + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler(); cd.lens = lens; cd.clip_end = 2000
    bpy.context.scene.camera = cam; return cam


def preview(a, quick=False):
    t0 = time.time(); helpers = setup_world()
    lo, hi, _ = obj_bounds(a.objs); size = hi - lo; ctr = (lo + hi) / 2
    gm = bpy.data.meshes.new('_gm'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=300)
    bm.to_mesh(gm); bm.free(); gm.materials.append(ground_mat(a.ground)); helpers.append(link_obj(bpy.data.objects.new('_ground', gm)))
    if a.kind == 'cliff':
        W = a.spec[0]
        for o in a.objs:                       # neighbouring tile to show the seamless joint
            c = bpy.data.objects.new('_tile', o.data); c.location = (W, 0, 0); helpers.append(link_obj(c))
        helpers.append(figure((W / 2 + 1.0, lo[1] - 2.0, 0.0)))
        helpers.append(figure((W / 2 - 3.0, lo[1] - 1.2, 0.0)))
        camera((W / 2 - 1.0, -4.0, 4.8), a.preview.get('elev', 11), a.preview.get('azim', -62), a.preview.get('dist', 37), 50)
    else:
        az = math.radians(a.preview.get('azim', -55)); right = np.array([-math.sin(az), math.cos(az), 0]); toward = np.array([math.cos(az), math.sin(az), 0])
        rxy = 0.5 * math.hypot(size[0], size[1])
        fpos = ctr * [1, 1, 0] + right * (rxy * 0.75 + 0.9) + toward * min(rxy * 0.35, 1.5); fpos[2] = 0
        helpers.append(figure(tuple(fpos)))
        pts = np.array([lo, hi, fpos + [0, 0, 1.8], fpos]); c2 = (pts.min(0) + pts.max(0)) / 2
        R = 0.5 * float(np.linalg.norm(pts.max(0) - pts.min(0))) + 0.2
        c2[2] = max(0.6, size[2] * 0.42)
        camera(tuple(c2), a.preview.get('elev', 22), a.preview.get('azim', -55), R / math.sin(math.radians(39.6) / 2) * 0.9, 50)
    for o in bpy.data.objects:
        if o.name.startswith('_cam'): helpers.append(o)
    px = 320 if quick else PREVIEW_PX
    setup_render(px, px, 8 if quick else PREVIEW_SAMPLES)
    out = os.path.join(TMP, a.name + '_quick.png') if quick else os.path.join(DIRS['preview'], a.name + '.png')
    bpy.context.scene.render.filepath = out; bpy.ops.render.render(write_still=True)
    for o in helpers:
        try: bpy.data.objects.remove(o, do_unlink=True)
        except Exception: pass
    print('  preview %s (%.0fs)' % (out, time.time() - t0)); return out


# ══════════════════════════════════════════════════════════════════ save / json / bake / glb
def make_collection(a):
    sc = bpy.context.scene
    for o in list(sc.collection.objects): sc.collection.objects.unlink(o)
    col = bpy.data.collections.new(a.name); sc.collection.children.link(col)
    for o in a.objs:
        for c in list(o.users_collection): c.objects.unlink(o)
        col.objects.link(o); o['asset'] = a.name; o.data.name = o.name


def shade(a):
    for o in a.objs:
        o.data.shade_smooth()
        try: o.data.set_sharp_from_angle(angle=math.radians(a.smooth))
        except Exception: pass


def write_json(a):
    lo, hi, tris = obj_bounds(a.objs); size = hi - lo
    d = {'name': a.name, 'size_m': [round(float(x), 3) for x in size], 'min': [round(float(x), 3) for x in lo],
         'max': [round(float(x), 3) for x in hi], 'spec_m': a.spec, 'tris': int(tris), 'excluded': [], 'notes': a.notes,
         'below_ground_m': round(float(-lo[2]), 3) if lo[2] < 0 else 0.0, 'sink_m': round(float(a.sink), 3),
         'spec_error_pct': [round(100 * abs(float(size[i]) - a.spec[i]) / a.spec[i], 2) for i in range(3)],
         'origin': 'ground contact, bbox centre XY' if a.kind != 'cliff' else 'x: tile centre, y: depth centre, z: cliff toe level',
         'generator': 'maps/assets/src/rocks.py', 'objects': [o.name for o in a.objs]}
    d.update(a.extra)
    with open(os.path.join(DIRS['bounds'], a.name + '.json'), 'w') as f: json.dump(d, f, indent=1)
    return d


def smart_uv(objs, margin=0.004):
    select_only(objs); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True); bpy.ops.object.mode_set(mode='OBJECT')


def bake(objs, img, kind, samples):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples
    sc.cycles.use_denoising = False; sc.cycles.use_adaptive_sampling = False
    sc.render.threads_mode = 'FIXED'; sc.render.threads = THREADS
    sc.render.bake.margin = 8; sc.render.bake.margin_type = 'EXTEND'
    for o in objs:
        for m in o.data.materials:
            t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img; m.node_tree.nodes.active = t
    select_only(objs)
    kw = dict(type=kind, use_clear=True, margin=8)
    if kind == 'DIFFUSE': kw['pass_filter'] = {'COLOR'}
    if kind == 'NORMAL': kw['normal_space'] = 'TANGENT'
    bpy.ops.object.bake(**kw)
    img.pack()


def gltf_mat(name, col, nrm_img=None, rough=0.85, rough_img=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; b = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage'); t.image = col; nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Specular IOR Level'].default_value = 0.5
    m.use_backface_culling = True                      # closed meshes: single-sided in glTF
    if nrm_img:
        tn = N.new('ShaderNodeTexImage'); tn.image = nrm_img; nm = N.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if rough_img:
        tr = N.new('ShaderNodeTexImage'); tr.image = rough_img; sp = N.new('ShaderNodeSeparateColor')
        nt.links.new(tr.outputs['Color'], sp.inputs['Color']); nt.links.new(sp.outputs['Green'], b.inputs['Roughness'])
    return m


def glb(a):
    t0 = time.time(); objs = a.objs
    smart_uv(objs)
    col = bpy.data.images.new(a.name + '_basecolor', BAKE_PX, BAKE_PX, alpha=False); col.colorspace_settings.name = 'sRGB'
    bake(objs, col, 'DIFFUSE', BAKE_SAMPLES)
    px = np.empty(BAKE_PX * BAKE_PX * 4, np.float32); col.pixels.foreach_get(px); px = px.reshape(-1, 4)[:, :3]
    px = px[px.max(1) > 0.01]
    lpx = np.where(px > 0.04045, ((px + 0.055) / 1.055) ** 2.4, px / 12.92)
    if col.is_float: lpx = px
    a.albedo = [round(float(x), 3) for x in lpx.mean(0)]
    a.albedo_p = [round(float(np.percentile(lpx.mean(1), q)), 3) for q in (10, 50, 90)]
    print('  baked albedo (linear) mean %s  p10/50/90 %s' % (a.albedo, a.albedo_p))
    nimg = bpy.data.images.new(a.name + '_normal', BAKE_PX, BAKE_PX, alpha=False); nimg.colorspace_settings.name = 'Non-Color'
    bake(objs, nimg, 'NORMAL', 1)
    rimg = None
    if a.wet_rough:
        rimg = bpy.data.images.new(a.name + '_roughness', 512, 512, alpha=False); rimg.colorspace_settings.name = 'Non-Color'
        bake(objs, rimg, 'ROUGHNESS', 1)
    for o in objs:
        for m in list(o.data.materials):
            if m and not m.name.endswith('_src'): m.name = m.name + '_src'
    out = gltf_mat(a.name + '_mat', col, nimg, a.rough, rimg)
    for o in objs: o.data.materials.clear(); o.data.materials.append(out)
    select_only(objs)
    path = os.path.join(DIRS['glb'], a.name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='JPEG',
                              export_jpeg_quality=88, export_attributes=False, export_extras=False, export_animations=False,
                              export_cameras=False, export_lights=False)
    print('  glb %s %d KB (%.0fs)' % (path, os.path.getsize(path) // 1024, time.time() - t0))
    jp = os.path.join(DIRS['bounds'], a.name + '.json')
    if os.path.exists(jp):
        d = json.load(open(jp)); d['glb'] = 'glb/%s.glb' % a.name
        d['glb_maps'] = ['baseColor 1024', 'normal 1024 (tangent)'] + (['roughness 512 (G)'] if a.wet_rough else [])
        d['albedo_linear_mean'] = a.albedo; d['albedo_linear_p10_p50_p90'] = a.albedo_p
        json.dump(d, open(jp, 'w'), indent=1)
    return path


def run_asset(name, args):
    t0 = time.time(); reset_scene()
    a = REG[name][1](name)
    shade(a); make_collection(a)
    if not args.quick:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DIRS['blend'], name + '.blend'), compress=True)
    info = write_json(a) if not args.quick else {'name': name, 'size_m': list(np.round(obj_bounds(a.objs)[1] - obj_bounds(a.objs)[0], 3)),
                                                   'spec_m': a.spec, 'tris': obj_bounds(a.objs)[2]}
    print('%s: size %s tris %d  (%.0fs)%s' % (name, info['size_m'], info['tris'], time.time() - t0,
                                             ('  seam %.5f' % a.extra['seam_mismatch_m']) if 'seam_mismatch_m' in a.extra else ''))
    if not args.no_preview: preview(a, args.quick)
    if args.glb and not args.quick:
        glb(a); info['glb'] = True
    return info


def main():
    argv = sys.argv[1:]
    if '--' in argv: argv = argv[argv.index('--') + 1:]
    ap = argparse.ArgumentParser(description='Thunderhead rock / cliff / coral generator')
    ap.add_argument('names', nargs='*', default=['all'])
    ap.add_argument('--glb', action='store_true'); ap.add_argument('--quick', action='store_true')
    ap.add_argument('--no-preview', action='store_true'); ap.add_argument('--out', default=None)
    args = ap.parse_args(argv)
    if args.out:
        for k in DIRS:
            DIRS[k] = os.path.join(os.path.abspath(args.out), k); os.makedirs(DIRS[k], exist_ok=True)
    names = [n for a_ in args.names for n in a_.split(',') if n]
    if not names or names == ['all']: names = [k for k in sorted(REG, key=lambda k: REG[k][0]) if k not in NOT_IN_ALL]
    done, failed = [], []
    for n in names:
        if n not in REG: print('unknown asset', n, '- known:', ', '.join(sorted(REG, key=lambda k: REG[k][0]))); failed.append(n); continue
        try: done.append(run_asset(n, args))
        except Exception:
            import traceback; traceback.print_exc(); failed.append(n)
    print('\n%-22s %-24s %-20s %6s' % ('asset', 'size_m', 'spec_m', 'tris'))
    for d in done: print('%-22s %-24s %-20s %6d' % (d['name'], d['size_m'], d['spec_m'], d['tris']))
    if failed: print('FAILED:', ', '.join(failed)); sys.exit(1)


if __name__ == '__main__':
    main()
