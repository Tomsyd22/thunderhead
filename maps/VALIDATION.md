# Thunderhead maps — validation report

Automated checks run by `maps/gen/navcheck.py` on the generated data. Coordinate/bounds checks are automatic;
balance and art quality still need human review — passing coordinate checks is not proof of balance.

## Approved changes (2026-11-06)

`layouts.json` is unchanged; the approved revisions live in `data/layout_revisions.json` and are applied when the maps are generated. Removing an entry and regenerating reverts it.

| Map | Item | Old (layout q) | New (layout q) | Old (m) | New (m) | Moved | Why |
|---|---|---|---|---|---|---|---|
| 01 Emerald Strait | radar center | (700, 650) | (685, 680) | (1260, 1170) | (1233, 1224) | 60 m | equal tank travel time from both pad centres: was B1 114.4 s vs R1 95.6 s (19.6%), now 105.7 s vs 105.0 s (0.7%); stays on the east radar ridge, about 60 m NNW of the original point |
| 02 Delta Grid | C1 position | (465, 710) | (460, 737) | (1116, 1704) | (1104, 1769) | 66 m | C1 and C2 are rotational twins; blue's best time to C1 now matches red's best time to C2, and red's best to C1 matches blue's best to C2: was 87.2 s vs 96.4 s (10.1%), now 97.8 s vs 97.5 s (0.3%) and 111.4 s vs 110.6 s (0.8%); moved 66 m NNW |
| 04 Sunbreak Atoll | landing beach 5 width | – | – | 50 m | 60 m | – | meet the 60–75 m landing-approach rule; measured continuous approach now 60 m, gradient 7.0%, apron 45–51 m deep |
| 04 Sunbreak Atoll | landing beach 6 width | – | – | 50 m | 60 m | – | meet the 60–75 m landing-approach rule; measured continuous approach now 60 m, gradient 7.0%, apron 45–51 m deep |
| 01 Emerald Strait | E2 position | (750, 780) | (759, 797) | (1350, 1404) | (1366, 1435) | 35 m | E1/E2 are rotational twins; red reached E1 in 93.1 s but blue needed 97.8 s for E2 (5.1%). E2 moved 34 m NNE; E1 stays at its layout coordinate (decided 2026-11-06: the rotated E1 point clipped a road band). |

**Base kit per start.** Each start's copy of the identical kit is mirrored so the factory side faces the map centre (x) and the refineries face that start's home deposits (y); buildings are rigid models, rotated 180° where the mirror flips their facing, so no mirrored geometry is used. Emerald Strait: R1's kit is B1's rotated 180°; Delta Grid, Granite Fjord, Sunbreak Atoll and Copperhead Bay: opposing kits mirror east–west.

| Map | Start | Kit | Rally point (m) |
|---|---|---|---|
| 01 Emerald Strait | B1 | mirror-y | (480, 1414) |
| 01 Emerald Strait | R1 | mirror-x | (1320, 386) |
| 02 Delta Grid | B1 | mirror-y | (414, 1834) |
| 02 Delta Grid | B2 | identity | (414, 710) |
| 02 Delta Grid | R1 | rotate-180 | (1986, 1834) |
| 02 Delta Grid | R2 | mirror-x | (1986, 710) |
| 03 Granite Fjord | B1 | mirror-y | (500, 1590) |
| 03 Granite Fjord | R1 | rotate-180 | (1500, 1590) |
| 04 Sunbreak Atoll | B1 | mirror-y | (576, 1960) |
| 04 Sunbreak Atoll | B2 | identity | (576, 640) |
| 04 Sunbreak Atoll | R1 | rotate-180 | (2024, 1960) |
| 04 Sunbreak Atoll | R2 | mirror-x | (2024, 640) |
| 05 Copperhead Bay | B1 | mirror-y | (390, 1930) |
| 05 Copperhead Bay | B2 | identity | (390, 590) |
| 05 Copperhead Bay | R1 | rotate-180 | (2010, 1930) |
| 05 Copperhead Bay | R2 | mirror-x | (2010, 590) |

**Provisional moves approved 2026-11-06:**

- base kit service aisle bends 3 m away from the substation (all maps)
- Copperhead Bay deposits E2 and E4: rig and service area offset 50 m (a road runs through the layout point); offsets are exact mirror images, (−37.1, +33.5) m and (+37.1, +33.5) m (map 05)
- Granite Fjord deposits E1 and E2: rig and service area offset 2 m off the road band (map 03)
- Delta Grid radar mast offset 22 m so the central spine road stays clear (map 02)
- base kit refineries: where the short bay mouth faces the field, the refinery sits 10.4 m further from the field, so every start's unloading grate and 25.2 m approach are exact mirror images (equal docking for paired bases) (all maps)

## Still open

Nothing: every check passes.

**Warnings (measured, no decision needed):**

- 03 Granite Fjord: waypoints within 8 m; fillets ≥ 20 m where space permits: max waypoint deviation 7.7 m (west-coastal); waypoints inside base pads are served by the base layout; fillets limited by the 8 m waypoint rule at sharp corners: rear-plateau 18 m, west-coastal 6 m, east-coastal 6 m


## 01 · Emerald Strait — 24 pass, 0 warn, 0 fail

| Check | Result | Detail |
|---|---|---|
| terrain size | PASS | 1800 × 1800 m (spec 1800 × 1800) |
| bases: count, team, position | PASS | 2 bases B1 (B) @ (450, 1404) m, R1 (R) @ (1350, 396) m |
| pad B1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 14 m |
| pad R1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 14 m |
| deposit count & coordinates | PASS | 8 deposits (spec 8), ids match: True; 2 home each for ['B1', 'R1']; all 8 built exactly at their layout coordinates (max 0.00 m) |
| rigs & harvester service points accessible | PASS | harvester reaches 8 service points from a refinery bay |
| asset bounds within 1% | PASS | bld_barracks 24.02×12.00×6.00 (0.08%); bld_vehicle_factory 39.98×30.00×12.00 (0.04%); bld_hq 29.96×23.98×10.00 (0.12%); bld_ore_refinery 36.00×28.00×16.00 (0.01%); bld_power_substation 19.99×15.99×6.00 (0.05%); bld_radar_control 15.91×12.01×6.00 (0.55%); bld_extraction_rig 16.00×12.00×12.00 (0.00%); unit_mbt 9.50×3.60×2.50 (0.00%); unit_apc 7.00×3.00×2.80 (0.00%); unit_harvester 10.00×4.00×4.00 (0.01%); unit_patrol_boat 32.00×7.00×11.00 (0.00%); unit_infantry 0.93×0.56×1.80 (0.00%); prop_container_20 6.06×2.44×2.59 (0.00%); prop_container_40 12.19×2.44×2.59 (0.00%); bld_naval_dock 80.00×40.00×21.00 (0.00%) |
| required land connections | PASS | B1→R1 130s |
| dock B1: ship berth → open sea | PASS | time 11s; narrowest navigable width on route 172 m (≥ 40); turning basin ⌀ 405 m (≥ 80) |
| dock R1: ship berth → open sea | PASS | time 12s; narrowest navigable width on route 176 m (≥ 40); turning basin ⌀ 420 m (≥ 80) |
| tanks cannot drive through deep water (construction) | PASS | the tank layer is built only from dry land and bridge/causeway/dock decks, so tanks cannot enter water by construction; verified: 0 tank-layer cells over water deeper than 1 m off decks, and traced base-to-base tank routes cross 0.00 m of water off decks |
| road longitudinal grade ≤ 6% | PASS | steepest road surface cross-link 5.80% (graded profile = road mesh, 10 m window); terrain under road centrelines within 0.05 m of the profile away from junctions, bridge decks and abutment joints |
| road cross slope ≤ 2% | PASS | max terrain cross slope across the clear width 1.60% (road meshes are level across; junction and pad-edge zones excluded) |
| waypoints within 8 m; fillets ≥ 20 m where space permits | PASS | max waypoint deviation 7.6 m (west-flank); waypoints inside base pads are served by the base layout; min fillet 74 m |
| tanks & harvesters clear roads, ramps, corners | PASS | harvester drives every road/ramp run end to end |
| nothing obstructs road clear corridors | PASS | 0 intrusions (blocking footprints, fences, barriers, light poles, cabinets, rocks and tree trunks checked; flush rail crossings, culverts under the road and kerb grates allowed) |
| tanks & harvesters clear factory doors and refinery bays | PASS | factory door 6.0 × 5.0 m clear (tank 3.6 m wide × 2.5 m, harvester 4.0 × 4.0 m); refinery bay 7.0 × 6.0 m; 2 factory aprons 12 m deep clear of footprints, each with a tank route to its rally point |
| no holes, shoreline gaps or z-fighting on main routes (construction) | PASS | heightfield 901×901 at 2.0 m, all values finite, meshed as 225 contiguous 128 m chunks sharing edge vertices; one sea plane at z = 0 spans the map and the skirt, and land/water, navigation and rendering all derive from the same heightfield, so the shoreline has no gaps; bridge spans are checked above; road surfaces render 0.06 m and service lanes 0.04 m above the graded terrain, building floors 0.03 m above their pads (no coplanar faces) |
| building separation ≥ 8 m (oriented footprints) | PASS | all 23 buildings ≥ 8 m apart, rotated ones included |
| mirrored travel times, map layout (from pad centres; target ≤ 5%) | PASS | players paired by rotate-180 {'B1': 'R1'}; home deposits worst 0.7% [B1-H1 25.3s vs R1-H2 25.5s]; contested objectives, team vs team, worst 2.2% [E2 blue 95.1s vs red 93.1s]; radar: radar blue 105.7s vs red 105.0s |
| mirrored travel times, with the base kit mirrored per start (factory rally point, refinery bays; target ≤ 5%) | PASS | home deposits: tank from the factory rally point worst 0.7% [B1-H1 25.7s vs R1-H2 25.8s]; harvester from the nearest refinery bay worst 0.0% [B1-H1 10.7s vs R1-H2 10.7s] |
| capture radar (220 m) does not reveal base centres | PASS | nearest base centre 803 m from a radar |
| no floating or buried instances | PASS | 4601 instances checked |
| screenshots for 5 camera presets | PASS | 5 found |

## 02 · Delta Grid — 33 pass, 0 warn, 0 fail

| Check | Result | Detail |
|---|---|---|
| terrain size | PASS | 2400 × 2400 m (spec 2400 × 2400) |
| bases: count, team, position | PASS | 4 bases B1 (B) @ (384, 1824) m, B2 (B) @ (384, 720) m, R1 (R) @ (2016, 1824) m, R2 (R) @ (2016, 720) m |
| pad B1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| pad B2 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| pad R1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| pad R2 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| deposit count & coordinates | PASS | 14 deposits (spec 14), ids match: True; 2 home each for ['B1', 'B2', 'R1', 'R2']; all 14 built exactly at their layout coordinates (max 0.00 m) |
| rigs & harvester service points accessible | PASS | harvester reaches 14 service points from a refinery bay |
| asset bounds within 1% | PASS | bld_barracks 24.02×12.00×6.00 (0.08%); bld_vehicle_factory 39.98×30.00×12.00 (0.04%); bld_hq 29.96×23.98×10.00 (0.12%); bld_ore_refinery 36.00×28.00×16.00 (0.01%); bld_power_substation 19.99×15.99×6.00 (0.05%); bld_radar_control 15.91×12.01×6.00 (0.55%); bld_extraction_rig 16.00×12.00×12.00 (0.00%); unit_mbt 9.50×3.60×2.50 (0.00%); unit_apc 7.00×3.00×2.80 (0.00%); unit_harvester 10.00×4.00×4.00 (0.01%); unit_patrol_boat 32.00×7.00×11.00 (0.00%); unit_infantry 0.93×0.56×1.80 (0.00%); prop_container_20 6.06×2.44×2.59 (0.00%); prop_container_40 12.19×2.44×2.59 (0.00%); bld_naval_dock 80.00×40.00×21.00 (0.00%) |
| required land connections | PASS | B1→B2 119s, B1→R1 168s, B1→R2 212s, B2→R1 212s, B2→R2 175s, R1→R2 119s |
| bridge NW: own deck, continuous with its approaches; vehicles cross; ships pass beneath | PASS | deck 14 m, underside 12 m ≥ 9 + 3 m; deck span 286 m on upper-crossing (ends within 1 m of the layout), road-to-deck step 0.12 m; tank crossing 34s; ship passage yes, 84 m of ship-navigable water clear of piers under the span (≥ 40) |
| bridge NE: own deck, continuous with its approaches; vehicles cross; ships pass beneath | PASS | deck 14 m, underside 12 m ≥ 9 + 3 m; deck span 286 m on upper-crossing (ends within 2 m of the layout), road-to-deck step 0.12 m; tank crossing 34s; ship passage yes, 84 m of ship-navigable water clear of piers under the span (≥ 40) |
| bridge SW: own deck, continuous with its approaches; vehicles cross; ships pass beneath | PASS | deck 14 m, underside 12 m ≥ 9 + 3 m; deck span 286 m on lower-crossing (ends within 1 m of the layout), road-to-deck step 0.12 m; tank crossing 34s; ship passage yes, 84 m of ship-navigable water clear of piers under the span (≥ 40) |
| bridge SE: own deck, continuous with its approaches; vehicles cross; ships pass beneath | PASS | deck 14 m, underside 12 m ≥ 9 + 3 m; deck span 286 m on lower-crossing (ends within 2 m of the layout), road-to-deck step 0.12 m; tank crossing 34s; ship passage yes, 84 m of ship-navigable water clear of piers under the span (≥ 40) |
| dock B1: ship berth → open sea | PASS | time 141s; narrowest navigable width on route 80 m (≥ 40); turning basin ⌀ 185 m (≥ 80) |
| dock B2: ship berth → open sea | PASS | time 52s; narrowest navigable width on route 95 m (≥ 40); turning basin ⌀ 264 m (≥ 80) |
| dock R1: ship berth → open sea | PASS | time 141s; narrowest navigable width on route 76 m (≥ 40); turning basin ⌀ 188 m (≥ 80) |
| dock R2: ship berth → open sea | PASS | time 52s; narrowest navigable width on route 99 m (≥ 40); turning basin ⌀ 260 m (≥ 80) |
| tanks cannot drive through deep water (construction) | PASS | the tank layer is built only from dry land and bridge/causeway/dock decks, so tanks cannot enter water by construction; verified: 0 tank-layer cells over water deeper than 1 m off decks, and traced base-to-base tank routes cross 0.00 m of water off decks |
| road longitudinal grade ≤ 6% | PASS | steepest road surface upper-crossing 5.80% (graded profile = road mesh, 10 m window); terrain under road centrelines within 0.03 m of the profile away from junctions, bridge decks and abutment joints |
| road cross slope ≤ 2% | PASS | max terrain cross slope across the clear width 0.27% (road meshes are level across; junction and pad-edge zones excluded) |
| waypoints within 8 m; fillets ≥ 20 m where space permits | PASS | max waypoint deviation 7.6 m (lower-crossing); waypoints inside base pads are served by the base layout; min fillet 49 m |
| tanks & harvesters clear roads, ramps, corners | PASS | harvester drives every road/ramp run end to end |
| nothing obstructs road clear corridors | PASS | 0 intrusions (blocking footprints, fences, barriers, light poles, cabinets, rocks and tree trunks checked; flush rail crossings, culverts under the road and kerb grates allowed) |
| tanks & harvesters clear factory doors and refinery bays | PASS | factory door 6.0 × 5.0 m clear (tank 3.6 m wide × 2.5 m, harvester 4.0 × 4.0 m); refinery bay 7.0 × 6.0 m; 4 factory aprons 12 m deep clear of footprints, each with a tank route to its rally point |
| no holes, shoreline gaps or z-fighting on main routes (construction) | PASS | heightfield 1201×1201 at 2.0 m, all values finite, meshed as 361 contiguous 128 m chunks sharing edge vertices; one sea plane at z = 0 spans the map and the skirt, and land/water, navigation and rendering all derive from the same heightfield, so the shoreline has no gaps; bridge spans are checked above; road surfaces render 0.06 m and service lanes 0.04 m above the graded terrain, building floors 0.03 m above their pads (no coplanar faces) |
| fenced compounds have ≥ 2 vehicle approaches | PASS | gates reachable by tank from a road: waterworks 2 |
| building separation ≥ 8 m (oriented footprints) | PASS | all 26 buildings ≥ 8 m apart, rotated ones included |
| mirrored travel times, map layout (from pad centres; target ≤ 5%) | PASS | players paired by mirror-x {'B1': 'R1', 'B2': 'R2'}; home deposits worst 3.1% [B2-H1 26.9s vs R2-H2 27.7s]; contested objectives, team vs team, worst 0.8% [C2 blue 110.6s vs red 111.4s]; radar: radar blue 111.8s vs red 111.5s |
| mirrored travel times, with the base kit mirrored per start (factory rally point, refinery bays; target ≤ 5%) | PASS | home deposits: tank from the factory rally point worst 1.8% [B2-H1 27.6s vs R2-H2 28.1s]; harvester from the nearest refinery bay worst 0.0% [B1-H1 11.8s vs R1-H2 11.8s] |
| capture radar (220 m) does not reveal base centres | PASS | nearest base centre 819 m from a radar |
| no floating or buried instances | PASS | 14746 instances checked |
| screenshots for 5 camera presets | PASS | 5 found |

**Provisional moves, approved 2026-11-06:**

- radar radar: road corridor crosses the 24×24 compound; mast/radome structure offset 22 m from the centre, compound kept clear for capture

## 03 · Granite Fjord — 26 pass, 1 warn, 0 fail

| Check | Result | Detail |
|---|---|---|
| terrain size | PASS | 2000 × 2000 m (spec 2000 × 2000) |
| bases: count, team, position | PASS | 2 bases B1 (B) @ (470, 1580) m, R1 (R) @ (1530, 1580) m |
| pad B1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 32 m |
| pad R1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 32 m |
| deposit count & coordinates | PASS | 8 deposits (spec 8), ids match: True; 2 home each for ['B1', 'R1']; 6 built exactly at their layout coordinate; E1 built 2 m from its layout coordinate (offset approved 2026-11-06); E2 built 2 m from its layout coordinate (offset approved 2026-11-06) |
| rigs & harvester service points accessible | PASS | harvester reaches 8 service points from a refinery bay |
| asset bounds within 1% | PASS | bld_barracks 24.02×12.00×6.00 (0.08%); bld_vehicle_factory 39.98×30.00×12.00 (0.04%); bld_hq 29.96×23.98×10.00 (0.12%); bld_ore_refinery 36.00×28.00×16.00 (0.01%); bld_power_substation 19.99×15.99×6.00 (0.05%); bld_radar_control 15.91×12.01×6.00 (0.55%); bld_extraction_rig 16.00×12.00×12.00 (0.00%); unit_mbt 9.50×3.60×2.50 (0.00%); unit_apc 7.00×3.00×2.80 (0.00%); unit_harvester 10.00×4.00×4.00 (0.01%); unit_patrol_boat 32.00×7.00×11.00 (0.00%); unit_infantry 0.93×0.56×1.80 (0.00%); prop_container_20 6.06×2.44×2.59 (0.00%); prop_container_40 12.19×2.44×2.59 (0.00%); bld_naval_dock 80.00×40.00×21.00 (0.00%) |
| required land connections | PASS | B1→R1 102s |
| dock B1: ship berth → open sea | PASS | time 80s; narrowest navigable width on route 88 m (≥ 40); turning basin ⌀ 383 m (≥ 80) |
| dock R1: ship berth → open sea | PASS | time 79s; narrowest navigable width on route 80 m (≥ 40); turning basin ⌀ 383 m (≥ 80) |
| landing beach 1 @ (880, 580) m | PASS | amphibious sea→apron 43s; measured continuous approach width 60 m (rule 60–75 m; layout 60 m); max gradient 7.0% (≤ 8%); measured clear apron 30 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 61 m offshore): 0 |
| landing beach 2 @ (1120, 580) m | PASS | amphibious sea→apron 42s; measured continuous approach width 60 m (rule 60–75 m; layout 60 m); max gradient 7.0% (≤ 8%); measured clear apron 36 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 55 m offshore): 0 |
| tanks cannot drive through deep water (construction) | PASS | the tank layer is built only from dry land and bridge/causeway/dock decks, so tanks cannot enter water by construction; verified: 0 tank-layer cells over water deeper than 1 m off decks, and traced base-to-base tank routes cross 0.00 m of water off decks |
| road longitudinal grade ≤ 6% | PASS | steepest road surface rear-plateau 5.80% (graded profile = road mesh, 10 m window); terrain under road centrelines within 0.02 m of the profile away from junctions, bridge decks and abutment joints |
| road cross slope ≤ 2% | PASS | max terrain cross slope across the clear width 0.85% (road meshes are level across; junction and pad-edge zones excluded) |
| waypoints within 8 m; fillets ≥ 20 m where space permits | WARN | max waypoint deviation 7.7 m (west-coastal); waypoints inside base pads are served by the base layout; fillets limited by the 8 m waypoint rule at sharp corners: rear-plateau 18 m, west-coastal 6 m, east-coastal 6 m |
| tanks & harvesters clear roads, ramps, corners | PASS | harvester drives every road/ramp run end to end |
| nothing obstructs road clear corridors | PASS | 0 intrusions (blocking footprints, fences, barriers, light poles, cabinets, rocks and tree trunks checked; flush rail crossings, culverts under the road and kerb grates allowed) |
| tanks & harvesters clear factory doors and refinery bays | PASS | factory door 6.0 × 5.0 m clear (tank 3.6 m wide × 2.5 m, harvester 4.0 × 4.0 m); refinery bay 7.0 × 6.0 m; 2 factory aprons 12 m deep clear of footprints, each with a tank route to its rally point |
| no holes, shoreline gaps or z-fighting on main routes (construction) | PASS | heightfield 1001×1001 at 2.0 m, all values finite, meshed as 256 contiguous 128 m chunks sharing edge vertices; one sea plane at z = 0 spans the map and the skirt, and land/water, navigation and rendering all derive from the same heightfield, so the shoreline has no gaps; bridge spans are checked above; road surfaces render 0.06 m and service lanes 0.04 m above the graded terrain, building floors 0.03 m above their pads (no coplanar faces) |
| fenced compounds have ≥ 2 vehicle approaches | PASS | gates reachable by tank from a road: west-wind-farm 2, east-wind-farm 2 |
| building separation ≥ 8 m (oriented footprints) | PASS | all 12 buildings ≥ 8 m apart, rotated ones included |
| mirrored travel times, map layout (from pad centres; target ≤ 5%) | PASS | players paired by mirror-x {'B1': 'R1'}; home deposits worst 0.7% [B1-H1 24.5s vs R1-H2 24.4s]; contested objectives, team vs team, worst 1.2% [E1 blue 81.1s vs red 82.1s]; radar: island-radar blue 175.6s vs red 176.2s (amphibious) |
| mirrored travel times, with the base kit mirrored per start (factory rally point, refinery bays; target ≤ 5%) | PASS | home deposits: tank from the factory rally point worst 0.8% [B1-H2 21.2s vs R1-H1 21.3s]; harvester from the nearest refinery bay worst 1.4% [B1-H2 9.8s vs R1-H1 10.0s] |
| capture radar (220 m) does not reveal base centres | PASS | nearest base centre 1132 m from a radar |
| no floating or buried instances | PASS | 6794 instances checked |
| screenshots for 5 camera presets | PASS | 5 found |

**Provisional moves, approved 2026-11-06:**

- deposit E1: its 50×50 m service area at the specified point reaches into the reserved road band (clear corridor plus 6 m safety band) of the road 38 m away; the rig and service area are offset 2 m to clear it (the specified coordinate is kept as the ore-field reference). Needs approval.
- deposit E2: its 50×50 m service area at the specified point reaches into the reserved road band (clear corridor plus 6 m safety band) of the road 38 m away; the rig and service area are offset 2 m to clear it (the specified coordinate is kept as the ore-field reference). Needs approval.

## 04 · Sunbreak Atoll — 40 pass, 0 warn, 0 fail

| Check | Result | Detail |
|---|---|---|
| terrain size | PASS | 2600 × 2600 m (spec 2600 × 2600) |
| bases: count, team, position | PASS | 4 bases B1 (B) @ (546, 1950) m, B2 (B) @ (546, 650) m, R1 (R) @ (2054, 1950) m, R2 (R) @ (2054, 650) m |
| pad B1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| pad B2 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| pad R1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| pad R2 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 8 m |
| deposit count & coordinates | PASS | 12 deposits (spec 12), ids match: True; 2 home each for ['B1', 'B2', 'R1', 'R2']; all 12 built exactly at their layout coordinates (max 0.00 m) |
| rigs & harvester service points accessible | PASS | harvester reaches 8 service points from a refinery bay; island deposits ['E1', 'E2', 'E3', 'E4'] reachable from their landing-beach aprons (transport/amphibious delivery) |
| asset bounds within 1% | PASS | bld_barracks 24.02×12.00×6.00 (0.08%); bld_vehicle_factory 39.98×30.00×12.00 (0.04%); bld_hq 29.96×23.98×10.00 (0.12%); bld_ore_refinery 36.00×28.00×16.00 (0.01%); bld_power_substation 19.99×15.99×6.00 (0.05%); bld_radar_control 15.91×12.01×6.00 (0.55%); bld_extraction_rig 16.00×12.00×12.00 (0.00%); unit_mbt 9.50×3.60×2.50 (0.00%); unit_apc 7.00×3.00×2.80 (0.00%); unit_harvester 10.00×4.00×4.00 (0.01%); unit_patrol_boat 32.00×7.00×11.00 (0.00%); unit_infantry 0.93×0.56×1.80 (0.00%); prop_container_20 6.06×2.44×2.59 (0.00%); prop_container_40 12.19×2.44×2.59 (0.00%); bld_naval_dock 80.00×40.00×21.00 (0.00%) |
| Sunbreak: no dry east–west route (tanks & infantry) | PASS | tank B↔R reachable: False; infantry B1→R: [None, None] |
| Sunbreak: teammates linked by causeway | PASS | {'B1': {'B1': 0.0, 'B2': 126.00529614646749, 'R1': None, 'R2': None}, 'B2': {'B1': 126.00529614646749, 'B2': 0.0, 'R1': None, 'R2': None}, 'R1': {'B1': None, 'B2': None, 'R1': 0.0, 'R2': 126.00529614646749}, 'R2': {'B1': None, 'B2': None, 'R1': 126.00529614646749, 'R2': 0.0}} |
| causeway west-causeway: own deck, continuous with its approaches; vehicles cross | PASS | deck 10 m (ships route around: underside < 12 m); deck span 520 m on west-team-link (ends within 0 m of the layout), road-to-deck step 0.12 m; tank crossing 53s |
| causeway east-causeway: own deck, continuous with its approaches; vehicles cross | PASS | deck 10 m (ships route around: underside < 12 m); deck span 520 m on east-team-link (ends within 0 m of the layout), road-to-deck step 0.12 m; tank crossing 53s |
| dock B1: ship berth → open sea | PASS | time 67s; narrowest navigable width on route 61 m (≥ 40); turning basin ⌀ 322 m (≥ 80) |
| dock B2: ship berth → open sea | PASS | time 68s; narrowest navigable width on route 68 m (≥ 40); turning basin ⌀ 326 m (≥ 80) |
| dock R1: ship berth → open sea | PASS | time 69s; narrowest navigable width on route 59 m (≥ 40); turning basin ⌀ 342 m (≥ 80) |
| dock R2: ship berth → open sea | PASS | time 67s; narrowest navigable width on route 65 m (≥ 40); turning basin ⌀ 319 m (≥ 80) |
| Sunbreak west lagoon passage open north & south | PASS | north 100.32874686460313, south 99.89784370096032 |
| Sunbreak east lagoon passage open north & south | PASS | north 100.16290084898098, south 99.73833819554761 |
| landing beach 1 @ (1066, 1898) m | PASS | amphibious sea→apron 33s; measured continuous approach width 72 m (rule 60–75 m; layout 75 m); max gradient 7.0% (≤ 8%); measured clear apron 78 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 62 m offshore): 0 |
| landing beach 2 @ (1534, 1898) m | PASS | amphibious sea→apron 32s; measured continuous approach width 72 m (rule 60–75 m; layout 75 m); max gradient 7.0% (≤ 8%); measured clear apron 78 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 62 m offshore): 0 |
| landing beach 3 @ (1066, 702) m | PASS | amphibious sea→apron 33s; measured continuous approach width 70 m (rule 60–75 m; layout 75 m); max gradient 7.0% (≤ 8%); measured clear apron 78 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 61 m offshore): 0 |
| landing beach 4 @ (1534, 702) m | PASS | amphibious sea→apron 32s; measured continuous approach width 72 m (rule 60–75 m; layout 75 m); max gradient 7.0% (≤ 8%); measured clear apron 78 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 60 m offshore): 0 |
| landing beach 5 @ (1196, 1300) m | PASS | amphibious sea→apron 36s; measured continuous approach width 60 m (rule 60–75 m; layout 60 m); max gradient 7.0% (≤ 8%); measured clear apron 51 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 44 m offshore): 0 |
| landing beach 6 @ (1404, 1300) m | PASS | amphibious sea→apron 37s; measured continuous approach width 60 m (rule 60–75 m; layout 60 m); max gradient 7.0% (≤ 8%); measured clear apron 45 m deep (≥ 30, ≤ 5 % graded); coral/rocks in the approach lane (apron to 3 m water, 50 m offshore): 0 |
| tanks cannot drive through deep water (construction) | PASS | the tank layer is built only from dry land and bridge/causeway/dock decks, so tanks cannot enter water by construction; verified: 0 tank-layer cells over water deeper than 1 m off decks, and traced base-to-base tank routes cross 0.00 m of water off decks |
| road longitudinal grade ≤ 6% | PASS | steepest road surface west-team-link 5.80% (graded profile = road mesh, 10 m window); terrain under road centrelines within 0.27 m of the profile away from junctions, bridge decks and abutment joints |
| road cross slope ≤ 2% | PASS | max terrain cross slope across the clear width 0.54% (road meshes are level across; junction and pad-edge zones excluded) |
| waypoints within 8 m; fillets ≥ 20 m where space permits | PASS | max waypoint deviation 2.0 m (north-neutral-road); waypoints inside base pads are served by the base layout; n/a |
| tanks & harvesters clear roads, ramps, corners | PASS | harvester drives every road/ramp run end to end |
| nothing obstructs road clear corridors | PASS | 0 intrusions (blocking footprints, fences, barriers, light poles, cabinets, rocks and tree trunks checked; flush rail crossings, culverts under the road and kerb grates allowed) |
| tanks & harvesters clear factory doors and refinery bays | PASS | factory door 6.0 × 5.0 m clear (tank 3.6 m wide × 2.5 m, harvester 4.0 × 4.0 m); refinery bay 7.0 × 6.0 m; 4 factory aprons 12 m deep clear of footprints, each with a tank route to its rally point |
| no holes, shoreline gaps or z-fighting on main routes (construction) | PASS | heightfield 1301×1301 at 2.0 m, all values finite, meshed as 441 contiguous 128 m chunks sharing edge vertices; one sea plane at z = 0 spans the map and the skirt, and land/water, navigation and rendering all derive from the same heightfield, so the shoreline has no gaps; bridge spans are checked above; road surfaces render 0.06 m and service lanes 0.04 m above the graded terrain, building floors 0.03 m above their pads (no coplanar faces) |
| fenced compounds have ≥ 2 vehicle approaches | PASS | gates reachable by tank from a road: north-research 2, south-solar 2 |
| building separation ≥ 8 m (oriented footprints) | PASS | all 25 buildings ≥ 8 m apart, rotated ones included |
| mirrored travel times, map layout (from pad centres; target ≤ 5%) | PASS | players paired by mirror-x {'B1': 'R1', 'B2': 'R2'}; home deposits worst 1.0% [B1-H2 34.0s vs R1-H1 33.6s]; contested objectives, team vs team, worst 0.2% [radar blue 168.1s vs red 168.5s (amphibious)]; radar: radar blue 168.1s vs red 168.5s (amphibious) |
| mirrored travel times, with the base kit mirrored per start (factory rally point, refinery bays; target ≤ 5%) | PASS | home deposits: tank from the factory rally point worst 1.0% [B1-H1 33.3s vs R1-H2 33.7s]; harvester from the nearest refinery bay worst 0.0% [B1-H1 16.5s vs R1-H2 16.5s] |
| capture radar (220 m) does not reveal base centres | PASS | nearest base centre 995 m from a radar |
| no floating or buried instances | PASS | 7304 instances checked |
| screenshots for 5 camera presets | PASS | 5 found |

**Provisional moves, approved 2026-11-06:**

- road north-neutral-road: its last 86 m run onto landing-beach ramp; the paved surface stops at the beach apron and the beach itself is the access
- road south-neutral-road: its last 90 m run onto landing-beach ramp; the paved surface stops at the beach apron and the beach itself is the access

## 05 · Copperhead Bay — 26 pass, 0 warn, 0 fail

| Check | Result | Detail |
|---|---|---|
| terrain size | PASS | 2400 × 2400 m (spec 2400 × 2400) |
| bases: count, team, position | PASS | 4 bases B1 (B) @ (360, 1920) m, B2 (B) @ (360, 600) m, R1 (R) @ (2040, 1920) m, R2 (R) @ (2040, 600) m |
| pad B1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 12 m |
| pad B2 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 12 m |
| pad R1 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 12 m |
| pad R2 corners on land + slope ≤ 1° | PASS | corners on land: True; max slope 0.00°; height range 0.00 m at 12 m |
| deposit count & coordinates | PASS | 14 deposits (spec 14), ids match: True; 2 home each for ['B1', 'B2', 'R1', 'R2']; 12 built exactly at their layout coordinate; E2 built 50 m from its layout coordinate (offset approved 2026-11-06); E4 built 50 m from its layout coordinate (offset approved 2026-11-06) |
| rigs & harvester service points accessible | PASS | harvester reaches 14 service points from a refinery bay |
| asset bounds within 1% | PASS | bld_barracks 24.02×12.00×6.00 (0.08%); bld_vehicle_factory 39.98×30.00×12.00 (0.04%); bld_hq 29.96×23.98×10.00 (0.12%); bld_ore_refinery 36.00×28.00×16.00 (0.01%); bld_power_substation 19.99×15.99×6.00 (0.05%); bld_radar_control 15.91×12.01×6.00 (0.55%); bld_extraction_rig 16.00×12.00×12.00 (0.00%); unit_mbt 9.50×3.60×2.50 (0.00%); unit_apc 7.00×3.00×2.80 (0.00%); unit_harvester 10.00×4.00×4.00 (0.01%); unit_patrol_boat 32.00×7.00×11.00 (0.00%); unit_infantry 0.93×0.56×1.80 (0.00%); prop_container_20 6.06×2.44×2.59 (0.00%); prop_container_40 12.19×2.44×2.59 (0.00%); bld_naval_dock 80.00×40.00×21.00 (0.00%) |
| required land connections | PASS | B1→B2 136s, B1→R1 152s, B1→R2 240s, B2→R1 240s, B2→R2 217s, R1→R2 136s |
| dock B2: ship berth → open sea | PASS | time 45s; narrowest navigable width on route 100 m (≥ 40); turning basin ⌀ 521 m (≥ 80) |
| dock R2: ship berth → open sea | PASS | time 45s; narrowest navigable width on route 102 m (≥ 40); turning basin ⌀ 525 m (≥ 80) |
| tanks cannot drive through deep water (construction) | PASS | the tank layer is built only from dry land and bridge/causeway/dock decks, so tanks cannot enter water by construction; verified: 0 tank-layer cells over water deeper than 1 m off decks, and traced base-to-base tank routes cross 0.00 m of water off decks |
| road longitudinal grade ≤ 6% | PASS | steepest road surface quarry1-ramp1 5.80% (graded profile = road mesh, 10 m window); terrain under road centrelines within 0.03 m of the profile away from junctions, bridge decks and abutment joints |
| road cross slope ≤ 2% | PASS | max terrain cross slope across the clear width 0.68% (road meshes are level across; junction and pad-edge zones excluded) |
| waypoints within 8 m; fillets ≥ 20 m where space permits | PASS | max waypoint deviation 7.6 m (industrial-boulevard); waypoints inside base pads are served by the base layout; min fillet 26 m |
| tanks & harvesters clear roads, ramps, corners | PASS | harvester drives every road/ramp run end to end |
| nothing obstructs road clear corridors | PASS | 0 intrusions (blocking footprints, fences, barriers, light poles, cabinets, rocks and tree trunks checked; flush rail crossings, culverts under the road and kerb grates allowed) |
| tanks & harvesters clear factory doors and refinery bays | PASS | factory door 6.0 × 5.0 m clear (tank 3.6 m wide × 2.5 m, harvester 4.0 × 4.0 m); refinery bay 7.0 × 6.0 m; 4 factory aprons 12 m deep clear of footprints, each with a tank route to its rally point |
| no holes, shoreline gaps or z-fighting on main routes (construction) | PASS | heightfield 1201×1201 at 2.0 m, all values finite, meshed as 361 contiguous 128 m chunks sharing edge vertices; one sea plane at z = 0 spans the map and the skirt, and land/water, navigation and rendering all derive from the same heightfield, so the shoreline has no gaps; bridge spans are checked above; road surfaces render 0.06 m and service lanes 0.04 m above the graded terrain, building floors 0.03 m above their pads (no coplanar faces) |
| building separation ≥ 8 m (oriented footprints) | PASS | all 28 buildings ≥ 8 m apart, rotated ones included |
| mirrored travel times, map layout (from pad centres; target ≤ 5%) | PASS | players paired by mirror-x {'B1': 'R1', 'B2': 'R2'}; home deposits worst 3.1% [B2-H1 26.9s vs R2-H2 27.7s]; contested objectives, team vs team, worst 2.8% [C1 blue 99.1s vs red 101.9s]; radar: radar blue 137.7s vs red 138.1s |
| mirrored travel times, with the base kit mirrored per start (factory rally point, refinery bays; target ≤ 5%) | PASS | home deposits: tank from the factory rally point worst 1.8% [B2-H1 27.6s vs R2-H2 28.1s]; harvester from the nearest refinery bay worst 0.0% [B1-H1 11.6s vs R1-H2 11.6s] |
| capture radar (220 m) does not reveal base centres | PASS | nearest base centre 905 m from a radar |
| no floating or buried instances | PASS | 8354 instances checked |
| screenshots for 5 camera presets | PASS | 5 found |

**Provisional moves, approved 2026-11-06:**

- deposit E2: a road runs through the specified point, so the 50×50 m service area cannot clear the road corridor and 6 m safety band there; the rig and service area are offset 50 m to clear it (the specified coordinate is kept as the ore-field reference). Needs approval.
- deposit E4: a road runs through the specified point, so the 50×50 m service area cannot clear the road corridor and 6 m safety band there; the rig and service area are offset 50 m to clear it (the specified coordinate is kept as the ore-field reference). Needs approval.


## Shared dimensions: measured mesh bounds

Bounds come from the evaluated meshes in each asset `.blend` (builder JSON) and are re-measured independently in the scale-reference scene (`blender/measure.py`). Excluded parts are listed in each bounds file (antennas, stacks, masts, the tank cupola MG).

| Asset | Spec (m) | Builder bounds (m) | Scale scene (m) | Max error |
|---|---|---|---|---|
| bld_barracks | 24 × 12 × 6 | 24.02 × 12.00 × 6.00 | 24.02 × 12.00 × 6.00 | 0.08% |
| bld_vehicle_factory | 40 × 30 × 12 | 39.98 × 30.00 × 12.00 | 39.98 × 30.00 × 12.00 | 0.04% |
| bld_hq | 30 × 24 × 10 | 29.96 × 23.98 × 10.00 | 29.96 × 23.98 × 10.00 | 0.12% |
| bld_ore_refinery | 36 × 28 × 16 | 36.00 × 28.00 × 16.00 | 36.00 × 28.00 × 16.00 | 0.01% |
| bld_power_substation | 20 × 16 × 6 | 19.99 × 15.99 × 6.00 | 19.99 × 15.99 × 6.00 | 0.05% |
| bld_radar_control | 16 × 12 × 6 | 15.91 × 12.01 × 6.00 | 15.91 × 12.01 × 6.00 | 0.55% |
| bld_extraction_rig | 16 × 12 × 12 | 16.00 × 12.00 × 12.00 | 16.00 × 12.00 × 12.00 | 0.00% |
| unit_mbt | 9.5 × 3.6 × 2.5 | 9.50 × 3.60 × 2.50 | 9.50 × 3.60 × 2.50 | 0.00% |
| unit_apc | 7 × 3 × 2.8 | 7.00 × 3.00 × 2.80 | 7.00 × 3.00 × 2.80 | 0.00% |
| unit_harvester | 10 × 4 × 4 | 10.00 × 4.00 × 4.00 | 10.00 × 4.00 × 4.00 | 0.01% |
| unit_patrol_boat | 32 × 7 × 11 | 32.00 × 7.00 × 11.00 | 32.00 × 7.00 × 11.00 | 0.00% |
| unit_infantry | – × – × 1.8 | 0.93 × 0.56 × 1.80 | 0.93 × 0.56 × 1.80 | 0.00% |
| prop_container_20 | 6.06 × 2.44 × 2.59 | 6.06 × 2.44 × 2.59 | 6.06 × 2.44 × 2.59 | 0.00% |
| prop_container_40 | 12.19 × 2.44 × 2.59 | 12.19 × 2.44 × 2.59 | 12.19 × 2.44 × 2.59 | 0.00% |
| bld_naval_dock | 80 × 40 × – | 80.00 × 40.00 × 21.00 | n/a | 0.00% |

"Max error" is the worst axis of either measurement against the spec.

Additional design dimensions: tank hull 7.50 × 3.60 m (gun-forward 9.50 m, turret roof 2.50 m); patrol boat 9.00 m above water, 2.00 m draft; personnel doors 0.90 × 2.10 m clear; factory vehicle door 6.00 × 5.00 m clear; refinery harvester bay 7.0 × 6.0 m; radar control antenna top 18.00 m; dock deck +3.00 m, berth fender face at local y = −20.00 m.

## Build decisions layered on the layout (`data/overrides.json`)

These values are not in `layouts.json`; they were chosen to meet the written rules and are applied to every map unless noted. Where a structure could not stand exactly at its layout coordinate, it was offset; each case is listed with its distance in the per-map sections, and all of them were approved on the date above.

- **Base kit, substation vs aisle (all bases, approved 2026-11-06):** The specified substation footprint (y -23..-7) overlaps the 12 m service aisle band (y -32..-20) by 3 m. The aisle is kept at y=-26 and full width from x=-90 to +48; east of the refineries it bends 3 m south (centre y=-29) between x=+48 and +90 so the substation keeps its specified centre. Reported as a layout conflict.
- **Landmark 01:container-port:** Port terrace lowered to 6 m with a quay wall on its sea side; the west-flank road keeps its 24 m corridor through the compound.
- **Landmark 02:waterworks:** the central-spine road runs through the compound, which is built as two halves either side of its corridor
- **Landmark 02:radar:** Capture compound straddles the central-spine road; radar mast placed outside the road clear width.
- **Roads:** profile graded to 5.8% (spec ≤ 6%, margin for interpolation); 2.0 m shoulders; 6.0 m safety band; 1:2 side slopes; waypoints held within 7.5 m (spec 8 m); fillets up to 90 m.
- **Docks:** deck +3.0 m; 16 m trestle where the dock stands off the shore; 40×30 m land apron; berth dredged to 6 m; trestle grade ≤ 5.5%.
- **Landing beaches:** 7% ramp (spec ≤ 8%), 32 m flat apron, sand carried to 2.0 m below sea level.
- **Quarries:** 16 m ramp clear width at 5.8%.
- **Base kit layout:** service aisle centred at y = -26 m, 12 m clear; rally point [30, -10]; factory apron 12 m; infantry group at [-75, 0] (local metres from pad centre).

## Blender scenes and renders

| Map | Scene | Instances (of which demo units) | Asset types | Collision boxes | Terrain chunks / tris | Grass clumps (near cameras) | Render times (s) |
|---|---|---|---|---|---|---|---|
| 01 Emerald Strait | scenes/01_emerald_strait.blend | 4601 (38) | 35 | 377 | 225 / 1.28 M | 61272 | overview 52 †, gameplay 30 †, base 229, harbor 204, detail 341 |
| 02 Delta Grid | scenes/02_delta_grid.blend | 14746 (76) | 36 | 407 | 361 / 2.41 M | 41573 | overview 363, gameplay 215, base 130, harbor 254, detail 172 |
| 03 Granite Fjord | scenes/03_granite_fjord.blend | 6794 (38) | 31 | 536 | 256 / 1.82 M | 31579 | overview 354, gameplay 210, base 127, harbor 151, detail 283 |
| 04 Sunbreak Atoll | scenes/04_sunbreak_atoll.blend | 7304 (76) | 34 | 482 | 441 / 2.44 M | 66700 | overview 313, gameplay 216, base 129, harbor 132, detail 172 |
| 05 Copperhead Bay | scenes/05_copperhead_bay.blend | 8354 (66) | 38 | 638 | 361 / 2.53 M | 21625 | overview 409, gameplay 220, base 138, harbor 275, detail 429 |

† GPU renders: Tom's MacBook Air (M1, 16 GB, no fan), Blender 5.2.3 LTS, Cycles GPU · METAL · Apple M1 (GPU - 7 cores), 24 samples + OpenImageDenoise, same cameras and sizes. The first GPU render on a machine compiles the Metal kernels once (158 s, cached afterwards; not included in the times). Emerald Strait overview 52 s vs 375 s on the cloud CPU (7.2× faster); Emerald Strait gameplay 30 s vs 392 s on the cloud CPU (13.0× faster).

Render hardware (unmarked times): cloud VM, 2 vCPU, 7 GB RAM, Cycles CPU, 24 samples + OpenImageDenoise, 1600×900 (overview 1800×1440). Emerald Strait and Delta Grid rendered while the Map Lab browser tests were running, so their times include CPU contention; Granite Fjord, Sunbreak Atoll and Copperhead Bay rendered alone. The scene instance counts match `instances.json` exactly; bridge deck lights are part of the placement data. Scale-reference renders: `renders/scale/lineup_units.png`, `lineup_buildings.png`, `soldier_tank_barracks.png`, `personnel_door.png`, `tank_factory_door.png`, `boat_dock.png`.

## Map Lab (web harness): movement tests and measured performance

| Map | Route tests | Notes |
|---|---|---|
| 01 Emerald Strait | 8/8 | all pass |
| 02 Delta Grid | 24/24 | all pass |
| 03 Granite Fjord | 10/10 | all pass |
| 04 Sunbreak Atoll | 31/31 | all pass |
| 05 Copperhead Bay | 22/22 | all pass |

Performance: Measured in headless Chromium on a software rasteriser (SwiftShader, CPU only) on a 2-CPU VM shared with Blender renders. These numbers are not representative of GPU hardware; draw calls, triangles and instance counts are renderer-independent.
Conditions: viewport 1280×720, "low" quality preset (pixel ratio 0.75, canvas 960×540, no shadows, no MSAA), 3 frames timed per view. This is well below the 1080p target resolution, because a software rasteriser cannot draw these scenes at 1080p in useful time.

| Map | View | Load | FPS (average frame time) | Draw calls | Triangles | Instances drawn / total | JS heap | Stand-in assets |
|---|---|---|---|---|---|---|---|---|
| 01 Emerald Strait | overview | 22 s | 1.32 (756 ms) | 369 | 2.29 M | 1861 / 4596 | 40 MB | none |
| 01 Emerald Strait | gameplay | 22 s | 0.53 (1894 ms) | 126 | 0.40 M | 119 / 4596 | 40 MB | none |
| 02 Delta Grid | overview | 31 s | 1.40 (712 ms) | 518 | 2.11 M | 2281 / 14746 | 58 MB | none |
| 02 Delta Grid | gameplay | 31 s | 0.88 (1139 ms) | 129 | 0.29 M | 54 / 14746 | 58 MB | none |
| 03 Granite Fjord | overview | 107 s | 1.04 (961 ms) | 386 | 2.74 M | 2408 / 6794 | 43 MB | none |
| 03 Granite Fjord | gameplay | 107 s | 0.86 (1161 ms) | 121 | 0.36 M | 207 / 6794 | 43 MB | none |
| 04 Sunbreak Atoll | overview | 34 s | 1.89 (528 ms) | 591 | 2.80 M | 2060 / 7304 | 58 MB | none |
| 04 Sunbreak Atoll | gameplay | 34 s | 1.18 (850 ms) | 132 | 0.28 M | 75 / 7304 | 58 MB | none |
| 05 Copperhead Bay | overview | 81 s | 1.75 (572 ms) | 531 | 3.36 M | 2769 / 8354 | 58 MB | none |
| 05 Copperhead Bay | gameplay | 81 s | 1.37 (728 ms) | 126 | 0.30 M | 92 / 8354 | 58 MB | none |

Renderer string: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. GPU memory cannot be read from WebGL; the JS heap is the only memory figure available in the browser.

**Performance verdict:** the 60 fps desktop target has NOT been measured on a real GPU here, because only a software rasteriser was available. The numbers above are SwiftShader (CPU) figures and only show relative cost: draw calls, triangle counts and instance counts are hardware-independent and are the useful budget figures.

## Known limitations and missing production assets

- **Gameplay integration:** the playable game still runs on its coarse cell grid. These metric maps are inspectable and movement-tested, but they are not yet playable RTS maps.
- **Asset sources:** every asset is original and procedurally generated (Blender Python).
  - There are no photogrammetry or scanned textures.
  - Leaf cards are visible as flat planes in close-ups closer than about 15 m.
  - Scots pine crowns read dark and palm-like at a distance.
- **Grass coverage:** grass geometry is instanced only within about 170 m of the close-up preset cameras. Elsewhere the grass is shader colour and texture only, so a free camera elsewhere sees no grass geometry. (No per-blade objects, per spec.)
- **Biome infrastructure:**
  - Placed from the shared library: kerb drainage grates (stormwater) on the Emerald town road, the Delta spine and the Copperhead boulevard and coast road; pipe racks along the Copperhead industrial boulevard; concrete levee walls (precast barrier lines) and four pump outfalls on Delta Grid's inner channel banks; service fences around Granite Fjord's wind farms.
  - The Delta pump outfalls are composed from a pipe rack and pump cabinets; there is no dedicated pump-house asset.
  - Culverts: the culvert asset exists, but no road on these terrains crosses a drainage line (no streams were added), so none are placed. The only road embankments are pad-grading ramps.
  - Drainage grates are not placed on rural roads.
- **Minimap:** the Map Lab has one; the Blender scenes do not (they are authoring scenes, not a game HUD).
- **Blocking rules:** buildings, rigs, containers, rail wagons, large rocks (scattered rocks above 0.9× scale, coastal boulders ≥ 3 m across, granite slabs standing ≥ 1 m) and cliff pieces block movement and have collision boxes; dense forest interiors block in the navigation layers. Portal and RTG cranes and the Delta pump pipe racks are non-blocking in both navigation and collision, because vehicles pass under their portals and racks; a production build would add leg-only collision. Fences, barriers and light poles are crushable/non-blocking and are kept out of road corridors.
- **Water:** the shader is depth-mapped, not refractive; shallow areas are partially transparent so sand and coral read through.
- **Rock assets:**
  - `rock_limestone_a` could not be replaced by the rock builder (a file-permission boundary). A darker rebuild is staged in `assets/staging/` and is not in use; Emerald Strait uses `rock_limestone_b` instead.
  - Limestone and granite still read pale in strong sun.
- **Tunnel portals** (Granite Fjord) are decorative and sealed, as specified.
- **Optional decorative streams** were not added.
- **Overview views** are orthographic (exact scale bar). Perspective presets carry no scale bar by design.
