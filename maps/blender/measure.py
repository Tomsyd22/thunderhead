"""Scale-reference scene: 1 m grid, 1.8 m mannequin, every unit and base building in a line-up with dimension gizmos
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
from ACTUAL evaluated mesh bounds, plus the required comparisons (soldier ↔ tank, personnel door, barracks; tank in the
factory door; patrol boat at the dock).

  blender-env/bin/python maps/blender/measure.py [--render] [--samples N]
Outputs: maps/scenes/00_scale_reference.blend, maps/renders/scale/*.png, maps/assets/measured_bounds.json
"""
import sys, json, math, argparse
from pathlib import Path
import numpy as np
import bpy, bmesh
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).parent))
from scene import NT, new_mat, obj, coll, math_, mixc, TEAM

ROOT = Path(__file__).resolve().parents[1]
SPEC = {'unit_infantry': (None, None, 1.80), 'unit_mbt': (9.50, 3.60, 2.50), 'unit_apc': (7.00, 3.00, 2.80), 'unit_harvester': (10.00, 4.00, 4.00),
        'unit_patrol_boat': (32.00, 7.00, 11.00), 'bld_barracks': (24.00, 12.00, 6.00), 'bld_vehicle_factory': (40.00, 30.00, 12.00),
        'bld_hq': (30.00, 24.00, 10.00), 'bld_ore_refinery': (36.00, 28.00, 16.00), 'bld_power_substation': (20.00, 16.00, 6.00),
        'bld_radar_control': (16.00, 12.00, 6.00), 'bld_extraction_rig': (16.00, 12.00, 12.00), 'bld_naval_dock': (80.00, 40.00, None),
        'prop_container_20': (6.06, 2.44, 2.59), 'prop_container_40': (12.19, 2.44, 2.59)}

def load(name, into):
    p = ROOT / 'assets' / 'blend' / f'{name.split("_walk")[0].split("_kneel")[0] if name.startswith("unit_infantry") else name}.blend'
    if not p.exists(): return None
    with bpy.data.libraries.load(str(p), link=False) as (src, dst):
        if name in src.collections: dst.collections = [name]
    if not dst.collections or not dst.collections[0]: return None
    c = dst.collections[0]; into.children.link(c); return c

def place(c, name, loc, rot=0.0, team='B'):
    """Collection instance (keeps the asset intact) with the team colour as an object property for TEAM_ACCENT."""
    e = bpy.data.objects.new(name, None); e.instance_type = 'COLLECTION'; e.instance_collection = c; e.location = loc; e.rotation_euler = (0, 0, rot)
    bpy.context.scene.collection.objects.link(e); e['team_col'] = TEAM[team]; return e

def world(o):
    """World matrix from the parent chain. Assets sit in an excluded LIB collection, where Blender does not
    refresh matrix_world for parented parts, so it is recomposed here instead of being trusted."""
    m = o.matrix_basis.copy()
    while o.parent is not None:
        m = o.parent.matrix_basis @ o.matrix_parent_inverse @ m; o = o.parent
    return m

def measure(c):
    dg = bpy.context.evaluated_depsgraph_get(); mn = np.full(3, np.inf); mx = -mn; ex = []
    for o in c.all_objects:
        if o.type not in ('MESH', 'CURVE'): continue
        if o.get('exclude_bounds'): ex.append(o.name); continue
        oe = o.evaluated_get(dg); M = np.array(world(o))
        try: me = oe.to_mesh()
        except Exception: continue
        if me and len(me.vertices):
            co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
            w = co @ M[:3, :3].T + M[:3, 3]; mn = np.minimum(mn, w.min(0)); mx = np.maximum(mx, w.max(0))
        oe.to_mesh_clear()
    return mn, mx, ex

def patch_team_mats():
    for m in bpy.data.materials:
        if m.name.startswith('TEAM_ACCENT') and m.use_nodes and not m.get('obj_patched'):
            nt = NT(m.node_tree); b = next((n for n in nt.n if n.type == 'BSDF_PRINCIPLED'), None)
            if not b: continue
            at = nt('ShaderNodeAttribute', (b.location.x - 300, b.location.y), attribute_type='INSTANCER', attribute_name='team_col')
            for lk in list(b.inputs['Base Color'].links): nt.l.remove(lk)
            nt.link(at.outputs['Color'], b.inputs['Base Color']); m['obj_patched'] = True

def text(body, loc, size=1.0, rot=(math.pi / 2, 0, 0), col=(1, 1, 1)):
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = body; cu.size = size; cu.align_x = 'CENTER'; cu.extrude = 0.01
    o = bpy.data.objects.new('label', cu); bpy.context.scene.collection.objects.link(o); o.location = loc; o.rotation_euler = rot
    m = bpy.data.materials.get('label_mat')
    if not m:
        m, nt = new_mat('label_mat'); e = nt('ShaderNodeEmission', (0, 0), i_Strength=1.5); e.inputs['Color'].default_value = (*col, 1); out = nt('ShaderNodeOutputMaterial', (200, 0)); nt.link(e.outputs[0], out.inputs[0])
    cu.materials.append(m); return o

def bar(a, b, w=0.06, col=(1.0, 0.8, 0.1)):
    a, b = Vector(a), Vector(b); d = b - a; L = d.length
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); me = bpy.data.meshes.new('dim'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('dim', me); bpy.context.scene.collection.objects.link(o); o.location = (a + b) / 2; o.scale = (L, w, w)
    o.rotation_euler = d.to_track_quat('X', 'Z').to_euler()
    m = bpy.data.materials.get('dim_mat')
    if not m:
        m, nt = new_mat('dim_mat'); e = nt('ShaderNodeEmission', (0, 0), i_Strength=2.0); e.inputs['Color'].default_value = (*col, 1); out = nt('ShaderNodeOutputMaterial', (200, 0)); nt.link(e.outputs[0], out.inputs[0])
    me.materials.append(m); return o

def gizmo(mn, mx, label_y=None):
    mn, mx = Vector(mn), Vector(mx); ts = max(0.9, min(2.4, (mx.x - mn.x) / 12)); w = max(0.06, ts / 15)  # labels scale with the object so the buildings row stays readable
    y = mn.y - 1.5 * ts / 0.9 if label_y is None else label_y
    bar((mn.x, y, 0.05), (mx.x, y, 0.05), w); text(f'{mx.x - mn.x:.2f} m', ((mn.x + mx.x) / 2, y - 0.2 - ts * 1.1, 0.3), ts, rot=(0, 0, 0))
    bar((mx.x + 1.2 * ts / 0.9, mn.y, 0.05), (mx.x + 1.2 * ts / 0.9, mx.y, 0.05), w); text(f'{mx.y - mn.y:.2f} m', (mx.x + 2.8 * ts / 0.9, (mn.y + mx.y) / 2, 0.3), ts, rot=(0, 0, math.pi / 2))
    bar((mn.x - 1.0, mn.y, 0.0), (mn.x - 1.0, mn.y, mx.z), w); text(f'{mx.z - mn.z:.2f} m', (mn.x - 1.0, mn.y - 0.1, mx.z + 0.6 * ts / 0.9), ts)

def ground(size=(420, 160), center=(150, 20)):
    me = bpy.data.meshes.new('grid_ground'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5); bm.to_mesh(me); bm.free()
    o = obj('grid_ground', me, bpy.context.scene.collection); o.scale = (*size, 1); o.location = (*center, 0)
    m, nt = new_mat('grid'); tc = nt('ShaderNodeTexCoord', (-900, 0)); sep = nt('ShaderNodeSeparateXYZ', (-700, 0)); nt.link(tc.outputs['Object'], sep.inputs[0])
    def lines(period, width):
        fx = math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', math_(nt, 'FRACT', math_(nt, 'DIVIDE', math_(nt, 'MULTIPLY', sep.outputs[0], size[0]), period)), 0.5))
        fy = math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', math_(nt, 'FRACT', math_(nt, 'DIVIDE', math_(nt, 'MULTIPLY', sep.outputs[1], size[1]), period)), 0.5))
        return math_(nt, 'GREATER_THAN', math_(nt, 'MAXIMUM', fx, fy), 0.5 - width / period / 2)
    l1 = lines(1.0, 0.03); l10 = lines(10.0, 0.12)
    col = mixc(nt, (0.30, 0.31, 0.30), (0.62, 0.62, 0.6), l1); col = mixc(nt, col, (0.9, 0.85, 0.3), l10)
    b = nt('ShaderNodeBsdfPrincipled', (200, 0), i_Roughness=0.9); nt.link(col, b.inputs['Base Color']); out = nt('ShaderNodeOutputMaterial', (500, 0)); nt.link(b.outputs[0], out.inputs[0])
    me.materials.append(m)

SPANS = {}  # asset → (x0, x1, height) in the line-up row

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = 32; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 1; sc.cycles.glossy_bounces = 1
    try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Punchy'; sc.view_settings.exposure = -0.3
    except Exception: pass
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = NT(w.node_tree); nt.n.clear()
    sky = nt('ShaderNodeTexSky', (-300, 0), sky_type='NISHITA', sun_elevation=math.radians(40), sun_rotation=math.radians(210)); bg = nt('ShaderNodeBackground', (0, 0), i_Strength=0.35)
    nt.link(sky.outputs[0], bg.inputs[0]); o = nt('ShaderNodeOutputWorld', (200, 0)); nt.link(bg.outputs[0], o.inputs[0])
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 4.0; so = bpy.data.objects.new('Sun', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(-30))
    lib = coll('LIB', exclude=True); ground(size=(900, 460), center=(230, 30))  # covers both line-up views and the vignettes
    order = ['unit_infantry', 'unit_mbt', 'unit_apc', 'unit_harvester', 'prop_container_20', 'prop_container_40', 'bld_barracks', 'bld_power_substation', 'bld_radar_control',
             'bld_extraction_rig', 'bld_hq', 'bld_ore_refinery', 'bld_vehicle_factory', 'unit_patrol_boat']
    res = {}; x = 0.0; cols = {}
    for name in order:
        c = load(name, lib)
        if c is None: res[name] = {'missing': True}; continue
        cols[name] = c; mn, mx, ex = measure(c); size = mx - mn; SPANS[name] = (x, x + float(size[0]), float(size[2]))
        e = place(c, name, (x - mn[0], -mn[1] - size[1] / 2, -mn[2] if name == 'unit_patrol_boat' else 0.0))
        bpy.context.view_layer.update(); wmn = np.array([x, -size[1] / 2, 0]); wmx = wmn + size
        nts = max(1.1, min(2.8, size[0] / 10)); gizmo(wmn, wmx); text(name.replace('bld_', '').replace('unit_', '').replace('prop_', ''), (x + size[0] / 2, -size[1] / 2 - 4.2 * nts / 1.1 - 1.5, 0.3), nts, rot=(0, 0, 0))
        sp = SPEC.get(name); err = None
        if sp: err = max(abs(size[k] - sp[k]) / sp[k] for k in range(3) if sp[k])
        res[name] = {'size_m': [round(float(v), 3) for v in size], 'spec_m': list(sp) if sp else None, 'max_err_pct': round(float(err) * 100, 2) if err is not None else None,
                     'within_1pct': bool(err <= 0.01) if err is not None else None, 'excluded': ex}
        x += size[0] + 8.0
    # mannequin next to the line-up start
    if 'unit_infantry' in cols: place(cols['unit_infantry'], 'mannequin_1.8m', (-6, 0, 0))
    patch_team_mats()
    return res, cols

def vignettes(cols):
    """Comparison set-ups placed north of the line-up (y ≈ 90 m)."""
    sc = bpy.context.scene; Y = 90.0; cams = []
    def cam(name, loc, tgt, lens):
        cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_start = 0.1; o = bpy.data.objects.new(name, cd); sc.collection.objects.link(o); o.location = loc
        o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); cams.append(o); return o
    inf, tank, bar_, fac, boat, dock = (cols.get(k) for k in ('unit_infantry', 'unit_mbt', 'bld_barracks', 'bld_vehicle_factory', 'unit_patrol_boat', 'bld_naval_dock'))
    if bar_ and inf and tank:  # soldier beside a tank beside the barracks
        place(bar_, 'v_barracks', (0, Y, 0)); place(tank, 'v_tank', (8, Y - 13, 0), math.radians(180)); place(inf, 'v_soldier', (2.5, Y - 9.5, 0), math.radians(-60))
        cam('CAM_soldier_tank_barracks', (18, Y - 34, 2.2), (2, Y - 6, 2.5), 32)
        b = json.loads((ROOT / 'assets/bounds/bld_barracks.json').read_text()) if (ROOT / 'assets/bounds/bld_barracks.json').exists() else {}
        d = next((d for d in b.get('doors', []) if d.get('kind') == 'personnel'), None)
        if d:
            dc = d['center']; s = place(inf, 'v_soldier_door', (dc[0] + 1.0, Y + dc[1] - 1.0, 0), math.radians(-80))
            cam('CAM_personnel_door', (dc[0] + 3.0, Y + dc[1] - 6.5, 1.5), (dc[0] + 0.4, Y + dc[1], 1.2), 35)
    if fac and tank:
        X0 = 80.0; place(fac, 'v_factory', (X0, Y, 0))
        b = json.loads((ROOT / 'assets/bounds/bld_vehicle_factory.json').read_text()) if (ROOT / 'assets/bounds/bld_vehicle_factory.json').exists() else {}
        d = next((d for d in b.get('doors', []) if d.get('kind') == 'vehicle'), {'center': [0, -15, 2.5]})
        dc = d['center']; place(tank, 'v_tank_door', (X0 + dc[0], Y + dc[1] - 1.0, 0), math.radians(90))  # half inside the door, driving north
        if inf: place(inf, 'v_soldier_factory', (X0 + dc[0] + 4.6, Y + dc[1] - 4, 0), math.radians(120))
        cam('CAM_tank_factory_door', (X0 + dc[0] + 12, Y + dc[1] - 24, 4.0), (X0 + dc[0], Y + dc[1], 2.5), 32)
    if boat and dock:
        X1 = 200.0; place(dock, 'v_dock', (X1, Y, 0)); place(boat, 'v_boat', (X1, Y - 20 - 3.5 - 1.8, 0))
        if inf:
            for k in range(3): place(inf, f'v_crew{k}', (X1 - 6 + k * 3, Y - 14, 3.0), math.radians(-90 + k * 20))
        wm, wnt = new_mat('water_plain'); wb = wnt('ShaderNodeBsdfPrincipled', (0, 0), i_Roughness=0.05); wb.inputs['Base Color'].default_value = (0.01, 0.05, 0.07, 1)
        wo = wnt('ShaderNodeOutputMaterial', (300, 0)); wnt.link(wb.outputs[0], wo.inputs[0])
        me = bpy.data.meshes.new('water'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5); bm.to_mesh(me); bm.free(); me.materials.append(wm)
        wo_ = obj('water', me, sc.collection); wo_.scale = (160, 60, 1); wo_.location = (X1, Y - 45, 0.0)
        cam('CAM_boat_dock', (X1 + 30, Y - 70, 9), (X1, Y - 22, 3), 30)
    return cams

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--render', action='store_true'); ap.add_argument('--samples', type=int, default=32)
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    res, cols = build(); cols['bld_naval_dock'] = load('bld_naval_dock', bpy.data.collections['LIB']); patch_team_mats()
    cams = vignettes(cols)
    (ROOT / 'assets' / 'measured_bounds.json').write_text(json.dumps(res, indent=1)); print(json.dumps(res, indent=1))
    sc = bpy.context.scene; out = ROOT / 'renders' / 'scale'; out.mkdir(parents=True, exist_ok=True)
    # line-ups: two orthographic views looking north at 30° down, each framed to its own row extent (units + containers; buildings + boat)
    lineups = []
    for nm, members in (('CAM_lineup_units', [k for k in SPANS if k.startswith('unit_') and k != 'unit_patrol_boat' or k.startswith('prop_container')]),
                        ('CAM_lineup_buildings', [k for k in SPANS if k.startswith('bld_') or k == 'unit_patrol_boat'])):
        if not members: continue
        x0 = min(SPANS[k][0] for k in members) - (9 if nm.endswith('units') else 6); x1 = max(SPANS[k][1] for k in members) + 6; cx = (x0 + x1) / 2
        cd = bpy.data.cameras.new(nm); cd.type = 'ORTHO'; cd.ortho_scale = (x1 - x0) * 1.04; cd.clip_end = 2000
        co = bpy.data.objects.new(nm, cd); sc.collection.objects.link(co); co.location = (cx, -173.2, 100.0 + max(SPANS[k][2] for k in members) * 0.4)
        co.rotation_euler = (Vector((cx, 0.0, max(SPANS[k][2] for k in members) * 0.4)) - co.location).to_track_quat('-Z', 'Y').to_euler(); lineups.append(co)
    vign = [o for o in sc.objects if o.name.startswith('v_') or o.name == 'water']
    cams = lineups + cams
    p = ROOT / 'scenes' / '00_scale_reference.blend'; p.parent.mkdir(exist_ok=True); bpy.context.preferences.filepaths.save_version = 0; bpy.ops.wm.save_as_mainfile(filepath=str(p), compress=True)
    if a.render:
        sc.cycles.samples = a.samples
        for c in cams:
            for o in vign: o.hide_render = c.name.startswith('CAM_lineup')  # the comparison vignettes stand behind the line-up row
            sc.camera = c; sc.render.resolution_x, sc.render.resolution_y = (2400, 900) if c.name.startswith('CAM_lineup') else (1400, 900)
            sc.render.filepath = str(out / f"{c.name[4:]}.png"); bpy.ops.render.render(write_still=True); print('rendered', c.name)
