"""renders/contact_sheet.png — every map × every camera preset on one sheet (thumbnails of the real renders)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PRESETS = [('1_overview', 'Overview'), ('2_gameplay', 'Gameplay'), ('3_base', 'Base close-up'), ('4_harbor', 'Harbour close-up'), ('5_detail', 'Biome detail')]
CW, CH, PAD, LW, TOP = 440, 270, 10, 230, 96

def font(sz, bold=False):
    for f in (f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",):
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()

def main():
    maps = json.loads((ROOT / 'data' / 'layouts.json').read_text())['maps']
    W = LW + len(PRESETS) * (CW + PAD) + PAD; H = TOP + len(maps) * (CH + PAD) + PAD
    sheet = Image.new('RGB', (W, H), (16, 19, 24)); d = ImageDraw.Draw(sheet)
    d.text((PAD + 4, 18), 'Thunderhead — metric map renders (Blender 4.5, Cycles)', font=font(26, True), fill=(235, 238, 242))
    for k, (_, lab) in enumerate(PRESETS):
        d.text((LW + k * (CW + PAD) + 6, TOP - 26), lab, font=font(16, True), fill=(170, 180, 195))
    for r, m in enumerate(maps):
        y = TOP + r * (CH + PAD)
        d.text((PAD + 4, y + 8), m['id'], font=font(18, True), fill=(120, 170, 230)); d.text((PAD + 4, y + 32), m['name'], font=font(19, True), fill=(235, 238, 242))
        d.text((PAD + 4, y + 62), f"{m['size_m']} × {m['size_m']} m", font=font(15), fill=(160, 170, 185))
        d.text((PAD + 4, y + 82), f"{m['mode']} · seed {m['seed']}", font=font(15), fill=(160, 170, 185))
        for k, (key, _) in enumerate(PRESETS):
            x = LW + k * (CW + PAD); p = ROOT / 'renders' / m['id'] / f'preset_{key}.png'
            if not p.exists():
                d.rectangle([x, y, x + CW, y + CH], outline=(90, 40, 40)); d.text((x + 12, y + 12), 'not rendered', font=font(15), fill=(220, 120, 120)); continue
            im = Image.open(p).convert('RGB')
            if key == '1_overview':  # whole map, letterboxed, so nothing is cropped from the survey view
                s = min(CW / im.width, CH / im.height); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
                d.rectangle([x, y, x + CW, y + CH], fill=(10, 12, 16)); sheet.paste(im, (x + (CW - im.width) // 2, y + (CH - im.height) // 2)); continue
            s = max(CW / im.width, CH / im.height)  # cover-crop to the cell
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
            ox, oy = (im.width - CW) // 2, (im.height - CH) // 2; sheet.paste(im.crop((ox, oy, ox + CW, oy + CH)), (x, y))
    out = ROOT / 'renders' / 'contact_sheet.png'; sheet.save(out, optimize=True); print('wrote', out, sheet.size)

if __name__ == '__main__':
    main()
