// Silnik odtwarzania lekcji.
// Tryb „mp3”: gotowe nagranie z naturalnymi głosami (jeśli wygenerowano je skryptem) — działa przy zgaszonym ekranie.
// Tryb „tts”: synteza mowy w przeglądarce — każdy ekspert innym głosem, dżingiel syntezowany na żywo.
import { buildItems } from "./items.js";
import { renderJingle, renderOutro, renderSting, toWav } from "./jingle.js";
import { speak, stopSpeaking, msSinceCancel, speakerVoiceParams, loadVoices, ttsSupported } from "./tts.js";
import { store } from "./store.js";

let audioCtx = null;
const buffers = {};
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function getBuffer(kind) {
  if (buffers[kind]) return buffers[kind];
  const c = ctx();
  const sr = c.sampleRate > 32000 ? 32000 : c.sampleRate;
  const data = kind === "jingle" ? renderJingle(sr) : kind === "outro" ? renderOutro(sr) : renderSting(sr);
  const b = c.createBuffer(1, data.length, sr);
  b.copyToChannel(data, 0);
  buffers[kind] = b;
  return b;
}

let silentUrl = null;
function silentAudioUrl() {
  if (!silentUrl) silentUrl = URL.createObjectURL(new Blob([toWav(new Float32Array(8000), 8000)], { type: "audio/wav" }));
  return silentUrl;
}

export class Player extends EventTarget {
  constructor() {
    super();
    this.lesson = null;
    this.items = [];
    this.index = 0;
    this.playing = false;
    this.mode = "tts";
    this.token = 0;
    this.speed = store.get("speed", 1);
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.keepAlive = new Audio();
    this.keepAlive.loop = true;
    this.manifest = null;
    this.audio.addEventListener("timeupdate", () => this.#onTime());
    this.audio.addEventListener("ended", () => this.#finish());
    this.audio.addEventListener("play", () => { this.playing = true; this.#emit(); });
    this.audio.addEventListener("pause", () => { if (this.mode === "mp3") { this.playing = false; this.#emit(); } });
    this.#setupMediaSession();
    // Chrome potrafi „zawiesić” długą syntezę — delikatne podtrzymanie
    setInterval(() => { if (this.playing && this.mode === "tts" && ttsSupported() && speechSynthesis.speaking) speechSynthesis.resume(); }, 8000);
  }

  async load(lesson, speakers) {
    if (this.lesson?.n === lesson.n) return;
    this.stop();
    this.lesson = lesson;
    this.speakers = speakers;
    this.items = buildItems(lesson);
    this.weights = this.items.map((it) => (it.kind === "speech" ? it.text.length : it.kind === "jingle" ? 120 : it.kind === "outro" ? 60 : 25));
    this.cum = [];
    let acc = 0;
    for (const w of this.weights) { this.cum.push(acc); acc += w; }
    this.total = acc;
    this.index = Math.min(store.get(`pos:${lesson.n}`, 0), this.items.length - 1);
    this.manifest = null;
    this.mode = "tts";
    const preferMp3 = store.get("preferMp3", true);
    if (preferMp3) {
      try {
        const id = String(lesson.n).padStart(3, "0");
        const r = await fetch(`audio/${id}.json`, { cache: "no-cache" });
        if (r.ok) {
          const m = await r.json();
          if (Array.isArray(m.starts) && m.starts.length === this.items.length) {
            this.manifest = m;
            this.mode = "mp3";
            this.audio.src = `audio/${m.file}`;
          }
        }
      } catch { /* brak nagrania — zostajemy przy syntezie */ }
    }
    if (this.mode === "tts") await loadVoices();
    this.#emit();
  }

  get current() { return this.items[this.index]; }
  get progress() {
    if (this.mode === "mp3" && this.audio.duration) return this.audio.currentTime / this.audio.duration;
    return this.total ? this.cum[this.index] / this.total : 0;
  }
  chapterStarts() {
    return this.items.map((it, i) => (it.kind === "sting" ? i : -1)).filter((i) => i >= 0);
  }
  chapterFractions() {
    return this.chapterStarts().map((i) => (this.mode === "mp3" && this.manifest?.duration ? this.manifest.starts[i] / this.manifest.duration : this.cum[i] / this.total));
  }

  play() {
    if (!this.lesson) return;
    if (this.index >= this.items.length) this.index = 0;
    if (this.mode === "mp3") {
      if (!this.audio.currentTime) this.audio.currentTime = this.manifest.starts[this.index] ?? 0;
      this.audio.playbackRate = this.speed;
      this.audio.play().catch(() => {});
      return;
    }
    if (!ttsSupported()) {
      this.dispatchEvent(new CustomEvent("error", { detail: "Ta przeglądarka nie obsługuje syntezy mowy. Spróbuj Chrome, Edge lub Safari." }));
      return;
    }
    this.playing = true;
    try { ctx().resume(); } catch {}
    this.fails = 0;
    // odblokowanie mowy w geście użytkownika (iOS/Safari i część Chrome blokują mowę uruchomioną później)
    try {
      if (!this.unlocked) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        u.lang = "pl-PL";
        speechSynthesis.speak(u);
        this.unlocked = true;
      }
      speechSynthesis.resume();
    } catch {}
    this.#emit();
    this.#playIndex(this.index);
  }

  pause() {
    if (this.mode === "mp3") { this.audio.pause(); return; }
    this.playing = false;
    this.token++;
    stopSpeaking();
    this.#stopNode();
    this.keepAlive.pause();
    this.#emit();
  }

  stop() {
    this.pause();
    this.audio.removeAttribute("src");
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(index) {
    index = Math.max(0, Math.min(this.items.length - 1, index));
    this.index = index;
    this.#save();
    if (this.mode === "mp3") {
      this.audio.currentTime = this.manifest.starts[index] ?? 0;
      this.#emit();
      return;
    }
    if (this.playing) { this.token++; stopSpeaking(); this.#stopNode(); this.#playIndex(index); }
    else this.#emit();
  }

  seekFraction(f) {
    if (this.mode === "mp3" && this.audio.duration) { this.audio.currentTime = f * this.audio.duration; return; }
    const target = f * this.total;
    let i = this.cum.findIndex((c) => c > target);
    if (i < 0) i = this.items.length;
    this.seek(Math.max(0, i - 1));
  }

  nextChapter() {
    const s = this.chapterStarts().find((i) => i > this.index);
    if (s != null) this.seek(s);
  }
  prevChapter() {
    const starts = this.chapterStarts();
    const cur = [...starts].reverse().find((i) => i <= this.index) ?? 0;
    // jeśli jesteśmy na początku rozdziału — skocz do poprzedniego
    const prev = this.index - cur < 3 ? [...starts].reverse().find((i) => i < cur) ?? 0 : cur;
    this.seek(prev);
  }
  back() {
    if (this.mode === "mp3") { this.audio.currentTime = Math.max(0, this.audio.currentTime - 15); return; }
    this.seek(this.index - 3);
  }
  forward() {
    if (this.mode === "mp3") { this.audio.currentTime = Math.min(this.audio.duration || 0, this.audio.currentTime + 15); return; }
    this.seek(this.index + 3);
  }
  setSpeed(s) {
    this.speed = s;
    store.set("speed", s);
    if (this.mode === "mp3") this.audio.playbackRate = s;
    this.#emit();
  }

  // --- wewnętrzne ---
  #playIndex(i) {
    const token = ++this.token;
    if (i >= this.items.length) return this.#finish();
    this.index = i;
    this.#save();
    this.#emit();
    const it = this.items[i];
    const advance = (gap = 0) => {
      if (token !== this.token || !this.playing) return;
      setTimeout(() => { if (token === this.token && this.playing) this.#playIndex(i + 1); }, gap);
    };
    if (it.kind === "jingle" || it.kind === "outro" || it.kind === "sting") {
      const c = ctx();
      try { c.resume(); } catch {}
      const src = c.createBufferSource();
      src.buffer = getBuffer(it.kind);
      const g = c.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(c.destination);
      src.onended = () => {
        // zwalniamy wyjście audio, żeby nie blokowało syntezatora mowy na telefonie
        setTimeout(() => { try { c.suspend(); } catch {} }, 50);
        advance(it.kind === "sting" ? 250 : 400);
      };
      this.node = src;
      src.start();
      return;
    }
    const p = speakerVoiceParams(it.sp, this.speakers);
    const next = this.items[i + 1];
    const gap = !next ? 0 : next.kind !== "speech" ? 500 : next.sp !== it.sp ? 650 : next.si !== it.si ? 350 : 80;
    let started = Date.now();
    const silentFail = (why) => {
      // mowa „skończyła się” natychmiast lub z błędem — kilka razy z rzędu oznacza, że nic nie słychać
      this.fails = (this.fails || 0) + 1;
      if (this.fails >= 3) {
        this.pause();
        this.dispatchEvent(new CustomEvent("error", { detail: why === "not-allowed"
          ? "Przeglądarka zablokowała czytanie. Naciśnij ▶ jeszcze raz."
          : why === "language-unavailable" || why === "voice-unavailable"
            ? "Na tym urządzeniu brakuje polskiego głosu syntezatora. Dodaj go w ustawieniach telefonu (zamiana tekstu na mowę) albo użyj nagrań MP3."
            : "Syntezator mowy nie odpowiada. Naciśnij ▶ jeszcze raz; jeśli to nie pomoże, zmień głos w zakładce Głosy." }));
        return true;
      }
      return false;
    };
    const go = () => {
      if (token !== this.token || !this.playing) return;
      started = Date.now();
      this.utt = speak(it.text, { ...p, rate: p.rate * this.speed }, {
        onstart: () => { this.fails = 0; },
        onend: () => {
          if (token !== this.token) return;
          if (Date.now() - started < 250 && it.text.length > 25 && silentFail("instant")) return;
          advance(gap);
        },
        onerror: (e) => {
          if (token !== this.token) return;
          if (e?.error === "interrupted" || e?.error === "canceled") return;
          if (silentFail(e?.error)) return;
          advance(gap);
        },
      });
    };
    // Chrome gubi wypowiedź wydaną tuż po cancel() — krótkie opóźnienie
    if (speechSynthesis.speaking || speechSynthesis.pending) { stopSpeaking(); setTimeout(go, 80); }
    else if (msSinceCancel() < 150) setTimeout(go, 80);
    else go();
    // strażnik: jeśli przeglądarka „zgubi” zdarzenie końca wypowiedzi
    const limit = 4000 + (it.text.length * 140) / this.speed;
    setTimeout(() => {
      if (token === this.token && this.playing && Date.now() - started >= limit && !speechSynthesis.speaking) advance(0);
    }, limit + 600);
  }

  #stopNode() {
    try { this.node?.stop(); } catch {}
    this.node = null;
  }

  #finish() {
    this.playing = false;
    this.keepAlive.pause();
    if (this.lesson) {
      const done = store.get("done", []);
      if (!done.includes(this.lesson.n)) store.set("done", [...done, this.lesson.n]);
      store.set(`pos:${this.lesson.n}`, 0);
    }
    this.index = this.items.length - 1;
    this.#emit();
    this.dispatchEvent(new CustomEvent("finished"));
  }

  #onTime() {
    if (this.mode !== "mp3" || !this.manifest) return;
    const t = this.audio.currentTime;
    const s = this.manifest.starts;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= t) lo = mid; else hi = mid - 1; }
    if (lo !== this.index) { this.index = lo; this.#save(); }
    this.#emit();
  }

  #save() {
    if (!this.lesson) return;
    store.set(`pos:${this.lesson.n}`, this.index);
    store.set("last", { n: this.lesson.n, index: this.index, total: this.items.length, title: this.lesson.title });
  }

  #emit() {
    this.dispatchEvent(new CustomEvent("state"));
    this.#updateMediaSession();
  }

  #setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    h("play", () => this.play());
    h("pause", () => this.pause());
    h("previoustrack", () => this.prevChapter());
    h("nexttrack", () => this.nextChapter());
    h("seekbackward", () => this.back());
    h("seekforward", () => this.forward());
  }

  #updateMediaSession() {
    if (!("mediaSession" in navigator) || !this.lesson) return;
    const it = this.current;
    const sp = it?.sp ? this.speakers?.[it.sp]?.name : "Historia kultury";
    const key = `${this.lesson.n}|${it?.chapterTitle}|${sp}`;
    if (key !== this._msKey) {
      this._msKey = key;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `${this.lesson.n}. ${this.lesson.title}`,
          artist: `${sp} — ${it?.chapterTitle || ""}`,
          album: "Historia kultury · Akademia Kultury i Sztuki",
          artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
        });
      } catch {}
    }
    try { navigator.mediaSession.playbackState = this.playing ? "playing" : "paused"; } catch {}
  }
}

export const player = new Player();
