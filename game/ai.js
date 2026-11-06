/* Thunderhead AI: five difficulties with distinct behaviour sets. Spliced into sim.js's closure by build.js. */
const DIFF = {
  recruit: { name: 'Recruit', think: 2.0, income: 0.7, build: 0.7, attackMin: 480, attackValue: 3000, waveGrow: 500, counter: false, scout: false, harass: false, retreat: false, micro: false, garrison: false, derricks: false, tech: 1, defences: 1, harvPerRef: 1, maxRefs: 2, abilities: false, super: false, doctrine: false, startBonus: -4000, armyCap: 6000, defend: false },
  easy:    { name: 'Easy',    think: 1.5, income: 0.85, build: 0.85, attackMin: 360, attackValue: 3500, waveGrow: 700, counter: false, scout: true, harass: false, retreat: false, micro: false, garrison: false, derricks: false, tech: 2, defences: 2, harvPerRef: 1, maxRefs: 2, abilities: false, super: true, doctrine: true, startBonus: -2000, armyCap: 8000, defend: true },
  normal:  { name: 'Normal',  think: 1.0, income: 1.0, build: 1.0, attackMin: 300, attackValue: 4500, waveGrow: 1000, counter: true, scout: true, harass: false, retreat: true, micro: false, garrison: true, derricks: true, tech: 3, defences: 3, harvPerRef: 1.5, maxRefs: 3, abilities: true, super: true, doctrine: true, startBonus: 0, armyCap: 11000, defend: true },
  hard:    { name: 'Hard',    think: 0.6, income: 1.15, build: 1.15, attackMin: 200, attackValue: 5000, waveGrow: 1300, counter: true, scout: true, harass: true, retreat: true, micro: true, garrison: true, derricks: true, tech: 3, defences: 4, harvPerRef: 2, maxRefs: 4, abilities: true, super: true, doctrine: true, startBonus: 2000, armyCap: 14000, defend: true },
  brutal:  { name: 'Brutal',  think: 0.4, income: 1.3, build: 1.25, attackMin: 150, attackValue: 5500, waveGrow: 1600, counter: true, scout: true, harass: true, retreat: true, micro: true, garrison: true, derricks: true, tech: 3, defences: 5, harvPerRef: 2, maxRefs: 5, abilities: true, super: true, doctrine: true, startBonus: 5000, armyCap: 18000, defend: true },
};
// unit roles per faction for counter-building: [core, antiTank, antiInf, antiAir, siege, raid, scout, engineer]
const ROLES = {
  lattice: { core: ['lat_phalanx', 'lat_phalanx', 'lat_hornet', 'lat_scuttler'], antiTank: ['lat_hornet', 'lat_lancer', 'lat_phalanx'], antiInf: ['lat_lamplighter', 'lat_scuttler', 'lat_gnat', 'lat_lamplighter'], antiAir: ['lat_hornet', 'lat_colossus'], siege: ['lat_lancer', 'lat_stratos', 'lat_sapper'], raid: ['lat_wasp', 'lat_hornet'], scout: 'lat_wasp', engineer: 'lat_mender', heavy: ['lat_colossus', 'lat_aria', 'lat_raptor', 'lat_nullproj'] },
  compact: { core: ['cmp_bastion', 'cmp_rifleman'], antiTank: ['cmp_rockettrooper', 'cmp_behemoth'], antiInf: ['cmp_grenadier', 'cmp_kondor', 'cmp_bastion'], antiAir: ['cmp_hunter', 'cmp_rockettrooper'], siege: ['cmp_hailstorm', 'cmp_strato', 'cmp_sapper'], raid: ['cmp_scoutcar', 'cmp_falcon'], scout: 'cmp_scoutcar', engineer: 'cmp_engineer', heavy: ['cmp_behemoth', 'cmp_ironside', 'cmp_falcon', 'cmp_strato'] },
  helix:   { core: ['hlx_arbiter', 'hlx_arbiter', 'hlx_suppressor', 'hlx_enforcer'], antiTank: ['hlx_arbiter', 'hlx_netrunner', 'hlx_mogul', 'hlx_arbiter'], antiInf: ['hlx_suppressor', 'hlx_enforcer', 'hlx_suppressor', 'hlx_nanodust'], antiAir: ['hlx_suppressor', 'hlx_mogul'], siege: ['hlx_disruptor', 'hlx_specter'], raid: ['hlx_interceptor', 'hlx_shade'], scout: 'hlx_interceptor', engineer: 'hlx_fixer', heavy: ['hlx_mogul', 'hlx_puppeteer', 'hlx_vesper', 'hlx_dragonfly'] },
};
const BUILD = {
  lattice: [['lat_reactor', 1], ['lat_extractor', 1], ['lat_fabbay', 1], ['lat_assembly', 1], ['lat_reactor', 1], ['lat_sentinel', 1], ['lat_extractor', 1], ['lat_uplink', 2], ['lat_reactor', 2], ['lat_lance', 2], ['lat_hangar', 2], ['lat_sentinel', 2], ['lat_reactor', 2], ['lat_logic', 3], ['lat_reclaimer', 2], ['lat_pylon', 2], ['lat_reactor', 3], ['lat_nullifier', 3], ['lat_kessler', 3], ['lat_reactor', 3], ['lat_lance', 3], ['lat_daisy', 3], ['lat_reactor', 3], ['lat_extractor', 3], ['lat_sentinel', 3]],
  compact: [['cmp_reactor', 1], ['cmp_refinery', 1], ['cmp_barracks', 1], ['cmp_armour', 1], ['cmp_reactor', 1], ['cmp_bunker', 1], ['cmp_refinery', 1], ['cmp_radar', 2], ['cmp_reactor', 2], ['cmp_sam', 2], ['cmp_airfield', 2], ['cmp_railturret', 2], ['cmp_reactor', 2], ['cmp_research', 3], ['cmp_depot', 2], ['cmp_arsenal', 2], ['cmp_reactor', 3], ['cmp_silo', 3], ['cmp_sam', 3], ['cmp_reactor', 3], ['cmp_aegis', 3], ['cmp_railturret', 3], ['cmp_reactor', 3], ['cmp_refinery', 3], ['cmp_bunker', 3]],
  helix:   [['hlx_solar', 1], ['hlx_refinery', 1], ['hlx_office', 1], ['hlx_plant', 1], ['hlx_solar', 1], ['hlx_autoturret', 1], ['hlx_refinery', 1], ['hlx_surveil', 2], ['hlx_solar', 2], ['hlx_flaknest', 2], ['hlx_skyport', 2], ['hlx_stuntower', 2], ['hlx_solar', 2], ['hlx_campus', 3], ['hlx_market', 2], ['hlx_solar', 3], ['hlx_vats', 3], ['hlx_blackout', 3], ['hlx_flaknest', 3], ['hlx_solar', 3], ['hlx_transit', 3], ['hlx_stuntower', 3], ['hlx_solar', 3], ['hlx_refinery', 3], ['hlx_autoturret', 3]],
};
function aiInit(p) { const D = DIFF[p.difficulty] || DIFF.normal; p.D = D; p.incomeMul = D.income; p.buildMul = D.build; p.credits += D.startBonus; p.useSuper = D.super; p.useDoctrine = D.doctrine; p.ai2 = { t: 0, state: 'build', memStructs: new Set(), seenInf: 0, seenVeh: 0, seenAir: 0, wave: 0, attackStart: 0, attackValue0: 0, rally: null, lastHarass: 60, lastScout: 0, lastDefend: -99, defendPt: null, lastGarrison: 0, lastDerrick: 0, squad: new Set(), raiders: new Set(), scouts: new Set(), stats: { waves: [], raids: 0, retreats: 0, defends: 0, scouts: 0, garrisons: 0, captures: 0, abilities: 0, micro: 0, counterBuys: 0 } }; }
function aiTick(p, dt) {
  if (!p.ai2) aiInit(p); const A = p.ai2, D = p.D; A.t += dt; if (A.t < D.think) return; A.t = 0;
  const en = nearestEnemyPlayer(p); if (!en) return; const foes = enemiesOf(p);
  const mine = G.ents.filter(e => !e.dead && !e.inside && e.owner === p);
  const home = mine.find(e => /Construction/.test(e.def.role)) || mine.find(e => isStruct(e.def)); if (!home) return;
  const ehome = G.ents.find(e => !e.dead && e.owner === en && /Construction/.test(e.def.role)) || G.ents.find(e => !e.dead && e.owner === en && isStruct(e.def));
  // memory of what we have seen
  for (const e of G.ents) if (!e.dead && foes.includes(e.owner) && visibleTo(p, e)) { if (isStruct(e.def)) A.memStructs.add(e); else { const v = e.def.cost * 0.15; if (isAir(e.def)) A.seenAir += v; else if (isInf(e.def)) A.seenInf += v; else A.seenVeh += v; } }
  A.seenAir *= 0.92; A.seenInf *= 0.92; A.seenVeh *= 0.92; for (const s of A.memStructs) if (s.dead || !hostile(s.owner, p)) A.memStructs.delete(s);
  // ─ economy & base
  const refs = mine.filter(e => /Refinery/.test(e.def.role)), harv = mine.filter(e => hasTag(e.def, 'harvester')), R = ROLES[p.faction];
  if (!p.ready && !(p.queue.structure || []).length && !(p.queue.defence || []).length) {
    let next = null; const seen = {}; let defCount = 0;
    for (const [id, tier] of BUILD[p.faction]) { if (tier > D.tech) continue; const d = BY[id]; if (d.cls === 'defence') { defCount++; if (defCount > D.defences) continue; } if (/Refinery/.test(d.role) && countOwn(p, id) >= D.maxRefs) continue; seen[id] = (seen[id] || 0) + 1; if (countOwn(p, id) + ((p.queue[tabOf(d)] || []).filter(q => q.def.id === id).length) < seen[id]) { if (canBuild(p, d)) next = id; break; } }
    const plant = BUILD[p.faction][0][0];
    if (p.lowPower && canBuild(p, BY[plant])) enqueue(p, BY[plant]);
    else if (next && (p.credits > BY[next].cost * 0.8 || /Refinery|Power/.test(BY[next].role))) enqueue(p, BY[next]);
    else if (!next && D.tech >= 2 && p.credits > 4000) { const extra = BUILD[p.faction].filter(([id]) => BY[id].cls === 'defence' && canBuild(p, BY[id]))[0]; if (extra && countOwn(p, extra[0]) < D.defences + 2) enqueue(p, BY[extra[0]]); }
  }
  const wantHarv = Math.min(refs.length * D.harvPerRef + 1, 6) | 0; const hd = ALL.find(d => d.faction === p.faction && hasTag(d, 'harvester'));
  if (harv.length < wantHarv && p.credits > 1200 && canBuild(p, hd) && !(p.queue.vehicle || []).some(q => hasTag(q.def, 'harvester'))) enqueue(p, hd);
  // ─ army composition (counter-build)
  const army = mine.filter(e => !isStruct(e.def) && !hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer') && !isNaval(e.def) && !A.scouts.has(e) && !A.raiders.has(e));
  const value = army.reduce((s, e) => s + e.def.cost, 0);
  if (p.credits > 500 && value < D.armyCap && (refs.length >= 1 || G.t > 200)) {
    const tot = A.seenInf + A.seenVeh + A.seenAir + 1; let pool;
    if (D.counter && tot > 50) { A.stats.counterBuys++; const r = Math.random() * tot; pool = r < A.seenAir ? R.antiAir : r < A.seenAir + A.seenVeh ? R.antiTank : R.antiInf; if (Math.random() < 0.35) pool = R.core; if (Math.random() < 0.15) pool = R.siege; if (D.tech >= 3 && Math.random() < 0.2) pool = R.heavy; }
    else { pool = Math.random() < 0.6 ? R.core : Math.random() < 0.5 ? R.antiTank : R.antiInf; if (D.tech >= 3 && Math.random() < 0.15) pool = R.heavy; }
    const ok = pool.filter(id => canBuild(p, BY[id]) && factoryFor(p, BY[id]).length); if (ok.length) { const id = ok[Math.floor(Math.random() * ok.length)]; if ((p.queue[tabOf(BY[id])] || []).length < 2) enqueue(p, BY[id]); }
  }
  // ─ scouting
  if (D.scout && G.t - A.lastScout > 150 && ehome) { A.lastScout = G.t; const sc = (D.harass ? null : army.find(e => e.def.id === R.scout)) || army.find(e => isInf(e.def) && e.def.cost <= 250) || army.find(e => e.def.id === R.scout); if (sc) { A.scouts.add(sc); A.stats.scouts++; order(sc, { type: 'move', x: ehome.x + rnd(-80, 80), y: ehome.y + rnd(-80, 80) }); } }
  for (const s of A.scouts) if (s.dead || (!s.order && !s.target)) { A.scouts.delete(s); }
  // ─ derricks and garrisons
  if (D.derricks && G.t - A.lastDerrick > 60) { A.lastDerrick = G.t; const der = G.ents.filter(e => !e.dead && e.def.tech && e.owner !== p).sort((a, b) => dist(a, home) - dist(b, home))[0]; if (der && dist(der, home) < 48 * CELL) { const eng = mine.find(e => hasTag(e.def, 'engineer') && (!e.order || e.order.type === 'move')); if (eng) { order(eng, { type: 'capture', target: der }); A.stats.captures++; } else if (canBuild(p, BY[R.engineer]) && p.credits > 800 && !mine.some(e => hasTag(e.def, 'engineer'))) enqueue(p, BY[R.engineer]); } }
  if (D.garrison && G.t - A.lastGarrison > 90) { A.lastGarrison = G.t; const civ = G.ents.filter(e => !e.dead && e.def.garrison && e.owner === G.neutral && dist(e, home) < 36 * CELL).sort((a, b) => dist(a, home) - dist(b, home))[0]; if (civ) { const inf = army.filter(e => e.def.canGarrison && !e.order).slice(0, 2); for (const i of inf) { order(i, { type: 'garrison', target: civ }); A.squad.delete(i); A.stats.garrisons++; } } }
  // ─ harassment raids on harvesters
  if (D.harass && G.t - A.lastHarass > 45) { A.lastHarass = G.t; const fast = army.filter(e => R.raid.includes(e.def.id) && !A.squad.has(e)).slice(0, 3); const eh = G.ents.filter(e => !e.dead && foes.includes(e.owner) && hasTag(e.def, 'harvester')); const tgt = eh.length ? eh[Math.floor(Math.random() * eh.length)] : null; if (fast.length >= 2 && tgt) { A.stats.raids++; for (const u of fast) { A.raiders.add(u); order(u, { type: 'attack', target: tgt }); } } else if (fast.length < 3 && p.credits > 300) { const rd = R.raid.map(id => BY[id]).find(d => canBuild(p, d) && factoryFor(p, d).length); if (rd && (p.queue[tabOf(rd)] || []).length < 4) { enqueue(p, rd); A.lastHarass = G.t - 25; } } }
  for (const r of A.raiders) { if (r.dead) { A.raiders.delete(r); continue; } if (!r.target && !r.order) { if (r.hp < r.def.hp * 0.5 || Math.random() < 0.3) { A.raiders.delete(r); order(r, { type: 'move', x: home.x + 60, y: home.y + 60 }); } else { const eh = G.ents.filter(e => !e.dead && foes.includes(e.owner) && hasTag(e.def, 'harvester')); if (eh.length) order(r, { type: 'attack', target: eh[0] }); else { A.raiders.delete(r); } } } }
  // ─ defence response: only for hits near our base, only with units at home
  const hitHome = p.lastHitAt && dist(p.lastHitAt, home) < 20 * CELL;
  if (D.defend && hitHome && (p.lastHitT || -99) > A.lastDefend && G.t - (p.lastHitT || -99) < 3 && A.state !== 'attack' && A.state !== 'gather') {
    const threat = G.ents.filter(e => !e.dead && foes.includes(e.owner) && !isStruct(e.def) && dist(e, home) < 24 * CELL);
    if (threat.length) { A.lastDefend = G.t; A.state = 'defend'; A.stats.defends++; A.defendT = G.t; const c = threat[0]; A.defendPt = { x: c.x, y: c.y }; const defenders = army.filter(e => !e.inside && dist(e, home) < 22 * CELL); orderGroup(defenders, A.defendPt.x, A.defendPt.y, 'attackmove'); }
  }
  if (A.state === 'defend') { const still = G.ents.some(e => !e.dead && foes.includes(e.owner) && !isStruct(e.def) && dist(e, home) < 22 * CELL); if (!still || G.t - A.defendT > 45) { A.state = 'build'; const back = army.filter(e => dist(e, home) < 30 * CELL && !e.target); orderGroup(back, home.x + 90, home.y + 90, 'move'); } }
  // ─ attack cycle
  const threshold = D.attackValue + A.wave * D.waveGrow;
  if (A.state === 'build' && ehome && ((G.t > D.attackMin && value >= threshold) || value >= D.armyCap * 0.95)) {
    A.state = 'gather'; A.gatherT = G.t; const ang = Math.atan2(ehome.y - home.y, ehome.x - home.x); A.rally = { x: home.x + Math.cos(ang) * 9 * CELL, y: home.y + Math.sin(ang) * 9 * CELL };
    /* wave size scales with difficulty and wave number; the rest of the army stays home as a garrison */
    const want = value >= threshold * 2.5 ? threshold * 1.6 : threshold; const sorted = army.filter(u => !(D.harass && R.raid.includes(u.def.id))).sort((a, b) => dist(a, A.rally) - dist(b, A.rally)); const sq = []; let acc = 0; for (const u of sorted) { if (acc >= want) break; sq.push(u); acc += u.def.cost; }
    A.squad = new Set(sq); orderGroup(sq, A.rally.x, A.rally.y, 'move');
  }
  if (A.state === 'gather') { const sq = [...A.squad].filter(e => !e.dead); const near = sq.filter(e => dist(e, A.rally) < 7 * CELL).length; if (near >= sq.length * 0.8 || G.t - A.gatherT > 25) { A.state = 'attack'; A.attackStart = G.t; A.attackValue0 = sq.reduce((s, e) => s + e.def.cost, 0); A.wave++; A.stats.waves.push([Math.round(G.t), Math.round(A.attackValue0)]); A.target = pickTarget(p, A, ehome, sq); orderGroup(sq, A.target.x, A.target.y, 'attackmove'); announce('Enemy forces are on the move', 'warn'); } }
  if (A.state === 'attack') {
    const sq = [...A.squad].filter(e => !e.dead); const v = sq.reduce((s, e) => s + e.def.cost, 0);
    if (!sq.length) { A.state = 'build'; }
    else if (D.retreat && v < A.attackValue0 * 0.35 && G.t - A.attackStart > 20) { A.state = 'build'; A.stats.retreats++; orderGroup(sq, home.x + 100, home.y + 100, 'move'); A.squad = new Set(); }
    else { if (!A.target || A.target.dead) { A.target = pickTarget(p, A, ehome, sq); if (A.target) orderGroup(sq, A.target.x, A.target.y, 'attackmove'); } for (const e of sq) if (!e.order && !e.target && A.target && !A.target.dead) order(e, { type: 'attackmove', x: A.target.x + rnd(-40, 40), y: A.target.y + rnd(-40, 40) }); if (G.t - A.attackStart > 240 && !D.retreat) { A.state = 'build'; A.squad = new Set(); } }
  }
  // ─ micro: abilities, retreat damaged, focus fire
  if (D.abilities) for (const e of army) { if (!e.target || !e.def.secondary) continue; const ab = ABILITIES[e.def.id]; if (ab && ab.kind === 'self' && (e.abilityCd || 0) <= G.t && /Smoke|Spin Up|Overclock|Overdrive|Hold the Line|Null Burst|Hard Reboot|Refract|Resonance|Thermobaric|Saturation|Launch All/.test(e.def.secondary.name)) { if (e.def.id === 'hlx_mogul' && e.shield > 50) continue; if (useAbility(e)) A.stats.abilities++; } }
  if (D.micro) { const dep = mine.find(e => isStruct(e.def) && /Repair|Reclaimer|Black Market|Vehicle production/.test(e.def.role)); for (const e of army) { if (e.def.cls !== 'vehicle' || !dep) continue; if (e.hp < e.def.hp * 0.3 && !e.retreating && !G.ents.some(o => !o.dead && foes.includes(o.owner) && !isStruct(o.def) && dist(o, e) < 3 * CELL)) { e.retreating = true; A.squad.delete(e); A.stats.micro++; order(e, { type: 'move', x: dep.x, y: dep.y + 70 }); } if (e.retreating && e.hp > e.def.hp * 0.9) { e.retreating = false; } }
    for (const e of army) { if (!e.target || e.retreating) continue; const weak = G.ents.filter(o => !o.dead && foes.includes(o.owner) && !isStruct(o.def) && o.hp < o.def.hp * 0.4 && dist(o, e) < 6 * CELL && (e.def.weapons || []).some(w => canHit(w, e.def, o.def)))[0]; if (weak) e.target = weak; } }
  // ─ superweapons & doctrines handled in depth.js (AI branches) with difficulty gates
  p.useSuper = D.super; p.useDoctrine = D.doctrine;
}
function pickTarget(p, A, ehome, sq) { const c = sq.length ? { x: sq.reduce((s, e) => s + e.x, 0) / sq.length, y: sq.reduce((s, e) => s + e.y, 0) / sq.length } : ehome; const known = [...A.memStructs].filter(s => !s.dead); const pool = known.length ? known : (ehome ? [ehome] : []); if (!pool.length) return null; const pref = pool.filter(s => /Refinery|Power|Construction/.test(s.def.role)); const list = (pref.length && Math.random() < 0.6) ? pref : pool; return list.reduce((b, s) => (!b || dist(s, c) < dist(b, c)) ? s : b, null); }
