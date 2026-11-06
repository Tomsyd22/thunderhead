"""Assemble a Thunderhead map as an editable Blender scene from the generated data, then render its camera presets.

  blender-env/bin/python maps/blender/scene.py <id> [--render all|overview|gameplay|base|harbor|detail] [--samples N] [--res WxH] [--nosave]
  blender -b --python maps/blender/scene.py -- <id> --from-blend --render overview,gameplay --samples 24   (render the saved scene, e.g. on the Mac GPU)

Inputs:  maps/build/<id>/{height.npy, surface.npz, meta.json, instances.json}, maps/assets/blend/*.blend
Outputs: maps/scenes/<id>_<name>.blend, maps/renders/<id>/preset_<n>_<name>.png
Scene structure (collections): TERRAIN (128 m chunks), WATER, ROADS, STRUCTURES (bridges, trestles, lanes), INSTANCES (one
geometry-nodes point cloud per asset — editable by moving points; stable IDs in Text blocks ids_<asset>), DEMO (demonstration
units only — disable for an empty multiplayer start), COLLISION (coarse static boxes, wireframe, never rendered), GRASS
(near-camera clumps), OVERLAY (overview only), LIB (appended asset collections, excluded from the view layer), CAMERAS.
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu, describe as gpu_describe  # render device: GPU (tools/blender_gpu.py)
import sys, os, json, math, argparse, time
from pathlib import Path
import numpy as np
try: from scipy import ndimage as ndi
except ImportError: ndi = None   # render-only runs (--from-blend) in Blender's own Python need no scipy
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

ROOT = Path(__file__).resolve().parents[1]
# camera presets: title, render size, overview overlay, near-camera grass (presets() places the cameras; renders read this)
PRESET_META = {'overview': dict(title='Entire-map overview', res=(1800, 1440), overlay=True, grass=False),
               'gameplay': dict(title='Standard gameplay view', res=(1600, 900), grass=True),
               'base': dict(title='Base close-up', res=(1600, 900), grass=True),
               'harbor': dict(title='Harbour close-up', res=(1600, 900), grass=True),
               'detail': dict(title='Biome detail close-up', res=(1600, 900), grass=True)}
PRESET_ORDER = list(PRESET_META)
sys.path.insert(0, str(ROOT / 'gen'))
TEAM = {'B': (0.169, 0.435, 0.839, 1.0), 'R': (0.784, 0.196, 0.169, 1.0), None: (0.5, 0.5, 0.5, 1.0)}
SURF = {'grass': 0, 'meadow': 1, 'dirt': 2, 'sand': 3, 'rock': 4, 'concrete': 5, 'gravel': 6, 'asphalt': 7, 'mud': 8, 'farm': 9,
        'soil': 10, 'forest': 11, 'wetsand': 12, 'quarry': 13}
PAL = {  # biome palettes (linear-ish sRGB)
    '01': dict(grass=(0.19, 0.30, 0.07), grass2=(0.32, 0.38, 0.11), dry=(0.47, 0.45, 0.22), sand=(0.72, 0.66, 0.50), rock=(0.62, 0.60, 0.55), rock2=(0.45, 0.44, 0.41),
               soil=(0.36, 0.31, 0.24), water=(0.05, 0.42, 0.40), absorb=(0.55, 0.85, 0.80), sun=(42, 215), sky_turb=2.2),
    '02': dict(grass=(0.20, 0.33, 0.08), grass2=(0.30, 0.40, 0.10), dry=(0.42, 0.42, 0.20), sand=(0.55, 0.47, 0.33), rock=(0.35, 0.33, 0.30), rock2=(0.25, 0.24, 0.22),
               soil=(0.33, 0.27, 0.19), water=(0.10, 0.36, 0.28), absorb=(0.45, 0.75, 0.55), sun=(48, 205), sky_turb=3.0),
    '03': dict(grass=(0.20, 0.30, 0.09), grass2=(0.30, 0.34, 0.12), dry=(0.42, 0.40, 0.24), sand=(0.55, 0.52, 0.45), rock=(0.50, 0.49, 0.47), rock2=(0.36, 0.35, 0.34),
               soil=(0.30, 0.27, 0.22), water=(0.02, 0.12, 0.24), absorb=(0.25, 0.50, 0.75), sun=(38, 200), sky_turb=2.0),
    '04': dict(grass=(0.22, 0.38, 0.08), grass2=(0.36, 0.45, 0.12), dry=(0.55, 0.52, 0.30), sand=(0.92, 0.88, 0.76), rock=(0.22, 0.21, 0.21), rock2=(0.15, 0.15, 0.15),
               soil=(0.42, 0.36, 0.26), water=(0.02, 0.45, 0.55), absorb=(0.30, 0.90, 0.88), sun=(58, 220), sky_turb=2.4),
    '05': dict(grass=(0.26, 0.32, 0.09), grass2=(0.40, 0.40, 0.16), dry=(0.55, 0.48, 0.25), sand=(0.66, 0.58, 0.44), rock=(0.58, 0.40, 0.27), rock2=(0.42, 0.28, 0.19),
               soil=(0.48, 0.32, 0.20), water=(0.03, 0.22, 0.38), absorb=(0.35, 0.65, 0.85), sun=(34, 235), sky_turb=2.6,
               gravel=((0.30, 0.15, 0.08), (0.46, 0.25, 0.13))),  # copper-coloured quarry cuts and ore pads
}

# ───────────────────────── generic helpers ─────────────────────────
def coll(name, parent=None, exclude=False):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in [x.name for x in (parent or bpy.context.scene.collection).children]: (parent or bpy.context.scene.collection).children.link(c)
    if exclude:
        def find(lc):
            if lc.collection == c: return lc
            for ch in lc.children:
                r = find(ch)
                if r: return r
        lc = find(bpy.context.view_layer.layer_collection)
        if lc: lc.exclude = True
    return c

def grid_mesh(name, xs, ys, Z, uv_fn=None):
    """Quad grid mesh from axis arrays and heights Z[ny, nx], built with foreach_set (fast)."""
    me = bpy.data.meshes.new(name); nx, ny = len(xs), len(ys); X, Y = np.meshgrid(xs, ys)
    co = np.c_[X.ravel(), Y.ravel(), Z.ravel()].astype(np.float32)
    me.vertices.add(len(co)); me.vertices.foreach_set('co', co.ravel())
    idx = np.arange(nx * ny).reshape(ny, nx)
    q = np.c_[idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()]
    me.loops.add(q.size); me.loops.foreach_set('vertex_index', q.ravel().astype(np.int32))
    me.polygons.add(len(q)); me.polygons.foreach_set('loop_start', np.arange(0, q.size, 4, dtype=np.int32))
    me.update(calc_edges=True)
    if uv_fn is not None:
        uv = me.uv_layers.new(name='UVMap'); u, v = uv_fn(co[q.ravel(), 0], co[q.ravel(), 1]); uv.data.foreach_set('uv', np.c_[u, v].ravel().astype(np.float32))
    me.polygons.foreach_set('use_smooth', np.ones(len(q), bool))
    return me

def obj(name, me, c):
    o = bpy.data.objects.new(name, me); c.objects.link(o); return o

class NT:
    """Tiny node-tree builder."""
    def __init__(self, tree): self.t = tree; self.n = tree.nodes; self.l = tree.links
    def __call__(self, typ, loc=(0, 0), **kw):
        nd = self.n.new(typ); nd.location = loc
        for k, v in kw.items():
            if k.startswith('i_'):
                key = k[2:]; key = int(key) if key.isdigit() else key.replace('_', ' ')
                nd.inputs[key].default_value = v
            else: setattr(nd, k, v)
        return nd
    def link(self, a, b): self.l.new(a, b); return b

def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; m.node_tree.nodes.clear(); return m, NT(m.node_tree)

def noise(nt, scale, detail=4.0, rough=0.55, loc=(0, 0), coord=None, w=None):
    n = nt('ShaderNodeTexNoise', loc, i_Scale=scale, i_Detail=min(detail, 4.0), i_Roughness=rough)  # capped detail: render cost
    if coord is not None: nt.link(coord, n.inputs['Vector'])
    return n

def ramp(nt, src, stops, loc=(0, 0)):
    r = nt('ShaderNodeValToRGB', loc); el = r.color_ramp.elements
    for k, (p, c) in enumerate(stops):
        e = el[k] if k < 2 else el.new(p); e.position = p; e.color = (*c, 1) if len(c) == 3 else c
    nt.link(src, r.inputs['Fac']); return r

def mixc(nt, a, b, fac, loc=(0, 0)):
    m = nt('ShaderNodeMix', loc, data_type='RGBA', blend_type='MIX'); nt.link(fac, m.inputs['Factor'])
    for sock, val in ((6, a), (7, b)):
        if isinstance(val, tuple): m.inputs[sock].default_value = (*val, 1) if len(val) == 3 else val
        else: nt.link(val, m.inputs[sock])
    return m.outputs[2]

def mixf(nt, a, b, fac, loc=(0, 0)):
    m = nt('ShaderNodeMix', loc, data_type='FLOAT'); nt.link(fac, m.inputs['Factor'])
    for sock, val in ((2, a), (3, b)):
        if isinstance(val, (int, float)): m.inputs[sock].default_value = val
        else: nt.link(val, m.inputs[sock])
    return m.outputs[0]

def math_(nt, op, a, b=None, loc=(0, 0), clamp=False):
    m = nt('ShaderNodeMath', loc, operation=op, use_clamp=clamp)
    for k, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, (int, float)): m.inputs[k].default_value = v
        else: nt.link(v, m.inputs[k])
    return m.outputs[0]

def image_from(name, arr):
    """float32 RGBA [h, w, 4] (row 0 = south) → PNG on disk (maps/build/tex/) → loaded + packed non-colour image."""
    from PIL import Image as _I
    d = ROOT / 'build' / 'tex'; d.mkdir(parents=True, exist_ok=True); p = d / f'{name}.png'
    _I.fromarray((np.clip(arr[::-1, :, :3], 0, 1) * 255 + 0.5).astype(np.uint8)).save(p)  # PNG row 0 = top = north
    im = bpy.data.images.load(str(p), check_existing=False); im.name = name; im.colorspace_settings.name = 'Non-Color'; im.pack(); return im

# ───────────────────────── scene builder ─────────────────────────
for _k, _p in PAL.items():  # albedos: real vegetation/soil is dark (linear 0.05–0.15)
    for _n in ('grass', 'grass2', 'dry', 'soil'): _p[_n] = tuple(round(c * 0.5, 3) for c in _p[_n])
    for _n in ('rock', 'rock2', 'sand'): _p[_n] = tuple(round(c * 0.8, 3) for c in _p[_n])

class Scene:
    def __init__(self, mid):
        self.mid = mid; self.b = ROOT / 'build' / mid
        self.h = np.load(self.b / 'height.npy'); S = np.load(self.b / 'surface.npz'); self.surf = S['surf']; self.grass = S['grass'].astype(np.float32)
        self.meta = json.loads((self.b / 'meta.json').read_text()); self.inst = json.loads((self.b / 'instances.json').read_text())
        self.R = self.meta['res']; self.n = self.h.shape[0]; self.S = self.meta['size_m']; self.pal = PAL[mid]; self.lib = {}; self.missing = set()

    def setup(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene; sc.name = f"{self.mid} {self.meta['name']}"; sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
        sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.03
        sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 1; sc.cycles.glossy_bounces = 1; sc.cycles.transmission_bounces = 2; sc.cycles.transparent_max_bounces = 24
        sc.render.use_persistent_data = True
        sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False; sc.cycles.sample_clamp_indirect = 8
        sc.cycles.use_denoising = True
        try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Punchy'; sc.view_settings.exposure = -0.35
        except Exception: pass
        sc.render.film_transparent = False
        for k in ('TERRAIN', 'WATER', 'ROADS', 'STRUCTURES', 'INSTANCES', 'DEMO', 'COLLISION', 'GRASS', 'OVERLAY', 'CAMERAS'): coll(k)
        self.LIB = coll('LIB', exclude=True)
        sc['thunderhead_map'] = self.mid; sc['size_m'] = self.S; sc['seed'] = self.meta['seed']

    # ── world & light ──
    def world(self):
        w = bpy.data.worlds.new('Sky'); bpy.context.scene.world = w; w.use_nodes = True; nt = NT(w.node_tree); nt.n.clear()
        el, az = self.pal['sun']
        sky = nt('ShaderNodeTexSky', (-300, 0), sky_type='NISHITA', sun_elevation=math.radians(el), sun_rotation=math.radians(az), air_density=1.0, dust_density=self.pal['sky_turb'], ozone_density=1.0)
        try: sky.sun_disc = False
        except Exception: pass
        # fair-weather cumulus: noise projected on a plane above the camera, faded toward the horizon
        tc = nt('ShaderNodeTexCoord', (-900, -300)); sepd = nt('ShaderNodeSeparateXYZ', (-700, -300)); nt.link(tc.outputs['Generated'], sepd.inputs[0])
        zc = math_(nt, 'MAXIMUM', sepd.outputs[2], 0.02); px = math_(nt, 'DIVIDE', sepd.outputs[0], zc); py = math_(nt, 'DIVIDE', sepd.outputs[1], zc)
        cv = nt('ShaderNodeCombineXYZ', (-400, -300)); nt.link(px, cv.inputs[0]); nt.link(py, cv.inputs[1])
        cn = nt('ShaderNodeTexNoise', (-200, -300), i_Scale=0.9, i_Detail=6.0, i_Roughness=0.6); nt.link(cv.outputs[0], cn.inputs['Vector'])
        cm = ramp(nt, cn.outputs['Fac'], [(0.56, (0, 0, 0)), (0.72, (1, 1, 1))], (0, -300))
        horizon = nt('ShaderNodeMapRange', (0, -500), i_1=0.02, i_2=0.25); nt.link(sepd.outputs[2], horizon.inputs[0])
        cf = math_(nt, 'MULTIPLY', math_(nt, 'MULTIPLY', cm.outputs[0], horizon.outputs[0]), 0.85)
        cloud = nt('ShaderNodeMix', (200, -200), data_type='RGBA', blend_type='MIX'); cloud.inputs[0].default_value = 0.0
        cloud.inputs[6].default_value = (4.2, 4.25, 4.4, 1.0); cloud.inputs[7].default_value = (4.2, 4.25, 4.4, 1.0)  # radiance-scale white (sky is HDR)
        skyc = mixc(nt, sky.outputs[0], cloud.outputs[2], cf)
        bg = nt('ShaderNodeBackground', (300, 0), i_Strength=0.32); nt.link(skyc, bg.inputs[0]); out = nt('ShaderNodeOutputWorld', (500, 0)); nt.link(bg.outputs[0], out.inputs[0])
        sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 4.2; sun.angle = math.radians(0.6); sun.color = (1.0, 0.96, 0.9)
        o = bpy.data.objects.new('Sun', sun); bpy.context.scene.collection.objects.link(o)
        o.rotation_euler = Euler((math.radians(90 - el), 0, math.radians(az + 90)), 'XYZ')

    # ── terrain ──
    def terrain_images(self):
        s = self.surf; R = self.R; land = s != 255
        def m(*names): return np.isin(s, [SURF[k] for k in names]).astype(np.float32)
        from scipy import ndimage as ndi
        blur = lambda a, sg=0.8: ndi.gaussian_filter(a, sg)
        dw = ndi.distance_transform_edt(self.h > 0) * R
        wet = ((dw < 4) & (self.h < 1.4)).astype(np.float32)
        one = np.ones(s.shape, np.float32)
        gy, gx = np.gradient(self.h, R); sl = np.degrees(np.arctan(np.hypot(gx, gy)))
        rockw = np.maximum(blur(m('rock'), 1.0), np.clip((sl - 26) / 14, 0, 1))  # slope → rock even where the class map did not say so
        # RGB only (alpha is unreliable through packing): A rock/sand/dirt, B concrete/gravel/asphalt, C mud/farm/soil, D forest/meadow/wet
        A = np.stack([rockw, blur(m('sand', 'wetsand')), blur(m('dirt')), one], -1)
        B = np.stack([blur(m('concrete'), 0.5), np.maximum(blur(m('gravel', 'quarry')), m('quarry')), blur(m('asphalt'), 0.5), one], -1)
        C = np.stack([blur(m('mud')), blur(m('farm'), 0.5), blur(m('soil')), one], -1)
        D = np.stack([blur(m('forest'), 1.5), blur(m('meadow'), 1.5), blur(wet, 1.2), one], -1)
        return [image_from(f'{self.mid}_splat_{k}', a) for k, a in zip('ABCD', (A, B, C, D))], sl

    def terrain_material(self, imgs):
        P = self.pal; m, nt = new_mat('Terrain'); self.terrain_mat = m
        tc = nt('ShaderNodeTexCoord', (-1800, 0)); uvn = nt('ShaderNodeUVMap', (-1800, -300), uv_map='UVMap')
        tex = []
        for k, im in enumerate(imgs):
            t = nt('ShaderNodeTexImage', (-1500, -400 * k), image=im, interpolation='Cubic', extension='EXTEND'); nt.link(uvn.outputs[0], t.inputs[0])
            sep = nt('ShaderNodeSeparateColor', (-1250, -400 * k)); nt.link(t.outputs['Color'], sep.inputs[0]); tex.append((sep.outputs[0], sep.outputs[1], sep.outputs[2]))
        obj_co = tc.outputs['Object']
        # organic transitions: perturb weights with world-space noise
        n_edge = noise(nt, 0.09, 6, 0.6, (-1250, 600), obj_co)
        def W(sock, k=0.45, lo=0.28, hi=0.62):
            a = math_(nt, 'ADD', sock, math_(nt, 'MULTIPLY', math_(nt, 'SUBTRACT', n_edge.outputs['Fac'], 0.5), k))
            mr = nt('ShaderNodeMapRange', (-900, 0), i_1=lo, i_2=hi); nt.link(a, mr.inputs[0]); return mr.outputs[0]
        (rock, sand, dirt), (conc, grav, asph), (mud, farm, soil), (forest, meadow, wet) = tex
        # grass: macro patches + micro variation + dry tufts
        n1 = noise(nt, 0.012, 3, 0.5, (-900, 900), obj_co); n2 = noise(nt, 0.18, 8, 0.65, (-900, 750), obj_co); n3 = noise(nt, 2.2, 4, 0.6, (-900, 600), obj_co)
        g = ramp(nt, n1.outputs['Fac'], [(0.3, P['grass']), (0.7, P['grass2'])], (-650, 900))
        gcol = mixc(nt, g.outputs[0], P['dry'], math_(nt, 'MULTIPLY', ramp(nt, n2.outputs['Fac'], [(0.55, (0, 0, 0)), (0.75, (1, 1, 1))]).outputs[0], 0.55))
        gcol = mixc(nt, gcol, tuple(c * 0.55 for c in P['grass']), math_(nt, 'MULTIPLY', n3.outputs['Fac'], 0.35))
        # meadow: lighter, flower specks
        vor = nt('ShaderNodeTexVoronoi', (-900, 450), i_Scale=1.6); nt.link(obj_co, vor.inputs['Vector'])
        speck = ramp(nt, vor.outputs['Distance'], [(0.0, (1, 1, 1)), (0.08, (0, 0, 0))])
        mcol = mixc(nt, tuple(min(1, c * 1.25) for c in P['grass2']), (0.85, 0.82, 0.55), math_(nt, 'MULTIPLY', speck.outputs[0], 0.5))
        col = mixc(nt, gcol, mcol, W(meadow))
        def layer(base, var, scale, sock, k=0.45, lo=0.28, hi=0.62, loc=(0, 0)):
            nz = noise(nt, scale, 6, 0.6, loc, obj_co); r = ramp(nt, nz.outputs['Fac'], [(0.35, base), (0.65, var)])
            return r.outputs[0], W(sock, k, lo, hi)
        forest_c, wf = layer(tuple(c * 0.55 for c in P['soil']), (0.16, 0.20, 0.08), 1.3, forest); col = mixc(nt, col, forest_c, math_(nt, 'MULTIPLY', wf, 0.85))
        soil_c, ws = layer(P['soil'], tuple(c * 1.25 for c in P['soil']), 0.7, soil); col = mixc(nt, col, soil_c, ws)
        dirt_c, wd = layer(tuple(c * 0.9 for c in P['soil']), (0.40, 0.33, 0.24), 1.1, dirt); col = mixc(nt, col, dirt_c, wd)
        farm_n = nt('ShaderNodeTexWave', (-900, -200), wave_type='BANDS', bands_direction='X', i_Scale=0.25, i_Distortion=0.6); nt.link(obj_co, farm_n.inputs['Vector'])
        farm_c = ramp(nt, farm_n.outputs['Fac'], [(0.35, (0.25, 0.20, 0.12)), (0.6, (0.22, 0.34, 0.08))]).outputs[0]; col = mixc(nt, col, farm_c, W(farm, lo=0.3, hi=0.55))
        mud_c, wm = layer((0.20, 0.17, 0.12), (0.28, 0.24, 0.17), 0.9, mud); col = mixc(nt, col, mud_c, wm)
        sand_c, wsd = layer(P['sand'], tuple(min(1, c * 1.1) for c in P['sand']), 0.45, sand, lo=0.3, hi=0.6); col = mixc(nt, col, sand_c, wsd)
        g0, g1 = P.get('gravel', ((0.36, 0.34, 0.31), (0.50, 0.47, 0.42)))
        grav_c, wg = layer(g0, g1, 6.0, grav, lo=0.3, hi=0.55); col = mixc(nt, col, grav_c, wg)
        rk = noise(nt, 0.35, 10, 0.7, (-900, -900), obj_co); strata = nt('ShaderNodeTexWave', (-900, -1050), wave_type='BANDS', bands_direction='Z', i_Scale=0.9, i_Distortion=4.0, i_Detail=4.0); nt.link(obj_co, strata.inputs['Vector'])
        rock_c = mixc(nt, ramp(nt, rk.outputs['Fac'], [(0.3, P['rock2']), (0.7, P['rock'])]).outputs[0], P['rock2'], math_(nt, 'MULTIPLY', strata.outputs['Fac'], 0.4))
        col = mixc(nt, col, rock_c, W(rock, 0.5, 0.25, 0.6))
        # concrete with 6 m expansion joints + stains
        brick = nt('ShaderNodeTexBrick', (-900, -1250), offset=0.0, i_Scale=1 / 6.0, i_Mortar_Size=0.012, i_Color1=(0.40, 0.39, 0.37, 1), i_Color2=(0.35, 0.345, 0.33, 1), i_Mortar=(0.16, 0.16, 0.155, 1), i_Brick_Width=1.0, i_Row_Height=1.0)
        nt.link(obj_co, brick.inputs['Vector']); stain = noise(nt, 0.15, 5, 0.6, (-900, -1450), obj_co)
        conc_c = mixc(nt, brick.outputs['Color'], (0.22, 0.215, 0.20), math_(nt, 'MULTIPLY', ramp(nt, stain.outputs['Fac'], [(0.5, (0, 0, 0)), (0.75, (1, 1, 1))]).outputs[0], 0.5))
        col = mixc(nt, col, conc_c, math_(nt, 'GREATER_THAN', conc, 0.5))
        asph_c = ramp(nt, noise(nt, 3.0, 6, 0.6, (-900, -1650), obj_co).outputs['Fac'], [(0.4, (0.07, 0.07, 0.075)), (0.6, (0.12, 0.12, 0.12))]).outputs[0]
        col = mixc(nt, col, asph_c, math_(nt, 'GREATER_THAN', asph, 0.5))
        # wet shoreline band darkens and turns glossy
        wwet = W(wet, 0.3, 0.2, 0.7)
        dark = nt('ShaderNodeMix', (300, 0), data_type='RGBA', blend_type='MULTIPLY'); nt.link(wwet, dark.inputs['Factor']); nt.link(col, dark.inputs[6]); dark.inputs[7].default_value = (0.55, 0.55, 0.55, 1); col = dark.outputs[2]
        rough = mixf(nt, 0.92, 0.35, wwet); rough = mixf(nt, rough, 0.75, math_(nt, 'GREATER_THAN', conc, 0.5))
        # bump: grass clumps, rock relief, gravel grain
        bh = math_(nt, 'ADD', math_(nt, 'MULTIPLY', n3.outputs['Fac'], 0.6), math_(nt, 'MULTIPLY', rk.outputs['Fac'], W(rock, 0.5, 0.25, 0.6)))
        bump = nt('ShaderNodeBump', (400, -300), i_Strength=0.35, i_Distance=0.4); nt.link(bh, bump.inputs['Height'])
        bs = nt('ShaderNodeBsdfPrincipled', (600, 0)); nt.link(col, bs.inputs['Base Color']); nt.link(rough, bs.inputs['Roughness']); nt.link(bump.outputs[0], bs.inputs['Normal'])
        bs.inputs['Specular IOR Level'].default_value = 0.35
        out = nt('ShaderNodeOutputMaterial', (900, 0)); nt.link(bs.outputs[0], out.inputs[0]); return m

    def terrain(self, chunk=128.0):
        t0 = time.time(); imgs, self.slope = self.terrain_images(); mat = self.terrain_material(imgs); C = bpy.data.collections['TERRAIN']
        R = self.R; n = self.n; S = self.S; cells = int(chunk / R); count = 0; tris = 0
        uvf = lambda x, y: ((x / R + 0.5) / n, (y / R + 0.5) / n)
        for cj in range(0, n - 1, cells):
            for ci in range(0, n - 1, cells):
                j1, i1 = min(cj + cells, n - 1), min(ci + cells, n - 1); Z = self.h[cj:j1 + 1, ci:i1 + 1]
                step = 4 if Z.max() < -7 else 1  # deep water chunks at 8 m, everything else at 2 m
                Zs = Z[::step, ::step]
                if Zs.shape[0] < 2 or Zs.shape[1] < 2: continue
                xs = (ci + np.arange(Zs.shape[1]) * step) * R; ys = (cj + np.arange(Zs.shape[0]) * step) * R
                me = grid_mesh(f'terrain_{cj // cells:02d}_{ci // cells:02d}', xs, ys, Zs, uvf); me.materials.append(mat)
                o = obj(me.name, me, C); count += 1; tris += 2 * (Zs.shape[0] - 1) * (Zs.shape[1] - 1)
        self.stats = {'terrain_chunks': count, 'terrain_tris': tris}; print(f'  terrain {count} chunks, {tris / 1e6:.2f} M tris, {time.time() - t0:.0f}s')
        self.skirt()

    def skirt(self):
        """Non-playable scenery ring (16 m resolution) so the overview does not end at a hard edge: edge heights continue
        outward, rising gently into low wooded hills on land edges; sea edges stay sea."""
        from scipy import ndimage as ndi
        R = self.R; n = self.n; S = self.S; pad = 1600.0; st = 16.0; k = int(st / R)
        hs = self.h[::k, ::k]; m = hs.shape[0]; p = int(pad / st)
        H = np.pad(hs, p, mode='edge').astype(np.float32)
        yy, xx = np.mgrid[0:H.shape[0], 0:H.shape[1]]; dx = np.maximum(np.maximum(p - xx, xx - (p + m - 1)), 0); dy = np.maximum(np.maximum(p - yy, yy - (p + m - 1)), 0)
        dd = np.hypot(dx, dy) * st; rng = np.random.default_rng(self.meta['seed'])
        hills = ndi.zoom(rng.standard_normal((40, 40)), H.shape[0] / 40, order=3)[:H.shape[0], :H.shape[1]] * 18 + 22
        land_edge = H > 1; H = np.where(land_edge & (dd > 0), H + np.clip(dd / 600, 0, 1) * np.maximum(hills, 0), H)
        H = np.where((~land_edge) & (dd > 0), np.minimum(H, -20.0), H)
        H[p + 1:p + m - 1, p + 1:p + m - 1] = -300.0  # hole where the playable terrain is (the edge ring overlaps the terrain edge)
        xs = (np.arange(H.shape[1]) - p) * st; ys = (np.arange(H.shape[0]) - p) * st
        # sample one plain-grass texel for the whole skirt (edge-clamped splats would smear into stripes)
        gj, gi = np.argwhere(self.surf[::8, ::8] == SURF['grass'])[0] * 8 if (self.surf == SURF['grass']).any() else (0, 0)
        u0, v0 = (gi + 0.5) / n, (gj + 0.5) / n
        me = grid_mesh('skirt_nonplayable', xs, ys, H, lambda x, y: (np.full_like(x, u0), np.full_like(y, v0)))
        # delete the hole faces
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -250], context='VERTS'); bm.to_mesh(me); bm.free()
        me.materials.append(self.terrain_mat); o = obj('skirt_nonplayable', me, bpy.data.collections['TERRAIN']); o['nonplayable'] = True

    # ── water ──
    def water(self):
        """Fast, readable water: colour from the true depth map (shallow turquoise → deep), partial transparency over
        shallows so sand/coral read through, sky reflections via a glossy surface with wave bump, foam band at the shore."""
        from scipy import ndimage as ndi
        P = self.pal; m, nt = new_mat('Water'); C = bpy.data.collections['WATER']
        land = self.h > 0; dl = ndi.distance_transform_edt(~land) * self.R
        foam = np.clip(1 - dl / 7.0, 0, 1) * (self.h < 0.2); foam = ndi.gaussian_filter(foam.astype(np.float32), 1.0)
        depth = np.clip(-self.h / 30.0, 0, 1).astype(np.float32)
        fim = image_from(f'{self.mid}_water', np.stack([foam, ndi.gaussian_filter(depth, 1.0), np.zeros_like(foam), np.ones_like(foam)], -1))
        tc = nt('ShaderNodeTexCoord', (-1400, 0)); uvn = nt('ShaderNodeUVMap', (-1400, -200), uv_map='UVMap')
        fi = nt('ShaderNodeTexImage', (-1100, -300), image=fim, extension='EXTEND', interpolation='Cubic'); nt.link(uvn.outputs[0], fi.inputs[0])
        sep = nt('ShaderNodeSeparateColor', (-900, -300)); nt.link(fi.outputs['Color'], sep.inputs[0]); foam_s, depth_s = sep.outputs[0], sep.outputs[1]
        w1 = noise(nt, 0.06, 6, 0.6, (-1100, 300), tc.outputs['Object']); w2 = noise(nt, 0.7, 4, 0.5, (-1100, 150), tc.outputs['Object'])
        wh = math_(nt, 'ADD', w1.outputs['Fac'], math_(nt, 'MULTIPLY', w2.outputs['Fac'], 0.4))
        bump = nt('ShaderNodeBump', (-700, 200), i_Strength=0.35, i_Distance=0.3); nt.link(wh, bump.inputs['Height'])
        mid = tuple(c * 0.22 for c in P['water']); shallow = tuple(min(1, c * 0.6 + 0.02) for c in P['water']); deep = tuple(c * 0.06 for c in P['water'])
        cr = ramp(nt, depth_s, [(0.0, shallow), (0.12, mid)], (-700, -100)); el = cr.color_ramp.elements.new(0.55); el.color = (*deep, 1)
        surf = nt('ShaderNodeBsdfPrincipled', (-400, 200), i_Roughness=0.07, i_IOR=1.333); nt.link(cr.outputs[0], surf.inputs['Base Color']); nt.link(bump.outputs[0], surf.inputs['Normal'])
        surf.inputs['Specular IOR Level'].default_value = 0.6
        clear = nt('ShaderNodeMapRange', (-700, -400), i_1=0.0, i_2=0.13, i_3=0.78, i_4=0.0); nt.link(depth_s, clear.inputs[0])  # 0–4 m: see the floor
        tr0 = nt('ShaderNodeBsdfTransparent', (-400, -150)); mx0 = nt('ShaderNodeMixShader', (-200, 100)); nt.link(clear.outputs[0], mx0.inputs[0]); nt.link(surf.outputs[0], mx0.inputs[1]); nt.link(tr0.outputs[0], mx0.inputs[2])
        fz = noise(nt, 0.5, 5, 0.6, (-1100, -600), tc.outputs['Object'])
        ff = math_(nt, 'MULTIPLY', foam_s, ramp(nt, fz.outputs['Fac'], [(0.35, (0, 0, 0)), (0.6, (1, 1, 1))]).outputs[0])
        fb = nt('ShaderNodeBsdfPrincipled', (-400, -350), i_Roughness=0.6); fb.inputs['Base Color'].default_value = (0.9, 0.93, 0.95, 1)
        mx = nt('ShaderNodeMixShader', (0, 0)); nt.link(math_(nt, 'MULTIPLY', ff, 0.85, clamp=True), mx.inputs[0]); nt.link(mx0.outputs[0], mx.inputs[1]); nt.link(fb.outputs[0], mx.inputs[2])
        lp = nt('ShaderNodeLightPath', (0, 300)); tr = nt('ShaderNodeBsdfTransparent', (100, 200))
        mx2 = nt('ShaderNodeMixShader', (300, 0)); nt.link(lp.outputs['Is Shadow Ray'], mx2.inputs[0]); nt.link(mx.outputs[0], mx2.inputs[1]); nt.link(tr.outputs[0], mx2.inputs[2])
        out = nt('ShaderNodeOutputMaterial', (600, 0)); nt.link(mx2.outputs[0], out.inputs['Surface'])
        R, n = self.R, self.n; pad = 2600.0
        xs = np.linspace(-pad, self.S + pad, 9); me = grid_mesh('water_surface', xs, xs, np.zeros((9, 9)), lambda x, y: ((x / R + 0.5) / n, (y / R + 0.5) / n))
        me.materials.append(m); o = obj('water_surface', me, C)
        me2 = grid_mesh('sea_floor_far', xs, xs, np.full((9, 9), -40.0)); fm, fnt = new_mat('SeaFloor'); b = fnt('ShaderNodeBsdfPrincipled'); b.inputs['Base Color'].default_value = (0.05, 0.08, 0.09, 1)
        o2 = fnt('ShaderNodeOutputMaterial', (300, 0)); fnt.link(b.outputs[0], o2.inputs[0]); me2.materials.append(fm); obj('sea_floor_far', me2, C)

    # ── roads, lanes, bridges, trestles ──
    def road_material(self):
        m, nt = new_mat('Road'); uvn = nt('ShaderNodeUVMap', (-1200, 0), uv_map='UVMap'); sep = nt('ShaderNodeSeparateXYZ', (-1000, 0)); nt.link(uvn.outputs[0], sep.inputs[0])
        tc = nt('ShaderNodeTexCoord', (-1200, 300)); u, v = sep.outputs[0], sep.outputs[1]
        at = nt('ShaderNodeAttribute', (-1200, -300), attribute_name='half_w'); wj = nt('ShaderNodeAttribute', (-1200, -450), attribute_name='junction')
        hw = at.outputs['Fac']; x = math_(nt, 'MULTIPLY', math_(nt, 'SUBTRACT', u, 0.5), math_(nt, 'MULTIPLY', hw, 2))  # metres from centreline
        ax = math_(nt, 'ABSOLUTE', x)
        dash = math_(nt, 'LESS_THAN', math_(nt, 'FRACT', math_(nt, 'DIVIDE', v, 12.0)), 0.4)
        centre = math_(nt, 'MULTIPLY', math_(nt, 'LESS_THAN', ax, 0.08), dash)
        edge = math_(nt, 'MULTIPLY', math_(nt, 'GREATER_THAN', ax, math_(nt, 'SUBTRACT', hw, 2.35)), math_(nt, 'LESS_THAN', ax, math_(nt, 'SUBTRACT', hw, 2.2)))
        paint = math_(nt, 'MULTIPLY', math_(nt, 'MAXIMUM', centre, edge), math_(nt, 'SUBTRACT', 1.0, wj.outputs['Fac']))
        wear = noise(nt, 0.6, 6, 0.6, (-800, 500), tc.outputs['Object']); paint = math_(nt, 'MULTIPLY', paint, ramp(nt, wear.outputs['Fac'], [(0.25, (0.3, 0.3, 0.3)), (0.5, (1, 1, 1))]).outputs[0])
        shoulder = math_(nt, 'GREATER_THAN', ax, math_(nt, 'SUBTRACT', hw, 1.8))
        n1 = noise(nt, 2.5, 8, 0.65, (-800, 300), tc.outputs['Object']); n2 = noise(nt, 0.05, 3, 0.5, (-800, 150), tc.outputs['Object'])
        vor = nt('ShaderNodeTexVoronoi', (-800, -100), feature='DISTANCE_TO_EDGE', i_Scale=0.35); nt.link(tc.outputs['Object'], vor.inputs['Vector'])
        crack = math_(nt, 'MULTIPLY', math_(nt, 'LESS_THAN', vor.outputs['Distance'], 0.012), math_(nt, 'GREATER_THAN', n2.outputs['Fac'], 0.55))
        asph = ramp(nt, n1.outputs['Fac'], [(0.35, (0.055, 0.055, 0.06)), (0.65, (0.10, 0.10, 0.105))]).outputs[0]
        asph = mixc(nt, asph, (0.03, 0.03, 0.03), crack)
        tyre = math_(nt, 'MULTIPLY', math_(nt, 'LESS_THAN', math_(nt, 'ABSOLUTE', math_(nt, 'SUBTRACT', ax, math_(nt, 'MULTIPLY', hw, 0.45))), 1.0), 0.25)
        asph = mixc(nt, asph, (0.045, 0.045, 0.05), tyre)
        grav = ramp(nt, n1.outputs['Fac'], [(0.3, (0.30, 0.28, 0.25)), (0.7, (0.45, 0.42, 0.37))]).outputs[0]
        col = mixc(nt, asph, grav, shoulder); col = mixc(nt, col, (0.85, 0.85, 0.8), paint)
        rough = mixf(nt, mixf(nt, 0.82, 0.95, shoulder), 0.6, paint)
        bump = nt('ShaderNodeBump', (0, -300), i_Strength=0.25, i_Distance=0.05); nt.link(math_(nt, 'ADD', n1.outputs['Fac'], math_(nt, 'MULTIPLY', crack, -0.5)), bump.inputs['Height'])
        bs = nt('ShaderNodeBsdfPrincipled', (300, 0)); nt.link(col, bs.inputs['Base Color']); nt.link(rough, bs.inputs['Roughness']); nt.link(bump.outputs[0], bs.inputs['Normal'])
        out = nt('ShaderNodeOutputMaterial', (600, 0)); nt.link(bs.outputs[0], out.inputs[0]); self.road_mat = m
        cm, cn = new_mat('Concrete'); tc2 = cn('ShaderNodeTexCoord', (-900, 0)); nz = noise(cn, 0.4, 6, 0.6, (-600, 0), tc2.outputs['Object'])
        br = cn('ShaderNodeTexBrick', (-600, -250), i_Scale=1 / 6.0, i_Mortar_Size=0.01, i_Color1=(0.40, 0.39, 0.37, 1), i_Color2=(0.35, 0.345, 0.33, 1), i_Mortar=(0.16, 0.16, 0.155, 1), i_Brick_Width=1.0, i_Row_Height=1.0)
        cn.link(tc2.outputs['Object'], br.inputs['Vector']); cc = mixc(cn, br.outputs['Color'], (0.35, 0.34, 0.32), math_(cn, 'MULTIPLY', nz.outputs['Fac'], 0.35))
        b2 = cn('ShaderNodeBsdfPrincipled', (0, 0), i_Roughness=0.82); cn.link(cc, b2.inputs['Base Color']); o2 = cn('ShaderNodeOutputMaterial', (300, 0)); cn.link(b2.outputs[0], o2.inputs[0]); self.conc_mat = cm

    def ribbon(self, name, xy, z, half_w, c, mat, z_off=0.06, extra=None):
        xy = np.asarray(xy, float); z = np.asarray(z, float); n = len(xy)
        if n < 2: return None
        t = np.gradient(xy, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9; nr = np.c_[-t[:, 1], t[:, 0]]
        L = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
        left, right = xy + nr * half_w, xy - nr * half_w
        V = np.zeros((2 * n, 3), np.float32); V[0::2, :2] = left; V[1::2, :2] = right; V[0::2, 2] = z + z_off; V[1::2, 2] = z + z_off
        me = bpy.data.meshes.new(name); me.vertices.add(2 * n); me.vertices.foreach_set('co', V.ravel())
        q = np.array([[2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2] for k in range(n - 1)], np.int32)
        me.loops.add(q.size); me.loops.foreach_set('vertex_index', q.ravel()); me.polygons.add(len(q)); me.polygons.foreach_set('loop_start', np.arange(0, q.size, 4, dtype=np.int32))
        me.update(calc_edges=True); uv = me.uv_layers.new(name='UVMap'); ul = np.array([1.0, 0.0])[(q.ravel() % 2)]; vl = L[q.ravel() // 2]
        uv.data.foreach_set('uv', np.c_[ul, vl].ravel().astype(np.float32))
        a = me.attributes.new('half_w', 'FLOAT', 'POINT'); a.data.foreach_set('value', np.full(2 * n, half_w, np.float32))
        jn = np.repeat(np.asarray(extra if extra is not None else np.zeros(n), np.float32), 2); a2 = me.attributes.new('junction', 'FLOAT', 'POINT'); a2.data.foreach_set('value', jn)
        me.materials.append(mat); return obj(name, me, c)

    def roads(self):
        self.road_material(); C = bpy.data.collections['ROADS']; M = np.load(self.b / 'masks.npz'); rid = M['road_id']; R = self.R
        for k, r in enumerate(self.meta['roads']):
            xy = np.array(r['xy']); z = np.array(r['z']); keep = ~np.array(r.get('on_beach', [False] * len(xy)))
            jj = np.clip((xy[:, 1] / R).round().astype(int), 0, self.n - 1); ii = np.clip((xy[:, 0] / R).round().astype(int), 0, self.n - 1)
            from scipy import ndimage as ndi
            other = ndi.binary_dilation((rid >= 0) & (rid != k), iterations=int(r['clear_w'] / 2 / R) + 2)
            junction = other[jj, ii].astype(np.float32)
            self.ribbon(f"road_{r['id']}", xy[keep], z[keep] + (0.02 if r['kind'] == 'main' else 0.05), r['clear_w'] / 2 + 2.0, C, self.road_mat, extra=junction[keep])
        S = bpy.data.collections['STRUCTURES']
        for ln in self.inst['lanes']:
            pts = np.array(ln['pts'], float); dense = []
            for a, b in zip(pts[:-1], pts[1:]):
                L = np.linalg.norm(b - a); k = max(2, int(L / 2)); dense += [a + (b - a) * t for t in np.linspace(0, 1, k, endpoint=False)]
            dense.append(pts[-1]); dense = np.array(dense)
            if ln['kind'] == 'trestle':
                z = np.linspace(ln['z'][0], ln['z'][1], len(dense)); self.trestle(dense, z, ln['w'])
            else:
                zz = np.array([self.hz(p) for p in dense]) if not isinstance(ln['z'], (int, float)) else np.full(len(dense), ln['z'])
                zz = np.maximum(zz, np.array([self.hz(p) for p in dense]))
                self.ribbon(f"lane_{ln['kind']}", dense, zz, ln['w'] / 2, S, self.conc_mat if ln['kind'] != 'service' else self.road_mat, z_off=0.04)
        self.bridges()

    def hz(self, p):
        from scipy import ndimage as ndi
        return float(ndi.map_coordinates(self.h, [[p[1] / self.R], [p[0] / self.R]], order=1, mode='nearest')[0])

    def box(self, name, c, size, rot, z0, z1, mat, coll_):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        o = obj(name, me, coll_); o.scale = (size[0], size[1], z1 - z0); o.location = (c[0], c[1], (z0 + z1) / 2); o.rotation_euler = (0, 0, rot); me.materials.append(mat); return o

    def trestle(self, xy, z, w):
        S = bpy.data.collections['STRUCTURES']; a, e = xy[0], xy[-1]; L = np.linalg.norm(e - a); ang = math.atan2(*(e - a)[::-1]); c = (a + e) / 2
        o = self.ribbon('trestle_deck', xy, z, w / 2, S, self.conc_mat, z_off=0.0)
        self.box('trestle_slab', c, [L, w], ang, float(min(z)) - 1.2, float(min(z)) - 0.02, self.conc_mat, S)
        for t in np.arange(4, L - 2, 8):
            for s in (-w / 2 + 1.2, w / 2 - 1.2):
                p = a + (e - a) * t / L + np.array([-math.sin(ang), math.cos(ang)]) * s; self.box('pile', p, [0.9, 0.9], ang, -9, float(np.interp(t, [0, L], [z[0], z[-1]])) - 1.2, self.conc_mat, S)

    def bridges(self):
        S = bpy.data.collections['STRUCTURES']
        for r in self.meta['roads']:
            br = np.array(r['bridge'])
            if not br.any(): continue
            lab, nrun = ndi.label(br)  # a road can cross several channels: one deck per contiguous span
            for k in range(1, nrun + 1): self.bridge_span(r, np.array(r['xy'])[lab == k], np.array(r['z'])[lab == k], k, S)

    def bridge_span(self, r, xy, z, k, S):
        a, e = xy[0], xy[-1]; L = np.linalg.norm(e - a); ang = math.atan2(*(e - a)[::-1]); c = (a + e) / 2
        nrm = np.array([-math.sin(ang), math.cos(ang)]); deck = float(z.mean()); W = r['clear_w'] + 3.0
        self.box(f"bridge_deck_{r['id']}_{k}", c, [L + 16, W], ang, deck - 2.0, deck - 0.05, self.conc_mat, S)
        for s in (-1, 1):  # parapets + railing caps
            self.box('parapet', c + nrm * s * (W / 2 - 0.25), [L + 16, 0.5], ang, deck, deck + 1.1, self.conc_mat, S)
        low = deck - 2.0 < 12.0
        ts = np.arange(0.0, 1.0001, 30.0 / L) if low else np.array([0.0, 0.17, 0.33, 0.67, 0.83, 1.0])
        for t in ts:  # piers: causeways every 30 m; high bridges keep the principal channel (0.33–0.67) clear
            p = a + (e - a) * t
            for s in (-1, 1): self.box('pier', p + nrm * s * W * 0.3, [2.5, 2.5], ang, -12, deck - 2.0, self.conc_mat, S)
            self.box('pier_cap', p, [3.0, W], ang, deck - 3.2, deck - 2.0, self.conc_mat, S)
        # deck lights are placed by gen/place.py (validated and exported with the other instances)

    # ── assets & instances ──
    def load_asset(self, name):
        if name in self.lib: return self.lib[name]
        base = name.split('_lod1')[0]; cands = [ROOT / 'assets' / 'blend' / f'{name}.blend']
        if name.startswith('unit_infantry_'): cands.append(ROOT / 'assets' / 'blend' / 'unit_infantry.blend')
        for p in cands:
            if not p.exists(): continue
            with bpy.data.libraries.load(str(p), link=False) as (src, dst):
                if name in src.collections: dst.collections = [name]
            if dst.collections and dst.collections[0]:
                cc = dst.collections[0]; self.LIB.children.link(cc); self.lib[name] = cc; self.patch_team(cc); return cc
        self.missing.add(name); self.lib[name] = None; return None

    def patch_team(self, cc):
        for o in cc.all_objects:
            for slot in getattr(o, 'material_slots', []):
                m = slot.material
                if not m or not m.name.startswith('TEAM_ACCENT') or m.get('patched'): continue
                nt = NT(m.node_tree); bsdf = next((nd for nd in nt.n if nd.type == 'BSDF_PRINCIPLED'), None)
                if not bsdf: continue
                at = nt('ShaderNodeAttribute', (bsdf.location.x - 300, bsdf.location.y), attribute_type='INSTANCER', attribute_name='team_col')
                for lk in list(bsdf.inputs['Base Color'].links): nt.l.remove(lk)
                nt.link(at.outputs['Color'], bsdf.inputs['Base Color']); m['patched'] = True

    def instancer(self, name, cc, items):
        me = bpy.data.meshes.new(f'pts_{name}'); n = len(items)
        lift = 0.03 if name.startswith('bld_') and name != 'bld_naval_dock' else 0.0  # building floors sit flush at z=0: lift 3 cm off the pad (no z-fighting)
        co = np.array([[it['x'], it['y'], it['z'] + lift] for it in items], np.float32); me.vertices.add(n); me.vertices.foreach_set('co', co.ravel())
        rot = np.array([[0, 0, it['rot']] for it in items], np.float32); scl = np.array([[it['s'], it['s'], it['s'] * it.get('sz', 1.0) / (1 if 'sz' not in it else it['s'])] for it in items], np.float32)
        col = np.array([TEAM[it.get('team')] for it in items], np.float32)
        for nm, typ, arr in (('rot', 'FLOAT_VECTOR', rot), ('scl', 'FLOAT_VECTOR', scl), ('team_col', 'FLOAT_COLOR', col)):
            a = me.attributes.new(nm, typ, 'POINT'); a.data.foreach_set('vector' if typ == 'FLOAT_VECTOR' else 'color', arr.ravel())
        o = obj(f'inst_{name}', me, bpy.data.collections['INSTANCES'])
        o['instance_count'] = n
        if all(it.get('id') for it in items):  # stable IDs, one per point, in point order (Text Editor → ids_<asset>); grass clumps have none
            txt = bpy.data.texts.get(f'ids_{name}') or bpy.data.texts.new(f'ids_{name}'); txt.clear(); txt.write('\n'.join(it['id'] for it in items)); txt.use_fake_user = True
            o['instance_ids_text'] = txt.name
        gn = o.modifiers.new('instance', 'NODES'); tree = bpy.data.node_groups.new(f'GN_{name}', 'GeometryNodeTree'); gn.node_group = tree
        tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry'); tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        nt = NT(tree); gi = nt('NodeGroupInput', (-600, 0)); go = nt('NodeGroupOutput', (400, 0))
        ci = nt('GeometryNodeCollectionInfo', (-400, -200)); ci.inputs['Collection'].default_value = cc; ci.inputs['Reset Children'].default_value = False
        ci.transform_space = 'ORIGINAL'
        r = nt('GeometryNodeInputNamedAttribute', (-400, -400), data_type='FLOAT_VECTOR'); r.inputs['Name'].default_value = 'rot'
        s = nt('GeometryNodeInputNamedAttribute', (-400, -550), data_type='FLOAT_VECTOR'); s.inputs['Name'].default_value = 'scl'
        iop = nt('GeometryNodeInstanceOnPoints', (0, 0)); nt.link(gi.outputs[0], iop.inputs['Points']); nt.link(ci.outputs[0], iop.inputs['Instance'])
        e2r = nt('FunctionNodeEulerToRotation', (-200, -400)); nt.link(r.outputs['Attribute'], e2r.inputs[0]); nt.link(e2r.outputs[0], iop.inputs['Rotation'])
        nt.link(s.outputs['Attribute'], iop.inputs['Scale']); nt.link(iop.outputs[0], go.inputs[0])
        o.hide_viewport = False; return o

    def instances(self, cats_skip=()):
        """Environment instances go to INSTANCES; demonstration units (cat 'demo': tanks, harvesters, infantry, boats, dock crews) go to
        DEMO, so disabling or deleting that one collection leaves an empty multiplayer start."""
        groups = {}
        for it in self.inst['items']:
            if it['cat'] in cats_skip: continue
            groups.setdefault((it['asset'], it['cat'] == 'demo'), []).append(it)
        made = set(); inst_n = 0; D = bpy.data.collections['DEMO']
        for (name, demo), items in sorted(groups.items()):
            cc = self.load_asset(name)
            if cc is None: continue
            o = self.instancer(('demo_' if demo else '') + name, cc, items); made.add(name); inst_n += len(items)
            if demo: bpy.data.collections['INSTANCES'].objects.unlink(o); D.objects.link(o)
        self.stats.update({'asset_types': len(made), 'instances': inst_n, 'demo_instances': sum(len(v) for (n, d), v in groups.items() if d), 'missing_assets': sorted(self.missing)})
        print(f'  instances: {inst_n} of {len(made)} asset types; missing: {sorted(self.missing)}')

    def collision(self):
        """Coarse static collision: one box per blocking item (buildings, rigs, blocking props and wagons, large rocks, cliff pieces)
        from the measured asset bounds, in one wireframe mesh that never renders. It is independent of visual LOD and uses the same
        per-item blocking flag as the navigation layers (gen/place.py → surface.npz solid → gen/navcheck.py)."""
        from assets import info
        C = bpy.data.collections['COLLISION']; V = []; F = []; n = 0
        for it in self.inst['items']:
            a = info(it['asset'])
            if not it.get('block', a['blocking']) or a['kind'] == 'veg': continue  # same blocking set as the navigation layers
            b = a.get('bounds'); sxy = it['s']; sz = it.get('sz', it['s'])
            lo, hi = (np.array(b['min'], float), np.array(b['max'], float)) if b and 'min' in b else (np.array([-a['size'][0] / 2, -a['size'][1] / 2, 0.0]), np.array([a['size'][0] / 2, a['size'][1] / 2, a['size'][2]]))
            lo = lo * [sxy, sxy, sz]; hi = hi * [sxy, sxy, sz]; c, s_ = math.cos(it['rot']), math.sin(it['rot'])
            k0 = len(V)
            for z in (lo[2], hi[2]):
                for x, y in ((lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])):
                    V.append((it['x'] + c * x - s_ * y, it['y'] + s_ * x + c * y, it['z'] + z))
            F += [(k0, k0 + 3, k0 + 2, k0 + 1), (k0 + 4, k0 + 5, k0 + 6, k0 + 7)] + [(k0 + i, k0 + (i + 1) % 4, k0 + 4 + (i + 1) % 4, k0 + 4 + i) for i in range(4)]; n += 1
        me = bpy.data.meshes.new('collision_static'); me.from_pydata(V, [], F); me.update()
        o = obj('COLLISION_static', me, C); o.display_type = 'WIRE'; o.hide_render = True; o['boxes'] = n
        self.stats['collision_boxes'] = n

    # ── grass near the close-up cameras ──
    def grass_near(self, centers, radius=170.0, per_m2=0.45, cams=None):
        from scipy import ndimage as ndi
        rng = np.random.default_rng(self.meta['seed'] + 9); names = {'01': ['veg_grass_meadow', 'veg_flowers_meadow'], '02': ['veg_grass_meadow'], '03': ['veg_grass_summer', 'veg_fern'],
                                                                    '04': ['veg_grass_beach', 'veg_grass_meadow'], '05': ['veg_grass_summer', 'veg_grass_meadow']}[self.mid]
        pts = {k: [] for k in names}
        for cam in (cams or []):
            # density falls off with distance from the lens (≈4 clumps/m² within 30 m), only inside a ±55° wedge ahead
            c0 = np.array(cam['loc'][:2]); fwd = np.array(cam['tgt'][:2]) - c0; fwd /= np.linalg.norm(fwd) + 1e-9
            r = np.sqrt(rng.uniform(0, 1, 400000)) * radius; a = rng.uniform(-math.radians(58), math.radians(58), len(r)) + math.atan2(fwd[1], fwd[0])
            P = c0 + np.c_[r * np.cos(a), r * np.sin(a)]
            want = np.clip(7.0 * (25.0 / np.maximum(r, 25.0)) ** 1.25, 0.3, 7.0); area_per_pt = (math.radians(116) * radius ** 2 / 2) / len(r)
            keep = rng.random(len(P)) < want * area_per_pt
            P = P[keep & (P[:, 0] > 0) & (P[:, 1] > 0) & (P[:, 0] < self.S) & (P[:, 1] < self.S)]
            dens = ndi.map_coordinates(self.grass, [P[:, 1] / self.R, P[:, 0] / self.R], order=1); P = P[rng.random(len(P)) < dens]
            centers = list(centers) + [None]
            self._grass_pts = P if not hasattr(self, '_grass_pts') else np.vstack([self._grass_pts, P])
        for c in [c for c in centers if c is not None][:0]:
            pass
        if hasattr(self, '_grass_pts'):
            P = self._grass_pts
            z = ndi.map_coordinates(self.h, [P[:, 1] / self.R, P[:, 0] / self.R], order=1)
            which = rng.random(len(P))
            for k, nm in enumerate(names):
                sel = (which < (0.88 if k == 0 else 1.0)) & (which >= (0 if k == 0 else 0.88)) if len(names) > 1 else np.ones(len(P), bool)
                for p, zz in zip(P[sel], z[sel]): pts[nm].append({'id': '', 'x': float(p[0]), 'y': float(p[1]), 'z': float(zz) - 0.02, 'rot': float(rng.uniform(0, 6.28)), 's': float(rng.uniform(0.65, 1.3))})
        G = bpy.data.collections['GRASS']; total = 0
        for nm, items in pts.items():
            cc = self.load_asset(nm)
            if cc is None or not items: continue
            o = self.instancer('grass_' + nm, cc, items); bpy.data.collections['INSTANCES'].objects.unlink(o); G.objects.link(o); total += len(items)
        self.stats['grass_clumps'] = total; print(f'  grass clumps near cameras: {total}')

    # ── overlays (overview preset only) ──
    def overlay(self):
        C = bpy.data.collections['OVERLAY']; z = 60.0
        def emis(name, col, s=3.0):
            m, nt = new_mat(name); e = nt('ShaderNodeEmission', (0, 0), i_Strength=s); e.inputs['Color'].default_value = (*col, 1); o = nt('ShaderNodeOutputMaterial', (200, 0)); nt.link(e.outputs[0], o.inputs[0]); return m
        mats = {'route': emis('ov_route', (1, 1, 1), 2.0), 'B': emis('ov_blue', TEAM['B'][:3], 4), 'R': emis('ov_red', TEAM['R'][:3], 4), 'ore': emis('ov_ore', (1.0, 0.75, 0.05), 4),
                'edge': emis('ov_edge', (0.9, 0.9, 0.9), 2), 'radar': emis('ov_radar', (0.75, 0.45, 1.0), 4), 'dock': emis('ov_dock', (0.3, 0.9, 1.0), 3), 'beach': emis('ov_beach', (1.0, 0.55, 0.15), 3)}
        def poly(name, pts, mat, w=4.0, closed=False, dash=False):
            cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = w / 2; cu.bevel_resolution = 0
            pts = np.asarray(pts, float)
            segs = [pts] if not dash else [pts[k:k + 6] for k in range(0, len(pts) - 1, 10)]
            for sg in segs:
                if len(sg) < 2: continue
                sp = cu.splines.new('POLY'); sp.points.add(len(sg) - 1)
                for k, p in enumerate(sg): sp.points[k].co = (p[0], p[1], z, 1)
                sp.use_cyclic_u = closed
            cu.materials.append(mat); return obj(name, cu, C)
        for r in self.meta['roads']: poly(f"ov_route_{r['id']}", np.array(r['xy'])[::3], mats['route'], 5.0 if r['kind'] == 'main' else 3.5, dash=True)
        S = self.S; poly('ov_boundary', [(0, 0), (S, 0), (S, S), (0, S)], mats['edge'], 6, closed=True)
        for p in self.meta['pads']:
            c = p['center']; r = p['size'][0] / 2; th = np.linspace(0, 2 * math.pi, 64)
            poly(f"ov_base_{p['id']}", np.c_[c[0] + r * 1.15 * np.cos(th), c[1] + r * 1.15 * np.sin(th)], mats[p['team']], 10, closed=True, dash=True)
        for d in self.inst['deposits']:
            c = d['pos']; r = 30; poly(f"ov_dep_{d['id']}", [(c[0], c[1] - r), (c[0] + r, c[1]), (c[0], c[1] + r), (c[0] - r, c[1])], mats['ore'], 8, closed=True)
        for l in self.meta['landmarks']:
            if l['role'] == 'capturable':
                c = l['center']; th = np.linspace(0, 2 * math.pi, 64); poly('ov_radar', np.c_[c[0] + 220 * np.cos(th), c[1] + 220 * np.sin(th)], mats['radar'], 4, closed=True, dash=True)
        for k in self.meta['docks']:
            c = k['water_center']; a = k['rot']; pts = [(c[0] + math.cos(a) * x - math.sin(a) * y, c[1] + math.sin(a) * x + math.cos(a) * y) for x, y in ((-40, -20), (40, -20), (40, 20), (-40, 20))]
            poly(f"ov_dock_{k['player']}", pts, mats['dock'], 5, closed=True)
        for b in self.meta['beaches']:
            c = np.array(b['center']); u = np.array(b['dir']); v = np.array([-u[1], u[0]]) * b['width_m'] / 2
            poly('ov_beach', [c - v, c + v], mats['beach'], 8)
        C.hide_render = True

    # ── cameras ──
    def cam(self, name, loc, target, lens=35.0, ortho=None):
        cd = bpy.data.cameras.new(name); cd.clip_start = 0.5; cd.clip_end = 12000
        if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
        else: cd.lens = lens
        o = obj(name, cd, bpy.data.collections['CAMERAS']); o.location = loc
        d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); return o

    def presets(self):
        meta = self.meta; S = self.S; P = []
        P.append(dict(key='overview', obj=self.cam('CAM_1_overview', (S / 2 + S * 0.125, S / 2, 6000), (S / 2 + S * 0.125, S / 2, 0), ortho=S * 1.3), **PRESET_META['overview']))
        b = next(p for p in meta['pads'] if p['team'] == 'B'); c = np.array(b['center']); zb = b['h']
        kit = self.inst.get('kits', {}).get(b['id'], {'sx': 1, 'sy': 1}); K = lambda x, y: c + [kit['sx'] * x, kit['sy'] * y]  # the kit is mirrored per start
        g = K(-20, -10); tgt = (*g, zb); P.append(dict(key='gameplay', obj=self.cam('CAM_2_gameplay', (g[0] - 70, g[1] - 140, zb + 150), tgt, 32), gc=tgt, **PRESET_META['gameplay']))
        t3, c3 = K(-20, -2), K(-46, -32); tgt = (*t3, zb + 3.2); P.append(dict(key='base', obj=self.cam('CAM_3_base', (*c3, zb + 1.9), tgt, 26), gc=tgt, **PRESET_META['base']))
        k = next((d for d in meta['docks'] if d['player'][0] == 'B'), meta['docks'][0]); Wc = np.array(k['water_center']); rot = k['rot']
        lx = np.array([math.cos(rot), math.sin(rot)]); ly = np.array([-math.sin(rot), math.cos(rot)]); boat = Wc - ly * 23.6
        cl = boat - ly * 55 + lx * 45; P.append(dict(key='harbor', obj=self.cam('CAM_4_harbor', (*cl, 9.0), (*(boat + lx * 4), 3.0), 30), gc=(*Wc, 0), **PRESET_META['harbor']))
        dl = self.detail_spot(); P.append(dict(key='detail', obj=self.cam('CAM_5_detail', dl[0], dl[1], dl[2]), gc=dl[1], **PRESET_META['detail']))
        for p in P: p['obj']['preset'] = p['key']
        self.P = P; return P

    def detail_spot(self):
        """Per-biome close-up: a forest edge with rocks (Emerald), channel bank with levee, pump outfall and mangroves (Delta), pines on granite above the fjord (Granite),
        palm beach over coral (Sunbreak), the copper quarry (Copperhead)."""
        meta = self.meta; S = self.S
        if self.mid == '05':
            q = meta['quarries'][0]; c = np.array(q['center']); e = np.array(q['entries'][1]); z = self.hz(c)
            return ((*(c + [-60, -75]), z + 34), (*c, z + 2), 30)
        trees = [it for it in self.inst['items'] if it['cat'] == 'tree']
        if self.mid == '02':  # channel bank: levee wall, pump outfall, reeds and mangroves on the mud, the upper bridge beyond
            outs = [it for it in self.inst['items'] if it['cat'] == 'pump' and it['asset'] == 'prop_pipe_gantry' and it['x'] < S / 2]
            if outs:
                o = max(outs, key=lambda it: it['y']); q = np.array([o['x'] + 10.0, o['y']])  # levee point behind the outfall (water to the west)
                zc = self.hz(q + [20, -78]); return ((*(q + [20, -78]), zc + 7.5), (q[0] - 34, q[1] + 90, 3.0), 26)
            trees = [it for it in trees if it['asset'] == 'veg_mangrove'] or trees
        if self.mid == '03':
            cl = [it for it in self.inst['items'] if it['cat'] == 'cliff']; t = cl[len(cl) // 3] if cl else trees[0]
            p = np.array([t['x'], t['y']]); z = self.hz(p); return ((*(p + [60, -70]), z + 22), (*p, z + 4), 28)
        # forest edge seen from open meadow: try each patch and 16 bearings; pick the camera spot on grass, away from roads,
        # facing roughly into the sun's opposite so the edge is front-lit
        from scipy import ndimage as ndi
        M = np.load(self.b / 'masks.npz'); rb = ndi.binary_dilation(M['road_band'], iterations=10); best = None
        sun_az = math.radians(self.pal['sun'][1])
        for fp in self.meta['forest_patches']:
            c = np.array(fp[:2]) * S / 1000; r = np.array(fp[2:]) * S / 1000
            for a in np.linspace(0, 2 * math.pi, 16, endpoint=False):
                u = np.array([math.cos(a), math.sin(a)]); edge = c + u * r * 0.95; cam = c + u * (np.hypot(*(u * r)) + 48)
                j, i = int(cam[1] / self.R), int(cam[0] / self.R)
                if not (5 < j < self.n - 5 and 5 < i < self.n - 5): continue
                if self.h[j, i] < 1 or rb[j, i] or self.surf[j, i] not in (0, 1): continue
                score = math.cos(a - sun_az)  # camera on the sunny side → lit edge
                if best is None or score > best[0]: best = (score, cam, edge)
        if best:
            _, cam, edge = best; zc = self.hz(cam); ze = self.hz(edge)
            side = np.array([-(edge - cam)[1], (edge - cam)[0]]); side /= np.linalg.norm(side) + 1e-9
            return ((*(cam + side * 8), zc + 2.2), (*(edge - side * 6), ze + 5.5), 24)
        t = trees[len(trees) // 2]; p = np.array([t['x'], t['y']]); z = self.hz(p)
        return ((*(p + [-38, -46]), z + 6.5), (*p, z + 5), 26)

    # ── render ──
    def render(self, which='all', samples=48, res_override=None):
        out = ROOT / 'renders' / self.mid; out.mkdir(parents=True, exist_ok=True); sc = bpy.context.scene; done = []
        self.backend = use_gpu(sc); self.device = gpu_describe(); self.warmup_s = None
        if self.backend:   # first GPU render compiles the kernels (cached afterwards): time it apart from the real frames
            sc.camera = self.P[0]['obj']; sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 64, 36, 100; sc.cycles.samples = 1
            sc.render.filepath = str(out / '_warmup.png'); t0 = time.time(); bpy.ops.render.render(write_still=False); self.warmup_s = round(time.time() - t0, 1); print(f'  GPU warm-up {self.warmup_s}s ({self.device})')
        for k, p in enumerate(self.P):
            if which != 'all' and p['key'] not in which.split(','): continue
            sc.camera = p['obj']; w, h = res_override or p['res']; sc.render.resolution_x, sc.render.resolution_y = w, h; sc.render.resolution_percentage = 100
            sc.cycles.samples = samples if p['key'] != 'overview' else max(24, samples // 2)
            bpy.data.collections['OVERLAY'].hide_render = not p.get('overlay', False)
            bpy.data.collections['GRASS'].hide_render = not p.get('grass', False)
            path = out / f"preset_{k + 1}_{p['key']}.png"; sc.render.filepath = str(path); t0 = time.time()
            bpy.ops.render.render(write_still=True); dt = time.time() - t0; print(f'  rendered {path.name} in {dt:.0f}s'); done.append((path, p, dt, sc.cycles.samples))
            self.annotate(path, p)
        return done

    def annotate(self, path, p):
        try:
            from PIL import Image, ImageDraw, ImageFont
        except ImportError: return
        im = Image.open(path).convert('RGB'); dr = ImageDraw.Draw(im); W, H = im.size
        try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22); fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
        except Exception: f = fs = ImageFont.load_default()
        dr.rectangle([0, 0, W, 44], fill=(14, 18, 24)); dr.text((16, 10), f"{self.mid} / {self.meta['name'].upper()}  ·  {p['title']}", fill=(240, 240, 240), font=f)
        cam = p['obj'].data
        if cam.type == 'ORTHO':
            mpp = cam.ortho_scale / max(W, H); bar_m = 500; px = bar_m / mpp
            x0, y0 = 30, H - 40; dr.rectangle([x0 - 10, y0 - 34, x0 + px + 90, y0 + 18], fill=(14, 18, 24))
            dr.line([x0, y0, x0 + px, y0], fill=(255, 255, 255), width=4)
            for t in (0, 0.5, 1): dr.line([x0 + px * t, y0 - 8, x0 + px * t, y0 + 8], fill=(255, 255, 255), width=2)
            dr.text((x0, y0 - 30), f"0        {bar_m // 2} m        {bar_m} m   (orthographic top-down, {mpp:.2f} m/px)", fill=(230, 230, 230), font=fs)
            lg = [((43, 111, 214), 'Blue start'), ((200, 50, 43), 'Red start'), ((255, 190, 13), 'Ore deposit'), ((190, 115, 255), 'Radar 220 m'), ((77, 230, 255), 'Naval dock'), ((255, 140, 38), 'Landing beach'), ((255, 255, 255), 'Routes')]
            x = W - 230; y = 60; dr.rectangle([x - 12, y - 10, W - 10, y + 24 * len(lg) + 4], fill=(14, 18, 24))
            for c, t in lg: dr.rectangle([x, y + 4, x + 14, y + 18], fill=c); dr.text((x + 22, y + 1), t, fill=(230, 230, 230), font=fs); y += 24
        else:
            dr.rectangle([0, H - 30, W, H], fill=(14, 18, 24)); dr.text((14, H - 25), f"Perspective camera, {cam.lens:.0f} mm — world scale unchanged; no survey scale bar on a perspective view", fill=(220, 220, 220), font=fs)
        im.save(path)

    @classmethod
    def from_blend(cls, mid):
        """Open the saved scene (maps/scenes/<id>_*.blend) for rendering only: no build data or scipy needed."""
        self = cls.__new__(cls); self.mid = mid; self.meta = json.loads((ROOT / 'build' / mid / 'meta.json').read_text())
        path = next((ROOT / 'scenes').glob(f'{mid}_*.blend')); bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
        self.stats = json.loads(bpy.context.scene.get('stats', '{}') or '{}'); cams = {o['preset']: o for o in bpy.data.objects if o.type == 'CAMERA' and 'preset' in o}
        self.P = [dict(key=k, obj=cams[k], **PRESET_META[k]) for k in PRESET_ORDER if k in cams]; return self

    def save(self):
        out = ROOT / 'scenes'; out.mkdir(exist_ok=True); p = out / f"{self.mid}_{self.meta['name'].lower().replace(' ', '_')}.blend"
        bpy.context.scene['stats'] = json.dumps(self.stats)
        bpy.context.preferences.filepaths.save_version = 0; bpy.ops.wm.save_as_mainfile(filepath=str(p), compress=True); print('  saved', p); return p

    def build(self, grass=True):
        t0 = time.time(); self.setup(); self.world(); self.terrain(); self.water(); self.roads(); self.instances(); self.collision(); self.overlay(); self.presets()
        if grass: self.grass_near([], cams=[{'loc': tuple(p['obj'].location), 'tgt': p['gc']} for p in self.P if p.get('gc')])
        self.stats['build_s'] = round(time.time() - t0, 1); return self

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('map'); ap.add_argument('--render', default=None); ap.add_argument('--samples', type=int, default=48)
    ap.add_argument('--res', default=None); ap.add_argument('--nosave', action='store_true'); ap.add_argument('--nograss', action='store_true')
    ap.add_argument('--from-blend', action='store_true', help='render the saved scene without rebuilding it')
    ap.add_argument('--annotate-only', action='store_true', help='with --from-blend: add the title / scale bars to existing renders (e.g. made where PIL is missing)')
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    s = Scene.from_blend(a.map) if a.from_blend else Scene(a.map).build(grass=not a.nograss)
    if not a.nosave and not a.from_blend:
        s.save()
        lp = ROOT / 'renders' / a.map / 'render_log.json'; lp.parent.mkdir(parents=True, exist_ok=True)  # scene statistics stay current even without a render
        old = json.loads(lp.read_text()) if lp.exists() else {}; old['stats'] = s.stats; lp.write_text(json.dumps(old, indent=1))
    if a.render and a.annotate_only:
        for k, p in enumerate(s.P):
            f = ROOT / 'renders' / a.map / f"preset_{PRESET_ORDER.index(p['key']) + 1}_{p['key']}.png"
            if (a.render == 'all' or p['key'] in a.render.split(',')) and f.exists(): s.annotate(f, p); print('  annotated', f.name)
        a.render = None
    if a.render:
        res = tuple(int(v) for v in a.res.split('x')) if a.res else None
        done = s.render(a.render, a.samples, res)
        st = json.loads(bpy.context.scene.get('stats', '{}')) if bpy.context.scene.get('stats') else s.stats
        lp = ROOT / 'renders' / a.map / 'render_log.json'; old = json.loads(lp.read_text()).get('renders', []) if lp.exists() else []
        new = {p[1]['key']: {'file': str(p[0].name), 'preset': p[1]['key'], 'seconds': round(p[2], 1), 'samples': p[3], 'device': s.device, 'gpu_warmup_s': s.warmup_s, 'blender': bpy.app.version_string, 'date': time.strftime('%Y-%m-%d %H:%M')} for p in done}
        def _keep(r):
            n = new.pop(r['preset'], None)
            if n is None: return r
            if r.get('device') != n['device'] or 'previous' not in r: n['previous'] = {k: r[k] for k in ('seconds', 'samples', 'device', 'blender', 'date') if k in r} or None
            else: n['previous'] = r.get('previous')
            return n
        merged = [_keep(r) for r in old] + list(new.values())
        lp.write_text(json.dumps({'stats': s.stats, 'renders': merged}, indent=1))
