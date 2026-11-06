// Headless play-test for the M1 build. Advances the simulation directly (fast), renders frames between steps, screenshots, checks errors.
const { chromium } = require('playwright'); const path = require('path');
process.on('unhandledRejection', e => { console.log('CRASH', e.message); process.exit(1); });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|fonts/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 300)); });
  await page.goto('file://' + path.join(__dirname, 'dist/local.html'), { waitUntil: 'commit', timeout: 60000 }); await page.waitForSelector('#go', { timeout: 60000 }); await page.waitForTimeout(800);
  const faction = process.argv[2] || 'compact', enemy = process.argv[3] || 'lattice';
  await page.click(`[data-faction="${faction}"]`); await page.evaluate(en => { window.__T.UI.slots[1] = { faction: en }; }, enemy); await page.click('#go'); await page.waitForTimeout(400);
  await page.evaluate(() => { window.__T.SIM.G.speed = 0; }); // freeze the rAF loop's own stepping; we drive time ourselves
  const probe = () => page.evaluate(() => { const { SIM: { G } } = window.__T; return { t: +G.t.toFixed(0), credits: G.players.map(p => Math.floor(p.credits)), structs: G.players.map(p => G.ents.filter(e => !e.dead && e.owner === p && (e.def.cls === 'structure' || e.def.cls === 'defence')).length), units: G.players.map(p => G.ents.filter(e => !e.dead && e.owner === p && e.def.cls !== 'structure' && e.def.cls !== 'defence').length), over: G.over, power: G.players.map(p => p.power + '/' + p.drain), fx: window.__T.RENDER.S.fx.length, views: window.__T.RENDER.S.views.size, explored: G.players[0].vis.filter(v => v > 0).length, wrecks: (window.__T.RENDER.S.decals || []).length }; });
  const advance = async sec => { await page.evaluate(s => window.__T.advance(s), sec); await page.waitForTimeout(60); };
  const build = async (id) => {
    const tab = await page.evaluate(id => window.__T.SIM.tabOf(window.__T.SIM.BY[id]), id); await page.evaluate(t => { window.__T.UI.tab = t; window.__T.buildSidebar(); }, tab);
    await page.evaluate(id => window.__T.clickItem(window.__T.SIM.BY[id], 1), id);
    const queued = await page.evaluate(id => (window.__T.UI.me.queue[window.__T.SIM.tabOf(window.__T.SIM.BY[id])] || []).some(q => q.def.id === id), id); if (!queued) { errors.push('not queued: ' + id); return; }
    let ready = false; for (let i = 0; i < 120; i++) { await advance(1); ready = await page.evaluate(id => window.__T.UI.me.ready && window.__T.UI.me.ready.id === id, id); if (ready) break; }
    if (!ready) { errors.push('never ready: ' + id); return; }
    const ok = await page.evaluate(id => { const T = window.__T, G = T.SIM.G, me = T.UI.me; const d = me.ready; const cy = G.ents.find(e => !e.dead && e.owner === me && /Construction/.test(e.def.role)); for (let r = 2; r < 12; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (Math.abs(x) === r || Math.abs(y) === r) if (T.SIM.place(me, d, cy.cx + x, cy.cy + y)) { T.S.placing = null; return true; } return false; }, id);
    if (ok !== true) errors.push('could not place ' + id);
  };
  const order = { compact: ['cmp_reactor', 'cmp_refinery', 'cmp_barracks', 'cmp_armour', 'cmp_reactor', 'cmp_bunker', 'cmp_refinery', 'cmp_radar', 'cmp_reactor', 'cmp_sam'], lattice: ['lat_reactor', 'lat_extractor', 'lat_fabbay', 'lat_assembly', 'lat_reactor', 'lat_sentinel', 'lat_extractor', 'lat_uplink', 'lat_reactor', 'lat_lance'], helix: ['hlx_solar', 'hlx_refinery', 'hlx_office', 'hlx_plant', 'hlx_solar', 'hlx_autoturret', 'hlx_refinery', 'hlx_surveil', 'hlx_solar', 'hlx_flaknest'] }[faction];
  const harv = await page.evaluate(f => window.__T.SIM.ALL.find(d => d.faction === f && (d.tags || []).includes('harvester')).id, faction);
  const defend = { compact: ['cmp_rifleman', 'cmp_rifleman', 'cmp_rockettrooper', 'cmp_rockettrooper', 'cmp_bastion', 'cmp_bastion', 'cmp_hunter'], lattice: ['lat_scuttler', 'lat_scuttler', 'lat_hornet', 'lat_hornet', 'lat_phalanx', 'lat_phalanx', 'lat_hornet'], helix: ['hlx_contractor', 'hlx_contractor', 'hlx_enforcer', 'hlx_arbiter', 'hlx_arbiter', 'hlx_suppressor', 'hlx_netrunner'] }[faction];
  for (const id of order) { await build(id); console.log('built', id, JSON.stringify(await probe())); if (/refinery|extractor/i.test(id)) await page.evaluate(h => window.__T.SIM.enqueue(window.__T.UI.me, window.__T.SIM.BY[h], 1), harv); if (/armour|assembly|plant$/.test(id)) for (const u of defend) await page.evaluate(u => window.__T.SIM.enqueue(window.__T.UI.me, window.__T.SIM.BY[u], 1), u); }
  console.log('after build', JSON.stringify(await probe()));
  const roster = await page.evaluate(f => window.__T.SIM.ALL.filter(d => d.faction === f && window.__T.SIM.buildable(d) && !['structure', 'defence'].includes(d.cls) && !(d.tags || []).includes('harvester')).map(d => d.id), faction);
  for (const id of roster) await page.evaluate(id => window.__T.SIM.enqueue(window.__T.UI.me, window.__T.SIM.BY[id], 1), id);
  for (let i = 0; i < 90; i++) { await advance(1); const s = await probe(); if (s.units[0] >= Math.min(10, roster.length)) break; }
  await page.evaluate(() => { const T = window.__T; const cy = T.SIM.G.ents.find(e => !e.dead && e.owner === T.UI.me && /Construction/.test(e.def.role)) || { x: 300, y: 300 }; T.RENDER.centerOn(cy.x + 100, cy.y + 100); T.S.sel = T.SIM.G.ents.filter(e => !e.dead && e.owner === T.UI.me && e.def.cls === 'vehicle').slice(0, 3); });
  await page.waitForTimeout(300); await page.screenshot({ path: path.join(__dirname, 'dist/shot-base.png') });
  console.log('army built', JSON.stringify(await probe()));
  await page.evaluate(() => { const T = window.__T, G = T.SIM.G, me = T.UI.me; const en = G.players[1]; const t = G.ents.find(e => !e.dead && e.owner === en && /Construction/.test(e.def.role)) || G.ents.find(e => !e.dead && e.owner === en); if (!t) return; const army = G.ents.filter(e => !e.dead && e.owner === me && !['structure', 'defence'].includes(e.def.cls) && !(e.def.tags || []).includes('harvester')); T.SIM.orderGroup(army, t.x, t.y, 'attackmove'); T.RENDER.centerOn(t.x - 80, t.y - 80); });
  let s, shot = false; for (let i = 0; i < 180; i++) { await advance(1); s = await probe(); await page.evaluate(() => { const T = window.__T, G = T.SIM.G; const a = G.ents.filter(e => !e.dead && e.owner === T.UI.me && !['structure', 'defence'].includes(e.def.cls) && !(e.def.tags || []).includes('harvester')); if (a.length) { T.RENDER.centerOn(a.reduce((s, e) => s + e.x, 0) / a.length, a.reduce((s, e) => s + e.y, 0) / a.length); T.S.sel = a.slice(0, 4); } }); if (!shot && s.fx > 12) { shot = true; await page.waitForTimeout(200); await page.screenshot({ path: path.join(__dirname, 'dist/shot-fight.png') }); } if (s.over) break; }
  console.log('end', JSON.stringify(s));
  const jsms = await page.evaluate(() => { const T = window.__T; const t0 = performance.now(); for (let i = 0; i < 30; i++) { T.SIM.step(T.SIM.DT); } const t1 = performance.now(); for (let i = 0; i < 30; i++) T.RENDER.frame(1 / 30); return { simPerTick: ((t1 - t0) / 30).toFixed(2), renderPerFrame: ((performance.now() - t1) / 30).toFixed(2), ents: T.SIM.G.ents.filter(e => !e.dead).length, prof: T.RENDER.S.prof }; }); console.log('ms', JSON.stringify(jsms));
  await page.close(); const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); ph.on('pageerror', e => errors.push('PHONE ' + e.message));
  await ph.goto('file://' + path.join(__dirname, 'dist/local.html'), { waitUntil: 'commit', timeout: 60000 }); await ph.waitForSelector('#go', { timeout: 60000 }); await ph.waitForTimeout(400); await ph.tap('#go'); await ph.waitForTimeout(600);
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); if (overflow) errors.push('phone horizontal overflow');
  await ph.evaluate(() => { window.__T.clickItem(window.__T.SIM.BY[window.__T.SIM.ALL.find(d => d.faction === 'compact' && d.power > 0).id], 1); window.__T.advance(15); });
  await ph.waitForTimeout(300); await ph.screenshot({ path: path.join(__dirname, 'dist/shot-phone.png') });
  await ph.tap('#drawerbtn'); await ph.waitForTimeout(300); await ph.screenshot({ path: path.join(__dirname, 'dist/shot-phone-drawer.png') });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
