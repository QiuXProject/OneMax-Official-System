/**
 * QXTools — kontekst audio i dekodowanie plików do PCM.
 */

let sharedContext = null;

/** Jeden kontekst audio na stronę (wymagany gest użytkownika przed pierwszym dźwiękiem). */
export function getAudioContext() {
  if (!sharedContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('Brak Web Audio API w tej przeglądarce.');
    sharedContext = new Ctor({ latencyHint: 'interactive' });
  }
  return sharedContext;
}

export async function resumeAudio() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/**
 * Dekoduje plik audio do AudioBuffer.
 * @param {File|Blob} file
 */
export async function decodeAudioFile(file) {
  const ctx = getAudioContext();
  const bytes = await file.arrayBuffer();
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch (error) {
    throw new Error(`Nie udało się zdekodować pliku „${file.name}”. Czy to na pewno plik audio?`);
  }
}

/**
 * Obwiednia amplitudy do rysowania fali.
 * @param {AudioBuffer} buffer
 * @param {number} buckets liczba kolumn
 */
export function computePeaks(buffer, buckets = 1400) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
  const length = buffer.length;
  const perBucket = Math.max(1, Math.floor(length / buckets));
  const peaks = new Float32Array(buckets * 2);
  for (let b = 0; b < buckets; b += 1) {
    const from = b * perBucket;
    const to = Math.min(length, from + perBucket);
    let min = 1;
    let max = -1;
    for (let i = from; i < to; i += 1) {
      let sample = 0;
      for (let c = 0; c < channels.length; c += 1) sample += channels[c][i];
      sample /= channels.length;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }
  return peaks;
}

/** Pobiera kopie kanałów jako Float32Array (worker przejmuje własność buforów). */
export function channelArrays(buffer) {
  const out = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) out.push(buffer.getChannelData(c).slice());
  return out;
}
