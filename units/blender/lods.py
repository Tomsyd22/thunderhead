"""Distant-view versions (LOD1, LOD2) of every unit, built from the saved LOD0 .blend.

Each level keeps the LOD0 node tree and names (moving parts, sockets, bones, materials), so the sandbox and the game drive
every level with the same code; only the mesh density and the atlas resolution drop. Triangle targets are the pack's budget
(unit_specs.json budget = [LOD0, LOD1, LOD2, materials, texture px]).
  out/<UID>_lod1.glb (atlas 1/2), out/<UID>_lod2.glb (atlas 1/4); preview/<UID>_lods.png (LOD0 | LOD1 | LOD2, same camera)
Run: /home/claude/blender-env/bin/python units/blender/lods.py all | H03,A03 [--no-preview]"""
import bpy, os, sys, json, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
OUT, BLEND, PREV = os.path.join(ROOT, 'out'), os.path.join(ROOT, 'blend'), os.path.join(ROOT, 'preview')
SPEC = {u['id']: u for u in json.load(open(os.path.join(ROOT, 'data', 'unit_specs.json')))['units']}
_pend = os.path.join(ROOT, 'data', 'pending_specs.json')
for _u in (json.load(open(_pend))['units'] if os.path.exists(_pend) else []): SPEC.setdefault(_u['id'], _u)   # units not yet in unit_specs.json
ORDER = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'T01', 'T02', 'T03', 'T04', 'T05']

def tri_eval(o, dg):
    ev = o.evaluated_get(dg); me = ev.to_mesh(); n = sum(len(p.vertices) - 2 for p in me.polygons); ev.to_mesh_clear(); return n

def export_objs():
    return [o for o in bpy.data.objects if not o.name.startswith('_')]

def apply_modifiers(o):
    keep = [m for m in o.modifiers if m.type == 'ARMATURE']
    for m in list(o.modifiers):
        if m.type == 'ARMATURE': continue
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]): bpy.ops.object.modifier_apply(modifier=m.name)
    return keep

def decimate_to(meshes, target):
    """One global collapse ratio (bisected) over every mesh with more than 48 triangles; tiny parts keep their shape unless needed."""
    dg = bpy.context.evaluated_depsgraph_get(); base = {o: tri_eval(o, dg) for o in meshes}
    total0 = sum(base.values())
    if total0 <= target: return total0, 1.0
    big = [o for o in meshes if base[o] > 48]; small_sum = sum(v for o, v in base.items() if o not in big)
    if small_sum > 0.5 * target: big = list(meshes)   # many small parts: let them reduce too
    mods = {}
    for o in big:
        m = o.modifiers.new('lod_decimate', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.use_collapse_triangulate = True
        while o.modifiers.find(m.name) > 0: bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_move_up(modifier=m.name)   # before the armature
        mods[o] = m
    lo, hi, best = 0.0, 1.0, None
    for _ in range(16):
        r = (lo + hi) / 2
        for o, m in mods.items(): m.ratio = r
        dg = bpy.context.evaluated_depsgraph_get(); dg.update(); tot = sum(tri_eval(o, dg) for o in meshes)
        if tot > target: hi = r
        else: lo = r; best = (r, tot)
        if best and target - best[1] < target * 0.02: break
    r = best[0] if best else lo
    for o, m in mods.items(): m.ratio = r
    for o, m in mods.items():
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]): bpy.ops.object.modifier_apply(modifier=m.name)
    dg = bpy.context.evaluated_depsgraph_get(); return sum(tri_eval(o, dg) for o in meshes), r

def shrink_images(factor):
    for img in bpy.data.images:
        if img.size[0] > 64 and img.size[1] > 64 and img.source in ('FILE', 'GENERATED'):
            try: img.scale(max(32, img.size[0] // factor), max(32, img.size[1] // factor))
            except Exception as e: print('  image', img.name, e)

def export(uid, level, rigged):
    path = os.path.join(OUT, f'{uid}_lod{level}.glb')
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in export_objs(): o.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_texcoords=True, export_normals=True,
              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88, export_extras=True, export_animations=False)
    if rigged: kw.update(export_skins=True, export_def_bones=False, export_rest_position_armature=True)
    bpy.ops.export_scene.gltf(**kw); return path

def build(uid, preview=True):
    rows = {}
    for level in (1, 2):
        bpy.ops.wm.open_mainfile(filepath=os.path.join(BLEND, uid + '.blend'))
        root = bpy.data.objects.get('root'); rigged = any(o.type == 'ARMATURE' for o in bpy.data.objects)
        meshes = [o for o in export_objs() if o.type == 'MESH' and not o.hide_render]
        for o in meshes: apply_modifiers(o)
        lod0 = int(root['tris']) if root is not None and 'tris' in root else 10 ** 9
        target = min(SPEC[uid]['budget'][level], int(lod0 * (0.6 if level == 1 else 0.25)))   # a real reduction at every level, never above the budget
        got, r = decimate_to(meshes, target)
        shrink_images(2 ** level)
        if root is not None: root['lod'] = level; root['tris'] = got; root['lod_ratio'] = round(r, 4)
        path = export(uid, level, rigged)
        rows[level] = {'tris': got, 'budget': SPEC[uid]['budget'][level], 'target': target, 'lod0': lod0, 'ratio': round(r, 4), 'kb': os.path.getsize(path) // 1024}
        print(f'[{uid}] LOD{level}: {got} tris (target {target}, budget {SPEC[uid]["budget"][level]}, LOD0 {lod0}, ratio {r:.3f}) → {os.path.basename(path)} {rows[level]["kb"]} KB')
    return rows

if __name__ == '__main__':
    arg = [a for a in sys.argv[1:] if not a.startswith('--')]; ids = ORDER if not arg or arg[-1] == 'all' else arg[-1].split(',')
    res = {}
    rp = os.path.join(OUT, 'lods.json')
    if os.path.exists(rp): res = json.load(open(rp))
    for uid in ids: res[uid] = build(uid)
    json.dump(res, open(rp, 'w'), indent=1); print('wrote', rp)
