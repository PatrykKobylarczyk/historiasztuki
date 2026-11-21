import { player } from "./player.js";
import { store } from "./store.js";
import { loadVoices, polishVoices, voiceFor, guessGender, speak, stopSpeaking, ttsSupported, speakerVoiceParams } from "./tts.js";
import { openAsk } from "./ask.js";
import { buildItems } from "./items.js";
import { icons } from "./icons.js";
import * as keepAwake from "./keepawake.js";

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
const pad3 = (n) => String(n).padStart(3, "0");
const big = (u) => (u || "").replace(/\/(\d+)px-/, "/960px-");
const imgTag = (u, cls = "") => u ? `<img${cls ? ` class="${cls}"` : ""} src="${esc(u)}" alt="" loading="lazy" onerror="this.remove()">` : "";
const partEps = (part) => part.sections.flatMap((s) => s.episodes);

function renderHome() {
  const ready = new Map(catalog.map((c) => [c.n, c]));
  const done = new Set(store.get("done", []));
  const last = store.get("last");
  const total = program.parts.reduce((a, p) => a + partEps(p).length, 0);
  const feat = (last && ready.has(last.n)) ? ready.get(last.n) : catalog[0];
  let html = `
    <section class="hero">
      <h1 class="hero-title">KULTURA<span class="brand-dot" aria-hidden="true"></span></h1>
      <p class="hero-deck">Wielkie dzieła, wielkie idee i&nbsp;ludzie, którzy zmienili świat.</p>
      <p class="hero-meta">${total} odcinków · ${catalog.length} gotowych · ${done.size} wysłuchanych</p>`;
  if (feat) {
    const resume = last && last.n === feat.n;
    const pct = resume ? Math.round((100 * (last.index || 0)) / (last.total || 1)) : 0;
    html += `<a class="continue${feat.thumb ? " has-img" : ""}" href="#/lekcja/${feat.n}">
      ${feat.thumb ? `<img class="cbg" src="${esc(big(feat.thumb))}" alt="" onerror="this.remove()">` : ""}
      <span class="ct"><small>${resume ? "Kontynuuj" : "Zacznij słuchać"} · odcinek ${feat.n}</small><strong>${esc(feat.title)}</strong>
      ${feat.subtitle ? `<em>${esc(feat.subtitle)}</em>` : ""}
      ${resume ? `<span class="bar"><div style="width:${pct}%"></div></span>` : ""}</span>
      <span class="play-circle">${icons.play}</span></a>`;
  }
  html += `</section>`;
  const nextUp = catalog.filter((c) => c.n > (feat?.n ?? 0) && !done.has(c.n)).slice(0, 12);
  if (nextUp.length) {
    html += `<section class="block"><div class="block-head"><h2>Następne</h2></div>
      <div class="shelf">${nextUp.map((c) => `<a class="tile" href="#/lekcja/${c.n}">
        <span class="tile-img">${imgTag(c.thumb)}</span>
        <span class="tile-n">${c.n} · ${c.minutes} min</span>
        <strong>${esc(c.title)}</strong></a>`).join("")}</div></section>`;
  }
  html += `<section class="block"><div class="block-head"><h2>Program</h2><span>${program.parts.length} części</span></div><div class="parts">`;
  for (const part of program.parts) {
    const eps = partEps(part);
    const r = eps.filter((e) => ready.has(e.n));
    const heard = eps.filter((e) => done.has(e.n)).length;
    const cover = r.map((e) => ready.get(e.n).thumb).find(Boolean);
    const isCur = eps.some((e) => e.n === feat?.n);
    html += `<a class="prow${isCur ? " cur" : ""}" href="#/czesc/${part.id}">
      <span class="pcover">${cover ? imgTag(cover) : `<i>${part.id}</i>`}</span>
      <span class="ptext"><small>Część ${part.id}${isCur ? " · słuchasz" : ""}</small><strong>${esc(part.title)}</strong>
      <span class="pmeta">${eps.length} odc.${r.length && r.length < eps.length ? ` · ${r.length} gotowych` : ""}${heard ? ` · ${heard} wysłuchanych` : ""}</span></span>
      <span class="chev">${icons.arrow}</span></a>`;
  }
  html += `</div></section>`;
  view.innerHTML = html;
}

// ---------- Część kursu ----------
function renderPart(id) {
  const part = program.parts.find((p) => p.id === id);
  if (!part) return renderHome();
  const ready = new Map(catalog.map((c) => [c.n, c]));
  const done = new Set(store.get("done", []));
  const last = store.get("last");
  const eps = partEps(part);
  const r = eps.filter((e) => ready.has(e.n)).map((e) => ready.get(e.n));
  const mins = r.reduce((a, c) => a + (c.minutes || 0), 0);
  const cover = r.map((c) => c.thumb).find(Boolean);
  const startEp = r.find((c) => !done.has(c.n)) || r[0];
  const idx = program.parts.indexOf(part);
  const prev = program.parts[idx - 1], next = program.parts[idx + 1];
  let html = `<section class="part-hero">
    <a class="back" href="#/">‹ Program</a>
    ${cover ? `<div class="part-img">${imgTag(big(cover))}</div>` : ""}
    <div class="eyebrow accent">Część ${part.id}</div>
    <h1>${esc(part.title)}</h1>
    <p class="hero-meta">${eps.length} odcinków${r.length ? ` · ${r.length} gotowych · ${mins >= 60 ? `${Math.floor(mins / 60)} godz. ${mins % 60} min` : `${mins} min`}` : ""}</p>
    ${startEp ? `<a class="btn accent big" href="#/lekcja/${startEp.n}">${icons.play} ${done.has(startEp.n) ? "Odtwórz ponownie" : last?.n === startEp.n ? "Kontynuuj" : "Odtwórz"}</a>` : ""}
  </section><div class="eplist">`;
  for (const sec of part.sections) {
    if (sec.title) html += `<div class="sec">${esc(sec.title)}</div>`;
    for (const e of sec.episodes) {
      const c = ready.get(e.n);
      const isDone = done.has(e.n), cur = last?.n === e.n;
      const inner = `<span class="eimg">${c?.thumb ? imgTag(c.thumb) : `<i>${e.n}</i>`}</span>
        <span class="etext"><small>${e.n}${c ? ` · ${c.minutes} min` : " · wkrótce"}${cur && !isDone ? " · w trakcie" : ""}</small><strong>${esc(c ? c.title : e.title)}</strong></span>
        <span class="estate">${isDone ? "✓" : c ? icons.play : ""}</span>`;
      html += c ? `<a class="erow${isDone ? " done" : ""}${cur ? " cur" : ""}" href="#/lekcja/${e.n}">${inner}</a>` : `<div class="erow off">${inner}</div>`;
    }
  }
  html += `</div><nav class="part-nav">${prev ? `<a href="#/czesc/${prev.id}"><small>‹ Część ${prev.id}</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="r" href="#/czesc/${next.id}"><small>Część ${next.id} ›</small>${esc(next.title)}</a>` : ""}</nav>`;
  view.innerHTML = html;
}

// przydział obrazów do rozdziałów: jawny (@n) lub równomierny
function chapterImages(lesson) {
  const nChapters = lesson.segments.filter((s) => s.t === "chapter").length;
  const imgs = lesson.gallery.filter((g) => g.thumb);
  const byChapter = {};
  imgs.forEach((g, k) => {
    const ch = g.ch ?? Math.min(nChapters, Math.floor((k * nChapters) / Math.max(1, imgs.length)) + 1);
    (byChapter[ch] ||= []).push(g);
  });
  return byChapter;
}

// ---------- Lekcja ----------
async function renderLesson(n) {
  let lesson;
  try { lesson = await getLesson(n); }
  catch {
    const ep = program.parts.flatMap((p) => p.sections.flatMap((s) => s.episodes)).find((e) => e.n === n);
    view.innerHTML = `<div class="lesson-head"><div class="eyebrow"><a href="#/">Kurs</a><span class="sep"></span>Odcinek ${n}</div><h1>${esc(ep?.title || "Odcinek")}</h1>
      <div class="sub">Ten odcinek jest w przygotowaniu.</div></div>
      <p style="margin-top:32px"><a class="btn" href="#/">Wróć do programu</a></p>`;
    return;
  }
  // jeśli gra inna lekcja — nie przerywamy jej, dopóki słuchacz nie naciśnie „odtwórz” tutaj
  viewLesson = lesson;
  if (!player.playing || player.lesson?.n === lesson.n) await player.load(lesson, speakers);
  const own = player.lesson?.n === lesson.n;
  const items = own ? player.items : buildItems(lesson);
  const nChapters = lesson.segments.filter((s) => s.t === "chapter").length;
  const imgs = lesson.gallery.filter((g) => g.thumb);
  const byChapter = chapterImages(lesson);

  // transkrypcja: akapity z podziałem na zdania (indeksy elementów odtwarzania)
  let tr = "";
  let lastSi = -1, open = false, chapter = 0, lastSp = null;
  const closePara = () => { if (open) { tr += `</p></div>`; open = false; } };
  items.forEach((it, i) => {
    if (it.kind === "jingle") { closePara(); tr += `<div class="cue">Sygnał · KULTURA</div>`; lastSp = null; return; }
    if (it.kind === "outro") { closePara(); tr += `<div class="cue">Koniec odcinka</div>`; return; }
    if (it.kind === "sting") {
      closePara();
      chapter = it.chapter;
      lastSp = null;
      const mt = /^(Rozdział\s+[IVXLC\d]+)\.\s*(.+)$/.exec(it.chapterTitle || "");
      tr += mt
        ? `<h3 data-i="${i}"><span class="chn">${esc(mt[1])}</span>${esc(mt[2])}</h3>`
        : `<h3 data-i="${i}">${esc(it.chapterTitle)}</h3>`;
      return;
    }
    if (it.announce) return;
    if (it.music) {
      if (it.si !== lastSi) {
        closePara();
        const seg = lesson.segments[it.si];
        tr += `<div class="music-card" data-i="${i}"><span class="mi">${icons.note}</span><span><strong>${esc(seg.title)}</strong>${seg.performer ? ` — ${esc(seg.performer)}` : ""}</span>
          ${seg.note ? `<span class="muted">${esc(seg.note)}</span>` : ""}
          <a href="${esc(seg.url)}" target="_blank" rel="noopener">Posłuchaj nagrania ${icons.external}</a></div>`;
        lastSp = null;
        lastSi = it.si;
      }
      return;
    }
    if (it.si !== lastSi) {
      closePara();
      const sp = speakers[it.sp];
      tr += `<div class="para${lastSp === it.sp ? " cont" : ""}">
        <div class="spk"><i style="background:${sp.color}"></i>${esc(sp.name)}</div><p>`;
      lastSp = it.sp;
      open = true;
      lastSi = it.si;
      // obrazy rozdziału po pierwszym akapicie
      if (byChapter[chapter]) {
        const imgsHere = byChapter[chapter];
        delete byChapter[chapter];
        tr = tr.replace(/<div class="para(?: cont)?">(?![\s\S]*<div class="para)/, (m) =>
          imgsHere.map((g) => figureHtml(g, "inline")).join("") + m);
      }
    }
    tr += `<span class="s" data-i="${i}">${esc(it.text)}</span> `;
  });
  closePara();

  const gallery = lesson.gallery.filter((g) => g.thumb).map((g) => figureHtml(g)).join("");
  const glossary = lesson.glossary.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd></div>`).join("");
  const quiz = lesson.quiz.map((q, qi) => `<div class="q" data-q="${qi}"><p><b>${String(qi + 1).padStart(2, "0")}</b>${esc(q.q)}</p>
    ${q.a.map((a, ai) => `<label><input type="radio" name="q${qi}" value="${ai}"> <span>${esc(a)}</span></label>`).join("")}
    <div class="why" hidden>${esc(q.why)}</div></div>`).join("");
  const sources = lesson.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener"><span>${esc(s.title)}</span>${icons.external}</a></li>`).join("");
  const nextN = catalog.find((c) => c.n > lesson.n);

  const sec = (title, label, body, wide = false) =>
    `<section class="lesson-extra${wide ? " wide" : ""}"><div class="section-head"><h2>${title}</h2><span class="eyebrow">${label}</span></div>${body}</section>`;
  view.innerHTML = `
    <header class="lesson-head">
      <div class="eyebrow">${(() => { const pt = program.parts.find((p) => partEps(p).some((e) => e.n === lesson.n)); return pt ? `<a href="#/czesc/${pt.id}">‹ Część ${pt.id}</a>` : `<a href="#/">Kurs</a>`; })()}<span class="sep"></span><span class="accent">Odcinek ${lesson.n}</span></div>
      <h1>${esc(lesson.title)}</h1>
      <div class="sub">${esc(lesson.subtitle)}</div>
      <div class="meta">
        <div><small>Epoka</small><span>${esc(lesson.era)}</span></div>
        <div><small>Czas</small><span>ok. ${lesson.minutes} min</span></div>
        <div><small>Rozdziały</small><span>${nChapters}</span></div>
      </div>
    </header>
    <section class="player" aria-label="Odtwarzacz">
      <div class="now"><span class="dot"></span><span class="who">Gotowe do odtwarzania</span><span class="chap"></span></div>
      <div class="progress" title="Przewiń"><div></div><div class="ticks"></div></div>
      <div class="controls">
        <button class="small" data-action="prev-chapter" title="Poprzedni rozdział" aria-label="Poprzedni rozdział">${icons.prev}</button>
        <button data-action="back" title="Cofnij" aria-label="Cofnij">${icons.back}</button>
        <button class="play" data-action="toggle" aria-label="Odtwórz / pauza">${icons.play}</button>
        <button data-action="forward" title="Dalej" aria-label="Dalej">${icons.forward}</button>
        <button class="small" data-action="next-chapter" title="Następny rozdział" aria-label="Następny rozdział">${icons.next}</button>
      </div>
      <div class="tools">
        <button data-action="speed" title="Tempo">${player.speed.toFixed(2).replace(/0$/, "")}×</button>
        <button data-action="car">${icons.car}Tryb auto</button>
        <button data-action="ask">${icons.mic}Zadaj pytanie</button>
        <button data-action="offline" title="Zapisz na telefonie do słuchania bez internetu">${icons.download}<span>Offline</span></button>
      </div>
      <div class="mode-note"></div>
    </section>
    <section class="transcript">${tr}</section>
    ${gallery ? sec("Galeria", `${imgs.length} obrazów`, `<div class="gallery">${gallery}</div>`, true) : ""}
    ${glossary ? sec("Słowniczek", `${lesson.glossary.length} pojęć`, `<dl class="glossary">${glossary}</dl>`) : ""}
    ${quiz ? sec("Sprawdź się", `${lesson.quiz.length} pytania`, `<div class="quiz">${quiz}</div>`) : ""}
    ${sources ? sec("Źródła", "Materiały", `<ul class="sources">${sources}</ul>`) : ""}
    <div class="next-card"><div class="eyebrow">Następny odcinek</div>
      <p>${esc(lesson.next)}</p>
      ${nextN ? `<a class="btn" href="#/lekcja/${nextN.n}">Odcinek ${nextN.n} ${icons.arrow}</a>` : `<span class="muted">Kolejne odcinki w przygotowaniu.</span>`}
    </div>`;

  // podziałki rozdziałów na pasku postępu
  if (own) $(".progress .ticks", view).innerHTML = player.chapterFractions().map((f) => `<span style="left:${(f * 100).toFixed(2)}%"></span>`).join("");
  scrubber($(".progress", view), playerSource(ensureViewLesson));
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

// podpis dzieła: tytuł · twórca, okres, miejsce · (drobno) autor zdjęcia i licencja
const artMeta = (g) => [g.creator, g.date, g.place].filter(Boolean).join(" · ");
const photoCredit = (g) => {
  const lic = g.license && /^public domain$/i.test(g.license) ? "domena publiczna" : g.license;
  return g.artist ? `fot. ${[g.artist, lic].filter(Boolean).join(", ")}` : lic || "";
};
function figureHtml(g, cls = "") {
  const meta = artMeta(g), credit = photoCredit(g);
  return `<figure class="${cls}"><img loading="lazy" src="${esc(cls ? g.url || g.thumb : g.thumb)}" data-full="${esc(g.url || g.thumb)}" alt="${esc(g.caption)}" data-meta="${esc(meta)}" data-credit="${esc(credit)}">
    <figcaption><span class="ft">${esc(g.caption)}</span>${meta ? `<span class="fm">${esc(meta)}</span>` : ""}${credit ? `<a class="fc" href="${esc(g.page || "#")}" target="_blank" rel="noopener">${esc(credit)}</a>` : ""}</figcaption></figure>`;
}

function lightbox(img) {
  const d = document.createElement("div");
  d.className = "lightbox";
  d.innerHTML = `<div><img src="${esc(img.dataset.full)}" alt=""><p><strong>${esc(img.alt)}</strong>${img.dataset.meta ? `<br>${esc(img.dataset.meta)}` : ""}${img.dataset.credit ? `<br><small>${esc(img.dataset.credit)}</small>` : ""}</p></div>`;
  d.addEventListener("click", () => d.remove());
  document.body.append(d);
}

// ---------- Aktualizacja odtwarzacza ----------
let lastCur = -1;
function updatePlayerUI(force = false) {
  const it = player.current;
  const sp = it?.sp ? speakers[it.sp] : null;
  const who = it ? (it.kind === "jingle" ? "Sygnał" : it.kind === "outro" ? "Zakończenie" : it.kind === "sting" ? "Rozdział" : sp?.name) : "";
  const color = sp?.color || "var(--accent)";
  const state = player.playing ? "pause" : "play";
  const setIcon = (el) => { if (el && el.dataset.state !== state) { el.dataset.state = state; el.innerHTML = icons[state]; } };

  // mini odtwarzacz
  const mp = $("#miniplayer");
  if (player.lesson) {
    mp.hidden = false;
    setIcon($(".mp-toggle", mp));
    $(".mp-title", mp).textContent = `${player.lesson.n}. ${player.lesson.title}`;
    $(".mp-sub", mp).textContent = [who, it?.chapterTitle].filter(Boolean).join(" · ");
    $(".mp-info", mp).href = `#/lekcja/${player.lesson.n}`;
  }
  // tryb samochodowy
  const car = $("#carmode");
  if (!car.hidden) {
    $(".car-ep", car).textContent = `Odcinek ${player.lesson?.n}. ${player.lesson?.title}`;
    $(".car-speaker .name", car).textContent = who || "";
    $(".car-speaker .dot", car).style.background = color;
    $(".car-chapter", car).textContent = it?.chapterTitle || "";
    if (!scrubbing()) $(".car-progress > div", car).style.width = `${(player.progress * 100).toFixed(1)}%`;
    setIcon($(".car-play", car));
    carVisual(it?.chapter ?? 0);
  }
  // odtwarzacz na stronie lekcji
  const pl = $(".player", view);
  if (pl && player.lesson && location.hash === `#/lekcja/${player.lesson.n}`) {
    $(".now .dot", pl).style.background = color;
    $(".now .who", pl).textContent = who || "Gotowe do odtwarzania";
    $(".now .chap", pl).textContent = it?.chapterTitle && it.chapterTitle !== player.lesson.title ? it.chapterTitle : "";
    if (!scrubbing()) $(".progress > div", pl).style.width = `${(player.progress * 100).toFixed(1)}%`;
    setIcon($(".play", pl));
    $('[data-action="speed"]', pl).textContent = `${String(player.speed).replace(".", ",")}×`;
    $(".mode-note", pl).textContent = player.mode === "mp3"
      ? "Nagranie z naturalnymi głosami · działa przy zgaszonym ekranie"
      : ttsSupported() ? `Syntezator urządzenia · ${polishVoices().length} polskich głosów · nie wygaszaj ekranu` : "Ta przeglądarka nie obsługuje syntezy mowy.";
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
  // tryb auto: blokadę ekranu włączamy od razu, jeszcze w geście użytkownika
  if (a === "car") { openCar(!!b.closest("#view .player")); return; }
  if (a === "car-close") { closeCar(); return; }
  if (a === "car-img") {
    if (carState.list.length > 1) { carState.pos = (carState.pos + 1) % carState.list.length; showCarImage(); }
    return;
  }
  if (b.closest("#view .player") && a !== "speed") await ensureViewLesson();
  if (a === "toggle") player.toggle();
  else if (a === "back") player.back();
  else if (a === "forward") player.forward();
  else if (a === "next-chapter") player.nextChapter();
  else if (a === "prev-chapter") player.prevChapter();
  else if (a === "speed") {
    const i = SPEEDS.indexOf(player.speed);
    player.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  } else if (a === "ask") {
    openAsk(player, speakers);
  } else if (a === "offline") {
    saveOffline(b);
  } else if (a === "test-voice") {
    const k = b.dataset.sp;
    stopSpeaking();
    speak(`Dzień dobry. Tu ${speakers[k].name}, KULTURA. Moja dziedzina to ${speakers[k].role}.`, speakerVoiceParams(k, speakers));
  }
});
// ---------- Indeks osób i liczby ----------
let indexData = null;
const getIndex = async () => (indexData ||= await getJSON("data/index.json"));
const CATS = {
  malarz: "Malarze", rzeźbiarz: "Rzeźbiarze", architekt: "Architekci i urbaniści", projektant: "Projektanci", fotograf: "Fotografowie",
  filmowiec: "Filmowcy", muzyk: "Muzycy", pisarz: "Pisarze i poeci", filozof: "Filozofowie", naukowiec: "Badacze i naukowcy",
  polityk: "Politycy i władcy", przemysłowiec: "Przemysłowcy", inne: "Inne postaci",
};
const CAT1 = {
  malarz: "malarz", rzeźbiarz: "rzeźbiarz", architekt: "architekt", projektant: "projektant", fotograf: "fotograf", filmowiec: "filmowiec",
  muzyk: "muzyka", pisarz: "literatura", filozof: "filozofia", naukowiec: "nauka", polityk: "polityka", przemysłowiec: "przemysł", inne: "inne",
};
const yr = (y) => (y == null ? "" : y < 0 ? `${-y} p.n.e.` : String(y));
const lifespan = (p) => (p.legend ? "postać legendarna" : p.born == null ? "" : p.died ? `${yr(p.born)}–${yr(p.died)}` : `ur. ${yr(p.born)}`);
const surname = (p) => {
  const parts = p.name.replace(/ (z|de|van|von) .*/, "").split(/\s+/);
  return (p.sortKey || parts[parts.length - 1]).replace(/^Le$/, "Le Corbusier");
};
const plSort = (a, b) => a.localeCompare(b, "pl");

async function renderIndex() {
  const { people } = await getIndex();
  const LS = { urodzeni: "urodzeni w Łodzi", mieszkali: "mieszkali i tworzyli w Łodzi", epizod: "epizod łódzki", temat: "Łódź w twórczości", brak: "brak związku z Łodzią" };
  const inLodz = (p) => p.lodz || ["urodzeni", "mieszkali", "epizod", "temat"].includes(p.ls);
  const list = people.filter((p) => p.total > 0 || p.works?.length).map((p) => ({ ...p, lodz: inLodz(p), key: p.name === "Le Corbusier" ? "Le Corbusier" : surname(p) }));
  list.sort((a, b) => plSort(a.key, b.key) || plSort(a.name, b.name));
  const cats = Object.entries(list.reduce((m, p) => ((m[p.c] = (m[p.c] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const lessonTitle = (n) => catalog.find((c) => c.n === n)?.title || `Odcinek ${n}`;
  const item = (p) => `<li class="person" data-c="${p.c}" data-pl="${p.pl ? 1 : 0}" data-lodz="${p.lodz ? 1 : 0}" data-ls="${p.ls || ""}" data-works="${p.works?.length ? 1 : 0}" data-q="${esc((p.name + " " + p.desc + " " + (p.country || "") + " " + (CATS[p.c] || "") + (p.lodz ? " łódź łodzi" : "") + (p.pl ? " polska polak" : "") + " " + (p.works || []).join(" ")).toLowerCase())}">
      <div class="pn"><strong>${esc(p.name)}</strong><span class="pdates">${lifespan(p)}</span></div>
      <div class="pd">${esc(p.desc)}${p.country ? ` · <span class="muted">${esc(p.country)}</span>` : ""}${p.lodz ? ` <span class="tag">Łódź</span>` : ""}</div>
      <div class="pm">${p.mentions.length ? p.mentions.map((m) => `<a href="#/lekcja/${m.n}/z/${m.i}" title="${esc(lessonTitle(m.n))}">Odc. ${m.n}${m.count > 1 ? ` <span>×${m.count}</span>` : ""}</a>`).join("") : `<span class="pm-none">w kolejnych odcinkach</span>`}</div>
      ${p.works?.length || p.lodzLink ? `<details class="pw"><summary>${p.works?.length ? `Twórczość · ${p.works.length}` : "Więcej"}${p.ls ? ` · <span class="ls ls-${p.ls}">${LS[p.ls]}</span>` : ""}${p.verify ? ` <span class="verify">do weryfikacji</span>` : ""}</summary>
        ${p.lodzLink ? `<p class="plodz">${esc(p.lodzLink)}</p>` : ""}
        ${p.works?.length ? `<ul class="works">${p.works.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      </details>` : ""}
    </li>`;
  const groups = {};
  for (const p of list) (groups[p.key[0].toUpperCase()] ||= []).push(p);
  view.innerHTML = `
    <header class="page-head">
      <div class="eyebrow">Indeks</div>
      <h1>Osoby</h1>
      <p>Wszyscy, o których mówimy w kursie — od archeologów i filozofów po malarzy, muzyków i łódzkich fabrykantów — oraz osoby związane z Łodzią z wybraną twórczością. Dotknij odcinka, aby przejść do miejsca, w którym pada nazwisko.</p>
    </header>
    <div class="index-tools">
      <input type="search" class="index-search" placeholder="Szukaj: nazwisko, dziedzina, kraj…" aria-label="Szukaj w indeksie">
      <div class="chips" role="group" aria-label="Filtr">
        <button class="chip on" data-f="all">Wszyscy <span>${list.length}</span></button>
        <button class="chip" data-f="pl">Polacy <span>${list.filter((p) => p.pl).length}</span></button>
        <button class="chip" data-f="lodz">Łódź <span>${list.filter((p) => p.lodz).length}</span></button>
        <button class="chip" data-f="ls:urodzeni">Urodzeni w Łodzi <span>${list.filter((p) => p.ls === "urodzeni").length}</span></button>
        <button class="chip" data-f="works">Z twórczością <span>${list.filter((p) => p.works?.length).length}</span></button>
        ${cats.map(([c, k]) => `<button class="chip" data-f="c:${c}">${CATS[c] || c} <span>${k}</span></button>`).join("")}
      </div>
    </div>
    <div class="az">${Object.keys(groups).map((L) => `<a href="#" data-l="${L}">${L}</a>`).join("")}</div>
    <div class="index-list">
      ${Object.entries(groups).map(([L, ps]) => `<section class="letter" id="litera-${L}"><h2>${L}</h2><ul>${ps.map(item).join("")}</ul></section>`).join("")}
      <p class="index-empty" hidden>Nikogo nie znaleziono.</p>
    </div>`;
  let filter = "all";
  const apply = () => {
    const q = $(".index-search", view).value.trim().toLowerCase();
    let shown = 0;
    view.querySelectorAll(".person").forEach((li) => {
      const okF = filter === "all" || (filter === "pl" && li.dataset.pl === "1") || (filter === "lodz" && li.dataset.lodz === "1") ||
        (filter === "works" && li.dataset.works === "1") || filter === `c:${li.dataset.c}` || filter === `ls:${li.dataset.ls}`;
      const ok = okF && (!q || li.dataset.q.includes(q));
      li.hidden = !ok; if (ok) shown++;
    });
    view.querySelectorAll(".letter").forEach((s) => { s.hidden = !s.querySelector(".person:not([hidden])"); });
    $(".index-empty", view).hidden = shown > 0;
  };
  $(".index-search", view).addEventListener("input", apply);
  view.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.f;
    view.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    apply();
  }));
  view.querySelectorAll(".az a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById(`litera-${a.dataset.l}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function jumpToSentence(n, i) {
  const el = view.querySelector(`.s[data-i="${i}"]`);
  if (player.lesson?.n === n && !player.playing) player.seek(i);
  if (!el) return;
  setTimeout(() => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 2600);
  }, 150);
}

// poziome słupki: etykieta · słupek · wartość (z dymkiem po najechaniu)
function bars(rows, { max, unit = "", dot } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.v));
  return `<div class="bars">${rows.map((r) => `
    <div class="bar-row" title="${esc(r.label)}: ${r.v}${unit ? " " + unit : ""}${r.note ? " — " + esc(r.note) : ""}">
      <span class="bl">${r.color ? `<i style="background:${r.color}"></i>` : ""}${r.href ? `<a href="${r.href}">${esc(r.label)}</a>` : esc(r.label)}</span>
      <span class="bt"><span class="bf${r.muted ? " muted" : ""}" style="width:${Math.max(r.v ? 1.5 : 0, (100 * r.v) / m).toFixed(1)}%"></span>${r.v2 != null ? `<span class="bf2" style="width:${((100 * r.v2) / m).toFixed(1)}%"></span>` : ""}</span>
      <span class="bv">${r.text ?? r.v}</span>
    </div>`).join("")}</div>`;
}
const nf = (x) => Number(x).toLocaleString("pl-PL");
const centName = (c) => {
  const R = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"];
  return c < 0 ? `${R[-c]} w. p.n.e.` : `${R[c]} w.`;
};

async function renderStats() {
  const { people, stats: s } = await getIndex();
  const done = new Set(store.get("done", []));
  const doneMin = catalog.filter((c) => done.has(c.n)).reduce((a, c) => a + c.minutes, 0);
  const mentioned = people.filter((p) => p.total > 0);
  const top = [...mentioned].sort((a, b) => b.total - a.total || b.mentions.length - a.mentions.length).slice(0, 10);
  const cats = Object.entries(s.people.byCategory).sort((a, b) => b[1] - a[1]);
  const cents = Object.entries(s.people.byCentury).map(([c, v]) => [Number(c), v]).sort((a, b) => a[0] - b[0]);
  const spk = Object.entries(s.speakers).sort((a, b) => b[1] - a[1]);
  const spTotal = spk.reduce((a, [, v]) => a + v, 0);
  const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))}%`;
  const fig = (v, label, sub = "") => `<div class="fig"><b>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const block = (title, label, body) => `<section class="stat-block"><div class="section-head"><h2>${title}</h2><span class="eyebrow">${label}</span></div>${body}</section>`;
  const lessonsSorted = [...s.lessons].sort((a, b) => a.n - b.n);
  view.innerHTML = `
    <header class="page-head">
      <div class="eyebrow">Liczby · stan na ${new Date(s.generated).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })}</div>
      <h1>Kurs w liczbach</h1>
      <p>Wszystko, co da się policzyć: od epok i stuleci po malarzy, muzyków i to, ile razy pada słowo „Łódź”. Liczby rosną z każdym nowym odcinkiem.</p>
    </header>

    <div class="figs big">
      ${fig(nf(s.course.planned), "odcinków w programie", `${s.course.ready} gotowych · ${pct(s.course.ready, s.course.planned)}`)}
      ${fig(s.course.yearsSpan ? `${nf(Math.round(s.course.yearsSpan / 1000))}&thinsp;tys.` : "—", "lat historii", "od pierwszych malowideł do dziś")}
      ${fig(s.course.parts, "części", `${s.course.sections} epok i okresów`)}
      ${fig(`~${s.course.plannedHours}&thinsp;h`, "nagrań po ukończeniu", `${s.course.experts} ekspertów + gospodarz`)}
    </div>

    ${block("Twoje słuchanie", "Postęp", `
      <div class="figs">
        ${fig(`${done.size}<small> / ${s.course.planned}</small>`, "wysłuchanych odcinków", `${pct(done.size, s.course.ready)} gotowych`)}
        ${fig(`${doneMin}<small> min</small>`, "wysłuchanego czasu", `z ${s.ready.minutes} min dostępnych`)}
      </div>
      <div class="meter" title="${done.size} z ${s.course.planned} odcinków"><span style="width:${(100 * done.size) / s.course.planned}%"></span><span class="m2" style="width:${(100 * (s.course.ready - done.size)) / s.course.planned}%"></span></div>
      <div class="meter-legend"><span><i class="k1"></i>wysłuchane</span><span><i class="k2"></i>gotowe do słuchania</span><span><i class="k3"></i>w przygotowaniu</span></div>`)}

    ${block("Gotowe odcinki", `${s.course.ready} odcinków`, `
      <div class="figs">
        ${fig(s.ready.minutes, "minut nagrań")}
        ${fig(nf(s.ready.words), "słów", `${nf(s.ready.sentences)} zdań`)}
        ${fig(s.ready.chapters, "rozdziałów")}
        ${fig(s.ready.images, "obrazów")}
        ${fig(s.ready.glossary, "pojęć w słowniczkach")}
        ${fig(s.ready.quiz, "pytań w quizach")}
        ${fig(s.ready.sources, "źródeł")}
        ${fig(s.ready.music, "utworów do posłuchania")}
      </div>
      <h3 class="sub-h">Długość odcinków</h3>
      ${bars(lessonsSorted.map((l) => ({ label: `${l.n}. ${l.title}`, v: l.minutes, text: `${l.minutes} min`, href: `#/lekcja/${l.n}`, note: l.era })), { unit: "min" })}`)}

    ${block("Ludzie", `${s.people.total} osób · ${s.people.mentions} wzmianek`, `
      <div class="figs">
        ${fig(s.people.byCategory.malarz || 0, "malarzy")}
        ${fig(s.people.byCategory.muzyk || 0, "muzyków")}
        ${fig(s.people.byCategory.pisarz || 0, "pisarzy i poetów")}
        ${fig(s.people.byCategory.architekt || 0, "architektów")}
        ${fig(s.people.byCountry.Polska || 0, "Polaków", `${pct(s.people.byCountry.Polska || 0, s.people.total)} wszystkich`)}
        ${fig(s.people.byGender.f || 0, "kobiet", `${pct(s.people.byGender.f || 0, s.people.total)} wszystkich`)}
      </div>
      <div class="cols">
        <div><h3 class="sub-h">Według dziedziny</h3>${bars(cats.map(([c, v]) => ({ label: CATS[c] || c, v, href: "#/indeks" })))}</div>
        <div><h3 class="sub-h">Najczęściej wymieniani</h3>${bars(top.map((p) => ({ label: p.name, v: p.total, text: `${p.total}×`, note: p.desc, href: `#/lekcja/${p.mentions[0].n}/z/${p.mentions[0].i}` })), { unit: "wzmianek" })}</div>
      </div>
      <h3 class="sub-h">Według stulecia urodzin</h3>
      <div class="hist">${cents.map(([c, v]) => `<div class="hcol" title="${centName(c)}: ${v} ${v === 1 ? "osoba" : v < 5 ? "osoby" : "osób"}"><span class="hv">${v}</span><span class="hb" style="height:${(100 * v) / Math.max(...cents.map((x) => x[1]))}%"></span><span class="hl">${centName(c).replace(" w.", "").replace(" p.n.e.", "<br>p.n.e.")}</span></div>`).join("")}</div>`)}

    ${block("Łódź", `${s.ready.lodz} wzmianek`, `
      <div class="figs">
        ${fig(s.ready.lodz, "razy pada „Łódź”", "w gotowych odcinkach")}
        ${fig(s.lessons.filter((l) => l.lodz).length, "odcinków z Łodzią", `na ${s.course.ready} gotowych`)}
        ${fig(s.lodzEpisodes.length, "odcinków o Łodzi w programie", `${s.lodzEpisodes.filter((e) => e.ready).length} gotowych`)}
        ${fig(s.people.lodzAll ?? s.people.lodz, "osób związanych z Łodzią", `${s.people.withWorks || 0} z opisem twórczości`)}
      </div>
      <h3 class="sub-h">Osoby związane z Łodzią — siła związku</h3>
      ${bars([["urodzeni", "Urodzeni w Łodzi"], ["mieszkali", "Mieszkali i tworzyli w Łodzi"], ["epizod", "Epizod łódzki"], ["temat", "Łódź w twórczości"], ["brak", "Brak związku (z listy do sprawdzenia)"]]
        .map(([k, label]) => ({ label, v: s.people.lodzStrength?.[k] || 0, href: "#/indeks", muted: k === "brak" })), { unit: "osób" })}
      <h3 class="sub-h">Wzmianki o Łodzi w odcinkach</h3>
      ${bars(lessonsSorted.map((l) => ({ label: `${l.n}. ${l.title}`, v: l.lodz, href: `#/lekcja/${l.n}` })), { unit: "wzmianek" })}
      <h3 class="sub-h">Łódzkie odcinki w programie</h3>
      <ul class="plain">${s.lodzEpisodes.map((e) => `<li class="${e.ready ? "" : "muted"}"><span class="num">${String(e.n).padStart(3, "0")}</span>${e.ready ? `<a href="#/lekcja/${e.n}">${esc(e.title)}</a>` : esc(e.title)}</li>`).join("")}</ul>`)}

    ${block("Program", `${s.course.parts} części`, `
      <div class="cols">
        <div><h3 class="sub-h">Odcinki w częściach</h3>
          ${bars(s.parts.map((p) => ({ label: `${p.id}. ${p.title.split(" — ")[0]}`, v: p.episodes, v2: p.ready, text: p.ready ? `${p.ready}/${p.episodes}` : p.episodes, note: p.title })), { unit: "odcinków" })}
          <div class="meter-legend"><span><i class="k2"></i>w programie</span><span><i class="k1"></i>gotowe</span></div></div>
        <div><h3 class="sub-h">Dziedziny w tytułach odcinków</h3>
          ${bars([...s.domains].sort((a, b) => b.count - a.count).map((d) => ({ label: d.name, v: d.count })), { unit: "odcinków" })}
          <p class="note">Odcinek może należeć do kilku dziedzin.</p></div>
      </div>`)}

    ${block("Głosy", "Kto mówi najwięcej", `
      ${bars(spk.map(([k, v]) => ({ label: speakers[k]?.name || k, v, text: pct(v, spTotal), color: speakers[k]?.color, note: `${nf(v)} słów` })), { unit: "słów" })}`)}

    <p class="note">Liczby obejmują gotowe odcinki; program liczy wszystkie zaplanowane. Postęp słuchania zapisuje się na tym urządzeniu.</p>`;
}

// ---------- Przewijanie z podglądem zdania ----------
const scrubbing = () => document.documentElement.classList.contains("is-scrubbing");
const fmtTime = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
let tip = null;
function scrubTip() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "scrubtip";
  tip.hidden = true;
  tip.innerHTML = `<div class="st-meta"><span class="st-time"></span><span class="st-dot"></span><span class="st-who"></span><span class="st-chap"></span></div><div class="st-text"></div>`;
  document.body.append(tip);
  return tip;
}
function showTip(bar, f, info) {
  const t = scrubTip();
  const it = info.item;
  const sp = it?.sp ? speakers[it.sp] : null;
  $(".st-time", t).textContent = `${fmtTime(info.sec)} / ${fmtTime(info.total)}`;
  $(".st-dot", t).style.background = sp?.color || "var(--accent)";
  $(".st-who", t).textContent = it?.kind === "speech" ? (sp?.name || "") : it?.kind === "sting" ? "Rozdział" : "Sygnał";
  $(".st-chap", t).textContent = it?.chapterTitle || "";
  $(".st-text", t).textContent = it?.kind === "speech" ? it.text : it?.chapterTitle || "";
  t.hidden = false;
  const r = bar.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight;
  const x = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + f * r.width - w / 2));
  const above = r.top - h - 18;
  t.style.left = `${x}px`;
  t.style.top = `${above > 8 ? above : r.bottom + 18}px`;
  t.style.setProperty("--arrow", `${Math.max(16, Math.min(w - 16, r.left + f * r.width - x))}px`);
  t.classList.toggle("below", above <= 8);
}
// źródło danych dla paska: odtwarzacz (lekcja otwarta) albo sam plik lekcji (lista odcinków)
function playerSource(prepare) {
  return {
    async ready() { if (prepare) await prepare(); return !!player.lesson; },
    at(f) { const a = player.at(f); return { ...a, item: player.items[a.index] }; },
    commit(f, a) { if (player.mode === "mp3") player.seekFraction(f); else player.seek(a.index); },
  };
}
function lessonSource(n) {
  let data = null;
  return {
    async ready() {
      if (player.lesson?.n === n) { data = null; return true; }
      if (!data) {
        const lesson = await (await fetch(`data/lessons/${String(n).padStart(3, "0")}.json`)).json();
        const items = buildItems(lesson);
        const w = items.map((it) => (it.kind === "speech" ? it.text.length : it.kind === "jingle" ? 120 : it.kind === "outro" ? 60 : 25));
        const cum = []; let acc = 0; for (const x of w) { cum.push(acc); acc += x; }
        data = { lesson, items, cum, total: acc };
      }
      return true;
    },
    at(f) {
      if (!data) { const a = player.at(f); return { ...a, item: player.items[a.index] }; }
      const target = f * data.total;
      let i = data.cum.findIndex((c) => c > target); if (i < 0) i = data.items.length;
      const index = Math.max(0, i - 1), total = (data.lesson.minutes || 15) * 60;
      return { index, sec: f * total, total, item: data.items[index] };
    },
    commit(f, a) {
      if (!data) { player.mode === "mp3" ? player.seekFraction(f) : player.seek(a.index); }
      else store.set(`pos:${n}`, a.index);
      location.hash = `#/lekcja/${n}`;
    },
  };
}
function scrubber(bar, src) {
  if (!bar) return;
  let active = false, f = 0, info = null, id = null;
  const frac = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const fill = () => bar.querySelector(":scope > div:first-child");
  const move = (e) => {
    if (!active) return;
    f = frac(e);
    info = src.at(f);
    const el = fill(); if (el) el.style.width = `${(f * 100).toFixed(2)}%`;
    bar.style.setProperty("--f", f);
    showTip(bar, f, info);
  };
  bar.addEventListener("pointerdown", async (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    id = e.pointerId;
    try { bar.setPointerCapture(id); } catch {}
    bar.classList.add("scrubbing");
    document.documentElement.classList.add("is-scrubbing");
    active = await src.ready();
    move(e);
  });
  bar.addEventListener("pointermove", move);
  const end = (commit) => {
    if (!bar.classList.contains("scrubbing")) return;
    bar.classList.remove("scrubbing");
    document.documentElement.classList.remove("is-scrubbing");
    if (tip) tip.hidden = true;
    if (active && commit && info) src.commit(f, info);
    active = false;
    updatePlayerUI(true);
  };
  bar.addEventListener("pointerup", () => end(true));
  bar.addEventListener("pointercancel", () => end(false));
  bar.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
}

// okładka na ekranie blokady: obrazy bieżącego rozdziału, zmiana co kilka zdań
player.artworkFor = (lesson, it, index) => {
  const list = imagesForChapter(lesson, it?.chapter ?? 0).filter((g) => g.url || g.thumb);
  if (!list.length) return null;
  const g = list[Math.floor(index / 8) % list.length];
  return { src: g.url || g.thumb, thumb: g.thumb, caption: g.caption, meta: artMeta(g) };
};

// ---------- Tryb auto ----------
function openCar(fromLessonView) {
  keepAwake.enable();
  const car = $("#carmode");
  car.hidden = false;
  document.documentElement.classList.add("car-open");
  clearInterval(carState.timer);
  carState = { lesson: null, key: null, list: [], pos: 0, shownUrl: null, layer: 0, timer: null };
  document.documentElement.requestFullscreen?.().catch(() => {});
  if (fromLessonView) ensureViewLesson().then(() => updatePlayerUI(true));
  updatePlayerUI(true);
}
function closeCar() {
  keepAwake.disable();
  $("#carmode").hidden = true;
  document.documentElement.classList.remove("car-open");
  clearInterval(carState.timer);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// obrazy bieżącego rozdziału; gdy rozdział nie ma własnych — ostatnie wcześniejsze
let carState = { lesson: null, list: [], pos: 0, shownUrl: null, layer: 0, timer: null };
function imagesForChapter(lesson, ch) {
  const by = chapterImages(lesson);
  for (let c = ch; c >= 0; c--) if (by[c]?.length) return by[c];
  const first = Object.keys(by).map(Number).sort((x, y) => x - y)[0];
  return first != null ? by[first] : [];
}
function carVisual(ch) {
  const lesson = player.lesson;
  const box = $("#carmode .car-visual");
  if (!lesson || !box) return;
  const list = imagesForChapter(lesson, ch);
  const key = list.map((g) => g.url || g.thumb).join("|");
  if (carState.lesson !== lesson.n || carState.key !== key) {
    carState.lesson = lesson.n;
    carState.key = key;
    carState.list = list;
    carState.pos = 0;
    clearInterval(carState.timer);
    // kilka obrazów w rozdziale — zmieniają się co 14 s
    if (list.length > 1) carState.timer = setInterval(() => { carState.pos = (carState.pos + 1) % carState.list.length; showCarImage(); }, 14000);
    showCarImage();
  }
  box.hidden = !list.length;
}
function showCarImage() {
  const g = carState.list[carState.pos];
  const box = $("#carmode .car-visual");
  if (!g || !box) return;
  const src = g.url || g.thumb;
  if (carState.shownUrl === src) return;
  carState.shownUrl = src;
  const layers = box.querySelectorAll(".cv-layer");
  const next = layers[carState.layer ^ 1];
  const cur = layers[carState.layer];
  const pre = new Image();
  pre.onload = pre.onerror = () => {
    if (carState.shownUrl !== src) return;
    next.querySelectorAll("img").forEach((im) => { im.src = src; });
    next.classList.add("on");
    cur.classList.remove("on");
    carState.layer ^= 1;
    const meta = artMeta(g);
    $(".cv-caption", box).innerHTML = `<strong>${esc(g.caption)}</strong>${meta ? `<br>${esc(meta)}` : ""}`;
    $(".cv-count", box).textContent = carState.list.length > 1 ? `${carState.pos + 1} / ${carState.list.length}` : "";
  };
  pre.src = src;
}
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog")) return;
  if (e.code === "Space" && player.lesson) { e.preventDefault(); player.toggle(); }
});

async function saveOffline(btn) {
  if (!player.lesson || !("caches" in window)) return;
  btn.disabled = true;
  btn.lastElementChild.textContent = "Zapisuję…";
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
  btn.lastElementChild.textContent = ok === urls.length ? "Zapisano offline" : `Zapisano ${ok}/${urls.length}`;
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
    <header class="page-head">
      <div class="eyebrow">Ustawienia</div>
      <h1>Głosy ekspertów</h1>
      <p>Każdy ekspert może mówić innym głosem. Najlepszą jakość dają nagrania MP3 z naturalnymi głosami — wtedy poniższy wybór głosów nie jest używany.</p>
    </header>
    ${!ttsSupported() ? `<div class="notice warn">Ta przeglądarka nie obsługuje syntezy mowy.</div>` : voices.length < 2 ? `<div class="notice warn">${voices.length ? "To urządzenie ma tylko jeden polski głos syntezatora, więc eksperci różnią się wysokością głosu." : "To urządzenie nie ma polskiego głosu syntezatora."} Więcej głosów: na iPhonie Ustawienia → Dostępność → Treść mówiona → Głosy → Polski (pobierz wersje „ulepszone”); na Androidzie ustawienia „Zamiana tekstu na mowę” Google z pakietem polskim; na komputerze przeglądarka Edge ma naturalne głosy Marek i Zofia.</div>` : ""}
    <div class="settings">
      <div class="group">Eksperci</div>
      ${Object.entries(speakers).map(([k, s]) => `
        <div class="row">
          <div class="lbl"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</div>
          <div class="ctl">
            <select data-sp="${k}">${opts(k)}</select>
            <label class="muted">wysokość <input type="range" min="0.6" max="1.5" step="0.05" value="${store.get("pitchMap", {})[k] ?? s.pitch}" data-pitch="${k}"></label>
            <button class="btn ghost" data-action="test-voice" data-sp="${k}">Posłuchaj</button>
          </div>
        </div>`).join("")}
      <div class="group">Odtwarzanie</div>
      <div class="row"><div class="lbl">Nagrania MP3</div><div class="ctl"><label><input type="checkbox" id="preferMp3" ${store.get("preferMp3", true) ? "checked" : ""}> używaj nagrań z naturalnymi głosami, gdy są dostępne</label></div></div>
      <div class="row"><div class="lbl">Automatycznie dalej</div><div class="ctl"><label><input type="checkbox" id="autonext" ${store.get("autonext", true) ? "checked" : ""}> po zakończeniu odcinka włącz następny</label></div></div>
      <div class="row"><div class="lbl">Przewijanie tekstu</div><div class="ctl"><label><input type="checkbox" id="autoscroll" ${store.get("autoscroll", true) ? "checked" : ""}> przewijaj transkrypcję za lektorem</label></div></div>
      <div class="group">Aplikacja</div>
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
  const section = h.startsWith("#/ustawienia") ? "settings" : h.startsWith("#/indeks") ? "index" : h.startsWith("#/liczby") ? "stats" : "home";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  const m = h.match(/^#\/lekcja\/(\d+)(?:\/z\/(\d+))?/);
  const pm = h.match(/^#\/czesc\/([IVXL]+)/);
  lastCur = -1;
  if (m) {
    await renderLesson(Number(m[1]));
    if (m[2] != null) jumpToSentence(Number(m[1]), Number(m[2]));
  }
  else if (pm) renderPart(pm[1]);
  else if (section === "settings") await renderSettings();
  else if (section === "index") await renderIndex();
  else if (section === "stats") await renderStats();
  else renderHome();
  if (!m) window.scrollTo(0, 0);
  updatePlayerUI(true);
}

async function init() {
  applyTheme();
  scrubber($("#carmode .car-progress"), playerSource());
  document.querySelectorAll("[data-icon]").forEach((el) => { el.insertAdjacentHTML("afterbegin", icons[el.dataset.icon]); });
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
