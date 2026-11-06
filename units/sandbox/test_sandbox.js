#!/usr/bin/env node
/* Unit Sandbox browser test: node units/sandbox/test_sandbox.js [--shots] [--only=tour,battle] [--port=8790]
 *
 * Serves units/sandbox with python's http.server and opens it in headless Chromium (software GL: ANGLE + SwiftShader).
 * three r160 comes from the pinned jsdelivr URLs, answered from the local npm copy (THREE_DIR) when offline.
 *
 * Every scenario runs on the page's deterministic test clock (__sb.advance), which steps 60 Hz presentation frames
 * independent of how slowly the software rasteriser draws. For each it records:
 *   view smoothness (rendered displacement per frame vs speed limits), foot slide during stance, track-belt sync,
 *   JS cost per presentation frame (sim + animation + effects, no GPU), sim ms/tick, events seen and page errors.
 * Then it measures real frame pacing with the live clock (labelled as SwiftShader numbers), and --shots takes
 * screenshots (overview + a close-up of every unit). Results: results/sandbox_results.json and results/shots/*.png.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const DIR = __dirname; const args = process.argv.slice(2); const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = +opt('port', 8790); const SHOTS = args.includes('--shots'); const ONLY = opt('only', null);
const THREE_DIR = process.env.THREE_DIR || path.resolve(DIR, '../../.cache/three-0.160.0'); const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const OUT = path.join(DIR, 'results'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' }); await sleep(800);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = { date: new Date().toISOString(), renderer: 'headless Chromium, ANGLE + SwiftShader (software rasteriser, 2 vCPU) — real-GPU frame rates will differ', scenarios: {}, console: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') results.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
    page.on('pageerror', (e) => results.console.push('pageerror: ' + e.message));
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(CDN)) { const f = path.join(THREE_DIR, u.slice(CDN.length).split('?')[0]); if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: 'application/javascript' }); }
      if (u.includes('fonts.googleapis') || u.includes('fonts.gstatic')) return route.abort();
      return route.continue();
    });
    const t0 = Date.now(); await page.goto(`http://127.0.0.1:${PORT}/index.html?manual=1&scenario=clear&dpr=1&gs=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sb && (window.__sb.ready || window.__sb.errors.some((e) => e.startsWith('boot'))), null, { timeout: 180000 });
    results.loadSeconds = (Date.now() - t0) / 1000; results.bootErrors = await page.evaluate(() => window.__sb.errors.slice());
    const plan = { tour: 40, battle: 45, sortie: 40, emp: 14, garrison: 22, deploy: 20, naval: 40, economy: 60 };
    for (const [sc, secs] of Object.entries(plan)) {
      if (ONLY && !ONLY.split(',').includes(sc)) continue;
      const r = await page.evaluate(([sc, secs]) => {
        const sb = window.__sb; sb.noLod = true; sb.scenario(sc); sb.resetMeasures(); const ev = {};   // noLod: every unit animated every frame, so motion checks cover all of them
        const w = sb.world; const orig = w.emit.bind(w);
        w.emit = (type, o) => { ev[type] = (ev[type] || 0) + 1; return orig(type, o); };
        const st = sb.advance(secs, 60, 0); w.emit = orig;
        const alive = w.units.filter((u) => u.alive).map((u) => `${u.uid}:${u.team}:${Math.round(u.hp)}`);
        const ticks = (sb.tickList || []).slice().sort((a, b) => a - b);
        return { events: ev, smooth: st.smooth, feet: { stances: st.feet.stances, worstCm: +(st.feet.worst * 100).toFixed(2), meanCm: st.feet.stances ? +(st.feet.sum / st.feet.stances * 100).toFixed(2) : 0, list: st.feet.list }, tracks: { samples: st.tracks.samples, worstM: +st.tracks.worst.toFixed(5) },
          lod: false, frameJsMs: { p50: +ticks[Math.floor(ticks.length * 0.5)].toFixed(2), p95: +ticks[Math.floor(ticks.length * 0.95)].toFixed(2), max: +ticks[ticks.length - 1].toFixed(2) }, simMs: +(sb.simMs || 0).toFixed(3), units: alive.length, alive, errors: sb.errors.slice(), simT: +w.t.toFixed(2), stats: w.stats };
      }, [sc, secs]);
      results.scenarios[sc] = r; console.log(sc, JSON.stringify({ ev: r.events.fire || 0, deaths: r.events.death || 0, jumps: r.smooth.jumps, feet: r.feet.worstCm, tracks: r.tracks.worstM, js: r.frameJsMs, errs: r.errors.length }));
      if (SHOTS) { await page.evaluate(() => window.__sb.render()); await page.screenshot({ path: path.join(OUT, 'shots', `scenario_${sc}.png`), timeout: 240000 }); }
    }
    // CPU cost with the normal animation LOD (as played): battle, 30 s
    if (!ONLY || ONLY.includes('cost')) {
      results.cost = await page.evaluate(() => { const sb = window.__sb; sb.noLod = false; sb.scenario('battle'); sb.lookAt(345, 152, 8, 120, -1.3, 0.7); sb.resetMeasures(); sb.advance(30, 60, 0); const P = sb.prof; const tl = sb.tickList.slice().sort((a, b) => a - b);
        return { units: sb.world.units.filter((u) => u.alive).length, p50: +tl[Math.floor(tl.length * 0.5)].toFixed(2), p95: +tl[Math.floor(tl.length * 0.95)].toFixed(2), p99: +tl[Math.floor(tl.length * 0.99)].toFixed(2), max: +tl[tl.length - 1].toFixed(1),
          perFrame: { sim: +(P.sim / P.n).toFixed(3), views: +(P.views / P.n).toFixed(3), infantry: +(P.inf / P.n).toFixed(3), fx: +(P.fx / P.n).toFixed(3) } }; });
      console.log('cost', JSON.stringify(results.cost));
    }
    // attitude / aim probes: sim ↔ view conventions (nose up on climbs, banks, turret and muzzle pointing at the target)
    if (!ONLY || ONLY.includes('probe')) {
      results.probes = await page.evaluate(() => {
        const sb = window.__sb, w = sb.world, out = []; const R2D = 180 / Math.PI;
        const P = (name, ok, val) => out.push({ name, ok: !!ok, val });
        const vec = (o, n) => { const v = sb.views.get(o.id); return v; };
        // 1 tank climbing the 20° ramp (north-facing) → nose up ≈ slope
        sb.scenario('clear'); const F = sb.T.features; const tk = sb.spawn('A03', 0, F.ramp.x, F.ramp.y - F.ramp.len - 12, { hdg: Math.PI / 2 }); w.order(tk, { type: 'move', x: F.ramp.x, y: F.ramp.y + 10 }); let maxP = 0;
        for (let i = 0; i < 18; i++) { sb.advance(0.5, 60, 0); maxP = Math.max(maxP, vec(tk).tilt.rotation.x); }
        P(`tank climbing the 20° ramp pitches nose-up (max ${(maxP * R2D).toFixed(1)}°)`, maxP * R2D > 15 && maxP * R2D < 24, maxP * R2D);
        // 2 turret + muzzle aim at a target on the left
        sb.scenario('clear'); const a = sb.spawn('H03', 0, 150, 230, { hdg: 0 }); const t = sb.spawn('A03', 1, 160, 255, { passive: true, hp: 1e9 }); w.order(a, { type: 'attack', target: t.id }); sb.advance(3, 60, 0);
        const va = vec(a); const mz = va.sock('muzzle'), dir = va.dirOf('muzzle'); const tp = sb.views.get(t.id).group.position.clone(); tp.y += t.geom.hitZ; const want = tp.clone().sub(mz).normalize();
        P(`H03 turret turned toward a target on its left (turret ${(a.turret * R2D).toFixed(1)}°, view yaw ${(va.N.turret.rotation.y * R2D).toFixed(1)}°)`, a.turret > 0.5 && Math.abs(va.N.turret.rotation.y - a.turret) < 0.02, a.turret);
        P(`H03 muzzle socket points at the target (cos ${dir.dot(want).toFixed(4)})`, dir.dot(want) > 0.995, dir.dot(want));
        const sm = w.muzzle(a, a.sys[0]); P(`sim muzzle ≈ model muzzle (${Math.hypot(sm[0] - mz.x, sm[2] - mz.y, -sm[1] - mz.z).toFixed(2)} m)`, Math.hypot(sm[0] - mz.x, sm[2] - mz.y, -sm[1] - mz.z) < 0.6, 0);
        // 3 helicopter flying forward → nose down; rotor spinning
        sb.scenario('clear'); const h = sb.spawn('H04', 0, 100, 150, { hdg: 0 }); w.order(h, { type: 'move', x: 400, y: 150 }); sb.advance(4, 60, 0); const vh = vec(h);
        P(`H04 at ${h.v.toFixed(1)} m/s pitches nose-down (${(vh.tilt.rotation.x * R2D).toFixed(1)}°, max 12°)`, vh.tilt.rotation.x < -0.05 && vh.tilt.rotation.x > -12.5 / R2D, vh.tilt.rotation.x * R2D);
        const r0 = vh.N.rotor ? vh.N.rotor.quaternion.clone() : null; sb.advance(0.1, 60, 0); P('H04 main rotor turning', r0 && vh.N.rotor.quaternion.angleTo(r0) > 0.1, 0);
        w.order(h, { type: 'move', x: h.x + 10, y: h.y + 200 }); let maxB = 0, minB = 0; for (let i = 0; i < 20; i++) { sb.advance(0.1, 60, 0); maxB = Math.max(maxB, vh.tilt.rotation.z); minB = Math.min(minB, vh.tilt.rotation.z); }
        P(`H04 banks into a left turn (right side up, max ${(maxB * R2D).toFixed(1)}°, limit 15°)`, maxB > 0.03 && maxB <= 15.01 / R2D && minB > -15.01 / R2D, maxB * R2D);
        // 4 ship turning left → rolls outward (right side down); hover turning left → banks in (right side up) ≤ 5°
        sb.scenario('clear'); const s = sb.spawn('H05', 0, 560, 120, { hdg: Math.PI / 2 }); w.order(s, { type: 'move', x: 560, y: 300 }); sb.advance(14, 60, 0); w.order(s, { type: 'move', x: 450, y: 300 }); let sr = 0; for (let i = 0; i < 40; i++) { sb.advance(0.1, 60, 0); sr = Math.min(sr, vec(s).tilt.rotation.z); }
        P(`H05 leans outward in a left turn (min roll ${(sr * R2D).toFixed(2)}°)`, sr < -0.4 / R2D, sr * R2D);
        sb.scenario('clear'); const hv = sb.spawn('T03', 0, 120, 280, { hdg: 0 }); w.order(hv, { type: 'move', x: 300, y: 285 }); sb.advance(6, 60, 0); w.order(hv, { type: 'move', x: hv.x + 5, y: hv.y + 120 }); let hb = 0, hbAbs = 0; for (let i = 0; i < 30; i++) { sb.advance(0.05, 60, 0); hb = Math.max(hb, vec(hv).tilt.rotation.z); hbAbs = Math.max(hbAbs, Math.abs(vec(hv).tilt.rotation.z)); }
        P(`T03 banks into a left turn (${(hb * R2D).toFixed(2)}°) within ±5° (|max| ${(hbAbs * R2D).toFixed(2)}°)`, hb > 0.5 / R2D && hbAbs <= 5.01 / R2D, hb * R2D);
        // 5 jet: bank limit and gear stowed in cruise, down when landed
        sb.scenario('clear'); const j = sb.spawn('A04', 0, 0, 0); const tg = sb.spawn('A03', 1, 300, 140, { passive: true }); sb.spawn('T04', 0, 290, 150, { passive: true }); w.order(j, { type: 'attack', target: tg.id });
        let jb = 0, gearUp = false; for (let i = 0; i < 60; i++) { sb.advance(0.1, 60, 0); jb = Math.max(jb, Math.abs(vec(j).tilt.rotation.z)); if (j.jet.phase === 'attack' && j.jet.gear < 0.01) gearUp = true; }
        P(`A04 bank ≤ 55° (max ${(jb * R2D).toFixed(1)}°), gear stowed in the attack run (${gearUp})`, jb <= 55.01 / R2D && gearUp, jb * R2D);
        // 6 A05 missile-cell lid lifts its free (forward) edge before a launch; H05 recoil slides the barrel back
        sb.scenario('clear'); const fr = sb.spawn('A05', 0, 560, 200, { hdg: Math.PI / 2 }); const en = sb.spawn('T05', 1, 575, 262, { passive: true, hp: 1e9 }); w.order(fr, { type: 'attack', target: en.id });
        let lidUp = 0; for (let i = 0; i < 60; i++) { sb.advance(0.05, 60, 0); const vf = vec(fr); if (vf.N.lid_0) lidUp = Math.max(lidUp, vf.dirOf('lid_0').y, vf.dirOf('lid_1').y); }
        P(`A05 cell lid opens upward before launch (free edge rises to ${(Math.asin(Math.min(1, lidUp)) * R2D).toFixed(0)}°)`, lidUp > 0.6, lidUp);
        sb.scenario('clear'); const gb = sb.spawn('H05', 0, 560, 200, { hdg: Math.PI / 2 }); const gt = sb.spawn('T05', 1, 572, 238, { passive: true, hp: 1e9 }); w.order(gb, { type: 'attack', target: gt.id });
        let maxRec = 0; const vg = vec(gb); for (let i = 0; i < 240; i++) { sb.advance(1 / 60, 60, 0); if (vg.N.recoil && vg.recoil0) maxRec = Math.max(maxRec, vg.N.recoil.position.distanceTo(vg.recoil0)); }
        P(`H05 barrel recoils ${maxRec.toFixed(3)} m (spec 0.18 m)`, Math.abs(maxRec - 0.18) < 0.02, maxRec);
        return out;
      });
      for (const p of results.probes) console.log(p.ok ? 'ok  ' : 'FAIL', p.name);
    }
    // pace: the same economy cycle at game speed 1 and at pace.json's speed (identical in game seconds, real = game ÷ speed),
    // plus smoothness / foot slide of the battle and the tour played at the default game speed
    if (!ONLY || ONLY.includes('pace')) {
      results.pace = await page.evaluate(() => {
        const sb = window.__sb, G0 = sb.paceFile.game_speed, out = { file: { game_speed: G0, harvester_speed_ratio: sb.paceFile.harvester_speed_ratio, harvester: sb.paceFile.harvester }, econ: {}, motion: {} };
        for (const g of [1, G0]) { sb.setPace({ game_speed: g, harvester_speed_ratio: sb.paceFile.harvester_speed_ratio }); sb.noLod = true;
          for (const dep of ['near', 'far']) { sb.scenario('economy'); const hv = sb.world.units.find((u) => u.harv); if (dep === 'far') sb.world.harvest(hv, 'far'); let real = 0;
            while (hv.harv.cycles < 2 && real < 400) { sb.advance(1, 60, 0); real += 1; }
            out.econ[`${dep}@${g}`] = { cycles: hv.harv.cycles, game_s: hv.harv.history.map((h) => +h.total.toFixed(4)), real_s: hv.harv.history.map((h) => +(h.total / g).toFixed(3)), legs: hv.harv.last && hv.harv.last.legs, predicted_game_s: +sb.econPredict()[dep].game_s.toFixed(3) }; } }
        sb.setPace({ game_speed: G0 });
        for (const [sc, secs] of [['battle', 20], ['tour', 20]]) { sb.scenario(sc); sb.resetMeasures(); const st = sb.advance(secs, 60, 0); out.motion[sc] = { real_s: secs, game_s: +(secs * G0).toFixed(1), jumps: st.smooth.jumps, samples: st.smooth.samples, feetWorstCm: +(st.feet.worst * 100).toFixed(2), stances: st.feet.stances, tracksWorstM: +st.tracks.worst.toFixed(5) }; }
        sb.setPace({ game_speed: 1 }); return out;
      });
      console.log('pace', JSON.stringify(results.pace.econ), JSON.stringify(results.pace.motion));
    }
    // distant-view models: matching, triangles at a normal RTS camera, no flicker while the camera holds still
    if (!ONLY || ONLY.includes('lod')) {
      results.lod = await page.evaluate(() => {
        const sb = window.__sb, w = sb.world, out = {}; sb.scenario('clear'); sb.noLod = true;
        const ids = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A02', 'A03', 'A04', 'A05', 'T01', 'T02', 'T03', 'T04', 'T05'];
        ids.forEach((id, k) => { const ship = ['H05', 'A05', 'T05'].includes(id); sb.spawn(id, 0, ship ? 540 + k * 4 : 140 + k * 6, ship ? 200 + k * 10 : 230, { hdg: 0 }); });
        sb.advance(0.5, 60, 0); out.report = sb.lodReport();
        const tris = (f) => { sb.forceLod = f; sb.advance(0.1, 60, 0); sb.render(); return sb.renderer.info.render.triangles; };
        sb.scenario('battle'); sb.advance(3, 60, 0);
        for (const [name, dist, el] of [['gameplay', 230, 0.95], ['close', 70, 0.6]]) {
          sb.lookAt(345, 152, 8, dist, -1.3, el); const auto = tris(null), l0 = tris(0); sb.forceLod = null; sb.advance(0.1, 60, 0);
          const ut = (lvOf) => { let t = 0; for (const v of sb.views.values()) if (v.lodMeshes) for (const m of v.lodMeshes) { const g = m.g[lvOf(v)] || m.g[0]; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } return Math.round(t); };
          const uAuto = ut((v) => v.lod), u0 = ut(() => 0);
          out[name] = { camera_m: dist, tris_auto: auto, tris_lod0: l0, saved_pct: +(100 * (1 - auto / l0)).toFixed(1), unit_tris_auto: uAuto, unit_tris_lod0: u0, unit_saved_pct: +(100 * (1 - uAuto / u0)).toFixed(1), levels: sb.lodStats.slice() };
        }
        sb.lookAt(345, 152, 8, 230, -1.3, 0.95); sb.advance(1, 60, 0); const s0 = sb.lodSwitches; sb.advance(5, 60, 0); out.switches_static_camera_5s = sb.lodSwitches - s0;
        // a slow dolly from 40 m to 400 m: every unit should step down through the levels once, without bouncing back
        sb.lookAt(345, 152, 8, 40, -1.3, 0.6); sb.advance(0.5, 60, 0); const d0 = sb.lodSwitches; for (let d = 40; d <= 400; d += 4) { sb.lookAt(345, 152, 8, d, -1.3, 0.6); sb.advance(1 / 30, 60, 0); }
        out.dolly = { switches: sb.lodSwitches - d0, units: sb.views.size, levels_end: sb.lodStats.slice() }; return out;
      });
      console.log('lod', JSON.stringify({ gameplay: results.lod.gameplay, close: results.lod.close, static: results.lod.switches_static_camera_5s, dolly: results.lod.dolly }));
    }
    // live clock: real frame pacing under SwiftShader with the battle running
    if (!ONLY || ONLY.includes('live')) {
      await page.evaluate(() => { const sb = window.__sb; sb.setPace({ game_speed: sb.paceFile.game_speed }); sb.manual = false; sb.scenario('battle'); sb.frames.length = 0; });
      await sleep(15000); results.live = await page.evaluate(() => { const s = window.__sb.stats(); return { avgMs: +s.avg.toFixed(1), p50: +s.p50.toFixed(1), p95: +s.p95.toFixed(1), p99: +s.p99.toFixed(1), max: +s.max.toFixed(1), calls: s.calls, tris: s.tris, units: s.units, simMs: +(s.simMs || 0).toFixed(3) }; });
      console.log('live', JSON.stringify(results.live)); await page.evaluate(() => { window.__sb.manual = true; window.__sb.setPace({ game_speed: 1 }); });
    }
    if (SHOTS) {
      // close-up of every unit: spawn one, let it act for a few seconds, frame it
      await page.evaluate(() => window.__sb.scenario('clear'));
      await page.evaluate(() => { const sb = window.__sb; sb.scenario('economy'); const hv = sb.world.units.find((u) => u.harv); let k = 0; while (hv.harv.state !== 'load' && k++ < 3000) sb.advance(1 / 30, 30, 0); sb.advance(2, 30, 0); const p = sb.views.get(hv.id).group.position; sb.lookAt(p.x, -p.z, p.y, 30, -1.0, 0.4); sb.render(); });
      await page.screenshot({ path: path.join(OUT, 'shots', 'unit_HV.png'), timeout: 240000 });
      const ids = ['H01', 'H02', 'H03', 'H04', 'H05', 'A01', 'A02', 'A03', 'A04', 'A05', 'T01', 'T02', 'T03', 'T04', 'T05'];
      for (const uid of ids) {
        await page.evaluate((uid) => {
          const sb = window.__sb, w = sb.world, F = sb.T.features; sb.scenario('clear');
          const at = { foot: [150, 230], tracked: [120, 290], hover: [300, 335], ship: [560, 250], heli: [120, 160], drone: [140, 170], jet: [0, 0] };
          const k = { H01: 'foot', H02: 'foot', A01: 'foot', A02: 'foot', T01: 'foot', T02: 'foot', H03: 'tracked', A03: 'tracked', T03: 'hover', H04: 'heli', T04: 'drone', A04: 'jet', H05: 'ship', A05: 'ship', T05: 'ship' }[uid];
          const p = at[k]; const u = sb.spawn(uid, 0, p[0], p[1], { hdg: 0.4 });
          if (k === 'jet') { const t = sb.spawn('A03', 1, 260, 140, { passive: true }); sb.spawn('T04', 0, 250, 150, { passive: true }); w.order(u, { type: 'attack', target: t.id }); }
          else if (k === 'ship') { const t = sb.spawn(uid === 'A05' ? 'T05' : 'H05', 1, p[0] + 55, p[1] + 20, { passive: true, hp: 1e9 }); w.order(u, { type: 'attack', target: t.id }); }
          else if (k === 'heli' || k === 'drone') { const t = sb.spawn(k === 'heli' ? 'A03' : 'H01', 1, p[0] + 40, p[1] + 10, { passive: true, hp: 1e9 }); w.order(u, { type: 'attack', target: t.id }); }
          else { const t = sb.spawn(uid === 'H02' || uid === 'T02' || uid === 'A02' ? 'A03' : 'H01', 1, p[0] + 16, p[1] + 6, { passive: true, hp: 1e9 }); if (uid === 'A01' || uid === 'A02') w.order(u, { type: 'deploy' }); else w.order(u, { type: 'attack', target: t.id }); }
          sb.select([u.id], 'close');
        }, uid);
        await page.evaluate(([uid]) => { const sb = window.__sb; sb.advance(uid === 'A04' ? 7.5 : 3.2, 60, 0); const id = [...sb.selected][0]; const v = sb.views.get(id); sb.selected.clear();
          if (v) { const u = v.u; const big = Math.max(u.sp.dimensions_m.length, u.sp.dimensions_m.width); const foot = u.kind === 'foot'; sb.frameUnit(id, foot ? 4.2 : big * 1.35 + 2, foot ? 0.75 : 0.85, foot ? 0.22 : 0.42, foot ? 0.95 : null); }
          sb.render(); }, [uid]);
        await page.screenshot({ path: path.join(OUT, 'shots', `unit_${uid}.png`), timeout: 240000 });
        for (const lv of [1, 2]) { await page.evaluate((l) => { const sb = window.__sb; sb.forceLod = l; sb.advance(1 / 60, 60, 0); sb.render(); }, lv); await page.screenshot({ path: path.join(OUT, 'shots', `unit_${uid}_lod${lv}.png`), timeout: 240000 }); }
        await page.evaluate(() => { window.__sb.forceLod = null; });
      }
    }
    results.pageErrors = await page.evaluate(() => window.__sb.errors.slice());
  } catch (e) { results.fatal = String(e.stack || e); console.error(e); }
  finally { await browser.close(); srv.kill(); }
  fs.writeFileSync(path.join(OUT, 'sandbox_results.json'), JSON.stringify(results, null, 1)); console.log('wrote results/sandbox_results.json');
})();
