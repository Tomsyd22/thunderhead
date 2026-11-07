# Infantry and anti-air balance — before / after

Headless engine fights (play/test_infantry.mjs) on Emerald Strait's blue pad, open flat ground with the start yards removed. 20 runs per matchup with seeded random start offsets (gap 52–64 m, lateral ±6 m, per-unit jitter); both sides attack-move into each other from out of range. Times are REAL seconds at game speed 2.4 (first damage to last kill). BEFORE = data as of 2026-11-07 before this pass; AFTER = this pass.

**Money's worth surviving** = Σ cost × hp / maxHp of the survivors + money the whole-unit purchase left unspent (it stays in the bank, so it counts at face value for both sides). Shown as winner / loser, averaged over decided runs. ⚑ = one side wins more than 65 % at equal cost.

Ranger modes: **moving** never deploys; **set up** starts deployed as a machine gun and holds its ground; **in battle** advances and deploys with the Hard AI's deployMicro() (engine deploy order, 0.8 s setup), and attack-moves on (packing up) after 3 s with nothing to shoot.

## Unit stats

| unit | BEFORE cost / HP / speed / weapons | AFTER cost / HP / speed / weapons |
|---|---|---|
| H01 Conscript | $100 · 125 HP · 4.4 m/s · Service rifle: 12 / 0.8 s, 18 m | $100 · 90 HP · 4.4 m/s · Service rifle: 9 / 0.82 s, 18 m |
| H02 Rocket Trooper | $300 · 110 HP · 3.8 m/s · Anti-armour rocket: 90 / 3 s, 36 m; Air-defence rocket: 70 / 2.5 s, 45 m | $300 · 110 HP · 3.8 m/s · Anti-armour rocket: 90 / 3 s, 36 m; Air-defence rocket: 70 / 2.5 s, 45 m |
| H03 Bastion | $900 · 950 HP · 7.8 m/s · Heavy cannon: 100 / 2.5 s, 42 m | $900 · 950 HP · 7.8 m/s · Heavy cannon: 100 / 2.5 s, 42 m |
| H04 Hammer | $1200 · 650 HP · 19 m/s · Twin attack rockets: 42 / 2.8 s, 45 m | $1200 · 650 HP · 19 m/s · Twin attack rockets: 42 / 2.8 s, 45 m |
| A01 Ranger | $200 · 130 HP · 4.6 m/s · Carbine - mobile: 10 / 0.8 s, 18 m; Machine gun - deployed: 15 / 0.45 s, 25 m | $200 · 130 HP · 4.6 m/s · Carbine - mobile: 10 / 0.8 s, 18 m; Machine gun - deployed: 13 / 0.46 s, 25 m |
| A03 Arbiter | $700 · 700 HP · 10 m/s · Precision cannon: 80 / 2.2 s, 40 m | $700 · 700 HP · 10 m/s · Precision cannon: 80 / 2.2 s, 40 m |
| T01 Pulse Trooper | $250 · 100 HP · 5.4 m/s · Pulse carbine: 16 / 0.8 s, 23 m | $150 · 100 HP · 5.4 m/s · Pulse carbine: 16 / 0.8 s, 23 m |
| T02 Nullifier | $400 · 100 HP · 5 m/s · Disruption lance - ground: 50 / 2 s, 32 m; Disruption lance - air: 20 / 2 s, 38 m | $400 · 100 HP · 5 m/s · Disruption lance - ground: 50 / 2 s, 32 m; Disruption lance - air: 50 / 2 s, 45 m |
| T03 Wisp | $950 · 600 HP · 13 m/s · Accelerator cannon: 95 / 2.5 s, 46 m | $950 · 600 HP · 13 m/s · Accelerator cannon: 95 / 2.5 s, 46 m |
| A06 Halo | – | $650 · 400 HP · 11 m/s · Twin coil-laser - air: 12 / 0.2 s, 50 m; Coil-laser - ground: 6 / 0.5 s, 30 m |

## (a) Equal-cost rifle fights, $1,000 a side

| matchup (A vs B) | groups BEFORE | groups AFTER | A / B win BEFORE | A / B win AFTER | length s BEFORE | length s AFTER | money surviving BEFORE (win / lose) | AFTER |
|---|---|---|---|---|---|---|---|---|
| Conscript vs Pulse Trooper | 10 H01 vs 4 T01 | 10 H01 vs 6 T01 (+$100) | 100 % / 0 % ⚑ | 40 % / 60 % | 1.7 | 5.6 | $791 / $0 | $181 / $40 |
| Conscript vs Ranger (moving) | 10 H01 vs 5 A01 | 10 H01 vs 5 A01 | 100 % / 0 % ⚑ | 100 % / 0 % ⚑ | 1.9 | 2.9 | $847 / $0 | $687 / $0 |
| Conscript vs Ranger (set up) | 10 H01 vs 5 A01 | 10 H01 vs 5 A01 | 75 % / 25 % ⚑ | 0 % / 100 % ⚑ | 5.5 | 3.0 | $119 / $0 | $642 / $0 |
| Conscript vs Ranger (in battle) | 10 H01 vs 5 A01 | 10 H01 vs 5 A01 | 100 % / 0 % ⚑ | 50 % / 50 % | 2.0 | 4.9 | $726 / $0 | $188 / $0 |
| Pulse Trooper vs Ranger (moving) | 4 T01 vs 5 A01 | 6 T01 (+$100) vs 5 A01 | 5 % / 95 % ⚑ | 100 % / 0 % ⚑ | 4.6 | 2.7 | $206 / $0 | $687 / $0 |
| Pulse Trooper vs Ranger (set up) | 4 T01 vs 5 A01 | 6 T01 (+$100) vs 5 A01 | 0 % / 100 % ⚑ | 0 % / 100 % ⚑ | 1.1 | 2.2 | $816 / $0 | $537 / $100 |
| Pulse Trooper vs Ranger (in battle) | 4 T01 vs 5 A01 | 6 T01 (+$100) vs 5 A01 | 0 % / 100 % ⚑ | 35 % / 65 % | 2.0 | 3.6 | $549 / $0 | $231 / $65 |

## (b) Rifles against one basic tank

Passive = the tank does not fire (the fit target: a 5-man squad kills it in 25–30 s). Fight = the tank fires back; rifles' win rate and length.

| rifles | tank | passive kill s BEFORE | AFTER | fight: rifles win BEFORE | AFTER | fight s BEFORE | AFTER |
|---|---|---|---|---|---|---|---|
| Conscript (10 H01) | Bastion | 15.1 | 15.1 | 0 % | 0 % | 13.9 | 10.7 |
| Conscript ×5 | Bastion | 30.0 | 30.1 | 0 % | 0 % | 12.1 | 9.9 |
| Conscript (10 H01) | Arbiter | 14.2 | 14.1 | 0 % | 0 % | 17.6 | 16.2 |
| Conscript ×5 | Arbiter | 28.2 | 28.1 | 0 % | 0 % | 14.7 | 11.5 |
| Conscript (10 H01) | Wisp | 15.1 | 15.1 | 5 % | 5 % | 22.3 | 19.6 |
| Conscript ×5 | Wisp | 30.0 | 30.1 | 0 % | 0 % | 16.4 | 13.7 |
| Pulse Trooper (6 T01 (+$100)) | Bastion | 31.7 | 23.4 | 0 % | 0 % | 9.2 | 10.3 |
| Pulse Trooper ×5 | Bastion | 25.4 | 28.0 | 0 % | 0 % | 9.0 | 9.3 |
| Pulse Trooper (6 T01 (+$100)) | Arbiter | 31.1 | 20.8 | 0 % | 0 % | 10.0 | 10.2 |
| Pulse Trooper ×5 | Arbiter | 25.0 | 25.0 | 0 % | 0 % | 9.7 | 10.1 |
| Pulse Trooper (6 T01 (+$100)) | Wisp | 32.1 | 23.7 | 0 % | 0 % | 12.3 | 13.7 |
| Pulse Trooper ×5 | Wisp | 25.7 | 28.4 | 0 % | 0 % | 12.4 | 12.7 |
| Ranger (moving) (5 A01) | Bastion | 26.5 | 26.5 | 0 % | 0 % | 11.9 | 12.2 |
| Ranger (moving) ×5 | Bastion | 26.5 | 26.5 | 0 % | 0 % | 12.7 | 13.0 |
| Ranger (moving) (5 A01) | Arbiter | 25.1 | 25.1 | 0 % | 0 % | 11.3 | 11.6 |
| Ranger (moving) ×5 | Arbiter | 25.1 | 25.1 | 0 % | 0 % | 11.3 | 11.6 |
| Ranger (moving) (5 A01) | Wisp | 27.0 | 27.0 | 0 % | 0 % | 14.7 | 15.1 |
| Ranger (moving) ×5 | Wisp | 27.0 | 27.0 | 0 % | 0 % | 17.5 | 17.7 |
| Ranger (set up) (5 A01) | Bastion | 19.7 | 26.5 | 100 % | 100 % | 29.0 | 33.8 |
| Ranger (set up) ×5 | Bastion | 19.7 | 26.5 | 100 % | 100 % | 29.1 | 33.7 |
| Ranger (set up) (5 A01) | Arbiter | 14.5 | 25.1 | 100 % | 65 % | 58.7 | 67.2 |
| Ranger (set up) ×5 | Arbiter | 14.5 | 25.1 | 95 % | 80 % | 51.6 | 65.3 |
| Ranger (set up) (5 A01) | Wisp | 4.9 | 27.2 | 90 % | 80 % | 20.7 | 57.0 |
| Ranger (set up) ×5 | Wisp | 4.9 | 27.2 | 95 % | 90 % | 20.7 | 59.7 |
| Ranger (in battle) (5 A01) | Bastion | 20.1 | 26.6 | 0 % | 0 % | 15.8 | 16.5 |
| Ranger (in battle) ×5 | Bastion | 20.0 | 26.5 | 0 % | 0 % | 15.3 | 16.4 |
| Ranger (in battle) (5 A01) | Arbiter | 14.9 | 25.1 | 0 % | 0 % | 15.1 | 17.4 |
| Ranger (in battle) ×5 | Arbiter | 14.9 | 25.2 | 0 % | 0 % | 15.6 | 16.8 |
| Ranger (in battle) (5 A01) | Wisp | 5.4 | 27.3 | 55 % | 0 % | 14.6 | 19.3 |
| Ranger (in battle) ×5 | Wisp | 5.4 | 27.3 | 55 % | 0 % | 14.3 | 19.1 |

## (c) Equal-cost mixed groups, $2,000 a side

| matchup (A vs B) | groups BEFORE | groups AFTER | A / B win BEFORE | AFTER | length s BEFORE | AFTER | money surviving BEFORE | AFTER |
|---|---|---|---|---|---|---|---|---|
| Compact: Conscripts + Rocket Troopers vs Lattice: Pulse Troopers + Nullifiers | 2 H02 + 14 H01 vs 1 T02 + 6 T01 (+$100) | 2 H02 + 14 H01 vs 1 T02 + 10 T01 (+$100) | 100 % / 0 % ⚑ | 0 % / 100 % ⚑ | 2.3 | 4.1 | $1182 / $100 | $871 / $0 |
| Compact: Conscripts + Rocket Troopers vs Helix: Rangers + Halo | n/a (no A06) | 2 H02 + 14 H01 vs 1 A06 + 6 A01 (+$150) | – | 10 % / 90 % ⚑ | – | 6.2 | – | $557 / $15 |
| Lattice: Pulse Troopers + Nullifiers vs Helix: Rangers + Halo | n/a (no A06) | 1 T02 + 10 T01 (+$100) vs 1 A06 + 6 A01 (+$150) | – | 0 % / 100 % ⚑ | – | 5.2 | – | $1381 / $100 |
| Compact: Conscripts + Rocket Troopers vs Helix: Rangers only | 2 H02 + 14 H01 vs 10 A01 | 2 H02 + 14 H01 vs 10 A01 | 100 % / 0 % ⚑ | 0 % / 100 % ⚑ | 3.8 | 3.1 | $707 / $0 | $1201 / $0 |
| Lattice: Pulse Troopers + Nullifiers vs Helix: Rangers only | 1 T02 + 6 T01 (+$100) vs 10 A01 | 1 T02 + 10 T01 (+$100) vs 10 A01 | 0 % / 100 % ⚑ | 0 % / 100 % ⚑ | 1.9 | 3.2 | $1356 / $100 | $735 / $100 |

## (d) Anti-air over a base

A Hammer wave attack-moves onto a construction yard (3,000 HP) from 160 m; the defenders guard spots 16–30 m from the yard, and idle defenders attack-move toward the nearest Hammer (as the Hard AI's anti-air does). Defenders win when every Hammer is down before the yard falls. Times in GAME seconds (real = game / 2.4).

| case | defenders win BEFORE | AFTER | time game s BEFORE | AFTER | yard HP left BEFORE | AFTER | Hammers left BEFORE | AFTER |
|---|---|---|---|---|---|---|---|---|
| 14 Hammers vs an undefended yard | 0 % | 0 % | 8.8 | 8.8 | 0 % | 0 % | 14.0 | 14.0 |
| 14 Hammers vs 26 Nullifiers | 0 % | 100 % | 12.4 | 15.8 | 0 % | 21 % | 11.7 | 0.0 |
| 3 Hammers ($3,600) vs 8 Nullifiers ($3,200) | 100 % | 100 % | 25.7 | 10.1 | 61 % | 86 % | 0.0 | 0.0 |
| 3 Hammers ($3,600) vs 9 Nullifiers ($3,600) | 100 % | 100 % | 22.6 | 8.8 | 66 % | 87 % | 0.0 | 0.0 |
| 14 Hammers ($16,800) vs 42 Nullifiers ($16,800) | 0 % | 100 % | 14.0 | 10.5 | 0 % | 51 % | 8.0 | 0.0 |
| 3 Hammers ($3,600) vs 12 Rocket Troopers ($3,600) | 100 % | 100 % | 6.4 | 6.4 | 91 % | 91 % | 0.0 | 0.0 |
| 14 Hammers ($16,800) vs 56 Rocket Troopers ($16,800) | 100 % | 100 % | 9.7 | 9.7 | 54 % | 54 % | 0.0 | 0.0 |
| 3 Hammers ($3,600) vs 5 Halos ($3,250) | n/a | 100 % | – | 9.6 | – | 100 % | – | 0.0 |
| 14 Hammers ($16,800) vs 25 Halos ($16,250) | n/a | 100 % | – | 10.0 | – | 100 % | – | 0.0 |

## Flagged matchups (one side > 65 % at equal cost)

- BEFORE (a) Conscript vs Pulse Trooper: Conscript wins 100 %
- AFTER (a) Conscript vs Ranger (moving): Conscript wins 100 %
- BEFORE (a) Conscript vs Ranger (moving): Conscript wins 100 %
- AFTER (a) Conscript vs Ranger (set up): Ranger (set up) wins 100 %
- BEFORE (a) Conscript vs Ranger (set up): Conscript wins 75 %
- BEFORE (a) Conscript vs Ranger (in battle): Conscript wins 100 %
- AFTER (a) Pulse Trooper vs Ranger (moving): Pulse Trooper wins 100 %
- BEFORE (a) Pulse Trooper vs Ranger (moving): Ranger (moving) wins 95 %
- AFTER (a) Pulse Trooper vs Ranger (set up): Ranger (set up) wins 100 %
- BEFORE (a) Pulse Trooper vs Ranger (set up): Ranger (set up) wins 100 %
- BEFORE (a) Pulse Trooper vs Ranger (in battle): Ranger (in battle) wins 100 %
- AFTER (c) Compact: Conscripts + Rocket Troopers vs Lattice: Pulse Troopers + Nullifiers: Lattice: Pulse Troopers + Nullifiers wins 100 %
- BEFORE (c) Compact: Conscripts + Rocket Troopers vs Lattice: Pulse Troopers + Nullifiers: Compact: Conscripts + Rocket Troopers wins 100 %
- AFTER (c) Compact: Conscripts + Rocket Troopers vs Helix: Rangers + Halo: Helix: Rangers + Halo wins 90 %
- AFTER (c) Lattice: Pulse Troopers + Nullifiers vs Helix: Rangers + Halo: Helix: Rangers + Halo wins 100 %
- AFTER (c) Compact: Conscripts + Rocket Troopers vs Helix: Rangers only: Helix: Rangers only wins 100 %
- BEFORE (c) Compact: Conscripts + Rocket Troopers vs Helix: Rangers only: Compact: Conscripts + Rocket Troopers wins 100 %
- AFTER (c) Lattice: Pulse Troopers + Nullifiers vs Helix: Rangers only: Helix: Rangers only wins 100 %
- BEFORE (c) Lattice: Pulse Troopers + Nullifiers vs Helix: Rangers only: Helix: Rangers only wins 100 %

