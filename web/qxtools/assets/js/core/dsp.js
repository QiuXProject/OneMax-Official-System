/**
 * QXTools — przetwarzanie sygnału: resampling, STFT, widmo log-częstotliwościowe,
 * detekcja ataków (onset) i szacowanie tempa. Czysty JS, bez zależności.
 */
import { createFFT, hannWindow, magnitudeSpectrum } from './fft.js';
import { yieldTask } from './yield.js';

export const REF_FREQ = 440;
export const REF_MIDI = 69;

export function midiToFreq(midi) {
  return REF_FREQ * Math.pow(2, (midi - REF_MIDI) / 12);
}

export function freqToMidi(freq) {
  return REF_MIDI + 12 * Math.log2(freq / REF_FREQ);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "60" -> "C4" */
export function midiToName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function nameToMidi(name) {
  const match = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(name.trim());
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return (parseInt(match[3], 10) + 1) * 12 + base + accidental;
}

/** Średnia kanałów + usunięcie składowej stałej + normalizacja szczytu. */
export function toMono(channelData) {
  const channels = Array.isArray(channelData) ? channelData : [channelData];
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels.length; c += 1) sum += channels[c][i] || 0;
    out[i] = sum / channels.length;
  }
  let mean = 0;
  for (let i = 0; i < len; i += 1) mean += out[i];
  mean /= Math.max(1, len);
  let peak = 1e-9;
  for (let i = 0; i < len; i += 1) {
    out[i] -= mean;
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const gain = 0.97 / peak;
  for (let i = 0; i < len; i += 1) out[i] *= gain;
  return out;
}

/**
 * Resampling do częstotliwości docelowej (interpolacja windowanym sinc-Lanczos).
 * Zwraca wejście bez zmian, gdy próbki już są <= celu.
 */
export function resample(input, sampleRate, targetRate) {
  if (sampleRate === targetRate) return { data: input, sampleRate };
  const ratio = targetRate / sampleRate;
  if (ratio >= 1) return { data: input, sampleRate };
  const outLength = Math.floor(input.length * ratio);
  const out = new Float32Array(outLength);
  const cutoff = ratio * 0.95; // antyaliasing
  const taps = 16;
  const invRatio = 1 / ratio;
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * invRatio;
    const center = Math.floor(pos);
    const frac = pos - center;
    let acc = 0;
    for (let k = -taps + 1; k <= taps; k += 1) {
      const idx = center + k;
      if (idx < 0 || idx >= input.length) continue;
      const x = (k - frac) * cutoff;
      let h;
      if (Math.abs(x) < 1e-6) {
        h = cutoff;
      } else {
        const px = Math.PI * x;
        h = cutoff * (Math.sin(px) / px) * (Math.sin(px / taps) / (px / taps));
      }
      acc += input[idx] * h;
    }
    out[i] = acc;
  }
  return { data: out, sampleRate: targetRate };
}

/**
 * Filtry trójkątne mapujące widmo liniowe (bin FFT) na siatkę logarytmiczną.
 * @param {number} fftSize
 * @param {number} sampleRate
 * @param {number} lowMidi
 * @param {number} highMidi
 * @param {number} binsPerSemitone ile binów na półton (3 = tercja półtonu)
 * @param {number} widthCents szerokość filtra w centach
 */
export function createLogFilters(fftSize, sampleRate, lowMidi, highMidi, binsPerSemitone, widthCents) {
  const centsPerBin = 1200 / binsPerSemitone;
  const count = Math.round((highMidi - lowMidi) * binsPerSemitone) + 1;
  const binWidth = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const centers = new Float64Array(count);
  const filters = [];
  for (let i = 0; i < count; i += 1) {
    const midi = lowMidi + i / binsPerSemitone;
    const freq = midiToFreq(midi);
    centers[i] = freq;
    const lo = freq * Math.pow(2, -widthCents / 1200);
    const hi = freq * Math.pow(2, widthCents / 1200);
    const k0 = Math.max(1, Math.floor(lo / binWidth));
    const k1 = Math.min(fftSize / 2, Math.ceil(hi / binWidth));
    const bins = [];
    for (let k = k0; k <= k1; k += 1) {
      const f = k * binWidth;
      if (f >= nyquist) break;
      let weight;
      if (f <= freq) weight = (f - lo) / Math.max(1e-9, freq - lo);
      else weight = (hi - f) / Math.max(1e-9, hi - freq);
      if (weight > 0) bins.push(k, weight);
    }
    filters.push(bins);
  }
  return {
    count,
    lowMidi,
    highMidi,
    binsPerSemitone,
    centsPerBin,
    centers,
    filters,
    /** MIDI dla indeksu binu logarytmicznego. */
    midiAt(index) {
      return lowMidi + index / binsPerSemitone;
    },
    /** Ułamkowy indeks binu dla częstotliwości (do interpolacji harmonicznych). */
    indexOfFreq(freq) {
      return binsPerSemitone * 12 * Math.log2(freq / midiToFreq(lowMidi));
    },
  };
}

/**
 * Parametry analizy STFT.
 */
export function analysisParams(sampleRate) {
  const fftSize = sampleRate <= 12000 ? 2048 : 4096;
  const hop = 512;
  return { fftSize, hop, frameRate: sampleRate / hop, frameSeconds: fftSize / sampleRate };
}

/**
 * Widmo log-częstotliwościowe dla całego sygnału.
 * @returns {{log: Float32Array, frames: number, bins: number, flux: Float32Array, rms: Float32Array}}
 */
export async function analyse(input, sampleRate, options = {}) {
  const { fftSize, hop } = analysisParams(sampleRate);
  const binsPerSemitone = options.binsPerSemitone ?? 3;
  const lowMidi = options.lowMidi ?? 28;
  const highMidi = options.highMidi ?? 100;
  const filters = createLogFilters(fftSize, sampleRate, lowMidi, highMidi, binsPerSemitone, 110);
  const ctx = createFFT(fftSize);
  const window = hannWindow(fftSize);
  // wyśrodkowana STFT: dokładamy pół okna ciszy z każdej strony,
  // dzięki czemu znacznik czasu ramki f to dokładnie f*hop/sampleRate
  const pad = Math.floor(fftSize / 2);
  const padded = new Float32Array(input.length + pad * 2);
  padded.set(input, pad);
  const frames = Math.max(1, Math.floor((padded.length - fftSize) / hop) + 1);
  const bins = filters.count;
  const log = new Float32Array(frames * bins);
  const buf = new Float64Array(fftSize);
  const frameRms = new Float32Array(frames);
  const halfGain = 2 / fftSize;

  for (let f = 0; f < frames; f += 1) {
    const offset = f * hop;
    let energy = 0;
    for (let i = 0; i < fftSize; i += 1) {
      const s = padded[offset + i] || 0;
      buf[i] = s * window[i];
      energy += s * s;
    }
    frameRms[f] = Math.sqrt(energy / fftSize);
    const mag = magnitudeSpectrum(ctx, buf);
    const row = f * bins;
    for (let b = 0; b < bins; b += 1) {
      const spec = filters.filters[b];
      let acc = 0;
      let wsum = 0;
      for (let p = 0; p < spec.length; p += 2) {
        const w = spec[p + 1];
        acc += mag[spec[p]] * w;
        wsum += w;
      }
      const value = (acc / wsum) * halfGain;
      // logarytmiczne widmo z podłogą szumu
      log[row + b] = Math.log(value + 1e-7);
    }
    if (options.onProgress && (f & 63) === 0) {
      options.onProgress(f / frames);
      await yieldTask();
    }
  }

  const flux = spectralFlux(log, frames, bins);
  return { log, frames, bins, flux, rms: frameRms, filters, hop, fftSize, sampleRate };
}

/** Dodatnia różnica widma (spectral flux) — sygnalizuje ataki dźwięków. */
export function spectralFlux(log, frames, bins) {
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) {
    const cur = f * bins;
    const prev = (f - 1) * bins;
    let sum = 0;
    for (let b = 0; b < bins; b += 1) {
      const d = log[cur + b] - log[prev + b];
      if (d > 0) sum += d;
    }
    flux[f] = sum;
  }
  return flux;
}

function medianOf(values) {
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
}

/**
 * Szczyty obwiedni ataków: adaptacyjny próg = mediana z okna * mnożnik.
 * @returns {number[]} indeksy ramek
 */
export function detectOnsets(flux, frameRate, options = {}) {
  const windowFrames = Math.max(5, Math.round((options.windowSeconds ?? 0.5) * frameRate));
  const multiplier = options.multiplier ?? 1.7;
  const minGapFrames = Math.max(2, Math.round((options.minGapSeconds ?? 0.055) * frameRate));
  const onsets = [];
  const n = flux.length;
  // utwór zaczynający się od razu dźwiękiem nie ma "poprzedniej" ramki,
  // więc pierwszy atak trzeba wymusić jawnie
  if (n > 8) {
    const globalMedian = medianOf(flux);
    const head = (flux[1] + flux[2] + flux[3]) / 3;
    if (head > globalMedian * 1.6) onsets.push(0);
  }
  for (let i = 1; i < n - 1; i += 1) {
    const from = Math.max(0, i - windowFrames);
    const to = Math.min(n, i + windowFrames + 1);
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += flux[j];
    const mean = sum / (to - from);
    const local = [];
    for (let j = from; j < to; j += 1) local.push(flux[j]);
    const med = medianOf(local);
    const threshold = Math.max(med * multiplier, mean * 1.35, 1e-4);
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      if (!onsets.length || i - onsets[onsets.length - 1] >= minGapFrames) onsets.push(i);
      else if (flux[i] > flux[onsets[onsets.length - 1]]) onsets[onsets.length - 1] = i;
    }
  }
  return onsets;
}

/** Szacowanie tempa przez autokorelację obwiedni ataków. */
export function estimateTempo(flux, frameRate, options = {}) {
  const minBpm = options.minBpm ?? 55;
  const maxBpm = options.maxBpm ?? 200;
  const env = new Float64Array(flux.length);
  let mean = 0;
  for (let i = 0; i < flux.length; i += 1) mean += flux[i];
  mean /= Math.max(1, flux.length);
  for (let i = 0; i < flux.length; i += 1) env[i] = Math.max(0, flux[i] - mean);
  const minLag = Math.max(2, Math.round((60 / maxBpm) * frameRate));
  const maxLag = Math.min(env.length - 1, Math.round((60 / minBpm) * frameRate));
  let bestLag = minLag;
  let bestScore = -Infinity;
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = 0; i + lag < env.length; i += 1) score += env[i] * env[i + lag];
    score /= env.length - lag;
    // preferuj typowe tempa (delikatne okno ważące w log-BPM)
    const bpm = (60 * frameRate) / lag;
    const bias = Math.exp(-Math.pow(Math.log2(bpm / 110), 2) / 1.4);
    score *= 0.75 + 0.5 * bias;
    scores.push([bpm, score]);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  let bpm = (60 * frameRate) / bestLag;
  // sprowadź do zakresu 70-180 przez ósemkowanie
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { bpm: Math.round(bpm * 10) / 10, scores };
}

/** Tonacja metodą Krumhansla-Schmucklera. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(notes) {
  const hist = new Array(12).fill(0);
  for (const note of notes) {
    const weight = note.velocity * Math.sqrt(Math.max(0.05, note.duration));
    hist[((note.pitch % 12) + 12) % 12] += weight;
  }
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return { name: '—', mode: 'major', confidence: 0 };
  for (let i = 0; i < 12; i += 1) hist[i] /= total;
  let best = { name: '—', mode: 'major', score: -Infinity };
  for (let shift = 0; shift < 12; shift += 1) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < 12; i += 1) {
        const h = hist[(i + shift) % 12];
        dot += h * profile[i];
        normA += h * h;
        normB += profile[i] * profile[i];
      }
      const score = dot / Math.sqrt(normA * normB + 1e-9);
      if (score > best.score) {
        best = { name: NOTE_NAMES[shift], mode, score };
      }
    }
  }
  return {
    name: `${best.name} ${best.mode === 'minor' ? 'moll' : 'dur'}`,
    short: `${best.mode === 'minor' ? best.name.toLowerCase() : best.name}`,
    mode: best.mode,
    confidence: Math.max(0, Math.min(1, (best.score - 0.6) / 0.35)),
  };
}
