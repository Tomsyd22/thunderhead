# Thunderhead — RTS design bible, balance simulator and game

- `data/rules.js`        shared rules: economy, power, veterancy, armour × warhead matrix, hacking, EMP, superweapons
- `data/lattice.js`      Faction 1: The Lattice (drone/AI war) — every structure and unit
- `data/compact.js`      Faction 2: The Compact (Cold War 2.0 superpower)
- `data/helix.js`        Faction 3: Helix Dynamics (cyberpunk megacorp)
- `sim/sim.js`           balance stress test: `node sim/sim.js` → prints and writes `sim/report.txt`
- `sim/gen-doc.js`       regenerates the design-bible faction tables from the data files into `doc/*.md`
- `game/`                the game (Milestones 1–4)
  - `map.js`             six map presets (point/quad symmetry), civilian/tech structures, JSON map serialisation
  - `editor.js`          in-game map editor (paint terrain/ore/buildings/starts, mirror modes, save/download/load/play)
  - `sim.js`             simulation core (no DOM): economy, pathing, combat, production, infiltration, salvage; 2–4 players with teams
  - `depth.js`           unit abilities, superweapons, doctrines, mines/wrecks/fields (spliced into sim.js)
  - `ai.js`              the AI: five difficulty knob sets, role lists, build orders, state machine (spliced into sim.js)
  - `render.js`          PixiJS renderer (procedural sprites, fog, effects)
  - `audio.js`           synthesized SFX and speech
  - `ui.js`              HUD, mouse/touch input, main loop
  - `shell.html`         page shell (Midnight design tokens, phone layout)
  - `build.js`           `node game/build.js` → `game/dist/thunderhead.html` (CDN Pixi) and `game/dist/local.html`
  - `test.js`            Playwright play-test of the built page (`node game/test.js`)
  - `headless.js`        AI-vs-AI harness, no browser: `node game/headless.js matrix 4` runs every difficulty
                         against every other; `node game/headless.js one compact hard lattice normal 11 1500` runs one match
- `art/`                 the art pipeline (Milestone 5)
  - `models.js`          parametric 3D model for every unit/structure + faction palettes (edit here to change how a unit looks)
  - `render.html`        Three.js renderer: 16 facings, turrets, team-colour masks, outlines, shadows → packed atlases
  - `build-atlas.js`     `node art/build-atlas.js [faction]` renders the atlases into `art/out/` (needs Playwright + Chromium)
  - `../game/artreview.js` `node game/artreview.js helix 2` screenshots every model of a faction in-game for review
- `proto/`               the first canvas prototype (kept for `proto/voice.js`, the original voice lines)
- `research/*.md`        RA2 / Yuri's Revenge / RA3 / Uprising reference compiled from the games' rules files and wikis

Workflow: edit a number in `data/*.js` → `node sim/sim.js` → `node game/headless.js matrix 2` → `node game/build.js` → `node game/test.js`. Art: edit `art/models.js` → `node art/build-atlas.js` → `node game/build.js` → `node game/artreview.js <faction>`. One source of truth.

## 3D renderer and the Blender pipeline

The game renders in real-time 3D with Three.js (`game/render3d.js`, bundled from `vendor/three-bundle.js`). One scene unit is one map cell. Units built in Blender load from `blender/out/*.glb`; any unit without a Blender model falls back to the stand-in built from `art/models.js`.

- **Blender 4.5 LTS as a Python module**: install with `python3.11 -m venv blender-env && blender-env/bin/pip install bpy==4.5.*`, then run any model script with `blender-env/bin/python`.
- `blender/lib.py` holds the modelling helpers, the procedural paint materials (camo, grime, edge wear, panel lines), the Cycles atlas baking and the glTF export. Named nodes the game drives: `turret`, `gun`, `muzzle`, `wheel_*`, `track_L/R`, `pod_*`. Material names it reacts to: `TEAM` (player colour), `GLOW` (emissive), `TRACK` (scrolling treads).
- `blender/models/tanks.py`: the Bastion, Arbiter and Phalanx (`python models/tanks.py all`).
- `blender/models/humanoid.py`: the rigged infantry (Rifleman, Contractor). Clips: idle, walk, walk_aim, aim, fire and die.
- `blender/models/drones.py`: the Scuttler, a six-legged drone with a tripod gait. Clips: idle, walk, aim, fire and die.
- `blender/models/props.py`: two boulders, a crystal cluster, a shrub and a conifer, instanced across the map.
- `blender/textures/terrain_detail.py`: a tileable RGBA height/detail texture. The terrain shader uses it for albedo, per-pixel bump and height-based blending between ground, sand, rock and road.
- `blender/preview/` holds Cycles renders of every model.

`node game/build.js` embeds every GLB and PNG in `blender/out/` into the single-file build. Three test scripts check the result:
- `node game/showcase.js` gives in-game close-ups of the Blender units (idle, walk, fire, die).
- `node game/shot3d.js [faction] [map]` stages a battle.
- `node game/test.js` is the full play-test.
