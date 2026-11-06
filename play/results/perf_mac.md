# Frame rate and feel on the Mac (round 1, 2026-11-07)

MacBook Air M1 (7-core GPU, 16 GB), Claude desktop app's browser pane (Chromium, ANGLE Metal), viewport emulated at
1920 × 1080 (game canvas 1920 × 1040 below the frame header), device pixel ratio 1. Emerald Strait, Compact vs Lattice,
a 28-unit battle staged in front of the base; the camera sweeps base → battle → close battle → mid → wide map (20–30 s).
Measured in the page with `play/bench.js` (frame times from requestAnimationFrame; input-to-frame = a real pointer event
on the canvas → order acknowledged → first frame with it submitted).

| preset | dynamic res | render size | fps avg | 1 % low | frame p50 / p95 / p99 (ms) | input → frame median | notes |
|---|---|---|---|---|---|---|---|
| Low | off (preset) | 1440 × 780 (0.75 scale) | 58.6 | 16.5 | 16.7 / 17.5 / 17.7 | 17 ms | two 170–180 ms stalls at camera moves (before shader prewarm) |
| Medium | off | 1920 × 1040 | 52.8 | 17.5 | 16.7 / 33.4 / 34.3 | 17 ms | GPU-bound in the wide view (33 ms frames) |
| High | off | 1920 × 1040 | 42.9 | 11.4 | 16.7 / 34.1 / 49.9 | 65 ms | GPU-bound; deep GPU queue adds latency; 2.3 M triangles |
| High | on | 1344 × 728 at the end (0.7) | 57.1 | 23.8 | 16.7 / 18.7 / 33.4 | 20 ms | prewarm on |
| Medium | on | 1344 × 728 at the end (0.7) | 59.8 | 41.4 | 16.7 / 18.5 / 18.7 | 19 ms | prewarm on; 30 s run |

Changes from these measurements: shader/mesh prewarm at match start (camera-move stalls 60–190 ms → 50–70 ms), and
dynamic resolution on medium/high (70–100 % of the preset scale, backs off after failed step-ups).
CPU per frame stays small on every preset: simulation tick p50 ≈ 1.1 ms, render submission p50 ≈ 2–3 ms — the limit is
the M1's GPU fill rate (MSAA + AO + shadows at full 1080p in the wide view).
