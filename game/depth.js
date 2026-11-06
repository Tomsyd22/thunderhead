/* Thunderhead depth layer: unit buffs, secondary abilities, superweapons, doctrines. Spliced into sim.js's closure by build.js (see DEPTH_HOOK). */
// ───────── buffs / status ─────────
// e.buff = { until, rof, dmg, speed, taken, takenWh:{ROCKET:0.5}, invuln, noFire, noMove, rangeAdd }
function buffOf(e) { if (e.buff && e.buff.until < G.t) e.buff = null; return e.buff || {}; }
function addBuff(e, b, seconds) { e.buff = Object.assign({}, b, { until: G.t + seconds }); emit({ type: 'buff', e, name: b.name || '' }); }
function toggled(e) { return !!e.toggle; }
// per-unit toggle effects, read every tick
function toggleEffects(e) {
  const d = e.def; if (!e.toggle) return {};
  switch (d.id) {
    case 'lat_hornet': return { aaOnly: true, rangeAdd: 2 };
    case 'lat_sapper': return { cloakIdle: true };
    case 'lat_crawler': return { noMove: true, taken: 0.5, noMine: true };
    case 'lat_colossus': return { noMove: true, taken: 0.5, rangeAdd: 1 };
    case 'lat_stratos': return { takenWh: { FLAK: 0 }, noFire: true };
    case 'lat_gnat': return { takenWh: { FLAK: 0.5 }, dmg: 0.7 };
    case 'lat_barracuda': case 'cmp_pike': return { silent: true, noFire: true };
    case 'cmp_sniper': case 'hlx_nanodust': case 'hlx_smuggler': return { cloakIdle: true };
    case 'cmp_hunter': return { aaOnly: true, rangeAdd: 2 };
    case 'cmp_falcon': return { aaLoadout: true };
    case 'hlx_enforcer': return { takenWh: { SA: 0.5 }, speed: 0.7 };
    case 'hlx_dragonfly': return { noMove: true, rangeAdd: 2, dmg: 1.25, takenWh: { FLAK: 1.5 } };
    case 'hlx_phantom': return { surfaced: true };
    case 'hlx_warden': return { noFire: true, takenWh: { ROCKET: 0.5, SIEGE: 0.5 } };
    case 'lat_raptor': return { loiter: true };
    default: return {};
  }
}
function statOf(e, key, def) { const b = buffOf(e), t = toggleEffects(e); const bv = b[key], tv = t[key]; if (key === 'rangeAdd') return (bv || 0) + (tv || 0); if (key === 'takenWh') return Object.assign({}, tv || {}, bv || {}); if (typeof def === 'boolean') return !!(bv || tv); return (bv == null ? 1 : bv) * (tv == null ? 1 : tv); }
const canFireNow = e => !statOf(e, 'noFire', false);
const canMoveNow = e => !statOf(e, 'noMove', false);

// ───────── abilities ─────────
// kind: 'self' (no target), 'point' (map point), 'unit' (friendly or enemy entity). returns false if it could not fire.
const ABILITIES = {
  lat_scuttler: { kind: 'self', use: e => addBuff(e, { rof: 0.5, name: 'Overclock', after: () => damage(e, 10, null) }, 5) },
  lat_mimic: { kind: 'unit', use: (e, t) => { if (!t || t.owner === e.owner || !isInf(t.def) || isStruct(t.def)) return false; e.disguised = t.def.id; emit({ type: 'ability', e, name: 'Spoof IFF' }); return true; } },
  lat_mender: { kind: 'unit', friendly: true, use: (e, t) => { if (!t || !isStruct(t.def) || t.owner !== e.owner) return false; t.hp = Math.min(t.def.hp, t.hp + 200); return true; } },
  lat_aria: { kind: 'self', use: e => { for (const o of G.ents) if (!o.dead && hostile(o.owner, e.owner) && !isInf(o.def) && !isStruct(o.def) && dist(o, e) < 4 * CELL) { o.disabled = Math.max(o.disabled, 6); emit({ type: 'emp', e: o }); } emit({ type: 'pulse', x: e.x, y: e.y, r: 4 * CELL, col: 0x9ad7ff }); } },
  lat_wasp: { kind: 'self', use: e => { const w = G.wrecks.find(w => Math.hypot(w.x - e.x, w.y - e.y) < 2.5 * CELL); if (!w) return false; e.owner.credits += Math.round(w.cost * 0.25); G.wrecks = G.wrecks.filter(x => x !== w); emit({ type: 'cratepick', x: w.x, y: w.y, kind: 'salvage', p: e.owner }); return true; } },
  lat_lancer: { kind: 'self', use: e => { e.refract = true; } },
  lat_hive: { kind: 'self', use: e => { for (const o of G.ents) if (!o.dead && o.parent === e) { o.x = e.x + rnd(-20, 20); o.y = e.y + rnd(-20, 20); o.hp = o.def.hp; o.path = []; o.order = null; } } },
  lat_trident: { kind: 'self', use: e => revealSubs(e.owner, e.x, e.y, 10 * CELL, 8) },
  cmp_corvette: { kind: 'self', use: e => revealSubs(e.owner, e.x, e.y, 10 * CELL, 8) },
  lat_leviathan: { kind: 'self', use: e => { const w = e.def.weapons[0]; for (let i = G.ents.filter(s => !s.dead && s.parent === e).length; i < w.spawnMax; i++) { const s = mk(w.spawns, e.owner, e.x / CELL, e.y / CELL, { instant: true }); s.parent = e; } e.cds[0] = w.rof; } },
  cmp_grenadier: { kind: 'self', use: e => { e.thermo = true; } },
  cmp_engineer: { kind: 'unit', friendly: true, use: (e, t) => { if (!t || t.owner !== e.owner || isInf(t.def)) return false; t.hp = Math.min(t.def.hp, t.hp + 200); return true; } },
  hlx_fixer: { kind: 'unit', friendly: true, use: (e, t) => { if (!t || !isStruct(t.def) || t.owner !== e.owner) return false; t.hp = Math.min(t.def.hp, t.hp + 200); return true; } },
  cmp_warhound: { kind: 'self', use: e => { for (const o of G.ents) if (!o.dead && hostile(o.owner, e.owner) && (o.cloaked || o.def.disguise) && dist(o, e) < 8 * CELL) { o.revealedUntil = G.t + 10; } emit({ type: 'pulse', x: e.x, y: e.y, r: 8 * CELL, col: 0xffd86b }); } },
  cmp_sapper: { kind: 'point', use: (e, t, x, y) => { for (let i = 0; i < 3; i++) G.mines.push({ x: x + rnd(-24, 24), y: y + rnd(-24, 24), owner: e.owner, dmg: 150 }); emit({ type: 'mines', x, y }); } },
  cmp_ironside: { kind: 'self', use: e => { for (const o of G.ents) if (!o.dead && o.owner === e.owner && isInf(o.def) && dist(o, e) < 4 * CELL) addBuff(o, { taken: 0.5, name: 'Hold the Line' }, 8); emit({ type: 'pulse', x: e.x, y: e.y, r: 4 * CELL, col: 0xd9a441 }); } },
  cmp_harvester: { kind: 'self', use: e => { if (e.carry > 0) { e.returning = true; e.path = []; e.order = null; } } },
  lat_crawler_dump: { kind: 'self', use: e => { if (e.carry > 0) { e.returning = true; e.path = []; } } },
  cmp_scoutcar: { kind: 'point', use: (e, t, x, y) => { revealArea(e.owner, x, y, 6, 10); emit({ type: 'pulse', x, y, r: 6 * CELL, col: 0xffffff }); } },
  cmp_bastion: { kind: 'self', use: e => addBuff(e, { takenWh: { ROCKET: 0.5, BEAM: 0.5 }, speed: 0.7, name: 'Smoke' }, 6) },
  cmp_mule: { kind: 'self', use: e => { e.deployed = !e.deployed; } },
  cmp_behemoth: { kind: 'self', use: e => addBuff(e, { speed: 1.6, name: 'Overdrive', after: () => { e.disabled = Math.max(e.disabled, 2); } }, 8) },
  cmp_strato: { kind: 'self', use: e => addBuff(e, { speed: 2, name: 'Afterburners', after: () => damage(e, 150, null) }, 6) },
  cmp_admiral: { kind: 'self', use: e => { e.saturate = 4; e.cds[0] = 0; } },
  hlx_netrunner: { kind: 'self', use: e => { const v = G.ents.find(o => !o.dead && o.hackedBy === e && o.hackUntil); if (!v) return false; addBuff(e, { noFire: true, noMove: true, name: 'Deep Dive', after: () => { if (!v.dead && v.hackedBy === e) { v.hackUntil = 0; v.origOwner = e.owner; emit({ type: 'hack', e: v }); } } }, 5); return true; } },
  hlx_vesper: { kind: 'unit', friendly: true, use: (e, t) => { if (!t || !isStruct(t.def) || t.owner !== e.owner) return false; emit({ type: 'teleport', x1: e.x, y1: e.y, x2: t.x, y2: t.y }); e.x = t.x; e.y = t.y + (t.fh / 2 + 0.6) * CELL; e.path = []; e.order = null; return true; } },
  hlx_suppressor: { kind: 'self', use: e => addBuff(e, { rof: 0.5, name: 'Spin Up' }, 6) },
  hlx_puppeteer: { kind: 'self', use: e => { for (const o of G.ents) if (!o.dead && o.hackedBy === e) { o.owner = o.origOwner === e.owner ? o.owner : o.origOwner; o.hackedBy = null; o.hackUntil = 0; o.target = null; o.order = null; } } },
  hlx_disruptor: { kind: 'self', use: e => { e.resonance = true; } },
  hlx_mogul: { kind: 'self', use: e => { e.shield = e.def.shield.hp; e.disabled = Math.max(e.disabled, 3); } },
  hlx_specter: { kind: 'self', use: e => { for (const o of G.ents) if (!o.dead && hostile(o.owner, e.owner) && (o.def.weapons || []).some(w => w.aa) && dist(o, e) < 8 * CELL) addBuff(o, { rof: 2, name: 'Jammed' }, 6); emit({ type: 'pulse', x: e.x, y: e.y, r: 8 * CELL, col: 0xe0479e }); } },
  hlx_razor: { kind: 'unit', friendly: false, use: (e, t) => { if (!t || !isNaval(t.def) || t.owner === e.owner || dist(e, t) > 8 * CELL) return false; addBuff(t, { noFire: true, name: 'Jammed' }, 5); return true; } },
};
function abilityFor(e) { const d = e.def; if (!d.secondary) return null; if (d.secondary.kind === 'deploy' && !ABILITIES[d.id]) return { kind: 'deploy' }; if (d.id === 'lat_crawler') return ABILITIES[e.toggle ? 'lat_crawler' : 'lat_crawler'] ? null : null; const a = ABILITIES[d.id]; if (a) return a; if (d.secondary.kind === 'toggle') return { kind: 'toggle' }; return null; }
function useAbility(e, target, x, y) {
  const d = e.def; if (!d.secondary || e.dead) return false; const now = G.t;
  if (d.secondary.kind === 'toggle' && !ABILITIES[d.id]) { e.toggle = !e.toggle; if (e.toggle && toggleEffects(e).noMove) { e.path = []; e.order = null; } emit({ type: 'toggle', e }); return true; }
  if (d.secondary.kind === 'deploy' && !ABILITIES[d.id]) { if (e.deployed) e.deployed = false; else { e.order = null; e.path = []; e.deployed = true; e.deployT = 0; } return true; }
  const a = ABILITIES[d.id]; if (!a) return false; if ((e.abilityCd || 0) > now) return false;
  const ok = a.use(e, target, x, y); if (ok === false) return false;
  e.abilityCd = now + (d.secondary.cooldown || 0); emit({ type: 'ability', e, name: d.secondary.name }); return true;
}
function revealSubs(p, x, y, r, seconds) { for (const o of G.ents) if (!o.dead && hostile(o.owner, p) && o.def.submerged && Math.hypot(o.x - x, o.y - y) < r) o.revealedUntil = G.t + seconds; emit({ type: 'pulse', x, y, r, col: 0x5aa7ff }); }
function revealArea(p, x, y, rCells, seconds) { G.reveals.push({ p, x, y, r: rCells, until: G.t + seconds }); }

// ───────── mines, wrecks, reveals (ticked) ─────────
function depthTick(dt) {
  for (const m of G.mines) { if (m.dead) continue; for (const e of G.ents) { if (e.dead || e.inside || e.owner === m.owner || isStruct(e.def) || isAir(e.def) || isInf(e.def) || isNaval(e.def)) continue; if (Math.hypot(e.x - m.x, e.y - m.y) < 14) { m.dead = true; damage(e, m.dmg * verse({ wh: 'AP' }, e.def), null, 'AP'); emit({ type: 'mine', x: m.x, y: m.y }); break; } } }
  G.mines = G.mines.filter(m => !m.dead);
  G.wrecks = G.wrecks.filter(w => G.t - w.t < 40);
  G.reveals = G.reveals.filter(r => r.until > G.t);
  for (const r of G.reveals) { const v = r.p.vis; const cx = r.x / CELL, cy = r.y / CELL; for (let y = Math.max(0, Math.floor(cy - r.r)); y <= Math.min(MAPH - 1, Math.ceil(cy + r.r)); y++) for (let x = Math.max(0, Math.floor(cx - r.r)); x <= Math.min(MAPW - 1, Math.ceil(cx + r.r)); x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r.r) v[idx(x, y)] = 2; }
  for (const e of G.ents) if (!e.dead && e.buff && e.buff.until < G.t) { const a = e.buff.after; e.buff = null; if (a) a(); }
  // radiation fields
  for (const f of G.fields) { f.until -= dt; for (const e of G.ents) if (!e.dead && !e.inside && !isAir(e.def) && Math.hypot(e.x - f.x, e.y - f.y) < f.r) damage(e, f.dps * dt * verse({ wh: 'TOXIN' }, e.def), null, 'TOXIN'); }
  G.fields = G.fields.filter(f => f.until > 0);
  superTick(dt); doctrineTick(dt);
}

// ───────── superweapons ─────────
// Each superweapon structure charges while powered. p.sw = { def, structure, charge, ready }
function superTick(dt) {
  for (const p of G.players) {
    const sws = G.ents.filter(e => !e.dead && e.owner === p && e.def.superweapon && !e.building);
    p.sw = p.sw || {};
    for (const e of sws) { const k = e.def.id; p.sw[k] = p.sw[k] || { e, charge: 0, warned: false }; const st = p.sw[k]; st.e = e; if (!p.lowPower && st.charge < e.def.superweapon.charge) st.charge += dt; if (st.charge >= e.def.superweapon.charge && !st.ready) { { st.ready = true; announce(p.ai ? 'Enemy superweapon ready' : `${e.def.superweapon.name} ready`, p.ai ? 'bad' : 'good'); emit({ type: 'swready', p, k }); } } if (!st.detected && st.charge > 0) { st.detected = true; for (const q of G.players) if (q !== p && !q.ai) announce(`Enemy ${e.def.superweapon.name} detected`, 'warn'); } }
    for (const k of Object.keys(p.sw)) if (!sws.some(e => e.def.id === k)) delete p.sw[k];
    for (const s of G.swShots) { if (s.done) continue; s.t += dt; if (s.t >= s.delay) { s.done = true; s.fire(); } }
    if (p.ai && p.useSuper !== false) for (const k of Object.keys(p.sw)) { const st = p.sw[k]; if (st.ready) { const en = nearestEnemyPlayer(p); const targets = en ? G.ents.filter(e => !e.dead && e.owner === en && isStruct(e.def) && e.def.cls === 'structure') : []; if (targets.length) { const t = targets.reduce((b, e) => (!b || e.def.cost > b.def.cost) ? e : b, null); fireSuper(p, k, t.x, t.y, { x: t.x, y: t.y }); } } }
  }
  G.swShots = G.swShots.filter(s => !s.done);
}
function fireSuper(p, k, x, y, src) {
  const st = p.sw && p.sw[k]; if (!st || !st.ready) return false; const sw = st.e.def.superweapon; st.ready = false; st.charge = 0; st.detected = false;
  announce(p.ai ? `Enemy ${sw.name} launched` : `${sw.name} launched`, p.ai ? 'bad' : 'good'); emit({ type: 'swfire', p, k, x, y, name: sw.name });
  const enemyOf = o => hostile(o.owner, p) && o.owner !== G.neutral;
  switch (k) {
    case 'lat_kessler': { for (let i = 0; i < 20; i++) G.swShots.push({ t: 0, delay: 2 + i * 0.6, fire: () => { const a = Math.random() * 6.28, r = Math.random() * 7 * CELL; const ix = x + Math.cos(a) * r, iy = y + Math.sin(a) * r; emit({ type: 'impact', x: ix, y: iy, big: true }); for (const e of G.ents) if (!e.dead && !e.inside && !isAir(e.def) && Math.hypot(e.x - ix, e.y - iy) < 1.5 * CELL) damage(e, 300 * verse({ wh: 'SIEGE' }, e.def), st.e, 'SIEGE'); } }); break; }
    case 'lat_daisy': { for (const e of G.ents) if (!e.dead && e.owner === p && !isStruct(e.def) && Math.hypot(e.x - x, e.y - y) < 4 * CELL) addBuff(e, { invuln: true, rof: 0.5, name: 'Daisy Chain' }, 10); emit({ type: 'dome', x, y, r: 4 * CELL, col: 0x2ec4d6, seconds: 10 }); break; }
    case 'cmp_silo': { G.swShots.push({ t: 0, delay: 10, fire: () => { emit({ type: 'nuke', x, y }); for (const e of G.ents) if (!e.dead && !e.inside) { const dd = Math.hypot(e.x - x, e.y - y) / CELL; if (dd < 4) damage(e, (2000 - (2000 - 400) * dd / 4) * verse({ wh: 'SIEGE' }, e.def), st.e, 'SIEGE'); } G.fields.push({ x, y, r: 4 * CELL, dps: 10, until: 30 }); } }); break; }
    case 'cmp_aegis': { for (const e of G.ents) if (!e.dead && e.owner === p && Math.hypot(e.x - x, e.y - y) < 5 * CELL) addBuff(e, { invuln: true, noFire: isStruct(e.def), name: 'Aegis Dome' }, isStruct(e.def) ? 25 : 8); emit({ type: 'dome', x, y, r: 5 * CELL, col: 0xd9a441, seconds: 25 }); break; }
    case 'hlx_blackout': { const en = nearestEnemyPlayer(p); const hit = []; for (const e of G.ents) if (!e.dead && enemyOf(e) && !isInf(e.def) && Math.hypot(e.x - x, e.y - y) < 8 * CELL) { e.disabled = Math.max(e.disabled, 30); emit({ type: 'emp', e }); if (!isStruct(e.def) && !isAir(e.def) && !hasTag(e.def, 'hero') && !hasTag(e.def, 'nohack')) hit.push(e); } if (en) { en.powerOutUntil = G.t + 60; } hit.sort(() => Math.random() - 0.5).slice(0, 3).forEach(v => { v.origOwner = p; v.owner = p; v.hackUntil = 0; v.hackedBy = st.e; v.target = null; v.order = null; emit({ type: 'hack', e: v }); }); emit({ type: 'pulse', x, y, r: 8 * CELL, col: 0xe0479e }); break; }
    case 'hlx_transit': { if (!src) return false; const units = G.ents.filter(e => !e.dead && !e.inside && !isStruct(e.def) && !isAir(e.def) && Math.abs(e.x - src.x) < 1.5 * CELL && Math.abs(e.y - src.y) < 1.5 * CELL).slice(0, 9); let i = 0; for (const e of units) { if (isInf(e.def)) { kill(e, st.e); continue; } const ox = (i % 3 - 1) * CELL, oy = (Math.floor(i / 3) - 1) * CELL; i++; emit({ type: 'teleport', x1: e.x, y1: e.y, x2: x + ox, y2: y + oy }); e.x = x + ox; e.y = y + oy; e.path = []; e.order = null; const t = G.terrain[idx(clamp(Math.floor(e.x / CELL), 0, MAPW - 1), clamp(Math.floor(e.y / CELL), 0, MAPH - 1))]; if (t === TT.WATER && !isNaval(e.def) && !e.def.amphibious && !e.def.hover) kill(e, st.e); } break; }
  }
  return true;
}

// ───────── doctrines ─────────
const DOCTRINES = {
  lattice: [
    { id: 'swarmdrop', name: 'Swarm Drop', tier: 1, cd: 180, kind: 'point', desc: 'Six Scuttlers drop anywhere you can see.', use: (p, x, y) => { for (let i = 0; i < 6; i++) { const s = mk('lat_scuttler', p, x / CELL + rnd(-1, 1), y / CELL + rnd(-1, 1), { instant: true }); emit({ type: 'drop', e: s }); } } },
    { id: 'overclock', name: 'Mesh Overclock', tier: 1, cd: 120, kind: 'point', desc: 'Your units within 6 cells fire 25% faster for 20 s.', use: (p, x, y) => { for (const e of G.ents) if (!e.dead && e.owner === p && !isStruct(e.def) && Math.hypot(e.x - x, e.y - y) < 6 * CELL) addBuff(e, { rof: 0.8, name: 'Overclock' }, 20); emit({ type: 'pulse', x, y, r: 6 * CELL, col: 0x2ec4d6 }); } },
    { id: 'satscan', name: 'Satellite Scan', tier: 2, cd: 90, kind: 'point', desc: 'Reveal a 12-cell radius for 15 s.', use: (p, x, y) => revealArea(p, x, y, 12, 15) },
    { id: 'nullfield', name: 'Null Field', tier: 2, cd: 150, kind: 'point', desc: 'EMP every enemy vehicle within 5 cells for 8 s.', use: (p, x, y) => { for (const e of G.ents) if (!e.dead && hostile(e.owner, p) && e.owner !== G.neutral && !isInf(e.def) && !isStruct(e.def) && Math.hypot(e.x - x, e.y - y) < 5 * CELL) { e.disabled = Math.max(e.disabled, 8); emit({ type: 'emp', e }); } emit({ type: 'pulse', x, y, r: 5 * CELL, col: 0x9ad7ff }); } },
    { id: 'fabricate', name: 'Fabricate', tier: 3, cd: 240, kind: 'self', desc: 'Your next structure is free.', use: p => { p.freeStructure = true; } },
    { id: 'fragment', name: 'Kessler Fragment', tier: 3, cd: 240, kind: 'point', desc: 'Three debris strikes of 300 damage on a point.', use: (p, x, y) => { for (let i = 0; i < 3; i++) G.swShots.push({ t: 0, delay: 1.5 + i * 0.7, fire: () => { const ix = x + rnd(-40, 40), iy = y + rnd(-40, 40); emit({ type: 'impact', x: ix, y: iy, big: true }); for (const e of G.ents) if (!e.dead && !e.inside && !isAir(e.def) && Math.hypot(e.x - ix, e.y - iy) < 1.5 * CELL) damage(e, 300 * verse({ wh: 'SIEGE' }, e.def), null, 'SIEGE'); } }); } },
  ],
  compact: [
    { id: 'paradrop', name: 'Paradrop', tier: 1, cd: 180, kind: 'point', desc: 'Five Riflemen parachute in.', use: (p, x, y) => { for (let i = 0; i < 5; i++) { const s = mk('cmp_rifleman', p, x / CELL + rnd(-1, 1), y / CELL + rnd(-1, 1), { instant: true }); emit({ type: 'drop', e: s }); } } },
    { id: 'barrage', name: 'Artillery Barrage', tier: 1, cd: 120, kind: 'point', desc: 'Six shells of 90 damage scattered over a 3-cell radius.', use: (p, x, y) => { for (let i = 0; i < 6; i++) G.swShots.push({ t: 0, delay: 1 + i * 0.5, fire: () => { const a = Math.random() * 6.28, r = Math.random() * 3 * CELL; const ix = x + Math.cos(a) * r, iy = y + Math.sin(a) * r; emit({ type: 'impact', x: ix, y: iy, big: false }); for (const e of G.ents) if (!e.dead && !e.inside && !isAir(e.def) && Math.hypot(e.x - ix, e.y - iy) < 1.2 * CELL) damage(e, 90 * (1 - 0.5 * Math.hypot(e.x - ix, e.y - iy) / (1.2 * CELL)) * verse({ wh: 'SIEGE' }, e.def), null, 'SIEGE'); } }); } },
    { id: 'sortie', name: 'Sortie', tier: 2, cd: 120, kind: 'point', desc: 'Two missile strikes of 150 damage on the target.', use: (p, x, y) => { for (let i = 0; i < 2; i++) G.swShots.push({ t: 0, delay: 2 + i * 0.8, fire: () => { emit({ type: 'impact', x, y, big: false }); for (const e of G.ents) if (!e.dead && !e.inside && Math.hypot(e.x - x, e.y - y) < 1.2 * CELL) damage(e, 150 * verse({ wh: 'ROCKET' }, e.def), null, 'ROCKET'); } }); } },
    { id: 'academy', name: 'Veteran Academy', tier: 2, cd: 240, kind: 'self', desc: 'Your next five units are Veterans.', use: p => { p.vetCredits = (p.vetCredits || 0) + 5; } },
    { id: 'minefield', name: 'Minefield', tier: 3, cd: 180, kind: 'point', desc: 'Eight anti-tank mines around the point.', use: (p, x, y) => { for (let i = 0; i < 8; i++) G.mines.push({ x: x + rnd(-48, 48), y: y + rnd(-48, 48), owner: p, dmg: 150 }); emit({ type: 'mines', x, y }); } },
    { id: 'tacnuke', name: 'Tactical Nuke', tier: 3, cd: 420, kind: 'point', desc: '600 damage in a 2.5-cell radius, then radiation for 10 s.', use: (p, x, y) => { G.swShots.push({ t: 0, delay: 4, fire: () => { emit({ type: 'nuke', x, y, small: true }); for (const e of G.ents) if (!e.dead && !e.inside && Math.hypot(e.x - x, e.y - y) < 2.5 * CELL) damage(e, 600 * verse({ wh: 'SIEGE' }, e.def), null, 'SIEGE'); G.fields.push({ x, y, r: 2.5 * CELL, dps: 10, until: 10 }); } }); } },
  ],
  helix: [
    { id: 'bounty', name: 'Bounty Contract', tier: 1, cd: 180, kind: 'self', desc: 'For 60 s every kill refunds 20% of the victim\'s cost.', use: p => { p.bountyUntil = G.t + 60; } },
    { id: 'crash', name: 'Market Crash', tier: 1, cd: 240, kind: 'self', desc: 'The enemy loses 10% of their credits.', use: p => { for (const q of G.players) if (hostile(q, p)) q.credits = Math.floor(q.credits * 0.9); } },
    { id: 'jam', name: 'Signal Jam', tier: 2, cd: 180, kind: 'self', desc: 'Enemy radar is off for 60 s.', use: p => { for (const q of G.players) if (hostile(q, p)) q.radarOffUntil = G.t + 60; } },
    { id: 'takeover', name: 'Hostile Takeover', tier: 2, cd: 240, kind: 'unit', desc: 'Permanently hack one enemy vehicle anywhere.', use: (p, x, y, t) => { if (!t || t.owner === p || isInf(t.def) || isStruct(t.def) || hasTag(t.def, 'hero') || hasTag(t.def, 'nohack') || hasTag(t.def, 'mcv')) return false; t.origOwner = p; t.owner = p; t.hackUntil = 0; t.hackedBy = null; t.target = null; t.order = null; emit({ type: 'hack', e: t }); } },
    { id: 'insider', name: 'Insider Trading', tier: 3, cd: 240, kind: 'self', desc: '+$2,000 now.', use: p => { p.credits += 2000; } },
    { id: 'rift', name: 'Quantum Rift', tier: 3, cd: 300, kind: 'point', desc: 'Teleport up to three selected vehicles to the point.', use: (p, x, y, t, sel) => { const u = (sel || []).filter(e => !e.dead && !isStruct(e.def) && !isInf(e.def) && !isAir(e.def)).slice(0, 3); if (!u.length) return false; u.forEach((e, i) => { emit({ type: 'teleport', x1: e.x, y1: e.y, x2: x + (i - 1) * CELL, y2: y }); e.x = x + (i - 1) * CELL; e.y = y; e.path = []; e.order = null; }); } },
  ],
};
function doctrineTick(dt) {
  for (const p of G.players) { p.doc = p.doc || { points: 0, acc: 0, owned: {}, cds: {} }; p.doc.acc += dt; if (p.doc.acc >= 60 / RULES.doctrines.pointsPerMinute) { p.doc.acc = 0; p.doc.points++; if (!p.ai) announce('Doctrine point available', 'good'); }
    if (p.ai && p.useDoctrine !== false && p.doc.points > 0) { const list = DOCTRINES[p.faction]; const d = list.find(x => !p.doc.owned[x.id] && tierOpen(p, x.tier)); if (d) buyDoctrine(p, d.id); }
    if (p.ai && p.useDoctrine !== false) for (const d of DOCTRINES[p.faction]) if (p.doc.owned[d.id] && (p.doc.cds[d.id] || 0) <= G.t) { const en = nearestEnemyPlayer(p); if (!en) continue; if (d.kind === 'self') useDoctrine(p, d.id); else if (d.kind === 'point') { const t = G.ents.filter(e => !e.dead && e.owner === en && !isStruct(e.def)).sort(() => Math.random() - 0.5)[0] || G.ents.find(e => !e.dead && e.owner === en && isStruct(e.def)); if (t && (d.id === 'swarmdrop' || d.id === 'paradrop' || d.id === 'overclock')) { const home = G.ents.find(e => !e.dead && e.owner === p && /Construction/.test(e.def.role)); if (home) useDoctrine(p, d.id, home.x + 80, home.y + 80); } else if (t && d.id !== 'satscan' && d.id !== 'minefield') useDoctrine(p, d.id, t.x, t.y); } } }
}
/* doctrine tiers: T1 always; T2 needs a radar-class structure and one T1 doctrine; T3 needs a tech centre and one T2 doctrine (RA3 protocols gated by RA2 tech) */
const tierOpen = (p, tier) => { if (tier === 1) return true; if (!p.doc) return false; const prev = DOCTRINES[p.faction].filter(d => d.tier === tier - 1).some(d => p.doc.owned[d.id]); if (!prev) return false; const need = tier === 2 ? /Radar|mesh hub/ : /Tech centre/; return G.ents.some(e => !e.dead && e.owner === p && !e.building && need.test(e.def.role)); };
function buyDoctrine(p, id) { const d = DOCTRINES[p.faction].find(x => x.id === id); if (!d || p.doc.owned[id] || p.doc.points < 1 || !tierOpen(p, d.tier)) return false; p.doc.points--; p.doc.owned[id] = true; emit({ type: 'doctrine', p, id }); return true; }
function useDoctrine(p, id, x, y, target, sel) { const d = DOCTRINES[p.faction].find(x => x.id === id); if (!d || !p.doc.owned[id] || (p.doc.cds[id] || 0) > G.t) return false; const r = d.use(p, x, y, target, sel); if (r === false) return false; p.doc.cds[id] = G.t + d.cd; emit({ type: 'doctrineuse', p, id, x, y, name: d.name }); if (!p.ai) announce(`${d.name} deployed`, 'good'); return true; }
