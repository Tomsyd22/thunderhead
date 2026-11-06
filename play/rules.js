// Thunderhead Stage 2 rules: factions, structures, production, economy. All times are GAME seconds (data/pace.json game
// speed scales them all). Unit stats come from the pack (data/unit_specs.json); faction slots and display names from
// data/faction_mapping.json (approved 2026-11-06).
export const RULES = {
  startCredits: 10000,
  buildRate: 24,            // credits spent per game second on the item at the head of a queue (cost 900 → 37.5 game s)
  lowPowerRate: 0.5,        // production speed while power used > power made
  bailValue: 25,            // credits per bail; a full harvester (20 bails) is worth 500
  buildGap: 40,             // a new structure must lie within 40 m (edge to edge) of one of the player's structures
  footprintGap: 3,          // minimum gap between structures (m)
  maxQueue: 9,
  maxSlope: 1.6,            // max height difference under a footprint (m); pads are flat
};

// structures: model = maps asset (bld_*), size [w, d] in model axes (x, y), doors in model coordinates (y negative = south face)
export const STRUCTURES = {
  yard:     { name: 'Construction Yard', model: 'bld_hq', h: 10, size: [30, 24], hp: 3000, cost: 3000, power: 0, buildable: false, exit: [0, -19], icon: 'yard', desc: 'Builds structures.' },
  power:    { name: 'Power Plant', model: 'bld_power_substation', h: 6, size: [20, 16], hp: 1000, cost: 800, power: 200, requires: [], desc: 'Supplies 200 power. Low power halves production.' },
  refinery: { name: 'Ore Refinery', model: 'bld_ore_refinery', h: 16, size: [36, 28], hp: 1800, cost: 2000, power: -50, requires: ['power'], freeUnit: 'HV',
              blocks: [[-7, 0, 22, 28], [14.5, 0, 7, 28]], dock: { grate: [7.5, -5.2], approach: [7.5, 20] }, desc: 'Processes ore. Comes with a harvester.' },
  barracks: { name: 'Barracks', model: 'bld_barracks', h: 6, size: [24, 12], hp: 1000, cost: 500, power: -10, requires: ['power'], produces: 'infantry', exit: [0, -13], desc: 'Trains infantry.' },
  factory:  { name: 'War Factory', model: 'bld_vehicle_factory', h: 12, size: [40, 30], hp: 2000, cost: 2000, power: -25, requires: ['refinery'], produces: 'vehicle', exit: [0, -22], spawn: [0, -6], desc: 'Builds vehicles and harvesters.' },
  radar:    { name: 'Radar', model: 'bld_radar_control', h: 9, size: [16, 12], hp: 1000, cost: 1000, power: -40, requires: ['refinery'], desc: 'Unlocks the airpad.' },
  airpad:   { name: 'Airpad', model: 'airpad', h: 2, size: [26, 26], hp: 1200, cost: 1000, power: -20, requires: ['radar'], produces: 'air', pad: [0, 0], desc: 'Builds aircraft; jets land here to rearm.' },
  naval:    { name: 'Naval Yard', model: 'bld_naval_dock', h: 8, size: [80, 40], hp: 2000, cost: 1000, power: -20, requires: ['refinery'], produces: 'naval', exit: [0, -34], naval: true, desc: 'Builds ships. Placed at the shore dock site.' },
};

// what each production category builds, per faction (pack unit ids; HV = harvester, maps model)
export const FACTIONS = {
  compact: { name: 'The Compact', theme: 'Cold War 2.0', pack: 'H', color: '#c4574d', infantry: ['H01', 'H02'], vehicle: ['H03', 'HV'], air: ['H04'], naval: ['H05'] },
  lattice: { name: 'The Lattice', theme: 'Drones and AI', pack: 'T', color: '#2fb3a8', infantry: ['T01', 'T02'], vehicle: ['T03', 'HV'], air: ['T04'], naval: ['T05'] },
  helix:   { name: 'Helix Dynamics', theme: 'Cyberpunk megacorps', pack: 'A', color: '#b04fd6', infantry: ['A01'], vehicle: ['A03', 'HV'], air: ['A04'], naval: ['A05'] },
};
export const CATEGORY_OF = (uid, fac) => ['infantry', 'vehicle', 'air', 'naval'].find((c) => FACTIONS[fac][c].includes(uid));
export const BUILDING_FOR = { infantry: 'barracks', vehicle: 'factory', air: 'airpad', naval: 'naval' };
// item hotkeys inside the open build tab, by position (never clash with order keys A S G D F H or the tab keys)
export const ITEM_KEYS = ['z', 'x', 'c', 'v', 'b', 'n', 'm'];
export const TAB_KEYS = { structure: 'q', infantry: 'w', vehicle: 'e', air: 'r', naval: 't' };
