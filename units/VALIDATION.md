# Unit pack — validation (2026-11-06)

This page covers all 15 units of the RTS Unit Design Pack (v0.2 art, mechanics baseline v0.1). Each unit has a Blender model, the mechanics and the Unit Sandbox.
Every number comes from `units/data/unit_specs.json`. Values that the pack does not give are listed under **Assumptions**.

## Models

`dims` compares the measured envelope with the spec: length (Y) / width (X) / height (Z). Infantry are measured in the aim pose, holding their weapons.

| Unit | Name | dims ratio L / W / H | tris (LOD0 budget) | GLB | named parts |
|---|---|---|---|---|---|
| H01 | Conscript | 1.08 / 0.80 / 1.00 | 4410 (4500) | 396 KB | muzzle, weapon, grip_L, pelvis |
| H02 | Rocket Trooper | 1.01 / 0.73 / 0.96 | 5389 (5500) | 432 KB | muzzle, weapon, grip_L, pelvis |
| H03 | Bastion Heavy Tank | 1.00 / 1.00 / 1.03 | 16966 (18000) | 1320 KB | turret, gun, recoil, muzzle, track_L |
| H04 | Hammer Assault Helicopter | 0.99 / 1.00 / 1.00 | 13210 (16000) | 1112 KB | rotor, rotor_disc, tail_rotor, pod_L, pod_R |
| H05 | Bulwark Armoured Gunboat | 1.01 / 1.02 / 1.00 | 14594 (18000) | 1232 KB | turret, gun, recoil, muzzle, prop_L |
| A01 | Ranger | 1.04 / 0.69 / 0.99 | 5390 (5500) | 455 KB | muzzle, weapon, grip_L, shield, bipod_L, pelvis |
| A02 | Missile Specialist | 1.04 / 0.66 / 0.97 | 5880 (6000) | 448 KB | muzzle, weapon, grip_L, tripod, pelvis |
| A03 | Lancer Medium Tank | 1.01 / 1.00 / 1.01 | 14312 (16000) | 1124 KB | turret, gun, recoil, muzzle, track_L |
| A04 | Kestrel Strike Jet | 0.99 / 1.01 / 1.00 | 7922 (18000) | 832 KB | gear_N, bomb_L, aileron_L |
| A05 | Sentinel Missile Frigate | 1.00 / 1.01 / 1.00 | 14780 (24000) | 1385 KB | prop_L, radar, aa, lid_0 |
| T01 | Pulse Trooper | 0.88 / 0.72 / 1.03 | 5390 (5500) | 446 KB | muzzle, weapon, grip_L, pelvis |
| T02 | Disruptor | 0.97 / 0.68 / 0.97 | 5880 (6000) | 450 KB | muzzle, weapon, grip_L, pelvis |
| T03 | Wisp Hover Tank | 1.01 / 1.01 / 1.01 | 7586 (18000) | 775 KB | turret, gun, muzzle, pod_L, pod_R, fin_L |
| T04 | Mote Recon Drone | 1.00 / 1.00 / 1.00 | 7544 (8500) | 574 KB | muzzle, rotor_FL, gimbal |
| T05 | Spectre Drone Corvette | 1.00 / 0.99 / 1.00 | 7244 (18000) | 839 KB | lid_L, jet_L, sensor |

## Distant-view models (LOD1, LOD2)

Built by `units/blender/lods.py` from each saved LOD0 `.blend`. Each level keeps the LOD0 node tree, bone order and material names, so every animated part (turrets, rotors, lids, gear, recoil, the infantry skeleton) works unchanged. Only mesh density and atlas resolution drop: the atlas is ½ size at LOD1 and ¼ at LOD2.
The targets are the pack's budgets, and each level is a real reduction: LOD1 is at most 60 % of LOD0 and LOD2 at most 25 %.

| Unit | LOD0 tris | LOD1 tris (budget) | LOD2 tris (budget) | LOD1 / LOD2 GLB |
|---|---|---|---|---|
| H01 Conscript | 4410 | 2168 (2200) | 644 (650) | 220 / 88 KB |
| H02 Rocket Trooper | 5389 | 2566 (2600) | 746 (750) | 240 / 98 KB |
| H03 Bastion Heavy Tank | 16966 | 8482 (8500) | 2172 (2200) | 674 / 222 KB |
| H04 Hammer Assault Helicopter | 13210 | 7465 (7500) | 1988 (2000) | 580 / 194 KB |
| H05 Bulwark Armoured Gunboat | 14594 | 8432 (8500) | 2274 (2300) | 696 / 215 KB |
| A01 Ranger | 5390 | 2680 (2700) | 793 (800) | 272 / 107 KB |
| A02 Missile Specialist | 5880 | 2890 (2900) | 840 (850) | 251 / 107 KB |
| A03 Lancer Medium Tank | 14312 | 7392 (7500) | 1866 (1900) | 587 / 208 KB |
| A04 Kestrel Strike Jet | 7922 | 4732 (8500) | 1957 (2200) | 427 / 188 KB |
| A05 Sentinel Missile Frigate | 14780 | 8764 (11000) | 2996 (3000) | 774 / 286 KB |
| T01 Pulse Trooper | 5390 | 2566 (2600) | 746 (750) | 251 / 104 KB |
| T02 Disruptor | 5880 | 2846 (2900) | 848 (850) | 257 / 111 KB |
| T03 Wisp Hover Tank | 7586 | 4497 (8500) | 1892 (2200) | 395 / 170 KB |
| T04 Mote Recon Drone | 7544 | 3942 (4000) | 997 (1000) | 285 / 88 KB |
| T05 Spectre Drone Corvette | 7244 | 4296 (8500) | 1808 (2200) | 420 / 177 KB |

In the Unit Sandbox, each mesh swaps to the level for its on-screen size: LOD0 above 110 px, LOD1 above 36 px, LOD2 below. The switch has ±12 % hysteresis, and the **Model detail** buttons can pin one level for inspection.
- **Matching:** every mesh of all 15 units found its counterpart at both levels: H01 3/3, H02 5/5, H03 29/29, H04 17/17, H05 9/9, A01 9/9, A02 10/10, A03 29/29, A04 19/19, A05 14/14, T01 6/6, T02 7/7, T03 20/20, T04 16/16, T05 12/12.
- **Live fire battle at a normal RTS camera (230 m):** unit triangles 200,482 → 47,762 (76.2 % fewer). Whole frame including terrain and props: 412,572 → 282,133 (31.6 %). Units at LOD0 / LOD1 / LOD2: 0/3/24.
- **Close camera (70 m):** unit triangles 52.1 % fewer. Levels 4/5/18.
- **No flicker:** 0 level changes in 5 s with the camera still. A slow zoom-out from 40 m to 400 m made 14 changes across 26 units, each stepping down without bouncing back.
- **Close-ups at each level:** `units/sandbox/results/shots/unit_<UID>.png`, `_lod1.png` and `_lod2.png`, combined in `units/preview/lod_sheet.png`.

## Mechanics suite (`node units/sandbox/test_mech.mjs`)

**303 / 303 checks passed.** This is a headless simulation at 30 Hz. Every tolerance is written in the check itself.

### 1 spec transcription — 15/15

- ✅ H01 3 sheet values match MECH
- ✅ H02 3 sheet values match MECH
- ✅ A01 5 sheet values match MECH
- ✅ A02 4 sheet values match MECH
- ✅ T01 3 sheet values match MECH
- ✅ T02 4 sheet values match MECH
- ✅ H03 10 sheet values match MECH
- ✅ A03 10 sheet values match MECH
- ✅ T03 8 sheet values match MECH
- ✅ H04 4 sheet values match MECH
- ✅ A04 7 sheet values match MECH
- ✅ T04 6 sheet values match MECH
- ✅ H05 8 sheet values match MECH
- ✅ A05 4 sheet values match MECH
- ✅ T05 4 sheet values match MECH

### 2 locomotion — 58/58

- ✅ H01 top speed 4.40 ≈ spec 4.4 m/s (±1 %)
- ✅ H01 stops at the goal without overshoot (0.07 m)
- ✅ H02 top speed 3.80 ≈ spec 3.8 m/s (±1 %)
- ✅ H02 stops at the goal without overshoot (0.06 m)
- ✅ A01 top speed 4.60 ≈ spec 4.6 m/s (±1 %)
- ✅ A01 stops at the goal without overshoot (0.07 m)
- ✅ A02 top speed 4.20 ≈ spec 4.2 m/s (±1 %)
- ✅ A02 stops at the goal without overshoot (0.07 m)
- ✅ T01 top speed 5.40 ≈ spec 5.4 m/s (±1 %)
- ✅ T01 stops at the goal without overshoot (0.08 m)
- ✅ T02 top speed 5.00 ≈ spec 5 m/s (±1 %)
- ✅ T02 stops at the goal without overshoot (0.08 m)
- ✅ H03 top speed 7.80 ≈ spec 7.8 m/s (±1 %)
- ✅ H03 stops at the goal without overshoot (0.13 m)
- ✅ H03 0→90 % speed in 2.37 s ≈ v/a 2.34 s (±12 %)
- ✅ H03 EMP speed ×0.70 → 5.46 m/s
- ✅ A03 top speed 10.00 ≈ spec 10 m/s (±1 %)
- ✅ A03 stops at the goal without overshoot (0.17 m)
- ✅ A03 0→90 % speed in 2.03 s ≈ v/a 2.00 s (±12 %)
- ✅ A03 EMP speed ×0.70 → 7.00 m/s
- ✅ T03 top speed 13.00 ≈ spec 13 m/s (±1 %)
- ✅ T03 stops at the goal without overshoot (0.04 m)
- ✅ T03 0→90 % speed in 2.37 s ≈ v/a 2.34 s (±12 %)
- ✅ T03 EMP speed ×0.70 → 9.10 m/s
- ✅ H05 top speed 10.00 ≈ 10 m/s
- ✅ H05 0→90 % in 4.53 s ≈ 4.50 s
- ✅ H05 stops at the goal (0.0 m)
- ✅ H05 hull yaw 28.0°/s ≤ spec 28°/s and reaches ≥ 95 % at speed
- ✅ H05 turns on an arc (min radius 14.3 m), never pivots in place
- ✅ A05 top speed 9.00 ≈ 9 m/s
- ✅ A05 0→90 % in 5.43 s ≈ 5.40 s
- ✅ A05 stops at the goal (0.0 m)
- ✅ A05 hull yaw 18.0°/s ≤ spec 18°/s and reaches ≥ 95 % at speed
- ✅ A05 turns on an arc (min radius 20.1 m), never pivots in place
- ✅ T05 top speed 15.00 ≈ 15 m/s
- ✅ T05 0→90 % in 3.87 s ≈ 3.86 s
- ✅ T05 stops at the goal (0.0 m)
- ✅ T05 hull yaw 45.0°/s ≤ spec 45°/s and reaches ≥ 95 % at speed
- ✅ T05 turns on an arc (min radius 13.4 m), never pivots in place
- ✅ H03 pivot yaw 55.0°/s = spec 55°/s (±2 %)
- ✅ H03 tracks counter-rotate during the pivot (90 ticks)
- ✅ H03 turret yaw 85.0°/s = spec 85°/s (±2 %)
- ✅ H03 hull does not snap toward a target (hull yaw stayed 0.0°)
- ✅ A03 pivot yaw 75.0°/s = spec 75°/s (±2 %)
- ✅ A03 tracks counter-rotate during the pivot (67 ticks)
- ✅ A03 turret yaw 110.0°/s = spec 110°/s (±2 %)
- ✅ A03 hull does not snap toward a target (hull yaw stayed 0.0°)
- ✅ H04 top speed 19.00 ≈ 19
- ✅ H04 0→90 % in 2.47 s ≈ 2.44 s
- ✅ H04 holds 12 m above terrain (12.00–12.00)
- ✅ H04 stops at the goal (0.01 m)
- ✅ T04 top speed 22.00 ≈ 22
- ✅ T04 0→90 % in 1.67 s ≈ 1.65 s
- ✅ T04 holds 8 m above terrain (8.00–8.00)
- ✅ T04 stops at the goal (0.02 m)
- ✅ A04 flies at 35.0 m/s (spec 35) and never slows to hover in flight (min 35.0)
- ✅ A04 minimum turn radius 12.00 m ≥ spec 12 m (and within 5 %)
- ✅ A04 cruise altitude 20.0 m ≈ 20 m

### 3 domains — 14/14

- ✅ no foot off mask events over 600 s of random legs
- ✅ no veh off mask events over 600 s of random legs
- ✅ no hover off mask events over 600 s of random legs
- ✅ no ship off water events over 600 s of random legs
- ✅ no air low events over 600 s of random legs
- ✅ Wisp crossed shallow water (314 s wet) and never deeper than 1.2 m (max 1.09 m)
- ✅ slopes driven: foot ≤ 35° (33.3), vehicles ≤ 25° (18.8), hover ≤ 25° (23.4)
- ✅ every unit completed legs (H01:11 A01:12 T02:12 H03:15 A03:19 T03:32 H05:17 A05:19 T05:25 H04:47 T04:56)
- ✅ ships never had to back out of a tight spot (astern time: H05 0.0 s, A05 0.0 s, T05 0.0 s)
- ✅ Wisp sent to the deep sea stops on the shelf (depth 0.69 m ≤ 1.2, max 0.76)
- ✅ tank sent into the lagoon stops on the bank (h 0.91 m)
- ✅ corvette sent into the shallow lagoon stops in the deep mouth (depth 7.3 m)
- ✅ frigate sent onto land stays on deep water (depth 8.3 m)
- ✅ tank crossed the ridge through the pass (crossed at y=124, pass 130,160)

### 4 weapons — 153/153

- ✅ H01 Service rifle: roster row matches unit_specs (dmg 12, burst 1, cycle 0.8, range 18)
- ✅ H01 Service rifle vs infantry: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ H01 Service rifle vs infantry: 12.0 dmg/volley → 15.00 DPS ≈ roster 15 (±2 %)
- ✅ H01 Service rifle vs light: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ H01 Service rifle vs light: 3.0 dmg/volley → 3.75 DPS ≈ roster 3.75 (±2 %)
- ✅ H01 Service rifle vs heavy: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ H01 Service rifle vs heavy: 1.0 dmg/volley → 1.20 DPS ≈ roster 1.2 (±2 %)
- ✅ H01 Service rifle vs building: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ H01 Service rifle vs building: 2.4 dmg/volley → 3.00 DPS ≈ roster 3 (±2 %)
- ✅ H02 Anti-armour rocket: roster row matches unit_specs (dmg 90, burst 1, cycle 3, range 36)
- ✅ H02 Anti-armour rocket vs light: mean cycle 3.000 s = 3 s (±1 %)
- ✅ H02 Anti-armour rocket vs light: 90.0 dmg/volley → 30.00 DPS ≈ roster 30 (±2 %)
- ✅ H02 Anti-armour rocket vs heavy: mean cycle 3.000 s = 3 s (±1 %)
- ✅ H02 Anti-armour rocket vs heavy: 90.0 dmg/volley → 30.00 DPS ≈ roster 30 (±2 %)
- ✅ H02 Anti-armour rocket vs naval: mean cycle 3.000 s = 3 s (±1 %)
- ✅ H02 Anti-armour rocket vs naval: 72.0 dmg/volley → 24.00 DPS ≈ roster 24 (±2 %)
- ✅ H02 Anti-armour rocket vs building: mean cycle 3.000 s = 3 s (±1 %)
- ✅ H02 Anti-armour rocket vs building: 58.5 dmg/volley → 19.50 DPS ≈ roster 19.5 (±2 %)
- ✅ H02 Air-defence rocket: roster row matches unit_specs (dmg 70, burst 1, cycle 2.5, range 45)
- ✅ H02 Air-defence rocket vs air: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H02 Air-defence rocket vs air: 70.0 dmg/volley → 28.00 DPS ≈ roster 28 (±2 %)
- ✅ H03 Heavy cannon: roster row matches unit_specs (dmg 100, burst 1, cycle 2.5, range 42)
- ✅ H03 Heavy cannon vs infantry: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H03 Heavy cannon vs infantry: 25.0 dmg/volley → 10.00 DPS ≈ roster 10 (±2 %)
- ✅ H03 Heavy cannon vs light: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H03 Heavy cannon vs light: 115.0 dmg/volley → 46.00 DPS ≈ roster 46 (±2 %)
- ✅ H03 Heavy cannon vs heavy: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H03 Heavy cannon vs heavy: 100.0 dmg/volley → 40.00 DPS ≈ roster 40 (±2 %)
- ✅ H03 Heavy cannon vs naval: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H03 Heavy cannon vs naval: 75.0 dmg/volley → 30.00 DPS ≈ roster 30 (±2 %)
- ✅ H03 Heavy cannon vs building: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H03 Heavy cannon vs building: 85.0 dmg/volley → 34.00 DPS ≈ roster 34 (±2 %)
- ✅ H04 Twin attack rockets: roster row matches unit_specs (dmg 42, burst 2, cycle 2.8, range 45)
- ✅ H04 Twin attack rockets vs light: mean cycle 2.800 s = 2.8 s (±1 %)
- ✅ H04 burst 2 with gap 0.167 s ≈ 0.15 s (±1 tick)
- ✅ H04 Twin attack rockets vs light: 84.0 dmg/volley → 30.00 DPS ≈ roster 30 (±2 %)
- ✅ H04 Twin attack rockets vs heavy: mean cycle 2.800 s = 2.8 s (±1 %)
- ✅ H04 burst 2 with gap 0.167 s ≈ 0.15 s (±1 tick)
- ✅ H04 Twin attack rockets vs heavy: 84.0 dmg/volley → 30.00 DPS ≈ roster 30 (±2 %)
- ✅ H04 Twin attack rockets vs naval: mean cycle 2.800 s = 2.8 s (±1 %)
- ✅ H04 burst 2 with gap 0.167 s ≈ 0.15 s (±1 tick)
- ✅ H04 Twin attack rockets vs naval: 71.4 dmg/volley → 25.50 DPS ≈ roster 25.5 (±2 %)
- ✅ H04 Twin attack rockets vs building: mean cycle 2.800 s = 2.8 s (±1 %)
- ✅ H04 burst 2 with gap 0.167 s ≈ 0.15 s (±1 tick)
- ✅ H04 Twin attack rockets vs building: 58.8 dmg/volley → 21.00 DPS ≈ roster 21 (±2 %)
- ✅ H05 Naval assault gun: roster row matches unit_specs (dmg 110, burst 1, cycle 2.5, range 50)
- ✅ H05 Naval assault gun vs infantry: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H05 Naval assault gun vs infantry: 27.5 dmg/volley → 11.00 DPS ≈ roster 11 (±2 %)
- ✅ H05 Naval assault gun vs light: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H05 Naval assault gun vs light: 110.0 dmg/volley → 44.00 DPS ≈ roster 44 (±2 %)
- ✅ H05 Naval assault gun vs heavy: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H05 Naval assault gun vs heavy: 93.5 dmg/volley → 37.40 DPS ≈ roster 37.4 (±2 %)
- ✅ H05 Naval assault gun vs naval: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H05 Naval assault gun vs naval: 110.0 dmg/volley → 44.00 DPS ≈ roster 44 (±2 %)
- ✅ H05 Naval assault gun vs building: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ H05 Naval assault gun vs building: 99.0 dmg/volley → 39.60 DPS ≈ roster 39.6 (±2 %)
- ✅ A01 Carbine - mobile: roster row matches unit_specs (dmg 10, burst 1, cycle 0.8, range 18)
- ✅ A01 Carbine - mobile vs infantry: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ A01 Carbine - mobile vs infantry: 10.0 dmg/volley → 12.50 DPS ≈ roster 12.5 (±2 %)
- ✅ A01 Carbine - mobile vs light: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ A01 Carbine - mobile vs light: 2.5 dmg/volley → 3.13 DPS ≈ roster 3.12 (±2 %)
- ✅ A01 Carbine - mobile vs heavy: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ A01 Carbine - mobile vs heavy: 0.8 dmg/volley → 1.00 DPS ≈ roster 1 (±2 %)
- ✅ A01 Carbine - mobile vs building: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ A01 Carbine - mobile vs building: 1.8 dmg/volley → 2.25 DPS ≈ roster 2.25 (±2 %)
- ✅ A01 Machine gun - deployed: roster row matches unit_specs (dmg 15, burst 1, cycle 0.45, range 25)
- ✅ A01 Machine gun - deployed vs infantry: mean cycle 0.450 s = 0.45 s (±1 %)
- ✅ A01 Machine gun - deployed vs infantry: 15.0 dmg/volley → 33.33 DPS ≈ roster 33.33 (±2 %)
- ✅ A01 Machine gun - deployed vs light: mean cycle 0.450 s = 0.45 s (±1 %)
- ✅ A01 Machine gun - deployed vs light: 4.5 dmg/volley → 10.00 DPS ≈ roster 10 (±2 %)
- ✅ A01 Machine gun - deployed vs heavy: mean cycle 0.450 s = 0.45 s (±1 %)
- ✅ A01 Machine gun - deployed vs heavy: 1.8 dmg/volley → 4.00 DPS ≈ roster 4 (±2 %)
- ✅ A01 Machine gun - deployed vs building: mean cycle 0.450 s = 0.45 s (±1 %)
- ✅ A01 Machine gun - deployed vs building: 3.8 dmg/volley → 8.33 DPS ≈ roster 8.33 (±2 %)
- ✅ A02 Air-intercept missile: roster row matches unit_specs (dmg 75, burst 1, cycle 2.5, range 48)
- ✅ A02 Air-intercept missile vs air: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ A02 Air-intercept missile vs air: 75.0 dmg/volley → 30.00 DPS ≈ roster 30 (±2 %)
- ✅ A02 Deployed anti-tank missile: roster row matches unit_specs (dmg 110, burst 1, cycle 3, range 40)
- ✅ A02 Deployed anti-tank missile vs light: mean cycle 3.000 s = 3 s (±1 %)
- ✅ A02 Deployed anti-tank missile vs light: 110.0 dmg/volley → 36.67 DPS ≈ roster 36.67 (±2 %)
- ✅ A02 Deployed anti-tank missile vs heavy: mean cycle 3.000 s = 3 s (±1 %)
- ✅ A02 Deployed anti-tank missile vs heavy: 110.0 dmg/volley → 36.67 DPS ≈ roster 36.67 (±2 %)
- ✅ A02 Deployed anti-tank missile vs naval: mean cycle 3.000 s = 3 s (±1 %)
- ✅ A02 Deployed anti-tank missile vs naval: 82.5 dmg/volley → 27.50 DPS ≈ roster 27.5 (±2 %)
- ✅ A02 Deployed anti-tank missile vs building: mean cycle 3.000 s = 3 s (±1 %)
- ✅ A02 Deployed anti-tank missile vs building: 66.0 dmg/volley → 22.00 DPS ≈ roster 22 (±2 %)
- ✅ A03 Precision cannon: roster row matches unit_specs (dmg 80, burst 1, cycle 2.2, range 40)
- ✅ A03 Precision cannon vs infantry: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ A03 Precision cannon vs infantry: 20.0 dmg/volley → 9.09 DPS ≈ roster 9.09 (±2 %)
- ✅ A03 Precision cannon vs light: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ A03 Precision cannon vs light: 92.0 dmg/volley → 41.82 DPS ≈ roster 41.82 (±2 %)
- ✅ A03 Precision cannon vs heavy: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ A03 Precision cannon vs heavy: 80.0 dmg/volley → 36.36 DPS ≈ roster 36.36 (±2 %)
- ✅ A03 Precision cannon vs naval: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ A03 Precision cannon vs naval: 52.0 dmg/volley → 23.64 DPS ≈ roster 23.64 (±2 %)
- ✅ A03 Precision cannon vs building: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ A03 Precision cannon vs building: 60.0 dmg/volley → 27.27 DPS ≈ roster 27.27 (±2 %)
- ✅ A05 Anti-ship missile salvo: roster row matches unit_specs (dmg 90, burst 2, cycle 5, range 80)
- ✅ A05 Anti-ship missile salvo vs naval: mean cycle 5.000 s = 5 s (±1 %)
- ✅ A05 burst 2 with gap 0.223 s ≈ 0.2 s (±1 tick)
- ✅ A05 Anti-ship missile salvo vs naval: 180.0 dmg/volley → 36.00 DPS ≈ roster 36 (±2 %)
- ✅ A05 Defensive AA missile: roster row matches unit_specs (dmg 55, burst 1, cycle 1.8, range 50)
- ✅ A05 Defensive AA missile vs air: mean cycle 1.800 s = 1.8 s (±1 %)
- ✅ A05 Defensive AA missile vs air: 55.0 dmg/volley → 30.56 DPS ≈ roster 30.56 (±2 %)
- ✅ T01 Pulse carbine: roster row matches unit_specs (dmg 16, burst 1, cycle 0.8, range 23)
- ✅ T01 Pulse carbine vs infantry: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ T01 Pulse carbine vs infantry: 16.0 dmg/volley → 20.00 DPS ≈ roster 20 (±2 %)
- ✅ T01 Pulse carbine vs light: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ T01 Pulse carbine vs light: 4.8 dmg/volley → 6.00 DPS ≈ roster 6 (±2 %)
- ✅ T01 Pulse carbine vs heavy: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ T01 Pulse carbine vs heavy: 1.6 dmg/volley → 2.00 DPS ≈ roster 2 (±2 %)
- ✅ T01 Pulse carbine vs building: mean cycle 0.800 s = 0.8 s (±1 %)
- ✅ T01 Pulse carbine vs building: 3.2 dmg/volley → 4.00 DPS ≈ roster 4 (±2 %)
- ✅ T02 Disruption lance - ground: roster row matches unit_specs (dmg 50, burst 1, cycle 2, range 32)
- ✅ T02 Disruption lance - ground vs light: mean cycle 2.000 s = 2 s (±1 %)
- ✅ T02 Disruption lance - ground vs light: 50.0 dmg/volley → 25.00 DPS ≈ roster 25 (±2 %)
- ✅ T02 Disruption lance - ground vs heavy: mean cycle 2.000 s = 2 s (±1 %)
- ✅ T02 Disruption lance - ground vs heavy: 50.0 dmg/volley → 25.00 DPS ≈ roster 25 (±2 %)
- ✅ T02 Disruption lance - ground vs naval: mean cycle 2.000 s = 2 s (±1 %)
- ✅ T02 Disruption lance - ground vs naval: 37.5 dmg/volley → 18.75 DPS ≈ roster 18.75 (±2 %)
- ✅ T02 Disruption lance - ground vs building: mean cycle 2.000 s = 2 s (±1 %)
- ✅ T02 Disruption lance - ground vs building: 20.0 dmg/volley → 10.00 DPS ≈ roster 10 (±2 %)
- ✅ T02 Disruption lance - air: roster row matches unit_specs (dmg 20, burst 1, cycle 2, range 38)
- ✅ T02 Disruption lance - air vs air: mean cycle 2.000 s = 2 s (±1 %)
- ✅ T02 Disruption lance - air vs air: 20.0 dmg/volley → 10.00 DPS ≈ roster 10 (±2 %)
- ✅ T03 Accelerator cannon: roster row matches unit_specs (dmg 95, burst 1, cycle 2.5, range 46)
- ✅ T03 Accelerator cannon vs infantry: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ T03 Accelerator cannon vs infantry: 19.0 dmg/volley → 7.60 DPS ≈ roster 7.6 (±2 %)
- ✅ T03 Accelerator cannon vs light: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ T03 Accelerator cannon vs light: 95.0 dmg/volley → 38.00 DPS ≈ roster 38 (±2 %)
- ✅ T03 Accelerator cannon vs heavy: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ T03 Accelerator cannon vs heavy: 95.0 dmg/volley → 38.00 DPS ≈ roster 38 (±2 %)
- ✅ T03 Accelerator cannon vs naval: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ T03 Accelerator cannon vs naval: 61.8 dmg/volley → 24.70 DPS ≈ roster 24.7 (±2 %)
- ✅ T03 Accelerator cannon vs building: mean cycle 2.500 s = 2.5 s (±1 %)
- ✅ T03 Accelerator cannon vs building: 61.8 dmg/volley → 24.70 DPS ≈ roster 24.7 (±2 %)
- ✅ T04 Light pulse emitter: roster row matches unit_specs (dmg 8, burst 1, cycle 0.4, range 26)
- ✅ T04 Light pulse emitter vs infantry: mean cycle 0.400 s = 0.4 s (±1 %)
- ✅ T04 Light pulse emitter vs infantry: 8.0 dmg/volley → 20.00 DPS ≈ roster 20 (±2 %)
- ✅ T04 Light pulse emitter vs light: mean cycle 0.400 s = 0.4 s (±1 %)
- ✅ T04 Light pulse emitter vs light: 1.6 dmg/volley → 4.00 DPS ≈ roster 4 (±2 %)
- ✅ T05 Guided raider missile - sea: roster row matches unit_specs (dmg 75, burst 1, cycle 2.2, range 65)
- ✅ T05 Guided raider missile - sea vs naval: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ T05 Guided raider missile - sea vs naval: 75.0 dmg/volley → 34.09 DPS ≈ roster 34.09 (±2 %)
- ✅ T05 Guided raider missile - shore: roster row matches unit_specs (dmg 75, burst 1, cycle 2.2, range 45)
- ✅ T05 Guided raider missile - shore vs light: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ T05 Guided raider missile - shore vs light: 67.5 dmg/volley → 30.68 DPS ≈ roster 30.68 (±2 %)
- ✅ T05 Guided raider missile - shore vs heavy: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ T05 Guided raider missile - shore vs heavy: 60.0 dmg/volley → 27.27 DPS ≈ roster 27.27 (±2 %)
- ✅ T05 Guided raider missile - shore vs building: mean cycle 2.200 s = 2.2 s (±1 %)
- ✅ T05 Guided raider missile - shore vs building: 52.5 dmg/volley → 23.86 DPS ≈ roster 23.86 (±2 %)
- ✅ Hammer cannot target infantry (0 shots)
- ✅ Mote has no damage against heavy armour (0 shots)

### 5 firing behaviour — 23/23

- ✅ H01 never fires while moving (0) and fires after stopping
- ✅ H01 first shot 0.133 s after aim start ≥ wind-up 0.12 s
- ✅ A01 never fires while moving (0) and fires after stopping
- ✅ A01 first shot 0.133 s after aim start ≥ wind-up 0.12 s
- ✅ T01 never fires while moving (0) and fires after stopping
- ✅ T01 first shot 0.100 s after aim start ≥ wind-up 0.1 s
- ✅ T02 never fires while moving (0) and fires after stopping
- ✅ T02 first shot 0.200 s after aim start ≥ wind-up 0.2 s
- ✅ H02 never fires while moving (0) and fires after stopping
- ✅ H02 first shot 0.367 s after aim start ≥ wind-up 0.35 s
- ✅ H02 lock-on interrupted by a move order deals no damage (0 launches, hp full)
- ✅ H03 fires while moving (4 shots at >1 m/s), worst turret error 3.25° ≤ 5°
- ✅ A03 fires while moving (3 shots at >1 m/s), worst turret error 1.40° ≤ 4°
- ✅ T03 fires while moving (3 shots at >1 m/s), worst turret error 0.00° ≤ 4°
- ✅ T03 speed limited to 65 % during the 0.25 s charge (and 0.35 s recovery)
- ✅ H04 fires only below 50% speed (18 shots, 0 too fast)
- ✅ H04 holds stand-off ≈ 36 m (mean 35.2 m)
- ✅ T04 fires only below 60% speed (57 shots, 0 too fast)
- ✅ T04 holds stand-off ≈ 21 m (mean 21.1 m)
- ✅ A05 holds anti-ship fire inside the 8 m minimum range (target at 5.6 m, 0 launches)
- ✅ T05 shore missiles (45 m) don't reach a tank at 53.7 m though sea range is 65 m
- ✅ guided rocket turn rate ≤ 180°/s (worst 0.0)
- ✅ guided missile self-destructs when the target dies first (0 self-destructs, no retarget)

### 6 Kestrel sortie — 9/9

- ✅ takeoff → release → land → reload sequence present
- ✅ release aligned within 10° (0.00°) at 28.4 m = 35 m/s × 0.8 s fall (28 m)
- ✅ two bombs 0.25 s apart (0.267 s)
- ✅ each bomb lands 0.8 s after its release (0.833 s)
- ✅ both bombs hit the fixed aim point: 180 + 180 = 2 × 180 on a stationary heavy target
- ✅ landing takes 1.2 s (1.20 s) and reload 6 s (6.00 s)
- ✅ turn radius in flight never below 12 m (min 12.00 m)
- ✅ re-sorties after rearming while the attack order stands (sortie cycle 25.9 s for a 240 m run; reference 14 s)
- ✅ splash: centre infantry takes 2×81 = 162.0; 4 m away takes 72.6 ≈ 72.6 (linear to ×0.25 at 5 m from the surface)

### 7 abilities — 15/15

- ✅ A01 deploy takes 0.8 s (0.800) and fires only after setup
- ✅ A01 deployed weapon is the machine gun (25 m, 0.45 s): fires at a target 21.4 m away beyond the 18 m carbine
- ✅ A01 move while deployed: packs up for 0.6 s (0.600), then moves (queued order kept)
- ✅ A02 mobile ignores ground vehicles (0 launches); deployed (1.0 s) fires the AT missile (2 launches, weapon 1)
- ✅ EMP wind-up 0.3 s (0.300) then applied
- ✅ EMP effect lasts 3 s (until 3.00) with immunity 6 s after (9.00 s from cast)
- ✅ EMP cooldown 20 s from release (20.00)
- ✅ EMP cannot target infantry
- ✅ EMP stretches the A03 cycle 2.2 s → 2.752 s (×1.25 = 2.75; sustained DPS −20 %)
- ✅ EMP immunity: second cast at +4 s is not applied (applied=false)
- ✅ scan reveals a tank behind the ridge (seen before false, during true, after 8 s false); 0.25 s activation; cooldown 30 s
- ✅ Conscript enters in 1.0 s (1.000), Pulse Trooper in 0.9 s (0.900); Rocket Trooper cannot garrison
- ✅ garrisoned units fire from ports (10 shots) and cannot be targeted
- ✅ building destruction kills occupants (alive: false, false)
- ✅ kill of a 900-credit tank promotes a 300-credit Rocket Trooper to Veteran (xp 900, rank 1) keeping HP % (50 %, max 121.00000000000001)

### 8 collision & smoothness — 6/6

- ✅ group of 9 tanks + 12 infantry: final min surface gap 0.35 m (spacing rule ≥ 0.25 m, tolerance 0.05)
- ✅ no per-tick teleport (speed > spec + 2.6 m/s separation drift): 0
- ✅ no heading snaps beyond the unit's yaw-rate limit: 0
- ✅ all arrived (21/21)
- ✅ deterministic: identical state after 60 s of a 60-unit battle
- ✅ sim cost 0.365 ms per 30 Hz tick for 60 units in battle (budget 4 ms)

### 9 pace & harvester — 10/10

- ✅ pace.js and data/pace.json match the repo source (data/sync_pace.py)
- ✅ harvester top speed 12.50 m/s = 1.25 × Lancer 10 m/s, faster than both tracked tanks (H03 7.8, A03 10)
- ✅ near field: 2 full cycles (2)
- ✅ near field: simulated round trip 53.87 game s matches the pace model 53.97 s within 2%
- ✅ near field: loads 10.00 s and unloads 1.50 s (pace.json 10 / 1.5, ±1 tick)
- ✅ near field: stays out of the refinery walls (0 ticks inside) and unloads exactly on the grate (0 ticks off)
- ✅ far field: 2 full cycles (2)
- ✅ far field: simulated round trip 82.20 game s matches the pace model 81.77 s within 2%
- ✅ far field: loads 10.00 s and unloads 1.50 s (pace.json 10 / 1.5, ±1 tick)
- ✅ far field: stays out of the refinery walls (0 ticks inside) and unloads exactly on the grate (0 ticks off)

## Unit Sandbox run (`node units/sandbox/test_sandbox.js --shots`)

Renderer: headless Chromium, ANGLE + SwiftShader (software rasteriser, 2 vCPU) — real-GPU frame rates will differ. Load time 4.933 s.

The scenarios run on the page's test clock at game speed 1: 60 Hz presentation frames over a 30 Hz simulation. That keeps the motion measurements independent of how slowly the software rasteriser draws and comparable with earlier runs. The pace runs below repeat the checks at the default game speed. The columns are:

- **Snaps**: rendered unit moves in one frame that are faster than physically possible.
- **Foot slide**: how far a planted toe drifts during one stance (mean / worst).
- **Track sync**: the largest mismatch between belt scroll and ground distance.
- **JS ms/frame**: the cost of the simulation, animation and effects for one presentation frame. GPU time is not included.

| Scenario | sim s | shots (incl. bombs) / deaths | snaps | foot slide mean / worst | track sync | JS ms/frame p50 / p95 | sim ms/tick | page errors |
|---|---|---|---|---|---|---|---|---|
| tour | 40 | 12 / 1 | 0 of 40170 | 0.08 / 0.21 cm (464 stances) | 0 m | 0.8 / 2 | 0.08 | 0 |
| battle | 45 | 430 / 21 | 0 of 52902 | 0.05 / 0.22 cm (748 stances) | 0 m | 1.1 / 2.1 | 0.019 | 0 |
| sortie | 40 | 4 / 0 | 0 of 11995 | 0 / 0 cm (0 stances) | 0 m | 0.1 / 0.2 | 0.029 | 0 |
| emp | 14 | 4 / 0 | 0 of 3356 | 0 / 0 cm (0 stances) | 0 m | 0.1 / 0.5 | 0.151 | 0 |
| garrison | 22 | 27 / 3 | 0 of 3254 | 0.02 / 0.02 cm (103 stances) | 0 m | 0.3 / 0.7 | 0.086 | 0 |
| deploy | 20 | 40 / 2 | 0 of 9242 | 0.02 / 0.02 cm (103 stances) | 0 m | 0.3 / 1.1 | 0.222 | 0 |
| naval | 40 | 46 / 2 | 0 of 10559 | 0 / 0 cm (0 stances) | 0 m | 0.3 / 0.8 | 0.028 | 0 |
| economy | 60 | 0 / 0 | 0 of 3599 | 0 / 0 cm (0 stances) | 0 m | 0 / 0.1 | 0.003 | 0 |

**CPU cost as played.** This is the Live fire battle with the normal animation LOD and 18 live units. JS time per presentation frame is p50 1.2 ms, p95 4.1 ms, p99 6.6 ms. The mean breakdown is: simulation 0.174 ms, unit views 1.204 ms (infantry IK 0.986 ms), effects 0.101 ms. It was measured on a 2-vCPU cloud machine with software rendering, so a desktop CPU should come in lower.

**Attitude and aim probes.** These check that the view and the simulation agree: the hull pitches nose-up on climbs, aircraft and hovercraft bank into turns, ships lean outward, and turrets and muzzles point at the target.

- ✅ tank climbing the 20° ramp pitches nose-up (max 21.1°)
- ✅ H03 turret turned toward a target on its left (turret 67.6°, view yaw 67.6°)
- ✅ H03 muzzle socket points at the target (cos 1.0000)
- ✅ sim muzzle ≈ model muzzle (0.12 m)
- ✅ H04 at 19.0 m/s pitches nose-down (-8.4°, max 12°)
- ✅ H04 main rotor turning
- ✅ H04 banks into a left turn (right side up, max 12.2°, limit 15°)
- ✅ H05 leans outward in a left turn (min roll -4.50°)
- ✅ T03 banks into a left turn (5.00°) within ±5° (|max| 5.00°)
- ✅ A04 bank ≤ 55° (max 24.6°), gear stowed in the attack run (true)
- ✅ A05 cell lid opens upward before launch (free edge rises to 81°)
- ✅ H05 barrel recoils 0.180 m (spec 0.18 m)

**Live clock under SwiftShader**, with the Live fire battle running at the default game speed and 27 units (the economy buildings add about 30k triangles and 50 draw calls): frame time p50 33.4 ms, p95 250 ms, p99 250 ms; 338 draw calls; 283,895 triangles.
This is a software rasteriser on 2 shared vCPU, so these are **not** expected real-GPU frame rates. The JS cost column above is the CPU part of the frame.

## Game speed and the harvester (`data/pace.json`: game speed 2.4×, harvester 1.25× the Lancer)

Game speed is a uniform time scale: the 30 Hz simulation runs that many times faster against the wall clock. The harvester uses the maps' `unit_harvester` model with a six-wheel skid-steer drive. Its cycle is:

1. Leave the refinery's unloading grate facing the field.
2. Drive to the rig's service point and load.
3. Drive back.
4. Pivot at the bay's approach point.
5. Reverse 25.2 m onto the grate and unload.

| Field | Game s at 1× | Game s at default | Real s at default | Pace model (game s) |
|---|---|---|---|---|
| near | 53.87 | 53.87 | **22.44** | 53.97 |
| far | 82.20 | 82.20 | **34.25** | 81.80 |

The game seconds are identical at both speeds, so game speed changes only the wall clock. The simulated harvester also matches the shared pace model that the Map Lab uses for every map.

**Motion at the default game speed** (2.4×, 60 Hz presentation):

- **battle:** 20 s real (48 game s). 0 snaps in 23554 samples. Worst foot slide 0.21 cm over 380 stances. Track sync 0 m.
- **tour:** 20 s real (48 game s). 0 snaps in 19927 samples. Worst foot slide 0.21 cm over 178 stances. Track sync 0 m.

Console errors and warnings during the run: 0.

## Assumptions (not in the pack)

- **Infantry movement**: acceleration 14 m/s², braking 18 m/s², turn rate 540°/s. Deployed traverse is 90°/s.
- **Tanks**: braking is 1.6× acceleration. Gun pitch rate is 25°/s. Climbing a slope cuts speed by up to 45 % on 25°. The hull pivots in place when the heading error is over 45°.
- **Hover tank (T03)**: gun pitch −6…+15°, aim tolerance 4°, braking 2× acceleration. It starts slowing before its charge so that the 65 % limit holds for the whole 0.25 s wind-up.
- **Ships**: rudder authority grows with speed, and twin screws give 30 % yaw at rest. They plan with turning room of about 45 % of hull length. Hull capsule ends never leave authored deep water (≥ 3 m).
- **H05 Bulwark**: gun pitch −5…+25°, aim tolerance 5°, turret hard stops ±135° (taken from the model, where the muzzle would meet the deckhouse beyond about 145°).
- **A05 Sentinel**: AA launcher yaw 180°/s, pitch 0…85°, tolerance 15°.
- **Kestrel bombs**: they fall for 0.8 s onto a fixed aim point. The first bomb, released at 28 m, inherits the jet's full 35 m/s. The second, released 0.25 s later, needs about 24 m/s horizontal to land on the same point. Both bombs therefore hit the aim point, which matches the listed sortie damage.
- **Kestrel landing**: it uses a VTOL approach to its pad. It decelerates over about 70 m, then the 1.2 s landing and 6 s reload.
- **H02 targeting**: the Rocket Trooper always prefers aircraft. The sheet says it prefers air only "when threatening nearby friendly units"; that threat test is simplified to always.
- **Visibility**: sight is terrain-occluded for all eyes, including aircraft. The Mote scan reveals through terrain.

## Decisions and backlog (2026-11-06)

- **Infantry width is parked for the art pass** (decision: do not widen now). The measurements are below.
- **Distant-view models (LOD1 and LOD2) are built**: integration Stage 1, see above.
- **The Pulse Trooper is restyled as an android** (approved): graphite synthetic body, joint actuators, faceless head with a cyan visor slit, sensor ears and a ribbed neck.
- **Faction mapping approved** (`units/data/faction_mapping.json`):
    - Iron Legion → the Compact (Cold War 2.0); Nova Directive → the Lattice (drones and AI); Vanguard → Helix Dynamics (cyberpunk megacorps).
    - Game names win every clash: Lancer → Arbiter, Spectre → Trident, and Disruptor → Nullifier (placeholder).
    - The Missile Specialist is dropped from Helix.
    - The Bulwark is re-tuned to the Corvette escort role with its model unchanged.
    - Applied at integration; `unit_specs.json` stays the pack's unchanged source.

## Known limitations

- LOD1/LOD2 are automatic collapse decimations of LOD0, not hand-authored. At LOD2 small details merge, which is intended at that size.
- **Infantry width is narrower than the sheets** (parked for the art pass). In the aim pose the six infantry measure 66–80 % of the typeset width (0.54–0.60 m against 0.72–0.84 m). Heights are within 5 % and lengths within 12 %. The bodies are anatomically proportioned and the elbows stay close to the torso, while the sheets' envelopes assume flared elbows and broader packs. Gameplay collision uses the pack's own radii, so mechanics are unaffected; the silhouettes are the only thing that differs.
- Every model is inside its LOD0 triangle budget, but material counts exceed the sheet's budget figures: the sandbox contract needs separate TRACK, GLOW, DISC, GLASS and TEAM materials so the view can scroll, tint and fade them.
- Units are lit with a neutral studio environment map plus sun and sky. It stands in for the game's own lighting setup, which these units have not been placed in yet.
- Infantry use one shared procedural rig and IK animation, not authored keyframe clips.
- Support powers (reinforcement, drone strike, temporary promotion) are not implemented; they are not unit mechanics. Production queues are not implemented either.
- Garrisoned units fire from the bunker's four corner ports. Port line of sight is not tested against the bunker walls.
- The sandbox is separate from the existing Thunderhead game build, which uses different factions and is not metric.
- The harvester, refinery and extraction rig come from the maps' asset library and are not pack units. The sandbox has no roads, so the harvester runs at its single speed (1.25× the Lancer by default).
