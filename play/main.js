// Thunderhead Stage 2 client: Emerald Strait, 1v1 against the AI. Boots the map, models and the match, then runs the loop:
// fixed 30 Hz simulation ticks at the game speed (default 2.4×, data/pace.json), interpolated rendering every frame.
import * as THREE from 'three';
import { TICK, MECH } from './engine/mech.js';
import { harvesterSandboxSpeed } from './engine/pace.js';
import { loadMapData } from './mapdata.js';
import { buildMapView, addMapLighting, MAP_QUALITY } from './maprender.js';
import { createMatch, stepMatch, applyMapping, addEngineers, ENGINEERS } from './setup.js';
import { loadUnitProtos, loadBuildingProtos, makeEngineerProto } from './assets.js';
import { Presenter } from './present.js';
import { RTSCamera } from './camera.js';
import { FACTIONS, STRUCTURES } from './rules.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { makeCameos } from './cameos.js';

const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const C = window.__game = { ready: false, started: false, errors: [], frames: [], tickMs: [], acks: [], Q };
addEventListener('error', (e) => C.errors.push(String(e.message || e)));
addEventListener('unhandledrejection', (e) => C.errors.push(String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
let Audio = null;

async function boot() {
  const prog = (t, f) => { $('#loadBar').style.width = `${Math.round(f * 100)}%`; $('#loadText').textContent = t; };
  prog('Loading map', 0.02);
  try { Audio = (await import('./audio.js')).Audio; } catch (e) { C.errors.push('audio: ' + e.message); }
  const [specRaw, mapping, paceFile, geom, combat] = await Promise.all(['data/unit_specs.json', 'data/faction_mapping.json', 'data/pace.json', 'data/sockets.json', 'data/combat.json'].map((u) => fetch(u).then((r) => r.json())));
  C.combat = combat; if (C.saved && isFinite(C.saved.ttk)) combat.ttk_scale = C.saved.ttk;
  C.specRaw = addEngineers(applyMapping(specRaw, mapping)); C.paceFile = paceFile; C.geom = geom; C.mapping = mapping;
  const pace = C.pace = structuredClone(paceFile);
  try { const sv = JSON.parse(localStorage.getItem('thunderhead.settings') || 'null'); if (sv) C.saved = sv; } catch (e) { /* storage unavailable */ }
  if (C.saved && isFinite(C.saved.gs)) pace.game_speed = C.saved.gs; if (C.saved && isFinite(C.saved.hr)) pace.harvester_speed_ratio = C.saved.hr;
  C.unitScale = Q.has('us') ? +Q.get('us') : C.saved && isFinite(C.saved.us) ? C.saved.us : 1.75;
  if (Q.has('gs')) pace.game_speed = +Q.get('gs');
  const T = C.T = await loadMapData('maps/01/');
  // renderer (ACES, sRGB, PCF soft shadows: the map shaders expect them)
  const quality = C.quality = Q.get('quality') || (C.saved && C.saved.quality) || 'medium', QP = MAP_QUALITY[quality] || MAP_QUALITY.medium;
  const renderer = C.renderer = new THREE.WebGLRenderer({ canvas: $('#view'), antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('shots') });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.enabled = QP.shadows;
  renderer.setPixelRatio(Q.has('dpr') ? +Q.get('dpr') : QP.pixelRatio(devicePixelRatio)); renderer.setSize(innerWidth, innerHeight, false);
  const scene = C.scene = new THREE.Scene(); const camera = C.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 4000);
  C.light = addMapLighting(THREE, scene, renderer, T, { quality });
  prog('Building terrain', 0.08);
  // the base kits and demo units in the map are not drawn (players build their own bases); the docks stay as piers
  const exclude = (name, r) => name.startsWith('unit_') || ((r[5] || 0) !== 0 && name !== 'bld_naval_dock');
  C.mapView = await buildMapView({ THREE, scene, renderer, T, assetBase: 'assets/map/', exclude, quality, minimapSize: 512, onProgress: (st, f) => prog(st === 'assets' ? 'Loading map models' : 'Building terrain', 0.08 + f * 0.5) });
  prog('Loading units', 0.6);
  const uids = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A03', 'A04', 'A05', 'T01', 'T02', 'T03', 'T04', 'T05', 'HV']; let nu = 0;
  const U = await loadUnitProtos(uids, 'assets/units/', C.specRaw.units.concat([{ id: 'HV', dimensions_m: { length: 10, width: 4, height: 4 } }]), () => prog('Loading units', 0.6 + 0.25 * (++nu / uids.length)));
  C.protos = U.protos; C.errors.push(...U.errors);
  for (const [id, E] of Object.entries(ENGINEERS)) if (C.protos[E.base]) C.protos[id] = makeEngineerProto(C.protos[E.base]);
  const bnames = [...new Set(Object.values(STRUCTURES).map((s) => s.model).filter((m) => m.startsWith('bld_')))].concat(['prop_gantry_crane']);
  const B = await loadBuildingProtos(bnames, 'assets/map/', () => prog('Loading structures', 0.9)); C.bprotos = B.protos; C.errors.push(...B.errors);
  prog('Preparing', 0.96);
  try { C.cameos = makeCameos(renderer, C.protos, C.bprotos, C.specRaw); } catch (e) { C.errors.push('cameos: ' + e.message); C.cameos = {}; }
  C.rcam = new RTSCamera(camera, T); C.rcam.viewRight = 268;
  addEventListener('resize', resize); resize();
  $('#loading').hidden = true; C.ready = true;
  UI.startScreen(C, start);
  if (Q.has('autostart')) start({ faction: Q.get('faction') || 'compact', ai: Q.get('ai') || 'lattice', spectate: Q.has('spectate') });
  C.last = performance.now(); requestAnimationFrame(frame);
}
function resize() { const r = C.renderer; r.setSize(innerWidth, innerHeight, false); C.camera.aspect = innerWidth / innerHeight; C.camera.updateProjectionMatrix(); if (C.ui) C.ui.resize(); }

/** start a match: { faction, ai, spectate } */
function start(opt) {
  if (C.started) return; C.started = true;
  if (Audio) { try { Audio.init(); C.audio = Audio; } catch (e) { C.errors.push('audio init: ' + e.message); } }
  const pace = C.pace, players = [{ faction: opt.faction, pad: 'B1', isAI: !!opt.spectate, name: 'You' }, { faction: opt.ai, pad: 'R1', isAI: true, name: FACTIONS[opt.ai].name }];
  const M = C.M = createMatch({ T: C.T, spec: C.specRaw, geom: C.geom, pace, players, combat: C.combat });
  C.world = M.world; C.game = M.game; C.p = M.game.players[0]; C.enemy = M.game.players[1]; C.spec = M.world.spec;
  C.P = new Presenter({ scene: C.scene, camera: C.camera, T: C.T, world: C.world, game: C.game, protos: C.protos, bprotos: C.bprotos, playerTeam: C.p.team, audio: C.audio });
  C.P.unitScale = C.unitScale; C.P.afterStep(); C.world.events.length = 0;   // views for the starting yard and squad
  C.seq = 0; C.acc = 0; C.paused = false; C.sel = new Set(); C.groups = {}; C.alerts = [];
  const y = C.world.byId.get(C.p.yard); C.rcam.setFocus(y.x + (C.T.W / 2 - y.x) * 0.05, y.y + (C.T.H / 2 - y.y) * 0.05); C.rcam.dist = C.rcam.distT = 165; C.rcam.fz = y.z;
  C.ui = new UI(C); C.input = new Input(C);
  C.setPace = setPace; setPace({});
  C.ui.toast(`${FACTIONS[C.p.faction].name} vs ${FACTIONS[C.enemy.faction].name} · Emerald Strait`);
}
function setPace(o) {
  const P = C.pace; if (o.game_speed != null) P.game_speed = +o.game_speed; if (o.harvester_speed_ratio != null) P.harvester_speed_ratio = +o.harvester_speed_ratio;
  if (C.world) C.world.setHarvesterSpeed(harvesterSandboxSpeed(P));
  if (o.unit_scale != null) { C.unitScale = +o.unit_scale; if (C.P) C.P.setUnitScale(C.unitScale); }
  if (o.ttk != null) { C.combat.ttk_scale = +o.ttk; if (C.world) C.world.dmgScale = 1 / C.combat.ttk_scale; }
  try { localStorage.setItem('thunderhead.settings', JSON.stringify({ gs: P.game_speed, hr: P.harvester_speed_ratio, ttk: C.combat.ttk_scale, us: C.unitScale, quality: C.quality, vol: C.vol })); } catch (e) { /* ignore */ }
  if (C.ui) C.ui.paceChanged();
  return { game_speed: P.game_speed, harvester_speed_ratio: P.harvester_speed_ratio, harvester_mps: harvesterSandboxSpeed(P) };
}

// ───────── loop ─────────
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - C.last) / 1000; C.last = now; if (!(dt > 0)) dt = 0; if (dt > 0.25) dt = 0.25;
  if (C.manual) return;
  C.frames.push(dt * 1000); if (C.frames.length > 600) C.frames.shift();
  tick(dt); render();
}
function tick(dt) {
  if (!C.started) { C.rcam.update(dt); C.light.update(C.camera); C.mapView.update(C.camera, dt); return; }
  const t0 = performance.now(), gs = C.paused || C.game.over && C.game.t - C.game.over.t > 8 ? 0 : C.pace.game_speed;
  C.acc += dt * gs; let n = 0;
  while (C.acc >= TICK && n < 24) {
    const q = performance.now();
    try { stepMatch(C.M, TICK); C.P.afterStep(); } catch (e) { C.errors.push('step: ' + (e.stack || e.message)); }
    C.world.events.length = 0; C.acc -= TICK; n++; C.tickMs.push(performance.now() - q); if (C.tickMs.length > 900) C.tickMs.shift();
  }
  if (n === 24) C.acc = 0;
  const alpha = C.acc / TICK, rdt = dt * gs;
  C.rcam.shake.copy(C.P.shakeOff); C.rcam.update(dt);
  C.P.focus = { x: C.rcam.fx, y: C.rcam.fy }; C.P.viewH = C.rcam.dist;
  C.P.frame(dt, alpha, rdt);
  C.light.update(C.camera, new THREE.Vector3(C.rcam.fx, C.rcam.fz, -C.rcam.fy)); C.mapView.update(C.camera, dt);
  if (C.audio) try { C.audio.setListener(C.rcam.fx, C.rcam.fy, C.rcam.dist * Math.sin(C.rcam.el), Math.PI / 2); } catch (e) { /* optional */ }   // north-up view: screen right is +x
  C.ui.frame(dt); C.input.frame(dt);
  C.frameMs = performance.now() - t0;
}
function render() { C.renderer.render(C.scene, C.camera); if (C.ui) C.ui.drawHud(); }

// ───────── test clock and probes (Playwright) ─────────
C.advance = (sec, fps = 60, renderEvery = 0) => { C.manual = true; const n = Math.round(sec * fps); for (let i = 0; i < n; i++) { tick(1 / fps); if (renderEvery && i % renderEvery === 0) render(); } return C.stats(); };
C.renderNow = () => render();
C.screenOf = (x, y, z = null) => { const v = new THREE.Vector3(x, z == null ? Math.max(C.T.surface(x, y), 0) : z, -y).project(C.camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight, v.z]; };
C.unitScreen = (id) => { const v = C.P.views.get(id); if (!v) return null; const p = v.group.position.clone().add(new THREE.Vector3(0, Math.min(v.u.sp.dimensions_m.height * 0.5, 3), 0)).project(C.camera); return [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight]; };
/** tests: build a structure for the player now (pays, places at the nearest valid spot to (x, y) or the yard) */
C.testBuild = (kind, x, y) => { const G = C.game, p = C.p, b0 = C.world.byId.get(p.yard); if (!G.available(p, 'structure', kind)) return null; p.queues.structure.length = 0; p.ready = null; G.enqueue(p, 'structure', kind); const it = p.queues.structure[0]; p.credits -= it.cost - it.spent; it.spent = it.cost; p.ready = it;
  x = x ?? b0.x; y = y ?? b0.y; for (let r = 0; r < 260; r += 4) for (let a = 0; a < 24; a++) { const c = G.canPlace(p, kind, x + Math.cos(a / 24 * 6.283) * r, y + Math.sin(a / 24 * 6.283) * r); if (c.ok) { G.place(p, c.x, c.y); C.advance(0.2, 30, 0); return C.world.buildings[C.world.buildings.length - 1]; } }
  G.cancel(p, 'structure', kind); return null; };
C.lookAt = (x, y, dist) => { C.rcam.setFocus(x, y); if (dist) { C.rcam.dist = C.rcam.distT = dist; } C.rcam.fz = Math.max(C.T.surface(x, y), 0); C.rcam.update(0.016); C.camera.updateMatrixWorld(); };
C.stats = () => { const f = C.frames.slice(-300), s = [...f].sort((a, b) => a - b), tk = [...C.tickMs].sort((a, b) => a - b), info = C.renderer.info.render;
  return { fps: f.length ? 1000 / (f.reduce((a, b) => a + b, 0) / f.length) : 0, p95: s[Math.floor(s.length * 0.95)] || 0, tickAvg: C.tickMs.reduce((a, b) => a + b, 0) / Math.max(1, C.tickMs.length), tickP99: tk[Math.floor(tk.length * 0.99)] || 0,
    calls: info.calls, tris: info.triangles, units: C.world ? C.world.units.filter((u) => u.alive).length : 0, t: C.world ? C.world.t : 0, errors: C.errors, present: C.P ? C.P.stats : null, lod: C.P ? C.P.lodStats : null }; };

boot().catch((e) => { C.errors.push('boot: ' + (e.stack || e)); $('#loadText').textContent = 'Could not load the game: ' + e.message; console.error(e); });
export { C };
void MECH;
