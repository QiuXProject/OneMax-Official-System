/**
 * Atrapy API przeglądarki potrzebne do uruchomienia interfejsu QXTools w jsdom.
 * Używane wyłącznie w testach — w przeglądarce istnieją prawdziwe implementacje.
 */
import { convertAudioToNotes, summarize } from '../assets/js/core/convert.js';

const audioParam = (value = 0) => ({
  value,
  setValueAtTime() { return this; },
  linearRampToValueAtTime() { return this; },
  exponentialRampToValueAtTime() { return this; },
  setTargetAtTime() { return this; },
  cancelScheduledValues() { return this; },
});

const audioNode = (extra = {}) => ({ connect(target) { return target; }, disconnect() {}, ...extra });

export class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'suspended';
    this.destination = audioNode();
    this.startedOscillators = 0;
    this.stoppedOscillators = 0;
    this.createdGains = 0;
  }

  createGain() {
    this.createdGains += 1;
    return audioNode({ gain: audioParam(1) });
  }
  createDynamicsCompressor() {
    return audioNode({
      threshold: audioParam(), knee: audioParam(), ratio: audioParam(),
      attack: audioParam(), release: audioParam(),
    });
  }
  createConvolver() { return audioNode({ buffer: null }); }
  createBiquadFilter() { return audioNode({ type: 'lowpass', frequency: audioParam(1000), Q: audioParam(1) }); }
  createOscillator() {
    const self = this;
    return audioNode({
      type: 'sine',
      frequency: audioParam(440),
      start() { self.startedOscillators += 1; },
      stop() { self.stoppedOscillators += 1; },
    });
  }
  createBufferSource() {
    return audioNode({ buffer: null, onended: null, start() {}, stop() {}, playbackRate: audioParam(1) });
  }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (i) => data[i],
    };
  }

  decodeAudioData() {
    return Promise.resolve(this.testBuffer);
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

/** Kontekst 2D, który połyka wszystkie wywołania rysujące. */
export function fakeCanvasContext() {
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => ({ addColorStop() {} });
      }
      if (prop === 'measureText') return () => ({ width: 12 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

/** Worker wykonujący prawdziwą konwersję w tym samym procesie. */
export class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    if (!message || message.type !== 'convert') return;
    setImmediate(async () => {
      try {
        const result = await convertAudioToNotes(message.channels, message.sampleRate, (ratio, stage) => {
          this.onmessage?.({ data: { type: 'progress', id: message.id, ratio, stage } });
        });
        this.onmessage?.({ data: { type: 'result', id: message.id, result: { ...result, stats: summarize(result) } } });
      } catch (error) {
        this.onerror?.({ message: error.message });
      }
    });
  }

  terminate() {}
}
FakeWorker.instances = [];

/**
 * Wstrzykuje atrapy do okna jsdom i do globalThis.
 * @param {import('jsdom').JSDOM} dom
 * @param {{buffer: {channelData: Float32Array[], sampleRate: number}}} audio
 */
export function installBrowserStubs(dom, audio) {
  const { window } = dom;

  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ isIntersecting: true, target }], this); }
    unobserve() {}
    disconnect() {}
  };
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.AudioContext = class extends FakeAudioContext {
    constructor(options) {
      super(options);
      this.testBuffer = makeAudioBuffer(window, audio);
    }
  };
  window.HTMLCanvasElement.prototype.getContext = () => fakeCanvasContext();
  window.HTMLAnchorElement.prototype.click = function click() {
    window.__downloads = window.__downloads || [];
    window.__downloads.push({ download: this.download, href: this.href });
  };
  window.URL.createObjectURL = () => 'blob:qxtools-test';
  window.URL.revokeObjectURL = () => {};
  globalThis.URL.createObjectURL = () => 'blob:qxtools-test';
  globalThis.URL.revokeObjectURL = () => {};
  window.Worker = FakeWorker;
  window.scrollTo = () => {};
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true,
    });
  }

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IntersectionObserver = window.IntersectionObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
  globalThis.Worker = window.Worker;
  globalThis.AudioContext = window.AudioContext;
  globalThis.MessageChannel = globalThis.MessageChannel || window.MessageChannel;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Event = window.Event;
  globalThis.File = window.File;
  // Node 22 ma własny getter-only `navigator` — nadpisujemy ostrożnie
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: window.navigator,
      configurable: true,
      writable: true,
    });
  } catch {
    /* zostaje navigator Node — testy go nie potrzebują */
  }
  // pętle animacji (pianino, tło) muszą dać się zatrzymać, inaczej proces testów nigdy nie kończy
  const timers = new Set();
  globalThis.requestAnimationFrame = (cb) => {
    if (halted) return 0;
    const id = setTimeout(() => {
      timers.delete(id);
      if (!halted) cb(Date.now());
    }, 0);
    timers.add(id);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    timers.delete(id);
    clearTimeout(id);
  };
  activeTimers = timers;

  return window;
}

let halted = false;
let activeTimers = new Set();

/** Zatrzymuje pętle animacji uruchomione przez interfejs. */
export function haltAnimations() {
  halted = true;
  for (const id of activeTimers) clearTimeout(id);
  activeTimers.clear();
}

function makeAudioBuffer(window, audio) {
  const { channelData, sampleRate } = audio;
  const length = channelData[0].length;
  return {
    numberOfChannels: channelData.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (index) => channelData[index],
  };
}

/** Czeka, aż predykat stanie się prawdziwy (albo do przekroczenia limitu). */
export async function waitFor(predicate, { timeout = 20000, label = 'warunek' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Przekroczono czas oczekiwania: ${label}`);
}
