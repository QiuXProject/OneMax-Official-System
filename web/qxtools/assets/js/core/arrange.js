/**
 * QXTools — aranżacja transkrypcji pod tryby trudności pianina.
 * easy   -> jedna linia melodii, siatka ćwierćnut, zakres dwóch oktaw
 * medium -> melodia + bas, siatka ósemek, do 3 dźwięków jednocześnie
 * pro    -> pełna transkrypcja, siatka szesnastek, do 8 dźwięków
 */
import { splitVoices } from './pitch.js';

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'Łatwy',
    tagline: 'Jedna ręka, jedna nuta',
    quantize: 1, // w ćwierćnutach
    maxPoly: 1,
    range: [60, 84], // C4..C6
    minSeconds: 0.14,
    useBass: false,
    color: '#3ddc97',
  },
  medium: {
    id: 'medium',
    label: 'Średni',
    tagline: 'Melodia + bas',
    quantize: 0.5,
    maxPoly: 3,
    range: [36, 84], // C2..C6
    minSeconds: 0.09,
    useBass: true,
    color: '#ffb020',
  },
  pro: {
    id: 'pro',
    label: 'Profesjonalny',
    tagline: 'Pełna transkrypcja',
    quantize: 0.25,
    maxPoly: 8,
    range: [21, 108],
    minSeconds: 0.05,
    useBass: true,
    color: '#ff4d8d',
  },
};

const secondsPerBeat = (bpm) => 60 / Math.max(30, bpm || 120);

function foldIntoRange(pitch, range) {
  if (!range || range[1] <= range[0]) return pitch;
  let p = pitch;
  let guard = 0;
  while (p < range[0] && guard++ < 16) p += 12;
  while (p > range[1] && guard++ < 32) p -= 12;
  return p;
}

/**
 * @param {{pitch:number,start:number,duration:number,velocity:number}[]} notes
 * @param {{bpm:number,difficulty?:keyof DIFFICULTIES,transpose?:number,quantizeOverride?:number}} opts
 */
export function arrange(notes, opts = {}) {
  const difficulty = DIFFICULTIES[opts.difficulty ?? 'medium'] ?? DIFFICULTIES.medium;
  const bpm = opts.bpm || 120;
  const spb = secondsPerBeat(bpm);
  const grid = (opts.quantizeOverride ?? difficulty.quantize) * spb;
  const transpose = opts.transpose ?? 0;

  const withBass = splitVoices(notes);
  const pool = [];
  const push = (note, role) => {
    if (!note) return;
    pool.push({ ...note, role });
  };
  for (const n of withBass.melody) push(n, 'melody');
  if (difficulty.useBass) {
    for (const n of withBass.bass) push(n, 'bass');
    if (difficulty.maxPoly > 3) for (const n of withBass.inner) push(n, 'inner');
  }

  // kwantyzacja do siatki i wyrównanie długości
  const quantized = pool.map((note) => {
    const start = Math.round(note.start / grid) * grid;
    const end = Math.max(start + grid, Math.round((note.start + note.duration) / grid) * grid);
    return {
      ...note,
      pitch: foldIntoRange(note.pitch, difficulty.range) + transpose,
      start,
      duration: end - start,
    };
  });

  // scal dublety (ten sam dźwięk, ten sam początek)
  const unique = new Map();
  for (const note of quantized) {
    const key = `${note.pitch}@${note.start.toFixed(4)}`;
    const existing = unique.get(key);
    if (!existing || note.duration > existing.duration) unique.set(key, note);
  }
  let list = [...unique.values()];

  // ogranicz współbrzmienia: priorytet melodia > bas > wnętrze
  const priority = { melody: 3, bass: 2, inner: 1 };
  list.sort((a, b) => a.start - b.start || priority[b.role] - priority[a.role] || b.pitch - a.pitch);
  const limited = [];
  let active = [];
  for (const note of list) {
    // liczymy tylko głosy, które jeszcze wybrzmiewają (kolejność końców nie jest posortowana)
    active = active.filter((voice) => voice.end > note.start + 1e-6);
    if (active.length >= difficulty.maxPoly) {
      if (difficulty.maxPoly === 1) {
        // monofonia: pierwsza nuta wygrywa, następną skracamy tak, by nie nachodziła
        const prev = limited[limited.length - 1];
        if (prev && prev.start + prev.duration > note.start) {
          prev.duration = Math.max(grid * 0.5, note.start - prev.start);
          active = [{ end: prev.start + prev.duration }];
        }
        continue;
      }
      continue;
    }
    const placed = { ...note };
    limited.push(placed);
    active.push({ end: placed.start + placed.duration });
  }

  // w monofonii docinamy każdą nutę do początku kolejnej
  if (difficulty.maxPoly === 1) {
    for (let i = 0; i < limited.length - 1; i += 1) {
      const overlap = limited[i].start + limited[i].duration - limited[i + 1].start;
      if (overlap > 0) limited[i].duration = Math.max(grid * 0.5, limited[i].duration - overlap);
    }
  }

  const result = limited
    .filter((n) => n.duration >= difficulty.minSeconds)
    .map((n) => ({
      pitch: n.pitch,
      start: n.start,
      duration: Math.min(n.duration, 8 * spb),
      velocity: Math.max(32, Math.min(120, Math.round(n.velocity ?? 90))),
      role: n.role,
    }))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);

  return {
    difficulty: difficulty.id,
    bpm,
    grid,
    notes: result,
    stats: {
      count: result.length,
      span: result.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0),
      lowest: result.length ? Math.min(...result.map((n) => n.pitch)) : null,
      highest: result.length ? Math.max(...result.map((n) => n.pitch)) : null,
      density: result.length / Math.max(1, result.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0)),
    },
  };
}
