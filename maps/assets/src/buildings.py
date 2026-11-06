#!/usr/bin/env python
"""Thunderhead base-building asset library (bld_* buildings and prop_container_* props).

Usage (Blender 4.5 as a Python module):
    /home/claude/blender-env/bin/python buildings.py [name|all] [--glb] [--no-preview] [--debug DIR]

Per asset this writes, under maps/assets/:
    blend/<name>.blend    one collection <name>, transforms applied, origin at footprint centre at ground (dock: water level)
    bounds/<name>.json    measured evaluated-mesh bounds (exclude_bounds objects skipped), tris, doors, extras
    preview/<name>.png    Cycles preview with 1.8 m figures and a 1 m grid
    glb/<name>.glb        (with --glb) web copy: procedural materials baked into one <=1024 px atlas;
                          TEAM_ACCENT -> flat 'TEAM', lights -> 'GLOW', glass -> 'GLASS*', fence -> 'FENCE' (alpha PNG)

Axes: 1 unit = 1 m, +X east, +Y north, +Z up. Geometry is built straight into bmesh (no booleans): walls are
assembled from rectangles around their openings, so door/window openings are exact and genuinely cut through.
Material names: TEAM_ACCENT (accent bands/markings only), GLASS*, GLOW*; everything else is procedural and baked.
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import sys, os, math, json, random, argparse, time
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
OUT = {k: os.path.join(ASSETS, k) for k in ('blend', 'glb', 'bounds', 'preview')}
for _d in OUT.values(): os.makedirs(_d, exist_ok=True)

TEAM_BLUE = (0.0242, 0.1586, 0.6724)   # #2B6FD6 in linear, used for previews only
DEBUG_DIR = None

# ═══════════════════════════════════════════ colour / material library ═══════════════════════════════════════════
def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


class NB:
    """Tiny node-graph helper."""
    def __init__(self, mat):
        mat.use_nodes = True; self.m = mat; self.nt = mat.node_tree; self.N = self.nt.nodes; self.L = self.nt.links
        self.bsdf = self.N['Principled BSDF']; self.out = self.N['Material Output']

    def node(self, t, **kw):
        n = self.N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n

    def inp(self, sock, v):
        if v is None: return
        if isinstance(v, bpy.types.NodeSocket): self.L.new(v, sock)
        else:
            if isinstance(v, (tuple, list)) and len(v) == 3 and len(sock.default_value) == 4: v = (*v, 1.0)
            sock.default_value = v

    def math(self, op, a, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op); n.use_clamp = clamp
        self.inp(n.inputs[0], a)
        if b is not None: self.inp(n.inputs[1], b)
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend); n.clamp_result = True
        self.inp(n.inputs[0], fac); self.inp(n.inputs[6], a); self.inp(n.inputs[7], b); return n.outputs[2]

    def rgb(self, c):
        n = self.node('ShaderNodeRGB'); n.outputs[0].default_value = (*c, 1); return n.outputs[0]

    def noise(self, vec, scale, detail=3.0, rough=0.55, dim='3D'):
        n = self.node('ShaderNodeTexNoise'); n.noise_dimensions = dim
        self.inp(n.inputs['Vector'], vec); n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
        return n.outputs['Fac']

    def mr(self, v, a, b, c=0.0, d=1.0, interp='LINEAR'):
        n = self.node('ShaderNodeMapRange'); n.interpolation_type = interp; n.clamp = True
        self.inp(n.inputs['Value'], v)
        n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def sep(self, vec):
        n = self.node('ShaderNodeSeparateXYZ'); self.inp(n.inputs[0], vec); return n.outputs

    def comb(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ'); self.inp(n.inputs[0], x); self.inp(n.inputs[1], y); self.inp(n.inputs[2], z)
        return n.outputs[0]

    def coords(self):
        tc = self.node('ShaderNodeTexCoord'); return tc.outputs['Object']

    def normal(self):
        g = self.node('ShaderNodeNewGeometry'); return g.outputs['Normal']

    def line_mask(self, coord, spacing, w0=0.003, w1=0.012):
        """1 on lines at coord = k*spacing (half width w0..w1 metres), else 0."""
        f = self.math('FRACT', self.math('DIVIDE', coord, spacing))
        a = self.math('ABSOLUTE', self.math('SUBTRACT', f, 0.5))
        d = self.math('MULTIPLY', self.math('SUBTRACT', 0.5, a), spacing)
        return self.mr(d, w0, w1, 1.0, 0.0)  # noqa


GRIME = srgb('#2a2620'); DIRT = srgb('#5b4c3a'); STREAK = srgb('#3d3933'); RUST = srgb('#6a3418'); ALGAE = srgb('#2f3a1f')


def make_paint(name, base, rough=0.6, metal=0.0, var=0.10, fine=0.06, fine_scale=28.0, grime=0.35, ao_dist=0.35,
               dirt=0.0, dirt_h=0.6, hseam=0.0, vseam=0.0, seam_dark=0.28, streaks=0.0, rust=0.0, algae=False,
               bump=0.12, stains=0.0, stain_col=None, big_scale=0.22):
    m = bpy.data.materials.new(name); g = NB(m); b = g.bsdf
    pos = g.coords(); x, y, z = g.sep(pos)[:3]
    nz = g.sep(g.normal())[2]; vm = g.mr(g.math('ABSOLUTE', nz), 0.35, 0.75, 1.0, 0.0)   # 1 on vertical faces
    col = g.rgb(base)
    big = g.noise(pos, big_scale, 3.0); col = g.mix(1.0, col, g.mr(big, 0.3, 0.7, 1 - var, 1 + var), 'MULTIPLY')
    fn = g.noise(pos, fine_scale, 6.0, 0.6); col = g.mix(1.0, col, g.mr(fn, 0.3, 0.7, 1 - fine, 1 + fine), 'MULTIPLY')
    height = g.math('MULTIPLY', fn, 0.25)
    if stains:
        sn = g.noise(pos, 0.9, 5.0, 0.6); sf = g.mr(sn, 0.56, 0.74, 0.0, stains)
        col = g.mix(sf, col, g.rgb(stain_col or tuple(c * 0.62 for c in base)))
    if hseam or vseam:
        seam = None
        if hseam: seam = g.line_mask(z, hseam)
        if vseam:
            vl = g.line_mask(g.math('ADD', x, y), vseam); seam = vl if seam is None else g.math('MAXIMUM', seam, vl)
        seam = g.math('MULTIPLY', seam, vm)
        col = g.mix(1.0, col, g.math('SUBTRACT', 1.0, g.math('MULTIPLY', seam, seam_dark)), 'MULTIPLY')
        height = g.math('SUBTRACT', height, seam)
    if streaks:
        at = g.node('ShaderNodeAttribute', attribute_type='GEOMETRY'); at.attribute_name = 'streak'
        u, v, valid = g.sep(at.outputs['Vector'])[:3]
        st = g.noise(g.comb(g.math('MULTIPLY', u, 7.0), g.math('MULTIPLY', v, 0.5), 0.0), 1.0, 3.0, 0.5)
        stripes = g.mr(st, 0.40, 0.66, 0.0, 1.0)
        edge = g.math('MAXIMUM', g.mr(u, 0.0, 0.16, 1.0, 0.35), g.mr(u, 0.84, 1.0, 0.35, 1.0))
        fall = g.math('MULTIPLY', g.mr(v, 0.05, 2.4, 1.0, 0.0, 'SMOOTHSTEP'), g.mr(v, 0.0, 0.05, 0.3, 1.0))
        s = g.math('MULTIPLY', g.math('MULTIPLY', stripes, edge), g.math('MULTIPLY', fall, valid))
        col = g.mix(g.math('MULTIPLY', s, streaks), col, g.rgb(STREAK))
    if rust:
        rn = g.noise(g.comb(g.math('MULTIPLY', x, 5.0), g.math('MULTIPLY', y, 5.0), g.math('MULTIPLY', z, 0.5)), 1.0, 4.0)
        col = g.mix(g.mr(rn, 0.58, 0.78, 0.0, rust), col, g.rgb(RUST))
    if dirt:
        zn = g.math('ADD', z, g.math('MULTIPLY', g.math('SUBTRACT', g.noise(pos, 1.6, 4.0), 0.5), 0.45))
        db = g.math('MULTIPLY', g.mr(zn, 0.0, dirt_h, 1.0, 0.0, 'SMOOTHSTEP'), g.math('MULTIPLY', vm, dirt))
        col = g.mix(db, col, g.rgb(DIRT))
    if algae:
        zn = g.math('ADD', z, g.math('MULTIPLY', g.math('SUBTRACT', g.noise(pos, 2.2, 4.0), 0.5), 0.5))
        col = g.mix(g.mr(zn, 0.25, 1.1, 0.85, 0.0), col, g.rgb(ALGAE))
        col = g.mix(g.mr(z, -0.2, 0.15, 0.45, 0.0), col, g.rgb((0.01, 0.012, 0.01)))
    if grime:
        ao = g.node('ShaderNodeAmbientOcclusion'); ao.samples = 6; ao.inputs['Distance'].default_value = ao_dist
        gf = g.math('MULTIPLY', g.math('SUBTRACT', 1.0, ao.outputs['AO']), grime)
        col = g.mix(gf, col, g.rgb(GRIME))
    g.L.new(col, b.inputs['Base Color'])
    rr = g.mr(fn, 0.3, 0.7, max(0.05, rough - 0.08), min(1.0, rough + 0.08)); g.L.new(rr, b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = metal
    if bump:
        bn = g.node('ShaderNodeBump'); bn.inputs['Strength'].default_value = bump; bn.inputs['Distance'].default_value = 0.01
        g.L.new(height, bn.inputs['Height']); g.L.new(bn.outputs['Normal'], b.inputs['Normal'])
    m['bake'] = True; m['rough'] = rough; m['metal'] = metal
    return m


def make_hazard(name='HAZARD', period=0.5):
    m = bpy.data.materials.new(name); g = NB(m); b = g.bsdf
    pos = g.coords(); x, y, z = g.sep(pos)[:3]
    s = g.math('FRACT', g.math('DIVIDE', g.math('ADD', g.math('ADD', x, y), z), period))
    stripe = g.math('GREATER_THAN', s, 0.5)
    col = g.mix(stripe, g.rgb(srgb('#141414')), g.rgb(srgb('#e3a812')))
    fn = g.noise(pos, 22.0, 6.0); col = g.mix(1.0, col, g.mr(fn, 0.3, 0.7, 0.9, 1.1), 'MULTIPLY')
    wear = g.mr(g.noise(pos, 9.0, 5.0), 0.66, 0.74, 0.0, 0.8); col = g.mix(wear, col, g.rgb(srgb('#6d6a64')))
    ao = g.node('ShaderNodeAmbientOcclusion'); ao.samples = 6; ao.inputs['Distance'].default_value = 0.3
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, ao.outputs['AO']), 0.4), col, g.rgb(GRIME))
    g.L.new(col, b.inputs['Base Color']); g.L.new(g.mr(fn, 0.3, 0.7, 0.45, 0.65), b.inputs['Roughness'])
    m['bake'] = True; m['rough'] = 0.55; m['metal'] = 0.0
    return m


def make_glass(name='GLASS', base=srgb('#1d2a30'), rough=0.06, light=False, transp=0.0):
    m = bpy.data.materials.new(name); g = NB(m); b = g.bsdf
    if transp:
        tr = g.node('ShaderNodeBsdfTransparent'); mx = g.node('ShaderNodeMixShader'); mx.inputs[0].default_value = transp
        g.L.new(b.outputs[0], mx.inputs[1]); g.L.new(tr.outputs[0], mx.inputs[2]); g.L.new(mx.outputs[0], g.out.inputs['Surface'])
    pos = g.coords()
    n = g.noise(pos, 0.6, 3.0)
    g.L.new(g.mix(g.mr(n, 0.3, 0.7, 0.0, 1.0), g.rgb(base), g.rgb(tuple(c * 1.5 for c in base))), b.inputs['Base Color'])
    g.L.new(g.mr(n, 0.3, 0.7, rough * 0.6, rough * 1.8), b.inputs['Roughness'])
    b.inputs['Specular IOR Level'].default_value = 0.6 if not light else 0.4
    m['flat_col'] = base; m['rough'] = rough
    return m


def make_glow(name, col, strength):
    m = bpy.data.materials.new(name); b = m.node_tree.nodes['Principled BSDF'] if m.use_nodes else None
    m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Emission Color'].default_value = (*col, 1)
    b.inputs['Emission Strength'].default_value = strength; b.inputs['Roughness'].default_value = 0.4
    m['flat_col'] = col; m['strength'] = strength
    return m


def make_team():
    m = bpy.data.materials.new('TEAM_ACCENT'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.214, 0.214, 0.214, 1); b.inputs['Roughness'].default_value = 0.45
    b.inputs['Metallic'].default_value = 0.0
    return m


def chainlink_image():
    img = bpy.data.images.get('chainlink')
    if img: return img
    W = 64; img = bpy.data.images.new('chainlink', W, W, alpha=True); px = [0.0] * (W * W * 4)
    for j in range(W):
        for i in range(W):
            u, v = (i + 0.5) / W * 4, (j + 0.5) / W * 4          # 4 diamonds per tile
            d1 = abs(((u + v) % 1.0) - 0.5); d2 = abs(((u - v) % 1.0) - 0.5)
            wire = max(0.0, 1.0 - min(d1, d2) / 0.075)
            k = (j * W + i) * 4; c = 0.42 + 0.1 * wire
            px[k:k + 4] = [c, c * 1.01, c * 1.03, 1.0 if wire > 0.15 else 0.0]
    img.pixels = px; img.file_format = 'PNG'; img.pack(); return img


def make_fence(name='FENCE'):
    m = bpy.data.materials.new(name); g = NB(m); b = g.bsdf
    t = g.node('ShaderNodeTexImage'); t.image = chainlink_image(); t.interpolation = 'Linear'
    uvn = g.node('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; g.L.new(uvn.outputs['UV'], t.inputs['Vector'])
    g.L.new(t.outputs['Color'], b.inputs['Base Color'])
    rnd = g.math('ROUND', t.outputs['Alpha']); g.L.new(rnd, b.inputs['Alpha'])
    b.inputs['Metallic'].default_value = 0.7; b.inputs['Roughness'].default_value = 0.45
    m.surface_render_method = 'DITHERED'
    try: m.blend_method = 'CLIP'
    except Exception: pass
    return m


def make_container_paint(name='CONTAINER_PAINT'):
    """Six muted liveries picked by Object Info -> Random; value node NEUTRAL=1 switches to light neutral (for baking)."""
    m = bpy.data.materials.new(name); g = NB(m); b = g.bsdf
    pos = g.coords(); x, y, z = g.sep(pos)[:3]
    oi = g.node('ShaderNodeObjectInfo')
    ramp = g.node('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
    cols = ['#7a2f22', '#2c4a63', '#3f5a3a', '#a08560', '#6b6f70', '#9a5a2a']
    el = ramp.color_ramp.elements; el[0].position = 0.0; el[0].color = (*srgb(cols[0]), 1); el[1].position = 1 / 6; el[1].color = (*srgb(cols[1]), 1)
    for i in range(2, 6):
        e = el.new(i / 6); e.color = (*srgb(cols[i]), 1)
    g.L.new(oi.outputs['Random'], ramp.inputs['Fac'])
    neutral = g.node('ShaderNodeValue', name='NEUTRAL', label='NEUTRAL'); neutral.outputs[0].default_value = 0.0
    col = g.mix(neutral.outputs[0], ramp.outputs['Color'], g.rgb(srgb('#c9c7c2')))
    big = g.noise(pos, 0.5, 3.0); col = g.mix(1.0, col, g.mr(big, 0.3, 0.7, 0.86, 1.1), 'MULTIPLY')
    fn = g.noise(pos, 30.0, 6.0); col = g.mix(1.0, col, g.mr(fn, 0.3, 0.7, 0.93, 1.06), 'MULTIPLY')
    # faded / chalky top, rust streaks running down, dirt at the bottom rail
    col = g.mix(g.mr(z, 1.6, 2.6, 0.0, 0.18), col, g.rgb(srgb('#bdb6aa')))
    rn = g.noise(g.comb(g.math('MULTIPLY', g.math('ADD', x, y), 6.0), g.math('MULTIPLY', z, 0.35), 0.0), 1.0, 4.0)
    rs = g.math('MULTIPLY', g.mr(rn, 0.6, 0.8, 0.0, 0.55), g.mr(z, 0.4, 2.5, 0.3, 1.0))
    col = g.mix(rs, col, g.rgb(RUST))
    col = g.mix(g.mr(g.math('ADD', z, g.math('MULTIPLY', fn, 0.2)), 0.05, 0.45, 0.6, 0.0), col, g.rgb(DIRT))
    ao = g.node('ShaderNodeAmbientOcclusion'); ao.samples = 6; ao.inputs['Distance'].default_value = 0.15
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, ao.outputs['AO']), 0.5), col, g.rgb(GRIME))
    g.L.new(col, b.inputs['Base Color']); g.L.new(g.mr(fn, 0.3, 0.7, 0.5, 0.7), b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = 0.25
    m['bake'] = True; m['rough'] = 0.6; m['metal'] = 0.25
    return m


C = srgb
MATDEFS = {
    'CLADDING':     lambda n: make_paint(n, C('#adb1b1'), 0.55, 0.15, hseam=1.0, vseam=6.0, seam_dark=0.42, streaks=1.0, dirt=0.9, dirt_h=0.8, grime=0.45, stains=0.3),
    'CLADDING_DK':  lambda n: make_paint(n, C('#8d9497'), 0.55, 0.15, hseam=1.0, vseam=6.0, streaks=0.6, dirt=0.8, dirt_h=0.7, grime=0.4, stains=0.2),
    'CONCRETE':     lambda n: make_paint(n, C('#9c998f'), 0.85, 0.0, var=0.12, fine=0.1, hseam=0.0, vseam=3.0, seam_dark=0.25, dirt=0.9, dirt_h=0.5, grime=0.45, stains=0.5, streaks=0.5),
    'CONCRETE_DECK': lambda n: make_paint(n, C('#8f8c86'), 0.9, 0.0, var=0.14, fine=0.12, vseam=6.0, seam_dark=0.35, grime=0.4, stains=0.7, algae=True, big_scale=0.12),
    'ROOF_FLAT':    lambda n: make_paint(n, C('#5e6264'), 0.85, 0.0, var=0.1, fine=0.08, vseam=1.0, seam_dark=0.2, grime=0.45, stains=0.5, stain_col=C('#3f4142')),
    'ROOF_STEEL':   lambda n: make_paint(n, C('#8c959b'), 0.45, 0.55, var=0.08, rust=0.25, grime=0.5, stains=0.35, stain_col=C('#6d6458')),
    'STEEL_DARK':   lambda n: make_paint(n, C('#3b4045'), 0.5, 0.4, var=0.06, grime=0.3, dirt=0.4),
    'STEEL_GALV':   lambda n: make_paint(n, C('#9ea4a6'), 0.42, 0.75, var=0.1, grime=0.35, rust=0.12),
    'PAINT_YELLOW': lambda n: make_paint(n, C('#e2a915'), 0.5, 0.0, var=0.08, grime=0.4, dirt=0.6, dirt_h=0.4, rust=0.1),
    'PAINT_RED':    lambda n: make_paint(n, C('#a3241c'), 0.5, 0.0, var=0.08, grime=0.35),
    'PAINT_WHITE':  lambda n: make_paint(n, C('#d9d9d4'), 0.5, 0.0, var=0.06, grime=0.35, dirt=0.4),
    'PAINT_GREEN':  lambda n: make_paint(n, C('#5f6b5a'), 0.55, 0.1, var=0.07, grime=0.4, dirt=0.5, rust=0.12),
    'RUBBER':       lambda n: make_paint(n, C('#1c1c1c'), 0.85, 0.0, var=0.08, grime=0.2),
    'INTERIOR':     lambda n: make_paint(n, C('#596067'), 0.75, 0.1, var=0.08, hseam=1.0, vseam=6.0, grime=0.5, dirt=0.6, dirt_h=1.0),
    'FLOOR':        lambda n: make_paint(n, C('#7c7a74'), 0.6, 0.0, var=0.15, fine=0.1, vseam=6.0, grime=0.5, stains=0.6, stain_col=C('#3e3a34')),
    'DOOR_STEEL':   lambda n: make_paint(n, C('#6f7a82'), 0.5, 0.2, var=0.06, grime=0.4, dirt=0.7, dirt_h=0.5),
    'ROLLUP':       lambda n: make_paint(n, C('#9aa1a4'), 0.45, 0.6, var=0.08, hseam=0.15, seam_dark=0.4, grime=0.4),
    'HVAC':         lambda n: make_paint(n, C('#c6c3b8'), 0.5, 0.1, var=0.07, grime=0.45, rust=0.1),
    'GRAVEL':       lambda n: make_paint(n, C('#7d7a73'), 0.95, 0.0, var=0.2, fine=0.35, fine_scale=60.0, grime=0.3, bump=0.5),
    'ORE':          lambda n: make_paint(n, C('#8a5a33'), 0.95, 0.0, var=0.25, fine=0.35, fine_scale=40.0, grime=0.35, bump=0.6, stains=0.4, stain_col=C('#4d3a2a')),
    'CERAMIC':      lambda n: make_paint(n, C('#6b3a22'), 0.25, 0.0, var=0.06, grime=0.25),
    'ALU':          lambda n: make_paint(n, C('#b8bcbe'), 0.35, 0.85, var=0.06, grime=0.25),
    'RADOME':       lambda n: make_paint(n, C('#e6e4dc'), 0.45, 0.0, var=0.05, grime=0.25, stains=0.3, stain_col=C('#a8a294')),
    'CONTAINER_DARK': lambda n: make_paint(n, C('#2e2f2f'), 0.6, 0.3, var=0.08, grime=0.35, rust=0.3),
    'HAZARD':       lambda n: make_hazard(n),
    'GLASS':        lambda n: make_glass(n),
    'GLASS_SKY':    lambda n: make_glass(n, C('#a9b6b4'), 0.3, light=True, transp=0.65),
    'GLOW_LAMP':    lambda n: make_glow(n, (1.0, 0.86, 0.66), 6.0),
    'GLOW_HIBAY':   lambda n: make_glow(n, (1.0, 0.93, 0.82), 40.0),
    'GLOW_RED':     lambda n: make_glow(n, (1.0, 0.08, 0.04), 8.0),
    'GLOW_AMBER':   lambda n: make_glow(n, (1.0, 0.45, 0.05), 6.0),
    'TEAM_ACCENT':  lambda n: make_team(),
    'FENCE':        lambda n: make_fence(n),
    'CONTAINER_PAINT': lambda n: make_container_paint(n),
}


def M(name):
    m = bpy.data.materials.get(name)
    if m is None: m = MATDEFS[name](name); m.name = name
    return m


def mat_cat(name):
    if name == 'TEAM_ACCENT': return 'team'
    if name.startswith('GLASS'): return 'glass'
    if name.startswith('GLOW'): return 'glow'
    if name.startswith('FENCE'): return 'fence'
    return 'bake'

# ═══════════════════════════════════════════ geometry builder ═══════════════════════════════════════════
def V(*a): return Vector(a[0]) if len(a) == 1 else Vector(a)


class Part:
    def __init__(self, cat):
        self.bm = bmesh.new(); self.mats = []; self.cat = cat
        self.streak = self.bm.loops.layers.float_color.new('streak')
        self.uv = self.bm.loops.layers.uv.new('UVMap') if cat == 'fence' else None

    def mi(self, mat):
        if mat not in self.mats: self.mats.append(mat)
        return self.mats.index(mat)


class Wall:
    """Axis-aligned wall frame: outer face line p0->p1 (building on the left), outward normal on the right."""
    def __init__(self, p0, p1, t):
        self.p0 = Vector((p0[0], p0[1], 0)); d = Vector((p1[0] - p0[0], p1[1] - p0[1], 0)); self.L = d.length
        self.eu = d.normalized(); self.en = Vector((self.eu.y, -self.eu.x, 0)); self.t = t
        ax = 'X' if abs(self.en.x) > 0.5 else 'Y'
        self.facing = ('+' if (self.en.x + self.en.y) > 0 else '-') + ax

    def P(self, u, v, w=0.0): return self.p0 + self.eu * u + Vector((0, 0, v)) + self.en * w


class Builder:
    def __init__(self, name):
        self.name = name; self.parts = {}; self.group = 'main'; self.excluded = set()

    # ---- grouping
    class _G:
        def __init__(s, b, g, ex): s.b, s.g, s.ex = b, g, ex
        def __enter__(s):
            s.prev = s.b.group; s.b.group = s.g
            if s.ex: s.b.excluded.add(s.g)
        def __exit__(s, *a): s.b.group = s.prev

    def grp(self, g, exclude=False): return Builder._G(self, g, exclude)

    def part(self, mat):
        key = (self.group, mat_cat(mat))
        if key not in self.parts: self.parts[key] = Part(key[1])
        return self.parts[key]

    def _face(self, p, verts, mat, smooth=False, streak=None, uvs=None):
        try: f = p.bm.faces.new(verts)
        except ValueError: return None
        f.material_index = p.mi(mat); f.smooth = smooth
        if streak is not None:
            for l, s in zip(f.loops, streak): l[p.streak] = s
        if uvs is not None and p.uv is not None:
            for l, uv in zip(f.loops, uvs): l[p.uv].uv = uv
        return f

    # ---- primitives
    def box(self, mat, lo, hi, M=None, skip=''):
        """Box from local min/max corners, optionally transformed by matrix M. skip: e.g. '-z+y' drops those faces."""
        p = self.part(mat); bm = p.bm
        x0, y0, z0 = lo; x1, y1, z1 = hi
        if x1 < x0: x0, x1 = x1, x0
        if y1 < y0: y0, y1 = y1, y0
        if z1 < z0: z0, z1 = z1, z0
        cs = {}
        for ix, xx in ((0, x0), (1, x1)):
            for iy, yy in ((0, y0), (1, y1)):
                for iz, zz in ((0, z0), (1, z1)):
                    co = Vector((xx, yy, zz)); cs[(ix, iy, iz)] = bm.verts.new(M @ co if M is not None else co)
        F = {'-z': [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)], '+z': [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
             '-y': [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], '+y': [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
             '-x': [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)], '+x': [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)]}
        for k, idx in F.items():
            if k in skip: continue
            self._face(p, [cs[i] for i in idx], mat)

    def boxc(self, mat, c, s, rz=0.0, skip=''):
        if rz:
            Mx = Matrix.Translation(Vector(c)) @ Matrix.Rotation(rz, 4, 'Z')
            self.box(mat, (-s[0] / 2, -s[1] / 2, -s[2] / 2), (s[0] / 2, s[1] / 2, s[2] / 2), Mx, skip)
        else:
            self.box(mat, (c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2), (c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2), None, skip)

    def beam(self, mat, p0, p1, w, h=None, up=(0, 0, 1)):
        """Rectangular member from p0 to p1, cross-section w (side) x h (up)."""
        p0, p1 = Vector(p0), Vector(p1); a = p1 - p0; L = a.length
        if L < 1e-6: return
        ax = a / L; upv = Vector(up)
        if abs(ax.dot(upv)) > 0.99: upv = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
        side = ax.cross(upv).normalized(); upn = side.cross(ax).normalized()
        Mx = Matrix(((ax.x, side.x, upn.x, p0.x), (ax.y, side.y, upn.y, p0.y), (ax.z, side.z, upn.z, p0.z), (0, 0, 0, 1)))
        h = w if h is None else h
        self.box(mat, (0, -w / 2, -h / 2), (L, w / 2, h / 2), Mx)

    def cyl(self, mat, p0, p1, r, n=12, r2=None, caps=(True, True), smooth=True, phase=0.0):
        p = self.part(mat); bm = p.bm
        p0, p1 = Vector(p0), Vector(p1); a = p1 - p0
        if a.length < 1e-6: return
        ah = a.normalized(); ref = Vector((0, 0, 1)) if abs(ah.z) < 0.9 else Vector((1, 0, 0))
        u = ah.cross(ref).normalized(); v = ah.cross(u)
        r2 = r if r2 is None else r2
        bot, top = [], []
        for i in range(n):
            t = phase + 2 * math.pi * i / n; d = u * math.cos(t) + v * math.sin(t)
            bot.append(bm.verts.new(p0 + d * r)); top.append(bm.verts.new(p1 + d * r2))
        for i in range(n):
            j = (i + 1) % n; self._face(p, [bot[i], bot[j], top[j], top[i]], mat, smooth)
        if caps[0]: self._face(p, bot[::-1], mat)
        if caps[1] and r2 > 1e-5: self._face(p, top, mat)

    def sweep(self, mat, pts, r, sides=8, closed=False, caps=True, smooth=True, bend=0.0):
        """Tube along a polyline (rounded corners with radius `bend`)."""
        pts = [Vector(q) for q in pts]
        if bend > 0 and len(pts) > 2 and not closed:
            out = [pts[0]]
            for i in range(1, len(pts) - 1):
                a, b, c = pts[i - 1], pts[i], pts[i + 1]
                d1 = (b - a); d2 = (c - b); l1, l2 = d1.length, d2.length
                if l1 < 1e-6 or l2 < 1e-6: continue
                d1 /= l1; d2 /= l2; ang = d1.angle(d2) if d1.dot(d2) < 0.9999 else 0.0
                if ang < 1e-3: out.append(b); continue
                k = min(bend * math.tan(ang / 2), l1 * 0.45, l2 * 0.45)
                s, e = b - d1 * k, b + d2 * k; nseg = max(2, int(ang / (math.pi / 6)))
                for j in range(nseg + 1):
                    t = j / nseg; q = (1 - t) ** 2 * s + 2 * (1 - t) * t * b + t ** 2 * e; out.append(q)
            out.append(pts[-1]); pts = out
        p = self.part(mat); bm = p.bm; n = len(pts)
        tans = []
        for i in range(n):
            if closed: t = (pts[(i + 1) % n] - pts[i - 1])
            elif i == 0: t = pts[1] - pts[0]
            elif i == n - 1: t = pts[-1] - pts[-2]
            else: t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            tans.append(t.normalized())
        ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
        nrm = tans[0].cross(ref).normalized(); rings = []
        for i in range(n):
            if i > 0:
                q = tans[i - 1].rotation_difference(tans[i]); nrm = (q @ nrm); nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
            bnm = tans[i].cross(nrm)
            sc = 1.0
            if 0 < i < n - 1 or closed:
                d0 = (pts[i] - pts[i - 1]).normalized(); cosh = max(0.3, d0.dot(tans[i])); sc = 1.0 / cosh
            ring = []
            for k in range(sides):
                th = 2 * math.pi * k / sides; d = nrm * math.cos(th) + bnm * math.sin(th)
                ring.append(bm.verts.new(pts[i] + d * r))
            rings.append(ring)
        segs = n if closed else n - 1
        for i in range(segs):
            A, B = rings[i], rings[(i + 1) % n]
            for k in range(sides):
                k2 = (k + 1) % sides; self._face(p, [A[k], A[k2], B[k2], B[k]], mat, smooth)
        if caps and not closed:
            self._face(p, rings[0][::-1], mat); self._face(p, rings[-1], mat)

    def sphere(self, mat, c, r, seg=16, rings=8, phi_max=math.pi, scale=(1, 1, 1), smooth=True, cap=True, M=None):
        """UV sphere (polar angle 0..phi_max from +Z). phi_max < pi gives a cut sphere/dome; cap closes the cut.
        M: optional matrix applied about the centre (for tilted dishes)."""
        p = self.part(mat); bm = p.bm; c0 = Vector(c); sx, sy, sz = scale
        class _BV:
            def __init__(s_, bm_): s_.bm = bm_
            def new(s_, co): return s_.bm.verts.new(c0 + (M @ (co - c0) if M is not None else (co - c0)))
        bmv = _BV(bm); c = c0
        top = bmv.new(c + Vector((0, 0, r * sz)))
        prev = None; rows = []
        for i in range(1, rings + 1):
            ph = phi_max * i / rings; row = []
            if abs(ph - math.pi) < 1e-6:
                rows.append('bottom'); break
            for k in range(seg):
                th = 2 * math.pi * k / seg
                row.append(bmv.new(c + Vector((r * math.sin(ph) * math.cos(th) * sx, r * math.sin(ph) * math.sin(th) * sy, r * math.cos(ph) * sz))))
            rows.append(row)
        first = rows[0]
        for k in range(seg): self._face(p, [top, first[k], first[(k + 1) % seg]], mat, smooth)
        for i in range(len(rows) - 1):
            A, B = rows[i], rows[i + 1]
            if B == 'bottom':
                bot = bmv.new(c - Vector((0, 0, r * sz)))
                for k in range(seg): self._face(p, [A[(k + 1) % seg], A[k], bot], mat, smooth)
                return
            for k in range(seg):
                k2 = (k + 1) % seg; self._face(p, [A[k], B[k], B[k2], A[k2]], mat, smooth)
        if cap: self._face(p, rows[-1][::-1], mat)

    def prism(self, mat, poly, axis, a0, a1, caps=True, sides=True):
        """Extrude a 2D polygon along an axis: 'X' poly=(y,z), 'Y' poly=(x,z), 'Z' poly=(x,y)."""
        p = self.part(mat); bm = p.bm
        area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
        pts = list(poly) if area > 0 else list(poly)[::-1]
        def P3(q, a):
            if axis == 'X': return Vector((a, q[0], q[1]))
            if axis == 'Y': return Vector((q[0], a, q[1]))
            return Vector((q[0], q[1], a))
        lo, hi = (a0, a1) if axis != 'Y' else (a1, a0)   # basis e1 x e2 = +X, -Y, +Z respectively
        B = [bm.verts.new(P3(q, lo)) for q in pts]; T = [bm.verts.new(P3(q, hi)) for q in pts]; n = len(pts)
        if sides:
            for i in range(n):
                j = (i + 1) % n; self._face(p, [B[i], B[j], T[j], T[i]], mat)
        if caps:
            self._face(p, B[::-1], mat); self._face(p, T, mat)

    def quad(self, mat, a, b, c, d, uvs=None):
        p = self.part(mat); bm = p.bm
        return self._face(p, [bm.verts.new(Vector(q)) for q in (a, b, c, d)], mat, uvs=uvs)

    def corrugated(self, mat, O, eu, ev, Lu, Lv, period=0.333, depth=0.035, profile='trap', under=None, th=0.08):
        """Profiled sheet: profile varies along eu, ribs run along ev; normal = eu x ev. Optional flat underside."""
        p = self.part(mat); bm = p.bm; O, eu, ev = Vector(O), Vector(eu).normalized(), Vector(ev).normalized(); ew = eu.cross(ev)
        if profile == 'trap': prof = [(0.0, 0.0), (0.66, 0.0), (0.74, 1.0), (0.92, 1.0), (1.0, 0.0)]
        else: prof = [(0.0, 0.0), (0.18, 1.0), (0.5, 1.0), (0.68, 0.0), (1.0, 0.0)]   # 'box' container-like corrugation
        n = max(1, int(round(Lu / period))); per = Lu / n; us = []
        for k in range(n):
            for (f, h) in (prof[:-1] if k < n - 1 else prof):
                us.append((k * per + f * per, h * depth))
        chunk = max(1, int(4.0 / per))   # ~4 m wide UV islands (split across the ribs only: no extra faces)
        for v0, v1 in ((0.0, Lv),):
            for s0 in range(0, len(us) - 1, chunk * 4):
                seg = us[s0:min(len(us), s0 + chunk * 4 + 1)]
                A = [bm.verts.new(O + eu * u + ew * h + ev * v0) for u, h in seg]; Bv = [bm.verts.new(O + eu * u + ew * h + ev * v1) for u, h in seg]
                for i in range(len(seg) - 1): self._face(p, [A[i], A[i + 1], Bv[i + 1], Bv[i]], mat)
        if under:
            pu = self.part(under); b2 = pu.bm
            q = [b2.verts.new(O - ew * th), b2.verts.new(O - ew * th + ev * Lv), b2.verts.new(O - ew * th + ev * Lv + eu * Lu), b2.verts.new(O - ew * th + eu * Lu)]
            self._face(pu, q, under)

    # ---- walls with openings
    def wall(self, W, z0, z1, openings=(), mat='CLADDING', bands=(), inner=None, reveal=None, ends=True, top=False, streaks=True):
        """W: Wall frame. openings: dicts u0,u1,v0,v1,kind. bands: [(z_break, mat_below)] splits material by height.
        inner: material for the inner face (None = no inner face)."""
        L, t = W.L, W.t
        us = sorted(set([0.0, L] + [o['u0'] for o in openings] + [o['u1'] for o in openings]))
        vs = sorted(set([z0, z1] + [o['v0'] for o in openings if z0 < o['v0'] < z1] + [o['v1'] for o in openings if z0 < o['v1'] < z1]
                        + [bz for bz, _ in bands if z0 < bz < z1]))
        def mat_at(v):
            for bz, bm_ in sorted(bands):
                if v < bz: return bm_
            return mat
        def hole(uc, vc):
            for o in openings:
                if o['u0'] < uc < o['u1'] and o['v0'] < vc < o['v1']: return o
            return None
        p = self.part(mat); bm = p.bm
        CH = 4.0   # break vertex sharing every ~4 m so UV islands stay small (packs the atlas much better)
        class _Lazy(dict):
            def __init__(s, w): s.w = w
            def __missing__(s, k):
                i, j, c = k; v = bm.verts.new(W.P(us[i], vs[j], s.w)); s[k] = v; return v
        Vo_, Vi_ = _Lazy(0.0), _Lazy(-t)
        for i in range(len(us) - 1):
            ch = int(((us[i] + us[i + 1]) / 2) // CH)
            Vo = {(a, b): Vo_[(a, b, ch)] for a in (i, i + 1) for b in range(len(vs))}
            Vi = {(a, b): Vi_[(a, b, ch)] for a in (i, i + 1) for b in range(len(vs))} if inner else None
            for j in range(len(vs) - 1):
                uc, vc = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
                if hole(uc, vc): continue
                m_ = mat_at(vc); st = None
                if streaks:
                    above = [o for o in openings if o['u0'] <= uc <= o['u1'] and o['v0'] >= vs[j + 1] - 1e-6 and o.get('kind') == 'window']
                    if above:
                        o = min(above, key=lambda o: o['v0'])
                        if o['v0'] - vs[j] < 4.0:
                            du = o['u1'] - o['u0']
                            st = [((us[a] - o['u0']) / du, o['v0'] - vs[b], 1.0, 1.0) for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
                    if st is None: st = [(0, 0, 0, 1)] * 4
                pp = self.part(m_)
                if pp is p:
                    self._face(p, [Vo[(i, j)], Vo[(i + 1, j)], Vo[(i + 1, j + 1)], Vo[(i, j + 1)]], m_, streak=st)
                    if inner: self._face(p, [Vi[(i, j + 1)], Vi[(i + 1, j + 1)], Vi[(i + 1, j)], Vi[(i, j)]], inner if callable(inner) is False else inner)
                else:   # different category (e.g. team band) -> separate quad
                    self.quad(m_, W.P(us[i], vs[j]), W.P(us[i + 1], vs[j]), W.P(us[i + 1], vs[j + 1]), W.P(us[i], vs[j + 1]))
        # reveals
        for o in openings:
            rm = o.get('reveal', reveal or mat)
            a, b_, c, d = o['u0'], o['u1'], o['v0'], o['v1']
            if c > z0 + 1e-6: self.quad(rm, W.P(a, c, 0), W.P(b_, c, 0), W.P(b_, c, -t), W.P(a, c, -t))
            if d < z1 - 1e-6: self.quad(rm, W.P(a, d, -t), W.P(b_, d, -t), W.P(b_, d, 0), W.P(a, d, 0))
            self.quad(rm, W.P(a, c, 0), W.P(a, c, -t), W.P(a, d, -t), W.P(a, d, 0))
            self.quad(rm, W.P(b_, d, 0), W.P(b_, d, -t), W.P(b_, c, -t), W.P(b_, c, 0))
        if ends:
            for j in range(len(vs) - 1):
                m_ = mat_at((vs[j] + vs[j + 1]) / 2); a, b_ = vs[j], vs[j + 1]
                self.quad(m_, W.P(0, a, -t), W.P(0, a, 0), W.P(0, b_, 0), W.P(0, b_, -t))
                self.quad(m_, W.P(L, a, 0), W.P(L, a, -t), W.P(L, b_, -t), W.P(L, b_, 0))
        if top: self.quad(mat, W.P(0, z1, 0), W.P(L, z1, 0), W.P(L, z1, -t), W.P(0, z1, -t))

    def wbox(self, mat, W, u0, u1, v0, v1, w0, w1, skip=''):
        """Axis-aligned box in a wall frame (u along wall, v = z, w outward)."""
        a = W.P(u0, v0, w0); b = W.P(u1, v1, w1)
        self.box(mat, (min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)), (max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)), None, skip)

    def wquad(self, mat, W, u0, u1, v0, v1, w):
        self.quad(mat, W.P(u0, v0, w), W.P(u1, v0, w), W.P(u1, v1, w), W.P(u0, v1, w))

    # ---- finalize
    def finalize(self):
        coll = bpy.data.collections.new(self.name); bpy.context.scene.collection.children.link(coll)
        objs = []
        for (grp, cat), p in sorted(self.parts.items()):
            if not p.bm.faces: p.bm.free(); continue
            nm = self.name + ('' if grp == 'main' else '_' + grp) + ('' if cat == 'bake' else '_' + cat)
            me = bpy.data.meshes.new(nm); p.bm.normal_update(); p.bm.to_mesh(me); p.bm.free()
            for mn in p.mats: me.materials.append(M(mn))
            if cat != 'fence' and 'UVMap' in me.uv_layers: me.uv_layers.remove(me.uv_layers['UVMap'])
            o = bpy.data.objects.new(nm, me); coll.objects.link(o)
            if grp in self.excluded: o['exclude_bounds'] = True
            o['group'] = grp; objs.append(o)
        return coll, objs

# ═══════════════════════════════════════════ shared building kit ═══════════════════════════════════════════
def opening(u0, u1, v0, v1, kind, **kw):
    d = dict(u0=u0, u1=u1, v0=v0, v1=v1, kind=kind); d.update(kw); return d


def window_insert(B, W, o, frame='STEEL_DARK', sill='ALU', depth=0.10, mull=True):
    """Frame + glass + projecting sill inside a window opening."""
    u0, u1, v0, v1 = o['u0'], o['u1'], o['v0'], o['v1']; f = 0.055; w0, w1 = -depth - 0.06, -depth + 0.02
    B.wquad('GLASS', W, u0, u1, v0, v1, -depth)
    B.wbox(frame, W, u0, u1, v0, v0 + f, w0, w1, skip='')
    B.wbox(frame, W, u0, u1, v1 - f, v1, w0, w1)
    B.wbox(frame, W, u0, u0 + f, v0 + f, v1 - f, w0, w1)
    B.wbox(frame, W, u1 - f, u1, v0 + f, v1 - f, w0, w1)
    if mull and (u1 - u0) > 0.9:
        um = (u0 + u1) / 2; B.wbox(frame, W, um - 0.03, um + 0.03, v0 + f, v1 - f, w0 + 0.01, w1)
    if (v1 - v0) > 1.6:
        vm = v0 + (v1 - v0) * 0.7; B.wbox(frame, W, u0 + f, u1 - f, vm - 0.03, vm + 0.03, w0 + 0.01, w1)
    if sill:
        B.wbox(sill, W, u0 - 0.06, u1 + 0.06, v0 - 0.04, v0 + 0.01, -0.02, 0.07)


def door_insert(B, W, o, leaf='DOOR_STEEL', frame='STEEL_DARK', canopy=0.9, lamp=True, glass=True, stoop=None, rails=True, base=0.0):
    """Personnel door: proud frame outside the clear opening, recessed leaf (doors group), canopy, lamp, stoop + steps."""
    u0, u1, v0, v1 = o['u0'], o['u1'], o['v0'], o['v1']; uc = (u0 + u1) / 2
    fw = 0.08
    B.wbox(frame, W, u0 - fw, u0, v0, v1 + fw, 0.0, 0.045, skip='-z')
    B.wbox(frame, W, u1, u1 + fw, v0, v1 + fw, 0.0, 0.045, skip='-z')
    B.wbox(frame, W, u0, u1, v1, v1 + fw, 0.0, 0.045)
    with B.grp('doors'):
        B.wbox(leaf, W, u0 + 0.004, u1 - 0.004, v0 + 0.004, v1 - 0.004, -0.11, -0.06)
        if glass:
            B.wquad('GLASS', W, uc - 0.16, uc + 0.16, v0 + 1.35, v0 + 1.85, -0.058)
        B.wbox('STEEL_GALV', W, u1 - 0.16, u1 - 0.06, v0 + 1.0, v0 + 1.06, -0.06, -0.01)     # handle
        B.wbox('STEEL_GALV', W, u1 - 0.12, u1 - 0.09, v0 + 0.96, v0 + 1.1, -0.06, -0.04)
        B.wbox('STEEL_GALV', W, u0 + 0.02, u1 - 0.02, v0 + 0.02, v0 + 0.25, -0.06, -0.055)   # kick plate
    if canopy:
        cz = v1 + 0.08; cw = (u1 - u0) / 2 + 0.55
        B.wbox('STEEL_DARK', W, uc - cw, uc + cw, cz, cz + 0.05, 0.0, canopy)
        B.wbox('STEEL_GALV', W, uc - cw, uc + cw, cz + 0.05, cz + 0.17, canopy - 0.04, canopy)   # fascia
        B.wbox('STEEL_GALV', W, uc - cw, uc - cw + 0.04, cz + 0.05, cz + 0.17, 0.0, canopy)
        B.wbox('STEEL_GALV', W, uc + cw - 0.04, uc + cw, cz + 0.05, cz + 0.17, 0.0, canopy)
        for s in (-1, 1):   # tie rods
            B.cyl('STEEL_GALV', W.P(uc + s * (cw - 0.1), cz + 0.85, 0.02), W.P(uc + s * (cw - 0.1), cz + 0.12, canopy - 0.08), 0.012, 5, caps=(False, False))
        if lamp:
            l0 = min(0.35, canopy * 0.25); l1 = min(l0 + 0.18, canopy - 0.06)
            B.wbox('STEEL_DARK', W, uc - 0.09, uc + 0.09, cz - 0.04, cz, l0, l1)
            a, b_ = W.P(uc - 0.07, cz - 0.042, l0 + 0.02), W.P(uc + 0.07, cz - 0.042, l1 - 0.02)
            B.box('GLOW_LAMP', (min(a.x, b_.x), min(a.y, b_.y), a.z - 0.004), (max(a.x, b_.x), max(a.y, b_.y), a.z), skip='+z')
    elif lamp:
        wall_lamp(B, W, uc, v1 + 0.45)
    if stoop:   # stoop = (landing depth, step depth, n steps) ; sill at v0
        ld, sd, ns = stoop; hw = (u1 - u0) / 2 + 0.5; h = v0; rel = v0 - base
        B.wbox('CONCRETE', W, uc - hw, uc + hw, base, h, 0.0, ld, skip='-z')
        for k in range(ns):
            hk = base + rel * (ns - k) / (ns + 1); w0 = ld + k * sd
            B.wbox('CONCRETE', W, uc - hw + 0.05, uc + hw - 0.05, base, hk, w0, w0 + sd, skip='-z')
        B.wbox('PAINT_YELLOW', W, uc - hw, uc + hw, h - 0.004, h + 0.003, ld - 0.05, ld + 0.002, skip='-z')     # nosings
        for k in range(ns):
            hk = base + rel * (ns - k) / (ns + 1); w1 = ld + (k + 1) * sd
            B.wbox('PAINT_YELLOW', W, uc - hw + 0.05, uc + hw - 0.05, hk - 0.004, hk + 0.003, w1 - 0.05, w1 + 0.002, skip='-z')
        if rails:
            tot = ld + ns * sd - 0.05
            for s in (-1, 1):
                uu = uc + s * (hw - 0.04)
                B.cyl('STEEL_GALV', W.P(uu, h, 0.08), W.P(uu, h + 0.95, 0.08), 0.022, 6)
                B.cyl('STEEL_GALV', W.P(uu, 0.0 + 0.01, tot), W.P(uu, 0.95 + h * 0.3, tot), 0.022, 6)
                B.sweep('STEEL_GALV', [W.P(uu, h + 0.95, 0.08), W.P(uu, h + 0.95, ld), W.P(uu, 0.95 + h * 0.3, tot)], 0.022, 6, bend=0.1)


def wall_lamp(B, W, u, v, w_out=0.3):
    B.wbox('STEEL_DARK', W, u - 0.04, u + 0.04, v - 0.02, v + 0.18, 0.0, 0.06)
    B.wbox('STEEL_DARK', W, u - 0.14, u + 0.14, v - 0.08, v + 0.04, 0.0, w_out)
    a, b_ = W.P(u - 0.12, v - 0.081, 0.04), W.P(u + 0.12, v - 0.081, w_out - 0.03)
    B.box('GLOW_LAMP', (min(a.x, b_.x), min(a.y, b_.y), a.z - 0.004), (max(a.x, b_.x), max(a.y, b_.y), a.z), skip='+z')


def service_box(B, W, u, v0, w, h, d=0.25, mat='PAINT_GREEN', conduit_to=None):
    B.wbox(mat, W, u - w / 2, u + w / 2, v0, v0 + h, 0.0, d)
    B.wbox('STEEL_DARK', W, u - w / 2 - 0.02, u + w / 2 + 0.02, v0 + h, v0 + h + 0.04, 0.0, d + 0.03)   # drip hood
    B.wbox('STEEL_DARK', W, u - 0.012, u + 0.012, v0 + 0.02, v0 + h - 0.02, d, d + 0.005)                  # door split
    B.wbox('STEEL_GALV', W, u + 0.04, u + 0.07, v0 + h * 0.45, v0 + h * 0.55, d, d + 0.03)
    if conduit_to is not None:
        B.cyl('STEEL_GALV', W.P(u - w / 4, v0 + h + 0.04, d * 0.4), W.P(u - w / 4, conduit_to, d * 0.4), 0.03, 6)


def ladder(B, base, up_to, side, out, width=0.45, so=0.18, cage_from=None, mat='STEEL_GALV', top_ext=1.0, back=0.7, land_z=None, R=0.36):
    """Fixed ladder against a wall. base=(x,y) of the ladder centre on the wall face line, side=unit along the wall,
    out=unit outward, so=stand-off of the stiles. Goose-neck rails go back over the edge to land_z."""
    side, out = Vector(side), Vector(out); c = Vector((base[0], base[1], 0)); Z = lambda z: Vector((0, 0, z))
    top = up_to + top_ext
    for s in (-1, 1):
        q = c + side * (s * width / 2) + out * so
        B.beam(mat, q, q + Z(top), 0.065, 0.02)
        for zz in (0.4, up_to * 0.5, up_to - 0.25):   # wall brackets
            B.beam(mat, c + side * (s * width / 2) + Z(zz), q + Z(zz), 0.04, 0.04)
    n = int((top - 0.15) / 0.3)
    for k in range(1, n + 1):
        B.cyl(mat, c + side * (-width / 2) + out * so + Z(k * 0.3), c + side * (width / 2) + out * so + Z(k * 0.3), 0.016, 5, caps=(False, False))
    if top_ext > 0.3:   # goose-neck hand rails over the edge
        lz = up_to + 0.02 if land_z is None else land_z
        for s in (-1, 1):
            q = c + side * (s * width / 2) + out * so
            B.sweep(mat, [q + Z(top), q - out * (so + back) + Z(top), q - out * (so + back) + Z(lz)], 0.022, 6, bend=0.12)
    if cage_from is not None:
        cc = c + out * (so + 0.1)
        hz = cage_from
        while hz <= top + 0.01:
            arc = [cc + side * (R * math.cos(a)) + out * (R * math.sin(a)) + Z(hz) for a in [math.pi * i / 8 for i in range(9)]]
            B.sweep(mat, [c + side * (width / 2) + out * so + Z(hz)] + arc + [c - side * (width / 2) + out * so + Z(hz)], 0.012, 4, caps=False)
            hz += 0.9
        for a in [math.pi * i / 4 for i in range(5)]:
            q = cc + side * (R * math.cos(a)) + out * (R * math.sin(a))
            B.beam(mat, q + Z(cage_from), q + Z(top), 0.04, 0.012)


def railing(B, pts, h=1.1, mat='STEEL_GALV', post=1.4, r=0.022, toe=True, closed=False):
    pts = [Vector(q) for q in pts]
    if closed: pts = pts + [pts[0]]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; L = (b - a).length; n = max(1, int(math.ceil(L / post)))
        for k in range(n + (1 if i == len(pts) - 2 and not closed else 0)):
            q = a + (b - a) * (k / n)
            B.cyl(mat, q, q + Vector((0, 0, h)), r * 1.15, 6, caps=(False, True))
        if toe:
            d = (b - a).normalized(); nrm = Vector((-d.y, d.x, 0)) * 0.006
            B.box(mat, (0, -0.006, 0), (L, 0.006, 0.1), Matrix.Translation(a) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z'), skip='-z')
    for hh in (h, h * 0.5):
        B.sweep(mat, [q + Vector((0, 0, hh)) for q in pts], r, 6, caps=not closed, bend=0.0)


def hvac_unit(B, c, s, mat='HVAC', fans=1, frame_h=0.0, rz=0.0):
    """Condensing unit: casing, louvres, top fan(s). c = centre of base, s = size (local x = long side), rz = yaw."""
    Mx = Matrix.Translation(Vector(c)) @ Matrix.Rotation(rz, 4, 'Z'); P = lambda a, b, cc: Mx @ Vector((a, b, cc))
    z0 = frame_h; hx, hy = s[0] / 2, s[1] / 2
    if frame_h:
        for sx in (-1, 1):
            B.box('STEEL_DARK', (-hx - 0.05, sx * hy - 0.04, 0), (hx + 0.05, sx * hy + 0.04, z0), Mx)
    B.box(mat, (-hx, -hy, z0), (hx, hy, z0 + s[2]), Mx)
    for k in range(5):   # louvres on the long faces
        zz = z0 + 0.12 + k * (s[2] - 0.25) / 5
        for sy in (-1, 1):
            B.box('STEEL_DARK', (-hx + 0.08, sy * hy - 0.01, zz), (hx - 0.08, sy * (hy + 0.012), zz + 0.05), Mx, skip='-z+z')
    for f in range(fans):
        fx = -hx + s[0] * (f + 0.5) / fans; r = min(s[0] / fans, s[1]) * 0.36
        B.cyl('STEEL_DARK', P(fx, 0, z0 + s[2] - 0.01), P(fx, 0, z0 + s[2] + 0.05), r, 14, caps=(False, True))
        B.cyl('STEEL_GALV', P(fx, 0, z0 + s[2] + 0.05), P(fx, 0, z0 + s[2] + 0.06), r * 0.25, 8, caps=(False, True))


def turbine_vent(B, x, y, z, top, r=0.16):
    B.cyl('STEEL_GALV', (x, y, z - 0.1), (x, y, top - 2 * r * 0.9), r * 0.75, 10, caps=(False, False))
    B.sphere('STEEL_GALV', (x, y, top - r * 0.9), r, 12, 6, scale=(1, 1, 0.9))


def mannequin(B, x, y, z=0.0, rz=0.0, mat='FIG'):
    """1.80 m reference figure (preview only)."""
    R = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z')
    def P(a, b, c): return R @ Vector((a, b, c))
    for s in (-1, 1):
        B.cyl(mat, P(0, s * 0.1, 0.0), P(0, s * 0.1, 0.86), 0.075, 8, r2=0.085)
        B.cyl(mat, P(0, s * 0.25, 1.42), P(0.03, s * 0.29, 0.8), 0.05, 8)
    B.cyl(mat, P(0, 0, 0.84), P(0, 0, 1.45), 0.17, 10, r2=0.2)
    B.cyl(mat, P(0, 0, 1.45), P(0, 0, 1.56), 0.05, 8)
    B.sphere(mat, P(0, 0, 1.68), 0.12, 12, 8)

# ═══════════════════════════════════════════ assets ═══════════════════════════════════════════
ASSET_FUNCS = {}
def asset(name):
    def deco(f): ASSET_FUNCS[name] = f; return f
    return deco


def rect_walls(B, x0, x1, y0, y1, z1, T, ops, mat='CLADDING', bands=(), inner=None, z0=0.0, streaks=True):
    """Four walls around a rectangle (S/N span full length, E/W fit between). ops: {'S': [dict(c=, w=, v0=, v1=, kind=)]}
    with c = world x (S/N) or y (E/W) of the opening centre. Returns (walls, u_of, placed) with placed = [(side, W, opening)]."""
    walls = {'S': Wall((x0, y0), (x1, y0), T), 'E': Wall((x1, y0 + T), (x1, y1 - T), T),
             'N': Wall((x1, y1), (x0, y1), T), 'W': Wall((x0, y1 - T), (x0, y0 + T), T)}
    def u_of(k, c):
        W = walls[k]; q = Vector((c, W.p0.y, 0)) if k in 'SN' else Vector((W.p0.x, c, 0)); return (q - W.p0).dot(W.eu)
    placed = []
    for k, W in walls.items():
        ol = []
        for o in ops.get(k, []):
            u = u_of(k, o['c']); d = opening(u - o['w'] / 2, u + o['w'] / 2, o['v0'], o['v1'], o['kind'])
            for kk, vv in o.items():
                if kk not in ('c', 'w'): d.setdefault(kk, vv)
            ol.append(d); placed.append((k, W, d))
        B.wall(W, z0, z1, ol, mat, bands=bands, inner=inner, ends=(k in 'SN'), streaks=streaks)
    return walls, u_of, placed


def gable(B, x_out, x_in, y0, y1, z0, z_apex, mat='CLADDING', inner='INTERIOR'):
    """Triangular gable infill between wall top z0 and apex, outer face at x_out, inner at x_in."""
    ym = (y0 + y1) / 2; o = [(x_out, y0, z0), (x_out, y1, z0), (x_out, ym, z_apex)]; i = [(x_in, y0, z0), (x_in, y1, z0), (x_in, ym, z_apex)]
    p = B.part(mat); bm = p.bm
    vo = [bm.verts.new(q) for q in o]; out_dir = 1 if x_out > x_in else -1
    B._face(p, vo if out_dir > 0 else vo[::-1], mat)
    if inner:
        pi = B.part(inner); vi = [pi.bm.verts.new(q) for q in i]; B._face(pi, vi[::-1] if out_dir > 0 else vi, inner)


def slope_box(B, mat, x0, x1, y0, y1, zf, h, skip=''):
    """Box lying on a sloped roof: footprint x0..x1 / y0..y1, base height zf(y) (linear in y), thickness h."""
    za, zb = zf(y0), zf(y1); ang = math.atan2(zb - za, y1 - y0); L = math.hypot(y1 - y0, zb - za)
    Mx = Matrix.Translation((0, y0, za)) @ Matrix.Rotation(ang, 4, 'X')
    B.box(mat, (x0, 0, 0), (x1, L, h), Mx, skip)


def bollard(B, x, y, h=1.1, r=0.11):
    B.cyl('PAINT_YELLOW', (x, y, 0), (x, y, h), r, 12, caps=(False, False))
    B.sphere('PAINT_YELLOW', (x, y, h), r, 12, 4, phi_max=math.pi / 2, cap=False)
    for z in (h - 0.25, h - 0.4):
        B.cyl('STEEL_DARK', (x, y, z), (x, y, z + 0.06), r + 0.004, 12, caps=(False, False))


def floodlight(B, W, u, v, w_out=0.45, tilt=0.5):
    """Wall-mounted LED floodlight on an arm."""
    B.wbox('STEEL_DARK', W, u - 0.06, u + 0.06, v - 0.08, v + 0.08, 0.0, 0.04)
    B.cyl('STEEL_DARK', W.P(u, v, 0.02), W.P(u, v, w_out - 0.1), 0.025, 6)
    a = W.P(u - 0.22, v - 0.06, w_out - 0.12); b = W.P(u + 0.22, v + 0.1, w_out + 0.06)
    lo = Vector(map(min, a, b)); hi = Vector(map(max, a, b))
    B.box('STEEL_DARK', lo, hi)
    g0 = W.P(u - 0.19, v - 0.061, w_out - 0.1); g1 = W.P(u + 0.19, v - 0.061, w_out + 0.04)
    B.box('GLOW_LAMP', (min(g0.x, g1.x), min(g0.y, g1.y), g0.z - 0.004), (max(g0.x, g1.x), max(g0.y, g1.y), g0.z), skip='+z')


def ground_pipes(B, W, u0, u1, v, w=0.12, r=0.05, mat='STEEL_GALV'):
    B.cyl(mat, W.P(u0, v, w), W.P(u1, v, w), r, 8)
    for u in [u0 + 0.3 + k * 2.0 for k in range(int((u1 - u0 - 0.3) / 2.0) + 1)]:
        B.wbox('STEEL_DARK', W, u - 0.03, u + 0.03, v - r - 0.03, v + r + 0.03, 0.0, w + r)


@asset('bld_barracks')
def build_barracks(B):
    X, Y = 11.8, 5.1          # wall outer faces
    EAVE = 5.0; s = math.tan(math.radians(6.0)); T = 0.25
    RT = lambda yy: EAVE + 0.12 + (Y - abs(yy)) * s          # roof top surface height
    PL = 0.45                 # concrete plinth
    win_x = [-10.0 + 2.5 * k for k in range(9)]
    GF = (1.05, 2.30); FF = (3.45, 4.60); WW = 1.3
    doors_s = [-5.0, 5.0]; doors_n = [0.0]; SILL = 0.30
    meta = {'doors': []}
    walls = {
        'S': Wall((-X, -Y), (X, -Y), T), 'E': Wall((X, -Y + T), (X, Y - T), T),
        'N': Wall((X, Y), (-X, Y), T), 'W': Wall((-X, Y - T), (-X, -Y + T), T)}
    ops = {k: [] for k in walls}
    def u_of(Wk, x_or_y):
        W = walls[Wk]; q = Vector((x_or_y, W.p0.y, 0)) if Wk in 'SN' else Vector((W.p0.x, x_or_y, 0))
        return (q - W.p0).dot(W.eu)
    for Wk, dl in (('S', doors_s), ('N', doors_n)):
        for x in win_x:
            u = u_of(Wk, x)
            ops[Wk].append(opening(u - WW / 2, u + WW / 2, FF[0], FF[1], 'window'))
            if x in dl: ops[Wk].append(opening(u - 0.45, u + 0.45, SILL, SILL + 2.10, 'door', reveal='STEEL_DARK'))
            else: ops[Wk].append(opening(u - WW / 2, u + WW / 2, GF[0], GF[1], 'window'))
    for Wk in 'EW':
        for yy in (-2.4, 2.4):
            u = u_of(Wk, yy)
            for lo, hi in (GF, FF): ops[Wk].append(opening(u - 0.6, u + 0.6, lo, hi, 'window'))
    for Wk, W in walls.items():
        B.wall(W, 0.0, EAVE, ops[Wk], 'CLADDING', bands=[(PL, 'CONCRETE')], ends=(Wk in 'SN'))
        for o in ops[Wk]:
            if o['kind'] == 'window': window_insert(B, W, o)
            else:
                door_insert(B, W, o, stoop=(0.55, 0.30, 1), canopy=0.9)
                c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
                meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10,
                                          sill_z=SILL, facing=W.facing))
        # accent band (E/W pieces wrap over the S/N wall ends)
        ext = 0.0 if Wk in 'SN' else T + 0.022
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 2.62, 2.88, 0.0, 0.022)
    # gable triangles
    for sx in (-1, 1):
        x0 = sx * X; x1 = sx * (X - T)
        B.prism('CLADDING', [(-Y, EAVE), (Y, EAVE), (0, EAVE + Y * s)], 'X', min(x0, x1), max(x0, x1))
        # gable louvre
        xo = sx * (X + 0.03)
        B.box('STEEL_DARK', (min(xo, sx * X), -0.5, EAVE + 0.05), (max(xo, sx * X), 0.5, EAVE + 0.38))
        for k in range(4):
            B.box('STEEL_GALV', (min(xo, sx * (X + 0.05)), -0.46, EAVE + 0.09 + k * 0.075), (max(xo, sx * (X + 0.05)), 0.46, EAVE + 0.12 + k * 0.075))
    # roof: two corrugated slopes + soffits, ridge cap, verge flashings, gutters, downpipes
    OH, VG = 0.35, 0.2
    ye = Y + OH; ze = RT(ye); L = math.hypot(ye, RT(0) - ze)
    B.corrugated('ROOF_STEEL', (-X - VG, -ye, ze), (1, 0, 0), (0, ye, RT(0) - ze), 2 * (X + VG), L, 0.333, 0.035, under='ROOF_STEEL', th=0.1)
    B.corrugated('ROOF_STEEL', (X + VG, ye, ze), (-1, 0, 0), (0, -ye, RT(0) - ze), 2 * (X + VG), L, 0.333, 0.035, under='ROOF_STEEL', th=0.1)
    zr = RT(0)
    B.prism('STEEL_GALV', [(-0.32, zr - 0.32 * s + 0.02), (0, zr + 0.075), (0.32, zr - 0.32 * s + 0.02), (0.32, zr - 0.32 * s - 0.005), (0, zr + 0.05), (-0.32, zr - 0.32 * s - 0.005)], 'X', -X - VG, X + VG)
    ang = math.atan(s)
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = Vector((sx * (X + VG), sy * ye, ze)); b_ = Vector((sx * (X + VG), 0, zr))
            a.x -= sx * 0.025; b_.x -= sx * 0.025
            B.beam('STEEL_GALV', a + Vector((0, 0, -0.05)), b_ + Vector((0, 0, -0.05)), 0.05, 0.22)
        # gutter + downpipes
        yg = sx * (ye + 0.07)
        B.box('STEEL_GALV', (-X - VG, yg - 0.08, ze - 0.2), (X + VG, yg + 0.08, ze - 0.04), skip='')
        for xx in (-X + 0.3, X - 0.3):
            B.sweep('STEEL_GALV', [(xx, yg, ze - 0.2), (xx, yg, ze - 0.45), (xx, sx * (Y + 0.08), ze - 0.85), (xx, sx * (Y + 0.08), 0.22), (xx, sx * (Y + 0.25), 0.05)], 0.05, 8, bend=0.12)
    # roof gear (top of HVAC = 6.00 m exactly)
    for hx in (-7.6, 7.6):
        yy = -4.0; zb = RT(-3.55)
        hvac_unit(B, (hx, yy, zb), (1.5, 0.8, 6.0 - zb - 0.18 - 0.06), fans=2, frame_h=0.18)
        B.box('STEEL_DARK', (hx - 0.9, yy - 0.5, RT(yy - 0.5) - 0.05), (hx + 0.9, yy + 0.5, zb + 0.02))
        B.sweep('STEEL_GALV', [(hx + 0.6, yy + 0.4, zb + 0.3), (hx + 0.6, yy + 1.2, zb + 0.3), (hx + 0.6, yy + 1.2, RT(yy + 1.2) - 0.1)], 0.035, 6, bend=0.08)
    for tx in (-4.5, 0.0, 4.5):
        turbine_vent(B, tx, 0.9, RT(0.9), 5.98)
    for tx in (-10.5, 10.5):   # exhaust boxes on north slope
        zb = RT(2.5); B.box('HVAC', (tx - 0.35, 2.2, zb - 0.1), (tx + 0.35, 2.8, zb + 0.45))
        B.box('STEEL_DARK', (tx - 0.3, 2.15, zb + 0.05), (tx + 0.3, 2.21, zb + 0.4))
    # eave guard rail in front of HVAC (0.86 m keeps the top at 6.0)
    for hx in (-7.6, 7.6):
        yr = -Y + 0.15
        railing(B, [(hx - 1.6, yr, RT(yr)), (hx + 1.6, yr, RT(yr))], h=6.0 - RT(yr) - 0.025, post=1.6, toe=False)
    # ladder on north wall, stood off past the gutter, goose-neck back onto the roof
    WN = walls['N']; lx = 10.95
    ladder(B, (lx, Y), EAVE + 0.1, (1, 0, 0), (0, 1, 0), so=0.62, top_ext=0.75, back=1.1, land_z=RT(Y - 0.5) + 0.02)
    # wall lamps, service boxes, pipes, AC condensers
    WS, WE, WW_ = walls['S'], walls['E'], walls['W']
    for x in (-8.75, 8.75, -1.25, 1.25):
        wall_lamp(B, WS, u_of('S', x), 3.05)
    for x in (-6.25, 6.25):
        wall_lamp(B, WN, u_of('N', x), 3.05)
    for yy in (-0.0,):
        wall_lamp(B, WE, u_of('E', 0.0), 3.6, 0.19); wall_lamp(B, WW_, u_of('W', 0.0), 3.6, 0.19)
    service_box(B, WW_, u_of('W', -0.9), 0.55, 0.7, 0.95, 0.19, conduit_to=EAVE - 0.1)
    service_box(B, WW_, u_of('W', 0.2), 0.75, 0.5, 0.7, 0.17, 'PAINT_WHITE')
    service_box(B, WE, u_of('E', 0.6), 0.6, 0.55, 0.75, 0.17, 'HVAC')
    # gas line (yellow) on the east wall
    B.sweep('PAINT_YELLOW', [WE.P(u_of('E', -0.6), 0.0, 0.1), WE.P(u_of('E', -0.6), 0.7, 0.1), WE.P(u_of('E', 0.4), 0.7, 0.1)], 0.03, 6, bend=0.08)
    B.wbox('STEEL_DARK', WE, u_of('E', -0.75), u_of('E', -0.45), 0.85, 1.2, 0.0, 0.18)
    # conduit along the south wall under the eave
    ground_pipes(B, WS, 0.4, WS.L - 0.4, EAVE - 0.25, w=0.06, r=0.03)
    for i, x in enumerate((-8.75, -3.75, 3.75, 8.75)):   # split AC units, north wall
        u = u_of('N', x); v = 0.6 if i % 2 == 0 else 3.0
        B.wbox('STEEL_DARK', WN, u - 0.45, u - 0.4, v - 0.05, v, 0.0, 0.42); B.wbox('STEEL_DARK', WN, u + 0.4, u + 0.45, v - 0.05, v, 0.0, 0.42)
        B.wbox('HVAC', WN, u - 0.42, u + 0.42, v, v + 0.62, 0.05, 0.38)
        q = WN.P(u, v + 0.31, 0.385); B.cyl('STEEL_DARK', q, q + WN.en * 0.01, 0.2, 14, caps=(False, True))
        B.sweep('STEEL_GALV', [WN.P(u + 0.3, v + 0.5, 0.05), WN.P(u + 0.3, v + 0.8, 0.03), WN.P(u + 0.3, v + 1.2, 0.03)], 0.018, 5, bend=0.05)
    meta['cam'] = dict(azim=-58, elev=24, lens=38)
    meta['figures'] = [(-5.0 + 1.1, -6.6, 0.0, 1.9), (-3.4, -7.4, 0.0, 1.6), (0.9, -7.0, 0.0, 1.4)]
    meta['closeup'] = dict(target=(-5.0, -6.0, 1.4), azim=-70, elev=10, dist=8.5, lens=40)
    meta['spec'] = [24.0, 12.0, 6.0]
    meta['notes'] = ('Two-storey barracks. Body 23.6 x 10.2 m with stoops/canopies filling the 24 x 12 footprint; '
                     'low 6 deg corrugated gable roof, HVAC tops at 6.00 m. Personnel door leaves are in object *_doors '
                     '(closed, recessed 0.06 m); clear openings are cut through the wall, sill 0.30 m on a concrete stoop with one step.')
    return meta

def gable_roof(B, x0, x1, ys, yn, RT, yc, OHs, OHn, VG, under='ROOF_STEEL', th=0.12, period=0.333):
    """Two corrugated slopes (ridge along X at yc) with soffits, ridge cap and verge flashings. Returns (ye_s, ye_n)."""
    ye_s, ye_n = ys - OHs, yn + OHn; zr = RT(yc)
    for (ye, eu, ox) in ((ye_s, (1, 0, 0), x0 - VG), (ye_n, (-1, 0, 0), x1 + VG)):
        ze = RT(ye); L = math.hypot(yc - ye, zr - ze)
        B.corrugated('ROOF_STEEL', (ox, ye, ze), eu, (0, yc - ye, zr - ze), (x1 - x0) + 2 * VG, L, period, 0.035, under=under, th=th)
    sl = (zr - RT(yc + 1.0))
    B.prism('STEEL_GALV', [(yc - 0.32, zr - 0.32 * sl + 0.02), (yc, zr + 0.075), (yc + 0.32, zr - 0.32 * sl + 0.02), (yc + 0.32, zr - 0.32 * sl - 0.005),
                           (yc, zr + 0.05), (yc - 0.32, zr - 0.32 * sl - 0.005)], 'X', x0 - VG, x1 + VG)
    for xx in (x0 - VG + 0.025, x1 + VG - 0.025):
        for ye in (ye_s, ye_n):
            B.beam('STEEL_GALV', Vector((xx, ye, RT(ye) - 0.05)), Vector((xx, yc, zr - 0.05)), 0.05, 0.22)
    return ye_s, ye_n


def gutter(B, x0, x1, yg, z, downs=(), wall_y=None, r=0.07):
    """Box gutter centred at yg (half width 0.08) with its top at z; downpipes at x in downs to the wall line."""
    B.box('STEEL_GALV', (x0, yg - 0.08, z - 0.16), (x1, yg + 0.08, z))
    sgn = 1 if yg > (wall_y or 0) else -1
    for xx in downs:
        B.sweep('STEEL_GALV', [(xx, yg, z - 0.16), (xx, yg, z - 0.4), (xx, wall_y + sgn * 0.09, z - 0.85), (xx, wall_y + sgn * 0.09, 0.25),
                               (xx, wall_y + sgn * 0.22, 0.06)], 0.055, 6, bend=0.12)


@asset('bld_vehicle_factory')
def build_factory(B):
    X = 19.3; YS, YN = -14.3, 14.7; T = 0.3; EAVE = 10.2; s = math.tan(math.radians(5.0))
    yc = (YS + YN) / 2; half = (YN - YS) / 2
    RT = lambda y: EAVE + 0.15 + (half - abs(y - yc)) * s
    DW, DH = 6.0, 5.0; SILL = 0.15
    meta = {'doors': []}
    ops = {'S': [dict(c=0.0, w=DW, v0=0.0, v1=DH, kind='vdoor', reveal='STEEL_DARK')], 'N': [], 'E': [], 'W': []}
    pdoors = [('S', -8.0, 0.7), ('S', 9.0, 0.7), ('E', -6.0, 0.65), ('W', 6.0, 0.6), ('N', 6.0, 0.28)]
    for k, c, _ in pdoors: ops[k].append(dict(c=c, w=0.9, v0=SILL, v1=SILL + 2.1, kind='door', reveal='STEEL_DARK'))
    for k, c in (('S', -10.6), ('S', -5.4), ('S', 11.6), ('E', -3.4), ('W', 3.4), ('W', 8.6), ('N', 3.4)):
        ops[k].append(dict(c=c, w=1.6, v0=1.0, v1=2.2, kind='window'))
    RB = (6.6, 7.6)
    for k, cs in (('S', [-16.2, -12.4, -8.6, 8.6, 12.4, 16.2]), ('N', [-16.0 + 4 * i for i in range(9)]), ('E', [-10.0, -6.0, -2.0, 2.0, 6.0, 10.0]),
                  ('W', [-10.0, -6.0, -2.0, 2.0, 6.0, 10.0])):
        for c in cs: ops[k].append(dict(c=c, w=3.5, v0=RB[0], v1=RB[1], kind='window'))
    walls, u_of, placed = rect_walls(B, -X, X, YS, YN, EAVE, T, ops, 'CLADDING', bands=[(1.2, 'CONCRETE')], inner='INTERIOR')
    for k, W, o in placed:
        if o['kind'] == 'window': window_insert(B, W, o, depth=0.12)
        elif o['kind'] == 'door':
            can = [p[2] for p in pdoors if p[0] == k and abs(u_of(k, p[1]) - (o['u0'] + o['u1']) / 2) < 0.01][0]
            door_insert(B, W, o, canopy=can, stoop=(min(0.6, can), 0.0, 0), rails=False)
            c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
            meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10, sill_z=SILL, facing=W.facing))
    meta['doors'].insert(0, dict(kind='vehicle', center=[0.0, YS, DH / 2], clear_w=DW, clear_h=DH, sill_z=0.0, facing='-Y',
                                 notes='roll-up door raised; no threshold lip; interior floor at z=0 runs straight through'))
    # gables (E/W) above the eave
    for sx in (-1, 1):
        gable(B, sx * X, sx * (X - T), YS, YN, EAVE, RT(yc) - 0.15)
    # team band, wraps the corners
    for k, W in walls.items():
        ext = 0.0 if k in 'SN' else T + 0.03
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 8.1, 8.7, 0.0, 0.03)
    # ── vehicle door: yellow portal with hazard-striped jamb guards (outside the 6.00 m clear width), raised roll-up door
    WS = walls['S']; u = u_of('S', 0.0)
    for sg in (-1, 1):
        a0, a1 = sorted((u + sg * DW / 2, u + sg * (DW / 2 + 0.38)))
        B.wbox('HAZARD', WS, a0, a1, 0.0, 2.4, 0.0, 0.22, skip='-z')
        B.wbox('PAINT_YELLOW', WS, a0, a1, 2.4, DH, 0.0, 0.22)
        bollard(B, sg * (DW / 2 + 0.75), YS - 0.45)
    B.wbox('PAINT_YELLOW', WS, u - DW / 2 - 0.38, u + DW / 2 + 0.38, DH, DH + 0.5, 0.0, 0.22)
    B.wbox('HAZARD', WS, u - DW / 2 - 0.38, u + DW / 2 + 0.38, DH + 0.5, DH + 0.62, 0.0, 0.22)
    B.cyl('STEEL_DARK', WS.P(u, DH + 0.7, 0.05), WS.P(u, DH + 0.7, 0.2), 0.08, 10)                     # amber beacon
    B.cyl('GLOW_AMBER', WS.P(u, DH + 0.7, 0.2), WS.P(u, DH + 0.95, 0.2) + WS.en * 0.0, 0.07, 10)
    for sg in (-1, 1):
        floodlight(B, WS, u + sg * 4.6, 6.0, 0.5)
    B.wbox('ROLLUP', WS, u - 3.4, u + 3.4, DH + 0.12, DH + 0.95, -T - 0.75, -T, skip='')                  # coil box (inside)
    B.wbox('STEEL_DARK', WS, u - DW / 2, u + DW / 2, DH + 0.02, DH + 0.12, -T - 0.3, -T - 0.08)          # curtain bottom bar
    for sg in (-1, 1):
        a0, a1 = sorted((u + sg * DW / 2, u + sg * (DW / 2 + 0.16)))
        B.wbox('STEEL_DARK', WS, a0, a1, 0.0, DH + 0.12, -T - 0.16, -T, skip='-z')                       # guide channels
    # ── floor (z = 0, flush through the opening; hazard threshold strip)
    B.quad('FLOOR', (-X + T, YS + T, 0), (X - T, YS + T, 0), (X - T, YN - T, 0), (-X + T, YN - T, 0))
    B.quad('HAZARD', (-DW / 2, YS, 0), (DW / 2, YS, 0), (DW / 2, YS + T, 0), (-DW / 2, YS + T, 0))
    for xx in (-DW / 2 - 0.4, DW / 2 + 0.25):
        B.quad('PAINT_YELLOW', (xx, YS + T, 0.003), (xx + 0.15, YS + T, 0.003), (xx + 0.15, 9.0, 0.003), (xx, 9.0, 0.003))
    B.quad('PAINT_YELLOW', (-DW / 2 - 0.4, 9.0, 0.003), (DW / 2 + 0.4, 9.0, 0.003), (DW / 2 + 0.4, 9.15, 0.003), (-DW / 2 - 0.4, 9.15, 0.003))
    # ── interior structure: columns, crane runway + bridge crane, rafters, high-bay lamps, benches
    yS_in, yN_in = YS + T + 0.2, YN - T - 0.2; xW_in, xE_in = -X + T + 0.2, X - T - 0.2
    for xx in (-12.0, -6.0, 6.0, 12.0):                      # wall columns on the long walls
        for yy in (yS_in, yN_in):
            B.boxc('STEEL_DARK', (xx, yy, EAVE / 2), (0.32, 0.32, EAVE), skip='-z')
    for yy in (-12.0, -6.0, 0.0, 6.0, 12.0):                   # crane columns + brackets on the gable walls
        for sx in (-1, 1):
            xc = sx * (X - T - 0.2)
            B.boxc('STEEL_DARK', (xc, yy, EAVE / 2), (0.36, 0.36, EAVE), skip='-z')
            B.boxc('STEEL_DARK', (xc - sx * 0.35, yy, 6.8), (0.5, 0.32, 0.3))
    xr = X - T - 0.55
    for sx in (-1, 1):                                          # runway girders + rails along Y
        B.box('PAINT_YELLOW', (sx * xr - 0.18, yS_in, 6.95), (sx * xr + 0.18, yN_in, 7.5))
        B.box('STEEL_GALV', (sx * xr - 0.04, yS_in, 7.5), (sx * xr + 0.04, yN_in, 7.6))
    yb = 5.0                                                    # bridge crane spanning X, seen through the door
    for dy in (-0.45, 0.45):
        B.box('PAINT_YELLOW', (-xr, yb + dy - 0.2, 7.75), (xr, yb + dy + 0.2, 8.6))
    for sx in (-1, 1):
        B.boxc('HAZARD', (sx * xr, yb, 7.85), (0.5, 2.8, 0.5))
    B.boxc('PAINT_YELLOW', (0.0, yb, 8.85), (1.4, 1.5, 0.5))      # hoist trolley
    B.boxc('STEEL_DARK', (0.0, yb, 8.6), (0.8, 0.5, 0.35))
    for dx in (-0.12, 0.12):
        B.cyl('STEEL_DARK', (dx, yb, 8.45), (dx, yb, 6.25), 0.016, 5, caps=(False, False))
    B.boxc('HAZARD', (0.0, yb, 6.0), (0.45, 0.32, 0.45)); B.cyl('STEEL_DARK', (0.0, yb, 5.78), (0.0, yb, 5.45), 0.05, 8)
    B.sweep('STEEL_DARK', [(0.0, yb, 5.47), (0.0, yb + 0.12, 5.35), (0.0, yb, 5.25), (0.0, yb - 0.1, 5.33)], 0.03, 6, caps=True)
    zr = RT(yc) - 0.15
    for xx in (-15.0, -9.0, -3.0, 3.0, 9.0, 15.0):
        B.beam('STEEL_DARK', (xx, YS + T, EAVE - 0.25), (xx, yc, zr - 0.25), 0.2, 0.45)
        B.beam('STEEL_DARK', (xx, YN - T, EAVE - 0.25), (xx, yc, zr - 0.25), 0.2, 0.45)
    for xx in (-12.0, -4.0, 4.0, 12.0):
        for yy in (-7.0, 0.0, 7.0):
            zt = RT(yy) - 0.4
            B.cyl('STEEL_DARK', (xx, yy, zt), (xx, yy, 9.6), 0.012, 4, caps=(False, False))
            B.cyl('STEEL_DARK', (xx, yy, 9.6), (xx, yy, 9.3), 0.12, 8, r2=0.28, caps=(True, False))
            B.cyl('GLOW_HIBAY', (xx, yy, 9.31), (xx, yy, 9.29), 0.26, 8, caps=(True, False))
    for i, yy in enumerate((-10.2, -8.4, -3.6, 2.4, 8.4)):        # tool cabinets / benches along the west wall
        xw = -X + T
        B.box('PAINT_RED' if i % 2 else 'PAINT_GREEN', (xw, yy - 0.9, 0), (xw + 0.6, yy + 0.9, 1.9 if i % 2 else 0.95))
        if i % 2 == 0: B.box('STEEL_DARK', (xw, yy - 1.0, 0.95), (xw + 0.8, yy + 1.0, 1.0))
    for yy in (-10.0, -6.5):                                      # pallets of crates in the east bay
        B.box('STEEL_DARK', (14.0, yy - 0.6, 0.0), (15.2, yy + 0.6, 0.14)); B.box('CONTAINER_DARK', (14.05, yy - 0.55, 0.14), (15.15, yy + 0.55, 1.05))
    # ── roof: corrugated slopes, ridge ventilator, skylights, turbines, AHU, gutters, downpipes
    VG = 0.2; OHs, OHn = 0.3, 0.15
    ye_s, ye_n = gable_roof(B, -X, X, YS, YN, RT, yc, OHs, OHn, VG, under='INTERIOR', th=0.15)
    B.box('ROOF_STEEL', (-15.0, yc - 0.6, RT(yc) - 0.2), (15.0, yc + 0.6, 11.78))
    for sg in (-1, 1):
        for k in range(3):
            zz = RT(yc) - 0.13 + k * 0.1
            B.box('STEEL_DARK', (-14.8, yc + sg * 0.6 - 0.012, zz), (14.8, yc + sg * 0.6 + 0.012, zz + 0.08), skip='-z+z')
    B.prism('STEEL_GALV', [(yc - 0.95, 11.79), (yc, 12.0), (yc + 0.95, 11.79), (yc + 0.95, 11.75), (yc, 11.955), (yc - 0.95, 11.75)], 'X', -15.2, 15.2)
    for sg in (-1, 1):
        for xx in (-14.0, -8.0, 8.0, 14.0):
            ya, yb = sorted((yc + sg * 5.5, yc + sg * 7.0))
            slope_box(B, 'STEEL_GALV', xx - 1.55, xx + 1.55, ya - 0.06, yb + 0.06, lambda y: RT(y) + 0.02, 0.06)
            slope_box(B, 'GLASS_SKY', xx - 1.45, xx + 1.45, ya, yb, lambda y: RT(y) + 0.06, 0.05, skip='-z')
    for (tx, ty) in ((-2.0, -4.0), (2.0, -4.0), (-2.0, 4.4), (2.0, 4.4)):
        turbine_vent(B, tx, ty, RT(ty), RT(ty) + 0.55, r=0.2)
    ay = -9.6; zp = RT(ay - 0.8) + 0.25
    B.box('STEEL_DARK', (8.6, ay - 0.9, RT(ay + 0.9) - 0.05), (12.4, ay + 0.9, zp))
    hvac_unit(B, (10.5, ay, zp), (3.2, 1.3, 11.95 - zp - 0.06), fans=3)
    B.sweep('STEEL_GALV', [(9.3, ay + 0.65, zp + 0.5), (9.3, ay + 2.2, zp + 0.5), (9.3, ay + 2.2, RT(ay + 2.2) - 0.1)], 0.18, 10, bend=0.3)
    gutter(B, -X - VG, X + VG, ye_s - 0.08, RT(ye_s) - 0.03, downs=(-X + 0.35, -6.0, 6.0, X - 0.35), wall_y=YS)
    gutter(B, -X - VG, X + VG, ye_n + 0.07, RT(ye_n) - 0.03, downs=(-X + 0.35, X - 0.35), wall_y=YN)
    # ── east ladder with cage to the roof + guard rail at the landing
    ly = -12.6
    ladder(B, (X, ly), RT(ly), (0, 1, 0), (1, 0, 0), so=0.25, cage_from=2.4, top_ext=1.05, back=1.0, land_z=RT(ly) + 0.03, R=0.32)
    railing(B, [(X - 0.1, ly + 1.3, RT(ly + 1.3)), (X - 2.0, ly + 1.3, RT(ly + 1.3)), (X - 2.0, ly - 1.2, RT(ly - 1.2)), (X - 0.1, ly - 1.2, RT(ly - 1.2))], h=1.1, post=1.3)
    # ── west wall services: switchboards, conduit, compressor; north wall pipe run
    WW_, WN, WE = walls['W'], walls['N'], walls['E']
    for i, yy in enumerate((-9.2, -8.1, -7.0)):
        service_box(B, WW_, u_of('W', yy), 0.2, 1.0, 1.9, 0.55, 'PAINT_WHITE' if i == 1 else 'PAINT_GREEN', conduit_to=EAVE - 0.3)
    B.box('CONCRETE', (-X - 0.7, -1.4, 0.0), (-X, 1.0, 0.15))
    hvac_unit(B, (-X - 0.36, -0.2, 0.15), (2.1, 0.66, 1.1), fans=2, rz=math.pi / 2)
    B.box('HVAC', (-X - 0.7, -1.32, 0.15), (-X - 0.02, -1.31, 1.25))
    B.sweep('PAINT_YELLOW', [WN.P(0.5, 4.2, 0.18), WN.P(WN.L - 0.5, 4.2, 0.18)], 0.07, 8)
    for uu in [1.0 + 3.0 * k for k in range(13)]:
        B.wbox('STEEL_DARK', WN, uu - 0.04, uu + 0.04, 4.05, 4.12, 0.0, 0.26)
    B.sweep('PAINT_YELLOW', [WN.P(WN.L - 0.5, 4.2, 0.18), WN.P(WN.L - 0.3, 4.2, 0.18), WN.P(WN.L - 0.3, 4.2, -T - 0.05)], 0.07, 8, bend=0.15)
    for k, cs, v in (('S', (-17.0, 17.0, -13.5, 13.5), 5.6), ('N', (-12.0, 0.0, 12.0), 5.6), ('E', (2.0, 10.5), 5.6), ('W', (-3.5, 10.5), 5.6)):
        for c in cs: wall_lamp(B, walls[k], u_of(k, c), v, 0.28 if k != 'N' else 0.2)
    meta['spec'] = [40.0, 30.0, 12.0]
    meta['cam'] = dict(azim=-72, elev=21, lens=36)
    meta['sun_azim'] = -20
    meta['figures'] = [(-7.0, -15.6, 0, 1.6), (-4.6, -16.3, 0, 1.7), (4.8, -16.8, 0, 1.5)]
    meta['proxies'] = [dict(c=(0.0, YS + 2.6, 0.0), s=(3.6, 7.5, 2.5))]
    meta['lights'] = [((xx, yy, 9.0), (5.0, 4.0), 320.0) for xx in (-12.0, -4.0, 4.0, 12.0) for yy in (-7.0, 1.0, 9.0)]
    meta['closeup'] = dict(target=(0.0, -12.5, 2.6), azim=-85, elev=9, dist=21, lens=40)
    meta['extra_views'] = [dict(target=(0.0, 0.0, 9.0), azim=-120, elev=48, dist=55, lens=40)]
    meta['json'] = {'interior_floor_z': 0.0, 'eave_z': EAVE, 'ridge_z': round(RT(yc), 3), 'crane_hook_min_z': 5.25,
                    'drive_path_clear': {'x': [-DW / 2, DW / 2], 'y': [YS, round(YN - T, 3)], 'z': [0.0, DH]}}
    meta['notes'] = ('Vehicle factory: 38.6 x 29.0 m shed (low 5 deg corrugated gable, ridge ventilator top 12.00 m). Main vehicle door is a real '
                     '6.00 x 5.00 m opening centred at x=0 on the south face (wall outer face y=-14.30); roll-up door raised into a coil box inside '
                     'above z=5.12, guides outside the clear width, hazard jamb guards outside the clear width. Interior floor z=0 with no lip, '
                     'dark interior, crane runways along the E/W walls at 7.0 m and a bridge crane spanning X at y=+5 (hook bottom 5.25 m, above the 5.00 m door head). Personnel door leaves in *_doors.')
    return meta

def parapet_roof(B, x0, x1, y0, y1, T, z_deck, z_top, deck='ROOF_FLAT', inner='CLADDING', coping='STEEL_GALV'):
    """Flat roof deck inside walls whose tops are at z_top: deck, inner parapet faces, coping caps."""
    xa, xb, ya, yb = x0 + T, x1 - T, y0 + T, y1 - T
    B.quad(deck, (xa, ya, z_deck), (xb, ya, z_deck), (xb, yb, z_deck), (xa, yb, z_deck))
    B.quad(inner, (xa, ya, z_deck), (xa, ya, z_top), (xb, ya, z_top), (xb, ya, z_deck))
    B.quad(inner, (xb, yb, z_deck), (xb, yb, z_top), (xa, yb, z_top), (xa, yb, z_deck))
    B.quad(inner, (xb, ya, z_deck), (xb, ya, z_top), (xb, yb, z_top), (xb, yb, z_deck))
    B.quad(inner, (xa, yb, z_deck), (xa, yb, z_top), (xa, ya, z_top), (xa, ya, z_deck))
    c = 0.03
    B.box(coping, (x0 - c, y0 - c, z_top), (x1 + c, y0 + T + c, z_top + 0.06))
    B.box(coping, (x0 - c, y1 - T - c, z_top), (x1 + c, y1 + c, z_top + 0.06))
    B.box(coping, (x0 - c, y0 + T + c, z_top), (x0 + T + c, y1 - T - c, z_top + 0.06))
    B.box(coping, (x1 - T - c, y0 + T + c, z_top), (x1 + c, y1 - T - c, z_top + 0.06))


def lattice(B, mat, cx, cy, w0, w1, z0, z1, levels=6, legs=4, leg_r=0.06, br=0.025):
    """Tapered lattice tower (3 or 4 legs) with horizontals and zig-zag bracing."""
    def corner(i, w, z):
        a = 2 * math.pi * i / legs + (math.pi / 4 if legs == 4 else math.pi / 2)
        rr = w / 2 * (math.sqrt(2) if legs == 4 else 1.0)
        return Vector((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
    for i in range(legs): B.beam(mat, corner(i, w0, z0), corner(i, w1, z1), leg_r * 2, leg_r * 2)
    for k in range(levels + 1):
        t = k / levels; z = z0 + (z1 - z0) * t + (br if k == 0 else 0.0); w = w0 + (w1 - w0) * t
        for i in range(legs): B.beam(mat, corner(i, w, z), corner((i + 1) % legs, w, z), br * 2, br * 2)
        if k < levels:
            t2 = (k + 1) / levels; z2 = z0 + (z1 - z0) * t2; w2 = w0 + (w1 - w0) * t2
            for i in range(legs):
                a, b = (corner(i, w, z), corner((i + 1) % legs, w2, z2)) if k % 2 == 0 else (corner((i + 1) % legs, w, z), corner(i, w2, z2))
                B.beam(mat, a, b, br * 1.6, br * 1.6)


def dish(B, c, r_rim, depth, yaw, tilt, mat='PAINT_WHITE'):
    """Parabolic-looking dish (spherical cap) facing direction (yaw, elevation tilt), with feed struts and horn."""
    R = (r_rim ** 2 + depth ** 2) / (2 * depth); ph = math.asin(min(1.0, r_rim / R))
    Mr = (Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-(math.pi / 2 - tilt), 4, 'Y'))
    ctr = Vector(c) - (Mr @ Vector((0, 0, -R)))          # sphere centre so the cap's back sits at c
    B.sphere(mat, ctr, R, 24, 5, phi_max=ph, cap=False, M=Mr @ Matrix.Rotation(math.pi, 4, 'X'))
    axis = Mr @ Vector((0, 0, 1)); focus = Vector(c) + axis * (R / 2.0 - 0.0) * 0.5 + axis * depth
    for k in range(3):
        a = 2 * math.pi * k / 3; rim = Vector(c) + axis * depth + (Mr @ Vector((math.cos(a), math.sin(a), 0))) * r_rim * 0.95
        B.cyl('STEEL_GALV', rim, focus, 0.02, 5)
    B.cyl('PAINT_WHITE', focus - axis * 0.12, focus + axis * 0.08, 0.09, 10)
    return axis


def whip(B, x, y, z, h, r=0.02):
    B.cyl('STEEL_DARK', (x, y, z), (x, y, z + 0.25), 0.07, 8)
    B.cyl('STEEL_DARK', (x, y, z + 0.25), (x, y, z + h), r, 6, r2=r * 0.4)


def flag(B, x, y, z_top, w=2.2, h=1.4, mat='TEAM_ACCENT'):
    n = 8; pts = []
    for i in range(n + 1):
        t = i / n; pts.append((x + 0.08 + t * w, y + 0.12 * math.sin(t * 5.0) * t, z_top))
    for i in range(n):
        a, b = pts[i], pts[i + 1]; sag = lambda q, t: (q[0], q[1], q[2] - 0.06 * t)
        B.quad(mat, (a[0], a[1], a[2] - h - 0.05 * i / n), (b[0], b[1], b[2] - h - 0.05 * (i + 1) / n), (b[0], b[1], b[2] - 0.05 * (i + 1) / n), (a[0], a[1], a[2] - 0.05 * i / n))


@asset('bld_hq')
def build_hq(B):
    X0, X1 = -14.6, 14.6; YS, YN = -10.6, 11.6; T = 0.3
    ZD, ZP = 7.6, 8.2                 # main roof deck / parapet top
    CX, CY = 6.0, 6.0; ZCD, ZCP = 9.4, 9.94      # core parapet + 0.06 coping = 10.00
    SILL = 0.15; GF = (1.1, 2.7); FF = (4.5, 6.1)
    meta = {'doors': []}
    ops = {'S': [], 'N': [], 'E': [], 'W': []}
    for c in (-12.2, -9.0, -5.8, 5.8, 9.0, 12.2):
        for v in (GF, FF): ops['S'].append(dict(c=c, w=2.6, v0=v[0], v1=v[1], kind='window'))
    for c in (-1.6, 1.6): ops['S'].append(dict(c=c, w=2.6, v0=FF[0], v1=FF[1], kind='window'))
    for c in (-12.2, -9.0, -2.6, 0.6, 3.8, 9.0, 12.2):
        for v in (GF, FF):
            if not (v == GF and c in (-2.6,)): ops['N'].append(dict(c=c, w=2.6, v0=v[0], v1=v[1], kind='window'))
    for k in 'EW':
        for c in (-7.6, -4.2, 0.8, 4.2, 7.6):
            for v in (GF, FF):
                if not (v == GF and ((k == 'E' and c == 0.8) or (k == 'W' and c == -4.2))): ops[k].append(dict(c=c, w=2.6, v0=v[0], v1=v[1], kind='window'))
    pd = [('N', -2.6), ('E', 1.6), ('W', -2.4)]
    for k, c in pd: ops[k].append(dict(c=c, w=0.9, v0=SILL, v1=SILL + 2.1, kind='door', reveal='STEEL_DARK'))
    walls, u_of, placed = rect_walls(B, X0, X1, YS, YN, ZP, T, ops, 'CLADDING', bands=[(1.0, 'CONCRETE')])
    for k, W, o in placed:
        if o['kind'] == 'window': window_insert(B, W, o, depth=0.1)
        else:
            door_insert(B, W, o, canopy=0.38, stoop=(0.38, 0.0, 0), rails=False)
            c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
            meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10, sill_z=SILL, facing=W.facing))
    for k, W in walls.items():
        ext = 0.0 if k in 'SN' else T + 0.03
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 7.65, 7.95, 0.0, 0.03)
        B.wbox('CLADDING_DK', W, -ext, W.L + ext, 3.3, 3.75, 0.0, 0.025)               # floor-line spandrel band
    parapet_roof(B, X0, X1, YS, YN, T, ZD, ZP)
    # ── command core: dark cladding, continuous glazed operations band, own parapet
    cops = {k: [] for k in 'SNEW'}
    for k in 'SNEW':
        for c in (-4.2, -1.4, 1.4, 4.2): cops[k].append(dict(c=c, w=2.6, v0=8.35, v1=9.25, kind='window'))
    cw, cu, cpl = rect_walls(B, -CX, CX, -CY, CY, ZCP, T, cops, 'CLADDING_DK', z0=ZD)
    for k, W, o in cpl: window_insert(B, W, o, depth=0.08, sill=None)
    for k, W in cw.items():
        ext = 0.0 if k in 'SN' else T + 0.03
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 9.5, 9.72, 0.0, 0.03)
    parapet_roof(B, -CX, CX, -CY, CY, T, ZCD, ZCP, inner='CLADDING_DK')
    WCS = cw['S']; B.wbox('TEAM_ACCENT', WCS, 0.4, 1.0, ZD + 0.05, 8.25, 0.0, 0.03)
    # ── glass entrance: vestibule with curtain-wall front, two 0.90 x 2.10 glass doors, canopy, step + landing
    VY = YS - 0.8; VX = 3.0; VZ = 3.4
    B.box('CONCRETE', (-VX - 0.4, VY - 0.4, 0.0), (VX + 0.4, YS, SILL), skip='-z')
    B.box('PAINT_YELLOW', (-VX - 0.4, VY - 0.4, SILL - 0.004), (VX + 0.4, VY - 0.35, SILL + 0.003), skip='-z')
    B.box('CLADDING_DK', (-VX, VY, VZ), (VX, YS, VZ + 0.2))
    B.box('CLADDING_DK', (-4.4, -12.0 + 0.02, VZ + 0.2), (4.4, YS, VZ + 0.42))
    B.box('TEAM_ACCENT', (-4.4, -12.0, VZ + 0.24), (4.4, -12.0 + 0.02, VZ + 0.38))
    for sx in (-1, 1):
        B.cyl('STEEL_DARK', (sx * 4.1, -11.75, SILL), (sx * 4.1, -11.75, VZ + 0.2), 0.09, 10)
        B.box('CONCRETE', (sx * 4.1 - 0.25, -12.0, 0.0), (sx * 4.1 + 0.25, -11.5, SILL), skip='-z')
    for xx in (-3.0, 3.0):
        B.cyl('GLOW_LAMP', (xx * 0.66, -11.6, VZ + 0.19), (xx * 0.66, -11.6, VZ + 0.2), 0.12, 10)
    fd, fm = 0.12, 0.08
    door_x = [(-1.0, -0.1), (0.1, 1.0)]
    mull_x = [-VX, -2.0, -1.0 - fm, -0.1, 1.0, 2.0, VX - fm]
    for mx in mull_x:
        w_ = 0.2 if mx == -0.1 else fm
        B.box('STEEL_DARK', (mx, VY, SILL), (mx + w_, VY + fd, VZ))
    B.box('STEEL_DARK', (-VX, VY, SILL), (VX, VY + fd, SILL + 0.06))
    B.box('STEEL_DARK', (-VX, VY, SILL + 2.1), (VX, VY + fd, SILL + 2.18))
    B.box('STEEL_DARK', (-VX, VY, VZ - 0.08), (VX, VY + fd, VZ))
    for a, b_ in ((-VX + fm, -2.0), (-2.0 + fm, -1.0 - fm), (1.0 + fm, 2.0), (2.0 + fm, VX - fm)):
        B.quad('GLASS', (a, VY + 0.06, SILL + 0.06), (b_, VY + 0.06, SILL + 0.06), (b_, VY + 0.06, VZ - 0.08), (a, VY + 0.06, VZ - 0.08))
    B.quad('GLASS', (-1.0, VY + 0.06, SILL + 2.18), (1.0, VY + 0.06, SILL + 2.18), (1.0, VY + 0.06, VZ - 0.08), (-1.0, VY + 0.06, VZ - 0.08))
    for sx in (-1, 1):   # side glazing
        x_ = sx * VX; B.box('STEEL_DARK', (x_ - fm / 2, VY, SILL), (x_ + fm / 2, YS, SILL + 0.06)); B.box('STEEL_DARK', (x_ - fm / 2, VY, VZ - 0.08), (x_ + fm / 2, YS, VZ))
        B.quad('GLASS', (x_, VY + fd, SILL), (x_, YS, SILL), (x_, YS, VZ), (x_, VY + fd, VZ)) if sx > 0 else \
            B.quad('GLASS', (x_, YS, SILL), (x_, VY + fd, SILL), (x_, VY + fd, VZ), (x_, YS, VZ))
    with B.grp('doors'):
        for a, b_ in door_x:
            B.box('STEEL_DARK', (a + 0.005, VY + 0.04, SILL + 0.005), (b_ - 0.005, VY + 0.09, SILL + 0.09))
            B.box('STEEL_DARK', (a + 0.005, VY + 0.04, SILL + 2.02), (b_ - 0.005, VY + 0.09, SILL + 2.095))
            B.box('STEEL_DARK', (a + 0.005, VY + 0.04, SILL + 0.09), (a + 0.065, VY + 0.09, SILL + 2.02))
            B.box('STEEL_DARK', (b_ - 0.065, VY + 0.04, SILL + 0.09), (b_ - 0.005, VY + 0.09, SILL + 2.02))
            B.quad('GLASS', (a + 0.065, VY + 0.065, SILL + 0.09), (b_ - 0.065, VY + 0.065, SILL + 0.09), (b_ - 0.065, VY + 0.065, SILL + 2.02), (a + 0.065, VY + 0.065, SILL + 2.02))
            hx = b_ - 0.15 if a < 0 else a + 0.15
            B.cyl('STEEL_GALV', (hx, VY + 0.02, SILL + 0.8), (hx, VY + 0.02, SILL + 1.5), 0.016, 6)
        for a, b_ in door_x:
            meta['doors'].insert(0, dict(kind='personnel', center=[round((a + b_) / 2, 3), round(VY, 3), round(SILL + 1.05, 3)], clear_w=0.90, clear_h=2.10,
                                         sill_z=SILL, facing='-Y', notes='glass entrance door'))
    # ── roof gear: HVAC, hatch with guard rail, ladder up the core, vents
    for hx in (-10.6, 10.6):
        hvac_unit(B, (hx, 6.5, ZD), (2.2, 1.2, 1.15), fans=2, frame_h=0.2)
        B.sweep('STEEL_GALV', [(hx, 5.9, ZD + 0.6), (hx, 4.2, ZD + 0.6), (hx, 4.2, ZD)], 0.16, 10, bend=0.25)
    B.box('HVAC', (-10.6, -6.6, ZD), (-9.6, -5.6, ZD + 0.45)); B.box('STEEL_GALV', (-10.65, -6.65, ZD + 0.45), (-9.55, -5.55, ZD + 0.5))
    railing(B, [(-11.2, -7.2, ZD), (-9.0, -7.2, ZD), (-9.0, -5.0, ZD), (-11.2, -5.0, ZD)], h=1.05, post=1.1)
    for (vx, vy) in ((-12.5, 0.0), (12.5, -2.0), (8.0, -8.5), (-7.5, 9.5)):
        B.cyl('STEEL_GALV', (vx, vy, ZD), (vx, vy, ZD + 0.55), 0.09, 8); B.cyl('STEEL_GALV', (vx, vy, ZD + 0.55), (vx, vy, ZD + 0.62), 0.16, 8)
    lx = -CX; ly = -2.5
    for sgn in (-1, 1):
        B.beam('STEEL_GALV', (lx - 0.18, ly + sgn * 0.225, ZD), (lx - 0.18, ly + sgn * 0.225, ZCP), 0.065, 0.02)
        B.beam('STEEL_GALV', (lx, ly + sgn * 0.225, 9.0), (lx - 0.18, ly + sgn * 0.225, 9.0), 0.04, 0.04)
    for k in range(1, 8): B.cyl('STEEL_GALV', (lx - 0.18, ly - 0.225, ZD + k * 0.3), (lx - 0.18, ly + 0.225, ZD + k * 0.3), 0.016, 5, caps=(False, False))
    hvac_unit(B, (-3.5, -3.6, ZCD), (1.3, 0.8, ZCP - ZCD - 0.08), fans=1)
    # ── wall services
    WE, WW_, WN = walls['E'], walls['W'], walls['N']
    service_box(B, WW_, u_of('W', 2.5), 0.4, 0.8, 1.2, 0.3, 'PAINT_GREEN', conduit_to=ZP - 0.3)
    service_box(B, WE, u_of('E', -2.5), 0.5, 0.6, 0.8, 0.25, 'PAINT_WHITE')
    B.sweep('PAINT_YELLOW', [WE.P(u_of('E', -4.0), 0.0, 0.1), WE.P(u_of('E', -4.0), 0.8, 0.1), WE.P(u_of('E', -3.2), 0.8, 0.1), WE.P(u_of('E', -3.2), 0.8, -0.2)], 0.035, 6, bend=0.08)
    for k, cs in (('S', (-7.4, 7.4, -13.8, 13.8)), ('N', (-10.6, 2.2, 10.6)), ('E', (-6.0, 6.0)), ('W', (-6.0, 2.5 + 2.2))):
        for c in cs: wall_lamp(B, walls[k], u_of(k, c), 3.0, 0.28 if k == 'S' else 0.3)
    for k, xs in (('S', (-14.3, 14.3)), ('N', (-14.3, 14.3))):
        W = walls[k]
        for xx in xs:
            u = u_of(k, xx); B.wbox('STEEL_GALV', W, u - 0.15, u + 0.15, ZP - 0.5, ZP - 0.25, 0.0, 0.25)
            B.cyl('STEEL_GALV', W.P(u, ZP - 0.5, 0.12), W.P(u, 0.25, 0.12), 0.055, 8); B.cyl('STEEL_GALV', W.P(u, 0.25, 0.12), W.P(u, 0.05, 0.3), 0.055, 8)
    # ── flagpole (pole + flag excluded from bounds), concrete base
    fx, fy = -9.5, -11.4
    B.box('CONCRETE', (fx - 0.45, fy - 0.45, 0.0), (fx + 0.45, fy + 0.45, 0.25), skip='-z')
    with B.grp('flag', exclude=True):
        B.cyl('STEEL_GALV', (fx, fy, 0.25), (fx, fy, 12.0), 0.065, 10, r2=0.04)
        B.sphere('PAINT_YELLOW', (fx, fy, 12.06), 0.07, 10, 5)
        flag(B, fx, fy, 11.85)
    # ── antenna farm + dish on the core roof (excluded from bounds)
    with B.grp('antennas', exclude=True):
        B.box('STEEL_DARK', (1.6, 1.4, ZCD), (3.4, 3.2, ZCD + 0.25))
        B.cyl('STEEL_GALV', (2.5, 2.3, ZCD + 0.25), (2.5, 2.3, ZCD + 1.9), 0.14, 10)
        B.boxc('STEEL_DARK', (2.5, 2.3, ZCD + 2.0), (0.5, 0.5, 0.35))
        dish(B, (2.5, 2.0, ZCD + 2.25), 1.25, 0.35, math.radians(90), math.radians(35))
        lattice(B, 'STEEL_GALV', -3.2, 3.0, 0.9, 0.35, ZCD, ZCD + 5.0, levels=6, legs=3)
        B.cyl('STEEL_GALV', (-3.2, 3.0, ZCD + 5.0), (-3.2, 3.0, ZCD + 6.4), 0.03, 6)
        B.beam('STEEL_GALV', (-4.2, 3.0, ZCD + 5.6), (-2.2, 3.0, ZCD + 5.6), 0.04)
        for k in range(6):
            xx = -4.1 + k * 0.36; L = 1.2 - k * 0.15
            B.beam('STEEL_GALV', (xx, 3.0 - L / 2, ZCD + 5.6), (xx, 3.0 + L / 2, ZCD + 5.6), 0.02)
        B.sphere('GLOW_RED', (-3.2, 3.0, ZCD + 6.45), 0.07, 8, 4)
        for (wx, wy, h) in ((4.5, -4.5, 4.0), (-4.8, -4.6, 3.2), (4.8, 4.6, 5.0), (-0.5, -4.8, 2.6)):
            whip(B, wx, wy, ZCD, h)
        B.cyl('STEEL_DARK', (0.8, 4.6, ZCD), (0.8, 4.6, ZCD + 1.2), 0.04, 6); B.sphere('PAINT_WHITE', (0.8, 4.6, ZCD + 1.3), 0.16, 12, 6)
    meta['spec'] = [30.0, 24.0, 10.0]
    meta['cam'] = dict(azim=-62, elev=26, lens=38)
    meta['figures'] = [(1.8, -12.8, 0, 1.7), (-1.2, -13.4, 0, 1.4), (-8.4, -12.6, 0, 1.6)]
    meta['closeup'] = dict(target=(0.0, -11.5, 2.0), azim=-70, elev=10, dist=13, lens=40)
    meta['json'] = {'roof_deck_z': ZD, 'core_roof_z': ZCD, 'flagpole': [fx, fy, 12.13]}
    meta['notes'] = ('Headquarters: 29.2 x 22.2 m two-storey block (flat roof, parapet 8.20 m) with a 12 x 12 m command core rising to 10.00 m '
                     '(glazed operations band). Glass entrance vestibule on the south face with two 0.90 x 2.10 m glass doors, canopy to y=-12.0. '
                     'Excluded from bounds: *_antennas (dish 2.5 m, lattice mast, whips) and *_flag (12 m flagpole with TEAM_ACCENT flag).')
    return meta

def silo(B, x, y, r, z_leg, z_cone, z_top, z_roof, band_z=None, seg=20):
    """Vertical silo on four legs: cone bottom, ribbed shell, conical roof."""
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2; lx, ly = x + r * 0.8 * math.cos(a), y + r * 0.8 * math.sin(a)
        B.beam('STEEL_DARK', (lx, ly, 0.0), (lx, ly, z_cone + 0.3), 0.3, 0.3)
        B.box('CONCRETE', (lx - 0.3, ly - 0.3, 0.0), (lx + 0.3, ly + 0.3, 0.25))
    B.cyl('STEEL_GALV', (x, y, z_leg - 0.6), (x, y, z_leg), 0.25, 10, caps=(True, False))
    B.cyl('STEEL_GALV', (x, y, z_leg), (x, y, z_cone), 0.35, seg, r2=r, caps=(False, False))
    B.cyl('STEEL_GALV', (x, y, z_cone), (x, y, z_top), r, seg, caps=(False, False))
    B.cyl('STEEL_GALV', (x, y, z_top), (x, y, z_roof), r + 0.05, seg, r2=0.5, caps=(True, True))
    zz = z_cone + 1.8
    while zz < z_top - 0.5:
        B.cyl('STEEL_DARK', (x, y, zz), (x, y, zz + 0.1), r + 0.04, seg, caps=(False, False)); zz += 2.4
    if band_z: B.cyl('TEAM_ACCENT', (x, y, band_z), (x, y, band_z + 0.5), r + 0.02, seg, caps=(False, False))


def gallery(B, p0, p1, w=1.3, h=1.3, cover='CLADDING_DK', truss='STEEL_DARK'):
    """Enclosed inclined conveyor gallery: corrugated-look box on a light truss underside."""
    p0, p1 = Vector(p0), Vector(p1)
    B.beam(cover, p0 + Vector((0, 0, h / 2)), p1 + Vector((0, 0, h / 2)), w, h)
    d = (p1 - p0); L = d.length; side = d.cross(Vector((0, 0, 1))).normalized() * (w / 2 - 0.05)
    n = max(2, int(L / 2.0))
    for s in (-1, 1):
        B.beam(truss, p0 + side * s - Vector((0, 0, 0.35)), p1 + side * s - Vector((0, 0, 0.35)), 0.12, 0.2)
        for k in range(n):
            a = p0 + d * (k / n) + side * s; b = p0 + d * ((k + 1) / n) + side * s
            B.beam(truss, a - Vector((0, 0, 0.35)) if k % 2 else a, b if k % 2 else b - Vector((0, 0, 0.35)), 0.06, 0.06)


def belt_conveyor(B, p0, p1, w=0.9, legs=True, hood=True):
    """Open belt conveyor: side stringers, belt, return rollers, optional legs and hood."""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length; side = d.cross(Vector((0, 0, 1))).normalized()
    for s in (-1, 1):
        B.beam('PAINT_YELLOW', p0 + side * s * w / 2, p1 + side * s * w / 2, 0.08, 0.25)
    B.beam('RUBBER', p0 + Vector((0, 0, 0.12)), p1 + Vector((0, 0, 0.12)), w * 0.85, 0.04)
    B.beam('ORE', p0 + Vector((0, 0, 0.16)), p1 + Vector((0, 0, 0.16)), w * 0.5, 0.06)
    if hood:
        B.beam('STEEL_GALV', p0 + Vector((0, 0, 0.45)), p1 + Vector((0, 0, 0.45)), w * 1.05, 0.04)
    if legs:
        n = max(1, int(L / 3.5))
        for k in range(1, n + 1):
            q = p0 + d * (k / (n + 0.5))
            if q.z < 0.6: continue
            for s in (-1, 1):
                B.beam('STEEL_DARK', Vector((q.x, q.y, 0)) + side * s * w / 2, q + side * s * w / 2 - Vector((0, 0, 0.12)), 0.1, 0.1)


def stack(B, x, y, z0, z1, r, light=True):
    B.cyl('STEEL_GALV', (x, y, z0), (x, y, z1), r, 16, r2=r * 0.85, caps=(False, False))
    B.cyl('STEEL_DARK', (x, y, z1 - 0.1), (x, y, z1), r * 0.88, 16, r2=r * 0.6, caps=(False, False))
    B.cyl('RUBBER', (x, y, z1 - 0.12), (x, y, z1 - 0.11), r * 0.6, 12)
    for k, zz in enumerate((z1 - 1.6, z1 - 3.2)):
        rr = r * 0.86 + 0.01
        B.cyl('PAINT_RED' if k == 0 else 'PAINT_WHITE', (x, y, zz), (x, y, zz + 1.6), rr + 0.01, 16, caps=(False, False))
    zp = z1 - 4.6
    B.cyl('STEEL_DARK', (x, y, zp - 0.1), (x, y, zp), r + 0.9, 16)
    B.sweep('STEEL_GALV', [(x + (r + 0.85) * math.cos(a), y + (r + 0.85) * math.sin(a), zp + 1.0) for a in [2 * math.pi * i / 16 for i in range(16)]], 0.025, 5, closed=True)
    if light: B.sphere('GLOW_RED', (x, y, z1 + 0.12), 0.1, 8, 4)


@asset('bld_ore_refinery')
def build_refinery(B):
    meta = {'doors': []}
    # ── process hall (x -17.7..1.6, y -3.6..13.7), low gable, eave 10.5
    HX0, HX1, HY0, HY1 = -17.4, 1.6, -3.6, 13.6; T = 0.3; EAVE = 10.5; s = math.tan(math.radians(8.0))
    yc = (HY0 + HY1) / 2; half = (HY1 - HY0) / 2; RT = lambda y: EAVE + 0.15 + (half - abs(y - yc)) * s
    SILL = 0.15
    ops = {'S': [], 'N': [], 'E': [], 'W': []}
    for k, c in (('S', -14.2), ('S', -4.2), ('W', 4.5)):
        ops[k].append(dict(c=c, w=0.9, v0=SILL, v1=SILL + 2.1, kind='door', reveal='STEEL_DARK'))
    ops['S'].append(dict(c=-9.2, w=4.0, v0=0.0, v1=4.5, kind='rollup', reveal='STEEL_DARK'))
    for k, cs in (('S', (-16.2, -12.0, -6.4, -1.4)), ('N', (-15.0, -11.0, -7.0, -3.0, 0.0)), ('E', (-0.8, 3.2, 7.2, 11.2)), ('W', (-1.2, 8.8, 12.2))):
        for c in cs: ops[k].append(dict(c=c, w=2.6, v0=6.4, v1=7.6, kind='window'))
    for k, cs in (('S', (-12.6, -5.9, -1.4)), ('E', (-0.8, 11.2))):
        for c in cs: ops[k].append(dict(c=c, w=1.6, v0=1.1, v1=2.3, kind='window'))
    walls, u_of, placed = rect_walls(B, HX0, HX1, HY0, HY1, EAVE, T, ops, 'CLADDING', bands=[(1.0, 'CONCRETE')])
    for k, W, o in placed:
        if o['kind'] == 'window': window_insert(B, W, o)
        elif o['kind'] == 'door':
            door_insert(B, W, o, canopy=0.8 if k == 'S' else 0.6, stoop=(0.6, 0.0, 0), rails=False)
            c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
            meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10, sill_z=SILL, facing=W.facing))
        else:   # closed maintenance roll-up door
            B.wbox('ROLLUP', W, o['u0'], o['u1'], 0.0, o['v1'], -0.18, -0.12)
            for sg, uu in ((-1, o['u0']), (1, o['u1'])):
                a0, a1 = sorted((uu, uu + sg * 0.3)); B.wbox('HAZARD', W, a0, a1, 0.0, 2.0, 0.0, 0.15, skip='-z'); B.wbox('PAINT_YELLOW', W, a0, a1, 2.0, o['v1'] + 0.3, 0.0, 0.15)
            B.wbox('PAINT_YELLOW', W, o['u0'] - 0.3, o['u1'] + 0.3, o['v1'], o['v1'] + 0.3, 0.0, 0.15)
            B.wbox('ROLLUP', W, o['u0'] - 0.1, o['u1'] + 0.1, o['v1'] + 0.3, o['v1'] + 0.95, 0.0, 0.55)
    for sx in (HX0, HX1):
        gable(B, sx, sx + (T if sx == HX0 else -T), HY0, HY1, EAVE, RT(yc) - 0.15, inner=None)
    for k, W in walls.items():
        ext = 0.0 if k in 'SN' else T + 0.03
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 8.4, 8.9, 0.0, 0.03)
    VG = 0.2
    ye_s, ye_n = gable_roof(B, HX0, HX1, HY0, HY1, RT, yc, 0.3, 0.25, VG, under='ROOF_STEEL', th=0.15)
    gutter(B, HX0 - VG, HX1 + VG, ye_s - 0.08, RT(ye_s) - 0.03, downs=(HX0 + 0.35, HX1 - 0.35), wall_y=HY0)
    gutter(B, HX0 - VG, HX1 + VG, ye_n + 0.07, RT(ye_n) - 0.03, downs=(HX0 + 0.35, HX1 - 0.35), wall_y=HY1)
    for (vx, vy) in ((-15.0, 1.5), (-1.5, 1.5), (-15.0, 10.0)):
        turbine_vent(B, vx, vy, RT(vy), RT(vy) + 0.6, r=0.22)
    # stacks through the roof (collars in bounds, stacks excluded)
    stacks = [(-12.0, 8.0, 1.0, 23.0), (-6.5, 8.0, 0.8, 21.0)]
    for (sx_, sy_, sr, top) in stacks:
        B.cyl('STEEL_DARK', (sx_, sy_, RT(sy_) - 0.3), (sx_, sy_, RT(sy_) + 0.4), sr + 0.25, 16)
    with B.grp('stacks', exclude=True):
        for (sx_, sy_, sr, top) in stacks: stack(B, sx_, sy_, RT(sy_) + 0.4, top, sr)
    for k, cs in (('S', (-16.9, -2.9, 0.9)), ('W', (-2.4, 7.6)), ('N', (-12.0, -4.0))):
        for c in cs: wall_lamp(B, walls[k], u_of(k, c), 3.2, 0.28)
    # ── harvester unloading bay: drive-through along Y, clear 7.0 m wide (x 4.0..11.0) x 6.0 m high, y -14..+1
    BX0, BX1, BY0, BY1, BH = 4.0, 11.0, -14.0, 1.0, 6.0
    frames = [-13.75, -8.9, -4.1, 0.75]
    for fy in frames:
        for (a0, a1) in ((BX0 - 0.4, BX0), (BX1, BX1 + 0.4)):
            B.box('STEEL_DARK', (a0, fy - 0.2, 0.0), (a1, fy + 0.2, BH + 0.7), skip='-z')
            B.box('HAZARD', (a0 - 0.01, fy - 0.21, 0.0), (a1 + 0.01, fy + 0.21, 1.8), skip='-z+z')
        B.box('STEEL_DARK', (BX0 - 0.4, fy - 0.2, BH), (BX1 + 0.4, fy + 0.2, BH + 0.7))
    for (a0, a1) in ((BX0 - 0.5, BX0 - 0.4), (BX1 + 0.4, BX1 + 0.5)):
        B.box('CLADDING_DK', (a0, BY0 + 0.05, 3.4), (a1, BY1 - 0.05, BH + 0.7))
    zr0, zr1 = BH + 1.0, BH + 1.0 + (BX1 - BX0 + 1.4) * math.tan(math.radians(4))
    B.corrugated('ROOF_STEEL', (BX1 + 0.7, BY0, zr0), (0, 1, 0), (-(BX1 - BX0 + 1.4), 0, zr1 - zr0), BY1 - BY0 + 0.2,
                 math.hypot(BX1 - BX0 + 1.4, zr1 - zr0), 0.333, 0.035, under='ROOF_STEEL', th=0.12)
    for k in range(5):   # purlins
        yy = BY0 + 0.2 + k * (BY1 - BY0 - 0.4) / 4
        B.box('STEEL_DARK', (BX0 - 0.4, yy - 0.08, BH + 0.7), (BX1 + 0.4, yy + 0.08, BH + 0.85))
    for fy in (-11.3, -6.5, -1.7):
        B.cyl('STEEL_DARK', (7.5, fy, BH + 0.7), (7.5, fy, BH + 0.4), 0.18, 8, r2=0.3, caps=(True, False))
        B.cyl('GLOW_LAMP', (7.5, fy, BH + 0.41), (7.5, fy, BH + 0.4), 0.28, 8)
    gx0, gx1, gy0, gy1 = 6.0, 9.0, -8.0, -2.4      # unloading grate (flush) with hazard border
    B.quad('HAZARD', (gx0 - 0.3, gy0 - 0.3, 0.002), (gx1 + 0.3, gy0 - 0.3, 0.002), (gx1 + 0.3, gy0, 0.002), (gx0 - 0.3, gy0, 0.002))
    B.quad('HAZARD', (gx0 - 0.3, gy1, 0.002), (gx1 + 0.3, gy1, 0.002), (gx1 + 0.3, gy1 + 0.3, 0.002), (gx0 - 0.3, gy1 + 0.3, 0.002))
    B.quad('HAZARD', (gx0 - 0.3, gy0, 0.002), (gx0, gy0, 0.002), (gx0, gy1, 0.002), (gx0 - 0.3, gy1, 0.002))
    B.quad('HAZARD', (gx1, gy0, 0.002), (gx1 + 0.3, gy0, 0.002), (gx1 + 0.3, gy1, 0.002), (gx1, gy1, 0.002))
    B.quad('STEEL_DARK', (gx0, gy0, 0.002), (gx1, gy0, 0.002), (gx1, gy1, 0.002), (gx0, gy1, 0.002))
    for k in range(1, 15):
        yy = gy0 + k * (gy1 - gy0) / 15; B.quad('STEEL_GALV', (gx0, yy - 0.02, 0.004), (gx1, yy - 0.02, 0.004), (gx1, yy + 0.02, 0.004), (gx0, yy + 0.02, 0.004))
    for xx in (BX0 + 0.25, BX1 - 0.4):
        B.quad('PAINT_YELLOW', (xx, BY0, 0.003), (xx + 0.15, BY0, 0.003), (xx + 0.15, BY1, 0.003), (xx, BY1, 0.003))
    for (bx, by) in ((BX0 - 0.9, BY0 + 0.2), (BX1 + 0.9, BY0 + 0.2)):
        bollard(B, bx, by)
    B.box('CONCRETE', (BX1 + 0.5, -6.6, 0.0), (BX1 + 1.6, -4.6, 0.3), skip='-z')          # pit drive / conveyor transfer house
    B.box('CLADDING_DK', (BX1 + 0.6, -6.5, 0.3), (BX1 + 1.55, -4.7, 2.6))
    # ── silos (x 15.2), bucket elevator, catwalk, conveyors
    SX, SR = 15.45, 2.5; sys_ = (-10.0, -4.4, 1.2)
    for i, sy in enumerate(sys_):
        silo(B, SX, sy, SR, 1.8, 4.4, 14.2, 14.9, band_z=12.2)
    cw0, cw1 = -12.3, 7.2; zc = 14.9
    B.box('STEEL_DARK', (SX - 0.6, cw0, zc - 0.12), (SX + 0.6, cw1, zc), skip='')
    for x_ in (SX - 0.6, SX + 0.6):
        railing(B, [(x_, cw0, zc), (x_, cw1, zc)], h=16.0 - zc - 0.025, post=2.4, toe=False)
    belt_conveyor(B, (SX + 0.05, cw1 - 0.6, zc + 0.05), (SX + 0.05, cw0 + 0.6, zc + 0.05), w=0.6, legs=False, hood=False)
    ex, ey = 13.6, 6.2
    B.box('STEEL_GALV', (ex - 0.6, ey - 0.6, 0.0), (ex + 0.6, ey + 0.6, 15.2))
    B.box('PAINT_YELLOW', (ex - 0.75, ey - 0.75, 15.2), (ex + 0.75, ey + 0.75, 16.0))
    for zz in (3.0, 6.0, 9.0, 12.0): B.box('STEEL_DARK', (ex - 0.64, ey - 0.64, zz), (ex + 0.64, ey + 0.64, zz + 0.12))
    B.beam('STEEL_GALV', (ex + 0.6, ey, 15.55), (SX, 6.6, zc + 0.3), 0.5, 0.5)
    ladder(B, (SX, sys_[0] - SR), zc, (1, 0, 0), (0, -1, 0), so=0.2, cage_from=2.5, top_ext=0.0, R=0.34)
    for sy in sys_:   # silo discharge -> collecting conveyor under the cones
        B.cyl('STEEL_DARK', (SX, sy, 1.8), (SX, sy, 1.2), 0.18, 8)
    belt_conveyor(B, (SX, -11.6, 0.8), (SX, 4.2, 0.8), w=0.8, legs=True, hood=True)
    # inclined enclosed gallery from the silo plant to the hall (passes over the drive corridor above 7 m)
    gallery(B, (12.4, 9.6, 7.2), (HX1, 9.6, 9.6))
    for gx in (12.0,):
        for gy in (9.0, 10.2):
            B.box('STEEL_DARK', (gx - 0.15, gy - 0.15, 0.0), (gx + 0.15, gy + 0.15, 7.1), skip='-z')
        B.box('STEEL_DARK', (gx - 0.2, 8.9, 6.9), (gx + 0.2, 10.3, 7.15))
    B.beam('STEEL_GALV', (12.4, 9.6, 7.85), (ex - 0.6, 7.0, 9.5), 0.6, 0.6)
    # ── south-west yard: reagent tank on saddles, pipe rack to the hall, pumps
    tx, ty = -12.5, -9.5
    for dx in (-2.0, 2.0):
        B.box('CONCRETE', (tx + dx - 0.3, ty - 1.2, 0.0), (tx + dx + 0.3, ty + 1.2, 0.9), skip='-z')
    B.cyl('PAINT_WHITE', (tx - 3.0, ty, 2.1), (tx + 3.0, ty, 2.1), 1.3, 18, caps=(False, False))
    for sg in (-1, 1): B.sphere('PAINT_WHITE', (tx + sg * 3.0, ty, 2.1), 1.3, 18, 4, phi_max=math.pi / 2, scale=(1, 1, 0.45), M=Matrix.Rotation(sg * math.pi / 2, 4, 'Y'), cap=False)
    B.cyl('TEAM_ACCENT', (tx - 0.6, ty, 2.1), (tx + 0.6, ty, 2.1), 1.32, 18, caps=(False, False))
    RZ = 4.85   # pipe rack (clear height 4.6 m, columns kept clear of the roll-up door)
    for xx in (-15.5, -12.2, -5.6, -1.0):
        B.box('STEEL_DARK', (xx - 0.12, -6.8, 0.0), (xx + 0.12, -6.56, RZ - 0.25), skip='-z'); B.box('STEEL_DARK', (xx - 0.12, -4.84, 0.0), (xx + 0.12, -4.6, RZ - 0.25), skip='-z')
        B.box('STEEL_DARK', (xx - 0.15, -6.9, RZ - 0.25), (xx + 0.15, -4.5, RZ))
    for k, (dy, col, r_) in enumerate(((-6.3, 'STEEL_GALV', 0.12), (-5.8, 'PAINT_YELLOW', 0.09), (-5.3, 'PAINT_GREEN', 0.14))):
        B.sweep(col, [(-15.8, dy, RZ + r_), (-0.8, dy, RZ + r_), (-0.8, HY0 + 0.05, RZ + r_)], r_, 8, bend=0.4)
    B.sweep('STEEL_GALV', [(tx + 1.0, ty + 1.25, 2.4), (tx + 1.0, -6.3, 2.4), (tx + 1.0, -6.3, RZ + 0.12)], 0.12, 8, bend=0.3)
    for (px, py) in ((-8.0, -8.5), (-6.5, -8.5)):
        B.box('CONCRETE', (px - 0.6, py - 0.4, 0.0), (px + 0.6, py + 0.4, 0.2), skip='-z')
        B.cyl('PAINT_GREEN', (px - 0.45, py, 0.55), (px + 0.2, py, 0.55), 0.28, 12); B.box('PAINT_GREEN', (px + 0.2, py - 0.2, 0.2), (px + 0.5, py + 0.2, 0.75))
        B.cyl('STEEL_GALV', (px - 0.1, py, 0.85), (px - 0.1, py, 3.9), 0.06, 6)
    meta['spec'] = [36.0, 28.0, 16.0]
    meta['cam'] = dict(azim=-58, elev=27, lens=36)
    meta['figures'] = [(9.2, -15.0, 0, 1.6), (12.6, -14.6, 0, 2.0), (-4.2, -5.6, 0, 1.7)]
    meta['proxies'] = [dict(c=(7.5, -5.2, 0.0), s=(4.0, 10.0, 4.0))]
    meta['closeup'] = dict(target=(7.5, -10.0, 3.0), azim=-80, elev=12, dist=24, lens=40)
    meta['json'] = {'harvester_bay': {'clear_x': [BX0, BX1], 'clear_y': [BY0, BY1], 'clear_h': BH, 'drive_axis': 'Y (both directions)',
                                      'unload_point': [7.5, -5.2, 0.0], 'north_corridor_clear': {'x': [BX0, BX1], 'y': [BY1, 14.0], 'clear_h': 6.8}},
                    'stacks_top_z': [23.0, 21.0]}
    meta['doors'] = [dict(kind='vehicle', center=[7.5, BY0, BH / 2], clear_w=BX1 - BX0, clear_h=BH, sill_z=0.0, facing='-Y', notes='harvester bay south mouth (drive-through)'),
                     dict(kind='vehicle', center=[7.5, BY1, BH / 2], clear_w=BX1 - BX0, clear_h=BH, sill_z=0.0, facing='+Y', notes='harvester bay north mouth; corridor stays clear to y=+14')] + meta['doors']
    meta['notes'] = ('Ore refinery: process hall 19.3 x 17.3 m (eave 10.5 m), three 5 m silos on legs with catwalk (rail tops 16.00 m), bucket elevator, '
                     'enclosed conveyor gallery over the drive corridor (underside >= 6.8 m), drive-through harvester bay 7.0 m clear wide x 6.0 m clear high '
                     'along Y with a flush unloading grate at (7.5, -5.2). Two stacks (to 23 m / 21 m) in *_stacks are excluded from bounds.')
    return meta

def fence_line(B, a, b, h=2.4, post=2.5, gaps=(), barbed=True, tile=0.3):
    """Chain-link fence from a to b (2D); outside is to the right of a->b. Barbed outriggers lean INWARD so the fence line is
    the compound boundary. gaps: [(s0, s1)] metres along the line left open."""
    a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0)); d = b - a; L = d.length; t = d / L; out = -Vector((t.y, -t.x, 0))
    spans, s = [], 0.0
    for g0, g1 in sorted(gaps):
        if g0 > s: spans.append((s, g0))
        s = g1
    if s < L: spans.append((s, L))
    for s0, s1 in spans:
        n = max(1, int(math.ceil((s1 - s0) / post)))
        for k in range(n + 1):
            q = a + t * (s0 + (s1 - s0) * k / n); end = k in (0, n)
            B.cyl('STEEL_GALV', q, q + Vector((0, 0, h + 0.05)), 0.045 if end else 0.032, 8, caps=(False, True))
            if barbed:
                B.beam('STEEL_GALV', q + Vector((0, 0, h)), q + out * 0.32 + Vector((0, 0, h + 0.4)), 0.03, 0.03)
        p0, p1 = a + t * s0, a + t * s1
        B.cyl('STEEL_GALV', p0 + Vector((0, 0, h)), p1 + Vector((0, 0, h)), 0.022, 6, caps=(False, False))
        B.cyl('STEEL_GALV', p0 + Vector((0, 0, 0.06)), p1 + Vector((0, 0, 0.06)), 0.008, 4, caps=(False, False))
        u0, u1 = s0 / tile, s1 / tile; v1 = (h - 0.03) / tile
        B.quad('FENCE', p0 + Vector((0, 0, 0.03)), p1 + Vector((0, 0, 0.03)), p1 + Vector((0, 0, h - 0.03)), p0 + Vector((0, 0, h - 0.03)),
               uvs=[(u0, 0.1), (u1, 0.1), (u1, v1), (u0, v1)])
        if barbed:
            for k in range(1, 4):
                o = out * (0.32 * k / 3) + Vector((0, 0, h + 0.4 * k / 3))
                B.cyl('STEEL_GALV', p0 + o, p1 + o, 0.005, 3, caps=(False, False))


def gate_leaf(B, p0, p1, h=2.3, z0=0.05, tile=0.3):
    """Closed chain-link gate leaf between hinge point p0 and free end p1 (in the 'doors' group)."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0)); d = (p1 - p0); L = d.length; t = d / L
    with B.grp('doors'):
        a, b = p0 + t * 0.08, p1 - t * 0.04
        B.sweep('STEEL_GALV', [a + Vector((0, 0, z0)), b + Vector((0, 0, z0)), b + Vector((0, 0, z0 + h)), a + Vector((0, 0, z0 + h))], 0.025, 6, closed=True)
        B.cyl('STEEL_GALV', a + Vector((0, 0, z0)), b + Vector((0, 0, z0 + h)), 0.018, 5)
        B.quad('FENCE', a + Vector((0, 0, z0)), b + Vector((0, 0, z0)), b + Vector((0, 0, z0 + h)), a + Vector((0, 0, z0 + h)),
               uvs=[(0, 0), (L / tile, 0), (L / tile, h / tile), (0, h / tile)])


def warning_sign(B, x, y, z, nrm, w=0.45, h=0.35):
    """Small enamel warning plate (white with a red top band) facing nrm (unit 2D)."""
    n = Vector((nrm[0], nrm[1], 0)); side = Vector((-n.y, n.x, 0)); c = Vector((x, y, z))
    lo = c - side * w / 2 + n * 0.0; hi = c + side * w / 2 + n * 0.012
    B.box('PAINT_WHITE', (min(lo.x, hi.x), min(lo.y, hi.y), z - h / 2), (max(lo.x, hi.x), max(lo.y, hi.y), z + h / 2))
    lo2 = c - side * (w / 2 - 0.02) + n * 0.012; hi2 = c + side * (w / 2 - 0.02) + n * 0.016
    B.box('PAINT_RED', (min(lo2.x, hi2.x), min(lo2.y, hi2.y), z + h / 2 - 0.1), (max(lo2.x, hi2.x), max(lo2.y, hi2.y), z + h / 2 - 0.02))


def insulator(B, p0, p1, r_shed=0.14, n=6, r_core=0.055, mat='CERAMIC'):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length; ax = d / L
    B.cyl(mat, p0, p1, r_core, 6, caps=(False, False))
    for i in range(n):
        q = p0 + d * ((i + 0.5) / n)
        B.cyl(mat, q - ax * 0.018, q + ax * 0.018, r_shed, 8, r2=r_shed * 0.75)
    B.cyl('STEEL_GALV', p1, p1 + ax * 0.06, r_core * 1.35, 6)
    B.cyl('STEEL_GALV', p0 - ax * 0.05, p0, r_core * 1.35, 6)


def transformer(B, cx, cy, rz=0.0):
    """Oil-filled power transformer: bund, plinth, tank, radiator fin banks, conservator, HV/LV bushings. Returns HV terminal points."""
    B.box('CONCRETE', (cx - 2.3, cy - 2.0, 0.0), (cx + 2.3, cy + 2.0, 0.22), skip='-z')
    B.box('GRAVEL', (cx - 2.1, cy - 1.8, 0.22), (cx + 2.1, cy + 1.8, 0.24), skip='-z')
    B.box('CONCRETE', (cx - 1.6, cy - 1.0, 0.22), (cx + 1.6, cy + 1.0, 0.45), skip='-z')
    B.box('PAINT_GREEN', (cx - 1.35, cy - 0.8, 0.45), (cx + 1.35, cy + 0.8, 2.75))
    B.box('PAINT_GREEN', (cx - 1.42, cy - 0.87, 2.75), (cx + 1.42, cy + 0.87, 2.85))
    for sy in (-1, 1):
        for k in range(10):
            fx = cx - 1.1 + k * 0.245
            B.box('PAINT_GREEN', (fx - 0.018, cy + sy * 0.8 + (0 if sy > 0 else -0.5), 0.75), (fx + 0.018, cy + sy * 0.8 + (0.5 if sy > 0 else 0), 2.45), skip='-z+z')
        for zz in (0.68, 2.45):
            B.box('PAINT_GREEN', (cx - 1.2, cy + sy * 0.8 + (0 if sy > 0 else -0.5), zz - 0.04), (cx + 1.2, cy + sy * 0.8 + (0.5 if sy > 0 else 0), zz + 0.04))
    B.box('STEEL_DARK', (cx + 0.8, cy - 0.15, 2.85), (cx + 0.95, cy + 0.15, 3.25)); B.box('STEEL_DARK', (cx - 0.95, cy - 0.15, 2.85), (cx - 0.8, cy + 0.15, 3.25))
    B.cyl('PAINT_GREEN', (cx - 1.1, cy + 0.0, 3.5), (cx + 1.1, cy + 0.0, 3.5), 0.28, 12)
    hv = []
    for k in (-1, 0, 1):
        x = cx + k * 0.75
        insulator(B, (x, cy - 0.45, 2.85), (x, cy - 0.45, 4.35), 0.15, 8); hv.append(Vector((x, cy - 0.45, 4.41)))
        insulator(B, (x, cy + 0.5, 2.85), (x, cy + 0.5, 3.4), 0.11, 3)
    B.box('STEEL_DARK', (cx - 1.35, cy + 0.3, 2.85), (cx - 0.95, cy + 0.7, 3.0))
    B.box('PAINT_WHITE', (cx - 0.3, cy - 0.81, 1.5), (cx + 0.3, cy - 0.8, 1.9))   # rating plate
    return hv


def light_pole(B, x, y, h, heads, z0=0.0, arm=0.7):
    """Galvanised pole with LED flood heads; heads = list of yaw angles (radians)."""
    B.box('CONCRETE', (x - 0.3, y - 0.3, z0), (x + 0.3, y + 0.3, z0 + 0.3), skip='-z')
    B.cyl('STEEL_GALV', (x, y, z0 + 0.3), (x, y, z0 + h), 0.09, 10, r2=0.06)
    for a in heads:
        d = Vector((math.cos(a), math.sin(a), 0)); p = Vector((x, y, z0 + h - 0.15))
        B.cyl('STEEL_GALV', p, p + d * arm, 0.035, 6)
        q = p + d * arm; side = Vector((-d.y, d.x, 0))
        lo = q - side * 0.25 - d * 0.05 + Vector((0, 0, -0.08)); hi = q + side * 0.25 + d * 0.3 + Vector((0, 0, 0.06))
        B.box('STEEL_DARK', tuple(map(min, lo, hi)), tuple(map(max, lo, hi)))
        g0 = q - side * 0.22 + Vector((0, 0, -0.085)); g1 = q + side * 0.22 + d * 0.27 + Vector((0, 0, -0.085))
        B.box('GLOW_LAMP', (min(g0.x, g1.x), min(g0.y, g1.y), g0.z - 0.004), (max(g0.x, g1.x), max(g0.y, g1.y), g0.z), skip='+z')


def hut(B, x0, x1, y0, y1, h, doors=(), windows=(), T=0.2, parapet=0.25, mat='CLADDING', band=True, sill=0.15, canopy=0.5, stoop=0.5, meta=None, zb=0.0):
    """Small flat-roofed building standing at z=zb, with doors [(side, c)] and windows [(side, c, w, v0, v1)] (v relative to zb).
    Appends door records to meta['doors']."""
    ops = {k: [] for k in 'SNEW'}
    for side, c in doors: ops[side].append(dict(c=c, w=0.9, v0=zb + sill, v1=zb + sill + 2.1, kind='door', reveal='STEEL_DARK'))
    for side, c, w, v0, v1 in windows: ops[side].append(dict(c=c, w=w, v0=zb + v0, v1=zb + v1, kind='window'))
    walls, u_of, placed = rect_walls(B, x0, x1, y0, y1, zb + h + parapet, T, ops, mat, bands=[(zb + 0.4, 'CONCRETE')], z0=zb)
    for k, W, o in placed:
        if o['kind'] == 'window': window_insert(B, W, o, depth=0.08)
        else:
            door_insert(B, W, o, canopy=canopy, stoop=(stoop, 0.0, 0) if stoop else None, rails=False, base=zb)
            if meta is not None:
                c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
                meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10, sill_z=round(zb + sill, 3), facing=W.facing))
    parapet_roof(B, x0, x1, y0, y1, T, zb + h, zb + h + parapet)
    if band:
        for k, W in walls.items():
            ext = 0.0 if k in 'SN' else T + 0.02
            B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, zb + h - 0.35, zb + h - 0.15, 0.0, 0.02)
    return walls, u_of


@asset('bld_power_substation')
def build_substation(B):
    meta = {'doors': []}
    FX, FY = 9.95, 7.95; GH = 2.4
    B.box('GRAVEL', (-FX + 0.05, -FY + 0.05, 0.0), (FX - 0.05, FY - 0.05, 0.05), skip='-z')
    gate = (-2.0, 2.0); pgate = (2.7, 3.7)
    fence_line(B, (-FX, -FY), (FX, -FY), GH, gaps=[(gate[0] + FX, gate[1] + FX), (pgate[0] + FX, pgate[1] + FX)])
    fence_line(B, (FX, -FY), (FX, FY), GH); fence_line(B, (FX, FY), (-FX, FY), GH); fence_line(B, (-FX, FY), (-FX, -FY), GH)
    gate_leaf(B, (gate[0], -FY), (0.0, -FY)); gate_leaf(B, (gate[1], -FY), (0.0, -FY)); gate_leaf(B, (pgate[0], -FY), (pgate[1], -FY))
    for (sx, sy, n) in ((-6.0, -FY, (0, -1)), (6.0, -FY, (0, -1)), (FX, 0.0, (1, 0)), (-FX, -3.0, (-1, 0)), (0.0, FY, (0, 1))):
        warning_sign(B, sx + n[0] * 0.03, sy + n[1] * 0.03, 1.5, n)
    meta['doors'].append(dict(kind='vehicle', center=[0.0, -FY, 1.2], clear_w=4.0, clear_h=6.0, sill_z=0.0, facing='-Y', notes='double chain-link gate (closed leaves in *_doors); open overhead'))
    meta['doors'].append(dict(kind='personnel', center=[3.2, -FY, 1.05], clear_w=0.90, clear_h=2.10, sill_z=0.0, facing='-Y', notes='personnel gate (leaf in *_doors); open overhead'))
    # control hut (NW)
    hut(B, -9.3, -5.1, 3.6, 7.4, 2.9, doors=[('S', -7.9)], windows=[('E', 5.5, 1.4, 1.1, 2.1), ('S', -6.2, 1.0, 1.1, 2.1)], meta=meta, canopy=0.6, stoop=0.6)
    hvac_unit(B, (-9.3 - 0.33, 5.5, 0.4), (1.0, 0.55, 0.75), fans=1, rz=math.pi / 2)
    for (bx, by) in ((-9.3 - 0.33, 4.85), (-9.3 - 0.33, 6.15)): B.box('STEEL_DARK', (bx - 0.25, by - 0.03, 0.0), (bx + 0.25, by + 0.03, 0.4))
    # transformers
    T1 = transformer(B, -1.2, -2.6); T2 = transformer(B, 5.4, -2.6)
    # busbar gantry: two lattice columns + truss beam, top exactly 6.00 m
    GY = 3.4; GX0, GX1 = -3.4, 8.4
    for gx in (GX0, GX1):
        lattice(B, 'STEEL_GALV', gx, GY, 0.9, 0.55, 0.0, 5.55, levels=5, legs=4, leg_r=0.05, br=0.02)
        B.box('CONCRETE', (gx - 0.7, GY - 0.7, 0.0), (gx + 0.7, GY + 0.7, 0.3), skip='-z')
    for dy in (-0.25, 0.25):
        for zz in (5.55, 5.95):
            B.beam('STEEL_GALV', (GX0 - 0.3, GY + dy, zz), (GX1 + 0.3, GY + dy, zz), 0.07, 0.07 if zz < 5.9 else 0.1)
    n = 12
    for k in range(n):
        x0 = GX0 - 0.3 + (GX1 - GX0 + 0.6) * k / n; x1 = GX0 - 0.3 + (GX1 - GX0 + 0.6) * (k + 1) / n
        for dy in (-0.25, 0.25):
            B.beam('STEEL_GALV', (x0, GY + dy, 5.55 if k % 2 == 0 else 5.95), (x1, GY + dy, 5.95 if k % 2 == 0 else 5.55), 0.03, 0.03)
        B.beam('STEEL_GALV', (x0, GY - 0.25, 5.95), (x0, GY + 0.25, 5.95), 0.025, 0.025)
    # suspended insulator strings + busbars (3 phases along X)
    phases = (GY - 0.7, GY, GY + 0.7); zb = 4.75
    for py in phases:
        for sx_ in (GX0 + 1.2, (GX0 + GX1) / 2, GX1 - 1.2):
            B.beam('STEEL_GALV', (sx_, GY - 0.25, 5.52), (sx_, py, 5.52), 0.04) if abs(py - GY) > 0.01 else None
            insulator(B, (sx_, py, 5.5), (sx_, py, zb + 0.08), 0.13, 5)
        B.cyl('ALU', (GX0 + 0.9, py, zb), (GX1 - 0.9, py, zb), 0.05, 8)
    # post insulators on pedestals (disconnectors) between the busbars and each transformer, droppers
    for hv, tx in ((T1, -1.2), (T2, 5.4)):
        for k, term in enumerate(hv):
            px, py = term.x, 1.3
            B.box('STEEL_GALV', (px - 0.1, py - 0.1, 0.0), (px + 0.1, py + 0.1, 2.5), skip='-z')
            B.box('CONCRETE', (px - 0.3, py - 0.3, 0.0), (px + 0.3, py + 0.3, 0.2), skip='-z')
            insulator(B, (px, py, 2.55), (px, py, 3.75), 0.13, 6)
            B.cyl('ALU', (px, py, 3.85), (px, phases[k], zb), 0.012, 4)
            B.cyl('ALU', (px, py, 3.85), term, 0.012, 4)
            B.beam('STEEL_GALV', (px, py - 0.25, 3.85), (px, py + 0.3, 3.95), 0.04, 0.02)
    # cable trench covers, light pole, extinguisher box
    B.box('CONCRETE', (-5.1, 0.1, 0.0), (7.8, 0.6, 0.08), skip='-z')
    B.box('CONCRETE', (-5.6, 0.1, 0.0), (-5.1, 3.6, 0.08), skip='-z')
    light_pole(B, 8.9, 6.9, 5.95, [math.radians(225)], arm=0.45)
    B.box('PAINT_RED', (-4.6, 7.55, 0.6), (-4.0, 7.8, 1.5))
    meta['spec'] = [20.0, 16.0, 6.0]
    meta['cam'] = dict(azim=-60, elev=30, lens=40)
    meta['figures'] = [(1.0, -9.0, 0, 1.6), (-7.9, 2.4, 0, 1.4)]
    meta['closeup'] = dict(target=(2.0, -2.0, 2.4), azim=-75, elev=14, dist=15, lens=40)
    meta['json'] = {'busbar_gantry_top_z': 6.0, 'fence_h': GH}
    meta['notes'] = ('Fenced 20 x 16 m transformer yard: 2.4 m chain-link fence with barbed outriggers, double vehicle gate (4.0 m) + personnel gate '
                     'on the south side (leaves in *_doors), two finned oil transformers with HV/LV bushings, post insulators, suspended '
                     'insulator strings, 3-phase busbars under a lattice gantry whose top chord is at 6.00 m, control hut with door.')
    return meta

def loft_rect(B, mat, c0, h0, z0, c1, h1, z1, caps=(False, True)):
    """Frustum between two axis-aligned rectangles (centre, half-extents (hx, hy)) at z0 and z1."""
    p = B.part(mat); bm = p.bm
    def ring(c, h, z): return [bm.verts.new((c[0] + sx * h[0], c[1] + sy * h[1], z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    A, Bv = ring(c0, h0, z0), ring(c1, h1, z1)
    for i in range(4):
        j = (i + 1) % 4; B._face(p, [A[i], A[j], Bv[j], Bv[i]], mat)
    if caps[0]: B._face(p, A[::-1], mat)
    if caps[1]: B._face(p, Bv, mat)


def stairs(B, x0, x1, y0, y1, z0, z1, n, mat='STEEL_DARK', rail='PAINT_YELLOW'):
    """Straight stair rising along +X from (x0, z0) to (x1, z1) between y0..y1 (x1 < x0 allowed: rises toward x1)."""
    sg = 1 if x1 > x0 else -1; run = abs(x1 - x0) / n; rise = (z1 - z0) / n
    for k in range(n):
        xa = x0 + sg * k * run; zt = z0 + (k + 1) * rise
        B.box(mat, (min(xa, xa + sg * run), y0 + 0.06, zt - 0.04), (max(xa, xa + sg * run), y1 - 0.06, zt))
    for yy in (y0, y1):
        B.beam(mat, (x0, yy, z0), (x1, yy, z1), 0.06, 0.25)
        B.sweep(rail, [(x0, yy, z0 + 1.0), (x1, yy, z1 + 1.0)], 0.022, 6)
        for t in (0.0, 0.5, 1.0):
            q = Vector((x0 + (x1 - x0) * t, yy, z0 + (z1 - z0) * t)); B.cyl(rail, q, q + Vector((0, 0, 1.0)), 0.024, 6)


@asset('bld_radar_control')
def build_radar_control(B):
    meta = {'doors': []}
    X0, X1, Y0, Y1 = -7.6, 7.6, -5.4, 5.4; T = 0.25; ZD, ZP = 5.4, 5.94
    ops = {k: [] for k in 'SNEW'}
    ops['S'].append(dict(c=-3.0, w=0.9, v0=0.3, v1=2.4, kind='door', reveal='STEEL_DARK'))
    ops['E'].append(dict(c=2.0, w=0.9, v0=0.15, v1=2.25, kind='door', reveal='STEEL_DARK'))
    for c in (-6.0, -0.6, 1.8, 4.2, 6.4): ops['S'].append(dict(c=c, w=1.6, v0=1.0, v1=2.3, kind='window'))
    for c in (-6.0, -3.0, -0.6, 1.8, 4.2, 6.4): ops['S'].append(dict(c=c, w=1.6, v0=3.4, v1=4.6, kind='window'))
    for k in 'EW':
        for c in (-3.0, 0.0, 3.0):
            for v in ((1.0, 2.3), (3.4, 4.6)):
                if not (k == 'E' and c == 3.0 and v[0] < 2) and not (k == 'E' and c == 0.0): ops[k].append(dict(c=c, w=1.4, v0=v[0], v1=v[1], kind='window'))
    for c in (-5.0, -1.0, 3.0): ops['N'].append(dict(c=c, w=1.6, v0=3.4, v1=4.6, kind='window'))
    walls, u_of, placed = rect_walls(B, X0, X1, Y0, Y1, ZP, T, ops, 'CLADDING', bands=[(0.8, 'CONCRETE')])
    for k, W, o in placed:
        if o['kind'] == 'window': window_insert(B, W, o)
        else:
            sill = o['v0']
            door_insert(B, W, o, canopy=0.6 if k == 'S' else 0.38, stoop=(0.3, 0.3, 1) if k == 'S' else (0.38, 0.0, 0), rails=(k == 'S'))
            c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
            meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10, sill_z=sill, facing=W.facing))
    for k, W in walls.items():
        ext = 0.0 if k in 'SN' else T + 0.03
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 4.95, 5.2, 0.0, 0.025)
    parapet_roof(B, X0, X1, Y0, Y1, T, ZD, ZP)
    WN, WE, WW_ = walls['N'], walls['E'], walls['W']
    for (xx, yy) in ((-4.5, 2.5), (-4.5, -1.5)):
        hvac_unit(B, (xx, yy, ZD), (1.6, 0.9, 0.48), fans=2)
    B.box('HVAC', (-1.6, 3.0, ZD), (-0.6, 4.0, ZD + 0.42)); B.box('STEEL_GALV', (-1.65, 2.95, ZD + 0.42), (-0.55, 4.05, ZD + 0.47))
    for k in range(5):   # cable ladder from the mast footing to the roof entry box
        B.box('STEEL_GALV', (3.0 - 0.15, 0.0 - k * 0.6 - 0.02, ZD + 0.12), (3.0 + 0.15, 0.0 - k * 0.6 + 0.02, ZD + 0.16))
    for sx in (-1, 1): B.box('STEEL_GALV', (3.0 + sx * 0.15 - 0.02, -2.6, ZD + 0.12), (3.0 + sx * 0.15 + 0.02, 0.0, ZD + 0.2))
    B.box('PAINT_WHITE', (2.6, -3.2, ZD), (3.4, -2.6, ZD + 0.5))
    ladder(B, (5.6, Y1), ZP, (1, 0, 0), (0, 1, 0), so=0.2, cage_from=2.4, top_ext=0.0, R=0.29)
    service_box(B, WW_, u_of('W', -2.0), 0.4, 0.8, 1.3, 0.3, 'PAINT_GREEN', conduit_to=ZP - 0.3)
    for k, cs in (('S', (-4.5, 3.0)), ('N', (-3.0, 3.0)), ('W', (1.5,)), ('E', (-1.5,))):
        for c in cs: wall_lamp(B, walls[k], u_of(k, c), 3.0, 0.28)
    # mast (excluded): lattice from the roof footing to 16.0, platform, rotating radar array, lightning rod tip at exactly 18.00
    MX, MY = 3.0, 1.0
    B.box('STEEL_DARK', (MX - 1.1, MY - 1.1, ZD), (MX + 1.1, MY + 1.1, ZD + 0.3))
    with B.grp('mast', exclude=True):
        lattice(B, 'STEEL_GALV', MX, MY, 1.5, 0.7, ZD + 0.3, 16.0, levels=9, legs=4, leg_r=0.06, br=0.022)
        B.box('STEEL_DARK', (MX - 0.9, MY - 0.9, 16.0), (MX + 0.9, MY + 0.9, 16.1))
        railing(B, [(MX - 0.85, MY - 0.85, 16.1), (MX + 0.85, MY - 0.85, 16.1), (MX + 0.85, MY + 0.85, 16.1), (MX - 0.85, MY + 0.85, 16.1)], h=0.95, post=0.85, closed=True, toe=False)
        B.cyl('STEEL_DARK', (MX, MY, 16.1), (MX, MY, 16.65), 0.22, 12)
        Mr = Matrix.Translation((MX, MY, 16.7)) @ Matrix.Rotation(math.radians(25), 4, 'Z')
        B.box('PAINT_WHITE', (-2.2, -0.12, 0.0), (2.2, 0.12, 0.5), Mr)
        B.box('STEEL_DARK', (-2.1, -0.14, 0.06), (2.1, -0.12, 0.44), Mr)
        B.box('STEEL_DARK', (-0.3, -0.1, -0.05), (0.3, 0.4, 0.1), Mr)
        B.cyl('STEEL_GALV', (MX + 0.8, MY + 0.8, 16.1), (MX + 0.8, MY + 0.8, 18.0), 0.025, 6, r2=0.008)
        B.cyl('STEEL_DARK', (MX - 0.8, MY + 0.8, 16.1), (MX - 0.8, MY + 0.8, 17.3), 0.03, 6); B.sphere('GLOW_RED', (MX - 0.8, MY + 0.8, 17.38), 0.08, 8, 4)
        whip(B, MX - 0.8, MY - 0.8, 16.1, 1.6); whip(B, MX + 0.8, MY - 0.8, 16.1, 1.2)
        for zz in (8.0, 12.0):
            B.cyl('PAINT_WHITE', (MX + 0.55, MY, zz), (MX + 0.95, MY, zz), 0.3, 12)   # microwave drum dish
    meta['spec'] = [16.0, 12.0, 6.0]
    meta['cam'] = dict(azim=-58, elev=22, lens=38)
    meta['figures'] = [(-1.8, -6.6, 0, 1.6), (-4.0, -7.2, 0, 1.4)]
    meta['closeup'] = dict(target=(-2.0, -5.5, 2.0), azim=-72, elev=10, dist=11, lens=40)
    meta['json'] = {'antenna_top_m': 18.0, 'mast_base': [MX, MY, ZD + 0.3], 'roof_deck_z': ZD}
    meta['notes'] = ('Radar control building 15.2 x 10.8 m, two storeys, flat roof (coping top 6.00 m). Lattice antenna mast on the roof '
                     '(object *_mast, exclude_bounds) with a rotating radar array at 16.7 m and a lightning-rod tip at exactly 18.00 m.')
    return meta


@asset('bld_extraction_rig')
def build_extraction_rig(B):
    meta = {'doors': []}
    PX, PY, PZ = 8.0, 6.0, 0.25
    B.box('CONCRETE', (-PX, -PY, 0.0), (PX, PY, PZ), skip='-z')
    for (x0, y0, x1, y1) in ((-PX, -PY, PX, -PY + 0.25), (-PX, PY - 0.25, PX, PY), (-PX, -PY + 0.25, -PX + 0.25, PY - 0.25), (PX - 0.25, -PY + 0.25, PX, PY - 0.25)):
        B.box('HAZARD', (x0, y0, PZ), (x1, y1, PZ + 0.006), skip='-z')
    # drill floor platform
    DX0, DX1, DY0, DY1, DZ = -7.4, -0.6, -4.0, 4.0, 2.6
    for lx in (DX0 + 0.2, -4.0, DX1 - 0.2):
        for ly in (DY0 + 0.2, DY1 - 0.2):
            B.box('STEEL_DARK', (lx - 0.15, ly - 0.15, PZ), (lx + 0.15, ly + 0.15, DZ - 0.3), skip='-z')
            B.box('HAZARD', (lx - 0.16, ly - 0.16, PZ), (lx + 0.16, ly + 0.16, PZ + 1.2), skip='-z+z')
    B.box('STEEL_DARK', (DX0, DY0, DZ - 0.3), (DX1, DY1, DZ))
    B.quad('STEEL_GALV', (DX0, DY0, DZ + 0.005), (DX1, DY0, DZ + 0.005), (DX1, DY1, DZ + 0.005), (DX0, DY1, DZ + 0.005))
    railing(B, [(DX1, 0.3, DZ), (DX1, DY0, DZ), (DX0, DY0, DZ), (DX0, DY1, DZ), (DX1, DY1, DZ), (DX1, 1.5, DZ)], h=1.1, mat='PAINT_YELLOW', post=1.4)
    stairs(B, DX1 + 3.0, DX1, 0.35, 1.45, PZ, DZ, 12)
    # derrick
    DCX = -4.0
    lattice(B, 'PAINT_YELLOW', DCX, 0.0, 3.2, 1.2, DZ, 11.7, levels=7, legs=4, leg_r=0.09, br=0.035)
    B.box('PAINT_YELLOW', (DCX - 0.75, -0.75, 11.7), (DCX + 0.75, 0.75, 12.0))
    B.box('TEAM_ACCENT', (DCX - 0.76, -0.76, 11.76), (DCX + 0.76, 0.76, 11.9))
    B.cyl('STEEL_DARK', (DCX, -0.6, 11.55), (DCX, 0.6, 11.55), 0.3, 12)
    B.box('STEEL_DARK', (DCX - 1.1, -0.5, 8.5), (DCX + 0.2, 0.5, 8.62))     # racking board
    railing(B, [(DCX - 1.1, -0.5, 8.62), (DCX - 1.1, 0.5, 8.62)], h=0.9, mat='PAINT_YELLOW', post=1.0, toe=False)
    B.box('PAINT_YELLOW', (DCX - 0.3, -0.22, 7.4), (DCX + 0.3, 0.22, 8.3))
    B.box('HAZARD', (DCX - 0.31, -0.23, 7.4), (DCX + 0.31, 0.23, 7.65))
    for dx in (-0.2, 0.2):
        for dy in (-0.12, 0.12): B.cyl('STEEL_DARK', (DCX + dx, dy, 8.3), (DCX + dx * 0.5, dy, 11.3), 0.012, 4, caps=(False, False))
    B.cyl('STEEL_GALV', (DCX, 0.0, PZ), (DCX, 0.0, 7.4), 0.1, 10)
    B.cyl('STEEL_DARK', (DCX, 0.0, DZ), (DCX, 0.0, DZ + 0.3), 0.65, 16)
    B.box('PAINT_YELLOW', (-6.8, -3.4, DZ), (-5.4, -1.8, DZ + 1.1)); B.cyl('STEEL_DARK', (-6.1, -3.5, DZ + 0.75), (-6.1, -1.7, DZ + 0.75), 0.38, 14)
    B.box('CLADDING_DK', (-7.3, 1.6, DZ), (-5.4, 3.8, DZ + 2.3))                                     # doghouse
    B.quad('GLASS', (-5.39, 2.0, DZ + 1.1), (-5.39, 3.4, DZ + 1.1), (-5.39, 3.4, DZ + 1.9), (-5.39, 2.0, DZ + 1.9))
    B.box('STEEL_DARK', (-7.35, 1.55, DZ + 2.3), (-5.35, 3.85, DZ + 2.38))
    for (fx, fy, a) in ((DCX + 0.6, -0.6, -45), (DCX + 0.6, 0.6, 45)):
        p = Vector((fx, fy, 9.2)); d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), -0.6)).normalized()
        B.box('STEEL_DARK', (fx - 0.15, fy - 0.15, 9.1), (fx + 0.15, fy + 0.15, 9.35)); B.box('GLOW_LAMP', (fx - 0.12, fy - 0.12, 9.095), (fx + 0.12, fy + 0.12, 9.1), skip='+z')
    # engine house (container-like)
    EX0, EX1, EY0, EY1, EH = 1.6, 7.6, 1.8, 5.6, 3.5
    ops = {'S': [dict(c=3.0, w=0.9, v0=0.45, v1=2.55, kind='door', reveal='STEEL_DARK')], 'N': [], 'E': [], 'W': [dict(c=3.7, w=1.2, v0=1.4, v1=2.4, kind='window')]}
    ew, eu, epl = rect_walls(B, EX0, EX1, EY0, EY1, EH, 0.15, ops, 'CLADDING_DK', z0=PZ)
    for k, W, o in epl:
        if o['kind'] == 'window': window_insert(B, W, o, depth=0.06, sill=None)
        else:
            door_insert(B, W, o, canopy=0.6, stoop=(0.6, 0.0, 0), rails=False)
            c = W.P((o['u0'] + o['u1']) / 2, (o['v0'] + o['v1']) / 2, 0)
            meta['doors'].append(dict(kind='personnel', center=[round(c.x, 3), round(c.y, 3), round(c.z, 3)], clear_w=0.90, clear_h=2.10, sill_z=0.45, facing=W.facing))
    parapet_roof(B, EX0, EX1, EY0, EY1, 0.15, EH - 0.12, EH, deck='ROOF_STEEL', inner='CLADDING_DK')
    WEe = ew['E']; B.wbox('STEEL_DARK', WEe, 0.4, WEe.L - 0.4, 0.8, 2.9, 0.0, 0.06)
    for k in range(10): B.wbox('STEEL_GALV', WEe, 0.45, WEe.L - 0.45, 0.9 + k * 0.2, 0.95 + k * 0.2, 0.06, 0.09)
    for k, W in ew.items():
        ext = 0.0 if k in 'SN' else 0.17
        B.wbox('TEAM_ACCENT', W, -ext, W.L + ext, 2.9, 3.1, 0.0, 0.02)
    B.cyl('STEEL_DARK', (6.6, 4.6, EH), (6.6, 4.6, 6.2), 0.14, 10)
    B.cyl('STEEL_GALV', (6.0, 4.6, EH + 0.55), (7.2, 4.6, EH + 0.55), 0.3, 12)
    B.cyl('STEEL_DARK', (6.6, 4.6, 6.2), (6.6, 4.6, 6.26), 0.24, 10)
    B.cyl('GLOW_AMBER', (3.0, 5.0, EH), (3.0, 5.0, EH + 0.25), 0.1, 10)
    for (bx, by) in ((EX0 - 0.35, EY0 - 0.35), (EX1 + 0.1, EY0 - 0.35)): bollard(B, bx, by)
    # hopper on legs with discharge chute to the south edge (tip 4.50 m above ground for a 4 m harvester)
    HX0, HX1, HY0, HY1, HZ0, HZ1 = 2.4, 6.6, -5.3, -1.8, 5.8, 6.6
    for (lx, ly) in ((HX0 + 0.15, HY0 + 0.15), (HX1 - 0.15, HY0 + 0.15), (HX0 + 0.15, HY1 - 0.15), (HX1 - 0.15, HY1 - 0.15)):
        B.box('STEEL_DARK', (lx - 0.14, ly - 0.14, PZ), (lx + 0.14, ly + 0.14, HZ0), skip='-z')
        B.box('HAZARD', (lx - 0.15, ly - 0.15, PZ), (lx + 0.15, ly + 0.15, PZ + 1.5), skip='-z+z')
    for zz in (2.4, 4.4):
        B.box('STEEL_DARK', (HX0, HY0 + 0.05, zz), (HX1, HY0 + 0.25, zz + 0.15)); B.box('STEEL_DARK', (HX0, HY1 - 0.25, zz), (HX1, HY1 - 0.05, zz + 0.15))
    hc = ((HX0 + HX1) / 2, (HY0 + HY1) / 2)
    B.box('STEEL_GALV', (HX0, HY0, HZ0), (HX1, HY1, HZ1))
    B.box('PAINT_YELLOW', (HX0 - 0.03, HY0 - 0.03, HZ1 - 0.15), (HX1 + 0.03, HY1 + 0.03, HZ1))
    loft_rect(B, 'STEEL_GALV', hc, (0.45, 0.45), 4.95, hc, ((HX1 - HX0) / 2, (HY1 - HY0) / 2), HZ0, caps=(True, False))
    B.quad('STEEL_DARK', (HX0 + 0.1, HY0 + 0.1, HZ1 + 0.005), (HX1 - 0.1, HY0 + 0.1, HZ1 + 0.005), (HX1 - 0.1, HY1 - 0.1, HZ1 + 0.005), (HX0 + 0.1, HY1 - 0.1, HZ1 + 0.005))
    B.beam('STEEL_GALV', (hc[0], hc[1], 4.85), (hc[0], -PY + 0.02, 4.55), 0.85, 0.12)
    for sx in (-1, 1): B.beam('STEEL_GALV', (hc[0] + sx * 0.42, hc[1], 4.95), (hc[0] + sx * 0.42, -PY + 0.02, 4.65), 0.05, 0.3)
    railing(B, [(HX0, HY1, HZ1), (HX1, HY1, HZ1)], h=1.0, mat='PAINT_YELLOW', post=1.4)
    ladder(B, (HX1, HY1 - 0.6), HZ1, (0, 1, 0), (1, 0, 0), so=0.16, top_ext=1.0, back=0.6, land_z=HZ1 + 0.01)
    # screen + inclined belt conveyor up to the hopper
    B.box('STEEL_DARK', (-7.6, -5.6, PZ), (-6.4, -4.3, 0.9)); B.box('PAINT_YELLOW', (-7.7, -5.6, 0.9), (-6.3, -4.3, 1.5))
    for k in range(4): B.box('STEEL_GALV', (-7.6 + k * 0.32, -5.55, 1.5), (-7.5 + k * 0.32, -4.35, 1.56))
    belt_conveyor(B, (-6.6, -4.95, 1.45), (2.9, -4.95, 6.85), w=0.8, legs=True, hood=True)
    for (cx_, cy_, r_, h_) in ((-1.0, 4.5, 1.2, 1.0), (0.4, -5.0, 0.8, 0.6)):
        B.cyl('ORE', (cx_, cy_, PZ), (cx_, cy_, PZ + h_), r_, 14, r2=0.1, caps=(False, True))
    meta['spec'] = [16.0, 12.0, 12.0]
    meta['cam'] = dict(azim=-22, elev=33, lens=38)
    meta['figures'] = [(0.6, -6.8, 0, 1.6), (-2.4, -2.6, DZ, 1.2)]
    meta['proxies'] = [dict(c=(4.5, -8.3, 0.0), s=(10.0, 4.0, 4.0))]
    meta['closeup'] = dict(target=(1.0, -3.0, 3.5), azim=-65, elev=14, dist=17, lens=40)
    meta['json'] = {'service_point': {'harvester_center': [4.5, -8.3, 0.0], 'heading': '+X or -X', 'chute_tip': [4.5, -5.98, 4.5], 'chute_clear_h': 4.5},
                    'drill_floor_z': DZ, 'pad_top_z': PZ}
    meta['notes'] = ('Resource extraction rig on a 16 x 12 m concrete pad (0.25 m, hazard edges): drill floor at 2.6 m with yellow railings and stair, '
                     'yellow lattice derrick (crown top 12.00 m) with travelling block and drill string, engine house with radiator, exhaust and '
                     'door, ore hopper on hazard-striped legs, inclined belt conveyor from the screen, ore piles. The hopper chute discharges at the '
                     'south edge 4.5 m up: a harvester parks along X just south of the pad (service_point).')
    return meta


@asset('bld_capture_radar')
def build_capture_radar(B):
    meta = {'doors': []}
    F = 11.95
    B.box('GRAVEL', (-F + 0.05, -F + 0.05, 0.0), (F - 0.05, F - 0.05, 0.05), skip='-z')
    gate = (-2.0, 2.0); pgate = (2.7, 3.7)
    fence_line(B, (-F, -F), (F, -F), 2.4, gaps=[(gate[0] + F, gate[1] + F), (pgate[0] + F, pgate[1] + F)])
    fence_line(B, (F, -F), (F, F), 2.4); fence_line(B, (F, F), (-F, F), 2.4); fence_line(B, (-F, F), (-F, -F), 2.4)
    gate_leaf(B, (gate[0], -F), (0.0, -F)); gate_leaf(B, (gate[1], -F), (0.0, -F)); gate_leaf(B, (pgate[0], -F), (pgate[1], -F))
    for (sx, sy, n) in ((-6.0, -F, (0, -1)), (6.0, -F, (0, -1)), (F, 0.0, (1, 0)), (-F, 0.0, (-1, 0)), (0.0, F, (0, 1))):
        warning_sign(B, sx + n[0] * 0.03, sy + n[1] * 0.03, 1.5, n)
    meta['doors'].append(dict(kind='vehicle', center=[0.0, -F, 1.2], clear_w=4.0, clear_h=6.0, sill_z=0.0, facing='-Y', notes='double chain-link gate (closed leaves in *_doors); open overhead'))
    meta['doors'].append(dict(kind='personnel', center=[3.2, -F, 1.05], clear_w=0.90, clear_h=2.10, sill_z=0.0, facing='-Y', notes='personnel gate; open overhead'))
    B.box('CONCRETE', (-2.0, -F + 0.05, 0.0), (2.0, -1.0, 0.07), skip='-z')
    B.box('CONCRETE', (-5.6, 6.6, 0.0), (-2.0, 8.4, 0.07), skip='-z')
    # lattice tower + deck + radome (top exactly 14.00)
    TX, TY = 0.0, 1.5; TZ = 6.2
    for sx in (-1, 1):
        for sy in (-1, 1): B.box('CONCRETE', (TX + sx * 2.3 - 0.5, TY + sy * 2.3 - 0.5, 0.0), (TX + sx * 2.3 + 0.5, TY + sy * 2.3 + 0.5, 0.35), skip='-z')
    lattice(B, 'STEEL_GALV', TX, TY, 4.6, 3.6, 0.35, TZ, levels=4, legs=4, leg_r=0.11, br=0.045)
    B.box('STEEL_DARK', (TX - 2.4, TY - 2.4, TZ), (TX + 2.4, TY + 2.4, TZ + 0.15))
    railing(B, [(TX - 2.3, TY - 2.3, TZ + 0.15), (TX + 2.3, TY - 2.3, TZ + 0.15), (TX + 2.3, TY + 2.3, TZ + 0.15), (TX - 2.3, TY + 2.3, TZ + 0.15)], h=1.05, post=1.2, closed=True)
    R = 3.7; zc = 14.0 - R; ph = math.radians(130)
    B.cyl('STEEL_GALV', (TX, TY, TZ + 0.15), (TX, TY, zc + R * math.cos(ph) + 0.05), R * math.sin(ph) + 0.06, 24)
    B.cyl('TEAM_ACCENT', (TX, TY, zc + R * math.cos(ph) - 0.4), (TX, TY, zc + R * math.cos(ph) - 0.15), R * math.sin(ph) + 0.075, 24, caps=(False, False))
    B.sphere('RADOME', (TX, TY, zc), R, 26, 14, phi_max=ph, smooth=False)
    ladder(B, (TX + 0.6, TY - 2.3 - 0.02), TZ + 0.15, (1, 0, 0), (0, -1, 0), so=0.2, cage_from=2.4, top_ext=1.0, back=0.5, land_z=TZ + 0.16, R=0.33)
    # equipment hut + cable tray, generator set, floodlight poles
    hut(B, -10.6, -5.6, 5.4, 9.6, 3.0, doors=[('E', 7.5)], windows=[('S', -8.1, 1.4, 1.1, 2.2)], meta=meta, canopy=0.5, stoop=0.5)
    for xx in (-9.6, -7.6):
        hvac_unit(B, (xx, 9.6 + 0.32, 0.4), (1.0, 0.55, 0.75), fans=1)
        B.box('STEEL_DARK', (xx - 0.45, 9.6, 0.0), (xx - 0.4, 9.95, 0.4)); B.box('STEEL_DARK', (xx + 0.4, 9.6, 0.0), (xx + 0.45, 9.95, 0.4))
    for k, (px, py) in enumerate(((-5.2, 5.0), (-3.4, 3.6))):
        B.box('STEEL_DARK', (px - 0.06, py - 0.06, 0.0), (px + 0.06, py + 0.06, 2.6), skip='-z')
    B.beam('STEEL_GALV', (-5.6, 5.6, 2.65), (-2.1, 2.9, 2.65), 0.35, 0.08)
    GX0, GX1, GY0, GY1 = 5.4, 9.6, 6.6, 8.8
    B.box('CONCRETE', (GX0 - 0.2, GY0 - 0.2, 0.0), (GX1 + 0.2, GY1 + 0.2, 0.15), skip='-z')
    B.box('CLADDING_DK', (GX0, GY0, 0.15), (GX1, GY1, 2.4))
    B.box('STEEL_DARK', (GX1 - 0.01, GY0 + 0.3, 0.5), (GX1 + 0.03, GY1 - 0.3, 2.0))
    for k in range(6): B.box('STEEL_GALV', (GX1 + 0.03, GY0 + 0.35, 0.6 + k * 0.24), (GX1 + 0.06, GY1 - 0.35, 0.66 + k * 0.24))
    B.box('TEAM_ACCENT', (GX0 - 0.01, GY0 - 0.01, 2.0), (GX1 + 0.01, GY1 + 0.01, 2.15))
    B.cyl('STEEL_DARK', (6.0, 8.2, 2.4), (6.0, 8.2, 3.6), 0.09, 8); B.cyl('STEEL_DARK', (6.0, 8.2, 3.6), (6.0, 8.2, 3.66), 0.16, 8)
    B.cyl('PAINT_WHITE', (GX0 + 0.3, 6.0, 0.7), (GX1 - 0.3, 6.0, 0.7), 0.4, 14)
    for xx in (GX0 + 0.8, GX1 - 0.8): B.box('CONCRETE', (xx - 0.15, 5.6, 0.0), (xx + 0.15, 6.4, 0.4), skip='-z')
    for (lx, ly) in ((-10.8, -10.8), (10.8, -10.8), (-10.8, 10.8), (10.8, 10.8)):
        a = math.atan2(-ly, -lx)
        light_pole(B, lx, ly, 9.0, [a - 0.35, a + 0.35], arm=0.6)
    meta['spec'] = [24.0, 24.0, 14.0]
    meta['cam'] = dict(azim=-58, elev=26, lens=38)
    meta['figures'] = [(-0.6, -13.0, 0, 1.6), (1.4, -1.6, 0, 1.2)]
    meta['closeup'] = dict(target=(0.0, -6.0, 3.0), azim=-75, elev=12, dist=19, lens=40)
    meta['json'] = {'radome_center': [TX, TY, round(zc, 3)], 'radome_r': R, 'tower_deck_z': TZ + 0.15}
    meta['notes'] = ('Capture-point radar compound: 24 x 24 m chain-link fence (2.4 m, inward barbed outriggers) with south double gate + '
                     'personnel gate, 7.4 m radome on a 6.35 m lattice tower (radome top 14.00 m), equipment hut, generator set, '
                     'four 9 m floodlight poles.')
    return meta

def torus_ring(B, mat, c, R, r, axis='Y', seg=12, sides=6):
    c = Vector(c); pts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        d = Vector((math.cos(a), 0, math.sin(a))) if axis == 'Y' else (Vector((0, math.cos(a), math.sin(a))) if axis == 'X' else Vector((math.cos(a), math.sin(a), 0)))
        pts.append(c + d * R)
    B.sweep(mat, pts, r, sides, closed=True)


def mooring_bollard(B, x, y, z):
    B.box('STEEL_DARK', (x - 0.35, y - 0.35, z), (x + 0.35, y + 0.35, z + 0.06))
    B.cyl('PAINT_YELLOW', (x, y, z + 0.06), (x, y, z + 0.5), 0.2, 12, r2=0.17, caps=(False, False))
    B.cyl('PAINT_YELLOW', (x, y, z + 0.5), (x, y, z + 0.62), 0.3, 12)


@asset('bld_naval_dock')
def build_dock(B):
    """Pier on piles. z = 0 is the water surface. Berth = -Y long side (fender line y = -20.0), land side +Y."""
    meta = {'doors': []}
    X, YB, YL, DZ, SZ, FL = 40.0, -19.6, 20.0, 3.0, 2.0, -20.0
    B.box('CONCRETE_DECK', (-X, YB + 0.8, SZ), (X, YL, DZ))
    B.box('CONCRETE_DECK', (-X, YB, 0.6), (X, YB + 0.8, DZ))                   # cope beam on the berth face
    for sx in (-1, 1): B.box('CONCRETE_DECK', (min(sx * X, sx * (X - 0.6)), YB + 0.8, 1.2), (max(sx * X, sx * (X - 0.6)), YL, SZ), skip='+z')
    pxs = [-38.8 + k * (77.6 / 12) for k in range(13)]; pys = (YB + 0.4, -13.0, -6.5, 0.0, 6.5, 13.0, YL - 0.6)
    for py in pys:
        B.box('CONCRETE_DECK', (-X + 0.3, py - 0.4, 1.3), (X - 0.3, py + 0.4, SZ), skip='+z') if py != pys[0] else None
        for px in pxs:
            B.box('CONCRETE_DECK', (px - 0.3, py - 0.3, -8.0), (px + 0.3, py + 0.3, 1.3 if py != pys[0] else 0.6), skip='+z')
    # fenders: rubber cell + steel panel every 8 m, front face on the fender line; tyre fenders between
    for k in range(10):
        fx = -36.0 + 8.0 * k
        B.cyl('RUBBER', (fx, YB, 1.75), (fx, FL + 0.12, 1.75), 0.42, 12)
        B.box('STEEL_DARK', (fx - 0.75, FL + 0.05, 0.55), (fx + 0.75, FL + 0.12, 2.95))
        B.box('RUBBER', (fx - 0.7, FL, 0.6), (fx + 0.7, FL + 0.05, 2.9))
        B.box('PAINT_YELLOW', (fx - 0.76, FL + 0.04, 2.95), (fx + 0.76, FL + 0.13, 3.0))
        if k < 9:
            tx = fx + 4.0
            if abs(tx) not in (30.0, 10.0):
                torus_ring(B, 'RUBBER', (tx, YB - 0.18, 1.6), 0.45, 0.16, axis='Y', seg=10, sides=5)
                B.cyl('STEEL_DARK', (tx, YB - 0.05, 2.03), (tx, YB - 0.05, 2.95), 0.012, 4)
    # berth kerb (hazard) with gaps at ladders, deck edge kerbs on the ends
    ladders = (-30.0, -10.0, 10.0, 30.0)
    edges = [-X] + [v for lx in ladders for v in (lx - 0.6, lx + 0.6)] + [X]
    for i in range(0, len(edges), 2):
        B.box('HAZARD', (edges[i], YB, DZ), (edges[i + 1], YB + 0.3, DZ + 0.2), skip='-z')
    for sx in (-1, 1): B.box('HAZARD', (min(sx * X, sx * (X - 0.3)), YB + 0.3, DZ), (max(sx * X, sx * (X - 0.3)), YL - 2.0, DZ + 0.2), skip='-z')
    for lx in ladders:   # steel ladders down the berth face with grab rails
        for s in (-1, 1):
            B.beam('STEEL_GALV', (lx + s * 0.22, YB - 0.14, -1.5), (lx + s * 0.22, YB - 0.14, DZ), 0.06, 0.02)
            B.sweep('PAINT_YELLOW', [(lx + s * 0.22, YB - 0.14, DZ), (lx + s * 0.22, YB - 0.14, DZ + 1.0), (lx + s * 0.22, YB + 0.5, DZ + 1.0), (lx + s * 0.22, YB + 0.5, DZ)], 0.025, 6, bend=0.12)
        for k in range(15):
            zz = -1.4 + k * 0.3; B.cyl('STEEL_GALV', (lx - 0.22, YB - 0.14, zz), (lx + 0.22, YB - 0.14, zz), 0.016, 5, caps=(False, False))
        B.box('STEEL_DARK', (lx - 0.3, YB - 0.14, 0.0), (lx + 0.3, YB, 0.08))
    # bollards, shore-power cabinets, life rings, deck markings
    for k in range(8): mooring_bollard(B, -35.0 + 10.0 * k, YB + 0.9, DZ)
    for cx in (-20.0, 0.0, 20.0):
        B.box('PAINT_WHITE', (cx - 0.4, YB + 2.0, DZ), (cx + 0.4, YB + 2.5, DZ + 1.35)); B.box('TEAM_ACCENT', (cx - 0.41, YB + 1.99, DZ + 1.1), (cx + 0.41, YB + 2.51, DZ + 1.2))
        B.box('STEEL_DARK', (cx - 0.45, YB + 1.95, DZ + 1.35), (cx + 0.45, YB + 2.55, DZ + 1.42)); B.box('STEEL_DARK', (cx - 0.25, YB + 1.99, DZ + 0.7), (cx + 0.25, YB + 2.0, DZ + 1.0))
    for lx in (-35.0, -15.0, 5.0, 25.0):
        py = YB + 1.6
        B.cyl('STEEL_GALV', (lx, py, DZ), (lx, py, DZ + 1.45), 0.04, 6); B.box('STEEL_DARK', (lx - 0.1, py - 0.05, DZ + 1.3), (lx + 0.1, py + 0.05, DZ + 1.5))
        torus_ring(B, 'PAINT_RED', (lx, py - 0.1, DZ + 1.05), 0.3, 0.055, axis='Y', seg=12, sides=6)
        for a in (0.4, 2.0, 3.6, 5.2):
            B.box('PAINT_WHITE', (lx + 0.3 * math.cos(a) - 0.06, py - 0.17, DZ + 1.05 + 0.3 * math.sin(a) - 0.06), (lx + 0.3 * math.cos(a) + 0.06, py - 0.03, DZ + 1.05 + 0.3 * math.sin(a) + 0.06))
    for (y0_, y1_) in ((YB + 3.2, YB + 3.35), (YB + 7.0, YB + 7.15)):
        B.box('PAINT_YELLOW', (-X + 0.5, y0_, DZ), (X - 0.5, y1_, DZ + 0.004), skip='-z')
    for k in range(9):   # crane exclusion hatching around the jib crane
        x0_ = -31.0 + k * 1.2; B.box('PAINT_YELLOW', (x0_, -13.4, DZ), (x0_ + 0.5, -13.25, DZ + 0.004), skip='-z')
    # lamp posts (land side), harbour office, jib crane
    for lx in (-30.0, -10.0, 10.0, 30.0):
        light_pole(B, lx, 17.2, 10.0, [math.radians(-90)], z0=DZ, arm=0.9)
    hut(B, 22.0, 30.0, 12.0, 17.0, 3.0, doors=[('S', 24.0)], windows=[('S', 27.2, 2.6, 1.0, 2.2), ('E', 14.5, 1.6, 1.0, 2.2), ('W', 14.5, 1.6, 1.0, 2.2)],
        meta=meta, canopy=0.6, stoop=0.6, zb=DZ)
    hvac_unit(B, (28.0, 17.0 + 0.32, DZ + 0.4), (1.0, 0.55, 0.75), fans=1)
    for xx in (27.55, 28.45): B.box('STEEL_DARK', (xx - 0.03, 17.0, DZ), (xx + 0.03, 17.35, DZ + 0.4))
    whip(B, 29.3, 16.4, DZ + 3.0, 3.0)
    B.box('CONCRETE', (-26.0, -16.5, DZ), (-24.0, -14.5, DZ + 0.4), skip='-z')
    B.box('HAZARD', (-26.02, -16.52, DZ), (-23.98, -14.48, DZ + 0.4), skip='-z+z')
    B.cyl('PAINT_YELLOW', (-25.0, -15.5, DZ + 0.4), (-25.0, -15.5, DZ + 7.2), 0.42, 16, r2=0.36)
    B.cyl('STEEL_DARK', (-25.0, -15.5, DZ + 6.7), (-25.0, -15.5, DZ + 7.0), 0.55, 16)
    B.cyl('PAINT_YELLOW', (-25.0, -15.5, DZ + 7.0), (-25.0, -15.5, DZ + 7.9), 0.3, 12)
    th = math.radians(208); d = Vector((math.cos(th), math.sin(th), 0)); p0 = Vector((-25.0, -15.5, DZ + 6.85)); p1 = p0 + d * 8.4
    B.beam('PAINT_YELLOW', p0 - d * 0.6, p1, 0.32, 0.55)
    B.beam('HAZARD', p1 - d * 0.6, p1 + d * 0.01, 0.34, 0.57)
    B.beam('PAINT_YELLOW', Vector((-25.0, -15.5, DZ + 7.85)), p0 + d * 5.5 + Vector((0, 0, 0.27)), 0.12, 0.12)
    tr = p0 + d * 6.2 - Vector((0, 0, 0.45))
    B.box('STEEL_DARK', tuple(tr - Vector((0.3, 0.25, 0.2))), tuple(tr + Vector((0.3, 0.25, 0.15))))
    for dd in (-0.08, 0.08): B.cyl('STEEL_DARK', tr + Vector((dd, 0, -0.2)), tr + Vector((dd, 0, -2.2)), 0.012, 4, caps=(False, False))
    B.box('HAZARD', tuple(tr + Vector((-0.2, -0.15, -2.5))), tuple(tr + Vector((0.2, 0.15, -2.2)))); B.cyl('STEEL_DARK', tr + Vector((0, 0, -2.5)), tr + Vector((0, 0, -2.8)), 0.05, 8)
    meta['spec'] = [80.0, 40.0, None]
    meta['water'] = True; meta['land'] = ((-120.0, YL, -12.0), (120.0, 90.0, DZ))
    meta['cam'] = dict(azim=-115, elev=24, lens=36, target=(0.0, -6.0, 1.0))
    meta['sun_azim'] = -40
    meta['figures'] = [(-22.0, -18.2, DZ, 1.6), (-20.6, -17.6, DZ, 2.0), (24.0, 10.6, DZ, 1.5)]
    meta['proxies'] = [dict(c=(21.0, FL - 3.6, -2.0), s=(32.0, 7.0, 11.0))]
    meta['closeup'] = dict(target=(-28.0, -19.0, 2.5), azim=-110, elev=10, dist=18, lens=40)
    meta['json'] = {'deck_z': DZ, 'berth_edge_y': FL, 'cope_face_y': YB, 'water_z': 0.0, 'pile_toe_z': -8.0, 'land_edge_y': YL,
                    'berth': {'x': [-X, X], 'fender_line_y': FL, 'facing': '-Y', 'cope_top_z': DZ, 'fender_band_z': [0.55, 3.0], 'min_depth_at_face_m': 8.0},
                    'bollards': [[-35.0 + 10.0 * k, YB + 0.9, DZ] for k in range(8)], 'berth_ladders_x': list(ladders),
                    'crane': {'pillar': [-25.0, -15.5, DZ], 'jib_tip': [round(p1.x, 2), round(p1.y, 2), round(p1.z, 2)], 'top_z': round(DZ + 7.9, 2)}}
    meta['notes'] = ('Naval dock (pier on piles), 80 x 40 m reserved area, origin at the centre at WATER LEVEL (z = 0 is the water surface). '
                     'Concrete deck top z = +3.00; piles to z = -8.00. Berth is the -Y long side: cope face y = -19.60, fender faces (where a hull '
                     'touches) on y = -20.00; land side is +Y (deck edge y = +20.00, meet terrain at z = 3.0). Bounds z: -8.0 (pile toes) to +13.0 (lamp posts); jib crane top 10.9.')
    return meta


def container(B, L, W=2.44, H=2.59):
    P, D = 'CONTAINER_PAINT', 'CONTAINER_DARK'
    x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
    cx, cy, cz = 0.178, 0.162, 0.118
    for xs, xe in ((x0, x0 + cx), (x1 - cx, x1)):
        for ys, ye in ((y0, y0 + cy), (y1 - cy, y1)):
            for zs, ze in ((0.0, cz), (H - cz, H)):
                yi0, yi1 = (ys + 0.003, ye) if ys == y0 else (ys, ye - 0.003)
                B.box(D, (xs, yi0, zs), (xe, yi1, ze))
                xm = (xs + xe) / 2; zm = (zs + ze) / 2
                B.box('RUBBER', (xm - 0.05, y0 if ys == y0 else y1 - 0.004, zm - 0.03), (xm + 0.05, y0 + 0.004 if ys == y0 else y1, zm + 0.03))
    for xs, xe in ((x0, x0 + 0.16), (x1 - 0.16, x1)):     # corner posts
        for ys, ye in ((y0 + 0.005, y0 + 0.15), (y1 - 0.15, y1 - 0.005)):
            B.box(P, (xs + 0.005, ys, cz), (xe - 0.005, ye, H - cz), skip='-z+z')
    for ys, ye in ((y0 + 0.004, y0 + 0.07), (y1 - 0.07, y1 - 0.004)):   # side rails
        B.box(P, (x0 + cx, ys, 0.0), (x1 - cx, ye, 0.16))
        B.box(P, (x0 + cx, ys, H - 0.11), (x1 - cx, ye, H - 0.004))
    for xs, xe in ((x0 + 0.004, x0 + 0.1), (x1 - 0.1, x1 - 0.004)):    # end rails
        B.box(P, (xs, y0 + cy, 0.0), (xe, y1 - cy, 0.18)); B.box(P, (xs, y0 + cy, H - 0.2), (xe, y1 - cy, H - 0.004))
    zc0, zc1 = 0.16, H - 0.11; per = 0.278
    B.corrugated(P, (x0 + 0.16, y0 + 0.045, zc0), (1, 0, 0), (0, 0, 1), L - 0.32, zc1 - zc0, per, 0.036, profile='box')
    B.corrugated(P, (x1 - 0.16, y1 - 0.045, zc0), (-1, 0, 0), (0, 0, 1), L - 0.32, zc1 - zc0, per, 0.036, profile='box')
    B.corrugated(P, (x0 + 0.045, y1 - 0.15, 0.18), (0, -1, 0), (0, 0, 1), W - 0.3, H - 0.38, per, 0.03, profile='box')
    B.corrugated(P, (x0 + cx, y1 - 0.07, H - 0.035), (1, 0, 0), (0, -1, 0), L - 2 * cx, W - 0.14, 0.45, 0.014, profile='trap')
    B.quad(D, (x0, y0, 0.002), (x0, y1, 0.002), (x1, y1, 0.002), (x1, y0, 0.002))
    # doors at +X: two leaves, ribs, four locking bars with cam keepers and handles, header/sill, seal
    xd = x1 - 0.13; gap = 0.006; hw = (W - 2 * cy) / 2   # door hardware stays inside the corner castings
    B.box('RUBBER', (xd - 0.03, y0 + cy, 0.18), (xd - 0.005, y1 - cy, H - 0.2), skip='')
    for s in (-1, 1):
        ya, yb = (0.0 + gap, hw) if s > 0 else (-hw, -gap)
        ya, yb = ya + (0 if s < 0 else 0), yb
        B.box(P, (xd - 0.005, ya, 0.19), (xd + 0.03, yb, H - 0.21))
        for zz in (0.55, 1.25, 1.95):
            B.box(P, (xd + 0.03, ya + 0.04, zz), (xd + 0.045, yb - 0.04, zz + 0.16))
        for yy in (ya + (yb - ya) * 0.22, ya + (yb - ya) * 0.72):
            B.cyl(D, (xd + 0.07, yy, 0.12), (xd + 0.07, yy, H - 0.14), 0.017, 6)
            for zz in (0.14, H - 0.17): B.box(D, (xd + 0.03, yy - 0.04, zz - 0.04), (xd + 0.1, yy + 0.04, zz + 0.04))
            B.box(D, (xd + 0.07, min(yy, yy + 0.22 * s) - 0.015, 1.0), (xd + 0.115, max(yy, yy + 0.22 * s) + 0.015, 1.06))
        for zz in (0.5, 1.3, 2.05):   # hinges
            yh = y1 - cy - 0.02 if s > 0 else y0 + cy + 0.02
            B.box(D, (xd + 0.0, yh - 0.03, zz), (xd + 0.06, yh + 0.03, zz + 0.12))
    B.box('PAINT_WHITE', (xd + 0.03, 0.25, 2.15), (xd + 0.036, 0.85, 2.35))


@asset('prop_container_20')
def build_c20(B):
    container(B, 6.06)
    return container_meta(6.06)


@asset('prop_container_40')
def build_c40(B):
    container(B, 12.19)
    return container_meta(12.19)


def container_meta(L):
    return {'spec': [L, 2.44, 2.59], 'cam': dict(azim=-38, elev=24, lens=40),
            'figures': [(L / 2 + 1.2, -1.0, 0, 2.6)],
            'dupes': [(0.0, 2.75, 0.0), (0.0, -2.75, 0.0), (0.0, 0.0, 2.59), (0.0, 2.75, 2.59), (0.0, -5.5, 0.0)] if L < 8 else
                     [(0.0, 2.75, 0.0), (0.0, -2.75, 0.0), (0.0, 0.0, 2.59), (0.0, -2.75, 2.59)],
            'closeup': dict(target=(L / 2, 0.0, 1.3), azim=-25, elev=10, dist=6.5, lens=40),
            'notes': 'ISO-style %s container: corrugated steel sides/ends, roof, 8 corner castings (define the exact bounds), corner posts, rails, '
                     'double doors at +X with four locking bars, cam keepers and handles. CONTAINER_PAINT picks one of six muted liveries via '
                     'Object Info > Random (set node NEUTRAL=1 for a light neutral); the GLB atlas is baked neutral for web tinting. '
                     'Origin at the footprint centre at ground.' % ('20-foot' if L < 8 else '40-foot'),
            'json': {'stack_pitch_z': 2.59, 'door_end': '+X'}}

# ═══════════════════════════════════════════ pipeline ═══════════════════════════════════════════
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(7)


def measure(objs):
    dg = bpy.context.evaluated_depsgraph_get(); lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3); tri = 0; tri_in = 0; excl = []
    for o in objs:
        if o.type != 'MESH': continue
        ev = o.evaluated_get(dg); me = ev.to_mesh(); t = sum(len(p.vertices) - 2 for p in me.polygons); tri += t
        if o.get('exclude_bounds'): excl.append(o.name)
        else:
            tri_in += t
            for v in me.vertices:
                w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi, tri, excl


def full_bounds(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def set_render(sc, samples=32, size=(800, 600)):
    sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True
    try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 2; sc.cycles.transmission_bounces = 2
    sc.cycles.transparent_max_bounces = 8; sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    sc.render.image_settings.file_format = 'PNG'; sc.render.film_transparent = False
    try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass


def preview_mats():
    if 'FIG' not in bpy.data.materials:
        m = bpy.data.materials.new('FIG'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*srgb('#e8641c'), 1); b.inputs['Roughness'].default_value = 0.6
        m = bpy.data.materials.new('PROXY'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*srgb('#59613f'), 1); b.inputs['Roughness'].default_value = 0.7
        # ground with 1 m / 5 m grid
        m = bpy.data.materials.new('GRID'); g = NB(m); x, y, z = g.sep(g.coords())[:3]
        l1 = g.math('MAXIMUM', g.line_mask(x, 1.0, 0.006, 0.014), g.line_mask(y, 1.0, 0.006, 0.014))
        l5 = g.math('MAXIMUM', g.line_mask(x, 5.0, 0.02, 0.035), g.line_mask(y, 5.0, 0.02, 0.035))
        n = g.noise(g.coords(), 0.3, 4.0)
        col = g.mix(1.0, g.rgb(srgb('#6c6a63')), g.mr(n, 0.3, 0.7, 0.85, 1.12), 'MULTIPLY')
        col = g.mix(g.math('MULTIPLY', l1, 0.55), col, g.rgb(srgb('#d8d4c8'))); col = g.mix(l5, col, g.rgb(srgb('#e8c040')))
        g.L.new(col, g.bsdf.inputs['Base Color']); g.bsdf.inputs['Roughness'].default_value = 0.85
        m = bpy.data.materials.new('WATER'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*srgb('#173a44'), 1); b.inputs['Roughness'].default_value = 0.08
        nt = m.node_tree; nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.5
        bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.08
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])


def render_view(path, target, azim, elev, lens, dist=None, bounds=None, size=(800, 600), samples=32, margin=1.08):
    sc = bpy.context.scene; set_render(sc, samples, size)
    cam = bpy.data.objects.get('_cam') or bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam'))
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    cam.data.lens = lens; cam.data.sensor_fit = 'HORIZONTAL'; cam.data.sensor_width = 36; cam.data.clip_end = 3000; cam.data.clip_start = 0.1
    e, a = math.radians(elev), math.radians(azim); t = Vector(target)
    dirv = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))   # target -> camera
    f = -dirv; r = f.cross(Vector((0, 0, 1))).normalized(); u = r.cross(f)
    if dist is None:
        th = 18.0 / lens; tv = th * size[1] / size[0]; D = 1.0
        lo, hi = bounds
        for cx in (lo.x, hi.x):
            for cy in (lo.y, hi.y):
                for cz in (lo.z, hi.z):
                    d = Vector((cx, cy, cz)) - t
                    D = max(D, abs(d.dot(r)) * margin / th - d.dot(f), abs(d.dot(u)) * margin / tv - d.dot(f))
        dist = D
    cam.location = t + dirv * dist; cam.rotation_euler = f.to_track_quat('-Z', 'Y').to_euler(); sc.camera = cam
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)


def setup_preview_scene(name, meta, objs):
    preview_mats()
    sc = bpy.context.scene
    w = bpy.data.worlds.new('_w'); sc.world = w; w.use_nodes = True; nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_disc = False
    sky.sun_elevation = math.radians(38); sky.sun_rotation = math.radians(200); sky.altitude = 100; sky.air_density = 1.0; sky.dust_density = 1.5
    nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color']); nt.nodes['Background'].inputs['Strength'].default_value = 0.22
    sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4.2; sun.data.angle = math.radians(1.5); sun.data.color = (1.0, 0.95, 0.88)
    sun.rotation_euler = Euler((math.radians(50), 0, math.radians(meta.get('sun_azim', -25))))
    pb = Builder('_preview')
    lo, hi = full_bounds(objs)
    ext = max(hi.x - lo.x, hi.y - lo.y) * 2.5 + 40
    if meta.get('water'):
        pb.box('WATER', (-ext, -ext, -0.02), (ext, ext, 0.0), skip='-z')
        if meta.get('land'): pb.box('GRID', meta['land'][0], meta['land'][1], skip='-z')
    else:
        pb.box('GRID', (-ext, -ext, -0.02), (ext, ext, -0.003), skip='-z')
    for fx, fy, fz, rz in meta.get('figures', []): mannequin(pb, fx, fy, fz, rz)
    dupes = []
    for (dx, dy, dz) in meta.get('dupes', []):        # linked copies: show per-instance colour variation
        for o in objs:
            c = o.copy(); c.name = '_dupe_' + o.name; c.location = (dx, dy, dz); bpy.context.scene.collection.objects.link(c); dupes.append(c)
    for pr in meta.get('proxies', []):
        (cx, cy, cz), (sx, sy, sz) = pr['c'], pr['s']
        pb.box('PROXY', (cx - sx / 2, cy - sy / 2, cz), (cx + sx / 2, cy + sy / 2, cz + sz))
        if pr.get('barrel'): pb.cyl('PROXY', (cx + sx / 2 - 1.5, cy, cz + sz - 0.35), (cx + sx / 2 + pr['barrel'], cy, cz + sz - 0.35), 0.1, 8)
    MATDEFS.update({'FIG': lambda n: bpy.data.materials['FIG'], 'PROXY': lambda n: bpy.data.materials['PROXY'],
                    'GRID': lambda n: bpy.data.materials['GRID'], 'WATER': lambda n: bpy.data.materials['WATER']})
    pcoll, pobjs = pb.finalize()
    return pcoll, pobjs + dupes


def write_json(name, meta, lo, hi, tri, excl, extra_tris=None):
    size = [round(hi[i] - lo[i], 4) for i in range(3)]
    d = {'name': name, 'size_m': size, 'min': [round(c, 4) for c in lo], 'max': [round(c, 4) for c in hi],
         'spec_m': meta.get('spec'), 'tris': tri, 'excluded': excl, 'notes': meta.get('notes', '')}
    if meta.get('doors') is not None and name.startswith('bld_'): d['doors'] = meta['doors']
    for k, v in meta.get('json', {}).items(): d[k] = v
    d = _round(d)
    with open(os.path.join(OUT['bounds'], name + '.json'), 'w') as f: json.dump(d, f, indent=2)
    return d


def _round(v, nd=4):
    if isinstance(v, float): return round(v, nd)
    if isinstance(v, dict): return {k: _round(x, nd) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [_round(x, nd) for x in v]
    return v

# ---------- bake + GLB ----------
def _uv_islands_scale(o):
    """Scale UV islands by importance before packing: undersides tiny, interior surfaces smaller, roofs larger."""
    me = o.data; bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv.active; bm.faces.ensure_lookup_table()
    names = [m.name if m else '' for m in me.materials]
    parent = list(range(len(bm.faces)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2: continue
        f1, f2 = lf
        def uvs(f):
            d = {}
            for l in f.loops: d[l.vert.index] = l[uvl].uv.copy()
            return d
        a, b = uvs(f1), uvs(f2)
        if all((a[v.index] - b[v.index]).length < 1e-5 for v in e.verts): parent[find(f1.index)] = find(f2.index)
    groups = {}
    for f in bm.faces: groups.setdefault(find(f.index), []).append(f)
    for fl in groups.values():
        wsum = 0.0; asum = 0.0
        for f in fl:
            a = f.calc_area(); n = f.normal; mn = names[f.material_index] if f.material_index < len(names) else ''
            w = 1.0
            if n.z < -0.6: w = 0.03
            elif mn in ('INTERIOR', 'FLOOR'): w = 0.35
            elif n.z > 0.5: w = 1.5
            wsum += w * a; asum += a
        k = math.sqrt(wsum / asum) if asum > 0 else 1.0
        if abs(k - 1.0) < 1e-3: continue
        cen = Vector((0, 0)); cnt = 0
        for f in fl:
            for l in f.loops: cen += l[uvl].uv; cnt += 1
        cen /= max(1, cnt)
        for f in fl:
            for l in f.loops: l[uvl].uv = cen + (l[uvl].uv - cen) * k
    bm.to_mesh(me); bm.free()


def shelf_pack_uvs(objs, size=1024, margin_px=2.0):
    """Repack smart-project islands: weight by importance, rotate landscape, shelf-pack with a guaranteed pixel gap."""
    data = []   # (bm, me, faces, bbox, weight)
    bms = []
    for o in objs:
        me = o.data; bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv['UVMap']; bm.faces.ensure_lookup_table()
        names = [m.name if m else '' for m in me.materials]; bms.append((o, bm))
        parent = list(range(len(bm.faces)))
        def find(i):
            while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
            return i
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) != 2: continue
            f1, f2 = lf; ok = True
            for v in e.verts:
                a = next(l[uvl].uv for l in f1.loops if l.vert == v); b = next(l[uvl].uv for l in f2.loops if l.vert == v)
                if (a - b).length > 1e-5: ok = False; break
            if ok: parent[find(f1.index)] = find(f2.index)
        groups = {}
        for f in bm.faces: groups.setdefault(find(f.index), []).append(f)
        for fl in groups.values():
            xs = [l[uvl].uv.x for f in fl for l in f.loops]; ys = [l[uvl].uv.y for f in fl for l in f.loops]
            wsum = asum = 0.0
            for f in fl:
                a = f.calc_area(); n = f.normal; mn = names[f.material_index] if f.material_index < len(names) else ''
                w = 1.0
                if n.z < -0.6: w = 0.03
                elif mn in ('INTERIOR', 'FLOOR'): w = 0.3
                elif n.z > 0.5: w = 1.4
                wsum += w * a; asum += a
            k = math.sqrt(wsum / asum) if asum > 0 else 1.0
            data.append([bm, uvl, fl, (min(xs), min(ys), max(xs), max(ys)), k])
    m = margin_px / size
    def dims(d, s):
        x0, y0, x1, y1 = d[3]; w, h = (x1 - x0) * d[4] * s, (y1 - y0) * d[4] * s
        return (h, w, True) if h > w else (w, h, False)
    # thin/tiny islands (< 3 px across at the expected scale) go into one shared swatch cell per material
    tot = sum((d[3][2] - d[3][0]) * (d[3][3] - d[3][1]) * d[4] ** 2 for d in data)
    s_est = math.sqrt(0.62 / max(tot, 1e-9)); tiny_px = 3.0 / size
    tiny = [d for d in data if dims(d, s_est)[1] < tiny_px]; data = [d for d in data if dims(d, s_est)[1] >= tiny_px]
    swatch_mats = sorted({(id(d[0]), d[2][0].material_index) for d in tiny})
    cell = 8.0 / size; per_row = int(1.0 / cell); sw_rows = int(math.ceil(len(swatch_mats) / per_row)) if swatch_mats else 0
    for d in tiny:
        key = (id(d[0]), d[2][0].material_index); i = swatch_mats.index(key)
        cx, cy = (i % per_row) * cell, 1.0 - (i // per_row + 1) * cell
        x0, y0, x1, y1 = d[3]; uvl = d[1]
        for f in d[2]:
            for l in f.loops:
                fx = (l[uvl].uv.x - x0) / max(x1 - x0, 1e-9); fy = (l[uvl].uv.y - y0) / max(y1 - y0, 1e-9)
                l[uvl].uv = (cx + 2.0 / size + fx * (cell - 4.0 / size), cy + 2.0 / size + fy * (cell - 4.0 / size))
    top = 1.0 - sw_rows * cell
    def pack(s, place=False):
        items = sorted(data, key=lambda d: -dims(d, s)[1]); x = y = rowh = 0.0
        for d in items:
            w, h, rot = dims(d, s); W_, H_ = w + 2 * m, h + 2 * m
            if x + W_ > 1.0:
                x = 0.0; y += rowh; rowh = 0.0
            if place:
                x0, y0, x1, y1 = d[3]; k = d[4] * s; bm, uvl = d[0], d[1]
                for f in d[2]:
                    for l in f.loops:
                        lx, ly = (l[uvl].uv.x - x0) * k, (l[uvl].uv.y - y0) * k
                        if rot: lx, ly = ly, (x1 - x0) * k - lx
                        l[uvl].uv = (x + m + lx, y + m + ly)
            x += W_; rowh = max(rowh, H_)
        return y + rowh <= top
    lo, hi = 0.0, 1.0
    while pack(hi): hi *= 2.0
    for _ in range(30):
        mid = (lo + hi) / 2
        if pack(mid): lo = mid
        else: hi = mid
    pack(lo, place=True)
    for o, bm in bms: bm.to_mesh(o.data); bm.free()
    return lo


def dedupe_slots(o):
    me = o.data; mats = list(me.materials); uniq, remap = [], []
    for m in mats:
        if m not in uniq: uniq.append(m)
        remap.append(uniq.index(m))
    idx = [0] * len(me.polygons); me.polygons.foreach_get('material_index', idx)
    me.materials.clear()
    for m in uniq: me.materials.append(m)
    me.polygons.foreach_set('material_index', [remap[i] if i < len(remap) else 0 for i in idx]); me.update()


def bake_and_export(name, objs, size=1024, samples=16):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples
    sc.cycles.use_denoising = False; sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
    bake_objs = [o for o in objs if o.type == 'MESH' and any(m and m.get('bake') for m in o.data.materials)]
    # container paint -> neutral before bake
    for m in bpy.data.materials:
        if m.use_nodes and 'NEUTRAL' in m.node_tree.nodes: m.node_tree.nodes['NEUTRAL'].outputs[0].default_value = 1.0
    img = bpy.data.images.new(name + '_atlas', size, size); img.colorspace_settings.name = 'sRGB'
    rs, ms, ws = 0.0, 0.0, 0.0
    for o in bake_objs:
        for m in o.data.materials:
            if not m.get('bake'): continue
            b = m.node_tree.nodes['Principled BSDF']
            for inp in ('Metallic', 'Transmission Weight'):
                if inp in b.inputs:
                    for l in list(b.inputs[inp].links): m.node_tree.links.remove(l)
                    b.inputs[inp].default_value = 0.0
            t = m.node_tree.nodes.get('_bake') or m.node_tree.nodes.new('ShaderNodeTexImage'); t.name = '_bake'; t.image = img
            m.node_tree.nodes.active = t
    # area-weighted average roughness / metal of the baked set
    for o in bake_objs:
        for p in o.data.polygons:
            m = o.data.materials[p.material_index]
            if m and m.get('bake'): a = p.area; rs += a * m.get('rough', 0.6); ms += a * m.get('metal', 0.1); ws += a
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in bake_objs:
        if 'UVMap' not in o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers.active = o.data.uv_layers['UVMap']; o.select_set(True)
    bpy.context.view_layer.objects.active = bake_objs[0]
    t0 = time.time()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    shelf_pack_uvs(bake_objs, size)
    print('  uv %.1fs' % (time.time() - t0)); t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=4)
    print('  bake %.1fs' % (time.time() - t0))
    import tempfile
    tmpd = tempfile.mkdtemp(prefix='bldbake_'); jp = os.path.join(tmpd, name + '_atlas.jpg')
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 90
    img.save_render(jp, scene=sc)
    if DEBUG_DIR:
        import shutil; shutil.copy(jp, os.path.join(DEBUG_DIR, name + '_atlas.jpg'))
    img = bpy.data.images.load(jp); img.name = name + '_atlas'; img.pack()
    atlas = bpy.data.materials.new(name + '_atlas'); atlas.use_nodes = True; N = atlas.node_tree.nodes; b = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage'); t.image = img; atlas.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rs / max(ws, 1e-6); b.inputs['Metallic'].default_value = min(0.3, ms / max(ws, 1e-6))
    flat = {}
    def flat_mat(src):
        nm = 'TEAM' if src.name == 'TEAM_ACCENT' else src.name
        if nm in flat: return flat[nm]
        if nm == 'FENCE': flat[nm] = src; return src
        m = bpy.data.materials.new(nm + '_x'); m.use_nodes = True; bb = m.node_tree.nodes['Principled BSDF']
        if nm == 'TEAM':
            bb.inputs['Base Color'].default_value = (0.214, 0.214, 0.214, 1); bb.inputs['Roughness'].default_value = 0.45
        elif nm.startswith('GLOW'):
            c = src.get('flat_col'); bb.inputs['Base Color'].default_value = (*c, 1); bb.inputs['Emission Color'].default_value = (*c, 1)
            bb.inputs['Emission Strength'].default_value = src.get('strength', 5.0)
        elif nm.startswith('GLASS'):
            c = src.get('flat_col'); bb.inputs['Base Color'].default_value = (*c, 1); bb.inputs['Roughness'].default_value = src.get('rough', 0.08)
        flat[nm] = m; return m
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if m is None: continue
            if m.get('bake'): o.data.materials[i] = atlas
            else: o.data.materials[i] = flat_mat(m)
        for a in list(o.data.attributes):
            if a.name == 'streak': o.data.attributes.remove(a)
        dedupe_slots(o)
    # rename flat copies to their contract names
    for nm, m in flat.items():
        if m.name != nm:
            old = bpy.data.materials.get(nm)
            if old and old is not m: old.name = nm + '_src'
            m.name = nm
    # merge mesh objects per group for fewer draw calls is left to the engine; keep named parts
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    path = os.path.join(OUT['glb'], name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
                              export_image_quality=88, export_animations=False, export_vertex_color='NONE', export_attributes=False,
                              export_extras=True)
    print('  glb', path, os.path.getsize(path) // 1024, 'KB')
    return path


def check_glb(name, path, meta):
    """Debug: re-import the exported GLB into an empty scene and render a small view of it."""
    reset(); bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in objs:
        for m in o.data.materials:
            if m and m.name.startswith('TEAM'): m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*TEAM_BLUE, 1)
    flo, fhi = full_bounds(objs)
    sc = bpy.context.scene; w = bpy.data.worlds.new('_w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.6, 0.75, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 4.0
    sun.rotation_euler = Euler((math.radians(50), 0, math.radians(meta.get('sun_azim', -25))))
    cam = meta.get('cam', {})
    render_view(os.path.join(DEBUG_DIR, name + '_glb.png'), tuple((flo + fhi) / 2), cam.get('azim', -55), cam.get('elev', 25), cam.get('lens', 40),
                bounds=(flo, fhi), size=(560, 420), samples=12)


def build(name, do_glb=False, do_preview=True):
    t0 = time.time(); reset()
    B = Builder(name); meta = ASSET_FUNCS[name](B)
    coll, objs = B.finalize()
    for i, (loc, size, power) in enumerate(meta.get('lights', [])):   # interior area lights (part of the asset, not exported to GLB)
        ld = bpy.data.lights.new('%s_light_%d' % (name, i), 'AREA'); ld.shape = 'RECTANGLE'; ld.size, ld.size_y = size
        ld.energy = power; ld.color = (1.0, 0.95, 0.86)
        lo_ = bpy.data.objects.new(ld.name, ld); lo_.location = loc; coll.objects.link(lo_)
    lo, hi, tri, excl = measure(objs)
    d = write_json(name, meta, lo, hi, tri, excl)
    print('%s size %s spec %s tris %d excluded %s' % (name, d['size_m'], d['spec_m'], tri, excl))
    bpy.context.preferences.filepaths.save_version = 0          # no .blend1 backups next to the deliverables
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT['blend'], name + '.blend'), compress=True)
    if do_preview:
        pcoll, pobjs = setup_preview_scene(name, meta, objs)
        team = bpy.data.materials.get('TEAM_ACCENT')
        if team: team.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*TEAM_BLUE, 1)
        flo, fhi = full_bounds(objs)
        for (dx, dy, dz) in meta.get('dupes', []):
            flo = Vector(map(min, flo, flo + Vector((dx, dy, dz)))); fhi = Vector(map(max, fhi, fhi + Vector((dx, dy, dz))))
        cam = meta.get('cam', {}); tgt = cam.get('target', tuple((flo + fhi) / 2 - Vector((0, 0, (fhi.z - flo.z) * 0.12))))
        t1 = time.time()
        fast = bool(os.environ.get('BLD_FAST'))
        if not os.environ.get('BLD_SKIP_MAIN'): render_view(os.path.join(OUT['preview'], name + '.png'), tgt, cam.get('azim', -55), cam.get('elev', 25), cam.get('lens', 40),
                    bounds=(flo, fhi), margin=cam.get('margin', 1.06), size=(560, 420) if fast else (800, 600), samples=14 if fast else 32)
        print('  preview %.1fs' % (time.time() - t1))
        if DEBUG_DIR:
            views = ([meta['closeup']] if meta.get('closeup') else []) + ([] if os.environ.get('BLD_CLOSE_ONLY') else meta.get('extra_views', []))
            if os.environ.get('BLD_NO_CLOSE'): views = []
            for i, cu in enumerate(views):
                render_view(os.path.join(DEBUG_DIR, '%s_v%d.png' % (name, i)), cu['target'], cu['azim'], cu['elev'], cu.get('lens', 40),
                            dist=cu['dist'], size=(560, 420), samples=16)
        if team: team.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.214, 0.214, 0.214, 1)
        for o in pobjs: bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(pcoll)
        for n in ('_cam', '_sun'):
            o = bpy.data.objects.get(n)
            if o: bpy.data.objects.remove(o, do_unlink=True)
    if do_glb:
        path = bake_and_export(name, objs)
        if DEBUG_DIR: check_glb(name, path, meta)
    print('%s done in %.1fs' % (name, time.time() - t0))
    return d


ORDER = ['bld_barracks', 'bld_vehicle_factory', 'bld_hq', 'bld_ore_refinery', 'bld_power_substation', 'bld_radar_control',
         'bld_extraction_rig', 'bld_capture_radar', 'bld_naval_dock', 'prop_container_20', 'prop_container_40']


def main(argv):
    global DEBUG_DIR
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('name', nargs='?', default='all'); ap.add_argument('--glb', action='store_true')
    ap.add_argument('--no-preview', action='store_true'); ap.add_argument('--debug', default=None)
    a = ap.parse_args(argv)
    DEBUG_DIR = a.debug
    if a.debug: os.makedirs(a.debug, exist_ok=True)
    def resolve(n):
        return n if n in ASSET_FUNCS else ('bld_' + n if 'bld_' + n in ASSET_FUNCS else 'prop_' + n)
    names = [n for n in ORDER if n in ASSET_FUNCS] if a.name == 'all' else [resolve(n) for n in a.name.split(',')]
    for n in names:
        if n not in ASSET_FUNCS: print('unknown asset', n); continue
        build(n, a.glb, not a.no_preview)


if __name__ == '__main__':
    main(sys.argv[1:])
