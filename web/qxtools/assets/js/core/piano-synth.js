/**
 * QXTools — syntezator pianina na Web Audio API.
 * Model addytywny: kilka harmonicznych z wykładniczym zanikiem, filtr, pogłos splotowy.
 */

const HARMONICS = [
  { ratio: 1, gain: 1.0, decay: 1.0 },
  { ratio: 2, gain: 0.42, decay: 1.35 },
  { ratio: 3, gain: 0.2, decay: 1.8 },
  { ratio: 4.01, gain: 0.1, decay: 2.4 },
  { ratio: 5.02, gain: 0.055, decay: 3.1 },
  { ratio: 6.03, gain: 0.03, decay: 3.8 },
];

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Impuls pogłosu generowany proceduralnie (bez plików). */
function createReverbImpulse(context, seconds = 2.4, decay = 2.6) {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const envelope = Math.pow(1 - t, decay);
      // krótkie odbicia na początku dodają "pokoju"
      const early = i < rate * 0.06 ? 1.4 : 1;
      data[i] = (Math.random() * 2 - 1) * envelope * early * 0.5;
    }
  }
  return impulse;
}

export function createPianoSynth(context) {
  const master = context.createGain();
  master.gain.value = 0.85;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 22;
  compressor.ratio.value = 3.4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.22;

  const dry = context.createGain();
  dry.gain.value = 0.82;

  const wet = context.createGain();
  wet.gain.value = 0.3;

  const convolver = context.createConvolver();
  convolver.buffer = createReverbImpulse(context);

  const reverbTone = context.createBiquadFilter();
  reverbTone.type = 'lowpass';
  reverbTone.frequency.value = 4200;

  master.connect(dry).connect(compressor);
  master.connect(reverbTone).connect(convolver).connect(wet).connect(compressor);
  compressor.connect(context.destination);

  const voices = new Map();
  let sustain = false;
  const sustained = new Set();

  const stopVoice = (voice) => {
    const now = context.currentTime;
    const release = voice.release ?? 0.35;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
      voice.filter.frequency.cancelScheduledValues(now);
      voice.filter.frequency.setTargetAtTime(500, now, release / 3);
    } catch {
      /* kontekst mógł zostać zamknięty */
    }
    for (const osc of voice.oscillators) {
      try {
        osc.stop(now + release + 0.05);
      } catch {
        /* już zatrzymany */
      }
    }
    window.setTimeout(() => {
      try {
        voice.gain.disconnect();
      } catch {
        /* już odłączony */
      }
    }, (release + 0.2) * 1000);
  };

  /**
   * @param {number} midi
   * @param {number} velocity 1..127
   * @param {number} [when] czas w kontekście audio
   */
  const noteOn = (midi, velocity = 100, when) => {
    const start = when ?? context.currentTime;
    if (voices.has(midi)) {
      const old = voices.get(midi);
      stopVoice(old);
      voices.delete(midi);
    }

    const freq = midiToFrequency(midi);
    const level = Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.4);
    const gain = context.createGain();
    gain.gain.value = 0.0001;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    const brightness = 1400 + 5200 * level * (midi > 60 ? 1.1 : 0.75);
    filter.frequency.setValueAtTime(Math.min(12000, brightness * 1.6), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(420, brightness * 0.42), start + 0.5);

    gain.connect(filter).connect(master);

    const oscillators = [];
    for (const partial of HARMONICS) {
      const f = freq * partial.ratio;
      if (f > context.sampleRate / 2 - 100) continue;
      const osc = context.createOscillator();
      osc.type = partial.ratio === 1 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      // wyższe dźwięki mają mniej harmonicznych i szybciej gasną
      const pitchDecay = 0.9 + Math.max(0, (100 - midi)) / 90;
      const partialGain = context.createGain();
      partialGain.gain.value = partial.gain * (0.34 * level + 0.06) / pitchDecay;
      osc.connect(partialGain).connect(gain);
      osc.start(start);
      oscillators.push(osc);
    }

    // delikatny "stuk" młoteczka
    const noiseLength = Math.floor(context.sampleRate * 0.03);
    const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i += 1) {
      noiseData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLength, 3);
    }
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = Math.min(6000, freq * 3 + 600);
    noiseFilter.Q.value = 0.8;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.12 * level;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start(start);

    const decayTime = 1.1 + Math.max(0, (96 - midi)) / 26;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.004, 0.34 * level + 0.02), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.002, 0.1 * level + 0.006), start + 0.28);
    gain.gain.setTargetAtTime(0.0001, start + 0.3, decayTime / 2.6);

    const voice = { midi, gain, filter, oscillators, noise, release: sustain ? 1.2 : 0.34 };
    voices.set(midi, voice);
    return voice;
  };

  const noteOff = (midi, when) => {
    const voice = voices.get(midi);
    if (!voice) return;
    voices.delete(midi);
    if (sustain) {
      sustained.add(midi);
      return;
    }
    const at = when ?? context.currentTime;
    const now = context.currentTime;
    const delay = Math.max(0, at - now);
    if (delay > 0) window.setTimeout(() => stopVoice(voice), delay * 1000);
    else stopVoice(voice);
  };

  const allOff = () => {
    for (const midi of [...voices.keys()]) {
      const voice = voices.get(midi);
      voices.delete(midi);
      if (voice) stopVoice(voice);
    }
    sustained.clear();
  };

  return {
    get context() {
      return context;
    },
    noteOn,
    noteOff,
    allOff,
    setVolume(value) {
      master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), context.currentTime, 0.03);
    },
    setReverb(amount) {
      const v = Math.max(0, Math.min(1, amount));
      wet.gain.setTargetAtTime(v * 0.55, context.currentTime, 0.05);
      dry.gain.setTargetAtTime(1 - v * 0.28, context.currentTime, 0.05);
    },
    setSustain(on) {
      sustain = Boolean(on);
      if (!sustain) {
        for (const midi of [...sustained]) {
          sustained.delete(midi);
          const voice = voices.get(midi);
          if (voice) {
            voices.delete(midi);
            stopVoice(voice);
          }
        }
      }
    },
    get sustain() {
      return sustain;
    },
    resume() {
      if (context.state === 'suspended') return context.resume();
      return Promise.resolve();
    },
  };
}
