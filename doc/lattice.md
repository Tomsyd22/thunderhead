## 10. Faction 1: The Lattice

**Doctrine.** Quantity, speed, and the network. Everything is a machine: immune to toxin and hacking (except the big vehicles), vulnerable to EMP and to anything that one-shots 70-HP drones. Units near a Relay Pylon fire 15% faster and self-repair. The Hive Carrier makes free Scuttlers; the Reclaimer turns wrecks into credits. Infantry-class drones cannot garrison buildings, so the Lattice fights cities from the outside with Lamplighters and Lancers.

**Build system.** Seed Cores (RA3 Empire style): every structure starts life as a slow walker printed by the Core Nexus. Pylons extend the build radius.

**Look and sound.** Matte white carbon with cyan status lights that go amber when damaged and red when critical. Hexagonal everything. Announcer is a calm synthetic contralto who reports battles like system status. Music: pulsing synth arpeggios over a slow industrial beat.

**Weak to:** EMP is irrelevant (own tech), but Compact Grenadiers and Hunters shred drone swarms, Helix Netrunners steal Phalanxes and Colossi, and every Lattice vehicle is lighter than its Compact counterpart.

### Structures

| Structure | Role | Cost $ | HP / armour | Power | Tier | Requires | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Core Nexus** | Construction yard | 3000 | 1200 concrete | 0 | 1 | — | Prints Seed Cores for every structure. If it dies, the Lattice can still fight but cannot expand. (limit 1) |
| **Reactor Array** | Power | 800 | 700 steel | +200 | 1 | Core Nexus | Stacked fusion cells. Cheap, fragile, and the first thing a Helix Ghost goes for.  |
| **Tantalum Extractor** | Refinery | 2000 | 1000 steel | -50 | 1 | Reactor Array | Comes with one Harvester Crawler. Crawlers dock here. Veins within 6 cells are auto-mined slowly without a crawler (+$8/10s).  |
| **Fabrication Bay** | Infantry-class production | 500 | 600 steel | -20 | 1 | Reactor Array | Prints small drones. Equivalent of a barracks.  |
| **Assembly Plant** | Vehicle production | 2000 | 1000 steel | -50 | 1 | Tantalum Extractor | Prints vehicle-class drones and Fabricators.  |
| **Drone Hangar** | Air production + rearm | 1000 | 800 steel | -50 | 2 | Assembly Plant | Four landing cradles. Also provides radar. Raptors rearm here.  |
| **Harbour Node** | Naval production | 1000 | 1000 steel | -30 | 2 | Tantalum Extractor | Must be placed on water. Builds naval drones.  |
| **Uplink Spire** | Radar + mesh hub | 1000 | 600 steel | -50 | 2 | Tantalum Extractor | Radar minimap. Enables Relay Pylons. Reveals stealth within 8 cells. (detector) |
| **Logic Tower** | Tech centre | 2000 | 500 steel | -150 | 3 | Assembly Plant, Uplink Spire | Unlocks tier 3 and superweapons. Power-hungry.  |
| **Reclaimer** | Repair + salvage | 800 | 800 steel | -30 | 2 | Assembly Plant | Repairs vehicles parked on it. Units driven in are recycled for 50% cost. Enemy wrecks dragged here by Wasps pay 25%.  |
| **Relay Pylon** | Mesh node | 400 | 300 steel | -10 | 2 | Uplink Spire | Lattice units within 6 cells fire 15% faster and regain 1% HP/s. Pylons extend the build radius. Stacking does not stack.  |
| **Firewall Fence** | Wall | 100 | 300 concrete | 0 | 1 | Core Nexus | Carbon-lattice wall segment. Projects a 1-cell EMP field: enemy vehicles touching it stall 2s.  |
| **Kessler Uplink** | Superweapon | 5000 | 1000 concrete | -250 | 3 | Logic Tower | Points the sky at the enemy. **Kessler Cascade** (10 min): De-orbits a cloud of debris onto a 7-cell radius over 12 seconds: 20 impacts of 300 SIEGE damage each, random within radius. (limit 1) |
| **Daisy-Chain Node** | Support superweapon | 2500 | 900 concrete | -150 | 3 | Logic Tower | Overclocks every machine in range past its rated limits. **Daisy Chain** (7 min): All Lattice units in a 4-cell radius become invulnerable and fire 50% faster for 10 seconds (Iron Curtain analogue). Infantry-class drones included. (limit 1) |

### Defences

| Defence | Role | Cost $ | HP / armour | Power | Tier | Requires | Weapon | Beats | Loses to |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Sentinel Pod** | Anti-ground turret | 600 | 500 steel | -20 | 1 | Fabrication Bay | Twin 20mm: 28 HE / 0.6s / r6 | Rifleman, Contractor | Hailstorm, Specter |
| **Lance Array** | Anti-air laser | 1000 | 800 steel | -50 | 2 | Uplink Spire | Lance laser: 90 BEAM / 1.2s / r10 (AA only) | Falcon, Dragonfly | Bastion |
| **Nullifier** | Anti-vehicle EMP tower | 1500 | 700 steel | -100 | 3 | Logic Tower | Null arc: 120 BEAM / 3s / r7 (veh only)<br>EMP pulse: 80 EMP / 3s / r7 (splash 1.5) | Bastion, Shade | Hailstorm, Rifleman |

- **Sentinel Pod** — Cheap pod with two autocannons. Shreds infantry, dents light vehicles.
- **Lance Array** — Beam AA. Instant hit, no dodging it.
- **Nullifier** — Tesla-coil role: a railed arc that also stalls vehicles. Helpless against infantry swarms.

### Infantry-class drones

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Scuttler** | Basic swarm drone | 120 | 90 flak | 5.5 | 1 | Fabrication Bay | Needle gun: 10 SA / 0.8s / r4 | unhackable |
| **Hornet** | Anti-air / anti-vehicle drone | 320 | 120 flak | 5 | 1 | Fabrication Bay | Micro-missiles: 60 ROCKET / 3s / r7 (AA+AG) | hover, unhackable |
| **Mender** | Engineer | 500 | 80 flak | 4.5 | 1 | Fabrication Bay | — | unhackable |
| **Sapper Crawler** | Suicide anti-structure | 450 | 80 flak | 5.5 | 2 | Fabrication Bay, Uplink Spire | Shaped charge: 800 SIEGE / 99s / r1 (splash 1, suicide) | unhackable |
| **Mimic** | Infiltrator | 1000 | 100 flak | 5 | 2 | Fabrication Bay, Uplink Spire | — | unhackable, disguise |
| **Lamplighter** | Anti-garrison / anti-infantry | 400 | 190 flak | 4.5 | 2 | Fabrication Bay, Uplink Spire | Thermite sprayer: 36 TOXIN / 1s / r4.5 (splash 1, clears garrison) | unhackable |
| **ARIA-7** | Hero | 2000 | 400 plate | 5.5 | 3 | Fabrication Bay, Logic Tower | Railgun: 150 BEAM / 2s / r8 (AA+AG, veh only)<br>Flechette burst: 140 SA / 0.6s / r7 (inf only)<br>Shutdown charge: 1200 SUPER / 6s / r1 (structures only) | limit 1, unhackable |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Scuttler** | **Overclock** (active, 20s): +50% fire rate for 5 s, then takes 10 HP burnout damage. | Needle gun Mk2 16 SA / 0.7s / r4.5 | — | Grenadier, Sentinel Pod, Rifleman | Chirpy, eager, slightly too literal. Thinks in plurals ("We are many. We are cheap."). |
| **Hornet** | **Lock-on** (toggle): Toggle: fires only at aircraft at +2 range; cannot hit ground while active. | standard (+50% dmg, −35% dmg taken, self-heal) | Bastion, Falcon | Rifleman, Scuttler | Buzzing, impatient, obsessed with "acquiring targets". Treats aircraft as personal insults. |
| **Mender** | **Patch** (active, 15s): Repairs a friendly structure 200 HP instantly. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Fussy maintenance bot. Apologises to buildings before capturing them. |
| **Sapper Crawler** | **Burrow** (toggle, 5s): Toggle: stealthed while stationary. Breaks on move. | standard (+50% dmg, −35% dmg taken, self-heal) | Fusion Plant, Railgun Turret, Solar Grid | Rifleman, Autoturret | Cheerfully doomed. Counts down out loud and gets the numbers wrong. |
| **Mimic** | **Spoof IFF** (active): Copies an enemy infantry's appearance. Enemy defences ignore it; war-dogs and Shinobi-class units see through it. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Flat, over-polite, slightly wrong phrasing of whoever it is imitating. |
| **Lamplighter** | — | standard (+50% dmg, −35% dmg taken, self-heal) | Rifleman, Contractor | Bastion, Shade | Warm, soothing, like a candle-shop assistant. Deeply unsettling given the flamethrower. |
| **ARIA-7** | **Null Burst** (active, 30s): EMP every vehicle within 4 cells for 6 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Rifleman, Contractor | Bastion, Behemoth | Serene, curious, gives motivational keynotes while killing. Refers to herself as "we" then corrects to "I". |

- **Scuttler** — Six-legged crawler with a needle gun. Individually pathetic, bought by the dozen. Cannot garrison.
- **Hornet** — Hovering quad-rotor with four micro-missiles. The Lattice answer to both tanks and aircraft at tier 1.
- **Mender** — Captures enemy structures by rewriting their control firmware. Repairs bridges. Unarmed.
- **Sapper Crawler** — Fast crawler packed with explosive. Runs at structures and vehicles. Dies either way.
- **Mimic** — Spy equivalent. Walks into buildings and ruins someone's day. Infiltration effects: refinery → steal 25% credits; power → blackout 60 s; radar → reveal enemy map; tech → next unit of a type spawns veteran; superweapon → reset timer.
- **Lamplighter** — Walking thermite sprayer. Clears garrisons and melts infantry. Useless against armour.
- **ARIA-7** — Quadruped combat frame, the first Lattice mind to ask for a name. Railgun hits air and ground; plants a shutdown charge on structures.

### Vehicles

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Harvester Crawler** | Harvester | 1400 | 900 heavy | 3.5 | 1 | Tantalum Extractor | Point-defence gun: 12 SA / 1s / r4 | — |
| **Wasp Skimmer** | Scout / salvage | 500 | 160 light | 9 | 1 | Assembly Plant | Stinger gun: 20 SA / 0.5s / r5 | amphibious, hover |
| **Phalanx** | Main battle drone | 800 | 480 medium | 4.5 | 1 | Assembly Plant | 75mm smoothbore: 60 AP / 3.2s / r5.5 | — |
| **Lancer** | Long-range anti-armour | 1200 | 240 light | 4 | 2 | Assembly Plant, Uplink Spire | Lance beam: 130 BEAM / 2.5s / r9 (chains) | — |
| **Hive Carrier** | Drone deployer / transport | 1300 | 500 medium | 4 | 2 | Assembly Plant, Uplink Spire | Scuttler launch: 0 SA / 2s / r7 (spawns Scuttler ×6) | carries 6 |
| **Null Projector** | EMP support | 1300 | 300 light | 4 | 2 | Assembly Plant, Uplink Spire | EMP lance: 100 EMP / 4s / r7 (AA+AG, splash 1) | — |
| **Colossus** | Heavy walker | 2000 | 1100 heavy | 3 | 3 | Assembly Plant, Logic Tower | Twin railguns: 100×2 BEAM / 3s / r7<br>Swarm launcher: 40×2 FLAK / 2s / r7 (AA only) | — |
| **Fabricator** | MCV | 3000 | 1000 heavy | 3 | 2 | Assembly Plant, Uplink Spire | — | — |
| **Skiff** | Amphibious transport | 900 | 400 medium | 6 | 1 | Assembly Plant | — | amphibious, hover, carries 8 |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Harvester Crawler** | **Hunker** (toggle): Stops; takes 50% damage; cannot mine. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Bored industrial hum. Reports yields like a quarterly earnings call. |
| **Wasp Skimmer** | **Salvage Hook** (active): Tow a wreck to a Reclaimer for 25% of its cost. | standard (+50% dmg, −35% dmg taken, self-heal) | Contractor | Hunter, Bastion | Hyperactive, speaks fast, sees everything, remembers nothing. |
| **Phalanx** | **Link Fire** (passive): Each other Phalanx within 3 cells adds +4% damage, max +20%. | standard (+50% dmg, −35% dmg taken, self-heal) | Interceptor Bike, Grenadier, Arbiter | Rocket Trooper, Netrunner | Terse, choral — three voices saying the same word slightly out of sync. |
| **Lancer** | **Refract** (active, 25s): Next shot splits to hit up to 4 targets at 50% damage. | standard (+50% dmg, −35% dmg taken, self-heal) | Bunker, Autoturret, Hailstorm | Bastion, Falcon, Rifleman | Precise, clipped, measures everything in nanometres. |
| **Hive Carrier** | **Recall** (active, 10s): All spawned Scuttlers return and are repaired. | standard (+50% dmg, −35% dmg taken, self-heal) | Contractor | Bastion, Arbiter | Maternal, slightly smothering toward its Scuttlers. |
| **Null Projector** | **Suppression Field** (deploy): Deploys: enemy vehicles within 5 cells move and fire 40% slower. Cannot move while deployed. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Whispery, smug, speaks in the passive voice. |
| **Colossus** | **Brace** (toggle): Plants legs: 50% less damage taken, +1 range, cannot move. | standard (+50% dmg, −35% dmg taken, self-heal) | Bastion, Shade | Netrunner, Rocket Trooper | Slow, deep, speaks only in complete sentences, each ending in a full stop you can hear. |
| **Fabricator** | **Deploy** (deploy): Becomes a Core Nexus. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | The Nexus announcer, but on wheels and mildly carsick. |
| **Skiff** | — | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Ferryman jokes, mostly about the River Styx. |

- **Harvester Crawler** — Eight-legged mining platform with a self-defence gun. Walks over cliffs other harvesters path around.
- **Wasp Skimmer** — Hover scout. Fastest ground unit in the game. Crosses water.
- **Phalanx** — Low, wide, turretless tank drone. Slightly weaker than a Compact Bastion alone; stronger in a line.
- **Lancer** — Prism-tank role: glass cannon with a beam that jumps to a second target.
- **Hive Carrier** — Carries six drone-class units and manufactures free Scuttlers in the field (up to six alive).
- **Null Projector** — Magnetron role: does no damage, stalls everything with an engine. Pairs with Lancers.
- **Colossus** — Four-legged walker. Apocalypse-tank role. Walks over infantry, cliffs and bad decisions.
- **Fabricator** — Mobile construction vehicle.
- **Skiff** — Hover transport, 8 slots. Vehicles count as 3.

### Aircraft

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Raptor** | Strike fighter drone | 1000 | 170 light | 12 | 2 | Drone Hangar | Spike missiles: 70 ROCKET / 0.4s / r6 (ammo 4) | unhackable |
| **Stratos** | High-altitude bomber | 1800 | 350 light | 8 | 3 | Drone Hangar, Logic Tower | Kinetic rod: 800 SIEGE / 0.1s / r2 (splash 1.5, ammo 1) | unhackable |
| **Kite** | Air transport | 900 | 300 light | 10 | 2 | Drone Hangar | — | carries 5, unhackable |
| **Gnat Swarm** | Anti-infantry air | 700 | 120 light | 9 | 2 | Drone Hangar | Needle hail: 9 SA / 0.3s / r5 (splash 0.5) | unhackable |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Raptor** | **Loiter** (toggle): Circles the target area and engages anything that enters, until out of ammo. | standard (+50% dmg, −35% dmg taken, self-heal) | Bastion, Hailstorm | Hunter, Razor, Lance Array | Fighter-jock bravado run through a voice synthesiser; calls everyone "meatbag" fondly. |
| **Stratos** | **Climb** (toggle): Flies above flak range: immune to FLAK warheads, but cannot drop. | standard (+50% dmg, −35% dmg taken, self-heal) | Command HQ, Executive Tower, Railgun Turret | Hunter, SAM Site | Unhurried, philosophical about gravity. |
| **Kite** | **Hot Drop** (active): Unload while hovering at 1 cell altitude. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Air-traffic-controller calm. |
| **Gnat Swarm** | **Disperse** (toggle): Spreads out: takes 50% less FLAK damage, deals 30% less. | standard (+50% dmg, −35% dmg taken, self-heal) | Rifleman, Contractor | Hunter, Hornet | A thousand tiny voices whispering in unison. |

- **Raptor** — Harrier role: four missiles, returns to the Hangar to rearm.
- **Stratos** — Drops a single tungsten rod from the stratosphere. One structure per sortie.
- **Kite** — Carries 5 drone-class units. Unarmed.
- **Gnat Swarm** — A cloud of micro-drones that never lands. Eats infantry; useless against armour.

### Naval

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Barracuda** | Attack submarine | 1000 | 400 medium | 5 | 2 | Harbour Node | Torpedo: 120 ROCKET / 4s / r7 (naval) | submerged, unhackable |
| **Trident** | Destroyer | 1100 | 580 heavy | 5 | 2 | Harbour Node | Rail cannon: 90 BEAM / 3s / r7<br>Depth drones: 130 ROCKET / 4s / r7 (anti-sub)<br>Lance AA: 50 BEAM / 1.5s / r7 (AA only) | unhackable |
| **Leviathan** | Drone carrier | 2200 | 1000 heavy | 3.5 | 3 | Harbour Node, Logic Tower | Raptor wing: 0 ROCKET / 12s / r14 (spawns Carrier Raptor ×4) | unhackable |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Barracuda** | **Silent Run** (toggle): Undetectable even by sonar; cannot fire. | standard (+50% dmg, −35% dmg taken, self-heal) | Admiral-class Cruiser | Corvette | Sonar pings as punctuation. |
| **Trident** | **Sonar Ping** (active, 20s): Reveals submerged units within 10 cells for 8 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Barracuda, Phantom, Pike, Admiral-class Cruiser | — | Naval formality, oddly proud of its hull number. |
| **Leviathan** | **Launch All** (active, 40s): All four Raptors sortie at once regardless of rearm state. | standard (+50% dmg, −35% dmg taken, self-heal) | Command HQ, Bastion | Barracuda, Pike | Imperious, speaks of "my children". |

- **Barracuda** — Submerged torpedo drone. Only naval targets.
- **Trident** — Catamaran destroyer drone. Shore bombardment, AA and anti-sub in one hull.
- **Leviathan** — Carrier. Launches four light Raptors at anything within 14 cells.
