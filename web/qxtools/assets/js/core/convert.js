/**
 * QXTools — potok konwersji audio -> nuty. Uruchamiany w Web Workerze w przeglądarce
 * i bezpośrednio w testach Node (nie dotyka API przeglądarki).
 */
import { analyse, resample, toMono } from './dsp.js';
import { transcribe } from './pitch.js';

export const WORK_SAMPLE_RATE = 22050;

/**
 * @param {Float32Array[]|Float32Array} channelData kanały z AudioBuffer (albo jeden mono)
 * @param {number} sampleRate
 * @param {(ratio:number, stage:string)=>void} [onProgress]
 * @param {object} [options]
 */
export async function convertAudioToNotes(channelData, sampleRate, onProgress, options = {}) {
  const report = (ratio, stage) => onProgress && onProgress(Math.max(0, Math.min(1, ratio)), stage);
  report(0.02, 'mono');
  const mono = toMono(channelData);
  report(0.06, 'resample');
  const target = options.workSampleRate ?? WORK_SAMPLE_RATE;
  const { data, sampleRate: workRate } = resample(mono, sampleRate, target);
  report(0.12, 'analyse');
  const analysis = await analyse(data, workRate, {
    ...options.analysis,
    onProgress: (p) => report(0.12 + p * 0.05, 'analyse'),
  });
  const result = await transcribe(analysis, (ratio, stage) => report(ratio, stage), options);
  report(1, 'done');
  return {
    ...result,
    sourceSampleRate: sampleRate,
    workSampleRate: workRate,
    samples: data.length,
  };
}

/** Statystyki transkrypcji do wyświetlenia w UI. */
export function summarize(result) {
  const notes = result.notes;
  if (!notes.length) {
    return { notes: 0, density: 0, lowest: null, highest: null, span: 0, averageVelocity: 0 };
  }
  const pitches = notes.map((n) => n.pitch);
  const span = notes.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0);
  return {
    notes: notes.length,
    density: notes.length / Math.max(0.5, span),
    lowest: Math.min(...pitches),
    highest: Math.max(...pitches),
    span,
    averageVelocity: Math.round(notes.reduce((a, n) => a + n.velocity, 0) / notes.length),
  };
}
