"""Prepare the Unit Sandbox's data folder from the Blender exports.
  units/out/<UID>.glb  →  units/sandbox/assets/<UID>.gltf.json  (glTF JSON with the binary buffer embedded as a data URI;
                                                                   artifacts serve web media types only)
  units/data/unit_specs.json → units/sandbox/data/unit_specs.json
  socket positions read from each GLB's node tree → units/sandbox/data/sockets.json (unit-local metres: x right, y forward, z up),
  so the simulation's muzzles, turret pivots and hit heights match the models.
Run: python3 units/sandbox/build_assets.py"""
import json, struct, base64, shutil, math
from pathlib import Path

HERE = Path(__file__).resolve().parent; ROOT = HERE.parent
(HERE / 'assets').mkdir(exist_ok=True); (HERE / 'data').mkdir(exist_ok=True)
shutil.copy(ROOT / 'data' / 'unit_specs.json', HERE / 'data' / 'unit_specs.json')
SPEC = {u['id']: u for u in json.loads((ROOT / 'data' / 'unit_specs.json').read_text())['units']}

def read_glb(p):
    b = p.read_bytes(); assert b[:4] == b'glTF'; off = 12; js = None; binc = b''
    while off < len(b):
        ln, typ = struct.unpack('<II', b[off:off + 8]); chunk = b[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A: js = json.loads(chunk)
        elif typ == 0x004E4942: binc = chunk
        off += 8 + ln
    return js, binc

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)
def qrot(q, v):
    x, y, z, w = q; vx, vy, vz = v
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx)

def world_positions(js):
    nodes = js['nodes']; parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    out = {}
    def world(i):
        n = nodes[i]; t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
        if i in parent:
            pt, pr, ps = world(parent[i]); st = (t[0] * ps[0], t[1] * ps[1], t[2] * ps[2]); rt = qrot(pr, st)
            return (pt[0] + rt[0], pt[1] + rt[1], pt[2] + rt[2]), qmul(pr, r), (ps[0] * s[0], ps[1] * s[1], ps[2] * s[2])
        return tuple(t), tuple(r), tuple(s)
    for i, n in enumerate(nodes):
        if 'name' in n:
            p, q, s = world(i); out[n['name']] = (p[0], -p[2], p[1])   # glTF y-up → unit-local (x right, y forward, z up)
    return out

sockets = {}
for uid in SPEC:
    p = ROOT / 'out' / f'{uid}.glb'
    if not p.exists(): print('missing', uid); continue
    for suf in ('_lod1', '_lod2'):   # distant-view versions (units/blender/lods.py): same node tree, fewer triangles
        pl = ROOT / 'out' / f'{uid}{suf}.glb'
        if pl.exists():
            jl, bl = read_glb(pl); jl['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(bl).decode()
            (HERE / 'assets' / f'{uid}{suf}.gltf.json').write_text(json.dumps(jl, separators=(',', ':')))
    js, binc = read_glb(p)
    if js.get('buffers'): js['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(binc).decode()
    (HERE / 'assets' / f'{uid}.gltf.json').write_text(json.dumps(js, separators=(',', ':')))
    W = world_positions(js); sub = lambda a, b: [round(a[k] - b[k], 4) for k in range(3)]; r4 = lambda a: [round(x, 4) for x in a]
    g = {}
    if 'turret' in W and 'gun' in W:
        g['turret'] = r4(W['turret']); g['gun'] = sub(W['gun'], W['turret'])
        if 'muzzle' in W: g['muzzle'] = [sub(W['muzzle'], W['gun'])]
    elif uid == 'H04' and 'muzzle_L' in W: g['muzzle'] = [r4(W['muzzle_L']), r4(W['muzzle_R'])]
    elif uid == 'A04' and 'bomb_L' in W: g['muzzle'] = [r4(W['bomb_L']), r4(W['bomb_R'])]
    elif uid == 'A05': g['muzzle'] = [r4(W[f'muzzle_cell_{k}']) for k in range(4) if f'muzzle_cell_{k}' in W] or None; g['aa'] = r4(W['aa']) if 'aa' in W else None
    elif uid == 'T05' and 'muzzle_L' in W: g['muzzle'] = [r4(W['muzzle_L']), r4(W['muzzle_R'])]
    elif uid == 'T04' and 'muzzle' in W: g['muzzle'] = [r4(W['muzzle'])]
    if 'hit' in W: g['hitZ'] = round(W['hit'][2], 3)
    g = {k: v for k, v in g.items() if v is not None}
    sockets[uid] = g
    print(uid, f'{p.stat().st_size // 1024} KB →', f'{(HERE / "assets" / f"{uid}.gltf.json").stat().st_size // 1024} KB', g)
(HERE / 'data' / 'sockets.json').write_text(json.dumps(sockets, indent=1))
# economy test models from the maps' asset library (already web-safe glTF JSON with an embedded buffer)
MAPS_ASSETS = ROOT.parent / 'maps' / 'lab' / 'data' / 'assets'
for name in ('unit_harvester', 'bld_ore_refinery', 'bld_extraction_rig'):
    src = MAPS_ASSETS / f'{name}.gltf.json'
    if src.exists(): shutil.copy(src, HERE / 'assets' / src.name); print(name, f'{src.stat().st_size // 1024} KB (maps asset)')
    else: print('missing maps asset', name)
# shared pace model (data/pace.js + data/pace.json at the repo root)
import subprocess; subprocess.run(['python3', str(ROOT.parent / 'data' / 'sync_pace.py')], check=True)

# local test page: the artifact page (page.html, written without a document skeleton) wrapped in one
page = (HERE / 'page.html').read_text()
(HERE / 'index.html').write_text('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                                 '<style>html,body{height:100%;margin:0}</style>\n</head>\n<body>\n' + page + '</body>\n</html>\n')
print('index.html from page.html')
