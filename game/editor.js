/* Thunderhead map editor — paints terrain, ore, civilian buildings and start positions on the live map; saves to localStorage or JSON. Global out: EDITOR. */
const EDITOR = (() => {
'use strict';
const T_ = window.__T; const { RENDER, UI, S, startGame, gameConfig, buildMaps, customMaps } = T_; const { G, CELL, MAPW, MAPH, TT, idx, inMap, isStruct } = SIM;
const E = { tool: 'GRASS', size: 1, mirror: 'point', painting: false, last: null, bakeT: 0, panFrom: null, name: 'My map', theme: 'grass', dirty: false };
const TOOLS = [['GRASS', 'Grass'], ['ROCK', 'Rock'], ['SCRUB', 'Scrub'], ['WATER', 'Water'], ['SHORE', 'Shore'], ['BRIDGE', 'Bridge'], ['CLIFF', 'Cliff'], ['ROAD', 'Road'], ['ORE', 'Ore'], ['GEM', 'Cobalt'], ['NOORE', 'Clear ore'], ['civ_house', 'House'], ['civ_shop', 'Shop'], ['civ_tower', 'Tower'], ['civ_warehouse', 'Warehouse'], ['civ_derrick', 'Derrick'], ['START', 'Start point'], ['ERASE', 'Erase object']];
const $ = s => document.querySelector(s);
function open(mapKeyOrData) {
  const cfg = { players: [{ faction: 'compact', ai: false, team: 0 }, { faction: 'lattice', ai: false, team: 1 }, { faction: 'helix', ai: false, team: 2 }, { faction: 'compact', ai: false, team: 3 }], map: mapKeyOrData, seed: 11 };
  const me = SIM.newGame(cfg); UI.me = me; S.me = me; S.sel = []; UI.started = true; UI.editor = true; G.speed = 0;
  for (const e of G.ents) if (!e.dead && e.def.faction !== 'civ') { e.dead = true; G.byId.delete(e.id); if (isStruct(e.def)) for (let x = e.cx; x < e.cx + e.fw; x++) for (let y = e.cy; y < e.cy + e.fh; y++) if (G.occ[idx(x, y)] === e.id) G.occ[idx(x, y)] = -1; }
  E.theme = G.theme; E.name = typeof mapKeyOrData === 'object' ? mapKeyOrData.name : (SIM.MAPGEN.PRESETS[mapKeyOrData] ? SIM.MAPGEN.PRESETS[mapKeyOrData].name + ' (edited)' : 'My map');
  for (const p of G.players) p.vis.fill(2);
  RENDER.bakeTerrain(); RENDER.updateFog(); S.cam.zoom = 0.9; RENDER.centerOn(MAPW * CELL / 2, MAPH * CELL / 2);
  $('#start').hidden = true; $('#end').hidden = true; $('#hud').hidden = true; panel(); $('#editor').hidden = false; drawStarts();
}
function close() { UI.editor = false; UI.started = false; $('#editor').hidden = true; $('#start').hidden = false; drawStartsClear(); buildMaps(); }
function panel() {
  const el = $('#editor'); el.innerHTML = `<h2>Map editor</h2><input type="text" id="edname" value="${E.name.replace(/"/g, '&quot;')}"><div class="row"><label>Theme <select id="edtheme"><option value="grass">Grass</option><option value="desert">Desert</option><option value="urban">Urban</option></select></label><label>Mirror <select id="edmirror"><option value="none">None</option><option value="point">Point (2p)</option><option value="quad">Quad (4p)</option></select></label><label>Brush <select id="edsize"><option>1</option><option>2</option><option>3</option><option>5</option></select></label></div><div class="pal" id="edpal"></div><div class="row"><button id="edsave" class="primary">Save</button><button id="eddl">Copy JSON</button><button id="edload">Paste JSON</button></div><div id="edpaste" hidden><textarea id="edtext" rows="4" style="width:100%;border-radius:8px;border:1px solid var(--line);background:var(--ground);color:var(--ink);font:11px monospace"></textarea><div class="row"><button id="edtextload" class="primary">Load pasted map</button></div></div><div class="row"><button id="edplay" class="primary">Play this map</button><button id="ednew">Blank map</button><button id="edback">Back</button></div><p class="hint">Left-drag paints. Right-drag pans, wheel zooms. Start points: click to place the next one (up to 4); erase removes buildings and starts. Shore is the sandy ring that lets ships hug the coast. Saved maps appear on the start screen; Copy JSON gives you text you can send to someone, Paste JSON loads it.</p><p class="hint" id="edstatus"></p>`;
  const pal = $('#edpal'); for (const [k, label] of TOOLS) { const b = document.createElement('button'); b.textContent = label; b.dataset.tool = k; b.classList.toggle('on', k === E.tool); b.onclick = () => { E.tool = k; for (const o of pal.children) o.classList.toggle('on', o === b); }; pal.appendChild(b); }
  $('#edtheme').value = E.theme; $('#edtheme').onchange = () => { E.theme = G.theme = $('#edtheme').value; RENDER.bakeTerrain(); RENDER.updateFog(); };
  $('#edmirror').value = E.mirror; $('#edmirror').onchange = () => { E.mirror = $('#edmirror').value; }; $('#edsize').value = String(E.size); $('#edsize').onchange = () => { E.size = +$('#edsize').value; };
  $('#edname').oninput = () => { E.name = $('#edname').value; };
  $('#edsave').onclick = () => { const d = data(); const all = customMaps(); all[d.name] = d; try { localStorage.setItem('thunderhead.maps', JSON.stringify(all)); status(`Saved "${d.name}" (${Object.keys(all).length} custom maps).`); } catch (e) { status('Could not save: storage blocked.'); } };
  $('#eddl').onclick = () => { const txt = JSON.stringify(data()); const show = () => { $('#edpaste').hidden = false; $('#edtext').value = txt; $('#edtext').select(); status('Map JSON is in the box — copy it from there.'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => status('Map JSON copied to the clipboard. Paste it into a message or a file to share it.'), show); else show(); };
  $('#edload').onclick = () => { $('#edpaste').hidden = false; $('#edtext').value = ''; $('#edtext').focus(); status('Paste a map JSON into the box, then Load.'); };
  $('#edtextload').onclick = () => { try { const d = JSON.parse($('#edtext').value); if (!d.terrain) throw new Error('not a map'); open(d); status(`Loaded "${d.name}".`); } catch (err) { status('That is not a Thunderhead map.'); } };
  $('#edplay').onclick = () => { const d = data(); if (d.starts.length < 2) { status('Place at least two start points first.'); return; } UI.mapData = d; UI.pickMap = 'custom:' + d.name; UI.editor = false; $('#editor').hidden = true; drawStartsClear(); startGame(gameConfig()); };
  $('#ednew').onclick = () => { G.terrain.fill(TT.GRASS); G.ore.fill(0); G.oreKind.fill(0); for (const e of G.ents) if (!e.dead && e.def.faction === 'civ') removeEnt(e); G.starts = []; RENDER.bakeTerrain(); RENDER.updateFog(); drawStarts(); };
  $('#edback').onclick = close;
}
function status(t) { const s = $('#edstatus'); if (s) s.textContent = t; }
function data() { G.mapName = E.name; G.theme = E.theme; return SIM.MAPGEN.toData(G, MAPW, MAPH, idx, { name: E.name, theme: E.theme }); }
function removeEnt(e) { e.dead = true; G.byId.delete(e.id); if (isStruct(e.def)) for (let x = e.cx; x < e.cx + e.fw; x++) for (let y = e.cy; y < e.cy + e.fh; y++) if (inMap(x, y) && G.occ[idx(x, y)] === e.id) G.occ[idx(x, y)] = -1; }
function cellsFor(x, y) { const out = [[x, y]]; if (E.mirror === 'point') out.push([MAPW - 1 - x, MAPH - 1 - y]); if (E.mirror === 'quad') out.push([MAPW - 1 - x, y], [x, MAPH - 1 - y], [MAPW - 1 - x, MAPH - 1 - y]); return out.filter(([a, b]) => inMap(a, b)); }
function paint(cx, cy) {
  const t = E.tool; const r = Math.floor(E.size / 2);
  if (t === 'START') { G.starts = G.starts || []; if (G.starts.length >= 4) G.starts = []; G.starts.push({ x: cx - 1, y: cy - 1 }); drawStarts(); return; }
  if (t === 'ERASE') { const e = G.ents.find(o => !o.dead && isStruct(o.def) && cx >= o.cx && cx < o.cx + o.fw && cy >= o.cy && cy < o.cy + o.fh); if (e) removeEnt(e); else if (G.starts) { const i = G.starts.findIndex(s => Math.abs(s.x + 1 - cx) <= 2 && Math.abs(s.y + 1 - cy) <= 2); if (i >= 0) { G.starts.splice(i, 1); drawStarts(); } } return; }
  if (/^civ_/.test(t)) { if (E.last && E.last.x === cx && E.last.y === cy) return; const d = SIM.BY[t]; let ok = true; for (let x = cx; x < cx + d.foot[0]; x++) for (let y = cy; y < cy + d.foot[1]; y++) if (!inMap(x, y) || G.occ[idx(x, y)] !== -1 || G.terrain[idx(x, y)] === TT.WATER) ok = false; if (ok) { const b = SIM.spawn(t, G.neutral, cx, cy); b.occupants = []; } return; }
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const [x, y] of cellsFor(cx + dx, cy + dy)) { const i = idx(x, y); if (t === 'ORE') { G.ore[i] = 40; G.oreKind[i] = 1; } else if (t === 'GEM') { G.ore[i] = 30; G.oreKind[i] = 2; } else if (t === 'NOORE') { G.ore[i] = 0; } else { if (G.occ[i] !== -1 && TT[t] === TT.WATER) continue; G.terrain[i] = TT[t]; if (TT[t] === TT.WATER || TT[t] === TT.CLIFF) G.ore[i] = 0; } }
  E.dirty = true;
}
function drawStartsClear() { if (RENDER.setStarts) RENDER.setStarts([]); }
function drawStarts() { if (RENDER.setStarts) RENDER.setStarts(UI.editor ? (G.starts || []) : []); }
function pointer(kind, ev) {
  const cv = ev.currentTarget; const r = cv.getBoundingClientRect(); const w = RENDER.screenToWorld(ev.clientX - r.left, ev.clientY - r.top); const cx = Math.floor(w.x / CELL), cy = Math.floor(w.y / CELL);
  if (kind === 'down') { if (ev.button === 2 || ev.button === 1) { E.panFrom = { x: ev.clientX, y: ev.clientY, cx: S.cam.x, cy: S.cam.y }; return; } E.painting = true; E.last = null; if (inMap(cx, cy)) paint(cx, cy); E.last = { x: cx, y: cy }; }
  else if (kind === 'move') { if (E.panFrom) { S.cam.x = E.panFrom.cx - (ev.clientX - E.panFrom.x) / S.cam.zoom; S.cam.y = E.panFrom.cy - (ev.clientY - E.panFrom.y) / S.cam.zoom; RENDER.clampCam(); return; } if (E.painting && inMap(cx, cy) && !(E.last && E.last.x === cx && E.last.y === cy)) { paint(cx, cy); E.last = { x: cx, y: cy }; } }
  else { E.painting = false; E.panFrom = null; }
  if (E.dirty) { E.dirty = false; const now = performance.now(); if (now - E.bakeT > 120) { E.bakeT = now; RENDER.bakeTerrain(); RENDER.updateFog(); drawStarts(); } else { clearTimeout(E.bakeTimer); E.bakeTimer = setTimeout(() => { E.bakeT = performance.now(); RENDER.bakeTerrain(); RENDER.updateFog(); drawStarts(); }, 130); } }
}
return { open, close, pointer, E };
})();
if (window.__T) window.__T.EDITOR = EDITOR;
