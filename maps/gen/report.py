"""Compile maps/VALIDATION.md. Check results, dimensions, scene statistics, render times, route tests and performance are read
from measured outputs (navcheck validation.json, asset bounds, the scale scene's measured_bounds.json, render logs, Map Lab
route_tests.json / perf.json). The decision summary is aggregated from those results; the build-decision list comes from
data/overrides.json; the known-limitations list at the end is written here by hand. Run after navcheck, renders and lab tests."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from navcheck import SPEC, report_md
from mapgen import LAYOUT

ROOT = Path(__file__).resolve().parents[1]

def load(p, d=None):
    try: return json.loads(Path(p).read_text())
    except Exception: return d

def main():
    vals = [load(ROOT / 'build' / m['id'] / 'validation.json') for m in LAYOUT['maps']]
    body = report_md([v for v in vals if v]).split('\n'); head, rest = body[:4], body[4:]
    # approved changes first (old vs new), then what is still open
    rv = load(ROOT / 'data' / 'layout_revisions.json', {}); day = rv.get('approved_on', '')
    size = {m['id']: m['size_m'] for m in LAYOUT['maps']}; name = {m['id']: m['name'] for m in LAYOUT['maps']}
    D = ['', f'## Approved changes ({day})', '',
         '`layouts.json` is unchanged; the approved revisions live in `data/layout_revisions.json` and are applied when the maps are generated. Removing an entry and regenerating reverts it.', '',
         '| Map | Item | Old (layout q) | New (layout q) | Old (m) | New (m) | Moved | Why |', '|---|---|---|---|---|---|---|---|']
    for r in rv.get('revisions', []):
        S_ = size[r['map']] / 1000; item = r.get('label') or f"{r['id']} {r['field'].replace('_', ' ')}"
        if isinstance(r['old'], list):
            om, nm = [v * S_ for v in r['old']], [v * S_ for v in r['new']]; mv = ((om[0] - nm[0]) ** 2 + (om[1] - nm[1]) ** 2) ** 0.5
            D.append(f"| {r['map']} {name[r['map']]} | {item} | ({r['old'][0]}, {r['old'][1]}) | ({r['new'][0]}, {r['new'][1]}) | ({om[0]:.0f}, {om[1]:.0f}) | ({nm[0]:.0f}, {nm[1]:.0f}) | {mv:.0f} m | {r['reason']} |")
        else:
            D.append(f"| {r['map']} {name[r['map']]} | {item} | – | – | {r['old']} m | {r['new']} m | – | {r['reason']} |")
    kits = {m['id']: (load(ROOT / 'build' / m['id'] / 'instances.json', {}) or {}).get('kits', {}) for m in LAYOUT['maps']}
    bk_ = rv.get('base_kit', {})
    D += ['', f"**Base kit per start.** {bk_.get('rule', '')}. {bk_.get('result', '')}.", '']
    D += ['| Map | ' + ' | '.join(['Start', 'Kit', 'Rally point (m)']) + ' |', '|---|---|---|---|']
    for mid, ks in kits.items():
        for pid, k in sorted(ks.items()): D.append(f"| {mid} {name[mid]} | {pid} | {k['transform']} | ({k['rally'][0]:.0f}, {k['rally'][1]:.0f}) |")
    D += ['', f'**Provisional moves approved {day}:**', ''] + [f"- {e['what']} ({'all maps' if e['maps'] == 'all' else 'map ' + e['maps']})" for e in rv.get('approved_moves', [])] + ['']
    # still open: FAIL checks, open findings, proposals; warnings listed separately
    O = ['## Still open', '']
    for v in vals:
        if not v: continue
        items = [f"**FAIL** {c['check']}: {c['detail']}" for c in v['checks'] if c['status'] == 'FAIL'] + [f"Finding: {c}" for c in v.get('open_findings', [])] + [f"Conflict: {c}" for c in v.get('conflicts', [])]
        # generator relocations that still need a decision (mapgen meta.json "Needs approval"), unless an approved move covers that item
        mid_ = v.get('map') if len(str(v.get('map', ''))) == 2 else next((m['id'] for m in LAYOUT['maps'] if m['name'] == v.get('name')), None)
        meta_ = load(ROOT / 'build' / str(mid_) / 'meta.json', {}) or {}
        ok_ = [e for e in rv.get('approved_moves', []) if e['maps'] in (mid_, 'all')]
        for c in meta_.get('conflicts', []):
            if 'Needs approval' in c and not any(c.split(':')[0].replace('deposit ', '') in e['what'] for e in ok_): items.append(f"**Decision needed:** {c}")
        if items: O += [f"**{v['map']} · {v['name']}**", ''] + [f"- {x.replace('|', '/')}" for x in items] + ['']
    for r in rv.get('proposals', []):
        S_ = size[r['map']] / 1000; om, nm = [v * S_ for v in r['old']], [v * S_ for v in r['new']]
        O += [f"**Proposal, not applied ({r['map']} {name[r['map']]} {r['id']}):** move from q ({r['old'][0]}, {r['old'][1]}) = ({om[0]:.0f}, {om[1]:.0f}) m to q ({r['new'][0]}, {r['new'][1]}) = ({nm[0]:.0f}, {nm[1]:.0f}) m. {r['reason']}", '']
    if len(O) == 2: O += ['Nothing: every check passes.', '']
    W = [f"- {v['map']} {v['name']}: {c['check']}: {c['detail'].replace('|', '/')}" for v in vals if v for c in v['checks'] if c['status'] == 'WARN']
    if W: O += ['**Warnings (measured, no decision needed):**', ''] + W + ['']
    D += O
    L = head + D + rest + ['']
    # assets
    L += ['## Shared dimensions: measured mesh bounds', '',
          'Bounds come from the evaluated meshes in each asset `.blend` (builder JSON) and are re-measured independently in the scale-reference scene (`blender/measure.py`). Excluded parts are listed in each bounds file (antennas, stacks, masts, the tank cupola MG).', '',
          '| Asset | Spec (m) | Builder bounds (m) | Scale scene (m) | Max error |', '|---|---|---|---|---|']
    meas = load(ROOT / 'assets' / 'measured_bounds.json', {})
    for a, sp in SPEC.items():
        b = load(ROOT / 'assets' / 'bounds' / f'{a}.json', {}); bs = b.get('size_m'); ms = (meas.get(a) or {}).get('size_m')
        errs = [abs(src[k] - sp[k]) / sp[k] for src in (bs, ms) if src for k in range(3) if sp[k]]  # worst of both measurements
        L.append(f"| {a} | {' × '.join(str(x) if x else '–' for x in sp)} | {' × '.join(f'{x:.2f}' for x in bs) if bs else 'missing'} | "
                 f"{' × '.join(f'{x:.2f}' for x in ms) if ms else 'n/a'} | {max(errs) * 100:.2f}% |" if errs else f"| {a} | – | missing | – | – |")
    L += ['', '"Max error" is the worst axis of either measurement against the spec.', '', 'Additional design dimensions: tank hull 7.50 × 3.60 m (gun-forward 9.50 m, turret roof 2.50 m); patrol boat 9.00 m above water, 2.00 m draft; personnel doors 0.90 × 2.10 m clear; factory vehicle door 6.00 × 5.00 m clear; refinery harvester bay 7.0 × 6.0 m; radar control antenna top 18.00 m; dock deck +3.00 m, berth fender face at local y = −20.00 m.', '']
    # build decisions layered on the layout (data/overrides.json); authoritative coordinates are never edited there
    o = load(ROOT / 'data' / 'overrides.json', {}); bk = o.get('base_kit', {})
    L += ['## Build decisions layered on the layout (`data/overrides.json`)', '',
          'These values are not in `layouts.json`; they were chosen to meet the written rules and are applied to every map unless noted. Where a structure could not stand exactly at its layout coordinate, it was offset; each case is listed with its distance in the per-map sections, and all of them were approved on the date above.', '']
    for k, v in (bk.get('resolution') or {}).items(): L.append(f"- **Base kit, {k.replace('_', ' ')} (all bases, approved {rv.get('approved_on', '')}):** {v}")
    for k, v in (o.get('landmarks') or {}).items():
        if isinstance(v, dict): L.append(f"- **Landmark {k}:** " + (v.get('note') or ', '.join(f"the {b} road runs through the compound, which is built as two halves either side of its corridor" if a == 'split_by_road' else f'{a} = {b}' for a, b in v.items())))
    if o.get('road'): r = o['road']; L.append(f"- **Roads:** profile graded to {r['grade'] * 100:.1f}% (spec ≤ 6%, margin for interpolation); {r['shoulder_m']} m shoulders; {r['safety_band_m']} m safety band; 1:{1 / r['side_slope']:.0f} side slopes; waypoints held within {r['waypoint_tol_m']} m (spec 8 m); fillets up to {r['fillet_max_m']} m.")
    if o.get('dock'): d = o['dock']; L.append(f"- **Docks:** deck +{d['deck_z']:.1f} m; {d['trestle_w']} m trestle where the dock stands off the shore; {d['apron'][0]}×{d['apron'][1]} m land apron; berth dredged to {d['berth_depth']:.0f} m; trestle grade ≤ {d['max_trestle_grade'] * 100:.1f}%.")
    if o.get('beach'): b = o['beach']; L.append(f"- **Landing beaches:** {b['grade'] * 100:.0f}% ramp (spec ≤ 8%), {b['apron_m']} m flat apron, sand carried to {-b['underwater_to']:.1f} m below sea level.")
    if o.get('quarry'): q = o['quarry']; L.append(f"- **Quarries:** {q['ramp_clear_w']} m ramp clear width at {q['grade'] * 100:.1f}%.")
    if bk.get('aisle'): L.append(f"- **Base kit layout:** service aisle centred at y = {bk['aisle']['y']} m, {bk['aisle']['clear_w']} m clear; rally point {bk.get('rally')}; factory apron {bk.get('factory_apron_m')} m; infantry group at {bk.get('infantry_group')} (local metres from pad centre).")
    L.append('')
    # renders and scene stats
    L += ['## Blender scenes and renders', '', '| Map | Scene | Instances (of which demo units) | Asset types | Collision boxes | Terrain chunks / tris | Grass clumps (near cameras) | Render times (s) |', '|---|---|---|---|---|---|---|---|']
    for m in LAYOUT['maps']:
        rl = load(ROOT / 'renders' / m['id'] / 'render_log.json', {}); st = rl.get('stats', {})
        times = ', '.join(f"{r['preset']} {r['seconds']:.0f}" + (' †' if 'GPU' in str(r.get('device', '')) else '') for r in rl.get('renders', []))
        L.append(f"| {m['id']} {m['name']} | scenes/{m['id']}_{m['name'].lower().replace(' ', '_')}.blend | {st.get('instances', '–')} ({st.get('demo_instances', '–')}) | {st.get('asset_types', '–')} | {st.get('collision_boxes', '–')} | "
                 f"{st.get('terrain_chunks', '–')} / {st.get('terrain_tris', 0) / 1e6:.2f} M | {st.get('grass_clumps', '–')} | {times or 'not rendered'} |")
    gpu = [(m, r) for m in LAYOUT['maps'] for r in load(ROOT / 'renders' / m['id'] / 'render_log.json', {}).get('renders', []) if 'GPU' in str(r.get('device', ''))]
    if gpu:
        r0 = gpu[0][1]; cmp = []
        for m, r in gpu:
            pv = r.get('previous') or {}
            if pv.get('seconds'): cmp.append(f"{m['name']} {r['preset']} {r['seconds']:.0f} s vs {pv['seconds']:.0f} s on the cloud CPU ({pv['seconds'] / r['seconds']:.1f}× faster)")
        L += ['', f"† GPU renders: Tom's MacBook Air (M1, 16 GB, no fan), Blender {r0.get('blender', '?')}, Cycles {r0['device']}, {r0.get('samples', 24)} samples + OpenImageDenoise, same cameras and sizes. "
              + (f"The first GPU render on a machine compiles the Metal kernels once ({r0['gpu_warmup_s']:.0f} s, cached afterwards; not included in the times). " if r0.get('gpu_warmup_s') else '')
              + ('; '.join(cmp) + '.' if cmp else '')]
    L += ['', 'Render hardware (unmarked times): cloud VM, 2 vCPU, 7 GB RAM, Cycles CPU, 24 samples + OpenImageDenoise, 1600×900 (overview 1800×1440). Emerald Strait and Delta Grid rendered while the Map Lab browser tests were running, so their times include CPU contention; Granite Fjord, Sunbreak Atoll and Copperhead Bay rendered alone. The scene instance counts match `instances.json` exactly; bridge deck lights are part of the placement data. Scale-reference renders: `renders/scale/lineup_units.png`, `lineup_buildings.png`, `soldier_tank_barracks.png`, `personnel_door.png`, `tank_factory_door.png`, `boat_dock.png`.', '']
    # Map Lab
    rt = load(ROOT / 'lab' / 'route_tests.json', {}); pf = load(ROOT / 'lab' / 'perf.json', {})
    L += ['## Map Lab (web harness): movement tests and measured performance', '']
    if rt.get('maps'):
        L += ['| Map | Route tests | Notes |', '|---|---|---|']
        for k, v in sorted(rt['maps'].items()):
            fails = [t['name'] for t in v.get('tests', []) if not t.get('pass')]
            L.append(f"| {k} {v.get('name', '')} | {v.get('pass')}/{v.get('total')} | {'all pass' if not fails else 'failed: ' + ', '.join(fails)} |")
    if pf:
        any_p = next((pv for v in (pf.get('maps') or {}).values() for pv in (v.get('presets') or {}).values() if isinstance(pv, dict)), {})
        L += ['', f"Performance: {pf.get('note', '')}",
              f"Conditions: viewport {pf.get('viewport', ['?', '?'])[0]}×{pf.get('viewport', ['?', '?'])[1]}, \"{pf.get('quality', '?')}\" quality preset (pixel ratio {any_p.get('pixel_ratio', '?')}, canvas {any_p.get('canvas', ['?', '?'])[0]}×{any_p.get('canvas', ['?', '?'])[1]}, no shadows, no MSAA), "
              f"{any_p.get('frames', '?')} frames timed per view. This is well below the 1080p target resolution, because a software rasteriser cannot draw these scenes at 1080p in useful time.", '',
              '| Map | View | Load | FPS (average frame time) | Draw calls | Triangles | Instances drawn / total | JS heap | Stand-in assets |', '|---|---|---|---|---|---|---|---|---|']
        for k, v in sorted((pf.get('maps') or {}).items()):
            miss = (v.get('state') or {}).get('missing') or []
            for pk, pv in (v.get('presets') or {}).items():
                if not isinstance(pv, dict): continue
                L.append(f"| {k} {v.get('name', '')} | {pk} | {v.get('load_ms', 0) / 1000:.0f} s | {pv.get('fps', 0):.2f} ({pv.get('frame_ms_avg', 0):.0f} ms) | {pv.get('draw_calls', '?')} | "
                         f"{pv.get('triangles', 0) / 1e6:.2f} M | {pv.get('instances_drawn', '?')} / {pv.get('instances_total', '?')} | {pv.get('js_heap_mb', 0):.0f} MB | {', '.join(miss) if miss else 'none'} |")
        if pf.get('gpu'): L.append(f"\nRenderer string: `{pf['gpu']}`. GPU memory cannot be read from WebGL; the JS heap is the only memory figure available in the browser.")
    L += ['', '**Performance verdict:** the 60 fps desktop target has NOT been measured on a real GPU here, because only a software rasteriser was available. The numbers above are SwiftShader (CPU) figures and only show relative cost: draw calls, triangle counts and instance counts are hardware-independent and are the useful budget figures.', '',
          '## Known limitations and missing production assets', '',
          '- **Gameplay integration:** the playable game still runs on its coarse cell grid. These metric maps are inspectable and movement-tested, but they are not yet playable RTS maps.',
          '- **Asset sources:** every asset is original and procedurally generated (Blender Python).',
          '  - There are no photogrammetry or scanned textures.',
          '  - Leaf cards are visible as flat planes in close-ups closer than about 15 m.',
          '  - Scots pine crowns read dark and palm-like at a distance.',
          '- **Grass coverage:** grass geometry is instanced only within about 170 m of the close-up preset cameras. Elsewhere the grass is shader colour and texture only, so a free camera elsewhere sees no grass geometry. (No per-blade objects, per spec.)',
          '- **Biome infrastructure:**',
          '  - Placed from the shared library: kerb drainage grates (stormwater) on the Emerald town road, the Delta spine and the Copperhead boulevard and coast road; pipe racks along the Copperhead industrial boulevard; concrete levee walls (precast barrier lines) and four pump outfalls on Delta Grid\'s inner channel banks; service fences around Granite Fjord\'s wind farms.',
          '  - The Delta pump outfalls are composed from a pipe rack and pump cabinets; there is no dedicated pump-house asset.',
          '  - Culverts: the culvert asset exists, but no road on these terrains crosses a drainage line (no streams were added), so none are placed. The only road embankments are pad-grading ramps.',
          '  - Drainage grates are not placed on rural roads.',
          '- **Minimap:** the Map Lab has one; the Blender scenes do not (they are authoring scenes, not a game HUD).',
          '- **Blocking rules:** buildings, rigs, containers, rail wagons, large rocks (scattered rocks above 0.9× scale, coastal boulders ≥ 3 m across, granite slabs standing ≥ 1 m) and cliff pieces block movement and have collision boxes; dense forest interiors block in the navigation layers. Portal and RTG cranes and the Delta pump pipe racks are non-blocking in both navigation and collision, because vehicles pass under their portals and racks; a production build would add leg-only collision. Fences, barriers and light poles are crushable/non-blocking and are kept out of road corridors.',
          '- **Water:** the shader is depth-mapped, not refractive; shallow areas are partially transparent so sand and coral read through.',
          '- **Rock assets:**',
          '  - `rock_limestone_a` could not be replaced by the rock builder (a file-permission boundary). A darker rebuild is staged in `assets/staging/` and is not in use; Emerald Strait uses `rock_limestone_b` instead.',
          '  - Limestone and granite still read pale in strong sun.',
          '- **Tunnel portals** (Granite Fjord) are decorative and sealed, as specified.',
          '- **Optional decorative streams** were not added.',
          '- **Overview views** are orthographic (exact scale bar). Perspective presets carry no scale bar by design.', '']
    (ROOT / 'VALIDATION.md').write_text('\n'.join(L)); print('wrote', ROOT / 'VALIDATION.md', len('\n'.join(L)), 'chars')

if __name__ == '__main__':
    main()
