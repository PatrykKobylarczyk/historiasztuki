import { player } from "./player.js";
import { store } from "./store.js";
import { loadVoices, polishVoices, voiceFor, guessGender, speak, stopSpeaking, ttsSupported, speakerVoiceParams } from "./tts.js";
import { openAsk } from "./ask.js";
import { buildItems } from "./items.js";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let program, catalog, speakers;
const lessonCache = {};

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function getLesson(n) {
  if (!lessonCache[n]) lessonCache[n] = await getJSON(`data/lessons/${String(n).padStart(3, "0")}.json`);
  return lessonCache[n];
}

// ---------- Strona główna ----------
function renderHome() {
  const ready = new Map(catalog.map((c) => [c.n, c]));
  const done = new Set(store.get("done", []));
  const last = store.get("last");
  const total = program.parts.reduce((a, p) => a + p.sections.reduce((b, s) => b + s.episodes.length, 0), 0);
  let html = `
    <section class="hero">
      <div class="eyebrow">Europa · Polska · Łódź</div>
      <h1>Historia kultury</h1>
      <p>Kurs do słuchania — w aucie, na spacerze, w domu. Każdą dziedzinę prowadzi inny ekspert: historyk, historyczka sztuki, architekt, muzykolog, literaturoznawczyni, historyczka designu i fotograf. Lekcje po 15–20 minut, chronologicznie, jedna wynika z drugiej.</p>
      <p class="muted">${catalog.length} z ${total} odcinków gotowych do słuchania.</p>
    </section>`;
  if (last && ready.has(last.n)) {
    const pct = Math.round((100 * (last.index || 0)) / (last.total || 1));
    html += `<a class="continue" href="#/lekcja/${last.n}">
      <span class="play-circle">▶</span>
      <span class="ct"><small>Kontynuuj słuchanie</small><strong>Odcinek ${last.n}. ${esc(last.title)}</strong>
      <span class="bar"><div style="width:${pct}%"></div></span></span></a>`;
  } else if (catalog[0]) {
    html += `<a class="continue" href="#/lekcja/${catalog[0].n}"><span class="play-circle">▶</span>
      <span class="ct"><small>Zacznij od początku</small><strong>Odcinek ${catalog[0].n}. ${esc(catalog[0].title)}</strong></span></a>`;
  }
  for (const part of program.parts) {
    const eps = part.sections.flatMap((s) => s.episodes);
    const readyCount = eps.filter((e) => ready.has(e.n)).length;
    const open = readyCount > 0 || (last && eps.some((e) => e.n === last.n));
    html += `<details class="part" ${open ? "open" : ""}>
      <summary><span class="roman">${part.id}</span><span class="pt">${esc(part.title)}</span>
      <span class="cnt">${readyCount ? `${readyCount}/${eps.length} gotowe` : `${eps.length} odc.`}</span></summary>`;
    for (const sec of part.sections) {
      if (sec.title) html += `<div class="section-title">${esc(sec.title)}</div>`;
      for (const e of sec.episodes) {
        const c = ready.get(e.n);
        const cls = c ? (done.has(e.n) ? "ep ready done" : "ep ready") : "ep";
        const badge = c ? (done.has(e.n) ? "✓ wysłuchany" : `${c.minutes} min`) : "w przygotowaniu";
        const title = c ? c.title : e.title;
        html += c
          ? `<a class="${cls}" href="#/lekcja/${e.n}"><span class="num">${e.n}</span><span class="et">${esc(title)}</span><span class="badge">${badge}</span></a>`
          : `<div class="${cls}"><span class="num">${e.n}</span><span class="et">${esc(title)}</span><span class="badge">${badge}</span></div>`;
      }
    }
    html += `</details>`;
  }
  view.innerHTML = html;
}

// ---------- Lekcja ----------
async function renderLesson(n) {
  let lesson;
  try { lesson = await getLesson(n); }
  catch {
    const ep = program.parts.flatMap((p) => p.sections.flatMap((s) => s.episodes)).find((e) => e.n === n);
    view.innerHTML = `<p class="eyebrow">Odcinek ${n}</p><h1>${esc(ep?.title || "Odcinek")}</h1>
      <div class="notice">Ten odcinek jest w przygotowaniu. Gotowe odcinki znajdziesz na <a href="#/">liście kursu</a>.</div>`;
    return;
  }
  // jeśli gra inna lekcja — nie przerywamy jej, dopóki słuchacz nie naciśnie „odtwórz” tutaj
  viewLesson = lesson;
  if (!player.playing || player.lesson?.n === lesson.n) await player.load(lesson, speakers);
  const own = player.lesson?.n === lesson.n;
  const items = own ? player.items : buildItems(lesson);
  const nChapters = lesson.segments.filter((s) => s.t === "chapter").length;
  const imgs = lesson.gallery.filter((g) => g.thumb);
  // przydział obrazów do rozdziałów: jawny (@n) lub równomierny
  const byChapter = {};
  imgs.forEach((g, k) => {
    const ch = g.ch ?? Math.min(nChapters, Math.floor((k * nChapters) / Math.max(1, imgs.length)) + 1);
    (byChapter[ch] ||= []).push(g);
  });

  // transkrypcja: akapity z podziałem na zdania (indeksy elementów odtwarzania)
  let tr = "";
  let lastSi = -1, open = false, chapter = 0;
  const closePara = () => { if (open) { tr += `</p></div></div>`; open = false; } };
  items.forEach((it, i) => {
    if (it.kind === "jingle") { closePara(); tr += `<div class="cue">♪ Dżingiel „Historia kultury”</div>`; return; }
    if (it.kind === "outro") { closePara(); tr += `<div class="cue">♪ Sygnał zamykający</div>`; return; }
    if (it.kind === "sting") {
      closePara();
      chapter = it.chapter;
      tr += `<h3 data-i="${i}">${esc(it.chapterTitle)}</h3>`;
      return;
    }
    if (it.announce) return;
    if (it.music) {
      if (it.si !== lastSi) {
        closePara();
        const seg = lesson.segments[it.si];
        tr += `<div class="music-card" data-i="${i}">🎵 <strong>${esc(seg.title)}</strong> — ${esc(seg.performer || "")}<br>${esc(seg.note || "")}<br>
          <a href="${esc(seg.url)}" target="_blank" rel="noopener">Posłuchaj nagrania ↗</a></div>`;
        lastSi = it.si;
      }
      return;
    }
    if (it.si !== lastSi) {
      closePara();
      const sp = speakers[it.sp];
      tr += `<div class="para"><div class="bar" style="background:${sp.color}"></div><div>
        <div class="spk" style="color:${sp.color}">${esc(sp.name)}</div><p>`;
      open = true;
      lastSi = it.si;
      // obrazy rozdziału po pierwszym akapicie
      if (byChapter[chapter]) {
        const imgsHere = byChapter[chapter];
        delete byChapter[chapter];
        tr = tr.replace(/<div class="para">(?![\s\S]*<div class="para">)/, (m) =>
          imgsHere.map((g) => figureHtml(g, "inline")).join("") + m);
      }
    }
    tr += `<span class="s" data-i="${i}">${esc(it.text)}</span> `;
  });
  closePara();

  const gallery = lesson.gallery.filter((g) => g.thumb).map((g) => figureHtml(g)).join("");
  const glossary = lesson.glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd>`).join("");
  const quiz = lesson.quiz.map((q, qi) => `<div class="q" data-q="${qi}"><p>${qi + 1}. ${esc(q.q)}</p>
    ${q.a.map((a, ai) => `<label><input type="radio" name="q${qi}" value="${ai}"> <span>${esc(a)}</span></label>`).join("")}
    <div class="why" hidden>${esc(q.why)}</div></div>`).join("");
  const sources = lesson.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("");
  const nextN = catalog.find((c) => c.n > lesson.n);

  view.innerHTML = `
    <div class="lesson-head">
      <div class="eyebrow">Odcinek ${lesson.n}</div>
      <h1>${esc(lesson.title)}</h1>
      <div class="sub">${esc(lesson.subtitle)}</div>
    </div>
    <div class="chips"><span class="chip">${esc(lesson.era)}</span><span class="chip">ok. ${lesson.minutes} min słuchania</span><span class="chip">${nChapters} rozdziałów</span></div>
    <section class="player" aria-label="Odtwarzacz">
      <div class="now"><span class="dot"></span><span class="who">Gotowe do odtwarzania</span><span class="chap"></span></div>
      <div class="progress" title="Przewiń"><div></div><div class="ticks"></div></div>
      <div class="controls">
        <button class="small" data-action="prev-chapter" title="Poprzedni rozdział">⏮</button>
        <button data-action="back" title="Cofnij">↺</button>
        <button class="play" data-action="toggle" aria-label="Odtwórz / pauza">▶</button>
        <button data-action="forward" title="Dalej">↻</button>
        <button class="small" data-action="next-chapter" title="Następny rozdział">⏭</button>
      </div>
      <div class="controls" style="margin-top:10px">
        <button class="small" data-action="speed" title="Tempo">${player.speed.toFixed(2).replace(/0$/, "")}×</button>
        <button class="small" data-action="car">🚗 Tryb auto</button>
        <button class="small" data-action="ask">🎙 Zadaj pytanie</button>
        <button class="small" data-action="offline" title="Zapisz na telefonie do słuchania bez internetu">⤓ Offline</button>
      </div>
      <div class="mode-note"></div>
    </section>
    <section class="transcript">${tr}</section>
    ${gallery ? `<h2>Galeria</h2><div class="gallery">${gallery}</div>` : ""}
    ${glossary ? `<h2>Słowniczek</h2><dl class="glossary">${glossary}</dl>` : ""}
    ${quiz ? `<h2>Sprawdź się</h2><div class="quiz">${quiz}</div>` : ""}
    ${sources ? `<h2>Źródła i materiały</h2><ul class="sources">${sources}</ul>` : ""}
    <div class="next-card"><div class="eyebrow">Następny odcinek</div>
      <p>${esc(lesson.next)}</p>
      ${nextN ? `<a class="btn" href="#/lekcja/${nextN.n}">Przejdź do odcinka ${nextN.n} →</a>` : `<span class="muted">Kolejne odcinki w przygotowaniu.</span>`}
    </div>`;

  // podziałki rozdziałów na pasku postępu
  if (own) $(".progress .ticks", view).innerHTML = player.chapterFractions().map((f) => `<span style="left:${(f * 100).toFixed(2)}%"></span>`).join("");
  $(".progress", view).addEventListener("click", async (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    await ensureViewLesson();
    player.seekFraction((e.clientX - r.left) / r.width);
  });
  view.querySelectorAll(".s, h3[data-i]").forEach((el) => el.addEventListener("click", async () => {
    await ensureViewLesson();
    player.seek(Number(el.dataset.i));
    if (!player.playing) player.play();
  }));
  view.querySelectorAll(".quiz .q").forEach((qel) => qel.addEventListener("change", (e) => {
    const q = lesson.quiz[Number(qel.dataset.q)];
    const v = Number(e.target.value);
    qel.querySelectorAll("label").forEach((l, i) => {
      l.classList.toggle("ok", i === q.correct);
      l.classList.toggle("bad", i === v && v !== q.correct);
    });
    qel.querySelector(".why").hidden = false;
  }));
  view.querySelectorAll("figure img").forEach((img) => img.addEventListener("click", () => lightbox(img)));
  updatePlayerUI(true);
}

let viewLesson = null;
// przełącza odtwarzacz na lekcję widoczną na ekranie (gdy w tle grała inna)
async function ensureViewLesson() {
  if (!viewLesson || player.lesson?.n === viewLesson.n || !location.hash.startsWith("#/lekcja/")) return;
  await player.load(viewLesson, speakers);
  if (location.hash === `#/lekcja/${viewLesson.n}`) {
    $(".progress .ticks", view).innerHTML = player.chapterFractions().map((f) => `<span style="left:${(f * 100).toFixed(2)}%"></span>`).join("");
  }
}

function figureHtml(g, cls = "") {
  const credit = [g.artist, g.license].filter(Boolean).join(", ");
  return `<figure class="${cls}"><img loading="lazy" src="${esc(cls ? g.url || g.thumb : g.thumb)}" data-full="${esc(g.url || g.thumb)}" alt="${esc(g.caption)}">
    <figcaption>${esc(g.caption)}${credit ? ` · <a href="${esc(g.page || "#")}" target="_blank" rel="noopener">${esc(credit)}</a>` : ""}</figcaption></figure>`;
}

function lightbox(img) {
  const d = document.createElement("div");
  d.className = "lightbox";
  d.innerHTML = `<div><img src="${esc(img.dataset.full)}" alt=""><p>${esc(img.alt)}</p></div>`;
  d.addEventListener("click", () => d.remove());
  document.body.append(d);
}

// ---------- Aktualizacja odtwarzacza ----------
let lastCur = -1;
function updatePlayerUI(force = false) {
  const it = player.current;
  const sp = it?.sp ? speakers[it.sp] : null;
  const who = it ? (it.kind === "jingle" ? "♪ Dżingiel" : it.kind === "outro" ? "♪ Zakończenie" : it.kind === "sting" ? "♪" : sp?.name) : "";
  const color = sp?.color || "var(--gold)";
  const icon = player.playing ? "❚❚" : "▶";

  // mini odtwarzacz
  const mp = $("#miniplayer");
  if (player.lesson) {
    mp.hidden = false;
    $(".mp-toggle", mp).textContent = icon;
    $(".mp-title", mp).textContent = `${player.lesson.n}. ${player.lesson.title}`;
    $(".mp-sub", mp).textContent = `${who || ""} · ${it?.chapterTitle || ""}`;
    $(".mp-info", mp).href = `#/lekcja/${player.lesson.n}`;
  }
  // tryb samochodowy
  const car = $("#carmode");
  if (!car.hidden) {
    $(".car-ep", car).textContent = `Odcinek ${player.lesson?.n}. ${player.lesson?.title}`;
    $(".car-speaker .name", car).textContent = who || "";
    $(".car-speaker .dot", car).style.background = color;
    $(".car-chapter", car).textContent = it?.chapterTitle || "";
    $(".car-progress > div", car).style.width = `${(player.progress * 100).toFixed(1)}%`;
    $(".car-play", car).textContent = icon;
  }
  // odtwarzacz na stronie lekcji
  const pl = $(".player", view);
  if (pl && player.lesson && location.hash === `#/lekcja/${player.lesson.n}`) {
    $(".now .dot", pl).style.background = color;
    $(".now .who", pl).textContent = who || "Gotowe do odtwarzania";
    $(".now .chap", pl).textContent = it?.chapterTitle && it.chapterTitle !== player.lesson.title ? `· ${it.chapterTitle}` : "";
    $(".progress > div", pl).style.width = `${(player.progress * 100).toFixed(1)}%`;
    $(".play", pl).textContent = icon;
    $('[data-action="speed"]', pl).textContent = `${String(player.speed).replace(".", ",")}×`;
    $(".mode-note", pl).textContent = player.mode === "mp3"
      ? "Nagranie z naturalnymi głosami — działa także przy zgaszonym ekranie."
      : ttsSupported() ? `Głosy syntezatora tego urządzenia (${polishVoices().length} polskich). Nie wygaszaj ekranu podczas słuchania.` : "Ta przeglądarka nie obsługuje syntezy mowy.";
    if (player.index !== lastCur || force) {
      view.querySelectorAll(".s.cur").forEach((el) => el.classList.remove("cur"));
      const el = view.querySelector(`.s[data-i="${player.index}"]`);
      if (el) {
        el.classList.add("cur");
        if (player.playing && store.get("autoscroll", true)) {
          const r = el.getBoundingClientRect();
          if (r.top < 260 || r.bottom > innerHeight - 100) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
      lastCur = player.index;
    }
  }
}
player.addEventListener("state", () => updatePlayerUI());
player.addEventListener("error", (e) => alertNote(e.detail));
player.addEventListener("finished", () => {
  const next = catalog.find((c) => c.n > player.lesson.n);
  if (next && store.get("autonext", true)) {
    location.hash = `#/lekcja/${next.n}`;
    setTimeout(() => player.play(), 1200);
  }
});

function alertNote(msg) {
  const n = document.createElement("div");
  n.className = "notice warn";
  n.style.cssText = "position:fixed;left:12px;right:12px;bottom:90px;z-index:60;max-width:600px;margin:auto";
  n.textContent = msg;
  document.body.append(n);
  setTimeout(() => n.remove(), 6000);
}

// ---------- Akcje ----------
const SPEEDS = [0.85, 0.9, 1, 1.1, 1.2, 1.35];
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action;
  if (b.closest("#view .player") && a !== "speed") await ensureViewLesson();
  if (a === "toggle") player.toggle();
  else if (a === "back") player.back();
  else if (a === "forward") player.forward();
  else if (a === "next-chapter") player.nextChapter();
  else if (a === "prev-chapter") player.prevChapter();
  else if (a === "speed") {
    const i = SPEEDS.indexOf(player.speed);
    player.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  } else if (a === "car") {
    $("#carmode").hidden = false;
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    updatePlayerUI(true);
  } else if (a === "car-close") {
    $("#carmode").hidden = true;
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
    try { await wakeLock?.release(); } catch {}
  } else if (a === "ask") {
    openAsk(player, speakers);
  } else if (a === "offline") {
    saveOffline(b);
  } else if (a === "test-voice") {
    const k = b.dataset.sp;
    stopSpeaking();
    speak(`Dzień dobry. Tu ${speakers[k].name}, Akademia Kultury i Sztuki. Moja dziedzina to ${speakers[k].role}.`, speakerVoiceParams(k, speakers));
  }
});
let wakeLock = null;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && !$("#carmode").hidden) {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  }
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog")) return;
  if (e.code === "Space" && player.lesson) { e.preventDefault(); player.toggle(); }
});

async function saveOffline(btn) {
  if (!player.lesson || !("caches" in window)) return;
  btn.disabled = true;
  btn.textContent = "Zapisuję…";
  const id = String(player.lesson.n).padStart(3, "0");
  const urls = [`data/lessons/${id}.json`, ...player.lesson.gallery.flatMap((g) => [g.thumb, g.url]).filter(Boolean)];
  if (player.mode === "mp3") urls.push(`audio/${id}.json`, `audio/${player.manifest.file}`);
  const cache = await caches.open("hk-media-v1");
  let ok = 0;
  await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetch(u, { mode: u.startsWith("http") ? "no-cors" : "same-origin" });
      await cache.put(u, r);
      ok++;
    } catch {}
  }));
  btn.textContent = ok === urls.length ? "✓ Zapisano offline" : `Zapisano ${ok}/${urls.length}`;
}

// ---------- Ustawienia głosów ----------
async function renderSettings() {
  await loadVoices();
  const voices = polishVoices();
  const map = store.get("voiceMap", {});
  const opts = (k) => {
    const cur = map[k] || voiceFor(k, speakers)?.voiceURI;
    return voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cur ? "selected" : ""}>${esc(v.name)}${guessGender(v) !== "?" ? ` (${guessGender(v) === "f" ? "k" : "m"})` : ""}</option>`).join("");
  };
  view.innerHTML = `
    <div class="eyebrow">Ustawienia</div>
    <h1>Głosy ekspertów</h1>
    ${!ttsSupported() ? `<div class="notice warn">Ta przeglądarka nie obsługuje syntezy mowy.</div>` : voices.length < 2 ? `<div class="notice warn">${voices.length ? "To urządzenie ma tylko jeden polski głos syntezatora, więc eksperci różnią się wysokością głosu." : "To urządzenie nie ma polskiego głosu syntezatora."} Więcej głosów: na iPhonie Ustawienia → Dostępność → Treść mówiona → Głosy → Polski (pobierz wersje „ulepszone”); na Androidzie ustawienia „Zamiana tekstu na mowę” Google z pakietem polskim; na komputerze przeglądarka Edge ma naturalne głosy Marek i Zofia.</div>` : ""}
    <p class="muted">Każdy ekspert może mówić innym głosem. Najlepszą jakość dają nagrania MP3 z naturalnymi głosami (patrz README projektu) — wtedy te ustawienia nie są używane.</p>
    <div class="settings">
      ${Object.entries(speakers).map(([k, s]) => `
        <div class="row">
          <div class="lbl"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</div>
          <div class="ctl">
            <select data-sp="${k}">${opts(k)}</select>
            <label class="muted">wysokość <input type="range" min="0.6" max="1.5" step="0.05" value="${store.get("pitchMap", {})[k] ?? s.pitch}" data-pitch="${k}"></label>
            <button class="btn ghost" data-action="test-voice" data-sp="${k}">▶ Posłuchaj</button>
          </div>
        </div>`).join("")}
      <div class="row"><div class="lbl">Nagrania MP3</div><div class="ctl"><label><input type="checkbox" id="preferMp3" ${store.get("preferMp3", true) ? "checked" : ""}> używaj nagrań z naturalnymi głosami, gdy są dostępne</label></div></div>
      <div class="row"><div class="lbl">Automatycznie dalej</div><div class="ctl"><label><input type="checkbox" id="autonext" ${store.get("autonext", true) ? "checked" : ""}> po zakończeniu odcinka włącz następny</label></div></div>
      <div class="row"><div class="lbl">Przewijanie tekstu</div><div class="ctl"><label><input type="checkbox" id="autoscroll" ${store.get("autoscroll", true) ? "checked" : ""}> przewijaj transkrypcję za lektorem</label></div></div>
      <div class="row"><div class="lbl">Kod dostępu do pytań</div><div class="ctl"><input type="password" id="accessCode" value="${esc(store.get("accessCode", ""))}" placeholder="jeśli ustawiono na serwerze"></div></div>
      <div class="row"><div class="lbl">Motyw</div><div class="ctl"><select id="theme">
        ${["auto", "light", "dark"].map((t) => `<option value="${t}" ${store.get("theme", "auto") === t ? "selected" : ""}>${{ auto: "jak w systemie", light: "jasny", dark: "ciemny" }[t]}</option>`).join("")}</select></div></div>
    </div>`;
  view.querySelectorAll("select[data-sp]").forEach((s) => s.addEventListener("change", () => {
    store.set("voiceMap", { ...store.get("voiceMap", {}), [s.dataset.sp]: s.value });
  }));
  view.querySelectorAll("input[data-pitch]").forEach((r) => r.addEventListener("change", () => {
    store.set("pitchMap", { ...store.get("pitchMap", {}), [r.dataset.pitch]: Number(r.value) });
  }));
  for (const id of ["preferMp3", "autonext", "autoscroll"]) $(`#${id}`).addEventListener("change", (e) => store.set(id, e.target.checked));
  $("#accessCode").addEventListener("change", (e) => store.set("accessCode", e.target.value.trim()));
  $("#theme").addEventListener("change", (e) => { store.set("theme", e.target.value); applyTheme(); });
}

function applyTheme() {
  const t = store.get("theme", "auto");
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = t;
}

// ---------- Router ----------
async function route() {
  const h = location.hash || "#/";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active",
    (a.dataset.nav === "home" && !h.startsWith("#/ustawienia")) || (a.dataset.nav === "settings" && h.startsWith("#/ustawienia"))));
  const m = h.match(/^#\/lekcja\/(\d+)/);
  lastCur = -1;
  if (m) await renderLesson(Number(m[1]));
  else if (h.startsWith("#/ustawienia")) await renderSettings();
  else renderHome();
  if (!m) window.scrollTo(0, 0);
  updatePlayerUI(true);
}

async function init() {
  applyTheme();
  [program, catalog, speakers] = await Promise.all([getJSON("data/program.json"), getJSON("data/catalog.json"), getJSON("data/speakers.json")]);
  window.addEventListener("hashchange", route);
  await route();
  if ("serviceWorker" in navigator && location.hostname !== "localhost") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init().catch((e) => { view.innerHTML = `<div class="notice warn">Nie udało się wczytać kursu: ${esc(e.message)}</div>`; });
