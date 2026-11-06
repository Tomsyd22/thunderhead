"""Lattice drones. Scuttler: six-legged swarm drone, rigged (body, head, gun, 3 bones per leg) with clips
idle / walk (tripod gait) / aim / fire / die. Run: blender-env/bin/python blender/models/drones.py [scuttler]"""
import sys, os, math
import bpy, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import *
from humanoid import make_rig, tag, part, limb, qworld, new_action
from mathutils import Vector, Quaternion, Matrix

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
# six legs: angle from +X (forward), counter-clockwise; left side is +Y
LEGS = [('FL', 40), ('ML', 92), ('RL', 142), ('FR', -40), ('MR', -92), ('RR', -142)]
TRI_A = ('FL', 'MR', 'RL'); HIP_R, HIP_Z = 0.1, 0.2

def leg_points(a):
    d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
    hip = d * HIP_R + Z * HIP_Z; knee0 = d * (HIP_R + 0.07) + Z * 0.23; knee = d * (HIP_R + 0.2) + Z * 0.33; foot = d * (HIP_R + 0.36) + Z * 0.0
    return d, hip, knee0, knee, foot

def bones():
    B = {'root': ((0, 0, 0), (0, 0, 0.08), None), 'body': ((0, 0, HIP_Z), (0, 0, HIP_Z + 0.1), 'root'),
         'head': ((0.13, 0, 0.22), (0.2, 0, 0.22), 'body'), 'weapon': ((0.16, 0, 0.17), (0.26, 0, 0.17), 'head')}
    for n, a in LEGS:
        d, hip, k0, k, f = leg_points(a)
        B[f'coxa.{n}'] = (tuple(hip), tuple(k0), 'body'); B[f'femur.{n}'] = (tuple(k0), tuple(k), f'coxa.{n}'); B[f'tibia.{n}'] = (tuple(k), tuple(f), f'femur.{n}')
    return B

def seg(name, a, b, r1, r2, mat, bone, verts=10):
    return limb(name, tuple(a), tuple(b), r1, r2, mat, bone, verts)

def build_body(m):
    P = []
    # carapace: flattened faceted shell, lower belly, rear power cell
    sh = sphere('shell', 0.15, (0, 0, HIP_Z + 0.02), scale=(1.25, 1.0, 0.5), seg=10, rings=6); P.append(part(sh, m['shell'], 'body'))
    P.append(part(sphere('belly', 0.12, (0, 0, HIP_Z - 0.02), scale=(1.15, 0.95, 0.45), seg=14, rings=8), m['dark'], 'body'))
    P.append(part(cyl('ring', 0.15, 0.025, (0, 0, HIP_Z), verts=24, r2=0.155), m['dark'], 'body'))
    P.append(part(box('spine', (0.22, 0.03, 0.03), (-0.02, 0, HIP_Z + 0.09), bevel=0.01), m['dark'], 'body'))
    for s in (1, -1):
        P.append(part(box(f'team{s}', (0.12, 0.04, 0.012), (0.0, s * 0.075, HIP_Z + 0.07), rot=(s * 0.45, 0, 0), bevel=0.004), m['team'], 'body'))
        P.append(part(box(f'seam{s}', (0.2, 0.006, 0.008), (-0.01, s * 0.112, HIP_Z + 0.045), rot=(s * 0.7, 0, 0)), m['glow'], 'body'))
    cell = cyl('cell', 0.055, 0.12, (-0.2, 0, HIP_Z + 0.02), (0, math.pi / 2, 0), verts=12, r2=0.045, bevel=0.006); P.append(part(cell, m['shell'], 'body'))
    for i in range(3): P.append(part(cyl(f'cellring{i}', 0.058, 0.008, (-0.17 - i * 0.03, 0, HIP_Z + 0.02), (0, math.pi / 2, 0), verts=12), m['glow'], 'body'))
    P.append(part(cyl('ant', 0.004, 0.14, (-0.12, 0.05, HIP_Z + 0.14), (0.3, -0.3, 0), verts=5), m['dark'], 'body'))
    # hip sockets
    for n, a in LEGS:
        d, hip, k0, k, f = leg_points(a)
        P.append(part(sphere(f'sock{n}', 0.03, tuple(hip), seg=10, rings=6), m['dark'], f'coxa.{n}'))
        P.append(seg(f'cx{n}', hip, k0, 0.022, 0.02, m['shell'], f'coxa.{n}'))
        P.append(part(sphere(f'kn0{n}', 0.024, tuple(k0), seg=10, rings=6), m['dark'], f'femur.{n}'))
        P.append(seg(f'fe{n}', k0, k, 0.022, 0.016, m['shell'], f'femur.{n}'))
        P.append(part(box(f'fep{n}', (0.012, 0.03, 0.03), tuple((k0 + k) / 2 + Z * 0.012), bevel=0.004), m['team'] if n in ('FL', 'FR') else m['dark'], f'femur.{n}'))
        P.append(part(sphere(f'kn{n}', 0.022, tuple(k), seg=10, rings=6), m['dark'], f'tibia.{n}'))
        P.append(seg(f'ti{n}', k, k + (f - k) * 0.85, 0.016, 0.009, m['shell'], f'tibia.{n}'))
        P.append(seg(f'claw{n}', k + (f - k) * 0.85, f, 0.009, 0.002, m['metal'], f'tibia.{n}', verts=6))
        P.append(part(box(f'kl{n}', (0.008, 0.008, 0.008), tuple(k + Z * 0.02)), m['glow'], f'tibia.{n}'))
    # head: sensor pod with a cluster of eyes
    P.append(part(sphere('head', 0.07, (0.17, 0, 0.22), scale=(1.1, 1.0, 0.75), seg=16, rings=10), m['shell'], 'head'))
    P.append(part(box('brow', (0.06, 0.1, 0.02), (0.2, 0, 0.255), rot=(0, 0.25, 0), bevel=0.006), m['dark'], 'head'))
    for i, (y, z, r) in enumerate(((0.0, 0.23, 0.018), (0.032, 0.235, 0.012), (-0.032, 0.235, 0.012), (0.05, 0.215, 0.008), (-0.05, 0.215, 0.008))):
        P.append(part(sphere(f'eye{i}', r, (0.24 - abs(y) * 0.35, y, z), seg=10, rings=6), m['glow'], 'head'))
    # needle gun under the head
    w = [box('gunbody', (0.08, 0.035, 0.03), (0.2, 0, 0.17), bevel=0.006), cyl('needle', 0.006, 0.09, (0.285, 0, 0.17), (0, math.pi / 2, 0), verts=8),
         cyl('shroud', 0.014, 0.04, (0.25, 0, 0.17), (0, math.pi / 2, 0), verts=10)]
    for o in w: P.append(part(o, m['metal'] if o.name == 'needle' else m['dark'], 'weapon'))
    P.append(part(box('mag', (0.03, 0.02, 0.025), (0.18, 0.03, 0.155), bevel=0.004), m['glow'], 'weapon'))
    return P, (0.335, 0, 0.17)

# ───────── animation ─────────
def key(rig, frame, pose, root_loc=(0, 0, 0), root_rot=None, wloc=None):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; q = Quaternion()
        for axis, ang in pose.get(pb.name, []): q = qworld(rig, pb.name, axis, ang) @ q
        if pb.name == 'root' and root_rot:
            for axis, ang in root_rot: q = qworld(rig, 'root', axis, ang) @ q
        pb.rotation_quaternion = q; pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.location = Vector()
        if pb.name == 'root': pb.location = rig.data.bones['root'].matrix_local.to_3x3().inverted() @ Vector(root_loc)
        if pb.name == 'weapon' and wloc: pb.location = rig.data.bones['weapon'].matrix_local.to_3x3().inverted() @ Vector(wloc)
        pb.keyframe_insert('location', frame=frame)

def leg_pose(n, a, swing, lift, curl=0.0):
    """swing>0 moves the foot forward; lift raises it; curl folds the tibia under."""
    d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)); t = Z.cross(d)
    sgn = 1 if a > 0 else -1
    return {f'coxa.{n}': [(Z, -swing * sgn)], f'femur.{n}': [(t, -lift)], f'tibia.{n}': [(t, lift * 0.6 + curl)]}

def gait(phase, amp=0.32, lift=0.42):
    p = {}
    for n, a in LEGS:
        ph = phase + (0 if n in TRI_A else math.pi)
        p.update(leg_pose(n, a, math.sin(ph) * amp, max(0.0, math.cos(ph)) * lift))
    return p

def animate(rig):
    bpy.context.scene.render.fps = 24
    new_action(rig, 'idle')  # breathing hover of the shell, head scans, a leg taps
    for f in range(0, 49, 6):
        t = f / 48; s = math.sin(t * 2 * math.pi)
        p = {'body': [(Y, s * 0.03)], 'head': [(Z, math.sin(t * 4 * math.pi) * 0.35), (Y, -0.05)]}
        p.update(leg_pose('FL', 40, 0, max(0, math.sin(t * 2 * math.pi * 2)) * 0.25 if t < 0.5 else 0))
        key(rig, f, p, (0, 0, s * 0.006))
    new_action(rig, 'walk')  # alternating tripod gait, body bobs twice per cycle
    for f in range(0, 17, 2):
        t = f / 16; p = gait(t * 2 * math.pi); p['body'] = [(X, math.sin(t * 2 * math.pi) * 0.05), (Y, 0.04)]
        p['head'] = [(Z, math.sin(t * 2 * math.pi) * 0.08)]
        key(rig, f, p, (0, 0, abs(math.sin(t * 2 * math.pi)) * 0.012 - 0.004))
    new_action(rig, 'aim')  # crouched, legs splayed, head locked forward, gun tracking jitter
    for f in range(0, 25, 6):
        t = f / 24; p = {'body': [(Y, 0.1)], 'head': [(Y, 0.08), (Z, math.sin(t * 2 * math.pi) * 0.04)]}
        for n, a in LEGS: p.update(leg_pose(n, a, 0, -0.18, 0.1))
        key(rig, f, p, (0, 0, -0.03))
    new_action(rig, 'fire')  # needle burst: gun kicks back, body jolts
    for f, k in ((0, 0), (1, 1.0), (2, 0.3), (3, 0.9), (5, 0)):
        p = {'body': [(Y, 0.1 - k * 0.06)], 'head': [(Y, 0.08 - k * 0.1)], 'weapon': [(Y, -k * 0.15)]}
        for n, a in LEGS: p.update(leg_pose(n, a, 0, -0.18, 0.1))
        key(rig, f, p, (-k * 0.01, 0, -0.03), wloc=(-k * 0.03, 0, 0))
    new_action(rig, 'die')  # legs spasm and curl inward, shell drops and rolls on its side
    for f, k in ((0, 0), (3, 0.2), (7, 0.55), (12, 0.9), (16, 1.0), (22, 1.0)):
        p = {'head': [(Y, 0.5 * k)], 'weapon': [(Y, 0.6 * k)]}
        for i, (n, a) in enumerate(LEGS):
            twitch = math.sin(k * 18 + i * 1.7) * 0.25 * (1 - k)
            p.update(leg_pose(n, a, twitch, 0.9 * k, 1.4 * k))
        key(rig, f, p, (0, 0, -0.15 * k + 0.03 * math.sin(k * math.pi)), root_rot=[(X, 0.7 * k ** 1.5)])
    for act in bpy.data.actions:
        for fc in getattr(act, 'fcurves', []):
            for kp in fc.keyframe_points: kp.interpolation = 'LINEAR' if act.name == 'fire' else 'BEZIER'
    rig.animation_data.action = bpy.data.actions['idle']

def scuttler():
    reset(); out = 'lat_scuttler'
    m = {'shell': paint_mat('ceramic', (0.82, 0.84, 0.86), rough=0.35, metal=0.05, grime=0.45, wear=0.25, wear_col=(0.35, 0.37, 0.4), panel=0.6, noise_scale=30),
         'dark': paint_mat('composite', (0.1, 0.11, 0.13), rough=0.5, metal=0.3, grime=0.3, wear=0.3, wear_col=(0.4, 0.42, 0.45)),
         'metal': paint_mat('alloy', (0.25, 0.27, 0.3), rough=0.3, metal=0.9, grime=0.2, wear=0.5),
         'team': flat_mat('TEAM', (1, 1, 1), 0.4), 'glow': flat_mat('GLOW', (0.3, 0.95, 1.0), 0.3, emit=(0.25, 0.9, 1.0), strength=6)}
    rig = make_rig(bones()); parts, muzzle = build_body(m)
    body = join('body', parts); shade(body, 40)
    body.parent = rig; mod = body.modifiers.new('arm', 'ARMATURE'); mod.object = rig
    bake_atlas([body], out + '_tex', 1024, samples=16)
    mz = bpy.data.objects.new('muzzle', None); link(mz); mz.parent = rig; mz.parent_type = 'BONE'; mz.parent_bone = 'weapon'
    bpy.context.view_layer.update(); mz.matrix_world = Matrix.Translation(Vector(muzzle))
    animate(rig); print('tris', tris([body]))
    for clip, fr, nm, az, tg in (('aim', 0, 'aim', -40, (0.02, 0, 0.15)), ('walk', 4, 'walk', -90, (0.02, 0, 0.15)), ('die', 22, 'die', -50, (0, 0, 0.1))):
        rig.animation_data.action = bpy.data.actions[clip]; bpy.context.scene.frame_set(fr)
        preview(os.path.join(PREV, f'{out}_{nm}.png'), target=tg, dist=1.6, azim=az, elev=28, size=520)
    rig.animation_data.action = None
    for pb in rig.pose.bones: pb.rotation_quaternion = Quaternion(); pb.location = Vector()
    export(out, [rig, body, mz], anims=True)

if __name__ == '__main__':
    scuttler()
