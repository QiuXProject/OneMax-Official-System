/** Generator syntetycznych dźwięków na potrzeby testów (imitacja barwy fortepianu). */

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Syntezuje pojedynczy dźwięk: harmoniczne z wykładniczym zanikiem + krótki atak.
 * @param {number} midi
 * @param {number} start sekundy
 * @param {number} duration sekundy
 * @param {number} velocity 0..127
 * @param {{sampleRate:number,length:number}} buffer
 */
export function addNote(buffer, midi, start, duration, velocity = 100) {
  const { sampleRate, data } = buffer;
  const freq = midiToFreq(midi);
  const offset = Math.floor(start * sampleRate);
  const count = Math.floor(duration * sampleRate);
  const amp = (velocity / 127) * 0.5;
  const decay = 1.6 + midi / 40; // wyższe dźwięki gasną szybciej
  const harmonics = [
    [1, 1],
    [2, 0.42],
    [3, 0.22],
    [4, 0.12],
    [5, 0.07],
    [6, 0.04],
  ];
  for (let i = 0; i < count; i += 1) {
    const idx = offset + i;
    if (idx >= data.length) break;
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.008);
    const env = attack * Math.exp(-t * decay);
    let sample = 0;
    for (const [h, weight] of harmonics) {
      const f = freq * h;
      if (f > sampleRate / 2 - 200) break;
      sample += weight * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * decay * h * 0.35);
    }
    data[idx] += amp * env * sample;
  }
}

export function makeBuffer(seconds, sampleRate = 44100) {
  const data = new Float32Array(Math.ceil(seconds * sampleRate));
  return { data, sampleRate, length: data.length };
}

/**
 * Buduje sygnał z listy nut.
 * @param {{pitch:number,start:number,duration:number,velocity?:number}[]} notes
 */
export function render(notes, sampleRate = 44100) {
  const span = notes.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0) + 0.4;
  const buffer = makeBuffer(span, sampleRate);
  for (const note of notes) addNote(buffer, note.pitch, note.start, note.duration, note.velocity ?? 100);
  return buffer;
}
