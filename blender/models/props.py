"""Terrain props for instancing: two boulders, a crystal cluster, a shrub clump and a conifer canopy, one shared baked atlas.
Albedo is near-neutral so the game's per-instance theme colour tints it. Run: blender-env/bin/python blender/models/props.py"""
import sys, os, math, random
import bpy, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import *
from mathutils import Vector, noise

def displaced(name, subdiv, fn, scale=(1, 1, 1)):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        p = v.co.copy(); v.co = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2])) * fn(p)
    return mesh_obj(name, bm)

def decimate(o, ratio):
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; apply_all(o); return o

def rock(name, seed, sq):
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    def f(p):
        q = p * 1.3 + off
        cells = noise.voronoi(q * 1.2, distance_metric='DISTANCE', exponent=2.5)[0][0]  # faceted chips
        return 0.82 + 0.35 * noise.noise(q * 0.9) + 0.22 * cells + 0.06 * noise.noise(q * 6.0)
    o = displaced(name, 5, f, sq)
    bm = bmesh.new(); bm.from_mesh(o.data)
    for v in bm.verts:  # flatten the buried base, terrace the sides slightly (strata)
        if v.co.z < -0.45: v.co.z = -0.45 - (v.co.z + 0.45) * 0.1
        v.co.z += math.sin(v.co.z * 14 + seed) * 0.012
    bm.to_mesh(o.data); bm.free(); decimate(o, 0.11); shade(o, 32); return o

def crystal():
    parts = []; rnd = random.Random(3)
    for i, (r, h, ax, ay, dx, dy) in enumerate(((0.32, 1.9, 0, 0, 0, 0), (0.22, 1.3, 0.45, 0.2, 0.35, 0.15), (0.2, 1.1, -0.35, 0.3, -0.3, 0.25), (0.17, 0.9, 0.1, -0.5, 0.05, -0.38), (0.13, 0.7, -0.5, -0.3, -0.35, -0.25))):
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=r, radius2=r * 0.9, depth=h * 0.75)
        for v in bm.verts:
            if v.co.z > 0: v.co.z += 0.0
        top = [v for v in bm.verts if v.co.z > 0]; c = sum((v.co for v in top), Vector()) / len(top)
        tip = bm.verts.new((0, 0, h * 0.375 + r * 1.1)); bm.verts.ensure_lookup_table()
        for f in [f for f in bm.faces if all(v.co.z > 0 for v in f.verts) and len(f.verts) == 6]: bm.faces.remove(f)
        ring = sorted(top, key=lambda v: math.atan2(v.co.y, v.co.x))
        for k in range(len(ring)): bm.faces.new((ring[k], ring[(k + 1) % len(ring)], tip))
        o = mesh_obj(f'cr{i}', bm); o.location = (dx, dy, h * 0.375 - 0.75); o.rotation_euler = (ay, ax, rnd.random() * 6); parts.append(o)
    base = displaced('crbase', 2, lambda p: 0.9 + 0.2 * noise.noise(p * 3), (0.75, 0.75, 0.35)); base.location = (0, 0, -0.8); parts.append(base)
    o = join('crystal', parts); bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free(); return o

def bush():
    parts = []; rnd = random.Random(5)
    for i in range(7):
        a = i / 7 * 6.28 + rnd.random() * 0.5; rr = 0.0 if i == 0 else 0.45 + rnd.random() * 0.2; s = 0.6 if i == 0 else 0.4 + rnd.random() * 0.15
        o = displaced(f'lb{i}', 2, lambda p, i=i: 0.85 + 0.3 * noise.noise(p * 2.5 + Vector((i, i * 2, 0))), (s, s, s * 0.85)); o.location = (math.cos(a) * rr, math.sin(a) * rr, 0.15 + (0.35 if i == 0 else rnd.random() * 0.15)); parts.append(o)
    o = join('bush', parts); decimate(o, 0.5); shade(o, 60); return o

def conifer():
    parts = []
    for i, (r, z, h) in enumerate(((1.0, -0.35, 0.55), (0.8, -0.05, 0.5), (0.6, 0.22, 0.45), (0.38, 0.45, 0.4))):
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=0.02, depth=h)
        for v in bm.verts:  # ragged, drooping skirt
            if v.co.z < 0: a = math.atan2(v.co.y, v.co.x); k = 1 + 0.12 * math.sin(a * 5 + i * 2); v.co.x *= k; v.co.y *= k; v.co.z -= 0.06 * (1 + math.sin(a * 7 + i))
        o = mesh_obj(f'tier{i}', bm); o.location = (0, 0, z); o.rotation_euler = (0, 0, i * 0.7); parts.append(o)
    o = join('conifer', parts); shade(o, 50); return o

def build():
    reset()
    stone = paint_mat('stone', (0.78, 0.76, 0.72), rough=0.9, metal=0, grime=0.8, wear=0.45, wear_col=(0.95, 0.93, 0.9), noise_scale=5)
    gem = flat_mat('crystal', (0.92, 0.95, 1.0), 0.15, 0.2)
    leaf = paint_mat('leaf', (0.72, 0.8, 0.66), rough=0.9, metal=0, grime=0.7, wear=0.25, wear_col=(0.95, 1.0, 0.85), noise_scale=12)
    r1 = rock('rock_a', 1, (1.0, 0.9, 0.75)); r2 = rock('rock_b', 2, (1.15, 0.8, 0.6)); assign(r1, stone); assign(r2, stone)
    c = crystal(); assign(c, gem); b = bush(); assign(b, leaf); t = conifer(); assign(t, leaf)
    for i, o in enumerate((r1, r2, c, b, t)): o.location = (i * 2.6 - 5, 0, 0.6)
    bake_atlas([r1, r2, b, t], 'props_tex', 1024, samples=16)
    print('tris', {o.name: tris([o]) for o in (r1, r2, c, b, t)})
    preview(os.path.join(PREV, 'props.png'), target=(0, 0, 0.5), dist=9, azim=-80, elev=22, size=900)
    for o in (r1, r2, c, b, t): o.location = (0, 0, 0)
    export('props', [r1, r2, c, b, t])

if __name__ == '__main__':
    build()
