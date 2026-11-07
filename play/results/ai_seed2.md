# AI difficulty (round 2)

Headless AI-vs-AI on 01 and 03; 12 matches per batch, up to 40 game minutes; sides and factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw). Seed set 2 (Math.random re-seeded per match).

## Hard vs Normal

| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | B1 / R1 | compact vs lattice | hard (compact) wins | 20.5 | 52063 / 3778 | 36000 / 20500 | 0 | 1 | 13 |
| 2 | 03 | B1 / R1 | lattice vs helix | hard (lattice) wins | 24.9 | 53813 / 300 | 41500 / 14500 | 1 | 0 | 9 |
| 3 | 01 | R1 / B1 | helix vs compact | hard (helix) wins | 22.4 | 47752 / 1909 | 34000 / 24000 | 0 | 1 | 12 |
| 4 | 03 | R1 / B1 | compact vs helix | hard (compact) wins | 31.3 | 60968 / 1564 | 50256 / 24000 | 0 | 0 | 12 |
| 5 | 01 | B1 / R1 | lattice vs compact | hard (lattice) wins | 19.2 | 49574 / 3266 | 31500 / 18000 | 0 | 1 | 10 |
| 6 | 03 | B1 / R1 | helix vs lattice | hard (helix) wins | 25.0 | 67113 / 2122 | 49140 / 15000 | 0 | 1 | 12 |
| 7 | 01 | R1 / B1 | compact vs helix | hard (compact) wins | 28.4 | 54142 / 4509 | 44500 / 26000 | 0 | 0 | 11 |
| 8 | 03 | R1 / B1 | lattice vs compact | hard (lattice) wins | 25.4 | 66214 / 1909 | 48346 / 15000 | 1 | 1 | 12 |
| 9 | 01 | B1 / R1 | helix vs lattice | hard (helix) wins | 24.2 | 59982 / 2830 | 43000 / 21500 | 0 | 1 | 12 |
| 10 | 03 | B1 / R1 | compact vs lattice | hard (compact) wins | 13.8 | 32359 / 8827 | 18500 / 12000 | 0 | 1 | 5 |
| 11 | 01 | R1 / B1 | lattice vs helix | hard (lattice) wins | 28.2 | 47906 / 1894 | 40000 / 27500 | 2 | 0 | 8 |
| 12 | 03 | R1 / B1 | helix vs compact | hard (helix) wins | 28.9 | 67685 / 3275 | 50991 / 21500 | 1 | 1 | 13 |

## Normal vs Normal

| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | B1 / R1 | compact vs lattice | normal (compact) wins on value | 40.0 | 36300 / 15057 | 51550 / 50098 | 0 | 0 | 19 |
| 2 | 03 | B1 / R1 | lattice vs helix | normal (helix) wins | 37.2 | 5006 / 40867 | 47778 / 48358 | 0 | 0 | 13 |
| 3 | 01 | R1 / B1 | helix vs compact | normal (compact) wins | 30.4 | 822 / 32407 | 35500 / 42500 | 0 | 0 | 12 |
| 4 | 03 | R1 / B1 | compact vs helix | normal (helix) wins | 35.8 | 1437 / 47877 | 32500 / 49667 | 0 | 0 | 13 |
| 5 | 01 | B1 / R1 | lattice vs compact | normal (lattice) wins on value | 40.0 | 39318 / 13036 | 53778 / 50359 | 0 | 0 | 14 |
| 6 | 03 | B1 / R1 | helix vs lattice | normal (helix) wins on value | 40.0 | 33550 / 9882 | 53717 / 50000 | 0 | 0 | 15 |
| 7 | 01 | R1 / B1 | compact vs helix | normal (helix) wins on value | 40.0 | 10139 / 42292 | 50345 / 49963 | 0 | 0 | 19 |
| 8 | 03 | R1 / B1 | lattice vs compact | normal (compact) wins on value | 40.0 | 7284 / 24381 | 41500 / 53713 | 0 | 0 | 16 |
| 9 | 01 | B1 / R1 | helix vs lattice | normal (lattice) wins | 27.5 | 6088 / 44622 | 32500 / 36000 | 0 | 0 | 7 |
| 10 | 03 | B1 / R1 | compact vs lattice | normal (compact) wins | 32.7 | 46966 / 3959 | 47500 / 35500 | 0 | 0 | 13 |
| 11 | 01 | R1 / B1 | lattice vs helix | normal (lattice) wins | 24.0 | 43104 / 15433 | 30000 / 32500 | 0 | 0 | 6 |
| 12 | 03 | R1 / B1 | helix vs compact | normal (compact) wins | 9.9 | 4499 / 21614 | 6000 / 7000 | 0 | 0 | 2 |

✓ Hard beats Normal in most matches — 12 wins, 0 losses, 0 draws of 12 (100 %)  
✓ Hard uses its tools: scouting, raids and two-pronged waves — raids in 4/12 matches, two-pronged waves in 8/12  
✓ no resource cheating: every credit held came from start money or harvesting  
✓ control: Normal vs Normal is roughly even (side and faction rotation) — side A 5, side B 7, draws 0

4/4 checks passed
