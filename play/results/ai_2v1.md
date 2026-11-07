# AI difficulty, 2v1 (round 2)

One AI against two allied AIs on 02, 04, 05; 6 matches per batch, up to 60 game minutes; the single AI's side and the factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw). Seed set 1 (Math.random re-seeded per match).

## Normal vs 2 Easy

| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined | wall (s) |
|---|---|---|---|---|---|---|---|---|
| 1 | 02 | B1 vs R1+R2 | compact vs lattice+helix | solo normal wins (bases destroyed) | 33.7 | 48740 / 5960 | 45000 / 25500 | 24 |
| 2 | 04 | B2 vs R1+R2 | lattice vs helix+compact | solo normal wins (bases destroyed) | 49.3 | 42957 / 15915 | 52725 / 38500 | 33 |
| 3 | 05 | B1 vs R1+R2 | helix vs compact+lattice | solo normal wins (bases destroyed) | 50.3 | 44236 / 3884 | 65477 / 41500 | 35 |
| 4 | 02 | R2 vs B1+B2 | compact vs lattice+helix | solo normal wins (bases destroyed) | 43.5 | 50318 / 8255 | 52000 / 34000 | 29 |
| 5 | 04 | R1 vs B1+B2 | lattice vs helix+compact | solo normal wins (bases destroyed) | 30.6 | 45251 / 11224 | 37500 / 23000 | 16 |
| 6 | 05 | R2 vs B1+B2 | helix vs compact+lattice | solo normal wins (bases destroyed) | 34.6 | 38001 / 13434 | 44000 / 26500 | 24 |

## Hard vs 2 Normal

| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined | wall (s) |
|---|---|---|---|---|---|---|---|---|
| 1 | 02 | B1 vs R1+R2 | compact vs lattice+helix | solo hard wins (bases destroyed) | 39.9 | 66822 / 11351 | 75138 / 85312 | 82 |
| 2 | 04 | B2 vs R1+R2 | lattice vs helix+compact | normal pair wins on value | 60.0 | 18710 / 83130 | 55895 / 106772 | 68 |
| 3 | 05 | B1 vs R1+R2 | helix vs compact+lattice | solo hard wins (bases destroyed) | 37.3 | 53076 / 17913 | 72270 / 77909 | 64 |
| 4 | 02 | R2 vs B1+B2 | compact vs lattice+helix | solo hard wins (bases destroyed) | 51.5 | 51122 / 5014 | 92994 / 107023 | 86 |
| 5 | 04 | R1 vs B1+B2 | lattice vs helix+compact | normal pair wins on value | 60.0 | 32495 / 48962 | 56047 / 92567 | 63 |
| 6 | 05 | R2 vs B1+B2 | helix vs compact+lattice | normal pair wins (bases destroyed) | 34.2 | 2350 / 73855 | 55836 / 87500 | 57 |

✓ Normal vs 2 Easy: the single AI wins every match — 6/6 wins (6 by destroying both bases), avg 40.3 game min  
✗ Hard vs 2 Normal: the single AI wins every match — 3/6 wins (3 by destroying both bases), avg 47.2 game min  
✓ 2v1: no resource cheating

2/3 checks passed
