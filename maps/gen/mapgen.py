"""Thunderhead metric map generator — logical terrain for the five authored maps.

Deterministic: the same layout + seed reproduces the same arrays. All horizontal layout values are q (0..1000);
heights and sizes are metres. Grid: RES metres per cell, index [j, i] = (north, east); world x = i*RES (east),
y = j*RES (north), z = height. Construction order follows build-prompt section 4 precedence.

Run: blender-env/bin/python maps/gen/mapgen.py <map_id|all>   → maps/build/<id>/
"""
import json, math, sys, time
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
RES = 2.0
LAYOUT = json.loads((ROOT / 'data/layouts.json').read_text())
REVISIONS = json.loads((ROOT / 'data/layout_revisions.json').read_text()) if (ROOT / 'data/layout_revisions.json').exists() else {'revisions': []}

def _apply_revisions(layout, revs):
    """Approved changes over the original layout (data/layout_revisions.json). layouts.json itself is never edited."""
    maps = {m['id']: m for m in layout['maps']}
    for r in revs.get('revisions', []):
        lst = maps[r['map']][r['target']]
        item = lst[r['index']] if 'index' in r else next(x for x in lst if x.get('id') == r['id'])
        if item[r['field']] != r['old']: raise ValueError(f"revision {r} does not match the layout value {item[r['field']]}")
        item[r['field']] = r['new']
    return layout
LAYOUT = _apply_revisions(LAYOUT, REVISIONS)
BIOMES = json.loads((ROOT / 'data/biomes.json').read_text())
OVR = json.loads((ROOT / 'data/overrides.json').read_text())

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3 - 2 * t)

# ───────────────────────── geometry primitives (metres) ─────────────────────────
def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.hypot(*(P - (a + t[:, None] * ab)).T)

def poly_sdf(P, V):
    """Signed distance to a polygon (positive inside)."""
    V = np.asarray(V, float); d = np.full(len(P), np.inf); inside = np.zeros(len(P), bool)
    px, py = P[:, 0], P[:, 1]
    for k in range(len(V)):
        a, b = V[k], V[(k + 1) % len(V)]
        d = np.minimum(d, seg_dist(P, a, b))
        cond = (a[1] > py) != (b[1] > py)
        xint = (b[0] - a[0]) * (py - a[1]) / np.where(cond, b[1] - a[1], 1) + a[0]
        inside ^= cond & (px < xint)
    return np.where(inside, d, -d)

def ellipse_sdf(P, c, r):
    dx, dy = (P[:, 0] - c[0]), (P[:, 1] - c[1]); rr = np.sqrt((dx / r[0]) ** 2 + (dy / r[1]) ** 2) + 1e-9
    g = np.hypot(dx / r[0] ** 2, dy / r[1] ** 2) / rr + 1e-9
    return -(rr - 1) / g

def rect_dist(X, Y, c, size, rot=0.0):
    """Euclidean distance outside an (optionally rotated) rectangle; 0 inside. Also returns inside mask."""
    ca, sa = math.cos(rot), math.sin(rot); lx = (X - c[0]) * ca + (Y - c[1]) * sa; ly = -(X - c[0]) * sa + (Y - c[1]) * ca
    ex = np.maximum(np.abs(lx) - size[0] / 2, 0); ey = np.maximum(np.abs(ly) - size[1] / 2, 0)
    return np.hypot(ex, ey), (ex == 0) & (ey == 0)

def fbm(n, seed, scales, amps, res=RES):
    """Smooth deterministic noise: sum of bicubic-interpolated random lattices. scales in metres."""
    out = np.zeros((n, n), np.float32); coords = None
    for k, (sc, a) in enumerate(zip(scales, amps)):
        g = int(n * res / sc) + 4; lat = np.random.default_rng(seed * 7919 + k).standard_normal((g, g)).astype(np.float32)
        u = np.arange(n, dtype=np.float32) * (g - 3) / n + 1
        out += a * ndi.map_coordinates(lat, np.meshgrid(u, u, indexing='ij'), order=3, mode='wrap')
    return out

# ───────────────────────── road helpers ─────────────────────────
def fillet_polyline(pts, rmax, tol, step=RES):
    """Round each interior corner with the largest radius ≤ rmax whose arc stays within `tol` of the waypoint
    and fits the neighbouring segments. Returns dense samples (k,2) and the radius used per corner."""
    pts = [np.asarray(p, float) for p in pts]; out = [pts[0]]; radii = []
    for i in range(1, len(pts) - 1):
        a, v, b = pts[i - 1], pts[i], pts[i + 1]
        d1 = (v - a) / np.linalg.norm(v - a); d2 = (b - v) / np.linalg.norm(b - v)
        th = math.acos(float(np.clip(d1 @ d2, -1, 1)))
        if th < 0.01: out.append(v); continue
        r_dev = tol / (1 / math.cos(th / 2) - 1); r_seg = 0.48 * min(np.linalg.norm(v - a), np.linalg.norm(b - v)) / math.tan(th / 2)
        R = min(rmax, r_dev, r_seg); radii.append(round(R, 1)); tl = R * math.tan(th / 2)
        p1, p2 = v - d1 * tl, v + d2 * tl; s = 1 if (d1[0] * d2[1] - d1[1] * d2[0]) > 0 else -1
        c = p1 + np.array([-d1[1], d1[0]]) * s * R; a0 = math.atan2(*(p1 - c)[::-1]); a1 = math.atan2(*(p2 - c)[::-1])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi; m = max(2, int(abs(da) * R / step))
        out += [c + R * np.array([math.cos(a0 + da * t), math.sin(a0 + da * t)]) for t in np.linspace(0, 1, m)]
    out.append(pts[-1]); P = np.array(out)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]; s = np.arange(0, seg[-1], step)
    return np.c_[np.interp(s, seg, P[:, 0]), np.interp(s, seg, P[:, 1])], radii

def lipschitz_fit(target, anchors_mask, anchors_val, g, ds):
    """Grade a road profile: the closest-feeling profile whose slope never exceeds g, passing exactly through
    feasible anchors (pads, bridge decks, junctions). Upper/lower 1-D distance envelopes, averaged, then clamped."""
    n = len(target); f = target.astype(float).copy(); U = f.copy(); L = f.copy(); st = g * ds
    for i in range(1, n): U[i] = min(U[i], U[i - 1] + st); L[i] = max(L[i], L[i - 1] - st)
    for i in range(n - 2, -1, -1): U[i] = min(U[i], U[i + 1] + st); L[i] = max(L[i], L[i + 1] - st)
    h = 0.5 * (U + L)
    if anchors_mask.any():
        BIG = 1e9; au = np.where(anchors_mask, anchors_val, BIG); al = np.where(anchors_mask, anchors_val, -BIG)
        for i in range(1, n): au[i] = min(au[i], au[i - 1] + st); al[i] = max(al[i], al[i - 1] - st)
        for i in range(n - 2, -1, -1): au[i] = min(au[i], au[i + 1] + st); al[i] = max(al[i], al[i + 1] - st)
        lo, hi = np.minimum(al, au), np.maximum(al, au); h = np.clip(h, lo, hi)
    return h

class MapGen:
    def __init__(self, d):
        self.d = d; self.id = d['id']; self.S = d['size_m']; self.n = int(round(self.S / RES)) + 1
        self.bio = BIOMES[self.id]; self.seed = d['seed']; self.log = []; self.conflicts = []
        ax = np.arange(self.n) * RES; self.X, self.Y = np.meshgrid(ax, ax)  # [j, i]
        self.P = np.c_[self.X.ravel(), self.Y.ravel()]
        self.k = self.S / 1000.0

    def m(self, q): return np.asarray(q, float) * self.k
    def mpoly(self, V):
        """Polygon vertices on the map boundary are pushed 300 m outside it, so the boundary is not treated as coast."""
        V = np.asarray(V, float); out = V * self.k
        out = np.where(V <= 0, -300.0, out); out = np.where(V >= 1000, self.S + 300.0, out); return out
    def ij(self, xy): return int(round(xy[1] / RES)), int(round(xy[0] / RES))
    def sample(self, A, xy):
        return ndi.map_coordinates(A, [np.asarray(xy)[..., 1] / RES, np.asarray(xy)[..., 0] / RES], order=1, mode='nearest')
    def note(self, msg): self.log.append(msg); print('  ·', msg)

    # 1–2. land mask: primitive, cuts, additions, organic coast (±6 m)
    def build_land(self):
        d, P = self.d, self.P; L = d['land']; n = self.n
        if L['type'] == 'polygon': sd = poly_sdf(P, self.mpoly(L['vertices']))
        elif L['type'] == 'full-square': sd = np.full(len(P), 1e6)
        elif L['type'] == 'ellipse-union':
            sd = np.max([ellipse_sdf(P, self.m(e['center']), self.m(e['radii'])) for e in L['ellipses']], axis=0)
        bed = np.full(len(P), -20.0)
        for c in d.get('water_cuts', []):
            V = c['vertices'] if c['type'] == 'polygon' else [[c['bounds'][0], c['bounds'][1]], [c['bounds'][2], c['bounds'][1]], [c['bounds'][2], c['bounds'][3]], [c['bounds'][0], c['bounds'][3]]]
            Vm = self.mpoly(V); cen = Vm.mean(0)
            if L['type'] == 'polygon':  # a cut edge lying on the coast would leave a sliver bar: push those vertices 60 m seaward
                sdl = poly_sdf(Vm, self.mpoly(L['vertices']))
                for k in range(len(Vm)):
                    if abs(sdl[k]) < 5:
                        dv = Vm[k] - cen; ax_ = int(np.argmax(np.abs(dv))); Vm[k, ax_] += 60 * np.sign(dv[ax_])
            sc = poly_sdf(P, Vm); sd = np.minimum(sd, -sc); bed = np.where(sc > -60, c['bed_height_m'], bed)
        self.add_h = np.full(len(P), np.nan)
        for a in d.get('land_additions', []):
            sa = ellipse_sdf(P, self.m(a['center']), self.m(a['radii'])); sd = np.maximum(sd, sa)
            self.add_h = np.where(sa > -80, a['ground_height_m'], self.add_h)
        sd = sd.reshape(n, n); self.sd_raw = sd.copy()
        # organic coastline: ≤ 6 m displacement, damped near bridge abutments so spans stay exact
        nz = fbm(n, self.seed, [180, 60, 22], [0.55, 0.3, 0.15]); nz = np.clip(nz / 1.2, -1, 1) * 5.5
        damp = np.ones((n, n), np.float32)
        for b in d.get('bridges', []):
            for e in (b['start'], b['end']):
                dd = np.hypot(self.X - self.m(e)[0], self.Y - self.m(e)[1]); damp *= smoothstep(30, 90, dd)
        self.land0 = (sd + nz * damp) > 0
        self.bed = bed.reshape(n, n); self.add_h = self.add_h.reshape(n, n)
        self.dw = ndi.distance_transform_edt(self.land0) * RES      # land cell → nearest water
        self.dl = ndi.distance_transform_edt(~self.land0) * RES     # water cell → nearest land

    # 3. base ground + shoreline blend (gentle shores 35–70 m, cliff stretches), sea floor
    def build_base_heights(self):
        n, d = self.n, self.d; base = np.full((n, n), float(d['base_ground_m']))
        base = np.where(np.isnan(self.add_h), base, self.add_h)
        self.base = base
        cn = fbm(n, self.seed + 11, [260, 90], [0.8, 0.35]); cf = self.bio['cliff_frac']
        thr = np.quantile(cn, 1 - cf) if cf > 0 else 1e9
        self.cliff = smoothstep(thr - 0.12, thr + 0.12, cn) if cf > 0 else np.zeros((n, n), np.float32)
        # no cliffs where the layout needs gentle access: beaches, docks, ports, bridge abutments
        for c in self.gentle_points(): self.cliff *= smoothstep(90, 160, np.hypot(self.X - c[0], self.Y - c[1]))
        w0, w1 = self.bio['shore_w']; W = w0 + (w1 - w0) * (0.5 + 0.5 * np.clip(fbm(n, self.seed + 3, [300], [1.0]), -1, 1))
        Wc = 9 + 5 * self.cliff
        t = np.clip(self.dw / W, 0, 1); tc = np.clip(self.dw / Wc, 0, 1)
        s_gentle = t * t * (3 - 2 * t); s_cliff = 1 - (1 - tc) ** 4
        s = s_gentle * (1 - self.cliff) + s_cliff * self.cliff
        h_land = 0.3 + (base - 0.3) * s
        # sea floor: shallow shelf then drop to bed (-20 default or the cut's bed height)
        dl = self.dl; steep = 1 + self.cliff * 1.5
        h_sea = -(0.4 + 3.4 * smoothstep(0, 20 / steep, dl)) - (np.abs(self.bed) - 3.8) * smoothstep(14, 100 / steep, dl)
        h_sea = np.maximum(h_sea, self.bed)
        self.h = np.where(self.land0, h_land, h_sea).astype(np.float64)
        self.protect = np.zeros((n, n), bool)

    def gentle_points(self):
        d = self.d; pts = [self.m(b['center']) for b in d.get('landing_beaches', [])]
        for k in d.get('docks', []): pts += [self.m(k['land_access']), self.m(k['water_center'])]
        for b in d.get('bridges', []): pts += [self.m(b['start']), self.m(b['end'])]
        for lm in d.get('landmarks', []):
            if OVR['landmarks'].get(f"{self.id}:{lm['id']}", {}).get('quay'): pts.append(self.m(lm['center']))
        return pts

    # 4. hills (raise toward absolute peak, max of overlaps) and quarry depressions
    def build_hills(self):
        land = self.h > 0; best = self.h.copy()
        for hl in self.d.get('hills', []):
            c = self.m(hl['center']); r = self.m(hl['radii'])
            d2 = ((self.X - c[0]) / r[0]) ** 2 + ((self.Y - c[1]) / r[1]) ** 2
            w = np.where(d2 < 1, (1 - d2) ** 2, 0.0); hh = self.h + w * np.maximum(hl['peak_height_m'] - self.h, 0)
            best = np.maximum(best, np.where(land, hh, self.h))
            self.note(f"hill {hl['id']}: peak {best[self.ij(c)]:.1f} m (spec {hl['peak_height_m']})")
        self.h = best
        self.quarry_floor = np.zeros_like(self.h, bool)
        for qy in self.d.get('quarries', []):
            c = self.m(qy['center']); r = self.m(qy['radii']); fl = qy['floor_height_m']
            dd = np.sqrt(((self.X - c[0]) / r[0]) ** 2 + ((self.Y - c[1]) / r[1]) ** 2)
            bench = np.where(dd < 0.86, 0.0, np.clip((dd - 0.86) / 0.14, 0, 1))
            bench = np.floor(bench * 3 + 0.35 * np.clip((bench * 3) % 1 * 4, 0, 1)) / 3  # stepped benches
            wall = fl + (self.h - fl) * np.clip(bench, 0, 1)
            self.h = np.where(dd < 1.0, np.minimum(self.h, wall), self.h); self.quarry_floor |= dd < 0.86
            self.note(f"quarry {qy['center']}: floor {fl} m, rim {self.h[self.ij(c)]:.1f}→{self.d['base_ground_m']} m")

    def flatten(self, c, size, hgt, band, rot=0.0, protect=True, quay=False):
        dist, inside = rect_dist(self.X, self.Y, c, size, rot)
        w = 1 - smoothstep(0, band, dist); w = np.where(inside, 1.0, w)
        ok = ~self.protect | inside if protect else ~self.protect
        if not quay: ok &= self.h > -0.5  # never fill the sea except at quays
        self.h = np.where(ok & (w > 0), self.h * (1 - w) + hgt * w, self.h)
        if protect: self.protect |= inside
        return inside

    # 5. base pads and landmark compounds
    def build_pads(self):
        self.pads = []
        for b in self.d['bases']:
            c = self.m(b['position']); s = b['pad_size_m']; inside = self.flatten(c, s, b['ground_height_m'], 30)
            self.pads.append({'id': b['id'], 'team': b['id'][0], 'center': c.tolist(), 'size': s, 'h': b['ground_height_m'], 'mask': inside})
        self.landmarks = []
        for lm in self.d.get('landmarks', []):
            c = self.m(lm['center']); s = lm['size_m']; key = f"{self.id}:{lm['id']}"; ov = OVR['landmarks'].get(key, {})
            dist, inside = rect_dist(self.X, self.Y, c, s); hh = ov.get('pad_h', float(np.median(self.h[inside])))
            if ov.get('quay'):
                # extend the terrace along its dominant seaward axis to the shoreline and hold that height there (quay wall)
                toward = np.unravel_index(np.argmin(np.where(~self.land0, np.hypot(self.X - c[0], self.Y - c[1]), 1e9)), self.h.shape)
                wpt = np.array([toward[1] * RES, toward[0] * RES]); ax_ = int(np.argmax(np.abs(wpt - c))); sg = np.sign((wpt - c)[ax_])
                gap = max(0.0, abs((wpt - c)[ax_]) - s[ax_] / 2 + 4); ext = list(map(float, s)); ext[ax_] += gap
                cc = c.copy(); cc[ax_] += sg * gap / 2
                self.flatten(cc, ext, hh, 20)
                q = rect_dist(self.X, self.Y, cc, ext)[1] & (self.h > -0.6); self.h = np.where(q, hh, self.h)
                lmq = {'quay_rect': {'center': cc.tolist(), 'size': ext}}
            else: self.flatten(c, s, hh, 20); lmq = {}
            self.landmarks.append({'id': lm['id'], 'role': lm['role'], 'center': c.tolist(), 'size': s, 'h': round(float(hh), 2), **lmq})
            self.note(f"landmark {lm['id']} pad {s} at {hh:.1f} m")

    # 6. roads, ramps, bridges, dock spurs, quarry ramps
    def road_list(self):
        R = []; ro = OVR['road']
        for r in self.d.get('roads', []): R.append({'id': r['id'], 'kind': 'main' if r['clear_width_m'] >= 24 else 'secondary', 'pts': self.m(r['points']), 'w': r['clear_width_m']})
        R.sort(key=lambda r: -r['w'])
        mains = [fillet_polyline(r['pts'], 90, 8)[0] for r in R]
        qcs = [(self.m(q['center']), self.m(q['radii'])) for q in self.d.get('quarries', [])]
        for qi, qy in enumerate(self.d.get('quarries', [])):
            c = self.m(qy['center'])
            for ei, e in enumerate(qy['entries']):
                e = self.m(e); dv = (e - c) / np.linalg.norm(e - c); out1 = e + dv * 55
                # nearest road point not inside any quarry, reached without crossing the other pit
                best = None
                for P in mains:
                    ok = np.ones(len(P), bool)
                    for qc, qr in qcs: ok &= (((P[:, 0] - qc[0]) / (qr[0] + 30)) ** 2 + ((P[:, 1] - qc[1]) / (qr[1] + 30)) ** 2) > 1
                    for tq in np.linspace(0.1, 0.9, 9):
                        Z = out1[None] * (1 - tq) + P * tq
                        for qc, qr in qcs: ok &= (((Z[:, 0] - qc[0]) / (qr[0] + 15)) ** 2 + ((Z[:, 1] - qc[1]) / (qr[1] + 15)) ** 2) > 1
                    if not ok.any(): continue
                    dd = np.where(ok, np.hypot(*(P - out1).T), 1e9); j = int(np.argmin(dd))
                    if best is None or dd[j] < best[0]: best = (dd[j], P[j])
                pts = [e - dv * 25, e, out1] + ([best[1]] if best is not None else [e + dv * 150])
                R.append({'id': f'quarry{qi + 1}-ramp{ei + 1}', 'kind': 'ramp', 'pts': np.array(pts), 'w': OVR['quarry']['ramp_clear_w'],
                          'anchor_start': qy['floor_height_m']})
        return R

    def build_roads(self):
        n = self.n; ro = OVR['road']; g = ro['grade']
        self.road_h = np.full((n, n), np.nan); self.road_core = np.zeros((n, n), bool); self.road_band = np.zeros((n, n), bool)
        self.road_id = np.full((n, n), -1, np.int16); self.roads = []
        self.pad_union = np.zeros((n, n), bool)
        for p in self.pads: self.pad_union |= p['mask']
        pad_masks = [p['mask'] for p in self.pads]; bridges = [(b, self.m(b['start']), self.m(b['end'])) for b in self.d.get('bridges', [])]
        docks = self.plan_docks()
        rl = self.road_list()
        for k in docks['docks']:
            for r in rl:
                if r['id'] == k['spur_from'] and float(self.h[self.ij(k['J'])]) > k['J_max_h']:
                    r.setdefault('anchor_at', []).append((np.array(k['J']), k['J_max_h']))
                    self.note(f"dock {k['player']}: road {r['id']} lowered to {k['J_max_h']:.1f} m at the spur junction (terrain {float(self.h[self.ij(k['J'])]):.1f} m)")
        for ri, r in enumerate(rl + docks['spurs']):
            P, radii = fillet_polyline(r['pts'], ro['fillet_max_m'], ro['waypoint_tol_m'] if r['kind'] in ('main', 'secondary') and 'spur' not in r['id'] else 40.0)
            ii = np.clip(np.round(P[:, 0] / RES).astype(int), 0, n - 1); jj = np.clip(np.round(P[:, 1] / RES).astype(int), 0, n - 1)
            in_pad = np.zeros(len(P), bool)
            for pm in pad_masks: in_pad |= pm[jj, ii]
            on_bridge = np.zeros(len(P), bool); deck = np.zeros(len(P))
            for b, a, e in bridges:
                ab = e - a; t = ((P - a) @ ab) / (ab @ ab); dd = np.abs((P - a) @ np.array([-ab[1], ab[0]]) / np.linalg.norm(ab))
                hit = (t >= 0) & (t <= 1) & (dd < 4); on_bridge |= hit; deck = np.where(hit, b['deck_height_m'], deck)
            keep = ~in_pad
            # split into runs outside pads
            runs = []; cur = []
            for k in range(len(P)):
                if keep[k]: cur.append(k)
                elif cur: runs.append(cur); cur = []
            if cur: runs.append(cur)
            for run in [x for x in runs if len(x) * RES > 12]:
                Q = P[run]; qi_, qj_ = ii[run], jj[run]; br = on_bridge[run]
                target = ndi.gaussian_filter1d(self.h[qj_, qi_], 12)
                am = np.zeros(len(Q), bool); av = np.zeros(len(Q))
                # pad edges, junctions with earlier roads, bridge decks, explicit anchors
                for end, k in ((0, run[0]), (-1, run[-1])):
                    kk = k - 1 if end == 0 else k + 1
                    if 0 <= kk < len(P) and in_pad[kk]:
                        pj, pi = jj[kk], ii[kk]; ph = [p['h'] for p in self.pads if p['mask'][pj, pi]]
                        if ph: am[end] = True; av[end] = ph[0]
                prev = ~np.isnan(self.road_h[qj_, qi_]) & ~br
                am |= prev; av = np.where(prev, self.road_h[qj_, qi_], av)
                am |= br; av = np.where(br, deck[run], av)
                if 'anchor_start' in r and run[0] == 0: am[0] = True; av[0] = r['anchor_start']
                if 'anchor_end' in r and run[-1] == len(P) - 1: am[-1] = True; av[-1] = r['anchor_end']
                if 'anchor_tail' in r:  # hold the last stretch flat at the apron height (the apron is flattened later)
                    tp, tl, tv = r['anchor_tail']; near = np.hypot(*(Q - np.asarray(tp)).T) <= tl
                    if 'apron_rect' in r:
                        ac, asz, arot = r['apron_rect']; ca, sa = math.cos(arot), math.sin(arot); lx = (Q[:, 0] - ac[0]) * ca + (Q[:, 1] - ac[1]) * sa; ly = -(Q[:, 0] - ac[0]) * sa + (Q[:, 1] - ac[1]) * ca
                        near |= (np.abs(lx) <= asz[0] / 2 + 12) & (np.abs(ly) <= asz[1] / 2 + 12)
                    am |= near; av = np.where(near, tv, av)
                for k, hv in r.get('anchor_at', []):
                    dk = np.hypot(*(Q - k).T); kk = int(np.argmin(dk))
                    if dk[kk] < 6: am[kk] = True; av[kk] = hv
                prof = lipschitz_fit(target, am, av, g, RES)
                slope = np.abs(np.diff(prof)) / RES
                viol = float(np.max(np.abs(prof[am] - av[am]))) if am.any() else 0.0
                rec = {'id': r['id'] + (f'#{runs.index(run)}' if len(runs) > 1 else ''), 'kind': r['kind'], 'clear_w': r['w'],
                       'xy': np.round(Q, 2).tolist(), 'z': np.round(prof, 3).tolist(), 'bridge': br.tolist(),
                       'len_m': round(len(Q) * RES, 1), 'max_grade': round(float(slope.max()) if len(slope) else 0, 4),
                       'min_fillet_m': min(radii) if radii else None, 'anchor_err_m': round(viol, 3)}
                self.apply_road(Q, prof, br, r['w'], len(self.roads), rec)
                self.roads.append(rec)
        self.docks = docks['docks']

    def apply_road(self, Q, prof, br, clear_w, rid, rec):
        n = self.n; ro = OVR['road']; hw = clear_w / 2 + ro['shoulder_m']
        lo = np.maximum(((Q.min(0) - hw - 60) / RES).astype(int), 0); hi = np.minimum(((Q.max(0) + hw + 60) / RES).astype(int) + 1, n)
        sub = (slice(lo[1], hi[1]), slice(lo[0], hi[0]))
        lab = np.full((hi[1] - lo[1], hi[0] - lo[0]), -1, np.int32)
        qi = np.round(Q[:, 0] / RES).astype(int) - lo[0]; qj = np.round(Q[:, 1] / RES).astype(int) - lo[1]
        lab[qj, qi] = np.arange(len(Q)); dist, (ij, ii) = ndi.distance_transform_edt(lab < 0, return_indices=True)
        dist = dist * RES; near = lab[ij, ii]; isb = br[near]
        # height from the arc-length position projected on the local tangent → level cross-section, no stair steps on curves
        T = np.gradient(Q, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
        Xs, Ys = self.X[sub], self.Y[sub]; sproj = near * RES + (Xs - Q[near, 0]) * T[near, 0] + (Ys - Q[near, 1]) * T[near, 1]
        hr = np.interp(sproj, np.arange(len(Q)) * RES, prof)
        H = self.h[sub]; dev = np.maximum(dist - hw, 0) * (1 / ro['side_slope'])  # 1:2 cut/fill side slopes
        within = dist <= hw + 60
        newH = np.where(dist <= hw, hr, hr + np.clip(H - hr, -dev, dev))
        # land only (water cuts stay water); band grading never edits pads or earlier roadbeds
        apply = within & ~isb & (H > -0.3) & (~self.protect[sub] | (dist <= hw)) & ~self.pad_union[sub] & np.isnan(self.road_h[sub])
        rec['max_cut_m'] = round(float(np.max(np.where(apply, H - newH, 0))), 2); rec['max_fill_m'] = round(float(np.max(np.where(apply, newH - H, 0))), 2)
        self.h[sub] = np.where(apply, newH, H)
        core = (dist <= clear_w / 2) & ~isb
        self.road_core[sub] |= core; self.road_band[sub] |= (dist <= clear_w / 2 + ro['safety_band_m'])
        self.road_h[sub] = np.where((dist <= hw) & ~isb & np.isnan(self.road_h[sub]), hr, self.road_h[sub])
        self.road_id[sub] = np.where(core & (self.road_id[sub] < 0), rid, self.road_id[sub])
        self.protect[sub] |= dist <= hw

    def plan_docks(self):
        """Dock = land apron at land_access + trestle pier to an 80×40 dock deck around water_center. A spur road joins
        the apron to the nearest road; the apron height is as low as the trestle grade allows (deck 3 m)."""
        od = OVR['dock']; out = {'docks': [], 'spurs': []}
        allroads = [(r, fillet_polyline(r['pts'], OVR['road']['fillet_max_m'], 8)[0]) for r in self.road_list() if r['kind'] != 'ramp']
        for k in self.d.get('docks', []):
            L = self.m(k['land_access']); Wc = self.m(k['water_center']); u = (Wc - L) / np.linalg.norm(Wc - L)
            # shoreline along L→W
            ts = np.arange(0, np.linalg.norm(Wc - L) + 40, 1.0); line = L + ts[:, None] * u
            lm = self.sample(self.land0.astype(float), line) > 0.5; shore_t = ts[np.argmin(lm)] if (~lm).any() else ts[-1]
            if k.get('orientation', '').startswith('berth-long-axis-north-south'): rot = math.pi / 2 if abs(u[0]) > abs(u[1]) else 0.0
            else: rot = math.atan2(u[1], u[0]) + math.pi / 2  # long axis parallel to the coast
            # dock local frame: +Y toward land. rot is the angle of local +X.
            ly = np.array([-math.sin(rot), math.cos(rot)])
            if ly @ (-u) < 0: rot += math.pi; ly = -ly
            land_edge_t = np.linalg.norm(Wc - L) - 20 * abs(ly @ u)
            trestle = max(0.0, land_edge_t - shore_t); apron_h = od['deck_z'] + od['max_trestle_grade'] * trestle
            # junction: a road sample outside every pad (+15 m) that can reach the apron at ≤ grade, preferring short spurs
            best = None; g = OVR['road']['grade'] * 0.95
            comp, _ = ndi.label(self.land0); cL = comp[self.ij(L)]
            for r, P in allroads:
                pj = np.clip(np.round(P[:, 1] / RES).astype(int), 0, self.n - 1); pi = np.clip(np.round(P[:, 0] / RES).astype(int), 0, self.n - 1)
                ok = comp[pj, pi] == cL
                sP = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]; hE = self.sample(self.h, P[[0, -1]])
                h_low = np.maximum.reduce([hE[0] - g * sP, hE[1] - g * (sP[-1] - sP), np.full(len(P), 0.5)])
                for pd in self.d['bases']:
                    c = self.m(pd['position']); hs = pd['pad_size_m'][0] / 2 + 15
                    ok &= ~((np.abs(P[:, 0] - c[0]) < hs) & (np.abs(P[:, 1] - c[1]) < hs))
                # the straight spur J→L must not cross a pad (+8 m)
                tt = np.linspace(0, 1, 40)
                for pd in self.d['bases']:
                    c = self.m(pd['position']); hs = pd['pad_size_m'][0] / 2 + 8
                    seg = P[:, None, :] * (1 - tt[None, :, None]) + L[None, None, :] * tt[None, :, None]
                    ok &= ~((np.abs(seg[..., 0] - c[0]) < hs) & (np.abs(seg[..., 1] - c[1]) < hs)).any(1)
                if not ok.any(): continue
                for tq in np.linspace(0.05, 0.95, 10):  # spur must run over land
                    ok &= self.sample(self.land0.astype(float), P * (1 - tq) + L * tq) > 0.5
                if not ok.any(): continue
                Pk = P[ok]; dd = np.hypot(*(Pk - L).T); hj = np.maximum(h_low[ok], np.minimum(self.sample(self.h, Pk), apron_h))
                need = np.maximum(0, (hj - apron_h) / g - (dd - 14)); score = dd + 3 * need; j = int(np.argmin(score))
                if best is None or score[j] < best[0]: best = (score[j], Pk[j], r['id'])
            J = best[1]; spur_len = float(np.linalg.norm(J - L))
            rec = {'player': k['player'], 'land_access': L.tolist(), 'water_center': Wc.tolist(), 'rot': rot, 'deck_z': od['deck_z'],
                   'shore': (L + u * shore_t).tolist(), 'trestle_m': round(trestle, 1), 'apron_h': round(apron_h, 2), 'spur_from': best[2], 'spur_len_m': round(spur_len, 1),
                   'J': J.tolist(), 'J_max_h': round(apron_h + OVR['road']['grade'] * max(spur_len - 14, 0) * 0.95, 2)}
            out['docks'].append(rec)
            if spur_len > 6:
                out['spurs'].append({'id': f"dock-{k['player']}-spur", 'kind': 'secondary', 'w': 16, 'pts': np.array([J, L]), 'anchor_end': apron_h,
                                     'anchor_tail': (L.tolist(), 12.0, apron_h),
                                     'apron_rect': ((L + (L + u * shore_t)) / 2 + u * 1, [shore_t + 2, od['apron'][0]], math.atan2(u[1], u[0]))})
        return out

    def build_dock_aprons(self):
        od = OVR['dock']
        for k in self.docks:
            L = np.array(k['land_access']); S = np.array(k['shore']); u = (S - L) / max(np.linalg.norm(S - L), 1e-6)
            c = (L + S) / 2 + u * 1; length = np.linalg.norm(S - L) + 2; rot = math.atan2(u[1], u[0])
            self.flatten(c, [length, od['apron'][0]], k['apron_h'], 18, rot=rot, protect=True)
            # quay: hold the apron height right to the waterline
            dist, inside = rect_dist(self.X, self.Y, c, [length, od['apron'][0]], rot); self.h = np.where(inside & (self.h > -0.6), k['apron_h'], self.h)
            # berth pocket and the reserved water dredged to berth depth
            Wc = np.array(k['water_center']); dist, inside = rect_dist(self.X, self.Y, Wc, [96, 70], k['rot'])
            dred = np.where(inside, -od['berth_depth'], np.inf); self.h = np.where(self.h < 0, np.minimum(self.h, np.where(dist < 25, -od['berth_depth'] + dist * 0.12, np.inf)), self.h)

    # 7. deposits (50×50 flat service reservations) and landing beaches
    def build_reservations(self):
        self.deposits = []
        core_d, (cj, ci) = ndi.distance_transform_edt(~self.road_core, return_indices=True); core_d *= RES
        for dp in self.d['deposits']:
            c0 = self.m(dp['position']); c = c0.copy(); shift = 0.0
            if rect_dist(self.X, self.Y, c, [50, 50])[1][self.road_band].any():
                j, i = self.ij(c0); v = c0 - np.array([ci[j, i] * RES, cj[j, i] * RES])
                if np.linalg.norm(v) < 1e-6:  # on the centreline: step perpendicular to the local road direction
                    rid = self.road_id[j, i]; yy, xx = np.nonzero(self.road_id[max(j - 15, 0):j + 15, max(i - 15, 0):i + 15] == rid)
                    dvec = np.polyfit(xx, yy, 1) if len(xx) > 3 and np.ptp(xx) > 0 else [1e3, 0]; t = np.array([1, dvec[0]]); v = np.array([-t[1], t[0]])
                    if (v @ (np.array([self.S, self.S]) / 2 - c0)) > 0: v = -v  # push toward the map edge (away from the centre)
                v = v / np.linalg.norm(v)
                for _ in range(80):  # step away from the road until the service square clears the corridor + safety band
                    if not rect_dist(self.X, self.Y, c, [50, 50])[1][self.road_band].any(): break
                    c = c + v * 2.0
                shift = float(np.linalg.norm(c - c0))
                rd = float(core_d[self.ij(c0)])
                where = ('a road runs through the specified point, so the 50×50 m service area cannot clear the road corridor and 6 m safety band there' if rd < 2
                         else f"its 50×50 m service area at the specified point reaches into the reserved road band (clear corridor plus 6 m safety band) of the road {rd:.0f} m away")
                self.conflicts.append(f"deposit {dp['id']}: {where}; "
                                      f"the rig and service area are offset {shift:.0f} m to clear it (the specified coordinate is kept as the ore-field reference). Needs approval.")
            hh = float(self.h[self.ij(c)])
            self.flatten(c, [50, 50], hh, 14)
            self.deposits.append({'id': dp['id'], 'kind': dp['kind'], 'spec_pos': c0.tolist(), 'pos': c.tolist(), 'offset_m': round(shift, 1), 'h': round(hh, 2),
                                  'nearest': dp.get('initial_nearest_player'), 'ore': 100000, 'load': 100})
        self.beaches = []; ob = OVR['beach']
        for bc in self.d.get('landing_beaches', []):
            c = self.m(bc['center']); W = bc['width_m']
            # seaward direction = toward nearest water from the centre
            j, i = self.ij(c); win = 60
            sl = (slice(max(j - win, 0), j + win), slice(max(i - win, 0), i + win))
            wj, wi = np.nonzero(~self.land0[sl]); wy = (wj + sl[0].start) * RES; wx = (wi + sl[1].start) * RES
            k = np.argmin(np.hypot(wx - c[0], wy - c[1])); u = np.array([wx[k] - c[0], wy[k] - c[1]]); u /= np.linalg.norm(u)
            v = np.array([-u[1], u[0]]); lx = (self.X - c[0]) * u[0] + (self.Y - c[1]) * u[1]; ly = (self.X - c[0]) * v[0] + (self.Y - c[1]) * v[1]
            tt = np.arange(0, 220, 1.0); zf = self.sample(self.h, c + tt[:, None] * u)
            if zf[0] >= 0: s0 = float(tt[np.argmax(zf < 0)])
            else: zb = self.sample(self.h, c - tt[:, None] * u); s0 = -float(tt[np.argmax(zb >= 0)])
            top = float(self.base[self.ij(c)]) if np.isnan(self.add_h[self.ij(c)]) else float(self.add_h[self.ij(c)])
            prof = np.clip(-(lx - s0) * ob['grade'], ob['underwater_to'], top)
            ramp_len = top / ob['grade']; inland = -(lx - s0)
            zone = (np.abs(ly) <= W / 2 + 18) & (inland <= ramp_len + ob['apron_m'] + 25) & (inland >= ob['underwater_to'] / ob['grade'] - 25)
            wlat = 1 - smoothstep(W / 2, W / 2 + 18, np.abs(ly)); wlon = 1 - smoothstep(ramp_len + ob['apron_m'], ramp_len + ob['apron_m'] + 25, inland)
            wlon *= smoothstep(ob['underwater_to'] / ob['grade'] - 25, ob['underwater_to'] / ob['grade'], inland)
            w = np.where(zone, wlat * wlon, 0)
            newh = self.h * (1 - w) + prof * w
            if hasattr(self, 'beach_own'): newh = np.where(self.beach_own & (w > 0), np.minimum(self.h, newh), newh)  # overlapping beaches: keep both ramps
            else: self.beach_own = np.zeros_like(self.land0)
            self.h = newh; self.beach_own |= w > 0.5
            core = (np.abs(ly) <= W / 2) & (inland <= ramp_len + ob['apron_m']) & (inland >= ob['underwater_to'] / ob['grade'])
            self.protect |= core
            self.beaches.append({'center': c.tolist(), 'width_m': W, 'dir': u.tolist(), 'shore_offset': float(s0), 'ramp_len': round(ramp_len, 1), 'top_h': top, 'mask': core})

    def mark_beach_roads(self):
        if not getattr(self, 'beaches', None): return
        bm = np.zeros_like(self.land0)
        for b in self.beaches: bm |= b['mask']
        for r in self.roads:
            xy = np.array(r['xy']); jj = np.clip((xy[:, 1] / RES).round().astype(int), 0, self.n - 1); ii = np.clip((xy[:, 0] / RES).round().astype(int), 0, self.n - 1)
            zt = self.h[jj, ii]; onb = bm[jj, ii] & (np.abs(zt - np.array(r['z'])) > 0.25)
            r['on_beach'] = onb.tolist()
            if onb.any(): self.conflicts.append(f"road {r['id']}: its last {int(onb.sum()) * RES:.0f} m run onto landing-beach ramp; the paved surface stops at the beach apron and the beach itself is the access")

    # 8. minor variation (±0.35 m) outside protected masks, then final classes
    def finish(self):
        n = self.n; nz = fbm(n, self.seed + 21, [40, 14, 6], [0.6, 0.3, 0.15]); nz = np.clip(nz / 1.1, -1, 1) * 0.35
        free = ~self.protect & (self.h > 0.6) & ~self.road_band
        self.h = np.where(free, self.h + nz, self.h).astype(np.float32)
        self.land = self.h > 0.0
        gy, gx = np.gradient(self.h, RES); self.slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)

    def run(self):
        t = time.time(); print(f"[{self.id}] {self.d['name']} {self.S}×{self.S} m grid {self.n}² @ {RES} m")
        self.build_land(); self.build_base_heights(); self.build_hills(); self.build_pads(); self.build_roads()
        self.build_dock_aprons(); self.build_reservations(); self.mark_beach_roads(); self.finish()
        print(f"  done in {time.time() - t:.1f}s"); return self

    def save(self):
        out = ROOT / 'build' / self.id; out.mkdir(parents=True, exist_ok=True)
        np.save(out / 'height.npy', self.h)
        masks = {'road_core': self.road_core, 'road_band': self.road_band, 'protect': self.protect, 'cliff': self.cliff.astype(np.float16),
                 'quarry_floor': self.quarry_floor, 'land0': self.land0, 'road_id': self.road_id}
        for i, p in enumerate(self.pads): masks[f"pad_{p['id']}"] = p['mask']
        for i, b in enumerate(self.beaches): masks[f'beach_{i}'] = b['mask']
        np.savez_compressed(out / 'masks.npz', **masks)
        meta = {'id': self.id, 'name': self.d['name'], 'size_m': self.S, 'res': RES, 'n': self.n, 'mode': self.d['mode'], 'seed': self.seed,
                'base_ground_m': self.d['base_ground_m'], 'biome': self.d['biome'],
                'pads': [{k: v for k, v in p.items() if k != 'mask'} for p in self.pads], 'landmarks': self.landmarks,
                'roads': self.roads, 'docks': self.docks, 'deposits': self.deposits,
                'beaches': [{k: v for k, v in b.items() if k != 'mask'} for b in self.beaches],
                'bridges': [{'id': b['id'], 'start': self.m(b['start']).tolist(), 'end': self.m(b['end']).tolist(), 'deck_h': b['deck_height_m'],
                             'clear_w': 24} for b in self.d.get('bridges', [])],
                'quarries': [{'center': self.m(q['center']).tolist(), 'radii': self.m(q['radii']).tolist(), 'floor_h': q['floor_height_m'],
                              'entries': [self.m(e).tolist() for e in q['entries']]} for q in self.d.get('quarries', [])],
                'hills': self.d.get('hills', []), 'forest_patches': self.d.get('forest_patches', []), 'log': self.log, 'conflicts': self.conflicts}
        (out / 'meta.json').write_text(json.dumps(meta))
        return out

def maps(sel):
    return [m for m in LAYOUT['maps'] if sel in ('all', m['id'], m['name'])]

if __name__ == '__main__':
    for d in maps(sys.argv[1] if len(sys.argv) > 1 else 'all'):
        MapGen(d).run().save()
