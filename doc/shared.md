## 9. Shared mechanics spec

Every number here is read by the simulator and the prototype from `rules.js`; this section is the human-readable copy.

### Economy

| Rule | Value | RA2 equivalent |
| --- | --- | --- |
| Starting credits (default) | $10000 | 10,000 |
| Tantalum ore per bail | $25 | Ore 25 |
| Cobalt vein per bail | $50 | Gems 50 |
| Harvester capacity | 20 bails ($500 ore / $1000 cobalt per trip) | Chrono Miner 20 |
| Sell refund | 50% | 50% |
| Repair cost | 50% of price for full HP | RepairPercent 15%/step |
| Salvage refund (Reclaimer / Black Market / Repair Depot) | 50% of unit cost; hacked enemy units 75% at the Black Market | Grinder |
| Captured derrick | $20 per 10 s | Oil derrick 20 per 100 frames |
| Build time | 1.6 s per $100 at one factory; each extra factory ×0.75 (floor 0.5) | BuildSpeed .7 min/$1000, MultipleFactory 0.8 |

### Power

Low power: production ×2 slower, defences and radar offline, superweapon timers paused. Plants: Lattice Reactor Array +200 ($800), Compact Fusion Plant +180 ($700), Helix Solar Grid +200 ($800, +50 per garrisoned infantry up to 3). A full base of every structure needs 6–7 plants for every faction (checked by the simulator).

### Base building

Build radius 12 cells from any own structure. One engineer captures a structure outright (RA2 rule). Garrisoned infantry: +25% damage, take 50%; TOXIN warheads clear garrisons. Medium and heavy tracked vehicles crush infantry that are not dug in; hover units crush nothing and cannot be crushed.

### Three build systems (RA3)

| Faction | System | RA3 source |
| --- | --- | --- |
| Lattice | **Seed Cores**: the Core Nexus prints a slow mobile core for each structure; drive it anywhere (even outside the build radius) and unpack. Relay Pylons extend the radius. | Empire Nanocores |
| Compact | **Classic**: build in the sidebar, place inside the radius when done. Trenches are free-placement. | RA2 / RA3 Soviets |
| Helix | **Site Office**: build then place like Compact, but a cheap Site Office truck ($600) deploys a new build radius anywhere. | RA3 Allied Prospector |

### Veterancy

XP = cost of what the unit destroys. Veteran at 3× own cost, Elite at 6×. Veteran: firepower ×1.25, damage taken ×0.8, speed ×1.1. Elite: firepower ×1.5, damage taken ×0.65, speed ×1.2, fire rate ×0.8, self-heal 2% HP/s, and some units swap to an elite weapon (listed per unit). Compact units reach ranks at 0.8× the ratios (Arsenal makes them start Veteran).

### Health bars

Green above 50%, yellow 25–50%, red below 25% (RA2 ConditionYellow/ConditionRed). Bars show on selection and on damage; a shield (Mogul) draws as a blue bar above the health bar.

### Damage model: armour × warhead

Damage dealt = weapon damage × the percentage below for the target's armour type (RA2 "Verses"). Infantry use none/flak/plate, vehicles and ships light/medium/heavy, structures wood/steel/concrete. Aircraft use light or medium but take AA warheads at the modifier shown under the table.

| Warhead | none | flak | plate | light | medium | heavy | wood | steel | concrete | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **SA** | 100% | 90% | 60% | 25% | 15% | 10% | 30% | 15% | 10% | rifles, machine guns, needle guns |
| **HE** | 90% | 90% | 100% | 50% | 35% | 25% | 80% | 60% | 50% | grenades, autocannon frag, rocket pods |
| **AP** | 25% | 25% | 25% | 100% | 100% | 90% | 75% | 60% | 50% | tank cannon, railgun turret |
| **ROCKET** | 30% | 30% | 30% | 100% | 90% | 75% | 60% | 50% | 40% | AT missiles, torpedoes, SAMs |
| **FLAK** | 100% | 100% | 90% | 60% | 25% | 15% | 30% | 20% | 10% | flak, rotary AA, interceptor drones |
| **BEAM** | 60% | 60% | 60% | 100% | 100% | 100% | 100% | 100% | 90% | lasers, railguns, lance beams |
| **SIEGE** | 60% | 60% | 50% | 70% | 60% | 50% | 100% | 100% | 100% | artillery, bombs, cruise missiles, satchel charges |
| **TOXIN** | 100% | 100% | 100% | 20% | 10% | 5% | 100% | 20% | 10% | thermite, nanodust, radiation |
| **EMP** | 0% | 0% | 0% | 100% | 100% | 70% | 50% | 50% | 50% | EMP (no HP damage: disables vehicles/structures for dmg × % × 0.1 s; Lattice machines ×1.5) |
| **SUPER** | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | hero charges, C4 |
| **HACK** | 0% | 0% | 0% | 100% | 100% | 100% | 0% | 100% | 100% | Netrunner, Stun Tower, Puppeteer (control, see hacking) |

Aircraft modifier: FLAK vs light/medium/heavy aircraft 100%/90%/75%; ROCKET 100%/90%/80%. Splash damage: 40% to everything within the splash radius (capped by area). Chain beams: 50% to the second target.

### Hacking (Helix) and EMP (Lattice)

Hack: Netrunner 12 s temporary control, permanent at Elite or after a 5 s Deep Dive; Stun Tower and Puppeteer permanent; Puppeteer holds 3, each extra deals 20 HP/s to it (Mastermind overload). Immune: heroes, MCVs, infantry, small drones (Scuttler, Hornet, Mender, Sapper, Mimic, Lamplighter), the Lattice Harvester Crawler, superweapons. EMP: disable seconds = EMP damage × armour % × 0.1; Lattice machines ×1.5; infantry immune, Lattice drones affected.

### Stealth

Cloaked units cannot be targeted until they fire (revealed 3 s) or a detector (Warhound, Uplink Spire, Radar Dome, Surveillance Hub, Trident sonar) is within 6 cells. Mimic disguise is seen through by dogs and detectors.

### Superweapons

One superweapon ($5000, 10 min charge) and one support superweapon ($2500, 7 min) per faction, both needing the tier-3 tech structure; a Ghost or Mimic infiltration resets the timer. Lattice: Kessler Cascade (debris rain) + Daisy Chain (invulnerability + overclock). Compact: Thunderhead Strike (hypersonic nuke + radiation) + Aegis Dome (structure shield). Helix: Blackout (mass disable + power out + 3 hacks) + Quantum Shift (teleport).

### Doctrines (RA3 Top Secret Protocols)

1 point per minute plus 1 per $2,500 destroyed; three tiers. Lattice: Swarm Drop (6 Scuttlers anywhere) → Mesh Overclock (+25% ROF in radius 6, 20 s) → Satellite Scan (reveal radius 12) → Null Field (EMP radius 5) → Fabricate (free Seed Core) → Kessler Fragment (mini debris strike). Compact: Paradrop (5 Riflemen) → Artillery Barrage (6 shells, SIEGE 120) → Sortie (2 Falcon strikes) → Veteran Academy (next 5 units Veteran) → Minefield (8 AT mines) → Tactical Nuke (small radius). Helix: Bounty Contract (kills refund 20% for 60 s) → Market Crash (enemy loses 10% credits) → Signal Jam (enemy radar off 60 s) → Hostile Takeover (hack 1 vehicle anywhere) → Insider Trading (+$2,000) → Quantum Rift (teleport 3 units).

### Win conditions

Standard: destroy all enemy structures (RA2 "short game" ignores walls). Options: unit cap 400, superweapons on/off, crates on/off, starting credits 5k/10k/20k.