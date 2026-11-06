"""Thunderhead Blender toolkit: modelling helpers, materials, texture baking and glTF export.
Units are map cells (1 cell ≈ 6 m). Blender axes: +X = forward, +Y = left, +Z = up (exports to three.js +X forward, +Y up).
Named nodes the game looks for: hull, turret, gun, muzzle, wheel_*, track_L / track_R, pod_*; materials named TEAM get the player colour,
GLOW stays emissive, TRACK scrolls with movement."""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
PREV = os.path.join(os.path.dirname(__file__), 'preview'); os.makedirs(PREV, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects): pass
    random.seed(7)

def link(o):
    bpy.context.scene.collection.objects.link(o); return o

def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(name, me); return link(o)

def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, seg=2, taper=None):
    """Axis box. taper = dict of vertex moves: {'top_front': dz or (dx,dz), ...} applied before bevel."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if taper:
        for v in bm.verts:
            fx = v.co.x > 0; top = v.co.z > 0; left = v.co.y > 0
            for key, mv in taper.items():
                want = {'top_front': fx and top, 'top_back': (not fx) and top, 'bot_front': fx and not top, 'bot_back': (not fx) and not top,
                        'top_left': top and left, 'top_right': top and not left, 'top': top, 'front': fx, 'back': not fx}[key]
                if want: v.co += Vector(mv)
    o = mesh_obj(name, bm); o.location = loc; o.rotation_euler = rot
    if bevel: bev(o, bevel, seg)
    return o

def cyl(name, r, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=24, r2=None, bevel=0.0, seg=2, cap=True):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    o = mesh_obj(name, bm); o.location = loc; o.rotation_euler = rot
    if bevel: bev(o, bevel, seg)
    return o

def sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), seg=20, rings=12, cut_below=None):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    if cut_below is not None:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut_below), plane_no=(0, 0, 1), clear_inner=True)
        edges = [e for e in bm.edges if e.is_boundary]
        if edges: bmesh.ops.holes_fill(bm, edges=edges)
    o = mesh_obj(name, bm); o.location = loc; o.scale = scale; return o

def profile_extrude(name, pts, width, loc=(0, 0, 0), axis='Y', bevel=0.0, seg=2):
    """Extrude a 2D outline (x, z) along Y by width (centred)."""
    bm = bmesh.new(); vs = [bm.verts.new((x, -width / 2, z)) for x, z in pts]; f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top: v.co.y += width
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = mesh_obj(name, bm); o.location = loc
    if bevel: bev(o, bevel, seg)
    return o

def bev(o, w, seg=2, angle=40):
    m = o.modifiers.new('bev', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle); m.harden_normals = True
    return o

def boolean(o, cutter, op='DIFFERENCE'):
    m = o.modifiers.new('bool', 'BOOLEAN'); m.object = cutter; m.operation = op; m.solver = 'EXACT'; cutter.hide_render = True; cutter.hide_viewport = True
    return o

def array(o, count, offset, relative=False):
    m = o.modifiers.new('arr', 'ARRAY'); m.count = count; m.use_relative_offset = relative; m.use_constant_offset = not relative
    if relative: m.relative_offset_displace = offset
    else: m.constant_offset_displace = offset
    return o

def mirror(o, axis='Y', obj=None):
    m = o.modifiers.new('mir', 'MIRROR'); m.use_axis = (axis == 'X', axis == 'Y', axis == 'Z'); m.mirror_object = obj; return o

def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True)
    # booleans first need their order; apply in stack order
    for m in list(o.modifiers):
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as ex: print('modifier fail', o.name, m.name, ex); o.modifiers.remove(m)
    return o

def join(name, objs):
    objs = [o for o in objs if o]
    for o in objs: apply_all(o)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    return o

def cleanup_cutters():
    for o in list(bpy.data.objects):
        if o.hide_viewport and o.hide_render and o.type == 'MESH' and not o.users_collection == []:
            if o.name.startswith('cut'): bpy.data.objects.remove(o, do_unlink=True)

def shade(o, smooth_angle=35):
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True)
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle), keep_sharp_edges=True)
    except Exception as ex:
        for p in o.data.polygons: p.use_smooth = True
        try: o.data.set_sharpness_by_angle(angle=math.radians(smooth_angle))
        except Exception: print('smooth fallback failed', ex)
    wn = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True
    apply_all(o)
    return o

def set_origin(o, point):
    """Move the object's origin to a world point without moving the geometry."""
    bpy.context.view_layer.update(); pt = Vector(point); mw = o.matrix_world.copy(); local = mw.inverted() @ pt
    o.data.transform(Matrix.Translation(-local)); o.location = mw @ local; bpy.context.view_layer.update()
    return o

def parent(child, par):
    bpy.context.view_layer.update(); mw = child.matrix_world.copy(); child.parent = par; child.matrix_world = mw; bpy.context.view_layer.update(); return child

def empty(name, loc, par=None):
    e = bpy.data.objects.new(name, None); e.location = loc; link(e)
    if par: parent(e, par)
    return e

def assign(o, mat):
    o.data.materials.clear(); o.data.materials.append(mat); return o

def add_mat(o, mat):
    if mat.name not in [m.name for m in o.data.materials if m]: o.data.materials.append(mat)
    return o.data.materials.find(mat.name)

def set_faces_mat(o, mat, pred):
    """Assign mat to faces whose world-space centre satisfies pred(center, normal)."""
    i = add_mat(o, mat); mw = o.matrix_world
    for p in o.data.polygons:
        c = mw @ p.center; n = (mw.to_3x3() @ p.normal).normalized()
        if pred(c, n): p.material_index = i

# ───────── materials ─────────
def paint_mat(name, base, rough=0.7, metal=0.1, grime=0.55, wear=0.35, wear_col=(0.55, 0.53, 0.5), panel=0.0, noise_scale=18.0, camo=None):
    """Procedural painted-metal material for baking: base colour, mottled noise, cavity grime (AO), worn edges (pointiness)."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N['Principled BSDF']; bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    def node(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n
    rgb = node('ShaderNodeRGB'); rgb.outputs[0].default_value = (*base, 1)
    tex = node('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value = noise_scale; tex.inputs['Detail'].default_value = 8
    mot = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); mot.inputs['Factor'].default_value = 0.35
    L.new(rgb.outputs[0], mot.inputs['A']); L.new(tex.outputs['Fac'], mot.inputs['B'])
    col = mot.outputs['Result']
    if camo:
        ct = node('ShaderNodeTexNoise'); ct.inputs['Scale'].default_value = camo.get('scale', 3.0); ct.inputs['Detail'].default_value = 2
        cr = node('ShaderNodeValToRGB'); cr.color_ramp.interpolation = 'CONSTANT'; cr.color_ramp.elements[0].position = 0.0; cr.color_ramp.elements[0].color = (*base, 1)
        e1 = cr.color_ramp.elements[1]; e1.position = camo.get('t1', 0.52); e1.color = (*camo['c1'], 1)
        if 'c2' in camo: e2 = cr.color_ramp.elements.new(camo.get('t2', 0.64)); e2.color = (*camo['c2'], 1)
        L.new(ct.outputs['Fac'], cr.inputs['Fac']); mix = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); mix.inputs['Factor'].default_value = 0.3
        L.new(cr.outputs['Color'], mix.inputs['A']); L.new(tex.outputs['Fac'], mix.inputs['B']); col = mix.outputs['Result']
    if panel:
        vor = node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vor.inputs['Scale'].default_value = panel
        pr = node('ShaderNodeMapRange'); pr.inputs['From Min'].default_value = 0.0; pr.inputs['From Max'].default_value = 0.03; pr.inputs['To Min'].default_value = 0.55; pr.inputs['To Max'].default_value = 1.0
        L.new(vor.outputs['Distance'], pr.inputs['Value']); pm = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); pm.inputs['Factor'].default_value = 1.0
        L.new(col, pm.inputs['A']); L.new(pr.outputs['Result'], pm.inputs['B']); col = pm.outputs['Result']
    if wear:
        geo = node('ShaderNodeNewGeometry'); wr = node('ShaderNodeMapRange'); wr.inputs['From Min'].default_value = 0.52; wr.inputs['From Max'].default_value = 0.62
        L.new(geo.outputs['Pointiness'], wr.inputs['Value']); wn = node('ShaderNodeTexNoise'); wn.inputs['Scale'].default_value = 40
        wm = node('ShaderNodeMath', operation='MULTIPLY'); L.new(wr.outputs['Result'], wm.inputs[0]); L.new(wn.outputs['Fac'], wm.inputs[1])
        wm2 = node('ShaderNodeMath', operation='MULTIPLY'); wm2.inputs[1].default_value = wear * 2.2; L.new(wm.outputs[0], wm2.inputs[0])
        wc = node('ShaderNodeRGB'); wc.outputs[0].default_value = (*wear_col, 1)
        wmix = node('ShaderNodeMix', data_type='RGBA'); L.new(wm2.outputs[0], wmix.inputs['Factor']); L.new(col, wmix.inputs['A']); L.new(wc.outputs[0], wmix.inputs['B']); col = wmix.outputs['Result']
    if grime:
        ao = node('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.12; ao.samples = 16
        gr = node('ShaderNodeMapRange'); gr.inputs['To Min'].default_value = 1.0 - grime; gr.inputs['To Max'].default_value = 1.0
        L.new(ao.outputs['AO'], gr.inputs['Value']); gn = node('ShaderNodeTexNoise'); gn.inputs['Scale'].default_value = 6
        dirt = node('ShaderNodeRGB'); dirt.outputs[0].default_value = (0.16, 0.13, 0.09, 1)
        gfac = node('ShaderNodeMath', operation='SUBTRACT'); gfac.inputs[0].default_value = 1.0; L.new(gr.outputs['Result'], gfac.inputs[1])
        gmix = node('ShaderNodeMix', data_type='RGBA'); L.new(gfac.outputs[0], gmix.inputs['Factor']); L.new(col, gmix.inputs['A']); L.new(dirt.outputs[0], gmix.inputs['B']); col = gmix.outputs['Result']
        # mud on the lower hull
        sep = node('ShaderNodeSeparateXYZ'); L.new(geo_or(N, nt).outputs['Position'], sep.inputs[0])
        mr = node('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.22; mr.inputs['From Max'].default_value = 0.04; mr.inputs['To Max'].default_value = grime * 0.8
        L.new(sep.outputs['Z'], mr.inputs['Value']); mm = node('ShaderNodeMath', operation='MULTIPLY'); L.new(mr.outputs['Result'], mm.inputs[0]); L.new(gn.outputs['Fac'], mm.inputs[1])
        mud = node('ShaderNodeRGB'); mud.outputs[0].default_value = (0.24, 0.19, 0.13, 1)
        mmix = node('ShaderNodeMix', data_type='RGBA'); L.new(mm.outputs[0], mmix.inputs['Factor']); L.new(col, mmix.inputs['A']); L.new(mud.outputs[0], mmix.inputs['B']); col = mmix.outputs['Result']
    L.new(col, bsdf.inputs['Base Color'])
    m['bake'] = True
    return m

def geo_or(N, nt):
    for n in N:
        if n.bl_idname == 'ShaderNodeNewGeometry': return n
    return N.new('ShaderNodeNewGeometry')

def flat_mat(name, col, rough=0.5, metal=0.0, emit=None, strength=4.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit: b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = strength
    return m

def track_image(name='track_tex', w=256, h=64, rubber=(0.06, 0.06, 0.055), steel=(0.32, 0.31, 0.29)):
    """Tileable track-link texture: 8 links across the width of the image (U runs along the track)."""
    img = bpy.data.images.new(name, w, h); px = [0.0] * (w * h * 4); links = 8
    for y in range(h):
        for x in range(w):
            u = (x % (w // links)) / (w // links); v = y / h
            c = rubber
            if u < 0.16 or u > 0.9: c = (rubber[0] * 0.6,) * 3
            if 0.3 < u < 0.7 and (0.12 < v < 0.3 or 0.7 < v < 0.88): c = steel
            if 0.42 < u < 0.58 and 0.42 < v < 0.58: c = (steel[0] * 1.3,) * 3
            n = (random.random() - 0.5) * 0.03; i = (y * w + x) * 4; px[i:i + 4] = [max(0, c[0] + n), max(0, c[1] + n), max(0, c[2] + n), 1]
    img.pixels = px; img.pack(); return img

def track_mat(img):
    m = bpy.data.materials.new('TRACK'); m.use_nodes = True; N = m.node_tree.nodes; b = N['Principled BSDF']; t = N.new('ShaderNodeTexImage'); t.image = img
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.85; b.inputs['Metallic'].default_value = 0.4; return m

# ───────── UV atlas + bake ─────────
def uv_unwrap(objs, margin=0.006):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

def bake_atlas(objs, name, size=1024, samples=24):
    """Bake every baked-paint material on objs into one colour atlas, then swap those materials for a single textured material."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = False
    sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True; sc.render.bake.margin = 4
    img = bpy.data.images.new(name, size, size); img.colorspace_settings.name = 'sRGB'
    baked = set()
    for o in objs:
        for m in o.data.materials:
            if m and m.get('bake') and m.name not in baked:
                t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img; m.node_tree.nodes.active = t; baked.add(m.name)
            elif m and not m.get('bake'):
                t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.new('_dummy', 8, 8); m.node_tree.nodes.active = t
    uv_unwrap(objs)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=4)
    img.pack()
    # one exported material for all baked paint: base colour texture + averaged roughness/metal
    out = bpy.data.materials.new(name + '_mat'); out.use_nodes = True; N = out.node_tree.nodes; b = N['Principled BSDF']; t = N.new('ShaderNodeTexImage'); t.image = img
    out.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    rs = [m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value for o in objs for m in o.data.materials if m and m.get('bake')]
    ms = [m.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value for o in objs for m in o.data.materials if m and m.get('bake')]
    b.inputs['Roughness'].default_value = sum(rs) / max(1, len(rs)); b.inputs['Metallic'].default_value = sum(ms) / max(1, len(ms))
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if m and m.get('bake'): o.data.materials[i] = out
    return img

# ───────── preview + export ─────────
def preview(path, target=(0, 0, 0.25), dist=3.0, size=640, elev=35, azim=-50, samples=32):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = False
    sc.render.resolution_x = size; sc.render.resolution_y = size; sc.render.film_transparent = False
    w = bpy.data.worlds.new('w') if not bpy.data.worlds else bpy.data.worlds[0]; sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.32, 0.35, 0.4, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    cam = bpy.data.objects.get('_cam') or link(bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam')))
    e, a = math.radians(elev), math.radians(azim); t = Vector(target)
    cam.location = t + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    d = t - cam.location; cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = 50; sc.camera = cam
    sun = bpy.data.objects.get('_sun') or link(bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN')))
    sun.data.energy = 3.5; sun.rotation_euler = Euler((math.radians(40), math.radians(-25), math.radians(-35)))
    gp = bpy.data.objects.get('_ground')
    if not gp: gp = box('_ground', (20, 20, 0.01), (0, 0, -0.006)); assign(gp, flat_mat('_gm', (0.3, 0.33, 0.25), 0.9))
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    for n in ('_cam', '_sun', '_ground'):
        o = bpy.data.objects.get(n)
        if o: bpy.data.objects.remove(o, do_unlink=True)

def export(name, objs=None, anims=False):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in (objs or [o for o in bpy.data.objects if not o.name.startswith('_') and not (o.hide_viewport and o.hide_render)]): o.select_set(True)
    path = os.path.join(OUT, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_texcoords=True, export_normals=True,
              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88, export_animations=anims)
    if anims: kw.update(export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_range=False)
    bpy.ops.export_scene.gltf(**kw)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')
    return path

def tris(objs):
    n = 0
    for o in objs:
        if o.type != 'MESH': continue
        dg = bpy.context.evaluated_depsgraph_get(); me = o.evaluated_get(dg).to_mesh()
        n += sum(len(p.vertices) - 2 for p in me.polygons); o.evaluated_get(dg).to_mesh_clear()
    return n
