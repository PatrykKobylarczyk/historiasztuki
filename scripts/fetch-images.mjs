// Wyszukuje obrazy z sekcji „## Galeria” w Wikimedia Commons i zapisuje je w data/images.json.
// Zapytanie w nawiasie: „File:Nazwa.jpg” = dokładny plik; inny tekst = wyszukiwanie w Commons.
// Uruchamiane przez GitHub Actions (workflow „Obrazy”), bo wymaga internetu.
// node scripts/fetch-images.mjs [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imagesPath = path.join(root, "data", "images.json");
const images = fs.existsSync(imagesPath) ? JSON.parse(fs.readFileSync(imagesPath, "utf8")) : {};
const force = process.argv.includes("--force");
const API = "https://commons.wikimedia.org/w/api.php";
const UA = "KULTURA-kurs/1.0 (https://github.com/PatrykKobylarczyk/historiasztuki)";

const queries = new Set();
for (const f of fs.readdirSync(path.join(root, "content")).filter((f) => f.endsWith(".txt"))) {
  const txt = fs.readFileSync(path.join(root, "content", f), "utf8");
  for (const m of txt.matchAll(/^!\[.*?\]\((.*?)\)(?:\s*@\d+)?\s*$/gm)) queries.add(m[1].trim());
}

const strip = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const IMG = { prop: "imageinfo", iiprop: "url|extmetadata|mime|size", iiurlwidth: "1280" };
function toEntry(page) {
  const ii = page?.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)/.test(ii.mime || "")) return null;
  const md = ii.extmetadata || {};
  const url = ii.thumburl || ii.url;
  return {
    url,
    thumb: url.replace(/\/\d+px-/, "/500px-"),
    page: ii.descriptionurl,
    artist: strip(md.Artist?.value).slice(0, 80),
    license: strip(md.LicenseShortName?.value),
    title: page.title,
  };
}

let added = 0, failed = [];
for (const q of queries) {
  if (images[q] && !force) continue;
  try {
    let entry = null;
    if (/^File:/i.test(q)) {
      const d = await api({ action: "query", titles: q, ...IMG });
      entry = toEntry(Object.values(d.query?.pages || {})[0]);
    } else {
      const d = await api({ action: "query", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "8", ...IMG });
      const pages = Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index);
      // pierwszy sensowny wynik: zdjęcie/obraz, nie mapa ani herb, rozsądny rozmiar
      for (const p of pages) {
        if (/map|coat of arms|herb|logo|flag|diagram|svg/i.test(p.title)) continue;
        const ii = p.imageinfo?.[0];
        if (ii && ii.width < 500) continue;
        entry = toEntry(p);
        if (entry) break;
      }
    }
    if (entry) { images[q] = entry; added++; console.log(`✓ ${q} → ${entry.title}`); }
    else { failed.push(q); console.log(`✗ ${q}`); }
  } catch (e) {
    failed.push(q); console.log(`✗ ${q}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 150));
}
fs.writeFileSync(imagesPath, JSON.stringify(images, null, 1));
console.log(`\nDodano ${added}, nie znaleziono ${failed.length}${failed.length ? ": " + failed.join(" | ") : ""}`);
