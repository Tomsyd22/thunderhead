#!/usr/bin/env python
"""Thunderhead armour: H03 Bastion Heavy Tank (Iron Legion), A03 Lancer Medium Tank (Vanguard Alliance),
T03 Wisp Hover Tank (Nova Directive), A06 anti-air vehicle (Vanguard Alliance; 6×6, twin coil-laser emitters).

Run:  /home/claude/blender-env/bin/python /home/claude/thunderhead/units/blender/vehicles.py H03|A03|T03|A06|all

Conventions follow units/CONTRACT.md: metres, Z up, +Y forward, +X = unit right, root empty at the ground under the hull
centre. Shared toolkit = ulib.py (read-only here); extra helpers live in this file.

Track belts (track_L / track_R): closed belt built around the convex hull of the road wheels, sprocket, idler and return
rollers (side profile), extruded across the track width, with block grousers. UVs are written here from the exact arc
length of the wheel-contact path: U = s / uv_m, uv_m = 8 x link pitch (lib.track_image has 8 links across U), so one
texture link = one modelled link. U increases rear->front along the ground run (same sense as ulib.track_uv on the
ground run), continues up over the idler, front->rear along the top run and down round the sprocket; the seam lands on
an integer U so the texture tiles. V = 0..1 across the belt width (outer and inner faces).
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ulib import *          # noqa: F401,F403  (bx, wedge, loft, paint, finish, ... and lib re-exports)
import ulib, lib
import bpy, bmesh
from mathutils import Vector, Matrix

TAU = 2 * math.pi


def _sock(n, ident):
    return next(s for s in n.inputs if s.identifier == ident)


def _out(n, ident='Result_Color'):
    return next(s for s in n.outputs if s.identifier == ident)


def grunge(m, streak=0.3, dust=0.3, dust_col='#857A68', scale=3.0, streak_col='#2E2720'):
    """Extra weathering on a ulib paint material (baked like the rest): vertical grime streaks (noise stretched along Z)
    and dust settling on up-facing surfaces (world normal Z)."""
    nt = m.node_tree; N = nt.nodes; L = nt.links; bsdf = N['Principled BSDF']
    src = bsdf.inputs['Base Color'].links[0].from_socket
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (7.0 / scale, 7.0 / scale, 0.7 / scale); L.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.5; nz.inputs['Detail'].default_value = 6
    L.new(mp.outputs['Vector'], nz.inputs['Vector'])
    sr = N.new('ShaderNodeMapRange'); sr.inputs['From Min'].default_value = 0.48; sr.inputs['From Max'].default_value = 0.72
    sr.inputs['To Max'].default_value = streak; L.new(nz.outputs['Fac'], sr.inputs['Value'])
    sm = N.new('ShaderNodeMix'); sm.data_type = 'RGBA'; sm.blend_type = 'MIX'
    L.new(sr.outputs['Result'], _sock(sm, 'Factor_Float')); L.new(src, _sock(sm, 'A_Color')); _sock(sm, 'B_Color').default_value = (*lin(streak_col), 1)
    geo = N.new('ShaderNodeNewGeometry'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], sep.inputs[0])
    dr = N.new('ShaderNodeMapRange'); dr.inputs['From Min'].default_value = 0.3; dr.inputs['From Max'].default_value = 0.95
    dr.inputs['To Max'].default_value = dust; L.new(sep.outputs['Z'], dr.inputs['Value'])
    dn = N.new('ShaderNodeTexNoise'); dn.inputs['Scale'].default_value = 4.0 / scale; dn.inputs['Detail'].default_value = 8
    L.new(tc.outputs['Object'], dn.inputs['Vector'])
    dnr = N.new('ShaderNodeMapRange'); dnr.inputs['From Min'].default_value = 0.35; dnr.inputs['From Max'].default_value = 0.65
    dnr.inputs['To Min'].default_value = 0.25; L.new(dn.outputs['Fac'], dnr.inputs['Value'])
    dm = N.new('ShaderNodeMath'); dm.operation = 'MULTIPLY'; L.new(dr.outputs['Result'], dm.inputs[0]); L.new(dnr.outputs['Result'], dm.inputs[1])
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MIX'
    L.new(dm.outputs[0], _sock(mx, 'Factor_Float')); L.new(_out(sm), _sock(mx, 'A_Color')); _sock(mx, 'B_Color').default_value = (*lin(dust_col), 1)
    L.new(_out(mx), bsdf.inputs['Base Color'])
    return m


# ═════════════════════════════ extra geometry helpers ═════════════════════════════
def lathe(name, prof, seg=16, axis='X', mats=None, bands=None, cap0=True, cap1=True, phase=0.0, loc=(0, 0, 0)):
    """Surface of revolution. prof = [(radius, axial), ...] (axial = coordinate along axis). bands[i] = material index of the
    band between profile points i and i+1 (caps take the index of the adjacent band)."""
    bm = bmesh.new(); rings = []
    for r, a in prof:
        ring = []
        for k in range(seg):
            t = TAU * k / seg + phase; c, s = r * math.cos(t), r * math.sin(t)
            co = {'X': (a, c, s), 'Y': (c, a, s), 'Z': (c, s, a)}[axis]
            ring.append(bm.verts.new(co))
        rings.append(ring)
    mi = (lambda i: bands[i]) if bands else (lambda i: 0)
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(seg):
            k2 = (k + 1) % seg
            f = bm.faces.new((A[k], A[k2], B[k2], B[k])); f.material_index = mi(i)
    if cap0: f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mi(0)
    if cap1: f = bm.faces.new(rings[-1]); f.material_index = mi(len(rings) - 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = mesh_obj(name, bm); o.location = loc
    for m in (mats or []): o.data.materials.append(m)
    return o


def torus(name, R, r, loc=(0, 0, 0), rot=(0, 0, 0), seg=10, seg2=4, arc=1.0, mat=None):
    """Ring in the local XY plane (axis Z). arc < 1 makes an open U (shackles), capped."""
    bm = bmesh.new(); full = arc >= 0.999; n = seg if full else seg + 1; rings = []
    for i in range(n):
        a = TAU * arc * i / seg - (0 if full else TAU * arc / 2 + math.pi / 2)
        ring = []
        for j in range(seg2):
            b = TAU * j / seg2 + math.pi / seg2; rr = R + r * math.cos(b)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(seg2):
            j2 = (j + 1) % seg2; bm.faces.new((A[j], B[j], B[j2], A[j2]))
    if not full: bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = mesh_obj(name, bm); o.location = loc; o.rotation_euler = rot
    if mat: assign(o, mat)
    return o


def prism(name, pts_xy, z0, z1, top=None, mat=None, bevel=0.0, seg=1, angle=30):
    """Plan-view outline extruded from z0 to z1; top(x, y) -> (x, y) reshapes the top outline (tapered sides)."""
    bm = bmesh.new(); lo = [bm.verts.new((x, y, z0)) for x, y in pts_xy]
    hi = [bm.verts.new((*(top(x, y) if top else (x, y)), z1)) for x, y in pts_xy]
    n = len(pts_xy); bm.faces.new(list(reversed(lo))); bm.faces.new(hi)
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); o = mesh_obj(name, bm)
    if bevel: bev(o, bevel, seg, angle)
    if mat: assign(o, mat)
    return o


def mark(name, text, size, loc, facing='+X', mat=None, res=3):
    """Flat painted marking (low-res text, one-sided, faces `facing`). ulib.text_mark costs ~2k tris for 3 glyphs."""
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = text; cu.size = size; cu.extrude = 0.0
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = res
    try: cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    except Exception: pass
    o = bpy.data.objects.new(name, cu); link(o); o.location = loc
    o.rotation_euler = {'+X': (math.pi / 2, 0, math.pi / 2), '-X': (math.pi / 2, 0, -math.pi / 2),
                        '-Y': (math.pi / 2, 0, 0), '+Y': (math.pi / 2, 0, math.pi), '+Z': (0, 0, 0)}[facing]
    bpy.context.view_layer.update()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active; o.name = name
    if mat: assign(o, mat)
    return o


def sec6(hw0, z0, hw1, z1, hw2, z2):
    """Hull cross-section (x, z): bottom corners, side break, top chamfer."""
    return [(hw0, z0), (hw1, z1), (hw2, z2), (-hw2, z2), (-hw1, z1), (-hw0, z0)]


def on_slope(name, size, x, y, surf, theta, mat, lift=0.0, bevel=0.02, seg=1):
    """Box lying on a slope that descends toward +Y: surf(y) = surface height, theta = slope angle."""
    h = size[2]; nz, ny = math.cos(theta), math.sin(theta); z = surf(y)
    c = (x, y + ny * (h / 2 + lift), z + nz * (h / 2 + lift))
    return bx(name, size, c, rot=(-theta, 0, 0), bevel=bevel, seg=seg, mat=mat)


def hull2d(pts):
    """Convex hull (Andrew's monotone chain), CCW in (y, z): starts at the rearmost point, ground run first."""
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in pts))
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def belt(name, circles, xc, width, t, g, pitch, mat, links_per_u=8, fr=(0.0, 0.09, 0.52, 0.61)):
    """Closed track belt. circles = [(y, z, r)] the inner face wraps (wheel contact). t = plate thickness, g = grouser
    height (grousers occupy fr[1]..fr[2] of each link). Returns the object (uv_m set)."""
    pts = [(cy + r * math.cos(TAU * k / 120), cz + r * math.sin(TAU * k / 120)) for cy, cz, r in circles for k in range(120)]
    P = hull2d(pts); n = len(P); cum = [0.0]
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]; cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    L = cum[-1]; nl = max(links_per_u, links_per_u * round(L / (pitch * links_per_u))); p = L / nl; uv_m = p * links_per_u

    def at(s):
        s %= L; lo_, hi_ = 0, n
        while hi_ - lo_ > 1:
            mid = (lo_ + hi_) // 2
            if cum[mid] <= s: lo_ = mid
            else: hi_ = mid
        a, b = P[lo_], P[(lo_ + 1) % n]; sl = cum[lo_ + 1] - cum[lo_]; f = (s - cum[lo_]) / sl if sl > 0 else 0.0
        return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f

    def nrm(s, d=0.035):
        a, b = at(s - d), at(s + d); ty, tz = b[0] - a[0], b[1] - a[1]; l = math.hypot(ty, tz)
        return tz / l, -ty / l                     # outward for a CCW loop
    off = (t, t + g, t + g, t)
    S = [(k * p + f * p, o) for k in range(nl) for f, o in zip(fr, off)]
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); x0, x1 = xc - width / 2, xc + width / 2; R = []
    for s, o in S:
        y, z = at(s); ny, nz = nrm(s); yo, zo = y + ny * o, z + nz * o
        R.append((bm.verts.new((x0, y, z)), bm.verts.new((x1, y, z)), bm.verts.new((x1, yo, zo)), bm.verts.new((x0, yo, zo)), s / uv_m))
    N = len(R)
    for i in range(N):
        j = (i + 1) % N; a0i, a1i, a1o, a0o, ua = R[i]; b0i, b1i, b1o, b0o, ub = R[j]
        if j == 0: ub = L / uv_m
        for vs, uvs in (((a0o, b0o, b1o, a1o), ((ua, 0), (ub, 0), (ub, 1), (ua, 1))),        # outer (ground side)
                        ((a0i, a1i, b1i, b0i), ((ua, 0), (ua, 1), (ub, 1), (ub, 0))),        # inner (wheel side)
                        ((a1i, a1o, b1o, b1i), ((ua, 1), (ua, 0.9), (ub, 0.9), (ub, 1))),    # +X edge
                        ((a0i, b0i, b0o, a0o), ((ua, 0), (ub, 0), (ub, 0.1), (ua, 0.1)))):   # -X edge
            f = bm.faces.new(vs)
            for lp, uv in zip(f.loops, uvs): lp[uvl].uv = uv
    o = mesh_obj(name, bm); o.data.materials.append(mat); o['uv_m'] = round(uv_m, 5)
    o['links'] = nl; o['pitch_m'] = round(p, 5)
    return o


def track_material(name, rubber, steel):
    """TRACK_L / TRACK_R: unbaked, scrolling image texture (own image per side so three.js gets two textures)."""
    img = lib.track_image(name.lower() + '_img', rubber=rubber, steel=steel)
    m = bpy.data.materials.new(name); m.use_nodes = True; N = m.node_tree.nodes; b = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage'); t.image = img; m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.88; b.inputs['Metallic'].default_value = 0.35
    return m


def road_wheel(name, r, w, sx, m_tyre, m_hub, seg=14, dish=0.035):
    """Road wheel / idler (axis X), outer face toward sx*X. Origin at the axle."""
    hw = w / 2
    prof = [(0.13 * r, hw + 0.05), (0.27 * r, hw + 0.05), (0.31 * r, hw + 0.01), (0.66 * r, hw - dish), (0.76 * r, hw),
            (0.85 * r, hw), (0.97 * r, hw - 0.012), (r, hw - 0.05), (r, -hw + 0.05), (0.88 * r, -hw)]
    prof = [(rr, sx * a) for rr, a in prof]
    return lathe(name, prof, seg, 'X', mats=[m_tyre, m_hub], bands=[1, 1, 1, 1, 1, 0, 0, 0, 0])


def sprocket(name, r_c, w, sx, teeth, m_hub, m_teeth, t):
    """Drive sprocket (axis X): hub lathe + two toothed rings whose tips sink into the belt. Origin at the axle."""
    hw = w / 2
    hub = lathe(name + '_hub', [(0.15 * r_c, sx * (hw + 0.06)), (0.3 * r_c, sx * (hw + 0.06)), (0.34 * r_c, sx * hw),
                                (0.8 * r_c, sx * (hw - 0.03)), (0.8 * r_c, -sx * hw)], 12, 'X', mats=[m_hub])
    parts = [hub]; phi = TAU / teeth; r_root = r_c - 0.03; r_tip = r_c + 0.7 * t
    for k, xo in enumerate((hw - 0.06, -hw + 0.06)):
        pts = []
        for i in range(teeth):
            a0 = i * phi
            for da, rr in ((-0.30, r_root), (-0.12, r_tip), (0.12, r_tip), (0.30, r_root)):
                a = a0 + da * phi; pts.append((rr * math.cos(a), rr * math.sin(a)))
        ring = side_prism(name + f'_ring{k}', pts, 0.1, mat=m_teeth); ring.location.x = xo; parts.append(ring)
    return join(name, parts)


def running_gear(root, G, M):
    """Road wheels, sprockets, idlers (named, origins on axles, property r), track belts and return rollers.
    G = dict(tx, tw, t, g, wr, ww, wz, wheel_ys (front->back), spr=(y,z,r), idl=(y,z,r), rollers=[(y,z,r)], pitch).
    Returns the return-roller meshes (to be merged into the hull)."""
    extra = []
    for side, sx in (('L', -1), ('R', 1)):
        xc = sx * G['tx']
        for i, y in enumerate(G['wheel_ys']):
            w = road_wheel(f'wheel_{side}_{i}', G['wr'], G['ww'], sx, M['tyre'], M['rim'], seg=G.get('wseg', 14))
            w.location = (xc, y, G['wz']); w['r'] = round(G['wr'], 4); smooth(w, 35); attach(w, root)
        sy, sz, sr = G['spr']
        s = sprocket(f'sprocket_{side}', sr, G['ww'] * 0.9, sx, G.get('teeth', 11), M['rim'], M['teeth'], G['t'])
        s.location = (xc, sy, sz); s['r'] = round(sr, 4); smooth(s, 35); attach(s, root)
        iy, iz, ir = G['idl']
        idl = road_wheel(f'idler_{side}', ir, G['ww'] * 0.9, sx, M['tyre'], M['rim'], seg=G.get('wseg', 14), dish=0.05)
        idl.location = (xc, iy, iz); idl['r'] = round(ir, 4); smooth(idl, 35); attach(idl, root)
        for k, (ry, rz, rr) in enumerate(G['rollers']):
            extra.append(cyl(f'rr{side}{k}', rr, G['ww'] * 0.5, (xc, ry, rz), 'X', 10, mat=M['rim']))
        circles = [(y, G['wz'], G['wr']) for y in G['wheel_ys']] + [G['spr'], G['idl']] + list(G['rollers'])
        tb = belt(f'track_{side}', circles, xc, G['tw'], G['t'], G['g'], G['pitch'], M['TRACK_' + side])
        attach(tb, root)
    return extra


def finish_unit(uid, root, extras):
    if os.environ.get('VEH_FAST'):                 # iteration mode: no bake / export, quick procedural preview
        objs = [o for o in bpy.data.objects if not o.name.startswith('_')]
        meshes = [o for o in objs if o.type == 'MESH' and not o.hide_render]
        rep, lo, hi = check_dims(uid, meshes)
        print(f'[{uid}] tris {tris(meshes)} (LOD0 budget {SPEC[uid]["budget"][0]}), objects {len(objs)}')
        for o in sorted(meshes, key=lambda o: -tris([o]))[:12]: print('   ', o.name, tris([o]))
        if os.environ.get('VEH_FAST') == '2': ulib.preview_sheet(uid, lo, hi, samples=6)
        return rep
    rep = finish(uid, root, size=2048, samples=16, extras=extras)
    return rep


# ═════════════════════════════ H03 BASTION HEAVY TANK ═════════════════════════════
def build_H03():
    reset(); uid = 'H03'; P = PAL['H']
    root = node('root')
    STEEL, OXIDE = '#46423D', '#7E3B33'
    M = dict(
        steel=paint('H_steel', STEEL, scale=3, rough=0.6, metal=0.3, grime=0.75, wear=0.8, wear_col='#B5AFA4', mud_top=1.55, mud=0.9, noise=0.45),
        oxide=paint('H_oxide', OXIDE, scale=3, rough=0.66, metal=0.12, grime=0.7, wear=0.85, wear_col='#807A72', mud_top=1.55, mud=0.85, noise=0.45),
        steel_t=paint('H_steel_t', STEEL, scale=2.5, rough=0.6, metal=0.3, grime=0.7, wear=0.8, wear_col='#B5AFA4', noise=0.45),
        oxide_t=paint('H_oxide_t', OXIDE, scale=2.5, rough=0.66, metal=0.12, grime=0.65, wear=0.85, wear_col='#807A72', noise=0.45),
        dark=paint('H_dark', P['steel_dark'], scale=1.0, rough=0.55, metal=0.45, grime=0.6, wear=0.6, wear_col='#9A968F', mud_top=1.55, mud=0.8),
        dark_t=paint('H_dark_t', P['steel_dark'], scale=1.0, rough=0.55, metal=0.45, grime=0.5, wear=0.4, wear_col='#8A867F'),
        tyre=paint('H_tyre', '#252422', scale=0.6, rough=0.9, metal=0.0, grime=0.4, wear=0.15, wear_col='#4A4743', mud_top=0.4, mud=0.9),
        rim=paint('H_rim', '#3E3C38', scale=0.6, rough=0.6, metal=0.35, grime=0.65, wear=0.5, wear_col='#8E8A82', mud_top=0.4, mud=0.85),
        teeth=gunmetal('H_teeth', '#3A3936', scale=0.5, wear=0.7),
        barrel=paint('H_barrel', '#3A3835', scale=1.5, rough=0.5, metal=0.5, grime=0.5, wear=0.45, wear_col='#8E8A82', soot=(0, 2.78, 0, 0.75), noise=0.4),
        bore=flat('H_bore', '#0A0A0A', 0.75),
        ivory=paint('H_ivory', P['ivory'], scale=1.0, rough=0.6, metal=0.05, grime=0.45, wear=0.45, wear_col='#6A3A33', noise=0.3),
        red=flat('H_tail', '#7A1712', 0.35),
        rubber=paint('H_rubber', '#1F1E1C', scale=0.5, rough=0.95, metal=0.0, grime=0.3, wear=0.0, mud_top=1.55, mud=0.9),
        canvas=fabric('H_canvas', P['fabric'], scale=0.6, mud_top=None),
        lamp=glow('lamp', '#FFE4B5', 5.0), glass=glass(), team=team(1.5),
        TRACK_L=track_material('TRACK_L', (0.085, 0.072, 0.058), (0.30, 0.285, 0.26)),
        TRACK_R=track_material('TRACK_R', (0.085, 0.072, 0.058), (0.30, 0.285, 0.26)),
    )
    for sx in (-1, 1):
        M[f'soot{sx}'] = paint(f'H_soot{sx}', P['steel_dark'], scale=1.0, rough=0.6, metal=0.4, grime=0.6, wear=0.35,
                               wear_col='#77746E', mud_top=1.2, mud=0.6, soot=(sx * 1.05, -4.2, 1.38, 0.6))
    for k in ('steel', 'oxide'): grunge(M[k], streak=0.4, dust=0.4, scale=3.0)
    for k in ('steel_t', 'oxide_t'): grunge(M[k], streak=0.35, dust=0.35, scale=2.5)
    for k in ('dark', 'dark_t', 'soot-1', 'soot1', 'barrel'): grunge(M[k], streak=0.2, dust=0.25, scale=1.5)

    # ── running gear ──
    TX, TW, T, G = 1.42, 0.78, 0.06, 0.045
    WR = 0.36; WZ = WR + T + G
    GR = dict(tx=TX, tw=TW, t=T, g=G, wr=WR, ww=0.60, wz=WZ, wheel_ys=[2.45 - 0.84 * i for i in range(7)],
              spr=(-3.52, 0.70, 0.30), idl=(3.40, 0.70, 0.29), rollers=[(-1.95, 0.91, 0.09), (-0.25, 0.91, 0.09), (1.45, 0.91, 0.09)],
              pitch=0.225, teeth=11, wseg=12)
    HP = running_gear(root, GR, M)

    # ── hull ──
    HP.append(loft('hull_up', [
        (-4.05, sec6(1.79, 1.13, 1.79, 1.54, 1.60, 1.67)),
        (-3.93, sec6(1.83, 1.13, 1.83, 1.58, 1.64, 1.72)),
        (2.55, sec6(1.83, 1.13, 1.83, 1.58, 1.64, 1.72)),
        (4.08, sec6(1.83, 1.13, 1.83, 1.21, 1.68, 1.29)),
        (4.18, sec6(1.79, 1.16, 1.79, 1.19, 1.62, 1.25))], mat=M['steel']))
    bev(HP[-1], 0.025, 1, 30)
    HP.append(side_prism('hull_lo', [(-3.88, 1.16), (-3.97, 0.80), (-3.62, 0.44), (3.30, 0.44), (4.14, 1.16)], 1.96, mat=M['steel'], bevel=0.02, seg=1))
    th = math.atan2(0.43, 1.53); gl = lambda y: 1.72 - (y - 2.55) * math.tan(th)
    # glacis applique, driver hatch + periscopes, headlights with guards, lifting eyes
    for k, (x, w) in enumerate(((-0.78, 0.66), (0.0, 0.8), (0.78, 0.66))):   # bolted glacis applique, three plates
        HP.append(on_slope(f'glacis_plate{k}', (w, 1.05, 0.05), x, 3.42, gl, th, M['steel'], bevel=0.02))
    HP.append(on_slope('glacis_plate_u', (1.6, 0.42, 0.04), 0, 2.92 - 0.0, gl, th, M['steel'], lift=0.0, bevel=0.015))
    HP.append(on_slope('drv_hatch', (0.5, 0.5, 0.05), 0.62, 2.88, gl, th, M['steel'], lift=0.0, bevel=0.015))
    HP.append(on_slope('drv_hinge', (0.08, 0.1, 0.07), 0.62 - 0.26, 2.88, gl, th, M['dark'], bevel=0.0))
    for k in range(2):
        HP.append(on_slope(f'drv_per{k}', (0.16, 0.07, 0.07), 0.48 + k * 0.28, 2.6, gl, th, M['glass'], bevel=0.0))
    for sx in (-1, 1):
        x = sx * 0.9
        HP.append(bx(f'hl_box{sx}', (0.3, 0.22, 0.26), (x, 3.96, gl(3.96) + 0.08), bevel=0.02, seg=1, mat=M['dark']))
        HP.append(cyl(f'hl_lens{sx}', 0.08, 0.04, (x, 4.08, gl(3.96) + 0.1), 'Y', 12, mat=M['lamp']))
        for k in (-1, 1):
            HP.append(bx(f'hl_bar{sx}{k}', (0.025, 0.025, 0.28), (x + k * 0.1, 4.14, gl(3.96) + 0.1), mat=M['dark']))
        HP.append(bx(f'hl_top{sx}', (0.26, 0.2, 0.025), (x, 4.06, gl(3.96) + 0.245), mat=M['dark']))
        HP.append(bx(f'hl_mid{sx}', (0.24, 0.02, 0.02), (x, 4.14, gl(3.96) + 0.1), mat=M['dark']))
        HP.append(torus(f'eye{sx}', 0.07, 0.02, (sx * 1.0, 3.2, gl(3.2) + 0.08), (0, math.pi / 2, 0), mat=M['dark']))
        # front track-guard armour blocks (oxide-red corners) + mud flaps
        HP.append(wedge(f'fguard{sx}', (0.70, 0.94, 0.56), (sx * 1.53, 3.71, 1.40), moves=[('FT', (0, -0.34, -0.02)), ('FD', (0, -0.06, 0))],
                        bevel=0.03, seg=1, mat=M['oxide']))
        HP.append(bx(f'fflap{sx}', (0.66, 0.025, 0.24), (sx * 1.53, 4.10, 1.0), mat=M['rubber']))
        # rear corner blocks, tail lights, exhaust boxes (sooted), rear mud flaps
        HP.append(bx(f'rcorner{sx}', (0.54, 0.3, 0.5), (sx * 1.57, -3.94, 1.42), bevel=0.025, seg=1, mat=M['oxide']))
        HP.append(bx(f'tail{sx}', (0.18, 0.05, 0.1), (sx * 1.6, -4.11, 1.58), mat=M['red']))
        HP.append(bx(f'tailg{sx}', (0.24, 0.1, 0.02), (sx * 1.6, -4.12, 1.645), mat=M['dark']))
        HP.append(bx(f'exb{sx}', (0.44, 0.18, 0.42), (sx * 1.05, -4.10, 1.38), bevel=0.025, seg=1, mat=M[f'soot{sx}']))
        HP.append(lathe(f'exo{sx}', [(0.135, -4.15), (0.135, -4.20), (0.095, -4.20), (0.095, -4.12)], 12, 'Y',
                        mats=[M[f'soot{sx}'], M['bore']], bands=[0, 0, 1], loc=(sx * 1.05, 0, 1.38)))
        HP.append(bx(f'rflap{sx}', (0.66, 0.025, 0.26), (sx * 1.53, -4.0, 1.0), mat=M['rubber']))
        # tow hooks (front and rear shackles)
        for (y, z, ry) in ((3.84, 0.92, 1), (-3.98, 0.74, -1)):
            HP.append(bx(f'hookm{sx}{ry}', (0.16, 0.12, 0.13), (sx * 0.55, y, z), bevel=0.015, seg=1, mat=M['dark']))
            HP.append(torus(f'hook{sx}{ry}', 0.085, 0.026, (sx * 0.55, y + ry * 0.1, z - 0.07), (0, math.pi / 2, 0), seg=8, arc=0.62, mat=M['dark']))
        # side skirts: seven armour panels with oxide-red front / middle / rear panels
        n = 7; y0, y1 = 3.52, -3.95; pp = (y0 - y1) / n
        for i in range(n):
            yc = y0 - pp * (i + 0.5); mv = []
            if i == 0: mv = [('FD', (0, -0.3, 0.24))]
            if i == n - 1: mv = [('BD', (0, 0.2, 0.18))]
            HP.append(wedge(f'skirt{sx}{i}', (0.06, pp - 0.035, 0.84), (sx * 1.87, yc, 1.25), moves=mv, bevel=0.014, seg=1,
                            mat=M['oxide'] if i in (0, 3, 6) else M['steel']))
        HP.append(bx(f'skrail{sx}', (0.05, 7.4, 0.05), (sx * 1.875, -0.22, 1.69), mat=M['dark']))
        # rear fender tool boxes + tow cable on the hull side
        HP.append(bx(f'toolbox{sx}', (0.52, 0.9, 0.22), (sx * 1.45, -3.15, 1.83), bevel=0.02, seg=1, mat=M['steel']))
        HP.append(bx(f'toolbox_lid{sx}', (0.54, 0.06, 0.04), (sx * 1.45, -2.72, 1.92), mat=M['dark']))
    # rear: cooling grille between the exhausts, engine deck grilles
    HP.append(grille('rgrille', 1.3, 0.46, 7, depth=0.05, loc=(0, -4.08, 1.38), rot=(0, 0, math.pi), mat=M['dark']))
    HP.append(grille('dgrille', 1.45, 1.05, 10, depth=0.04, loc=(0, -3.35, 1.735), rot=(math.pi / 2, 0, math.pi / 2), mat=M['dark']))
    for sx in (-1, 1):
        HP.append(grille(f'sgrille{sx}', 0.5, 0.75, 6, depth=0.035, loc=(sx * 1.05, -3.42, 1.735), rot=(math.pi / 2, 0, 0), mat=M['dark']))
    HP.append(bx('deckplate', (2.0, 1.3, 0.03), (0, -2.15, 1.735), bevel=0.01, seg=1, mat=M['steel']))
    cab = [(-0.9, -3.95, 1.75), (-0.9, -2.95, 1.75), (0.9, -2.95, 1.75), (0.9, -3.95, 1.75)]   # tow cable coiled round the engine deck grille
    for k in range(3):
        HP.append(tube(f'cable{k}', cab[k], cab[k + 1], 0.03, verts=6, mat=M['dark']))
    for sx in (-1, 1):
        HP.append(torus(f'cable_eye{sx}', 0.07, 0.025, (sx * 0.9, -4.0, 1.76), (0, 0, 0), seg=8, mat=M['dark']))
    for sx in (-1, 1):
        HP.append(bx(f'sdeck_f{sx}', (0.5, 1.5, 0.025), (sx * 1.3, 1.55, 1.73), bevel=0.008, seg=1, mat=M['steel']))
        HP.append(bx(f'sdeck_r{sx}', (0.5, 1.2, 0.025), (sx * 1.3, -1.6, 1.73), bevel=0.008, seg=1, mat=M['steel']))
        HP.append(torus(f'reye{sx}', 0.065, 0.02, (sx * 1.55, -3.75, 1.80), (0, math.pi / 2, 0), mat=M['dark']))
        for i in range(7):                                   # skirt bolts, two per panel
            yc = 3.52 - (7.47 / 7) * (i + 0.5)
            for k in (-1, 1):
                HP.append(cyl(f'bolt{sx}{i}{k}', 0.03, 0.03, (sx * 1.893, yc + k * 0.38, 1.56), 'X', 6, mat=M['dark']))
    hull = join('hull', HP); smooth(hull, 35); attach(hull, root)

    # ── turret (yaw about Z at the ring centre) ──
    RY, RZ = -0.30, 1.72
    TP = [cyl('tring', 1.18, 0.12, (0, RY, 1.76), 'Z', 24, mat=M['dark_t'])]
    sh = loft('tshell', [
        (-2.05, sec6(1.24, 1.80, 1.30, 2.20, 1.12, 2.38)),
        (-1.75, sec6(1.40, 1.80, 1.45, 2.20, 1.28, 2.40)),
        (0.80, sec6(1.42, 1.80, 1.45, 2.20, 1.28, 2.40)),
        (2.22, sec6(0.44, 1.80, 0.46, 2.18, 0.38, 2.33))], mat=M['steel_t'])
    set_faces_mat(sh, M['oxide_t'], lambda c, nn: c.y > 0.9 and nn.y > 0.2 and abs(nn.x) > 0.3)
    bev(sh, 0.03, 1, 30); TP.append(sh)
    for sx, face in ((-1, '-X'), (1, '+X')):
        TP.append(bx(f'tside{sx}', (0.06, 1.75, 0.36), (sx * 1.465, -0.12, 2.0), bevel=0.012, seg=1, mat=M['oxide_t']))
        TP.append(mark(f'tmark{sx}', 'H03', 0.4, (sx * 1.497, -0.1, 2.0), face, M['ivory']))
        # stowage bins on the turret rear flanks, with TEAM stripe and grid bars
        TP.append(bx(f'tbin{sx}', (0.16, 0.85, 0.34), (sx * 1.53, -1.32, 2.06), bevel=0.015, seg=1, mat=M['steel_t']))
        TP.append(bx(f'tbint{sx}', (0.02, 0.85, 0.08), (sx * 1.615, -1.32, 2.17), mat=M['team']))
        for k in range(3):
            TP.append(bx(f'tbinb{sx}{k}', (0.03, 0.03, 0.32), (sx * 1.62, -1.62 + k * 0.3, 2.04), mat=M['dark_t']))
        # smoke grenade launchers (4 per side) on the turret flank ahead of the bins
        for k in range(4):
            a = (sx * 1.48, -0.72 + k * 0.13, 2.27); b = (a[0] + sx * 0.12, a[1] + 0.14, a[2] + 0.12)
            TP.append(tube(f'smk{sx}{k}', a, b, 0.05, verts=8, mat=M['dark_t']))
        TP.append(bx(f'smkb{sx}', (0.12, 0.6, 0.08), (sx * 1.45, -0.53, 2.23), mat=M['dark_t']))
        TP.append(torus(f'teye{sx}', 0.065, 0.02, (sx * 0.95, 0.5, 2.44), (0, math.pi / 2, 0), mat=M['dark_t']))
    # bustle stowage basket (rails) with canvas load and TEAM band
    TP.append(bx('bustle', (2.1, 0.42, 0.3), (0, -2.22, 2.02), bevel=0.02, seg=1, mat=M['canvas']))
    for (sx_, l) in ((-1.15, 0), (1.15, 0)):
        TP.append(bx(f'brail_s{sx_}', (0.04, 0.5, 0.04), (sx_, -2.25, 2.26), mat=M['dark_t']))
        TP.append(bx(f'brail_v{sx_}', (0.04, 0.04, 0.42), (sx_, -2.48, 2.06), mat=M['dark_t']))
    TP.append(bx('brail_t', (2.34, 0.04, 0.04), (0, -2.48, 2.26), mat=M['dark_t']))
    TP.append(bx('brail_b', (2.34, 0.04, 0.04), (0, -2.48, 1.88), mat=M['dark_t']))
    TP.append(bx('brail_team', (1.0, 0.025, 0.12), (0, -2.5, 2.07), mat=M['team']))
    for k in range(4):
        TP.append(bx(f'brail_m{k}', (0.03, 0.03, 0.38), (-0.75 + k * 0.5, -2.49, 2.07), mat=M['dark_t']))
    # commander's cupola (left, raised, periscopes), loader's hatch (right), gunner's sight (small left optic)
    cx, cy, cz = -0.62, -0.75, 2.39
    TP.append(lathe('cupola', [(0.42, 0.0), (0.42, 0.06), (0.36, 0.09), (0.36, 0.2), (0.32, 0.23), (0.32, 0.26), (0.12, 0.28)],
                    16, 'Z', mats=[M['steel_t']], loc=(cx, cy, cz)))
    for k in range(6):
        a = TAU * k / 6 + 0.3
        TP.append(bx(f'cper{k}', (0.12, 0.06, 0.07), (cx + 0.37 * math.cos(a), cy + 0.37 * math.sin(a), cz + 0.15),
                     rot=(0, 0, a + math.pi / 2), mat=M['glass']))
    TP.append(bx('cup_hinge', (0.12, 0.1, 0.06), (cx, cy - 0.33, cz + 0.27), mat=M['dark_t']))
    TP.append(bx('ld_hatch', (0.62, 0.6, 0.05), (0.6, -0.9, 2.41), bevel=0.015, seg=1, mat=M['steel_t']))
    TP.append(cyl('ld_hinge', 0.035, 0.5, (0.6, -1.22, 2.42), 'X', 8, mat=M['dark_t']))
    TP.append(bx('ld_per', (0.14, 0.08, 0.08), (0.6, -0.5, 2.44), mat=M['glass']))
    TP.append(wedge('gsight', (0.34, 0.44, 0.28), (-0.80, 0.55, 2.52), moves=[('BT', (0, 0.06, 0))], bevel=0.02, seg=1, mat=M['steel_t']))
    TP.append(bx('gsight_win', (0.24, 0.02, 0.13), (-0.80, 0.775, 2.54), mat=M['glass']))
    TP.append(bx('gsight_hood', (0.3, 0.1, 0.03), (-0.80, 0.80, 2.64), mat=M['steel_t']))
    TP.append(cyl('ant2_base', 0.06, 0.08, (1.0, -1.75, 2.44), 'Z', 8, mat=M['dark_t']))
    TP.append(bx('troof_plate', (0.9, 0.7, 0.03), (0.15, 0.25, 2.415), bevel=0.01, seg=1, mat=M['steel_t']))
    for sx in (-1, 1):                                   # raised armour 'brow' plates over the cheeks
        TP.append(prism(f'brow{sx}', [(sx * 0.5, 2.0), (sx * 0.5, 0.95), (sx * 1.22, 0.95)] if sx > 0 else [(sx * 0.5, 2.0), (sx * 1.22, 0.95), (sx * 0.5, 0.95)],
                        2.32, 2.43, mat=M['oxide_t'], bevel=0.012))
    TP.append(bx('troof_rear', (1.6, 0.5, 0.03), (0, -1.55, 2.415), bevel=0.01, seg=1, mat=M['steel_t']))
    TP.append(wedge('cup_sight', (0.22, 0.2, 0.14), (cx, cy + 0.2, cz + 0.33), moves=[('BT', (0, 0.04, 0))], bevel=0.012, seg=1, mat=M['steel_t']))
    TP.append(bx('cup_sight_w', (0.16, 0.02, 0.07), (cx, cy + 0.305, cz + 0.33), mat=M['glass']))
    TP.append(tube('wind_mast', (0.2, -1.75, 2.40), (0.2, -1.75, 2.62), 0.015, verts=6, mat=M['dark_t']))
    TP.append(ball('wind_head', 0.04, (0.2, -1.75, 2.64), seg=8, rings=5, mat=M['dark_t']))
    turret = pivot_mesh('turret', TP, (0, RY, RZ), hull); smooth(turret, 35)

    # ── gun: mantlet (pitch at the trunnions) → recoil barrel → muzzle ──
    GZ = 2.04; TRY = 2.02
    GP = [wedge('mantlet', (0.86, 0.56, 0.6), (0, 2.42, GZ), moves=[('FT', (0, -0.14, -0.05)), ('FD', (0, -0.1, 0.05))], bevel=0.035, seg=1, mat=M['steel_t']),
          cyl('mant_collar', 0.27, 0.08, (0, 2.71, GZ), 'Y', 16, mat=M['dark_t']),
          bx('mant_bolt', (0.6, 0.04, 0.05), (0, 2.6, GZ + 0.22), mat=M['dark_t']),
          cyl('coax', 0.05, 0.12, (0.3, 2.66, GZ - 0.12), 'Y', 8, mat=M['bore'])]
    gun = pivot_mesh('gun', GP, (0, TRY, GZ), turret); smooth(gun, 35)
    prof = [(0.20, 2.55), (0.215, 2.72), (0.215, 3.18), (0.17, 3.24), (0.155, 3.28), (0.15, 3.95), (0.20, 4.04), (0.205, 4.10),
            (0.205, 4.44), (0.19, 4.50), (0.14, 4.58), (0.135, 5.18), (0.158, 5.21), (0.158, 5.38), (0.145, 5.40), (0.08, 5.40), (0.08, 5.15)]
    bar = lathe('barrel', prof, 16, 'Y', mats=[M['barrel'], M['bore']], bands=[0] * 15 + [1], loc=(0, 0, GZ))
    mrs = bx('mrs', (0.08, 0.14, 0.06), (0, 5.05, GZ + 0.165), bevel=0.01, seg=1, mat=M['barrel'])
    recoil = pivot_mesh('recoil', [bar, mrs], (0, 2.62, GZ), gun); smooth(recoil, 35)
    node('muzzle', (0, 5.40, GZ), recoil)

    # ── antenna (sway pivot at its base) ──
    AB = (-1.02, -1.72, 2.40)
    ant = [cyl('ant_base', 0.07, 0.1, (AB[0], AB[1], AB[2] + 0.05), 'Z', 8, mat=M['dark_t']),
           cyl('ant_spring', 0.03, 0.12, (AB[0], AB[1], AB[2] + 0.16), 'Z', 6, mat=M['dark_t']),
           tube('ant_whip', (AB[0], AB[1], AB[2] + 0.2), (AB[0], AB[1], 3.08), 0.012, verts=6, r2=0.006, mat=M['dark_t'])]
    pivot_mesh('antenna', ant, AB, turret)

    # ── sockets ──
    for sx, s in ((-1, 'L'), (1, 'R')):
        node(f'fx_exhaust_{s}', (sx * 1.05, -4.22, 1.38), hull)
        node(f'fx_dust_{s}', (sx * TX, -3.85, 0.12), root)
    node('hit', (0, 0, 1.45), hull)
    node('badge', (0, -0.3, 3.6), root)
    finish_unit(uid, root, dict(turret_ring=[0, RY, RZ], gun_pitch_deg=[-7, 20], recoil_m=0.22, barrel_m=2.7, muzzle_d_m=0.16,
                                track_uv='U = arc length / uv_m; increases rear->front on the ground run'))


# ═════════════════════════════ A03 LANCER MEDIUM TANK ═════════════════════════════
def build_A03():
    reset(); uid = 'A03'; P = PAL['A']
    root = node('root')
    GREY = '#60666C'
    M = dict(
        grey=paint('A_grey', GREY, scale=3, rough=0.55, metal=0.3, grime=0.4, wear=0.22, wear_col='#A9ADB0', mud_top=0.95, mud=0.45),
        navy=paint('A_navy', P['primary'], scale=3, rough=0.55, metal=0.2, grime=0.38, wear=0.25, wear_col='#9AA0A6', mud_top=0.95, mud=0.45),
        grey_t=paint('A_grey_t', GREY, scale=2.5, rough=0.55, metal=0.3, grime=0.38, wear=0.22, wear_col='#A9ADB0'),
        navy_t=paint('A_navy_t', P['primary'], scale=2.5, rough=0.55, metal=0.2, grime=0.35, wear=0.25, wear_col='#9AA0A6'),
        dark=paint('A_dark', P['steel_dark'], scale=1.0, rough=0.5, metal=0.45, grime=0.5, wear=0.2, wear_col='#8A8E92', mud_top=0.95, mud=0.4),
        dark_t=paint('A_dark_t', P['steel_dark'], scale=1.0, rough=0.5, metal=0.45, grime=0.45, wear=0.2, wear_col='#8A8E92'),
        tyre=paint('A_tyre', '#26282A', scale=0.6, rough=0.9, metal=0.0, grime=0.35, wear=0.12, wear_col='#55585B', mud_top=0.3, mud=0.55),
        rim=paint('A_rim', '#5E6368', scale=0.6, rough=0.55, metal=0.35, grime=0.55, wear=0.3, wear_col='#A9ADB0', mud_top=0.3, mud=0.55),
        teeth=gunmetal('A_teeth', '#3C3F42', scale=0.5, wear=0.6),
        barrel=paint('A_barrel', '#55595D', scale=1.5, rough=0.45, metal=0.5, grime=0.35, wear=0.25, wear_col='#A9ADB0', soot=(0, 2.3, 0, 0.45)),
        bore=flat('A_bore', '#0A0A0A', 0.75),
        ivory=paint('A_ivory', P['ivory'], scale=1.0, rough=0.5, metal=0.05, grime=0.25, wear=0.15, noise=0.15),
        red=flat('A_tail', '#8C1C18', 0.35),
        canvas=fabric('A_canvas', '#6B6A4A', scale=0.5, mud_top=None),
        rubber=paint('A_rubber', '#1E1F20', scale=0.5, rough=0.95, metal=0.0, grime=0.3, wear=0.0, mud_top=0.95, mud=0.6),
        amber=glow('amber', '#FFB347', 4.0), glass=glass(), team=team(1.2),
        TRACK_L=track_material('TRACK_L', (0.075, 0.07, 0.062), (0.33, 0.33, 0.32)),
        TRACK_R=track_material('TRACK_R', (0.075, 0.07, 0.062), (0.33, 0.33, 0.32)),
    )
    for sx in (-1, 1):
        M[f'soot{sx}'] = paint(f'A_soot{sx}', GREY, scale=1.5, rough=0.55, metal=0.3, grime=0.4, wear=0.2, wear_col='#A9ADB0',
                               mud_top=0.95, mud=0.45, soot=(sx * 0.72, -3.7, 0.74, 0.35))
    for k in ('grey', 'navy', 'soot-1', 'soot1'): grunge(M[k], streak=0.16, dust=0.32, scale=3.0, dust_col='#9A8E78', streak_col='#3A3832')
    for k in ('grey_t', 'navy_t'): grunge(M[k], streak=0.12, dust=0.25, scale=2.5, dust_col='#9A8E78', streak_col='#3A3832')
    for k in ('dark', 'dark_t', 'barrel'): grunge(M[k], streak=0.1, dust=0.2, scale=1.5, dust_col='#8A8070')

    # ── running gear (six road wheels, narrower track) ──
    TX, TW, T, G = 1.34, 0.60, 0.05, 0.035
    WR = 0.33; WZ = WR + T + G
    GR = dict(tx=TX, tw=TW, t=T, g=G, wr=WR, ww=0.46, wz=WZ, wheel_ys=[2.02 - 0.83 * i for i in range(6)],
              spr=(-3.0, 0.62, 0.265), idl=(2.93, 0.62, 0.255), rollers=[(-1.7, 0.81, 0.075), (0.05, 0.81, 0.075), (1.65, 0.81, 0.075)],
              pitch=0.21, teeth=11, wseg=14)
    HP = running_gear(root, GR, M)

    # ── hull: low, long sloped glacis ──
    HP.append(loft('hull_up', [
        (-3.66, sec6(1.62, 1.0, 1.63, 1.20, 1.42, 1.36)),
        (-3.55, sec6(1.66, 1.0, 1.66, 1.25, 1.46, 1.40)),
        (1.45, sec6(1.66, 1.0, 1.66, 1.25, 1.46, 1.40)),
        (3.58, sec6(1.66, 1.0, 1.66, 1.03, 1.50, 1.07)),
        (3.70, sec6(1.60, 1.0, 1.60, 1.01, 1.44, 1.04))], mat=M['grey']))
    bev(HP[-1], 0.02, 1, 30)
    HP.append(side_prism('hull_lo', [(-3.50, 1.02), (-3.60, 0.70), (-3.20, 0.42), (2.95, 0.42), (3.68, 1.02)], 1.94, mat=M['grey'], bevel=0.018, seg=1))
    th = math.atan2(0.33, 2.13); gl = lambda y: 1.40 - (y - 1.45) * math.tan(th)
    for k, (x, w) in enumerate(((-0.72, 0.62), (0.0, 0.76), (0.72, 0.62))):
        HP.append(on_slope(f'glacis_plate{k}', (w, 1.4, 0.04), x, 2.55, gl, th, M['grey'], bevel=0.015))
    HP.append(on_slope('drv_hatch', (0.46, 0.46, 0.04), 0.55, 2.1, gl, th, M['grey'], bevel=0.012))
    for k in range(3):
        HP.append(on_slope(f'drv_per{k}', (0.12, 0.06, 0.06), 0.38 + k * 0.17, 1.82, gl, th, M['glass'], bevel=0.0))
    for sx in (-1, 1):
        # navy front track-guard corners with recessed amber headlights
        HP.append(wedge(f'fguard{sx}', (0.56, 0.8, 0.36), (sx * 1.40, 3.32, 1.17), moves=[('FT', (0, -0.3, -0.02)), ('FD', (0, -0.05, 0))],
                        bevel=0.02, seg=1, mat=M['navy']))
        HP.append(bx(f'hl_box{sx}', (0.34, 0.18, 0.15), (sx * 0.88, 3.40, gl(3.4) + 0.05), bevel=0.012, seg=1, mat=M['dark']))
        HP.append(bx(f'hl_lens{sx}', (0.24, 0.02, 0.07), (sx * 0.88, 3.49, gl(3.4) + 0.06), mat=M['amber']))
        HP.append(bx(f'hl_hood{sx}', (0.36, 0.12, 0.025), (sx * 0.88, 3.46, gl(3.4) + 0.13), mat=M['dark']))
        HP.append(bx(f'fflap{sx}', (0.52, 0.02, 0.2), (sx * 1.40, 3.69, 0.9), mat=M['rubber']))
        # rear corners: navy, tail lights, small round exhausts low on the rear plate
        HP.append(bx(f'rcorner{sx}', (0.42, 0.22, 0.36), (sx * 1.44, -3.58, 1.18), bevel=0.018, seg=1, mat=M['navy']))
        HP.append(bx(f'tail{sx}', (0.28, 0.05, 0.12), (sx * 1.3, -3.68, 1.22), mat=M['red']))
        HP.append(bx(f'tailf{sx}', (0.34, 0.04, 0.17), (sx * 1.3, -3.66, 1.22), mat=M['dark']))
        HP.append(lathe(f'exo{sx}', [(0.11, -3.52), (0.11, -3.66), (0.075, -3.66), (0.075, -3.56)], 12, 'Y',
                        mats=[M[f'soot{sx}'], M['bore']], bands=[0, 0, 1], loc=(sx * 0.72, 0, 0.74)))
        HP.append(bx(f'rflap{sx}', (0.52, 0.02, 0.2), (sx * 1.40, -3.62, 0.9), mat=M['rubber']))
        # thin side skirts: six panels, navy rear pair + front panel
        n = 6; y0, y1 = 3.10, -3.58; pp = (y0 - y1) / n
        for i in range(n):
            yc = y0 - pp * (i + 0.5); mv = []
            if i == 0: mv = [('FD', (0, -0.3, 0.2))]
            if i == n - 1: mv = [('BD', (0, 0.2, 0.15))]
            HP.append(wedge(f'skirt{sx}{i}', (0.035, pp - 0.03, 0.52), (sx * 1.682, yc, 1.04), moves=mv, bevel=0.008, seg=1,
                            mat=M['navy'] if i in (0, 4, 5) else M['grey']))
        HP.append(bx(f'toolbox{sx}', (0.42, 0.8, 0.16), (sx * 1.30, -2.75, 1.48), bevel=0.015, seg=1, mat=M['grey']))
        HP.append(bx(f'rteam{sx}', (0.30, 0.34, 0.012), (sx * 1.40, -3.40, 1.405), mat=M['team']))
    # rear plate: wide horizontal cooling grille, central tow hook
    HP.append(grille('rgrille', 1.9, 0.36, 8, depth=0.05, loc=(0, -3.68, 1.17), rot=(0, 0, math.pi), mat=M['dark']))
    HP.append(bx('rhook_m', (0.22, 0.12, 0.14), (0, -3.6, 0.72), bevel=0.015, seg=1, mat=M['dark']))
    HP.append(torus('rhook', 0.08, 0.024, (0, -3.66, 0.63), (0, math.pi / 2, 0), seg=8, arc=0.62, mat=M['dark']))
    for sx in (-1, 1):
        HP.append(bx(f'fhook_m{sx}', (0.14, 0.1, 0.12), (sx * 0.55, 3.49, 0.85), bevel=0.012, seg=1, mat=M['dark']))
        HP.append(torus(f'fhook{sx}', 0.075, 0.022, (sx * 0.55, 3.57, 0.77), (0, math.pi / 2, 0), seg=8, arc=0.62, mat=M['dark']))
    HP.append(grille('dgrille', 2.2, 0.85, 10, depth=0.035, loc=(0, -3.05, 1.405), rot=(math.pi / 2, 0, 0), mat=M['dark']))
    for sx in (-1, 1):
        HP.append(bx(f'skrail{sx}', (0.03, 6.6, 0.04), (sx * 1.69, -0.24, 1.31), mat=M['dark']))
        HP.append(bx(f'sdeck_f{sx}', (0.4, 1.4, 0.02), (sx * 1.22, 1.1, 1.405), bevel=0.006, seg=1, mat=M['grey']))
        HP.append(torus(f'feye{sx}', 0.06, 0.018, (sx * 1.0, 2.6, gl(2.6) + 0.06), (0, math.pi / 2, 0), mat=M['dark']))
        HP.append(torus(f'reye{sx}', 0.06, 0.018, (sx * 1.45, -3.3, 1.46), (0, math.pi / 2, 0), mat=M['dark']))
        HP.append(bx(f'rdeckbox{sx}', (0.3, 0.5, 0.14), (sx * 0.85, -2.3, 1.47), bevel=0.012, seg=1, mat=M['grey']))
    hull = join('hull', HP); smooth(hull, 35); attach(hull, root)

    # ── turret: compact angular hexagon ──
    RY, RZ = 0.0, 1.40
    TP = [cyl('tring', 1.0, 0.1, (0, RY, 1.43), 'Z', 20, mat=M['dark_t'])]
    sh = loft('tshell', [
        (-1.42, sec6(0.98, 1.46, 1.0, 1.74, 0.82, 1.97)),
        (-0.95, sec6(1.17, 1.46, 1.19, 1.74, 0.98, 2.0)),
        (0.62, sec6(1.17, 1.46, 1.19, 1.74, 0.98, 2.0)),
        (1.90, sec6(0.34, 1.46, 0.36, 1.72, 0.29, 1.92))], mat=M['grey_t'])
    set_faces_mat(sh, M['navy_t'], lambda c, nn: c.y > 0.66 and abs(nn.x) > 0.25 and nn.z < 0.6)
    bev(sh, 0.025, 1, 30); TP.append(sh)
    TP.append(bx('bustle', (1.6, 0.42, 0.36), (0, -1.6, 1.72), bevel=0.02, seg=1, mat=M['grey_t']))
    TP.append(bx('bustle_team', (1.64, 0.3, 0.06), (0, -1.6, 1.86), mat=M['team']))
    for k in range(4):                                       # stowage rack rails on the bustle
        TP.append(bx(f'brack{k}', (0.03, 0.03, 0.2), (-0.72 + k * 0.48, -1.83, 1.98), mat=M['dark_t']))
    TP.append(bx('brack_t', (1.5, 0.03, 0.03), (0, -1.83, 2.08), mat=M['dark_t']))
    # white chevron on the left front cheek (as on the art's front view)
    ang = math.atan2(0.544, -0.839); nx, ny = math.cos(ang), math.sin(ang); tx, ty = -ny, nx
    c = (-0.765 + nx * 0.012, 1.26 + ny * 0.012, 1.62)
    for k in (-1, 1):
        TP.append(bx(f'cheekv{k}', (0.008, 0.045, 0.2), (c[0] + tx * k * 0.045, c[1] + ty * k * 0.045, c[2]), rot=(-k * 0.5, 0, ang), mat=M['ivory']))
    for sx, face in ((-1, '-X'), (1, '+X')):
        TP.append(bx(f'tside{sx}', (0.04, 1.15, 0.28), (sx * 1.195, 0.12, 1.6), bevel=0.01, seg=1, mat=M['navy_t']))
        TP.append(mark(f'tmark{sx}', 'A03', 0.23, (sx * 1.218, 0.3 if sx > 0 else -0.06, 1.6), face, M['ivory']))
        # chevron "V" badge ahead of / behind the hull number (reads V A03 from either side)
        vy = -0.22 if sx > 0 else 0.46
        for k in (-1, 1):
            TP.append(bx(f'tv{sx}{k}', (0.008, 0.04, 0.17), (sx * 1.218, vy + k * 0.04, 1.6), rot=(-k * 0.5, 0, 0), mat=M['ivory']))
        # canvas bedroll on the turret flank, straps
        TP.append(cyl(f'roll{sx}', 0.16, 0.95, (sx * 1.22, -0.95, 1.66), 'Y', 10, mat=M['canvas']))
        for k in (-1, 1):
            TP.append(cyl(f'strap{sx}{k}', 0.17, 0.05, (sx * 1.22, -0.95 + k * 0.3, 1.66), 'Y', 10, mat=M['dark_t']))
        # smoke dischargers (3) on the front cheeks
        TP.append(bx(f'smkb{sx}', (0.1, 0.42, 0.07), (sx * 1.05, 0.05, 1.93), mat=M['dark_t']))
        for k in range(3):
            a = (sx * 1.07, -0.08 + k * 0.13, 1.95); b = (a[0] + sx * 0.1, a[1] + 0.1, a[2] + 0.07)
            TP.append(tube(f'smk{sx}{k}', a, b, 0.04, verts=8, mat=M['dark_t']))
        TP.append(torus(f'teye{sx}', 0.055, 0.017, (sx * 0.7, 0.9, 1.99), (0, math.pi / 2, 0), mat=M['dark_t']))
    # commander's sight with amber lenses (left), cupola, loader hatch, gunner's sight (right)
    TP.append(wedge('csight', (0.42, 0.34, 0.2), (-0.42, 0.42, 2.09), moves=[('FT', (0, -0.05, 0))], bevel=0.015, seg=1, mat=M['grey_t']))
    for k in (-1, 1):
        TP.append(bx(f'csl{k}', (0.12, 0.02, 0.08), (-0.42 + k * 0.1, 0.596, 2.09), mat=M['amber']))
    TP.append(lathe('cupola', [(0.3, 0.0), (0.3, 0.1), (0.26, 0.12), (0.26, 0.15), (0.1, 0.16)], 14, 'Z', mats=[M['grey_t']], loc=(-0.45, -0.4, 1.99)))
    for k in range(5):
        a = TAU * k / 5 + 0.4
        TP.append(bx(f'cper{k}', (0.09, 0.05, 0.05), (-0.45 + 0.29 * math.cos(a), -0.4 + 0.29 * math.sin(a), 2.06), rot=(0, 0, a + math.pi / 2), mat=M['glass']))
    TP.append(bx('ld_hatch', (0.48, 0.48, 0.04), (0.48, -0.45, 2.01), bevel=0.012, seg=1, mat=M['grey_t']))
    TP.append(wedge('gsight', (0.24, 0.3, 0.16), (0.56, 0.7, 2.07), bevel=0.012, seg=1, mat=M['grey_t']))
    TP.append(bx('gsight_win', (0.18, 0.02, 0.08), (0.56, 0.855, 2.07), mat=M['glass']))
    TP.append(bx('troof_plate', (0.7, 0.55, 0.025), (0.1, 0.2, 2.005), bevel=0.008, seg=1, mat=M['grey_t']))
    turret = pivot_mesh('turret', TP, (0, RY, RZ), hull); smooth(turret, 35)

    # ── gun ──
    GZ = 1.72; TRY = 1.75
    GP = [wedge('mantlet', (0.56, 0.5, 0.42), (0, 2.05, GZ), moves=[('FT', (0, -0.1, -0.03)), ('FD', (0, -0.08, 0.03))], bevel=0.025, seg=1, mat=M['grey_t']),
          cyl('mant_collar', 0.15, 0.06, (0, 2.31, GZ), 'Y', 14, mat=M['dark_t'])]
    gun = pivot_mesh('gun', GP, (0, TRY, GZ), turret); smooth(gun, 35)
    prof = [(0.12, 2.15), (0.12, 2.62), (0.095, 2.67), (0.085, 2.71), (0.083, 3.30), (0.115, 3.36), (0.118, 3.40), (0.118, 3.64),
            (0.115, 3.68), (0.082, 3.74), (0.079, 4.34), (0.097, 4.36), (0.097, 4.58), (0.09, 4.60), (0.06, 4.60), (0.06, 4.44)]
    bar = lathe('barrel', prof, 14, 'Y', mats=[M['barrel'], M['bore']], bands=[0] * 14 + [1], loc=(0, 0, GZ))
    recoil = pivot_mesh('recoil', [bar], (0, 2.2, GZ), gun); smooth(recoil, 35)
    node('muzzle', (0, 4.60, GZ), recoil)

    # ── one short antenna ──
    AB = (-0.78, -1.15, 1.99)
    ant = [cyl('ant_base', 0.05, 0.07, (AB[0], AB[1], AB[2] + 0.035), 'Z', 8, mat=M['dark_t']),
           tube('ant_whip', (AB[0], AB[1], AB[2] + 0.06), (AB[0], AB[1], 2.63), 0.011, verts=6, r2=0.005, mat=M['dark_t'])]
    pivot_mesh('antenna', ant, AB, turret)

    for sx, s in ((-1, 'L'), (1, 'R')):
        node(f'fx_exhaust_{s}', (sx * 0.72, -3.68, 0.74), hull)
        node(f'fx_dust_{s}', (sx * TX, -3.3, 0.1), root)
    node('hit', (0, 0, 1.25), hull)
    node('badge', (0, 0, 3.1), root)
    finish_unit(uid, root, dict(turret_ring=[0, RY, RZ], gun_pitch_deg=[-8, 22], recoil_m=0.16, barrel_m=2.3, muzzle_d_m=0.12,
                                track_uv='U = arc length / uv_m; increases rear->front on the ground run'))


# ═════════════════════════════ T03 WISP HOVER TANK ═════════════════════════════
def pod_sec(xi, xo, zb, zt, ci=0.34, co=0.22, cz=0.30):
    """Right-pod cross-section (x, z): bottom inner/outer, outer low/high, top outer/inner, inner chamfer (tucked under
    the hull's deck wing), inner low. xi = inner face x, xo = outer face x."""
    h = zt - zb
    return [(xi + 0.09, zb), (xo - 0.18, zb), (xo, zb + 0.25 * h), (xo, zb + 0.66 * h), (xo - co, zt), (xi + ci, zt), (xi, zt - cz), (xi, zb + 0.22 * h)]


def pod_sections(sx):
    secs = [(-3.70, pod_sec(0.70, 1.68, 0.64, 1.42, 0.28, 0.20)), (-3.40, pod_sec(0.66, 1.80, 0.55, 1.52)), (2.45, pod_sec(0.66, 1.80, 0.55, 1.52)),
            (3.25, pod_sec(0.66, 1.46, 0.58, 1.34, 0.30, 0.20)), (3.70, pod_sec(0.70, 1.18, 0.66, 1.08, 0.18, 0.12, 0.2))]
    if sx < 0: secs = [(y, [(-x, z) for x, z in reversed(pts)]) for y, pts in secs]
    return secs


def hsec10(hb, zb, hm, zm, hw, zw, zw2, ht, zt):
    """Hover hull section: narrow lower body, deck wings that overhang the pods' inner edges, chamfered deck."""
    r = [(hb, zb), (hm, zm), (hw, zw), (hw, zw2), (ht, zt)]
    return r + [(-x, z) for x, z in reversed(r)]


def build_T03():
    reset(); uid = 'T03'; P = PAL['T']
    root = node('root')
    PZ = 0.45                                   # lowest mesh point (hover clearance)
    GRAPH, SILV = P['primary'], '#959CA0'
    M = dict(
        graph=paint('T_graph', GRAPH, scale=2.5, rough=0.5, metal=0.12, grime=0.35, wear=0.3, wear_col='#B4BABD', mud_top=0.95, mud=0.3),
        silver=paint('T_silver', SILV, scale=2.5, rough=0.42, metal=0.22, grime=0.35, wear=0.25, wear_col='#E2E6E8', mud_top=0.95, mud=0.25),
        graph_p=paint('T_graph_p', GRAPH, scale=2.5, rough=0.5, metal=0.12, grime=0.35, wear=0.4, wear_col='#B4BABD', mud_top=0.42, mud=0.3),
        silver_p=paint('T_silver_p', SILV, scale=2.5, rough=0.42, metal=0.22, grime=0.35, wear=0.35, wear_col='#E2E6E8', mud_top=0.42, mud=0.25),
        graph_t=paint('T_graph_t', GRAPH, scale=2.0, rough=0.5, metal=0.12, grime=0.3, wear=0.3, wear_col='#B4BABD'),
        silver_t=paint('T_silver_t', SILV, scale=2.0, rough=0.42, metal=0.22, grime=0.3, wear=0.25, wear_col='#E2E6E8'),
        dark=paint('T_dark', '#1C1F22', scale=1.0, rough=0.5, metal=0.3, grime=0.4, wear=0.15, wear_col='#5C6266'),
        dark_p=paint('T_dark_p', '#1C1F22', scale=1.0, rough=0.5, metal=0.3, grime=0.4, wear=0.15, wear_col='#5C6266', mud_top=0.42, mud=0.3),
        emitter=paint('T_emit', '#2A2D30', scale=0.5, rough=0.45, metal=0.5, grime=0.3, wear=0.1, soot=(0, 0.66, 0, 0.3)),
        mark=paint('T_mark', P['ivory'], scale=1.0, rough=0.45, metal=0.1, grime=0.2, wear=0.1, noise=0.1),
        amber=flat('T_amber', '#E39A2E', 0.25),
        cyan=glow('cyan', P['glow'], 6.0), hover=glow('hover', P['glow'], 0.8), charge=glow('charge', '#8FF3FF', 4.0),
        glass=glass(), team=team(1.2),
    )
    for k in ('graph', 'silver', 'graph_p', 'silver_p'): grunge(M[k], streak=0.08, dust=0.18, scale=2.5, dust_col='#8E8778', streak_col='#2A2C2E')
    for k in ('graph_t', 'silver_t'): grunge(M[k], streak=0.06, dust=0.12, scale=2.0, dust_col='#8E8778', streak_col='#2A2C2E')

    # ── hull: narrow lower body, wide deck wings over the pods' inner edges, tapered nose and tail ──
    HP = [loft('hull_body', [
        (-3.62, hsec10(0.44, 0.70, 0.50, 1.20, 0.90, 1.50, 1.55, 0.80, 1.60)),
        (-3.35, hsec10(0.48, 0.62, 0.52, 1.20, 0.98, 1.58, 1.62, 0.86, 1.68)),
        (2.00, hsec10(0.48, 0.62, 0.52, 1.20, 0.98, 1.58, 1.62, 0.86, 1.68)),
        (3.15, hsec10(0.46, 0.66, 0.50, 1.18, 0.80, 1.42, 1.46, 0.68, 1.52)),
        (3.62, hsec10(0.42, 0.72, 0.46, 1.16, 0.60, 1.28, 1.32, 0.50, 1.36))], mat=M['graph'])]
    set_faces_mat(HP[0], M['silver'], lambda c, nn: nn.z > 0.6)
    bev(HP[0], 0.025, 1, 30)
    for sx in (-1, 1):                          # dark pylons inside the pod gaps, under-wing structure
        for y in (-2.2, 0.0, 2.0):
            HP.append(bx(f'pylon{sx}{y}', (0.22, 0.5, 0.32), (sx * 0.6, y, 0.95), bevel=0.02, seg=1, mat=M['dark']))
        HP.append(bx(f'wingrib{sx}', (0.36, 5.2, 0.06), (sx * 0.74, -0.6, 1.33), rot=(0, sx * -0.7, 0), mat=M['dark']))
    HP.append(bx('keel', (0.8, 5.6, 0.1), (0, -0.2, 0.62), bevel=0.02, seg=1, mat=M['dark']))
    # nose: recessed field emitter lens (static; the weapon is on the turret per the rig contract)
    HP.append(bx('nose_frame', (0.82, 0.12, 0.46), (0, 3.62, 0.95), bevel=0.03, seg=1, mat=M['dark']))
    HP.append(lathe('nose_lens', [(0.17, 3.62), (0.17, 3.68), (0.13, 3.70), (0.10, 3.67)], 16, 'Y', mats=[M['silver'], M['emitter']], bands=[0, 0, 1], loc=(0, 0, 0.95)))
    HP.append(lathe('nose_ring', [(0.145, 3.695), (0.145, 3.705), (0.125, 3.705), (0.125, 3.695)], 16, 'Y', mats=[M['cyan']], loc=(0, 0, 0.95), cap0=False, cap1=False))
    for sx in (-1, 1):
        HP.append(bx(f'nose_cheek{sx}', (0.14, 0.4, 0.5), (sx * 0.33, 3.5, 0.95), bevel=0.02, seg=1, mat=M['silver']))
    # deck details: hatch, vents with cyan strips, panels, rear grille
    HP.append(bx('deck_hatch', (0.7, 0.55, 0.04), (0, 2.45, 1.64), rot=(-0.14, 0, 0), bevel=0.012, seg=1, mat=M['silver']))
    HP.append(bx('deck_hatch2', (0.38, 0.32, 0.05), (0, 2.55, 1.66), rot=(-0.14, 0, 0), bevel=0.01, seg=1, mat=M['dark']))
    for sx in (-1, 1):
        HP.append(bx(f'deck_vent{sx}', (0.36, 0.7, 0.04), (sx * 0.45, -2.5, 1.685), bevel=0.01, seg=1, mat=M['dark']))
        for k in range(4):
            HP.append(bx(f'dv{sx}{k}', (0.3, 0.035, 0.02), (sx * 0.45, -2.75 + k * 0.16, 1.705), mat=M['silver']))
        HP.append(bx(f'deck_strip{sx}', (0.02, 1.6, 0.012), (sx * 0.8, -2.3, 1.69), mat=M['cyan']))
        HP.append(bx(f'deck_panel{sx}', (0.34, 1.1, 0.02), (sx * 0.62, 1.35, 1.69), bevel=0.006, seg=1, mat=M['graph']))
        HP.append(tube(f'drail{sx}a', (sx * 0.62, -1.5, 1.68), (sx * 0.62, -1.5, 1.76), 0.022, verts=6, mat=M['dark']))
        HP.append(tube(f'drail{sx}b', (sx * 0.62, -2.0, 1.68), (sx * 0.62, -2.0, 1.76), 0.022, verts=6, mat=M['dark']))
        HP.append(tube(f'drail{sx}c', (sx * 0.62, -2.0, 1.76), (sx * 0.62, -1.5, 1.76), 0.022, verts=6, mat=M['dark']))
    HP.append(bx('rear_frame', (0.86, 0.08, 0.5), (0, -3.64, 1.0), bevel=0.02, seg=1, mat=M['dark']))
    for k in range(6):
        HP.append(bx(f'rgr{k}', (0.05, 0.05, 0.4), (-0.3 + k * 0.12, -3.68, 1.0), mat=M['silver']))
    hull = join('hull', HP); smooth(hull, 35); attach(hull, root)

    # ── hover pods (separate meshes, own float offset), origin at the pod's ground-clearance point ──
    pods = {}
    for sx, s in ((-1, 'L'), (1, 'R')):
        pp = loft(f'pod_{s}_shell', pod_sections(sx), mat=M['graph_p'])
        set_faces_mat(pp, M['silver_p'], lambda c, nn: nn.z > 0.4 or (nn.y > 0.45 and nn.z > 0.15))
        bev(pp, 0.03, 2, 30); PP = [pp]
        xo = sx * 1.21
        # front: recessed dark band with cyan light strip; intake slats under the nose
        PP.append(bx(f'pfr{s}', (0.42, 0.03, 0.14), (sx * 0.94, 3.705, 0.79), mat=M['dark_p']))
        PP.append(bx(f'pfs{s}', (0.34, 0.03, 0.045), (sx * 0.94, 3.715, 0.77), mat=M['cyan']))
        for k in range(5):
            PP.append(bx(f'pfg{s}{k}', (0.05, 0.3, 0.05), (sx * (0.86 + k * 0.12), 3.1, 0.565), mat=M['dark_p']))
        # outer side: crease band, TEAM stripe, unit marking + logo, access panel, cyan side strip
        PP.append(bx(f'pband{s}', (0.03, 5.6, 0.05), (sx * 1.8, -0.55, 1.19), mat=M['dark_p']))
        PP.append(bx(f'pteam{s}', (0.02, 0.2, 0.36), (sx * 1.801, -0.25, 1.0), mat=M['team']))
        PP.append(mark(f'pmark{s}', 'T03', 0.36, (sx * 1.808, 1.1 if sx > 0 else 0.5, 1.0), '+X' if sx > 0 else '-X', M['mark']))
        lg = 0.4 if sx > 0 else 1.25           # Nova delta emblem: light triangle with a dark inset
        PP.append(side_prism(f'plogo{s}', [(lg - 0.13, 0.9), (lg + 0.13, 0.9), (lg, 1.13)], 0.012, mat=M['mark']))
        PP[-1].location.x = sx * 1.806
        PP.append(side_prism(f'plogi{s}', [(lg - 0.05, 0.93), (lg + 0.05, 0.93), (lg, 1.02)], 0.012, mat=M['dark_p']))
        PP[-1].location.x = sx * 1.811
        for k, y in enumerate((-3.0, -1.5, 0.9, 1.75)):  # vertical panel seams
            PP.append(bx(f'pseam{s}{k}', (0.012, 0.025, 0.36), (sx * 1.803, y, 1.0), mat=M['dark_p']))
        PP.append(bx(f'ppanel2{s}', (0.025, 0.7, 0.26), (sx * 1.8, 2.6, 1.02), bevel=0.008, seg=1, mat=M['silver_p']))
        PP.append(bx(f'ppanel{s}', (0.025, 0.9, 0.3), (sx * 1.8, -2.1, 1.0), bevel=0.008, seg=1, mat=M['silver_p']))
        PP.append(bx(f'pside{s}', (0.02, 0.6, 0.035), (sx * 1.8, 2.1, 0.86), mat=M['cyan']))
        # top: handrail, raised access hatch, small panel
        for (ya, yb) in ((-1.4, 0.0),):
            PP.append(tube(f'prail{s}a', (sx * 1.36, ya, 1.52), (sx * 1.36, ya, 1.62), 0.022, verts=6, mat=M['dark_p']))
            PP.append(tube(f'prail{s}b', (sx * 1.36, yb, 1.52), (sx * 1.36, yb, 1.62), 0.022, verts=6, mat=M['dark_p']))
            PP.append(tube(f'prail{s}c', (sx * 1.36, ya, 1.62), (sx * 1.36, yb, 1.62), 0.022, verts=6, mat=M['dark_p']))
        PP.append(bx(f'phatch{s}', (0.42, 0.7, 0.035), (sx * 1.28, 1.3, 1.535), bevel=0.012, seg=1, mat=M['silver_p']))
        PP.append(bx(f'pplate{s}', (0.4, 0.9, 0.02), (sx * 1.3, -2.4, 1.53), bevel=0.006, seg=1, mat=M['graph_p']))
        PP.append(bx(f'ptopvent{s}', (0.34, 0.5, 0.06), (sx * 1.3, -3.15, 1.54), bevel=0.012, seg=1, mat=M['dark_p']))
        for k in range(4):
            PP.append(bx(f'ptv{s}{k}', (0.28, 0.03, 0.02), (sx * 1.3, -3.33 + k * 0.12, 1.575), mat=M['silver_p']))
        for k, y in enumerate((0.5, 2.1)):                 # grab handles on the pod top edge
            PP.append(torus(f'phandle{s}{k}', 0.09, 0.018, (sx * 1.5, y, 1.52), (-math.pi / 2, 0, math.pi / 2), seg=8, arc=0.5, mat=M['dark_p']))
        PP.append(wedge(f'pnose{s}', (0.3, 0.5, 0.1), (sx * 1.0, 2.75, 1.5), moves=[('FT', (0, -0.15, -0.05))], bevel=0.015, seg=1, mat=M['silver_p']))
        PP.append(bx(f'pnose_s{s}', (0.16, 0.02, 0.03), (sx * 1.0, 2.98, 1.49), rot=(0.4, 0, 0), mat=M['cyan']))
        # rear thrust vent: dark recess with cyan slats
        PP.append(bx(f'pvent{s}', (0.62, 0.1, 0.46), (xo, -3.70, 1.02), bevel=0.02, seg=1, mat=M['dark_p']))
        for k in range(4):
            PP.append(bx(f'pvs{s}{k}', (0.52, 0.03, 0.035), (xo, -3.755, 0.87 + k * 0.1), mat=M['cyan']))
        # underside: two anti-grav modules (lowest point z = 0.45), subtle glow, cabling
        for k, y in enumerate((1.9, -1.9)):
            PP.append(lathe(f'grav{s}{k}', [(0.40, 0.58), (0.42, 0.54), (0.38, 0.52), (0.36, 0.50), (0.30, 0.49), (0.27, 0.45), (0.2, 0.45)], 16, 'Z',
                            mats=[M['dark_p']], loc=(xo, y, 0)))
            PP.append(lathe(f'gglow{s}{k}', [(0.19, 0.452), (0.1, 0.452)], 16, 'Z', mats=[M['hover']], loc=(xo, y, 0)))
            PP.append(lathe(f'gring{s}{k}', [(0.46, 0.60), (0.46, 0.63), (0.43, 0.65), (0.40, 0.65)], 16, 'Z', mats=[M['dark_p']], loc=(xo, y, 0), cap0=False))
            PP.append(tube(f'gcab{s}{k}a', (xo - sx * 0.32, y + 0.35, 0.58), (xo - sx * 0.12, y + 0.55, 0.53), 0.035, verts=6, mat=M['dark_p']))
            PP.append(tube(f'gcab{s}{k}b', (xo + sx * 0.28, y - 0.35, 0.58), (xo + sx * 0.1, y - 0.55, 0.53), 0.03, verts=6, mat=M['dark_p']))
        pod = pivot_mesh(f'pod_{s}', PP, (xo, 0.0, PZ), hull); smooth(pod, 35); pods[s] = pod

    # ── turret: circular collar + faceted upper drum ──
    RY, RZ = -0.1, 1.68
    TP = [lathe('collar', [(1.0, 1.64), (1.06, 1.70), (1.06, 1.88), (1.0, 1.94), (0.86, 1.96)], 32, 'Z', mats=[M['graph_t']]),
          lathe('collar_lip', [(1.08, 1.74), (1.08, 1.82), (1.065, 1.82), (1.065, 1.74)], 32, 'Z', mats=[M['dark']], cap0=False, cap1=False)]
    for o in TP: o.location.y = RY
    for k in range(8):
        a = TAU * (k + 0.5) / 8
        if abs(math.sin(a) - 1) < 0.2: continue      # front left free for the gun housing
        TP.append(bx(f'cstrip{k}', (0.3, 0.02, 0.035), (1.083 * math.cos(a), RY + 1.083 * math.sin(a), 1.78), rot=(0, 0, a + math.pi / 2), mat=M['cyan']))
    for k in range(8):                                # armour blocks on the collar between the cyan strips
        a = TAU * k / 8
        if abs(math.sin(a) - 1) < 0.2: continue
        TP.append(bx(f'cblock{k}', (0.22, 0.12, 0.2), (1.06 * math.cos(a), RY + 1.06 * math.sin(a), 1.79), rot=(0, 0, a + math.pi / 2), bevel=0.015, seg=1, mat=M['silver_t']))
    oct_ = [(0.78 * math.cos(TAU * (i + 0.5) / 10), RY - 0.05 + 0.78 * math.sin(TAU * (i + 0.5) / 10)) for i in range(10)]
    TP.append(prism('tblock', oct_, 1.92, 2.15, top=lambda x, y: (x * 0.88, RY - 0.05 + (y - RY + 0.05) * 0.88), mat=M['silver_t'], bevel=0.02))
    for k in (2, 4, 6, 8):                           # thin cyan strips on the drum flanks
        a = TAU * (k + 0.5) / 10
        TP.append(bx(f'dstrip{k}', (0.22, 0.015, 0.025), (0.79 * math.cos(a) * 0.97, RY - 0.05 + 0.79 * math.sin(a) * 0.97, 2.02), rot=(0, 0, a + math.pi / 2), mat=M['cyan']))
    TP.append(bx('t_hatch', (0.42, 0.42, 0.04), (0.25, RY - 0.25, 2.165), bevel=0.01, seg=1, mat=M['graph_t']))
    TP.append(bx('t_panel', (0.3, 0.5, 0.03), (-0.3, RY - 0.1, 2.16), bevel=0.008, seg=1, mat=M['dark']))
    TP.append(bx('t_optic', (0.36, 0.2, 0.16), (-0.42, RY + 0.66, 2.05), bevel=0.015, seg=1, mat=M['graph_t']))
    TP.append(bx('t_optic_lens', (0.26, 0.02, 0.09), (-0.42, RY + 0.765, 2.05), mat=M['amber']))
    TP.append(bx('t_team', (0.5, 0.18, 0.012), (0, RY - 0.62, 2.15), mat=M['team']))
    TP.append(bx('t_sensor', (0.2, 0.16, 0.1), (0.42, RY + 0.66, 2.04), bevel=0.012, seg=1, mat=M['graph_t']))
    TP.append(bx('t_sensor_w', (0.14, 0.02, 0.06), (0.42, RY + 0.745, 2.04), mat=M['glass']))
    TP.append(cyl('ant_mount', 0.05, 0.06, (0.5, RY - 0.5, 2.18), 'Z', 8, mat=M['dark']))
    TP.append(tube('ant_whip', (0.5, RY - 0.5, 2.2), (0.5, RY - 0.5, 2.42), 0.012, verts=6, r2=0.006, mat=M['dark']))
    turret = pivot_mesh('turret', TP, (0, RY, RZ), hull); smooth(turret, 35)

    # ── gun: short recessed accelerator in an armoured housing, two charge fins ──
    GZ = 1.90; TRY = 0.80
    GP = [wedge('g_house', (0.44, 0.62, 0.34), (0, 1.08, GZ), moves=[('FT', (0, -0.06, 0))], bevel=0.02, seg=1, mat=M['silver_t']),
          lathe('g_barrel', [(0.12, 0.9), (0.12, 1.36), (0.135, 1.38), (0.135, 1.44), (0.085, 1.44), (0.085, 1.30)], 16, 'Y',
                mats=[M['emitter'], M['dark']], bands=[0, 0, 0, 0, 1], loc=(0, 0, GZ)),
          lathe('g_charge', [(0.08, 1.31), (0.08, 1.33), (0.04, 1.33), (0.04, 1.31)], 16, 'Y', mats=[M['charge']], loc=(0, 0, GZ))]
    gun = pivot_mesh('gun', GP, (0, TRY, GZ), turret); smooth(gun, 35)
    for sx, s in ((-1, 'L'), (1, 'R')):
        fin = [wedge(f'fin{s}', (0.07, 0.6, 0.38), (sx * 0.27, 1.12, GZ), moves=[('FT', (0, -0.08, -0.04)), ('FD', (0, -0.08, 0.04))], bevel=0.012, seg=1, mat=M['silver_t']),
               bx(f'finc{s}', (0.012, 0.42, 0.03), (sx * 0.307, 1.12, GZ + 0.06), mat=M['cyan']),
               bx(f'finr{s}', (0.03, 0.3, 0.05), (sx * 0.235, 1.0, GZ - 0.12), mat=M['dark'])]
        pivot_mesh(f'fin_{s}', fin, (sx * 0.27, 1.12, GZ), gun)
    node('muzzle', (0, 1.44, GZ), gun)

    # ── sockets ──
    for k, (s, y) in enumerate((('L', 1.9), ('L', -1.9), ('R', 1.9), ('R', -1.9))):
        sx = -1 if s == 'L' else 1
        node(f'fx_thrust_{k}', (sx * 1.21, y, PZ), pods[s])
    for sx, s in ((-1, 'L'), (1, 'R')):
        node(f'fx_vent_{s}', (sx * 1.21, -3.78, 1.02), pods[s])
    node('hit', (0, 0, 1.25), hull)
    node('badge', (0, 0, 2.9), root)
    finish_unit(uid, root, dict(turret_ring=[0, RY, RZ], hover_clearance_m=0.45, height_incl_clearance_m=2.42, fin_spread_m=0.04,
                                gun_pitch_deg=[-5, 15]))


# ═════════════════════════════ A06 ANTI-AIR VEHICLE (6×6, twin coil-laser emitters) ═════════════════════════════
def tyre_wheel(name, r, w, sx, m_tyre, m_hub, seg=14, lugs=12):
    """Off-road wheel (axis X), outer face toward sx*X: dished hub + tyre lathe, staggered tread lugs. Origin at the axle."""
    hw = w / 2
    prof = [(0.12 * r, hw + 0.03), (0.22 * r, hw + 0.03), (0.26 * r, hw - 0.01), (0.50 * r, hw - 0.06), (0.58 * r, hw - 0.01),
            (0.64 * r, hw + 0.005), (0.86 * r, hw + 0.015), (0.95 * r, hw - 0.02), (r, hw - 0.07), (r, -hw + 0.07),
            (0.95 * r, -hw + 0.02), (0.86 * r, -hw - 0.015), (0.64 * r, -hw), (0.30 * r, -hw + 0.04)]
    prof = [(rr, sx * a) for rr, a in prof]
    parts = [lathe(name + '_t', prof, seg, 'X', mats=[m_tyre, m_hub], bands=[1, 1, 1, 1, 1] + [0] * 8)]
    for k in range(lugs):                              # chunky lugs, alternately offset across the tread
        a = TAU * (k + 0.5) / lugs; rr = r - 0.002          # lug tips at r + 0.015 = rolling radius
        parts.append(bx(f'{name}_lug{k}', (w * 0.58, 0.11, 0.034), ((-1) ** k * 0.07, rr * math.cos(a), rr * math.sin(a)),
                        rot=(a - math.pi / 2, 0, 0), mat=m_tyre))
    return join(name, parts)


def dish(name, R, depth, t, seg=20, mats=None, bands=None):
    """Shallow dish, axis Y, concave side toward +Y, rim at local y = 0 (origin). Front face = bands 0-2, rim + back = 3-6."""
    prof = [(0.06 * R, -depth * 0.99), (0.5 * R, -depth * 0.72), (0.85 * R, -depth * 0.25), (R, 0.0), (R, -t),
            (0.85 * R, -depth * 0.25 - t), (0.5 * R, -depth * 0.72 - t), (0.06 * R, -depth * 0.99 - t)]
    return lathe(name, prof, seg, 'Y', mats=mats, bands=bands or [0, 0, 0, 1, 1, 1, 1])


def build_A06():
    """A06: fast 6×6 wheeled anti-air vehicle. Low wedge hull with a driver cab front-left; a compact hexagonal turret
    (yaw) carries a yoke, a gun cradle (pitch, −5…+80°, clear of the roof at both stops) with two slim coil-laser
    emitters on outriggers and a tracking dish, and a rotating elliptical search dish on the turret rear. A03 Lancer
    palette, materials and marking style. Nodes follow the sandbox's GroundView (views.js), like A03: body → turret (yaw,
    local Z) → gun (pitch, local X; rest pose = emitters level, as the engine sets pitch absolutely) → recoil (both
    emitters, kick along local −Y) → muzzle_0 (left) / muzzle_1 (right); wheel_L/R_0..2 front to back roll about local X
    with property r; radar spins about local Z (cosmetic; GroundView does not drive it yet); antenna sways."""
    reset(); uid = 'A06'; P = PAL['A']
    root = node('root')
    GREY = '#60666C'
    M = dict(
        grey=paint('A_grey', GREY, scale=3, rough=0.55, metal=0.3, grime=0.4, wear=0.22, wear_col='#A9ADB0', mud_top=0.95, mud=0.45),
        navy=paint('A_navy', P['primary'], scale=3, rough=0.55, metal=0.2, grime=0.38, wear=0.25, wear_col='#9AA0A6', mud_top=0.95, mud=0.45),
        grey_t=paint('A_grey_t', GREY, scale=2.5, rough=0.55, metal=0.3, grime=0.38, wear=0.22, wear_col='#A9ADB0'),
        navy_t=paint('A_navy_t', P['primary'], scale=2.5, rough=0.55, metal=0.2, grime=0.35, wear=0.25, wear_col='#9AA0A6'),
        dark=paint('A_dark', P['steel_dark'], scale=1.0, rough=0.5, metal=0.45, grime=0.5, wear=0.2, wear_col='#8A8E92', mud_top=0.95, mud=0.4),
        dark_t=paint('A_dark_t', P['steel_dark'], scale=1.0, rough=0.5, metal=0.45, grime=0.45, wear=0.2, wear_col='#8A8E92'),
        tyre=paint('A_tyre', '#26282A', scale=0.6, rough=0.9, metal=0.0, grime=0.35, wear=0.12, wear_col='#55585B', mud_top=0.45, mud=0.6),
        rim=paint('A_rim', '#5E6368', scale=0.6, rough=0.55, metal=0.35, grime=0.55, wear=0.3, wear_col='#A9ADB0', mud_top=0.45, mud=0.55),
        barrel=paint('A_barrel', '#55595D', scale=1.5, rough=0.45, metal=0.5, grime=0.3, wear=0.25, wear_col='#A9ADB0'),
        coil=gunmetal('A_coil', '#3C3F42', scale=0.5, wear=0.6),
        bore=flat('A_bore', '#0A0A0A', 0.75),
        ivory=paint('A_ivory', P['ivory'], scale=1.0, rough=0.5, metal=0.05, grime=0.25, wear=0.15, noise=0.15),
        red=flat('A_tail', '#8C1C18', 0.35),
        rubber=paint('A_rubber', '#1E1F20', scale=0.5, rough=0.95, metal=0.0, grime=0.3, wear=0.0, mud_top=0.95, mud=0.6),
        amber=glow('amber', '#FFB347', 4.0), coilglow=glow('coil', '#FFB347', 4.0), glass=glass(), team=team(1.2),
    )
    for sx in (-1, 1):
        M[f'soot{sx}'] = paint(f'A_soot{sx}', GREY, scale=1.5, rough=0.55, metal=0.3, grime=0.4, wear=0.2, wear_col='#A9ADB0',
                               mud_top=0.95, mud=0.45, soot=(sx * 1.05, -3.62, 1.26, 0.32))
    for k in ('grey', 'navy', 'soot-1', 'soot1'): grunge(M[k], streak=0.16, dust=0.32, scale=3.0, dust_col='#9A8E78', streak_col='#3A3832')
    for k in ('grey_t', 'navy_t'): grunge(M[k], streak=0.12, dust=0.25, scale=2.5, dust_col='#9A8E78', streak_col='#3A3832')
    for k in ('dark', 'dark_t', 'barrel'): grunge(M[k], streak=0.1, dust=0.2, scale=1.5, dust_col='#8A8070')

    # ── running gear: three axles, big off-road tyres on trailing arms ──
    WR, WW, WX = 0.56, 0.46, 1.30                             # rolling radius (lug tips), tyre width, track half-width
    AX = [2.30, 0.30, -1.70]                                  # axle y, front -> back
    HP = []
    for side, sx in (('L', -1), ('R', 1)):
        for i, y in enumerate(AX):
            w = tyre_wheel(f'wheel_{side}_{i}', WR - 0.015, WW, sx, M['tyre'], M['rim'])
            w.location = (sx * WX, y, WR); w['r'] = WR; smooth(w, 35); attach(w, root)
            HP.append(bx(f'arm{side}{i}', (0.58, 0.24, 0.13), (sx * 0.82, y, WR), bevel=0.015, seg=1, mat=M['dark']))   # V-belly to hub
            HP.append(tube(f'damp{side}{i}', (sx * 0.98, y + 0.2, 0.62), (sx * 1.04, y + 0.36, 1.19), 0.045, verts=6, mat=M['dark']))
        for y in (AX[0] - 0.64, AX[2] - 0.64):                # mud flaps behind the front and rear axles
            HP.append(bx(f'flap{side}{y:.1f}', (0.46, 0.02, 0.36), (sx * WX, y, 0.99), mat=M['rubber']))

    # ── hull: narrow lower tub between the wheels, wide wedge upper hull over them ──
    lo = loft('hull_lo', [                                     # V-section belly
        (-3.42, sec6(0.45, 0.86, 0.80, 1.02, 0.80, 1.20)),
        (-3.02, sec6(0.45, 0.50, 0.92, 0.80, 0.92, 1.20)),
        (2.85, sec6(0.45, 0.50, 0.92, 0.80, 0.92, 1.20)),
        (3.48, sec6(0.45, 1.00, 0.80, 1.08, 0.80, 1.20))], mat=M['grey'])
    bev(lo, 0.018, 1, 30); HP.append(lo)
    up = loft('hull_up', [
        (-3.56, sec6(1.50, 1.20, 1.50, 1.40, 1.22, 1.58)),
        (-3.46, sec6(1.58, 1.18, 1.58, 1.42, 1.28, 1.66)),
        (1.75, sec6(1.58, 1.18, 1.58, 1.42, 1.28, 1.66)),
        (2.95, sec6(1.58, 1.18, 1.58, 1.27, 1.18, 1.36)),
        (3.42, sec6(1.52, 1.04, 1.52, 1.12, 1.12, 1.24)),
        (3.58, sec6(1.44, 1.06, 1.44, 1.11, 1.04, 1.18))], mat=M['grey'])
    set_faces_mat(up, M['navy'], lambda c, nn: 0.3 < abs(nn.x) < 0.9)    # navy deck chamfers (read from above); flanks grey
    bev(up, 0.02, 1, 30); HP.append(up)
    th = math.atan2(0.30, 1.20); gl = lambda y: 1.66 - (y - 1.75) * math.tan(th)
    # driver cab, front left: sloped windscreen, side window, roof hatch
    HP.append(wedge('cab', (0.95, 1.18, 0.46), (-0.62, 1.53, 1.80), moves=[('FT', (0, -0.46, 0)), ('BT', (0, 0.12, 0)), ('LT', (0.10, 0, 0))],
                    bevel=0.02, seg=1, mat=M['grey']))
    a = math.atan2(0.46, 0.46); cy0 = 1.53 + 0.59                       # windscreen slope; cab front-bottom edge y
    HP.append(bx('cab_ws', (0.66, 0.02, 0.24), (-0.58, cy0 - 0.46 * 0.6 + 0.009, 1.57 + 0.46 * 0.6 + 0.009), rot=(a, 0, 0), mat=M['glass']))
    HP.append(bx('cab_sw', (0.02, 0.46, 0.12), (-1.043, 1.30, 1.88), rot=(0, 0.214, 0), mat=M['glass']))
    HP.append(bx('cab_hatch', (0.38, 0.38, 0.03), (-0.58, 1.28, 2.04), bevel=0.01, seg=1, mat=M['grey']))
    HP.append(bx('cab_lamp', (0.1, 0.06, 0.04), (-0.3, 1.58, 2.05), mat=M['amber']))
    for k in (-1, 1):                                          # ivory chevron "V" on the cab nose (bars rotated in the sloped face)
        cv = bx(f'cabv{k}', (0.05, 0.02, 0.17), mat=M['ivory'])
        cv.matrix_world = Matrix.Translation((-0.84 + k * 0.05, cy0 - 0.46 * 0.24 + 0.012, 1.57 + 0.46 * 0.24 + 0.012)) @ Matrix.Rotation(a, 4, 'X') @ Matrix.Rotation(k * 0.5, 4, 'Y')
        HP.append(cv)
    # front right: sensor / equipment bay with louvres, hull number on the glacis
    HP.append(wedge('ebay', (0.72, 0.9, 0.16), (0.62, 1.32, 1.72), moves=[('FT', (0, -0.1, 0))], bevel=0.012, seg=1, mat=M['grey']))
    for k in range(4):
        HP.append(bx(f'ebl{k}', (0.6, 0.04, 0.02), (0.62, 1.02 + k * 0.17, 1.805), mat=M['dark']))
    num = mark('glacis_num', 'A06', 0.36, (0, 0, 0), '+Z', M['ivory'])
    num.matrix_world = Matrix.Translation((0.60, 2.50, gl(2.50) + 0.006)) @ Matrix.Rotation(-th, 4, 'X') @ Matrix.Rotation(math.pi, 4, 'Z')
    HP.append(num)
    for sx in (-1, 1):
        # navy front fender guards with amber headlights; navy rear corners with tail lights
        HP.append(wedge(f'fguard{sx}', (0.46, 0.75, 0.24), (sx * 1.34, 3.15, 1.33), moves=[('FT', (0, -0.28, -0.02))], bevel=0.02, seg=1, mat=M['navy']))
        HP.append(bx(f'hl_box{sx}', (0.30, 0.12, 0.10), (sx * 1.28, 3.49, 1.26), bevel=0.012, seg=1, mat=M['dark']))
        HP.append(bx(f'hl_lens{sx}', (0.22, 0.02, 0.06), (sx * 1.28, 3.555, 1.26), mat=M['amber']))
        HP.append(bx(f'rcorner{sx}', (0.40, 0.24, 0.30), (sx * 1.36, -3.47, 1.42), bevel=0.018, seg=1, mat=M['navy']))
        HP.append(bx(f'tail{sx}', (0.24, 0.02, 0.08), (sx * 1.34, -3.60, 1.45), mat=M['red']))
        HP.append(lathe(f'exo{sx}', [(0.09, -3.50), (0.09, -3.64), (0.06, -3.64), (0.06, -3.56)], 12, 'Y',
                        mats=[M[f'soot{sx}'], M['bore']], bands=[0, 0, 1], loc=(sx * 1.05, 0, 1.26)))
        # flank armour: four raised panels on the navy side, team stripe along them, bolts
        for k, (yc, ln) in enumerate(((-2.72, 1.30), (-1.30, 1.40), (0.18, 1.40), (1.52, 1.10))):
            mv = [('FD', (0, -0.18, 0.08))] if k == 3 else ([('BD', (0, 0.12, 0.06))] if k == 0 else [])
            HP.append(wedge(f'flank{sx}{k}', (0.03, ln, 0.21), (sx * 1.594, yc, 1.30), moves=mv, bevel=0.008, seg=1, mat=M['navy'] if k in (0, 3) else M['grey']))
            for e in (-1, 1):
                HP.append(cyl(f'fbolt{sx}{k}{e}', 0.022, 0.02, (sx * 1.612, yc + e * (ln / 2 - 0.1), 1.37), 'X', 6, mat=M['dark']))
        HP.append(bx(f'steam{sx}', (0.012, 5.3, 0.06), (sx * 1.612, -0.62, 1.25), mat=M['team']))
        # forward stowage bins on the deck edge; rear deck team panels, grab eyes; tow hooks
        HP.append(bx(f'bin{sx}', (0.34, 0.86, 0.15), (sx * 1.30, 1.34, 1.735), bevel=0.012, seg=1, mat=M['grey']))
        HP.append(bx(f'binl{sx}', (0.36, 0.05, 0.03), (sx * 1.30, 1.74, 1.80), mat=M['dark']))
        HP.append(bx(f'rteam{sx}', (0.32, 0.5, 0.012), (sx * 1.26, -3.05, 1.665), mat=M['team']))
        HP.append(torus(f'reye{sx}', 0.06, 0.018, (sx * 1.45, -3.40, 1.70), (0, math.pi / 2, 0), mat=M['dark']))
        HP.append(bx(f'fhook_m{sx}', (0.14, 0.1, 0.12), (sx * 0.55, 3.30, 0.86), bevel=0.012, seg=1, mat=M['dark']))
        HP.append(torus(f'fhook{sx}', 0.075, 0.022, (sx * 0.55, 3.38, 0.78), (0, math.pi / 2, 0), seg=8, arc=0.62, mat=M['dark']))
    HP.append(grille('rgrille', 1.6, 0.30, 6, depth=0.05, loc=(0, -3.57, 1.40), rot=(0, 0, math.pi), mat=M['dark']))
    HP.append(grille('dgrille', 1.7, 0.8, 9, depth=0.035, loc=(0, -2.95, 1.665), rot=(math.pi / 2, 0, 0), mat=M['dark']))
    HP.append(bx('rhook_m', (0.22, 0.12, 0.14), (0, -3.38, 0.80), bevel=0.015, seg=1, mat=M['dark']))
    HP.append(torus('rhook', 0.08, 0.024, (0, -3.44, 0.71), (0, math.pi / 2, 0), seg=8, arc=0.62, mat=M['dark']))
    body = join('body', HP); smooth(body, 35); attach(body, root)

    # ── turret: low hexagonal drum, yoke for the gun cradle, team-banded bustle ──
    RY, RZ = -0.80, 1.66
    TP = [cyl('tring', 0.98, 0.08, (0, RY, 1.69), 'Z', 20, mat=M['dark_t'])]
    sh = loft('tshell', [
        (RY - 1.20, sec6(0.86, 1.70, 0.90, 1.88, 0.72, 2.06)),
        (RY - 0.95, sec6(1.06, 1.70, 1.10, 1.88, 0.92, 2.10)),
        (RY + 0.72, sec6(1.06, 1.70, 1.10, 1.88, 0.92, 2.10)),
        (RY + 1.35, sec6(0.44, 1.70, 0.46, 1.86, 0.36, 2.00))], mat=M['grey_t'])
    set_faces_mat(sh, M['navy_t'], lambda c, nn: c.y > RY + 0.6 and abs(nn.x) > 0.25 and nn.z < 0.6)
    bev(sh, 0.025, 1, 30); TP.append(sh)
    GY, GZ = RY + 0.15, 2.62                                   # trunnion axis
    TP.append(wedge('plinth', (1.0, 1.0, 0.12), (0, GY, 2.15), moves=[('FT', (0, -0.12, 0))], bevel=0.015, seg=1, mat=M['grey_t']))
    for sx in (-1, 1):
        TP.append(wedge(f'yoke{sx}', (0.09, 0.84, 0.60), (sx * 0.42, GY, 2.38), moves=[('FT', (0, -0.28, 0)), ('BT', (0, 0.24, 0))],
                        bevel=0.012, seg=1, mat=M['navy_t']))
        TP.append(cyl(f'trun{sx}', 0.12, 0.05, (sx * 0.49, GY, GZ), 'X', 12, mat=M['dark_t']))
    TP.append(bx('bustle', (1.56, 0.36, 0.30), (0, RY - 1.33, 1.86), bevel=0.02, seg=1, mat=M['grey_t']))
    TP.append(bx('bustle_team', (1.60, 0.26, 0.05), (0, RY - 1.33, 2.0), mat=M['team']))
    for k in range(3):
        TP.append(bx(f'bvent{k}', (0.32, 0.03, 0.16), (-0.5 + k * 0.5, RY - 1.52, 1.86), mat=M['dark_t']))
    for sx, face in ((-1, '-X'), (1, '+X')):
        TP.append(bx(f'tside{sx}', (0.04, 1.05, 0.15), (sx * 1.08, RY - 0.05, 1.80), bevel=0.01, seg=1, mat=M['navy_t']))
        TP.append(mark(f'tmark{sx}', 'A06', 0.17, (sx * 1.103, RY + 0.06 if sx > 0 else RY - 0.16, 1.80), face, M['ivory']))
        vy = RY - 0.42 if sx > 0 else RY + 0.32                 # chevron "V" ahead of the number on both sides
        for k in (-1, 1):
            TP.append(bx(f'tv{sx}{k}', (0.008, 0.035, 0.14), (sx * 1.103, vy + k * 0.035, 1.80), rot=(-k * 0.5, 0, 0), mat=M['ivory']))
        TP.append(bx(f'smkb{sx}', (0.09, 0.36, 0.06), (sx * 0.98, RY - 0.62, 2.0), mat=M['dark_t']))
        for k in range(3):
            a0 = (sx * 1.0, RY - 0.74 + k * 0.11, 2.02); b0 = (a0[0] + sx * 0.10, a0[1] + 0.06, a0[2] + 0.07)
            TP.append(tube(f'smk{sx}{k}', a0, b0, 0.035, verts=8, mat=M['dark_t']))
    TP.append(bx('t_hatch', (0.40, 0.40, 0.035), (0.0, RY - 0.62, 2.115), bevel=0.01, seg=1, mat=M['grey_t']))
    TP.append(wedge('t_sight', (0.24, 0.26, 0.14), (-0.62, RY + 0.62, 2.16), moves=[('FT', (0, -0.05, 0))], bevel=0.012, seg=1, mat=M['grey_t']))
    TP.append(bx('t_sight_l', (0.16, 0.02, 0.06), (-0.62, RY + 0.755, 2.15), mat=M['amber']))
    TP.append(cyl('eo_base', 0.11, 0.06, (0.62, RY + 0.70, 2.12), 'Z', 12, mat=M['dark_t']))
    TP.append(ball('eo_ball', 0.12, (0.62, RY + 0.70, 2.21), seg=12, rings=8, mat=M['grey_t']))
    TP.append(bx('eo_lens', (0.12, 0.02, 0.08), (0.62, RY + 0.815, 2.22), mat=M['glass']))
    turret = pivot_mesh('turret', TP, (0, RY, RZ), body); smooth(turret, 35)

    # ── gun (pitch about local X at the trunnions): cradle drum, tracking dish, outriggers, two coil-laser emitters ──
    EX, TIP = 0.84, GY + 2.95                                  # emitter axis x, muzzle y
    GP = [cyl('drum', 0.25, 0.74, (0, GY, GZ), 'X', 16, mat=M['grey_t']),
          wedge('trk_house', (0.50, 0.42, 0.38), (0, GY + 0.36, GZ), moves=[('FT', (0, -0.05, -0.03)), ('FD', (0, -0.05, 0.03))], bevel=0.02, seg=1, mat=M['navy_t'])]
    td = dish('trk_dish', 0.19, 0.06, 0.02, 16, mats=[M['ivory'], M['dark_t']], bands=[0, 0, 0, 1, 0, 0, 0]); td.location = (0, GY + 0.59, GZ + 0.02); GP.append(td)
    GP.append(cyl('trk_feed', 0.025, 0.12, (0, GY + 0.59, GZ + 0.02), 'Y', 8, mat=M['dark_t']))
    EP = []                                                    # emitters ride on 'recoil' (fire kick along local -Y)
    for sx in (-1, 1):
        x = sx * EX
        GP.append(cyl(f'outr{sx}', 0.09, 0.36, (sx * 0.55, GY, GZ), 'X', 12, mat=M['dark_t']))
        GP.append(wedge(f'pylon{sx}', (0.16, 0.42, 0.20), (sx * 0.62, GY + 0.06, GZ), moves=[('F', (0, -0.04, 0))], bevel=0.015, seg=1, mat=M['navy_t']))
        GP.append(bx(f'cap{sx}', (0.15, 0.5, 0.12), (x, GY + 0.05, GZ - 0.16), bevel=0.012, seg=1, mat=M['dark_t']))
        y0 = GY - 0.36
        prof = [(0.06, y0), (0.135, y0 + 0.02), (0.165, y0 + 0.09), (0.165, GY + 0.60), (0.125, GY + 0.71), (0.088, GY + 0.78),
                (0.088, TIP - 0.32), (0.105, TIP - 0.28), (0.12, TIP - 0.21), (0.12, TIP - 0.05), (0.105, TIP), (0.068, TIP), (0.068, TIP - 0.12)]
        EP.append(lathe(f'emit{sx}', prof, 14, 'Y', mats=[M['navy_t'], M['barrel'], M['bore']], bands=[0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2], loc=(x, 0, GZ)))
        EP.append(lathe(f'eteam{sx}', [(0.168, GY + 0.02), (0.168, GY + 0.18)], 14, 'Y', mats=[M['team']], loc=(x, 0, GZ), cap0=False, cap1=False))
        EP.append(cyl(f'elens{sx}', 0.066, 0.01, (x, TIP - 0.11, GZ), 'Y', 12, mat=M['coilglow']))
        for k in (-1, 0, 1):                                   # cooling fins along the top of the housing
            EP.append(bx(f'efin{sx}{k}', (0.018, 0.46, 0.05), (x + k * 0.06, GY + 0.28, GZ + 0.17 - abs(k) * 0.012), mat=M['dark_t']))
        for k in range(6):                                     # coil rings, glowing windings between them
            yc = GY + 0.95 + k * 0.30
            EP.append(lathe(f'coil{sx}{k}', [(0.088, yc - 0.05), (0.13, yc - 0.04), (0.13, yc + 0.04), (0.088, yc + 0.05)], 14, 'Y',
                            mats=[M['coil']], loc=(x, 0, GZ), cap0=False, cap1=False))
            if k < 5:
                EP.append(lathe(f'cglow{sx}{k}', [(0.093, yc + 0.09), (0.093, yc + 0.21)], 14, 'Y', mats=[M['coilglow']], loc=(x, 0, GZ), cap0=False, cap1=False))
    gun = pivot_mesh('gun', GP, (0, GY, GZ), turret); smooth(gun, 35)
    recoil = pivot_mesh('recoil', EP, (0, GY, GZ), gun); smooth(recoil, 35)
    for k, sx in enumerate((-1, 1)):
        node(f'muzzle_{k}', (sx * EX, TIP, GZ), recoil)

    # ── search radar on the turret rear (spins about local Z): wide elliptical dish tilted up, IFF ring on the head ──
    RRY, DT = RY - 0.98, math.radians(30)
    RP = [cyl('r_post', 0.075, 0.52, (0, RRY, 2.36), 'Z', 10, mat=M['dark_t']),
          cyl('r_collar', 0.14, 0.06, (0, RRY, 2.13), 'Z', 12, mat=M['dark_t']),
          bx('r_head', (0.24, 0.18, 0.16), (0, RRY - 0.04, 2.62), bevel=0.015, seg=1, mat=M['grey_t']),
          torus('r_iff', 0.17, 0.018, (0, RRY - 0.04, 2.47), seg=14, mat=M['dark_t'])]
    sd = dish('r_dish', 0.62, 0.13, 0.035, 22, mats=[M['ivory'], M['dark_t']], bands=[0, 0, 0, 1, 0, 0, 0])
    sd.scale = (1.45, 1.0, 0.62); sd.rotation_euler = (DT, 0, 0); sd.location = (0, RRY + 0.06, 2.66); RP.append(sd)
    fa = Vector((0, RRY + 0.06, 2.66)); fd = Vector((0, math.cos(DT), math.sin(DT)))
    RP.append(tube('r_feed', tuple(fa - fd * 0.08), tuple(fa + fd * 0.36), 0.02, verts=6, mat=M['dark_t']))
    RP.append(bx('r_horn', (0.09, 0.09, 0.06), tuple(fa + fd * 0.38), rot=(DT, 0, 0), mat=M['dark_t']))
    pivot_mesh('radar', RP, (0, RRY, 2.10), turret)

    # ── antenna on the hull's rear left corner (sway pivot at its base; below the emitters' sweep) ──
    AB = (-1.30, -3.36, 1.66)
    ant = [cyl('ant_base', 0.05, 0.07, (AB[0], AB[1], AB[2] + 0.035), 'Z', 8, mat=M['dark']),
           tube('ant_whip', (AB[0], AB[1], AB[2] + 0.06), (AB[0], AB[1], 2.36), 0.011, verts=6, r2=0.005, mat=M['dark'])]
    pivot_mesh('antenna', ant, AB, body)

    for sx, s in ((-1, 'L'), (1, 'R')):
        node(f'fx_exhaust_{s}', (sx * 1.05, -3.66, 1.26), body)
        node(f'fx_dust_{s}', (sx * WX, AX[-1] - 0.6, 0.1), root)
    node('hit', (0, 0, 1.3), body)
    node('badge', (0, 0, 3.5), root)
    finish_unit(uid, root, dict(turret_ring=[0, RY, RZ], gun_pitch_deg=[-5, 80], recoil_m=0.03, emitters=2, emitter_m=round(TIP - GY, 3), muzzle_d_m=0.136,
                                wheel_r_m=WR, axle_y_m=AX, drive='6x6 wheeled; wheel_L/R_0..2 front to back roll about local X (property r)'))

BUILD = {'H03': build_H03, 'A03': build_A03, 'T03': build_T03, 'A06': build_A06}

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')] or ['all']
    todo = list(BUILD) if args[0] == 'all' else args
    for u in todo:
        BUILD[u.upper()]()
