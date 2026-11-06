"""The six infantry units of the design pack (H01 Conscript, H02 Rocket Trooper, A01 Ranger, A02 Missile Specialist,
T01 Pulse Trooper, T02 Disruptor). Each has:
  * a continuous body mesh: a Skin-modifier skeleton plus subdivision, with clothing sculpted by per-joint radii
  * gear meshes (helmets, plates, pouches, packs, launchers, batteries), all skinned into one `body` mesh bound to
    the 24-bone armature `rig`. Weights are distance-based along the bone hierarchy, so joints blend smoothly
  * a separate rigid `weapon` node with grip_R / grip_L / muzzle / stock sockets, which the game poses with IK
  * deployables: the Ranger's `shield` and bipod, and the Missile Specialist's `tripod`
The model is exported in the bind pose. Previews are rendered in a ready/aim pose built with IK constraints.
Run: /home/claude/blender-env/bin/python units/blender/infantry.py H01|H02|A01|A02|T01|T02|all
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from ulib import *
from ulib import _cam
from mathutils import Vector, Matrix, Euler, Quaternion

# ─────────────────────── skeleton (bind pose: arms 45° down, +Y forward, +X right) ───────────────────────
def joints(s=1.0, sh=0.19):
    J = {'pelvis': (0, 0, 0.98), 'spine_01': (0, 0, 1.08), 'spine_02': (0, 0.005, 1.22), 'spine_03': (0, 0.0, 1.36), 'neck': (0, 0.0, 1.50),
         'head': (0, 0.015, 1.60), 'head_end': (0, 0.015, 1.80)}
    for n, sx in (('R', 1), ('L', -1)):
        J[f'clavicle_{n}'] = (sx * 0.03, 0.0, 1.45); J[f'upperarm_{n}'] = (sx * sh, -0.005, 1.445)
        e = Vector((sx * (sh + 0.29 * 0.707), -0.005, 1.445 - 0.29 * 0.707)); J[f'forearm_{n}'] = tuple(e)
        w = e + Vector((sx * 0.26 * 0.707, 0.01, -0.26 * 0.707)); J[f'hand_{n}'] = tuple(w); J[f'hand_end_{n}'] = tuple(w + Vector((sx * 0.06, 0.01, -0.06)))
        J[f'thigh_{n}'] = (sx * 0.095, 0, 0.96); J[f'shin_{n}'] = (sx * 0.10, 0.01, 0.53); J[f'foot_{n}'] = (sx * 0.10, 0, 0.095)
        J[f'toe_{n}'] = (sx * 0.10, 0.13, 0.03); J[f'toe_end_{n}'] = (sx * 0.10, 0.21, 0.025)
    return {k: tuple(Vector(v) * s) for k, v in J.items()}

BONES = [  # name, head joint, tail joint, parent
    ('pelvis', 'pelvis', 'spine_01', None), ('spine_01', 'spine_01', 'spine_02', 'pelvis'), ('spine_02', 'spine_02', 'spine_03', 'spine_01'),
    ('spine_03', 'spine_03', 'neck', 'spine_02'), ('neck', 'neck', 'head', 'spine_03'), ('head', 'head', 'head_end', 'neck')]
for n in ('R', 'L'):
    BONES += [(f'clavicle_{n}', f'clavicle_{n}', f'upperarm_{n}', 'spine_03'), (f'upperarm_{n}', f'upperarm_{n}', f'forearm_{n}', f'clavicle_{n}'),
              (f'forearm_{n}', f'forearm_{n}', f'hand_{n}', f'upperarm_{n}'), (f'hand_{n}', f'hand_{n}', f'hand_end_{n}', f'forearm_{n}'),
              (f'thigh_{n}', f'thigh_{n}', f'shin_{n}', 'pelvis'), (f'shin_{n}', f'shin_{n}', f'foot_{n}', f'thigh_{n}'),
              (f'foot_{n}', f'foot_{n}', f'toe_{n}', f'shin_{n}'), (f'toe_{n}', f'toe_{n}', f'toe_end_{n}', f'foot_{n}')]
PARENT = {b[0]: b[3] for b in BONES}
CHILDREN = {}
for b in BONES:
    if b[3]: CHILDREN.setdefault(b[3], []).append(b[0])

def make_rig(J):
    arm = bpy.data.armatures.new('rig'); rig = bpy.data.objects.new('rig', arm); link(rig)
    bpy.context.view_layer.objects.active = rig
    for ob in bpy.context.selected_objects: ob.select_set(False)
    rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
    for name, h, t, p in BONES:
        eb = arm.edit_bones.new(name); eb.head = J[h]; eb.tail = J[t]
        # consistent roll: bone Z axis points forward (+Y) for limbs/spine so elbows/knees hinge about local X
        eb.align_roll(Vector((0, 1, 0)) if name.startswith(('thigh', 'shin', 'pelvis', 'spine', 'neck', 'head', 'upperarm', 'forearm', 'hand', 'clavicle')) else Vector((0, 0, 1)))
    for name, h, t, p in BONES:
        if p: arm.edit_bones[name].parent = arm.edit_bones[p]; arm.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT'); return rig

# ─────────────────────── body: skin-modifier skeleton ───────────────────────
def body_mesh(name, J, R, mat, extra=()):
    """R maps skin-vertex keys to (rx, ry) radii. Vertices sit at joints (plus mid-limb shaping points)."""
    P = {}
    def mid(a, b, t=0.5): return tuple(Vector(J[a]).lerp(Vector(J[b]), t))
    P['pelvis'] = J['pelvis']; P['waist'] = mid('spine_01', 'spine_02', 0.3); P['chest'] = mid('spine_02', 'spine_03', 0.6); P['uchest'] = (0, 0, J['neck'][2] - 0.07)
    P['neck'] = mid('neck', 'head', 0.5); P['crotch'] = (0, 0.0, J['pelvis'][2] - 0.07)
    for n in ('R', 'L'):
        P[f'sh_{n}'] = J[f'upperarm_{n}']; P[f'el_{n}'] = J[f'forearm_{n}']; P[f'wr_{n}'] = J[f'hand_{n}']; P[f'ua_{n}'] = mid(f'upperarm_{n}', f'forearm_{n}', 0.5)
        P[f'fa_{n}'] = mid(f'forearm_{n}', f'hand_{n}', 0.45)
        P[f'hip_{n}'] = (J[f'thigh_{n}'][0], 0.0, J[f'thigh_{n}'][2] - 0.04); P[f'th_{n}'] = mid(f'thigh_{n}', f'shin_{n}', 0.45); P[f'kn_{n}'] = J[f'shin_{n}']
        P[f'ca_{n}'] = mid(f'shin_{n}', f'foot_{n}', 0.35); P[f'an_{n}'] = (J[f'foot_{n}'][0], J[f'foot_{n}'][1], J[f'foot_{n}'][2] + 0.06)
    E = [('crotch', 'pelvis'), ('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'uchest'), ('uchest', 'neck')]
    for n in ('R', 'L'):
        E += [('uchest', f'sh_{n}'), (f'sh_{n}', f'ua_{n}'), (f'ua_{n}', f'el_{n}'), (f'el_{n}', f'fa_{n}'), (f'fa_{n}', f'wr_{n}'),
              ('crotch', f'hip_{n}'), (f'hip_{n}', f'th_{n}'), (f'th_{n}', f'kn_{n}'), (f'kn_{n}', f'ca_{n}'), (f'ca_{n}', f'an_{n}')]
    keys = list(P.keys()); idx = {k: i for i, k in enumerate(keys)}
    me = bpy.data.meshes.new(name); me.from_pydata([P[k] for k in keys], [(idx[a], idx[b]) for a, b in E], []); me.update()
    o = bpy.data.objects.new(name, me); link(o)
    sk = o.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True; sk.branch_smoothing = 0.6
    sv = me.skin_vertices[0].data
    for k, i in idx.items():
        r = R.get(k) or R.get(k.rstrip('RL').rstrip('_') + '_') or (0.05, 0.05)
        sv[i].radius = r
    sv[idx['pelvis']].use_root = True
    sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    apply_all(o); assign(o, mat); return o

def radii(build='regular', baggy=1.0, armour=0.0):
    """Clothing-shaped radii (rx = across, ry = front-back) before subdivision (which shrinks ~20 %).
    baggy widens trousers/sleeves, armour adds torso bulk."""
    b, a = baggy, armour
    return {'crotch': (0.12 * b, 0.11), 'pelvis': (0.17 + a, 0.13 + a * 0.6), 'waist': (0.165 + a, 0.125 + a), 'chest': (0.2 + a, 0.145 + a),
            'uchest': (0.215 + a, 0.14 + a * 0.8), 'neck': (0.066, 0.068),
            'sh_': (0.088 * b + a * 0.5, 0.088 * b + a * 0.5), 'ua_': (0.074 * b, 0.074 * b), 'el_': (0.06 * b, 0.062 * b), 'fa_': (0.057 * b, 0.052 * b), 'wr_': (0.042, 0.036),
            'hip_': (0.105 * b, 0.11 * b), 'th_': (0.1 * b, 0.105 * b), 'kn_': (0.078 * b, 0.084 * b), 'ca_': (0.074 * b, 0.08 * b), 'an_': (0.058 * b, 0.06 * b)}

# ─────────────────────── weights ───────────────────────
def seg_dist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9))); return (p - (a + ab * t)).length

def skin_weights(o, rig, J, sigma=0.022, only=None):
    """Distance-to-bone softmax restricted to the nearest bone, its parent and its children (no cross-limb bleeding).
    only = list of bone names to consider (rigid gear passes one bone)."""
    segs = {name: (Vector(J[h]), Vector(J[t])) for name, h, t, p in BONES}
    groups = {name: o.vertex_groups.get(name) or o.vertex_groups.new(name=name) for name in segs}
    mw = o.matrix_world
    for v in o.data.vertices:
        p = mw @ v.co
        cand = only or list(segs.keys())
        d = {n: seg_dist(p, *segs[n]) for n in cand}
        b0 = min(d, key=d.get)
        if only and len(only) == 1: groups[b0].add([v.index], 1.0, 'REPLACE'); continue
        near = [b0] + ([PARENT[b0]] if PARENT.get(b0) else []) + CHILDREN.get(b0, [])
        near = [n for n in near if n in segs]
        for n in near:
            if n not in d: d[n] = seg_dist(p, *segs[n])
        w = {n: math.exp(-(d[n] - d[b0]) / sigma) for n in near}; s = sum(w.values())
        for n, x in w.items():
            if x / s > 0.03: groups[n].add([v.index], x / s, 'REPLACE')

def rigid(o, bone):
    vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE'); return o

# ─────────────────────── gear helpers ───────────────────────
def fixed(o, mat=None):
    if mat: assign(o, mat)
    apply_all(o); lib_apply(o); return o

def lib_apply(o):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def boot(n, J, mat, sole, h=0.2, wide=1.0):
    """Lofted boot (heel → ankle → instep → toe) on a slightly wider sole; ankle at the foot joint."""
    x = J[f'foot_{n}'][0]; w = wide
    secs = [(-0.075, rsec(0.047 * w, 0.02, 0.12, 0.02)), (-0.03, rsec(0.054 * w, 0.02, h, 0.025)), (0.03, rsec(0.055 * w, 0.02, h * 0.72, 0.025)),
            (0.09, rsec(0.052 * w, 0.02, 0.1, 0.025)), (0.15, rsec(0.048 * w, 0.02, 0.075, 0.022)), (0.19, rsec(0.036 * w, 0.025, 0.06, 0.016))]
    up = loft(f'boot_{n}', secs, mat=mat, smooth=True); up.location = (x, 0, 0)
    so = side_prism(f'sole_{n}', [(-0.085, 0.0), (0.2, 0.0), (0.205, 0.025), (0.19, 0.03), (-0.08, 0.03), (-0.088, 0.02)], 0.112 * w, (x, 0, 0), bevel=0.006, mat=sole)
    cuff = cyl(f'bootcuff_{n}', 0.058 * w, 0.03, (x, -0.028, h - 0.01), 'Z', 14, mat=sole)
    lace = bx(f'lace_{n}', (0.045 * w, 0.012, h * 0.55), (x, 0.06, 0.06 + h * 0.3), rot=(math.radians(-30), 0, 0), mat=sole)
    return [up, so, cuff, lace]

def glove(n, J, mat, size=1.0):
    w = Vector(J[f'hand_{n}']); e = Vector(J[f'hand_end_{n}']); d = (e - w).normalized(); c = w + d * 0.045
    o = ball(f'glove_{n}', 0.045 * size, tuple(c), scale=(0.75, 1.0, 1.15), seg=12, rings=8, mat=mat)
    th = ball(f'thumb_{n}', 0.018 * size, tuple(c + Vector((0, 0.035, 0.0))), scale=(1, 1.4, 1), seg=8, rings=6, mat=mat)
    cuff = tube(f'cuff_{n}', tuple(w - d * 0.03), tuple(w + d * 0.02), 0.04 * size, 12, mat=mat)
    return [o, th, cuff]

def pouch(name, size, loc, mat, flap=None, rot=(0, 0, 0)):
    p = [bx(name, size, loc, rot=rot, bevel=min(size) * 0.18, seg=2, mat=mat)]
    if flap: p.append(bx(name + '_flap', (size[0] * 1.04, size[1] * 1.08, size[2] * 0.32), (loc[0], loc[1] + 0.002, loc[2] + size[2] * 0.36), rot=rot, bevel=size[2] * 0.08, mat=flap))
    return p

def strap(name, pts, w, t, mat):
    """Flat strap through points (webbing, harness)."""
    parts = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1]); d = b - a; c = (a + b) / 2
        o = bx(f'{name}{i}', (w, t, d.length + w * 0.3), tuple(c), mat=mat)
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized()); parts.append(o)
    return parts

# ─────────────────────── weapons (rigid; +Y = barrel; origin at the trigger/grip) ───────────────────────
def scale_weapon(w, k):
    """Uniformly rescale everything under the weapon node about its origin, keeping the node itself at scale 1."""
    bpy.context.view_layer.update()
    for c in w.children_recursive:
        if c.type == 'MESH':
            mw = c.matrix_world.copy(); c.data.transform(Matrix.Scale(k, 4)); 
        if c.parent == w: c.location = c.location * k
        elif c.type != 'MESH' or True: c.location = c.location * k
    bpy.context.view_layer.update()

def weapon_root(name='weapon'):
    return node(name, (0, 0, 0))

def sockets(w, grip_R, grip_L, muzzle, stock):
    for n, p in (('grip_R', grip_R), ('grip_L', grip_L), ('muzzle', muzzle), ('stock', stock)): node(n, p, w)

def rifle_H01(P):
    wood, metal = paint('wood', P['wood'], scale=0.2, rough=0.6, metal=0.0, grime=0.4, wear=0.5, wear_col='#9C6B44'), gunmetal('rifle_metal', scale=0.15)
    parts = [bx('rec', (0.05, 0.26, 0.075), (0, 0.02, 0.0), bevel=0.008, mat=metal),
             wedge('stock', (0.042, 0.24, 0.085), (0, -0.21, -0.025), moves=[('BD', (0, 0, -0.035)), ('FT', (0, 0, -0.01))], bevel=0.01, mat=wood),
             bx('grip', (0.035, 0.045, 0.09), (0, -0.04, -0.07), rot=(math.radians(-18), 0, 0), bevel=0.008, mat=wood),
             bx('mag', (0.03, 0.06, 0.13), (0, 0.06, -0.09), rot=(math.radians(14), 0, 0), bevel=0.006, mat=metal),
             bx('handguard', (0.046, 0.2, 0.05), (0, 0.24, -0.008), bevel=0.012, mat=wood),
             tube('barrel', (0, 0.3, 0.012), (0, 0.5, 0.012), 0.0125, 10, mat=metal), tube('gasblock', (0, 0.32, 0.034), (0, 0.42, 0.034), 0.008, 8, mat=metal),
             bx('sight_f', (0.006, 0.012, 0.03), (0, 0.47, 0.035), mat=metal), bx('sight_r', (0.02, 0.02, 0.02), (0, 0.07, 0.045), mat=metal),
             tube('muzzle_brake', (0, 0.48, 0.012), (0, 0.51, 0.012), 0.016, 10, mat=metal)]
    w = weapon_root(); g = join('weapon_mesh', parts); attach(g, w)
    sockets(w, (0, -0.04, -0.06), (0, 0.2, -0.03), (0, 0.51, 0.012), (0, -0.33, -0.02))
    scale_weapon(w, 0.72 / 0.84); return w   # typeset length 0.72 m

def launcher_H02(P):
    tubem = paint('tube', P['steel'], scale=0.3, rough=0.55, metal=0.4, grime=0.5, wear=0.5, soot=(0, -0.55, 0, 0.25))
    red = paint('tube_red', P['primary'], scale=0.3, rough=0.6, wear=0.4)
    metal = gunmetal('l_metal', scale=0.2); lens = glass('GLASS', '#3A2A10')
    parts = [cyl('tube', 0.075, 1.05, (0, 0.05, 0), 'Y', 14, mat=tubem, bevel=0.004),
             cyl('front_cap', 0.088, 0.1, (0, 0.53, 0), 'Y', 14, mat=metal, bevel=0.006), cyl('rear_vent', 0.09, 0.11, (0, -0.44, 0), 'Y', 14, r2=0.1, mat=metal),
             cyl('band1', 0.078, 0.07, (0, 0.38, 0), 'Y', 14, mat=red), cyl('band2', 0.078, 0.07, (0, -0.3, 0), 'Y', 14, mat=red),
             bx('sight', (0.06, 0.12, 0.07), (-0.095, 0.2, 0.06), bevel=0.01, mat=metal), cyl('sight_lens', 0.024, 0.02, (-0.095, 0.265, 0.06), 'Y', 12, mat=lens),
             bx('lamp', (0.05, 0.03, 0.04), (-0.095, 0.17, 0.11), mat=glow('amber', '#FFB24A', 3)),
             bx('grip', (0.032, 0.045, 0.11), (0, 0.0, -0.11), rot=(math.radians(-15), 0, 0), bevel=0.008, mat=metal),
             bx('fgrip', (0.03, 0.04, 0.09), (0, 0.14, -0.1), bevel=0.008, mat=metal), bx('shoulder_pad', (0.07, 0.16, 0.03), (0, -0.12, -0.085), bevel=0.01, mat=metal)]
    w = weapon_root(); g = join('weapon_mesh', parts); attach(g, w)
    sockets(w, (0, 0.0, -0.13), (0, 0.14, -0.1), (0, 0.58, 0), (0, -0.12, -0.1)); return w

def carbine_A01(P):
    metal, poly = gunmetal('c_metal', '#2E3134', scale=0.15), paint('poly', '#3B3D3A', scale=0.15, rough=0.75, metal=0.0, wear=0.3)
    parts = [bx('rec', (0.055, 0.3, 0.07), (0, 0.04, 0), bevel=0.008, mat=metal), bx('rail', (0.03, 0.26, 0.015), (0, 0.06, 0.042), mat=metal),
             bx('optic', (0.034, 0.09, 0.045), (0, 0.04, 0.072), bevel=0.01, mat=metal), cyl('optic_lens', 0.014, 0.01, (0, 0.087, 0.072), 'Y', 10, mat=glass('GLASS', '#5A3A10')),
             wedge('stock', (0.045, 0.22, 0.07), (0, -0.2, -0.02), moves=[('BD', (0, 0, -0.03))], bevel=0.01, mat=poly),
             bx('grip', (0.034, 0.045, 0.09), (0, -0.04, -0.07), rot=(math.radians(-18), 0, 0), bevel=0.008, mat=poly),
             bx('mag', (0.028, 0.065, 0.14), (0, 0.07, -0.095), rot=(math.radians(10), 0, 0), bevel=0.006, mat=poly),
             bx('handguard', (0.052, 0.22, 0.058), (0, 0.27, -0.004), bevel=0.01, mat=metal),
             tube('barrel', (0, 0.36, 0.008), (0, 0.55, 0.008), 0.012, 10, mat=metal), tube('flash', (0, 0.53, 0.008), (0, 0.58, 0.008), 0.017, 8, mat=metal)]
    w = weapon_root(); g = join('weapon_mesh', parts); attach(g, w)
    for n, sx in (('bipod_L', -1), ('bipod_R', 1)):   # folded along the handguard; deploy swings them down 80°
        b = node(n, (sx * 0.02, 0.36, -0.03), w); leg = tube(n + '_m', (sx * 0.02, 0.36, -0.03), (sx * 0.02, 0.18, -0.04), 0.008, 8, mat=metal); attach(leg, b)
    sockets(w, (0, -0.04, -0.06), (0, 0.27, -0.035), (0, 0.58, 0.008), (0, -0.31, -0.02))
    scale_weapon(w, 0.78 / 0.89); return w   # typeset length 0.78 m

def launcher_A02(P):
    case, metal = paint('cells', '#3C4044', scale=0.3, rough=0.6, metal=0.3, wear=0.45), gunmetal('a_metal', '#2A2D30', scale=0.2)
    parts = [bx('cellbank', (0.2, 0.95, 0.11), (0, 0.06, 0.0), bevel=0.012, mat=case)]
    for k, z in enumerate((0.032, -0.032)):     # upper = AA cell, lower = AT cell
        parts.append(bx(f'cell_open{k}', (0.16, 0.012, 0.045), (0, 0.533, z), mat=gunmetal(f'cell_dark{k}', '#121314', wear=0.1)))
    parts += [bx('track_unit', (0.07, 0.12, 0.08), (-0.14, 0.32, 0.03), bevel=0.012, mat=metal), cyl('track_lens', 0.026, 0.02, (-0.14, 0.385, 0.03), 'Y', 12, mat=glass('GLASS', '#5A3A10')),
              bx('blue1', (0.204, 0.06, 0.112), (0, 0.42, 0), mat=team(0.3)), bx('grip', (0.032, 0.045, 0.1), (0, 0.0, -0.1), rot=(math.radians(-15), 0, 0), bevel=0.008, mat=metal),
              bx('fgrip', (0.03, 0.04, 0.08), (0, 0.14, -0.09), bevel=0.008, mat=metal)]
    w = weapon_root(); g = join('weapon_mesh', parts); attach(g, w)
    sockets(w, (0, 0.0, -0.12), (0, 0.14, -0.1), (0, 0.54, 0.032), (0, -0.2, -0.07))
    node('muzzle_aa', (0, 0.54, 0.032), w); node('muzzle_at', (0, 0.54, -0.032), w); return w

def carbine_T01(P, glow_m):
    shell, dark = paint('t_shell', P['steel'], scale=0.15, rough=0.45, metal=0.2, wear=0.3), gunmetal('t_dark', '#2A2C2E', scale=0.15)
    parts = [wedge('body', (0.06, 0.42, 0.09), (0, 0.12, 0.0), moves=[('FT', (0, 0, -0.015))], bevel=0.015, seg=3, mat=shell),
             bx('spine', (0.012, 0.3, 0.012), (0.031, 0.14, 0.02), mat=glow_m), bx('spine2', (0.012, 0.3, 0.012), (-0.031, 0.14, 0.02), mat=glow_m),
             cyl('emitter', 0.032, 0.08, (0, 0.36, 0.0), 'Y', 16, mat=dark, bevel=0.006), cyl('emitter_ring', 0.026, 0.01, (0, 0.402, 0.0), 'Y', 16, mat=glow_m),
             bx('battery', (0.05, 0.11, 0.07), (0, -0.16, -0.005), bevel=0.012, mat=dark), bx('bat_glow', (0.052, 0.02, 0.03), (0, -0.12, -0.005), mat=glow_m),
             wedge('stock', (0.045, 0.12, 0.08), (0, -0.27, -0.02), moves=[('BD', (0, 0, -0.02))], bevel=0.01, mat=dark),
             bx('grip', (0.032, 0.045, 0.09), (0, -0.04, -0.075), rot=(math.radians(-18), 0, 0), bevel=0.008, mat=dark),
             bx('optic', (0.03, 0.08, 0.035), (0, 0.06, 0.06), bevel=0.008, mat=dark)]
    w = weapon_root(); g = join('weapon_mesh', parts); attach(g, w)
    sockets(w, (0, -0.04, -0.065), (0, 0.24, -0.04), (0, 0.41, 0.0), (0, -0.33, -0.03)); return w

def lance_T02(P, glow_m):
    shell, dark = paint('l_shell', P['steel'], scale=0.15, rough=0.45, metal=0.35, wear=0.35), gunmetal('l_dark', '#26282A', scale=0.15)
    parts = [cyl('shaft', 0.022, 0.62, (0, 0.02, 0), 'Y', 12, mat=dark), bx('housing', (0.07, 0.2, 0.075), (0, 0.18, 0), bevel=0.015, mat=shell),
             cyl('emitter', 0.035, 0.05, (0, 0.33, 0), 'Y', 16, mat=dark), cyl('charge_ring', 0.04, 0.018, (0, 0.31, 0), 'Y', 16, mat=glow('charge', '#6FE6D4', 2.0)),
             cyl('emitter_core', 0.02, 0.012, (0, 0.358, 0), 'Y', 12, mat=glow_m), bx('cap', (0.05, 0.08, 0.05), (0, -0.3, 0), bevel=0.012, mat=shell),
             bx('grip', (0.032, 0.045, 0.09), (0, 0.0, -0.06), bevel=0.008, mat=dark)]
    for sx in (-1, 1):  # twin prongs, ≥ 0.12 m apart
        parts.append(wedge(f'prong{sx}', (0.022, 0.32, 0.03), (sx * 0.068, 0.44, 0), moves=[('F', (-sx * 0.012, 0, -0.008))], bevel=0.006, mat=shell))
        parts.append(bx(f'prongroot{sx}', (0.05, 0.06, 0.03), (sx * 0.05, 0.29, 0), bevel=0.006, mat=shell))
    w = weapon_root(); g = join('weapon_mesh', parts); attach(g, w)
    sockets(w, (0, 0.0, -0.04), (0, 0.17, -0.04), (0, 0.6, 0.0), (0, -0.3, 0)); return w

# ─────────────────────── per-unit outfits ───────────────────────
def outfit(uid, J):
    P = PAL[uid[0]]; g = []  # (object, bone or None for auto weights)
    def add(objs, bone=None):
        for o in (objs if isinstance(objs, list) else [objs]): g.append((o, bone))
    if uid in ('H01', 'H02'):
        cloth = fabric('cloth', P['fabric'], camo=dict(c1=P['fabric2'], scale=0.18, t1=0.56)); canvas = fabric('canvas', P['canvas'], mud_top=None)
        leather = paint('leather', P['leather'], scale=0.2, rough=0.7, metal=0.0, wear=0.25); bootm = paint('boot', '#3A2E22', scale=0.2, rough=0.8, metal=0.0, mud_top=0.25, mud=0.8)
        steel = paint('helmet', '#4E4B46', scale=0.25, rough=0.55, metal=0.35, wear=0.6, grime=0.4, camo=dict(c1=P['primary'], scale=0.09, t1=0.62)); red = paint('red', P['primary'], scale=0.25, rough=0.6, wear=0.5)
        skin_m = paint('skin', P['skin'], scale=0.1, rough=0.6, metal=0.0, grime=0.2, wear=0.0, noise=0.12)
        body = body_mesh('body_core', J, radii(baggy=1.12), cloth); add(body)
        head = ball('face', 0.092, (0, 0.03, 1.665), scale=(0.88, 1.0, 1.12), seg=12, rings=9, mat=skin_m); nose = wedge('nose', (0.03, 0.03, 0.045), (0, 0.118, 1.66), moves=[('FD', (0, 0.01, 0))], bevel=0.008, mat=skin_m)
        ears = [ball(f'ear{sx}', 0.02, (sx * 0.083, 0.02, 1.665), scale=(0.5, 1, 1.3), seg=8, rings=6, mat=skin_m) for sx in (-1, 1)]
        add([head, nose] + ears, 'head')
        hel = ball('helmet', 0.128, (0, 0.012, 1.705), scale=(1.0, 1.08, 0.78), seg=14, rings=8, mat=steel, cut_below=-0.01)
        strapc = tube('chinstrap', (-0.085, 0.03, 1.69), (0, 0.075, 1.585), 0.006, 6, mat=leather); strapc2 = tube('chinstrap2', (0.085, 0.03, 1.69), (0, 0.075, 1.585), 0.006, 6, mat=leather); add([strapc, strapc2], 'head')
        brim = cyl('brim', 0.138, 0.018, (0, 0.012, 1.705), 'Z', 16, mat=steel); brim.scale = (1.0, 1.1, 1); add([hel, brim], 'head')
        for n in ('R', 'L'): add(boot(n, J, bootm, gunmetal('sole', '#1E1A16', wear=0.1), h=0.2), f'shin_{n}'); add(glove(n, J, leather), f'hand_{n}')
        # chest rig: plate + straps + pouches
        add(wedge('plate', (0.24, 0.05, 0.22), (0, 0.148, 1.3), moves=[('T', (0, -0.015, 0))], bevel=0.015, mat=steel if uid == 'H01' else leather), 'spine_03')
        if uid == 'H02': add(bx('id_plate', (0.13, 0.012, 0.08), (0, 0.178, 1.33), bevel=0.004, mat=team(0.2)), 'spine_03'); add(text_mark('id_txt', 'H02', 0.05, (0, 0.186, 1.33), rot=(math.pi / 2, 0, math.pi), mat=paint('ivory', P['ivory'], scale=0.1, wear=0.2)), 'spine_03')
        for sx in (-1, 1):
            add(strap(f'sstrap{sx}', [(sx * 0.1, 0.13, 1.42), (sx * 0.12, 0.05, 1.5), (sx * 0.12, -0.1, 1.44), (sx * 0.1, -0.13, 1.25)], 0.05, 0.012, canvas), 'spine_03')
            add(pouch(f'mag{sx}', (0.07, 0.05, 0.09), (sx * 0.07, 0.155, 1.15), canvas, canvas), 'spine_01')
        add(cyl('belt', 0.165, 0.05, (0, 0.0, 1.03), 'Z', 16, mat=leather), 'pelvis')
        add([bx('buckle', (0.05, 0.012, 0.035), (0, 0.118, 1.03), mat=gunmetal('brass', P['brass'], wear=0.2))], 'pelvis')
        armband = cyl('armband', 0.064, 0.06, tuple(Vector(J['upperarm_L']).lerp(Vector(J['forearm_L']), 0.35)), 'Z', 14, mat=team(0.2))
        armband.rotation_euler = (0, math.radians(-45), 0); add(armband, 'upperarm_L')
        add(pouch('hip_pouch', (0.06, 0.08, 0.09), (0.15, 0.05, 1.0), canvas, canvas), 'pelvis')
        if uid == 'H01':
            add(pouch('pack', (0.3, 0.17, 0.32), (0, -0.21, 1.3), canvas, canvas), 'spine_03')
            add(bx('pack_pocket', (0.2, 0.05, 0.12), (0, -0.31, 1.24), bevel=0.02, mat=canvas), 'spine_03')
            add(cyl('bedroll', 0.065, 0.36, (0, -0.2, 1.08), 'X', 16, mat=fabric('blanket', '#6E6250', mud_top=None)), 'spine_02')
            add([cyl('canteen', 0.045, 0.14, (-0.16, -0.04, 1.0), 'Z', 14, mat=paint('canteen', '#4F5A3C', scale=0.1, rough=0.6, metal=0.3)), cyl('cap', 0.015, 0.03, (-0.16, -0.04, 1.08), 'Z', 8, mat=gunmetal())], 'pelvis')
        else:
            tankm = paint('canister', P['steel'], scale=0.3, rough=0.5, metal=0.45, wear=0.55); redb = paint('can_red', P['primary'], scale=0.3, rough=0.6, wear=0.5)
            for sx in (-1, 1):
                add([cyl(f'can{sx}', 0.085, 0.5, (sx * 0.1, -0.23, 1.3), 'Z', 12, mat=tankm, bevel=0.01), cyl(f'canband{sx}', 0.088, 0.07, (sx * 0.1, -0.23, 1.47), 'Z', 12, mat=redb),
                     cyl(f'cancap{sx}', 0.07, 0.04, (sx * 0.1, -0.23, 1.57), 'Z', 12, mat=gunmetal())], 'spine_03')
            add(bx('frame', (0.3, 0.04, 0.4), (0, -0.14, 1.3), bevel=0.01, mat=leather), 'spine_03')
            add(bx('back_id', (0.1, 0.01, 0.06), (0, -0.33, 1.22), mat=team(0.2)), 'spine_03')
        return g, P
    if uid in ('A01', 'A02'):
        if uid == 'A01': cloth = fabric('cloth', '#6B6457', camo=dict(c1='#4F4A40', c2='#8A826F', scale=0.12, t1=0.55, t2=0.7))
        else: cloth = fabric('cloth', '#22293A', camo=dict(c1='#1A1F2C', scale=0.2, t1=0.6))
        plate = paint('plate', '#4E5357', scale=0.25, rough=0.55, metal=0.2, wear=0.4); web = fabric('web', '#4D4A40', mud_top=None)
        bootm = paint('boot', '#2B2722', scale=0.2, rough=0.8, metal=0.0, mud_top=0.25, mud=0.7); helm = paint('helmet', '#5A5F63', scale=0.25, rough=0.5, metal=0.25, wear=0.4)
        skin_m = paint('skin', P['skin'], scale=0.1, rough=0.6, metal=0.0, grime=0.2, wear=0.0, noise=0.12); visor = glass('GLASS', '#C07A10')
        body = body_mesh('body_core', J, radii(baggy=1.06), cloth); add(body)
        head = ball('face', 0.09, (0, 0.03, 1.665), scale=(0.88, 1.0, 1.12), seg=16, rings=12, mat=skin_m); add(head, 'head')
        hel = ball('helmet', 0.124, (0, 0.006, 1.71), scale=(0.98, 1.07, 0.84), seg=8 if uid == 'A01' else 18, rings=7 if uid == 'A01' else 10, mat=helm, cut_below=-0.035)  # A01: faceted, angular shell
        brow = wedge('helmet_brow', (0.2, 0.04, 0.035), (0, 0.11, 1.715), moves=[('FT', (0, -0.012, 0))], bevel=0.008, mat=helm)
        add([hel, brow, bx('helmet_rail_L', (0.018, 0.13, 0.028), (-0.12, 0.0, 1.70), bevel=0.005, mat=gunmetal()), bx('helmet_rail_R', (0.018, 0.13, 0.028), (0.12, 0.0, 1.70), bevel=0.005, mat=gunmetal()),
             bx('nvg_mount', (0.045, 0.02, 0.04), (0, 0.125, 1.76), bevel=0.006, mat=gunmetal())], 'head')
        if uid == 'A01':
            add(wedge('visor', (0.2, 0.05, 0.065), (0, 0.105, 1.665), moves=[('B', (0, 0, 0))], bevel=0.015, mat=visor), 'head')
            add(bx('mask', (0.15, 0.04, 0.07), (0, 0.11, 1.6), bevel=0.02, mat=paint('mask', '#2A2C2E', scale=0.1, rough=0.7)), 'head')
        else:
            add(bx('goggles', (0.18, 0.03, 0.04), (0, 0.11, 1.675), bevel=0.012, mat=visor), 'head')
        for n in ('R', 'L'):
            add(boot(n, J, bootm, gunmetal('sole', '#1C1B19', wear=0.1), h=0.22), f'shin_{n}'); add(glove(n, J, paint('glove', '#2A2A28', scale=0.1, rough=0.8)), f'hand_{n}')
            k = Vector(J[f'shin_{n}']); add(wedge(f'kneepad_{n}', (0.1, 0.05, 0.12), (k.x, k.y + 0.065, k.z - 0.01), bevel=0.02, seg=3, mat=plate), f'shin_{n}')
            sh = Vector(J[f'upperarm_{n}']).lerp(Vector(J[f'forearm_{n}']), 0.18)
            pad = wedge(f'shoulder_{n}', (0.11, 0.13, 0.05), tuple(sh + Vector((0.01 if n == 'R' else -0.01, 0, 0.02))), bevel=0.015, seg=2, mat=team(0.2) if uid == 'A01' else cloth)
            pad.rotation_euler = (0, math.radians(-40 if n == 'R' else 40), 0); add(pad, f'upperarm_{n}')
            if uid == 'A02':
                band = cyl(f'band_{n}', 0.064, 0.035, tuple(Vector(J[f'upperarm_{n}']).lerp(Vector(J[f'forearm_{n}']), 0.45)), 'Z', 14, mat=team(0.2)); band.rotation_euler = (0, math.radians(-45 if n == 'R' else 45), 0); add(band, f'upperarm_{n}')
        add(wedge('carrier', (0.39, 0.3, 0.32), (0, 0.005, 1.31), moves=[('TF', (0, -0.02, 0)), ('TB', (0, 0.02, 0))], bevel=0.05, seg=3, mat=plate), 'spine_03')
        add(wedge('carrier_cummerbund', (0.37, 0.27, 0.07), (0, 0.0, 1.13), bevel=0.025, seg=2, mat=web), 'spine_01')
        for sx in (-1, 0, 1): add(pouch(f'cpouch{sx}', (0.085, 0.05, 0.11), (sx * 0.095, 0.175, 1.22), web, web), 'spine_02')
        add(pouch('admin', (0.15, 0.04, 0.07), (0, 0.168, 1.37), web, web), 'spine_03')
        add(cyl('belt', 0.16, 0.06, (0, 0.0, 1.03), 'Z', 16, mat=web), 'pelvis')
        for sx in (-1, 1): add(pouch(f'hip{sx}', (0.06, 0.08, 0.1), (sx * 0.16, 0.0, 0.98), web, web), 'pelvis')
        if uid == 'A01':
            add(pouch('pack', (0.24, 0.13, 0.36), (0, -0.2, 1.3), paint('hardshell', '#3E4245', scale=0.25, rough=0.5, wear=0.4), None), 'spine_03')
            add([bx('shovel_h', (0.025, 0.025, 0.32), (0.13, -0.24, 1.3), mat=paint('shovel_h', '#4A3B2A', scale=0.1)), bx('shovel_b', (0.1, 0.012, 0.13), (0.13, -0.25, 1.1), bevel=0.01, mat=gunmetal())], 'spine_03')
            add(bx('deploy_kit', (0.26, 0.08, 0.1), (0, -0.15, 1.02), bevel=0.02, mat=web), 'pelvis')
        else:
            add(pouch('cellbox', (0.26, 0.15, 0.4), (0, -0.22, 1.32), paint('box', '#3A3E40', scale=0.25, rough=0.55, wear=0.45), None), 'spine_03')
            add(cyl('tripod_fold', 0.035, 0.55, (0, -0.32, 1.25), 'Z', 12, mat=gunmetal()), 'spine_03')
        return g, P
    # Nova Directive: graphite suit + pale ceramic plates + cyan strips
    andro = uid == 'T01'   # Pulse Trooper restyled as an android (approved 2026-11-06): synthetic body, joint actuators, faceless head
    suit = paint('synth', '#1C2024', scale=0.15, rough=0.42, metal=0.45, wear=0.1, panel=0.0) if andro else paint('suit', '#2A2D30', scale=0.15, rough=0.75, metal=0.05, wear=0.15, panel=0.0)
    shell = paint('shell', '#C9CDCF' if uid == 'T01' else '#B9BEC1', scale=0.25, rough=0.4, metal=0.15, wear=0.3, wear_col='#6E7275')
    dark = paint('dark', '#3A3D40', scale=0.2, rough=0.55, metal=0.3, wear=0.25); gl = glow('cyan', P['glow'], 5.0); visor = glass('GLASS', '#103C40')
    body = body_mesh('body_core', J, radii(baggy=0.93 if andro else 1.0, armour=0.0 if andro else 0.01), suit); add(body)
    if andro:
        act = gunmetal()
        add([ball('head_shell', 0.112, (0, 0.012, 1.7), scale=(0.84, 1.0, 1.12), seg=16, rings=10, mat=shell),
             wedge('faceplate', (0.15, 0.04, 0.14), (0, 0.098, 1.69), moves=[('FT', (0, -0.012, 0)), ('FD', (0, -0.01, 0.01))], bevel=0.018, seg=3, mat=visor),
             bx('visor_slit', (0.11, 0.008, 0.012), (0, 0.124, 1.708), mat=gl), cyl('antenna', 0.006, 0.12, (-0.06, -0.03, 1.84), 'Z', 6, mat=dark)]
            + [cyl(f'sensor_{n}', 0.03, 0.016, (sx * 0.094, 0.0, 1.69), 'X', 14, mat=shell) for n, sx in (('L', -1), ('R', 1))]
            + [cyl(f'sensor_ring_{n}', 0.014, 0.018, (sx * 0.095, 0.0, 1.69), 'X', 10, mat=gl) for n, sx in (('L', -1), ('R', 1))], 'head')
        add([cyl(f'neck_ring{k}', 0.042 - 0.003 * k, 0.016, (0, 0.006, 1.525 + 0.028 * k), 'Z', 14, mat=act) for k in range(3)], 'neck')
        for n, sx in (('R', 1), ('L', -1)):   # exposed actuators at hips, knees, elbows and the left shoulder
            add(cyl(f'hip_act_{n}', 0.055, 0.09, J[f'thigh_{n}'], 'X', 14, mat=act), f'thigh_{n}')
            add([cyl(f'knee_act_{n}', 0.05, 0.1, J[f'shin_{n}'], 'X', 14, mat=act), cyl(f'knee_led_{n}', 0.018, 0.104, J[f'shin_{n}'], 'X', 8, mat=gl)], f'shin_{n}')
            add(cyl(f'elbow_act_{n}', 0.038, 0.07, J[f'forearm_{n}'], 'X', 12, mat=act), f'forearm_{n}')
        add(cyl('shoulder_act_L', 0.046, 0.08, J['upperarm_L'], 'X', 12, mat=act), 'upperarm_L')
    if not andro: add(ball('helmet', 0.128, (0, 0.0, 1.7), scale=(0.86, 1.08, 1.02), seg=16, rings=10, mat=shell), 'head')
    if not andro:
        add(wedge('jaw', (0.15, 0.1, 0.06), (0, 0.075, 1.6), moves=[('FD', (0, -0.025, 0.012))], bevel=0.022, mat=shell), 'head')
        add(wedge('visor', (0.2, 0.06, 0.06), (0, 0.118, 1.685), moves=[('FT', (0, -0.008, 0)), ('FD', (0, -0.008, 0))], bevel=0.02, seg=3, mat=visor), 'head')
        add([bx('visor_glow', (0.13, 0.01, 0.01), (0, 0.149, 1.688), mat=gl)], 'head')
        add(bx('crest', (0.03, 0.2, 0.02), (0, 0.0, 1.828), bevel=0.008, mat=dark), 'head')
        add(cyl('helmet_ear_L', 0.03, 0.02, (-0.108, -0.01, 1.67), 'X', 12, mat=shell), 'head'); add(cyl('helmet_ear_R', 0.03, 0.02, (0.108, -0.01, 1.67), 'X', 12, mat=shell), 'head')
    if uid == 'T02': add([cyl('crown', 0.05, 0.04, (0, -0.01, 1.82), 'Z', 16, mat=dark), ball('crown_eye', 0.022, (0, 0.02, 1.83), mat=gl)], 'head')
    add(wedge('chest', (0.4, 0.3, 0.26), (0, 0.01, 1.34), moves=[('FD', (0, -0.03, 0)), ('TB', (0, 0.02, 0)), ('TF', (0, -0.03, -0.01))], bevel=0.05, seg=3, mat=shell), 'spine_03')
    if andro: add([wedge(f'rib{k}', (0.27 - 0.015 * k, 0.21, 0.026), (0, 0.012, 1.12 + 0.045 * k), bevel=0.01, mat=dark) for k in range(3)], 'spine_01')   # segmented spine section
    else: add(wedge('abdomen', (0.3, 0.25, 0.1), (0, 0.01, 1.17), bevel=0.035, seg=2, mat=dark), 'spine_01')
    add([wedge('abplate', (0.16, 0.04, 0.09), (0, 0.13, 1.17), bevel=0.012, mat=shell), bx('chest_strip', (0.01, 0.012, 0.09), (0.1, 0.165, 1.35), mat=gl), wedge('collar', (0.2, 0.16, 0.05), (0, 0.0, 1.49), bevel=0.02, mat=dark)], 'spine_03')
    add(text_mark('chest_mark', 'V', 0.07, (0, 0.168, 1.4), rot=(math.pi / 2, 0, math.pi), mat=dark), 'spine_03')
    if uid == 'T01':
        add([bx('battery', (0.12, 0.05, 0.26), (0, -0.14, 1.3), bevel=0.015, mat=dark), bx('bat_glow', (0.03, 0.01, 0.12), (0, -0.168, 1.3), mat=gl)], 'spine_03')
        for k in range(2): add(bx(f'slot{k}', (0.08, 0.008, 0.012), (0, -0.166, 1.2 + k * 0.03), mat=gunmetal()), 'spine_03')
        sp = Vector(J['upperarm_R']).lerp(Vector(J['forearm_R']), 0.15)
        pad = wedge('shoulder_R', (0.16, 0.18, 0.07), tuple(sp + Vector((0.02, 0, 0.03))), moves=[('TL', (0.02, 0, -0.01))], bevel=0.02, seg=2, mat=shell); pad.rotation_euler = (0, math.radians(-38), 0); add(pad, 'upperarm_R')
        add(bx('shoulder_strip', (0.01, 0.06, 0.008), tuple(sp + Vector((0.07, 0.03, 0.06))), mat=gl), 'upperarm_R')
        add(text_mark('id_txt', 'T01', 0.045, tuple(sp + Vector((0.095, 0.0, 0.0))), rot=(math.pi / 2, 0, math.radians(90)), mat=dark), 'upperarm_R')
    else:
        add([bx('battery', (0.1, 0.07, 0.38), (0, -0.15, 1.33), bevel=0.015, mat=dark), bx('bat_glow', (0.025, 0.01, 0.26), (0, -0.188, 1.33), mat=gl)], 'spine_03')
        for sx in (-1, 1): add(bx(f'fin{sx}', (0.012, 0.09, 0.3), (sx * 0.075, -0.15, 1.34), bevel=0.004, mat=shell), 'spine_03')
        add(tube('cable', (-0.06, -0.12, 1.2), (-0.17, 0.0, 1.05), 0.012, 8, mat=dark), 'spine_01')
        for n in ('R', 'L'):
            sp = Vector(J[f'upperarm_{n}']).lerp(Vector(J[f'forearm_{n}']), 0.15); pad = wedge(f'shoulder_{n}', (0.13, 0.15, 0.06), tuple(sp + Vector((0.015 if n == 'R' else -0.015, 0, 0.03))), bevel=0.02, mat=shell)
            pad.rotation_euler = (0, math.radians(-38 if n == 'R' else 38), 0); add(pad, f'upperarm_{n}')
    for n in ('R', 'L'):
        add(boot(n, J, dark, gunmetal('sole', '#1C1D1E', wear=0.1), h=0.2, wide=1.05), f'shin_{n}'); add(glove(n, J, dark), f'hand_{n}')
        k, a = Vector(J[f'shin_{n}']), Vector(J[f'foot_{n}'])
        add([wedge(f'shinplate_{n}', (0.08, 0.04, 0.2), tuple(k.lerp(a, 0.4) + Vector((0, 0.06, 0))), bevel=0.012, mat=shell), wedge(f'shinplate2_{n}', (0.075, 0.04, 0.12), tuple(k.lerp(a, 0.75) + Vector((0, 0.055, 0))), bevel=0.012, mat=shell),
             wedge(f'knee_{n}', (0.09, 0.05, 0.08), (k.x, k.y + 0.06, k.z), bevel=0.02, mat=shell)], f'shin_{n}')
        t = Vector(J[f'thigh_{n}']); add(wedge(f'thighplate_{n}', (0.1, 0.05, 0.18), tuple(t.lerp(k, 0.5) + Vector((0, 0.07, 0))), bevel=0.015, mat=shell), f'thigh_{n}')
        f = Vector(J[f'forearm_{n}']); h = Vector(J[f'hand_{n}']); fa = wedge(f'forearmplate_{n}', (0.07, 0.07, 0.14), tuple(f.lerp(h, 0.5)), bevel=0.015, mat=shell); fa.rotation_euler = (0, math.radians(-45 if n == 'R' else 45), 0); add(fa, f'forearm_{n}')
    add(cyl('belt', 0.15, 0.05, (0, 0.0, 1.03), 'Z', 16, mat=dark), 'pelvis')
    for sx in (-1, 1): add(pouch(f'hip{sx}', (0.05, 0.08, 0.1), (sx * 0.155, 0.0, 0.97), dark, None), 'pelvis')
    add(bx('team_stripe', (0.012, 0.05, 0.1), (-0.155, 0.04, 1.33), mat=team(0.2)), 'spine_03')
    return g, P

# ─────────────────────── deployables ───────────────────────
def deployables(uid, root, P):
    out = []
    if uid == 'A01':  # folding shield-case: hinged at ground-front, lies flat (hidden) until deploy
        sh = node('shield', (0, 0.62, 0.0), root)
        case = paint('case', '#3A3F44', scale=0.3, rough=0.55, metal=0.35, wear=0.5)
        body = bx('shield_m', (0.7, 0.09, 0.56), (0, 0.62, 0.3), bevel=0.02, mat=case)
        rib = [bx(f'rib{k}', (0.7, 0.1, 0.03), (0, 0.62, 0.12 + k * 0.17), bevel=0.006, mat=gunmetal()) for k in range(3)]
        leg = [bx(f'sleg{sx}', (0.04, 0.2, 0.04), (sx * 0.3, 0.55, 0.03), bevel=0.006, mat=gunmetal()) for sx in (-1, 1)]
        emb = text_mark('emblem', 'V', 0.22, (0, 0.668, 0.33), rot=(math.pi / 2, 0, math.pi), mat=team(0.3))
        m = join('shield_mesh', [body] + rib + leg + [emb]); attach(m, sh); out.append(sh)
    if uid == 'A02':
        tp = node('tripod', (0, 0.55, 0.0), root); metal = gunmetal('tripod_m', '#2B2E31', scale=0.2)
        head = cyl('tripod_head', 0.06, 0.08, (0, 0.55, 0.6), 'Z', 14, mat=metal); attach(head, tp)
        for k in range(3):
            a = math.radians(90 + 120 * k); lg = node(f'leg_{k}', (0, 0.55, 0.58), tp)
            m = tube(f'leg_{k}_m', (0, 0.55, 0.58), (math.cos(a) * 0.38, 0.55 + math.sin(a) * 0.38, 0.0), 0.016, 8, mat=metal); attach(m, lg)
        out.append(tp)
    return out

# ─────────────────────── poses (previews only; export stays in bind pose) ───────────────────────
def pose_ready(rig, weapon, uid, J):
    """Aim pose: weapon shouldered (or launcher on the shoulder), arms reach the grips with IK."""
    if uid in ('H02', 'A02'):
        weapon.location = (0.17, 0.4, 1.585); weapon.rotation_euler = (math.radians(2), 0, 0)
    elif uid == 'T02':
        weapon.location = (0.07, 0.32, 1.3); weapon.rotation_euler = (math.radians(4), 0, math.radians(4))
    else:
        weapon.location = (0.12, 0.31, 1.44); weapon.rotation_euler = (math.radians(1), 0, math.radians(2))
    bpy.context.view_layer.update()
    tgt = {n: bpy.data.objects[f'grip_{n}'] for n in ('R', 'L')}
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
    for n, sx in (('R', 1), ('L', -1)):
        pole = node(f'_pole_{n}', (sx * 0.6, -0.3, 0.95));
        c = rig.pose.bones[f'forearm_{n}'].constraints.new('IK'); c.target = tgt[n]; c.chain_count = 2; c.pole_target = pole; c.pole_angle = math.radians(-90 if n == 'R' else -90)
        h = rig.pose.bones[f'hand_{n}'].constraints.new('COPY_ROTATION'); h.target = tgt[n]; h.influence = 0.0
    # slight forward lean, torso twisted right so the support hand reaches, and a stance
    rig.pose.bones['spine_02'].rotation_mode = 'XYZ'; rig.pose.bones['spine_02'].rotation_euler = (math.radians(6), math.radians(-12), 0)
    rig.pose.bones['spine_03'].rotation_mode = 'XYZ'; rig.pose.bones['spine_03'].rotation_euler = (0, math.radians(-14), 0)
    rig.pose.bones['neck'].rotation_mode = 'XYZ'; rig.pose.bones['neck'].rotation_euler = (0, math.radians(20), 0)
    rig.pose.bones['thigh_R'].rotation_mode = 'XYZ'; rig.pose.bones['thigh_R'].rotation_euler = (math.radians(-8), 0, math.radians(4))
    rig.pose.bones['thigh_L'].rotation_mode = 'XYZ'; rig.pose.bones['thigh_L'].rotation_euler = (math.radians(10), 0, math.radians(-4))
    bpy.ops.object.mode_set(mode='OBJECT'); bpy.context.view_layer.update()

def clear_pose(rig):
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
    for pb in rig.pose.bones:
        for c in list(pb.constraints): pb.constraints.remove(c)
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        if o.name.startswith('_pole'): bpy.data.objects.remove(o, do_unlink=True)

# ─────────────────────── build ───────────────────────
WEAPON = {'H01': rifle_H01, 'H02': launcher_H02, 'A01': carbine_A01, 'A02': launcher_A02}
SCALE = {'H01': 1.0, 'H02': 1.02, 'A01': 1.0, 'A02': 1.0, 'T01': 1.0, 'T02': 1.02}

def build(uid):
    reset(); J = joints(SCALE[uid]); root = node('root')
    rig = make_rig(J); attach(rig, root)
    gear, P = outfit(uid, J)
    # weights: the core body is auto-weighted along the hierarchy; gear is rigid to its bone (or auto if None)
    parts = []
    for o, bone in gear:
        if o.type != 'MESH': continue
        apply_all(o); lib_apply(o)
        skin_weights(o, rig, J, only=[bone] if bone else None); parts.append(o)
    body = join('body', parts)
    for pnum, p in enumerate(body.data.polygons): p.use_smooth = True
    root['_body'] = body.name
    mod = body.modifiers.new('rig', 'ARMATURE'); mod.object = rig; attach(body, rig)
    gl = bpy.data.materials.get('GLOW_cyan') or glow('cyan', P['glow'], 5.0)
    if uid == 'T01': w = carbine_T01(P, gl)
    elif uid == 'T02': w = lance_T02(P, gl)
    else: w = WEAPON[uid](P)
    attach(w, root)
    # socket nodes
    node('hit', (0, 0, 1.15), root); node('badge', (0, 0, 2.05), root)
    dep = deployables(uid, root, P)
    # carried (bind) placement of the weapon so the GLB opens sensibly: low ready in front of the hips
    w.location = (0.12, 0.25, 1.1); w.rotation_euler = (math.radians(-20), 0, math.radians(8))
    if uid in ('H02', 'A02'): w.location = (0.17, 0.02, 1.58); w.rotation_euler = (0, 0, 0)
    root['joints'] = json.dumps({k: [round(c, 4) for c in v] for k, v in J.items()})
    root['run_loop_s'] = {'H01': 0.8, 'H02': 1.0, 'A01': 0.8, 'A02': 0.9, 'T01': 0.7, 'T02': 0.8}[uid]
    for d in dep: d.hide_render = False
    return root, rig, body, w, J, dep

def fit_budget(uid, body, meshes):
    """Collapse-decimate the skinned body (weights are interpolated) so the visible unit meets its LOD0 triangle budget."""
    budget = SPEC[uid]['budget'][0]; total = tris(meshes); bt = tris([body])
    if total <= budget: return total
    ratio = max(0.45, (budget * 0.98 - (total - bt)) / bt)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    body.select_set(True); bpy.context.view_layer.objects.active = body
    d = body.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_move_to_index(modifier='dec', index=0); bpy.ops.object.modifier_apply(modifier='dec')
    out = tris(meshes); print(f'[{uid}] decimated body {bt} → {tris([body])} tris (ratio {ratio:.2f}); unit {total} → {out}'); return out

def finish_infantry(uid, root, rig, body, w, J, dep, size=1024, samples=16):
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('_')]
    fit_budget(uid, body, meshes)
    t0 = __import__('time').time(); bake(uid, meshes, size, samples); print(f'[{uid}] bake {round(__import__("time").time() - t0)}s')
    from ulib import _clean_materials
    _clean_materials(meshes)
    root['tris'] = tris(meshes)
    print(f'[{uid}] tris {root["tris"]} (LOD0 budget {SPEC[uid]["budget"][0]}), materials', sorted({m.name for o in meshes for m in o.data.materials if m}))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND, uid + '.blend'), compress=True)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in bpy.data.objects:
        if not o.name.startswith('_'): o.select_set(True)
    path = os.path.join(OUT, uid + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=90, export_extras=True, export_animations=False,
                              export_skins=True, export_def_bones=False, export_rest_position_armature=True)
    print(f'[{uid}] exported {path} {os.path.getsize(path) // 1024} KB')
    # combat-ready pose for the dimension check and the preview sheet
    for d in dep: d.hide_render = True; d.hide_viewport = True
    for d in dep:
        for c in d.children_recursive: c.hide_render = True; c.hide_viewport = True
    pose_ready(rig, w, uid, J)
    vis = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('_') and not o.hide_render]
    rep, lo, hi = check_dims(uid, vis)
    root['dims_check'] = json.dumps(rep)
    with open(os.path.join(OUT, uid + '.dims.json'), 'w') as f: json.dump(rep, f)   # measured after export (aim pose), so it ships beside the GLB
    preview_sheet(uid, lo, hi, samples=24)
    return rep

def main(ids):
    for uid in ids:
        root, rig, body, w, J, dep = build(uid)
        finish_infantry(uid, root, rig, body, w, J, dep)

if __name__ == '__main__':
    arg = sys.argv[-1]
    main(['H01', 'H02', 'A01', 'A02', 'T01', 'T02'] if arg == 'all' else arg.split(','))
