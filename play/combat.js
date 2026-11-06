// Damage model (round 1 playtest, 2026-11-07): weapon type × armour type table from data/combat.json.
// Every weapon gets a type (rifle, carbine, cannon_heavy, at_rocket, ...); every unit and structure an armour type
// (infantry, light, medium, heavy, aircraft, ship, structure). Tank and naval shells throw fragments (shell_splash: radius, edge
// factor) that catch the soldiers around the one they hit. Damage per hit = weapon base damage × table[type][armour]
// × veterancy × world.dmgScale (the time-to-kill setting: dmgScale = 1 / ttk). Which targets a weapon can engage still
// comes from the pack (weapon.targets by target class).
export const ARMOUR = {
  H01: 'infantry', H02: 'infantry', HE: 'infantry', AE: 'infantry', TE: 'infantry', A01: 'infantry', A02: 'infantry', T01: 'infantry', T02: 'infantry',
  H03: 'heavy', A03: 'medium', T03: 'light', HV: 'heavy',
  H04: 'aircraft', A04: 'aircraft', T04: 'aircraft',
  H05: 'ship', A05: 'ship', T05: 'ship',
};
export const WEAPON_TYPE = {
  'H01:0': 'rifle', 'A01:0': 'carbine', 'A01:1': 'mg', 'T01:0': 'pulse', 'T04:0': 'pulse_light',
  'H02:0': 'at_rocket', 'H02:1': 'aa_rocket', 'T02:0': 'lance', 'T02:1': 'lance_aa',
  'H03:0': 'cannon_heavy', 'A03:0': 'cannon_precision', 'T03:0': 'accelerator',
  'H04:0': 'attack_rocket', 'A04:0': 'bomb', 'H05:0': 'naval_gun',
  'A05:0': 'ship_missile', 'A05:1': 'aa_missile', 'T05:0': 'raider_sea', 'T05:1': 'raider_shore',
};
export const ARMOURS = ['infantry', 'light', 'medium', 'heavy', 'aircraft', 'ship', 'structure'];
const CLASS_OF_ARMOUR = { infantry: 'infantry', light: 'light', medium: 'heavy', heavy: 'heavy', aircraft: 'air', ship: 'naval', structure: 'building' };

/** starting table from the pack's own per-weapon multipliers (medium and heavy both read the pack's 'heavy') */
export function packTable(spec) {
  const T = {};
  for (const u of spec.units) u.weapons.forEach((w, i) => { const t = WEAPON_TYPE[`${u.id}:${i}`]; if (!t || T[t]) return; T[t] = {}; for (const a of ARMOURS) T[t][a] = +(w.multipliers[CLASS_OF_ARMOUR[a]] || 0).toFixed(4); });
  return T;
}

/** tag the spec's weapons and units; returns the multiplier function for world.damageMul */
export function applyCombat(spec, combat) {
  const SPL = combat.shell_splash || {};
  for (const u of spec.units) { u.armour_type = ARMOUR[u.id] || u.armor; u.weapons.forEach((w, i) => { w.wtype = WEAPON_TYPE[`${u.id}:${i}`] || null; const sp = SPL[w.wtype]; if (sp) { w.shell_splash_m = sp[0]; w.shell_splash_edge = sp[1]; } }); }
  const T = combat.table;
  return (w, o) => {
    const a = o.isBuilding ? 'structure' : (o.sp && o.sp.armour_type) || 'heavy', row = w.wtype && T[w.wtype];
    if (!row) return w.multipliers[o.isBuilding ? 'building' : o.sp.armor] || 0;
    return row[a] || 0;
  };
}
