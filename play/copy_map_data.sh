#!/usr/bin/env bash
# Copy Map Lab data into the game client (read-only on maps/):
#   maps/lab/data/<id>/*                         → play/maps/<id>/
#   maps/lab/data/assets/<asset>[_lod1].gltf.json → play/assets/map/   (every asset named in the map's instances.json)
#   maps/lab/data/assets/{manifest,sizes}.json    → play/assets/map/
# The game loads the lossless *.grid.png rasters (the host serves only web file types). When the raw height.f32 / *.u8 in
# the Lab folder are newer than its *.grid.png (the PNGs were not re-made after the last map regeneration), the PNGs in the
# copy are re-encoded from the raw grids with the same encoding as maps/lab/make_web_safe.py, so terrain, nav and
# instances.json agree. Pass --as-is to copy the Lab's PNGs unchanged.
#
# Usage: play/copy_map_data.sh [--as-is] [map ids…]   (default: 01)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB="$HERE/../maps/lab/data"
ASIS=0; IDS=()
for a in "$@"; do if [ "$a" = "--as-is" ]; then ASIS=1; else IDS+=("$a"); fi; done
[ ${#IDS[@]} -eq 0 ] && IDS=(01)

mkdir -p "$HERE/assets/map"
cp -p "$LAB/assets/manifest.json" "$LAB/assets/sizes.json" "$HERE/assets/map/"
for id in "${IDS[@]}"; do
  [ -f "$LAB/$id/map.json" ] || { echo "no map $id in $LAB" >&2; exit 1; }
  mkdir -p "$HERE/maps/$id"
  cp -p "$LAB/$id/"* "$HERE/maps/$id/"
  python3 -I - "$HERE/maps/$id" "$LAB/assets" "$HERE/assets/map" "$ASIS" <<'PY'
import json, shutil, sys
from pathlib import Path
dst, src_assets, dst_assets, asis = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4] == '1'
names = sorted(json.loads((dst / 'instances.json').read_text()).keys())
copied, absent = 0, []
for nm in names:
    for v in (nm, nm + '_lod1'):
        f = src_assets / f'{v}.gltf.json'
        if f.exists():
            shutil.copy2(f, dst_assets / f.name); copied += 1
        elif v == nm:
            absent.append(nm)
print(f'map {dst.name}: {len(names)} asset types, {copied} gltf.json copied' + (f', no GLB for: {", ".join(absent)}' if absent else ''))
if asis:
    sys.exit(0)
import numpy as np
from PIL import Image
meta = json.loads((dst / 'map.json').read_text()); n = meta['grid_n']
def stale(raw, png):
    return raw.exists() and (not png.exists() or raw.stat().st_mtime > png.stat().st_mtime)
redone = []
raw, png = dst / 'height.f32', dst / 'height.grid.png'
if stale(raw, png):
    h = np.fromfile(raw, '<f4').reshape(n, n); v = np.clip(np.round((h + 40) * 10000), 0, 2 ** 24 - 1).astype(np.uint32)
    Image.fromarray(np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], -1).astype(np.uint8), 'RGB').save(png, optimize=True); redone.append(png.name)
for nm in ('surface', 'nav', 'deck'):
    raw, png = dst / f'{nm}.u8', dst / f'{nm}.grid.png'
    if stale(raw, png):
        a = np.fromfile(raw, np.uint8); k = int(round(len(a) ** 0.5))
        Image.fromarray(a.reshape(k, k), 'L').save(png, optimize=True); redone.append(png.name)
print(f'map {dst.name}: ' + (f're-encoded from newer raw grids: {", ".join(redone)}' if redone else 'grid PNGs up to date'))
PY
done
