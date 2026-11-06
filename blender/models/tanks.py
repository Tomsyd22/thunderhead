"""Tracked and hover tanks: Bastion (Compact MBT), Arbiter (Helix MBT), Phalanx (Lattice hover main battle drone).
Run: blender-env/bin/python blender/models/tanks.py [bastion|arbiter|phalanx|all]"""
import sys, os, math
import bpy, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import *
from mathutils import Vector

def stadium(x0, x1, z0, z1, n=10):
    """Closed outline (x, z) of a track loop: straight top/bottom runs, round sprocket and idler ends."""
    r = (z1 - z0) / 2; zc = (z0 + z1) / 2; pts = []
    for i in range(n + 1): a = -math.pi / 2 + math.pi * i / n; pts.append((x1 - r + math.cos(a) * r, zc + math.sin(a) * r))
    for i in range(n + 1): a = math.pi / 2 + math.pi * i / n; pts.append((x0 + r + math.cos(a) * r, zc + math.sin(a) * r))
    return pts

def track_band(name, y, width, pts, mat_track, mat_side, link_len=0.055):
    """Track belt with U running along the perimeter so the game can scroll it."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap'); y0, y1 = y - width / 2, y + width / 2
    n = len(pts); s = [0.0]
    for i in range(1, n + 1): a, b = pts[i - 1], pts[i % n]; s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    vA = [bm.verts.new((x, y0, z)) for x, z in pts]; vB = [bm.verts.new((x, y1, z)) for x, z in pts]
    for i in range(n):
        j = (i + 1) % n; f = bm.faces.new((vA[i], vA[j], vB[j], vB[i])); u0, u1 = s[i] / (link_len * 8), s[i + 1] / (link_len * 8)
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))): loop[uv].uv = (u, v)
        f.material_index = 0
    for ring, flip in ((vA, True), (vB, False)):
        f = bm.faces.new(list(reversed(ring)) if flip else ring); f.material_index = 1
        for loop in f.loops: loop[uv].uv = (0.0, 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = mesh_obj(name, bm); o.data.materials.append(mat_track); o.data.materials.append(mat_side)
    for p in o.data.polygons: p.use_smooth = False
    return o

def wheels(prefix, xs, z, r, y, width, mat, hub_mat, hull):
    out = []
    for i, x in enumerate(xs):
        w = cyl(f'{prefix}{i}', r, width, (x, y, z), (math.pi / 2, 0, 0), verts=18, bevel=0.008)
        hub = cyl('hub', r * 0.45, width + 0.012, (x, y, z), (math.pi / 2, 0, 0), verts=10)
        assign(w, mat); assign(hub, hub_mat); w = join(f'{prefix}{i}', [w, hub]); shade(w); set_origin(w, (x, y, z)); parent(w, hull); out.append(w)
    return out

# ════════════════════════ BASTION — Compact main battle tank ════════════════════════
def bastion():
    reset()
    olive = paint_mat('olive', (0.20, 0.23, 0.11), rough=0.72, metal=0.15, grime=0.6, wear=0.4, panel=0, camo={'c1': (0.36, 0.30, 0.18), 'c2': (0.10, 0.11, 0.07), 'scale': 3.2, 't1': 0.5, 't2': 0.6})
    steel = paint_mat('steel', (0.13, 0.13, 0.12), rough=0.55, metal=0.6, grime=0.5, wear=0.5)
    rubber = paint_mat('rubber', (0.05, 0.05, 0.045), rough=0.9, metal=0.0, grime=0.3, wear=0.1)
    team = flat_mat('TEAM', (1, 1, 1), 0.45); glass = flat_mat('GLASS', (0.02, 0.05, 0.08), 0.08, 0.3); lamp = flat_mat('GLOW', (1.0, 0.9, 0.6), 0.3, emit=(1.0, 0.85, 0.5), strength=6)
    trk = track_mat(track_image())
    # hull: side profile extruded across the full width (sloped glacis, angled rear)
    upper = profile_extrude('upper', [(-0.55, 0.17), (0.40, 0.17), (0.58, 0.215), (0.30, 0.305), (-0.50, 0.305), (-0.56, 0.27)], 0.74, bevel=0.012)
    lower = profile_extrude('lower', [(-0.50, 0.06), (0.44, 0.06), (0.56, 0.16), (-0.53, 0.16)], 0.42, bevel=0.01)
    assign(upper, olive); assign(lower, olive)
    # engine deck: raised block with a slatted grille
    deck = box('deck', (0.28, 0.5, 0.03), (-0.36, 0, 0.318), bevel=0.008); assign(deck, olive)
    grille = box('grille', (0.024, 0.44, 0.012), (-0.47, 0, 0.338)); array(grille, 9, (0.03, 0, 0)); assign(grille, steel)
    exh = [box(f'exh{s}', (0.04, 0.14, 0.06), (-0.565, s * 0.2, 0.235), bevel=0.008) for s in (-1, 1)]
    for e in exh: assign(e, steel)
    # glacis details: driver hatch, periscopes, headlights, tow hooks, front fenders
    hatch = cyl('hatch', 0.055, 0.02, (0.24, 0.13, 0.31), verts=20, bevel=0.005); assign(hatch, olive)
    peris = [box(f'per{i}', (0.025, 0.03, 0.022), (0.30, 0.09 + i * 0.035, 0.302), rot=(0, -0.35, 0)) for i in range(3)]
    for p in peris: assign(p, glass)
    lights = [cyl(f'lt{s}', 0.022, 0.03, (0.52, s * 0.3, 0.235), (0, math.pi / 2, 0), verts=12) for s in (-1, 1)]
    for l in lights: assign(l, lamp)
    guards = [box(f'lg{s}', (0.035, 0.06, 0.04), (0.5, s * 0.3, 0.235), bevel=0.006) for s in (-1, 1)]
    for g in guards: assign(g, steel)
    hooks = [box(f'hk{s}', (0.04, 0.03, 0.03), (0.57, s * 0.14, 0.15), bevel=0.006) for s in (-1, 1)]
    for h in hooks: assign(h, steel)
    fend = [box(f'fd{s}', (0.12, 0.17, 0.012), (0.55, s * 0.29, 0.205), rot=(0, 0.25, 0), bevel=0.004) for s in (-1, 1)]
    for f in fend: assign(f, olive)
    # side skirts: five armour panels a side with gaps and a slanted lower edge
    skirts = []
    for s in (-1, 1):
        p = box(f'sk{s}', (0.205, 0.022, 0.11), (0.43, s * 0.385, 0.16), bevel=0.006, taper={'bot_front': (-0.02, 0, 0)}); array(p, 5, (-0.213, 0, 0)); assign(p, olive); skirts.append(p)
    # stowage: boxes and jerry cans on the rear fenders, tow cable on the hull side
    stow = [box(f'st{s}', (0.16, 0.1, 0.07), (-0.36, s * 0.31, 0.34), bevel=0.01) for s in (-1, 1)]
    for b in stow: assign(b, olive)
    cans = []
    for s in (-1, 1):
        for i in range(2):
            c = box(f'can{s}{i}', (0.05, 0.035, 0.07), (-0.53 + i * 0.06, s * 0.31, 0.34), bevel=0.006); assign(c, steel if i else olive); cans.append(c)
    hull = join('hull', [upper, lower, deck, grille, *exh, hatch, *peris, *lights, *guards, *hooks, *fend, *skirts, *stow, *cans])
    shade(hull)
    # tracks and running gear
    loop = stadium(-0.56, 0.56, 0.015, 0.175)
    tL = track_band('track_L', 0.28, 0.15, loop, trk, rubber); tR = track_band('track_R', -0.28, 0.15, loop, trk, rubber)
    for t in (tL, tR): parent(t, hull)
    wl = wheels('wheel_L', [-0.38 + i * 0.152 for i in range(6)], 0.07, 0.058, 0.28, 0.13, rubber, steel, hull)
    wr = wheels('wheel_R', [-0.38 + i * 0.152 for i in range(6)], 0.07, 0.058, -0.28, 0.13, rubber, steel, hull)
    spr = []
    for s, nm in ((1, 'L'), (-1, 'R')):
        for x, z, rr, tag in ((-0.48, 0.1, 0.07, 'spr'), (0.48, 0.1, 0.06, 'idl')):
            w = cyl(f'wheel_{nm}{tag}', rr, 0.135, (x, s * 0.28, z), (math.pi / 2, 0, 0), verts=14 if tag == 'spr' else 18, bevel=0.006); assign(w, steel); shade(w); set_origin(w, (x, s * 0.28, z)); parent(w, hull); spr.append(w)
    # ── turret: top-view outline extruded up, sides sloped inwards ──
    tz0, tz1 = 0.305, 0.455; outline = [(0.30, 0), (0.21, 0.245), (-0.06, 0.275), (-0.28, 0.24), (-0.33, 0.12), (-0.33, -0.12), (-0.28, -0.24), (-0.06, -0.275), (0.21, -0.245)]
    bm = bmesh.new(); vs = [bm.verts.new((x, y, tz0)) for x, y in outline]; f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top: v.co.z = tz1; v.co.x = v.co.x * 0.88 - 0.02; v.co.y *= 0.86
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); tur = mesh_obj('turret_shell', bm); bev(tur, 0.016, 2); assign(tur, olive)
    era = []
    for s in (-1, 1):
        for row in range(2):
            for k in range(3):
                x = 0.235 - k * 0.07; y = s * (0.06 + 0.17 * (k / 3) + 0.035) ; b = box(f'era{s}{row}{k}', (0.055, 0.06, 0.038), (x - 0.01 * row, s * (0.11 + k * 0.045), tz0 + 0.035 + row * 0.045), rot=(0, -0.2, s * (-0.55)), bevel=0.005); assign(b, olive); era.append(b)
    cup = cyl('cupola', 0.065, 0.045, (-0.09, 0.12, tz1 + 0.02), verts=20, bevel=0.008); assign(cup, olive)
    cuph = cyl('cuphatch', 0.05, 0.016, (-0.1, 0.12, tz1 + 0.05), verts=18, bevel=0.004); assign(cuph, olive)
    cupp = [box(f'cp{i}', (0.018, 0.026, 0.02), (-0.09 + math.cos(a) * 0.062, 0.12 + math.sin(a) * 0.062, tz1 + 0.03), rot=(0, 0, a)) for i, a in enumerate([0.3, 1.2, 2.2, 3.4, 4.6, 5.6])]
    for p in cupp: assign(p, glass)
    mgm = box('mgmount', (0.03, 0.02, 0.04), (-0.04, 0.12, tz1 + 0.07)); assign(mgm, steel)
    mg = cyl('mg', 0.007, 0.16, (0.04, 0.12, tz1 + 0.085), (0, math.pi / 2, 0), verts=8); assign(mg, steel)
    sight = box('sight', (0.08, 0.06, 0.06), (0.11, -0.15, tz1 + 0.025), bevel=0.008); assign(sight, olive)
    lens = box('lens', (0.006, 0.045, 0.035), (0.152, -0.15, tz1 + 0.028)); assign(lens, glass)
    smoke = []
    for s in (-1, 1):
        for i in range(4):
            t = cyl(f'sm{s}{i}', 0.012, 0.06, (0.12 - i * 0.025, s * 0.25, tz0 + 0.07), (s * -0.9, 0.5, 0), verts=8); assign(t, steel); smoke.append(t)
    band = [box(f'band{s}', (0.22, 0.008, 0.028), (-0.12, s * 0.268, tz0 + 0.07), rot=(s * 0.12, 0, 0)) for s in (-1, 1)]
    for b in band: assign(b, team)
    roof = box('roofband', (0.12, 0.06, 0.006), (-0.2, -0.06, tz1 + 0.002)); assign(roof, team)
    # rear stowage basket (wireframe)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * 0.13, v.co.y * 0.44, v.co.z * 0.09))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    bk = mesh_obj('basket', bm); bk.location = (-0.39, 0, tz0 + 0.075); wf = bk.modifiers.new('wf', 'WIREFRAME'); wf.thickness = 0.008; assign(bk, steel)
    bag = box('bag', (0.09, 0.2, 0.05), (-0.39, 0.08, tz0 + 0.07), bevel=0.02, seg=3); assign(bag, rubber)
    ant = cyl('antenna', 0.004, 0.42, (-0.24, -0.2, tz1 + 0.2), (0.1, -0.08, 0), verts=6); antb = cyl('antbase', 0.015, 0.03, (-0.24, -0.2, tz1 + 0.01), verts=10)
    assign(ant, steel); assign(antb, steel)
    turret = join('turret', [tur, *era, cup, cuph, *cupp, mgm, mg, sight, lens, *smoke, *band, roof, bk, bag, ant, antb]); shade(turret)
    set_origin(turret, (-0.02, 0, tz0)); parent(turret, hull)
    # ── gun: mantlet, sleeved barrel, fume extractor, muzzle sensor ──
    gz = tz0 + 0.075
    mant = box('mantlet', (0.1, 0.17, 0.09), (0.3, 0, gz), bevel=0.012, taper={'front': (0, 0, 0)}); assign(mant, olive)
    barrel = cyl('barrel', 0.021, 0.66, (0.66, 0, gz), (0, math.pi / 2, 0), verts=16); assign(barrel, olive)
    sleeves = [cyl(f'sl{i}', 0.026, 0.05, (0.42 + i * 0.12, 0, gz), (0, math.pi / 2, 0), verts=16, bevel=0.004) for i in range(4)]
    for s in sleeves: assign(s, olive)
    fume = cyl('fume', 0.034, 0.09, (0.6, 0, gz), (0, math.pi / 2, 0), verts=18, bevel=0.01); assign(fume, olive)
    tip = cyl('tip', 0.024, 0.03, (0.985, 0, gz), (0, math.pi / 2, 0), verts=16, bevel=0.004); assign(tip, steel)
    mrs = box('mrs', (0.03, 0.015, 0.02), (0.96, 0, gz + 0.03)); assign(mrs, steel)
    gun = join('gun', [mant, barrel, *sleeves, fume, tip, mrs]); shade(gun); set_origin(gun, (0.26, 0, gz)); parent(gun, turret)
    empty('muzzle', (1.0, 0, gz), gun)
    objs = [hull, turret, gun, *wl, *wr, *spr]
    bake_atlas(objs + [tL, tR], 'bastion_tex', 1024)
    print('tris', tris(objs + [tL, tR]))
    preview(os.path.join(PREV, 'bastion.png'), target=(0.1, 0, 0.22), dist=2.8)
    preview(os.path.join(PREV, 'bastion_b.png'), target=(0.05, 0, 0.22), dist=2.6, azim=140, elev=28)
    export('cmp_bastion')

# ════════════════════════ ARBITER — Helix main battle tank ════════════════════════
def arbiter():
    reset()
    black = paint_mat('gloss', (0.035, 0.035, 0.045), rough=0.28, metal=0.55, grime=0.35, wear=0.45, wear_col=(0.5, 0.5, 0.58), panel=7.0)
    dark = paint_mat('dark', (0.06, 0.06, 0.07), rough=0.45, metal=0.4, grime=0.3, wear=0.3)
    rubber = paint_mat('rubber', (0.045, 0.045, 0.05), rough=0.85, grime=0.25, wear=0.05)
    team = flat_mat('TEAM', (1, 1, 1), 0.35); glass = flat_mat('GLASS', (0.04, 0.02, 0.06), 0.05, 0.4)
    neon = flat_mat('GLOW', (1.0, 0.2, 0.65), 0.3, emit=(1.0, 0.15, 0.6), strength=7)
    trk = track_mat(track_image('arb_track', rubber=(0.04, 0.04, 0.045), steel=(0.18, 0.18, 0.2)))
    upper = profile_extrude('upper', [(-0.52, 0.16), (0.36, 0.16), (0.6, 0.2), (0.34, 0.29), (-0.48, 0.29), (-0.54, 0.25)], 0.7, bevel=0.035, seg=1)
    lower = profile_extrude('lower', [(-0.48, 0.06), (0.42, 0.06), (0.55, 0.15), (-0.5, 0.15)], 0.4, bevel=0.02, seg=1)
    assign(upper, black); assign(lower, dark)
    fins = box('fin', (0.012, 0.42, 0.05), (-0.42, 0, 0.31)); array(fins, 7, (0.028, 0, 0)); assign(fins, dark)
    skirts = []; strips = []
    for s in (-1, 1):
        sk = box(f'sk{s}', (0.98, 0.02, 0.1), (0.01, s * 0.37, 0.165), rot=(s * 0.18, 0, 0), bevel=0.012, taper={'bot_front': (-0.06, 0, 0.03), 'top_front': (0.03, 0, 0)}); assign(sk, black); skirts.append(sk)
        st = box(f'st{s}', (0.8, 0.006, 0.008), (0.0, s * 0.382, 0.19), rot=(s * 0.18, 0, 0)); assign(st, neon); strips.append(st)
    lights = [box(f'hl{s}', (0.01, 0.07, 0.012), (0.585, s * 0.2, 0.2), rot=(0, -0.25, 0)) for s in (-1, 1)]
    for l in lights: assign(l, neon)
    hatch = box('hatch', (0.09, 0.08, 0.012), (0.2, 0.14, 0.295), bevel=0.01); assign(hatch, dark)
    hull = join('hull', [upper, lower, fins, *skirts, *strips, *lights, hatch]); shade(hull)
    loop = stadium(-0.53, 0.53, 0.015, 0.165)
    tL = track_band('track_L', 0.27, 0.13, loop, trk, rubber); tR = track_band('track_R', -0.27, 0.13, loop, trk, rubber)
    for t in (tL, tR): parent(t, hull)
    wl = wheels('wheel_L', [-0.36 + i * 0.18 for i in range(5)], 0.07, 0.062, 0.27, 0.11, rubber, dark, hull)
    wr = wheels('wheel_R', [-0.36 + i * 0.18 for i in range(5)], 0.07, 0.062, -0.27, 0.11, rubber, dark, hull)
    tz0, tz1 = 0.29, 0.39
    outline = [(0.27, 0.0), (0.16, 0.24), (-0.18, 0.25), (-0.3, 0.16), (-0.3, -0.16), (-0.18, -0.25), (0.16, -0.24)]
    bm = bmesh.new(); vs = [bm.verts.new((x, y, tz0)) for x, y in outline]; f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top: v.co.z = tz1; v.co.x = v.co.x * 0.8 - 0.03; v.co.y *= 0.78
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); tur = mesh_obj('tshell', bm); bev(tur, 0.025, 1); assign(tur, black)
    dome = sphere('dome', 0.045, (-0.08, -0.1, tz1 + 0.01), scale=(1, 1, 0.7), seg=16, rings=8, cut_below=0); assign(dome, glass)
    domer = cyl('domer', 0.05, 0.012, (-0.08, -0.1, tz1 + 0.006), verts=16); assign(domer, dark)
    sight = box('psight', (0.07, 0.05, 0.05), (0.05, 0.13, tz1 + 0.02), bevel=0.012, taper={'top_front': (-0.02, 0, 0)}); assign(sight, dark)
    slens = box('slens', (0.005, 0.035, 0.018), (0.088, 0.13, tz1 + 0.022)); assign(slens, neon)
    tstrips = [box(f'ts{s}', (0.3, 0.006, 0.01), (-0.05, s * 0.232, tz0 + 0.045), rot=(s * 0.35, 0, s * -0.02)) for s in (-1, 1)]
    for t in tstrips: assign(t, neon)
    band = box('band', (0.1, 0.36, 0.006), (-0.2, 0, tz1 + 0.002)); assign(band, team)
    logo = box('logo', (0.04, 0.04, 0.004), (0.05, -0.08, tz1 + 0.002), rot=(0, 0, 0.785)); assign(logo, neon)
    pods = [box(f'pod{s}', (0.12, 0.05, 0.05), (-0.22, s * 0.23, tz0 + 0.06), bevel=0.012) for s in (-1, 1)]
    for p in pods: assign(p, dark)
    turret = join('turret', [tur, dome, domer, sight, slens, *tstrips, band, logo, *pods]); shade(turret); set_origin(turret, (-0.02, 0, tz0)); parent(turret, hull)
    gz = tz0 + 0.055
    mant = box('mant', (0.1, 0.13, 0.07), (0.25, 0, gz), bevel=0.02, seg=1); assign(mant, black)
    shroud = box('shroud', (0.3, 0.06, 0.055), (0.42, 0, gz), bevel=0.012, taper={'front': (0, 0, 0)}); assign(shroud, black)
    vents = box('vent', (0.012, 0.064, 0.02), (0.32, 0, gz + 0.018)); array(vents, 6, (0.04, 0, 0)); assign(vents, dark)
    barrel = cyl('barrel', 0.017, 0.62, (0.68, 0, gz), (0, math.pi / 2, 0), verts=14); assign(barrel, dark)
    coils = [cyl(f'coil{i}', 0.024, 0.018, (0.62 + i * 0.06, 0, gz), (0, math.pi / 2, 0), verts=14) for i in range(4)]
    for c in coils: assign(c, dark)
    mring = cyl('mring', 0.026, 0.02, (0.98, 0, gz), (0, math.pi / 2, 0), verts=16); assign(mring, neon)
    gun = join('gun', [mant, shroud, vents, barrel, *coils, mring]); shade(gun); set_origin(gun, (0.22, 0, gz)); parent(gun, turret)
    empty('muzzle', (1.0, 0, gz), gun)
    objs = [hull, turret, gun, *wl, *wr]
    bake_atlas(objs + [tL, tR], 'arbiter_tex', 1024)
    print('tris', tris(objs + [tL, tR]))
    preview(os.path.join(PREV, 'arbiter.png'), target=(0.1, 0, 0.22), dist=2.8)
    export('hlx_arbiter')

# ════════════════════════ PHALANX — Lattice hover main battle drone ════════════════════════
def phalanx():
    reset()
    ceramic = paint_mat('ceramic', (0.78, 0.8, 0.8), rough=0.45, metal=0.05, grime=0.4, wear=0.25, wear_col=(0.35, 0.37, 0.4), panel=6.0, noise_scale=10)
    dark = paint_mat('dark', (0.12, 0.14, 0.16), rough=0.45, metal=0.5, grime=0.3, wear=0.3)
    team = flat_mat('TEAM', (1, 1, 1), 0.4); glow = flat_mat('GLOW', (0.35, 0.9, 1.0), 0.3, emit=(0.3, 0.9, 1.0), strength=7)
    # hull: lozenge plan, chamfered, raised spine
    bm = bmesh.new(); outline = [(0.56, 0.0), (0.4, 0.3), (-0.36, 0.33), (-0.52, 0.18), (-0.52, -0.18), (-0.36, -0.33), (0.4, -0.3)]
    vs = [bm.verts.new((x, y, 0.12)) for x, y in outline]; f = bm.faces.new(vs); ext = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top: v.co.z = 0.27; v.co.x *= 0.86; v.co.y *= 0.8
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); body = mesh_obj('body', bm); bev(body, 0.05, 3); assign(body, ceramic)
    belly = box('belly', (0.8, 0.4, 0.06), (0, 0, 0.11), bevel=0.025, seg=2); assign(belly, dark)
    spine = box('spine', (0.42, 0.12, 0.04), (-0.2, 0, 0.29), bevel=0.015, seg=2); assign(spine, ceramic)
    eye = box('eye', (0.012, 0.32, 0.018), (0.48, 0, 0.2), rot=(0, 0, 0)); assign(eye, glow)
    seams = [box(f'seam{s}', (0.55, 0.006, 0.01), (0.0, s * 0.27, 0.235)) for s in (-1, 1)]
    for sm in seams: assign(sm, glow)
    team_p = [box(f'tp{s}', (0.16, 0.006, 0.04), (-0.25, s * 0.29, 0.2), rot=(s * 0.25, 0, 0)) for s in (-1, 1)]
    for t in team_p: assign(t, team)
    vents = box('vent', (0.03, 0.2, 0.008), (-0.38, 0, 0.27)); array(vents, 4, (0.045, 0, 0)); assign(vents, dark)
    hull = join('hull', [body, belly, spine, eye, *seams, *team_p, vents]); shade(hull, 50)
    # hover pods at the corners
    pods = []
    for i, (x, y) in enumerate(((0.32, 0.3), (0.32, -0.3), (-0.34, 0.32), (-0.34, -0.32))):
        p = cyl(f'pc{i}', 0.085, 0.07, (x, y, 0.1), verts=20, r2=0.07, bevel=0.012); assign(p, ceramic)
        r = cyl(f'pr{i}', 0.062, 0.012, (x, y, 0.062), verts=20); assign(r, glow)
        fan = cyl(f'pf{i}', 0.05, 0.01, (x, y, 0.07), verts=10); assign(fan, dark)
        pod = join(f'pod_{i}', [p, r, fan]); shade(pod); set_origin(pod, (x, y, 0.1)); parent(pod, hull); pods.append(pod)
    # turret: rounded ceramic dome cut flat, sensor visor, team stripe
    tz0 = 0.27
    dome = sphere('tdome', 0.22, (0, 0, tz0), scale=(1.15, 0.95, 0.55), seg=24, rings=12, cut_below=0.0); assign(dome, ceramic)
    collar = cyl('collar', 0.2, 0.03, (0, 0, tz0 + 0.015), verts=24); assign(collar, dark)
    visor = box('visor', (0.05, 0.16, 0.022), (0.2, 0, tz0 + 0.07), rot=(0, -0.5, 0)); assign(visor, glow)
    tstripe = box('tstripe', (0.18, 0.04, 0.006), (-0.08, 0.0, tz0 + 0.12)); assign(tstripe, team)
    antenna = cyl('ant', 0.004, 0.18, (-0.15, -0.1, tz0 + 0.17), verts=6); assign(antenna, dark)
    tnode = cyl('tnode', 0.02, 0.03, (-0.15, -0.1, tz0 + 0.09), verts=10); assign(tnode, glow)
    turret = join('turret', [dome, collar, visor, tstripe, antenna, tnode]); shade(turret, 50); set_origin(turret, (0, 0, tz0)); parent(turret, hull)
    gz = tz0 + 0.06
    mant = sphere('gmant', 0.06, (0.2, 0, gz), scale=(1, 1, 0.8), seg=16, rings=8); assign(mant, ceramic)
    barrel = cyl('barrel', 0.02, 0.56, (0.5, 0, gz), (0, math.pi / 2, 0), verts=16); assign(barrel, dark)
    sleeve = cyl('sleeve', 0.028, 0.22, (0.34, 0, gz), (0, math.pi / 2, 0), verts=16, bevel=0.006); assign(sleeve, ceramic)
    tipr = cyl('tipr', 0.024, 0.02, (0.78, 0, gz), (0, math.pi / 2, 0), verts=16); assign(tipr, glow)
    gun = join('gun', [mant, barrel, sleeve, tipr]); shade(gun, 50); set_origin(gun, (0.18, 0, gz)); parent(gun, turret)
    empty('muzzle', (0.8, 0, gz), gun)
    objs = [hull, turret, gun, *pods]
    bake_atlas(objs, 'phalanx_tex', 1024)
    print('tris', tris(objs))
    preview(os.path.join(PREV, 'phalanx.png'), target=(0.05, 0, 0.2), dist=2.5)
    export('lat_phalanx')

if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'bastion'
    if which in ('bastion', 'all'): bastion()
    if which in ('arbiter', 'all'): arbiter()
    if which in ('phalanx', 'all'): phalanx()
