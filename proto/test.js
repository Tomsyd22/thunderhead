// Headless play-test of the prototype: boots a match, drives the player with scripted inputs, checks invariants.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, 'dist/local.html'));
  await page.waitForTimeout(300);
  const faction = process.argv[2] || 'compact';
  await page.click(`[data-faction="${faction}"]`); await page.selectOption('#enemy', process.argv[3] || 'lattice'); await page.click('#go');
  await page.waitForTimeout(300);
  // expose a probe
  const probe = () => page.evaluate(() => { const g = window.__G; return g ? { t: g.t, credits: g.players.map(p => Math.floor(p.credits)), ents: g.players.map(p => g.ents.filter(e => !e.dead && e.owner === p).length), structs: g.players.map(p => g.ents.filter(e => !e.dead && e.owner === p && (e.def.cls === 'structure' || e.def.cls === 'defence')).map(e => e.def.id)), units: g.players.map(p => g.ents.filter(e => !e.dead && e.owner === p && e.def.cls !== 'structure' && e.def.cls !== 'defence').map(e => e.def.id)), over: g.over, queue: g.players.map(p => JSON.stringify(Object.fromEntries(Object.entries(p.queue).map(([k, v]) => [k, v.map(q => q.def.id + ':' + q.progress.toFixed(2))])))), ready: g.players.map(p => p.ready && p.ready.id), lowPower: g.players.map(p => p.lowPower), power: g.players.map(p => p.power + '/' + p.drain) } : null; });
  // click sidebar items by id, place near conyard
  const build = async (id, dx, dy) => {
    await page.evaluate(() => { window.__UI.tab = 'structure'; });
    const tab = (await page.evaluate(id => window.__BY[id].cls, id)); await page.evaluate(t => { window.__UI.tab = t; window.__buildSidebar(); }, tab);
    await page.click(`.item[data-id="${id}"]`);
    for (let i = 0; i < 400; i++) { await page.waitForTimeout(100); const r = await page.evaluate(() => window.__UI.me.ready && window.__UI.me.ready.id); if (r === id) break; }
    const ok = await page.evaluate(([id, dx, dy]) => { const UI = window.__UI, G = window.__G, place = window.__place; const cy = G.ents.find(e => !e.dead && e.owner === UI.me && /Construction/.test(e.def.role)); for (let r = 0; r < 8; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) { if (place(UI.me, UI.me.ready, cy.cx + dx + x, cy.cy + dy + y)) return true; } return false; }, [id, dx, dy]);
    if (!ok) errors.push('could not place ' + id);
  };
  const F = { compact: ['cmp_reactor', 'cmp_refinery', 'cmp_barracks', 'cmp_armour', 'cmp_reactor', 'cmp_bunker', 'cmp_refinery', 'cmp_radar', 'cmp_reactor', 'cmp_sam'], lattice: ['lat_reactor', 'lat_extractor', 'lat_fabbay', 'lat_assembly', 'lat_reactor', 'lat_sentinel', 'lat_extractor', 'lat_uplink', 'lat_reactor', 'lat_lance'], helix: ['hlx_solar', 'hlx_refinery', 'hlx_office', 'hlx_plant', 'hlx_solar', 'hlx_autoturret', 'hlx_refinery', 'hlx_surveil', 'hlx_solar', 'hlx_flaknest'] }[faction];
  await page.evaluate(() => { window.__G.speed = 4; });
  const offs = [[4, 0], [0, 4], [4, 4], [-3, 4], [7, 0], [8, 3], [-3, 0], [7, 5], [0, 7], [4, 7]];
  for (let i = 0; i < F.length; i++) await build(F[i], offs[i][0], offs[i][1]);
  let s = await probe(); console.log('after build order', JSON.stringify(s));
  // train units of each infantry/vehicle/air type available
  const roster = await page.evaluate(f => window.__ALL.filter(d => d.faction === f && window.__buildable(d) && !['structure', 'defence'].includes(d.cls)).map(d => d.id), faction);
  for (const id of roster) { const tab = await page.evaluate(id => { const d = window.__BY[id]; return d.cls === 'drone' ? 'infantry' : d.cls; }, id); await page.evaluate(t => { window.__UI.tab = t; window.__buildSidebar(); }, tab); const ok = await page.evaluate(id => window.__enqueue(window.__UI.me, window.__BY[id]), id); if (!ok) console.log('could not enqueue', id); await page.waitForTimeout(50); }
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); s = await probe(); if (s.units[0].length >= roster.length * 0.6) break; }
  console.log('units', JSON.stringify(s.units[0]), 'ai structs', s.structs[1].length, 'ai units', s.units[1].length);
  // attack-move everything to the enemy base
  await page.evaluate(() => { const UI = window.__UI, G = window.__G, order = window.__order; const en = G.players[1]; const t = G.ents.find(e => !e.dead && e.owner === en && /Construction/.test(e.def.role)); for (const e of G.ents) if (!e.dead && e.owner === UI.me && !['structure', 'defence'].includes(e.def.cls) && !(e.def.tags || []).includes('harvester')) order(e, { type: 'attackmove', x: t.x, y: t.y }); });
  let kills = 0; for (let i = 0; i < 90; i++) { await page.waitForTimeout(1000); s = await probe(); if (s.over) break; }
  console.log('end', JSON.stringify({ t: s.t.toFixed(0), credits: s.credits, over: s.over, mine: s.units[0].length, ai: s.units[1].length, aiStructs: s.structs[1], power: s.power, lowPower: s.lowPower, queue: s.queue }));
  await page.screenshot({ path: path.join(__dirname, 'dist/shot.png') });
  // phone viewport check
  const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); ph.on('pageerror', e => errors.push('PHONE ' + e.message));
  await ph.goto('file://' + path.join(__dirname, 'dist/local.html')); await ph.waitForTimeout(200); await ph.click('#go'); await ph.waitForTimeout(500);
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); if (overflow) errors.push('phone horizontal overflow');
  await ph.tap('#game', { position: { x: 100, y: 300 } }); await ph.waitForTimeout(200); await ph.screenshot({ path: path.join(__dirname, 'dist/phone.png') });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
