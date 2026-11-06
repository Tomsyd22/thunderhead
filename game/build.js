/* node game/build.js → game/dist/thunderhead.html (self-contained) and game/dist/local.html (same, for local testing). */
const fs = require('fs'), p = __dirname;
const strip = s => s.replace(/if \(typeof module !== 'undefined'\) module\.exports = [^;\n]+;?\n?/g, '');
const data = ['../data/rules.js', '../data/lattice.js', '../data/compact.js', '../data/helix.js', '../proto/voice.js'].map(f => strip(fs.readFileSync(p + '/' + f, 'utf8'))).join('\n');
// procedural stand-in models (art/models.js), wrapped so their helper names stay private
const models = 'const ARTMODELS = (() => {\n' + strip(fs.readFileSync(p + '/../art/models.js', 'utf8')) + '\nreturn { MODELS, PAL, setAnim };\n})();';
// Blender-built models (blender/out/*.glb), embedded as base64; the renderer prefers these over the stand-ins
const glbDir = p + '/../blender/out'; const glbs = {}; if (fs.existsSync(glbDir)) for (const f of fs.readdirSync(glbDir)) if (f.endsWith('.glb')) glbs[f.replace(/\.glb$/, '')] = fs.readFileSync(glbDir + '/' + f).toString('base64');
const texs = {}; if (fs.existsSync(glbDir)) for (const f of fs.readdirSync(glbDir)) if (f.endsWith('.png')) texs[f.replace(/\.png$/, '')] = 'data:image/png;base64,' + fs.readFileSync(glbDir + '/' + f).toString('base64');
const glbJs = 'const GLB_MODELS = ' + JSON.stringify(glbs) + ';\nconst TEX_ASSETS = ' + JSON.stringify(texs) + ';';
const depth = fs.readFileSync(p + '/depth.js', 'utf8'), ai = fs.readFileSync(p + '/ai.js', 'utf8');
const code = ['map.js', 'sim.js', 'render3d.js', 'audio.js', 'ui.js', 'editor.js'].map(f => { let t = fs.readFileSync(p + '/' + f, 'utf8'); if (f === 'sim.js') t = t.replace('function newGame(', depth + '\nfunction newGame(').replace('/*AI_SPLICE*/', ai); return t; }).join('\n');
const three = fs.readFileSync(p + '/../vendor/three-bundle.js', 'utf8');
const shell = fs.readFileSync(p + '/shell.html', 'utf8');
fs.mkdirSync(p + '/dist', { recursive: true });
const page = shell + `\n<script>\n${three}\n</script>\n<script>\n${glbJs}\n${models}\n${data}\n${code}\n</script>\n`;
fs.writeFileSync(p + '/dist/thunderhead.html', page);
fs.writeFileSync(p + '/dist/local.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">' + page + '</body></html>');
console.log('bundle', fs.statSync(p + '/dist/thunderhead.html').size, 'bytes', Object.keys(glbs).length, 'glb models');
