"""Export each generated map for the web Map Lab (maps/lab/data/<id>/):
  height.png   16-bit grey, 4 m/px, z = value / 500 - 40  (row 0 = NORTH edge, i.e. standard image orientation)
  surface.png  8-bit class ids at 4 m (255 = water), see SURF in place.py
  nav.png      8-bit bitfield at 4 m: 1 infantry, 2 tank, 4 harvester, 8 amphibious, 16 ship (a 4 m cell is passable only if all four 2 m cells are)
  deck.png     8-bit: 255 where a bridge/dock/trestle deck carries land traffic over water
  instances.json  {asset: [[x, y, z, rot, scale, team(0 none/1 B/2 R)], ...]}  (veg grass excluded)
  map.json     metadata: size, roads (xy, z, bridge flags, clear width), pads, deposits (+service points), docks, landmarks,
               beaches, bridges, harvester test routes, coarse collision boxes, camera presets (from the Blender scene definitions), validation summary.
Run: blender-env/bin/python maps/gen/export_web.py <id|all>
"""
import json, sys, math
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from mapgen import LAYOUT
from navcheck import SPEED, PACE   # movement-class speeds (harvester = ratio × tank, from data/pace.json)

ROOT = Path(__file__).resolve().parents[1]

def down(a, k, how):
    n = (a.shape[0] - 1) // k * k + 1; a = a[:n, :n]
    if how == 'sample': return a[::k, ::k]
    b = a[:n - 1, :n - 1].reshape((n - 1) // k, k, (n - 1) // k, k)
    if how == 'and': return np.bitwise_and.reduce(np.bitwise_and.reduce(b, axis=3), axis=1)
    if how == 'max': return b.max(axis=(1, 3))

def collision_boxes(inst):
    """Coarse static collision, identical to the Blender scene's COLLISION mesh: [x, y, z, min_x, min_y, min_z, max_x, max_y, max_z, rot]
    per blocking footprint (local bounds from the measured asset bounds, scaled)."""
    from assets import info
    out = []
    for it in inst['items']:
        a = info(it['asset'])
        if not it.get('block', a['blocking']) or a['kind'] == 'veg': continue  # same blocking set as navigation
        bb = a.get('bounds'); sxy = it['s']; sz = it.get('sz', it['s'])
        lo, hi = (bb['min'], bb['max']) if bb and 'min' in bb else ([-a['size'][0] / 2, -a['size'][1] / 2, 0.0], [a['size'][0] / 2, a['size'][1] / 2, a['size'][2]])
        out.append([round(it['x'], 2), round(it['y'], 2), round(it['z'], 2), *(round(v * k, 2) for v, k in zip(lo, (sxy, sxy, sz))), *(round(v * k, 2) for v, k in zip(hi, (sxy, sxy, sz))), round(it['rot'], 4)])
    return out

def export(mid):
    b = ROOT / 'build' / mid; out = ROOT / 'lab' / 'data' / mid; out.mkdir(parents=True, exist_ok=True)
    h = np.load(b / 'height.npy'); meta = json.loads((b / 'meta.json').read_text()); inst = json.loads((b / 'instances.json').read_text())
    surf = np.load(b / 'surface.npz')['surf']; nav = np.load(b / 'nav.npz'); bits = nav['bits']; deck = nav['deck']
    k = 2; R = meta['res'] * k
    hh = down(h, k, 'sample'); enc = np.clip((hh + 40) * 500, 0, 65535).astype(np.uint16)
    Image.fromarray(np.ascontiguousarray(enc[::-1])).save(out / 'height.png')
    # raw little-endian binaries (row 0 = SOUTH edge, x fastest) — what the Map Lab actually loads; PNGs are for inspection
    hh.astype('<f4').tofile(out / 'height.f32'); down(surf, k, 'sample').astype(np.uint8).tofile(out / 'surface.u8')
    down(bits, k, 'and').astype(np.uint8).tofile(out / 'nav.u8'); down(deck.astype(np.uint8), k, 'max').astype(np.uint8).tofile(out / 'deck.u8')
    Image.fromarray(down(surf, k, 'sample')[::-1].astype(np.uint8)).save(out / 'surface.png')
    Image.fromarray(down(bits, k, 'and')[::-1].astype(np.uint8)).save(out / 'nav.png')
    Image.fromarray((down(deck.astype(np.uint8), k, 'max') * 255)[::-1].astype(np.uint8)).save(out / 'deck.png')
    groups = {}
    for it in inst['items']:
        t = {'B': 1, 'R': 2}.get(it.get('team'), 0)
        groups.setdefault(it['asset'], []).append([round(it['x'], 2), round(it['y'], 2), round(it['z'], 2), round(it['rot'], 3), round(it['s'] * (it.get('sz', 1) if 'sz' in it else 1), 3), t] + ([round(it['sz'], 3)] if 'sz' in it else []))
    (out / 'instances.json').write_text(json.dumps(groups, separators=(',', ':')))
    val = json.loads((b / 'validation.json').read_text()) if (b / 'validation.json').exists() else {}
    roads = [{'id': r['id'], 'kind': r['kind'], 'clear_w': r['clear_w'], 'xy': [[round(p[0], 1), round(p[1], 1)] for p in r['xy'][::2]], 'z': [round(z, 2) for z in r['z'][::2]],
              'bridge': r['bridge'][::2], 'on_beach': r.get('on_beach', [False] * len(r['xy']))[::2]} for r in meta['roads']]
    S = meta['size_m']; pads = meta['pads']; bpad = next(p for p in pads if p['team'] == 'B'); c = bpad['center']; zb = bpad['h']
    dk = next((d for d in meta['docks'] if d['player'][0] == 'B'), meta['docks'][0] if meta['docks'] else None)
    kits = inst.get('kits', {}); kit = kits.get(bpad['id'], {'sx': 1, 'sy': 1}); K = lambda x, y: [c[0] + kit['sx'] * x, c[1] + kit['sy'] * y]  # kit mirrored per start
    g = K(-20, -10)
    presets = [{'key': 'overview', 'title': 'Entire-map overview', 'pos': [S / 2, S / 2, S * 1.15], 'target': [S / 2, S / 2 + 1, 0]},
               {'key': 'gameplay', 'title': 'Standard gameplay view', 'pos': [g[0] - 70, g[1] - 140, zb + 150], 'target': [*g, zb]},
               {'key': 'base', 'title': 'Base close-up', 'pos': [*K(-46, -32), zb + 1.9], 'target': [*K(-20, -2), zb + 3.2]}]
    pads = [dict(p, rally=kits[p['id']]['rally'], kit=kits[p['id']]['transform'], refinery_bays=kits[p['id']]['refinery_bays']) if p['id'] in kits else p for p in pads]
    refs = [it for it in inst['items'] if it['asset'] == 'bld_ore_refinery']
    def docks_for(bays):  # each bay approach point → the grate of the refinery whose bay axis it sits on (bounds: unload point (7.5, -5.2) local)
        out = []
        for b in bays:
            best = None
            for it in refs:
                cr, sr = math.cos(it['rot']), math.sin(it['rot']); gx, gy = it['x'] + cr * 7.5 - sr * -5.2, it['y'] + sr * 7.5 + cr * -5.2
                d = math.hypot(gx - b[0], gy - b[1])
                if best is None or d < best[0]: best = (d, [round(gx, 2), round(gy, 2)])
            out.append({'approach': b, 'grate': best[1], 'reverse_m': round(best[0], 2)})
        return out
    pads = [dict(p, refinery_docks=docks_for(p['refinery_bays'])) if p.get('refinery_bays') else p for p in pads]
    if dk:
        Wc = np.array(dk['water_center']); rot = dk['rot']; lx = np.array([math.cos(rot), math.sin(rot)]); ly = np.array([-math.sin(rot), math.cos(rot)]); boat = Wc - ly * 25
        presets.append({'key': 'harbor', 'title': 'Harbour close-up', 'pos': [*(boat - ly * 55 + lx * 45), 9.0], 'target': [*(boat + lx * 4), 3.0]})
    m = {'id': mid, 'name': meta['name'], 'size_m': S, 'mode': meta['mode'], 'seed': meta['seed'], 'base_ground_m': meta['base_ground_m'], 'biome': meta['biome'],
         'grid_m': R, 'grid_n': int(hh.shape[0]), 'height_encoding': {'scale': 1 / 500, 'offset': -40}, 'nav_bits': {'infantry': 1, 'tank': 2, 'harvester': 4, 'amphibious': 8, 'ship': 16},
         'unit_radius_m': {'infantry': 0.35, 'tank': 2.3, 'harvester': 2.6, 'amphibious': 2.3, 'ship': 5.0}, 'speeds_mps': {k: list(v) for k, v in SPEED.items()}, 'pace_game_speed': PACE['game_speed'],
         'pads': pads, 'deposits': inst['deposits'], 'docks': meta['docks'], 'landmarks': meta['landmarks'], 'beaches': meta['beaches'], 'bridges': meta['bridges'],
         'quarries': meta['quarries'], 'roads': roads, 'lanes': inst['lanes'], 'routes': inst.get('routes', []), 'collision': collision_boxes(inst), 'presets': presets,
         'validation': [{'check': c['check'], 'status': c['status'], 'detail': c['detail']} for c in val.get('checks', [])], 'conflicts': val.get('conflicts', [])}
    (out / 'map.json').write_text(json.dumps(m, separators=(',', ':')))
    sizes = {p.name: p.stat().st_size // 1024 for p in out.iterdir()}; print(mid, sizes)

if __name__ == '__main__':
    sel = sys.argv[1] if len(sys.argv) > 1 else 'all'
    for d in LAYOUT['maps']:
        if sel in ('all', d['id']): export(d['id'])
    (ROOT / 'lab' / 'data' / 'maps.json').write_text(json.dumps([{'id': d['id'], 'name': d['name'], 'size_m': d['size_m'], 'mode': d['mode']} for d in LAYOUT['maps']]))
