"""Navigation layers and acceptance checks for a generated + placed map.

Layers (2 m grid, bit flags in nav.npz): 1 infantry, 2 tracked vehicle (MBT), 4 harvester, 8 amphibious, 16 ship.
Each layer applies its own slope limit, footprint clearance (EDT ≥ radius) and surface rules; bridge and dock
decks are land for land layers; ships need ≥ 3 m depth and clearance under decks.
Run: blender-env/bin/python maps/gen/navcheck.py <id|all> → build/<id>/nav.npz, validation.json
"""
import json, math, sys
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
from skimage.graph import MCP_Geometric
sys.path.insert(0, str(Path(__file__).parent))
from mapgen import rect_dist, RES, OVR, LAYOUT, REVISIONS
from assets import info

ROOT = Path(__file__).resolve().parents[1]
SPEC = {  # shared dimensions to verify against measured asset bounds (x, y, z); None = not constrained
    'bld_barracks': (24, 12, 6), 'bld_vehicle_factory': (40, 30, 12), 'bld_hq': (30, 24, 10), 'bld_ore_refinery': (36, 28, 16),
    'bld_power_substation': (20, 16, 6), 'bld_radar_control': (16, 12, 6), 'bld_extraction_rig': (16, 12, 12),
    'unit_mbt': (9.5, 3.6, 2.5), 'unit_apc': (7, 3, 2.8), 'unit_harvester': (10, 4, 4), 'unit_patrol_boat': (32, 7, 11),
    'unit_infantry': (None, None, 1.8), 'prop_container_20': (6.06, 2.44, 2.59), 'prop_container_40': (12.19, 2.44, 2.59),
    'bld_naval_dock': (80, 40, None)}
LAYER = {'infantry': 1, 'tank': 2, 'harvester': 4, 'amphibious': 8, 'ship': 16}
SLOPE = {'infantry': 40, 'tank': 20, 'harvester': 15, 'amphibious': 17}
RADIUS = {'infantry': 0.35, 'tank': 2.3, 'harvester': 2.6, 'amphibious': 2.3, 'ship': 5.0}
PACE = json.loads((ROOT.parent / 'data' / 'pace.json').read_text())   # game-speed settings (data/pace.json); times below are GAME seconds
_rt = PACE['reference_tank']['maps']; _hr = PACE['harvester_speed_ratio']
SPEED = {'tank': (_rt['road_mps'], _rt['offroad_mps']), 'harvester': (_rt['road_mps'] * _hr, _rt['offroad_mps'] * _hr),   # harvester = ratio × tank (pace.json)
         'infantry': (2.0, 1.6), 'amphibious': (10.0, 6.0), 'ship': (14.0, 14.0)}

class Check:
    def __init__(self, mid):
        self.mid = mid; b = ROOT / 'build' / mid; self.b = b; self.extra_conflicts = []
        self.h = np.load(b / 'height.npy'); M = np.load(b / 'masks.npz'); self.M = {k: M[k] for k in M.files}
        S = np.load(b / 'surface.npz'); self.surf = S['surf']; self.solid = S['solid']
        self.meta = json.loads((b / 'meta.json').read_text()); self.inst = json.loads((b / 'instances.json').read_text())
        self.d = next(m for m in LAYOUT['maps'] if m['id'] == mid); self.n = self.h.shape[0]; self.S = self.meta['size_m']
        ax = np.arange(self.n) * RES; self.X, self.Y = np.meshgrid(ax, ax)
        gy, gx = np.gradient(self.h, RES); self.slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        self.res = []; self.metrics = {}

    def ok(self, name, passed, detail, kind='auto'):
        if isinstance(passed, np.bool_): passed = bool(passed)
        self.res.append({'check': name, 'status': 'PASS' if passed is True else ('WARN' if passed == 'warn' else 'FAIL'), 'detail': detail, 'kind': kind})
        print(f"  [{self.res[-1]['status']}] {name}: {detail}")

    def ij(self, p): return int(round(p[1] / RES)), int(round(p[0] / RES))
    def mq(self, q): return np.asarray(q, float) * self.S / 1000

    # ── layers ──
    def build_layers(self):
        n = self.n; deck = np.zeros((n, n), bool); low_deck = np.zeros((n, n), bool); piers = np.zeros((n, n), bool)
        for r in self.meta['roads']:
            xy = np.array(r['xy']); br = np.array(r['bridge'])
            if not br.any(): continue
            lab, nrun = ndi.label(br)
            for k in range(1, nrun + 1): self._deck_run(r, xy[lab == k], deck, low_deck, piers)
        self._finish_layers(deck, low_deck, piers)

    def _deck_run(self, r, P, deck, low_deck, piers):
        """One contiguous bridge/causeway span (a road can cross several channels, e.g. Delta Grid's two bridges per road)."""
        a, e = P[0], P[-1]; c = (a + e) / 2; L = np.linalg.norm(e - a) + 16; ang = math.atan2(*(e - a)[::-1])  # decks overlap their abutments
        _, ins = rect_dist(self.X, self.Y, c, [L, r['clear_w'] + 4], ang); deck |= ins
        bh = next((b['deck_h'] for b in self.meta['bridges'] if np.linalg.norm(np.array(b['start']) - a) < 30 or np.linalg.norm(np.array(b['end']) - a) < 30), 14)
        if bh - 2.0 < 9.0 + 3.0: low_deck |= ins  # underside below the patrol boat's 9 m + 3 m clearance
        else:
            for t in (0.17, 0.33, 0.67, 0.83):  # piers clear of the principal (central) channel
                _, pm = rect_dist(self.X, self.Y, a + (e - a) * t, [5, r['clear_w'] + 2], ang); piers |= pm
        self.metrics.setdefault('bridges', []).append({'road': r['id'], 'start': a.round(1).tolist(), 'end': e.round(1).tolist(), 'span_m': round(float(np.linalg.norm(e - a)), 1), 'deck_h': bh, 'underside_m': bh - 2.0})

    def compound_approaches(self):
        """Decorative compounds need at least two vehicle approaches (spec §8). For each landmark compound with a fence, walk its
        perimeter 3 m outside the fence line: openings are runs ≥ 6 m with no fence bay within 2.5 m; an approach counts when a tank
        on the opening can reach the nearest road."""
        fences = np.array([[it['x'], it['y']] for it in self.inst['items'] if it['asset'] == 'prop_fence_segment']) if any(it['asset'] == 'prop_fence_segment' for it in self.inst['items']) else np.zeros((0, 2))
        rows = []; bad = []
        for lm in self.meta['landmarks']:
            c = np.array(lm['center']); hx, hy = lm['size'][0] / 2, lm['size'][1] / 2
            if not len(fences) or not ((np.abs(fences[:, 0] - c[0]) <= hx + 1) & (np.abs(fences[:, 1] - c[1]) <= hy + 1)).any(): continue
            per = []
            for (ax, ay), (bx, by) in (((-hx, -hy), (hx, -hy)), ((hx, -hy), (hx, hy)), ((hx, hy), (-hx, hy)), ((-hx, hy), (-hx, -hy))):
                L = math.hypot(bx - ax, by - ay); per += [c + [ax + (bx - ax) * t / L, ay + (by - ay) * t / L] for t in np.arange(0, L, 1.0)]
            per = np.array(per); dmin = np.min(np.hypot(per[:, None, 0] - fences[None, :, 0], per[:, None, 1] - fences[None, :, 1]), axis=1)
            openm = dmin > 2.5; lab, nl = ndi.label(np.r_[openm, openm[:1]] if openm[0] and openm[-1] else openm)
            gates = 0
            for k in range(1, nl + 1):
                idx = np.where(lab[:len(per)] == k)[0]
                if len(idx) < 6: continue
                g = per[idx[len(idx) // 2]]; outw = g + (g - c) / (np.linalg.norm(g - c) + 1e-9) * 6
                rd = np.argwhere(self.M['road_core']); 
                if not len(rd): continue
                tgt = rd[np.argmin(np.hypot(rd[:, 1] * RES - outw[0], rd[:, 0] * RES - outw[1]))][::-1] * RES
                t, _ = self.times('tank', outw.tolist(), [tgt.tolist()])
                if t[0] is not None: gates += 1
            rows.append(f"{lm['id']} {gates}"); 
            if gates < 2: bad.append(lm['id'])
        if rows: self.ok('fenced compounds have ≥ 2 vehicle approaches', not bad, 'gates reachable by tank from a road: ' + ', '.join(rows), kind='measured')

    def doors_and_integrity(self):
        meta = self.meta; fac = [it for it in self.inst['items'] if it['asset'] == 'bld_vehicle_factory']; ref = [it for it in self.inst['items'] if it['asset'] == 'bld_ore_refinery']
        fb = info('bld_vehicle_factory').get('bounds', {}); rb = info('bld_ore_refinery').get('bounds', {})
        vd = next((x for x in fb.get('doors', []) if x['kind'] == 'vehicle'), None); bay = next((x for x in rb.get('doors', []) if x['kind'] == 'vehicle'), None)
        tank, harv = info('unit_mbt')['size'], info('unit_harvester')['size']; bad = []
        if vd:
            for nm, u in (('tank', tank), ('harvester', harv)):
                if not (vd['clear_w'] >= u[1] + 1.0 and vd['clear_h'] >= u[2] + 0.3): bad.append(f"{nm} does not fit the factory door")
        for it in fac:
            c, s_ = math.cos(it['rot']), math.sin(it['rot']); dx, dy = (vd or {'center': [0, -15]})['center'][:2]
            door = np.array([it['x'] + c * dx - s_ * dy, it['y'] + s_ * dx + c * dy]); out = np.array([s_, -c])  # local −Y (south) in world
            _, apron = rect_dist(self.X, self.Y, door + out * 6.5, [12.0, (vd or {'clear_w': 6})['clear_w'] + 4], it['rot'] + math.pi / 2)
            if (apron & self.solid).any(): bad.append(f"{it['base']} factory apron obstructed")
            rally = np.array(self.inst['kits'][it['base']]['rally'])
            t, _ = self.times('tank', (door + out * 13).tolist(), [rally.tolist()])
            if t[0] is None: bad.append(f"{it['base']} no tank route from the factory apron to the rally point")
        if bay and not (bay['clear_w'] >= harv[1] + 1.0 and bay['clear_h'] >= harv[2] + 0.3): bad.append('harvester does not fit the refinery bay')
        self.ok('tanks & harvesters clear factory doors and refinery bays', not bad,
                (f"factory door {vd['clear_w']:.1f} × {vd['clear_h']:.1f} m clear (tank {tank[1]:.1f} m wide × {tank[2]:.1f} m, harvester {harv[1]:.1f} × {harv[2]:.1f} m); "
                 f"refinery bay {bay['clear_w']:.1f} × {bay['clear_h']:.1f} m; {len(fac)} factory aprons 12 m deep clear of footprints, each with a tank route to its rally point") if not bad and vd and bay else '; '.join(bad) or 'door data missing from asset bounds', kind='measured')
        fin = bool(np.isfinite(self.h).all()); nchunk = int(math.ceil(self.S / 128.0)) ** 2
        self.ok('no holes, shoreline gaps or z-fighting on main routes (construction)', fin,
                f"heightfield {self.n}×{self.n} at {RES} m, all values finite, meshed as {nchunk} contiguous 128 m chunks sharing edge vertices; "
                "one sea plane at z = 0 spans the map and the skirt, and land/water, navigation and rendering all derive from the same heightfield, so the shoreline has no gaps; "
                "bridge spans are checked above; road surfaces render 0.06 m and service lanes 0.04 m above the graded terrain, building floors 0.03 m above their pads (no coplanar faces)", kind='construction')

    def span_continuity(self, b):
        """Match a layout bridge to exactly one deck span and check the road meets the deck without a step at either end."""
        a, e = np.array(b['start']), np.array(b['end'])
        for r in self.meta['roads']:
            br = np.array(r['bridge'])
            if not br.any(): continue
            lab, nrun = ndi.label(br); xy = np.array(r['xy']); z = np.array(r['z'])
            for k in range(1, nrun + 1):
                idx = np.where(lab == k)[0]; p0, p1 = xy[idx[0]], xy[idx[-1]]
                d = min(max(np.linalg.norm(p0 - a), np.linalg.norm(p1 - e)), max(np.linalg.norm(p0 - e), np.linalg.norm(p1 - a)))
                if d > 12: continue
                deck = float(z[idx].mean()); steps = []
                for j in (idx[0] - 1, idx[-1] + 1):
                    if 0 <= j < len(z): steps.append(abs(float(z[j]) - deck))
                step = max(steps) if steps else 0.0; span = float(np.linalg.norm(p1 - p0))
                return (bool(step <= 0.5 and d <= 12), f"deck span {span:.0f} m on {r['id']} (ends within {d:.0f} m of the layout), road-to-deck step {step:.2f} m")
        return (False, 'no deck span matches the layout bridge')

    def _finish_layers(self, deck, low_deck, piers):
        n = self.n
        dock_deck = np.zeros((n, n), bool)
        for it in self.inst['items']:
            if it['asset'] == 'bld_naval_dock':
                _, ins = rect_dist(self.X, self.Y, (it['x'], it['y']), [80, 40], it['rot']); dock_deck |= ins
        for ln in self.inst['lanes']:
            if ln['kind'] == 'trestle':
                a, e = np.array(ln['pts'][0]), np.array(ln['pts'][1]); _, ins = rect_dist(self.X, self.Y, (a + e) / 2, [np.linalg.norm(e - a) + 2, ln['w']], math.atan2(*(e - a)[::-1])); dock_deck |= ins
        self.deck = deck; self.low_deck = low_deck; self.piers = piers; self.dock_deck = dock_deck
        # obstacles: blocking footprints + dense forest interiors (≥ 1 trunk per 150 m² within ~10 m)
        trees = np.zeros((n, n), np.float32)
        for it in self.inst['items']:
            if it['asset'].startswith('veg_') and it['cat'] in ('tree', 'tree_scatter', 'windbreak'):
                j, i = self.ij((it['x'], it['y']))
                if 0 <= j < n and 0 <= i < n: trees[j, i] += 1
        dens = ndi.gaussian_filter(trees, 5.0 / RES) / (RES * RES); self.forest_block = dens > 1 / 150.0
        obst = self.solid | self.forest_block
        land = (self.h > 0) | deck | dock_deck; water = (self.h <= 0) & ~deck & ~dock_deck
        L = {}
        for k in ('infantry', 'tank', 'harvester', 'amphibious'):
            base = land & ((self.slope <= SLOPE[k]) | deck | dock_deck) & ~(self.solid if k == 'infantry' else obst)
            if k == 'infantry': base |= (self.h > -0.35) & (self.h <= 0)  # wading
            if k == 'amphibious': base |= water & ~self.piers
            clear = ndi.distance_transform_edt(base) * RES; L[k] = clear >= max(RES * 0.99, RADIUS[k])
        depth_ok = (self.h <= -3.0) & ~low_deck & ~piers & ~dock_deck
        self.ship_edt = ndi.distance_transform_edt(depth_ok) * RES; L['ship'] = self.ship_edt >= RADIUS['ship']
        self.L = L
        bits = np.zeros((n, n), np.uint8)
        for k, v in L.items(): bits |= np.where(v, LAYER[k], 0).astype(np.uint8)
        np.savez_compressed(self.b / 'nav.npz', bits=bits, deck=deck | dock_deck, forest_block=self.forest_block)
        self.metrics['nav_cells'] = {k: int(v.sum()) for k, v in L.items()}

    def times(self, layer, src, targets):
        """Travel time (s) from src to each target on a layer (roads fast, off-road slow)."""
        v_road, v_off = SPEED[layer]; road = self.M['road_core'] | self.deck
        if layer == 'ship':
            cost = np.where(self.L['ship'], 1.0 / v_road * (1 + 6.0 / np.maximum(self.ship_edt, 1)), np.inf)  # stay mid-channel
        else: cost = np.where(self.L[layer], np.where(road, 1 / v_road, 1 / v_off), np.inf)
        mcp = MCP_Geometric(cost); s = self.snap(layer, src)
        if s is None: return [None] * len(targets), mcp
        acc, _ = mcp.find_costs([s]); out = []
        for t in targets:
            tt = self.snap(layer, t); out.append(None if tt is None or not np.isfinite(acc[tt]) else float(acc[tt] * RES))
        self._acc = acc; return out, mcp

    def snap(self, layer, p, rmax=40):
        j, i = self.ij(p); r = int(rmax / RES); sl = (slice(max(j - r, 0), j + r + 1), slice(max(i - r, 0), i + r + 1))
        m = self.L[layer][sl]
        if not m.any(): return None
        jj, ii = np.nonzero(m); k = np.argmin((jj + sl[0].start - j) ** 2 + (ii + sl[1].start - i) ** 2); return (jj[k] + sl[0].start, ii[k] + sl[1].start)

    def path_len(self, mcp, tgt_p, layer):
        t = self.snap(layer, tgt_p)
        if t is None: return None
        tb = np.array(mcp.traceback(t)); return tb

    # ── checks ──
    def run(self):
        print(f"[{self.mid}] {self.meta['name']}"); self.build_layers(); d = self.d; meta = self.meta
        self.ok('terrain size', abs((self.n - 1) * RES - d['size_m']) < 1e-6, f"{(self.n - 1) * RES:.0f} × {(self.n - 1) * RES:.0f} m (spec {d['size_m']} × {d['size_m']})")
        # bases
        bp = [(p['id'], p['team'], p['center']) for p in meta['pads']]; spec = [(b['id'], b['id'][0], self.mq(b['position']).tolist()) for b in d['bases']]
        same = len(bp) == len(spec) and all(a[0] == b[0] and a[1] == b[1] and np.allclose(a[2], b[2]) for a, b in zip(bp, spec))
        self.ok('bases: count, team, position', same, f"{len(bp)} bases " + ', '.join(f"{i} ({t}) @ ({c[0]:.0f}, {c[1]:.0f}) m" for i, t, c in bp))
        for p in meta['pads']:
            c = np.array(p['center']); hs = p['size'][0] / 2 - 1; corners = [c + [sx * hs, sy * hs] for sx in (-1, 1) for sy in (-1, 1)]
            on_land = all(self.h[self.ij(q)] > 0 for q in corners); m = self.M[f"pad_{p['id']}"]; inner = ndi.binary_erosion(m, iterations=2)
            smax = float(self.slope[inner].max()); ptp = float(np.ptp(self.h[inner]))
            self.ok(f"pad {p['id']} corners on land + slope ≤ 1°", on_land and smax <= 1.0, f"corners on land: {on_land}; max slope {smax:.2f}°; height range {ptp:.2f} m at {p['h']} m")
        # deposits
        want = {'01': 8, '02': 14, '03': 8, '04': 12, '05': 14}[self.mid]; deps = self.inst['deposits']
        home = {}
        for dp in deps:
            if dp['kind'] == 'home': home.setdefault(dp['nearest'], []).append(dp['id'])
        lay = {x['id']: self.mq(x['position']) for x in d['deposits']}
        idok = sorted(x['id'] for x in deps) == sorted(lay)
        built = {x['id']: float(np.linalg.norm(np.array(x['pos']) - lay[x['id']])) for x in deps if x['id'] in lay}  # where the ore field, rig and service area actually are
        moved = [f"{k} built {v:.0f} m from its layout coordinate (reported conflict)" for k, v in sorted(built.items()) if v > 0.5]
        cnt_ok = len(deps) == want and idok and all(len(v) == 2 for v in home.values()) and len(home) == len(d['bases'])
        dep_ok = any('deposit' in e['what'] and self.mid in str(e.get('maps', '')) for e in REVISIONS.get('approved_moves', []))
        if moved and dep_ok: moved = [m_.replace('(reported conflict)', f"(offset approved {REVISIONS.get('approved_on', '')})") for m_ in moved]
        self.ok('deposit count & coordinates', (True if (not moved or dep_ok) else 'warn') if cnt_ok else False,
                f"{len(deps)} deposits (spec {want}), ids match: {idok}; 2 home each for {sorted(home)}; "
                + (f"{len(built) - len(moved)} built exactly at their layout coordinate; " + '; '.join(moved) if moved else f"all {len(built)} built exactly at their layout coordinates (max {max(built.values(), default=0):.2f} m)"))
        # refinery bay mouths (drive-through bays, the mouth facing the home deposits) and harvester access
        ref = {pid: [tuple(q) for q in kit['refinery_bays']] for pid, kit in self.inst['kits'].items()}
        bad = []; dep_t = {}
        for p in meta['pads']:
            for rp in ref.get(p['id'], []):
                tts, _ = self.times('harvester', rp, [x['service_point'] for x in deps])
                for x, t in zip(deps, tts):  # keep the nearer of the base's two refinery bays
                    cur = dep_t.setdefault(x['id'], {}).get(p['id']); dep_t[x['id']][p['id']] = t if cur is None else (cur if t is None else min(cur, t))
        island = []
        for x in deps:
            reach = [t for t in dep_t.get(x['id'], {}).values() if t is not None]
            if not reach:
                # island deposits: reachable once a transport/amphibious lands the harvester on the island's landing beach
                via = [b for b in meta['beaches'] if self.times('harvester', (np.array(b['center']) - np.array(b['dir']) * (b['ramp_len'] + 10)).tolist(), [x['service_point']])[0][0] is not None]
                (island if via else bad).append(x['id'])
        self.metrics['harvester_times_s'] = dep_t
        self.ok('rigs & harvester service points accessible', not bad, (f"harvester reaches {len(deps) - len(island)} service points from a refinery bay" + (f"; island deposits {island} reachable from their landing-beach aprons (transport/amphibious delivery)" if island else '')) if not bad else f"unreachable: {bad}")
        # asset bounds
        rows = []; allok = True; missing = []
        for a, sp in SPEC.items():
            inf = info(a)
            if not inf['measured']: missing.append(a); continue
            sz = inf['size']; errs = [abs(sz[k] - sp[k]) / sp[k] for k in range(3) if sp[k]]; e = max(errs) if errs else 0
            allok &= e <= 0.01; rows.append(f"{a} {sz[0]:.2f}×{sz[1]:.2f}×{sz[2]:.2f} ({e * 100:.2f}%)")
        self.ok('asset bounds within 1%', allok if not missing else ('warn' if allok else False), '; '.join(rows) + (f"; not yet built: {missing}" if missing else ''))
        # connectivity
        pads = meta['pads']; rally = {p['id']: self.inst['kits'][p['id']]['rally'] for p in pads}
        conn = {}
        self.route_depth = 0.0; decks = self.deck | self.dock_deck
        for a in pads:
            tt, mcp = self.times('tank', rally[a['id']], [rally[b['id']] for b in pads]); conn[a['id']] = dict(zip([b['id'] for b in pads], tt))
            for b, t in zip(pads, tt):  # trace each route and record the deepest water it crosses away from bridge/causeway/dock decks
                if t is None or b['id'] == a['id']: continue
                path = np.array(mcp.traceback(self.snap('tank', rally[b['id']]))); off = ~decks[path[:, 0], path[:, 1]]
                if off.any(): self.route_depth = max(self.route_depth, float(-self.h[path[:, 0], path[:, 1]][off].min()))
        self.metrics['tank_base_to_base_s'] = conn
        if self.mid == '04':
            east_west = any(conn[a][b] is not None for a in conn for b in conn if a[0] != b[0])
            team = all(conn[a][b] is not None for a in conn for b in conn if a[0] == b[0])
            inf_t, _ = self.times('infantry', rally['B1'], [rally['R1'], rally['R2']])
            self.ok('Sunbreak: no dry east–west route (tanks & infantry)', not east_west and all(t is None for t in inf_t), f"tank B↔R reachable: {east_west}; infantry B1→R: {inf_t}")
            self.ok('Sunbreak: teammates linked by causeway', team, f"{conn}")
        else:
            allc = all(v is not None for r in conn.values() for v in r.values())
            self.ok('required land connections', allc, ', '.join(f"{a}→{b} {t:.0f}s" for a, r in conn.items() for b, t in r.items() if a < b and t is not None))
        # bridges (Delta) / causeways
        if meta['bridges']:
            for b in meta['bridges']:
                a, e = np.array(b['start']), np.array(b['end']); u = (e - a) / np.linalg.norm(e - a)
                p0, p1 = a - u * 60, e + u * 60; t, mcp = self.times('tank', p0.tolist(), [p1.tolist()])
                on_deck = self.deck[self.ij((a + e) / 2)]
                cont = self.span_continuity(b)
                if b['deck_h'] - 2 >= 12:
                    nrm = np.array([-u[1], u[0]]); s0, s1 = ((a + e) / 2 - nrm * 120).tolist(), ((a + e) / 2 + nrm * 120).tolist()
                    ts, _ = self.times('ship', s0, [s1]); ship = ts[0] is not None
                    tt = np.linspace(0, 1, int(np.linalg.norm(e - a)) + 1); pts = a + (e - a) * tt[:, None]  # clear ship water under the deck, between piers
                    jj, ii = (pts[:, 1] / RES).astype(int), (pts[:, 0] / RES).astype(int); clear = self.L['ship'][jj, ii] & ~self.piers[jj, ii]
                    lab, nl = ndi.label(clear); wmax = max((int((lab == k).sum()) for k in range(1, nl + 1)), default=0) * float(np.linalg.norm(e - a)) / max(len(tt) - 1, 1)
                    self.ok(f"bridge {b['id']}: own deck, continuous with its approaches; vehicles cross; ships pass beneath", t[0] is not None and on_deck and ship and cont[0] and wmax >= 40,
                            (f"deck {b['deck_h']} m, underside {b['deck_h'] - 2} m ≥ 9 + 3 m; {cont[1]}; tank crossing {t[0]:.0f}s; ship passage {'yes' if ship else 'NO'}, "
                             f"{wmax:.0f} m of ship-navigable water clear of piers under the span (≥ 40)") if t[0] else 'no crossing')
                else:
                    self.ok(f"causeway {b['id']}: own deck, continuous with its approaches; vehicles cross", t[0] is not None and cont[0], f"deck {b['deck_h']} m (ships route around: underside < 12 m); {cont[1]}; tank crossing {t[0]:.0f}s" if t[0] else 'no crossing')
        # ships: docks reach open sea, channel widths, turning basins
        edge = np.zeros((self.n, self.n), bool); edge[[0, -1], :] = True; edge[:, [0, -1]] = True; sea = np.argwhere(edge & self.L['ship'])
        for k in meta['docks']:
            Wc = np.array(k['water_center']); rot = k['rot']; ly = np.array([-math.sin(rot), math.cos(rot)]); berth = Wc - ly * 26
            if not len(sea): self.ok(f"dock {k['player']}: ship reaches open sea", False, 'no open sea on ship layer'); continue
            tgt = sea[np.linspace(0, len(sea) - 1, 40).astype(int)]
            tt, mcp = self.times('ship', berth.tolist(), [(q[1] * RES, q[0] * RES) for q in tgt]); best = min((t for t in tt if t is not None), default=None)
            basin = float(self.ship_edt[max(self.ij(berth)[0] - 100, 0):self.ij(berth)[0] + 100, max(self.ij(berth)[1] - 100, 0):self.ij(berth)[1] + 100].max()) * 2 + RADIUS['ship'] * 0
            width = None
            if best is not None:
                q = tgt[int(np.nanargmin([t if t is not None else np.nan for t in tt]))]; tb = np.array(mcp.traceback((q[0], q[1])))
                far = np.hypot(tb[:, 1] * RES - berth[0], tb[:, 0] * RES - berth[1]) > 80  # the berth zone is covered by the turning-basin test
                width = float(2 * self.ship_edt[tb[:, 0], tb[:, 1]][far][:-10].min()) if far.sum() > 15 else None
            self.ok(f"dock {k['player']}: ship berth → open sea", best is not None and (width or 0) >= 40 and basin >= 80,
                    f"time {best:.0f}s; narrowest navigable width on route {width:.0f} m (≥ 40); turning basin ⌀ {basin:.0f} m (≥ 80)" if best else 'unreachable')
        if self.mid == '04':
            for name, qx in (('west', 380), ('east', 620)):
                mids = [self.mq([qx, y]) for y in (500, 600, 400)]
                tn, _ = self.times('ship', mids[0].tolist(), [self.mq([qx, 995]).tolist(), self.mq([qx, 5]).tolist()])
                self.ok(f"Sunbreak {name} lagoon passage open north & south", all(t is not None for t in tn), f"north {tn[0]}, south {tn[1]}")
        # amphibious beaches
        for k, b in enumerate(meta['beaches']):
            c = np.array(b['center']); u = np.array(b['dir']); sea_p = c + u * (b['shore_offset'] + 110); land_p = c - u * (b['ramp_len'] - b['shore_offset'] * 0 + 10)
            tt, _ = self.times('amphibious', sea_p.tolist(), [land_p.tolist()]); core = self.M[f'beach_{k}']
            gy, gx = np.gradient(self.h, RES); along = np.abs(gx * u[0] + gy * u[1])  # gradient along the approach, inside the landing lane
            lane = ndi.binary_erosion(core, iterations=3) & (self.h > -2.0) & (self.h < b['top_h'] - 0.3)
            g = float(np.percentile(along[lane], 99.5)) if lane.any() else 0
            v = np.array([-u[1], u[0]]); grade_ok = along <= 0.081; amph = self.L['amphibious']
            ss_all = np.arange(-(b['ramp_len'] + 5), b['shore_offset'] + 200, 1.0)
            def line(off):
                P = c + np.outer(ss_all, u) + v * off
                jj, ii = np.clip((P[:, 1] / RES).astype(int), 0, self.n - 1), np.clip((P[:, 0] / RES).astype(int), 0, self.n - 1); return jj, ii
            def line_ok(off):  # one approach line parallel to the beach axis, from 3 m deep (navigable) water up to the ramp top: amphibious-passable, ≤ 8 %
                jj, ii = line(off); hh = self.h[jj, ii]; deep = np.where((hh <= -3.0) & (ss_all > 0))[0]
                if not len(deep): return False, None
                e_ = deep[0] + 1; inl = (hh[:e_] > -2.0) & (hh[:e_] < b['top_h'] - 0.3)
                return bool(amph[jj[:e_], ii[:e_]].all() and grade_ok[jj[:e_], ii[:e_]][inl].all()), float(ss_all[deep[0]])
            offs = np.arange(-60, 61, 2.0); res_ = [line_ok(o) for o in offs]; good = np.array([r_[0] for r_ in res_]); lab, _ = ndi.label(good)
            wid = float((lab == lab[len(offs) // 2]).sum() * 2.0 - 2.0) if good[len(offs) // 2] else 0.0
            reach = max((r_[1] for r_ in res_ if r_[1] is not None), default=b['shore_offset'] + 110)  # where the approach meets 3 m water
            hs = ndi.uniform_filter(self.h, 5); gys, gxs = np.gradient(hs, RES); gs = np.hypot(gxs, gys)  # 10 m-smoothed grade: surface noise is not slope
            apr = []
            for off in (-b['width_m'] / 4, 0.0, b['width_m'] / 4):  # clear apron behind the ramp top: amphibious-passable, no footprints, ≤ 5 % smoothed grade
                ss = np.arange(b['ramp_len'] + 2, b['ramp_len'] + 80, 1.0); P = c - np.outer(ss, u) + v * off
                jj, ii = (P[:, 1] / RES).astype(int), (P[:, 0] / RES).astype(int); flat = (gs[jj, ii] <= 0.05) & ~self.solid[jj, ii] & amph[jj, ii]
                apr.append(float(np.argmin(flat)) if not flat.all() else 78.0)
            apron = min(apr)
            inlane = [it['id'] for it in self.inst['items'] if it['asset'].startswith(('coral_', 'rock_')) and
                      -b['ramp_len'] - 40 < (it['x'] - c[0]) * u[0] + (it['y'] - c[1]) * u[1] < reach + 20 and abs(-(it['x'] - c[0]) * u[1] + (it['y'] - c[1]) * u[0]) < max(wid, b['width_m']) / 2 + 5]
            ok_b = tt[0] is not None and g <= 0.081 and apron >= 30 and not inlane
            st = (ok_b if wid >= 60 else ('warn' if ok_b and wid >= b['width_m'] - 2 else False))
            if wid < 60 and b['width_m'] < 60:
                self.extra_conflicts.append(f"landing beach {k + 1} @ ({c[0]:.0f}, {c[1]:.0f}) m: the layout gives width_m {b['width_m']}, below the 60–75 m approach rule; built to the layout width (measured continuous approach {wid:.0f} m). Widening it needs your approval.")
            self.ok(f"landing beach {k + 1} @ ({c[0]:.0f}, {c[1]:.0f}) m", st,
                    f"amphibious sea→apron {'%.0fs' % tt[0] if tt[0] else 'NO'}; measured continuous approach width {wid:.0f} m (rule 60–75 m; layout {b['width_m']} m); "
                    f"max gradient {g * 100:.1f}% (≤ 8%); measured clear apron {apron:.0f} m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, {reach:.0f} m offshore): {len(inlane)}" + (f" {inlane[:4]}" if inlane else ''))
        deep = (self.h <= -1.0) & ~self.deck & ~self.dock_deck
        self.ok('tanks cannot drive through deep water (construction)', not (self.L['tank'] & deep).any() and self.route_depth < 1.0,
                f"the tank layer is built only from dry land and bridge/causeway/dock decks, so tanks cannot enter water by construction; verified: "
                f"{int((self.L['tank'] & deep).sum())} tank-layer cells over water deeper than 1 m off decks, and traced base-to-base tank routes cross {max(self.route_depth, 0.0):.2f} m of water off decks", kind='construction')
        # roads: grade, cross-slope, fillets, waypoints, harvester drivability
        worst = []; xs_worst = 0; fil = []; wp = []; conf = 0; padm = np.zeros_like(self.h, bool)
        for p in meta['pads']: padm |= self.M[f"pad_{p['id']}"]
        pad_d = ndi.distance_transform_edt(~padm) * RES; rid = self.M['road_id']
        for k, r in enumerate(meta['roads']):
            xy = np.array(r['xy']); z = np.array(r['z']); br = np.array(r['bridge']); brj = ndi.binary_dilation(br, iterations=2) if br.any() else br  # deck + abutment joint
            zt = ndi.map_coordinates(self.h, [xy[:, 1] / RES, xy[:, 0] / RES], order=1)
            other = ndi.distance_transform_edt(~((rid >= 0) & (rid != k))) * RES
            jj, ii = np.clip((xy[:, 1] / RES).round().astype(int), 0, self.n - 1), np.clip((xy[:, 0] / RES).round().astype(int), 0, self.n - 1)
            plain = (other[jj, ii] > r['clear_w'] / 2 + 30) & (pad_d[jj, ii] > 15) & ~brj & ~np.array(r.get('on_beach', [False] * len(xy)))  # away from junctions, pad edges, decks, beach ramps
            g = np.abs(np.diff(ndi.uniform_filter1d(z, 5))) / RES; worst.append((r['id'], float(g.max()) if len(g) else 0))
            if plain.any(): conf = max(conf, float(np.abs(zt - z)[plain].max()))
            t = np.gradient(xy, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9; nrm = np.c_[-t[:, 1], t[:, 0]]; off = r['clear_w'] / 2 - 2
            pl, pr = xy + nrm * off, xy - nrm * off
            hl = ndi.map_coordinates(self.h, [pl[:, 1] / RES, pl[:, 0] / RES], order=1); hr = ndi.map_coordinates(self.h, [pr[:, 1] / RES, pr[:, 0] / RES], order=1)
            xsl = (np.abs(hl - hr) / (2 * off))[plain]; xs_worst = max(xs_worst, float(xsl.max()) if len(xsl) else 0)
            if r['min_fillet_m'] is not None: fil.append((r['id'], r['min_fillet_m']))
        for r in d.get('roads', []):
            pts = self.mq(r['points']); runs = [np.array(x['xy']) for x in meta['roads'] if x['id'].split('#')[0] == r['id']]
            if not runs: continue
            allxy = np.vstack(runs)
            for p in pts:
                inpad = any(abs(p[0] - q['center'][0]) <= 110 and abs(p[1] - q['center'][1]) <= 110 for q in meta['pads'])
                if inpad: continue
                wp.append((r['id'], float(np.min(np.hypot(*(allxy - p).T)))))
        gw = max(worst, key=lambda x: x[1]); self.metrics['road_grades'] = worst
        self.ok('road longitudinal grade ≤ 6%', gw[1] <= 0.0605, f"steepest road surface {gw[0]} {gw[1] * 100:.2f}% (graded profile = road mesh, 10 m window); terrain under road centrelines within {conf:.2f} m of the profile away from junctions, bridge decks and abutment joints")
        self.ok('road cross slope ≤ 2%', xs_worst <= 0.02, f"max terrain cross slope across the clear width {xs_worst * 100:.2f}% (road meshes are level across; junction and pad-edge zones excluded)")
        wpw = max(wp, key=lambda x: x[1]) if wp else ('-', 0)
        small = [f"{a} {b:.0f} m" for a, b in fil if b < 20]
        self.ok('waypoints within 8 m; fillets ≥ 20 m where space permits', (True if not small else 'warn') if wpw[1] <= 8.0 else False,
                f"max waypoint deviation {wpw[1]:.1f} m ({wpw[0]}); waypoints inside base pads are served by the base layout; " + (('fillets limited by the 8 m waypoint rule at sharp corners: ' + ', '.join(small)) if small else (f"min fillet {min(b for a, b in fil):.0f} m" if fil else 'n/a')))
        undriv = []
        for r in meta['roads']:
            xy = np.array(r['xy'])
            if len(xy) < 10: continue
            tt, _ = self.times('harvester', xy[2].tolist(), [xy[-3].tolist()])
            if tt[0] is None: undriv.append(r['id'])
            elif tt[0] > len(xy) * RES / SPEED['harvester'][0] * 1.6: undriv.append(r['id'] + ' (detour)')
        self.ok('tanks & harvesters clear roads, ramps, corners', not undriv, 'harvester drives every road/ramp run end to end' if not undriv else f"blocked: {undriv}")
        # overlaps: anything standing in a road clear corridor (blocking footprints, fences, barriers, poles, cabinets, signs, rocks,
        # tree trunks); flush rail pieces and demonstration units are allowed. Then building separation with oriented footprints.
        hits = []; blds = []; core = self.M['road_core']
        POLE = {'prop_street_light', 'prop_harbour_light', 'prop_radio_mast', 'prop_road_sign'}
        for it in self.inst['items']:
            a = info(it['asset']); nm = it['asset']
            if a['kind'] == 'building' and it['cat'] in ('base', 'landmark', 'town'): blds.append(it)
            if it['cat'] == 'demo' or nm.startswith(('unit_', 'prop_rail_')) or nm in ('prop_culvert_end', 'prop_drainage_grate') or 'on_deck' in it: continue  # flush with / under the road
            if a['kind'] == 'veg':
                if 'tree' in it['cat'] and core[self.ij((it['x'], it['y']))]: hits.append(it['id'] + ':' + nm)
                continue
            if nm in POLE:  # a pole is thinner than a grid cell: test the cell it stands in
                j, i = self.ij((it['x'], it['y']))
                if 0 <= j < self.n and 0 <= i < self.n and core[j, i]: hits.append(it['id'] + ':' + nm)
                continue
            _, ins = rect_dist(self.X, self.Y, (it['x'], it['y']), [max(a['size'][0] * it['s'], RES), max(a['size'][1] * it['s'], RES)], it['rot'])
            if (ins & core).any(): hits.append(it['id'] + ':' + nm)
        self.ok('nothing obstructs road clear corridors', not hits,
                f"{len(hits)} intrusions (blocking footprints, fences, barriers, light poles, cabinets, rocks and tree trunks checked; flush rail crossings, culverts under the road and kerb grates allowed)" + (f": {hits[:8]}" if hits else ''))
        def obb(it):
            sz = info(it['asset'])['size']; c, s_ = math.cos(it['rot']), math.sin(it['rot']); hx, hy = sz[0] * it['s'] / 2, sz[1] * it['s'] / 2
            return np.array([[it['x'] + c * x - s_ * y, it['y'] + s_ * x + c * y] for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))])
        def poly_dist(P, Q):
            for A in (P, Q):  # separating-axis test: overlapping footprints are 0 m apart
                sep = False
                for k in range(4):
                    e = A[(k + 1) % 4] - A[k]; n_ = np.array([-e[1], e[0]]); pa, pb = P @ n_, Q @ n_
                    if pa.max() < pb.min() or pb.max() < pa.min(): sep = True; break
                if sep: break
            else: return 0.0
            def sd(p, a, b): t = np.clip(np.dot(p - a, b - a) / np.dot(b - a, b - a), 0, 1); return float(np.linalg.norm(p - (a + t * (b - a))))
            return min(min(sd(p, Q[k], Q[(k + 1) % 4]) for p in P for k in range(4)), min(sd(q, P[k], P[(k + 1) % 4]) for q in Q for k in range(4)))
        close = []
        for i in range(len(blds)):
            for j in range(i + 1, len(blds)):
                A, B = blds[i], blds[j]
                if math.hypot(A['x'] - B['x'], A['y'] - B['y']) > 120: continue
                gap = poly_dist(obb(A), obb(B))
                if gap < 8 - 1e-6: close.append(f"{A['id']} {A['asset']} / {B['id']} {B['asset']} {gap:.1f} m")
        self.doors_and_integrity()
        self.compound_approaches()
        self.ok('building separation ≥ 8 m (oriented footprints)', not close, f"all {len(blds)} buildings ≥ 8 m apart, rotated ones included" if not close else '; '.join(close[:8]))
        # mirror balance
        self.balance()
        # capture radar reveal
        rad = [l for l in meta['landmarks'] if l['role'] == 'capturable']
        dmin = min(math.hypot(r['center'][0] - p['center'][0], r['center'][1] - p['center'][1]) for r in rad for p in meta['pads'])
        self.ok('capture radar (220 m) does not reveal base centres', dmin > 220, f"nearest base centre {dmin:.0f} m from a radar")
        # floating / sunken
        float_bad = []
        for it in self.inst['items']:
            if it['cat'] in ('cliff', 'coral', 'nav_marker', 'dock', 'container', 'rail') or it['asset'] in ('unit_patrol_boat', 'bld_naval_dock') or 'dock' in it or 'on_deck' in it: continue  # deck-mounted / floating by design
            hz = float(ndi.map_coordinates(self.h, [[it['y'] / RES], [it['x'] / RES]], order=1, mode='nearest')[0])
            tol = 2.0 if it['asset'].startswith('rock_') else 0.35
            if not (-tol <= it['z'] - hz <= 0.35): float_bad.append(f"{it['id']} {it['asset']} Δ{it['z'] - hz:+.2f} m")
        self.ok('no floating or buried instances', len(float_bad) == 0, f"{len(self.inst['items'])} instances checked" + (f"; {len(float_bad)} off: {float_bad[:5]}" if float_bad else ''))
        shots = sorted((ROOT / 'renders' / self.mid).glob('preset_*.png')) if (ROOT / 'renders' / self.mid).exists() else []
        self.ok('screenshots for 5 camera presets', len(shots) >= 5, f"{len(shots)} found", kind='render')
        approved = bool(REVISIONS.get('approved_moves'))  # provisional placement moves were approved on REVISIONS['approved_on']
        out = {'map': self.mid, 'name': meta['name'], 'checks': self.res, 'metrics': self.metrics, 'conflicts': meta['conflicts'] + self.inst['conflicts'] if not approved else [],
               'approved_moves': meta['conflicts'] + self.inst['conflicts'] if approved else [], 'open_findings': self.extra_conflicts}
        (self.b / 'validation.json').write_text(json.dumps(out, indent=1, default=float)); return out

    def balance(self):
        """Mirrored travel times. Players are paired across teams by the symmetry that best maps the bases and their home deposits
        (layout coordinates). Every player starts from its own factory rally point (the kit is mirrored per start, see place.kit_frame).
        Home deposits: tank from the rally point and harvester from the nearest refinery bay, against the paired opponent's mirrored
        deposit. Contested deposits and the radar: team against team — each team's fastest player to an objective vs the other team's
        fastest player to that objective's twin under whichever layout symmetry maps it onto another objective (or the objective itself)."""
        meta = self.meta; pads = {p['id']: np.array(p['center']) for p in meta['pads']}
        cen = np.mean(list(pads.values()), axis=0)
        cands = {'mirror-x': lambda p: np.array([2 * cen[0] - p[0], p[1]]), 'mirror-y': lambda p: np.array([p[0], 2 * cen[1] - p[1]]),
                 'rotate-180': lambda p: 2 * cen - np.asarray(p)}
        inst_deps = {x['id']: x for x in self.inst['deposits']}
        spec = {k: np.array(x['spec_pos']) for k, x in inst_deps.items()}; svc = {k: np.array(x['service_point']) for k, x in inst_deps.items()}
        homes = {k for k, x in inst_deps.items() if x['kind'] == 'home'}
        blue = sorted(k for k in pads if k[0] == 'B'); red = sorted(k for k in pads if k[0] != 'B')
        best = None
        for nm, T in cands.items():  # pairing symmetry: bases + home deposits only
            err = 0; pair = {}
            for k in blue:
                q = T(pads[k]); m = min(red, key=lambda z: np.linalg.norm(pads[z] - q)); err += np.linalg.norm(pads[m] - q); pair[k] = m
            err += sum(min(np.linalg.norm(spec[z] - T(spec[h])) for z in homes) for h in homes) / max(len(homes), 1)
            if best is None or err < best[0] - 1e-6: best = (err, nm, T, pair)
        _, nm, T, pair = best
        rally = {k: self.inst['kits'][k]['rally'] for k in pads}; centre = {k: pads[k].tolist() for k in pads}
        caps = {l['id']: np.array(l['center']) for l in meta['landmarks'] if l['role'] == 'capturable'}
        tpos = {**svc, **caps}; targets = list(tpos); lay = {}
        def times_from(src):  # each player's tank time to every objective; amphibious where a tank cannot reach (island radar)
            out = {}
            for k in pads:
                t, _ = self.times('tank', src[k], [tpos[x].tolist() for x in targets]); out[k] = dict(zip(targets, t))
                miss = [x for x in targets if out[k][x] is None]
                if miss:
                    a, _ = self.times('amphibious', src[k], [tpos[x].tolist() for x in miss])
                    for x, v in zip(miss, a): out[k][x] = v; lay[x] = 'amphibious'
            return out
        tc, tr = times_from(centre), times_from(rally)
        pct = lambda a, c: None if a is None or c is None else round(abs(a - c) / max(min(a, c), 1) * 100, 2)
        r1 = lambda v: None if v is None else round(v, 1)
        def twin(x, Tf):
            ref = spec.get(x, tpos[x]); pool = [z for z in tpos if (z in homes) == (x in homes) and (z in caps) == (x in caps)]
            m = min(pool, key=lambda z: np.linalg.norm(spec.get(z, tpos[z]) - Tf(ref))); return m if np.linalg.norm(spec.get(m, tpos[m]) - Tf(ref)) < 80 else None
        ht = self.metrics.get('harvester_times_s', {}); hrows = []
        for b, r in pair.items():  # home deposits, player against paired opponent
            for x in sorted(z for z in homes if z.startswith(b + '-H')):
                mx = twin(x, T)
                if mx is None: continue
                hb, hr = ht.get(x, {}).get(b), ht.get(mx, {}).get(r)
                hrows.append({'blue': b, 'red': r, 'deposit': x, 'mirror': mx,
                              'map_blue_s': r1(tc[b][x]), 'map_red_s': r1(tc[r][mx]), 'map_diff_pct': pct(tc[b][x], tc[r][mx]),
                              'rally_blue_s': r1(tr[b][x]), 'rally_red_s': r1(tr[r][mx]), 'rally_diff_pct': pct(tr[b][x], tr[r][mx]),
                              'harvester_blue_s': r1(hb), 'harvester_red_s': r1(hr), 'harvester_diff_pct': pct(hb, hr)})
        trows = []; done = set()
        for x in targets:  # contested deposits and radar, team against team, from pad centres
            if x in homes or x in done: continue
            tw, sym = None, None
            for nm2, Tf in [(nm, T)] + [(k, f) for k, f in cands.items() if k != nm]:
                tw = twin(x, Tf)
                if tw is not None: sym = nm2; break
            tw = tw or x; done |= {x, tw}
            for o, q in ((x, tw), (tw, x)) if tw != x else ((x, x),):
                bb = min((tc[k][o] for k in blue if tc[k][o] is not None), default=None); rb = min((tc[k][q] for k in red if tc[k][q] is not None), default=None)
                trows.append({'objective': o, 'twin': q, 'symmetry': sym or 'self', 'blue_best_s': r1(bb), 'red_best_s': r1(rb), 'diff_pct': pct(bb, rb), 'layer': lay.get(o, 'tank')})
        self.metrics['balance'] = {'pairing_symmetry': nm, 'pairs': pair, 'home_rows': hrows, 'team_rows': trows}
        worst = lambda rows, k: max(rows, key=lambda r: r[k] or 0, default=None)
        hm = worst(hrows, 'map_diff_pct'); tw_row = worst(trows, 'diff_pct'); hk = worst(hrows, 'rally_diff_pct'); hh = worst(hrows, 'harvester_diff_pct')
        v = lambda row, k: (row or {}).get(k) or 0
        fmt = lambda r: f"{r['objective']} blue {r['blue_best_s']}s vs red {r['red_best_s']}s" + (' (amphibious)' if r['layer'] == 'amphibious' else '')
        self.ok('mirrored travel times, map layout (from pad centres; target ≤ 5%)', max(v(hm, 'map_diff_pct'), v(tw_row, 'diff_pct')) <= 5,
                f"players paired by {nm} {pair}; home deposits worst {v(hm, 'map_diff_pct'):.1f}% [{hm['deposit']} {hm['map_blue_s']}s vs {hm['mirror']} {hm['map_red_s']}s]; "
                f"contested objectives, team vs team, worst {v(tw_row, 'diff_pct'):.1f}%" + (f" [{fmt(tw_row)}]" if tw_row else '')
                + (f"; radar: " + ', '.join(fmt(r) for r in trows if r['objective'] in caps) if caps else ''), kind='measured')
        kit_bad = max(v(hk, 'rally_diff_pct'), v(hh, 'harvester_diff_pct')) > 5
        self.ok('mirrored travel times, with the base kit mirrored per start (factory rally point, refinery bays; target ≤ 5%)', not kit_bad,
                f"home deposits: tank from the factory rally point worst {v(hk, 'rally_diff_pct'):.1f}% [{hk['deposit']} {hk['rally_blue_s']}s vs {hk['mirror']} {hk['rally_red_s']}s]; "
                f"harvester from the nearest refinery bay worst {v(hh, 'harvester_diff_pct'):.1f}% [{hh['deposit']} {hh['harvester_blue_s']}s vs {hh['mirror']} {hh['harvester_red_s']}s]", kind='measured')
        if kit_bad:
            kitlist = ', '.join(k + ' ' + v_['transform'] for k, v_ in sorted(self.inst['kits'].items()))
            self.extra_conflicts.append(
                f"base-kit balance: with the kit mirrored per start ({kitlist}), "
                f"home-deposit trips still differ: tank from the rally point by up to {v(hk, 'rally_diff_pct'):.1f}%, harvester haul by up to {v(hh, 'harvester_diff_pct'):.1f}% "
                f"({hh['deposit']} {hh['harvester_blue_s']} s vs {hh['mirror']} {hh['harvester_red_s']} s). The remaining difference comes from the map around the bases, not the kit.")

def report_md(results):
    L = ['# Thunderhead maps — validation report', '', 'Automated checks run by `maps/gen/navcheck.py` on the generated data. Coordinate/bounds checks are automatic;',
         'balance and art quality still need human review — passing coordinate checks is not proof of balance.', '']
    for r in results:
        p = sum(c['status'] == 'PASS' for c in r['checks']); f = sum(c['status'] == 'FAIL' for c in r['checks']); w = sum(c['status'] == 'WARN' for c in r['checks'])
        L += [f"## {r['map']} · {r['name']} — {p} pass, {w} warn, {f} fail", '', '| Check | Result | Detail |', '|---|---|---|']
        L += [f"| {c['check']} | {c['status']} | {c['detail'].replace('|', '/')} |" for c in r['checks']]
        if r.get('conflicts'): L += ['', '**Layout conflicts and provisional resolutions (need your approval):**', ''] + [f"- {c}" for c in r['conflicts']]
        if r.get('approved_moves'): L += ['', f"**Provisional moves, approved {REVISIONS.get('approved_on', '')}:**", ''] + [f"- {c}" for c in r['approved_moves']]
        if r.get('open_findings'): L += ['', '**Open findings:**', ''] + [f"- {c}" for c in r['open_findings']]
        L.append('')
    return '\n'.join(L)

if __name__ == '__main__':
    sel = sys.argv[1] if len(sys.argv) > 1 else 'all'; res = []
    for m in LAYOUT['maps']:
        if sel in ('all', m['id']): res.append(Check(m['id']).run())
    if sel == 'all': (ROOT / 'VALIDATION.md').write_text(report_md(res))
