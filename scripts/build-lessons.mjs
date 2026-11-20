// Zamienia scenariusze z katalogu content/*.txt na pliki JSON w data/lessons/.
// Uruchom: node scripts/build-lessons.mjs
//
// Format scenariusza (patrz README):
//   ---  nagłówek (n, title, subtitle, era, next)  ---
//   [jingle] / [outro]                 — dżingiel otwierający / zamykający
//   [klucz-głosu]                      — kolejne akapity mówi dany ekspert
//   # Rozdział ...                     — nowy rozdział (krótki przerywnik muzyczny)
//   [muzyka-fragment] tytuł | wykonawca | url | opis
//   ## Galeria / ## Słowniczek / ## Pytania / ## Źródła — sekcje dodatkowe
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content");
const outDir = path.join(root, "data", "lessons");
const imagesPath = path.join(root, "data", "images.json");
const speakers = JSON.parse(fs.readFileSync(path.join(root, "data", "speakers.json"), "utf8"));
const images = fs.existsSync(imagesPath) ? JSON.parse(fs.readFileSync(imagesPath, "utf8")) : {};
// opis dzieł (twórca, okres, miejsce) — data/artworks.json, klucz = zapytanie obrazu
const artworksPath = path.join(root, "data", "artworks.json");
const artworks = fs.existsSync(artworksPath) ? JSON.parse(fs.readFileSync(artworksPath, "utf8")) : {};
fs.mkdirSync(outDir, { recursive: true });

const WPM = 140; // tempo spokojnej narracji radiowej

function parse(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: brak nagłówka ---`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const lesson = {
    n: Number(meta.n), title: meta.title, subtitle: meta.subtitle || "", era: meta.era || "", next: meta.next || "",
    segments: [], gallery: [], glossary: [], quiz: [], sources: [],
  };
  let speaker = null;
  let section = null; // sekcja dodatkowa (## ...)
  let para = [];
  const flush = () => {
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (!text) return;
    if (!speaker) throw new Error(`${file}: tekst bez przypisanego głosu: "${text.slice(0, 60)}"`);
    lesson.segments.push({ t: "speech", sp: speaker, text });
  };
  for (const line0 of m[2].split("\n")) {
    const line = line0.trim();
    if (section) {
      if (line.startsWith("## ")) { section = line.slice(3).trim(); continue; }
      if (!line) continue;
      if (section === "Galeria") {
        const g = line.match(/^!\[(.*?)\]\((.*?)\)(?:\s*@(\d+))?$/);
        if (!g) throw new Error(`${file}: zły wpis galerii: ${line}`);
        const img = images[g[2]];
        lesson.gallery.push({ caption: g[1], q: g[2], ...(g[3] ? { ch: Number(g[3]) } : {}), ...(img || {}), ...(artworks[g[2]] || {}) });
        if (!artworks[g[2]]) console.warn(`  ! brak opisu dzieła (twórca/okres) dla „${g[2]}” w data/artworks.json`);
        if (!img) console.warn(`  ! brak obrazu dla zapytania „${g[2]}” (uruchom wyszukiwanie obrazów)`);
      } else if (section === "Słowniczek") {
        const g = line.match(/^- (.*?):\s*(.*)$/);
        if (g) lesson.glossary.push({ term: g[1], def: g[2] });
      } else if (section === "Pytania") {
        const parts = line.replace(/^\?\s*/, "").split("|").map((s) => s.trim());
        const q = parts[0], why = parts[parts.length - 1];
        const answers = parts.slice(1, -1);
        const correct = answers.findIndex((a) => a.endsWith("*"));
        if (correct < 0) throw new Error(`${file}: pytanie bez poprawnej odpowiedzi (*): ${q}`);
        lesson.quiz.push({ q, a: answers.map((a) => a.replace(/\*$/, "")), correct, why });
      } else if (section === "Źródła") {
        const g = line.match(/^- \[(.*?)\]\((.*?)\)$/);
        if (g) lesson.sources.push({ title: g[1], url: g[2] });
      }
      continue;
    }
    if (line.startsWith("## ")) { flush(); section = line.slice(3).trim(); continue; }
    if (!line) { flush(); continue; }
    if (line.startsWith("# ")) {
      flush();
      lesson.segments.push({ t: "chapter", title: line.slice(2).trim() });
      continue;
    }
    if (line === "[jingle]" || line === "[outro]") { flush(); lesson.segments.push({ t: line.slice(1, -1) }); continue; }
    const mf = line.match(/^\[muzyka-fragment\]\s*(.*)$/);
    if (mf) {
      flush();
      const [title, performer, url, note] = mf[1].split("|").map((s) => s.trim());
      lesson.segments.push({ t: "music", title, performer, url, note });
      continue;
    }
    const sp = line.match(/^\[([a-z-]+)\]$/);
    if (sp) {
      flush();
      if (!speakers[sp[1]]) throw new Error(`${file}: nieznany głos [${sp[1]}]`);
      speaker = sp[1];
      continue;
    }
    para.push(line);
  }
  flush();
  // Przypnij obrazy z galerii do rozdziałów, w których padają ich hasła — tu po prostu rozkładamy je równo
  const words = lesson.segments.filter((s) => s.t === "speech").reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  lesson.words = words;
  lesson.minutes = Math.round(words / WPM + 0.5);
  return lesson;
}

const files = fs.readdirSync(contentDir).filter((f) => f.endsWith(".txt")).sort();
const catalog = [];
for (const f of files) {
  const lesson = parse(path.join(contentDir, f));
  const id = String(lesson.n).padStart(3, "0");
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(lesson));
  catalog.push({ n: lesson.n, title: lesson.title, subtitle: lesson.subtitle, era: lesson.era, minutes: lesson.minutes, thumb: lesson.gallery.find((g) => g.thumb)?.thumb || null });
  console.log(`✓ ${id} ${lesson.title} — ${lesson.words} słów, ~${lesson.minutes} min, ${lesson.gallery.length} obrazów, ${lesson.quiz.length} pytań`);
}
fs.writeFileSync(path.join(root, "data", "catalog.json"), JSON.stringify(catalog, null, 1));
