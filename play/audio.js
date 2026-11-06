/* Thunderhead — play/audio.js: the game's sound. Every effect is synthesised with the Web Audio API and every line is
 * spoken with the Web Speech API: the game ships as one hosted page with no audio files.
 *
 *   import { Audio } from './audio.js';
 *   Audio.init();                                   // from a user gesture (the Start button); safe to call again
 *   Audio.setListener(x, y, viewHeight, heading);   // each frame: camera ground focus (game metres), height (m), heading (rad)
 *   Audio.sfx('cannon_heavy', { x, y, vol, pitch, delay, range });   // → { name, start, end, stop() } or null
 *   Audio.announce('unit_ready');                   // → 'Unit ready' when accepted, null when rate-limited / unknown
 *   Audio.onSubtitle((text, key) => ...);           // fires when an announcement starts; returns an unsubscribe function
 *   Audio.unitVoice('H03', 'move', 'compact');      // → the spoken line, or null when dropped
 *   Audio.setVolume('sfx', 0.8); Audio.mute(true); Audio.stats();
 *   extras: Audio.resume(), Audio.bake(), Audio.setVoice(role, name), Audio.voices(), Audio.voiceFor(role),
 *           Audio.getVolume(bus), Audio.ready, Audio.muted; createAudio() makes an independent engine (tests, tools).
 * Every method is a silent no-op before init() and when Web Audio / speech is unavailable (announcements still return
 * their text and fire onSubtitle on estimated timing when speech is missing or muted, so subtitles keep working).
 *
 * Heading convention: heading = atan2(fy, fx) of the camera's ground-projected forward vector in game metres (x east,
 * y north). Screen-right is then (sin h, -cos h). Default π/2 (looking +y, screen-right = +x). From three.js
 * (x, z = -y): heading = Math.atan2(-fwd.z, fwd.x).
 *
 * Mixing: each voice is mono — gain (distance, 250 m audible at 100 m view height, 600 m at 400 m, times a per-sound
 * range) → air low-pass (distant voices only) → one of nine shared StereoPanners (screen side, 0.2 steps) → sfx bus;
 * one mono send per voice into a shared generated-IR convolver, big reports also into a two-tap terrain slap echo.
 * Buses sfx / voice / announcer / ui → master → glue compressor → limiter → soft safety clipper (peak ≤ 0.99) → output.
 * Measured in Chrome: unity gain up to ~0.35, output ceiling ≈ 0.88; the two compressors add 12 ms of look-ahead delay.
 * Cost: after init() every sound is baked in the background (OfflineAudioContext, 1–6 variants each, ~2 s, ~19 MB at
 * 44.1 kHz); a baked sound plays as one buffer source + 2–3 mono nodes. Until a sound is baked it is synthesised live
 * from the same recipe (capped at 24 live voices). Per-name voice caps steal the oldest voice; a per-name start gap
 * turns a same-tick volley into a short ragged stagger (extra calls dropped); a global cap of 56 voices.
 */

const G = typeof window !== 'undefined' ? window : globalThis;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NO = Object.freeze({});
function mulberry32(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ───────────────────────────── sound table ─────────────────────────────
// vol: level · cap: max simultaneous voices (oldest stolen) · gap: min seconds between starts · lag: how far a start may
// be pushed back to honour gap (beyond that it is dropped) · range: audible-radius multiplier · rev: reverb send ·
// echo: non-zero sends to reverb + terrain echo (big reports only)
// · pj / vj: random pitch / volume variation per call · n: baked variants · len: max recipe length (s) · bus (default sfx)
const SFX = {
  rifle:              { vol: .78, cap: 8,  gap: .020, lag: .05, range: .9,  rev: .20, echo: 0, pj: .05, vj: .12, n: 6, len: .42 },
  carbine:            { vol: .72, cap: 8,  gap: .020, lag: .05, range: .85, rev: .18, echo: 0, pj: .05, vj: .12, n: 6, len: .32 },
  mg:                 { vol: .74, cap: 6,  gap: .050, lag: .06, range: 1,   rev: .22, echo: 0, pj: .04, vj: .10, n: 5, len: .66 },
  rocket_launch:      { vol: .36, cap: 6,  gap: .050, lag: .08, range: 1.1, rev: .25, echo: 0, pj: .06, vj: .10, n: 4, len: 1.06 },
  missile_launch:     { vol: .50, cap: 5,  gap: .080, lag: .12, range: 1.2, rev: .28, echo: .10, pj: .05, vj: .10, n: 3, len: 1.86 },
  cannon_heavy:       { vol: .93, cap: 5,  gap: .060, lag: .10, range: 1.4, rev: .32, echo: .18, pj: .04, vj: .08, n: 3, len: 1.95 },
  cannon_medium:      { vol: .76, cap: 5,  gap: .060, lag: .10, range: 1.3, rev: .30, echo: .15, pj: .04, vj: .08, n: 4, len: 1.25 },
  deck_gun:           { vol: .80, cap: 4,  gap: .080, lag: .10, range: 1.4, rev: .32, echo: .22, pj: .04, vj: .08, n: 3, len: 1.75 },
  chin_cannon:        { vol: .80, cap: 4,  gap: .100, lag: .10, range: 1.2, rev: .25, echo: .10, pj: .04, vj: .08, n: 4, len: .90 },
  pulse:              { vol: .32, cap: 8,  gap: .020, lag: .05, range: .9,  rev: .15, echo: 0, pj: .06, vj: .10, n: 6, len: .34 },
  energy_cannon:      { vol: .50, cap: 4,  gap: .060, lag: .10, range: 1.3, rev: .28, echo: .12, pj: .04, vj: .08, n: 4, len: 1.06 },
  lance:              { vol: .46, cap: 4,  gap: .060, lag: .10, range: 1.1, rev: .20, echo: 0, pj: .05, vj: .10, n: 4, len: .68 },
  emp:                { vol: .42, cap: 3,  gap: .150, lag: .15, range: 1.4, rev: .30, echo: .12, pj: .04, vj: .08, n: 2, len: 1.42 },
  bomb_drop:          { vol: .40, cap: 4,  gap: .100, lag: .20, range: 1.3, rev: .20, echo: 0, pj: .04, vj: .08, n: 2, len: 1.52 },
  whoosh:             { vol: .42, cap: 6,  gap: .030, lag: .05, range: .8,  rev: .10, echo: 0,   pj: .10, vj: .15, n: 5, len: .52 },
  impact_small:       { vol: .55, cap: 10, gap: .015, lag: .04, range: .8,  rev: .12, echo: 0,   pj: .08, vj: .15, n: 6, len: .40 },
  impact_metal:       { vol: .30, cap: 6,  gap: .040, lag: .08, range: 1.1, rev: .22, echo: 0, pj: .06, vj: .10, n: 5, len: 1.00 },
  impact_dirt:        { vol: .66, cap: 6,  gap: .040, lag: .08, range: 1.1, rev: .20, echo: 0, pj: .06, vj: .12, n: 5, len: .86 },
  impact_water:       { vol: .42, cap: 5,  gap: .050, lag: .08, range: 1.1, rev: .20, echo: 0, pj: .06, vj: .12, n: 3, len: 1.02 },
  explosion_small:    { vol: .80, cap: 6,  gap: .050, lag: .10, range: 1.4, rev: .32, echo: .15, pj: .06, vj: .10, n: 5, len: 1.16 },
  explosion_large:    { vol: .86, cap: 4,  gap: .080, lag: .12, range: 1.7, rev: .38, echo: .22, pj: .05, vj: .08, n: 3, len: 2.62 },
  explosion_building: { vol: .90, cap: 3,  gap: .150, lag: .20, range: 2,   rev: .40, echo: .25, pj: .04, vj: .06, n: 2, len: 3.80 },
  debris:             { vol: .60, cap: 4,  gap: .080, lag: .15, range: 1,   rev: .20, echo: 0,   pj: .08, vj: .12, n: 3, len: 1.42 },
  shield_deploy:      { vol: .48, cap: 2,  gap: .100, lag: .15, range: 1,   rev: .20, echo: 0,   pj: .03, vj: .05, n: 1, len: 1.10 },
  deploy:             { vol: .52, cap: 3,  gap: .100, lag: .15, range: 1,   rev: .20, echo: 0, pj: .04, vj: .06, n: 3, len: 0.96 },
  rotor:              { vol: .70, cap: 4,  gap: .120, lag: .10, range: 1.3, rev: .15, echo: 0, pj: .04, vj: .06, n: 3, len: 1.18 },
  jet_pass:           { vol: .62, cap: 2,  gap: .400, lag: 0,   range: 1.8, rev: .25, echo: .10, pj: .05, vj: .06, n: 2, len: 3.18 },
  hover_whine:        { vol: .62, cap: 3,  gap: .120, lag: .10, range: 1,   rev: .12, echo: 0,   pj: .04, vj: .06, n: 2, len: 1.38 },
  harvest_load:       { vol: .50, cap: 2,  gap: .300, lag: 0,   range: 1,   rev: .15, echo: 0,   pj: .05, vj: .08, n: 1, len: 1.55 },
  harvest_unload:     { vol: .54, cap: 2,  gap: .300, lag: 0,   range: 1,   rev: .18, echo: 0,   pj: .04, vj: .06, n: 1, len: 2.25 },
  place_building:     { vol: .62, cap: 2,  gap: .100, lag: .10, range: 1.2, rev: .25, echo: .10, pj: .03, vj: .05, n: 2, len: 1.02 },
  building_rise:      { vol: .48, cap: 2,  gap: .300, lag: 0,   range: 1,   rev: .20, echo: 0,   pj: .03, vj: .05, n: 1, len: 2.42 },
  ui_click:           { vol: .40, cap: 3,  gap: .030, lag: 0, bus: 'ui', n: 1, len: .12 },
  ui_hover:           { vol: .50, cap: 2,  gap: .040, lag: 0, bus: 'ui', n: 1, len: .08 },
  ui_error:           { vol: .50, cap: 1,  gap: .200, lag: 0, bus: 'ui', n: 1, len: .44 },
  ui_ready:           { vol: .48, cap: 2,  gap: .250, lag: 0, bus: 'ui', n: 1, len: 1.36 },
  ui_queue:           { vol: .40, cap: 3,  gap: .050, lag: 0, bus: 'ui', n: 1, len: .30 },
  ui_cancel:          { vol: .48, cap: 3,  gap: .050, lag: 0, bus: 'ui', n: 1, len: .34 },
  order_ack:          { vol: .36, cap: 2,  gap: .080, lag: 0, bus: 'ui', n: 1, len: .20 },
  alert:              { vol: .34, cap: 1,  gap: 1.50, lag: 0, bus: 'ui', n: 1, len: .92 },
  select:             { vol: .44, cap: 2,  gap: .050, lag: 0, bus: 'ui', n: 1, len: .16 },
  // internal: announcer radio chirps, the Lattice data burble under unit acks
  _chirp:             { vol: .50, cap: 1,  gap: .100, lag: 0, bus: 'announcer', n: 1, len: .20 },
  _radio_out:         { vol: .42, cap: 1,  gap: .100, lag: 0, bus: 'announcer', n: 1, len: .16 },
  _data:              { vol: .55, cap: 1,  gap: .100, lag: 0, bus: 'voice', n: 1, len: .12 },
};
export const SOUND_DEFS = SFX;
export const SOUND_NAMES = Object.keys(SFX).filter((k) => k[0] !== '_');
const BAKE_FIRST = ['rifle', 'carbine', 'pulse', 'impact_small', 'mg', 'order_ack', 'select', 'ui_click', 'ui_hover', 'impact_dirt', 'impact_metal',
  'cannon_medium', 'cannon_heavy', 'explosion_small', 'rocket_launch', 'whoosh', 'energy_cannon', 'chin_cannon', 'explosion_large'];
const BAKE_ORDER = [...BAKE_FIRST, ...Object.keys(SFX).filter((k) => !BAKE_FIRST.includes(k))];
const BASE = { master: .9, sfx: .9, voice: 1, announcer: 1, ui: .8 };   // bus trims at volume 1
const BUSES = ['sfx', 'voice', 'announcer', 'ui'];
const MAX_VOICES = 56;
const LEAD = .012;   // live-synth scheduling lead so envelopes keep their transient
const MAX_LIVE_SYNTH = 24;   // live-synthesised voices at once (only before a sound is baked)
const PAN_STEPS = [-.8, -.6, -.4, -.2, 0, .2, .4, .6, .8];
const ECHO_OF_SEND = .6;     // echo level relative to the reverb send for sounds with echo
/** audible radius (m) for a camera at height h: 250 m at 100 m, 600 m at 400 m */
export const audibleRadius = (h) => clamp(250 + (h - 100) * (350 / 300), 140, 1200);

// ───────────────────────────── shared buffers / curves ─────────────────────────────
const RES = new Map();   // sampleRate → resources (AudioBuffers are context-independent, reused by bake contexts)
function resources(ctx) {
  const sr = ctx.sampleRate; if (RES.has(sr)) return RES.get(sr);
  const rnd = mulberry32(0x7468756e);
  // loopable buffer: generate N+F samples, crossfade the head with the overrun so the loop point is seamless
  const loopable = (sec, gen) => {
    const N = Math.floor(sec * sr), F = Math.floor(sr * .02), x = new Float32Array(N + F); gen(x);
    let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    const b = ctx.createBuffer(1, N, sr), d = b.getChannelData(0), k = m > 0 ? .95 / m : 1;
    for (let i = 0; i < N; i++) d[i] = (i < F ? x[i] * (i / F) + x[N + i] * (1 - i / F) : x[i]) * k;
    return b;
  };
  const white = loopable(2, (x) => { for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 - 1; });
  const pink = loopable(2, (x) => { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < x.length; i++) { const w = rnd() * 2 - 1; b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913; x[i] = b0 + b1 + b2 + w * .1848; } });
  const brown = loopable(3, (x) => { let l = 0; for (let i = 0; i < x.length; i++) { l = (l + .02 * (rnd() * 2 - 1)) / 1.02; x[i] = l; } });
  // crackle: sparse short noise bursts (fire, sparks, rocket motors)
  const crackle = loopable(2, (x) => { let i = 0; while (i < x.length) { i += Math.floor(-Math.log(1 - rnd()) * sr / 320) + 1; const L = 3 + ((rnd() * 14) | 0), a = (.2 + .8 * rnd() ** 2) * (rnd() < .5 ? -1 : 1); for (let k = 0; k < L && i + k < x.length; k++) x[i + k] += a * (rnd() * 2 - 1) * Math.exp(-k / (L * .35)); } });
  // grit: pebble hits, each a short decaying sinusoid (ore, gravel, debris, spray); playbackRate shifts the stone size
  const grit = loopable(2, (x) => { let t = 0; const dur = x.length / sr; for (;;) { t += -Math.log(1 - rnd()) / 170; if (t >= dur) break; const f = 1200 * Math.pow(5, rnd()), tau = .0012 + rnd() * .0035, a = .08 + .92 * rnd() ** 2.5, ph = rnd() * TAU, i0 = Math.floor(t * sr), n = Math.floor(tau * 6 * sr); for (let k = 0; k < n && i0 + k < x.length; k++) x[i0 + k] += a * Math.sin(ph + TAU * f * k / sr) * Math.exp(-k / (tau * sr)); } });
  const curve = (f, n = 1024) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = f((i / (n - 1)) * 2 - 1); return c; };
  const R = {
    white, pink, brown, crackle, grit,
    drive: curve((x) => Math.tanh(2 * x) / Math.tanh(2)),      // used behind a 0.5 pre-gain: unity for small signals, soft to ±1 at ±2
    hard: curve((x) => Math.tanh(5 * x) / Math.tanh(5)),
    pulse: curve((x) => Math.pow((x + 1) / 2, 6)),               // sine LFO → 0..1 chop
    pulse2: curve((x) => Math.pow((x + 1) / 2, 16)),             // narrower chop (blade slap)
    // safety clipper behind a 0.5 pre-gain: transparent to ±0.8, smooth to ±0.99 at ±2, clamped beyond
    safety: curve((x) => { const s = 2 * x, a = Math.abs(s); return a <= .8 ? s : Math.sign(s) * (.8 + .19 * Math.tanh((a - .8) / .19)); }, 4096),
    ir: makeIR(ctx, rnd),
  };
  RES.set(sr, R); return R;
}
// outdoor impulse response: a few ground / terrain reflections, then a diffuse tail that darkens as it decays (T60 ≈ 1.3 s)
function makeIR(ctx, rnd) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 1.5), ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++) { const t = i / sr, k = .08 + .85 * Math.exp(-t * 4); lp += k * ((rnd() * 2 - 1) - lp); d[i] = lp * Math.exp(-t * 5.2) * (t < .012 ? t / .012 : 1); }
    const taps = c ? [[.017, .5], [.041, .32], [.067, .22], [.093, .15]] : [[.013, .55], [.033, .35], [.058, .25], [.101, .14]];
    for (const [tt, a] of taps) { const i0 = Math.floor(tt * sr); for (let k = 0; k < 24; k++) d[i0 + k] += a * (rnd() * 2 - 1) * Math.exp(-k / 6); }
  }
  return ir;
}

// ───────────────────────────── synthesis toolkit ─────────────────────────────
// A Synth schedules one sound into a context at time t. All frequencies pass through the helpers, which apply the pitch
// multiplier p; gains / times are untouched. srcs / nodes are kept for clean-up and voice stealing.
class Synth {
  constructor(ctx, t, rnd, R, p) { this.ctx = ctx; this.t = t; this.rnd = rnd; this.R = R; this.p = p || 1; this.end = t; this.srcs = []; this.nodes = []; this.nyq = ctx.sampleRate * .45; }
  r(a, b) { return a + (b - a) * this.rnd(); }
  j(x, amt) { return x * (1 + (this.rnd() * 2 - 1) * amt); }
  chance(p) { return this.rnd() < p; }
  _keep(n) { this.nodes.push(n); return n; }
  _src(s, t, stop, off) { if (off != null) s.start(t, off); else s.start(t); s.stop(stop); s._stop = stop; this.srcs.push(s); if (stop > this.end) this.end = stop; return this._keep(s); }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return this._keep(g); }
  filt(type, f, q = .707) { const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = clamp(f * this.p, 10, 20000); n.Q.value = q; return this._keep(n); }
  shaper(curve) { const s = this.ctx.createWaveShaper(); s.curve = curve; return this._keep(s); }
  delay(t, max = .05) { const d = this.ctx.createDelay(max); d.delayTime.value = t; return this._keep(d); }
  noise(kind, t, dur, rate = 1) { const s = this.ctx.createBufferSource(), buf = this.R[kind]; s.buffer = buf; s.loop = true; s.playbackRate.value = rate * this.p; return this._src(s, t, t + dur, this.rnd() * (buf.duration - .02)); }
  osc(type, f, t, dur) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f * this.p; return this._src(o, t, t + dur); }
  /** exponential frequency (or other positive param) sweep through [[time, value], ...] */
  sweep(param, pts, scale = true) { const k = scale ? this.p : 1; param.setValueAtTime(Math.max(1e-4, pts[0][1] * k), pts[0][0]); for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(Math.max(1e-4, pts[i][1] * k), pts[i][0]); }
  /** percussive envelope: linear attack a, optional hold, exponential decay to −60 dB over d */
  perc(t, pk, a, d, hold = 0) { pk = Math.max(pk, 1e-4); const g = this.gain(0), P = g.gain, e = t + a + hold + d; P.setValueAtTime(0, t); P.linearRampToValueAtTime(pk, t + a); if (hold > 0) P.setValueAtTime(pk, t + a + hold); P.exponentialRampToValueAtTime(pk * 1e-3, e); P.setValueAtTime(0, e); return g; }
  /** linear-segment envelope [[time, level], ...] */
  env(pts) { const g = this.gain(0), P = g.gain; P.setValueAtTime(pts[0][1], pts[0][0]); for (let i = 1; i < pts.length; i++) P.linearRampToValueAtTime(pts[i][1], pts[i][0]); return g; }
  /** exponential-segment envelope (levels > 0), silent after the last point */
  envx(pts) { const g = this.gain(0), P = g.gain; P.setValueAtTime(Math.max(1e-4, pts[0][1]), pts[0][0]); for (let i = 1; i < pts.length; i++) P.exponentialRampToValueAtTime(Math.max(1e-4, pts[i][1]), pts[i][0]); P.setValueAtTime(0, pts[pts.length - 1][0]); return g; }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  /** soft-saturation stage into dst; returns its input */
  sat(dst, pre = .5) { const m = this.gain(pre); this.chain(m, this.shaper(this.R.drive), dst); return m; }
  burst(kind, t, type, f, q, pk, a, d, dst, rate = 1, hold = 0) { const s = this.noise(kind, t, a + hold + d + .01, rate); this.chain(s, this.filt(type, f, q), this.perc(t, pk, a, d, hold), dst); return s; }
  thump(t, f0, f1, st, pk, d, dst) { const o = this.osc('sine', f0, t, d + .012); this.sweep(o.frequency, [[t, f0], [t + st, f1]]); this.chain(o, this.perc(t, pk, .0015, d), dst); return o; }
  tone(type, f, t, pk, a, d, dst, hold = 0) { const o = this.osc(type, f, t, a + hold + d + .01); this.chain(o, this.perc(t, pk, a, d, hold), dst); return o; }
  /** struck metal: free-bar partial ratios, each decaying faster than the last, plus a strike tick */
  metal(t, base, amp, dm, dst) {
    const R = [1, 2.76, 5.4, 8.93], A = [1, .62, .38, .22], D = [.85, .5, .3, .18];
    for (let i = 0; i < 4; i++) { const f = base * R[i] * this.j(1, .015); if (f * this.p < this.nyq) this.tone('sine', f, t, amp * A[i], .0006, D[i] * dm, dst); }
    this.burst('white', t, 'bandpass', Math.min(base * 4, 9000), 1.5, amp * .9, .0004, .02, dst);
  }
  /** one gunshot: high crack, band body, low pink boom, swept sine thump, optional snap */
  round(t, dst, o) {
    this.burst('white', t, 'highpass', o.crackF, .8, o.crackPk, .0006, o.crackD, dst);
    this.burst('white', t, 'bandpass', o.bodyF, o.bodyQ, o.bodyPk, .001, o.bodyD, dst);
    if (o.lowPk) this.burst('pink', t, 'lowpass', o.lowF, .7, o.lowPk, .0015, o.lowD, dst);
    if (o.thPk) this.thump(t, o.th0, o.th1, o.thD * .25, o.thPk, o.thD, dst);
    if (o.snap) { const s = this.osc('triangle', o.snap, t, .04); this.sweep(s.frequency, [[t, o.snap], [t + .012, o.snap * .3]]); this.chain(s, this.perc(t, o.snapPk || .25, .0005, .03), dst); }
  }
}

// ───────────────────────────── recipes ─────────────────────────────
// Each recipe schedules into o starting at b.t, peaking near 1.0 before SFX[name].vol is applied.
const SYN = {};
SYN.rifle = (b, o) => {   // 7.62 service rifle: hard crack, mid body, chest thump, then the action cycling
  const t = b.t, m = b.sat(o);
  b.round(t, m, { crackF: b.j(2400, .1), crackD: .03, crackPk: .9, bodyF: b.j(1100, .12), bodyQ: .8, bodyD: .12, bodyPk: .95,
    lowF: 900, lowD: .2, lowPk: .4, th0: b.j(190, .08), th1: 70, thD: .12, thPk: .45, snap: b.j(2100, .1), snapPk: .22 });
  b.burst('white', t, 'bandpass', b.j(2700, .1), 1.2, .35, .0005, .06, m);   // supersonic snap
  const tb = t + b.r(.065, .09);
  b.burst('white', tb, 'bandpass', b.j(3600, .1), 4, .12, .0005, .035, o);
  b.burst('white', tb + b.r(.012, .02), 'bandpass', b.j(2700, .1), 5, .08, .0005, .03, o);
};
SYN.carbine = (b, o) => {   // 5.56 carbine: brighter, tighter, polymer-and-steel tick
  const t = b.t, m = b.sat(o);
  b.round(t, m, { crackF: b.j(3400, .1), crackD: .025, crackPk: 1, bodyF: b.j(1750, .1), bodyQ: 1.1, bodyD: .1, bodyPk: .85,
    lowF: 1100, lowD: .16, lowPk: .22, th0: b.j(230, .08), th1: 95, thD: .1, thPk: .32, snap: b.j(3300, .08), snapPk: .2 });
  b.burst('white', t + b.r(.045, .06), 'bandpass', b.j(5200, .08), 6, .09, .0004, .022, o);
};
SYN.mg = (b, o) => {   // machine gun: a 3–4 round burst (~850 rpm) with belt-link rattle
  const m = b.sat(o), n = b.chance(.35) ? 4 : 3, gap = b.r(.066, .074);
  for (let i = 0; i < n; i++) {
    const t = b.t + i * gap + (i ? b.r(-.004, .004) : 0), k = i ? b.r(.82, 1.02) : 1;
    b.round(t, m, { crackF: b.j(1900, .1), crackD: .03, crackPk: .85 * k, bodyF: b.j(900, .12), bodyQ: .8, bodyD: .14, bodyPk: .85 * k,
      lowF: 650, lowD: .25, lowPk: .4 * k, th0: b.j(160, .08), th1: 60, thD: .14, thPk: .5 * k });
    b.burst('white', t + .03, 'bandpass', b.j(4200, .1), 5, .07, .0005, .028, o);
  }
};
SYN.rocket_launch = (b, o) => {   // shoulder / pod rocket: ignition pop, fwoosh sweeping up, fluttering motor hiss
  const t = b.t, m = b.sat(o), d = b.r(.75, .9);
  b.thump(t, b.j(130, .08), 48, .05, .8, .3, m);
  b.burst('white', t, 'highpass', 1400, .7, .6, .0008, .055, m);
  b.burst('pink', t, 'lowpass', 900, .7, .5, .002, .28, m);
  b.chain(b.noise('white', t, d + .05), (() => { const f = b.filt('bandpass', 500, .9); b.sweep(f.frequency, [[t, 500], [t + .25, b.j(2300, .12)], [t + d, 1500]]); return f; })(),
    b.env([[t, 0], [t + .02, .75], [t + .18, .55], [t + d, 0]]), o);
  const fl = b.gain(.7), lfo = b.osc('sine', b.r(24, 32), t, d + .05), ld = b.gain(.3); lfo.connect(ld); ld.connect(fl.gain);
  b.chain(b.noise('white', t + .02, d), b.filt('highpass', 3200, .7), b.env([[t + .02, 0], [t + .06, .28], [t + d, 0]]), fl, o);
  b.burst('brown', t + .01, 'lowpass', 320, .7, .55, .02, .95, m);
};
SYN.missile_launch = (b, o) => {   // VLS / guided missile: cold-launch thunk, ignition, crackling roar, receding hiss
  const t = b.t, m = b.sat(o);
  b.thump(t, b.j(95, .08), 40, .08, .75, .42, m);
  b.burst('pink', t, 'lowpass', 700, .8, .5, .002, .25, m);
  b.metal(t, b.j(330, .08), .12, .7, o);
  const ti = t + b.r(.05, .08), d = b.r(1.35, 1.6);
  b.burst('white', ti, 'highpass', 1000, .7, .55, .001, .08, m);
  const rf = b.filt('lowpass', 1100, .8); b.sweep(rf.frequency, [[ti, 1100], [ti + .3, 2600], [ti + d, 900]]);
  b.chain(b.noise('pink', ti, d), rf, b.env([[ti, 0], [ti + .05, .85], [ti + .5, .6], [ti + d, 0]]), m);
  b.chain(b.noise('crackle', ti + .03, d * .9), b.filt('bandpass', 1900, .6), b.env([[ti + .03, 0], [ti + .1, .5], [ti + d * .9, 0]]), o);
  const hf = b.filt('bandpass', 1300, 1.3); b.sweep(hf.frequency, [[ti, 1300], [ti + .3, 3200], [ti + d, 1200]]);
  b.chain(b.noise('white', ti, d), hf, b.env([[ti, 0], [ti + .08, .32], [ti + d, 0]]), o);
  b.burst('brown', ti, 'lowpass', 160, .7, .7, .03, 1.4, m);
};
SYN.cannon_heavy = (b, o) => {   // 125 mm: blast transient, sub thump, boom, rolling report, autoloader clank
  const t = b.t, m = b.sat(o);
  b.burst('white', t, 'highpass', 500, .6, 1, .0005, .05, m);
  b.thump(t, b.j(78, .06), 28, .25, .65, .55, m);                        // sub
  b.thump(t, b.j(230, .08), 75, .05, .7, .25, m);                         // punch
  const bf = b.filt('lowpass', 1400, .7); b.sweep(bf.frequency, [[t, b.j(1400, .1)], [t + .5, 400]]);
  b.chain(b.noise('pink', t, .72), b.filt('highpass', 80, .7), bf, b.perc(t, .9, .002, .7), m);       // boom
  b.burst('white', t, 'bandpass', b.j(1500, .12), .7, .7, .001, .25, m);  // crack
  b.burst('white', t, 'bandpass', b.j(700, .12), .8, .5, .002, .35, m);   // crunch
  b.burst('brown', t + .01, 'lowpass', 190, .7, .32, .02, 1.5, o);        // rolling report
  b.burst('pink', t + .02, 'lowpass', 520, .7, .2, .03, 1.2, o);
  const tc = t + b.r(.55, .7);
  b.metal(tc, b.j(820, .08), .1, .8, o);
  b.metal(tc + b.r(.12, .18), b.j(560, .08), .07, 1, o);
};
SYN.cannon_medium = (b, o) => {   // 105-class precision cannon: tighter, brighter
  const t = b.t, m = b.sat(o);
  b.burst('white', t, 'highpass', 700, .6, .95, .0005, .04, m);
  b.thump(t, b.j(98, .06), 38, .18, .58, .4, m);
  b.thump(t, b.j(260, .08), 90, .04, .65, .2, m);
  b.burst('pink', t, 'lowpass', b.j(1700, .1), .7, .85, .002, .45, m);
  b.burst('white', t, 'bandpass', b.j(2300, .1), .8, .65, .001, .18, m);
  b.burst('white', t, 'bandpass', b.j(900, .1), .8, .45, .002, .25, m);
  b.burst('brown', t + .01, 'lowpass', 230, .7, .35, .02, 1, o);
  b.burst('pink', t + .02, 'lowpass', 600, .7, .16, .03, .8, o);
  b.metal(t + b.r(.4, .5), b.j(980, .08), .08, .8, o);
};
SYN.deck_gun = (b, o) => {   // naval gun: sharp report, hull ring, muzzle blast slapping the water
  const t = b.t, m = b.sat(o);
  b.burst('white', t, 'highpass', 600, .6, .95, .0005, .045, m);
  b.thump(t, b.j(88, .06), 34, .2, .62, .45, m);
  b.thump(t, b.j(240, .08), 80, .05, .65, .22, m);
  b.burst('pink', t, 'lowpass', b.j(1500, .1), .7, .85, .002, .5, m);
  b.burst('white', t, 'bandpass', b.j(2000, .1), .8, .6, .001, .2, m);
  b.burst('white', t, 'bandpass', b.j(800, .1), .8, .4, .002, .3, m);
  for (const f of [212, 349, 531]) b.tone('sine', b.j(f, .05), t, .08, .002, .9, o);
  b.burst('white', t + .05, 'bandpass', 900, .6, .22, .03, .4, o);
  b.burst('brown', t + .01, 'lowpass', 200, .7, .4, .02, 1.4, o);
  b.burst('pink', t + .02, 'lowpass', 550, .7, .18, .03, 1.1, o);
};
SYN.chin_cannon = (b, o) => {   // 30 mm chain gun: 3–4 heavy rounds at ~10 Hz, low chug, link tick
  const m = b.sat(o), n = b.chance(.3) ? 4 : 3, gap = b.r(.095, .105);
  for (let i = 0; i < n; i++) {
    const t = b.t + i * gap, k = i ? b.r(.85, 1) : 1;
    b.burst('white', t, 'highpass', 900, .6, .85 * k, .0005, .035, m);
    b.thump(t, b.j(170, .06), 60, .05, .55 * k, .16, m);
    b.burst('pink', t, 'lowpass', b.j(1600, .1), .7, .75 * k, .0015, .25, m);
    b.burst('white', t, 'bandpass', b.j(2600, .1), .9, .55 * k, .001, .1, m);
    b.burst('white', t, 'bandpass', b.j(1000, .1), .8, .4 * k, .001, .14, m);
    b.burst('brown', t, 'lowpass', 260, .7, .22 * k, .005, .35, o);
    b.metal(t + .05, b.j(2400, .1), .03, .3, o);
  }
};
SYN.pulse = (b, o) => {   // android pulse carbine: FM zap sweeping down, square buzz, sizzle, small pop
  const t = b.t, f0 = b.j(2300, .08), f1 = b.j(360, .1), dz = b.r(.085, .1);
  const c = b.osc('sine', f0, t, .3); b.sweep(c.frequency, [[t, f0], [t + dz, f1]]);
  const mo = b.osc('sine', f0 * 1.5, t, .3); b.sweep(mo.frequency, [[t, f0 * 1.5], [t + dz, f1 * 1.5]]);
  const md = b.gain(0); md.gain.setValueAtTime(f0 * b.p, t); md.gain.exponentialRampToValueAtTime(Math.max(1, f1 * .3 * b.p), t + dz); mo.connect(md); md.connect(c.frequency);
  b.chain(c, b.perc(t, .55, .001, .2), o);
  const s = b.osc('square', f0 * .5, t, .2); b.sweep(s.frequency, [[t, f0 * .5], [t + dz, f1 * .5]]);
  b.chain(s, b.filt('bandpass', 1800, 1.2), b.perc(t, .14, .001, .14), o);
  b.burst('white', t, 'highpass', 6000, .7, .32, .0005, .09, o);
  b.thump(t, b.j(320, .08), 95, .03, .4, .12, o);
};
SYN.energy_cannon = (b, o) => {   // hover-tank accelerator cannon: crack + thump, saw zap through a closing filter, FM shimmer, capacitor hum
  const t = b.t, zf0 = b.j(1800, .08), cf0 = b.j(950, .08);
  b.burst('white', t, 'highpass', 3000, .7, .75, .0005, .04, o);
  b.thump(t, b.j(170, .06), 40, .14, 1, .55, o);
  const z = b.osc('sawtooth', zf0, t, .5); b.sweep(z.frequency, [[t, zf0], [t + .32, 90]]);
  const zf = b.filt('lowpass', 5000, 2); b.sweep(zf.frequency, [[t, 5000], [t + .35, 700]]);
  b.chain(z, zf, b.perc(t, .45, .001, .45), o);
  const c = b.osc('sine', cf0, t, .7); b.sweep(c.frequency, [[t, cf0], [t + .4, 140]]);
  const mo = b.osc('sine', cf0 * 2.01, t, .7); b.sweep(mo.frequency, [[t, cf0 * 2.01], [t + .4, 281]]);
  const md = b.gain(0); md.gain.setValueAtTime(500 * b.p, t); md.gain.exponentialRampToValueAtTime(50 * b.p, t + .4); mo.connect(md); md.connect(c.frequency);
  b.chain(c, b.perc(t, .32, .001, .6), o);
  const hm = b.gain(.5); b.osc('sawtooth', 55, t, 1).connect(hm); b.osc('sawtooth', 110.6, t, 1).connect(hm);
  const trem = b.gain(.7), lfo = b.osc('sine', 19, t, 1), ld = b.gain(.3); lfo.connect(ld); ld.connect(trem.gain);
  b.chain(hm, b.filt('lowpass', 420, 1), b.perc(t, .3, .01, .85), trem, o);
  b.burst('pink', t, 'bandpass', 900, .8, .3, .002, .9, o);
};
SYN.lance = (b, o) => {   // EMP lance: snap, hard-clipped detuned saw arc chopped by crackle, falling zap
  const t = b.t, d = b.r(.42, .52);
  b.burst('white', t, 'highpass', 4200, .7, .7, .0004, .03, o);
  const sm = b.gain(.5); b.osc('sawtooth', b.j(92, .05), t, d + .05).connect(sm); b.osc('sawtooth', b.j(97, .05), t, d + .05).connect(sm);
  const chop = b.gain(.55), cg = b.gain(1.6); b.noise('crackle', t, d + .05).connect(cg); cg.connect(chop.gain);
  b.chain(sm, b.shaper(b.R.hard), b.filt('bandpass', 1400, .7), b.env([[t, 0], [t + .008, .42], [t + d * .6, .3], [t + d, 0]]), chop, o);
  b.chain(b.noise('crackle', t, d + .1), b.filt('highpass', 2000, .7), b.env([[t, 0], [t + .01, .55], [t + d, .1], [t + d + .1, 0]]), o);
  const z = b.osc('sine', 3000, t, .3); b.sweep(z.frequency, [[t, 3000], [t + .25, 280]]); b.chain(z, b.perc(t, .28, .001, .28), o);
  b.thump(t, 210, 70, .05, .45, .2, o);
};
SYN.emp = (b, o) => {   // EMP burst: deep whomp, electronic sweep then power-down, falling shimmer, arcing crackle, dying hum
  const t = b.t, top = b.j(2400, .08);
  b.thump(t, b.j(72, .05), 28, .35, 1, 1, o);
  b.thump(t, b.j(150, .06), 55, .12, .4, .5, o);
  const s = b.osc('sine', 200, t, 1.3); b.sweep(s.frequency, [[t, 200], [t + .11, top], [t + 1.15, 55]]);
  const fm = b.osc('sine', 33, t, 1.3), fd = b.gain(120 * b.p); fm.connect(fd); fd.connect(s.frequency);
  b.chain(s, b.env([[t, 0], [t + .02, .3], [t + .5, .22], [t + 1.2, 0]]), o);
  const nf = b.filt('bandpass', 6500, 1.5); b.sweep(nf.frequency, [[t, 6500], [t + .9, 500]]);
  b.chain(b.noise('white', t, 1), nf, b.perc(t, .3, .005, .9), o);
  b.burst('crackle', t, 'bandpass', 3000, .5, .55, .01, 1, o, 1, .1);
  const h = b.osc('sawtooth', 52, t, 1.3); b.sweep(h.frequency, [[t, 52], [t + 1.2, 30]]);
  b.chain(h, b.filt('lowpass', 320, 1), b.env([[t, 0], [t + .05, .25], [t + 1.25, 0]]), o);
};
SYN.bomb_drop = (b, o) => {   // release clunk, then the falling whistle (with an air hiss tracking it)
  const t = b.t, d = b.r(1.25, 1.4), f0 = b.j(1900, .06), tw = t + .05;
  b.metal(t, b.j(240, .08), .18, 1.2, o);
  b.thump(t, 180, 90, .03, .35, .18, o);
  b.burst('white', t, 'bandpass', 1100, 2, .25, .0008, .08, o);
  const w = b.osc('sine', f0, tw, d); b.sweep(w.frequency, [[tw, f0], [tw + d, f0 * .38]]);
  const vib = b.osc('sine', 6.5, tw, d), vd = b.gain(14 * b.p); vib.connect(vd); vd.connect(w.frequency);
  b.chain(w, b.env([[tw, 0], [tw + .2, .2], [tw + d * .85, .24], [tw + d, 0]]), o);
  const nf = b.filt('bandpass', f0, 9); b.sweep(nf.frequency, [[tw, f0], [tw + d, f0 * .38]]);
  b.chain(b.noise('white', tw, d), nf, b.env([[tw, 0], [tw + .25, .5], [tw + d, 0]]), o);
};
SYN.whoosh = (b, o) => {   // projectile flyby: band-passed noise with a doppler sweep, faint shell whistle
  const t = b.t, d = b.r(.38, .48), pk = t + d * b.r(.38, .48);
  const f = b.filt('bandpass', 900, 1.4); b.sweep(f.frequency, [[t, b.j(900, .1)], [pk, b.j(2600, .1)], [t + d, 650]]);
  b.chain(b.noise('white', t, d + .02), f, b.env([[t, 0], [pk - .06, .35], [pk, .85], [pk + .07, .4], [t + d, 0]]), o);
  b.chain(b.noise('pink', t, d + .02), b.filt('lowpass', 1200, .7), b.env([[t, 0], [pk, .35], [t + d, 0]]), o);
  const s = b.osc('sine', 1350, t, d); b.sweep(s.frequency, [[t, 1350], [pk, 1500], [t + d, 950]]);
  b.chain(s, b.env([[t, 0], [pk, .05], [t + d, 0]]), o);
};
SYN.impact_small = (b, o) => {   // bullet strike; about one in three ricochets
  const t = b.t;
  b.burst('white', t, 'bandpass', b.j(2600, .2), .8, 1, .0004, .05, o);
  b.thump(t, b.j(230, .1), 90, .02, .22, .1, o);
  b.burst('pink', t, 'lowpass', 1500, .7, .3, .002, .2, o);
  if (b.chance(.33)) { const f0 = b.r(3200, 4200), d = b.r(.18, .28), s = b.osc('sine', f0, t + .01, d + .02); b.sweep(s.frequency, [[t + .01, f0], [t + .01 + d, f0 * .5]]); b.chain(s, b.env([[t + .01, 0], [t + .02, .14], [t + .01 + d, 0]]), o); }
};
SYN.impact_metal = (b, o) => {   // shell on armour: transient, thud, ringing plate, sparks
  const t = b.t, m = b.sat(o);
  b.burst('white', t, 'highpass', 1000, .7, .9, .0004, .03, m);
  b.thump(t, b.j(210, .08), 80, .04, .5, .22, m);
  b.burst('pink', t, 'bandpass', b.j(800, .15), 1, .55, .001, .22, m);
  b.metal(t, b.r(380, 520), .42, 1.1, o);
  b.burst('crackle', t + .005, 'highpass', 4000, .7, .3, .002, .45, o);
};
SYN.impact_dirt = (b, o) => {   // round into earth: thud, burst, clods and stones falling back
  const t = b.t, m = b.sat(o);
  b.thump(t, b.j(170, .08), 55, .06, .6, .3, m);
  b.thump(t, b.j(70, .08), 34, .1, .25, .35, m);
  b.chain(b.noise('pink', t, .37), b.filt('highpass', 90, .7), b.filt('lowpass', b.j(1200, .15), .7), b.perc(t, .75, .002, .35), m);
  b.burst('white', t, 'bandpass', b.j(1500, .1), .6, .45, .0005, .12, m);
  b.burst('grit', t + .02, 'highpass', 700, .6, .65, .015, .7, o, .6);
};
SYN.impact_water = (b, o) => {   // splash: heavy thump, rising bubble plop, spray, droplets falling back
  const t = b.t;
  b.thump(t, b.j(110, .08), 45, .07, .4, .3, o);
  const p = b.osc('sine', 260, t, .2); b.sweep(p.frequency, [[t, b.j(260, .1)], [t + .045, b.j(900, .1)]]); b.chain(p, b.perc(t, .3, .002, .15), o);
  b.burst('white', t, 'bandpass', b.j(1700, .15), .6, .75, .008, .8, o);
  b.burst('grit', t + .06, 'bandpass', 4200, .7, .5, .05, .85, o, 1.3);
  b.burst('pink', t, 'lowpass', 600, .7, .35, .01, .5, o);
};
SYN.explosion_small = (b, o) => {   // vehicle-killing blast: transient, thump, closing blast, crackle, grit
  const t = b.t, m = b.sat(o);
  b.burst('white', t, 'highpass', 800, .6, .9, .0005, .04, m);
  b.thump(t, b.j(80, .06), 30, .2, .75, .55, m);
  b.thump(t, b.j(240, .08), 80, .06, .7, .3, m);
  const f = b.filt('lowpass', 4000, .7); b.sweep(f.frequency, [[t, b.j(4000, .1)], [t + .6, 500]]);
  b.chain(b.noise('pink', t, .82), b.filt('highpass', 80, .7), f, b.perc(t, .9, .003, .8), m);
  b.burst('white', t, 'bandpass', b.j(1000, .1), .6, .5, .002, .35, m);
  b.burst('crackle', t + .01, 'bandpass', b.j(2200, .15), .5, .5, .02, 1, o, b.r(.8, 1.1));
  b.burst('grit', t + .1, 'lowpass', 3000, .7, .35, .05, .95, o, .55);
};
SYN.explosion_large = (b, o) => {   // big blast: sub-bass thump, closing blast, crackle, rumble, debris tail, cook-off pops
  const t = b.t, m = b.sat(o);
  b.burst('white', t, 'highpass', 600, .6, 1, .0006, .05, m);
  b.thump(t, b.j(62, .05), 24, .5, .72, .95, m);                          // sub
  b.thump(t, b.j(210, .06), 70, .08, .7, .45, m);                         // punch
  const f = b.filt('lowpass', 5000, .7); b.sweep(f.frequency, [[t, 5000], [t + 1.2, 400]]);
  b.chain(b.noise('pink', t, 1.72), b.filt('highpass', 75, .7), f, b.perc(t, 1, .004, 1.7), m);       // blast
  b.burst('white', t, 'bandpass', b.j(800, .1), .5, .55, .003, .5, m);    // crunch
  b.burst('crackle', t + .02, 'bandpass', b.j(1600, .15), .4, .6, .03, 2.2, o, .8);
  b.burst('brown', t, 'lowpass', 140, .7, .38, .05, 2, o);                // rumble
  b.chain(b.noise('pink', t + .03, 2.07), b.filt('highpass', 90, .7), b.filt('lowpass', 400, .7), b.perc(t + .03, .4, .05, 2), o);
  b.burst('grit', t + .25, 'lowpass', 2500, .7, .4, .12, 2, o, .5);       // debris
  for (let i = 0, k = 2 + ((b.rnd() * 2) | 0); i < k; i++) { const tp = t + b.r(.3, 1.3); b.burst('white', tp, 'bandpass', b.r(900, 2200), .8, b.r(.12, .25), .001, .12, o); b.thump(tp, b.r(110, 160), 60, .04, b.r(.1, .2), .2, o); }
};
SYN.explosion_building = (b, o) => {   // structure destroyed: blast, secondary detonation, metal groan, collapse rumble, debris rain, clanks
  const t = b.t, m = b.sat(o), t2 = t + b.r(.32, .45);
  b.burst('white', t, 'highpass', 500, .6, 1, .0006, .06, m);
  b.thump(t, b.j(58, .05), 22, .6, .7, 1.1, m);
  b.thump(t, b.j(200, .06), 65, .08, .7, .45, m);
  const f = b.filt('lowpass', 4500, .7); b.sweep(f.frequency, [[t, 4500], [t + 1.3, 380]]);
  b.chain(b.noise('pink', t, 2.02), b.filt('highpass', 75, .7), f, b.perc(t, 1, .004, 2), m);
  b.burst('white', t, 'bandpass', b.j(750, .1), .5, .5, .003, .6, m);
  b.thump(t2, b.j(50, .05), 20, .5, .6, 1.1, m);
  b.thump(t2, b.j(180, .06), 60, .08, .5, .4, m);
  const f2 = b.filt('lowpass', 3000, .7); b.sweep(f2.frequency, [[t2, 3000], [t2 + 1.3, 320]]);
  b.chain(b.noise('pink', t2, 1.92), b.filt('highpass', 75, .7), f2, b.perc(t2, .8, .01, 1.9), m);
  const g = b.osc('sawtooth', b.j(72, .08), t + .5, 2.2); b.sweep(g.frequency, [[t + .5, 72], [t + 2.6, 38]]);
  const am = b.gain(.6), lfo = b.osc('sine', 3.5, t + .5, 2.2), ld = b.gain(.4); lfo.connect(ld); ld.connect(am.gain);
  b.chain(g, b.filt('bandpass', 230, 3), b.env([[t + .5, 0], [t + .9, .22], [t + 2.2, .15], [t + 2.7, 0]]), am, o);
  b.burst('brown', t + .35, 'lowpass', 200, .7, .45, .3, 3, o);
  b.chain(b.noise('pink', t + .4, 2.91), b.filt('highpass', 90, .7), b.filt('lowpass', 450, .7), b.perc(t + .4, .45, .3, 2.6), o);
  b.burst('grit', t + .45, 'lowpass', 2200, .7, .6, .25, 2.8, o, .45);
  b.burst('crackle', t + .2, 'bandpass', 1200, .5, .45, .1, 3, o, .7);
  for (let i = 0, k = 4 + ((b.rnd() * 3) | 0); i < k; i++) b.metal(t + b.r(.6, 2.6), b.r(250, 700), b.r(.05, .12), .8, o);
};
SYN.debris = (b, o) => {   // rubble and metal pieces landing
  const t = b.t;
  b.burst('grit', t, 'bandpass', 1800, .5, .5, .02, 1.3, o, b.r(.6, .8));
  b.burst('pink', t, 'lowpass', 500, .7, .3, .03, 1, o);
  for (let i = 0, k = 5 + ((b.rnd() * 4) | 0); i < k; i++) b.metal(t + b.r(.02, 1.05), b.r(1400, 3800), b.r(.03, .09), .3, o);
  for (let i = 0, k = 2 + ((b.rnd() * 2) | 0); i < k; i++) b.thump(t + b.r(.05, .8), b.r(130, 170), 70, .03, b.r(.15, .3), .2, o);
};
SYN.shield_deploy = (b, o) => {   // deployable shield: hardware clack, rising power-up, shimmer, lock-on ting, field hum
  const t = b.t, ts = t + .04;
  b.burst('white', t, 'bandpass', 2500, 3, .5, .0005, .07, o);
  b.thump(t, 600, 300, .02, .2, .12, o);
  const s1 = b.osc('sawtooth', 180, ts, .9), s2 = b.osc('sawtooth', 181.2, ts, .9); b.sweep(s1.frequency, [[ts, 180], [t + .5, 720]]); b.sweep(s2.frequency, [[ts, 181.2], [t + .5, 726]]);
  const sm = b.gain(.5); s1.connect(sm); s2.connect(sm);
  const bp = b.filt('bandpass', 600, 4); b.sweep(bp.frequency, [[ts, 600], [t + .5, 3000]]);
  b.chain(sm, bp, b.env([[ts, 0], [t + .1, .25], [t + .5, .3], [t + .9, 0]]), o);
  const sh = b.osc('sine', 900, t + .1, .85); b.sweep(sh.frequency, [[t + .1, 900], [t + .5, 1800]]);
  const v = b.osc('sine', 9, t + .1, .85), vd = b.gain(30 * b.p); v.connect(vd); vd.connect(sh.frequency);
  b.chain(sh, b.env([[t + .1, 0], [t + .4, .14], [t + .95, 0]]), o);
  b.tone('sine', 1760, t + .5, .25, .001, .3, o); b.tone('sine', 2640, t + .5, .12, .001, .2, o);
  const hm = b.gain(1); b.osc('sine', 110, t + .45, .6).connect(hm); b.osc('sine', 220, t + .45, .6).connect(hm);
  b.chain(hm, b.env([[t + .45, 0], [t + .55, .14], [t + .85, .1], [t + 1.05, 0]]), o);
};
SYN.deploy = (b, o) => {   // vehicle / weapon deploy: hydraulic hiss, servo whine, two clanks
  const t = b.t;
  b.burst('white', t, 'highpass', 2600, .7, .28, .02, .35, o, 1, .12);
  const s = b.osc('sawtooth', 130, t, .55); b.sweep(s.frequency, [[t, 130], [t + .42, 215]]);
  b.chain(s, b.filt('lowpass', 900, 1.5), b.env([[t, 0], [t + .05, .2], [t + .42, .18], [t + .52, 0]]), o);
  b.metal(t + .12, b.j(310, .08), .16, .8, o); b.thump(t + .12, 140, 70, .03, .35, .15, o);
  b.metal(t + .5, b.j(215, .08), .2, .5, o); b.thump(t + .5, 105, 48, .05, .6, .3, o);
  b.burst('white', t + .5, 'bandpass', 1800, 1.2, .2, .001, .06, o);
};
SYN.rotor = (b, o) => {   // rotor chop: noise amplitude-modulated at the blade-pass rate, blade slap, turbine + tail rotor
  const t = b.t, d = b.r(.95, 1.1), bpf = b.r(17.5, 21), E = (pk) => b.env([[t, 0], [t + .08, pk], [t + d - .3, pk], [t + d, 0]]);
  const lfo = b.osc('sine', bpf, t, d + .02), pu = b.shaper(b.R.pulse), pu2 = b.shaper(b.R.pulse2); lfo.connect(pu); lfo.connect(pu2);
  const v1 = b.gain(0); pu.connect(v1.gain); b.chain(b.noise('pink', t, d + .02), b.filt('lowpass', b.j(650, .1), .8), v1, E(.7), o);
  const v2 = b.gain(0); pu.connect(v2.gain); b.chain(b.osc('sine', b.j(68, .05), t, d + .02), v2, E(.3), o);
  const v4 = b.gain(0); pu.connect(v4.gain); b.chain(b.noise('pink', t, d + .02), b.filt('bandpass', b.j(260, .1), .9), v4, E(.8), o);   // the "whop"
  const v3 = b.gain(0); pu2.connect(v3.gain); b.chain(b.noise('white', t, d + .02), b.filt('bandpass', 1000, .6), v3, E(.5), o);
  b.chain(b.osc('sine', b.j(1240, .03), t, d), b.env([[t, 0], [t + .1, .035], [t + d - .2, .035], [t + d, 0]]), o);
  b.chain(b.osc('sawtooth', bpf * 5.4, t, d), b.filt('lowpass', 700, 1), b.env([[t, 0], [t + .1, .06], [t + d - .2, .06], [t + d, 0]]), o);
};
SYN.jet_pass = (b, o) => {   // strike jet flyby: roar with ground-reflection flanging, rumble, doppler turbine whine, afterburner crackle
  const t = b.t, T = b.r(2.7, 3.1), pk = t + T * b.r(.38, .44), e = t + T, wf = b.j(1850, .06);
  const sum = b.gain(1); b.noise('pink', t, T + .02).connect(sum); const wm = b.gain(.35); b.noise('white', t, T + .02).connect(wm); wm.connect(sum);
  const lp = b.filt('lowpass', 2500, .7); b.sweep(lp.frequency, [[t, 2500], [pk, 9000], [e, 800]]);
  const dry = b.gain(.6), dl = b.delay(.0045, .02), wet = b.gain(.6), ge = b.envx([[t, .015], [pk, .95], [e, .001]]);
  b.sweep(dl.delayTime, [[t, .0045], [pk, .0004], [e, .007]], false);
  sum.connect(lp); lp.connect(dry); lp.connect(dl); dl.connect(wet); dry.connect(ge); wet.connect(ge); ge.connect(o);
  b.chain(b.noise('brown', t, T + .02), b.filt('lowpass', 220, .7), b.envx([[t, .01], [pk + .08, .7], [e, .001]]), o);
  const doppler = [[t, wf * 1.06], [pk - .1, wf * 1.03], [pk + .25, wf * .78], [e, wf * .74]];
  const s = b.osc('sawtooth', wf, t, T), sf = b.filt('bandpass', wf, 6); b.sweep(s.frequency, doppler); b.sweep(sf.frequency, doppler);
  b.chain(s, sf, b.envx([[t, .01], [pk - .05, .12], [t + T * .8, .001]]), o);
  b.chain(b.noise('crackle', pk, e - pk), b.filt('bandpass', 1000, .5), b.envx([[pk, .3], [e, .001]]), o);
};
SYN.hover_whine = (b, o) => {   // hover tank: lift-fan rush, detuned turbine saws with vibrato, electric whine, low hum
  const t = b.t, d = b.r(1.15, 1.35), E = (pk) => b.env([[t, 0], [t + .15, pk], [t + d - .35, pk], [t + d, 0]]), f = b.j(410, .04);
  b.chain(b.noise('pink', t, d), b.filt('bandpass', b.j(900, .08), .8), E(.4), o);
  const s1 = b.osc('sawtooth', f, t, d), s2 = b.osc('sawtooth', f * 1.0085, t, d), sm = b.gain(.5); s1.connect(sm); s2.connect(sm);
  const vib = b.osc('sine', 5.5, t, d), vd = b.gain(4 * b.p); vib.connect(vd); vd.connect(s1.frequency); vd.connect(s2.frequency);
  b.chain(sm, b.filt('lowpass', 2400, 1), E(.09), o);
  const hw = b.osc('sine', 2600, t, d); b.sweep(hw.frequency, [[t, b.j(2600, .04)], [t + d, 2760]]); b.chain(hw, E(.045), o);
  const hm = b.gain(1); b.osc('sine', 82, t, d).connect(hm); b.osc('triangle', 164, t, d).connect(hm); b.chain(hm, E(.16), o);
};
SYN.harvest_load = (b, o) => {   // ore rattling into a steel hopper: pebble stream, bigger stones, ringing hopper body, clanks
  const t = b.t, d = b.r(1.3, 1.45), E = (pk, a = .15, r = .4) => b.env([[t, 0], [t + a, pk], [t + d - r, pk * .85], [t + d, 0]]);
  b.chain(b.noise('grit', t, d, b.r(.85, 1)), b.filt('bandpass', 2200, .6), E(.55), o);
  const gm = b.gain(1); b.noise('grit', t + .05, d - .05, b.r(.38, .45)).connect(gm);
  b.chain(gm, b.filt('lowpass', 1300, .7), E(.42, .2), o);
  const r1 = b.filt('bandpass', b.j(640, .05), 14), r2 = b.filt('bandpass', b.j(1470, .05), 11), rg = b.gain(2.6); gm.connect(r1); gm.connect(r2); r1.connect(rg); r2.connect(rg);
  b.chain(rg, E(.5, .2), o);
  for (let i = 0, k = 6 + ((b.rnd() * 4) | 0); i < k; i++) b.metal(t + b.r(.05, d - .4), b.r(480, 760), b.r(.03, .07), .4, o);
  b.chain(b.noise('brown', t, d), b.filt('lowpass', 180, .7), E(.35, .25), o);
};
SYN.harvest_unload = (b, o) => {   // tipping the bed: hydraulic hiss + whine, ore pouring through a ringing grate, rumble
  const t = b.t, d = b.r(1.9, 2.15), tp = t + .2, dp = d - .2, E = (pk) => b.env([[tp, 0], [tp + .3, pk], [tp + dp - .5, pk * .8], [tp + dp, 0]]);
  b.burst('white', t, 'highpass', 3000, .7, .25, .02, .5, o, 1, .1);
  const s = b.osc('sawtooth', 95, t, .9); b.sweep(s.frequency, [[t, 95], [t + .8, 140]]);
  b.chain(s, b.filt('lowpass', 700, 1.2), b.env([[t, 0], [t + .05, .12], [t + .75, .1], [t + .9, 0]]), o);
  const gm = b.gain(1); b.noise('grit', tp, dp, b.r(.45, .55)).connect(gm);
  b.chain(gm, b.filt('lowpass', 1800, .7), E(.6), o);
  b.chain(gm, b.filt('bandpass', b.j(1100, .05), 7), b.gain(2), E(.35), o);
  b.chain(b.noise('grit', tp, dp, .85), b.filt('highpass', 1500, .7), E(.25), o);
  for (let i = 0, k = 6 + ((b.rnd() * 3) | 0); i < k; i++) b.metal(tp + b.r(0, dp - .4), b.r(260, 380), b.r(.04, .09), .4, o);
  b.chain(b.noise('brown', tp, dp), b.filt('lowpass', 160, .7), E(.7), o);
};
SYN.place_building = (b, o) => {   // heavy foundation thud, dust, construction clanks, ratchet
  const t = b.t, m = b.sat(o);
  b.thump(t, b.j(58, .05), 26, .3, .8, .7, m);
  b.thump(t, b.j(180, .05), 60, .05, .6, .25, m);
  b.burst('pink', t, 'lowpass', 700, .7, .8, .002, .5, m);
  b.burst('white', t, 'lowpass', 3000, .7, .5, .0005, .04, m);
  b.burst('pink', t + .02, 'bandpass', 800, .6, .28, .03, .8, o);
  b.metal(t + .14, b.j(330, .05), .26, .85, o); b.metal(t + .3, b.j(470, .05), .18, .8, o);
  for (let i = 0; i < 6; i++) b.burst('white', t + .45 + i * .032, 'bandpass', 3500, 3, .26 * (1 - i * .08), .0004, .02, o);
};
SYN.building_rise = (b, o) => {   // structure going up: rising servo, accelerating ratchet, clanks, rumble, final lock
  const t = b.t, d = b.r(2, 2.15);
  const s = b.osc('sawtooth', 70, t, d); b.sweep(s.frequency, [[t, 70], [t + d - .3, 165]]);
  b.chain(s, b.filt('lowpass', 600, 1.2), b.env([[t, 0], [t + .2, .18], [t + d - .35, .18], [t + d - .2, 0]]), o);
  for (let tt = t + .1, gap = .12; tt < t + d - .35; tt += gap, gap = Math.max(.045, gap * .93)) b.burst('white', tt, 'bandpass', b.j(3000, .1), 3, .3, .0004, .02, o);
  for (const [k, f] of [[.35, 300], [.8, 360], [1.3, 430]]) b.metal(t + k + b.r(-.03, .03), b.j(f, .05), .2, .8, o);
  b.chain(b.noise('brown', t, d), b.filt('lowpass', 150, .7), b.env([[t, 0], [t + .3, .28], [t + d - .3, .28], [t + d, 0]]), o);
  b.chain(b.noise('pink', t, d), b.filt('bandpass', 420, .8), b.env([[t, 0], [t + .3, .12], [t + d - .3, .12], [t + d, 0]]), o);
  const te = t + d - .25; b.thump(te, 90, 45, .05, .6, .3, o); b.metal(te, b.j(520, .05), .16, .5, o);
};
SYN.ui_click = (b, o) => { const t = b.t; b.tone('sine', 1850, t, .35, .001, .08, o); b.tone('triangle', 3700, t, .1, .0005, .03, o); b.burst('white', t, 'highpass', 5000, .7, .15, .0003, .012, o); };
SYN.ui_hover = (b, o) => { b.tone('sine', 3200, b.t, .14, .002, .05, o); b.tone('sine', 1600, b.t, .05, .002, .03, o); };
SYN.ui_error = (b, o) => { const t = b.t, lp = b.filt('lowpass', 1400, .8); lp.connect(o); b.tone('square', 230, t, .2, .004, .1, lp, .09); b.tone('square', 172, t + .15, .2, .004, .14, lp, .1); };
SYN.ui_ready = (b, o) => { const t = b.t; for (const [f, dt] of [[659.3, 0], [987.8, .09], [1318.5, .18]]) { b.tone('sine', f, t + dt, .22, .002, 1.1, o); b.tone('sine', f * 2, t + dt, .06, .002, .5, o); b.tone('sine', f * 2.76, t + dt, .05, .001, .25, o); } };
SYN.ui_queue = (b, o) => { const t = b.t; b.tone('sine', 1046.5, t, .2, .002, .12, o, .03); b.tone('sine', 1568, t + .055, .2, .002, .18, o, .03); b.burst('white', t, 'highpass', 6000, .7, .08, .0003, .01, o); };
SYN.ui_cancel = (b, o) => { const t = b.t; b.tone('triangle', 1568, t, .22, .002, .1, o, .03); b.tone('triangle', 1046.5, t + .06, .22, .002, .12, o, .03); b.tone('triangle', 784, t + .12, .18, .002, .16, o, .02); };
SYN.order_ack = (b, o) => {   // radio key-up: band-limited squelch burst, then a short bip
  const t = b.t, m = b.gain(.5); b.chain(m, b.shaper(b.R.hard), b.filt('bandpass', 1900, .9), o);
  b.burst('white', t, 'bandpass', b.j(2000, .06), 1.2, .45, .002, .07, m, 1, .03);
  b.tone('sine', b.j(1350, .02), t + .055, .14, .002, .05, o, .02);
};
SYN.alert = (b, o) => {   // two-tone klaxon, two cycles
  const t = b.t, g = b.gain(.5); b.chain(g, b.shaper(b.R.hard), b.filt('bandpass', 1000, .9), o);
  for (const [f, dt] of [[620, 0], [520, .22], [620, .44], [520, .66]]) { const e = b.env([[t + dt, 0], [t + dt + .012, .5], [t + dt + .18, .45], [t + dt + .2, 0]]); b.osc('sawtooth', f, t + dt, .21).connect(e); b.osc('square', f * 1.005, t + dt, .21).connect(e); e.connect(g); }
};
SYN.select = (b, o) => { const t = b.t; b.tone('sine', 1180, t, .16, .001, .06, o, .015); b.tone('sine', 1560, t + .03, .14, .001, .08, o, .015); b.burst('white', t, 'highpass', 5500, .7, .06, .0003, .01, o); };
SYN._chirp = (b, o) => { const t = b.t; b.burst('white', t, 'bandpass', 2500, 1.5, .25, .001, .05, o); b.tone('sine', 1400, t + .01, .16, .002, .05, o, .03); b.tone('sine', 2100, t + .06, .16, .002, .06, o, .03); };
SYN._radio_out = (b, o) => { const t = b.t; b.burst('white', t, 'bandpass', 2000, 1.2, .22, .001, .09, o, 1, .015); b.tone('sine', 900, t, .08, .001, .05, o); };
SYN._data = (b, o) => { const t = b.t, lp = b.filt('lowpass', 6000, .7); lp.connect(o); for (let i = 0; i < 5; i++) b.tone('square', b.r(1500, 3600), t + i * .013, .05, .0005, .02, lp, .006); };

// ───────────────────────────── announcer and unit lines ─────────────────────────────
// every: min seconds between two of the same key · pri: queue priority (3 clears the queue and interrupts)
export const ANNOUNCER_LINES = {
  construction_complete:  { text: 'Construction complete', every: 1 },
  unit_ready:             { text: 'Unit ready', every: 1.5 },
  building:               { text: 'Building', every: .8 },
  insufficient_funds:     { text: 'Insufficient funds', every: 8 },
  low_power:              { text: 'Low power', every: 15, pri: 2 },
  base_under_attack:      { text: 'Our base is under attack', every: 20, pri: 2 },
  harvester_under_attack: { text: 'Our harvester is under attack', every: 20, pri: 2 },
  unit_lost:              { text: 'Unit lost', every: 5 },
  structure_lost:         { text: 'Structure lost', every: 4, pri: 2 },
  new_options:            { text: 'New construction options', every: 3 },
  cannot_place:           { text: 'Cannot deploy here', every: 1.5 },
  on_hold:                { text: 'On hold', every: .8 },
  cancelled:              { text: 'Cancelled', every: .8 },
  selected_target:        { text: 'Target acquired', every: 1.5 },
  mission_accomplished:   { text: 'Mission accomplished', every: 0, pri: 3 },
  mission_failed:         { text: 'Mission failed', every: 0, pri: 3 },
  game_speed:             { text: 'Game speed changed', every: 1 },
};
export const UNIT_KINDS = ['select', 'move', 'attack'];
export const UNIT_IDS = ['H01', 'H02', 'H03', 'H04', 'H05', 'T01', 'T02', 'T03', 'T04', 'T05', 'A01', 'A03', 'A04', 'A05', 'HV'];
// voice: per-unit speech settings over the faction's (role picks the voice: compact / lattice / helix / helix_f)
export const UNIT_LINES = {
  H01: { faction: 'compact', name: 'Conscript', voice: { pitch: .76, rate: 1.06 },
    select: ['Conscript reporting.', 'Yes, comrade?', 'Awaiting orders.', 'Rifle ready.'],
    move: ['Moving out.', 'On the double!', 'Marching.', 'Da. Going.'],
    attack: ['Open fire!', 'For the Compact!', 'Engaging!', 'Fire at will!'] },
  H02: { faction: 'compact', name: 'Rocket Trooper', voice: { pitch: .7, rate: 1.04 },
    select: ['Rocket team ready.', 'Tube loaded.', 'Show me armour.', 'Launcher armed.'],
    move: ['Hauling the tube.', 'Moving to position.', 'Relocating, comrade.', 'Understood.'],
    attack: ['Backblast clear!', 'Rocket away!', 'Armour spotted!', 'Fire the tube!'] },
  H03: { faction: 'compact', name: 'Bastion', voice: { pitch: .6, rate: .96 },
    select: ['Bastion ready.', 'Armour standing by.', 'Main gun loaded.', 'Crew awaiting orders.'],
    move: ['Rolling out.', 'Tracks turning.', 'Advancing.', 'Full throttle.'],
    attack: ['Target in sight!', 'Main gun, fire!', 'Crush them!', 'Firing!'] },
  H04: { faction: 'compact', name: 'Hammer', voice: { pitch: .84, rate: 1.12 },
    select: ['Hammer on station.', 'Rotors turning.', 'Gunship ready.', 'Hammer here, go ahead.'],
    move: ['Vectoring.', 'Low and fast.', 'Copy, en route.', 'Moving to grid.'],
    attack: ['Rockets away!', 'Starting gun run!', 'Hammer engaging!', 'Weapons hot!'] },
  H05: { faction: 'compact', name: 'Bulwark', voice: { pitch: .64, rate: .98 },
    select: ['Bulwark standing by.', 'Deck crew ready.', 'Gunboat reporting.', 'All hands at stations.'],
    move: ['Full ahead.', 'Changing heading.', 'Underway.', 'Making way, comrade.'],
    attack: ['Deck gun, fire!', 'Engaging target!', 'Fire for effect!', 'Open fire!'] },
  T01: { faction: 'lattice', name: 'Pulse Trooper', voice: { pitch: .55, rate: 1.12 },
    select: ['Unit active.', 'Pulse trooper online.', 'Awaiting directive.', 'Ready.'],
    move: ['Path computed.', 'Relocating.', 'Executing.', 'Moving. Moving.'],
    attack: ['Target designated.', 'Discharging.', 'Hostile. Engaging.', 'Eliminate.'] },
  T02: { faction: 'lattice', name: 'Nullifier', voice: { pitch: .45, rate: 1.04 },
    select: ['Nullifier online.', 'Lance charged.', 'Field coils nominal.', 'Disruption ready.'],
    move: ['Repositioning.', 'Vector accepted.', 'Advancing to grid.', 'Relocating.'],
    attack: ['Overload target.', 'Lance discharge.', 'Their systems will fail.', 'Nullify.'] },
  T03: { faction: 'lattice', name: 'Wisp', voice: { pitch: .62, rate: 1.06 },
    select: ['Wisp online.', 'Lift stable.', 'Accelerator primed.', 'Hover systems nominal.'],
    move: ['Gliding.', 'Vector set.', 'Course plotted.', 'Drifting forward.'],
    attack: ['Firing solution locked.', 'Accelerating mass.', 'Target. Erased.', 'Discharge.'] },
  T04: { faction: 'lattice', name: 'Mote', voice: { pitch: 1.45, rate: 1.24 },
    select: ['Recon node online.', 'Mote. Watching.', 'Sensors open.', 'Optics active.'],
    move: ['Scanning route.', 'Relocating node.', 'Airborne. Moving.', 'Mapping terrain.'],
    attack: ['Lock acquired.', 'Target tagged.', 'Pulsing.', 'Engage. Engage.'] },
  T05: { faction: 'lattice', name: 'Trident', voice: { pitch: .38, rate: .98 },
    select: ['Trident online.', 'Naval node active.', 'Hull integrity nominal.', 'Awaiting directive.'],
    move: ['Plotting course.', 'Navigating.', 'Heading adjusted.', 'Underway.'],
    attack: ['Missiles armed.', 'Salvo authorised.', 'Target locked. Launching.', 'Hostile vessel. Engage.'] },
  A01: { faction: 'helix', name: 'Ranger', voice: { pitch: .95, rate: 1.06 },
    select: ['Ranger, on the clock.', 'Helix Security.', 'Go ahead, control.', 'Ranger standing by.'],
    move: ['Moving to the site.', 'Copy, relocating.', 'Securing the route.', 'On my way.'],
    attack: ['Threat engaged.', 'Neutralising.', 'Hostile identified.', 'Weapons free.'] },
  A03: { faction: 'helix', name: 'Arbiter', voice: { pitch: .86, rate: 1 },
    select: ['Arbiter standing by.', 'Arbiter, ready to enforce.', 'Armour online.', 'At your service.'],
    move: ['Advancing.', 'Copy, repositioning.', 'Rolling to the perimeter.', 'Moving out.'],
    attack: ['Enforcing compliance.', 'Target acquired.', 'Arbiter engaging.', 'Contract terminated.'] },
  A04: { faction: 'helix', name: 'Kestrel', voice: { role: 'helix_f', pitch: 1.02, rate: 1.1 },
    select: ['Kestrel airborne.', 'Ordnance loaded.', 'Kestrel, ready to strike.', 'Standing by.'],
    move: ['Vectoring.', 'Copy, in transit.', 'On approach.', 'Moving to waypoint.'],
    attack: ['Bombs away.', 'Strike authorised.', 'Commencing run.', 'Delivering payload.'] },
  A05: { faction: 'helix', name: 'Sentinel', voice: { pitch: .82, rate: .98 },
    select: ['Sentinel on station.', 'Cells armed.', 'Frigate ready.', 'Sentinel, watching the water.'],
    move: ['Setting course.', 'Underway.', 'Copy, new heading.', 'Repositioning.'],
    attack: ['Cells away.', 'Launching.', 'Missiles released.', 'Target engaged.'] },
  // the harvester is shared: lines per faction ('attack' = an ore / harvest order)
  HV: { name: 'Harvester',
    compact: { voice: { pitch: .74, rate: 1 }, select: ['Harvester ready.', 'Ore truck standing by.', 'Big rig waiting.'], move: ['Rolling.', 'Heading out.', 'Hauling.'], attack: ['Going for ore.', 'Filling the hopper.', 'To the ore field.'] },
    lattice: { voice: { pitch: .5, rate: 1.06 }, select: ['Extractor online.', 'Collection unit idle.', 'Ore unit ready.'], move: ['Route computed.', 'Relocating.', 'In transit.'], attack: ['Harvesting.', 'Extracting resources.', 'Collection initiated.'] },
    helix: { voice: { pitch: .9, rate: 1.04 }, select: ['Logistics ready.', 'Hauler standing by.', 'Harvester on the clock.'], move: ['En route.', 'Moving the asset.', 'Copy, relocating.'], attack: ['Mining the claim.', 'Collecting revenue.', 'Extraction underway.'] },
  },
};
// fallback for any other uid, by faction
export const GENERIC_LINES = {
  compact: { select: ['Ready.', 'Yes, comrade?', 'Awaiting orders.'], move: ['Moving.', 'Understood.', 'On my way.'], attack: ['Engaging!', 'Open fire!', 'Attacking!'] },
  lattice: { select: ['Unit online.', 'Ready.', 'Awaiting directive.'], move: ['Relocating.', 'Executing.', 'Moving.'], attack: ['Engaging.', 'Target locked.', 'Hostile.'] },
  helix: { select: ['Standing by.', 'Ready.', 'Go ahead.'], move: ['Copy.', 'Moving.', 'On my way.'], attack: ['Engaging.', 'Weapons free.', 'Target acquired.'] },
};
const FACTION_STYLE = { compact: { role: 'compact', pitch: .7, rate: 1 }, lattice: { role: 'lattice', pitch: .55, rate: 1.1 }, helix: { role: 'helix', pitch: .95, rate: 1.05 } };
const ANN_STYLE = { role: 'announcer', pitch: .92, rate: 1.05 };
const ACK_PITCH = { compact: .9, lattice: 1.2, helix: 1.06 };
/** the line set for a uid (HV per faction; unknown uids fall back to the faction's generic lines) */
export function linesFor(uid, faction) {
  const u = UNIT_LINES[uid];
  if (u && uid === 'HV') return u[faction] || u.compact;
  return u || GENERIC_LINES[faction] || null;
}
function unitStyle(uid, faction) {
  const set = linesFor(uid, faction), base = FACTION_STYLE[faction] || FACTION_STYLE[(set && set.faction) || 'compact'], ov = (set && set.voice) || NO;
  return { role: ov.role || base.role, pitch: ov.pitch != null ? ov.pitch : base.pitch, rate: ov.rate != null ? ov.rate : base.rate };
}
const STALE = 4;          // s: queued announcements older than this are dropped
const CHIRP_MS = 130;     // radio pre-chirp before the announcer speaks
const GAP_MS = 180;       // pause between two announcements
const UNIT_GAP = .6;      // s: a unit line is not interrupted within this
const estSpeech = (text, rate) => .35 + text.length * .066 / Math.max(.5, rate || 1);

// voice choice: name preferences per role, then gender, then local voices; novelty voices avoided (Fred is wanted for the Lattice)
const VOICE_PREFS = {
  announcer: ['Samantha', 'Karen', 'Serena', 'Moira', 'Tessa', 'Google UK English Female', 'Microsoft Libby', 'Microsoft Sonia', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Microsoft Hazel', 'Microsoft Susan', 'Google US English', 'Victoria', 'Allison', 'Ava', 'Fiona'],
  compact: ['Daniel', 'Google UK English Male', 'Microsoft Ryan', 'Microsoft George', 'Microsoft Thomas', 'Microsoft David', 'Microsoft Guy', 'Microsoft Mark', 'Arthur', 'Gordon', 'Lee', 'Oliver', 'Alex', 'Aaron', 'Tom'],
  lattice: ['Fred', 'Microsoft David', 'Microsoft Mark', 'Google UK English Male', 'Daniel', 'Alex', 'Aaron'],
  helix: ['Alex', 'Aaron', 'Microsoft Guy', 'Microsoft Christopher', 'Microsoft Eric', 'Microsoft Andrew', 'Microsoft Brian', 'Tom', 'Evan', 'Nathan', 'Microsoft Mark', 'Microsoft David', 'Rishi', 'Oliver', 'Google UK English Male'],
  helix_f: ['Allison', 'Ava', 'Susan', 'Tessa', 'Karen', 'Moira', 'Microsoft Jenny', 'Microsoft Aria', 'Microsoft Michelle', 'Microsoft Zira', 'Google UK English Female', 'Google US English', 'Samantha', 'Serena'],
};
const ROLE_FEMALE = { announcer: true, helix_f: true };
const AVOID = { compact: ['announcer'], helix: ['compact'], helix_f: ['announcer'] };
const FEMALE_RE = /female|samantha|karen|moira|tessa|serena|victoria|fiona|veena|allison|\bava\b|susan|zira|hazel|catherine|linda|aria|jenny|libby|sonia|natasha|clara|emma|michelle|joanna|kendra|kimberly|salli|\bivy\b|\bamy\b|nicole|olivia|google us english/i;
const MALE_RE = /\bmale|daniel|\balex\b|\bfred\b|\btom\b|oliver|rishi|aaron|arthur|gordon|\blee\b|david|\bmark\b|george|\bguy\b|ryan|thomas|\beric\b|christopher|brian|andrew|roger|matthew|justin|joey|russell|evan|nathan/i;
const NOVELTY_RE = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|kathy|ralph|princess|deranged|hysterical|grandma|grandpa|rocko|shelley|sandy|\bflo\b|eddy|reed/i;
function scoreVoice(v, role, avoid) {
  const n = v.name || '', ln = n.toLowerCase(), prefs = VOICE_PREFS[role] || [];
  let s = 0; const i = prefs.findIndex((p) => ln.includes(p.toLowerCase())); if (i >= 0) s += 100 - i * 3;
  const fem = FEMALE_RE.test(n), mal = MALE_RE.test(n);
  s += ROLE_FEMALE[role] ? (fem ? 20 : mal ? -25 : 0) : (mal ? 20 : fem ? -25 : 0);
  if (NOVELTY_RE.test(n)) s -= 200;
  if (v.localService) s += 6;
  if (/^en[-_](us|gb|au)/i.test(v.lang || '')) s += 3;
  if (avoid.includes(v)) s -= 30;
  return s;
}
// Web Speech backend. Utterances are kept referenced until they end (Chrome drops onend for collected utterances).
function webSpeech() {
  const ss = G.speechSynthesis, U = G.SpeechSynthesisUtterance;
  if (!ss || !U) return null;
  const keep = new Set();
  return {
    getVoices: () => { try { return ss.getVoices() || []; } catch (e) { return []; } },
    onVoices(fn) { try { ss.addEventListener('voiceschanged', fn); } catch (e) { try { ss.onvoiceschanged = fn; } catch (e2) { /* none */ } } },
    warm() { try { const u = new U(' '); u.volume = 0; ss.speak(u); } catch (e) { /* none */ } },   // unlocks speech inside the Start gesture
    speak(o) {
      let u; try { u = new U(o.text); } catch (e) { return null; }
      if (o.voice) { u.voice = o.voice; u.lang = o.voice.lang; } else u.lang = 'en-US';
      u.pitch = o.pitch; u.rate = o.rate; u.volume = o.volume;
      let fired = false; const end = () => { if (fired) return; fired = true; keep.delete(u); if (o.onend) o.onend(); };
      u.onend = end; u.onerror = end; keep.add(u);
      try {
        if (ss.paused) ss.resume();
        if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(() => { try { ss.speak(u); } catch (e) { end(); } }, 40); } else ss.speak(u);
      } catch (e) { end(); }
      return u;
    },
    cancel() { try { ss.cancel(); } catch (e) { /* none */ } },
  };
}

// ───────────────────────────── engine ─────────────────────────────
export class AudioEngine {
  constructor() {
    this.ctx = null; this._inited = false; this._offline = false; this._muted = false;
    this._vol = { master: 1, sfx: 1, voice: 1, announcer: 1, ui: 1 };
    this._lis = { x: 0, y: 0, vh: 150, h: Math.PI / 2 };
    this._names = Object.create(null); this._all = []; this._vid = 0; this._synthLive = 0;
    this._baked = Object.create(null); this._bakedSec = 0; this._baking = null;
    this._st = { culled: 0, dropped: {}, stolen: {}, played: {} };
    this._subs = []; this._speech = null; this._voicePick = {}; this._voicePref = {};
    this._clock = () => (G.performance ? G.performance.now() : Date.now()) / 1000;
    this._setT = (f, ms) => setTimeout(f, ms); this._clearT = (id) => clearTimeout(id);
    this._sp = { cur: null, queue: [], lastAnn: {}, lastLine: {}, token: 0, waitT: null, watchT: null, gapT: null,
      n: { spoken: 0, announced: 0, unit: 0, rateLimited: 0, stale: 0, dropped: 0, blocked: 0, cancelled: 0 } };
  }

  /** Create the audio graph. opts (all optional): context (an AudioContext or OfflineAudioContext to use), webAudio: false
   *  (no Web Audio), speech (a speech backend, or null for none), clock () => seconds, setTimeout / clearTimeout,
   *  bake (default true for live contexts), raw: true (master straight to the destination: no dynamics; tests only).
   *  Returns true when Web Audio is running. */
  init(opts = NO) {
    if (this._inited) { this.resume(); return !!this.ctx; }
    this._inited = true;
    if (opts.clock) this._clock = opts.clock;
    if (opts.setTimeout) this._setT = opts.setTimeout;
    if (opts.clearTimeout) this._clearT = opts.clearTimeout;
    this._speech = opts.speech !== undefined ? opts.speech || null : webSpeech();
    if (this._speech) { if (this._speech.onVoices) this._speech.onVoices(() => { this._voicePick = {}; }); if (opts.speech === undefined && this._speech.warm) this._speech.warm(); }
    let ctx = opts.context || null;
    if (!ctx && opts.webAudio !== false) {
      const C = G.AudioContext || G.webkitAudioContext;
      if (C) { try { ctx = new C({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new C(); } catch (e2) { ctx = null; } } }
    }
    if (!ctx) return false;
    try { this._build(ctx, opts); } catch (e) { this.ctx = null; return false; }
    if (!this._offline) { this.resume(); if (opts.bake !== false) this._setT(() => this.bake(), 400); }
    return true;
  }
  _build(ctx, opts) {
    this.ctx = ctx; this._offline = typeof ctx.startRendering === 'function';
    this.maxLiveSynth = this._offline ? Infinity : MAX_LIVE_SYNTH;   // offline renders schedule everything up front
    const R = this.R = resources(ctx), Gn = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.master = Gn(this._muted ? 0 : this._vol.master * BASE.master);
    this.bus = {}; for (const k of BUSES) { this.bus[k] = Gn(this._vol[k] * BASE[k]); this.bus[k].connect(this.master); }
    // positional voices are mono up to here and share nine fixed StereoPanners (0.2 pan steps) instead of one each;
    // √2 restores the level a centred mono voice has without a panner
    const panSum = Gn(Math.SQRT2); panSum.connect(this.bus.sfx);
    this.pan = PAN_STEPS.map((v) => { if (!ctx.createStereoPanner) return panSum; const p = ctx.createStereoPanner(); p.pan.value = v; p.connect(panSum); return p; });
    // reverb: generated outdoor IR. Voices send mono, either to the reverb alone or (big guns, explosions) to reverb + echo.
    this.revIn = Gn(1); const conv = ctx.createConvolver(); conv.buffer = R.ir; const revOut = Gn(.55);
    this.revIn.connect(conv); conv.connect(revOut); revOut.connect(this.bus.sfx);
    this.sendBig = Gn(1); const toEcho = Gn(ECHO_OF_SEND); this.sendBig.connect(this.revIn); this.sendBig.connect(toEcho);
    // slap echo off distant terrain: two damped feedback taps, panned apart, also fed into the reverb
    this.echoIn = Gn(1); toEcho.connect(this.echoIn);
    for (const [time, pan] of [[.29, -.55], [.43, .55]]) {
      const d = ctx.createDelay(1), f = ctx.createBiquadFilter(), fb = Gn(.28), toRev = Gn(.4);
      d.delayTime.value = time; f.type = 'lowpass'; f.frequency.value = 1700;
      this.echoIn.connect(d); d.connect(f); f.connect(fb); fb.connect(d); f.connect(toRev); toRev.connect(this.revIn);
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; f.connect(p); p.connect(this.bus.sfx); } else f.connect(this.bus.sfx);
    }
    if (opts.raw) { this.master.connect(ctx.destination); return; }
    // dynamics: gentle glue compressor, fast limiter, then a soft safety clipper. Chrome's compressor adds automatic
    // makeup gain ((1/fullRangeGain)^0.6); the trims after each stage take it back out.
    const comp = ctx.createDynamicsCompressor();
    // Measured (Chrome): unity gain up to ~0.35 at the master, −3.5 dB at 1.0, output ceiling ≈ 0.88 for any input.
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 2.5; comp.attack.value = .006; comp.release.value = .25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .001; lim.release.value = .1;
    const trim1 = Gn(.635), trim2 = Gn(1), pre = Gn(.5), clip = ctx.createWaveShaper(); clip.curve = R.safety;
    this.master.connect(comp); comp.connect(trim1); trim1.connect(lim); lim.connect(trim2); trim2.connect(pre); pre.connect(clip); clip.connect(ctx.destination);
    this._dyn = { comp, lim, trim1, trim2 };
  }
  resume() { const c = this.ctx; if (c && !this._offline && c.state !== 'running' && c.resume) { try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* none */ } } }

  /** camera ground focus (game metres), camera height (m), heading (rad, see the file header) */
  setListener(x, y, viewHeight, headingRad) {
    const L = this._lis;
    if (Number.isFinite(x)) L.x = x; if (Number.isFinite(y)) L.y = y;
    if (Number.isFinite(viewHeight)) L.vh = Math.max(1, viewHeight);
    if (Number.isFinite(headingRad)) L.h = headingRad;
  }
  /** gain / pan / low-pass for a source at (x, y); null when out of earshot */
  _spatial(x, y, rm) {
    const L = this._lis, dx = x - L.x, dy = y - L.y, d = Math.sqrt(dx * dx + dy * dy), R = audibleRadius(L.vh) * rm;
    if (!(d < R)) return null;
    const r0 = R * .28, s = d <= r0 ? 0 : (d - r0) / (R - r0);
    const g = Math.pow(1 - s, 1.7) * clamp(1.08 - (L.vh - 100) / 1500, .7, 1.12);
    const side = dx * Math.sin(L.h) - dy * Math.cos(L.h), pan = clamp(side / Math.max(35, L.vh * .85), -1, 1) * .8;
    return { g, pan, lp: s > .03 ? 1400 + 19000 * Math.pow(1 - s, 2.6) : 0, wet: .7 + 1.3 * s };
  }

  /** play a sound. opts: x, y (game metres; omit for non-positional), vol (multiplier), pitch (multiplier),
   *  delay (s), range (audible-radius multiplier). Returns { name, start, end, stop() } or null (culled / limited / off). */
  sfx(name, opts) {
    const ctx = this.ctx, def = SFX[name];
    if (!ctx || !def || this._muted) return null;
    if (!this._offline && ctx.state !== 'running') { this.resume(); return null; }
    const o = opts || NO, busName = o.bus || def.bus || 'sfx', bus = this.bus[busName] || this.bus.sfx;
    let g = 1, pan = 0, lp = 0, wet = 1;
    if (busName === 'sfx' && typeof o.x === 'number' && typeof o.y === 'number') {
      const s = this._spatial(o.x, o.y, (def.range || 1) * (o.range > 0 ? o.range : 1));
      if (!s) { this._st.culled++; return null; }
      g = s.g; pan = s.pan; lp = s.lp; wet = s.wet;
    }
    let vol = def.vol * g * (o.vol == null ? 1 : clamp(+o.vol || 0, 0, 4));
    if (vol < .003) { this._st.culled++; return null; }
    const st = this._names[name] || (this._names[name] = { last: -1e9, voices: [], peak: 0, lastVar: -1 });
    const baked = this._baked[name];
    if (!baked && this._synthLive >= this.maxLiveSynth) { this._count('dropped', name); return null; }   // CPU guard until a sound is baked
    const now = ctx.currentTime, t0 = now + (this._offline || baked ? 0 : LEAD) + Math.max(0, +o.delay || 0);
    let t = t0;
    if (t - st.last < def.gap) { t = st.last + def.gap; if (t - t0 > (def.lag || 0) + 1e-9) { this._count('dropped', name); return null; } }
    // voice caps: per name (oldest stolen), then global
    const alive = (v) => !v.dead && !v.stolen && v.end > t;   // voices being stolen (40 ms fade) no longer count
    st.voices = st.voices.filter(alive);
    while (st.voices.length >= def.cap) this._steal(st.voices.shift(), t);
    this._all = this._all.filter(alive);
    if (this._all.length >= MAX_VOICES) { let i = this._all.findIndex((v) => v.bus !== 'ui'); if (i < 0) i = 0; const v = this._all.splice(i, 1)[0]; this._steal(v, t); const sv = this._names[v.name]; if (sv) sv.voices = sv.voices.filter((x) => x !== v); }
    st.last = t;
    const rnd = Math.random, pitch = (o.pitch > 0 ? o.pitch : 1) * (1 + (rnd() * 2 - 1) * (def.pj || 0));
    vol *= 1 + (rnd() * 2 - 1) * (def.vj || 0);
    // voice chain (mono): gain → (air low-pass, distant only) → shared pan bus; one mono send to reverb (+ echo)
    const out = ctx.createGain(); out.gain.value = vol;
    const nodes = [out]; let tail = out;
    if (lp > 0 && lp < 9000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = .5; tail.connect(f); tail = f; nodes.push(f); }
    if (busName === 'sfx') {
      tail.connect(this.pan[clamp(Math.round(pan / .2), -4, 4) + 4]);
      if (def.rev) { const sg = ctx.createGain(); sg.gain.value = def.rev * wet; tail.connect(sg); sg.connect(def.echo ? this.sendBig : this.revIn); nodes.push(sg); }
    } else tail.connect(bus);
    let srcs, end;
    if (baked && baked.length) {
      const i = baked.length > 1 ? (st.lastVar + 1 + Math.floor(rnd() * (baked.length - 1))) % baked.length : 0; st.lastVar = i;
      const s = ctx.createBufferSource(); s.buffer = baked[i]; s.playbackRate.value = pitch; s.connect(out); s.start(t);
      end = t + baked[i].duration / pitch; s._stop = end; srcs = [s]; nodes.push(s);
    } else {
      const b = new Synth(ctx, t, rnd, this.R, pitch);
      SYN[name](b, out); srcs = b.srcs; end = b.end; for (const n of b.nodes) nodes.push(n);
    }
    const v = { id: ++this._vid, name, bus: busName, start: t, end, out, srcs, nodes, dead: false, stolen: false, live: !(baked && baked.length) };
    if (v.live) this._synthLive++;
    let last = srcs[0]; for (const s of srcs) if (s._stop > last._stop) last = s;
    if (last) last.onended = () => this._free(v);
    st.voices.push(v); this._all.push(v); if (st.voices.length > st.peak) st.peak = st.voices.length;
    this._count('played', name);
    return { name, start: t, end, stop: () => this._kill(v, this.ctx ? this.ctx.currentTime : t) };
  }
  _count(k, name) { const m = this._st[k]; m[name] = (m[name] || 0) + 1; }
  _kill(v, t) {
    if (!v || v.dead || v.stolen) return false;
    v.stolen = true; t = Math.max(t, v.start);
    try { v.out.gain.setTargetAtTime(0, t, .006); } catch (e) { /* none */ }
    for (const s of v.srcs) { try { s.stop(t + .04); } catch (e) { /* none */ } }
    v.end = Math.min(v.end, t + .04); return true;
  }
  _steal(v, t) { if (this._kill(v, t)) this._count('stolen', v.name); }
  _free(v) { if (v.dead) return; v.dead = true; if (v.live) this._synthLive--; for (const n of v.nodes) { try { n.disconnect(); } catch (e) { /* none */ } } v.nodes.length = 0; v.srcs = []; }

  /** pre-render sounds into buffers (all by default, most-used first). Resolves to the number baked. */
  bake(names) {
    if (this._baking) return this._baking;
    const OC = G.OfflineAudioContext || G.webkitOfflineAudioContext;
    if (!this.ctx || !OC) return Promise.resolve(0);
    const list = (names || BAKE_ORDER).filter((n) => SFX[n] && !this._baked[n]);
    const run = async () => {
      let count = 0;
      for (const name of list) {
        try { const bufs = await this._bakeOne(OC, name); if (bufs) { this._baked[name] = bufs; count++; } } catch (e) { /* stays live */ }
        if (!this._offline) await new Promise((r) => this._setT(r, 0));
      }
      this._baking = null; return count;
    };
    return (this._baking = run());
  }
  async _bakeOne(OC, name) {
    const def = SFX[name], n = Math.max(1, def.n || 1), sr = this.ctx.sampleRate, L = Math.ceil((def.len + .05) * sr);
    const oc = new OC(1, L * n, sr);
    for (let i = 0; i < n; i++) { const o = oc.createGain(); o.connect(oc.destination); SYN[name](new Synth(oc, i * L / sr, mulberry32((hashStr(name) + i * 7919) >>> 0), this.R, 1), o); }
    const buf = await oc.startRendering(), d = buf.getChannelData(0), out = [];
    for (let i = 0; i < n; i++) {
      const a = i * L; let e = Math.min(a + L, d.length) - 1; while (e > a && Math.abs(d[e]) < 2.5e-4) e--;   // −72 dB re full scale
      const len = Math.min(L, e - a + 1 + Math.floor(sr * .005)), nb = this.ctx.createBuffer(1, len, sr), nd = nb.getChannelData(0);
      nd.set(d.subarray(a, a + len));
      const fade = Math.min(len, Math.floor(sr * .008)); for (let k = 0; k < fade; k++) nd[len - 1 - k] *= k / fade;
      out.push(nb); this._bakedSec += len / sr;
    }
    return out;
  }

  // ─────────── speech: announcer + unit voices share one channel; the announcer has priority ───────────
  onSubtitle(fn) { if (typeof fn !== 'function') return () => {}; this._subs.push(fn); return () => { const i = this._subs.indexOf(fn); if (i >= 0) this._subs.splice(i, 1); }; }
  _emit(text, key) { for (const f of this._subs.slice()) { try { f(text, key); } catch (e) { /* listener errors stay out of audio */ } } }
  _speechVol(bus) { return clamp(this._vol.master * this._vol[bus], 0, 1); }
  _canSpeak(bus) { return !!this._speech && !this._muted && this._speechVol(bus) > .01; }

  /** EVA-style announcement. Returns the line text when accepted (queued or playing), null when rate-limited or unknown.
   *  With no speech (or muted) the queue still runs on estimated durations so onSubtitle keeps working. */
  announce(key) {
    const L = ANNOUNCER_LINES[key];
    if (!L || !this._inited) return null;
    const S = this._sp, now = this._clock(), last = S.lastAnn[key];
    if (last != null && now - last < (L.every || 0)) { S.n.rateLimited++; return null; }
    if ((S.cur && S.cur.type === 'ann' && S.cur.key === key) || S.queue.some((q) => q.key === key)) { S.n.rateLimited++; return null; }
    S.lastAnn[key] = now;
    const it = { key, text: L.text, t: now, pri: L.pri || 1 };
    if (it.pri >= 3) { S.n.dropped += S.queue.length; S.queue.length = 0; if (S.cur) this._stopSpeech(); }
    let i = S.queue.length; while (i > 0 && S.queue[i - 1].pri < it.pri) i--;
    S.queue.splice(i, 0, it);
    while (S.queue.length > 4) { let k = 0; for (let j = 1; j < S.queue.length; j++) if (S.queue[j].pri < S.queue[k].pri) k = j; S.queue.splice(k, 1); S.n.dropped++; }
    if (!S.queue.includes(it)) return null;
    if (S.cur && S.cur.type === 'unit') this._stopSpeech();
    this._pump();
    return L.text;
  }
  _pump() {
    const S = this._sp; if (S.cur || S.gapT) return;
    const now = this._clock();
    while (S.queue.length && now - S.queue[0].t > STALE) { S.queue.shift(); S.n.stale++; }
    const it = S.queue.shift(); if (!it) return;
    const tok = ++S.token; S.cur = { type: 'ann', key: it.key, text: it.text, t0: now, tok };
    const audible = this._canSpeak('announcer');
    if (audible) this.sfx('_chirp');
    S.waitT = this._setT(() => {
      S.waitT = null; if (!S.cur || S.cur.tok !== tok) return;
      S.n.announced++; this._emit(it.text, it.key); this._utter(it.text + '.', ANN_STYLE, 'announcer', tok);
    }, audible ? CHIRP_MS : 0);
  }
  _utter(text, style, bus, tok) {
    const S = this._sp, est = estSpeech(text, style.rate), done = () => this._done(tok);
    if (this._canSpeak(bus)) {
      S.n.spoken++;
      this._speech.speak({ text, voice: this._pickVoice(style.role), pitch: style.pitch, rate: style.rate, volume: this._speechVol(bus), onend: done });
      if (S.cur && S.cur.tok === tok) S.watchT = this._setT(done, (est * 2 + 1.5) * 1000);   // onend can go missing
    } else S.watchT = this._setT(done, est * 1000);
  }
  _done(tok) {
    const S = this._sp; if (!S.cur || S.cur.tok !== tok) return;
    this._clearTimers(); const was = S.cur; S.cur = null;
    if (was.type === 'ann') {
      if (this._canSpeak('announcer')) this.sfx('_radio_out');
      S.gapT = this._setT(() => { S.gapT = null; this._pump(); }, GAP_MS);
    }
  }
  _clearTimers() { const S = this._sp; if (S.waitT != null) this._clearT(S.waitT); if (S.watchT != null) this._clearT(S.watchT); S.waitT = S.watchT = null; }
  _stopSpeech() {
    const S = this._sp; if (!S.cur) return;
    S.token++; this._clearTimers(); S.cur = null; S.n.cancelled++;
    if (this._speech) this._speech.cancel();
  }

  /** short spoken acknowledgement. kind: 'select' | 'move' | 'attack'. Returns the line, or null when dropped:
   *  announcer busy or queued, another unit line started < 0.6 s ago (an order line still replaces a select line), or
   *  the same unit is still saying the same kind of line. A later line from another unit / kind replaces the current. */
  unitVoice(uid, kind, faction) {
    if (!this._inited || this._muted) return null;
    const set = linesFor(uid, faction), arr = set && set[kind];
    if (!arr || !arr.length) return null;
    const S = this._sp, now = this._clock();
    if ((S.cur && S.cur.type === 'ann') || S.queue.length || S.gapT) { S.n.blocked++; return null; }
    const c = S.cur;
    if (c) {
      const orderOverSelect = c.kind === 'select' && kind !== 'select';
      if (!orderOverSelect && (now - c.t0 < UNIT_GAP || (c.uid === uid && c.kind === kind))) { S.n.dropped++; return null; }
      this._stopSpeech();
    }
    const fac = FACTION_STYLE[faction] ? faction : (set.faction || 'compact'), k = uid + ':' + kind;
    let i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === S.lastLine[k]) i = (i + 1 + Math.floor(Math.random() * (arr.length - 1))) % arr.length;
    S.lastLine[k] = i;
    const text = arr[i], tok = ++S.token;
    S.cur = { type: 'unit', uid, kind, t0: now, tok, text }; S.n.unit++;
    if (this.ctx) { this.sfx('order_ack', { bus: 'voice', pitch: ACK_PITCH[fac] || 1 }); if (fac === 'lattice') this.sfx('_data', { delay: .05 }); }
    this._utter(text, unitStyle(uid, fac), 'voice', tok);
    return text;
  }

  _pickVoice(role) {
    if (!this._speech || !this._speech.getVoices) return null;
    if (Object.prototype.hasOwnProperty.call(this._voicePick, role)) return this._voicePick[role];
    const all = this._speech.getVoices() || [], en = all.filter((v) => /^en([-_]|$)/i.test(v.lang || '')), pool = en.length ? en : all;
    if (!pool.length) return null;   // voices load asynchronously: try again next time
    const want = this._voicePref[role];
    let pick = want ? pool.find((v) => v.name === want) || pool.find((v) => v.name.toLowerCase().includes(want.toLowerCase())) : null;
    if (!pick) {
      const avoid = (AVOID[role] || []).map((r) => this._pickVoice(r)).filter(Boolean);
      let best = -1e9; for (const v of pool) { const s = scoreVoice(v, role, avoid); if (s > best) { best = s; pick = v; } }
    }
    this._voicePick[role] = pick || null; return pick || null;
  }
  /** force a voice for a role ('announcer' | 'compact' | 'lattice' | 'helix' | 'helix_f') by (part of) its name; null = automatic */
  setVoice(role, name) { this._voicePref[role] = name || null; this._voicePick = {}; }
  voiceFor(role) { const v = this._pickVoice(role); return v ? v.name : null; }
  /** available speech voices [{ name, lang, local }] (English first) */
  voices() { const all = (this._speech && this._speech.getVoices && this._speech.getVoices()) || []; return all.map((v) => ({ name: v.name, lang: v.lang, local: !!v.localService })).sort((a, b) => (/^en/i.test(b.lang) - /^en/i.test(a.lang)) || a.name.localeCompare(b.name)); }

  // ─────────── volume / state ───────────
  /** bus: 'master' | 'sfx' | 'voice' | 'announcer' | 'ui'; v: 0..1 (up to 1.5) */
  setVolume(bus, v) {
    if (!(bus in this._vol)) return;
    v = clamp(+v || 0, 0, 1.5); this._vol[bus] = v;
    if (!this.ctx) return;
    const node = bus === 'master' ? this.master : this.bus[bus], target = bus === 'master' && this._muted ? 0 : v * BASE[bus];
    try { node.gain.setTargetAtTime(target, this.ctx.currentTime, .02); } catch (e) { node.gain.value = target; }
  }
  getVolume(bus) { return this._vol[bus]; }
  mute(m = true) {
    this._muted = !!m;
    if (this.ctx) { const target = this._muted ? 0 : this._vol.master * BASE.master; try { this.master.gain.setTargetAtTime(target, this.ctx.currentTime, .015); } catch (e) { this.master.gain.value = target; } }
    if (this._muted && this._speech && this._sp.cur) {
      if (this._sp.cur.type === 'unit') this._stopSpeech(); else this._speech.cancel();   // announcements finish as subtitles
    }
  }
  get muted() { return this._muted; }
  get ready() { return !!this.ctx; }
  /** live voice counts per name (+ peaks, drops, steals, culls, bake and speech state) */
  stats() {
    const now = this.ctx ? this.ctx.currentTime : 0, live = {}, peak = {}; let total = 0;
    for (const k in this._names) { const st = this._names[k], n = st.voices.filter((v) => !v.dead && v.end > now).length; if (n) { live[k] = n; total += n; } peak[k] = st.peak; }
    const S = this._sp;
    return { live, total, peak, played: { ...this._st.played }, dropped: { ...this._st.dropped }, stolen: { ...this._st.stolen }, culled: this._st.culled,
      baked: Object.keys(this._baked).length, bakedSeconds: +this._bakedSec.toFixed(2), state: this.ctx ? this.ctx.state : 'none', muted: this._muted,
      speech: { current: S.cur ? { type: S.cur.type, key: S.cur.key || null, uid: S.cur.uid || null, kind: S.cur.kind || null, text: S.cur.text } : null, queue: S.queue.map((q) => q.key), ...S.n } };
  }
}

/** a fresh, independent engine (tests, tools) */
export function createAudio() { return new AudioEngine(); }
/** the game's engine */
export const Audio = new AudioEngine();
export default Audio;
