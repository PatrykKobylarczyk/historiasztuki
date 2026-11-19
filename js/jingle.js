// Autorski dżingiel „Historia kultury" — syntezowany w czystym JS (bez plików audio).
// Ten sam kod działa w przeglądarce (AudioBuffer) i w Node (skrypt generujący MP3).
// Motyw: fortepian, smyczki, delikatny akcent dętych — w duchu radiowej audycji kulturalnej.

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

// Dżingiel otwierający (~7,5 s). Tonacja D-dur: D – h – G – A – D.
export function renderJingle(sr = 44100) {
  const len = Math.floor(7.6 * sr);
  const b = new Float32Array(len);
  // Fortepian: wznoszący się motyw i odpowiedź
  const motif = [
    [0.0, 62, 0.35], [0.28, 66, 0.35], [0.56, 69, 0.35], [0.84, 74, 0.7],
    [1.7, 73, 0.3], [1.98, 71, 0.3], [2.26, 69, 0.55],
    [3.0, 67, 0.3], [3.28, 71, 0.3], [3.56, 74, 0.55],
    [4.3, 76, 0.3], [4.58, 73, 0.3], [4.86, 78, 1.6],
  ];
  motif.forEach(([t, m, d], i) => piano(b, sr, t, m, d, i === motif.length - 1 ? 1 : 0.85));
  // Bas fortepianu
  [[0, 38], [1.7, 47], [3.0, 43], [4.3, 45], [4.86, 38]].forEach(([t, m]) => piano(b, sr, t, m, 1.2, 0.7));
  // Smyczki — harmonia
  strings(b, sr, 0.0, [62, 66, 69], 1.6, 0.6);
  strings(b, sr, 1.7, [59, 62, 66], 1.2, 0.6);
  strings(b, sr, 3.0, [55, 59, 62], 1.2, 0.6);
  strings(b, sr, 4.3, [57, 61, 64], 0.5, 0.6);
  strings(b, sr, 4.86, [50, 57, 62, 66, 69], 1.7, 0.75);
  // Dęte — akcent na finałowym akordzie
  brass(b, sr, 4.86, [62, 66, 69], 1.2, 0.45);
  return normalize(reverb(b, sr));
}

// Krótki sygnał zamykający (~3,5 s): kadencja A – D.
export function renderOutro(sr = 44100) {
  const len = Math.floor(3.8 * sr);
  const b = new Float32Array(len);
  [[0, 69, 0.3], [0.25, 73, 0.3], [0.5, 76, 0.3], [0.8, 74, 1.4]].forEach(([t, m, d]) => piano(b, sr, t, m, d, 0.85));
  piano(b, sr, 0.8, 50, 1.4, 0.7);
  strings(b, sr, 0, [57, 61, 64], 0.7, 0.55);
  strings(b, sr, 0.8, [50, 57, 62, 66], 1.5, 0.7);
  return normalize(reverb(b, sr));
}

// Krótki przerywnik między rozdziałami (~1,4 s).
export function renderSting(sr = 44100) {
  const b = new Float32Array(Math.floor(1.8 * sr));
  piano(b, sr, 0, 74, 0.25, 0.6);
  piano(b, sr, 0.18, 78, 0.25, 0.6);
  piano(b, sr, 0.36, 81, 0.6, 0.7);
  strings(b, sr, 0, [62, 66, 69], 0.6, 0.35);
  return normalize(reverb(b, sr), 0.5);
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
