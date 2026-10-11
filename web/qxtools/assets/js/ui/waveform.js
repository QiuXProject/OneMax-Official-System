/**
 * QXTools — rysowanie fali dźwiękowej z głowicą odtwarzania i przewijaniem.
 */
export function createWaveform(canvas) {
  const ctx = canvas.getContext('2d');
  let peaks = null;
  let duration = 0;
  let progress = 0;
  let notes = null;
  let dragging = false;

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

    // linia zerowa
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    if (!peaks) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '500 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('—', w / 2, h / 2 + 4);
      ctx.textAlign = 'left';
      return;
    }

    const mid = h / 2;
    const count = peaks.length / 2;
    const playedX = progress * w;

    for (let i = 0; i < count; i += 1) {
      const x = (i / count) * w;
      const min = peaks[i * 2];
      const max = peaks[i * 2 + 1];
      const played = x <= playedX;
      ctx.fillStyle = played ? 'rgba(34, 211, 238, 0.95)' : 'rgba(160, 170, 210, 0.42)';
      const top = mid - max * (h / 2 - 3);
      const bottom = mid - min * (h / 2 - 3);
      ctx.fillRect(x, top, Math.max(1, w / count - 0.4), Math.max(1, bottom - top));
    }

    // znaczniki wykrytych nut
    if (notes && notes.length && duration > 0) {
      ctx.fillStyle = 'rgba(124, 92, 255, 0.75)';
      for (const note of notes) {
        const x = (note.start / duration) * w;
        ctx.fillRect(x, 2, 1.5, 7);
      }
    }

    // głowica
    ctx.strokeStyle = 'rgba(255, 77, 141, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255, 77, 141, 0.8)';
    ctx.beginPath();
    ctx.moveTo(playedX, 0);
    ctx.lineTo(playedX, h);
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const seekFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (!duration) return;
    dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
    api.onSeek && api.onSeek(seekFromEvent(event));
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    api.onSeek && api.onSeek(seekFromEvent(event));
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });

  window.addEventListener('resize', resize);

  const api = {
    onSeek: null,
    setData(newPeaks, newDuration) {
      peaks = newPeaks;
      duration = newDuration;
      progress = 0;
      resize();
    },
    setNotes(list) {
      notes = list;
      draw();
    },
    setProgress(seconds) {
      if (!duration) return;
      progress = Math.max(0, Math.min(1, seconds / duration));
      draw();
    },
    draw,
    resize,
  };

  resize();
  return api;
}
