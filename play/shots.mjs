// Screenshot scenarios for reviews and before/after comparisons (headless Chromium, software GL: looks, not timings).
//   node play/shots.mjs <scenario> [--qs=extra&query] [--out=dir]
// Scenarios: scale (the same view at unit size 1.0× and 1.75×), repair (wrench badge, repair button, engineer close-up),
//   looks (graphics review: base, battle, close-up, wide, shore and cliff views; names carry --quality).
import fs from 'fs'; import path from 'path'; import http from 'http'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const DIR = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SCEN = args.find((a) => !a.startsWith('--')) || 'scale', PORT = +opt('port', 8795), OUT = opt('out', path.join(DIR, 'results', 'shots'));
const THREE_DIR = process.env.THREE_DIR || path.resolve(DIR, '../.cache/three-0.160.0'); const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.local.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + fs.readFileSync(path.join(DIR, 'index.html'), 'utf8') + '</body></html>');
const get = (url) => new Promise((res, rej) => { const q = http.get(url, (r) => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.setTimeout(2000, () => q.destroy(new Error('timeout'))); });

const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if (await get(`http://127.0.0.1:${PORT}/index.local.html`) === 200) break; } catch (e) { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const logs = []; page.setDefaultTimeout(180000);
page.on('pageerror', (e) => logs.push(String(e)));
await page.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith(CDN)) { const f = path.join(THREE_DIR, u.slice(CDN.length).split('?')[0]); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: 'application/javascript' }); } return route.continue(); });
await page.goto(`http://127.0.0.1:${PORT}/index.local.html?autostart=1&manual=1&faction=compact&ai=lattice&quality=${opt('quality', 'high')}&dpr=1&${opt('qs', '')}`);
await page.waitForFunction(() => window.__game && window.__game.started, null, { timeout: 240000 });
const ev = (fn, a) => page.evaluate(fn, a);
const snap = async (name) => { await ev(() => window.__game.renderNow()); const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f }); console.log(f); };

// a mixed group parked in front of the yard: a rifle squad, rockets, two tanks and the harvester going about its work
const stage = () => ev(() => { const C = window.__game, W = C.world, p = C.p, y = W.byId.get(p.yard); const ids = [];
  const at = (dx, dy) => W.nav.nearestOk('foot', y.x + dx, y.y + dy, 2.5, 40);
  for (const [uid, dx, dy] of [['H01', 30, -36], ['H01', 32, -38], ['H01', 34, -36], ['H01', 31, -40], ['H01', 35, -41], ['H02', 38, -34], ['H02', 39, -38], ['H03', 46, -46], ['H03', 26, -52], ['T01', 60, -40], ['T03', 64, -50]]) {
    const q = at(dx, dy); const u = W.spawn(uid, uid[0] === 'T' ? 1 : p.team, q[0], q[1], { hdg: -0.6 }); u.owner = uid[0] === 'T' ? 1 : p.id; ids.push(u.id); }
  C.P.afterStep(); W.events.length = 0; C.advance(1, 30, 0); C.sel = new Set(ids.slice(0, 9)); C.ui.selChanged();
  for (const id of ids.slice(0, 9)) { const u = W.byId.get(id); u.hp = u.maxHp * (0.45 + 0.5 * ((id * 7) % 10) / 10); }
  C.lookAt(y.x + 40, y.y - 42, 95); C.advance(0.05, 60, 0); return ids; });

if (SCEN === 'scale') {
  await stage();
  for (const s of [1, 1.75]) { await ev((s) => { const C = window.__game; C.setPace({ unit_scale: s }); C.advance(0.05, 60, 0); }, s); await snap(`scale_${s.toFixed(2)}`); }
  await ev(() => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x + 40, y.y - 42, 190); C.setPace({ unit_scale: 1 }); C.advance(0.05, 60, 0); });
  await snap('scale_far_1.00'); await ev(() => { const C = window.__game; C.setPace({ unit_scale: 1.75 }); C.advance(0.05, 60, 0); }); await snap('scale_far_1.75');
}
if (SCEN === 'repair') {
  await ev(() => { const C = window.__game, W = C.world, p = C.p, y = W.byId.get(p.yard);
    for (const id of ['HE', 'AE', 'TE']) { const q = W.nav.nearestOk('foot', y.x - 20 + ['HE', 'AE', 'TE'].indexOf(id) * 2.6, y.y - 34, 0.4, 40); const u = W.spawn(id, p.team, q[0], q[1], { hdg: -2.2 }); u.owner = p.id; }
    C.P.afterStep(); W.events.length = 0; y.hp = 0.45 * y.maxHp; C.game.toggleRepair(p, y); C.input.setMode('repair'); C.sel = new Set([y.id]); C.ui.selChanged();
    C.advance(1.2, 30, 0); C.lookAt(y.x + 12, y.y - 14, 70); C.advance(0.3, 60, 0); });
  await snap('repair_base');
  await ev(() => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x - 17.4, y.y - 34, 16); C.rcam.pitch = C.rcam.pitch; C.advance(0.05, 60, 0); });
  await snap('repair_engineers');
}
if (SCEN === 'rotate') {
  const at = await ev(() => { const C = window.__game, G = C.game, p = C.p; p.credits = 20000; for (const k of ['power', 'refinery']) if (!G.has(p, k)) C.testBuild(k);
    p.queues.structure.length = 0; p.ready = null; G.enqueue(p, 'structure', 'refinery'); const it = p.queues.structure[0]; it.spent = it.cost; p.ready = it; C.input.startPlace('refinery');
    const y = C.world.byId.get(p.yard); let spot = null; for (let r = 60; r < 240 && !spot; r += 4) for (let a = 0; a < 24 && !spot; a++) { const x = y.x + Math.cos(a / 24 * 6.283) * r, yy = y.y + Math.sin(a / 24 * 6.283) * r; if (G.canPlace(p, 'refinery', x, yy).ok) spot = [x, yy]; }
    C.lookAt(spot[0], spot[1], 120); C.advance(0.05); return C.screenOf(spot[0], spot[1]); });
  await page.mouse.move(at[0], at[1]); await ev(() => window.__game.advance(1 / 60)); await snap('rotate_0');
  await page.keyboard.press('r'); await ev(() => window.__game.advance(1 / 60)); await snap('rotate_1');
  const bad = await ev(() => { const C = window.__game, G = C.game, p = C.p, y = C.world.byId.get(p.yard); for (let k = 0; k < 4; k++) { for (let a = 0; a < 48; a++) for (let r = 40; r < 80; r += 4) { const x = y.x + Math.cos(a / 48 * 6.283) * r, yy = y.y + Math.sin(a / 48 * 6.283) * r; const c = G.canPlace(p, 'refinery', x, yy, C.input.place.rot); if (!c.ok && /[Dd]ock/.test(c.reason)) { C.lookAt(x, yy, 130); C.advance(0.05); return C.screenOf(x, yy); } } C.input.rotatePlace(1); } return null; });
  if (bad) { await page.mouse.move(bad[0], bad[1]); await ev(() => window.__game.advance(1 / 60)); await snap('rotate_blocked'); }
}
if (SCEN === 'ore') {
  const at = await ev(() => { const C = window.__game, G = C.game, p = C.p; C.testBuild('power'); const ref = C.testBuild('refinery'); C.advance(1, 30, 0);
    const d = G.deposits.filter((q) => q.nearest === p.start.pad.id).sort((a, b) => Math.hypot(a.pos[0] - ref.x, a.pos[1] - ref.y) - Math.hypot(b.pos[0] - ref.x, b.pos[1] - ref.y))[0];
    C.lookAt(d.pos[0], d.pos[1], 75); C.advance(0.05, 60, 0); return d.id; });
  await snap('ore_full');
  await ev((id) => { const C = window.__game, G = C.game, d = G.deposits.find((q) => q.id === id), W = C.world, p = C.p; const ref = G.structures(p).find((b) => b.kind === 'refinery');
    for (let k = 0; k < 2; k++) { const h = W.spawn('HV', p.team, ref.dock.approach[0] + k * 8, ref.dock.approach[1], { hdg: ref.dock.face }); h.owner = p.id; W.harvest(h, d, ref.dock); } C.P.afterStep(); W.events.length = 0;
    C.advance(150, 30, 0); C.lookAt(d.pos[0], d.pos[1], 75); C.advance(0.1, 60, 0); }, at);
  await snap('ore_mined');
  await ev(() => { const C = window.__game, p = C.p; C.lookAt(p.start.x, p.start.y, 300); C.advance(0.05, 60, 0); }); await snap('ore_overview');
}
if (SCEN === 'looks') {   // graphics review: fixed views, file names carry the quality preset (run with --quality=high / medium)
  const Qn = opt('quality', 'high'), ids = await stage();
  await ev(() => { const C = window.__game; C.setPace({ unit_scale: 1.75 }); C.advance(0.05, 60, 0); });
  await ev(() => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x + 6, y.y - 8, 70); C.advance(0.05, 60, 0); }); await snap(`looks_base_${Qn}`);
  await ev(() => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x + 40, y.y - 42, 165); C.advance(0.05, 60, 0); }); await snap(`looks_battle_${Qn}`);
  await ev(() => { const C = window.__game, y = C.world.byId.get(C.p.yard); C.lookAt(y.x + 46, y.y - 46, 45); C.advance(0.05, 60, 0); }); await snap(`looks_closeup_${Qn}`);
  await ev(() => { const C = window.__game; C.lookAt(C.T.W * 0.42, C.T.H * 0.55, 900); C.advance(0.05, 60, 0); }); await snap(`looks_wide_${Qn}`);
  // shore: the sand cell nearest the blue base; cliff: the steepest rock-class cell nearest it
  for (const [name, cls, d] of [['shore', 3, 90], ['cliff', 4, 90]]) {
    await ev(([cls, d]) => { const C = window.__game, T = C.T, y0 = C.world.byId.get(C.p.yard); let best = null, bs = -1e9;
      for (let y = 20; y < T.H - 20; y += 4) for (let x = 20; x < T.W - 20; x += 4) { if (T.surfaceAt(x, y) !== cls) continue;
        const sl = Math.hypot(T.terrain(x + 4, y) - T.terrain(x - 4, y), T.terrain(x, y + 4) - T.terrain(x, y - 4)) / 8;
        const s = (cls === 4 ? sl * 3 : 0) - Math.hypot(x - y0.x, y - y0.y) / 300; if (s > bs) { bs = s; best = [x, y]; } }
      C.lookAt(best[0], best[1], d); C.advance(0.05, 60, 0); }, [cls, d]);
    await snap(`looks_${name}_${Qn}`);
  }
  void ids;
}
if (logs.length) console.log('page errors:', logs.join(' | '));
await browser.close(); srv.kill();
