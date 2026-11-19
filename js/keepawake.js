// Niewygaszanie ekranu w trybie auto.
// 1) Screen Wake Lock API (Chrome/Android, Safari 16.4+).
// 2) Zapas: niewidoczne, zapętlone, wyciszone wideo — działa tam, gdzie Wake Lock
//    nie jest dostępny albo zawodzi (starsze iPhone'y, aplikacja z ekranu początkowego).
// enable() trzeba wywołać synchronicznie w obsłudze kliknięcia (wymóg przeglądarek).

let lock = null;
let video = null;
let active = false;

function getVideo() {
  if (video) return video;
  video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.muted = true;
  video.loop = true;
  video.preload = "auto";
  video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
  for (const [src, type] of [["media/keepawake.webm", "video/webm"], ["media/keepawake.mp4", "video/mp4"]]) {
    const s = document.createElement("source");
    s.src = src;
    s.type = type;
    video.append(s);
  }
  document.body.append(video);
  return video;
}

async function requestLock() {
  if (!active || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return false;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => {
      lock = null;
      // blokada puszcza np. po zmianie karty lub oszczędzaniu energii — odnawiamy
      if (active && document.visibilityState === "visible") setTimeout(requestLock, 500);
    });
    return true;
  } catch {
    return false;
  }
}

export function enable() {
  active = true;
  // wideo startujemy od razu, jeszcze w geście użytkownika
  const v = getVideo();
  const p = v.play();
  if (p) p.catch(() => {});
  requestLock().then((ok) => {
    // gdy prawdziwa blokada działa, wideo nie jest potrzebne (oszczędza baterię)
    if (ok && !/iPhone|iPad|iPod/.test(navigator.userAgent)) v.pause();
  });
}

export async function disable() {
  active = false;
  try { await lock?.release(); } catch {}
  lock = null;
  video?.pause();
}

export function isActive() { return active; }

document.addEventListener("visibilitychange", () => {
  if (!active || document.visibilityState !== "visible") return;
  requestLock();
  if (video && video.paused) video.play().catch(() => {});
});
