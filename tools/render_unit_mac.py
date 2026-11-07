"""Beauty render of one unit's saved .blend on the Mac GPU (Cycles, Metal), from the game camera angle and a low hero
angle. Run detached: blender -b units/blend/<UID>.blend --python tools/render_unit_mac.py -- <UID> [samples]
Writes units/preview/<UID>_beauty_game.png and <UID>_beauty_hero.png and logs device and times."""
import bpy, sys, os, time, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
import blender_gpu
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
uid = argv[0] if argv else 'A06'; samples = int(argv[1]) if len(argv) > 1 else 24
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; blender_gpu.enable_gpu_backend(); blender_gpu.use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = True
meshes = [o for o in sc.objects if o.type == 'MESH' and not o.hide_render]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]; lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr = (lo + hi) / 2; size = max(hi - lo)
# studio: ground plane, sun + sky
bpy.ops.mesh.primitive_plane_add(size=size * 30, location=(ctr.x, ctr.y, lo.z)); g = bpy.context.object; m = bpy.data.materials.new('_ground'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.36, 0.27, 1); m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9; g.data.materials.append(m)
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(35))); bpy.context.object.data.energy = 4.0; bpy.context.object.data.angle = math.radians(2)
w = sc.world or bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam')); sc.collection.objects.link(cam); sc.camera = cam
log = {'uid': uid, 'samples': samples, 'device': blender_gpu.describe(), 'blender': bpy.app.version_string}
for tag, el, az, dist, lens in [('game', 56, -35, 3.2, 50), ('hero', 18, -40, 2.3, 50)]:
    d = size * dist; e, a = math.radians(el), math.radians(az)
    cam.location = ctr + Vector((math.cos(e) * math.sin(a) * d, -math.cos(e) * math.cos(a) * d, math.sin(e) * d)); cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = lens
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000; sc.render.filepath = os.path.join(ROOT, 'units', 'preview', f'{uid}_beauty_{tag}.png')
    t = time.time(); bpy.ops.render.render(write_still=True); log[tag + '_s'] = round(time.time() - t, 1)
print('RENDER_LOG', log); open(os.path.join(ROOT, 'units', 'preview', f'{uid}_beauty_log.txt'), 'w').write(repr(log))
