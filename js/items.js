// Zamienia lekcję (segmenty) na płaską kolejkę elementów odtwarzania.
// Wspólne dla odtwarzacza w przeglądarce i skryptu generującego MP3,
// dzięki czemu znaczniki czasu z nagrania pasują do transkrypcji.

const MAX_CHUNK = 230;

export function splitSentences(text) {
  // dzielimy na zdania, nie rozcinając skrótów typu „p.n.e.”, „m.in.”, „św.”
  const protectedText = text
    .replace(/\b(p\.n\.e|n\.e|m\.in|św|np|tzw|tj|ul|dr|prof|ks|wg)\./gi, (m) => m.replace(/\./g, "§"));
  const raw = protectedText.match(/[^.!?…]+[.!?…]+[”"»)]*\s*|[^.!?…]+$/g) || [protectedText];
  const out = [];
  for (let s of raw) {
    s = s.replace(/§/g, ".").trim();
    if (!s) continue;
    if (s.length <= MAX_CHUNK) { out.push(s); continue; }
    // zbyt długie zdanie — tniemy po przecinkach / dwukropkach
    let buf = "";
    for (const part of s.split(/(?<=[,;:])\s+/)) {
      if ((buf + " " + part).trim().length > MAX_CHUNK && buf) { out.push(buf.trim()); buf = part; }
      else buf = (buf + " " + part).trim();
    }
    if (buf) out.push(buf.trim());
  }
  return out;
}

// Zapowiedź lektora po dżinglu — głęboki, spokojny głos radiowy.
export const TAGLINE = "Akademia Kultury. Wielkie dzieła, wielkie idee i ludzie, którzy zmienili świat.";
const TAG_RE = /^\s*(Akademia Kultury|KULTURA|Historia kultury)\.\s*Wielkie dzieła, wielkie idee i ludzie, którzy zmienili świat\.\s*/i;

export function buildItems(lesson) {
  const items = [];
  let tagged = false;
  let chapter = 0;
  let chapterTitle = lesson.title;
  lesson.segments.forEach((seg, si) => {
    if (seg.t === "jingle" || seg.t === "outro") {
      items.push({ kind: seg.t, si, chapter, chapterTitle });
      if (seg.t === "jingle" && !tagged) {
        tagged = true;
        splitSentences(TAGLINE).forEach((text, ci) => items.push({ kind: "speech", si, ci, sp: "lektor", text, chapter, chapterTitle }));
      }
    } else if (seg.t === "chapter") {
      chapter += 1;
      chapterTitle = seg.title;
      items.push({ kind: "sting", si, chapter, chapterTitle });
      items.push({ kind: "speech", si, sp: "gospodarz", text: seg.title.replace(/^Rozdział ([IVXL]+)\./, (m, r) => `Rozdział ${romanToWord(r)}.`), chapter, chapterTitle, announce: true });
    } else if (seg.t === "speech") {
      const body = tagged && seg.sp === "gospodarz" && TAG_RE.test(seg.text) ? seg.text.replace(TAG_RE, "") : seg.text;
      if (!body.trim()) return;
      splitSentences(body).forEach((text, ci) => items.push({ kind: "speech", si, ci, sp: seg.sp, text, chapter, chapterTitle }));
    } else if (seg.t === "music") {
      const text = `Fragment muzyczny do posłuchania po lekcji: ${seg.title}. ${seg.performer || ""}. ${seg.note || ""}`.replace(/\s+\./g, ".");
      splitSentences(text).forEach((t, ci) => items.push({ kind: "speech", si, ci, sp: "gospodarz", text: t, chapter, chapterTitle, music: true }));
    }
  });
  return items;
}

const ROMAN_WORDS = {
  I: "pierwszy", II: "drugi", III: "trzeci", IV: "czwarty", V: "piąty", VI: "szósty", VII: "siódmy",
  VIII: "ósmy", IX: "dziewiąty", X: "dziesiąty", XI: "jedenasty", XII: "dwunasty", XIII: "trzynasty", XIV: "czternasty",
};
function romanToWord(r) { return ROMAN_WORDS[r] || r; }

// Liczba porządkowa odcinka słownie (do zapowiedzi) — wystarcza do 220
export function chapterCount(lesson) { return lesson.segments.filter((s) => s.t === "chapter").length; }
