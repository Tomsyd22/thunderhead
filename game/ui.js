/* Thunderhead UI + main loop. Globals in: SIM, RENDER, AUDIO, VOICE. */
(() => {
'use strict';
const { G, CELL, MAPW, MAPH, DT, ALL, BY, FACTIONS, FOOT, buildable, isAir, isInf, isStruct, hasTag, idx, visibleTo, canSee, tabOf } = SIM;
const S = RENDER.S; const $ = s => document.querySelector(s);
const TABS = [['structure', 'Build'], ['defence', 'Def'], ['infantry', 'Inf'], ['vehicle', 'Veh'], ['aircraft', 'Air'], ['naval', 'Sea']];
const UI = { me: null, tab: 'structure', mode: null, groups: {}, selectMode: false, started: false, phone: false, lastG: null, hover: { x: 0, y: 0 } };
const hpCss = f => f > 0.5 ? '#52d273' : f > 0.25 ? '#f2c744' : '#ef4b4b';
function abbrev(n) { return n.split(' ').map(s => s[0]).join('').slice(0, 2); }

// ───────── game lifecycle ─────────
function startGame(cfg) {
  if (RENDER.AT && RENDER.AT.promise && !RENDER.AT.ready) { RENDER.AT.promise.then(() => startGame(cfg)); return; }
  if (typeof cfg === 'string') cfg = { players: [{ faction: cfg, ai: false }, { faction: arguments[2], ai: true, difficulty: arguments[1] }], map: 'riverlands' };
  cfg.seed = cfg.seed == null ? 7 + Math.floor(Math.random() * 100000) : cfg.seed; UI.cfg = cfg; UI.editor = false; $('#editor').hidden = true;
  AUDIO.start(); const me = SIM.newGame(cfg); UI.me = me; S.me = me; S.sel = []; S.placing = null; UI.groups = {}; UI.started = true; const faction = me.faction;
  document.documentElement.style.setProperty('--player', me.css);
  RENDER.bakeTerrain(); RENDER.updateFog(); S.cam.zoom = UI.phone ? 0.8 : Math.min(1.4, Math.max(0.9, S.app.screen.width / 1200)); const cy = G.ents.find(e => e.owner === me && isStruct(e.def)); RENDER.centerOn(cy.x + 60, cy.y + 60);
  $('#start').hidden = true; $('#end').hidden = true; delete $('#end').dataset.shown; $('#hud').hidden = false; buildSidebar();
  const first = ALL.find(d => d.faction === faction && d.cls === 'structure' && d.power > 0); const allies = G.players.filter(p => p !== me && p.team === me.team).map(p => p.name); msg(`${G.mapName}. Build a ${first.name}, then a refinery.` + (allies.length ? ` Allied with ${allies.join(', ')}.` : ''), 'good'); AUDIO.announce('Battle control online', faction);
  S.sel = [G.ents.find(e => e.owner === me && hasTag(e.def, 'harvester'))].filter(Boolean);
}
// ───────── start screen: maps and slots ─────────
const THEME_COLS = { grass: { 0: '#3b5a2c', 1: '#4a423c', 2: '#2a5024', 3: '#234f7a', 4: '#5a4634', 5: '#5a4838', 6: '#55554f', 7: '#7f7652' }, desert: { 0: '#b89a62', 1: '#6e5a44', 2: '#8a8a4e', 3: '#2b6a8a', 4: '#5a4634', 5: '#7a5a3c', 6: '#8a7f6a', 7: '#d4c08a' }, urban: { 0: '#4a5a40', 1: '#4a4a4a', 2: '#3a5a34', 3: '#234f7a', 4: '#5a4634', 5: '#5a4838', 6: '#6a6a66', 7: '#8a8a70' } };
function mapThumb(canvas, terrain, theme, starts, civ) { const ctx = canvas.getContext('2d'); canvas.width = MAPW; canvas.height = MAPH; const cols = THEME_COLS[theme] || THEME_COLS.grass; const img = ctx.createImageData(MAPW, MAPH); for (let i = 0; i < MAPW * MAPH; i++) { const c = cols[terrain[i]] || '#000'; img.data[i * 4] = parseInt(c.slice(1, 3), 16); img.data[i * 4 + 1] = parseInt(c.slice(3, 5), 16); img.data[i * 4 + 2] = parseInt(c.slice(5, 7), 16); img.data[i * 4 + 3] = 255; } ctx.putImageData(img, 0, 0); for (const [id, x, y] of civ || []) { ctx.fillStyle = id === 'civ_derrick' ? '#ffd86b' : '#9a9a8a'; ctx.fillRect(x, y, 2, 2); } (starts || []).forEach((st, i) => { ctx.fillStyle = '#' + SIM.SLOT_COLORS[i].toString(16).padStart(6, '0'); ctx.beginPath(); ctx.arc(st.x + 1.5, st.y + 1.5, 2.5, 0, 6.28); ctx.fill(); }); }
function customMaps() { try { return JSON.parse(localStorage.getItem('thunderhead.maps') || '{}'); } catch (e) { return {}; } }
function previewOf(key, data) { const tmp = { terrain: new Uint8Array(MAPW * MAPH), ore: new Float32Array(MAPW * MAPH), oreKind: new Uint8Array(MAPW * MAPH) }; const idx2 = (x, y) => y * MAPW + x, in2 = (x, y) => x >= 0 && y >= 0 && x < MAPW && y < MAPH; const r = data ? SIM.MAPGEN.fromData(tmp, data, MAPW, MAPH, idx2, in2) : SIM.MAPGEN.generate(tmp, 11, MAPW, MAPH, idx2, in2, key); return { terrain: tmp.terrain, res: r }; }
function buildMaps() { const box = $('#maps'); if (!box) return; box.innerHTML = ''; const list = SIM.MAP_PRESETS.map(k => ({ key: k, preset: SIM.MAPGEN.PRESETS[k] })); const custom = customMaps(); for (const name of Object.keys(custom)) list.push({ key: 'custom:' + name, data: custom[name] });
  for (const m of list) { const b = document.createElement('button'); b.dataset.key = m.key; const c = document.createElement('canvas'); b.appendChild(c); const info = m.data ? previewOf(null, m.data) : previewOf(m.key); mapThumb(c, info.terrain, info.res.theme, info.res.starts, info.res.civ); const bb = document.createElement('b'); bb.textContent = m.data ? m.data.name : m.preset.name; const sp = document.createElement('span'); sp.textContent = `${info.res.starts.length} players · ${info.res.theme}` + (m.data ? ' · custom' : ''); b.appendChild(bb); b.appendChild(sp); b.onclick = () => { UI.pickMap = m.key; UI.mapData = m.data || null; for (const o of box.children) o.classList.toggle('on', o === b); $('#mdesc').textContent = m.data ? `Custom map "${m.data.name}" — ${info.res.starts.length} starts.` : m.preset.desc; buildSlots(info.res); }; box.appendChild(b); if (!UI.pickMap && m.key === 'riverlands') b.click(); }
}
function buildSlots(res) { const box = $('#slots'); box.innerHTML = ''; const n = res.starts.length; const team = res.preset === 'crossfire'; UI.slots = UI.slots || []; const facs = Object.keys(FACTIONS);
  for (let i = 1; i < n; i++) { const lab = document.createElement('label'); const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = team ? (i === 1 ? 'Ally' : 'Enemy') : n > 2 ? 'Enemy ' + i : 'Opponent'; const sel = document.createElement('select'); for (const f of facs.concat(['random'])) { const o = document.createElement('option'); o.value = f; o.textContent = f === 'random' ? 'Random' : FACTIONS[f].name; sel.appendChild(o); } sel.value = (UI.slots[i] && UI.slots[i].faction) || (i === 1 ? 'lattice' : facs[i % 3]); sel.onchange = () => { UI.slots[i] = { faction: sel.value }; }; UI.slots[i] = { faction: sel.value }; lab.appendChild(tag); lab.appendChild(sel); box.appendChild(lab); }
}
function gameConfig() { const f = UI.pickF || 'compact'; const diff = $('#diff').value; const key = UI.pickMap || 'riverlands'; const info = UI.mapData ? previewOf(null, UI.mapData) : previewOf(key); const n = info.res.starts.length; const team = info.res.preset === 'crossfire'; const facs = Object.keys(FACTIONS);
  const players = [{ faction: f, ai: false, team: 0 }]; for (let i = 1; i < n; i++) { let pf = (UI.slots[i] && UI.slots[i].faction) || 'random'; if (pf === 'random') pf = facs[Math.floor(Math.random() * facs.length)]; players.push({ faction: pf, ai: true, difficulty: diff, team: team ? (i === 1 ? 0 : 1) : i }); }
  return { players, map: UI.mapData || key, name: info.res.name };
}
function msg(m, kind) { G.msgs.push({ m, t: 5, kind }); if (G.msgs.length > 2) G.msgs.shift(); }

// ───────── sidebar ─────────
function buildSidebar() {
  const tabs = $('#tabs'); tabs.innerHTML = ''; for (const [cls, label] of TABS) { const b = document.createElement('button'); b.textContent = label; b.className = UI.tab === cls ? 'on' : ''; b.dataset.tab = cls; b.onclick = () => { UI.tab = cls; buildSidebar(); AUDIO.sfx('click'); }; tabs.appendChild(b); }
  const grid = $('#grid'); grid.innerHTML = '';
  const items = ALL.filter(d => d.faction === UI.me.faction && buildable(d) && ((UI.tab === 'infantry' && (d.cls === 'infantry' || d.cls === 'drone')) || d.cls === UI.tab)).sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  for (const d of items) {
    const b = document.createElement('button'); b.className = 'item'; b.dataset.id = d.id;
    b.innerHTML = `<span class="ic" style="color:${UI.me.css}">${abbrev(d.name)}</span><span class="nm">${d.name}</span><span class="cost">$${d.cost}</span><span class="prog"></span><span class="cnt"></span><span class="tier">T${d.tier}</span>`;
    b.title = `${d.name} — ${d.role}. ${d.desc || ''}${d.prereq && d.prereq.length ? ' Requires: ' + d.prereq.map(p => BY[p].name).join(', ') : ''}`;
    b.onclick = ev => clickItem(d, ev.shiftKey ? 5 : 1); b.oncontextmenu = ev => { ev.preventDefault(); if (SIM.dequeue(UI.me, d)) { AUDIO.sfx('click'); if (S.placing && S.placing.d === d) S.placing = null; } };
    grid.appendChild(b);
  }
}
function clickItem(d, count) {
  const p = UI.me;
  if (p.ready === d) { enterPlacement(d); return; }
  const btn = document.querySelector(`.item[data-id="${d.id}"]`);
  if (btn && btn.classList.contains('off')) { const missing = (d.prereq || []).filter(q => !G.ents.some(e => !e.dead && e.owner === p && e.def.id === q && !e.building)).map(q => BY[q].name); msg(missing.length ? `${d.name} requires ${missing.join(', ')}` : `${d.name}: no factory available`, 'warn'); AUDIO.sfx('lowpower'); return; }
  if (!SIM.enqueue(p, d, count)) { msg(p.ready ? 'Place the finished structure first' : 'Cannot build that right now', 'warn'); AUDIO.sfx('lowpower'); return; }
  AUDIO.sfx('click');
}
function enterPlacement(d) { const [w, h] = FOOT(d); let cx, cy; if (UI.phone) { const c = RENDER.screenToWorld(S.app.screen.width / 2, S.app.screen.height / 2); cx = Math.floor(c.x / CELL) - Math.floor(w / 2); cy = Math.floor(c.y / CELL) - Math.floor(h / 2); } else { cx = Math.floor(UI.hover.x / CELL) - Math.floor(w / 2); cy = Math.floor(UI.hover.y / CELL) - Math.floor(h / 2); } S.placing = { d, cx, cy }; $('#placebar').hidden = !UI.phone; document.body.classList.remove('drawer-open'); }
function tryPlace() { if (!S.placing) return false; const ok = SIM.place(UI.me, S.placing.d, S.placing.cx, S.placing.cy); if (ok) { AUDIO.sfx('place'); S.placing = null; $('#placebar').hidden = true; return true; } msg('Cannot place there: stay inside the build radius, off rock and off other buildings', 'warn'); AUDIO.sfx('lowpower'); return false; }
function refreshSidebar() {
  const p = UI.me; const g = $('#grid'); if (!g) return;
  for (const b of g.children) { const d = BY[b.dataset.id]; const ok = SIM.canBuild(p, d) && SIM.factoryFor(p, d).length; b.classList.toggle('off', !ok && !(p.ready === d)); const q = (p.queue[tabOf(d)] || []); const first = q[0]; const mine = q.filter(x => x.def === d).length; const pr = b.querySelector('.prog'); if (first && first.def === d) { pr.style.display = 'block'; pr.style.height = ((1 - first.progress) * 100) + '%'; } else pr.style.display = 'none'; b.querySelector('.cnt').textContent = p.ready === d ? 'READY' : mine > 1 ? '×' + mine : (mine === 1 && !(first && first.def === d)) ? '×1' : ''; b.classList.toggle('ready', p.ready === d); b.classList.toggle('busy', !!(first && first.def === d)); }
  $('#credits').textContent = '$' + Math.floor(p.credits).toLocaleString(); const pw = $('#power'); pw.textContent = `⚡ ${p.power - p.drain >= 0 ? '+' : ''}${p.power - p.drain}`; pw.className = p.lowPower ? 'low' : ''; $('#clock').textContent = `${Math.floor(G.t / 60)}:${String(Math.floor(G.t % 60)).padStart(2, '0')}`;
  $('#msgs').innerHTML = G.msgs.map(m => `<div class="${m.kind || ''}">${m.m}</div>`).join('');
  S.sel = S.sel.filter(e => !e.dead && !e.inside && (e.owner === p || e.def.faction === 'civ')); const sp = $('#selpanel');
  if (!S.sel.length) { sp.hidden = true; document.body.classList.remove('has-sel'); } else {
    sp.hidden = false; const e = S.sel[0], d = e.def, n = S.sel.length;
    $('#selname').textContent = n > 1 ? `${n} selected` : d.name; $('#selrole').textContent = n > 1 ? [...new Set(S.sel.map(u => u.def.name))].slice(0, 4).join(', ') : d.role + (e.rank ? ` · ${e.rank === 2 ? 'Elite' : 'Veteran'}` : '') + (e.hackUntil ? ' · hacked' : '');
    $('#selhp').style.width = (e.hp / d.hp * 100) + '%'; $('#selhp').style.background = hpCss(e.hp / d.hp); $('#selhptxt').textContent = `${Math.ceil(e.hp)}/${d.hp} ${d.armour}${isAir(d) && d.ammo ? ` · ammo ${e.ammo}/${d.ammo}` : ''}${e.carry ? ` · ${e.carry} bails` : ''}`;
    const sec = $('#secbtn'); const ab = SIM.abilityFor(e);
    if (d.secondary && !isStruct(d)) { sec.hidden = false; const cd = Math.max(0, (e.abilityCd || 0) - G.t); const onTxt = d.secondary.kind === 'toggle' && !SIM.ABILITIES[d.id] ? (e.toggle ? ' · on' : ' · off') : d.secondary.kind === 'deploy' && !SIM.ABILITIES[d.id] ? (e.deployed ? ' · deployed' : '') : ''; sec.textContent = (cd > 0 ? `${d.secondary.name} (${Math.ceil(cd)}s)` : d.secondary.name) + onTxt; sec.title = d.secondary.desc; sec.disabled = !ab || cd > 0; sec.classList.toggle('on', !!(e.toggle || e.deployed) && d.secondary.kind !== 'active'); } else sec.hidden = true;
    document.body.classList.add('has-sel');
    const civ = d.faction === 'civ'; $('#evacbtn').hidden = !(civ && e.occupants && e.occupants.length && e.owner === p); $('#sellbtn').hidden = !isStruct(d) || civ; $('#repairbtn').hidden = !isStruct(d) || civ; $('#repairbtn').classList.toggle('on', !!e.repairing); $('#stopbtn').hidden = isStruct(d); const salv = G.ents.find(x => !x.dead && x.owner === p && isStruct(x.def) && /[Ss]alvage|Repair/.test(x.def.role) && !x.building); $('#salvbtn').hidden = !(d.cls === 'vehicle' && e.owner === p && salv); $('#salvbtn').title = salv ? `Drive into the ${salv.def.name} for ${hasTag(d, 'harvester') ? '' : ''}50% of cost (hacked units 75%)` : ''; $('#amovebtn').hidden = isStruct(d) || hasTag(d, 'harvester'); $('#amovebtn').classList.toggle('on', UI.mode === 'amove');
    $('#weap').textContent = civ ? (d.desc + (e.occupants && e.occupants.length ? ` Garrisoned by ${e.occupants.map(o => o.def.name).join(', ')}.` : '')) : ((d.weapons || []).filter(w => !w.spawns).map(w => `${w.name} ${w.dmg} ${w.wh} r${w.range}`).join(' · ') || (d.desc || ''));
  }
  powersPanel();
  const gc = $('#groups'); gc.innerHTML = ''; for (const k of Object.keys(UI.groups)) { UI.groups[k] = UI.groups[k].filter(e => !e.dead); if (!UI.groups[k].length) { delete UI.groups[k]; continue; } const b = document.createElement('button'); b.textContent = `${k}·${UI.groups[k].length}`; b.onclick = () => { S.sel = [...UI.groups[k]]; RENDER.centerOn(S.sel[0].x, S.sel[0].y); }; gc.appendChild(b); }
  if (G.over && !$('#end').dataset.shown) { $('#end').dataset.shown = '1'; $('#end').hidden = false; $('#endtitle').textContent = G.over === 'win' ? 'Mission accomplished' : 'Mission failed'; $('#endtxt').textContent = G.over === 'win' ? `The last enemy base is rubble at ${$('#clock').textContent}.` : `Your base fell at ${$('#clock').textContent}. Get a second refinery up early and keep anti-tank near the harvesters.`; AUDIO.announce(G.over === 'win' ? 'Mission accomplished' : 'Mission failed', UI.me.faction); }
}

// ───────── minimap ─────────
const mini = $('#mini'), mctx = mini.getContext('2d');
function drawMini() {
  const mw = mini.width, mh = mini.height, sx = mw / (MAPW * CELL), sy = mh / (MAPH * CELL); const p = UI.me;
  const hasRadar = G.ents.some(e => !e.dead && e.owner === p && !e.building && (e.def.detector || /Radar|Air production|mesh hub/.test(e.def.role))) && !p.lowPower && !(p.radarOffUntil > G.t);
  mctx.fillStyle = '#0a0d10'; mctx.fillRect(0, 0, mw, mh);
  if (!hasRadar) { mctx.fillStyle = '#5c6a75'; mctx.font = '11px IBM Plex Mono, monospace'; mctx.textAlign = 'center'; mctx.fillText('NO RADAR', mw / 2, mh / 2 + 4); }
  else { const cw = mw / MAPW, ch = mh / MAPH; for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const v = p.vis[idx(x, y)]; if (!v) continue; const t = G.terrain[idx(x, y)]; const TT = SIM.TT; const TC = THEME_COLS[G.theme] || THEME_COLS.grass; mctx.fillStyle = G.ore[idx(x, y)] > 0 && t !== TT.WATER ? (G.oreKind[idx(x, y)] === 2 ? '#3f74b8' : '#b8802a') : (TC[t] || TC[0]); if (v === 1) mctx.globalAlpha = 0.5; mctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5); mctx.globalAlpha = 1; }
    for (const e of G.ents) { if (e.dead || e.inside) continue; if (e.owner !== p && !visibleTo(p, e)) continue; if (e.cloaked && e.owner !== p) continue; mctx.fillStyle = e.owner.css; const s = isStruct(e.def) ? Math.max(3, e.fw * cw) : 2.5; mctx.fillRect(e.x * sx - s / 2, e.y * sy - s / 2, s, s); } }
  for (const a of UI.alarms) { a.t -= 1 / 60; mctx.strokeStyle = '#ef4b4b'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(a.x * sx, a.y * sy, 4 + (3 - a.t) * 3, 0, 7); mctx.stroke(); } UI.alarms = UI.alarms.filter(a => a.t > 0);
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.strokeRect(S.cam.x * sx, S.cam.y * sy, S.app.screen.width / S.cam.zoom * sx, S.app.screen.height / S.cam.zoom * sy);
}
UI.alarms = [];

// ───────── selection & orders ─────────
function entAt(wx, wy) { let best = null, bd = 1e9; for (const e of G.ents) { if (e.dead || e.inside) continue; if (e.owner !== UI.me && !visibleTo(UI.me, e)) continue; if (e.cloaked && e.owner !== UI.me && !canSee(UI.me, e)) continue; let dd; if (isStruct(e.def)) { if (wx >= e.cx * CELL && wx <= (e.cx + e.fw) * CELL && wy >= e.cy * CELL - (RENDER.structPick || 0) && wy <= (e.cy + e.fh) * CELL) dd = 0; else continue; } else dd = Math.hypot(e.x - wx, e.y - wy - (isAir(e.def) ? (RENDER.airPick || -22) : 0)); if (dd < 24 / Math.min(1, S.cam.zoom) && dd < bd) { bd = dd; best = e; } } return best; }
function speak(e, cat) { const now = performance.now(); if (cat !== 'select' && now - (UI.lastSpeech || 0) < 1200) return; UI.lastSpeech = now; const v = VOICE[e.def.id] || VOICE._generic; const L = v[cat] || VOICE._generic[cat]; if (!L) return; const line = L[Math.floor(Math.random() * L.length)]; RENDER.speech(e, line); AUDIO.say(line, e.def.id, 'unit'); }
function issue(wx, wy, forceAttackMove) {
  const t = entAt(wx, wy); const mine = S.sel.filter(e => !isStruct(e.def)); if (!mine.length) return;
  if (t && t.def.garrison && (t.owner === G.neutral || t.owner === UI.me)) { const inf = mine.filter(e => e.def.canGarrison); if (inf.length) { for (const e of inf) SIM.order(e, { type: 'garrison', target: t }); speak(inf[0], 'move'); S.marker = { x: t.x, y: t.y, t: 0.6, col: 0x9be37a }; AUDIO.sfx('order'); return; } if (mine.every(e => !e.def.canGarrison)) msg('Only infantry can garrison buildings', 'warn'); }
  if (t && t.def.tech && t.owner !== UI.me) { const eng = mine.filter(e => hasTag(e.def, 'engineer')); if (eng.length) { for (const e of eng) SIM.order(e, { type: 'capture', target: t }); speak(eng[0], 'attack'); S.marker = { x: t.x, y: t.y, t: 0.6, col: 0x9be37a }; AUDIO.sfx('order'); return; } }
  if (t && t.owner === UI.me && isStruct(t.def) && /[Ss]alvage|Repair/.test(t.def.role) && mine.some(e => e.def.cls === 'vehicle')) { for (const e of mine) if (e.def.cls === 'vehicle') SIM.order(e, { type: 'salvage', target: t }); msg(`Salvaging ${mine.filter(e => e.def.cls === 'vehicle').length} vehicle(s) for 50% (hacked 75%)`, 'warn'); S.marker = { x: t.x, y: t.y, t: 0.6, col: 0xe0479e }; AUDIO.sfx('order'); return; }
  if (t && t.owner !== UI.me && t.owner !== G.neutral) { for (const e of mine) { if (hasTag(e.def, 'engineer') && isStruct(t.def)) SIM.order(e, { type: 'capture', target: t }); else if (hasTag(e.def, 'spy') && isStruct(t.def)) SIM.order(e, { type: 'infiltrate', target: t }); else if (!hasTag(e.def, 'harvester')) SIM.order(e, { type: 'attack', target: t }); } speak(mine[0], 'attack'); S.marker = { x: t.x, y: t.y, t: 0.6, col: 0xff6666 }; AUDIO.sfx('order'); UI.mode = null; return; }
  if (t && t.owner === G.neutral && !t.def.garrison) { for (const e of mine) if (!hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer')) SIM.order(e, { type: 'attack', target: t }); AUDIO.sfx('order'); return; }
  if (t && t.owner === UI.me && /Refinery/.test(t.def.role) && mine.some(e => hasTag(e.def, 'harvester'))) { for (const e of mine) if (hasTag(e.def, 'harvester')) { e.returning = e.carry > 0; e.path = []; e.order = null; } AUDIO.sfx('order'); return; }
  if (t && t.owner === UI.me && isStruct(t.def) && /production/.test(t.def.role) && !mine.length) return;
  const am = forceAttackMove || UI.mode === 'amove'; SIM.orderGroup(mine, wx, wy, am ? 'attackmove' : 'move'); speak(mine[0], 'move'); S.marker = { x: wx, y: wy, t: 0.6, col: am ? 0xff8866 : 0x8feaff }; AUDIO.sfx('order'); UI.mode = null;
}
function selectAt(wx, wy, add) { const t = entAt(wx, wy); if (t && (t.owner === UI.me || (t.def.garrison && t.owner === G.neutral) || t.def.tech)) { if (add) { if (!S.sel.includes(t)) S.sel.push(t); } else S.sel = [t]; speak(t, 'select'); AUDIO.sfx('select'); if (isStruct(t.def) && /production/.test(t.def.role)) UI.rallyFrom = t; return true; } if (!add) S.sel = []; return false; }
function boxSelect(x0, y0, x1, y1, add) { let inBox; if (RENDER.worldToScreen) { const a = RENDER.worldToScreen(x0, y0), b = RENDER.worldToScreen(x1, y1); const lx = Math.min(a.x, b.x), hx = Math.max(a.x, b.x), ly = Math.min(a.y, b.y), hy = Math.max(a.y, b.y); inBox = e => { const p = RENDER.worldToScreen(e.x, e.y, isAir(e.def) ? 1.75 : 0.25); return p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy; }; } else { const a = { x: Math.min(x0, x1), y: Math.min(y0, y1) }, b = { x: Math.max(x0, x1), y: Math.max(y0, y1) }; inBox = e => e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y; } const got = G.ents.filter(e => !e.dead && e.owner === UI.me && !isStruct(e.def) && !e.inside && inBox(e)); if (got.length) { const combat = got.filter(e => !hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer')); const pick = combat.length ? combat : got; S.sel = add ? [...new Set([...S.sel, ...pick])] : pick; speak(S.sel[0], 'select'); AUDIO.sfx('select'); } else if (!add) S.sel = []; }
function toggleDeploy() { useSecondary(); }
function useSecondary() {
  const e = S.sel.find(u => u.def.secondary && !isStruct(u.def)); if (!e) return; const ab = SIM.abilityFor(e); if (!ab) return;
  if (ab.kind === 'point' || ab.kind === 'unit') { UI.mode = { type: 'ability', e, ab }; $('#targetbar').hidden = false; $('#targettxt').textContent = `${e.def.secondary.name}: ${ab.kind === 'unit' ? (ab.friendly ? 'choose a friendly target' : 'choose a target') : 'choose a point'}`; return; }
  let n = 0; for (const u of S.sel) if (u.def.id === e.def.id) { if (SIM.useAbility(u)) n++; }
  if (n) { AUDIO.sfx('click'); speak(e, 'attack'); } else AUDIO.sfx('lowpower');
}
function cancelMode() { UI.mode = null; $('#targetbar').hidden = true; }
function targetClick(wx, wy) { // returns true if consumed
  const m = UI.mode; if (!m || typeof m !== 'object') return false; const t = entAt(wx, wy);
  if (m.type === 'ability') { if (m.ab.kind === 'unit' && !t) { msg('Pick a unit or structure', 'warn'); return true; } let n = 0; for (const u of S.sel) if (u.def.id === m.e.def.id && !u.dead) { if (SIM.useAbility(u, t, wx, wy)) n++; } if (n) AUDIO.sfx('click'); else { msg('Not a valid target', 'warn'); AUDIO.sfx('lowpower'); } cancelMode(); return true; }
  if (m.type === 'super') { if (m.k === 'hlx_transit' && !m.src) { m.src = { x: wx, y: wy }; $('#targettxt').textContent = 'Quantum Shift: now choose the destination'; S.marker = { x: wx, y: wy, t: 1.5, col: 0xe0479e }; return true; } if (!UI.me.vis[idx(SIM.clamp(Math.floor(wx / CELL), 0, MAPW - 1), SIM.clamp(Math.floor(wy / CELL), 0, MAPH - 1))]) { msg('Target must be on explored ground', 'warn'); return true; } SIM.fireSuper(UI.me, m.k, wx, wy, m.src); AUDIO.sfx('ready'); cancelMode(); return true; }
  if (m.type === 'doctrine') { const d = m.d; if (d.kind === 'unit' && !t) { msg('Pick a unit', 'warn'); return true; } if (SIM.useDoctrine(UI.me, d.id, wx, wy, t, S.sel)) AUDIO.sfx('ready'); else { msg('Not a valid target', 'warn'); AUDIO.sfx('lowpower'); } cancelMode(); return true; }
  return false;
}
function powersPanel() {
  const p = UI.me; const box = $('#powers'); const sw = p.sw || {}; const doc = p.doc || { points: 0, owned: {}, cds: {} }; const list = SIM.DOCTRINES[p.faction];
  const key = Object.keys(sw).map(k => k + (sw[k].ready ? 'r' : '') + Math.floor(sw[k].charge / 5)).join(',') + '|' + doc.points + '|' + Object.keys(doc.owned).join(',') + '|' + list.map(d => Math.ceil(Math.max(0, (doc.cds[d.id] || 0) - G.t) / 5)).join(',') + '|' + (UI.mode && UI.mode.type);
  if (box.dataset.key === key) return; box.dataset.key = key; box.innerHTML = '';
  for (const k of Object.keys(sw)) { const st = sw[k]; const swd = st.e.def.superweapon; const el = document.createElement('div'); el.className = 'power' + (st.ready ? ' ready' : ''); const pct = Math.min(100, st.charge / swd.charge * 100); const left = Math.max(0, swd.charge - st.charge); el.innerHTML = `<div class="nm">${swd.name}<small>${st.ready ? 'READY' : Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0')}</small></div><div class="bar"><i style="width:${pct}%"></i></div>`; if (st.ready) { const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Launch'; b.title = swd.desc; b.onclick = () => { UI.mode = { type: 'super', k }; $('#targetbar').hidden = false; $('#targettxt').textContent = `${swd.name}: ${k === 'hlx_transit' ? 'choose the 3×3 to lift' : 'choose a target'}`; }; el.appendChild(b); } box.appendChild(el); }
  const dc = document.createElement('div'); dc.className = 'power doc'; dc.innerHTML = `<div class="nm">Doctrines<span id="docpts">${doc.points} pt${doc.points === 1 ? '' : 's'}</span></div>`; const lst = document.createElement('div'); lst.className = 'list'; dc.appendChild(lst);
  for (const d of list) { const row = document.createElement('div'); row.className = 'row'; const open = SIM.tierOpen(p, d.tier); const cd = Math.max(0, (doc.cds[d.id] || 0) - G.t); row.innerHTML = `<b title="${d.desc}">${d.name}</b><span class="tier">T${d.tier}</span>`; const b = document.createElement('button'); if (!doc.owned[d.id]) { b.textContent = 'Buy'; b.disabled = !open || doc.points < 1; b.onclick = () => { if (SIM.buyDoctrine(p, d.id)) AUDIO.sfx('ready'); }; } else { b.textContent = cd > 0 ? Math.ceil(cd) + 's' : 'Use'; b.disabled = cd > 0; b.className = cd > 0 ? '' : 'primary'; b.onclick = () => { if (d.kind === 'self') { if (SIM.useDoctrine(p, d.id, 0, 0, null, S.sel)) AUDIO.sfx('ready'); } else { UI.mode = { type: 'doctrine', d }; $('#targetbar').hidden = false; $('#targettxt').textContent = `${d.name}: ${d.kind === 'unit' ? 'choose an enemy vehicle' : 'choose a point'}`; } }; } b.title = d.desc; row.appendChild(b); lst.appendChild(row); }
  box.appendChild(dc);
}
function selectArmy(all) { const army = G.ents.filter(e => !e.dead && e.owner === UI.me && !isStruct(e.def) && !hasTag(e.def, 'harvester') && !hasTag(e.def, 'engineer')); const W = S.app.screen.width / S.cam.zoom, H = S.app.screen.height / S.cam.zoom; S.sel = all ? army : army.filter(e => e.x > S.cam.x && e.x < S.cam.x + W && e.y > S.cam.y && e.y < S.cam.y + H); if (S.sel.length) AUDIO.sfx('select'); }

// ───────── input ─────────
const cv = $('#game'); const ptrs = new Map(); let lastPinch = 0; const keys = {};
const rect = () => cv.getBoundingClientRect();
cv.addEventListener('pointerdown', ev => { if (UI.editor) { EDITOR.pointer('down', ev); return; } cv.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now(), button: ev.button, type: ev.pointerType, moved: false }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); } });
cv.addEventListener('pointermove', ev => {
  if (UI.editor) { EDITOR.pointer('move', ev); return; }
  const r = rect(); const w = RENDER.screenToWorld(ev.clientX - r.left, ev.clientY - r.top); UI.hover = w;
  if (S.placing && !UI.phone) { const [fw, fh] = FOOT(S.placing.d); S.placing.cx = Math.floor(w.x / CELL) - Math.floor(fw / 2); S.placing.cy = Math.floor(w.y / CELL) - Math.floor(fh / 2); }
  const p = ptrs.get(ev.pointerId); if (!p) return; const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY; if (Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) > 8) p.moved = true;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (lastPinch) { const c = RENDER.screenToWorld(S.app.screen.width / 2, S.app.screen.height / 2); S.cam.zoom = SIM.clamp(S.cam.zoom * d / lastPinch, 0.45, 2); RENDER.centerOn(c.x, c.y); } lastPinch = d; S.cam.x -= dx / S.cam.zoom / 2; S.cam.y -= dy / S.cam.zoom / 2; RENDER.clampCam(); return; }
  if (!p.moved) return;
  if (S.placing && UI.phone && p.type !== 'mouse') { const [fw, fh] = FOOT(S.placing.d); S.placing.cx = Math.floor(w.x / CELL) - Math.floor(fw / 2); S.placing.cy = Math.floor(w.y / CELL) - Math.floor(fh / 2); return; }
  const boxing = (p.button === 0 && p.type === 'mouse') || (p.type !== 'mouse' && UI.selectMode);
  if (boxing && !S.placing) { const a = RENDER.screenToWorld(p.sx - r.left, p.sy - r.top); S.box = { x0: a.x, y0: a.y, x1: w.x, y1: w.y }; }
  else { S.cam.x -= dx / S.cam.zoom; S.cam.y -= dy / S.cam.zoom; RENDER.clampCam(); }
});
function endPtr(ev) {
  const p = ptrs.get(ev.pointerId); ptrs.delete(ev.pointerId); if (!p || !UI.started) { S.box = null; return; }
  const r = rect(); const w = RENDER.screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
  if (S.box) { boxSelect(S.box.x0, S.box.y0, S.box.x1, S.box.y1, ev.shiftKey); S.box = null; return; }
  if (p.moved || ptrs.size) return;
  const isRight = p.button === 2, touch = p.type !== 'mouse', long = performance.now() - p.t > 450 && touch;
  if (UI.mode && typeof UI.mode === 'object') { if (isRight) { cancelMode(); return; } if (targetClick(w.x, w.y)) return; }
  if (S.placing) { if (isRight) { S.placing = null; $('#placebar').hidden = true; return; } if (touch) { const [fw, fh] = FOOT(S.placing.d); S.placing.cx = Math.floor(w.x / CELL) - Math.floor(fw / 2); S.placing.cy = Math.floor(w.y / CELL) - Math.floor(fh / 2); return; } tryPlace(); return; }
  if (!touch) { if (isRight) issue(w.x, w.y, false); else if (UI.mode === 'amove') issue(w.x, w.y, true); else { const sel = S.sel.filter(e => isStruct(e.def) && /production/.test(e.def.role)); if (sel.length && !entAt(w.x, w.y)) { for (const f of sel) f.rally = { x: w.x, y: w.y }; S.marker = { x: w.x, y: w.y, t: 0.6, col: 0xffd86b }; AUDIO.sfx('order'); } else selectAt(w.x, w.y, ev.shiftKey); } }
  else { const t = entAt(w.x, w.y); if (UI.mode === 'amove' || long) issue(w.x, w.y, true); else if (t && t.owner === UI.me && !(S.sel.some(e => hasTag(e.def, 'harvester')) && /Refinery/.test(t.def.role))) selectAt(w.x, w.y, false); else if (S.sel.length && S.sel.some(e => !isStruct(e.def))) issue(w.x, w.y, false); else selectAt(w.x, w.y, false); }
}
cv.addEventListener('pointerup', ev => { if (UI.editor) { EDITOR.pointer('up', ev); return; } endPtr(ev); }); cv.addEventListener('pointercancel', ev => { ptrs.delete(ev.pointerId); S.box = null; });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('wheel', ev => { ev.preventDefault(); const r = rect(); const before = RENDER.screenToWorld(ev.clientX - r.left, ev.clientY - r.top); S.cam.zoom = SIM.clamp(S.cam.zoom * (ev.deltaY < 0 ? 1.1 : 0.9), 0.45, 2); const after = RENDER.screenToWorld(ev.clientX - r.left, ev.clientY - r.top); S.cam.x += before.x - after.x; S.cam.y += before.y - after.y; RENDER.clampCam(); }, { passive: false });
mini.addEventListener('pointerdown', ev => { const r = mini.getBoundingClientRect(); const wx = (ev.clientX - r.left) / r.width * MAPW * CELL, wy = (ev.clientY - r.top) / r.height * MAPH * CELL; if (ev.button === 2 && S.sel.length) issue(wx, wy, false); else RENDER.centerOn(wx, wy); }); mini.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', ev => {
  if (!UI.started) return; const k = ev.key.toLowerCase(); keys[k] = true;
  if (k === 's') { for (const e of S.sel) { e.order = null; e.path = []; e.target = null; } }
  if (k === 'a') UI.mode = UI.mode === 'amove' ? null : 'amove';
  if (k === 'd' || k === 'f') toggleDeploy();
  if (k === 'e') selectArmy(ev.shiftKey);
  if (k === 'h') { const cy = G.ents.find(e => !e.dead && e.owner === UI.me && /Construction/.test(e.def.role)); if (cy) RENDER.centerOn(cy.x, cy.y); }
  if (k === ' ') { if (UI.lastAlarm) RENDER.centerOn(UI.lastAlarm.x, UI.lastAlarm.y); ev.preventDefault(); }
  if (k === 'escape') { if (UI.mode && typeof UI.mode === 'object') { cancelMode(); return; } S.placing = null; $('#placebar').hidden = true; UI.mode = null; S.sel = []; }
  if (/^[0-9]$/.test(k)) { if (ev.ctrlKey || ev.metaKey) { if (S.sel.length) UI.groups[k] = [...S.sel]; } else if (UI.groups[k]) { S.sel = [...UI.groups[k]]; if (UI.lastG === k) RENDER.centerOn(S.sel[0].x, S.sel[0].y); UI.lastG = k; } ev.preventDefault(); }
  if (k === 'tab') { ev.preventDefault(); const i = TABS.findIndex(t => t[0] === UI.tab); UI.tab = TABS[(i + 1) % TABS.length][0]; buildSidebar(); }
  if (k === 'm') { AUDIO.A.enabled = !AUDIO.A.enabled; }
});
window.addEventListener('keyup', ev => { keys[ev.key.toLowerCase()] = false; });
$('#secbtn').onclick = useSecondary; $('#targetcancel').onclick = cancelMode; $('#stopbtn').onclick = () => { for (const e of S.sel) { e.order = null; e.path = []; e.target = null; } AUDIO.sfx('click'); }; $('#amovebtn').onclick = () => { UI.mode = UI.mode === 'amove' ? null : 'amove'; AUDIO.sfx('click'); };
$('#salvbtn').onclick = () => { const p = UI.me; const salv = G.ents.find(x => !x.dead && x.owner === p && isStruct(x.def) && /[Ss]alvage|Repair/.test(x.def.role) && !x.building); if (!salv) return; for (const e of S.sel) if (e.owner === p && e.def.cls === 'vehicle') SIM.order(e, { type: 'salvage', target: salv }); AUDIO.sfx('order'); msg(`Salvaging at ${salv.def.name}`, 'warn'); };
$('#sellbtn').onclick = () => { for (const e of S.sel) if (e.owner === UI.me) SIM.sell(e); S.sel = []; AUDIO.sfx('sell'); }; $('#evacbtn').onclick = () => { for (const e of S.sel) if (e.occupants && e.owner === UI.me) SIM.evacuate(e); AUDIO.sfx('order'); }; $('#repairbtn').onclick = () => { for (const e of S.sel) SIM.repairToggle(e); AUDIO.sfx('click'); };
$('#selmode').onclick = () => { UI.selectMode = !UI.selectMode; $('#selmode').classList.toggle('on', UI.selectMode); }; $('#deselect').onclick = () => { S.sel = []; UI.mode = null; };
$('#grpadd').onclick = () => { if (!S.sel.length) return; const k = String(Object.keys(UI.groups).length + 1); UI.groups[k] = [...S.sel]; AUDIO.sfx('click'); };
$('#homebtn').onclick = () => { const cy = G.ents.find(e => !e.dead && e.owner === UI.me && /Construction/.test(e.def.role)); if (cy) RENDER.centerOn(cy.x, cy.y); };
$('#armybtn').onclick = () => selectArmy(true);
$('#speed').onclick = () => { G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 0.5 : 1; $('#speed').textContent = G.speed + '×'; };
$('#mute').onclick = () => { AUDIO.A.enabled = !AUDIO.A.enabled; AUDIO.A.voices = AUDIO.A.enabled; $('#mute').textContent = AUDIO.A.enabled ? 'Sound' : 'Muted'; };
$('#placeok').onclick = tryPlace; $('#placecancel').onclick = () => { S.placing = null; $('#placebar').hidden = true; };
$('#drawerbtn').onclick = () => { document.body.classList.toggle('drawer-open'); };
document.querySelectorAll('[data-faction]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-faction]').forEach(x => x.classList.remove('on')); b.classList.add('on'); UI.pickF = b.dataset.faction; $('#fdesc').textContent = b.dataset.desc; });
const DIFF_DESC = { recruit: 'Recruit — a slow, forgiving opponent: never attacks before 8 minutes, builds one defence, uses no doctrines or superweapons, runs a 70% economy. For learning the controls.', easy: 'Easy — scouts you, defends its base and sends small waves from 6 minutes. No counter-building, no retreats. 85% economy.', normal: 'Normal — reads your army and builds counters, garrisons the town, captures derricks, uses unit abilities and doctrines, retreats from lost fights. First wave around 5 minutes. Fair economy.', hard: 'Hard — everything Normal does, plus harvester raids, micro (damaged tanks pull back for repair, focus fire), two harvesters per refinery and four defences. Thinks faster, attacks from 3½ minutes with bigger waves. +15% economy, +$2,000 start.', brutal: 'Brutal — the Hard AI with a 30% faster economy, 25% faster production, five defences, waves from 2½ minutes that grow every time, and +$5,000 start. It will not slow down.' };
const showDiff = () => { const el = $('#ddesc'); if (el) el.textContent = DIFF_DESC[$('#diff').value] || ''; }; $('#diff').onchange = showDiff; showDiff();
$('#go').onclick = () => { startGame(gameConfig()); };
$('#editbtn').onclick = () => { EDITOR.open(UI.mapData || UI.pickMap || 'riverlands'); };
buildMaps();
$('#again').onclick = () => { $('#end').hidden = true; $('#start').hidden = false; $('#hud').hidden = true; UI.started = false; buildMaps(); };

// ───────── events → feedback ─────────
function dispatch() {
  for (const ev of G.events) {
    RENDER.handleEvent(ev); const me = UI.me; const vis = e => e.owner === me || visibleTo(me, e); const d = (x, y) => Math.hypot(x - (S.cam.x + S.app.screen.width / S.cam.zoom / 2), y - (S.cam.y + S.app.screen.height / S.cam.zoom / 2)); const pan = x => (x - (S.cam.x + S.app.screen.width / S.cam.zoom / 2)) / (S.app.screen.width / S.cam.zoom / 2) * 0.8;
    switch (ev.type) {
      case 'shot': if (vis(ev.e) || vis(ev.tgt)) AUDIO.sfx(ev.w.wh, d(ev.x1, ev.y1), pan(ev.x1)); break;
      case 'death': if (vis(ev.e)) AUDIO.sfx(isStruct(ev.e.def) || ev.e.def.armour === 'heavy' ? 'bigexplode' : isInf(ev.e.def) ? 'crush' : 'explode', d(ev.x, ev.y)); if (ev.e.owner === me && isInf(ev.e.def)) speakDeath(ev.e); break;
      case 'crush': AUDIO.sfx('crush', d(ev.x, ev.y), pan(ev.x)); break;
      case 'voice': if (ev.e.owner === me) speak(ev.e, ev.cat); break;
      case 'announce': AUDIO.announce(ev.m, me.faction); if (ev.kind === 'bad') AUDIO.sfx('alarm'); break;
      case 'alarm': if (ev.x !== undefined) { UI.alarms.push({ x: ev.x, y: ev.y, t: 3 }); UI.lastAlarm = { x: ev.x, y: ev.y }; } break;
      case 'ready': if (ev.p === me) { AUDIO.sfx('ready'); if (!UI.phone) enterPlacement(ev.d); else msg(`${ev.d.name} ready — tap its icon to place`, 'good'); } break;
      case 'unitready': if (ev.e.owner === me) AUDIO.sfx('ready'); break;
      case 'unload': if (ev.e.owner === me) AUDIO.sfx('cash'); break;
      case 'cratepick': if (ev.p === me) AUDIO.sfx('ready'); break;
      case 'garrison': if (ev.e.owner === me) AUDIO.sfx('order'); break;
      case 'capture': if (ev.e.owner === me) AUDIO.sfx('ready'); break;
      case 'infiltrate': AUDIO.sfx(ev.p === me ? 'cash' : 'alarm'); break;
      case 'promote': if (ev.e.owner === me) { AUDIO.sfx('promote'); msg(`${ev.e.def.name} promoted to ${ev.e.rank === 2 ? 'Elite' : 'Veteran'}`, 'good'); } break;
      case 'hack': if (ev.e.origOwner === me || ev.e.owner === me) { AUDIO.sfx('HACK'); msg(ev.e.owner === me ? `${ev.e.def.name} hacked — it's yours` : `${ev.e.def.name} has been hacked!`, ev.e.owner === me ? 'good' : 'bad'); } break;
      case 'swfire': AUDIO.sfx('alarm'); if (ev.p !== me) UI.alarms.push({ x: ev.x, y: ev.y, t: 6 }); break;
      case 'swready': if (ev.p === me) AUDIO.sfx('ready'); break;
      case 'nuke': AUDIO.sfx('bigexplode', 0); AUDIO.sfx('bigexplode', 0); break;
      case 'impact': AUDIO.sfx('SIEGE', d(ev.x, ev.y), pan(ev.x)); break;
      case 'mine': AUDIO.sfx('explode', d(ev.x, ev.y), pan(ev.x)); break;
      case 'ability': if (ev.e.owner === me) AUDIO.sfx('click'); break;
      case 'doctrine': if (ev.p === me) AUDIO.sfx('ready'); break;
      case 'doctrineuse': if (ev.p === me) AUDIO.sfx('ready'); break;
      case 'teleport': AUDIO.sfx('EMP', d(ev.x2, ev.y2), pan(ev.x2)); break;
      case 'over': break;
    }
  }
  G.events.length = 0;
}
function speakDeath(e) { const v = VOICE[e.def.id]; if (v && v.hurt && Math.random() < 0.3) AUDIO.say(v.hurt[0], e.def.id, 'unit'); }

// ───────── main loop ─────────
UI.phone = window.matchMedia('(max-width: 760px)').matches; document.body.classList.toggle('phone', UI.phone);
RENDER.init(cv);
let last = performance.now(), acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const el = Math.min(0.1, (now - last) / 1000); last = now;
  try {
    if (UI.started && !G.over) { acc += el * G.speed; let n = 0; while (acc >= DT && n++ < 6) { SIM.step(DT); acc -= DT; } dispatch(); }
    if (UI.started) { const sp = 700 * el / S.cam.zoom; if (keys['arrowleft']) S.cam.x -= sp; if (keys['arrowright']) S.cam.x += sp; if (keys['arrowup']) S.cam.y -= sp; if (keys['arrowdown']) S.cam.y += sp; RENDER.clampCam(); RENDER.frame(el); refreshSidebar(); drawMini(); }
  } catch (err) { UI.loopErrors = (UI.loopErrors || 0) + 1; if (UI.loopErrors <= 5) console.error('frame error', err); }
}
requestAnimationFrame(loop);
window.__T = { SIM, RENDER, AUDIO, UI, S, startGame, gameConfig, buildMaps, customMaps, enterPlacement, tryPlace, clickItem, buildSidebar, dispatch, advance: sec => { const n = Math.round(sec / DT); for (let i = 0; i < n && !G.over; i++) SIM.step(DT); dispatch(); } };
})();
