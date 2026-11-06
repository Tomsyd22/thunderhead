# Thunderhead maps — shared asset contract

Every asset for the five metric maps (Emerald Strait, Delta Grid, Granite Fjord, Sunbreak Atoll, Copperhead Bay) follows these rules so the map assembler (`maps/blender/scene.py`) and the web Map Lab can use it without special cases. Read `maps/ref/build-prompt.txt` (sections 2, 3, 7, 8) for the art direction, and look at the concept images `maps/ref/concept_*.png` (0 Copperhead, 1 Delta, 2 Emerald, 3 Granite, 4 Sunbreak, 5–8 scale sheets with base and harbour close-ups) for the target look: grounded modern-military realism, light-grey concrete and corrugated steel buildings with restrained blue or red accent bands, yellow safety stripes, believable industrial detail.

## Tools
- Blender 4.5 LTS as a Python module: run scripts with `/home/claude/blender-env/bin/python script.py` (headless, no UI). `bpy` must be imported before `bmesh`.
- Existing helper library: `/home/claude/thunderhead/blender/lib.py` (box, cyl, sphere, profile_extrude, bev, boolean, array, join, shade, paint_mat, flat_mat, uv_unwrap, bake_atlas, preview, export, tris). Import it with `sys.path.insert(0, '/home/claude/thunderhead/blender')`. You may add helpers in your own module; do NOT edit lib.py (other people use it).
- The machine has **2 CPUs and 7 GB RAM** shared with other builders. Run one Blender process at a time; preview renders at ≤ 800 px with ≤ 32 Cycles samples (denoise on); bakes at ≤ 1024 px, ≤ 16 samples. Use `timeout` on long commands.

## Units, axes, origin
- 1 Blender unit = 1 metre. +X = east, +Y = north, +Z = up.
- Buildings: origin at the centre of the footprint at ground level (z = 0). Footprint length runs along X (east–west), width along Y (north–south), at rotation 0. The vehicle factory's main door faces south (−Y).
- Vehicles and boats: origin at ground (or waterline for boats) under the hull centre; front faces +X.
- Vegetation and rocks: origin at the trunk base / ground contact; rocks may sink up to 15% of their height below z = 0.
- The **actual mesh bounds** must match the specified dimensions within 1%. Objects that legitimately exceed them (antennas, stacks, masts, gun barrel overhang where specified) carry the custom property `exclude_bounds = True`.

## Materials
- Procedural Cycles materials are welcome (they are what the high-quality renders use). Keep them physically plausible: no pure flat colours, no uniformly shiny surfaces. Add grime, edge wear, panel seams, stains and colour variation.
- Name the team-accent material exactly `TEAM_ACCENT` (mid grey in the source file). The assembler swaps it for blue (#2B6FD6) or red (#C8322B). Use it only for accent bands, stripes, flags and markings, never for whole buildings.
- Name emissive light materials starting `GLOW` and glass starting `GLASS`.

## Outputs per asset `<name>` (lower_snake_case with a group prefix: `bld_`, `unit_`, `prop_`, `veg_`, `rock_`)
1. `maps/assets/blend/<name>.blend`: a scene containing ONE collection named `<name>` that holds all of the asset's objects (modifiers applied, transforms applied, origin as above). Save with `bpy.ops.wm.save_as_mainfile(filepath=..., compress=True)`.
2. `maps/assets/glb/<name>.glb`: a web copy whose procedural materials are baked into one atlas (≤ 1024 px; use lib.bake_atlas or your own bake), keeping `TEAM_ACCENT` as an unbaked flat material named `TEAM` and lights as `GLOW`. Do the bake AFTER saving the .blend, because baking replaces materials.
3. `maps/assets/bounds/<name>.json`: `{"name", "size_m": [x, y, z], "min": [...], "max": [...], "spec_m": [x, y, z] or null, "tris": int, "excluded": ["objects not counted"], "notes": "..."}`. Measure the actual evaluated mesh bounds, excluding `exclude_bounds` objects. Buildings also add `"doors": [{"kind": "personnel"|"vehicle", "center": [x, y, z], "clear_w": m, "clear_h": m, "facing": "-Y"}]`.
4. `maps/assets/preview/<name>.png`: a Cycles preview (lib.preview or similar) with a 1.8 m reference figure or a 1 m grid nearby.
- Generator scripts go in `maps/assets/src/` (one file per group, with a CLI such as `python maps/assets/src/buildings.py [name|all]`).
- Polygon budgets: trees ≤ 4k tris LOD0, plus an `<name>_lod1` collection (≤ 500 tris) in the same .blend and a `<name>_lod1.glb`; buildings ≤ 25k tris; units ≤ 15k tris; small props ≤ 2k tris.
