"""Thunderhead unit toolkit (metric). Builds the 15 units of the RTS Unit Design Pack.

Conventions (from the pack's shared rules — see ../CONTRACT.md):
  1 Blender unit = 1 metre; Z up; +Y forward; +X = unit's right.
  Length = Y envelope, width = X envelope, height = Z envelope.
  glTF export is y-up, so in three.js the unit faces -Z and its right is +X.

Every unit script does:  reset() → build parts → finish(uid, root) which
  bakes one paint atlas (AO grime, bevel-edge wear, mud, panel lines), saves units/blend/<uid>.blend,
  exports units/out/<uid>.glb (named nodes + extras), renders units/preview/<uid>_sheet.png and prints a dimension check.
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, json, random
sys.path.insert(0, '/home/claude/thunderhead/blender')
import bpy, bmesh
from mathutils import Vector, Matrix, Euler, Quaternion
import lib
from lib import link, mesh_obj, bev, boolean, apply_all, shade, set_origin, parent, assign, add_mat, set_faces_mat, tris

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'out'); BLEND = os.path.join(ROOT, 'blend'); PREV = os.path.join(ROOT, 'preview')
for d in (OUT, BLEND, PREV): os.makedirs(d, exist_ok=True)
SPEC = {u['id']: u for u in json.load(open(os.path.join(ROOT, 'data', 'unit_specs.json')))['units']}
for _u in json.load(open(os.path.join(ROOT, 'data', 'pending_specs.json')))['units']: SPEC.setdefault(_u['id'], _u)   # units not yet in unit_specs.json
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'

def reset(seed=7):
    bpy.ops.wm.read_factory_settings(use_empty=True); random.seed(seed)

# ─────────────────────────── colour ───────────────────────────
def lin(c):
    """sRGB hex '#B7473F' or 0..1 sRGB tuple → linear RGB tuple (Blender node colours are linear)."""
    if isinstance(c, str): c = tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda x: x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return tuple(f(x) for x in c[:3])

# Faction palettes (sRGB). Sources: unit_specs.json factions + the realistic art sheets.
PAL = {
    'H': dict(primary='#8E3A31', primary_dark='#5E2621', steel='#3B3A37', steel_dark='#262624', ivory='#D9C9A6', brass='#D6AE68',
              fabric='#5F5543', fabric2='#4C4536', canvas='#8C7A55', leather='#5A3A24', wood='#6B3E22', skin='#B98A6E', glow='#FF9A4A'),
    'A': dict(primary='#2E4A72', primary_dark='#1F334F', steel='#5D6266', steel_dark='#34383C', ivory='#E4E8E6', brass='#E0A040',
              fabric='#6E675A', fabric2='#55534B', canvas='#7D7562', leather='#4A3F33', wood='#4A4038', skin='#B48A70', glow='#FFB347'),
    'T': dict(primary='#3A3E42', primary_dark='#232628', steel='#9DA3A6', steel_dark='#5C6266', ivory='#D8DEDF', brass='#B9C3C6',
              fabric='#2B2E31', fabric2='#202325', canvas='#4A4F53', leather='#2A2C2E', wood='#2A2C2E', skin='#B48A70', glow='#6FE6D4'),
}
TEAM_BASE = '#D8D8D8'   # TEAM material is baked light grey; the game multiplies it by the player colour

# ─────────────────────────── materials ───────────────────────────
def _nodes(m):
    nt = m.node_tree; N = nt.nodes; L = nt.links
    def node(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n
    return nt, N, L, node

def paint(name, base, scale=1.0, rough=0.62, metal=0.15, grime=0.5, wear=0.35, wear_col=None, mud_top=None, mud=0.6,
          noise=0.35, panel=0.0, camo=None, group='paint', soot=None):
    """Bakeable painted surface. scale = characteristic size in metres (infantry ~0.3, tank ~3, ship ~10):
    it sets AO distance and noise frequency. wear = bevel-edge chipping exposing wear_col. mud_top = height (m, object-space Z
    after transforms are applied, i.e. model space) below which mud/dust accumulates. camo = dict(c1=sRGB, scale=m, t1=0.55).
    group 'team' bakes into the TEAM material (runtime tint)."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt, N, L, node = _nodes(m)
    bsdf = N['Principled BSDF']; bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    tc = node('ShaderNodeTexCoord'); pos = tc.outputs['Object']
    rgb = node('ShaderNodeRGB'); rgb.outputs[0].default_value = (*lin(base), 1); col = rgb.outputs[0]
    if camo:
        ct = node('ShaderNodeTexNoise'); ct.inputs['Scale'].default_value = 1.0 / camo.get('scale', 2.0); ct.inputs['Detail'].default_value = 1.5
        ct.inputs['Roughness'].default_value = 0.45; L.new(pos, ct.inputs['Vector'])
        cr = node('ShaderNodeValToRGB'); cr.color_ramp.interpolation = 'CONSTANT'
        cr.color_ramp.elements[0].color = (*lin(base), 1); e1 = cr.color_ramp.elements[1]; e1.position = camo.get('t1', 0.55); e1.color = (*lin(camo['c1']), 1)
        if 'c2' in camo: e2 = cr.color_ramp.elements.new(camo.get('t2', 0.66)); e2.color = (*lin(camo['c2']), 1)
        L.new(ct.outputs['Fac'], cr.inputs['Fac']); col = cr.outputs['Color']
    # mottling
    tex = node('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value = 6.0 / scale; tex.inputs['Detail'].default_value = 9; L.new(pos, tex.inputs['Vector'])
    mr = node('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 1 - noise; mr.inputs['To Max'].default_value = 1 + noise * 0.4; L.new(tex.outputs['Fac'], mr.inputs['Value'])
    mot = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); mot.inputs['Factor'].default_value = 1.0
    L.new(col, mot.inputs['A']); L.new(mr.outputs['Result'], mot.inputs['B']); col = mot.outputs['Result']
    if panel:
        vor = node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vor.inputs['Scale'].default_value = 1.0 / panel; L.new(pos, vor.inputs['Vector'])
        pr = node('ShaderNodeMapRange'); pr.inputs['From Max'].default_value = 0.025; pr.inputs['To Min'].default_value = 0.6; pr.inputs['To Max'].default_value = 1.0
        L.new(vor.outputs['Distance'], pr.inputs['Value']); pm = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); pm.inputs['Factor'].default_value = 1.0
        L.new(col, pm.inputs['A']); L.new(pr.outputs['Result'], pm.inputs['B']); col = pm.outputs['Result']
    if wear:
        # edge mask from the bevel shader: 1 - dot(bevel normal, true normal)
        bv = node('ShaderNodeBevel'); bv.inputs['Radius'].default_value = 0.012 * max(0.4, min(scale, 4)); bv.samples = 6
        geo = node('ShaderNodeNewGeometry'); dot = node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        L.new(bv.outputs['Normal'], dot.inputs[0]); L.new(geo.outputs['Normal'], dot.inputs[1])
        em = node('ShaderNodeMapRange'); em.inputs['From Min'].default_value = 0.995; em.inputs['From Max'].default_value = 0.93; L.new(dot.outputs['Value'], em.inputs['Value'])
        wn = node('ShaderNodeTexNoise'); wn.inputs['Scale'].default_value = 30.0 / scale; wn.inputs['Detail'].default_value = 6; L.new(pos, wn.inputs['Vector'])
        wr = node('ShaderNodeMapRange'); wr.inputs['From Min'].default_value = 0.42; wr.inputs['From Max'].default_value = 0.62; L.new(wn.outputs['Fac'], wr.inputs['Value'])
        wm = node('ShaderNodeMath', operation='MULTIPLY'); L.new(em.outputs['Result'], wm.inputs[0]); L.new(wr.outputs['Result'], wm.inputs[1])
        wm2 = node('ShaderNodeMath', operation='MULTIPLY', use_clamp=True); wm2.inputs[1].default_value = wear * 2.5; L.new(wm.outputs[0], wm2.inputs[0])
        wc = node('ShaderNodeRGB'); wc.outputs[0].default_value = (*lin(wear_col or '#8A8783'), 1)
        wmix = node('ShaderNodeMix', data_type='RGBA'); L.new(wm2.outputs[0], wmix.inputs['Factor']); L.new(col, wmix.inputs['A']); L.new(wc.outputs[0], wmix.inputs['B']); col = wmix.outputs['Result']
    if grime:
        ao = node('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.08 * scale; ao.samples = 12
        gr = node('ShaderNodeMapRange'); gr.inputs['To Min'].default_value = 1.0; gr.inputs['To Max'].default_value = 0.0; L.new(ao.outputs['AO'], gr.inputs['Value'])
        gn = node('ShaderNodeTexNoise'); gn.inputs['Scale'].default_value = 3.0 / scale; L.new(pos, gn.inputs['Vector'])
        gm = node('ShaderNodeMath', operation='MULTIPLY'); L.new(gr.outputs['Result'], gm.inputs[0]); L.new(gn.outputs['Fac'], gm.inputs[1])
        gm2 = node('ShaderNodeMath', operation='MULTIPLY', use_clamp=True); gm2.inputs[1].default_value = grime * 2.2; L.new(gm.outputs[0], gm2.inputs[0])
        dirt = node('ShaderNodeRGB'); dirt.outputs[0].default_value = (*lin('#2A241C'), 1)
        gmix = node('ShaderNodeMix', data_type='RGBA'); L.new(gm2.outputs[0], gmix.inputs['Factor']); L.new(col, gmix.inputs['A']); L.new(dirt.outputs[0], gmix.inputs['B']); col = gmix.outputs['Result']
    if mud_top is not None:
        sep = node('ShaderNodeSeparateXYZ'); L.new(pos, sep.inputs[0])
        mz = node('ShaderNodeMapRange'); mz.inputs['From Min'].default_value = mud_top; mz.inputs['From Max'].default_value = mud_top * 0.3; mz.inputs['To Max'].default_value = mud
        L.new(sep.outputs['Z'], mz.inputs['Value'])
        mn = node('ShaderNodeTexNoise'); mn.inputs['Scale'].default_value = 8.0 / scale; mn.inputs['Detail'].default_value = 5; L.new(pos, mn.inputs['Vector'])
        mnr = node('ShaderNodeMapRange'); mnr.inputs['From Min'].default_value = 0.3; mnr.inputs['From Max'].default_value = 0.7; L.new(mn.outputs['Fac'], mnr.inputs['Value'])
        mm = node('ShaderNodeMath', operation='MULTIPLY', use_clamp=True); L.new(mz.outputs['Result'], mm.inputs[0]); L.new(mnr.outputs['Result'], mm.inputs[1])
        mc = node('ShaderNodeRGB'); mc.outputs[0].default_value = (*lin('#6B5A43'), 1)
        mmix = node('ShaderNodeMix', data_type='RGBA'); L.new(mm.outputs[0], mmix.inputs['Factor']); L.new(col, mmix.inputs['A']); L.new(mc.outputs[0], mmix.inputs['B']); col = mmix.outputs['Result']
    if soot:   # soot=(x,y,z,radius) model-space point: blackening around exhausts / muzzles
        vm = node('ShaderNodeVectorMath', operation='DISTANCE'); vm.inputs[1].default_value = soot[:3]; L.new(pos, vm.inputs[0])
        sr = node('ShaderNodeMapRange'); sr.inputs['From Min'].default_value = soot[3]; sr.inputs['From Max'].default_value = 0.0; sr.inputs['To Max'].default_value = 0.85
        L.new(vm.outputs['Value'], sr.inputs['Value']); sc = node('ShaderNodeRGB'); sc.outputs[0].default_value = (0.02, 0.02, 0.02, 1)
        smix = node('ShaderNodeMix', data_type='RGBA'); L.new(sr.outputs['Result'], smix.inputs['Factor']); L.new(col, smix.inputs['A']); L.new(sc.outputs[0], smix.inputs['B']); col = smix.outputs['Result']
    L.new(col, bsdf.inputs['Base Color'])
    m['bake'] = True; m['group'] = group
    return m

def fabric(name, base, scale=0.3, grime=0.55, mud_top=0.45, camo=None):
    return paint(name, base, scale=scale, rough=0.92, metal=0.0, grime=grime, wear=0.12, wear_col='#A69C86', mud_top=mud_top, noise=0.3, camo=camo)

def gunmetal(name='gunmetal', base='#2B2C2E', scale=0.3, wear=0.5):
    return paint(name, base, scale=scale, rough=0.42, metal=0.75, grime=0.35, wear=wear, wear_col='#9A9A96', noise=0.18)

def flat(name, base, rough=0.5, metal=0.0, bake=True):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(base), 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if bake: m['bake'] = True; m['group'] = 'paint'
    return m

def glow(name, color, strength=6.0):
    """Unbaked emissive material. Exported as GLOW_<name>; the game may drive its intensity (shot events, charge)."""
    if bpy.data.materials.get('GLOW_' + name): return bpy.data.materials['GLOW_' + name]
    m = bpy.data.materials.new('GLOW_' + name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(color), 1); b.inputs['Emission Color'].default_value = (*lin(color), 1); b.inputs['Emission Strength'].default_value = strength
    return m

def glass(name='GLASS', tint='#1C2630'):
    if bpy.data.materials.get(name): return bpy.data.materials[name]   # one GLASS per unit (no '.001' duplicates)
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(tint), 1); b.inputs['Roughness'].default_value = 0.06; b.inputs['Metallic'].default_value = 0.0
    b.inputs['Specular IOR Level'].default_value = 0.8; b.inputs['Coat Weight'].default_value = 1.0
    return m

def team(scale=1.0, mud_top=None):
    """Team-colour panels: baked light grey with grime/wear into the atlas, exported as material TEAM (runtime tint)."""
    return paint('TEAM_src', TEAM_BASE, scale=scale, rough=0.55, metal=0.1, grime=0.35, wear=0.3, mud_top=mud_top, noise=0.12, group='team')

# ─────────────────────────── geometry helpers ───────────────────────────
def obj_from(name, verts, faces, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.validate(); me.update()
    o = bpy.data.objects.new(name, me); link(o); o.location = loc; return o

def bx(name, size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, seg=2, mat=None):
    """Box: size = (width X, length Y, height Z), centred on loc."""
    o = lib.box(name, size, loc, rot, 0.0)
    if bevel: bev(o, bevel, seg)
    if mat: assign(o, mat)
    return o

def wedge(name, size, loc=(0, 0, 0), moves=None, bevel=0.0, seg=2, mat=None):
    """Box with corner moves. moves: list of (selector, (dx,dy,dz)); selector is a string of flags:
    'F'/'B' front(+Y)/back, 'T'/'D' top/down, 'R'/'L' right(+X)/left. A vertex moves if it matches every flag in the selector."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    for sel, mv in (moves or []):
        for v in bm.verts:
            f = {'F': v.co.y > 0, 'B': v.co.y < 0, 'T': v.co.z > 0, 'D': v.co.z < 0, 'R': v.co.x > 0, 'L': v.co.x < 0}
            if all(f[c] for c in sel): v.co += Vector(mv)
    o = mesh_obj(name, bm); o.location = loc
    if bevel: bev(o, bevel, seg)
    if mat: assign(o, mat)
    return o

def side_prism(name, pts_yz, width, loc=(0, 0, 0), bevel=0.0, seg=2, mat=None):
    """Extrude a side-view outline [(y, z), ...] (counter-clockwise) across X by width, centred."""
    bm = bmesh.new(); vs = [bm.verts.new((-width / 2, y, z)) for y, z in pts_yz]; f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top: v.co.x += width
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); o = mesh_obj(name, bm); o.location = loc
    if bevel: bev(o, bevel, seg)
    if mat: assign(o, mat)
    return o

def top_prism(name, pts_xy, z0, z1, loc=(0, 0, 0), bevel=0.0, seg=2, mat=None):
    """Extrude a plan-view outline [(x, y), ...] from z0 to z1."""
    bm = bmesh.new(); vs = [bm.verts.new((x, y, z0)) for x, y in pts_xy]; f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top: v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); o = mesh_obj(name, bm); o.location = loc
    if bevel: bev(o, bevel, seg)
    if mat: assign(o, mat)
    return o

def loft(name, sections, cap=True, mat=None, smooth=False):
    """Skin a hull/fuselage through cross-sections along Y. Each section = (y, [(x, z), ...]) with the same point count,
    points ordered around the section (counter-clockwise seen from +Y). Returns the mesh object."""
    n = len(sections[0][1]); V = []; F = []
    for y, pts in sections:
        assert len(pts) == n
        V += [(x, y, z) for x, z in pts]
    for s in range(len(sections) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n; F.append((a + i, a + j, b + j, b + i))
    if cap: F.append(tuple(reversed(range(n)))); F.append(tuple(range((len(sections) - 1) * n, len(sections) * n)))
    o = obj_from(name, V, F)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(o.data); bm.free()
    if mat: assign(o, mat)
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o

def rsec(hw, z0, z1, r=0.0, n=3, chamfer_top=0.0):
    """Rounded-rectangle cross-section points (x, z), CCW from +Y view, corner radius r with n segments per corner.
    chamfer_top narrows the top edge (sloped sides)."""
    pts = []
    corners = [(hw - r, z0 + r, -90), (hw - r - chamfer_top, z1 - r, 0), (-hw + r + chamfer_top, z1 - r, 90), (-hw + r, z0 + r, 180)]
    for cx, cz, a0 in corners:
        if r <= 0: pts.append((cx, cz)); continue
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n); pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts

def tube(name, a, b, r, verts=16, r2=None, mat=None, cap=True):
    """Cylinder from point a to point b (barrels, struts, limbs)."""
    a, b = Vector(a), Vector(b); d = b - a
    o = lib.cyl(name, r, d.length, (a + b) / 2, verts=verts, r2=r2, cap=cap)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    if mat: assign(o, mat)
    return o

def cyl(name, r, depth, loc=(0, 0, 0), axis='Z', verts=24, r2=None, mat=None, bevel=0.0):
    rot = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    o = lib.cyl(name, r, depth, loc, rot, verts=verts, r2=r2, bevel=bevel)
    if mat: assign(o, mat)
    return o

def ball(name, r, loc=(0, 0, 0), scale=(1, 1, 1), seg=16, rings=10, mat=None, cut_below=None):
    o = lib.sphere(name, r, loc, scale, seg, rings, cut_below)
    if mat: assign(o, mat)
    return o

def wheel(name, r, w, loc, mat, hub_mat=None, spokes=6, verts=24):
    """Road wheel (axis X): tyre + recessed disc + hub + bolt ring, joined. Origin at the axle."""
    parts = [cyl(name + '_t', r, w, (0, 0, 0), 'X', verts, mat=mat, bevel=min(0.03, r * 0.12)),
             cyl(name + '_d', r * 0.78, w * 1.06, (0, 0, 0), 'X', verts, mat=hub_mat or mat),
             cyl(name + '_h', r * 0.3, w * 1.25, (0, 0, 0), 'X', 12, mat=hub_mat or mat, bevel=r * 0.04)]
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        parts.append(cyl(name + f'_b{k}', r * 0.05, w * 1.32, (0, r * 0.45 * math.cos(a), r * 0.45 * math.sin(a)), 'X', 6, mat=hub_mat or mat))
    o = join(name, parts); o.location = loc; return o

def grille(name, w, h, n, depth=0.04, slat=0.3, loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
    """n horizontal slats in an XZ frame (faces +Y by default)."""
    parts = [bx(name + '_f', (w, depth, h), (0, 0, 0), bevel=depth * 0.2)]
    gap = h / n
    for i in range(n):
        parts.append(bx(name + f'_s{i}', (w * 0.92, depth * 1.6, gap * slat), (0, depth * 0.35, -h / 2 + gap * (i + 0.5)), rot=(math.radians(-25), 0, 0)))
    o = join(name, parts); o.location = loc; o.rotation_euler = rot
    if mat: assign(o, mat)
    return o

def text_mark(name, text, size, loc, rot=(math.pi / 2, 0, 0), mat=None, depth=0.002, align='CENTER'):
    """Raised text marking (hull numbers, unit IDs). Default rot puts the text upright facing -Y; rotate to suit."""
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = text; cu.size = size; cu.extrude = depth; cu.align_x = align; cu.align_y = 'CENTER'
    try: cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    except Exception: pass
    o = bpy.data.objects.new(name, cu); link(o); o.location = loc; o.rotation_euler = rot
    bpy.context.view_layer.update()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active; o.name = name
    if mat: assign(o, mat)
    return o

def join(name, objs):
    """Apply modifiers + transforms and join into one mesh named name (keeps per-face materials)."""
    objs = [o for o in objs if o]
    for o in objs:
        apply_all(o); _apply_xform(o)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    return o

def _apply_xform(o):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def mirror_x(o, merge=True):
    """Mirror across the model's X=0 plane (left/right symmetry) and apply."""
    m = o.modifiers.new('mir', 'MIRROR'); m.use_axis = (True, False, False); m.use_mirror_merge = merge
    return o

def node(name, loc=(0, 0, 0), par=None, rot=(0, 0, 0)):
    """Named pivot / socket (empty). The game drives these by name."""
    e = bpy.data.objects.new(name, None); e.empty_display_size = 0.2; e.location = loc; e.rotation_euler = rot; link(e)
    if par: parent(e, par)
    return e

def attach(child, par):
    """Parent keeping world transform (and the child's own origin as its pivot)."""
    return parent(child, par)

def pivot_mesh(name, objs, pivot, par=None):
    """Join objs into one mesh whose origin is the pivot point (world), then optionally parent it."""
    o = join(name, objs); set_origin(o, pivot)
    if par: parent(o, par)
    return o

def smooth(o, angle=35):
    """Auto-smooth by angle and weighted normals; applied in place."""
    return shade(o, angle)

def track_uv(o, length_axis='Y', metres_per_u=1.0):
    """Planar UVs for a track belt: U = distance along the belt path in metres / metres_per_u.
    (The game scrolls U by ground distance / metres_per_u.) Uses the angle around the X axis for the wrap-around ends."""
    me = o.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    bpy.context.view_layer.update(); mw = o.matrix_world
    for p in me.polygons:
        for li in p.loop_indices:
            v = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (v.y / metres_per_u + v.z / metres_per_u, (v.x % 1.0))
    o['uv_m'] = metres_per_u
    return o

# ─────────────────────────── finishing: bake, export, previews ───────────────────────────
def mesh_objects(root):
    out = []
    def walk(o):
        if o.type == 'MESH': out.append(o)
        for c in o.children: walk(c)
    walk(root); return out

def bake(uid, objs, size=2048, samples=16):
    """One colour atlas per unit for every material flagged bake; TEAM-group materials keep a separate exported material
    (same atlas) so the game can tint it. Non-baked materials (GLOW_*, GLASS, TRACK_*, DISC_*) are left alone."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = False
    sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True; sc.render.bake.margin = 6
    bake_objs = [o for o in objs if any(m and m.get('bake') for m in o.data.materials)]
    # Cycles' diffuse-colour bake multiplies by (1 − metallic): bake every source at metallic 0, keep the real value for export
    for m in {m for o in bake_objs for m in o.data.materials if m and m.get('bake')}:
        b = m.node_tree.nodes['Principled BSDF']; m['metal_src'] = b.inputs['Metallic'].default_value; b.inputs['Metallic'].default_value = 0.0
    img = bpy.data.images.new(uid + '_atlas', size, size); img.colorspace_settings.name = 'sRGB'
    dummy = bpy.data.images.new('_dummy', 8, 8); seen = set()
    for o in bake_objs:
        for m in o.data.materials:
            if not m or m.name in seen: continue
            seen.add(m.name); t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img if m.get('bake') else dummy; m.node_tree.nodes.active = t
    lib.uv_unwrap(bake_objs, margin=0.004)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in bake_objs: o.select_set(True)
    bpy.context.view_layer.objects.active = bake_objs[0]
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=6)
    img.pack()
    outs = {}
    def out_mat(group):
        if group in outs: return outs[group]
        nm = 'TEAM' if group == 'team' else uid + '_paint'
        src = [m for o in bake_objs for m in o.data.materials if m and m.get('bake') and m.get('group', 'paint') == group]
        om = bpy.data.materials.new(nm); om.use_nodes = True; N = om.node_tree.nodes; b = N['Principled BSDF']; t = N.new('ShaderNodeTexImage'); t.image = img
        om.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = sum(m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value for m in src) / max(1, len(src))
        b.inputs['Metallic'].default_value = sum(m.get('metal_src', 0.0) for m in src) / max(1, len(src))
        outs[group] = om; return om
    for o in bake_objs:
        for i, m in enumerate(o.data.materials):
            if m and m.get('bake'): o.data.materials[i] = out_mat(m.get('group', 'paint'))
    return img

def _clean_materials(objs):
    """Merge duplicate material slots after baking so the GLB has few primitives. Per-face indices are read before and
    written after the slot rebuild: in Blender 4.5 materials.clear() drops the material_index attribute."""
    for o in objs:
        me = o.data; names = [m.name if m else None for m in me.materials]
        uniq = []
        for n in names:
            if n not in uniq: uniq.append(n)
        if len(uniq) == len(names): continue
        remap = [uniq.index(n) for n in names]; mats = [bpy.data.materials.get(n) for n in uniq]
        idx = [0] * len(me.polygons); me.polygons.foreach_get('material_index', idx)
        new = [remap[i] if i < len(remap) else 0 for i in idx]
        me.materials.clear()
        for m in mats: me.materials.append(m)
        me.polygons.foreach_set('material_index', new); me.update()

def dims(objs):
    bpy.context.view_layer.update(); lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH' or o.hide_render: continue
        me = o.evaluated_get(dg).to_mesh(); mw = o.matrix_world
        for v in me.vertices:
            w = mw @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        o.evaluated_get(dg).to_mesh_clear()
    return lo, hi

def check_dims(uid, objs, exclude=()):
    sp = SPEC[uid]['dimensions_m']; lo, hi = dims([o for o in objs if o.name not in exclude])
    got = {'width': hi.x - lo.x, 'length': hi.y - lo.y, 'height': hi.z - lo.z}
    rep = {k: (round(got[k], 3), sp[k], round(got[k] / sp[k], 3)) for k in ('length', 'width', 'height')}
    print(f'[{uid}] dims (got, spec, ratio):', rep, 'zmin', round(lo.z, 3))
    return rep, lo, hi

def finish(uid, root, size=2048, samples=16, preview=True, exclude_dims=(), extras=None, anims=False):
    """Bake, clean, export GLB with extras, save .blend, render the preview sheet. root = the unit's root empty."""
    objs = [o for o in bpy.data.objects if not o.name.startswith('_')]
    meshes = [o for o in objs if o.type == 'MESH' and not o.hide_render]
    rep, lo, hi = check_dims(uid, meshes, exclude_dims)
    t0 = __import__('time').time(); bake(uid, meshes, size, samples); print(f'[{uid}] bake {size}px {round(__import__("time").time() - t0)}s')
    _clean_materials(meshes)
    root['unit'] = uid; root['dims_check'] = json.dumps(rep)
    for k, v in (extras or {}).items(): root[k] = v
    ntri = tris(meshes); root['tris'] = ntri
    print(f'[{uid}] tris {ntri} (LOD0 budget {SPEC[uid]["budget"][0]}), objects {len(objs)}, materials', sorted({m.name for o in meshes for m in o.data.materials if m}))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND, uid + '.blend'), compress=True)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    path = os.path.join(OUT, uid + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_texcoords=True, export_normals=True,
              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=90, export_extras=True, export_animations=anims)
    if anims: kw.update(export_animation_mode='ACTIONS', export_force_sampling=True)
    bpy.ops.export_scene.gltf(**kw)
    print(f'[{uid}] exported {path} {os.path.getsize(path) // 1024} KB')
    if preview: preview_sheet(uid, lo, hi)
    return rep

def _cam(name, loc, target, ortho=None, lens=50):
    cam = bpy.data.objects.get(name) or link(bpy.data.objects.new(name, bpy.data.cameras.new(name)))
    cam.location = loc; d = Vector(target) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho: cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    else: cam.data.type = 'PERSP'; cam.data.lens = lens
    cam.data.clip_end = 2000; return cam

def preview_sheet(uid, lo, hi, samples=24):
    """Hero 3/4 view + front/back/right/top orthographic views on a studio backdrop, composed into <uid>_sheet.png."""
    from PIL import Image, ImageDraw, ImageFont
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = True
    try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('_w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.56, 0.58, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.55
    sun = link(bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN'))); sun.data.energy = 3.2; sun.data.angle = math.radians(8)
    sun.rotation_euler = Euler((math.radians(42), math.radians(18), math.radians(-38)))
    c = (lo + hi) / 2; ext = hi - lo; R = max(ext.x, ext.y, ext.z)
    floor = bx('_floor', (R * 30, R * 30, 0.01), (c.x, c.y, lo.z - 0.006)); assign(floor, flat('_fm', '#9C9890', 0.85, bake=False))
    shots = []
    def shot(tag, cam, rx, ry):
        sc.camera = cam; sc.render.resolution_x = rx; sc.render.resolution_y = ry; p = os.path.join(PREV, f'{uid}_{tag}.png')
        sc.render.filepath = p; bpy.ops.render.render(write_still=True); shots.append((tag, p))
    rs = 0.5 * ext.length; dv = Vector((-1.15, 1.45, 0.8)).normalized() * rs / math.sin(math.radians(14.5))
    hero = _cam('_hero', tuple(c + dv), (c.x, c.y, c.z), lens=50)
    shot('hero', hero, 960, 720)
    m = R * 1.12
    A = 480 / 360   # ortho_scale spans the image width; keep the full height in frame too
    shot('front', _cam('_f', (c.x, c.y + R * 4, c.z), c, ortho=max(ext.x, ext.z * A) * 1.12), 480, 360)
    shot('back', _cam('_b', (c.x, c.y - R * 4, c.z), c, ortho=max(ext.x, ext.z * A) * 1.12), 480, 360)
    shot('right', _cam('_r', (c.x + R * 4, c.y, c.z), c, ortho=max(ext.y, ext.z * A) * 1.1), 480, 360)
    top = _cam('_t', (c.x, c.y, c.z + R * 4), c, ortho=max(ext.x, ext.y * A) * 1.1); top.rotation_euler = Euler((0, 0, 0))
    shot('top', top, 480, 360)
    W, H = 960 + 960, 720 + 40
    sheet = Image.new('RGB', (W, H), (34, 36, 40)); d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(FONT, 22)
    d.text((12, 8), f"{uid} {SPEC[uid]['name']}  —  {SPEC[uid]['faction_name']}  —  L {ext.y:.2f} × W {ext.x:.2f} × H {ext.z:.2f} m", font=f, fill=(230, 232, 236))
    sheet.paste(Image.open(shots[0][1]).convert('RGB'), (0, 40))
    for k, (tag, p) in enumerate(shots[1:]):
        im = Image.open(p).convert('RGB'); x = 960 + (k % 2) * 480; y = 40 + (k // 2) * 360; sheet.paste(im, (x, y)); d.text((x + 8, y + 6), tag.upper(), font=ImageFont.truetype(FONT, 16), fill=(30, 30, 30))
    out = os.path.join(PREV, f'{uid}_sheet.png'); sheet.save(out); print(f'[{uid}] preview {out}')
    for n in ('_sun', '_floor', '_hero', '_f', '_b', '_r', '_t'):
        o = bpy.data.objects.get(n)
        if o: bpy.data.objects.remove(o, do_unlink=True)
    return out
