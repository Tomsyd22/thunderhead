// Stage 2 browser tests: the real client in headless Chromium (software GL), driven through window.__game with a manual
// clock so results don't depend on the software rasteriser's speed.
//   node play/test_game.js [--only=name,name] [--shots] [--port=8793]
// Suites: boot, acks (order acknowledgement within 2 frames), controls, movement, building, camera, info, combat, smooth, match.
import fs from 'fs'; import path from 'path'; import http from 'http'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const DIR = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = +opt('port', 8793), ONLY = opt('only', '') ? opt('only', '').split(',') : null, SHOTS = args.includes('--shots');
const THREE_DIR = process.env.THREE_DIR || path.resolve(DIR, '../.cache/three-0.160.0'); const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const OUT = path.join(DIR, 'results'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
// the publish step wraps the page in a doctype skeleton; do the same for the local copy
fs.writeFileSync(path.join(DIR, 'index.local.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n' + fs.readFileSync(path.join(DIR, 'index.html'), 'utf8') + '\n</body></html>');
const get = (url) => new Promise((res, rej) => { const q = http.get(url, (r) => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.setTimeout(2000, () => q.destroy(new Error('timeout'))); });

let pass = 0, fail = 0; const lines = [];
const check = (name, ok, info = '') => { ok ? pass++ : fail++; const l = `${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`; lines.push(l); console.log(l); };
const want = (s) => !ONLY || ONLY.includes(s);

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if (await get(`http://127.0.0.1:${PORT}/index.local.html`) === 200) break; } catch (e) { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (qs, vp = { width: 1440, height: 860 }) => {
    const page = await browser.newPage({ viewport: vp }); const logs = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url()); }); page.on('pageerror', (e) => logs.push(String(e)));
    await page.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith(CDN)) { const f = path.join(THREE_DIR, u.slice(CDN.length).split('?')[0]); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: 'application/javascript' }); } return route.continue(); });
    const t0 = Date.now(); await page.goto(`http://127.0.0.1:${PORT}/index.local.html?${qs}`);
    await page.waitForFunction(() => window.__game && (window.__game.started || window.__game.errors.some((e) => e.startsWith('boot'))), null, { timeout: 240000 });
    return { page, logs, loadS: (Date.now() - t0) / 1000 };
  };
  const shot = async (page, name) => { if (!SHOTS) return; await page.evaluate(() => window.__game.renderNow()); await page.screenshot({ path: path.join(OUT, 'shots', name + '.png') }); };
  const results = {};
  const ev = (page, fn, arg) => page.evaluate(fn, arg);
  try {
    const { page, logs, loadS } = await open('autostart=1&manual=1&faction=compact&ai=lattice&quality=low&dpr=1');
    const boot = await ev(page, () => { const C = window.__game; C.advance(0.5, 60, 0); return { errors: C.errors.slice(), units: C.world.units.length, structs: C.P.structs.size, views: C.P.views.size, cameos: Object.keys(C.cameos || {}).length, audio: !!C.audio }; });
    check('boot: page loads and the match starts', boot.errors.length === 0 && boot.units >= 12, `${loadS.toFixed(1)} s, ${boot.units} units, ${boot.structs} structures, ${boot.views} unit views, ${boot.cameos} portraits, audio ${boot.audio}${boot.errors.length ? ' · ' + boot.errors.slice(0, 3).join(' | ') : ''}`);
    results.boot = boot; await shot(page, 'boot');
    // record every announcement and sound for the info checks
    await ev(page, () => { const C = window.__game; C.log = { ann: [], sfx: [], voice: [] }; if (C.audio) { const A = C.audio, a0 = A.announce.bind(A), s0 = A.sfx.bind(A), v0 = A.unitVoice.bind(A); A.announce = (k) => { C.log.ann.push(k); return a0(k); }; A.sfx = (n, o) => { C.log.sfx.push(n); return s0(n, o); }; A.unitVoice = (u, k, f) => { C.log.voice.push(k); return v0(u, k, f); }; } });
    const center = (await ev(page, () => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x + 20, y.y - 10, 120); C.advance(0.1); return [y.x, y.y]; }));

    if (want('acks')) {
      // box-select the four starting infantry with a real mouse drag
      const box = await ev(page, () => { const C = window.__game; const inf = C.world.units.filter((u) => u.team === 0 && u.kind === 'foot'); const pts = inf.map((u) => C.unitScreen(u.id)); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs) - 14, Math.min(...ys) - 14, Math.max(...xs) + 14, Math.max(...ys) + 14, inf.length]; });
      await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.move((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, { steps: 3 }); await page.mouse.move(box[2], box[3], { steps: 3 }); await page.mouse.up();
      const sel = await ev(page, () => { const C = window.__game; return [...C.sel].map((id) => C.world.byId.get(id).kind); });
      check('controls: drag box selects the infantry squad', sel.length === box[4] && sel.every((k) => k === 'foot'), `${sel.length} selected`);
      for (const gs of [2.4, 1.0]) {
        const pt = await ev(page, (gs) => { const C = window.__game; C.pace.game_speed = gs; const us = [...C.sel].map((id) => C.world.byId.get(id)); const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cy = us.reduce((a, u) => a + u.y, 0) / us.length; const tx = cx - 40, ty = cy - 25;
          C._pre = { acks: C.acks.length, rings: C.P.fx.rings.length, frame: C.input.frameNo, sfx: C.log.sfx.length, voice: C.log.voice.length, units: us.map((u) => ({ id: u.id, hdg: u.hdg, x: u.x, y: u.y })) }; return C.screenOf(tx, ty); }, gs);
        await page.mouse.click(pt[0], pt[1], { button: 'right' });
        const a0 = await ev(page, () => { const C = window.__game, q = C._pre, a = C.acks[C.acks.length - 1]; return { ack: C.acks.length > q.acks, sameFrame: a && a.frame === q.frame, rings: C.P.fx.rings.length - q.rings, sfx: C.log.sfx.slice(q.sfx), voice: C.log.voice.slice(q.voice), path: [...C.sel].every((id) => !!C.world.byId.get(id).path) }; });
        const a2 = await ev(page, () => { const C = window.__game; C.advance(2 / 60, 60, 0); return C._pre.units.map((s) => { const u = C.world.byId.get(s.id); return { moved: Math.hypot(u.x - s.x, u.y - s.y), turned: Math.abs(Math.atan2(Math.sin(u.hdg - s.hdg), Math.cos(u.hdg - s.hdg))), v: u.v }; }); });
        const started = a2.filter((r) => r.v > 0.01 || r.turned > 1e-4 || r.moved > 1e-4).length;
        check(`orders (${gs}×): acknowledged in the same frame (marker, radio, voice) and units react within 2 frames`, a0.ack && a0.sameFrame && a0.rings >= 1 && a0.path && started === a2.length && (!boot.audio || a0.voice.length >= 1),
          `marker rings +${a0.rings}, sounds [${a0.sfx.join(', ')}], voices ${a0.voice.length}, ${started}/${a2.length} units turning or moving after 2 frames`);
        await ev(page, () => window.__game.advance(1.5, 30, 0));
      }
      await ev(page, () => { window.__game.pace.game_speed = 2.4; });
    }

    if (want('controls')) {
      const tank = await ev(page, () => { const C = window.__game; const t = C.world.units.filter((u) => u.team === 0 && u.kind === 'tracked'); C.lookAt(t[0].x, t[0].y, 110); C.advance(0.05); return { s: C.unitScreen(t[0].id), n: t.length }; });
      await page.mouse.click(tank.s[0], tank.s[1]); await page.mouse.click(tank.s[0], tank.s[1]);   // two clicks inside 380 ms
      const dbl = await ev(page, () => { const C = window.__game; return [...C.sel].map((id) => C.world.byId.get(id).uid); });
      check('controls: double-click selects every unit of that type on screen', dbl.length === tank.n && dbl.every((u) => u === dbl[0]), `${dbl.length} × ${dbl[0]}`);
      await page.keyboard.down('Control'); await page.keyboard.press('Digit1'); await page.keyboard.up('Control');
      await page.keyboard.press('Escape'); const none = await ev(page, () => window.__game.sel.size);
      await page.keyboard.press('Digit1'); const g1 = await ev(page, () => window.__game.sel.size);
      const f0 = await ev(page, () => { const C = window.__game; C.lookAt(900, 900, 160); return [C.rcam.fx, C.rcam.fy]; });
      await page.keyboard.press('Digit1'); await page.keyboard.press('Digit1'); const f1 = await ev(page, () => { const C = window.__game; C.advance(0.6, 60, 0); return [C.rcam.fx, C.rcam.fy]; });
      check('controls: Ctrl+1 assigns, 1 recalls, double-tap centres the camera', none === 0 && g1 === tank.n && Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) > 200, `recalled ${g1}, camera moved ${Math.hypot(f1[0] - f0[0], f1[1] - f0[1]).toFixed(0)} m`);
      const q = await ev(page, () => { const C = window.__game; const us = [...C.sel].map((id) => C.world.byId.get(id)); C.lookAt(us[0].x, us[0].y, 140); C.advance(0.05); return [C.screenOf(us[0].x - 30, us[0].y + 10), C.screenOf(us[0].x - 50, us[0].y - 30)]; });
      await page.mouse.click(q[0][0], q[0][1], { button: 'right' }); await page.keyboard.down('Shift'); await page.mouse.click(q[1][0], q[1][1], { button: 'right' }); await page.keyboard.up('Shift');
      const queued = await ev(page, () => { const C = window.__game; return [...C.sel].map((id) => (C.world.byId.get(id).queue || []).length); });
      check('controls: shift-right-click queues a waypoint', queued.every((n) => n >= 1), `queues ${queued.join(', ')}`);
      await page.keyboard.press('a'); const am = await ev(page, () => window.__game.input.mode); await page.mouse.click(q[1][0], q[1][1]);
      const amo = await ev(page, () => { const C = window.__game; return [...C.sel].map((id) => C.world.byId.get(id).order.type); });
      await page.keyboard.press('s'); const st = await ev(page, () => { const C = window.__game; return [...C.sel].map((id) => { const u = C.world.byId.get(id); return u.order.type + (u.path ? '+path' : ''); }); });
      await page.keyboard.press('g'); await page.mouse.click(q[0][0], q[0][1]); const gd = await ev(page, () => { const C = window.__game; return [...C.sel].map((id) => C.world.byId.get(id).order.type); });
      check('controls: A attack-move, S stop, G guard', am === 'attackMove' && amo.every((t) => t === 'attackMove') && st.every((t) => t === 'idle') && gd.every((t) => t === 'guard'), `A → ${amo.join('/')}, S → ${st.join('/')}, G → ${gd.join('/')}`);
      // build hotkeys: Q tab, Z = first item (power plant)
      await page.keyboard.press('q'); await page.keyboard.press('z');
      const hk = await ev(page, () => { const C = window.__game; return C.p.queues.structure.map((i) => i.key); });
      check('controls: build hotkeys queue from the open tab', hk[0] === 'power', `Q, Z → ${hk.join(', ')}`);
    }

    if (want('building')) {
      const r = await ev(page, () => { const C = window.__game; if (!C.p.queues.structure.length && !C.p.ready) { C.game.enqueue(C.p, 'structure', 'power'); C.ui.setTab('structure'); } C.advance(800 / 24 / C.pace.game_speed + 0.5, 30, 0); return !!C.p.ready; });
      await page.keyboard.press('z'); const placing = await ev(page, () => !!window.__game.input.place);
      const bad = await ev(page, () => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x, y.y, 150); C.advance(0.05); return C.screenOf(y.x, y.y); });
      await page.mouse.move(bad[0], bad[1]); const b1 = await ev(page, () => { const C = window.__game; C.advance(1 / 60); const P = C.input.place; let mat = null; P.model.traverse((o) => { if (o.isMesh && !mat) mat = o.material; }); return { ok: P.c && P.c.ok, red: mat === C.input.ghostMats.bad, reason: P.c && P.c.reason, radius: C.input.radius ? C.input.radius.children.length : 0, structs: C.game.structures(C.p).length }; });
      const good = await ev(page, () => { const C = window.__game, p = C.p, y = C.world.byId.get(p.yard); let spot = null; for (let r = 34; r < 120 && !spot; r += 4) for (let a = 0; a < 24 && !spot; a++) { const c = C.game.canPlace(p, 'power', y.x + Math.cos(a / 24 * 6.283) * r, y.y + Math.sin(a / 24 * 6.283) * r); if (c.ok) spot = c; } return C.screenOf(spot.x, spot.y); });
      await page.mouse.move(good[0], good[1]); const b2 = await ev(page, () => { const C = window.__game; C.advance(1 / 60); const P = C.input.place; let mat = null; P.model.traverse((o) => { if (o.isMesh && !mat) mat = o.material; }); return { ok: P.c && P.c.ok, green: mat === C.input.ghostMats.ok }; });
      check('building: ghost is red on a bad spot and green on a good one; build radius drawn', r && placing && b1.ok === false && b1.red && b2.ok && b2.green && b1.radius === b1.structs * 2, `bad: "${b1.reason}", radius outlines ${b1.radius / 2} for ${b1.structs} structures`);
      await page.mouse.click(good[0], good[1]); const placed = await ev(page, () => { const C = window.__game; C.advance(2.5, 30, 0); return C.game.structures(C.p).map((b) => b.kind); });
      check('building: left-click places the structure', placed.filter((k) => k === 'power').length >= 1 && !(await ev(page, () => !!window.__game.input.place)), placed.join(', '));
      // queue + refund
      const rf = await ev(page, () => { const C = window.__game, G = C.game, p = C.p; G.enqueue(p, 'structure', 'barracks'); C.advance(500 / 24 / C.pace.game_speed + 0.5, 30, 0); let spot = null; const y = C.world.byId.get(p.yard);
        for (let r = 36; r < 140 && !spot; r += 4) for (let a = 0; a < 24 && !spot; a++) { const c = G.canPlace(p, 'barracks', y.x + Math.cos(a / 24 * 6.283) * r, y.y + Math.sin(a / 24 * 6.283) * r); if (c.ok) spot = c; } G.place(p, spot.x, spot.y); C.advance(1.5, 30, 0);
        C.ui.setTab('infantry'); const c0 = p.credits; C.ui.pressItem(0, 5); const n = p.queues.infantry.length; if (!n) return { err: `nothing queued: spot ${!!spot}, structures ${G.structures(p).map((b) => b.kind)}, ready ${p.ready && p.ready.key}, avail ${G.available(p, 'infantry', 'H01')}` };
        C.advance(3, 30, 0); const spent = c0 - p.credits; C.ui.refreshGrid(true); const prog = parseFloat(C.ui.btns[0].style.getPropertyValue('--p'));
        const done = 5 - p.queues.infantry.length, unit = G.costOf('infantry', 'H01');
        while (p.queues.infantry.length) G.cancel(p, 'infantry', p.queues.infantry[p.queues.infantry.length - 1].key); return { n, spent, done, back: p.credits - c0 + done * unit, prog, left: p.queues.infantry.length }; });
      check('building: queued builds, progress on the button, full refund on cancel', !rf.err && rf.n === 5 && rf.spent > 0 && Math.abs(rf.back) < 1e-6 && rf.prog > 0 && rf.prog < 1 && rf.left === 0, rf.err || `queued ${rf.n}, spent $${rf.spent.toFixed(0)} in 3 s (${rf.done} finished), button at ${(rf.prog * 100).toFixed(0)} %, balance after cancelling the rest: ${rf.back.toFixed(2)} (finished units excluded)`);
      // rally point on the barracks
      const rp = await ev(page, () => { const C = window.__game, b = C.game.structures(C.p).find((x) => x.kind === 'barracks'); C.lookAt(b.x, b.y, 140); C.advance(0.05); return { b: C.screenOf(b.x, b.y, b.z + 3), g: C.screenOf(b.x - 30, b.y - 30), id: b.id }; });
      await page.mouse.click(rp.b[0], rp.b[1]); await page.mouse.click(rp.g[0], rp.g[1], { button: 'right' });
      const rally = await ev(page, (id) => { const C = window.__game, b = C.world.byId.get(id); return { sel: [...C.sel], rally: b.rally }; }, rp.id);
      check('building: select a barracks and right-click to set its rally point', rally.sel[0] === rp.id && !!rally.rally, rally.rally ? rally.rally.map((v) => v.toFixed(0)).join(', ') : 'none');
      const out = await ev(page, () => { const C = window.__game; const t0 = C.game.t; C.ui.setTab('infantry'); C.ui.pressItem(0, 2); C.advance(30, 30, 0); const b = C.game.structures(C.p).find((x) => x.kind === 'barracks'); const us = C.world.units.filter((u) => u.team === 0 && u.born > t0 && u.kind === 'foot'); return us.map((u) => Math.hypot(u.x - b.rally[0], u.y - b.rally[1])); });
      check('building: trained units walk out of the door to the rally point', out.length >= 2 && out.every((d) => d < 12), out.map((d) => d.toFixed(1) + ' m').join(', '));
      await shot(page, 'base');
    }

    if (want('camera')) {
      const c0 = await ev(page, () => { const C = window.__game; C.lookAt(900, 900, 200); return [C.rcam.fx, C.rcam.fy]; });
      await page.mouse.move(3, 430); const c1 = await ev(page, () => { const C = window.__game; C.advance(0.5, 60, 0); return [C.rcam.fx, C.rcam.fy]; });
      await page.mouse.move(600, 430); const c2 = await ev(page, () => { const C = window.__game; C.advance(0.3, 60, 0); return [C.rcam.fx, C.rcam.fy]; });
      check('camera: edge scroll pans (and stops when the pointer leaves the edge)', c1[0] < c0[0] - 30 && Math.abs(c2[0] - c1[0]) < 1, `left edge 0.5 s → ${(c0[0] - c1[0]).toFixed(0)} m`);
      await page.mouse.move(600, 430); await page.mouse.down({ button: 'middle' }); await page.mouse.move(800, 430, { steps: 4 }); await page.mouse.up({ button: 'middle' });
      const c3 = await ev(page, () => { const C = window.__game; return [C.rcam.fx, C.rcam.fy, C.rcam.mpp()]; });
      check('camera: middle-drag grabs the ground', c3[0] < c2[0] - 100 * c3[2], `200 px → ${(c2[0] - c3[0]).toFixed(0)} m (${(200 * c3[2]).toFixed(0)} m expected)`);
      const z = await ev(page, () => { const C = window.__game; const g = C.input.groundAt(400, 300); C._zg = g; return [g.x, g.y, C.rcam.dist]; });
      await page.mouse.move(400, 300); await page.mouse.wheel(0, -400);
      const z2 = await ev(page, () => { const C = window.__game; C.advance(1.0, 60, 0); const s = C.screenOf(C._zg.x, C._zg.y, C._zg.z); return [s[0], s[1], C.rcam.dist]; });
      check('camera: smooth wheel zoom toward the cursor', z2[2] < z[2] * 0.7 && Math.hypot(z2[0] - 400, z2[1] - 300) < 12, `distance ${z[2].toFixed(0)} → ${z2[2].toFixed(0)} m, ground point under the cursor drifted ${Math.hypot(z2[0] - 400, z2[1] - 300).toFixed(1)} px`);
      const mm = await ev(page, () => { const r = document.querySelector('#minimap').getBoundingClientRect(); return [r.left + r.width * 0.25, r.top + r.height * 0.75]; });
      await page.mouse.click(mm[0], mm[1]); const c4 = await ev(page, () => [window.__game.rcam.fx, window.__game.rcam.fy]);
      check('camera: minimap click jumps', Math.abs(c4[0] - 450) < 10 && Math.abs(c4[1] - 450) < 10, `→ (${c4.map((v) => v.toFixed(0)).join(', ')})`);
      await ev(page, () => { window.__game.alerts.push({ x: 1200, y: 600, t: 0 }); }); await page.keyboard.press(' ');
      const c5 = await ev(page, () => { const C = window.__game; C.advance(0.5, 60, 0); return [C.rcam.fx, C.rcam.fy]; });
      check('camera: Space jumps to the last alert', Math.hypot(c5[0] - 1200, c5[1] - 600) < 2, `→ (${c5.map((v) => v.toFixed(0)).join(', ')})`);
    }

    if (want('info')) {
      const tick = await ev(page, () => { const C = window.__game, p = C.p; C.advance(2, 60, 0); const s0 = p.shown; p.credits += 500; C.advance(1 / 60, 60, 0); const s1 = p.shown; C.advance(2.5, 60, 0); return { s0, s1, s2: p.shown, c: p.credits, txt: document.querySelector('#credits').textContent }; });
      check('info: money ticks smoothly toward the balance', tick.s1 > tick.s0 && tick.s1 < tick.s0 + 500 && Math.abs(tick.s2 - tick.c) < 1, `+500 → ${(tick.s1 - tick.s0).toFixed(1)} after 1 frame, ${tick.txt} after 2.5 s`);
      const pw = await ev(page, () => { const C = window.__game; return { made: C.p.power.made, used: C.p.power.used, h: document.querySelector('#powerMade').style.height, txt: document.querySelector('#powerTxt').textContent }; });
      check('info: power meter shows supply and demand', parseFloat(pw.h) > 0 && pw.txt.includes(String(pw.made)), `${pw.txt} (bar ${pw.h})`);
      const idle = await ev(page, () => { const C = window.__game, G = C.game, p = C.p; G.enqueue(p, 'structure', 'refinery'); C.advance(2000 / 24 / C.pace.game_speed + 0.5, 30, 0); const y = C.world.byId.get(p.yard); let spot = null;
        for (let r = 40; r < 200 && !spot; r += 4) for (let a = 0; a < 24 && !spot; a++) { const c = G.canPlace(p, 'refinery', y.x + Math.cos(a / 24 * 6.283) * r, y.y + Math.sin(a / 24 * 6.283) * r); if (c.ok) spot = c; } G.place(p, spot.x, spot.y); C.advance(1, 30, 0);
        const hv = C.world.units.find((u) => u.team === 0 && u.uid === 'HV'); C.world.order(hv, { type: 'stop' }); C.advance(0.5, 60, 0); return { n: +document.querySelector('#idleHarv b').textContent, cls: document.querySelector('#idleHarv').className, hv: hv.id }; });
      await page.keyboard.press('i'); const idleSel = await ev(page, () => [...window.__game.sel]);
      check('info: idle harvester indicator counts and selects it (I)', idle.n >= 1 && idle.cls.includes('alert') && idleSel[0] === idle.hv, `${idle.n} idle`);
      await ev(page, () => { const C = window.__game; const hv = C.world.byId.get(C.sel.values().next().value); C.world.harvest(hv, C.game.nextDeposit(hv), C.game.bestDock(hv)); C.ui.setTab('vehicle'); });
      const btn = await ev(page, () => { const r = document.querySelector('#grid .item').getBoundingClientRect(); return [r.left + 20, r.top + 20]; });
      await page.mouse.move(btn[0], btn[1]); const tip = await ev(page, () => { const t = document.querySelector('#tip'); return { vis: !t.hidden, txt: t.innerText }; });
      check('info: tooltips show cost, build time and counters', tip.vis && /\$\d/.test(tip.txt) && / s/.test(tip.txt) && /Strong vs|Weak vs/.test(tip.txt), tip.txt.replace(/\n+/g, ' | ').slice(0, 160));
      await page.mouse.move(500, 400);
      const ann = await ev(page, () => window.__game.log.ann.slice());
      check('info: announcer lines fire for game events', !boot.audio || (ann.includes('construction_complete') && ann.includes('unit_ready')), ann.join(', '));
    }

    if (want('combat')) {
      const cb = await ev(page, () => { const C = window.__game, W = C.world, y = C.world.byId.get(C.p.yard); const x = y.x + 120, yy = y.y - 160; const us = [];
        for (let k = 0; k < 4; k++) { const u = W.spawn('H03', 0, x - 50 + k * 10, yy, { hdg: 0 }); u.owner = 0; us.push(u); } for (let k = 0; k < 4; k++) { const u = W.spawn('T03', 1, x + 30 + k * 9, yy + 8, { hdg: Math.PI }); u.owner = 1; us.push(u); }
        for (let k = 0; k < 6; k++) { const u = W.spawn('T01', 1, x + 25 + k * 2, yy - 10, {}); u.owner = 1; } C.P.afterStep(); W.events.length = 0;
        for (const u of us) W.order(u, { type: 'attackMove', x: u.team ? x - 50 : x + 40, y: yy }); C.lookAt(x, yy, 90); C.advance(0.05);
        const s0 = Object.assign({}, C.P.stats); C.advance(6, 30, 0); C._mid = Object.assign({}, C.P.stats); return { s0 }; });
      if (SHOTS) { await ev(page, () => { const C = window.__game; C.advance(0.4, 60, 0); }); await shot(page, 'combat'); }
      const cb2 = await ev(page, () => { const C = window.__game; C.advance(20, 30, 0); return { s: C.P.stats, mid: C._mid, kills: C.world.stats.kills, err: C.errors.slice() }; });
      const s = cb2.s;
      check('combat: muzzle flash lights, hit reactions, camera shake', s.flashes > 10 && s.hitReactions > 10 && s.shakes > 3, `${s.flashes} flashes, ${s.hitReactions} hit reactions, ${s.shakes} shakes`);
      check('combat: deaths throw debris and turrets', cb2.kills > 0 && s.debris > 0 && s.tossed > 0, `${cb2.kills} kills, ${s.debris} debris pieces, ${s.tossed} turrets tossed`);
      check('combat: no errors', cb2.err.length === 0, cb2.err.slice(0, 2).join(' | '));
    }

    if (want('movement')) {
      const mv = await ev(page, () => { const C = window.__game, W = C.world, y = C.world.byId.get(C.p.yard); const x0 = y.x + 60, y0 = y.y - 60; const g = [];
        for (let k = 0; k < 6; k++) { const u = W.spawn('H01', 0, x0 + (k % 3) * 2, y0 + Math.floor(k / 3) * 2, {}); g.push(u); } for (let k = 0; k < 3; k++) g.push(W.spawn('H03', 0, x0 - 12 - k * 9, y0 + 6, { hdg: 0 }));
        C.P.afterStep(); W.events.length = 0; W.orderGroup(g, { type: 'move', x: x0 + 130, y: y0 - 150 }); let vT = 0, t = 0;
        while (t < 90 && g.some((u) => u.path)) { C.advance(1 / 3, 30, 0); t += 1 / 3 * C.pace.game_speed; for (const u of g) if (u.kind === 'tracked') vT = Math.max(vT, u.v); }
        const cx = x0 + 130, cy = y0 - 150; return { t, vT, done: g.filter((u) => !u.path).length, n: g.length, spread: Math.max(...g.map((u) => Math.hypot(u.x - cx, u.y - cy))), inf: W.spec.H01.speed_mps }; });
      check('movement: a mixed group moves at the slowest speed and arrives in formation', mv.done === mv.n && mv.vT <= mv.inf + 0.3 && mv.spread < 26, `${mv.done}/${mv.n} arrived in ${mv.t.toFixed(0)} game s, tanks held to ${mv.vT.toFixed(1)} m/s (infantry ${mv.inf}), all within ${mv.spread.toFixed(1)} m of the click`);
      // harvesters sharing one refinery: no deadlock at the dock
      const hv = await ev(page, () => { const C = window.__game, G = C.game, p = C.p, W = C.world; let ref = G.structures(p).find((b) => b.kind === 'refinery');
        if (!ref) { if (!G.has(p, 'power')) C.testBuild('power'); const d = G.deposits.filter((q) => q.nearest === 'B1')[0]; ref = C.testBuild('refinery', (d.svc[0] + W.byId.get(p.yard).x) / 2, (d.svc[1] + W.byId.get(p.yard).y) / 2); } if (!ref) return { err: 'could not place a refinery' };
        const have = W.units.filter((u) => u.alive && u.team === 0 && u.uid === 'HV').length;
        for (let k = have; k < 3; k++) G._spawnHarvesterAtDock(p, ref);
        for (const r2 of G.structures(p).filter((b) => b.kind === 'refinery' && b !== ref)) { r2.dock = null; }   // one dock only
        C.P.afterStep(); W.events.length = 0; const h0 = p.stats.harvested; const hs = W.units.filter((u) => u.alive && u.team === 0 && u.uid === 'HV'); for (const h of hs) W.harvest(h, G.nextDeposit(h), ref.dock);
        const last = new Map(hs.map((h) => [h.id, { s: h.harv && h.harv.state, t: W.t }])); let worst = 0;
        for (let i = 0; i < 300; i++) { C.advance(0.5, 30, 0); for (const h of hs) { const L = last.get(h.id), s = h.harv && h.harv.state; if (s !== L.s || s === 'load' || s === 'unload') { last.set(h.id, { s, t: W.t }); } else worst = Math.max(worst, W.t - L.t); } }
        return { n: hs.length, cycles: (p.stats.harvested - h0) / 500, worst, states: hs.map((h) => h.harv && h.harv.state) }; });
      check('movement: three harvesters share one refinery dock without jamming', !hv.err && hv.n >= 3 && hv.cycles >= 9 && hv.worst < 75, hv.err || `${hv.n} harvesters, ${hv.cycles.toFixed(0)} loads delivered in 360 game s (one alone ≈ 6), longest wait in a queue ${hv.worst.toFixed(0)} s`);
      // a column of tanks through the narrowest point of the main route between the bases (Emerald has no bridges)
      const br = await ev(page, () => { const C = window.__game, W = C.world, T = C.T, N = W.nav; const B = T.meta.pads[0].center, R = T.meta.pads[1].center; const P = N.path('veh', B[0], B[1], R[0], R[1], 2.2, 3.7).pts;
        const S = [[B[0], B[1]], ...P]; const pts = []; for (let i = 1; i < S.length; i++) { const L = Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]); for (let d = 0; d < L; d += 4) pts.push([S[i - 1][0] + (S[i][0] - S[i - 1][0]) * d / L, S[i - 1][1] + (S[i][1] - S[i - 1][1]) * d / L]); }
        let k0 = -1, cmin = 1e9; for (let k = 40; k < pts.length - 40; k++) { const c = N.clear.veh[N.cellOf(pts[k][0], pts[k][1])]; if (c < cmin) { cmin = c; k0 = k; } }
        const s0 = pts[k0 - 25], g0 = pts[k0 + 25], ux = (pts[k0 + 1][0] - pts[k0 - 1][0]) / 8, uy = (pts[k0 + 1][1] - pts[k0 - 1][1]) / 8, ul = Math.hypot(ux, uy) || 1;
        const us = []; for (let k = 0; k < 10; k++) { const q = N.nearestOk('veh', s0[0] - ux / ul * (k % 5) * 11 + uy / ul * (Math.floor(k / 5) - 0.5) * 8, s0[1] - uy / ul * (k % 5) * 11 - ux / ul * (Math.floor(k / 5) - 0.5) * 8, 2.2, 40); const u = W.spawn(k % 2 ? 'A03' : 'H03', 0, q[0], q[1], { hdg: Math.atan2(uy, ux) }); us.push(u); }
        C.P.afterStep(); W.events.length = 0; W.orderGroup(us, { type: 'move', x: g0[0], y: g0[1] }); C.lookAt(pts[k0][0], pts[k0][1], 160);
        let t = 0; while (t < 240 && us.some((u) => u.path)) { C.advance(0.5, 30, 0); t += 0.5 * C.pace.game_speed; }
        return { t, at: pts[k0].map(Math.round), width: cmin, arrived: us.filter((u) => !u.path).length, n: us.length, ideal: 200 / W.spec.H03.speed_mps, near: us.filter((u) => Math.hypot(u.x - g0[0], u.y - g0[1]) < 40).length }; });
      check('movement: ten tanks pass the narrowest point of the base-to-base route without jamming', br.arrived === br.n && br.near === br.n && br.t < br.ideal * 3 + 20, `choke at (${br.at.join(', ')}), clearance ${br.width.toFixed(1)} m · ${br.arrived}/${br.n} through in ${br.t.toFixed(0)} game s (one tank alone ≈ ${br.ideal.toFixed(0)} s for the 200 m)`);
    }

    if (want('smooth')) {
      const sm = await ev(page, () => { const C = window.__game, W = C.world, us = W.units.filter((u) => u.alive && u.team === 0 && u.uid !== 'HV' && u.dom !== 'air'); const y = W.byId.get(C.p.yard);
        W.orderGroup(us, { type: 'move', x: y.x + 200, y: y.y - 260 }); C.lookAt(y.x + 100, y.y - 130, 260); let jumps = 0, samples = 0, worst = 0; const prev = new Map();
        for (let f = 0; f < 600; f++) { C.advance(1 / 60, 60, 0); const dt = 1 / 60 * C.pace.game_speed;
          for (const [id, v] of C.P.views) { if (!v.u.alive || !v.group.visible || v.u.team !== 0) continue; const p = v.group.position.clone(), q = prev.get(id); prev.set(id, p); if (!q) continue;
            const d = Math.hypot(p.x - q.x, p.z - q.z), vmax = v.u.sp.speed_mps * 1.3 + 3; samples++; worst = Math.max(worst, d / dt / vmax); if (d / dt > vmax && d > 0.25) jumps++; } }
        return { jumps, samples, worst, lodSwitch: C.P.lodSwitches, views: C.P.views.size }; });
      check('smoothness: interpolated motion has no snaps', sm.jumps === 0, `${sm.samples} unit-frames, worst ${(sm.worst * 100).toFixed(0)} % of the speed limit, ${sm.lodSwitch} distant-view switches`);
      const perf = await ev(page, () => window.__game.stats());
      check('performance: simulation cost per tick', perf.tickAvg < 3, `avg ${perf.tickAvg.toFixed(2)} ms, p99 ${perf.tickP99.toFixed(1)} ms with ${perf.units} units`);
      results.perf = perf;
    }
    results.logs = logs.slice(0, 20);
    if (logs.filter((l) => !/TUNNEL|fonts/.test(l)).length) console.log('console errors:', logs.slice(0, 6));
    await page.close();
  } catch (e) { check('test harness', false, String(e.stack || e).split('\n').slice(0, 3).join(' / ')); }
  if (want('match')) {
    try {
      const { page } = await open('autostart=1&manual=1&spectate=1&faction=helix&ai=compact&quality=low&dpr=1');
      const m = await ev(page, () => { const C = window.__game; const t0 = performance.now(); for (let k = 0; k < 17; k++) C.advance(15, 20, 0); C.renderNow();
        return { t: C.world.t, wall: (performance.now() - t0) / 1000, errors: C.errors.slice(), over: C.game.over, players: C.game.players.map((p) => ({ f: p.faction, s: C.game.structures(p).length, u: C.game.unitsOf(p).length, lost: p.stats.lostUnits, h: p.stats.harvested })), present: C.P.stats }; });
      check('match: AI vs AI runs 10 game minutes in the client without errors', m.errors.length === 0 && m.t > 590, `${(m.t / 60).toFixed(1)} min in ${m.wall.toFixed(0)} s wall · ${m.players.map((p) => `${p.f}: ${p.s} structures, ${p.u} units, ${p.lost} lost, $${p.h} mined`).join(' | ')}${m.over ? ' · winner ' + m.over.winner : ''}${m.errors.length ? ' · ' + m.errors.slice(0, 2).join(' | ') : ''}`);
      results.match = m; await page.close();
    } catch (e) { check('match harness', false, String(e.stack || e).split('\n').slice(0, 3).join(' / ')); }
  }
  await browser.close(); srv.kill();
  console.log(`\n${pass}/${pass + fail} checks passed`); fs.writeFileSync(path.join(OUT, 'game.txt'), lines.join('\n') + `\n${pass}/${pass + fail}\n`); fs.writeFileSync(path.join(OUT, 'game.json'), JSON.stringify(results, null, 1));
  process.exit(fail ? 1 : 0);
})();
