// Interface: sidebar (credits ticker, power meter, minimap, build tabs with portraits, progress clocks, queue counts,
// tooltips with cost / time / counters), selection panel, idle harvester and idle unit buttons, announcer subtitles,
// minimap pings and Space-to-alert, settings (game speed, harvester speed, volume, graphics), start and end screens,
// and the in-world HUD (selection, health bars, rally lines, waypoints, drag box).
import * as THREE from 'three';
import { STRUCTURES, FACTIONS, ITEM_KEYS, TAB_KEYS, RULES, BUILDING_FOR } from './rules.js';
import { TEAM_COLORS } from './engine/views.js';
import { harvesterSandboxSpeed } from './engine/pace.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const CLASS = { infantry: 'infantry', light: 'light vehicles', heavy: 'tanks', air: 'aircraft', naval: 'ships', building: 'structures' };
const TABS = [['structure', 'Base'], ['infantry', 'Troops'], ['vehicle', 'Armor'], ['air', 'Air'], ['naval', 'Naval']];
const hex = (c) => '#' + c.getHexString();

/** RA2-style wrench badge over a structure under repair; rocks while it works */
function drawWrench(g, x, y, col, t) {
  g.save(); g.translate(x, y); g.rotate(-0.6 + (t ? Math.sin(t * 6) * 0.35 : 0)); g.lineCap = 'round';
  const shape = () => { g.beginPath(); g.moveTo(0, 2); g.lineTo(0, 13); g.moveTo(Math.cos(-0.15 * Math.PI) * 6, -3 + Math.sin(-0.15 * Math.PI) * 6); g.arc(0, -3, 6, -0.15 * Math.PI, 1.15 * Math.PI, false); g.stroke(); };
  g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 6.5; shape(); g.strokeStyle = col; g.lineWidth = 3.5; shape();
  g.restore();
}

export class UI {
  constructor(C) {
    this.C = C; this.tab = 'structure'; this.fc = 0; this.lastCredits = C.p.credits; this.flashT = 0; this.subQ = []; this.pings = []; this.idleIdx = { harv: 0, units: 0 };
    this.hud = $('#hud'); this.g = this.hud.getContext('2d'); this.resize();
    document.documentElement.style.setProperty('--fac', FACTIONS[C.p.faction].color);
    $('#side').hidden = false; $('#topbar').hidden = false;
    // tabs
    const tabs = $('#tabs'); tabs.innerHTML = '';
    for (const [k, label] of TABS) { const b = el('button', 'tab', `<span>${label}</span><kbd>${TAB_KEYS[k].toUpperCase()}</kbd><i class="dot"></i>`); b.dataset.tab = k; b.id = 'tab-' + k; b.onclick = () => this.setTab(k); tabs.appendChild(b); }
    this.setTab('structure');
    // minimap
    this.mm = $('#minimap'); this.mmg = this.mm.getContext('2d'); this.mmBase = C.mapView.minimapCanvas; this.mmDown = false;
    const mmJump = (e, order) => { const r = this.mm.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * C.T.W, y = (1 - (e.clientY - r.top) / r.height) * C.T.H;
      if (order) { const us = C.input.selUnits(); if (us.length) { C.world.orderGroup(us, { type: C.input.mode === 'attackMove' ? 'attackMove' : 'move', x, y }); C.input.marker(x, y, 0x7cf29a); C.input.ack(us[0], 'move', { x, y }); C.input.setMode(null); } } else C.rcam.setFocus(x, y); };
    this.mm.addEventListener('pointerdown', (e) => { if (e.button === 0) { this.mmDown = true; mmJump(e, false); } else if (e.button === 2) mmJump(e, true); });
    addEventListener('pointermove', (e) => { if (this.mmDown) mmJump(e, false); }); addEventListener('pointerup', () => { this.mmDown = false; });
    this.mm.addEventListener('contextmenu', (e) => e.preventDefault());
    // idle buttons, settings, pause
    $('#idleHarv').onclick = () => this.cycleIdle('harv'); $('#idleUnits').onclick = () => this.cycleIdle('units');
    $('#btnRepair').onclick = () => C.input.toggleRepairMode();
    $('#btnRotate').onclick = () => C.input.rotatePlace(1);
    $('#btnSettings').onclick = () => this.toggleSettings(); $('#btnPause').onclick = () => { C.paused = !C.paused; this.pauseChanged(); };
    this.settingsUI();
    if (C.audio && C.audio.onSubtitle) { C.audio.onSubtitle((text) => this.subtitle(text)); this.subHooked = true; }
    this.buildGrid(); this.selChanged();
  }
  resize() { const d = Math.min(devicePixelRatio, 2); this.hud.width = innerWidth * d; this.hud.height = innerHeight * d; this.hud.style.width = innerWidth + 'px'; this.hud.style.height = innerHeight + 'px'; this.g.setTransform(d, 0, 0, d, 0, 0); }
  toast(s, ms = 2200) { const t = $('#toast'); t.textContent = s; t.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => (t.hidden = true), ms); }
  subtitle(s) { const t = $('#subtitle'); t.textContent = s; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(this._st); this._st = setTimeout(() => t.classList.remove('show'), 2600); }
  announce(key, fallback) {   // the announcer speaks and its subtitle callback shows the line; without audio, the subtitle alone
    const C = this.C; if (!C.audio) { if (fallback) this.subtitle(fallback); return; }
    try { const t = C.audio.announce(key); if (t && !this.subHooked) this.subtitle(t); } catch (e) { if (fallback) this.subtitle(fallback); }
  }
  ping(x, y, color = '#ff4a3d') { this.pings.push({ x, y, t: performance.now(), color }); if (this.pings.length > 12) this.pings.shift(); }
  modeChanged(m) { $('#mode').textContent = m === 'attackMove' ? 'Attack-move: click a destination' : m === 'guard' ? 'Guard: click a point (G again guards here)' : m === 'ability' ? 'Ability: click a target' : m === 'place' ? 'Place structure: left-click to build · R or ← → to rotate · right-click to cancel' : m === 'repair' ? 'Repair: click your structures to start or stop (K or right-click to finish)' : ''; $('#mode').hidden = !m; $('#btnRepair').classList.toggle('on', m === 'repair'); $('#btnRotate').hidden = m !== 'place'; }
  pauseChanged() { $('#btnPause').textContent = this.C.paused ? 'Resume' : 'Pause'; $('#paused').hidden = !this.C.paused; }
  closePanels() { $('#settings').hidden = true; }
  toggleSettings() { $('#settings').hidden = !$('#settings').hidden; }

  // ───────── build menu ─────────
  setTab(k) { this.tab = k; for (const b of document.querySelectorAll('#tabs .tab')) b.classList.toggle('on', b.dataset.tab === k); this.buildGrid(); if (this.C.audio) this.C.audio.sfx('ui_click'); }
  buildGrid() {
    const C = this.C, grid = $('#grid'); grid.innerHTML = ''; this.btns = [];
    C.game.options(C.p, this.tab).forEach((key, i) => {
      const b = el('button', 'item'); b.dataset.key = key; const name = this.nameOf(this.tab, key);
      b.innerHTML = `<img alt="" src="${(C.cameos || {})[key] || ''}"><span class="nm">${name}</span><span class="cost">$${fmt(C.game.costOf(this.tab, key))}</span><kbd>${(ITEM_KEYS[i] || '').toUpperCase()}</kbd><span class="cnt"></span><span class="clock"></span><span class="st"></span>`;
      b.onclick = (e) => this.pressItem(i, e.shiftKey ? 5 : 1); b.oncontextmenu = (e) => { e.preventDefault(); this.cancelItem(key); };
      b.onpointerenter = () => this.showTip(b, this.tab, key); b.onpointerleave = () => this.hideTip();
      grid.appendChild(b); this.btns.push(b);
    });
    this.refreshGrid(true);
  }
  nameOf(cat, key) { return cat === 'structure' ? STRUCTURES[key].name : (this.C.spec[key] ? this.C.spec[key].name : key); }
  pressItem(i, n = 1) {
    const C = this.C, keys = C.game.options(C.p, this.tab), key = keys[i]; if (!key) return; const cat = this.tab, p = C.p;
    if (cat === 'structure' && p.ready && p.ready.key === key) { C.input.startPlace(key); if (C.audio) C.audio.sfx('ui_click'); return; }
    const head = p.queues[cat][0]; if (head && head.key === key && head.onHold) { head.onHold = false; if (C.audio) C.audio.sfx('ui_queue'); this.refreshGrid(true); return; }
    if (!C.game.available(p, cat, key)) { if (C.audio) C.audio.sfx('ui_error'); this.toast(this.lockReason(cat, key)); return; }
    if (cat === 'structure' && (p.queues.structure.length || p.ready)) { if (C.audio) C.audio.sfx('ui_error'); this.toast(p.ready ? `Place the ${STRUCTURES[p.ready.key].name} first` : 'Already building a structure'); return; }
    const ok = C.game.enqueue(p, cat, key, n); if (ok) { if (C.audio) C.audio.sfx('ui_queue'); if (cat === 'structure') this.announce('building', 'Building'); } this.refreshGrid(true);
  }
  cancelItem(key) {   // right-click: hold the item in production; again: cancel it (every credit spent comes back)
    const C = this.C, p = C.p, Q = p.queues[this.tab]; const head = Q[0];
    if (head && head.key === key && !head.onHold && !(p.ready === head)) { head.onHold = true; this.announce('on_hold', 'On hold'); }
    else if (C.game.cancel(p, this.tab, key)) { this.announce('cancelled', 'Cancelled'); if (C.input.place && C.input.place.key === key) C.input.cancelPlace(); }
    if (C.audio) C.audio.sfx('ui_cancel'); this.refreshGrid(true);
  }
  lockReason(cat, key) {
    const C = this.C; if (cat === 'structure') { const S = STRUCTURES[key]; if (!C.game.has(C.p, 'yard')) return 'Needs a Construction Yard'; const miss = (S.requires || []).filter((r) => !C.game.has(C.p, r)); return miss.length ? `Requires ${miss.map((r) => STRUCTURES[r].name).join(', ')}` : ''; }
    return `Requires ${STRUCTURES[BUILDING_FOR[cat]].name}`;
  }
  refreshGrid(full) {
    const C = this.C, p = C.p, cat = this.tab, Q = p.queues[cat];
    for (const b of this.btns || []) {
      const key = b.dataset.key, avail = C.game.available(p, cat, key), mine = Q.filter((q) => q.key === key), head = Q[0] && Q[0].key === key ? Q[0] : null;
      const ready = cat === 'structure' && p.ready && p.ready.key === key;
      b.classList.toggle('locked', !avail && !mine.length && !ready); b.classList.toggle('ready', !!ready); b.classList.toggle('hold', !!(head && head.onHold)); b.classList.toggle('busy', !!head && !ready);
      b.classList.toggle('stalled', !!(head && head.stalled));
      const f = head ? head.spent / head.cost : 0; b.style.setProperty('--p', head && !ready ? f : 0);
      if (full || this.fc % 6 === 0) { b.querySelector('.cnt').textContent = mine.length > 1 || (cat !== 'structure' && mine.length && !head) ? mine.length : ''; b.querySelector('.st').textContent = ready ? 'READY' : head && head.onHold ? 'ON HOLD' : head ? `${Math.floor(f * 100)}%` : ''; }
    }
    for (const [k] of TABS) { const t = $('#tab-' + k); if (!t) continue; const has = k === 'structure' ? C.game.has(p, 'yard') : C.game.has(p, BUILDING_FOR[k]);
      t.classList.toggle('off', !has); t.classList.toggle('work', p.queues[k].length > 0); t.classList.toggle('rdy', k === 'structure' && !!p.ready); }
  }
  showTip(btn, cat, key) {
    const C = this.C, tip = $('#tip'), gs = C.pace.game_speed; let h;
    const cost = C.game.costOf(cat, key), secs = cost / RULES.buildRate / gs;
    if (cat === 'structure') { const S = STRUCTURES[key]; h = `<b>${S.name}</b><div class="r"><span>$${fmt(cost)}</span><span>${secs.toFixed(0)} s</span><span>${S.power > 0 ? '+' : ''}${S.power} power</span></div><p>${S.desc}</p>`; }
    else { const sp = C.spec[key]; const c = this.counters(key);
      h = `<b>${sp.name}</b><div class="r"><span>$${fmt(cost)}</span><span>${secs.toFixed(0)} s</span><span>${sp.health} HP</span><span>${sp.speed_mps} m/s</span></div><p>${sp.role || ''}</p>` +
        (c.strong.length ? `<p class="g">Strong vs ${c.strong.join(', ')}</p>` : '') + (c.weak.length ? `<p class="w">Weak vs ${c.weak.join(', ')}</p>` : ''); }
    if (!C.game.available(C.p, cat, key)) h += `<p class="w">${this.lockReason(cat, key)}</p>`;
    h += `<p class="k">Click: build${cat === 'structure' ? '' : ' (Shift: 5)'} · Right-click: hold / cancel</p>`;
    tip.innerHTML = h; tip.hidden = false; const r = btn.getBoundingClientRect(); tip.style.top = Math.max(8, Math.min(innerHeight - tip.offsetHeight - 8, r.top)) + 'px'; tip.style.right = (innerWidth - r.left + 8) + 'px';
  }
  hideTip() { $('#tip').hidden = true; }
  counters(uid) {   // strong vs: target classes its weapons do full damage to; weak vs: enemy units with the highest damage per second against it
    const C = this.C, sp = C.spec[uid]; if (!sp || !sp.weapons.length) return { strong: [], weak: [] };
    const best = {}; for (const w of sp.weapons) for (const [cls, m] of Object.entries(w.multipliers || {})) if (w.targets.includes(cls)) best[cls] = Math.max(best[cls] || 0, m);
    const strong = Object.entries(best).filter(([, m]) => m >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => CLASS[c] || c);
    const arm = sp.armor, foes = [];
    for (const f of Object.keys(FACTIONS)) { if (f === C.p.faction) continue; for (const cat of ['infantry', 'vehicle', 'air', 'naval']) for (const id of FACTIONS[f][cat]) { const s = C.spec[id]; if (!s || id === 'HV') continue;
      let dps = 0; for (const w of s.weapons) if (w.targets.includes(arm)) dps = Math.max(dps, w.damage * (w.burst || 1) / w.cycle_s * (w.multipliers[arm] || 0)); if (dps > 0) foes.push([s.name, dps / s.cost]); } }
    foes.sort((a, b) => b[1] - a[1]); return { strong, weak: [...new Set(foes.slice(0, 3).map((x) => x[0]))] };
  }

  // ───────── selection panel ─────────
  selChanged() {
    const C = this.C, box = $('#selInfo'); const objs = [...C.sel].map((id) => C.world.byId.get(id)).filter((o) => o && o.alive);
    if (!objs.length) { box.innerHTML = `<div class="hint">Left-click or drag to select · Right-click to order<br><kbd>A</kbd> attack-move <kbd>S</kbd> stop <kbd>G</kbd> guard <kbd>D</kbd> deploy <kbd>F</kbd> ability</div>`; return; }
    if (objs[0].isBuilding) { const b = objs[0], S = STRUCTURES[b.kind]; box.innerHTML = `<div class="one"><img src="${(C.cameos || {})[b.kind] || ''}" alt=""><div><b>${S.name}</b><span class="hp"><i style="width:${(b.hp / b.maxHp * 100).toFixed(0)}%"></i></span><small>${b.team === C.p.team ? (S.produces ? 'Right-click the ground to set its rally point' : S.desc) : 'Enemy structure'}</small></div></div>`; this.selDyn = { b }; return; }
    if (objs.length === 1) { const u = objs[0]; box.innerHTML = `<div class="one"><img src="${(C.cameos || {})[u.uid] || ''}" alt=""><div><b>${u.sp.name}</b><span class="hp"><i></i></span><small class="state"></small></div></div>`; this.selDyn = { u }; return; }
    const by = new Map(); for (const u of objs) by.set(u.uid, (by.get(u.uid) || 0) + 1);
    box.innerHTML = `<div class="many">${[...by].map(([uid, n]) => `<button class="mini" data-uid="${uid}" title="${C.spec[uid] ? C.spec[uid].name : uid}"><img src="${(C.cameos || {})[uid] || ''}" alt=""><span>${n}</span></button>`).join('')}</div><small>${objs.length} selected · click a type to keep only it</small>`;
    for (const b of box.querySelectorAll('.mini')) b.onclick = () => C.input.select(objs.filter((u) => u.uid === b.dataset.uid).map((u) => u.id), true);
    this.selDyn = null;
  }
  selFrame() {
    const d = this.selDyn; if (!d) return; const box = $('#selInfo');
    if (d.u) { const u = d.u; if (!u.alive) { this.C.sel.delete(u.id); this.selChanged(); return; } const i = box.querySelector('.hp i'); if (i) i.style.width = `${(u.hp / u.maxHp * 100).toFixed(0)}%`;
      const st = box.querySelector('.state'); if (st) st.textContent = this.stateOf(u); }
    if (d.b) { if (!d.b.alive) { this.C.sel.delete(d.b.id); this.selChanged(); return; } const i = box.querySelector('.hp i'); if (i) i.style.width = `${(d.b.hp / d.b.maxHp * 100).toFixed(0)}%`; }
  }
  stateOf(u) {
    if (u.harv) return { out: 'Driving to the ore field', waitField: 'Waiting at the field', load: 'Mining ore', queue: 'Waiting for the refinery', back: 'Returning with ore', pivot: 'Docking', reverse: 'Docking', unload: 'Unloading', exit: 'Leaving the refinery', idle: 'Idle' }[u.harv.state] || 'Harvesting';
    const r = ['', ' · Veteran', ' · Elite'][u.rank || 0]; const hp = `${Math.ceil(u.hp)} / ${Math.ceil(u.maxHp)} HP`;
    const s = u.rollOut ? 'Leaving the factory' : u.deploy && u.deploy !== 'mobile' ? (u.deploy === 'deployed' ? 'Deployed' : 'Deploying') : u.kind === 'jet' ? ({ landed: 'On the pad', reload: 'Rearming', takeoff: 'Taking off', cruise: 'In flight', attack: 'Attack run', return: 'Returning', approach: 'Landing' }[u.jet.phase] || u.jet.phase)
      : u.target != null ? 'Engaging' : u.order.type === 'guard' ? 'Guarding' : u.path ? (u.order.type === 'attackMove' ? 'Attack-moving' : 'Moving') : 'Idle';
    return `${hp} · ${s}${u.emp ? ' · EMP' : ''}${r}`;
  }
  cycleIdle(kind) {
    const C = this.C; const list = this.idle(kind); if (!list.length) { if (C.audio) C.audio.sfx('ui_error'); return; }
    const u = list[this.idleIdx[kind]++ % list.length]; C.input.select([u.id], true); C.rcam.flyTo(u.x, u.y, 0.3);
  }
  idle(kind) {
    const C = this.C; return C.game.unitsOf(C.p).filter((u) => kind === 'harv' ? u.uid === 'HV' && (u.order.type === 'idle' || (u.harv && u.harv.state === 'idle')) && !u.rollOut
      : u.uid !== 'HV' && u.order.type === 'idle' && !u.path && u.target == null && !u.rollOut && !(u.deploy === 'deployed') && !(u.kind === 'jet' && u.jet.phase !== 'landed' && u.jet.phase !== 'reload'));
  }

  // ───────── settings ─────────
  settingsUI() {
    const C = this.C, P = C.pace, gs = $('#setGs'), hr = $('#setHr');
    gs.min = P.game_speed_range[0]; gs.max = P.game_speed_range[1]; gs.step = 0.1; gs.value = P.game_speed; hr.min = P.harvester_ratio_range[0]; hr.max = P.harvester_ratio_range[1]; hr.step = 0.01; hr.value = P.harvester_speed_ratio;
    gs.oninput = () => C.setPace({ game_speed: +gs.value }); hr.oninput = () => C.setPace({ harvester_speed_ratio: +hr.value });
    const rg = $('#setRegrow'); if (rg) { rg.value = C.regrow; rg.oninput = () => C.setPace({ regrow: +rg.value }); }
    const us = $('#setUs'); us.value = C.unitScale; us.oninput = () => C.setPace({ unit_scale: +us.value });
    const tk = $('#setTtk'); tk.value = C.combat ? C.combat.ttk_scale : 1; tk.oninput = () => C.setPace({ ttk: +tk.value });
    $('#setReset').onclick = () => { C.setPace({ game_speed: C.paceFile.game_speed, harvester_speed_ratio: C.paceFile.harvester_speed_ratio, ttk: 1, unit_scale: 1.75, regrow: 1 }); $('#setUs').value = 1.75; $('#setRegrow').value = 1; gs.value = C.pace.game_speed; hr.value = C.pace.harvester_speed_ratio; $('#setTtk').value = 1; };
    for (const [id, bus] of [['setVol', 'master'], ['setVoice', 'voice']]) { const s = $('#' + id); s.oninput = () => { if (C.audio) try { C.audio.setVolume(bus, +s.value); if (bus === 'voice') C.audio.setVolume('announcer', +s.value); } catch (e) { /* optional */ } }; }
    $('#setEdge').onchange = (e) => { C.rcam.edge = e.target.checked; };
    $('#setQuality').value = C.quality; $('#setQuality').onchange = (e) => { C.quality = e.target.value; try { localStorage.setItem('thunderhead.settings', JSON.stringify({ gs: P.game_speed, hr: P.harvester_speed_ratio, quality: C.quality })); } catch (err) { /* ignore */ } this.toast('Graphics quality applies after a reload'); };
    $('#setClose').onclick = () => { $('#settings').hidden = true; };
    this.paceChanged();
  }
  paceChanged() {
    const C = this.C, P = C.pace; if (!$('#setGsV')) return; const v = harvesterSandboxSpeed(P);
    $('#setGsV').textContent = `${P.game_speed.toFixed(1)}×`; $('#setHrV').textContent = `${P.harvester_speed_ratio.toFixed(2)}× tank`; if ($('#setRegrowV')) $('#setRegrowV').textContent = `${(C.regrow * (C.economy ? C.economy.regrow_share * 100 : 5)).toFixed(1)} % of mining speed`; $('#setUsV').textContent = `${C.unitScale.toFixed(2)}× (map and sim stay true scale)`; if (C.combat) $('#setTtkV').textContent = `${C.combat.ttk_scale.toFixed(1)}× (fights ${C.combat.ttk_scale >= 1 ? 'longer' : 'shorter'})`; $('#spd').textContent = `${P.game_speed.toFixed(1)}×`;
    $('#setNote').textContent = `Everything runs ${P.game_speed.toFixed(1)}× faster than real time: movement, turning, reloads, harvesting and building. Map and model sizes stay true. Harvester ${v.toFixed(1)} m/s.`;
    const gs = $('#setGs'); if (gs && +gs.value !== P.game_speed) gs.value = P.game_speed;
  }

  // ───────── per frame ─────────
  frame(dt) {
    const C = this.C, p = C.p; this.fc++;
    for (const e of C.game.since(C.seq)) { C.seq = e.seq; this.onGameEvent(e); }
    // credits tick toward the balance; green when income arrives
    const shown = Math.floor(p.shown), cr = $('#credits'); if (cr.dataset.v !== String(shown)) { cr.textContent = `$${fmt(shown)}`; cr.dataset.v = shown; }
    if (p.credits > this.lastCredits + 1) { cr.classList.remove('up'); void cr.offsetWidth; cr.classList.add('up'); } this.lastCredits = p.credits;
    // power meter
    const pw = p.power, maxP = Math.max(400, pw.made, pw.used) * 1.1, low = pw.used > pw.made;
    $('#powerMade').style.height = `${(pw.made / maxP * 100).toFixed(1)}%`; $('#powerUsed').style.bottom = `${(pw.used / maxP * 100).toFixed(1)}%`; $('#power').classList.toggle('low', low);
    if (this.fc % 10 === 0) { $('#powerTxt').textContent = `${pw.used} / ${pw.made}`; $('#powerTxt').classList.toggle('low', low);
      const ih = this.idle('harv').length, iu = this.idle('units').length; $('#idleHarv').querySelector('b').textContent = ih; $('#idleUnits').querySelector('b').textContent = iu; $('#idleHarv').classList.toggle('alert', ih > 0); $('#idleUnits').classList.toggle('dim', iu === 0);
      const t = C.game.t; $('#clock').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      const opts = Object.keys(STRUCTURES).filter((k) => C.game.available(p, 'structure', k)).length + ['infantry', 'vehicle', 'air', 'naval'].filter((k) => C.game.has(p, BUILDING_FOR[k])).length;
      if (this.optCount != null && opts > this.optCount) this.announce('new_options', 'New construction options'); this.optCount = opts; }
    this.refreshGrid(false); this.selFrame();
    if (this.fc % 2 === 0) this.drawMinimap();
    if (C.game.over && !this.endShown && C.game.t - C.game.over.t > 3) this.endScreen();
  }
  onGameEvent(e) {
    const C = this.C, me = e.player === C.p.id;
    if (!me) return;
    const alert = (x, y, color) => { C.alerts.push({ x, y, t: C.game.t }); if (C.alerts.length > 20) C.alerts.shift(); this.ping(x, y, color); };
    switch (e.type) {
      case 'structure_ready': this.announce('construction_complete', 'Construction complete'); if (C.audio) C.audio.sfx('ui_ready'); if (this.tab !== 'structure') $('#tab-structure').classList.add('flash'); break;
      case 'unit_ready': { const u = C.world.byId.get(e.id); this.announce('unit_ready', 'Unit ready'); if (u) this.ping(u.x, u.y, '#7cf29a'); break; }
      case 'no_funds': this.announce('insufficient_funds', 'Insufficient funds'); break;
      case 'low_power': this.announce('low_power', 'Low power'); break;
      case 'under_attack': if (e.building) { this.announce('base_under_attack', 'Our base is under attack'); alert(e.x, e.y, '#ff4a3d'); } else if (e.harvester) { this.announce('harvester_under_attack', 'Our harvester is under attack'); alert(e.x, e.y, '#ffb35a'); } else alert(e.x, e.y, '#ff8a6a'); break;
      case 'unit_lost': this.announce('unit_lost', 'Unit lost'); break;
      case 'structure_lost': this.announce('structure_lost', 'Structure lost'); alert(e.x, e.y, '#ff4a3d'); break;
      case 'cannot_place': this.toast(e.reason || 'Cannot deploy here'); break;
      case 'engineer_repair': { const b = C.world.byId.get(e.id); this.toast(`${b ? b.name : 'Structure'} repaired by engineer`); this.ping(e.x, e.y, '#f2c230'); if (C.audio) C.audio.sfx('ui_ready'); break; }
      case 'built': if (C.input.place == null) this.refreshGrid(true); break;
      default: break;
    }
    if (e.type === 'game_over' || e.type === 'defeated') { /* handled by endScreen */ }
  }
  drawMinimap() {
    const C = this.C, g = this.mmg, S = this.mm.width, k = S / C.T.W, W = C.world, now = performance.now();
    g.drawImage(this.mmBase, 0, 0, S, S); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, S, S);
    const X = (x) => x * k, Y = (y) => S - y * k;
    if (C.game.ore) { g.fillStyle = '#e8b53a'; const s = Math.max(1.5, 4 * k), m = C.game.ore.E.min_patch; for (const F of C.game.ore.fields) for (const c of F.cells) if (c.amt >= m) { const z = s * (0.5 + 0.5 * Math.sqrt(c.amt / c.max)); g.fillRect(X(c.x) - z / 2, Y(c.y) - z / 2, z, z); } }   // ore patches
    for (const b of W.buildings) { if (!b.alive) continue; g.fillStyle = hex(TEAM_COLORS[b.team % 4]); g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.fillRect(X(b.x - b.w / 2), Y(b.y + b.d / 2), Math.max(3, b.w * k), Math.max(3, b.d * k)); g.strokeRect(X(b.x - b.w / 2), Y(b.y + b.d / 2), Math.max(3, b.w * k), Math.max(3, b.d * k)); }
    for (const u of W.units) { if (!u.alive || u.hidden) continue; if (u.team !== C.p.team && !W.visible(C.p.team, u)) continue;
      const sel = C.sel.has(u.id); g.fillStyle = sel ? '#ffffff' : hex(TEAM_COLORS[u.team % 4]); const r = u.kind === 'foot' ? 1.2 : u.kind === 'ship' ? 2.4 : 1.8; g.fillRect(X(u.x) - r, Y(u.y) - r, r * 2, r * 2); }
    const fp = C.rcam.footprint(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2; g.beginPath(); fp.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.stroke();
    this.pings = this.pings.filter((p) => now - p.t < 2400);
    for (const p of this.pings) { const a = (now - p.t) / 800; for (let r = 0; r < 3; r++) { const f = a - r * 0.25; if (f < 0 || f > 1.2) continue; g.strokeStyle = p.color; g.globalAlpha = Math.max(0, 1 - f); g.lineWidth = 2; g.beginPath(); g.arc(X(p.x), Y(p.y), 4 + f * 16, 0, 6.283); g.stroke(); } }
    g.globalAlpha = 1;
  }
  // ───────── in-world HUD (2D overlay) ─────────
  drawHud() {
    const C = this.C, g = this.g, I = C.input; g.clearRect(0, 0, innerWidth, innerHeight); if (!C.P) return;
    const team = (t) => hex(TEAM_COLORS[t % 4]);
    for (const [id, v] of C.P.views) {
      const u = v.u; if (!u.alive || u.hidden || !v.group.visible) continue; const sel = C.sel.has(id), hov = I.hover === id;
      const dmg = u.hp < u.maxHp - 0.5; if (!sel && !hov && !dmg) continue;
      const pos = v.group.position, ppm = I.pxPerM(pos); if (!sel && ppm < 0.9 && !hov) continue;
      const vs = v.vs || 1, top = I.proj(pos.clone().add(new THREE.Vector3(0, u.sp.dimensions_m.height * vs + (u.kind === 'foot' ? 0.4 : 1.0), 0))); if (!top) continue;
      // bars and rings follow the drawn size; bars never shrink below 28 px so the pips stay countable when zoomed out
      const bw = Math.max(u.kind === 'foot' ? 22 : 30, Math.min(64, Math.max(u.sp.dimensions_m.length, 2.5) * vs * ppm * 0.9)), f = u.hp / u.maxHp, segs = Math.max(4, Math.min(10, Math.round(bw / 6)));
      if (sel) { const b = I.proj(pos); if (b) { const r = Math.max(10, (u.kind === 'foot' ? 0.8 : u.sp.dimensions_m.length * 0.55) * vs * ppm); g.strokeStyle = u.team === C.p.team ? 'rgba(140,255,170,0.95)' : 'rgba(255,120,110,0.95)'; g.lineWidth = 2; g.beginPath(); g.ellipse(b[0], b[1], r, r * 0.55, 0, 0, 6.283); g.stroke(); } }
      if (sel || dmg || hov) {   // segmented health bar (RA2 pips)
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(top[0] - bw / 2 - 1, top[1] - 1, bw + 2, 6);
        const col = f > 0.6 ? '#62d48a' : f > 0.3 ? '#f2c14e' : '#ff6b5e', sw = bw / segs; g.fillStyle = col;
        for (let s = 0; s < segs; s++) { const fill = Math.max(0, Math.min(1, f * segs - s)); if (fill > 0) g.fillRect(top[0] - bw / 2 + s * sw, top[1], sw * fill - (fill === 1 ? 1 : 0), 4); }
        g.fillStyle = team(u.team); g.fillRect(top[0] - bw / 2 - 4, top[1] - 1, 3, 6);
        if (u.rank) { g.fillStyle = '#f2c14e'; g.font = '700 10px "Barlow Condensed", sans-serif'; g.fillText(u.rank === 2 ? '◆◆' : '◆', top[0] + bw / 2 + 3, top[1] + 5); }
        if (sel) { for (const [n, ids] of Object.entries(C.groups)) if (ids.includes(id)) { g.fillStyle = '#e8eef3'; g.font = '700 10px "Barlow Condensed", sans-serif'; g.fillText(n, top[0] - bw / 2 - 12, top[1] + 5); break; } }
        if (u.emp) { g.fillStyle = '#6fe6d4'; g.font = '700 10px "Barlow Condensed", sans-serif'; g.fillText('EMP', top[0] + bw / 2 + 3, top[1] - 3); }
      }
      // queued waypoints and rally lines for selected own units
      if (sel && u.team === C.p.team && u.queue && u.queue.length) { let a = I.proj(pos); g.strokeStyle = 'rgba(124,242,154,0.7)'; g.setLineDash([4, 4]); g.lineWidth = 1;
        const pts = [u.order.x != null ? [u.order.x, u.order.y] : null, ...u.queue.map((q) => [q.x, q.y])].filter((q) => q && q[0] != null);
        for (const q of pts) { const b = I.proj(new THREE.Vector3(q[0], Math.max(C.T.surface(q[0], q[1]), 0) + 0.3, -q[1])); if (a && b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.fillStyle = 'rgba(124,242,154,0.9)'; g.fillRect(b[0] - 2, b[1] - 2, 4, 4); } a = b; } g.setLineDash([]); }
    }
    // structures: health when damaged or selected, rally line when selected
    for (const [, sv] of C.P.structs) {
      const b = sv.b; if (!b.alive) continue; const sel = C.sel.has(b.id); if (!sel && b.hp >= b.maxHp && !b.repairing) continue;
      const top = I.proj(new THREE.Vector3(b.x, b.z + sv.h + 3, -b.y)); if (!top) continue; const bw = 64, f = b.hp / b.maxHp;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(top[0] - bw / 2 - 1, top[1] - 1, bw + 2, 6); g.fillStyle = f > 0.6 ? '#62d48a' : f > 0.3 ? '#f2c14e' : '#ff6b5e'; g.fillRect(top[0] - bw / 2, top[1], bw * f, 4);
      if (b.repairing && b.team === C.p.team) drawWrench(g, top[0], top[1] - 16, b.repairStalled ? '#ff6b5e' : '#f2c230', b.repairStalled ? 0 : performance.now() / 1000);
      if (sel) { const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => I.proj(new THREE.Vector3(b.x + sx * b.w / 2, b.z + 0.5, -(b.y + sy * b.d / 2)))); g.strokeStyle = b.team === C.p.team ? 'rgba(140,255,170,0.95)' : 'rgba(255,120,110,0.95)'; g.lineWidth = 1.5;
        for (const q of c) if (q) { g.beginPath(); g.arc(q[0], q[1], 3, 0, 6.283); g.stroke(); }
        if (b.rally && b.team === C.p.team) { const a = I.proj(new THREE.Vector3(b.x, b.z + 2, -b.y)), r = I.proj(new THREE.Vector3(b.rally[0], Math.max(C.T.surface(b.rally[0], b.rally[1]), 0) + 0.5, -b.rally[1])); if (a && r) { g.strokeStyle = 'rgba(242,232,109,0.85)'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(r[0], r[1]); g.stroke(); g.setLineDash([]); g.fillStyle = '#f2e86d'; g.fillRect(r[0] - 1, r[1] - 14, 2, 14); g.fillRect(r[0] + 1, r[1] - 14, 8, 5); } } }
    }
    if (I.box) { const [a, b] = I.box; g.strokeStyle = 'rgba(140,255,170,0.95)'; g.fillStyle = 'rgba(140,255,170,0.08)'; g.lineWidth = 1; const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]); g.fillRect(x, y, w, h); g.strokeRect(x + 0.5, y + 0.5, w, h); }
    if (I.place && I.place.c && !I.place.c.ok) { g.font = '600 13px "Barlow Condensed", sans-serif'; g.fillStyle = '#ffb0a8'; g.fillText(I.place.c.reason, I.mouse.x + 16, I.mouse.y + 24); }
    if (C.showFps) { const s = C.stats(); g.font = '12px "JetBrains Mono", monospace'; g.fillStyle = '#d6dde4'; g.fillText(`${s.fps.toFixed(0)} fps · ${s.calls} draws · ${(s.tris / 1e6).toFixed(2)} M tris · sim ${s.tickAvg.toFixed(2)} ms`, 12, innerHeight - 12); }
  }

  // ───────── start and end screens ─────────
  static startScreen(C, start) {
    const box = $('#start'); box.hidden = false; let fac = (C.saved && C.saved.fac) || 'compact', ai = 'random';
    const cards = $('#facCards'); cards.innerHTML = '';
    for (const [k, F] of Object.entries(FACTIONS)) {
      const roster = ['infantry', 'vehicle', 'air', 'naval'].flatMap((c) => F[c]).filter((u) => u !== 'HV').map((u) => C.specRaw.units.find((x) => x.id === u)).filter(Boolean);
      const b = el('button', 'fac', `<img alt="" src="${(C.cameos || {})[F.vehicle[0]] || ''}"><b>${F.name}</b><em>${F.theme}</em><small>${roster.map((s) => s.name).join(' · ')}</small>`);
      b.style.setProperty('--c', F.color); b.dataset.f = k; b.onclick = () => { fac = k; for (const x of cards.children) x.classList.toggle('on', x.dataset.f === k); }; cards.appendChild(b);
    }
    for (const x of cards.children) x.classList.toggle('on', x.dataset.f === fac);
    const aiSel = $('#aiFac'); aiSel.innerHTML = `<option value="random">Random</option>` + Object.entries(FACTIONS).map(([k, F]) => `<option value="${k}">${F.name}</option>`).join('');
    const lv = $('#aiLevel'); lv.value = (C.saved && C.saved.lv) || 'normal';
    const gs = $('#startGs'); gs.value = C.pace.game_speed; $('#startGsV').textContent = `${(+gs.value).toFixed(1)}×`; gs.oninput = () => { $('#startGsV').textContent = `${(+gs.value).toFixed(1)}×`; };
    $('#btnStart').onclick = () => {
      ai = aiSel.value === 'random' ? Object.keys(FACTIONS).filter((k) => k !== fac)[Math.floor(Math.random() * 2)] : aiSel.value; C.pace.game_speed = +gs.value;
      C.saved = Object.assign({}, C.saved || {}, { fac, gs: +gs.value, lv: lv.value }); try { localStorage.setItem('thunderhead.settings', JSON.stringify(C.saved)); } catch (e) { /* ignore */ }
      box.hidden = true; start({ faction: fac, ai, level: lv.value });
    };
    if (C.Q.has('autostart')) box.hidden = true;
  }
  endScreen() {
    const C = this.C; this.endShown = true; const win = C.game.over.team != null ? C.game.over.team === C.p.team : C.game.over.winner === C.p.id; const box = $('#end');
    this.announce(win ? 'mission_accomplished' : 'mission_failed', win ? 'Mission accomplished' : 'Mission failed');
    const st = C.p.stats, t = C.game.t; box.querySelector('h2').textContent = win ? 'Victory' : 'Defeat'; box.classList.toggle('win', win);
    box.querySelector('.stats').innerHTML = `<div><span>Game time</span><b>${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</b></div><div><span>Structures built</span><b>${st.built}</b></div><div><span>Units lost</span><b>${st.lostUnits}</b></div><div><span>Enemy units lost</span><b>${C.enemy.stats.lostUnits}</b></div><div><span>Ore harvested</span><b>$${fmt(st.harvested)}</b></div>`;
    box.hidden = false; $('#endWatch').onclick = () => { box.hidden = true; }; $('#endAgain').onclick = () => location.reload();
  }
}
