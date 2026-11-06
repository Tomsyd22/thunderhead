# Thunderhead — metric map environments

This folder holds five true-scale RTS environments built from the authoritative layout data in `data/layouts.json`. Each map has an editable Blender scene, the shared generation code and asset library, renders of the five camera presets, a scale-reference scene, a web Map Lab for map selection and movement testing, and a validation report (`VALIDATION.md`).

**Status.** These are inspectable, movement-tested environments. They are **not yet playable RTS maps**: the Thunderhead game still runs on its own coarse cell grid and has not been switched to these metric maps. The approved layout revisions (old and new coordinates) and anything still open are listed at the top of `VALIDATION.md`.

| # | Map | Size | Mode | Seed |
|---|---|---|---|---|
| 01 | Emerald Strait | 1800 × 1800 m | 1v1 | 4101 |
| 02 | Delta Grid | 2400 × 2400 m | 2v2 | 4102 |
| 03 | Granite Fjord | 2000 × 2000 m | 1v1 | 4103 |
| 04 | Sunbreak Atoll | 2600 × 2600 m | 2v2 naval | 4104 |
| 05 | Copperhead Bay | 2400 × 2400 m | 2v2 | 4105 |

## Engine and conventions

- **Tools.** Blender 4.5 LTS is the authoring and rendering tool, run headless as the `bpy` Python module. The project's own engine is Three.js, used by the Map Lab and the game. Unity is not used, because the project already has an engine.
- **Units and axes.** 1 unit = 1 metre. +X is east, +Y is north, +Z is up, and the origin is the south-west map corner. Layout coordinates `q` (0–1000) convert to metres as `q × size_m / 1000`. All heights and dimensions in the layout are already in metres.
- **Mapping to Unity.** The spec's Unity mapping `(east, height, north)` corresponds to Blender `(x, z, y)` and to Three.js `(x, y, −z)`.
- **Determinism.** The same seed and data always reproduce the same output. Instance IDs are stable (`<map>-<category>-<index>`).
- **Base kit.** Every start uses the same kit, mirrored per start so the factory side faces the map centre and the refineries face that start's home deposits (identity, mirror-x, mirror-y or a 180° rotation; see `instances.json` → `kits`). Buildings are rigid, unmirrored models.

## Layout

```
data/        layouts.json (original specification, never edited) · layout_revisions.json (approved changes applied on top, old → new) ·
             biomes.json (art config) · overrides.json (derived build decisions, all reported)
gen/         mapgen.py   terrain masks → heights (spec precedence) → pads → graded roads/bridges/docks → beaches → noise
             place.py    base kits, demo units, deposits, docks + boats, landmark compounds, forests, rocks, cliffs, surface classes
             navcheck.py infantry / tank / harvester / amphibious / ship layers + all acceptance checks → validation.json, ../VALIDATION.md
             export_web.py  web data for the Map Lab · preview.py  top-down diagnostics · assets.py  footprint registry
             report.py   compiles VALIDATION.md · contact_sheet.py  renders/contact_sheet.png
assets/      src/*.py generators · blend/<asset>.blend · glb/<asset>.glb (baked, web) · bounds/<asset>.json · preview/*.png
blender/     scene.py    assembles a map scene, renders the five presets · measure.py  scale-reference scene
build/<id>/  generated arrays (height.npy, masks.npz, surface.npz, nav.npz) + meta/instances/validation json + preview.png
scenes/      <id>_<name>.blend (five maps) · 00_scale_reference.blend
renders/<id>/preset_1..5_*.png · renders/scale/*.png · renders/contact_sheet.png
lab/         Map Lab (index.html + lab.js) and its data/
```

## Opening

- **Blender scenes.** Open `scenes/<id>_<name>.blend` in Blender 4.5 LTS (or newer). Everything is in metres; the active camera is `CAM_1_overview`, and the other presets are in the `CAMERAS` collection (select one, then View → Cameras → Set Active Object as Camera). Turn off the `DEMO` collection for an empty multiplayer start. `scenes/00_scale_reference.blend` holds the measured line-up and the four scale vignettes.
- **Map Lab (map selector and movement tests).** Serve the `lab/` folder over HTTP and open it in a browser:
  ```bash
  cd maps/lab && python3 -m http.server 8000      # then open http://localhost:8000
  ```
  It loads three.js r160 from `cdn.jsdelivr.net`, so the first load needs internet access. It is also published as a private claude.ai artifact. Pick a map from the tabs; `#03` or `?quality=high` in the URL select a map or quality directly.
- **Pace report.** `PACE.md`: harvester round trips to every deposit and base-to-base times on every map at the `data/pace.json` game speed (`node maps/lab/test_pace.js`, then `python3 maps/gen/pace_report.py`).
- **Renders.** `renders/<id>/preset_1..5_*.png`, `renders/scale/*.png`, and `renders/contact_sheet.png` (all maps × all presets).

## Camera controls (Map Lab)

| Input | Action |
|---|---|
| Left-drag, or W A S D / arrow keys | Pan |
| Right-drag, or Q / E | Orbit |
| Wheel or pinch | Zoom (towards the cursor) |
| Click | Select a unit, building or dot and inspect it (Inspect tab) |
| Minimap (bottom-left) | Click or drag to move the camera there |
| Camera views panel | The five presets: overview, gameplay, base, harbour, biome detail |
| Move tab → Pick start & end | Two clicks plot a route for the chosen movement class (infantry, tank, harvester, amphibious, ship) |
| Tests tab → Run route tests | Runs the map's standard routes on the baked navigation grid |
| Pace tab | **Game speed** and **Harvester speed** sliders (defaults from `data/pace.json`). **Measure this map** gives every deposit's harvester round trip and every base-to-enemy-base drive in real seconds. Each route is driven with the Unit Sandbox's vehicle rules. Route and test times elsewhere in the Lab also show real seconds at the chosen game speed. |
| Overlays panel | Metric grid, asset bounds, base reservations, collision shapes, navigation, height, water depth, resource IDs and harvester routes, road corridors, starts and radar |

## Exports

- **Assets.** One glTF binary per asset in `assets/glb/` (with `assets/bounds/<asset>.json` dimensions, doors and excluded parts), and the editable source `.blend` in `assets/blend/`.
- **Map data for any engine.** `build/<id>/`: `height.npy` (2 m heightfield), `nav.npz` (bit-flag traversal layers: 1 infantry, 2 tank, 4 harvester, 8 amphibious, 16 ship), `surface.npz`, `meta.json` (pads, roads with graded profiles, bridges, docks, beaches, deposits) and `instances.json` (every placed object with a stable ID; units carry `cat: "demo"`, so filtering them out gives the empty multiplayer start).
- **Web copies.** `lab/data/<id>/` holds the same grids as PNG, plus `map.json` with collision boxes, harvester test routes and camera presets.
- **From Blender.** Each `.blend` exports with File → Export → glTF. Leave `DEMO` and `COLLISION` out for a clean environment, or export `COLLISION` on its own as the coarse collision mesh.

## Regenerating

```bash
PY=/home/claude/blender-env/bin/python          # Blender 4.5 as a Python module (bpy) + numpy/scipy/scikit-image/Pillow
$PY maps/gen/mapgen.py all                      # terrain + roads (seconds per map)
$PY maps/gen/place.py all                       # placement + surface classes
$PY maps/gen/navcheck.py all                    # navigation layers + checks → maps/VALIDATION.md
$PY maps/assets/src/buildings.py all            # asset library (also units.py, props.py, nature.py; add --glb for web copies)
$PY maps/blender/scene.py 01 --render all       # scene + five renders (repeat per map id)
$PY maps/blender/measure.py --render            # scale-reference scene
$PY maps/gen/export_web.py all && python3 maps/lab/make_manifest.py --sync && python3 maps/lab/make_web_safe.py   # Map Lab data (GLB → glTF JSON, grids → PNG for web serving)
node maps/lab/test_lab.js [01 02 …]             # headless Map Lab: route tests, preset screenshots, measured perf → lab/route_tests.json, lab/perf.json
$PY maps/gen/report.py && python3 maps/gen/contact_sheet.py   # VALIDATION.md from all measured results · contact sheet of every render
```

Each step replaces its outputs completely, so nothing is duplicated. Regenerating a scene rebuilds the `.blend` from data. To change a map, edit the data files and regenerate, rather than editing the generated scene. Hand edits in a `.blend` survive only until it is next regenerated.

## Inside a scene

Each `.blend` is organised into collections:

| Collection | Contents |
|---|---|
| `TERRAIN` | 128 m chunks at 2 m resolution, plus a non-playable scenery skirt |
| `WATER` | the water surface |
| `ROADS` | graded road meshes with markings |
| `STRUCTURES` | bridges, piers, trestles and service lanes |
| `INSTANCES` | one point cloud per asset, instanced with Geometry Nodes. Move or delete points to edit. The stable IDs, one per point in point order, are in the Text block named in each object's `instance_ids_text` property (`ids_<asset>`). |
| `DEMO` | demonstration units only: tanks, harvesters on their test routes, infantry, patrol boats and dock crews. Disable it for an empty multiplayer start. |
| `COLLISION` | coarse static collision: one box per blocking footprint (wireframe, never rendered). It is independent of visual LOD and matches the navigation footprints. |
| `GRASS` | grass clumps near the close-up cameras |
| `OVERLAY` | boundary, starts, deposits, routes, radar and docks, rendered only in the overview |
| `CAMERAS` | `CAM_1_overview` to `CAM_5_detail` |

`LIB` holds the appended asset collections. It is excluded from the view layer and instanced by the point clouds.

## Camera presets

1. **Overview.** Orthographic top-down view of the whole map with overlays and an exact scale bar (metres per pixel is printed).
2. **Gameplay.** About 220 m oblique RTS view at unchanged world scale.
3. **Base close-up.** Soldier beside a tank and the barracks, with the factory behind.
4. **Harbour close-up.** Patrol boat, dock and personnel.
5. **Biome detail.** A close-up specific to each map's biome.

Perspective renders carry no survey scale bar, by design: a fixed bar would be wrong across a perspective view.
