"""Deterministic placement for a generated map: base kits, demonstration units, deposits, docks and boats,
landmark compounds, forests, scattered vegetation, rocks, cliffs, coral, plus the surface-class raster.

Every instance gets a stable id from (map, category, order); the same seed reproduces the same placement.
Run: blender-env/bin/python maps/gen/place.py <id|all> → maps/build/<id>/instances.json, surface.npz
"""
import json, math, sys
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, str(Path(__file__).parent))
from mapgen import rect_dist, smoothstep, fbm, RES, OVR, BIOMES, LAYOUT
from assets import info

ROOT = Path(__file__).resolve().parents[1]
SURF = {'grass': 0, 'meadow': 1, 'dirt': 2, 'sand': 3, 'rock': 4, 'concrete': 5, 'gravel': 6, 'asphalt': 7, 'mud': 8, 'farm': 9,
        'soil': 10, 'forest': 11, 'wetsand': 12, 'quarry': 13}
SPECIES_H = {'veg_oak': 14, 'veg_pine': 16, 'veg_scots_pine': 17, 'veg_palm': 13, 'veg_palm_b': 10, 'veg_mangrove': 9, 'veg_broadleaf_tropical': 14,
             'veg_poplar': 17, 'veg_jungle_cluster': 12}
PER_TREE = {'broadleaf': 120.0, 'conifer': 90.0, 'palm': 160.0}

class Placer:
    def __init__(self, mid):
        self.mid = mid; b = ROOT / 'build' / mid; self.b = b
        self.h = np.load(b / 'height.npy'); M = np.load(b / 'masks.npz'); self.M = {k: M[k] for k in M.files}
        self.meta = json.loads((b / 'meta.json').read_text()); self.n = self.h.shape[0]; self.S = self.meta['size_m']
        self.d = next(m for m in LAYOUT['maps'] if m['id'] == mid); self.bio = BIOMES[mid]
        self.rng = np.random.default_rng(self.d['seed'] * 13 + 5); self.items = []; self.counts = {}; self.lanes = []; self.areas = []; self.conflicts = []; self.routes = []; self.rock_solid = []
        ax = np.arange(self.n) * RES; self.X, self.Y = np.meshgrid(ax, ax)
        gy, gx = np.gradient(self.h, RES); self.slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        self.solid = np.zeros_like(self.h, bool)        # cells occupied by blocking footprints
        self.excl = np.zeros_like(self.h, bool)         # no solid trees/rocks here
        self.surf = np.full(self.h.shape, SURF['grass'], np.uint8)

    # ── helpers ──
    def z(self, x, y): return float(ndi.map_coordinates(self.h, [[y / RES], [x / RES]], order=1, mode='nearest')[0])
    def win(self, x, y, r):
        j0, j1 = max(int((y - r) / RES), 0), min(int((y + r) / RES) + 2, self.n); i0, i1 = max(int((x - r) / RES), 0), min(int((x + r) / RES) + 2, self.n)
        return slice(j0, j1), slice(i0, i1)
    def rect(self, c, size, rot=0.0, pad=0.0):
        r = math.hypot(*size) / 2 + pad + 4; w = self.win(c[0], c[1], r)
        dist, inside = rect_dist(self.X[w], self.Y[w], c, size, rot); return w, dist <= pad if pad > 0 else inside
    def add(self, asset, x, y, rot=0.0, cat='env', z=None, scale=1.0, team=None, block=None, **kw):
        if not (0.5 <= x <= self.S - 0.5 and 0.5 <= y <= self.S - 0.5): return None  # keep geometry inside the playable bounds
        if asset == 'prop_street_light': rot += math.pi / 2  # callers pass the arm direction; the asset's arm points along local −Y
        k = self.counts.get(cat, 0); self.counts[cat] = k + 1; a = info(asset)
        it = {'id': f"{self.mid}-{cat}-{k:05d}", 'asset': asset, 'x': round(float(x), 3), 'y': round(float(y), 3),
              'z': round(self.z(x, y) if z is None else float(z), 3), 'rot': round(float(rot) % (2 * math.pi), 4), 's': round(float(scale), 3), 'cat': cat}
        if team: it['team'] = team
        if block is not None: it['block'] = bool(block)  # explicit per-item blocking (collision and navigation both read it)
        it.update(kw); self.items.append(it)
        if a['kind'] == 'rock':
            if block: self.rock_solid.append(it)
            return it
        if (a['blocking'] if block is None else block) and a['kind'] != 'veg':
            w, m = self.rect((x, y), [a['size'][0] * scale, a['size'][1] * scale], rot); self.solid[w] |= m; self.excl[w] |= m
        return it
    def free(self, c, size, rot=0.0, pad=4.0, allow_road=False):
        w, m = self.rect(c, size, rot, pad=pad)
        bad = self.solid[w] | (self.h[w] < 0.3)
        if not allow_road: bad |= self.M['road_band'][w]
        return not (m & bad).any()
    def paint(self, c, size, rot, cls, pad=0.0):
        w, m = self.rect(c, size, rot, pad=pad) if pad else self.rect(c, size, rot); self.surf[w] = np.where(m, SURF[cls], self.surf[w])
    def m_(self, q): return np.asarray(q, float) * self.S / 1000

    # ── base kits and demonstration layer ──
    def kit_frame(self, p):
        """Per-start orientation of the identical base kit (approved 2026-11-06): mirror x so the factory side faces the map
        centre, mirror y so the refineries face this start's home deposits. Buildings stay rigid models: a building whose facing
        the mirror flips is rotated 180° (refineries follow x because their drive-through bay sits 7.5 m off-centre in x; every
        other building follows y because its main door faces local −Y)."""
        c = np.array(p['center'], float)
        sx = 1 if self.S / 2 >= c[0] else -1
        hs = [d for d in self.meta['deposits'] if d.get('nearest') == p['id'] and d['kind'] == 'home']
        sy = -1 if hs and np.mean([d['spec_pos'][1] for d in hs]) > c[1] else 1
        name = {(1, 1): 'identity', (-1, 1): 'mirror-x', (1, -1): 'mirror-y', (-1, -1): 'rotate-180'}[(sx, sy)]
        T = lambda v: c + np.array([sx * v[0], sy * v[1]], float)
        H = lambda a: math.atan2(sy * math.sin(a), sx * math.cos(a))  # heading of a mirrored unit
        return sx, sy, name, T, H

    def base_kits(self):
        bk = OVR['base_kit']; self.kits = {}
        for p in self.meta['pads']:
            c = np.array(p['center']); team = p['team']; ph = p['h']; sx, sy, kname, T, H = self.kit_frame(p)
            self.paint(c, p['size'], 0, 'soil'); w, m = self.rect(c, [p['size'][0] + 60, p['size'][1] + 60], 0); self.excl[w] |= m
            bays = []
            for s in bk['structures']:
                pos = T(s['center']); self.paint(pos, [s['size'][0] + 8, s['size'][1] + 8], 0, 'concrete')
                rot = (0.0 if sx > 0 else math.pi) if s['asset'] == 'bld_ore_refinery' else (0.0 if sy > 0 else math.pi)
                if s['asset'] == 'bld_ore_refinery':
                    # equal docking for every start (approved 2026-11-06): the unloading grate (model (7.5, -5.2)) lands on the exact
                    # mirrored kit position. Where the short bay mouth faces the field (the model is rotated 180° to mirror the bay in x),
                    # the building sits 10.4 m further from the field, so approach, drive and the 25.2 m reverse match every other start.
                    pos = pos + np.array([0.0, sy * 5.2 + 5.2 * math.cos(rot)])
                    grate_y = pos[1] - 5.2 * math.cos(rot)
                    bays.append([pos[0] + sx * 7.5, grate_y - sy * 25.2])
                self.add(s['asset'], *pos, rot, 'base', z=ph, team=team, base=p['id'], role=s['id'])
            # service aisle (bends 3 m away from the substation, see overrides) and the factory apron + rally
            ay = bk['aisle']['y']; self.lanes.append({'kind': 'aisle', 'w': 12, 'z': ph, 'pts': [T(v).tolist() for v in ([-90, ay], [44, ay], [52, ay - 3], [90, ay - 3])]})
            self.paint(T([0, ay - 1.5]), [180, 15], 0, 'concrete')
            self.paint(T([30, 15 - 6 - 12]), [24, 24 + 12], 0, 'concrete')  # factory apron 12 m beyond the door to the rally point
            rally = T(bk.get('rally', [30, -10]))
            self.kits[p['id']] = {'transform': kname, 'sx': sx, 'sy': sy, 'rally': rally.round(2).tolist(), 'refinery_bays': np.round(bays, 2).tolist()}
            self.add('unit_mbt', *T([72, 78]), H(-math.pi / 2), 'demo', z=ph, team=team, base=p['id'], role='tank_1')
            self.add('unit_mbt', *T([84, 78]), H(-math.pi / 2), 'demo', z=ph, team=team, base=p['id'], role='tank_2')
            self.paint(T([78, 80]), [36, 26], 0, 'concrete')
            # showcase: a tank and three soldiers beside the barracks (base close-up preset), clear of the service aisle
            self.add('unit_mbt', *T([-20, -14]), H(math.radians(200)), 'demo', z=ph, team=team, base=p['id'], role='showcase_tank')
            for k, (dx, dy, pose) in enumerate(((-33, -16.5, 'unit_infantry'), (-31, -18.5, 'unit_infantry_walk'), (-35.5, -18, 'unit_infantry'))):
                self.add(pose, *T([dx, dy]), H(math.radians(215 + 25 * k)), 'demo', z=ph, team=team, base=p['id'], role='showcase_infantry')
            g = self.rng.normal(0, 3.2, (6, 2)); poses = ['unit_infantry', 'unit_infantry', 'unit_infantry_walk', 'unit_infantry', 'unit_infantry_kneel', 'unit_infantry_walk']
            for k in range(6): self.add(poses[k], *T(np.array(bk['infantry_group']) + g[k]), self.rng.uniform(0, 6.28), 'demo', z=ph, team=team, base=p['id'], role='infantry')
            for k, (lx, ly) in enumerate([(-110, -110), (110, -110), (110, 110), (-110, 110), (0, -110), (0, 110), (-110, 0), (110, 0)]):
                q0 = c + [lx * 0.97, ly * 0.97]; q = q0
                edges = [np.array([0.0, 1.0])] if lx and not ly else ([np.array([1.0, 0.0])] if ly and not lx else [np.array([-np.sign(lx), 0.0]), np.array([0.0, -np.sign(ly)])])
                for sh in (0, 18, -18, 30, -30, 42, -42, 54):  # slide along the pad edge(s) until the pole is ≥ 3 m clear of every road core
                    ok_ = [q0 + e * sh for e in edges if (sh >= 0 or len(edges) == 1) and self.road_d[int((q0 + e * sh)[1] / RES), int((q0 + e * sh)[0] / RES)] > 3.0]
                    if ok_: q = ok_[0]; break
                self.add('prop_street_light', *q, math.atan2(-ly, -lx), 'base_light', z=ph)

    def deposits(self):
        for dp in self.meta['deposits']:
            c = np.array(dp['pos']); self.paint(c, [50, 50], 0, 'gravel'); w, m = self.rect(c, [50, 50], 0, pad=6); self.excl[w] |= m
            # face the service side toward the nearest road
            rc = np.argwhere(self.M['road_core'][self.win(c[0], c[1], 260)])
            if len(rc):
                j0 = self.win(c[0], c[1], 260)[0].start; i0 = self.win(c[0], c[1], 260)[1].start
                pts = (rc + [j0, i0])[:, ::-1] * RES; dd = np.hypot(*(pts - c).T); near = pts[dd <= dd.min() + 3]
                k = np.argmin(np.hypot(*(near - self.S / 2).T)); v = near[k] - c; ang = math.atan2(v[1], v[0])  # ties → toward map centre (symmetry-safe)
            else:  # no road within reach: face the owning base pad (nearest pad), snapped to the dominant axis so mirrored deposits stay mirrored
                pc = min((np.array(q['center']) for q in self.meta['pads']), key=lambda q: np.linalg.norm(q - c)); v = pc - c
                ang = (0.0 if v[0] > 0 else math.pi) if abs(v[0]) > abs(v[1]) else (math.pi / 2 if v[1] > 0 else -math.pi / 2)
            u = np.array([math.cos(ang), math.sin(ang)]); vv = np.array([-u[1], u[0]])
            rig = c - u * 8; self.add('bld_extraction_rig', *rig, ang + math.pi / 2, 'resource', z=dp['h'], deposit=dp['id'])
            svc = c + u * 13; dp['service_point'] = svc.tolist()
            for k, s in enumerate((-1, 1)): self.add('prop_gravel_pile', *(c - u * 6 + vv * s * 17), self.rng.uniform(0, 6.28), 'resource', z=dp['h'], scale=0.9 + 0.2 * k, deposit=dp['id'])
            self.add('prop_conveyor', *(c - u * 4 + vv * 9), ang + math.pi / 2, 'resource', z=dp['h'], deposit=dp['id'])
            for t in np.linspace(-22, 22, 8):  # safety barrier line along the back and sides, service side open
                self.add('prop_safety_barrier', *(c - u * 23 + vv * t), ang + math.pi / 2, 'resource_fence', block=False)
                self.add('prop_safety_barrier', *(c + vv * 23 + u * (t * 0.4 - 10)), ang, 'resource_fence', block=False)
                self.add('prop_safety_barrier', *(c - vv * 23 + u * (t * 0.4 - 10)), ang, 'resource_fence', block=False)

    def docks(self):
        od = OVR['dock']
        for k in self.meta['docks']:
            Wc = np.array(k['water_center']); rot = k['rot']; ly = np.array([-math.sin(rot), math.cos(rot)]); lx = np.array([math.cos(rot), math.sin(rot)])
            self.add('bld_naval_dock', *Wc, rot, 'dock', z=0.0, team=k['player'][0], dock=k['player'])
            land_edge = Wc + ly * 20; shore = np.array(k['shore']); L = np.array(k['land_access'])
            if k['trestle_m'] > 1: self.lanes.append({'kind': 'trestle', 'w': od['trestle_w'], 'pts': [shore.tolist(), land_edge.tolist()], 'z': [k['apron_h'], od['deck_z']]})
            self.paint((L + shore) / 2, [np.linalg.norm(shore - L) + 20, od['apron'][0]], math.atan2(*(shore - L)[::-1]), 'concrete')
            boat = Wc - ly * 23.6  # fender faces at local y = -20.0; 7 m beam against them → centreline ≈ -23.5
            self.add('unit_patrol_boat', *boat, rot, 'demo', z=0.0, team=k['player'][0], dock=k['player'], role='patrol_boat')
            for s, nm in ((-1, 'prop_nav_buoy_red'), (1, 'prop_nav_buoy_green')): self.add(nm, *(Wc - ly * 85 + lx * s * 45), 0, 'nav_marker', z=0.0)
            for q, pose in (((-6, -12), 'unit_infantry'), ((-3, -14), 'unit_infantry'), ((4, -11), 'unit_infantry_walk'), ((8, -15), 'unit_infantry')):  # dock personnel
                pp = Wc + lx * q[0] + ly * (q[1] + 20 - 6); self.add(pose, *pp, rot + math.pi * 1.5 + 0.4 * q[0] / 8, 'demo', z=od['deck_z'], team=k['player'][0], dock=k['player'], role='dock_personnel')
            w, m = self.rect((L + shore) / 2, [np.linalg.norm(shore - L) + 40, 60], math.atan2(*(shore - L)[::-1])); self.excl[w] |= m
            w, m = self.rect(Wc, [110, 90], rot); self.excl[w] |= m

    # ── landmark compounds ──
    def landmarks(self):
        for lm in self.meta['landmarks']:
            c = np.array(lm['center']); s = lm['size']; z = lm['h']; key = lm['id']
            w, m = self.rect(c, s, 0, pad=8); self.excl[w] |= m
            if lm['role'] == 'capturable':
                pos = c.copy()
                if not self.free(pos, [24, 24], 0, pad=0):
                    # straddled by a road: keep the compound centre, move the radar structure off the clear corridor
                    for r in range(2, 80, 2):
                        cand = [pos + [r, 0], pos + [-r, 0], pos + [0, r], pos + [0, -r]]
                        ok = [q for q in cand if self.free(q, [14, 14], 0, pad=0)]
                        if ok: self.conflicts.append(f"radar {key}: road corridor crosses the 24×24 compound; mast/radome structure offset {r} m from the centre, compound kept clear for capture"); pos = ok[0]; break
                self.paint(c, [24, 24], 0, 'concrete'); self.add('bld_capture_radar', *pos, 0, 'landmark', z=self.z(*pos), landmark=key)
            elif key == 'container-port': self.port(lm)
            elif key == 'waterworks': self.waterworks(lm)
            elif key == 'freight-terminal': self.freight(lm)
            elif key == 'rail-siding': self.rail(lm)
            elif 'wind-farm' in key:
                for sx in (-28, 28): self.add('prop_wind_turbine', *(c + [sx, 0]), math.radians(200 + sx), 'landmark', landmark=key)
                self.add('prop_utility_cabinet', *(c + [0, -20]), 0, 'landmark', landmark=key)
            elif key == 'north-research':
                self.paint(c, s, 0, 'concrete'); self.add('prop_research_building', *(c + [-8, 4]), 0, 'landmark', landmark=key)
                self.add('prop_radio_mast', *(c + [25, 12]), 0, 'landmark', landmark=key)
                for k in range(3): self.add('prop_solar_array_row', *(c + [22, -8 - k * 6]), 0, 'landmark', landmark=key)
                self.fence_rect(c, s, gap_side=('south', 'north'))
            elif key == 'south-solar':
                self.paint(c, s, 0, 'gravel')
                for i in (-1, 1):
                    for k in range(5): self.add('prop_solar_array_row', *(c + [i * 13, -18 + k * 8]), 0, 'landmark', landmark=key)
                self.add('prop_utility_cabinet', *(c + [0, 21]), 0, 'landmark', landmark=key); self.fence_rect(c, s, gap_side=('north', 'south'))

    def fence_rect(self, c, s, gap_side=None, rot=0.0):
        hx, hy = s[0] / 2, s[1] / 2
        sides = {'south': ((-hx, -hy), (hx, -hy)), 'north': ((-hx, hy), (hx, hy)), 'west': ((-hx, -hy), (-hx, hy)), 'east': ((hx, -hy), (hx, hy))}
        for nm, (a, b) in sides.items():
            a, b = np.array(a), np.array(b); L = np.linalg.norm(b - a); ang = math.atan2(*(b - a)[::-1])
            for t in np.arange(2, L - 1, 4):
                if nm in ((gap_side,) if isinstance(gap_side, str) else (gap_side or ())) and abs(t - L / 2) < 8: continue  # vehicle gate
                q = np.asarray(c) + a + (b - a) * t / L; j, i = int(q[1] / RES), int(q[0] / RES)
                if 0 <= j < self.n and 0 <= i < self.n and self.M['road_band'][j, i]: continue  # an authoritative road passes through: leave its corridor open
                self.add('prop_fence_segment', *q, ang, 'fence', block=False)

    def port(self, lm):
        c = np.array(lm['center']); q = lm.get('quay_rect', {'center': lm['center'], 'size': lm['size']}); qc = np.array(q['center']); qs = q['size']
        self.paint(qc, qs, 0, 'concrete'); z = lm['h']
        west = qc[0] - qs[0] / 2  # quay edge (sea to the west on Emerald)
        # STS cranes: rails along local X (30 m gauge, waterside rail at local y=-15), boom toward local −Y → turn −Y to face the sea (west)
        for yy in (c[1] - 28, c[1] + 28):
            xq = next((x for x in np.arange(west - 10, west + 40, 0.5) if self.z(x, yy) >= z - 0.15), west)
            self.add('prop_gantry_crane', xq + 17, yy, -math.pi / 2, 'landmark', z=z, landmark=lm['id'], block=False)
        for k in range(12):  # bollards 1.5 m back from the actual quay edge
            yy = c[1] - 55 + k * 10; xq = next((x for x in np.arange(west - 10, west + 40, 0.5) if self.z(x, yy) >= z - 0.15), west)
            self.add('prop_bollard', xq + 1.5, yy, 0, 'landmark', z=z, landmark=lm['id'])
        x0 = west + 34; band = self.M['road_band']
        for bx in range(4):
            for by in range(5):
                x = x0 + bx * 16; y = c[1] - 40 + by * 16
                if not self.free((x, y), [3, 13], 0, pad=2): continue
                hgt = int(self.rng.integers(1, 5))
                for lv in range(hgt): self.add('prop_container_40', x, y, math.pi / 2, 'container', z=z + lv * 2.59, landmark=lm['id'])
                if self.rng.random() < 0.5 and self.free((x + 5, y), [3, 6.5], 0, pad=1): self.add('prop_container_20', x + 5, y + 3, math.pi / 2, 'container', z=z, landmark=lm['id'])
        self.add('prop_rtg_crane', x0 + 24, c[1] - 8, 0, 'landmark', z=z, landmark=lm['id'], block=False)
        for p, a in (((x0 + 72, c[1] + 38), 'prop_warehouse_b'), ((x0 + 72, c[1] - 40), 'prop_office_block')):
            if self.free(p, info(a)['size'][:2], math.pi / 2): self.add(a, *p, math.pi / 2, 'landmark', z=z, landmark=lm['id'])
        yq = c[1] + 60; xq = next((x for x in np.arange(west - 10, west + 40, 0.5) if self.z(x, yq) >= z - 0.15), west)
        self.add('prop_harbour_light', xq + 2, yq, 0, 'landmark', z=z, landmark=lm['id'])

    def waterworks(self, lm):
        c = np.array(lm['center']); s = lm['size']; z = lm['h']; self.paint(c, s, 0, 'concrete')
        for side in (-1, 1):
            xs = c[0] + side * 42
            for k, dy in enumerate((-52, -14)): self.add('prop_treatment_tank', xs, c[1] + dy, 0, 'landmark', z=z, landmark=lm['id'])
            self.add('prop_office_block', xs, c[1] + 30, math.pi / 2, 'landmark', z=z, landmark=lm['id'])
            self.add('prop_storage_tank', xs + side * 8, c[1] + 62, 0, 'landmark', z=z, landmark=lm['id'])
            self.add('prop_pipe_gantry', c[0] + side * 22, c[1] - 33, math.pi / 2, 'landmark', z=z, landmark=lm['id'])
        self.fence_rect(c, s, gap_side=('north', 'south')); self.lanes.append({'kind': 'service', 'w': 10, 'z': z, 'pts': [(c + [-70, 50]).tolist(), (c + [70, 50]).tolist()]})

    def freight(self, lm):
        c = np.array(lm['center']); s = lm['size']; z = lm['h']; self.paint(c, s, 0, 'concrete')
        hx, hy = s[0] / 2, s[1] / 2
        self.add('prop_warehouse_a', c[0] - hx + 40, c[1] + 30, 0, 'landmark', z=z, landmark=lm['id'])
        self.add('prop_warehouse_b', c[0] - hx + 32, c[1] - 30, 0, 'landmark', z=z, landmark=lm['id'])
        self.add('prop_warehouse_a', c[0] + hx - 40, c[1] + 30, 0, 'landmark', z=z, landmark=lm['id'])
        self.add('prop_office_block', c[0] + hx - 22, c[1] - 34, 0, 'landmark', z=z, landmark=lm['id'])
        self.add('prop_storage_tank', c[0] + hx - 50, c[1] - 38, 0, 'landmark', z=z, landmark=lm['id'])
        for row in range(5):
            for col in range(7):
                x = c[0] - 60 + col * 17; y = c[1] - 44 + row * 16
                for lv in range(int(self.rng.integers(1, 5))): self.add('prop_container_40', x, y, math.pi / 2, 'container', z=z + lv * 2.59, landmark=lm['id'])
        for x in (c[0] - 34, c[0] + 34): self.add('prop_rtg_crane', x, c[1] - 12, 0, 'landmark', z=z, landmark=lm['id'], block=False)
        # two vehicle approaches: north lane to the boulevard (crossing the siding flush) and south lane to the coastal road
        for x in (c[0] - 100, c[0] + 100):
            self.lanes.append({'kind': 'service', 'w': 12, 'z': z, 'pts': [[x, c[1] + hy], [x, c[1] + hy + 95]]})
        self.lanes.append({'kind': 'service', 'w': 12, 'z': z, 'pts': [[c[0], c[1] - hy], [c[0], c[1] - hy - 120]]})
        self.lanes.append({'kind': 'service', 'w': 12, 'z': z, 'pts': [[c[0] - hx + 6, c[1] + hy - 8], [c[0] + hx - 6, c[1] + hy - 8]]})
        for x in np.arange(c[0] - hx + 15, c[0] + hx, 45): self.add('prop_street_light', x, c[1] + hy - 1, -math.pi / 2, 'light')

    def rail(self, lm):
        c = np.array(lm['center']); s = lm['size']; z = lm['h']; self.paint(c, s, 0, 'gravel')
        crossings = [c[0] - 100, c[0] + 100]
        for track_y in (c[1] - 3.5, c[1] + 3.5):
            for x in np.arange(c[0] - s[0] / 2 + 10, c[0] + s[0] / 2, 20):
                nm = 'prop_rail_crossing' if min(abs(x - cx) for cx in crossings) < 10 else 'prop_rail_track'
                self.add(nm, x, track_y, 0, 'rail', z=z, block=False)
        for k in range(8): self.add('prop_rail_wagon', c[0] - 80 + k * 17.5, c[1] + 3.5, 0, 'rail', z=z + 0.3, block=True)

    # ── environment: town, docks lights, forests, scatter, rocks, cliffs, coast, coral, banks, farms ──
    def scatter_buildings(self, names, center, rmin, rmax, count, near_road=True, cat='town'):
        placed = 0
        for _ in range(count * 60):
            if placed >= count: break
            a = self.rng.uniform(0, 6.28); r = self.rng.uniform(rmin, rmax); p = np.asarray(center) + r * np.array([math.cos(a), math.sin(a)])
            nm = names[int(self.rng.integers(len(names)))]; sz = info(nm)['size'][:2]
            if not (0 < p[0] < self.S and 0 < p[1] < self.S): continue
            dd = self.road_d[int(p[1] / RES), int(p[0] / RES)]
            if near_road and not (22 < dd < 70): continue
            rot = self.road_ang(p) if near_road else 0.0
            w, m = self.rect(p, sz, rot, pad=10)  # 8 m separation + 2 m raster margin
            if (m & (self.excl[w] | self.solid[w] | (self.slope[w] > 6) | (self.h[w] < 1))).any(): continue
            self.add(nm, *p, rot, cat); self.paint(p, [sz[0] + 10, sz[1] + 10], rot, 'concrete'); placed += 1

    def road_ang(self, p):
        j, i = int(p[1] / RES), int(p[0] / RES); jj, ii = self.road_near[0][j, i], self.road_near[1][j, i]
        v = np.array([ii - i, jj - j], float); return math.atan2(v[1], v[0]) + math.pi / 2

    def lane_mask(self):
        """Landing approach lanes: beach width + 15 m each side, from 40 m behind the ramp top to 150 m beyond the shoreline (spec: keep coral and boulders out)."""
        m = np.zeros_like(self.h, bool)
        for b in self.meta['beaches']:
            c = np.array(b['center']); d = np.array(b['dir'], float); along = (self.X - c[0]) * d[0] + (self.Y - c[1]) * d[1]; across = -(self.X - c[0]) * d[1] + (self.Y - c[1]) * d[0]
            m |= (along > -b['ramp_len'] - 40) & (along < b['shore_offset'] + 150) & (np.abs(across) < b['width_m'] / 2 + 15)
        return m

    def eligible(self):
        """Cells where solid vegetation/rocks may go."""
        e = (self.h > 0.6) & (self.slope < 32) & ~self.M['road_band'] & ~self.M['protect'] & ~self.excl & ~self.solid & ~self.landing_lanes
        for k, v in self.M.items():
            if k.startswith('beach_'): e &= ~ndi.binary_dilation(v, iterations=5)
        for b in self.meta['bridges']:
            for p in (b['start'], b['end']): e &= np.hypot(self.X - p[0], self.Y - p[1]) > 120
        for q in self.meta['quarries']:
            c, r = q['center'], q['radii']; e &= (((self.X - c[0]) / (r[0] + 20)) ** 2 + ((self.Y - c[1]) / (r[1] + 20)) ** 2) > 1
        return e

    def darts(self, mask, n_target, spacing, prob=None, max_try=None, existing=None):
        """Dart throwing with a spatial hash: accepted points keep `spacing` apart."""
        js, is_ = np.nonzero(mask)
        if len(js) == 0 or n_target <= 0: return np.zeros((0, 2))
        cell = spacing; grid = {} if existing is None else existing; out = []
        tries = max_try or n_target * 25; pick = self.rng.integers(0, len(js), tries); jit = self.rng.uniform(-RES / 2, RES / 2, (tries, 2)); u = self.rng.random(tries)
        for t in range(tries):
            if len(out) >= n_target: break
            j, i = js[pick[t]], is_[pick[t]]
            if prob is not None and u[t] > prob[j, i]: continue
            p = np.array([i * RES, j * RES]) + jit[t]; gk = (int(p[0] // cell), int(p[1] // cell)); ok = True
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for q in grid.get((gk[0] + dx, gk[1] + dy), ()):
                        if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < spacing * spacing: ok = False; break
                    if not ok: break
                if not ok: break
            if ok: out.append(p); grid.setdefault(gk, []).append(p)
        return np.array(out).reshape(-1, 2)

    def tree_scale(self, sp):
        H = SPECIES_H.get(sp, 14); lo, hi = max(0.72, 10.5 / H), min(1.22, 17.8 / H); return float(self.rng.uniform(lo, hi))

    def forests(self):
        elig = self.eligible(); clump = fbm(self.n, self.d['seed'] + 41, [70, 25], [0.7, 0.3]); clump = np.clip(0.75 + clump * 0.35, 0.25, 1)
        self.forest_mask = np.zeros_like(elig); trunk_grid = {}; tot = 0
        for pk, fp in enumerate(self.meta['forest_patches']):
            c = self.m_(fp[:2]); r = self.m_(fp[2:])
            dd = np.sqrt(((self.X - c[0]) / r[0]) ** 2 + ((self.Y - c[1]) / r[1]) ** 2); inside = dd < 1
            self.forest_mask |= dd < 0.8; self.surf = np.where(inside & elig & (self.surf == SURF['grass']), SURF['forest'], self.surf)
            area = float((inside & elig).sum()) * RES * RES; mix = self.bio['forest']
            per = sum(w * PER_TREE[k] for _, k, w in mix); N = int(area / per)
            prob = np.where(inside, (1 - smoothstep(0.65, 1.0, dd)) * 0.85 + 0.15, 0) * clump  # thinner, ragged edges
            pts = self.darts(inside & elig, N, 5.0, prob=prob, existing=trunk_grid); tot += len(pts)
            sp_names = [m[0] for m in mix]; sp_w = np.array([m[2] for m in mix]); sp_w /= sp_w.sum()
            for p in pts:
                sp = sp_names[self.rng.choice(len(sp_names), p=sp_w)]
                self.add(sp, *p, self.rng.uniform(0, 6.28), 'tree', scale=self.tree_scale(sp), z=self.z(*p) - 0.1, patch=pk)
            # understory shrubs/ferns in the patch
            for p in self.darts(inside & elig, int(area / 220), 3.0):
                sh = self.bio['shrubs'][int(self.rng.integers(len(self.bio['shrubs'])))]
                self.add(sh, *p, self.rng.uniform(0, 6.28), 'shrub', scale=self.rng.uniform(0.7, 1.25))
        self.trunk_grid = trunk_grid; self.forest_trees = tot
        # isolated clumps and single trees in open land (crushable when small and isolated)
        e2 = elig & ~self.forest_mask
        land_area = float(e2.sum()) * RES * RES; st = self.bio['scatter_trees']; names = [s[0] for s in st]; wts = np.array([s[1] for s in st]); wts /= wts.sum()
        centers = self.darts(e2, int(land_area / 30000), 60.0)
        for cc in centers:
            k = int(self.rng.integers(3, 11)); sp = names[self.rng.choice(len(names), p=wts)]
            for _ in range(k):
                p = cc + self.rng.normal(0, 13, 2); j, i = int(p[1] / RES), int(p[0] / RES)
                if not (0 <= j < self.n and 0 <= i < self.n and e2[j, i]): continue
                gk = (int(p[0] // 5), int(p[1] // 5))
                if any((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < 25 for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in trunk_grid.get((gk[0] + dx, gk[1] + dy), ())): continue
                trunk_grid.setdefault(gk, []).append(p)
                self.add(sp, *p, self.rng.uniform(0, 6.28), 'tree_scatter', scale=self.tree_scale(sp), z=self.z(*p) - 0.1, crushable=k <= 4)
        for p in self.darts(e2, int(land_area / 900), 4.0):
            sh = self.bio['shrubs'][int(self.rng.integers(len(self.bio['shrubs'])))]; self.add(sh, *p, self.rng.uniform(0, 6.28), 'shrub', scale=self.rng.uniform(0.6, 1.2))

    def rocks(self):
        elig = self.eligible() & ~self.forest_mask; rk = self.bio['rocks']
        hillw = np.zeros_like(self.h)
        for hl in self.meta['hills']:
            c = self.m_(hl['center']); r = self.m_(hl['radii']); d2 = ((self.X - c[0]) / r[0]) ** 2 + ((self.Y - c[1]) / r[1]) ** 2; hillw = np.maximum(hillw, np.where(d2 < 1, 1 - d2, 0))
        prob = 0.12 + hillw * 0.9
        for p in self.darts(elig, int(elig.sum() * RES * RES / 9000), 14.0, prob=prob):
            nm = rk[int(self.rng.integers(len(rk)))]; s = self.rng.uniform(0.6, 1.4)
            self.add(nm, *p, self.rng.uniform(0, 6.28), 'rock', scale=s, z=self.z(*p) - 0.3 * s, block=s > 0.9)
        # coast: cliffs on steep natural shores, wet boulders at the waterline
        land = self.h > 0; dw = ndi.distance_transform_edt(land) * RES
        cliffy = land & (dw < 14) & (self.slope > 30) & ~self.M['protect'] & ~self.excl & ~self.M['road_band'] & ~self.landing_lanes
        if self.bio.get('cliff'):
            gy, gx = np.gradient(self.h)
            for p in self.darts(cliffy, 4000, 16.0):
                j, i = int(p[1] / RES), int(p[0] / RES); ang = math.atan2(-gy[j, i], -gx[j, i])  # face downhill (to sea)
                top = float(self.h[max(j - 6, 0):j + 7, max(i - 6, 0):i + 7].max())
                self.add(self.bio['cliff'], *p, ang + math.pi / 2, 'cliff', z=-1.0, scale=1.0, sz=round(max(top + 1.5, 4) / 11.5, 3), block=True)  # local −Y (sea face) → downhill
        shore = (self.h > -1.4) & (self.h < 0.8) & ~self.excl & ~self.M['protect'] & ~self.landing_lanes
        wet = self.bio['coast_rock']
        prob_c = np.clip(fbm(self.n, self.d['seed'] + 77, [90], [1.0]) + 0.3, 0, 1)
        for p in self.darts(shore, int(shore.sum() * RES * RES / 700), 7.0, prob=prob_c):
            s = self.rng.uniform(0.35, 1.0); self.add(wet, *p, self.rng.uniform(0, 6.28), 'coast_rock', scale=s, z=self.z(*p) - 0.6 * s, block=max(info(wet)['size'][:2]) * s >= 3.0)  # boulders ≥ 3 m block
        # large rocks and cliff pieces are blocked areas for every land class (spec §5); marked after all rocks are placed
        for it in self.rock_solid:
            sz = info(it['asset'])['size']; w, m = self.rect((it['x'], it['y']), [sz[0] * it['s'] * 0.8, sz[1] * it['s'] * 0.8], it['rot']); self.solid[w] |= m

    def biome_extras(self):
        mid = self.mid; elig = self.eligible() & ~self.forest_mask
        if self.bio.get('coral'):
            reef = (self.h < -1.2) & (self.h > -6.5) & ~self.excl & ~self.landing_lanes
            for b in self.meta['beaches']:  # keep coral out of each landing approach: the beach width + 20 m margin, from the apron to 600 m offshore
                c = np.array(b['center']); d = np.array(b['dir'], float); along = (self.X - c[0]) * d[0] + (self.Y - c[1]) * d[1]; across = -(self.X - c[0]) * d[1] + (self.Y - c[1]) * d[0]
                reef &= ~((along > -b['ramp_len'] - 40) & (along < 600) & (np.abs(across) < b['width_m'] / 2 + 20)) & (np.hypot(self.X - c[0], self.Y - c[1]) > b['width_m'] / 2 + 70)
            for p in self.darts(reef, int(reef.sum() * RES * RES / 260), 4.0):
                nm = self.bio['coral'][int(self.rng.integers(2))]; self.add(nm, *p, self.rng.uniform(0, 6.28), 'coral', scale=self.rng.uniform(0.6, 1.5), block=False)
        if mid == '02':  # delta banks: mangroves, reeds, mud; farm plots
            bank = (self.h > 0) & (self.h < 2.6) & ~self.excl & ~self.M['road_band']
            sel = fbm(self.n, self.d['seed'] + 91, [160], [1.0]) > -0.1
            self.surf = np.where(bank & sel, SURF['mud'], self.surf)
            for p in self.darts(bank & sel, int((bank & sel).sum() * RES * RES / 150), 6.0):
                self.add('veg_mangrove', *p, self.rng.uniform(0, 6.28), 'tree', scale=self.rng.uniform(0.8, 1.15), z=self.z(*p) - 0.2)
            reedz = (self.h > -0.7) & (self.h < 0.5) & ~self.excl
            for p in self.darts(reedz & sel, int((reedz & sel).sum() * RES * RES / 45), 2.5):
                self.add('veg_reeds', *p, self.rng.uniform(0, 6.28), 'reeds', scale=self.rng.uniform(0.7, 1.3), block=False)
            fields = 0
            for _ in range(400):
                if fields >= 10: break
                w_, h_ = self.rng.uniform(70, 130), self.rng.uniform(45, 80); p = np.array([self.rng.uniform(100, self.S - 100), self.rng.uniform(500, self.S - 100)])
                rot = 0.0 if self.rng.random() < 0.5 else math.pi / 2
                wnd, m = self.rect(p, [w_, h_], rot, pad=6)
                if not (m & elig[wnd]).sum() == m.sum(): continue
                self.paint(p, [w_, h_], rot, 'farm'); self.excl[wnd] |= m; fields += 1
                self.areas.append({'kind': 'farm', 'center': p.tolist(), 'size': [w_, h_], 'rot': rot})
                for yy in np.arange(-h_ / 2 + 2, h_ / 2 - 1, 2.6):
                    for xx in np.arange(-w_ / 2 + 2, w_ / 2 - 1, 2.6):
                        if self.rng.random() < 0.7:
                            q = p + np.array([xx * math.cos(rot) - yy * math.sin(rot), xx * math.sin(rot) + yy * math.cos(rot)])
                            self.add('veg_crop', *q, self.rng.uniform(0, 6.28), 'crop', scale=self.rng.uniform(0.8, 1.1), block=False)
        self.infrastructure_details()
        if mid == '01':  # logistics town along the central road, decorative substation
            mid_c = self.m_([500, 500]); self.scatter_buildings(['prop_office_block', 'prop_warehouse_b', 'prop_office_block'], mid_c, 60, 260, 9)
            self.scatter_buildings(['bld_power_substation'], self.m_([560, 400]), 30, 160, 1, cat='decor_substation')
        if mid == '03':  # sealed tunnel portals and granite slabs
            for qx in (235, 765):
                p = self.m_([qx, 985]); self.add('prop_tunnel_portal', p[0], p[1] - 10, 0, 'landmark', landmark='tunnel-portal-sealed')
            for p in self.darts(elig, int(elig.sum() * RES * RES / 12000), 25.0):
                ro_ = self.rng.uniform(0, 6.28); sc_ = self.rng.uniform(0.6, 1.3)  # same draw order as before (rotation, then scale)
                self.add('rock_granite_slab', *p, ro_, 'rock', scale=sc_, z=self.z(*p) - 0.4, block=info('rock_granite_slab')['size'][2] * sc_ - 0.4 >= 1.0)  # slabs standing ≥ 1 m block
        if mid == '04':  # abandoned resort shells on the home islands
            for p in self.meta['pads']:
                c = np.array(p['center']); self.scatter_buildings(['prop_resort_shell'], c, 150, 260, 1, near_road=False, cat='resort')
        if mid == '05':  # poplar windbreaks along the rear roads, industrial lights on the boulevard and coast road
            for r in self.meta['roads']:
                xy = np.array(r['xy'])
                if r['id'].split('#')[0] in ('west-rear', 'east-rear', 'north-ridge'):
                    for k in range(0, len(xy) - 4, 4):
                        t = xy[k + 1] - xy[k]; t /= np.linalg.norm(t); nrm = np.array([-t[1], t[0]])
                        for side in (1,):
                            p = xy[k] + nrm * side * (r['clear_w'] / 2 + 10)
                            j, i = int(p[1] / RES), int(p[0] / RES)
                            if 0 <= j < self.n and 0 <= i < self.n and elig[j, i]: self.add('veg_poplar', *p, self.rng.uniform(0, 6.28), 'windbreak', scale=self.tree_scale('veg_poplar'), z=self.z(*p) - 0.1)
                if r['id'].split('#')[0] in ('industrial-boulevard', 'coastal-road'):
                    for k in range(0, len(xy) - 1, 30):
                        t = xy[min(k + 1, len(xy) - 1)] - xy[k]; t /= np.linalg.norm(t) + 1e-9; nrm = np.array([-t[1], t[0]]); s = 1 if (k // 30) % 2 else -1
                        p = xy[k] + nrm * s * (r['clear_w'] / 2 + 3)
                        if self.road_d[min(int(p[1] / RES), self.n - 1), min(int(p[0] / RES), self.n - 1)] < 1.5: continue  # pole would stand in another road's clear width (junction)
                        self.add('prop_street_light', *p, math.atan2(-nrm[1] * s, -nrm[0] * s), 'light')

    def surface(self):
        h = self.h; land = h > 0; dw = ndi.distance_transform_edt(land) * RES
        s = self.surf
        rock = land & (self.slope > 33); s = np.where(rock, SURF['rock'], s)
        sand = land & (dw < 22) & (h < 2.2) & (self.slope < 18) & ~self.M['protect']
        s = np.where(sand & (s != SURF['mud']), SURF['sand'], s)
        for k, v in self.M.items():
            if k.startswith('beach_'): s = np.where(v & land, SURF['sand'], s)
        s = np.where(land & (dw < 4) & (s == SURF['sand']), SURF['wetsand'], s)
        s = np.where(self.M['quarry_floor'], SURF['quarry'], s)
        # road shoulders gravel, cores asphalt (roads are also separate meshes)
        sh = self.M['road_band'] & ~self.M['road_core'] & (s != SURF['concrete'])
        s = np.where(sh & (ndi.distance_transform_edt(~self.M['road_core']) * RES < 5), SURF['gravel'], s)
        s = np.where(self.M['road_core'], SURF['asphalt'], s)
        for k, v in self.M.items():  # landing beaches win over road paint (paved roads stop at the beach apron)
            if k.startswith('beach_'): s = np.where(v & land & (s == SURF['asphalt']), SURF['sand'], s)
        mead = fbm(self.n, self.d['seed'] + 55, [120, 40], [0.7, 0.3]) > 0.35
        s = np.where((s == SURF['grass']) & mead, SURF['meadow'], s)
        # bare worn tracks: compacted dirt along pad edges and road shoulders' outer band
        worn = (s == SURF['grass']) & self.M['road_band'] & (fbm(self.n, self.d['seed'] + 66, [30], [1.0]) > 0.2)
        s = np.where(worn, SURF['dirt'], s)
        s = np.where(~land, 255, s).astype(np.uint8)
        self.surf = s
        grass = np.isin(s, [SURF['grass'], SURF['meadow'], SURF['forest']]).astype(np.float32)
        grass = np.where(s == SURF['soil'], 0.12, grass); grass = np.where(s == SURF['sand'], 0.08, grass)
        self.grass = ndi.gaussian_filter(grass, 1.2).astype(np.float16)

    def harvesters(self):
        """Two demonstration harvesters per base, each on its own refinery→home-deposit test route. Placed last, after every
        blocking footprint, rock and forest is known: the route is a least-cost path on a harvester grid (≤ 15° slope, land or deck,
        blocking footprints grown by the 2.6 m harvester radius, dense forest avoided, roads preferred), and the unit stands on it."""
        from skimage.graph import MCP_Geometric
        R = 2.6; obst = ndi.binary_dilation(self.solid, iterations=int(math.ceil(R / RES)))
        ok = (self.h > 0.4) & (self.slope <= 15.0) & ~obst
        cost = np.where(ok, np.where(self.M['road_core'], 1.0, 2.5), np.inf); cost = np.where(ok & self.forest_mask, 12.0, cost)
        refs = {}
        for it in self.items:
            if it['asset'] == 'bld_ore_refinery': refs.setdefault(it['base'], []).append(it)
        for p in self.meta['pads']:
            rs = sorted(refs.get(p['id'], []), key=lambda it: it['x']); hs = sorted([d for d in self.meta['deposits'] if d.get('nearest') == p['id'] and d['kind'] == 'home'], key=lambda d: d['service_point'][0])
            if len(rs) < 2 or len(hs) < 2: continue
            bays = [np.array(q) for q in sorted(self.kits[p['id']]['refinery_bays'], key=lambda q: q[0])]  # bay mouths facing the home deposits, west to east like rs
            pairs = min(([(0, 0), (1, 1)], [(0, 1), (1, 0)]), key=lambda pr: sum(np.linalg.norm(bays[a] - np.array(hs[b]['service_point'])) for a, b in pr))
            mcp = MCP_Geometric(cost)
            for k, (ra, hb) in enumerate(pairs):
                src, dst = bays[ra], np.array(hs[hb]['service_point'])
                s_ij = (int(round(src[1] / RES)), int(round(src[0] / RES))); d_ij = (int(round(dst[1] / RES)), int(round(dst[0] / RES)))
                if not (np.isfinite(cost[s_ij]) and np.isfinite(cost[d_ij])):
                    self.conflicts.append(f"base {p['id']}: harvester test route {rs[ra]['role']} → {hs[hb]['id']} has no clear start/end cell; harvester not placed"); continue
                mcp.find_costs([s_ij], [d_ij]); path = np.array(mcp.traceback(d_ij))[:, ::-1] * RES  # (x, y) metres
                seg = np.linalg.norm(np.diff(path, axis=0), axis=1); L = np.r_[0, np.cumsum(seg)]
                placed = None
                for f in (0.45, 0.4, 0.5, 0.35, 0.55, 0.3, 0.6):  # stand on the route, footprint clear of every blocking footprint
                    q = np.interp(L[-1] * f, L, path[:, 0]), np.interp(L[-1] * f, L, path[:, 1]); q = np.array(q)
                    q2 = np.array([np.interp(L[-1] * f + 6, L, path[:, 0]), np.interp(L[-1] * f + 6, L, path[:, 1])]); ang = math.atan2(*(q2 - q)[::-1])
                    w, m = self.rect(q, [10.4, 4.4], ang)
                    if not (self.solid[w] & m).any(): placed = (q, ang); break
                if placed is None:
                    self.conflicts.append(f"base {p['id']}: no clear spot for harvester {k + 1} on its test route; not placed"); continue
                q, ang = placed; rid = f"{p['id']}-harvest-{k + 1}"
                self.add('unit_harvester', *q, ang, 'demo', team=p['team'], base=p['id'], role=f'harvester_{k + 1}', route=rid)
                keep = np.r_[0, np.where(np.diff(np.floor(L / 8)))[0] + 1, len(path) - 1]  # ≈ 8 m polyline
                self.routes.append({'id': rid, 'kind': 'harvester_test', 'base': p['id'], 'from': rs[ra]['role'], 'to': hs[hb]['id'],
                                    'length_m': round(float(L[-1]), 1), 'pts': np.round(path[np.unique(keep)], 1).tolist()})

    def infrastructure_details(self):
        """Biome infrastructure named in the spec, from the shared asset library: road culverts under the deepest embankments
        (01, 02, 05), stormwater grates along urban/industrial roads (01, 02, 05), pipe racks along the industrial boulevard (05),
        concrete levee walls and pump outfalls on Delta Grid's inner channel banks (02), service fences around Granite Fjord's
        wind farms (03). Deterministic (no random draws), placed before forests and rocks so those respect them."""
        mid = self.mid; done = []
        def road_pts(r):
            xy = np.array(r['xy']); z = np.array(r['z']); br = np.array(r['bridge']); ob = np.array(r.get('on_beach', [False] * len(xy)))
            t = np.gradient(xy, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9; return xy, z, br | ob, t
        rid = self.M['road_id']; pad_m = np.zeros_like(self.h, bool)
        for q in self.meta['pads']: pad_m |= self.M[f"pad_{q['id']}"]
        pad_d = ndi.distance_transform_edt(~pad_m) * RES
        # culverts: road on an embankment ≥ 2.0 m above the ground on both sides (the asset's channel bed is 2.8 m below the road), away from junctions, pads and decks
        if mid in ('01', '02', '05'):
            cand = []
            for k, r in enumerate(self.meta['roads']):
                if r['clear_w'] < 24: continue
                xy, z, skip, t = road_pts(r); other = ndi.distance_transform_edt(~((rid >= 0) & (rid != k))) * RES
                nrm = np.c_[-t[:, 1], t[:, 0]]; off = r['clear_w'] / 2 + 12
                hl = ndi.map_coordinates(self.h, [(xy + nrm * off)[:, 1] / RES, (xy + nrm * off)[:, 0] / RES], order=1)
                hr = ndi.map_coordinates(self.h, [(xy - nrm * off)[:, 1] / RES, (xy - nrm * off)[:, 0] / RES], order=1)
                fill = z - np.maximum(hl, hr)
                for i in range(30, len(xy) - 30):
                    j_, i_ = int(xy[i][1] / RES), int(xy[i][0] / RES)
                    if skip[max(i - 20, 0):i + 20].any() or other[j_, i_] < 50 or pad_d[j_, i_] < 25 or min(hl[i], hr[i]) <= 0.3: continue
                    if fill[i] >= 2.0 and fill[i] >= fill[i - 30:i + 31].max() - 1e-6: cand.append((float(fill[i]), xy[i], math.atan2(t[i][1], t[i][0]), float(z[i]), r['id']))
            cand.sort(key=lambda c: -c[0]); keep = []
            for c in cand:
                if len(keep) < 6 and all(np.linalg.norm(c[1] - k_[1]) > 200 for k_ in keep): keep.append(c)
            for f, xy_, ang, zz, rid_ in keep:
                self.add('prop_culvert_end', *xy_, ang, 'culvert', z=zz, block=False, road=rid_, fill_m=round(f, 1))
            done.append(f"{len(keep)} culverts")
        # stormwater grates along the kerbs of the town / industrial roads (flush with the road surface)
        grate_roads = {'01': ('central',), '02': ('central-spine',), '05': ('industrial-boulevard', 'coastal-road')}.get(mid, ())
        ng = 0
        for k, r in enumerate(self.meta['roads']):
            if r['id'].split('#')[0] not in grate_roads: continue
            xy, z, skip, t = road_pts(r); nrm = np.c_[-t[:, 1], t[:, 0]]
            for i in range(10, len(xy) - 10, 20):
                if skip[i]: continue
                sd = 1 if (i // 20) % 2 else -1; q = xy[i] + nrm[i] * sd * (r['clear_w'] / 2 - 0.8)
                if rid[int(q[1] / RES), int(q[0] / RES)] not in (k, -1): continue
                self.add('prop_drainage_grate', *q, math.atan2(t[i][1], t[i][0]), 'stormwater', z=float(z[i]) + 0.07, block=False); ng += 1
        if ng: done.append(f"{ng} drainage grates")
        # pipe racks: continuous 20 m tiles beside the industrial boulevard, outside its corridor and safety band
        if mid == '05':
            n0 = len(self.items)
            for r in self.meta['roads']:
                if r['id'].split('#')[0] != 'industrial-boulevard': continue
                xy, z, skip, t = road_pts(r); L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
                for sd in (1, -1):
                    for s0 in np.arange(40, L[-1] - 40, 20.5):
                        i = int(np.searchsorted(L, s0)); nrm = np.array([-t[i][1], t[i][0]]); q = xy[i] + nrm * sd * (r['clear_w'] / 2 + 6 + 5)
                        ang = math.atan2(t[i][1], t[i][0]); w, m = self.rect(q, [20.5, 5.0], ang, pad=1.0)
                        if (m & (self.excl[w] | self.solid[w] | self.M['road_band'][w] | (self.slope[w] > 6))).any(): continue
                        self.add('prop_pipe_gantry', *q, ang, 'pipes'); self.excl[w] |= m
            done.append(f"{len(self.items) - n0} pipe-rack tiles")
        # Delta Grid: concrete levee walls along the inner banks of both channels + four pump outfalls
        if mid == '02':
            nlev = 0; outs = []
            ys = np.arange(80, self.S - 80, 3.0)
            for side, (x_lo, x_hi, step) in (('west', (self.S * 0.36, self.S * 0.48, 1)), ('east', (self.S * 0.64, self.S * 0.52, -1))):
                for y in ys:
                    xs = np.arange(x_lo, x_hi, step * 2.0); jj = int(y / RES); hh = self.h[jj, np.clip((xs / RES).astype(int), 0, self.n - 1)]
                    wet = np.where(hh <= 0)[0]
                    if not len(wet): continue
                    top = np.where((np.arange(len(xs)) > wet[-1]) & (hh >= 2.0))[0]  # first dry cell ≥ 2 m inland of the last water cell
                    if not len(top): continue
                    q = np.array([xs[top[0]], y]); j_, i_ = int(q[1] / RES), int(q[0] / RES)
                    if self.M['road_band'][j_, i_] or self.excl[j_, i_] or self.slope[j_, i_] > 20: continue
                    self.add('prop_jersey_barrier', *q, math.pi / 2, 'levee', block=False); nlev += 1
                    if abs(y - self.S * 0.42) < 1.6 or abs(y - self.S * 0.58) < 1.6: outs.append((q, -step))
            for q, d in outs:  # pump outfall: pipe rack from the levee out over the bank, two pump cabinets behind it
                c0 = q + np.array([d * 10.0, 0.0])
                w, m = self.rect(c0, [20.0, 5.0], 0.0)
                if (m & self.solid[w]).any(): continue
                self.add('prop_pipe_gantry', *c0, 0.0, 'pump', z=max(self.z(*c0), 0.4), block=False)
                for dy in (-3.0, 3.0): self.add('prop_utility_cabinet', *(q - np.array([d * 4.0, dy])), math.pi / 2, 'pump')
            done.append(f"{nlev} levee barrier units, {len(outs)} pump outfalls")
        # Granite Fjord: service fences around the wind-farm compounds, gates on two sides
        if mid == '03':
            n0 = len(self.items)
            for lm in self.meta['landmarks']:
                if 'wind-farm' in lm['id']: self.fence_rect(np.array(lm['center']), lm['size'], gap_side=('north', 'south'))
            done.append(f"{len(self.items) - n0} service-fence bays")
        self.details = done

    def bridge_lights(self):
        """Deck lights every 40 m on each contiguous bridge/causeway span (both sides, arms over the deck)."""
        for r in self.meta['roads']:
            br = np.array(r['bridge'])
            if not br.any(): continue
            lab, nrun = ndi.label(br); xy_all = np.array(r['xy']); z_all = np.array(r['z'])
            for k in range(1, nrun + 1):
                xy = xy_all[lab == k]; a, e = xy[0], xy[-1]; L = np.linalg.norm(e - a); ang = math.atan2(*(e - a)[::-1])
                nrm = np.array([-math.sin(ang), math.cos(ang)]); deck = float(z_all[lab == k].mean()); W = r['clear_w'] + 3.0
                for t in np.arange(0.05, 1.0, 40.0 / L):
                    for sd in (-1, 1):
                        p = a + (e - a) * t + nrm * sd * (W / 2 - 0.6)
                        self.add('prop_street_light', *p, ang - sd * math.pi / 2, 'light', z=deck, block=False, on_deck=f"{r['id']}#{k}")

    def run(self):
        print(f"[{self.mid}] placing")
        self.road_d, self.road_near = ndi.distance_transform_edt(~self.M['road_core'], return_indices=True); self.road_d *= RES
        self.forest_mask = np.zeros_like(self.h, bool); self.landing_lanes = self.lane_mask()
        for fp in self.meta['forest_patches']:
            c = self.m_(fp[:2]); r = self.m_(fp[2:]); self.forest_mask |= (((self.X - c[0]) / r[0]) ** 2 + ((self.Y - c[1]) / r[1]) ** 2) < 1.0
        self.base_kits(); self.deposits(); self.docks(); self.bridge_lights(); self.landmarks(); self.biome_extras(); self.forests(); self.rocks(); self.harvesters(); self.surface()
        cats = {}
        for it in self.items: cats[it['cat']] = cats.get(it['cat'], 0) + 1
        print('  ', cats, getattr(self, 'details', [])); return self

    def save(self):
        out = {'map': self.mid, 'count': len(self.items), 'items': self.items, 'lanes': self.lanes, 'areas': self.areas, 'conflicts': self.conflicts,
               'deposits': self.meta['deposits'], 'routes': self.routes, 'kits': self.kits, 'surface_classes': SURF}
        (self.b / 'instances.json').write_text(json.dumps(out))
        np.savez_compressed(self.b / 'surface.npz', surf=self.surf, grass=self.grass, solid=self.solid, forest=self.forest_mask)

if __name__ == '__main__':
    sel = sys.argv[1] if len(sys.argv) > 1 else 'all'
    for m in LAYOUT['maps']:
        if sel in ('all', m['id']): Placer(m['id']).run().save()
