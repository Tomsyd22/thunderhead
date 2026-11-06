# Unit model contract (Blender → GLB → Unit Sandbox)

The sandbox drives each model only through the names below. Keep them exact. Names are case-sensitive and must not contain dots.

## Axes, scale, origin
- 1 Blender unit = 1 m. Z up, **+Y forward**, **+X = the unit's right**. Export is glTF y-up, so in three.js the unit faces −Z.
- Dimensions follow `data/unit_specs.json`: length = Y, width = X, height = Z. They cover the combat-ready envelope, including weapons, rotors and gear. The tolerance is ±4 %, and `ulib.finish` prints the check.
- Where each unit's origin (the `root` empty at 0,0,0) sits:
  - **Infantry:** ground, between the feet.
  - **Tanks:** ground, under the hull centre. The hover tank's origin is the ground projection; its mesh floats 0.45 m above it.
  - **Aircraft:** the fuselage underside. The game adds altitude.
  - **Ships:** the design waterline. The keel sits at −waterline (H05 −1.4 m, A05 −2.2 m, T05 −1.0 m).
- Every part is a child, directly or indirectly, of one empty named `root`.

## Shared nodes
| name | type | meaning |
|---|---|---|
| `root` | empty | unit origin. Carries custom properties (exported as glTF extras) such as `unit` and `tris` |
| `hull` | mesh | main body (vehicles, ships, aircraft) |
| `hit` | empty | targeting / hit socket (chest at z = 1.15 m for infantry, fuselage centre for air) |
| `badge` | empty | overhead rank / status socket |
| `muzzle*` | empty | projectile spawn point. **Local +Y must point along the barrel.** |
| `fx_*` | empty | effect sockets: `fx_exhaust_L/R`, `fx_dust_L/R`, `fx_wake_L/R`, `fx_wake_stern`, `fx_thrust_0..3`, `fx_vent_L/R`, `fx_spray` |

## Materials
| name | meaning |
|---|---|
| `<UID>_paint` | baked colour atlas: paint, grime, edge wear, mud and markings |
| `TEAM` | the same atlas, but the game multiplies it by the player colour (shoulder panels, stripes) |
| `GLOW_<x>` | emissive. Its intensity may be driven by the game (charge, shot events, battery fade) |
| `GLASS` | canopies, visors and lenses |
| `TRACK_L` / `TRACK_R` | track belts. **U runs along the belt**, and the object property `uv_m` = metres per 1.0 U. The game scrolls each side's U by that side's ground distance |
| `DISC_main` / `DISC_tail` / `DISC_rotor` | translucent rotor discs. They are hidden at low rpm, and the game sets their opacity |

## Tanks (H03 Bastion, A03 Lancer)
- **Turret and gun:**
  - `turret`: yaw pivot at the turret ring centre; rotates about local Z.
  - `gun`: pitch pivot at the trunnions; child of `turret`; rotates about local X; positive = barrel up.
  - `recoil`: child of `gun`; translates along local −Y when firing.
  - `muzzle`: child of `recoil`, at the barrel tip.
- **Tracks:** `track_L`, `track_R` are belt meshes with materials `TRACK_L` and `TRACK_R`.
- **Wheels:**
  - Road wheels: `wheel_L_0..n`, `wheel_R_0..n`, front to back, each pivoting at its axle about local X. Property `r` = radius in m.
  - Sprocket and idler: `sprocket_L/R` and `idler_L/R`, with the same pivot rule and property `r`.
- **Small parts:** `antenna` (sway pivot at its base), `fx_exhaust_L/R`, `fx_dust_L/R` (rear track ends).

## Hover tank (T03 Wisp)
- **Body:** `hull`; `pod_L` and `pod_R` (side pods, separate meshes with their own float offset).
- **Turret and gun:** `turret` (yaw), `gun` (pitch).
- **Charge fins:** `fin_L` and `fin_R`. These are children of `gun` and spread ±0.04 m each along local X during charge, 0.08 m apart in total.
- **Sockets:** `muzzle`; `fx_thrust_0..3` (under the pods); `fx_vent_L/R` (rear thrust vents).

## Helicopter (H04 Hammer)
- **Main rotor:**
  - `rotor`: hub, spins about local Z.
  - `blade_0..3`: children of `rotor`.
  - `rotor_disc`: a disc mesh, child of the rotor, with material `DISC_main`.
- **Tail rotor:** `tail_rotor` spins about local X. `tail_disc` uses material `DISC_tail`.
- **Weapons:** `pod_L` and `pod_R` yaw ±10° about local Z. `muzzle_L` and `muzzle_R` are children of the pods.
- **Sockets:** `fx_exhaust_L/R`.

## Jet (A04 Kestrel)
- **Control surfaces:** each pivots on its hinge line, and the hinge axis is the local X of its pivot empty.
  - `aileron_L/R`
  - `elevator_L/R`
  - `rudder_L/R` (rotates about local Z of the pivot)
- **Landing gear:**
  - `gear_N`, `gear_L`, `gear_R`: hinge pivots. Rotating them about local X by `retract` (property, radians) stows them.
  - `door_*` are optional.
- **Bombs and nozzle:**
  - `bomb_L` and `bomb_R`: separate meshes, detached and hidden at release.
  - `nozzle`: mesh with material `GLOW_afterburner` on its inner face.
- **Sockets:** `fx_exhaust`.
- The model is exported **gear down** (the height includes deployed gear).

## Drone (T04 Mote)
- **Rotors:** `rotor_FL`, `rotor_FR`, `rotor_RL`, `rotor_RR` spin about local Z. Their discs use material `DISC_rotor`.
- **Gimbal:** `gimbal` (yaw about local Z, below the nose) → `gimbal_pitch` (about local X) → `muzzle` and `eye`.

## Ships (H05 Bulwark, A05 Sentinel, T05 Spectre)
- **Hull:** the `hull` mesh is modelled down to the keel, with a dark antifouling band below z = 0.
- **H05 gun:** `turret` → `gun` → `recoil` → `muzzle`. Property `yaw_limit_deg` on `turret` sets the hard stops so the gun cannot fire through the cabin.
- **Propellers:** `prop_L` and `prop_R` spin about local Y. T05 has waterjets `jet_L` and `jet_R` instead, which yaw about local Z to steer.
- **Wake sockets:** `fx_wake_L`, `fx_wake_R`, `fx_wake_stern`.
- **A05 Sentinel:**
  - Missile cells: `lid_0..3` (hinged at their aft edge; open = rotate about local X), with `muzzle_cell_0..3` under each lid.
  - Radar: `radar` (yaw).
  - AA launcher: `aa` (yaw) → `aa_pitch` → `muzzle_aa`.
- **T05 Spectre:**
  - Sensor: `sensor` (yaw) → `sensor_pitch`.
  - Launcher: `lid_L` and `lid_R` (hinged), with `muzzle_L` and `muzzle_R`.

## Infantry (H01, H02, A01, A02, T01, T02)
- **Skinned mesh** `body` bound to the armature `rig`.
  - Bones: `pelvis`, `spine_01`, `spine_02`, `spine_03`, `neck`, `head`, then `clavicle_L/R`, `upperarm_L/R`, `forearm_L/R`, `hand_L/R`, `thigh_L/R`, `shin_L/R`, `foot_L/R`, `toe_L/R`.
  - Bind pose: standing, arms at about 20° down from horizontal.
- **Weapon:** a separate rigid node `weapon`, a child of `root`, posed by the game.
  - `weapon` children: `grip_R` (trigger hand), `grip_L` (support hand), `muzzle`, and `stock` (shoulder contact point).
  - The weapon's local +Y points along the barrel.
- **Deployables** (rigid, children of `root`):
  - Ranger: `shieldbox` with hinged `shield_L/R`; `bipod_L/R` on the weapon.
  - Missile Specialist: `tripod` with legs `leg_0..2`, plus the `launcher` (the weapon) with `muzzle_aa` / `muzzle_at`.
- **Garrison, death and props:** the game handles visibility. A dropped launcher or lance becomes an inert prop.
