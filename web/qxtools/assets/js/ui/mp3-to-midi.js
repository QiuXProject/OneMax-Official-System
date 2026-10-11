/**
 * QXTools — kontroler strony MP3 → MIDI.
 * Łączy dekodowanie pliku, konwersję w workerze, wyniki i wirtualne pianino.
 */
import { initChrome, formatBytes, formatTime } from './motion.js';
import { channelArrays, computePeaks, decodeAudioFile, getAudioContext, resumeAudio } from './audio-file.js';
import { createWaveform } from './waveform.js';
import { createPianoRoll } from './piano-roll.js';
import { createPiano } from './piano.js';
import { createPianoSynth } from '../core/piano-synth.js';
import { arrange, DIFFICULTIES } from '../core/arrange.js';
import { notesToText, writeMidi } from '../core/midi.js';
import { midiToName } from '../core/dsp.js';

initChrome();

/* ------------------------------------------------------------------ stan */

const state = {
  file: null,
  buffer: null,
  transcription: null,
  arranged: null,
  difficulty: 'medium',
  transpose: 0,
  mode: 'auto',
  preview: { node: null, startedAt: 0, offset: 0, playing: false },
};

const $ = (id) => document.getElementById(id);
const el = {
  drop: $('drop'),
  fileInput: $('file-input'),
  fileCard: $('file-card'),
  fileName: $('file-name'),
  fileMeta: $('file-meta'),
  fileClear: $('file-clear'),
  fileChange: $('file-change'),
  wave: $('wave'),
  previewToggle: $('preview-toggle'),
  previewIcon: $('preview-icon'),
  previewTime: $('preview-time'),
  convertBtn: $('convert-btn'),
  progressLabel: $('progress-label'),
  progressPercent: $('progress-percent'),
  progressFill: $('progress-fill'),
  stages: $('stages'),
  resultEmpty: $('result-empty'),
  result: $('result'),
  statNotes: $('stat-notes'),
  statBpm: $('stat-bpm'),
  statKey: $('stat-key'),
  statDensity: $('stat-density'),
  statRange: $('stat-range'),
  roll: $('roll'),
  downloadMidi: $('download-midi'),
  downloadTxt: $('download-txt'),
  copySummary: $('copy-summary'),
  notesList: $('notes-list'),
  difficulty: $('difficulty'),
  mode: $('mode'),
  speed: $('speed'),
  speedValue: $('speed-value'),
  transposeDown: $('transpose-down'),
  transposeUp: $('transpose-up'),
  transposeValue: $('transpose-value'),
  volume: $('volume'),
  hints: $('hints'),
  labels: $('labels'),
  loop: $('loop'),
  play: $('play'),
  playIcon: $('play-icon'),
  playLabel: $('play-label'),
  piano: $('piano'),
  fall: $('fall'),
  fallBadge: $('fall-badge'),
  chipProgress: $('chip-progress'),
  chipMode: $('chip-mode'),
  pianoStatus: $('piano-status'),
  keyboardRoot: $('keyboard-root'),
  scoreAccuracy: $('score-accuracy'),
  scoreHits: $('score-hits'),
  scoreMisses: $('score-misses'),
  scoreStreak: $('score-streak'),
  scoreNotes: $('score-notes'),
  toast: $('toast'),
};

/* ---------------------------------------------------------------- toast */

let toastTimer = 0;
function toast(message, kind = 'info') {
  el.toast.textContent = message;
  el.toast.classList.toggle('qx-toast--error', kind === 'error');
  el.toast.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove('is-on'), 3600);
}

/* ------------------------------------------------------------- pianino */

const roll = createPianoRoll(el.roll);

const synth = createPianoSynth(getAudioContext());
synth.setVolume(0.85);
synth.setReverb(0.42);

const piano = createPiano({ root: el.piano, fallCanvas: el.fall, synth });
piano.onScore = (score) => {
  const total = score.hits + score.misses;
  el.scoreHits.textContent = String(score.hits);
  el.scoreMisses.textContent = String(score.misses);
  el.scoreStreak.textContent = String(score.streak);
  el.scoreAccuracy.textContent = total ? `${Math.round((score.hits / total) * 100)}%` : '—';
};
piano.onState = (playing) => {
  el.playLabel.textContent = playing ? 'Stop' : 'Graj';
  el.playIcon.innerHTML = playing
    ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
    : '<path d="M7 4.5v15l13-7.5-13-7.5Z"/>';
  el.pianoStatus.textContent = playing
    ? state.mode === 'auto'
      ? 'odtwarzanie automatyczne'
      : 'grasz — pianino czeka na właściwe klawisze'
    : 'zatrzymane';
};
piano.onTime = () => {
  const progress = piano.progress();
  el.chipProgress.textContent = `${Math.round(progress * 100)}%`;
  if (state.mode === 'auto' && state.transcription) {
    roll.setPlayhead(piano.time());
  }
};
piano.onFinish = () => {
  el.pianoStatus.textContent = 'koniec — zagraj jeszcze raz';
};
piano.onKeyboardRoot = (midi) => {
  el.keyboardRoot.textContent = midiToName(midi);
};
piano.mount();

/* ------------------------------------------------------- plik i podgląd */

const wave = createWaveform(el.wave);
wave.onSeek = (seconds) => {
  if (!state.buffer) return;
  state.preview.offset = Math.max(0, Math.min(state.buffer.duration, seconds));
  if (state.preview.playing) {
    stopPreview();
    startPreview(state.preview.offset);
  } else {
    wave.setProgress(state.preview.offset);
    updateTimeLabel();
  }
};

function updateTimeLabel() {
  if (!state.buffer) return;
  el.previewTime.textContent = `${formatTime(state.preview.offset)} / ${formatTime(state.buffer.duration)}`;
}

function startPreview(offset = 0) {
  if (!state.buffer) return;
  const ctx = getAudioContext();
  const node = ctx.createBufferSource();
  node.buffer = state.buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  node.connect(gain).connect(ctx.destination);
  node.start(0, offset);
  state.preview.node = node;
  state.preview.startedAt = ctx.currentTime - offset;
  state.preview.offset = offset;
  state.preview.playing = true;
  el.previewIcon.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
  node.onended = () => {
    if (state.preview.node === node) stopPreview();
  };
  tickPreview();
}

function stopPreview() {
  if (state.preview.node) {
    try {
      state.preview.node.onended = null;
      state.preview.node.stop();
    } catch {
      /* już zatrzymany */
    }
    state.preview.node.disconnect();
    state.preview.node = null;
  }
  state.preview.playing = false;
  el.previewIcon.innerHTML = '<path d="M7 4.5v15l13-7.5-13-7.5Z"/>';
}

let previewFrame = 0;
function tickPreview() {
  cancelAnimationFrame(previewFrame);
  const step = () => {
    if (!state.preview.playing) return;
    const ctx = getAudioContext();
    const time = ctx.currentTime - state.preview.startedAt;
    if (time >= state.buffer.duration) {
      state.preview.offset = 0;
      stopPreview();
      wave.setProgress(0);
      updateTimeLabel();
      return;
    }
    state.preview.offset = time;
    wave.setProgress(time);
    updateTimeLabel();
    previewFrame = requestAnimationFrame(step);
  };
  previewFrame = requestAnimationFrame(step);
}

el.previewToggle.addEventListener('click', async () => {
  if (!state.buffer) return;
  await resumeAudio();
  if (state.preview.playing) {
    stopPreview();
  } else {
    startPreview(state.preview.offset >= state.buffer.duration - 0.05 ? 0 : state.preview.offset);
  }
});

async function loadFile(file) {
  if (!file) return;
  if (!/^(audio\/|video\/)/.test(file.type) && !/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)) {
    toast('To nie wygląda na plik audio.', 'error');
    return;
  }
  setProgress(0, 'Dekodowanie pliku…', 'decode');
  try {
    await resumeAudio();
    const buffer = await decodeAudioFile(file);
    state.file = file;
    state.buffer = buffer;
    state.preview.offset = 0;

    el.fileName.textContent = file.name;
    el.fileMeta.textContent = [
      formatBytes(file.size),
      formatTime(buffer.duration),
      `${buffer.sampleRate / 1000} kHz`,
      `${buffer.numberOfChannels} kanał(y)`,
    ].join(' · ');
    el.fileCard.classList.remove('qx-hidden');
    el.drop.classList.add('qx-hidden');

    wave.setData(computePeaks(buffer), buffer.duration);
    updateTimeLabel();
    setProgress(0.08, 'Plik gotowy — uruchom konwersję', 'decode');
    el.convertBtn.disabled = false;
    el.pianoStatus.textContent = 'plik wczytany';
  } catch (error) {
    setProgress(0, 'Błąd dekodowania', 'decode');
    toast(error.message || 'Nie udało się wczytać pliku.', 'error');
  }
}

function resetFile() {
  stopPreview();
  state.file = null;
  state.buffer = null;
  state.transcription = null;
  state.arranged = null;
  el.fileCard.classList.add('qx-hidden');
  el.drop.classList.remove('qx-hidden');
  el.convertBtn.disabled = true;
  el.result.classList.add('qx-hidden');
  el.resultEmpty.classList.remove('qx-hidden');
  el.play.disabled = true;
  wave.setData(null, 0);
  piano.setNotes([]);
  roll.setData([], 120);
  setProgress(0, 'Czekam na plik…', null);
  el.fileInput.value = '';
}

el.drop.addEventListener('click', () => el.fileInput.click());
el.drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    el.fileInput.click();
  }
});
el.fileInput.addEventListener('change', (event) => loadFile(event.target.files?.[0]));
el.fileClear.addEventListener('click', resetFile);
el.fileChange.addEventListener('click', () => el.fileInput.click());

for (const eventName of ['dragenter', 'dragover']) {
  el.drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    el.drop.classList.add('is-over');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  el.drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    el.drop.classList.remove('is-over');
  });
}
el.drop.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

/* --------------------------------------------------------- konwersja */

const STAGE_LABELS = {
  mono: 'Łączenie kanałów…',
  resample: 'Resampling do 22,05 kHz…',
  analyse: 'Liczenie widma…',
  pitch: 'Rozpoznawanie wysokości…',
  done: 'Gotowe',
};

function setProgress(ratio, label, stage) {
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  el.progressFill.style.width = `${percent}%`;
  el.progressPercent.textContent = `${percent}%`;
  if (label) el.progressLabel.textContent = label;
  const order = ['decode', 'resample', 'analyse', 'pitch', 'done'];
  const activeIndex = stage ? order.indexOf(stage) : -1;
  for (const node of el.stages.querySelectorAll('.qx-stage')) {
    const index = order.indexOf(node.dataset.stage);
    node.classList.toggle('is-active', index === activeIndex);
    node.classList.toggle('is-done', activeIndex >= 0 && index < activeIndex);
  }
}

let worker = null;
let requestId = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../core/converter.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'progress') {
        const ratio = 0.1 + message.ratio * 0.9;
        setProgress(ratio, STAGE_LABELS[message.stage] || 'Przetwarzanie…', message.stage);
      } else if (message.type === 'result') {
        handleResult(message.result);
      } else if (message.type === 'error') {
        setProgress(0, 'Błąd konwersji', null);
        el.convertBtn.disabled = false;
        toast(`Konwersja nie udała się: ${message.message}`, 'error');
      }
    };
    worker.onerror = (error) => {
      setProgress(0, 'Błąd konwersji', null);
      el.convertBtn.disabled = false;
      toast(`Worker zgłosił błąd: ${error.message || 'nieznany'}`, 'error');
    };
  }
  return worker;
}

el.convertBtn.addEventListener('click', async () => {
  if (!state.buffer) return;
  await resumeAudio();
  stopPreview();
  el.convertBtn.disabled = true;
  setProgress(0.05, 'Wysyłam do workera…', 'resample');
  const channels = channelArrays(state.buffer);
  const id = ++requestId;
  const started = performance.now();
  getWorker().postMessage(
    { type: 'convert', id, channels, sampleRate: state.buffer.sampleRate },
    channels.map((channel) => channel.buffer),
  );
  el.pianoStatus.textContent = `analiza… ${formatTime(state.buffer.duration)} materiału`;
  state.convertStartedAt = started;
});

function handleResult(result) {
  const seconds = ((performance.now() - (state.convertStartedAt || performance.now())) / 1000).toFixed(1);
  state.transcription = result;
  setProgress(1, `Gotowe w ${seconds} s — ${result.notes.length} nut`, 'done');
  el.convertBtn.disabled = false;

  el.resultEmpty.classList.add('qx-hidden');
  el.result.classList.remove('qx-hidden');
  el.statNotes.textContent = String(result.stats.notes);
  el.statBpm.textContent = String(Math.round(result.bpm));
  el.statKey.textContent = result.key?.name || '—';
  el.statDensity.textContent = result.stats.density.toFixed(2);
  el.statRange.textContent =
    result.stats.lowest === null ? '—' : `${midiToName(result.stats.lowest)}–${midiToName(result.stats.highest)}`;

  roll.setData(result.notes, result.bpm);
  wave.setNotes(result.notes);
  renderNotesList(result.notes);
  applyArrangement();
  el.play.disabled = false;
  el.pianoStatus.textContent = 'utwór gotowy do gry';
  toast(`Transkrypcja gotowa: ${result.notes.length} nut, ${Math.round(result.bpm)} BPM, ${result.key?.name || '—'}`);
}

function renderNotesList(notes) {
  const rows = notes.slice(0, 400).map((note, index) => {
    const beat = (note.start * (state.transcription?.bpm || 120)) / 60;
    return `<tr>
      <td>${index + 1}</td>
      <td>${note.start.toFixed(2)} s</td>
      <td data-key>${midiToName(note.pitch)}</td>
      <td>${note.pitch}</td>
      <td>${note.velocity}</td>
      <td>${note.duration.toFixed(2)} s</td>
      <td>${Math.floor(beat / 4) + 1}.${Math.floor(beat % 4) + 1}</td>
    </tr>`;
  });
  el.notesList.innerHTML = `<table>
    <thead><tr><th>#</th><th>start</th><th>nuta</th><th>midi</th><th>vel</th><th>długość</th><th>takt</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>${notes.length > 400 ? `<div style="padding:10px 14px;color:var(--qx-text-mute)">…i jeszcze ${notes.length - 400} nut (pełna lista w pliku .txt)</div>` : ''}`;
}

/* --------------------------------------------------- aranżacja i tryby */

function applyArrangement() {
  if (!state.transcription) return;
  const arranged = arrange(state.transcription.notes, {
    bpm: state.transcription.bpm,
    difficulty: state.difficulty,
    transpose: state.transpose,
  });
  state.arranged = arranged;
  piano.setNotes(arranged.notes);
  el.scoreNotes.textContent = String(arranged.notes.length);
  const config = DIFFICULTIES[state.difficulty];
  el.fallBadge.textContent = `tryb ${config.label.toLowerCase()} · ${arranged.notes.length} nut · ${config.tagline}`;
  el.chipMode.textContent = state.mode === 'auto' ? 'AUTO' : 'RĘCZNIE';
  el.pianoStatus.textContent = `tryb ${config.label.toLowerCase()} · ${arranged.notes.length} nut`;
}

for (const button of el.difficulty.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    for (const other of el.difficulty.querySelectorAll('button')) other.classList.remove('is-on');
    button.classList.add('is-on');
    state.difficulty = button.dataset.difficulty;
    applyArrangement();
  });
}

for (const button of el.mode.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    for (const other of el.mode.querySelectorAll('button')) other.classList.remove('is-on');
    button.classList.add('is-on');
    state.mode = button.dataset.mode;
    piano.setMode(state.mode);
    el.chipMode.textContent = state.mode === 'auto' ? 'AUTO' : 'RĘCZNIE';
    el.pianoStatus.textContent =
      state.mode === 'auto' ? 'pianino zagra utwór samo' : 'grasz ty — pianino czeka na właściwe klawisze';
    el.playLabel.textContent = 'Graj';
  });
}

el.play.addEventListener('click', async () => {
  if (!state.arranged || !state.arranged.notes.length) {
    toast('Najpierw przekonwertuj plik.', 'error');
    return;
  }
  await resumeAudio();
  if (piano.state.playing) {
    piano.stop();
  } else {
    piano.play();
  }
});

el.speed.addEventListener('input', () => {
  const value = Number(el.speed.value) / 100;
  el.speedValue.textContent = `${el.speed.value}%`;
  piano.setSpeed(value);
});

el.transposeDown.addEventListener('click', () => setTranspose(state.transpose - 1));
el.transposeUp.addEventListener('click', () => setTranspose(state.transpose + 1));

function setTranspose(value) {
  state.transpose = Math.max(-12, Math.min(12, value));
  el.transposeValue.textContent = state.transpose > 0 ? `+${state.transpose}` : String(state.transpose);
  applyArrangement();
}

el.volume.addEventListener('input', () => synth.setVolume(Number(el.volume.value) / 100));
el.hints.addEventListener('change', () => piano.setHints(el.hints.checked));
el.labels.addEventListener('change', () => piano.setShowLabels(el.labels.checked));
el.loop.addEventListener('change', () => {
  piano.state.loop = el.loop.checked;
});

/* ------------------------------------------------------------- pobranie */

function baseName() {
  return (state.file?.name || 'qxtools').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
}

function download(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

el.downloadMidi.addEventListener('click', () => {
  if (!state.transcription) return;
  const bytes = writeMidi(state.transcription.notes, {
    bpm: state.transcription.bpm,
    name: state.file?.name || 'QXTools transcription',
  });
  download(bytes, `${baseName()}.mid`, 'audio/midi');
  toast(`Zapisano ${baseName()}.mid (${formatBytes(bytes.length)})`);
});

el.downloadTxt.addEventListener('click', () => {
  if (!state.transcription) return;
  const text = notesToText(state.transcription.notes, state.transcription.bpm);
  download(new TextEncoder().encode(text), `${baseName()}-nuty.txt`, 'text/plain;charset=utf-8');
});

el.copySummary.addEventListener('click', async () => {
  if (!state.transcription) return;
  const summary = [
    'QXTools — transkrypcja MP3 → MIDI',
    `plik: ${state.file?.name || '—'}`,
    `nut: ${state.transcription.notes.length}`,
    `tempo: ${Math.round(state.transcription.bpm)} BPM`,
    `tonacja: ${state.transcription.key?.name || '—'}`,
    `skala: ${midiToName(state.transcription.stats.lowest ?? 0)}–${midiToName(state.transcription.stats.highest ?? 0)}`,
    `tryb pianina: ${DIFFICULTIES[state.difficulty].label} (${state.arranged?.notes.length ?? 0} nut)`,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(summary);
    toast('Podsumowanie skopiowane');
  } catch {
    toast('Przeglądarka zablokowała schowek.', 'error');
  }
});

/* -------------------------------------------------------------- skrót */

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Enter' || event.target !== document.body) return;
  if (!el.play.disabled) el.play.click();
});

setProgress(0, 'Czekam na plik…', null);
el.keyboardRoot.textContent = midiToName(piano.state.keyboardRoot);
el.chipMode.textContent = 'AUTO';
