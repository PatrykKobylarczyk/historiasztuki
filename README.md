# KULTURA — kurs historii kultury do słuchania

Kurs historii kultury **do słuchania** (w samochodzie, na spacerze), zrobiony jako aplikacja PWA: instaluje się na telefonie jak zwykła aplikacja i działa bez internetu.

- 223 odcinki w 11 częściach, chronologicznie, od prehistorii po XXI wiek. Polska i Łódź są w każdej epoce.
- Odcinki trwają 15–20 minut. Każdy zaczyna się dżinglem w stylu radiowym („Historia kultury. Wielkie dzieła, wielkie idee i ludzie, którzy zmienili świat. Odcinek…”) i kończy sygnałem zamykającym.
- Każdą dziedzinę prowadzi inny ekspert, innym głosem: gospodarz, historyk, historyczka sztuki, architekt, muzykolog, literaturoznawczyni i filozofka, historyczka designu, fotograf i filmoznawca.
- Lekcje mają rozdziały, transkrypcję z podświetlaniem, obrazy z kolekcji muzealnych (Wikimedia Commons, z autorami i licencjami), słowniczek, quiz i źródła.
- Pytania w trakcie lekcji: przycisk „Zadaj pytanie” wstrzymuje wykład. Pytasz głosem albo piszesz, odpowiedź zostaje przeczytana, a potem wykład wraca.
- Tryb samochodowy ma duże przyciski i nie pozwala wygasić ekranu. Działają też przyciski na kierownicy i słuchawkach (Media Session).
- Aplikacja zapamiętuje miejsce słuchania, oznacza wysłuchane odcinki i potrafi automatycznie przejść do następnego.

## Gotowe odcinki

1–5 (prehistoria i neolit) oraz 186 (Łódź 1971: strajk włókniarek, Fangor, Muzeum Sztuki, Księży Młyn). Pełny plan jest w `data/program.json`.

## Wdrożenie na Vercel

1. Na [vercel.com](https://vercel.com) wybierz **Add New → Project** i zaimportuj to repozytorium. Nic nie trzeba ustawiać: preset „Other”, domyślne polecenie budowania (`npm run build`).
2. Pytania w trakcie lekcji wymagają w **Settings → Environment Variables**:
   - `ANTHROPIC_API_KEY`: klucz z [console.anthropic.com](https://console.anthropic.com). Bez niego reszta aplikacji działa normalnie, tylko pytania pokażą komunikat o braku konfiguracji.
   - `ACCESS_CODE` (opcjonalnie): dowolne hasło, które chroni klucz przed obcymi. Wpisuje się je w aplikacji w zakładce **Głosy** → „Kod dostępu do pytań”.
3. Po zmianie zmiennych zrób **Redeploy**.
4. Na telefonie otwórz adres aplikacji. Na iPhonie w Safari wybierz **Udostępnij → Do ekranu początkowego**, na Androidzie w Chrome **Zainstaluj aplikację**.

## Głosy: dwa tryby

**1. Synteza w przeglądarce (działa od razu).** Każdy ekspert dostaje inny polski głos urządzenia albo inną wysokość głosu. Jakość zależy od telefonu. Na iPhonie warto pobrać ulepszone polskie głosy (Ustawienia → Dostępność → Treść mówiona → Głosy). Najlepiej brzmi Edge na komputerze (głosy „Natural”). Głosy można przypisać ręcznie w zakładce **Głosy**. Ograniczenie: przy zgaszonym ekranie przeglądarka może przerwać czytanie, dlatego jest tryb samochodowy.

**2. Nagrania MP3 z naturalnymi głosami (zalecane do auta).** Skrypt generuje plik MP3 dla każdej lekcji, z innym naturalnym głosem dla każdego eksperta i z dżinglami. Aplikacja sama wykrywa nagranie i odtwarza je jak podcast: przy zgaszonym ekranie, przez Bluetooth, CarPlay i Android Auto. Transkrypcja dalej podświetla się w rytm nagrania.

Najprościej przez GitHub Actions:
1. Wejdź w **Actions → Nagrania MP3 → Run workflow**. Podaj numery odcinków (np. `1 2 3`) albo zostaw puste pole, żeby wygenerować wszystkie gotowe.
2. Dostawca `edge` jest **darmowy i nie wymaga klucza**. To neuronowe głosy Microsoft Edge: Marek i Zofia, a eksperci różnią się wysokością i tempem. Korzysta z nieoficjalnego dostępu, więc może kiedyś przestać działać.
3. Płatne, lepiej zróżnicowane głosy wymagają sekretu w **Settings → Secrets and variables → Actions**: `OPENAI_API_KEY` (dostawca `openai`) albo `GOOGLE_TTS_API_KEY` (dostawca `google`, darmowy limit miesięczny, ale konto wymaga karty).
3. Workflow zapisze `audio/*.mp3` w repozytorium, a Vercel sam opublikuje nową wersję.

Lokalnie: `OPENAI_API_KEY=... node scripts/generate-audio.mjs 1 2` (wymaga ffmpeg). Głosy ekspertów można zmienić plikiem `data/tts-voices.json`. Skrypt pomija odcinki, których tekst się nie zmienił. Koszt to orientacyjnie kilkadziesiąt groszy do złotówki za odcinek przy OpenAI. Sprawdź aktualny cennik dostawcy.

## Jak dopisać kolejny odcinek

Scenariusze są w `content/NNN-tytul.txt`, zwykłym tekstem:

```
---
n: 6
title: Tytuł odcinka
subtitle: Podtytuł
era: Ok. 3500–3000 p.n.e.
next: Zapowiedź następnego odcinka.
---
[jingle]

[gospodarz]
Historia kultury. Wielkie dzieła, wielkie idee i ludzie, którzy zmienili świat. Odcinek szósty: …

# Rozdział I. Tytuł rozdziału

[historyk]
Akapit mówiony przez historyka…

[sztuka]
Akapit mówiony przez historyczkę sztuki…

[muzyka-fragment] Tytuł utworu | Wykonawca | https://link | Krótki opis, dlaczego warto posłuchać

# Zakończenie

[gospodarz]
Podsumowanie i zapowiedź…

[outro]

## Galeria
![Podpis obrazu](zapytanie do Wikimedia Commons) @2

## Słowniczek
- Termin: wyjaśnienie

## Pytania
? Pytanie | odpowiedź A | odpowiedź B* | odpowiedź C | wyjaśnienie (gwiazdka oznacza poprawną)

## Źródła
- [Tytuł](https://adres)
```

Klucze głosów: `gospodarz, historyk, sztuka, architekt, muzyka, literatura, design, foto` (opis w `data/speakers.json`). `@2` przy obrazie wstawia go w rozdziale 2. Bez tego obrazy rozkładają się równomiernie.

Obrazy: zapytanie z galerii trzeba dopisać do `data/images.json` (adres pliku z Wikimedia Commons, autor, licencja). Potem uruchom:

```
npm run build     # content/*.txt → data/lessons/*.json + data/catalog.json
```

Zasady treści przyjęte z rozmowy z autorem kursu:
- chronologia: artysta pojawia się w swojej epoce, a później wraca tylko jako dziedzictwo (np. Strzemiński i Kobro);
- zawsze odniesienie do Polski i Łodzi, w XX wieku bardzo szczegółowo (Marian Schmidt, grudzień 1970, luty 1971 w Łodzi, czerwiec 1976, sierpień 1980, marsz głodowy w Łodzi 30 lipca 1981, stan wojenny);
- dziedziny: malarstwo, grafika, architektura, muzyka, literatura, filozofia, polityka, społeczeństwo, fotografia, film, moda męska (szczególnie od XVII w.), design (szczególnie polski), murale i graffiti, ceramika (szczególnie polska), rynek sztuki;
- 15–20 minut na odcinek, czyli ok. 2100–2800 słów;
- źródła: kolekcje muzealne i uczelniane.

## Struktura

```
index.html, css/, js/        aplikacja (bez frameworka, bez kroku budowania)
js/player.js                 odtwarzacz: synteza mowy lub MP3, rozdziały, Media Session
js/jingle.js                 dżingiel, sygnał końcowy i przerywnik, syntezowane w kodzie (bez licencji na muzykę)
js/ask.js, api/ask.js        pytania w trakcie lekcji (funkcja serwerowa Vercel + Claude)
sw.js, manifest.webmanifest  PWA i tryb offline
content/                     scenariusze lekcji
scripts/build-lessons.mjs    budowanie lekcji
scripts/generate-audio.mjs   nagrania MP3
```

Podgląd lokalny: `npx serve .` (pytania wymagają `vercel dev`).

## Sygnały dźwiękowe

Dżingiel, przerywnik i sygnał zamykający (`media/fx/*.mp3`) to autorska fanfara symfoniczna w duchu Mahlera, renderowana skryptem `scripts/render-jingle.py` z próbek instrumentów MusyngKite (zbiór [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), licencja CC BY-SA 3.0). Po zmianie sygnałów podbij `JINGLE_VERSION` w `js/jingle.js`, żeby nagrania MP3 odcinków powstały na nowo.
