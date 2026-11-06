// Match setup shared by the browser client and the headless tests: unit specs (+ harvester), the engine World on the map's
// navigation, the game layer (players, economy, production) and the AI players. No DOM, no three.js.
import { World, MECH } from './engine/mech.js';
import { harvesterSandboxSpeed } from './engine/pace.js';
import { makeMapNav } from './mapnav.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { FACTIONS } from './rules.js';

// The pack has no harvester: it drives the maps' unit_harvester model with the pace settings (data/pace.json)
export const HV_SPEC = (speed) => ({
  id: 'HV', name: 'Harvester', faction: 'N', faction_name: 'NEUTRAL', category: 'Vehicle', role: 'Ore harvester',
  dimensions_m: { length: 10, width: 4, height: 4 }, health: 1200, armor: 'heavy', cost: 1400, speed_mps: speed, sight_m: 30,
  collision_radius_m: 2.0, collision_shape: { type: 'horizontal_capsule', radius_m: 2.0, total_length_m: 10, ground_blocking: true }, weapons: [],
});

/** display names and faction labels from the approved mapping (game names win clashes: Lancer → Arbiter, ...) */
export function applyMapping(spec, mapping) {
  const by = new Map((mapping.units || []).map((u) => [u.pack_id, u]));
  for (const u of spec.units) { const m = by.get(u.id); if (!m) continue; u.pack_name = u.name; u.name = m.display_name || u.name; u.game_faction = m.faction; if (m.faction) u.faction_name = FACTIONS[m.faction].name; }
  return spec;
}

/**
 * T: map terrain (mapdata.js); spec: parsed unit_specs.json (+ mapping applied); pace: data/pace.json (live object, sliders
 * write to it); players: [{ faction, isAI, pad: 'B1' | 'R1', name }]; opts.startUnits: extra starting squad.
 */
export function createMatch({ T, spec, geom = {}, pace, players, startUnits = true }) {
  spec = structuredClone(spec);
  spec.units = spec.units.filter((u) => u.id !== 'HV'); spec.units.push(HV_SPEC(harvesterSandboxSpeed(pace)));
  MECH.HV.accel = pace.harvester.accel_mps2; MECH.HV.hullTurn = pace.harvester.hull_turn_dps;
  const nav = makeMapNav(T);
  const world = new World({ spec, T, geom, nav }); world.sharedPaths = true; world.planPerTick = 4; world.pace = pace;
  const pads = T.meta.pads;
  const setup = players.map((p) => ({ ...p, start: Object.assign({ x: 0, y: 0 }, (() => { const pd = pads.find((q) => q.id === p.pad); return { x: pd.center[0], y: pd.center[1], pad: pd }; })()) }));
  const game = new Game({ world, T, players: setup, deposits: T.meta.deposits, dockSites: T.meta.docks || [], pace });
  const kits = nav.kits;
  const ais = [];
  game.players.forEach((p, i) => {
    const pad = setup[i].start.pad, mine = kits.filter((r) => Math.abs(r.x - pad.center[0]) < pad.size[0] / 2 + 20 && Math.abs(r.y - pad.center[1]) < pad.size[1] / 2 + 20);
    const hq = mine.find((r) => r.asset === 'bld_hq') || { x: pad.center[0], y: pad.center[1] };
    const yard = game.addStart(p, 'yard', hq.x, hq.y, game.autoRot(p, 'yard', hq.x, hq.y));
    p.start.x = yard.x; p.start.y = yard.y; p.yard = yard.id;
    p.rally = [pad.rally ? pad.rally[0] : yard.x, pad.rally ? pad.rally[1] : yard.y];
    if (startUnits) {   // a small starting squad on the pad in front of the yard
      const F = FACTIONS[p.faction], inf = F.infantry[0], tank = F.vehicle.find((u) => u !== 'HV');
      const toC = Math.atan2(T.H / 2 - yard.y, T.W / 2 - yard.x), ox = Math.cos(toC), oy = Math.sin(toC);
      const list = [inf, inf, inf, inf, tank, tank];
      list.forEach((uid, k) => { const s = k < 4 ? 26 : 38, lat = k < 4 ? (k - 1.5) * 3.2 : (k - 4.5) * 9;
        const u = world.spawn(uid, p.team, yard.x + ox * s - oy * lat, yard.y + oy * s + ox * lat, { hdg: toC }); u.owner = p.id; u.born = 0; });
    }
    if (setup[i].isAI) ais.push(new AI(game, p, mine.map((r) => [r.asset, r.x, r.y])));
  });
  return { world, game, ais, nav };
}

/** one simulation tick (TICK game seconds): engine step, then the game layer reads the tick's events; AI thinks once per game second */
export function stepMatch(M, TICK) {
  M.world.step(); M.game.tick(TICK);
  const t = M.world.t; if (Math.floor(t) !== Math.floor(t - TICK)) for (const a of M.ais) a.think();
}
