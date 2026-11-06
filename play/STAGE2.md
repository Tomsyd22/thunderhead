# Stage 2 — Emerald Strait, playable 1v1 vs AI (working plan and progress log)

Requested 2026-11-06 (Tom): Emerald Strait playable 1v1 vs AI with the new pack units, game speed (default 2.4×) with in-game
sliders, RTS feel standards, automated tests where possible. Priority if usage runs short: orders → controls → movement.
"High attention to details, proper animations, recoil, impact when hit, and all physics correctly done, and they all work
smoothly on game map." Stop after Stage 2 for playtest. Stage 3 (other maps, 4 players, mobile touch) comes after.

## Architecture
`play/` is a new game client built on the Unit Sandbox engine (single sources, copied in by `play/build.py`):
- engine: `units/sandbox/{mech,views,fx,nav,pace}.js` (simulation 30 Hz fixed tick, animation, effects, A* nav, pace model).
  Engine changes must keep `node units/sandbox/test_mech.mjs` and the sandbox browser test passing.
- map: `play/mapdata.js` (Map Lab grids → terrain interface identical to sandbox `makeTerrain()`), `play/maprender.js`
  (terrain, water, instanced props with vegetation LOD, minimap base image) — ported from `maps/lab/lab.js`.
- game: `play/game.js` (players, credits, power, buildings, production queues, rally points, refineries + harvester docks,
  win/lose), `play/ai.js` (AI opponent), `play/ui.js` (sidebar, selection panel, minimap, alerts, tooltips, settings sliders),
  `play/input.js` (mouse/keyboard: selection, orders, control groups, hotkeys, camera), `play/audio.js` (SFX + announcer).
- data: `play/data/` (unit_specs, faction_mapping, pace, buildings table), `play/maps/01/` (Map Lab data), `play/assets/`
  (unit LOD0/1/2 + map assets as glTF JSON).

## Navigation on the real map
Map Lab nav layers are 4 m (`nav.grid.png`, bits infantry 1, tank 2, harvester 4, amphibious 8, ship 16) with class radius
already applied. Upsampled to the engine's 2 m grid: foot ← infantry, veh ← tank, harv ← harvester, ship ← ship,
hover ← tank OR (water depth ≤ 1.2 m and amphibious). Base-kit buildings in instances.json are removed (players build their
own), so pads are re-opened. Placed buildings stamp/unstamp footprints (plus class radius) at runtime with a local clearance
refresh.

## Factions (units/data/faction_mapping.json, approved)
Compact ← Iron Legion (H01 Conscript, H02 Rocket Trooper, H03 Bastion, H04 Hammer, H05 Bulwark as Corvette escort);
Lattice ← Nova (T01 Pulse Trooper android, T02 Nullifier, T03 Wisp, T04 Mote, T05 Trident);
Helix ← Vanguard (A01 Ranger, A03 Arbiter, A04 Kestrel, A05 Sentinel; Missile Specialist dropped).

## Milestones
- M1 map + engine on map: load/render Emerald, RTS camera, units move on map nav, selection + orders with acks.
- M2 economy + base: construction yard start, build menu + placement ghost + radius + queue + refunds, power, refineries
  with docks/queues, harvesters, production + rally points, hotkeys.
- M3 AI + win/lose + alerts/announcer/minimap pings + idle indicators + tooltips + money ticker.
- M4 feel: hit reactions, debris/turret toss, camera shake, formations at slowest speed, control groups, shift queue,
  guard, double-click select, avoidance; jam tests (bridges, gates, docks); automated test suite; publish.

## Files
| file | role |
|---|---|
| `index.html`, `main.js` | page, boot, fixed-tick loop (30 Hz × game speed, interpolated rendering), test probes (`window.__game`) |
| `setup.js` | match setup shared by the client and the headless test (specs + harvester, map nav, World, Game, AI) |
| `mapnav.js` | engine Nav on the Map Lab's 4 m nav layers; base-kit footprints re-opened and re-eroded per class radius |
| `game.js`, `rules.js`, `ai.js` | players, economy, power, production queues, placement, doors / berths / pads, harvesting, AI |
| `present.js` | unit views, projectiles, structures (rise / damage / collapse), hit reactions, debris + turret toss, flash lights, shake, sound cues |
| `camera.js`, `input.js`, `ui.js`, `cameos.js` | RTS camera, mouse + keyboard, sidebar / minimap / HUD / tooltips / screens, build-menu portraits |
| `audio.js` | synthesized SFX (pre-rendered), announcer and unit voices (speech synthesis) — test page `audio_test.html` |
| `mapdata.js`, `maprender.js` | Map Lab port: terrain object, terrain / water / instanced props / minimap |
| `test_sim.mjs`, `test_game.js`, `test_audio.js`, `test_map.js` | headless match, browser suites, audio, map |

## Engine changes for the big map (units/sandbox, single source; sandbox 303/303 still pass)
- nav.js: grid offset + size options (the map's 4 m cells start at −1 m), bounded string pulling, connected regions so an
  unreachable goal retargets to the nearest reachable cell instead of flooding the whole grid, runtime footprints.
- mech.js: buildings placed / removed at runtime (stamped into nav, units nudged off), guard, shift-queue, mixed groups move
  at the slowest member's speed in stacked bands (vehicles in front), shared leader paths, deferred path planning (a unit
  over the per-tick search budget heads straight for the goal at once and gets its route a tick later), a progress
  watchdog (crowded goal = arrived; otherwise replan, then side-step), corner cutting only with a clear line on big cells,
  units inside a fresh footprint may walk out, scripted drive out of narrow refinery bays, finite ore, dock reservations.

## Progress log
- 2026-11-06 22:00 plan written; map renderer port delegated.
- 2026-11-07: M1–M4 built. Headless match test 29/29 (AI vs AI, 12 game minutes, 5 seeds); browser suites written for
  order acknowledgement, controls, building, camera, info, combat, movement (formation, shared refinery dock, route choke),
  smoothness and a 10-minute AI match in the client. Audio module delivered (45/45 offline checks; needs a listen).
- 2026-11-07: published for playtest: https://claude.ai/artifact/24vVtAAX5SVZZUPZG4LpwN (version 1).
  Tests: test_sim 29/29 (seeds 7, 11, 23); test_game 33/33 (boot, acks at 2.4× and 1×, controls, building, camera, info,
  combat, movement, smoothness, 10-minute AI match in the client); test_audio 45/45; sandbox test_mech 303/303 and the
  sandbox browser test still pass with the engine changes.
  Open: audio not auditioned (no audio device here); real-GPU frame rate not measured (SwiftShader only); one AI
  difficulty, and the Compact AI usually beats the others (balance untested); graphics quality applies after a reload;
  enemy units hide when unseen but there is no shroud; Emerald has no bridges, so the jam test uses the narrowest point
  of the main route plus three harvesters sharing one refinery dock.
