/* node game/artreview.js [faction] — spawns one of every unit/structure of a faction on open ground and screenshots it zoomed in. */
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const faction = process.argv[2] || 'compact', zoom = +(process.argv[3] || 2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
  await pg.goto('file://' + __dirname + '/dist/local.html', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(800);
  await pg.click(`[data-faction="${faction}"]`); await pg.click('#go'); await pg.waitForTimeout(1200);
  const n = await pg.evaluate(([faction, zoom]) => { try {
    const T = window.__T, SIM = T.SIM, G = SIM.G; G.speed = 0; const me = G.players[0]; me.vis.fill(1);
    document.body.classList.add('review'); document.querySelectorAll('#side,#powers,#selpanel,#bottom,#mini,#msgs,#top').forEach(el => el.style.display = 'none');
    // clear everything, lay out a grid of units on grass
    G.t = 0; for (const e of G.ents) { e.dead = true; } T.advance(0.1); G.t = 0; G.ents.length = 0; G.occ.fill(-1); for (let i = 0; i < G.terrain.length; i++) G.terrain[i] = 0; G.ore.fill(0); for (const p of G.players) { p.ai = false; p.vis.fill(1); } T.RENDER.bakeTerrain(); T.RENDER.updateFog();
    const defs = SIM.ALL.filter(d => d.faction === faction && !/spawned/.test((d.tags || []).join()));
    const mobile = defs.filter(d => !SIM.isStruct(d)), structs = defs.filter(d => SIM.isStruct(d));
    let x = 3, y = 3; const spawned = [];
    for (const d of mobile) { const e = SIM.spawn(d.id, me, x, y); e.facing = ((spawned.length * 3) % 16) * Math.PI / 8; spawned.push(e); x += 2.2; if (x > 34) { x = 3; y += 2.2; } }
    y += 3; x = 2; let rowH = 0;
    for (const d of structs) { const [fw, fh] = SIM.FOOT(d); if (x + fw > 36) { x = 2; y += rowH + 1.5; rowH = 0; } const e = SIM.spawn(d.id, me, Math.round(x), Math.round(y)); e.building = 0; x += fw + 1.2; rowH = Math.max(rowH, fh); }
    const R = T.RENDER.S; R.cam.zoom = zoom; R.cam.x = 0; R.cam.y = 0;
    T.advance(0.5); me.vis.fill(2); T.RENDER.updateFog();
    const S = T.RENDER.S; const vs = [...S.views.values()]; return { spawned: spawned.length, ents: G.ents.filter(e => !e.dead).length, views: vs.length, vis: vs.filter(v => v.c.visible).length, atlas: vs.filter(v => v.atlas).length, cam: S.cam, me: me.faction, first: vs[0] && { x: vs[0].c.x, y: vs[0].c.y, bx: vs[0].body.x, w: vs[0].body.width } }; } catch (err) { return 'ERR ' + err.stack; }
  }, [faction, zoom]); console.log('spawned', n);
  await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => { const T = window.__T; const S = T.RENDER.S; let err = null; try { T.RENDER.frame(0.016); } catch (e) { err = e.stack.slice(0, 400); } return { err, views: S.views.size, started: T.UI.started, over: T.SIM.G.over, t: T.SIM.G.t, endHidden: document.querySelector('#end').hidden }; }); console.log('after', JSON.stringify(after));
  await pg.screenshot({ path: path.join(__dirname, 'dist', `review-${faction}.png`) });
  await pg.evaluate(() => { const R = window.__T.RENDER.S; R.cam.y = 10 * 32; }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(__dirname, 'dist', `review-${faction}-structs.png`) });
  console.log('errors', errs.length ? errs : 'none'); await b.close();
})();
