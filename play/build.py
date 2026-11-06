"""Assemble the Stage 2 game client's copies of its single-source inputs (run after any engine / data / asset change):
  units/sandbox/{mech,nav,views,fx,pace}.js        → play/engine/        (the simulation + unit views; one source of truth)
  units/sandbox/data/{unit_specs,sockets}.json      → play/data/
  data/pace.json (repo root)                        → play/data/pace.json
  units/data/faction_mapping.json                   → play/data/
  units/sandbox/assets/<UID>[_lodN].gltf.json       → play/assets/units/   (15 pack units at LOD0/1/2 + the harvester)
  maps/lab/data/01/* (via copy_map_data.sh)         → play/maps/01/        (map.json, instances.json, grid PNGs re-encoded when stale)
  maps/lab/data/assets/<used>.gltf.json             → play/assets/map/     (only assets the drawn instances or the game use)
Run: python3 play/build.py"""
import json, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent; ROOT = HERE.parent
SB = ROOT / 'units' / 'sandbox'; LAB = ROOT / 'maps' / 'lab' / 'data'
for d in ['engine', 'data', 'assets/units', 'assets/map', 'maps/01']: (HERE / d).mkdir(parents=True, exist_ok=True)

for f in ['mech.js', 'nav.js', 'views.js', 'fx.js', 'pace.js']:
    shutil.copy(SB / f, HERE / 'engine' / f)
for f in ['unit_specs.json', 'sockets.json']:
    shutil.copy(SB / 'data' / f, HERE / 'data' / f)
shutil.copy(ROOT / 'data' / 'pace.json', HERE / 'data' / 'pace.json')
shutil.copy(ROOT / 'data' / 'combat.json', HERE / 'data' / 'combat.json')
shutil.copy(ROOT / 'data' / 'economy.json', HERE / 'data' / 'economy.json')
shutil.copy(ROOT / 'units' / 'data' / 'faction_mapping.json', HERE / 'data' / 'faction_mapping.json')

n = 0
for p in sorted((SB / 'assets').glob('*.gltf.json')):
    if p.name.startswith(('H0', 'A0', 'T0', 'unit_harvester')) and not p.name.startswith('A02'):   # A02 dropped from Helix
        shutil.copy(p, HERE / 'assets' / 'units' / p.name); n += 1

import subprocess
subprocess.run(['bash', str(HERE / 'copy_map_data.sh'), '01'], check=True)   # map data + assets (re-encodes stale grid PNGs)
# the game draws neither the base kits nor the demo units: drop map assets only those use (the naval dock stays: it is the pier)
inst = json.loads((HERE / 'maps' / '01' / 'instances.json').read_text())
need = {a for a, rows in inst.items() if not a.startswith('unit_') and any(r[5] == 0 or a == 'bld_naval_dock' for r in rows)}
need |= {'bld_hq', 'bld_power_substation', 'bld_ore_refinery', 'bld_barracks', 'bld_vehicle_factory', 'bld_radar_control', 'bld_naval_dock', 'prop_gantry_crane'}
k = size = 0
for f in sorted((HERE / 'assets' / 'map').glob('*.gltf.json')):
    base = f.name[:-len('.gltf.json')]; base0 = base[:-5] if base.endswith('_lod1') else base
    if base0 not in need: f.unlink(); continue
    k += 1; size += f.stat().st_size
for f in (HERE / 'maps' / '01').glob('*'):
    if f.suffix in ('.f32', '.u8') or (f.suffix == '.png' and not f.name.endswith('.grid.png')): f.unlink()   # raw / preview copies are not served
m = len(list((HERE / 'maps' / '01').glob('*')))
print(f'engine 5 files · unit assets {n} · map files {m} · map assets {k} ({size / 1e6:.1f} MB)')
