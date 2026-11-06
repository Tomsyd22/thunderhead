# Thunderhead units: the 15-unit design pack, built and playable

This folder holds the 15 units from the RTS Unit Design Pack: the Iron Legion, the Vanguard Alliance and the Nova Directive. The units are built at true metric scale with Blender. Their mechanics are taken from `data/unit_specs.json` and run in the **Unit Sandbox**, a test range that covers every movement domain.

| Path | What |
|---|---|
| `data/unit_specs.json`, `data/balance_roster.csv` | The pack's authoritative numbers, copied unchanged |
| `CONTRACT.md` | Axes, origins, node names and materials that the sandbox drives |
| `blender/ulib.py` | Shared toolkit: faction palettes, bakeable paint (AO grime, bevel-edge wear, mud, soot), geometry helpers, atlas bake, GLB export, preview sheets |
| `blender/infantry.py` | The six infantry. Each has a skinned body (Skin modifier, distance-weighted 24-bone rig), gear, weapons with grip sockets and deployables |
| `blender/vehicles.py`, `aircraft.py`, `naval.py` | Tanks and the hover tank; the helicopter, jet and drone; the three ships |
| `blender/lods.py` | Distant-view versions: `out/<UID>_lod1.glb`, `out/<UID>_lod2.glb` from the saved LOD0 `.blend`, with the same node tree and names (`out/lods.json` holds the counts) |
| `data/faction_mapping.json` | Approved mapping of the pack units into the game's factions: slots, display names, renames, the Bulwark re-tune and the dropped Missile Specialist |
| `out/<UID>.glb`, `blend/<UID>.blend`, `preview/<UID>_sheet.png` | Exports, sources and Cycles preview sheets (hero view plus front, back, right and top) |
| `sandbox/` | The Unit Sandbox (three.js r160) |
| `VALIDATION.md` | Measured results: model dimensions and triangle counts, the mechanics suite, browser scenario metrics |

## Rebuild

```
/home/claude/blender-env/bin/python units/blender/infantry.py all      # or H01,H02 ...
/home/claude/blender-env/bin/python units/blender/vehicles.py all
/home/claude/blender-env/bin/python units/blender/aircraft.py all
/home/claude/blender-env/bin/python units/blender/naval.py all
/home/claude/blender-env/bin/python units/blender/lods.py all          # LOD1 / LOD2 for every unit
python3 units/sandbox/build_assets.py        # GLB → assets/*.gltf.json, sockets.json, specs copy
node units/sandbox/test_mech.mjs             # mechanics suite (headless)
node units/sandbox/test_sandbox.js --shots   # browser scenarios, probes, screenshots
python3 units/report.py                      # VALIDATION.md
```

## Sandbox files

| File | What |
|---|---|
| `terrain.js` | The 640 × 480 m test range: highlands, a cliff ridge with a pass, a 20° ramp, rock fields, an airfield, a bunker, a shallow lagoon with a dredged mouth, a beach, a sandbar, open sea and an island |
| `nav.js` | Per-domain masks on a 2 m grid: foot, vehicle, hover (land plus ≤ 1.2 m water) and ship (≥ 3 m). Also clearance fields, A* and string pulling |
| `mech.js` | The simulation at a fixed 30 Hz |
| `views.js` | Animation, driven only from interpolated sim state and events |
| `fx.js` | Instanced particles, tracers and ground rings |
| `app.js`, `page.html` → `index.html` | Renderer, UI, input, scenarios and the test clock (`?manual=1`, `__sb.advance`; `?gs=` overrides game speed) |
| `econ.js` | The economy test layout: one drive-through ore refinery and two extraction rigs (near field, far field over the pass), plus the harvester's spec |
| `pace.js`, `data/pace.json` | Copies of the shared pace model and settings (source: repo `data/`, synced by `data/sync_pace.py`) |

`mech.js` covers:
- **Locomotion** for infantry, tracked vehicles (pivot turns, track speeds), hovercraft (inertia, charge slow-down), helicopters, drones, jets (12 m turn radius, sorties) and ships (rudder authority, turning room, astern recovery).
- **Weapons**: hitscan, ballistic with lead, guided with turn limits and bombs with splash, plus firing locks, bursts, wind-ups and pre-fire charges.
- **Unit abilities**: deploy, EMP, scan, garrison and veterancy.
- **Simulation rules**: visibility with terrain occlusion, and capsule collisions with formation spacing.

`views.js` covers:
- **Infantry**: IK gait with foot locking, aim and recoil, deploy and death.
- **Ground vehicles**: track scroll per side, wheels, turret, gun and recoil, antenna sway, terrain attitude.
- **Aircraft and ships**: rotors and discs, gear and control surfaces, hull lean, wakes and missile lids.

**Pace.** The side panel has **Game speed** and **Harvester speed** sliders, with defaults from `data/pace.json`.
- **Game speed** is a uniform time scale: the 30 Hz simulation runs that many times faster. **Playback** (Pause, ¼×, 1×, 2×) multiplies it for close inspection.
- The **Economy** scenario runs one harvester: grate → field → load → back → pivot → reverse onto the grate → unload.
- The panel shows each field's predicted round trip next to the last measured one, in real seconds.

Controls: left-click selects; shift-drag box-selects; right-click moves or attacks. **A** attack-move, **S** stop, **D** deploy/pack, **F** ability, **G** garrison. Q/E rotate, the wheel zooms, and dragging pans.
