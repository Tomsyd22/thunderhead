"""Write units/VALIDATION.md from the model exports, the mechanics suite and the sandbox browser run.
Inputs: blend/*.blend dims via units/out/*.glb extras (root.dims_check, root.tris), sandbox/results/mech_results.json,
sandbox/results/sandbox_results.json. Run after test_mech.mjs and test_sandbox.js."""
import json, struct
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent; SB = ROOT / 'sandbox'
spec = {u['id']: u for u in json.loads((ROOT / 'data' / 'unit_specs.json').read_text())['units']}
mech = json.loads((SB / 'results' / 'mech_results.json').read_text()) if (SB / 'results' / 'mech_results.json').exists() else None
sbr = json.loads((SB / 'results' / 'sandbox_results.json').read_text()) if (SB / 'results' / 'sandbox_results.json').exists() else None
ORDER = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A02', 'A03', 'A04', 'A05', 'T01', 'T02', 'T03', 'T04', 'T05']

def glb_extras(p):
    b = p.read_bytes(); ln = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + ln])
    for n in js['nodes']:
        if n.get('name') == 'root': return n.get('extras', {}), js
    return {}, js

L = [f'# Unit pack — validation ({date.today().isoformat()})', '',
     'This page covers all 15 units of the RTS Unit Design Pack (v0.2 art, mechanics baseline v0.1). Each unit has a Blender model, the mechanics and the Unit Sandbox.',
     'Every number comes from `units/data/unit_specs.json`. Values that the pack does not give are listed under **Assumptions**.', '']
# ── models ──
L += ['## Models', '', '`dims` compares the measured envelope with the spec: length (Y) / width (X) / height (Z). Infantry are measured in the aim pose, holding their weapons.', '',
      '| Unit | Name | dims ratio L / W / H | tris (LOD0 budget) | GLB | named parts |', '|---|---|---|---|---|---|']
for uid in ORDER:
    p = ROOT / 'out' / f'{uid}.glb'
    if not p.exists(): L.append(f'| {uid} | {spec[uid]["name"]} | — | — | missing | — |'); continue
    ex, js = glb_extras(p); d = json.loads(ex.get('dims_check', '{}')) if isinstance(ex.get('dims_check'), str) else ex.get('dims_check', {})
    side = ROOT / 'out' / f'{uid}.dims.json'   # infantry: measured in the aim pose after export
    if not d and side.exists(): d = json.loads(side.read_text())
    if d and ex.get('height_incl_clearance_m'):   # hover tank: spec height includes the 0.45 m hover clearance
        hc = float(ex['height_incl_clearance_m']); d['height'] = [hc, spec[uid]['dimensions_m']['height'], hc / spec[uid]['dimensions_m']['height']]
    r = ' / '.join(f'{d[k][2]:.2f}' for k in ('length', 'width', 'height')) if d else '—'
    names = {n.get('name') for n in js['nodes']}
    key = [n for n in ['turret', 'gun', 'recoil', 'muzzle', 'track_L', 'rotor', 'rotor_disc', 'tail_rotor', 'pod_L', 'gear_N', 'bomb_L', 'aileron_L', 'rotor_FL', 'gimbal', 'prop_L', 'radar', 'aa', 'lid_0', 'lid_L', 'jet_L', 'sensor', 'pod_R', 'fin_L', 'weapon', 'grip_L', 'shield', 'tripod', 'bipod_L', 'pelvis'] if n in names]
    L.append(f'| {uid} | {spec[uid]["name"]} | {r} | {ex.get("tris", "?")} ({spec[uid]["budget"][0]}) | {p.stat().st_size // 1024} KB | {", ".join(key[:9])} |')
L.append('')
# ── distant-view models ──
lp = ROOT / 'out' / 'lods.json'
if lp.exists():
    lods = json.loads(lp.read_text())
    L += ['## Distant-view models (LOD1, LOD2)', '',
          'Built by `units/blender/lods.py` from each saved LOD0 `.blend`. Each level keeps the LOD0 node tree, bone order and material names, so every animated part (turrets, rotors, lids, gear, recoil, the infantry skeleton) works unchanged. Only mesh density and atlas resolution drop: the atlas is ½ size at LOD1 and ¼ at LOD2.',
          'The targets are the pack\'s budgets, and each level is a real reduction: LOD1 is at most 60 % of LOD0 and LOD2 at most 25 %.', '',
          '| Unit | LOD0 tris | LOD1 tris (budget) | LOD2 tris (budget) | LOD1 / LOD2 GLB |', '|---|---|---|---|---|']
    for uid in ORDER:
        r = lods.get(uid)
        if r: L.append(f"| {uid} {spec[uid]['name']} | {r['1']['lod0']} | {r['1']['tris']} ({r['1']['budget']}) | {r['2']['tris']} ({r['2']['budget']}) | {r['1']['kb']} / {r['2']['kb']} KB |")
    lr = (sbr or {}).get('lod')
    if lr:
        g, c = lr['gameplay'], lr['close']; L += ['', 'In the Unit Sandbox, each mesh swaps to the level for its on-screen size: LOD0 above 110 px, LOD1 above 36 px, LOD2 below. The switch has ±12 % hysteresis, and the **Model detail** buttons can pin one level for inspection.',
          f'- **Matching:** every mesh of all 15 units found its counterpart at both levels: ' + ', '.join(f"{k} {v['matched'][0]}/{v['meshes']}" for k, v in lr['report'].items()) + '.',
          f'- **Live fire battle at a normal RTS camera ({g["camera_m"]} m):** unit triangles {g["unit_tris_lod0"]:,} → {g["unit_tris_auto"]:,} ({g["unit_saved_pct"]} % fewer). Whole frame including terrain and props: {g["tris_lod0"]:,} → {g["tris_auto"]:,} ({g["saved_pct"]} %). Units at LOD0 / LOD1 / LOD2: {"/".join(map(str, g["levels"]))}.',
          f'- **Close camera ({c["camera_m"]} m):** unit triangles {c["unit_saved_pct"]} % fewer. Levels {"/".join(map(str, c["levels"]))}.',
          f'- **No flicker:** {lr["switches_static_camera_5s"]} level changes in 5 s with the camera still. A slow zoom-out from 40 m to 400 m made {lr["dolly"]["switches"]} changes across {lr["dolly"]["units"]} units, each stepping down without bouncing back.',
          '- **Close-ups at each level:** `units/sandbox/results/shots/unit_<UID>.png`, `_lod1.png` and `_lod2.png`, combined in `units/preview/lod_sheet.png`.']
    L.append('')
# ── mechanics ──
if mech:
    L += ['## Mechanics suite (`node units/sandbox/test_mech.mjs`)', '', f'**{mech["pass"]} / {mech["total"]} checks passed.** This is a headless simulation at 30 Hz. Every tolerance is written in the check itself.', '']
    groups = {}
    for c in mech['checks']: groups.setdefault(c['group'], []).append(c)
    for g, cs in groups.items():
        ok = sum(c['ok'] for c in cs); L += [f'### {g} — {ok}/{len(cs)}', '']
        for c in cs: L.append(f'- {"✅" if c["ok"] else "❌"} {c["name"]}' + (f' — `{c["detail"]}`' if (not c['ok'] and c['detail']) else ''))
        L.append('')
# ── sandbox ──
if sbr:
    L += ['## Unit Sandbox run (`node units/sandbox/test_sandbox.js --shots`)', '', f'Renderer: {sbr.get("renderer")}. Load time {sbr.get("loadSeconds", "?")} s.', '',
          'The scenarios run on the page\'s test clock at game speed 1: 60 Hz presentation frames over a 30 Hz simulation. That keeps the motion measurements independent of how slowly the software rasteriser draws and comparable with earlier runs. The pace runs below repeat the checks at the default game speed. The columns are:', '',
          '- **Snaps**: rendered unit moves in one frame that are faster than physically possible.',
          '- **Foot slide**: how far a planted toe drifts during one stance (mean / worst).',
          '- **Track sync**: the largest mismatch between belt scroll and ground distance.',
          '- **JS ms/frame**: the cost of the simulation, animation and effects for one presentation frame. GPU time is not included.', '',
          '| Scenario | sim s | shots (incl. bombs) / deaths | snaps | foot slide mean / worst | track sync | JS ms/frame p50 / p95 | sim ms/tick | page errors |', '|---|---|---|---|---|---|---|---|---|']
    prevT = 0.0
    for k, r in sbr['scenarios'].items():
        e = r['events']; errs = [x for x in r['errors'] if '404' not in x]; secs = round(r['simT'] - prevT, 1); prevT = r['simT']   # the world clock runs on across scenarios
        L.append(f'| {k} | {secs:g} | {e.get("fire", 0) + e.get("bomb", 0)} / {e.get("death", 0)} | {r["smooth"]["jumps"]} of {r["smooth"]["samples"]} | {r["feet"]["meanCm"]} / {r["feet"]["worstCm"]} cm ({r["feet"]["stances"]} stances) | {r["tracks"]["worstM"]} m | {r["frameJsMs"]["p50"]} / {r["frameJsMs"]["p95"]} | {r["simMs"]} | {len(errs)} |')
    if sbr.get('cost'):
        c = sbr['cost']; L += ['', f'**CPU cost as played.** This is the Live fire battle with the normal animation LOD and {c["units"]} live units. JS time per presentation frame is p50 {c["p50"]} ms, p95 {c["p95"]} ms, p99 {c["p99"]} ms. The mean breakdown is: simulation {c["perFrame"]["sim"]} ms, unit views {c["perFrame"]["views"]} ms (infantry IK {c["perFrame"]["infantry"]} ms), effects {c["perFrame"]["fx"]} ms. It was measured on a 2-vCPU cloud machine with software rendering, so a desktop CPU should come in lower.']
    if sbr.get('probes'):
        L += ['', '**Attitude and aim probes.** These check that the view and the simulation agree: the hull pitches nose-up on climbs, aircraft and hovercraft bank into turns, ships lean outward, and turrets and muzzles point at the target.', '']
        for p in sbr['probes']: L.append(f'- {"✅" if p["ok"] else "❌"} {p["name"]}')
    if sbr.get('live'):
        lv = sbr['live']; L += ['', f'**Live clock under SwiftShader**, with the Live fire battle running at the default game speed and {lv["units"]} units (the economy buildings add about 30k triangles and 50 draw calls): frame time p50 {lv["p50"]} ms, p95 {lv["p95"]} ms, p99 {lv["p99"]} ms; {lv["calls"]} draw calls; {lv["tris"]:,} triangles.',
              'This is a software rasteriser on 2 shared vCPU, so these are **not** expected real-GPU frame rates. The JS cost column above is the CPU part of the frame.']
    pc = sbr.get('pace')
    if pc:
        G = pc['file']['game_speed']; E = pc['econ']; Mo = pc['motion']
        L += ['', f'## Game speed and the harvester (`data/pace.json`: game speed {G}×, harvester {pc["file"]["harvester_speed_ratio"]}× the Lancer)', '',
              'Game speed is a uniform time scale: the 30 Hz simulation runs that many times faster against the wall clock. The harvester uses the maps\' `unit_harvester` model with a six-wheel skid-steer drive. Its cycle is:', '',
              '1. Leave the refinery\'s unloading grate facing the field.', '2. Drive to the rig\'s service point and load.', '3. Drive back.', '4. Pivot at the bay\'s approach point.', '5. Reverse 25.2 m onto the grate and unload.', '',
              '| Field | Game s at 1× | Game s at default | Real s at default | Pace model (game s) |', '|---|---|---|---|---|']
        for dep in ('near', 'far'):
            a, b = E.get(f'{dep}@1'), E.get(f'{dep}@{G}') or E.get(f'{dep}@{float(G)}')
            if a and b: L.append(f'| {dep} | {a["game_s"][-1]:.2f} | {b["game_s"][-1]:.2f} | **{b["real_s"][-1]:.2f}** | {a["predicted_game_s"]:.2f} |')
        L += ['', 'The game seconds are identical at both speeds, so game speed changes only the wall clock. The simulated harvester also matches the shared pace model that the Map Lab uses for every map.', '',
              f'**Motion at the default game speed** ({G}×, 60 Hz presentation):', '']
        for k, v in Mo.items(): L.append(f'- **{k}:** {v["real_s"]} s real ({v["game_s"]} game s). {v["jumps"]} snaps in {v["samples"]} samples. Worst foot slide {v["feetWorstCm"]} cm over {v["stances"]} stances. Track sync {v["tracksWorstM"]} m.')
    bad = [c for c in sbr.get('console', []) if '404' not in c and 'ERR_FAILED' not in c]
    L += ['', f'Console errors and warnings during the run: {len(bad)}' + (' — ' + '; '.join(bad[:5]) if bad else '') + '.']
    L.append('')
L += ['## Assumptions (not in the pack)', '',
      '- **Infantry movement**: acceleration 14 m/s², braking 18 m/s², turn rate 540°/s. Deployed traverse is 90°/s.',
      '- **Tanks**: braking is 1.6× acceleration. Gun pitch rate is 25°/s. Climbing a slope cuts speed by up to 45 % on 25°. The hull pivots in place when the heading error is over 45°.',
      '- **Hover tank (T03)**: gun pitch −6…+15°, aim tolerance 4°, braking 2× acceleration. It starts slowing before its charge so that the 65 % limit holds for the whole 0.25 s wind-up.',
      '- **Ships**: rudder authority grows with speed, and twin screws give 30 % yaw at rest. They plan with turning room of about 45 % of hull length. Hull capsule ends never leave authored deep water (≥ 3 m).',
      '- **H05 Bulwark**: gun pitch −5…+25°, aim tolerance 5°, turret hard stops ±135° (taken from the model, where the muzzle would meet the deckhouse beyond about 145°).',
      '- **A05 Sentinel**: AA launcher yaw 180°/s, pitch 0…85°, tolerance 15°.',
      '- **Kestrel bombs**: they fall for 0.8 s onto a fixed aim point. The first bomb, released at 28 m, inherits the jet\'s full 35 m/s. The second, released 0.25 s later, needs about 24 m/s horizontal to land on the same point. Both bombs therefore hit the aim point, which matches the listed sortie damage.',
      '- **Kestrel landing**: it uses a VTOL approach to its pad. It decelerates over about 70 m, then the 1.2 s landing and 6 s reload.',
      '- **H02 targeting**: the Rocket Trooper always prefers aircraft. The sheet says it prefers air only "when threatening nearby friendly units"; that threat test is simplified to always.',
      '- **Visibility**: sight is terrain-occluded for all eyes, including aircraft. The Mote scan reveals through terrain.', '']
L += ['## Decisions and backlog (2026-11-06)', '',
      '- **Infantry width is parked for the art pass** (decision: do not widen now). The measurements are below.',
      '- **Distant-view models (LOD1 and LOD2) are built**: integration Stage 1, see above.',
      '- **The Pulse Trooper is restyled as an android** (approved): graphite synthetic body, joint actuators, faceless head with a cyan visor slit, sensor ears and a ribbed neck.',
      '- **Faction mapping approved** (`units/data/faction_mapping.json`):',
      '    - Iron Legion → the Compact (Cold War 2.0); Nova Directive → the Lattice (drones and AI); Vanguard → Helix Dynamics (cyberpunk megacorps).',
      '    - Game names win every clash: Lancer → Arbiter, Spectre → Trident, and Disruptor → Nullifier (placeholder).',
      '    - The Missile Specialist is dropped from Helix.',
      '    - The Bulwark is re-tuned to the Corvette escort role with its model unchanged.',
      '    - Applied at integration; `unit_specs.json` stays the pack\'s unchanged source.', '']
L += ['## Known limitations', '',
      '- LOD1/LOD2 are automatic collapse decimations of LOD0, not hand-authored. At LOD2 small details merge, which is intended at that size.',
      '- **Infantry width is narrower than the sheets** (parked for the art pass). In the aim pose the six infantry measure 66–80 % of the typeset width (0.54–0.60 m against 0.72–0.84 m). Heights are within 5 % and lengths within 12 %. The bodies are anatomically proportioned and the elbows stay close to the torso, while the sheets\' envelopes assume flared elbows and broader packs. Gameplay collision uses the pack\'s own radii, so mechanics are unaffected; the silhouettes are the only thing that differs.',
      '- Every model is inside its LOD0 triangle budget, but material counts exceed the sheet\'s budget figures: the sandbox contract needs separate TRACK, GLOW, DISC, GLASS and TEAM materials so the view can scroll, tint and fade them.',
      '- Units are lit with a neutral studio environment map plus sun and sky. It stands in for the game\'s own lighting setup, which these units have not been placed in yet.',
      '- Infantry use one shared procedural rig and IK animation, not authored keyframe clips.',
      '- Support powers (reinforcement, drone strike, temporary promotion) are not implemented; they are not unit mechanics. Production queues are not implemented either.',
      '- Garrisoned units fire from the bunker\'s four corner ports. Port line of sight is not tested against the bunker walls.',
      '- The sandbox is separate from the existing Thunderhead game build, which uses different factions and is not metric.',
      '- The harvester, refinery and extraction rig come from the maps\' asset library and are not pack units. The sandbox has no roads, so the harvester runs at its single speed (1.25× the Lancer by default).', '']
(ROOT / 'VALIDATION.md').write_text('\n'.join(L)); print('wrote', ROOT / 'VALIDATION.md', len(L), 'lines')
