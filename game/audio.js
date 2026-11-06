/* Thunderhead audio — synthesised SFX (Web Audio) and generated voices (SpeechSynthesis). Global out: AUDIO. */
const AUDIO = (() => {
'use strict';
const A = { ctx: null, master: null, enabled: true, voices: true, lastVoice: 0, lastSfx: {}, queue: [], speaking: false, music: null };
function start() { if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; } try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); A.master = A.ctx.createGain(); A.master.gain.value = 0.5; A.master.connect(A.ctx.destination); A.noise = makeNoise(); } catch (e) { A.ctx = null; } }
function makeNoise() { const len = A.ctx.sampleRate * 1.5, buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return buf; }
function env(node, t0, a, d, s, r, peak = 1) { const g = A.ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t0 + a + d); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + r); node.connect(g); return g; }
function throttle(key, ms) { const now = performance.now(); if (A.lastSfx[key] && now - A.lastSfx[key] < ms) return false; A.lastSfx[key] = now; return true; }
function out() { if (!A.ctx.createStereoPanner) return A.master; const p = A.ctx.createStereoPanner(); p.pan.value = A.pan || 0; p.connect(A.master); return p; }
const vary = f => f * (1 + ((Math.random() - 0.5) * 2) * (A.vary || 0));
function noiseBurst(t0, dur, freq, q, vol, type = 'bandpass') { const src = A.ctx.createBufferSource(); src.buffer = A.noise; const f = A.ctx.createBiquadFilter(); f.type = type; f.frequency.value = vary(freq); f.Q.value = q; src.connect(f); const g = env(f, t0, 0.005, dur * 0.4, 0.3, dur * 0.6, vol); g.connect(out()); src.start(t0); src.stop(t0 + dur + 0.1); }
function tone(t0, freq, endFreq, dur, type, vol) { const o = A.ctx.createOscillator(); o.type = type; const v = vary(1); o.frequency.setValueAtTime(freq * v, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq * v), t0 + dur); const g = env(o, t0, 0.005, dur * 0.5, 0.4, dur * 0.5, vol); g.connect(out()); o.start(t0); o.stop(t0 + dur + 0.1); }
function sfx(name, dist = 0, pan = 0) {
  if (!A.ctx || !A.enabled) return; const vol = Math.max(0, 1 - dist / 1400); if (vol <= 0) return; const t = A.ctx.currentTime; A.pan = Math.max(-1, Math.min(1, pan)); A.vary = /^(SA|HE|AP|ROCKET|FLAK|SIEGE|explode|bigexplode|crush)$/.test(name) ? 0.08 : 0;
  switch (name) {
    case 'SA': if (!throttle('SA', 70)) return; noiseBurst(t, 0.08, 1800, 1.2, 0.25 * vol, 'highpass'); tone(t, 420, 160, 0.05, 'square', 0.08 * vol); break;
    case 'HE': if (!throttle('HE', 90)) return; tone(t, 220, 70, 0.14, 'triangle', 0.35 * vol); noiseBurst(t, 0.18, 700, 0.8, 0.3 * vol, 'lowpass'); break;
    case 'AP': if (!throttle('AP', 90)) return; tone(t, 150, 40, 0.2, 'sawtooth', 0.45 * vol); noiseBurst(t, 0.25, 500, 0.6, 0.4 * vol, 'lowpass'); break;
    case 'ROCKET': if (!throttle('ROCKET', 120)) return; noiseBurst(t, 0.45, 900, 0.7, 0.3 * vol, 'bandpass'); tone(t, 900, 300, 0.35, 'sawtooth', 0.08 * vol); break;
    case 'FLAK': if (!throttle('FLAK', 60)) return; noiseBurst(t, 0.07, 2400, 2, 0.22 * vol, 'bandpass'); break;
    case 'BEAM': if (!throttle('BEAM', 100)) return; tone(t, 1600, 2600, 0.18, 'sine', 0.2 * vol); tone(t, 800, 1200, 0.18, 'square', 0.05 * vol); break;
    case 'EMP': if (!throttle('EMP', 150)) return; tone(t, 60, 900, 0.5, 'sine', 0.3 * vol); break;
    case 'HACK': if (!throttle('HACK', 150)) return; for (let i = 0; i < 6; i++) tone(t + i * 0.05, 600 + i * 150, 600 + i * 150, 0.04, 'square', 0.12 * vol); break;
    case 'TOXIN': if (!throttle('TOXIN', 150)) return; noiseBurst(t, 0.5, 3000, 0.5, 0.15 * vol, 'highpass'); break;
    case 'SIEGE': if (!throttle('SIEGE', 150)) return; tone(t, 90, 30, 0.4, 'sawtooth', 0.5 * vol); noiseBurst(t, 0.5, 300, 0.5, 0.5 * vol, 'lowpass'); break;
    case 'explode': if (!throttle('explode', 60)) return; noiseBurst(t, 0.5, 400, 0.4, 0.6 * vol, 'lowpass'); tone(t, 120, 30, 0.45, 'sine', 0.5 * vol); break;
    case 'bigexplode': noiseBurst(t, 1.2, 250, 0.3, 0.9 * vol, 'lowpass'); tone(t, 80, 20, 1.0, 'sine', 0.8 * vol); noiseBurst(t + 0.1, 0.6, 1500, 0.5, 0.3 * vol, 'highpass'); break;
    case 'crush': noiseBurst(t, 0.2, 200, 0.8, 0.35 * vol, 'lowpass'); break;
    case 'click': tone(t, 1200, 900, 0.03, 'square', 0.08); break;
    case 'select': tone(t, 700, 1000, 0.05, 'sine', 0.1); break;
    case 'order': tone(t, 500, 750, 0.06, 'triangle', 0.1); break;
    case 'ready': tone(t, 660, 660, 0.08, 'sine', 0.15); tone(t + 0.1, 880, 880, 0.12, 'sine', 0.15); break;
    case 'place': noiseBurst(t, 0.3, 300, 0.7, 0.3, 'lowpass'); tone(t, 200, 80, 0.3, 'triangle', 0.2); break;
    case 'sell': for (let i = 0; i < 5; i++) tone(t + i * 0.06, 1200 + i * 200, 1200 + i * 200, 0.05, 'sine', 0.1); break;
    case 'cash': tone(t, 1500, 1500, 0.04, 'sine', 0.08); tone(t + 0.05, 2000, 2000, 0.06, 'sine', 0.08); break;
    case 'alarm': for (let i = 0; i < 3; i++) tone(t + i * 0.22, 880, 440, 0.18, 'square', 0.12); break;
    case 'lowpower': tone(t, 300, 150, 0.4, 'sawtooth', 0.15); break;
    case 'promote': for (let i = 0; i < 3; i++) tone(t + i * 0.08, 600 + i * 200, 600 + i * 200, 0.1, 'triangle', 0.15); break;
  }
}
// voices: speech synthesis with a per-unit timbre; one unit line at a time, announcer lines queue
const voiceParams = (id, kind) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; if (kind === 'announcer') return { pitch: id === 'lattice' ? 1.3 : id === 'compact' ? 0.55 : 1.0, rate: id === 'lattice' ? 1.05 : id === 'compact' ? 0.85 : 1.0 }; const machine = /^lat_/.test(id); return { pitch: machine ? 1.4 + (h % 5) * 0.1 : 0.6 + (h % 9) * 0.1, rate: 0.95 + (h % 4) * 0.1 }; };
function say(text, id, kind) {
  if (!A.voices || !('speechSynthesis' in window)) return; const now = performance.now();
  if (kind !== 'announcer' && now - A.lastVoice < 1500) return; if (kind !== 'announcer') A.lastVoice = now;
  try { const u = new SpeechSynthesisUtterance(text); const p = voiceParams(id, kind); u.pitch = p.pitch; u.rate = p.rate; u.volume = kind === 'announcer' ? 1 : 0.8; const vs = speechSynthesis.getVoices(); const en = vs.filter(v => /^en/.test(v.lang)); if (en.length) u.voice = en[(id.length * 7) % en.length]; if (kind !== 'announcer') speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
}
function announce(text, faction) { say(text, faction, 'announcer'); }
return { A, start, sfx, say, announce };
})();
