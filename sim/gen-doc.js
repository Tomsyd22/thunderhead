#!/usr/bin/env node
// Generates markdown for the design bible from the data files (single source of truth).
const RULES = require('../data/rules.js');
const F = { lattice: require('../data/lattice.js'), compact: require('../data/compact.js'), helix: require('../data/helix.js') };
const ALL = [].concat(...Object.values(F)); const BY = Object.fromEntries(ALL.map(u => [u.id, u]));
const fs = require('fs');
const name = id => (BY[id] ? BY[id].name : id);
const w = u => (u.weapons || []).map(x => {
  let s = `${x.name}: ${x.dmg}${x.burst ? '×' + x.burst : ''} ${x.wh} / ${x.rof}s / r${x.range}`;
  const t = []; if (x.aa && x.ag) t.push('AA+AG'); else if (x.aa) t.push('AA only'); else if (x.naval || x.antiSub) t.push(x.antiSub ? 'anti-sub' : 'naval');
  if (x.splash) t.push(`splash ${x.splash}`); if (x.minRange) t.push(`min ${x.minRange}`); if (x.chain) t.push('chains'); if (x.suicide) t.push('suicide'); if (x.vsInfantryOnly) t.push('inf only'); if (x.vsVehicleOnly) t.push('veh only'); if (x.vsStructureOnly) t.push('structures only'); if (x.usesAmmo) t.push(`ammo ${u.ammo}`); if (x.hackSeconds) t.push(x.hackSeconds >= 9999 ? 'permanent hack' : `hack ${x.hackSeconds}s`); if (x.spawns) t.push(`spawns ${name(x.spawns)} ×${x.spawnMax}`); if (x.clearsGarrison) t.push('clears garrison'); if (x.leavesCloud) t.push('toxic cloud');
  return s + (t.length ? ` (${t.join(', ')})` : '');
}).join('<br>') || '—';
const tags = u => { const t = []; if (u.amphibious) t.push('amphibious'); if (u.hover) t.push('hover'); if (u.cloak) t.push('cloaked'); if (u.cloakIdle) t.push('cloaks when still'); if (u.detector) t.push('detector'); if (u.transport) t.push(`carries ${u.transport}`); if (u.submerged) t.push('submerged'); if (u.shield) t.push(`shield ${u.shield.hp}`); if (u.buildLimit) t.push(`limit ${u.buildLimit}`); if (u.garrison) t.push(`garrison ${u.garrison}`); if ((u.tags || []).includes('nohack')) t.push('unhackable'); if (u.disguise) t.push('disguise'); return t.join(', ') || '—'; };
const prereq = u => (u.prereq || []).map(name).join(', ') || '—';
const esc = s => String(s || '—').replace(/\|/g, '/');

function factionMd(fid, intro) {
  const U = F[fid].filter(u => !u.hidden);
  const out = [intro, ''];
  const classes = [['structure', 'Structures'], ['defence', 'Defences'], ['infantry', 'Infantry'], ['drone', 'Infantry-class drones'], ['vehicle', 'Vehicles'], ['aircraft', 'Aircraft'], ['naval', 'Naval']];
  for (const [cls, title] of classes) {
    const L = U.filter(u => u.cls === cls); if (!L.length) continue;
    out.push(`### ${title}`, '');
    if (cls === 'structure') {
      out.push('| Structure | Role | Cost $ | HP / armour | Power | Tier | Requires | Notes |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const u of L) out.push(`| **${u.name}** | ${esc(u.role)} | ${u.cost} | ${u.hp} ${u.armour} | ${u.power > 0 ? '+' : ''}${u.power} | ${u.tier} | ${prereq(u)} | ${esc(u.desc)}${u.superweapon ? ` **${u.superweapon.name}** (${u.superweapon.charge / 60} min): ${esc(u.superweapon.desc)}` : ''} ${tags(u) !== '—' ? '(' + tags(u) + ')' : ''} |`);
      out.push('');
      continue;
    }
    if (cls === 'defence') {
      out.push('| Defence | Role | Cost $ | HP / armour | Power | Tier | Requires | Weapon | Beats | Loses to |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const u of L) out.push(`| **${u.name}** | ${esc(u.role)} | ${u.cost} | ${u.hp} ${u.armour} | ${u.power} | ${u.tier} | ${prereq(u)} | ${w(u)} | ${(u.counters ? u.counters.beats : []).map(name).join(', ') || '—'} | ${(u.counters ? u.counters.losesTo : []).map(name).join(', ') || '—'} |`);
      out.push('');
      for (const u of L) out.push(`- **${u.name}** — ${u.desc}`);
      out.push('');
      continue;
    }
    out.push('| Unit | Role | Cost $ | HP / armour | Speed | Tier | Requires | Weapons | Traits |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const u of L) out.push(`| **${u.name}** | ${esc(u.role)} | ${u.cost} | ${u.hp} ${u.armour} | ${u.speed} | ${u.tier} | ${prereq(u)} | ${w(u)} | ${tags(u)} |`);
    out.push('', '| Unit | Secondary ability | Elite upgrade | Beats (cost-for-cost) | Loses to | Voice brief |', '| --- | --- | --- | --- | --- | --- |');
    for (const u of L) {
      const sec = u.secondary ? `**${u.secondary.name}** (${u.secondary.kind}${u.secondary.cooldown ? ', ' + u.secondary.cooldown + 's' : ''}): ${esc(u.secondary.desc)}` : '—';
      const el = u.elite ? (u.elite.weapons ? u.elite.weapons.map(x => `${x.name} ${x.dmg} ${x.wh} / ${x.rof}s / r${x.range}`).join('; ') : Object.keys(u.elite).join(', ')) : 'standard (+50% dmg, −35% dmg taken, self-heal)';
      out.push(`| **${u.name}** | ${sec} | ${esc(el)} | ${(u.counters ? u.counters.beats : []).map(name).join(', ') || '—'} | ${(u.counters ? u.counters.losesTo : []).map(name).join(', ') || '—'} | ${esc(u.voice ? u.voice.brief : '')} |`);
    }
    out.push('');
    for (const u of L) out.push(`- **${u.name}** — ${u.desc}${u.infiltrate ? ' Infiltration effects: ' + Object.entries(u.infiltrate).map(([k, v]) => `${k} → ${v}`).join('; ') + '.' : ''}`);
    out.push('');
  }
  return out.join('\n');
}

// Shared mechanics section
function sharedMd() {
  const R = RULES; const o = [];
  o.push(`## 9. Shared mechanics spec`, '',
    `Every number here is read by the simulator and the prototype from \`rules.js\`; this section is the human-readable copy.`, '',
    `### Economy`, '',
    `| Rule | Value | RA2 equivalent |`, `| --- | --- | --- |`,
    `| Starting credits (default) | $${R.economy.startingCredits} | 10,000 |`,
    `| Tantalum ore per bail | $${R.economy.oreBail} | Ore 25 |`,
    `| Cobalt vein per bail | $${R.economy.gemBail} | Gems 50 |`,
    `| Harvester capacity | ${R.economy.harvesterCapacity} bails ($${R.economy.harvesterCapacity * R.economy.oreBail} ore / $${R.economy.harvesterCapacity * R.economy.gemBail} cobalt per trip) | Chrono Miner 20 |`,
    `| Sell refund | ${R.economy.sellRefund * 100}% | 50% |`,
    `| Repair cost | ${R.economy.repairCostFraction * 100}% of price for full HP | RepairPercent 15%/step |`,
    `| Salvage refund (Reclaimer / Black Market / Repair Depot) | ${R.economy.grinderRefund * 100}% of unit cost; hacked enemy units 75% at the Black Market | Grinder |`,
    `| Captured derrick | $${R.economy.derrickIncome} per 10 s | Oil derrick 20 per 100 frames |`,
    `| Build time | ${R.economy.buildTimeSecondsPer100Credits} s per $100 at one factory; each extra factory ×${R.economy.extraFactoryMultiplier} (floor 0.5) | BuildSpeed .7 min/$1000, MultipleFactory 0.8 |`, '',
    `### Power`, '', `Low power: production ×${R.power.lowPowerBuildMultiplier} slower, defences and radar offline, superweapon timers paused. Plants: Lattice Reactor Array +200 ($800), Compact Fusion Plant +180 ($700), Helix Solar Grid +200 ($800, +50 per garrisoned infantry up to 3). A full base of every structure needs 6–7 plants for every faction (checked by the simulator).`, '',
    `### Base building`, '', `Build radius ${R.base.buildRadiusCells} cells from any own structure. One engineer captures a structure outright (RA2 rule). Garrisoned infantry: +${Math.round((R.base.garrisonInfantryDamageBonus - 1) * 100)}% damage, take ${R.base.garrisonArmourFactor * 100}%; TOXIN warheads clear garrisons. Medium and heavy tracked vehicles crush infantry that are not dug in; hover units crush nothing and cannot be crushed.`, '',
    `### Three build systems (RA3)`, '', `| Faction | System | RA3 source |`, `| --- | --- | --- |`,
    `| Lattice | **Seed Cores**: the Core Nexus prints a slow mobile core for each structure; drive it anywhere (even outside the build radius) and unpack. Relay Pylons extend the radius. | Empire Nanocores |`,
    `| Compact | **Classic**: build in the sidebar, place inside the radius when done. Trenches are free-placement. | RA2 / RA3 Soviets |`,
    `| Helix | **Site Office**: build then place like Compact, but a cheap Site Office truck ($600) deploys a new build radius anywhere. | RA3 Allied Prospector |`, '',
    `### Veterancy`, '', `XP = cost of what the unit destroys. Veteran at ${R.veterancy.veteranRatio}× own cost, Elite at ${R.veterancy.eliteRatio}×. Veteran: firepower ×${R.veterancy.veteran.firepower}, damage taken ×${R.veterancy.veteran.armour}, speed ×${R.veterancy.veteran.speed}. Elite: firepower ×${R.veterancy.elite.firepower}, damage taken ×${R.veterancy.elite.armour}, speed ×${R.veterancy.elite.speed}, fire rate ×${R.veterancy.elite.rof}, self-heal ${R.veterancy.elite.selfHeal * 100}% HP/s, and some units swap to an elite weapon (listed per unit). Compact units reach ranks at 0.8× the ratios (Arsenal makes them start Veteran).`, '',
    `### Health bars`, '', `Green above ${R.healthBar.yellowBelow * 100}%, yellow ${R.healthBar.redBelow * 100}–${R.healthBar.yellowBelow * 100}%, red below ${R.healthBar.redBelow * 100}% (RA2 ConditionYellow/ConditionRed). Bars show on selection and on damage; a shield (Mogul) draws as a blue bar above the health bar.`, '',
    `### Damage model: armour × warhead`, '', `Damage dealt = weapon damage × the percentage below for the target's armour type (RA2 "Verses"). Infantry use none/flak/plate, vehicles and ships light/medium/heavy, structures wood/steel/concrete. Aircraft use light or medium but take AA warheads at the modifier shown under the table.`, '',
    `| Warhead | ${R.armourTypes.join(' | ')} | Used by |`, `| --- | ${R.armourTypes.map(() => '---').join(' | ')} | --- |`);
  const uses = { SA: 'rifles, machine guns, needle guns', HE: 'grenades, autocannon frag, rocket pods', AP: 'tank cannon, railgun turret', ROCKET: 'AT missiles, torpedoes, SAMs', FLAK: 'flak, rotary AA, interceptor drones', BEAM: 'lasers, railguns, lance beams', SIEGE: 'artillery, bombs, cruise missiles, satchel charges', TOXIN: 'thermite, nanodust, radiation', EMP: 'EMP (no HP damage: disables vehicles/structures for dmg × % × 0.1 s; Lattice machines ×1.5)', SUPER: 'hero charges, C4', HACK: 'Netrunner, Stun Tower, Puppeteer (control, see hacking)' };
  for (const [k, v] of Object.entries(R.warheads)) o.push(`| **${k}** | ${v.map(x => Math.round(x * 100) + '%').join(' | ')} | ${uses[k]} |`);
  o.push('', `Aircraft modifier: FLAK vs light/medium/heavy aircraft ${Object.values(R.aircraftModifier.FLAK).map(x => x * 100 + '%').join('/')}; ROCKET ${Object.values(R.aircraftModifier.ROCKET).map(x => x * 100 + '%').join('/')}. Splash damage: 40% to everything within the splash radius (capped by area). Chain beams: 50% to the second target.`, '',
    `### Hacking (Helix) and EMP (Lattice)`, '', `Hack: Netrunner ${R.hack.temporarySeconds} s temporary control, permanent at Elite or after a 5 s Deep Dive; Stun Tower and Puppeteer permanent; Puppeteer holds ${R.hack.puppeteerMaxControlled}, each extra deals ${R.hack.puppeteerOverloadDamagePerSec} HP/s to it (Mastermind overload). Immune: heroes, MCVs, infantry, small drones (Scuttler, Hornet, Mender, Sapper, Mimic, Lamplighter), the Lattice Harvester Crawler, superweapons. EMP: disable seconds = EMP damage × armour % × ${R.emp.disableSecondsPerPoint}; Lattice machines ×${R.emp.latticeExtraFactor}; infantry immune, Lattice drones affected.`, '',
    `### Stealth`, '', `Cloaked units cannot be targeted until they fire (revealed 3 s) or a detector (Warhound, Uplink Spire, Radar Dome, Surveillance Hub, Trident sonar) is within ${R.stealth.detectorsRevealRadius} cells. Mimic disguise is seen through by dogs and detectors.`, '',
    `### Superweapons`, '', `One superweapon ($5000, ${R.superweapons.chargeSeconds / 60} min charge) and one support superweapon ($2500, ${R.superweapons.supportChargeSeconds / 60} min) per faction, both needing the tier-3 tech structure; a Ghost or Mimic infiltration resets the timer. Lattice: Kessler Cascade (debris rain) + Daisy Chain (invulnerability + overclock). Compact: Thunderhead Strike (hypersonic nuke + radiation) + Aegis Dome (structure shield). Helix: Blackout (mass disable + power out + 3 hacks) + Quantum Shift (teleport).`, '',
    `### Doctrines (RA3 Top Secret Protocols)`, '', `${R.doctrines.pointsPerMinute} point per minute plus 1 per $2,500 destroyed; three tiers. Lattice: Swarm Drop (6 Scuttlers anywhere) → Mesh Overclock (+25% ROF in radius 6, 20 s) → Satellite Scan (reveal radius 12) → Null Field (EMP radius 5) → Fabricate (free Seed Core) → Kessler Fragment (mini debris strike). Compact: Paradrop (5 Riflemen) → Artillery Barrage (6 shells, SIEGE 120) → Sortie (2 Falcon strikes) → Veteran Academy (next 5 units Veteran) → Minefield (8 AT mines) → Tactical Nuke (small radius). Helix: Bounty Contract (kills refund 20% for 60 s) → Market Crash (enemy loses 10% credits) → Signal Jam (enemy radar off 60 s) → Hostile Takeover (hack 1 vehicle anywhere) → Insider Trading (+$2,000) → Quantum Rift (teleport 3 units).`, '',
    `### Win conditions`, '', `Standard: destroy all enemy structures (RA2 "short game" ignores walls). Options: unit cap ${R.unitCap}, superweapons on/off, crates on/off, starting credits 5k/10k/20k.`);
  return o.join('\n');
}

const intros = {
  lattice: `## 10. Faction 1: The Lattice\n\n**Doctrine.** Quantity, speed, and the network. Everything is a machine: immune to toxin and hacking (except the big vehicles), vulnerable to EMP and to anything that one-shots 70-HP drones. Units near a Relay Pylon fire 15% faster and self-repair. The Hive Carrier makes free Scuttlers; the Reclaimer turns wrecks into credits. Infantry-class drones cannot garrison buildings, so the Lattice fights cities from the outside with Lamplighters and Lancers.\n\n**Build system.** Seed Cores (RA3 Empire style): every structure starts life as a slow walker printed by the Core Nexus. Pylons extend the build radius.\n\n**Look and sound.** Matte white carbon with cyan status lights that go amber when damaged and red when critical. Hexagonal everything. Announcer is a calm synthetic contralto who reports battles like system status. Music: pulsing synth arpeggios over a slow industrial beat.\n\n**Weak to:** EMP is irrelevant (own tech), but Compact Grenadiers and Hunters shred drone swarms, Helix Netrunners steal Phalanxes and Colossi, and every Lattice vehicle is lighter than its Compact counterpart.`,
  compact: `## 11. Faction 2: The Compact\n\n**Doctrine.** Heavy, slow, cheap infantry, expensive armour. Best tank at every tier, best artillery, the only trench. Infantry dig in (uncrushable, +30% damage) and Rocket Troopers brace. Veterancy comes 20% faster and the Arsenal makes units start Veteran. The Thunderhead Strike is the only true nuke in the game.\n\n**Build system.** RA2 classic: queue in the sidebar, place inside the radius.\n\n**Look and sound.** Olive drab and gunmetal, red stripes, stencilled numbers, concrete everything. Announcer is a gravel-voiced field marshal. Music: brass-heavy orchestral march with electric guitar.\n\n**Weak to:** anything faster than it. Helix bikes and Shades raid Harvesters and Hailstorms; Lattice swarms overwhelm single big units; Netrunners turn Behemoths around. The Stratofortress dies to any AA that gets to shoot it for ten seconds.`,
  helix: `## 12. Faction 3: Helix Dynamics\n\n**Doctrine.** War as a service. Cheap contractors with bounties, hackers instead of mind control, cloaked tanks, a black market that pays for wrecks and hacked units, and a teleporter. Expensive, fragile, and wins by taking the enemy's army rather than killing it. The Arbiter is the cheapest main tank; the Shade ambushes from cloak; the Puppeteer steals three tanks and keeps them.\n\n**Build system.** RA3 Allied style: build then place, with Site Office trucks ($600) deploying new build radii across the map.\n\n**Look and sound.** Black glass, brushed titanium, magenta and teal neon, corporate wordmarks on every tank. Announcer is a concierge who calls base attacks "customer experience updates". Music: synthwave with corporate hold-music stingers.\n\n**Weak to:** infantry. Hackers and the Puppeteer do nothing to infantry, Enforcers only stop small arms, and detectors (Warhounds, Uplink Spires) strip the cloak that half the roster relies on.`,
};

fs.mkdirSync(__dirname + '/../doc', { recursive: true });
for (const f of Object.keys(F)) fs.writeFileSync(`${__dirname}/../doc/${f}.md`, factionMd(f, intros[f]));
fs.writeFileSync(`${__dirname}/../doc/shared.md`, sharedMd());
console.log('written', Object.keys(F).map(f => `doc/${f}.md`).join(', '), 'doc/shared.md');
for (const f of Object.keys(F)) console.log(f, fs.statSync(`${__dirname}/../doc/${f}.md`).size, 'bytes');
console.log('shared', fs.statSync(`${__dirname}/../doc/shared.md`).size);
