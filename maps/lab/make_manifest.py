#!/usr/bin/env python3
"""Regenerate the Map Lab asset manifest and footprint table.

  python3 maps/lab/make_manifest.py            # rescan data/assets/*.glb
  python3 maps/lab/make_manifest.py --sync     # first copy finished web GLBs from maps/assets/glb/

Writes (relative to maps/lab/):
  data/assets/manifest.json  sorted JSON list of GLB names present in data/assets (no extension)
  data/assets/sizes.json     {asset: {size, min, max, source, blocking, kind, ...}} for every asset that any
                             map's instances.json references, every DEFAULTS entry in gen/assets.py and every
                             measured bounds file in maps/assets/bounds/.

Size sources, in priority order (the lab shows the source next to every dimension):
  measured        maps/assets/bounds/<name>.json size_m/min/max (actual mesh bounds from Blender)
  design-default  gen/assets.py DEFAULTS (x, y, z) footprint used for placement/collision
  species-height  gen/place.py SPECIES_H height with the gen/assets.py TREE_R trunk radius (collision trunk, crown unknown)
  unknown         no data anywhere: a 1 m placeholder, flagged as unknown
min/max are asset-local Blender axes (x east/front, y north/left, z up), origin as in ASSET_CONTRACT.md.
--sync only copies a GLB whose bounds json exists and which has not been modified in the last 60 s
(so a file that is still being written is skipped).
"""
import ast, json, shutil, sys, time
from pathlib import Path

LAB = Path(__file__).resolve().parent
MAPS = LAB.parent
ASSETS = LAB / 'data' / 'assets'


def literal(path, name):
    """Read a module-level literal assignment without importing the module (no numpy/scipy side effects)."""
    tree = ast.parse(Path(path).read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    return {}


MOVER_MODELS = {'unit_infantry_walk', 'unit_mbt', 'unit_harvester', 'unit_apc', 'unit_patrol_boat'}  # lab.js CLASS_MODEL


def used_assets():
    used = set()
    for mdir in sorted((LAB / 'data').glob('[0-9][0-9]')):
        f = mdir / 'instances.json'
        if f.exists():
            used |= set(json.loads(f.read_text()).keys())
    return used


def sync():
    src = MAPS / 'assets' / 'glb'
    copied = []
    wanted = used_assets() | MOVER_MODELS
    for g in sorted(src.glob('*.glb')):
        base = g.stem.split('_lod1')[0]
        if base not in wanted:  # e.g. grass clumps: not in the web instances export, so the lab never draws them
            continue
        if not (MAPS / 'assets' / 'bounds' / f'{base}.json').exists():
            continue
        if time.time() - g.stat().st_mtime < 60:
            continue
        dst = ASSETS / g.name
        if not dst.exists() or dst.stat().st_mtime < g.stat().st_mtime or dst.stat().st_size != g.stat().st_size:
            shutil.copy2(g, dst); copied.append(g.name)
    print('synced:', copied or 'nothing new')


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    if '--sync' in sys.argv:
        sync()
    names = sorted(p.stem for p in ASSETS.glob('*.glb'))
    (ASSETS / 'manifest.json').write_text(json.dumps(names, indent=1))

    defaults = literal(MAPS / 'gen' / 'assets.py', 'DEFAULTS')
    tree_r = literal(MAPS / 'gen' / 'assets.py', 'TREE_R')
    species_h = literal(MAPS / 'gen' / 'place.py', 'SPECIES_H')

    used = used_assets()
    bounds ={p.stem: p for p in (MAPS / 'assets' / 'bounds').glob('*.json')}
    all_names = sorted(used | set(defaults) | set(bounds) | {n.split('_lod1')[0] for n in names})

    out = {}
    for name in all_names:
        d = defaults.get(name)
        e = {'blocking': bool(d[3]) if d else False, 'kind': d[4] if d else ('veg' if name.startswith(('veg_', 'coral')) else ('rock' if name.startswith('rock_') else 'unknown'))}
        if name in bounds:
            try:
                b = json.loads(bounds[name].read_text())
                e.update(size=[round(v, 3) for v in b['size_m']], min=[round(v, 3) for v in b['min']], max=[round(v, 3) for v in b['max']],
                         source='measured', tris=b.get('tris'), spec=b.get('spec_m'), excluded=b.get('excluded') or [])
            except Exception as ex:  # unreadable bounds file: fall through to defaults, but say so
                e['bounds_error'] = str(ex)
        if 'source' not in e and d:
            sx, sy, sz = d[:3]
            z0 = -2.0 if d[4] == 'boat' else 0.0  # boats: origin at the waterline, 2 m draft
            e.update(size=[sx, sy, sz], min=[-sx / 2, -sy / 2, z0], max=[sx / 2, sy / 2, z0 + sz], source='design-default')
        if 'source' not in e and name in species_h:
            r = tree_r.get(name, 0.5); h = species_h[name]
            e.update(size=[2 * r, 2 * r, h], min=[-r, -r, 0.0], max=[r, r, h], source='species-height',
                     note='collision trunk diameter x species height; crown size unknown')
        if 'source' not in e:
            e.update(size=[1.0, 1.0, 1.0], min=[-0.5, -0.5, 0.0], max=[0.5, 0.5, 1.0], source='unknown')
        e['used'] = name in used
        e['glb'] = name in names
        e['lod1_glb'] = f'{name}_lod1' in names
        out[name] = e
    (ASSETS / 'sizes.json').write_text(json.dumps(out, indent=1))
    src = {}
    for v in out.values():
        src[v['source']] = src.get(v['source'], 0) + 1
    print(f'manifest: {len(names)} GLBs {names}')
    print(f'sizes: {len(out)} assets by source {src}')


if __name__ == '__main__':
    main()
