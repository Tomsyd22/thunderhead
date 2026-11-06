/* node game/shot3d.js [faction] [map] — boots the 3D build, stages a fight, screenshots it, reports errors and frame time. */
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const faction = process.argv[2] || 'compact', map = process.argv[3] || 'riverlands';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = [];
  pg.on('pageerror', e => errs.push('PAGE ' + e.message)); pg.on('console', m => { if (m.type() === 'error' || /THREE/.test(m.text())) errs.push(m.type() + ': ' + m.text().slice(0, 400)); });
  await pg.goto('file://' + path.join(__dirname, 'dist/local.html'), { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(800);
  await pg.click(`#maps button[data-key="${map}"]`); await pg.click(`[data-faction="${faction}"]`); await pg.click('#go'); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: path.join(__dirname, 'dist/s3d-start.png') });
  const info = await pg.evaluate(() => { const T = window.__T, SIM = T.SIM, G = SIM.G; G.speed = 0; const me = G.players[0], en = G.players[1];
    const place = (id, x, y, p = me) => { const e = SIM.spawn(id, p, x, y); e.building = 0; return e; };
    const F = { compact: ['cmp_reactor', 'cmp_refinery', 'cmp_barracks', 'cmp_armour', 'cmp_bunker', 'cmp_sam'], lattice: ['lat_reactor', 'lat_extractor', 'lat_fabbay', 'lat_assembly', 'lat_sentinel', 'lat_lance'], helix: ['hlx_solar', 'hlx_refinery', 'hlx_office', 'hlx_plant', 'hlx_autoturret', 'hlx_flaknest'] }[me.faction];
    place(F[0], 11, 4); place(F[1], 11, 8); place(F[2], 4, 11); place(F[3], 7, 11); place(F[4], 15, 8); place(F[5], 15, 11);
    const army = { compact: ['cmp_bastion', 'cmp_rifleman', 'cmp_rockettrooper', 'cmp_hunter', 'cmp_behemoth', 'cmp_rifleman'], lattice: ['lat_phalanx', 'lat_scuttler', 'lat_hornet', 'lat_colossus', 'lat_lancer', 'lat_scuttler'], helix: ['hlx_arbiter', 'hlx_contractor', 'hlx_suppressor', 'hlx_mogul', 'hlx_enforcer', 'hlx_contractor'] }[me.faction];
    const A = []; for (let i = 0; i < 10; i++) A.push(SIM.spawn(army[i % army.length], me, 13 + (i % 4) * 1.4, 14 + Math.floor(i / 4) * 1.4));
    const B = []; const ea = ['lat_phalanx', 'lat_scuttler', 'lat_hornet', 'lat_scuttler', 'lat_lancer']; for (let i = 0; i < 10; i++) B.push(SIM.spawn(ea[i % 5], en, 21 + (i % 5) * 1.2, 12 + Math.floor(i / 5) * 1.4));
    SIM.spawn(me.faction === 'compact' ? 'cmp_kondor' : me.faction === 'lattice' ? 'lat_raptor' : 'hlx_dragonfly', me, 10, 9);
    SIM.orderGroup(B, 15 * 32, 13 * 32, 'attackmove'); SIM.orderGroup(A, 20 * 32, 13 * 32, 'attackmove');
    me.vis.fill(2); T.RENDER.updateFog(); const S = T.RENDER.S; S.cam.zoom = 1.6; T.RENDER.centerOn(16 * 32, 12 * 32); S.sel = A.slice(0, 4);
    return { ents: G.ents.length }; });
  for (let i = 0; i < 6; i++) { await pg.evaluate(() => { const T = window.__T; T.advance(1); T.SIM.G.players[0].vis.fill(2); T.RENDER.updateFog(); }); await pg.waitForTimeout(120); }
  await pg.screenshot({ path: path.join(__dirname, 'dist/s3d-fight.png') });
  await pg.evaluate(() => { const T = window.__T; T.advance(2.5); T.SIM.G.players[0].vis.fill(2); T.RENDER.updateFog(); }); await pg.waitForTimeout(150);
  await pg.screenshot({ path: path.join(__dirname, 'dist/s3d-fight2.png') });
  await pg.evaluate(() => { const S = window.__T.RENDER.S; S.cam.zoom = 2.6; window.__T.RENDER.centerOn(10 * 32, 9 * 32); }); await pg.waitForTimeout(250);
  await pg.screenshot({ path: path.join(__dirname, 'dist/s3d-close.png') });
  await pg.evaluate(() => { const S = window.__T.RENDER.S; S.cam.zoom = 0.6; window.__T.RENDER.centerOn(36 * 32, 27 * 32); }); await pg.waitForTimeout(250);
  await pg.screenshot({ path: path.join(__dirname, 'dist/s3d-wide.png') });
  const ms = await pg.evaluate(() => { const T = window.__T; const S = T.RENDER.S; S.cam.zoom = 1.4; T.RENDER.centerOn(16 * 32, 12 * 32); const t0 = performance.now(); for (let i = 0; i < 10; i++) T.RENDER.frame(1 / 60); return ((performance.now() - t0) / 10).toFixed(1); });
  console.log(JSON.stringify(info), 'frame ms (software GPU)', ms); console.log('errors', errs.length ? errs.slice(0, 10) : 'none'); await b.close();
})();
