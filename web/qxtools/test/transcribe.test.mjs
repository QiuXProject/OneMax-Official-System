/**
 * Test end-to-end na prawdziwym pliku MP3:
 * syntetyczne nuty -> kodowanie lamejs -> dekodowanie mpg123 -> transkrypcja -> plik .mid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MPEGDecoder } from 'mpg123-decoder';

// lamejs 1.2.1 ma błąd: kilka modułów (Encoder.js, Lame.js, PsyModel.js) odwołuje się
// do `MPEGMode`/`Lame` bez importu. W teście ładujemy więc wszystkie moduły lamejs
// i podstawiamy je jako zmienne globalne, zanim załadujemy główny punkt wejścia.
const require = createRequire(import.meta.url);
for (const name of [
  'common', 'MPEGMode', 'Lame', 'Presets', 'GainAnalysis', 'QuantizePVT', 'Quantize',
  'Takehiro', 'Reservoir', 'BitStream', 'Encoder', 'Version', 'VBRTag', 'PsyModel',
]) {
  globalThis[name] = require(`lamejs/src/js/${name}.js`);
}
const lamejs = require('lamejs');

import { convertAudioToNotes, summarize } from '../assets/js/core/convert.js';
import { arrange, DIFFICULTIES } from '../assets/js/core/arrange.js';
import { readMidi, writeMidi, notesToText, TICKS_PER_QUARTER } from '../assets/js/core/midi.js';
import { midiToName } from '../assets/js/core/dsp.js';
import { render } from './synth.mjs';
import { score } from './eval.mjs';

/** Koduje Float32 do MP3 (lamejs działa na Int16). */
function encodeMp3(data, sampleRate, kbps = 128) {
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const v = Math.max(-1, Math.min(1, data[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const chunks = [];
  const block = 1152;
  for (let i = 0; i < pcm.length; i += block) {
    const out = encoder.encodeBuffer(pcm.subarray(i, i + block));
    if (out.length) chunks.push(new Uint8Array(out));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function decodeMp3(bytes) {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const decoded = decoder.decode(bytes);
  decoder.free();
  return { channelData: decoded.channelData, sampleRate: decoded.sampleRate };
}

const MELODY = [
  { pitch: 60, start: 0.2, duration: 0.44, velocity: 100 },
  { pitch: 64, start: 0.7, duration: 0.44, velocity: 105 },
  { pitch: 67, start: 1.2, duration: 0.44, velocity: 95 },
  { pitch: 72, start: 1.7, duration: 0.44, velocity: 110 },
  { pitch: 71, start: 2.2, duration: 0.44, velocity: 100 },
  { pitch: 67, start: 2.7, duration: 0.9, velocity: 100 },
];

test('MP3 -> MIDI: transkrypcja rozpoznaje melodię po przejściu przez prawdziwy kodek MP3', async () => {
  const buffer = render(MELODY);
  const mp3 = encodeMp3(buffer.data, buffer.sampleRate);
  assert.ok(mp3.length > 500, 'MP3 powinien mieć rozsądną długość');
  assert.equal(mp3[0], 0xff, 'MP3 zaczyna się od ramki synchronizacji');

  const { channelData, sampleRate } = await decodeMp3(mp3);
  const result = await convertAudioToNotes(channelData, sampleRate, null);

  const stats = score(MELODY, result.notes, { pitchTolerance: 0, timeTolerance: 0.18 });
  console.log(
    `  [mp3] ${mp3.length} B -> ${result.notes.length} nut | recall=${stats.recall.toFixed(2)} ` +
      `precision=${stats.precision.toFixed(2)} | bpm=${result.bpm} | ${result.key.name}`,
  );
  console.log(`  [mp3] wykryte: ${result.notes.map((n) => `${n.pitch}@${n.start.toFixed(2)}`).join(' ')}`);
  assert.ok(stats.recall >= 0.8, `recall ${stats.recall} za niski (pominięte: ${stats.misses.map((m) => m.pitch).join(',')})`);
  assert.ok(stats.precision >= 0.5, `precision ${stats.precision} za niski`);
  assert.ok(Math.abs(result.bpm - 120) <= 25, `tempo ${result.bpm} daleko od 120`);
});

test('Pełna ścieżka produktu: MP3 -> transkrypcja -> bajty .mid -> odczyt', async () => {
  const buffer = render(MELODY);
  const mp3 = encodeMp3(buffer.data, buffer.sampleRate);
  const { channelData, sampleRate } = await decodeMp3(mp3);
  const result = await convertAudioToNotes(channelData, sampleRate, null);

  // dokładnie to, co robi przycisk „Pobierz MIDI”
  const bytes = writeMidi(result.notes, { bpm: result.bpm, name: 'melodia-testowa.mp3' });
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd', 'nagłówek pliku MIDI');
  assert.ok(bytes.length > 100, `plik .mid zbyt mały: ${bytes.length} B`);

  const parsed = readMidi(bytes);
  assert.equal(parsed.notes.length, result.notes.length, 'liczba nut w zapisanym pliku');
  assert.ok(Math.abs(parsed.bpm - result.bpm) < 0.6, `tempo w pliku: ${parsed.bpm} vs ${result.bpm}`);
  parsed.notes.forEach((note, i) => {
    assert.equal(note.pitch, result.notes[i].pitch, `wysokość nuty ${i} w pliku .mid`);
  });
  console.log(
    `  [e2e] mp3 ${mp3.length} B -> ${result.notes.length} nut -> .mid ${bytes.length} B ` +
      `(${parsed.ticksPerQuarter} TPQ, ${parsed.bpm} BPM)`,
  );
});

test('MIDI: zapis i odczyt dają te same nuty', () => {
  const notes = MELODY.map((n) => ({ ...n }));
  const bytes = writeMidi(notes, { bpm: 120, name: 'QXTools test' });
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  const parsed = readMidi(bytes);
  assert.equal(parsed.ticksPerQuarter, TICKS_PER_QUARTER);
  assert.equal(parsed.notes.length, notes.length, 'liczba nut po odczycie');
  parsed.notes.forEach((got, i) => {
    assert.equal(got.pitch, notes[i].pitch, `wysokość nuty ${i}`);
    assert.ok(Math.abs(got.start - notes[i].start) < 0.02, `start nuty ${i}: ${got.start} vs ${notes[i].start}`);
    assert.ok(Math.abs(got.duration - notes[i].duration) < 0.02, `długość nuty ${i}`);
  });
  assert.equal(parsed.bpm, 120);
});

test('MIDI: tekstowa lista nut zawiera nazwy dźwięków', () => {
  const text = notesToText([{ pitch: 60, start: 0, duration: 0.5, velocity: 100 }], 120);
  assert.match(text, /C4/);
  assert.equal(midiToName(60), 'C4');
  assert.equal(midiToName(69), 'A4');
});

test('Tryby trudności: łatwy jest monofoniczny, średni ma bas, pro ma najwięcej nut', () => {
  const notes = [];
  for (let bar = 0; bar < 4; bar += 1) {
    for (const [offset, pitch] of [[0, 72], [0.25, 74], [0.5, 76], [0.75, 79]]) {
      notes.push({ pitch, start: bar + offset, duration: 0.2, velocity: 100 });
    }
    notes.push({ pitch: 36 + bar, start: bar, duration: 0.95, velocity: 110 });
    notes.push({ pitch: 60 + bar, start: bar, duration: 0.95, velocity: 90 });
  }

  const easy = arrange(notes, { bpm: 120, difficulty: 'easy' });
  const medium = arrange(notes, { bpm: 120, difficulty: 'medium' });
  const pro = arrange(notes, { bpm: 120, difficulty: 'pro' });

  assert.ok(easy.notes.length > 0, 'tryb łatwy musi coś zagrać');
  assert.ok(easy.notes.length < medium.notes.length, 'łatwy ma mniej nut niż średni');
  assert.ok(medium.notes.length <= pro.notes.length, 'średni ma nie więcej nut niż pro');

  // łatwy: jedna nuta na raz i wszystko w zakresie C4..C6
  for (let i = 1; i < easy.notes.length; i += 1) {
    const prev = easy.notes[i - 1];
    assert.ok(prev.start + prev.duration <= easy.notes[i].start + 1e-9, 'tryb łatwy nie może mieć współbrzmień');
  }
  for (const note of easy.notes) {
    assert.ok(note.pitch >= 60 && note.pitch <= 84, `nuta ${note.pitch} poza zakresem trybu łatwego`);
  }

  // średni: max 3 współbrzmienia
  const polyphony = (list) => {
    const points = [];
    for (const n of list) {
      points.push([n.start, 1]);
      points.push([n.start + n.duration, -1]);
    }
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let current = 0;
    let max = 0;
    for (const [, delta] of points) {
      current += delta;
      max = Math.max(max, current);
    }
    return max;
  };
  assert.ok(polyphony(medium.notes) <= DIFFICULTIES.medium.maxPoly, 'średni przekracza limit współbrzmień');
  assert.ok(polyphony(pro.notes) <= DIFFICULTIES.pro.maxPoly, 'pro przekracza limit współbrzmień');
  assert.ok(
    medium.notes.some((n) => n.pitch < 48),
    'tryb średni powinien zawierać bas',
  );
});

test('Transpozycja przesuwa wszystkie nuty o zadaną liczbę półtonów', () => {
  const notes = [
    { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
    { pitch: 64, start: 0.5, duration: 0.5, velocity: 100 },
  ];
  const up = arrange(notes, { bpm: 120, difficulty: 'pro', transpose: 3 });
  const down = arrange(notes, { bpm: 120, difficulty: 'pro', transpose: -2 });
  assert.deepEqual(up.notes.map((n) => n.pitch), [63, 67]);
  assert.deepEqual(down.notes.map((n) => n.pitch), [58, 62]);
});

test('Wydajność: minuta audio jest przetwarzana w rozsądnym czasie', async () => {
  const notes = [];
  for (let i = 0; i < 120; i += 1) {
    notes.push({ pitch: 48 + ((i * 5) % 24), start: i * 0.5, duration: 0.45, velocity: 95 });
  }
  const buffer = render(notes);
  const started = Date.now();
  const result = await convertAudioToNotes([buffer.data], buffer.sampleRate, null);
  const elapsed = Date.now() - started;
  const stats = summarize(result);
  console.log(`  [perf] 60 s audio -> ${elapsed} ms, ${stats.notes} nut`);
  assert.ok(elapsed < 20000, `przetwarzanie trwało ${elapsed} ms`);
  assert.ok(stats.notes >= 100, `za mało nut: ${stats.notes}`);
});
