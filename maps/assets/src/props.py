#!/usr/bin/env python
"""Thunderhead maps - prop_ library (port, roads/site, resource site, industrial, biome landmarks).

Usage:  /home/claude/blender-env/bin/python props.py [name|all|group] [--glb] [--no-preview] [--list]
  name   one asset, e.g. prop_gantry_crane;  all = every asset in priority order;  group = port|site|resource|industrial|landmark
  --glb  also bake the procedural materials into one atlas and write maps/assets/glb/<name>.glb

Per ASSET_CONTRACT.md each asset writes blend/<name>.blend (one collection <name>), bounds/<name>.json,
preview/<name>.png (Cycles, 1.8 m figure + 1 m / 10 m ground grid) and, with --glb, glb/<name>.glb.
Units metres, +X east, +Y north, +Z up. Geometry is built directly in bmesh (no modifiers), every object has an identity
rotation/scale; pivots of moving parts (wind-turbine `rotor`, clarifier `bridge`) sit at their rotation centre.
"""
import sys as _gs, pathlib as _gp; _gs.path.insert(0, str(next(p for p in _gp.Path(__file__).resolve().parents if (p / 'tools' / 'blender_gpu.py').exists()) / 'tools')); from blender_gpu import use_gpu  # render device: GPU (tools/blender_gpu.py)
import bpy, bmesh  # bpy before bmesh
import math, os, sys, json, random, time, argparse
from mathutils import Vector, Matrix, Euler, noise as mnoise

sys.path.insert(0, '/home/claude/thunderhead/blender')
import lib  # noqa: E402  (bake_atlas, uv_unwrap)

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
DIRS = {k: os.path.join(ASSETS, k) for k in ('blend', 'glb', 'bounds', 'preview')}
for d in DIRS.values(): os.makedirs(d, exist_ok=True)


class _Cur: coll = None
CUR = _Cur()
TAU = 2 * math.pi
V = Vector


# ════════════════════════════════════════════════════════════════════ materials
class NB:
    """Tiny node-graph builder for procedural Cycles materials (object-space coordinates, metres)."""
    def __init__(s, name, bake=True):
        m = bpy.data.materials.new(name); m.use_nodes = True; s.m = m
        s.nt = m.node_tree; s.N = s.nt.nodes; s.L = s.nt.links; s.b = s.N['Principled BSDF']
        m['bake'] = bake; s._tc = None; s._geo = None

    def link(s, sock, v):
        if v is None: return
        if isinstance(v, bpy.types.NodeSocket): s.L.new(v, sock); return
        if isinstance(v, bpy.types.Node): s.L.new(v.outputs[0], sock); return
        if isinstance(v, (tuple, list)) and sock.type == 'RGBA' and len(v) == 3: v = (*v, 1.0)
        sock.default_value = v

    def n(s, t, ins=(), **attrs):
        nd = s.N.new(t)
        for k, v in attrs.items(): setattr(nd, k, v)
        for k, v in (ins.items() if isinstance(ins, dict) else enumerate(ins)): s.link(nd.inputs[k], v)
        return nd

    def P(s):
        if not s._tc: s._tc = s.N.new('ShaderNodeTexCoord')
        return s._tc.outputs['Object']

    def geo(s):
        if not s._geo: s._geo = s.N.new('ShaderNodeNewGeometry')
        return s._geo

    def math(s, op, a, b=0.0, clamp=False): return s.n('ShaderNodeMath', (a, b), operation=op, use_clamp=clamp).outputs[0]
    def mr(s, x, a, b, c=0.0, d=1.0): return s.n('ShaderNodeMapRange', {'Value': x, 'From Min': a, 'From Max': b, 'To Min': c, 'To Max': d}).outputs[0]
    def noise(s, vec, scale, detail=4.0, rough=0.55): return s.n('ShaderNodeTexNoise', {'Vector': vec, 'Scale': scale, 'Detail': detail, 'Roughness': rough}).outputs['Fac']
    def vor(s, vec, scale, feature='F1'): return s.n('ShaderNodeTexVoronoi', {'Vector': vec, 'Scale': scale}, feature=feature)
    def mix(s, f, a, b, blend='MIX'): return s.n('ShaderNodeMixRGB', {'Fac': f, 'Color1': a, 'Color2': b}, blend_type=blend).outputs[0]
    def hsv(s, col, v=1.0, sat=1.0): return s.n('ShaderNodeHueSaturation', {'Hue': 0.5, 'Saturation': sat, 'Value': v, 'Color': col}).outputs[0]
    def scl(s, vec, sc): return s.n('ShaderNodeMapping', {'Vector': vec, 'Scale': sc}).outputs[0]
    def sep(s, vec): return s.n('ShaderNodeSeparateXYZ', {'Vector': vec})
    def dot(s, a, b): return s.n('ShaderNodeVectorMath', (a, b), operation='DOT_PRODUCT').outputs['Value']
    def ao(s, d): return s.n('ShaderNodeAmbientOcclusion', {'Distance': d}, samples=8).outputs['AO']
    def nz(s): return s.sep(s.geo().outputs['Normal']).outputs['Z']

    def edge(s, r=0.04, lo=0.90, hi=0.985):
        """1 on convex/concave hard edges (bevel-normal trick, works on low-poly flat geometry)."""
        bv = s.n('ShaderNodeBevel', {'Radius': r}, samples=6)
        return s.mr(s.dot(bv.outputs['Normal'], s.geo().outputs['Normal']), hi, lo, 0.0, 1.0)

    def lines(s, P, spacing, w, lifts=None, axes='xy'):
        """Joint lines on a metric grid; X/Y lines only on faces not facing that axis, Z lines (lifts) on vertical faces."""
        xyz = s.sep(P); nrm = s.sep(s.geo().outputs['Normal']); out = None
        specs = [(xyz.outputs[a.upper()], nrm.outputs[a.upper()], spacing) for a in axes]
        if lifts: specs.append((xyz.outputs['Z'], nrm.outputs['Z'], lifts))
        for comp, nc, sp in specs:
            f = s.math('FRACT', s.math('ADD', s.math('DIVIDE', comp, sp), 0.5))
            d = s.math('MULTIPLY', s.math('ABSOLUTE', s.math('SUBTRACT', f, 0.5)), sp)
            m = s.math('MULTIPLY', s.math('LESS_THAN', d, w), s.math('LESS_THAN', s.math('ABSOLUTE', nc), 0.5))
            out = m if out is None else s.math('MAXIMUM', out, m)
        return out

    def bump(s, h, strength, dist=0.01, normal=None):
        b = s.n('ShaderNodeBump', {'Strength': strength, 'Distance': dist, 'Height': h, 'Normal': normal})
        return b.outputs['Normal']

    def out(s, col, rough, metal=0.0, normal=None):
        s.link(s.b.inputs['Base Color'], col); s.link(s.b.inputs['Roughness'], rough); s.link(s.b.inputs['Metallic'], metal)
        if normal is not None: s.link(s.b.inputs['Normal'], normal)
        return s.m


def _got(name):
    return bpy.data.materials.get(name)


def paint(name, col, rough=0.5, metal=0.0, chips=0.3, rust=0.3, grime=0.4, stripe=None, bands=None, corr=None, grate=None,
          seams=None, waterline=None, dust=0.0, mottle=0.12, edge_r=0.04, ground=True, bump=0.25):
    """Painted / coated steel: mottled colour, edge chips to primer and rust, vertical rust streaks, cavity + ground grime,
    optional hazard stripes, horizontal colour bands, corrugation, grating holes, plate seams, waterline weed and top dust."""
    if _got(name): return _got(name)
    s = NB(name); P = s.P(); xyz = s.sep(P); Z = xyz.outputs['Z']; c = col; rr = None
    if stripe:
        c2, per = stripe
        t = s.math('FRACT', s.math('DIVIDE', s.dot(P, (0.577, 0.577, 0.577)), per))
        c = s.mix(s.math('LESS_THAN', t, 0.5), c, c2)
    if bands:
        c2, per, z0 = bands if len(bands) == 3 else (*bands, 0.0)
        t = s.math('FRACT', s.math('DIVIDE', s.math('SUBTRACT', Z, z0), per))
        c = s.mix(s.math('LESS_THAN', t, 0.5), c, c2)
    mot = s.mr(s.noise(P, 0.35, 3), 0.3, 0.7, 1 - mottle, 1 + mottle)
    fine = s.mr(s.noise(P, 7.0, 6), 0.35, 0.65, 0.95, 1.04)
    v = s.math('MULTIPLY', mot, fine)
    nrm = None
    if corr:
        per, ax = corr
        u = {'x': xyz.outputs['X'], 'y': xyz.outputs['Y'], 'z': Z, 'xy': s.math('ADD', xyz.outputs['X'], xyz.outputs['Y'])}[ax]
        w = s.math('SINE', s.math('MULTIPLY', u, TAU / per))
        v = s.math('MULTIPLY', v, s.mr(w, -1, 1, 0.84, 1.05))
        nrm = s.bump(w, 0.35, 0.02)
    c = s.hsv(c, v=v)
    if seams:
        sm = s.lines(P, 1000.0, 0.01, lifts=seams, axes='')
        c = s.mix(s.math('MULTIPLY', sm, 0.6), c, (0.1, 0.09, 0.08))
    if grate:
        f1 = s.math('LESS_THAN', s.math('FRACT', s.math('DIVIDE', xyz.outputs['X'], grate[0])), 0.25)
        f2 = s.math('LESS_THAN', s.math('FRACT', s.math('DIVIDE', xyz.outputs['Y'], grate[1])), 0.14)
        top = s.mr(s.math('ABSOLUTE', s.nz()), 0.5, 0.6)
        hole = s.math('MULTIPLY', s.math('SUBTRACT', 1.0, s.math('MAXIMUM', f1, f2)), top)
        c = s.mix(hole, c, (0.025, 0.025, 0.022))
    ch = None
    if chips:
        e = s.edge(edge_r)
        brk = s.mr(s.noise(P, 5.0, 8, 0.6), 0.45, 0.62)
        spots = s.mr(s.noise(P, 14.0, 6, 0.62), 0.665, 0.70)
        ch = s.math('MULTIPLY', s.math('ADD', s.math('MULTIPLY', s.math('MULTIPLY', e, brk), 1.7), s.math('MULTIPLY', spots, 0.5)), chips, clamp=True)
        chipcol = s.mix(s.mr(s.noise(P, 25.0, 3), 0.35, 0.65), (0.19, 0.18, 0.17), (0.22, 0.11, 0.05))
        c = s.mix(ch, c, chipcol)
    rs = None
    if rust:
        st = s.mr(s.noise(s.scl(P, (3.0, 3.0, 0.14)), 1.3, 4), 0.54, 0.68)
        area = s.mr(s.noise(P, 0.3, 2), 0.36, 0.60)
        rs = s.math('MULTIPLY', s.math('MULTIPLY', st, area), rust * 0.8, clamp=True)
        c = s.mix(rs, c, (0.29, 0.12, 0.045))
    if grime:
        g = s.mr(s.ao(0.5), 0.25, 1.0, grime, 0.0)
        if ground: g = s.math('MAXIMUM', g, s.mr(Z, 0.0, 1.0, grime * 0.8, 0.0))
        g = s.math('MULTIPLY', g, s.mr(s.noise(P, 1.3, 4), 0.3, 0.7, 0.5, 1.0))
        c = s.mix(g, c, (0.11, 0.095, 0.07))
    if dust:
        du = s.math('MULTIPLY', s.mr(s.nz(), 0.3, 0.9), s.mr(s.noise(P, 2.0, 4), 0.35, 0.65, dust * 0.4, dust))
        c = s.mix(du, c, (0.42, 0.39, 0.34))
    if waterline is not None:
        band = s.mr(Z, waterline + 0.35, waterline - 0.05, 0.0, 0.9)
        c = s.mix(s.math('MULTIPLY', band, s.mr(s.noise(P, 4.0, 4), 0.3, 0.7, 0.6, 1.0)), c, (0.07, 0.09, 0.045))
    rr = rough
    if ch is not None: rr = s.math('ADD', rr, s.math('MULTIPLY', ch, 0.25))
    if rs is not None: rr = s.math('ADD', rr, s.math('MULTIPLY', rs, 0.3), clamp=True)
    if nrm is None: nrm = s.bump(s.noise(P, 40.0, 4), bump * 0.25, 0.003)
    return s.out(c, rr, metal, nrm)


def concrete(name, col=(0.50, 0.49, 0.46), joint=6.0, jw=0.012, lifts=None, stain=0.5, grime=0.45, damp_z=0.0, damp=0.5,
             rough=0.9, chips=0.15, moss=0.0, speck=0.35, axes='xy'):
    """Weathered concrete: blotchy cement colour, aggregate speckle, expansion/formwork joints, vertical rain stains,
    cavity grime, damp band near the base, pale chipped arrises and optional moss on upward faces."""
    if _got(name): return _got(name)
    s = NB(name); P = s.P(); Z = s.sep(P).outputs['Z']
    v = s.math('MULTIPLY', s.mr(s.noise(P, 0.18, 3), 0.3, 0.7, 0.84, 1.12), s.mr(s.noise(P, 1.2, 5), 0.3, 0.7, 0.92, 1.06))
    v = s.math('MULTIPLY', v, s.mr(s.noise(P, 18.0, 4), 0.3, 0.7, 0.95, 1.04))
    c = s.hsv(col, v=v)
    c = s.mix(s.mr(s.noise(P, 90.0, 2), 0.62, 0.68, 0.0, speck), c, (0.26, 0.25, 0.23))
    if joint:
        jm = s.lines(P, joint, jw, lifts, axes=axes)
        c = s.mix(s.math('MULTIPLY', jm, 0.85), c, (0.12, 0.115, 0.105))
    if stain:
        st = s.math('MULTIPLY', s.mr(s.noise(s.scl(P, (2.5, 2.5, 0.16)), 1.0, 4), 0.55, 0.76), s.mr(s.noise(P, 0.35, 2), 0.4, 0.65))
        c = s.mix(s.math('MULTIPLY', st, stain * 0.7), c, (0.20, 0.19, 0.16))
    if chips:
        ch = s.math('MULTIPLY', s.edge(0.05), s.mr(s.noise(P, 6.0, 6), 0.5, 0.62, 0.0, chips * 2.0), clamp=True)
        c = s.mix(ch, c, (0.66, 0.64, 0.6))
    if grime:
        g = s.math('MULTIPLY', s.mr(s.ao(0.8), 0.3, 1.0, grime, 0.0), s.mr(s.noise(P, 1.1, 4), 0.3, 0.7, 0.55, 1.0))
        c = s.mix(g, c, (0.13, 0.12, 0.10))
    if damp:
        d = s.math('MULTIPLY', s.mr(Z, damp_z + 0.7, damp_z, 0.0, damp), s.mr(s.noise(P, 1.6, 4), 0.3, 0.7, 0.5, 1.0))
        c = s.mix(d, c, (0.17, 0.18, 0.14))
    if moss:
        mo = s.math('MULTIPLY', s.mr(s.nz(), 0.5, 0.9), s.mr(s.noise(P, 1.5, 5), 0.5, 0.7, 0.0, moss))
        c = s.mix(mo, c, (0.16, 0.20, 0.08))
    return s.out(c, rough, 0.0, s.bump(s.noise(P, 30.0, 6), 0.12, 0.004))


def gravel(name, cols=((0.46, 0.44, 0.40), (0.33, 0.31, 0.29), (0.55, 0.50, 0.43), (0.42, 0.26, 0.17)), scale=26.0, damp_z=None):
    """Granular aggregate/ore: per-stone colour from Voronoi cells, dark crevices, AO, optional damp toe."""
    if _got(name): return _got(name)
    s = NB(name); P = s.P()
    vc = s.vor(P, scale); r = s.sep(vc.outputs['Color']).outputs['X']
    c = s.mix(s.math('GREATER_THAN', r, 0.35), cols[0], cols[1])
    c = s.mix(s.math('GREATER_THAN', r, 0.7), c, cols[2])
    c = s.mix(s.math('GREATER_THAN', r, 0.9), c, cols[3])
    c = s.hsv(c, v=s.mr(s.noise(P, 0.5, 3), 0.3, 0.7, 0.85, 1.1))
    ed = s.vor(P, scale, 'DISTANCE_TO_EDGE').outputs['Distance']
    c = s.mix(s.mr(ed, 0.12, 0.0, 0.0, 0.85), c, (0.06, 0.055, 0.05))
    c = s.mix(s.mr(s.ao(0.4), 0.3, 1.0, 0.5, 0.0), c, (0.08, 0.07, 0.06))
    if damp_z is not None:
        c = s.mix(s.mr(s.sep(P).outputs['Z'], damp_z + 0.6, damp_z, 0.0, 0.45), c, (0.13, 0.11, 0.09))
    h = s.math('SUBTRACT', 1.0, s.vor(P, scale).outputs['Distance'])
    return s.out(c, 0.92, 0.0, s.bump(h, 0.6, 0.03))


def rock(name, col=(0.35, 0.345, 0.33)):
    """Granite: domain-warped tonal blocks, thin irregular fractures, lichen and moss on upward faces, dark crevices."""
    if _got(name): return _got(name)
    s = NB(name); P = s.P()
    warp = s.n('ShaderNodeTexNoise', {'Vector': P, 'Scale': 0.35, 'Detail': 3}).outputs['Color']
    Pw = s.n('ShaderNodeVectorMath', (P, s.n('ShaderNodeVectorMath', (warp, (2.5, 2.5, 2.5)), operation='MULTIPLY').outputs[0]), operation='ADD').outputs[0]
    v = s.math('MULTIPLY', s.mr(s.noise(Pw, 0.12, 4), 0.3, 0.7, 0.72, 1.18), s.mr(s.noise(P, 2.5, 6), 0.3, 0.7, 0.88, 1.1))
    c = s.hsv(col, v=v)
    c = s.mix(s.mr(s.noise(P, 60.0, 2), 0.6, 0.7, 0.0, 0.45), c, (0.60, 0.58, 0.55))   # feldspar flecks
    cr = s.vor(s.scl(Pw, (1.0, 1.0, 1.5)), 0.16, 'DISTANCE_TO_EDGE').outputs['Distance']
    crk = s.math('MULTIPLY', s.mr(cr, 0.022, 0.0, 0.0, 0.85), s.mr(s.noise(P, 0.8, 3), 0.35, 0.6))
    c = s.mix(crk, c, (0.07, 0.065, 0.06))
    up = s.mr(s.nz(), 0.45, 0.85)
    c = s.mix(s.math('MULTIPLY', up, s.mr(s.noise(P, 0.9, 5), 0.5, 0.66, 0.0, 0.85)), c, (0.17, 0.21, 0.09))   # moss
    c = s.mix(s.mr(s.noise(P, 3.0, 4), 0.66, 0.70, 0.0, 0.55), c, (0.58, 0.58, 0.49))                           # pale lichen
    st = s.math('MULTIPLY', s.mr(s.noise(s.scl(P, (2.0, 2.0, 0.2)), 1.0, 3), 0.55, 0.75), 0.55)
    c = s.mix(st, c, (0.16, 0.15, 0.13))
    c = s.mix(s.mr(s.ao(1.5), 0.3, 1.0, 0.65, 0.0), c, (0.06, 0.055, 0.05))
    return s.out(c, 0.88, 0.0, s.bump(s.noise(Pw, 4.0, 8), 0.5, 0.06))


def water_mat(name='water_clarifier'):
    if _got(name): return _got(name)
    s = NB(name); P = s.P()
    c = s.mix(s.mr(s.noise(P, 0.25, 3), 0.4, 0.65), (0.035, 0.055, 0.045), (0.06, 0.075, 0.05))
    sc = s.mr(s.noise(P, 1.4, 6), 0.62, 0.72, 0.0, 0.5)   # floating scum
    c = s.mix(sc, c, (0.24, 0.22, 0.16))
    m = s.out(c, 0.05, 0.0, s.bump(s.noise(P, 3.0, 3), 0.08, 0.02))
    s.b.inputs['IOR'].default_value = 1.33
    return m


def solar_mat(name, slope):
    """PV module face: blue-black cells on a 0.166 m pitch with silver gaps; slope = unit vector up the panel."""
    if _got(name): return _got(name)
    s = NB(name); P = s.P(); xyz = s.sep(P)
    u = s.math('FRACT', s.math('DIVIDE', xyz.outputs['X'], 0.1665)); v = s.math('FRACT', s.math('DIVIDE', s.dot(P, slope), 0.1665))
    g = s.math('MAXIMUM', s.math('LESS_THAN', u, 0.05), s.math('LESS_THAN', v, 0.05))
    c = s.mix(s.mr(s.noise(P, 3.0, 3), 0.3, 0.7), (0.018, 0.03, 0.075), (0.03, 0.045, 0.10))
    c = s.mix(g, c, (0.30, 0.32, 0.36))
    bus = s.math('LESS_THAN', s.math('ABSOLUTE', s.math('SUBTRACT', u, 0.5)), 0.012)
    c = s.mix(bus, c, (0.35, 0.36, 0.38))
    c = s.mix(s.mr(s.noise(P, 0.6, 3), 0.4, 0.8, 0.0, 0.14), c, (0.38, 0.35, 0.3))  # light dust film
    return s.out(c, 0.12, 0.0)


def glass(name='GLASS', col=(0.045, 0.06, 0.07), rough=0.05):
    if _got(name): return _got(name)
    s = NB(name, bake=False)
    s.b.inputs['Base Color'].default_value = (*col, 1); s.b.inputs['Roughness'].default_value = rough
    s.b.inputs['Metallic'].default_value = 0.1; s.b.inputs['IOR'].default_value = 1.52
    return s.m


def glow(name, col, strength=6.0):
    if _got(name): return _got(name)
    s = NB(name, bake=False)
    s.b.inputs['Base Color'].default_value = (*col, 1); s.b.inputs['Emission Color'].default_value = (*col, 1)
    s.b.inputs['Emission Strength'].default_value = strength; s.b.inputs['Roughness'].default_value = 0.3
    return s.m


def chainlink_mat(name='CHAINLINK'):
    """Galvanised chain-link: tiling alpha texture (unbaked, exported with alpha clip)."""
    if _got(name): return _got(name)
    W = 64; img = bpy.data.images.new('chainlink_tile', W, W, alpha=True); px = [0.0] * (W * W * 4)
    for y in range(W):
        for x in range(W):
            # two diagonal wire families -> 50 mm diamonds (tile = 0.1 m = 2 diamonds)
            a = ((x + y) % 32); b = ((x - y) % 32)
            wire = min(a, 32 - a) < 1.6 or min(b, 32 - b) < 1.6
            i = (y * W + x) * 4; shade = 0.55 + 0.1 * ((x * 7 + y * 3) % 5) / 5
            px[i:i + 4] = [shade, shade, shade * 0.98, 1.0 if wire else 0.0]
    img.pixels = px; img.pack()
    s = NB(name, bake=False); t = s.n('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Closest'
    s.L.new(t.outputs['Color'], s.b.inputs['Base Color'])
    rnd = s.n('ShaderNodeMath', (t.outputs['Alpha'], 0.0), operation='ROUND')
    s.L.new(rnd.outputs[0], s.b.inputs['Alpha'])
    s.b.inputs['Metallic'].default_value = 0.6; s.b.inputs['Roughness'].default_value = 0.45
    try: s.m.blend_method = 'CLIP'
    except Exception: pass
    return s.m


# shared palette ------------------------------------------------------------------------------------------------------
def MP(key):
    """Common named materials (created on first use in the current file)."""
    if _got(key): return _got(key)
    R = {
        'paint_orange': lambda: paint(key, (0.58, 0.10, 0.03), rough=0.5, chips=0.35, rust=0.35),
        'paint_yellow': lambda: paint(key, (0.80, 0.52, 0.03), rough=0.5, chips=0.35, rust=0.3),
        'paint_yellow_worn': lambda: paint(key, (0.78, 0.50, 0.03), rough=0.55, chips=0.8, rust=0.55, grime=0.65, dust=0.4, edge_r=0.08),
        'paint_grey': lambda: paint(key, (0.40, 0.42, 0.43), rough=0.55, chips=0.25, rust=0.3),
        'paint_white': lambda: paint(key, (0.74, 0.75, 0.73), rough=0.5, chips=0.2, rust=0.35),
        'paint_dark': lambda: paint(key, (0.06, 0.06, 0.06), rough=0.6, chips=0.3, rust=0.3, dust=0.25),
        'paint_red': lambda: paint(key, (0.55, 0.05, 0.035), rough=0.5, chips=0.3, rust=0.25),
        'paint_green': lambda: paint(key, (0.04, 0.27, 0.10), rough=0.5, chips=0.3, rust=0.25),
        'paint_blue': lambda: paint(key, (0.10, 0.22, 0.38), rough=0.5, chips=0.2, rust=0.2),
        'hazard': lambda: paint(key, (0.80, 0.52, 0.03), rough=0.55, chips=0.4, rust=0.2, stripe=((0.025, 0.025, 0.025), 0.42)),
        'galv': lambda: paint(key, (0.50, 0.51, 0.50), rough=0.42, metal=0.55, chips=0.0, rust=0.15, mottle=0.2, grime=0.35),
        'galv_dark': lambda: paint(key, (0.33, 0.34, 0.33), rough=0.5, metal=0.5, chips=0.0, rust=0.25, mottle=0.2, grime=0.4),
        'grating': lambda: paint(key, (0.48, 0.49, 0.48), rough=0.5, metal=0.5, chips=0.0, rust=0.1, grime=0.3, grate=(0.034, 0.1)),
        'chrome': lambda: paint(key, (0.75, 0.76, 0.77), rough=0.15, metal=0.9, chips=0.0, rust=0.0, grime=0.3, mottle=0.05),
        'rubber': lambda: paint(key, (0.03, 0.03, 0.03), rough=0.85, chips=0.0, rust=0.0, grime=0.2, dust=0.3, mottle=0.2),
        'track': lambda: paint(key, (0.07, 0.065, 0.06), rough=0.7, metal=0.3, chips=0.4, rust=0.6, dust=0.55, corr=(0.19, 'x')),
        'concrete': lambda: concrete(key),
        'concrete_precast': lambda: concrete(key, col=(0.58, 0.57, 0.54), joint=0, stain=0.35, chips=0.3),
        'concrete_dark': lambda: concrete(key, col=(0.36, 0.355, 0.34), joint=0, stain=0.6, grime=0.6),
        'asphalt': lambda: concrete(key, col=(0.10, 0.10, 0.10), joint=0, stain=0.2, chips=0.0, speck=0.6, rough=0.85),
        'GLASS': lambda: glass('GLASS'),
        'GLASS_cab': lambda: glass('GLASS_cab', (0.06, 0.08, 0.09), 0.08),
        'GLOW_lamp': lambda: glow('GLOW_lamp', (1.0, 0.86, 0.62), 6.0),
        'GLOW_red': lambda: glow('GLOW_red', (1.0, 0.05, 0.02), 12.0),
        'GLOW_green': lambda: glow('GLOW_green', (0.05, 1.0, 0.2), 12.0),
        'gravel': lambda: gravel(key),
        'ore': lambda: gravel(key, ((0.40, 0.30, 0.24), (0.29, 0.22, 0.18), (0.52, 0.42, 0.33), (0.45, 0.24, 0.12)), damp_z=0.0),
    }
    return R[key]()


# ════════════════════════════════════════════════════════════════════ geometry
def _rot(rot):
    if rot is None: return Matrix.Identity(4)
    if isinstance(rot, Matrix): return rot.to_4x4()
    return Euler(rot).to_matrix().to_4x4()


def _area(pts):
    n = len(pts); return 0.5 * sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))


class G:
    """Accumulates primitives into one bmesh with per-face material slots; .obj() turns it into an object."""
    def __init__(s, name):
        s.name, s.bm, s.mats = name, bmesh.new(), []

    def _fin(s, verts, m, smooth=False):
        if m not in s.mats: s.mats.append(m)
        i = s.mats.index(m); fs = list({f for v in verts for f in v.link_faces})
        for f in fs: f.material_index = i; f.smooth = smooth
        return fs

    def box(s, m, c, size, rot=None):
        M = Matrix.Translation(V(c)) @ _rot(rot) @ Matrix.Diagonal((*size, 1.0))
        return s._fin(bmesh.ops.create_cube(s.bm, size=1.0, matrix=M)['verts'], m)

    def bb(s, m, a, b):
        lo = V([min(a[i], b[i]) for i in range(3)]); hi = V([max(a[i], b[i]) for i in range(3)])
        if min(hi - lo) < 1e-5: return []
        return s.box(m, (lo + hi) / 2, hi - lo)

    def cyl(s, m, p0, p1, r, n=12, r2=None, caps=True, smooth=None):
        p0, p1 = V(p0), V(p1); d = p1 - p0
        M = Matrix.Translation((p0 + p1) / 2) @ d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        vs = bmesh.ops.create_cone(s.bm, cap_ends=caps, cap_tris=False, segments=n, radius1=r, radius2=(r if r2 is None else r2), depth=d.length, matrix=M)['verts']
        sm = (n >= 8) if smooth is None else smooth
        fs = s._fin(vs, m, sm)
        if sm:
            for f in fs:
                if len(f.verts) > 4 or (n == 4): f.smooth = False
        return fs

    def beam(s, m, p0, p1, w, h=None, up=(0, 0, 1)):
        p0, p1 = V(p0), V(p1); x = p1 - p0; L = x.length; x.normalize(); u = V(up)
        if abs(u.dot(x)) > 0.98: u = V((1, 0, 0)) if abs(x.x) < 0.9 else V((0, 1, 0))
        z = (u - x * u.dot(x)).normalized(); y = z.cross(x)
        R = Matrix((x, y, z)).transposed().to_4x4()
        M = Matrix.Translation((p0 + p1) / 2) @ R @ Matrix.Diagonal((L, w, h or w, 1.0))
        return s._fin(bmesh.ops.create_cube(s.bm, size=1.0, matrix=M)['verts'], m)

    def hexa(s, m, pts):
        """8 corners: bottom 4 then the 4 above them (any winding)."""
        P = [V(p) for p in pts]
        if _area([(p.x, p.y) for p in P[:4]]) < 0: P = [P[0], P[3], P[2], P[1], P[4], P[7], P[6], P[5]]
        vs = [s.bm.verts.new(p) for p in P]; F = s.bm.faces.new
        F((vs[3], vs[2], vs[1], vs[0])); F((vs[4], vs[5], vs[6], vs[7]))
        for i in range(4):
            j = (i + 1) % 4; F((vs[i], vs[j], vs[j + 4], vs[i + 4]))
        return s._fin(vs, m)

    def prism(s, m, pts, z0, z1, M=None, smooth=False):
        if _area(pts) < 0: pts = pts[::-1]
        bot = [s.bm.verts.new((x, y, z0)) for x, y in pts]; top = [s.bm.verts.new((x, y, z1)) for x, y in pts]
        fs = [s.bm.faces.new(bot[::-1]), s.bm.faces.new(top)]; n = len(pts)
        for i in range(n):
            j = (i + 1) % n; fs.append(s.bm.faces.new((bot[i], bot[j], top[j], top[i])))
        if M is not None:
            bmesh.ops.transform(s.bm, matrix=M, verts=bot + top)
            if M.to_3x3().determinant() < 0: bmesh.ops.reverse_faces(s.bm, faces=fs)
        return s._fin(bot + top, m, smooth)

    def ext(s, m, pts, axis, a0, a1, smooth=False):
        """Extrude a 2D outline along an axis: 'x' takes (y, z) points, 'y' takes (x, z), 'z' takes (x, y)."""
        P = {'x': Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))),
             'y': Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))), 'z': Matrix.Identity(4)}[axis]
        return s.prism(m, pts, a0, a1, P, smooth)

    def lathe(s, m, prof, n=16, M=None, smooth=True, caps=True, closed=False, recalc=True):
        angs = [TAU * i / n for i in range(n)]; rings = []; vs = []
        for r, z in prof:
            ring = [s.bm.verts.new((0, 0, z))] if r < 1e-7 else [s.bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in angs]
            rings.append(ring); vs += ring
        pairs = list(zip(rings[:-1], rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
        fs = []
        for A, B in pairs:
            for i in range(n):
                j = (i + 1) % n
                if len(A) == 1 and len(B) == 1: continue
                if len(A) == 1: fs.append(s.bm.faces.new((A[0], B[i], B[j])[::-1]))
                elif len(B) == 1: fs.append(s.bm.faces.new((A[i], A[j], B[0])))
                else: fs.append(s.bm.faces.new((A[i], A[j], B[j], B[i])))
        if caps and not closed:
            if len(rings[0]) > 1: fs.append(s.bm.faces.new(rings[0][::-1]))
            if len(rings[-1]) > 1: fs.append(s.bm.faces.new(rings[-1]))
        if recalc and (caps or closed): bmesh.ops.recalc_face_normals(s.bm, faces=fs)
        if M is not None: bmesh.ops.transform(s.bm, matrix=M, verts=vs)
        out = s._fin(vs, m, smooth)
        if smooth:
            for f in out:
                if len(f.verts) > 4: f.smooth = False
        return out

    def torus(s, m, c, R, r, n1=24, n2=8, axis=(0, 0, 1), smooth=True, stretch=None):
        prof = [(R + r * math.cos(TAU * k / n2), r * math.sin(TAU * k / n2)) for k in range(n2)]
        M = Matrix.Translation(V(c)) @ V(axis).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        if stretch: M = M @ Matrix.Diagonal((stretch, 1.0, 1.0, 1.0))
        return s.lathe(m, prof, n1, M, smooth, closed=True)

    def sphere(s, m, c, r, seg=16, rings=8, scale=(1, 1, 1)):
        M = Matrix.Translation(V(c)) @ Matrix.Diagonal((*scale, 1.0))
        return s._fin(bmesh.ops.create_uvsphere(s.bm, u_segments=seg, v_segments=rings, radius=r, matrix=M)['verts'], m, True)

    def poly(s, m, pts):
        vs = [s.bm.verts.new(p) for p in pts]; s.bm.faces.new(vs); return s._fin(vs, m)

    # composite helpers ---------------------------------------------------------------------------------------------
    def rail(s, m, pts, h=1.1, post=1.6, r=0.024, mid=True, toe=0.0, n=6, ends=True):
        """Handrail along a polyline of 3D floor points: posts, top rail, knee rail, optional toe board."""
        pts = [V(p) for p in pts]; zh = V((0, 0, h))
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]; L = (b - a).length; k = max(1, round(L / post))
            for t in range(0 if i == 0 else 1, k + 1):
                if not ends and ((i == 0 and t == 0) or (i == len(pts) - 2 and t == k)): continue
                p = a.lerp(b, t / k); s.cyl(m, p, p + zh, r * 1.2, n, smooth=False)
            s.cyl(m, a + zh, b + zh, r, n, smooth=False)
            if mid: s.cyl(m, a + zh * 0.5, b + zh * 0.5, r * 0.8, n, smooth=False)
            if toe: s.beam(m, a + V((0, 0, toe / 2)), b + V((0, 0, toe / 2)), 0.01, toe)

    def ladder(s, m, p0, z1, out=(0, -1, 0), w=0.45, step=0.3, cage=False):
        p0 = V(p0); o = V(out).normalized(); side = V((0, 0, 1)).cross(o).normalized(); base = p0 + o * 0.18
        for sg in (-1, 1):
            q = base + side * (w / 2 * sg); s.beam(m, q, V((q.x, q.y, z1)), 0.06, 0.015, up=o)
        k = int((z1 - p0.z - 0.2) / step)
        for i in range(k + 1):
            z = p0.z + 0.25 + i * step; c = V((base.x, base.y, z))
            s.cyl(m, c - side * w / 2, c + side * w / 2, 0.012, 4, smooth=False)
        if cage:
            zc = p0.z + 2.4
            while zc < z1:
                c = base + o * 0.35
                pts = [c + side * 0.37 * math.cos(a) + o * 0.37 * math.sin(a) for a in [math.pi * i / 6 for i in range(7)]]
                for a, b in zip(pts[:-1], pts[1:]): s.beam(m, V((a.x, a.y, zc)), V((b.x, b.y, zc)), 0.05, 0.008)
                zc += 1.2
            for a in (0.2, 0.5, 0.8):
                ang = math.pi * a; c = base + o * 0.35 + side * 0.37 * math.cos(ang) + o * 0.37 * math.sin(ang)
                s.beam(m, V((c.x, c.y, p0.z + 2.4)), V((c.x, c.y, z1)), 0.04, 0.008, up=o)

    def stairs(s, m, p0, p1, w=0.9, tread=0.27, mstr=None):
        """Straight stair from p0 (bottom nosing centre) to p1 (top landing centre)."""
        p0, p1 = V(p0), V(p1); d = p1 - p0; hz = V((d.x, d.y, 0)); run = hz.length; hz.normalize()
        side = V((0, 0, 1)).cross(hz).normalized(); k = max(2, round(d.z / 0.19))
        for i in range(k):
            c = p0 + hz * (run * (i + 0.5) / k) + V((0, 0, d.z * (i + 1) / k - 0.02))
            s.beam(m, c - hz * tread / 2, c + hz * tread / 2, w, 0.04)
        for sg in (-1, 1):
            o = side * (w / 2 + 0.03) * sg; s.beam(mstr or m, p0 + o, p1 + o, 0.2, 0.05, up=side.cross(d.normalized()))

    def wall(s, m, axis, c, t, a0, a1, z0, z1, holes=()):
        """Wall along X (axis 'x', at y=c) or along Y (axis 'y', at x=c), thickness t, with rectangular openings
        holes = [(a_lo, a_hi, z_lo, z_hi)] (non-overlapping along a). Built from boxes; returns nothing."""
        def B(alo, ahi, zlo, zhi):
            if ahi - alo < 1e-4 or zhi - zlo < 1e-4: return
            if axis == 'x': s.bb(m, (alo, c - t / 2, zlo), (ahi, c + t / 2, zhi))
            else: s.bb(m, (c - t / 2, alo, zlo), (c + t / 2, ahi, zhi))
        a = a0
        for (lo, hi, zl, zh) in sorted(holes):
            B(a, lo, z0, z1); B(lo, hi, z0, zl); B(lo, hi, zh, z1); a = hi
        B(a, a1, z0, z1)

    def obj(s, name=None, pivot=None, coll=None):
        bm = s.bm; bm.normal_update()
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) == 2:
                a, b = lf
                if a.smooth != b.smooth or (a.smooth and a.normal.angle(b.normal, 0.0) > math.radians(48)): e.smooth = False
        me = bpy.data.meshes.new(name or s.name); bm.to_mesh(me); bm.free()
        for mt in s.mats: me.materials.append(mt)
        o = bpy.data.objects.new(name or s.name, me); (coll or CUR.coll).objects.link(o)
        if pivot is not None:
            me.transform(Matrix.Translation(-V(pivot))); o.location = V(pivot)
        return o


def arc(c, r, a0, a1, n, z=None):
    pts = [(c[0] + r * math.cos(a0 + (a1 - a0) * i / n), c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    return pts if z is None else [(x, y, z) for x, y in pts]


def ring_pts(r, n, z, c=(0, 0)):
    return [(c[0] + r * math.cos(TAU * i / n), c[1] + r * math.sin(TAU * i / n), z) for i in range(n + 1)]


# ════════════════════════════════════════════════════════════════════ pipeline
REG = {}


def asset(name, group):
    def deco(fn): REG[name] = (fn, group); return fn
    return deco


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(4101)


def mesh_objs(coll):
    return [o for o in coll.all_objects if o.type == 'MESH']


def measure(objs, include_excluded=False):
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    mn = V((1e9,) * 3); mx = V((-1e9,) * 3); tri = 0; excl = []
    for o in objs:
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        tri += sum(len(p.vertices) - 2 for p in me.polygons)
        if o.get('exclude_bounds') and not include_excluded: excl.append(o.name); oe.to_mesh_clear(); continue
        M = o.matrix_world
        for v in me.vertices:
            w = M @ v.co
            for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
        oe.to_mesh_clear()
    return mn, mx, tri, excl


def grid_mat():
    s = NB('_grid', bake=False); P = s.P(); xyz = s.sep(P)
    def ln(sp, w):
        o = None
        for a in ('X', 'Y'):
            f = s.math('FRACT', s.math('ADD', s.math('DIVIDE', xyz.outputs[a], sp), 0.5))
            d = s.math('MULTIPLY', s.math('ABSOLUTE', s.math('SUBTRACT', f, 0.5)), sp)
            m = s.math('LESS_THAN', d, w); o = m if o is None else s.math('MAXIMUM', o, m)
        return o
    c = s.hsv((0.36, 0.36, 0.34), v=s.mr(s.noise(P, 0.3, 3), 0.3, 0.7, 0.9, 1.08))
    c = s.mix(s.math('MULTIPLY', ln(1.0, 0.012), 0.7), c, (0.62, 0.62, 0.6))
    c = s.mix(ln(10.0, 0.05), c, (0.85, 0.55, 0.12))
    return s.out(c, 0.85)


def figure(x, y, z, coll):
    g = G('_figure')
    vest = paint('_fig_vest', (0.95, 0.32, 0.02), chips=0, rust=0, grime=0.1, ground=False)
    dark = paint('_fig_dark', (0.05, 0.06, 0.08), chips=0, rust=0, grime=0.1, ground=False)
    skin = paint('_fig_skin', (0.55, 0.38, 0.28), chips=0, rust=0, grime=0, ground=False)
    hat = paint('_fig_hat', (0.85, 0.85, 0.82), chips=0, rust=0, grime=0, ground=False)
    for sy in (-1, 1):
        g.bb(dark, (x - 0.08, y + sy * 0.1 - 0.06, z), (x + 0.18, y + sy * 0.1 + 0.06, z + 0.08))
        g.cyl(dark, (x, y + sy * 0.1, z + 0.07), (x, y + sy * 0.1, z + 0.9), 0.07, 8)
        g.cyl(vest, (x, y + sy * 0.25, z + 1.42), (x + 0.04, y + sy * 0.27, z + 0.84), 0.05, 8)
    g.box(dark, (x, y, z + 0.94), (0.22, 0.34, 0.14))
    g.box(vest, (x, y, z + 1.2), (0.25, 0.42, 0.5))
    g.cyl(skin, (x, y, z + 1.45), (x, y, z + 1.54), 0.05, 8)
    g.sphere(skin, (x, y, z + 1.62), 0.11, 12, 8)
    g.sphere(hat, (x, y, z + 1.696), 0.13, 12, 8, scale=(1, 1, 0.8))
    g.cyl(hat, (x, y, z + 1.68), (x, y, z + 1.70), 0.155, 12)
    return g.obj('_figure', coll=coll)


def render_preview(name, objs, path, pv):
    sc = bpy.context.scene
    pc = bpy.data.collections.new('_preview'); sc.collection.children.link(pc)
    mn, mx, _, _ = measure(objs, include_excluded=True)
    gz = pv.get('ground', 0.0)
    fx, fy = pv.get('fig', (mn.x - 1.0, mn.y - 0.8))
    figure(fx, fy, pv.get('fig_z', gz), pc)
    ext = max(mx.x - mn.x, mx.y - mn.y, 10.0)
    gs = ext * 4 + 40
    gp = G('_ground'); gm = pv.get('ground_mat') or grid_mat()
    gp.bb(gm, (-gs / 2 + (mn.x + mx.x) / 2, -gs / 2 + (mn.y + mx.y) / 2, gz - 0.05), (gs / 2 + (mn.x + mx.x) / 2, gs / 2 + (mn.y + mx.y) / 2, gz))
    if pv.get('quay'):
        q = pv['quay']; gp.bb(concrete('_quay'), q[0], q[1])
    for q in pv.get('boxes', []): gp.bb(concrete('_quay'), q[0], q[1])
    gp.obj('_ground', coll=pc)
    mn2 = V((min(mn.x, fx - 0.4), min(mn.y, fy - 0.4), min(mn.z, gz))); mx2 = V((max(mx.x, fx + 0.4), max(mx.y, fy + 0.4), max(mx.z, gz + 1.8)))
    c = (mn2 + mx2) / 2
    if 'target' in pv: c = V(pv['target'])
    W, H = 800, 600
    sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = pv.get('samples', 32)
    sc.cycles.use_denoising = True
    try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    sc.cycles.max_bounces = 4; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 2; sc.cycles.transparent_max_bounces = 8
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    sc.render.resolution_x = W; sc.render.resolution_y = H; sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('_w'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.50, 0.60, 0.75, 1); bg.inputs[1].default_value = 0.85
    cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam')); pc.objects.link(cam); sc.camera = cam
    cam.data.lens = 50; cam.data.sensor_width = 36; cam.data.clip_end = 5000
    e = math.radians(pv.get('elev', 26)); a = math.radians(pv.get('azim', -58))
    fwd = -V((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    R = cam.rotation_euler.to_matrix(); right = R.col[0]; up = R.col[1]
    th = math.tan(math.atan(18 / 50)) * 0.92; tv = th * H / W
    d = 0.0
    for i in range(8):
        p = V((mn2.x if i & 1 else mx2.x, mn2.y if i & 2 else mx2.y, mn2.z if i & 4 else mx2.z)) - c
        d = max(d, p.dot(fwd) + abs(p.dot(right)) / th, p.dot(fwd) + abs(p.dot(up)) / tv)
    d *= pv.get('zoom', 1.0)
    cam.location = c - fwd * d
    sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN')); pc.objects.link(sun)
    sun.data.energy = 4.0; sun.data.angle = math.radians(3); sun.data.color = (1.0, 0.96, 0.9)
    sun.rotation_euler = V((-0.45, -0.55, 0.70)).to_track_quat('Z', 'Y').to_euler()  # sun in the south-west, high
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in list(pc.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(pc)


def chunk_uvs(objs, size):
    """Atlas UVs for baking: every face is projected along its dominant axis in metres; faces are grouped by
    (axis, normal sign, spatial cell) into islands so long members are cut into chunks, then all islands of all
    objects are packed together. Keeps texel density even (smart_project wastes the atlas on long thin parts)."""
    mn, mx, _, _ = measure(objs, include_excluded=True)
    cell = max(0.6, max(mx - mn) / 10.0)
    for o in objs:
        me = o.data
        if not me.uv_layers: me.uv_layers.new(name='UVMap')
        bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap')
        M = o.matrix_world; bm.normal_update(); groups = {}
        for f in bm.faces:
            n = f.normal; ax = max(range(3), key=lambda i: abs(n[i])); sg = 1 if n[ax] >= 0 else 0
            c = M @ f.calc_center_median()
            key = (ax, sg, math.floor(c.x / cell), math.floor(c.y / cell), math.floor(c.z / cell))
            ua, va = ((1, 2), (0, 2), (0, 1))[ax]
            for l in f.loops:
                w = M @ l.vert.co; l[uvl].uv = (w[ua] * (1 if sg else -1), w[va])
            groups.setdefault(key, []).append(f)
        for key, fs in groups.items():
            # cap each island's aspect ratio at 6:1 (long single faces would otherwise starve the atlas), then
            # offset it so islands never share UVs and pack_islands treats them separately
            us = [l[uvl].uv[0] for f in fs for l in f.loops]; vs = [l[uvl].uv[1] for f in fs for l in f.loops]
            u0, v0 = min(us), min(vs); du, dv = max(us) - u0 + 1e-6, max(vs) - v0 + 1e-6
            su = min(1.0, 6.0 * dv / du); sv = min(1.0, 6.0 * du / dv)
            off = (hash(key) % 1009) * 41.0
            for f in fs:
                for l in f.loops:
                    u, v = l[uvl].uv; l[uvl].uv = ((u - u0) * su + off, (v - v0) * sv + off * 0.37)
        bm.to_mesh(me); bm.free()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    ts = bpy.context.scene.tool_settings; ts.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=6.0 / size, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_atlas(objs, name, size=1024, samples=8):
    """lib.bake_atlas with chunk_uvs instead of smart_project: bakes the colour of every 'bake' material into one
    atlas and swaps those materials for a single textured material; GLASS/GLOW/TEAM stay as they are."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; use_gpu(sc); sc.cycles.samples = samples; sc.cycles.use_denoising = False
    sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True; sc.render.bake.margin = 4
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    img = bpy.data.images.new(name, size, size); img.colorspace_settings.name = 'sRGB'
    dummy = bpy.data.images.new('_dummy', 8, 8); done = set()
    for o in objs:
        for m in o.data.materials:
            if not m or m.name in done: continue
            t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img if m.get('bake') else dummy; m.node_tree.nodes.active = t; done.add(m.name)
    chunk_uvs(objs, size)
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=4)
    img.pack()
    out = bpy.data.materials.new(name + '_mat'); out.use_nodes = True; N = out.node_tree.nodes; b = N['Principled BSDF']
    t = N.new('ShaderNodeTexImage'); t.image = img; out.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    bm_ = [m for o in objs for m in o.data.materials if m and m.get('bake')]
    def avg(k):
        vals = [m.node_tree.nodes['Principled BSDF'].inputs[k].default_value for m in bm_ if not m.node_tree.nodes['Principled BSDF'].inputs[k].is_linked]
        return sum(vals) / len(vals) if vals else 0.5
    b.inputs['Roughness'].default_value = min(0.9, max(0.3, avg('Roughness'))); b.inputs['Metallic'].default_value = min(0.3, avg('Metallic'))
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if m and m.get('bake'): o.data.materials[i] = out
    return img


def bake_export(name, coll, size):
    objs = mesh_objs(coll)
    bobjs = [o for o in objs if any(m and m.get('bake') for m in o.data.materials)]
    if bobjs: bake_atlas(bobjs, name + '_atlas', size=size, samples=8)
    alpha = False
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if m and m.name == 'TEAM_ACCENT': m.name = 'TEAM'
            if m and m.name.startswith('CHAINLINK'): alpha = True
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in coll.all_objects: o.select_set(True)
    path = os.path.join(DIRS['glb'], name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='AUTO' if alpha else 'JPEG', export_jpeg_quality=86, export_animations=False, export_extras=True)
    return path


BUDGET = {'small': 2000, 'unit': 15000, 'building': 25000}


def run(name, glb=False, do_preview=True):
    t0 = time.time(); reset()
    sc = bpy.context.scene; sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
    coll = bpy.data.collections.new(name); sc.collection.children.link(coll); CUR.coll = coll
    info = REG[name][0]() or {}
    objs = mesh_objs(coll)
    mn, mx, tri, excl = measure(objs)
    size = [round(mx[i] - mn[i], 3) for i in range(3)]
    spec = info.get('spec')
    if spec:
        bad = [i for i in range(3) if spec[i] and abs(size[i] - spec[i]) > 0.01 * spec[i] + 1e-3]
        if bad: print(f'!! {name}: measured {size} vs spec {spec} (axes {bad} off by >1%)')
    budget = info.get('budget', 'small')
    if tri > BUDGET[budget]: print(f'!! {name}: {tri} tris over {budget} budget {BUDGET[budget]}')
    rec = {'name': name, 'size_m': size, 'min': [round(v, 3) for v in mn], 'max': [round(v, 3) for v in mx],
           'spec_m': spec, 'tris': tri, 'excluded': excl,
           'notes': info.get('notes', '') + f' Budget class: {budget} (<= {BUDGET[budget]} tris).',
           'group': REG[name][1], 'objects': sorted(o.name for o in objs)}
    if 'doors' in info: rec['doors'] = info['doors']
    for k in ('pivots', 'nodes'):
        if k in info: rec[k] = info[k]
    with open(os.path.join(DIRS['bounds'], name + '.json'), 'w') as f: json.dump(rec, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DIRS['blend'], name + '.blend'), compress=True)
    t1 = time.time()
    if do_preview: render_preview(name, objs, os.path.join(DIRS['preview'], name + '.png'), info.get('pv', {}))
    t2 = time.time()
    if glb: bake_export(name, coll, info.get('atlas', 1024))
    print(f'== {name}: size {size} tris {tri} | build {t1 - t0:.1f}s preview {t2 - t1:.1f}s glb {time.time() - t2:.1f}s')
    return rec


# ════════════════════════════════════════════════════════════════════ 1. PORT
@asset('prop_gantry_crane', 'port')
def gantry_crane():
    """Ship-to-shore container crane. Rails run along X (gauge 30 m, rails at y=+-15), waterside is -Y; the 60 m boom
    reaches seaward from the waterside rail to y=-75, backreach to y=+30. Origin: rail-top level, midway between rails."""
    o = MP('paint_orange'); dk = MP('paint_dark'); gv = MP('galv'); gr = MP('grating'); hz = MP('hazard'); yl = MP('paint_yellow')
    wh = paint('paint_white_house', (0.70, 0.71, 0.69), chips=0.2, rust=0.4, corr=(0.25, 'xy'))
    G1 = G('crane_structure'); g = G1
    lx, gy = 9.0, 15.0
    # sill beams, bogies and wheels
    for sy in (-1, 1):
        y = sy * gy
        g.bb(o, (-13.5, y - 0.75, 2.3), (13.5, y + 0.75, 3.7))
        for sx in (-1, 1):
            g.bb(o, (sx * 7.0, y - 0.55, 1.05), (sx * 13.0, y + 0.55, 2.3))
            g.bb(hz, (sx * 7.0 - 0.01 * sx, y - 0.56, 2.0), (sx * 13.0 + 0.01 * sx, y + 0.56, 2.3))
            for k in range(4):
                xw = sx * (7.75 + k * 1.5)
                g.bb(dk, (xw - 0.6, y - 0.45, 0.5), (xw + 0.6, y + 0.45, 1.05))
                g.cyl(dk, (xw, y - 0.4, 0.45), (xw, y + 0.4, 0.45), 0.45, 12)
            g.bb(yl, (sx * 13.0, y - 0.5, 0.6), (sx * 13.5, y + 0.5, 1.6))  # buffers
        # legs
        for sx in (-1, 1):
            x = sx * lx
            g.bb(o, (x - 0.8, y - 0.8, 3.7), (x + 0.8, y + 0.8, 36.0))
            g.bb(hz, (x - 0.82, y - 0.82, 3.7), (x + 0.82, y + 0.82, 6.2))
        # top cross beam along X
        g.bb(o, (-lx - 0.78, y - 0.7, 34.4), (lx + 0.78, y + 0.7, 35.98))
    # portal beams (along Y) and landside sway bracing
    for sx in (-1, 1):
        x = sx * lx
        g.bb(o, (x - 0.6, -gy, 13.0), (x + 0.6, gy, 14.8))
    g.beam(o, (-lx, gy, 15.0), (lx, gy, 34.2), 0.7, 0.7, up=(0, 1, 0))
    g.beam(o, (lx, gy, 15.0), (-lx, gy, 34.2), 0.7, 0.7, up=(0, 1, 0))
    # girders (backreach) and boom (seaward)
    for sx in (-1, 1):
        x = sx * 4.0
        g.bb(o, (x - 0.55, -gy - 1.0, 36.0), (x + 0.55, 30.0, 38.4))
        g.hexa(o, [(x - 0.55, -75.0, 36.0), (x + 0.55, -75.0, 36.0), (x + 0.55, -gy - 1.0, 36.0), (x - 0.55, -gy - 1.0, 36.0),
                   (x - 0.55, -75.0, 37.2), (x + 0.55, -75.0, 37.2), (x + 0.55, -gy - 1.0, 38.4), (x - 0.55, -gy - 1.0, 38.4)])
        g.cyl(dk, (x - 0.7, -gy - 1.0, 37.2), (x + 0.7, -gy - 1.0, 37.2), 0.35, 10)  # boom hinge
        g.bb(gv, (x - 0.3, -74.0, 35.85), (x + 0.3, 29.0, 36.0))  # cable tray under girder
        g.ext(o, [(-gy, 36.2), (-gy - 1.0, 38.4), (-gy - 0.0, 38.4)], 'x', x - 0.6, x + 0.6)
    for yy in [-72.0 + 7.5 * i for i in range(14)]:
        g.bb(o, (-3.5, yy - 0.3, 36.0), (3.5, yy + 0.3, 36.6))
    g.bb(o, (-4.6, -75.3, 35.9), (4.6, -74.8, 37.3))  # boom tip
    # walkways with handrails on the outside of both girders
    for sx in (-1, 1):
        x0 = sx * 4.55; x1 = sx * 5.5
        g.bb(gr, (min(x0, x1), -74.5, 35.9), (max(x0, x1), 29.5, 36.0))
        g.rail(MP('paint_yellow'), [(x1, -74.5, 36.0), (x1, 29.5, 36.0)], post=2.5, n=4)
    # A-frame: front legs, back stays, apex beam
    for sx in (-1, 1):
        g.beam(o, (sx * lx, -gy, 36.0), (sx * 6.5, -11.5, 48.8), 1.1, 1.1, up=(0, 1, 0))
        g.beam(o, (sx * lx, gy, 36.0), (sx * 6.5, -10.5, 48.8), 0.9, 0.9, up=(0, 1, 0))
        g.beam(o, (sx * 4.0, -gy - 1.0, 38.4), (sx * 6.5, -11.3, 48.6), 0.7, 0.7, up=(0, 1, 0))
        # forestays
        for yb, zb in ((-45.0, 37.75), (-74.6, 37.2)):
            g.cyl(gv, (sx * 6.5, -11.8, 48.9), (sx * 4.0, yb, zb), 0.11, 6, smooth=False)
    g.bb(o, (-7.4, -12.4, 48.4), (7.4, -9.6, 49.6))
    g.cyl(MP('galv'), (0, -11.0, 49.6), (0, -11.0, 49.85), 0.08, 6)
    # machinery house on the backreach
    g.bb(wh, (-6.0, 18.0, 38.4), (6.0, 29.6, 42.8))
    g.bb(MP('paint_grey'), (-6.2, 17.8, 42.8), (6.2, 29.8, 43.1))
    g.bb(dk, (-1.0, 17.95, 38.6), (0.2, 18.0, 40.8))  # door
    for k in range(4): g.bb(MP('GLASS'), (-5.0 + k * 3.0, 17.95, 41.2), (-3.6 + k * 3.0, 18.0, 42.0))
    g.rail(MP('paint_yellow'), [(-6.0, 29.6, 43.1), (6.0, 29.6, 43.1), (6.0, 17.9, 43.1)], post=2.0, n=4)
    # landside platform at portal-beam level + ladder up a landside leg (caged)
    g.bb(gr, (-lx + 0.8, gy - 0.9, 14.8), (lx - 0.8, gy + 0.9, 14.95))
    g.rail(MP('paint_yellow'), [(-lx + 0.8, gy + 0.9, 14.95), (lx - 0.8, gy + 0.9, 14.95)], post=1.8, n=4)
    g.ladder(gv, (lx + 0.8, gy, 3.7), 34.4, out=(1, 0, 0), step=0.35, cage=True)
    g.ladder(gv, (-lx - 0.8, -gy, 3.7), 34.4, out=(-1, 0, 0), step=0.35, cage=True)
    # cable reel on the landside sill
    g.cyl(yl, (-1.0, gy + 2.0, 4.6), (1.0, gy + 2.0, 4.6), 2.2, 20)
    g.cyl(dk, (-0.8, gy + 2.0, 4.6), (0.8, gy + 2.0, 4.6), 2.25, 20)
    g.bb(o, (-1.3, gy + 0.75, 2.5), (1.3, gy + 2.0, 3.9))
    # floodlights under the boom and girders
    for yy in (-60.0, -40.0, -20.0, 0.0, 20.0):
        for sx in (-1, 1):
            g.bb(dk, (sx * 4.0 - 0.3, yy - 0.2, 35.55), (sx * 4.0 + 0.3, yy + 0.2, 35.85))
            g.bb(MP('GLOW_lamp'), (sx * 4.0 - 0.25, yy - 0.15, 35.5), (sx * 4.0 + 0.25, yy + 0.15, 35.56))
    g.sphere(MP('GLOW_red'), (0, -11.0, 49.9), 0.1, 8, 4)
    crane = g.obj('crane_structure')
    # trolley, operator cab, hoist ropes, headblock and 40 ft spreader
    t = G('trolley'); ty = -34.0
    t.bb(MP('paint_grey'), (-4.6, ty - 3.0, 38.4), (4.6, ty + 3.0, 39.6))
    t.bb(dk, (-3.6, ty - 2.4, 37.2), (3.6, ty + 2.4, 38.4))
    t.bb(MP('paint_white'), (0.8, ty - 1.4, 33.6), (3.4, ty + 1.4, 36.2))
    t.bb(MP('GLASS'), (0.75, ty - 1.35, 33.9), (3.45, ty - 1.3, 35.9))
    t.bb(MP('GLASS'), (0.75, ty + 1.3, 33.9), (3.45, ty + 1.35, 35.9))
    t.bb(MP('GLASS'), (0.75, ty - 1.2, 33.4), (3.45, ty + 1.2, 33.6))
    t.beam(dk, (2.1, ty, 36.2), (2.1, ty, 37.2), 0.5)
    for sx in (-1, 1):
        for sy in (-1, 1):
            t.cyl(dk, (sx * 1.6, ty + sy * 0.9, 37.2), (sx * 1.6, ty + sy * 0.9, 23.2), 0.035, 4, smooth=False)
    t.bb(dk, (-2.0, ty - 1.1, 22.6), (2.0, ty + 1.1, 23.2))
    t.bb(yl, (-6.1, ty - 1.22, 21.9), (6.1, ty + 1.22, 22.5))
    for sx in (-1, 1):
        for sy in (-1, 1):
            t.bb(yl, (sx * 6.1 - 0.15, ty + sy * 1.22 - 0.15, 21.5), (sx * 6.1 + 0.15, ty + sy * 1.22 + 0.15, 22.1))
    t.obj('trolley')
    return dict(spec=[27.0, 105.3, 50.0], budget='building', atlas=1024,
                notes='STS container crane, orange-red painted steel. Rails along X at y=+-15 (30 m gauge, rail top z=0); waterside is -Y; '
                      'boom 60 m from the waterside rail to y=-75, backreach to y=+30, apex 50 m. Trolley+spreader is a separate object '
                      '(`trolley`, slides along Y). Lift height under spreader ~21.5 m.',
                pv=dict(elev=24, azim=-35, fig=(-14.5, -16.5), zoom=0.9))


@asset('prop_rtg_crane', 'port')
def rtg_crane():
    """Rubber-tyred gantry, travels along X; 23.5 m wheel span across Y; origin at ground under the gantry centre."""
    yl = MP('paint_yellow'); dk = MP('paint_dark'); rb = MP('rubber'); hz = MP('hazard'); gv = MP('galv'); gr = MP('grating')
    g = G('rtg_structure'); sy_ = 11.75
    for sy in (-1, 1):
        y = sy * sy_
        g.bb(yl, (-4.4, y - 0.5, 1.95), (4.4, y + 0.5, 2.9))                      # sill beam
        for sx in (-1, 1):
            x = sx * 3.55
            g.bb(dk, (x - 0.9, y - 0.75, 1.75), (x + 0.9, y + 0.75, 2.0))          # bogie
            for dy in (-0.33, 0.33):
                g.lathe(rb, [(0.45, -0.27), (0.75, -0.27), (0.84, -0.2), (0.86, 0.0), (0.84, 0.2), (0.75, 0.27), (0.45, 0.27)], 16,
                        Matrix.Translation((x, y + dy, 0.86)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4(), closed=True)
                g.cyl(MP('paint_grey'), (x, y + dy - 0.22, 0.86), (x, y + dy + 0.22, 0.86), 0.46, 12)
            # legs (splayed in X)
            g.beam(yl, (sx * 3.2, y, 2.9), (sx * 2.1, y, 17.0), 0.95, 0.95, up=(0, 1, 0))
        g.beam(hz, (-3.2, y, 2.9), (-3.07, y, 4.6), 1.0, 1.0, up=(0, 1, 0))
        g.beam(hz, (3.2, y, 2.9), (3.07, y, 4.6), 1.0, 1.0, up=(0, 1, 0))
        g.bb(yl, (-2.9, y - 0.55, 16.4), (2.9, y + 0.55, 17.0))                   # top end beam
        g.beam(yl, (-2.95, y, 5.0), (2.25, y, 15.6), 0.35, 0.35, up=(0, 1, 0))     # diagonal brace
        g.bb(yl, (-2.9, y - 0.3, 9.6), (2.9, y + 0.3, 10.1))
    # main girders spanning Y
    for sx in (-1, 1):
        g.bb(yl, (sx * 1.9 - 0.45, -12.6, 17.0), (sx * 1.9 + 0.45, 12.6, 18.6))
        g.bb(gr, (sx * 2.35, -12.6, 17.0), (sx * 3.2, 12.6, 17.08))
        g.rail(yl, [(sx * 3.2, -12.6, 17.08), (sx * 3.2, 12.6, 17.08)], post=2.1, n=4)
    # e-house / diesel genset on the -Y sill with exhaust
    g.bb(MP('paint_white'), (-2.4, -12.6, 2.9), (2.4, -10.95, 5.0))
    g.bb(dk, (2.38, -12.4, 3.2), (2.42, -11.1, 4.6))
    g.cyl(dk, (-1.6, -11.7, 5.0), (-1.6, -11.7, 6.3), 0.12, 8)
    # stair/ladder to the girder on +Y side
    g.ladder(gv, (3.6, 11.75, 2.9), 17.0, out=(1, 0, 0), step=0.33, cage=True)
    g.bb(gr, (2.6, 11.0, 9.95), (4.2, 12.5, 10.05))
    for yy in (-8.0, 0.0, 8.0):
        g.bb(MP('GLOW_lamp'), (-0.3, yy - 0.2, 16.9), (0.3, yy + 0.2, 16.98))
    g.obj('rtg_structure')
    t = G('trolley'); ty = 3.0
    t.bb(yl, (-2.6, ty - 2.5, 18.6), (2.6, ty + 2.5, 19.2))
    t.bb(MP('paint_white'), (-2.2, ty - 2.0, 19.2), (1.4, ty + 2.0, 20.0))
    t.bb(dk, (-2.25, ty - 1.0, 19.4), (-2.2, ty + 1.0, 19.9))
    t.bb(MP('paint_white'), (1.15, ty - 1.2, 15.4), (2.55, ty + 1.2, 17.9))
    t.bb(MP('GLASS'), (1.1, ty - 1.15, 15.6), (2.6, ty + 1.15, 17.6))
    t.beam(dk, (1.85, ty, 17.9), (1.85, ty, 18.6), 0.4)
    for sx in (-1, 1):
        for sy in (-1, 1):
            t.cyl(dk, (sx * 1.2, ty + sy * 0.8, 18.6), (sx * 1.2, ty + sy * 0.8, 9.2), 0.03, 4, smooth=False)
    t.bb(dk, (-1.6, ty - 0.9, 8.7), (1.6, ty + 0.9, 9.2))
    t.bb(yl, (-6.1, ty - 1.22, 8.1), (6.1, ty + 1.22, 8.7))
    for sx in (-1, 1):
        for sy in (-1, 1):
            t.bb(yl, (sx * 6.1 - 0.15, ty + sy * 1.22 - 0.15, 7.75), (sx * 6.1 + 0.15, ty + sy * 1.22 + 0.15, 8.25))
    t.obj('trolley')
    return dict(spec=[12.5, 25.26, 20.0], budget='building', atlas=1024,
                notes='RTG, yellow. Travels along X; wheel span 23.5 m across Y (tyre centres y=+-11.75); 40 ft spreader (12.2 m, along X) '
                      'sets the X extent. Trolley+cab+spreader is the separate `trolley` object (slides along Y). Origin ground centre.',
                pv=dict(elev=24, azim=-50))


@asset('prop_bollard', 'port')
def bollard():
    g = G('bollard'); y = MP('paint_yellow_worn'); dk = MP('paint_dark')
    g.bb(dk, (-0.35, -0.35, 0.0), (0.35, 0.35, 0.05))
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.cyl(MP('galv_dark'), (sx * 0.27, sy * 0.27, 0.05), (sx * 0.27, sy * 0.27, 0.085), 0.035, 6)
    g.lathe(y, [(0.0, 0.05), (0.21, 0.05), (0.18, 0.12), (0.16, 0.42), (0.19, 0.52), (0.30, 0.56), (0.30, 0.63), (0.25, 0.67), (0.0, 0.68)], 18)
    g.cyl(y, (-0.32, 0, 0.47), (0.32, 0, 0.47), 0.07, 10)
    g.obj('bollard')
    return dict(spec=[0.7, 0.7, 0.68], budget='small', atlas=512,
                notes='Cast-iron tee-head mooring bollard, worn yellow paint, on a bolted base plate. Origin at quay deck level, centre.')


@asset('prop_fender', 'port')
def fender():
    g = G('fender'); rb = MP('rubber'); gv = MP('galv_dark')
    prof = [(0.0, -1.0), (0.30, -1.0), (0.45, -0.93), (0.5, -0.8), (0.5, 0.8), (0.45, 0.93), (0.30, 1.0), (0.0, 1.0)]
    g.lathe(rb, prof, 20, Matrix.Translation((0, -0.52, -1.05)) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4())
    g.cyl(gv, (-1.12, -0.52, -1.05), (1.12, -0.52, -1.05), 0.06, 8)
    for sx in (-1, 1):
        x = sx * 1.12
        g.bb(gv, (x - 0.12, 0.08, 0.0), (x + 0.12, 0.30, 0.04))           # padeye plate on the coping
        g.bb(gv, (x - 0.02, 0.12, 0.04), (x + 0.02, 0.22, 0.14))
        a = V((x, -0.52, -1.05)); b = V((x, 0.17, 0.1)); d = (b - a).normalized(); n = 11
        side = d.cross(V((1, 0, 0))).normalized()
        for k in range(n):
            p = a.lerp(b, (k + 0.5) / n); ax = V((1, 0, 0)) if k % 2 else side
            # oval link: long axis along the chain (local X of the torus frame is rotated onto d)
            q = ax.to_track_quat('Z', 'Y').to_matrix(); lx = q.col[0]
            ang = math.atan2(lx.cross(d).dot(ax), lx.dot(d))
            M = Matrix.Translation(p) @ q.to_4x4() @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Diagonal((1.45, 1.0, 1.0, 1.0))
            prof = [(0.045 + 0.013 * math.cos(TAU * j / 4), 0.013 * math.sin(TAU * j / 4)) for j in range(4)]
            g.lathe(gv, prof, 6, M, smooth=False, closed=True)
    g.obj('fender')
    return dict(spec=[2.48, 1.32, 1.69], budget='small', atlas=512,
                notes='Cylindrical rubber fender (1.0 m OD x 2.0 m) hung on chains from two padeyes. Origin = quay coping edge '
                      '(top of quay face, z=0, y=0); the fender hangs below the deck on the water (-Y) side.',
                pv=dict(ground=-2.5, quay=((-3, 0, -2.5), (3, 4, 0.0)), fig=(-2.0, 1.2), fig_z=0.0, elev=18, azim=-70))


@asset('prop_life_ring_post', 'port')
def life_ring_post():
    g = G('life_ring_post'); red = MP('paint_red'); wh = MP('paint_white')
    g.bb(MP('concrete_precast'), (-0.2, -0.2, 0.0), (0.2, 0.2, 0.08))
    g.bb(red, (-0.045, -0.045, 0.08), (0.045, 0.045, 1.75))
    g.bb(red, (-0.06, -0.06, 1.75), (0.06, 0.06, 1.78))
    g.bb(wh, (-0.24, -0.075, 1.48), (0.24, -0.06, 1.74))               # sign plate
    g.bb(red, (-0.24, -0.08, 1.48), (0.24, -0.075, 1.53))
    g.bb(red, (-0.24, -0.08, 1.69), (0.24, -0.075, 1.74))
    g.beam(MP('galv'), (0, -0.05, 1.32), (0, -0.16, 1.32), 0.04, 0.12)    # hanger bracket
    org = paint('paint_lifering', (0.92, 0.28, 0.02), rough=0.55, chips=0.1, rust=0.0, grime=0.3)
    wt = paint('paint_lifering_tape', (0.85, 0.85, 0.82), rough=0.4, chips=0.05, rust=0.0, grime=0.25)
    fs = g.torus(org, (0, -0.21, 1.02), 0.30, 0.085, 28, 8, axis=(0, 1, 0))
    for f in fs:
        c = f.calc_center_median(); ang = math.degrees(math.atan2(c.z - 1.02, c.x)) % 90
        if ang < 12 or ang > 78:
            if wt not in g.mats: g.mats.append(wt)
            f.material_index = g.mats.index(wt)
    g.torus(MP('paint_grey'), (0, -0.21, 1.02), 0.395, 0.008, 28, 4, axis=(0, 1, 0), smooth=False)  # grab line
    g.obj('life_ring_post')
    return dict(spec=[0.806, 0.495, 1.78], budget='small', atlas=512,
                notes='Red life-ring post with an orange/white life ring hanging on the -Y (water) face. Origin at ground, post centre.')


def _nav_buoy(col_key, glow_key, topmark):
    g = G('nav_buoy'); pm = paint('paint_buoy_' + col_key, {'red': (0.55, 0.045, 0.03), 'green': (0.035, 0.30, 0.10)}[col_key],
                                  rough=0.5, chips=0.3, rust=0.4, waterline=0.0, ground=False)
    gv = MP('galv'); dk = MP('paint_dark')
    g.lathe(pm, [(0.0, -1.05), (0.75, -1.05), (1.15, -0.75), (1.2, -0.3), (1.2, 0.55), (1.08, 0.72), (0.0, 0.72)], 24)
    g.torus(MP('rubber'), (0, 0, 0.25), 1.22, 0.08, 24, 6)
    g.cyl(dk, (0, 0, -1.05), (0, 0, -2.0), 0.14, 8)
    g.cyl(dk, (0, 0, -2.0), (0, 0, -2.25), 0.34, 10)
    g.torus(gv, (0, 0, -2.38), 0.1, 0.025, 8, 4, axis=(1, 0, 0), smooth=False)
    # superstructure: 4 legs, rings, daymark panels
    legs = [(0.62 * math.cos(a), 0.62 * math.sin(a)) for a in (math.pi / 4 + k * math.pi / 2 for k in range(4))]
    tops = [(0.30 * math.cos(a), 0.30 * math.sin(a)) for a in (math.pi / 4 + k * math.pi / 2 for k in range(4))]
    for (x0, y0), (x1, y1) in zip(legs, tops):
        g.beam(pm, (x0, y0, 0.72), (x1, y1, 3.05), 0.08, 0.08)
    for k in range(4):
        a0, a1 = legs[k], legs[(k + 1) % 4]; b0, b1 = tops[k], tops[(k + 1) % 4]
        f = lambda p, q, t: (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
        z0, z1 = 1.35, 2.7; t0 = (z0 - 0.72) / 2.33; t1 = (z1 - 0.72) / 2.33
        p0 = f(a0, b0, t0); p1 = f(a1, b1, t0); p2 = f(a1, b1, t1); p3 = f(a0, b0, t1)
        nrm = V((p0[0] + p1[0], p0[1] + p1[1], 0)).normalized() * 0.03
        g.hexa(pm, [(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0] - nrm.x, p1[1] - nrm.y, z0), (p0[0] - nrm.x, p0[1] - nrm.y, z0),
                    (p3[0], p3[1], z1), (p2[0], p2[1], z1), (p2[0] - nrm.x, p2[1] - nrm.y, z1), (p3[0] - nrm.x, p3[1] - nrm.y, z1)])
    g.cyl(pm, (0, 0, 3.0), (0, 0, 3.1), 0.42, 12)
    g.cyl(gv, (0, 0, 3.1), (0, 0, 3.22), 0.16, 10)
    g.cyl(MP(glow_key), (0, 0, 3.22), (0, 0, 3.45), 0.11, 10)
    g.cyl(gv, (0, 0, 3.45), (0, 0, 3.52), 0.14, 10)
    g.cyl(gv, (0, 0, 3.52), (0, 0, 3.62), 0.025, 6)
    if topmark == 'can': g.cyl(pm, (0, 0, 3.62), (0, 0, 4.0), 0.2, 12)
    else: g.cyl(pm, (0, 0, 3.62), (0, 0, 4.0), 0.24, 12, r2=0.0)
    g.torus(gv, (0.0, -0.75, 0.8), 0.07, 0.018, 8, 4, axis=(1, 0, 0), smooth=False)
    g.obj('nav_buoy')
    return dict(spec=[2.6, 2.6, 6.5], budget='small', atlas=512,
                notes=f'IALA lateral pillar buoy ({col_key}, {topmark} topmark, light 3.3 m). Origin at the waterline (z=0): '
                      '4.0 m above water, float, counterweight and mooring eye to 2.5 m below.',
                pv=dict(ground=0.0, ground_mat=paint('_sea', (0.04, 0.12, 0.16), rough=0.08, chips=0, rust=0, grime=0, ground=False), elev=20))


@asset('prop_nav_buoy_red', 'port')
def nav_buoy_red(): return _nav_buoy('red', 'GLOW_red', 'can')


@asset('prop_nav_buoy_green', 'port')
def nav_buoy_green(): return _nav_buoy('green', 'GLOW_green', 'cone')


@asset('prop_harbour_light', 'port')
def harbour_light():
    g = G('harbour_light'); cc = concrete('concrete_plinth', joint=0, stain=0.6, damp=0.7)
    tw = paint('paint_tower_bands', (0.78, 0.78, 0.76), rough=0.5, chips=0.15, rust=0.4, bands=((0.55, 0.05, 0.035), 3.0, 0.8))
    gv = MP('galv'); dk = MP('paint_dark')
    oct8 = [(2.0 * math.cos(TAU * k / 8 + math.pi / 8), 2.0 * math.sin(TAU * k / 8 + math.pi / 8)) for k in range(8)]
    g.prism(cc, oct8, 0.0, 0.8)
    g.lathe(tw, [(1.05, 0.8), (0.98, 3.0), (0.9, 5.5), (0.82, 7.9), (0.0, 7.9)], 18, caps=True)
    g.bb(dk, (-0.42, -1.06, 0.9), (0.42, -0.96, 2.9))
    g.bb(gv, (-0.5, -1.15, 0.8), (0.5, -1.0, 0.86))
    for z in (3.6, 5.8):
        g.bb(MP('GLASS'), (-0.18, -0.98 + (z - 3.6) * 0.03, z), (0.18, -0.9 + (z - 3.6) * 0.03, z + 0.5))
    g.cyl(MP('paint_grey'), (0, 0, 7.9), (0, 0, 8.08), 1.45, 20)
    pts = ring_pts(1.4, 16, 8.08)
    g.rail(gv, pts, h=1.0, post=0.55, r=0.02, n=4)
    g.cyl(dk, (0, 0, 8.08), (0, 0, 8.45), 0.62, 16)
    g.cyl(MP('GLOW_red'), (0, 0, 8.55), (0, 0, 9.25), 0.28, 12)
    g.cyl(glass('GLASS_lantern', (0.10, 0.10, 0.10), 0.03), (0, 0, 8.45), (0, 0, 8.5), 0.55, 16)
    for k in range(8):
        a = TAU * k / 8; g.beam(dk, (0.52 * math.cos(a), 0.52 * math.sin(a), 8.45), (0.52 * math.cos(a), 0.52 * math.sin(a), 9.4), 0.05)
    g.cyl(dk, (0, 0, 9.4), (0, 0, 9.82), 0.66, 16, r2=0.12)
    g.sphere(dk, (0, 0, 9.86), 0.08, 8, 4)
    g.cyl(gv, (0, 0, 9.9), (0, 0, 10.0), 0.015, 4)
    g.ladder(gv, (0, 0.98, 0.8), 8.0, out=(0, 1, 0), step=0.3, cage=False)
    g.obj('harbour_light')
    return dict(spec=[3.7, 3.7, 10.0], budget='small', atlas=512,
                notes='Breakwater-end light tower: octagonal concrete plinth, white tower with red bands, gallery railing, red lantern '
                      '(GLOW_red) at 8.5-9.3 m. Door faces -Y. Origin at breakwater deck, tower axis.')


# ════════════════════════════════════════════════════════════════════ 2. ROADS AND SITE
@asset('prop_street_light', 'site')
def street_light():
    g = G('street_light'); gv = MP('galv'); dk = MP('paint_dark')
    g.cyl(MP('concrete_precast'), (0, 0, -0.05), (0, 0, 0.12), 0.35, 12)
    g.bb(gv, (-0.2, -0.2, 0.12), (0.2, 0.2, 0.15))
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.cyl(gv, (sx * 0.15, sy * 0.15, 0.15), (sx * 0.15, sy * 0.15, 0.21), 0.022, 6)
    g.lathe(gv, [(0.11, 0.15), (0.10, 2.0), (0.075, 7.0), (0.06, 9.95), (0.0, 10.0)], 12)
    g.bb(dk, (-0.04, -0.105, 0.6), (0.04, -0.09, 1.0))                 # access hatch
    a = V((0, 0, 9.4)); b = V((0, -0.8, 9.7)); c = V((0, -2.2, 9.78))
    g.cyl(gv, a, b, 0.045, 8); g.cyl(gv, b, c, 0.04, 8)
    g.hexa(MP('paint_grey'), [(-0.18, -2.0, 9.62), (0.18, -2.0, 9.62), (0.16, -2.75, 9.66), (-0.16, -2.75, 9.66),
                              (-0.18, -2.0, 9.8), (0.18, -2.0, 9.8), (0.16, -2.75, 9.74), (-0.16, -2.75, 9.74)])
    g.bb(MP('GLOW_lamp'), (-0.13, -2.65, 9.6), (0.13, -2.08, 9.625))
    g.obj('street_light')
    return dict(spec=[0.7, 3.1, 10.05], budget='small', atlas=512,
                notes='10 m galvanised street light, LED head on a 2.7 m outreach arm pointing -Y (over the road). '
                      'Origin at ground, pole axis; footing sinks 0.05 m below ground.')


@asset('prop_utility_cabinet', 'site')
def utility_cabinet():
    g = G('utility_cabinet'); pm = paint('paint_cabinet', (0.30, 0.36, 0.32), rough=0.5, chips=0.25, rust=0.3)
    g.bb(MP('concrete_precast'), (-0.66, -0.31, 0.0), (0.66, 0.31, 0.15))
    g.bb(pm, (-0.6, -0.25, 0.15), (0.6, 0.25, 1.55))
    g.hexa(pm, [(-0.64, -0.29, 1.55), (0.64, -0.29, 1.55), (0.64, 0.29, 1.55), (-0.64, 0.29, 1.55),
                (-0.64, -0.29, 1.58), (0.64, -0.29, 1.58), (0.64, 0.29, 1.62), (-0.64, 0.29, 1.62)])
    for sx in (-1, 1):
        g.bb(pm, (sx * 0.015, -0.262, 0.2), (sx * 0.585, -0.25, 1.5))
        g.bb(MP('galv_dark'), (sx * 0.08 - 0.015, -0.29, 0.75), (sx * 0.08 + 0.015, -0.262, 0.95))
        for k in range(4):
            g.bb(MP('paint_dark'), (sx * 0.15, -0.268, 0.3 + k * 0.05), (sx * 0.45, -0.262, 0.32 + k * 0.05))
    g.prism(MP('paint_yellow'), [(-0.09, 1.25), (0.09, 1.25), (0.0, 1.405)], -0.27, -0.262, Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    g.obj('utility_cabinet')
    return dict(spec=[1.32, 0.62, 1.62], budget='small', atlas=512,
                notes='Roadside/port utility cabinet on a concrete plinth, doors and vents face -Y. Origin at ground centre.')


@asset('prop_jersey_barrier', 'site')
def jersey_barrier():
    g = G('jersey_barrier'); cc = MP('concrete_precast')
    prof = [(-0.305, 0.0), (0.305, 0.0), (0.305, 0.076), (0.2, 0.33), (0.12, 0.81), (-0.12, 0.81), (-0.2, 0.33), (-0.305, 0.076)]
    slot = [(y, max(z, 0.1)) for y, z in prof]
    for a0, a1, pr in ((-1.5, -0.8, prof), (-0.8, -0.4, slot), (-0.4, 0.4, prof), (0.4, 0.8, slot), (0.8, 1.5, prof)):
        g.ext(cc, pr, 'x', a0, a1)
    for sx in (-1, 1):
        g.torus(MP('galv_dark'), (sx * 1.484, 0, 0.62), 0.06, 0.016, 8, 4, axis=(1, 0, 0), smooth=False)
        g.bb(paint('paint_reflector', (0.85, 0.85, 0.82), rough=0.3, chips=0.1, rust=0, grime=0.3), (sx * 0.9 - 0.15, -0.165, 0.6), (sx * 0.9 + 0.15, -0.15, 0.68))
    g.obj('jersey_barrier')
    return dict(spec=[3.0, 0.61, 0.81], budget='small', atlas=512,
                notes='Precast concrete F-shape barrier 3.0 m, forklift/drain slots, end connection loops. Origin at ground centre.')


@asset('prop_safety_barrier', 'site')
def safety_barrier():
    g = G('safety_barrier'); yl = MP('paint_yellow'); hz = MP('hazard')
    for x in (-1.37, 0.0, 1.37):
        g.bb(yl, (x - 0.13, -0.13, 0.0), (x + 0.13, 0.13, 0.015))
        for sx in (-1, 1):
            g.cyl(MP('galv_dark'), (x + sx * 0.09, -0.09, 0.015), (x + sx * 0.09, -0.09, 0.04), 0.018, 6)
            g.cyl(MP('galv_dark'), (x + sx * 0.09, 0.09, 0.015), (x + sx * 0.09, 0.09, 0.04), 0.018, 6)
        g.bb(yl, (x - 0.05, -0.05, 0.015), (x + 0.05, 0.05, 1.0))
        g.bb(MP('paint_dark'), (x - 0.055, -0.055, 1.0), (x + 0.055, 0.055, 1.02))
    for z in (0.42, 0.88):
        g.bb(hz, (-1.5, -0.12, z - 0.07), (1.5, -0.05, z + 0.07))
    g.bb(yl, (-1.5, -0.1, 0.13), (1.5, -0.05, 0.2))
    g.obj('safety_barrier')
    return dict(spec=[3.0, 0.26, 1.02], budget='small', atlas=512,
                notes='Yellow bolted-down steel impact barrier, 3.0 m, two hazard-striped rails on the -Y face. Origin at ground centre.')


@asset('prop_fence_segment', 'site')
def fence_segment():
    g = G('fence_frame'); gv = MP('galv')
    g.cyl(MP('concrete_precast'), (-2.0, 0, -0.02), (-2.0, 0, 0.05), 0.09, 8)
    g.cyl(gv, (-2.0, 0, 0.05), (-2.0, 0, 2.4), 0.03, 8)
    g.cyl(gv, (-2.0, 0, 2.4), (-2.0, 0, 2.43), 0.035, 8, r2=0.02)
    g.cyl(gv, (-2.0, 0.0, 2.35), (2.0, 0.0, 2.35), 0.02, 6)
    g.cyl(gv, (-2.0, 0.0, 0.1), (2.0, 0.0, 0.1), 0.006, 4, smooth=False)
    for z in (0.12, 1.2, 2.33):
        g.bb(gv, (-1.975, -0.012, z - 0.02), (-1.965, 0.012, z + 0.02))
    g.obj('fence_frame')
    # chain-link panel with its own UVs (0.1 m tile)
    me = bpy.data.meshes.new('fence_mesh'); x0, x1, z0, z1 = -1.97, 2.0, 0.08, 2.35
    me.from_pydata([(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for li, (u, v) in enumerate([(0, 0), ((x1 - x0) / 0.1, 0), ((x1 - x0) / 0.1, (z1 - z0) / 0.1), (0, (z1 - z0) / 0.1)]):
        uv.data[li].uv = (u, v)
    me.materials.append(chainlink_mat()); o = bpy.data.objects.new('fence_mesh', me); CUR.coll.objects.link(o)
    return dict(spec=[4.09, 0.18, 2.45], budget='small', atlas=512,
                notes='4 m chain-link fence bay, 2.4 m high: one galvanised post at x=-2 (tile along +X; the next bay supplies the next post), '
                      'top rail, tension wire and an alpha-clipped CHAINLINK panel (unbaked, own UVs, 0.1 m tile). Origin ground at bay centre.')


@asset('prop_road_sign', 'site')
def road_sign():
    g = G('road_sign'); gv = MP('galv')
    g.bb(gv, (-0.035, -0.035, -0.3), (0.035, 0.035, 2.9))
    wh = paint('paint_sign_white', (0.86, 0.86, 0.84), rough=0.35, chips=0.05, rust=0.1, grime=0.25)
    rd = paint('paint_sign_red', (0.62, 0.04, 0.03), rough=0.35, chips=0.05, rust=0.1, grime=0.25)
    bk = paint('paint_sign_black', (0.02, 0.02, 0.02), rough=0.4, chips=0.0, rust=0.0, grime=0.1)
    s = 0.95; h = s * math.sqrt(3) / 2; zc = 2.5
    tri = lambda k: [(-s * k / 2, zc - h * k / 3), (s * k / 2, zc - h * k / 3), (0, zc + 2 * h * k / 3)]
    Myz = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    for z in (1.8, 2.4):
        g.bb(gv, (-0.06, -0.06, z - 0.03), (0.06, -0.035, z + 0.03))          # brackets
    g.prism(gv, tri(1.0), -0.075, -0.06, Myz)                                  # galvanised back plates
    g.prism(rd, tri(1.0), -0.08, -0.075, Myz)
    g.prism(wh, tri(0.72), -0.084, -0.08, Myz)
    g.bb(bk, (-0.035, -0.087, 2.43), (0.035, -0.084, 2.72))
    g.bb(bk, (-0.035, -0.087, 2.33), (0.035, -0.084, 2.39))
    g.bb(gv, (-0.45, -0.075, 1.62), (0.45, -0.06, 1.98))
    g.bb(paint('hazard_fine', (0.80, 0.52, 0.03), rough=0.4, chips=0.1, rust=0.05, stripe=((0.02, 0.02, 0.02), 0.2)), (-0.44, -0.084, 1.63), (0.44, -0.075, 1.97))
    g.obj('road_sign')
    return dict(spec=[0.95, 0.122, 3.35], budget='small', atlas=512,
                notes='Warning sign: red-bordered triangle (0.95 m) over a hazard-chevron plate on a galvanised post. Face looks -Y. '
                      'Origin at ground at the post; post sinks 0.3 m below ground.')


@asset('prop_culvert_end', 'site')
def culvert_end():
    """Box culvert under a 24 m road: barrel along Y, headwalls+wingwalls+aprons at both road edges (y=+-14)."""
    g = G('culvert'); cc = concrete('concrete_culvert', joint=0, lifts=1.2, jw=0.01, stain=0.8, damp_z=-2.8, damp=0.8, moss=0.6)
    bed = -2.8; ow, oh = 3.0, 2.0
    for sy in (-1, 1):
        y0 = sy * 14.0; y1 = sy * 14.4
        g.wall(cc, 'x', (y0 + y1) / 2, 0.4, -4.5, 4.5, bed - 0.3, 0.0, holes=[(-ow / 2, ow / 2, bed, bed + oh)])
        g.bb(cc, (-4.6, min(y0, y1) - 0.05, 0.0), (4.6, max(y0, y1) + 0.05, 0.6))          # parapet / upstand
        g.bb(cc, (-4.7, min(y0, y1) - 0.1, 0.6), (4.7, max(y0, y1) + 0.1, 0.68))
        for sx in (-1, 1):
            p0 = V((sx * 4.5, y1, 0)); d = V((sx * 0.5, sy * 0.866, 0)); t = V((sx * 0.866, -sy * 0.5, 0)) * 0.35
            L = 3.6; p1 = p0 + d * L
            pts = [p0, p1, p1 + t, p0 + t]
            g.hexa(cc, [(p.x, p.y, bed - 0.3) for p in pts] + [(p0.x, p0.y, 0.0), (p1.x, p1.y, bed + 0.7), (p1.x + t.x, p1.y + t.y, bed + 0.7), (p0.x + t.x, p0.y + t.y, 0.0)])
        ya, yb = sorted((y1, sy * 17.4))
        g.bb(cc, (-4.2, ya, bed - 0.3), (4.2, yb, bed))                               # apron
        for sx in (-1, 1):
            p = (sx * 4.2, y0 - sy * 0.8, 0.0)
            g.bb(paint('paint_delineator', (0.85, 0.85, 0.82), chips=0.1, rust=0.0, grime=0.3), (p[0] - 0.06, p[1] - 0.06, 0.0), (p[0] + 0.06, p[1] + 0.06, 1.05))
            g.bb(MP('paint_red'), (p[0] - 0.065, p[1] - 0.065, 0.8), (p[0] + 0.065, p[1] + 0.065, 0.95))
    # barrel: floor, walls, roof slab
    g.bb(cc, (-ow / 2 - 0.3, -14.0, bed - 0.3), (ow / 2 + 0.3, 14.0, bed))
    for sx in (-1, 1):
        g.bb(cc, (sx * ow / 2, -14.0, bed), (sx * (ow / 2 + 0.3), 14.0, bed + oh))
    g.bb(cc, (-ow / 2 - 0.3, -14.0, bed + oh), (ow / 2 + 0.3, 14.0, bed + oh + 0.3))
    g.obj('culvert')
    return dict(spec=[13.21, 35.04, 4.15], budget='small', atlas=1024,
                notes='Concrete box culvert (3.0 x 2.0 m cell) under a 24 m road: barrel along Y, headwalls at y=+-14 (road + 2 m shoulders) '
                      'with splayed wingwalls, aprons and delineator posts. Origin = road surface level (z=0) on the culvert axis; '
                      'channel bed at z=-2.8. The road deck itself is not included.',
                pv=dict(ground=-3.1, fig=(0.0, -16.5), elev=24, azim=-62))


@asset('prop_drainage_grate', 'site')
def drainage_grate():
    g = G('drainage_grate'); ci = paint('paint_castiron', (0.09, 0.085, 0.08), rough=0.55, metal=0.4, chips=0.2, rust=0.6, dust=0.3, ground=False)
    cd = MP('concrete_dark')
    for a, b in (((-0.5, -0.5), (0.5, -0.42)), ((-0.5, 0.42), (0.5, 0.5)), ((-0.5, -0.42), (-0.42, 0.42)), ((0.42, -0.42), (0.5, 0.42))):
        g.bb(ci, (a[0], a[1], -0.06), (b[0], b[1], 0.0))
    for k in range(11):
        x = -0.38 + k * 0.076; g.bb(ci, (x - 0.014, -0.42, -0.055), (x + 0.014, 0.42, -0.004))
    for y in (-0.2, 0.0, 0.2): g.bb(ci, (-0.42, y - 0.012, -0.06), (0.42, y + 0.012, -0.012))
    for a, b in (((-0.42, -0.42), (0.42, -0.36)), ((-0.42, 0.36), (0.42, 0.42)), ((-0.42, -0.36), (-0.36, 0.36)), ((0.36, -0.36), (0.42, 0.36))):
        g.bb(cd, (a[0], a[1], -0.32), (b[0], b[1], -0.06))
    g.bb(gravel('silt', ((0.12, 0.11, 0.09), (0.09, 0.08, 0.07), (0.16, 0.14, 0.11), (0.1, 0.08, 0.06)), 40.0), (-0.36, -0.36, -0.33), (0.36, 0.36, -0.28))
    g.obj('drainage_grate')
    return dict(spec=[1.0, 1.0, 0.33], budget='small', atlas=512,
                notes='Flush 1.0 m cast-iron drainage grate over a shallow concrete pit; top surface exactly z=0. Origin = grate centre at surface.',
                pv=dict(ground=-0.4, fig_z=0.0, boxes=[((-3, -3, -0.4), (3, -0.5, 0)), ((-3, 0.5, -0.4), (3, 3, 0)), ((-3, -0.5, -0.4), (-0.5, 0.5, 0)), ((0.5, -0.5, -0.4), (3, 0.5, 0))]))


# ════════════════════════════════════════════════════════════════════ 3. RESOURCE SITE
@asset('prop_gravel_pile', 'resource')
def gravel_pile():
    g = G('gravel_pile'); m = MP('ore'); bm = g.bm; R, H = 5.0, 4.0
    rs = [0.0, 0.25, 0.5, 0.8, 1.15, 1.6, 2.05, 2.5, 2.95, 3.4, 3.8, 4.15, 4.45, 4.7, 4.85, 4.95]; ns = 44
    def hgt(t): return H * (1 - t ** 1.35) ** 1.15
    rings = []
    for i, r in enumerate(rs):
        if r == 0: rings.append([bm.verts.new((0, 0, H))]); continue
        ring = []
        for k in range(ns):
            a = TAU * k / ns; ca, sa = math.cos(a), math.sin(a)
            n1 = mnoise.noise(V((ca * 1.3 + 7, sa * 1.3 + 3, 0.5))); lump = mnoise.noise(V((ca * r * 0.55, sa * r * 0.55, 2.0))) + 0.5 * mnoise.noise(V((ca * r * 1.3, sa * r * 1.3, 5.0)))
            rr = r * (1 + 0.06 * n1); z = hgt(min(r / R, 1.0)) + 0.32 * lump * (1 - (r / R) ** 4) + 0.05 * mnoise.noise(V((ca * r * 2, sa * r * 2, 9)))
            ring.append(bm.verts.new((rr * ca, rr * sa, max(0.0, z) if i < len(rs) - 1 else 0.0)))
        rings.append(ring)
    vs = [v for r_ in rings for v in r_]
    for A, B in zip(rings[:-1], rings[1:]):
        for k in range(ns):
            j = (k + 1) % ns
            if len(A) == 1: bm.faces.new((A[0], B[k], B[j]))
            else: bm.faces.new((A[k], B[k], B[j], A[j]))
    g._fin(vs, m, True)
    # normalise to exactly 10 m diameter x 4 m
    xs = [v.co.x for v in vs]; ys = [v.co.y for v in vs]; zs = [v.co.z for v in vs]
    sx = 10.0 / (max(xs) - min(xs)); sy = 10.0 / (max(ys) - min(ys)); sz = 4.0 / max(zs); cx = (max(xs) + min(xs)) / 2; cy = (max(ys) + min(ys)) / 2
    for v in vs: v.co = V(((v.co.x - cx) * sx, (v.co.y - cy) * sy, v.co.z * sz))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    rnd = random.Random(11)
    for k in range(26):
        a = rnd.random() * TAU; r = rnd.uniform(3.9, 4.7); s_ = rnd.uniform(0.12, 0.28)
        c = V((r * math.cos(a), r * math.sin(a), hgt(r / R) * sz * 0.9 + s_ * 0.2))
        vv = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=s_, matrix=Matrix.Translation(c) @ Euler((rnd.random(), rnd.random(), rnd.random())).to_matrix().to_4x4() @ Matrix.Diagonal((1.0, rnd.uniform(0.6, 0.9), rnd.uniform(0.5, 0.75), 1)))['verts']
        g._fin(vv, m, False)
    g.obj('gravel_pile')
    return dict(spec=[10.0, 10.0, 4.0], budget='small', atlas=1024,
                notes='Screened ore stockpile (copper-tinted aggregate), lumpy cone 10 m x 4 m with spilled stones at the toe. Origin ground centre.')


@asset('prop_conveyor', 'resource')
def conveyor():
    """20 m inclined troughed belt conveyor, tail (feed hopper) at -X, head pulley + discharge chute at +X."""
    st = paint('paint_conveyor', (0.36, 0.40, 0.38), rough=0.55, chips=0.3, rust=0.45, dust=0.3)
    yl = MP('paint_yellow'); gv = MP('galv'); gr = MP('grating'); rb = MP('rubber'); dk = MP('paint_dark'); cc = MP('concrete_precast')
    g = G('conveyor')
    A = V((-9.331, 0, 2.0)); B = V((8.819, 0, 8.0)); d = (B - A).normalized(); L = (B - A).length; nrm = V((-d.z, 0, d.x))
    P = lambda s_, y=0.0, h=0.0: A + d * s_ + V((0, y, 0)) + nrm * h
    # side trusses
    for sy in (-0.75, 0.75):
        g.beam(st, P(0, sy, -0.15), P(L, sy, -0.15), 0.12, 0.12, up=nrm)
        g.beam(st, P(0, sy, -1.15), P(L, sy, -1.15), 0.12, 0.12, up=nrm)
        k = int(L / 1.8)
        for i in range(k + 1):
            s_ = L * i / k; g.beam(st, P(s_, sy, -1.15), P(s_, sy, -0.15), 0.08, 0.08, up=d)
            if i < k: g.beam(st, P(s_, sy, -1.15), P(L * (i + 1) / k, sy, -0.15), 0.06, 0.06, up=V((0, 1, 0)).cross(d))
    for i in range(int(L / 1.8) + 1):
        s_ = L * i / int(L / 1.8); g.beam(st, P(s_, -0.75, -1.15), P(s_, 0.75, -1.15), 0.06, 0.06, up=nrm)
    # troughed belt + ore ribbon + idlers
    Mb = Matrix((d, V((0, 1, 0)), nrm)).transposed().to_4x4()
    tro = [(-0.42, 0.18), (-0.2, 0.0), (0.2, 0.0), (0.42, 0.18), (0.42, 0.2), (0.2, 0.02), (-0.2, 0.02), (-0.42, 0.2)]
    g.prism(rb, [(y, z) for y, z in tro], 0.0, L, Matrix.Translation(A) @ Mb @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    g.prism(MP('ore'), [(-0.26, 0.04), (0.26, 0.04), (0.0, 0.16)], 0.4, L - 0.3, Matrix.Translation(A) @ Mb @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    for i in range(int(L / 1.2)):
        s_ = 0.6 + i * 1.2
        g.cyl(gv, P(s_, -0.2, -0.06), P(s_, 0.2, -0.06), 0.06, 6, smooth=False)
        g.cyl(gv, P(s_, -0.44, 0.06), P(s_, -0.22, -0.05), 0.06, 6, smooth=False)
        g.cyl(gv, P(s_, 0.22, -0.05), P(s_, 0.44, 0.06), 0.06, 6, smooth=False)
        g.beam(st, P(s_, -0.75, -0.15), P(s_, 0.75, -0.15), 0.05, 0.05, up=nrm)
    # walkway + handrail on -Y side
    g.prism(gr, [(-1.55, -0.2), (-0.8, -0.2), (-0.8, -0.16), (-1.55, -0.16)], 0.0, L, Matrix.Translation(A) @ Mb @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    g.rail(yl, [P(0.3, -1.52, -0.16), P(L - 0.3, -1.52, -0.16)], post=1.8, n=4)
    # head end: pulley, drive, chute, guards
    hp = P(L, 0, -0.25)
    g.cyl(dk, hp + V((0, -0.55, 0)), hp + V((0, 0.55, 0)), 0.38, 12)
    g.bb(yl, (hp.x - 0.6, -0.8, hp.z - 0.5), (hp.x + 0.5, 0.8, hp.z + 0.55))
    g.bb(paint('paint_motor', (0.10, 0.22, 0.30), rough=0.45, chips=0.2, rust=0.15), (hp.x - 0.9, 0.85, hp.z - 0.5), (hp.x + 0.2, 1.45, hp.z + 0.2))
    g.cyl(dk, (hp.x - 0.2, 0.8, hp.z), (hp.x - 0.2, 1.5, hp.z), 0.25, 10)
    g.hexa(st, [(hp.x - 0.1, -0.55, hp.z - 2.4), (hp.x + 0.9, -0.55, hp.z - 2.4), (hp.x + 0.9, 0.55, hp.z - 2.4), (hp.x - 0.1, 0.55, hp.z - 2.4),
                (hp.x - 0.35, -0.65, hp.z - 0.4), (hp.x + 1.1, -0.65, hp.z - 0.4), (hp.x + 1.1, 0.65, hp.z - 0.4), (hp.x - 0.35, 0.65, hp.z - 0.4)])
    # tail end: pulley + feed hopper on legs
    tp = P(0, 0, -0.25)
    g.cyl(dk, tp + V((0, -0.55, 0)), tp + V((0, 0.55, 0)), 0.3, 12)
    g.bb(yl, (tp.x - 0.75, -0.8, tp.z - 0.4), (tp.x + 0.2, 0.8, tp.z + 0.35))
    hx = A.x + 1.4
    g.hexa(st, [(hx - 0.5, -0.45, 2.75), (hx + 0.5, -0.45, 2.75), (hx + 0.5, 0.45, 2.75), (hx - 0.5, 0.45, 2.75),
                (hx - 1.1, -1.05, 3.95), (hx + 1.1, -1.05, 3.95), (hx + 1.1, 1.05, 3.95), (hx - 1.1, 1.05, 3.95)])
    g.bb(st, (hx - 1.15, -1.1, 3.95), (hx + 1.15, 1.1, 4.05))
    # support bents
    for s_ in (1.4, L * 0.5, L - 1.2):
        p = P(s_, 0, -1.15)
        for sy in (-0.8, 0.8):
            g.bb(st, (p.x - 0.09, sy - 0.09, 0.3), (p.x + 0.09, sy + 0.09, p.z))
            g.bb(cc, (p.x - 0.35, sy - 0.35, 0.0), (p.x + 0.35, sy + 0.35, 0.3))
        g.bb(st, (p.x - 0.06, -0.8, 1.2), (p.x + 0.06, 0.8, 1.32))
        if p.z > 3: g.beam(st, (p.x, -0.8, 1.3), (p.x, 0.8, p.z - 0.2), 0.06, 0.06, up=(1, 0, 0))
    g.obj('conveyor')
    return dict(spec=[20.0, 3.05, 8.87], budget='building', atlas=1024,
                notes='20 m inclined (~19 deg) troughed belt conveyor with ore on the belt: tail pulley + feed hopper at -X (belt 2 m), '
                      'head pulley, drive and discharge chute at +X (belt 8 m, chute lip ~5.6 m). Walkway + handrail on -Y. Origin ground centre.',
                pv=dict(elev=22, azim=-62))


@asset('prop_excavator', 'resource')
def excavator():
    yl = MP('paint_yellow_worn'); y2 = MP('paint_yellow'); dk = MP('paint_dark'); tr = MP('track'); ch = MP('chrome'); gl = MP('GLASS_cab')
    g = G('excavator'); x0 = -0.12
    trk = [(-1.9, 0.0), (1.9, 0.0), (2.3, 0.15), (2.45, 0.5), (2.3, 0.85), (1.9, 0.98), (-1.9, 0.98), (-2.3, 0.85), (-2.45, 0.5), (-2.3, 0.15)]
    for sy in (-1, 1):
        g.ext(tr, [(x + x0, z) for x, z in trk], 'y', sy * 1.0, sy * 1.6)
        for xx in (-1.95, 1.95):
            g.cyl(dk, (xx + x0, sy * 1.6, 0.5), (xx + x0, sy * 1.66, 0.5), 0.36, 10)
        for xx in (-1.0, 0.0, 1.0):
            g.cyl(dk, (xx + x0, sy * 1.6, 0.18), (xx + x0, sy * 1.64, 0.18), 0.12, 8)
        g.bb(yl, (-1.6 + x0, sy * 0.95, 0.3), (1.6 + x0, sy * 1.05, 0.85))
    g.bb(dk, (-1.2 + x0, -1.0, 0.45), (1.2 + x0, 1.0, 1.0))
    g.cyl(dk, (x0, 0, 1.0), (x0, 0, 1.15), 1.05, 16)
    # upper structure
    deck = [(1.55, -1.5), (1.55, 1.5)] + arc((0, 0), 2.95, math.radians(149.4), math.radians(210.6), 8)
    g.prism(yl, [(x + x0, y) for x, y in deck], 1.15, 1.35)
    g.bb(yl, (-2.4 + x0, -1.48, 1.35), (-0.3 + x0, 1.48, 2.35))
    g.hexa(yl, [(-2.4 + x0, -1.48, 2.35), (-0.3 + x0, -1.48, 2.35), (-0.3 + x0, 1.48, 2.35), (-2.4 + x0, 1.48, 2.35),
                (-2.3 + x0, -1.4, 2.5), (-0.4 + x0, -1.4, 2.45), (-0.4 + x0, 1.4, 2.45), (-2.3 + x0, 1.4, 2.5)])
    cw = arc((0, 0), 2.95, math.radians(149.4), math.radians(210.6), 8) + arc((0, 0), 2.3, math.radians(210.6), math.radians(149.4), 8)
    g.prism(yl, [(x + x0, y) for x, y in cw], 1.1, 2.4)
    for k in range(5): g.bb(dk, (-1.9 + k * 0.3 + x0, 1.47, 1.7), (-1.75 + k * 0.3 + x0, 1.49, 2.2))   # side grille
    g.bb(yl, (-0.3 + x0, -1.48, 1.35), (1.5 + x0, -0.55, 2.25))   # tool box / hydraulic tank
    g.cyl(dk, (-1.5 + x0, -0.9, 2.45), (-1.5 + x0, -0.9, 2.95), 0.07, 8)
    g.rail(y2, [(-2.1 + x0, -1.42, 2.45), (-0.5 + x0, -1.42, 2.45)], h=0.5, post=0.8, r=0.02, mid=False, n=4)
    # cab (left/+Y)
    g.bb(yl, (-0.25 + x0, 0.5, 1.35), (1.45 + x0, 1.45, 1.6))
    g.bb(gl, (-0.2 + x0, 0.55, 1.6), (1.4 + x0, 1.4, 3.05))
    for (xa, ya) in ((-0.25, 0.5), (1.4, 0.5), (-0.25, 1.4), (1.4, 1.4)):
        g.bb(dk, (xa + x0, ya, 1.6), (xa + 0.07 + x0, ya + 0.07, 3.08))
    g.bb(dk, (-0.27 + x0, 0.48, 3.05), (1.5 + x0, 1.48, 3.16))
    g.bb(dk, (0.5 + x0, 1.39, 1.6), (0.55 + x0, 1.42, 3.05))
    # boom, stick, bucket, cylinders
    by = -0.05
    pF = V((0.75 + x0, by, 1.75)); pK = V((3.55 + x0, by, 4.35)); pT = V((5.75 + x0, by, 3.75))
    g.beam(yl, pF, pK, 0.62, 0.85, up=(0, 0, 1)); g.beam(yl, pK, pT, 0.6, 0.7, up=(0, 0, 1))
    g.cyl(yl, pK + V((0, -0.32, 0)), pK + V((0, 0.32, 0)), 0.45, 10)
    g.cyl(dk, pF + V((0, -0.4, 0)), pF + V((0, 0.4, 0)), 0.2, 10)
    sT = V((5.4 + x0, by, 4.7)); sB = V((6.42 + x0, by, 0.95))
    g.beam(yl, sT, sB, 0.5, 0.55, up=(1, 0, 0))
    g.cyl(dk, pT + V((0, -0.36, 0)), pT + V((0, 0.36, 0)), 0.17, 10)
    for sy in (-0.42, 0.42):
        a = V((1.25 + x0, by + sy, 1.55)); b = V((3.0 + x0, by + sy, 3.85))
        g.cyl(yl, a, a.lerp(b, 0.6), 0.11, 8); g.cyl(ch, a.lerp(b, 0.55), b, 0.06, 8)
    a = V((2.6 + x0, by, 4.75)); b = V((5.42 + x0, by, 4.72)); g.cyl(yl, a, a.lerp(b, 0.6), 0.1, 8); g.cyl(ch, a.lerp(b, 0.55), b, 0.055, 8)
    a = V((5.62 + x0, by, 4.4)); b = V((6.55 + x0, by, 1.55)); g.cyl(yl, a, a.lerp(b, 0.6), 0.09, 8); g.cyl(ch, a.lerp(b, 0.55), b, 0.05, 8)
    g.beam(dk, (6.55 + x0, by, 1.55), (6.95 + x0, by, 1.2), 0.45, 0.1)
    bk = [(6.3, 1.2), (6.85, 1.3), (7.12, 0.95), (7.12, 0.45), (6.85, 0.12), (6.4, 0.02), (6.05, 0.06), (6.2, 0.5), (6.3, 0.95)]
    g.ext(yl, [(x + x0, z) for x, z in bk], 'y', by - 0.7, by + 0.7)
    for k in range(5):
        yy = by - 0.56 + k * 0.28; g.hexa(dk, [(6.12 + x0, yy - 0.06, 0.03), (6.12 + x0, yy + 0.06, 0.03), (5.9 + x0, yy + 0.04, 0.0), (5.9 + x0, yy - 0.04, 0.0),
                                              (6.12 + x0, yy - 0.06, 0.13), (6.12 + x0, yy + 0.06, 0.13), (5.9 + x0, yy + 0.04, 0.05), (5.9 + x0, yy - 0.04, 0.05)])
    g.obj('excavator')
    return dict(spec=[10.07, 3.32, 4.85], budget='unit', atlas=1024,
                notes='~30 t hydraulic excavator, worn yellow, digging pose with bucket on the ground ahead. Front faces +X; '
                      'origin at ground under the swing centre. Cab on the left (+Y).',
                pv=dict(elev=22, azim=-55))


@asset('prop_dump_truck', 'resource')
def dump_truck():
    yl = MP('paint_yellow_worn'); y2 = MP('paint_yellow'); dk = MP('paint_dark'); rb = MP('rubber'); gl = MP('GLASS_cab'); gv = MP('galv')
    g = G('dump_truck')
    tyre = [(0.55, -0.31), (0.82, -0.31), (0.93, -0.25), (0.95, -0.1), (0.95, 0.1), (0.93, 0.25), (0.82, 0.31), (0.55, 0.31)]
    Mrot = Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4()
    for (x, y) in ((2.55, 1.8), (2.55, -1.8), (-1.55, 1.2), (-1.55, 1.85), (-1.55, -1.2), (-1.55, -1.85)):
        g.lathe(rb, tyre, 18, Matrix.Translation((x, y, 0.95)) @ Mrot, closed=True)
        out = 1 if y > 0 else -1
        if abs(y) > 1.5: g.cyl(MP('paint_grey'), (x, y - out * 0.26, 0.95), (x, y + out * 0.25, 0.95), 0.56, 12)
    for x in (2.55, -1.55): g.cyl(dk, (x, -1.5, 0.95), (x, 1.5, 0.95), 0.2, 8)
    for sy in (-1, 1): g.bb(dk, (-4.2, sy * 0.55 - 0.15, 0.9), (3.9, sy * 0.55 + 0.15, 1.5))
    # front module
    g.bb(yl, (2.3, -0.95, 1.1), (4.2, 0.95, 2.55))
    g.bb(dk, (4.2, -0.85, 1.3), (4.3, 0.85, 2.45))
    for k in range(7): g.bb(MP('galv_dark'), (4.29, -0.82, 1.38 + k * 0.15), (4.32, 0.82, 1.43 + k * 0.15))
    g.bb(dk, (4.3, -2.0, 0.85), (4.5, 2.0, 1.35))
    for sy in (-1, 1): g.bb(MP('GLASS'), (4.48, sy * 1.6 - 0.15, 1.1), (4.51, sy * 1.6 + 0.15, 1.28))
    g.bb(MP('grating'), (2.0, -2.15, 2.55), (4.35, 2.15, 2.65))
    g.rail(y2, [(4.33, -2.1, 2.65), (4.33, 2.1, 2.65), (2.1, 2.1, 2.65)], h=1.0, post=1.0, r=0.022, n=4)
    g.stairs(MP('grating'), (4.17, -1.95, 1.35), (4.17, -0.9, 2.6), w=0.5, mstr=y2)
    # cab
    g.bb(yl, (2.3, 0.65, 2.65), (3.85, 2.05, 3.05))
    g.bb(gl, (2.35, 0.7, 3.05), (3.8, 2.0, 3.85))
    for xa in (2.3, 3.78):
        for ya in (0.65, 1.98): g.bb(dk, (xa, ya, 3.05), (xa + 0.07, ya + 0.07, 3.9))
    g.bb(dk, (2.28, 0.63, 3.85), (3.87, 2.07, 3.95))
    g.cyl(MP('paint_orange'), (3.0, 1.2, 3.95), (3.0, 1.2, 4.03), 0.08, 8)
    g.cyl(dk, (2.6, -1.3, 2.65), (2.6, -1.3, 3.6), 0.18, 10)       # air pre-cleaner
    # body: floor ramps up to the tail, ribbed sides, front wall, canopy
    g.hexa(yl, [(-4.5, -2.12, 2.3), (1.95, -2.12, 1.9), (1.95, 2.12, 1.9), (-4.5, 2.12, 2.3),
                (-4.5, -2.12, 2.5), (1.95, -2.12, 2.1), (1.95, 2.12, 2.1), (-4.5, 2.12, 2.5)])
    for sy in (-1, 1):
        yo, yi = sy * 2.12, sy * 1.98
        g.hexa(yl, [(-4.5, yi, 2.3), (1.95, yi, 1.9), (1.95, yo, 1.9), (-4.5, yo, 2.3), (-4.5, yi, 3.6), (1.95, yi, 3.6), (1.95, yo, 3.6), (-4.5, yo, 3.6)])
        for k in range(6):
            x = -3.9 + k * 1.1; zb = 2.3 - (x + 4.5) / 6.45 * 0.4
            g.bb(yl, (x - 0.08, min(yo, sy * 2.2), zb - 0.15), (x + 0.08, max(yo, sy * 2.2), 3.6))
        g.bb(yl, (-4.5, min(yo, sy * 2.2), 3.5), (1.95, max(yo, sy * 2.2), 3.68))
    g.bb(yl, (1.95, -2.12, 1.9), (2.12, 2.12, 3.95))
    g.bb(yl, (1.95, -2.2, 4.05), (4.45, 2.2, 4.2))
    for sy in (-1, 1): g.beam(yl, (2.1, sy * 1.9, 3.6), (3.6, sy * 2.0, 4.05), 0.15, 0.15)
    g.sphere(MP('ore'), (-1.4, 0.0, 2.95), 1.0, 16, 8, scale=(2.7, 1.85, 0.7))
    # tanks, hoist, mud flaps, mirrors
    g.bb(dk, (-0.45, -1.95, 1.0), (1.45, -1.1, 1.85))
    g.bb(yl, (-0.45, 1.1, 1.0), (1.45, 1.95, 1.85))
    for sy in (-1, 1):
        g.cyl(yl, (0.9, sy * 0.75, 1.3), (-0.2, sy * 0.75, 1.95), 0.13, 8)
        g.bb(MP('rubber'), (-2.65, sy * 1.15, 0.45), (-2.6, sy * 2.15, 1.35))
        g.beam(dk, (4.2, sy * 2.1, 2.9), (4.45, sy * 2.15, 3.3), 0.05, 0.25)
    g.obj('dump_truck')
    return dict(spec=[9.0, 4.4, 4.2], budget='unit', atlas=1024,
                notes='~40 t rigid haul truck, worn yellow, ore load in the body. Front faces +X; origin at ground under the vehicle centre. '
                      'Cab on the left (+Y) under the canopy.', pv=dict(elev=22, azim=-50))


# ════════════════════════════════════════════════════════════════════ 4. INDUSTRIAL
@asset('prop_pipe_gantry', 'industrial')
def pipe_gantry():
    st = paint('paint_rack', (0.30, 0.33, 0.35), rough=0.55, chips=0.3, rust=0.45)
    g = G('pipe_gantry'); cc = MP('concrete_precast'); gv = MP('galv')
    bents = [-9.5, -4.75, 0.0, 4.75, 9.5]
    for x in bents:
        for sy in (-1, 1):
            g.bb(cc, (x - 0.35, sy * 2.0 - 0.35, 0.0), (x + 0.35, sy * 2.0 + 0.35, 0.3))
            g.bb(st, (x - 0.15, sy * 2.0 - 0.15, 0.3), (x + 0.15, sy * 2.0 + 0.15, 5.49))
            g.bb(gv, (x - 0.2, sy * 2.0 - 0.2, 0.3), (x + 0.2, sy * 2.0 + 0.2, 0.33))
        for z in (3.05, 5.25):
            g.bb(st, (x - 0.15, -2.14, z), (x + 0.15, 2.14, z + 0.25))
        for sy in (-1, 1):
            g.beam(st, (x, sy * 2.0, 2.3), (x, sy * 1.2, 3.05), 0.1, 0.1, up=(1, 0, 0))
    for sy in (-1, 1):
        g.bb(st, (-9.64, sy * 2.0 - 0.1, 5.26), (9.64, sy * 2.0 + 0.1, 5.48))
        for a, b in zip(bents[:-1], bents[1:]):
            g.beam(st, (a, sy * 2.0, 3.3), (b, sy * 2.0, 5.25), 0.08, 0.08, up=(0, 1, 0))
    pipes = [  # (y, radius, tier_z, material)
        (-1.45, 0.32, 3.3, paint('paint_pipe_grey', (0.45, 0.46, 0.45), chips=0.2, rust=0.5)),
        (-0.62, 0.22, 3.3, paint('paint_pipe_green', (0.12, 0.30, 0.16), chips=0.2, rust=0.4)),
        (0.12, 0.16, 3.3, paint('paint_pipe_yellow', (0.78, 0.55, 0.05), chips=0.2, rust=0.35)),
        (1.15, 0.38, 3.3, paint('cladding_alu', (0.62, 0.63, 0.63), rough=0.35, metal=0.6, chips=0.0, rust=0.2, seams=1.0, mottle=0.18)),
        (-1.3, 0.15, 5.5, paint('paint_pipe_red', (0.48, 0.06, 0.04), chips=0.2, rust=0.4)),
        (-0.75, 0.15, 5.5, MP('paint_grey')),
        (-0.2, 0.2, 5.5, paint('paint_pipe_white', (0.72, 0.72, 0.70), chips=0.2, rust=0.4))]
    for y, r, zt, m in pipes:
        zc = zt + 0.06 + r
        g.cyl(m, (-10.0, y, zc), (10.0, y, zc), r, 16 if r > 0.25 else 12)
        for x in bents: g.bb(st, (x - 0.15, y - r * 0.6, zt), (x + 0.15, y + r * 0.6, zt + 0.06 + r * 0.3))
        if m.name != 'cladding_alu':
            for x in (-6.0, 6.0): g.cyl(m, (x - 0.04, y, zc), (x + 0.04, y, zc), r + 0.05, 16 if r > 0.25 else 12)
            for x in (-9.95, 9.95): g.cyl(m, (x - 0.05, y, zc), (x + 0.05, y, zc), r + 0.05, 16 if r > 0.25 else 12)
    g.bb(gv, (-10.0, 0.75, 5.5), (10.0, 1.65, 5.52))
    for sy in (0.75, 1.65): g.bb(gv, (-10.0, sy - 0.015, 5.52), (10.0, sy + 0.015, 5.62))
    g.bb(MP('rubber'), (-10.0, 0.85, 5.52), (10.0, 1.4, 5.6))
    # gate valve with handwheel on the green line
    y, r = -0.62, 0.22; zc = 3.3 + 0.06 + r
    g.box(pipes[1][3], (2.4, y, zc), (0.5, 0.56, 0.56)); g.cyl(gv, (2.4, y, zc + 0.28), (2.4, y, zc + 0.75), 0.03, 6)
    g.torus(MP('paint_red'), (2.4, y, zc + 0.75), 0.22, 0.02, 16, 4, smooth=False)
    g.ladder(gv, (9.5, 2.15, 0.3), 5.5, out=(0, 1, 0), step=0.3)
    g.obj('pipe_gantry')
    return dict(spec=[20.0, 4.7, 6.01], budget='building', atlas=1024,
                notes='Two-tier steel pipe rack, 20 m along X (tiles end to end; flanges at the ends), bents every 4.75 m, '
                      'four lines on the lower tier (one aluminium-clad), three lines + cable tray on top, gate valve, access ladder. Origin ground centre.')


@asset('prop_treatment_tank', 'industrial')
def treatment_tank():
    cc = concrete('concrete_tank', joint=0, lifts=None, stain=0.7, damp_z=0.0, damp=0.6, moss=0.3)
    br = paint('paint_bridge_green', (0.10, 0.28, 0.25), rough=0.5, chips=0.3, rust=0.4)
    yl = MP('paint_yellow'); gr = MP('grating'); gv = MP('galv'); dk = MP('paint_dark')
    g = G('clarifier')
    g.lathe(cc, [(14.6, 0.0), (15.0, 0.0), (15.0, 1.2), (14.6, 1.2)], 72, closed=True, smooth=True)
    g.lathe(cc, [(13.6, 0.0), (13.85, 0.0), (13.85, 1.0), (13.6, 1.0)], 72, closed=True, smooth=True)
    g.lathe(MP('concrete_dark'), [(13.85, 0.35), (14.6, 0.35), (14.6, 0.42), (13.85, 0.42)], 72, closed=True, smooth=True)
    g.lathe(water_mat(), [(0.0, 0.93), (3.0, 0.93), (6.5, 0.93), (10.0, 0.93), (13.6, 0.93)], 72, caps=False, recalc=False)
    g.lathe(water_mat(), [(13.85, 0.5), (14.6, 0.5)], 72, caps=False, recalc=False)
    g.lathe(gv, [(12.9, 0.7), (12.95, 0.7), (12.95, 1.15), (12.9, 1.15)], 64, closed=True, smooth=True)
    g.lathe(br, [(2.0, 0.6), (2.08, 0.6), (2.08, 1.45), (2.0, 1.45)], 24, closed=True, smooth=True)
    g.cyl(cc, (0, 0, 0.5), (0, 0, 1.9), 0.8, 16)
    g.cyl(br, (0, 0, 1.9), (0, 0, 2.6), 1.0, 16)
    g.bb(paint('paint_motor', (0.10, 0.22, 0.30), rough=0.45, chips=0.2, rust=0.15), (-0.5, -1.4, 2.0), (0.4, -0.95, 2.6))
    g.obj('clarifier')
    # rotating bridge (pivot at the centre)
    b = G('bridge'); zd = 2.2
    b.bb(gr, (0.6, -0.55, zd - 0.06), (14.4, 0.55, zd))
    for sy in (-1, 1):
        y = sy * 0.6
        b.bb(br, (0.6, y - 0.08, zd - 0.9), (14.4, y + 0.08, zd - 0.75))
        b.bb(br, (0.6, y - 0.08, zd - 0.12), (14.4, y + 0.08, zd))
        for k in range(8):
            x0 = 0.6 + k * 1.725; x1 = x0 + 1.725
            b.beam(br, (x0, y, zd - 0.8), (x1, y, zd - 0.1), 0.06, 0.06, up=(0, 1, 0)); b.beam(br, (x0, y, zd - 0.8), (x0, y, zd - 0.1), 0.06, 0.06, up=(0, 1, 0))
        b.rail(yl, [(0.6, sy * 0.55, zd), (14.4, sy * 0.55, zd)], post=1.8, n=4)
    b.bb(br, (13.9, -0.9, 1.2), (15.0, 0.9, zd - 0.06))
    b.cyl(dk, (14.8, -0.7, 1.45), (14.8, -0.45, 1.45), 0.25, 10)
    b.cyl(dk, (14.8, 0.45, 1.45), (14.8, 0.7, 1.45), 0.25, 10)
    b.bb(paint('paint_motor', (0.10, 0.22, 0.30), rough=0.45, chips=0.2, rust=0.15), (13.95, 0.95, 1.6), (14.6, 1.4, 2.1))
    b.bb(gv, (1.0, 0.7, 0.9), (13.4, 0.78, 1.05))             # scum skimmer blade at the surface
    for x in (4.0, 8.0, 12.0): b.beam(gv, (x, 0.74, 1.0), (x, 0.6, zd - 0.8), 0.04, 0.04)
    b.obj('bridge', pivot=(0, 0, 0))
    return dict(spec=[30.04, 30.0, 3.32], budget='building', atlas=1024,
                notes='Circular clarifier, 30 m OD concrete rim 1.2 m above ground, water at 0.93 m, effluent launder, scum baffle, '
                      'centre drive. Rotating full-radius bridge is object `bridge` with its pivot at the tank centre (rotate about Z).',
                pivots={'bridge': [0, 0, 0]}, pv=dict(elev=30, azim=-58))


@asset('prop_storage_tank', 'industrial')
def storage_tank():
    sh = paint('paint_tank_white', (0.72, 0.73, 0.71), rough=0.45, chips=0.15, rust=0.55, seams=1.8, grime=0.45)
    gv = MP('galv'); yl = MP('paint_yellow'); gr = MP('grating'); cc = concrete('concrete_ringwall', joint=0, stain=0.5, damp=0.6)
    g = G('storage_tank'); R = 6.0
    g.cyl(cc, (0, 0, 0.0), (0, 0, 0.3), R + 0.3, 40)
    g.lathe(sh, [(R, 0.3), (R, 9.0), (R + 0.05, 9.0), (0.25, 10.0), (0.0, 10.0)], 40, caps=True)
    g.lathe(sh, [(R, 7.4), (R + 0.35, 7.4), (R + 0.35, 7.48), (R, 7.48)], 40, closed=True, smooth=True)   # wind girder
    # helical stair around the shell (270 deg)
    n = 40; a0 = math.radians(-100); a1 = math.radians(170); zt = 9.0
    pts_o = []; pts_i = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n; z = 0.3 + (zt - 0.3) * i / n
        pts_o.append((math.cos(a) * (R + 1.0), math.sin(a) * (R + 1.0), z)); pts_i.append((math.cos(a) * (R + 0.1), math.sin(a) * (R + 0.1), z))
        if i < n:
            am = a0 + (a1 - a0) * (i + 0.5) / n; zz = 0.3 + (zt - 0.3) * (i + 1) / n
            c = V((math.cos(am) * (R + 0.55), math.sin(am) * (R + 0.55), zz - 0.02)); t = V((-math.sin(am), math.cos(am), 0))
            g.beam(gr, c - t * 0.14, c + t * 0.14, 0.9, 0.04, up=(0, 0, 1))
    for pts in (pts_o, pts_i):
        for p, q in zip(pts[:-1], pts[1:]): g.beam(gv, p, q, 0.04, 0.2, up=(0, 0, 1))
    g.rail(yl, pts_o, h=1.0, post=1.6, r=0.02, n=4)
    # roof platform, rail, vents, manhole, nozzles, level gauge
    ae = a1; px, py = math.cos(ae), math.sin(ae)
    g.rail(yl, [(math.cos(ae + d_) * (R - 0.15), math.sin(ae + d_) * (R - 0.15), 9.03) for d_ in [k * 0.12 for k in range(8)]], h=1.0, post=1.4, r=0.02, n=4)
    g.cyl(gv, (1.5, 0.5, 9.7), (1.5, 0.5, 10.0), 0.18, 10)
    g.cyl(gv, (-2.0, -1.2, 9.6), (-2.0, -1.2, 9.95), 0.3, 10)
    g.cyl(sh, (R - 0.1, 0, 0.9), (R + 0.35, 0, 0.9), 0.38, 14)
    g.cyl(MP('paint_grey'), (R + 0.35, 0, 0.9), (R + 0.42, 0, 0.9), 0.45, 14)
    for a in (math.radians(200), math.radians(225)):
        c = V((math.cos(a) * R, math.sin(a) * R, 0.75)); o = V((math.cos(a), math.sin(a), 0))
        g.cyl(MP('paint_grey'), c - o * 0.1, c + o * 0.9, 0.16, 12); g.cyl(MP('paint_grey'), c + o * 0.9, c + o * 0.97, 0.24, 12)
    ag = math.radians(-30); c = V((math.cos(ag) * (R + 0.2), math.sin(ag) * (R + 0.2), 0))
    g.bb(MP('paint_white'), (c.x - 0.04, c.y - 0.04, 0.6), (c.x + 0.04, c.y + 0.04, 9.0))
    g.bb(MP('paint_red'), (c.x - 0.07, c.y - 0.07, 6.5), (c.x + 0.07, c.y + 0.07, 6.7))
    g.obj('storage_tank')
    return dict(spec=[13.94, 14.04, 10.05], budget='building', atlas=1024,
                notes='Vertical cone-roof storage tank: shell 12 m diameter x 9 m on a 12.6 m ring wall, cone roof to 10 m, '
                      'helical stair (sets the 14 m envelope), wind girder, manhole, nozzles, level gauge, roof vents. Origin ground centre.',
                pv=dict(elev=24, azim=-60))


def _warehouse(name, L, W, H, eave, roof, clad_col, trim_col, doors_s, doors_n, skylights=True, roof_col=(0.40, 0.42, 0.43)):
    clad = paint(f'clad_{name}', clad_col, rough=0.5, chips=0.15, rust=0.35, corr=(0.2, 'xy'), grime=0.35)
    roofm = paint(f'roof_{name}', roof_col, rough=0.45, chips=0.1, rust=0.55, corr=(0.25, 'x'), grime=0.4, mottle=0.18)
    trim = paint(f'trim_{name}', trim_col, rough=0.45, chips=0.25, rust=0.3)
    plinth = concrete(f'plinth_{name}', joint=4.0, jw=0.012, stain=0.6, damp=0.6)
    shut = paint('roller_shutter_dark', (0.26, 0.29, 0.31), rough=0.45, chips=0.25, rust=0.4, corr=(0.1, 'z'), grime=0.5)
    hz = MP('hazard'); dk = MP('paint_dark'); gl = MP('GLASS'); yl = MP('paint_yellow')
    g = G(name); hx, hy = L / 2 - 0.2, W / 2 - 0.2; t = 0.2
    door_holes_s = [(x - w / 2, x + w / 2, 0.0, h) for (x, w, h, k) in doors_s]
    door_holes_n = [(x - w / 2, x + w / 2, 0.0, h) for (x, w, h, k) in doors_n]
    def cut(holes, a0, a1, z0, z1):
        return [(max(lo, a0), min(hi, a1), max(zl, z0), min(zh, z1)) for lo, hi, zl, zh in holes if zl < z1 and zh > z0]
    for (sy, holes) in ((-1, door_holes_s), (1, door_holes_n)):
        y = sy * (hy - t / 2)
        g.wall(plinth, 'x', y + sy * 0.03, t + 0.06, -hx, hx, 0.0, 1.2, cut(holes, -hx, hx, 0.0, 1.2))
        g.wall(clad, 'x', y, t, -hx, hx, 1.2, eave, cut(holes, -hx, hx, 1.2, eave))
    for sx in (-1, 1):
        x = sx * (hx - t / 2)
        g.wall(plinth, 'y', x + sx * 0.03, t + 0.06, -hy, hy, 0.0, 1.2, [(-0.45, 0.45, 0.0, 2.1)] if sx > 0 else [])
        g.wall(clad, 'y', x, t, -hy, hy, 1.2, eave, [(-0.45, 0.45, 1.2, 2.1)] if sx > 0 else [])
        if roof == 'gable':
            g.ext(clad, [(-hy, eave), (hy, eave), (0.0, H - 0.25)], 'x', x - t / 2, x + t / 2)
        else:
            prof = [(-hy + 2 * hy * i / 16, eave + (H - 0.25 - eave) * math.sin(math.pi * i / 16)) for i in range(17)]
            g.ext(clad, prof, 'x', x - t / 2, x + t / 2)
    # roof
    if roof == 'gable':
        for sy in (-1, 1):
            g.hexa(roofm, [(-L / 2 + 0.05, sy * (W / 2 - 0.05), eave - 0.05), (L / 2 - 0.05, sy * (W / 2 - 0.05), eave - 0.05), (L / 2 - 0.05, 0.0, H - 0.2), (-L / 2 + 0.05, 0.0, H - 0.2),
                           (-L / 2 + 0.05, sy * (W / 2 - 0.05), eave + 0.15), (L / 2 - 0.05, sy * (W / 2 - 0.05), eave + 0.15), (L / 2 - 0.05, 0.0, H), (-L / 2 + 0.05, 0.0, H)])
            if skylights:
                for k in range(int(L // 7.5)):
                    xc = -L / 2 + 3.75 + k * 7.5; f = lambda yy: eave + 0.15 + (H - eave - 0.15) * (1 - abs(yy) / (W / 2 - 0.05))
                    ya, yb = sy * W * 0.12, sy * W * 0.36
                    g.hexa(paint('skylight', (0.70, 0.72, 0.68), rough=0.3, chips=0, rust=0.0, grime=0.5),
                           [(xc - 0.6, ya, f(ya) + 0.005), (xc + 0.6, ya, f(ya) + 0.005), (xc + 0.6, yb, f(yb) + 0.005), (xc - 0.6, yb, f(yb) + 0.005),
                            (xc - 0.6, ya, f(ya) + 0.04), (xc + 0.6, ya, f(ya) + 0.04), (xc + 0.6, yb, f(yb) + 0.04), (xc - 0.6, yb, f(yb) + 0.04)])
    else:
        n = 16; hw = W / 2 - 0.05
        for i in range(n):
            a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
            y0, y1 = -hw * math.cos(a0), -hw * math.cos(a1); z0 = eave + (H - 0.2 - eave) * math.sin(a0); z1 = eave + (H - 0.2 - eave) * math.sin(a1)
            g.hexa(roofm, [(-L / 2 + 0.05, y0, z0 - 0.05), (L / 2 - 0.05, y0, z0 - 0.05), (L / 2 - 0.05, y1, z1 - 0.05), (-L / 2 + 0.05, y1, z1 - 0.05),
                           (-L / 2 + 0.05, y0, z0 + 0.2), (L / 2 - 0.05, y0, z0 + 0.2), (L / 2 - 0.05, y1, z1 + 0.2), (-L / 2 + 0.05, y1, z1 + 0.2)])
    # gutters, corner flashings, downpipes, fascia band
    for sy in (-1, 1):
        g.bb(trim, (-L / 2, sy * (W / 2) - (0.25 if sy > 0 else 0), eave - 0.25), (L / 2, sy * (W / 2) + (0 if sy > 0 else 0.25), eave))
        for k in range(int(L // 15) + 1):
            x = -L / 2 + 1.0 + k * (L - 2.0) / max(1, int(L // 15))
            for (xd, wd, hd, kd) in (doors_s if sy < 0 else doors_n):
                if abs(x - xd) < wd / 2 + 0.8: x = xd + (wd / 2 + 0.9) * (1 if x >= xd else -1)
            g.cyl(trim, (x, sy * (W / 2 - 0.12), 0.0), (x, sy * (W / 2 - 0.12), eave - 0.25), 0.06, 8)
    for sx in (-1, 1):
        for sy in (-1, 1): g.bb(trim, (sx * hx - 0.12, sy * hy - 0.12, 1.2), (sx * hx + 0.12, sy * hy + 0.12, eave))
    # doors
    doors = []
    for sy, lst in ((-1, doors_s), (1, doors_n)):
        y = sy * hy
        for (x, w, h, kind) in lst:
            if kind == 'vehicle':
                g.bb(shut, (x - w / 2, y - sy * 0.17 - 0.03, 0.0), (x + w / 2, y - sy * 0.17 + 0.03, h))
                g.bb(dk, (x - 0.35, min(y, y + sy * 0.18), h + 0.75), (x + 0.35, max(y, y + sy * 0.18), h + 0.9))
                g.bb(MP('GLOW_lamp'), (x - 0.3, min(y + sy * 0.02, y + sy * 0.17), h + 0.73), (x + 0.3, max(y + sy * 0.02, y + sy * 0.17), h + 0.75))
                g.bb(trim, (x - w / 2 - 0.2, min(y, y + sy * 0.18), h), (x + w / 2 + 0.2, max(y, y + sy * 0.18), h + 0.6))
                for sx in (-1, 1):
                    xx = x + sx * (w / 2 + 0.11)
                    g.bb(hz, (xx - 0.11, min(y, y + sy * 0.06), 0.0), (xx + 0.11, max(y, y + sy * 0.06), h))
                doors.append({'kind': 'vehicle', 'center': [round(x, 3), round(sy * W / 2, 3), 0.0], 'clear_w': w, 'clear_h': h, 'facing': '-Y' if sy < 0 else '+Y'})
            else:
                g.bb(dk, (x - w / 2, y - 0.03, 0.0), (x + w / 2, y + 0.03, h))
                g.bb(trim, (x - 0.8, min(y, y + sy * 0.2), h + 0.25), (x + 0.8, max(y, y + sy * 0.2), h + 0.35))
                doors.append({'kind': 'personnel', 'center': [round(x, 3), round(sy * W / 2, 3), 0.0], 'clear_w': w, 'clear_h': h, 'facing': '-Y' if sy < 0 else '+Y'})
                for k in range(2): g.bb(gl, (x - 2.7 - k * 2.0, y - 0.04, 1.4), (x - 1.5 - k * 2.0, y + 0.04, 2.4))
    g.bb(MP('paint_dark'), (hx - 0.03, -0.45, 0.0), (hx + 0.03, 0.45, 2.1))
    for sx in (-1, 1):                                                       # gable louvres
        for k in range(5): g.bb(dk, (sx * hx - 0.12, -1.2, eave + 0.1 + k * 0.19), (sx * hx + 0.12, 1.2, eave + 0.18 + k * 0.19))
    sign = paint('sign_panel', (0.82, 0.83, 0.82), rough=0.4, chips=0.1, rust=0.15, grime=0.3)
    g.bb(sign, (hx, -4.0, eave - 2.3), (hx + 0.05, 4.0, eave - 0.8))
    g.bb(trim, (hx + 0.05, -4.0, eave - 1.8), (hx + 0.06, 4.0, eave - 1.3))
    doors.append({'kind': 'personnel', 'center': [round(L / 2, 3), 0.0, 0.0], 'clear_w': 0.9, 'clear_h': 2.1, 'facing': '+X'})
    g.obj(name)
    return doors


@asset('prop_warehouse_a', 'industrial')
def warehouse_a():
    doors = _warehouse('warehouse_a', 60.0, 30.0, 10.0, 8.6, 'gable', (0.50, 0.52, 0.52), (0.12, 0.24, 0.40),
                       [(-18.0, 6.0, 5.5, 'vehicle'), (0.0, 6.0, 5.5, 'vehicle'), (18.0, 6.0, 5.5, 'vehicle'), (25.5, 0.9, 2.1, 'personnel')],
                       [(-10.0, 6.0, 5.5, 'vehicle'), (12.0, 0.9, 2.1, 'personnel')])
    return dict(spec=[60.0, 30.0, 10.0], budget='building', atlas=1024, doors=doors,
                notes='Portal-frame warehouse 60 x 30 m, eaves 8.6 m, ridge 10 m (ridge along X). Corrugated grey cladding over a '
                      '1.2 m precast plinth, steel-blue trims, skylight strips, roller shutters with hazard jambs. Main doors face -Y.',
                pv=dict(elev=26, azim=-60))


@asset('prop_warehouse_b', 'industrial')
def warehouse_b():
    doors = _warehouse('warehouse_b', 40.0, 20.0, 8.0, 5.6, 'barrel', (0.52, 0.47, 0.38), (0.33, 0.12, 0.08),
                       [(-10.0, 6.0, 4.5, 'vehicle'), (8.0, 6.0, 4.5, 'vehicle'), (16.5, 0.9, 2.1, 'personnel')],
                       [(0.0, 0.9, 2.1, 'personnel')], skylights=False, roof_col=(0.36, 0.36, 0.34))
    return dict(spec=[40.0, 20.0, 8.0], budget='building', atlas=1024, doors=doors,
                notes='Barrel-roof shed 40 x 20 m, eaves 5.6 m, crown 8 m (arched across Y). Sand cladding, oxide-red trims, '
                      'two roller shutters facing -Y.', pv=dict(elev=26, azim=-60))


def _glazed_band(g, axis, c, a0, a1, z0, z1, t, frame, pitch=1.25, out=-1):
    """Recessed ribbon window with vertical mullions."""
    gl = MP('GLASS')
    if axis == 'x':
        g.bb(gl, (a0, c - 0.02, z0), (a1, c + 0.02, z1))
        n = max(1, round((a1 - a0) / pitch))
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n; g.bb(frame, (a - 0.04, c + out * 0.06 - 0.04, z0), (a + 0.04, c + out * 0.06 + 0.04, z1))
        g.bb(frame, (a0, c + out * 0.06 - 0.05, z0 - 0.06), (a1, c + out * 0.06 + 0.05, z0))
    else:
        g.bb(gl, (c - 0.02, a0, z0), (c + 0.02, a1, z1))
        n = max(1, round((a1 - a0) / pitch))
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n; g.bb(frame, (c + out * 0.06 - 0.04, a - 0.04, z0), (c + out * 0.06 + 0.04, a + 0.04, z1))
        g.bb(frame, (c + out * 0.06 - 0.05, a0, z0 - 0.06), (c + out * 0.06 + 0.05, a1, z0))


@asset('prop_office_block', 'industrial')
def office_block():
    wl = concrete('render_office', col=(0.70, 0.69, 0.66), joint=2.5, jw=0.008, lifts=3.5, stain=0.45, chips=0.1, damp=0.4)
    band = paint('panel_band', (0.17, 0.22, 0.28), rough=0.4, chips=0.1, rust=0.1)
    fr = paint('frame_alu', (0.30, 0.31, 0.32), rough=0.35, metal=0.5, chips=0.0, rust=0.0, grime=0.3)
    g = G('office_block'); L, W = 20.0, 12.0; hx, hy = L / 2, W / 2; t = 0.3
    g.bb(MP('concrete_precast'), (-hx, -hy, 0.0), (hx, hy, 0.3))
    win = [(0.5, 3.15, 3.55, 6.25)]
    for sy in (-1, 1):
        y = sy * (hy - t / 2 - 0.03)
        holes1 = [(-hx + 1.0, -1.5, 1.2, 2.8), (2.5, hx - 1.0, 1.2, 2.8)] if sy < 0 else [(-hx + 1.0, hx - 1.0, 1.2, 2.8)]
        g.wall(wl, 'x', y, t, -hx, hx, 0.3, 3.5, holes1 if sy > 0 else [(-hx + 1.0, -2.4, 1.2, 2.8), (2.4, hx - 1.0, 1.2, 2.8), (-1.5, 1.5, 0.3, 3.0)])
        g.wall(wl, 'x', y, t, -hx, hx, 3.5, 7.2, [(-hx + 1.0, hx - 1.0, 4.4, 6.4)])
        g.bb(wl, (-hx, y - t / 2 - 0.0, 7.2), (hx, y + t / 2, 8.0))
        for (a0, a1, z0, z1) in (holes1 if sy > 0 else [(-hx + 1.0, -2.4, 1.2, 2.8), (2.4, hx - 1.0, 1.2, 2.8)]) + [(-hx + 1.0, hx - 1.0, 4.4, 6.4)]:
            _glazed_band(g, 'x', y, a0, a1, z0, z1, t, fr, out=sy)
        g.bb(band, (-hx + 0.02, min(y + sy * (t / 2 - 0.03), y + sy * (t / 2 + 0.03)), 3.05), (hx - 0.02, max(y + sy * (t / 2 - 0.03), y + sy * (t / 2 + 0.03)), 3.85))
    for sx in (-1, 1):
        x = sx * (hx - t / 2)
        g.wall(wl, 'y', x, t, -hy + t, hy - t, 0.3, 8.0, [(-2.0, 2.0, 1.2, 2.8)] if sx < 0 else [(-1.0, 1.0, 4.4, 6.4)])
        _glazed_band(g, 'y', x, -2.0 if sx < 0 else -1.0, 2.0 if sx < 0 else 1.0, 1.2 if sx < 0 else 4.4, 2.8 if sx < 0 else 6.4, t, fr, out=sx)
    g.bb(wl, (-hx + t, -hy + t, 7.0), (hx - t, hy - t, 7.2))               # roof slab
    g.bb(paint('roof_membrane', (0.30, 0.30, 0.29), rough=0.85, chips=0, rust=0, grime=0.5), (-hx + t, -hy + t, 7.2), (hx - t, hy - t, 7.22))
    g.bb(MP('concrete_dark'), (-hx + t, -hy + t, 3.4), (hx - t, hy - t, 3.55))
    # entrance: recessed glazed door, canopy
    g.bb(MP('GLASS'), (-1.5, -hy + 0.1, 0.3), (1.5, -hy + 0.16, 3.0))
    for x in (-1.5, -0.45, 0.45, 1.5): g.bb(fr, (x - 0.04, -hy + 0.04, 0.3), (x + 0.04, -hy + 0.1, 3.0))
    g.bb(fr, (-0.45, -hy + 0.04, 2.38), (0.45, -hy + 0.1, 2.44))
    # rooftop plant (kept under the 8.0 m parapet line)
    for x, y in ((-5.5, 2.0), (-2.5, 2.0)):
        g.bb(MP('paint_white'), (x - 1.0, y - 0.6, 7.22), (x + 1.0, y + 0.6, 7.95))
        g.cyl(MP('paint_dark'), (x, y, 7.95), (x, y, 7.97), 0.45, 12)
    g.bb(MP('galv'), (4.0, -1.0, 7.22), (5.2, 1.0, 7.8))
    for k in range(3): g.cyl(MP('galv'), (7.0, -3.0 + k * 1.0, 7.22), (7.0, -3.0 + k * 1.0, 7.7), 0.12, 8)
    g.bb(MP('paint_grey'), (-8.5, 4.5, 7.22), (-7.7, 5.3, 7.7))
    g.obj('office_block')
    doors = [{'kind': 'personnel', 'center': [0.0, -hy + 0.13, 0.3], 'clear_w': 0.9, 'clear_h': 2.1, 'facing': '-Y'}]
    return dict(spec=[20.0, 12.0, 8.0], budget='building', atlas=1024, doors=doors,
                notes='Two-storey site office 20 x 12 x 8 m (parapet 8.0 m), rendered precast panels with joints, ribbon windows with '
                      'mullions, recessed glazed entrance facing -Y (floor at 0.3 m), rooftop plant below the parapet.', pv=dict(elev=24, azim=-58))


@asset('prop_rail_wagon', 'industrial')
def rail_wagon():
    body = paint('paint_wagon', (0.30, 0.10, 0.055), rough=0.6, chips=0.45, rust=0.8, grime=0.6, dust=0.35)
    dk = MP('paint_dark'); gv = MP('galv_dark'); wh = MP('paint_white')
    g = G('rail_wagon'); bw = 1.46
    for bx in (-5.0, 5.0):
        for ax in (-0.9, 0.9):
            x = bx + ax
            for sy in (-1, 1):
                g.cyl(MP('track'), (x, sy * 0.68, 0.46), (x, sy * 0.82, 0.46), 0.46, 16)
                g.cyl(MP('track'), (x, sy * 0.66, 0.46), (x, sy * 0.68, 0.46), 0.5, 16)
                g.cyl(gv, (x, sy * 0.95, 0.46), (x, sy * 1.12, 0.46), 0.12, 8)
            g.cyl(gv, (x, -0.95, 0.46), (x, 0.95, 0.46), 0.08, 8)
        for sy in (-1, 1):
            sf = [(-1.35, 0.32), (1.35, 0.32), (1.45, 0.6), (1.1, 0.88), (0.45, 0.98), (-0.45, 0.98), (-1.1, 0.88), (-1.45, 0.6)]
            g.ext(dk, [(x + bx, z) for x, z in sf], 'y', sy * 0.92, sy * 1.06)
            for k in (-0.2, 0.2): g.cyl(gv, (bx + k, sy * 1.06, 0.5), (bx + k, sy * 1.06, 0.78), 0.08, 8)
        g.bb(dk, (bx - 0.28, -1.0, 0.75), (bx + 0.28, 1.0, 0.98))
    g.bb(dk, (-7.75, -0.3, 0.98), (7.75, 0.3, 1.4))
    for sx in (-1, 1):
        g.bb(MP('grating'), (sx * 7.0, -1.45, 1.05), (sx * 7.75, 1.45, 1.13))
        g.bb(dk, (sx * 7.7, -1.45, 0.95), (sx * 7.78, 1.45, 1.25))
        g.bb(gv, (sx * 7.75, -0.11, 0.8), (sx * 7.9, 0.11, 0.98))
        g.bb(gv, (sx * 7.86, -0.2, 0.72), (sx * 8.0, 0.2, 1.04))
        for sy in (-1, 1): g.ladder(gv, (sx * 6.95, sy * 1.15, 1.13), 3.9, out=(sx, 0, 0), w=0.4, step=0.33)
        g.rail(MP('paint_yellow'), [(sx * 7.75, -1.4, 1.13), (sx * 7.75, 1.4, 1.13)], h=0.95, post=1.4, r=0.018, mid=True, n=4)
    # hopper body
    for sy in (-1, 1):
        g.bb(body, (-7.0, sy * (bw - 0.06), 1.5), (7.0, sy * bw, 4.0))
        for k in range(15):
            x = -7.0 + k * 1.0; g.bb(body, (x - 0.06, min(sy * bw, sy * 1.5), 1.5), (x + 0.06, max(sy * bw, sy * 1.5), 3.92))
        g.bb(body, (-7.0, min(sy * 1.42, sy * 1.5), 3.86), (7.0, max(sy * 1.42, sy * 1.5), 4.0))
        g.bb(wh, (-5.6, min(sy * 1.5, sy * 1.505), 2.8), (-3.4, max(sy * 1.5, sy * 1.505), 3.4))
    for sx in (-1, 1): g.bb(body, (sx * 6.94, -bw, 1.5), (sx * 7.0, bw, 4.0))
    g.bb(body, (-7.0, -bw, 1.42), (7.0, bw, 1.5))
    for (a, b) in ((-3.9, 0.0), (0.0, 3.9)):
        m_ = (a + b) / 2
        g.hexa(body, [(m_ - 0.45, -0.55, 0.55), (m_ + 0.45, -0.55, 0.55), (m_ + 0.45, 0.55, 0.55), (m_ - 0.45, 0.55, 0.55),
                      (a + 0.05, -bw, 1.42), (b - 0.05, -bw, 1.42), (b - 0.05, bw, 1.42), (a + 0.05, bw, 1.42)])
        g.bb(dk, (m_ - 0.5, -0.6, 0.42), (m_ + 0.5, 0.6, 0.55))
        g.beam(gv, (m_ + 0.5, 0.6, 0.48), (m_ + 0.9, 1.3, 0.75), 0.05, 0.05)
    g.cyl(dk, (-0.5, 0.0, 1.0), (0.5, 0.0, 1.0), 0.25, 10)
    g.torus(gv, (7.06, 0.85, 3.1), 0.24, 0.025, 12, 4, axis=(1, 0, 0), smooth=False)
    g.cyl(gv, (7.0, 0.85, 3.1), (7.1, 0.85, 3.1), 0.04, 6)
    g.sphere(MP('ore'), (0.0, 0.0, 3.45), 1.0, 16, 8, scale=(6.7, 1.38, 0.5))
    g.obj('rail_wagon')
    return dict(spec=[16.0, 3.01, 4.04], budget='unit', atlas=1024,
                notes='Open ore hopper wagon, 16.0 m over couplers on two 3-piece bogies (standard gauge 1.435 m, wheel dia 0.92 m), '
                      'oxide-red and ore-stained, loaded. Origin at rail-top level under the wagon centre; length along X.',
                pv=dict(elev=22, azim=-55))


def _track(g, crossing=False):
    rail_m = paint('rail_steel', (0.24, 0.15, 0.10), rough=0.65, metal=0.4, chips=0.0, rust=0.7, grime=0.4)
    head = paint('rail_head', (0.62, 0.62, 0.62), rough=0.2, metal=0.9, chips=0.0, rust=0.0, grime=0.1, mottle=0.05)
    sl = MP('concrete_precast'); gv = MP('galv_dark')
    if not crossing:
        g.ext(MP('gravel'), [(-2.2, -0.6), (2.2, -0.6), (1.55, -0.2), (-1.55, -0.2)], 'x', -10.0, 10.0)
    for i in range(33):
        x = -9.6 + i * 0.6
        if not crossing: g.bb(sl, (x - 0.13, -1.3, -0.36), (x + 0.13, 1.3, -0.17))
    prof = [(-0.075, -0.16), (0.075, -0.16), (0.075, -0.148), (0.012, -0.13), (0.008, -0.04), (0.036, -0.03), (0.036, 0.0), (-0.036, 0.0), (-0.036, -0.03), (-0.008, -0.04), (-0.012, -0.13), (-0.075, -0.148)]
    for sy in (-1, 1):
        yc = sy * 0.7535
        g.ext(rail_m, [(yc + y, z) for y, z in prof], 'x', -10.0, 10.0)
        g.bb(head, (-10.0, yc - 0.034, -0.002), (10.0, yc + 0.034, 0.0005))
        if not crossing:
            for i in range(33):
                x = -9.6 + i * 0.6; g.bb(gv, (x - 0.05, yc - 0.11, -0.17), (x + 0.05, yc + 0.11, -0.13))
    if crossing:
        pc = concrete('crossing_panel', col=(0.48, 0.47, 0.44), joint=0, stain=0.4, chips=0.4, damp=0.0, grime=0.6)
        g.bb(MP('concrete_dark'), (-10.0, -2.4, -0.36), (10.0, 2.4, -0.2))
        for k in range(8):
            x0 = -10.0 + k * 2.5 + 0.01; x1 = x0 + 2.48
            g.bb(pc, (x0, -0.652, -0.2), (x1, 0.652, 0.0))
            for sy in (-1, 1):
                g.bb(pc, (x0, min(sy * 0.81, sy * 2.4), -0.2), (x1, max(sy * 0.81, sy * 2.4), 0.0))
            for sy in (-1, 1):
                g.bb(MP('rubber'), (x0, min(sy * 0.79, sy * 0.81), -0.2), (x1, max(sy * 0.79, sy * 0.81), -0.005))


@asset('prop_rail_track', 'industrial')
def rail_track():
    g = G('rail_track'); _track(g); g.obj('rail_track')
    return dict(spec=[20.0, 4.4, 0.6], budget='small', atlas=1024,
                notes='20 m straight standard-gauge (1.435 m) track: ballast bed, 33 concrete sleepers at 0.6 m, flat-bottom rails with '
                      'shiny running surface. Origin at RAIL-TOP level (z=0) on the track centre; ballast toe at z=-0.6. Tiles along X.',
                pv=dict(ground=-0.6, elev=26, azim=-60, zoom=0.8))


@asset('prop_rail_crossing', 'industrial')
def rail_crossing():
    g = G('rail_crossing'); _track(g, crossing=True); g.obj('rail_crossing')
    return dict(spec=[20.0, 4.8, 0.36], budget='small', atlas=1024,
                notes='Level-crossing variant of prop_rail_track: rails with precast concrete gauge and field panels (2.5 m slabs), '
                      'rubber flangeway fillers; panel tops and rail tops flush at z=0 so the road surface meets it level. '
                      'Origin rail-top level, track centre; tiles along X with prop_rail_track.',
                pv=dict(ground=-0.02, elev=30, azim=-60, zoom=0.95, ground_mat=MP('asphalt')))


# ════════════════════════════════════════════════════════════════════ 5. BIOME LANDMARKS
@asset('prop_wind_turbine', 'landmark')
def wind_turbine():
    wt = paint('paint_turbine', (0.80, 0.81, 0.81), rough=0.45, chips=0.05, rust=0.12, grime=0.25, mottle=0.06)
    cc = concrete('concrete_foundation', joint=0, stain=0.4, damp=0.5)
    g = G('turbine_tower')
    g.cyl(cc, (0, 0, -0.2), (0, 0, 0.6), 3.3, 32)
    g.lathe(wt, [(2.25, 0.6), (2.2, 22.0), (2.23, 22.0), (2.23, 22.15), (2.12, 22.15), (1.95, 46.0), (1.98, 46.0), (1.98, 46.15), (1.88, 46.15),
                 (1.6, 70.0), (1.5, 78.3), (0.0, 78.3)], 28)
    g.bb(MP('paint_grey'), (-0.5, -2.32, 0.6), (0.5, -2.2, 2.9))
    g.bb(MP('galv'), (-0.9, -3.3, 0.55), (0.9, -2.25, 0.62))
    g.stairs(MP('grating'), (0.0, -4.2, 0.0), (0.0, -3.4, 0.6), w=0.9, mstr=MP('galv'))
    g.bb(MP('paint_white'), (2.8, -2.2, 0.0), (4.6, -0.8, 2.2))          # transformer kiosk
    # nacelle
    nac = [(-0.5, 78.4), (0.5, 78.4), (1.9, 78.9), (2.05, 80.0), (1.9, 81.9), (1.5, 82.35), (-1.5, 82.35), (-1.9, 81.9), (-2.05, 80.0), (-1.9, 78.9)]
    g.ext(wt, nac, 'x', -7.2, 3.1)
    g.hexa(wt, [(-7.2, -1.5, 78.9), (-7.2, 1.5, 78.9), (-8.0, 1.2, 79.4), (-8.0, -1.2, 79.4), (-7.2, -1.5, 82.0), (-7.2, 1.5, 82.0), (-8.0, 1.2, 81.6), (-8.0, -1.2, 81.6)])
    g.bb(MP('paint_grey'), (-6.6, -1.2, 82.35), (-4.6, 1.2, 82.9))      # cooler
    g.cyl(MP('galv'), (-6.8, 0.8, 82.35), (-6.8, 0.8, 83.6), 0.04, 6)
    g.bb(MP('galv'), (-7.0, 0.6, 83.55), (-6.6, 1.0, 83.6))
    g.cyl(MP('galv'), (-6.8, -0.8, 82.35), (-6.8, -0.8, 83.3), 0.04, 6)
    g.sphere(MP('GLOW_red'), (-6.8, -0.8, 83.4), 0.1, 8, 4)
    g.cyl(wt, (0, 0, 78.3), (0, 0, 78.6), 1.6, 24)
    g.obj('turbine_tower')
    # rotor: pivot at the hub centre, rotation axis = X
    hub = V((4.6, 0.0, 80.0)); r = G('rotor')
    r.lathe(wt, [(0.0, -1.6), (1.75, -1.6), (1.8, -0.6), (1.6, 0.6), (1.05, 1.5), (0.0, 2.1)], 20,
            Matrix.Translation(hub) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4())
    bl = paint('paint_blade', (0.82, 0.83, 0.83), rough=0.4, chips=0.0, rust=0.0, grime=0.2, mottle=0.05)
    tip = paint('paint_blade_tip', (0.60, 0.06, 0.04), rough=0.4, chips=0.0, rust=0.0, grime=0.2)
    secs = [(1.6, 1.1, 1.0, 14), (3.0, 2.2, 0.75, 13), (6.0, 3.6, 0.42, 11), (10.0, 3.8, 0.3, 9), (16.0, 3.3, 0.24, 7), (24.0, 2.7, 0.2, 5),
            (32.0, 2.1, 0.17, 3), (40.0, 1.5, 0.15, 1.5), (46.0, 1.0, 0.14, 0.5), (50.0, 0.35, 0.14, 0.0)]
    af = [(1.0, 0.0), (0.75, 0.035), (0.45, 0.06), (0.2, 0.065), (0.05, 0.045), (0.0, 0.0), (0.05, -0.035), (0.2, -0.045), (0.45, -0.035), (0.75, -0.015)]
    for k in range(3):
        th = math.radians(90 + 120 * k); u = V((0, math.cos(th), math.sin(th))); ch_ = V((0, -math.sin(th), math.cos(th))); tk = V((1, 0, 0))
        rings = []
        for rad, chord, tr, tw in secs:
            ring = []; rt = math.radians(tw)
            for (cx, cy) in af:
                cxx = (cx - 0.3) * chord; cyy = cy * chord / max(0.12, tr) * tr if tr < 0.5 else cy / 0.13 * 0.5 * chord * tr
                if rad < 2.0: cxx, cyy = 0.55 * math.cos(TAU * af.index((cx, cy)) / len(af)), 0.55 * math.sin(TAU * af.index((cx, cy)) / len(af))
                a = ch_ * (cxx * math.cos(rt) - cyy * math.sin(rt)) + tk * (cxx * math.sin(rt) + cyy * math.cos(rt))
                ring.append(r.bm.verts.new(hub + u * rad + a))
            rings.append(ring)
        vs = [v for rg in rings for v in rg]; n = len(af)
        for A, B in zip(rings[:-1], rings[1:]):
            for i in range(n):
                j = (i + 1) % n; r.bm.faces.new((A[i], A[j], B[j], B[i]))
        r.bm.faces.new(rings[-1]); r.bm.faces.new(rings[0][::-1])
        fs = r._fin(vs, bl, True)
        bmesh.ops.recalc_face_normals(r.bm, faces=fs)
        for f in fs:
            if (f.calc_center_median() - hub).dot(u) > 45.0:
                if tip not in r.mats: r.mats.append(tip)
                f.material_index = r.mats.index(tip)
    r.obj('rotor', pivot=hub)
    return dict(spec=[14.7, 86.78, 130.2], budget='building', atlas=1024,
                notes='3 MW-class wind turbine: 80 m hub height, 100 m rotor diameter (blade tip radius 50 m, red tip bands). '
                      'Rotor is object `rotor` with its pivot at the hub (4.6, 0, 80); rotation axis = X (rotor faces +X). '
                      'Bounds are the rest pose (one blade vertical): Y extent 86.6 m, top 130 m. Origin tower base centre.',
                pivots={'rotor': [4.6, 0.0, 80.0]}, pv=dict(elev=14, azim=-35))


@asset('prop_solar_array_row', 'landmark')
def solar_array_row():
    tilt = math.radians(25); slope = V((0, math.cos(tilt), math.sin(tilt))); nrm = V((0, -math.sin(tilt), math.cos(tilt)))
    sm = solar_mat('solar_cells', tuple(slope)); al = paint('frame_alu', (0.55, 0.56, 0.57), rough=0.35, metal=0.6, chips=0, rust=0.05, grime=0.3)
    gv = MP('galv'); cc = MP('concrete_precast')
    g = G('solar_row'); pl = 2.0; gap = 0.03; ylo = -(2 * pl + gap) * math.cos(tilt) / 2; z0 = 0.75
    base = V((0, ylo, z0))
    R = Matrix((V((1, 0, 0)), slope, nrm)).transposed().to_4x4()
    for row in range(2):
        for col in range(20):
            cx = -9.5 + col * 1.0; s0 = row * (pl + gap) + pl / 2
            c = base + slope * s0 + nrm * 0.02 + V((cx, 0, 0))
            fs = g.box(al, c, (0.985, pl, 0.04), R)
            for f in fs:
                f.normal_update()
                if f.normal.dot(nrm) > 0.9:
                    if sm not in g.mats: g.mats.append(sm)
                    f.material_index = g.mats.index(sm)
    L = 2 * pl + gap
    for xk in [-9.2 + k * 3.066 for k in range(7)]:
        pf = base + V((xk, 0.35, 0)); pb = base + slope * (L - 0.35) + V((xk, 0, 0))
        g.beam(gv, base + slope * 0.1 + V((xk, 0, -0.08)), base + slope * (L - 0.1) + V((xk, 0, -0.08)), 0.06, 0.1, up=nrm)
        for p in (pf, pb):
            zt = p.z - 0.1 - 0.05
            g.bb(gv, (p.x - 0.05, p.y - 0.04, 0.0), (p.x + 0.05, p.y + 0.04, base.z + (p.y - base.y) * math.tan(tilt) - 0.12))
            g.cyl(cc, (p.x, p.y, -0.05), (p.x, p.y, 0.12), 0.16, 8)
        g.beam(gv, (pb.x, pb.y, 0.25), (pf.x, pf.y, base.z + (pf.y - base.y) * math.tan(tilt) - 0.15), 0.04, 0.04, up=(1, 0, 0))
    for s_ in (0.55, pl - 0.4, pl + gap + 0.4, L - 0.55):
        p = base + slope * s_ - nrm * 0.06; g.beam(gv, p + V((-10.0, 0, 0)), p + V((10.0, 0, 0)), 0.06, 0.05, up=nrm)
    p = base + slope * (L * 0.5) - nrm * 0.2
    g.bb(MP('galv_dark'), (-10.0, p.y - 0.06, p.z - 0.06), (10.0, p.y + 0.06, p.z + 0.02))
    g.bb(MP('paint_grey'), (9.45, -0.5, 0.4), (9.95, -0.25, 1.0))
    g.obj('solar_row')
    return dict(spec=[20.0, 3.67, 2.54], budget='building', atlas=1024,
                notes='Ground-mount PV row 20 m long (X): 2 x 20 portrait modules (1.0 x 2.0 m) tilted 25 deg facing -Y (south), '
                      'galvanised posts on concrete collars, purlins, cable tray, combiner box. Origin ground centre.',
                pv=dict(elev=30, azim=-62))


@asset('prop_research_building', 'landmark')
def research_building():
    wl = concrete('panel_white', col=(0.78, 0.79, 0.78), joint=1.5, jw=0.006, lifts=1.8, stain=0.3, chips=0.05, damp=0.4, speck=0.1)
    fr = paint('frame_alu', (0.30, 0.31, 0.32), rough=0.35, metal=0.5, chips=0.0, rust=0.0, grime=0.3)
    fin = paint('fin_grey', (0.55, 0.57, 0.58), rough=0.4, metal=0.3, chips=0.05, rust=0.05, grime=0.3)
    acc = paint('accent_teal', (0.08, 0.30, 0.34), rough=0.4, chips=0.1, rust=0.05)
    gl = MP('GLASS'); g = G('research_building'); hy = 10.0; t = 0.3
    g.bb(MP('concrete_precast'), (-15.0, -hy, 0.0), (15.0, hy, 0.25))
    # main lab block x -15..9; facade line yw sits 0.6 m inside the footprint so the vertical fins end on it
    yw = hy - 0.6
    for sy in (-1, 1):
        y = sy * (yw - t / 2)
        for (z0, z1, wz0, wz1) in ((0.25, 3.6, 1.0, 3.0), (3.6, 7.6, 4.4, 6.6)):
            holes = [(-14.0, 8.0, wz0, wz1)] if not (sy < 0 and z0 < 1) else [(-14.0, -6.0, wz0, wz1), (-2.0, 8.0, wz0, wz1), (-5.6, -2.4, 0.25, 3.4)]
            g.wall(wl, 'x', y, t, -15.0, 9.0, z0, z1, holes)
            for (a0, a1, zz0, zz1) in holes:
                if zz0 > 0.5: _glazed_band(g, 'x', y, a0, a1, zz0, zz1, t, fr, pitch=1.5, out=sy)
            for k in range(int(22 / 1.5) + 1):
                x = -14.0 + k * 1.5
                if sy < 0 and z0 < 1 and -6.0 < x < -2.0: continue
                g.bb(fin, (x - 0.05, min(sy * yw, sy * (hy - 0.01)), wz0 - 0.1), (x + 0.05, max(sy * yw, sy * (hy - 0.01)), wz1 + 0.1))
        g.bb(acc, (-15.0, min(sy * yw, sy * (yw + 0.05)), 3.3), (9.0, max(sy * yw, sy * (yw + 0.05)), 3.9))
    g.wall(wl, 'y', -15.0 + t / 2, t, -yw + t, yw - t, 0.25, 7.6, [(-4.0, 4.0, 4.4, 6.6)])
    _glazed_band(g, 'y', -15.0 + t / 2, -4.0, 4.0, 4.4, 6.6, t, fr, pitch=1.5, out=-1)
    g.bb(wl, (-14.7, -yw + t, 6.9), (9.0, yw - t, 7.2))
    g.bb(paint('roof_membrane', (0.30, 0.30, 0.29), rough=0.85, chips=0, rust=0, grime=0.5), (-14.7, -yw + t, 7.2), (9.0, yw - t, 7.22))
    # roller door (loading bay) in the south wall, west part
    shut = paint('roller_shutter_dark', (0.26, 0.29, 0.31), rough=0.45, chips=0.25, rust=0.4, corr=(0.1, 'z'), grime=0.5)
    g.bb(shut, (-5.6, -yw + 0.1, 0.25), (-2.4, -yw + 0.2, 3.4))
    g.bb(MP('hazard'), (-5.85, -yw - 0.02, 0.25), (-5.6, -yw + 0.1, 3.4)); g.bb(MP('hazard'), (-2.4, -yw - 0.02, 0.25), (-2.15, -yw + 0.1, 3.4))
    # glazed atrium / stair tower x 9..15 (its curtain wall stands on the footprint line)
    g.bb(gl, (9.0, -hy + 0.1, 0.25), (15.0, 2.0, 8.4))
    for k in range(5):
        x = 9.0 + k * 1.5; g.bb(fr, (x - 0.05, -hy, 0.25), (x + 0.05, -hy + 0.12, 8.4))
    for k in range(9):
        y = -hy + k * 1.5; g.bb(fr, (14.9, y - 0.05, 0.25), (15.0, y + 0.05, 8.4))
    for z in (0.25, 3.0, 5.7, 8.4):
        g.bb(fr, (9.0, -hy, z - 0.05), (15.0, -hy + 0.12, z + 0.05)); g.bb(fr, (14.9, -hy, z - 0.05), (15.0, 2.0, z + 0.05))
    g.bb(wl, (9.0, 2.0, 0.25), (15.0, hy, 8.4))
    g.bb(wl, (8.8, -hy, 8.4), (15.0, hy, 8.7))
    g.bb(fr, (11.2, -hy, 0.25), (12.8, -hy + 0.14, 2.45))
    g.bb(gl, (11.3, -hy + 0.02, 0.3), (12.7, -hy + 0.06, 2.35))
    # rooftop plant room + HVAC
    g.bb(wl, (-12.0, 0.5, 7.22), (-5.0, 8.5, 9.0))
    g.bb(MP('galv'), (-12.2, 0.3, 9.0), (-4.8, 8.7, 9.15))
    for x in (-3.0, -0.5):
        g.bb(MP('paint_white'), (x - 1.0, 4.0, 7.22), (x + 1.0, 6.4, 8.2)); g.cyl(MP('paint_dark'), (x, 5.2, 8.2), (x, 5.2, 8.22), 0.5, 12)
    g.bb(MP('galv'), (-14.0, -hy + 0.4, 7.22), (-8.0, -hy + 0.9, 7.6))
    # satellite dish on a pedestal (elevation 45 deg, facing south)
    dc = V((3.5, 2.5, 8.1)); e = math.radians(45); ax = V((0, -math.cos(e), math.sin(e)))
    Md = Matrix.Translation(dc) @ ax.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    f_ = 1.1; Rd = 1.8
    prof = [(0.0, 0.0)] + [(Rd * k / 6, (Rd * k / 6) ** 2 / (4 * f_)) for k in range(1, 7)]
    dish = paint('paint_dish', (0.85, 0.85, 0.83), rough=0.5, chips=0.05, rust=0.1, grime=0.3)
    g.lathe(dish, prof, 28, Md, caps=False, recalc=False)
    g.lathe(dish, [(Rd, prof[-1][1]), (Rd + 0.06, prof[-1][1]), (Rd + 0.06, prof[-1][1] - 0.06), (Rd, prof[-1][1] - 0.06)], 28, Md, closed=True)
    fp = dc + ax * f_
    for k in range(3):
        a = TAU * k / 3; rim = Md @ V((Rd * 0.97 * math.cos(a), Rd * 0.97 * math.sin(a), prof[-1][1]))
        g.cyl(fin, rim, fp, 0.025, 4, smooth=False)
    g.cyl(MP('paint_grey'), fp - ax * 0.1, fp + ax * 0.15, 0.09, 8)
    g.cyl(fin, dc - ax * 0.05, dc - ax * 0.55, 0.3, 10)
    g.cyl(MP('paint_grey'), (dc.x, dc.y, 7.22), (dc.x, dc.y, dc.z - 0.45), 0.32, 12)
    g.bb(MP('paint_grey'), (dc.x - 0.45, dc.y - 0.2, dc.z - 0.6), (dc.x + 0.45, dc.y + 0.2, dc.z - 0.3))
    g.obj('research_building')
    a = G('antenna'); gv = MP('galv')
    a.cyl(gv, (-7.0, -6.0, 7.22), (-7.0, -6.0, 13.5), 0.06, 6)
    for z in (11.0, 12.5): a.cyl(gv, (-7.6, -6.0, z), (-6.4, -6.0, z), 0.02, 4, smooth=False)
    a.sphere(MP('GLOW_red'), (-7.0, -6.0, 13.55), 0.07, 6, 4)
    ao = a.obj('antenna'); ao['exclude_bounds'] = True
    doors = [{'kind': 'personnel', 'center': [12.0, -hy, 0.25], 'clear_w': 1.4, 'clear_h': 2.1, 'facing': '-Y'},
             {'kind': 'vehicle', 'center': [-4.0, -hy, 0.25], 'clear_w': 3.2, 'clear_h': 3.15, 'facing': '-Y'}]
    return dict(spec=[30.0, 20.0, 10.0], budget='building', atlas=1024, doors=doors,
                notes='Modern two-storey research lab 30 x 20 m: white panel facades with vertical aluminium fins, teal accent band, '
                      'glazed stair atrium at the east end (8.7 m), roof plant, 3.6 m satellite dish (45 deg elevation, facing -Y) '
                      'topping out at 10 m. Rooftop whip antenna (object `antenna`, to 13.6 m) has exclude_bounds.',
                pv=dict(elev=26, azim=-58))


@asset('prop_resort_shell', 'landmark')
def resort_shell():
    rd = concrete('render_faded', col=(0.76, 0.58, 0.45), joint=0, stain=1.4, chips=0.7, damp=1.0, grime=0.85, moss=0.8)
    cs = concrete('concrete_slab_stained', col=(0.50, 0.49, 0.46), joint=0, stain=1.4, chips=0.5, damp=0.8, grime=0.85, moss=0.8)
    void = paint('interior_void', (0.06, 0.055, 0.05), rough=0.9, chips=0, rust=0, grime=0.5, ground=False)
    rusty = paint('rail_rusted', (0.24, 0.11, 0.05), rough=0.75, chips=0.3, rust=1.0, grime=0.5)
    gd = glass('GLASS_dirty', (0.14, 0.15, 0.13), 0.35)
    g = G('resort_shell'); rnd = random.Random(31); hx = 15.0; yf, yb = -5.0, 7.0; t = 0.25
    bays = [-15.0 + k * 3.75 for k in range(9)]
    for fl in range(3):
        z0 = fl * 3.0; zs = z0 + 0.25
        g.bb(cs, (-hx, -7.0 if fl > 0 else yf, z0), (hx, yb, zs))                   # floor slab (balconies cantilever on floors 1-2)
        holes_f = []; holes_b = []
        for k in range(8):
            a0, a1 = bays[k] + 0.55, bays[k + 1] - 0.55
            holes_f.append((a0, a1, zs, zs + 2.3)); holes_b.append((bays[k] + 1.1, bays[k + 1] - 1.1, zs + 0.9, zs + 2.2))
        g.wall(rd, 'x', yf + t / 2, t, -hx, hx, zs, z0 + 3.0, holes_f if fl > 0 else [(bays[k] + 0.55, bays[k + 1] - 0.55, zs, zs + 2.3) for k in range(8) if k not in (3, 4)] + [(bays[3] + 0.3, bays[5] - 0.3, zs, zs + 2.5)])
        g.wall(rd, 'x', yb - t / 2, t, -hx, hx, zs, z0 + 3.0, holes_b)
        for sx in (-1, 1): g.wall(rd, 'y', sx * (hx - t / 2), t, yf + t, yb - t, zs, z0 + 3.0, [(-1.0, 1.0, zs + 0.9, zs + 2.2)] if fl > 0 else [])
        ztop = min(z0 + 2.99, 8.49)
        g.bb(void, (-hx + t, 0.85, zs), (hx - t, 1.15, ztop))                 # corridor wall (dark interior)
        for x in bays[1:-1]: g.bb(void, (x - 0.1, yf + t, zs), (x + 0.1, 0.85, ztop))
        # glazing: some intact, many broken (shards), others empty
        for k in range(8):
            r_ = rnd.random(); a0, a1 = bays[k] + 0.55, bays[k + 1] - 0.55
            if fl == 0 and k in (3, 4): continue
            if r_ < 0.25: g.bb(gd, (a0, yf + 0.1, zs), (a1, yf + 0.14, zs + 2.3))
            elif r_ < 0.6:
                xm = a0 + (a1 - a0) * rnd.uniform(0.3, 0.7)
                g.poly(gd, [(a0, yf + 0.12, zs), (xm, yf + 0.12, zs), (a0, yf + 0.12, zs + rnd.uniform(0.8, 1.9))])
                g.poly(gd, [(a1, yf + 0.12, zs + 2.3), (a1 - rnd.uniform(0.3, 0.9), yf + 0.12, zs + 2.3), (a1, yf + 0.12, zs + 2.3 - rnd.uniform(0.4, 1.2))])
            r2 = rnd.random(); b0, b1 = bays[k] + 1.1, bays[k + 1] - 1.1
            if r2 < 0.3: g.bb(gd, (b0, yb - 0.14, zs + 0.9), (b1, yb - 0.1, zs + 2.2))
            elif r2 < 0.65: g.poly(gd, [(b0, yb - 0.12, zs + 0.9), (b1, yb - 0.12, zs + 0.9), (b0 + 0.3, yb - 0.12, zs + 1.7)])
        # balconies: parapets (some concrete, some rusted rails, some gone)
        if fl > 0:
            for k in range(8):
                a0, a1 = bays[k] + 0.05, bays[k + 1] - 0.05; r_ = rnd.random()
                if r_ < 0.45: g.bb(rd, (a0, -7.0, zs), (a1, -6.85, zs + 1.0))
                elif r_ < 0.85:
                    pts = [(a0, -6.92, zs), (a1, -6.92, zs)]
                    g.rail(rusty, pts, h=1.0, post=1.2, r=0.022, n=4)
                    if rnd.random() < 0.4: g.beam(rusty, (a1 - 0.3, -6.92, zs + 1.0), (a1 - 1.2, -6.6, zs + 0.2), 0.04, 0.04)
    # roof slab, parapet, tank stand remains, debris
    g.bb(cs, (-hx + t, yf + t, 8.75 - 0.25), (hx - t, yb - t, 8.75))
    for x in (-10.0, -9.0): g.bb(rusty, (x - 0.06, 3.0, 8.75), (x + 0.06, 3.12, 8.98))
    g.bb(rusty, (-10.2, 2.9, 8.95), (-8.8, 3.3, 9.0))
    for k in range(6):
        x = rnd.uniform(-12, 12); y = rnd.uniform(-4, 6); s_ = rnd.uniform(0.2, 0.6)
        g.box(cs, (x, y, 8.75 + s_ * 0.15), (s_, s_ * 0.8, s_ * 0.3), (0, 0, rnd.random()))
    # open lobby columns on the ground floor
    for x in (bays[3] + 0.3, bays[5] - 0.3): g.bb(cs, (x - 0.2, yf - 0.3, 0.25), (x + 0.2, yf + 0.1, 3.0))
    g.obj('resort_shell')
    return dict(spec=[30.0, 14.0, 9.0], budget='building', atlas=1024,
                notes='Abandoned 3-storey resort block 30 x 12 m plus 2 m balconies on the -Y (sea) side: faded peach render, heavy rain '
                      'stains, mildew and spalling, gutted dark interiors, mostly broken glazing (dirty shards), rusted/missing balcony rails, '
                      'roof debris. Origin ground centre of the 30 x 14 envelope.', pv=dict(elev=22, azim=-60))


@asset('prop_tunnel_portal', 'landmark')
def tunnel_portal():
    """Sealed road tunnel portal for a 24 m road (28 m clear arch incl. walkways). Road runs along Y into the hill (+Y);
    the portal face is at y=0 facing -Y; origin = road surface level on the road centreline at the portal face."""
    cc = concrete('concrete_portal', joint=4.0, jw=0.012, lifts=1.5, stain=0.9, chips=0.3, damp=0.7, moss=0.4)
    ring = concrete('concrete_ring', col=(0.58, 0.57, 0.53), joint=0, stain=0.7, chips=0.3)
    st = paint('paint_bulkhead', (0.38, 0.40, 0.41), rough=0.5, chips=0.3, rust=0.5, corr=(0.3, 'x'))
    rk = rock('granite')
    g = G('portal'); hw, spr, rise, top, dep = 14.0, 5.0, 5.0, 13.5, 3.0
    xs = [-hw + 2 * hw * i / 20 for i in range(21)]
    az = lambda x: spr + rise * math.sqrt(max(0.0, 1 - (x / hw) ** 2))
    for a, b in zip(xs[:-1], xs[1:]):
        g.ext(cc, [(a, az(a)), (b, az(b)), (b, top), (a, top)], 'y', 0.0, dep)
    for sx in (-1, 1):
        g.ext(cc, [(sx * hw, 0.0), (sx * 18.0, 0.0), (sx * 18.0, top), (sx * hw, top)], 'y', 0.0, dep)
        # wingwalls with sloped tops
        p0 = V((sx * 18.0, 0.0, 0)); p1 = V((sx * 23.5, -8.0, 0)); tt = V((sx * 0.8, 0.55, 0))
        g.hexa(cc, [(p0.x, p0.y, 0.0), (p1.x, p1.y, 0.0), (p1.x + tt.x, p1.y + tt.y, 0.0), (p0.x + tt.x, p0.y + tt.y, 0.0),
                    (p0.x, p0.y, top), (p1.x, p1.y, 2.0), (p1.x + tt.x, p1.y + tt.y, 2.0), (p0.x + tt.x, p0.y + tt.y, top)])
        g.bb(cc, (sx * 12.0, 0.0, 0.0), (sx * hw, dep + 0.5, 0.25))               # walkway kerbs
    # arch ring (voussoir band) proud of the face
    for a, b in zip(xs[:-1], xs[1:]):
        na = V((a / hw, 0, (az(a) - spr) / rise)).normalized(); nb = V((b / hw, 0, (az(b) - spr) / rise)).normalized()
        g.ext(ring, [(a, az(a)), (b, az(b)), (b + nb.x * 0.9, az(b) + nb.z * 0.9), (a + na.x * 0.9, az(a) + na.z * 0.9)], 'y', -0.25, 0.0)
    g.bb(ring, (-18.3, -0.35, top - 0.6), (18.3, dep, top))                      # coping
    g.rail(MP('galv'), [(-18.0, 0.2, top), (18.0, 0.2, top)], post=1.8, n=4)
    g.bb(MP('asphalt'), (-12.0, 0.0, 0.0), (12.0, dep, 0.02))
    # sealed bulkhead with doors and signage
    arch = [(x, az(x)) for x in xs[::-1]]
    g.ext(st, [(-hw, 0.0), (hw, 0.0)] + [(hw, spr)] + arch[1:-1] + [(-hw, spr)], 'y', dep - 0.5, dep)
    hzd = MP('hazard')
    for sx in (-1, 1):
        g.bb(MP('paint_grey'), (sx * 0.3, dep - 0.62, 0.0), (sx * 6.0, dep - 0.5, 6.0))
        g.bb(hzd, (sx * 0.3, dep - 0.66, 0.0), (sx * 6.0, dep - 0.62, 0.8))
    g.bb(MP('paint_dark'), (8.0, dep - 0.6, 0.25), (9.0, dep - 0.5, 2.35))
    g.cyl(MP('paint_red'), (0.0, dep - 0.62, 7.6), (0.0, dep - 0.7, 7.6), 0.75, 20)
    g.bb(MP('paint_sign_white') if _got('paint_sign_white') else paint('paint_sign_white', (0.86, 0.86, 0.84), rough=0.35, chips=0.05, rust=0.1, grime=0.25),
         (-0.5, dep - 0.72, 7.47), (0.5, dep - 0.7, 7.73))
    g.obj('portal')
    # granite hillside the portal is set into (heightfield, flat-shaded facets)
    hg = G('rock'); bm = hg.bm; nx, ny = 44, 26; X0, X1, Y0, Y1 = -32.0, 32.0, -10.0, 26.0
    def yf(x):
        ax = abs(x)
        if ax <= 18.0: return dep - 0.2
        if ax <= 23.5: return 0.0 - (ax - 18.0) * (8.0 / 5.5) + 0.6
        return -8.0 + 0.6 - (ax - 23.5) * 0.25
    def hh(x, y):
        f = min(1.0, max(0.0, (y - yf(x)) / 2.2)); f = f * f * (3 - 2 * f)
        edge = min(1.0, (32.0 - abs(x)) / 7.0, (26.0 - y) / 9.0); edge = max(0.0, edge); edge = edge * edge * (3 - 2 * edge)
        H = 20.5 * math.exp(-(x / 25.0) ** 2) * (1 - 0.25 * max(0.0, y) / 26.0) + 3.0
        n = 2.4 * mnoise.noise(V((x * 0.09, y * 0.09, 0.3))) + 1.2 * mnoise.noise(V((x * 0.3, y * 0.3, 4.1))) + 0.6 * abs(mnoise.noise(V((x * 0.8, y * 0.8, 7.7))))
        if abs(x) < 18.0 and y < dep + 2.5: H = max(H, top + 0.6)
        return max(0.0, (H + n) * f * edge)
    vg = [[bm.verts.new((X0 + (X1 - X0) * i / nx, Y0 + (Y1 - Y0) * j / ny, 0.0)) for j in range(ny + 1)] for i in range(nx + 1)]
    for col in vg:
        for v in col: v.co.z = hh(v.co.x, v.co.y)
    vs = []
    for i in range(nx):
        for j in range(ny):
            q = (vg[i][j], vg[i + 1][j], vg[i + 1][j + 1], vg[i][j + 1])
            if max(v.co.z for v in q) < 0.05: continue
            bm.faces.new(q)
    for v in list(bm.verts):
        if not v.link_faces: bm.verts.remove(v)
    hg._fin(list(bm.verts), rk, False)
    hg.obj('rock')
    return dict(spec=[64.0, 36.0, 22.87], budget='building', atlas=1024,
                notes='Sealed concrete road-tunnel portal for a 24 m road (28 m clear elliptical arch incl. walkways, crown 10 m), '
                      'headwall 36 m wide x 13.5 m, splayed wingwalls, precast arch ring and coping with railing, steel bulkhead with '
                      'hazard-banded doors and a no-entry sign, set into a faceted granite hillside (object `rock`). Road runs along Y '
                      'into the hill (+Y); portal face at y=0 faces -Y; origin road level on the centreline at the portal face.',
                pv=dict(elev=20, azim=-70))


@asset('prop_radio_mast', 'landmark')
def radio_mast():
    bands = paint('paint_mast_bands', (0.80, 0.80, 0.78), rough=0.5, metal=0.2, chips=0.25, rust=0.35, bands=((0.85, 0.22, 0.03), 40.0 / 7 * 2, 0.0))
    gv = MP('galv'); g = G('radio_mast'); cc = MP('concrete_precast')
    Hl = 37.5; rb, rt = 1.4, 0.7
    leg = lambda k, z: (lambda r: (r * math.cos(TAU * k / 3 + math.pi / 2), r * math.sin(TAU * k / 3 + math.pi / 2), z))(rb + (rt - rb) * z / Hl)
    g.bb(cc, (-2.2, -2.2, -0.1), (2.2, 2.2, 0.15))
    for k in range(3):
        p = leg(k, 0.15); g.bb(cc, (p[0] - 0.35, p[1] - 0.35, 0.15), (p[0] + 0.35, p[1] + 0.35, 0.5))
        g.cyl(bands, leg(k, 0.5), leg(k, Hl), 0.07, 6, r2=0.05, smooth=False)
    lv = [0.5 + (Hl - 0.5) * i / 12 for i in range(13)]
    for i, z in enumerate(lv):
        for k in range(3):
            a, b = leg(k, z), leg((k + 1) % 3, z)
            g.cyl(bands, a, b, 0.03, 4, smooth=False)
            if i < 12:
                z2 = lv[i + 1]; g.cyl(bands, a if i % 2 == 0 else b, leg((k + 1) % 3, z2) if i % 2 == 0 else leg(k, z2), 0.025, 4, smooth=False)
    # platform, antennas, dishes, rod, lights
    tri = [leg(k, Hl - 1.5)[:2] for k in range(3)]
    ctr = [(x * 1.9, y * 1.9) for x, y in tri]
    g.prism(MP('grating'), ctr, Hl - 1.55, Hl - 1.5)
    g.rail(gv, [(*p, Hl - 1.5) for p in ctr + [ctr[0]]], h=1.0, post=1.0, r=0.02, n=4)
    for k in range(3):
        a = TAU * k / 3 + math.pi / 6; c = V((1.2 * math.cos(a), 1.2 * math.sin(a), Hl + 0.2))
        g.cyl(gv, c - V((0, 0, 1.8)), c + V((0, 0, 1.2)), 0.04, 6)
        g.box(MP('paint_white'), c + V((0.15 * math.cos(a), 0.15 * math.sin(a), 0.4)), (0.3, 0.14, 1.8), (0, 0, a))
    for k, z in ((0, 31.0), (1, 26.0)):
        a = TAU * k / 3 + math.pi / 6 + 0.4; c = V((1.25 * math.cos(a), 1.25 * math.sin(a), z)); o = V((math.cos(a), math.sin(a), 0))
        g.lathe(MP('paint_white'), [(0.0, 0.0), (0.45, 0.12), (0.5, 0.25), (0.0, 0.3)], 16, Matrix.Translation(c) @ o.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    g.cyl(gv, (0, 0, Hl - 1.5), (0, 0, 40.0), 0.03, 6)
    for z in (Hl - 0.6, 20.0):
        p = leg(0, z); g.sphere(MP('GLOW_red'), (p[0], p[1] + 0.12, z + 0.1), 0.09, 8, 4)
    g.sphere(MP('GLOW_red'), (0, 0, 39.3), 0.09, 8, 4)
    # ladder up one face, feeder cable ladder
    p0 = V(leg(0, 0.5)); g.ladder(gv, (p0.x, p0.y, 0.5), Hl - 1.5, out=(0, 1, 0), w=0.4, step=0.35)
    g.bb(MP('galv_dark'), (0.3, 0.3, 0.5), (0.45, 0.4, Hl - 1.5))
    g.bb(MP('paint_grey'), (1.5, -2.1, 0.15), (2.15, -1.3, 1.9))
    g.obj('radio_mast')
    return dict(spec=[4.4, 4.4, 40.1], budget='building', atlas=1024,
                notes='40 m triangular lattice mast in orange/white aviation bands (7 bands), top platform with railing, three panel '
                      'antennas, two microwave dishes, lightning rod to 40 m, red obstruction lights (GLOW_red), climb ladder, '
                      'equipment cabinet on a 4.4 m concrete pad. Origin ground at the mast axis.', pv=dict(elev=18, azim=-55))


@asset('prop_water_tower', 'landmark')
def water_tower():
    tk = paint('paint_watertower', (0.52, 0.62, 0.66), rough=0.5, chips=0.3, rust=0.6, seams=1.4, grime=0.45)
    gv = MP('galv'); gr = MP('grating'); cc = MP('concrete_precast'); g = G('water_tower')
    zb = 16.0; Rt = 5.0
    corner = lambda sx, sy, z: (sx * (4.0 - 1.2 * z / zb), sy * (4.0 - 1.2 * z / zb), z)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = corner(sx, sy, 0.0); g.bb(cc, (p[0] - 0.55, p[1] - 0.55, -0.1), (p[0] + 0.55, p[1] + 0.55, 0.5))
            g.cyl(tk, corner(sx, sy, 0.5), corner(sx, sy, zb + 0.6), 0.22, 10)
    lv = [0.5, 5.5, 10.8, zb]
    for i, z in enumerate(lv):
        for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            if i > 0: g.cyl(tk, corner(*a, z), corner(*b, z), 0.12, 6, smooth=False)
            if i < len(lv) - 1:
                z2 = lv[i + 1]
                g.cyl(gv, corner(*a, z), corner(*b, z2), 0.025, 4, smooth=False); g.cyl(gv, corner(*b, z), corner(*a, z2), 0.025, 4, smooth=False)
    g.cyl(tk, (0, 0, 0.3), (0, 0, zb - 0.9), 0.45, 12)
    g.cyl(cc, (0, 0, -0.1), (0, 0, 0.3), 0.8, 12)
    g.lathe(tk, [(0.0, zb - 1.0), (2.5, zb - 0.75), (4.3, zb - 0.2), (Rt, zb + 0.5), (Rt, zb + 6.0), (Rt + 0.05, zb + 6.0), (0.6, zb + 8.0), (0.0, zb + 8.0)], 32)
    g.cyl(tk, (0, 0, zb + 8.0), (0, 0, zb + 8.35), 0.5, 12)
    g.cyl(tk, (0, 0, zb + 8.35), (0, 0, zb + 8.45), 0.7, 12, r2=0.1)
    g.cyl(gv, (0, 0, zb + 8.45), (0, 0, zb + 8.8), 0.02, 4)
    # balcony ring + railing
    g.lathe(gr, [(Rt, zb + 0.45), (Rt + 0.85, zb + 0.45), (Rt + 0.85, zb + 0.52), (Rt, zb + 0.52)], 32, closed=True, smooth=False)
    g.rail(MP('paint_yellow'), ring_pts(Rt + 0.82, 28, zb + 0.52), h=1.05, post=1.25, r=0.02, n=4)
    for k in range(8):
        a = TAU * k / 8 + math.pi / 8; g.beam(tk, (Rt * math.cos(a), Rt * math.sin(a), zb + 0.35), ((Rt + 0.8) * math.cos(a), (Rt + 0.8) * math.sin(a), zb + 0.45), 0.08, 0.15)
    # ladders: riser to balcony, shell to roof
    g.ladder(gv, (0.0, -0.45, 0.3), zb + 0.5, out=(0, -1, 0), w=0.4, step=0.3, cage=True)
    g.ladder(gv, (Rt, 0.0, zb + 0.52), zb + 6.0, out=(1, 0, 0), w=0.4, step=0.3)
    g.obj('water_tower')
    return dict(spec=[11.7, 11.7, 24.9], budget='building', atlas=1024,
                notes='Elevated steel water tower: 4 battered legs with struts and tension-rod bracing, central riser, 10 m tank '
                      '(bottom 15-16.5 m, shell to 22 m, cone roof to 24 m, vent/finial 24.8 m), balcony with railing, caged ladder. '
                      'Origin ground centre.', pv=dict(elev=18, azim=-55))


ORDER = ['prop_gantry_crane', 'prop_rtg_crane', 'prop_bollard', 'prop_fender', 'prop_life_ring_post', 'prop_nav_buoy_red', 'prop_nav_buoy_green',
         'prop_harbour_light', 'prop_street_light', 'prop_utility_cabinet', 'prop_jersey_barrier', 'prop_safety_barrier', 'prop_fence_segment',
         'prop_road_sign', 'prop_culvert_end', 'prop_drainage_grate', 'prop_gravel_pile', 'prop_conveyor', 'prop_excavator', 'prop_dump_truck',
         'prop_pipe_gantry', 'prop_treatment_tank', 'prop_storage_tank', 'prop_warehouse_a', 'prop_warehouse_b', 'prop_office_block',
         'prop_rail_wagon', 'prop_rail_track', 'prop_rail_crossing', 'prop_wind_turbine', 'prop_solar_array_row', 'prop_research_building',
         'prop_resort_shell', 'prop_tunnel_portal', 'prop_radio_mast', 'prop_water_tower']


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('what', nargs='?', default='all'); ap.add_argument('--glb', action='store_true')
    ap.add_argument('--no-preview', action='store_true'); ap.add_argument('--list', action='store_true')
    a = ap.parse_args(argv)
    if a.list:
        for n in ORDER: print(n, REG[n][1])
        return
    names = ORDER if a.what == 'all' else [n for n in ORDER if REG[n][1] == a.what] or [n for n in a.what.split(',')]
    for n in names:
        if n not in REG: raise SystemExit(f'unknown asset {n}')
    for n in names: run(n, glb=a.glb, do_preview=not a.no_preview)


if __name__ == '__main__':
    main(sys.argv[1:])
