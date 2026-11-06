"""Metric unit models for the five Thunderhead maps (see maps/ASSET_CONTRACT.md).

1 Blender unit = 1 m, +X = front, +Y = left (north at rotation 0), +Z = up. Vehicle origin on the ground under the
hull centre; boat origin on the waterline under the hull centre.

Run:  /home/claude/blender-env/bin/python units.py [mbt|infantry|apc|harvester|patrol_boat|all] [--glb] [--check] [--no-preview]
  --glb         also bake the atlas and write maps/assets/glb/<name>.glb (the .blend, bounds json and preview are always written)
  --check       render quick Workbench orthographic views to the scratch preview folder (cheap proportion check)
  --no-preview  skip the Cycles preview render
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, json, random, argparse, time
import bpy, bmesh
from mathutils import Vector, Matrix, Euler, Quaternion

sys.path.insert(0, '/home/claude/thunderhead/blender')
import lib  # noqa: E402  (box, cyl, sphere, profile_extrude, join, shade, parent, set_origin, ...)
from lib import box, cyl, sphere, profile_extrude, join, shade, parent, set_origin, empty, assign  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = {k: os.path.join(ROOT, k) for k in ('blend', 'glb', 'bounds', 'preview')}
for d in OUT.values(): os.makedirs(d, exist_ok=True)
CHECK_DIR = os.environ.get('UNITS_CHECK_DIR', os.path.join(ROOT, 'preview'))

R = math.radians
V = Vector


# ══════════════════════════════════════ geometry helpers ══════════════════════════════════════
def mesh_from(name, verts, faces, smooth=False):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    o = bpy.data.objects.new(name, me); lib.link(o)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    return o


def loft(name, rings, closed=True, cap0=True, cap1=True):
    """Skin a list of rings (each a list of 3D points with equal count) into a mesh."""
    n = len(rings[0]); verts = [p for r in rings for p in r]; faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n if closed else n - 1):
            k = (j + 1) % n; faces.append((a + j, a + k, b + k, b + j))
    if closed and cap0: faces.append(tuple(reversed(range(n))))
    if closed and cap1: faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    o = mesh_from(name, verts, faces)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(o.data); bm.free()
    return o


def lathe(name, prof, seg=16, axis='Y', loc=(0, 0, 0), cap_axis=True, phase=0.0, radial=None):
    """Revolve a profile [(r, h), ...] around an axis.  radial(i_seg, j_prof, r) may perturb radii (tyre lugs)."""
    verts = []; n = len(prof)
    for i in range(seg):
        a = phase + 2 * math.pi * i / seg; ca, sa = math.cos(a), math.sin(a)
        for j, (r, h) in enumerate(prof):
            rr = radial(i, j, r) if radial else r
            if axis == 'Z': verts.append((rr * ca, rr * sa, h))
            elif axis == 'Y': verts.append((rr * ca, h, rr * sa))
            else: verts.append((h, rr * ca, rr * sa))
    faces = []
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n - 1): faces.append((i * n + j, i2 * n + j, i2 * n + j + 1, i * n + j + 1))
    if cap_axis:
        for j in (0, n - 1):
            if prof[j][0] > 1e-6: faces.append(tuple(i * n + j for i in range(seg)))
    o = mesh_from(name, verts, faces); o.location = loc
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(o.data); bm.free()
    return o


def prism_xy(name, outline, z0, z1, loc=(0, 0, 0)):
    """Extrude a top-view outline [(x, y), ...] from z0 to z1."""
    return loft(name, [[V((x, y, z0)) for x, y in outline], [V((x, y, z1)) for x, y in outline]])


def prism_yz(name, outline, x0, x1):
    """Extrude a front-view outline [(y, z), ...] along X from x0 to x1."""
    return loft(name, [[V((x0, y, z)) for y, z in outline], [V((x1, y, z)) for y, z in outline]])


def rod(name, a, b, r, verts=8, r2=None):
    """Cylinder between two points."""
    a, b = V(a), V(b); d = b - a
    o = cyl(name, r, d.length, (a + b) / 2, verts=verts, r2=r2)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = V((0, 0, 1)).rotation_difference(d.normalized())
    return o


def text_mesh(name, body, size, extrude=0.0, font_bold=False):
    """Flat text in the XY plane (facing +Z), centred on the origin."""
    cu = bpy.data.curves.new(name + '_crv', 'FONT'); cu.body = body; cu.size = size; cu.extrude = extrude
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 3
    ob = bpy.data.objects.new(name + '_tmp', cu); lib.link(ob); bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob, do_unlink=True); bpy.data.curves.remove(cu)
    o = bpy.data.objects.new(name, me); lib.link(o)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5); bm.to_mesh(me); bm.free()
    return o


def apply_tf(o):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def make(name, parts, mat=None, pivot=(0, 0, 0), smooth=35, par=None):
    """Join parts, apply every transform, put the origin at the pivot, smooth-shade and optionally parent."""
    parts = [p for p in parts if p is not None]
    if mat is not None:
        for p in parts:
            if not p.data.materials: assign(p, mat)
    o = join(name, parts); apply_tf(o)
    if smooth: shade(o, smooth)
    set_origin(o, pivot)
    if par is not None: parent(o, par)
    return o


def M(o, mat):
    assign(o, mat); return o


def faces_mat(o, mat, pred):
    """Assign mat to faces whose local centre/normal satisfy pred(c, n) (call before joining)."""
    i = lib.add_mat(o, mat)
    for p in o.data.polygons:
        if pred(p.center, p.normal): p.material_index = i
    return o


def solidify(o, t, offset=-1):
    m = o.modifiers.new('sol', 'SOLIDIFY'); m.thickness = t; m.offset = offset; m.use_even_offset = True
    return o


def subsurf(o, lv=1):
    m = o.modifiers.new('ss', 'SUBSURF'); m.levels = lv; m.render_levels = lv
    return o


def shrinkwrap(o, target, offset=0.006):
    m = o.modifiers.new('sw', 'SHRINKWRAP'); m.target = target; m.wrap_method = 'NEAREST_SURFACEPOINT'; m.offset = offset
    return o


def grid_plane(name, size_u, size_v, nu, nv):
    """Subdivided plane in XY centred on the origin (for decals that get shrink-wrapped)."""
    verts = [(-size_u / 2 + size_u * i / nu, -size_v / 2 + size_v * j / nv, 0) for j in range(nv + 1) for i in range(nu + 1)]
    faces = [(j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i) for j in range(nv) for i in range(nu)]
    return mesh_from(name, verts, faces)


def convex_hull_2d(pts):
    pts = sorted(set(pts))
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def resample_loop(pts, step):
    """Resample a closed polyline at roughly even spacing."""
    out = []; n = len(pts)
    for i in range(n):
        a, b = V(pts[i]), V(pts[(i + 1) % n]); L = (b - a).length; k = max(1, int(round(L / step)))
        for t in range(k): out.append(tuple(a.lerp(b, t / k)))
    return out


# ══════════════════════════════════════ materials ══════════════════════════════════════
class NB:
    """Tiny node-graph builder: constants may be passed wherever a socket is expected."""
    def __init__(self, mat):
        self.nt = mat.node_tree; self.N = self.nt.nodes; self.L = self.nt.links

    def _in(self, sock, v):
        if v is None: return
        if hasattr(v, 'is_output') or isinstance(v, bpy.types.NodeSocket): self.L.new(v, sock)
        elif isinstance(v, (int, float)) and sock.type == 'RGBA': sock.default_value = (v, v, v, 1)
        else: sock.default_value = v

    def node(self, t, **kw):
        n = self.N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n

    def geo(self):
        for n in self.N:
            if n.bl_idname == 'ShaderNodeNewGeometry': return n
        return self.node('ShaderNodeNewGeometry')

    def rgb(self, c):
        n = self.node('ShaderNodeRGB'); n.outputs[0].default_value = (*c, 1); return n.outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.5, distort=0.0, w=None, stretch=None):
        n = self.node('ShaderNodeTexNoise'); n.noise_dimensions = '4D' if w is not None else '3D'
        if stretch is not None:
            mp = self.node('ShaderNodeMapping'); self.L.new(vec, mp.inputs['Vector']); mp.inputs['Scale'].default_value = stretch; vec = mp.outputs[0]
        self.L.new(vec, n.inputs['Vector']); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = distort
        if w is not None: n.inputs['W'].default_value = w
        return n.outputs['Fac']

    def mr(self, v, a, b, c=0.0, d=1.0):
        n = self.node('ShaderNodeMapRange'); n.clamp = True; self._in(n.inputs['Value'], v)
        n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b; n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def math(self, op, a, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op); n.use_clamp = clamp; self._in(n.inputs[0], a)
        if b is not None: self._in(n.inputs[1], b)
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX', clamp=True):
        n = self.node('ShaderNodeMixRGB', blend_type=blend); n.use_clamp = clamp
        self._in(n.inputs['Fac'], fac); self._in(n.inputs['Color1'], a if not isinstance(a, tuple) else (*a, 1)); self._in(n.inputs['Color2'], b if not isinstance(b, tuple) else (*b, 1))
        return n.outputs['Color']

    def sep(self, vec):
        n = self.node('ShaderNodeSeparateXYZ'); self.L.new(vec, n.inputs[0]); return n.outputs


def paint(name, base, camo=None, camo_scale=0.4, camo_strength=0.75, rough=0.6, metal=0.0, wear=0.4, wear_col=(0.05, 0.05, 0.045),
          grime=0.5, grime_col=(0.05, 0.045, 0.035), mud=0.5, mud_top=1.0, mud_col=(0.10, 0.08, 0.055), dust=0.35, dust_col=(0.36, 0.32, 0.25),
          streaks=0.25, streak_col=None, variation=0.07, fine=0.04, panel=0.035, bevel_r=0.02, ao_dist=0.25, waterline=None, stripes=None,
          scuff=0.25):
    """Physically plausible procedural paint: camo blotches, colour variation, per-panel tint, rain streaks, AO grime,
    chipped edges (Bevel-node edge mask), mud rising from the ground and dust on up-facing surfaces. The final colour is the
    node named BAKE_COLOR so the atlas bake can read it exactly."""
    m = bpy.data.materials.new(name); m.use_nodes = True; b = NB(m); bsdf = b.N['Principled BSDF']
    g = b.geo(); pos = g.outputs['Position']; nrm = g.outputs['Normal']
    col = b.rgb(base)
    if stripes:  # diagonal hazard stripes: (second colour, period in m)
        c2, per = stripes; s = b.math('FRACT', b.math('DIVIDE', b.math('ADD', b.math('ADD', b.sep(pos)['X'], b.sep(pos)['Y']), b.sep(pos)['Z']), per))
        col = b.mix(b.mr(s, 0.49, 0.51), col, c2)
    for i, (c, t) in enumerate(camo or []):
        n = b.noise(pos, camo_scale * (1 + 0.22 * i), detail=2.5, rough=0.55, distort=0.35, w=1.7 + 3.1 * i)
        col = b.mix(b.math('MULTIPLY', b.mr(n, t - 0.006, t + 0.006), camo_strength), col, c)
    # large-scale fade and fine mottling
    v = b.mr(b.noise(pos, 0.35, 2), 0.3, 0.7, 1 - variation, 1 + variation); col = b.mix(1.0, col, v, 'MULTIPLY', clamp=False)
    f = b.mr(b.noise(pos, 22, 3), 0.3, 0.7, 1 - fine, 1 + fine); col = b.mix(1.0, col, f, 'MULTIPLY', clamp=False)
    if panel:  # slightly different paint batches per plate-sized cell
        vo = b.node('ShaderNodeTexVoronoi'); b.L.new(pos, vo.inputs['Vector']); vo.inputs['Scale'].default_value = 0.9
        bw = b.node('ShaderNodeRGBToBW'); b.L.new(vo.outputs['Color'], bw.inputs[0])
        col = b.mix(1.0, col, b.mr(bw.outputs[0], 0.0, 1.0, 1 - panel, 1 + panel), 'MULTIPLY', clamp=False)
    if waterline:  # boats: antifouling below the waterline, dark boot-top band at it
        z = b.sep(pos)['Z']; af, bt = waterline
        col = b.mix(b.mr(z, 0.32, 0.30), col, bt)
        col = b.mix(b.mr(z, -0.10, -0.12), col, af)
    vert = b.math('SUBTRACT', 1.0, b.math('ABSOLUTE', b.sep(nrm)['Z']))
    if streaks:  # vertical rain / rust streaks on vertical faces
        st = b.mr(b.noise(pos, 3.0, 3, stretch=(9, 9, 0.35)), 0.55, 0.75)
        fac = b.math('MULTIPLY', b.math('MULTIPLY', st, vert), streaks)
        col = b.mix(fac, col, streak_col if streak_col else b.mix(1.0, col, (0.6, 0.58, 0.55), 'MULTIPLY'))
    if grime:  # cavity grime from ambient occlusion
        ao = b.node('ShaderNodeAmbientOcclusion'); ao.samples = 8; ao.inputs['Distance'].default_value = ao_dist
        gfac = b.math('MULTIPLY', b.mr(ao.outputs['AO'], 0.95, 0.35), grime, clamp=True)
        gfac = b.math('MULTIPLY', gfac, b.mr(b.noise(pos, 4, 4), 0.25, 0.65, 0.55, 1.0))
        col = b.mix(gfac, col, grime_col)
    wfac = None
    if wear:  # chipped paint on exposed edges
        bv = b.node('ShaderNodeBevel'); bv.samples = 8; bv.inputs['Radius'].default_value = bevel_r
        dp = b.node('ShaderNodeVectorMath', operation='DOT_PRODUCT'); b.L.new(bv.outputs['Normal'], dp.inputs[0]); b.L.new(nrm, dp.inputs[1])
        edge = b.mr(dp.outputs['Value'], 0.995, 0.88)
        br = b.mr(b.noise(pos, 28, 5, 0.6), 0.38, 0.62)
        w0 = b.math('MULTIPLY', b.math('MULTIPLY', edge, br), wear * 2.2, clamp=True)
        if scuff: col = b.mix(b.math('MULTIPLY', b.mr(w0, 0.08, 0.3), scuff), col, b.mix(1.0, col, (1.35, 1.32, 1.25), 'MULTIPLY', clamp=True))
        wfac = b.mr(w0, 0.3, 0.42); col = b.mix(wfac, col, wear_col)
    mfac = None
    if mud:  # mud splashed up from the ground
        z = b.sep(pos)['Z']; h = b.mr(z, mud_top, mud_top * 0.15)
        brk = b.mr(b.noise(pos, 2.2, 6, 0.6), 0.35, 0.62); spl = b.mr(b.noise(pos, 16, 4), 0.55, 0.7)
        mfac = b.math('MULTIPLY', b.math('MAXIMUM', b.math('MULTIPLY', h, brk), b.math('MULTIPLY', b.math('MULTIPLY', h, spl), 0.8)), mud * 1.4, clamp=True)
        col = b.mix(mfac, col, mud_col)
    if dust:  # dust settles on up-facing surfaces; a light overall haze everywhere
        up = b.mr(b.sep(nrm)['Z'], 0.4, 0.95)
        dfac = b.math('MULTIPLY', b.math('MULTIPLY', up, b.mr(b.noise(pos, 1.6, 4), 0.32, 0.68)), dust, clamp=True)
        col = b.mix(dfac, col, dust_col); col = b.mix(dust * 0.10, col, dust_col)
    col.node.name = 'BAKE_COLOR'; col.node.label = 'BAKE_COLOR'
    b.L.new(col, bsdf.inputs['Base Color'])
    rr = b.mr(b.noise(pos, 8, 3), 0.3, 0.7, rough - 0.07, rough + 0.07)
    if wfac is not None: rr = b.mix(wfac, rr, max(0.25, rough - 0.3))
    if mfac is not None: rr = b.mix(mfac, rr, 0.92)
    b.L.new(rr, bsdf.inputs['Roughness'])
    mt = b.mix(wfac, metal, 0.8) if (wfac is not None and metal < 0.5) else None
    if mt is not None: b.L.new(mt, bsdf.inputs['Metallic'])
    else: bsdf.inputs['Metallic'].default_value = metal
    m['bake'] = True; m['rough'] = rough; m['metal'] = metal
    return m


def team_mat():
    m = bpy.data.materials.new('TEAM_ACCENT'); m.use_nodes = True; bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0.214, 0.214, 0.214, 1); bs.inputs['Roughness'].default_value = 0.55
    return m


def glass_mat(name='GLASS', tint=(0.02, 0.03, 0.035)):
    m = bpy.data.materials.new(name); m.use_nodes = True; bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*tint, 1); bs.inputs['Roughness'].default_value = 0.06; bs.inputs['Metallic'].default_value = 0.0
    bs.inputs['Specular IOR Level'].default_value = 0.7; bs.inputs['Coat Weight'].default_value = 0.5
    return m


def glow_mat(name, col, strength=3.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*col, 1); bs.inputs['Roughness'].default_value = 0.3
    bs.inputs['Emission Color'].default_value = (*col, 1); bs.inputs['Emission Strength'].default_value = strength
    return m


def track_mat(name='TRACK', w=512, h=128, links=8):
    """Tileable track texture (U runs along the track, one tile = `links` links), dirt baked into the pixels."""
    import numpy as np
    rng = np.random.default_rng(5)
    u = (np.arange(w) % (w // links)) / (w // links); v = np.arange(h) / h
    U, Vv = np.meshgrid(u, v)
    col = np.zeros((h, w, 3)); col[:] = (0.05, 0.05, 0.047)                               # rubber pads
    steel = (np.abs(U - 0.5) < 0.17) & ((Vv < 0.12) | (Vv > 0.88))                         # end connectors
    guide = (np.abs(U - 0.5) < 0.12) & (np.abs(Vv - 0.5) < 0.05)                           # centre guide
    gap = (U < 0.07) | (U > 0.93)                                                          # link gaps
    grouser = (np.abs(U - 0.5) < 0.08) & (Vv > 0.14) & (Vv < 0.86)
    col[steel] = (0.20, 0.19, 0.18); col[guide] = (0.25, 0.24, 0.22); col[grouser] = (0.09, 0.088, 0.083); col[gap] = (0.015, 0.015, 0.014)
    mud = np.clip(rng.normal(0.0, 1.0, (h, w)), 0, None); mud = np.clip(mud * 0.25 + 0.15 * (np.abs(Vv - 0.5) > 0.3), 0, 0.6)
    col = col * (1 - mud[..., None]) + np.array((0.13, 0.105, 0.075)) * mud[..., None]
    col *= (0.9 + 0.2 * rng.random((h, w)))[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    img = bpy.data.images.new(name + '_tex', w, h); img.pixels = rgba.astype(np.float32).ravel(); img.pack()
    m = bpy.data.materials.new(name); m.use_nodes = True; N = m.node_tree.nodes; bs = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Linear'
    m.node_tree.links.new(t.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.85; bs.inputs['Metallic'].default_value = 0.3
    return m


def land_mats():
    """Shared neutral modern camo for land vehicles (both teams use them; TEAM_ACCENT markings tell them apart)."""
    return {
        'camo': paint('CAMO_PAINT', (0.118, 0.128, 0.080), camo=[((0.052, 0.062, 0.038), 0.56), ((0.215, 0.200, 0.135), 0.63)],
                      camo_scale=0.42, camo_strength=0.85, rough=0.62, metal=0.05, wear=0.55, wear_col=(0.04, 0.04, 0.036),
                      grime=0.6, mud=0.85, mud_top=1.2, mud_col=(0.075, 0.06, 0.042), dust=0.4, streaks=0.35),
        'steel': paint('DARK_STEEL', (0.035, 0.036, 0.034), rough=0.45, metal=0.7, wear=0.55, wear_col=(0.2, 0.19, 0.18), grime=0.4,
                       mud=0.55, mud_top=1.0, dust=0.3, panel=0, streaks=0.1),
        'rubber': paint('RUBBER', (0.022, 0.022, 0.021), rough=0.88, wear=0.12, wear_col=(0.07, 0.065, 0.06), grime=0.3, mud=0.7,
                        mud_top=0.75, mud_col=(0.075, 0.06, 0.042), dust=0.3, panel=0, streaks=0),
        'canvas': paint('CANVAS', (0.115, 0.108, 0.068), rough=0.93, wear=0.0, grime=0.45, mud=0.2, mud_top=1.0, dust=0.5, fine=0.12, panel=0),
        'glass': glass_mat('GLASS_vision'), 'lamp': glow_mat('GLOW_headlight', (1.0, 0.9, 0.72), 1.2),
        'tail': glow_mat('GLOW_taillight', (1.0, 0.06, 0.03), 2.0), 'team': team_mat(),
    }


# ══════════════════════════════════════ output pipeline ══════════════════════════════════════
def collect(name, objs):
    coll = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(coll)
    for o in objs:
        for c in list(o.users_collection): c.objects.unlink(o)
        coll.objects.link(o)
    return coll


def coll_objs(coll):
    return [o for o in coll.all_objects]


def measure(objs):
    dg = bpy.context.evaluated_depsgraph_get(); lo = V((1e9,) * 3); hi = V((-1e9,) * 3); excluded = []; ntri = 0
    for o in objs:
        if o.type != 'MESH': continue
        ev = o.evaluated_get(dg); me = ev.to_mesh(); ntri += sum(len(p.vertices) - 2 for p in me.polygons)
        if o.get('exclude_bounds'): excluded.append(o.name); ev.to_mesh_clear(); continue
        mw = o.matrix_world
        for v in me.vertices:
            w = mw @ v.co; lo = V(map(min, lo, w)); hi = V(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi, ntri, excluded


def finalize_objects(objs):
    """Apply remaining modifiers; rotation/scale are applied on every mesh, location stays only where it is a pivot."""
    for o in objs:
        if o.type == 'MESH' and o.modifiers: lib.apply_all(o)
    for o in objs:
        if o.type == 'MESH':
            if o.rotation_euler != Euler((0, 0, 0)) or tuple(o.scale) != (1, 1, 1):
                print('  ! non-identity transform on', o.name)


def save_blend(name):
    path = os.path.join(OUT['blend'], name + '.blend')
    bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print('saved', path)
    return path


def write_json(name, coll_name_list, spec, notes, extra=None):
    coll = bpy.data.collections[coll_name_list]
    lo, hi, ntri, exc = measure(coll_objs(coll))
    d = {'name': name, 'size_m': [round(hi[i] - lo[i], 4) for i in range(3)], 'min': [round(c, 4) for c in lo], 'max': [round(c, 4) for c in hi],
         'spec_m': spec, 'tris': ntri, 'excluded': exc, 'notes': notes}
    if extra: d.update(extra)
    path = os.path.join(OUT['bounds'], name + '.json')
    with open(path, 'w') as f: json.dump(d, f, indent=2)
    print('json', path, d['size_m'], 'tris', ntri)
    return d


def report(coll, spec):
    lo, hi, ntri, exc = measure(coll_objs(coll)); size = hi - lo
    s = '  size ' + ' x '.join(f'{c:.3f}' for c in size)
    if spec: s += '   spec ' + ' x '.join('-' if c is None else f'{c:.2f}' for c in spec) + '   err% ' + ' '.join('-' if c is None else f'{100 * (size[i] - c) / c:+.2f}' for i, c in enumerate(spec))
    print(s, '  min', tuple(round(c, 3) for c in lo), 'max', tuple(round(c, 3) for c in hi), ' tris', ntri, ' excluded', exc)
    return lo, hi, ntri


# ── preview staging (ground grid, 1.8 m mannequin, camera, lights) ──
def grid_mat():
    m = bpy.data.materials.new('_grid'); m.use_nodes = True; b = NB(m); bs = b.N['Principled BSDF']
    p = b.geo().outputs['Position']; xyz = b.sep(p)
    def lines(step, w):
        out = None
        for ax in ('X', 'Y'):
            fr = b.math('FRACT', b.math('DIVIDE', xyz[ax], step)); d = b.math('ABSOLUTE', b.math('SUBTRACT', fr, 0.5))
            l = b.mr(d, 0.5 - w / step, 0.5 - w / step * 0.5)
            out = l if out is None else b.math('MAXIMUM', out, l)
        return out
    base = b.mix(b.mr(b.noise(p, 0.6, 3), 0.3, 0.7), (0.20, 0.20, 0.19), (0.25, 0.245, 0.235))
    col = b.mix(b.math('MULTIPLY', lines(1.0, 0.012), 0.7), base, (0.07, 0.07, 0.07))
    col = b.mix(b.math('MULTIPLY', lines(5.0, 0.03), 0.85), col, (0.05, 0.05, 0.05))
    b.L.new(col, bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.85
    return m


def mannequin(loc, yaw=0.0):
    """Neutral 1.80 m reference figure."""
    mat = bpy.data.materials.new('_mann'); mat.use_nodes = True; bs = mat.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0.75, 0.74, 0.70, 1); bs.inputs['Roughness'].default_value = 0.5
    parts = []
    for s in (-1, 1):
        parts.append(rod('_leg', (0, s * 0.1, 0.0), (0, s * 0.1, 0.92), 0.075, 10, r2=0.06))
        parts.append(rod('_arm', (0, s * 0.22, 1.45), (0.02, s * 0.25, 0.78), 0.05, 10, r2=0.04))
    parts.append(rod('_torso', (0, 0, 0.88), (0, 0, 1.50), 0.17, 12, r2=0.2))
    parts.append(rod('_neck', (0, 0, 1.48), (0, 0, 1.58), 0.05, 8))
    parts.append(sphere('_head', 0.11, (0, 0, 1.69), scale=(1, 0.9, 1.0), seg=14, rings=8))
    for p in parts: assign(p, mat)
    o = join('_mannequin', parts); apply_tf(o)
    bm = bmesh.new(); bm.from_mesh(o.data); zmin = min(v.co.z for v in bm.verts); zmax = max(v.co.z for v in bm.verts)
    for v in bm.verts: v.co.z = (v.co.z - zmin) * 1.80 / (zmax - zmin)
    bm.to_mesh(o.data); bm.free()
    o.location = loc; o.rotation_euler = (0, 0, yaw)
    return o


def setup_render(samples=32, w=800, h=600, engine='CYCLES'):
    sc = bpy.context.scene; sc.render.engine = engine
    if engine == 'CYCLES': use_gpu(sc)
    sc.render.resolution_x = w; sc.render.resolution_y = h; sc.render.resolution_percentage = 100
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    sc.render.image_settings.file_format = 'PNG'
    if engine == 'CYCLES':
        use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_adaptive_sampling = True
        sc.cycles.use_denoising = True
        try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        except Exception as ex: print('denoiser', ex)
        sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 2; sc.cycles.transparent_max_bounces = 4
    try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    return sc


def stage_scene(ground_z=0.0, ground_size=(60, 60), sun=(48, 0, -40)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('_world'); sc.world = w; w.use_nodes = True; bg = w.node_tree.nodes['Background']
    sky = w.node_tree.nodes.new('ShaderNodeTexSky')
    try:
        sky.sky_type = 'HOSEK_WILKIE'; sky.sun_direction = Euler((R(90 - sun[0]), 0, R(sun[2]))).to_matrix() @ V((0, 0, 1)); sky.turbidity = 3.0
        w.node_tree.links.new(sky.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 0.45
    except Exception as ex:
        print('sky fallback', ex); bg.inputs[0].default_value = (0.5, 0.6, 0.75, 1); bg.inputs[1].default_value = 0.8
    sl = bpy.data.lights.new('_sun', 'SUN'); sl.energy = 3.2; sl.angle = R(2.5); so = bpy.data.objects.new('_sun', sl); lib.link(so)
    so.rotation_euler = Euler((R(90 - sun[0]), 0, R(sun[2] + 90)))
    g = box('_ground', (ground_size[0], ground_size[1], 0.02), (0, 0, ground_z - 0.01)); assign(g, grid_mat())
    return [so, g]


def frame_camera(lo, hi, azim=-55, elev=24, lens=50, margin=1.08, w=800, h=600, target=None):
    sc = bpy.context.scene
    cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam')); lib.link(cam); cam.data.lens = lens; sc.camera = cam
    c = (lo + hi) / 2 if target is None else V(target)
    a, e = R(azim), R(elev); d = V((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    rot = (-d).to_track_quat('-Z', 'Y'); cam.rotation_euler = rot.to_euler()
    # fit: project the 8 corners into the camera frame and solve for distance
    fov_h = 2 * math.atan(18 / lens); fov_v = 2 * math.atan(math.tan(fov_h / 2) * h / w)
    corners = [V((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    Rm = rot.to_matrix(); best = 0
    for p in corners:
        q = Rm.transposed() @ (p - c)  # camera space, -Z forward
        best = max(best, abs(q.x) / math.tan(fov_h / 2) + q.z, abs(q.y) / math.tan(fov_v / 2) + q.z)
    cam.location = c + d * best * margin
    cam.data.clip_end = 1000
    return cam


def render_preview(coll, path, azim=-55, elev=24, man_loc=None, ground_z=None, extra=None, w=800, h=600, samples=32, ground=(60, 60), target=None, margin=1.08):
    t0 = time.time(); setup_render(samples, w, h)
    lo, hi, _, _ = measure(coll_objs(coll))
    gz = lo.z if ground_z is None else ground_z
    staged = stage_scene(gz, ground)
    if man_loc is not None:
        mn = mannequin(V(man_loc), yaw=R(azim) + math.pi); staged.append(mn)
        lo = V(map(min, lo, mn.location - V((0.3, 0.3, 0)))); hi = V(map(max, hi, mn.location + V((0.3, 0.3, 1.8))))
    if extra: staged += extra
    cam = frame_camera(lo, hi, azim, elev, w=w, h=h, target=target, margin=margin); staged.append(cam)
    # preview only: show TEAM_ACCENT in the blue team colour (#2B6FD6) so the markings are visible; the saved .blend keeps mid grey
    tm = bpy.data.materials.get('TEAM_ACCENT'); old = None
    if tm: bs = tm.node_tree.nodes['Principled BSDF']; old = tuple(bs.inputs['Base Color'].default_value); bs.inputs['Base Color'].default_value = (0.024, 0.159, 0.672, 1)
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)
    if tm: bs.inputs['Base Color'].default_value = old
    for o in staged:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    print('preview', path, f'{time.time() - t0:.0f}s')


def check_views(coll, path, w=1500, h=420):
    """Cheap Workbench orthographic side / front / top views side by side (proportion check)."""
    import numpy as np
    sc = setup_render(1, w // 3, h, 'BLENDER_WORKBENCH')
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'; sc.display.shading.show_cavity = True
    sc.display.shading.show_object_outline = True
    lo, hi, _, _ = measure(coll_objs(coll)); allo = [o for o in coll_objs(coll)]
    hidden = [o for o in bpy.context.scene.objects if o not in allo and not o.hide_render]
    for o in hidden: o.hide_render = True
    lo2 = V(lo); hi2 = V(hi)
    for o in allo:  # include excluded objects in the framing
        if o.type == 'MESH':
            for c in o.bound_box:
                w_ = o.matrix_world @ V(c); lo2 = V(map(min, lo2, w_)); hi2 = V(map(max, hi2, w_))
    c = (lo2 + hi2) / 2; span = max(hi2 - lo2) * 1.08
    imgs = []
    for k, (d, up) in enumerate(((V((0, -1, 0)), V((0, 0, 1))), (V((1, 0, 0)), V((0, 0, 1))), (V((0, 0, 1)), V((1, 0, 0))))):
        cam = bpy.data.objects.new('_ocam', bpy.data.cameras.new('_ocam')); lib.link(cam); cam.data.type = 'ORTHO'; cam.data.ortho_scale = span
        cam.location = c + d * 100; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler() if k < 2 else Euler((0, 0, 0)); cam.data.clip_end = 500
        sc.camera = cam; p = path.replace('.png', f'_{k}.png'); sc.render.filepath = p; bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(p); a = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4); imgs.append(a); bpy.data.images.remove(img); os.remove(p)
        bpy.data.objects.remove(cam, do_unlink=True)
    for o in hidden: o.hide_render = False
    out = np.concatenate(imgs, axis=1); im = bpy.data.images.new('_chk', out.shape[1], out.shape[0]); im.pixels = out.ravel(); im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    print('check', path)


# ── atlas bake + glb ──
def bake_atlas(objs, name, size=1024, samples=16):
    """EMIT-bake every procedural 'bake' material (its BAKE_COLOR node) into one atlas; replace them with one textured
    material (per-material roughness/metal kept as constants). TEAM_ACCENT -> TEAM, GLOW*/GLASS*/TRACK stay unbaked."""
    t0 = time.time(); sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 2; sc.cycles.use_denoising = False
    bo = [o for o in objs if o.type == 'MESH' and any(m and m.get('bake') for m in o.data.materials)]
    img = bpy.data.images.new(name + '_atlas', size, size, alpha=False); img.colorspace_settings.name = 'sRGB'
    dummy = bpy.data.images.new('_dummy', 4, 4)
    for o in bo:
        for uvl in list(o.data.uv_layers): o.data.uv_layers.remove(uvl)
        o.data.uv_layers.new(name='UVMap')
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in bo: o.select_set(True)
    bpy.context.view_layer.objects.active = bo[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=R(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
    try: bpy.ops.uv.pack_islands(margin=0.003, rotate=True, shape_method='CONVEX')
    except TypeError: bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    mats = {m.name: m for o in bo for m in o.data.materials if m}
    for m in mats.values():
        nt = m.node_tree; t = nt.nodes.new('ShaderNodeTexImage')
        if m.get('bake'):
            t.image = img; out = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'][0]
            em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(nt.nodes['BAKE_COLOR'].outputs[0], em.inputs['Color'])
            nt.links.new(em.outputs[0], out.inputs['Surface'])
        else: t.image = dummy
        nt.nodes.active = t
    bpy.ops.object.bake(type='EMIT', margin=6, use_clear=True)
    img.pack()
    # at most four atlas materials (rough/smooth x metal/non-metal buckets) sharing the one texture, to keep web draw calls low
    def bucket(m): return (m['rough'] >= 0.7, m['metal'] >= 0.3)
    groups = {}
    for nm, m in mats.items():
        if m.get('bake'): groups.setdefault(bucket(m), []).append(m)
    baked = {}
    for k, (key, ms) in enumerate(sorted(groups.items(), key=lambda kv: -len(kv[1]))):
        om = bpy.data.materials.new(f'{name}_atlas' if k == 0 else f'{name}_atlas_{k}'); om.use_nodes = True; bs = om.node_tree.nodes['Principled BSDF']
        t = om.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img; om.node_tree.links.new(t.outputs['Color'], bs.inputs['Base Color'])
        bs.inputs['Roughness'].default_value = sum(m['rough'] for m in ms) / len(ms); bs.inputs['Metallic'].default_value = sum(m['metal'] for m in ms) / len(ms)
        baked[key] = om
    for o in bo:
        for i, m in enumerate(o.data.materials):
            if m and m.get('bake'): o.data.materials[i] = baked[bucket(m)]
    if 'TEAM_ACCENT' in bpy.data.materials: bpy.data.materials['TEAM_ACCENT'].name = 'TEAM'
    print(f'baked atlas {name} {size}px in {time.time() - t0:.0f}s, {len(baked)} atlas materials')
    return img


def export_glb(name, objs):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    path = os.path.join(OUT['glb'], name + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True,
              export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_extras=True, export_animations=False)
    try: bpy.ops.export_scene.gltf(**kw, export_image_quality=90)
    except TypeError:
        try: bpy.ops.export_scene.gltf(**kw, export_jpeg_quality=90)
        except TypeError: bpy.ops.export_scene.gltf(**kw)
    print('glb', path, os.path.getsize(path) // 1024, 'KB')
    return path


def finish(name, coll_names, spec, notes, extra=None, preview_kw=None, args=None, json_names=None, preview_fn=None):
    """Common tail: measure, save .blend, preview, bake + glb, json."""
    for cn in coll_names: finalize_objects(coll_objs(bpy.data.collections[cn]))
    for cn in coll_names: report(bpy.data.collections[cn], spec if cn == name else None)
    save_blend(name)
    if args.check:
        for cn in coll_names: check_views(bpy.data.collections[cn], os.path.join(CHECK_DIR, f'_check_{cn}.png'))
    if not args.no_preview:
        if preview_fn: preview_fn()
        else: render_preview(bpy.data.collections[name], os.path.join(OUT['preview'], name + '.png'), **(preview_kw or {}))
    infos = {}
    for cn in coll_names:
        infos[cn] = write_json(cn, cn, spec if cn == name else (json_names or {}).get(cn, {}).get('spec'), notes if cn == name else (json_names or {}).get(cn, {}).get('notes', notes),
                               extra if cn == name else (json_names or {}).get(cn, {}).get('extra'))
    if args.glb:
        allobjs = [o for cn in coll_names for o in coll_objs(bpy.data.collections[cn])]
        bake_atlas(allobjs, name)
        for cn in coll_names: export_glb(cn, coll_objs(bpy.data.collections[cn]))
    return infos


# ══════════════════════════════════════ running gear ══════════════════════════════════════
def track_loop_outline(circles, step=0.09):
    """Outer track outline (x, z) as the convex hull of wheel circles (x, z, r_outer), resampled evenly, CCW."""
    pts = []
    for x, z, r in circles:
        for i in range(48): a = 2 * math.pi * i / 48; pts.append((round(x + r * math.cos(a), 5), round(z + r * math.sin(a), 5)))
    hull = convex_hull_2d(pts)
    return resample_loop(hull, step)


def track_ribbon(name, outline, y0, y1, thick, mat, link=0.17, links_per_tile=8):
    """Closed track belt with thickness; U runs along the belt (one tile = links_per_tile links) so the game can scroll it."""
    n = len(outline); cx = sum(p[0] for p in outline) / n; cz = sum(p[1] for p in outline) / n
    inner = []
    for i in range(n):
        p0, p1, p2 = V(outline[i - 1]), V(outline[i]), V(outline[(i + 1) % n])
        t = (p2 - p0).normalized(); nn = V((-t.y, t.x))
        if nn.dot(V((cx, cz)) - p1) < 0: nn = -nn
        inner.append(p1 + nn * thick)
    s = [0.0]
    for i in range(1, n + 1): s.append(s[-1] + (V(outline[i % n]) - V(outline[i - 1])).length)
    tile = link * links_per_tile
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    oA = [bm.verts.new((p[0], y0, p[1])) for p in outline]; oB = [bm.verts.new((p[0], y1, p[1])) for p in outline]
    iA = [bm.verts.new((p.x, y0, p.y)) for p in inner]; iB = [bm.verts.new((p.x, y1, p.y)) for p in inner]
    def quad(vs, uvs):
        f = bm.faces.new(vs)
        for lp, c in zip(f.loops, uvs): lp[uv].uv = c
    for i in range(n):
        j = (i + 1) % n; u0, u1 = s[i] / tile, s[i + 1] / tile
        quad((oA[i], oA[j], oB[j], oB[i]), ((u0, 0.0), (u1, 0.0), (u1, 1.0), (u0, 1.0)))       # outer (ground) face
        quad((iB[i], iB[j], iA[j], iA[i]), ((u0, 1.0), (u1, 1.0), (u1, 0.0), (u0, 0.0)))       # inner face
        quad((iA[i], iA[j], oA[j], oA[i]), ((u0, 0.02), (u1, 0.02), (u1, 0.0), (u0, 0.0)))     # side edges -> end connectors
        quad((oB[i], oB[j], iB[j], iB[i]), ((u0, 1.0), (u1, 1.0), (u1, 0.98), (u0, 0.98)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = lib.mesh_obj(name, bm); o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = False
    return o


def road_wheel(name, x, y, z, r, width, M_, seg=14):
    """Double road wheel: rubber tyres, dished rim, hub cap. Built around the Y axis."""
    hw = width / 2
    prof = [(0.0, -hw), (r * 0.86, -hw), (r, -hw + 0.03), (r, hw - 0.03), (r * 0.86, hw), (r * 0.62, hw - 0.05), (r * 0.30, hw - 0.04), (r * 0.30, hw + 0.03), (0.0, hw + 0.03)]
    w = lathe(name, prof, seg, 'Y', (x, y, z))
    if y < 0:  # mirror so the hub faces outward on the right side too
        for v in w.data.vertices: v.co.y = -v.co.y
        w.data.flip_normals()
    assign(w, M_['camo']); faces_mat(w, M_['rubber'], lambda c, n: math.hypot(c.x, c.z) > r * 0.86)
    return w


# ══════════════════════════════════════ 1. MAIN BATTLE TANK ══════════════════════════════════════
def build_mbt(args):
    lib.reset(); random.seed(11); Mt = land_mats(); camo, steel, rubber, canvas, glass, team = Mt['camo'], Mt['steel'], Mt['rubber'], Mt['canvas'], Mt['glass'], Mt['team']
    trk = track_mat()
    HX = 3.75; HW = 1.80; DECK = 1.55
    # ── hull body ──
    H = []
    H.append(M(profile_extrude('lower', [(-3.70, 1.14), (-3.45, 0.50), (3.10, 0.50), (HX, 1.14)], 2.16, bevel=0.03, seg=1), camo))
    H.append(M(profile_extrude('upper', [(-HX, 1.12), (HX, 1.12), (HX, 1.24), (2.35, DECK), (-3.50, DECK), (-HX, 1.38)], 3.44, bevel=0.025, seg=1), camo))
    gl = math.atan2(DECK - 1.24, HX - 2.35)  # glacis angle
    def on_glacis(x): return 1.24 + (HX - x) * math.tan(gl)
    # add-on glacis armour with a seam, splash board
    for s in (-1, 1): H.append(M(box('glacis_plate', (1.25, 1.55, 0.05), ((HX + 2.35) / 2 - 0.02, s * 0.80, on_glacis((HX + 2.35) / 2) + 0.03), (0, gl, 0), bevel=0.012, seg=1), camo))
    H.append(M(box('splash', (0.05, 2.2, 0.09), (2.95, 0, on_glacis(2.95) + 0.08), (0, gl, 0), bevel=0.01, seg=1), camo))
    # driver's hatch + periscopes
    H.append(M(cyl('drv_hatch', 0.30, 0.05, (2.05, -0.62, DECK + 0.02), verts=20, bevel=0.012, seg=1), camo))
    H.append(M(box('drv_hinge', (0.12, 0.30, 0.05), (1.78, -0.62, DECK + 0.03), bevel=0.01, seg=1), steel))
    for i in range(3):
        p = box(f'peri{i}', (0.10, 0.16, 0.07), (2.42, -0.62 + (i - 1) * 0.19, on_glacis(2.42) + 0.035), (0, gl - 0.35, (i - 1) * 0.25), bevel=0.01, seg=1)
        assign(p, steel); faces_mat(p, glass, lambda c, n: n.x > 0.6); H.append(p)
    # headlight clusters with guards, front tow hooks, front mudguards
    for s in (-1, 1):
        hz = on_glacis(3.50)
        hb = box('lamp_box', (0.16, 0.30, 0.13), (3.48, s * 1.45, hz + 0.07), bevel=0.012, seg=1); assign(hb, steel)
        for k in (-1, 1):
            l = cyl('lamp', 0.045, 0.03, (3.565, s * 1.45 + k * 0.075, hz + 0.08), (0, R(90), 0), verts=12); assign(l, Mt['lamp']); H.append(l)
        H.append(hb)
        for k in (-1, 1): H.append(M(rod('lguard', (3.40, s * 1.45 + k * 0.17, hz + 0.02), (3.62, s * 1.45 + k * 0.17, hz + 0.2), 0.012, 6), steel))
        H.append(M(rod('lguard_t', (3.62, s * 1.45 - 0.17, hz + 0.2), (3.62, s * 1.45 + 0.17, hz + 0.2), 0.012, 6), steel))
        H.append(M(box('hook', (0.14, 0.09, 0.14), (3.60, s * 0.72, 0.98), (0, R(-45), 0), bevel=0.02, seg=1), steel))
        H.append(M(box('mudguard', (0.42, 0.60, 0.03), (3.52, s * 1.42, 1.08), (0, R(28), 0), bevel=0.008, seg=1), camo))
        H.append(M(box('rear_hook', (0.14, 0.09, 0.14), (-3.62, s * 0.80, 0.98), (0, R(45), 0), bevel=0.02, seg=1), steel))
        tl = box('taillight', (0.04, 0.14, 0.08), (-3.725, s * 1.50, 1.30), bevel=0.006, seg=1); assign(tl, Mt['tail']); H.append(tl)
        H.append(M(box('tl_guard', (0.05, 0.22, 0.14), (-3.70, s * 1.50, 1.30), bevel=0.006, seg=1), steel))
    # engine deck: two louvred grille panels a side, access panels, lifting eyes
    for s in (-1, 1):
        for x0 in (-3.0, -2.05):
            H.append(M(box('grille_frame', (0.85, 0.95, 0.05), (x0, s * 0.62, DECK + 0.025), bevel=0.01, seg=1), camo))
            sl = box('slat', (0.035, 0.85, 0.03), (x0 - 0.36, s * 0.62, DECK + 0.055)); lib.array(sl, 7, (0.115, 0, 0)); assign(sl, steel); H.append(sl)
        H.append(M(box('acc_panel', (0.9, 0.42, 0.03), (-1.35, s * 1.25, DECK + 0.015), bevel=0.008, seg=1), camo))
        H.append(M(box('lift_eye', (0.10, 0.04, 0.10), (3.25, s * 1.62, on_glacis(3.25) + 0.04), (0, gl, 0), bevel=0.012, seg=1), steel))
        H.append(M(box('lift_eye', (0.10, 0.04, 0.10), (-3.30, s * 1.62, DECK + 0.04), bevel=0.012, seg=1), steel))
        # stowage bins on the rear corners
        H.append(M(box('bin', (0.80, 0.42, 0.30), (-3.10, s * 1.47, DECK + 0.15), bevel=0.02, seg=1), camo))
        H.append(M(box('bin_lid', (0.82, 0.44, 0.03), (-3.10, s * 1.47, DECK + 0.315), bevel=0.01, seg=1), camo))
        H.append(M(box('bin_latch', (0.05, 0.03, 0.06), (-3.10, s * 1.695, DECK + 0.24)), steel))
        # tool rack along the sponson edge
        H.append(M(rod('tow_cable', (-1.9, s * 1.70, DECK + 0.03), (1.6, s * 1.70, DECK + 0.03), 0.028, 6), steel))
        for x in (-1.5, 0.0, 1.2): H.append(M(box('clamp', (0.05, 0.08, 0.07), (x, s * 1.70, DECK + 0.03)), steel))
    # rear plate: exhaust louvres, tow pintle, jerry-can rack
    for s in (-1, 1):
        H.append(M(box('exh_frame', (0.06, 0.95, 0.24), (-3.72, s * 0.62, 1.25), bevel=0.01, seg=1), steel))
        ex = box('exh_slat', (0.03, 0.9, 0.025), (-3.73, s * 0.62, 1.16)); lib.array(ex, 4, (0, 0, 0.06)); assign(ex, steel); H.append(ex)
    H.append(M(box('pintle', (0.16, 0.22, 0.12), (-3.66, 0, 0.88), bevel=0.02, seg=1), steel))
    # TEAM_ACCENT tactical markings on the front and rear plates
    H.append(M(box('mark_f', (0.006, 0.36, 0.08), (HX - 0.004, 0.75, 1.18)), team))
    H.append(M(box('mark_r', (0.006, 0.36, 0.08), (-HX + 0.004, 1.45, 1.25)), team))
    # skirts: three heavy composite modules + five light plates per side, slanted front edge
    for s in (-1, 1):
        xs = [(3.55, 2.57), (2.55, 1.57), (1.55, 0.57)]
        for k, (xa, xb) in enumerate(xs):
            tp = {'bot_front': (-0.32, 0, 0)} if k == 0 else None
            H.append(M(box('skirt_h', (xa - xb, 0.10, 0.78), ((xa + xb) / 2, s * 1.738, 0.91), bevel=0.015, seg=1, taper=tp), camo))
            for bx in (xb + 0.12, xa - 0.12 if k else xa - 0.30):
                for bz in (1.20,):
                    H.append(M(cyl('bolt', 0.026, 0.024, (bx, s * 1.788, bz), (R(90), 0, 0), verts=6), steel))
        for k in range(5):
            xa = 0.55 - k * 0.82; xb = xa - 0.80
            H.append(M(box('skirt_l', (xa - xb, 0.065, 0.74), ((xa + xb) / 2, s * 1.7675, 0.93), bevel=0.01, seg=1), camo))
            H.append(M(box('skirt_flap', (xa - xb - 0.04, 0.02, 0.12), ((xa + xb) / 2, s * 1.745, 0.52)), rubber))
    hull = make('hull', H, camo, pivot=(0, 0, 0))

    # ── running gear ──
    yt = 1.40; tw = 0.60; wz = 0.42; wr = 0.34
    xs_rw = [2.45 - i * 0.83 for i in range(7)]
    circles = [(3.18, 0.62, 0.32 + 0.08), (-3.22, 0.66, 0.36 + 0.08), (xs_rw[0], wz, wr + 0.08), (xs_rw[-1], wz, wr + 0.08)]
    loop = track_loop_outline(circles, 0.125)
    gear = []
    for s, sd in ((1, 'L'), (-1, 'R')):
        t = track_ribbon(f'track_{sd}', loop, s * yt - tw / 2, s * yt + tw / 2, 0.08, trk); parent(t, hull); gear.append(t)
        for i, x in enumerate(xs_rw):
            w = road_wheel(f'wheel_{sd}{i}', x, s * yt, wz, wr, 0.52, Mt); gear.append(make(f'wheel_{sd}{i}', [w], pivot=(x, s * yt, wz), par=hull))
        # sprocket (rear): two toothed rings and a hub
        sp = []
        for k in (-1, 1):
            star = []
            for i in range(28):
                a = 2 * math.pi * i / 28; rr = 0.37 if (i % 2 == 0) else 0.31
                star.append((-3.22 + rr * math.cos(a), 0.66 + rr * math.sin(a)))
            ring = loft('spr_ring', [[V((x, s * yt + k * 0.17 - 0.045, z)) for x, z in star], [V((x, s * yt + k * 0.17 + 0.045, z)) for x, z in star]])
            assign(ring, steel); sp.append(ring)
        sp.append(M(cyl('spr_hub', 0.24, 0.44, (-3.22, s * yt, 0.66), (R(90), 0, 0), verts=16, bevel=0.02, seg=1), camo))
        sp.append(M(cyl('spr_cap', 0.12, 0.56, (-3.22, s * yt, 0.66), (R(90), 0, 0), verts=10), steel))
        gear.append(make(f'wheel_{sd}_sprocket', sp, pivot=(-3.22, s * yt, 0.66), par=hull))
        idl = road_wheel(f'wheel_{sd}_idler', 3.18, s * yt, 0.62, 0.32, 0.50, Mt); assign(idl, steel)
        gear.append(make(f'wheel_{sd}_idler', [idl], pivot=(3.18, s * yt, 0.62), par=hull))
        for i, x in enumerate((1.75, 0.0, -1.75)):
            rr_ = cyl(f'ret{i}', 0.11, 0.30, (x, s * (yt - 0.08), 0.85), (R(90), 0, 0), verts=10); assign(rr_, rubber)
            gear.append(make(f'wheel_{sd}_ret{i}', [rr_], pivot=(x, s * (yt - 0.08), 0.85), par=hull))
    # ── turret ──
    TX = 0.25; TZ0 = 1.63; TZ1 = 2.09; TZT = 2.46
    half = [(1.40, 0.42), (2.00, 0.44), (1.05, 1.58), (-1.35, 1.60), (-2.05, 1.45), (-2.25, 1.12)]
    outline = [(-2.25, 0.0)] + [(x, -y) for x, y in reversed(half)] + [(x, y) for x, y in half]
    def ring(z, xin, ys, ztop=None):
        pts = []
        for x, y in outline:
            xx = x; yy = y; zz = z
            if x > 1.0 and abs(y) > 0.43: xx = x - xin * min(1, (x - 1.0) / 1.0);
            if abs(y) > 1.0: yy = y * ys
            if ztop is not None and x > 1.0 and abs(y) > 0.43: zz = ztop
            pts.append(V((xx, yy, zz)))
        return pts
    shell = loft('turret_shell', [ring(TZ0, 0.30, 0.975), ring(TZ1, 0.0, 1.0), ring(TZT, 0.48, 0.94, ztop=2.36)])
    lib.bev(shell, 0.02, 1); assign(shell, camo)
    T = [shell]
    T.append(M(cyl('ring_collar', 1.02, 0.14, (TX, 0, 1.60), verts=28), steel))
    # gunner's primary sight "doghouse" flush with the 2.50 m roof line
    gs = box('gsight', (0.52, 0.42, 0.40), (1.32, -0.82, 2.30), bevel=0.02, seg=1, taper={'top_front': (-0.10, 0, 0)}); assign(gs, camo)
    faces_mat(gs, glass, lambda c, n: n.x > 0.5); T.append(gs)
    for k in (-1, 1): T.append(M(box('gs_door', (0.04, 0.17, 0.26), (1.60, -0.82 + k * 0.105, 2.26), bevel=0.006, seg=1), camo))
    # loader's hatch, roof plates, NBC vent, lifting eyes (all <= 2.50)
    T.append(M(cyl('ld_hatch', 0.36, 0.045, (-0.35, 0.72, 2.4775), verts=22, bevel=0.012, seg=1), camo))
    T.append(M(box('ld_hinge', (0.12, 0.28, 0.04), (-0.74, 0.72, 2.48), bevel=0.008, seg=1), steel))
    T.append(M(box('roof_plate', (1.3, 1.1, 0.025), (-1.35, 0.0, 2.4725), bevel=0.01, seg=1), camo))
    T.append(M(box('nbc', (0.40, 0.34, 0.04), (-1.75, 0.55, 2.48), bevel=0.012, seg=1), camo))
    for x, y in ((0.65, 1.30), (0.65, -1.30), (-1.85, 1.25), (-1.85, -1.25)): T.append(M(box('t_eye', (0.10, 0.04, 0.04), (x, y, 2.48), bevel=0.01, seg=1), steel))
    # smoke dischargers: 2x2 tubes each side, aimed forward/out/up
    for s in (-1, 1):
        T.append(M(box('sm_bracket', (0.42, 0.10, 0.22), (0.72, s * 1.60, 2.20), bevel=0.01, seg=1), camo))
        for i in range(2):
            for j in range(2):
                d = V((0.75, s * 0.55, 0.35)).normalized(); a0 = V((0.60 + i * 0.2, s * 1.58, 2.14 + j * 0.11))
                tb = rod('sm_tube', a0, a0 + d * 0.24, 0.048, 8); assign(tb, steel); T.append(tb)
    # side stowage boxes with a TEAM_ACCENT stripe, turret number
    side_y = 1.60; slope = math.atan2(1.60 * (1 - 0.94), TZT - TZ1)
    for s in (-1, 1):
        T.append(M(box('t_box', (1.10, 0.20, 0.50), (-0.80, s * 1.66, 2.06), bevel=0.02, seg=1), camo))
        T.append(M(box('t_box_lid', (1.12, 0.22, 0.03), (-0.80, s * 1.66, 2.32), bevel=0.01, seg=1), camo))
        T.append(M(box('team_band', (1.10, 0.012, 0.12), (-0.80, s * 1.765, 2.12)), team))
        num = text_mesh('num', '21', 0.26)
        num.rotation_euler = (R(90) - slope, 0, 0 if s < 0 else math.pi); num.location = (0.18, s * 1.566, 2.25)
        assign(num, team); T.append(num)
    # bustle stowage basket (rails), bags and a tarp roll
    bx0, bx1, by, bz0, bz1 = -2.25, -2.68, 1.32, 1.86, 2.40
    T.append(M(box('basket_floor', (bx0 - bx1, 2 * by, 0.03), ((bx0 + bx1) / 2, 0, bz0), bevel=0.005, seg=1), steel))
    for z in (bz0 + 0.24, bz1):
        T.append(M(rod('rail', (bx1, -by, z), (bx1, by, z), 0.02, 6), steel))
        for s in (-1, 1): T.append(M(rod('rail', (bx0, s * by, z), (bx1, s * by, z), 0.02, 6), steel))
    for y in (-by, -0.45, 0.45, by): T.append(M(rod('post', (bx1, y, bz0), (bx1, y, bz1 + 0.02), 0.02, 6), steel))
    for s in (-1, 1): T.append(M(rod('post', (bx0 - 0.02, s * by, bz0), (bx0 - 0.02, s * by, bz1 + 0.02), 0.02, 6), steel))
    for y, sx in ((-0.85, 0.38), (0.0, 0.40), (0.82, 0.36)):
        bg = box('bag', (sx, 0.62, 0.36), (-2.46, y, bz0 + 0.20), bevel=0.07, seg=1); assign(bg, canvas); T.append(bg)
    T.append(M(cyl('tarp', 0.12, 2.3, (-2.46, 0, 2.30), (R(90), 0, 0), verts=12, bevel=0.03, seg=1), canvas))
    turret = make('turret', T, camo, pivot=(TX, 0, DECK), par=hull)
    # ── gun: mantlet, sleeved 120 mm barrel, bore evacuator, muzzle reference sensor ──
    GZ = 2.05; GX = 1.40; MX = 5.75
    G = []
    mant = box('mantlet', (0.60, 0.80, 0.52), (1.55, 0, GZ), bevel=0.03, seg=1, taper={'top_front': (-0.06, 0, -0.03), 'bot_front': (-0.06, 0, 0.03)}); assign(mant, camo); G.append(mant)
    G.append(M(cyl('coax', 0.035, 0.06, (1.85, 0.25, GZ - 0.08), (0, R(90), 0), verts=10), steel))
    def bar(a, b, r, r2=None, verts=18, mat=camo): o = cyl('barrel', r, b - a, ((a + b) / 2, 0, GZ), (0, R(90), 0), verts=verts, r2=r2); assign(o, mat); return o
    G.append(bar(1.84, 2.06, 0.16, 0.15)); G.append(bar(2.06, 3.22, 0.115)); G.append(bar(3.22, 3.36, 0.115, 0.15))
    G.append(bar(3.36, 3.92, 0.15)); G.append(bar(3.92, 4.06, 0.15, 0.106)); G.append(bar(4.06, 5.47, 0.106))
    for x in (2.62, 3.12, 4.55, 5.05): G.append(bar(x - 0.02, x + 0.02, 0.124, verts=18, mat=steel))
    mz = lathe('muzzle_end', [(0.104, 0.0), (0.104, 0.30), (0.062, 0.30), (0.062, 0.12)], 18, 'Z', (0, 0, 0), cap_axis=False)
    mz.rotation_euler = (0, R(90), 0); mz.location = (MX - 0.30, 0, GZ); assign(mz, steel); G.append(mz)
    G.append(M(box('mrs', (0.12, 0.06, 0.07), (5.56, 0, GZ + 0.135), bevel=0.01, seg=1), steel))
    gun = make('gun', G, camo, pivot=(GX, 0, GZ), par=turret)
    mzl = empty('muzzle', (MX, 0, GZ), gun)
    # ── excluded roof kit: commander's cupola + MG + panoramic sight, two antennas ──
    C = []; cx, cy = -0.30, -0.74
    cup = cyl('cupola', 0.40, 0.20, (cx, cy, 2.54), verts=24, bevel=0.02, seg=1); assign(cup, camo); C.append(cup)
    for i in range(7):
        a = R(-60 + i * 40); vb = box('vblock', (0.05, 0.13, 0.07), (cx + 0.395 * math.cos(a), cy + 0.395 * math.sin(a), 2.57), (0, 0, a)); assign(vb, glass); C.append(vb)
    C.append(M(cyl('c_hatch', 0.33, 0.06, (cx - 0.04, cy, 2.67), verts=22, bevel=0.015, seg=1), camo))
    C.append(M(cyl('peri_base', 0.12, 0.16, (cx + 0.26, cy + 0.18, 2.70), verts=14), camo))
    ph = box('peri_head', (0.30, 0.26, 0.24), (cx + 0.26, cy + 0.18, 2.89), bevel=0.02, seg=1); assign(ph, camo); faces_mat(ph, glass, lambda c, n: n.x > 0.5); C.append(ph)
    C.append(M(rod('mg_post', (cx - 0.25, cy - 0.2, 2.62), (cx - 0.25, cy - 0.2, 2.86), 0.03, 8), steel))
    C.append(M(box('mg_body', (0.50, 0.09, 0.12), (cx - 0.05, cy - 0.2, 2.90), bevel=0.01, seg=1), steel))
    C.append(M(rod('mg_barrel', (cx + 0.2, cy - 0.2, 2.92), (cx + 0.78, cy - 0.2, 2.92), 0.016, 8), steel))
    C.append(M(box('mg_stock', (0.16, 0.05, 0.08), (cx - 0.37, cy - 0.2, 2.88), bevel=0.01, seg=1), steel))
    C.append(M(box('mg_ammo', (0.16, 0.12, 0.14), (cx - 0.05, cy - 0.11, 2.82), bevel=0.01, seg=1), camo))
    cupola = make('cupola_mg', C, camo, pivot=(cx, cy, 2.46), par=turret); cupola['exclude_bounds'] = True
    ants = []
    for s, sd in ((1, 'L'), (-1, 'R')):
        ax, ay = -1.95, s * 1.12
        a = [M(box('ant_base', (0.14, 0.14, 0.10), (ax, ay, 2.51), bevel=0.015, seg=1), steel), M(cyl('ant_spring', 0.025, 0.14, (ax, ay, 2.62), verts=8), steel),
             M(rod('ant_whip', (ax, ay, 2.68), (ax - 0.30, ay, 5.00), 0.008, 5, r2=0.004), steel)]
        o = make(f'antenna_{sd}', a, steel, pivot=(ax, ay, 2.46), par=turret); o['exclude_bounds'] = True; ants.append(o)
    objs = [hull, turret, gun, mzl, cupola, *ants, *gear]
    coll = collect('unit_mbt', objs)
    nodes = sorted(o.name for o in objs)
    lo, hi, ntri, exc = measure(objs)
    hull_parts = [o for o in objs if o.name not in ('turret', 'gun', 'muzzle', 'cupola_mg', 'antenna_L', 'antenna_R')]
    hlo, hhi, _, _ = measure(hull_parts); tlo, thi, _, _ = measure([turret])
    print(f'  hull+tracks {hhi.x - hlo.x:.3f} x {hhi.y - hlo.y:.3f}   turret roof z {thi.z:.3f}   gun-forward total {hi.x - lo.x:.3f}')
    notes = ('Neutral modern camo (grey-green / sand-grey disruptive), TEAM_ACCENT turret stripe, turret number "21" and front/rear plates. '
             'Commander cupola + MG + panoramic sight (cupola_mg) and both whip antennas stand above the 2.50 m roof and carry exclude_bounds. '
             'Pivots: turret at the ring (0.25, 0, 1.55), gun at the trunnion (1.40, 0, 2.05), wheels at their axles; muzzle empty at (5.75, 0, 2.05). '
             'track_L / track_R use the unbaked TRACK material with U running along the belt (one texture tile = 8 links = 1.36 m) for scrolling.')
    extra = {'hull_m': [7.50, 3.60], 'gun_forward_total_m': 9.50, 'turret_roof_m': 2.50,
             'measured': {'hull_with_tracks_m': [round(hhi.x - hlo.x, 4), round(hhi.y - hlo.y, 4)], 'turret_roof_m': round(thi.z, 4),
                          'gun_forward_total_m': round(hi.x - lo.x, 4), 'barrel_overhang_m': round(hi.x - hhi.x, 4)},
             'nodes': nodes}
    finish('unit_mbt', ['unit_mbt'], [9.50, 3.60, 2.50], notes, extra, dict(azim=-50, elev=22, man_loc=(6.4, -1.9, 0)), args)


# ══════════════════════════════════════ 2. INFANTRY ══════════════════════════════════════
def eul(r, p, y): return Euler((R(r), R(p), R(y)), 'XYZ').to_matrix().to_4x4()
def T_(v): return Matrix.Translation(V(v))


def frame_mat(origin, xdir, zhint):
    x = V(xdir).normalized(); z = V(zhint); z = z - x * z.dot(x)
    if z.length < 1e-6: z = x.orthogonal()
    z.normalize(); y = z.cross(x); m = Matrix((x, y, z)).transposed().to_4x4(); m.translation = V(origin); return m


def seg_mat(a, b, xhint):
    """Frame at a with local Z along a->b and local X as close to xhint as possible."""
    a, b = V(a), V(b); z = (b - a).normalized(); x = V(xhint); x = x - z * x.dot(z)
    if x.length < 1e-6: x = z.orthogonal()
    x.normalize(); y = z.cross(x); m = Matrix((x, y, z)).transposed().to_4x4(); m.translation = a; return m


def ik2(root, target, l1, l2, pole):
    root, target = V(root), V(target); d = target - root; L = d.length
    L2 = min(max(L, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4); u = d.normalized()
    ca = (l1 * l1 + L2 * L2 - l2 * l2) / (2 * l1 * L2); sa = math.sqrt(max(0.0, 1 - ca * ca))
    p = V(pole); p = (p - u * p.dot(u)).normalized()
    return root + u * (l1 * ca) + p * (l1 * sa), root + u * L2, L / (l1 + l2)


def sring(z, rx, ry, ox=0.0, oy=0.0, n=12, p=2.0):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n; c, s_ = math.cos(a), math.sin(a)
        out.append(V((ox + rx * math.copysign(abs(c) ** (2 / p), c), oy + ry * math.copysign(abs(s_) ** (2 / p), s_), z)))
    return out


def tube(name, rings, n=12, p=2.0):
    return loft(name, [sring(*(list(r) + [0.0] * (5 - len(r))), n=n, p=p) for r in rings])


def put(o, Mx):
    o.matrix_world = Mx @ o.matrix_basis; return o


def yz_loft(name, stations, n_round=0.012):
    """Loft along X of rounded rectangles: stations (x, half_width, z_bottom, z_top)."""
    rings = []
    for x, hw, zb, zt in stations:
        c = min(n_round, hw * 0.5, (zt - zb) * 0.4)
        rings.append([V((x, y, z)) for y, z in ((hw - c, zb), (hw, zb + c), (hw, zt - c), (hw - c, zt), (-hw + c, zt), (-hw, zt - c), (-hw, zb + c), (-hw + c, zb))])
    return loft(name, rings)


# rifle-local reference points (x along the bore, origin at the butt on the bore line, z up)
RIFLE = dict(butt=(0.0, 0, -0.03), grip=(0.30, 0, -0.095), wristR=(0.245, -0.03, -0.155), support=(0.53, 0, -0.05), wristL=(0.50, 0.05, -0.10), muzzle=(0.90, 0, 0.0))
HEEL = V((-0.075, 0, -0.085)); BALL = V((0.205, 0, -0.08)); L_THIGH, L_SHIN, L_UARM, L_FARM = 0.43, 0.415, 0.30, 0.26
CARRY = ('torso', 'grip', (0.18, -0.10, 0.06), (0.66, 0.52, -0.50), (0.35, -0.35, 0.85))
POSES = {
    'stand': dict(pelvis=(0.0, 0, 0.96), prot=(0, 0, 0), trot=(0, 0, 0), nrot=(0, 0, 0), hrot=(0, 0, 0),
                  feet={1: ('ankle', (0.0, 0.125, 0.085), 9, 0), -1: ('ankle', (0.0, -0.125, 0.085), -9, 0)},
                  rifle=CARRY, pole={1: (-0.35, 1, -0.6), -1: (-0.9, -0.45, -0.5)}),
    'walk': dict(pelvis=(0.0, 0, 0.90), prot=(0, 0, -7), trot=(0, 5, 10), nrot=(0, -3, 0), hrot=(0, -2, -3),
                 feet={1: ('heel', (0.30, 0.10, 0.0), 3, 16), -1: ('ball', (-0.28, -0.10, 0.0), -4, -32)},
                 rifle=CARRY, pole={1: (-0.35, 1, -0.6), -1: (-0.9, -0.45, -0.5)}),
    'kneel': dict(pelvis=(-0.05, 0.0, 0.515), prot=(0, 0, -55), trot=(0, 8, 15), nrot=(16, 12, 0), hrot=(4, 2, 34),
                  feet={1: ('ankle_rel_hip', (0.40, 0.05), -12, 0), -1: ('kneel', None, 0, 0)},
                  rifle=('pocket', (0.11, -0.085, 0.31), (1, 0, 0), (0, 0, 1)), pole={1: (0.2, 0.5, -1), -1: (0, -1, -0.45)}),
}


def inf_mats():
    kw = dict(streaks=0, panel=0, bevel_r=0.005, ao_dist=0.04)
    return {
        'uniform': paint('UNIFORM_CAMO', (0.17, 0.158, 0.105), camo=[((0.075, 0.082, 0.046), 0.55), ((0.115, 0.082, 0.050), 0.60), ((0.30, 0.275, 0.19), 0.68)],
                         camo_scale=7.5, camo_strength=0.9, rough=0.9, wear=0.06, wear_col=(0.26, 0.24, 0.18), grime=0.45, mud=0.75, mud_top=0.55,
                         mud_col=(0.075, 0.06, 0.042), dust=0.35, fine=0.08, scuff=0.0, **kw),
        'gear': paint('GEAR_GREEN', (0.062, 0.068, 0.042), rough=0.85, wear=0.2, wear_col=(0.15, 0.15, 0.10), grime=0.5, mud=0.4, mud_top=0.55, dust=0.4, fine=0.08, **kw),
        'helmet': paint('HELMET_TAN', (0.20, 0.158, 0.098), rough=0.75, wear=0.3, wear_col=(0.08, 0.075, 0.06), grime=0.4, mud=0, dust=0.35, **kw),
        'boot': paint('BOOT_COYOTE', (0.16, 0.118, 0.072), rough=0.8, wear=0.3, wear_col=(0.08, 0.06, 0.045), grime=0.4, mud=1.0, mud_top=0.22,
                      mud_col=(0.075, 0.06, 0.042), dust=0.4, **kw),
        'sole': paint('RUBBER_SOLE', (0.022, 0.021, 0.02), rough=0.9, wear=0.0, grime=0.2, mud=1.0, mud_top=0.2, dust=0.3, **kw),
        'glove': paint('GLOVE_BLACK', (0.026, 0.026, 0.025), rough=0.7, wear=0.2, wear_col=(0.08, 0.08, 0.075), grime=0.2, mud=0, dust=0.15, **kw),
        'skin': paint('SKIN', (0.38, 0.235, 0.155), rough=0.55, wear=0.0, grime=0.3, grime_col=(0.17, 0.10, 0.065), mud=0, dust=0.08, variation=0.05, fine=0.05, **kw),
        'rifle': paint('RIFLE_BLACK', (0.02, 0.02, 0.02), rough=0.45, metal=0.4, wear=0.45, wear_col=(0.12, 0.12, 0.115), grime=0.2, mud=0, dust=0.2,
                       **dict(kw, bevel_r=0.003)),
        'furn': paint('RIFLE_TAN', (0.19, 0.148, 0.09), rough=0.6, wear=0.3, wear_col=(0.06, 0.055, 0.05), grime=0.3, mud=0, dust=0.25, **dict(kw, bevel_r=0.003)),
        'glass': glass_mat('GLASS_lens', (0.03, 0.035, 0.03)), 'team': team_mat(),
    }


def skeleton(P_):
    S = {}
    Pm = T_(P_['pelvis']) @ eul(*P_['prot']); Tm = Pm @ T_((0, 0, 0.10)) @ eul(*P_['trot'])
    Nm = Tm @ T_((0, 0, 0.42)) @ eul(*P_['nrot']); Hm = Nm @ T_((0.01, 0, 0.152)) @ eul(*P_['hrot'])
    S.update(P=Pm, T=Tm, N=Nm, H=Hm)
    fwdP = (Pm.to_3x3() @ V((1, 0, 0))); fwd_h = V((fwdP.x, fwdP.y, 0)).normalized()
    for s in (1, -1):
        hip = Pm @ V((0, s * 0.092, -0.035)); kind, a, yaw, pitch = P_['feet'][s]
        if kind == 'kneel':  # knee on the ground, shin back, toes tucked
            back = -fwd_h; uz = -(hip.z - 0.07) / L_THIGH; uh = math.sqrt(max(0, 1 - uz * uz))
            knee = hip + (back * uh + V((0, 0, uz))) * L_THIGH
            ankle = knee + (back * 0.90 + V((0, 0, 0.44))).normalized() * L_SHIN
            fdir = (fwd_h * 0.30 + V((0, 0, -1))).normalized(); Fm = frame_mat(ankle, fdir, fwd_h)
        else:
            if kind == 'ankle_rel_hip':
                Fm = T_((hip.x + a[0], hip.y + a[1], 0.085)) @ eul(0, -pitch, yaw)
            else:
                Rm = eul(0, -pitch, yaw)
                if kind == 'ankle': Fm = T_(a) @ Rm
                else:
                    loc = V(a) - (Rm.to_3x3() @ (HEEL if kind == 'heel' else BALL)); Fm = T_(loc) @ Rm
            ankle = Fm.translation.copy()
            pole = (fwd_h + (Fm.to_3x3() @ V((1, 0, 0)))) * 0.5 + V((0, 0, 0.1 if kind != 'ankle_rel_hip' else 0.8))
            knee, ankle2, reach = ik2(hip, ankle, L_THIGH, L_SHIN, pole)
            if reach > 1.0: print(f'  ! leg {s} over-extended {reach:.3f}')
        S[('hip', s)] = hip; S[('knee', s)] = knee; S[('ankle', s)] = ankle; S[('foot', s)] = Fm
    # rifle frame
    rk = P_['rifle']
    if rk[0] == 'torso':
        _, pt, org, d, up = rk; Rl = frame_mat((0, 0, 0), d, up); Rl.translation = V(org) - Rl.to_3x3() @ V(RIFLE[pt]); Rf = Tm @ Rl
    else:
        _, pocket, d, up = rk; Rf = frame_mat((0, 0, 0), d, up); Rf.translation = (Tm @ V(pocket)) - Rf.to_3x3() @ V(RIFLE['butt'])
    S['rifle'] = Rf
    for s in (1, -1):
        sh = Tm @ V((-0.01, s * 0.185, 0.365)); wt = Rf @ V(RIFLE['wristL' if s > 0 else 'wristR'])
        hc = Rf @ V(RIFLE['support' if s > 0 else 'grip'])
        pole = (Tm.to_3x3() @ V(P_['pole'][s])) if P_['rifle'][0] == 'torso' else V(P_['pole'][s])
        el, wr, reach = ik2(sh, wt, L_UARM, L_FARM, pole)
        if reach > 1.0: print(f'  ! arm {s} cannot reach the rifle ({reach:.3f})')
        S[('sh', s)] = sh; S[('el', s)] = el; S[('wr', s)] = wr; S[('hand', s)] = frame_mat(wr, hc - wr, Rf.to_3x3() @ V((0, -s, 0.3)))
    return S


def soldier(tag, P_, MT):
    S = skeleton(P_); Tm, Pm, Hm, Nm = S['T'], S['P'], S['H'], S['N']; B = []; RF = []
    fwdT = Tm.to_3x3() @ V((1, 0, 0))
    def add(o, mat, Mx=None, lst=B):
        assign(o, mat)
        if Mx is not None: put(o, Mx)
        lst.append(o); return o
    # ── legs and boots ──
    for s in (1, -1):
        hip, knee, ankle, Fm = S[('hip', s)], S[('knee', s)], S[('ankle', s)], S[('foot', s)]
        fwd = (fwdT + Fm.to_3x3() @ V((1, 0, 0))) * 0.5
        Lt = (knee - hip).length; Mt_ = seg_mat(hip, knee, fwd)
        add(tube('thigh', [(-0.08, 0.086, 0.090), (0.0, 0.095, 0.095, 0.005), (0.14, 0.093, 0.090, 0.012), (0.30, 0.074, 0.072, 0.006), (Lt + 0.025, 0.062, 0.062)], 14), MT['uniform'], Mt_)
        add(box('cargo', (0.14, 0.035, 0.17), (0.0, -s * 0.09, 0.20), bevel=0.012, seg=1), MT['uniform'], Mt_)
        Ls = (ankle - knee).length; Ms = seg_mat(knee, ankle, (knee - hip).cross(V((0, 0, 1))).cross(knee - ankle) if False else fwd)
        add(tube('shin', [(-0.04, 0.064, 0.066), (0.09, 0.064, 0.062, -0.008), (0.24, 0.054, 0.054), (Ls - 0.07, 0.058, 0.058), (Ls - 0.03, 0.052, 0.052)], 12), MT['uniform'], Ms)
        add(box('kneepad', (0.035, 0.10, 0.13), (0.062, 0, 0.02), bevel=0.016, seg=2), MT['gear'], Ms)
        add(box('kneecap', (0.012, 0.07, 0.08), (0.083, 0, 0.02), bevel=0.005, seg=1), MT['glove'], Ms)
        shoe = yz_loft('boot', [(-0.078, 0.040, -0.072, 0.02), (-0.062, 0.047, -0.072, 0.07), (0.0, 0.052, -0.072, 0.07), (0.07, 0.054, -0.072, 0.025),
                                (0.14, 0.051, -0.072, -0.012), (0.19, 0.044, -0.072, -0.028), (0.212, 0.030, -0.07, -0.042)])
        add(shoe, MT['boot'], Fm)
        add(tube('shaft', [(-0.03, 0.052, 0.050), (0.10, 0.054, 0.052), (0.125, 0.058, 0.056)], 12), MT['boot'], Fm)
        add(box('sole', (0.30, 0.108, 0.02), (0.068, 0, -0.075), bevel=0.006, seg=1), MT['sole'], Fm)
    # ── pelvis, belt, holster ──
    add(tube('pelvis', [(-0.14, 0.07, 0.095), (-0.08, 0.10, 0.155), (0.0, 0.11, 0.168), (0.08, 0.105, 0.158), (0.14, 0.10, 0.150)], 16, 2.4), MT['uniform'], Pm)
    add(tube('belt', [(0.06, 0.119, 0.171), (0.115, 0.119, 0.171)], 16, 2.4), MT['gear'], Pm)
    add(box('buckle', (0.012, 0.055, 0.04), (0.12, 0, 0.088), bevel=0.004, seg=1), MT['rifle'], Pm)
    add(box('holster', (0.06, 0.045, 0.15), (0.0, -0.19, 0.0), bevel=0.012, seg=1), MT['gear'], Pm)
    add(box('pistol', (0.05, 0.03, 0.05), (-0.005, -0.19, 0.095), bevel=0.006, seg=1), MT['rifle'], Pm)
    add(box('dump', (0.08, 0.06, 0.10), (-0.07, 0.17, 0.04), bevel=0.02, seg=1), MT['gear'], Pm)
    # ── torso, plate carrier, pouches ──
    add(tube('torso', [(-0.06, 0.105, 0.150), (0.08, 0.108, 0.156), (0.20, 0.118, 0.172), (0.30, 0.118, 0.186), (0.36, 0.102, 0.192), (0.405, 0.072, 0.15), (0.435, 0.05, 0.075)], 16, 2.4), MT['uniform'], Tm)
    add(box('plate_f', (0.05, 0.29, 0.31), (0.145, 0, 0.23), bevel=0.02, seg=2), MT['gear'], Tm)
    add(box('plate_b', (0.05, 0.30, 0.33), (-0.140, 0, 0.235), bevel=0.02, seg=2), MT['gear'], Tm)
    add(tube('cummerbund', [(0.05, 0.138, 0.188), (0.20, 0.138, 0.192)], 16, 2.6), MT['gear'], Tm)
    for s in (1, -1):
        add(box('strap_f', (0.05, 0.055, 0.06), (0.105, s * 0.095, 0.40), (0, R(-35), 0), bevel=0.01, seg=1), MT['gear'], Tm)
        add(box('strap_t', (0.16, 0.06, 0.03), (-0.01, s * 0.10, 0.435), bevel=0.01, seg=1), MT['gear'], Tm)
    for i, y in enumerate((-0.085, 0.0, 0.085)):
        add(box('magpouch', (0.055, 0.078, 0.13), (0.19, y, 0.165), bevel=0.012, seg=1), MT['gear'], Tm)
        add(box('flap', (0.06, 0.08, 0.03), (0.195, y, 0.232), bevel=0.008, seg=1), MT['gear'], Tm)
    add(box('admin', (0.04, 0.17, 0.075), (0.188, 0, 0.30), bevel=0.012, seg=1), MT['gear'], Tm)
    add(box('radio', (0.07, 0.05, 0.13), (-0.02, 0.21, 0.15), bevel=0.012, seg=1), MT['gear'], Tm)
    add(rod('antenna', (-0.04, 0.215, 0.21), (-0.07, 0.22, 0.52), 0.004, 5), MT['rifle'], Tm)
    add(box('ifak', (0.08, 0.05, 0.09), (-0.02, -0.21, 0.12), bevel=0.015, seg=1), MT['gear'], Tm)
    add(box('pack', (0.10, 0.25, 0.28), (-0.22, 0, 0.22), bevel=0.03, seg=2), MT['gear'], Tm)
    add(box('pack_top', (0.11, 0.24, 0.04), (-0.215, 0, 0.36), bevel=0.012, seg=1), MT['gear'], Tm)
    add(tube('gaiter', [(0.405, 0.068, 0.072), (0.45, 0.064, 0.066)], 12), MT['uniform'], Tm)
    # ── neck, head, face, glasses, helmet ──
    add(rod('neck', Nm @ V((0, 0, -0.03)), Hm @ V((-0.01, 0, -0.075)), 0.052, 12), MT['skin'])
    add(sphere('cranium', 1.0, (-0.006, 0, 0.0), scale=(0.100, 0.080, 0.112), seg=18, rings=12), MT['skin'], Hm)
    add(sphere('jaw', 1.0, (0.028, 0, -0.055), scale=(0.074, 0.068, 0.068), seg=14, rings=8), MT['skin'], Hm)
    add(box('nose', (0.03, 0.022, 0.042), (0.098, 0, -0.012), bevel=0.008, seg=1, taper={'top_front': (-0.012, 0, 0)}), MT['skin'], Hm)
    for s in (1, -1): add(sphere('ear', 1.0, (-0.006, s * 0.081, -0.005), scale=(0.018, 0.012, 0.03), seg=8, rings=6), MT['skin'], Hm)
    add(box('lens', (0.012, 0.135, 0.034), (0.093, 0, 0.013), bevel=0.004, seg=1), MT['glass'], Hm)
    for s in (1, -1): add(box('temple', (0.09, 0.006, 0.008), (0.045, s * 0.074, 0.016)), MT['rifle'], Hm)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
    for v in bm.verts: v.co = V((v.co.x * 0.132, v.co.y * 0.115, v.co.z * 0.14))
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.012), plane_no=V((-0.33, 0, 1)).normalized(), clear_inner=True)
    hel = lib.mesh_obj('helmet', bm); hel.location = (-0.008, 0, 0.028); solidify(hel, 0.012, -1); add(hel, MT['helmet'], Hm)
    add(box('nvg_mount', (0.03, 0.065, 0.05), (0.122, 0, 0.083), (0, R(-25), 0), bevel=0.006, seg=1), MT['rifle'], Hm)
    for s in (1, -1): add(box('rail', (0.11, 0.014, 0.02), (-0.01, s * 0.111, 0.055), (s * R(-6), 0, 0), bevel=0.004, seg=1), MT['rifle'], Hm)
    add(box('cwt', (0.035, 0.075, 0.05), (-0.138, 0, 0.045), (0, R(25), 0), bevel=0.01, seg=1), MT['gear'], Hm)
    # ── arms and gloves ──
    for s in (1, -1):
        sh, el, wr, Hd = S[('sh', s)], S[('el', s)], S[('wr', s)], S[('hand', s)]
        add(sphere('deltoid', 1.0, (-0.01, s * 0.19, 0.36), scale=(0.066, 0.06, 0.066), seg=14, rings=8), MT['uniform'], Tm)
        Lu = (el - sh).length; Mu = seg_mat(sh, el, fwdT)
        add(tube('uarm', [(-0.05, 0.055, 0.057), (0.04, 0.060, 0.060), (0.17, 0.053, 0.052), (0.27, 0.047, 0.046), (Lu + 0.025, 0.045, 0.044)], 12), MT['uniform'], Mu)
        add(box('patch', (0.055, 0.006, 0.065), (0.0, -s * 0.0605, 0.085)), MT['team'], Mu)
        add(sphere('elbow', 0.047, tuple(el), seg=12, rings=8), MT['uniform'])
        Lf = (wr - el).length; Mf = seg_mat(el, wr, fwdT)
        add(tube('farm', [(-0.03, 0.045, 0.045), (0.06, 0.048, 0.046), (0.17, 0.041, 0.038), (Lf - 0.03, 0.036, 0.034)], 12), MT['uniform'], Mf)
        add(tube('cuff', [(Lf - 0.055, 0.038, 0.036), (Lf + 0.012, 0.037, 0.035)], 12), MT['glove'], Mf)
        add(box('fist', (0.10, 0.088, 0.052), (0.058, 0, 0.0), bevel=0.02, seg=2), MT['glove'], Hd)
        add(box('thumb', (0.055, 0.022, 0.024), (0.045, 0.0, 0.03), (0, 0, s * R(25)), bevel=0.008, seg=1), MT['glove'], Hd)
    # ── rifle (carbine with optic, light and tan furniture) ──
    Rf = S['rifle']
    rparts = [
        (box('stock', (0.20, 0.042, 0.105), (0.10, 0, -0.035), bevel=0.01, seg=1, taper={'bot_front': (0, 0, 0.05)}), 'furn'),
        (box('buttpad', (0.016, 0.046, 0.11), (0.004, 0, -0.035), bevel=0.005, seg=1), 'rifle'),
        (rod('buffer', (0.16, 0, -0.005), (0.27, 0, -0.005), 0.017, 10), 'rifle'),
        (box('lower', (0.20, 0.034, 0.05), (0.36, 0, -0.035), bevel=0.006, seg=1), 'rifle'),
        (box('upper', (0.21, 0.036, 0.046), (0.365, 0, 0.012), bevel=0.006, seg=1), 'rifle'),
        (box('toprail', (0.46, 0.024, 0.012), (0.49, 0, 0.041)), 'rifle'),
        (box('pgrip', (0.034, 0.03, 0.10), (0.295, 0, -0.10), (0, R(20), 0), bevel=0.008, seg=1), 'furn'),
        (box('tguard', (0.07, 0.012, 0.008), (0.34, 0, -0.072)), 'rifle'),
        (box('mag', (0.04, 0.026, 0.14), (0.395, 0, -0.115), (0, R(-12), 0), bevel=0.006, seg=1), 'furn'),
        (box('handguard', (0.30, 0.050, 0.055), (0.62, 0, 0.005), bevel=0.008, seg=1), 'rifle'),
        (rod('barrel', (0.77, 0, 0.0), (0.865, 0, 0.0), 0.009, 8), 'rifle'),
        (rod('flash', (0.86, 0, 0.0), (0.90, 0, 0.0), 0.013, 8), 'rifle'),
        (box('optic', (0.085, 0.042, 0.05), (0.43, 0, 0.072), bevel=0.008, seg=1), 'rifle'),
        (box('optic_win', (0.006, 0.034, 0.034), (0.474, 0, 0.076)), 'glass'),
        (rod('wlight', (0.66, -0.035, 0.0), (0.74, -0.035, 0.0), 0.012, 8), 'rifle'),
        (box('sling', (0.06, 0.01, 0.02), (0.20, -0.025, -0.06)), 'gear'),
    ]
    for o, mk in rparts: add(o, MT[mk], Rf, RF)
    return S, B, RF


def build_infantry(args):
    lib.reset(); random.seed(3); MT = inf_mats(); colls = []
    for tag, cn in (('stand', 'unit_infantry'), ('walk', 'unit_infantry_walk'), ('kneel', 'unit_infantry_kneel')):
        S, B, RF = soldier(tag, POSES[tag], MT)
        body = make(f'soldier_{tag}', B, smooth=40); rifle = make(f'rifle_{tag}', RF, smooth=40)
        lo, hi, _, _ = measure([body, rifle])
        if abs(lo.z) > 1e-4:  # ground the pose (feet / knee on z = 0)
            for o in (body, rifle): o.data.transform(Matrix.Translation((0, 0, -lo.z)))
            print(f'  {tag}: grounded by {-lo.z:+.4f} m')
        mz = empty(f'muzzle_{tag}' if tag != 'stand' else 'muzzle', S['rifle'] @ V(RIFLE['muzzle']) - V((0, 0, lo.z)), rifle)
        collect(cn, [body, rifle, mz]); colls.append(cn)
        print(f'  {tag}: reach ok')
    notes = ('Modern rifleman: combat uniform (neutral multi-terrain camo), plate carrier with mag / admin / radio / IFAK pouches and assault pack, '
             'high-cut helmet with NVG mount and rails, ballistic glasses, gloves, knee pads, coyote boots, carbine with optic and weapon light, '
             'TEAM_ACCENT patch on both upper arms. Pose collections in this file: unit_infantry (standing at ease, rifle carried across the body), '
             'unit_infantry_walk (mid-stride), unit_infantry_kneel (kneeling, aiming along +X). Origin on the ground between the feet; front = +X.')
    extra = {'nav_capsule': {'radius_m': 0.35, 'height_m': 1.80, 'note': 'navigation capsule for movement/collision (radius 0.35 m, height 1.80 m)'},
             'standing_height_m': 1.80, 'poses': {}}
    def prev():
        offs = {'unit_infantry_walk': V((0, 1.1, 0)), 'unit_infantry_kneel': V((0.1, -1.15, 0))}
        for cn, d in offs.items():
            for o in coll_objs(bpy.data.collections[cn]):
                if o.parent is None: o.location += d
        tmp = bpy.data.collections.new('_all'); bpy.context.scene.collection.children.link(tmp)
        for cn in colls:
            for o in coll_objs(bpy.data.collections[cn]): tmp.objects.link(o)
        render_preview(tmp, os.path.join(OUT['preview'], 'unit_infantry.png'), azim=-35, elev=12, man_loc=(-0.2, 2.2, 0), w=800, h=600, ground=(12, 12))
        bpy.data.collections.remove(tmp)
        for cn, d in offs.items():
            for o in coll_objs(bpy.data.collections[cn]):
                if o.parent is None: o.location -= d
        bpy.context.view_layer.update()
    for cn in colls:
        lo, hi, ntri, _ = measure(coll_objs(bpy.data.collections[cn])); extra['poses'][cn] = {'size_m': [round(c, 4) for c in hi - lo], 'tris': ntri}
    var = {cn: {'spec': [None, None, None], 'notes': f'Pose variant of unit_infantry ({cn.split("_")[-1]}); same model, gear and materials. ' + notes,
                'extra': {'pose_of': 'unit_infantry', 'nav_capsule': extra['nav_capsule']}} for cn in colls[1:]}
    finish('unit_infantry', colls, [None, None, 1.80], notes, extra, args=args, json_names=var, preview_fn=prev)


# ══════════════════════════════════════ 3. APC (8x8) ══════════════════════════════════════
def big_tyre(name, x, y, z, r, width, rim_r, mats, seg=18, lug=0.018, chevron=True):
    """Lathe tyre around Y with staggered tread lugs; rubber outside rim_r, painted rim, dark hub."""
    hw = width / 2
    prof = [(rim_r * 0.55, -hw * 0.70), (rim_r * 1.02, -hw * 0.92), (r * 0.86, -hw), (r * 0.97, -hw * 0.86), (r, -hw * 0.45), (r, hw * 0.45),
            (r * 0.97, hw * 0.86), (r * 0.86, hw), (rim_r * 1.02, hw * 0.92), (rim_r * 0.92, hw * 0.62), (rim_r * 0.45, hw * 0.55), (rim_r * 0.30, hw * 0.80), (0.0, hw * 0.80)]
    tread = {3: 0, 4: 0, 5: 1, 6: 1}
    def radial(i, j, rr):
        if j in tread and ((i + tread[j]) % 2 == 0 if chevron else i % 2 == 0): return rr + lug
        return rr
    t = lathe(name, prof, seg, 'Y', (x, y, z), radial=radial, phase=(1.5 * math.pi) % (2 * math.pi / seg))
    if y < 0:
        for v in t.data.vertices: v.co.y = -v.co.y
        t.data.flip_normals()
    assign(t, mats['camo']); faces_mat(t, mats['rubber'], lambda c, n: math.hypot(c.x, c.z) > rim_r * 1.05)
    faces_mat(t, mats['steel'], lambda c, n: math.hypot(c.x, c.z) < rim_r * 0.5)
    return t


def build_apc(args):
    lib.reset(); random.seed(21); Mt = land_mats(); camo, steel, rubber, canvas, glass, team = Mt['camo'], Mt['steel'], Mt['rubber'], Mt['canvas'], Mt['glass'], Mt['team']
    X0, X1 = -3.50, 3.50; ROOF = 2.25; HB = 0.45
    def zroof(x): return ROOF if x <= 1.90 else ROOF - (x - 1.90) / (X1 - 1.90) * (ROOF - 1.40)
    def zkeel(x): return HB if x <= 2.70 else HB + (x - 2.70) / (X1 - 2.70) * (1.02 - HB)
    def section(x, wsc=1.0, roof_drop=0.0):
        zr = zroof(x) - roof_drop; zk = zkeel(x); zsh = min(1.95, zr - 0.14)
        half = [(1.20, zr), (1.44, zsh), (1.465, 1.22), (1.03, 1.20), (1.03, max(0.80, zk + 0.12)), (0.32, max(0.48, zk + 0.03))]
        half = [(y * (wsc if z > 1.21 else 1.0), z) for y, z in half]
        ring = [(0.0, zr)] + half + [(0.0, zk)] + [(-y, z) for y, z in reversed(half)]
        return [V((x, y, z)) for y, z in ring]
    stations = [section(-3.42, 0.985, 0.05), section(-3.35), section(1.90), section(2.70), section(3.30, 0.97), section(X1, 0.90, 0.0)]
    H = [M(loft('hull_shell', stations), camo)]
    lib.bev(H[0], 0.03, 1, angle=30)
    def gl(x): return zroof(x)
    gang = math.atan2(ROOF - 1.40, X1 - 1.90)
    # rear: ramp (proud of the rear face), door, lights, tow pintle, stowage
    H.append(M(box('ramp', (0.05, 1.70, 1.55), (-3.445, 0, 1.30), bevel=0.02, seg=1), camo))
    H.append(M(box('ramp_door', (0.03, 0.62, 1.10), (-3.48, -0.38, 1.38), bevel=0.012, seg=1), camo))
    dv = box('door_vb', (0.012, 0.16, 0.10), (-3.49, -0.38, 1.75), bevel=0.004, seg=1); assign(dv, glass); H.append(dv)
    H.append(M(box('door_handle', (0.02, 0.14, 0.03), (-3.49, -0.18, 1.35)), steel))
    for s in (-1, 1):
        H.append(M(cyl('hinge', 0.05, 0.30, (-3.44, s * 0.55, 0.56), (R(90), 0, 0), verts=10), steel))
        tl = box('taillight', (0.03, 0.10, 0.16), (-3.48, s * 1.20, 1.55), bevel=0.006, seg=1); assign(tl, Mt['tail']); H.append(tl)
        H.append(M(box('rear_box', (0.08, 0.36, 0.55), (-3.46, s * 1.12, 1.95), bevel=0.012, seg=1), camo))
        for k in range(2):
            H.append(M(box('jerry', (0.06, 0.16, 0.34), (-3.465, s * 1.02 + s * k * 0.19, 1.12), bevel=0.012, seg=1), steel if k else camo))
        H.append(M(box('rear_hook', (0.08, 0.10, 0.12), (-3.44, s * 0.95, 0.72), bevel=0.015, seg=1), steel))
    H.append(M(box('mark_r', (0.006, 0.40, 0.12), (-3.475, 0.38, 1.82)), team))
    num = text_mesh('num_r', '31', 0.22); num.rotation_euler = (R(90), 0, -R(90)); num.location = (-3.496, -0.38, 1.98); assign(num, team); H.append(num)
    # side armour panels, vision blocks, stowage, exhaust, TEAM stripe
    for s in (-1, 1):
        for k, (xa, xb) in enumerate(((1.75, 0.55), (0.52, -0.68), (-0.71, -1.91), (-1.94, -3.14))):
            H.append(M(box('side_plate', (xa - xb, 0.03, 0.62), ((xa + xb) / 2, s * 1.47, 1.60), bevel=0.01, seg=1), camo))
            for bx in (xa - 0.08, xb + 0.08):
                for bz in (1.36, 1.84): H.append(M(cyl('bolt', 0.022, 0.02, (bx, s * 1.49, bz), (R(90), 0, 0), verts=6), steel))
        H.append(M(box('team_stripe', (4.85, 0.006, 0.09), (-0.70, s * 1.487, 1.74)), team))
        for x in (-1.30, -2.55):
            fr = box('vb_frame', (0.26, 0.04, 0.16), (x, s * 1.47, 2.05), bevel=0.01, seg=1); assign(fr, steel); H.append(fr)
            gl_ = box('vb_glass', (0.20, 0.02, 0.10), (x, s * 1.488, 2.05)); assign(gl_, glass); H.append(gl_)
        H.append(M(box('mudflap', (0.02, 0.40, 0.42), (-2.95, s * 1.28, 0.55)), rubber))
        H.append(M(box('step', (0.30, 0.10, 0.04), (-3.15, s * 1.42, 0.95), bevel=0.008, seg=1), steel))
    for x in (1.45, 0.25):
        gr = box('exh_grille', (0.80, 0.03, 0.30), (x if x > 1 else 99, -1.47, 2.02), bevel=0.008, seg=1)
        if x > 1: assign(gr, steel); H.append(gr); sl = box('exh_slat', (0.03, 0.03, 0.26), (1.10, -1.478, 2.02)); lib.array(sl, 8, (0.1, 0, 0)); assign(sl, camo); H.append(sl)
        else: bpy.data.objects.remove(gr, do_unlink=True)
    H.append(M(box('fuel_cap', (0.14, 0.03, 0.14), (-0.25, 1.468, 2.05), bevel=0.01, seg=1), steel))
    # pioneer tools on the left side plates: shovel, pick and tow cable
    H.append(M(rod('shovel_h', (-2.95, 1.478, 1.52), (-1.95, 1.478, 1.52), 0.016, 6), canvas)); H.append(M(box('shovel_b', (0.26, 0.012, 0.20), (-3.0, 1.49, 1.52), bevel=0.004, seg=1), steel))
    H.append(M(rod('pick_h', (0.70, 1.478, 1.47), (1.60, 1.478, 1.47), 0.018, 6), canvas)); H.append(M(box('pick_h', (0.03, 0.012, 0.42), (1.58, 1.49, 1.47), bevel=0.004, seg=1), steel))
    for x in (-2.7, -2.2, 0.9, 1.4): H.append(M(box('tool_clamp', (0.04, 0.02, 0.06), (x, 1.49, 1.50)), steel))
    # front: driver hatch + periscopes on the glacis (left), engine grille (right), headlights, tow eyes, wave board seam
    def on_g(x): return gl(x)
    H.append(M(box('drv_hatch', (0.55, 0.55, 0.05), (2.25, 0.62, on_g(2.25) + 0.03), (0, gang, 0), bevel=0.015, seg=1), camo))
    for i in range(3):
        p = box('peri', (0.09, 0.15, 0.08), (2.62, 0.62 + (i - 1) * 0.17, on_g(2.62) + 0.045), (0, gang - 0.3, (i - 1) * 0.3), bevel=0.008, seg=1)
        assign(p, steel); faces_mat(p, glass, lambda c, n: n.x > 0.6); H.append(p)
    H.append(M(box('eng_grille', (0.85, 0.80, 0.04), (2.45, -0.55, on_g(2.45) + 0.02), (0, gang, 0), bevel=0.01, seg=1), steel))
    sl = box('eng_slat', (0.04, 0.74, 0.03), (2.12, -0.55, on_g(2.12) + 0.05), (0, gang, 0)); lib.array(sl, 8, (0.095, 0, 0)); assign(sl, camo); H.append(sl)
    for s in (-1, 1):
        hb = box('lamp_box', (0.10, 0.26, 0.12), (3.40, s * 1.15, 1.38), bevel=0.01, seg=1); assign(hb, steel); H.append(hb)
        for k in (-1, 1):
            l = cyl('lamp', 0.04, 0.03, (3.455, s * 1.15 + k * 0.065, 1.38), (0, R(90), 0), verts=12); assign(l, Mt['lamp']); H.append(l)
        H.append(M(box('tow_eye', (0.10, 0.08, 0.10), (3.40, s * 0.60, 1.05), bevel=0.015, seg=1), steel))
        H.append(M(box('mark_f', (0.006, 0.30, 0.10), (3.40, s * 0.6, 1.25)), team if s > 0 else camo))
    # roof: commander hatch with vision blocks, troop hatches, smoke launchers, roof rack with stowage, grab rails
    hx, hy = -0.55, 0.62
    H.append(M(cyl('cmd_ring', 0.38, 0.10, (hx, hy, ROOF + 0.05), verts=20, bevel=0.012, seg=1), camo))
    H.append(M(cyl('cmd_hatch', 0.32, 0.05, (hx, hy, ROOF + 0.125), verts=20, bevel=0.012, seg=1), camo))
    for i in range(6):
        a = R(-90 + i * 45); vb = box('cmd_vb', (0.05, 0.12, 0.08), (hx + 0.40 * math.cos(a), hy + 0.40 * math.sin(a), ROOF + 0.06), (0, 0, a), bevel=0.006, seg=1)
        assign(vb, steel); faces_mat(vb, glass, lambda c, n: n.x > 0.6); H.append(vb)
    for s in (-1, 1):
        H.append(M(box('troop_hatch', (0.70, 0.55, 0.05), (-2.20, s * 0.50, ROOF + 0.025), bevel=0.015, seg=1), camo))
        H.append(M(box('hatch_hinge', (0.06, 0.40, 0.05), (-1.82, s * 0.50, ROOF + 0.03)), steel))
        H.append(M(box('sm_base', (0.30, 0.22, 0.10), (1.55, s * 1.05, ROOF + 0.05), bevel=0.01, seg=1), camo))
        for i in range(2):
            for j in range(2):
                d = V((0.8, s * 0.5, 0.35)).normalized(); a0 = V((1.50 + i * 0.12, s * (0.98 + j * 0.12), ROOF + 0.10))
                tb = rod('sm_tube', a0, a0 + d * 0.22, 0.04, 8); assign(tb, steel); H.append(tb)
        H.append(M(rod('grab', (-1.0, s * 1.18, ROOF + 0.02), (-1.0, s * 1.18, ROOF + 0.10), 0.015, 6), steel))
        H.append(M(rod('grab', (-1.6, s * 1.18, ROOF + 0.02), (-1.6, s * 1.18, ROOF + 0.10), 0.015, 6), steel))
        H.append(M(rod('grab', (-1.0, s * 1.18, ROOF + 0.10), (-1.6, s * 1.18, ROOF + 0.10), 0.015, 6), steel))
    # rear roof rack with bags and a tarp roll
    rx0, rx1 = -3.38, -2.75
    for s in (-1, 1): H.append(M(rod('rack', (rx0, s * 1.05, ROOF + 0.18), (rx1, s * 1.05, ROOF + 0.18), 0.018, 6), steel))
    for x in (rx0, rx1): H.append(M(rod('rack', (x, -1.05, ROOF + 0.18), (x, 1.05, ROOF + 0.18), 0.018, 6), steel))
    for x in (rx0, rx1):
        for s in (-1, 1): H.append(M(rod('rack_post', (x, s * 1.05, ROOF), (x, s * 1.05, ROOF + 0.18), 0.018, 6), steel))
    H.append(M(box('bag', (0.50, 0.70, 0.30), (-3.05, 0.55, ROOF + 0.15), bevel=0.07, seg=1), canvas))
    H.append(M(box('bag', (0.45, 0.60, 0.26), (-3.05, -0.30, ROOF + 0.13), bevel=0.06, seg=1), canvas))
    H.append(M(cyl('tarp', 0.11, 0.60, (-3.05, -0.85, ROOF + 0.11), (R(90), 0, 0), verts=10, bevel=0.03, seg=1), canvas))
    # RWS ring on the roof
    H.append(M(cyl('rws_ring', 0.46, 0.06, (0.55, 0, ROOF + 0.03), verts=24), steel))
    hull = make('hull', H, camo, pivot=(0, 0, 0))
    # ── wheels ──
    WR, WW, WY, WZ = 0.58, 0.42, 1.29, 0.58
    wheels = []
    for s, sd in ((1, 'L'), (-1, 'R')):
        for i, x in enumerate((2.30, 0.92, -0.92, -2.30)):
            t = big_tyre(f'wheel_{sd}{i}', x, s * WY, WZ, WR - 0.016, WW, 0.36, Mt, seg=18, lug=0.016)
            wheels.append(make(f'wheel_{sd}{i}', [t], pivot=(x, s * WY, WZ), par=hull))
    # ── RWS turret + gun (12.7 mm HMG with sensor head) ──
    TXr, TZr = 0.55, ROOF + 0.06
    Tt = [M(cyl('rws_base', 0.40, 0.10, (TXr, 0, TZr + 0.05), verts=22, bevel=0.01, seg=1), camo)]
    Tt.append(M(box('rws_body', (0.72, 0.56, 0.20), (TXr - 0.05, 0, TZr + 0.20), bevel=0.03, seg=1, taper={'top_front': (-0.10, 0, 0)}), camo))
    for s in (-1, 1): Tt.append(M(box('rws_arm', (0.30, 0.06, 0.26), (TXr + 0.10, s * 0.30, TZr + 0.34), bevel=0.012, seg=1), camo))
    for s in (-1, 1):
        for j in range(3):
            tb = rod('rws_smoke', (TXr - 0.30, s * 0.20 + s * j * 0.06, TZr + 0.30), (TXr - 0.12, s * 0.26 + s * j * 0.06, TZr + 0.36), 0.03, 8); assign(tb, steel); Tt.append(tb)
    turret = make('turret', Tt, camo, pivot=(TXr, 0, TZr), par=hull)
    GZ = 2.58; GX = TXr + 0.10
    G = [M(box('hmg_rcv', (0.62, 0.15, 0.15), (GX + 0.05, 0, GZ), bevel=0.012, seg=1), steel),
         M(box('hmg_cradle', (0.70, 0.36, 0.08), (GX + 0.02, 0, GZ - 0.10), bevel=0.012, seg=1), camo),
         M(rod('hmg_barrel', (GX + 0.36, 0, GZ + 0.01), (GX + 1.30, 0, GZ + 0.01), 0.026, 10), steel),
         M(rod('hmg_shroud', (GX + 0.36, 0, GZ + 0.01), (GX + 0.62, 0, GZ + 0.01), 0.042, 10), steel),
         M(rod('hmg_flash', (GX + 1.26, 0, GZ + 0.01), (GX + 1.40, 0, GZ + 0.01), 0.034, 10), steel),
         M(box('ammo', (0.32, 0.17, 0.26), (GX - 0.05, 0.25, GZ - 0.02), bevel=0.012, seg=1), camo)]
    sens = box('sensor', (0.32, 0.24, 0.20), (GX + 0.05, -0.30, 2.70), bevel=0.02, seg=1); assign(sens, camo); faces_mat(sens, glass, lambda c, n: n.x > 0.6); G.append(sens)
    gun = make('gun', G, camo, pivot=(GX, 0, GZ), par=turret)
    mzl = empty('muzzle', (GX + 1.40, 0, GZ + 0.01), gun)
    ants = []
    for s, sd in ((1, 'L'), (-1, 'R')):
        ax, ay = -3.25, s * 1.25
        a = [M(box('ant_base', (0.12, 0.12, 0.10), (ax, ay, ROOF + 0.05), bevel=0.012, seg=1), steel), M(cyl('ant_spring', 0.022, 0.12, (ax, ay, ROOF + 0.16), verts=8), steel),
             M(rod('ant_whip', (ax, ay, ROOF + 0.22), (ax - 0.25, ay, ROOF + 2.4), 0.007, 5, r2=0.004), steel)]
        o = make(f'antenna_{sd}', a, steel, pivot=(ax, ay, ROOF), par=hull); o['exclude_bounds'] = True; ants.append(o)
    objs = [hull, turret, gun, mzl, *ants, *wheels]
    collect('unit_apc', objs)
    notes = ('8x8 wheeled APC in the shared neutral camo: lofted hull with V-belly, bolt-on side armour, rear ramp with door, vision blocks, '
             'commander hatch, roof rack stowage, smoke launchers, remote weapon station (turret) with 12.7 mm HMG and sensor head (gun). '
             'TEAM_ACCENT side stripes, rear "31" and front marking. Both whip antennas carry exclude_bounds. Pivots: turret (0.55, 0, 2.31), '
             'gun (0.65, 0, 2.58), wheels at their axles (r 0.58 m); muzzle empty at the HMG flash hider.')
    extra = {'nodes': sorted(o.name for o in objs), 'wheel_radius_m': WR}
    finish('unit_apc', ['unit_apc'], [7.00, 3.00, 2.80], notes, extra, dict(azim=-48, elev=20, man_loc=(4.3, -1.9, 0)), args)


# ══════════════════════════════════════ 4. ORE HARVESTER ══════════════════════════════════════
def arc_plate(name, cx, cz, r0, r1, a0, a1, y0, y1, n=12):
    """Curved plate (fender / hood shell) around an axis parallel to Y."""
    out = [(cx + r1 * math.cos(R(a0 + (a1 - a0) * i / n)), cz + r1 * math.sin(R(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    inn = [(cx + r0 * math.cos(R(a1 - (a1 - a0) * i / n)), cz + r0 * math.sin(R(a1 - (a1 - a0) * i / n))) for i in range(n + 1)]
    pts = out + inn
    return loft(name, [[V((x, y0, z)) for x, z in pts], [V((x, y1, z)) for x, z in pts]])


def build_harvester(args):
    lib.reset(); random.seed(31)
    ore_dust = (0.30, 0.17, 0.08)
    Y = paint('HARVESTER_YELLOW', (0.58, 0.32, 0.012), rough=0.55, metal=0.1, wear=0.8, wear_col=(0.035, 0.033, 0.03), grime=0.65, mud=0.95, mud_top=1.7,
              mud_col=(0.085, 0.062, 0.04), dust=0.7, dust_col=ore_dust, streaks=0.45, streak_col=(0.16, 0.09, 0.04), panel=0.03)
    CH = paint('CHASSIS_DARK', (0.032, 0.031, 0.029), rough=0.6, metal=0.5, wear=0.55, wear_col=(0.2, 0.19, 0.18), grime=0.5, mud=0.95, mud_top=1.6,
               mud_col=(0.085, 0.062, 0.04), dust=0.55, dust_col=ore_dust, streaks=0.2, panel=0)
    BIN = paint('BIN_STEEL', (0.085, 0.075, 0.065), rough=0.5, metal=0.6, wear=0.6, wear_col=(0.26, 0.25, 0.23), grime=0.5, mud=0.3, mud_top=2.4,
                dust=0.6, dust_col=ore_dust, streaks=0.7, streak_col=(0.17, 0.075, 0.025), panel=0.05)
    RB = paint('RUBBER', (0.022, 0.022, 0.021), rough=0.9, wear=0.12, wear_col=(0.07, 0.065, 0.06), grime=0.3, mud=1.0, mud_top=1.5, mud_col=(0.085, 0.062, 0.04),
               dust=0.6, dust_col=ore_dust, panel=0, streaks=0)
    HZ = paint('HAZARD_STRIPES', (0.60, 0.34, 0.012), stripes=((0.025, 0.025, 0.024), 0.30), rough=0.55, wear=0.8, wear_col=(0.04, 0.04, 0.035), grime=0.6,
               mud=0.9, mud_top=1.7, mud_col=(0.085, 0.062, 0.04), dust=0.6, dust_col=ore_dust, panel=0, streaks=0.2)
    ORE = paint('ORE_LOAD', (0.20, 0.095, 0.035), camo=[((0.50, 0.33, 0.07), 0.60), ((0.05, 0.04, 0.032), 0.60), ((0.30, 0.16, 0.06), 0.64)], camo_scale=11.0,
                camo_strength=0.85, rough=0.8, wear=0.0, grime=0.7, grime_col=(0.04, 0.025, 0.015), mud=0, dust=0, panel=0, streaks=0, fine=0.3, variation=0.15, ao_dist=0.15)
    glass = glass_mat('GLASS_cab', (0.025, 0.03, 0.03)); team = team_mat(); amber = glow_mat('GLOW_beacon', (1.0, 0.45, 0.02), 3.0)
    lamp = glow_mat('GLOW_worklight', (1.0, 0.92, 0.75), 1.5); tail = glow_mat('GLOW_taillight', (1.0, 0.06, 0.03), 2.0)
    mats = {'camo': Y, 'rubber': RB, 'steel': CH}
    DK = 2.05  # deck height
    H = []
    # chassis, axles, belly
    for s in (-1, 1): H.append(M(box('rail', (8.9, 0.28, 0.50), (-0.35, s * 0.60, 1.15), bevel=0.02, seg=1), CH))
    H.append(M(box('belly', (8.2, 1.0, 0.06), (-0.4, 0, 0.92)), CH))
    AX = (2.60, -1.35, -3.45); TR, TW, TY, TZ = 0.95, 0.72, 1.64, 0.95
    for x in AX:
        H.append(M(cyl('axle', 0.14, 2.70, (x, 0, TZ), (R(90), 0, 0), verts=12), CH))
        H.append(M(box('diff', (0.50, 0.50, 0.44), (x, 0, TZ), bevel=0.06, seg=1), CH))
    # body: main deck block, front-left cab plinth, rear engine module
    H.append(M(box('body', (7.45, 2.44, 0.65), (-0.825, 0, 1.725), bevel=0.03, seg=1), Y))
    H.append(M(box('plinth', (0.85, 1.32, 0.65), (3.325, 0.56, 1.725), bevel=0.03, seg=1), Y))
    H.append(M(box('engine', (1.05, 2.60, 1.50), (-4.475, 0, 2.15), bevel=0.04, seg=1, taper={'top_back': (0.12, 0, 0)}), Y))
    H.append(M(box('eng_top', (0.80, 2.2, 0.06), (-4.40, 0, 2.93), bevel=0.01, seg=1), CH))
    gr = box('radiator', (0.04, 2.0, 1.0), (-4.975, 0, 2.05), bevel=0.01, seg=1); assign(gr, CH); H.append(gr)
    sl = box('rad_slat', (0.03, 1.95, 0.035), (-4.985, 0, 1.62)); lib.array(sl, 10, (0, 0, 0.095)); assign(sl, Y); H.append(sl)
    H.append(M(rod('exhaust', (-4.45, -0.85, 2.90), (-4.45, -0.85, 3.70), 0.10, 12), CH))
    H.append(M(cyl('exh_cap', 0.13, 0.05, (-4.45, -0.85, 3.72), (0, R(-20), 0), verts=12), CH))
    H.append(M(cyl('aircleaner', 0.21, 0.62, (-4.45, 0.85, 3.21), verts=14, bevel=0.03, seg=1), Y))
    H.append(M(box('bumper_r', (0.20, 2.60, 0.36), (-4.90, 0, 1.12), bevel=0.02, seg=1), HZ))
    H.append(M(box('hitch', (0.25, 0.30, 0.18), (-4.875, 0, 0.88), bevel=0.02, seg=1), CH))
    for s in (-1, 1):
        tl = box('taillight', (0.03, 0.18, 0.12), (-4.98, s * 1.12, 1.62), bevel=0.006, seg=1); assign(tl, tail); H.append(tl)
        H.append(M(box('rear_step', (0.30, 0.40, 0.04), (-4.80, s * 1.55, 1.05), bevel=0.008, seg=1), CH))
    # fenders over every tyre, with mud flaps
    for x in AX:
        for s in (-1, 1):
            H.append(M(arc_plate('fender', x, TZ, 1.04, 1.08, 15, 165, s * 1.25, s * 1.99), Y))
            H.append(M(box('flap', (0.03, 0.70, 0.55), (x - 1.08, s * 1.62, 0.62)), RB))
    # front walkways (grating) with toe boards and handrails
    for s in (-1, 1):
        H.append(M(box('walk', (2.10, 0.72, 0.05), (2.60, s * 1.60, DK + 0.025), bevel=0.006, seg=1), CH))
        H.append(M(box('toe', (2.10, 0.03, 0.10), (2.60, s * 1.975, DK + 0.05)), Y))
    for x in (1.60, 2.60, 3.60): H.append(M(rod('post', (x, -1.96, DK), (x, -1.96, DK + 1.0), 0.025, 6), Y))
    for z in (DK + 0.5, DK + 1.0): H.append(M(rod('hrail', (1.60, -1.96, z), (3.60, -1.96, z), 0.025, 6), Y))
    H.append(M(rod('hrail', (3.60, -1.96, DK + 1.0), (3.60, -1.30, DK + 1.0), 0.025, 6), Y))
    H.append(M(rod('post', (3.60, -1.30, DK), (3.60, -1.30, DK + 1.0), 0.025, 6), Y))
    # access ladder at the front left (ahead of the front tyre)
    for y in (1.78, 1.955): H.append(M(rod('ladder', (3.66, y, 0.40), (3.62, y, DK + 0.9), 0.022, 6), CH))
    for i in range(5): H.append(M(rod('rung', (3.655 - i * 0.008, 1.78, 0.55 + i * 0.36), (3.655 - i * 0.008, 1.955, 0.55 + i * 0.36), 0.018, 6), CH))
    # cab (front left) with windows, door, beacon, work lights, mirror
    cab = box('cab', (1.78, 1.70, 1.55), (2.64, 1.08, DK + 0.775), bevel=0.05, seg=1, taper={'top_front': (-0.22, 0, 0)}); assign(cab, Y); H.append(cab)
    H.append(M(box('cab_roof', (1.70, 1.80, 0.07), (2.55, 1.08, DK + 1.585), bevel=0.02, seg=1), Y))
    ws = box('windscreen', (0.04, 1.42, 0.85), (3.415, 1.08, DK + 1.02), (0, R(-14.5), 0), bevel=0.01, seg=1); assign(ws, glass); H.append(ws)
    for s, y in ((1, 1.935), (-1, 0.225)):
        for xa, xb in ((1.95, 2.85), (2.95, 3.32)):
            w = box('side_win', (xb - xa, 0.03, 0.70), ((xa + xb) / 2, y, DK + 1.05), bevel=0.008, seg=1); assign(w, glass); H.append(w)
    rw = box('rear_win', (0.03, 1.20, 0.55), (1.745, 1.08, DK + 1.10), bevel=0.008, seg=1); assign(rw, glass); H.append(rw)
    H.append(M(box('door_line', (0.02, 0.01, 1.30), (2.88, 1.94, DK + 0.72)), CH))
    H.append(M(box('door_handle', (0.14, 0.03, 0.03), (2.75, 1.945, DK + 0.65)), CH))
    H.append(M(cyl('beacon_base', 0.10, 0.05, (2.05, 1.70, DK + 1.645), verts=12), CH))
    bc = cyl('beacon', 0.08, 0.14, (2.05, 1.70, DK + 1.74), verts=12, r2=0.06); assign(bc, amber); H.append(bc)
    H.append(M(cyl('beacon_base', 0.10, 0.05, (2.05, 0.45, DK + 1.645), verts=12), CH))
    bc = cyl('beacon', 0.08, 0.14, (2.05, 0.45, DK + 1.74), verts=12, r2=0.06); assign(bc, amber); H.append(bc)
    H.append(M(box('lightbar', (0.14, 1.40, 0.10), (3.22, 1.08, DK + 1.67), bevel=0.015, seg=1), CH))
    for k in range(4):
        l = box('worklight', (0.02, 0.14, 0.07), (3.295, 0.62 + k * 0.31, DK + 1.67)); assign(l, lamp); H.append(l)
    H.append(M(rod('mirror_arm', (3.30, 1.95, DK + 1.25), (3.62, 1.97, DK + 1.30), 0.02, 6), CH))
    H.append(M(box('mirror', (0.06, 0.04, 0.28), (3.64, 1.96, DK + 1.30), bevel=0.01, seg=1), CH))
    # headlights on the plinth front
    for y in (0.35, 1.05):
        H.append(M(box('lamp_box', (0.08, 0.30, 0.14), (3.76, y, 1.85), bevel=0.012, seg=1), CH))
        l = box('lamp', (0.02, 0.24, 0.09), (3.80, y, 1.85)); assign(l, lamp); H.append(l)
    # ── hopper (ore bin) with sloped walls, ribs, rim beam, TEAM band, ore load ──
    zb, zt = DK + 0.05, 3.92
    ob = [(1.30, -1.42), (1.30, 1.42), (-3.75, 1.42), (-3.75, -1.42)]; ot = [(1.45, -1.90), (1.45, 1.90), (-3.90, 1.90), (-3.90, -1.90)]
    it = [(1.39, -1.84), (1.39, 1.84), (-3.84, 1.84), (-3.84, -1.84)]; ib = [(1.24, -1.36), (1.24, 1.36), (-3.69, 1.36), (-3.69, -1.36)]
    hop = loft('hopper', [[V((x, y, zb)) for x, y in ob], [V((x, y, zt)) for x, y in ot], [V((x, y, zt)) for x, y in it], [V((x, y, zb + 0.08)) for x, y in ib]])
    assign(hop, Y); faces_mat(hop, BIN, lambda c, n: abs(c.x - (-1.225)) < 2.55 and abs(c.y) < 1.86 and n.dot(V((0, 0, 1))) > -0.2 and not (abs(c.y) > 1.85 or c.x > 1.40 or c.x < -3.86) and c.z > zb + 0.01 and (n.z > 0.5 or (abs(c.y) < 1.86 and abs(c.y) > 1.3 and n.y * c.y < 0) or (c.x > 1.2 and n.x < 0) or (c.x < -3.6 and n.x > 0)))
    H.append(hop)
    slope = math.atan2(1.90 - 1.42, zt - zb)
    for s in (-1, 1):
        H.append(M(box('rim', (5.45, 0.12, 0.08), (-1.225, s * 1.91, 3.96), bevel=0.012, seg=1), Y))
        for x in (-3.30, -2.45, -1.60, -0.75, 0.10, 0.95):
            H.append(M(box('rib', (0.10, 0.07, zt - zb), (x, s * (1.42 + 1.90) / 2 + s * 0.035, (zb + zt) / 2), (-s * slope, 0, 0), bevel=0.01, seg=1), Y))
        H.append(M(box('team_band', (5.0, 0.012, 0.24), (-1.225, s * 1.835 + s * 0.012, 3.55), (-s * slope, 0, 0)), team))
    for x in (1.51, -3.96): H.append(M(box('rim', (0.12, 3.94, 0.08), (x, 0, 3.96), bevel=0.012, seg=1), Y))
    H.append(M(box('team_band_r', (0.012, 3.0, 0.24), (-3.88, 0, 3.55), (0, R(-4.6), 0)), team))
    # ore heap
    nu, nv = 26, 14; verts = []; rnd = random.Random(4)
    for j in range(nv + 1):
        for i in range(nu + 1):
            u, v = i / nu, j / nv; x = -3.80 + 5.13 * u; y = -1.80 + 3.60 * v
            h = 3.42 + 0.42 * math.sin(math.pi * u) ** 0.8 * math.sin(math.pi * v) ** 0.9 + 0.05 * math.sin(7 * u + 3 * v) + rnd.uniform(-0.035, 0.035)
            if i in (0, nu) or j in (0, nv): h = 3.38
            verts.append((x, y, min(h, 3.88)))
    faces = [(j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i) for j in range(nv) for i in range(nu)]
    heap = mesh_from('ore', verts, faces); assign(heap, ORE); H.append(heap)
    # hopper tipping rams + rear hinge
    for s in (-1, 1):
        H.append(M(rod('ram', (0.9, s * 0.95, 1.45), (1.0, s * 0.95, 2.15), 0.09, 10), CH))
        H.append(M(cyl('hinge', 0.10, 0.35, (-3.80, s * 0.95, DK + 0.02), (R(90), 0, 0), verts=10), CH))
    # conveyor / bucket elevator from the drum up to the hopper intake chute
    c0, c1 = V((4.05, -0.80, 1.35)), V((1.75, -0.80, 3.62)); cd = c1 - c0; cl = cd.length; ca = math.atan2(cd.z, -cd.x); cm = (c0 + c1) / 2
    H.append(M(box('conv_trough', (cl, 0.80, 0.28), tuple(cm), (0, ca, 0), bevel=0.015, seg=1), Y))
    belt = box('conv_belt', (cl - 0.1, 0.62, 0.04), tuple(cm + V((math.sin(ca) * 0.14, 0, math.cos(ca) * 0.14))), (0, ca, 0)); assign(belt, RB); H.append(belt)
    for k in range(11):
        p = c0 + cd * (0.06 + k * 0.087) + V((math.sin(ca) * 0.18, 0, math.cos(ca) * 0.18))
        cl_ = box('cleat', (0.05, 0.60, 0.07), tuple(p), (0, ca, 0)); assign(cl_, CH); H.append(cl_)
    for s in (-1, 1): H.append(M(box('conv_side', (cl, 0.04, 0.16), tuple(cm + V((math.sin(ca) * 0.20, s * 0.40, math.cos(ca) * 0.20))), (0, ca, 0)), Y))
    H.append(M(box('chute', (0.36, 0.90, 0.62), (1.62, -0.80, 3.58), bevel=0.02, seg=1, taper={'bot_front': (-0.18, 0, 0)}), Y))
    H.append(M(rod('conv_leg', (3.0, -0.80, DK), tuple(c0 + cd * 0.45 - V((0, 0, 0.12))), 0.07, 8), CH))
    # cutter-drum hood, side plates with hazard stripes, arms and hydraulic rams
    DX, DZ = 4.35, 0.66
    H.append(M(arc_plate('hood', DX, DZ, 0.80, 0.84, 50, 196, -1.55, 1.55, n=14), Y))
    sp = [(DX, DZ)] + [(DX + 0.84 * math.cos(R(50 + 146 * i / 10)), DZ + 0.84 * math.sin(R(50 + 146 * i / 10))) for i in range(11)]
    for s in (-1, 1):
        pl = profile_extrude('side_plate', sp, 0.04, loc=(0, s * 1.57, 0)); assign(pl, HZ); H.append(pl)
        H.append(M(box('arm', (0.95, 0.12, 0.24), (4.02, s * 1.70, 0.96), (0, R(42), 0), bevel=0.02, seg=1), Y))
        H.append(M(rod('ram_cyl', (3.55, s * 1.70, 1.78), (3.95, s * 1.70, 1.40), 0.07, 10), CH))
        H.append(M(rod('ram_rod', (3.95, s * 1.70, 1.40), (4.28, s * 1.70, 1.09), 0.035, 8), CH))
    H.append(M(box('hood_lip', (0.08, 3.10, 0.10), (DX + 0.84 * math.cos(R(50)) - 0.02, 0, DZ + 0.84 * math.sin(R(50))), (0, R(-40), 0), bevel=0.01, seg=1), HZ))
    hull = make('hull', H, Y, pivot=(0, 0, 0))
    # ── drum with helical picks (rotating node) ──
    D = [M(cyl('drum_core', 0.55, 3.00, (DX, 0, DZ), (R(90), 0, 0), verts=20), CH)]
    for s in (-1, 1): D.append(M(cyl('drum_end', 0.58, 0.06, (DX, s * 1.50, DZ), (R(90), 0, 0), verts=20), CH))
    for hlx in (-1, 1):
        for k in range(16):
            yy = hlx * (0.08 + k * 0.088); a = R(k * 26 + (0 if hlx > 0 else 180))
            for a2 in (a, a + math.pi):
                ca_, sa_ = math.cos(a2), math.sin(a2)
                tip = V((DX + ca_ * 0.6475, yy, DZ + sa_ * 0.6475)); base = V((DX + ca_ * 0.53, yy, DZ + sa_ * 0.53))
                tip2 = tip + V((-sa_, 0, ca_)) * 0.03
                D.append(M(rod('pick', base, tip2, 0.03, 5, r2=0.008), BIN))
    drum = make('drum', D, CH, pivot=(DX, 0, DZ), par=hull)
    # ── tyres ──
    wheels = []
    for s, sd in ((1, 'L'), (-1, 'R')):
        for i, x in enumerate(AX):
            t = big_tyre(f'wheel_{sd}{i}', x, s * TY, TZ, TR - 0.05, TW, 0.52, mats, seg=24, lug=0.05)
            wheels.append(make(f'wheel_{sd}{i}', [t], pivot=(x, s * TY, TZ), par=hull))
    objs = [hull, drum, *wheels]
    collect('unit_harvester', objs)
    notes = ('Heavy ore harvester: front cutter drum with helical picks (node "drum", rotates about Y at (4.35, 0, 0.66)), drum hood with hazard-striped '
             'side plates on hydraulic arms, inclined bucket conveyor into a sloped-wall ore hopper (ore load modelled), cab with windows, beacons and '
             'work lights, rear engine module with radiator and exhaust, six 1.90 m mining tyres on three axles (wheel_*), walkways, ladder and handrails. '
             'Industrial yellow with heavy edge wear, ore dust and mud; TEAM_ACCENT band around the hopper. Nothing excluded.')
    extra = {'nodes': sorted(o.name for o in objs), 'tyre_diameter_m': 2 * TR + 0.1}
    finish('unit_harvester', ['unit_harvester'], [10.00, 4.00, 4.00], notes, extra, dict(azim=-42, elev=24, man_loc=(5.9, -2.2, 0)), args)


# ══════════════════════════════════════ 5. PATROL BOAT ══════════════════════════════════════
# hull rows from keel to deck edge: (y_transom, z_transom, y_mid, z_mid, x_start, x_end(stem), z_end(stem), p_y, q_z)
BOAT_ROWS = [(0.00, -1.42, 0.00, -1.62, -15.70, 10.0, -1.20, 1.0, 1.0),
             (1.45, -0.86, 1.55, -0.96, -15.75, 12.2, -0.58, 1.25, 1.2),
             (2.85, 0.06, 3.05, 0.10, -15.82, 14.0, 0.40, 1.45, 1.5),
             (2.97, 0.11, 3.17, 0.15, -15.84, 14.2, 0.55, 1.55, 1.5),
             (3.08, 0.62, 3.32, 0.70, -15.90, 14.7, 1.15, 1.85, 1.6),
             (3.22, 1.44, 3.50, 1.58, -15.96, 15.25, 2.20, 2.3, 1.8),
             (3.15, 1.62, 3.42, 1.82, -16.00, 15.55, 2.95, 2.4, 2.2)]
BOW_LEAN = 0.45  # bulwark top leans forward at the stem so the stem line reaches x = +16.00
T_TR, T_BOW = 0.22, 0.55


def _sm(a): return a * a * (3 - 2 * a)


def boat_row(j, t):
    yt, zt, ym, zm, xs, xe, ze, p, q = BOAT_ROWS[j]; x = xs + (xe - xs) * t
    if t < T_TR: a = _sm(t / T_TR); y = yt + (ym - yt) * a; z = zt + (zm - zt) * a
    elif t <= T_BOW: y, z = ym, zm
    else:
        s = (t - T_BOW) / (1 - T_BOW); y = ym * max(0.0, 1 - s ** p) ** (1 / p); z = zm + (ze - zm) * s ** q
    return x, y, z


def bulwark_h(x): return 0.12 if x < 3.0 else (0.12 + 0.73 * _sm(min(1, (x - 3.0) / 3.0)) + 0.10 * max(0, (x - 6.0) / 10.0))


def deck_t(x): r = BOAT_ROWS[6]; return min(max((x - r[4]) / (r[5] - r[4]), 0.0), 1.0)


def deck_z(x, y=0.0):
    t = deck_t(x); _, ye, ze = boat_row(6, t)
    return ze + 0.08 * max(0.0, 1 - (y / max(ye, 0.01)) ** 2)


def boat_hull(name, n=40):
    ts = [(k / n) ** 0.85 for k in range(n + 1)]; stations = []; decks = []
    for t in ts:
        side = [V(boat_row(j, t)) for j in range(7)]
        x6, y6, z6 = side[6]; hb = bulwark_h(x6); y6i = max(y6 - 0.08, 0.0); xl = x6 + BOW_LEAN * t ** 12
        bw = [V((xl, max(y6 - 0.02, 0), z6 + hb)), V((xl, y6i, z6 + hb)), V((x6, y6i, z6))]
        left = [V((p.x, p.y, p.z)) for p in reversed(bw)] + [V((p.x, p.y, p.z)) for p in reversed(side[1:])]
        right = [V((p.x, -p.y, p.z)) for p in side[1:]] + [V((p.x, -p.y, p.z)) for p in bw]
        stations.append(left + [side[0]] + right)
        decks.append([V((x6, y6i, z6)), V((x6, 0, z6 + 0.08)), V((x6, -y6i, z6))])
    hull = loft(name, stations, closed=False)
    deck = loft(name + '_deck', decks, closed=False)
    tr = stations[0]
    for o in (hull, deck):
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-5); bm.to_mesh(o.data); bm.free()
    # transom face: the stern station outline closed across the cambered deck
    tm = mesh_from(name + '_transom', tr + [decks[0][1]], [tuple(range(len(tr) + 1))])
    if tm.data.polygons[0].normal.x > 0: tm.data.flip_normals()
    return hull, deck, tm


def face_panel(name, B0, B1, T0, T1, u0, u1, v0, v1, off=0.02, out_hint=None):
    """Flat quad on the bilinear face (B0,B1 bottom edge, T0,T1 top edge) between params, offset along its normal."""
    def P(u, v): return (B0.lerp(B1, u)).lerp(T0.lerp(T1, u), v)
    pts = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]
    nrm = (pts[1] - pts[0]).cross(pts[3] - pts[0]).normalized()
    if out_hint is not None and nrm.dot(V(out_hint)) < 0: nrm = -nrm; pts = [pts[0], pts[3], pts[2], pts[1]]
    return mesh_from(name, [p + nrm * off for p in pts], [(0, 1, 2, 3)])


def ring_loft(name, rings_xy_z):
    return loft(name, [[V((x, y, z)) for x, y in pts] for pts, z in rings_xy_z])


def torus(name, R_, r, loc, rot, seg=14, sides=6):
    verts = []; faces = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(sides):
            b = 2 * math.pi * j / sides; rr = R_ + r * math.cos(b); verts.append((rr * math.cos(a), rr * math.sin(a), r * math.sin(b)))
    for i in range(seg):
        for j in range(sides): faces.append((i * sides + j, ((i + 1) % seg) * sides + j, ((i + 1) % seg) * sides + (j + 1) % sides, i * sides + (j + 1) % sides))
    o = mesh_from(name, verts, faces); o.location = loc; o.rotation_euler = rot; return o


def build_patrol_boat(args):
    lib.reset(); random.seed(41)
    salt = (0.52, 0.53, 0.52); rust = (0.15, 0.065, 0.028)
    G = paint('NAVAL_GREY', (0.20, 0.215, 0.225), rough=0.5, metal=0.1, wear=0.35, wear_col=(0.11, 0.05, 0.022), grime=0.45, grime_col=(0.06, 0.055, 0.05),
              mud=0, dust=0.12, dust_col=salt, streaks=0.5, streak_col=rust, waterline=((0.13, 0.03, 0.022), (0.022, 0.022, 0.022)), panel=0.04, bevel_r=0.03, ao_dist=0.4)
    DK = paint('DECK_NONSKID', (0.07, 0.075, 0.075), rough=0.85, wear=0.2, wear_col=(0.15, 0.15, 0.15), grime=0.45, mud=0, dust=0.1, dust_col=salt, streaks=0, panel=0.03,
               bevel_r=0.02, ao_dist=0.4)
    WH = paint('WHITE_PAINT', (0.70, 0.70, 0.68), rough=0.5, wear=0.3, wear_col=(0.2, 0.2, 0.2), grime=0.3, mud=0, dust=0.05, dust_col=salt, streaks=0.3, streak_col=rust, panel=0)
    ST = paint('DARK_STEEL', (0.045, 0.046, 0.047), rough=0.45, metal=0.7, wear=0.45, wear_col=(0.22, 0.21, 0.2), grime=0.35, mud=0, dust=0.1, dust_col=salt, streaks=0.2, streak_col=rust, panel=0)
    BR = paint('BRONZE', (0.36, 0.21, 0.085), rough=0.35, metal=0.9, wear=0.0, grime=0.5, grime_col=(0.08, 0.1, 0.05), mud=0, dust=0, streaks=0, panel=0)
    RB = paint('RHIB_TUBE', (0.035, 0.036, 0.036), rough=0.75, wear=0.15, wear_col=(0.1, 0.1, 0.1), grime=0.3, mud=0, dust=0.1, dust_col=salt, streaks=0.1, panel=0)
    OR = paint('LIFE_RING', (0.75, 0.13, 0.02), rough=0.6, wear=0.3, wear_col=(0.6, 0.58, 0.55), grime=0.3, mud=0, dust=0.05, dust_col=salt, streaks=0, panel=0)
    glass = glass_mat('GLASS_bridge', (0.02, 0.03, 0.04)); team = team_mat()
    red = glow_mat('GLOW_port_red', (1.0, 0.05, 0.03), 3.0); green = glow_mat('GLOW_stbd_green', (0.05, 1.0, 0.25), 3.0); white = glow_mat('GLOW_white', (1.0, 0.95, 0.85), 3.0)
    B = []
    hull, deck, transom = boat_hull('hull_shell'); assign(hull, G); assign(deck, DK); assign(transom, G)
    # paint the bulwark / toe-rail inner faces and top grey, keep the outside grey; deck dark
    # decals: hull number and diagonal TEAM stripe, shrink-wrapped onto the hull sides
    decals = []
    for s in (1, -1):
        num = text_mesh('hull_no', 'P-118', 1.05); assign(num, WH)
        num.rotation_euler = (R(90), 0, 0 if s < 0 else math.pi); num.location = (10.4, s * 3.6, 1.20)
        st = grid_plane('team_stripe', 0.85, 1.9, 4, 24); assign(st, team)
        st.rotation_euler = (R(90), R(28) * (1 if s < 0 else -1), 0 if s < 0 else math.pi); st.location = (7.4, s * 3.6, 0.98)
        wst = grid_plane('white_stripe', 0.22, 1.9, 1, 24); assign(wst, WH)
        wst.rotation_euler = st.rotation_euler.copy(); wst.location = (6.65, s * 3.6, 0.98)
        for o in (num, st, wst):
            apply_tf(o); bm = bmesh.new(); bm.from_mesh(o.data)
            if o.name.startswith('hull_no'):
                bmesh.ops.triangulate(bm, faces=bm.faces[:]); bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
            bm.to_mesh(o.data); bm.free()
            sw = o.modifiers.new('sw', 'SHRINKWRAP'); sw.target = hull; sw.wrap_method = 'PROJECT'; sw.use_project_y = True
            sw.use_negative_direction = True; sw.use_positive_direction = True; sw.offset = 0.025; sw.wrap_mode = 'OUTSIDE_SURFACE'
            lib.apply_all(o); decals.append(o)
    # trim the stripe to below the deck edge (vertices above the sheer get pulled down)
    B += [hull, deck, transom] + decals
    # skeg / keel bar (sets the 2.00 m draft), shafts, struts, propellers, rudders
    sk = profile_extrude('skeg', [(-11.0, -1.58), (-9.0, -2.00), (2.0, -2.00), (5.5, -1.68), (5.5, -1.45), (-11.0, -1.40)], 0.16, bevel=0.03, seg=1); assign(sk, G); B.append(sk)
    for s in (1, -1):
        y = s * 1.05
        B.append(M(rod('shaft', (-9.0, y, -1.02), (-13.25, y, -1.40), 0.07, 10), ST))
        B.append(M(rod('strut', (-12.2, y, -1.33), (-12.2, y * 0.85, -0.85), 0.05, 8), BR))
        B.append(M(rod('strut', (-12.2, y, -1.33), (-12.2, y * 1.25, -0.70), 0.05, 8), BR))
        hub = M(rod('prop_hub', (-13.10, y, -1.40), (-13.45, y, -1.43), 0.12, 10, r2=0.07), BR); B.append(hub)
        for k in range(4):
            a = R(45 + k * 90); c, s_ = math.cos(a), math.sin(a)
            bl = box('blade', (0.14, 0.03, 0.42), (0, 0, 0), (0, 0, R(25)), bevel=0.01, seg=1); apply_tf(bl)
            bl.rotation_euler = (a - math.pi / 2, 0, 0); bl.location = (-13.28, y + c * 0.28, -1.415 + s_ * 0.28)
            assign(bl, BR); B.append(bl)
        B.append(M(box('rudder', (0.85, 0.07, 0.90), (-14.35, y, -1.40), bevel=0.02, seg=1, taper={'bot_back': (0.12, 0, 0)}), G))
        B.append(M(rod('rudder_stock', (-14.30, y, -0.95), (-14.30, y, -0.55), 0.05, 8), ST))
    # ── superstructure: main deckhouse ──
    def outline(xf, xc, xr, wf, w): return [(xr, -w), (xc, -w), (xf, -wf), (xf, wf), (xc, w), (xr, w)]
    zb = deck_z(-1.0) - 0.15; zt1 = 4.25
    dh_b = outline(4.0, 3.2, -6.5, 1.40, 2.75); dh_t = outline(3.0, 2.3, -6.4, 1.25, 2.55)
    dh = ring_loft('deckhouse', [(dh_b, zb), (dh_t, zt1)]); lib.bev(dh, 0.03, 1, angle=30); assign(dh, G); B.append(dh)
    B.append(M(box('dh_roof_lip', (10.6, 5.2, 0.06), (-1.75, 0, zt1 + 0.03), bevel=0.01, seg=1), G))
    # deckhouse windows (small, sides) and watertight doors
    pb = [V((x, y, zb)) for x, y in dh_b]; pt = [V((x, y, zt1)) for x, y in dh_t]
    for i0, i1, hint in ((0, 1, (0, -1, 0)), (4, 5, (0, 1, 0))):
        for k, (u0, u1) in enumerate(((0.06, 0.12), (0.16, 0.22), (0.62, 0.68), (0.72, 0.78))):
            w = face_panel('dh_win', pb[i0], pb[i1], pt[i0], pt[i1], u0, u1, 0.62, 0.80, 0.015, hint); assign(w, glass); B.append(w)
        d = face_panel('door', pb[i0], pb[i1], pt[i0], pt[i1], 0.40, 0.47, 0.06, 0.76, 0.02, hint); assign(d, ST); B.append(d)
    # front windows of the deckhouse (raked face)
    for u0, u1 in ((0.08, 0.30), (0.39, 0.61), (0.70, 0.92)):
        w = face_panel('dh_fwin', pb[2], pb[3], pt[2], pt[3], u0, u1, 0.60, 0.82, 0.015, (1, 0, 0)); assign(w, glass); B.append(w)
    # life rings on the aft face, raft canisters on the roof, exhaust louvres
    for s in (1, -1):
        B.append(M(torus('life_ring', 0.30, 0.07, (-6.47, s * 1.6, zt1 - 1.15), (0, R(90), 0)), OR))
        for x in (-5.9, -4.6):
            B.append(M(cyl('raft', 0.28, 1.05, (x, s * 1.95, zt1 + 0.40), (R(90), 0, 0), verts=12, bevel=0.04, seg=1), WH))
            B.append(M(box('raft_cradle', (0.10, 1.0, 0.14), (x, s * 1.95, zt1 + 0.10)), ST))
        lv = box('louvre', (1.1, 0.03, 0.05), (-4.2, s * 2.70, zt1 - 1.50), (s * R(-2.5), 0, 0)); lib.array(lv, 5, (0, 0, 0.12)); assign(lv, ST); B.append(lv)
    B.append(M(box('id_panel', (2.0, 1.6, 0.01), (-5.1, 0, zt1 + 0.065)), team))   # air-recognition panel (TEAM_ACCENT) on the roof
    # ── bridge (pilothouse) with forward-raked windows, wings, roof visor ──
    zb2, zt2 = zt1 - 0.05, 6.25
    br_b = outline(2.40, 1.80, -2.6, 1.10, 2.35); br_t = outline(2.75, 2.05, -2.5, 1.00, 2.20)
    brg = ring_loft('bridge', [(br_b, zb2), (br_t, zt2)]); lib.bev(brg, 0.03, 1, angle=30); assign(brg, G); B.append(brg)
    B.append(M(box('visor', (5.9, 4.9, 0.10), (0.15, 0, zt2 + 0.05), bevel=0.02, seg=1, taper={'top_front': (0.35, 0, 0), 'bot_front': (0.35, 0, 0)}), G))
    qb = [V((x, y, zb2)) for x, y in br_b]; qt = [V((x, y, zt2)) for x, y in br_t]
    for i0, i1, hint, n_ in ((2, 3, (1, 0, 0), 3), (1, 2, (1, -1, 0), 2), (3, 4, (1, 1, 0), 2), (0, 1, (0, -1, 0), 3), (4, 5, (0, 1, 0), 3)):
        for k in range(n_):
            u0 = 0.05 + k * 0.9 / n_; u1 = u0 + 0.9 / n_ - 0.04
            if i0 == 0: u0, u1 = 0.45 + k * 0.17, 0.45 + k * 0.17 + 0.14
            if i0 == 4: u0, u1 = 1 - (0.45 + k * 0.17 + 0.14), 1 - (0.45 + k * 0.17)
            w = face_panel('br_win', qb[i0], qb[i1], qt[i0], qt[i1], u0, u1, 0.48, 0.86, 0.015, hint); assign(w, glass); B.append(w)
    for s in (1, -1):
        B.append(M(box('wing', (1.3, 0.85, 0.08), (0.9, s * 2.75, zt1 + 0.02), bevel=0.01, seg=1), G))
        for x in (0.3, 1.5): B.append(M(rod('wing_post', (x, s * 3.15, zt1 + 0.06), (x, s * 3.15, zt1 + 1.06), 0.025, 6), G))
        B.append(M(rod('wing_rail', (0.3, s * 3.15, zt1 + 1.06), (1.5, s * 3.15, zt1 + 1.06), 0.025, 6), G))
        B.append(M(rod('wing_rail', (1.5, s * 3.15, zt1 + 1.06), (1.5, s * 2.35, zt1 + 1.06), 0.025, 6), G))
        nl = box('sidelight', (0.10, 0.06, 0.12), (1.7, s * 2.33, zt2 - 0.9), bevel=0.01, seg=1); assign(nl, red if s > 0 else green); B.append(nl)
        B.append(M(box('sl_screen', (0.40, 0.03, 0.22), (1.55, s * 2.30, zt2 - 0.9)), ST))
        # pintle MG on each wing
        B.append(M(rod('mg_post', (1.2, s * 2.95, zt1 + 0.06), (1.2, s * 2.95, zt1 + 1.10), 0.04, 8), ST))
        B.append(M(box('mg_body', (0.55, 0.10, 0.14), (1.30, s * 2.95, zt1 + 1.18), bevel=0.01, seg=1), ST))
        B.append(M(rod('mg_barrel', (1.55, s * 2.95, zt1 + 1.20), (2.35, s * 2.95, zt1 + 1.20), 0.02, 8), ST))
    # ── mast: raked pole, radar platform + antenna, yardarm with lights, masthead light (top = 9.00 m) ──
    mx = -0.8
    B.append(M(rod('mast', (mx, 0, zt2 + 0.08), (mx - 0.28, 0, 8.82), 0.11, 10, r2=0.07), G))
    for s in (1, -1): B.append(M(rod('mast_leg', (mx + 0.9, s * 1.1, zt2 + 0.10), (mx - 0.12, 0, 7.55), 0.06, 8), G))
    B.append(M(box('radar_plat', (1.1, 1.1, 0.06), (mx - 0.14, 0, 7.58), bevel=0.01, seg=1), G))
    B.append(M(cyl('radar_ped', 0.16, 0.25, (mx - 0.14, 0, 7.73), verts=12), ST))
    B.append(M(box('radar_bar', (0.22, 2.1, 0.20), (mx - 0.14, 0, 7.96), bevel=0.04, seg=1, taper={'top_front': (-0.05, 0, 0), 'top_back': (0.05, 0, 0)}), WH))
    B.append(M(rod('yard', (mx - 0.24, -1.35, 8.30), (mx - 0.24, 1.35, 8.30), 0.04, 8), G))
    for s in (1, -1):
        l = cyl('yard_light', 0.05, 0.10, (mx - 0.24, s * 1.30, 8.39), verts=8); assign(l, white); B.append(l)
        B.append(M(rod('whip', (mx - 0.24, s * 0.9, 8.32), (mx - 0.24, s * 0.9, 8.95), 0.012, 5, r2=0.006), ST))
    ml = cyl('masthead', 0.06, 0.18, (mx - 0.28, 0, 8.91), verts=10); assign(ml, white); B.append(ml)
    B.append(M(cyl('radome_ped', 0.10, 0.30, (-2.0, 0, zt2 + 0.25), verts=10), G))
    B.append(M(sphere('radome', 0.36, (-2.0, 0, zt2 + 0.62), seg=16, rings=10), WH))
    B.append(M(cyl('satcom_ped', 0.10, 0.25, (-3.8, 1.2, zt1 + 0.17), verts=10), G))
    B.append(M(sphere('satcom', 0.42, (-3.8, 1.2, zt1 + 0.62), seg=16, rings=10), WH))
    B.append(M(cyl('searchlight', 0.18, 0.30, (2.3, 0.8, zt2 + 0.25), (0, R(90), 0), verts=12), ST))
    sll = cyl('sl_lens', 0.15, 0.02, (2.46, 0.8, zt2 + 0.25), (0, R(90), 0), verts=12); assign(sll, white); B.append(sll)
    B.append(M(cyl('horn', 0.08, 0.35, (1.9, -0.8, zt2 + 0.25), (0, R(90), 0), verts=10, r2=0.14), G))
    # ── RHIB on chocks + davit (aft deck) ──
    zr = deck_z(-11.5) + 0.88; xs_, xb_, rb = -14.30, -9.95, 0.80
    path = [V((xs_ + (xb_ - xs_) * i / 6, rb, 0)) for i in range(7)] + [V((xb_ + rb * math.sin(R(a)), rb * math.cos(R(a)), 0)) for a in range(30, 180, 30)] + [V((xb_ - (xb_ - xs_) * i / 6, -rb, 0)) for i in range(7)]
    rings = []
    for i, p in enumerate(path):
        tng = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized(); side = tng.cross(V((0, 0, 1))).normalized(); rise = 0.18 * max(0, (p.x - (xb_ - 1.5)) / 2.3)
        rings.append([p + V((0, 0, zr + rise)) + (side * math.cos(2 * math.pi * k / 8) + V((0, 0, 1)) * math.sin(2 * math.pi * k / 8)) * 0.25 for k in range(8)])
    B.append(M(loft('rhib_tube', rings), RB))
    hs = [[V((x, -0.78 * w, zr - 0.05)), V((x, 0, zr - 0.55 * w)), V((x, 0.78 * w, zr - 0.05)), V((x, 0, zr + 0.05))] for x, w in ((xs_ + 0.05, 1.0), (xb_, 1.0), (xb_ + 0.75, 0.25))]
    B.append(M(loft('rhib_hull', hs), WH))
    B.append(M(box('rhib_console', (0.55, 0.65, 0.75), (-11.7, 0, zr + 0.35), bevel=0.04, seg=1), WH))
    ws = box('rhib_screen', (0.04, 0.6, 0.25), (-11.42, 0, zr + 0.82), (0, R(-25), 0)); assign(ws, glass); B.append(ws)
    B.append(M(box('rhib_seat', (0.6, 0.5, 0.35), (-12.5, 0, zr + 0.17), bevel=0.05, seg=1), RB))
    B.append(M(box('outboard', (0.40, 0.38, 0.85), (-14.45, 0, zr + 0.05), bevel=0.05, seg=1), ST))
    for x in (-13.3, -10.8):
        B.append(M(box('chock', (0.25, 1.5, 0.40), (x, 0, deck_z(x) + 0.20), bevel=0.02, seg=1, taper={'top_left': (0, -0.3, 0), 'top_right': (0, 0.3, 0)}), ST))
    B.append(M(rod('davit_post', (-11.0, -2.75, deck_z(-11.0)), (-11.0, -2.75, zr + 1.85), 0.11, 10), G))
    B.append(M(rod('davit_boom', (-11.0, -2.75, zr + 1.80), (-11.6, -0.6, zr + 1.55), 0.08, 8), G))
    B.append(M(rod('davit_wire', (-11.6, -0.6, zr + 1.50), (-11.6, -0.6, zr + 0.95), 0.012, 4), ST))
    # ── bollards, cleats, anchor hawse, stern light ──
    for x, y in ((13.0, 0.85), (5.2, 2.85), (-6.9, 2.75), (-12.8, 2.70), (-15.2, 2.55)):
        for s in (1, -1):
            z0 = deck_z(x, y)
            B.append(M(box('bitt_base', (0.70, 0.30, 0.05), (x, s * y, z0 + 0.025), bevel=0.01, seg=1), ST))
            for dx in (-0.2, 0.2):
                B.append(M(cyl('bitt', 0.09, 0.30, (x + dx, s * y, z0 + 0.17), verts=10, bevel=0.015, seg=1), ST))
                B.append(M(cyl('bitt_cap', 0.12, 0.04, (x + dx, s * y, z0 + 0.34), verts=10), ST))
    B.append(M(box('windlass', (0.8, 0.9, 0.45), (11.8, 0, deck_z(11.8) + 0.22), bevel=0.05, seg=1), ST))
    B.append(M(rod('anchor_chain', (11.8, 0, deck_z(11.8) + 0.1), (14.2, 0, deck_z(14.2) + 0.03), 0.05, 6), ST))
    stl = box('stern_light', (0.06, 0.12, 0.12), (-15.75, 0, deck_z(-15.7) + 0.95), bevel=0.01, seg=1); assign(stl, white); B.append(stl)
    # ── railings (aft of the bulwark) and transom rail ──
    def rail_line(pts, h=(0.5, 1.0)):
        for i, p in enumerate(pts):
            B.append(M(rod('stanchion', p, p + V((0, 0, h[1])), 0.022, 5), G))
            if i:
                for hh in h: B.append(M(rod('rail', pts[i - 1] + V((0, 0, hh)), p + V((0, 0, hh)), 0.022, 5), G))
    for s in (1, -1):
        pts = []
        for x in [-15.65 + k * 1.45 for k in range(14)]:
            t = deck_t(x); _, ye, ze = boat_row(6, t); pts.append(V((x, s * (ye - 0.06), ze + 0.12)))
        rail_line(pts)
    rail_line([V((-15.82, y, boat_row(6, 0.006)[2] + 0.12)) for y in (-2.9, -1.45, 0.0, 1.45, 2.9)])
    # roof railing round the bridge roof
    for s in (1, -1): rail_line([V((x, s * 2.05, zt2 + 0.10)) for x in (-2.35, -0.6, 1.2)], h=(0.45, 0.9))
    hull_o = make('hull', B, G, pivot=(0, 0, 0))
    # ── forward deck gun (30 mm) : turret + gun + muzzle ──
    gx = 8.4; gz0 = deck_z(gx)
    Tt = [M(cyl('gun_ring', 0.78, 0.60, (gx, 0, gz0 + 0.30), verts=24), G)]
    gh_b = [(gx + 0.95 * math.cos(R(a)), 0.95 * math.sin(R(a))) for a in (0, 50, 130, 180, 230, 310)]
    gh_t = [(gx - 0.12 + 0.70 * math.cos(R(a)), 0.70 * math.sin(R(a))) for a in (0, 50, 130, 180, 230, 310)]
    gh = ring_loft('gun_house', [(gh_b, gz0 + 0.55), (gh_t, gz0 + 1.45)]); lib.bev(gh, 0.03, 1, angle=30); assign(gh, G); Tt.append(gh)
    Tt.append(M(box('gun_sight', (0.30, 0.22, 0.24), (gx - 0.2, -0.45, gz0 + 1.55), bevel=0.02, seg=1), ST))
    turret = make('turret', Tt, G, pivot=(gx, 0, gz0), par=hull_o)
    GZ = gz0 + 1.0
    Gg = [M(box('gun_mantlet', (0.40, 0.50, 0.42), (gx + 0.85, 0, GZ), bevel=0.04, seg=1), G),
          M(rod('gun_barrel', (gx + 1.0, 0, GZ), (gx + 3.15, 0, GZ), 0.055, 10), ST),
          M(rod('gun_jacket', (gx + 1.0, 0, GZ), (gx + 1.65, 0, GZ), 0.09, 10), ST),
          M(rod('gun_brake', (gx + 3.05, 0, GZ), (gx + 3.30, 0, GZ), 0.075, 10), ST)]
    gun = make('gun', Gg, G, pivot=(gx + 0.75, 0, GZ), par=turret)
    mzl = empty('muzzle', (gx + 3.30, 0, GZ), gun)
    objs = [hull_o, turret, gun, mzl]
    collect('unit_patrol_boat', objs)
    lo, hi, _, _ = measure(objs)
    notes = ('Grey naval patrol craft. Origin on the waterline (z = 0) under the hull centre; front = +X. Deep-V hard-chine hull with spray rails, '
             'raked flared bow, transom, bulwark forward and toe rail aft, skeg setting the 2.00 m draft, twin shafts / props / rudders, deckhouse and '
             'bridge with forward-raked windows, mast with radar, yardarm, nav lights and masthead light (top = +9.00 m), radome, satcom, 30 mm deck '
             'gun (turret / gun / muzzle nodes), wing MGs, RHIB with davit, life rafts and rings, bollards, railings, hull number P-118. TEAM_ACCENT: '
             'diagonal bow stripe both sides and an air-recognition panel on the deckhouse roof. Antifouling red below the waterline, black boot-top.')
    extra = {'above_water_m': 9.0, 'draft_m': 2.0, 'loa_m': 32.0, 'beam_m': 7.0, 'measured': {'above_water_m': round(hi.z, 4), 'draft_m': round(-lo.z, 4)},
             'nodes': sorted(o.name for o in objs), 'waterline_z': 0.0}
    finish('unit_patrol_boat', ['unit_patrol_boat'], [32.00, 7.00, 11.00], notes, extra,
           dict(azim=-36, elev=17, man_loc=(-8.0, -1.6, deck_z(-8.0)), ground_z=-2.0, ground=(90, 60), w=800, h=560, margin=0.9), args)


# ══════════════════════════════════════ CLI ══════════════════════════════════════
BUILDERS = {'mbt': build_mbt, 'infantry': build_infantry, 'apc': build_apc, 'harvester': build_harvester, 'patrol_boat': build_patrol_boat}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(); ap.add_argument('name', nargs='?', default='all'); ap.add_argument('--glb', action='store_true')
    ap.add_argument('--check', action='store_true'); ap.add_argument('--no-preview', action='store_true')
    args = ap.parse_args(argv)
    names = list(BUILDERS) if args.name == 'all' else [args.name.replace('unit_', '')]
    for n in names:
        t0 = time.time(); print(f'═══ {n} ═══'); BUILDERS[n](args); print(f'═══ {n} done in {time.time() - t0:.0f}s')
