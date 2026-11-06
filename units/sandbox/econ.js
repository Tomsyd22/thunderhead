// Unit Sandbox economy: one ore refinery and two extraction rigs on the test range, and the harvester's spec.
// The pack has no harvester, so it uses the maps' unit_harvester model and the harvester settings in data/pace.json.
// Geometry follows the maps' assets (maps/assets/bounds): refinery bay along +y with the unloading grate at local
// (7.5, −5.2) and the approach point 25.2 m in front of it; rig service point 21 m from the rig centre.
import { FEATURES } from './terrain.js';

export const HV_SPEC = (speed) => ({
  id: 'HV', name: 'Harvester', faction: 'N', faction_name: 'NEUTRAL', category: 'Vehicle', role: 'Ore harvester (maps asset unit_harvester)',
  dimensions_m: { length: 10, width: 4, height: 4 }, health: 1200, armor: 'heavy', cost: 1400, speed_mps: speed, sight_m: 30,
  collision_radius_m: 2.0, collision_shape: { type: 'horizontal_capsule', radius_m: 2.0, total_length_m: 10, ground_blocking: true }, weapons: [],
});

export function econLayout() {
  const E = FEATURES.econ, R = E.refinery;
  const grate = [R.x + 7.5, R.y - 5.2], approach = [R.x + 7.5, R.y + 20];
  const dock = { grate, approach, face: Math.atan2(approach[1] - grate[1], approach[0] - grate[0]) };
  const deposits = E.deposits.map((d) => ({ id: d.id, name: d.name, rig: d.rig, dir: d.dir, svc: [d.rig[0] + d.dir[0] * 21, d.rig[1] + d.dir[1] * 21], centre: [d.rig[0] + d.dir[0] * 8, d.rig[1] + d.dir[1] * 8],
    rot: Math.atan2(d.dir[1], d.dir[0]) + Math.PI / 2 }));   // rig model: chute on its local −y side faces the service point
  const buildings = [
    { name: 'Ore refinery', kind: 'refinery', model: 'bld_ore_refinery', x: R.x, y: R.y, w: 36, d: 28, h: 16, hp: 4000, rot: 0,
      blocks: [{ x: R.x - 7, y: R.y, w: 22, d: 28 }, { x: R.x + 14.5, y: R.y, w: 7, d: 28 }] },   // the 7 m drive-through bay (local x 4…11) stays open
    ...deposits.map((d) => ({ name: `Extraction rig (${d.id})`, kind: 'rig', model: 'bld_extraction_rig', x: d.rig[0], y: d.rig[1], w: 16, d: 12, h: 12, hp: 2500, rot: d.rot, deposit: d.id })),
  ];
  return { dock, deposits, buildings };
}
