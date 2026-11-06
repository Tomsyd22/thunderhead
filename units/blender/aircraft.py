#!/usr/bin/env python
"""Thunderhead air units: H04 Hammer Assault Helicopter, A04 Kestrel Strike Jet, T04 Mote Recon Drone.

Usage:  /home/claude/blender-env/bin/python aircraft.py H04|A04|T04|all [--quick]
  --quick  geometry check + procedural preview only (no bake / export)

Axes and node names follow ../CONTRACT.md: 1 unit = 1 m, Z up, +Y forward, +X = unit's right;
aircraft origin (root) = fuselage underside. Shared toolkit: ulib.py (not modified here).
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ulib
from ulib import (reset, node, pivot_mesh, finish, paint, gunmetal, flat, glow, glass, team, PAL, lin, bx, wedge,
                  side_prism, top_prism, loft, rsec, tube, cyl, ball, grille, text_mark, join, smooth, obj_from,
                  assign, add_mat, set_faces_mat, parent, set_origin, mesh_obj, bev, SPEC)
import bpy, bmesh
from mathutils import Vector, Matrix, Euler

TAU = 2 * math.pi
D = math.radians
QUICK = '--quick' in sys.argv

# ═══════════════════════════ material helpers (extend ulib.paint node trees) ═══════════════════════════
def _ins(m, fn):
    """Insert extra colour nodes between the paint chain and the BSDF base colour."""
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
    lk = b.inputs['Base Color'].links[0]; src = lk.from_socket; L.remove(lk)
    def nd(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n
    L.new(fn(N, L, nd, src), b.inputs['Base Color'])
    return m

def _vm(nd, L, op, a, b=None, out=0):
    n = nd('ShaderNodeVectorMath', operation=op)
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, tuple): n.inputs[i].default_value = x
        else: L.new(x, n.inputs[i])
    return n.outputs[out]

def _m(nd, L, op, a, b=None, clamp=False):
    n = nd('ShaderNodeMath', operation=op, use_clamp=clamp)
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, (int, float)): n.inputs[i].default_value = x
        else: L.new(x, n.inputs[i])
    return n.outputs[0]

def _mr(nd, L, v, a, b, c=0.0, d=1.0):
    n = nd('ShaderNodeMapRange'); n.clamp = True; L.new(v, n.inputs['Value'])
    n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
    n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
    return n.outputs['Result']

def _mix(nd, L, fac, a, b, blend='MIX'):
    n = nd('ShaderNodeMix', data_type='RGBA', blend_type=blend)
    if isinstance(fac, (int, float)): n.inputs['Factor'].default_value = fac
    else: L.new(fac, n.inputs['Factor'])
    for key, x in (('A', a), ('B', b)):
        if isinstance(x, tuple): n.inputs[key].default_value = (*x[:3], 1)
        else: L.new(x, n.inputs[key])
    return n.outputs['Result']

def panelize(m, size=(0.8, 1.0, 0.6), width=0.012, depth=0.45, tone=0.06, off=(0.137, 0.291, 0.073)):
    """Rectangular panel seams (object-space grid, suppressed on faces that face the seam axis) + per-panel tone."""
    def fn(N, L, nd, src):
        tc = nd('ShaderNodeTexCoord')
        p = _vm(nd, L, 'ADD', tc.outputs['Object'], tuple(off))
        t = _vm(nd, L, 'DIVIDE', p, tuple(size))
        f = _vm(nd, L, 'FRACTION', t)
        a = _vm(nd, L, 'ABSOLUTE', _vm(nd, L, 'SUBTRACT', f, (0.5, 0.5, 0.5)))
        e = _vm(nd, L, 'MULTIPLY', _vm(nd, L, 'SUBTRACT', (0.5, 0.5, 0.5), a), tuple(size))
        sn = nd('ShaderNodeSeparateXYZ'); L.new(_vm(nd, L, 'ABSOLUTE', tc.outputs['Normal']), sn.inputs[0])
        se = nd('ShaderNodeSeparateXYZ'); L.new(e, se.inputs[0])
        ds = [_m(nd, L, 'ADD', se.outputs[k], _mr(nd, L, sn.outputs[k], 0.6, 0.85, 0.0, 10.0)) for k in range(3)]
        dmin = _m(nd, L, 'MINIMUM', _m(nd, L, 'MINIMUM', ds[0], ds[1]), ds[2])
        line = _mr(nd, L, dmin, width * 0.35, width, 1.0 - depth, 1.0)
        wn = nd('ShaderNodeTexWhiteNoise', noise_dimensions='3D'); L.new(_vm(nd, L, 'FLOOR', t), wn.inputs['Vector'])
        tn = _mr(nd, L, wn.outputs['Value'], 0.0, 1.0, 1.0 - tone, 1.0 + tone)
        return _mix(nd, L, 1.0, _mix(nd, L, 1.0, src, tn, 'MULTIPLY'), line, 'MULTIPLY')
    return _ins(m, fn)

def streak(m, p0, d, length, width, col='#17140F', amt=0.7, nscale=5.0):
    """Exhaust soot streak from object-space point p0 along direction d, widening and fading with distance."""
    d = Vector(d).normalized()
    def fn(N, L, nd, src):
        tc = nd('ShaderNodeTexCoord'); pos = tc.outputs['Object']
        rel = _vm(nd, L, 'SUBTRACT', pos, tuple(p0))
        along = _vm(nd, L, 'DOT_PRODUCT', rel, tuple(d), out=1)
        r = _vm(nd, L, 'LENGTH', rel, out=1)
        perp = _m(nd, L, 'SQRT', _m(nd, L, 'MAXIMUM', _m(nd, L, 'SUBTRACT', _m(nd, L, 'MULTIPLY', r, r), _m(nd, L, 'MULTIPLY', along, along)), 0.0))
        fa = _m(nd, L, 'MULTIPLY', _mr(nd, L, along, -0.05, 0.25), _mr(nd, L, along, length, 0.0))
        wdt = _m(nd, L, 'ADD', _m(nd, L, 'MULTIPLY', along, 0.25), width)
        fp = _mr(nd, L, _m(nd, L, 'DIVIDE', perp, wdt), 1.0, 0.25)
        nz = nd('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = nscale; nz.inputs['Detail'].default_value = 4
        sv = tuple(0.15 if abs(c) > 0.6 else 1.0 for c in d)
        L.new(_vm(nd, L, 'MULTIPLY', pos, sv), nz.inputs['Vector'])
        nf = _mr(nd, L, nz.outputs['Fac'], 0.3, 0.7, 0.35, 1.0)
        mask = _m(nd, L, 'MULTIPLY', _m(nd, L, 'MULTIPLY', fa, fp), _m(nd, L, 'MULTIPLY', nf, amt), clamp=True)
        return _mix(nd, L, mask, src, lin(col))
    return _ins(m, fn)

def zdust(m, z_hi, z_lo, col='#8C7B5E', amt=0.8, nscale=7.0):
    """Dust / grime gradient below z_hi (object space), full at z_lo; works for negative heights (skids, gear)."""
    def fn(N, L, nd, src):
        tc = nd('ShaderNodeTexCoord'); pos = tc.outputs['Object']
        sz = nd('ShaderNodeSeparateXYZ'); L.new(pos, sz.inputs[0])
        g = _mr(nd, L, sz.outputs['Z'], z_hi, z_lo)
        nz = nd('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = nscale; nz.inputs['Detail'].default_value = 6; L.new(pos, nz.inputs['Vector'])
        nf = _mr(nd, L, nz.outputs['Fac'], 0.35, 0.65, 0.3, 1.0)
        return _mix(nd, L, _m(nd, L, 'MULTIPLY', _m(nd, L, 'MULTIPLY', g, nf), amt, clamp=True), src, lin(col))
    return _ins(m, fn)

def heat_tint(m, p0, d, length, cols=('#6B4A2E', '#3E4A6A')):
    """Nozzle heat discolouration: bronze near the exit blending to a blue-violet band along -d."""
    d = Vector(d).normalized()
    def fn(N, L, nd, src):
        tc = nd('ShaderNodeTexCoord'); rel = _vm(nd, L, 'SUBTRACT', tc.outputs['Object'], tuple(p0))
        along = _vm(nd, L, 'DOT_PRODUCT', rel, tuple(d), out=1)
        f1 = _mr(nd, L, along, -length, 0.0, 0.0, 0.55)
        f2 = _m(nd, L, 'MULTIPLY', _mr(nd, L, along, -length * 1.6, -length * 0.8), _mr(nd, L, along, -length * 0.2, -length * 0.8), clamp=True)
        c = _mix(nd, L, _m(nd, L, 'MULTIPLY', f2, 0.35), src, lin(cols[1]))
        return _mix(nd, L, f1, c, lin(cols[0]), 'MULTIPLY')
    return _ins(m, fn)

def disc_mat(name, col='#8E8D88', alpha=0.25):
    """Translucent rotor-disc material (not baked). The game sets its opacity / hides it at low rpm."""
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Alpha'].default_value = alpha; b.inputs['Roughness'].default_value = 0.7
    m.surface_render_method = 'BLENDED'; m.use_backface_culling = False
    return m

# ═══════════════════════════ geometry helpers ═══════════════════════════
def mk(name, V, F, mat=None):
    o = obj_from(name, V, F)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(o.data); bm.free()
    if mat: assign(o, mat)
    return o

def ring_loft(name, rings, mat=None, cap=True):
    """Skin consecutive closed point rings (same count) into a solid."""
    n = len(rings[0]); V = [tuple(p) for r in rings for p in r]; F = []
    for s in range(len(rings) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n; F.append((a + i, a + j, b + j, b + i))
    if cap: F.append(tuple(reversed(range(n)))); F.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return mk(name, V, F, mat)

def xf(o):
    """Apply object transforms (object space = model space)."""
    ulib._apply_xform(o); return o

def naca(u):
    u = max(0.0, min(1.0, u)); return 5 * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)

AF_U = [0.0, 0.02, 0.08, 0.2, 0.35, 0.55, 0.75, 1.0]
def af_ring(u0, u1, camber=0.1, te=0.03):
    us = [u0] + [u for u in AF_U if u0 + 1e-6 < u < u1 - 1e-6] + [u1]
    h = lambda u: max(naca(u), te) if u > 0 else 0.0
    up = [(u, h(u) * (1 + camber)) for u in us]; lo = [(u, -h(u) * (1 - camber)) for u in us]
    return list(reversed(up)) + (lo[1:] if u0 == 0 else lo)

def foil(name, stations, u0=0.0, u1=1.0, C=(0, -1, 0), Nn=(0, 0, 1), mat=None, le_mat=None, le_n=1, camber=0.1):
    """Airfoil-section solid. stations = [(LE point, chord, thickness), ...]; chord runs along C, thickness along Nn.
    u0/u1 cut the chord (0 = leading edge) so wings, hinge stubs and control surfaces fit together."""
    ring = af_ring(u0, u1, camber); C = Vector(C); Nn = Vector(Nn)
    rings = [[Vector(P) + C * (u * c) + Nn * (w * t) for u, w in ring] for P, c, t in stations]
    o = ring_loft(name, rings, mat)
    if le_mat and u0 == 0:
        n = len(ring); ile = [k for k, (u, w) in enumerate(ring) if u == 0][0]; idx = add_mat(o, le_mat)
        for s in range(len(stations) - 1):
            for i in range(ile - le_n, ile + le_n): o.data.polygons[s * n + i].material_index = idx
    return o

def lathe(name, prof, segs, center=(0, 0, 0), mat=None, a0=0.0):
    """Revolve a closed (r, z) profile about the vertical axis through center (faceted)."""
    n = len(prof); V = []; F = []
    for k in range(segs):
        a = a0 + TAU * k / segs; ca, sa = math.cos(a), math.sin(a)
        V += [(center[0] + r * ca, center[1] + r * sa, center[2] + z) for r, z in prof]
    for k in range(segs):
        k2 = (k + 1) % segs
        for i in range(n):
            j = (i + 1) % n; F.append((k * n + i, k * n + j, k2 * n + j, k2 * n + i))
    return mk(name, V, F, mat)

def bore(o, normal, inset, depth, mat, scale_in=1.0, push=None):
    """Turn the cap face facing `normal` into a real opening: inset rim + recessed walls/floor in `mat`."""
    xf(o); idx = add_mat(o, mat); nv = Vector(normal).normalized()
    bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update(); bm.faces.ensure_lookup_table()
    f = max(bm.faces, key=lambda f: (round(f.normal.dot(nv), 3), f.calc_area()))
    bmesh.ops.inset_region(bm, faces=[f], thickness=inset, depth=0.0, use_even_offset=True)
    old = set(bm.faces)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    vs = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    c = sum((v.co for v in vs), Vector()) / len(vs)
    pv = Vector(push).normalized() if push else -nv
    for v in vs: v.co = c + (v.co - c) * scale_in + pv * depth
    for g in bm.faces:
        if g not in old: g.material_index = idx
    bm.to_mesh(o.data); bm.free(); o.data.update()
    return o

def text_lo(name, text, size, loc, rot, mat, res=3, depth=0.0):
    """Like ulib.text_mark but with low curve resolution and no extrusion (flat decal mesh, few triangles)."""
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = text; cu.size = size; cu.extrude = depth
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = res
    try: cu.font = bpy.data.fonts.load(ulib.FONT, check_existing=True)
    except Exception: pass
    o = bpy.data.objects.new(name, cu); ulib.link(o); o.location = loc; o.rotation_euler = rot
    bpy.context.view_layer.update()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active; o.name = name
    if mat: assign(o, mat)
    return o

def hollow_tube(name, r_out, r_in, length, center, axis='Y', segs=16, lip=0.02, lipw=0.06, mat=None, inner=None, floor=None, a0=0.0):
    """Open-ended tube (launcher tube / exhaust / duct) with lips at both ends; inner wall in `inner`,
    optional dark floor discs `floor` metres inside each end. Built by revolving a profile (cheap, clean)."""
    h = length / 2
    prof = [(r_in, -h), (r_out + lip, -h), (r_out + lip, -h + lipw), (r_out, -h + lipw), (r_out, h - lipw), (r_out + lip, h - lipw), (r_out + lip, h), (r_in, h)]
    o = lathe(name, prof, segs, mat=mat, a0=a0); n = len(prof)
    if inner:
        idx = add_mat(o, inner)
        for k in range(segs): o.data.polygons[k * n + n - 1].material_index = idx
    parts = [o]
    if floor is not None:
        for e in (1, -1):
            parts.append(disc(name + f'_fl{e}', r_in * 1.01, (0, 0, e * (h - floor)), 'Z', segs, inner or mat))
    o = join(name, parts)
    o.rotation_euler = {'Z': (0, 0, 0), 'Y': (-math.pi / 2, 0, 0), 'X': (0, math.pi / 2, 0)}[axis]; o.location = center
    return xf(o)

def flat_poly(name, pts, thick, loc, rot, mat, scale=1.0):
    o = top_prism(name, [(x * scale, y * scale) for x, y in pts], -thick / 2, thick / 2, mat=mat)
    o.location = loc; o.rotation_euler = rot; return o

def disc(name, r, loc, axis='Z', verts=48, mat=None):
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=r, segments=verts)
    o = mesh_obj(name, bm); o.location = loc
    o.rotation_euler = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    if mat: assign(o, mat)
    return o

def faces_mat(o, mat, pred):
    bpy.context.view_layer.update(); set_faces_mat(o, mat, pred); return o

def side(s): return 'R' if s > 0 else 'L'

def tab(T, y):
    """Linear interpolation in a station table [(y, p1, p2, ...), ...] ordered by descending y."""
    if y >= T[0][0]: return T[0][1:]
    for a, b in zip(T, T[1:]):
        if b[0] <= y <= a[0]:
            f = (a[0] - y) / (a[0] - b[0]); return tuple(p + (q - p) * f for p, q in zip(a[1:], b[1:]))
    return T[-1][1:]

def sx(T, y, z):
    """Half-width of an rsec(hw, z0, z1, r, 1, ct) fuselage table at height z (outer surface)."""
    hw, z0, z1, r, ct = tab(T, y)
    if z < z0 + r: return hw - (z0 + r - z)
    if z > z1 - r: return hw - ct - (z - (z1 - r))
    return hw - ct * (z - z0 - r) / max(1e-6, z1 - z0 - 2 * r)

def side_plate(name, T, y0, y1, zb, zt, s, mat, off=0.012, th=0.03, n=6):
    """Raised plate conforming to the side of a station-table fuselage (armour panel / paint panel)."""
    rings = []
    for k in range(n + 1):
        y = y0 + (y1 - y0) * k / n; xb = sx(T, y, zb); xt = sx(T, y, zt)
        rings.append([(s * (xb + off), y, zb), (s * (xt + off), y, zt), (s * (xt + off - th), y, zt), (s * (xb + off - th), y, zb)])
    return ring_loft(name, rings, mat)

def conform_side(o, T, s, gap):
    """Project a flat decal (text / emblem) onto the fuselage side so it sits `gap` off the surface."""
    xf(o); me = o.data
    cx = sum(v.co.x for v in me.vertices) / max(1, len(me.vertices))
    for v in me.vertices: v.co.x = s * (sx(T, v.co.y, v.co.z) + gap) + (v.co.x - cx)
    me.update(); return o

def side_rot(s): return (math.pi / 2, 0, math.pi / 2 if s > 0 else -math.pi / 2)

EMB_H = [[(-0.5, -0.42), (0.5, -0.42), (0.0, 0.5)], [(-0.28, -0.42), (0.28, -0.42), (0.0, 0.08)]]
def emblem_H(name, size, loc, rot, mat, th=0.006):
    """Iron Legion spearhead: chevron + inner wedge."""
    outer = [(-0.5, -0.42), (0.0, 0.52), (0.5, -0.42), (0.27, -0.42), (0.0, 0.08), (-0.27, -0.42)]
    inner = [(-0.12, -0.42), (0.12, -0.42), (0.0, -0.16)]
    return join(name, [flat_poly(name + 'a', outer, th, loc, rot, mat, size), flat_poly(name + 'b', inner, th, loc, rot, mat, size)])

def emblem_A(name, size, loc, rot, mat, th=0.006):
    """Vanguard Alliance winged chevron."""
    v1 = [(-0.5, 0.32), (-0.18, 0.32), (0.0, -0.08), (0.18, 0.32), (0.5, 0.32), (0.0, -0.45)]
    v2 = [(-0.3, 0.5), (-0.12, 0.5), (0.0, 0.26), (0.12, 0.5), (0.3, 0.5), (0.0, 0.1)]
    return join(name, [flat_poly(name + 'a', v1, th, loc, rot, mat, size), flat_poly(name + 'b', v2, th, loc, rot, mat, size)])

def chevron(name, size, loc, rot, mat, th=0.006):
    """Forward-pointing arrow (points along the poly +y)."""
    pts = [(-0.5, -0.3), (0.0, 0.35), (0.5, -0.3), (0.22, -0.3), (0.0, 0.0), (-0.22, -0.3)]
    return flat_poly(name, pts, th, loc, rot, mat, size)

_pivot_mesh = pivot_mesh
def pivot_mesh(name, objs, pivot, par=None):
    """ulib.pivot_mesh + optional per-part triangle report (env TRIS=1)."""
    if os.environ.get('TRIS'):
        rows = sorted(((ulib.tris([o]), o.name) for o in objs if o and o.type == 'MESH'), reverse=True)
        print(f'  [{name}] {sum(r[0] for r in rows)} tris:', ', '.join(f'{n}={t}' for t, n in rows[:18]))
    return _pivot_mesh(name, objs, pivot, par)

def quick_report(uid, root):
    objs = [o for o in bpy.data.objects if not o.name.startswith('_')]
    meshes = [o for o in objs if o.type == 'MESH' and not o.hide_render]
    rep, lo, hi = ulib.check_dims(uid, meshes)
    print(f'[{uid}] tris {ulib.tris(meshes)} (budget {SPEC[uid]["budget"][0]}) objects {len(objs)}')
    if os.environ.get('CLOSE'): closeups(uid, lo, hi)
    else: ulib.preview_sheet(uid, lo, hi, samples=10)

SCRATCH = '/tmp/claude-0/-home-claude/6ea218bb-7b05-5a09-b660-8c0a9162a762/scratchpad/close'
def closeups(uid, lo, hi, samples=12):
    """Scratch close-up renders (front-left 3/4, rear-right 3/4, low side) for checking detail; discs hidden."""
    from PIL import Image
    os.makedirs(SCRATCH, exist_ok=True)
    for o in bpy.data.objects:
        if o.type == 'MESH' and any(m and m.name.startswith('DISC') for m in o.data.materials): o.hide_render = True
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('_w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.56, 0.58, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.55
    sun = ulib.link(bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN'))); sun.data.energy = 3.2; sun.rotation_euler = Euler((D(42), D(18), D(-38)))
    fl = bx('_floor', (200, 200, 0.01), (0, 0, lo.z - 0.006)); assign(fl, flat('_fm', '#9C9890', 0.85, bake=False))
    c = Vector(json.loads(os.environ.get('CLOSE_C', 'null')) or ((lo + hi) / 2)); R = float(os.environ.get('CLOSE_R', '0')) or (hi - lo).length * 0.42
    ims = []
    for k, (az, el) in enumerate(((-55, 25), (130, 22), (90, 5), (-20, 60))):
        a, e = D(az), D(el); loc = c + Vector((math.cos(e) * math.sin(a) * -1, math.cos(e) * math.cos(a), math.sin(e))) * R * 2.2
        cam = ulib._cam('_c', tuple(loc), tuple(c), lens=50); sc.camera = cam
        sc.render.resolution_x = 800; sc.render.resolution_y = 560; p = os.path.join(SCRATCH, f'{uid}_c{k}.png'); sc.render.filepath = p
        bpy.ops.render.render(write_still=True); ims.append(Image.open(p).convert('RGB'))
    sheet = Image.new('RGB', (1600, 1120))
    for k, im in enumerate(ims): sheet.paste(im, ((k % 2) * 800, (k // 2) * 560))
    sheet.save(os.path.join(SCRATCH, f'{uid}_close.png')); print('close-ups', os.path.join(SCRATCH, f'{uid}_close.png'))


def done(uid, root, extras):
    if QUICK: return quick_report(uid, root)
    size = SPEC[uid]['budget'][4]
    finish(uid, root, size=size, samples=16, extras=extras)

# ═══════════════════════════ H04 HAMMER ASSAULT HELICOPTER (Iron Legion) ═══════════════════════════
FUS_H = [  # y, hw, z0, z1, corner r, top chamfer   (angular armoured fuselage, origin = belly)
    (7.05, 0.16, 0.50, 0.95, 0.06, 0.03),
    (6.85, 0.34, 0.30, 1.10, 0.10, 0.06),
    (6.45, 0.50, 0.10, 1.22, 0.14, 0.10),
    (5.85, 0.58, 0.00, 1.30, 0.16, 0.12),
    (4.60, 0.62, 0.00, 1.38, 0.16, 0.12),
    (3.40, 0.68, 0.00, 1.55, 0.18, 0.13),
    (2.40, 0.76, 0.00, 1.75, 0.18, 0.14),
    (1.40, 0.80, 0.00, 1.85, 0.18, 0.14),
    (0.00, 0.80, 0.00, 1.88, 0.18, 0.14),
    (-1.00, 0.72, 0.08, 1.85, 0.18, 0.12),
    (-1.80, 0.56, 0.42, 1.78, 0.16, 0.10),
    (-2.50, 0.40, 0.78, 1.72, 0.12, 0.06),
    (-4.50, 0.30, 0.98, 1.64, 0.09, 0.04),
    (-6.30, 0.22, 1.10, 1.58, 0.07, 0.03),
    (-6.95, 0.16, 1.16, 1.52, 0.05, 0.02),
]
H_HUB = Vector((0, 1.0, 3.32))     # main rotor hub (top of mast)
H_TR = Vector((0.40, -6.6, 2.38))  # tail rotor hub (right of the fin)
H_ROTOR_R = 6.6; H_TR_R = 1.15

def build_H04():
    reset(); uid = 'H04'; P = PAL['H']
    root = node('root')
    # ── materials ──
    steel = paint('h_steel', '#5A594F', scale=1.6, rough=0.6, metal=0.0, grime=0.5, wear=0.35, wear_col='#8E8981', noise=0.3)
    panelize(steel, size=(0.62, 0.85, 0.5), depth=0.3, tone=0.07)
    for s in (1, -1): streak(steel, (s * 0.43, -1.8, 2.12), (0, -1, -0.12), 3.4, 0.22, amt=0.55)
    blade = paint('h_blade', '#4E4D46', scale=1.0, rough=0.6, metal=0.0, grime=0.3, wear=0.3, wear_col='#8E8981', noise=0.25)
    red = paint('h_red', '#98432F', scale=1.6, rough=0.62, metal=0.0, grime=0.45, wear=0.45, wear_col='#7E7870', noise=0.35)
    panelize(red, size=(0.62, 0.85, 0.5), depth=0.28, tone=0.05)
    gun = paint('h_gun', '#36363A', scale=0.5, rough=0.45, metal=0.0, grime=0.35, wear=0.45, wear_col='#9A9A96', noise=0.18)
    erode = paint('h_erode', '#A29C90', scale=0.5, rough=0.4, metal=0.0, grime=0.1, wear=0.0, noise=0.5)
    ivory = flat('h_ivory', P['ivory'], 0.55)
    black = flat('h_black', '#0B0B0C', 0.85)
    lamp = flat('h_lamp', '#E8923A', 0.3)
    heat = paint('h_heat', '#4A433C', scale=0.4, rough=0.45, metal=0.0, grime=0.4, wear=0.2, noise=0.3)
    heat_tint(heat, (0, -1.8, 0), (0, -1, 0), 0.5)
    skid = paint('h_skid', '#504F48', scale=0.6, rough=0.7, metal=0.0, grime=0.45, wear=0.6, wear_col='#8A857C', noise=0.3)
    zdust(skid, -0.05, -0.68)
    tm = team(1.2)
    gl = glass('GLASS', '#1D2A33')
    navr = glow('nav_red', '#FF3B30', 5); navg = glow('nav_green', '#39FF7A', 5)
    dmain = disc_mat('DISC_main'); dtail = disc_mat('DISC_tail')

    T = FUS_H; H = []   # hull parts
    H.append(loft('fuselage', [(y, rsec(hw, z0, z1, r, 1, ct)) for y, hw, z0, z1, r, ct in T], mat=steel))
    # nose armour plates (oxide red) with hull ID + faction emblem; chin and boom armour strips
    for s in (1, -1):
        o = side(s)
        H.append(side_plate(f'noseplate{o}', T, 6.32, 3.72, 0.18, 1.12, s, red))
        H.append(side_plate(f'chinplate{o}', T, 6.6, 3.72, 0.02, 0.16, s, steel, off=0.006, th=0.02))
        H.append(side_plate(f'cheek{o}', T, 3.6, 2.7, 0.2, 1.2, s, steel, off=0.01, th=0.02, n=2))
        H.append(conform_side(text_lo(f'id{o}', 'H04', 0.5, (s * 0.7, 5.05, 0.68), side_rot(s), ivory), T, s, 0.016))
        H.append(conform_side(emblem_H(f'emb{o}', 0.5, (s * 0.7, 4.12, 0.68), side_rot(s), ivory), T, s, 0.016))
        H.append(side_plate(f'boomplate{o}', T, -1.9, -3.4, 0.82, 1.42, s, steel, off=0.008, th=0.02, n=3))
    # canopy (tandem, stepped: gunner front / pilot raised behind) + frames
    CAN = [(6.34, None, 0.10), (5.85, 1.80, 0.20), (4.78, 1.88, 0.23), (4.50, 2.20, 0.23), (3.05, 2.26, 0.23), (2.55, 2.00, 0.18)]
    def can_ring(y, zt, wt, grow=0.0):
        hw, z0, z1, r, ct = tab(T, y); zb = z1 - 0.07; wb = hw - ct - 0.05
        if zt is None: zt = zb + 0.05
        wb += grow; wt += grow; zt += grow
        return [(wb, y, zb), (wb * 0.96, y, zb + (zt - zb) * 0.55), (wt, y, zt), (-wt, y, zt), (-wb * 0.96, y, zb + (zt - zb) * 0.55), (-wb, y, zb)]
    H.append(ring_loft('canopy_glass', [can_ring(*c) for c in CAN], gl))
    for c in CAN[1:]:
        pts = can_ring(*c, grow=0.018)
        for i in range(5): H.append(tube(f'hoop{c[0]}_{i}', pts[i], pts[i + 1], 0.032, 4, mat=gun))
    spine = [can_ring(*c, grow=0.02) for c in CAN]
    for i in range(len(spine) - 1):
        for k in (2, 3): H.append(tube(f'spine{i}{k}', spine[i][k], spine[i + 1][k], 0.028, 4, mat=gun))
        for k in (0, 5): H.append(tube(f'sill{i}{k}', spine[i][k], spine[i + 1][k], 0.04, 4, mat=gun))
    H.append(tube('wsc_post', can_ring(*CAN[0], grow=0.02)[2], can_ring(*CAN[1], grow=0.02)[2], 0.028, 4, mat=gun))
    H.append(ring_loft('can_fair', [can_ring(2.6, 2.02, 0.19), can_ring(1.85, 1.92, 0.12)], steel))
    # side sponsons (avionics / ammunition bays) carrying the stub wings
    for s in (1, -1):
        o = side(s)
        H.append(wedge(f'sponson{o}', (0.4, 3.3, 1.1), (s * 0.9, 0.95, 0.78),
                       moves=[('F' + o, (-s * 0.2, -0.3, 0)), ('FT', (0, -0.25, -0.12)), ('B' + o, (-s * 0.15, 0.25, 0)), ('BD', (0, 0.2, 0.15))],
                       bevel=0.03, seg=1, mat=steel))
        H.append(bx(f'sponred{o}', (0.02, 1.5, 0.46), (s * 1.105, 1.25, 0.6), bevel=0.006, seg=1, mat=red))
        H.append(bx(f'sponhatch{o}', (0.02, 0.55, 0.34), (s * 1.105, -0.12, 0.72), bevel=0.006, seg=1, mat=steel))
        H.append(bx(f'sponrib{o}', (0.03, 0.05, 0.6), (s * 1.11, 0.42, 0.72), mat=gun))
        H.append(bx(f'step{o}', (0.12, 0.3, 0.04), (s * 1.16, 2.1, 0.34), mat=gun))
        H.append(text_lo(f'warn{o}', 'NO STEP', 0.09, (s * 1.117, 1.25, 0.47), side_rot(s), ivory))
    # stub wings: red top panels, eroded leading edges, team end plates, nav lights, pylons
    WC = 1.22; WH = 0.24; WDROP = 0.17; WX0 = 0.965; WL = 2.65
    def wtop(x): return WC + WH / 2 - WDROP * (abs(x) - WX0) / WL
    def wbot(x): return WC - WH / 2 - WDROP * (abs(x) - WX0) / WL
    for s in (1, -1):
        o = side(s)
        w = wedge(f'wing{o}', (WL, 1.3, WH), (s * (WX0 + WL / 2), 1.05, WC),
                  moves=[(o, (0, 0, -WDROP)), ('FD', (0, -0.16, 0.06)), ('F' + o, (0, -0.12, 0)), ('B' + o, (0, 0.05, 0))], bevel=0.025, seg=1, mat=steel)
        faces_mat(w, erode, lambda c, n: n.y > 0.45)
        H.append(w)
        pl = wedge(f'wingred{o}', (2.15, 0.82, 0.02), (s * 2.35, 0.98, 0), moves=[(o, (0, 0, -WDROP * 2.15 / WL))], mat=red)
        pl.location.z = wtop(2.35) + 0.012 + WDROP * 2.15 / WL / 2; H.append(pl)
        H.append(bx(f'endplate{o}', (0.07, 1.15, 0.52), (s * 3.65, 0.98, WC - WDROP), bevel=0.015, seg=1, mat=tm))
        H.append(ball(f'nav{o}', 0.055, (s * 3.7, 1.3, WC - WDROP + 0.05), seg=8, rings=5, mat=navg if s > 0 else navr))
        H.append(bx(f'pylon{o}', (0.16, 0.72, 0.12), (s * 2.45, 1.4, wbot(2.45) - 0.05), bevel=0.02, seg=1, mat=gun))
        H.append(bx(f'wingrail{o}', (0.05, 1.0, 0.05), (s * 3.25, 1.0, wbot(3.25) - 0.03), mat=gun))
    # engine deck: gearbox fairing round the mast, twin nacelles with intakes, louvres and rear exhausts
    H.append(wedge('gearbox', (0.7, 1.75, 0.72), (0, 1.125, 2.2), moves=[('FT', (0, -0.6, -0.05)), ('BT', (0, 0.1, 0))], bevel=0.05, seg=1, mat=steel))
    H.append(bx('gb_red', (0.5, 0.6, 0.02), (0, 0.85, 2.565), mat=red))
    H.append(cyl('mastcollar', 0.22, 0.14, (0, H_HUB.y, 2.62), 'Z', 16, mat=gun))
    H.append(bx('gb_box', (0.36, 0.42, 0.22), (0, 0.42, 2.62), bevel=0.03, seg=1, mat=gun))
    for s in (1, -1):
        o = side(s)
        H.append(wedge(f'nacelle{o}', (0.48, 1.8, 0.62), (s * 0.43, -0.55, 2.12), moves=[('FT', (0, -0.22, -0.08)), ('D' + o, (-s * 0.08, 0, 0))], bevel=0.05, seg=1, mat=steel))
        H.append(bx(f'nacred{o}', (0.36, 0.7, 0.02), (s * 0.43, -0.95, 2.435), mat=red))
        H.append(grille(f'intake{o}', 0.42, 0.3, 4, depth=0.04, loc=(s * 0.68, -0.05, 2.14), rot=(0, 0, -s * math.pi / 2), mat=gun))
        H.append(hollow_tube(f'intk{o}', 0.15, 0.12, 0.16, (s * 0.47, 0.4, 2.24), 'Y', 12, lip=0.015, lipw=0.03, mat=gun, inner=black, floor=0.07))
        H.append(grille(f'louvre{o}', 0.3, 0.45, 5, depth=0.03, loc=(s * 0.43, -0.3, 2.43), rot=(math.pi / 2, 0, 0), mat=gun))
        H.append(hollow_tube(f'exh{o}', 0.26, 0.22, 0.5, (s * 0.43, -1.55, 2.12), 'Y', 16, lip=0.02, lipw=0.06, mat=heat, inner=black, floor=0.3))
    # tail: team band, drive-shaft cover, fin, ventral fin, stabilisers, tail-rotor gearbox
    def band(name, y0, y1, g, mat):
        rs = []
        for y in (y0, y1):
            hw, z0, z1, r, ct = tab(T, y); rs.append([(x, y, z) for x, z in rsec(hw + g, z0 - g, z1 + g, r, 1, ct)])
        return ring_loft(name, rs, mat)
    H.append(band('teamband', -3.55, -3.95, 0.014, tm))
    H.append(band('boomband', -2.2, -2.32, 0.012, gun))
    H.append(band('boomband2', -5.2, -5.3, 0.012, gun))
    z_a = tab(T, -2.3)[2]; z_b = tab(T, -6.0)[2]
    H.append(wedge('shaftcover', (0.14, 3.7, 0.08), (0, -4.15, (z_a + z_b) / 2 + 0.035), moves=[('B', (0, 0, -(z_a - z_b) / 2)), ('F', (0, 0, (z_a - z_b) / 2))], bevel=0.02, seg=1, mat=gun))
    fin = side_prism('fin', [(-5.35, 1.6), (-6.95, 1.54), (-6.82, 2.88), (-6.22, 2.88)], 0.16, bevel=0.02, seg=1, mat=red)
    faces_mat(fin, erode, lambda c, n: n.y > 0.5 and n.z > 0.2)
    H.append(fin)
    for s in (1, -1):
        H.append(emblem_H(f'finemb{side(s)}', 0.5, (s * 0.084, -6.42, 2.18), side_rot(s), ivory))
    H.append(side_prism('ventral', [(-6.05, 1.18), (-6.55, 0.7), (-6.88, 0.7), (-6.94, 1.2)], 0.1, bevel=0.015, seg=1, mat=steel))
    H.append(tube('tailbump', (0, -6.6, 0.72), (0, -6.9, 0.64), 0.035, 8, mat=gun))
    for s in (1, -1):
        o = side(s)
        st = wedge(f'stab{o}', (1.0, 0.62, 0.08), (s * 0.74, -5.95, 1.42), moves=[('F' + o, (0, -0.2, 0)), ('B' + o, (0, -0.05, 0))], bevel=0.015, seg=1, mat=red)
        faces_mat(st, erode, lambda c, n: n.y > 0.5); H.append(st)
        H.append(bx(f'stabend{o}', (0.05, 0.42, 0.22), (s * 1.26, -6.1, 1.42), bevel=0.01, seg=1, mat=tm))
    H.append(cyl('tgear', 0.12, 0.26, (0.21, H_TR.y, H_TR.z), 'X', 14, mat=gun))
    H.append(cyl('tgear_l', 0.1, 0.06, (-0.1, H_TR.y, H_TR.z), 'X', 12, mat=gun))
    H.append(ball('tailstrobe', 0.045, (0, -6.84, 2.92), seg=8, rings=5, mat=navr))
    # landing skids (dusty) on bowed struts with dampers
    for s in (1, -1):
        o = side(s)
        H.append(bx(f'skid{o}', (0.15, 4.6, 0.1), (s * 1.15, 1.6, -0.63), bevel=0.03, seg=1, mat=skid))
        H.append(bx(f'skidF{o}', (0.15, 0.62, 0.1), (s * 1.15, 4.12, -0.47), rot=(D(35), 0, 0), bevel=0.03, seg=1, mat=skid))
        H.append(bx(f'skidB{o}', (0.15, 0.3, 0.1), (s * 1.15, -0.83, -0.58), rot=(D(-25), 0, 0), bevel=0.03, seg=1, mat=skid))
        for k, y in enumerate((3.0, 0.6)):
            kn = (s * 1.0, y, -0.1)
            H.append(tube(f'strutU{o}{k}', (s * 0.46, y, 0.06), kn, 0.07, 10, mat=skid))
            H.append(tube(f'strutL{o}{k}', kn, (s * 1.15, y, -0.58), 0.065, 10, mat=skid))
            H.append(ball(f'knee{o}{k}', 0.095, kn, seg=10, rings=6, mat=gun))
            H.append(tube(f'damper{o}{k}', (s * 0.62, y + 0.12, 0.04), (s * 1.07, y + 0.1, -0.34), 0.035, 8, mat=gun))
            H.append(bx(f'fit{o}{k}', (0.24, 0.24, 0.12), (s * 0.48, y, 0.05), bevel=0.02, seg=1, mat=gun))
            H.append(bx(f'clamp{o}{k}', (0.2, 0.2, 0.08), (s * 1.15, y, -0.56), bevel=0.015, seg=1, mat=gun))
    # nose: chin sensor turret, lamps, pitot probes; antennas
    H.append(ball('chinball', 0.18, (0, 6.25, 0.0), seg=14, rings=8, mat=gun))
    H.append(cyl('chinmount', 0.12, 0.12, (0, 6.25, 0.1), 'Z', 12, mat=gun))
    H.append(bx('chinface', (0.3, 0.06, 0.26), (0, 6.4, 0.0), bevel=0.02, seg=1, mat=gun))
    for ix in (-0.065, 0.065):
        for iz in (-0.055, 0.065):
            H.append(cyl(f'chinlens{ix}{iz}', 0.042, 0.03, (ix, 6.44, iz), 'Y', 10, mat=lamp if iz < 0 else gl))
    for s in (1, -1):
        H.append(cyl(f'lamp{side(s)}', 0.045, 0.05, (s * 0.22, 6.8, 0.42), 'Y', 10, mat=lamp))
        H.append(tube(f'pitot{side(s)}', (s * 0.24, 6.7, 0.9), (s * 0.24, 7.28, 0.9), 0.04, 8, mat=gun))
    H.append(bx('nosecap', (0.28, 0.06, 0.38), (0, 7.06, 0.72), bevel=0.02, seg=1, mat=gun))
    H.append(tube('whip', (0, -1.15, 1.85), (0, -1.25, 2.75), 0.04, 8, mat=gun))
    H.append(wedge('bladeant', (0.04, 0.4, 0.22), (0, -3.2, tab(T, -3.2)[2] + 0.1), moves=[('FT', (0, -0.25, 0))], mat=gun))
    # wire-strike cutters, IR jammer, belly antennas, grab handles, rear service grille, cowling armour
    H.append(wedge('wirecut_top', (0.05, 0.3, 0.32), (0, 6.12, tab(T, 6.12)[2] + 0.18), moves=[('FT', (0, -0.22, 0))], mat=gun))
    H.append(wedge('wirecut_low', (0.05, 0.36, 0.26), (0, 6.6, 0.02), moves=[('FD', (0, -0.25, 0))], mat=gun))
    H.append(cyl('irj_post', 0.06, 0.3, (0, -1.5, 2.0), 'Z', 8, mat=gun))
    H.append(cyl('irj', 0.17, 0.26, (0, -1.5, 2.22), 'Z', 12, mat=gun, bevel=0.04))
    H.append(cyl('irj_cap', 0.12, 0.04, (0, -1.5, 2.36), 'Z', 12, mat=lamp))
    for k, y in enumerate((4.6, 1.8, -0.6)):
        H.append(wedge(f'bellyant{k}', (0.03, 0.26, 0.16), (0, y, -0.07), moves=[('BD', (0, 0.15, 0))], mat=gun))
    for s in (1, -1):
        o = side(s)
        for k, (y, z) in enumerate(((5.6, 1.18), (3.3, 1.42))):
            x = sx(T, y, z) + 0.06
            H.append(tube(f'hand{o}{k}a', (s * (x - 0.06), y + 0.18, z), (s * x, y + 0.14, z), 0.018, 5, mat=gun))
            H.append(tube(f'hand{o}{k}b', (s * x, y + 0.14, z), (s * x, y - 0.14, z), 0.018, 5, mat=gun))
            H.append(tube(f'hand{o}{k}c', (s * x, y - 0.14, z), (s * (x - 0.06), y - 0.18, z), 0.018, 5, mat=gun))
        H.append(grille(f'svc{o}', 0.5, 0.42, 4, depth=0.03, loc=(s * 0.9, -0.62, 0.62), rot=(0, 0, math.pi), mat=gun))
        H.append(bx(f'cowlvent{o}', (0.02, 0.35, 0.14), (s * (sx(T, -0.9, 1.45) + 0.03), -0.9, 1.45), mat=black))
        H.append(bx(f'skidshoe{o}', (0.17, 0.5, 0.04), (s * 1.15, 1.6, -0.665), mat=gun))
    hull = pivot_mesh('hull', H, (0, 0, 0), root); smooth(hull, 32)

    # ── main rotor: hub at the mast top, spins about local Z ──
    HUB = H_HUB
    R = [cyl('mast', 0.13, 0.72, (0, HUB.y, 2.96), 'Z', 14, mat=gun),
         cyl('swash', 0.32, 0.08, (0, HUB.y, 2.98), 'Z', 18, mat=gun),
         cyl('swash2', 0.26, 0.06, (0, HUB.y, 3.06), 'Z', 18, mat=steel),
         cyl('hubplate', 0.42, 0.16, tuple(HUB), 'Z', 20, mat=gun, bevel=0.025),
         cyl('hubring', 0.3, 0.08, (0, HUB.y, HUB.z + 0.1), 'Z', 16, mat=steel),
         ball('hubcap', 0.22, (0, HUB.y, HUB.z + 0.09), scale=(1, 1, 0.55), seg=14, rings=6, cut_below=0.0, mat=gun)]
    angs = [D(45 + 90 * k) for k in range(4)]
    for k, a in enumerate(angs):
        dv = Vector((math.cos(a), math.sin(a), 0)); pv = Vector((-dv.y, dv.x, 0))
        R.append(bx(f'grip{k}', (0.62, 0.24, 0.17), tuple(HUB + dv * 0.62), rot=(0, 0, a), bevel=0.025, seg=1, mat=gun))
        R.append(ball(f'brg{k}', 0.12, tuple(HUB + dv * 0.38), seg=10, rings=6, mat=steel))
        R.append(bx(f'horn{k}', (0.1, 0.06, 0.06), tuple(HUB + dv * 0.5 + pv * 0.16 - Vector((0, 0, 0.04))), rot=(0, 0, a), mat=gun))
        R.append(tube(f'plink{k}', tuple(Vector((0, HUB.y, 3.06)) + dv * 0.24 + pv * 0.16), tuple(HUB + dv * 0.5 + pv * 0.16 - Vector((0, 0, 0.05))), 0.028, 6, mat=steel))
        R.append(tube(f'damp{k}', tuple(HUB + dv * 0.32 - pv * 0.16), tuple(HUB + dv * 0.72 - pv * 0.13), 0.035, 6, mat=steel))
        R.append(bx(f'nut{k}', (0.07, 0.07, 0.05), tuple(HUB + dv * 0.25 + pv * 0.0 + Vector((0, 0, 0.1))), rot=(0, 0, a), mat=steel))
    rotor = pivot_mesh('rotor', R, tuple(HUB), hull); smooth(rotor, 40)
    for k, a in enumerate(angs):
        st = lambda x, c, t, sw=0.0: ((x, c / 2 - sw, 0.0), c, t)
        parts = [foil(f'b{k}cuff', [st(0.7, 0.36, 0.11), st(1.3, 0.46, 0.08)], mat=gun),
                 foil(f'b{k}main', [st(1.3, 0.46, 0.08), st(3.2, 0.52, 0.07), st(5.55, 0.52, 0.065)], mat=blade, le_mat=erode, le_n=2),
                 foil(f'b{k}strp', [st(5.55, 0.52, 0.065), st(5.75, 0.52, 0.064)], mat=ivory),
                 foil(f'b{k}tip', [st(5.75, 0.52, 0.064), st(6.42, 0.5, 0.06), st(H_ROTOR_R, 0.3, 0.04, 0.1)], mat=red, le_mat=erode, le_n=2)]
        for p in parts: p.rotation_euler = (0, 0, a); p.location = HUB
        dv = Vector((math.cos(a), math.sin(a), 0))
        smooth(pivot_mesh(f'blade_{k}', parts, tuple(HUB + dv * 0.7), rotor), 40)
    pivot_mesh('rotor_disc', [disc('rdisc', H_ROTOR_R, tuple(HUB), 'Z', 64, dmain)], tuple(HUB), rotor)

    # ── tail rotor: right of the fin, spins about local X ──
    TR = H_TR
    TRP = [cyl('trhub', 0.11, 0.16, tuple(TR), 'X', 12, mat=gun), ball('trcap', 0.08, tuple(TR + Vector((0.09, 0, 0))), seg=10, rings=5, mat=steel),
           cyl('trspider', 0.07, 0.06, tuple(TR + Vector((-0.06, 0, 0))), 'X', 10, mat=gun)]
    for k in range(4):
        a = D(45 + 90 * k)
        st = lambda r, c, t: ((0.0, c / 2, r), c, t)
        bl = [foil(f'tb{k}a', [st(0.1, 0.2, 0.045), st(0.8, 0.2, 0.035)], C=(0, -1, 0), Nn=(1, 0, 0), mat=blade, le_mat=erode, le_n=2),
              foil(f'tb{k}b', [st(0.8, 0.2, 0.035), st(0.88, 0.2, 0.035)], C=(0, -1, 0), Nn=(1, 0, 0), mat=ivory),
              foil(f'tb{k}c', [st(0.88, 0.2, 0.035), st(H_TR_R, 0.18, 0.03)], C=(0, -1, 0), Nn=(1, 0, 0), mat=red)]
        for p in bl: p.rotation_euler = (a, 0, 0); p.location = TR
        TRP += bl
    trot = pivot_mesh('tail_rotor', TRP, tuple(TR), hull); smooth(trot, 40)
    pivot_mesh('tail_disc', [disc('tdisc', H_TR_R, tuple(TR), 'X', 40, dtail)], tuple(TR), trot)

    # ── rocket pods: yaw pivots on the pylons (local Z), muzzles at the pod fronts (local +Y) ──
    for s in (1, -1):
        o = side(s); zp = wbot(2.45) - 0.11; c = Vector((s * 2.45, 1.4, zp - 0.08 - 0.28))
        PP = [bx(f'podbody{o}', (1.04, 1.5, 0.56), tuple(c), bevel=0.07, seg=2, mat=steel),
              bx(f'podred{o}', (0.02, 0.9, 0.34), tuple(c + Vector((s * 0.525, -0.1, 0.0))), mat=red),
              bx(f'podlug{o}', (0.16, 0.5, 0.08), tuple(c + Vector((0, 0, 0.32))), bevel=0.015, seg=1, mat=gun),
              bx(f'podteam{o}', (0.56, 0.16, 0.02), tuple(c + Vector((0, 0.5, 0.282))), mat=tm)]
        for k, dy in enumerate((0.5, -0.5)):
            PP.append(bx(f'strap{o}{k}', (1.08, 0.07, 0.6), tuple(c + Vector((0, dy, 0))), bevel=0.01, seg=1, mat=gun))
        for k, dx in enumerate((0.265, -0.265)):
            tc = c + Vector((dx, 0, 0))
            PP.append(hollow_tube(f'ptube{o}{k}', 0.235, 0.2, 1.7, tuple(tc), 'Y', 16, lip=0.022, lipw=0.08, mat=gun, inner=black, floor=0.3))
            PP.append(cyl(f'rocket{o}{k}', 0.012, 0.16, tuple(tc + Vector((0, 0.5, 0))), 'Y', 10, r2=0.09, mat=red))
        pod = pivot_mesh(f'pod_{o}', PP, (c.x, c.y, zp), hull); smooth(pod, 35)
        node(f'muzzle_{o}', (c.x, c.y + 0.86, c.z), pod)
        node(f'fx_exhaust_{o}', (s * 0.43, -1.82, 2.12), hull)
    node('hit', (0, 1.5, 0.9), root)
    node('badge', (0, 1.0, 3.9), root)
    done(uid, root, dict(faction='H', rotor_radius=H_ROTOR_R, tail_rotor_radius=H_TR_R, pod_yaw_deg=10.0))


# ═══════════════════════════ A04 KESTREL STRIKE JET (Vanguard Alliance) ═══════════════════════════
def jsec(hw, zc, ht, hb, et, eb, n=24):
    """Superellipse fuselage section (x, z): separate top/bottom heights and exponents (<2 chined, >2 boxy)."""
    pts = []
    for k in range(n):
        th = TAU * k / n; c, s_ = math.cos(th), math.sin(th)
        e = et if s_ >= 0 else eb; h = ht if s_ >= 0 else hb
        pts.append((hw * math.copysign(abs(c) ** (2 / e), c), zc + h * math.copysign(abs(s_) ** (2 / e), s_)))
    return pts

def jx(T, y, z):
    """Half-width of a jsec station table at height z."""
    hw, zc, ht, hb, et, eb = tab(T, y)
    h, e = (ht, et) if z >= zc else (hb, eb)
    q = min(1.0, abs(z - zc) / h)
    return hw * (1 - q ** e) ** (1 / e)

def jtop(T, y, x):
    hw, zc, ht, hb, et, eb = tab(T, y)
    q = min(1.0, abs(x) / hw)
    return zc + ht * (1 - q ** et) ** (1 / et)

def conform_fn(o, fx, s, gap):
    """Project a flat side decal onto a surface given by half-width function fx(y, z)."""
    xf(o); me = o.data
    cx = sum(v.co.x for v in me.vertices) / max(1, len(me.vertices))
    for v in me.vertices: v.co.x = s * (fx(v.co.y, v.co.z) + gap) + (v.co.x - cx)
    me.update(); return o

def frame_obj(o, X, Y, Z, loc):
    """Orient an object / empty with world axes X, Y, Z (columns) at loc."""
    M = Matrix((X, Y, Z)).transposed().to_4x4(); M.translation = Vector(loc); o.matrix_world = M; return o

def hinge_node(name, A, B, up, par, sgn=1):
    """Pivot empty on the hinge line A-B: local X along the hinge (pointing +x for both sides), Z ~ `up`."""
    A, B = Vector(A), Vector(B); X = (B - A).normalized()
    if X.x < 0: X = -X
    Z = Vector(up); Z = (Z - X * X.dot(Z)).normalized(); Y = Z.cross(X)
    e = node(name, tuple((A + B) / 2)); frame_obj(e, X, Y, Z, (A + B) / 2); parent(e, par); return e

def axis_node(name, A, B, side_n, par):
    """Pivot empty whose local Z runs along the hinge A->B (rudders); local X = side normal (pointing +x)."""
    A, B = Vector(A), Vector(B); Z = (B - A).normalized()
    X = Vector(side_n); X = (X - Z * Z.dot(X)).normalized()
    if X.x < 0: X = -X
    Y = Z.cross(X)
    e = node(name, tuple((A + B) / 2)); frame_obj(e, X, Y, Z, (A + B) / 2); parent(e, par); return e

def tyre(name, r, w, loc, mat, hub, segs=16):
    """Light wheel (axis X): rounded tyre by lathe + recessed hub disc + hub cap."""
    ri = r * 0.62; b = min(0.04, r * 0.15)
    prof = [(ri, -w / 2), (r - b, -w / 2), (r, -w / 2 + b), (r, w / 2 - b), (r - b, w / 2), (ri, w / 2)]
    t = lathe(name + 't', prof, segs, mat=mat)
    parts = [t, cyl(name + 'h', ri * 1.01, w * 0.8, (0, 0, 0), 'Z', segs, mat=hub), cyl(name + 'c', ri * 0.4, w * 0.95, (0, 0, 0), 'Z', 8, mat=hub)]
    o = join(name, parts); o.rotation_euler = (0, math.pi / 2, 0); o.location = loc
    return xf(o)

FUS_A = [  # y, hw, zc, ht, hb, top exp, bottom exp   (origin = belly at the wing root)
    (7.22, 0.02, 0.56, 0.02, 0.02, 2.0, 2.0),
    (7.00, 0.09, 0.56, 0.08, 0.07, 1.8, 1.8),
    (6.60, 0.20, 0.57, 0.18, 0.16, 1.8, 1.8),
    (6.00, 0.33, 0.60, 0.29, 0.27, 1.9, 1.9),
    (5.20, 0.46, 0.62, 0.40, 0.40, 2.0, 2.2),
    (4.40, 0.54, 0.63, 0.49, 0.50, 2.2, 2.6),
    (3.40, 0.60, 0.63, 0.55, 0.58, 2.4, 2.8),
    (2.40, 0.66, 0.62, 0.58, 0.62, 2.5, 3.0),
    (1.40, 0.76, 0.62, 0.60, 0.62, 2.6, 3.2),
    (0.20, 0.95, 0.62, 0.60, 0.62, 2.8, 3.4),
    (-1.50, 1.02, 0.62, 0.58, 0.62, 3.0, 3.4),
    (-3.20, 1.00, 0.63, 0.55, 0.60, 3.0, 3.2),
    (-4.60, 0.92, 0.65, 0.52, 0.56, 2.8, 3.0),
    (-5.70, 0.80, 0.66, 0.50, 0.52, 2.6, 2.8),
    (-6.40, 0.68, 0.66, 0.48, 0.48, 2.4, 2.6),
    (-6.80, 0.62, 0.66, 0.46, 0.46, 2.2, 2.2),
]
A_YS = [7.22, 7.0, 6.6, 6.3, 6.0, 5.6, 5.2, 4.8, 4.4, 3.7, 3.4, 2.9, 2.4, 1.9, 1.4, 0.8, 0.2, -0.6, -1.5, -2.4, -3.2, -3.9, -4.6, -5.2, -5.7, -6.1, -6.4, -6.8]
# wing planform (right side; mirrored): LE / TE / height / thickness as functions of span x
def a_le(x): return 1.25 - (x - 0.95) * 3.3 / 4.3
def a_te(x): return -4.35 + (x - 0.95) * 1.1 / 4.3
def a_z(x): return 0.5 + (x - 0.95) * math.tan(D(3))
def a_t(x): return 0.32 - (x - 0.95) * 0.25 / 4.3
def s_le(x): return -4.75 - (x - 0.55) * 1.6 / 2.6
def s_te(x): return -6.85 - (x - 0.55) * 0.25 / 2.6
def s_z(x): return 0.62 - (x - 0.55) * math.tan(D(4))
def s_t(x): return 0.12 - (x - 0.55) * 0.08 / 2.6
FIN_CANT = D(22); FIN_SPAN = 2.35

def build_A04():
    reset(); uid = 'A04'; P = PAL['A']
    root = node('root')
    grey = paint('a_grey', '#A6ACB1', scale=1.8, rough=0.45, metal=0.0, grime=0.3, wear=0.25, wear_col='#D3D7D9', noise=0.2)
    panelize(grey, size=(0.9, 1.1, 0.55), depth=0.32, tone=0.09)
    navy = paint('a_navy', '#3A4B66', scale=1.8, rough=0.5, metal=0.0, grime=0.3, wear=0.3, wear_col='#B9BEC2', noise=0.2)
    panelize(navy, size=(0.9, 1.1, 0.55), depth=0.3, tone=0.05)
    dark = paint('a_dark', '#3A3F44', scale=0.5, rough=0.45, metal=0.0, grime=0.3, wear=0.35, wear_col='#9A9EA2', noise=0.18)
    le = paint('a_le', '#CDD1D3', scale=0.5, rough=0.35, metal=0.0, grime=0.1, wear=0.0, noise=0.35)
    black = flat('a_black', '#0C0D0F', 0.85)
    ivory = flat('a_ivory', P['ivory'], 0.5)
    amber = flat('a_amber', '#E0A040', 0.45)
    chrome = paint('a_chrome', '#B9BDC0', scale=0.3, rough=0.3, metal=0.0, grime=0.35, wear=0.0, noise=0.12)
    tyrem = flat('a_tyre', '#1C1C1D', 0.9)
    noz = paint('a_noz', '#5C5650', scale=0.5, rough=0.45, metal=0.0, grime=0.35, wear=0.2, noise=0.3)
    heat_tint(noz, (0, -7.42, 0.66), (0, -1, 0), 0.7)
    bombm = paint('a_bomb', '#5E624B', scale=0.4, rough=0.55, metal=0.0, grime=0.35, wear=0.3, wear_col='#9A9C8E', noise=0.2)
    tm = team(1.5)
    gl = glass('GLASS', '#7A5518')
    burn = glow('afterburner', '#FF9A4A', 3)
    navr = glow('nav_red', '#FF3B30', 5); navg = glow('nav_green', '#39FF7A', 5)

    T = FUS_A; H = []
    hull_e = node('_hull_tmp')
    fus = loft('fuselage', [(y, jsec(*tab(T, y))) for y in A_YS], mat=grey)
    def fnavy(c, n):
        return ((3.7 < c.y < 5.6 and 0.3 < c.z < 0.98 and abs(c.x) > 0.2) or (4.4 < c.y < 6.3 and c.z > 0.86 and abs(c.x) < 0.3)
                or (-4.6 < c.y < -3.2 and 0.7 < c.z < 1.05 and abs(c.x) > 0.55) or (-2.4 < c.y < -0.6 and c.z < 0.25))
    faces_mat(fus, navy, fnavy); H.append(fus)
    spine = loft('spine', [(1.95, jsec(0.18, 1.05, 0.14, 0.2, 2.2, 2.2, 16)), (1.4, jsec(0.38, 1.0, 0.3, 0.2, 2.2, 2.2, 16)),
                           (-1.5, jsec(0.4, 0.98, 0.3, 0.2, 2.3, 2.3, 16)), (-3.6, jsec(0.36, 0.96, 0.25, 0.2, 2.3, 2.3, 16)),
                           (-5.2, jsec(0.14, 0.95, 0.12, 0.2, 2.2, 2.2, 16))], mat=grey)
    faces_mat(spine, navy, lambda c, n: -1.5 < c.y < 1.4 and n.z > 0.5); H.append(spine)
    # long canopy (amber tint) with windscreen bow and sill rails
    def can_ring(y, hw, zt, grow=0.0, n=9):
        zb = jtop(T, y, hw) - 0.06; hw += grow; zt += grow
        return [(hw * math.cos(math.pi * k / (n - 1)), y, zb + (zt - zb) * math.sin(math.pi * k / (n - 1)) ** 0.8) for k in range(n)]
    CAN = [(4.75, 0.1, None), (4.35, 0.34, 1.45), (3.6, 0.42, 1.72), (2.8, 0.42, 1.72), (2.1, 0.37, 1.56), (1.6, 0.26, 1.38), (1.3, 0.12, 1.26)]
    rings = []
    for y, hw, zt in CAN:
        if zt is None: zt = jtop(T, y, 0) + 0.02
        rings.append(can_ring(y, hw, zt))
    cano = ring_loft('canopy_g', rings, gl)
    for y, hw, zt in (CAN[1], CAN[3], CAN[5]):
        pts = can_ring(y, hw, zt, 0.015)
        for i in range(len(pts) - 1): H.append(tube(f'bow{y}_{i}', pts[i], pts[i + 1], 0.03, 4, mat=dark))
    for k in (0, -1):
        rp = [can_ring(y, hw, zt if zt else jtop(T, y, 0) + 0.02, 0.012)[k] for y, hw, zt in CAN[1:-1]]
        for i in range(len(rp) - 1): H.append(tube(f'sill{k}{i}', rp[i], rp[i + 1], 0.035, 4, mat=dark))
    # nose: pitot, chin sensor window, nose ID + emblem, anti-glare
    H.append(tube('pitot', (0, 7.1, 0.56), (0, 7.62, 0.56), 0.04, 8, mat=chrome))
    H.append(tube('pitotbase', (0, 6.95, 0.56), (0, 7.28, 0.56), 0.058, 8, mat=dark))
    H.append(cyl('irst', 0.09, 0.08, (0, 5.9, 0.95), 'Z', 12, mat=gl))
    for s in (1, -1):
        o = side(s)
        H.append(conform_fn(text_lo(f'id{o}', 'A04', 0.42, (s * 0.6, 4.62, 0.66), side_rot(s), ivory), lambda y, z: jx(T, y, z), s, 0.006))
        H.append(conform_fn(flat_poly(f'tri{o}', [(-0.5, 0.4), (0.5, 0.4), (0, -0.5)], 0.004, (s * 0.6, 3.95, 0.66), side_rot(s), amber, 0.16), lambda y, z: jx(T, y, z), s, 0.006))
    # intakes: raked caret ducts with real openings, splitter gap to the fuselage
    for s in (1, -1):
        o = side(s)
        it = wedge(f'intake{o}', (0.48, 3.0, 0.82), (s * 1.0, 1.1, 0.57), moves=[('FD', (0, -0.42, 0)), ('F' + o, (0, -0.18, 0)), ('BT', (0, 0, -0.36)), ('T' + o, (-s * 0.1, 0, 0))], bevel=0.02, seg=1, mat=grey)
        bore(it, (0, 0.9, -0.4), 0.045, 1.0, black, push=(0, -1, 0))
        faces_mat(it, navy, lambda c, n: abs(n.x) > 0.8)
        H.append(it)
        H.append(bx(f'splitter{o}', (0.02, 0.7, 0.5), (s * 0.745, 2.05, 0.55), mat=grey))
        def ix(y, z): return 1.24 - 0.1 * (z - 0.16) / (0.98 - 0.36 * (2.6 - y) / 3.0 - 0.16)
        H.append(conform_fn(text_lo(f'van{o}', 'VANGUARD ALLIANCE', 0.085, (s * 1.245, 1.25, 0.5), side_rot(s), ivory), ix, s, 0.004))
        H.append(bx(f'gunport{o}', (0.02, 0.28, 0.06), (s * jx(T, 3.1, 0.92), 3.1, 0.92), mat=black))
        H.append(conform_fn(flat_poly(f'warn{o}', [(-0.5, -0.4), (0.5, -0.4), (0, 0.5)], 0.004, (s * 1.245, 2.25, 0.8), side_rot(s), amber, 0.12), ix, s, 0.004))
    # wings: NACA sections, eroded leading edges, navy upper panels; ailerons on hinge pivots
    def wst(x, u0=0.0): return ((x, a_le(x), a_z(x)), a_le(x) - a_te(x), a_t(x))
    def wing_navy(c, n):
        x = abs(c.x); u = (a_le(x) - c.y) / max(0.1, a_le(x) - a_te(x))
        return n.z > 0.3 and 1.6 < x < 4.3 and 0.18 < u < 0.72
    for s in (1, -1):
        o = side(s)
        def mirror(obj):
            if s < 0:
                obj.scale = (-1, 1, 1); xf(obj)
                bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(obj.data); bm.free()
            return obj
        wi = mirror(foil(f'wingin{o}', [wst(0.8), wst(1.6), wst(2.4), wst(3.0)], mat=grey, le_mat=le, le_n=1))
        wo = mirror(foil(f'wingout{o}', [wst(3.0), wst(4.3), wst(5.0)], u1=0.75, mat=grey, le_mat=le, le_n=1))
        wt = mirror(foil(f'wingtip{o}', [wst(5.0), wst(5.25)], mat=grey, le_mat=le, le_n=1))
        for w in (wi, wo): faces_mat(w, navy, wing_navy)
        H += [wi, wo, wt]
        H.append(ball(f'nav{o}', 0.05, (s * 5.27, a_le(5.25) - 0.45, a_z(5.25)), seg=8, rings=5, mat=navg if s > 0 else navr))
        H.append(tube(f'tiprail{o}', (s * 5.27, a_le(5.25) - 0.1, a_z(5.25)), (s * 5.27, a_te(5.25) + 0.05, a_z(5.25)), 0.035, 6, mat=tm))
        em = emblem_A(f'wemb{o}', 0.42, (0, 0, 0), (0, 0, math.pi), ivory)
        xx = 4.45; em.location = (s * xx, a_le(xx) - 0.42 * (a_le(xx) - a_te(xx)), a_z(xx) + a_t(xx) * 0.55 + 0.004); em.rotation_euler = (0, s * D(3), math.pi)
        H.append(em)
        # aileron
        ail = mirror(foil(f'ail{o}', [wst(3.03), wst(4.97)], u0=0.75, mat=grey))
        A = Vector((s * 3.03, a_le(3.03) - 0.75 * (a_le(3.03) - a_te(3.03)), a_z(3.03)))
        B = Vector((s * 4.97, a_le(4.97) - 0.75 * (a_le(4.97) - a_te(4.97)), a_z(4.97)))
        hn = hinge_node(f'aileron_{o}', A, B, (0, 0, 1), hull_e)
        pivot_mesh(f'aileron_{o}_mesh', [ail], tuple((A + B) / 2), hn)
        # flap-track fairings + pylon + bomb rack
        for xx in (2.0, 3.6):
            H.append(wedge(f'fairing{o}{xx}', (0.08, 0.7, 0.1), (s * xx, a_te(xx) + 0.2, a_z(xx) - 0.1), moves=[('BD', (0, 0, 0.06))], mat=dark))
        px = 2.75; py = a_le(px) + 0.12
        H.append(wedge(f'pylon{o}', (0.1, 1.5, 0.2), (s * px, py - 0.55, 0.45), moves=[('FD', (0, -0.35, 0)), ('FT', (0, -0.05, 0))], bevel=0.01, seg=1, mat=grey))
        H.append(bx(f'rack{o}', (0.16, 0.7, 0.05), (s * px, py, 0.365), mat=dark))
        for dy in (0.3, -0.3): H.append(bx(f'sway{o}{dy}', (0.3, 0.05, 0.05), (s * px, py + dy, 0.36), mat=dark))
    # horizontal tail with elevators
    def sst(x): return ((x, s_le(x), s_z(x)), s_le(x) - s_te(x), s_t(x))
    for s in (1, -1):
        o = side(s)
        def mirror(obj):
            if s < 0:
                obj.scale = (-1, 1, 1); xf(obj)
                bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(obj.data); bm.free()
            return obj
        st = mirror(foil(f'stab{o}', [sst(0.55), sst(1.0), sst(2.2), sst(3.15)], u1=0.7, mat=grey, le_mat=le, le_n=1))
        faces_mat(st, navy, lambda c, n: n.z > 0.3 and 1.0 < abs(c.x) < 2.2)
        H.append(st)
        H.append(mirror(foil(f'stabr{o}', [sst(0.55), sst(1.0)], u0=0.7, mat=grey)))
        el = mirror(foil(f'elev{o}', [sst(1.02), sst(3.13)], u0=0.7, mat=grey))
        A = Vector((s * 1.02, s_le(1.02) - 0.7 * (s_le(1.02) - s_te(1.02)), s_z(1.02)))
        B = Vector((s * 3.13, s_le(3.13) - 0.7 * (s_le(3.13) - s_te(3.13)), s_z(3.13)))
        hn = hinge_node(f'elevator_{o}', A, B, (0, 0, 1), hull_e)
        pivot_mesh(f'elevator_{o}_mesh', [el], tuple((A + B) / 2), hn)
    # canted twin fins with rudders
    for s in (1, -1):
        o = side(s)
        S = Vector((s * math.sin(FIN_CANT), 0, math.cos(FIN_CANT))); Nn = Vector((s * math.cos(FIN_CANT), 0, -math.sin(FIN_CANT)))
        R0 = Vector((s * 0.7, -4.25, 1.0)); RT = R0 + S * FIN_SPAN + Vector((0, -1.75, 0))
        def fst(f):  # station at span fraction f
            P = R0.lerp(RT, f); return (tuple(P), 2.5 + (1.1 - 2.5) * f, 0.16 + (0.05 - 0.16) * f)
        fin = foil(f'fin{o}', [fst(0), fst(0.5), fst(1)], u1=0.7, C=(0, -1, 0), Nn=tuple(Nn), mat=navy, le_mat=le, le_n=1)
        H.append(fin)
        H.append(foil(f'finr0{o}', [fst(0), fst(0.07)], u0=0.7, C=(0, -1, 0), Nn=tuple(Nn), mat=grey))
        H.append(foil(f'finr1{o}', [fst(0.93), fst(1)], u0=0.7, C=(0, -1, 0), Nn=tuple(Nn), mat=grey))
        H.append(tube(f'fincap{o}', tuple(Vector(fst(1)[0]) + Vector((0, -0.05, 0)) + S * 0.02), tuple(Vector(fst(1)[0]) + Vector((0, -0.75, 0)) + S * 0.02), 0.03, 6, mat=tm))
        rud = foil(f'rud{o}', [fst(0.07), fst(0.93)], u0=0.7, C=(0, -1, 0), Nn=tuple(Nn), mat=grey)
        def hp(f):
            P, c, t = fst(f); return Vector(P) + Vector((0, -0.7 * c, 0))
        hn = axis_node(f'rudder_{o}', hp(0.07), hp(0.93), Nn, hull_e)
        pivot_mesh(f'rudder_{o}_mesh', [rud], tuple((hp(0.07) + hp(0.93)) / 2), hn)
        # emblem on the outer face of each fin (in the fin plane)
        P5, c5, t5 = fst(0.55); ec = Vector(P5) + Vector((0, -0.38 * c5, 0)) + Nn * (t5 * 0.5 + 0.006)
        em = emblem_A(f'femb{o}', 0.55, (0, 0, 0), (0, 0, 0), ivory)
        frame_obj(em, Vector((0, s, 0)), S, Vector((0, s, 0)).cross(S), ec); H.append(xf(em))
        H.append(wedge(f'finroot{o}', (0.3, 2.7, 0.42), (s * 0.6, -5.45, 0.86), moves=[('T', (-s * 0.05, 0, 0)), ('B', (0, 0, -0.04))], bevel=0.03, seg=1, mat=grey))
    # dorsal / ventral antennas, intakes on the spine, airbrake seam, ventral fins
    H.append(wedge('ant_top', (0.08, 0.45, 0.28), (0, -2.2, 1.36), moves=[('FT', (0, -0.3, 0))], mat=dark))
    H.append(wedge('ant_bot', (0.08, 0.4, 0.22), (0, 2.2, -0.08), moves=[('FD', (0, -0.25, 0))], mat=dark))
    for s in (1, -1):
        H.append(bx(f'vent{side(s)}', (0.14, 0.32, 0.012), (s * 0.2, -0.6, 1.278), mat=black))
        H.append(bx(f'vent2{side(s)}', (0.1, 0.22, 0.012), (s * 0.18, -2.9, 1.2), mat=black))
        H.append(wedge(f'ventral{side(s)}', (0.05, 1.1, 0.32), (s * 0.55, -5.4, 0.06), moves=[('BD', (0, 0.4, 0.1))], mat=grey))
    hull = pivot_mesh('hull', H, (0, 0, 0), root); smooth(hull, 35)
    for c in list(hull_e.children): parent(c, hull)
    bpy.data.objects.remove(hull_e, do_unlink=True)
    canopy = pivot_mesh('canopy', [cano], (0, 2.9, 1.0), hull); smooth(canopy, 60)

    # nozzle: heat-tinted petals round a glowing afterburner face
    NZ = Vector((0, -7.05, 0.66))
    NP = [hollow_tube('nzshell', 0.56, 0.47, 0.75, tuple(NZ), 'Y', 20, lip=0.02, lipw=0.06, mat=noz, inner=dark)]
    NP.append(disc('nzglow', 0.47, tuple(NZ + Vector((0, 0.2, 0))), 'Y', 20, burn))
    NP.append(cyl('nzcone', 0.16, 0.3, tuple(NZ + Vector((0, 0.08, 0))), 'Y', 12, r2=0.04, mat=dark))
    for k in range(12):
        a = TAU * k / 12; rv = Vector((math.cos(a), 0, math.sin(a)))
        pt = bx(f'petal{k}', (0.24, 0.42, 0.025), (0, 0, 0), mat=noz)
        pt.rotation_euler = (0, -a + math.pi / 2, 0); pt.location = NZ + rv * 0.555 + Vector((0, -0.2, 0)); xf(pt)
        NP.append(pt)
    nozzle = smooth(pivot_mesh('nozzle', NP, tuple(NZ), hull), 40)
    node('fx_exhaust', (0, -7.45, 0.66), hull)

    # landing gear (exported down): nose retracts forward, mains inward
    NG = Vector((0, 4.3, 0.45))
    gn = node('gear_N', tuple(NG)); parent(gn, hull); gn['retract'] = round(math.pi / 2, 4)
    GP = [tube('ng_strut', tuple(NG), (0, 4.4, -0.75), 0.065, 10, mat=dark), tube('ng_oleo', (0, 4.38, -0.6), (0, 4.42, -1.12), 0.045, 10, mat=chrome),
          bx('ng_fork', (0.08, 0.12, 0.2), (0, 4.42, -1.05), mat=dark), tube('ng_axle', (-0.18, 4.42, -1.12), (0.18, 4.42, -1.12), 0.03, 6, mat=chrome),
          bx('ng_torq', (0.04, 0.22, 0.16), (0, 4.5, -0.75), mat=dark), tube('ng_drag', (0, 4.38, -0.2), (0, 4.95, 0.4), 0.03, 6, mat=dark),
          cyl('ng_lamp', 0.05, 0.05, (0, 4.47, -0.45), 'Y', 8, mat=ivory)]
    for e in (1, -1): GP.append(tyre(f'ng_w{e}', 0.24, 0.13, (e * 0.1, 4.42, -1.12), tyrem, chrome))
    smooth(pivot_mesh('gear_N_mesh', GP, tuple(NG), gn), 40)
    for s in (1, -1):
        o = side(s); MG = Vector((s * 1.75, -2.45, 0.45))
        g = node(f'gear_{o}', tuple(MG)); frame_obj(g, Vector((0, 1, 0)), Vector((-1, 0, 0)), Vector((0, 0, 1)), MG); parent(g, hull)
        g['retract'] = round(s * math.pi / 2, 4)
        MP = [tube(f'mg_strut{o}', tuple(MG), (s * 1.75, -2.45, -0.7), 0.08, 10, mat=dark), tube(f'mg_oleo{o}', (s * 1.75, -2.45, -0.55), (s * 1.75, -2.45, -1.06), 0.06, 10, mat=chrome),
              tube(f'mg_axle{o}', (s * 1.7, -2.45, -1.06), (s * 1.95, -2.45, -1.06), 0.04, 6, mat=chrome),
              tube(f'mg_brace{o}', (s * 1.75, -2.45, -0.35), (s * 1.3, -1.6, 0.35), 0.04, 6, mat=dark),
              bx(f'mg_torq{o}', (0.05, 0.24, 0.2), (s * 1.75, -2.6, -0.8), mat=dark),
              bx(f'mg_door{o}', (0.03, 0.9, 0.55), (s * 1.62, -2.35, -0.15), mat=grey),
              tyre(f'mg_w{o}', 0.32, 0.22, (s * 1.88, -2.45, -1.06), tyrem, chrome)]
        smooth(pivot_mesh(f'gear_{o}_mesh', MP, tuple(MG), g), 40)

    # bombs: separate meshes, origin at the bomb centre, hanging on the pylons
    for s in (1, -1):
        o = side(s); px = 2.75; py = a_le(px) + 0.12; BC = Vector((s * px, py, 0.2))
        prof = [(0.6, 0.012), (0.56, 0.06), (0.5, 0.1), (0.42, 0.135), (0.3, 0.16), (-0.3, 0.16), (-0.42, 0.13), (-0.5, 0.095)]
        rings = [[(r * math.cos(TAU * k / 14), y, r * math.sin(TAU * k / 14)) for k in range(14)] for y, r in prof]
        BP = [ring_loft(f'bombbody{o}', rings, bombm)]
        faces_mat(BP[0], dark, lambda c, n: c.y > 0.49)
        BP.append(cyl(f'bband{o}', 0.163, 0.07, (0, 0.22, 0), 'Y', 14, mat=amber))
        BP.append(cyl(f'bband2{o}', 0.163, 0.04, (0, -0.24, 0), 'Y', 14, mat=amber))
        for k in range(4):
            a = D(45 + 90 * k); rv = Vector((math.cos(a), 0, math.sin(a)))
            f = wedge(f'bfin{o}{k}', (0.2, 0.24, 0.014), (0, 0, 0), moves=[('F' + 'R', (0, -0.14, 0))], mat=bombm)
            f.location = rv * 0.2 + Vector((0, -0.46, 0)); f.rotation_euler = (0, -a, 0); xf(f); BP.append(f)
            g2 = bx(f'bstrake{o}{k}', (0.07, 0.22, 0.01), tuple(rv * 0.19 + Vector((0, 0.02, 0))), rot=(0, -a, 0), mat=bombm); BP.append(g2)
        BP += [bx(f'blug{o}{k}', (0.04, 0.06, 0.05), (0, dy, 0.17), mat=dark) for k, dy in enumerate((0.2, -0.15))]
        for p in BP: p.location = Vector(p.location) + BC
        smooth(pivot_mesh(f'bomb_{o}', BP, tuple(BC), root), 40)

    node('hit', (0, 0.0, 0.7), root)
    node('badge', (0, 0.0, 3.8), root)
    done(uid, root, dict(faction='A', bomb_length_m=1.2, gear='down'))


# ═══════════════════════════ T04 MOTE RECON DRONE (Nova Directive) ═══════════════════════════
T_DUCT_R = 0.575; T_DUCT_IN = 0.47; T_DZ = (0.07, 0.35); T_ROTOR_Z = 0.19; T_ROTOR_R = 0.455
T_DUCTS = {'FL': (-1.125, 0.72), 'FR': (1.125, 0.72), 'RL': (-1.125, -0.72), 'RR': (1.125, -0.72)}
T_SEGS = 20

def build_T04():
    reset(); uid = 'T04'; P = PAL['T']
    root = node('root')
    graph = paint('t_graph', '#4E5256', scale=0.6, rough=0.5, metal=0.0, grime=0.35, wear=0.4, wear_col='#A9AFB2', noise=0.22)
    panelize(graph, size=(0.26, 0.3, 0.18), width=0.006, depth=0.3, tone=0.05)
    duct = paint('t_duct', '#565A5F', scale=0.5, rough=0.5, metal=0.0, grime=0.4, wear=0.65, wear_col='#B4B9BC', noise=0.3)
    silver = paint('t_silver', '#BCC1C4', scale=0.6, rough=0.4, metal=0.0, grime=0.3, wear=0.2, wear_col='#E2E5E6', noise=0.15)
    panelize(silver, size=(0.26, 0.3, 0.18), width=0.006, depth=0.28, tone=0.04)
    dark = paint('t_dark', '#2A2D30', scale=0.3, rough=0.45, metal=0.0, grime=0.3, wear=0.3, wear_col='#8E9497', noise=0.15)
    amber = flat('t_amber', '#C8892E', 0.45)
    black = flat('t_black', '#0C0D0E', 0.8)
    mark = flat('t_mark', '#2B2E31', 0.5)
    cyan = glow('cyan', P['glow'], 6)
    gl = glass('GLASS', '#3A2A18')
    drot = disc_mat('DISC_rotor')
    tm = team(0.4)
    H = []
    z0, z1 = T_DZ
    # ── body: pale silver frame, graphite upper body, battery shell, sloped nose plate, rear service module ──
    H.append(top_prism('frame', [(-0.5, -0.95), (0.5, -0.95), (0.56, -0.75), (0.56, 0.55), (0.5, 0.75), (-0.5, 0.75), (-0.56, 0.55), (-0.56, -0.75)], 0.0, 0.22, bevel=0.02, seg=1, mat=silver))
    H.append(top_prism('upper', [(-0.42, -0.82), (0.42, -0.82), (0.46, -0.62), (0.46, 0.42), (0.4, 0.56), (-0.4, 0.56), (-0.46, 0.42), (-0.46, -0.62)], 0.22, 0.38, bevel=0.02, seg=1, mat=graph))
    H.append(bx('battery', (0.62, 1.2, 0.14), (0, -0.14, 0.44), bevel=0.04, seg=2, mat=graph))
    H.append(bx('cover', (0.38, 0.96, 0.06), (0, -0.14, 0.535), bevel=0.015, seg=1, mat=dark))
    for s in (1, -1):
        H.append(bx(f'trim{side(s)}', (0.018, 0.98, 0.022), (s * 0.2, -0.14, 0.552), mat=amber))
        H.append(bx(f'latch{side(s)}', (0.06, 0.08, 0.03), (s * 0.32, 0.3, 0.5), mat=dark))
    for k, y in enumerate((-0.42, 0.14)):
        H.append(bx(f'coverrib{k}', (0.3, 0.03, 0.012), (0, y, 0.571), mat=graph))
    H.append(flat_poly('cwarn', [(-0.5, -0.4), (0.5, -0.4), (0, 0.5)], 0.004, (0, -0.48, 0.566), (0, 0, math.pi), amber, 0.09))
    H.append(bx('sensor_box', (0.26, 0.12, 0.07), (0, 0.5, 0.42), bevel=0.01, seg=1, mat=dark))
    H.append(bx('sensor_win', (0.18, 0.012, 0.035), (0, 0.562, 0.425), mat=gl))
    H.append(top_prism('noseplate', [(-0.44, 0.48), (0.44, 0.48), (0.44, 0.955), (-0.44, 0.955)], 0.06, 0.36, bevel=0.015, seg=1, mat=silver))
    nose = top_prism('nosetip', [(-0.44, 0.95), (0.44, 0.95), (0.13, 1.27), (-0.13, 1.27)], 0.06, 0.36, mat=silver)
    for v in nose.data.vertices:
        if v.co.z > 0.3: v.co.z -= (v.co.y - 0.95) * 0.4
    nose.data.update(); bev(nose, 0.015, 1)
    H.append(nose)
    sl = math.atan(0.4)
    H.append(flat_poly('logo', [(-0.5, -0.4), (0.5, -0.4), (0, 0.5)], 0.004, (0, 0.64, 0.362), (0, 0, 0), mark, 0.13))
    H.append(flat_poly('logo_in', [(-0.2, -0.25), (0.2, -0.25), (0, 0.12)], 0.004, (0, 0.64, 0.365), (0, 0, 0), silver, 0.13))
    H.append(text_lo('nose_id', 'T04', 0.13, (0, 0.83, 0.362), (0, 0, math.pi), mark))
    H.append(chevron('arrow', 0.24, (0, 1.1, 0.36 - (1.1 - 0.95) * 0.4 + 0.004), (-sl, 0, 0), mark))
    H.append(bx('chin', (0.5, 0.42, 0.06), (0, 0.85, 0.03), bevel=0.01, seg=1, mat=dark))
    H.append(bx('visor', (0.2, 0.012, 0.06), (0, 1.272, 0.16), mat=black))
    H.append(bx('visorglow', (0.12, 0.006, 0.012), (0, 1.279, 0.16), mat=cyan))
    # rear service module: silver panel with screws, cyan status bar
    H.append(bx('rearmod', (0.5, 0.22, 0.3), (0, -0.98, 0.21), bevel=0.02, seg=1, mat=graph))
    H.append(bx('svcpanel', (0.38, 0.02, 0.2), (0, -1.1, 0.2), bevel=0.005, seg=1, mat=silver))
    for sx_ in (-0.16, 0.16):
        for sz in (0.12, 0.28): H.append(cyl(f'screw{sx_}{sz}', 0.012, 0.01, (sx_, -1.112, sz), 'Y', 6, mat=dark))
    H.append(bx('statusbar', (0.32, 0.02, 0.035), (0, -0.745, 0.45), mat=cyan))
    H.append(bx('statushood', (0.36, 0.04, 0.012), (0, -0.745, 0.475), mat=dark))
    # side frames between front and rear ducts, arm brackets, conduit pipes under the arms
    for s in (1, -1):
        o = side(s)
        H.append(bx(f'sideframe{o}', (0.14, 0.9, 0.2), (s * 0.6, -0.08, 0.17), bevel=0.02, seg=1, mat=silver))
        H.append(grille(f'sidevent{o}', 0.4, 0.12, 3, depth=0.02, loc=(s * 0.675, -0.08, 0.17), rot=(0, 0, -s * math.pi / 2), mat=dark))
        for e in (1, -1):
            cx, cy = s * 1.125, e * 0.72
            a = Vector((s * 0.5, e * 0.55, 0)); d = (Vector((cx, cy, 0)) - a).normalized(); ang = math.atan2(d.y, d.x)
            H.append(bx(f'arm{o}{e}', (0.24, 0.17, 0.13), tuple(a + d * 0.05 + Vector((0, 0, 0.2))), rot=(0, 0, ang), bevel=0.02, seg=1, mat=silver))
            H.append(bx(f'armcap{o}{e}', (0.16, 0.12, 0.02), tuple(a + d * 0.04 + Vector((0, 0, 0.275))), rot=(0, 0, ang), mat=dark))
            for k, off in enumerate((0.04, -0.04)):
                pv = Vector((-d.y, d.x, 0)) * off
                H.append(tube(f'pipe{o}{e}{k}', tuple(a - d * 0.1 + pv + Vector((0, 0, 0.04))), tuple(a + d * 0.13 + pv + Vector((0, 0, 0.075))), 0.018, 6, mat=dark))
    # ── ducts: chunky faceted closed guards with seam clamps, cyan strips, motor + crossed spars ──
    prof = [(T_DUCT_IN, z0 + 0.02), (T_DUCT_IN + 0.02, z0), (T_DUCT_R - 0.025, z0), (T_DUCT_R, z0 + 0.025),
            (T_DUCT_R, z1 - 0.025), (T_DUCT_R - 0.025, z1), (T_DUCT_IN + 0.02, z1), (T_DUCT_IN, z1 - 0.02)]
    fa = TAU / T_SEGS
    for nm, (cx, cy) in T_DUCTS.items():
        c = Vector((cx, cy, 0)); out = Vector((math.copysign(1, cx), 0, 0)); fwd = Vector((0, math.copysign(1, cy), 0))
        H.append(lathe(f'duct{nm}', prof, T_SEGS, center=(cx, cy, 0), mat=duct, a0=fa / 2))
        H.append(lathe(f'ductlip{nm}', [(T_DUCT_IN - 0.012, z1 - 0.06), (T_DUCT_IN + 0.005, z1 - 0.06), (T_DUCT_IN + 0.005, z1 - 0.03), (T_DUCT_IN - 0.012, z1 - 0.03)], T_SEGS, center=(cx, cy, 0), mat=dark, a0=fa / 2))
        for k in (2, 7, 12, 17):   # clamps on facet seams (45/135/225/315 deg)
            a = fa / 2 + fa * k; rv = Vector((math.cos(a), math.sin(a), 0))
            H.append(bx(f'clamp{nm}{k}', (0.03, 0.05, z1 - z0 + 0.02), tuple(c + rv * (T_DUCT_R + 0.006) + Vector((0, 0, (z0 + z1) / 2))), rot=(0, 0, a), mat=dark))
        def facet(dirv):   # centre angle of the facet facing dirv
            a = math.atan2(dirv.y, dirv.x); return fa * round(a / fa)
        for tag, dv in (('o', out), ('f', fwd)):
            a = facet(dv); rv = Vector((math.cos(a), math.sin(a), 0)); rr = T_DUCT_R * math.cos(fa / 2)
            H.append(bx(f'strip{nm}{tag}', (0.012, 0.15, 0.03), tuple(c + rv * (rr + 0.005) + Vector((0, 0, 0.255))), rot=(0, 0, a), mat=cyan))
            H.append(bx(f'stripbed{nm}{tag}', (0.008, 0.19, 0.05), tuple(c + rv * (rr + 0.002) + Vector((0, 0, 0.255))), rot=(0, 0, a), mat=dark))
        at = facet(out + fwd * 0.8); rv = Vector((math.cos(at), math.sin(at), 0))
        H.append(bx(f'team{nm}', (0.09, 0.2, 0.012), tuple(c + rv * (T_DUCT_R - 0.05) + Vector((0, 0, z1 + 0.004))), rot=(0, 0, at), mat=tm))
        H.append(cyl(f'motor{nm}', 0.095, 0.1, (cx, cy, 0.28), 'Z', 14, mat=dark))
        H.append(cyl(f'motorcap{nm}', 0.075, 0.03, (cx, cy, 0.345), 'Z', 14, mat=silver))
        H.append(cyl(f'motorbolt{nm}', 0.028, 0.02, (cx, cy, 0.365), 'Z', 8, mat=dark))
        for k in range(6):
            a = TAU * k / 6; H.append(bx(f'fin{nm}{k}', (0.03, 0.012, 0.08), (cx + math.cos(a) * 0.1, cy + math.sin(a) * 0.1, 0.27), rot=(0, 0, a), mat=dark))
        for k, a in enumerate((D(45), D(135))):
            H.append(bx(f'spar{nm}{k}', (2 * T_DUCT_IN + 0.02, 0.045, 0.035), (cx, cy, z1 - 0.035), rot=(0, 0, a), bevel=0.008, seg=1, mat=silver))
    for nm, rot_ in (('FL', (math.pi / 2, 0, -math.pi / 2)), ('RR', (math.pi / 2, 0, math.pi / 2))):
        cx, cy = T_DUCTS[nm]; s = 1 if cx > 0 else -1
        rr = T_DUCT_R * math.cos(fa / 2)
        t = text_lo(f'duct_id{nm}', 'T04', 0.11, (cx + s * (rr + 0.004), cy + (0.05 if s < 0 else -0.05), 0.15), (math.pi / 2, 0, (math.pi / 2 if s > 0 else -math.pi / 2)), mark)
        H.append(t)
    hull = pivot_mesh('hull', H, (0, 0, 0), root); smooth(hull, 35)

    # ── rotors: spinner + 3 pitched blades (spin about local Z) + translucent disc child ──
    pitch = D(24)
    C = Vector((0, -math.cos(pitch), -math.sin(pitch))); Nn = Vector((0, -math.sin(pitch), math.cos(pitch)))
    for nm, (cx, cy) in T_DUCTS.items():
        rc = Vector((cx, cy, T_ROTOR_Z)); spin = 1 if nm in ('FR', 'RL') else -1
        Cs = C * Vector((1, spin, 1)); Ns = Nn * Vector((1, spin, 1))
        RP = [cyl(f'shaft{nm}', 0.025, 0.05, (cx, cy, T_ROTOR_Z + 0.03), 'Z', 8, mat=dark),
              cyl(f'rhub{nm}', 0.06, 0.05, tuple(rc), 'Z', 12, mat=silver),
              cyl(f'rnut{nm}', 0.025, 0.03, (cx, cy, T_ROTOR_Z - 0.035), 'Z', 8, mat=dark)]
        for k in range(3):
            st = lambda r, c_, t: (tuple(Vector((r, 0, 0)) - Cs * (c_ / 2)), c_, t)
            bl = foil(f'rb{nm}{k}', [st(0.05, 0.08, 0.02), st(0.3, 0.11, 0.016), st(T_ROTOR_R - 0.01, 0.07, 0.01)], C=tuple(Cs), Nn=tuple(Ns), mat=dark)
            bl.rotation_euler = (0, 0, TAU * k / 3 + D(20)); bl.location = rc; RP.append(bl)
        rot = pivot_mesh(f'rotor_{nm}', RP, tuple(rc), hull); smooth(rot, 40)
        pivot_mesh(f'rotor_{nm}_disc', [disc(f'rd{nm}', T_ROTOR_R, tuple(rc), 'Z', 32, drot)], tuple(rc), rot)

    # ── sensor gimbal: yaw (local Z) under the nose -> pitch (local X) -> camera eye + pulse emitter ──
    GY = Vector((0, 0.85, -0.005)); GP = Vector((0, 0.85, -0.2))
    YP = [cyl('g_mount', 0.11, 0.06, (0, GY.y, -0.035), 'Z', 14, mat=dark),
          bx('g_yoke', (0.56, 0.14, 0.05), (-0.06, GY.y, -0.085), bevel=0.012, seg=1, mat=graph),
          bx('g_armR', (0.045, 0.13, 0.17), (0.2, GY.y, -0.17), bevel=0.01, seg=1, mat=graph),
          bx('g_armL', (0.045, 0.13, 0.17), (-0.315, GY.y, -0.17), bevel=0.01, seg=1, mat=graph)]
    gimbal = pivot_mesh('gimbal', YP, tuple(GY), hull)
    cam = cyl('g_cam', 0.135, 0.26, (0.03, GP.y, GP.z), 'Y', 8, mat=graph); cam.rotation_euler = (math.pi / 2, math.pi / 8, 0)
    PPm = [cam, bx('g_camtop', (0.16, 0.2, 0.03), (0.03, GP.y - 0.01, GP.z + 0.13), mat=dark),
           hollow_tube('g_lensring', 0.105, 0.088, 0.05, (0.03, GP.y + 0.14, GP.z), 'Y', 12, lip=0.008, lipw=0.012, mat=dark, inner=dark),
           bx('g_emit', (0.12, 0.2, 0.12), (-0.2, GP.y, GP.z), bevel=0.015, seg=1, mat=graph),
           cyl('g_emitring', 0.052, 0.03, (-0.2, GP.y + 0.105, GP.z), 'Y', 12, mat=dark),
           cyl('g_emitlens', 0.041, 0.01, (-0.2, GP.y + 0.122, GP.z), 'Y', 12, mat=cyan),
           bx('g_link', (0.12, 0.1, 0.06), (-0.1, GP.y - 0.03, GP.z), mat=dark),
           wedge('g_hood', (0.2, 0.1, 0.025), (0.03, GP.y + 0.16, GP.z + 0.12), moves=[('FT', (0, 0, -0.012))], mat=dark),
           bx('g_finR', (0.012, 0.16, 0.12), (0.148, GP.y - 0.02, GP.z), mat=dark),
           bx('g_emitcap', (0.13, 0.12, 0.02), (-0.2, GP.y - 0.02, GP.z + 0.068), mat=dark),
           cyl('g_trun', 0.03, 0.56, (-0.06, GP.y, GP.z), 'X', 8, mat=dark)]
    gp = pivot_mesh('gimbal_pitch', PPm, tuple(GP), gimbal)
    EYE = Vector((0.03, GP.y + 0.135, GP.z))
    pivot_mesh('eye', [cyl('g_lens', 0.088, 0.02, tuple(EYE), 'Y', 16, mat=gl)], tuple(EYE), gp)
    node('muzzle', (-0.2, GP.y + 0.13, GP.z), gp)
    node('hit', (0, 0, 0.25), root)
    node('badge', (0, 0, 1.0), root)
    done(uid, root, dict(faction='T', rotor_radius=T_ROTOR_R))


BUILDERS = {'H04': build_H04, 'A04': build_A04, 'T04': build_T04}

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    which = args[0] if args else 'all'
    for uid in (['H04', 'A04', 'T04'] if which == 'all' else [which]):
        if uid in BUILDERS: BUILDERS[uid]()
