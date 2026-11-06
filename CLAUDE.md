# Thunderhead — working rules

## Where things run (set 2026-11-06)
- **Two copies of the project:** the cloud workspace (`/home/claude/thunderhead`) and Tom's MacBook Air at
  `~/Thunderhead` (`/Users/tomsyd/Thunderhead`). Keep them in sync with `tools/sync_pack.py`.
  - The script packs every file whose content changed since `.sync/manifest.json` into 24 MB chunks. The device
    transfer refuses files over about 25 MB.
  - Copy the chunks to `~/Thunderhead/.sync_in/` and unpack them in the device shell with
    `cat .sync_in/part_* | tar -xf - -C .`, then remove `.sync_in`.
  - Results made on the Mac (renders, logs) come back the other way.
  - The cloud workspace is reclaimed after inactivity; the Mac copy is the durable one.
- **Blender renders and scene checks run on the Mac** through the Blender connector, on Blender 5.2.3 with Cycles GPU
  compute (Metal, Apple M1 GPU, 7 cores).
  - Every scene's render device is GPU (`tools/blender_gpu.py`, called by every generator).
  - On the cloud VM, which has no GPU, the same files fall back to the CPU.
- **Long renders:** run them as a detached background Blender process (`blender -b --python …`), not inside the
  interactive session, and poll the log.
- **The Mac has no fan:** batch long renders, keep sample counts sensible (24 for previews and checks), and don't queue
  marathons.
- **Frame-rate and feel tests run on the Mac:** fps at 1080p, frame pacing, input latency. The cloud VM only has a
  software rasteriser, so its timings are not representative.

## Source of truth
- **The Python generators are the source of truth:**
  - Maps: `maps/gen/*`, `maps/blender/scene.py`, `maps/assets/src/*`.
  - Units: `units/blender/*`.
  - Game engine: `units/sandbox/*`, copied into `play/engine` by `play/build.py`.
- Any change made through the Blender connector must also go into the generator so it survives regeneration.
- `.blend` files are outputs. Save them from the cloud's Blender 4.5 when both copies must open them: Blender 5.2
  files are not guaranteed to open in 4.5.

## Render commands
- Render a saved map scene on the Mac GPU without rebuilding it:
  `blender -b --python maps/blender/scene.py -- 01 --from-blend --render overview,gameplay --samples 24`
- Render times, samples, device and the GPU warm-up go to `maps/renders/<id>/render_log.json`.
