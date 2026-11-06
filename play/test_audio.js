#!/usr/bin/env node
/* Audio module test: node play/test_audio.js [--port=8793] [--json]
 *
 * Serves play/ with python's http.server, opens audio_test.html in headless Chromium and runs the page's offline
 * self-test (window.__audioSuite.run): every sound is rendered through the full mixer chain into an OfflineAudioContext
 * and measured (duration, peak, RMS, crest, attack, spectrum bands); then voice caps, rate limits, distance / pan /
 * heading, a 700-call battle, baking, no-op safety, the line tables and the speech queue logic (fake speech backend and
 * clock) are checked. There is no audio device here: speech itself cannot be heard, only its scheduling verified.
 * Exit code 1 when any check fails or the page logs an error.
 */
// ES module (play/package.json sets "type": "module"); playwright is resolved through CommonJS so NODE_PATH installs work
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path'; import http from 'http';
import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');

const DIR = path.dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = +opt('port', 8793), JSON_OUT = args.includes('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { const q = http.get(url, (r) => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.setTimeout(2000, () => q.destroy(new Error('timeout'))); });

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
  let up = false; for (let i = 0; i < 40 && !up; i++) { try { up = (await get(`http://127.0.0.1:${PORT}/audio_test.html`)) === 200; } catch (e) { await sleep(150); } }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = []; let code = 0;
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://127.0.0.1:${PORT}/audio_test.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__audioSuite, null, { timeout: 30000 });
    const t0 = Date.now();
    const r = await page.evaluate(() => window.__audioSuite.run());
    if (JSON_OUT) { console.log(JSON.stringify(r, null, 1)); }
    else {
      const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
      console.log(`${pad('sound', 19)}${lp('dur s', 7)}${lp('peak', 8)}${lp('peak dB', 9)}${lp('RMS dB', 8)}${lp('dB(A)', 7)}${lp('crest', 7)}${lp('atk ms', 8)}${lp('centroid', 9)}  ${pad('sub/low/mid/high/air %', 26)}${lp('pre-lim', 8)}${lp('recipe', 8)}`);
      for (const s of r.sounds) console.log(`${pad(s.name, 19)}${lp(s.dur, 7)}${lp(s.peak.toFixed(3), 8)}${lp(s.peakDb, 9)}${lp(s.rmsDb, 8)}${lp(s.punchA, 7)}${lp(s.crestDb, 7)}${lp(s.attackMs, 8)}${lp(s.centroid, 9)}  ${pad(Object.values(s.bands).map((v) => Math.round(v)).join('/'), 26)}${lp(s.rawPeak.toFixed(3), 8)}${lp(s.recipe, 8)}`);
      console.log('');
      for (const c of r.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
      console.log(`\nbake: ${JSON.stringify(r.bake)}\nbattle render (9.4 s of audio): ${JSON.stringify(r.battle)}\nlive AudioContext: ${JSON.stringify(r.live)}`);
      console.log(`${r.checks.filter((c) => c.pass).length}/${r.checks.length} checks passed; suite ${r.ms} ms in page, ${Date.now() - t0} ms wall`);
    }
    if (!r.passed) code = 1;
  } catch (e) { console.error('test error:', e.message); code = 1; }
  if (errors.length) { console.log('page errors:\n  ' + errors.join('\n  ')); code = 1; }
  await browser.close(); srv.kill();
  process.exit(code);
})();
