"""Rigged infantry: one generator, per-faction gear. Skeleton + rigid-skinned body parts + weapon bone + animation clips
(idle, walk, walk_aim, aim, fire, die). Run: blender-env/bin/python blender/models/humanoid.py [rifleman|contractor|all]"""
import sys, os, math
import bpy, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import *
from mathutils import Vector, Quaternion, Matrix

# bone layout (head, tail), Blender axes: +X forward, +Y left, +Z up; heights in map cells
def bone_layout():
    B = {'root': ((0, 0, 0), (0, 0, 0.12), None), 'hips': ((0, 0, 0.40), (0, 0, 0.48), 'root'), 'spine': ((0, 0, 0.48), (0, 0, 0.56), 'hips'),
         'chest': ((0, 0, 0.56), (0, 0, 0.66), 'spine'), 'neck': ((0, 0, 0.66), (0, 0, 0.70), 'chest'), 'head': ((0, 0, 0.70), (0, 0, 0.80), 'neck'),
         'weapon': ((0.06, -0.05, 0.6), (0.2, -0.05, 0.6), 'chest')}
    for s, n in ((1, 'L'), (-1, 'R')):
        B[f'upper_arm.{n}'] = ((0, s * 0.105, 0.645), (0, s * 0.112, 0.505), 'chest'); B[f'forearm.{n}'] = ((0, s * 0.112, 0.505), (0, s * 0.114, 0.385), f'upper_arm.{n}')
        B[f'hand.{n}'] = ((0, s * 0.114, 0.385), (0, s * 0.114, 0.335), f'forearm.{n}')
        B[f'thigh.{n}'] = ((0, s * 0.052, 0.41), (0, s * 0.052, 0.225), 'hips'); B[f'shin.{n}'] = ((0, s * 0.052, 0.225), (0, s * 0.052, 0.05), f'thigh.{n}')
        B[f'foot.{n}'] = ((0, s * 0.052, 0.05), (0.07, s * 0.052, 0.02), f'shin.{n}')
    return B

def make_rig(B):
    arm = bpy.data.armatures.new('rig'); rig = bpy.data.objects.new('rig', arm); link(rig)
    bpy.context.view_layer.objects.active = rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, p) in B.items():
        eb = arm.edit_bones.new(name); eb.head = h; eb.tail = t; eb.roll = 0
    for name, (h, t, p) in B.items():
        if p: arm.edit_bones[name].parent = arm.edit_bones[p]; arm.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT'); return rig

def tag(o, bone):
    vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE'); return o

def limb(name, a, b, r1, r2, mat, bone, verts=12):
    a, b = Vector(a), Vector(b); d = b - a; o = cyl(name, r1, d.length, (a + b) / 2, verts=verts, r2=r2)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(d.normalized())
    assign(o, mat); apply_transform(o); return tag(o, bone)

def apply_transform(o):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); return o

def part(o, mat, bone):
    assign(o, mat); apply_all(o); apply_transform(o); return tag(o, bone)

def build_body(G):
    """G: gear spec. Returns list of parts tagged with their bone."""
    P = []; m = G['mats']
    # legs, boots, knee pads
    for s, n in ((1, 'L'), (-1, 'R')):
        P.append(limb(f'thigh{n}', (0, s * 0.052, 0.41), (0, s * 0.052, 0.225), 0.042, 0.034, m['cloth'], f'thigh.{n}'))
        P.append(limb(f'shin{n}', (0, s * 0.052, 0.225), (0, s * 0.052, 0.06), 0.032, 0.026, m['cloth'], f'shin.{n}'))
        P.append(part(box(f'knee{n}', (0.03, 0.05, 0.05), (0.03, s * 0.052, 0.225), bevel=0.012), m['gear'], f'shin.{n}'))
        P.append(part(box(f'boot{n}', (0.1, 0.048, 0.05), (0.025, s * 0.052, 0.028), bevel=0.012, taper={'top_front': (-0.02, 0, -0.01)}), m['boot'], f'foot.{n}'))
        # arms, gloves
        P.append(limb(f'uarm{n}', (0, s * 0.105, 0.645), (0, s * 0.112, 0.505), 0.03, 0.026, m['cloth'], f'upper_arm.{n}'))
        P.append(limb(f'farm{n}', (0, s * 0.112, 0.505), (0, s * 0.114, 0.39), 0.025, 0.021, m['cloth'], f'forearm.{n}'))
        P.append(part(box(f'hand{n}', (0.03, 0.032, 0.05), (0, s * 0.114, 0.36), bevel=0.01), m['glove'], f'hand.{n}'))
        P.append(part(sphere(f'shoulder{n}', 0.036, (0, s * 0.105, 0.635), scale=(1, 1, 0.8), seg=12, rings=8), m['vest'] if G.get('pads') else m['cloth'], f'upper_arm.{n}'))
    P.append(part(box('armband', (0.064, 0.012, 0.03), (0, 0.137, 0.58)), m['team'], 'upper_arm.L'))
    if G.get('holster'): P.append(part(box('holster', (0.05, 0.03, 0.07), (0.0, -0.095, 0.34), bevel=0.008), m['gear'], 'thigh.R'))
    # pelvis, belt, torso, vest
    P.append(part(box('pelvis', (0.1, 0.15, 0.09), (0, 0, 0.43), bevel=0.02, seg=3), m['cloth'], 'hips'))
    P.append(part(box('belt', (0.11, 0.16, 0.025), (0, 0, 0.475), bevel=0.006), m['gear'], 'hips'))
    for i, y in enumerate((-0.05, 0.05)): P.append(part(box(f'bpouch{i}', (0.03, 0.04, 0.035), (0.05, y, 0.465), bevel=0.006), m['gear'], 'hips'))
    P.append(part(box('abdomen', (0.095, 0.14, 0.09), (0, 0, 0.52), bevel=0.02, seg=3), m['cloth'], 'spine'))
    P.append(part(box('torso', (0.11, 0.19, 0.12), (0, 0, 0.6), bevel=0.025, seg=3, taper={'top': (0, 0, 0)}), m['cloth'], 'chest'))
    P.append(part(box('vest', (0.13, 0.18, 0.13), (0.005, 0, 0.595), bevel=0.018, seg=2), m['vest'], 'chest'))
    for i in range(3): P.append(part(box(f'mag{i}', (0.028, 0.035, 0.05), (0.075, -0.05 + i * 0.05, 0.565), bevel=0.006), m['gear'], 'chest'))
    if G.get('radio'): P.append(part(box('radio', (0.03, 0.04, 0.06), (0.06, 0.07, 0.635), bevel=0.006), m['gear'], 'chest'))
    if G.get('pack') == 'ruck':
        P.append(part(box('ruck', (0.07, 0.15, 0.15), (-0.1, 0, 0.6), bevel=0.025, seg=3), m['gear'], 'chest'))
        P.append(part(cyl('bedroll', 0.025, 0.15, (-0.11, 0, 0.69), (math.pi / 2, 0, 0), verts=10), m['vest'], 'chest'))
    elif G.get('pack') == 'slim':
        P.append(part(box('slimpack', (0.05, 0.13, 0.12), (-0.09, 0, 0.6), bevel=0.02, seg=3), m['gear'], 'chest'))
        P.append(part(cyl('antenna', 0.003, 0.18, (-0.1, 0.05, 0.73), verts=6), m['metal'], 'chest'))
        P.append(part(box('packlight', (0.006, 0.1, 0.012), (-0.065, 0, 0.64)), m['glow'], 'chest'))
    # neck, head, helmet
    P.append(limb('neck', (0, 0, 0.66), (0, 0, 0.71), 0.022, 0.022, m['skin'], 'neck'))
    P.append(part(sphere('head', 0.048, (0.005, 0, 0.745), scale=(1.05, 0.95, 1.1), seg=16, rings=10), m['skin'], 'head'))
    if G['helmet'] == 'combat':
        P.append(part(sphere('helmet', 0.058, (0, 0, 0.76), scale=(1.1, 1.0, 0.9), seg=18, rings=10, cut_below=0.0), m['vest'], 'head'))
        P.append(part(cyl('rim', 0.064, 0.008, (0, 0, 0.758), verts=18), m['vest'], 'head'))
        P.append(part(box('goggles', (0.02, 0.07, 0.016), (0.055, 0, 0.792), bevel=0.004), m['glass'], 'head'))
        P.append(part(box('hstripe', (0.05, 0.006, 0.012), (-0.01, 0.06, 0.79)), m['team'], 'head'))
    else:  # full-face tactical helmet with visor
        P.append(part(sphere('helmet', 0.06, (0, 0, 0.752), scale=(1.12, 1.0, 1.05), seg=18, rings=10), m['vest'], 'head'))
        P.append(part(box('visor', (0.02, 0.085, 0.03), (0.062, 0, 0.756), bevel=0.006, taper={'top_front': (-0.01, 0, 0)}), m['glow'], 'head'))
        P.append(part(box('hstripe', (0.08, 0.006, 0.012), (-0.01, 0.065, 0.776)), m['team'], 'head'))
        P.append(part(box('mic', (0.03, 0.01, 0.01), (0.05, -0.05, 0.72)), m['metal'], 'head'))
    # weapon, modelled pointing +X in the aim position, bound to the weapon bone
    W = G['weapon']; wy, wz = -0.05, 0.6; w = []
    w.append(box('receiver', (0.16, 0.03, 0.045), (0.14, wy, wz), bevel=0.006))
    w.append(cyl('barrel', 0.008, W['barrel'], (0.22 + W['barrel'] / 2, wy, wz + 0.008), (0, math.pi / 2, 0), verts=10))
    w.append(box('handguard', (0.1, 0.032, 0.034), (0.25, wy, wz + 0.004), bevel=0.006))
    w.append(box('magazine', (0.03, 0.022, 0.07), (0.15, wy, wz - 0.05), rot=(0, 0.25, 0), bevel=0.004))
    w.append(box('grip', (0.025, 0.02, 0.05), (0.09, wy, wz - 0.04), rot=(0, -0.35, 0), bevel=0.004))
    w.append(box('stock', (0.12, 0.024, 0.04), (0.0, wy, wz - 0.008), bevel=0.006, taper={'bot_back': (0, 0, 0.015)}))
    w.append(cyl('optic', 0.014, 0.07, (0.15, wy, wz + 0.042), (0, math.pi / 2, 0), verts=12))
    if W.get('suppressor'): w.append(cyl('suppressor', 0.014, 0.08, (0.22 + W['barrel'] + 0.04, wy, wz + 0.008), (0, math.pi / 2, 0), verts=12))
    if W.get('launcher'): w.append(cyl('ugl', 0.016, 0.1, (0.24, wy, wz - 0.03), (0, math.pi / 2, 0), verts=12))
    if W.get('rail_light'): w.append(box('wlight', (0.03, 0.012, 0.012), (0.27, wy - 0.022, wz), bevel=0.003))
    for o in w: P.append(part(o, m['metal'] if o.name in ('barrel', 'suppressor', 'optic') else m['weapon'], 'weapon'))
    if W.get('rail_light'): P.append(part(box('wlens', (0.004, 0.01, 0.01), (0.287, wy - 0.022, wz)), m['glow'], 'weapon'))
    return P, (0.22 + W['barrel'] + (0.08 if W.get('suppressor') else 0.0), wy, wz + 0.008)

# ───────── animation ─────────
REST = {}
def qworld(rig, bone, axis, angle):
    R = rig.data.bones[bone].matrix_local.to_quaternion(); q = Quaternion(axis, angle); return R.inverted() @ q @ R

def key_pose(rig, frame, pose, root_loc=(0, 0, 0), root_rot=None):
    """pose: {bone: [(axis, angle), ...]} rotations about world axes (composed in order)."""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; q = Quaternion()
        for axis, ang in pose.get(pb.name, []): q = qworld(rig, pb.name, axis, ang) @ q
        if pb.name == 'root' and root_rot: q = qworld(rig, 'root', root_rot[0], root_rot[1]) @ q
        pb.rotation_quaternion = q; pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.location = Vector((0, 0, 0))
        if pb.name == 'root':
            Rb = rig.data.bones['root'].matrix_local.to_3x3(); pb.location = Rb.inverted() @ Vector(root_loc)
        if pb.name == 'weapon' and 'weapon_loc' in pose:
            Rb = rig.data.bones['weapon'].matrix_local.to_3x3(); pb.location = Rb.inverted() @ Vector(pose['weapon_loc'])
        pb.keyframe_insert('location', frame=frame)

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
def arms_low():  # low ready: rifle angled down across the body
    return {'upper_arm.R': [(Y, -0.55), (Z, 0.35)], 'forearm.R': [(Y, -1.0)], 'upper_arm.L': [(Y, -0.85), (Z, -0.45)], 'forearm.L': [(Y, -0.9), (Z, -0.4)], 'weapon': [(Y, 0.55), (Z, 0.35)]}
def arms_aim():  # rifle shouldered, level, pointing forward
    return {'upper_arm.R': [(Y, -1.15), (Z, 0.55)], 'forearm.R': [(Y, -0.75), (Z, 0.7)], 'upper_arm.L': [(Y, -1.4), (Z, -0.3)], 'forearm.L': [(Y, -0.25), (Z, -0.35)], 'weapon': [], 'head': [(Y, 0.08)]}
def merge(*ps):
    out = {}
    for p in ps:
        for k, v in p.items(): out[k] = out.get(k, []) + v if isinstance(v, list) else v
    return out
def legs_walk(t):
    a = math.sin(t * 2 * math.pi); b = math.sin(t * 2 * math.pi + math.pi)
    knee = lambda s: max(0.0, -math.sin(s)) * 0.9 + 0.12
    return {'thigh.L': [(Y, -a * 0.5)], 'thigh.R': [(Y, -b * 0.5)], 'shin.L': [(Y, knee(t * 2 * math.pi + 0.6))], 'shin.R': [(Y, knee(t * 2 * math.pi + math.pi + 0.6))],
            'foot.L': [(Y, -a * 0.15)], 'foot.R': [(Y, -b * 0.15)], 'hips': [(Z, a * 0.08)], 'chest': [(Z, -a * 0.1), (Y, -0.08)]}

def new_action(rig, name):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    if not rig.animation_data: rig.animation_data_create()
    rig.animation_data.action = act; return act

def animate(rig, fps=24):
    sc = bpy.context.scene; sc.render.fps = fps
    # idle: breathing, low ready, small weight shift
    new_action(rig, 'idle')
    for f in range(0, 49, 6):
        t = f / 48; br = math.sin(t * 2 * math.pi)
        key_pose(rig, f, merge(arms_low(), {'chest': [(Y, -0.03 - br * 0.025)], 'head': [(Z, math.sin(t * 2 * math.pi) * 0.12)], 'hips': [(X, br * 0.02)]}), (0, 0, br * 0.003))
    # walk: legs swing, hips bob, rifle at low ready
    new_action(rig, 'walk')
    for f in range(0, 25, 3):
        t = f / 24; key_pose(rig, f, merge(arms_low(), legs_walk(t)), (0, 0, abs(math.sin(t * 2 * math.pi)) * 0.018 - 0.006))
    # walk_aim: legs walk, rifle shouldered, torso steady
    new_action(rig, 'walk_aim')
    for f in range(0, 25, 3):
        t = f / 24; lw = legs_walk(t); lw['chest'] = [(Y, -0.12)]; key_pose(rig, f, merge(arms_aim(), lw), (0, 0, abs(math.sin(t * 2 * math.pi)) * 0.014 - 0.008))
    # aim: braced stance, slight sway
    new_action(rig, 'aim')
    for f in range(0, 25, 6):
        t = f / 24; s = math.sin(t * 2 * math.pi) * 0.015
        key_pose(rig, f, merge(arms_aim(), {'thigh.L': [(Y, -0.25)], 'thigh.R': [(Y, 0.18)], 'shin.L': [(Y, 0.3)], 'shin.R': [(Y, 0.15)], 'chest': [(Y, -0.12 + s)], 'hips': [(Z, 0.15)]}), (0, 0, -0.012))
    # fire: recoil through the shoulders, weapon kicks back and up, recovers
    new_action(rig, 'fire')
    stance = {'thigh.L': [(Y, -0.25)], 'thigh.R': [(Y, 0.18)], 'shin.L': [(Y, 0.3)], 'shin.R': [(Y, 0.15)], 'hips': [(Z, 0.15)]}
    for f, k in ((0, 0), (1, 1.0), (3, 0.45), (6, 0)):
        p = merge(arms_aim(), stance, {'chest': [(Y, -0.12 + k * 0.08)], 'weapon': [(Y, -k * 0.12)], 'upper_arm.R': [(Y, k * 0.1)]}); p['weapon_loc'] = (-k * 0.025, 0, 0)
        key_pose(rig, f, p, (0, 0, -0.012))
    # die: knocked backwards, knees fold, weapon falls
    new_action(rig, 'die')
    for f, k in ((0, 0), (4, 0.25), (10, 0.65), (16, 1.0), (22, 1.0)):
        p = {'thigh.L': [(Y, -0.6 * k)], 'thigh.R': [(Y, -0.3 * k)], 'shin.L': [(Y, 1.0 * k)], 'shin.R': [(Y, 0.6 * k)], 'chest': [(Y, 0.3 * k)], 'head': [(Y, 0.4 * k)],
             'upper_arm.L': [(Y, -0.4 - 1.0 * k), (Z, -0.6 * k)], 'upper_arm.R': [(Y, -0.5 + 0.5 * k), (X, -0.8 * k)], 'forearm.L': [(Y, -0.6)], 'forearm.R': [(Y, -0.4)], 'weapon': [(Y, 1.2 * k), (X, 0.8 * k)]}
        p['weapon_loc'] = (0.05 * k, -0.1 * k, -0.25 * k)
        key_pose(rig, f, p, (-0.05 * k, 0, 0.0 + 0.015 * math.sin(k * math.pi)), root_rot=(Y, -1.5 * (k ** 1.3)))
    for act in bpy.data.actions:
        for fc in act.fcurves if hasattr(act, 'fcurves') else []:
            for kp in fc.keyframe_points: kp.interpolation = 'BEZIER' if act.name != 'fire' else 'LINEAR'
    rig.animation_data.action = bpy.data.actions['idle']

def build(kind):
    reset()
    if kind == 'rifleman':
        G = {'helmet': 'combat', 'pack': 'ruck', 'radio': True, 'pads': False, 'holster': True, 'weapon': {'barrel': 0.13, 'launcher': False, 'rail_light': False},
             'mats': {'cloth': paint_mat('fatigues', (0.24, 0.26, 0.15), rough=0.9, metal=0, grime=0.5, wear=0.1, camo={'c1': (0.33, 0.29, 0.18), 'c2': (0.13, 0.15, 0.09), 'scale': 9, 't1': 0.5, 't2': 0.62}, noise_scale=30),
                      'vest': paint_mat('vest', (0.30, 0.29, 0.19), rough=0.85, metal=0, grime=0.55, wear=0.15, noise_scale=26), 'gear': paint_mat('gear', (0.17, 0.17, 0.11), rough=0.85, grime=0.4, wear=0.15),
                      'boot': paint_mat('boot', (0.09, 0.07, 0.05), rough=0.8, grime=0.5, wear=0.2), 'glove': paint_mat('glove', (0.12, 0.1, 0.07), rough=0.8, grime=0.3, wear=0.1),
                      'skin': paint_mat('skin', (0.62, 0.45, 0.33), rough=0.6, grime=0.2, wear=0.0), 'weapon': paint_mat('weapon', (0.09, 0.09, 0.08), rough=0.55, metal=0.5, grime=0.3, wear=0.5),
                      'metal': paint_mat('gunmetal', (0.06, 0.06, 0.06), rough=0.4, metal=0.8, grime=0.2, wear=0.4), 'team': flat_mat('TEAM', (1, 1, 1), 0.5),
                      'glass': flat_mat('GLASS', (0.05, 0.08, 0.1), 0.1, 0.2), 'glow': flat_mat('GLOW', (0.9, 0.8, 0.5), 0.3, emit=(1, 0.8, 0.4), strength=4)}}
        out = 'cmp_rifleman'
    else:
        G = {'helmet': 'tactical', 'pack': 'slim', 'radio': False, 'pads': True, 'holster': True, 'weapon': {'barrel': 0.08, 'suppressor': True, 'rail_light': True},
             'mats': {'cloth': paint_mat('suit', (0.06, 0.06, 0.07), rough=0.55, metal=0.15, grime=0.35, wear=0.25, panel=0, noise_scale=40),
                      'vest': paint_mat('plates', (0.11, 0.11, 0.13), rough=0.35, metal=0.45, grime=0.35, wear=0.4, wear_col=(0.6, 0.6, 0.65)), 'gear': paint_mat('gear', (0.05, 0.05, 0.055), rough=0.6, grime=0.3, wear=0.2),
                      'boot': paint_mat('boot', (0.04, 0.04, 0.045), rough=0.5, grime=0.3, wear=0.25), 'glove': paint_mat('glove', (0.05, 0.05, 0.055), rough=0.5, grime=0.2, wear=0.2),
                      'skin': paint_mat('skin', (0.55, 0.4, 0.3), rough=0.6, grime=0.2, wear=0.0), 'weapon': paint_mat('weapon', (0.12, 0.12, 0.13), rough=0.35, metal=0.6, grime=0.2, wear=0.5),
                      'metal': paint_mat('gunmetal', (0.05, 0.05, 0.05), rough=0.3, metal=0.85, grime=0.15, wear=0.3), 'team': flat_mat('TEAM', (1, 1, 1), 0.4),
                      'glass': flat_mat('GLASS', (0.05, 0.05, 0.08), 0.1, 0.3), 'glow': flat_mat('GLOW', (1.0, 0.25, 0.7), 0.3, emit=(1.0, 0.18, 0.65), strength=6)}}
        out = 'hlx_contractor'
    rig = make_rig(bone_layout()); parts, muzzle = build_body(G)
    body = join('body', parts); shade(body, 40)
    body.parent = rig; mod = body.modifiers.new('arm', 'ARMATURE'); mod.object = rig
    bake_atlas([body], out + '_tex', 1024, samples=16)
    # muzzle marker parented to the weapon bone
    mz = bpy.data.objects.new('muzzle', None); link(mz); mz.parent = rig; mz.parent_type = 'BONE'; mz.parent_bone = 'weapon'
    bpy.context.view_layer.update(); wb = rig.data.bones['weapon']; mz.matrix_world = Matrix.Translation(Vector(muzzle))
    animate(rig)
    print('tris', tris([body]))
    rig.animation_data.action = bpy.data.actions['aim']; bpy.context.scene.frame_set(0)
    preview(os.path.join(PREV, out + '_aim.png'), target=(0.05, 0, 0.42), dist=1.9, azim=-35, elev=15, size=520)
    rig.animation_data.action = bpy.data.actions['walk']; bpy.context.scene.frame_set(6)
    preview(os.path.join(PREV, out + '_walk.png'), target=(0.05, 0, 0.42), dist=1.9, azim=-90, elev=10, size=520)
    rig.animation_data.action = bpy.data.actions['die']; bpy.context.scene.frame_set(22)
    preview(os.path.join(PREV, out + '_die.png'), target=(-0.2, 0, 0.15), dist=2.0, azim=-60, elev=25, size=520)
    rig.animation_data.action = None
    for pb in rig.pose.bones: pb.rotation_quaternion = Quaternion(); pb.location = Vector()
    export(out, [rig, body, mz], anims=True)

if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'rifleman'
    for k in (['rifleman', 'contractor'] if which == 'all' else [which]): build(k)
