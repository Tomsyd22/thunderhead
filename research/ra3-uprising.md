# Command & Conquer: Red Alert 3 + Uprising — Game-Design Reference

Scope: RA3 (2008) at final official patch 1.12 (July 2009) plus the Uprising expansion (March 2009). Numeric unit/structure data is taken from the Chinese RA3 BWiki (wiki.biligame.com/redalert3), whose tables are extracted from the v1.12 game XML, cross-checked against the C&C Wiki (cnc.fandom.com), CNCNZ unit pages, StrategyWiki, GameReplays and the official patch history. Unit distances are in game "yards" (1 build cell = 30 yd; a basic defence tower reaches 300 yd). Build times are seconds at full power. Anything not confirmed by a source is marked **(unverified)**.

Column key used throughout: **Cost/BT** = credits / build time; **HP/Armour** = hit points / armour class (the class determines the damage-type multipliers in §A.4); **Spd** = land/water (or ground/air) speed; **Primary** = damage per shot, damage type, range, cycle (aim + burst + reload); **Secondary** = the F-key ability, with cooldown (CD) and whether it is a *toggle* (mode switch, no CD) or *activated* (one-shot with CD); **Amph** = amphibious; **Vet** = XP value (what a kill is worth) and anything unusual about rank bonuses (standard bonuses in §A.5 apply to every unit unless noted); **Voice** = tone and which line categories exist (Cr = created/exit factory, Sel = select, Mv = move, Atk = move-to-attack, Cbt = in combat, UF = under fire, Ret = retreat, Sec = secondary ability, Gar = garrison/clear, Dn = shot-down/death). Ground units in RA3 have **no scripted death lines**; only aircraft/transforming air units have a "shot down" category.

---

## A. CORE MECHANICS

### A.1 Economy

| Element | Rule (v1.12) |
|---|---|
| Ore nodes ("ore mines") | Neutral, indestructible, pre-placed; exist on land **and** in water. Each holds a finite reserve (typically 30,000–100,000 ore units, shown shrinking as it is mined). |
| Refinery placement | A Refinery is placed so its dock sits on the node; the node then feeds that refinery only. Each refinery comes with/produces one collector; extra collectors can be bought from the refinery (Allies $1000 Prospector, Soviets/Empire $1400) and from the vehicle factory or naval yard. |
| Collector load | 250 ore units per trip → 250 credits (312 with Allied **Free Trade**, +25%). Trip is short because the refinery sits on the node: an active node averages **≈25 credits/s** per refinery (one collector). |
| Depletion | When the reserve hits 0 the node is "depleted" but never disappears: loads drop to **25 units/trip** (≈7.5 credits/s). Depleted nodes are the late-game income floor. |
| Oil Derricks | Neutral tech structures captured by Engineers; pay ≈7.5 credits/s (the same as a depleted node) and a capture bonus; from patch 1.11 they **explode when destroyed**. |
| Observation Post | Neutral capturable radar structure; HP raised 3,000 → 10,000 in 1.11. |
| Allied expansion | **Prospector** ($1000, amphibious collector) deploys (30 s) into a **Command Hub**: 2×2, 2000 HP (2500/3125 at T2/T3), 22×22-cell build radius, grants tech to production buildings within a 26×26-cell area. Required to place buildings away from the ConYard. |
| Soviet expansion | **Sputnik** ($1200, amphibious, unarmed, cannot gain ranks) deploys into an **Outpost** which extends the build radius and lets structures be placed around it; cannot be repacked. Outpost HP **(unverified)**. Each Soviet structure also extends build radius by its own "expansion range" (e.g. Reactor 12×12 cells, War Factory 16×16, Super Reactor 14×14). |
| Empire expansion | No outpost unit: every structure is a mobile **Nanocore** (see A.3) that drives anywhere, including across water, and unpacks. Each unpacked structure projects its own small expansion range (Generator/Dojo/Docks 7×7, Refinery 13×12, Mecha Bay 8×8) which only matters for defences placed by… nothing — cores ignore radius entirely. |
| Selling | Structures sell for roughly 50% of cost (Allied Refinery fixed at $500, Imperial Refinery $550 after 1.05). Selling a Soviet land structure (except the ConYard) spawns Conscripts; selling the Soviet ConYard spawns a Combat Engineer. Allied ConYard/Soviet ConYard can **repack into an MCV** (2 s). |
| Repairs | Structures self-repair at 10 HP/s for up to ~50% of their price. Allied vehicles repair at the Armor Facility apron; Soviet vehicles repair at the War Factory and Crusher Crane; Empire mechs repair at the Mecha Bay; aircraft repair/rearm at Airbase/Airfield; Engineers repair structures. |

### A.2 Power

* Power plants give +100 (Allied Power Plant, Soviet Reactor, Imperial Instant Generator); Soviet **Super Reactor** gives +350 (500 before 1.11); Construction Yards give +50. Typical draws: Barracks/Dojo 25, Refinery/Factory/Yard/Airfield 50, tech buildings 75, basic turrets 25, advanced towers 75, superweapons 75.
* **Low power** (draw > supply): all production and construction slow to 30–50% of normal; powered defences (Multigunner Turret, Spectrum Tower, Sentry Gun, Flak Cannon, Tesla Coil, Defender-VX, Wave-Force Tower) **stop firing**; superweapon countdowns **pause**; radar/minimap goes dark. Tesla Coils can still be fired by a Tesla Trooper/Stingray charge even with no power.
* Spy/Shinobi infiltrating a power plant zeroes its output for 10 s (Super Reactor 70 s; wiki measured ~20 s).

### A.3 Faction build systems

| Faction | Method | Tech gating |
|---|---|---|
| Allies | Classic **build-then-place**: structure is built inside the Construction Yard queue, then placed instantly within the ConYard's 40×40-cell radius or a Command Hub's 22×22. Only one structure builds at a time. | **Heightened Clearance** ($1500, 15 s, needs Refinery) → T2; **Maximum Clearance** ($3000, 60 s, needs Defense Bureau $1500) → T3. Clearance is researched at the ConYard; a production building must be inside a ConYard/Hub area to use it. |
| Soviets | **Place-then-build**: the footprint is placed inside the build radius (32×31 cells from the ConYard, extended by each structure's expansion range) and the building rises *on site*; it is attackable and sell-able while under construction. The **Crusher Crane** ($1500) adds a second parallel structure queue (also repairs/"crushes" vehicles for a refund). | **Super Reactor** ($2000) → T2; **Battle Lab** ($3000, needs Super Reactor) → T3. |
| Empire | **Nanocores**: the ConYard builds a mobile core in 4 s (cost = structure cost; Tower core 5 s), speed 65 (defence cores 60), amphibious, 400 HP (Defender-VX core 200 HP), "Nanocore" armour (takes 150% from rockets/AP/spectrum/tesla). The core drives *anywhere on the map* and unpacks (8–40 s depending on building). Unlimited cores may be queued/in transit. | No tech centre for T2: each **Dojo/Mecha Bay/Docks** buys its own **Nanotech Upgrade** ($500/$750/$750, 30 s) → T2. **Nanotech Mainframe** ($2500) then unlocks a per-building **Nanotech Breakthrough** ($750/$1000/$1000, 30 s) → T3. Each tier adds +25% HP to that production building (Dojo 1000/1250/1562; Bay/Docks 2500/3125/3906). |

### A.4 Damage types and armour classes

RA3 resolves damage as `base damage × armour-class multiplier (× side 105% / rear 110% for vehicles and ships)`. The v1.12 XML defines 15 damage types (English names are community renderings of the Chinese wiki; EA's internal enum names are in parentheses where known):

| Damage type | Typical sources |
|---|---|
| Melee (DOG/MELEE) | Attack Dog, War Bear, Imperial Warrior katana, Shinobi katana, King Oni fists, Sickle landing |
| Sniper (SNIPER) | Natasha, Tanya pistol, Shinobi shuriken, Terror Drone infantry claw, Spy IFV pistol, Iron Curtain kill-pulse |
| Gun / small arms (GUN) | Peacekeeper, Conscript, Imperial Warrior carbine, Combat Engineer pistol, Archer Maiden bow |
| Auto-cannon (AUTO_CANNON) | Riptide, Apollo, Hydrofoil, Imperial collector MG, Tengu, Sea-Wing MG, Defender-VX, Sickle, Twinblade MG, Sentry Gun, Harbinger MG, Pacifier MG |
| Flak / fragmentation (FLAK) | Flak Trooper, Bullfrog, MiG, Flak Cannon |
| Rocket (ROCKET) | Javelin, IFV default, Multigunner Turret, Tankbuster, Rocket Angel, Striker-VX, Sea-Wing AA, Defender-VX AA, Twinblade rockets, Reaper rockets, Giga Fortress pods |
| Cannon / armour-piercing (CANNON) | Guardian, Hammer, Tsunami, Apocalypse, King Oni beam, Assault Destroyer, Mirage elite sub-scatter, Flak Trooper mag-mine, Steel Ronin blade, Giga artillery |
| Spectrum (LASER/SPECTRUM) | Mirage Tank, Spectrum Tower |
| Tesla (TESLA) | Tesla Trooper, Stingray, Tesla Coil |
| Explosive / HE (EXPLOSIVE) | all bombs, artillery, V4/Dreadnought rockets, Athena, Wave-Force, Shogun guns, superweapons, Molotov, Terror Drone vehicle claw, Burst Drone, Yari Last Voyage, Harpoon, Reaper grenades, Grinder treads |
| Grenade (GRENADE) | Tanya C4 only |
| Torpedo / concussive (TORPEDO) | Riptide, Dolphin, Yari, Naginata, Akula; cannot hit anything above water |
| Impact / knock-back (CRUSH-type) | Peacekeeper shotgun flip, Century bomb, Yuriko slam, Sudden Transport, King Oni, Natasha airstrike, Sickle, V4, Kirov, Dreadnought — the "flip infantry" component |
| Radiation / toxin (RADIATION) | Desolator Trooper, Desolator Airstrike, Toxic Corrosion |
| Neutron / "magic" / percentage | Future Tank neutron (100% vs everything), Hammer Leech Beam & Dolphin (unresisted), Yuriko (percent of HP), Cryo (separate freeze bar, see A.9) |

**Armour-class multiplier matrix (% of base damage, v1.12).** Order of columns: Melee / Sniper / Gun / AutoCannon / Flak / Rocket / Cannon / Spectrum / Tesla / HE / Grenade / Torpedo / Impact / Radiation.

| Armour class (units) | Mel | Snp | Gun | AC | Flak | Rkt | Can | Spec | Tes | HE | Grn | Torp | Imp | Rad |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Anti-infantry infantry (Conscript, Peacekeeper, Imp. Warrior, Engineers, Spy, Shinobi, Archer) | 100 | 100 | 100 | 150 | 10 | 20 | 20 | 100 | 1000 | 100 | 100 | 100 | 100 | 100 |
| Anti-vehicle infantry (Flak Trooper, Javelin, Tankbuster, Cryo Legionnaire) | 100 | 100 | 150 | 150 | 20 | 10 | 10 | 100 | 1000 | 100 | 100 | 100 | 100 | 100 |
| Scout infantry (Attack Dog) | 100 | 100 | 150 | 150 | 10 | 10 | 10 | 100 | 1000 | 50 | 50 | 100 | 100 | 100 |
| Soviet scout infantry (War Bear) | 100 | 100 | 150 | 150 | 25 | 25 | 25 | 100 | 1000 | 50 | 50 | 100 | 100 | 100 |
| Soviet heavy AT infantry (Tesla Trooper) | 100 | 100 | 150 | 150 | 10 | 10 | 10 | 30 | 50 | 100 | 100 | 100 | 100 | 100 |
| Desolator infantry | 100 | 100 | 150 | 100 | 20 | 20 | 20 | 100 | 1000 | 100 | 100 | 100 | 100 | 0 |
| Commando (Tanya, Natasha, Yuriko) | 100 | 12 | 100 | 200 | 10 | 20 | 25 | 100 | 1000 | 50 | 100 | 100 | 100 | 100 |
| Peacekeeper riot-shield mode (rear ×500%) | 0 | 5 | 20 | 20 | 5 | 5 | 5 | 5 | 20 | 5000 | 100 | 100 | 5 | 100 |
| Tankbuster spider-hole | 0 | 5 | 25 | 50 | 5 | 5 | 5 | 5 | 5 | 100 | 100 | 100 | 100 | 100 |
| Japanese scout infantry (Burst Drone) | 0 | 1 | 200 | 75 | 75 | 100 | 200 | 100 | 100 | 75 | 100 | 100 | 100 | 5 |
| Harassment / light vehicle (Riptide, IFV, Sickle, Tengu-mech, Reaper) | 0 | 0 | 25 | 100 | 100 | 75 | 170 | 170 | 170 | 100 | 100 | 100 | 75 | 5 |
| Mortar Cycle | 0 | 100 | 50 | 100 | 60 | 50 | 170 | 170 | 170 | 100 | 100 | 100 | 75 | 5 |
| Soviet scout vehicle (Terror Drone) | 0 | 100 | 150 | 200 | 25 | 25 | 25 | 25 | 10000 | 75 | 100 | 100 | 200 | 0 |
| Tank (Guardian, Mirage, Hammer, Tsunami, Pacifier) | 0 | 0 | 50 | 25 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 75 | 5 |
| Advanced tank (Apocalypse, King Oni, Future Tank, Grinder) | 0 | 0 | 50 | 25 | 150 | 100 | 100 | 100 | 100 | 250 | 100 | 50 | 75 | 5 |
| Japanese sentinel vehicle (Steel Ronin) | 0 | 0 | 50 | 25 | 150 | 150 | 100 | 125 | 100 | 100 | 100 | 100 | 75 | 5 |
| Artillery (Athena, V4, Wave-Force) | 0 | 0 | 50 | 50 | 50* | 100 | 125 | 125 | 125 | 100 | 100 | 100 | 75 | 5 |
| Support vehicle (MCVs, Sputnik, Bullfrog, Striker-VX ground) | 0 | 0 | 50 | 100 | 100 | 100 | 125 | 125 | 125 | 100 | 100 | 100 | 100 | 5 |
| Sudden Transport | 0 | 0 | 50 | 50 | 150 | 150 | 150 | 150 | 150 | 100 | 100 | 100 | 75 | 5 |
| Ore collector (all three) | 0 | 0 | 50 | 100–150 | 100 | 100 | 150 | 150 | 150 | 100 | 100 | 100 | 100 | 5 |
| Nanocore | 0 | 0 | 100 | 100 | 150 | 150 | 150 | 150 | 150 | 100 | 100 | 100 | 100 | 5 |
| Aircraft (Vindicator, Apollo, Cryocopter, MiG, Twinblade, Kirov, Rocket Angel, Chopper-VX, Sky-Wing) | 0 | 1 | 200 | 100 | 100 | 100 | 200 | 100 | 100 | 75 | 100 | 100 | 100 | 5 |
| Jet Tengu (fighter armour) | 0 | 1 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 75 | 100 | 100 | 100 | 5 |
| Bomber (Century) | 0 | 1 | 100 | 125 | 100 | 100 | 100 | 100 | 100 | 75 | 100 | 100 | 100 | 5 |
| Allied gunship (Harbinger) | 0 | 1 | 200 | 200 | 150 | 100 | 200 | 100 | 100 | 75 | 100 | 100 | 100 | 5 |
| Naval surface vessel (Hydrofoil, Stingray, Carrier, Dreadnought, Shogun, Sea-Wing sea, Yari) | 0 | 0 | 50 | 50 | 100 | 100 | 150 | 150 | 100 | 100 | 100 | 75 | 75 | 5 |
| Advanced ship (Akula, Naginata) | 0 | 0 | 50 | 50 | 100 | 100 | 50 | 100 | 100 | 100 | 100 | 50 | 75 | 5 |
| Allied anti-ship T2 (Assault Destroyer) | 0 | 0 | 50 | 25 | 150 | 100 | 100 | 100 | 100 | 100 | 100 | 50 | 75 | 5 |
| Allied anti-ship scout (Dolphin) | 0 | 100 | 20 | 100 | 200 | 100 | 125 | 75 | 90 | 100 | 100 | 100 | 75 | 100 |
| Japanese fortress (Giga Fortress) | 0 | 0 | 100 | 65 | 100 | 100 | 150 | 150 | 100 | 100 | 100 | 75 | 75 | 5 |
| Main structure (production, tech, superweapons, Hub, Bunker) | 0 | 0 | 100 | 50 | 100 | 100 | 100 | 100 | 100 | 125 | 100 | 100 | 100 | 0 |
| Basic defence (Multigunner Turret**, Sentry, Flak Cannon, Defender-VX, Reaper turret) | 0 | 0 | 100 | 50 | 100 | 100 | 100 | 100 | 100 | 150 | 100 | 100 | 100 | 0 |
| Advanced defence (Spectrum Tower, Tesla Coil, Wave-Force Tower) | 0 | 0 | 100 | 50 | 100 | 100 | 100 | 100 | 100 | 200 | 100 | 100 | 100 | 0 |
| Wall | 0 | 0 | 0 | 10 | 100 | 100 | 100 | 100 | 100 | 150 | 100 | 100 | 10 | 0 |
| Frozen (any) | 90000 for every physical type; Spectrum/Tesla 100; Radiation 5 — i.e. one hit shatters |
| Shrunk (any) | 200 for everything |

\* Athena shows Flak 50, V4/Wave-Force 100. \*\* Multigunner Turret takes 136% Cannon. Per-unit exceptions are coded on the weapon, not the armour: e.g. Twinblade rockets 25% vs collectors; Vindicator 50% vs Cores/commandos, 75% vs refineries and light AA; MiG 200% vs Kirov, 50% vs MiG/Apollo; Jet Tengu 30% vs fighters; Multigunner Turret rocket 50% vs main battle tanks and 250% vs infantry; anti-infantry vehicles' Gun vulnerability was cut 50% → 25% in 1.11.

### A.5 Veterancy

| Rank (icon) | XP needed (× unit cost) | Bonus |
|---|---|---|
| Veteran (1 chevron) | 3× | Damage per shot ×1.25 |
| Elite (2 chevrons) | 6× | Max HP ×1.25 (added on top) |
| Heroic (star) | 9× | Alert radius, vision and **range ×1.25**, rate of fire ×1.20, out-of-combat self-heal (infantry 2 HP/s, vehicles 6 HP/s, "out of combat" = 1 s without attacking/being hit); suppression resistance 50 → 300; immune to Dog/Bear stun. Mirage Tank and Apocalypse Tank swap to an entirely new weapon; Striker-VX/Hydrofoil/Tengu gain special effects. Apollo refills ammo once on reaching Veteran. |

A kill awards XP = target's XP value (≈ cost) × 1/2/3/4 for an unranked/veteran/elite/heroic victim. Threat-meter Orange gives +50% XP, Red +100%. Engineers (500), MCVs (10,000), Sputnik, Nanocores and Burst Drones never rank up. Buildings earn XP (defences do rank).

### A.6 Garrisons, infantry in buildings, crushing

* Civilian structures and Soviet Combat Bunkers (5 infantry) can be garrisoned; the Multigunner Turret/IFV take one. Garrisoned infantry get **alert radius ×2.5 and weapon range ×1.75** (the range bonus was 100% before 1.11); Flak Troopers get no alert bonus.
* Clearing: Peacekeeper riot-shield rush (the Peacekeeper is spent; cannot clear Bunkers), Conscript Molotov (50 dmg vs garrison instead of 15), Imperial Warrior Banzai charge, Desolator spray, Cryo Legionnaire; Natasha's airstrike and any demolition kill the building and its occupants; Chrono Rift/Nanoswarm/Decimator all work. Spies and Shinobi cannot enter garrisons.
* **Crushing** uses a crush level vs crushed level: a unit crushes anything whose "crushed" value is lower than its "crush" value. Infantry 0/10 (commandos 0/50), light vehicles 0–1/20, tanks 20/20, heavy 30/31, Apocalypse 30/31, Grinder 60/30, King Oni 20/31 (31/31 while Bull-Rushing), Shogun ramming 40/30, MCV 30/31. So tanks crush infantry and Terror Drones; only Apocalypse/MCV/Grinder/Oni-rush/Shogun crush other tanks. The Peacekeeper shield does not prevent crushing. Grinder Treads (Soviet protocol) heals the crusher for 50% of the victim's max HP.
* **Suppression/prone:** infantry under fire go prone; prone infantry take 75% damage and move at 75%. Suppression resistance 50 (300 heroic; 99999 while shielding, charging or sprinting).

### A.7 Naval design

RA3 made water a full theatre: every faction's MCV, collector, expansion unit and most T1 units are amphibious, and nodes/derricks sit in water. Deep water: only ships, subs, amphibious units and hover units; shallow shoreline: everything. Naval yards (Seaport $1000 3×5, Naval Yard $1000 3×6, Imperial Docks $1000 3×5) are placed on the shore and also build collectors, MCVs and the faction's amphibious vehicles (Riptide, Bullfrog/Sputnik, Imperial collector/MCV). Submarines (Akula, Yari, Sea-Wing submerged) are invisible until they fire; only torpedo-armed units and anti-sub ordnance (Riptide, Assault Destroyer depth charges, Dolphin, Yari, Naginata, Yuriko) can hit them, and defence structures can target a surfaced one. Ships cannot be bribed while submerged and are immune to crushing except by the Shogun ram. Every faction has an amphibious tank/vehicle line (Assault Destroyer; Stingray/Bullfrog/Grinder; Tsunami/Tengu/Sudden Transport), so "landlocked" maps still allow water flanks.

### A.8 Co-commanders

Every RA3 campaign mission is designed for two commanders: a human co-op partner over network, or an AI **co-commander** chosen from the faction's three officers — Allies: Warren Fuller (armour), Giles Price (air), Lydia Winters (navy); Soviets: Oleg Vodnik (armour), Nikolai Moskvin (fire/Tesla), Zhana Agonskaya (air); Empire: Shinzo Nagama (defensive), Kenji Tenzai (mecha), Naomi Shirada (navy). The co-commander owns a separate base and economy, builds and fights autonomously, and is steered through a command panel: place a **beacon** and order *Attack target*, *Attack-move here*, *Move here*, *Defend/Guard here*, or request a *Top Secret Protocol strike* at a point; the player cannot select the AI's units directly. In Skirmish the same nine personalities (plus Uprising's challenge versions) are the AI opponents, each biased toward a unit class and one of five behaviours (Balanced, Rusher, Turtle, Guerrilla, Steamroller).

### A.9 Status effects worth knowing

* **Freeze (Cryo):** every unit has a hidden freeze bar = 200% of max HP; each 20% lost cuts speed/ROF (or build speed) 20%; below 100% the target freezes solid, becomes a 1-hit kill (armour table above) and shatters when hit; bar regenerates 25/s when not being frozen. Burst Drones die instantly when frozen.
* **Shrink (S.H.R.I.N.K.):** 20 s (24 s with High Technology); speed and ROF ×2, damage ×0.25, range ×0.5, vision ×0.4, takes 200% damage, crush/crushed 0/1 (can be crushed by anything, and a shrunk King Oni explodes if it Bull-Rushes).
* **Stun (Dog bark/Bear roar):** 10 s, radius 100, infantry only; heroic infantry, charging Warriors, burrowed Tankbusters, commandos and Terror Drones are immune.
* **EMP/disable:** Blackout Missile (10 s/13 s), Tesla Trooper EM field, Terror Drone stasis (target can still fire), Hydrofoil jammer (weapon only, not infantry), Chrono Rift (phased out, damaged on return).
* **Lift (Yuriko / Magnetic Satellite / Apocalypse harpoon):** lifted ground units can be hit by anti-air.

### A.10 Top Secret Protocols

Mechanics: Protocols need a Construction Yard. A **threat meter** (ring around the protocol button) fills from combat: a kill adds 0.75× the victim's XP value, a loss adds 3× your unit's XP value; decay −50/−150/−300 per s in the Yellow (0–12,499)/Orange (12,500–37,499)/Red (37,500–50,000) bands. Security points accrue at 1/1.5/2 per s by band; every **360** points = **1 protocol point**; everyone starts with 1 and can earn at most **10 per match**. Every protocol costs **1 point**; the three tiers of a line must be bought in order. (Uprising Commander's Challenge only: a **Red Alert button** appears when the meter is full — +$50,000, all units Heroic, meter reset, timer set to 99:59.)

**Allies — FutureTech Advanced Research**

| Line | T1 | T2 | T3 |
|---|---|---|---|
| Air/support | **Advanced Aeronautics** (passive): all Allied aircraft +25% HP, vision 500→625, Vindicator 2→3 bombs & reload 10→7 s, Century 6→9 bombs & reload 15→10 s, Cryocopter beam 75→100 | **Surveillance Sweep**: Sky Knights scan a 150-yd-wide line between two chosen points, CD 120 s | **High Technology** (passive): Dog/Guardian/Cryocopter/Carrier (+Cryo Legionnaire, Harbinger flag only) ability CD ×0.75; Target Painter +50%→+100%, Blackout radius 150→200 & 10→13 s, Shrink 20→24 s |
| Chrono | **Chrono Swap**: swap any two friendly/allied units anywhere; paralysis after swap +0.75 s per 250 yd distance; CD **(unverified)** | **Chrono Rift / Chasm / Fissure**: phase everything in radius 75/**(unverified)** out of existence for 5/10/15 s (after 1 s warning); returning objects that overlap die; CD 120 s (Rift), higher tiers **(unverified)**. Campaign replaces this line with **Paratroop Team/Squad/Platoon** (1/2/3 Century Bombers dropping 1/2/3 dogs, 3/6/9 Peacekeepers, 1/2/3 Javelins). | **Free Trade** (passive): own collectors +25% credits per load (250→312), allies +5% |
| Strike | **Surgical Strike**: Artemis precision bomber single heavy bomb; CD **(unverified)** | **Time Bomb / Deluxe / Supreme**: chrono-shifted bomb, visible seed 3 s then 7/12/22 s fuse, 750/1000/1500 HE in radius ≈20/25/30; destroyed early = weaker blast; CD 120/240/360 s | **Cryoshot / Cryoblast / Cryogeddon**: satellite cryo-beam radius 75/125/200, freeze damage 1500→500 / 2250→750 / 3000→1000, 5 s beam warning, fires 4/6/8 s; CD 120/140/180 s |

**Soviets — Ministry of Experimental Science**

| Line | T1 | T2 | T3 |
|---|---|---|---|
| Vehicles | **Terror Drone Surprise** (passive): 20% chance a destroyed Soviet vehicle/ship spawns a Terror Drone | **Cash Bounty**: marks everything in radius 100 for 30 s; any marked unit/structure destroyed (or sold) pays 25% of its cost; CD 120 s | **Grinder Treads** (passive): Soviet ground vehicles that crush heal 50% of the victim's max HP |
| Toxin | **Toxic Corrosion**: a chosen friendly vehicle takes 10 toxin/s, leaves a 10-dmg toxic trail (radius 80); on death explodes for 5000 toxin radius 80 and leaves a cloud (20 dmg × 65 ticks); CD 150 s | **Desolator Airstrike / Dual / Delta**: 1/2/3 Badger bombers (can be shot down) drop toxin on radius 150 — 20 dmg × 450 ticks; clears garrisons; warning 10 s (5 s with beacon); CD 180 s (higher tiers **unverified**) | **Mass Production** (passive): own units & structures −25% cost, allies −5% (not walls) |
| Orbital | **Orbital Drop / Dump / Downpour**: 3 probes / 2 satellites / 1 space station plus 4/?/12 meteors fall on radius 75/?/175 after 3/?/9 s warning — 300 → 0 per probe, station 1500 falling to 375; any vehicles previously lifted by Magnetic Satellite fall too (200 HE each); falling objects deal 99999 Rocket to aircraft; CD 180/**?**/300 s | **Magnetic Satellite / Super / Ultra**: steerable beam radius 50 lifts vehicles, mechs and aircraft into orbit for 8 s (higher tiers larger/longer and lift heavies); CD 120 s (tiers **unverified**) | **Magnetic Singularity**: 5 s warning, radius 200: drags and immobilises all vehicles, instantly kills infantry; smoke flare delay added 1.09; CD 120 s |

**Empire — Imperial Technology Division**

| Line | T1 | T2 | T3 |
|---|---|---|---|
| Fleet/ambush | **Fortified Fleet** (passive): Imperial naval units −25% damage taken, speed ×1.25, vision ×1.25 | **Point-Defense Drones**: all vehicles/heavy vehicles/ships in radius 100 get a 200-HP drone shield (repairable, overkill does not bleed through) lasting 119 s (expiry added 1.11); CD 120 s | **Sleeper Ambush**: 5 Tankbusters burrow up at 5 points (radius 50) anywhere explored, not in Nanoswarm/on cliffs; CD 210 s |
| Kamikaze | **Honorable Discharge** (passive): every Imperial vehicle, ship, air unit and Nanocore explodes on death (200→100 HE, radius 50); Burst Drone/Yari/Final Squadron get stronger self-destructs (Yari 500→650, radius 25→50; Burst 200→250) | **Final Squadron / X / Omega**: 5/10/15 Sunburst drones spawn 3000 yd out, strafe (5 dmg) then crash (100 HE, 150 with Honorable Discharge = 250 total), each target hit ≤2×, radius 100, 15 s warning; CD 120 s (tiers **unverified**) | **Robotic Assembly** (passive): own production −25% build time, allies −5% |
| Rage | **Advanced Rocket Pods** (passive): Rocket Angel 12→18, Striker-VX 3/5→6/6, Sea-Wing 4→6, Giga Fortress 8→11 rockets per magazine | **Emperor's Rage / Revenge / Retribution**: radius 100, 30 s, instant: all units (friend **and** foe) in area −25% speed, ROF ×1.25 (higher tiers stronger buff, heavier slow; slow capped at 75% in 1.11); CD 120 s | **Balloon Bombs / Barrage / Blowout**: 5/10/15 steerable parachute bombs; AA can pop the chutes (bombs then free-fall) but not the bombs; CD **(unverified)** |

### A.11 Superweapons and support structures

| Structure | Faction | Cost/BT (1.12) | HP | Power | Prereq | Effect | Cooldown |
|---|---|---|---|---|---|---|---|
| Proton Collider | Allies | $2500 / 30 s (was $5000 pre-1.11) | 4000 | −75 | Defense Bureau | 5 proton blasts of 400 HE each, blast radius 300 (falloff to 200 at cursor radius 250); each destroyed building "catalyses" a 200-HE secondary explosion; 3 s wind-up | 360 s |
| Vacuum Imploder | Soviets | $2500 / 30 s | 5000 | −75 | Battle Lab | Pulls everything within 200 into a vortex for 8 s (45 HE × 8 s ≈ 2070, radius 300, falloff to 15); gathered units die when it collapses; 4 s wind-up | 360 s |
| Psionic Decimator | Empire | $2500 / 26 s unpack | 4000 | −75 | Nanotech Mainframe | Single psionic wave 2000 HE, radius 300 falling to 500; ignores Point-Defense Drones; killed buildings spawn no survivors; 4 s wind-up | 360 s |
| Chronosphere | Allies | $1500 / 30 s | 4000 | −75 | Defense Bureau | Teleports all units in radius 100 anywhere on the map; **lethal to infantry**; units landing on occupied cells die; 2 s wind-up. Also enables Chrono Swap-style tricks (teleporting tanks into water kills them) | 180 s |
| Iron Curtain | Soviets | $1500 / 30 s | 5000 | −75 | Battle Lab | Units/structures in radius 100 become invulnerable for 20 s (3 s to apply); **kills infantry** in the area (999999 Sniper); curtained units cannot be bribed | 180 s |
| Nanoswarm Hive | Empire | $1500 / 26 s | 4000 | −75 | Mainframe | Dome of radius 180–200, height 200, 20 s: nothing on the ground and no projectile passes in or out (aircraft unaffected); blocks chrono bombs; Sleeper Ambush cannot be cast inside | 180 s |

Superweapon timers pause under low power; infiltration by Spy/Shinobi resets the timer. Cheaper (half-price) superweapons were introduced in 1.11 to make them viable; Skirmish has a "Superweapons on/off" toggle.

### A.12 Unit cap and multiplayer settings

RA3 has **no hard population cap** in standard multiplayer **(unverified for all modes)**; the practical limiters are credits and the one-at-a-time structure queue. Skirmish/online lobby options: starting credits (default 10,000; options up to 50,000 **(unverified exact steps)**), game speed, superweapons on/off, random crates on/off, AI difficulty (Easy/Medium/Hard/Brutal) and personality, observers, team/colour/faction (Random allowed), 1v1 to 3v3 and FFA on the shipped maps, the "official 7" 1v1 ladder maps, and replays. Ranked play used an auto-match ladder (revamped in 1.06) with a 30-s kick for bad connections (1.11).

### A.13 What RA3 changed from RA2

* Three symmetric-but-asymmetric factions (Empire replaces Yuri's mind-control sub-faction); no country-specific bonus units.
* **Every unit has a secondary ability** (F key) — the game's signature mechanic; no veterancy-locked "elite" weapons except Mirage/Apocalypse.
* Economy: finite scattered ore fields → fixed ore **nodes** with refineries built *on* them, plus depleted-node trickle; gems removed; no ore-purifier buildings.
* Three distinct **build systems** (A.3) instead of RA2's shared sidebar model; tech via clearance/upgrades rather than Battle Lab for everyone.
* Naval warfare is mandatory: amphibious MCVs/collectors, water ore, every faction has an amphibious vehicle line.
* **Co-commander/co-op campaign** replaces the single-player-only story; FMV cutscenes retained.
* Smaller armies, smaller maps and shorter matches (typical 1v1 ends by 15–20 min); unit HP/damage scaled so T1 infantry die in 1–2 hits; **garrisoning is weaker** (75% range bonus, no "Attack Dogs can't enter" quirks).
* Top Secret Protocols replace RA2's single superweapon support powers (Spy Plane, Paradrop, Force Shield); superweapons now have cheaper support variants (Chronosphere/Iron Curtain/Nanoswarm at $1500).
* No gates, no Sentry Gun-style RA2 walls-with-turrets; walls are $10 segments that auto-connect within 11 cells.
* Veterancy is three ranks earned at 3×/6×/9× cost with the fixed +25% damage/+25% HP/heroic package, instead of RA2's per-unit chevron tables.

---

## B. ALLIES

### B.1 Allied structures (all built from the Construction Yard queue, build-then-place inside ConYard/Command Hub radius; limit = none unless stated)

| Structure | Cost / BT | HP (Main-structure armour unless noted) | Power | Prereq | Function / notes |
|---|---|---|---|---|---|
| Construction Yard | $5000 (MCV) / 2 s deploy | 4000 | +50 | — | 4×4; 40×40-cell build radius; researches Heightened ($1500, 15 s) and Maximum Clearance ($3000, 60 s); repacks to MCV; can place Seaport across cliffs |
| Power Plant | $800 / 10 s | 1000 | +100 | — | 3×2 |
| Boot Camp | $500 / 10 s | 1000 | −25 | — | 3×3; infantry; 1 cell in front unbuildable |
| Ore Refinery | $2000 / 20 s | 2000 | −50 | Power Plant | 3×4 on an ore node; sells for $500 (1.05); builds Prospectors ($1000, 20 s) |
| Armor Facility | $2000 / 20 s | 2500 | −50 | Refinery | 4×4; vehicles; repair apron; T2/T3 units need a ConYard/Hub in range |
| Airbase | $1000 / 15 s | 2000 | −50 | Power Plant | 4×6; 4 aircraft pads **(unverified count)**; rearm/repair; "Recall aircraft" button |
| Seaport | $1000 / 20 s | 2500 | −50 | Refinery | 3×5 on shore; ships, Riptide, Prospector, MCV |
| Defense Bureau | $1500 / 30 s (10 s before 1.11) | 2000 | −75 | Airbase + Refinery | 3×4; unlocks Maximum Clearance, Spectrum Tower, Chronosphere, Proton Collider, Tanya, Harbinger |
| Multigunner Turret | $800 / 20 s | 1000 (Allied base-defence armour: Cannon 136%, HE 150%) | −25 | Power Plant | 1×1, range 300, sight 310. Default: 2× 50-dmg Rocket, cycle 1.0–1.1 s (≈95 DPS; 50% vs MBTs, 250% vs infantry). Garrisons 1 infantry → weapon swap (table B.2a); "Evacuate" ejects (not under low power). Offline at low power |
| Spectrum Tower | $1200 / 30 s | 1500 (adv. defence: HE 200%) | −75 | Power Plant + Defense Bureau | 1×1, range 350: 300 Spectrum dmg, 1 s aim + 1.5 s beam + 0.5 s reload (100 DPS), scatters 5 sub-beams like a Mirage. **Spectrum Link**: adjacent towers (≤2 links, 2 s each) boost the firing tower ×1.5 or ×1.5×1.5 |
| Chronosphere | $1500 / 30 s | 4000 | −75 | Defense Bureau | see A.11; limit 1 **(unverified)** |
| Proton Collider | $2500 / 30 s | 4000 | −75 | Defense Bureau | see A.11; limit 1 **(unverified)** |
| Wall | $10 / 5 s | 300 (Wall armour) | 0 | — | 1×1, auto-connects segments ≤11 cells apart; Gun 0%, AC 10% |
| Command Hub (from Prospector) | $1000 / 30 s deploy | 2000 / 2500 / 3125 by tier | 0 | — | 2×2; 22×22 build radius; tech-grant area 26×26 cells |

#### B.2a Multigunner IFV / Turret passenger weapons (v1.12; "IFV" column = weapon the vehicle/turret gains; the turret uses the same table at range 300)

| Passenger | Resulting weapon | Dmg / type | Range | Cycle | ≈DPS |
|---|---|---|---|---|---|
| none | Rocket pods: ground 10 ×3 / AA 25 ×6 | Rocket | 150 / 300 | 1.3 s / 2.1 s | 23 / 71 |
| Peacekeeper | Heavy shotgun | 40 Auto-cannon | 300 | 0.4 s | 80 |
| Javelin Soldier | 8-rocket salvo | 30 Rocket ×8 | 300 (ground & air) | 4 s reload | ≈44 |
| Engineer | Repair arm | heals 5 per 0.1 s | 25 | — | 50 HP/s repair |
| Attack Dog / War Bear | Detection + stun-bark **(unverified)** | — | — | — | — |
| Spy | Silenced pistol | 30 Sniper | 300 | 1–1.2 s | ≈13 |
| Tanya | Pistol (same as Spy) | 30 Sniper | 300 | 1–1.2 s | ≈13 |
| Conscript | ADK-45 | 5 Gun ×3 | 300 | 0.2–0.3 s | ≈11 |
| Flak Trooper | Flak gun (**air only**) | 15 Flak, unlimited mag | 300 | 0.2 s | 75 |
| Tesla Trooper | Tesla rifle | 100 Tesla | 300 | 0.1–0.3 s reload | ≈53 |
| Natasha | Sniper rifle | 1000 Sniper (infantry only) | 300 | 2 s | 500 |
| Imperial Warrior | Carbine | 8 Gun ×5 | 300 | 0.2–0.3 s | ≈32 |
| Tankbuster | Plasma cutter | 100 Rocket | 300 | 0.4–0.6 s | ≈125 |
| Shinobi | Shuriken | 250 Sniper | 300 | 0.1 s reload | 227 |
| Yuriko | Psionic crusher | 4% of target HP/tick | 300 | 0.13 s | ≈30% HP/s |
| Rocket Angel / Burst Drone | cannot enter (flying) | | | | |
| Cryo Legionnaire / Desolator / Archer Maiden (Uprising) | cryo beam / toxin sprayer / AA bow **(unverified values)** | | 300 | | |

### B.2 Allied infantry (Boot Camp)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Attack Dog | 200 / 2 s | 30 / Scout inf. | 100 / 75 (swims) | Bite 200 Melee, range 30, 2 s cycle (100 DPS); infantry only; detects spies/stealth (radius 300) | **Amplified Bark** (activated): stuns infantry in radius 100 for 10 s; CD 60 s (45 s High Tech) | T1 | Yes | 200 | Any vehicle, Conscript rifles (dog dies to 1–2 hits), Burst Drone unaffected | Barks/growls only; Sel, Mv, Atk, Sec all are dog vocalisations |
| Peacekeeper | 200 / 5 s | 150 / Anti-inf. inf. (shield mode: 5–20% from most types, rear ×5) | 50 (25 shielded) | Grummond-8 shotgun 25–40 Gun by distance, range 150, 1.5 s cycle; knocks infantry down (radius 40) | **Riot Shield** (toggle): drops weapon, near-immune frontally, half speed, can clear a garrison by rushing it (unit consumed); blocks dog/bear/katana | T1 | No | 200 | Conscript Molotovs vs shield, Terror Drones (ignore shield), crushing, Tesla, Sickle | Brash American riot-cop bravado; Cr, Mv (separate shield-up lines), Gar, clear-garrison, Atk, Cbt, UF |
| Javelin Soldier | 300 / 5 s (400 before 1.11) | 100 / Anti-veh. inf. | 50 | Rocket 25 Rocket, range 175 ground / 300 air, 0.5–0.7 s cycle (≈40 DPS) | **Laser Lock** (toggle): 3.5 s lock-on, then 40-dmg rockets at 0.2–0.3 s (≈160 DPS), range 50–250 (air ×1.7); lock persists per target | T1 | No | 400 | Infantry (shotguns, dogs, Sickle), anything that out-ranges 175 | Gruff, laconic veteran NCO; Cr, Sel, Mv, Atk (laser-lock lines), Cbt, UF |
| Engineer | 500 / 10 s | 50 / Inf. | 40 (jet-ski on water) | None; captures structures (several-second capture, vulnerable since 1.05), repairs | **First Aid Tent** (activated, CD 10 s, 2 s pack/unpack): heals infantry within 100 at 10% HP/s | T1 | Yes | fixed 500 | Everything; dogs/bears | Nervous bookish technician; Cr, Sel, Mv, capture/repair, Sec |
| Spy | 1000 / 10 s | 75 / Inf. | 50 | None; **Disguise** as enemy infantry (auto) and infiltrate buildings (effects: A.2 power, refinery steals $2000, production lock 30 s + reveal, tech lockout, ConYard radar out 60 s, superweapon reset) | **Bribe** (activated): $1000, radius 65, CD 10 s, converts enemy ground vehicles/infantry (not aircraft, subs, cores, MCVs, collectors, engineers, dogs/bears, drones, Shinobi) | T2 (Heightened) | Yes | 1000 | Dogs/Bears/Burst Drones detect; Shinobi | Suave British secret-agent smoothness; Sel, Mv, disguise, infiltrate, Sec |
| Tanya Adams | 2000 / 30 s | 300 / Commando (Sniper 12%, Tesla 1000%) | 55 (swims) | Twin Desert Eagles 100 Sniper, range 140, 0.1 s cycle (one-shots infantry); C4 999,999 Grenade, range 1, 2.1 s cycle vs vehicles/ships/buildings | **Time Belt** (activated, CD 30 s): rewinds her position and HP to 10 s earlier | T3 (Max Clearance + Defense Bureau) | Yes | 2000; build limit 1 | Tesla Troopers/Coils (one hit), dogs, Sickle/anti-infantry vehicles at range, aircraft | Cocky, flirtatious American action-heroine; Cr, Sel, Mv, Atk, Cbt, UF, Sec, Gar |
| Cryo Legionnaire (Uprising) | 1500 / 15 s | 500 / Anti-veh. inf. | 80 / 70 | Cryo spray 20 dmg at 0.1 s (≈100 DPS, +25% with High Tech), 60° cone, range 200; freezes then shatters anything | **Booster Stomp** (activated, CD 10 s): jumps 20–300 yd, landing stomp 20 dmg + knock-back radius 50; shatters frozen units | T2 + High Technology | Yes | 1500 | Massed infantry out-ranging the cone, aircraft, Tesla | Flat, emotionless synthesised monotone; Cr, Sel, Mv, Atk, Cbt, UF, Sec |

### B.3 Allied vehicles (Armor Facility; Prospector/Riptide/MCV also at Seaport)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Prospector | 1000 / 20 s | 500 / Collector | 50 | Unarmed; 250-ore loads | **Deploy** → Command Hub (30 s, irreversible) | T1 | Yes | 1400 | Anything AT; Terror Drones | Cheerful civilian contractor; Cr, Sel, Mv, harvest, Sec |
| Riptide ACV | 750 / 10 s | 500 / Light veh. | 90 / 90 | Chain gun 8 AC ×5, range 150 (20 DPS, 125% vs Peacekeepers); 2 torpedoes 40 Torpedo, range 150, AoE 15 (anti-sub) | **Evacuate** (land only): unloads 5 infantry | T1 | Yes | 900 | Tanks (Cannon ×1.7), AT infantry, aircraft | Hot-shot amphibious-assault coxswain; Cr, Sel, Mv, load/unload, Atk, Cbt, UF |
| Multigunner IFV | 800 / 10 s (900 before 1.08) | 360 / Light veh. | 120 | see B.2a; default rockets 10×3 ground / 25×6 air | **Evacuate**: ejects passenger, reverts weapon | T1 | No | 700 | Tanks, Tesla Troopers, Terror Drones | Over-eager young crewman; Cr, Sel, Mv, Atk, Cbt, UF, load |
| Guardian Tank | 950 / 10 s | 480 / Tank | 80 | 90 mm 60 Cannon, range 150, 2 s cycle (30 DPS); suppresses infantry | **Target Painter** (toggle): no gun; paints one target ≤300 yd → it takes +50% damage (+100% with High Tech); painters don't stack | T2 | No | 900 | Hammer 1v1, Tsunami Nano-shield, AT infantry, aircraft | Confident, measured tank commander; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Athena Cannon | 1400 / 20 s | 400 / Artillery | 50 | Orbital laser 20 HE ×30 over 2 s after 2 s aim, range 200–500, AoE 10 (600 per 5.1 s cycle, ≈118 DPS); ignores Black Hole Armour | **Aegis Shield** (activated, CD 20 s): bubble absorbs 2000 dmg, radius shrinks 200→50; at heroic her beam pierces shields | T3 | No | 1400 | Anything inside 200 yd, aircraft, Terror Drones | Calm, precise female operator; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Mirage Tank | 1600 / 15 s | 500 / Tank | 80 | Spectrum 200 dmg, range 125, 1.6 s cycle (125 DPS) + 5 scatter beams of 25 within 150; heroic: 312.5 dmg, range 187, 7 scatters of 40 + 3 Cannon sub-scatters | **Gap Generator** (toggle): cloaks friendlies within 175 (not itself), cannot fire; **Ambush Mode**: disguises as scenery when idle (not at red HP) | T3 | No | 1600 | Detection (dogs, bears, drones), massed tanks/AT inf, bombers | Hushed, sly whispering; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Pacifier FAV (Uprising) | 2000 / 20 s | 800 / Tank | 75 | Twin 7.62 Gatlings 18 AC ×8, range 250 (≈55 DPS); **deployed**: siege cannon 150 HE ×5, range 250–740, AoE 40 (≈163 DPS) | **Deploy / Undeploy** (activated, 2 s, CD 3 s); vision 880 deployed | T2 + High Tech | Yes | 2000 | Aircraft, fast flankers, anything inside 250 while deployed | Gruff, grizzled; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Future Tank X-1 (Uprising) | 3000 / 30 s | 3000 / Adv. tank | 45 | Neutron disruptor 260 ×2 per 6.1 s, range 250, wave spreads to radius 180 (25% vs infantry, 100% vs all armour) | **Riot Beam** (activated, CD 15 s): sweeping lasers, 1500 + 750 HE along lines, 30% vs infantry | T3 + High Tech | No | 3000 | HE artillery/bombers (×2.5), Tesla, Terror Drones, infantry swarms (25% dmg) | Synthetic, deadpan AI voice; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| MCV | 5000 / 60 s | 5000 / Support | 50 | Unarmed; crushes (30) | **Deploy** → Construction Yard (2 s) | T1 | Yes | fixed 10000 | Everything at T2+ | Stolid driver; Sel, Mv, Sec |

### B.4 Allied aircraft (Airbase; need pads to rearm — a jet with no pad slowly loses HP)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|
| Vindicator | 1200 / 15 s | 350 (437 w/ Aeronautics) / Aircraft | 180 | 2 (3) laser-guided bombs 120 HE, AoE 10; reload at base 10 s (7 s); 50% vs Cores/commandos | **Return to Base** (activated): +25% speed home (was 50% before 1.08) | T1 | 1200 | AA of any kind, Apollo/MiG/Tengu | Cool, clipped strike pilot; Cr, Sel, Mv, Atk, Cbt, UF, RTB, Dn |
| Apollo Fighter | 1000 / 10 s | 300 (375) / Aircraft | 225 (281 RTB) | 20 mm autocannon 20 AC, 90-round clip, range 200 (100 DPS; 50% vs MiG/Apollo; 125% vs Kirov/Century); air-only | **Return to Base** | T1 | 1000 | Ground AA, numbers of Tengu, Flak | Cocky ace fighter-jock; Cr, Sel, Mv, Atk, Cbt, UF, Dn |
| Cryocopter | 1600 / 15 s | 650 (812) / Aircraft (750 before 1.11) | 150 | Freeze beam 75 (100) freeze/s, range 150 — slows then freezes; frozen things shatter in one hit | **S.H.R.I.N.K. Beam** (activated, CD 10 s / 7.5 s): shrinks one vehicle for 20 s (24 s) — see A.9 | T2 | 1600 | Any AA; it has no damage of its own | Nerdy, excited scientist; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Century Bomber | 2000 / 20 s | 1000 (1250) / Bomber | 150 | 6 (9) bombs 250 HE, AoE 25, knock-down; reload 15 s (10 s); carries 5 infantry | **Paradrop** (activated, CD 10 s): drops passengers by parachute | T3 | 2000 | Fighters, Flak/Hydrofoil/Striker, Rocket Angels | Steady veteran bomber captain; Cr, Sel, Mv, Atk, load/paradrop, UF, Dn |
| Harbinger Gunship (Uprising) | 3600 / 40 s | 5000 / Gunship | 120 | Collider cannon 2×100 HE per shot ×12, range 50–400, AoE 50 (100 DPS, 50% vs inf.); never lands/rearms | **Chain Gun** (toggle): 12 AC ×10, range 300 (80 DPS, 50% vs buildings) / **Collider Cannon** mode | T3 + Defense Bureau | 3000 | Massed AA (Flak ×1.5, AC ×2), Apollo/MiG/Tengu, Rocket Angels | Grizzled gunship commander; Cr, Sel, Mv, Atk, Cbt, UF, Sec, Dn |

### B.5 Allied navy (Seaport)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Dolphin | 750 / 10 s | 300 / Anti-ship scout (Flak 200%, Gun 20%) | 150 | Sonic burst 50 Torpedo, range 100, line AoE, 1 s cycle (50 DPS); detects subs | **Jump** (activated, CD 20 s): leaps clear of torpedoes (but AA can hit it mid-air) | T1 | No | 750 | Bullfrog/Hydrofoil flak, Stingray Tesla surge, Yari spam | Dolphin clicks/squeaks; Sel, Mv, Atk, Sec |
| Hydrofoil | 900 / 10 s | 400 / Naval | 125 | Icarus 20 mm 15 AC per 0.13 s, range 300, air only (112 DPS; heroic bug 2.5× → 280) | **Weapon Jammer** (toggle): disables one non-infantry target's weapons while beamed | T1 | No | 900 | Any surface warship/sub (no anti-ship gun), Tsunami, Stingray | Laid-back surfer-dude skipper; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Assault Destroyer | 1500 / 20 s (1800 pre-1.08) | 1200 / Allied anti-ship T2 (AC 25%, Torpedo 50%) | 50 / 75 | Gauss cannon 120 Cannon, range 150, AoE 20, 2 s cycle (60 DPS); depth charges vs subs | **Black Hole Armour** (toggle): cannot fire; attracts all incoming projectiles within 200 and takes −35% damage (25% before 1.11) | T2 | Yes | 1800 | Akula ultra-torps, Shogun, Yari swarms, Rocket Angels/Twinblades, Tesla | Gravelly naval gunnery officer; Cr, Sel, Mv (land/water), Atk, Cbt, UF, Sec |
| Aircraft Carrier | 2000 / 30 s | 1500 / Naval | 60 | 5 Sky Knight drones (150 HE bomb each, AoE 15; drone HP doubled 1.08, speed 225 after 1.11), launch range 200–1000, relaunch 10 s | **Blackout Missile** (activated, CD 60 s / 45 s HT): EMP radius 150 (200) disables vehicles/ships/structures 10 s (13 s); range 1000 | T3 | No | 2000 | Subs, Shogun ram, Naginata spread torps, air | Formal carrier captain; Cr, Sel, Mv, Atk, Cbt, UF, Sec |

---

## C. SOVIET UNION

### C.1 Soviet structures (place-then-build on site; ConYard queue + a second queue per Crusher Crane)

| Structure | Cost / BT | HP | Power | Prereq | Expansion range (cells) | Function / notes |
|---|---|---|---|---|---|---|
| Construction Yard | $5000 (MCV) / 2 s | 5000 | +50 | — | 32×31 (40×39 for Naval Yard placement) | 3×4; repacks to MCV; selling spawns a Combat Engineer |
| Reactor | $800 / 10 s | 1000 | +100 | — | 12×12 | 2×2 |
| Barracks | $500 / 10 s | 1250 | −25 | — | 13×13 | 3×3; selling any Soviet land building spawns Conscripts |
| Ore Refinery | $2000 / 20 s | 2500 | −50 | Reactor | 12×13 | 3×4 on node; builds Ore Collectors ($1400, 20 s) |
| War Factory | $2000 / 20 s | 3200 | −50 | Refinery | 16×16 | 4×4; vehicles; repairs vehicles |
| Naval Yard | $1000 / 20 s | 3200 | −50 | Refinery | 16×17 | 3×6 on shore; ships, Bullfrog, Sputnik, collector, MCV |
| Airfield | $1000 / 30 s | 1800 | −50 | Super Reactor | 18×18 | 4×6; 4 pads **(unverified count)**; MiGs/Twinblades/Kirovs |
| Super Reactor | $2000 / 30 s | 4000 | +350 (500 pre-1.11) | Refinery | 14×14 | 4×4; T2 gate; **explodes on death**: 1500 HE, radius 200, falloff to 300 |
| Battle Lab | $3000 / 30 s (BWiki data page lists 60 s) | 2000 | −75 | Super Reactor | 14×14 | 4×4; T3 gate |
| Crusher Crane | $1500 / 20 s | 1500 | −50 | ConYard | 12×12 | 2×2; second structure queue; repairs vehicles; "crush" (sell) a vehicle for 50% of its max-HP-scaled value; exploit fixed 1.06; multiple allowed |
| Sentry Gun | $800 / 20 s | 625 (basic defence) | −25 | Reactor | — | 1×1, range 300: 40 AC ×5 per 1.5 s (133 DPS, 50% vs infantry — i.e. anti-light-vehicle as much as anti-infantry); offline at low power |
| Flak Cannon | $800 / 20 s | 2000 (basic defence) | −25 | Reactor | — | 1×1, range 300, air only: 25 Flak ×5 per 1.25 s (100 DPS), AoE 20 |
| Tesla Coil | $1500 / 30 s | 2000 (adv. defence) | −75 | Super Reactor | — | 1×1, range 350: 450 Tesla after 2.5 s aim, 3.1 s cycle (145 DPS); **Tesla Trooper/Stingray charge**: +200% damage for 0.75 s per zap and fires even with no/low power |
| Iron Curtain | $1500 / 30 s | 5000 | −75 | Battle Lab | 10×11 | see A.11 |
| Vacuum Imploder | $2500 / 30 s | 5000 | −75 | Battle Lab | 10×11 | see A.11 |
| Wall | $10 / 5 s | 300 | 0 | — | — | as Allied |
| Outpost (from Sputnik) | $1200 / deploy | **(unverified)** | 0 | — | extends build radius | cannot repack |
| Combat Bunker (from Combat Engineer) | $500 / 10 s | 1500 (main structure) | 0 | Combat Engineer | — | 1×1, holds 5 infantry; immune to Peacekeeper/Warrior garrison-clearing; "Evacuate" |
| Reaper turret (Uprising, from Reaper) | — / 0.1 s | 900 (basic defence) | 0 | Reaper | — | the legless Reaper; keeps both weapons; cannot move again |

### C.2 Soviet infantry (Barracks)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| War Bear | 225 / 2 s | 150 / Soviet scout inf. | 85 (swims) | Claws 200 Melee, range 20, 2 s cycle; infantry only; detects stealth radius 301 | **Amplified Roar** (activated, CD 60 s): paralyses infantry in radius 100 for 10 s (also Tesla Troopers) | T1 | Yes | 225 | Vehicles, Peacekeeper shield, shotguns | Growls/roars; Sel, Mv, Atk, Sec |
| Conscript | 100 / 4 s | 100 / Anti-inf. inf. | 50 | ADK-45 5 Gun ×3, range 150 (≈10 DPS; +25% in 1.08) | **Molotov Cocktails** (toggle): 15 HE (50 vs garrisons), range 60–200, AoE 15, ≈1.85 s cycle; clears garrisons | T1 | No | 100 | Anything; dies in 1–2 hits; Sickle/Tengu/Riptide | Naive, eager, heavily accented Russian recruit; Cr, Sel, Mv, Atk, Cbt, UF, Gar, Sec |
| Flak Trooper | 400 / 5 s (300 pre-1.11) | 100 / Anti-veh. inf. | 50 | Flak cannon 25 Flak, range 175 ground / 300 air, AoE 20, 1.1 s cycle (≈23 DPS); no alert bonus when garrisoned | **Magnetic Mines** (toggle): 200 Cannon per 2 s, range 20, vehicles/buildings only; detonates if he is crushed | T1 | No | 300 | Infantry, Sickle, dogs, snipers | Surly gulag convict; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Combat Engineer | 500 / 10 s | 50 / Inf. | 40 (inflatable boat) | Revolver 50 Gun, range 100, 3 s cycle (can't hit buildings); captures/repairs | **Construct Bunker** (activated, $500, CD 120 s, 10 s build): 1500-HP 5-man bunker | T1 | Yes | fixed 500 | Everything | Clipped military technician with Russian accent; Cr, Sel, Mv, capture, Sec |
| Tesla Trooper | 750 / 10 s | 200 / Soviet heavy AT inf. (Rocket/Cannon 10%, Spectrum 30%, Tesla 50%) | 50 | Tesla gun 100 Tesla, range 125, 0.5 s aim, 2.1–2.7 s cycle (≈40 DPS; pre-attack delay −1 s in 1.08); ignores Black Hole Armour; cannot be bitten by dogs/bears | **EM Disruptor** (toggle, 1 s wind-up): field radius 50 paralyses vehicles (and Terror Drones) — and himself; **Tesla Link**: charges friendly Tesla Coils (range 50) | T2 | No | 750 | Riflemen, Sickle, crushing (crushed 20 → tanks), aircraft, snipers, Imperial Warriors | Booming, metallic power-armour bass; Cr, Sel, Mv, Atk, Cbt, UF, Sec, charge-coil |
| Natasha Volkova | 2000 / 30 s | 300 / Commando | 60 (swims) | Sniper rifle 1000 Sniper, range 300, 2 s cycle, line AoE (kills a file of infantry); **laser designator**: range 50–300, calls a Badger bomber that destroys any vehicle/ship/building (99999 HE) after a delay (bomber can be shot down) | **Pilot Snipe** (activated, CD 60 s, 2 s): kills the crew of a vehicle; any infantry can then board it | T3 | Yes | 2000; limit 1 | Dogs/bears, Tesla, anti-infantry vehicles, AA vs her bomber | Sultry, ice-cold femme-fatale; Cr, Sel, Mv, Atk, designate, Cbt, UF, Sec |
| Desolator Trooper (Uprising) | 1500 / 15 s | 900 / Desolator inf. (Radiation 0%) | 50 | Toxin sprayer 15 Rad + 10/0.25 s burn, range 225, line AoE 25 (≈260 DPS vs infantry) | **Splash Mode** (toggle): corrosive spray 22 Rad + 10 HE per 1 s, range 50, slows target 50%, 50% vs infantry — anti-vehicle mode | T3 (Battle Lab) | No | 1500 | Tesla (×10), heavy vehicles at range, aircraft | Wheezing, menacing hazmat sadist; Cr, Sel, Mv, Atk, Cbt, UF, Sec |

### C.3 Soviet vehicles (War Factory; Collector/Sputnik/Bullfrog/MCV also at Naval Yard)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Ore Collector | 1400 / 20 s | 500 / Collector | 50 | Unarmed | **Reactive Armour** (toggle): takes 25% damage, slower, cannot load/unload | T1 | Yes | 1400 | AT weapons, Terror Drones (ignore armour) | Dour trucker; Sel, Mv, Sec |
| Sputnik | 1200 / 20 s | 500 / Support | 50 | Unarmed | **Deploy** → Outpost | T1 | Yes | 1200, no ranks | Everything | Scientific-sounding driver; Sel, Mv, Sec |
| Terror Drone | 600 / 5 s | 50 / Soviet scout veh. (Tesla ×100, Impact ×2) | 150 / 125 | Infantry claw 20,000 Sniper, range 50 (instant kill, 1 s); **vehicle infestation**: enters a vehicle and deals 50 HE/2 s from inside until it dies or is repaired out (Crusher Crane/War Factory/Mecha Bay/Engineer tent) | **Electro-Stasis Ray** (toggle): range 300, target vehicle cannot move/turn (can still fire) | T1 | Yes | 600 | Tesla Troopers/Stingray surge, Sickle/Tengu/Riptide AC, dogs can't bite it, repair bays | Electronic chitters/beeps; Sel, Mv, Atk, Sec |
| Sickle | 900 / 10 s | 450 / Light veh. | 100 | 3 chain guns 5 AC ×5 each, range 150 (≈37 DPS total) | **Flea Jump** (activated, CD 10 s): leaps 20–300 yd over cliffs/walls; landing 80 Melee, AoE 50, knocks down infantry | T1 | No | 900 | Tanks, Javelins/Tankbusters (crush level 0 — can't crush), Tesla | Gruff, gleeful pilot who relishes the "harvest"; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Bullfrog | 900 / 10 s | 300 / Support | 100 / 100 | Flak 15 Flak per 0.2 s, range 300, AoE 15 (75 DPS); air only | **Man-Cannon** (activated, CD 10 s): fires passengers (5) up to 1000 yd by parachute | T1 | Yes | 900 | Anything AT, Stingray, Tsunami, Hydrofoil | Hyper-enthusiastic Russian trooper; Cr, Sel, Mv, Atk, load, Sec, UF |
| Hammer Tank | 1000 / 10 s | 550 / Tank | 75 | 85 mm 35 Cannon, range 150, 0.8–1.2 s cycle (≈32 DPS) | **Leech Beam** (toggle): range 300, 20 "magic" dmg/s to vehicles/ships/buildings, heals itself the same; cannot move while leeching (1.11); when the target dies the Hammer **permanently gains its weapon** as a third gun (≈25 possible: Tesla coil, Wave-Force, Oni beam, Carrier Sky Knight, Athena…) | T2 | No | 1000 | Assault Destroyer, Apocalypse, King Oni, Rocket Angels, Cryo | Boastful, hammer-pun-loving crewman; Cr, Sel, Mv, Atk (cannon), Atk (leech), Cbt, Ret, UF |
| V4 Rocket Launcher | 1200 / 15 s | 400 / Artillery | 50 | Precision V4 500 HE, range 200–500, AoE 40, 6–7 s cycle (≈77 DPS); must stop to fire; knocks infantry down | **Multi-Warhead** (toggle): 10 × 100 HE cluster, AoE 25 (≈155 DPS vs clusters) | T3 | No | 1200 | Anything inside 200, aircraft, fast raiders | Dry Russian rocketeer; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Apocalypse Tank | 2000 / 20 s | 3000 / Adv. tank (HE ×2.5) | 50 | Twin 125 mm Drakon 100 Cannon ×2 per 2.5 s (80 DPS); heroic: 156 HE ×2, AoE 15, range 175 (≈141 DPS); regen 4 HP/s; crush 30 | **Magnetic Harpoon** (toggle): range 300, 25 HE/0.25 s, drags lighter vehicles into its **grinder treads** (999,999 crush) or pulls itself to heavier ones; with Grinder Treads protocol heals 50% of victim's max HP | T3 | No | 2000 | HE bombers/artillery (×2.5), Natasha, Terror Drones, Spy bribe, Cryocopter | Deep, slow, intimidating Soviet bass; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Reaper (Uprising) | 1200 / 10 s | 600 / Light veh. | 80 | 3 grenade launchers 15 HE ×3 (150% vs infantry) + rocket pod 7 Rocket ×10 (500% vs air), range 20–225 | **Prototype Jump** (activated, CD 10 s): leaps like Sickle, but on landing becomes an immobile **Reaper turret** (900 HP) | T2 | No | 1200 | Tanks, Tesla, AT infantry | Over-confident test pilot; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Grinder (Uprising) | 1600 / 15 s | 1200 / Adv. tank | 60 / 50 | Grinder treads 30 HE per 0.24 s at contact (125 DPS); crush 60 — crushes **any** vehicle incl. tanks; crush paralyses victim 1 s and heals 1% of victim max HP per hit | **Turbo Boost** (activated, CD 10 s): ×2 speed for 5 s | T2 + Crusher Crane | Yes | 1600 | HE/artillery, aircraft, kiting; Shogun/Giga at sea | Maniacal grinding-mill driver; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Mortar Cycle (Uprising) | 600 / 10 s (built at **Barracks**) | 300 / Mortar-cycle | 150 | Sidecar Molotovs 24 HE, range 40–210, AoE 30 (≈22 DPS) | **Mortar** (toggle): 100 HE per 4 s, range 150–330, AoE 50 (25 DPS), clears garrisons | T1 (needs War Factory) | No | 600 | Anything that catches it; Sickle, dogs, Tengu | Rowdy biker thug; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| MCV | 5000 / 60 s | 5000 / Support | 50 | Unarmed, crush 30 | **Deploy** → ConYard | T1 | Yes | fixed 10000 | — | Stolid driver; Sel, Mv, Sec |

### C.4 Soviet aircraft (Airfield)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|
| MiG Fighter | 1000 / 10 s | 240 (200 pre-1.11) / Aircraft | 210 (262 RTB; 225 pre-1.08) | Flak missiles 95 Flak ×16, AoE 20, range 200 (95 DPS; 200% vs Kirov, 50% vs MiG/Apollo); air-only; rearm 10 s | **Return to Base** (+25% speed) | T2 (Airfield needs Super Reactor) | 1000 | Ground AA, Apollo 1v1 (slightly), Hydrofoil jammer | Arrogant Russian ace; Cr, Sel, Mv, Atk, Cbt, UF, RTB, Dn |
| Twinblade | 1200 / 15 s | 500 (600 pre-1.08) / Aircraft | 150 | MG 5 AC ×6 (≈27 DPS) + 8 rockets 25 Rocket, AoE 20, 8 s reload (≈27 DPS; 25% vs collectors); never needs to land; carries 5 infantry **or** sling-loads one vehicle | **Unload** (activated): drops cargo | T2 | 1200 | Apollo/MiG/Tengu, Flak, Javelins, Hydrofoil | Gruff gunship pilot; Cr, Sel, Mv, Atk, Cbt, UF, load, Dn |
| Kirov Airship | 2500 / 30 s | 6000 / Aircraft (×2 from MiGs) | 30 (55 boosted) | Bombs 400 HE every 0.9–1.1 s, AoE 50 (≈400 DPS); regen 4 HP/s; crash does heavy damage **(value unverified)** | **Gastroburners** (toggle): speed 55 at −200 HP/s | T3 | 2500 | Fighters (MiG ×2), Apollo, Flak/Striker/Hydrofoil, Rocket Angels | Slow, ominous "Kirov reporting" gravitas; Cr, Sel, Mv, Atk, Cbt, UF, Sec, Dn |

### C.5 Soviet navy (Naval Yard)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Stingray | 1000 / 10 s | 450 (360 pre-1.11) / Naval | 50 land / 100 water | Twin Tesla 40 Tesla ×2, range 125, 1.75–2 s cycle (≈43 DPS); charges Tesla Coils | **Tesla Surge** (activated, CD 60 s, water only): 200 Tesla to everything in radius 175, clears Terror Drones off friendlies, stuns | T1 | Yes | 1000 | Hydrofoil (jammer), torpedo units, Tsunami, aircraft | Crackling, zealous electro-sailor; Cr, Sel, Mv (land/water), Atk, Cbt, UF, Sec |
| Akula Sub | 1800 / 20 s | 1250 / Adv. ship (Cannon 50%, Torp 50%) | 75 | 2 torpedoes 140 Torpedo per 3.5 s, range 150, AoE 15 (80 DPS); submerged except when firing | **Ultra-Torpedoes** (activated, CD 60 s): 2 unguided straight-line torps, 300 HE each tapering to 100 (400 pre-1.08), range effectively unlimited, fired submerged | T2 | No | 1800 | Dolphins, Hydrofoil, Riptide depth charges, Assault Destroyer, Yari | Terse submariner; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Dreadnought | 2000 / 30 s | 1500 / Naval | 50 | 3 Molot V4 rockets 200 HE, range 200–750, AoE 40, 7.5–8.5 s cycle (≈75 DPS); unguided | **Sacrifice Launchers** (toggle): ×3 fire rate at −50 HP/s; **Safe Mode** reverts | T3 | No | 2000 | Subs, Dolphins, aircraft, anything inside 200 | Grim battleship commander; Cr, Sel, Mv, Atk, Cbt, UF, Sec |

---

## D. EMPIRE OF THE RISING SUN

### D.1 Imperial structures (every one is a Nanocore from the ConYard; core cost = structure cost, core BT 4 s, then unpack time shown; cores can unpack anywhere)

| Structure | Cost / unpack | HP (T1/T2/T3 where upgradable) | Power | Prereq | Function / notes |
|---|---|---|---|---|---|
| Construction Yard | $5000 (MCV) / 2 s | 4000 | +50 | — | 4×4; builds Nanocores only; cannot be repacked |
| Instant Generator | $800 / 10 s | 1250 | +100 | — | 3×3 (cost 1000 before 1.08) |
| Instant Dojo | $500 / 8 s | 1000 / 1250 / 1562 | −25 | — | 3×3; infantry; **Nanotech Upgrade** $500 (needs Refinery) → Shinobi, Rocket Angel; **Breakthrough** $750 (needs Mainframe) → Yuriko (was 750 for the core pre-1.08) |
| Ore Refinery | $2500 / 20 s | 2000 | −50 (55 pre-1.05) | Generator | 3×4 on node; builds Collectors ($1400); sells for $550 |
| Mecha Bay | $2000 / 16 s | 2500 / 3125 / 3906 | −50 | Refinery | 4×4; vehicles & mechs; repairs; Upgrade $750 → Tsunami, Striker-VX; Breakthrough $1000 → King Oni, Wave-Force |
| Imperial Docks | $1000 / 18 s | 2500 / 3125 / 3906 | −50 | Refinery | 3×5 shore; Upgrade $750 → Sea-Wing, Naginata; Breakthrough $1000 → Shogun, Giga Fortress |
| Nanotech Mainframe | $2500 / 30 s (3000 / 16 s pre-1.08) | 2000 | −75 | Refinery | 4×3; enables Breakthroughs, Wave-Force Tower, Nanoswarm, Decimator |
| Defender-VX | $800 / 15 s (halved 1.08) | 1000 (basic defence); core 200 HP | −25 | Refinery | 1×1, range 300; **Defender mode**: 15 AC ×8 (≈68 DPS) ground; **Anti-Air mode**: 20 Rocket continuous (100 DPS), smart target-switching; mode swap 2 s (15 s pre-1.08) |
| Wave-Force Tower | $1400 / 40 s | 1500 (adv. defence) | −75 | Mainframe | 2×2, range 350: 350 HE line beam after 3 s charge (490 if pre-charged), 3 s cycle (≈109 DPS); **Early Discharge** fires immediately |
| Nanoswarm Hive | $1500 / 26 s | 4000 | −75 | Mainframe | see A.11 |
| Psionic Decimator | $2500 / 26 s | 4000 | −75 | Mainframe | see A.11 |
| Wall | $10 / 5 s | 300 | 0 | — | as others |
| Nanocore (generic) | = structure / 4 s build | 400 (VX core 200) / Nanocore armour | — | per structure | speed 65 (defence cores 60), amphibious, reverses on land; explodes with Honorable Discharge; Vindicators do only 50% to it (1.05) |

### D.2 Imperial infantry (Instant Dojo)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Burst Drone | 300 / 5 s | 100 / Jap. scout inf. (flies) | 125 | Attaches to an enemy vehicle: −50% speed, blocks other attachments; detects stealth radius 300 | **Self-Destruct** (activated, 3 s fuse): 200 HE (250 w/ Honorable Discharge), AoE 20 (25); 75%/50% vs collectors, 40% vs cores | T1 | n/a (air) | fixed 150 | Any AA, Flak/AC; dies instantly if frozen | Electronic chirps; Sel, Mv, Atk, Sec |
| Imperial Warrior | 150 / 5 s | 160 / Anti-inf. inf. | 50 (75 charging) | Carbine 8 Gun ×5, range 150 (≈13 DPS) | **Banzai Charge** (activated, CD 30 s, 10 s): beam katana 300 Melee, range 20 (≈265 DPS vs infantry), +50% speed, un-suppressable, clears garrisons | T1 | No | 150 | Riptide/Sickle/Tengu AC, dogs/bears (until charging), shotguns at range | Honour-bound samurai zeal; Cr, Sel, Mv, Atk, Cbt, UF, Sec, Gar |
| Tankbuster | 300 / 5 s | 100 / Anti-veh. inf. | 50 | Plasma cutter 60 Rocket, range 175, ≈1.3–1.7 s cycle (≈40 DPS); ground only | **Spider Hole** (toggle, 0.5 s): burrows — 5% from almost everything, cannot be crushed or stunned, cannot fire | T1 | No | 300 | Infantry, Sickle, aircraft (no AA), dogs when surfaced | Eccentric, giggling straw-hatted technician; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Engineer | 500 / 10 s | 50 / Inf. | 40 (60 sprinting) | None; captures/repairs | **Sprint** (activated, CD 60 s): +50% speed 10 s, then exhausted (idle ~7–10 s) | T1 | Yes | fixed 500 | Everything | Meek, apologetic clerk; Cr, Sel, Mv, capture, Sec |
| Shinobi | 1000 / 10 s | 200 / Inf. | 75 (swims) | Shuriken 250 Sniper, range 35–150, 1.1 s cycle (227 DPS, one-shots infantry); katana 500 Melee, range 25; stealthed while idle; infiltrates buildings like a Spy (no disguise/bribe) | **Smoke Bomb** (activated, CD 120 s): untargetable by auto-fire 10 s, 0.5 s invulnerability | T2 (Dojo upgrade) | Yes | 1000 | Dogs/bears/drones, Riptide/Sickle, Tesla | Hushed, honour-driven assassin; Sel, Mv, Atk, infiltrate, Sec |
| Rocket Angel | 900 / 10 s | 400 / Aircraft (flying infantry) | 100 | Photon rockets 20 Rocket ×12 (18 w/ Adv. Rocket Pods), range 150, ≈2.5 s cycle (≈95–123 DPS) vs ground & air | **Paralysis Whip** (toggle): range 250, holds one ground vehicle immobile and weaponless while beamed; no damage | T2 | n/a | 900 | Flak, Apollo/MiG, Hydrofoil, Javelins, Bullfrog | Bubbly, giggling jet-pack girl; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Yuriko Omega | 2000 / 30 s | 350 / Commando | 70 (hovers over water) | Psychokinesis: lifts ground target and drains 4% max HP per 0.13 s (≈30%/s → ~3 s kill); aircraft are **slammed** to the ground (500 Sniper, AoE 250, kills infantry below); buildings disabled & damaged | **Psychokinetic Burst** (activated, CD 30 s, 2 s): kills all infantry around her, knock-back | T3 (Dojo Breakthrough) | Yes | 2000; limit 1 | Tesla Troopers (one zap), Terror Drones & fast swarms, massed air, defence towers | Soft, unsettling schoolgirl flipping to rage; Sel, Mv, Atk, Cbt, UF, Sec, Gar, low-health |
| Archer Maiden (Uprising) | 500 / 5 s | 200 / Inf. | 60 | Energy bow 60 Gun, range 200 (ground & air), 3.8 s cycle (≈16 DPS single-target) | **Dense Volley** (activated, CD 10 s): arrow bursts into spikes, 20 AC to infantry in radius 60, cast range 100–300 | T1 | No | 500 | Vehicles, dogs/bears, Sickle | Serene, formal court-archer; Cr, Sel, Mv, Atk, Cbt, UF, Sec |

### D.3 Imperial vehicles and mechs (Mecha Bay; Collector/MCV also at Docks)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Ore Collector | 1400 / 20 s | 500 / Collector | 50 | — | **Self-Defence System** (toggle, 3 s): flips hold to expose MG 4 AC per 0.1 s, range 150 (40 DPS), stops harvesting | T1 | Yes | 1400 | AT weapons, Terror Drones | Polite salaryman; Sel, Mv, Sec |
| Sudden Transport | 500 / 5 s | 400 / Sudden Transport (×1.5 from AT) | 100 | None; 5 infantry; auto-**Disguise** as any mobile unit seen (even enemy); explodes 250 HE on death | **Unload** (activated): drops passengers, breaks disguise | T1 | Yes | 500 | Detection (dogs/bears/drones), any AT fire once revealed | Sneaky, whispering smuggler; Cr, Sel, Mv, Atk(none), load/unload, UF |
| Mecha Tengu / Jet Tengu | 800 / 10 s | 350 / Light veh. (mecha) ↔ 350 / Fighter (jet) | 100 land / 80 water (hover) ↔ 200 air | **Mecha**: AC 4 ×8, range 150 (≈26 DPS; heroic bug 2.5× → 66) vs ground; **Jet**: AC 23 per 0.2 s, range 200 (115 DPS; 30% vs fighters), air-only; 15→23 dmg in 1.05 | **Transform** (activated, CD 15 s): mecha ↔ jet; jet never needs to land | T1 | Yes (hover) | 800 | Mecha: tanks, Tankbusters, Tesla; Jet: Apollo/MiG 1v1, ground AA | Brash, cocky "Tengu!" pilot; Cr, Sel (both modes), Mv (both), Atk (both), Cbt, Ret, UF, Dn (jet) |
| Tsunami Tank | 1000 / 10 s | 380 / Tank | 75 / 75 (94 shielded) | 20 Cannon per 0.54 s, range 150 (37 DPS) | **Nano Deflectors** (activated, CD 30 s, 10 s): halves damage, regen 15 HP/s, +25% speed | T2 (Bay upgrade) | Yes | 1000 | Hammer/Guardian 1v1, Tankbusters/Javelins, aircraft, T3 crushers | Proud samurai-tanker; Cr, Mv (land/water), Atk, Cbt, UF, Sec |
| Striker-VX / Chopper-VX | 1200 / 10 s | 400 / Support ↔ 400 / Aircraft | 85 ↔ 120 | **Striker** (ground): AA rockets 25 ×3 (6 w/ Pods), range 300 (68–88 DPS), air-only; **Chopper** (air): ground rockets 25 ×5 (6), range 150 (83–102 DPS; 25% vs collectors/refineries) | **Transform** (activated, CD 15 s) | T2 | No | 1200 | Striker: tanks/AT infantry; Chopper: fighters, any AA (it has no AA in the air) | Terse mech pilot; Sel (both), Atk (both), Cbt, UF, Dn (chopper) |
| King Oni | 2000 / 20 s | 3000 (2250 pre-1.11) / Adv. tank | 65 | Eye beams 175 Cannon, 0.75 s aim, 1.75 s cycle, range 150 (100 DPS); melee stomp 10 + knock-down, 135° arc; crush 20 | **Bull Rush** (activated, CD 60 s, 5 s → 4 s): charges at speed 170, crush 31 — flattens vehicles (500+50 HE impact, 1.5 s delay); explodes if shrunk | T3 (Bay Breakthrough) | No | 2000 | Apocalypse 1v1, Natasha pilot-snipe, Spy bribe, Terror Drones, Tesla EM, HE bombers, Cryocopter shrink | Guttural, roaring oni-masked pilot; Sel, Mv, Atk, Cbt, UF, Sec |
| Wave-Force Artillery | 1800 / 15 s | 500 / Artillery | 60 | Wave-Force beam up to 750 HE after 4 s charge, range 200–500, line AoE width 5 (≈136 DPS), fires over terrain; damage scales linearly with charge time | **Force Fire / Early Release** (activated, CD 1 s): fires immediately at current charge | T3 | No | 1800 | Anything inside 200, air, fast raiders | Calm, almost meditative gunner; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Steel Ronin (Uprising) | 1600 / 15 s | 1500 / Sentinel (Rocket/Flak ×1.5) | 110 | Laser naginata 100 Cannon sweep, 75° arc to 105 yd, 2.4 s cycle (≈42 DPS, knock-down) | **Shockwave** (activated, CD 15 s): 100 HE wave travels 300 yd (50% vs infantry) | T2 | No | 1600 | Rockets/Flak (×1.5), Javelins/Tankbusters, kiting tanks, aircraft | Vengeful, tormented warrior-spirit; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| MCV | 5000 / 60 s | 5000 / Support | 40 | Unarmed, crush 30 | **Deploy** → ConYard | T1 | Yes | fixed 10000 | — | Formal driver; Sel, Mv, Sec |

### D.4 Imperial navy (Imperial Docks)

| Unit | Cost/BT | HP / Armour | Spd | Primary | Secondary | Tier | Amph | Vet | Counters | Voice |
|---|---|---|---|---|---|---|---|---|---|---|
| Yari Mini-Sub | 800 / 10 s | 400 / Submarine (Fleet: −25% dmg) | 125 (156) | Torpedo 50 Torpedo, range 150, ≈1.1 s cycle (≈45 DPS); submerged until firing | **Last Voyage** (activated, 0.5 s): kamikaze ram 500 HE (650 w/ Honorable Discharge), AoE 25 (50), range 300; 50% vs collectors | T1 | No | 800 | Dolphins, Hydrofoil, Riptide, Stingray surge, Akula | Fervent, death-before-dishonour crewman; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Sea-Wing / Sky-Wing | 1100 / 10 s | 400 / Naval ↔ 400 / Aircraft | 125 (156) ↔ 150 (187) | **Sea-Wing** (submerged): AA rockets 25 ×4 (6), range 300 (75–102 DPS), air-only; **Sky-Wing**: MG 5 AC per 0.13 s, range 200 (37 DPS; 50% vs collectors/refineries) | **Transform** (activated, CD 15 s): surfaces and flies / dives | T2 (Docks upgrade) | No | 1100 | Sea: torpedo units; Sky: any AA, fighters | Cool female pilot; Sel (both), Mv, Atk, Cbt, UF, Sec, Dn (sky) |
| Naginata Cruiser | 1800 / 18 s | 1200 (1400 pre-1.11) / Adv. ship | 85 (106) | Torpedoes 60 Torpedo ×2 per 1.5 s, range 150, AoE 10 (80 DPS); anti-sub | **Type-S Torpedo** (activated, CD 60 s): fan of 5 torpedoes 15 Torpedo each, unlimited range in a straight line (damage halved 1.11) | T2 | No | 1800 | Dolphins, Assault Destroyer, aircraft, Hydrofoil, Stingray surge | Stern cruiser captain; Cr, Sel, Mv, Atk, Cbt, UF, Sec |
| Shogun Battleship | 2200 / 22 s | 1500 (2000 pre-1.08) / Naval | 50 (62; 75 pre-1.11) | 6 guns: 3 × 150 HE per turret per 7.8–8.8 s, range 200–750, AoE 15 (≈55 DPS/turret; ROF −40% in 1.11), heavy suppression | **Ramming Speed** (activated, CD 120 s, 5 s): fixed course, guns off, crush 40 — splits any ship (ram 500 HE); a point-defence shield auto-triggers at low HP | T3 (Docks Breakthrough) | No | 2200 | Harbinger/Century/Twinblades, Akula packs, Terror Drones, Cryocopters, anything inside 200 | Formal, stoic admiral with Japanese commands; Sel, Mv, Atk, Cbt, UF, Sec |
| Giga Fortress (Uprising) | 6300 / 20 s | 5000 / Jap. fortress | 40 sea / 30 air | **Sea mode**: rocket pods 25 Rocket ×8 (11), range 300 ground/air (≈75 DPS) + artillery 75 Cannon ×4, range 400 (50 DPS); **Sky Fortress mode** ("God's Breath"): 16-node siege blast 250 HE each, range 100–600, AoE 25 (50% vs structures) — up to 4000 per 4 s on a single target; vision ×1.47 | **Transform** (activated, CD 15 s): sea ↔ sky; crash 750 HE (1000 w/ Discharge) | T3 | No | 6300 | Massed AA in sky mode (Apollo/MiG/Flak), subs/Dolphins at sea, Tesla, cost (one loss = a base) | Booming, theatrical demon-head; Sel, Mv, Atk (both modes), Cbt, UF, Sec |

---

## E. UPRISING ADDITIONS

### E.1 New units (all stats in B–D)

| Faction | Unit | Role | Design intent |
|---|---|---|---|
| Allies | Cryo Legionnaire | T2 heavy infantry | Walking Cryocopter: freeze-and-shatter infantry/light vehicles, jump over walls; answers the Allied lack of a T2 anti-infantry foot unit |
| Allies | Pacifier FAV | T2 amphibious artillery | Mobile anti-infantry Gatling platform that deploys into long-range HE artillery (740 range) — Allies previously had no amphibious siege |
| Allies | Future Tank X-1 | T3 super-heavy | 3000-HP drone tank with neutron cannon + Riot Beam; Allied answer to Apocalypse/King Oni |
| Allies | Harbinger Gunship | T3 gunship | 5000-HP orbiting gunship that never lands; two weapon modes |
| Soviets | Desolator Trooper | T3 heavy infantry | 900-HP radiation sprayer; anti-infantry beam or anti-vehicle corrosive mode; immune to radiation |
| Soviets | Reaper | T2 walker | Heavier Sickle with grenades + AA rockets; its jump leaves it as a permanent turret |
| Soviets | Grinder | T2 amphibious | A Crusher Crane on treads: crush-anything roller (crush 60) with Turbo Boost |
| Soviets | Mortar Cycle | T1 (Barracks) | 150-speed harasser; Molotovs or deployable mortar; garrison-clearer |
| Empire | Archer Maiden | T1 infantry | Cheap dual-purpose AA/anti-infantry archer, fills the Empire's early AA gap |
| Empire | Steel Ronin | T2 mech | Melee anti-armour samurai mech with Shockwave; counters tank balls |
| Empire | Giga Fortress | T3 naval/air | 6300-credit fortress ship that transforms into a flying demon head with a map-levelling beam |

Uprising has **no multiplayer**; new units exist in the Uprising campaigns, Skirmish vs AI and Commander's Challenge. The expansion also shipped additional skirmish maps and the Uprising-only AI "Red Alert button" (A.10).

### E.2 Campaigns

Four mini-campaigns, 13 missions: **Soviets** (4 — Dasha's resistance against FutureTech occupation), **Allies** (3 — hunting Soviet remnants, uncovering FutureTech's Sigma Harmonizer), **Empire** (3 — Prince Tatsu restoring the Empire against the Allied occupation and Shinzo's rebels), **Yuriko** (3).

### E.3 Yuriko's campaign mechanics

Single-hero "action RPG" missions ("The Traceless Massacre" — escape from Detention Camp Dakota and sink two carrier groups; "Ruin and Reunion" — destroy the Shiro Sanitarium's defences including two Giga Fortresses, confront Dr Shimada, then fight and kill her sister Izumi). No base, no economy: the player controls only Yuriko (plus freed/dominated infantry), with a hotbar of four psionic powers that grow in rank (I/II/III) as the missions progress:

| Power | Effect |
|---|---|
| Psychokinetic Burst | Shockwave kills nearby infantry, knocks units back; in the campaign also stuns vehicles and structures |
| Psychic Domination | Mind-controls enemy infantry (including Rocket Angels) permanently |
| Psionic Shield | Reflects incoming fire back at the attackers for a short time |
| Psionic Slam | Throws objects, vehicles and infantry at targets; she must stand still |

Her basic attack (lift-and-crush, ~3 s per ground unit; aircraft are dragged down) is unchanged from RA3; the campaign's threat comes from Tesla weapons (one-hit kills), Terror Drones, AA-capable swarms and towers. Yuriko clones (without Burst) appear as enemies, and the finale introduces Izumi as a boss-class psychic.

### E.4 Commander's Challenge

* 50 challenges on a world map against nine commander AIs (the campaign officers: Fuller, Price, Winters; Vodnik, Moskvin, Agonskaya; Nagama, Tenzai, Shirada), hosted by FutureTech's Kelly Weaver. 13 **main** challenges gate the ending; 37 **side** challenges unlock units and more challenges.
* The player is a FutureTech commander with all three MCVs: pick any faction per challenge; only basic tech is available at first, and each win **unlocks a unit or structure permanently** (e.g. beating a Shogun-spam challenge unlocks the Shogun for you).
* Each challenge has a **par time**; beating par adds 2% to the completion gauge, finishing without par adds 1%; 100% = every challenge under par. Three stars on the menu for main-complete, side-complete and 100%.
* Challenges impose special rules (opponent spams one unit type, pre-built superweapons, no-power maps, map-wide Cryo, "Kill-A-Ton" Kirov waves, etc.). Using the Red Alert button sets the time to 99:59, voiding par.
* Full list: Dead Meat; Blood Feud; Defense of the Archipelago; Where Satellites Go to Die; Symphony of Steel; Athena's Wrath; Scavenger; Offshore Killing; Chrono You Didn't; Tesla's Castle; Double-Barreled; Out of the Blue; Fury of the Empire; Creeping Death; Crate and Red Barrel; Are You Experienced?; Caught in the Crossfire; Dangerous Skies; All Guns Blazing; Two Sides to Everything; Ready to Roll Out; Dirty Tricks; Gosh Darn Mongolians!; Cat Fight; Number One Threat to America; No Place to Hide; High-Water Mark; Behind the Iron Curtain; Show of Force; No Match for the Guardian; Reap What You Sow; Kill-A-Ton; King of the Monsters; Your Gold Mine Has Collapsed; The Omega Program; Shrink Zone; Vicious Circle; Robots and Ninjas; Battle Royale; High Seas Duel; Superb Commander; Red Crush; Be Quick or Be Dead; Ice Breaker; The Final Countdown; Come and Get It; Arms Race; Battle Room; The Motherland; Future Warfare.

---

## F. FACTION DOCTRINE & FLAVOUR

| | Allies | Soviets | Empire of the Rising Sun |
|---|---|---|---|
| Visual identity | Clean, NATO-futurist: white/grey hulls, blue glass, sleek aerodynamic curves, hovercraft and jets; FutureTech corporate sheen | Brutalist industrial: riveted dark steel, red stars, Tesla arcs, hammer-and-sickle silhouettes, oversized treads, zeppelins | Neo-feudal high-tech: red-and-white lacquer, gold trim, origami-fold transforming mechs, pagoda roofs, drifting cherry blossom, anime mecha proportions |
| Default colour | Blue | Red | Gold / orange-yellow |
| Architecture | Low, modular, domed; Airbase with retracting pads; Spectrum Tower prism | Massive concrete, smokestacks, Super Reactor dome, lattice Tesla Coil | Everything unfolds from a Nanocore "egg"; shrines, torii-gate walls, floating Mainframe |
| Music (Frank Klepacki, James Hannigan, Timothy Michael Wynn) | Orchestral-electronic marches, heroic brass | "Soviet March" (Red Army choir pastiche), "Hell March 3", heavy guitar | Taiko, shakuhachi and koto over industrial electronica ("Enter the Shogun Executioner"); J-pop-tinged menus |
| Signature mechanics | Target Painter stacking, Chronosphere, Gap/Mirage ambushes, air micro, Prospector hubs | Tesla charging, Leech Beam, Crusher Crane second queue, Iron Curtain, Terror Drones, Sputnik expansion, Magnetic Harpoon | Transforming units (Tengu, VX, Sea-Wing, Giga), Nanocores anywhere, Banzai charge, Burst-Drone scouting, Nanoswarm, honourable self-destruct |
| Strengths | Best air force and air-to-ground (Vindicator/Cryocopter), strongest navy, cheapest flexible T1 (dog + Peacekeeper + Javelin), IFV versatility, Mirage/Athena late game | Toughest units per credit (Hammer 550 HP), best raw T1 vehicle (Sickle, Bullfrog), Tesla Troopers wreck tanks, Kirov/Apocalypse endgame, Soviet infantry cheapest, double structure queue | Fastest expansion and tech (no tech building for T2, 4-s cores), Tengu/VX dual-role mobility, Yari/Sea-Wing cheap navy, King Oni/Shogun/Giga brute force, best anti-infantry T1 (Warrior charge) |
| Weaknesses | Fragile vehicles (Guardian loses to Hammer/Tsunami), expensive aircraft that must rearm, weakest base defences early, Chronosphere kills own infantry | Slowest expansion (buildings rise on site, 60 s Battle Lab), no T1 anti-tank vehicle except Flak Trooper mines, air locked behind Super Reactor, Terror-Drone dependence, Kirov speed | Light armour everywhere (Tsunami 380 HP, Tengu 350), fragile 400-HP cores die to raids, no "real" T1 AA until Striker/Archer, Mainframe needed for every T3, Wave-Force/Oni are slow |
| Standard 1v1 openings (community) | Power → Boot Camp (dog scout + Peacekeepers) → Refinery → Refinery → Armor Facility; early Riptide+Peacekeeper harass or IFV/Javelin; "fast Heightened" into Guardians+Cryo; Multigunner Turret rush ("TR") on small maps | **Barracks → Reactor → Refinery → Refinery → War Factory** ("兵-电-矿-矿-重"): Bear scout, Conscripts to wall-in ore, Sickle/Terror Drone harassment, Bullfrog-cannon Flak Troopers vs air, Hammer+Tesla Trooper mid-game, Sentry/Flak tower rush variant | Dojo → Generator → Refinery → Mecha Bay → Refinery, Burst Drone scouts, Warrior+Tankbuster pressure, mass Tengu (ground/air swap vs Javelins/Flak), Yari harass on water maps, Bay upgrade into Tsunami/VX, Mainframe for Oni/Wave-Force |
| Matchup notes | vs Soviets: Javelin/IFV + Vindicators punish Hammer balls; watch Terror Drones on Prospectors. vs Empire: dogs vs Shinobi/Burst, Apollo vs Tengu swarms, Guardians lose to Tsunami shields early | vs Allies: Sickles kill Peacekeepers, Flak Troopers in Bullfrogs vs Vindicators, Tesla Troopers vs Guardians. vs Empire: Terror Drones vs cores and Tengus, Flak vs Rocket Angels, Hammer leech on Onis is useless | vs Allies: Tengu jets intercept Vindicators, Warriors shred Peacekeepers, Yari vs Seaport. vs Soviets: Tankbusters + Tsunami shield vs Hammers, Rocket Angels paralyse Apocalypses, Shinobi infiltrate Super Reactor |

---

## G. UI / HUD

* **Sidebar** (right edge, RA2 lineage): a column of tabs — Structures (incl. defences), Infantry, Vehicles, Aircraft, Naval, and **Top Secret Protocols** — above a scrolling icon grid. Clicking a tab shows the queue of the currently-primary production building of that type; a numeric badge on queued icons shows multiples (click left to add, right to remove). Structures build one at a time (Soviet Crusher Crane adds a second column; Empire cores can be queued freely because they are units). The ConYard tab also holds Clearance/upgrade buttons.
* **Protocol button**: top of the sidebar, ringed by the **threat meter**; number = unspent security points; opening it shows the three lines as a 3×3 grid with greyed-out higher tiers.
* **Command bar** (bottom): selected unit portrait, HP, rank chevrons, stance buttons (Aggressive/Guard/Hold Position/Hold Fire = Alt-A/S/D/G), and the **secondary-ability button** (default hotkey **F**) with its cooldown sweep; mode-switch secondaries show the current mode's icon. Ability icons that need a target change the cursor; passive protocols light up.
* **Health bars**: green → yellow → red by thirds (approx.; exact thresholds **unverified**); veterancy chevrons/star appear beside them; a wrench icon shows self-repair (Grinder Treads), a Terror-Drone icon shows infestation, snowflake = freezing bar, shrink/stasis/EMP each have an icon. Targets painted by a Guardian show a laser reticle.
* **Control groups**: Ctrl+0–9 to assign, number to select, double-tap to centre; Alt+number adds; Q selects all combat units on screen **(unverified)**; R+F1-style wall-in hotkeys are community lore.
* **Unit tooltip** (hover on a sidebar icon): name, cost, build time, one-line role, **"Strong vs / Weak vs"** icon row (infantry/vehicle/aircraft/ship/structure silhouettes), prerequisite text when locked (e.g. "Requires Heightened Clearance"), and in RA3 the secondary ability's name. The "requires" tooltip is how tech gating is communicated.
* **Minimap** bottom-left with beacon, co-commander command panel (campaign) and threat level; minimap goes dark on low power.
* **EVA / announcers**: each faction has a female battlefield announcer plus a human intelligence officer in the campaign (Allies: Eva McKenna; Soviets: Dasha Fedorovich; Empire: Suki Toyama). Announcer categories are identical across factions — unit ready, construction complete, structure sold/captured, insufficient funds, low power, our/ally base under attack, unit lost, harvester under attack, ore depleted/new ore source, protocol point acquired/protocol ready, superweapon charging/ready/launched (own and enemy), enemy superweapon detected, player defeated, mission timer. Personalities: the **Allied** announcer is a crisp, corporate American radio voice; the **Soviet** announcer is a stern, clipped female with a Russian accent; the **Empire** announcer is a soft, formal female with a Japanese accent and honorific phrasing. Unit response lines are selected by context (select, move, attack-move, in combat, under fire, retreating, secondary ability, garrison/clear, load/unload, shot down) and are themed per faction: Allies — wisecracking Hollywood professionalism; Soviets — fatalistic, boastful, thickly accented; Empire — honour, duty and emperor-worship delivered with anime-style zeal.

---

## H. OFFICIAL PATCH SUMMARY (balance-relevant)

| Patch | Date | Key changes |
|---|---|---|
| 1.05 | Dec 2008 | Imperial Refinery power 55→50; Prospector $1400→$1000; Allied Refinery sell $300→$500; Vindicator 50% vs Cores; Tengu AA 15→23; Engineers need several seconds to capture |
| 1.06–1.07 | Dec 2008–Feb 2009 | Auto-match revamp; Crusher Crane exploit fix; Steam Worldbuilder fixes |
| 1.08 | Mar 2009 | Aircraft RTB boost 50→25%; Vindicator reload 5→10 s (3.5→7 upgraded); Apollo speed 250→225, ammo −25%; Century reload +50%; Multigunner anti-inf −50%; IFV $900→$800; Carrier drone HP ×2; Assault Destroyer $1800→$1500. Empire: Burst Drone +25% vs Flak/AC; Defender-VX unpack halved, swap 15→2 s; production buildings +25% HP/tier; Dojo core $750→$500; Generator $1000→$800; T3 upgrades 60→30 s; Mainframe $3000→$2500 (16→30 s); Shogun 2000→1500 HP; Enhanced Kamikaze friendly damage −50%. Soviets: Conscript +25%; Tesla Trooper delay −1 s; MiG 225→210; Ultra-torp 400→300 tapering to 100; Twinblade 600→500 HP |
| 1.09 | Mar 2009 | Magnetic Singularity smoke-flare warning; IFV base-defence cannon vulnerability up; cross-faction airfield docking |
| 1.11 | Jun 2009 | Garrison range +100%→+75%; Observation Post 3000→10000; **superweapons half price**; anti-inf vehicles Gun vuln 50→25%; derricks explode. Allies: Javelin $400→$300; Carrier drones speed 150→225, reload 15→10; Black Hole 25→35%; Cryocopter 750→650; Defense Bureau 10→30 s; Apollo 250→300 HP; Chrono Rift 1 s delay, 5/10/15 s. Soviets: Flak Trooper $300→$400; Super Reactor 500→350; Stingray 360→450; MiG 200→240. Empire: King Oni 2250→3000; Naginata 1400→1200; Shogun speed 75→50, ROF −40%; Type-S damage halved; Emperor's Rage slow capped 75%; Point-Defense Drones expire 2 min. Vision: Multigunner 300→310, Spectrum 350→360, Hydrofoil 300→325, Javelin 175→200, Bullfrog 300→325, Sea-Wing/Tengu 200→225, Tanya/Yuriko shroud 400→500, Natasha/Yuriko vision 150→175 |
| 1.12 | Jul 2009 | Assault Destroyer exploit hotfix; final official version (Steam/Origin default). Community "Unofficial Patch 1.12.6" continues balance work (not covered here) |

---

## Sources

* Red Alert 3 BWiki (wiki.biligame.com/redalert3) — v1.12 unit/structure data pages, incl. 护甲系统 (armour system), 武器系统, 经验机制, 基础知识, 最高机密协议, protocol pages and every unit/structure page cited above, e.g. https://wiki.biligame.com/redalert3/护甲系统 , https://wiki.biligame.com/redalert3/基础知识 , https://wiki.biligame.com/redalert3/最高机密协议 , https://wiki.biligame.com/redalert3/守护者坦克 , https://wiki.biligame.com/redalert3/铁锤坦克 , https://wiki.biligame.com/redalert3/鬼王 , https://wiki.biligame.com/redalert3/超级要塞 , https://wiki.biligame.com/redalert3/盟军建造厂 , https://wiki.biligame.com/redalert3/苏联建造厂 , https://wiki.biligame.com/redalert3/帝国建造厂 , https://wiki.biligame.com/redalert3/纳米核心 , https://wiki.biligame.com/redalert3/IFT武器大全
* C&C Wiki (cnc.fandom.com): Peacekeeper, Hammer tank, Guardian tank, Tsunami tank, King Oni, Mecha Tengu, Striker-VX, Shogun battleship, Top Secret Protocol, Commander's Challenge, Yuriko Omega, Ore mine — https://cnc.fandom.com/wiki/Peacekeeper , https://cnc.fandom.com/Hammer_tank , https://cnc.fandom.com/wiki/Top_Secret_Protocol , https://cnc.fandom.com/wiki/Commander%27s_Challenge , https://cnc.fandom.com/wiki/Yuriko_Omega , https://cnc.fandom.com/wiki/Ore_mine
* CNCNZ — RA3 unit pages and patch history: https://cncnz.com/games/red-alert-3/allied-units/ , https://cncnz.com/games/red-alert-3/soviet-units/ , https://cncnz.com/features/technical-support-help-guides/red-alert-3-v101-v112-patch-history/
* StrategyWiki — Allied/Soviet unit tables, Uprising unit pages, Commander's Challenge list: https://strategywiki.org/wiki/Command_%26_Conquer:_Red_Alert_3/Allied_units , https://strategywiki.org/wiki/Command_%26_Conquer:_Red_Alert_3/Soviet_units , https://strategywiki.org/wiki/Command_%26_Conquer:_Red_Alert_3:_Uprising/New_Allied_Units
* GameReplays.org RA3 unit/structure guide portals: https://www.gamereplays.org/redalert3/portals.php?show=units (Allied, Soviet, Empire indices and Guardian Tank page)
* CNC Labs Allied unit overview: https://www.cnclabs.com/redalert3/factions/allies/units.aspx
* Gamersky RA3 damage-type guide (qualitative): https://www.gamersky.com/handbook/200905/140756.shtml
* ModDB "RA3 Undecided" change list (vanilla reference values): https://www.moddb.com/mods/ra3-undecided/features/general-changes
* Official patch notes mirrors: https://www.cnclabs.com/downloads/details.aspx?id=962 , https://worthplaying.com/article/2009/7/15/news/63386/
