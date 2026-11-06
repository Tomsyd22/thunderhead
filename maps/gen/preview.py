"""Top-down diagnostic render of a generated map: hillshade, water depth, roads, pads, deposits, docks, beaches.
Run: blender-env/bin/python maps/gen/preview.py <id> → maps/build/<id>/preview.png"""
import json, sys, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]

def render(mid, scale=1):
    b = ROOT / 'build' / mid; h = np.load(b / 'height.npy'); M = np.load(b / 'masks.npz'); meta = json.loads((b / 'meta.json').read_text()); R = meta['res']
    gy, gx = np.gradient(h, R); nx, ny, nz = -gx, -gy, np.ones_like(h); l = np.array([-0.5, 0.6, 0.62]); l /= np.linalg.norm(l)
    shade = np.clip((nx * l[0] + ny * l[1] + nz * l[2]) / np.sqrt(nx * nx + ny * ny + 1), 0, 1)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    col = np.zeros(h.shape + (3,), np.float32)
    lowc, highc = np.array([0.42, 0.55, 0.30]), np.array([0.62, 0.66, 0.42])
    t = np.clip(h / 40, 0, 1)[..., None]; col[:] = lowc * (1 - t) + highc * t
    rock = np.clip((slope - 22) / 12, 0, 1)[..., None]; col = col * (1 - rock) + np.array([0.55, 0.53, 0.5]) * rock
    sand = ((h > 0) & (h < 1.6) & (slope < 15))[..., None]; col = np.where(sand, np.array([0.82, 0.76, 0.6]), col)
    d = np.clip(-h / 20, 0, 1)[..., None]; water = (h <= 0)[..., None]
    wc = np.array([0.35, 0.72, 0.72]) * (1 - d) + np.array([0.04, 0.2, 0.36]) * d
    col = np.where(water, wc, col * (0.45 + 0.75 * shade[..., None]))
    col = np.where(M['road_core'][..., None], np.array([0.25, 0.25, 0.27]) * (0.7 + 0.4 * shade[..., None]), col)
    for k in M.files:
        if k.startswith('pad_'): col = np.where(M[k][..., None], np.array([0.72, 0.72, 0.7]) * (0.8 + 0.3 * shade[..., None]), col)
        if k.startswith('beach_'): col = np.where((M[k] & (h > 0))[..., None], np.array([0.93, 0.86, 0.66]), col)
    img = Image.fromarray((np.clip(col[::-1], 0, 1) * 255).astype(np.uint8)); dr = ImageDraw.Draw(img); n = h.shape[0]
    P = lambda xy: (xy[0] / R, n - 1 - xy[1] / R)
    for r in meta['roads']:
        xy = r['xy']; br = r['bridge']
        for k in range(len(xy) - 1):
            if br[k]: dr.line([P(xy[k]), P(xy[k + 1])], fill=(240, 240, 240), width=int(r['clear_w'] / R))
    for p in meta['pads']:
        c = P(p['center']); col = (40, 110, 230) if p['team'] == 'B' else (220, 50, 45); s = p['size'][0] / R / 2
        dr.rectangle([c[0] - s, c[1] - s, c[0] + s, c[1] + s], outline=col, width=3); dr.text((c[0] - 8, c[1] - 6), p['id'], fill=col)
    for dp in meta['deposits']:
        c = P(dp['pos']); s = 25 / R; dr.rectangle([c[0] - s, c[1] - s, c[0] + s, c[1] + s], outline=(255, 200, 0), width=2); dr.text((c[0] + s + 2, c[1] - 6), dp['id'], fill=(255, 230, 120))
    for k in meta['docks']:
        c = P(k['water_center']); a = k['rot']; L, W = 80 / R / 2, 40 / R / 2
        pts = [(c[0] + math.cos(a) * x - math.sin(a) * y, c[1] - (math.sin(a) * x + math.cos(a) * y)) for x, y in ((-L, -W), (L, -W), (L, W), (-L, W))]
        dr.polygon(pts, outline=(255, 255, 255)); dr.line([P(k['land_access']), P(k['shore'])], fill=(200, 200, 200), width=3); dr.text((c[0] + 6, c[1]), 'dock ' + k['player'], fill=(255, 255, 255))
    for lm in meta['landmarks']:
        c = P(lm['center']); sx, sy = lm['size'][0] / R / 2, lm['size'][1] / R / 2
        dr.rectangle([c[0] - sx, c[1] - sy, c[0] + sx, c[1] + sy], outline=(180, 120, 255), width=2); dr.text((c[0] - sx, c[1] - sy - 12), lm['id'], fill=(220, 200, 255))
    for b in meta['beaches']: c = P(b['center']); dr.ellipse([c[0] - 5, c[1] - 5, c[0] + 5, c[1] + 5], outline=(255, 120, 0), width=2)
    ip = ROOT / 'build' / mid / 'instances.json'
    if ip.exists():
        import sys; sys.path.insert(0, str(Path(__file__).parent)); from assets import info
        for it in json.loads(ip.read_text())['items']:
            c = P((it['x'], it['y'])); a = it['asset']
            if a.startswith('veg_') and it['cat'] in ('tree', 'tree_scatter', 'windbreak'):
                r = 2.2 * it['s']; dr.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=(30, 70, 25))
            elif a.startswith(('bld_', 'prop_', 'unit_')) and it['cat'] not in ('resource_fence', 'fence'):
                sx, sy = info(a)['size'][0] * it['s'] / R / 2, info(a)['size'][1] * it['s'] / R / 2; t = it['rot']
                pts = [(c[0] + math.cos(t) * x - math.sin(t) * y, c[1] - (math.sin(t) * x + math.cos(t) * y)) for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy))]
                fill = (230, 230, 225) if a.startswith('bld_') else ((250, 120, 60) if a.startswith('unit_') else (190, 175, 150))
                dr.polygon(pts, fill=fill)
            elif a.startswith('rock_'):
                r = 1.5 * it['s']; dr.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=(120, 115, 110))
    out = ROOT / 'build' / mid / 'preview.png'
    if scale != 1: img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    img.save(out); return out

if __name__ == '__main__':
    print(render(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1))
