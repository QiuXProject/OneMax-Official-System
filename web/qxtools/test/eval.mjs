/** Ocena jakości transkrypcji: precyzja / recall / F1 względem znanych nut. */
import { convertAudioToNotes } from '../assets/js/core/convert.js';
import { render } from './synth.mjs';

export function score(expected, detected, { pitchTolerance = 1, timeTolerance = 0.16 } = {}) {
  const used = new Set();
  let hits = 0;
  const misses = [];
  const timing = [];
  for (const want of expected) {
    let best = -1;
    let bestError = Infinity;
    detected.forEach((got, index) => {
      if (used.has(index)) return;
      const pitchError = Math.abs(got.pitch - want.pitch);
      const timeError = Math.abs(got.start - want.start);
      if (pitchError > pitchTolerance || timeError > timeTolerance) return;
      const error = pitchError + timeError * 4;
      if (error < bestError) {
        bestError = error;
        best = index;
      }
    });
    if (best >= 0) {
      used.add(best);
      hits += 1;
      timing.push(Math.abs(detected[best].start - want.start));
    } else {
      misses.push(want);
    }
  }
  const precision = detected.length ? hits / detected.length : 0;
  const recall = expected.length ? hits / expected.length : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    hits,
    expected: expected.length,
    detected: detected.length,
    spurious: detected.length - hits,
    precision,
    recall,
    f1,
    misses,
    meanOnsetError: timing.length ? timing.reduce((a, b) => a + b, 0) / timing.length : null,
    maxOnsetError: timing.length ? Math.max(...timing) : null,
  };
}

export async function evaluate(name, notes, params = {}) {
  const buffer = render(notes);
  const result = await convertAudioToNotes([buffer.data], buffer.sampleRate, null, params);
  const stats = score(notes, result.notes);
  return { name, result, stats };
}

/** Scenariusze testowe: melodia, akordy, melodia z basem. */
export const SCENARIOS = {
  melody() {
    const pitches = [60, 62, 64, 67, 69, 72, 71, 69];
    return pitches.map((pitch, i) => ({ pitch, start: i * 0.5, duration: 0.44, velocity: 90 + (i % 3) * 10 }));
  },
  chords() {
    const chords = [
      [48, 52, 55, 60],
      [53, 57, 60, 65],
      [55, 59, 62, 67],
      [48, 52, 55, 60],
    ];
    const notes = [];
    chords.forEach((chord, i) => {
      for (const pitch of chord) notes.push({ pitch, start: i * 1.0, duration: 0.9, velocity: 100 });
    });
    return notes;
  },
  melodyWithBass() {
    const notes = [];
    const bass = [36, 41, 43, 36];
    for (let i = 0; i < 8; i += 1) {
      notes.push({ pitch: 72 + (i % 4) * 2 - 3, start: i * 0.5, duration: 0.42, velocity: 100 });
      if (i % 2 === 0) notes.push({ pitch: bass[(i / 2) % 4], start: i * 0.5, duration: 0.95, velocity: 105 });
    }
    return notes;
  },
  fast() {
    const notes = [];
    for (let i = 0; i < 16; i += 1) {
      notes.push({ pitch: 60 + ((i * 3) % 12), start: i * 0.2, duration: 0.17, velocity: 95 });
    }
    return notes;
  },
};
