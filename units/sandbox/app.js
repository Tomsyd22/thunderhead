// Unit Sandbox: renderer + input + scenarios around the pure simulation in mech.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeTerrain, FEATURES } from './terrain.js';
import { World, MECH, TICK } from './mech.js';
import { buildTerrain, buildWater, buildProps, buildStructure, buildSky, buildOreField } from './view_terrain.js';
import { FX } from './fx.js';
import { makeView, TEAM_COLORS } from './views.js';
import { loadPace, harvesterSandboxSpeed, harvestCycle } from './pace.js';
import { econLayout, HV_SPEC } from './econ.js';

const UIDS = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A02', 'A03', 'A04', 'A05', 'T01', 'T02', 'T03', 'T04', 'T05'];
const MODEL_FILE = { HV: 'unit_harvester' };   // the harvester uses the maps' model (+X forward; wrapped to the units' +Y-forward convention)
const BUILDING_MODELS = ['bld_ore_refinery', 'bld_extraction_rig'];
const $ = (s) => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpA = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const Q = new URLSearchParams(location.search);

const app = window.__sb = { ready: false, errors: [], frames: [], smooth: { jumps: 0, samples: 0, worst: 0, list: [] }, feet: { stances: 0, worst: 0, sum: 0, list: [] }, tracks: { worst: 0, samples: 0 } };
window.addEventListener('error', (e) => app.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason && e.reason.message || e.reason)));

async function boot() {
  const spec = await (await fetch('data/unit_specs.json')).json();
  let geom = {}; try { const r = await fetch('data/sockets.json'); if (r.ok) geom = await r.json(); } catch (e) { /* defaults */ }
  const T = makeTerrain(); app.T = T;
  // pace: one global game speed (uniform time scale) + harvester speed relative to the reference tank (data/pace.json)
  app.paceFile = await loadPace('data/pace.json'); const P = app.pace = structuredClone(app.paceFile);
  try { const sv = JSON.parse(localStorage.getItem('sandbox.pace') || 'null'); if (sv) { if (isFinite(sv.g)) P.game_speed = sv.g; if (isFinite(sv.r)) P.harvester_speed_ratio = sv.r; } } catch (e) { /* storage unavailable */ }
  if (Q.has('gs')) P.game_speed = +Q.get('gs'); if (Q.has('hr')) P.harvester_speed_ratio = +Q.get('hr');
  spec.units.push(HV_SPEC(harvesterSandboxSpeed(P))); MECH.HV.accel = P.harvester.accel_mps2; MECH.HV.hullTurn = P.harvester.hull_turn_dps;
  const E = econLayout(); app.econ = E;
  const buildings = [Object.assign({ name: 'Bunker', team: -1, garrison: true }, FEATURES.bunker), Object.assign({ name: 'Shore battery', team: 1, slots: 0 }, FEATURES.island_target), ...E.buildings];
  const world = new World({ spec, T, geom, buildings }); app.world = world; app.spec = spec; world.pace = P; world.econ = E;
  // renderer
  const canvas = $('#view'); const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('shots') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.has('dpr') ? +Q.get('dpr') : 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene(); app.scene = scene; app.renderer = renderer;
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.3, 3000); app.camera = camera;
  const controls = new MapControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = 1.35; controls.minDistance = 4; controls.maxDistance = 900; controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; app.controls = controls;
  camera.position.set(170, 95, -170 - 120); controls.target.set(170, 6, -230); controls.update();
  const sky = buildSky(scene, renderer); app.sun = sky.sun;
  buildTerrain(T, scene, Q.has('lowgfx') ? 0 : 1); if (Q.has('lowgfx')) { renderer.shadowMap.enabled = false; } app.water = buildWater(T, scene); buildProps(T, scene, world);
  app.structs = new Map(); for (const b of world.buildings) if (!b.model) { const g = buildStructure(b, T); scene.add(g); app.structs.set(b.id, g); }
  for (const d of E.deposits) scene.add(buildOreField(d, T));
  app.fx = new FX(scene, T);
  // models
  // image-based fill for the units' PBR materials: without it metal (helmets, guns, armour) has nothing to reflect and reads black on the shade side
  const pmrem = new THREE.PMREMGenerator(renderer); const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture; pmrem.dispose(); app.envTex = envTex;
  const useEnv = (root) => root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !/^(GLOW|DISC)/.test(m.name || '')) { m.envMap = envTex; m.envMapIntensity = 0.6; } });
  const loader = new GLTFLoader(); app.protos = {};
  await Promise.all([...UIDS, 'HV'].map(async (uid) => {
    try { const g = await loadGltfJson(loader, `assets/${MODEL_FILE[uid] || uid}.gltf.json`); let skinned = false; g.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; }); useEnv(g.scene);
      let root = g.scene; if (MECH[uid] && MECH[uid].modelFwd === 'x') { root = new THREE.Group(); g.scene.rotation.y = Math.PI / 2; root.add(g.scene); }   // +X-forward asset → units' +Y-forward
      app.protos[uid] = { scene: root, isSkinned: skinned, lods: [] };
      for (const lv of [1, 2]) { try { const gl = await loadGltfJson(loader, `assets/${uid}_lod${lv}.gltf.json`); app.protos[uid].lods.push(gl.scene); } catch (e) { break; } } }   // distant-view levels (optional)
    catch (e) { app.errors.push(`model ${uid}: ${e.message || e}`); const s = spec.units.find((x) => x.id === uid).dimensions_m; const grp = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(s.width, s.height, s.length), new THREE.MeshStandardMaterial({ color: 0x888888 })); m.position.y = s.height / 2; grp.add(m); app.protos[uid] = { scene: grp, isSkinned: false }; }
  }));
  // economy buildings: the maps' refinery and extraction rig models, placed on their pads
  await Promise.all(BUILDING_MODELS.map(async (name) => { try { const g = await loadGltfJson(loader, `assets/${name}.gltf.json`); useEnv(g.scene); app.protos[name] = { scene: g.scene }; } catch (e) { app.errors.push(`model ${name}: ${e.message || e}`); } }));
  for (const b of world.buildings) if (b.model && app.protos[b.model]) { const g = app.protos[b.model].scene.clone(true); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.position.set(b.x, b.z, -b.y); g.rotation.y = b.rot || 0; scene.add(g); app.structs.set(b.id, g); }
  app.manual = Q.has('manual'); app.views = new Map(); app.snap = new Map(); app.projV = new Map(); app.selected = new Set(); app.speed = 1; app.simTime = 0; app.mode = 'select'; app.team = 0; app.faction = 'H';
  app.show = { ranges: false, shapes: false, paths: false, bars: true }; app.cam = 'free';
  setupUI(); setupInput(canvas);
  app.hud = $('#hud'); app.hudCtx = app.hud.getContext('2d'); resize(); addEventListener('resize', resize);
  app.debug = new THREE.Group(); scene.add(app.debug);
  $('#loading').style.display = 'none';
  const sc = Q.get('scenario') || 'tour'; scenario(sc);
  app.ready = true; app.last = performance.now(); requestAnimationFrame(frame);
}

// The .gltf.json files embed their binary buffer as base64. Rather than letting the loader fetch a data: URI (refused by
// strict content-security policies), rebuild an in-memory GLB from the JSON + decoded buffer and parse that.
async function loadGltfJson(loader, url) {
  const js = await (await fetch(url)).json(); let bin = new Uint8Array(0);
  if (js.buffers && js.buffers[0] && js.buffers[0].uri && js.buffers[0].uri.startsWith('data:')) {
    const b64 = js.buffers[0].uri.slice(js.buffers[0].uri.indexOf(',') + 1); const raw = atob(b64); bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i); delete js.buffers[0].uri;
  }
  const enc = new TextEncoder().encode(JSON.stringify(js)); const jl = (enc.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const glb = new Uint8Array(12 + 8 + jl + (bl ? 8 + bl : 0)); const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); glb.set(enc, 20); for (let i = enc.length; i < jl; i++) glb[20 + i] = 0x20;
  if (bl) { dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004E4942, true); glb.set(bin, 28 + jl); }
  return new Promise((res, rej) => loader.parse(glb.buffer, '', res, rej));
}

function resize() { const r = app.renderer; r.setSize(innerWidth, innerHeight); app.camera.aspect = innerWidth / innerHeight; app.camera.updateProjectionMatrix(); const d = Math.min(devicePixelRatio, 2); app.hud.width = innerWidth * d; app.hud.height = innerHeight * d; app.hud.style.width = innerWidth + 'px'; app.hud.style.height = innerHeight + 'px'; app.hudCtx.setTransform(d, 0, 0, d, 0, 0); }

// ───────── simulation bridge ─────────
function snapshot(u) {
  return { x: u.x, y: u.y, z: u.z, hdg: u.hdg, turret: u.turret, pitch: u.pitch, aaYaw: u.aaYaw, aaPitch: u.aaPitch, podYaw: u.podYaw, gimbal: u.gimbal, gimbalPitch: u.gimbalPitch,
    trackL: u.trackL, trackR: u.trackR, stride: u.stride, v: u.v, vx: u.vx, vy: u.vy, w: u.w, accelF: u.accelF, accelS: u.accelS, climb: u.climb || 0, gear: u.jet ? u.jet.gear : null,
    deploy: u.deploy, target: u.target, path: !!u.path, order: u.order.type, hidden: u.hidden, alive: u.alive, loading: !!u.loading, harv: u.harv ? u.harv.state : null };
}
function interp(a, b, t) {
  const o = Object.assign({}, b);
  for (const k of ['x', 'y', 'z', 'trackL', 'trackR', 'stride', 'v', 'vx', 'vy', 'w', 'accelF', 'accelS', 'climb', 'pitch', 'aaPitch', 'gimbalPitch', 'podYaw']) if (typeof a[k] === 'number' && typeof b[k] === 'number') o[k] = lerp(a[k], b[k], t);
  if (a.gear != null && b.gear != null) o.gear = lerp(a.gear, b.gear, t);
  for (const k of ['hdg', 'turret', 'aaYaw', 'gimbal']) o[k] = lerpA(a[k], b[k], t);
  return o;
}
function spawn(uid, team, x, y, opts = {}) {
  const w = app.world; let o = Object.assign({}, opts);
  if (uid === 'A04' && !o.pad && !o.airborne) { const used = new Set(w.units.filter((q) => q.alive && q.jet && q.jet.pad).map((q) => q.jet.pad)); const pad = FEATURES.airfield.pads.find((p) => !used.has(p)); if (pad) { o.pad = pad; x = pad.x; y = pad.y; o.hdg = pad.hdg; } else o.airborne = true; }
  const u = w.spawn(uid, team, x, y, o); const v = makeView(app, u, app.protos[uid]); app.views.set(u.id, v); const s = snapshot(u); app.snap.set(u.id, { prev: s, cur: s }); return u;
}
app.spawn = spawn;
function stepSim() {
  const w = app.world; for (const [id, s] of app.snap) s.prev = s.cur;
  const t0 = performance.now(); w.step(); app.simMs = (app.simMs || 0) * 0.95 + (performance.now() - t0) * 0.05;
  for (const u of w.units) { const s = app.snap.get(u.id); if (s) s.cur = snapshot(u); }
  for (const e of w.events) handleEvent(e); w.events.length = 0;
  if (app.timers && app.timers.length) { const due = app.timers.filter((x) => x.t <= w.t); app.timers = app.timers.filter((x) => x.t > w.t); for (const x of due) x.fn(); }
  // projectile snapshots
  const live = new Set();
  for (const p of w.proj) { live.add(p); let v = app.projV.get(p); if (!v) { v = makeProj(p); app.projV.set(p, v); } v.prev = v.cur || [p.x, p.y, p.z]; v.cur = [p.x, p.y, p.z]; }
  for (const [p, v] of app.projV) if (!live.has(p)) { app.scene.remove(v.mesh); app.projV.delete(p); }
}
const PROJ_GEO = { shell: new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6).rotateX(Math.PI / 2), missile: new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8).rotateX(Math.PI / 2), bomb: new THREE.CapsuleGeometry(0.17, 0.85, 4, 8).rotateX(Math.PI / 2) };
const PROJ_MAT = { shell: new THREE.MeshBasicMaterial({ color: 0xffd28a }), cyan: new THREE.MeshBasicMaterial({ color: 0x9ffcf2 }), missile: new THREE.MeshStandardMaterial({ color: 0xcfd2d4, metalness: 0.4, roughness: 0.4 }), atBlue: new THREE.MeshStandardMaterial({ color: 0x24375a, metalness: 0.4, roughness: 0.45 }), bomb: new THREE.MeshStandardMaterial({ color: 0x4d5257, metalness: 0.5, roughness: 0.5 }) };
function makeProj(p) {
  const cyan = p.uid && (p.uid[0] === 'T'); const k = p.kind === 'bomb' ? 'bomb' : p.kind === 'shell' ? 'shell' : 'missile';
  // per-sheet looks: T02 lance bolt = glowing cyan slug; A02 AT missile = dark-blue body; everything else by kind
  const bolt = p.uid === 'T02'; const mat = bolt ? PROJ_MAT.cyan : k === 'shell' ? (cyan ? PROJ_MAT.cyan : PROJ_MAT.shell) : (p.uid === 'A02' && p.w && p.w.name.includes('anti-tank') ? PROJ_MAT.atBlue : PROJ_MAT[k]);
  const mesh = new THREE.Mesh(bolt ? PROJ_GEO.shell : PROJ_GEO[k], mat); mesh.castShadow = k !== 'shell' && !bolt;
  if (k === 'missile' && p.uid === 'A05') mesh.scale.set(1.6, 1.6, 2.2); if (k === 'missile' && p.uid === 'T05') mesh.scale.set(1.2, 1.2, 1.0); if (p.uid === 'H04') mesh.scale.set(1.1, 1.1, 0.7);
  app.scene.add(mesh); const v = { mesh, p, kind: k, cyan, born: app.world.t, off: null, trailAcc: 0 };
  // visual muzzle offset → blended out over 0.15 s so shots leave the barrel model
  const view = app.views.get(p.owner); if (view && p.kind !== 'bomb') { const mz = view.lastMuzzle; if (mz) v.off = new THREE.Vector3(mz.x - p.x, mz.y - p.z, mz.z + p.y); }
  return v;
}
function handleEvent(e) {
  const w = app.world, fx = app.fx; const view = e.id != null ? app.views.get(e.id) : null;
  if (view) view.onEvent(e);
  if (e.type === 'fire' && view) {
    const u = view.u; const names = muzzleNames(u, e); let mz = null; for (const n of names) if (view.N[n]) { mz = view.sock(n); break; }
    if (!mz) mz = new THREE.Vector3(e.x, e.z, -e.y); view.lastMuzzle = mz;
    const tp = new THREE.Vector3(e.tx, e.tz, -e.ty); const dir = tp.clone().sub(mz).normalize();
    const kind = u.kind === 'tracked' || u.kind === 'hover' ? 'cannon' : u.uid === 'H05' ? 'naval' : (u.uid === 'T01' || u.uid === 'T04' || u.uid === 'T02') ? 'pulse' : (u.kind === 'ship' || u.uid === 'H02' || u.uid === 'A02' || u.uid === 'H04') ? 'rocket' : 'rifle';
    fx.muzzle(mz, dir, kind);
    const W = u.sp.weapons[e.w];
    if (W.kind === 'hitscan') {
      const jit = new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3); const end = tp.clone().add(jit);
      if (kind === 'pulse') fx.seg(mz, end, [0.4, 1, 0.95], u.uid === 'T04' ? 0.05 : 0.08, { travel: 0.35 });
      else if (e.tracer) fx.seg(mz, end, [1, 0.7, 0.3], u.uid === 'A01' ? 0.06 : 0.07, { travel: 0.25 });
      if (u.uid === 'A01' && u.deploy === 'deployed') { const r = new THREE.Vector3(1, 0, 0).applyQuaternion(view.group.quaternion); fx.spark(mz.x, mz.y, mz.z, { vx: r.x * 2.5, vy: 2.2, vz: r.z * 2.5, g: 9.8, life: 0.5, s0: 0.05, s1: 0.05, c0: [0.95, 0.75, 0.35] }); }
    }
  }
  if (e.type === 'impact') { const wet = e.z < 0.3 && app.T.height(e.x, e.y) < 0; fx.impact(new THREE.Vector3(e.x, e.z, -e.y), e.uid && e.uid[0] === 'T' && e.kind === 'hitscan' ? 'pulse' : e.kind, false, e.kind === 'shell' ? 1.2 : e.kind === 'missile' ? 1 : 0.5); void wet; }
  if (e.type === 'miss') fx.impact(new THREE.Vector3(e.x, e.z, -e.y), 'shell', !!e.water, 1);
  if (e.type === 'proj_end') fx.impact(new THREE.Vector3(e.x, e.z, -e.y), 'pulse', false, 0.4);
  if (e.type === 'explosion') fx.explosion(new THREE.Vector3(e.x, e.z, -e.y), e.r, !!e.water);
  if (e.type === 'bomb') { const r = fx.ring(e.x, -e.y, app.T.surface(e.x, e.y), e.r, e.r, 0.8, 0xff5040, { a: 0.6, ease: false }); void r; }
  if (e.type === 'emp' && e.applied) { const tg = w.byId.get(e.target); fx.ring(e.x, -e.y, tg ? tg.z + 0.5 : 0.5, 0.5, 9, 0.6, 0x6fe6d4, { a: 0.9, add: true }); }
  if (e.type === 'emp_wind' && view) { const p = view.sock('muzzle'); fx.spark(p.x, p.y, p.z, { life: 0.3, s0: 0.3, s1: 1.4, c0: [0.5, 1, 1] }); }
  if (e.type === 'scan') { fx.ring(e.x, -e.y, app.T.surface(e.x, e.y), 1, e.r, 0.6, 0x6fe6d4, { a: 0.9, add: true }); fx.ring(e.x, -e.y, app.T.surface(e.x, e.y), e.r, e.r, e.dur, 0x6fe6d4, { a: 0.18, disc: true, ease: false }); }
  if (e.type === 'death' && e.building) { const g = app.structs.get(e.id); if (g) { fx.explosion(g.position.clone().add(new THREE.Vector3(0, 2, 0)), 8, false); g.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.3); } }); g.scale.y = 0.45; } }
  if (e.type === 'death' && view && !e.building) { const u = view.u; const p = view.group.position.clone(); if (u.kind !== 'foot') fx.explosion(p.clone().add(new THREE.Vector3(0, u.kind === 'ship' ? 2 : 1, 0)), u.kind === 'ship' ? 6 : u.kind === 'drone' ? 1.5 : 4, u.kind === 'ship'); app.selected.delete(u.id); }
  if (e.type === 'remove') { const v = app.views.get(e.id); if (v) { v.dispose(); app.views.delete(e.id); app.snap.delete(e.id); } }
}
function muzzleNames(u, e) {
  if (u.uid === 'H04') return [e.muzzle === 0 ? 'muzzle_L' : 'muzzle_R', 'muzzle'];
  if (u.uid === 'A05') return e.sys === 1 ? ['muzzle_aa'] : ['muzzle_cell_' + e.muzzle, 'muzzle_cell_0'];
  if (u.uid === 'T05') return [e.muzzle === 0 ? 'muzzle_L' : 'muzzle_R'];
  if (u.uid === 'A02') return [e.w === 0 ? 'muzzle_aa' : 'muzzle_at', 'muzzle'];
  return ['muzzle'];
}

// ───────── frame ─────────
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - app.last) / 1000; app.last = now; if (dt > 0.25) dt = 0.25;
  if (!app.manual) { app.frames.push(dt * 1000); if (app.frames.length > 600) app.frames.shift(); tick(dt); render(); }   // manual (test) clock: render on demand only
}
// one presentation frame: fixed-step simulation (30 Hz) + interpolated views + effects. Rate of fire never depends on FPS.
function tick(dt) {
  const t0 = performance.now();
  const P = app.prof || (app.prof = { sim: 0, views: 0, inf: 0, proj: 0, fx: 0, n: 0, simMax: 0 }); let pt = performance.now();
  const gs = app.speed * app.pace.game_speed;   // game speed (pace) × playback (Pause / ¼× / 1× / 2×): the simulation's time scale
  app.acc = (app.acc || 0) + dt * gs; let n = 0; while (app.acc >= TICK && n < 32) { stepSim(); app.acc -= TICK; n++; } if (n === 32) app.acc = 0;
  { const q = performance.now(); P.sim += q - pt; P.simMax = Math.max(P.simMax, q - pt); pt = q; P.n++; }
  const alpha = app.acc / TICK; app.alpha = alpha; app.simTime = app.world.t - (1 - alpha) * TICK;
  const rdt = dt * gs; app.camera.updateMatrixWorld(); app.frustum = app.frustum || new THREE.Frustum(); app.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(app.camera.projectionMatrix, app.camera.matrixWorldInverse));
  lodUpdate();
  for (const [id, v] of app.views) {
    const s = app.snap.get(id); if (!s) continue; const S = interp(s.prev, s.cur, alpha);
    const t1 = performance.now(); const before = v.group.position.clone(); v.update(S, rdt); measureSmooth(v, before, S, rdt); measureFeet(v); measureTracks(v, S); if (v.u.kind === 'foot') P.inf += performance.now() - t1;
  }
  { const q = performance.now(); P.views += q - pt; pt = q; }
  for (const [p, v] of app.projV) {
    const a = v.prev, b = v.cur; const x = lerp(a[0], b[0], alpha), y = lerp(a[1], b[1], alpha), z = lerp(a[2], b[2], alpha);
    const pos = new THREE.Vector3(x, z, -y); const age = app.simTime - v.born; if (v.off && age < 0.15) pos.add(v.off.clone().multiplyScalar(1 - age / 0.15));
    const dir = new THREE.Vector3(b[0] - a[0], b[2] - a[2], -(b[1] - a[1])); if (dir.lengthSq() > 1e-6) v.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    v.mesh.position.copy(pos);
    if (v.kind === 'missile') { v.trailAcc += rdt * 40; const life = v.p.uid === 'H04' ? 0.8 : 0.6; if (age < life + 2) while (v.trailAcc > 1) { v.trailAcc -= 1; app.fx.trail(pos, v.cyan ? 'cyan' : 'smoke'); } }
    if (v.kind === 'shell' && Math.random() < 0.5) app.fx.spark(pos.x, pos.y, pos.z, { life: v.cyan ? 0.12 : 0.05, s0: v.cyan ? 0.5 : 0.35, s1: 0.1, c0: v.cyan ? [0.5, 1, 1] : [1, 0.8, 0.45] });
  }
  { const q = performance.now(); P.proj += q - pt; pt = q; }
  app.fx.update(rdt, app.camera); if (app.water.userData.tick) app.water.userData.tick(app.simTime);
  { const q = performance.now(); P.fx += q - pt; pt = q; }
  cameraUpdate(dt); app.controls.update();
  const tg = app.controls.target; app.sun.position.set(tg.x - 160, 260, tg.z + 120); app.sun.target.position.copy(tg); app.sun.target.updateMatrixWorld();
  app.tickMs = (app.tickMs || 0) * 0.9 + (performance.now() - t0) * 0.1; app.tickList = app.tickList || []; app.tickList.push(performance.now() - t0); if (app.tickList.length > 2000) app.tickList.shift();
}
// distant-view selection by on-screen size (pixels the unit's largest dimension covers), with ±12 % hysteresis so levels never flicker;
// app.forceLod pins one level for inspection. Thresholds: LOD0 above 110 px, LOD1 above 36 px, LOD2 below.
const LOD_PX = [110, 36];
function lodUpdate() {
  const cam = app.camera, k = innerHeight / (2 * Math.tan(cam.fov * Math.PI / 360)), st = app.lodStats = [0, 0, 0]; let sw = 0;
  for (const v of app.views.values()) {
    if (!v.lodMeshes || !v.lodMeshes.length) continue; let lv;
    if (app.forceLod != null) lv = app.forceLod;
    else { const d = Math.max(1, cam.position.distanceTo(v.group.position)), px = v.lodSize * k / d, cur = v.lod;
      lv = px > LOD_PX[0] ? 0 : px > LOD_PX[1] ? 1 : 2;
      if (lv < cur && px < LOD_PX[lv] * 1.12) lv = cur;                 // coming closer: switch up only once clearly past the threshold
      if (lv > cur && px > LOD_PX[cur] * 0.88) lv = cur; }               // moving away: likewise
    if (lv !== v.lod) { v.setLod(lv); sw++; } st[v.lod]++;
  }
  app.lodSwitches = (app.lodSwitches || 0) + sw;
}
function render() { debugDraw(); app.renderer.render(app.scene, app.camera); drawHud(); if ((app.fc = (app.fc || 0) + 1) % 10 === 0) updatePanels(); }
// test clock: advance virtual time in fixed presentation frames (independent of the software rasteriser's speed)
app.advance = (sec, fps = 60, renderEvery = 0) => { app.manual = true; const n = Math.round(sec * fps); for (let i = 0; i < n; i++) { tick(1 / fps); if (renderEvery && i % renderEvery === 0) render(); } return app.stats(); };
app.render = () => render();
function measureTracks(v, S) { // track belt UV advance must equal ground distance on each side
  if (!v.tracks || !v.tracks.L.mat || !v.tracks.L.mat.map) return; v._tr = v._tr || { L: null, R: null };
  for (const sd of ['L', 'R']) { const T_ = v.tracks[sd]; const off = T_.mat.map.offset.x; const d = sd === 'L' ? S.trackL : S.trackR; const p = v._tr[sd];
    if (p) { const dU = (off - p.off) * T_.uvm, dD = d - p.d; if (Math.abs(dD) > 1e-4) { app.tracks.samples++; app.tracks.worst = Math.max(app.tracks.worst, Math.abs(dU - dD)); } } v._tr[sd] = { off, d }; }
}
// smoothness: rendered position change per frame vs interpolated sim speed (catches snaps/teleports in the view)
function measureSmooth(v, before, S, dt) {
  if (dt <= 0 || v.dead || !S.alive || !v._seen || S.hidden || v._wasHidden) { v._seen = true; v._wasHidden = S.hidden; return; } const d = v.group.position.distanceTo(before); const vmax = Math.hypot(v.u.sp.speed_mps, 6) * 1.3 + 3; const sp = d / dt;
  app.smooth.samples++; if (sp > vmax && d > 0.25) { app.smooth.jumps++; if (app.smooth.list.length < 20) app.smooth.list.push(`${v.uid}#${v.id} ${sp.toFixed(1)} m/s at t=${app.world.t.toFixed(2)}`); }
  app.smooth.worst = Math.max(app.smooth.worst, sp / vmax);
}
// foot sliding: world drift of a planted foot during its stance phase
function measureFeet(v) {
  if (!v.feet) return; v._st = v._st || {};
  for (const sd of ['R', 'L']) {
    const st = v.feet[sd]; const p = v.footWorld[sd];
    if (st && !v._st[sd]) v._st[sd] = { p0: p.clone(), max: 0, n: 0 };
    else if (st && v._st[sd]) { const s = v._st[sd]; const d = Math.hypot(p.x - s.p0.x, p.z - s.p0.z); s.max = Math.max(s.max, d); s.n++; }
    else if (!st && v._st[sd]) { const s = v._st[sd]; if (s.n > 2) { app.feet.stances++; app.feet.sum += s.max; app.feet.worst = Math.max(app.feet.worst, s.max); if (s.max > 0.06 && app.feet.list.length < 12) app.feet.list.push(`${v.uid}#${v.id} ${(s.max * 100).toFixed(1)} cm` + (app.feetDebug ? ` [${s.info.join(' ')}]` : '')); } v._st[sd] = null; }
    if (st && v._st[sd] && app.feetDebug) { const s = v._st[sd]; s.info = s.info || []; if (s.info.length < 14) s.info.push(`t${app.world.t.toFixed(2)} v${v.u.v.toFixed(1)} g${v.gaitW.toFixed(2)} L${v.lock[sd].on ? 1 : 0}${v.lock[sd].rel ? 'r' : ''} d${(Math.hypot(p.x - s.p0.x, p.z - s.p0.z) * 100).toFixed(0)} w${v.u.w.toFixed(1)}`); }
  }
}

// ───────── camera ─────────
function cameraUpdate(dt) {
  const sel = [...app.selected].map((id) => app.views.get(id)).filter(Boolean); const c = app.controls;
  if ((app.cam === 'follow' || app.cam === 'close') && sel.length) {
    const p = sel[0].group.position; const tgt = new THREE.Vector3(p.x, p.y + (app.cam === 'close' ? Math.max(1, sel[0].u.sp.dimensions_m.height * 0.5) : 2), p.z);
    const d = tgt.clone().sub(c.target); c.target.add(d); app.camera.position.add(d);
    if (app.cam === 'close' && !app._closeSet) { app._closeSet = true; const r = Math.max(4, sel[0].u.sp.dimensions_m.length * 1.6); const back = new THREE.Vector3(0, 0, 1).applyQuaternion(sel[0].group.quaternion).multiplyScalar(r * 0.8); app.camera.position.copy(tgt).add(back).add(new THREE.Vector3(r * 0.6, r * 0.45, 0)); }
  }
  // keyboard pan / rotate
  const k = app.keys || {}; const sp = 60 * dt * (app.camera.position.distanceTo(c.target) / 120 + 0.3);
  const fwd = new THREE.Vector3().subVectors(c.target, app.camera.position).setY(0).normalize(), rgt = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const mv = new THREE.Vector3(); if (k.ArrowUp || k.w) mv.add(fwd); if (k.ArrowDown) mv.sub(fwd); if (k.ArrowLeft) mv.sub(rgt); if (k.ArrowRight) mv.add(rgt);
  if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); c.target.add(mv); app.camera.position.add(mv); }
  if (k.q || k.e) { const a = (k.q ? 1 : -1) * dt * 1.2; const off = app.camera.position.clone().sub(c.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), a); app.camera.position.copy(c.target).add(off); }
  const g = app.T.surface(-c.target.z > 0 ? c.target.x : 0, -c.target.z); if (app.camera.position.y < g + 2) app.camera.position.y = g + 2;
}
app.lookAt = (x, y, z, dist = 60, az = -0.8, el = 0.6) => { const c = app.controls; c.target.set(x, z, -y); app.camera.position.set(x + Math.cos(az) * Math.cos(el) * dist, z + Math.sin(el) * dist, -y + Math.sin(az) * Math.cos(el) * dist); c.update(); };

// ───────── HUD (health bars, status, selection) ─────────
function proj(v3) { const p = v3.clone().project(app.camera); return p.z < 1 ? [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight] : null; }
function drawHud() {
  const g = app.hudCtx; g.clearRect(0, 0, innerWidth, innerHeight); const w = app.world;
  for (const [id, v] of app.views) {
    const u = v.u; if (!u.alive || u.hidden) continue; const sel = app.selected.has(id);
    const top = v.group.position.clone().add(new THREE.Vector3(0, u.sp.dimensions_m.height + (u.kind === 'foot' ? 0.3 : 0.8), 0)); const p = proj(top); if (!p) continue;
    if (app.show.lod && v.lodMeshes && v.lodMeshes.length) { g.font = '600 10px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.fillStyle = ['#62d48a', '#f0b84a', '#ff6b5e'][v.lod]; g.fillText(`L${v.lod}`, p[0], p[1] - 8); }
    const dist = app.camera.position.distanceTo(v.group.position); if (dist > 420 && !sel) continue;
    const bw = Math.max(18, Math.min(60, u.sp.dimensions_m.length * 900 / dist + 10));
    if (app.show.bars && (sel || u.hp < u.maxHp)) {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(p[0] - bw / 2 - 1, p[1] - 1, bw + 2, 5); const f = u.hp / u.maxHp;
      g.fillStyle = f > 0.6 ? '#62d48a' : f > 0.3 ? '#f2c14e' : '#ff6b5e'; g.fillRect(p[0] - bw / 2, p[1], bw * f, 3);
      g.fillStyle = '#' + TEAM_COLORS[u.team].getHexString(); g.fillRect(p[0] - bw / 2 - 4, p[1] - 1, 3, 5);
    }
    if (u.emp) { g.fillStyle = '#6fe6d4'; g.font = '600 11px "IBM Plex Sans", sans-serif'; g.fillText('EMP', p[0] + bw / 2 + 4, p[1] + 5); }
    if (u.rank) { g.fillStyle = '#f2c14e'; g.font = '600 11px "IBM Plex Sans", sans-serif'; g.fillText(u.rank === 2 ? '★★' : '★', p[0] - bw / 2 - 18, p[1] + 5); }
    if (u.deploy && u.deploy !== 'mobile') { g.fillStyle = '#d6dde4'; g.font = '500 10px "IBM Plex Sans", sans-serif'; g.fillText(u.deploy, p[0] - 14, p[1] - 4); }
    if (sel) { const b = proj(v.group.position); if (b) { g.strokeStyle = '#' + TEAM_COLORS[u.team].getHexString(); g.lineWidth = 1.5; const r = Math.max(8, u.r * 700 / dist); g.beginPath(); g.ellipse(b[0], b[1], r, r * 0.5, 0, 0, Math.PI * 2); g.stroke(); } }
  }
  for (const b of w.buildings) { if (!b.alive || (b.hp >= b.maxHp && !b.occupants.length)) continue; const p = proj(new THREE.Vector3(b.x, b.z + b.h + 2, -b.y)); if (!p) continue; g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(p[0] - 31, p[1] - 1, 62, 5); g.fillStyle = '#9fb1c2'; g.fillRect(p[0] - 30, p[1], 60 * b.hp / b.maxHp, 3); if (b.occupants.length) { g.fillStyle = '#e7ebef'; g.font = '600 11px "IBM Plex Sans", sans-serif'; g.fillText(`${b.occupants.length}/${b.slots} inside`, p[0] - 26, p[1] - 5); } }
  if (app.box) { g.strokeStyle = 'rgba(89,168,255,0.9)'; g.fillStyle = 'rgba(89,168,255,0.12)'; const [a, b] = app.box; g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
}

// ───────── debug overlays: weapon ranges, collision shapes, paths ─────────
function debugDraw() {
  const D = app.debug; while (D.children.length) { const c = D.children.pop(); c.geometry.dispose(); }
  const L = (pts, col) => { const g = new THREE.BufferGeometry().setFromPoints(pts); D.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthTest: false }))); };
  const circle = (x, y, z, r, col) => { const pts = []; for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; pts.push(new THREE.Vector3(px, Math.max(app.T.surface(px, py), z) + 0.3, -py)); } L(pts, col); };
  const w = app.world;
  if (app.show.ranges) for (const id of app.selected) { const u = w.byId.get(id); if (!u || !u.alive) continue; u.sp.weapons.forEach((wp, i) => circle(u.x, u.y, 0, wp.range_m + u.r, i ? 0xffb35a : 0xff5a5a)); circle(u.x, u.y, 0, u.sp.sight_m, 0x8fd0ff); }
  if (app.show.shapes) for (const u of w.units) { if (!u.alive || u.hidden) continue; const [ax, ay, bx, by] = w.axis(u); const z = u.z + (u.kind === 'foot' ? 0.9 : u.geom.hitZ); const pts = []; for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2; const half = k <= 12 ? [bx, by] : [ax, ay]; pts.push(new THREE.Vector3(half[0] + Math.cos(a + u.hdg - Math.PI / 2) * u.r, z, -(half[1] + Math.sin(a + u.hdg - Math.PI / 2) * u.r))); } L(pts, u.team ? 0xff7a6e : 0x7ab8ff); }
  if (app.show.paths) for (const u of w.units) { if (!u.alive || !u.path) continue; const pts = [new THREE.Vector3(u.x, u.z + 0.5, -u.y)]; for (let k = u.pi; k < u.path.length; k++) { const p = u.path[k]; pts.push(new THREE.Vector3(p[0], (u.dom === 'air' ? u.z : Math.max(app.T.surface(p[0], p[1]), 0)) + 0.5, -p[1])); } L(pts, 0xf2e86d); }
}

// ───────── panels ─────────
function updatePanels() {
  econPanel();
  const f = app.frames.slice(-120); const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length); const s = [...f].sort((a, b) => a - b); const p95 = s[Math.floor(s.length * 0.95)] || 0;
  const info = app.renderer.info; const w = app.world;
  $('#stats').innerHTML = `<span class="k">fps</span> ${(1000 / avg).toFixed(0)} <span class="k">p95</span> ${p95.toFixed(1)} ms<br><span class="k">sim</span> ${(app.simMs || 0).toFixed(2)} ms/tick · ${(w.t).toFixed(1)} s<br><span class="k">units</span> ${w.units.filter((u) => u.alive).length}${app.lodStats ? ` <span class="k">lod</span> ${app.lodStats.join('/')}` : ''} <span class="k">shots</span> ${w.proj.length} <span class="k">fx</span> ${app.fx.smoke.p.length + app.fx.glow.p.length}<br><span class="k">draws</span> ${info.render.calls} <span class="k">tris</span> ${(info.render.triangles / 1000).toFixed(0)}k`;
  const sel = [...app.selected].map((id) => w.byId.get(id)).filter((u) => u && u.alive);
  const box = $('#sel'); if (!sel.length) { box.style.display = 'none'; return; } box.style.display = 'block';
  const u = sel[0]; const st = u.garrisonIn ? 'garrisoned' : u.deploy && u.deploy !== 'mobile' ? u.deploy : u.kind === 'jet' ? u.jet.phase : u.path ? 'moving' : u.target != null ? 'engaging' : 'idle';
  const wp = u.sp.weapons.map((x, i) => { const sy = u.sys[u.sys.length > 1 ? i : 0]; return `${x.name}: ${x.damage}×${x.burst} / ${x.cycle_s}s, ${x.range_m} m${sy && sy.cd > 0 ? ` · ${sy.cd.toFixed(1)}s` : ''}`; }).join('<br>');
  box.innerHTML = `<div class="name">${u.sp.name} <span style="color:var(--muted)">${u.uid} · ${u.sp.faction_name}${sel.length > 1 ? ` · +${sel.length - 1} more` : ''}</span></div>
    <div class="m">HP ${u.hp.toFixed(0)}/${u.maxHp.toFixed(0)} · ${st} · ${u.v.toFixed(1)}/${u.sp.speed_mps} m/s${u.kind === 'heli' || u.kind === 'drone' || u.kind === 'jet' ? ` · alt ${(u.z - app.T.surface(u.x, u.y)).toFixed(1)} m` : ''}${u.emp ? ' · EMP' : ''}${u.rank ? ` · ${['', 'Veteran', 'Elite'][u.rank]}` : ''}<br>${wp}</div>`;
}

// ───────── UI ─────────
function setupUI() {
  const pal = $('#palette'); const draw = () => { pal.innerHTML = ''; for (const uid of UIDS.filter((x) => x[0] === app.faction)) { const sp = app.spec.units.find((x) => x.id === uid); const b = document.createElement('button'); b.className = 'unit ' + uid[0]; b.innerHTML = `<b>${sp.name}</b><span>${uid} · ${sp.category} · ${sp.speed_mps} m/s</span>`; b.onclick = () => { app.placing = uid; toast(`Click the map to place a ${sp.name} (right-click cancels)`); }; pal.appendChild(b); } };
  draw();
  for (const b of document.querySelectorAll('#factions button')) b.onclick = () => { app.faction = b.dataset.f; for (const x of document.querySelectorAll('#factions button')) x.classList.toggle('on', x === b); draw(); };
  for (const b of document.querySelectorAll('#teams button')) b.onclick = () => { app.team = +b.dataset.team; for (const x of document.querySelectorAll('#teams button')) x.classList.toggle('on', x === b); };
  for (const b of document.querySelectorAll('#speed button')) b.onclick = () => { app.speed = +b.dataset.s; for (const x of document.querySelectorAll('#speed button')) x.classList.toggle('on', x === b); };
  for (const b of document.querySelectorAll('#toggles button')) b.onclick = () => { app.show[b.dataset.t] = !app.show[b.dataset.t]; b.classList.toggle('on', app.show[b.dataset.t]); };
  for (const b of document.querySelectorAll('#lodSeg button')) b.onclick = () => { app.forceLod = b.dataset.l === 'auto' ? null : +b.dataset.l; for (const x of document.querySelectorAll('#lodSeg button')) x.classList.toggle('on', x === b); };
  for (const b of document.querySelectorAll('#cams button')) b.onclick = () => { app.cam = b.dataset.c; app._closeSet = false; for (const x of document.querySelectorAll('#cams button')) x.classList.toggle('on', x === b); };
  const sc = $('#scen'); for (const [k, label] of [['tour', 'Domain tour'], ['battle', 'Live fire'], ['sortie', 'Kestrel sortie'], ['emp', 'EMP + scan'], ['garrison', 'Garrison'], ['deploy', 'Deploy'], ['naval', 'Naval duel'], ['economy', 'Economy'], ['clear', 'Clear']]) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => scenario(k); sc.appendChild(b); }
  for (const b of document.querySelectorAll('#orders button')) b.onclick = () => { const o = b.dataset.o; if (['stop', 'deploy'].includes(o)) { quickOrder(o); return; } app.mode = o; for (const x of document.querySelectorAll('#orders button')) x.classList.toggle('on', x === b); };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open'); $('#title').onclick = () => $('#side').classList.toggle('min');
  // pace sliders
  const P = app.pace, gs = $('#gs'), hr = $('#hr');
  gs.min = P.game_speed_range[0]; gs.max = P.game_speed_range[1]; gs.value = P.game_speed; hr.min = P.harvester_ratio_range[0]; hr.max = P.harvester_ratio_range[1]; hr.value = P.harvester_speed_ratio;
  gs.oninput = () => app.setPace({ game_speed: +gs.value }); hr.oninput = () => app.setPace({ harvester_speed_ratio: +hr.value });
  $('#paceReset').onclick = () => { app.setPace({ game_speed: app.paceFile.game_speed, harvester_speed_ratio: app.paceFile.harvester_speed_ratio }); gs.value = app.pace.game_speed; hr.value = app.pace.harvester_speed_ratio; };
  for (const b of document.querySelectorAll('#econBtns button')) b.onclick = () => { const w = app.world; const hv = w.units.find((u) => u.alive && u.harv); if (!hv) { scenario('economy'); if (b.dataset.d !== 'near') setTimeout(() => { const h = app.world.units.find((u) => u.alive && u.harv); if (h) h.harv.next = b.dataset.d; }, 0); return; }
    if (hv.harv.dep.id !== b.dataset.d) { hv.harv.next = b.dataset.d; toast(`Harvester switches to the ${b.dataset.d} field after this trip`); } };
  paceUI();
}
// pace: game speed (sim time scale) and harvester speed; persisted per viewer
app.setPace = (o = {}) => {
  const P = app.pace; if (o.game_speed != null) P.game_speed = +o.game_speed; if (o.harvester_speed_ratio != null) P.harvester_speed_ratio = +o.harvester_speed_ratio;
  app.world.setHarvesterSpeed(harvesterSandboxSpeed(P)); app.econPred = null;
  try { localStorage.setItem('sandbox.pace', JSON.stringify({ g: P.game_speed, r: P.harvester_speed_ratio })); } catch (e) { /* ignore */ }
  paceUI(); return { game_speed: P.game_speed, harvester_speed_ratio: P.harvester_speed_ratio, harvester_mps: harvesterSandboxSpeed(P) };
};
function paceUI() {
  const P = app.pace; if (!$('#gsv')) return; const v = harvesterSandboxSpeed(P);
  $('#gsv').textContent = `${P.game_speed.toFixed(2)}×`; $('#hrv').textContent = `${P.harvester_speed_ratio.toFixed(2)}× tank`;
  $('#paceNote').textContent = `Everything runs ${P.game_speed.toFixed(2)}× faster: movement, turning, reloads, harvesting, unloading. Sizes and turning circles stay the same. Harvester ${v.toFixed(1)} m/s (Lancer ${P.reference_tank.sandbox.mps} m/s), game time.`;
}
// predicted round trip from the shared pace model (data/pace.js), on the same planned path the harvester drives
app.econPredict = () => econPredict();
// distant-view diagnostics: per unit type, meshes matched at each level and triangles per level (one spawned instance each)
app.lodReport = () => { const out = {}; for (const v of app.views.values()) { if (out[v.uid] || !v.lodMeshes) continue; const tri = (g) => g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
  out[v.uid] = { meshes: v.lodMeshes.length, matched: [1, 2].map((l) => v.lodMeshes.filter((m) => m.g[l]).length), tris: [0, 1, 2].map((l) => Math.round(v.lodMeshes.reduce((a, m) => a + tri(m.g[l] || m.g[l - 1] || m.g[0]), 0))) }; } return out; };
function econPredict() {
  if (app.econPred) return app.econPred; const w = app.world, E = app.econ, P = app.pace, v = harvesterSandboxSpeed(P), r = 2.0;
  app.econPred = {}; for (const d of E.deposits) { const pts = w.nav.path('veh', E.dock.approach[0], E.dock.approach[1], d.svc[0], d.svc[1], r + 0.2, r + 1.5).pts; const out = [E.dock.approach, ...pts];
    app.econPred[d.id] = harvestCycle({ grate: E.dock.grate, approach: E.dock.approach, out, back: [d.svc, ...out.slice().reverse().slice(1)], roadSpeeds: [v, v] }, P, { heightAt: (x, y) => app.T.height(x, y) }); }
  return app.econPred;
}
function econPanel() {
  const el = $('#econOut'); if (!el) return; const P = app.pace, G = P.game_speed, pred = econPredict(), hv = app.world.units.find((u) => u.alive && u.harv), f = (x) => `${(x / G).toFixed(1)} s`;
  let h = `<table class="et"><tr><th></th><th>predicted</th><th>measured</th></tr>`;
  for (const d of app.econ.deposits) { const last = hv && hv.harv.history.slice().reverse().find((x) => x.dep === d.id); h += `<tr${hv && hv.harv.dep.id === d.id ? ' class="on"' : ''}><td>${d.id === 'near' ? 'Near' : 'Far'} field</td><td>${f(pred[d.id].game_s)}</td><td>${last ? f(last.total) : '–'}</td></tr>`; }
  h += '</table>';
  if (hv) { const H = hv.harv, L = H.last; h += `<div class="em">${H.dep.name}: ${{ out: 'driving out', load: 'loading', back: 'driving back', pivot: 'turning to dock', reverse: 'reversing onto the grate', unload: 'unloading' }[H.state]}${H.next ? ` · next: ${H.next} field` : ''}</div>`;
    if (L) h += `<div class="em">last trip: out ${f(L.legs.out)} · load ${f(L.legs.load)} · back ${f(L.legs.back)} · dock ${f(L.legs.dock)} · unload ${f(L.legs.unload)}</div>`; }
  else h += `<div class="em">Run <b>Economy</b> to start a harvester.</div>`;
  h += `<div class="em">Real seconds at ${G.toFixed(2)}×. Target for the nearest home field: ${P.targets.harvest_round_trip_nearest_home_s.join('–')} s.</div>`;
  el.innerHTML = h;
}
function toast(s, ms = 2400) { const t = $('#toast'); t.textContent = s; t.style.display = 'block'; clearTimeout(app._tt); app._tt = setTimeout(() => (t.style.display = 'none'), ms); }
function quickOrder(o) {
  const w = app.world; const sel = [...app.selected].map((id) => w.byId.get(id)).filter((u) => u && u.alive);
  if (o === 'stop') for (const u of sel) w.order(u, { type: 'stop' });
  if (o === 'deploy') for (const u of sel) if (u.m.deploy) w.order(u, { type: u.deploy === 'deployed' ? 'undeploy' : 'deploy' });
}

// ───────── input: selection and orders ─────────
const ray = new THREE.Raycaster();
function groundAt(cx, cy) {
  ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), app.camera);
  const hits = ray.intersectObjects(app.scene.children.filter((o) => o.name === 'terrain' || o.name === 'water'), false); if (!hits.length) return null;
  const p = hits[0].point; return { x: p.x, y: -p.z };
}
function unitAt(cx, cy) {
  let best = null, bd = 1e9;
  for (const [id, v] of app.views) { const u = v.u; if (!u.alive || u.hidden) continue; const c = v.group.position.clone().add(new THREE.Vector3(0, Math.min(u.sp.dimensions_m.height * 0.5, 3), 0)); const p = proj(c); if (!p) continue;
    const dist = app.camera.position.distanceTo(c); const r = Math.max(14, Math.max(u.sp.dimensions_m.length, u.sp.dimensions_m.width) * 0.5 * innerHeight / (dist * 0.77)); const d = Math.hypot(p[0] - cx, p[1] - cy); if (d < r && d < bd) { bd = d; best = u; } }
  return best;
}
function buildingAt(cx, cy) { const g = groundAt(cx, cy); if (!g) return null; return app.world.buildings.find((b) => b.alive && Math.abs(g.x - b.x) < b.w / 2 + 2 && Math.abs(g.y - b.y) < b.d / 2 + 2) || null; }
function command(cx, cy, mode) {
  const w = app.world; const sel = [...app.selected].map((id) => w.byId.get(id)).filter((u) => u && u.alive && u.team === app.selTeam); if (!sel.length) return;
  const tgt = unitAt(cx, cy); const b = buildingAt(cx, cy); const g = groundAt(cx, cy);
  if (mode === 'ability') { for (const u of sel) { if (u.m.emp && tgt && tgt.team !== u.team) w.order(u, { type: 'emp', target: tgt.id }); if (u.m.scan && g) w.order(u, { type: 'scan', x: g.x, y: g.y }); } return; }
  if ((mode === 'garrison' || mode === 'move') && b && b.slots > 0 && (b.team < 0 || b.team === sel[0].team)) { const inf = sel.filter((u) => u.m.garrisonable); if (inf.length || mode === 'garrison') { for (const u of inf) w.order(u, { type: 'garrison', building: b.id }); return; } }
  if (tgt && tgt.team !== sel[0].team && mode !== 'attackMove') { for (const u of sel) w.order(u, { type: 'attack', target: tgt.id }); markOrder(tgt.x, tgt.y, 0xff5a5a); return; }
  if (b && b.team >= 0 && b.team !== sel[0].team) { for (const u of sel) w.order(u, { type: 'attack', target: b.id }); return; }
  if (!g) return;
  if (mode === 'attack') { for (const u of sel.filter((u) => u.kind === 'jet')) w.order(u, { type: 'attack', x: g.x, y: g.y }); markOrder(g.x, g.y, 0xff5a5a); return; }
  w.orderGroup(sel, { type: mode === 'attackMove' ? 'attackMove' : 'move', x: g.x, y: g.y }); markOrder(g.x, g.y, mode === 'attackMove' ? 0xffb35a : 0x7cf29a);
}
function markOrder(x, y, col) { app.fx.ring(x, -y, Math.max(app.T.surface(x, y), 0), 2.5, 0.6, 0.5, col, { a: 0.9 }); }
function setupInput(canvas) {
  app.keys = {};
  addEventListener('keydown', (e) => { app.keys[e.key] = true; const k = e.key.toLowerCase();
    if (k === 's') quickOrder('stop'); if (k === 'd') quickOrder('deploy'); if (k === 'a') { app.mode = 'attackMove'; toast('Attack-move: right-click a destination'); } if (k === 'f') { app.mode = 'ability'; toast('Ability: right-click a target (EMP) or point (scan)'); } if (k === 'g') { app.mode = 'garrison'; toast('Garrison: right-click the bunker'); }
    if (e.key === 'Escape') { app.selected.clear(); app.placing = null; app.mode = 'select'; } if (e.key === 'Delete') for (const id of app.selected) { const u = app.world.byId.get(id); if (u) app.world._damage({ team: -9 }, u, 1e9, u.sp.weapons[0]); } });
  addEventListener('keyup', (e) => { app.keys[e.key] = false; });
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, t: performance.now() }; if (e.button === 0 && e.shiftKey) { app.controls.enabled = false; app.box = [[e.clientX, e.clientY], [e.clientX, e.clientY]]; } });
  canvas.addEventListener('pointermove', (e) => { if (app.box) app.box[1] = [e.clientX, e.clientY]; });
  addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const w = app.world;
    if (app.box) { const [a, b] = app.box; app.box = null; app.controls.enabled = true; const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); app.selected.clear();
      for (const [id, v] of app.views) { if (!v.u.alive || v.u.team !== app.team) continue; const p = proj(v.group.position); if (p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) app.selected.add(id); } app.selTeam = app.team; down = null; return; }
    if (moved > 6) { down = null; return; }
    if (down.b === 0) {
      if (app.placing) { const g = groundAt(e.clientX, e.clientY); if (g) { const u = spawn(app.placing, app.team, g.x, g.y); app.selected = new Set([u.id]); app.selTeam = u.team; } if (!e.shiftKey) app.placing = null; down = null; return; }
      if (app.mode !== 'select' && app.selected.size) { command(e.clientX, e.clientY, app.mode); down = null; return; }
      const u = unitAt(e.clientX, e.clientY); if (!e.shiftKey) app.selected.clear(); if (u) { app.selected.add(u.id); app.selTeam = u.team; app._closeSet = false; }
    } else if (down.b === 2) { if (app.placing) { app.placing = null; down = null; return; } command(e.clientX, e.clientY, app.mode === 'select' ? 'move' : app.mode); if (app.mode !== 'select' && app.mode !== 'move') { app.mode = 'select'; for (const x of document.querySelectorAll('#orders button')) x.classList.toggle('on', x.dataset.o === 'select'); } }
    down = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ───────── scenarios ─────────
function clearAll() { app.timers = []; const w = app.world; for (const u of w.units) if (u.alive) { u.alive = false; u.removed = true; } for (const [id, v] of app.views) v.dispose(); app.views.clear(); app.snap.clear(); for (const [p, v] of app.projV) app.scene.remove(v.mesh); app.projV.clear(); w.proj.length = 0; w.units.length = 0; app.selected.clear(); for (const b of w.buildings) { b.occupants = []; } }
function scenario(name) {
  const w = app.world; clearAll(); const F = FEATURES; app.scenarioName = name; const S = (uid, team, x, y, o) => spawn(uid, team, x, y, o);
  if (name === 'tour') {   // one of every unit, each sent across its own domain
    const inf = ['H01', 'H02', 'A01', 'A02', 'T01', 'T02'].map((id, k) => S(id, 0, 150 + (k % 3) * 3, 222 + Math.floor(k / 3) * 3, { hdg: -0.3 }));
    w.orderGroup(inf, { type: 'move', x: 270, y: 150 });
    const tk = [S('H03', 0, 108, 300, { hdg: 1.6 }), S('A03', 0, 122, 300, { hdg: 1.6 })]; w.order(tk[0], { type: 'move', x: 112, y: 395 }); w.order(tk[1], { type: 'move', x: 300, y: 140 });
    const hv = S('T03', 0, 290, 330, { hdg: 0 }); w.order(hv, { type: 'move', x: 535, y: 90 });
    const sh = [S('H05', 0, 560, 230, { hdg: 1.57 }), S('A05', 0, 610, 180, { hdg: 1.57 }), S('T05', 0, 540, 280, { hdg: 1.57 })]; w.order(sh[0], { type: 'move', x: 470, y: 330 }); w.order(sh[1], { type: 'move', x: 615, y: 450 }); w.order(sh[2], { type: 'move', x: 600, y: 60 });
    const he = S('H04', 0, 60, 100, { hdg: 0 }); w.order(he, { type: 'move', x: 330, y: 120 }); const dr = S('T04', 0, 100, 100, { hdg: 0 }); w.order(dr, { type: 'move', x: 220, y: 300 });
    const j = S('A04', 0, 0, 0); const tg = S('A03', 1, 330, 150, { hdg: 3.1, passive: true }); S('T04', 0, 318, 160, { passive: true }); w.order(j, { type: 'attack', target: tg.id });
    app.lookAt(200, 220, 10, 230, -1.2, 0.75);
  } else if (name === 'battle') {
    const blue = ['H01', 'H01', 'H01', 'H02', 'A01', 'A01', 'A02', 'H03', 'A03', 'T03', 'T01', 'T02'], red = ['T01', 'T01', 'T02', 'A01', 'A02', 'H01', 'H02', 'A03', 'T03', 'H03', 'H01', 'A01'];
    // open ground east of the ridge, between the bunker and the rock fields
    blue.forEach((id, k) => S(id, 0, 262 + (k % 4) * 7, 150 + Math.floor(k / 4) * 9, { hdg: 0 })); red.forEach((id, k) => S(id, 1, 410 + (k % 4) * 7, 140 + Math.floor(k / 4) * 9, { hdg: Math.PI }));
    S('H04', 0, 240, 160); S('T04', 1, 440, 160); S('A04', 0, 0, 0);
    for (const u of w.units) if (u.kind !== 'jet') w.order(u, { type: 'attackMove', x: u.team ? 270 : 420, y: 155 });
    app.lookAt(345, 152, 8, 120, -1.3, 0.7);
  } else if (name === 'sortie') {
    const j = S('A04', 0, 0, 0); const col = [S('H03', 1, 300, 210, { hdg: 3.1 }), S('H03', 1, 310, 216, { hdg: 3.1 }), S('H01', 1, 296, 204)]; S('T04', 0, 285, 220, { passive: true });
    for (const u of col) { u.passive = true; } w.order(j, { type: 'attack', target: col[0].id }); app.selected = new Set([j.id]); app.selTeam = 0; app.lookAt(190, 140, 10, 170, -1.1, 0.6);
  } else if (name === 'emp') {
    const d = S('T02', 0, 255, 120, { hdg: 0 }); const tk = S('H03', 1, 330, 120, { hdg: Math.PI }); w.order(tk, { type: 'move', x: 240, y: 120 }); tk.passive = true;
    app.at(7.0, () => w.order(d, { type: 'emp', target: tk.id }));   // once the tank is inside the Disruptor's 40 m sight
    const dr = S('T04', 0, 192, 60); const hid = S('A03', 1, 252, 60, { passive: true }); app.at(2.5, () => w.order(dr, { type: 'scan', x: hid.x, y: hid.y }));
    app.selected = new Set([d.id]); app.selTeam = 0; app.lookAt(260, 100, 10, 110, -1.3, 0.65);
  } else if (name === 'garrison') {
    const b = w.buildings.find((x) => x.name === 'Bunker'); const g = ['H01', 'A01', 'T01', 'H01'].map((id, k) => S(id, 0, 280 + k * 3, 170)); for (const u of g) w.order(u, { type: 'garrison', building: b.id });
    ['T01', 'T01', 'A01'].forEach((id, k) => { const u = S(id, 1, 330 + k * 3, 215); app.at(3, () => w.order(u, { type: 'attackMove', x: 300, y: 195 })); });
    app.lookAt(305, 195, 6, 70, -1.2, 0.75);
  } else if (name === 'deploy') {
    const r = [S('A01', 0, 250, 200, { hdg: 0 }), S('A01', 0, 250, 206, { hdg: 0 }), S('A02', 0, 248, 212, { hdg: 0 })]; for (const u of r) w.order(u, { type: 'deploy' });
    const e = [S('H01', 1, 330, 200), S('H01', 1, 332, 205), S('T01', 1, 334, 210), S('H03', 1, 345, 212), S('H04', 1, 360, 200)]; app.at(2, () => { for (const u of e) w.order(u, { type: 'attackMove', x: 240, y: 205 }); });
    app.lookAt(265, 205, 8, 70, -1.25, 0.6);
  } else if (name === 'naval') {
    const b = [S('H05', 0, 520, 140, { hdg: 1.2 }), S('A05', 0, 560, 100, { hdg: 1.2 })], r = [S('T05', 1, 590, 300, { hdg: -1.6 }), S('H05', 1, 610, 330, { hdg: -1.6 })];
    S('H04', 1, 600, 250); for (const u of b) w.order(u, { type: 'attackMove', x: 590, y: 300 }); for (const u of r) w.order(u, { type: 'attackMove', x: 540, y: 130 });
    app.lookAt(560, 220, 0, 190, -1.3, 0.6);
  } else if (name === 'economy') {   // one harvester working the near field from the refinery's unloading grate
    const E = app.econ; const hv = S('HV', 0, E.dock.grate[0], E.dock.grate[1], { hdg: E.dock.face, noSnap: true, passive: true }); w.harvest(hv, 'near'); app.econPred = null;
    app.lookAt(360, 36, 6, 150, -1.15, 0.75);
  }
  toast({ tour: 'Domain tour: every unit crosses its own terrain', battle: 'Live fire: two mixed teams attack-move', sortie: 'Kestrel sortie: take-off, bomb run, return, land, reload', emp: 'EMP slows a tank; the Mote scans behind the ridge', garrison: 'Infantry garrison the bunker and fire from its ports', deploy: 'Rangers and a Missile Specialist deploy', economy: 'Economy: a harvester loads at the rig, drives back, reverses onto the refinery grate and unloads', naval: 'Naval duel around the island', clear: 'Cleared' }[name] || name);
}
app.at = (dt, fn) => { app.timers = app.timers || []; app.timers.push({ t: app.world.t + dt, fn }); };
app.scenario = scenario; app.setSpeed = (s) => { app.speed = s; };
// frame a unit: az = angle around it relative to its heading (0 = in front), el = elevation (rad)
app.frameUnit = (id, dist, az = 0.6, el = 0.35, lift = null) => { const v = app.views.get(id); if (!v) return; const p = v.group.position.clone(); const u = v.u;
  const h = lift == null ? Math.min(u.sp.dimensions_m.height * 0.5, 3) + (u.kind === 'heli' || u.kind === 'drone' || u.kind === 'jet' ? 0 : 0) : lift; const tgt = p.clone().add(new THREE.Vector3(0, h, 0)); const yaw = u.hdg + az;
  app.controls.target.copy(tgt); app.camera.position.set(tgt.x + Math.cos(yaw) * Math.cos(el) * dist, tgt.y + Math.sin(el) * dist, tgt.z - Math.sin(yaw) * Math.cos(el) * dist); app.camera.lookAt(tgt); app.controls.update(); app.cam = 'free'; };
app.select = (ids, cam) => { app.selected = new Set(ids); const u = app.world.byId.get(ids[0]); app.selTeam = u ? u.team : 0; if (cam) { app.cam = cam; app._closeSet = false; } };
app.stats = () => { const f = app.manual ? (app.tickList || []).slice(-600) : app.frames.slice(-300); const s = [...f].sort((a, b) => a - b); return { avg: f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1], simMs: app.simMs, calls: app.renderer.info.render.calls, tris: app.renderer.info.render.triangles, units: app.world.units.filter((u) => u.alive).length, smooth: app.smooth, feet: app.feet, tracks: app.tracks, errors: app.errors, t: app.world.t, tickMs: app.tickMs }; };
app.resetMeasures = () => { app.prof = null; app.smooth = { jumps: 0, samples: 0, worst: 0, list: [] }; app.feet = { stances: 0, worst: 0, sum: 0, list: [] }; app.tracks = { worst: 0, samples: 0 }; app.tickList = []; };

boot().catch((e) => { app.errors.push('boot: ' + (e.stack || e)); $('#loading').textContent = 'Failed to load: ' + e.message; console.error(e); });
