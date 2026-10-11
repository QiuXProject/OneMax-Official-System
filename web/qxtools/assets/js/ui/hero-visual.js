/**
 * QXTools — animacja w hero: fala dźwiękowa przechodząca w piano roll.
 * Czyste canvas 2D, pauzuje poza ekranem i przy ograniczonym ruchu.
 */

import { roundRectPath } from './canvas.js';

const PALETTE = ['#7c5cff', '#22d3ee', '#ff4d8d', '#3ddc97', '#ffb020'];

/** Deterministyczny generator "melodii" do wizualizacji. */
function buildNotes(count = 46) {
  const scale = [0, 2, 3, 5, 7, 8, 10];
  const notes = [];
  let pitch = 8;
  let time = 0;
  for (let i = 0; i < count; i += 1) {
    const step = scale[(i * 3 + (i % 5)) % scale.length];
    pitch = Math.max(2, Math.min(17, 8 + step + ((i % 7) - 3)));
    const duration = 0.35 + ((i * 7) % 5) * 0.18;
    notes.push({ start: time, duration, pitch, color: PALETTE[i % PALETTE.length] });
    time += duration * 0.82;
  }
  return { notes, total: time };
}

export function startHeroVisual(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { notes, total } = buildNotes();

  let width = 0;
  let height = 0;
  let dpr = 1;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = Math.max(240, rect.width);
    height = Math.max(180, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const rows = 18;
  const rowHeight = () => height / rows;

  /** Fala po lewej stronie — suma sinusów, "surowe" audio. */
  const drawWave = (t, splitX) => {
    const mid = height / 2;
    ctx.lineWidth = 2;
    const grad = ctx.createLinearGradient(0, 0, splitX, 0);
    grad.addColorStop(0, 'rgba(34, 211, 238, 0.15)');
    grad.addColorStop(0.6, 'rgba(34, 211, 238, 0.85)');
    grad.addColorStop(1, 'rgba(124, 92, 255, 0.95)');
    ctx.strokeStyle = grad;
    ctx.shadowBlur = 16;
    ctx.shadowColor = 'rgba(34, 211, 238, 0.5)';
    ctx.beginPath();
    for (let x = 0; x <= splitX; x += 2) {
      const p = x / splitX;
      const amp = (0.16 + 0.1 * Math.sin(p * 6 + t * 0.7)) * height * (1 - p * 0.35);
      const y =
        mid +
        Math.sin(p * 22 - t * 2.1) * amp * 0.55 +
        Math.sin(p * 47 - t * 3.4) * amp * 0.28 +
        Math.sin(p * 91 + t * 1.6) * amp * 0.16;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const drawRoll = (t, splitX) => {
    const span = 9; // sekund widocznych
    const offset = (t * 0.55) % total;
    const x0 = splitX;
    const rollWidth = width - splitX;
    const rh = rowHeight();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, rollWidth, height);
    ctx.clip();

    // siatka
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let r = 1; r < rows; r += 1) {
      const y = r * rh;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (const note of notes) {
      let rel = note.start - offset;
      while (rel < -span) rel += total;
      while (rel > span) rel -= total;
      if (rel > span || rel + note.duration < 0) continue;
      const x = x0 + (rel / span) * rollWidth;
      const w = Math.max(6, (note.duration / span) * rollWidth);
      const y = height - (note.pitch + 1) * rh + 2;
      const h = rh - 4;
      const fade = Math.max(0, Math.min(1, 1 - Math.max(0, rel) / span));
      ctx.globalAlpha = 0.28 + fade * 0.72;
      ctx.fillStyle = note.color;
      ctx.shadowBlur = 14;
      ctx.shadowColor = note.color;
      roundRectPath(ctx, x, y, w, h, Math.min(5, h / 2));
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const draw = (time) => {
    const t = time / 1000;
    ctx.clearRect(0, 0, width, height);
    const splitX = Math.round(width * 0.34);

    // delikatny podział
    const divider = ctx.createLinearGradient(0, 0, 0, height);
    divider.addColorStop(0, 'rgba(255,255,255,0)');
    divider.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    divider.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX + 0.5, 0);
    ctx.lineTo(splitX + 0.5, height);
    ctx.stroke();

    drawWave(t, splitX);
    drawRoll(t, splitX);

    // "skanujący" promień
    const scan = (Math.sin(t * 0.6) * 0.5 + 0.5) * width;
    const beam = ctx.createLinearGradient(scan - 40, 0, scan + 40, 0);
    beam.addColorStop(0, 'rgba(255,255,255,0)');
    beam.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    beam.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(scan - 40, 0, 80, height);
  };

  if (reduced) {
    draw(0);
    return;
  }

  let running = true;
  let frame = 0;
  const loop = (time) => {
    if (!running) return;
    draw(time);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const shouldRun = entry.isIntersecting;
        if (shouldRun && !running) {
          running = true;
          frame = requestAnimationFrame(loop);
        } else if (!shouldRun && running) {
          running = false;
          cancelAnimationFrame(frame);
        }
      }
    });
    observer.observe(canvas);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!document.hidden && !running) {
      running = true;
      frame = requestAnimationFrame(loop);
    }
  });
}
