/**
 * QXTools — wirtualne pianino: 88 klawiszy, gra automatyczna z schedulerem Web Audio,
 * tryb ręczny z podpowiedziami i punktacją, wizualizacja opadających nut.
 */

import { roundRectPath } from './canvas.js';

export const LOWEST = 21; // A0
export const HIGHEST = 108; // C8
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function isBlack(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export function noteName(midi) {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Kolory podświetlenia zależne od wysokości dźwięku. */
export function keyColor(midi) {
  const hue = ((midi - 21) * 7) % 360;
  return `hsl(${hue} 92% 66%)`;
}

/** Mapa klawiatury komputera (układ instrumentów klawiszowych). */
const KEY_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, KeyQ: 12, Digit2: 13, KeyW: 14,
  Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20,
  KeyY: 21, Digit7: 22, KeyU: 23,
};

const KEY_LETTERS = {
  KeyZ: 'Z', KeyS: 'S', KeyX: 'X', KeyD: 'D', KeyC: 'C', KeyV: 'V', KeyG: 'G', KeyB: 'B',
  KeyH: 'H', KeyN: 'N', KeyJ: 'J', KeyM: 'M', KeyQ: 'Q', Digit2: '2', KeyW: 'W',
  Digit3: '3', KeyE: 'E', KeyR: 'R', Digit5: '5', KeyT: 'T', Digit6: '6',
  KeyY: 'Y', Digit7: '7', KeyU: 'U',
};

export function computerKeyMap(root) {
  const map = new Map();
  for (const [code, offset] of Object.entries(KEY_MAP)) map.set(root + offset, code);
  return map;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.root kontener .qx-piano
 * @param {HTMLCanvasElement} options.fallCanvas canvas opadających nut
 * @param {{noteOn:Function,noteOff:Function,context:AudioContext}} options.synth
 */
export function createPiano(options) {
  const { root, fallCanvas, synth } = options;
  const keysWrap = root.querySelector('.qx-piano__keys');
  const ctx = fallCanvas.getContext('2d');

  const state = {
    notes: [],
    groups: [],
    mode: 'auto',
    playing: false,
    speed: 1,
    loop: false,
    hints: true,
    showLabels: true,
    keyboardRoot: 60,
    showComputerKeys: true,
    volume: 0.85,
    time: 0,
    manualIndex: 0,
    pending: new Set(),
    score: { hits: 0, misses: 0, streak: 0, bestStreak: 0 },
    keyboardOctave: 0,
  };

  const keyElements = new Map();
  const geometry = new Map();
  const activeKeys = new Set();
  const hintedKeys = new Set();
  let startedAt = 0;
  let pauseTime = 0;
  let schedulerId = 0;
  let scheduledUntil = 0;
  let noteCursor = 0;
  let keyWidth = 26;

  /* ---------------------------------------------------------------- budowa */

  const buildKeys = () => {
    keysWrap.innerHTML = '';
    keyElements.clear();
    for (let midi = LOWEST; midi <= HIGHEST; midi += 1) {
      const black = isBlack(midi);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `qx-key ${black ? 'qx-key--black' : 'qx-key--white'}`;
      button.dataset.midi = String(midi);
      button.style.setProperty('--key-glow', keyColor(midi));
      button.setAttribute('aria-label', `Klawisz ${noteName(midi)}`);
      if (!black && midi % 12 === 0) button.classList.add('qx-key--c');
      const label = document.createElement('span');
      label.className = 'qx-key__label';
      label.textContent = midi % 12 === 0 ? noteName(midi) : (black ? '' : NAMES[midi % 12]);
      button.appendChild(label);
      keysWrap.appendChild(button);
      keyElements.set(midi, button);
    }
    layoutKeys();
  };

  /** Czarne klawisze układamy absolutnie nad białymi. */
  const layoutKeys = () => {
    const whiteKeys = [...keysWrap.querySelectorAll('.qx-key--white')];
    if (!whiteKeys.length) return;
    keyWidth = whiteKeys[0].getBoundingClientRect().width || 26;
    const blackWidth = keyWidth * 0.62;
    let whiteIndex = 0;
    geometry.clear();
    for (let midi = LOWEST; midi <= HIGHEST; midi += 1) {
      const el = keyElements.get(midi);
      if (isBlack(midi)) {
        const left = whiteIndex * keyWidth - blackWidth / 2;
        el.style.left = `${left}px`;
        el.style.width = `${blackWidth}px`;
      } else {
        whiteIndex += 1;
      }
      geometry.set(midi, { left: el.offsetLeft, width: el.offsetWidth });
    }
  };

  /** Dopasowuje szerokość klawiatury i canvasu do kontenera przewijania. */
  const fitWidth = () => {
    const scroller = root.parentElement;
    if (!scroller) return;
    // szerokość użyteczna = clientWidth minus padding kontenera przewijania
    const style = window.getComputedStyle(scroller);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const wanted = Math.max(scroller.clientWidth - padding, 52 * 26);
    root.style.width = `${wanted}px`;
    const wrap = fallCanvas.parentElement;
    if (wrap) wrap.style.width = `${wanted}px`;
    fallCanvas.style.width = `${wanted}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fallCanvas.width = Math.round(wanted * dpr);
    fallCanvas.height = Math.round(fallCanvas.getBoundingClientRect().height * dpr || 380);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutKeys();
  };

  /* ------------------------------------------------------- interakcja palcem */

  const pointerNotes = new Map();
  let pointerDown = false;

  const midiFromElement = (target) => {
    const el = target.closest ? target.closest('.qx-key') : null;
    return el ? Number(el.dataset.midi) : null;
  };

  const pressKey = (midi, source = 'pointer') => {
    if (!Number.isFinite(midi)) return;
    const el = keyElements.get(midi);
    if (el) {
      el.classList.add('is-active');
      activeKeys.add(midi);
    }
    synth.noteOn(midi, 104);
    if (state.mode === 'manual' && state.playing) judgeNote(midi, source);
    api.onNoteOn && api.onNoteOn(midi);
  };

  const releaseKey = (midi) => {
    if (!Number.isFinite(midi)) return;
    const el = keyElements.get(midi);
    if (el && !isAutoSounding(midi)) el.classList.remove('is-active');
    activeKeys.delete(midi);
    synth.noteOff(midi);
    api.onNoteOff && api.onNoteOff(midi);
  };

  const isAutoSounding = (midi) => {
    if (state.mode !== 'auto' || !state.playing) return false;
    return autoSounding.has(midi);
  };

  const bindPointer = () => {
    keysWrap.addEventListener('pointerdown', (event) => {
      const midi = midiFromElement(event.target);
      if (midi === null) return;
      event.preventDefault();
      pointerDown = true;
      keysWrap.setPointerCapture?.(event.pointerId);
      pointerNotes.set(event.pointerId, midi);
      pressKey(midi);
    });

    keysWrap.addEventListener('pointermove', (event) => {
      if (!pointerDown) return;
      const midi = midiFromElement(event.target);
      if (midi === null || pointerNotes.get(event.pointerId) === midi) return;
      const previous = pointerNotes.get(event.pointerId);
      if (previous !== undefined) releaseKey(previous);
      pointerNotes.set(event.pointerId, midi);
      pressKey(midi);
    });

    const endPointer = (event) => {
      const midi = pointerNotes.get(event.pointerId);
      if (midi !== undefined) releaseKey(midi);
      pointerNotes.delete(event.pointerId);
      if (!pointerNotes.size) pointerDown = false;
    };
    keysWrap.addEventListener('pointerup', endPointer);
    keysWrap.addEventListener('pointercancel', endPointer);
    keysWrap.addEventListener('pointerleave', endPointer);
  };

  /* -------------------------------------------------- klawiatura komputera */

  const heldCodes = new Set();

  const bindKeyboard = () => {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        synth.setSustain(true);
        root.classList.add('sustained');
        return;
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        const delta = event.code === 'ArrowLeft' ? -12 : 12;
        api.setKeyboardRoot(Math.max(24, Math.min(84, state.keyboardRoot + delta)));
        return;
      }
      const offset = KEY_MAP[event.code];
      if (offset === undefined) return;
      event.preventDefault();
      heldCodes.add(event.code);
      pressKey(state.keyboardRoot + state.keyboardOctave * 12 + offset, 'keyboard');
    });

    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        synth.setSustain(false);
        root.classList.remove('sustained');
        return;
      }
      const offset = KEY_MAP[event.code];
      if (offset === undefined) return;
      heldCodes.delete(event.code);
      releaseKey(state.keyboardRoot + state.keyboardOctave * 12 + offset);
    });
  };

  const paintComputerKeys = () => {
    for (const [midi, el] of keyElements) el.classList.remove('is-computer');
    if (!state.showComputerKeys) return;
    for (const [midi] of computerKeyMap(state.keyboardRoot + state.keyboardOctave * 12)) {
      keyElements.get(midi)?.classList.add('is-computer');
    }
  };

  /* --------------------------------------------------------------- nuty */

  /** Grupuje nuty o tym samym początku — to "akordy" w trybie ręcznym. */
  const regroup = () => {
    const groups = [];
    for (const note of state.notes) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last.start - note.start) < 0.035) last.pitches.push(note.pitch);
      else groups.push({ start: note.start, pitches: [note.pitch] });
    }
    state.groups = groups;
  };

  const setNotes = (notes) => {
    const wasPlaying = state.playing;
    api.stop();
    state.notes = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
    regroup();
    state.manualIndex = 0;
    state.score = { hits: 0, misses: 0, streak: 0, bestStreak: 0 };
    updateHints();
    api.onScore && api.onScore(state.score);
    if (wasPlaying) api.play();
  };

  /* --------------------------------------------------------- tryb ręczny */

  const updateHints = () => {
    for (const midi of hintedKeys) keyElements.get(midi)?.classList.remove('is-hint');
    hintedKeys.clear();
    if (!state.hints || state.mode !== 'manual' || !state.playing) return;
    const group = state.groups[state.manualIndex];
    if (!group) return;
    for (const pitch of group.pitches) {
      const el = keyElements.get(pitch);
      if (!el) continue;
      el.classList.add('is-hint');
      hintedKeys.add(pitch);
    }
    scrollToMidi(group.pitches[0], false);
  };

  const judgeNote = (midi) => {
    const group = state.groups[state.manualIndex];
    if (!group) return;
    if (group.pitches.includes(midi) && state.pending.has(midi)) {
      state.score.hits += 1;
      state.score.streak += 1;
      state.score.bestStreak = Math.max(state.score.bestStreak, state.score.streak);
      state.pending.delete(midi);
      if (!state.pending.size) {
        state.manualIndex += 1;
        if (state.manualIndex >= state.groups.length) {
          state.manualIndex = state.groups.length - 1;
          api.onFinish && api.onFinish();
        }
        updateHints();
      }
    } else {
      state.score.misses += 1;
      state.score.streak = 0;
      const el = keyElements.get(midi);
      if (el) {
        el.classList.add('is-miss');
        window.setTimeout(() => el.classList.remove('is-miss'), 260);
      }
    }
    api.onScore && api.onScore(state.score);
  };

  const loadPendingGroup = () => {
    const group = state.groups[state.manualIndex];
    state.pending = new Set(group ? group.pitches : []);
  };

  /* ------------------------------------------------------- odtwarzanie Auto */

  const autoSounding = new Set();
  let autoActive = new Set();

  const schedule = () => {
    if (!state.playing || state.mode !== 'auto') return;
    const audio = synth.context;
    const lookahead = 0.18;
    const now = audio.currentTime;
    const target = now + lookahead;
    const timeOf = (seconds) => startedAt + seconds / state.speed;

    while (noteCursor < state.notes.length) {
      const note = state.notes[noteCursor];
      const onset = timeOf(note.start);
      if (onset > target) break;
      const when = Math.max(now, onset);
      synth.noteOn(note.pitch, note.velocity ?? 96, when);
      const off = timeOf(note.start + note.duration);
      window.setTimeout(() => {
        synth.noteOff(note.pitch);
      }, Math.max(0, (off - audio.currentTime) * 1000));
      noteCursor += 1;
    }

    scheduledUntil = target;
    if (noteCursor >= state.notes.length && now > timeOf(endTime())) {
      if (state.loop) {
        api.seek(0);
      } else {
        api.stop();
        api.onFinish && api.onFinish();
      }
    }
    schedulerId = window.setTimeout(schedule, 25);
  };

  const endTime = () => state.notes.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0);

  const updateAutoVisuals = () => {
    if (state.mode !== 'auto' || !state.playing) return;
    const t = api.time();
    const next = new Set();
    for (const note of state.notes) {
      if (note.start > t) break;
      if (note.start <= t && t < note.start + note.duration) next.add(note.pitch);
    }
    for (const midi of autoSounding) {
      if (!next.has(midi)) {
        keyElements.get(midi)?.classList.remove('is-active');
        synth.noteOff(midi);
      }
    }
    for (const midi of next) {
      if (!autoSounding.has(midi)) {
        keyElements.get(midi)?.classList.add('is-active');
        scrollToMidi(midi, true);
      }
    }
    autoSounding.clear();
    for (const midi of next) autoSounding.add(midi);
    autoActive = next;
  };

  /* ------------------------------------------------------------ widok nut */

  const scrollToMidi = (midi, smooth) => {
    const geo = geometry.get(midi);
    const scroller = root.parentElement;
    if (!geo || !scroller) return;
    const center = geo.left + geo.width / 2;
    const view = scroller.clientWidth / 2;
    const wanted = center - view;
    if (Math.abs(scroller.scrollLeft - wanted) < geo.width * 1.6) return;
    const left = Math.max(0, wanted);
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      scroller.scrollLeft = left;
    }
  };

  const drawFalling = () => {
    const w = fallCanvas.clientWidth;
    const h = fallCanvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    // klawisze są wcięte w korpus pianina — nuty muszą jechać z tym samym przesunięciem
    const keysOffset = keysWrap.offsetLeft || 0;

    // linie oktaw
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    for (let midi = LOWEST; midi <= HIGHEST; midi += 12) {
      const geo = geometry.get(midi);
      if (!geo) continue;
      ctx.beginPath();
      ctx.moveTo(keysOffset + geo.left + 0.5, 0);
      ctx.lineTo(keysOffset + geo.left + 0.5, h);
      ctx.stroke();
    }

    if (!state.notes.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '500 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Wrzuć plik, żeby zobaczyć nuty', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const visibleSeconds = 4.2;
    let t = 0;
    if (state.playing && state.mode === 'auto') t = api.time();
    else if (state.playing && state.mode === 'manual') {
      // w trybie ręcznym widok jedzie razem z graczem
      t = state.groups[state.manualIndex]?.start ?? 0;
    }
    const pxPerSecond = h / visibleSeconds;

    for (const note of state.notes) {
      const rel = note.start - t;
      if (rel > visibleSeconds || rel + note.duration < -0.4) continue;
      const geo = geometry.get(note.pitch);
      if (!geo) continue;
      const y = h - (rel + note.duration) * pxPerSecond;
      const height = Math.max(5, note.duration * pxPerSecond);
      const color = keyColor(note.pitch);
      const alpha = rel < 0 ? 0.35 : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = color;
      roundRectPath(ctx, keysOffset + geo.left + 1, y, Math.max(3, geo.width - 2), height, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    // linia "teraz"
    const line = ctx.createLinearGradient(0, h - 3, 0, h);
    line.addColorStop(0, 'rgba(124, 92, 255, 0.9)');
    line.addColorStop(1, 'rgba(34, 211, 238, 0.5)');
    ctx.fillStyle = line;
    ctx.fillRect(0, h - 3, w, 3);

    if (state.mode === 'manual' && state.playing) {
      const group = state.groups[state.manualIndex];
      if (group) {
        ctx.fillStyle = 'rgba(255, 176, 32, 0.9)';
        ctx.font = '600 12px ui-monospace, monospace';
        ctx.fillText(`Zagraj: ${group.pitches.map(noteName).join(' + ')}`, 14, h - 14);
      }
    }
  };

  let frame = 0;
  const loop = () => {
    updateAutoVisuals();
    drawFalling();
    api.onTime && api.onTime(api.time());
    frame = requestAnimationFrame(loop);
  };

  /* ------------------------------------------------------------------ API */

  const api = {
    get state() {
      return state;
    },

    mount() {
      buildKeys();
      bindPointer();
      bindKeyboard();
      fitWidth();
      paintComputerKeys();
      root.classList.toggle('show-labels', state.showLabels);
      window.addEventListener('resize', () => {
        fitWidth();
        drawFalling();
      });
      if ('ResizeObserver' in window) {
        new ResizeObserver(() => fitWidth()).observe(root.parentElement);
      }
      frame = requestAnimationFrame(loop);
    },

    setNotes,

    setMode(mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      api.stop();
      updateHints();
    },

    setSpeed(value) {
      const t = api.time();
      state.speed = value;
      if (state.playing && state.mode === 'auto') {
        startedAt = synth.context.currentTime - t / state.speed;
      }
    },

    setHints(on) {
      state.hints = Boolean(on);
      updateHints();
    },

    setShowLabels(on) {
      state.showLabels = Boolean(on);
      root.classList.toggle('show-labels', state.showLabels);
    },

    setShowComputerKeys(on) {
      state.showComputerKeys = Boolean(on);
      paintComputerKeys();
    },

    setKeyboardRoot(midi) {
      state.keyboardRoot = midi;
      for (const code of [...heldCodes]) {
        const offset = KEY_MAP[code];
        if (offset !== undefined) releaseKey(midi + offset);
      }
      paintComputerKeys();
      api.onKeyboardRoot && api.onKeyboardRoot(midi);
    },

    play() {
      if (!state.notes.length) return false;
      synth.resume();
      state.playing = true;
      if (state.mode === 'auto') {
        noteCursor = 0;
        startedAt = synth.context.currentTime - state.time / state.speed;
        scheduledUntil = 0;
        schedule();
      } else {
        state.manualIndex = 0;
        loadPendingGroup();
        updateHints();
      }
      api.onState && api.onState(true);
      return true;
    },

    stop() {
      state.playing = false;
      window.clearTimeout(schedulerId);
      schedulerId = 0;
      for (const midi of autoSounding) keyElements.get(midi)?.classList.remove('is-active');
      autoSounding.clear();
      for (const midi of activeKeys) keyElements.get(midi)?.classList.remove('is-active');
      activeKeys.clear();
      synth.allOff();
      pauseTime = state.time;
      updateHints();
      api.onState && api.onState(false);
    },

    seek(seconds) {
      state.time = Math.max(0, seconds);
      pauseTime = state.time;
      if (state.playing && state.mode === 'auto') {
        startedAt = synth.context.currentTime - state.time / state.speed;
        noteCursor = state.notes.findIndex((n) => n.start >= state.time);
        if (noteCursor < 0) noteCursor = state.notes.length;
        for (const midi of autoSounding) keyElements.get(midi)?.classList.remove('is-active');
        autoSounding.clear();
        synth.allOff();
      }
    },

    time() {
      if (!state.playing || state.mode !== 'auto') return pauseTime;
      return (synth.context.currentTime - startedAt) * state.speed;
    },

    focusNote(midi) {
      scrollToMidi(midi, true);
    },

    get duration() {
      return endTime();
    },

    progress() {
      if (state.mode === 'manual') {
        return state.groups.length ? state.manualIndex / state.groups.length : 0;
      }
      const total = endTime();
      return total ? Math.min(1, api.time() / total) : 0;
    },

    /** Ręczne uderzenie w klawisz (np. z przycisku na ekranie). */
    pressKey,
    releaseKey,
  };

  return api;
}
