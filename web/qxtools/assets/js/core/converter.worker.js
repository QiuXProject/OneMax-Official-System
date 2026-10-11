/**
 * QXTools — worker konwersji audio → nuty.
 * Komunikaty: { type: 'convert', id, channels, sampleRate, options }
 * Odpowiedzi:  { type: 'progress' | 'result' | 'error', id, ... }
 */
import { convertAudioToNotes, summarize } from './convert.js';

self.onmessage = async (event) => {
  const { type, id, channels, sampleRate, options } = event.data || {};
  if (type !== 'convert') return;
  try {
    const result = await convertAudioToNotes(
      channels,
      sampleRate,
      (ratio, stage) => self.postMessage({ type: 'progress', id, ratio, stage }),
      options,
    );
    self.postMessage({ type: 'result', id, result: { ...result, stats: summarize(result) } });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error && error.message ? error.message : String(error) });
  }
};
