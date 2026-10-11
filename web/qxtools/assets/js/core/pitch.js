/**
 * QXTools — estymacja wielu wysokości jednocześnie (multi-F0) przez sumowanie harmoniczne
 * z iteracyjnym odejmowaniem wzorców (podejście w duchu Klapuri/Basic Pitch).
 *
 * Wejście: widmo log-częstotliwościowe z dsp.analyse().
 * Wyjście: lista nut { pitch, start, duration, velocity, confidence }.
 */
import { detectKey, detectOnsets, estimateTempo, freqToMidi, midiToFreq } from './dsp.js';
import { yieldTask } from './yield.js';

const HARMONIC_COUNT = 12;
const HARMONIC_WEIGHT = [];
for (let h = 1; h <= HARMONIC_COUNT; h += 1) HARMONIC_WEIGHT.push(1 / Math.pow(h, 0.72));

/** Macierz ułamkowych indeksów harmonicznych dla każdego binu. */
function buildHarmonicIndex(filters) {
  const { count, centers, indexOfFreq } = filters;
  const idx = new Float64Array(count * HARMONIC_COUNT);
  for (let b = 0; b < count; b += 1) {
    for (let h = 1; h <= HARMONIC_COUNT; h += 1) {
      idx[b * HARMONIC_COUNT + (h - 1)] = indexOfFreq(centers[b] * h);
    }
  }
  return idx;
}

function interp(values, pos, count) {
  if (pos <= 0 || pos >= count - 1) return 0;
  const i = Math.floor(pos);
  const frac = pos - i;
  return values[i] * (1 - frac) + values[i + 1] * frac;
}

/** Wybielanie widma: odejmij lokalną średnią (suma prefiksowa, okno ±radius binów). */
function whiten(logRow, out, prefix, bins, radius) {
  prefix[0] = 0;
  for (let i = 0; i < bins; i += 1) prefix[i + 1] = prefix[i] + logRow[i];
  for (let b = 0; b < bins; b += 1) {
    const lo = Math.max(0, b - radius);
    const hi = Math.min(bins - 1, b + radius);
    out[b] = logRow[b] - (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
}

/**
 * Główna estymacja.
 * @param {ReturnType<import('./dsp.js').analyse>} data
 * @param {object} [options]
 */
export async function trackPitch(data, options = {}) {
  const { log, frames, bins, filters, hop, sampleRate } = data;
  const frameRate = sampleRate / hop;
  // STFT jest wyśrodkowana (dsp.analyse dokłada pół okna ciszy), więc znacznik czasu
  // ramki f to dokładnie f*hop/sampleRate — bez dodatkowego przesunięcia
  const frameOffset = 0;
  const maxNotesPerFrame = options.maxNotesPerFrame ?? 6;
  const salienceFloor = options.salienceFloor ?? 0.42;
  const harmonicIndex = buildHarmonicIndex(filters);
  const subtractionGain = options.subtractionGain ?? 0.7;
  const fundamentalRatio = options.fundamentalRatio ?? 0.12;

  const act = new Float32Array(frames * bins);
  const frameMax = new Float32Array(frames);
  const whitened = new Float32Array(bins);
  const harmonic = new Float32Array(bins);
  const prefix = new Float64Array(bins + 1);
  const suppressed = new Uint8Array(bins);
  const octaveShift = filters.binsPerSemitone * 12;
  const octaveRatio = options.octaveRatio ?? 0.45;
  const picked = [];

  for (let f = 0; f < frames; f += 1) {
    const row = f * bins;
    whiten(log.subarray(row, row + bins), whitened, prefix, bins, 9);
    let whitenedPeak = 1e-9;
    for (let b = 0; b < bins; b += 1) if (whitened[b] > whitenedPeak) whitenedPeak = whitened[b];
    suppressed.fill(0);
    picked.length = 0;

    for (let iter = 0; iter < maxNotesPerFrame; iter += 1) {
      // suma harmoniczna z interpolacją
      for (let b = 0; b < bins; b += 1) {
        let sum = 0;
        const base = b * HARMONIC_COUNT;
        for (let h = 0; h < HARMONIC_COUNT; h += 1) {
          const pos = harmonicIndex[base + h];
          const v = interp(whitened, pos, bins);
          if (v > 0) sum += v * HARMONIC_WEIGHT[h];
        }
        harmonic[b] = sum;
      }
      // szukaj najlepszego maksimum lokalnego (maksimum w oknie ±2 binów)
      let bestBin = -1;
      let bestValue = 0;
      for (let b = 2; b < bins - 2; b += 1) {
        const v = harmonic[b];
        if (v <= bestValue) continue;
        let isPeak = true;
        for (let k = 1; k <= 2; k += 1) {
          if (harmonic[b - k] > v || harmonic[b + k] > v) {
            isPeak = false;
            break;
          }
        }
        if (!isPeak || suppressed[b]) continue;
        // dźwięk musi mieć wsparcie w swojej częstotliwości podstawowej,
        // inaczej to tylko harmoniczna innej, niższej nuty
        const fundamental = interp(whitened, harmonicIndex[b * HARMONIC_COUNT], bins);
        if (fundamental < fundamentalRatio * whitenedPeak) continue;
        // druga harmoniczna niższej nuty udaje nutę oktawę wyżej — wymagaj porównywalnej siły
        let shadowed = false;
        for (const pick of picked) {
          if (Math.abs(pick.bin + octaveShift - b) <= 1 && pick.value * octaveRatio > v) shadowed = true;
        }
        if (shadowed) continue;
        bestValue = v;
        bestBin = b;
      }
      if (bestBin < 0 || bestValue <= 0) break;
      const relative = iter === 0 ? 1 : bestValue / (frameMax[f] || bestValue);
      if (iter > 0 && relative < salienceFloor) break;
      if (iter === 0) frameMax[f] = bestValue;
      act[row + bestBin] = Math.max(act[row + bestBin], bestValue);
      // podoktawa już wybranej wysokości to typowy błąd sumowania harmonicznego
      const below = bestBin - octaveShift;
      if (below >= 0) {
        for (let k = Math.max(0, below - 1); k <= Math.min(bins - 1, below + 1); k += 1) suppressed[k] = 1;
      }
      picked.push({ bin: bestBin, value: bestValue });
      subtractHarmonics(whitened, harmonicIndex, bestBin, bins, subtractionGain);
    }
    if (options.onProgress && (f & 63) === 0) {
      options.onProgress(f / frames);
      await yieldTask();
    }
  }

  const onsets = detectOnsets(data.flux, frameRate, options.onset);
  const raw = segment(act, frameMax, frames, bins, filters, frameRate, onsets, frameOffset, options);
  const notes = refineNotes(raw, frameRate, options);
  snapPitches(notes, log, frames, bins, filters, frameRate, frameOffset);
  mergeSamePitch(notes, frameRate, onsets, frameOffset, options);
  return { notes, onsets, frameRate };
}

/** Odejmuje wzorzec harmoniczny znalezionej wysokości z wybielonego widma. */
function subtractHarmonics(whitened, harmonicIndex, bin, bins, gain) {
  const base = bin * HARMONIC_COUNT;
  for (let h = 0; h < HARMONIC_COUNT; h += 1) {
    const pos = harmonicIndex[base + h];
    if (pos <= 1 || pos >= bins - 2) continue;
    const amp = interp(whitened, pos, bins);
    if (amp <= 0) continue;
    const spread = 1 + 0.4 * Math.log2(h + 1);
    const from = Math.max(1, Math.floor(pos - spread));
    const to = Math.min(bins - 2, Math.ceil(pos + spread));
    for (let j = from; j <= to; j += 1) {
      const d = Math.abs(j - pos) / spread;
      const w = Math.max(0, 1 - d * d);
      if (w > 0) whitened[j] -= amp * w * HARMONIC_WEIGHT[h] * gain;
    }
  }
}

/** Dzieli macierz aktywacji na kandydatów na nuty. */
function segment(act, frameMax, frames, bins, filters, frameRate, onsets, frameOffset, options) {
  const minFrames = Math.max(2, Math.round((options.minNoteSeconds ?? 0.055) * frameRate));
  const relative = options.relativeThreshold ?? 0.3;
  const candidates = [];
  const col = new Float32Array(frames);
  let peakFrameMax = 1e-9;
  for (let f = 0; f < frames; f += 1) if (frameMax[f] > peakFrameMax) peakFrameMax = frameMax[f];
  const silenceFloor = peakFrameMax * (options.silenceFloor ?? 0.12);
  const floorRatio = options.floorRatio ?? 0.55;
  const onsetBias = options.onsetBias ?? 0.03;

  for (let b = 0; b < bins; b += 1) {
    for (let f = 0; f < frames; f += 1) col[f] = act[f * bins + b];
    // mediana 3-punktowa wygładza migotanie
    let prev = col[0];
    for (let f = 1; f < frames - 1; f += 1) {
      const cur = col[f];
      const next = col[f + 1];
      const sorted = [prev, cur, next].sort((x, y) => x - y);
      col[f] = sorted[1];
      prev = cur;
    }
    let runStart = -1;
    let salienceSum = 0;
    let runLength = 0;
    for (let f = 0; f <= frames; f += 1) {
      const value = f < frames ? col[f] : 0;
      const threshold =
        f < frames
          ? Math.min(relative * Math.max(frameMax[f], 1e-6), floorRatio * peakFrameMax)
          : Infinity;
      const active = value > threshold && value > 0 && frameMax[Math.min(f, frames - 1)] > silenceFloor;
      if (active) {
        if (runStart < 0) {
          runStart = f;
          salienceSum = 0;
          runLength = 0;
        }
        salienceSum += value;
        runLength += 1;
      } else if (runStart >= 0) {
        if (runLength >= minFrames) {
          candidates.push(
            makeCandidate(col, runStart, f - 1, runLength, salienceSum, b, filters, frameRate, onsets, frameOffset, onsetBias),
          );
        }
        runStart = -1;
      }
    }
  }
  return candidates;
}

function makeCandidate(col, start, end, length, salienceSum, bin, filters, frameRate, onsets, frameOffset, onsetBias) {
  const midi = filters.midiAt(bin);
  let onsetFrame = start;
  if (onsets.length) {
    const tolerance = Math.max(1, Math.round(0.09 * frameRate));
    let best = null;
    for (const o of onsets) {
      const d = o - start;
      if (d > tolerance) break;
      if (d >= -tolerance && (best === null || Math.abs(d) < Math.abs(best))) best = o;
    }
    if (best !== null) onsetFrame = best;
  }
  const startSeconds = Math.max(0, (onsetFrame + frameOffset) / frameRate + onsetBias);
  const endSeconds = (end + frameOffset) / frameRate + onsetBias;
  return {
    bin,
    midi,
    startFrame: onsetFrame,
    endFrame: end,
    start: startSeconds,
    duration: Math.max(1 / frameRate, endSeconds - startSeconds),
    confidence: salienceSum / length,
    length,
  };
}

/**
 * Usuwa duplikaty z sąsiednich binów, kwantyzuje do półtonów i scala krótkie przerwy.
 */
export function refineNotes(candidates, frameRate, options = {}) {
  candidates.sort((a, b) => b.confidence - a.confidence);
  const accepted = [];
  const maxOverlapMerge = options.mergeOverlap ?? 0.55;
  for (const cand of candidates) {
    const aStart = cand.start;
    const aEnd = cand.start + cand.duration;
    let dominated = false;
    for (const keep of accepted) {
      if (Math.abs(keep.midiRaw - cand.midi) > 1.15) continue;
      const overlap = Math.min(aEnd, keep.end) - Math.max(aStart, keep.start);
      if (overlap <= 0) continue;
      const shorter = Math.min(cand.duration, keep.end - keep.start);
      if (overlap / shorter > maxOverlapMerge) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      accepted.push({
        midiRaw: cand.midi,
        pitch: Math.max(21, Math.min(108, Math.round(cand.midi))),
        start: aStart,
        end: aEnd,
        duration: cand.duration,
        confidence: cand.confidence,
      });
    }
  }

  accepted.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  // scal nuty o tej samej wysokości oddzielone bardzo krótką przerwą
  const gapFrames = Math.max(1, Math.round((options.mergeGapSeconds ?? 0.045) * frameRate)) / frameRate;
  const merged = [];
  for (const note of accepted) {
    const last = merged.find((m) => m.pitch === note.pitch && note.start - m.end < gapFrames);
    if (last) {
      last.end = Math.max(last.end, note.end);
      last.duration = last.end - last.start;
      last.confidence = Math.max(last.confidence, note.confidence);
    } else {
      merged.push({ ...note });
    }
  }

  const minDuration = options.minDuration ?? 0.06;
  const result = merged.filter((n) => n.duration >= minDuration);
  for (const note of result) {
    delete note.end;
    note.velocity = 90;
  }
  result.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return result;
}

/**
 * Doprecyzowuje wysokość do całego półtonu: dla każdej nuty uśrednia widmo z jej ramek
 * (wybielanie jest liniowe, więc średnia wybielonych = wybielona średnia) i wybiera
 * półton o największej sumie harmonicznej spośród -1/0/+1.
 */
export function snapPitches(notes, log, frames, bins, filters, frameRate, frameOffset = 0) {
  if (!notes.length) return notes;
  const scratch = new Float32Array(bins);
  const whitened = new Float32Array(bins);
  const prefix = new Float64Array(bins + 1);
  for (const note of notes) {
    const first = Math.max(0, Math.min(frames - 1, Math.round(note.start * frameRate - frameOffset)));
    const last = Math.max(first, Math.min(frames - 1, Math.round((note.start + note.duration) * frameRate - frameOffset)));
    scratch.fill(0);
    const count = last - first + 1;
    for (let f = first; f <= last; f += 1) {
      const row = f * bins;
      for (let b = 0; b < bins; b += 1) scratch[b] += log[row + b];
    }
    for (let b = 0; b < bins; b += 1) scratch[b] /= count;
    whiten(scratch, whitened, prefix, bins, 9);
    let bestPitch = note.pitch;
    let bestScore = -Infinity;
    for (let delta = -1; delta <= 1; delta += 1) {
      const pitch = note.pitch + delta;
      if (pitch < 21 || pitch > 108) continue;
      const freq = midiToFreq(pitch);
      let score = 0;
      for (let h = 1; h <= HARMONIC_COUNT; h += 1) {
        const value = interp(whitened, filters.indexOfFreq(freq * h), bins);
        if (value > 0) score += value * HARMONIC_WEIGHT[h - 1];
      }
      if (score > bestScore) {
        bestScore = score;
        bestPitch = pitch;
      }
    }
    note.pitch = bestPitch;
  }
  return notes;
}

/**
 * Scala nuty o tej samej wysokości, które po doprecyzowaniu półtonu stały się sąsiadami,
 * o ile między nimi nie ma wykrytego ataku (czyli to nie jest powtórzenie dźwięku).
 */
export function mergeSamePitch(notes, frameRate, onsets, frameOffset = 0, options = {}) {
  const gap = options.repeatGapSeconds ?? 0.13;
  notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const onsetTimes = (onsets || []).map((f) => (f + frameOffset) / frameRate);
  const kept = [];
  for (const note of notes) {
    const prev = kept[kept.length - 1];
    if (prev && prev.pitch === note.pitch) {
      const gapSeconds = note.start - (prev.start + prev.duration);
      const hasOnset = onsetTimes.some((t) => t > prev.start + prev.duration + 0.01 && t < note.start - 0.01);
      if (gapSeconds < gap && !hasOnset) {
        prev.duration = Math.max(prev.duration, note.start + note.duration - prev.start);
        prev.velocity = Math.max(prev.velocity ?? 0, note.velocity ?? 0);
        continue;
      }
    }
    kept.push(note);
  }
  notes.length = 0;
  notes.push(...kept);
  return notes;
}

/** Dokłada dynamikę (velocity) z obwiedni RMS sygnału. */
export function assignVelocities(notes, rms, frameRate) {
  if (!notes.length) return notes;
  const window = Math.max(1, Math.round(0.05 * frameRate));
  const atOnset = notes.map((n) => {
    const center = Math.min(rms.length - 1, Math.max(0, Math.round(n.start * frameRate)));
    let peak = 0;
    for (let f = Math.max(0, center - window); f <= Math.min(rms.length - 1, center + window); f += 1) {
      if (rms[f] > peak) peak = rms[f];
    }
    return peak;
  });
  const sorted = Float32Array.from(atOnset).sort();
  const high = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  const low = sorted[Math.floor(sorted.length * 0.2)] || 0;
  notes.forEach((note, i) => {
    const span = Math.max(1e-9, high - low);
    const norm = Math.min(1, Math.max(0, (atOnset[i] - low) / span));
    note.velocity = Math.round(38 + 82 * Math.pow(norm, 0.7));
    note.velocity = Math.max(28, Math.min(122, note.velocity));
  });
  return notes;
}

/**
 * Pełny potok: PCM -> nuty.
 * @param {Float32Array} mono
 * @param {number} sampleRate
 * @param {(ratio:number, stage:string)=>void} [onProgress]
 */
export async function transcribe(analysis, onProgress, options = {}) {
  const { notes, frameRate } = await trackPitch(analysis, {
    ...options,
    onProgress: (p) => onProgress && onProgress(0.15 + p * 0.75, 'pitch'),
  });
  assignVelocities(notes, analysis.rms, frameRate);
  const tempo = estimateTempo(analysis.flux, frameRate);
  const key = detectKey(notes);
  onProgress && onProgress(0.98, 'done');
  return {
    notes,
    bpm: tempo.bpm,
    key,
    duration: analysis.frames / frameRate,
    frameRate,
    onsets: notes.length,
  };
}

/** Zgrubny rozkład dźwięków na partie (melodia / akompaniament) — używany przez tryby trudności. */
export function splitVoices(notes) {
  if (!notes.length) return { melody: [], bass: [], inner: [] };
  const timeline = [...notes].sort((a, b) => a.start - b.start);
  const melody = [];
  const bass = [];
  const inner = [];
  let cursor = 0;
  let lastMelody = -Infinity;
  while (cursor < timeline.length) {
    const t = timeline[cursor].start;
    const slice = [];
    while (cursor < timeline.length && timeline[cursor].start <= t + 1e-6) {
      slice.push(timeline[cursor]);
      cursor += 1;
    }
    slice.sort((a, b) => b.pitch - a.pitch);
    const top = slice[0];
    const bottom = slice[slice.length - 1];
    if (top.pitch >= lastMelody - 12) {
      melody.push(top);
      lastMelody = top.pitch;
    } else {
      inner.push(top);
    }
    if (slice.length > 1 && bottom.pitch < top.pitch - 4) bass.push(bottom);
    for (let i = 1; i < slice.length - 1; i += 1) inner.push(slice[i]);
  }
  return { melody, bass, inner };
}

export { freqToMidi, midiToFreq };
