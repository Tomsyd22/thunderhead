// In-page performance and feel benchmark (round 1). Runs on the real clock in whatever browser shows the game, so it is
// the measurement to trust on real hardware (the headless tests use a software rasteriser).
// Start it from the parent page or a console:  frame.postMessage({ type: 'thunderhead-bench', ... }, '*')
//   { type: 'thunderhead-quality', quality: 'low' | 'medium' | 'high' }  saves the preset and reloads (it needs a new renderer)
//   { type: 'thunderhead-bench', seconds: 20 }                           starts a match if needed, stages a battle, then:
//     1. frame times while the camera sweeps the base, the battle and a wide view (fps, 1 % low, p50 / p95 / p99 frame time,
//        hitches = frames over twice the median, the longest frame)
//     2. input-to-frame latency: a real pointer event dispatched on the canvas (right-click move order) → the order is
//        acknowledged → the first frame that contains it is submitted (rAF after the order); 12 samples
//   Results go back to the parent as { type: 'thunderhead-bench-result', ... } and show in a small panel.
export function installBench(C) {
  addEventListener('message', async (e) => {
    const d = e.data || {}; if (typeof d !== 'object') return;
    if (d.type === 'thunderhead-quality') {
      try { const s = JSON.parse(localStorage.getItem('thunderhead.settings') || '{}'); s.quality = d.quality; localStorage.setItem('thunderhead.settings', JSON.stringify(s)); } catch (err) { /* storage off */ }
      e.source && e.source.postMessage({ type: 'thunderhead-quality-ok', quality: d.quality }, '*'); setTimeout(() => location.reload(), 50); return;
    }
    if (d.type === 'thunderhead-ping') { e.source && e.source.postMessage({ type: 'thunderhead-pong', ready: C.ready, started: C.started, quality: C.quality }, '*'); return; }
    if (d.type !== 'thunderhead-bench') return;
    let res; try { res = await run(C, d); } catch (err) { res = { error: String(err && (err.stack || err.message) || err) }; }
    e.source && e.source.postMessage(Object.assign({ type: 'thunderhead-bench-result' }, res), '*'); show(res);
  });
}

const raf = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))] || 0; };

async function run(C, d) {
  for (let i = 0; i < 600 && !C.ready; i++) await sleep(100);
  if (!C.started) { C.startMatch({ faction: d.faction || 'compact', ai: d.ai || 'lattice', level: d.level || 'normal' }); }
  for (let i = 0; i < 100 && !C.P; i++) await sleep(50);
  const W = C.world, p = C.p, y = W.byId.get(p.yard);
  // a battle in front of the base: 14 of ours against 14 of theirs, mixed infantry and armour
  const F = { compact: ['H01', 'H02', 'H03'], lattice: ['T01', 'T02', 'T03'], helix: ['A01', 'A01', 'A03'] }, en = C.enemy;
  const mx = y.x + (C.T.W / 2 - y.x) * 0.22, my = y.y + (C.T.H / 2 - y.y) * 0.22;
  for (let k = 0; k < 14; k++) for (const [pl, side] of [[p, -1], [en, 1]]) {
    const uid = F[pl.faction][k % 3], q = W.nav.nearestOk(uid.endsWith('3') ? 'veh' : 'foot', mx + side * 45 + (k % 4) * 6, my + Math.floor(k / 4) * 7, 2.5, 60); if (!q) continue;
    const u = W.spawn(uid, pl.team, q[0], q[1], { hdg: side > 0 ? Math.PI : 0 }); u.owner = pl.id; W.order(u, { type: 'attackMove', x: mx - side * 60, y: my });
  }
  C.input.select([], false);
  const cam = C.rcam, path = [[y.x, y.y, 150], [mx, my, 120], [mx, my, 90], [(y.x + mx) / 2, (y.y + my) / 2, 300], [C.T.W / 2, C.T.H / 2, 520]];
  // warm-up (shader compiles, texture uploads)
  cam.setFocus(path[0][0], path[0][1]); cam.distT = path[0][2]; for (let i = 0; i < 90; i++) await raf();
  const secs = d.seconds || 20, times = [], long = [], t0 = performance.now(); let last = t0, seg = -1; const lt = [];
  let po = null; try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push({ t: Math.round(e.startTime - t0), ms: Math.round(e.duration) }); }); po.observe({ type: 'longtask', buffered: false }); } catch (err) { /* no longtask API */ }
  while (performance.now() - t0 < secs * 1000) {
    const now = await raf(), f = (now - t0) / (secs * 1000), s = Math.min(path.length - 2, Math.floor(f * (path.length - 1)));
    if (s !== seg) { seg = s; const [x, yy, dist] = path[s + 1]; cam.flyTo ? cam.flyTo(x, yy, 0.6) : cam.setFocus(x, yy); cam.distT = dist; }
    const dtf = now - last; times.push(dtf); last = now; if (dtf > 150) { const c = C.cpu[C.cpu.length - 1] || [0, 0]; long.push({ t: Math.round(now - t0), ms: Math.round(dtf), tick: +c[0].toFixed(1), render: +c[1].toFixed(1), seg }); }
  }
  if (po) po.disconnect();
  times.shift();
  const st = C.stats(), med = pct(times, 0.5), avg = times.reduce((a, b) => a + b, 0) / times.length, worst1 = [...times].sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(times.length / 100)));
  const frames = { fps: 1000 / avg, low1: 1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length), p50: med, p95: pct(times, 0.95), p99: pct(times, 0.99), max: Math.max(...times), hitches: times.filter((t) => t > 2 * med).length, n: times.length };
  // input-to-frame latency: right-click on open ground near the battle with our squad selected
  const ours = W.units.filter((u) => u.alive && u.team === p.team && u.kind === 'foot').slice(0, 6).map((u) => u.id); C.input.select(ours, false);
  cam.setFocus(mx, my); cam.distT = 140; for (let i = 0; i < 30; i++) await raf();
  const cv = document.querySelector('#view'), lat = [];
  for (let k = 0; k < 12; k++) {
    const [sx, sy] = C.screenOf(mx - 30 + (k % 4) * 8, my - 20 + Math.floor(k / 4) * 8); const n0 = C.acks.length;
    const opt = { clientX: sx, clientY: sy, button: 2, buttons: 2, bubbles: true, pointerType: 'mouse', isPrimary: true };
    const tIn = performance.now(); cv.dispatchEvent(new PointerEvent('pointerdown', opt));
    cv.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opt, { buttons: 0 })));
    const acked = C.acks.length > n0; await raf(); const tFrame = performance.now(); await raf();   // the frame after the ack has been submitted
    lat.push({ ack: acked, ms: tFrame - tIn }); await sleep(120 + Math.random() * 60);
  }
  const ok = lat.filter((l) => l.ack).map((l) => l.ms); const cpu = C.cpu.slice(-300), cpuT = cpu.map((c) => c[0]), cpuR = cpu.map((c) => c[1]);
  const gl = C.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    quality: C.quality, canvas: [C.renderer.domElement.width, C.renderer.domElement.height], css: [innerWidth, innerHeight], dpr: devicePixelRatio, pixelRatio: C.renderer.getPixelRatio(),
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), post: !!(C.post && C.post.enabled), resScale: C.resScale, units: st.units, calls: st.calls, tris: st.tris, tickAvg: st.tickAvg, tickP99: st.tickP99,
    frames, long: long.slice(0, 12), longtasks: lt.slice(0, 12), cpu: { tickP50: pct(cpuT, 0.5), tickP95: pct(cpuT, 0.95), renderP50: pct(cpuR, 0.5), renderP95: pct(cpuR, 0.95) }, latency: { n: ok.length, of: lat.length, p50: pct(ok, 0.5), max: ok.length ? Math.max(...ok) : null, refreshMs: med }, ua: navigator.userAgent, hidden: document.hidden, errors: C.errors.slice(0, 5),
  };
}

function show(r) {
  let el = document.getElementById('benchOut'); if (!el) { el = document.createElement('pre'); el.id = 'benchOut'; el.style.cssText = 'position:fixed;left:12px;top:44px;z-index:50;background:rgba(10,12,14,.88);color:#d6dde4;font:12px/1.4 "JetBrains Mono",monospace;padding:10px 12px;border:1px solid #3a4652;max-width:46vw;white-space:pre-wrap;pointer-events:none'; document.body.appendChild(el); }
  if (r.error) { el.textContent = 'bench error: ' + r.error; return; } const f = r.frames;
  el.textContent = `Benchmark · ${r.quality} · ${r.canvas.join('×')} px (dpr ${r.dpr}, pixel ratio ${r.pixelRatio.toFixed(2)})${r.post ? ' · post on' : ''}\n${r.gpu}\n` +
    `${f.fps.toFixed(1)} fps avg · 1 % low ${f.low1.toFixed(1)} · frame p50 ${f.p50.toFixed(1)} / p95 ${f.p95.toFixed(1)} / p99 ${f.p99.toFixed(1)} / max ${f.max.toFixed(0)} ms · hitches ${f.hitches}/${f.n}\n` +
    `input → frame ${r.latency.p50.toFixed(1)} ms median (${r.latency.n}/${r.latency.of} acknowledged) · ${r.units} units · ${r.calls} draws · ${(r.tris / 1e6).toFixed(2)} M tris · sim ${r.tickAvg.toFixed(2)} ms/tick`;
}
