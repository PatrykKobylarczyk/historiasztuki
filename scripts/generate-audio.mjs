// Generuje nagrania MP3 lekcji z naturalnymi głosami (każdy ekspert innym głosem) + dżingle.
// Aplikacja sama wykryje plik audio/NNN.json i zamiast syntezy w przeglądarce odtworzy nagranie
// (działa wtedy przy zgaszonym ekranie i przez Bluetooth/CarPlay/Android Auto jak zwykły podcast).
//
// Użycie:
//   OPENAI_API_KEY=... node scripts/generate-audio.mjs             # wszystkie gotowe lekcje
//   OPENAI_API_KEY=... node scripts/generate-audio.mjs 1 2 186     # wybrane odcinki
//   TTS_PROVIDER=google GOOGLE_TTS_API_KEY=... node scripts/generate-audio.mjs
//   --force  — wygeneruj ponownie, nawet jeśli tekst się nie zmienił
// Wymaga: Node 18+, ffmpeg w PATH.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildItems } from "../js/items.js";
import { renderJingle, renderOutro, renderSting } from "../js/jingle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SR = 24000;
const PROVIDER = process.env.TTS_PROVIDER || (process.env.GOOGLE_TTS_API_KEY && !process.env.OPENAI_API_KEY ? "google" : "openai");
const BITRATE = process.env.MP3_BITRATE || "48k";
const cacheDir = path.join(root, ".audio-cache");
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(path.join(root, "audio"), { recursive: true });

// Głosy ekspertów. Można nadpisać plikiem data/tts-voices.json: { "openai": {...}, "google": {...} }
const VOICES = {
  openai: { gospodarz: "onyx", historyk: "ash", sztuka: "coral", architekt: "echo", muzyka: "verse", literatura: "sage", design: "nova", foto: "ballad" },
  google: { gospodarz: "pl-PL-Wavenet-B", historyk: "pl-PL-Wavenet-C", sztuka: "pl-PL-Wavenet-A", architekt: "pl-PL-Standard-B", muzyka: "pl-PL-Standard-C", literatura: "pl-PL-Wavenet-D", design: "pl-PL-Wavenet-E", foto: "pl-PL-Standard-E" },
};
const override = path.join(root, "data", "tts-voices.json");
if (fs.existsSync(override)) Object.assign(VOICES[PROVIDER], JSON.parse(fs.readFileSync(override, "utf8"))[PROVIDER] || {});
const speakers = JSON.parse(fs.readFileSync(path.join(root, "data", "speakers.json"), "utf8"));

const STYLE = {
  gospodarz: "Ciepły, spokojny głos prowadzącego audycję w Polskim Radiu. Wyraźna dykcja, naturalne pauzy.",
  default: "Mówisz po polsku jako ekspert w audycji radiowej: rzeczowo, z pasją, spokojnym tempem, naturalnie — jak wykład dla słuchacza jadącego samochodem.",
};

// ---------- dostawcy TTS (zwracają Int16Array PCM 24 kHz mono) ----------
async function ttsOpenAI(text, sp) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: VOICES.openai[sp] || "alloy",
      input: text,
      instructions: `${STYLE[sp] || STYLE.default} Język: polski.`,
      response_format: "pcm",
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const b = Buffer.from(await r.arrayBuffer());
  return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
}

async function ttsGoogle(text, sp) {
  const name = VOICES.google[sp] || "pl-PL-Wavenet-B";
  const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "pl-PL", name },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: SR, pitch: 0, speakingRate: speakers[sp]?.rate || 1 },
    }),
  });
  if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const wav = Buffer.from((await r.json()).audioContent, "base64");
  // wyciągnij blok „data” z pliku WAV
  let p = 12;
  while (p < wav.length - 8) {
    const id = wav.toString("ascii", p, p + 4), size = wav.readUInt32LE(p + 4);
    if (id === "data") { const d = wav.subarray(p + 8, p + 8 + size); return new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length)); }
    p += 8 + size;
  }
  throw new Error("Google: brak danych audio");
}

// „test”: cisza o długości mowy — do sprawdzenia całego procesu bez klucza API
async function ttsTest(text) { return new Int16Array(Math.round((SR * text.length) / 15)); }
VOICES.test = Object.fromEntries(Object.keys(speakers).map((k) => [k, k]));
const tts = PROVIDER === "google" ? ttsGoogle : PROVIDER === "test" ? ttsTest : ttsOpenAI;
const voiceId = (sp) => `${PROVIDER}:${VOICES[PROVIDER][sp]}`;

async function clip(text, sp) {
  const key = crypto.createHash("sha1").update(`${voiceId(sp)}|${process.env.OPENAI_TTS_MODEL || ""}|${STYLE[sp] || STYLE.default}|${text}`).digest("hex");
  const f = path.join(cacheDir, `${key}.pcm`);
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return new Int16Array(b.buffer, b.byteOffset, b.length >> 1); }
  for (let attempt = 1; ; attempt++) {
    try {
      const pcm = await tts(text, sp);
      fs.writeFileSync(f, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      return pcm;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}

const toInt16 = (f32) => Int16Array.from(f32, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
const FX = { jingle: toInt16(renderJingle(SR)), outro: toInt16(renderOutro(SR)), sting: toInt16(renderSting(SR)) };
const silence = (ms) => new Int16Array(Math.round((SR * ms) / 1000));

// te same przerwy co w odtwarzaczu przeglądarkowym
function gapAfter(it, next) {
  if (it.kind !== "speech") return it.kind === "sting" ? 250 : 400;
  if (!next) return 0;
  return next.kind !== "speech" ? 500 : next.sp !== it.sp ? 650 : next.si !== it.si ? 350 : 120;
}

async function pool(tasks, n = 4) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

async function generate(n) {
  const id = String(n).padStart(3, "0");
  const lesson = JSON.parse(fs.readFileSync(path.join(root, "data", "lessons", `${id}.json`), "utf8"));
  const items = buildItems(lesson);
  const hash = crypto.createHash("sha1").update(JSON.stringify({ items, v: Object.values(VOICES[PROVIDER]) })).digest("hex").slice(0, 12);
  const manifestPath = path.join(root, "audio", `${id}.json`);
  if (!process.argv.includes("--force") && fs.existsSync(manifestPath) && JSON.parse(fs.readFileSync(manifestPath, "utf8")).hash === hash) {
    console.log(`Odcinek ${n}: bez zmian, pomijam.`);
    return;
  }
  console.log(`Odcinek ${n}: ${items.length} elementów, synteza (${PROVIDER})…`);
  let done = 0;
  const clips = await pool(items.map((it) => async () => {
    const pcm = it.kind === "speech" ? await clip(it.text, it.sp) : FX[it.kind];
    if (++done % 25 === 0) process.stdout.write(`  ${done}/${items.length}\n`);
    return pcm;
  }));
  const parts = [], starts = [];
  let total = 0;
  items.forEach((it, i) => {
    starts.push(+(total / SR).toFixed(3));
    const g = silence(gapAfter(it, items[i + 1]));
    parts.push(clips[i], g);
    total += clips[i].length + g.length;
  });
  const pcm = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
  const raw = path.join(cacheDir, `${id}.raw`);
  fs.writeFileSync(raw, pcm);
  const file = `${id}-${hash.slice(0, 6)}.mp3`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(SR), "-ac", "1", "-i", raw,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1", "-b:a", BITRATE,
    "-metadata", `title=${n}. ${lesson.title}`, "-metadata", "artist=Akademia Kultury i Sztuki", "-metadata", "album=Historia kultury",
    path.join(root, "audio", file)]);
  fs.unlinkSync(raw);
  // usuń poprzednie wersje nagrania tego odcinka
  for (const f of fs.readdirSync(path.join(root, "audio"))) if (f.startsWith(`${id}-`) && f.endsWith(".mp3") && f !== file) fs.unlinkSync(path.join(root, "audio", f));
  const duration = +(total / SR).toFixed(3);
  fs.writeFileSync(manifestPath, JSON.stringify({ file, hash, provider: PROVIDER, duration, starts }));
  console.log(`  ✓ audio/${file} (${(duration / 60).toFixed(1)} min)`);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(Number).filter(Boolean);
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "catalog.json"), "utf8"));
const list = args.length ? args : catalog.map((c) => c.n);
if (PROVIDER === "openai" && !process.env.OPENAI_API_KEY) { console.error("Brak OPENAI_API_KEY."); process.exit(1); }
if (PROVIDER === "google" && !process.env.GOOGLE_TTS_API_KEY) { console.error("Brak GOOGLE_TTS_API_KEY."); process.exit(1); }
for (const n of list) await generate(n);
