// Funkcja serwerowa Vercel: odpowiada na pytania zadane w trakcie lekcji.
// Wymaga zmiennej środowiskowej ANTHROPIC_API_KEY. Opcjonalnie ACCESS_CODE — wtedy aplikacja musi podać ten kod.
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Jesteś gospodarzem audycji „Historia kultury” Akademii Kultury i Sztuki — kursu historii kultury słuchanego w samochodzie.
Słuchacz przerwał wykład i zadał pytanie. Odpowiadasz po polsku, mówionym, naturalnym językiem (tekst zostanie przeczytany przez syntezator mowy):
- bez list, nagłówków, gwiazdek, nawiasów kwadratowych i skrótów typu „np.”, „tzw.” — pisz pełne słowa;
- 80–200 słów, chyba że pytanie wymaga dłuższej odpowiedzi;
- konkretnie: daty, nazwiska, miejsca, dzieła; gdy to naturalne, odnieś się do Polski i Łodzi;
- trzymaj się chronologii kursu: nie streszczaj szczegółowo epok, które dopiero przed słuchaczem — możesz zapowiedzieć, że wrócimy do tego w późniejszym odcinku;
- jeśli nie masz pewności co do faktu, powiedz to wprost zamiast zgadywać;
- zakończ jednym krótkim zdaniem zapraszającym z powrotem do wykładu.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Użyj POST." });
  const code = process.env.ACCESS_CODE;
  if (code && req.headers["x-access-code"] !== code) {
    return res.status(401).json({ error: "Nieprawidłowy kod dostępu. Wpisz go w ustawieniach (zakładka Głosy)." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Pytania nie są jeszcze skonfigurowane (brak ANTHROPIC_API_KEY na serwerze)." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const question = String(body.question || "").slice(0, 1000).trim();
  if (!question) return res.status(400).json({ error: "Puste pytanie." });
  const c = body.context || {};
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

  const messages = [];
  for (const h of history) {
    messages.push({ role: "user", content: String(h.q).slice(0, 1000) });
    messages.push({ role: "assistant", content: String(h.a).slice(0, 3000) });
  }
  messages.push({
    role: "user",
    content: `Odcinek ${Number(c.n) || "?"}: „${String(c.title || "").slice(0, 200)}” (${String(c.era || "").slice(0, 200)}), rozdział: ${String(c.chapter || "").slice(0, 200)}.
Fragment wykładu tuż przed pytaniem:
<fragment>${String(c.excerpt || "").slice(0, 6000)}</fragment>

Pytanie słuchacza: ${question}`,
  });

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages,
    });
    if (msg.stop_reason === "refusal") {
      return res.status(200).json({ answer: "Na to pytanie nie odpowiem w tej audycji. Wróćmy do wykładu." });
    }
    const answer = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return res.status(200).json({ answer: answer || "Nie udało się przygotować odpowiedzi. Wróćmy do wykładu." });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Serwer pytań jest chwilowo niedostępny. Wróćmy do lekcji." });
  }
}
