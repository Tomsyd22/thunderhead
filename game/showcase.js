/* node game/showcase.js — close-up of the Blender-built units in-game: idle line-up, walking, firing, dying. Writes dist/sc-*.png */
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = [];
  pg.on('pageerror', e => errs.push('PAGE ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await pg.goto('file://' + path.join(__dirname, 'dist/local.html'), { waitUntil: 'commit', timeout: 60000 }); await pg.waitForSelector('#go', { timeout: 60000 }); await pg.waitForTimeout(600);
  await pg.click('#maps button[data-key="desert"]').catch(() => {}); await pg.click('#go'); await pg.waitForTimeout(1500);
  const snap = async (n, zoom, cx, cy) => { await pg.evaluate(([z, x, y]) => { const T = window.__T, S = T.RENDER.S; S.cam.zoom = z; T.RENDER.centerOn(x * 32, y * 32); T.SIM.G.players[0].vis.fill(2); T.RENDER.updateFog(); }, [zoom, cx, cy]); await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(__dirname, `dist/sc-${n}.png`) }); };
  const ids = ['cmp_bastion', 'cmp_rifleman', 'hlx_arbiter', 'hlx_contractor', 'lat_phalanx', 'lat_scuttler'];
  const info = await pg.evaluate(ids => { const T = window.__T, SIM = T.SIM, G = SIM.G; G.speed = 0; const me = G.players[0], en = G.players[1];
    for (const e of G.ents) if (!e.dead && e.def.cls !== 'structure' && e.def.cls !== 'defence') e.dead = true;
    window.__U = ids.map((id, i) => { const e = SIM.spawn(id, me, 30 + i * 1.6, 30); e.facing = Math.PI * 0.15; return e; });
    window.__E = ids.map((id, i) => SIM.spawn(id, en, 30 + i * 1.6, 40));
    for (const e of window.__E) { e.facing = -Math.PI / 2; }
    T.S.sel = [];
    return ids.map(id => ({ id, glb: !!(T.RENDER.S.views.get && [...T.RENDER.S.views.values()].find(v => v.e.def.id === id)?.pr.glb) })); }, ids);
  await pg.evaluate(() => window.__T.advance(0.2));
  await snap('lineup', 3.2, 34, 30);
  await snap('lineup-wide', 2.0, 34, 31);
  // walk: march the line north-east
  await pg.evaluate(() => { const T = window.__T; for (const e of window.__U) T.SIM.orderGroup([e], e.x + 6 * 32, e.y - 3 * 32, 'move'); T.advance(0.6); });
  await snap('walk', 3.2, 35, 29.5);
  // fight: bring the enemy line in range
  await pg.evaluate(() => { const T = window.__T; for (const e of window.__U) T.SIM.orderGroup([e], e.x, e.y, 'move'); T.advance(0.3); for (let i = 0; i < window.__E.length; i++) { const e = window.__E[i]; e.x = window.__U[i].x + 32 * 0.5; e.y = window.__U[i].y + 32 * 4; } T.SIM.orderGroup(window.__U, window.__U[2].x, window.__U[2].y + 4 * 32, 'attackmove'); T.advance(1.2); });
  await snap('fire', 2.6, 37, 29.5);
  await pg.evaluate(() => window.__T.advance(0.15)); await snap('fire2', 2.6, 37, 29.5);
  await pg.evaluate(() => { const T = window.__T; for (const e of window.__E) if (!e.dead) { e.hp = 1; } T.advance(1.0); }); await snap('die', 2.6, 37, 31);
  console.log(JSON.stringify(info)); console.log('errors', errs.length ? errs : 'none'); await b.close();
})();
