#!/usr/bin/env node
// Thunderhead balance stress-test. Runs every buildable combat object against every enemy object,
// cost-for-cost, in a 1-D approach-and-fire duel, then checks counters, mirrors, tech tree, power, economy.
const RULES = require('../data/rules.js');
const ALL = [].concat(require('../data/lattice.js'), require('../data/compact.js'), require('../data/helix.js'));
const BY = Object.fromEntries(ALL.map(u => [u.id, u]));
const AT = Object.fromEntries(RULES.armourTypes.map((a, i) => [a, i]));
const DT = 0.1, MAXT = 150, BUDGET = 3000, START_DIST = 14;

const isAir = u => u.cls === 'aircraft';
const isNaval = u => u.cls === 'naval';
const isGround = u => !isAir(u);
const isInfClass = u => u.cls === 'infantry' || u.cls === 'drone';
const isStruct = u => u.cls === 'structure' || u.cls === 'defence';
const combat = u => (u.weapons || []).some(w => w.dmg > 0 || w.wh === 'HACK' || w.spawns);
const hasTag = (u, t) => (u.tags || []).includes(t);
const hackable = t => !isInfClass(t) && !hasTag(t, 'nohack') && !hasTag(t, 'hero') && !hasTag(t, 'mcv') && !(hasTag(t, 'harvester') && t.faction === 'lattice');

function canHit(w, a, t) {
  if (w.dmg <= 0 && !w.spawns && w.wh !== 'HACK') return false;
  if (isAir(t) && !w.aa) return false;
  if (!isAir(t) && !(w.ag || w.naval || w.antiSub)) return false;
  if (w.naval && !isNaval(t)) return false;
  if (t.submerged && !(w.antiSub || w.naval)) return false; // only torpedoes / depth charges reach submerged hulls
  if (w.antiSub && !t.submerged) return false; // depth charges only hit submerged hulls
  if (isNaval(t) && !isNaval(a) && !isAir(a) && !w.naval && !(a.amphibious)) { /* land units can shoot ships in range */ }
  if (w.vsInfantryOnly && !isInfClass(t)) return false;
  if (w.vsVehicleOnly && isInfClass(t)) return false;
  if (w.vsStructureOnly && !isStruct(t)) return false;
  if (w.wh === 'HACK' && !hackable(t)) return false;
  if (w.wh === 'EMP' && isInfClass(t) && !hasTag(t, 'machine')) return false;
  if (w.wh === 'TOXIN' && hasTag(t, 'machine') && !isInfClass(t)) return false;
  return true;
}
function verse(w, t) {
  if (w.wh === 'EMP' && hasTag(t, 'machine') && isInfClass(t)) return 1.0;
  if (isAir(t) && RULES.aircraftModifier[w.wh] && RULES.aircraftModifier[w.wh][t.armour] != null) return RULES.aircraftModifier[w.wh][t.armour];
  return RULES.warheads[w.wh][AT[t.armour]];
}
function pairCounts(cA, cB, budget) { // counts whose total spend is as equal as possible, near the budget
  let best = null;
  for (let nA = 1; nA <= 40; nA++) { const sA = nA * cA; if (sA < budget * 0.6 || sA > budget * 2.2) continue;
    for (let nB = 1; nB <= 40; nB++) { const sB = nB * cB; if (sB < budget * 0.6 || sB > budget * 2.2) continue;
      const diff = Math.abs(sA - sB) / Math.max(sA, sB) + Math.abs(sA + sB - 2 * budget) / (20 * budget);
      if (!best || diff < best.diff) best = { nA, nB, diff }; } }
  return best || { nA: Math.max(1, Math.round(budget / cA)), nB: Math.max(1, Math.round(budget / cB)) };
}

function mk(type, team, x, i) {
  return { type, team, x, hp: type.hp, shield: type.shield ? type.shield.hp : 0, cds: (type.weapons || []).map(() => 0.5 * (i % 3) * 0.1),
    ammo: type.ammo || Infinity, away: 0, disabled: 0, cloaked: !!(type.cloak || type.cloakIdle), hackedUntil: 0, origTeam: team, controlling: 0, spawned: 0,
    deployT: (type.secondary && type.secondary.kind === 'deploy' && type.weapons && type.weapons.some(w => w.minRange)) ? 6 : 0, lastHit: 0, vet: 1,
    deployed: !!(type.secondary && type.secondary.kind === 'deploy' && type.secondary.bonus), rebootReady: !!(type.secondary && type.secondary.effect === 'shieldReset') };
}

function duel(A, B, budget = BUDGET, opts = {}) {
  const pc = pairCounts(Math.max(A.cost, 1), Math.max(B.cost, 1), budget);
  const nA = opts.nA || pc.nA;
  const nB = opts.nB || (opts.nA ? Math.max(1, Math.round(budget / Math.max(B.cost, 1))) : pc.nB);
  const units = [];
  // formation: ranks of 8 abreast (same x), 0.5 cells between ranks — a blob, not a conga line
  for (let i = 0; i < nA; i++) units.push(mk(A, 0, -Math.floor(i / 8) * 0.5 - (i % 8) * 0.01, i));
  for (let i = 0; i < nB; i++) units.push(mk(B, 1, START_DIST + Math.floor(i / 8) * 0.5 + (i % 8) * 0.01, i));
  if (isStruct(A)) units.filter(u => u.team === 0).forEach((u, i) => u.x = -i * 1.5);
  if (isStruct(B)) units.filter(u => u.team === 1).forEach((u, i) => u.x = START_DIST + i * 1.5);
  let t = 0;
  const alive = team => units.filter(u => u.hp > 0 && u.team === team);
  const present = team => alive(team).filter(u => u.away <= 0);
  const value = team => units.filter(u => u.hp > 0 && u.origTeam === team && u.team === team).reduce((s, u) => s + (u.type.cost || 0) * (u.hp / u.type.hp), 0);
  const startVal = [nA * A.cost, nB * B.cost];
  while (t < MAXT) {
    const a0 = alive(0), a1 = alive(1);
    if (!a0.length || !a1.length) break;
    // anyone able to hurt anyone? else stop
    for (const u of units) {
      if (u.hp <= 0) continue;
      if (u.away > 0) { u.away -= DT; if (u.away <= 0) { u.ammo = u.type.ammo; u.x = u.team === 0 ? -2 : START_DIST + 2; } continue; }
      if (u.exitT > 0) { u.exitT -= DT; if (u.exitT <= 0) u.away = (u.type.rearmSeconds || 10) + 2 * START_DIST / u.type.speed; continue; }
      if (u.hackedUntil && t > u.hackedUntil) { u.team = u.origTeam; u.hackedUntil = 0; }
      if (u.disabled > 0) { u.disabled -= DT; continue; }
      const ty = u.type; const dep = ty.secondary && ty.secondary.kind === 'deploy' && ty.secondary.bonus;
      // cloak: 'cloak' units are hidden until they fire (3 s reveal); 'cloakIdle' units are hidden only while stationary
      if (ty.cloak || ty.cloakIdle) { u.cloaked = (t - (u.lastFire || -99) > 3) && (!ty.cloakIdle || !u.movedThisTick); }
      u.movedThisTick = false;
      const allEnemies = units.filter(e => e.hp > 0 && e.team !== u.team && e.away <= 0);
      const enemies = allEnemies.filter(e => !(e.cloaked && !u.type.detector));
      if (!allEnemies.length) continue;
      if (!enemies.length) { // nothing visible: advance toward the enemy side (unless an ambusher: hold)
        if (!isStruct(ty) && ty.speed > 0 && !ty.cloakIdle) { const nx = allEnemies.reduce((b, e) => (!b || Math.abs(e.x - u.x) < Math.abs(b.x - u.x)) ? e : b, null).x; u.x += Math.sign(nx - u.x) * ty.speed * DT; u.movedThisTick = true; }
        continue; }
      // shield regen
      if (ty.shield && t - u.lastHit > ty.shield.regenDelay) u.shield = Math.min(ty.shield.hp, u.shield + ty.shield.regenPerSec * DT);
      // spawners
      (ty.weapons || []).forEach((w, wi) => {
        if (!w.spawns) return;
        u.cds[wi] -= DT;
        const mine = units.filter(s => s.hp > 0 && s.parent === u);
        if (u.cds[wi] <= 0 && mine.length < w.spawnMax) { const s = mk(BY[w.spawns], u.team, u.x, 0); s.parent = u; s.type = Object.assign({}, s.type, { cost: 0 }); units.push(s); u.cds[wi] = w.rof; }
      });
      const ws = (ty.weapons || []).map((w, wi) => ({ w, wi })).filter(o => !o.w.spawns && enemies.some(e => canHit(o.w, ty, e.type)));
      // sticky targeting: keep the current target while it is alive, present and still hittable; otherwise pick nearest
      let target = (u.target && u.target.hp > 0 && u.target.team !== u.team && u.target.away <= 0 && !(u.target.cloaked && !u.type.detector) && ws.some(o => canHit(o.w, ty, u.target.type))) ? u.target : null;
      if (!target) target = enemies.reduce((b, e) => (!b || Math.abs(e.x - u.x) < Math.abs(b.x - u.x)) ? e : b, null);
      u.target = target;
      const dist = Math.abs(target.x - u.x);
      const closing = u.prevDist != null && dist < u.prevDist - 1e-6; u.prevDist = dist;
      u.notClosingT = closing ? 0 : (u.notClosingT || 0) + DT;
      const usable = ws.filter(o => canHit(o.w, ty, target.type));
      const maxRange = (usable.length ? Math.max(...usable.map(o => o.w.range)) : 0) + (u.deployed && dep ? (dep.range || 0) : 0);
      const minRange = usable.length ? Math.max(...usable.map(o => o.w.minRange || 0)) : 0;
      // move
      if (!isStruct(ty) && (ty.speed || 0) > 0) {
        const wantCrush = ty.cls === 'vehicle' && !ty.hover && (ty.armour === 'medium' || ty.armour === 'heavy') && isInfClass(target.type) && !target.type.hover && !target.deployed && usable.every(o => verse(o.w, target.type) < 0.5);
        if (u.deployed && dep && dist > maxRange) { if (u.notClosingT < 1) continue; u.deployed = false; u.deployT = dep.time; } // hold while they come; undeploy to chase only if they stopped closing
        if (ty.cloakIdle && dist > maxRange && u.notClosingT < 1.5) continue; // ambusher: hold position while the enemy approaches
        if (dist > maxRange || !usable.length || (wantCrush && dist > 1.0)) { u.movedThisTick = true; u.x += Math.sign(target.x - u.x) * ty.speed * DT; u.deployT = (ty.secondary && ty.secondary.kind === 'deploy' && minRange) ? 6 : u.deployT; if (!(wantCrush && dist <= maxRange)) continue; }
        if (dist < minRange) { u.x -= Math.sign(target.x - u.x) * ty.speed * DT; continue; }
      }
      // generic deploy (RA2 GI / GGI): once an enemy is in range, deploy for dep.time seconds, then bonuses apply
      if (dep && !u.deployed) { u.deployT = u.deployT || dep.time; u.deployT -= DT; if (u.deployT <= 0) u.deployed = true; else continue; }
      if (u.deployT > 0) { u.deployT -= DT; continue; }
      // crush: tracked medium/heavy vehicles adjacent to infantry-class targets crush one every 3 s
      if (ty.cls === 'vehicle' && !ty.hover && (ty.armour === 'medium' || ty.armour === 'heavy') && isInfClass(target.type) && !target.type.hover && !target.deployed && dist <= 1.0) {
        u.crushCd = (u.crushCd || 0) - DT; if (u.crushCd <= 0) { target.hp = 0; u.crushCd = 3.0; }
      }
      // fire
      for (const { w, wi } of usable) {
        u.cds[wi] -= DT;
        if (u.cds[wi] > 0 || dist > w.range + (u.deployed && dep ? (dep.range || 0) : 0)) continue;
        if (u.ammo <= 0) continue;
        let shots = 0; while (u.cds[wi] <= 0) { shots++; u.cds[wi] += w.rof; } // fast weapons may fire several times per tick
        u.cloaked = false; u.lastFire = t;
        if (w.usesAmmo) { u.ammo -= 1; if (u.ammo <= 0) u.exitT = 1.0; }
        const burst = w.burst || 1;
        const linkBonus = (ty.id === 'lat_phalanx') ? 1 + Math.min(0.25, 0.05 * (present(u.team).filter(o => o.type.id === 'lat_phalanx' && Math.abs(o.x - u.x) <= 3).length - 1)) : 1;
        const hitList = [target];
        if (w.splash) { const cap = Math.max(1, Math.round(Math.PI * w.splash * w.splash)); // victims limited by area (≈1 unit per cell²)
          units.filter(e => e.hp > 0 && e.team !== u.team && e !== target && Math.abs(e.x - target.x) <= w.splash && canHit(w, ty, e.type)).slice(0, cap).forEach(e => hitList.push(e)); }
        if (w.chain) { const o = enemies.filter(e => e !== target && canHit(w, ty, e.type) && Math.abs(e.x - target.x) <= 2)[0]; if (o) hitList.push(o); }
        if (w.lineSplash) units.filter(e => e.hp > 0 && e.team !== u.team && e !== target && Math.abs(e.x - target.x) <= w.lineSplash.length && canHit(w, ty, e.type)).slice(0, 3).forEach(e => hitList.push(e));
        hitList.forEach((e, k) => {
          const f = k === 0 ? 1 : (w.chain ? w.chain.falloff : 0.4);
          if (w.wh === 'HACK') {
            const n = units.filter(h => h.hackedBy === u && h.hp > 0 && h.team === u.team).length;
            if (n >= (w.maxControlled || 1)) return;
            e.team = u.team; e.hackedBy = u; e.hackedUntil = w.hackSeconds >= 9999 ? 0 : t + w.hackSeconds; if (w.hackSeconds >= 9999) e.origTeam = u.team; return;
          }
          if (w.wh === 'EMP') { const sec = w.dmg * verse(w, e.type) * RULES.emp.disableSecondsPerPoint * (hasTag(e.type, 'machine') ? RULES.emp.latticeExtraFactor : 1); e.disabled = Math.max(e.disabled, sec * f); return; }
          let dmg = w.dmg * burst * shots * verse(w, e.type) * f * linkBonus * u.vet * (u.deployed && dep ? (dep.dmg || 1) : 1);
          if (w.vsMovingFactor && !isStruct(e.type)) dmg *= w.vsMovingFactor;
          if (e.deployed && e.type.secondary && e.type.secondary.bonus) dmg *= (e.type.secondary.bonus.taken || 1);
          if (w.vsInfantryOnly && hasTag(e.type, 'machine')) dmg *= 0.25;
          if (e.type.secondary && e.type.secondary.kind === 'toggle' && e.type.secondary.bonus && e.type.secondary.bonus.takenSA && w.wh === 'SA') dmg *= e.type.secondary.bonus.takenSA;
          e.lastHit = t;
          if (e.shield > 0) { const s = Math.min(e.shield, dmg); e.shield -= s; dmg -= s; if (e.shield <= 0 && e.rebootReady) { e.rebootReady = false; e.shield = e.type.shield.hp; } }
          e.hp -= dmg;
          if (e.hp <= 0 && w.wh !== 'HACK' && e.type.cost) { /* bounty etc. ignored */ }
        });
        if (w.suicide) u.hp = 0;

      }
    }
    t += DT;
  }
  const vA = value(0), vB = value(1);
  const fA = vA / startVal[0], fB = vB / startVal[1];
  const a0 = alive(0).length, a1 = alive(1).length;
  let win;
  if (a0 && !a1) win = 0; else if (a1 && !a0) win = 1; else win = fA > fB + 0.05 ? 0 : fB > fA + 0.05 ? 1 : -1;
  return { win, fA, fB, t, nA, nB };
}

function targetable(A, B) { return (A.weapons || []).some(w => canHit(w, A, B)); }
function sameDomain(A, B) { // can these two ever meet on a map?
  if (isAir(A) || isAir(B)) return true;
  if (isNaval(A) !== isNaval(B)) { const land = isNaval(A) ? B : A; return isStruct(land) || land.amphibious; }
  return true;
}

// ───────── CHECKS ─────────
const out = [];
const log = s => { out.push(s); };
const units = ALL.filter(u => !u.hidden);
const fighters = units.filter(u => combat(u) && !isStruct(u) && !hasTag(u, 'spawned'));
const defences = units.filter(u => u.cls === 'defence');
const targetsAll = units.filter(u => !hasTag(u, 'spawned'));

// 1. Dominance matrix
log('# 1. DOMINANCE (win rate vs all enemy objects it can engage, cost-for-cost $3000)');
const dom = {};
const results = {};
for (const a of fighters.concat(defences)) {
  let w = 0, n = 0, rows = [];
  for (const b of targetsAll) {
    if (b.faction === a.faction) continue;
    if (!sameDomain(a, b)) continue;
    if (!(targetable(a, b) && targetable(b, a))) continue; // mutual engagements only; one-way matchups are listed under FREE
    const r = duel(a, b); results[a.id + '|' + b.id] = r;
    if (r.win === 0) w++; n++;
    rows.push([b.id, r.win === 0 ? 'W' : r.win === 1 ? 'L' : 'D']);
  }
  dom[a.id] = { w, n, rate: n ? w / n : 0, rows };
}
const flagged = [];
for (const [id, d] of Object.entries(dom)) {
  const u = BY[id];
  const special = hasTag(u, 'suicide') || hasTag(u, 'hero') || hasTag(u, 'dog') || hasTag(u, 'spy') || hasTag(u, 'scout') || u.cls === 'defence' || u.cls === 'aircraft' || u.cls === 'naval' || (u.weapons || []).every(w => w.wh === 'HACK' || w.wh === 'EMP' || w.spawns) || (u.weapons || []).every(w => !w.ag);
  const tag = d.rate > 0.85 ? 'DOMINANT' : d.rate < 0.15 ? 'USELESS' : '';
  if (tag) flagged.push(`${tag} ${id} ${(d.rate * 100).toFixed(0)}% (${d.w}/${d.n})${special ? ' [specialist]' : ''}`);
  log(`${id.padEnd(18)} ${(d.rate * 100).toFixed(0).padStart(3)}%  ${d.w}/${d.n} ${tag}`);
}
log('\nFLAGS:\n' + (flagged.join('\n') || 'none'));

// 2. Declared counters
log('\n# 2. DECLARED COUNTERS (data: counters.beats / losesTo)');
let cFail = 0, cTotal = 0;
for (const a of units) {
  if (!a.counters) continue;
  const heroOpts = hasTag(a, 'hero') ? { nA: 1 } : {};
  const heroBudget = hasTag(a, 'hero') ? 800 : BUDGET;
  for (const b of a.counters.beats || []) {
    const t = BY[b]; if (!t) { log(`  !! ${a.id} beats unknown ${b}`); continue; }
    cTotal++; const r = duel(a, t, heroBudget, heroOpts); if (r.win !== 0) { cFail++; log(`  FAIL ${a.id} should beat ${b}: win=${r.win} fA=${r.fA.toFixed(2)} fB=${r.fB.toFixed(2)} (${r.nA}v${r.nB}, ${r.t.toFixed(0)}s)`); }
  }
  for (const b of a.counters.losesTo || []) {
    const t = BY[b]; if (!t) { log(`  !! ${a.id} losesTo unknown ${b}`); continue; }
    cTotal++; const r = duel(a, t, hasTag(a, 'hero') ? 2000 : BUDGET, heroOpts); if (r.win !== 1) { cFail++; log(`  FAIL ${a.id} should lose to ${b}: win=${r.win} fA=${r.fA.toFixed(2)} fB=${r.fB.toFixed(2)} (${r.nA}v${r.nB}, ${r.t.toFixed(0)}s)`); }
  }
}
log(`Counters: ${cTotal - cFail}/${cTotal} pass`);

// 3. Mirrors (same role across factions should be 35–65%)
log('\n# 3. MIRRORS');
const mirrors = { MBT: ['lat_phalanx', 'cmp_bastion', 'hlx_arbiter'], basicInf: ['lat_scuttler', 'cmp_rifleman', 'hlx_contractor'], heavy: ['lat_colossus', 'cmp_behemoth', 'hlx_mogul'],
  antiInf: ['lat_lamplighter', 'cmp_grenadier'], destroyer: ['lat_trident', 'hlx_warden'], escort: ['cmp_corvette', 'hlx_razor'], sub: ['lat_barracuda', 'cmp_pike'], scout: ['lat_wasp', 'cmp_scoutcar', 'hlx_interceptor'], gunship: ['cmp_kondor', 'hlx_dragonfly'], fighter: ['lat_raptor', 'cmp_falcon'] };
for (const [role, ids] of Object.entries(mirrors)) {
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = BY[ids[i]], b = BY[ids[j]];
    if (!targetable(a, b) || !targetable(b, a)) continue;
    const r1 = duel(a, b);
    const margin = Math.abs(r1.fA - r1.fB); // winner's remaining value fraction; <=0.40 counts as a close fight
    const bad = margin > 0.40;
    log(`  ${role.padEnd(13)} ${a.id} vs ${b.id}: winner ${r1.win === 0 ? a.id : r1.win === 1 ? b.id : 'draw'} by ${(margin * 100).toFixed(0)}% of value ${bad ? '<-- UNBALANCED' : ''}`);
  }
}

// 4. Tech tree
log('\n# 4. TECH TREE');
let techFail = 0;
for (const u of units) {
  for (const p of u.prereq || []) {
    const q = BY[p];
    if (!q) { techFail++; log(`  MISSING prereq ${p} for ${u.id}`); continue; }
    if (q.faction !== u.faction) { techFail++; log(`  CROSS-FACTION prereq ${p} for ${u.id}`); }
    if (q.tier > u.tier) { techFail++; log(`  TIER ORDER ${u.id} (t${u.tier}) requires ${p} (t${q.tier})`); }
  }
}
// reachability from conyard
for (const f of ['lattice', 'compact', 'helix']) {
  const have = new Set(units.filter(u => u.faction === f && !u.prereq.length).map(u => u.id));
  let grew = true; while (grew) { grew = false; for (const u of units.filter(u => u.faction === f)) if (!have.has(u.id) && u.prereq.every(p => have.has(p))) { have.add(u.id); grew = true; } }
  const un = units.filter(u => u.faction === f && !have.has(u.id));
  if (un.length) { techFail++; log(`  UNREACHABLE in ${f}: ${un.map(u => u.id).join(', ')}`); }
  const counts = { structure: 0, defence: 0, infantry: 0, drone: 0, vehicle: 0, aircraft: 0, naval: 0 };
  units.filter(u => u.faction === f).forEach(u => counts[u.cls]++);
  log(`  ${f}: ${JSON.stringify(counts)}`);
}
log(`Tech: ${techFail ? techFail + ' problems' : 'OK'}`);

// 5. Power budget per faction (full base, one of each non-wall structure + 2 of each defence)
log('\n# 5. POWER BUDGET');
for (const f of ['lattice', 'compact', 'helix']) {
  const S = units.filter(u => u.faction === f && (u.cls === 'structure' || u.cls === 'defence'));
  const plant = S.find(u => u.power > 0);
  const drain = S.filter(u => u.power < 0).reduce((s, u) => s + (-u.power) * (u.cls === 'defence' ? 2 : 1), 0);
  log(`  ${f}: full base drains ${drain}; ${plant.name} gives ${plant.power} ($${plant.cost}) -> ${Math.ceil(drain / plant.power)} plants ($${Math.ceil(drain / plant.power) * plant.cost}), $/power ${(plant.cost / plant.power).toFixed(2)}`);
}

// 6. Economy timeline: standard opening to T2 and T3
log('\n# 6. ECONOMY / TECH TIMING (standard opening, 1 harvester per refinery, trip 40 s = $500)');
const opening = {
  lattice: ['lat_reactor', 'lat_extractor', 'lat_fabbay', 'lat_assembly', 'lat_reactor', 'lat_extractor', 'lat_uplink', 'lat_reactor', 'lat_logic'],
  compact: ['cmp_reactor', 'cmp_refinery', 'cmp_barracks', 'cmp_armour', 'cmp_reactor', 'cmp_refinery', 'cmp_radar', 'cmp_reactor', 'cmp_research'],
  helix: ['hlx_solar', 'hlx_refinery', 'hlx_office', 'hlx_plant', 'hlx_solar', 'hlx_refinery', 'hlx_surveil', 'hlx_solar', 'hlx_campus'],
};
for (const [f, order] of Object.entries(opening)) {
  let credits = RULES.economy.startingCredits, t = 0, harv = 0, power = 0, drain = 0, line = [];
  for (const id of order) {
    const s = BY[id];
    const bt = s.cost / 100 * RULES.economy.buildTimeSecondsPer100Credits * (power < drain ? 2 : 1);
    // accrue income during build
    let needWait = 0; if (credits < s.cost) needWait = (s.cost - credits) / Math.max(1e-6, harv * 500 / 40);
    t += needWait + bt; credits += (needWait + bt) * harv * 500 / 40; credits -= s.cost;
    if (s.power > 0) power += s.power; else drain += -s.power;
    if (/extractor|refinery/.test(id)) harv++;
    line.push(`${s.name}@${t.toFixed(0)}s`);
  }
  log(`  ${f}: T3 tech online at ${t.toFixed(0)}s, credits left $${credits.toFixed(0)}, power ${power}/${drain}. ${line.join(' > ')}`);
}

// 7. TTK sanity: a $3000 MBT force vs a refinery
log('\n# 7. TTK: $3000 of MBTs vs enemy refinery / conyard');
for (const [mbt, ref, cy] of [['lat_phalanx', 'cmp_refinery', 'cmp_hq'], ['cmp_bastion', 'hlx_refinery', 'hlx_tower'], ['hlx_arbiter', 'lat_extractor', 'lat_nexus']]) {
  const r = duel(BY[mbt], BY[ref]), r2 = duel(BY[mbt], BY[cy]);
  log(`  ${mbt} x${r.nA} kills ${ref} in ${r.t.toFixed(0)}s; ${cy} in ${r2.t.toFixed(0)}s`);
}

// 8. Hero sanity
log('\n# 8. HEROES: one hero vs $800 of basic infantry (must win) and vs $2000 of MBTs (must lose)');
for (const [h, inf, mbt] of [['lat_aria', 'cmp_rifleman', 'cmp_bastion'], ['cmp_ironside', 'hlx_contractor', 'hlx_shade'], ['hlx_vesper', 'lat_scuttler', 'lat_phalanx']]) {
  const r1 = duel(BY[h], BY[inf], 800, { nA: 1 }), r2 = duel(BY[h], BY[mbt], 2000, { nA: 1 });
  log(`  ${h}: vs ${r1.nB} ${inf} -> ${r1.win === 0 ? 'WIN' : 'LOSS'} (${r1.fA.toFixed(2)} hp left); vs ${r2.nB} ${mbt} -> ${r2.win === 0 ? 'WIN' : 'LOSS'} (${r2.fB.toFixed(2)} enemy left)`);
}

// 9. DPS/cost table by tier (vs preferred armour)
log('\n# 9. COST EFFICIENCY vs preferred armour (DPS per $100)');
for (const u of fighters) {
  const best = (u.weapons || []).filter(w => w.dmg > 0 && !w.spawns && w.wh !== 'HACK' && w.wh !== 'EMP' && !w.suicide).map(w => {
    const arm = RULES.armourTypes.reduce((b, a) => RULES.warheads[w.wh][AT[a]] > RULES.warheads[w.wh][AT[b]] ? a : b, 'none');
    return { w, arm, dps: w.dmg * (w.burst || 1) * RULES.warheads[w.wh][AT[arm]] / w.rof };
  }).sort((a, b) => b.dps - a.dps)[0];
  if (!best) continue;
  log(`  ${u.id.padEnd(18)} t${u.tier} $${String(u.cost).padEnd(5)} hp${String(u.hp).padEnd(5)} ${best.w.wh.padEnd(6)} vs ${best.arm.padEnd(8)} dps ${best.dps.toFixed(1).padStart(6)}  dps/$100 ${(best.dps / u.cost * 100).toFixed(2).padStart(5)}  hp/$100 ${(u.hp / u.cost * 100).toFixed(1).padStart(5)}`);
}

const txt = out.join('\n');
require('fs').writeFileSync(__dirname + '/report.txt', txt);
console.log(txt);
