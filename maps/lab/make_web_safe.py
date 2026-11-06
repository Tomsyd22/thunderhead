"""Artifacts serve only web types, so the Map Lab ships:
  data/assets/<name>.gltf.json  — each GLB rewritten as glTF JSON with its binary buffer embedded as a base64 data URI
  data/<id>/<grid>.grid.png     — raw grids as lossless PNG in data order (row 0 = south):
                                   height: RGB 24-bit fixed point, z = (R·65536 + G·256 + B) / 10000 − 40
                                   surface / nav / deck: 8-bit grey
Run after export_web.py and make_manifest.py --sync."""
import json, struct, base64, sys
from pathlib import Path
import numpy as np
from PIL import Image
D = Path(__file__).parent / 'data'
for g in sorted((D / 'assets').glob('*.glb')):
    b = g.read_bytes(); assert b[:4] == b'glTF'
    off = 12; js = None; binc = b''
    while off < len(b):
        ln, typ = struct.unpack('<II', b[off:off + 8]); chunk = b[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A: js = json.loads(chunk)
        elif typ == 0x004E4942: binc = chunk
        off += 8 + ln
    if js.get('buffers'): js['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(binc).decode()
    (g.with_suffix('.gltf.json')).write_text(json.dumps(js, separators=(',', ':')))
for m in sorted(p for p in D.iterdir() if p.is_dir() and p.name.isdigit()):
    meta = json.loads((m / 'map.json').read_text()); n = meta['grid_n']
    h = np.fromfile(m / 'height.f32', '<f4').reshape(n, n); v = np.clip(np.round((h + 40) * 10000), 0, 2 ** 24 - 1).astype(np.uint32)
    Image.fromarray(np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], -1).astype(np.uint8), 'RGB').save(m / 'height.grid.png', optimize=True)
    for nm in ('surface', 'nav', 'deck'):
        a = np.fromfile(m / f'{nm}.u8', np.uint8); k = int(round(len(a) ** 0.5)); Image.fromarray(a.reshape(k, k), 'L').save(m / f'{nm}.grid.png', optimize=True)
    print(m.name, {p.name: p.stat().st_size // 1024 for p in m.glob('*.grid.png')})
print('assets json MB', round(sum(p.stat().st_size for p in (D / 'assets').glob('*.gltf.json')) / 1e6, 1))
