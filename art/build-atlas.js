/* node art/build-atlas.js [faction...] — renders sprite atlases into art/out/ (atlas-<faction>-<page>.png + atlas-<faction>.json) */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const data = ['lattice', 'compact', 'helix'].map(f => require(root + '/data/' + f + '.js')).flat();
const CIV = [['civ_house', 'structure'], ['civ_shop', 'structure'], ['civ_tower', 'structure'], ['civ_warehouse', 'structure'], ['civ_derrick', 'structure']];
(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : ['lattice', 'compact', 'helix', 'civ'];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 500, height: 500 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + __dirname + '/render.html', { waitUntil: 'load' }); await pg.waitForTimeout(300);
  fs.mkdirSync(__dirname + '/out', { recursive: true });
  for (const f of want) {
    const ids = f === 'civ' ? CIV.map(c => c[0]) : data.filter(d => d.faction === f).map(d => d.id);
    const classOf = Object.fromEntries(f === 'civ' ? CIV : data.filter(d => d.faction === f).map(d => [d.id, d.cls]));
    const t0 = Date.now();
    const r = await pg.evaluate(([f, ids, classOf]) => window.renderFaction(f, ids, classOf), [f, ids, classOf]);
    r.pages.forEach((p, i) => fs.writeFileSync(`${__dirname}/out/atlas-${f}-${i}.png`, Buffer.from(p.split(',')[1], 'base64')));
    fs.writeFileSync(`${__dirname}/out/atlas-${f}.json`, JSON.stringify({ frames: r.frames, px: r.px, facings: r.facings, pages: r.pages.length }));
    const sizes = r.pages.map((p, i) => fs.statSync(`${__dirname}/out/atlas-${f}-${i}.png`).size);
    console.log(f, ids.length, 'models', r.pages.length, 'page(s)', sizes.map(s => Math.round(s / 1024) + 'KB').join(' '), Math.round((Date.now() - t0) / 1000) + 's', r.log.length ? 'LOG ' + r.log.join('; ') : '');
  }
  console.log('errors', errs.length ? errs : 'none'); await b.close();
})();
