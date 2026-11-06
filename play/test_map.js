#!/usr/bin/env node
/* Map view test: node play/test_map.js [--map=01] [--quality=medium] [--port=8791] [--no-full]
 *
 * Serves play/ with python's http.server and opens maptest.html in headless Chromium (software GL: ANGLE + SwiftShader).
 * three r160 is requested from the pinned jsDelivr URLs and answered from the local copy (THREE_DIR, default
 * <repo>/.cache/three-0.160.0). Runs:
 *   game  — maptest.html?exclude=game: team base-kit items (team flag 1 / 2) and unit_* demo units excluded, as the game loads it
 *   full  — maptest.html?exclude=none: the full instance set, as the Map Lab shows it (skipped with --no-full)
 * For each: load time, page errors, renderer stats (draw calls, triangles, instances) for a top-down overview and an RTS
 * gameplay-angle view of the blue base (game run also: the same angle over the densest forest), screenshots, and (game
 * run) the height / normal agreement between T and the rendered LOD0 terrain, the minimap image and the T interface;
 * deck check on both. Results: play/results/test_map.json and play/results/*.png.
 * Run play/copy_map_data.sh first (done automatically when play/maps/<id>/map.json is missing).
 */
// ES module (play/package.json sets "type": "module"); playwright is resolved through CommonJS so NODE_PATH installs work
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs'; import path from 'path'; import http from 'http';
import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');

const DIR = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const MAP = opt('map', '01'), QUALITY = opt('quality', 'medium'), PORT = +opt('port', 8791), FULL = !args.includes('--no-full');
const THREE_DIR = process.env.THREE_DIR || path.resolve(DIR, '../.cache/three-0.160.0'); const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const OUT = path.join(DIR, 'results'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { const q = http.get(url, (r) => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.setTimeout(2000, () => q.destroy(new Error('timeout'))); });

(async () => {
  if (!fs.existsSync(path.join(DIR, 'maps', MAP, 'map.json'))) execFileSync(path.join(DIR, 'copy_map_data.sh'), [MAP], { stdio: 'inherit' });
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}`;
  for (let k = 0; k < 50; k++) { try { if ((await get(base + '/maptest.html')) === 200) break; } catch (e) { /* not up yet */ } await sleep(200); }
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = { date: new Date().toISOString(), map: MAP, quality: QUALITY, viewport: [1280, 720],
    renderer: 'headless Chromium, ANGLE + SwiftShader (software rasteriser) — draw calls, triangles and instance counts are GPU-independent; timings are not', runs: {} };
  const failures = [];
  try {
    for (const run of FULL ? ['game', 'full'] : ['game']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const R = results.runs[run] = { console: [], pageErrors: [] };
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') R.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
      page.on('pageerror', (e) => R.pageErrors.push(String(e.message || e).slice(0, 400)));
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(CDN)) { const f = path.join(THREE_DIR, u.slice(CDN.length).split('?')[0]); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: 'application/javascript' }); }
        return route.continue();
      });
      const t0 = Date.now();
      await page.goto(`${base}/maptest.html?map=${MAP}&quality=${QUALITY}&exclude=${run === 'game' ? 'game' : 'none'}&manual=1&aa=0`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__mt && (window.__mt.ready || window.__mt.errors.length), null, { timeout: 300000 });
      R.wallLoadMs = Date.now() - t0;
      R.timings = await page.evaluate(() => window.__mt.timings);
      R.errors = await page.evaluate(() => window.__mt.errors.slice());
      if (R.errors.length) { failures.push(`${run}: ${R.errors[0]}`); continue; }
      R.notes = await page.evaluate(() => window.__mt.T.notes);
      R.views = {};
      for (const v of run === 'game' ? ['overview', 'base', 'forest'] : ['overview', 'base']) {
        const st = await page.evaluate(async (v) => { const mt = window.__mt; mt.setView(v); mt.renderFrames(2); const s = mt.renderFrames(1); return { ...s, updateMs: mt.updateMs, renderCallMs: mt.renderMs }; }, v);
        const file = path.join(OUT, `map${MAP}_${run}_${v}.png`);
        await page.screenshot({ path: file, timeout: 240000 });
        R.views[v] = { shot: path.relative(DIR, file), drawCalls: st.lastRender.drawCalls, triangles: st.lastRender.triangles, instancesDrawn: st.instances.drawn, instancesTotal: st.instances.total,
          lod1: st.instances.lod1, byCategory: st.instances.byCategory, instancedMeshesVisible: st.instances.instancedMeshesVisible, terrainLevels: st.terrain.levels,
          instanceUpdateMs: +st.instances.lastUpdateMs.toFixed(2), renderCallCpuMs: +st.renderCallMs.toFixed(1) };
        console.log(`${run} ${v}: draw calls ${st.lastRender.drawCalls}, tris ${(st.lastRender.triangles / 1e6).toFixed(2)} M, instances ${st.instances.drawn}/${st.instances.total} (LOD1 ${st.instances.lod1}), instance update ${st.instances.lastUpdateMs.toFixed(2)} ms`);
      }
      const s = await page.evaluate(() => window.__mt.view.stats());
      R.stats = { instances: { total: s.instances.total, excluded: s.instances.excluded, sets: s.instances.sets, instancedMeshes: s.instances.instancedMeshes },
        terrainChunks: s.terrain.chunks, assets: s.assets, memory: s.memory, structures: s.structures, buildMs: s.buildMs };
      if (s.assets.missing.length) console.log(`${run}: assets without GLB (skipped): ${s.assets.missing.join(', ')}`);
      if (Object.keys(s.assets.failed).length) failures.push(`${run}: GLB load failures ${JSON.stringify(s.assets.failed)}`);
      R.deckCheck = await page.evaluate(() => window.__mt.deckCheck());
      if (run === 'game') {
        R.heightCheck = await page.evaluate(() => window.__mt.heightCheck({ count: 300, stress: 100, e: 1.0 }));
        const hc = R.heightCheck;
        console.log(`height check: ${hc.points} points, max |T.height − mesh| ${hc.maxDh.toFixed(4)} m (mean ${hc.meanDh.toFixed(5)}), Lab bilinear max ${hc.maxDhBilinear.toFixed(3)} m, normal max ${hc.maxNormalDeg.toFixed(3)}° → ${hc.pass ? 'PASS' : 'FAIL'}`);
        if (!hc.pass) failures.push(`height check failed: ${JSON.stringify(hc.worst)} / normal ${hc.maxNormalDeg.toFixed(3)}°`);
        const png = await page.evaluate(() => window.__mt.minimapPNG());
        const mmFile = path.join(OUT, `map${MAP}_minimap.png`); fs.writeFileSync(mmFile, Buffer.from(png.split(',')[1], 'base64')); R.minimap = path.relative(DIR, mmFile);
        // the API surface the engine relies on (makeTerrain drop-in)
        R.api = await page.evaluate(() => {
          const T = window.__mt.T, out = {};
          for (const k of ['W', 'H', 'height', 'surface', 'depth', 'slopeDeg', 'normal', 'los', 'rocks', 'features', 'meta', 'id', 'g', 'n', 'terrain', 'deckAt', 'waterLevel', 'navBits', 'surfaceClass', 'roadMask', 'cellOf', 'instances']) out[k] = T[k] === undefined ? 'MISSING' : Array.isArray(T[k]) ? `array(${T[k].length})` : ArrayBuffer.isView(T[k]) ? `${T[k].constructor.name}(${T[k].length})` : typeof T[k];
          const p = [450, 1404], w = [60, 1360], dock = [144, 1359];
          out.samples = { base: { height: T.height(...p), surface: T.surface(...p), depth: T.depth(...p), slopeDeg: T.slopeDeg(...p), normal: T.normal(...p), nav: T.navAt(...p), tank: T.passable('tank', ...p) },
            sea: { height: T.height(...w), surface: T.surface(...w), depth: T.depth(...w), ship: T.passable('ship', ...w) },
            dock: { height: T.height(...dock), surface: T.surface(...dock), terrain: T.terrain(...dock), deck: T.deckAt(...dock) },
            los: { overRidge: T.los(450, 1404, 16, 1233, 1224, 22), short: T.los(450, 1404, 16, 470, 1404, 16) } };
          return out;
        });
        const miss = Object.entries(R.api).filter(([, v]) => v === 'MISSING').map(([k]) => k);
        if (miss.length) failures.push(`T is missing ${miss.join(', ')}`);
      }
      console.log(`${run}: load ${R.wallLoadMs} ms wall (map data ${R.timings.mapDataMs} ms, view ${R.timings.mapViewMs} ms, GLBs ${s.assets.assetsMs} ms), deck check ${R.deckCheck.hit}/${R.deckCheck.cells} cells hit, max Δ ${R.deckCheck.maxDh.toFixed(3)} m`);
      if (R.pageErrors.length) failures.push(`${run}: page errors: ${R.pageErrors.join(' | ')}`);
      await ctx.close();
    }
  } catch (e) { failures.push('test harness: ' + (e.stack || e.message || e)); }
  results.failures = failures;
  fs.writeFileSync(path.join(OUT, 'test_map.json'), JSON.stringify(results, null, 1));
  await browser.close(); srv.kill();
  console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS — no page errors, height/normal agreement within tolerance');
  process.exit(failures.length ? 1 : 0);
})();
