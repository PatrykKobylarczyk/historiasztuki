// Buduje indeks osób i analitykę kursu: data/index.json
// Uruchom po build-lessons: node scripts/build-index.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildItems } from "../js/items.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const program = read("data/program.json");
const speakers = read("data/speakers.json");
const { people } = read("data/people.json");
const lessonFiles = fs.readdirSync(path.join(root, "data/lessons")).filter((f) => f.endsWith(".json")).sort();
const lessons = lessonFiles.map((f) => read(`data/lessons/${f}`));

const words = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;
const LODZ = /(?<!\p{L})(?:Łód[źzk]\p{L}*|Łodz\p{L}*|łódzk\p{L}*|Łódzk\p{L}*)/gu;
const POLSKA = /(?<!\p{L})(?:Polsk\p{L}*|Polsce|Polską|polsk\p{L}*|Polac\p{L}*|Polak\p{L}*)/gu;

// ---------- osoby ----------
const compiled = people.map((p) => ({
  ...p,
  re: new RegExp(p.m.map((m) => `(?<!\\p{L})(?:${m})`).join("|"), "gu"),
}));

const out = compiled.map(({ re, m, only, ...p }) => ({ ...p, mentions: [], total: 0 }));
const byId = Object.fromEntries(out.map((p) => [p.id, p]));

const perLesson = [];
for (const lesson of lessons) {
  const items = buildItems(lesson);
  const speech = lesson.segments.filter((s) => s.t === "speech");
  const text = speech.map((s) => s.text).join("\n");
  const spWords = {};
  for (const s of speech) spWords[s.sp] = (spWords[s.sp] || 0) + words(s.text);
  const lodz = (text.match(LODZ) || []).length;
  const polska = (text.match(POLSKA) || []).length;
  const found = [];
  for (const p of compiled) {
    if (p.only && !p.only.includes(lesson.n)) continue;
    let count = 0, first = -1;
    items.forEach((it, i) => {
      if (it.kind !== "speech" || it.announce) return;
      const k = (it.text.match(p.re) || []).length;
      if (k) { count += k; if (first < 0) first = i; }
    });
    if (count) {
      byId[p.id].mentions.push({ n: lesson.n, count, i: first });
      byId[p.id].total += count;
      found.push(p.id);
    }
  }
  perLesson.push({
    n: lesson.n,
    title: lesson.title,
    era: lesson.era,
    minutes: lesson.minutes,
    words: words(text),
    sentences: items.filter((it) => it.kind === "speech" && !it.announce).length,
    chapters: lesson.segments.filter((s) => s.t === "chapter").length,
    images: lesson.gallery.length,
    glossary: lesson.glossary.length,
    quiz: lesson.quiz.length,
    sources: lesson.sources.length,
    music: lesson.segments.filter((s) => s.t === "music").length,
    lodz,
    polska,
    people: found.length,
    speakers: spWords,
  });
}

// ---------- program ----------
const allEps = program.parts.flatMap((p) => p.sections.flatMap((s) => s.episodes.map((e) => ({ ...e, part: p.id }))));
const ready = new Set(lessons.map((l) => l.n));
const DOMAINS = [
  ["Łódź", /Łód[źz]|Łodz|łódz/i],
  ["Architektura i miasto", /architekt|urbanist|budowl|katedr|świątyn|pałac|miast|osiedl|blok|wielka płyta|wnętrz|dom/i],
  ["Malarstwo i rzeźba", /malarstw|malarz|rzeźb|obraz|fresk|impresjon|ekspresjon|kubizm|abstrakc|surrealiz|pop-art|grafik|plakat|sztuk[ai] (?:współ|nowo)|awangard/i],
  ["Muzyka", /muzyk|jazz|rock|opera|chopin|bach|mozart|dźwięk|pieś|kompoz|punk|blues/i],
  ["Literatura i filozofia", /literatur|poezj|poet|powieś|filozof|teatr|dramat|egzystencj|myśl|reportaż/i],
  ["Film i fotografia", /kino|film|fotograf|reportaż|obrazu/i],
  ["Design i rzemiosło", /design|wzornictw|projekt|mebl|ceramik|porcelan|przedmiot|ornament|tkanin|szkł/i],
  ["Moda", /mod[ay]|ubior|strój|garnitur|krawiect|elegancj/i],
  ["Polityka i społeczeństwo", /wojn|rewolucj|polityk|państw|propagand|totalitar|solidarn|władz|imperi|kryzys|społecz/i],
];
const domains = DOMAINS.map(([name, re]) => ({ name, count: allEps.filter((e) => re.test(e.title)).length }));

const parts = program.parts.map((p) => {
  const eps = p.sections.flatMap((s) => s.episodes);
  return { id: p.id, title: p.title, episodes: eps.length, ready: eps.filter((e) => ready.has(e.n)).length, sections: p.sections.filter((s) => s.title).length || 1 };
});

// ---------- osoby: przekroje ----------
const mentioned = out.filter((p) => p.total > 0);
const count = (arr, key) => arr.reduce((m, x) => { const k = key(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
const century = (y) => (y == null ? null : y < 0 ? -Math.floor((-y - 1) / 100) - 1 : Math.floor((y - 1) / 100) + 1);

const sum = (k) => perLesson.reduce((a, l) => a + (typeof k === "function" ? k(l) : l[k]), 0);
const spTotals = {};
for (const l of perLesson) for (const [k, v] of Object.entries(l.speakers)) spTotals[k] = (spTotals[k] || 0) + v;

const firstEra = lessons.find((l) => l.n === Math.min(...ready))?.era || "";
const ago = Number((firstEra.match(/(\d[\d\s ]*)\s*(?:–\s*[\d\s ]+)?\s*lat temu/) || [])[1]?.replace(/\D/g, "") || 0);

const stats = {
  generated: new Date().toISOString().slice(0, 10),
  course: {
    planned: allEps.length,
    ready: lessons.length,
    parts: program.parts.length,
    sections: program.parts.reduce((a, p) => a + p.sections.length, 0),
    plannedHours: Math.round((allEps.length * (sum("minutes") / Math.max(1, lessons.length))) / 60),
    yearsSpan: ago ? ago + new Date().getFullYear() : null,
    experts: Object.keys(speakers).length - 1,
  },
  ready: {
    minutes: sum("minutes"),
    words: sum("words"),
    sentences: sum("sentences"),
    chapters: sum("chapters"),
    images: sum("images"),
    glossary: sum("glossary"),
    quiz: sum("quiz"),
    sources: sum("sources"),
    music: sum("music"),
    lodz: sum("lodz"),
    polska: sum("polska"),
  },
  lessons: perLesson,
  speakers: spTotals,
  parts,
  domains,
  lodzEpisodes: allEps.filter((e) => /Łód[źz]|Łodz|łódz/i.test(e.title)).map((e) => ({ n: e.n, title: e.title, ready: ready.has(e.n) })),
  people: {
    total: mentioned.length,
    mentions: mentioned.reduce((a, p) => a + p.total, 0),
    byCategory: count(mentioned, (p) => p.c),
    byCentury: count(mentioned.filter((p) => !p.legend), (p) => century(p.born)),
    byCountry: count(mentioned, (p) => (p.pl ? "Polska" : "zagranica")),
    byGender: count(mentioned, (p) => p.g),
    lodz: mentioned.filter((p) => p.lodz).length,
  },
};

fs.writeFileSync(path.join(root, "data/index.json"), JSON.stringify({ people: out.sort((a, b) => a.id.localeCompare(b.id)), stats }, null, 1));
console.log(`Indeks: ${mentioned.length} osób, ${stats.people.mentions} wzmianek; Łódź: ${stats.ready.lodz} wzmianek`);
const missing = out.filter((p) => !p.total).map((p) => p.name);
if (missing.length) console.warn("  ! bez wzmianek:", missing.join(", "));
