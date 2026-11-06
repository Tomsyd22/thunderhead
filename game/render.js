/* Thunderhead renderer — PixiJS 7. Procedural sprites until the art milestone. Global in: PIXI, SIM. Global out: RENDER. */
const RENDER = (() => {
'use strict';
const { G, CELL, MAPW, MAPH, FOOT, isAir, isInf, isStruct, hasTag, idx, inMap, visibleTo, canSee } = SIM;
const S = { app: null, world: null, layers: {}, views: new Map(), cam: { x: 0, y: 0, zoom: 1 }, shake: 0, shakeX: 0, shakeY: 0, me: null, texCache: new Map(), fx: [], fog: null, fogBuf: null, oreG: null, oreT: 0, sel: [], placing: null, ghost: null, hover: null, time: 0, reduced: false };
const hpColor = f => f > 0.5 ? 0x52d273 : f > 0.25 ? 0xf2c744 : 0xef4b4b;
const FC = { civ: { body: 0xc9b8a0, panel: 0x8f6b4e, glow: 0xb23a2e, dark: 0x5a4636 }, lattice: { body: 0xe8eef0, panel: 0xb9c6cc, glow: 0x2ec4d6, dark: 0x5a6a72 }, compact: { body: 0x6b7340, panel: 0x4f5630, glow: 0xd9a441, dark: 0x2f3320 }, helix: { body: 0x23262e, panel: 0x3a3f4b, glow: 0xe0479e, dark: 0x101216 } };

function init(canvas) {
  S.app = new PIXI.Application({ view: canvas, resizeTo: window, backgroundColor: 0x0b0f12, resolution: navigator.webdriver ? 1 : Math.min(2, window.devicePixelRatio || 1), autoDensity: true, antialias: true });
  S.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  S.world = new PIXI.Container(); S.app.stage.addChild(S.world);
  for (const n of ['terrain', 'ore', 'decor', 'wrecks', 'ground', 'structs', 'fx', 'air', 'fog', 'ui']) { const c = new PIXI.Container(); S.layers[n] = c; S.world.addChild(c); }
  S.layers.ground.sortableChildren = true; S.layers.structs.sortableChildren = true; S.layers.air.sortableChildren = true;
  S.oreG = new PIXI.Graphics(); S.layers.ore.addChild(S.oreG); S.decals = []; S.decalDirty = true;
  S.ghost = new PIXI.Graphics(); S.layers.ui.addChild(S.ghost);
  S.selG = new PIXI.Graphics(); S.layers.ui.addChild(S.selG);
  loadAtlas();
}
// ───────── sprite atlas (art/ pipeline) ─────────
const AT = { pages: {}, tex: new Map(), ready: false, scale: 0.5 };
function loadAtlas() { if (typeof ATLAS === 'undefined' || !ATLAS) return; const loads = []; for (const f of Object.keys(ATLAS)) { AT.pages[f] = ATLAS[f].pages.map(src => { const b = PIXI.BaseTexture.from(src, { scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.OFF }); loads.push(new Promise(res => { if (b.valid) res(); else { b.once('loaded', res); b.once('error', res); } })); return b; }); AT.scale = 32 / (ATLAS[f].px || 64); } AT.promise = Promise.all(loads).then(() => { AT.ready = true; }); }
function atlasRec(d, f) { const a = typeof ATLAS !== 'undefined' && ATLAS && ATLAS[f]; return a && a.frames[d.id] ? a.frames[d.id] : null; }
function frameTex(f, fr) { const key = f + ':' + fr[0] + ':' + fr[1] + ':' + fr[2]; let t = AT.tex.get(key); if (!t) { t = new PIXI.Texture(AT.pages[f][fr[0]], new PIXI.Rectangle(fr[1], fr[2], fr[3], fr[4])); AT.tex.set(key, t); } return t; }
function setFrame(sprite, f, fr) { sprite.texture = frameTex(f, fr); sprite.anchor.set(fr[5] / fr[3], fr[6] / fr[4]); }
const facingIndex = (ang, n) => (((Math.round(ang / (Math.PI * 2 / n)) % n) + n) % n);
function atlasSprite(f, fr) { const sp = new PIXI.Sprite(frameTex(f, fr)); sp.anchor.set(fr[5] / fr[3], fr[6] / fr[4]); sp.scale.set(AT.scale); return sp; }
function tex(key, draw) { if (S.texCache.has(key)) return S.texCache.get(key); const g = new PIXI.Graphics(); draw(g); const t = S.app.renderer.generateTexture(g, { resolution: 2 }); g.destroy(); S.texCache.set(key, t); return t; }

// ───────── terrain ─────────
const THEMES = {
  grass:  { ground: [0x35532a, 0x44663a], ground2: 0x2c4523, tuft: 0x5a7a3e, rock: [0x4a433d, 0x5c544c], rockDark: 0x2e2926, water: [0x1b3f66, 0x234f7a], waterLight: 0x3f7fb0, shore: [0x7a7050, 0x8f8460], shoreDot: 0xa39a70, road: [0x4e4e49, 0x5a5a54], roadEdge: 0x6a6a62, roadMark: 0x8a8a7a, bridge: 0x5a4634, plank: 0x7a6248, cliff: [0x4e3f30, 0x5e4b3a], cliffLight: 0x8a7a60, cliffDark: 0x2b2219, scrub: [0x24401e, 0x2f5a28], scrubLight: 0x4d7a3a },
  desert: { ground: [0xb59a62, 0xc4a96e], ground2: 0xa88e58, tuft: 0x9a8a50, rock: [0x7a6248, 0x8c7256], rockDark: 0x4a3a2a, water: [0x2a6a8a, 0x3a86a8], waterLight: 0x7ac0d8, shore: [0xd2bb86, 0xe0ca94], shoreDot: 0xeedcae, road: [0x8e8068, 0x9a8c74], roadEdge: 0xa89a80, roadMark: 0xc4b89c, bridge: 0x6a5238, plank: 0x8a6e4a, cliff: [0x8a6a44, 0x9c7a50], cliffLight: 0xd4b080, cliffDark: 0x5a4028, scrub: [0x7a7a40, 0x8e8e4c], scrubLight: 0xa8a860 },
  urban:  { ground: [0x4a5a40, 0x56684a], ground2: 0x3e4c36, tuft: 0x6a7a58, rock: [0x4a4a4a, 0x5c5c5c], rockDark: 0x2a2a2a, water: [0x1f4868, 0x28587c], waterLight: 0x4a88b4, shore: [0x8a8a70, 0x9a9a80], shoreDot: 0xb0b094, road: [0x5e5e5a, 0x6a6a66], roadEdge: 0x8a8a84, roadMark: 0xc9c27a, bridge: 0x5a4634, plank: 0x7a6248, cliff: [0x4a4038, 0x5a4e44], cliffLight: 0x8a7e70, cliffDark: 0x2b2420, scrub: [0x2f4a2a, 0x3a5a34], scrubLight: 0x5a7a4a },
};
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16); return (h >>> 0) / 4294967296; }
function bakeTerrain() {
  for (const n of ['terrain', 'decor', 'wrecks', 'ground', 'structs', 'fx', 'air', 'fog']) S.layers[n].removeChildren();
  S.views.clear(); S.fx = []; S.decals = []; S.decalG = null; S.mineG = null; S.crateG = null; S.fieldG = null;
  const g = new PIXI.Graphics();
  const TT = SIM.TT; const P = THEMES[G.theme] || THEMES.grass; const tAt = (x, y) => inMap(x, y) ? G.terrain[idx(x, y)] : TT.WATER;
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const h = hash2(x, y), h2 = hash2(x + 101, y + 7), h3 = hash2(x + 37, y + 211); const t = G.terrain[idx(x, y)]; const X = x * CELL, Y = y * CELL;
    // base tile
    let col = blend(P.ground[0], P.ground[1], h * 0.6 + hash2(x >> 2, y >> 2) * 0.4);
    if (t === TT.ROCK) col = blend(P.rock[0], P.rock[1], h); else if (t === TT.WATER) col = blend(P.water[0], P.water[1], h); else if (t === TT.SHORE) col = blend(P.shore[0], P.shore[1], h); else if (t === TT.ROAD) col = blend(P.road[0], P.road[1], h); else if (t === TT.BRIDGE) col = P.bridge; else if (t === TT.CLIFF) col = blend(P.cliff[0], P.cliff[1], h); else if (t === TT.SCRUB) col = blend(P.ground[0], P.ground[1], h);
    g.beginFill(col); g.drawRect(X, Y, CELL, CELL); g.endFill();
    if (t === TT.GRASS || t === TT.SCRUB) { // tufts and soil patches
      g.beginFill(P.ground2, 0.5); if (h2 < 0.35) g.drawEllipse(X + 6 + h * 20, Y + 6 + h2 * 20, 5 + h3 * 6, 3 + h * 3); g.endFill();
      g.lineStyle(1, P.tuft, 0.55); for (let i = 0; i < 3; i++) { const px = X + 3 + ((h * 97 + i * 31) % 26), py = Y + 4 + ((h2 * 83 + i * 17) % 24); g.moveTo(px, py + 3); g.lineTo(px + 1.5 - (i % 2) * 3, py - 2); } g.lineStyle(0);
    }
    if (t === TT.SCRUB) { g.beginFill(P.scrub[0]); g.drawCircle(X + 11 + h * 10, Y + 12 + h2 * 8, 8 + h3 * 4); g.drawCircle(X + 20 - h2 * 8, Y + 20 - h * 6, 6 + h * 3); g.endFill(); g.beginFill(P.scrub[1]); g.drawCircle(X + 9 + h * 10, Y + 10 + h2 * 8, 5 + h3 * 3); g.endFill(); g.beginFill(P.scrubLight, 0.8); g.drawCircle(X + 8 + h * 10, Y + 8 + h2 * 8, 2.2); g.drawCircle(X + 18 - h2 * 8, Y + 17 - h * 6, 1.6); g.endFill(); }
    if (t === TT.ROCK) { g.beginFill(P.rockDark); g.drawPolygon([X + 3, Y + 27, X + 10, Y + 7 + h * 6, X + 20 + h2 * 6, Y + 12, X + 29, Y + 26]); g.endFill(); g.beginFill(P.rock[1]); g.drawPolygon([X + 8, Y + 24, X + 13, Y + 12 + h * 4, X + 20, Y + 16, X + 24, Y + 24]); g.endFill(); g.lineStyle(1, P.rockDark, 0.7); g.moveTo(X + 12, Y + 24); g.lineTo(X + 16 + h * 6, Y + 14); g.lineStyle(0); }
    if (t === TT.WATER) { const deep = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => tAt(x + dx, y + dy) === TT.WATER); if (!deep) { g.beginFill(P.waterLight, 0.22); g.drawRect(X, Y, CELL, CELL); g.endFill(); } g.beginFill(P.waterLight, 0.35); g.drawRect(X + 4 + h * 10, Y + 10 + h2 * 8, 10, 1.5); g.drawRect(X + 14 - h2 * 8, Y + 22 - h * 6, 8, 1.5); g.endFill(); }
    if (t === TT.SHORE) { g.beginFill(P.shoreDot, 0.6); g.drawCircle(X + 6 + h * 16, Y + 6 + h2 * 16, 1.8); g.drawCircle(X + 20 - h * 10, Y + 22 - h2 * 10, 1.3); g.drawCircle(X + 14 + h3 * 10, Y + 14 - h * 6, 1.1); g.endFill(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (tAt(x + dx, y + dy) === TT.WATER) { g.beginFill(0xffffff, 0.22); if (dx === 1) g.drawRect(X + CELL - 3, Y, 3, CELL); if (dx === -1) g.drawRect(X, Y, 3, CELL); if (dy === 1) g.drawRect(X, Y + CELL - 3, CELL, 3); if (dy === -1) g.drawRect(X, Y, CELL, 3); g.endFill(); } }
    if (t === TT.BRIDGE) { g.beginFill(P.plank); for (let i = 0; i < 4; i++) g.drawRect(X + i * 8 + 1, Y, 6, CELL); g.endFill(); const vertical = tAt(x, y - 1) === TT.BRIDGE || tAt(x, y + 1) === TT.BRIDGE; const up = tAt(x, y - 1) !== TT.BRIDGE, dn = tAt(x, y + 1) !== TT.BRIDGE, lf = tAt(x - 1, y) !== TT.BRIDGE, rt = tAt(x + 1, y) !== TT.BRIDGE; g.beginFill(0x2b2b2b); if (vertical) { if (lf) g.drawRect(X, Y, 3, CELL); if (rt) g.drawRect(X + CELL - 3, Y, 3, CELL); } else { if (up) g.drawRect(X, Y, CELL, 3); if (dn) g.drawRect(X, Y + CELL - 3, CELL, 3); } g.endFill(); }
    if (t === TT.CLIFF) { const nb = (dx, dy) => tAt(x + dx, y + dy) === TT.CLIFF; g.beginFill(P.cliffDark, 0.9); g.drawPolygon([X + 3, Y + 24, X + 10, Y + 8, X + 18, Y + 20, X + 26, Y + 6, X + 30, Y + 24]); g.endFill(); g.beginFill(P.cliff[1]); g.drawPolygon([X + 6, Y + 22, X + 11, Y + 12, X + 17, Y + 19, X + 24, Y + 10, X + 27, Y + 22]); g.endFill(); g.beginFill(P.cliffLight); if (!nb(0, -1)) g.drawRect(X, Y, CELL, 4); if (!nb(-1, 0)) g.drawRect(X, Y, 4, CELL); g.endFill(); g.beginFill(P.cliffDark); if (!nb(0, 1)) g.drawRect(X, Y + CELL - 8, CELL, 8); if (!nb(1, 0)) g.drawRect(X + CELL - 5, Y, 5, CELL); g.endFill(); if (!nb(0, 1)) { g.beginFill(0x000000, 0.25); g.drawRect(X, Y + CELL, CELL, 5); g.endFill(); } }
    if (t === TT.ROAD) { const hz = tAt(x - 1, y) === TT.ROAD || tAt(x + 1, y) === TT.ROAD, vt = tAt(x, y - 1) === TT.ROAD || tAt(x, y + 1) === TT.ROAD; g.beginFill(P.roadEdge, 0.6); if (hz && tAt(x, y - 1) !== TT.ROAD) g.drawRect(X, Y, CELL, 2); if (hz && tAt(x, y + 1) !== TT.ROAD) g.drawRect(X, Y + CELL - 2, CELL, 2); if (vt && tAt(x - 1, y) !== TT.ROAD) g.drawRect(X, Y, 2, CELL); if (vt && tAt(x + 1, y) !== TT.ROAD) g.drawRect(X + CELL - 2, Y, 2, CELL); g.endFill(); if (h3 < 0.5) { g.beginFill(P.roadMark, 0.5); if (hz && !vt) g.drawRect(X + 4, Y + CELL - 1, 12, 1.5); else if (vt && !hz) g.drawRect(X + CELL - 1, Y + 4, 1.5, 12); g.endFill(); } g.beginFill(0x000000, 0.12); if (h < 0.3) g.drawRect(X + 6 + h2 * 14, Y + 6 + h * 14, 4, 3); g.endFill(); } }
  g.lineStyle(1, 0x000000, G.theme === 'desert' ? 0.03 : 0.05); for (let x = 0; x <= MAPW; x++) { g.moveTo(x * CELL, 0); g.lineTo(x * CELL, MAPH * CELL); } for (let y = 0; y <= MAPH; y++) { g.moveTo(0, y * CELL); g.lineTo(MAPW * CELL, y * CELL); }
  const rt = PIXI.RenderTexture.create({ width: MAPW * CELL, height: MAPH * CELL, resolution: 1 }); S.app.renderer.render(g, { renderTexture: rt }); g.destroy();
  S.layers.terrain.addChild(new PIXI.Sprite(rt));
  // animated water highlights: a sparse sheet of glints that slides slowly over water cells
  const wg = new PIXI.Graphics(); wg.beginFill(P.waterLight, 0.35); for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) if (G.terrain[idx(x, y)] === TT.WATER) { const h = hash2(x + 5, y + 9); wg.drawRect(x * CELL + 2 + h * 18, y * CELL + 4 + hash2(x, y + 3) * 22, 6 + h * 6, 1.5); } wg.endFill(); const wt = PIXI.RenderTexture.create({ width: MAPW * CELL, height: MAPH * CELL, resolution: 1 }); S.app.renderer.render(wg, { renderTexture: wt }); wg.destroy(); S.water = new PIXI.Sprite(wt); S.water.alpha = 0.9; S.layers.terrain.addChild(S.water);
  // fog texture
  S.fogBuf = new Uint8Array(MAPW * MAPH * 4); const ft = PIXI.Texture.fromBuffer(S.fogBuf, MAPW, MAPH, { scaleMode: PIXI.SCALE_MODES.LINEAR }); S.fog = new PIXI.Sprite(ft); S.fog.width = MAPW * CELL; S.fog.height = MAPH * CELL; S.layers.fog.addChild(S.fog);
  drawOre(true);
}
function blend(a, b, t) { const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255, br = b >> 16, bg = (b >> 8) & 255, bb = b & 255; return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t); }
function drawOre(force) { S.oreT += 1 / 60; if (!force && S.oreT < 0.5) return; S.oreT = 0; const g = S.oreG; g.clear(); for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) { const a = G.ore[idx(x, y)]; if (a <= 0) continue; const k = G.oreKind[idx(x, y)]; const n = Math.min(6, Math.ceil(a / 10)); for (let i = 0; i < n; i++) { const px = x * CELL + 5 + ((i * 37 + x * 11) % 22), py = y * CELL + 5 + ((i * 23 + y * 7) % 22); g.beginFill(k === 2 ? 0x5aa7ff : 0xe0a33a); g.drawPolygon([px, py - 4, px + 4, py, px, py + 4, px - 4, py]); g.endFill(); g.beginFill(0xffffff, 0.35); g.drawCircle(px - 1, py - 1, 1.2); g.endFill(); } } }
function updateFog() { const v = S.me.vis; const b = S.fogBuf; for (let i = 0; i < v.length; i++) { const a = v[i] === 2 ? 0 : v[i] === 1 ? 150 : 255; b[i * 4] = 4; b[i * 4 + 1] = 8; b[i * 4 + 2] = 12; b[i * 4 + 3] = a; } S.fog.texture.baseTexture.update(); }

// ───────── sprite factories ─────────
function unitTexture(d, faction) {
  const c = FC[faction], key = d.id + ':' + faction;
  return tex(key, g => {
    if (d.cls === 'infantry') { g.beginFill(0x000000, 0.25); g.drawEllipse(0, 5, 7, 3); g.endFill(); g.beginFill(c.dark); g.drawRoundedRect(-5, -4, 10, 11, 3); g.endFill(); g.beginFill(c.glow); g.drawRect(-5, -4, 10, 3); g.endFill(); g.beginFill(0xe8c9a0); g.drawCircle(0, -7, 3.2); g.endFill(); g.beginFill(c.panel); g.drawRoundedRect(-4, -10, 8, 4, 2); g.endFill(); g.lineStyle(2, 0x222222); g.moveTo(2, -2); g.lineTo(11, -4); g.lineStyle(0); return; }
    if (d.cls === 'drone') { g.beginFill(0x000000, 0.25); g.drawEllipse(0, 5, 8, 3); g.endFill(); g.beginFill(c.body); g.drawPolygon(hex(0, 0, 8)); g.endFill(); g.beginFill(c.dark); g.drawPolygon(hex(0, 0, 5)); g.endFill(); g.beginFill(c.glow); g.drawCircle(0, 0, 2.2); g.endFill(); if (d.hover) { g.lineStyle(1.5, c.glow, 0.8); g.drawCircle(0, 0, 10); g.lineStyle(0); } for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.lineStyle(1.5, c.dark); g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); } g.lineStyle(0); return; }
    if (d.cls === 'naval') { const big = d.armour === 'heavy' ? 1.3 : 1; if (d.submerged) { g.beginFill(0x2a3540); g.drawEllipse(0, 0, 18 * big, 6 * big); g.endFill(); g.beginFill(c.dark); g.drawRect(-2, -8, 4, 8); g.endFill(); g.beginFill(c.glow); g.drawCircle(12 * big, 0, 2); g.endFill(); return; } g.beginFill(0x0c0e10, 0.3); g.drawEllipse(2, 3, 20 * big, 8 * big); g.endFill(); g.beginFill(c.body); g.drawPolygon([22 * big, 0, 14 * big, -7 * big, -18 * big, -7 * big, -20 * big, 0, -18 * big, 7 * big, 14 * big, 7 * big]); g.endFill(); g.beginFill(c.panel); g.drawRoundedRect(-10 * big, -4 * big, 14 * big, 8 * big, 2); g.endFill(); g.beginFill(c.dark); g.drawRect(-6 * big, -2 * big, 6 * big, 4 * big); g.endFill(); g.beginFill(c.glow); g.drawRect(2 * big, -1, 6 * big, 2); g.endFill(); return; }
    if (d.cls === 'aircraft') { const big = d.armour === 'medium' ? 1.5 : 1; g.beginFill(c.body); g.drawPolygon([16 * big, 0, 2 * big, -4 * big, -8 * big, -14 * big, -12 * big, -12 * big, -6 * big, -3 * big, -14 * big, -2 * big, -14 * big, 2 * big, -6 * big, 3 * big, -12 * big, 12 * big, -8 * big, 14 * big, 2 * big, 4 * big]); g.endFill(); g.beginFill(c.glow); g.drawEllipse(4 * big, 0, 5 * big, 2.2 * big); g.endFill(); g.beginFill(c.panel); g.drawRect(-14 * big, -1.5 * big, 6 * big, 3 * big); g.endFill(); if (d.hover) { g.lineStyle(1.5, c.dark, 0.9); g.drawCircle(0, 0, 15 * big); g.lineStyle(0); } return; }
    // vehicle hull
    const big = d.armour === 'heavy' ? 1.3 : d.armour === 'light' ? 0.85 : 1, L = 24 * big, W = 16 * big;
    if (!d.hover) { g.beginFill(0x1b1b1b); g.drawRoundedRect(-L / 2 - 1, -W / 2 - 3, L + 2, 5, 2); g.drawRoundedRect(-L / 2 - 1, W / 2 - 2, L + 2, 5, 2); g.endFill(); g.beginFill(0x3a3a3a); for (let i = -L / 2; i < L / 2; i += 4) { g.drawRect(i, -W / 2 - 2, 2, 3); g.drawRect(i, W / 2 - 1, 2, 3); } g.endFill(); }
    else { g.beginFill(c.glow, 0.25); g.drawEllipse(0, 0, L / 2 + 5, W / 2 + 5); g.endFill(); }
    g.beginFill(c.body); g.drawRoundedRect(-L / 2, -W / 2, L, W, 3); g.endFill(); g.beginFill(c.panel); g.drawRoundedRect(-L / 2 + 2, -W / 2 + 2, L * 0.4, W - 4, 2); g.endFill(); g.beginFill(c.glow); g.drawRect(L / 2 - 4, -W / 2 + 2, 2, W - 4); g.endFill();
    if (hasTag(d, 'harvester')) { g.beginFill(0x2a2a2a); g.drawRoundedRect(-L / 2 + 2, -W / 2 + 2, L * 0.55, W - 4, 2); g.endFill(); }
    if (d.id === 'cmp_hailstorm') { g.beginFill(c.dark); g.drawRect(-6, -7, 14, 14); g.endFill(); g.beginFill(0x111111); for (let i = 0; i < 6; i++) g.drawCircle(-3 + (i % 3) * 4.5, -3 + Math.floor(i / 3) * 6, 1.6); g.endFill(); }
  });
}
function turretTexture(d, faction) { const c = FC[faction]; return tex('turret:' + d.id + ':' + faction, g => { const big = d.armour === 'heavy' ? 1.3 : d.armour === 'light' ? 0.85 : 1; const w = d.weapons && d.weapons[0]; const beam = w && (w.wh === 'BEAM' || w.wh === 'EMP' || w.wh === 'HACK'); g.beginFill(c.dark); g.drawCircle(0, 0, 6 * big); g.endFill(); g.beginFill(c.panel); g.drawCircle(-1, 0, 4 * big); g.endFill(); if (beam) { g.beginFill(c.glow); g.drawRect(2, -2 * big, 14 * big, 4 * big); g.endFill(); g.beginFill(0xffffff, 0.6); g.drawCircle(16 * big, 0, 2.2 * big); g.endFill(); } else { g.beginFill(0x2b2b2b); g.drawRect(2, -1.6 * big, 15 * big, 3.2 * big); g.endFill(); if (w && w.burst > 1) { g.drawRect(2, -4 * big, 12 * big, 2 * big); g.drawRect(2, 2 * big, 12 * big, 2 * big); } g.beginFill(0x111111); g.drawRect(14 * big, -2.4 * big, 3.5 * big, 4.8 * big); g.endFill(); } }); }
function hex(cx, cy, r) { const p = []; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return p; }
function structTexture(d, faction) {
  const c = FC[faction];
  return tex('s:' + d.id + ':' + faction, g => {
    const [fw, fh] = FOOT(d), W = fw * CELL - 4, H = fh * CELL - 4; const role = d.role;
    const base = () => { g.beginFill(0x0c0e10, 0.35); g.drawRoundedRect(3, 5, W, H, 4); g.endFill(); g.beginFill(c.body); g.drawRoundedRect(0, 0, W, H, 4); g.endFill(); g.lineStyle(2, c.dark, 0.9); g.drawRoundedRect(0, 0, W, H, 4); g.lineStyle(0); };
    if (d.faction === 'civ') { g.beginFill(0x0c0e10, 0.35); g.drawRoundedRect(3, 5, W, H, 3); g.endFill(); if (d.tech) { g.beginFill(0x4a4a46); g.drawRoundedRect(0, 0, W, H, 3); g.endFill(); g.beginFill(0x2b2b2b); g.drawRect(W * 0.15, H * 0.35, 6, H * 0.6); g.drawRect(W * 0.55, H * 0.35, 6, H * 0.6); g.endFill(); g.lineStyle(4, 0x8a8a80); g.moveTo(W * 0.15, H * 0.35); g.lineTo(W * 0.7, H * 0.2); g.lineStyle(0); g.beginFill(0xd9a441); g.drawCircle(W * 0.72, H * 0.2, 5); g.endFill(); g.beginFill(0x1a1a1a); g.drawCircle(W * 0.3, H * 0.75, 7); g.endFill(); return; }
      g.beginFill(c.body); g.drawRoundedRect(0, 0, W, H, 2); g.endFill(); const roof = d.id === 'civ_tower' ? 0x6a7078 : d.id === 'civ_warehouse' ? 0x7a7a72 : c.glow; g.beginFill(roof); g.drawRect(2, 2, W - 4, H * 0.45); g.endFill(); g.beginFill(0x1a1a1a, 0.6); for (let i = 0; i < Math.floor(W / 12); i++) { g.drawRect(5 + i * 12, H * 0.55, 6, 7); } g.endFill(); if (d.id === 'civ_tower') { g.beginFill(0x9fb3c8, 0.7); for (let yy = 6; yy < H - 8; yy += 10) for (let i = 0; i < Math.floor(W / 10); i++) g.drawRect(4 + i * 10, yy, 5, 6); g.endFill(); } g.lineStyle(2, c.dark); g.drawRoundedRect(0, 0, W, H, 2); g.lineStyle(0); return; }
    if (d.cls === 'defence') { g.beginFill(0x0c0e10, 0.35); g.drawCircle(15, 17, 13); g.endFill(); g.beginFill(c.body); g.drawRoundedRect(2, 2, 24, 24, 5); g.endFill(); g.beginFill(c.dark); g.drawCircle(14, 14, 9); g.endFill(); g.beginFill(c.panel); g.drawCircle(14, 14, 6); g.endFill(); if (/Anti-air|air/.test(role)) { g.beginFill(c.glow); g.drawRect(8, 8, 12, 12); g.endFill(); } return; }
    base();
    if (/Construction/.test(role)) { g.beginFill(c.panel); g.drawRoundedRect(6, 6, W - 12, H * 0.45, 3); g.endFill(); g.beginFill(c.dark); g.drawRect(W * 0.55, H * 0.1, 6, H * 0.8); g.drawRect(W * 0.55, H * 0.1, W * 0.4, 5); g.endFill(); g.beginFill(c.glow); g.drawRect(8, H - 14, W * 0.4, 6); g.endFill(); g.lineStyle(1, c.glow, 0.6); for (let i = 1; i < 4; i++) { g.moveTo(10, 10 + i * 8); g.lineTo(W * 0.5, 10 + i * 8); } g.lineStyle(0); }
    else if (/Power/.test(role)) { if (faction === 'lattice') { for (let i = 0; i < 3; i++) { g.lineStyle(3, c.glow, 0.8); g.drawCircle(W / 2, H / 2, 8 + i * 7); } g.lineStyle(0); g.beginFill(c.glow); g.drawCircle(W / 2, H / 2, 4); g.endFill(); } else { g.beginFill(c.dark); g.drawCircle(W * 0.3, H * 0.45, 10); g.drawCircle(W * 0.7, H * 0.45, 10); g.endFill(); g.beginFill(c.panel); g.drawCircle(W * 0.3, H * 0.45, 6); g.drawCircle(W * 0.7, H * 0.45, 6); g.endFill(); g.beginFill(c.glow); g.drawRect(8, H - 12, W - 16, 4); g.endFill(); } }
    else if (/Refinery/.test(role)) { g.beginFill(c.dark); g.drawCircle(W * 0.25, H * 0.42, 14); g.endFill(); g.beginFill(c.panel); g.drawCircle(W * 0.25, H * 0.42, 9); g.endFill(); g.beginFill(0xe0a33a); g.drawRoundedRect(W * 0.5, 8, W * 0.42, H * 0.5, 3); g.endFill(); g.beginFill(c.dark); g.drawRect(W * 0.35, H - 16, W * 0.6, 8); g.endFill(); g.beginFill(c.glow); g.drawRect(W * 0.5, H - 15, 6, 6); g.endFill(); }
    else if (/Infantry/.test(role)) { g.beginFill(c.panel); g.drawRoundedRect(4, 4, W - 8, H * 0.55, 3); g.endFill(); g.beginFill(c.dark); g.drawRect(W * 0.4, H * 0.6, W * 0.2, H * 0.35); g.endFill(); g.beginFill(c.glow); g.drawPolygon([W - 8, 4, W - 8, 20, W + 2, 12]); g.endFill(); g.beginFill(0x222222); g.drawRect(W - 10, 4, 2, 24); g.endFill(); }
    else if (/Vehicle production/.test(role)) { g.beginFill(c.panel); g.drawRoundedRect(4, 4, W - 8, H - 8, 3); g.endFill(); g.beginFill(c.dark); g.drawRect(W * 0.25, H * 0.45, W * 0.5, H * 0.52); g.endFill(); g.lineStyle(1.5, c.body, 0.8); for (let i = 1; i < 5; i++) { g.moveTo(W * 0.25, H * 0.45 + i * 6); g.lineTo(W * 0.75, H * 0.45 + i * 6); } g.lineStyle(0); g.beginFill(c.glow); g.drawRect(8, 8, W * 0.4, 4); g.endFill(); }
    else if (/Air production/.test(role)) { g.beginFill(0x2a2d31); g.drawRoundedRect(4, 4, W - 8, H - 8, 3); g.endFill(); g.lineStyle(2, c.glow, 0.9); g.drawCircle(W * 0.3, H * 0.5, 9); g.drawCircle(W * 0.7, H * 0.5, 9); g.lineStyle(0); g.beginFill(c.glow); g.drawRect(W * 0.27, H * 0.5 - 1, 6, 2); g.drawRect(W * 0.67, H * 0.5 - 1, 6, 2); g.endFill(); }
    else if (/Radar|detector|mesh hub/.test(role)) { g.beginFill(c.dark); g.drawCircle(W / 2, H * 0.55, 12); g.endFill(); g.beginFill(c.panel); g.drawEllipse(W / 2, H * 0.5, 13, 7); g.endFill(); g.beginFill(c.glow); g.drawCircle(W / 2, H * 0.5, 3); g.endFill(); g.lineStyle(2, c.dark); g.moveTo(W / 2, H * 0.5); g.lineTo(W / 2 + 8, H * 0.3); g.lineStyle(0); }
    else if (/Tech/.test(role)) { g.beginFill(c.panel); g.drawCircle(W / 2, H / 2, 16); g.endFill(); g.beginFill(c.glow, 0.5); g.drawCircle(W / 2, H / 2, 10); g.endFill(); g.beginFill(0xffffff, 0.5); g.drawCircle(W / 2 - 4, H / 2 - 4, 3); g.endFill(); }
    else if (/Mesh node/.test(role)) { g.beginFill(c.dark); g.drawRect(W / 2 - 2, 4, 4, H - 8); g.endFill(); g.beginFill(c.glow); g.drawCircle(W / 2, 6, 4); g.endFill(); }
    else { g.beginFill(c.panel); g.drawRoundedRect(6, 6, W - 12, H - 12, 3); g.endFill(); g.beginFill(c.glow); g.drawRect(10, 10, 10, 4); g.endFill(); }
  });
}

// ───────── entity views ─────────
function viewFor(e) {
  let v = S.views.get(e.id); if (v) return v;
  const d = e.def, f = e.owner.faction; v = { c: new PIXI.Container(), e, faction: f };
  const rec = AT.ready ? atlasRec(d, f) : null;
  if (rec) {
    v.atlas = rec; const us = isStruct(d) ? 1 : d.cls === 'infantry' ? 1.5 : d.cls === 'drone' ? 1.35 : 1.25; v.scaleU = us; const col = e.owner.color || 0x9a9a8a;
    v.body = atlasSprite(f, rec.body[0]); v.team = atlasSprite(f, rec.team[0]); v.team.tint = col; v.team.alpha = 0.95; v.body.scale.set(AT.scale * us); v.team.scale.set(AT.scale * us);
    if (rec.turret) { v.turret = atlasSprite(f, rec.turret[0]); v.tteam = atlasSprite(f, rec.tteam[0]); v.tteam.tint = col; v.tteam.alpha = 0.95; v.turret.scale.set(AT.scale * us); v.tteam.scale.set(AT.scale * us); }
    if (isStruct(d)) { v.c.addChild(v.body, v.team); if (v.turret) v.c.addChild(v.turret, v.tteam); S.layers.structs.addChild(v.c); v.c.zIndex = e.y; }
    else { if (isAir(d)) { v.shadow = new PIXI.Sprite(tex('shadowA', g => { g.beginFill(0x000000, 0.3); g.drawEllipse(0, 0, 14, 7); g.endFill(); })); v.shadow.anchor.set(0.5); v.c.addChild(v.shadow); } v.c.addChild(v.body, v.team); if (v.turret) v.c.addChild(v.turret, v.tteam); (isAir(d) ? S.layers.air : S.layers.ground).addChild(v.c); }
  }
  else if (isStruct(d)) { v.body = new PIXI.Sprite(structTexture(d, f)); v.body.anchor.set(0, 0); v.body.position.set(e.cx * CELL + 2, e.cy * CELL + 2); if (d.cls === 'defence' && d.weapons) { v.turret = new PIXI.Sprite(turretTexture({ id: d.id, armour: 'medium', weapons: d.weapons }, f)); v.turret.anchor.set(0.25, 0.5); v.turret.position.set(e.x, e.y); } v.c.addChild(v.body); if (v.turret) v.c.addChild(v.turret); S.layers.structs.addChild(v.c); v.c.zIndex = e.y; }
  else { const us = isInf(d) ? 1.5 : 1.3; v.scaleU = us; v.shadow = new PIXI.Sprite(tex('shadow' + (isAir(d) ? 'A' : 'G'), g => { g.beginFill(0x000000, isAir(d) ? 0.3 : 0.22); g.drawEllipse(0, 0, isAir(d) ? 14 : 12, isAir(d) ? 7 : 6); g.endFill(); })); v.shadow.anchor.set(0.5); v.body = new PIXI.Sprite(unitTexture(d, f)); v.body.anchor.set(0.5); v.body.scale.set(us); v.shadow.scale.set(us); if (d.cls === 'vehicle' && d.weapons && !hasTag(d, 'harvester') && !d.weapons.some(w => w.minRange)) { v.turret = new PIXI.Sprite(turretTexture(d, f)); v.turret.anchor.set(0.25, 0.5); v.turret.scale.set(us); } v.c.addChild(v.shadow, v.body); if (v.turret) v.c.addChild(v.turret); (isAir(d) ? S.layers.air : S.layers.ground).addChild(v.c); }
  v.hp = new PIXI.Graphics(); v.c.addChild(v.hp); v.rank = new PIXI.Graphics(); v.c.addChild(v.rank);
  v.flash = new PIXI.Sprite(tex('flash', g => { g.beginFill(0xfff1b8); g.drawPolygon([0, -3, 8, -1, 12, 0, 8, 1, 0, 3, 3, 0]); g.endFill(); })); v.flash.anchor.set(0, 0.5); v.flash.visible = false; v.c.addChild(v.flash);
  S.views.set(e.id, v); return v;
}
function dropView(e) { const v = S.views.get(e.id); if (!v) return; v.c.destroy({ children: true }); S.views.delete(e.id); }
function syncViews(dt) {
  S.time += dt; const me = S.me;
  for (const e of G.ents) {
    if (e.dead) { dropView(e); continue; }
    const vis = e.owner === me || visibleTo(me, e); const cloakHidden = e.cloaked && e.owner !== me && !canSee(me, e);
    const v = viewFor(e); v.c.visible = vis && !cloakHidden; if (!v.c.visible) continue;
    const d = e.def;
    if (e.owner.faction !== v.faction) { dropView(e); continue; }
    v.c.alpha = e.cloaked ? (e.def.submerged ? 0.55 : 0.45) : (e.building ? 0.6 + 0.4 * (1 - e.building) : 1);
    if (isStruct(d) && d.garrison) { if (!v.badge) { v.badge = new PIXI.Text('', { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }); v.badge.anchor.set(0.5, 1); v.badge.position.set(e.x, e.cy * CELL - 2); v.c.addChild(v.badge); } const n = e.occupants ? e.occupants.length : 0; v.badge.text = n ? `${n}/${d.garrison}` : ''; v.badge.style.fill = e.owner === me ? 0x9be37a : 0xff8a8a; }
    if (v.atlas) {
      const rec = v.atlas, f = v.faction, air = isAir(d); const na = rec.nAnim || 1; const nf = rec.body.length / na; const k = nf > 1 ? facingIndex(e.facing, nf) : 0;
      let j = 0; if (na > 1) { if (air || d.hover) j = Math.floor(S.time * 24 + e.id) % na; else if (e.moved && !e.deployed) j = Math.floor(S.time * 9 + e.id) % na; }
      const fi = k * na + j; if (fi !== v.k) { v.k = fi; setFrame(v.body, f, rec.body[fi]); setFrame(v.team, f, rec.team[fi]); if (v.glow) v.glow.texture = v.body.texture, v.glow.anchor.copyFrom(v.body.anchor); }
      // hit flash (additive copy of the body) and turret recoil
      if (v.hitT > 0) { v.hitT -= dt; if (!v.glow) { v.glow = new PIXI.Sprite(v.body.texture); v.glow.anchor.copyFrom(v.body.anchor); v.glow.scale.copyFrom(v.body.scale); v.glow.blendMode = PIXI.BLEND_MODES.ADD; v.c.addChild(v.glow); } v.glow.visible = true; v.glow.alpha = Math.min(1, v.hitT * 9) * 0.85; } else if (v.glow) v.glow.visible = false;
      if (v.recoil > 0) v.recoil = Math.max(0, v.recoil - dt * 7);
      // damage states: smoke under half health, fire under a quarter
      if (!e.building && e.hp < d.hp * 0.5 && !S.reduced) { v.smokeT = (v.smokeT || 0) - dt; if (v.smokeT <= 0) { v.smokeT = e.hp < d.hp * 0.25 ? 0.18 : 0.45; const sx = e.x + (Math.random() - 0.5) * (isStruct(d) ? fw(e) * CELL * 0.6 : 14), sy = e.y + (Math.random() - 0.5) * (isStruct(d) ? fh(e) * CELL * 0.5 : 10) - (air ? 22 : 4); puff(sx, sy, e.hp < d.hp * 0.25 && Math.random() < 0.45 ? 0xff7a2a : 0x2a2a2a, isStruct(d) ? 6 : 3.5, isStruct(d) ? 1.6 : 1.0); } }
      if (isStruct(d)) { const sy = e.building ? 1 - e.building * 0.6 : 1; v.body.position.set(e.x, e.y); v.team.position.set(e.x, e.y); v.body.scale.set(AT.scale, AT.scale * sy); v.team.scale.set(AT.scale, AT.scale * sy); if (v.turret) { const want = e.aim != null ? e.aim : (v.tang == null ? 0 : v.tang); v.tang = SIM.lerpAngle(v.tang == null ? want : v.tang, want, 0.2); const tk = facingIndex(v.tang, rec.turret.length); if (tk !== v.tk) { v.tk = tk; setFrame(v.turret, f, rec.turret[tk]); setFrame(v.tteam, f, rec.tteam[tk]); } const rc = (v.recoil || 0) * 4; v.turret.position.set(e.x - Math.cos(v.tang) * rc, e.y - Math.sin(v.tang) * rc); v.tteam.position.copyFrom(v.turret.position); v.turret.rotation = 0; } if (v.glow) v.glow.position.copyFrom(v.body.position); v.c.zIndex = e.y + fh(e) * CELL / 2; if (e.owner !== me && !visibleTo(me, e)) v.c.alpha = 0.5; }
      else {
        v.c.position.set(e.x, e.y); v.c.zIndex = e.y; const by = air ? -22 : (d.hover ? Math.sin(S.time * 6 + e.id) * 1.5 - 3 : 0);
        v.body.position.set(0, by); v.team.position.set(0, by); v.body.rotation = 0; if (v.shadow) v.shadow.position.set(10, 10);
        if (isInf(d)) { if (e.deployed && !v.sandbag) { v.sandbag = new PIXI.Sprite(tex('sandbag', g => { g.lineStyle(3, 0xc9a36a, 0.95); g.drawCircle(0, 0, 10); })); v.sandbag.anchor.set(0.5); v.c.addChildAt(v.sandbag, 0); } if (!e.deployed && v.sandbag) { v.sandbag.destroy(); v.sandbag = null; } }
        if (e.moved && !isInf(d) && !d.hover && !air && !S.reduced && Math.random() < 0.3) puff(e.x - Math.cos(e.facing) * 12, e.y - Math.sin(e.facing) * 12, 0x6f6a5a, 3, 0.6);
        if (v.turret) { const want = e.aim != null ? e.aim : e.facing; const ta = e.turret == null ? want : e.turret; const tk = facingIndex(ta, rec.turret.length); if (tk !== v.tk) { v.tk = tk; setFrame(v.turret, f, rec.turret[tk]); setFrame(v.tteam, f, rec.tteam[tk]); } const rc = (v.recoil || 0) * 4; v.turret.position.set(-Math.cos(ta) * rc, by - Math.sin(ta) * rc); v.tteam.position.copyFrom(v.turret.position); v.turret.rotation = 0; v.tang = ta; } if (v.glow) v.glow.position.set(0, by);
        if (e.disabled > 0) { if (!v.emp) { v.emp = new PIXI.Graphics(); v.c.addChild(v.emp); } v.emp.clear(); v.emp.lineStyle(2, 0x9ad7ff, 0.5 + 0.4 * Math.sin(S.time * 20)); v.emp.drawCircle(0, 0, 14); } else if (v.emp) { v.emp.destroy(); v.emp = null; }
      }
    }
    else if (isStruct(d)) { if (e.building) { v.body.scale.set(1, 1 - e.building * 0.6); v.body.position.y = e.cy * CELL + 2 + (fh(e) * CELL - 4) * e.building * 0.6; } else { v.body.scale.set(1); v.body.position.y = e.cy * CELL + 2; } if (v.turret) { const want = e.aim != null ? e.aim : v.turret.rotation; v.turret.rotation = SIM.lerpAngle(v.turret.rotation, want, 0.2); } v.c.zIndex = e.y + fh(e) * CELL / 2; if (e.owner !== me && !visibleTo(me, e)) v.c.alpha = 0.5; }
    else {
      v.c.position.set(e.x, e.y); v.c.zIndex = e.y; const air = isAir(d);
      if (air) { v.body.position.set(0, -22); v.shadow.position.set(10, 10); v.body.rotation = e.facing; }
      else { v.body.rotation = isInf(d) ? 0 : e.facing; v.body.position.set(0, 0); v.shadow.position.set(0, 4); if (isInf(d)) { v.body.scale.x = (Math.cos(e.facing) < 0 ? -1 : 1) * v.scaleU; if (e.deployed && !v.sandbag) { v.sandbag = new PIXI.Sprite(tex('sandbag', g => { g.lineStyle(3, 0xc9a36a, 0.95); g.drawCircle(0, 0, 10); })); v.sandbag.anchor.set(0.5); v.c.addChildAt(v.sandbag, 1); } if (!e.deployed && v.sandbag) { v.sandbag.destroy(); v.sandbag = null; } } if (e.moved && !isInf(d) && !d.hover && !S.reduced && Math.random() < 0.3) puff(e.x - Math.cos(e.facing) * 12, e.y - Math.sin(e.facing) * 12, 0x6f6a5a, 3, 0.6); if (d.hover) v.body.position.y = Math.sin(S.time * 6 + e.id) * 1.5 - 3; }
      if (v.turret) { const want = e.aim != null ? e.aim : e.facing; v.turret.rotation = e.turret == null ? want : e.turret; v.turret.position.set(0, air ? -22 : 0); }
      if (e.disabled > 0) { if (!v.emp) { v.emp = new PIXI.Graphics(); v.c.addChild(v.emp); } v.emp.clear(); v.emp.lineStyle(2, 0x9ad7ff, 0.5 + 0.4 * Math.sin(S.time * 20)); v.emp.drawCircle(0, 0, 14); } else if (v.emp) { v.emp.destroy(); v.emp = null; }
    }
    // hp bar
    const sel = S.sel.includes(e); const show = sel || e.hp < d.hp || (e.shield !== undefined && d.shield && e.shield < d.shield.hp);
    v.hp.clear(); if (show && !e.building) { const w = isStruct(d) ? fw(e) * CELL - 8 : 28, x0 = isStruct(d) ? e.cx * CELL + 4 : -14, y0 = isStruct(d) ? e.cy * CELL - 6 : (isAir(d) ? -44 : -22); v.hp.beginFill(0x000000, 0.7); v.hp.drawRect(x0, y0, w, 4); v.hp.endFill(); v.hp.beginFill(hpColor(e.hp / d.hp)); v.hp.drawRect(x0, y0, w * Math.max(0, e.hp / d.hp), 4); v.hp.endFill(); if (d.shield) { v.hp.beginFill(0x5aa7ff); v.hp.drawRect(x0, y0 - 4, w * e.shield / d.shield.hp, 2); v.hp.endFill(); } }
    if (e.buff && e.buff.until > S.time + G.t - S.time) { if (!v.buffG) { v.buffG = new PIXI.Graphics(); v.c.addChild(v.buffG); } v.buffG.clear(); v.buffG.lineStyle(2, e.buff.invuln ? 0xd9a441 : 0xc9bcff, 0.6 + 0.3 * Math.sin(S.time * 8)); v.buffG.drawCircle(0, isAir(d) ? -22 : 0, isStruct(d) ? Math.max(e.fw, e.fh) * CELL * 0.6 : 16); if (isStruct(d)) { v.buffG.position.set(e.x, e.y); } } else if (v.buffG) { v.buffG.destroy(); v.buffG = null; }
    v.rank.clear(); if (e.rank) { v.rank.beginFill(0xffd86b); for (let i = 0; i < e.rank; i++) { const bx = (isStruct(d) ? e.cx * CELL : 8 + i * 6), by = isStruct(d) ? e.cy * CELL : 10; v.rank.drawPolygon([bx, by, bx + 3, by - 4, bx + 6, by, bx + 3, by - 2]); } v.rank.endFill(); }
    if (v.flashT > 0) { v.flashT -= dt; v.flash.visible = true; v.flash.rotation = v.turret ? (v.atlas ? (v.tang == null ? e.facing : v.tang) : v.turret.rotation) : e.facing; const r = (v.turret ? 16 : 10) * (v.scaleU || 1); v.flash.position.set(Math.cos(v.flash.rotation) * r, (isAir(d) ? -22 : 0) + Math.sin(v.flash.rotation) * r); } else v.flash.visible = false;
    if (v.speech) { v.speechT -= dt; if (v.speechT <= 0) { v.speech.destroy(); v.speech = null; } }
  }
  // mines (yours only)
  if (!S.mineG) { S.mineG = new PIXI.Graphics(); S.layers.decor.addChild(S.mineG); } S.mineG.clear(); for (const m of (G.mines || [])) { if (m.owner !== me) continue; S.mineG.beginFill(0x2a2a2a); S.mineG.drawCircle(m.x, m.y, 5); S.mineG.endFill(); S.mineG.beginFill(0xd9a441); S.mineG.drawCircle(m.x, m.y, 1.8); S.mineG.endFill(); }
  // hazard fields (radiation / nanodust)
  if (!S.fieldG) { S.fieldG = new PIXI.Graphics(); S.layers.decor.addChild(S.fieldG); } S.fieldG.clear(); for (const f of (G.fields || [])) { const col = f.kind === 'nano' ? 0xe0479e : 0x9be37a; const a = Math.min(1, f.until / 3) * 0.28; S.fieldG.beginFill(col, a); S.fieldG.drawCircle(f.x, f.y, f.r); S.fieldG.endFill(); for (let k = 0; k < 6; k++) { const ang = S.time * 1.5 + k * 1.047, rr = f.r * (0.3 + 0.5 * ((S.time * 0.7 + k * 0.37) % 1)); S.fieldG.beginFill(col, a * 1.6); S.fieldG.drawCircle(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr, 2.2); S.fieldG.endFill(); } }
  // crates
  if (!S.crateG) { S.crateG = new PIXI.Graphics(); S.layers.decor.addChild(S.crateG); } S.crateG.clear(); for (const c of (G.crates || [])) { const i = idx(Math.floor(c.x / CELL), Math.floor(c.y / CELL)); if (!me.vis[i]) continue; S.crateG.beginFill(0x8a6a3a); S.crateG.drawRect(c.x - 7, c.y - 7, 14, 14); S.crateG.endFill(); S.crateG.lineStyle(2, 0xe8b84a); S.crateG.drawRect(c.x - 7, c.y - 7, 14, 14); S.crateG.moveTo(c.x - 7, c.y); S.crateG.lineTo(c.x + 7, c.y); S.crateG.moveTo(c.x, c.y - 7); S.crateG.lineTo(c.x, c.y + 7); S.crateG.lineStyle(0); S.crateG.beginFill(0xfff1b8, 0.5 + 0.4 * Math.sin(S.time * 4)); S.crateG.drawCircle(c.x, c.y, 2); S.crateG.endFill(); }
  // selection rings
  S.selG.clear(); for (const e of S.sel) { if (e.dead) continue; S.selG.lineStyle(1.5, 0xffffff, 0.9); if (isStruct(e.def)) S.selG.drawRoundedRect(e.cx * CELL + 1, e.cy * CELL + 1, fw(e) * CELL - 2, fh(e) * CELL - 2, 4); else S.selG.drawEllipse(e.x, e.y + (isAir(e.def) ? -22 : 8), 17, 8); }
  S.selG.lineStyle(0);
}
const fw = e => e.fw, fh = e => e.fh;

// ───────── effects ─────────
function debris(x, y, n) { if (S.reduced) n = Math.min(n, 2); for (let i = 0; i < n; i++) { const g = new PIXI.Graphics(); const w = 2 + Math.random() * 4; g.beginFill(Math.random() < 0.5 ? 0x2b2b2b : 0x4a4038); g.drawRect(-w / 2, -w / 3, w, w * 0.66); g.endFill(); g.position.set(x, y); g.rotation = Math.random() * 6.28; S.layers.fx.addChild(g); const a = Math.random() * 6.28, sp = 60 + Math.random() * 140; S.fx.push({ g, t: 0, life: 0.5 + Math.random() * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 120, grav: 380, spin: (Math.random() - 0.5) * 12 }); } }
function decal(x, y, r, kind) { S.decals.push({ x, y, r, kind, t: 0, life: kind === 'crater' ? 240 : 120 }); if (S.decals.length > 160) S.decals.shift(); S.decalDirty = true; }
function drawDecals(dt) { if (!S.decalG) { S.decalG = new PIXI.Graphics(); S.layers.decor.addChild(S.decalG); } let dirty = S.decalDirty; for (const d of S.decals) { d.t += dt; if (d.t > d.life * 0.8) dirty = true; } S.decals = S.decals.filter(d => d.t < d.life); S.decalAcc = (S.decalAcc || 0) + dt; if (!dirty && S.decalAcc < 2) return; S.decalAcc = 0; S.decalDirty = false; const g = S.decalG; g.clear(); for (const d of S.decals) { const a = d.t > d.life * 0.8 ? (1 - d.t / d.life) / 0.2 : 1; if (d.kind === 'crater') { g.beginFill(0x1a1612, 0.55 * a); g.drawEllipse(d.x, d.y, d.r, d.r * 0.8); g.endFill(); g.lineStyle(3, 0x4a3f33, 0.6 * a); g.drawEllipse(d.x, d.y, d.r + 2, d.r * 0.8 + 2); g.lineStyle(0); g.beginFill(0x0d0b09, 0.5 * a); g.drawEllipse(d.x, d.y, d.r * 0.45, d.r * 0.36); g.endFill(); } else { g.beginFill(0x101010, 0.42 * a); g.drawEllipse(d.x, d.y, d.r, d.r * 0.85); g.endFill(); g.beginFill(0x000000, 0.3 * a); g.drawEllipse(d.x + 2, d.y + 1, d.r * 0.5, d.r * 0.45); g.endFill(); } } }
function puff(x, y, col, r, life) { if (S.reduced) return; const g = new PIXI.Graphics(); g.beginFill(col, 0.6); g.drawCircle(0, 0, r); g.endFill(); g.position.set(x, y); S.layers.fx.addChild(g); S.fx.push({ g, t: 0, life, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 10, grow: 1.5 }); }
function spark(x, y, col, n) { if (S.reduced) n = Math.min(n, 2); for (let i = 0; i < n; i++) { const g = new PIXI.Graphics(); g.beginFill(col); g.drawRect(-1.5, -1.5, 3, 3); g.endFill(); g.position.set(x, y); S.layers.fx.addChild(g); const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 120; S.fx.push({ g, t: 0, life: 0.3 + Math.random() * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 200 }); } }
function explosion(x, y, big) {
  const r = big ? 46 : 18; const ring = new PIXI.Graphics(); ring.lineStyle(big ? 3 : 2, 0xffd27a, 1); ring.drawCircle(0, 0, r); ring.position.set(x, y); ring.scale.set(0.2); S.layers.fx.addChild(ring); S.fx.push({ g: ring, t: 0, life: big ? 0.45 : 0.28, ring: true });
  const core = new PIXI.Graphics(); core.beginFill(0xffffff); core.drawCircle(0, 0, big ? 10 : 4); core.endFill(); core.position.set(x, y); S.layers.fx.addChild(core); S.fx.push({ g: core, t: 0, life: 0.15, grow: 4 });
  spark(x, y, 0xffb347, big ? 22 : 8); for (let i = 0; i < (big ? 8 : 3); i++) setTimeout(() => puff(x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, i % 2 ? 0x2a2a2a : 0x6b4a2a, big ? 10 : 5, 1.2 + Math.random()), i * 60);
  if (big) shake(x, y, 8); else shake(x, y, 2);
}
function shake(x, y, amt) { if (S.reduced) return; const cx = S.cam.x + S.app.screen.width / S.cam.zoom / 2, cy = S.cam.y + S.app.screen.height / S.cam.zoom / 2; const d = Math.hypot(x - cx, y - cy); S.shake = Math.max(S.shake, amt * Math.max(0, 1 - d / 900)); }
function wreck(e) { const d = e.def; if (isAir(d)) { explosion(e.x, e.y - 22, false); debris(e.x, e.y - 22, 3); return; } const v = S.views.get(e.id); const f = e.owner.faction; const g = new PIXI.Container(); if (isStruct(d)) { if (v && v.atlas) { const col = new PIXI.Container(); const sp = atlasSprite(f, v.atlas.body[0]); sp.position.set(e.x, e.y); const tm = atlasSprite(f, v.atlas.team[0]); tm.position.copyFrom(sp.position); tm.tint = e.owner.color || 0x9a9a8a; col.addChild(sp, tm); S.layers.structs.addChild(col); S.fx.push({ g: col, t: 0, life: 0.7, crumble: { x: e.x, y: e.y, w: fw(e) * CELL, h: fh(e) * CELL, s0: AT.scale } }); decal(e.x, e.y, Math.max(fw(e), fh(e)) * CELL * 0.55, 'scorch'); debris(e.x, e.y, 8); } const r = new PIXI.Graphics(); r.beginFill(0x1a1a1a, 0.8); r.drawRoundedRect(e.cx * CELL + 3, e.cy * CELL + 5, e.fw * CELL - 6, e.fh * CELL - 8, 5); r.endFill(); r.beginFill(0x3a3330); for (let i = 0; i < 6; i++) r.drawPolygon([e.cx * CELL + 6 + i * 11, e.cy * CELL + 10 + (i % 3) * 9, e.cx * CELL + 14 + i * 11, e.cy * CELL + 6 + (i % 2) * 7, e.cx * CELL + 16 + i * 11, e.cy * CELL + 18 + (i % 3) * 5]); r.endFill(); g.addChild(r); S.layers.wrecks.addChild(g); S.fx.push({ g, t: 0, life: 90, fadeLate: true, fire: { x: e.x, y: e.y, until: 12 } }); explosion(e.x, e.y, true); return; }
  if (isInf(d)) { if (v && v.atlas && v.atlas.dead) { const rec = v.atlas; const k = facingIndex(e.facing, rec.dead.length); const sp = atlasSprite(f, rec.dead[k]); sp.scale.set(AT.scale * v.scaleU); sp.position.set(e.x, e.y); const tm = atlasSprite(f, rec.dteam[k]); tm.scale.copyFrom(sp.scale); tm.position.copyFrom(sp.position); tm.tint = e.owner.color || 0x9a9a8a; g.addChild(sp, tm); } else { const r = new PIXI.Graphics(); r.beginFill(0x3b2a1e, 0.8); r.drawEllipse(e.x, e.y + 3, 7, 3.5); r.endFill(); g.addChild(r); } S.layers.wrecks.addChild(g); S.fx.push({ g, t: 0, life: 25, fadeLate: true }); spark(e.x, e.y, 0xd94b3b, 4); return; }
  if (v && v.atlas) { const rec = v.atlas; const k = facingIndex(e.facing, rec.body.length); const s = atlasSprite(f, rec.body[k]); s.tint = 0x3a3a3a; s.position.set(e.x, e.y); g.addChild(s); if (rec.turret) { const t = atlasSprite(f, rec.turret[facingIndex((v.tang || 0) + 0.8, rec.turret.length)]); t.tint = 0x2a2a2a; t.position.set(e.x + 6, e.y - 4); g.addChild(t); } S.layers.wrecks.addChild(g); S.fx.push({ g, t: 0, life: 40, fadeLate: true, fire: { x: e.x, y: e.y, until: 4 } }); debris(e.x, e.y, d.armour === 'heavy' ? 7 : 4); decal(e.x, e.y, 14, 'scorch'); explosion(e.x, e.y, d.armour === 'heavy'); return; }
  const s = new PIXI.Sprite(unitTexture(d, f)); s.anchor.set(0.5); s.tint = 0x3a3a3a; s.rotation = e.facing + (Math.random() - 0.5) * 0.6; s.position.set(e.x, e.y); g.addChild(s); if (v && v.turret) { const t = new PIXI.Sprite(v.turret.texture); t.anchor.set(0.25, 0.5); t.tint = 0x2a2a2a; t.rotation = v.turret.rotation + 0.8; t.position.set(e.x + 6, e.y - 4); g.addChild(t); } S.layers.wrecks.addChild(g); S.fx.push({ g, t: 0, life: 40, fadeLate: true, fire: { x: e.x, y: e.y, until: 4 } }); explosion(e.x, e.y, d.armour === 'heavy'); }
function projectile(ev) {
  const w = ev.w, v = S.views.get(ev.e.id); if (v) { v.flashT = 0.07; }
  const x1 = ev.x1, y1 = ev.y1 - (isAir(ev.e.def) ? 22 : 0), x2 = ev.x2, y2 = ev.y2 - (isAir(ev.tgt.def) ? 22 : 0);
  if (w.wh === 'BEAM' || w.wh === 'EMP' || w.wh === 'HACK' || w.wh === 'TOXIN') { const g = new PIXI.Graphics(); const col = w.wh === 'HACK' ? 0xe0479e : w.wh === 'EMP' ? 0x9ad7ff : w.wh === 'TOXIN' ? 0x8fff6a : 0xaef3ff; g.lineStyle(w.wh === 'EMP' ? 9 : 7, col, 0.22); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineStyle(w.wh === 'EMP' ? 5 : 3, col, 0.9); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineStyle(1, 0xffffff, 0.9); g.moveTo(x1, y1); g.lineTo(x2, y2); S.layers.fx.addChild(g); S.fx.push({ g, t: 0, life: w.wh === 'TOXIN' ? 0.4 : 0.15, fade: true }); if (w.wh === 'TOXIN') puff(x2, y2, 0x8fff6a, 8, 0.8); else spark(x2, y2, col, 4); return; }
  if (w.wh === 'SA' || w.wh === 'FLAK') { const g = new PIXI.Graphics(); g.lineStyle(1.5, w.wh === 'FLAK' ? 0xffe08a : 0xfff6c8, 0.9); g.moveTo(x1, y1); g.lineTo(x2 + (Math.random() - 0.5) * 8, y2 + (Math.random() - 0.5) * 8); S.layers.fx.addChild(g); S.fx.push({ g, t: 0, life: 0.08, fade: true }); if (w.wh === 'FLAK') setTimeout(() => puff(x2 + (Math.random() - 0.5) * 14, y2 + (Math.random() - 0.5) * 14, 0x333333, 6, 0.6), 60); else spark(x2, y2, 0xffe6a0, 2); return; }
  const d = Math.hypot(x2 - x1, y2 - y1); const speed = w.wh === 'SIEGE' ? 260 : 520; const life = Math.min(0.6, d / speed);
  const g = new PIXI.Graphics(); if (w.wh === 'ROCKET') { g.beginFill(0xdddddd); g.drawRect(-5, -1.5, 10, 3); g.endFill(); g.beginFill(0xff8a3a); g.drawRect(-8, -1, 3, 2); g.endFill(); } else { g.beginFill(0xffe6a0); g.drawCircle(0, 0, w.wh === 'SIEGE' ? 3.5 : 2.5); g.endFill(); }
  g.position.set(x1, y1); g.rotation = Math.atan2(y2 - y1, x2 - x1); S.layers.fx.addChild(g);
  S.fx.push({ g, t: 0, life, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, arc: w.wh === 'SIEGE' ? 40 : w.wh === 'ROCKET' ? 10 : 6, trail: w.wh === 'ROCKET' || w.wh === 'SIEGE', onEnd: () => { if (w.splash) { explosion(x2, y2, w.splash >= 1.5); decal(x2, y2, w.splash >= 1.5 ? 16 : 9, 'scorch'); } else spark(x2, y2, 0xffb347, 5); } });
}
function updateFx(dt) {
  const keep = [];
  for (const f of S.fx) {
    f.t += dt; const k = f.t / f.life;
    if (f.from) { const kk = Math.min(1, k); f.g.position.set(f.from.x + (f.to.x - f.from.x) * kk, f.from.y + (f.to.y - f.from.y) * kk - Math.sin(kk * Math.PI) * f.arc); if (f.trail && Math.random() < 0.6) puff(f.g.position.x, f.g.position.y, 0x888888, 2.5, 0.4); }
    else if (f.vx !== undefined) { f.g.position.x += f.vx * dt; f.g.position.y += f.vy * dt; if (f.grav) f.vy += f.grav * dt; if (f.spin) f.g.rotation += f.spin * dt; if (f.grow) f.g.scale.set(1 + k * f.grow); f.g.alpha = 1 - k; }
    else if (f.crumble) { const c = f.crumble; for (const ch of f.g.children) { ch.scale.set(c.s0, c.s0 * (1 - k * 0.75)); ch.position.y = c.y + k * 6; } f.g.alpha = 1 - k * 0.6; if (Math.random() < 0.7) puff(c.x + (Math.random() - 0.5) * c.w, c.y + (Math.random() - 0.5) * c.h, 0x6b6456, 7 + Math.random() * 6, 1.2); }
    else if (f.ring) { f.g.scale.set(0.2 + 0.8 * k); f.g.alpha = 1 - k; }
    else if (f.grow && !f.fadeLate) { f.g.scale.set(1 + k * f.grow); f.g.alpha = 1 - k; }
    else if (f.fade) f.g.alpha = 1 - k;
    if (f.fadeLate) { f.g.alpha = k > 0.8 ? (1 - k) / 0.2 : 1; if (f.fire && f.t < f.fire.until && Math.random() < 0.25) puff(f.fire.x + (Math.random() - 0.5) * 20, f.fire.y + (Math.random() - 0.5) * 14, Math.random() < 0.4 ? 0xff7a2a : 0x222222, 5, 1.0); }
    if (f.t >= f.life) { if (f.onEnd) f.onEnd(); f.g.destroy({ children: true }); } else keep.push(f);
  }
  S.fx = keep;
}
function streak(x, y) { if (S.reduced) return; const g = new PIXI.Graphics(); g.lineStyle(3, 0xffd27a, 0.9); g.moveTo(x + 120, y - 400); g.lineTo(x, y); S.layers.fx.addChild(g); S.fx.push({ g, t: 0, life: 0.25, fade: true }); }
function pulse(x, y, r, col) { const g = new PIXI.Graphics(); g.lineStyle(3, col, 0.9); g.drawCircle(0, 0, r); g.position.set(x, y); g.scale.set(0.1); S.layers.fx.addChild(g); S.fx.push({ g, t: 0, life: 0.6, ring: true }); }
function dome(x, y, r, col, seconds) { const g = new PIXI.Graphics(); g.beginFill(col, 0.12); g.drawCircle(0, 0, r); g.endFill(); g.lineStyle(2, col, 0.7); g.drawCircle(0, 0, r); g.position.set(x, y); S.layers.fx.addChild(g); S.fx.push({ g, t: 0, life: seconds, fadeLate: true }); }
function nuke(x, y, small) { const r = small ? 2.5 * CELL : 4 * CELL; const flash = new PIXI.Graphics(); flash.beginFill(0xffffff); flash.drawRect(-4000, -4000, 8000, 8000); flash.endFill(); flash.position.set(x, y); S.layers.fx.addChild(flash); S.fx.push({ g: flash, t: 0, life: small ? 0.25 : 0.5, fade: true }); const core = new PIXI.Graphics(); core.beginFill(0xfff1b8); core.drawCircle(0, 0, r); core.endFill(); core.position.set(x, y); core.scale.set(0.1); S.layers.fx.addChild(core); S.fx.push({ g: core, t: 0, life: 1.2, ring: true }); const ring = new PIXI.Graphics(); ring.lineStyle(8, 0xff8a3a, 0.9); ring.drawCircle(0, 0, r * 1.6); ring.position.set(x, y); ring.scale.set(0.1); S.layers.fx.addChild(ring); S.fx.push({ g: ring, t: 0, life: 1.6, ring: true }); for (let i = 0; i < (small ? 14 : 40); i++) setTimeout(() => puff(x + (Math.random() - 0.5) * r * 1.5, y + (Math.random() - 0.5) * r * 1.5 - Math.random() * 60, i % 3 ? 0x3a3a3a : 0xff7a2a, small ? 12 : 22, 2 + Math.random() * 2), i * 40); spark(x, y, 0xffd27a, small ? 20 : 50); S.shake = Math.max(S.shake, small ? 10 : 22); const rad = new PIXI.Graphics(); rad.beginFill(0x8fff6a, 0.12); rad.drawCircle(0, 0, r); rad.endFill(); rad.lineStyle(1.5, 0x8fff6a, 0.5); rad.drawCircle(0, 0, r); rad.position.set(x, y); S.layers.decor.addChild(rad); S.fx.push({ g: rad, t: 0, life: small ? 10 : 30, fadeLate: true }); }
function speech(e, text) { const v = S.views.get(e.id); if (!v) return; if (v.speech) v.speech.destroy(); const t = new PIXI.Text(text, { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }); t.anchor.set(0.5, 1); t.position.set(0, isAir(e.def) ? -44 : -22); v.c.addChild(t); v.speech = t; v.speechT = 2.2; }
function promote(e) { const v = S.views.get(e.id); if (!v) return; spark(e.x, e.y - 10, 0xffd86b, 10); }

// ───────── camera / frame ─────────
function frame(dt) {
  drawOre(false); drawDecals(dt); syncViews(dt); updateFx(dt); if (G.fogT < 0.05) updateFog(); if (S.water) { S.water.position.set(Math.sin(S.time * 0.6) * 4, Math.cos(S.time * 0.45) * 3); S.water.alpha = 0.6 + 0.3 * Math.sin(S.time * 1.3); }
  if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 24); S.shakeX = (Math.random() - 0.5) * S.shake; S.shakeY = (Math.random() - 0.5) * S.shake; } else { S.shakeX = S.shakeY = 0; }
  S.world.scale.set(S.cam.zoom); S.world.position.set(-(S.cam.x + S.shakeX) * S.cam.zoom, -(S.cam.y + S.shakeY) * S.cam.zoom);
  // placement ghost
  S.ghost.clear(); if (S.placing) { const d = S.placing.d, [w, h] = FOOT(d); const ok = SIM.canPlace(S.me, d, S.placing.cx, S.placing.cy); S.ghost.beginFill(ok ? 0x64ff8c : 0xff5050, 0.35); S.ghost.drawRect(S.placing.cx * CELL, S.placing.cy * CELL, w * CELL, h * CELL); S.ghost.endFill(); S.ghost.lineStyle(2, ok ? 0x88ff88 : 0xff8888); S.ghost.drawRect(S.placing.cx * CELL, S.placing.cy * CELL, w * CELL, h * CELL); S.ghost.lineStyle(1, 0xffffff, 0.2); for (const e of G.ents) if (!e.dead && e.owner === S.me && e.def.cls === 'structure') S.ghost.drawRect(e.x - RULES.base.buildRadiusCells * CELL, e.y - RULES.base.buildRadiusCells * CELL, RULES.base.buildRadiusCells * 2 * CELL, RULES.base.buildRadiusCells * 2 * CELL); S.ghost.lineStyle(0); }
  if (S.box) { S.ghost.lineStyle(1 / S.cam.zoom, 0xffffff, 0.9); S.ghost.drawRect(Math.min(S.box.x0, S.box.x1), Math.min(S.box.y0, S.box.y1), Math.abs(S.box.x1 - S.box.x0), Math.abs(S.box.y1 - S.box.y0)); S.ghost.lineStyle(0); }
  if (S.marker) { S.marker.t -= dt; if (S.marker.t <= 0) S.marker = null; else { S.ghost.lineStyle(2, S.marker.col, S.marker.t); S.ghost.drawCircle(S.marker.x, S.marker.y, 6 + (0.6 - S.marker.t) * 20); S.ghost.lineStyle(0); } }
}
function screenToWorld(sx, sy) { return { x: S.cam.x + sx / S.cam.zoom, y: S.cam.y + sy / S.cam.zoom }; }
function clampCam() { const W = S.app.screen.width, H = S.app.screen.height; S.cam.x = SIM.clamp(S.cam.x, -CELL, MAPW * CELL - W / S.cam.zoom + CELL); S.cam.y = SIM.clamp(S.cam.y, -CELL, MAPH * CELL - H / S.cam.zoom + CELL); }
function centerOn(x, y) { S.cam.x = x - S.app.screen.width / S.cam.zoom / 2; S.cam.y = y - S.app.screen.height / S.cam.zoom / 2; clampCam(); }
function handleEvent(ev) {
  switch (ev.type) {
    case 'shot': { const v = S.views.get(ev.e.id); if (v && v.turret) v.recoil = 1; if (S.me && (ev.e.owner === S.me || visibleTo(S.me, ev.e) || visibleTo(S.me, ev.tgt))) projectile(ev); break; }
    case 'death': if (ev.e.owner === S.me || visibleTo(S.me, ev.e)) wreck(ev.e); dropView(ev.e); break;
    case 'hit': { const e = ev.e; const v = S.views.get(e.id); if (v && v.atlas && ev.dmg > 0) v.hitT = 0.09; if (ev.w.wh !== 'SA' && (e.owner === S.me || visibleTo(S.me, e))) spark(e.x, e.y - (isAir(e.def) ? 22 : 0), 0xfff1b8, 3); break; }
    case 'crush': spark(ev.x, ev.y, 0xd94b3b, 6); break;
    case 'promote': promote(ev.e); break;
    case 'sold': { const e = ev.e; spark(e.x, e.y, 0x9be37a, 12); dropView(e); break; }
    case 'unload': spark(ev.e.x, ev.e.y - 10, 0xffd86b, 4); break;
    case 'built': spark(ev.e.x, ev.e.y, 0xffffff, 6); break;
    case 'cratepick': spark(ev.x, ev.y, 0xe8b84a, 14); break;
    case 'impact': { streak(ev.x, ev.y); explosion(ev.x, ev.y, ev.big); decal(ev.x, ev.y, ev.big ? 22 : 12, ev.big ? 'crater' : 'scorch'); break; }
    case 'nuke': nuke(ev.x, ev.y, ev.small); decal(ev.x, ev.y, ev.small ? 40 : 70, 'crater'); break;
    case 'dome': dome(ev.x, ev.y, ev.r, ev.col, ev.seconds); break;
    case 'pulse': pulse(ev.x, ev.y, ev.r, ev.col); break;
    case 'teleport': { spark(ev.x1, ev.y1, 0xe0479e, 10); spark(ev.x2, ev.y2, 0xe0479e, 10); pulse(ev.x2, ev.y2, 40, 0xe0479e); break; }
    case 'drop': spark(ev.e.x, ev.e.y, 0xffffff, 8); break;
    case 'mines': pulse(ev.x, ev.y, 50, 0xd9a441); break;
    case 'mine': explosion(ev.x, ev.y, false); decal(ev.x, ev.y, 12, 'crater'); break;
    case 'absorb': spark(ev.e.x, ev.e.y, 0xd9a441, 2); break;
    case 'emp': if (visibleTo(S.me, ev.e) || ev.e.owner === S.me) spark(ev.e.x, ev.e.y, 0x9ad7ff, 6); break;
    case 'hack': spark(ev.e.x, ev.e.y, 0xe0479e, 10); break;
    case 'garrison': spark(ev.b.x, ev.b.y, 0x9be37a, 6); break;
    case 'capture': spark(ev.e.x, ev.e.y, 0x9be37a, 16); break;
    case 'infiltrate': spark(ev.e.x, ev.e.y, 0xe0479e, 22); pulse(ev.e.x, ev.e.y, 40, 0xe0479e); break;
  }
}
return { S, AT, THEMES, init, bakeTerrain, frame, handleEvent, screenToWorld, clampCam, centerOn, speech, updateFog, explosion };
})();
