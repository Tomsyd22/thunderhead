/* Thunderhead simulation core — no DOM, no rendering. Globals in: RULES, LATTICE, COMPACT, HELIX. Global out: SIM. */
const SIM = (() => {
'use strict';
const CELL = 32, MAPW = 72, MAPH = 54, DT = 1 / 30;
const ALL = [].concat(LATTICE, COMPACT, HELIX, CIV);
const TT = MAPGEN.T;
const BY = Object.fromEntries(ALL.map(u => [u.id, u]));
const AT = Object.fromEntries(RULES.armourTypes.map((a, i) => [a, i]));
const FACTIONS = {
  lattice: { name: 'The Lattice', color: 0x2ec4d6, dark: 0x0d5b66, css: '#2ec4d6', ai: ['lat_reactor', 'lat_extractor', 'lat_fabbay', 'lat_assembly', 'lat_reactor', 'lat_sentinel', 'lat_extractor', 'lat_uplink', 'lat_reactor', 'lat_lance', 'lat_hangar', 'lat_sentinel', 'lat_reactor', 'lat_pylon', 'lat_logic', 'lat_reactor', 'lat_nullifier', 'lat_kessler', 'lat_reactor'],
    army: [['lat_scuttler', 5], ['lat_hornet', 3], ['lat_phalanx', 4], ['lat_lamplighter', 1], ['lat_lancer', 2], ['lat_raptor', 1], ['lat_nullproj', 1], ['lat_wasp', 1], ['lat_colossus', 2], ['lat_stratos', 1], ['lat_aria', 1]] },
  compact: { name: 'The Compact', color: 0xd9a441, dark: 0x5a3f12, css: '#d9a441', ai: ['cmp_reactor', 'cmp_refinery', 'cmp_barracks', 'cmp_armour', 'cmp_reactor', 'cmp_bunker', 'cmp_refinery', 'cmp_radar', 'cmp_reactor', 'cmp_sam', 'cmp_airfield', 'cmp_railturret', 'cmp_reactor', 'cmp_depot', 'cmp_research', 'cmp_reactor', 'cmp_arsenal', 'cmp_silo', 'cmp_reactor'],
    army: [['cmp_rifleman', 4], ['cmp_rockettrooper', 3], ['cmp_bastion', 4], ['cmp_grenadier', 1], ['cmp_hunter', 2], ['cmp_hailstorm', 1], ['cmp_falcon', 1], ['cmp_scoutcar', 1], ['cmp_behemoth', 2], ['cmp_strato', 1], ['cmp_ironside', 1]] },
  helix: { name: 'Helix Dynamics', color: 0xe0479e, dark: 0x5c1740, css: '#e0479e', ai: ['hlx_solar', 'hlx_refinery', 'hlx_office', 'hlx_plant', 'hlx_solar', 'hlx_autoturret', 'hlx_refinery', 'hlx_surveil', 'hlx_solar', 'hlx_flaknest', 'hlx_skyport', 'hlx_stuntower', 'hlx_solar', 'hlx_market', 'hlx_campus', 'hlx_solar', 'hlx_vats', 'hlx_blackout', 'hlx_solar'],
    army: [['hlx_contractor', 5], ['hlx_arbiter', 4], ['hlx_enforcer', 2], ['hlx_netrunner', 2], ['hlx_suppressor', 2], ['hlx_shade', 1], ['hlx_dragonfly', 1], ['hlx_interceptor', 1], ['hlx_mogul', 2], ['hlx_puppeteer', 1], ['hlx_specter', 1], ['hlx_vesper', 1]] },
};
const EXCLUDE = new Set(['lat_fabricator', 'lat_ferry', 'lat_kite', 'lat_seaskiff', 'lat_fence', 'cmp_mcv', 'cmp_landingcraft', 'cmp_pelican', 'cmp_wall', 'cmp_trench', 'hlx_mobilehq', 'hlx_hovertrans', 'hlx_courierair', 'hlx_wall', 'hlx_ghost']);
const buildable = d => !d.hidden && d.tier <= 3 && !EXCLUDE.has(d.id) && d.faction !== 'civ' && !(d.tags || []).includes('spawned');
const FOOT = d => d.foot ? d.foot : d.cls === 'defence' ? [1, 1] : /Construction/.test(d.role) ? [3, 3] : /Refinery/.test(d.role) ? [3, 2] : /production/.test(d.role) ? (/Infantry/.test(d.role) ? [2, 2] : [3, 2]) : /Power/.test(d.role) ? [2, 2] : /Mesh node/.test(d.role) ? [1, 1] : [2, 2];
const isAir = d => d.cls === 'aircraft', isNaval = d => d.cls === 'naval', isInf = d => d.cls === 'infantry' || d.cls === 'drone', isStruct = d => d.cls === 'structure' || d.cls === 'defence';
const hasTag = (d, t) => (d.tags || []).includes(t);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hostile = (pa, pb) => pa !== pb && pa.team !== pb.team;
const enemiesOf = p => G.players.filter(q => q !== p && !q.lost && q.team !== p.team);
function nearestEnemyPlayer(p) { const home = G.ents.find(e => !e.dead && e.owner === p && isStruct(e.def)); let best = null, bd = 1e9; for (const q of enemiesOf(p)) { const h = G.ents.find(e => !e.dead && e.owner === q && isStruct(e.def)) || G.ents.find(e => !e.dead && e.owner === q); if (!h) continue; const dd = home ? dist(home, h) : 0; if (dd < bd) { bd = dd; best = q; } } return best; }
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

function canHit(w, a, t) {
  if (w.dmg <= 0 && w.wh !== 'HACK') return false; if (w.spawns) return false;
  if (isAir(t) && !w.aa) return false; if (!isAir(t) && !w.ag) return false;
  if (w.antiSub) return !!t.submerged; if (w.naval) return isNaval(t) || t.amphibious; if (t.submerged) return false;
  if (w.vsInfantryOnly && !isInf(t)) return false; if (w.vsVehicleOnly && isInf(t)) return false; if (w.vsStructureOnly && !isStruct(t)) return false;
  if (w.wh === 'HACK' && (isInf(t) || hasTag(t, 'nohack') || hasTag(t, 'hero') || hasTag(t, 'mcv') || isStruct(t) || (hasTag(t, 'harvester') && t.faction === 'lattice'))) return false;
  if (w.wh === 'EMP' && isInf(t) && !hasTag(t, 'machine')) return false;
  if (w.wh === 'TOXIN' && hasTag(t, 'machine') && !isInf(t)) return false;
  return true;
}
function verse(w, t) {
  if (w.wh === 'EMP' && hasTag(t, 'machine') && isInf(t)) return 1;
  if (isAir(t) && RULES.aircraftModifier[w.wh] && RULES.aircraftModifier[w.wh][t.armour] != null) return RULES.aircraftModifier[w.wh][t.armour];
  return RULES.warheads[w.wh][AT[t.armour]];
}

const G = { t: 0, ents: [], byId: new Map(), nextId: 1, players: [], terrain: new Uint8Array(MAPW * MAPH), ore: new Float32Array(MAPW * MAPH), oreKind: new Uint8Array(MAPW * MAPH), occ: new Int32Array(MAPW * MAPH).fill(-1), events: [], over: null, speed: 1, msgs: [], seed: 1 };
const idx = (cx, cy) => cy * MAPW + cx;
const inMap = (cx, cy) => cx >= 0 && cy >= 0 && cx < MAPW && cy < MAPH;
const emit = ev => G.events.push(ev);
function genMapOld(seed) {
  let s = seed >>> 0; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  G.terrain.fill(0); G.ore.fill(0); G.oreKind.fill(0);
  // rock outcrops, mirrored-ish, away from the two start corners
  for (let i = 0; i < 30; i++) { const cx = 4 + Math.floor(r() * (MAPW - 8)), cy = 4 + Math.floor(r() * (MAPH - 8)); if ((cx < 18 && cy < 16) || (cx > MAPW - 19 && cy > MAPH - 17)) continue; const w = 1 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 3); for (let x = cx; x < cx + w; x++) for (let y = cy; y < cy + h; y++) if (inMap(x, y)) { G.terrain[idx(x, y)] = 1; G.terrain[idx(MAPW - 1 - x, MAPH - 1 - y)] = 1; } }
  // trees/scrub (terrain 2 = passable decoration)
  for (let i = 0; i < 120; i++) { const x = Math.floor(r() * MAPW), y = Math.floor(r() * MAPH); if (!G.terrain[idx(x, y)]) G.terrain[idx(x, y)] = 2; }
  const field = (cx, cy, rad, kind, amt) => { for (let x = cx - rad; x <= cx + rad; x++) for (let y = cy - rad; y <= cy + rad; y++) if (inMap(x, y) && Math.hypot(x - cx, y - cy) <= rad + r() * 0.8 && G.terrain[idx(x, y)] !== 1) { G.ore[idx(x, y)] = amt * (0.6 + r() * 0.8); G.oreKind[idx(x, y)] = kind; G.terrain[idx(x, y)] = 0; const mi = idx(MAPW - 1 - x, MAPH - 1 - y); G.ore[mi] = amt * (0.6 + r() * 0.8); G.oreKind[mi] = kind; G.terrain[mi] = 0; } };
  field(15, 10, 3, 1, 40); field(9, 24, 3, 1, 45); field(32, 13, 3, 1, 50); field(14, 42, 2, 2, 25); field(36, 27, 2, 2, 30);
}

function mk(defId, owner, cx, cy, opts = {}) {
  const d = BY[defId]; const e = { id: G.nextId++, def: d, owner, hp: d.hp, dead: false, cds: (d.weapons || []).map(() => 0), xp: 0, rank: 0, target: null, order: null, path: [], disabled: 0, deployed: false, cloaked: !!(d.cloak || d.cloakIdle), moved: false, ammo: d.ammo || Infinity, rearm: 0, shield: d.shield ? d.shield.hp : 0, carry: 0, carryKind: 1, mineT: 0, hackedBy: null, hackUntil: 0, origOwner: owner, facing: owner.ai ? Math.PI : 0, turret: 0, aim: null, cx, cy, lastHit: -99, lastFire: -99, building: opts.instant ? 0 : (isStruct(d) ? 1 : 0), vx: 0, vy: 0 };
  if (isStruct(d)) { const [fw, fh] = FOOT(d); e.fw = fw; e.fh = fh; e.x = (cx + fw / 2) * CELL; e.y = (cy + fh / 2) * CELL; for (let x = cx; x < cx + fw; x++) for (let y = cy; y < cy + fh; y++) G.occ[idx(x, y)] = e.id; if (e.building) e.hp = d.hp * 0.1; }
  else { e.x = cx * CELL; e.y = cy * CELL; }
  G.ents.push(e); G.byId.set(e.id, e); emit({ type: 'spawn', e }); return e;
}
function kill(e, killer) {
  if (e.dead) return; e.dead = true; G.byId.delete(e.id);
  if (isStruct(e.def)) { for (let x = e.cx; x < e.cx + e.fw; x++) for (let y = e.cy; y < e.cy + e.fh; y++) if (G.occ[idx(x, y)] === e.id) G.occ[idx(x, y)] = -1; }
  if (e.def.cls === 'vehicle' || e.def.cls === 'naval') G.wrecks.push({ x: e.x, y: e.y, cost: e.def.cost, t: G.t });
  if (killer && killer.owner !== e.owner && killer.owner.bountyUntil > G.t) killer.owner.credits += Math.round(e.def.cost * 0.2);
  if (killer && killer.owner !== e.owner) { killer.xp += e.def.cost; const need = killer.def.cost * (killer.owner.faction === 'compact' ? 0.8 : 1); const old = killer.rank; if (killer.xp >= need * RULES.veterancy.eliteRatio) killer.rank = 2; else if (killer.xp >= need * RULES.veterancy.veteranRatio) killer.rank = 1; if (killer.rank > old) emit({ type: 'promote', e: killer });
    if (killer.def.bounty || (killer.def.secondary && /Repossess|Hazard/.test(killer.def.secondary.name))) killer.owner.credits += Math.round(e.def.cost * 0.1); }
  if (e.occupants) for (const o of e.occupants) { o.inside = null; kill(o, killer); }
  if (e.inside) { e.inside.occupants = e.inside.occupants.filter(o => o !== e); }
  emit({ type: 'death', e, x: e.x, y: e.y });
  if (!e.owner.ai && isStruct(e.def)) announce('Structure lost', 'bad');
  for (const o of G.ents) if (o.target === e) o.target = null;
}
const rankMult = e => e.rank === 2 ? RULES.veterancy.elite : e.rank === 1 ? RULES.veterancy.veteran : { firepower: 1, armour: 1, speed: 1, rof: 1, selfHeal: 0 };
function damage(e, dmg, src, wh) {
  if (e.dead || dmg <= 0) return; e.lastHit = G.t;
  if (e.def.secondary && e.def.secondary.bonus && e.deployed && e.def.secondary.bonus.taken) dmg *= e.def.secondary.bonus.taken;
  dmg *= rankMult(e).armour;
  { const b = buffOf(e); if (b.invuln) { emit({ type: 'absorb', e }); return; } dmg *= statOf(e, 'taken'); const tw = statOf(e, 'takenWh'); if (wh && tw[wh] != null) dmg *= tw[wh]; }
  if (e.shield > 0) { const s = Math.min(e.shield, dmg); e.shield -= s; dmg -= s; }
  e.hp -= dmg;
  e.owner.lastHitT = G.t; e.owner.lastHitAt = { x: e.x, y: e.y }; if (!e.owner.ai && G.t - (e.owner.lastAttackWarn || -99) > 20) { e.owner.lastAttackWarn = G.t; announce(isStruct(e.def) ? 'Base under attack' : hasTag(e.def, 'harvester') ? 'Harvester under attack' : 'Unit under attack', 'warn'); emit({ type: 'alarm', x: e.x, y: e.y }); }
  if (e.hp <= 0) kill(e, src); else if (e.hp < e.def.hp * 0.5 && !e.saidHurt) { e.saidHurt = true; emit({ type: 'voice', e, cat: 'hurt' }); }
}
function announce(m, kind) { G.msgs.push({ m, t: 5, kind }); if (G.msgs.length > 2) G.msgs.shift(); emit({ type: 'announce', m, kind }); }

// ───────── fog of war ─────────
function updateFog() {
  for (const p of G.players) { const v = p.vis; for (let i = 0; i < v.length; i++) if (v[i] === 2) v[i] = 1; }
  for (const e of G.ents) { if (e.dead || e.inside || e.owner === G.neutral) continue; const v = e.owner.vis; const r = (e.def.sight || (isStruct(e.def) ? 6 : 5)) + (isStruct(e.def) ? Math.max(e.fw, e.fh) / 2 : 0); const cx = e.x / CELL, cy = e.y / CELL; const r2 = r * r; for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(MAPH - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(MAPW - 1, Math.ceil(cx + r)); x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy <= r2) v[idx(x, y)] = 2; } }
  // allies share vision
  for (const p of G.players) for (const q of G.players) if (q !== p && q.team === p.team) { const a = p.vis, b = q.vis; for (let i = 0; i < a.length; i++) if (b[i] > a[i]) a[i] = b[i]; }
}
const visibleTo = (p, e) => { const i = idx(clamp(Math.floor(e.x / CELL), 0, MAPW - 1), clamp(Math.floor(e.y / CELL), 0, MAPH - 1)); if (isStruct(e.def)) return p.vis[i] >= 1 && (p.vis[i] === 2 || e.def.faction === 'civ' || e.seenBy && e.seenBy.has(p.id)); return p.vis[i] === 2; };

// ───────── pathing ─────────
// movement domains: land (default), naval (water only), amphibious (land + water), air (anything)
const domainOf = d => !d ? 'land' : isAir(d) ? 'air' : isNaval(d) ? 'naval' : (d.amphibious || d.hover) ? 'amph' : 'land';
function terrainOk(t, dom) { if (dom === 'air') return true; if (t === TT.ROCK || t === TT.CLIFF) return false; if (dom === 'naval') return t === TT.WATER || t === TT.BRIDGE; if (dom === 'land') return t !== TT.WATER; return true; }
function passable(cx, cy, e, dom) { if (!inMap(cx, cy)) return false; if (!terrainOk(G.terrain[idx(cx, cy)], dom || (e ? domainOf(e.def) : 'land'))) return false; const o = G.occ[idx(cx, cy)]; return o === -1 || (e && o === e.id); }
function lineClear(x0, y0, x1, y1, dom) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL * 0.4)); for (let i = 1; i < n; i++) { const t = i / n; if (!passable(Math.floor((x0 + (x1 - x0) * t) / CELL), Math.floor((y0 + (y1 - y0) * t) / CELL), null, dom)) return false; } return true; }
const isWater = (cx, cy) => inMap(cx, cy) && G.terrain[idx(cx, cy)] === TT.WATER;
function findPath(e, sx, sy, tx, ty) {
  if (isAir(e.def)) return [{ x: tx, y: ty }];
  const dom = domainOf(e.def);
  const s = { x: clamp(Math.floor(sx / CELL), 0, MAPW - 1), y: clamp(Math.floor(sy / CELL), 0, MAPH - 1) }, g = { x: clamp(Math.floor(tx / CELL), 0, MAPW - 1), y: clamp(Math.floor(ty / CELL), 0, MAPH - 1) };
  if (lineClear(sx, sy, tx, ty, dom)) return [{ x: tx, y: ty }];
  let goal = null; for (let r = 0; r < 8 && !goal; r++) for (let dx = -r; dx <= r && !goal; dx++) for (let dy = -r; dy <= r && !goal; dy++) if (Math.abs(dx) === r || Math.abs(dy) === r) if (passable(g.x + dx, g.y + dy, null, dom)) goal = { x: g.x + dx, y: g.y + dy };
  if (!goal) return [];
  const key = (x, y) => y * MAPW + x; const open = [{ x: s.x, y: s.y, f: 0, g: 0 }], came = new Map(), gs = new Map([[key(s.x, s.y), 0]]), closed = new Set(); let n = 0;
  let bestNode = null, bestH = 1e9;
  const build = c => { const p = []; let k = key(c.x, c.y); while (came.has(k)) { const [x, y] = [k % MAPW, Math.floor(k / MAPW)]; p.push({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }); k = came.get(k); } p.reverse(); return p; };
  while (open.length && n++ < 8000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i; const c = open.splice(bi, 1)[0];
    const h = Math.hypot(c.x - goal.x, c.y - goal.y); if (h < bestH) { bestH = h; bestNode = c; }
    if (c.x === goal.x && c.y === goal.y) { const p = build(c); if (goal.x === g.x && goal.y === g.y) p.push({ x: tx, y: ty }); return smooth(p, sx, sy, dom); }
    closed.add(key(c.x, c.y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = c.x + dx, ny = c.y + dy; if (!passable(nx, ny, e, dom) && !(nx === goal.x && ny === goal.y)) continue; if (dx && dy && (!passable(c.x + dx, c.y, e, dom) || !passable(c.x, c.y + dy, e, dom))) continue;
      const k = key(nx, ny); if (closed.has(k)) continue; const tt = G.terrain[idx(nx, ny)]; const ng = c.g + (dx && dy ? 1.414 : 1) + (tt === TT.SCRUB ? 0.3 : tt === TT.ROAD ? -0.2 : 0); if (gs.has(k) && gs.get(k) <= ng) continue; gs.set(k, ng); came.set(k, key(c.x, c.y)); open.push({ x: nx, y: ny, g: ng, f: ng + Math.hypot(nx - goal.x, ny - goal.y) });
    }
  }
  // unreachable: go to the reachable cell closest to the goal (never straight through terrain)
  return bestNode ? smooth(build(bestNode), sx, sy, dom) : [];
}
function smooth(p, sx, sy, dom) { // string pulling
  const out = []; let cur = { x: sx, y: sy }, i = 0;
  while (i < p.length) { let j = p.length - 1; while (j > i && !lineClear(cur.x, cur.y, p[j].x, p[j].y, dom)) j--; out.push(p[j]); cur = p[j]; i = j + 1; }
  return out;
}

// ───────── orders ─────────
function order(e, o) { if (o.type !== 'attackmove') e.groupSpeed = 0;
  if (e.dead || isStruct(e.def)) return; if (hasTag(e.def, 'harvester') && o.type === 'attack') return;
  e.order = o; e.target = o.target || null; e.deployed = false;
  if (o.type === 'move' || o.type === 'attackmove') e.path = findPath(e, e.x, e.y, o.x, o.y);
  if (o.type === 'attack' && o.target) e.path = [];
  if (o.type === 'garrison' || o.type === 'capture') e.path = [];
}
function orderGroup(units, x, y, type) {
  const n = units.length; if (!n) return; const side = Math.ceil(Math.sqrt(n)); const gap = 38;
  const slots = []; for (let i = 0; i < n; i++) slots.push({ x: x + (i % side - (side - 1) / 2) * gap, y: y + (Math.floor(i / side) - (side - 1) / 2) * gap });
  // assign by proximity (greedy)
  const left = units.slice(); for (const s of slots) { let bi = 0, bd = 1e9; for (let i = 0; i < left.length; i++) { const d = Math.hypot(left[i].x - s.x, left[i].y - s.y); if (d < bd) { bd = d; bi = i; } } const u = left.splice(bi, 1)[0]; order(u, { type, x: s.x, y: s.y }); if (!left.length) break; }
  /* formation move: land units in an attack-move group hold the slowest member's pace so armies arrive together (RA3 formation move) */
  if (type === 'attackmove' && n > 2) { const land = units.filter(u => !isAir(u.def) && !isNaval(u.def) && !hasTag(u.def, 'harvester')); if (land.length > 2) { const slow = Math.min(...land.map(u => u.def.speed)); for (const u of land) u.groupSpeed = Math.max(slow, u.def.speed * 0.6); } }
}
function nearestEnemy(e, range, pred) { let best = null, bd = 1e9; for (const o of G.ents) { if (o.dead || o.inside || !hostile(o.owner, e.owner) || o.owner === G.neutral) continue; if (o.cloaked && !canSee(e.owner, o)) continue; if (o.disguised && !hasTag(e.def, 'dog') && !e.def.detector && !(e.target === o)) continue; if (pred && !pred(o)) continue; const d = dist(e, o) - (isStruct(o.def) ? Math.max(o.fw, o.fh) * CELL * 0.45 : 0); if (d < bd && d <= range) { bd = d; best = o; } } return best; }
function canSee(p, o) { if (o.revealedUntil > G.t) return true; const sonar = o.def.submerged; for (const e of G.ents) if (!e.dead && e.owner === p && (e.def.detector || (sonar && (e.def.weapons || []).some(w => w.antiSub))) && dist(e, o) <= RULES.stealth.detectorsRevealRadius * CELL) return true; return false; }
function hitRange(e, w) { return (w.range + (e.deployed && e.def.secondary && e.def.secondary.bonus ? (e.def.secondary.bonus.range || 0) : 0)) * CELL; }

// ───────── tick ─────────
function tick(dt) {
  G.t += dt; G.fogT = (G.fogT || 0) + dt; if (G.fogT > 0.2) { G.fogT = 0; updateFog(); for (const e of G.ents) if (!e.dead && isStruct(e.def)) for (const p of G.players) if (p.vis[idx(clamp(Math.floor(e.x / CELL), 0, MAPW - 1), clamp(Math.floor(e.y / CELL), 0, MAPH - 1))] === 2) { e.seenBy = e.seenBy || new Set(); e.seenBy.add(p.id); } }
  for (const p of G.players) { p.power = 0; p.drain = 0; }
  for (const e of G.ents) if (!e.dead && isStruct(e.def) && !e.building) { if (e.def.power > 0) e.owner.power += e.def.power; else e.owner.drain += -e.def.power; }
  for (const p of G.players) { if (p.powerOutUntil > G.t) p.power = 0; const low = p.drain > p.power; if (low && !p.lowPower && !p.ai) announce('Low power', 'bad'); p.lowPower = low; produce(p, dt); if (p.ai) aiTick(p, dt); }
  derricksAndCrates(dt);
  const live = G.ents.filter(e => !e.dead && !e.inside);
  for (const e of live) stepEntity(e, dt, live);
  for (const e of live) { if (isStruct(e.def) || isAir(e.def)) continue; for (const o of live) { if (o === e || isStruct(o.def) || isAir(o.def)) continue; const dx = e.x - o.x, dy = e.y - o.y, d2 = dx * dx + dy * dy, min = (isInf(e.def) ? 9 : 16) + (isInf(o.def) ? 9 : 16); if (d2 < min * min && d2 > 0.01) { const d = Math.sqrt(d2); const push = (min - d) * dt * 4; e.x += dx / d * push; e.y += dy / d * push; } } e.x = clamp(e.x, 8, MAPW * CELL - 8); e.y = clamp(e.y, 8, MAPH * CELL - 8); }
  for (const m of G.msgs) m.t -= dt; G.msgs = G.msgs.filter(m => m.t > 0);
  for (const p of G.players) { if (p.lost) continue; const alive = live.some(e => e.owner === p && isStruct(e.def) && e.def.cls === 'structure' && e.def.faction !== 'civ'); if (!alive && G.t > 5) { p.lost = true; if (!p.ai) announce(`${p.name} has been eliminated`, 'bad'); else announce(`${p.name} eliminated`, 'good'); } }
  if (!G.over && G.t > 5) { const me = G.players[0]; if (me.lost) { G.over = 'loss'; emit({ type: 'over', result: 'loss' }); } else if (!enemiesOf(me).length) { G.over = 'win'; emit({ type: 'over', result: 'win' }); } }
}
function stepEntity(e, dt, live) {
  const d = e.def; const rm = rankMult(e);
  { const want = e.aim != null ? e.aim : e.facing; const cur = e.turret == null ? e.facing : e.turret; let df = want - cur; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; const mx = (isStruct(d) ? 3 : d.cls === 'vehicle' ? 5 : 12) * dt; e.turret = cur + clamp(df, -mx, mx); }
  if (e.building) { e.building = Math.max(0, e.building - dt / 3); e.hp = Math.min(d.hp, e.hp + d.hp * 0.9 * dt / 3); if (!e.building) emit({ type: 'built', e }); return; }
  if (rm.selfHeal) e.hp = Math.min(d.hp, e.hp + d.hp * rm.selfHeal * dt);
  if (e.hackUntil && G.t > e.hackUntil) { e.owner = e.origOwner; e.hackUntil = 0; e.hackedBy = null; }
  if (d.shield && G.t - e.lastHit > d.shield.regenDelay) e.shield = Math.min(d.shield.hp, e.shield + d.shield.regenPerSec * dt);
  if (e.disabled > 0) { e.disabled -= dt; return; }
  if (d.cloak || d.cloakIdle) e.cloaked = (G.t - e.lastFire > RULES.stealth.recloakDelay) && (!d.cloakIdle || !e.moved) && !(hasTag(d, 'harvester') && e.mining);
  if (d.submerged) e.cloaked = G.t - e.lastFire > 2;
  e.moved = false;
  if (isStruct(d)) { if (e.occupants && e.occupants.length) garrisonFire(e, dt); if (d.cls === 'defence' && !e.owner.lowPower) { const t = acquire(e); e.target = t; if (t) e.aim = Math.atan2(t.y - e.y, t.x - e.x); fireAt(e, dt, t); } if (/Repair|Reclaimer|Black Market|Vehicle production/.test(d.role)) for (const o of live) if (o.owner === e.owner && o.def.cls === 'vehicle' && dist(o, e) < 3 * CELL && o.hp < o.def.hp) { o.hp = Math.min(o.def.hp, o.hp + 15 * dt); } return; }
  (d.weapons || []).forEach((w, i) => { if (!w.spawns) return; e.cds[i] -= dt; const mine = live.filter(s => s.parent === e); if (e.cds[i] <= 0 && mine.length < w.spawnMax) { const s = mk(w.spawns, e.owner, e.x / CELL + rnd(-1, 1), e.y / CELL + rnd(-1, 1)); s.parent = e; e.cds[i] = w.rof; if (e.order && e.order.type === 'attackmove') order(s, { ...e.order }); } });
  if (d.id === 'lat_nullproj' && e.deployed) { for (const o of live) if (hostile(o.owner, e.owner) && o.owner !== G.neutral && !isInf(o.def) && !isStruct(o.def) && dist(o, e) < 5 * CELL) { if (!o.buff || o.buff.name !== 'Suppressed') addBuff(o, { speed: 0.6, rof: 1.4, name: 'Suppressed' }, 0.6); else o.buff.until = G.t + 0.6; } }
  if (hasTag(d, 'harvester')) { harvest(e, dt); return; }
  if (hasTag(d, 'engineer')) { if (e.order && e.order.type === 'capture' && e.order.target && !e.order.target.dead) { const t = e.order.target; if (t.def.faction === 'civ' && !t.def.tech) { e.order = null; return; } if (adjacent(e, t)) { t.owner = e.owner; t.hp = Math.max(t.hp, t.def.hp * 0.5); t.seenBy = null; if (t.def.tech) { e.owner.credits += 1000; announce(e.owner.ai ? 'Enemy captured a derrick' : 'Oil derrick captured: +$1,000', e.owner.ai ? 'warn' : 'good'); } else announce(e.owner.ai ? 'Enemy captured a structure' : 'Structure captured', e.owner.ai ? 'bad' : 'good'); emit({ type: 'capture', e: t }); kill(e); return; } moveAlong(e, dt, t); return; } moveAlong(e, dt, null); return; }
  if (e.order && e.order.type === 'infiltrate') { const t = e.order.target; if (!t || t.dead || t.owner === e.owner || !isStruct(t.def) || !hasTag(d, 'spy')) { e.order = null; } else if (adjacent(e, t)) { infiltrate(e, t); return; } else { moveAlong(e, dt, t); return; } }
  if (e.order && e.order.type === 'salvage') { const b = e.order.target; if (!b || b.dead || b.owner !== e.owner || !/[Ss]alvage|Repair/.test(b.def.role) || isStruct(d)) { e.order = null; } else if (adjacent(e, b)) { const hacked = e.hackedBy || (e.origOwner && e.origOwner !== e.owner); const frac = hacked ? (b.def.grinderHackedRefund || 0.5) : 0.5; const amt = Math.round(d.cost * frac * (e.hp / d.hp * 0.5 + 0.5)); e.owner.credits += amt; e.dead = true; G.byId.delete(e.id); emit({ type: 'sold', e }); emit({ type: 'cratepick', x: b.x, y: b.y, kind: 'salvage', p: e.owner }); if (!e.owner.ai) announce(`${d.name} salvaged: +$${amt}`, 'good'); return; } else { moveAlong(e, dt, b); return; } }
  if (e.order && e.order.type === 'garrison') { const b = e.order.target; if (!b || b.dead || !b.def.garrison || (b.owner !== G.neutral && b.owner !== e.owner) || b.occupants.length >= b.def.garrison) { e.order = null; } else if (adjacent(e, b)) { e.inside = b; b.occupants.push(e); b.owner = e.owner; b.seenBy = null; e.order = null; e.path = []; e.target = null; emit({ type: 'garrison', e, b }); return; } else { moveAlong(e, dt, b); return; } }
  if (isAir(d) && d.ammo) { if (e.ammo <= 0 || e.rearming) { e.rearming = true; const base = nearestOwn(e, o => /Air production/.test(o.def.role) && !o.building); if (base) { if (dist(e, base) > 12) { flyToward(e, base.x, base.y, dt); return; } e.rearm += dt; if (e.rearm >= d.rearmSeconds) { e.ammo = d.ammo; e.rearm = 0; e.rearming = false; } return; } else { e.rearm += dt; if (e.rearm >= d.rearmSeconds * 2) { e.ammo = d.ammo; e.rearm = 0; e.rearming = false; } return; } } }
  let tgt = e.target && !e.target.dead && hostile(e.target.owner, e.owner) ? e.target : null;
  if (tgt && tgt.cloaked && !canSee(e.owner, tgt)) tgt = null;
  if (!tgt && (!e.order || e.order.type !== 'move') && !hasTag(d, 'engineer') && !hasTag(d, 'spy')) tgt = acquire(e);
  e.target = tgt;
  const w0 = tgt ? (d.weapons || []).filter(w => canHit(w, d, tgt.def)) : [];
  if (tgt && w0.length) {
    const rng = Math.max(...w0.map(w => hitRange(e, w))), minR = Math.max(...w0.map(w => (w.minRange || 0) * CELL)), dd = dist(e, tgt) - (isStruct(tgt.def) ? Math.max(tgt.fw, tgt.fh) * CELL * 0.4 : 0);
    const wantCrush = d.cls === 'vehicle' && !d.hover && (d.armour === 'medium' || d.armour === 'heavy') && isInf(tgt.def) && !tgt.def.hover && !tgt.deployed && w0.every(w => verse(w, tgt.def) < 0.5);
    e.aim = Math.atan2(tgt.y - e.y, tgt.x - e.x);
    const driveBy = d.secondary && d.secondary.name === 'Drive-by' && e.order && e.order.type === 'attackmove' && e.path.length;
    if (dd > rng || (wantCrush && dd > 6)) { if (e.deployed) e.deployed = false; if (driveBy) { moveAlong(e, dt, null); if (dd > rng * 1.6) e.target = null; } else moveAlong(e, dt, tgt); }
    else if (dd < minR) { const ang = Math.atan2(e.y - tgt.y, e.x - tgt.x); e.x += Math.cos(ang) * d.speed * CELL * dt; e.y += Math.sin(ang) * d.speed * CELL * dt; e.moved = true; }
    else {
      if (isInf(d)) e.facing = e.aim;
      if (driveBy) moveAlong(e, dt, null);
      const dep = d.secondary && d.secondary.kind === 'deploy' && (d.secondary.bonus || w0.some(w => w.minRange));
      if (dep && !e.deployed) { e.deployT = (e.deployT || 0) + dt; if (e.deployT >= (d.secondary.bonus ? d.secondary.bonus.time : 6)) { e.deployed = true; e.deployT = 0; emit({ type: 'deploy', e }); } return; }
      fireAt(e, dt, tgt);
      if (wantCrush && dd <= 6) { e.crushCd = (e.crushCd || 0) - dt; if (e.crushCd <= 0) { kill(tgt, e); emit({ type: 'crush', x: tgt.x, y: tgt.y }); e.crushCd = 3; } }
    }
    return;
  }
  e.aim = null;
  if (e.order && (e.order.type === 'move' || e.order.type === 'attackmove')) { if (e.path.length) moveAlong(e, dt, null); else e.order = null; }
}
function acquire(e) { const d = e.def; if (toggleEffects(e).aaOnly) { const r = ((d.sight || 5) + 2) * CELL; return nearestEnemy(e, r, o => isAir(o.def) && (d.weapons || []).some(w => w.aa)); } const sight = (isStruct(d) ? Math.max(...(d.weapons || [{ range: 0 }]).map(w => w.range)) : (d.sight || 5)) * CELL + 8; if (hasTag(d, 'harvester')) return null; const ws = (d.weapons || []).filter(w => !w.spawns);
  /* RA2-style threat scan: among enemies in sight, prefer the one our warheads are effective against, weighted by distance; structures only when nothing else is near */
  let best = null, bs = -1; for (const o of G.ents) { if (o.dead || o.inside || !hostile(o.owner, e.owner) || o.owner === G.neutral) continue; if (o.cloaked && !canSee(e.owner, o)) continue; if (o.disguised && !hasTag(d, 'dog') && !d.detector) continue; const hitW = ws.filter(w => canHit(w, d, o.def)); if (!hitW.length) continue; const dd = dist(e, o) - (isStruct(o.def) ? Math.max(o.fw, o.fh) * CELL * 0.45 : 0); if (dd > sight) continue; const v = Math.max(...hitW.map(w => verse(w, o.def))); let sc = v * (isStruct(o.def) ? (o.def.weapons ? 0.8 : 0.3) : 1) / (1 + dd / (5 * CELL)); if (!isStruct(o.def) && o.target === e) sc *= 1.3; if (sc > bs) { bs = sc; best = o; } } return best; }
function nearestOwn(e, pred) { let b = null, bd = 1e9; for (const o of G.ents) if (!o.dead && o.owner === e.owner && pred(o)) { const dd = dist(e, o); if (dd < bd) { bd = dd; b = o; } } return b; }
function flyToward(e, x, y, dt) { if (!canMoveNow(e)) return; const ang = Math.atan2(y - e.y, x - e.x), sp = e.def.speed * CELL * dt * rankMult(e).speed * statOf(e, 'speed'); const dd = Math.hypot(x - e.x, y - e.y); if (dd <= sp) { e.x = x; e.y = y; } else { e.x += Math.cos(ang) * sp; e.y += Math.sin(ang) * sp; } e.facing = lerpAngle(e.facing, ang, 0.15); e.moved = true; }
function moveAlong(e, dt, tgt) {
  const d = e.def; if (!canMoveNow(e)) return; const gs = (e.groupSpeed && e.order && e.order.type === 'attackmove' && !tgt) ? Math.min(d.speed, e.groupSpeed) : d.speed; const sp = gs * CELL * dt * rankMult(e).speed * statOf(e, 'speed');
  if (isAir(d)) { const gx = tgt ? tgt.x : (e.path[0] ? e.path[0].x : e.x), gy = tgt ? tgt.y : (e.path[0] ? e.path[0].y : e.y); flyToward(e, gx, gy, dt); if (!tgt && e.path[0] && dist(e, e.path[0]) < 6) e.path.shift(); return; }
  if (tgt) { e.repathT = (e.repathT || 0) - dt; if (!e.path.length || e.repathT <= 0) { e.path = findPath(e, e.x, e.y, tgt.x, tgt.y); e.repathT = 0.8; } }
  if (!e.path.length) return;
  const wp = e.path[0], ang = Math.atan2(wp.y - e.y, wp.x - e.x), dd = Math.hypot(wp.x - e.x, wp.y - e.y);
  // hull turns before it moves (tanks); infantry/hover turn instantly
  const turnRate = isInf(d) || d.hover ? 1 : 0.18; e.facing = lerpAngle(e.facing, ang, turnRate);
  const align = isInf(d) || d.hover ? 1 : Math.max(0.25, Math.cos(e.facing - ang));
  if (dd <= sp) { e.x = wp.x; e.y = wp.y; e.path.shift(); } else { e.x += Math.cos(ang) * sp * align; e.y += Math.sin(ang) * sp * align; }
  e.moved = true;
  if (d.cls === 'vehicle' && !d.hover && (d.armour === 'medium' || d.armour === 'heavy')) for (const o of G.ents) if (!o.dead && o.owner !== e.owner && isInf(o.def) && !o.def.hover && !o.deployed && dist(e, o) < 12) { kill(o, e); emit({ type: 'crush', x: o.x, y: o.y }); break; }
}
function fireAt(e, dt, tgt) {
  const d = e.def; if (!tgt || !canFireNow(e)) { for (let i = 0; i < e.cds.length; i++) e.cds[i] -= dt; return; }
  const rm = rankMult(e); const tg = toggleEffects(e); const rofMul = statOf(e, 'rof'), dmgMul = statOf(e, 'dmg'), rangeAdd = statOf(e, 'rangeAdd');
  if (tg.aaOnly && !isAir(tgt.def)) return;
  let weapons = d.weapons || []; if (tg.aaLoadout) weapons = [{ name: 'AA missiles', dmg: 90, rof: 0.5, range: 7, wh: 'FLAK', ag: false, aa: true, usesAmmo: true }];
  if (d.submerged) weapons = weapons.filter(w => tg.surfaced ? !!w.surfaceToFire || w.wh === 'ROCKET' : !w.surfaceToFire);
  weapons.forEach((w0, i) => { let w = w0;
    e.cds[i] -= dt; if (w.spawns) return; if (!canHit(w, d, tgt.def)) return; if (e.cds[i] > 0) return;
    const dd = dist(e, tgt) - (isStruct(tgt.def) ? Math.max(tgt.fw, tgt.fh) * CELL * 0.4 : 0); if (dd > hitRange(e, w) + (e.inside ? CELL : 0) + rangeAdd * CELL) return;
    if (!isInf(d) && !isAir(d) && d.cls === 'vehicle' && !hasTag(d, 'harvester')) { const want = Math.atan2(tgt.y - e.y, tgt.x - e.x); let diff = Math.abs(lerpAngle(e.turret, want, 1) - e.turret); if (diff > 0.35) { e.cds[i] = Math.max(e.cds[i], 0); return; } }
    if (w.usesAmmo) { if (e.ammo <= 0) return; e.ammo--; }
    let shots = 0; while (e.cds[i] <= 0) { shots++; e.cds[i] += w.rof * rm.rof * rofMul; }
    if (e.saturate) { e.saturate--; if (e.saturate > 0) e.cds[i] = 0.3; else { e.saturate = 0; e.cds[i] = 20; } }
    e.lastFire = G.t; e.cloaked = false; if (!e.saidAtk || G.t - e.saidAtk > 10) { e.saidAtk = G.t; if (Math.random() < 0.4) emit({ type: 'voice', e, cat: 'attack' }); }
    let pyl = 1; if (e.owner.faction === 'lattice' && G.ents.some(p => !p.dead && p.def.id === 'lat_pylon' && p.owner === e.owner && dist(p, e) < 6 * CELL)) pyl = 1.15;
    let link = 1; if (d.id === 'lat_phalanx') link = 1 + Math.min(0.2, 0.04 * G.ents.filter(o => !o.dead && o !== e && o.def.id === 'lat_phalanx' && o.owner === e.owner && dist(o, e) < 3 * CELL).length);
    const base = w.dmg * (w.burst || 1) * shots * rm.firepower * dmgMul * pyl * link * (e.deployed && d.secondary && d.secondary.bonus ? (d.secondary.bonus.dmg || 1) : 1) * (e.inside ? RULES.base.garrisonInfantryDamageBonus : 1);
    const victims = [tgt]; const cap = w.splash ? Math.max(1, Math.round(Math.PI * w.splash * w.splash)) : 0;
    if (w.splash || w.lineSplash) { const r = (w.splash || w.lineSplash.length) * CELL; victims.push(...G.ents.filter(o => !o.dead && o !== tgt && hostile(o.owner, e.owner) && dist(o, tgt) <= r && canHit(w, d, o.def)).slice(0, cap || 3)); }
    if (w.chain) { const extra = e.refract ? 3 : 1; e.refract = false; victims.push(...G.ents.filter(o => !o.dead && o !== tgt && hostile(o.owner, e.owner) && dist(o, tgt) <= 2.5 * CELL && canHit(w, d, o.def)).slice(0, extra)); }
    if (e.thermo && w.wh === 'HE') { w = Object.assign({}, w, { wh: 'TOXIN', clearsGarrison: true }); e.thermo = false; }
    if (e.resonance) { e.resonance = false; if (isStruct(tgt.def)) w = Object.assign({}, w, { dmg: w.dmg * 2 }); for (const o of G.ents) if (!o.dead && o.owner !== e.owner && isInf(o.def) && dist(o, tgt) < 2 * CELL) o.disabled = Math.max(o.disabled, 2); }
    emit({ type: 'shot', e, w, tgt, x1: e.x, y1: e.y, x2: tgt.x, y2: tgt.y });
    const apply = () => victims.forEach((v, k) => {
      if (v.dead) return; const f = k === 0 ? 1 : (w.chain ? w.chain.falloff : 0.4);
      if (w.wh === 'HACK') { if (k > 0) return; const n = G.ents.filter(h => !h.dead && h.hackedBy === e).length; if (n >= (w.maxControlled || 1)) return; if (!v.hackUntil) v.origOwner = v.owner; v.owner = e.owner; v.hackedBy = e; const perm = w.hackSeconds >= 9999 || e.rank === 2; v.hackUntil = perm ? 0 : G.t + w.hackSeconds; if (perm) v.origOwner = e.owner; v.target = null; v.order = null; emit({ type: 'hack', e: v }); return; }
      if (w.wh === 'EMP') { const sec = base * verse(w, v.def) * RULES.emp.disableSecondsPerPoint * (hasTag(v.def, 'machine') ? RULES.emp.latticeExtraFactor : 1); v.disabled = Math.max(v.disabled, sec * f); emit({ type: 'emp', e: v }); return; }
      let dmg = base * verse(w, v.def) * f; if (w.vsInfantryOnly && hasTag(v.def, 'machine')) dmg *= 0.25; if (w.vsMovingFactor && !isStruct(v.def)) dmg *= w.vsMovingFactor;
      if (v.def.secondary && v.def.secondary.bonus && v.def.secondary.bonus.takenSA && w.wh === 'SA') dmg *= v.def.secondary.bonus.takenSA;
      emit({ type: 'hit', e: v, w, dmg });
      if (w.leavesCloud && k === 0) G.fields.push({ x: v.x, y: v.y, r: w.leavesCloud.radius * CELL, dps: w.leavesCloud.dps, until: w.leavesCloud.seconds, kind: 'nano' });
      if (v.occupants && v.occupants.length && (w.wh === 'TOXIN' || w.clearsGarrison)) { for (const o of v.occupants) damage(o, dmg * 1.5, e, w.wh); v.occupants = v.occupants.filter(o => !o.dead); if (!v.occupants.length) v.owner = G.neutral; return; }
      damage(v, dmg, e, w.wh);
    });
    const beam = ['BEAM', 'EMP', 'HACK', 'TOXIN', 'SA'].includes(w.wh);
    if (beam) apply(); else G.delayed.push({ at: G.t + Math.min(0.6, dd / (w.wh === 'SIEGE' ? 260 : 520)), fn: apply });
    if (w.suicide) kill(e);
  });
}
G.delayed = [];
function runDelayed() { const now = G.t; const keep = []; for (const d of G.delayed) { if (d.at <= now) d.fn(); else keep.push(d); } G.delayed = keep; }
function harvest(e, dt) {
  const d = e.def; const cap = d.capacity || 20; if (toggleEffects(e).noMine) return;
  if (e.target && !e.target.dead && hostile(e.target.owner, e.owner) && d.weapons) { e.aim = Math.atan2(e.target.y - e.y, e.target.x - e.x); fireAt(e, dt, e.target); } else e.aim = null;
  if (e.order && e.order.type === 'move') { if (e.path.length) { moveAlong(e, dt, null); return; } e.order = null; }
  if (e.carry >= cap || (e.returning && e.carry > 0)) {
    e.returning = true; const ref = nearestOwn(e, o => /Refinery/.test(o.def.role) && !o.building); if (!ref) return;
    const dock = { x: ref.x, y: ref.y + ref.fh * CELL * 0.5 + 12 };
    const nearRef = Math.abs(e.x - ref.x) < (ref.fw / 2 + 0.9) * CELL && Math.abs(e.y - ref.y) < (ref.fh / 2 + 0.9) * CELL;
    if (Math.hypot(dock.x - e.x, dock.y - e.y) > 14 && !(nearRef && !e.path.length)) { if (!e.path.length || e.dockFor !== ref.id) { e.path = findPath(e, e.x, e.y, dock.x, dock.y); e.dockFor = ref.id; } moveAlong(e, dt, null); return; }
    e.unloadT = (e.unloadT || 0) + dt; if (e.unloadT > 1.5) { const amt = e.carry * (e.carryKind === 2 ? RULES.economy.gemBail : RULES.economy.oreBail); e.owner.credits += amt * (e.owner.incomeMul || 1); emit({ type: 'unload', e, amt }); e.carry = 0; e.returning = false; e.unloadT = 0; e.oreCell = null; } return;
  }
  if (!e.oreCell || G.ore[idx(e.oreCell.x, e.oreCell.y)] <= 0) { let best = null, bd = 1e9; const ox = e.lastOre ? e.lastOre.x : e.x / CELL, oy = e.lastOre ? e.lastOre.y : e.y / CELL; for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) if (G.ore[idx(x, y)] > 0 && G.occ[idx(x, y)] === -1) { const dd = Math.hypot(x - ox, y - oy) + Math.hypot(x - e.x / CELL, y - e.y / CELL) * 0.5 + (e.owner.vis[idx(x, y)] ? 0 : 15); if (dd < bd) { bd = dd; best = { x, y }; } } e.oreCell = best; e.path = []; if (!best) return; }
  const c = { x: (e.oreCell.x + 0.5) * CELL, y: (e.oreCell.y + 0.5) * CELL };
  if (Math.hypot(c.x - e.x, c.y - e.y) > 12) { if (!e.path.length) e.path = findPath(e, e.x, e.y, c.x, c.y); moveAlong(e, dt, null); e.mining = false; return; }
  e.mining = true; e.mineT += dt; if (e.mineT > 0.5) { e.mineT = 0; const i = idx(e.oreCell.x, e.oreCell.y); if (G.ore[i] > 0) { G.ore[i] -= 1; e.carry++; e.carryKind = G.oreKind[i]; e.lastOre = { ...e.oreCell }; emit({ type: 'mine', x: c.x, y: c.y, kind: e.carryKind }); if (e.carry >= cap) e.returning = true; } }
}

const adjacent = (e, t) => Math.abs(e.x - t.x) < (t.fw / 2 + 0.95) * CELL && Math.abs(e.y - t.y) < (t.fh / 2 + 0.95) * CELL || dist(e, t) < (Math.max(t.fw, t.fh) * 0.5 + 0.7) * CELL;
function infiltrate(e, t) { const p = e.owner, v = t.owner, r = t.def.role; let m = '', em = '';
  if (/Refinery/.test(r)) { const amt = Math.max(0, Math.floor(v.credits * 0.25)); v.credits -= amt; p.credits += amt; m = `Refinery infiltrated: stole $${amt}`; em = `Spy in our refinery: $${amt} stolen`; }
  else if (/Power/.test(r)) { v.powerOutUntil = Math.max(v.powerOutUntil || 0, G.t + 60); m = 'Power plant infiltrated: enemy blacked out for 60 s'; em = 'Spy in our power plant: blackout'; }
  else if (/Radar|mesh hub|detector/.test(r)) { for (const o of G.ents) if (!o.dead && o.owner === v) { const rad = (o.def.sight || 4) + 2, cx = Math.floor(o.x / CELL), cy = Math.floor(o.y / CELL); for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) if (inMap(x, y)) p.vis[idx(x, y)] = 1; } v.radarOffUntil = Math.max(v.radarOffUntil || 0, G.t + 45); m = 'Radar infiltrated: enemy positions revealed'; em = 'Spy in our radar: positions compromised'; }
  else if (/Tech/.test(r)) { p.vetCredits = (p.vetCredits || 0) + 3; m = 'Tech centre infiltrated: next 3 units spawn Veteran'; em = 'Spy in our tech centre'; }
  else if (t.def.superweapon) { v.sw = v.sw || {}; const st = v.sw[t.def.id]; if (st) { st.charge = 0; st.ready = false; } m = `${t.def.superweapon.name} infiltrated: timer reset`; em = `Spy in our ${t.def.name}: timer reset`; }
  else if (/Construction/.test(r)) { for (const tab of Object.keys(v.queue)) for (const q of v.queue[tab]) { v.credits += q.paid; q.paid = 0; q.progress = 0; } m = 'HQ infiltrated: enemy construction reset'; em = 'Spy in our HQ: construction reset'; }
  else if (/production/i.test(r)) { p.vetCredits = (p.vetCredits || 0) + 2; m = `${t.def.name} infiltrated: next 2 units spawn Veteran`; em = `Spy in our ${t.def.name}`; }
  else { const amt = 500; v.credits = Math.max(0, v.credits - amt); p.credits += amt; m = `${t.def.name} infiltrated: +$${amt}`; em = `Spy in our ${t.def.name}`; }
  if (!p.ai) announce(m, 'good'); if (!v.ai && !v.neutral) announce(em, 'bad'); emit({ type: 'infiltrate', e: t, p }); e.dead = true; G.byId.delete(e.id); emit({ type: 'sold', e });
}
// ───────── garrisons, derricks, crates ─────────
function garrisonFire(b, dt) {
  b.occupants = b.occupants.filter(o => !o.dead); if (!b.occupants.length) { b.owner = G.neutral; return; }
  for (const o of b.occupants) { o.x = b.x; o.y = b.y; o.owner = b.owner; let t = o.target && !o.target.dead && o.target.owner !== o.owner ? o.target : null; if (!t) t = nearestEnemy(o, ((o.def.sight || 5) + 1) * CELL, x => (o.def.weapons || []).some(w => canHit(w, o.def, x.def)) && !isStruct(x.def) || (o.def.weapons || []).some(w => canHit(w, o.def, x.def)) && isStruct(x.def)); o.target = t; if (t) { o.aim = Math.atan2(t.y - o.y, t.x - o.x); const dd = dist(o, t) - (isStruct(t.def) ? Math.max(t.fw, t.fh) * CELL * 0.4 : 0); const rng = Math.max(...(o.def.weapons || [{ range: 0 }]).map(w => w.range)) * CELL + CELL; if (dd <= rng) fireAt(o, dt, t); } }
}
function evacuate(b) { if (!b.occupants) return; const occ = b.occupants; b.occupants = []; let i = 0; for (const o of occ) { o.inside = null; const a = i++ * 1.1; o.x = b.x + Math.cos(a) * (Math.max(b.fw, b.fh) * 0.5 + 0.7) * CELL; o.y = b.y + Math.sin(a) * (Math.max(b.fw, b.fh) * 0.5 + 0.7) * CELL; o.target = null; o.order = null; } b.owner = G.neutral; emit({ type: 'evacuate', b }); }
function derricksAndCrates(dt) {
  G.derrickT = (G.derrickT || 0) + dt; if (G.derrickT >= 5) { G.derrickT = 0; for (const e of G.ents) if (!e.dead && e.def.tech && e.owner !== G.neutral) { e.owner.credits += 25; emit({ type: 'derrick', e }); } }
  G.crateT -= dt; if (G.crateT <= 0 && G.crates.length < 4) { G.crateT = 45; for (let tries = 0; tries < 40; tries++) { const cx = 3 + Math.floor(Math.random() * (MAPW - 6)), cy = 3 + Math.floor(Math.random() * (MAPH - 6)); if (!passable(cx, cy, null, 'land') || G.ore[idx(cx, cy)] > 0) continue; const kinds = ['money', 'money', 'heal', 'veteran', 'reveal']; G.crates.push({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, kind: kinds[Math.floor(Math.random() * kinds.length)] }); emit({ type: 'crate', x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL }); break; } }
  for (const c of G.crates) { if (c.taken) continue; for (const e of G.ents) { if (e.dead || e.inside || isStruct(e.def) || isAir(e.def) || e.owner === G.neutral) continue; if (Math.hypot(e.x - c.x, e.y - c.y) < 16) { c.taken = true; const p = e.owner; let m = ''; if (c.kind === 'money') { const amt = 500 + Math.floor(Math.random() * 3) * 250; p.credits += amt; m = `Crate: +$${amt}`; } else if (c.kind === 'heal') { for (const o of G.ents) if (!o.dead && o.owner === p && dist(o, e) < 4 * CELL) o.hp = o.def.hp; m = 'Crate: units repaired'; } else if (c.kind === 'veteran') { e.rank = Math.min(2, e.rank + 1); e.xp = e.def.cost * (e.rank === 2 ? 6 : 3); emit({ type: 'promote', e }); m = `Crate: ${e.def.name} promoted`; } else { for (let i = 0; i < p.vis.length; i++) if (!p.vis[i]) p.vis[i] = 1; m = 'Crate: map revealed'; } if (!p.ai) announce(m, 'good'); emit({ type: 'cratepick', x: c.x, y: c.y, kind: c.kind, p }); break; } } }
  G.crates = G.crates.filter(c => !c.taken);
}

// ───────── production ─────────
function prereqOk(p, d) { return (d.prereq || []).every(id => G.ents.some(e => !e.dead && e.owner === p && e.def.id === id)); }
function countOwn(p, id) { return G.ents.filter(e => !e.dead && e.owner === p && e.def.id === id).length; }
function canBuild(p, d) { if (!buildable(d) || d.faction !== p.faction) return false; if (!prereqOk(p, d)) return false; if (d.buildLimit && countOwn(p, d.id) + (p.queue[tabOf(d)] || []).filter(q => q.def.id === d.id).length + (p.ready && p.ready.id === d.id ? 1 : 0) >= d.buildLimit) return false; return true; }
const tabOf = d => d.cls === 'drone' ? 'infantry' : d.cls;
function factoryFor(p, d) { const role = d.cls === 'infantry' || d.cls === 'drone' ? /Infantry/ : d.cls === 'vehicle' ? /Vehicle production/ : d.cls === 'aircraft' ? /Air production/ : d.cls === 'naval' ? /Naval production/ : /Construction/; return G.ents.filter(e => !e.dead && e.owner === p && isStruct(e.def) && role.test(e.def.role) && !e.building); }
function enqueue(p, d, count = 1) { if (!canBuild(p, d)) return false; if (!factoryFor(p, d).length) return false; const tab = tabOf(d); p.queue[tab] = p.queue[tab] || []; if (tab === 'structure' || tab === 'defence') { if (p.ready || p.queue[tab].length) return false; } for (let i = 0; i < count && p.queue[tab].length < 5; i++) p.queue[tab].push({ def: d, progress: 0, paid: 0 }); return true; }
function dequeue(p, d) { const tab = tabOf(d); const q = p.queue[tab] || []; const i = q.map(x => x.def).lastIndexOf(d); if (i >= 0) { p.credits += q[i].paid; q.splice(i, 1); return true; } if (p.ready === d) { p.credits += d.cost; p.ready = null; return true; } return false; }
function produce(p, dt) {
  for (const tab of Object.keys(p.queue)) {
    const q = p.queue[tab][0]; if (!q) continue; const d = q.def; const facs = factoryFor(p, d).length; if (!facs) { p.credits += q.paid; p.queue[tab].shift(); continue; }
    const total = d.cost / 100 * RULES.economy.buildTimeSecondsPer100Credits * Math.max(0.5, Math.pow(RULES.economy.extraFactoryMultiplier, facs - 1)) * (p.lowPower ? RULES.power.lowPowerBuildMultiplier : 1) / (p.buildMul || 1);
    const rate = dt / total; const costStep = d.cost * rate; if (p.credits < costStep) { if (!p.ai && G.t - (p.lastFundsWarn || -99) > 15) { p.lastFundsWarn = G.t; announce('Insufficient funds', 'warn'); } continue; } p.credits -= costStep; q.paid += costStep; q.progress += rate;
    if (q.progress >= 1) { p.queue[tab].shift(); if (isStruct(d)) { p.ready = d; if (p.freeStructure) { p.freeStructure = false; p.credits += d.cost; } if (!p.ai) announce('Construction complete', 'good'); emit({ type: 'ready', p, d }); if (p.ai) aiPlace(p); } else spawnUnit(p, d); }
  }
}
function spawnUnit(p, d, cloneOf) { const facs = factoryFor(p, d); const f = facs[Math.floor(Math.random() * facs.length)]; const e = mk(d.id, p, f.cx + f.fw / 2, f.cy + f.fh + 0.4);
  if (!isStruct(d) && (countOwn(p, 'cmp_arsenal') || p.vetCredits > 0)) { if (!countOwn(p, 'cmp_arsenal') && p.vetCredits > 0) p.vetCredits--; e.rank = Math.max(e.rank, 1); e.xp = d.cost * 3; }
  if (!cloneOf && isInf(d) && !hasTag(d, 'hero') && countOwn(p, 'hlx_vats')) spawnUnit(p, d, true); if (isAir(d)) { e.x = f.x; e.y = f.y; } if (isNaval(d)) { let best = null, bd = 1e9; for (let y = f.cy - 3; y < f.cy + f.fh + 3; y++) for (let x = f.cx - 3; x < f.cx + f.fw + 3; x++) if (passable(x, y, null, 'naval')) { const dd = Math.hypot(x + 0.5 - f.cx - f.fw / 2, y + 0.5 - f.cy - f.fh / 2); if (dd < bd) { bd = dd; best = { x, y }; } } if (best) { e.x = (best.x + 0.5) * CELL; e.y = (best.y + 0.5) * CELL; } } if (!p.ai) announce('Unit ready', 'good'); emit({ type: 'unitready', e }); const ang = Math.atan2(f.y - MAPH * CELL / 2, f.x - MAPW * CELL / 2); let rp = { x: f.x + Math.cos(ang) * (f.fw / 2 + 2.5) * CELL, y: f.y + Math.sin(ang) * (f.fh / 2 + 2.5) * CELL }; /* rally behind the factory, away from the map centre; fall back to the front if that is off-map or blocked */
  if (!isNaval(d) && !isAir(d)) { const cx = Math.floor(rp.x / CELL), cy = Math.floor(rp.y / CELL); if (!inMap(cx, cy) || cx < 1 || cy < 1 || cx > MAPW - 2 || cy > MAPH - 2 || !passable(cx, cy, null, 'land')) rp = { x: f.x - Math.cos(ang) * (f.fw / 2 + 2.5) * CELL, y: f.y - Math.sin(ang) * (f.fh / 2 + 2.5) * CELL }; }
  const rally = f.rally || (isNaval(d) ? { x: e.x + rnd(-1, 1) * CELL, y: e.y + rnd(-1, 1) * CELL } : { x: rp.x + rnd(-1, 1) * CELL, y: rp.y + rnd(-1, 1) * CELL }); order(e, { type: 'move', x: rally.x + rnd(-20, 20), y: rally.y + rnd(-20, 20) }); return e; }
function canPlace(p, d, cx, cy) { const [fw, fh] = FOOT(d); let near = false;
  if (/Refinery/.test(d.role)) { const dx = cx + Math.floor(fw / 2), dy = cy + fh; if (!passable(dx, dy, null, 'land')) return false; } /* dock cell below must be open */ for (let x = cx; x < cx + fw; x++) for (let y = cy; y < cy + fh; y++) { if (d.waterOnly) { if (!isWater(x, y) || G.occ[idx(x, y)] !== -1) return false; } else if (!passable(x, y, null, 'land') || G.terrain[idx(x, y)] === TT.BRIDGE) return false; if (G.ore[idx(x, y)] > 0 && !/Refinery/.test(d.role)) { /* allowed but wasteful */ } for (const e of G.ents) if (!e.dead && e.owner === p && isStruct(e.def) && e.def.cls === 'structure') if (Math.abs(e.x / CELL - (x + 0.5)) < RULES.base.buildRadiusCells && Math.abs(e.y / CELL - (y + 0.5)) < RULES.base.buildRadiusCells) near = true; } return near; }
function place(p, d, cx, cy) { if (!canPlace(p, d, cx, cy)) return false; const e = mk(d.id, p, cx, cy); p.ready = null; emit({ type: 'place', e }); return true; }
function sell(e) { if (e.dead || !isStruct(e.def)) return; e.owner.credits += Math.round(e.def.cost * RULES.economy.sellRefund * (e.hp / e.def.hp)); e.dead = true; G.byId.delete(e.id); for (let x = e.cx; x < e.cx + e.fw; x++) for (let y = e.cy; y < e.cy + e.fh; y++) if (G.occ[idx(x, y)] === e.id) G.occ[idx(x, y)] = -1; emit({ type: 'sold', e }); }
function repairToggle(e) { e.repairing = !e.repairing; }
function repairs(dt) { for (const e of G.ents) if (!e.dead && e.repairing && isStruct(e.def)) { if (e.hp >= e.def.hp) { e.repairing = false; continue; } const hpPerSec = e.def.hp / 20; const cost = e.def.cost * RULES.economy.repairCostFraction / e.def.hp * hpPerSec * dt; if (e.owner.credits < cost) continue; e.owner.credits -= cost; e.hp = Math.min(e.def.hp, e.hp + hpPerSec * dt); } }

// ───────── AI ─────────
/*AI_SPLICE*/
function aiPlace(p) {
  const d = p.ready; const base = G.ents.find(e => !e.dead && e.owner === p && /Construction/.test(e.def.role)) || G.ents.find(e => !e.dead && e.owner === p && isStruct(e.def)); if (!base) { p.ready = null; return; }
  const bx = Math.floor(base.x / CELL), by = Math.floor(base.y / CELL); const [fw, fh] = FOOT(d); let pref = null;
  if (d.cls === 'defence') { const en = nearestEnemyPlayer(p); const es = en && G.ents.find(e => !e.dead && e.owner === en && isStruct(e.def)); if (es) { const ang = Math.atan2(es.y - base.y, es.x - base.x); pref = { x: bx + Math.round(Math.cos(ang) * 7), y: by + Math.round(Math.sin(ang) * 7) }; } }
  if (/Refinery/.test(d.role)) { let best = null, bd = 1e9; for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) if (G.ore[idx(x, y)] > 0) { const dd = Math.hypot(x - bx, y - by); if (dd < bd) { bd = dd; best = { x, y }; } } if (best) pref = { x: Math.round(bx + (best.x - bx) * 0.6), y: Math.round(by + (best.y - by) * 0.6) }; }
  const c = pref || { x: bx, y: by };
  for (let r = 1; r < 22; r++) { const cands = []; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.abs(dx) === r || Math.abs(dy) === r) cands.push([c.x + dx - Math.floor(fw / 2), c.y + dy - Math.floor(fh / 2)]); cands.sort(() => Math.random() - 0.5); for (const [x, y] of cands) { let ok = true; for (let xx = x - 1; xx <= x + fw && ok; xx++) for (let yy = y - 1; yy <= y + fh && ok; yy++) if (!inMap(xx, yy) || !terrainOk(G.terrain[idx(xx, yy)], 'land') || G.terrain[idx(xx, yy)] === TT.BRIDGE || (G.occ[idx(xx, yy)] !== -1)) ok = false; if (ok && canPlace(p, d, x, y)) { place(p, d, x, y); return; } } }
  p.ready = null;
}

const SLOT_COLORS = [0x2ec4d6, 0xd9a441, 0xe0479e, 0x9be37a, 0xe05a4a, 0xb48cff];
const MAP_PRESETS = ['riverlands', 'island', 'urban', 'desert', 'crossfire', 'quadrant'];
function newGame(cfg, enemyFaction, difficulty, seed) {
  if (typeof cfg === 'string') cfg = { players: [{ faction: cfg, ai: false }, { faction: enemyFaction, ai: true, difficulty }], seed, map: 'riverlands' };
  seed = cfg.seed == null ? 7 : cfg.seed;
  G.ents = []; G.byId.clear(); G.events = []; G.delayed = []; G.over = null; G.t = 0; G.msgs = []; G.occ.fill(-1); G.seed = seed; G.crates = []; G.crateT = 30; G.mines = []; G.wrecks = []; G.reveals = []; G.fields = []; G.swShots = [];
  const mapRes = typeof cfg.map === 'object' && cfg.map && cfg.map.terrain ? MAPGEN.fromData(G, cfg.map, MAPW, MAPH, idx, inMap) : MAPGEN.generate(G, seed, MAPW, MAPH, idx, inMap, cfg.map || 'riverlands');
  const civSpots = mapRes.civ; G.theme = mapRes.theme || 'grass'; G.mapName = mapRes.name || cfg.map || 'riverlands'; G.starts = mapRes.starts;
  G.neutral = { id: 99, faction: 'civ', name: 'Civilians', color: 0x9a9a8a, dark: 0x4a4a40, css: '#9a9a8a', credits: 0, queue: {}, ready: null, ai: false, neutral: true, team: -1, power: 0, drain: 0, lowPower: false, vis: new Uint8Array(MAPW * MAPH) };
  const n = Math.min(cfg.players.length, mapRes.starts.length); const used = new Set();
  G.players = cfg.players.slice(0, n).map((pc, i) => { const F = FACTIONS[pc.faction]; let color = i === 0 ? F.color : SLOT_COLORS.find(c => !used.has(c) && c !== FACTIONS[cfg.players[0].faction].color); used.add(color); const dark = (color >> 1) & 0x7f7f7f; return { id: i, faction: pc.faction, name: pc.name || (F.name + (i ? ' ' + (i + 1) : '')), color, dark, css: '#' + color.toString(16).padStart(6, '0'), credits: RULES.economy.startingCredits, queue: {}, ready: null, ai: !!pc.ai, difficulty: pc.difficulty || 'normal', team: pc.team == null ? i : pc.team, power: 0, drain: 0, lowPower: false, vis: new Uint8Array(MAPW * MAPH) }; });
  const me = G.players[0];
  const cyId = f => ALL.find(d => d.faction === f && /Construction/.test(d.role)).id, harv = f => ALL.find(d => d.faction === f && hasTag(d, 'harvester')).id;
  G.players.forEach((p, i) => { const st = mapRes.starts[i]; mk(cyId(p.faction), p, st.x, st.y, { instant: true }); const tx = st.x + 1.5 + (st.x < MAPW / 2 ? 4 : -2), ty = st.y + 1.5 + (st.y < MAPH / 2 ? 4 : -2); mk(harv(p.faction), p, tx, ty); if (p.ai) aiInit(p); });
  for (const [id, x, y] of civSpots) { const d = BY[id]; let ok = true; for (let xx = x; xx < x + d.foot[0]; xx++) for (let yy = y; yy < y + d.foot[1]; yy++) if (!inMap(xx, yy) || G.terrain[idx(xx, yy)] === TT.WATER || G.occ[idx(xx, yy)] !== -1) ok = false; if (ok) { const b = mk(id, G.neutral, x, y, { instant: true }); b.occupants = []; } }
  updateFog(); return me;
}
function step(dt) { tick(dt); runDelayed(); repairs(dt); depthTick(dt); }
return { G, CELL, MAPW, MAPH, DT, ALL, DIFF, infiltrate, aiInit, hostile, enemiesOf, nearestEnemyPlayer, MAP_PRESETS, SLOT_COLORS, MAPGEN, BY, FACTIONS, FOOT, buildable, TT, evacuate, domainOf, isNaval, useAbility, abilityFor, ABILITIES, DOCTRINES, buyDoctrine, useDoctrine, fireSuper, statOf, buffOf, toggleEffects, tierOpen, spawn: (id, owner, cx, cy) => mk(id, owner, cx, cy, { instant: true }), isAir, isInf, isStruct, hasTag, idx, inMap, canBuild, factoryFor, enqueue, dequeue, canPlace, place, sell, repairToggle, order, orderGroup, newGame, step, visibleTo, canSee, countOwn, tabOf, rankMult, verse, canHit, dist, clamp, lerpAngle };
})();
