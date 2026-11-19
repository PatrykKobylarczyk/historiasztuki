// Synteza mowy w przeglądarce (Web Speech API) — każdy ekspert dostaje inny głos.
import { store } from "./store.js";

let voicesCache = [];

export function ttsSupported() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

let voicesPromise = null;
export function loadVoices() {
  // lista głosów bywa ładowana asynchronicznie; czekamy tylko raz
  if (voicesPromise) {
    if (ttsSupported()) voicesCache = speechSynthesis.getVoices().filter((v) => /^pl(-|_|$)/i.test(v.lang));
    return voicesPromise;
  }
  return (voicesPromise = new Promise((resolve) => {
    if (!ttsSupported()) return resolve([]);
    const pick = () => {
      voicesCache = speechSynthesis.getVoices().filter((v) => /^pl(-|_|$)/i.test(v.lang));
      return voicesCache;
    };
    if (pick().length) return resolve(voicesCache);
    let done = false;
    speechSynthesis.addEventListener("voiceschanged", () => { if (!done) { done = true; resolve(pick()); } }, { once: true });
    setTimeout(() => { if (!done) { done = true; resolve(pick()); } }, 1500);
  }));
}

export function polishVoices() { return voicesCache; }

// Ocena jakości głosu: naturalne/neuronowe głosy (Edge „Online (Natural)”, Google, iOS „Premium/Enhanced”) na górę
function quality(v) {
  const n = v.name.toLowerCase();
  let q = 0;
  if (/natural|neural|online/.test(n)) q += 5;
  if (/premium|enhanced|ulepsz|rozszerz/.test(n)) q += 4;
  if (/google/.test(n)) q += 3;
  if (!v.localService) q += 1;
  return q;
}

const FEMALE = /zosia|zofia|agnieszka|paulina|ewa|maja|female|kobieta|ola|natalia|marta|anna|alicja|gosia/i;
const MALE = /marek|krzysztof|adam|jacek|jan|male|mężczyzna|tomasz|piotr|wojciech|kuba|jakub/i;

export function guessGender(v) {
  if (FEMALE.test(v.name)) return "f";
  if (MALE.test(v.name)) return "m";
  return "?";
}

// Automatyczny przydział głosów: rotacja po dostępnych głosach z uwzględnieniem płci eksperta,
// a gdy głosów jest mało — różnicujemy wysokość (pitch) i tempo.
export function voiceFor(spKey, speakers) {
  const saved = store.get("voiceMap", {});
  if (saved[spKey]) {
    const v = voicesCache.find((x) => x.voiceURI === saved[spKey]);
    if (v) return v;
  }
  if (!voicesCache.length) return null;
  const sorted = [...voicesCache].sort((a, b) => quality(b) - quality(a));
  const keys = Object.keys(speakers);
  const idx = keys.indexOf(spKey);
  const want = speakers[spKey]?.gender;
  const byGender = sorted.filter((v) => guessGender(v) === want);
  const pool = byGender.length ? byGender : sorted;
  // eksperci tej samej płci rozkładają się po kolejnych głosach
  const sameGender = keys.filter((k) => speakers[k].gender === want);
  return pool[sameGender.indexOf(spKey) % pool.length] || sorted[idx % sorted.length];
}

export function speakerVoiceParams(spKey, speakers) {
  const sp = speakers[spKey] || {};
  const voice = voiceFor(spKey, speakers);
  // jeśli kilku ekspertów dzieli ten sam głos — różnicuj wysokość
  let pitch = sp.pitch ?? 1;
  const custom = store.get("pitchMap", {});
  if (custom[spKey] != null) pitch = custom[spKey];
  return { voice, pitch, rate: sp.rate ?? 1 };
}

export function speak(text, { voice, pitch = 1, rate = 1 }, handlers = {}) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang || "pl-PL";
  if (voice) u.voice = voice;
  u.pitch = Math.max(0.1, Math.min(2, pitch));
  u.rate = Math.max(0.5, Math.min(2, rate));
  u.onend = () => handlers.onend?.();
  u.onerror = (e) => handlers.onerror?.(e);
  u.onboundary = (e) => handlers.onboundary?.(e);
  speechSynthesis.speak(u);
  return u;
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}
