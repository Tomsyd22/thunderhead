#!/usr/bin/env node
/* Map Lab pace measurement: every deposit's harvester round trip and every base-to-enemy-base drive, on every map.
 *
 *   node maps/lab/test_pace.js [01 02 ...] [--port=8766]
 *
 * Opens each map in headless Chromium, runs the Lab's own Pace measurement (window.__lab.measurePace) at the
 * pace.json settings, and repeats the drive evaluation for harvester ratios 1.20 / 1.25 / 1.30 (paths are planned once).
 * Times are reported in GAME seconds and in real seconds at pace.json's game speed. Output: results/pace.json.
 * three.js is served from a local copy of three@0.160.0 when THREE_DIR (default <repo>/.cache/three-0.160.0) exists.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const LAB = __dirname;
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const IDS = args.filter((a) => /^\d\d$/.test(a));
const PORT = +opt('port', 8766);
const THREE_DIR = process.env.THREE_DIR || path.resolve(LAB, '../../.cache/three-0.160.0');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { const q = http.get(url, (r) => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.setTimeout(2000, () => q.destroy(new Error('timeout'))); });

(async () => {
  const maps = JSON.parse(fs.readFileSync(path.join(LAB, 'data/maps.json'), 'utf8'));
  const ids = IDS.length ? IDS : maps.map((m) => m.id);
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: LAB, stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}`;
  for (let k = 0; k < 50; k++) { try { if ((await get(base + '/index.html')) === 200) break; } catch (e) { /* not up */ } await sleep(200); }
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = { generated: new Date().toISOString(), maps: {} };
  try {
    for (const id of ids) {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 }); const page = await ctx.newPage(); const errors = [];
      if (fs.existsSync(path.join(THREE_DIR, 'build/three.module.js'))) await page.route(CDN + '**', (route) => { const f = path.join(THREE_DIR, route.request().url().slice(CDN.length).split('?')[0]); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: '' }); });
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
      await page.addInitScript(() => { try { localStorage.removeItem('maplab.pace'); } catch (e) { /* */ } });
      await page.goto(`${base}/index.html?quality=low#${id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((x) => window.__lab && window.__lab.readyId === x, id, { polling: 500, timeout: 600000 });
      const t0 = Date.now();
      const res = await page.evaluate(async () => {
        const file = window.__lab.pace().file; const main = await window.__lab.measurePace(); const sweep = {};
        for (const r of [1.2, 1.25, 1.3]) { window.__lab.setPace({ harvester_speed_ratio: r }); const m = await window.__lab.measurePace(); sweep[r.toFixed(2)] = m.harv.map((h) => ({ dep: h.dep, base: h.base, kind: h.kind, game_s: h.game_s })); }
        window.__lab.setPace({ harvester_speed_ratio: file.harvester_speed_ratio });
        return { file: { game_speed: file.game_speed, harvester_speed_ratio: file.harvester_speed_ratio, harvester: file.harvester }, main, sweep };
      });
      out.maps[id] = { name: maps.find((m) => m.id === id).name, ms: Date.now() - t0, errors, ...res };
      if (args.includes('--shot')) { await page.evaluate(() => { document.querySelector('#rTabs button[data-pane="pace"]').click(); window.__lab.setPreset('overview'); }); await page.waitForTimeout(3000);
        fs.mkdirSync(path.join(LAB, 'shots'), { recursive: true }); await page.screenshot({ path: path.join(LAB, 'shots', `${id}_pace.png`), timeout: 300000 }); }
      const homes = res.main.harv.filter((h) => h.kind === 'home');
      console.log(id, `home ${homes.map((h) => `${h.dep}:${h.real_s?.toFixed(1)}`).join(' ')} | b2b ${res.main.b2b.map((x) => `${x.a}-${x.b}:${x.real_s?.toFixed(1)}(${x.cls})`).join(' ')} | errors ${errors.length}`);
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  fs.mkdirSync(path.join(LAB, 'results'), { recursive: true });
  fs.writeFileSync(path.join(LAB, 'results/pace.json'), JSON.stringify(out, null, 1)); console.log('wrote results/pace.json');
})().catch((e) => { console.error(e); process.exit(1); });
