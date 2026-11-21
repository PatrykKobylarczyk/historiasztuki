// Autorski dżingiel KULTURA — syntezowany w czystym JS (bez plików audio).
// Ten sam kod działa w przeglądarce (AudioBuffer) i w Node (skrypt generujący MP3).
// Motyw: żwawa polka orkiestry rozrywkowej (akordeon, trąbka, tuba, werbel) — w duchu klasycznych sygnałów radiowych.

// Zmiana wersji wymusza ponowne nagranie MP3 z nowym dżinglem.
export const JINGLE_VERSION = "symfonia-2";

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function piano(out, sr, start, midi, dur, vel) {
  const f = midiToHz(midi);
  const i0 = Math.floor(start * sr);
  const n = Math.floor((dur + 1.6) * sr);
  const partials = [1, 0.55, 0.32, 0.18, 0.1, 0.06];
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const att = Math.min(1, t / 0.004);
    const rel = t > dur ? Math.exp(-(t - dur) * 6) : 1;
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const h = k + 1;
      const fk = f * h * (1 + 0.0004 * h * h); // lekka nieharmoniczność struny
      s += partials[k] * Math.exp(-t * (1.2 + h * 0.9)) * Math.sin(2 * Math.PI * fk * t);
    }
    out[i0 + i] += s * att * rel * vel * 0.22;
  }
}

function strings(out, sr, start, midis, dur, vel) {
  const i0 = Math.floor(start * sr);
  const n = Math.floor((dur + 1.2) * sr);
  const voices = [];
  midis.forEach((m) => [-0.08, 0, 0.07].forEach((d) => voices.push({ f: midiToHz(m + d / 1), ph: Math.random() })));
  let lp = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.9) * (t > dur ? Math.exp(-(t - dur) * 2.5) : 1);
    let s = 0;
    for (const v of voices) {
      const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5.2 * t + v.ph * 6);
      const ph = (v.f * vib * t + v.ph) % 1;
      s += 2 * ph - 1; // piła
    }
    s /= voices.length;
    lp += 0.06 * (s - lp); // filtr dolnoprzepustowy — miękka barwa smyczków
    out[i0 + i] += lp * env * vel * 0.5;
  }
}

function brass(out, sr, start, midis, dur, vel) {
  const i0 = Math.floor(start * sr);
  const n = Math.floor((dur + 0.8) * sr);
  let lp = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.12) * (t > dur ? Math.exp(-(t - dur) * 4) : 1);
    const cut = 0.02 + 0.1 * Math.exp(-t * 3) * env;
    let s = 0;
    for (const m of midis) s += 2 * ((midiToHz(m) * t) % 1) - 1;
    s /= midis.length;
    lp += cut * (s - lp);
    out[i0 + i] += lp * env * vel * 0.55;
  }
}

function reverb(buf, sr, mix = 0.28) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: Math.floor(d * sr / 44100), b: null, i: 0, fb: 0.78 }));
  combs.forEach((c) => (c.b = new Float32Array(c.d)));
  const aps = [225, 556].map((d) => ({ d: Math.floor(d * sr / 44100), b: null, i: 0 }));
  aps.forEach((a) => (a.b = new Float32Array(a.d)));
  const out = new Float32Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n];
    let y = 0;
    for (const c of combs) {
      const v = c.b[c.i];
      c.b[c.i] = x + v * c.fb;
      c.i = (c.i + 1) % c.d;
      y += v;
    }
    y /= combs.length;
    for (const a of aps) {
      const v = a.b[a.i];
      const w = y + v * 0.5;
      a.b[a.i] = w;
      a.i = (a.i + 1) % a.d;
      y = v - 0.5 * w;
    }
    out[n] = x * (1 - mix) + y * mix;
  }
  return out;
}

function normalize(buf, peak = 0.85) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / m) * peak;
  // łagodne wyciszenie końcówki
  const fade = Math.floor(buf.length * 0.08);
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
  return buf;
}

// ---- Instrumenty orkiestry rozrywkowej (polka) ----
function accordion(out, sr, start, midis, dur, vel) {
  const i0 = Math.floor(start * sr);
  const n = Math.floor((dur + 0.08) * sr);
  const reeds = [];
  midis.forEach((m) => [-4, 4].forEach((c) => reeds.push(midiToHz(m) * Math.pow(2, c / 1200)))); // dwa stroiki: musette
  let lp = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.012) * (t > dur ? Math.exp(-(t - dur) * 40) : 1);
    let s = 0;
    for (const f of reeds) { const ph = (f * t) % 1; s += (ph < 0.32 ? 1 : -0.47) + 0.4 * (2 * ph - 1); }
    s /= reeds.length;
    lp += 0.28 * (s - lp);
    out[i0 + i] += lp * env * vel * 0.32;
  }
}

function trumpet(out, sr, start, midi, dur, vel) {
  const f = midiToHz(midi);
  const i0 = Math.floor(start * sr);
  const n = Math.floor((dur + 0.12) * sr);
  let lp = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.018) * (t > dur ? Math.exp(-(t - dur) * 30) : 1);
    const vib = 1 + (t > 0.18 ? 0.004 * Math.sin(2 * Math.PI * 5.5 * t) : 0);
    const ph = (f * vib * t) % 1;
    const cut = 0.12 + 0.25 * Math.exp(-t * 14);
    lp += cut * ((2 * ph - 1) - lp);
    out[i0 + i] += lp * env * vel * 0.5;
  }
}

function tuba(out, sr, start, midi, dur, vel) {
  const f = midiToHz(midi);
  const i0 = Math.floor(start * sr);
  const n = Math.floor((dur + 0.1) * sr);
  let lp = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.015) * Math.exp(-t * 3.5) * (t > dur ? Math.exp(-(t - dur) * 25) : 1);
    const ph = (f * t) % 1;
    lp += 0.06 * ((2 * ph - 1) - lp);
    out[i0 + i] += (lp * 0.8 + 0.5 * Math.sin(2 * Math.PI * f * t)) * env * vel * 0.6;
  }
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function snare(out, sr, start, vel) {
  const i0 = Math.floor(start * sr);
  const n = Math.floor(0.14 * sr);
  let prev = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / sr;
    const x = rnd();
    const hp = x - prev; prev = x; // jasny szum — werbel / talerzyk
    out[i0 + i] += (hp * 0.6 + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 32) * vel * 0.22;
  }
}

// Akompaniament „um-pa”: bas na mocnych częściach, akord akordeonu na słabych.
function oompah(b, sr, t0, beat, bars) {
  bars.forEach(([root, fifth, chord], k) => {
    const t = t0 + k * 2 * beat;
    tuba(b, sr, t, root, beat * 0.45, 1);
    accordion(b, sr, t + beat * 0.5, chord, beat * 0.3, 0.7);
    snare(b, sr, t + beat * 0.5, 0.8);
    tuba(b, sr, t + beat, fifth, beat * 0.45, 0.85);
    accordion(b, sr, t + beat * 1.5, chord, beat * 0.3, 0.7);
    snare(b, sr, t + beat * 1.5, 0.8);
  });
}

// Dżingiel otwierający (~7 s): autorska, żwawa polka w duchu radiowych sygnałów lat 70.
// Orkiestra rozrywkowa: trąbka i akordeon prowadzą melodię, tuba i akordeon grają „um-pa”, werbel na słabych częściach. G-dur, 2/4.
export function renderJingle(sr = 44100) {
  seed = 7;
  const beat = 0.4, e = beat / 2;
  const len = Math.floor(8.4 * sr);
  const b = new Float32Array(len);
  const t0 = 0.05;
  // melodia: [ósemka startu, midi, długość w ósemkach]
  const mel = [
    [0, 74, 1], [1, 71, 1], [2, 67, 1], [3, 71, 1],
    [4, 74, 2], [6, 76, 1], [7, 74, 1],
    [8, 72, 1], [9, 69, 1], [10, 66, 1], [11, 69, 1],
    [12, 72, 2], [14, 74, 1], [15, 72, 1],
    [16, 71, 1], [17, 74, 1], [18, 79, 1], [19, 74, 1],
    [20, 76, 1], [21, 72, 1], [22, 69, 1], [23, 72, 1],
    [24, 74, 1], [25, 78, 1], [26, 81, 1], [27, 78, 1],
    [28, 79, 1], [29, 74, 1], [30, 79, 2],
  ];
  mel.forEach(([s, m, d]) => {
    const t = t0 + s * e, dur = d * e * 0.82;
    trumpet(b, sr, t, m, dur, 0.9);
    accordion(b, sr, t, [m + 12], dur, 0.35);
  });
  const G = [67, 71, 74], D = [66, 69, 72], C = [64, 67, 72];
  oompah(b, sr, t0, beat, [[43, 50, G], [43, 50, G], [38, 45, D], [38, 45, D], [43, 50, G], [36, 43, C], [38, 45, D], [43, 50, G]]);
  // finał: „pa-pam!” całą orkiestrą
  const tf = t0 + 32 * e;
  accordion(b, sr, tf, [62, 66, 69, 72], e * 0.9, 1.4);
  trumpet(b, sr, tf, 78, e * 0.9, 1);
  tuba(b, sr, tf, 38, e * 0.9, 1.1);
  snare(b, sr, tf, 1.2);
  accordion(b, sr, tf + beat, [67, 71, 74, 79], 0.75, 1.1);
  trumpet(b, sr, tf + beat, 79, 0.75, 1);
  trumpet(b, sr, tf + beat, 83, 0.75, 0.5);
  tuba(b, sr, tf + beat, 31, 0.8, 1.1);
  snare(b, sr, tf + beat, 1.5);
  return normalize(reverb(b, sr, 0.14));
}

// Krótki sygnał zamykający (~2,5 s): kadencja D7 – G w rytmie polki.
export function renderOutro(sr = 44100) {
  seed = 11;
  const beat = 0.4, e = beat / 2;
  const b = new Float32Array(Math.floor(2.6 * sr));
  [[0, 78], [1, 81], [2, 78], [3, 74]].forEach(([s, m]) => { trumpet(b, sr, s * e, m, e * 0.8, 0.85); accordion(b, sr, s * e, [m], e * 0.8, 0.3); });
  oompah(b, sr, 0, beat, [[38, 45, [66, 69, 72]]]);
  const tf = 4 * e;
  accordion(b, sr, tf, [67, 71, 74, 79], 0.7, 1.1);
  trumpet(b, sr, tf, 79, 0.7, 1);
  tuba(b, sr, tf, 31, 0.8, 1.1);
  snare(b, sr, tf, 1.4);
  return normalize(reverb(b, sr, 0.14));
}

// Krótki przerywnik między rozdziałami (~1 s): trzy nuty akordeonu i trąbki.
export function renderSting(sr = 44100) {
  seed = 3;
  const e = 0.17;
  const b = new Float32Array(Math.floor(1.2 * sr));
  [[0, 74, 1], [1, 78, 1], [2, 79, 2.2]].forEach(([s, m, d]) => { trumpet(b, sr, s * e, m, d * e * 0.8, 0.7); accordion(b, sr, s * e, [m - 12, m], d * e * 0.8, 0.4); });
  tuba(b, sr, 2 * e, 43, 0.3, 0.8);
  snare(b, sr, 2 * e, 0.8);
  return normalize(reverb(b, sr, 0.12), 0.5);
}

// Zapis do WAV (16 bit mono) — używane przez skrypt w Node.
export function toWav(samples, sr = 44100) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Uint8Array(buf);
}
