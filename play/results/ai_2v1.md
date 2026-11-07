# AI difficulty, 2v1 (round 2)

One AI against two allied AIs on 02, 04, 05; 6 matches per batch, up to 60 game minutes; the single AI's side and the factions rotate. "On value" = time limit reached, judged on structures + units + credits (15 % margin, else a draw). Seed set 1 (Math.random re-seeded per match).

## Normal vs 2 Easy

| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined | wall (s) |
|---|---|---|---|---|---|---|---|---|
| 1 | 02 | B1 vs R1+R2 | compact vs lattice+helix | solo normal wins (bases destroyed) | 39.8 | 52212 / 8305 | 53301 / 32000 | 24 |
| 2 | 04 | B2 vs R1+R2 | lattice vs helix+compact | easy pair wins on value | 60.0 | 20007 / 52820 | 52753 / 48000 | 30 |
| 3 | 05 | B1 vs R1+R2 | helix vs compact+lattice | solo normal wins (bases destroyed) | 45.4 | 47145 / 10482 | 62270 / 39500 | 24 |
| 4 | 02 | R2 vs B1+B2 | compact vs lattice+helix | solo normal wins (bases destroyed) | 50.6 | 52693 / 7469 | 61500 / 35500 | 26 |
| 5 | 04 | R1 vs B1+B2 | lattice vs helix+compact | solo normal wins (bases destroyed) | 40.8 | 48175 / 16724 | 50402 / 33000 | 22 |
| 6 | 05 | R2 vs B1+B2 | helix vs compact+lattice | solo normal wins (bases destroyed) | 35.9 | 40497 / 10788 | 45500 / 27500 | 20 |

## Hard vs 2 Normal

| # | map | starts | factions | result | at (game min) | value (solo / pair) | mined | wall (s) |
|---|---|---|---|---|---|---|---|---|
| 1 | 02 | B1 vs R1+R2 | compact vs lattice+helix | solo hard wins (bases destroyed) | 39.6 | 44588 / 6595 | 67713 / 77859 | 60 |
| 2 | 04 | B2 vs R1+R2 | lattice vs helix+compact | normal pair wins on value | 60.0 | 16546 / 65207 | 55741 / 106772 | 71 |
| 3 | 05 | B1 vs R1+R2 | helix vs compact+lattice | normal pair wins (bases destroyed) | 46.9 | 13096 / 32451 | 69794 / 82744 | 72 |
| 4 | 02 | R2 vs B1+B2 | compact vs lattice+helix | solo hard wins (bases destroyed) | 53.2 | 69690 / 2658 | 96935 / 107601 | 96 |
| 5 | 04 | R1 vs B1+B2 | lattice vs helix+compact | normal pair wins on value | 60.0 | 20846 / 75410 | 55390 / 111927 | 63 |
| 6 | 05 | R2 vs B1+B2 | helix vs compact+lattice | normal pair wins (bases destroyed) | 38.8 | 4464 / 50656 | 56753 / 89500 | 55 |

✗ Normal vs 2 Easy: the single AI wins every match — 5/6 wins (5 by destroying both bases), avg 45.4 game min  
✗ Hard vs 2 Normal: the single AI wins every match — 2/6 wins (2 by destroying both bases), avg 49.7 game min  
✓ 2v1: no resource cheating

1/3 checks passed
