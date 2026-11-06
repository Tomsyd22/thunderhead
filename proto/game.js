/* Thunderhead prototype engine. Reads RULES, LATTICE, COMPACT, HELIX, VOICE globals (bundled before this file). */
(() => {
'use strict';
const CELL = 32, MAPW = 64, MAPH = 48, DT = 1 / 30;
const ALL = [].concat(LATTICE, COMPACT, HELIX);
const BY = Object.fromEntries(ALL.map(u => [u.id, u]));
const AT = Object.fromEntries(RULES.armourTypes.map((a, i) => [a, i]));
const FACTIONS = {
  lattice: { name: 'The Lattice', color: '#2ec4d6', dark: '#0d5b66', ai: ['lat_reactor', 'lat_extractor', 'lat_fabbay', 'lat_assembly', 'lat_reactor', 'lat_sentinel', 'lat_extractor', 'lat_uplink', 'lat_reactor', 'lat_lance', 'lat_hangar', 'lat_sentinel', 'lat_reactor'],
    army: [['lat_scuttler', 5], ['lat_hornet', 3], ['lat_phalanx', 4], ['lat_lamplighter', 1], ['lat_lancer', 2], ['lat_raptor', 1], ['lat_nullproj', 1]] },
  compact: { name: 'The Compact', color: '#d9a441', dark: '#5a3f12', ai: ['cmp_reactor', 'cmp_refinery', 'cmp_barracks', 'cmp_armour', 'cmp_reactor', 'cmp_bunker', 'cmp_refinery', 'cmp_radar', 'cmp_reactor', 'cmp_sam', 'cmp_airfield', 'cmp_railturret', 'cmp_reactor'],
    army: [['cmp_rifleman', 4], ['cmp_rockettrooper', 3], ['cmp_bastion', 4], ['cmp_grenadier', 1], ['cmp_hunter', 2], ['cmp_hailstorm', 1], ['cmp_falcon', 1]] },
  helix: { name: 'Helix Dynamics', color: '#e0479e', dark: '#5c1740', ai: ['hlx_solar', 'hlx_refinery', 'hlx_office', 'hlx_plant', 'hlx_solar', 'hlx_autoturret', 'hlx_refinery', 'hlx_surveil', 'hlx_solar', 'hlx_flaknest', 'hlx_skyport', 'hlx_stuntower', 'hlx_solar'],
    army: [['hlx_contractor', 5], ['hlx_arbiter', 4], ['hlx_enforcer', 2], ['hlx_netrunner', 2], ['hlx_suppressor', 2], ['hlx_shade', 1], ['hlx_dragonfly', 1]] },
};
// Prototype roster: tiers 1-2, land + air, no transports / spies / MCVs / superweapons.
const EXCLUDE = new Set(['lat_mimic', 'lat_fabricator', 'lat_ferry', 'lat_kite', 'lat_seaskiff', 'lat_harbour', 'lat_fence', 'cmp_mcv', 'cmp_landingcraft', 'cmp_pelican', 'cmp_dockyard', 'cmp_wall', 'cmp_arsenal', 'cmp_trench', 'hlx_mobilehq', 'hlx_hovertrans', 'hlx_courierair', 'hlx_marina', 'hlx_wall', 'hlx_ghost', 'lat_mender_x']);
const buildable = d => !d.hidden && d.tier <= 2 && !EXCLUDE.has(d.id) && d.cls !== 'naval' && !(d.tags || []).includes('spawned');
const FOOT = d => d.cls === 'defence' ? [1, 1] : /Construction/.test(d.role) ? [3, 3] : /Refinery/.test(d.role) ? [3, 2] : /production/.test(d.role) ? (/Infantry/.test(d.role) ? [2, 2] : [3, 2]) : [2, 2];
const isAir = d => d.cls === 'aircraft', isInf = d => d.cls === 'infantry' || d.cls === 'drone', isStruct = d => d.cls === 'structure' || d.cls === 'defence';
const hasTag = (d, t) => (d.tags || []).includes(t);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TABS = [['structure', 'Build'], ['defence', 'Defend'], ['infantry', 'Infantry'], ['vehicle', 'Vehicles'], ['aircraft', 'Air']];

// ───────── damage model (identical to sim) ─────────
function canHit(w, a, t) {
  if (w.dmg <= 0 && w.wh !== 'HACK' && !w.spawns) return false; if (w.spawns) return false;
  if (isAir(t) && !w.aa) return false; if (!isAir(t) && !w.ag) return false;
  if (w.naval || w.antiSub) return false;
  if (w.vsInfantryOnly && !isInf(t)) return false; if (w.vsVehicleOnly && isInf(t)) return false; if (w.vsStructureOnly && !isStruct(t)) return false;
  if (w.wh === 'HACK' && (isInf(t) || hasTag(t, 'nohack') || hasTag(t, 'hero') || hasTag(t, 'mcv') || isStruct(t))) return false;
  if (w.wh === 'EMP' && isInf(t) && !hasTag(t, 'machine')) return false;
  if (w.wh === 'TOXIN' && hasTag(t, 'machine') && !isInf(t)) return false;
  return true;
}
function verse(w, t) {
  if (w.wh === 'EMP' && hasTag(t, 'machine') && isInf(t)) return 1;
  if (isAir(t) && RULES.aircraftModifier[w.wh] && RULES.aircraftModifier[w.wh][t.armour] != null) return RULES.aircraftModifier[w.wh][t.armour];
  return RULES.warheads[w.wh][AT[t.armour]];
}

// ───────── world ─────────
const G = { t: 0, ents: [], byId: new Map(), nextId: 1, players: [], terrain: new Uint8Array(MAPW * MAPH), ore: new Float32Array(MAPW * MAPH), oreKind: new Uint8Array(MAPW * MAPH), occ: new Int32Array(MAPW * MAPH).fill(-1), fx: [], shots: [], over: null, speed: 1, msgs: [] };
const idx = (cx, cy) => cy * MAPW + cx;
const inMap = (cx, cy) => cx >= 0 && cy >= 0 && cx < MAPW && cy < MAPH;
function genMap(seed) {
  let s = seed; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  G.terrain.fill(0);
  for (let i = 0; i < 26; i++) { const cx = 4 + Math.floor(r() * (MAPW - 8)), cy = 4 + Math.floor(r() * (MAPH - 8)); if ((cx < 16 && cy < 14) || (cx > MAPW - 17 && cy > MAPH - 15)) continue; const w = 1 + Math.floor(r() * 3), h = 1 + Math.floor(r() * 3); for (let x = cx; x < cx + w; x++) for (let y = cy; y < cy + h; y++) if (inMap(x, y)) G.terrain[idx(x, y)] = 1; }
  const field = (cx, cy, rad, kind, amt) => { for (let x = cx - rad; x <= cx + rad; x++) for (let y = cy - rad; y <= cy + rad; y++) if (inMap(x, y) && Math.hypot(x - cx, y - cy) <= rad + r() * 0.8 && !G.terrain[idx(x, y)]) { G.ore[idx(x, y)] = amt * (0.6 + r() * 0.8); G.oreKind[idx(x, y)] = kind; } };
  field(14, 9, 3, 1, 40); field(MAPW - 15, MAPH - 10, 3, 1, 40); // starting fields
  field(9, 22, 3, 1, 45); field(MAPW - 10, MAPH - 23, 3, 1, 45);
  field(30, 12, 3, 1, 50); field(MAPW - 31, MAPH - 13, 3, 1, 50);
  field(32, 24, 2, 2, 30); // central cobalt
  field(12, 38, 2, 2, 25); field(MAPW - 13, 9, 2, 2, 25);
}

// ───────── entities ─────────
function mk(defId, owner, cx, cy) {
  const d = BY[defId]; const e = { id: G.nextId++, def: d, owner, hp: d.hp, dead: false, cds: (d.weapons || []).map(() => 0), xp: 0, rank: 0, target: null, order: null, path: [], speech: null, speechT: 0, lastHit: -99, lastFire: -99, disabled: 0, deployed: false, cloaked: !!(d.cloak || d.cloakIdle), moved: false, ammo: d.ammo || Infinity, rearm: 0, shield: d.shield ? d.shield.hp : 0, carry: 0, carryKind: 1, mineT: 0, hackedBy: null, hackUntil: 0, origOwner: owner, spawnT: 0, facing: 0, cx, cy, home: null };
  if (isStruct(d)) { const [fw, fh] = FOOT(d); e.fw = fw; e.fh = fh; e.x = (cx + fw / 2) * CELL; e.y = (cy + fh / 2) * CELL; for (let x = cx; x < cx + fw; x++) for (let y = cy; y < cy + fh; y++) G.occ[idx(x, y)] = e.id; }
  else { e.x = cx * CELL; e.y = cy * CELL; }
  if (d.secondary && d.secondary.kind === 'deploy' && d.secondary.bonus) e.deployed = false;
  G.ents.push(e); G.byId.set(e.id, e); return e;
}
function kill(e, killer) {
  if (e.dead) return; e.dead = true; G.byId.delete(e.id);
  if (isStruct(e.def)) { for (let x = e.cx; x < e.cx + e.fw; x++) for (let y = e.cy; y < e.cy + e.fh; y++) if (G.occ[idx(x, y)] === e.id) G.occ[idx(x, y)] = -1; }
  if (killer && killer.owner !== e.owner) { killer.xp += e.def.cost; const need = killer.def.cost * (killer.owner.faction === 'compact' ? 0.8 : 1); if (killer.xp >= need * RULES.veterancy.eliteRatio) killer.rank = 2; else if (killer.xp >= need * RULES.veterancy.veteranRatio) killer.rank = 1;
    if (killer.def.bounty || (killer.def.secondary && /Repossess|Hazard/.test(killer.def.secondary.name))) killer.owner.credits += Math.round(e.def.cost * 0.1); }
  G.fx.push({ x: e.x, y: e.y, r: isStruct(e.def) ? 40 : 14, t: 0, dur: isStruct(e.def) ? 0.9 : 0.45, col: '#ffb347' });
  if (e.owner.ai === false && isStruct(e.def)) announce('Structure lost.');
  for (const o of G.ents) if (o.target === e) o.target = null;
}
const rankMult = e => e.rank === 2 ? RULES.veterancy.elite : e.rank === 1 ? RULES.veterancy.veteran : { firepower: 1, armour: 1, speed: 1, rof: 1, selfHeal: 0 };
function damage(e, dmg, src) {
  if (e.dead || dmg <= 0) return; e.lastHit = G.t;
  if (e.def.secondary && e.def.secondary.bonus && e.deployed && e.def.secondary.bonus.taken) dmg *= e.def.secondary.bonus.taken;
  dmg *= rankMult(e).armour;
  if (e.shield > 0) { const s = Math.min(e.shield, dmg); e.shield -= s; dmg -= s; }
  e.hp -= dmg; if (e.hp <= 0) kill(e, src); else if (e.hp < e.def.hp * 0.5 && !e.saidHurt) { e.saidHurt = true; say(e, 'hurt'); }
}
function say(e, cat) { const v = VOICE[e.def.id] || VOICE._generic; const L = v[cat] || VOICE._generic[cat]; if (!L) return; e.speech = L[Math.floor(Math.random() * L.length)]; e.speechT = 2.2; }
function announce(m) { G.msgs.push({ m, t: 6 }); if (G.msgs.length > 4) G.msgs.shift(); }

// ───────── pathing ─────────
function passable(cx, cy, e) { if (!inMap(cx, cy)) return false; if (G.terrain[idx(cx, cy)]) return false; const o = G.occ[idx(cx, cy)]; return o === -1 || (e && o === e.id); }
function findPath(e, sx, sy, tx, ty) {
  if (isAir(e.def)) return [{ x: tx, y: ty }];
  const s = { x: Math.floor(sx / CELL), y: Math.floor(sy / CELL) }, g = { x: clamp(Math.floor(tx / CELL), 0, MAPW - 1), y: clamp(Math.floor(ty / CELL), 0, MAPH - 1) };
  // find nearest passable goal cell
  let goal = null; for (let r = 0; r < 6 && !goal; r++) for (let dx = -r; dx <= r && !goal; dx++) for (let dy = -r; dy <= r && !goal; dy++) if (Math.abs(dx) === r || Math.abs(dy) === r) if (passable(g.x + dx, g.y + dy)) goal = { x: g.x + dx, y: g.y + dy };
  if (!goal) return [];
  const key = (x, y) => y * MAPW + x; const open = [{ x: s.x, y: s.y, f: 0, g: 0 }], came = new Map(), gs = new Map([[key(s.x, s.y), 0]]), closed = new Set();
  let n = 0;
  while (open.length && n++ < 6000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i; const c = open.splice(bi, 1)[0];
    if (c.x === goal.x && c.y === goal.y) { const p = []; let k = key(c.x, c.y); while (came.has(k)) { const [x, y] = [k % MAPW, Math.floor(k / MAPW)]; p.push({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }); k = came.get(k); } p.reverse(); p.push({ x: tx, y: ty }); return p; }
    closed.add(key(c.x, c.y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = c.x + dx, ny = c.y + dy; if (!passable(nx, ny, e) && !(nx === goal.x && ny === goal.y)) continue; if (dx && dy && (!passable(c.x + dx, c.y, e) || !passable(c.x, c.y + dy, e))) continue;
      const k = key(nx, ny); if (closed.has(k)) continue; const ng = c.g + (dx && dy ? 1.414 : 1); if (gs.has(k) && gs.get(k) <= ng) continue; gs.set(k, ng); came.set(k, key(c.x, c.y)); open.push({ x: nx, y: ny, g: ng, f: ng + Math.hypot(nx - goal.x, ny - goal.y) });
    }
  }
  return [{ x: tx, y: ty }];
}

// ───────── orders ─────────
function order(e, o) {
  if (e.dead || isStruct(e.def) || hasTag(e.def, 'harvester') && o.type === 'attack') return;
  e.order = o; e.target = o.target || null;
  if (o.type === 'move' || o.type === 'attackmove') { e.path = findPath(e, e.x, e.y, o.x, o.y); if (e.deployed) e.deployed = false; }
  if (o.type === 'attack' && o.target) e.path = [];
}
function nearestEnemy(e, range, pred) {
  let best = null, bd = 1e9; for (const o of G.ents) { if (o.dead || o.owner === e.owner || o.owner.allyOf === e.owner) continue; if (o.cloaked && !canSee(e.owner, o)) continue; if (pred && !pred(o)) continue; const d = dist(e, o) - (isStruct(o.def) ? Math.max(o.fw, o.fh) * CELL * 0.45 : 0); if (d < bd && d <= range) { bd = d; best = o; } } return best;
}
function canSee(p, o) { // detectors reveal cloaked units within 6 cells
  for (const e of G.ents) if (!e.dead && e.owner === p && e.def.detector && dist(e, o) <= RULES.stealth.detectorsRevealRadius * CELL) return true; return false;
}
function hitRange(e, w) { return (w.range + (e.deployed && e.def.secondary && e.def.secondary.bonus ? (e.def.secondary.bonus.range || 0) : 0)) * CELL; }

// ───────── simulation tick ─────────
function tick(dt) {
  G.t += dt;
  for (const p of G.players) { p.power = 0; p.drain = 0; }
  for (const e of G.ents) if (!e.dead && isStruct(e.def)) { if (e.def.power > 0) e.owner.power += e.def.power; else e.owner.drain += -e.def.power; }
  for (const p of G.players) { p.lowPower = p.drain > p.power; produce(p, dt); if (p.ai) aiTick(p, dt); }
  const live = G.ents.filter(e => !e.dead);
  for (const e of live) stepEntity(e, dt, live);
  // separation
  for (const e of live) { if (isStruct(e.def) || isAir(e.def)) continue; for (const o of live) { if (o === e || isStruct(o.def) || isAir(o.def)) continue; const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), min = (isInf(e.def) ? 10 : 18) + (isInf(o.def) ? 10 : 18); if (d < min && d > 0.01) { const push = (min - d) * 0.5 * dt * 6; e.x += dx / d * push; e.y += dy / d * push; } } e.x = clamp(e.x, 8, MAPW * CELL - 8); e.y = clamp(e.y, 8, MAPH * CELL - 8); }
  for (const f of G.fx) f.t += dt; G.fx = G.fx.filter(f => f.t < f.dur);
  for (const s of G.shots) s.t += dt; G.shots = G.shots.filter(s => s.t < s.dur);
  for (const m of G.msgs) m.t -= dt; G.msgs = G.msgs.filter(m => m.t > 0);
  // victory
  for (const p of G.players) { if (p.lost) continue; const alive = live.some(e => e.owner === p && isStruct(e.def)); if (!alive && G.t > 5) { p.lost = true; G.over = p.ai ? 'win' : 'loss'; } }
}
function stepEntity(e, dt, live) {
  const d = e.def; e.speechT -= dt; const rm = rankMult(e);
  if (rm.selfHeal) e.hp = Math.min(d.hp, e.hp + d.hp * rm.selfHeal * dt);
  if (e.hackUntil && G.t > e.hackUntil) { e.owner = e.origOwner; e.hackUntil = 0; e.hackedBy = null; }
  if (d.shield && G.t - e.lastHit > d.shield.regenDelay) e.shield = Math.min(d.shield.hp, e.shield + d.shield.regenPerSec * dt);
  if (e.disabled > 0) { e.disabled -= dt; return; }
  if (d.cloak || d.cloakIdle) e.cloaked = (G.t - e.lastFire > RULES.stealth.recloakDelay) && (!d.cloakIdle || !e.moved) && !(hasTag(d, 'harvester') && e.mining);
  e.moved = false;
  if (isStruct(d)) { if (d.cls === 'defence' && !e.owner.lowPower) fireAt(e, dt, acquire(e)); if (d.id === 'lat_pylon' || d.id === 'cmp_depot' || d.id === 'lat_reclaimer' || d.id === 'hlx_market' || d.id === 'cmp_armour') for (const o of live) if (o.owner === e.owner && !isStruct(o.def) && o.def.cls === 'vehicle' && dist(o, e) < 3 * CELL) o.hp = Math.min(o.def.hp, o.hp + 15 * dt); return; }
  // spawner (Hive)
  (d.weapons || []).forEach((w, i) => { if (!w.spawns) return; e.cds[i] -= dt; const mine = live.filter(s => s.parent === e); if (e.cds[i] <= 0 && mine.length < w.spawnMax) { const s = mk(w.spawns, e.owner, e.x / CELL + rnd(-1, 1), e.y / CELL + rnd(-1, 1)); s.parent = e; s.free = true; e.cds[i] = w.rof; if (e.order && e.order.type === 'attackmove') order(s, { ...e.order }); } });
  if (hasTag(d, 'harvester')) { harvest(e, dt); return; }
  if (hasTag(d, 'engineer')) { if (e.order && e.order.type === 'capture' && e.order.target && !e.order.target.dead) { const t = e.order.target; if (dist(e, t) < (Math.max(t.fw, t.fh) * 0.5 + 0.6) * CELL) { if (t.def.buildLimit === 1 && /Construction/.test(t.def.role)) { t.owner = e.owner; announce(e.owner.ai ? 'Enemy captured your construction yard!' : 'Construction yard captured!'); } else t.owner = e.owner; t.hp = Math.max(t.hp, t.def.hp * 0.5); kill(e); return; } moveAlong(e, dt, t); return; } moveAlong(e, dt, null); return; }
  // aircraft rearm
  if (isAir(d) && d.ammo) {
    if (e.ammo <= 0 || e.rearming) { e.rearming = true; const base = nearestOwn(e, o => /Air production/.test(o.def.role)); if (base) { if (dist(e, base) > 12) { flyToward(e, base.x, base.y, dt); return; } e.rearm += dt; if (e.rearm >= d.rearmSeconds) { e.ammo = d.ammo; e.rearm = 0; e.rearming = false; } return; } else { e.rearm += dt; if (e.rearm >= d.rearmSeconds * 2) { e.ammo = d.ammo; e.rearm = 0; e.rearming = false; } return; } }
  }
  // targeting
  let tgt = e.target && !e.target.dead && e.target.owner !== e.owner ? e.target : null;
  if (tgt && tgt.cloaked && !canSee(e.owner, tgt)) tgt = null;
  if (!tgt && (!e.order || e.order.type !== 'move')) tgt = acquire(e);
  e.target = tgt;
  const w0 = tgt ? (d.weapons || []).filter(w => canHit(w, d, tgt.def)) : [];
  if (tgt && w0.length) {
    const rng = Math.max(...w0.map(w => hitRange(e, w))), minR = Math.max(...w0.map(w => (w.minRange || 0) * CELL)), dd = dist(e, tgt) - (isStruct(tgt.def) ? Math.max(tgt.fw, tgt.fh) * CELL * 0.4 : 0);
    const wantCrush = d.cls === 'vehicle' && !d.hover && (d.armour === 'medium' || d.armour === 'heavy') && isInf(tgt.def) && !tgt.def.hover && !tgt.deployed && w0.every(w => verse(w, tgt.def) < 0.5);
    if (dd > rng || (wantCrush && dd > 6)) { if (e.deployed) { e.deployed = false; } moveAlong(e, dt, tgt); }
    else if (dd < minR) { const ang = Math.atan2(e.y - tgt.y, e.x - tgt.x); e.x += Math.cos(ang) * d.speed * CELL * dt; e.y += Math.sin(ang) * d.speed * CELL * dt; e.moved = true; }
    else {
      e.facing = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      const dep = d.secondary && d.secondary.kind === 'deploy' && (d.secondary.bonus || w0.some(w => w.minRange));
      if (dep && !e.deployed) { e.deployT = (e.deployT || 0) + dt; if (e.deployT >= (d.secondary.bonus ? d.secondary.bonus.time : 6)) { e.deployed = true; e.deployT = 0; } return; }
      fireAt(e, dt, tgt);
      if (wantCrush && dd <= 6) { e.crushCd = (e.crushCd || 0) - dt; if (e.crushCd <= 0) { kill(tgt, e); e.crushCd = 3; } }
    }
    return;
  }
  // no target: follow order
  if (e.order && (e.order.type === 'move' || e.order.type === 'attackmove')) { if (e.path.length) moveAlong(e, dt, null); else e.order = null; }
}
function acquire(e) { const d = e.def; const sight = (isStruct(d) ? Math.max(...(d.weapons || [{ range: 0 }]).map(w => w.range)) : (d.sight || 5)) * CELL + 8; return nearestEnemy(e, sight, o => (d.weapons || []).some(w => canHit(w, d, o.def)) && !(hasTag(d, 'harvester'))); }
function nearestOwn(e, pred) { let b = null, bd = 1e9; for (const o of G.ents) if (!o.dead && o.owner === e.owner && pred(o)) { const dd = dist(e, o); if (dd < bd) { bd = dd; b = o; } } return b; }
function flyToward(e, x, y, dt) { const ang = Math.atan2(y - e.y, x - e.x), sp = e.def.speed * CELL * dt * rankMult(e).speed; const dd = Math.hypot(x - e.x, y - e.y); if (dd <= sp) { e.x = x; e.y = y; } else { e.x += Math.cos(ang) * sp; e.y += Math.sin(ang) * sp; } e.facing = ang; e.moved = true; }
function moveAlong(e, dt, tgt) {
  const d = e.def; const sp = d.speed * CELL * dt * rankMult(e).speed * (e.def.secondary && e.deployed ? 0 : 1);
  if (isAir(d)) { const gx = tgt ? tgt.x : (e.path[0] ? e.path[0].x : e.x), gy = tgt ? tgt.y : (e.path[0] ? e.path[0].y : e.y); flyToward(e, gx, gy, dt); if (!tgt && e.path[0] && dist(e, e.path[0]) < 6) e.path.shift(); return; }
  if (tgt) { e.repathT = (e.repathT || 0) - dt; if (!e.path.length || e.repathT <= 0) { e.path = findPath(e, e.x, e.y, tgt.x, tgt.y); e.repathT = 1.0; } }
  if (!e.path.length) return;
  const wp = e.path[0], ang = Math.atan2(wp.y - e.y, wp.x - e.x), dd = Math.hypot(wp.x - e.x, wp.y - e.y);
  if (dd <= sp) { e.x = wp.x; e.y = wp.y; e.path.shift(); } else { e.x += Math.cos(ang) * sp; e.y += Math.sin(ang) * sp; }
  e.facing = ang; e.moved = true;
  // crush infantry we drive over
  if (d.cls === 'vehicle' && !d.hover && (d.armour === 'medium' || d.armour === 'heavy')) for (const o of G.ents) if (!o.dead && o.owner !== e.owner && isInf(o.def) && !o.def.hover && !o.deployed && dist(e, o) < 12) { kill(o, e); break; }
}
function fireAt(e, dt, tgt) {
  const d = e.def; if (!tgt) { for (let i = 0; i < e.cds.length; i++) e.cds[i] -= dt; return; }
  const rm = rankMult(e);
  (d.weapons || []).forEach((w, i) => {
    e.cds[i] -= dt; if (w.spawns) return; if (!canHit(w, d, tgt.def)) return; if (e.cds[i] > 0) return;
    const dd = dist(e, tgt) - (isStruct(tgt.def) ? Math.max(tgt.fw, tgt.fh) * CELL * 0.4 : 0); if (dd > hitRange(e, w)) return;
    if (w.usesAmmo) { if (e.ammo <= 0) return; e.ammo--; }
    let shots = 0; while (e.cds[i] <= 0) { shots++; e.cds[i] += w.rof * rm.rof; }
    e.lastFire = G.t; e.cloaked = false; if (!e.saidAtk || G.t - e.saidAtk > 8) { e.saidAtk = G.t; if (Math.random() < 0.5) say(e, 'attack'); }
    // pylon buff
    let pyl = 1; if (e.owner.faction === 'lattice' && G.ents.some(p => !p.dead && p.def.id === 'lat_pylon' && p.owner === e.owner && dist(p, e) < 6 * CELL)) pyl = 1.15;
    let link = 1; if (d.id === 'lat_phalanx') link = 1 + Math.min(0.2, 0.04 * G.ents.filter(o => !o.dead && o !== e && o.def.id === 'lat_phalanx' && o.owner === e.owner && dist(o, e) < 3 * CELL).length);
    const base = w.dmg * (w.burst || 1) * shots * rm.firepower * pyl * link * (e.deployed && d.secondary && d.secondary.bonus ? (d.secondary.bonus.dmg || 1) : 1);
    const victims = [tgt]; const cap = w.splash ? Math.max(1, Math.round(Math.PI * w.splash * w.splash)) : 0;
    if (w.splash || w.lineSplash) { const r = (w.splash || w.lineSplash.length) * CELL; const extra = G.ents.filter(o => !o.dead && o !== tgt && o.owner !== e.owner && dist(o, tgt) <= r && canHit(w, d, o.def)).slice(0, cap || 3); victims.push(...extra); }
    if (w.chain) { const o = G.ents.find(o => !o.dead && o !== tgt && o.owner !== e.owner && dist(o, tgt) <= 2 * CELL && canHit(w, d, o.def)); if (o) victims.push(o); }
    const beam = w.wh === 'BEAM' || w.wh === 'EMP' || w.wh === 'HACK' || w.wh === 'TOXIN';
    G.shots.push({ x1: e.x, y1: e.y, x2: tgt.x, y2: tgt.y, t: 0, dur: beam ? 0.18 : 0.35, kind: beam ? w.wh : 'shell', col: e.owner.color });
    victims.forEach((v, k) => {
      const f = k === 0 ? 1 : (w.chain ? w.chain.falloff : 0.4);
      if (w.wh === 'HACK') { if (k > 0) return; const n = G.ents.filter(h => !h.dead && h.hackedBy === e).length; if (n >= (w.maxControlled || 1)) return; v.origOwner = v.hackUntil ? v.origOwner : v.owner; v.owner = e.owner; v.hackedBy = e; v.hackUntil = w.hackSeconds >= 9999 || e.rank === 2 ? 0 : G.t + w.hackSeconds; v.target = null; v.order = null; if (w.hackSeconds >= 9999 || e.rank === 2) v.origOwner = e.owner; return; }
      if (w.wh === 'EMP') { const sec = base * verse(w, v.def) * RULES.emp.disableSecondsPerPoint * (hasTag(v.def, 'machine') ? RULES.emp.latticeExtraFactor : 1); v.disabled = Math.max(v.disabled, sec * f); return; }
      let dmg = base * verse(w, v.def) * f; if (w.vsInfantryOnly && hasTag(v.def, 'machine')) dmg *= 0.25; if (w.vsMovingFactor && !isStruct(v.def)) dmg *= w.vsMovingFactor;
      if (v.def.secondary && v.def.secondary.bonus && v.def.secondary.bonus.takenSA && w.wh === 'SA') dmg *= v.def.secondary.bonus.takenSA;
      if (w.wh !== 'EMP') G.fx.push({ x: v.x + rnd(-6, 6), y: v.y + rnd(-6, 6), r: w.splash ? 10 + w.splash * 8 : 5, t: 0, dur: 0.25, col: w.wh === 'TOXIN' ? '#8fff6a' : '#fff1b8' });
      damage(v, dmg, e);
    });
    if (w.suicide) kill(e);
  });
}
// harvesting
function harvest(e, dt) {
  const d = e.def; const cap = d.capacity || 20;
  if (e.target && !e.target.dead && e.target.owner !== e.owner && d.weapons) fireAt(e, dt, e.target);
  if (e.order && e.order.type === 'move') { if (e.path.length) { moveAlong(e, dt, null); return; } e.order = null; }
  if (e.carry >= cap || (e.returning && e.carry > 0)) {
    e.returning = true; const ref = nearestOwn(e, o => /Refinery/.test(o.def.role)); if (!ref) return;
    const dock = { x: ref.x, y: ref.y + ref.fh * CELL * 0.5 + 10 };
    if (Math.hypot(dock.x - e.x, dock.y - e.y) > 14) { if (!e.path.length || e.dockFor !== ref.id) { e.path = findPath(e, e.x, e.y, dock.x, dock.y); e.dockFor = ref.id; } moveAlong(e, dt, null); return; }
    e.unloadT = (e.unloadT || 0) + dt; if (e.unloadT > 1.5) { e.owner.credits += e.carry * (e.carryKind === 2 ? RULES.economy.gemBail : RULES.economy.oreBail); e.carry = 0; e.returning = false; e.unloadT = 0; e.oreCell = null; } return;
  }
  // find ore
  if (!e.oreCell || G.ore[idx(e.oreCell.x, e.oreCell.y)] <= 0) { let best = null, bd = 1e9; const ox = e.lastOre ? e.lastOre.x : e.x / CELL, oy = e.lastOre ? e.lastOre.y : e.y / CELL; for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) if (G.ore[idx(x, y)] > 0) { const dd = Math.hypot(x - ox, y - oy) + Math.hypot(x - e.x / CELL, y - e.y / CELL) * 0.5; if (dd < bd) { bd = dd; best = { x, y }; } } e.oreCell = best; e.path = []; if (!best) return; }
  const c = { x: (e.oreCell.x + 0.5) * CELL, y: (e.oreCell.y + 0.5) * CELL };
  if (Math.hypot(c.x - e.x, c.y - e.y) > 12) { if (!e.path.length) e.path = findPath(e, e.x, e.y, c.x, c.y); moveAlong(e, dt, null); e.mining = false; return; }
  e.mining = true; e.mineT += dt; if (e.mineT > 0.5) { e.mineT = 0; const i = idx(e.oreCell.x, e.oreCell.y); if (G.ore[i] > 0) { G.ore[i] -= 1; e.carry++; e.carryKind = G.oreKind[i]; e.lastOre = { ...e.oreCell }; if (e.carry >= cap) e.returning = true; } }
}

// ───────── production ─────────
function prereqOk(p, d) { return (d.prereq || []).every(id => G.ents.some(e => !e.dead && e.owner === p && e.def.id === id)); }
function countOwn(p, id) { return G.ents.filter(e => !e.dead && e.owner === p && e.def.id === id).length; }
function canBuild(p, d) { if (!buildable(d) || d.faction !== p.faction) return false; if (!prereqOk(p, d)) return false; if (d.buildLimit && countOwn(p, d.id) + (p.queue[d.cls] || []).filter(q => q.def.id === d.id).length + (p.ready && p.ready.id === d.id ? 1 : 0) >= d.buildLimit) return false; return true; }
function factoryFor(p, d) { const role = d.cls === 'infantry' || d.cls === 'drone' ? /Infantry/ : d.cls === 'vehicle' ? /Vehicle production/ : d.cls === 'aircraft' ? /Air production/ : /Construction/; return G.ents.filter(e => !e.dead && e.owner === p && isStruct(e.def) && role.test(e.def.role)); }
function enqueue(p, d) { if (!canBuild(p, d)) return false; const facs = factoryFor(p, d); if (!facs.length) return false; const tab = d.cls === 'drone' ? 'infantry' : d.cls; p.queue[tab] = p.queue[tab] || []; if (p.queue[tab].length >= 5) return false; if (tab === 'structure' || tab === 'defence') { if (p.ready || p.queue[tab].length) return false; } p.queue[tab].push({ def: d, progress: 0, paid: 0 }); return true; }
function produce(p, dt) {
  for (const tab of Object.keys(p.queue)) {
    const q = p.queue[tab][0]; if (!q) continue; const d = q.def; const facs = factoryFor(p, d).length; if (!facs) { p.queue[tab].shift(); continue; }
    const total = d.cost / 100 * RULES.economy.buildTimeSecondsPer100Credits * Math.max(0.5, Math.pow(RULES.economy.extraFactoryMultiplier, facs - 1)) * (p.lowPower ? RULES.power.lowPowerBuildMultiplier : 1);
    const rate = dt / total; const costStep = d.cost * rate; if (p.credits < costStep) continue; p.credits -= costStep; q.paid += costStep; q.progress += rate;
    if (q.progress >= 1) { p.queue[tab].shift(); if (isStruct(d)) { p.ready = d; if (!p.ai) announce('Construction complete: ' + d.name); if (p.ai) aiPlace(p); } else spawnUnit(p, d); }
  }
}
function spawnUnit(p, d) { const facs = factoryFor(p, d); const f = facs[Math.floor(Math.random() * facs.length)]; const e = mk(d.id, p, f.cx + f.fw / 2 + rnd(-0.5, 0.5), f.cy + f.fh + 0.6); if (isAir(d)) { e.x = f.x; e.y = f.y; } if (!p.ai) announce('Unit ready: ' + d.name); const rally = { x: f.x + rnd(-1, 1) * CELL, y: f.y + (p.ai ? -1 : 1) * 3 * CELL }; order(e, { type: 'move', x: rally.x, y: rally.y }); return e; }
function canPlace(p, d, cx, cy) { const [fw, fh] = FOOT(d); let near = false; for (let x = cx; x < cx + fw; x++) for (let y = cy; y < cy + fh; y++) { if (!passable(x, y)) return false; for (const e of G.ents) if (!e.dead && e.owner === p && isStruct(e.def) && e.def.cls === 'structure') if (Math.abs(e.x / CELL - (x + 0.5)) < RULES.base.buildRadiusCells && Math.abs(e.y / CELL - (y + 0.5)) < RULES.base.buildRadiusCells) near = true; } return near || !G.ents.some(e => !e.dead && e.owner === p && isStruct(e.def)); }
function place(p, d, cx, cy) { if (!canPlace(p, d, cx, cy)) return false; mk(d.id, p, cx, cy); p.ready = null; return true; }
function sell(e) { if (e.dead || !isStruct(e.def)) return; e.owner.credits += Math.round(e.def.cost * RULES.economy.sellRefund * (e.hp / e.def.hp)); G.fx.push({ x: e.x, y: e.y, r: 30, t: 0, dur: 0.6, col: '#9be37a' }); e.dead = true; G.byId.delete(e.id); for (let x = e.cx; x < e.cx + e.fw; x++) for (let y = e.cy; y < e.cy + e.fh; y++) if (G.occ[idx(x, y)] === e.id) G.occ[idx(x, y)] = -1; }

// ───────── AI ─────────
function aiTick(p, dt) {
  p.aiT = (p.aiT || 0) + dt; if (p.aiT < 0.5) return; p.aiT = 0;
  const F = FACTIONS[p.faction];
  // structures
  if (!p.ready && !(p.queue.structure || []).length && !(p.queue.defence || []).length) {
    const next = F.ai.find(id => { const d = BY[id]; if (!d) return false; if (!canBuild(p, d)) return false; const have = countOwn(p, id); const wanted = F.ai.filter(x => x === id).length; return have < wanted; });
    const refs = countOwn(p, F.ai[1]), harv = G.ents.filter(e => !e.dead && e.owner === p && hasTag(e.def, 'harvester')).length;
    if (next && p.credits > BY[next].cost * 0.6) enqueue(p, BY[next]);
    else if (!next && p.lowPower) enqueue(p, BY[F.ai[0]]);
    if (harv < refs * 1 + 1 && p.credits > 1400) { const hd = ALL.find(d => d.faction === p.faction && hasTag(d, 'harvester')); if (hd && canBuild(p, hd) && !(p.queue.vehicle || []).some(q => hasTag(q.def, 'harvester'))) enqueue(p, hd); }
  }
  // units
  const army = G.ents.filter(e => !e.dead && e.owner === p && !isStruct(e.def) && !hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer'));
  const value = army.reduce((s, e) => s + e.def.cost, 0);
  if (p.credits > 600 && value < 9000) {
    const pool = F.army.filter(([id]) => canBuild(p, BY[id]) && factoryFor(p, BY[id]).length); const tot = pool.reduce((s, x) => s + x[1], 0); let r = Math.random() * tot;
    for (const [id, wgt] of pool) { r -= wgt; if (r <= 0) { const tab = BY[id].cls === 'drone' ? 'infantry' : BY[id].cls; if ((p.queue[tab] || []).length < 2) enqueue(p, BY[id]); break; } }
  }
  // attack waves
  p.wave = p.wave || 0; const threshold = 2500 + p.wave * 900 * (p.difficulty === 'hard' ? 0.7 : p.difficulty === 'easy' ? 1.6 : 1);
  if (value >= threshold || (G.t > 600 && value > 1500 && !p.attacking)) {
    const enemy = G.players.find(q => q !== p && !q.lost); const tg = G.ents.filter(e => !e.dead && e.owner === enemy && isStruct(e.def)); if (!tg.length) return;
    const home = G.ents.find(e => !e.dead && e.owner === p && /Construction/.test(e.def.role)) || army[0];
    const t = tg.reduce((b, e) => (!b || dist(e, home) < dist(b, home)) ? e : b, null);
    for (const e of army) order(e, { type: 'attackmove', x: t.x + rnd(-40, 40), y: t.y + rnd(-40, 40) });
    p.wave++; p.attacking = true; announce('Enemy forces are on the move.');
  }
  // idle units guard base; harvesters hunted? keep simple: re-send idle after wave ends
  if (p.attacking && army.length && army.every(e => !e.order && !e.target)) p.attacking = false;
}
function aiPlace(p) {
  const d = p.ready; const cy0 = G.ents.find(e => !e.dead && e.owner === p && /Construction/.test(e.def.role)); const base = cy0 || G.ents.find(e => !e.dead && e.owner === p && isStruct(e.def)); if (!base) { p.ready = null; return; }
  const bx = Math.floor(base.x / CELL), by = Math.floor(base.y / CELL); const [fw, fh] = FOOT(d);
  // defences toward the enemy, refineries toward ore
  let pref = null; if (d.cls === 'defence') { const en = G.players.find(q => q !== p); pref = { x: bx + Math.sign((MAPW / 2 - bx)) * 5, y: by + Math.sign((MAPH / 2 - by)) * 4 }; if (en) { const es = G.ents.find(e => !e.dead && e.owner === en && isStruct(e.def)); if (es) { const ang = Math.atan2(es.y - base.y, es.x - base.x); pref = { x: bx + Math.round(Math.cos(ang) * 6), y: by + Math.round(Math.sin(ang) * 6) }; } } }
  if (/Refinery/.test(d.role)) { let best = null, bd = 1e9; for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) if (G.ore[idx(x, y)] > 0) { const dd = Math.hypot(x - bx, y - by); if (dd < bd) { bd = dd; best = { x, y }; } } if (best) pref = { x: Math.round(bx + (best.x - bx) * 0.6), y: Math.round(by + (best.y - by) * 0.6) }; }
  const c = pref || { x: bx, y: by };
  for (let r = 1; r < 20; r++) { const cands = []; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.abs(dx) === r || Math.abs(dy) === r) cands.push([c.x + dx - Math.floor(fw / 2), c.y + dy - Math.floor(fh / 2)]); cands.sort(() => Math.random() - 0.5); for (const [x, y] of cands) { let ok = true; for (let xx = x - 1; xx <= x + fw && ok; xx++) for (let yy = y - 1; yy <= y + fh && ok; yy++) if (!inMap(xx, yy) || (G.occ[idx(xx, yy)] !== -1 && (xx >= x && xx < x + fw && yy >= y && yy < y + fh))) ok = false; if (ok && canPlace(p, d, x, y)) { place(p, d, x, y); return; } } }
  p.ready = null;
}

// ───────── rendering ─────────
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
const cam = { x: 0, y: 0, zoom: 1 };
let W = 0, H = 0;
function resize() { W = cv.width = cv.clientWidth * devicePixelRatio; H = cv.height = cv.clientHeight * devicePixelRatio; }
window.addEventListener('resize', resize);
const s2w = (sx, sy) => ({ x: cam.x + sx * devicePixelRatio / cam.zoom, y: cam.y + sy * devicePixelRatio / cam.zoom });
const terrainCanvas = document.createElement('canvas');
function bakeTerrain() {
  terrainCanvas.width = MAPW * CELL; terrainCanvas.height = MAPH * CELL; const c = terrainCanvas.getContext('2d');
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const h = ((x * 7349 + y * 1543) % 13) / 13; c.fillStyle = G.terrain[idx(x, y)] ? `hsl(30 12% ${22 + h * 6}%)` : `hsl(${92 + h * 10} ${22 + h * 8}% ${26 + h * 5}%)`; c.fillRect(x * CELL, y * CELL, CELL, CELL); if (G.terrain[idx(x, y)]) { c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8); } }
  c.strokeStyle = 'rgba(0,0,0,.08)'; for (let x = 0; x <= MAPW; x++) { c.beginPath(); c.moveTo(x * CELL, 0); c.lineTo(x * CELL, MAPH * CELL); c.stroke(); } for (let y = 0; y <= MAPH; y++) { c.beginPath(); c.moveTo(0, y * CELL); c.lineTo(MAPW * CELL, y * CELL); c.stroke(); }
}
const hpColor = f => f > RULES.healthBar.yellowBelow ? '#52d273' : f > RULES.healthBar.redBelow ? '#f2c744' : '#ef4b4b';
function draw(alpha) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0b0f12'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
  ctx.drawImage(terrainCanvas, 0, 0);
  // ore
  const x0 = Math.max(0, Math.floor(cam.x / CELL)), y0 = Math.max(0, Math.floor(cam.y / CELL)), x1 = Math.min(MAPW, Math.ceil((cam.x + W / cam.zoom) / CELL)), y1 = Math.min(MAPH, Math.ceil((cam.y + H / cam.zoom) / CELL));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const a = G.ore[idx(x, y)]; if (a <= 0) continue; ctx.fillStyle = G.oreKind[idx(x, y)] === 2 ? '#5aa7ff' : '#e0a33a'; const n = Math.min(5, Math.ceil(a / 12)); for (let k = 0; k < n; k++) { const px = x * CELL + 6 + ((k * 37 + x * 11) % 20), py = y * CELL + 6 + ((k * 23 + y * 7) % 20); ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill(); } }
  // build radius / placement ghost
  if (UI.placing) { const p = UI.me; const d = UI.placing; const [fw, fh] = FOOT(d); const ok = canPlace(p, d, UI.ghost.x, UI.ghost.y); ctx.fillStyle = ok ? 'rgba(100,255,140,.35)' : 'rgba(255,80,80,.35)'; ctx.fillRect(UI.ghost.x * CELL, UI.ghost.y * CELL, fw * CELL, fh * CELL); ctx.strokeStyle = ok ? '#8f8' : '#f88'; ctx.lineWidth = 2; ctx.strokeRect(UI.ghost.x * CELL, UI.ghost.y * CELL, fw * CELL, fh * CELL);
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.setLineDash([6, 6]); for (const e of G.ents) if (!e.dead && e.owner === p && e.def.cls === 'structure') { ctx.strokeRect(e.x - RULES.base.buildRadiusCells * CELL, e.y - RULES.base.buildRadiusCells * CELL, RULES.base.buildRadiusCells * 2 * CELL, RULES.base.buildRadiusCells * 2 * CELL); } ctx.setLineDash([]); }
  const live = G.ents.filter(e => !e.dead);
  live.sort((a, b) => (isAir(a.def) ? 1 : 0) - (isAir(b.def) ? 1 : 0) || a.y - b.y);
  for (const e of live) drawEnt(e);
  for (const s of G.shots) { const k = s.t / s.dur; ctx.globalAlpha = 1 - k; if (s.kind === 'shell') { const px = s.x1 + (s.x2 - s.x1) * k, py = s.y1 + (s.y2 - s.y1) * k; ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill(); } else { ctx.strokeStyle = s.kind === 'HACK' ? '#e0479e' : s.kind === 'EMP' ? '#9ad7ff' : s.kind === 'TOXIN' ? '#8fff6a' : '#aef3ff'; ctx.lineWidth = s.kind === 'EMP' ? 4 : 2; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); } ctx.globalAlpha = 1; }
  for (const f of G.fx) { const k = f.t / f.dur; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + k), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  // selection box
  if (UI.box) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / cam.zoom; const a = s2w(UI.box.x0, UI.box.y0), b = s2w(UI.box.x1, UI.box.y1); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
  drawMini(live);
}
function drawEnt(e) {
  const d = e.def, col = e.owner.color, me = e.owner === UI.me; const sel = UI.sel.includes(e);
  const vis = !(e.cloaked && !me && !canSee(UI.me, e)); if (!vis) return;
  ctx.globalAlpha = e.cloaked ? 0.45 : 1;
  if (isStruct(d)) {
    const x = e.cx * CELL, y = e.cy * CELL, w = e.fw * CELL, h = e.fh * CELL;
    ctx.fillStyle = e.owner.dark; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); ctx.strokeStyle = sel ? '#fff' : col; ctx.lineWidth = sel ? 3 : 2; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = col; ctx.font = `bold ${Math.min(w, h) * 0.38}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.name.split(' ').map(s => s[0]).join('').slice(0, 2), x + w / 2, y + h / 2 + 1);
    if (d.power > 0) { ctx.fillStyle = e.owner.lowPower ? '#f55' : '#9f9'; ctx.fillRect(x + 6, y + h - 10, w - 12, 4); }
    if (d.cls === 'defence' && e.target) { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(e.x, e.y); const a = Math.atan2(e.target.y - e.y, e.target.x - e.x); ctx.lineTo(e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14); ctx.stroke(); }
    if (e.hp < d.hp || sel) bar(x + 2, y - 7, w - 4, e.hp / d.hp);
  } else {
    const air = isAir(d);
    if (air) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(e.x + 10, e.y + 22, 10, 5, 0, 0, 7); ctx.fill(); }
    ctx.save(); ctx.translate(e.x, e.y); if (!isInf(d)) ctx.rotate(e.facing);
    ctx.fillStyle = col; ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.6)'; ctx.lineWidth = sel ? 2 : 1;
    if (d.cls === 'infantry') { ctx.beginPath(); ctx.arc(0, 0, e.deployed ? 7 : 5.5, 0, 7); ctx.fill(); ctx.stroke(); if (e.deployed) { ctx.strokeStyle = '#c9a36a'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.stroke(); } }
    else if (d.cls === 'drone') { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (air) { ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-9, -8); ctx.lineTo(-5, 0); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { const big = d.armour === 'heavy' ? 1.25 : d.armour === 'light' ? 0.8 : 1; ctx.fillRect(-11 * big, -8 * big, 22 * big, 16 * big); ctx.strokeRect(-11 * big, -8 * big, 22 * big, 16 * big); if ((d.weapons || []).length && !hasTag(d, 'harvester')) { ctx.fillStyle = e.owner.dark; ctx.beginPath(); ctx.arc(0, 0, 5 * big, 0, 7); ctx.fill(); ctx.fillStyle = '#ddd'; ctx.fillRect(0, -1.5, 15 * big, 3); } if (hasTag(d, 'harvester')) { ctx.fillStyle = e.carry > 0 ? (e.carryKind === 2 ? '#5aa7ff' : '#e0a33a') : '#333'; ctx.fillRect(-7, -4, 10, 8); } }
    ctx.restore();
    if (e.disabled > 0) { ctx.strokeStyle = '#9ad7ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, 14, 0, 7); ctx.stroke(); }
    if (e.hackUntil || e.hackedBy) { ctx.fillStyle = '#e0479e'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('HACKED', e.x, e.y - 18); }
    if (e.hp < d.hp || sel || e.shield < (d.shield ? d.shield.hp : 0)) { bar(e.x - 12, e.y - 15, 24, e.hp / d.hp); if (d.shield) { ctx.fillStyle = '#5aa7ff'; ctx.fillRect(e.x - 12, e.y - 19, 24 * e.shield / d.shield.hp, 2); } }
    if (e.rank) { ctx.fillStyle = '#ffd86b'; for (let i = 0; i < e.rank; i++) { ctx.beginPath(); ctx.moveTo(e.x + 8 + i * 6, e.y + 10); ctx.lineTo(e.x + 11 + i * 6, e.y + 6); ctx.lineTo(e.x + 14 + i * 6, e.y + 10); ctx.lineTo(e.x + 11 + i * 6, e.y + 8); ctx.fill(); } }
    if (sel) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(e.x, e.y + 6, 14, 7, 0, 0, 7); ctx.stroke(); }
    if (e.speechT > 0 && me) { ctx.font = '11px system-ui'; ctx.textAlign = 'center'; const tw = ctx.measureText(e.speech).width + 10; ctx.fillStyle = 'rgba(10,12,16,.85)'; ctx.fillRect(e.x - tw / 2, e.y - 36, tw, 16); ctx.fillStyle = '#fff'; ctx.fillText(e.speech, e.x, e.y - 24); }
  }
  ctx.globalAlpha = 1;
}
function bar(x, y, w, f) { ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x, y, w, 4); ctx.fillStyle = hpColor(f); ctx.fillRect(x, y, w * clamp(f, 0, 1), 4); }
function drawMini(live) {
  const mw = mini.width, mh = mini.height, sx = mw / (MAPW * CELL), sy = mh / (MAPH * CELL);
  mctx.fillStyle = '#1a2a1a'; mctx.fillRect(0, 0, mw, mh);
  const hasRadar = G.ents.some(e => !e.dead && e.owner === UI.me && (e.def.detector || /Radar|Air production/.test(e.def.role))) && !UI.me.lowPower;
  if (!hasRadar) { mctx.fillStyle = '#222'; mctx.fillRect(0, 0, mw, mh); mctx.fillStyle = '#777'; mctx.font = '10px system-ui'; mctx.textAlign = 'center'; mctx.fillText('NO RADAR', mw / 2, mh / 2); } else {
    for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { if (G.terrain[idx(x, y)]) { mctx.fillStyle = '#3a3330'; mctx.fillRect(x * CELL * sx, y * CELL * sy, CELL * sx, CELL * sy); } else if (G.ore[idx(x, y)] > 0) { mctx.fillStyle = G.oreKind[idx(x, y)] === 2 ? '#5aa7ff' : '#c08a2c'; mctx.fillRect(x * CELL * sx, y * CELL * sy, CELL * sx, CELL * sy); } }
    for (const e of live) { if (e.cloaked && e.owner !== UI.me) continue; mctx.fillStyle = e.owner.color; const s = isStruct(e.def) ? Math.max(3, e.fw * CELL * sx) : 2; mctx.fillRect(e.x * sx - s / 2, e.y * sy - s / 2, s, s); }
  }
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.strokeRect(cam.x * sx, cam.y * sy, W / cam.zoom * sx, H / cam.zoom * sy);
}

// ───────── UI ─────────
const UI = { me: null, sel: [], box: null, placing: null, ghost: { x: 0, y: 0 }, mode: null, groups: {}, tab: 'structure', selectMode: false, started: false };
const $ = s => document.querySelector(s);
function startGame(faction, difficulty, enemyFaction) {
  G.ents = []; G.byId.clear(); G.fx = []; G.shots = []; G.over = null; G.t = 0; G.players = []; G.occ.fill(-1); genMap(7 + Math.floor(Math.random() * 1000)); bakeTerrain();
  const mkP = (f, ai, i) => ({ id: i, faction: f, name: FACTIONS[f].name, color: FACTIONS[f].color, dark: FACTIONS[f].dark, credits: RULES.economy.startingCredits, queue: {}, ready: null, ai, difficulty, power: 0, drain: 0, lowPower: false });
  const me = mkP(faction, false, 0), en = mkP(enemyFaction, true, 1); G.players = [me, en]; UI.me = me; if (difficulty === 'hard') en.credits += 4000;
  const cyId = f => ALL.find(d => d.faction === f && /Construction/.test(d.role)).id;
  mk(cyId(faction), me, 5, 5); mk(cyId(enemyFaction), en, MAPW - 9, MAPH - 9);
  const harv = f => ALL.find(d => d.faction === f && hasTag(d, 'harvester')).id;
  mk(harv(faction), me, 9, 9); mk(harv(enemyFaction), en, MAPW - 10, MAPH - 10);
  cam.x = 0; cam.y = 0; cam.zoom = Math.min(1.2, Math.max(0.7, W / 1400)); UI.sel = []; UI.placing = null; UI.started = true; UI.groups = {};
  $('#start').hidden = true; $('#end').hidden = true; $('#hud').hidden = false; buildSidebar(); announce('Battle control online. Build a power plant, then a refinery.');
}
function buildSidebar() {
  const tabs = $('#tabs'); tabs.innerHTML = ''; for (const [cls, label] of TABS) { const b = document.createElement('button'); b.textContent = label; b.className = UI.tab === cls ? 'on' : ''; b.onclick = () => { UI.tab = cls; buildSidebar(); }; tabs.appendChild(b); }
  const grid = $('#grid'); grid.innerHTML = '';
  const items = ALL.filter(d => d.faction === UI.me.faction && buildable(d) && ((UI.tab === 'infantry' && (d.cls === 'infantry' || d.cls === 'drone')) || d.cls === UI.tab)).sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  for (const d of items) { const b = document.createElement('button'); b.className = 'item'; b.dataset.id = d.id; b.innerHTML = `<span class="ic">${d.name.split(' ').map(s => s[0]).join('').slice(0, 2)}</span><span class="nm">${d.name}</span><span class="cost">$${d.cost}</span><span class="prog"></span><span class="cnt"></span>`;
    b.title = `${d.name} — ${d.role}. ${d.desc || ''}${d.prereq && d.prereq.length ? ' Requires: ' + d.prereq.map(p => BY[p].name).join(', ') : ''}`;
    b.onclick = () => { if (b.classList.contains('off')) { announce(`${d.name} requires ${(d.prereq || []).filter(p => !countOwn(UI.me, p)).map(p => BY[p].name).join(', ') || 'a factory'}.`); return; } if (UI.me.ready && UI.me.ready === d) { UI.placing = d; return; } if (!enqueue(UI.me, d)) announce('Cannot build that right now.'); };
    b.oncontextmenu = ev => { ev.preventDefault(); const tab = d.cls === 'drone' ? 'infantry' : d.cls; const q = UI.me.queue[tab] || []; const i = q.findIndex(x => x.def === d); if (i >= 0) { UI.me.credits += q[i].paid; q.splice(i, 1); } else if (UI.me.ready === d) { UI.me.credits += d.cost * 0.5; UI.me.ready = null; } };
    grid.appendChild(b); }
}
function refreshSidebar() {
  const p = UI.me; for (const b of $('#grid').children) { const d = BY[b.dataset.id]; const ok = canBuild(p, d) && factoryFor(p, d).length; b.classList.toggle('off', !ok && !(p.ready === d)); const tab = d.cls === 'drone' ? 'infantry' : d.cls; const q = (p.queue[tab] || []).filter(x => x.def === d); const first = (p.queue[tab] || [])[0]; b.querySelector('.prog').style.height = (first && first.def === d ? (1 - first.progress) * 100 : (p.ready === d ? 0 : 100)) + '%'; b.querySelector('.prog').style.display = (first && first.def === d) ? 'block' : 'none'; b.querySelector('.cnt').textContent = p.ready === d ? 'READY' : q.length > 1 ? q.length : ''; b.classList.toggle('ready', p.ready === d); }
  $('#credits').textContent = '$' + Math.floor(p.credits).toLocaleString(); const pw = $('#power'); pw.textContent = `⚡ ${p.power - p.drain >= 0 ? '+' : ''}${p.power - p.drain}`; pw.className = p.lowPower ? 'low' : ''; $('#clock').textContent = `${Math.floor(G.t / 60)}:${String(Math.floor(G.t % 60)).padStart(2, '0')}`;
  $('#msgs').innerHTML = G.msgs.map(m => `<div>${m.m}</div>`).join('');
  // selection panel
  UI.sel = UI.sel.filter(e => !e.dead && e.owner === p); const sp = $('#selpanel');
  if (!UI.sel.length) sp.hidden = true; else { sp.hidden = false; const e = UI.sel[0]; const d = e.def; const n = UI.sel.length; $('#selname').textContent = n > 1 ? `${n} units selected` : d.name; $('#selrole').textContent = n > 1 ? [...new Set(UI.sel.map(u => u.def.name))].join(', ') : d.role + (e.rank ? ` · ${e.rank === 2 ? 'Elite' : 'Veteran'}` : ''); $('#selhp').style.width = (e.hp / d.hp * 100) + '%'; $('#selhp').style.background = hpColor(e.hp / d.hp); $('#selhptxt').textContent = `${Math.ceil(e.hp)} / ${d.hp} ${d.armour}`;
    const sec = $('#secbtn'); if (d.secondary && !isStruct(d)) { sec.hidden = false; sec.textContent = (d.secondary.kind === 'deploy' ? (e.deployed ? 'Undeploy' : d.secondary.name) : d.secondary.name); sec.title = d.secondary.desc; sec.disabled = d.secondary.kind !== 'deploy'; } else sec.hidden = true;
    $('#sellbtn').hidden = !isStruct(d); $('#stopbtn').hidden = isStruct(d); $('#amovebtn').hidden = isStruct(d) || hasTag(d, 'harvester'); $('#weap').textContent = (d.weapons || []).filter(w => !w.spawns).map(w => `${w.name} ${w.dmg} ${w.wh} r${w.range}`).join(' · ') || (d.desc || ''); }
  // groups
  const gc = $('#groups'); gc.innerHTML = ''; for (const k of Object.keys(UI.groups)) { UI.groups[k] = UI.groups[k].filter(e => !e.dead); if (!UI.groups[k].length) { delete UI.groups[k]; continue; } const b = document.createElement('button'); b.textContent = `${k}·${UI.groups[k].length}`; b.onclick = () => { UI.sel = [...UI.groups[k]]; centerOn(UI.sel[0]); }; gc.appendChild(b); }
  if (G.over && !$('#end').dataset.shown) { $('#end').dataset.shown = '1'; $('#end').hidden = false; $('#endtitle').textContent = G.over === 'win' ? 'Mission accomplished' : 'Mission failed'; $('#endtxt').textContent = G.over === 'win' ? `The ${G.players[1].name} base is rubble at ${$('#clock').textContent}.` : `Your base fell at ${$('#clock').textContent}. Build more power and a second refinery earlier.`; }
}
function centerOn(e) { if (!e) return; cam.x = e.x - W / cam.zoom / 2; cam.y = e.y - H / cam.zoom / 2; clampCam(); }
function clampCam() { cam.x = clamp(cam.x, -CELL * 2, MAPW * CELL - W / cam.zoom + CELL * 2); cam.y = clamp(cam.y, -CELL * 2, MAPH * CELL - H / cam.zoom + CELL * 2); }
function entAt(wx, wy) { let best = null, bd = 1e9; for (const e of G.ents) { if (e.dead) continue; if (e.cloaked && e.owner !== UI.me && !canSee(UI.me, e)) continue; let dd; if (isStruct(e.def)) { if (wx >= e.cx * CELL && wx <= (e.cx + e.fw) * CELL && wy >= e.cy * CELL && wy <= (e.cy + e.fh) * CELL) dd = 0; else continue; } else dd = Math.hypot(e.x - wx, e.y - wy) - (isAir(e.def) ? 6 : 0); if (dd < 22 && dd < bd) { bd = dd; best = e; } } return best; }
function issue(wx, wy, forceAttackMove) {
  const t = entAt(wx, wy); const mine = UI.sel.filter(e => !isStruct(e.def));
  if (!mine.length) return;
  if (t && t.owner !== UI.me) { for (const e of mine) if (hasTag(e.def, 'engineer') && isStruct(t.def)) order(e, { type: 'capture', target: t }); else order(e, { type: 'attack', target: t }); say(mine[0], 'attack'); return; }
  if (t && t.owner === UI.me && /Refinery/.test(t.def.role) && mine.some(e => hasTag(e.def, 'harvester'))) { for (const e of mine) if (hasTag(e.def, 'harvester')) { e.returning = e.carry > 0; e.path = []; } return; }
  const n = mine.length, side = Math.ceil(Math.sqrt(n)); mine.forEach((e, i) => { const ox = (i % side - (side - 1) / 2) * 26, oy = (Math.floor(i / side) - (side - 1) / 2) * 26; order(e, { type: forceAttackMove || UI.mode === 'amove' ? 'attackmove' : 'move', x: wx + ox, y: wy + oy }); }); say(mine[0], 'move'); UI.mode = null; G.fx.push({ x: wx, y: wy, r: 10, t: 0, dur: 0.4, col: forceAttackMove ? '#f66' : '#8fe' });
}
function selectAt(wx, wy, add) { const t = entAt(wx, wy); if (t && t.owner === UI.me) { if (add) { if (!UI.sel.includes(t)) UI.sel.push(t); } else UI.sel = [t]; say(t, 'select'); return true; } if (!add) UI.sel = []; return false; }
function boxSelect(x0, y0, x1, y1, add) { const a = s2w(Math.min(x0, x1), Math.min(y0, y1)), b = s2w(Math.max(x0, x1), Math.max(y0, y1)); const got = G.ents.filter(e => !e.dead && e.owner === UI.me && !isStruct(e.def) && e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y); if (got.length) { const combat = got.filter(e => !hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer')); UI.sel = add ? [...new Set([...UI.sel, ...(combat.length ? combat : got)])] : (combat.length ? combat : got); say(UI.sel[0], 'select'); } else if (!add) UI.sel = []; }

// pointer input (mouse + touch)
const ptrs = new Map(); let lastPinch = 0;
cv.addEventListener('pointerdown', ev => { cv.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now(), button: ev.button, type: ev.pointerType, moved: false }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); } });
cv.addEventListener('pointermove', ev => {
  const p = ptrs.get(ev.pointerId); const w = s2w(ev.clientX - cv.getBoundingClientRect().left, ev.clientY - cv.getBoundingClientRect().top); UI.ghost = { x: Math.floor(w.x / CELL) - (UI.placing ? Math.floor(FOOT(UI.placing)[0] / 2) : 0), y: Math.floor(w.y / CELL) - (UI.placing ? Math.floor(FOOT(UI.placing)[1] / 2) : 0) }; UI.hover = w;
  if (!p) return; const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY; if (Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) > 8) p.moved = true;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (lastPinch) { const z = clamp(cam.zoom * d / lastPinch, 0.5, 2); const c = s2w(W / devicePixelRatio / 2, H / devicePixelRatio / 2); cam.zoom = z; cam.x = c.x - W / cam.zoom / 2; cam.y = c.y - H / cam.zoom / 2; } lastPinch = d; cam.x -= dx * devicePixelRatio / cam.zoom / 2; cam.y -= dy * devicePixelRatio / cam.zoom / 2; clampCam(); return; }
  if (!p.moved) return;
  const boxing = (p.button === 0 && p.type === 'mouse') || (p.type !== 'mouse' && UI.selectMode);
  if (boxing && !UI.placing) { const r = cv.getBoundingClientRect(); UI.box = { x0: p.sx - r.left, y0: p.sy - r.top, x1: ev.clientX - r.left, y1: ev.clientY - r.top }; }
  else { cam.x -= dx * devicePixelRatio / cam.zoom; cam.y -= dy * devicePixelRatio / cam.zoom; clampCam(); }
});
function endPtr(ev) {
  const p = ptrs.get(ev.pointerId); ptrs.delete(ev.pointerId); if (!p || !UI.started) { UI.box = null; return; }
  const r = cv.getBoundingClientRect(); const w = s2w(ev.clientX - r.left, ev.clientY - r.top);
  if (UI.box) { boxSelect(UI.box.x0, UI.box.y0, UI.box.x1, UI.box.y1, ev.shiftKey); UI.box = null; return; }
  if (p.moved || ptrs.size) return;
  if (UI.placing) { const [fw, fh] = FOOT(UI.placing); const cx = Math.floor(w.x / CELL) - Math.floor(fw / 2), cy = Math.floor(w.y / CELL) - Math.floor(fh / 2); if (place(UI.me, UI.placing, cx, cy)) { UI.placing = null; } else announce('Cannot place there: stay inside the build radius, off rock and off other buildings.'); return; }
  const isRight = p.button === 2; const long = performance.now() - p.t > 450 && p.type !== 'mouse';
  if (p.type === 'mouse') { if (isRight) issue(w.x, w.y, false); else if (UI.mode === 'amove') issue(w.x, w.y, true); else selectAt(w.x, w.y, ev.shiftKey); }
  else { // touch: tap own unit = select; tap enemy/ground with selection = order; long-press = attack-move
    const t = entAt(w.x, w.y); if (UI.mode === 'amove' || long) { issue(w.x, w.y, true); } else if (t && t.owner === UI.me && !(UI.sel.length && hasTag(t.def, 'harvester') === false && /Refinery/.test(t.def.role))) selectAt(w.x, w.y, false); else if (UI.sel.length) issue(w.x, w.y, false); else selectAt(w.x, w.y, false); }
}
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', ev => { ptrs.delete(ev.pointerId); UI.box = null; });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('wheel', ev => { ev.preventDefault(); const r = cv.getBoundingClientRect(); const before = s2w(ev.clientX - r.left, ev.clientY - r.top); cam.zoom = clamp(cam.zoom * (ev.deltaY < 0 ? 1.1 : 0.9), 0.5, 2); const after = s2w(ev.clientX - r.left, ev.clientY - r.top); cam.x += before.x - after.x; cam.y += before.y - after.y; clampCam(); }, { passive: false });
mini.addEventListener('pointerdown', ev => { const r = mini.getBoundingClientRect(); const wx = (ev.clientX - r.left) / r.width * MAPW * CELL, wy = (ev.clientY - r.top) / r.height * MAPH * CELL; if (ev.button === 2 && UI.sel.length) issue(wx, wy, false); else { cam.x = wx - W / cam.zoom / 2; cam.y = wy - H / cam.zoom / 2; clampCam(); } }); mini.addEventListener('contextmenu', e => e.preventDefault());
const keys = {};
window.addEventListener('keydown', ev => {
  if (!UI.started) return; keys[ev.key.toLowerCase()] = true; const k = ev.key.toLowerCase();
  if (k === 's') { for (const e of UI.sel) { e.order = null; e.path = []; e.target = null; } }
  if (k === 'a') UI.mode = UI.mode === 'amove' ? null : 'amove';
  if (k === 'd' || k === 'f') toggleDeploy();
  if (k === 'e') { const all = G.ents.filter(e => !e.dead && e.owner === UI.me && !isStruct(e.def) && !hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer')); UI.sel = ev.shiftKey ? all : all.filter(e => e.x > cam.x && e.x < cam.x + W / cam.zoom && e.y > cam.y && e.y < cam.y + H / cam.zoom); }
  if (k === 'h') { const cy = G.ents.find(e => !e.dead && e.owner === UI.me && /Construction/.test(e.def.role)); centerOn(cy); }
  if (k === 'escape') { UI.placing = null; UI.mode = null; UI.sel = []; }
  if (/^[0-9]$/.test(k)) { if (ev.ctrlKey || ev.metaKey) { if (UI.sel.length) UI.groups[k] = [...UI.sel]; } else if (UI.groups[k]) { UI.sel = [...UI.groups[k]]; if (UI.lastG === k) centerOn(UI.sel[0]); UI.lastG = k; } ev.preventDefault(); }
  if (k === 'tab') { ev.preventDefault(); const i = TABS.findIndex(t => t[0] === UI.tab); UI.tab = TABS[(i + 1) % TABS.length][0]; buildSidebar(); }
});
window.addEventListener('keyup', ev => { keys[ev.key.toLowerCase()] = false; });
function toggleDeploy() { for (const e of UI.sel) { const d = e.def; if (d.secondary && d.secondary.kind === 'deploy') { if (e.deployed) e.deployed = false; else { e.order = null; e.path = []; e.deployed = true; e.deployT = 0; } } } }
$('#secbtn').onclick = toggleDeploy; $('#stopbtn').onclick = () => { for (const e of UI.sel) { e.order = null; e.path = []; e.target = null; } }; $('#amovebtn').onclick = () => { UI.mode = UI.mode === 'amove' ? null : 'amove'; }; $('#sellbtn').onclick = () => { for (const e of UI.sel) sell(e); UI.sel = []; };
$('#selmode').onclick = () => { UI.selectMode = !UI.selectMode; $('#selmode').classList.toggle('on', UI.selectMode); }; $('#deselect').onclick = () => { UI.sel = []; UI.mode = null; UI.placing = null; };
$('#grpadd').onclick = () => { if (!UI.sel.length) return; const k = String(Object.keys(UI.groups).length + 1); UI.groups[k] = [...UI.sel]; };
$('#homebtn').onclick = () => { const cy = G.ents.find(e => !e.dead && e.owner === UI.me && /Construction/.test(e.def.role)); centerOn(cy); };
$('#speed').onclick = () => { G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 0.5 : 1; $('#speed').textContent = G.speed + '×'; };
document.querySelectorAll('[data-faction]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-faction]').forEach(x => x.classList.remove('on')); b.classList.add('on'); UI.pickF = b.dataset.faction; $('#fdesc').textContent = b.dataset.desc; });
$('#go').onclick = () => { const f = UI.pickF || 'compact'; const diff = $('#diff').value; const fs = Object.keys(FACTIONS).filter(x => x !== f); startGame(f, diff, $('#enemy').value === 'random' ? fs[Math.floor(Math.random() * fs.length)] : $('#enemy').value); };
$('#again').onclick = () => { $('#end').hidden = true; delete $('#end').dataset.shown; $('#start').hidden = false; $('#hud').hidden = true; UI.started = false; };

// main loop
let last = performance.now(), acc = 0;
function frame(now) {
  const el = Math.min(0.1, (now - last) / 1000); last = now;
  if (UI.started && !G.over) { acc += el * G.speed; let n = 0; while (acc >= DT && n++ < 8) { tick(DT); acc -= DT; } }
  if (UI.started) { const sp = 600 * el / cam.zoom; if (keys['arrowleft']) cam.x -= sp; if (keys['arrowright']) cam.x += sp; if (keys['arrowup']) cam.y -= sp; if (keys['arrowdown']) cam.y += sp; clampCam(); draw(); refreshSidebar(); }
  requestAnimationFrame(frame);
}
resize(); genMap(1); bakeTerrain(); requestAnimationFrame(frame);
// test hooks
window.__G = G; window.__UI = UI; window.__BY = BY; window.__ALL = ALL; window.__place = place; window.__enqueue = enqueue; window.__order = order; window.__buildSidebar = buildSidebar; window.__buildable = buildable;
})();
