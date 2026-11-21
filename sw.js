// Service worker: działanie offline. Powłoka i lekcje zapisywane przy instalacji,
// obrazy i nagrania — w miarę słuchania (lub przyciskiem „Offline” w lekcji).
const VERSION = "hk-v8";
const SHELL = [
  "./", "index.html", "css/app.css", "manifest.webmanifest",
  "js/app.js", "js/player.js", "js/items.js", "js/jingle.js", "js/tts.js", "js/store.js", "js/ask.js", "js/icons.js", "js/keepawake.js", "media/keepawake.mp4", "media/keepawake.webm",
  "data/program.json", "data/catalog.json", "data/speakers.json", "data/index.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];
const MEDIA = "hk-media-v1";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    try {
      const cat = await (await fetch("data/catalog.json", { cache: "no-cache" })).json();
      await c.addAll(cat.map((l) => `data/lessons/${String(l.n).padStart(3, "0")}.json`));
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== MEDIA) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function rangeResponse(req, full) {
  const range = req.headers.get("range");
  if (!range) return full;
  const buf = await full.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": full.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;

  // nagrania MP3: z pamięci, jeśli zapisane offline (z obsługą przewijania)
  if (url.origin === location.origin && url.pathname.includes("/audio/") && url.pathname.endsWith(".mp3")) {
    e.respondWith((async () => {
      const hit = await caches.match(url.pathname.slice(1)) || await caches.match(req.url);
      if (hit) return rangeResponse(req, hit);
      return fetch(req);
    })());
    return;
  }

  // obrazy z zewnętrznych kolekcji i czcionki: najpierw pamięć
  if (url.origin !== location.origin) {
    if (req.destination === "image" || req.destination === "font" || url.hostname === "fonts.googleapis.com") {
      e.respondWith((async () => {
        const hit = await caches.match(req.url);
        if (hit) return hit;
        try {
          const r = await fetch(req);
          const c = await caches.open(MEDIA);
          c.put(req.url, r.clone());
          return r;
        } catch { return new Response("", { status: 504 }); }
      })());
    }
    return;
  }

  // dane i powłoka: najpierw sieć (świeże treści), bez sieci — pamięć
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (r.ok && !url.pathname.includes("/audio/")) {
        const c = await caches.open(VERSION);
        c.put(req, r.clone());
      }
      return r;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true }) ||
        (req.mode === "navigate" ? await caches.match("index.html") : null);
      return hit || new Response("Offline", { status: 503 });
    }
  })());
});
