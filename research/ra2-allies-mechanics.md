# Command & Conquer: Red Alert 2 / Yuri's Revenge — Allied Faction & Core Mechanics Reference

Scope: Allied faction (RA2 + YR) and game-wide core mechanics. Soviets and Yuri are covered elsewhere and appear here only where a core rule needs them (e.g. the Verses table, superweapon timer list).

**Source conventions.** Unless marked otherwise, numeric values are transcribed from a full copy of the retail Yuri's Revenge `rulesmd.ini` (header: "Red Alert 2: Yuri's Revenge Rules", ~743 KB, 31k lines). Where RA2 1.0 `rules.ini` differs and the difference is known from secondary sources, it is noted as "(RA2: …)". Values from fan wikis/strategy guides that could not be confirmed against the INI are marked **(unverified)**. Time units: the INI's own comments state 900 frames = 1 minute, i.e. **15 frames/second** at normal game speed; the "Fastest" setting raises the frame rate so every frame-based timer (ROF, recharge, chrono delay) shortens in wall-clock terms. Distance: 1 cell = 256 leptons.

---

## A. ECONOMY & BASE RULES

### A1. Ore, gems, miners, refineries

| Item | Value | Source key |
|---|---|---|
| Ore (green) value per bail | 25 credits | `[Riparius] Value=25` |
| Gems value per bail | 50 credits | `[Cruentus] Value=50` |
| Ore regrowth / spread | Grows denser and spreads; `GrowthRate=5` (minutes between growth ticks), `TiberiumGrows=yes`, `TiberiumSpreads=yes`; Riparius `Growth=2200, Spread=2200` | `[General]`, `[Riparius]` |
| Gem regrowth | Effectively none (`[Cruentus] Growth=10000, Spread=10000`) | |
| Chrono Miner capacity | `Storage=20` bails → **$500 ore / $1000 gems** per load | `[CMIN]` |
| Soviet War Miner capacity (for comparison) | `Storage=40` → $1000 ore / $2000 gems | `[HARV]` |
| Refinery | `Refinery=yes`, `NumberOfDocks=1` (one miner unloads at a time), `Storage=200` (no silo mechanic in RA2; storage is unlimited in practice). Each Allied refinery arrives with one free Chrono Miner (`PrerequisiteProc=GAREFN`, free harvester logic) | `[GAREFN]` |
| Ore Purifier bonus | `PurifierBonus=.25` → **+25% credits per unload**; `BuildLimit=1` | `[General]`, `[GAOREP]` |
| Tech Oil Derrick | `ProduceCashStartup=1000` (one-time on capture), then `ProduceCashAmount=20` every `ProduceCashDelay=100` frames (≈ 20 credits / 6.7 s ≈ 180/min) | `[CAOILD]` |
| Harvesters per refinery (AI heuristic) | `HarvestersPerRefinery=2,2,1` | `[General]` |
| Chrono Miner return | Teleports to refinery when full (`Teleporter=yes`); `ChronoHarvTooFarDistance=50` cells caps how far it will roam | `[General]`, `[CMIN]` |
| Spy money theft | `SpyMoneyStealPercent=.5` (50% of victim's cash). C&C Wiki states 20% in YR **(discrepancy, unverified which patch)** | `[General]` |
| Starting credits (skirmish) | `MinMoney=5000`, default `Money=10000`, `MaxMoney=10000`, `MoneyIncrement=100`; starting `UnitCount=10` (0–10) | `[MultiplayerDialogSettings]` |
| Crate money | `SoloCrateMoney=5000` (solo play); multiplayer money crate data value 2000 | `[CrateRules]`, `[Powerups]` |

### A2. Power

| Rule | Value |
|---|---|
| Allied Power Plant output | **+200** (`[GAPOWR] Power=200`) — the Allies' only power producer (RA2: Soviet Tesla Reactor +150, Nuclear Reactor +2000 for comparison) |
| Low-power production penalty | Production speed = clamp(1 − shortfall × `LowPowerPenaltyModifier=1`, `MinLowPowerProductionSpeed=.5`, `MaxLowPowerProductionSpeed=.8`). I.e. even 1% short caps production at 80% speed; worst case 50% speed. |
| Low-power building effects | Buildings with `Powered=yes` go offline: Patriot Missile, Prism Tower, Grand Cannon, Gap Generator, Spy Satellite Uplink, Ore Purifier, Robot Control Center (shuts down all Robot Tanks), Chronosphere/Weather Control (`IsPowered=true` on the superweapon → timer freezes). Radar minimap goes off (radar requires power). Pillbox (`Power=0`) and walls keep working. |
| Trivial low-power structure damage | `DamageDelay=1` minute between applying "trivial structure damage when low on power" (TS legacy; effectively unused). |
| Spy in power plant | `SpyPowerBlackout=1000` frames (~67 s) of total power loss; building more plants does not end it early. |
| Force Shield side-effect | `ForceShieldBlackoutDuration=1000` frames of your own power loss after use. |

### A3. Build radius, construction, factories

| Rule | Value |
|---|---|
| Deploy | MCV (`AMCV`, `DeploysInto=GACNST`) deploys into Construction Yard; `MCVRedeploys=yes` default (Con Yard can undeploy back into MCV). `FreeMCV=yes` (crate can give an MCV). `BaseUnit=AMCV,SMCV,PCV`. |
| Build adjacency | A structure must be placed within `Adjacent=N` cells of an existing own structure with `BaseNormal` (default yes). Standard buildings `Adjacent=2`; Pillbox/Patriot `Adjacent=4`; walls `Adjacent=8`; Naval Shipyard `Adjacent=12`. Defences, walls, shipyard, Grand Cannon have `BaseNormal=no` → they do **not** extend the build radius. |
| Build speed | `BuildSpeed=.7` minutes per 1000 credits (≈ 42 s per $1000; a $700 Grizzly ≈ 29 s; a $2000 War Factory ≈ 84 s) plus `BuildupTime=.06` min build-up animation. |
| Multiple factories | `MultipleFactory=0.8`: each additional factory of the same kind multiplies build time by 0.8 cumulatively (1, 0.8, 0.64, 0.512…). |
| Walls | `WallBuildSpeedCoefficient=3.0` (walls build 3× slower per piece); up to 4 wall segments placed per click along a line **(unverified count)**. |
| Queue | `MaximumQueuedObjects=29`. Buildings: one at a time per Con Yard tab; units: queue per tab. |
| Placement retry | `PlacementDelay=.05` min. |
| Prerequisite classes | `PrerequisitePower=GAPOWR,NAPOWR,NANRCT,YAPOWR`; `PrerequisiteFactory=GAWEAP,…`; `PrerequisiteBarracks=GAPILE,…`; `PrerequisiteRadar=GAAIRC,NARADR,AMRADR,NAPSIS` (for Allies: Airforce Command HQ is the radar); `PrerequisiteTech=GATECH,…`; `PrerequisiteProc=GAREFN,…`. |
| Tech level | Skirmish default `TechLevel=10` (everything available). |

### A4. Capture, repair, sell

| Rule | Value |
|---|---|
| Engineer capture | Instant capture of any `Capturable=true` enemy structure (`MultiEngineer=no` default; the engineer is consumed). Not capturable: defences, walls, shipyards (`GAYARD Capturable=no`), Gap Generator, Ore Purifier, Chronosphere, Weather Control, Grand Cannon. Tech buildings need `NeedsEngineer=yes`. With `MultiEngineer=yes` (optional MP setting) an engineer entering a building above a damage threshold only damages it instead of capturing **(threshold hard-coded, unverified)**. |
| Engineer other uses | Enter own damaged building → full repair (consumed). Enter bridge repair hut → bridge rebuilt. Defuse Crazy Ivan bomb (`DefuseKit`, warhead `BombDisarm`, not consumed). In IFV → repair turret. |
| Building repair | Click Repair button then building: `RepairPercent=15%` of cost to go from 0 to full, charged incrementally; `RepairStep=8` HP per tick every `RepairRate=.016` min (~0.96 s, ≈ 8 HP/s). Walls `Repairable=false`. |
| Vehicle repair | Service Depot (`UnitRepair=yes`), Tech Outpost, Naval Shipyard (ships): `URepairRate=.016`; cost proportional to unit cost. Depot repair also removes Terror Drones. Allied Service Depot could sell vehicles in RA2; removed in YR patch 1.001. |
| Infantry repair | `IRepairRate=.001`, `IRepairStep=20` (Tech Hospital heals all infantry: `SelfHealInfantryFrames=50`, `SelfHealInfantryAmount=20`; Tech Machine Shop heals vehicles `SelfHealUnitFrames=75`, `SelfHealUnitAmount=5`). |
| Sell refund | `RefundPercent=50%` of cost (units at depot too, RA2). Selling a building spawns survivors: Allied sell value ÷ `AlliedSurvivorDivisor=500` GIs; Con Yard gives an Engineer (`Engineer=ENGINEER`). |
| Vehicle crew | `CrewEscape=50%` chance a destroyed Allied vehicle leaves a GI (`AlliedCrew=E1`). Hard-coded: only for some unit types **(unverified)**. |

### A5. Garrisoning (urban combat)

| Rule | Value |
|---|---|
| Who can garrison | Only infantry with `Occupier=yes`: Allied **GI** only (also Soviet Conscript, Yuri Initiate). Guardian GI has `Occupier=no`; Engineers cannot. |
| What can be garrisoned | Neutral civilian buildings with `CanBeOccupied=yes` and `MaxNumberOccupants>0`. Of ~175 such buildings in rulesmd: 126 hold 10, 15 hold 5, 9 hold 8, 7 hold 6, 3 hold 4, 3 hold 3, 1 holds 1. |
| Garrison weapon | GI fires `UCPara` (30 dmg, ROF 15, range 6, warhead SSAB) — i.e. its deployed weapon with more damage; elite GI fires `UCElitePara` (40 dmg). |
| Bonuses | `OccupyDamageMultiplier=1.2`, `OccupyROFMultiplier=1.2` (ROF delay ×1.2 — a slight slowdown), `OccupyWeaponRange=5` (forced range for occupants). Building `ThreatPerOccupant=10`. Occupants are immune to anti-infantry fire; the building takes damage instead. |
| Clearing | Occupants bail out when the building's health falls low (hard-coded threshold **(unverified, ~yellow/red)**); ejected infantry can be killed. Direct clears: Yuri Virus/Desolator do not clear; weapons that damage occupants directly: Allied Grizzly cannot — use Prism Tanks/Towers (CometWH/PrismWarhead 200%/50% vs structures), Harriers, or any high-building-damage weapon. Rocketeers are a common Allied anti-garrison tool (air units cannot be shot by GI garrison rifles? — garrison UCPara uses `InvisibleHigh` projectile which **can** hit air **(verify)**). Engineers capture a garrisoned building only after it is emptied. |
| Battle Bunker (YR, Soviet) | `BunkerDamageMultiplier=1.3`, `BunkerROFMultiplier=1.3`, `BunkerWeaponRangeBonus=2`. |
| Open-topped transports (Battle Fortress) | `OpenToppedRangeBonus=2`, `OpenToppedDamageMultiplier=1.2`, `OpenToppedWarpDistance=7` (passengers fire from inside with +1 cell range? — value is 2 cells bonus, 1.2× damage). |

### A6. Veterancy

| Rule | Value |
|---|---|
| Promotion threshold | `VeteranRatio=3.0`: a unit must destroy enemy value (sum of `Cost`) ≥ 3× its own cost to gain a level; two levels (`VeteranCap=2`): Veteran (one chevron), Elite (three chevrons). `InitialVeteran=no`. |
| Bonus multipliers | `VeteranCombat=1.1` (FIREPOWER: ×1.1 damage), `VeteranArmor=1.5` (STRONGER: incoming damage ÷1.5), `VeteranSpeed=1.2` (FASTER), `VeteranROF=0.6` (ROF: fire delay ×0.6), `VeteranSight=0.0` (SIGHT: no effective change in YR). Each level applies only the abilities listed in that unit's `VeteranAbilities` / `EliteAbilities`; a keyword present in both lists applies twice (armour 1.5 → 2.25) **(stacking behaviour from ModEnc/community testing, unverified against code)**. |
| Typical Allied lists | Infantry: `VeteranAbilities=STRONGER,FIREPOWER,ROF,SIGHT,FASTER`; `EliteAbilities=SELF_HEAL,STRONGER,FIREPOWER,ROF`. Vehicles/ships: `STRONGER,FIREPOWER,SIGHT,FASTER` then `SELF_HEAL,STRONGER,FIREPOWER,ROF`. Aircraft: elite has no SELF_HEAL. Non-trainable (`Trainable=no`): Engineer, Spy, Dog, Chrono Miner, Robot Tank, MCV, Amphibious Transport, Chrono Ivan. |
| Elite weapon swap | `ElitePrimary=`/`EliteSecondary=` replace weapons at Elite (see unit tables). Visually the elite weapon often has a different projectile/anim and veteran-tinted cameo. |
| Self-heal | SELF_HEAL grants `SelfHealing=yes` (slow regeneration; infantry 20 HP per 50 frames and vehicles 5 HP per 75 frames **(unverified these General keys drive elite self-heal; they are the hospital/machine-shop rates)**). |
| Other sources | Promotion crate (`Veteran=20` weight, affects a 3×3 area). Spy in enemy Barracks → your new infantry spawn Veteran; Spy in enemy War Factory → new vehicles/aircraft spawn Veteran (do not stack). Infantry inside an IFV gain no XP (the IFV fires); infantry in a Battle Fortress or garrison do. |

### A7. Crates and tech buildings

Crate weights (`[Powerups]`, "weight, anim, shared, data"): Armor 10 (×1.5 armour), Firepower 10 (×2.0), HealBase 10 (heal all), Money 20 (2000), Reveal 10, Speed 10 (×1.2), Veteran 20 (one level), Unit 20 (free unit; `FreeMCV=yes`). Zero weight (unused): Invulnerability, IonStorm, Gas, Tiberium, Pod, Cloak, Darkness, Explosion, ICBM, Napalm, Squad. `CrateMinimum=1`, `CrateMaximum=255`, `CrateRegen=3` min, `CrateRadius=3.0`, `SilverCrate=HealBase`, `WoodCrate=Money`, `WaterCrate=Money`. Crates spawn on land and water (water crates picked up by ships).

| Tech building | HP / Armour | Effect |
|---|---|---|
| Tech Oil Derrick `CAOILD` | 1000 / steel, `Explodes=yes` | $1000 on capture then ~20 credits per 100 frames. |
| Tech Airport `CAAIRP` | 800 / concrete | Grants `ParaDropSpecial`: 6 GIs (`AllyParaDropNum=6`, `AllyParaDropInf=E1`) every `RechargeTime=4` min; America's own HQ drop is separate (8 GIs). |
| Tech Hospital `CATHOSP` | 800 / concrete | All your infantry self-heal (20 HP / 50 frames). |
| Tech Machine Shop `CAMACH` | 800 / concrete | All your vehicles self-heal (5 HP / 75 frames). |
| Tech Outpost `CAOUTP` | 2000 / concrete | Repairs vehicles (`UnitRepair=yes`, 1 dock) and has a Hover-Missile turret (IFV rocket, AA+AG). |
| Tech Secret Lab `CASLAB` | 1000 / steel | Grants one random item: `SecretInfantry=SNIPE,TERROR,DESO,YURI`, `SecretUnits=TNKD,TTNK,DTRUCK`, `SecretBuildings=GTGCAN`. |
| Civilian Hospital `CAHOSP` (old) | 800 / concrete | RA2-era hospital; no `Hospital=` flag (commented out). |

### A8. Fog, shroud, radar, intel

| Rule | Value |
|---|---|
| Shroud | `Shroud=yes` default; `FogOfWar=no` (no fog by default; optional). `ShroudGrow=no`, `ShroudRate=4`. Allies reveal to each other (`AllyReveal=yes`). |
| Radar | Minimap requires a `Radar=yes` building (Airforce Command HQ or Spy Satellite Uplink) **and** adequate power. `RadarEventSuppressionDistances`, flashing radar events (`RadarEventDurations=400` frames). |
| Spy Satellite Uplink | `SpySat=yes`: reveals the whole map permanently (except under Gap Generators). Selling/losing it re-shrouds. Spy infiltration of enemy radar resets *their* shroud (no effect if they own a SpySat). |
| Gap Generator | `GapRadiusInCells=10`: re-shrouds a 10-cell radius for enemies; `Powered=true`. |
| Spy plane (Soviet) | `CameraRange=9`, recharge 4 min (comparison only). |
| Sight | Per-unit `Sight=` cells; aircraft reveal 6 (`AircraftFogReveal=6`), spy camera 9. Mirage Tanks & other stationary disguised units do not show on radar **(unverified)**. |

### A9. Units, crushing, amphibious, naval, transports

| Rule | Value |
|---|---|
| Build limits | `BuildLimit=1`: Tanya (YR), Chronosphere, Weather Control Device, Ore Purifier. Otherwise no hard unit cap (engine object limit only). |
| Crush | `Crusher=yes` vehicles (all Allied tanks, Miner, MCV, Robot Tank; **not** IFV or Amphibious Transport) kill `Crushable=yes` infantry by driving over them (force-move with Alt). Uncrushable (`Crushable=no`): Tanya (YR), Chrono Legionnaire, Chrono Commando, Psi Commando, Chrono Ivan, deployed Guardian GI, Yuri Brute (YR). Battle Fortress `OmniCrusher=yes` + `MovementZone=CrusherAll`: crushes **vehicles** and uncrushable infantry too. `CrushWarhead=Crush` (100% vs all), `PlayerAutoCrush=no`. |
| Amphibious | `SpeedType=Amphibious`: Tanya, Navy SEAL (swim). `SpeedType=Hover`: Amphibious Transport, Robot Tank (float over water, sink if disabled). Flying: Rocketeer, Nighthawk, Harrier. `MovementZone=AmphibiousDestroyer` for SEAL/Tanya/Robot Tank. |
| Naval | Ships `Naval=yes`, built/repaired at Shipyard (must be fully on water). `ShipSinkingWeight=3.0`: ships at/above weight 3 sink rather than explode. `NavalTargeting`/`LandTargeting` flags restrict what each ship may shoot (see G). Submerged units (`Underwater=yes`, Dolphin) are detected by `Sensors=yes` units within `SensorsSight` (Destroyer 8, Dolphin 8). |
| Transport capacity | Measured in `Size` vs `Passengers`/`SizeLimit`: infantry Size 1, tanks Size 3, MCV/Battle Fortress Size 6. IFV: 1 passenger, SizeLimit 1. Nighthawk: 5 passengers, SizeLimit 2 (infantry only). Battle Fortress: 5, SizeLimit 2 (infantry only). Amphibious Transport: 12 slots, SizeLimit 6 (12 infantry, or 4 tanks, or 2 MCVs, mixed). |
| Chrono rules | Chronosphere moves everything in a 3×3 area (`Range=1.4`) to a 3×3 destination; vehicles only — infantry in the source area are killed (except `Teleporter=yes` infantry such as Chrono Legionnaires) **(hard-coded; from wiki/strategy guides)**; units placed on water drown, naval units on land are destroyed. `ChronoDelay=60` frames of immobility after arrival. Teleporting units (`Teleporter=yes`: Chrono Legionnaire, Chrono Commando, Chrono Ivan, Chrono Miner): phase-in delay = distance(leptons)/`ChronoDistanceFactor=48` (≈ 5.3 frames per cell), minimum `ChronoMinimumDelay=16` frames; `ChronoTrigger=yes` (delay scales with distance). |
| Mind-control immunity | `ImmuneToPsionics=yes`: Tanya (YR), Attack Dog, Chrono Miner, Robot Tank, Psi Commando, Harrier, Black Eagle, Hornet, Osprey, Spy plane, Cargo plane. Buildings are immune to normal mind control (Controller warhead 0% vs wood/steel/concrete). Airborne units can't be targeted by the ground-only `PsychicControl` projectile. |

### A10. Superweapons (all factions, for the core table)

| Superweapon (SW type) | Building | Recharge | Powered? | Effect / numbers |
|---|---|---|---|---|
| Lightning Storm (Weather Control) `LightningStormSpecial` | Allied Weather Controller (`GAWEAT`, $5000) | **10 min** | yes (timer freezes on low power) | `LightningDeferment=250` frames warning, then storm: `LightningStormDuration=180` frames, bolts of `LightningDamage=250` (warhead `IonWH`: 100% vs everything except 2% vs concrete; CellSpread 2, PercentAtMax .5) — direct target hit every `LightningHitDelay=10` frames, random bolts every 5 frames within `LightningCellSpread=10`. Target cursor `Range=7`. |
| Chronosphere `ChronoSphereSpecial` + `ChronoWarpSpecial` | Allied Chronosphere (`GACSPH`, $2500) | **7 min** (guides say ~6) | yes | Two-click: select 3×3 source (`Range=1.4`), then destination. Infantry (non-chrono) die; drowning/beaching rule above. |
| Force Shield `ForceShieldSpecial` (YR) | Any Battle Lab | **5 min** | yes | Structures within `ForceShieldRadius=4` cells invulnerable for `ForceShieldDuration=500` frames (~33 s); your power is cut for `ForceShieldBlackoutDuration=1000` frames (~67 s). No timer shown (`ShowTimer=no`). |
| American Paradrop `AmericanParaDropSpecial` | American Airforce Command HQ (`AMRADR`) | **4 min** | no | `AmerParaDropNum=8` GIs anywhere on the map. |
| Tech Airport Paradrop `ParaDropSpecial` | captured Tech Airport | **4 min** | no | 6 GIs (Allies) / 9 Conscripts (Soviets, `SovParaDropNum=9`) / 6 Initiates (Yuri). |
| Nuclear Missile `NukeSpecial` (Soviet) | Nuclear Missile Silo | **10 min** | yes | `NukePayload` Damage 600, warhead `NUKE` CellSpread 10, PercentAtMax .02 (200% vs light, 8% vs concrete), leaves radiation. |
| Iron Curtain `IronCurtainSpecial` (Soviet) | Iron Curtain Device | **5 min** | yes | 3×3 area (`Range=1.4`) of vehicles/structures invulnerable `IronCurtainDuration=750` frames (50 s); kills infantry. |
| Psychic Dominator `PsychicDominatorSpecial` (Yuri) | Psychic Dominator | **10 min** | yes | `DominatorDamage=1000` with `DominatorWH` (CellSpread 7, 100% vs wood/steel, 6% vs concrete, 0% vs units) + permanently mind-controls units within `DominatorCaptureRange=1` (3×3). |
| Genetic Mutator `GeneticConverterSpecial` (Yuri) | Genetic Mutator | **5 min** | yes | Mutates infantry in `MutateExplosion` CellSpread 5 into Brutes (100% vs infantry armour only). |
| Spy Plane `SpyPlaneSpecial` (Soviet) / Psychic Reveal (Yuri) | Radar Tower / Psychic Radar | 4 min | no | Reveal map region (camera 9 / `PsychicRevealRadius=15`). |

Superweapon construction is announced to all players and the structure is revealed on their minimaps; `ShowTimer=yes` SWs display a countdown to everyone.

---

## B. DAMAGE MODEL

### B1. Armour types (RA2/YR, 11 types, in `Verses=` order)

| # | Armour | Used by (Allied examples) |
|---|---|---|
| 1 | `none` | Most infantry: GI, Guardian GI, Engineer, Rocketeer, Chrono Legionnaire, Sniper, Chrono Commando, Dog, Psi Commando, Chrono Ivan |
| 2 | `flak` | Hero/elite infantry: Navy SEAL, Spy, Tanya (also Soviet Flak Trooper) |
| 3 | `plate` | Armoured infantry (Soviet Tesla Trooper, Desolator, Yuri Brute); no Allied unit |
| 4 | `light` | Light vehicles/ships/aircraft: IFV, Mirage Tank, Prism Tank, Amphibious Transport, Nighthawk, Harrier, Black Eagle, Aegis Cruiser, Dolphin, Hornet, Osprey |
| 5 | `medium` | Chrono Miner |
| 6 | `heavy` | Grizzly, Robot Tank, Battle Fortress, Tank Destroyer, MCV, Destroyer, Aircraft Carrier |
| 7 | `wood` | Light structures: Power Plant, Refinery, War Factory, Battle Lab, Ore Purifier, Service Depot, Gap Gen, SpySat, Robot Control Center |
| 8 | `steel` | Barracks, Airforce HQ, Pillbox, Patriot, Prism Tower, Grand Cannon |
| 9 | `concrete` | Construction Yard, Shipyard, Chronosphere, Weather Controller, walls |
| 10 | `special_1` | Drone/robot armour (Terror Drone) |
| 11 | `special_2` | Missile armour (V3/Dreadnought missiles — Patriot/Aegis intercept) |

Damage = Weapon `Damage` × Verses%[armour] (then ÷ veteran armour multiplier, × firepower multiplier, × `ProneDamage` if the infantry is prone, × garrison/open-topped multipliers). `MinDamage=1`, `MaxDamage=10000`. Special Verses values (RA2/YR only): **0%** = "forbidden": the unit will not accept attack orders, retaliate, or auto-acquire that armour type; **1%** = will attack on command/retaliate but will not auto-acquire; **2%** = ordinary near-zero damage. An infantry weapon with `heavy=0%` will not auto-acquire/retaliate against any vehicle, aircraft or building. Negative Verses heal (`RepairBullet` uses negative Damage instead).

### B2. Warhead Verses table — core and all Allied warheads (verbatim from rulesmd.ini)

Columns: none, flak, plate, light, medium, heavy, wood, steel, concrete, special_1, special_2.

| Warhead | none | flak | plate | light | med | heavy | wood | steel | conc | sp1 | sp2 | CellSpread / PercentAtMax | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **SA** (GI M60, Pillbox, Nighthawk) | 100 | 80 | 80 | 50 | 25 | 25 | 75 | 50 | 25 | 100 | 100 | – | ProneDamage 70%, InfDeath 1 |
| **SSA** (GI deployed, Rocketeer, IFV MG) | 100 | 100 | 100 | 60 | 40 | 40 | 75 | 50 | 25 | 100 | 100 | – | Prone 80% |
| **SSAB** (GI garrison) | 100 | 80 | 80 | 50 | 25 | 25 | 75 | 30 | 20 | 100 | 100 | – | Prone 50% |
| **HE** (IFV Hover Missile) | 100 | 100 | 100 | 70 | 70 | 35 | 75 | 40 | 20 | 80 | 100 | 0.5 / 0.5 | Wall, Wood, Rocker, Prone 70% |
| **AP** (Grizzly 105mm, Robot Tank) | 25 | 25 | 15 | 75 | 100 | 100 | 65 | 45 | 60 | 60 | 100 | 0.3 / 0.5 | Wall, Wood, Prone 50% |
| **GRIZAPE** (elite Grizzly) | 100 | 100 | 100 | 100 | 100 | 100 | 65 | 45 | 60 | 60 | 100 | 0.3 / 0.5 | Elite Grizzly also fires Burst 2 |
| **UltraAP** (Tank Destroyer SABOT) | 2 | 2 | 2 | 100 | 40 | 100 | 2 | 2 | 2 | 2 | 100 | – | Wall, Wood |
| **UltraAPE** (elite TD) | 2 | 2 | 2 | 100 | 50 | 100 | 2 | 2 | 2 | 100 | 100 | – | |
| **MirageWH** (Mirage Tank) | 100 | 100 | 80 | 100 | 100 | 100 | 30 | 20 | 20 | 100 | 100 | – | InfDeath 4 (burn) |
| **CometWH** (Prism Tank + fragments) | 100 | 100 | 100 | 75 | 50 | 50 | 200 | 200 | 200 | 100 | 100 | – | Wall=no |
| **PrismWarhead** (Prism Tower, IFV-cow) | 200 | 100 | 100 | 100 | 100 | 100 | 50 | 50 | 50 | 200 | 100 | – | Wall, InfDeath 5 |
| **GrandCannonWH** | 100 | 100 | 100 | 100 | 100 | 100 | 50 | 100 | 50 | 100 | 100 | 2 / 0.2 | Wall, Wood, Rocker, Prone 30% |
| **HARVWH** (Battle Fortress 20mm, War Miner) | 100 | 80 | 70 | 50 | 20 | 20 | 20 | 15 | 10 | 400 | 100 | – | Prone 50% |
| **GUARDWH** (Guardian GI missile, IFV-Guardian) | 20 | 20 | 20 | 100 | 50 | 100 | 10 | 10 | 10 | 100 | 100 | – | Wall, Wood |
| **HollowPoint** (SEAL MP5, Sniper AWP) | 200 | 100 | 100 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 100 | – | Prone 100%; 1% = fire only on command |
| **HollowPoint2** (Tanya pistols) | 100 | 100 | 100 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 100 | – | cannot target vehicles |
| **HollowPoint3** (IFV pistol turret) | 100 | 100 | 100 | 2 | 2 | 2 | 2 | 2 | 2 | 100 | 100 | – | |
| **HollowPointNoBuilding** (Chrono Commando) | 200 | 100 | 75 | 1 | 1 | 1 | 0 | 0 | 0 | 75 | 100 | – | |
| **ChronoBeam** (Chrono Legionnaire) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 0 | – | `Temporal=yes` (erase) |
| **Mechanical** (C4 Sapper, Repair IFV) | 0 | 0 | 0 | 100 | 100 | 100 | 0 | 0 | 0 | 100 | 100 | – | SEAL/Tanya C4 vs vehicles/ships |
| **Super** (`C4Warhead`, building C4) | 100 ×11 | | | | | | | | | | | – | instant structure kill (`C4=yes`) |
| **FakeC4WH** (Chrono Commando "C4") | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 100 | 100 | 0 | 100 | 0 | 5000 dmg weapon, not true C4 |
| **ParasiteDog** (Dog bite) | 100 | 100 | 100 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | – | Parasite (instant kill) |
| **Snapshot** (Spy disguise) | 100 | 100 | 100 | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 100 | – | MakesDisguise |
| **Controller** (mind control) | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 | 0 | 100 | 100 | – | MindControl |
| **IvanBomb** / **IvanWH** (Chrono Ivan) | –/100 | 100 | 100 | 100 | 100 | 100 | 100 | 250 | 20 | 100 | 100 | 1.5 / 0.25 | `IvanDamage=450`, `IvanTimedDelay=450` frames |
| **ARTYHE** (Destroyer 155mm, elite Hornet) | 100 | 80 | 60 | 100 | 60 | 60 | 100 | 100 | 60 | 100 | 100 | 1 / 0.25 | Wall, Wood, Rocker, Prone 50% |
| **SAMWH** (Patriot, Aegis Medusa) | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 | 0 | 100 | 100 | 0.3 / 1 | AA; 100% vs missiles |
| **ORCAAP** (Harrier/Black Eagle Maverick, Hornet) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 75 | 100 | 100 | 0.4 / 1 | Wall, Wood, Prone 50% |
| **APSplash** (Osprey depth charge) | 25 | 25 | 25 | 75 | 100 | 100 | 65 | 65 | 60 | 25 | 100 | 0.5 / 0.8 | |
| **SonicWarhead** (Dolphin) | 100 | 100 | 100 | 100 | 80 | 80 | 100 | 60 | 60 | 100 | 100 | 0.1 / 1 | Rocker, Prone 50% |
| **MaverickHE** (paradrop plane gun) | 25 | 25 | 25 | 100 | 50 | 50 | 100 | 75 | 50 | 25 | 100 | 1 / 0.5 | |
| **Fire** (Soviet flamethrower legacy) | 600 | 500 | 200 | 60 | 30 | 5 | 150 | 100 | 2 | 200 | 100 | 0.5 / 0.5 | Prone 600%, InfDeath 4 |
| **Electric** (Tesla Coil) | 100 | 100 | 100 | 85 | 100 | 100 | 50 | 50 | 50 | 200 | 100 | – | |
| **Shock** (Tesla Trooper / IFV shock) | 100 | 100 | 100 | 85 | 100 | 100 | 50 | 50 | 50 | 200 | 100 | – | |
| **FlakWH** (Flak Cannon) | 150 | 80 | 50 | 100 | 100 | 20 | 0 | 0 | 0 | 100 | 100 | 1 / 0.1 | |
| **ApocAP** (Apocalypse) | 25 | 25 | 25 | 75 | 100 | 100 | 100 | 100 | 70 | 60 | 100 | 0.3 / 0.5 | |
| **NUKE** | 100 | 100 | 100 | 200 | 100 | 100 | 60 | 100 | 8 | 100 | 100 | 10 / 0.02 | WallAbsoluteDestroyer |
| **IonWH** (Lightning Storm bolts) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 2 | 100 | 100 | 2 / 0.5 | |
| **DominatorWH** | 0 | 0 | 0 | 0 | 0 | 0 | 100 | 100 | 6 | 0 | 0 | 7 / 0.2 | |
| **PsiPulse** (Yuri IFV) / **SuperPsiPulse** | 100 | 100 | 100 | 0/50 | 0/50 | 0/50 | 0 | 0 | 0 | 0 | 0 | 3 / .85, 5 / .85 | |
| **Virus** | 100 | 100 | 100 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 100 | – | InfDeath 8 (gas cloud) |
| **RadBeamWarhead** (Desolator) | 100 | 100 | 100 | 20 | 15 | 10 | 0 | 0 | 0 | 100 | 100 | – | Radiation |
| **Crush** (`CrushWarhead`) | 100 ×11 | | | | | | | | | | | 0.5 / 1 | |
| **DummyWarhead** | 0 ×11 | | | | | | | | | | | – | Prism support beam, spy camera |

Note the design logic: anti-infantry warheads (HollowPoint family) are 1–2% vs vehicles/buildings so heroes won't waste time on them; AP is 25% vs infantry (tanks are poor at killing infantry — crush instead); Allied prism/comet weapons are 200% vs structures (siege role), while MirageWH is only 20–30% vs structures (anti-unit ambusher).

### B3. Splash, prone, death types, misc

| Mechanic | Rule |
|---|---|
| CellSpread | Blast radius in cells beyond the impact cell (0–11). An object is hit if its 3-D distance ≤ CellSpread × 256 leptons; airborne units have distance halved (hit at ~2× radius). Spread is a sphere, not a diamond. Spread does nothing for Temporal, MindControl, ElectricAssault, MakesDisguise, Parasite warheads. |
| PercentAtMax | Fraction of full damage dealt at the edge of the CellSpread radius (linear fall-off between centre and edge **(fall-off curve unverified)**). E.g. NUKE 10 cells / 2% at edge; Grand Cannon 2 cells / 20%. |
| Walls | `Wall=yes` warheads damage walls; `Wood=yes` damages wooden fences; `WallAbsoluteDestroyer=yes` (Nuke) removes them outright. Walls block `SubjectToWalls=yes` projectiles (e.g. `InvisibleLow`, `Cannon`) — so Pillboxes/GIs cannot shoot through walls, Prism/Comet (`InvisibleHigh`, `SubjectToWalls=no`) can. |
| Cliffs/elevation | `SubjectToCliffs=yes` projectiles are blocked by cliffs; `SubjectToElevation=yes` gain range firing downhill (`LeptonsPerFireIncrease=2000`). Grand Cannon/Destroyer `Ballistic` ignore cliffs. |
| Prone infantry | Infantry go prone when fired upon; damage ×`ProneDamage%` of that warhead (SA 70%, AP 50%, Fire 600%, HollowPoint 100%). Yuri's `Gas`/`PsychGas` 300% punish prone units. `Fearless=yes` units (Rocketeer) never go prone. |
| InfDeath | Death animation index per warhead: 0 none, 1 fall, 2 explode-fall, 3 explode, 4 burn, 5 electrocute, 6 head-pop (mind blast), 7 nuke melt, 8 virus gas-cloud, 9 mutate, 10 bone-crunch. |
| Rocker / Bright / Sparky | Rocker: knocks vehicles (visual tilt). Bright: light flash. Sparky: spawns fires on damaged structures. |
| Buildings vs infantry | Building armour (wood/steel/concrete) is a separate axis, so a weapon's anti-structure value is independent of its anti-unit value; `Strength` of structures (500–1500) is similar to units, so the Verses column determines siege speed. |
| Damage states | `ConditionYellow=50%`, `ConditionRed=25%` (buildings smoke/burn at these thresholds; fires `DamageFireTypes`). Low-HP buildings eject garrisons. |
| Suppression | No suppression stat; "under fire" is only prone + the `VoiceFeedback` fear lines. Infantry `SCATTER` ability (SEAL, Tanya, Dog) auto-dodges vehicles trying to crush them. |
| Mind control | `Controller` warhead: 0% vs structures (only Yuri Prime's `ControllerBuilding` controls buildings). Immune: `ImmuneToPsionics=yes` units (A9). Controlled units are freed when the controller dies. |
| Temporal (erase) | Each frame the Temporal weapon's Damage is accumulated against the target; the target is erased when the accumulated amount reaches **10 × its max Strength** (Verses ignored; current HP ignored). While being erased the target is frozen, cannot act, and cannot be damaged by non-Temporal weapons. Multiple Legionnaires pool their damage **(wiki, unverified formula)**; if firing stops, the target returns unharmed. Erased structures leave no rubble/survivors. Chrono Legionnaire Damage 8 (elite 16): a 300-HP Grizzly needs 3000 → ~375 frames (25 s) for one Legionnaire, 12.5 s for two; a 1000-HP Con Yard ~11 min solo. |
| Chrono/Iron Curtain interaction | Iron-Curtained or Force-Shielded objects nullify damage (`WeaponNullifyAnim`). Chronosphere teleport kills infantry in the area and instantly destroys units landing on invalid terrain. |
| Aircraft | `ReloadRate=.3` min per ammo point at the airfield; `FlightLevel=1500` leptons; crashed aircraft deal `DeathWeapon` damage on impact. |
| Veterancy & armour | STRONGER divides incoming damage by 1.5 (1.5² at elite if listed twice). |

---

## C. ALLIED BUILDINGS

Prereq abbreviations: POWER = any power plant; PROC = refinery; BARRACKS; RADAR = Airforce Command HQ (either variant); TECH = Battle Lab. Power: + produced / − consumed.

| Building (ID) | Cost | HP | Armour | Power | Prereqs | Function / notes | Limit |
|---|---|---|---|---|---|---|---|
| Construction Yard (GACNST) | 3000 (as MCV) | 1000 | concrete | 0 | — | Builds structures; `Adjacent=2`; capturable; can undeploy (MCVRedeploys) | — |
| Power Plant (GAPOWR) | 800 (cncnz lists 600 **(unverified RA2 1.0)**) | 750 | wood | +200 | Con Yard | Only Allied power source; spy-able (blackout) | — |
| Ore Refinery (GAREFN) | 2000 | 1000 | wood | −50 | POWER | Ore→credits, 1 dock, free Chrono Miner; spy steals cash | — |
| Barracks (GAPILE) | 500 | 500 | steel | −10 | POWER | Trains infantry; spy → veteran infantry | — |
| War Factory (GAWEAP) | 2000 | 1000 | wood | −25 | PROC, Barracks | Vehicles + Nighthawk; spy → veteran vehicles | — |
| Naval Shipyard (GAYARD) | 1000 | 1500 | concrete | −25 | PROC, POWER | Ships; repairs ships (`UnitRepair`); `Adjacent=12`; not capturable; `Powered=false` | — |
| Airforce Command HQ (GAAIRC) | 1000 | 600 | steel | −50 | Refinery | **Radar**; aircraft factory with 4 pads (`NumberOfDocks=4`) → max 4 Harriers/Black Eagles per HQ; `ForbiddenHouses=Americans` | — |
| American Airforce Command HQ (AMRADR) | 1000 | 600 | steel | −50 | Refinery | Same + `SuperWeapon=AmericanParaDropSpecial` (8 GIs / 4 min); America only | — |
| Battle Lab (GATECH) | 2000 | 500 | wood | −100 | War Factory, RADAR | Unlocks tier-3; `SuperWeapon=ForceShieldSpecial` (YR); spy → Chrono Commando (your Allied lab) | — |
| Ore Purifier (GAOREP) | 2500 | 900 | wood | −200 | TECH, PROC | +25% ore income; not capturable; needs power | 1 |
| Service Depot (GADEPT) | 800 | 1200 | wood | −25 | War Factory | Repairs vehicles (charges), removes Terror Drones; prerequisite for **MCV**; could sell vehicles in RA2 (removed YR 1.001) | — |
| Gap Generator (GAGAP) | 1000 | 600 | wood | −100 | TECH | Shrouds 10-cell radius vs enemies; not capturable | — |
| Spy Satellite Uplink (GASPYSAT) | 1500 (cncnz: 1000 **(RA2 value unverified)**) | 1000 | wood | −100 | TECH | Full map reveal + radar; capturable | — |
| Chronosphere (GACSPH) | 2500 | 750 | concrete | −200 | TECH | Chronoshift SW, 7-min timer | 1 |
| Weather Control Device (GAWEAT) | 5000 | 1000 | concrete | −200 | TECH | Lightning Storm SW, 10-min timer | 1 |
| Robot Control Center (GAROBO) (YR) | 600 (cncnz: 1000 **(unverified)**) | 600 | wood | −100 | War Factory | `PowersUnit=ROBO`: enables Robot Tanks; if destroyed/sold/unpowered all Robot Tanks shut down (sink on water); capturable | — |
| Pillbox (GAPILL) | 500 | 400 | steel | 0 | Barracks | `Vulcan2`: 50 dmg, ROF 26, range 5.5, SA warhead; works without power; `Adjacent=4`; blocked by walls | — |
| Patriot Missile (NASAM) | 1000 | 900 | steel | −50 | Barracks | `RedEye2`: 75 dmg, ROF 55, range 12, SAMWH, AA-only `AAHeatSeeker` (also shoots down V3/Dreadnought missiles); powered; `Adjacent=4` | — |
| Prism Tower (ATESLA) | 1500 | 600 | steel | −75 | POWER, RADAR | `PrismShot`: 120 dmg, ROF 45, range 8, PrismWarhead (200% vs infantry, 50% vs structures), fires over walls. Support: up to `PrismSupportMax=8` towers within 8 cells each add 120 × `PrismSupportModifier=150%` → max 120 + 8×180 = **1560**; supporting tower is offline `PrismSupportDelay=45` frames. Powered; AG only | — |
| Grand Cannon (GTGCAN) — France | 2000 | 900 | steel | −100 | RADAR | `GrandCannonWeapon`: 150 dmg, ROF 120 (8 s), **range 15, min range 3**, CellSpread 2 / 20% at edge, GrandCannonWH (100% vs all units, 50% wood/concrete); ballistic (ignores cliffs); powered; not capturable | — |
| Fortress Wall (GAWALL) | 100 | 300 | concrete | 0 | Barracks | Blocks ground units and low projectiles; `Adjacent=8`; not repairable; Prism/Grand Cannon fire over it | — |
| Force Shield (SW on Battle Lab) | free | — | — | blackout | TECH | see A10 | — |

All Allied production structures are capturable by enemy Engineers except the Shipyard; a captured Allied Barracks/War Factory lets a Soviet/Yuri player build the Allied tech tree (Dogs excepted: each side trains only its own dog type).

---

## D. ALLIED INFANTRY

Common fields: Armour / HP / Speed from `[Unit]`; weapon stats from `[Weapon]` (Damage, ROF in frames between shots, Range in cells). "Vet" lists `VeteranAbilities`; "Elite" lists `EliteAbilities` + weapon swap. Voice line categories listed by the INI's `Voice*` keys (Select, Move, Attack, Feedback = under fire/fear, SpecialAttack, Enter/Capture, Die) — the actual lines are not transcribed.

### D1. Stat table

| Unit (ID) | Cost | HP | Armour | Speed | Sight | Prereq | Weapon → Damage / ROF / Range / Warhead | Elite weapon |
|---|---|---|---|---|---|---|---|---|
| GI (E1) | 200 | 125 | none | 4 | 5 | Barracks | `M60` 15 / 20 / 4 / SA; deployed `Para` 25 / 15 / 5 / SSA; garrison `UCPara` 30 / 15 / 6 / SSAB | `M60E` 25 dmg; `ParaE` range 6; `UCElitePara` 40 dmg |
| Guardian GI (GGI) (YR) | 400 | 100 | none | 3 | 6 | Barracks | `M60` 15 / 20 / 4 / SA; deployed `MissileLauncher` 40 / 40 / 8 / GUARDWH (AA+AG, min range 1) | `M60E`; `MissileLauncherE` 50 dmg / ROF 20 |
| Engineer (ENGINEER) | 500 | 75 | none | 4 | 4 | Barracks | `DefuseKit` (BombDisarm); capture/repair by entering | — (Trainable=no) |
| Rocketeer (JUMPJET) | 600 | 125 | none | 9 (jumpjet 30) | 8 | Barracks + RADAR | `20mm` 25 / 30 / 5 / SSA (AA+AG) | `20mmE` ROF 5 (6× faster) |
| Navy SEAL (GHOST) | 1000 | 125 | flak | 5 | 8 | Barracks + RADAR | `MP5` 125 / 10 / 6 / HollowPoint; `Sapper` C4 2500 / Mechanical (vehicles/ships) + building C4 (`C4=yes`, `Super`) | `MP5E` (same stats) |
| Spy (SPY) | 1000 | 100 | flak | 4 | 9 | Barracks + TECH | `MakeupKit` disguise (Snapshot); `Infiltrate=yes` | — |
| Tanya (TANY) | 1500 (RA2: 1000) | 200 (RA2: 125 **(unverified)**) | flak | 6 | 8 | Barracks + TECH | `DoublePistols` 125 / 5 / 6 / HollowPoint2; `Sapper` C4 2500 (YR: also vehicles) + building C4 | `DoublePistolsE` ROF 10, range 8 |
| Chrono Legionnaire (CLEG) | 1500 | 125 | none | 5 (teleport) | 8 | Barracks + TECH | `NeutronRifle` 8 / 120 / 5 / ChronoBeam (Temporal) | `NeutronRifleE` 16 dmg |
| Sniper (SNIPE) — Britain | 600 | 125 | none | 4 | 8 | Barracks + RADAR | `AWP` 125 / 150 / 14 / HollowPoint, `RevealOnFire=no` | `AWPE` ROF 60 |
| Chrono Commando (CCOMAND) | 2000 | 100 | none | 5 (teleport) | 8 | Barracks + Spy in Allied Battle Lab | `ChronoMP5` 125 / 10 / 6 / HollowPointNoBuilding; `FakeC4` 5000 / 10 / 1.5 / FakeC4WH (buildings) | `ChronoMP5E` (same) |
| Attack Dog (ADOG) | 200 | 100 | none | 8 | 9 | Barracks | `GoodTeeth` 30 / 30 / 1.5 / ParasiteDog (instant kill, dog becomes projectile) | — (Trainable=no) |
| Psi Commando (PTROOP) | 1000 | 100 | none | 5 | 8 | Barracks + Spy in Soviet (RA2) / Yuri (YR) Battle Lab | `MindControl` range 7, ROF 200 / Controller; building C4 (`C4=yes`) | `MindControlE` range 14 |
| Chrono Ivan (CIVAN) | 1750 | 100 | none | 6 (teleport) | 8 | Barracks + Spy in Allied (RA2, with Soviet barracks) / Soviet (YR) Battle Lab | `IvanBomber` 400 / 50 / 1.5 / IvanBomb (timed 450 frames, 450 dmg) | — |

### D2. Abilities, veterancy, counters, voice

| Unit | Abilities & rules | Vet / Elite | Counters | Voice personality & categories |
|---|---|---|---|---|
| **GI** | `Deployer=yes, DeployFire=yes`: deploys sandbags (cannot move; more damage/range; still crushable). Only Allied infantry able to garrison (`Occupier=yes`). IFV mode 2 (machine gun). Paratrooper unit for America/Airport. Spawns as crew/survivor. | Vet: STRONGER, FIREPOWER, ROF, SIGHT, FASTER. Elite: SELF_HEAL + M60E/ParaE (25 dmg). Elite deployed GI outranges Sentry Gun. | Dogs, Desolator, Virus, Snipers, crushing (deployed GIs still crushable), Tesla Troopers; garrisons cleared by Prism/artillery | Eager, earnest, slightly green young American soldier; obedient "yes sir" energy. Lines: select, move, attack, under-fire, deploy (reuses move), death. |
| **Guardian GI** (YR) | Deploys to anti-tank/AA missile launcher; **uncrushable when deployed**; cannot garrison; IFV mode 16 (dual missiles); excellent Battle Fortress passenger (fires on move). | Same list as GI; elite missile 50 dmg / ROF 20. | Anti-infantry (Virus, Deso, Snipers, Gattling), Rocketeers (deployed launcher is AA though), mind control | Gruff, confident hardened sergeant; cocky toward tanks. Lines: select, move, attack, under-fire, death. |
| **Engineer** | Instant capture; repair own building (consumed); repair bridge; defuse Ivan bombs; IFV mode 1 → Repair IFV (−50 HP per 80 frames, range 1.8, vehicles only, removes drones). `IsSelectableCombatant=no`. Capture Tech buildings. | None (Trainable=no) | Any weapon; dogs; garrison fire | Brisk, polite, technical professional. Lines: select, move, capture/enter (special), under-fire, death. |
| **Rocketeer** | Flying infantry (`JumpJet`, `ConsideredAircraft`, `BalloonHover`), `Fearless`; AA+AG; cannot enter IFV/transports; immune to ground-only weapons, mind control (airborne), crush; detected by nothing special. Good vs Kirovs, harvesters, garrisons. | Vet: STRONGER, FIREPOWER, ROF, SIGHT, FASTER. Elite: SELF_HEAL + `20mmE` (ROF 5 — massive DPS). | Flak Track/Cannon, Flak Troopers, IFVs, Patriots, Aegis, Gattling, Guardian GIs | Brash Southern-accented hotshot flyboy, cocky and upbeat. Lines: select, move, attack, under-fire (fear). No death sound key. |
| **Navy SEAL** | Amphibious; MP5 one-bursts infantry; C4 on buildings (instant kill) and ships/vehicles (`Sapper`, Mechanical 2500); IFV mode 4 (pistol). Campaign-only in RA2; buildable in YR skirmish. `SCATTER` ability. | Vet: +SCATTER, FASTER; Elite: SELF_HEAL, FASTER (again) + MP5E. | Vehicles (1% damage), aircraft, dogs lose to him but Desolator/Virus/Sniper/Yuri clones outrange, Tesla Coils (survives one bolt) | Cocky action-movie bravado, swaggering special-forces quips. Lines: created, select, move, attack, plant C4 (special), death. |
| **Spy** | `Agent=yes, Infiltrate=yes`: left-click an enemy infantry to copy its appearance (`MakeupKit`, range −2 = adjacent **(unverified)**). Infiltration: Power Plant → 1000-frame blackout; Refinery → steal 50% cash (wiki: 20%); Barracks → veteran infantry; War Factory → veteran vehicles; Radar/AFHQ → reset enemy shroud; Superweapon → reset timer; Battle Lab → stolen-tech unit (Allied lab: Chrono Commando; Soviet: Chrono Ivan; Yuri: Psi Commando); cannot enter Con Yard. Detected only by Attack Dogs (`DetectDisguise=yes`), Psi Commando, Yuri psychics; enemy defences ignore him. IFV mode 2. | None (Trainable=no) | Dogs (one bite), Yuri clones/towers, manual targeting, Terror Drones | Suave, dry British-accented gentleman spy (secret-agent parody). Lines: select, move, disguise (special), under-fire, death. |
| **Tanya** | Amphibious hero; pistols one-shot infantry (HollowPoint2 0% vs vehicles → cannot target them with guns); C4 kills buildings and (YR) vehicles/ships; `Crushable=no` (YR; only Battle Fortress crushes her); `ImmuneToPsionics=yes` (YR); `BuildLimit=1` (YR; 2 with Cloning Vats); IFV mode 4. `SCATTER`. | Vet: STRONGER, FIREPOWER, ROF, SIGHT, SCATTER. Elite: SELF_HEAL + `DoublePistolsE` (ROF 10, range 8). | Vehicles (Terror Drones, tanks crushing in RA2), aircraft, Prism Towers, Snipers, Desolators, garrisons, Virus; RA2: mind control | Sassy, cocky, taunting American action heroine. Lines: select, move, attack, under-fire, plus scripted campaign lines; death. |
| **Chrono Legionnaire** | `Teleporter=yes`: moves by teleport, defenceless while phasing in (delay ∝ distance, ≥16 frames). Erases single targets (Temporal; target invulnerable & frozen while being erased; no rubble). `Crushable=no`. IFV mode 10 (Chrono IFV: 5 dmg, range 6, no phase delay — IFV drives). Via Chronosphere teleport he survives (`Teleporter`). | Vet: STRONGER, FIREPOWER, ROF, SIGHT, FASTER. Elite: SELF_HEAL + `NeutronRifleE` 16 dmg (erases 2× faster). | Massed cheap infantry/dogs, snipers, anything that hits him during phase-in; kill him to release target | Calm, detached, cerebral scientist-soldier with phased/echoing delivery and time jokes. Lines: select, move, attack, under-fire, death. |
| **Sniper** (Britain) | Range 14 one-shot kills on infantry; doesn't reveal himself on firing (`RevealOnFire=no`); IFV mode 5 → Sniper IFV uses elite `AWPE` (ROF 60) immediately. Cannot hurt vehicles/buildings (1%). | Vet: STRONGER, FIREPOWER, SIGHT, FASTER (no ROF). Elite: SELF_HEAL, ROF + `AWPE` (ROF 60). | Vehicles, dogs/Terror Drones rushing him, aircraft, Prism Towers, Yuri mind control (range 7 < 14 though) | Clipped, cold, upper-class British professional marksman. Lines: select, move, attack, under-fire, death. |
| **Chrono Commando** | Stolen-tech: teleports like Legionnaire, fires SEAL MP5 variant (`HollowPointNoBuilding`: 0% vs buildings), "C4" is actually a 5000-dmg `FakeC4` weapon (buildings only; leaves survivors, can't blow bridges). Cannot swim. `Crushable=no`. IFV mode 4. | Vet/Elite as GI list; elite MP5 same stats. | Aircraft, mind control, dogs, anything during phase-in | Shares the SEAL's cocky commando voice (own `ChronoCommando*` voice keys, one unique "created" line). Lines: created, select, move, attack, special (C4), death (SealDie). |
| **Attack Dog** (German Shepherd) | `NotHuman`, `Natural`, `DetectDisguise=yes` (reveals Spies and Mirage-disguises), instant-kill lunge (becomes projectile — immune to nuke/rad while mid-leap), `ImmuneToPsionics=yes`, fast scout. Only Allies can train ADOG. IFV mode 0 (no weapon change). | Vet: STRONGER, FIREPOWER, ROF, SIGHT, FASTER, SCATTER. Elite: SELF_HEAL… (Trainable=no → crates/spy only). | Tanya/SEAL/Boris one-shot it; massed infantry; vehicles (can't hurt them); Brutes; garrison fire | Barks, growls, whimpers (no speech). Sound cues: select, move, attack, fear, death. |
| **Psi Commando** | Stolen-tech: Yuri-style mind control (range 7, elite 14; one unit at a time per shot, `FireOnce`), building C4 (`C4=yes`), `DetectDisguise=yes`, `ImmuneToPsionics=yes`, `Crushable=no`, cannot swim, IFV mode 4 (pistol). | Vet list as GI; elite `MindControlE` range 14. | Dogs, Robot Tanks/miners (immune), snipers, aircraft, massed cheap units | Uses the Yuri Clone voice set: sinister, whispery, hypnotic. Lines: select, move, attack, death. |
| **Chrono Ivan** | Stolen-tech: teleports; plants timed TNT (450 frames) on anything incl. own units (`AttackCursorOnFriendlies`); IFV mode 7 → suicide IFV (`CRNuke` 200 dmg, CRNUKEWH CellSpread 5). Defusable by Engineers. `Crushable=no`. | Vet list as GI (Trainable=no in INI → promotable only via crates/spy). | Engineers (defuse), dogs, aircraft, phase-in window | Uses Crazy Ivan voice: manic, Russian-accented demolitions enthusiast. Lines: select, move, attack, under-fire, death. |

YR changes summary (infantry): Guardian GI added; SEAL made buildable in multiplayer; Tanya buffed (HP 200, cost 1500, build limit 1, psionic immunity, uncrushable, vehicle C4, faster elite pistols); Chrono Legionnaire patch 1.001 stops garrison/engineer/C4 actions on a building under chrono attack; stolen-tech prerequisites simplified to lab type only.

---

## E. ALLIED VEHICLES

| Unit (ID) | Cost | HP | Armour | Speed | Sight | Prereq | Weapon → Dmg / ROF / Range / Warhead | Elite | Vet / Elite abilities |
|---|---|---|---|---|---|---|---|---|---|
| Grizzly Battle Tank (MTNK) | 700 | 300 | heavy | 7 | 8 | War Factory | `105mm` 65 / 60 / 5 / AP; `Crusher`, turret, `OpportunityFire` | `105mmE`: Burst 2, ROF 50, warhead GRIZAPE (100% vs infantry) | STRONGER, FIREPOWER, SIGHT, FASTER / SELF_HEAL, STRONGER, FIREPOWER, ROF |
| IFV (FV) | 600 | 200 | light | 10 | 8 | War Factory | `HoverMissile` 25 ×2 burst / 50 / 6 / HE, AA+AG, min range 1; 1 passenger (`Gunner=yes`) swaps weapon (table E1); not a crusher; `DeathWeapon=CRNuke` fires only in Ivan mode | `HoverMissileE` 80 ×4 burst | same |
| Mirage Tank (MGTK) | 1000 | 200 | light | 7 | 9 | War Factory + TECH | `MirageGun` 100 / 70 / 7 / MirageWH, `RevealOnFire=no`; disguises as `DefaultMirageDisguises=TREE01–04` when stationary; blinks visible briefly when firing (AI detection chance `DisabledDisguiseDetectionPercent=15,5,2` per unit by difficulty); Dogs/Psi units see through; force-fire (Ctrl) to attack it; no turret; crusher | `MirageGunE` 150 / 80 / **9** | same |
| Prism Tank (SREF) | 1200 | 150 | light | 4 | 8 | War Factory + TECH | `Comet` 100 / 100 / **10** / CometWH (200% vs structures, 50% vs med/heavy), laser, `InvisibleHigh` (fires over walls/cliffs ignore? `SubjectToCliffs=yes`); projectile `LargeCometP` spawns **5** `CometFragment` refraction beams (30 dmg, range 3, CometWH) at nearby enemies; `Weight=3.5`; crusher | `SuperComet` 150 / 100 / 10 → 5 `SuperCometFragment` (50 dmg, range 5) each spawning 3 `CometFragment` (30 dmg) | same |
| Chrono Miner (CMIN) | 1400 | 1000 | medium | 4 | 4 | War Factory + PROC | none; `Harvester=yes`, `Storage=20`, `Teleporter=yes` (teleports home when full or on manual order; drives out), `ImmuneToPsionics`, `ImmuneToRadiation`, crusher, `Bunkerable=no` | — | none (Trainable=no) |
| Robot Tank (ROBO) (YR) | 600 | 180 | heavy | 10 | 6 | War Factory + Robot Control Center | `Robogun` 65 / 60 / 5 / AP (same gun as Grizzly, faster shell); hover (crosses water); `ImmuneToPsionics`, `ImmuneToRadiation`; shuts down (and sinks on water) if Control Center lost/unpowered; crusher | — | listed but `Trainable=no` → cannot be promoted |
| Battle Fortress (BFRT) (YR) | 2000 | 600 | heavy | 4 | 6 | War Factory + TECH | `20mmRapid` 30 / 20 / 5.5 / HARVWH; `OpenTopped=yes`, 5 infantry passengers fire from inside with +2 range, ×1.2 damage; `OmniCrusher` crushes vehicles, walls and uncrushable infantry; `Weight=3.5`, `Size=6` | — | same as Grizzly |
| Tank Destroyer (TNKD) — Germany | 900 | 400 | heavy | 5 | 8 | War Factory + RADAR | `SABOT` 150 / 70 / 5 / UltraAP (100% light & heavy, 40% medium, 2% everything else); no turret; crusher | `SABOTE` 175 ×2 burst / 60 / 6.75 / UltraAPE | same |
| Nighthawk Transport (SHAD) | 1000 | 175 | light | 14 (jumpjet 30) | 7 | War Factory | `BlackHawkCannon` 35 / 40 / 6 / SA, `OmniFire`; 5 infantry (`SizeLimit=2`); `RadarInvisible=yes` (never shown on enemy minimap); `Landable`; `CanPassiveAquire=no`; built at War Factory | `BlackHawkCannonE` 40 / SSA | same |
| Amphibious Transport (LCRF) | 900 | 300 | light | 6 | 6 | Shipyard | unarmed hovercraft; 12 slots, `SizeLimit=6` (vehicles up to MCV); `Naval=yes`, `SpeedType=Hover`; not a crusher | — | none (Trainable=no) |
| MCV (AMCV) | 3000 | 1000 | heavy | 4 | 6 | War Factory + Service Depot | unarmed; deploys to Con Yard; crusher; `Size=6` | — | none |
| Howitzer (HOWI) | 750 | 200 | light | 5 | 8 | TechLevel −1 (unbuildable, cut) | `HowitzerGun` 75 / 100 / 12 / HowitzerWH | — | legacy entry |

### E1. IFV passenger weapon table (`[FV] WeaponCount=17`)

IFV mode comes from the passenger's `IFVMode=` (gunner slot). Modes 0–12 exist in RA2; 13–16 added in YR.

| Mode | Turret | Passenger types (IFVMode) | Weapon | Dmg / ROF / Range | Warhead | Notes |
|---|---|---|---|---|---|---|
| 0 | Normal (rocket) | empty; Rocketeer (can't enter anyway), Attack Dogs, Brute, Slave, civilians (default 0) | `HoverMissile` (elite `HoverMissileE`) | 25×2 / 50 / 6 (elite 80×4) | HE | AA + AG; min range 1 |
| 1 | Repair | Engineer (all three factions') | `RepairBullet` | −50 / 80 / 1.8 | Mechanical | heals vehicles/ships only; removes Terror Drones |
| 2 | MachineGun | GI, Conscript, Spy | `CRM60` | 25 / 15 / 6 | SSA | anti-infantry |
| 3 | Flak | Flak Trooper | `CRFlakGuyGun` | 30 / 15 / 7 | FlakTWH | AA + AG flak |
| 4 | Pistol | Navy SEAL, Tanya, Chrono Commando, Psi Commando, Boris, Flint/Arnie/Sammy (campaign) | `CRMP5` | 125 / 10 / 7 | HollowPoint3 | one-shots infantry |
| 5 | Sniper | Sniper | `AWPE` | 125 / 60 / 14 | HollowPoint | elite rifle immediately |
| 6 | Shock | Tesla Trooper | `CRElectricBolt` | 60 / 45 / 6 | Shock | electric bolt |
| 7 | Explode | Crazy Ivan, Chrono Ivan | `CRNuke` | 200 / 80 / 1 | CRNUKEWH (CellSpread 5) | `Suicide=yes` — IFV detonates |
| 8 | BrainBlast | Yuri Clone | `CRMindControl` | 200 / 10 / 1 | PsiPulse (CellSpread 3) | area psychic blast, infantry only |
| 9 | RadCannon | Desolator | `CRRadBeamWeapon` | 175 / 30 / 7 | RadBeamWarhead | rad beam |
| 10 | Chrono | Chrono Legionnaire | `CRNeutronRifle` | 5 / 120 / 6 | ChronoBeam (Temporal) | erases without phase delay |
| 11 | TerroristExplode | Terrorist | `CRTerrorBomb` | 250 / 10 / 1.5 | TerrorBombWH (CellSpread 2) | suicide |
| 12 | Cow | Cow, Alligator, Polar Bear, Monkey, Camel, President (Easter egg) | `CowShot` | 300 / 75 / 12 | PrismWarhead | prism laser |
| 13 | Initiate (YR) | Yuri Initiate | `CRPsychicJab` | 25 / 15 / 6.5 | SAFlame | pyrokinetic |
| 14 | Virus (YR) | Virus | `CRVirusGun` | 125 / 80 / 12 | Virus | toxic sniper |
| 15 | YuriPrime (YR) | Yuri Prime | `CRSuperMindBlast` | 250 / 50 / 1 | SuperPsiPulse (CellSpread 5) | `FireOnce` |
| 16 | Guardian (YR) | Guardian GI | `CRMissileLauncher` | 30×2 / 40 / 8 | GUARDWH | AA + AG anti-tank missiles |

Passengers inside an IFV earn no veterancy; the IFV itself does. Elite weapon slots (`EliteWeaponX`) are identical to normal except mode 0.

### E2. Vehicle notes, counters, voices

| Unit | Role & counters | Voice |
|---|---|---|
| Grizzly | Cheap, fast MBT; loses 1v1 to Rhino (400 HP, 90 dmg) but out-trades per cost with micro; AP is 25% vs infantry → crush instead. Countered by Rhinos/Apocalypse, Tank Destroyers, Tesla, Terror Drones, Kirovs/aircraft (no AA). | Generic Allied vehicle crew (`GenAllVehicle*`): brisk, disciplined, professional American tanker. Select / move / attack / death. |
| IFV | Fast multi-role: default mobile AA (4–5 kill a Kirov), Repair IFV, Sniper/Tanya/Chrono IFVs. Light armour; countered by tanks, Tesla, Gattling, mind control (passenger lost too). | Upbeat, eager driver with "ready to roll" energy. Select / move / attack / death. |
| Mirage Tank | Ambusher: hidden as a tree when still; one-shots infantry, 3–5 shots per tank; weak vs structures (20–30%). Countered by force-fire, dogs/psychics (detect), Terror Drones, artillery, mind control, tanks once revealed. | Sly, playful, whispered sneakiness. Select / move / attack / death. |
| Prism Tank | Long-range siege (range 10) and anti-infantry with refraction; 150 HP light armour; slow. Pair with Grizzlies/Mirages; mass 6–12; Chronosphere drop of 9. Countered by tanks (50% dmg from Comet), Tank Destroyers, Terror Drones, aircraft, Magnetron, mind control. | Enthusiastic, nerdy optics-engineer jargon. Select / move / attack / death. |
| Chrono Miner | Half the War Miner's load but teleports home (two field trips per War Miner trip); emergency chrono escape; immune to mind control/radiation; Terror Drones left behind on teleport. | Cheerful, eager dutiful worker. Select / move / harvest(attack key) / return (enter) / death. |
| Robot Tank | Mind-control-proof, hover, fast; Yuri counter; only 180 HP. Countered by killing/unpowering the Control Center, aircraft, infantry swarms. | Electronic beeps only. |
| Battle Fortress | Heaviest Allied armour; mobile bunker + vehicle crusher; best loads: 5 Guardian GIs (AT/AA), Chrono Legionnaires, Snipers, Tanya/SEALs. Countered by mind control (Masterminds), Magnetron, Siege Choppers, massed tanks/TDs, Terror Drones. | Gruff Scottish-accented heavy-vehicle commander. Select / move / attack / death. |
| Tank Destroyer | Pure anti-armour (150 → 100% vs heavy); 2% vs infantry/buildings; 400 HP. Counter to Rhino rushes and Prism columns; countered by infantry, aircraft, Tesla Troopers. | German-accented crew, stern. Select / move / attack / death. |
| Nighthawk | Radar-invisible 5-slot helicopter transport with light cannon; Tanya/Engineer insertions. Countered by any AA (Flak, Gattling, Patriots, Rocketeers). | Cool, clipped black-ops pilot. Select / move / attack. |
| Amphibious Transport | Only Allied way to move tanks over water (12 slots); unarmed; weaker than Soviet equivalent. | Generic Allied hovercraft crew. Select / move. |
| MCV | 3000-credit base-in-a-box; 1000 HP heavy; needs Service Depot to build. | Generic Allied MCV crew. Select / move. |

---

## F. ALLIED AIRCRAFT

| Unit (ID) | Cost | HP | Armour | Speed | Sight | Prereq | Ammo / reload | Weapon → Dmg / ROF / Range / Warhead | Elite | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Harrier "Intruder" (ORCA) | 1200 | 150 | light | 14 | 8 | Airforce Command HQ (RADAR); `ForbiddenHouses=Alliance` (Korea) | `Ammo=1` → one Maverick per sortie (older guides claim 2 **(RA2 1.0 unverified)**); rearm `ReloadRate=.3` min/point on a pad; `Dock=GAAIRC,AMRADR`, `AirportBound` (4 per HQ) | `Maverick` 150 / 10 / 6 / ORCAAP | `MaverickE` 300 dmg, range 9 | `Fighter=yes`, `CanPassiveAquire=no`, `CanRetaliate=no`, `ImmuneToPsionics`; Vet: STRONGER, FIREPOWER, SIGHT, FASTER; Elite: STRONGER, FIREPOWER, ROF (no self-heal; repairs on pad). Aircraft with no HQ to land at circle until crash. |
| Black Eagle (BEAG) — Korea | 1200 | 200 | light | 14 | 8 | Airforce Command HQ; `RequiredHouses=Alliance` | `Ammo=1`, same rearm | `Maverick2` 200 / 10 / 6 / ORCAAP | `Maverick2E` 400 dmg, range 9 | Straight upgrade: +50 HP, +33% damage. |
| Nighthawk Transport (SHAD) | 1000 | 175 | light | 14 | 7 | War Factory | n/a (gun, no ammo) | `BlackHawkCannon` 35 / 40 / 6 / SA (OmniFire) | 40 dmg SSA | see E |
| Rocketeer (JUMPJET) | 600 | 125 | none | 9 (`JumpjetSpeed=30`, `JumpjetHeight=500`) | 8 | Barracks + RADAR | n/a | `20mm` 25 / 30 / 5 / SSA (AA+AG) | ROF 5 | Infantry that flies; `ConsideredAircraft=yes` so Flak/SAM hit it; cannot land in transports; `BalloonHover`. |
| Hornet (HORNET) | 50 (free, spawned) | 75 | light | 12 | 2 | Aircraft Carrier (`Spawns=HORNET`, 3) | `Ammo=1` | `HornetBomb` 40 / 3 / 5 / ORCAAP (bomb) | `HornetBombE` 80 / ARTYHE | Vet/Elite: STRONGER, FIREPOWER; regenerate at carrier (`SpawnRegenRate=600`, `SpawnReloadRate=150`). |
| Osprey (ASW) | 50 (free, spawned) | 30 | light | 12 | 2 | Destroyer (`Spawns=ASW`, 1) | `Ammo=1` | `ASWBomb` 50 / 3 / 3 / APSplash (depth charge) | — | `NavalTargeting=2` (sub-hunting), `LandTargeting=1`; regen 400 frames. |
| Cargo plane (PDPLANE) | — | 400 | light | 15 | 0 | paradrop SW | `Ammo=100` | `ParaDropWeapon` | — | Drops paratroopers within `ParadropRadius=1024`; can be shot down. |

Voice: Harrier pilot — calm, cool professional callsign chatter (select / move / attack). Black Eagle — Korean-accented pilot, formal and proud (select / move / attack). Hornets/Ospreys — no voice.

---

## G. ALLIED NAVAL

| Unit (ID) | Cost | HP | Armour | Speed | Sight | Prereq | Weapon → Dmg / ROF / Range / Warhead | Elite | Targeting / notes |
|---|---|---|---|---|---|---|---|---|---|
| Destroyer (DEST) | 1000 | 600 | heavy | 6 | 7 | Shipyard | `155mm` 60 / 110 / 8 / ARTYHE (ballistic, shore bombardment); `ASWLauncher` spawns 1 Osprey (`SpawnsNumber=1`, regen 400) | `155mmE` Burst 2 | `NavalTargeting=1` (ships & shore), `Sensors=yes, SensorsSight=8` (detects subs/Dolphins/Squids); `Weight=3` (sinks). Vet: STRONGER, FIREPOWER, ROF, SIGHT, FASTER. |
| Aegis Cruiser (AEGIS) | 1200 | 800 | light | 4 | 8 | Shipyard + RADAR | `Medusa` 100 / 15 / 12 / SAMWH, AA-only `MedusaProjectile`, `DistributedFire`, `OmniFire` | `MedusaE` 100 ×2 / ROF 5 / range 14 | `NavalTargeting=6, LandTargeting=1` → AA only (shoots down aircraft, Rocketeers, V3/Dreadnought missiles); ROT 1 (slow turning). |
| Aircraft Carrier (CARRIER) | 2000 | 800 | heavy | 4 | 7 | Shipyard + TECH | `HornetLauncher` range **25** spawner; 3 Hornets (40 dmg bombs; elite 80 ARTYHE); `SpawnRegenRate=600` (new Hornet 40 s), `SpawnReloadRate=150` | Hornets inherit carrier rank | `CanPassiveAquire=no` (must be ordered); `Weight=5`; Hornets killed by AA; vulnerable to Giant Squid/Dreadnoughts/subs — escort with Destroyers/Dolphins. |
| Dolphin (DLPH) | 500 | 200 | light | 8 | 4 | Shipyard + TECH | `SonicZap` 4 (+`AmbientDamage=10`) / 120 / 6 / SonicWarhead, `IsSonic` (beam hits everything along path), `DecloakToFire=no` | `SonicZapE` 8 (+15) ×2 / 80 | `Underwater=yes`, `Cloakable=yes` (submerged, radar-invisible until attacking), `Sensors` 8 (anti-sub), `NavalTargeting=5` (sub/ship), `LandTargeting=1`; forces Giant Squids off ships (Ctrl force-fire); `Accelerates`. Voice: dolphin chirps/squeaks (select/move/attack/fear/death). |
| Amphibious Transport (LCRF) | 900 | 300 | light | 6 | 6 | Shipyard | unarmed | — | 12 slots (SizeLimit 6); hover (land + water). |

Shipyard (`GAYARD`) repairs docked ships; `AINavalYardAdjacency=20`. Voices: Destroyer — generic Allied naval crew (`GenAllWater*`), crisp "aye-aye" navy formality; Aegis — missile-officer jargon, measured; Carrier — veteran carrier commander. Categories: select / move / attack; no death sounds (ships sink).

---

## H. COUNTRY SPECIALS

| Country (`[Country]`) | Special | Full stats | Assessment |
|---|---|---|---|
| **America** (Americans) | **Airborne / Paratroopers**: `AmericanParaDropSpecial` on the American Airforce Command HQ (`AMRADR` replaces `GAAIRC`) | 8 GIs (`AmerParaDropNum=8, AmerParaDropInf=E1`) dropped anywhere on the explored map by a `PDPLANE` cargo plane (400 HP, shoot-downable), `RechargeTime=4` min, no power needed, no timer shown; a captured Tech Airport adds a second, separate 6-GI drop | Free $1600 of infantry every 4 min; fuels garrison play, harassment, engineer-escort drops; GIs land undeployed (deploy immediately). Strategy guides rate it very highly. |
| **Korea** (Alliance, "Asian Alliance") | **Black Eagle** replaces Harrier | 1200 credits, 200 HP (vs 150), light, speed 14, `Maverick2` 200 dmg (vs 150), elite 400 dmg / range 9, Ammo 1, ORCAAP warhead (100% vs most, 75% vs concrete); needs Airforce Command HQ pad (4 per HQ) | Strongest raiding jet; 8+ one-shot Power Plants/Refineries' key targets; still dies to Flak/Gattling/Patriots; Desolators kill parked jets. |
| **France** (French) | **Grand Cannon** (`GTGCAN`) | 2000 credits, 900 HP, steel, −100 power, prereq Airforce HQ; `GrandCannonWeapon` 150 dmg, ROF 120 (8 s), range 15, min range 3, CellSpread 2 / 20% edge, GrandCannonWH 100% vs all units, 50% vs wood/concrete, 100% vs steel; `Turret=yes`; `Powered=yes`; `BaseNormal=no`; not capturable | Longest-ranged defence in the game, though still outranged by the V3 (`V3Launcher Range=18`); best in pairs covering each other with Patriot/IFV AA; dead weight in low power; blind spot inside 3 cells. |
| **Germany** (Germans) | **Tank Destroyer** (`TNKD`) | 900 credits, 400 HP, heavy, speed 5, sight 8, prereq War Factory + Airforce HQ; `SABOT` 150 / 70 / 5 / UltraAP (100% light & heavy, 40% medium, 2% infantry/structures); elite `SABOTE` 175 ×2 / 60 / 6.75 (UltraAPE 50% medium, 100% special_1 → kills Terror Drones) | Kills Rhinos in 3 shots, Grizzlies in 2; useless vs infantry/buildings; strong defensive answer to tank rushes and Prism columns; pair with Grizzlies/Mirages. |
| **Great Britain** (British) | **Sniper** (`SNIPE`) | 600 credits, 125 HP, none, speed 4, sight 8, prereq Barracks + Airforce HQ; `AWP` 125 / 150 / 14 / HollowPoint, `RevealOnFire=no`; elite `AWPE` ROF 60; IFV mode 5 → Sniper IFV (speed 10, 200 HP, elite rifle) | Outranges every infantry and most defences (Prism Tower 8, Tesla 8); one-shots any infantry incl. Yuri clones; weak alone (slow, fragile, 1% vs vehicles) — Sniper IFV is the standard use. |

All five Allied countries share the rest of the tree (`Owner=British,French,Germans,Americans,Alliance`). The Harrier is forbidden to Korea; the standard Airforce HQ is forbidden to America (they get `AMRADR`).

---

## I. ALLIED FACTION FLAVOUR

**Visual identity.** Clean, high-tech NATO/Western aesthetic: white and light-grey concrete and glass, blue trim and blue-tinted glass, satellite dishes, radomes, chain-link and steel. Structures are low, modern and modular (airport-style Airforce HQ with four pads, glass-domed Battle Lab, mirrored Chronosphere ring, the Weather Controller's spire). Vehicles are desert-tan/olive with blue accents on the voxels; prism and chrono weapons glow in the player's house colour (`IsHouseColor=true` lasers). Default campaign Allied colour is **blue** (vs Soviet red, Yuri purple); in multiplayer any house colour is selectable. Infantry are American-styled modern soldiers (GI helmet + body armour); heroes (Tanya) are deliberately 1980s–90s action-movie pulp.

**Music.** Frank Klepacki's RA2/YR soundtrack is shared across factions, but the Allied campaign leans on the brighter industrial-rock/techno tracks ("Hell March 2" (shared), "Grinder", "Industrofunk", "Blow It Up", "Destroy", "Fortification", "Jank", "Brain Freeze"/"Drok" in YR), while Soviet missions favour the heavier march/choral pieces. Menu/briefing music is orchestral-electronic. (Track-to-faction assignment is thematic rather than enforced by the game **(unverified)**.)

**Doctrine.** Allies are the **tech, mobility and precision** faction: faster, cheaper, more fragile units; strongest air force (Harrier/Black Eagle, Rocketeers, Nighthawk), the only radar-invisible transport, the only mind-control-proof mainline tank (Robot Tank), information warfare (Spy, SpySat, Gap Generator), and area/positional superweapons (Chronosphere relocates armies; Weather Storm wipes a base sector). Economy is equal in throughput (Chrono Miner = half load, double trips) but more vulnerable (lighter miner) and gets a late +25% Purifier. Weaknesses: thin armour across the board (Grizzly 300 vs Rhino 400; Prism 150 HP), no early anti-garrison artillery, Power Plants that are expensive and fragile (750 HP wood), defences that need power (Patriot, Prism) and a weaker direct tank-vs-tank game; the Chrono Legionnaire and Mirage are strong but micro-intensive.

**Key counters (Allied perspective).** Rhino/Apocalypse rush → Grizzly numbers + Tank Destroyers (Germany), Prism Towers, deployed GIs/Guardian GIs, Chrono Legionnaires on Apocalypses. Kirov → IFVs (4–5), Rocketeers, Patriots, Aegis on coasts, Guardian GI Battle Fortress. Terror Drones → Repair IFV, Chrono Miner teleport, Prism/tower fire. Yuri mind control → Robot Tanks, Chrono Miners, Tanya (YR), Snipers on Yuri clones, Rocketeers (airborne), Attack Dogs. Garrisons → Prism Tanks/Towers, Rocketeers, Harriers. Infantry floods → Mirage Tanks, GIs deployed, Snipers, Prism refraction, Dogs. Spies → Dogs at Refinery/War Factory/Battle Lab. Navy → Dolphins vs Squids/subs, Aegis vs Dreadnought missiles/aircraft, Destroyer Ospreys vs subs.

**Common competitive openings (community guides).** (1) **Standard**: Power → Refinery → Barracks (dog scout + GI) → Refinery → War Factory → Grizzlies/IFVs; Airforce HQ for radar; second War Factory before Battle Lab (0.8× build time). (2) **Rocketeer rush**: 8–10 Rocketeers hit Tesla Reactor first, then War Factory/Barracks; retreat when Flak appears. (3) **Grizzly rush**: 10–12 Grizzlies on miners/War Factory, kiting deployed GIs. (4) **Engineer/IFV or Nighthawk-Tanya/Engineer drops** under Gap cover. (5) **Mirage/Prism late game**: 2 Prism + Mirages + Grizzly screen; 9 Prisms Chronosphered onto a Con Yard; Sniper IFVs vs infantry-heavy Soviets. (6) **Spy play**: Refinery (cash), War Factory (veteran tanks), enemy Battle Lab (Chrono Commando). (7) **America paradrop garrison** on urban maps. Harrier strikes (8+ for structures, 12–15 for superweapons) and Black Eagle refinery sniping are the Korean variants.

---

## J. UI / HUD

| Element | Description |
|---|---|
| **Sidebar (right)** | Fixed right-hand column. Top: **radar minimap** (black "no radar" screen until a `Radar=yes` building is powered; shows terrain, units in house colour, shroud, radar events as expanding rings/flashes, superweapon targets). Above/beside radar: **credits counter** (ticks up/down with `CreditTicks` sounds) and the vertical **power meter** (bar on the sidebar edge: green when surplus, yellow near limit, red/flashing when `Power < Drain` — low power). Below radar: command buttons — **Repair** (wrench cursor, toggle), **Sell** ($ cursor), and in YR a **waypoint/planning**-mode toggle and sidebar options **(exact button set per version unverified)**. |
| **Build tabs** | Four cameo tabs: **Structures**, **Defences/Armory** (defences, walls, and the superweapon/support-power cameos — Chronoshift, Lightning Storm, Force Shield, Paradrop appear here when charged; cameos show a countdown clock) **(superweapon tab placement unverified)**, **Infantry**, **Vehicles** (ground vehicles, aircraft and ships together). Each tab shows two columns of cameos with scroll arrows; greyed cameos = unavailable (prereq/limit); a dark sweep shows build progress; a number badge shows queued count (left-click adds, right-click cancels/holds); a flashing "Ready" cameo for a finished structure must be dragged onto the map (green/red footprint shows legal/illegal placement within `Adjacent` range). Up to `MaximumQueuedObjects=29`. Setting a **primary** factory (click a second factory) chooses where units emerge; a rally point is set by clicking the ground with a factory selected. |
| **Health bars** | Appear above selected (or all, with Alt/`EnemyHealth=yes`) objects as a segmented bar: **green ≥ 50%**, **yellow 25–50%** (`ConditionYellow=50%`), **red < 25%** (`ConditionRed=25%`). Buildings show the same bar plus smoke/fire at yellow/red. Passenger pips (`PipScale=Passengers`), ammo pips (aircraft), ore pips (miners) appear under the bar in the pip colour (GI white, hero/commando red, engineer/spy blue). Veterancy chevrons sit beside the bar (one = Veteran, three = Elite; elite units also get a flash on promotion, `EliteFlashTimer=150`). |
| **Selection** | White corner brackets around selected units; drag-box selects; Shift adds; double-click/`T` selects all of a type on screen (double-tap `T` map-wide); Ctrl+1–9 assigns **control groups**, 1–9 recalls, Alt+number centres **(unverified)**. Attack cursor on enemies; red "no" cursor on invalid targets; special cursors for capture (Engineer), C4, infiltrate, repair, enter (transport/garrison), chrono (Legionnaire), disguise (Spy). |
| **Orders & hotkeys** | **D** deploy (GI/Guardian GI sandbags, MCV, unload transports/garrisons); **G** guard area (`GuardModeStray=2.0` cells); **S** stop; **X** scatter; **Ctrl+click** force-fire (needed vs Mirage Tanks, own units, bridges, barrels); **Alt+click** force-move (crush infantry); **Ctrl+Shift+click** attack-move; **Ctrl+Alt+click** guard/escort a unit; **Z** (hold) waypoint path (`MaxWaypointPathLength=15`); **B** beacon; **A** ally; **Esc** options. Formation movement is via the waypoint "planning" mode in YR **(no dedicated formation key — unverified)**. |
| **EVA (Allied announcer)** | A crisp, calm female synthetic-voiced "EVA" in American English (Soviet and Yuri sides have their own announcers). Announcement categories (not quoted): construction complete / unit ready / building; new construction options; insufficient funds; low power; cannot deploy here; unable to comply (building in progress); primary building set; base under attack / unit lost / harvester under attack / building captured, infiltrated or lost; enemy structure or unit detected (e.g. superweapon construction, Kirov, Dreadnought); superweapon ready / activated / timer warnings (Chronosphere, Weather Control, nuke launch, Iron Curtain, Dominator); paratroopers/spy plane/Force Shield ready; unit promoted (veteran/elite); select target / select location; reinforcements have arrived; player defeated / allied player left; mission accomplished / failed; and the battle-control establish/terminate bookends. Radar events ping with these messages. |
| **Minimap behaviours** | Clicking the minimap moves the view; right-drag to scroll **(unverified)**; radar shows enemy only within sight/SpySat; Gap Generator areas appear as shroud; Mirage Tanks/stationary disguised units are not drawn as enemies; superweapon countdowns of all players are shown in the top-left timer stack (`ShowTimer=yes`). |
| **Other HUD** | Top bar shows game timer/credits in some modes; in-game chat with `Enter` (all) / `Backspace` (allies); beacons with text. Objective markers and "reveal" triggers in campaign. Cheer command exists (`MaximumCheerRate=300` frames). |

---

## Sources

- rulesmd.ini (Yuri's Revenge retail rules, full copy) — https://raw.githubusercontent.com/hzhangxyz/rulesmd.ini/master/rulesmd.ini (also partial copies: https://gist.github.com/Mirage-Zero-Nine/0c2df4046c279a15ee1f80e6d1608e7d , https://gist.github.com/bladeSk/e37108ca0ebf5f610e71a36389bb900b , https://github.com/moshowgame/ra2yuri/blob/master/rulesmd.ini)
- ModEnc — Verses: https://modenc.renegadeprojects.com/Verses
- ModEnc — Temporal: https://modenc.renegadeprojects.com/Temporal
- ModEnc — CellSpread: https://modenc.renegadeprojects.com/CellSpread
- ModEnc — VeteranAbilities: https://modenc.renegadeprojects.com/VeteranAbilities
- ModEnc — Occupier: https://modenc.renegadeprojects.com/Occupier
- ModEnc — IFV Weapon System: https://www.modenc.renegadeprojects.com/IFV_Weapon_System
- ModEnc — PrismSupportBeam: https://modenc.renegadeprojects.com/PrismSupportBeam
- ModEnc — Warhead: https://modenc.renegadeprojects.com/Warhead
- C&C Wiki (cnc.fandom.com) — Veterancy: https://cnc.fandom.com/wiki/Veterancy ; GI: https://cnc.fandom.com/wiki/GI ; Guardian GI: https://cnc.fandom.com/wiki/Guardian_GI ; Rocketeer: https://cnc.fandom.com/wiki/Rocketeer ; Navy SEAL: https://cnc.fandom.com/wiki/Navy_SEAL_(Red_Alert_2) ; Spy: https://cnc.fandom.com/wiki/Spy_(Red_Alert_2) ; Tanya: https://cnc.fandom.com/wiki/Tanya_(Red_Alert_2) ; Chrono Legionnaire: https://cnc.fandom.com/wiki/Chrono_legionnaire ; Chrono Commando: https://cnc.fandom.com/wiki/Chrono_commando ; Psi Commando: https://cnc.fandom.com/wiki/Psi_Commando ; Chrono Ivan: https://cnc.fandom.com/wiki/Chrono_Ivan ; Sniper: https://cnc.fandom.com/wiki/Sniper_(Red_Alert_2) ; Engineer: https://cnc.fandom.com/wiki/Engineer_(Red_Alert_2) ; Attack dog: https://cnc.fandom.com/wiki/Attack_dog_(Red_Alert_2) ; Grizzly: https://cnc.fandom.com/wiki/Grizzly_Battle_Tank ; Mirage tank: https://cnc.fandom.com/wiki/Mirage_tank_(Red_Alert_2) ; Battle Fortress: https://cnc.fandom.com/wiki/Battle_Fortress ; Robot tank: https://cnc.fandom.com/wiki/Robot_tank ; Chrono miner: https://cnc.fandom.com/wiki/Chrono_miner
- CnC Labs — RA2 Allied units: https://www.cnclabs.com/redalert2/allies/units.aspx
- CNCNZ — RA2 Allied units: https://cncnz.com/games/red-alert-2/allied-units/ ; RA2 Allied structures: https://cncnz.com/games/red-alert-2/allied-structures/ ; YR new Allied units: https://cncnz.com/games/yuris-revenge/new-allied-units/ ; YR new Allied structures: https://cncnz.com/games/yuris-revenge/new-allied-structures/
- StrategyWiki — RA2 Allied units: https://strategywiki.org/wiki/Command_%26_Conquer:_Red_Alert_2/Allied_units
- The Spoiler / StrategyGamers RA2 FAQ & strategy guide (parts 1, 4, 5): https://strategygamers.com/walkthrough/command-and-conquer-red-alert-2 ; https://strategygamers.com/walkthrough/command-and-conquer-red-alert-2-4 ; https://strategygamers.com/walkthrough/command-and-conquer-red-alert-2-5
- LP Archive — RA2 units & buildings (YR additions): https://lparchive.org/Command-Conquer-Red-Alert-2/Update%2042
- Yuri's Revenge manual (hotkeys, tech trees): https://manualmachine.com/games-pc/command--conquer-red-aler/1118766-user-manual/
- PPM Forums — Prism Tank refraction discussion: https://www.ppmforums.com/topic-35762/prism-tank
