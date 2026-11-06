# Game pace — measured on every map (2026-11-06)

**Settings (`data/pace.json`).** Game speed **2.4×**. Harvester speed **1.25× the tank** (15 / 8.75 m/s road / off-road; tank 12 / 7).
Harvester: loads for 10 s, unloads for 1.5 s, accelerates at 3 m/s², pivots at 45°/s and reverses at 4 m/s. These are game seconds at game speed 1.

**What game speed does.** It is one uniform time scale, like RA2's game-speed setting. The simulation runs that many times faster against the wall clock, so these all speed up together:
- unit speeds, acceleration and turn rates;
- weapon reloads, projectiles and ability timers;
- harvesting, unloading and build times.

Distances, turning circles, map scale and model scale do not change. Every spec number stays valid in game seconds; real seconds = game seconds ÷ game speed.

**How these were measured.** This is the Map Lab's own Pace tab, run on each map in headless Chromium (`node maps/lab/test_pace.js`).
- **Route:** each route is planned on the baked nav grid with the harvester or tank layer, then string-pulled within road and off-road runs so it still follows roads.
- **Drive:** the route is driven with the Unit Sandbox's vehicle rules (`data/pace.js`): acceleration, braking, corner speeds, pivot turns over 45° and slowing on climbs.
- **Harvester round trip:** leave the refinery's unloading grate facing the field → drive to the rig's service point → load → drive back → pivot at the bay's approach point → reverse 25.2 m onto the grate → unload. Each base uses its faster refinery.

## Harvester round trip to every home deposit

Target: 20–30 s real for the nearest home deposit.

| Map | Deposit | Base · refinery | One way | Round trip (real) | Game s | out / load / back / dock / unload (real s) | Target |
|---|---|---|---|---|---|---|---|
| 01 Emerald Strait | B1-H1 | B1 · A | 123 m | **25.9 s** | 62.2 | 8.2 / 4.2 / 8.1 / 4.9 / 0.6 | ✅ in range |
| 01 Emerald Strait | B1-H2 | B1 · B | 126 m | **24.9 s** | 59.8 | 7.6 / 4.2 / 7.6 / 4.9 / 0.6 | ✅ in range |
| 01 Emerald Strait | R1-H1 | R1 · B | 123 m | **25.8 s** | 61.8 | 7.9 / 4.2 / 8.1 / 4.9 / 0.6 | ✅ in range |
| 01 Emerald Strait | R1-H2 | R1 · A | 124 m | **24.8 s** | 59.5 | 7.5 / 4.2 / 7.6 / 4.9 / 0.6 | ✅ in range |
| 02 Delta Grid | B1-H1 | B1 · A | 126 m | **23.5 s** | 56.3 | 7.1 / 4.2 / 7.0 / 4.6 / 0.6 | ✅ in range |
| 02 Delta Grid | B1-H2 | B1 · B | 126 m | **23.5 s** | 56.3 | 7.1 / 4.2 / 7.0 / 4.6 / 0.6 | ✅ in range |
| 02 Delta Grid | B2-H1 | B2 · A | 124 m | **23.4 s** | 56.1 | 7.1 / 4.2 / 7.0 / 4.6 / 0.6 | ✅ in range |
| 02 Delta Grid | B2-H2 | B2 · B | 136 m | **24.5 s** | 58.8 | 7.6 / 4.2 / 7.5 / 4.5 / 0.6 | ✅ in range |
| 02 Delta Grid | R1-H1 | R1 · B | 127 m | **23.6 s** | 56.6 | 7.2 / 4.2 / 7.0 / 4.6 / 0.6 | ✅ in range |
| 02 Delta Grid | R1-H2 | R1 · A | 129 m | **23.8 s** | 57.1 | 7.3 / 4.2 / 7.1 / 4.6 / 0.6 | ✅ in range |
| 02 Delta Grid | R2-H1 | R2 · B | 139 m | **24.8 s** | 59.6 | 7.8 / 4.2 / 7.7 / 4.5 / 0.6 | ✅ in range |
| 02 Delta Grid | R2-H2 | R2 · A | 127 m | **23.7 s** | 56.9 | 7.3 / 4.2 / 7.1 / 4.6 / 0.6 | ✅ in range |
| 03 Granite Fjord | B1-H1 | B1 · A | 110 m | **22.5 s** | 54.1 | 6.4 / 4.2 / 6.5 / 4.8 / 0.6 | ✅ in range |
| 03 Granite Fjord | B1-H2 | B1 · B | 112 m | **22.9 s** | 55.0 | 6.6 / 4.2 / 6.7 / 4.8 / 0.6 | ✅ in range |
| 03 Granite Fjord | R1-H1 | R1 · B | 111 m | **23.1 s** | 55.5 | 6.7 / 4.2 / 6.7 / 4.8 / 0.6 | ✅ in range |
| 03 Granite Fjord | R1-H2 | R1 · A | 112 m | **22.9 s** | 54.9 | 6.6 / 4.2 / 6.7 / 4.8 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | B1-H1 | B1 · A | 164 m | **27.4 s** | 65.7 | 9.0 / 4.2 / 9.0 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | B1-H2 | B1 · B | 167 m | **27.6 s** | 66.3 | 9.1 / 4.2 / 9.1 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | B2-H1 | B2 · A | 162 m | **27.3 s** | 65.5 | 8.9 / 4.2 / 9.0 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | B2-H2 | B2 · B | 168 m | **27.8 s** | 66.8 | 9.2 / 4.2 / 9.3 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | R1-H1 | R1 · B | 167 m | **27.5 s** | 66.1 | 9.0 / 4.2 / 9.1 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | R1-H2 | R1 · A | 164 m | **27.3 s** | 65.5 | 8.9 / 4.2 / 9.0 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | R2-H1 | R2 · B | 168 m | **27.7 s** | 66.5 | 9.0 / 4.2 / 9.2 / 4.6 / 0.6 | ✅ in range |
| 04 Sunbreak Atoll | R2-H2 | R2 · A | 162 m | **27.2 s** | 65.2 | 8.8 / 4.2 / 9.0 / 4.6 / 0.6 | ✅ in range |
| 05 Copperhead Bay | B1-H1 | B1 · A | 123 m | **23.2 s** | 55.8 | 7.0 / 4.2 / 6.8 / 4.6 / 0.6 | ✅ in range |
| 05 Copperhead Bay | B1-H2 | B1 · B | 135 m | **24.3 s** | 58.4 | 7.6 / 4.2 / 7.4 / 4.5 / 0.6 | ✅ in range |
| 05 Copperhead Bay | B2-H1 | B2 · A | 124 m | **23.4 s** | 56.1 | 7.1 / 4.2 / 7.0 / 4.6 / 0.6 | ✅ in range |
| 05 Copperhead Bay | B2-H2 | B2 · B | 136 m | **24.5 s** | 58.8 | 7.6 / 4.2 / 7.5 / 4.5 / 0.6 | ✅ in range |
| 05 Copperhead Bay | R1-H1 | R1 · B | 136 m | **24.4 s** | 58.5 | 7.7 / 4.2 / 7.4 / 4.5 / 0.6 | ✅ in range |
| 05 Copperhead Bay | R1-H2 | R1 · A | 126 m | **23.5 s** | 56.4 | 7.2 / 4.2 / 6.9 / 4.6 / 0.6 | ✅ in range |
| 05 Copperhead Bay | R2-H1 | R2 · B | 136 m | **24.5 s** | 58.9 | 7.7 / 4.2 / 7.5 / 4.5 / 0.6 | ✅ in range |
| 05 Copperhead Bay | R2-H2 | R2 · A | 127 m | **23.7 s** | 56.9 | 7.3 / 4.2 / 7.1 / 4.6 / 0.6 | ✅ in range |

All 32 home deposits: **22.5–27.8 s** real (54.1–66.8 game s).
Every home trip lands inside 20–30 s for any game speed from **2.23×** to **2.70×**.

**Mirrored opponents.** Each blue home deposit is paired with its red mirror, as in the balance check in `maps/VALIDATION.md`. The navcheck balance check compares grid travel times only. This comparison adds the docking turn and acceleration:

| Map | Blue deposit | Red mirror | Blue | Red | Difference | Main cause |
|---|---|---|---|---|---|---|
| 01 Emerald Strait | B1-H1 | R1-H2 | 25.9 s | 24.8 s | 4.5% | out leg +0.7 s |
| 01 Emerald Strait | B1-H2 | R1-H1 | 24.9 s | 25.8 s | 3.3% | back leg -0.5 s |
| 02 Delta Grid | B1-H1 | R1-H2 | 23.5 s | 23.8 s | 1.5% | out leg -0.2 s |
| 02 Delta Grid | B1-H2 | R1-H1 | 23.5 s | 23.6 s | 0.5% | out leg -0.1 s |
| 02 Delta Grid | B2-H1 | R2-H2 | 23.4 s | 23.7 s | 1.3% | out leg -0.2 s |
| 02 Delta Grid | B2-H2 | R2-H1 | 24.5 s | 24.8 s | 1.4% | out leg -0.2 s |
| 03 Granite Fjord | B1-H1 | R1-H2 | 22.5 s | 22.9 s | 1.5% | back leg -0.2 s |
| 03 Granite Fjord | B1-H2 | R1-H1 | 22.9 s | 23.1 s | 0.8% | out leg -0.1 s |
| 04 Sunbreak Atoll | B1-H1 | R1-H2 | 27.4 s | 27.3 s | 0.4% | out leg +0.1 s |
| 04 Sunbreak Atoll | B1-H2 | R1-H1 | 27.6 s | 27.5 s | 0.4% | out leg +0.1 s |
| 04 Sunbreak Atoll | B2-H1 | R2-H2 | 27.3 s | 27.2 s | 0.5% | out leg +0.1 s |
| 04 Sunbreak Atoll | B2-H2 | R2-H1 | 27.8 s | 27.7 s | 0.5% | out leg +0.1 s |
| 05 Copperhead Bay | B1-H1 | R1-H2 | 23.2 s | 23.5 s | 1.1% | out leg -0.2 s |
| 05 Copperhead Bay | B1-H2 | R1-H1 | 24.3 s | 24.4 s | 0.2% | out leg -0.1 s |
| 05 Copperhead Bay | B2-H1 | R2-H2 | 23.4 s | 23.7 s | 1.3% | out leg -0.2 s |
| 05 Copperhead Bay | B2-H2 | R2-H1 | 24.5 s | 24.5 s | 0.2% | out leg -0.1 s |

The worst pair is 01 B1-H1 vs R1-H2 at 4.5%. All pairs are within 5%.

**Harvester speed slider.** Home round trips (game seconds) at three harvester ratios:

| Map | 1.20× | 1.25× | 1.30× |
|---|---|---|---|
| 01 Emerald Strait | 60.3–62.9 | 59.5–62.2 | 58.8–61.6 |
| 02 Delta Grid | 57.0–60.5 | 56.1–59.6 | 55.4–58.7 |
| 03 Granite Fjord | 54.8–56.1 | 54.1–55.5 | 53.5–54.9 |
| 04 Sunbreak Atoll | 66.5–68.1 | 65.2–66.8 | 64.1–65.7 |
| 05 Copperhead Bay | 56.6–59.9 | 55.8–58.9 | 55.0–58.0 |

Home trips are short, so most of their time is fixed: 10 s loading, about 10–12 s docking (pivot plus reverse), 1.5 s unloading, pivots and acceleration. The harvester slider changes them by only about 1% per 0.05. It matters much more on long hauls, because there the drive dominates.

## Base to enemy base

Target: 45–60 s real. The tank drives from its factory rally point to the enemy's rally point. Sunbreak Atoll has no land route between the teams by design, so it uses the amphibious class.

| Map | Route | Class | Distance | Real | Game s | Target |
|---|---|---|---|---|---|---|
| 01 Emerald Strait | B1 → R1 | tank | 1.33 km | **53.3 s** | 127.9 | ✅ in range |
| 02 Delta Grid | B1 → R1 | tank | 1.77 km | **69.6 s** | 166.9 | ⚠️ slow (+9.6 s) |
| 02 Delta Grid | B1 → R2 | tank | 2.29 km | **87.7 s** | 210.4 | ⚠️ slow (+27.7 s) |
| 02 Delta Grid | B2 → R1 | tank | 2.29 km | **87.8 s** | 210.7 | ⚠️ slow (+27.8 s) |
| 02 Delta Grid | B2 → R2 | tank | 1.85 km | **72.5 s** | 173.9 | ⚠️ slow (+12.5 s) |
| 03 Granite Fjord | B1 → R1 | tank | 1.04 km | **40.7 s** | 97.7 | ⚠️ fast (-4.3 s) |
| 04 Sunbreak Atoll | B1 → R1 | amphibious | 1.56 km | **92.5 s** | 222.0 | ⚠️ slow (+32.5 s) |
| 04 Sunbreak Atoll | B1 → R2 | amphibious | 2.70 km | **140.2 s** | 336.5 | ⚠️ slow (+80.2 s) |
| 04 Sunbreak Atoll | B2 → R1 | amphibious | 2.01 km | **137.9 s** | 330.9 | ⚠️ slow (+77.9 s) |
| 04 Sunbreak Atoll | B2 → R2 | amphibious | 1.56 km | **92.4 s** | 221.8 | ⚠️ slow (+32.4 s) |
| 05 Copperhead Bay | B1 → R1 | tank | 1.66 km | **62.4 s** | 149.7 | ⚠️ slow (+2.4 s) |
| 05 Copperhead Bay | B1 → R2 | tank | 2.64 km | **99.1 s** | 237.8 | ⚠️ slow (+39.1 s) |
| 05 Copperhead Bay | B2 → R1 | tank | 2.64 km | **99.2 s** | 238.1 | ⚠️ slow (+39.2 s) |
| 05 Copperhead Bay | B2 → R2 | tank | 2.38 km | **90.1 s** | 216.2 | ⚠️ slow (+30.1 s) |

**Nearest enemy base, per base:** 01: B1 53 s, R1 53 s; 02: B1 70 s, B2 72 s, R1 70 s, R2 72 s; 03: B1 41 s, R1 41 s; 04: B1 93 s, B2 92 s, R1 93 s, R2 92 s; 05: B1 62 s, B2 90 s, R1 62 s, R2 90 s.

## Expansion and contested deposits

These are the round trips from the nearest base of each team. Drive time grows with distance, so far fields cost proportionally more trips per minute.

| Map | Deposit | Kind | From | One way | Round trip (real) | × nearest home trip |
|---|---|---|---|---|---|---|
| 01 Emerald Strait | C2 | contested | R1 · B | 601 m | 60.7 s | 2.4× |
| 01 Emerald Strait | C1 | contested | B1 · B | 607 m | 61.1 s | 2.5× |
| 01 Emerald Strait | E1 | expansion | R1 · B | 981 m | 77.4 s | 3.1× |
| 01 Emerald Strait | E2 | expansion | B1 · B | 1001 m | 78.0 s | 3.1× |
| 01 Emerald Strait | C1 | contested | R1 · B | 970 m | 79.5 s | 3.2× |
| 01 Emerald Strait | C2 | contested | B1 · B | 974 m | 80.2 s | 3.2× |
| 01 Emerald Strait | E1 | expansion | B1 · B | 1233 m | 96.1 s | 3.9× |
| 01 Emerald Strait | E2 | expansion | R1 · A | 1243 m | 97.7 s | 3.9× |
| 02 Delta Grid | E2 | expansion | B2 · B | 485 m | 57.3 s | 2.4× |
| 02 Delta Grid | E4 | expansion | R2 · B | 486 m | 57.7 s | 2.5× |
| 02 Delta Grid | E3 | expansion | R1 · B | 490 m | 58.9 s | 2.5× |
| 02 Delta Grid | E1 | expansion | B1 · B | 490 m | 58.9 s | 2.5× |
| 02 Delta Grid | C1 | contested | B1 · B | 1008 m | 87.0 s | 3.7× |
| 02 Delta Grid | C2 | contested | R2 · B | 1029 m | 88.2 s | 3.8× |
| 02 Delta Grid | C2 | contested | B2 · B | 1129 m | 96.0 s | 4.1× |
| 02 Delta Grid | C1 | contested | R1 · B | 1113 m | 97.7 s | 4.2× |
| 02 Delta Grid | E4 | expansion | B2 · B | 1784 m | 132.1 s | 5.6× |
| 02 Delta Grid | E2 | expansion | R2 · B | 1785 m | 132.9 s | 5.7× |
| 02 Delta Grid | E3 | expansion | B1 · B | 1790 m | 134.2 s | 5.7× |
| 02 Delta Grid | E1 | expansion | R1 · B | 1793 m | 135.0 s | 5.8× |
| 03 Granite Fjord | C1 | contested | B1 · B | 521 m | 53.0 s | 2.4× |
| 03 Granite Fjord | C2 | contested | R1 · B | 527 m | 53.7 s | 2.4× |
| 03 Granite Fjord | C2 | contested | B1 · B | 717 m | 65.5 s | 2.9× |
| 03 Granite Fjord | C1 | contested | R1 · B | 717 m | 65.6 s | 2.9× |
| 03 Granite Fjord | E1 | expansion | B1 · A | 932 m | 79.8 s | 3.5× |
| 03 Granite Fjord | E2 | expansion | R1 · A | 943 m | 80.1 s | 3.6× |
| 03 Granite Fjord | E1 | expansion | R1 · B | 1670 m | 125.0 s | 5.5× |
| 03 Granite Fjord | E2 | expansion | B1 · B | 1693 m | 125.4 s | 5.6× |
| 04 Sunbreak Atoll | E1 | contested-expansion | – | – | no harvester route (island: transport delivery) | – |
| 04 Sunbreak Atoll | E2 | contested-expansion | – | – | no harvester route (island: transport delivery) | – |
| 04 Sunbreak Atoll | E3 | contested-expansion | – | – | no harvester route (island: transport delivery) | – |
| 04 Sunbreak Atoll | E4 | contested-expansion | – | – | no harvester route (island: transport delivery) | – |
| 05 Copperhead Bay | E1 | expansion | B1 · B | 471 m | 53.6 s | 2.3× |
| 05 Copperhead Bay | E3 | expansion | R1 · B | 475 m | 54.4 s | 2.3× |
| 05 Copperhead Bay | E2 | expansion | B2 · B | 661 m | 61.9 s | 2.7× |
| 05 Copperhead Bay | E4 | expansion | R2 · A | 679 m | 62.7 s | 2.7× |
| 05 Copperhead Bay | C1 | contested | B1 · B | 858 m | 93.9 s | 4.0× |
| 05 Copperhead Bay | C2 | contested | R1 · B | 864 m | 95.0 s | 4.1× |
| 05 Copperhead Bay | C2 | contested | B1 · B | 1519 m | 117.3 s | 5.0× |
| 05 Copperhead Bay | C1 | contested | R1 · B | 1522 m | 118.3 s | 5.1× |
| 05 Copperhead Bay | E1 | expansion | R1 · B | 1759 m | 122.7 s | 5.3× |
| 05 Copperhead Bay | E3 | expansion | B1 · B | 1755 m | 123.0 s | 5.3× |
| 05 Copperhead Bay | E4 | expansion | B2 · B | 1953 m | 133.8 s | 5.8× |
| 05 Copperhead Bay | E2 | expansion | R2 · B | 1953 m | 134.4 s | 5.8× |

## Notes

- The Map Lab and the Unit Sandbox both have live **Game speed** and **Harvester speed** sliders. They start from `data/pace.json`, and each viewer's slider positions are kept in their own browser.
- To change the defaults, edit `data/pace.json`, then run `python3 data/sync_pace.py`, rebuild the web data (`maps/gen/export_web.py`, `units/sandbox/build_assets.py`), and re-run `node maps/lab/test_pace.js` and this script.
- Harvester layer route checks in `maps/VALIDATION.md` now use the pace.json harvester speed (15 / 8.75 m/s). The balance percentages compare teams on the same speeds, so they are not affected.
