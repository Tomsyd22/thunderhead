// Mouse and keyboard: selection (click, box, double-click same type, control groups), orders (smart right-click, attack-move,
// guard, stop, deploy, ability, shift-queued waypoints), rally points, structure placement with a live ghost and the build
// radius, camera controls. Every order is acknowledged the same frame: ground marker, radio squelch + unit voice, and the
// order goes straight into the simulation (units start turning on the next tick).
import * as THREE from 'three';
import { STRUCTURES, ITEM_KEYS, TAB_KEYS, RULES } from './rules.js';

const V3 = THREE.Vector3;
const COL = { move: 0x7cf29a, attack: 0xff5a5a, amove: 0xffb35a, guard: 0x6fb8ff, rally: 0xf2e86d, harvest: 0xd8c27a, repair: 0xf2c230 };

// wrench cursor (repair mode, or engineers over a damaged friendly structure); hotspot at the jaw
const WRENCH_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g transform="rotate(-40 14 14)" fill="none" stroke-linecap="round"><g stroke="#15181b" stroke-width="6.5"><path d="M14 12v13"/><path d="M18.6 4.2a6 6 0 1 1-9.2 0"/></g><g stroke="#f2c230" stroke-width="3.6"><path d="M14 12v13"/><path d="M18.6 4.2a6 6 0 1 1-9.2 0"/></g></g></svg>')}") 8 6, pointer`;
const MIN_PICK_R = 22;   // px radius: 44 px target (Apple HIG 44 pt / Material 48 dp)

export class Input {
  constructor(C) {
    this.C = C; this.mode = null; this.mouse = { x: innerWidth / 2, y: innerHeight / 2 }; this.down = null; this.box = null;
    this.lastClick = { t: 0, id: null }; this.groupTap = { n: null, t: 0 }; this.place = null; this.hover = null; this.frameNo = 0;
    const cv = this.cv = document.querySelector('#view');
    cv.addEventListener('pointerdown', (e) => this.onDown(e)); addEventListener('pointermove', (e) => this.onMove(e)); addEventListener('pointerup', (e) => this.onUp(e));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1); this.C.rcam.wheel(dy, e.clientX, e.clientY, this.groundAt(e.clientX, e.clientY)); }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault()); document.addEventListener('mouseleave', () => { this.C.rcam.mouse = null; });
    addEventListener('keydown', (e) => this.onKey(e)); addEventListener('keyup', (e) => { this.C.rcam.keys[e.key] = false; });
    addEventListener('blur', () => { this.C.rcam.keys = {}; });
    this.ray = new THREE.Raycaster(); this.ghostMats = { ok: new THREE.MeshBasicMaterial({ color: 0x6cff9a, transparent: true, opacity: 0.38, depthWrite: false }), bad: new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.42, depthWrite: false }) };
  }
  // ───────── picking ─────────
  groundAt(cx, cy) {   // ray-march the camera ray against the drawn ground (terrain, decks) and the water surface
    const C = this.C, T = C.T; this.ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), C.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction; const gAt = (t) => { const x = o.x + d.x * t, y = -(o.z + d.z * t); return [x, y, Math.max(T.surface(Math.min(Math.max(x, 0), T.W), Math.min(Math.max(y, 0), T.H)), 0), o.y + d.y * t]; };
    let prev = 0;
    for (let t = 2; t < 6000; t += t < 200 ? 2 : 6) { const [, , g, h] = gAt(t); if (h <= g) { let a = prev, b = t; for (let k = 0; k < 18; k++) { const m = (a + b) / 2, q = gAt(m); if (q[3] <= q[2]) b = m; else a = m; } const q = gAt(b); if (q[0] < 0 || q[1] < 0 || q[0] > T.W || q[1] > T.H) return null; return { x: q[0], y: q[1], z: q[2] }; } prev = t; if (o.y + d.y * t < -50) break; }
    return null;
  }
  proj(v) { const p = v.clone().project(this.C.camera); return p.z < 1 && p.z > -1 ? [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight] : null; }
  pxPerM(pos) { const C = this.C; return innerHeight / (2 * Math.tan(C.camera.fov * Math.PI / 360) * Math.max(1, C.camera.position.distanceTo(pos))); }
  unitAt(cx, cy, pred = () => true) {
    let best = null, bd = 1e9;
    for (const [, v] of this.C.P.views) { const u = v.u; if (!u.alive || u.hidden || !v.group.visible || !pred(u)) continue;
      const vs = v.vs || 1, c = v.group.position.clone().add(new V3(0, Math.min(u.sp.dimensions_m.height * 0.5 * vs, 3 * vs), 0)); const p = this.proj(c); if (!p) continue;
      // hit area follows the drawn (scaled) model and is never smaller than a 44 px circle (touch-target minimum)
      const r = Math.max(MIN_PICK_R, Math.max(u.sp.dimensions_m.length, u.sp.dimensions_m.width, u.kind === 'foot' ? 1.4 : 0) * 0.55 * vs * this.pxPerM(c)); const d = Math.hypot(p[0] - cx, p[1] - cy); if (d < r && d < bd) { bd = d; best = u; } }
    return best;
  }
  structAt(cx, cy, g = null) {
    g = g || this.groundAt(cx, cy); const C = this.C; let best = null;
    for (const [, sv] of C.P.structs) { const b = sv.b; if (!b.alive) continue;
      if (g && Math.abs(g.x - b.x) <= b.w / 2 + 1 && Math.abs(g.y - b.y) <= b.d / 2 + 1) return b;
      const p = this.proj(new V3(b.x, b.z + sv.h * 0.6, -b.y)); if (p && Math.hypot(p[0] - cx, p[1] - cy) < Math.max(b.w, b.d) * 0.4 * this.pxPerM(new V3(b.x, b.z, -b.y))) best = b; }
    return best;
  }
  depositAt(g) { if (!g) return null; const G = this.C.game; if (G.ore) { const h = G.ore.fieldAt(g.x, g.y, 6); return h ? h.F.dep : null; } return G.deposits.find((d) => Math.hypot(d.pos[0] - g.x, d.pos[1] - g.y) < 32) || null; }
  selUnits() { const C = this.C; return [...C.sel].map((id) => C.world.byId.get(id)).filter((u) => u && u.alive && !u.isBuilding && u.team === C.p.team); }
  selStruct() { const C = this.C; const b = [...C.sel].map((id) => C.world.byId.get(id)).find((o) => o && o.isBuilding && o.alive && o.team === C.p.team); return b || null; }

  // ───────── pointer ─────────
  onDown(e) {
    const C = this.C; if (!C.started) return; this.cv.focus?.();
    if (e.button === 1) { e.preventDefault(); C.rcam.dragStart(e.clientX, e.clientY); this.down = { b: 1 }; return; }
    this.down = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, t: performance.now() };
    if (e.button === 0 && !this.place && !this.mode) this.box = null;
  }
  onMove(e) {
    const C = this.C; this.mouse = { x: e.clientX, y: e.clientY }; if (C.rcam) C.rcam.mouse = { x: e.clientX, y: e.clientY };
    if (this.down && this.down.b === 1) { C.rcam.dragMove(e.clientX, e.clientY); return; }
    if (this.down && this.down.b === 0 && !this.place && !this.mode && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) this.box = [[this.down.x, this.down.y], [e.clientX, e.clientY]];
  }
  onUp(e) {
    const C = this.C, d = this.down; this.down = null; if (!d || !C.started) return;
    if (d.b === 1) { C.rcam.dragEnd(); return; }
    if (this.box && d.b === 0) { this.boxSelect(this.box, d.shift); this.box = null; return; }
    if (e.target !== this.cv) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    if (d.b === 0) this.leftClick(e.clientX, e.clientY, d);
    else if (d.b === 2) this.rightClick(e.clientX, e.clientY, d);
  }
  leftClick(cx, cy, d) {
    const C = this.C;
    if (this.place) { this.tryPlace(); return; }
    if (this.mode === 'repair') { this.repairClick(cx, cy); return; }   // stays on until K, Esc or right-click (RA2)
    if (this.mode) { this.order(cx, cy, d.shift, this.mode); if (!d.shift) this.setMode(null); return; }
    const u = this.unitAt(cx, cy), now = performance.now();
    if (u) {
      if (u.team === C.p.team && now - this.lastClick.t < 380 && this.lastClick.id === u.id) {   // double-click: every unit of this type on screen
        const same = []; for (const [, v] of C.P.views) { const q = v.u; if (q.alive && q.team === C.p.team && q.uid === u.uid && v.group.visible) { const p = this.proj(v.group.position); if (p && p[0] >= 0 && p[0] <= innerWidth - 268 && p[1] >= 0 && p[1] <= innerHeight) same.push(q.id); } }
        this.select(d.shift ? [...C.sel, ...same] : same, true); this.lastClick = { t: 0, id: null }; return;
      }
      this.lastClick = { t: now, id: u.id };
      if (u.team !== C.p.team) { if (!d.shift) this.select([u.id], false); return; }   // enemy: inspect only
      if (d.shift) { const s = new Set([...C.sel].filter((id) => { const o = C.world.byId.get(id); return o && !o.isBuilding; })); if (s.has(u.id)) s.delete(u.id); else s.add(u.id); this.select([...s], false); }
      else this.select([u.id], true);
      return;
    }
    const b = this.structAt(cx, cy);
    if (b) { this.select([b.id], false); if (b.team === C.p.team && C.audio) C.audio.sfx('select'); return; }
    if (!d.shift) this.select([], false);
  }
  boxSelect([a, b], add) {
    const C = this.C, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); const ids = [];
    for (const [id, v] of C.P.views) { const u = v.u; if (!u.alive || u.team !== C.p.team || u.hidden) continue; const p = this.proj(v.group.position.clone().add(new V3(0, 0.8, 0))); if (p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) ids.push(id); }
    let pick = ids; const combat = ids.filter((id) => C.world.byId.get(id).uid !== 'HV'); if (combat.length) pick = combat;   // harvesters only when nothing else is in the box
    const base = add ? [...C.sel].filter((id) => { const o = C.world.byId.get(id); return o && !o.isBuilding; }) : [];
    this.select([...new Set([...base, ...pick])], true);
  }
  select(ids, voice) {
    const C = this.C; C.sel = new Set(ids.filter((id) => { const o = C.world.byId.get(id); return o && o.alive; }));
    if (this.mode && this.mode !== 'repair' && !this.selUnits().length) this.setMode(null);
    const us = this.selUnits(); if (voice && us.length && C.audio) { try { C.audio.sfx('select'); C.audio.unitVoice(us[0].uid, 'select', C.p.faction); } catch (e) { /* optional */ } }
    C.ui.selChanged();
  }
  setMode(m) { this.mode = m; this.C.ui.modeChanged(m); }
  toggleRepairMode() { const C = this.C; if (this.place) this.cancelPlace(true); this.setMode(this.mode === 'repair' ? null : 'repair'); if (C.audio) C.audio.sfx('ui_click'); }
  /** repair mode: a click on one of your structures starts or stops its repair */
  repairClick(cx, cy) {
    const C = this.C, b = this.structAt(cx, cy);
    if (!b || b.team !== C.p.team) { if (C.audio) C.audio.sfx('ui_error'); return; }
    const r = C.game.toggleRepair(C.p, b);
    if (r === null) { if (C.audio) C.audio.sfx('ui_error'); C.ui.toast('Already at full health'); return; }
    if (C.audio) C.audio.sfx('ui_click'); this.marker(b.x, b.y, r ? COL.repair : COL.move, Math.max(b.w, b.d) * 0.45);
  }
  repairable(b) { return b && b.alive && b.isBuilding && b.team === this.C.p.team && b.hp < b.maxHp - 0.5; }

  // ───────── orders ─────────
  rightClick(cx, cy, d) {
    const C = this.C;
    if (this.place) { this.cancelPlace(); return; }
    if (this.mode) { this.setMode(null); return; }
    this.order(cx, cy, d.shift, 'smart');
  }
  /** issue an order for the selection at a screen point. kind: smart | attackMove | guard | ability */
  order(cx, cy, queue, kind) {
    const C = this.C, W = C.world, units = this.selUnits(); const g = this.groundAt(cx, cy);
    const sb = this.selStruct();
    if (!units.length) { if (sb && g && STRUCTURES[sb.kind].produces) { sb.rally = [g.x, g.y]; this.marker(g.x, g.y, COL.rally); this.ack(null, 'move', g); C.ui.toast('Rally point set'); } return; }
    const tu = this.unitAt(cx, cy, (u) => u.team !== C.p.team && W.visible(C.p.team, u)); const tb = tu ? null : this.structAt(cx, cy, g);
    const enemy = tu || (tb && tb.team !== C.p.team && tb.team >= 0 ? tb : null);
    if (kind === 'ability') {
      let did = false; for (const u of units) { if (u.m.emp && tu) { W.order(u, { type: 'emp', target: tu.id }); did = true; } if (u.m.scan && g) { W.order(u, { type: 'scan', x: g.x, y: g.y }); did = true; } }
      if (did) { if (tu) this.marker(tu.x, tu.y, 0x6fe6d4, 3); else if (g) this.marker(g.x, g.y, 0x6fe6d4); this.ack(units[0], 'attack', g); } else if (C.audio) C.audio.sfx('ui_error'); return;
    }
    if (kind === 'guard') { if (!g) return; const o = { type: 'guard', x: g.x, y: g.y }; for (const u of units) queue ? W.queueOrder(u, o) : W.order(u, o); this.marker(g.x, g.y, COL.guard); this.ack(units[0], 'move', g); return; }
    const eng = units.filter((u) => u.m.engineer);
    if (eng.length && kind === 'smart' && tb && tb.team === C.p.team) {
      if (!this.repairable(tb)) { if (C.audio) C.audio.sfx('ui_error'); C.ui.toast('Already at full health'); return; }
      const e0 = eng.sort((a, b) => Math.hypot(a.x - tb.x, a.y - tb.y) - Math.hypot(b.x - tb.x, b.y - tb.y))[0];   // one engineer restores it fully
      W.order(e0, { type: 'enter', building: tb.id }); this.marker(tb.x, tb.y, COL.repair, Math.max(tb.w, tb.d) * 0.45); this.ack(e0, 'move', g); return;
    }
    if (enemy && kind !== 'attackMove') {
      for (const u of units) { const o = { type: 'attack', target: enemy.id }; if (u.uid === 'HV' || u.m.engineer) continue; queue ? W.queueOrder(u, o) : W.order(u, o); }
      this.marker(enemy.x, enemy.y, COL.attack, enemy.isBuilding ? Math.max(enemy.w, enemy.d) * 0.6 : 3); this.ack(units.find((u) => u.uid !== 'HV') || units[0], 'attack', g); return;
    }
    // harvesters: right-click a refinery to unload there, or an ore field to work it
    const harv = units.filter((u) => u.uid === 'HV');
    if (harv.length && kind === 'smart') {
      const dep = this.depositAt(g); const own = tb && tb.team === C.p.team && tb.dock ? tb : null;
      if (dep || own) { for (const h of harv) { const d0 = dep || (h.harv && h.harv.dep) || C.game.nextDeposit(h); const dock = own ? own.dock : C.game.bestDock(h); if (d0 && dock) W.harvest(h, d0, dock); }
        this.marker(dep ? g.x : own.dock.approach[0], dep ? g.y : own.dock.approach[1], COL.harvest); this.ack(harv[0], 'move', g); if (units.length === harv.length) return; }
    }
    if (!g) return;
    const rest = units.filter((u) => !(harv.length && kind === 'smart' && (this.depositAt(g) || (tb && tb.dock && tb.team === C.p.team)) && u.uid === 'HV'));
    if (!rest.length) return;
    const type = kind === 'attackMove' ? 'attackMove' : 'move';
    if (queue) {   // waypoint: each unit keeps its place in the group around the new point
      const cx0 = rest.reduce((a, u) => a + u.x, 0) / rest.length, cy0 = rest.reduce((a, u) => a + u.y, 0) / rest.length;
      for (const u of rest) { const q = u.queue && u.queue.length ? u.queue[u.queue.length - 1] : (u.order.x != null ? u.order : u); const bx = q.x != null ? q.x : u.x, by = q.y != null ? q.y : u.y;
        const ox = Math.max(-20, Math.min(20, bx - cx0)), oy = Math.max(-20, Math.min(20, by - cy0)); W.queueOrder(u, { type, x: g.x + ox * 0.5, y: g.y + oy * 0.5 }); }
    } else W.orderGroup(rest, { type, x: g.x, y: g.y });
    this.marker(g.x, g.y, type === 'attackMove' ? COL.amove : COL.move); this.ack(rest[0], type === 'attackMove' ? 'attack' : 'move', g);
  }
  marker(x, y, color, r = 2.6) { const C = this.C, z = Math.max(C.T.surface(x, y), 0); C.P.fx.ring(x, -y, z, r * 1.6, r * 0.25, 0.45, color, { a: 0.95 }); C.P.fx.ring(x, -y, z, r * 0.4, r * 0.4, 0.45, color, { a: 0.7, disc: true }); }
  ack(u, kind, g) {
    const C = this.C; C.acks.push({ t: performance.now(), frame: this.frameNo, kind, uid: u ? u.uid : null, x: g ? g.x : null, y: g ? g.y : null });
    if (C.acks.length > 50) C.acks.shift();
    if (!C.audio) return; try { if (u) C.audio.unitVoice(u.uid, kind, C.p.faction); else C.audio.sfx('order_ack'); } catch (e) { /* optional */ }   // unit voices carry their own radio squelch
  }
  immediate(type) {
    const C = this.C, W = C.world, units = this.selUnits(); if (!units.length) return;
    if (type === 'stop') { for (const u of units) W.order(u, { type: 'stop' }); this.ack(units[0], 'move', null); }
    if (type === 'deploy') { let did = false; for (const u of units) if (u.m.deploy) { W.order(u, { type: u.deploy === 'deployed' ? 'undeploy' : 'deploy' }); did = true; } if (did) this.ack(units.find((u) => u.m.deploy), 'move', null); else if (C.audio) C.audio.sfx('ui_error'); }
    if (type === 'guardHere') { for (const u of units) W.order(u, { type: 'guard', x: u.x, y: u.y }); this.ack(units[0], 'move', null); for (const u of units) this.marker(u.x, u.y, COL.guard, 1.5); }
  }

  // ───────── structure placement ─────────
  startPlace(key) {
    const C = this.C; if (!C.p.ready || C.p.ready.key !== key) return; this.cancelPlace(true);
    const S = STRUCTURES[key], proto = C.bprotos[S.model]; let g;
    if (proto) { g = proto.clone(true); g.traverse((o) => { if (o.isMesh) { o.material = this.ghostMats.ok; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 6; } }); }
    else { g = new THREE.Mesh(new THREE.BoxGeometry(S.size[0], S.h, S.size[1]).translate(0, S.h / 2, 0), this.ghostMats.ok); }
    const root = new THREE.Group(); root.add(g);
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6cff9a, transparent: true, opacity: 0.22, depthWrite: false })); fp.renderOrder = 5; root.add(fp);
    // keep-clear lanes in front of doors / the refinery dock, drawn with the ghost (they turn with it)
    const lanes = new THREE.Group(); const laneMat = new THREE.MeshBasicMaterial({ color: 0x6cff9a, transparent: true, opacity: 0.28, depthWrite: false }); root.add(lanes);
    for (const L of S.lanes || []) { const len = Math.abs(L.y1 - L.y0), sg = Math.sign(L.y1 - L.y0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L.w, len).rotateX(-Math.PI / 2), laneMat); m.position.set(L.x, 0.45, -(L.y0 + L.y1) / 2); m.renderOrder = 5; lanes.add(m);
      for (let k = 0; k < 2; k++) { const ch = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-L.w * 0.3, 0), new THREE.Vector2(0, L.w * 0.3), new THREE.Vector2(L.w * 0.3, 0), new THREE.Vector2(L.w * 0.3, -1.2), new THREE.Vector2(0, L.w * 0.3 - 1.2), new THREE.Vector2(-L.w * 0.3, -1.2)])).rotateX(-Math.PI / 2), laneMat);
        ch.rotation.y = sg > 0 ? 0 : Math.PI; ch.position.set(L.x, 0.5, -(L.y0 + sg * (len * (0.35 + 0.35 * k)))); ch.renderOrder = 5; lanes.add(ch); } }
    C.scene.add(root); this.place = { key, root, model: g, fp, lanes, laneMat, ok: false, c: null, rot: null };
    this.radius = this.buildRadius(); C.scene.add(this.radius); C.ui.modeChanged('place');
  }
  /** turn the structure being placed by 90° (dir +1 = clockwise on screen from above); from then on the player's angle
   * holds instead of the automatic one. Naval yards keep their dock site's frame. */
  rotatePlace(dir = 1) {
    const C = this.C, P = this.place; if (!P) return; if (STRUCTURES[P.key].naval) { C.ui.toast('Naval yards face the open water of their dock site'); return; }
    const cur = P.rot != null ? P.rot : P.c ? P.c.rot : C.game.autoRot(C.p, P.key, 0, 0); P.rot = Math.round((cur - dir * Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
    if (C.audio) C.audio.sfx('ui_click'); this.updateGhost(); C.ui.modeChanged('place');
  }
  cancelPlace(silent) { const C = this.C; if (!this.place) return; C.scene.remove(this.place.root); if (this.radius) { C.scene.remove(this.radius); this.radius.traverse((o) => o.geometry && o.geometry.dispose()); this.radius = null; } this.place = null; if (!silent) C.ui.modeChanged(null); }
  tryPlace() {
    const C = this.C, P = this.place; if (!P) return; this.updateGhost();   // judge the spot under the pointer now, not as of the last frame
    if (!P.c) return;
    if (!P.c.ok) { if (C.audio) { C.audio.sfx('ui_error'); C.audio.announce('cannot_place'); } C.ui.toast(P.c.reason); return; }
    const r = C.game.place(C.p, P.c.x, P.c.y, P.rot); if (r.ok) { C.acks.push({ t: performance.now(), frame: this.frameNo, kind: 'place', key: P.key }); this.cancelPlace(); }
  }
  /** outline of everywhere a new structure may touch: each structure's footprint grown by the build gap, draped on the ground */
  buildRadius() {
    const C = this.C, T = C.T, grp = new THREE.Group(), mat = new THREE.LineDashedMaterial({ color: 0x9fe8ff, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.85, depthTest: false });
    const fill = new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.07, depthWrite: false, depthTest: false });
    for (const b of C.game.structures(C.p)) {
      const gx = b.w / 2 + RULES.buildGap, gy = b.d / 2 + RULES.buildGap, pts = [];
      const corners = [[-gx, -gy], [gx, -gy], [gx, gy], [-gx, gy], [-gx, -gy]];
      for (let k = 0; k < 4; k++) { const [ax, ay] = corners[k], [bx, by] = corners[k + 1], L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 4); for (let i = 0; i < n; i++) { const x = b.x + ax + (bx - ax) * i / n, y = b.y + ay + (by - ay) * i / n; pts.push(new V3(x, Math.max(T.height(x, y), 0) + 0.6, -y)); } }
      pts.push(pts[0].clone()); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); line.computeLineDistances(); line.renderOrder = 7; grp.add(line);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(gx * 2, gy * 2).rotateX(-Math.PI / 2), fill); q.position.set(b.x, b.z + 0.4, -b.y); q.renderOrder = 4; grp.add(q);
    }
    return grp;
  }
  updateGhost() {
    const C = this.C, P = this.place; if (!P) return; const g = this.groundAt(this.mouse.x, this.mouse.y); if (!g) { P.root.visible = false; P.c = null; return; }
    const c = C.game.canPlace(C.p, P.key, g.x, g.y, P.rot); P.c = c; P.root.visible = true;
    const S = STRUCTURES[P.key]; const z = S.naval ? 3 : Math.max(C.T.height(c.x, c.y), 0);
    P.root.position.set(c.x, z, -c.y); P.model.rotation.y = c.rot; P.lanes.rotation.y = c.rot; P.laneMat.color.setHex(c.ok ? 0x6cff9a : 0xff5a4a); P.fp.scale.set(c.rect.w, 1, c.rect.d); P.fp.position.y = 0.35;
    const m = c.ok ? this.ghostMats.ok : this.ghostMats.bad; P.model.traverse((o) => { if (o.isMesh) o.material = m; }); P.fp.material.color.setHex(c.ok ? 0x6cff9a : 0xff5a4a);
  }

  // ───────── keyboard ─────────
  onKey(e) {
    const C = this.C; if (!C.started) return; const k = e.key, kl = k.length === 1 ? k.toLowerCase() : k;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && k !== 'Escape') return;
    if (this.place && (k === 'ArrowLeft' || k === 'ArrowRight' || kl === 'r' || k === ',' || k === '.')) { e.preventDefault(); this.rotatePlace(k === 'ArrowLeft' || k === ',' ? -1 : 1); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) { C.rcam.keys[k] = true; e.preventDefault(); return; }
    if (k === 'Escape') { if (this.place) this.cancelPlace(); else if (this.mode) this.setMode(null); else this.select([], false); C.ui.closePanels(); return; }
    if (/^Digit[1-9]$/.test(e.code)) { this.groupKey(+e.code.slice(5), e.ctrlKey || e.metaKey, e.shiftKey); e.preventDefault(); return; }
    if (k === ' ') { e.preventDefault(); const a = C.alerts[C.alerts.length - 1]; if (a) C.rcam.flyTo(a.x, a.y, 0.3); return; }
    if (k === 'p' || k === 'P' || k === 'Pause') { C.paused = !C.paused; C.ui.pauseChanged(); return; }
    if (k === '+' || k === '=' || k === '-' || k === '_') { const P = C.pace, v = Math.round((P.game_speed + (k === '-' || k === '_' ? -0.2 : 0.2)) * 10) / 10; C.setPace({ game_speed: Math.max(P.game_speed_range[0], Math.min(P.game_speed_range[1], v)) }); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tab = Object.entries(TAB_KEYS).find(([, key]) => key === kl); if (tab) { C.ui.setTab(tab[0]); return; }
    const idx = ITEM_KEYS.indexOf(kl); if (idx >= 0) { C.ui.pressItem(idx, e.shiftKey ? 5 : 1); return; }
    if (kl === 'a') { if (this.selUnits().length) this.setMode('attackMove'); return; }
    if (kl === 's') { this.immediate('stop'); return; }
    if (kl === 'g') { if (this.mode === 'guard') { this.immediate('guardHere'); this.setMode(null); } else if (this.selUnits().length) this.setMode('guard'); return; }
    if (kl === 'd') { this.immediate('deploy'); return; }
    if (kl === 'f') { if (this.selUnits().some((u) => u.m.emp || u.m.scan)) this.setMode('ability'); else if (C.audio) C.audio.sfx('ui_error'); return; }
    if (kl === 'k') { this.toggleRepairMode(); return; }
    if (kl === 'h') { const y = C.world.byId.get(C.p.yard) || C.game.structures(C.p)[0]; if (y) { C.rcam.flyTo(y.x, y.y, 0.3); this.select([y.id], false); } return; }
    if (kl === 'i') { C.ui.cycleIdle('harv'); return; }
    if (kl === 'o') { C.ui.cycleIdle('units'); return; }
    if (k === 'F10' || kl === 'm' && false) { C.ui.toggleSettings(); }
  }
  groupKey(n, ctrl, shift) {
    const C = this.C, now = performance.now();
    if (ctrl) { C.groups[n] = this.selUnits().map((u) => u.id); C.ui.toast(`Group ${n}: ${C.groups[n].length} unit${C.groups[n].length === 1 ? '' : 's'}`); return; }
    const ids = (C.groups[n] || []).filter((id) => { const u = C.world.byId.get(id); return u && u.alive; }); C.groups[n] = ids;
    if (shift) { this.select([...C.sel, ...ids], true); return; }
    if (!ids.length) return;
    const dbl = this.groupTap.n === n && now - this.groupTap.t < 400; this.groupTap = { n, t: now };
    this.select(ids, !dbl);
    if (dbl) { const us = ids.map((id) => C.world.byId.get(id)); C.rcam.flyTo(us.reduce((a, u) => a + u.x, 0) / us.length, us.reduce((a, u) => a + u.y, 0) / us.length, 0.25); }
  }
  frame() {
    this.frameNo++; if (this.place) this.updateGhost();
    if (this.frameNo % 3 === 0 && !this.down) {   // hover feedback: cursor shape and the hovered unit's health bar
      const C = this.C, u = this.unitAt(this.mouse.x, this.mouse.y); this.hover = u ? u.id : null;
      let cur = 'default'; const sel = this.selUnits().length;
      const eng = this.selUnits().some((q) => q.m.engineer);
      if (this.mode === 'repair' || (eng && !u)) { const b = u ? null : this.structAt(this.mouse.x, this.mouse.y); cur = this.repairable(b) ? WRENCH_CURSOR : this.mode === 'repair' ? 'not-allowed' : 'default'; }
      else if (this.place) cur = 'crosshair'; else if (this.mode === 'attackMove' || this.mode === 'ability') cur = 'crosshair'; else if (this.mode === 'guard') cur = 'cell';
      else if (u && u.team !== C.p.team && sel) cur = 'crosshair'; else if (u) cur = 'pointer'; else if (sel) cur = 'default';
      if (this.cv.style.cursor !== cur) this.cv.style.cursor = cur;
    }
  }
}
