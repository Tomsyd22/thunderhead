const fs=require('fs'), p=__dirname;
const strip = s => s.replace(/if \(typeof module !== 'undefined'\) module\.exports = \w+;\n?/g,'');
const data = ['../data/rules.js','../data/lattice.js','../data/compact.js','../data/helix.js','./voice.js'].map(f=>strip(fs.readFileSync(p+'/'+f,'utf8'))).join('\n');
const game = fs.readFileSync(p+'/game.js','utf8');
const shell = fs.readFileSync(p+'/shell.html','utf8');
fs.mkdirSync(p+'/dist',{recursive:true});
fs.writeFileSync(p+'/dist/thunderhead.html', shell + '\n<script>\n' + data + '\n' + game + '\n</script>\n');
// local test copy with full skeleton
fs.writeFileSync(p+'/dist/local.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">' + shell + '\n<script>\n' + data + '\n' + game + '\n</script></body></html>');
console.log('bundle', fs.statSync(p+'/dist/thunderhead.html').size, 'bytes');
