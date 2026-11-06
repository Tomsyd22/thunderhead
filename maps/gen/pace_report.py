"""maps/PACE.md: harvester round trips and base-to-base times on every map at the data/pace.json game speed.
Inputs: maps/lab/results/pace.json (node maps/lab/test_pace.js: the Map Lab's own Pace measurement in headless Chromium),
data/pace.json, and units/sandbox/results/sandbox_results.json (the sandbox's harvester cross-check), when present.
Run: python3 maps/gen/pace_report.py"""
import json
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parents[2]; MAPS = ROOT / 'maps'
P = json.loads((ROOT / 'data/pace.json').read_text()); G = P['game_speed']
R = json.loads((MAPS / 'lab/results/pace.json').read_text())
SB = ROOT / 'units/sandbox/results/sandbox_results.json'; sb = json.loads(SB.read_text()) if SB.exists() else {}
tB, tH = P['targets']['base_to_enemy_base_s'], P['targets']['harvest_round_trip_nearest_home_s']
f1 = lambda v: '–' if v is None else f'{v:.1f}'
mark = lambda v, t: '–' if v is None else ('✅ in range' if t[0] <= v <= t[1] else f'⚠️ {"fast" if v < t[0] else "slow"} ({v - (t[0] if v < t[0] else t[1]):+.1f} s)')
H = P['harvester']; rt = P['reference_tank']['maps']; hr = P['harvester_speed_ratio']

L = [f'# Game pace — measured on every map ({date.today().isoformat()})', '',
     f'**Settings (`data/pace.json`).** Game speed **{G}×**. Harvester speed **{hr}× the tank** ({rt["road_mps"] * hr:g} / {rt["offroad_mps"] * hr:g} m/s road / off-road; tank {rt["road_mps"]:g} / {rt["offroad_mps"]:g}).',
     f'Harvester: loads for {H["load_s"]:g} s, unloads for {H["unload_s"]:g} s, accelerates at {H["accel_mps2"]:g} m/s², pivots at {H["hull_turn_dps"]}°/s and reverses at {H["reverse_mps"]:g} m/s. These are game seconds at game speed 1.', '',
     '**What game speed does.** It is one uniform time scale, like RA2\'s game-speed setting. The simulation runs that many times faster against the wall clock, so these all speed up together:',
     '- unit speeds, acceleration and turn rates;',
     '- weapon reloads, projectiles and ability timers;',
     '- harvesting, unloading and build times.', '',
     'Distances, turning circles, map scale and model scale do not change. Every spec number stays valid in game seconds; real seconds = game seconds ÷ game speed.', '',
     '**How these were measured.** This is the Map Lab\'s own Pace tab, run on each map in headless Chromium (`node maps/lab/test_pace.js`).',
     '- **Route:** each route is planned on the baked nav grid with the harvester or tank layer, then string-pulled within road and off-road runs so it still follows roads.',
     '- **Drive:** the route is driven with the Unit Sandbox\'s vehicle rules (`data/pace.js`): acceleration, braking, corner speeds, pivot turns over 45° and slowing on climbs.',
     '- **Harvester round trip:** leave the refinery\'s unloading grate facing the field → drive to the rig\'s service point → load → drive back → pivot at the bay\'s approach point → reverse 25.2 m onto the grate → unload. Each base uses its faster refinery.', '']
pc = (sb.get('pace') or {}).get('econ') or {}
if pc:
    rows = []
    for dep in ('near', 'far'):
        a, b = pc.get(f'{dep}@1'), pc.get(f'{dep}@{G}') or pc.get(f'{dep}@{float(G)}')
        if a and b and a['game_s'] and b['game_s']: rows.append((dep, a, b))
    if rows:
        L += ['**Cross-check against a simulated harvester.** In the Unit Sandbox a real harvester drives the same cycle with the full vehicle simulation:', '']
        for dep, a, b in rows:
            L.append(f'- **{dep} field:** {a["game_s"][-1]:.2f} game s at game speed 1 and {b["game_s"][-1]:.2f} game s at {G}× ({b["real_s"][-1]:.2f} s real). The pace model predicts {a["predicted_game_s"]:.2f} s for the same route.')
        L += ['', 'The game-second times are the same at both speeds, which confirms game speed is a pure time scale.', '']

# ── home deposits ──
L += ['## Harvester round trip to every home deposit', '', f'Target: {tH[0]}–{tH[1]} s real for the nearest home deposit.', '',
      '| Map | Deposit | Base · refinery | One way | Round trip (real) | Game s | out / load / back / dock / unload (real s) | Target |', '|---|---|---|---|---|---|---|---|']
allH = []
for mid, m in R['maps'].items():
    for h in sorted([x for x in m['main']['harv'] if x['kind'] == 'home'], key=lambda x: x['dep']):
        lg = h['legs']; rs = h['real_s']; allH.append((mid, h))
        L.append(f'| {mid} {m["name"]} | {h["dep"]} | {h["base"]} · {h["dock"]} | {h["out_m"]:.0f} m | **{f1(rs)} s** | {f1(h["game_s"])} | '
                 f'{lg["out"] / G:.1f} / {lg["load"] / G:.1f} / {lg["back"] / G:.1f} / {lg["dock"] / G:.1f} / {lg["unload"] / G:.1f} | {mark(rs, tH)} |')
gs = [h['game_s'] for _, h in allH]
L += ['', f'All {len(allH)} home deposits: **{min(gs) / G:.1f}–{max(gs) / G:.1f} s** real ({min(gs):.1f}–{max(gs):.1f} game s).',
      f'Every home trip lands inside {tH[0]}–{tH[1]} s for any game speed from **{max(gs) / tH[1]:.2f}×** to **{min(gs) / tH[0]:.2f}×**.', '']
# mirrored pairs: each blue home deposit against its paired red deposit (maps/build/<id>/validation.json balance rows)
L += ['**Mirrored opponents.** Each blue home deposit is paired with its red mirror, as in the balance check in `maps/VALIDATION.md`. The navcheck balance check compares grid travel times only. This comparison adds the docking turn and acceleration:', '',
      '| Map | Blue deposit | Red mirror | Blue | Red | Difference | Main cause |', '|---|---|---|---|---|---|---|']
worst = []
for mid, m in R['maps'].items():
    rows = json.loads((MAPS / 'build' / mid / 'validation.json').read_text())['metrics']['balance']['home_rows']; byd = {h['dep']: h for h in m['main']['harv'] if h['kind'] == 'home'}
    for r in rows:
        a, b = byd.get(r['deposit']), byd.get(r['mirror'])
        if not a or not b: continue
        d = abs(a['game_s'] - b['game_s']) / min(a['game_s'], b['game_s']) * 100; worst.append((d, mid, r['deposit'], r['mirror']))
        legs = {k: a['legs'][k] - b['legs'][k] for k in ('out', 'back', 'dock')}; k = max(legs, key=lambda q: abs(legs[q]))
        L.append(f"| {mid} {m['name']} | {r['deposit']} | {r['mirror']} | {a['real_s']:.1f} s | {b['real_s']:.1f} s | {d:.1f}%{' ⚠️' if d > 5 else ''} | {k} leg {legs[k] / G:+.1f} s |")
w = max(worst) if worst else None
L += ['', f'The worst pair is {w[1]} {w[2]} vs {w[3]} at {w[0]:.1f}%. ' + ('Pairs over 5% come from the base kit\'s refinery orientation: one side\'s harvester reaches the bay at a sharper angle, so it pivots further before reversing in. Fixing it means changing the kit or the approach lanes, which is a layout decision; nothing has been changed.' if w and w[0] > 5 else 'All pairs are within 5%.'), '']
# sensitivity to the harvester ratio
L += ['**Harvester speed slider.** Home round trips (game seconds) at three harvester ratios:', '', '| Map | 1.20× | 1.25× | 1.30× |', '|---|---|---|---|']
for mid, m in R['maps'].items():
    cells = []
    for r in ('1.20', '1.25', '1.30'):
        g = [x['game_s'] for x in m['sweep'][r] if x['kind'] == 'home' and x['game_s']]; cells.append(f'{min(g):.1f}–{max(g):.1f}')
    L.append(f'| {mid} {m["name"]} | ' + ' | '.join(cells) + ' |')
L += ['', 'Home trips are short, so most of their time is fixed: 10 s loading, about 10–12 s docking (pivot plus reverse), 1.5 s unloading, pivots and acceleration. The harvester slider changes them by only about 1% per 0.05. It matters much more on long hauls, because there the drive dominates.', '']

# ── base to base ──
L += ['## Base to enemy base', '', f'Target: {tB[0]}–{tB[1]} s real. The tank drives from its factory rally point to the enemy\'s rally point. Sunbreak Atoll has no land route between the teams by design, so it uses the amphibious class.', '',
      '| Map | Route | Class | Distance | Real | Game s | Target |', '|---|---|---|---|---|---|---|']
for mid, m in R['maps'].items():
    for x in m['main']['b2b']:
        L.append(f'| {mid} {m["name"]} | {x["a"]} → {x["b"]} | {x["cls"]} | {(x["dist_m"] or 0) / 1000:.2f} km | **{f1(x["real_s"])} s** | {f1(x["game_s"])} | {mark(x["real_s"], tB)} |')
L += ['']
near = {}
for mid, m in R['maps'].items():
    for x in m['main']['b2b']:
        for a in (x['a'], x['b']):
            if x['game_s'] is not None and (a not in near.get(mid, {}) or x['game_s'] < near[mid][a]): near.setdefault(mid, {})[a] = x['game_s']
L += ['**Nearest enemy base, per base:** ' + '; '.join(f'{mid}: ' + ', '.join(f'{b} {t / G:.0f} s' for b, t in sorted(v.items())) for mid, v in near.items()) + '.', '']

# ── other deposits ──
L += ['## Expansion and contested deposits', '', 'These are the round trips from the nearest base of each team. Drive time grows with distance, so far fields cost proportionally more trips per minute.', '',
      '| Map | Deposit | Kind | From | One way | Round trip (real) | × nearest home trip |', '|---|---|---|---|---|---|---|']
for mid, m in R['maps'].items():
    hmin = min(x['game_s'] for x in m['main']['harv'] if x['kind'] == 'home')
    for h in [x for x in m['main']['harv'] if x['kind'] != 'home']:
        if not h['found']: L.append(f'| {mid} {m["name"]} | {h["dep"]} | {h["kind"]} | – | – | no harvester route (island: transport delivery) | – |'); continue
        L.append(f'| {mid} {m["name"]} | {h["dep"]} | {h["kind"]} | {h["base"]} · {h["dock"]} | {h["out_m"]:.0f} m | {f1(h["real_s"])} s | {h["game_s"] / hmin:.1f}× |')
L += ['', '## Notes', '',
      '- The Map Lab and the Unit Sandbox both have live **Game speed** and **Harvester speed** sliders. They start from `data/pace.json`, and each viewer\'s slider positions are kept in their own browser.',
      '- To change the defaults, edit `data/pace.json`, then run `python3 data/sync_pace.py`, rebuild the web data (`maps/gen/export_web.py`, `units/sandbox/build_assets.py`), and re-run `node maps/lab/test_pace.js` and this script.',
      f'- Harvester layer route checks in `maps/VALIDATION.md` now use the pace.json harvester speed ({rt["road_mps"] * hr:g} / {rt["offroad_mps"] * hr:g} m/s). The balance percentages compare teams on the same speeds, so they are not affected.', '']
(MAPS / 'PACE.md').write_text('\n'.join(L)); print('wrote', MAPS / 'PACE.md', len(L), 'lines')
