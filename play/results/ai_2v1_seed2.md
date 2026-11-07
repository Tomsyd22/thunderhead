# AI difficulty, 2v1 (round 2)

One AI against two allied AIs on 02, 04, 05; 6 matches per batch, up to 60 game minutes; the single AI's side and the factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw). Seed set 2 (Math.random re-seeded per match).

## Normal vs 2 Easy

| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined | wall (s) |
|---|---|---|---|---|---|---|---|---|
| 1 | 02 | B1 vs R1+R2 | compact vs lattice+helix | solo normal wins (bases destroyed) | 45.9 | 55745 / 4050 | 62096 / 31000 | 26 |
| 2 | 04 | B2 vs R1+R2 | lattice vs helix+compact | solo normal wins (bases destroyed) | 58.1 | 31114 / 12948 | 52753 / 42000 | 27 |
| 3 | 05 | B1 vs R1+R2 | helix vs compact+lattice | solo normal wins (bases destroyed) | 44.8 | 49227 / 6257 | 62343 / 32000 | 21 |
| 4 | 02 | R2 vs B1+B2 | compact vs lattice+helix | solo normal wins on value | 60.0 | 43234 / 7639 | 69147 / 45000 | 29 |
| 5 | 04 | R1 vs B1+B2 | lattice vs helix+compact | solo normal wins (bases destroyed) | 43.4 | 34450 / 4417 | 51112 / 29500 | 20 |
| 6 | 05 | R2 vs B1+B2 | helix vs compact+lattice | solo normal wins (bases destroyed) | 38.8 | 42342 / 17981 | 49500 / 30500 | 22 |

## Hard vs 2 Normal

| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined | wall (s) |
|---|---|---|---|---|---|---|---|---|
| 1 | 02 | B1 vs R1+R2 | compact vs lattice+helix | solo hard wins (bases destroyed) | 35.9 | 64143 / 7199 | 65691 / 68000 | 57 |
| 2 | 04 | B2 vs R1+R2 | lattice vs helix+compact | normal pair wins on value | 60.0 | 24885 / 81995 | 55971 / 106772 | 48 |
| 3 | 05 | B1 vs R1+R2 | helix vs compact+lattice | normal pair wins (bases destroyed) | 29.2 | 10939 / 75474 | 45000 / 72000 | 45 |
| 4 | 02 | R2 vs B1+B2 | compact vs lattice+helix | solo hard wins (bases destroyed) | 49.2 | 66112 / 9545 | 85191 / 87290 | 72 |
| 5 | 04 | R1 vs B1+B2 | lattice vs helix+compact | draw | 60.0 | 28512 / 26751 | 52668 / 90481 | 66 |
| 6 | 05 | R2 vs B1+B2 | helix vs compact+lattice | normal pair wins (bases destroyed) | 37.5 | 8438 / 64110 | 60692 / 95000 | 50 |

✓ Normal vs 2 Easy: the single AI wins every match — 6/6 wins (5 by destroying both bases), avg 48.5 game min  
✗ Hard vs 2 Normal: the single AI wins every match — 2/6 wins (2 by destroying both bases), avg 45.3 game min  
✓ 2v1: no resource cheating

2/3 checks passed
