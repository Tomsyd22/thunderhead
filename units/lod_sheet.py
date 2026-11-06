"""units/preview/lod_sheet.png: every unit at LOD0 | LOD1 | LOD2, same camera, from the Unit Sandbox close-ups
(units/sandbox/results/shots/unit_<UID>.png, _lod1.png, _lod2.png written by test_sandbox.js --shots), with triangle counts."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent; SH = ROOT / 'sandbox' / 'results' / 'shots'
spec = {u['id']: u for u in json.loads((ROOT / 'data' / 'unit_specs.json').read_text())['units']}
lods = json.loads((ROOT / 'out' / 'lods.json').read_text())
ORDER = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A02', 'A03', 'A04', 'A05', 'T01', 'T02', 'T03', 'T04', 'T05']
CW, CH, LH, PAD = 300, 240, 22, 6
f = lambda s, b=False: ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if b else ''}.ttf", s)
cols = 3   # units per row; each unit takes three cells
W = PAD + cols * (3 * CW + 2 * 2 + PAD * 3); rows = (len(ORDER) + cols - 1) // cols; H = 54 + rows * (CH + LH + 26 + PAD)
sheet = Image.new('RGB', (W, H), (22, 25, 30)); d = ImageDraw.Draw(sheet)
d.text((PAD + 4, 14), 'Distant-view models: LOD0 | LOD1 | LOD2 at the same close camera (Unit Sandbox, three.js)', font=f(22, True), fill=(235, 238, 242))
for k, uid in enumerate(ORDER):
    r, c = divmod(k, cols); x0 = PAD + c * (3 * CW + 4 + PAD * 3); y0 = 54 + r * (CH + LH + 26 + PAD)
    d.text((x0, y0), f"{uid}  {spec[uid]['name']}", font=f(15, True), fill=(235, 238, 242))
    tri = [lods[uid]['1']['lod0'], lods[uid]['1']['tris'], lods[uid]['2']['tris']]
    for lv, suf in enumerate(['', '_lod1', '_lod2']):
        p = SH / f'unit_{uid}{suf}.png'; x = x0 + lv * (CW + 2); y = y0 + LH
        if p.exists():
            im = Image.open(p).convert('RGB'); w, h = im.size; cx, cy = w // 2 + 60, h // 2   # the side panel covers the left; units are framed at the centre
            s = 0.62; cw, chh = int(CW / s), int(CH / s); crop = im.crop((cx - cw // 2, cy - chh // 2, cx + cw // 2, cy + chh // 2)).resize((CW, CH), Image.LANCZOS)
            sheet.paste(crop, (x, y))
        else: d.rectangle([x, y, x + CW, y + CH], outline=(120, 60, 60))
        d.text((x + 6, y + CH + 3), f"LOD{lv} · {tri[lv]:,} tris", font=f(13), fill=(160, 170, 185))
out = ROOT / 'preview' / 'lod_sheet.png'; sheet.save(out, optimize=True); print('wrote', out, sheet.size)
