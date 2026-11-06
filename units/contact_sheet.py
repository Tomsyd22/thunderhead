"""units/preview/contact_sheet.png — the hero render of every unit, with its spec dimensions, on one sheet."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
spec = {u['id']: u for u in json.loads((ROOT / 'data' / 'unit_specs.json').read_text())['units']}
ORDER = [['H01', 'H02', 'H03', 'H04', 'H05'], ['A01', 'A02', 'A03', 'A04', 'A05'], ['T01', 'T02', 'T03', 'T04', 'T05']]
FACT = {'H': ('IRON LEGION', (183, 71, 63)), 'A': ('VANGUARD ALLIANCE', (50, 117, 181)), 'T': ('NOVA DIRECTIVE', (19, 127, 128))}
CW, CH, PAD, TOP, LH = 480, 360, 10, 70, 46
f = lambda s, b=False: ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if b else ''}.ttf", s)
W = PAD + 5 * (CW + PAD); H = TOP + 3 * (CH + LH + PAD) + PAD
sheet = Image.new('RGB', (W, H), (22, 25, 30)); d = ImageDraw.Draw(sheet)
d.text((PAD + 4, 18), 'Thunderhead — the 15-unit design pack, built at metric scale (Blender 4.5, Cycles previews)', font=f(26, True), fill=(235, 238, 242))
for r, row in enumerate(ORDER):
    y = TOP + r * (CH + LH + PAD)
    for c, uid in enumerate(row):
        x = PAD + c * (CW + PAD); p = ROOT / 'preview' / f'{uid}_hero.png'
        if p.exists():
            im = Image.open(p).convert('RGB'); s = max(CW / im.width, CH / im.height); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
            ox, oy = (im.width - CW) // 2, (im.height - CH) // 2; sheet.paste(im.crop((ox, oy, ox + CW, oy + CH)), (x, y))
        else: d.rectangle([x, y, x + CW, y + CH], outline=(120, 60, 60))
        u = spec[uid]; dm = u['dimensions_m']; name, col = FACT[uid[0]]
        d.rectangle([x, y + CH, x + 6, y + CH + LH - 4], fill=col)
        d.text((x + 14, y + CH + 4), f"{uid}  {u['name']}", font=f(17, True), fill=(235, 238, 242))
        d.text((x + 14, y + CH + 25), f"{u['category']} · {dm['length']} × {dm['width']} × {dm['height']} m · {u['speed_mps']} m/s", font=f(14), fill=(160, 170, 185))
out = ROOT / 'preview' / 'contact_sheet.png'; sheet.save(out, optimize=True); print('wrote', out, sheet.size)
