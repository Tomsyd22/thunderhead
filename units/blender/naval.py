"""Thunderhead naval units: H05 Bulwark Armoured Gunboat, A05 Sentinel Missile Frigate, T05 Spectre Drone Corvette.

Usage:  /home/claude/blender-env/bin/python naval.py H05|A05|T05|all [--draft] [--pose]
  --draft : build + dims/tris + quick preview sheet of the procedural materials (no bake / no export)
  --pose  : (with --draft) also render a hero shot with the moving parts posed, to check pivots

Conventions (../CONTRACT.md): 1 BU = 1 m, Z up, +Y forward, +X = starboard (right).
Ship origin (root) = design waterline; the keel sits at z = -waterline.
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ulib
from ulib import (reset, node, pivot_mesh, join, bx, wedge, loft, tube, cyl, ball, grille, text_mark,
                  paint, gunmetal, flat, glow, glass, team, PAL, finish, assign, add_mat, set_faces_mat, set_origin,
                  parent, tris, mesh_obj, link)
import bpy, bmesh
from mathutils import Vector, Matrix, Euler

PI = math.pi
D2R = math.radians
SCRATCH = '/tmp/claude-0/-home-claude/6ea218bb-7b05-5a09-b660-8c0a9162a762/scratchpad'


# ═══════════════════════════ small maths ═══════════════════════════
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def sstep(a, b, x):
    t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def V(*a): return Vector(a if len(a) == 3 else a[0])


# ═══════════════════════════ fast batched geometry ═══════════════════════════
class Kit:
    """Accumulates many small primitives in one bmesh (no operator calls) → one mesh object with one material."""
    def __init__(s): s.bm = bmesh.new()

    def _basis(s, d):
        d = d.normalized(); ref = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        u = d.cross(ref).normalized(); v = d.cross(u).normalized(); return d, u, v

    def _ring(s, c, u, v, r, n, ph=0.0):
        return [s.bm.verts.new(c + (u * math.cos(2 * PI * i / n + ph) + v * math.sin(2 * PI * i / n + ph)) * r) for i in range(n)]

    def tube(s, a, b, r, n=6, cap=True, r2=None, ph=None):
        a, b = Vector(a), Vector(b)
        if (b - a).length < 1e-5: return
        d, u, v = s._basis(b - a); ph = (PI / n) if ph is None else ph
        ra = s._ring(a, u, v, r, n, ph); rb = s._ring(b, u, v, r if r2 is None else r2, n, ph)
        for i in range(n):
            j = (i + 1) % n; s.bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        if cap:
            s.bm.faces.new(ra[::-1]); s.bm.faces.new(rb)

    def path_tube(s, pts, r, n=6, closed=False):
        """One continuous tube through a polyline (shared rings at the joints, mitred)."""
        pts = [Vector(p) for p in pts]; m = len(pts); rings = []
        for i, p in enumerate(pts):
            if closed: a, b = pts[i - 1], pts[(i + 1) % m]
            else: a, b = pts[max(0, i - 1)], pts[min(m - 1, i + 1)]
            d, u, v = s._basis(b - a); rings.append(s._ring(p, u, v, r, n, PI / n))
        for k in range(m if closed else m - 1):
            ra, rb = rings[k], rings[(k + 1) % m]
            for i in range(n):
                j = (i + 1) % n; s.bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        if not closed:
            s.bm.faces.new(rings[0][::-1]); s.bm.faces.new(rings[-1])

    def cyl(s, c, r, h, axis='Z', n=12, r2=None, cap=True):
        c = Vector(c); d = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[axis] if isinstance(axis, str) else Vector(axis).normalized()
        s.tube(c - d * h / 2, c + d * h / 2, r, n, cap, r2, ph=0.0)

    def box(s, c, size, rot=(0, 0, 0)):
        M = Matrix.Translation(Vector(c)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(s.bm, size=1.0, matrix=M)

    def box_m(s, M, size):
        bmesh.ops.create_cube(s.bm, size=1.0, matrix=M @ Matrix.Diagonal((*size, 1)))

    def torus(s, c, R, r, axis='Z', n=16, m=6):
        c = Vector(c); w = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[axis]
        _, u, v = s._basis(w); vs = []
        for i in range(n):
            t = 2 * PI * i / n; dirr = u * math.cos(t) + v * math.sin(t)
            vs.append([s.bm.verts.new(c + dirr * (R + r * math.cos(2 * PI * j / m)) + w * r * math.sin(2 * PI * j / m)) for j in range(m)])
        for i in range(n):
            for j in range(m):
                i2, j2 = (i + 1) % n, (j + 1) % m
                s.bm.faces.new((vs[i][j], vs[i2][j], vs[i2][j2], vs[i][j2]))

    def ring(s, c, ro, ri, depth, axis='Z', n=24, pieces=1):
        """Annulus with thickness (guard rings, collars, deck rings). pieces > 1 splits it into separate arcs (better UV packing)."""
        c = Vector(c); w = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[axis]
        _, u, v = s._basis(w)
        prof = [(ro, -depth / 2), (ro, depth / 2), (ri, depth / 2), (ri, -depth / 2)]
        per = max(1, n // pieces)
        for st in range(0, n, per):
            rs = []
            for i in range(st, min(n, st + per) + 1):
                t = 2 * PI * i / n; dirr = u * math.cos(t) + v * math.sin(t)
                rs.append([s.bm.verts.new(c + dirr * rr + w * dz) for rr, dz in prof])
            for a, b in zip(rs[:-1], rs[1:]):
                for j in range(4):
                    j2 = (j + 1) % 4; s.bm.faces.new((a[j], b[j], b[j2], a[j2]))
            if pieces > 1: s.bm.faces.new(rs[0][::-1]); s.bm.faces.new(rs[-1])

    def dome(s, c, r, n=16, rings=6, zcut=0.0, sz=1.0):
        """Upper part of a sphere from height zcut*r (−1..1) to the pole, closed at the base."""
        c = Vector(c); a0 = math.asin(clamp(zcut, -0.99, 0.99)); rows = []
        for k in range(rings):
            a = a0 + (PI / 2 - a0) * k / rings
            rows.append([s.bm.verts.new(c + Vector((r * math.cos(a) * math.cos(2 * PI * i / n), r * math.cos(a) * math.sin(2 * PI * i / n), r * math.sin(a) * sz))) for i in range(n)])
        top = s.bm.verts.new(c + Vector((0, 0, r * sz)))
        for k in range(rings - 1):
            for i in range(n):
                i2 = (i + 1) % n; s.bm.faces.new((rows[k][i], rows[k][i2], rows[k + 1][i2], rows[k + 1][i]))
        for i in range(n):
            s.bm.faces.new((rows[-1][i], rows[-1][(i + 1) % n], top))
        s.bm.faces.new(rows[0][::-1])

    def sweep(s, path, prof, closed=False, piece=4):
        """Sweep a 2-D profile [(out, up), ...] (closed polygon) along a path; 'out' = right-hand horizontal normal of the path
        (for a path running +Y on the starboard side it points to +X). The sweep is split into capped pieces of `piece` spans
        with their own vertices, so smart-UV makes small islands instead of one hull-sized outline (wasted atlas)."""
        path = [Vector(p) for p in path]; m = len(path); pos = []
        for i, p in enumerate(path):
            if closed: a, b = path[i - 1], path[(i + 1) % m]
            else: a, b = path[max(0, i - 1)], path[min(m - 1, i + 1)]
            t = b - a; t.z = 0
            if t.length < 1e-6: t = Vector((0, 1, 0))
            t.normalize(); nrm = Vector((t.y, -t.x, 0))
            pos.append([p + nrm * o + Vector((0, 0, u)) for o, u in prof])
        spans = m if closed else m - 1; k = len(prof); piece = piece or spans
        for st in range(0, spans, piece):
            idx = [(st + j) % m for j in range(min(piece, spans - st) + 1)]
            rings = [[s.bm.verts.new(v) for v in pos[i]] for i in idx]
            for ra, rb in zip(rings[:-1], rings[1:]):
                for j in range(k):
                    j2 = (j + 1) % k; s.bm.faces.new((ra[j], ra[j2], rb[j2], rb[j]))
            s.bm.faces.new(rings[0][::-1]); s.bm.faces.new(rings[-1])

    def poly_prism(s, pts_xy, z0, z1, inset=0.0):
        """Plan polygon (CCW) extruded z0→z1 with the top inset (sloped walls)."""
        top = offset_poly(pts_xy, -inset) if inset else pts_xy
        b = [s.bm.verts.new((x, y, z0)) for x, y in pts_xy]; t = [s.bm.verts.new((x, y, z1)) for x, y in top]
        n = len(b)
        for i in range(n):
            j = (i + 1) % n; s.bm.faces.new((b[i], b[j], t[j], t[i]))
        s.bm.faces.new(b[::-1]); s.bm.faces.new(t)

    def obj(s, name, mat=None, recalc=True):
        if recalc: bmesh.ops.recalc_face_normals(s.bm, faces=s.bm.faces[:])
        o = mesh_obj(name, s.bm)
        if mat: assign(o, mat)
        return o


def mark(name, text, size, loc, rot=(PI / 2, 0, 0), mat=None, res=2, depth=0.0):
    """Low-poly flat text marking (ulib.text_mark with curve resolution 2 and no extrusion: ~10x fewer triangles)."""
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = text; cu.size = size; cu.extrude = depth; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    cu.resolution_u = res
    try: cu.font = bpy.data.fonts.load(ulib.FONT, check_existing=True)
    except Exception: pass
    o = bpy.data.objects.new(name, cu); link(o); o.location = loc; o.rotation_euler = rot
    bpy.context.view_layer.update()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active; o.name = name
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.002); bm.to_mesh(o.data); bm.free()
    if mat: assign(o, mat)
    return o


def offset_poly(pts, d):
    """Offset a CCW polygon outward by d (negative = inward), mitred."""
    n = len(pts); P = [Vector((x, y)) for x, y in pts]; out = []
    for i in range(n):
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        e1 = (b - a).normalized(); e2 = (c - b).normalized()
        n1 = Vector((e1.y, -e1.x)); n2 = Vector((e2.y, -e2.x)); m = (n1 + n2)
        m = m.normalized() if m.length > 1e-6 else n1
        k = d / max(0.3, m.dot(n1)); out.append((b.x + m.x * k, b.y + m.y * k))
    return out


def resample(pts, spacing, closed=False):
    """Points every ~spacing metres along a polyline (keeps the start; returns list of (point, tangent))."""
    P = [Vector(p) for p in pts]
    if closed: P = P + [P[0]]
    segs = [(P[i], P[i + 1]) for i in range(len(P) - 1)]
    L = sum((b - a).length for a, b in segs); n = max(1, round(L / spacing)); step = L / n
    out = []; acc = 0.0; si = 0; seg_start = 0.0
    for k in range(n + (0 if closed else 1)):
        d = k * step
        while si < len(segs) - 1 and seg_start + (segs[si][1] - segs[si][0]).length < d - 1e-9:
            seg_start += (segs[si][1] - segs[si][0]).length; si += 1
        a, b = segs[si]; sl = (b - a).length
        t = 0 if sl < 1e-9 else clamp((d - seg_start) / sl)
        out.append((a.lerp(b, t), (b - a).normalized() if sl > 1e-9 else Vector((0, 1, 0))))
    return out


def railing(kit, loop, h=1.0, spacing=1.35, r=0.04, rails=(0.5,), inset=0.1, closed=True, z_off=0.0, n=6):
    """Posts + top rail + mid rails following a deck-edge loop (path direction: starboard side forward)."""
    samples = resample(loop, spacing, closed)
    posts = []
    for p, t in samples:
        t2 = Vector((t.x, t.y, 0)); t2 = t2.normalized() if t2.length > 1e-6 else Vector((0, 1, 0))
        nrm = Vector((t2.y, -t2.x, 0)); b = p - nrm * inset + Vector((0, 0, z_off)); posts.append(b)
        kit.tube(b, b + Vector((0, 0, h)), r, n, cap=True)
    spans = len(posts) if closed else len(posts) - 1
    for hh in list(rails) + [h]:        # one tube per span (small UV islands; posts hide the joints)
        for i in range(spans):
            kit.tube(posts[i] + Vector((0, 0, hh)), posts[(i + 1) % len(posts)] + Vector((0, 0, hh)), r, n, cap=False)
    return posts


# ═══════════════════════════ material helpers (node layers on ulib.paint) ═══════════════════════════
class NB:
    def __init__(s, m):
        s.nt = m.node_tree; s.N = s.nt.nodes; s.L = s.nt.links
        s.tc = s.N.new('ShaderNodeTexCoord'); s.geo = s.N.new('ShaderNodeNewGeometry')
        s.sep = s.N.new('ShaderNodeSeparateXYZ'); s.L.new(s.tc.outputs['Object'], s.sep.inputs[0])
        s.nsep = s.N.new('ShaderNodeSeparateXYZ'); s.L.new(s.geo.outputs['Normal'], s.nsep.inputs[0])
        s.pos = s.tc.outputs['Object']
    def _in(s, sock, v):
        if isinstance(v, (int, float)): sock.default_value = v
        else: s.L.new(v, sock)
    def m(s, op, a, b=None, clamp=False):
        n = s.N.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp; s._in(n.inputs[0], a)
        if b is not None: s._in(n.inputs[1], b)
        return n.outputs[0]
    def X(s): return s.sep.outputs['X']
    def Y(s): return s.sep.outputs['Y']
    def Z(s): return s.sep.outputs['Z']
    def NX(s): return s.m('ABSOLUTE', s.nsep.outputs['X'])
    def NY(s): return s.m('ABSOLUTE', s.nsep.outputs['Y'])
    def NZ(s): return s.m('ABSOLUTE', s.nsep.outputs['Z'])
    def NZs(s): return s.nsep.outputs['Z']
    def mr(s, v, a, b, c=0.0, d=1.0):
        n = s.N.new('ShaderNodeMapRange'); n.clamp = True; s._in(n.inputs['Value'], v)
        n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b; n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
        return n.outputs['Result']
    def band(s, v, lo, hi, soft=0.02):
        return s.m('MULTIPLY', s.mr(v, lo - soft, lo), s.mr(v, hi, hi + soft, 1.0, 0.0))
    def mul(s, *a):
        out = a[0]
        for b in a[1:]: out = s.m('MULTIPLY', out, b)
        return out
    def rgb(s, hexc):
        n = s.N.new('ShaderNodeRGB'); n.outputs[0].default_value = (*ulib.lin(hexc), 1); return n.outputs[0]
    def mix(s, fac, a, b, blend='MIX'):
        n = s.N.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = blend; s._in(n.inputs['Factor'], fac)
        s._in(n.inputs['A'], a); s._in(n.inputs['B'], b); return n.outputs['Result']
    def noise(s, vec, scale, detail=3.0, stretch=None):
        if stretch:
            mp = s.N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch; s.L.new(vec, mp.inputs['Vector']); vec = mp.outputs['Vector']
        n = s.N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; s.L.new(vec, n.inputs['Vector'])
        return n.outputs['Fac']
    def gridline(s, v, sp, w, off=0.0):
        a = s.m('ADD', s.m('MULTIPLY', v, 1.0 / sp), 0.5 + off); f = s.m('FRACT', a)
        d = s.m('MULTIPLY', s.m('ABSOLUTE', s.m('SUBTRACT', f, 0.5)), sp)
        return s.mr(d, 0.0, w, 1.0, 0.0)
    def dist(s, c, stretch=(1, 1, 1)):
        vm = s.N.new('ShaderNodeVectorMath'); vm.operation = 'SUBTRACT'; s.L.new(s.pos, vm.inputs[0]); vm.inputs[1].default_value = c
        sc = s.N.new('ShaderNodeVectorMath'); sc.operation = 'MULTIPLY'; s.L.new(vm.outputs[0], sc.inputs[0]); sc.inputs[1].default_value = (1 / stretch[0], 1 / stretch[1], 1 / stretch[2])
        ln = s.N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; s.L.new(sc.outputs[0], ln.inputs[0])
        return ln.outputs['Value']


def _base_link(m):
    for lk in m.node_tree.links:
        if lk.from_node.bl_idname == 'ShaderNodeRGB' and lk.to_node.bl_idname == 'ShaderNodeMix' and lk.to_node.blend_type == 'MULTIPLY':
            return lk
    raise RuntimeError('base colour link not found in ' + m.name)


def base_layers(m, fn):
    """Edit the base colour of a ulib paint() material *before* grime/wear: fn(nb, col_socket) -> new col socket."""
    lk = _base_link(m); src, dst = lk.from_socket, lk.to_socket; nb = NB(m)
    nb.L.new(fn(nb, src), dst); return m


def post_layers(m, fn):
    """Edit the final colour (after grime/wear): fn(nb, col_socket) -> new col socket."""
    b = m.node_tree.nodes['Principled BSDF']; src = b.inputs['Base Color'].links[0].from_socket; nb = NB(m)
    nb.L.new(fn(nb, src), b.inputs['Base Color']); return m


def plating(nb, col, sx=1.8, sy=1.5, sz=0.9, w=0.012, depth=0.32, tone=0.08, offs=(0.0, 0.0, 0.0)):
    """Rectangular plate seams (darkened) + slight per-plate tone variation, oriented by face normal."""
    lx = nb.m('MULTIPLY', nb.gridline(nb.X(), sx, w, offs[0]), nb.m('SUBTRACT', 1.0, nb.NX()))
    ly = nb.m('MULTIPLY', nb.gridline(nb.Y(), sy, w, offs[1]), nb.m('SUBTRACT', 1.0, nb.NY()))
    lz = nb.m('MULTIPLY', nb.gridline(nb.Z(), sz, w, offs[2]), nb.m('SUBTRACT', 1.0, nb.NZ()))
    seam = nb.m('MAXIMUM', nb.m('MAXIMUM', lx, ly), lz)
    snap = nb.N.new('ShaderNodeVectorMath'); snap.operation = 'SNAP'; nb.L.new(nb.pos, snap.inputs[0]); snap.inputs[1].default_value = (sx, sy, sz)
    wn = nb.N.new('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '3D'; nb.L.new(snap.outputs[0], wn.inputs['Vector'])
    t = nb.m('ADD', nb.m('MULTIPLY', wn.outputs['Value'], tone), 1.0 - tone / 2)
    col = nb.mix(1.0, col, nb.m('MULTIPLY', t, nb.m('SUBTRACT', 1.0, nb.m('MULTIPLY', seam, depth))), 'MULTIPLY')
    return col


def streaks(nb, col, color, amount=0.35, z0=-0.2, z1=1.6, scale=2.5, stretch=14.0, thresh=0.56, side=True):
    """Vertical runs (salt / rust) on side faces, strongest just below z1 and fading towards z0."""
    n = nb.noise(nb.pos, scale, 4.0, stretch=(1.0, 1.0, 1.0 / stretch))
    s = nb.mr(n, thresh, thresh + 0.1)
    zf = nb.mr(nb.Z(), z0, z1)
    f = nb.mul(s, zf, amount)
    if side: f = nb.m('MULTIPLY', f, nb.mr(nb.NZ(), 0.7, 0.4))
    return nb.mix(f, col, nb.rgb(color))


def spot(nb, col, c, r, color, amount=0.8, stretch=(1, 1, 1), noisy=True):
    d = nb.dist(c, stretch); f = nb.mr(d, r, r * 0.25, 0.0, amount)
    if noisy: f = nb.m('MULTIPLY', f, nb.mr(nb.noise(nb.pos, 9.0, 5.0), 0.35, 0.6))
    return nb.mix(f, col, nb.rgb(color))


def hazard_mat(name, scale=0.6, period=0.5, yellow='#D2A21E', black='#1A1A1A'):
    m = paint(name, yellow, scale=scale, rough=0.6, metal=0.05, grime=0.45, wear=0.4, wear_col='#5A5752', noise=0.2)
    def fn(nb, col):
        s = nb.m('ADD', nb.m('ADD', nb.X(), nb.Y()), nb.Z())
        st = nb.m('LESS_THAN', nb.m('FRACT', nb.m('MULTIPLY', s, 1.0 / period)), 0.5)
        return nb.mix(st, col, nb.rgb(black))
    return base_layers(m, fn)


# ═══════════════════════════ hull helpers ═══════════════════════════
def ring_from_half(half):
    """half = [(0, z_keel), ..., (0, z_deck_centre)] starboard half-section (x ≥ 0) → full closed ring."""
    return list(half) + [(-x, z) for x, z in reversed(half[1:-1])]


def hull_loft(name, ys, half_fn, xoff=0.0):
    secs = [(y, [(x + xoff, z) for x, z in ring_from_half(half_fn(y))]) for y in ys]
    return loft(name, secs)


def bisect_z(o, zs):
    bm = bmesh.new(); bm.from_mesh(o.data)
    for z in zs:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    bm.to_mesh(o.data); bm.free(); o.data.update(); return o


def paint_waterline(o, af, boot, deck=None, boot_top=0.22, deck_nz=0.6, deck_zmin=0.6):
    if deck: set_faces_mat(o, deck, lambda c, n: n.z > deck_nz and c.z > deck_zmin)
    set_faces_mat(o, boot, lambda c, n: 0.0 < c.z < boot_top and n.z < deck_nz)
    set_faces_mat(o, af, lambda c, n: c.z < 0.0)


def edge_loop(ys, edge_fn):
    """Closed deck-edge loop: starboard stern→bow, port bow→stern. edge_fn(y) -> (half_width, z)."""
    R = [Vector((edge_fn(y)[0], y, edge_fn(y)[1])) for y in ys]
    Lp = [Vector((-p.x, p.y, p.z)) for p in reversed(R)]
    return R + Lp


def anchor(kit, c, rot_z, s=1.0):
    """Stockless anchor hanging flat against a hull side; c = top (shackle) point, faces local +X."""
    M0 = Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot_z, 4, 'Z')
    def B(off, size, rx=0.0, ry=0.0):
        kit.box_m(M0 @ Matrix.Translation(Vector(off) * s) @ Euler((rx, ry, 0)).to_matrix().to_4x4(), [v * s for v in size])
    B((0, 0, -0.42), (0.1, 0.12, 0.78))                 # shank
    B((0, 0, -0.84), (0.14, 0.5, 0.12))                  # crown
    B((0, 0.2, -0.7), (0.1, 0.11, 0.36), rx=D2R(28))     # flukes
    B((0, -0.2, -0.7), (0.1, 0.11, 0.36), rx=D2R(-28))
    B((0, 0.27, -0.52), (0.12, 0.09, 0.12))
    B((0, -0.27, -0.52), (0.12, 0.09, 0.12))
    p = M0 @ Vector((0, 0, 0.0)); kit.torus(p, 0.09 * s, 0.025 * s, 'X', 10, 4)


def bollard_pair(kit, c, along=(0, 1, 0), h=0.38, r=0.11, gap=0.42):
    c = Vector(c); a = Vector(along).normalized()
    kit.box(c + Vector((0, 0, 0.03)), (abs(a.x) * gap * 1.6 + 0.34, abs(a.y) * gap * 1.6 + 0.34, 0.06))
    for sgn in (-1, 1):
        p = c + a * gap / 2 * sgn
        kit.cyl(p + Vector((0, 0, h / 2)), r, h, 'Z', 8)
        kit.cyl(p + Vector((0, 0, h)), r * 1.3, 0.05, 'Z', 8)


def vent(kit, c, r=0.15, h=0.45):
    c = Vector(c); kit.cyl(c + Vector((0, 0, h / 2)), r * 0.6, h, 'Z', 8)
    kit.cyl(c + Vector((0, 0, h + 0.05)), r, 0.12, 'Z', 10, r2=r * 0.5)


def ladder(kit, a, b, w=0.45, step=0.3, r=0.04, side=(1, 0, 0)):
    a, b = Vector(a), Vector(b); sd = Vector(side).normalized() * w / 2
    kit.tube(a - sd, b - sd, r, 5); kit.tube(a + sd, b + sd, r, 5)
    n = max(2, int((b - a).length / step))
    for i in range(1, n):
        p = a.lerp(b, i / n); kit.tube(p - sd, p + sd, r, 5, cap=False)


def propeller(kit, c, R, blades=4, hub=0.14, pitch=D2R(32), chord=0.32, thick=0.05, hub_len=0.36):
    c = Vector(c)
    kit.cyl(c, hub, hub_len, 'Y', 12)
    kit.tube(c - Vector((0, hub_len / 2, 0)), c - Vector((0, hub_len / 2 + hub * 1.3, 0)), hub * 0.95, 12, r2=0.02)
    span = R - hub * 0.6
    for k in range(blades):
        ph = 2 * PI * k / blades + 0.3; rr = hub * 0.6 + span / 2
        M = Matrix.Translation(c + Vector((math.cos(ph), 0, math.sin(ph))) * rr) @ Matrix.Rotation(PI / 2 - ph, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'Z')
        kit.box_m(M, (chord, thick, span))
        kit.box_m(M @ Matrix.Translation(Vector((0, 0, span * 0.42))) @ Matrix.Rotation(0.0, 4, 'Z'), (chord * 0.75, thick * 0.9, span * 0.2))


# ═══════════════════════════ shared finishing ═══════════════════════════
def report_tris(objs):
    rows = sorted(((tris([o]), o.name) for o in objs if o.type == 'MESH'), reverse=True)
    print('TRIS', ' | '.join(f'{n}:{t}' for t, n in rows[:30]))

def _clean_materials_fixed(objs):
    """Drop-in replacement for ulib._clean_materials (same duplicate-slot merge) that RESTORES the per-face material indices:
    in Blender 4.x Mesh.materials.clear() deletes the material_index attribute, so the ulib version collapsed every face of a
    multi-material mesh onto slot 0 (GLASS / TEAM / GLOW faces silently became <UID>_paint). Patched at runtime only."""
    for o in objs:
        me = o.data; names = [m.name if m else None for m in me.materials]
        uniq = []
        for n in names:
            if n not in uniq: uniq.append(n)
        if len(uniq) == len(names): continue
        remap = [uniq.index(n) for n in names]; mats = [bpy.data.materials.get(n) for n in uniq]
        idx = [remap[p.material_index] for p in me.polygons]
        me.materials.clear()
        for m in mats: me.materials.append(m)
        me.polygons.foreach_set('material_index', idx); me.update()

ulib._clean_materials = _clean_materials_fixed


def zero_bake_metal():
    """Cycles' DIFFUSE/COLOR bake pass is albedo × (1 − metallic): metallic paint would bake dark (gunmetal 0.75 → 25 %).
    Painted ship steel is a dielectric anyway, so bake every atlas material as metallic 0 (the exported atlas material then
    averages to metallic 0 too)."""
    for m in bpy.data.materials:
        if m.get('bake') and m.node_tree and 'Principled BSDF' in m.node_tree.nodes:
            m.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.0


def draft_or_finish(uid, root, wl, draft, pose_fn=None):
    zero_bake_metal()
    if not draft:
        return finish(uid, root, size=2048, samples=16, extras={'waterline_m': wl})
    objs = [o for o in bpy.data.objects if not o.name.startswith('_')]
    meshes = [o for o in objs if o.type == 'MESH' and not o.hide_render]
    rep, lo, hi = ulib.check_dims(uid, meshes)
    print(f'[{uid}] DRAFT tris {tris(meshes)} (budget {ulib.SPEC[uid]["budget"][0]}), objects {len(objs)}')
    print(f'[{uid}] nodes:', sorted(o.name for o in objs))
    if '--pose' in sys.argv and pose_fn:
        pose_fn(); posed_hero(uid, lo, hi)
        return
    ulib.preview_sheet(uid, lo, hi, samples=8)


def posed_hero(uid, lo, hi):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = 8; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('_w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.56, 0.58, 1)
    sun = link(bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN'))); sun.data.energy = 3.2
    sun.rotation_euler = Euler((D2R(42), D2R(18), D2R(-38)))
    c = (lo + hi) / 2; ext = hi - lo; R = max(ext)
    for tag, loc in (('poseA', (c.x + R * 1.0, c.y + R * 0.9, c.z + R * 0.7)), ('poseB', (c.x - R * 0.9, c.y - R * 1.0, c.z + R * 0.6))):
        cam = ulib._cam('_hero', loc, (c.x, c.y, c.z), lens=45); sc.camera = cam
        sc.render.resolution_x = 960; sc.render.resolution_y = 640
        sc.render.filepath = os.path.join(SCRATCH, f'{uid}_{tag}.png'); bpy.ops.render.render(write_still=True)
        print('posed render', sc.render.filepath)


# ═══════════════════════════════════════════════════════════════════════
#  H05  BULWARK ARMOURED GUNBOAT  (Iron Legion)  22 × 6.4 × 7.0 m, WL 1.4
# ═══════════════════════════════════════════════════════════════════════
H_Y0, H_Y1, H_CR = -10.55, 11.0, 0.05

def h05_deck(y): return 1.72 + 0.40 * sstep(0.5, 11.0, y)

def h05_dw(y):
    t = clamp((y - 3.8) / (H_Y1 - 3.8)); s = clamp((-y - 8.0) / 2.55)
    return (0.55 + (3.2 - 0.55) * (1 - t ** 2.0)) * (1 - 0.03 * s), t, s

def h05_half(y):
    dw, t, s = h05_dw(y); zd = h05_deck(y)
    zk = -1.4 + 2.3 * sstep(6.0, 11.05, y) ** 1.25 + 0.15 * s
    mz = lambda z: zk + (z + 1.4) / (1.72 + 1.4) * (zd - zk)
    xs = [0.0, max(0.04, 1.35 * (1 - t) ** 1.3), dw * (0.88 - 0.1 * t), dw * 0.965, dw]
    zs = [-1.4, -1.3, -0.38, 0.5, 1.72]
    pts = [(x, mz(z)) for x, z in zip(xs, zs)]
    return pts + [(dw * 0.5, zd + 0.75 * H_CR), (0.0, zd + H_CR)]

def h05_side_x(y, z):
    """Hull surface half-width at (y, z) (above the chine) — for placing fittings flush on the side."""
    h = h05_half(y); (x3, z3), (x4, z4) = h[3], h[4]
    if z >= z3: return lerp(x3, x4, clamp((z - z3) / max(1e-6, z4 - z3)))
    (x2, z2) = h[2]; return lerp(x2, x3, clamp((z - z2) / max(1e-6, z3 - z2)))


def build_H05(draft=False):
    reset(); uid = 'H05'; WL = 1.4
    root = node('root')
    P = PAL['H']
    # ── materials ──
    hullm = paint('h_hull', '#64635E', scale=6, rough=0.62, metal=0.3, grime=0.5, wear=0.28, wear_col='#86837C', noise=0.3)
    def hull_base(nb, col):
        col = plating(nb, col, sx=2.0, sy=1.75, sz=0.85, w=0.022, depth=0.45, tone=0.17)
        # Iron Legion oxide-red diagonal flashes on the bow and quarter (both sides)
        side = nb.mr(nb.NX(), 0.45, 0.6)
        zz = nb.band(nb.Z(), 0.28, 2.2, 0.01)
        d = nb.m('SUBTRACT', nb.Y(), nb.m('MULTIPLY', nb.Z(), 0.9))
        f = nb.mul(nb.m('MAXIMUM', nb.band(d, 4.2, 5.5, 0.015), nb.band(d, -9.75, -8.95, 0.015)), side, zz)
        return nb.mix(f, col, nb.rgb(P['primary']))
    base_layers(hullm, hull_base)
    def hull_post(nb, col):
        col = streaks(nb, col, '#ADA89B', amount=0.45, z0=0.15, z1=2.0, scale=2.2, stretch=16, thresh=0.58)
        col = streaks(nb, col, '#5E4330', amount=0.36, z0=0.4, z1=2.0, scale=3.1, stretch=20, thresh=0.64)
        for sx in (-1, 1):   # rust weeping from the hawse pipes / anchors
            col = spot(nb, col, (sx * 1.72, 8.7, 1.0), 0.75, '#6A3A1E', 0.75, stretch=(1, 0.8, 2.4))
        return col
    post_layers(hullm, hull_post)
    deckm = paint('h_deck', '#55534F', scale=4, rough=0.8, metal=0.2, grime=0.6, wear=0.2, wear_col='#6E6B66', noise=0.3)
    base_layers(deckm, lambda nb, col: plating(nb, col, sx=1.2, sy=2.4, sz=1.0, w=0.018, depth=0.4, tone=0.16))
    steel = paint('h_steel', '#676661', scale=3, rough=0.6, metal=0.3, grime=0.5, wear=0.3, wear_col='#8A877F', noise=0.28)
    base_layers(steel, lambda nb, col: plating(nb, col, sx=1.3, sy=1.3, sz=0.8, w=0.016, depth=0.42, tone=0.15))
    post_layers(steel, lambda nb, col: streaks(nb, col, '#A6A194', amount=0.38, z0=1.8, z1=4.5, scale=3.0, stretch=10, thresh=0.6))
    red = paint('h_red', P['primary'], scale=2, rough=0.62, metal=0.2, grime=0.45, wear=0.6, wear_col='#33322F', noise=0.3)
    dark = gunmetal('h_dark', '#2E2E2D', scale=1.0, wear=0.45)
    af = paint('h_af', '#232933', scale=6, rough=0.85, metal=0.1, grime=0.25, wear=0.05, noise=0.22)
    post_layers(af, lambda nb, col: streaks(nb, col, '#3A3F44', amount=0.35, z0=-1.4, z1=0.0, scale=2.0, stretch=10, thresh=0.55))
    boot = paint('h_boot', '#121314', scale=4, rough=0.7, grime=0.2, wear=0.05)
    ivory = paint('h_ivory', P['ivory'], scale=1, rough=0.6, metal=0.05, grime=0.35, wear=0.35, wear_col='#4A4945')
    bronze = paint('h_bronze', '#A57C45', scale=1, rough=0.35, metal=0.85, grime=0.4, wear=0.3, wear_col='#D9B47B', noise=0.15)
    rust = paint('h_rust', '#4E3526', scale=0.6, rough=0.85, metal=0.4, grime=0.5, wear=0.45, wear_col='#8A5A34')
    orange = paint('h_orange', '#C4532B', scale=0.5, rough=0.5, grime=0.3, wear=0.25, wear_col='#E9E2D3')
    raft = paint('h_raft', '#BDB194', scale=0.8, rough=0.7, grime=0.45, wear=0.15)
    black = flat('h_black', '#161616', 0.7)
    lamp = flat('h_lamp', '#FFC27A', 0.3)
    lampr = flat('h_lampr', '#E0402A', 0.3)
    lampb = flat('h_lampb', '#3A7BD5', 0.3)
    hazard = hazard_mat('h_hazard')
    GL = glass('GLASS', '#7A5A26')
    TM = team(2.0)
    soot = paint('h_stack', '#4A3B31', scale=0.8, rough=0.8, metal=0.3, grime=0.5, wear=0.4, wear_col='#7A5638', noise=0.35)
    post_layers(soot, lambda nb, col: spot(nb, spot(nb, col, (-1.2, -7.4, 4.3), 0.9, '#0B0B0B', 0.9, (1, 1, 1.4)), (1.2, -7.4, 4.3), 0.9, '#0B0B0B', 0.9, (1, 1, 1.4)))

    S = []   # static parts → joined into 'hull'

    # ── hull ──
    ys = [H_Y0, -10.3, -9.4, -8.0, -6.0, -3.5, -1.0, 1.5, 3.8, 4.9, 5.9, 6.8, 7.6, 8.3, 8.9, 9.45, 9.9, 10.3, 10.62, 10.85, H_Y1]
    hull = hull_loft('hull_shell', ys, h05_half)
    bisect_z(hull, (0.0, 0.22))
    assign(hull, hullm); paint_waterline(hull, af, boot, deckm, 0.22)
    ulib.smooth(hull, 26)
    S.append(hull)

    # deck-edge geometry
    yy = [H_Y0 + 0.02] + [y for y in ys[1:-1]] + [H_Y1 - 0.005]
    loop = edge_loop(yy, lambda y: (h05_dw(y)[0], h05_deck(y)))
    k = Kit(); k.sweep(loop, [(-0.06, -0.05), (0.05, -0.05), (0.05, 0.16), (-0.06, 0.16)], closed=True); S.append(k.obj('gunwale', steel))
    # knuckle rubbing strake, both sides
    k = Kit()
    for sgn in (1, -1):
        yl = [y for y in ys if -10.5 <= y <= 9.0]
        path = [Vector((sgn * (h05_half(y)[3][0] + 0.02), y, h05_half(y)[3][1])) for y in yl]
        if sgn < 0: path = path[::-1]
        k.sweep(path, [(-0.03, -0.05), (0.06, -0.035), (0.06, 0.035), (-0.03, 0.05)])
    S.append(k.obj('strake', steel))
    # railings (deck edge loop, cabin roof)
    k = Kit()
    rloop = [p + Vector((0, 0, 0.16)) for p in loop]
    railing(k, rloop, h=0.9, spacing=1.3, r=0.04, rails=(0.45,), inset=0.08)
    S.append(k.obj('rails', dark))

    # ── cabin (deckhouse + wheelhouse) ──
    Z0 = 1.74; Z1 = Z0 + 1.6; ZR = Z1 + 1.15
    DHW, DHI, WHW, WHI = 2.15, 0.2, 1.8, 0.25
    dhx = lambda z: DHW - DHI * (z - Z0) / 1.6          # deckhouse side half-width at height z
    whx = lambda z: WHW - WHI * (z - Z1) / 1.15         # wheelhouse side half-width
    S.append(wedge('deckhouse', (2 * DHW, 7.4, 1.6), (0, -2.25, Z0 + 0.8), moves=[('TR', (-DHI, 0, 0)), ('TL', (DHI, 0, 0)), ('TF', (0, -0.4, 0))], bevel=0.05, mat=steel))
    S.append(wedge('wheelhouse', (2 * WHW, 4.4, 1.15), (0, -1.25, Z1 + 0.575), moves=[('TR', (-WHI, 0, 0)), ('TL', (WHI, 0, 0)), ('TF', (0, -0.55, 0))], bevel=0.04, mat=steel))
    S.append(bx('brow', (2 * (WHW - WHI) + 0.3, 0.45, 0.07), (0, 0.52, ZR - 0.02), rot=(D2R(-6), 0, 0), bevel=0.02, mat=steel))
    k = Kit()
    for sx in (-1.25, -0.45, 0.45, 1.25): k.box((sx, 0.7, ZR - 0.07), (0.16, 0.08, 0.06))
    S.append(k.obj('brow_lamps', lamp))
    S.append(bx('roofcap', (2 * (WHW - WHI) - 0.1, 3.7, 0.08), (0, -1.55, ZR + 0.03), bevel=0.02, mat=steel))
    # windows: sloped front (5 panes), sides (3 per side), rear (2)
    a = math.atan2(0.55, 1.15); nf = Vector((0, math.cos(a), math.sin(a)))
    k = Kit(); kf = Kit()
    for i in range(5):
        xc = (i - 2) * 0.66; c = Vector((xc, 0.609, 4.053)) + nf * 0.012
        k.box(c, (0.58, 0.03, 0.6), rot=(a, 0, 0))
        kf.box(c - nf * 0.008, (0.68, 0.03, 0.7), rot=(a, 0, 0))
    b = math.atan2(WHI, 1.15)
    for sgn in (1, -1):
        for yc in (0.05, -0.95, -1.95):
            xs = whx(4.05) + 0.012
            k.box((sgn * xs, yc, 4.05), (0.03, 0.78, 0.48), rot=(0, -sgn * b, 0))
            kf.box((sgn * (xs - 0.008), yc, 4.05), (0.03, 0.88, 0.58), rot=(0, -sgn * b, 0))
    for xc in (-0.65, 0.65):
        k.box((xc, -3.465, 4.05), (0.62, 0.03, 0.42)); kf.box((xc, -3.458, 4.05), (0.72, 0.03, 0.52))
    S.append(k.obj('windows', GL)); S.append(kf.obj('winframes', dark))
    # oxide-red armour plates on the cabin sides + ivory numbers + doors + life rings + side vent grilles
    c_ang = math.atan2(DHI, 1.6)
    k = Kit(); kd = Kit(); ko = Kit()
    for sgn in (1, -1):
        k.box((sgn * (dhx(2.55) + 0.03), -0.3, 2.55), (0.06, 2.6, 1.1), rot=(0, -sgn * c_ang, 0))
        k.box((sgn * (whx(3.62) + 0.02), -0.55, 3.62), (0.05, 1.9, 0.38), rot=(0, -sgn * b, 0))
        kd.box((sgn * (dhx(2.45) + 0.025), -4.95, 2.45), (0.05, 0.78, 1.38), rot=(0, -sgn * c_ang, 0))
        kd.box((sgn * (dhx(2.45) + 0.065), -4.7, 2.45), (0.06, 0.06, 0.2))
        ko.torus((sgn * (dhx(2.5) + 0.05), -2.4, 2.5), 0.3, 0.065, 'X', 12, 6)
        S.append(grille(f'cabvent_{sgn}', 0.9, 0.55, 4, depth=0.04, slat=0.35, loc=(sgn * (dhx(2.45) + 0.03), -3.9, 2.45), rot=(0, sgn * c_ang, -sgn * PI / 2), mat=dark))
    S.append(k.obj('cabin_red', red)); S.append(kd.obj('doors', dark)); S.append(ko.obj('liferings', orange))
    for sgn in (1, -1):
        S.append(mark(f'cabin_no_{sgn}', 'H05', 0.55, (sgn * (dhx(2.85) + 0.012), -2.95, 2.95), rot=(PI / 2 - c_ang, 0, sgn * PI / 2), mat=ivory))
    # hull numbers on the bow flanks
    for sgn in (1, -1):
        z = 1.08; y = 2.0; x = h05_side_x(y, z) + 0.02
        S.append(mark(f'hull_no_{sgn}', 'H05', 1.0, (sgn * x, y, z), rot=(PI / 2 + D2R(5), 0, sgn * PI / 2), mat=ivory))

    # ── roof equipment ──
    k = Kit(); kl = Kit(); kg = Kit(); kt = Kit(); kb = Kit()
    rx = WHW - WHI - 0.08
    railing(k, [Vector((x, y, ZR + 0.07)) for x, y in [(-rx, -3.38), (-rx, 0.3), (rx, 0.3), (rx, -3.38)]], h=0.6, spacing=1.0, r=0.04, rails=(0.3,), inset=0.0, n=5)
    k.cyl((0, -1.55, ZR + 0.22), 0.3, 0.4, 'Z', 12)                         # radome pedestal
    k.cyl((0, -1.55, ZR + 0.45), 0.55, 0.06, 'Z', 16)                      # platform
    kb.dome((0, -1.55, ZR + 0.48 + 0.13), 0.44, 16, 6, zcut=-0.3)            # radome (ivory)
    k.tube((0, -2.95, ZR + 0.05), (0, -2.95, 5.6), 0.06, 8)                 # mast
    k.tube((-0.62, -2.95, 5.22), (0.62, -2.95, 5.22), 0.04, 6)              # yard
    kl.cyl((0.66, -2.95, 5.22), 0.06, 0.1, 'Z', 8); kl.cyl((-0.66, -2.95, 5.22), 0.06, 0.1, 'Z', 8)
    for sx in (-1.3, 1.3):
        k.tube((sx, -3.2, ZR + 0.05), (sx, -3.2, 5.45), 0.04, 6)            # whip antennas
        k.cyl((sx, 0.05, ZR + 0.17), 0.05, 0.25, 'Z', 8)                     # searchlights
        k.cyl((sx, 0.05, ZR + 0.42), 0.16, 0.32, 'Y', 12)
        kg.cyl((sx, 0.215, ZR + 0.42), 0.13, 0.02, 'Y', 12)
    k.box((0.8, -2.5, ZR + 0.2), (0.45, 0.5, 0.32)); k.box((-0.85, -2.35, ZR + 0.17), (0.4, 0.6, 0.26))
    k.tube((0.45, -0.35, ZR + 0.05), (0.45, -0.35, ZR + 0.38), 0.04, 6); k.tube((0.45, -0.35, ZR + 0.36), (0.45, -0.1, ZR + 0.4), 0.06, 8, r2=0.1)   # horn
    kt.box((0, -0.55, ZR + 0.08), (1.5, 1.0, 0.02))                          # TEAM roof panel
    S += [k.obj('roofkit', dark), kl.obj('roofl', lamp), kg.obj('roofglass', GL), kt.obj('roofteam', TM), kb.obj('radome', ivory)]

    # ── engine casing, stacks, aft deck ──
    S.append(wedge('casing', (3.9, 2.7, 1.1), (0, -7.3, Z0 + 0.55), moves=[('TR', (-0.15, 0, 0)), ('TL', (0.15, 0, 0)), ('TB', (0, 0.25, 0))], bevel=0.04, mat=steel))
    k = Kit(); kt = Kit(); kd = Kit()
    for sx in (-1.2, 1.2):
        k.tube((sx, -7.1, Z0 + 0.9), (sx, -7.4, 4.3), 0.32, 16)
        k.ring((sx, -7.4, 4.3), 0.36, 0.26, 0.12, 'Z', 16)
        k.ring((sx, -7.15, 3.0), 0.38, 0.3, 0.14, 'Z', 16)
        kd.cyl((sx, -7.4, 4.28), 0.27, 0.04, 'Z', 14)
        kt.ring((sx, -7.28, 3.7), 0.345, 0.31, 0.2, 'Z', 16)
    S += [k.obj('stacks', soot), kt.obj('stack_team', TM), kd.obj('stack_bore', black)]
    for sgn in (1, -1):
        S.append(grille(f'louvre_{sgn}', 1.4, 0.6, 5, depth=0.05, slat=0.35, loc=(sgn * 1.89, -7.2, 2.25), rot=(0, 0, -sgn * PI / 2), mat=dark))
    S.append(grille('engine_grille', 1.6, 1.0, 6, depth=0.06, slat=0.4, loc=(0, -9.55, h05_deck(-9.5) + 0.06), rot=(PI / 2, 0, 0), mat=dark))
    k = Kit()
    k.box((0, -9.55, h05_deck(-9.5) + 0.03), (1.75, 1.15, 0.08))
    k.box((-1.55, -9.4, h05_deck(-9.4) + 0.05), (0.75, 0.75, 0.1)); k.box((-1.55, -9.4, h05_deck(-9.4) + 0.12), (0.12, 0.4, 0.06))
    ladder(k, (0, -5.98, Z0), (0, -5.98, Z1 + 0.6), w=0.5); ladder(k, (0.7, -3.48, Z1), (0.7, -3.48, ZR + 0.65), w=0.45)
    # life-raft canisters on cradles, both side decks
    kr = Kit()
    for sgn in (1, -1):
        x = sgn * 2.66; z = h05_deck(-2.3) + 0.46
        kr.cyl((x, -2.3, z), 0.3, 1.25, 'Y', 14); kr.cyl((x, -2.3 + 0.66, z), 0.22, 0.08, 'Y', 12); kr.cyl((x, -2.3 - 0.66, z), 0.22, 0.08, 'Y', 12)
        for yo in (-0.4, 0.4):
            k.box((x, -2.3 + yo, h05_deck(-2.3) + 0.12), (0.5, 0.1, 0.24)); k.ring((x, -2.3 + yo, z), 0.315, 0.295, 0.06, 'Y', 14)
    S += [kr.obj('rafts', raft)]

    # ── foredeck fittings ──
    kb2 = Kit()
    def dz(y): return h05_deck(y) + H_CR * 0.6
    # windlass
    k.box((0, 8.05, dz(8.05) + 0.12), (1.5, 0.7, 0.25)); k.box((0, 8.05, dz(8.05) + 0.42), (0.42, 0.55, 0.45))
    for sx in (-0.5, 0.5):
        k.cyl((sx, 8.05, dz(8.05) + 0.48), 0.26, 0.3, 'X', 14); k.cyl((sx * 1.28, 8.05, dz(8.05) + 0.48), 0.33, 0.04, 'X', 14)
        kb2.path_tube([(sx, 8.3, dz(8.3) + 0.5), (sx * 1.45, 8.9, dz(8.9) + 0.12), (sx * 1.7, 9.25, dz(9.25) + 0.05)], 0.06, 6)
        k.cyl((sx * 1.75, 9.3, dz(9.3) + 0.03), 0.16, 0.08, 'Z', 12)
    for c, al in [((1.35, 9.45), (0, 1, 0)), ((-1.35, 9.45), (0, 1, 0)), ((2.45, 6.1), (0, 1, 0)), ((-2.45, 6.1), (0, 1, 0)),
                  ((2.55, -9.85), (0, 1, 0)), ((-2.55, -9.85), (0, 1, 0)), ((2.6, -5.0), (0, 1, 0)), ((-2.6, -5.0), (0, 1, 0))]:
        bollard_pair(k, (c[0], c[1], dz(c[1])), al)
    for c in [(1.25, 7.0), (-1.25, 7.0), (2.3, -8.2), (-2.3, -8.2), (1.9, 0.9), (-1.9, 0.9)]:
        vent(k, (c[0], c[1], dz(c[1])))
    k.box((1.45, 5.65, dz(5.65) + 0.05), (0.85, 0.85, 0.1)); k.box((1.45, 5.65, dz(5.65) + 0.13), (0.4, 0.08, 0.06))
    for sx in (-2.15, 2.15):     # ready-ammunition lockers beside the turret
        k.box((sx, 1.75, dz(1.75) + 0.32), (0.75, 1.1, 0.64))
        k.box((sx, 1.75, dz(1.75) + 0.66), (0.8, 1.15, 0.05))
    k.tube((0, 10.75, dz(10.75)), (0, 10.75, dz(10.75) + 1.3), 0.04, 6)     # jackstaff
    S += [k.obj('fittings', dark), kb2.obj('chain', rust)]
    # anchors + hawse pipes on both bow flanks
    k = Kit(); kh = Kit()
    for sgn in (1, -1):
        y = 8.7; z = 1.55; x = h05_side_x(y, z)
        dwdy = (h05_dw(y + 0.05)[0] - h05_dw(y - 0.05)[0]) / 0.1
        ang = math.atan2(-dwdy, 1.0)            # outward normal tilted forward
        rz = sgn * ang if sgn > 0 else PI - ang
        nrm = Vector((math.cos(rz), math.sin(rz), 0))
        kh.cyl(Vector((sgn * x, y, z + 0.08)) + nrm * 0.03, 0.17, 0.12, nrm, 12)
        anchor(k, Vector((sgn * x, y, z)) + nrm * 0.1, rz, 1.0)
    S += [k.obj('anchors', rust), kh.obj('hawse', dark)]
    # deck markings: turret-arc ring (yellow) + hazard strips
    k = Kit(); k.ring((0, 3.5, dz(3.5) + 0.004), 2.0, 1.88, 0.012, 'Z', 40, pieces=8)
    S.append(k.obj('deck_ring', flat('h_yellow', '#C79A22', 0.6)))
    k = Kit()
    k.box((0, 5.75, dz(5.75) + 0.005), (2.2, 0.16, 0.012))
    for sgn in (1, -1):
        k.box((sgn * 2.75, -9.0, dz(-9.0) + 0.005), (0.16, 2.2, 0.012))
    S.append(k.obj('hazards', hazard))
    # lamps on the bow face / transom
    k = Kit()
    for sx in (-0.5, 0.5): k.box((sx, 10.93, 1.98), (0.18, 0.06, 0.1))
    for sx in (-2.5, 2.5): k.box((sx, H_Y0 - 0.03, 1.45), (0.2, 0.06, 0.12))
    S.append(k.obj('lamps', lamp))
    # scuppers along the deck edge (salt runs below them)
    k = Kit()
    for sgn in (1, -1):
        for y in (-8.5, -6.0, -3.5, -1.0, 1.5, 4.0):
            z = h05_deck(y) - 0.32; x = h05_side_x(y, z) + 0.01
            k.box((sgn * x, y, z), (0.04, 0.32, 0.12))
    S.append(k.obj('scuppers', black))

    # ── transom: prop guards, exhaust outlets, ladder ──
    k = Kit(); kd = Kit()
    for sx in (-1.7, 1.7):
        k.ring((sx, -10.86, -0.58), 0.78, 0.67, 0.52, 'Y', 24)
        for bxo in (-0.36, 0.0, 0.36):   # guard grid bars across the aft face of the duct
            hh = 2 * math.sqrt(max(0.0, 0.7 ** 2 - bxo ** 2)); k.box((sx + bxo, -11.1, -0.58), (0.05, 0.05, hh))
        k.box((sx, -11.1, -0.58), (1.36, 0.05, 0.05))
        k.tube((sx, -10.86, 0.15), (sx, -10.45, 0.6), 0.07, 6)
        k.tube((sx * 0.58, -10.86, -0.58), (sx * 0.58, -10.45, -0.58), 0.06, 6)
        k.tube((sx, -10.62, -0.58), (sx, -10.2, -0.58), 0.09, 8)                 # shaft
        k.box((sx, -10.6, -1.2), (0.12, 0.6, 0.22))                               # skeg foot
    for sx in (-0.8, 0.8):
        k.cyl((sx, H_Y0 - 0.07, 0.7), 0.2, 0.16, 'Y', 14); kd.cyl((sx, H_Y0 - 0.15, 0.7), 0.15, 0.02, 'Y', 12)
    ladder(k, (2.35, H_Y0 - 0.06, 0.1), (2.35, H_Y0 - 0.06, 1.75), w=0.4, side=(1, 0, 0))
    S += [k.obj('transom_kit', dark), kd.obj('exh_bore', black)]

    # ── barbette (static) ──
    TP = Vector((0, 3.5, 2.08))
    k = Kit(); k.cyl((0, 3.5, (dz(3.5) + TP.z) / 2 - 0.02), 1.75, TP.z - dz(3.5) + 0.04, 'Z', 28)
    k.ring((0, 3.5, TP.z - 0.02), 1.81, 1.6, 0.05, 'Z', 28, pieces=4)
    S.append(k.obj('barbette', steel))

    # ── turret → gun → recoil → muzzle ──
    def tsec(hwb, hwt, h): return [(hwb, 0.0), (hwb + 0.07, 0.42 * h), (hwt, h), (-hwt, h), (-(hwb + 0.07), 0.42 * h), (-hwb, 0.0)]
    tsecs = [(-1.55, tsec(1.0, 0.8, 0.95)), (-1.25, tsec(1.35, 1.05, 1.08)), (0.15, tsec(1.45, 1.12, 1.10)), (0.85, tsec(1.4, 1.02, 1.04)), (1.35, tsec(1.12, 0.72, 0.62))]
    tb = loft('turret_body', [(TP.y + y, [(x, TP.z + z) for x, z in sec]) for y, sec in tsecs])
    assign(tb, steel)
    set_faces_mat(tb, red, lambda c, n: c.y > TP.y + 0.1 and n.z < 0.85)
    ulib.lib.bev(tb, 0.035, 1, 30)
    tparts = [tb]
    k = Kit(); kt = Kit(); kl = Kit(); kr2 = Kit()
    k.cyl((0, TP.y, TP.z + 0.04), 1.5, 0.08, 'Z', 32)                       # race
    top = TP.z + 1.10
    k.cyl((-0.5, TP.y - 0.45, top + 0.11), 0.32, 0.22, 'Z', 16); k.cyl((-0.5, TP.y - 0.45, top + 0.24), 0.26, 0.05, 'Z', 16)
    for i in range(5):
        a_ = D2R(-60 + 30 * i); k.box((-0.5 + 0.3 * math.sin(a_), TP.y - 0.45 + 0.3 * math.cos(a_), top + 0.12), (0.1, 0.06, 0.08), rot=(0, 0, -a_))
    k.cyl((0.55, TP.y - 0.6, top + 0.03), 0.28, 0.06, 'Z', 14)
    k.box((0.35, TP.y + 0.45, top + 0.07), (0.16, 0.22, 0.14)); k.box((-0.1, TP.y + 0.55, top + 0.06), (0.14, 0.2, 0.12))
    k.box((0, TP.y - 1.72, TP.z + 0.48), (1.7, 0.32, 0.56))                  # bustle stowage
    for sgn in (1, -1):
        k.path_tube([(sgn * 1.47, TP.y - 0.9, TP.z + 0.6), (sgn * 1.55, TP.y - 0.9, TP.z + 0.75), (sgn * 1.55, TP.y + 0.2, TP.z + 0.75), (sgn * 1.47, TP.y + 0.2, TP.z + 0.6)], 0.04, 5)
        for j in range(3):   # smoke dischargers
            kr2.tube((sgn * (1.18 - j * 0.03), TP.y + 0.55 + j * 0.16, TP.z + 0.95), (sgn * (1.32 - j * 0.03), TP.y + 0.75 + j * 0.16, TP.z + 1.15), 0.055, 8)
    kt.box((0, TP.y - 0.95, top + 0.005), (1.5, 0.45, 0.015))                # TEAM roof stripe
    kl.box((0.82, TP.y + 1.33, TP.z + 0.25), (0.09, 0.05, 0.09)); kl.box((-0.82, TP.y + 1.33, TP.z + 0.25), (0.09, 0.05, 0.09))
    tparts += [k.obj('t_kit', steel), kt.obj('t_team', TM), kr2.obj('t_smoke', dark)]
    tl = kl.obj('t_lamps', lampr); tparts.append(tl)
    TS = 1.1    # turret drawn at 1/1.1 scale above, scaled up about the ring centre (chunkier, art-like)
    for o in tparts:
        o.data.transform(Matrix.Translation(TP) @ Matrix.Diagonal((TS, TS, TS, 1)) @ Matrix.Translation(-TP))
    turret = pivot_mesh('turret', tparts, TP, root)
    turret['yaw_limit_deg'] = 135.0     # |yaw| beyond ~145° puts the muzzle into the deckhouse
    TR = Vector((0, TP.y + 1.0 * TS, TP.z + 0.62 * TS))
    k = Kit()
    k.box((0, TR.y + 0.33, TR.z), (0.95, 0.55, 0.66))
    k.cyl((0, TR.y + 0.74, TR.z), 0.22, 0.3, 'Y', 16)
    k.cyl((0, TR.y, TR.z), 0.13, 1.1, 'X', 12)                                # trunnion pins
    gunm = k.obj('gun_mantlet', red)
    ulib.lib.bev(gunm, 0.03, 1, 30)
    gun = pivot_mesh('gun', [gunm], TR, turret)
    k = Kit()
    k.cyl((0, TR.y + 0.85, TR.z), 0.175, 0.5, 'Y', 16)
    k.tube((0, TR.y + 1.08, TR.z), (0, TR.y + 2.22, TR.z), 0.125, 16)
    k.tube((0, TR.y + 1.32, TR.z), (0, TR.y + 1.42, TR.z), 0.125, 16, r2=0.16); k.cyl((0, TR.y + 1.54, TR.z), 0.16, 0.24, 'Y', 16)
    k.tube((0, TR.y + 1.66, TR.z), (0, TR.y + 1.76, TR.z), 0.16, 16, r2=0.125)
    k.cyl((0, TR.y + 2.31, TR.z), 0.155, 0.18, 'Y', 16)
    barrel = k.obj('barrel', dark)
    k = Kit(); k.cyl((0, TR.y + 2.402, TR.z), 0.075, 0.01, 'Y', 12); bore = k.obj('bore', black)
    recoil = pivot_mesh('recoil', [barrel, bore], TR, gun)
    node('muzzle', (0, TR.y + 2.4, TR.z), recoil)

    # ── propellers ──
    for nm, sx in (('prop_L', -1.7), ('prop_R', 1.7)):
        k = Kit(); propeller(k, (sx, -10.86, -0.58), 0.62, blades=4, hub=0.14, pitch=D2R(34), chord=0.34, thick=0.045, hub_len=0.34)
        pivot_mesh(nm, [k.obj(nm + '_m', bronze)], (sx, -10.86, -0.58), root)

    # ── static hull join + sockets ──
    if draft: report_tris(S + [turret, gun, recoil])
    hullo = join('hull', S); ulib.smooth(hullo, 35); parent(hullo, root)
    ulib.smooth(turret, 35)
    node('fx_wake_L', (-3.05, 6.5, 0.0), root); node('fx_wake_R', (3.05, 6.5, 0.0), root)
    node('fx_wake_stern', (0.0, -11.1, 0.0), root)
    node('fx_exhaust_L', (-1.2, -7.4, 4.35), root); node('fx_exhaust_R', (1.2, -7.4, 4.35), root)
    node('hit', (0, 0.5, 1.8), root); node('badge', (0, 0, 6.4), root)

    def pose():
        turret.rotation_euler.z = D2R(-55); gun.rotation_euler.x = D2R(14); recoil.location.y -= 0.18
        bpy.data.objects['prop_L'].rotation_euler.y = D2R(30)
    return draft_or_finish(uid, root, WL, draft, pose)


# ═══════════════════════════ generic side helpers ═══════════════════════════
def side_x(half_fn, y, z):
    """Half-width of a hull (from its half-section function) at station y and height z (keel → deck edge polyline)."""
    h = half_fn(y); pts = h[:len(h) - 2]
    if z >= pts[-1][1]: return pts[-1][0]
    for (x1, z1), (x2, z2) in zip(pts[:-1], pts[1:]):
        if z1 <= z <= z2 and z2 > z1 + 1e-9: return lerp(x1, x2, (z - z1) / (z2 - z1))
    return pts[0][0]


def side_decal(kit, half_fn, sgn, quad_yz, rows=6, cols=3, off=0.018, xoff=0.0):
    """Thin single-sided panel conforming to the hull side. quad_yz = (y,z) corners [aft-low, fwd-low, fwd-high, aft-high].
    Faces wound so the normal points outboard (sgn=+1 → +X)."""
    bl, br, tr, tl = [Vector(p) for p in quad_yz]; G = []
    for i in range(rows + 1):
        f = i / rows; a = bl.lerp(tl, f); b = br.lerp(tr, f); row = []
        for j in range(cols + 1):
            p = a.lerp(b, j / cols); x = side_x(half_fn, p.x, p.y) + off
            row.append(kit.bm.verts.new((sgn * x + xoff, p.x, p.y)))
        G.append(row)
    for i in range(rows):
        for j in range(cols):
            q = (G[i][j], G[i][j + 1], G[i + 1][j + 1], G[i + 1][j])
            kit.bm.faces.new(q if sgn > 0 else q[::-1])


def hull_mark(name, text, size, half_fn, y, z, sgn, mat, off=0.03):
    """Text marking lying on the hull side at (y, z), facing outboard and following the local flare."""
    rz = outward_rz(half_fn, y, z, sgn)
    flare = math.atan2(side_x(half_fn, y, z + 0.15) - side_x(half_fn, y, z - 0.15), 0.3)
    x = side_x(half_fn, y, z) + off; c = Vector((sgn * x, y, z))
    c += Vector((math.cos(rz), math.sin(rz), 0)) * 0.0
    return mark(name, text, size, c, rot=(PI / 2 + flare, 0, rz + PI / 2), mat=mat)


def outward_rz(half_fn, y, z, sgn):
    """Yaw (about Z) that turns local +X into the outboard hull normal at (y, z) on side sgn."""
    d = (side_x(half_fn, y + 0.05, z) - side_x(half_fn, y - 0.05, z)) / 0.1
    a = math.atan2(-d, 1.0)
    return a if sgn > 0 else PI - a


# ═══════════════════════════════════════════════════════════════════════
#  A05  SENTINEL MISSILE FRIGATE  (Vanguard Alliance)  40 × 9 × 12 m, WL 2.2
# ═══════════════════════════════════════════════════════════════════════
A_Y0, A_Y1, A_CR = -19.8, 20.0, 0.07

def a05_deck(y): return 2.45 + 0.8 * sstep(-2.0, 20.0, y) ** 1.5 - 0.4 * sstep(-6.6, -8.2, y)

def a05_half(y):
    t = clamp(y / A_Y1); s = clamp((-y - 8.0) / 11.8)
    zd = a05_deck(y)
    zk = -2.2 + 2.9 * sstep(15.0, 20.05, y) ** 1.4 + 1.6 * sstep(-10.0, -18.8, y)
    fd = 1 - 0.965 * t ** 1.7; fk = 1 - 0.975 * t ** 1.45; fs = 1 - 0.985 * t ** 1.2; fb = 1 - 0.99 * t ** 1.0; fbot = (1 - t) ** 1.5
    xs = [0.0, 0.45 * fbot + 0.02, (2.4 + 0.9 * s) * fbot, (3.45 + 0.35 * s) * fb, 4.0 * fb, 4.18 * fs, 4.36 * fk, 4.5 * fd]
    xs = [x * (1 - 0.025 * s) for x in xs]
    zs = [-2.2, -2.17, -2.0, -1.68, -1.05, -0.2, 1.5, 2.45]
    mz = lambda z: zk + (z + 2.2) / (2.45 + 2.2) * (zd - zk)
    pts = [(x, mz(z)) for x, z in zip(xs, zs)]
    return pts + [(xs[-1] * 0.5, zd + 0.7 * A_CR), (0.0, zd + A_CR)]

def a05_dw(y): return a05_half(y)[-3][0]


def build_A05(draft=False):
    reset(); uid = 'A05'; WL = 2.2; P = PAL['A']
    root = node('root')
    # ── materials ──
    hullm = paint('a_hull', '#8A9197', scale=8, rough=0.55, metal=0.25, grime=0.38, wear=0.22, wear_col='#B9BEC1', noise=0.22)
    base_layers(hullm, lambda nb, col: plating(nb, col, sx=2.2, sy=2.4, sz=0.95, w=0.02, depth=0.38, tone=0.15))
    post_layers(hullm, lambda nb, col: streaks(nb, streaks(nb, col, '#5F5347', 0.45, 0.25, 3.2, 3.2, 24, 0.62), '#D6D9D7', 0.3, 0.1, 3.2, 2.4, 14, 0.6))
    deckm = paint('a_deck', '#5D646A', scale=5, rough=0.82, metal=0.2, grime=0.45, wear=0.15, wear_col='#8D9398', noise=0.25)
    base_layers(deckm, lambda nb, col: plating(nb, col, sx=1.5, sy=2.5, sz=1.0, w=0.018, depth=0.35, tone=0.15))
    steel = paint('a_steel', '#959CA1', scale=3, rough=0.55, metal=0.25, grime=0.38, wear=0.22, wear_col='#C7CBCD', noise=0.22)
    base_layers(steel, lambda nb, col: plating(nb, col, sx=1.4, sy=1.4, sz=0.9, w=0.016, depth=0.36, tone=0.13))
    post_layers(steel, lambda nb, col: streaks(nb, col, '#6A5E50', amount=0.18, z0=1.6, z1=7.0, scale=3.0, stretch=12, thresh=0.66))
    panel = paint('a_panel', '#A6ADB1', scale=2, rough=0.5, metal=0.2, grime=0.32, wear=0.2, wear_col='#D8DCDD', noise=0.18)
    base_layers(panel, lambda nb, col: plating(nb, col, sx=0.8, sy=1.1, sz=0.8, w=0.008, depth=0.25, tone=0.06))
    dark = gunmetal('a_dark', '#2F3337', scale=1.0, wear=0.35)
    af = paint('a_af', '#1B2330', scale=8, rough=0.85, metal=0.1, grime=0.25, wear=0.04, noise=0.2)
    post_layers(af, lambda nb, col: streaks(nb, col, '#2F3B4B', amount=0.35, z0=-2.2, z1=0.0, scale=2.0, stretch=10, thresh=0.55))
    boot = paint('a_boot', '#0F1217', scale=4, rough=0.7, grime=0.2, wear=0.04)
    navy = paint('a_navy', P['primary'], scale=1, rough=0.5, grime=0.25, wear=0.15, wear_col='#C9CED1')
    ivory = paint('a_ivory', P['ivory'], scale=1, rough=0.55, grime=0.3, wear=0.25, wear_col='#5D6266')
    white = paint('a_white', '#D9DCDA', scale=1, rough=0.45, metal=0.05, grime=0.22, wear=0.06, noise=0.1)
    bronze = paint('a_bronze', '#A57C45', scale=1, rough=0.35, metal=0.85, grime=0.35, wear=0.3, wear_col='#D9B47B', noise=0.15)
    orange = paint('a_orange', '#D0592B', scale=0.5, rough=0.5, grime=0.25, wear=0.2, wear_col='#EEE8DA')
    raft = paint('a_raft', '#D3D5D0', scale=0.8, rough=0.6, grime=0.35, wear=0.1)
    yellow = flat('a_yellow', '#C9A230', 0.6)
    hazard = hazard_mat('a_hazard')
    radarm = paint('a_radar', '#A3AAAE', scale=1.0, rough=0.4, metal=0.3, grime=0.12, wear=0.05, noise=0.08)
    base_layers(radarm, lambda nb, col: plating(nb, col, sx=0.2, sy=0.2, sz=0.2, w=0.006, depth=0.3, tone=0.04))
    lamp = flat('a_lamp', '#FFB347', 0.3)
    black = flat('a_black', '#121417', 0.7)
    missile = paint('a_missile', '#D8DAD6', scale=0.5, rough=0.4, grime=0.2, wear=0.1)
    GL = glass('GLASS', '#7A5A26')
    TM = team(3.0)
    S = []
    dz = lambda y: a05_deck(y) + A_CR * 0.6

    # ── hull ──
    ys = [A_Y0, -19.5, -18.5, -16.5, -14.0, -11.0, -8.6, -7.4, -6.3, -4.0, -1.0, 2.0, 5.0, 8.0, 10.5, 12.5, 14.3, 15.8, 17.0, 18.0, 18.8, 19.4, 19.8, A_Y1]
    hull = hull_loft('hull_shell', ys, a05_half)
    bisect_z(hull, (0.0, 0.25))
    assign(hull, hullm); paint_waterline(hull, af, boot, deckm, 0.25)
    ulib.smooth(hull, 30); S.append(hull)
    yy = [A_Y0 + 0.02] + ys[1:-1] + [A_Y1 - 0.004]
    loop = edge_loop(yy, lambda y: (a05_dw(y), a05_deck(y)))
    k = Kit(); k.sweep(loop, [(-0.07, -0.05), (0.05, -0.05), (0.05, 0.14), (-0.07, 0.14)], closed=True); S.append(k.obj('gunwale', steel))
    k = Kit(); railing(k, [p + Vector((0, 0, 0.14)) for p in loop], h=0.95, spacing=1.6, r=0.04, rails=(0.48,), inset=0.09); S.append(k.obj('rails', steel))
    # skeg, rudders, shafts, A-brackets
    k = Kit()
    sk = ulib.side_prism('skeg', [(-8.0, -1.9), (-9.2, -2.2), (-16.4, -2.2), (-17.6, -1.2), (-17.6, -0.6), (-8.0, -0.6)][::-1], 0.26, mat=dark)
    S.append(sk)
    for sx in (-1.75, 1.75):
        k.tube((sx, -12.5, -1.52), (sx, -16.8, -1.4), 0.12, 10)
        k.tube((sx, -16.2, -1.41), (sx - 0.45, -16.2, -0.7), 0.06, 6); k.tube((sx, -16.2, -1.41), (sx + 0.45, -16.2, -0.7), 0.06, 6)
        k.cyl((sx, -16.2, -1.41), 0.16, 0.35, 'Y', 10)
        k.box((sx, -18.45, -1.15), (0.14, 1.05, 1.5))
    S.append(k.obj('running_gear', dark))

    # ── markings on the hull: A05 numbers, TEAM diagonal stripes ──
    for sgn in (1, -1):
        S.append(hull_mark(f'hull_no_{sgn}', 'A05', 1.75, a05_half, 12.4, 1.55, sgn, ivory))
    k = Kit()
    for sgn in (1, -1):
        for y0 in (6.4, 7.35):
            side_decal(k, a05_half, sgn, [(y0 - 1.45, 0.45), (y0 - 0.9, 0.45), (y0 + 0.35, a05_deck(y0) - 0.2), (y0 - 0.2, a05_deck(y0) - 0.2)], rows=6, cols=2)
        y0 = -11.8
        side_decal(k, a05_half, sgn, [(y0 - 1.4, 0.45), (y0 - 0.6, 0.45), (y0 + 0.6, a05_deck(y0) - 0.2), (y0 - 0.2, a05_deck(y0) - 0.2)], rows=6, cols=2)
    S.append(k.obj('team_stripes', TM, recalc=False))

    # ── superstructure ──
    L1 = [(3.6, -6.4), (3.6, 4.0), (2.3, 5.6), (-2.3, 5.6), (-3.6, 4.0), (-3.6, -6.4)]
    L2 = [(2.6, -3.4), (2.6, 2.2), (1.8, 3.1), (-1.8, 3.1), (-2.6, 2.2), (-2.6, -3.4)]
    Z1a, Z1b, Z2b = 2.4, 5.0, 6.0
    k = Kit(); k.poly_prism(L1, Z1a, Z1b, inset=0.15); k.poly_prism(L2, Z1b - 0.02, Z2b, inset=0.1)
    k.poly_prism(offset_poly(offset_poly(L1, -0.15), 0.14), Z1b - 0.06, Z1b + 0.03)          # brow / roof edge
    k.poly_prism(offset_poly(offset_poly(L2, -0.1), 0.06), Z2b - 0.04, Z2b + 0.03)
    MT = [(1.0, -1.7), (1.0, 0.5), (-1.0, 0.5), (-1.0, -1.7)]
    k.poly_prism(MT, Z2b - 0.02, 7.55, inset=0.4)                                              # mast tower
    k.poly_prism([(1.3, -1.95), (1.3, 0.75), (-1.3, 0.75), (-1.3, -1.95)], 6.85, 6.93)          # mast platform
    k.poly_prism([(1.3, -4.85), (1.3, -3.45), (-1.3, -3.45), (-1.3, -4.85)], Z1b - 0.02, 6.05, inset=0.18)   # funnel
    S.append(k.obj('superstructure', steel))
    # windows: L1 bridge band (front + chamfers), L2 small windows
    k = Kit(); kf = Kit()
    zc, hh = 4.5, 0.55; ins = 0.15 * (zc - Z1a) / (Z1b - Z1a)
    for i in range(6):
        xc = (i - 2.5) * 0.7; c = (xc, 5.6 - ins + 0.02, zc)
        k.box(c, (0.6, 0.04, hh)); kf.box((xc, 5.6 - ins + 0.008, zc), (0.7, 0.03, hh + 0.12))
    for sgn in (1, -1):
        a0 = Vector((sgn * 2.3, 5.6)); a1 = Vector((sgn * 3.6, 4.0)); nrm = Vector((sgn * 1.6, 1.3)).normalized()
        rz = math.atan2(-nrm.x, nrm.y)
        for f in (0.28, 0.72):
            p = a0.lerp(a1, f) - nrm * ins + nrm * 0.02
            k.box((p.x, p.y, zc), (0.72, 0.04, hh), rot=(0, 0, rz)); q = p - nrm * 0.012; kf.box((q.x, q.y, zc), (0.82, 0.03, hh + 0.12), rot=(0, 0, rz))
        for yc in (1.6, 0.6, -0.4):   # L2 side windows
            k.box((sgn * (2.6 - 0.06 + 0.02), yc, 5.5), (0.04, 0.6, 0.34)); kf.box((sgn * (2.6 - 0.06 + 0.008), yc, 5.5), (0.03, 0.7, 0.44))
    for xc in (-0.9, 0.0, 0.9):
        k.box((xc, 3.1 - 0.05 + 0.02, 5.5), (0.6, 0.04, 0.34)); kf.box((xc, 3.1 - 0.05 + 0.008, 5.5), (0.7, 0.03, 0.44))
    S += [k.obj('windows', GL), kf.obj('winframes', dark)]
    # L1 sides: emblem panel, V chevron, life rings, doors, raft canisters
    k = Kit(); kn = Kit(); ko = Kit(); kd = Kit(); kr = Kit(); kp = Kit()
    xw = lambda z: 3.6 - 0.15 * (z - Z1a) / (Z1b - Z1a)
    for sgn in (1, -1):
        x = sgn * (xw(3.65) + 0.02)
        kp.box((x, 0.6, 3.65), (0.04, 1.8, 1.35))
        for d in (-1, 1):   # chevron "V" with wings (Vanguard emblem)
            kn.box((x + sgn * 0.02, 0.6 + d * 0.22, 3.6), (0.03, 0.2, 0.82), rot=(-d * D2R(27), 0, 0))
            kn.box((x + sgn * 0.02, 0.6 + d * 0.62, 3.97), (0.03, 0.46, 0.11), rot=(d * D2R(14), 0, 0))
        ko.torus((sgn * (xw(3.35) + 0.06), -0.95, 3.35), 0.32, 0.07, 'X', 12, 6)
        for yd in (-2.2, -5.3):
            kd.box((sgn * (xw(3.25) + 0.025), yd, 3.25), (0.05, 0.85, 1.7)); kd.box((sgn * (xw(3.25) + 0.06), yd + 0.3, 3.25), (0.05, 0.06, 0.18))
        for yr in (-3.3, -4.4):
            kr.cyl((sgn * 3.98, yr, 3.6), 0.3, 0.95, 'Y', 12)
            k.box((sgn * 3.78, yr, 3.27), (0.36, 0.7, 0.08)); k.ring((sgn * 3.98, yr, 3.6), 0.315, 0.3, 0.06, 'Y', 12)
        S.append(grille(f'vent_{sgn}', 1.0, 0.6, 4, depth=0.04, slat=0.35, loc=(sgn * (xw(4.2) + 0.02), -3.85, 4.2), rot=(0, 0, -sgn * PI / 2), mat=dark))
    S += [kp.obj('emblem_panel', white), kn.obj('emblem', navy), ko.obj('liferings', orange), kd.obj('doors', dark), kr.obj('rafts', raft)]

    # roof gear: domes, antennas, searchlights, railings, ladders
    kb = Kit(); kl = Kit(); kg = Kit()
    k.cyl((0, 1.85, Z2b + 0.17), 0.36, 0.34, 'Z', 14); kb.dome((0, 1.85, Z2b + 0.34 + 0.15), 0.62, 18, 7, zcut=-0.25)
    for sgn in (1, -1):
        k.cyl((sgn * 1.9, -2.55, Z2b + 0.12), 0.24, 0.24, 'Z', 12); kb.dome((sgn * 1.9, -2.55, Z2b + 0.24 + 0.1), 0.36, 14, 5, zcut=-0.25)
        k.tube((sgn * 2.35, -3.15, Z2b), (sgn * 2.35, -3.15, 9.1), 0.045, 6)
        k.tube((sgn * 3.25, -6.0, Z1b), (sgn * 3.25, -6.0, 8.5), 0.045, 6)
        k.tube((sgn * 0.9, 17.6, dz(17.6)), (sgn * 0.9, 17.6, dz(17.6) + 3.2), 0.045, 6)
        k.cyl((sgn * 2.45, 4.55, Z1b + 0.16), 0.05, 0.3, 'Z', 8); k.cyl((sgn * 2.45, 4.55, Z1b + 0.42), 0.17, 0.34, 'Y', 12)
        kg.cyl((sgn * 2.45, 4.73, Z1b + 0.42), 0.14, 0.02, 'Y', 12)
    k.cyl((0, -5.6, Z1b + 0.25), 0.36, 0.5, 'Z', 12); kb.dome((0, -5.6, Z1b + 0.5 + 0.14), 0.55, 16, 6, zcut=-0.25)
    for sx in (-0.55, 0.55):
        k.cyl((sx, -4.15, 6.15), 0.24, 0.2, 'Z', 12)
    S.append(grille('funnel_grille', 1.6, 0.9, 5, depth=0.04, slat=0.4, loc=(0, -4.15, 6.07), rot=(PI / 2, 0, 0), mat=dark))
    # mast: EW pods, yard, lights
    k.tube((-1.75, -0.6, 7.3), (1.75, -0.6, 7.3), 0.06, 6)
    for sgn in (1, -1):
        k.box((sgn * 1.55, -0.6, 7.1), (0.22, 0.22, 0.32)); kl.cyl((sgn * 1.8, -0.6, 7.3), 0.07, 0.12, 'Z', 8)
        k.box((sgn * 0.62, 0.15, 6.45), (0.3, 0.32, 0.45)); k.box((sgn * 0.55, -1.4, 6.45), (0.3, 0.3, 0.42))
    for sgn in (1, -1):                                   # lattice bracing on the mast tower sides + rear
        for zb_, zt_ in ((6.0, 6.85), (6.95, 7.5)):
            xa = 1.0 - 0.4 * (zb_ - 6.0) / 1.55; xb = 1.0 - 0.4 * (zt_ - 6.0) / 1.55
            k.tube((sgn * (xa + 0.03), -1.6, zb_), (sgn * (xb + 0.03), 0.4, zt_), 0.04, 5)
            k.tube((sgn * (xa + 0.03), 0.4, zb_), (sgn * (xb + 0.03), -1.6, zt_), 0.04, 5)
    k.tube((-1.2, -0.6, 6.55), (1.2, -0.6, 6.55), 0.05, 6)                    # lower yard
    for sx in (-1.05, 1.05): k.box((sx, -0.6, 6.42), (0.18, 0.18, 0.26))
    kb.dome((0, 0.62, 6.35), 0.32, 14, 5, zcut=-0.9)                          # EW dome on the mast face
    k.poly_prism([(0.75, -1.05), (0.75, -0.15), (-0.75, -0.15), (-0.75, -1.05)], 7.42, 7.48)   # upper platform
    railing(k, [Vector((x, y, 6.93)) for x, y in [(-1.22, -1.87), (-1.22, 0.67), (1.22, 0.67), (1.22, -1.87)]], h=0.7, spacing=0.9, r=0.04, rails=(), inset=0.0, n=5)
    railing(k, [Vector((p[0], p[1], Z1b + 0.03)) for p in offset_poly(L1, -0.28)][::-1], h=0.85, spacing=1.4, r=0.04, rails=(0.42,), inset=0.0, n=5)
    ladder(k, (2.7, -6.45, dz(-6.45)), (2.7, -6.45, Z1b + 0.7), w=0.5); ladder(k, (-2.05, -3.45, Z1b), (-2.05, -3.45, Z2b + 0.6), w=0.45)
    S += [k.obj('roofkit', steel), kb.obj('domes', white), kl.obj('mastlights', lamp), kg.obj('searchglass', GL)]

    # ── foredeck: windlass, anchors in pockets, bollards, vents, deck lines ──
    k = Kit(); kc = Kit(); ky = Kit(); kh = Kit()
    for sx in (-0.8, 0.8):
        k.cyl((sx, 14.4, dz(14.4) + 0.2), 0.27, 0.4, 'Z', 12); k.cyl((sx, 14.4, dz(14.4) + 0.43), 0.33, 0.06, 'Z', 12)
        k.cyl((sx * 1.5, 15.3, dz(15.3) + 0.03), 0.17, 0.08, 'Z', 10)
        kc.path_tube([(sx, 14.65, dz(14.65) + 0.25), (sx * 1.3, 15.0, dz(15.0) + 0.08), (sx * 1.5, 15.3, dz(15.3) + 0.05)], 0.055, 6)
    for c in [(1.0, 16.6), (-1.0, 16.6), (2.25, 12.6), (-2.25, 12.6), (3.4, 4.6), (-3.4, 4.6), (3.75, -10.4), (-3.75, -10.4), (3.6, -17.8), (-3.6, -17.8)]:
        bollard_pair(k, (c[0], c[1], dz(c[1])))
    for c in [(1.6, 13.1), (-1.6, 13.1), (3.0, -8.9), (-3.0, -8.9), (3.0, -6.9), (-3.0, -6.9)]:
        vent(k, (c[0], c[1], dz(c[1])), r=0.16, h=0.5)
    for c in [(0.0, 13.2), (2.2, -17.2), (-2.2, -17.2)]:
        k.box((c[0], c[1], dz(c[1]) + 0.05), (0.9, 0.9, 0.1)); k.box((c[0], c[1], dz(c[1]) + 0.12), (0.45, 0.08, 0.06))
    k.tube((0, 19.55, dz(19.55)), (0, 19.55, dz(19.55) + 1.5), 0.045, 6)                                  # jackstaff
    k.tube((0, -19.6, dz(-19.6)), (0, -19.6, dz(-19.6) + 1.7), 0.045, 6)                                  # ensign staff
    for sgn in (1, -1):    # anchor pockets
        y, z = 15.6, 2.2; rz = outward_rz(a05_half, y, z, sgn)
        nrm = Vector((math.cos(rz), math.sin(rz), 0)); p = Vector((sgn * side_x(a05_half, y, z), y, z))
        kh.box_m(Matrix.Translation(p + nrm * 0.0) @ Matrix.Rotation(rz, 4, 'Z'), (0.12, 1.0, 1.2))
        anchor(kc, p + nrm * 0.1 + Vector((0, 0, 0.4)), rz, 1.05)
    # deck lines: yellow outline round the missile banks, aft deck lines; TEAM band across the aft deck
    for (x0, y0, x1, y1) in [(-2.05, 6.55, 2.05, 6.55), (-2.05, 12.05, 2.05, 12.05), (-2.05, 6.55, -2.05, 12.05), (2.05, 6.55, 2.05, 12.05),
                             (-2.7, -8.6, -2.7, -18.8), (2.7, -8.6, 2.7, -18.8), (-1.4, -12.9, 1.4, -12.9), (-1.4, -16.3, 1.4, -16.3)]:
        ym = (y0 + y1) / 2; ky.box(((x0 + x1) / 2, ym, dz(ym) + 0.004 + 0.012 * (abs(y1 - y0) > 1)), (abs(x1 - x0) + 0.1, abs(y1 - y0) + 0.1, 0.012))
    kt = Kit(); kt.box((0, -9.7, dz(-9.7) + 0.006), (2 * a05_dw(-9.7) - 0.5, 0.9, 0.012))
    S += [k.obj('fittings', dark), kc.obj('chain_anchor', dark), ky.obj('deck_lines', yellow), kt.obj('deck_team', TM), kh.obj('anchor_pockets', black)]
    # transom: hazard corners, stern openings, lights
    k = Kit(); kz = Kit(); kl = Kit()
    for sgn in (1, -1):
        kz.box((sgn * 3.5, A_Y0 - 0.025, 1.5), (1.0, 0.04, 0.55)); k.box((sgn * 1.7, A_Y0 - 0.02, 0.9), (1.3, 0.04, 0.6))
        kl.box((sgn * 0.55, A_Y0 - 0.03, 1.55), (0.2, 0.05, 0.12))
    kl.box((0, 19.9, dz(19.9) - 0.2), (0.2, 0.06, 0.12))
    S += [kz.obj('transom_hazard', hazard), k.obj('stern_doors', black), kl.obj('lamps', lamp)]
    # AA pedestal (static) + ammunition lockers
    AP = Vector((0, -14.6, dz(-14.6) + 0.42))
    k = Kit(); k.cyl((0, AP.y, (dz(-14.6) + AP.z) / 2 - 0.03), 0.85, AP.z - dz(-14.6) + 0.06, 'Z', 20); k.ring((0, AP.y, dz(-14.6) + 0.05), 1.0, 0.84, 0.1, 'Z', 20)
    for sgn in (1, -1):
        k.box((sgn * 2.45, -14.6, dz(-14.6) + 0.36), (0.85, 1.5, 0.72)); k.box((sgn * 2.45, -14.6, dz(-14.6) + 0.74), (0.9, 1.55, 0.05))
    S.append(k.obj('aa_base', steel))

    # ── missile cell banks: lid_0..3 + muzzle_cell_0..3 ──
    #   lid_0 = port fwd, lid_1 = stbd fwd, lid_2 = port aft, lid_3 = stbd aft (hinged on their aft edge)
    zb = dz(7.0) - 0.08; zt = zb + 1.0
    k = Kit(); kb2 = Kit(); km = Kit(); kc = Kit()
    cells = {}
    for sgn in (-1, 1):
        xc = sgn * 0.95
        k.box((xc, 9.3, zb + 0.05), (1.7, 4.7, 0.1))
        for d in (-1, 1): k.box((xc + d * 0.79, 9.3, zb + 0.5), (0.12, 4.7, 1.0)); k.box((xc, 9.3 + d * 2.29, zb + 0.5), (1.7, 0.12, 1.0))
        k.box((xc, 9.3, zb + 0.5), (1.7, 0.14, 1.0))
        k.box((xc + sgn * 0.86, 9.3, zb + 0.5), (0.04, 4.3, 0.75))          # outer stiffener plate
        for fa, (ya, yf) in (('F', (9.37, 11.59)), ('A', (7.01, 9.23))):
            kb2.box((xc, (ya + yf) / 2, zt - 0.6), (1.46, yf - ya - 0.02, 0.04))
            kc.tube((xc, ya + 0.3, zt - 0.85), (xc, yf - 0.08, zt - 0.27), 0.22, 12)
            km.tube((xc, yf - 0.24, zt - 0.32), (xc, yf - 0.06, zt - 0.265), 0.17, 12, r2=0.03)
            cells[(sgn, fa)] = (xc, ya, yf)
    S += [k.obj('cell_banks', steel), kb2.obj('cell_floor', black), kc.obj('canisters', dark), km.obj('missile_noses', missile)]
    ang = math.atan2(0.58, 1.84 - 0.0)
    lids = {}
    for idx, key in enumerate([(-1, 'F'), (1, 'F'), (-1, 'A'), (1, 'A')]):
        xc, ya, yf = cells[key]; L_ = yf - ya + 0.1
        k = Kit(); kw = Kit()
        k.box((xc, (ya + yf) / 2, zt + 0.045), (1.6, L_, 0.09))
        for dx in (-0.45, 0.45): k.box((xc + dx, (ya + yf) / 2 + 0.05, zt + 0.11), (0.09, L_ - 0.35, 0.05))
        k.box((xc, (ya + yf) / 2, zt + 0.11), (1.15, 0.09, 0.05))
        k.cyl((xc, ya - 0.04, zt + 0.05), 0.065, 1.4, 'X', 8)
        k.box((xc, yf + 0.07, zt + 0.03), (0.3, 0.06, 0.08))
        kw.box((xc, (ya + yf) / 2 - 0.55, zt + 0.0915), (0.5, 0.3, 0.005))
        lid = pivot_mesh(f'lid_{idx}', [k.obj(f'lid_{idx}_m', panel), kw.obj(f'lid_{idx}_w', yellow)], (xc, ya - 0.04, zt + 0.05), root)
        lid['hinge'] = 'aft edge, rotate +X to open'
        lids[idx] = lid
        node(f'muzzle_cell_{idx}', (xc, yf - 0.1, zt - 0.27), root, rot=(ang, 0, 0))

    # ── radar (yaw) on the mast ──
    RP = Vector((0, -0.6, 7.55))
    k = Kit(); kr = Kit()
    k.cyl((0, RP.y, RP.z + 0.11), 0.38, 0.22, 'Z', 14)
    k.box((0, RP.y - 0.12, RP.z + 0.42), (0.32, 0.3, 0.42))
    M = Matrix.Translation(Vector((0, RP.y, RP.z + 0.45 + 0.9 * math.cos(D2R(12))))) @ Matrix.Rotation(D2R(12), 4, 'X')
    kr.box_m(M, (3.1, 0.12, 1.8))
    for dx in (-1.6, 1.6): k.box_m(M @ Matrix.Translation(Vector((dx, 0, 0))), (0.1, 0.22, 1.86))
    for dz_ in (-0.93, 0.93): k.box_m(M @ Matrix.Translation(Vector((0, 0, dz_))), (3.3, 0.22, 0.08))
    for dx in (-0.8, 0.0, 0.8): k.box_m(M @ Matrix.Translation(Vector((dx, -0.15, 0))), (0.1, 0.12, 1.7))
    k.box_m(M @ Matrix.Translation(Vector((0, -0.15, -0.3))), (2.9, 0.12, 0.1))
    radar = pivot_mesh('radar', [k.obj('radar_frame', dark), kr.obj('radar_face', radarm)], RP, root)

    # ── aft AA launcher: aa (yaw) → aa_pitch → muzzle_aa ──
    k = Kit()
    k.cyl((0, AP.y, AP.z + 0.09), 0.75, 0.18, 'Z', 18)
    k.box((0, AP.y - 0.1, AP.z + 0.5), (0.75, 0.85, 0.65))
    for sgn in (1, -1): k.box((sgn * 0.93, AP.y, AP.z + 0.78), (0.16, 0.7, 1.3))
    k.box((0, AP.y, AP.z + 0.24), (2.02, 0.6, 0.14))
    aa = pivot_mesh('aa', [k.obj('aa_m', steel)], AP, root)
    TA = AP + Vector((0, 0, 1.05))
    k = Kit(); kw = Kit(); kd = Kit(); kt = Kit(); kg = Kit()
    for sx in (-0.37, 0.37):
        for sz in (-0.33, 0.33):
            k.box((sx, TA.y + 0.05, TA.z + sz), (0.68, 1.5, 0.6))
            kw.box((sx, TA.y + 0.81, TA.z + sz), (0.6, 0.03, 0.52))
            kd.cyl((sx, TA.y + 0.83, TA.z + sz), 0.2, 0.02, 'Y', 12)
    k.cyl((0, TA.y, TA.z), 0.1, 1.95, 'X', 10)
    k.box((0, TA.y - 0.1, TA.z + 0.78), (0.42, 0.5, 0.26)); kg.box((0, TA.y + 0.16, TA.z + 0.78), (0.3, 0.02, 0.16))
    for sgn in (1, -1): kt.box((sgn * 0.715, TA.y - 0.25, TA.z + 0.33), (0.012, 0.6, 0.4))
    aap = pivot_mesh('aa_pitch', [k.obj('aap_m', panel), kw.obj('aap_c', white), kd.obj('aap_d', black), kt.obj('aap_t', TM), kg.obj('aap_g', GL)], TA, aa)
    node('muzzle_aa', (0, TA.y + 0.84, TA.z), aap)

    # ── propellers ──
    for nm, sx in (('prop_L', -1.75), ('prop_R', 1.75)):
        k = Kit(); propeller(k, (sx, -17.05, -1.4), 0.78, blades=5, hub=0.17, pitch=D2R(30), chord=0.36, thick=0.05, hub_len=0.42)
        pivot_mesh(nm, [k.obj(nm + '_m', bronze)], (sx, -17.05, -1.4), root)

    if draft: report_tris(S + [radar, aa, aap])
    hullo = join('hull', S); ulib.smooth(hullo, 35); parent(hullo, root)
    node('fx_wake_L', (-4.1, 12.5, 0.0), root); node('fx_wake_R', (4.1, 12.5, 0.0), root)
    node('fx_wake_stern', (0.0, -19.9, 0.0), root)
    node('hit', (0, 0, 3.0), root); node('badge', (0, -0.6, 10.8), root)

    def pose():
        radar.rotation_euler.z = D2R(35); aa.rotation_euler.z = D2R(40); aap.rotation_euler.x = D2R(35)
        lids[0].rotation_euler.x = D2R(100); lids[3].rotation_euler.x = D2R(70)
    return draft_or_finish(uid, root, WL, draft, pose)


# ═══════════════════════════════════════════════════════════════════════
#  T05  SPECTRE DRONE CORVETTE  (Nova Directive)  24 × 7 × 5 m, WL 1.0
# ═══════════════════════════════════════════════════════════════════════
T_Y0, T_Y1, T_HX = -11.4, 12.0, 2.25      # demi-hull transom, bow tips, hull centre offset

def t05_deck(y): return 2.25 - 1.8 * clamp((y - 5.5) / 6.5) ** 1.15

def t05_half(y):
    """Demi-hull half-section, x relative to the demi-hull centreline. Faceted ceramic shell, wave-piercing bow."""
    t = clamp((y - 3.8) / 8.2); f = 1 - 0.965 * t ** 1.25
    zd = t05_deck(y); zk = -1.0 + 1.3 * clamp((y - 6.5) / 5.5) ** 1.8
    xs = [0.0, 0.22, 1.0, 1.22, 1.06, 0.62]; zs = [-1.0, -0.96, -0.15, 0.75, 1.75, 2.2]
    mz = lambda z: zk + (z + 1.0) / 3.25 * (zd - zk)
    return [(x * f, mz(z)) for x, z in zip(xs, zs)] + [(0.31 * f, mz(2.24)), (0.0, zd)]


def build_T05(draft=False):
    reset(); uid = 'T05'; WL = 1.0; P = PAL['T']
    root = node('root')
    # ── materials (atlas) ──
    silver = paint('t_silver', '#9298A0', scale=4, rough=0.42, metal=0.3, grime=0.32, wear=0.38, wear_col='#DCE1E3', noise=0.18)
    base_layers(silver, lambda nb, col: plating(nb, col, sx=1.1, sy=1.7, sz=0.75, w=0.016, depth=0.48, tone=0.14))
    post_layers(silver, lambda nb, col: streaks(nb, col, '#C9C2B2', amount=0.28, z0=0.0, z1=2.3, scale=2.6, stretch=14, thresh=0.6))
    graph = paint('t_graph', '#3A3E43', scale=4, rough=0.5, metal=0.25, grime=0.3, wear=0.28, wear_col='#858B90', noise=0.2)
    base_layers(graph, lambda nb, col: plating(nb, col, sx=1.1, sy=1.7, sz=0.75, w=0.016, depth=0.4, tone=0.16))
    post_layers(graph, lambda nb, col: streaks(nb, col, '#8C8676', amount=0.3, z0=-0.2, z1=1.6, scale=2.6, stretch=14, thresh=0.6))
    topm = paint('t_top', '#80868B', scale=3, rough=0.5, metal=0.25, grime=0.38, wear=0.3, wear_col='#C9CED1', noise=0.2)
    base_layers(topm, lambda nb, col: plating(nb, col, sx=1.0, sy=1.4, sz=1.0, w=0.012, depth=0.35, tone=0.1))
    dark = paint('t_dark', '#202326', scale=2, rough=0.6, metal=0.2, grime=0.3, wear=0.15, wear_col='#5C6266', noise=0.15)
    af = paint('t_af', '#191C1F', scale=5, rough=0.8, metal=0.1, grime=0.25, wear=0.05, noise=0.2)
    post_layers(af, lambda nb, col: streaks(nb, col, '#2E3236', amount=0.4, z0=-1.0, z1=0.0, scale=2.2, stretch=10, thresh=0.55))
    boot = paint('t_boot', '#0D0E0F', scale=3, rough=0.7, grime=0.2, wear=0.04)
    hazard = hazard_mat('t_hazard', period=0.35)
    mk = paint('t_mark', '#26292C', scale=1, rough=0.5, grime=0.2, wear=0.3, wear_col='#9298A0')
    CY = glow('cyan', P['glow'], 5.0)
    TM = team(2.0)
    S = []

    # ── twin wave-piercing demi-hulls ──
    ys = [T_Y0, -11.1, -9.5, -7.0, -4.0, -1.0, 1.5, 3.0, 3.8, 4.9, 6.0, 7.1, 8.1, 9.0, 9.8, 10.5, 11.1, 11.55, 11.85, T_Y1]
    n_ring = len(ring_from_half(t05_half(0)))
    for sgn in (-1, 1):
        h = hull_loft(f'demihull_{sgn}', ys, t05_half, xoff=sgn * T_HX)
        assign(h, silver); add_mat(h, graph); add_mat(h, topm)
        nquads = (len(ys) - 1) * n_ring
        for p in h.data.polygons:          # ring-band materials: lower shell graphite, upper silver, top deck
            if p.index >= nquads: continue
            i = p.index % n_ring
            p.material_index = 1 if i in (0, 1, 2, 11, 12, 13) else (2 if i in (5, 6, 7, 8) else 0)
        bisect_z(h, (0.0, 0.18))
        add_mat(h, dark)
        set_faces_mat(h, dark, lambda c, n, sgn=sgn: sgn * n.x < -0.35 and 0.18 < c.z < 1.15 and c.y < 4.5)   # dark tunnel side
        paint_waterline(h, af, boot, None, 0.18)
        ulib.lib.bev(h, 0.04, 1, 25)          # rubbed facet edges catch the light
        ulib.smooth(h, 20); S.append(h)

    # ── central bridging body (dark tunnel underneath), sensor nose ──
    k = Kit()
    k.poly_prism([(1.75, -11.0), (1.75, 3.0), (1.3, 3.6), (-1.3, 3.6), (-1.75, 3.0), (-1.75, -11.0)], 1.15, 2.45)
    cb = k.obj('centre_body', graph)
    set_faces_mat(cb, dark, lambda c, n: n.z < -0.5)
    set_faces_mat(cb, topm, lambda c, n: n.z > 0.5)
    S.append(cb)
    k = Kit()
    k.poly_prism([(1.55, 1.2), (1.2, 4.0), (0.0, 6.4), (-1.2, 4.0), (-1.55, 1.2)], 2.3, 2.95, inset=0.2)
    nose = k.obj('sensor_nose', graph); set_faces_mat(nose, silver, lambda c, n: n.z > 0.5); S.append(nose)
    k = Kit()                                                   # dark slatted front of the tunnel
    k.box((0, 3.58, 1.75), (2.5, 0.06, 1.1))
    for xx in (-0.9, -0.45, 0.0, 0.45, 0.9): k.box((xx, 3.63, 1.75), (0.1, 0.08, 0.95))
    S.append(k.obj('tunnel_front', dark))

    # ── launcher box: aft solid block + two open cells under lid_L / lid_R ──
    ZL0, ZL1 = 2.45, 3.5
    S.append(wedge('launcher_aft', (2.8, 3.6, ZL1 - ZL0), (0, -2.8, (ZL0 + ZL1) / 2), moves=[('TR', (-0.12, 0, 0)), ('TL', (0.12, 0, 0)), ('TB', (0, 0.3, 0))], bevel=0.04, mat=graph))
    k = Kit(); kd = Kit(); kc = Kit()
    k.box((0, 0.0, ZL0 + 0.03), (2.8, 2.1, 0.08))
    for sx in (-1.34, 1.34): k.box((sx, 0.0, (ZL0 + ZL1) / 2), (0.12, 2.1, ZL1 - ZL0))
    k.box((0, 1.0, (ZL0 + ZL1) / 2), (2.8, 0.14, ZL1 - ZL0)); k.box((0, 0.0, (ZL0 + ZL1) / 2), (0.12, 2.1, ZL1 - ZL0))
    for sx in (-0.68, 0.68):
        kd.box((sx, 0.0, 2.85), (1.12, 1.9, 0.04))
        kc.tube((sx, -0.8, 2.75), (sx, 0.78, 3.28), 0.18, 12)
        kc.tube((sx, 0.6, 3.22), (sx, 0.82, 3.29), 0.15, 12, r2=0.03)
    for sgn in (1, -1):                                          # side detail: hinge plates, latch boxes (art "alternating aperture")
        k.box((sgn * 1.42, 0.5, 3.05), (0.06, 0.6, 0.35)); k.box((sgn * 1.42, -2.6, 3.0), (0.05, 1.6, 0.5))
        k.box((sgn * 1.43, -0.5, 2.8), (0.05, 0.25, 0.18))
    S += [k.obj('launcher_cells', graph), kd.obj('cell_floor', dark), kc.obj('canisters', dark)]
    k = Kit(); k.box((0, -2.8, ZL1 + 0.01), (2.2, 2.6, 0.03)); S.append(k.obj('launcher_toppanel', silver))
    k = Kit()      # TEAM triangle emblem on the launcher top
    for a_ in (0, 120, 240):
        r = D2R(a_ + 90); c = Vector((0.32 * math.cos(r), -2.8 + 0.32 * math.sin(r), ZL1 + 0.03))
        k.box(c, (0.09, 0.62, 0.012), rot=(0, 0, r))
    S.append(k.obj('launcher_tri', TM))
    ang = math.atan2(3.28 - 2.75, 0.78 + 0.8)
    lids = {}
    for nm, sx in (('L', -0.68), ('R', 0.68)):
        k = Kit(); kt = Kit()
        k.box((sx, 0.0, ZL1 + 0.04), (1.26, 2.0, 0.08))
        k.box((sx, 0.1, ZL1 + 0.1), (1.0, 1.5, 0.04))
        k.cyl((sx, -1.0, ZL1 + 0.04), 0.055, 1.1, 'X', 8)
        kt.box((sx + (0.45 if sx > 0 else -0.45), 0.1, ZL1 + 0.125), (0.08, 1.3, 0.012))
        lid = pivot_mesh(f'lid_{nm}', [k.obj(f'lid_{nm}_m', silver), kt.obj(f'lid_{nm}_t', TM)], (sx, -1.0, ZL1 + 0.04), root)
        lid['hinge'] = 'aft edge, rotate +X to open'
        lids[nm] = lid
        node(f'muzzle_{nm}', (sx, 0.76, 3.27), root, rot=(ang, 0, 0))

    # ── sensor: sensor (yaw) → sensor_pitch ──
    SP = Vector((0, 3.2, 2.95))
    k = Kit()
    k.cyl((0, SP.y, SP.z + 0.06), 0.55, 0.12, 'Z', 18)
    k.box((0, SP.y, SP.z + 0.3), (0.5, 0.45, 0.4))
    for sx in (-0.45, 0.45): k.box((sx, SP.y, SP.z + 0.45), (0.08, 0.5, 0.5))
    sensor = pivot_mesh('sensor', [k.obj('sensor_m', graph)], SP, root)
    PP = Vector((0, SP.y, 3.55))
    head = wedge('sensor_head', (1.34, 1.15, 0.85), (0, 3.25, 3.575), moves=[('TR', (-0.24, 0, 0)), ('TL', (0.24, 0, 0)), ('TF', (0, -0.22, 0)), ('TB', (0, 0.14, 0))], bevel=0.03, mat=silver)
    a = math.atan2(0.22, 0.85); nf = Vector((0, math.cos(a), math.sin(a)))
    lc = Vector((0, 3.825 - 0.22 * (0.4 / 0.85), 3.55))
    k = Kit(); kg = Kit(); kc2 = Kit()
    k.box(lc + nf * 0.01, (0.75, 0.04, 0.6), rot=(a, 0, 0))
    k.tube(lc, lc + nf * 0.14, 0.24, 16); k.tube(lc + nf * 0.14, lc + nf * 0.17, 0.2, 16)
    kg.tube(lc + nf * 0.15, lc + nf * 0.175, 0.12, 14)
    for sx in (-0.6, 0.6): kc2.box((sx, 3.2, 3.5), (0.02, 0.6, 0.04), rot=(0, sx * 0.3, 0))
    spitch = pivot_mesh('sensor_pitch', [head, k.obj('lens_m', dark), kg.obj('lens_iris', CY), kc2.obj('head_strips', CY)], PP, sensor)

    # ── waterjets jet_L / jet_R (yaw about local Z) ──
    jets = {}
    for nm, sgn in (('L', -1), ('R', 1)):
        cx = sgn * T_HX; JP = Vector((cx, T_Y0 - 0.02, 0.2))
        k = Kit(); kd = Kit()
        k.box((cx, T_Y0 - 0.08, 0.2), (1.45, 0.12, 1.15))
        for dz_ in (-0.44, 0.44): k.box((cx, T_Y0 - 0.36, 0.2 + dz_), (1.3, 0.56, 0.12))
        for dx in (-0.59, 0.59): k.box((cx + dx, T_Y0 - 0.36, 0.2), (0.12, 0.56, 1.0))
        for dx in (-0.29, 0.0, 0.29): kd.box((cx + dx, T_Y0 - 0.4, 0.2), (0.05, 0.48, 0.78))
        kd.box((cx, T_Y0 - 0.16, 0.2), (1.1, 0.04, 0.8))
        jet = pivot_mesh(f'jet_{nm}', [k.obj(f'jet_{nm}_m', silver), kd.obj(f'jet_{nm}_d', dark)], JP, root)
        node(f'fx_wake_jet_{nm}', (cx, T_Y0 - 0.62, 0.2), jet)
        jets[nm] = jet

    # ── stern: service hatch (recessed), hazard plates, rams ──
    k = Kit(); kd = Kit(); kz = Kit()
    kd.box((0, -11.02, 1.8), (1.6, 0.04, 0.95))
    k.box((0, -11.06, 1.8), (1.35, 0.04, 0.75)); k.box((0.48, -11.09, 1.8), (0.06, 0.04, 0.22))
    for zz in (1.55, 2.05): k.box((-0.7, -11.08, zz), (0.1, 0.05, 0.14))
    for sgn in (1, -1):
        cx = sgn * T_HX
        kz.box((cx - 0.35, T_Y0 - 0.02, 1.1), (0.5, 0.03, 0.18))
        k.tube((cx + 0.75, T_Y0 + 0.05, 0.75), (cx + 0.75, T_Y0 - 0.3, 0.55), 0.05, 6)
        k.box((cx, T_Y0 - 0.02, 1.55), (0.9, 0.04, 0.35))
    S += [k.obj('stern_kit', silver), kd.obj('hatch_recess', dark), kz.obj('stern_hazard', hazard)]

    # ── deck gear: domed hatches, grilles, grab handles, antenna posts, cleats ──
    k = Kit(); kd = Kit()
    for sgn in (1, -1):
        cx = sgn * T_HX
        for yy in (-7.4, 1.2):
            k.ring((cx, yy, 2.27), 0.42, 0.34, 0.06, 'Z', 16); k.dome((cx, yy, 2.25), 0.36, 16, 4, zcut=0.0, sz=0.45)
        S.append(grille(f'hullgrille_{sgn}', 0.6, 1.8, 7, depth=0.04, slat=0.4, loc=(cx, -4.5, 2.27), rot=(PI / 2, 0, 0), mat=dark))
        for yy in (-10.4, -9.4):
            k.path_tube([(cx - 0.3, yy, 2.24), (cx - 0.3, yy, 2.42), (cx + 0.3, yy, 2.42), (cx + 0.3, yy, 2.24)], 0.04, 6)
        k.tube((cx + sgn * 0.45, -10.0, 2.22), (cx + sgn * 0.45, -10.0, 3.05), 0.07, 8); k.dome((cx + sgn * 0.45, -10.0, 3.05), 0.11, 10, 3, zcut=-0.6)
        for yy in (-6.0, 4.0): k.box((cx - sgn * 0.3, yy, 2.27), (0.12, 0.45, 0.08))
        kd.box((cx, -1.6, 2.255), (0.7, 1.6, 0.02))
    S.append(grille('deck_grille', 2.2, 3.0, 9, depth=0.05, slat=0.42, loc=(0, -8.2, 2.47), rot=(PI / 2, 0, 0), mat=dark))
    k.box((0, -8.2, 2.46), (2.4, 3.2, 0.04))
    k.box((1.0, -5.6, 2.5), (0.6, 0.8, 0.12)); k.box((-1.0, -5.6, 2.5), (0.6, 0.8, 0.12))
    S += [k.obj('deck_gear', silver), kd.obj('deck_panels', dark)]

    # ── extra shell detail: upper-side louvres, top hatches, spine plates, launcher rims, rails ──
    k = Kit(); kd = Kit()
    for sgn in (1, -1):
        cx = sgn * T_HX
        for yy in (-6.6, -3.2):
            zz = 1.4; x = cx + sgn * (side_x(t05_half, yy, zz) + 0.01)
            S.append(grille(f'louvre_{sgn}_{yy}', 1.0, 0.36, 4, depth=0.04, slat=0.4, loc=(x, yy, zz), rot=(0, 0, -sgn * PI / 2), mat=dark))
        for yy, ln in ((-2.6, 1.0), (3.2, 0.9), (-9.0, 0.6)):
            k.box((cx, yy, 2.26), (0.55, ln, 0.05)); kd.box((cx, yy, 2.29), (0.42, ln - 0.15, 0.012))
        k.box((cx + sgn * 0.42, -0.5, 2.25), (0.08, 9.0, 0.05))                    # spine strake
        for yy in (-7.0, -1.0, 3.5):                                                # tunnel-side grab rails
            k.path_tube([(sgn * 1.76, yy - 0.4, 2.0), (sgn * 1.86, yy - 0.4, 2.0), (sgn * 1.86, yy + 0.4, 2.0), (sgn * 1.76, yy + 0.4, 2.0)], 0.04, 5)
    for sx in (-1.42, 1.42):
        k.box((sx, -2.8, 2.6), (0.05, 3.2, 0.12)); k.box((sx, -2.8, 3.25), (0.05, 3.2, 0.06))
    k.box((0, 1.07, 3.52), (2.85, 0.1, 0.06)); k.box((0, -1.07, 3.54), (2.85, 0.08, 0.08))
    k.box((0, -4.66, 2.95), (2.4, 0.06, 0.6)); k.box((0, -4.7, 2.95), (0.5, 0.06, 0.3))
    S += [k.obj('shell_detail', silver), kd.obj('shell_inlays', dark)]

    # ── markings + thin cyan strips ──
    k = Kit(); kt = Kit()
    for sgn in (1, -1):
        cx = sgn * T_HX
        for (yy, zz, ln) in ((7.6, 1.05, 0.7), (-1.2, 1.55, 0.6), (-8.5, 1.55, 0.5)):
            x = cx + sgn * (side_x(t05_half, yy, zz) + 0.012); rz = outward_rz(t05_half, yy, zz, sgn)
            k.box((x, yy, zz), (0.025, ln, 0.06), rot=(0, 0, rz if sgn > 0 else rz - PI))
        x = cx - sgn * (side_x(t05_half, 4.2, 1.2) + 0.012)         # inner (tunnel) side
        k.box((x, 4.2, 1.2), (0.025, 0.5, 0.06))
        yy, zz = 4.3, 0.95
        x = cx + sgn * (side_x(t05_half, yy, zz) + 0.012)
        k.box((x, yy, zz), (0.025, 0.06, 0.06))
        # T05 + triangle emblem
        y0, z0 = 0.4, 1.3
        S.append(mark(f'hull_no_{sgn}', 'T05', 0.85, (cx + sgn * (side_x(t05_half, y0, z0) + 0.02), y0, z0),
                      rot=(PI / 2 + math.atan2(side_x(t05_half, y0, z0 + 0.15) - side_x(t05_half, y0, z0 - 0.15), 0.3), 0, sgn * PI / 2), mat=mk))
        yc = 1.95; zc = 1.3
        for a_ in (90, 210, 330):        # down-pointing triangle outline (Nova mark), edges conform to the flare
            r = D2R(a_); yy, zz = yc + 0.17 * math.cos(r), zc + 0.17 * math.sin(r)
            kt.box((cx + sgn * (side_x(t05_half, yy, zz) + 0.01), yy, zz), (0.05, 0.08, 0.6), rot=(r, 0, 0))
    S += [k.obj('cyan_strips', CY), kt.obj('hull_tri', TM)]

    if draft: report_tris(S + [sensor, spitch])
    hullo = join('hull', S); ulib.smooth(hullo, 30); parent(hullo, root)
    node('fx_wake_L', (-T_HX, 9.0, 0.0), root); node('fx_wake_R', (T_HX, 9.0, 0.0), root)
    node('fx_wake_stern', (0.0, -12.0, 0.0), root)
    node('hit', (0, -1.0, 1.8), root); node('badge', (0, 0, 5.0), root)

    def pose():
        sensor.rotation_euler.z = D2R(30); spitch.rotation_euler.x = D2R(-12)
        lids['L'].rotation_euler.x = D2R(95); jets['L'].rotation_euler.z = D2R(18); jets['R'].rotation_euler.z = D2R(18)
    return draft_or_finish(uid, root, WL, draft, pose)


BUILD = {'H05': build_H05, 'A05': build_A05, 'T05': build_T05}

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    draft = '--draft' in sys.argv
    units = ['H05', 'A05', 'T05'] if (not args or args[0] == 'all') else args
    for u in units:
        BUILD[u](draft)
