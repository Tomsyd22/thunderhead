// Thunderhead — shared rules. Single source of truth for sim, doc tables and prototype.
// Units: distance in cells, time in seconds, speed in cells/second.
const RULES = {
  version: 1,
  economy: {
    startingCredits: 10000,
    oreBail: 25,            // tantalum
    gemBail: 50,            // cobalt vein
    harvesterCapacity: 20,  // bails
    sellRefund: 0.5,        // selling a structure
    repairCostFraction: 0.5,// repairing full HP costs 50% of structure price
    grinderRefund: 0.5,     // Helix Black Market / Lattice Reclaimer
    derrickIncome: 20,      // per 10s, captured tech oil/gas derrick
    buildTimeSecondsPer100Credits: 1.6, // $900 tank = 14.4s at one factory
    extraFactoryMultiplier: 0.75,       // each extra factory of the type: time × 0.75 (min 0.5)
  },
  power: {
    lowPowerBuildMultiplier: 2.0, // production twice as slow
    lowPowerDefencesOffline: true,
    lowPowerRadarOffline: true,
  },
  base: {
    buildRadiusCells: 12,          // from Construction Yard / any own structure (adjacency)
    mcvDeployTime: 3,
    engineerCaptureThreshold: 1.0, // single engineer captures (RA2-style)
    garrisonInfantryDamageBonus: 1.25,
    garrisonArmourFactor: 0.5,     // garrisoned infantry take 50%
    proneDamageFactor: 0.5,        // infantry prone under fire (RA2) — not all units can prone
    crushHeavyVehiclesCrushInfantry: true,
  },
  veterancy: {
    // XP = cost of units destroyed. Veteran at 1x own cost? RA2 uses VeteranRatio = 3.0 (kill 3x own cost).
    veteranRatio: 3.0,
    eliteRatio: 6.0, // cumulative (RA2: elite at another 3x)
    veteran: { firepower: 1.25, armour: 0.8, speed: 1.1, rof: 1.0, sightBonus: 1, selfHeal: 0 },
    elite:   { firepower: 1.5,  armour: 0.65, speed: 1.2, rof: 0.8, sightBonus: 2, selfHeal: 0.02 }, // selfHeal: fraction HP/sec
  },
  healthBar: { yellowBelow: 0.5, redBelow: 0.25 }, // fraction of HP
  armourTypes: ['none','flak','plate','light','medium','heavy','wood','steel','concrete'],
  // "Verses": fraction of listed damage applied to each armour type (RA2 model).
  warheads: {
    //            none  flak  plate light med   heavy wood  steel conc
    SA:        [1.00, 0.90, 0.60, 0.25, 0.15, 0.10, 0.30, 0.15, 0.10], // rifles, machine guns
    HE:        [0.90, 0.90, 1.00, 0.50, 0.35, 0.25, 0.80, 0.60, 0.50], // grenades, autocannon frag
    AP:        [0.25, 0.25, 0.25, 1.00, 1.00, 0.90, 0.75, 0.60, 0.50], // tank cannon
    ROCKET:    [0.30, 0.30, 0.30, 1.00, 0.90, 0.75, 0.60, 0.50, 0.40], // AT missiles
    FLAK:      [1.00, 1.00, 0.90, 0.60, 0.25, 0.15, 0.30, 0.20, 0.10], // AA frag; aircraft use light/medium
    BEAM:      [0.60, 0.60, 0.60, 1.00, 1.00, 1.00, 1.00, 1.00, 0.90], // lasers, railguns
    SIEGE:     [0.60, 0.60, 0.50, 0.70, 0.60, 0.50, 1.00, 1.00, 1.00], // artillery, bombs
    TOXIN:     [1.00, 1.00, 1.00, 0.20, 0.10, 0.05, 1.00, 0.20, 0.10], // nanodust, fire, radiation
    EMP:       [0.00, 0.00, 0.00, 1.00, 1.00, 0.70, 0.50, 0.50, 0.50], // no HP damage; disable seconds = damage × verse / 10
    SUPER:     [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00], // C4, hero charges
    HACK:      [0.00, 0.00, 0.00, 1.00, 1.00, 1.00, 0.00, 1.00, 1.00], // control, see hack rules
  },
  // Which armour an object class uses by default (for aircraft/naval mapping in the sim)
  // Aircraft are hit harder by dedicated AA than their nominal armour suggests (RA2 Kirov problem avoided).
  aircraftModifier: { FLAK: { light: 1.0, medium: 0.9, heavy: 0.75 }, ROCKET: { light: 1.0, medium: 0.9, heavy: 0.8 }, BEAM: { light: 1.0, medium: 1.0, heavy: 1.0 } },
  classArmour: { infantry: 'none', drone: 'flak', vehicle: 'medium', aircraft: 'light', naval: 'heavy', structure: 'concrete' },
  hack: {
    temporarySeconds: 12,       // Netrunner rookie/veteran
    permanentAtElite: true,
    immuneTags: ['hero','mcv','harvester-lattice','superweapon'],
    puppeteerMaxControlled: 3,
    puppeteerOverloadDamagePerSec: 20,
  },
  emp: {
    disableSecondsPerPoint: 0.1, // EMP damage 100 vs light = 10s disable
    latticeExtraFactor: 1.5,     // Lattice machines take 1.5× EMP duration
  },
  stealth: {
    detectorsRevealRadius: 6,
    cloakBreakOnFire: true,
    recloakDelay: 3,
  },
  superweapons: {
    chargeSeconds: 600,         // main superweapon (RA2: 10 min)
    supportChargeSeconds: 420,  // support superweapon (RA2 Iron Curtain / Chrono: 7 min; Force Shield 5 min)
  },
  doctrines: {
    pointsPerMinute: 1,         // Doctrine points earned over the match (RA3: by time + kills)
    pointsPerKillCredits: 0.0004, // 1 point per $2500 destroyed
    maxTier: 3,
  },
  unitCap: 400, // objects per player (multiplayer default)
};
if (typeof module !== 'undefined') module.exports = RULES;
