# QXTools — narzędzia audio w przeglądarce

QXTools to zestaw narzędzi audio działających w całości po stronie przeglądarki: nic nie jest
wysyłane na serwer. Pierwszym i jedynym gotowym narzędziem jest **konwerter MP3 → MIDI**
z wirtualnym pianinem.

- `index.html` — strona główna QXTools (lista narzędzi, opis możliwości).
- `tools/mp3-to-midi.html` — konwerter MP3 → MIDI + wirtualne pianino.

## Uruchomienie

Strona jest w pełni statyczna — wystarczy dowolny serwer HTTP (moduły ES i worker wymagają
protokołu HTTP, `file://` nie zadziała):

```bash
cd web/qxtools
node scripts/serve.mjs 8080     # http://localhost:8080
```

albo `python3 -m http.server 8080` w tym katalogu.

## Testy

Silnik transkrypcji, zapis/odczyt MIDI, tryby trudności i sam interfejs mają testy w `test/`:

```bash
cd web/qxtools
npm install        # tylko zależności deweloperskie (testy)
npm test
```

Co sprawdzają poszczególne testy (`test/transcribe.test.mjs`, `test/ui.test.mjs`):

| Test | Co robi |
|---|---|
| MP3 → MIDI | syntetyczne nuty → **kodowanie prawdziwym kodekiem MP3** (lamejs) → dekodowanie (mpg123) → transkrypcja → porównanie z oryginałem (recall/precision) |
| MIDI zapis/odczyt | plik `.mid` zapisany przez `writeMidi()` jest czytany z powrotem przez `readMidi()` i daje te same nuty |
| Lista nut | eksport tekstowy zawiera nazwy dźwięków |
| Tryby trudności | łatwy jest monofoniczny i w swoim zakresie, średni ma bas, pro ma najwięcej nut, limity współbrzmień są trzymane |
| Transpozycja | przesunięcie o ±N półtonów działa |
| Wydajność | minuta audio jest przetwarzana w rozsądnym czasie |
| Interfejs (jsdom) | pełna ścieżka: wgranie pliku → konwersja → wyniki → aranżacja w pianinie → pobranie `.mid` → zmiana trybów → punktacja w trybie ręcznym |

`npm run tune` uruchamia przegląd parametrów progowych silnika na scenariuszach testowych
(melodia, akordy, melodia z basem, szybki przebieg) i drukuje F1 dla każdej kombinacji.

Zależności testów (`lamejs`, `mpg123-decoder`, `jsdom`) są tylko deweloperskie i nie trafiają
do Git (`node_modules/` w `.gitignore`). Sama strona nie ma żadnych zależności.

## Struktura

```
web/qxtools/
  index.html                     strona główna QXTools
  tools/mp3-to-midi.html         konwerter + pianino
  assets/
    css/theme.css                system wizualny (kolory, szkło, tło, przyciski, karty)
    css/hub.css                  strona główna
    css/tool.css                 konwerter i pianino
    js/core/                     silnik — czysty JS, działa też w Node
      fft.js                     FFT radix-2 i okno Hanna
      dsp.js                     resampling, wyśrodkowana STFT, widmo logarytmiczne,
                                 detekcja ataków, tempo, tonacja (Krumhansl-Schmuckler)
      pitch.js                   estymacja wielu wysokości (multi-F0), podział na nuty,
                                 doprecyzowanie półtonów, dynamika
      arrange.js                 tryby trudności: easy / medium / pro
      midi.js                    zapis i odczyt Standard MIDI File
      convert.js                 potok: PCM → nuty
      converter.worker.js        worker uruchamiający potok
      yield.js                   oddawanie wątku (pasek postępu)
    js/ui/                       warstwa przeglądarkowa
      motion.js                  tło, kursor, pasek przewijania, animacje wejścia, liczniki
      canvas.js                  pomocniki canvas (roundRect z zapasową ścieżką)
      starfield.js               pole gwiazd w tle z parallaksą od kursora
      spectrum.js                pasek analizatora widma (AnalyserNode)
      audio-file.js              kontekst audio, dekodowanie plików, obwiednia fali
      waveform.js                fala dźwiękowa z głowicą
      piano-roll.js              piano roll z wynikiem
      piano-synth.js             syntezator pianina (Web Audio, pogłos splotowy)
      piano.js                   88 klawiszy, Auto, tryb ręczny, opadające nuty
      mp3-to-midi.js             kontroler strony narzędzia
      hero-visual.js             animacja na stronie głównej
  scripts/serve.mjs              serwer statyczny (bez zależności)
  test/                          testy (node --test)
```

## Jak działa konwersja

1. **Dekodowanie** — `AudioContext.decodeAudioData()` zamienia MP3/WAV/OGG/FLAC na PCM.
2. **Resampling** — sygnał schodzi do 22,05 kHz (interpolacja windowanym sinc-Lanczos),
   co dwukrotnie przyspiesza analizę przy zachowaniu pasma potrzebnego do detekcji wysokości.
3. **Widmo** — wyśrodkowana STFT (okno 4096, przesunięcie 512) przeliczona na siatkę
   logarytmiczną (1/3 półtonu, filtry trójkątne 110 centów). Wyśrodkowanie usuwa
   systematyczne opóźnienie pół-okna, więc czasy nut się zgadzają.
4. **Wysokości** — dla każdej ramki: wybielenie widma, suma harmoniczna (12 harmonicznych),
   wybór maksimów lokalnych i **iteracyjne odejmowanie wzorców** już wybranych wysokości,
   dzięki czemu widać kilka dźwięków naraz. Zabezpieczenia: wymagana obecność częstotliwości
   podstawowej, tłumienie podoktaw i oktaw będących tylko harmoniczną niższej nuty.
5. **Nuty** — aktywacje są dzielone na odcinki, sklejane z wykrytymi atakami (spectral flux),
   doprecyzowywane do całego półtonu na uśrednionym widmie i scalane, gdy po drodze nie ma ataku.
6. **Dynamika i opis** — `velocity` z obwiedni RMS, tempo z autokorelacji ataków,
   tonacja z profili Krumhansla-Schmucklera.
7. **MIDI** — Standard MIDI File w formacie 1, 480 ticków na ćwierćnutę, ścieżka tempa + ścieżka nut.

## Pianino

- 88 klawiszy (A0–C8) w korpusie z listwą i odbiciem światła, syntezator addytywny
  z pogłosem splotowym generowanym proceduralnie, pasek analizatora widma pod klawiaturą.
- **Poziomy trudności** — `Łatwy` (jedna linia melodii, siatka ćwierćnut, zakres C4–C6, bez
  współbrzmień), `Średni` (melodia + bas, siatka ósemek, do 3 dźwięków), `Profesjonalny`
  (pełna transkrypcja, do 8 dźwięków).
- **Auto** — pianino gra utwór samo: scheduler z wyprzedzeniem w czasie kontekstu audio,
  opadające nuty, podświetlane klawisze i automatyczne przewijanie do granego dźwięku.
- **Ręcznie** — grasz myszą albo klawiaturą komputera (`Z S X D C V G B H N J M`, górny rząd
  `Q 2 W 3 E R 5 T 6 Y 7 U`, `←`/`→` zmiana oktawy, `spacja` pedał). Pianino czeka na właściwy
  klawisz i liczy celność, pudła i serię.
- Tempo, transpozycja, głośność, pętla, podpowiedzi klawiszy i nazwy nut.

## Wygląd

Ciemny motyw: aurora i siatka w tle, pole gwiazd z parallaksą, kursor-reflektor, szkło
z conic-borderem, pasek postępu przewijania, animowane liczniki i karty z tiltem 3D.
Wszystkie animacje wyłączają się przy `prefers-reduced-motion`.

Strona nie była renderowana w prawdziwej przeglądarce w środowisku, w którym powstała
(brak Chromium i bibliotek `libnss3`/`libpango`, mirrory Debiana niedostępne). Układ i logikę
pokrywają testy w jsdom; wygląd trzeba potwierdzić wzrokowo w przeglądarce.

## Ograniczenia

- Automatyczna transkrypcja dowolnego nagrania to trudny problem. Silnik jest heurystyczny
  (bez modelu uczenia maszynowego), więc najlepiej radzi sobie z materiałem harmonicznym:
  pianino, gitara, wokal bez gęstego tła. Przy gęstym miksie część nut może być pominięta
  albo przesunięta o półton.
- Dokładność czasów to zwykle ±50–80 ms (mierzone w testach), co wystarcza do gry,
  ale nie do edycji studyjnej.
- Perkusja i dźwięki bez wyraźnej wysokości nie są transkrybowane — trafiają do wyniku
  jako ataki, nie jako nuty.
- Formaty dekoduje przeglądarka: MP3, WAV, OGG i FLAC działają wszędzie tam, gdzie działa
  `decodeAudioData()` (M4A zależy od przeglądarki).
- Bardzo długie pliki liczą się dłużej (około 2,5 s na minutę materiału na współczesnym CPU).
