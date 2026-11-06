"""Asset registry: footprint/height used for placement and collision. Measured bounds from
maps/assets/bounds/<name>.json override these design defaults when the asset exists."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

# name: (size_x, size_y, size_z, blocking, kind)
DEFAULTS = {
    'bld_barracks': (24, 12, 6, True, 'building'), 'bld_vehicle_factory': (40, 30, 12, True, 'building'),
    'bld_hq': (30, 24, 10, True, 'building'), 'bld_ore_refinery': (36, 28, 16, True, 'building'),
    'bld_power_substation': (20, 16, 6, True, 'building'), 'bld_radar_control': (16, 12, 6, True, 'building'),
    'bld_extraction_rig': (16, 12, 12, True, 'building'), 'bld_capture_radar': (24, 24, 14, False, 'compound'),
    'bld_naval_dock': (80, 40, 3, False, 'dock'), 'prop_container_20': (6.06, 2.44, 2.59, True, 'prop'),
    'prop_container_40': (12.19, 2.44, 2.59, True, 'prop'),
    'unit_infantry': (0.7, 0.7, 1.8, False, 'unit'), 'unit_infantry_walk': (0.8, 0.7, 1.8, False, 'unit'), 'unit_infantry_kneel': (0.9, 0.7, 1.2, False, 'unit'),
    'unit_mbt': (9.5, 3.6, 2.5, False, 'unit'), 'unit_apc': (7, 3, 2.8, False, 'unit'), 'unit_harvester': (10, 4, 4, False, 'unit'),
    'unit_patrol_boat': (32, 7, 11, False, 'boat'),
    'prop_gantry_crane': (30, 24, 50, True, 'prop'), 'prop_rtg_crane': (12, 26, 20, True, 'prop'), 'prop_bollard': (0.6, 0.6, 0.8, False, 'prop'),
    'prop_fender': (1.5, 1, 1.5, False, 'prop'), 'prop_life_ring_post': (0.6, 0.3, 1.6, False, 'prop'), 'prop_nav_buoy_red': (2, 2, 4, False, 'prop'),
    'prop_nav_buoy_green': (2, 2, 4, False, 'prop'), 'prop_harbour_light': (3, 3, 10, True, 'prop'), 'prop_street_light': (1.5, 0.4, 10, False, 'prop'),
    'prop_utility_cabinet': (1.2, 0.6, 1.6, False, 'prop'), 'prop_jersey_barrier': (3, 0.6, 0.8, False, 'prop'), 'prop_safety_barrier': (3, 0.3, 1.1, False, 'prop'),
    'prop_fence_segment': (4, 0.1, 2.4, False, 'prop'), 'prop_road_sign': (1, 0.2, 3, False, 'prop'), 'prop_culvert_end': (30, 4, 4, False, 'prop'),
    'prop_drainage_grate': (1, 0.5, 0.05, False, 'prop'), 'prop_gravel_pile': (10, 10, 4, True, 'prop'), 'prop_conveyor': (20, 2, 6, True, 'prop'),
    'prop_excavator': (10, 3.5, 4, True, 'prop'), 'prop_dump_truck': (9, 4, 4, True, 'prop'), 'prop_pipe_gantry': (20, 4, 6, True, 'prop'),
    'prop_treatment_tank': (30, 30, 4, True, 'prop'), 'prop_storage_tank': (12, 12, 10, True, 'prop'), 'prop_warehouse_a': (60, 30, 10, True, 'building'),
    'prop_warehouse_b': (40, 20, 8, True, 'building'), 'prop_office_block': (20, 12, 8, True, 'building'), 'prop_rail_wagon': (16, 3, 4, True, 'prop'),
    'prop_rail_track': (20, 3, 0.3, False, 'prop'), 'prop_rail_crossing': (20, 3, 0.3, False, 'prop'), 'prop_wind_turbine': (6, 6, 130, True, 'prop'),
    'prop_solar_array_row': (20, 4, 2.5, True, 'prop'), 'prop_research_building': (30, 20, 10, True, 'building'),
    'prop_resort_shell': (30, 14, 9, True, 'building'), 'prop_tunnel_portal': (32, 10, 12, True, 'prop'), 'prop_radio_mast': (4, 4, 40, True, 'prop'),
    'prop_water_tower': (8, 8, 25, True, 'prop'),
}
TREE_R = {'veg_oak': 0.6, 'veg_pine': 0.4, 'veg_scots_pine': 0.4, 'veg_palm': 0.3, 'veg_palm_b': 0.3, 'veg_mangrove': 0.8,
          'veg_broadleaf_tropical': 0.7, 'veg_poplar': 0.4, 'veg_jungle_cluster': 2.5}

def info(name):
    p = ROOT / 'assets' / 'bounds' / f'{name}.json'
    d = DEFAULTS.get(name, (1, 1, 1, False, 'rock' if name.startswith('rock_') else 'veg'))  # rocks: own kind; blocking is decided per placed item (size)
    out = {'size': list(d[:3]), 'blocking': d[3], 'kind': d[4], 'measured': False}
    if p.exists():
        try:
            b = json.loads(p.read_text()); out['size'] = b['size_m']; out['measured'] = True; out['bounds'] = b
        except Exception: pass
    return out

def exists(name): return (ROOT / 'assets' / 'blend' / f'{name}.blend').exists()
