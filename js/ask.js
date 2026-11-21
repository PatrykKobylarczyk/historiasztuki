// Pytania w trakcie lekcji: wstrzymanie wykładu, pytanie głosem lub tekstem, odpowiedź czytana przez gospodarza, powrót.
import { store } from "./store.js";
import { speak, stopSpeaking, speakerVoiceParams, ttsSupported } from "./tts.js";

const dlg = () => document.getElementById("askdlg");
let history = [];
let wasPlaying = false;
let rec = null;

function contextFor(player) {
  const l = player.lesson;
  const i = player.index;
  // fragment wykładu wokół bieżącego miejsca (ok. 40 zdań wstecz, 10 naprzód)
  const around = player.items.slice(Math.max(0, i - 40), i + 10)
    .filter((it) => it.kind === "speech" && !it.announce)
    .map((it) => it.text).join(" ");
  return { n: l.n, title: l.title, era: l.era, chapter: player.current?.chapterTitle || "", excerpt: around.slice(-6000) };
}

export function openAsk(player, speakers) {
  if (!player.lesson) return;
  const d = dlg();
  wasPlaying = player.playing;
  if (player.playing) player.pause();
  const q = d.querySelector(".ask-q");
  const ans = d.querySelector(".ask-answer");
  ans.textContent = "";
  q.value = "";
  if (!d.open) d.showModal();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = d.querySelector(".ask-mic");
  mic.hidden = !SR;

  const send = async () => {
    const question = q.value.trim();
    if (!question) return;
    ans.textContent = "Myślę…";
    try {
      const r = await fetch("api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", "x-access-code": store.get("accessCode", "") },
        body: JSON.stringify({ question, context: contextFor(player), history: history.slice(-6) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Błąd serwera (${r.status})`);
      ans.textContent = data.answer;
      history.push({ q: question, a: data.answer });
      if (ttsSupported()) {
        stopSpeaking();
        const p = speakerVoiceParams("gospodarz", speakers);
        // czytamy zdaniami — długie wypowiedzi bywają ucinane przez syntezator
        const parts = data.answer.match(/[^.!?]+[.!?]*/g) || [data.answer];
        parts.forEach((s, k) => speak(s.trim(), { ...p, rate: p.rate * player.speed }, k === parts.length - 1 && store.get("askAutoResume", true)
          ? { onend: () => { if (d.open) resume(); } } : {}));
      }
    } catch (e) {
      ans.textContent = e.message.includes("Failed to fetch") || !navigator.onLine
        ? "Pytania wymagają połączenia z internetem. Wrócimy do lekcji." : e.message;
    }
  };

  const resume = () => {
    stopSpeaking();
    try { rec?.abort(); } catch {}
    if (d.open) d.close();
    player.play();
  };

  d.querySelector('[data-action="ask-send"]').onclick = send;
  d.querySelector('[data-action="ask-resume"]').onclick = resume;
  q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } };
  d.oncancel = () => { stopSpeaking(); };
  // Rozpoznawanie mowy. Na iPhonie wynik często nie dostaje znacznika „końcowy”,
  // dlatego po krótkiej ciszy kończymy sami; bez żadnego dźwięku przerywamy po 8 s.
  let silence, noInput, listening = false;
  const stopListening = (andSend) => {
    clearTimeout(silence); clearTimeout(noInput);
    listening = false;
    mic.classList.remove("rec");
    mic.textContent = "Mów";
    try { rec?.stop(); } catch {}
    if (andSend && q.value.trim()) send();
  };
  mic.onclick = () => {
    if (!SR) return;
    if (listening) return stopListening(true);   // drugie dotknięcie: koniec i wyślij
    try { rec?.abort(); } catch {}
    stopSpeaking();
    rec = new SR();
    rec.lang = "pl-PL";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    listening = true;
    mic.classList.add("rec");
    mic.textContent = "● Słucham… (dotknij, by wysłać)";
    noInput = setTimeout(() => {
      if (!q.value.trim()) { stopListening(false); ans.textContent = "Nie usłyszałem pytania. Spróbuj jeszcze raz albo wpisz je."; }
    }, 8000);
    rec.onresult = (e) => {
      clearTimeout(noInput); clearTimeout(silence);
      q.value = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
      if (e.results[e.results.length - 1].isFinal) return stopListening(true);
      silence = setTimeout(() => stopListening(true), 1600);
    };
    rec.onerror = (e) => {
      stopListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        ans.textContent = "Brak dostępu do mikrofonu. Zezwól na mikrofon w ustawieniach przeglądarki albo wpisz pytanie.";
    };
    rec.onend = () => { if (listening) stopListening(true); };
    try { rec.start(); } catch { stopListening(false); }
  };
  // w trybie auto od razu słuchamy
  if (SR && !document.getElementById("carmode").hidden) mic.click();
  else q.focus();
}
