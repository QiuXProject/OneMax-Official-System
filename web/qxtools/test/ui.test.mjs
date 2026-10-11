/**
 * Test interfejsu w jsdom: pełna ścieżka użytkownika — wgranie pliku, konwersja
 * (prawdziwy silnik, worker zastąpiony wywołaniem w procesie), wyniki, pianino, pobranie .mid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { installBrowserStubs, waitFor, haltAnimations, FakeAudioContext } from './dom-stubs.mjs';
import { render } from './synth.mjs';

const HTML = readFileSync(new URL('../tools/mp3-to-midi.html', import.meta.url), 'utf8');

const MELODY = [
  { pitch: 60, start: 0.2, duration: 0.44, velocity: 100 },
  { pitch: 64, start: 0.7, duration: 0.44, velocity: 105 },
  { pitch: 67, start: 1.2, duration: 0.44, velocity: 95 },
  { pitch: 72, start: 1.7, duration: 0.44, velocity: 110 },
  { pitch: 67, start: 2.2, duration: 0.9, velocity: 100 },
];

test('Interfejs MP3 -> MIDI: plik -> konwersja -> nuty -> pianino -> pobranie .mid', async () => {
  haltReset();
  const dom = new JSDOM(HTML, {
    pretendToBeVisual: true,
    url: 'http://localhost/tools/mp3-to-midi.html',
  });
  const buffer = render(MELODY);
  const window = installBrowserStubs(dom, { channelData: [buffer.data], sampleRate: buffer.sampleRate });
  const { document } = window;

  // ładowanie modułu strony (uruchamia initChrome i buduje pianino)
  await import('../assets/js/ui/mp3-to-midi.js');

  // --- pianino zbudowane ---
  assert.equal(document.querySelectorAll('.qx-key').length, 88, 'liczba klawiszy');
  assert.equal(document.querySelectorAll('.qx-key--white').length, 52, 'liczba białych klawiszy');
  assert.equal(document.querySelectorAll('.qx-key--black').length, 36, 'liczba czarnych klawiszy');
  const blackKey = document.querySelector('.qx-key--black');
  assert.ok(blackKey.style.left, 'czarne klawisze muszą mieć policzoną pozycję');
  assert.ok(document.querySelector('.qx-bg'), 'tło strony zamontowane');
  assert.ok(document.querySelector('.qx-scroll-progress'), 'pasek postępu przewijania');
  assert.ok(document.getElementById('spectrum'), 'canvas analizatora widma');
  assert.equal(document.getElementById('rail-mode').textContent, 'AUTO', 'listwa pianina pokazuje tryb');

  // --- wgranie pliku ---
  const file = new window.File([new Uint8Array(4096)], 'melodia-testowa.mp3', { type: 'audio/mpeg' });
  const input = document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));

  await waitFor(() => !document.getElementById('file-card').classList.contains('qx-hidden'), {
    label: 'karta pliku',
  });
  assert.equal(document.getElementById('file-name').textContent, 'melodia-testowa.mp3');
  assert.match(document.getElementById('file-meta').textContent, /kHz/);
  assert.equal(document.getElementById('convert-btn').disabled, false, 'przycisk konwersji aktywny');

  // --- konwersja ---
  document.getElementById('convert-btn').click();
  await waitFor(() => !document.getElementById('result').classList.contains('qx-hidden'), {
    label: 'panel wyników',
  });

  const notes = Number(document.getElementById('stat-notes').textContent);
  assert.ok(notes >= 4, `wykryto za mało nut: ${notes}`);
  assert.match(document.getElementById('stat-key').textContent, /dur|moll/, 'tonacja');
  assert.match(document.getElementById('stat-range').textContent, /–/, 'skala');
  assert.ok(
    document.getElementById('notes-list').querySelectorAll('tbody tr').length >= 4,
    'lista nut wyrenderowana',
  );
  assert.equal(document.getElementById('progress-percent').textContent, '100%');

  // --- pianino dostało aranżację ---
  const arrangedCount = Number(document.getElementById('score-notes').textContent);
  assert.ok(arrangedCount > 0, 'aranżacja trafiła do pianina');
  assert.match(document.getElementById('fall-badge').textContent, /nut/);
  assert.equal(document.getElementById('piano-status').textContent, 'utwór gotowy do gry');

  // --- pobranie MIDI ---
  document.getElementById('download-midi').click();
  await waitFor(() => (window.__downloads || []).length > 0, { label: 'pobranie pliku' });
  assert.equal(window.__downloads[0].download, 'melodia-testowa.mid');

  document.getElementById('download-txt').click();
  await waitFor(() => (window.__downloads || []).length > 1, { label: 'pobranie txt' });
  assert.match(window.__downloads[1].download, /\.txt$/);

  // --- zmiana trybu trudności zmienia liczbę nut ---
  document.querySelector('[data-difficulty="easy"]').click();
  const easyCount = Number(document.getElementById('score-notes').textContent);
  document.querySelector('[data-difficulty="pro"]').click();
  const proCount = Number(document.getElementById('score-notes').textContent);
  assert.ok(easyCount > 0, 'tryb łatwy ma nuty');
  assert.ok(easyCount <= proCount, `łatwy (${easyCount}) nie powinien mieć więcej nut niż pro (${proCount})`);
  assert.match(document.getElementById('fall-badge').textContent, /profesjonalny/i);

  // --- transpozycja ---
  document.getElementById('transpose-up').click();
  assert.equal(document.getElementById('transpose-value').textContent, '+1');
  document.getElementById('transpose-down').click();
  document.getElementById('transpose-down').click();
  assert.equal(document.getElementById('transpose-value').textContent, '-1');

  // --- przełączanie trybu gry ---
  document.querySelector('[data-mode="manual"]').click();
  assert.equal(document.getElementById('chip-mode').textContent, 'RĘCZNIE');
  assert.equal(document.getElementById('rail-mode').textContent, 'RĘCZNIE', 'listwa pianina zmienia tryb');
  assert.match(document.getElementById('piano-status').textContent, /grasz/i);
  document.querySelector('[data-mode="auto"]').click();
  assert.equal(document.getElementById('chip-mode').textContent, 'AUTO');

  // --- opcje ---
  const labels = document.getElementById('labels');
  labels.checked = false;
  labels.dispatchEvent(new window.Event('change'));
  assert.ok(!document.getElementById('piano').classList.contains('show-labels'), 'nazwy nut ukryte');

  // --- ręczne uderzenie w klawisz liczy się do punktacji w trybie ręcznym ---
  document.querySelector('[data-mode="manual"]').click();
  document.getElementById('play').click();
  await waitFor(() => document.getElementById('piano-status').textContent.includes('grasz'), {
    label: 'start trybu ręcznego',
  });
  const wrong = document.querySelector('.qx-key[data-midi="21"]');
  wrong.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  await waitFor(() => Number(document.getElementById('score-misses').textContent) > 0, {
    label: 'pudło po złym klawiszu',
  });

  document.getElementById('play').click();
  haltAnimations();
  dom.window.close();
});

function haltReset() {
  haltAnimations();
}

test('Strona główna QXTools ma wszystkie sekcje i link do narzędzia', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /QXTools/);
  assert.match(html, /tools\/mp3-to-midi\.html/);
  assert.match(html, /data-count="88"/, 'licznik klawiszy');
  assert.match(html, /id="hero-canvas"/, 'canvas w hero');
  assert.equal((html.match(/class="qx-tool /g) || []).length, 4, 'cztery karty narzędzi');
});

test('Syntezator pianina: uderzenie uruchamia oscylatory, zwolnienie je zatrzymuje', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  installBrowserStubs(dom, { channelData: [new Float32Array(8)], sampleRate: 44100 });
  const { createPianoSynth } = await import('../assets/js/core/piano-synth.js');

  const context = new FakeAudioContext();
  const synth = createPianoSynth(context);

  const before = context.startedOscillators;
  synth.noteOn(60, 100);
  assert.ok(context.startedOscillators > before, 'klawisz uruchamia oscylatory');
  const gained = context.createdGains;
  assert.ok(gained > 1, 'głos ma własną obwiednię i filtry');

  synth.noteOff(60);
  await waitFor(() => context.stoppedOscillators > 0, { label: 'zatrzymanie oscylatorów' });

  // pedał sustain trzyma dźwięk po zwolnieniu klawisza
  const sustained = createPianoSynth(new FakeAudioContext());
  sustained.setSustain(true);
  sustained.noteOn(64, 90);
  sustained.noteOff(64);
  sustained.setSustain(false);
  assert.equal(sustained.sustain, false, 'pedał zwolniony');
});
