## 12. Faction 3: Helix Dynamics

**Doctrine.** War as a service. Cheap contractors with bounties, hackers instead of mind control, cloaked tanks, a black market that pays for wrecks and hacked units, and a teleporter. Expensive, fragile, and wins by taking the enemy's army rather than killing it. The Arbiter is the cheapest main tank; the Shade ambushes from cloak; the Puppeteer steals three tanks and keeps them.

**Build system.** RA3 Allied style: build then place, with Site Office trucks ($600) deploying new build radii across the map.

**Look and sound.** Black glass, brushed titanium, magenta and teal neon, corporate wordmarks on every tank. Announcer is a concierge who calls base attacks "customer experience updates". Music: synthwave with corporate hold-music stingers.

**Weak to:** infantry. Hackers and the Puppeteer do nothing to infantry, Enforcers only stop small arms, and detectors (Warhounds, Uplink Spires) strip the cloak that half the roster relies on.

### Structures

| Structure | Role | Cost $ | HP / armour | Power | Tier | Requires | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Executive Tower** | Construction yard | 3000 | 1000 concrete | 0 | 1 | — | Glass and carbon. Lowest HP construction yard; has its own Autoturret on the roof (see defences). (limit 1) |
| **Solar Grid** | Power | 800 | 600 steel | +200 | 1 | Executive Tower | Standard output. Garrison up to 3 infantry inside (they "work the servers"): +50 power each (RA2 Bio Reactor). (garrison 3) |
| **Extraction Rig** | Refinery | 2000 | 900 steel | -50 | 1 | Solar Grid | Comes with one Smuggler harvester.  |
| **Recruitment Office** | Infantry production | 500 | 500 steel | -20 | 1 | Solar Grid | Hires contractors. Infantry cost 10% less with two Offices.  |
| **Fabrication Plant** | Vehicle production | 2000 | 900 steel | -50 | 1 | Extraction Rig | Builds vehicles.  |
| **Skyport** | Air production + rearm | 1000 | 700 steel | -50 | 2 | Fabrication Plant | Rooftop pads. Provides radar.  |
| **Marina** | Naval production | 1000 | 900 steel | -30 | 2 | Extraction Rig | Must be placed on water.  |
| **Surveillance Hub** | Radar + detector | 1000 | 600 steel | -50 | 2 | Extraction Rig | Minimap. Unlocks tier 2. Reveals stealth within 10 cells (best detector). (detector) |
| **R&D Campus** | Tech centre | 2000 | 500 steel | -120 | 3 | Fabrication Plant, Surveillance Hub | Unlocks tier 3 and superweapons.  |
| **Black Market** | Salvage + repair | 1000 | 700 steel | -30 | 2 | Fabrication Plant | Repairs vehicles. Any unit (yours or hacked) driven in pays 50% of its cost. Hacked enemy units pay 75% (RA2 Grinder).  |
| **Bioprinting Vats** | Infantry duplication | 2500 | 600 steel | -100 | 3 | R&D Campus | Every infantry trained at an Office is printed twice (RA2 Cloning Vats). Heroes excluded. (limit 1) |
| **Smart Wall** | Wall | 100 | 300 concrete | 0 | 1 | Executive Tower | Opaque to enemy sight: units behind it are hidden from direct view.  |
| **Blackout Array** | Superweapon | 5000 | 900 concrete | -250 | 3 | R&D Campus | Turns off the other side. **Blackout** (10 min): 8-cell radius: all enemy vehicles, aircraft and structures disabled for 30 s, enemy base power set to zero for 60 s, and 3 random disabled vehicles are permanently hacked. Infantry unaffected. (limit 1) |
| **Quantum Transit** | Support superweapon | 2500 | 800 concrete | -200 | 3 | R&D Campus | Corporate jet, but for tanks. **Quantum Shift** (7 min): Teleports up to 9 vehicles in a 3×3 to anywhere revealed (RA2 Chronosphere). Infantry inside the field die. Units dropped on water sink. (limit 1) |

### Defences

| Defence | Role | Cost $ | HP / armour | Power | Tier | Requires | Weapon | Beats | Loses to |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Autoturret** | Anti-infantry turret | 500 | 450 steel | -15 | 1 | Recruitment Office | Smart MG: 26 SA / 0.45s / r6 | Rifleman, Scuttler | Hailstorm, Lancer |
| **Stun Tower** | Anti-vehicle hack tower | 1500 | 650 steel | -100 | 2 | Surveillance Hub | Hack beam: 1 HACK / 4s / r7 (permanent hack) | Bastion, Phalanx | Rifleman, Hailstorm |
| **Drone Nest** | Anti-air | 900 | 600 steel | -40 | 2 | Surveillance Hub | Interceptor drones: 60×2 FLAK / 1.5s / r9 (AA only) | Raptor, Falcon | Bastion |

- **Autoturret** — Pop-up gun. Cheapest defence.
- **Stun Tower** — Psychic-Tower role: permanently takes over up to two enemy vehicles that enter range (one every 4 s). Does nothing to infantry, who are its counter.
- **Drone Nest** — Launches interceptor micro-drones at aircraft.

### Infantry

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Contractor** | Basic mercenary | 150 | 105 none | 4.2 | 1 | Recruitment Office | Carbine: 12 SA / 0.8s / r5 | — |
| **Enforcer** | Riot trooper (anti small-arms) | 450 | 260 plate | 3.6 | 1 | Recruitment Office | Riot shotgun: 34 SA / 1.1s / r3.5 (splash 0.5) | — |
| **Fixer** | Engineer | 500 | 100 none | 4.2 | 1 | Recruitment Office | — | — |
| **Netrunner** | Hacker (vehicle control) | 700 | 100 none | 4 | 2 | Recruitment Office, Surveillance Hub | Intrusion deck: 1 HACK / 2s / r6 (hack 12s) | — |
| **Nanodust Sniper** | Anti-infantry area denial | 900 | 110 none | 3.5 | 2 | Recruitment Office, Surveillance Hub | Nanodust round: 160 TOXIN / 3.5s / r8.5 (toxic cloud) | — |
| **Ghost** | Infiltrator / saboteur | 1000 | 120 none | 4.8 | 2 | Recruitment Office, Surveillance Hub | Silenced SMG: 30 SA / 0.6s / r4<br>Demo charge: 600 SUPER / 6s / r1 (structures only) | cloaked |
| **Vesper** | Hero | 2000 | 380 plate | 5.5 | 3 | Recruitment Office, R&D Campus | Dual smart-SMGs: 28 SA / 0.2s / r6 (AA+AG)<br>Hostile takeover: 1 HACK / 4s / r1 (structures only) | cloaked, limit 1 |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Contractor** | **Hazard Pay** (passive): Kills refund 10% of the victim's cost to you. | Smart carbine 20 SA / 0.7s / r5.5 | — | Rifleman, Grenadier, Lamplighter | Freelancer who reads the contract aloud. Asks about overtime under fire. |
| **Enforcer** | **Riot Shield** (toggle): Takes 50% less small-arms damage; speed −30%. Grenades and cannon ignore it. | standard (+50% dmg, −35% dmg taken, self-heal) | Rifleman, Scuttler | Bastion, Phalanx, Grenadier | Private-security bark, says "sir" sarcastically. |
| **Fixer** | **Hotfix** (active, 15s): Repairs a friendly structure 200 HP instantly. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | IT support energy: "have you tried turning the base off and on again". |
| **Netrunner** | **Deep Dive** (active, 40s): Channel 5 s on a hacked vehicle: control becomes permanent. Netrunner is defenceless while channelling. | hackPermanent | Bastion, Behemoth, Colossus | Rifleman, Scuttler, Sniper, Warhound | Caffeinated, speaks in exploits and shortcuts, calls tanks "endpoints". |
| **Nanodust Sniper** | **Dormant** (toggle): Stealthed while stationary. | standard (+50% dmg, −35% dmg taken, self-heal) | Rocket Trooper, Hornet, Sapper | Rifleman, Warhound, Bastion | Clinical, bored, describes targets like lab samples. |
| **Ghost** | **Infiltrate** (active): Enter an enemy structure: refinery steals 25% credits; power blackout 60 s; radar reveals map; tech makes your next unit of each type Veteran; superweapon resets its timer. | standard (+50% dmg, −35% dmg taken, self-heal) | Fusion Plant, Reactor Array | Warhound, Rifleman | Breathy spy-movie whisper, puns about invoices. |
| **Vesper** | **Golden Parachute** (active, 60s): Teleports Vesper to any friendly structure. | standard (+50% dmg, −35% dmg taken, self-heal) | Rifleman, Scuttler | Bastion, Phalanx | The CEO's fixer: smug, corporate jargon, calls kills "restructuring". Never raises her voice. |

- **Contractor** — Conscript role. Cheapest infantry in the game, and it shows.
- **Enforcer** — Brute-lite: armoured riot trooper who absorbs small arms and clears streets.
- **Fixer** — Captures structures, repairs bridges.
- **Netrunner** — Yuri-clone role, limited to vehicles and structures-with-electronics. Hack: 12 s control, permanent at Elite or via Deep Dive. One target at a time. Cannot hack heroes, MCVs, small drones or harvesters of the Lattice.
- **Nanodust Sniper** — Virus role: kills infantry and leaves a corrosive cloud that also eats drones.
- **Ghost** — Spy and SEAL in one: cloaked, plants charges on structures, infiltrates. Infiltration effects: refinery → steal 25% credits; power → blackout 60 s; radar → reveal enemy map; tech → next unit of a type spawns veteran; superweapon → reset timer.
- **Vesper** — Cloaked hero. Shreds infantry and light aircraft; touches an enemy structure to capture it outright (6 s channel).

### Vehicles

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Smuggler** | Harvester | 1400 | 800 heavy | 4 | 1 | Extraction Rig | — | cloaks when still |
| **Interceptor Bike** | Fast raider | 400 | 150 light | 9 | 1 | Fabrication Plant | Twin SMG: 10 SA / 0.3s / r4.5 | — |
| **Arbiter** | Main battle tank | 750 | 440 medium | 5.2 | 1 | Fabrication Plant | 90mm ETC gun: 62 AP / 3s / r5.5 | — |
| **Shade** | Ambush tank (stealth) | 1000 | 450 medium | 4.8 | 1 | Fabrication Plant | 105mm ETC gun: 80 AP / 3s / r5.75 | cloaks when still |
| **Suppressor** | Anti-infantry / anti-air | 650 | 280 light | 5.5 | 1 | Fabrication Plant | Rotary cannon: 10 FLAK / 0.12s / r7 (AA+AG) | — |
| **Puppeteer** | Mass hacking platform | 1600 | 420 medium | 3.5 | 3 | Fabrication Plant, R&D Campus | Broadcast intrusion: 1 HACK / 2.5s / r7 (permanent hack) | — |
| **Disruptor** | Sonic anti-structure / anti-infantry | 1300 | 300 light | 4 | 2 | Fabrication Plant, Surveillance Hub | Sonic lance: 85 SIEGE / 2.5s / r6.5 | — |
| **Mogul** | Heavy hover tank | 2000 | 800 heavy | 4 | 3 | Fabrication Plant, R&D Campus | Spectrum laser: 105 BEAM / 2s / r6.5<br>Pop-up missiles: 70×2 ROCKET / 2.5s / r7 (AA only) | amphibious, hover, shield 300 |
| **Mobile HQ** | MCV | 3000 | 900 heavy | 3.5 | 2 | Fabrication Plant, Surveillance Hub | — | — |
| **Courier** | Amphibious transport | 900 | 380 medium | 6.5 | 1 | Fabrication Plant | — | amphibious, hover, cloaks when still, carries 8 |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Smuggler** | **Go Dark** (toggle): Cloaked while not mining; mining breaks cloak. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Shifty, speaks in euphemisms about "the merchandise". |
| **Interceptor Bike** | **Drive-by** (passive): Fires while moving at full speed. | standard (+50% dmg, −35% dmg taken, self-heal) | Hailstorm, Rifleman | Phalanx, Hunter, Sentinel Pod | Courier adrenaline, every line shouted over an engine. |
| **Arbiter** | **Repossess** (passive): Vehicle kills refund 10% of the victim's cost (bounty). | standard (+50% dmg, −35% dmg taken, self-heal) | Grenadier, Scuttler | Rocket Trooper, Hornet, Bastion | Leasing-agent patter; refers to the enemy as "the account". |
| **Shade** | **Active Camo** (toggle): Cloaked while stationary (RA2 Mirage). Firing reveals for 3 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Lancer, Hailstorm, Grenadier | Bastion, Phalanx, Rocket Trooper | Hushed, theatrical, "now you see me". |
| **Suppressor** | **Spin Up** (active, 25s): Instantly at max spin for 6 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Rifleman, Scuttler, Raptor, Gnat Swarm | Bastion, Phalanx, Shade | Chipper, speaks faster as the gun spins up. |
| **Puppeteer** | **Release** (active): Releases all controlled units back to their original owner, clearing the overload. | standard (+50% dmg, −35% dmg taken, self-heal) | Bastion, Behemoth, Colossus, Phalanx | Rifleman, Rocket Trooper, Scuttler, Falcon | Oily, smug, speaks of "acquisitions" and "synergy". |
| **Disruptor** | **Resonance** (active, 30s): Next shot deals double damage to structures and stuns infantry 2 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Sentinel Pod, Bunker, Relay Pylon, Trench | Bastion, Phalanx, Rifleman | Audiophile, complains about the acoustics of every battlefield. |
| **Mogul** | **Hard Reboot** (active, 45s): Instantly restores shield to full; 3 s disabled afterwards. | standard (+50% dmg, −35% dmg taken, self-heal) | Bastion, Phalanx, Kondor | Rocket Trooper, Hornet, Netrunner | Executive calm, speaks in quarterly metrics; genuinely enjoys the laser. |
| **Mobile HQ** | **Deploy** (deploy): Becomes an Executive Tower. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | The Tower concierge in a motorhome. |
| **Courier** | — | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Rideshare driver; rates passengers. |

- **Smuggler** — Unarmed, fastest harvester, cloaks while travelling.
- **Interceptor Bike** — Hover bike. Harasses harvesters and artillery.
- **Arbiter** — Grizzly/Lasher role: cheapest and fastest main tank, thinnest armour. Earns bounties.
- **Shade** — Mirage role. Cloaks when still, hits harder than an Arbiter, dies faster than one. Ambushes artillery and glass cannons.
- **Suppressor** — Gattling-tank role: spins up to a hail of flak.
- **Puppeteer** — Mastermind role: permanently hacks up to three vehicles. Each over three deals 20 damage/s to the Puppeteer (overload). Infantry are immune and kill it.
- **Disruptor** — Fires a sonic wave that damages everything in a line. Breaks walls and bunkers.
- **Mogul** — Apocalypse role with a twist: 300 HP regenerating shield over 700 HP hull. Crosses water.
- **Mobile HQ** — Mobile construction vehicle.
- **Courier** — Hover transport, cloaks when idle. 8 slots.

### Aircraft

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Dragonfly** | VTOL gunship | 1200 | 260 light | 9 | 2 | Skyport | Laser pod: 20 BEAM / 0.5s / r6<br>Micro-missiles: 60×2 ROCKET / 3s / r6 | hover |
| **Specter** | Stealth bomber | 2000 | 250 light | 11 | 3 | Skyport, R&D Campus | Glide bombs: 220 SIEGE / 0.4s / r3 (splash 1.5, ammo 4) | cloaked |
| **Lift** | Air transport | 900 | 300 light | 10 | 2 | Skyport | — | hover, cloaks when still, carries 5 |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Dragonfly** | **Hover Snipe** (toggle): Stops moving: +2 range, +25% damage, takes +50% FLAK damage. | standard (+50% dmg, −35% dmg taken, self-heal) | Hailstorm, Lancer | Hunter, Hornet, SAM Site, Suppressor | Smooth news-helicopter pilot narrating traffic. |
| **Specter** | **Jammer** (active, 40s): Enemy AA within 8 cells fires 50% slower for 6 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Command HQ, Core Nexus, Railgun Turret | Lance Array, SAM Site, Hunter | Barely-there whisper; signs off with the invoice number. |
| **Lift** | **Drop** (active): Unload while hovering. | standard (+50% dmg, −35% dmg taken, self-heal) | — | — | Elevator-music pleasantness. |

- **Dragonfly** — No ammo limit. Lasers and missiles. The Helix workhorse in the air.
- **Specter** — Cloaked until it drops. Four glide bombs. Rearms at the Skyport.
- **Lift** — Carries 5 infantry. Cloaks when hovering idle.

### Naval

| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Razor** | Hydrofoil AA / anti-sub | 900 | 380 medium | 8 | 2 | Marina | Rotary flak: 45 FLAK / 0.9s / r8 (AA only)<br>Light torpedo: 100 ROCKET / 3s / r7 (naval) | — |
| **Phantom** | Stealth missile sub | 1500 | 450 medium | 5 | 3 | Marina, R&D Campus | Torpedo: 110 ROCKET / 4s / r7 (naval)<br>Cruise missile: 250 SIEGE / 7s / r12 (splash 1.5) | submerged |
| **Warden** | Missile destroyer | 1300 | 650 heavy | 5 | 2 | Marina | VLS missiles: 95×2 ROCKET / 3.5s / r8 (AA+AG) | — |

| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |
| --- | --- | --- | --- | --- | --- |
| **Razor** | **Jam** (active, 30s): One enemy ship within 8 cells cannot fire for 5 s. | standard (+50% dmg, −35% dmg taken, self-heal) | Raptor, Pike, Barracuda | Trident, Admiral-class Cruiser | Jet-ski bro. |
| **Phantom** | **Surface** (toggle): Surfaces to fire cruise missiles at land; submerged it only uses torpedoes. | standard (+50% dmg, −35% dmg taken, self-heal) | Admiral-class Cruiser, Core Nexus | Corvette, Trident | Ultra-quiet, speaks like a late-night radio host. |
| **Warden** | **Point Defence** (toggle): Shoots down incoming artillery shells and missiles within 3 cells; cannot attack while active. | standard (+50% dmg, −35% dmg taken, self-heal) | Corvette, Raptor | Pike, Barracuda | Insurance-adjuster calm. |

- **Razor** — Fastest ship. AA and anti-sub, no shore attack.
- **Phantom** — Boomer role: torpedoes submerged, cruise missiles surfaced.
- **Warden** — Aegis role: strong AA and surface missiles, no anti-sub.
