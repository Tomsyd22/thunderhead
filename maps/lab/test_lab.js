#!/usr/bin/env node
/* Map Lab browser test.
 *
 *   node maps/lab/test_lab.js [01 02 ...] [--quality=low|medium|high] [--port=8765] [--no-mobile] [--shots=detail,interaction]
 *
 * Serves maps/lab with `python3 -m http.server`, opens each map in headless Chromium (software GL through
 * ANGLE + SwiftShader), takes the five camera-preset screenshots plus overlay/route views into shots/, runs the
 * map's standard route tests and records the HUD numbers (renderer.info, fps, frame time, GPU string).
 * Outputs: perf.json, route_tests.json, shots/<id>_<preset>.png (+ _routes, _overlays, _nav_*, mobile_01_*).
 * --shots=<list> re-shoots only the listed presets (and/or 'interaction', 'mobile') and merges into the JSON files.
 *
 * three.js r160 is requested from the pinned cdn.jsdelivr.net URLs in index.html. When that host is not reachable
 * (offline sandbox), point THREE_DIR at a local copy of the three@0.160.0 npm package (default:
 * <repo>/.cache/three-0.160.0): requests under https://cdn.jsdelivr.net/npm/three@0.160.0/ are then answered from
 * those files, so the page code is identical. Google Fonts requests are aborted in that mode (system fonts are used).
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
// low by default: SwiftShader on this shared 2-CPU machine needs seconds per frame; pass --quality=medium|high to change
const QUALITY = opt('quality', 'low');
const PORT = +opt('port', 8765);
const MOBILE = !args.includes('--no-mobile');
// --shots=detail,base,interaction re-shoots only those views (no perf, no route tests) and merges into the existing JSON
const ONLY = opt('shots', null) ? opt('shots', '').split(',') : null;
const THREE_DIR = process.env.THREE_DIR || path.resolve(LAB, '../../.cache/three-0.160.0');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const PRESETS = ['overview', 'gameplay', 'base', 'harbor', 'detail'];
const SHOTS = path.join(LAB, 'shots');
let GPU_SEEN = null;
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function get(url) {
  return new Promise((res, rej) => { const q = http.get(url, (r) => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.setTimeout(2000, () => q.destroy(new Error('timeout'))); });
}

async function main() {
  const maps = JSON.parse(fs.readFileSync(path.join(LAB, 'data/maps.json'), 'utf8'));
  const ids = IDS.length ? IDS : maps.map((m) => m.id);
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: LAB, stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}`;
  for (let k = 0; k < 50; k++) { try { if ((await get(base + '/index.html')) === 200) break; } catch (e) { /* not up yet */ } await sleep(200); }

  const local = fs.existsSync(path.join(THREE_DIR, 'build/three.module.js'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const perf = { generated: new Date().toISOString(), quality: QUALITY, viewport: [1280, 720], three_source: local ? `local copy of three@0.160.0 (${THREE_DIR}) served at the pinned jsDelivr URLs` : 'cdn.jsdelivr.net',
    note: 'Measured in headless Chromium on a software rasteriser (SwiftShader, CPU only) on a 2-CPU VM shared with Blender renders. These numbers are not representative of GPU hardware; draw calls, triangles and instance counts are renderer-independent.', maps: {} };
  const routes = { generated: perf.generated, maps: {} };

  async function newPage(viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(900000);
    if (local) {
      await page.route(CDN + '**', async (route) => {
        const rel = route.request().url().slice(CDN.length).split('?')[0];
        const file = path.join(THREE_DIR, rel);
        if (!file.startsWith(THREE_DIR) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not in local copy' });
        return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync(file) });
      });
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // "Failed to load resource" console lines carry no URL; failed requests are recorded by URL instead (below)
    page.on('console', (m) => { if ((m.type() === 'error' && !/^Failed to load resource/.test(m.text())) || (m.type() === 'warning' && /THREE|shader|WebGL/i.test(m.text()))) errors.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
    page.on('requestfailed', (r) => { if (!(local && /fonts\.(googleapis|gstatic)\.com/.test(r.url()))) errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`); });
    return { ctx, page, errors };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), timeout: 900000 });

  for (const id of ids) {
    const t0 = Date.now();
    const { ctx, page, errors } = await newPage({ width: 1280, height: 720 });
    await page.goto(`${base}/index.html?quality=${QUALITY}#${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((x) => window.__lab && window.__lab.readyId === x, id, { polling: 500 });
    const loadMs = Date.now() - t0;
    const entry = { name: maps.find((m) => m.id === id).name, load_ms: loadMs, presets: {} };
    entry.state = await page.evaluate(() => window.__lab.state());
    const preset = async (p) => {
      await page.evaluate((k) => window.__lab.setPreset(k), p);
      await shot(page, `${id}_${p}.png`);
      if (p === 'overview' || p === 'gameplay') entry.presets[p] = await page.evaluate(() => window.__lab.measure(2500));
      process.stdout.write(`  ${id} ${p} ✓\n`);
    };
    const interaction = async () => { // pointer interaction on 01: click-select a tank, then the two-click route tool
      const ia = {};
      await page.evaluate(() => window.__lab.setPreset('base'));
      const tank = await page.evaluate(() => window.__lab.drawnInstance('unit_mbt'));
      if (tank) {
        await page.mouse.click(tank.x, tank.y);
        await page.evaluate(() => window.__lab.settle(2));
        ia.select_text = (await page.textContent('#inspectOut')).replace(/\s+/g, ' ').trim().slice(0, 300);
        ia.select_ok = /unit_mbt/.test(ia.select_text);
        await shot(page, `${id}_select.png`);
      } else ia.select_ok = false;
      await page.evaluate(() => window.__lab.setPreset('overview'));
      await page.click('#rTabs button[data-pane="move"]');
      await page.click('#routeTool');
      const pads = await page.evaluate(() => window.__lab.state().map && [[480, 1394, 14], [1380, 386, 14]].map(([x, y, z]) => window.__lab.screenOf(x, y, z)));
      await page.mouse.click(pads[0].x, pads[0].y); await page.evaluate(() => window.__lab.settle(1));
      await page.mouse.click(pads[1].x, pads[1].y); await page.evaluate(() => window.__lab.settle(2));
      ia.route_text = (await page.textContent('#routeOut')).replace(/\s+/g, ' ').trim().slice(0, 300);
      ia.route_ok = /ROUTE/.test(ia.route_text) && !/NO ROUTE/.test(ia.route_text);
      await shot(page, `${id}_route_tool.png`);
      entry.interaction = ia;
      console.log(`  ${id} interaction: select ${ia.select_ok ? 'ok' : 'FAILED'} · route tool ${ia.route_ok ? 'ok' : 'FAILED'} · ${ia.route_text.slice(0, 120)}`);
    };
    if (!ONLY) {
      // Order keeps the expensive eye-level views last: overview (+ route tests, nav/depth view), gameplay (+ overlays), close-ups.
      await preset('overview');
      const rt = await page.evaluate(() => window.__lab.runRouteTests());
      routes.maps[id] = { name: entry.name, pass: rt.tests.filter((t) => t.pass).length, total: rt.tests.length, ms: rt.ms, tests: rt.tests };
      await page.evaluate(() => window.__lab.settle(2));
      await shot(page, `${id}_routes.png`);
      await page.evaluate(() => window.__lab.showTestPaths(false));
      if (id === '01' || id === '04') {
        await page.evaluate(async () => { window.__lab.setClass('ship'); await window.__lab.setOverlay('nav', true); await window.__lab.setOverlay('depth', true); });
        await shot(page, `${id}_nav_depth.png`);
        await page.evaluate(async () => { window.__lab.setClass('tank'); await window.__lab.setOverlay('depth', false); await window.__lab.setOverlay('height', true); });
        await shot(page, `${id}_nav_height.png`);
        await page.evaluate(async () => { for (const k of ['nav', 'height']) await window.__lab.setOverlay(k, false); });
      }
      await preset('gameplay');
      await page.evaluate(async () => { for (const k of ['grid', 'reserve', 'roads', 'bounds']) await window.__lab.setOverlay(k, true); await window.__lab.setOverlay('resources', false); });
      await shot(page, `${id}_overlays.png`);
      await page.evaluate(async () => { for (const k of ['grid', 'reserve', 'roads', 'bounds']) await window.__lab.setOverlay(k, false); await window.__lab.setOverlay('resources', true); });
      for (const p of ['base', 'harbor', 'detail']) await preset(p);
      if (id === '01') await interaction();
    } else {
      for (const p of ONLY) if (PRESETS.includes(p)) await preset(p);
      if (ONLY.includes('interaction') && id === '01') await interaction();
      entry.reshot = ONLY;
    }
    if (ONLY) entry.console_errors_reshoot = errors; else entry.console_errors = errors;
    perf.maps[id] = entry;
    const ov = entry.presets.overview, gp = entry.presets.gameplay;
    if (ov && gp) console.log(`${id} ${entry.name}: load ${(loadMs / 1000).toFixed(1)} s · routes ${routes.maps[id].pass}/${routes.maps[id].total} · overview ${ov.fps.toFixed(2)} fps ${ov.draw_calls} calls ${(ov.triangles / 1e6).toFixed(2)} M tris · gameplay ${gp.fps.toFixed(2)} fps ${gp.draw_calls} calls ${(gp.triangles / 1e6).toFixed(2)} M tris · errors ${errors.length}`);
    await ctx.close();
  }

  if (MOBILE && (!ONLY || ONLY.includes('mobile')) && ids.includes('01')) {
    const { ctx, page, errors } = await newPage({ width: 390, height: 844 });
    await page.goto(`${base}/index.html?quality=low#01`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__lab && window.__lab.readyId === '01', null, { polling: 500 });
    await page.evaluate(() => window.__lab.settle(3));
    await shot(page, 'mobile_01_overview.png');
    await page.click('#drawerBar button[data-pane="layers"]');
    await page.evaluate(() => window.__lab.settle(2));
    await shot(page, 'mobile_01_drawer.png');
    perf.mobile = { viewport: [390, 844], console_errors: errors };
    await ctx.close();
  }

  perf.gpu = perf.maps[ids[0]]?.presets.overview?.gpu ?? GPU_SEEN ?? null;
  // a run over a subset of maps updates only those entries in existing result files
  const merge = (file, obj) => {
    const f = path.join(LAB, file);
    if (IDS.length && fs.existsSync(f)) { try { const old = JSON.parse(fs.readFileSync(f, 'utf8')); for (const [k, v] of Object.entries(obj.maps)) obj.maps[k] = { ...(old.maps || {})[k], ...v, ...(ONLY ? { presets: { ...((old.maps || {})[k] || {}).presets, ...v.presets }, load_ms: ((old.maps || {})[k] || {}).load_ms ?? v.load_ms } : {}) }; obj.maps = { ...old.maps, ...obj.maps }; if (ONLY) { obj.generated = old.generated; obj.reshot_at = new Date().toISOString(); } if (!obj.mobile && old.mobile) obj.mobile = old.mobile; } catch (e) { /* unreadable: overwrite */ } }
    fs.writeFileSync(f, JSON.stringify(obj, null, 1));
  };
  merge('perf.json', perf);
  if (!ONLY) merge('route_tests.json', routes);
  await browser.close();
  server.kill();
  console.log('wrote perf.json, route_tests.json, shots/');
}
main().catch((e) => { console.error(e); process.exit(1); });
