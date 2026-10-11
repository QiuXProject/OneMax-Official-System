/**
 * QXTools — piano roll z wynikiem transkrypcji.
 */
import { roundRectPath } from './canvas.js';

const PALETTE = ['#7c5cff', '#22d3ee', '#ff4d8d', '#3ddc97', '#ffb020', '#a78bfa'];

export function createPianoRoll(canvas) {
  const ctx = canvas.getContext('2d');
  let notes = [];
  let bpm = 120;
  let playhead = 0;
  let duration = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };

  const draw = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    if (!notes.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.font = '500 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Tu pojawi się piano roll po konwersji', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    let low = 127;
    let high = 0;
    for (const note of notes) {
      if (note.pitch < low) low = note.pitch;
      if (note.pitch > high) high = note.pitch;
      duration = Math.max(duration, note.start + note.duration);
    }
    low = Math.max(0, low - 2);
    high = Math.min(127, high + 2);
    const rows = Math.max(1, high - low + 1);
    const rowHeight = h / rows;
    const span = Math.max(0.5, duration);

    // siatka półtonów i taktów
    for (let pitch = low; pitch <= high; pitch += 1) {
      const y = h - (pitch - low + 1) * rowHeight;
      const black = [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
      ctx.fillStyle = black ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.012)';
      ctx.fillRect(0, y, w, rowHeight);
    }
    const secondsPerBeat = 60 / Math.max(30, bpm);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let beat = 0, i = 0; beat * secondsPerBeat < span; beat += 1, i += 1) {
      const x = ((beat * secondsPerBeat) / span) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.055)';
      ctx.stroke();
    }

    // nuty
    for (const note of notes) {
      const x = (note.start / span) * w;
      const nw = Math.max(2.5, (note.duration / span) * w);
      const y = h - (note.pitch - low + 1) * rowHeight + 0.5;
      const nh = Math.max(2, rowHeight - 1);
      const color = PALETTE[(note.pitch - low) % PALETTE.length];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35 + 0.6 * ((note.velocity ?? 90) / 127);
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      roundRectPath(ctx, x, y, nw, nh, Math.min(3, nh / 2));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (playhead > 0 && playhead < span) {
      const x = (playhead / span) * w;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  };

  window.addEventListener('resize', resize);

  const api = {
    setData(list, tempo) {
      notes = [...list].sort((a, b) => a.start - b.start);
      bpm = tempo || 120;
      duration = notes.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0);
      playhead = 0;
      resize();
    },
    setPlayhead(seconds) {
      playhead = seconds;
      draw();
    },
    draw,
    resize,
  };

  resize();
  return api;
}
