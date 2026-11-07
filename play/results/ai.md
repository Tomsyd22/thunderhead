# AI difficulty (round 2)

Headless AI-vs-AI on 01 and 03; 12 matches per batch, up to 40 game minutes; sides and factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw). Seed set 1 (Math.random re-seeded per match).

## Hard vs Normal

| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | B1 / R1 | compact vs lattice | hard (compact) wins | 24.5 | 59698 / 4571 | 46500 / 24000 | 0 | 1 | 24 |
| 2 | 03 | B1 / R1 | lattice vs helix | hard (lattice) wins | 23.8 | 57268 / 2879 | 40500 / 12500 | 1 | 1 | 9 |
| 3 | 01 | R1 / B1 | helix vs compact | hard (helix) wins | 23.4 | 54026 / 4944 | 38500 / 25500 | 0 | 1 | 13 |
| 4 | 03 | R1 / B1 | compact vs helix | hard (compact) wins | 29.4 | 65628 / 4569 | 50049 / 21000 | 0 | 0 | 17 |
| 5 | 01 | B1 / R1 | lattice vs compact | hard (lattice) wins | 17.8 | 45313 / 2858 | 26500 / 16500 | 0 | 1 | 13 |
| 6 | 03 | B1 / R1 | helix vs lattice | hard (helix) wins | 25.3 | 67022 / 2954 | 49640 / 16000 | 1 | 1 | 17 |
| 7 | 01 | R1 / B1 | compact vs helix | hard (compact) wins | 27.7 | 59306 / 6156 | 45000 / 29000 | 0 | 0 | 19 |
| 8 | 03 | R1 / B1 | lattice vs compact | hard (lattice) wins | 25.8 | 64633 / 4904 | 46500 / 18000 | 0 | 1 | 13 |
| 9 | 01 | B1 / R1 | helix vs lattice | hard (helix) wins | 23.7 | 58249 / 2008 | 40000 / 18500 | 2 | 1 | 17 |
| 10 | 03 | B1 / R1 | compact vs lattice | hard (compact) wins | 25.6 | 70270 / 2241 | 51312 / 12000 | 0 | 1 | 18 |
| 11 | 01 | R1 / B1 | lattice vs helix | hard (lattice) wins | 23.4 | 44209 / 1495 | 32000 / 22000 | 1 | 1 | 11 |
| 12 | 03 | R1 / B1 | helix vs compact | hard (helix) wins | 26.9 | 65404 / 2172 | 48393 / 21000 | 2 | 1 | 21 |

## Normal vs Normal

| # | map | sides | factions | result | at (game min) | value | mined | raids | flank waves | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | B1 / R1 | compact vs lattice | normal (lattice) wins | 39.6 | 9554 / 37815 | 51048 / 50322 | 0 | 0 | 25 |
| 2 | 03 | B1 / R1 | lattice vs helix | normal (lattice) wins | 17.5 | 38034 / 8984 | 22000 / 19000 | 0 | 0 | 4 |
| 3 | 01 | R1 / B1 | helix vs compact | normal (compact) wins | 18.4 | 5024 / 40606 | 13500 / 24000 | 0 | 0 | 5 |
| 4 | 03 | R1 / B1 | compact vs helix | normal (compact) wins | 14.8 | 27586 / 8288 | 13500 / 15000 | 0 | 0 | 4 |
| 5 | 01 | B1 / R1 | lattice vs compact | normal (lattice) wins on value | 40.0 | 37583 / 22466 | 53778 / 50788 | 0 | 0 | 25 |
| 6 | 03 | B1 / R1 | helix vs lattice | normal (lattice) wins | 29.8 | 3128 / 40407 | 39500 / 38000 | 0 | 0 | 14 |
| 7 | 01 | R1 / B1 | compact vs helix | normal (helix) wins on value | 40.0 | 18004 / 25598 | 50228 / 50941 | 0 | 0 | 15 |
| 8 | 03 | R1 / B1 | lattice vs compact | normal (compact) wins | 35.6 | 1903 / 41513 | 37500 / 49862 | 0 | 0 | 12 |
| 9 | 01 | B1 / R1 | helix vs lattice | normal (lattice) wins | 15.6 | 5286 / 29465 | 13500 / 15500 | 0 | 0 | 3 |
| 10 | 03 | B1 / R1 | compact vs lattice | normal (lattice) wins on value | 40.0 | 19086 / 26641 | 54163 / 51088 | 0 | 0 | 16 |
| 11 | 01 | R1 / B1 | lattice vs helix | normal (lattice) wins | 18.3 | 36434 / 8057 | 20500 / 17500 | 0 | 0 | 3 |
| 12 | 03 | R1 / B1 | helix vs compact | normal (compact) wins | 23.1 | 10372 / 44044 | 27500 / 33000 | 0 | 0 | 6 |

✓ Hard beats Normal in most matches — 12 wins, 0 losses, 0 draws of 12 (100 %)  
✓ Hard uses its tools: scouting, raids and two-pronged waves — raids in 5/12 matches, two-pronged waves in 10/12  
✓ no resource cheating: every credit held came from start money or harvesting  
✓ control: Normal vs Normal is roughly even (side and faction rotation) — side A 4, side B 8, draws 0

4/4 checks passed
