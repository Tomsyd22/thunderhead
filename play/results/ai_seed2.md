# AI difficulty (round 2)

Headless AI-vs-AI on 01 and 03; 12 matches per batch, up to 40 game minutes; sides and factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw). Seed set 2 (Math.random re-seeded per match).

## Hard vs Normal

| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | B1 / R1 | compact vs lattice | hard (compact) wins | 20.5 | 52063 / 3778 | 36000 / 20500 | 0 | 1 | 19 |
| 2 | 03 | B1 / R1 | lattice vs helix | hard (lattice) wins | 24.1 | 59299 / 1882 | 41500 / 13000 | 1 | 1 | 10 |
| 3 | 01 | R1 / B1 | helix vs compact | hard (helix) wins | 22.4 | 47752 / 1909 | 34000 / 24000 | 0 | 1 | 11 |
| 4 | 03 | R1 / B1 | compact vs helix | hard (compact) wins | 26.3 | 63048 / 3708 | 45000 / 19500 | 0 | 0 | 14 |
| 5 | 01 | B1 / R1 | lattice vs compact | hard (lattice) wins | 19.2 | 49574 / 3266 | 31500 / 18000 | 0 | 1 | 12 |
| 6 | 03 | B1 / R1 | helix vs lattice | hard (helix) wins | 25.0 | 67113 / 2122 | 49140 / 15000 | 0 | 1 | 16 |
| 7 | 01 | R1 / B1 | compact vs helix | hard (compact) wins | 29.8 | 68531 / 2954 | 52000 / 24000 | 0 | 0 | 16 |
| 8 | 03 | R1 / B1 | lattice vs compact | hard (lattice) wins | 25.4 | 66214 / 1909 | 48346 / 15000 | 1 | 1 | 16 |
| 9 | 01 | B1 / R1 | helix vs lattice | hard (helix) wins | 24.2 | 59982 / 2830 | 43000 / 21500 | 0 | 1 | 18 |
| 10 | 03 | B1 / R1 | compact vs lattice | hard (compact) wins | 13.8 | 32359 / 8827 | 18500 / 12000 | 0 | 1 | 8 |
| 11 | 01 | R1 / B1 | lattice vs helix | hard (lattice) wins | 25.3 | 49942 / 2570 | 36500 / 22000 | 1 | 0 | 12 |
| 12 | 03 | R1 / B1 | helix vs compact | hard (helix) wins | 28.9 | 67685 / 3275 | 50991 / 21500 | 1 | 1 | 19 |

## Normal vs Normal

| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | B1 / R1 | compact vs lattice | normal (compact) wins on value | 40.0 | 36300 / 15057 | 51550 / 50098 | 0 | 0 | 31 |
| 2 | 03 | B1 / R1 | lattice vs helix | normal (lattice) wins | 23.3 | 43533 / 10594 | 32500 / 29000 | 0 | 0 | 10 |
| 3 | 01 | R1 / B1 | helix vs compact | normal (compact) wins | 14.7 | 412 / 30930 | 9000 / 16500 | 0 | 0 | 5 |
| 4 | 03 | R1 / B1 | compact vs helix | normal (compact) wins | 14.9 | 30134 / 11644 | 14000 / 16500 | 0 | 0 | 5 |
| 5 | 01 | B1 / R1 | lattice vs compact | normal (lattice) wins on value | 40.0 | 39318 / 13036 | 53778 / 50359 | 0 | 0 | 22 |
| 6 | 03 | B1 / R1 | helix vs lattice | normal (lattice) wins | 25.1 | 11431 / 38837 | 35500 / 31500 | 0 | 0 | 11 |
| 7 | 01 | R1 / B1 | compact vs helix | normal (compact) wins | 21.7 | 39780 / 15381 | 26000 / 29000 | 0 | 0 | 9 |
| 8 | 03 | R1 / B1 | lattice vs compact | normal (compact) wins on value | 40.0 | 7284 / 24381 | 41500 / 53713 | 0 | 0 | 17 |
| 9 | 01 | B1 / R1 | helix vs lattice | normal (lattice) wins | 15.4 | 9158 / 29331 | 15000 / 15000 | 0 | 0 | 3 |
| 10 | 03 | B1 / R1 | compact vs lattice | normal (compact) wins | 32.7 | 46966 / 3959 | 47500 / 35500 | 0 | 0 | 13 |
| 11 | 01 | R1 / B1 | lattice vs helix | normal (lattice) wins | 13.9 | 28681 / 6166 | 12000 / 13000 | 0 | 0 | 3 |
| 12 | 03 | R1 / B1 | helix vs compact | normal (compact) wins | 13.9 | 5059 / 30412 | 9500 / 15000 | 0 | 0 | 3 |

✓ Hard beats Normal in most matches — 12 wins, 0 losses, 0 draws of 12 (100 %)  
✓ Hard uses its tools: scouting, raids and two-pronged waves — raids in 4/12 matches, two-pronged waves in 9/12  
✓ no resource cheating: every credit held came from start money or harvesting  
✓ control: Normal vs Normal is roughly even (side and faction rotation) — side A 7, side B 5, draws 0

4/4 checks passed
