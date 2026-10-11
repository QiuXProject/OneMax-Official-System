/**
 * QXTools — pasek analizatora widma rysowany z AnalyserNode syntezatora.
 */
export function startSpectrum(canvas, analyser) {
  if (!canvas) return { stop() {} };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {} };

  let width = 0;
  let height = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const bins = analyser && analyser.frequencyBinCount ? new Uint8Array(analyser.frequencyBinCount) : null;
  const bars = 72;
  const smoothed = new Float32Array(bars);
  let running = true;

  const draw = () => {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);
    if (analyser && bins) analyser.getByteFrequencyData(bins);

    const step = Math.floor((bins ? bins.length : bars) * 0.62 / bars) || 1;
    const barWidth = width / bars;
    for (let i = 0; i < bars; i += 1) {
      let value = 0;
      if (bins) {
        let sum = 0;
        for (let k = 0; k < step; k += 1) sum += bins[i * step + k] || 0;
        value = sum / step / 255;
      }
      // logarytmiczne wygładzenie, żeby pasek „oddychał”, a nie migotał
      smoothed[i] += (value - smoothed[i]) * (value > smoothed[i] ? 0.5 : 0.12);
      const h = Math.max(2, smoothed[i] * height * 1.05);
      const x = i * barWidth;
      const hue = 265 - (i / bars) * 190;
      const grad = ctx.createLinearGradient(0, height, 0, height - h);
      grad.addColorStop(0, `hsla(${hue}, 92%, 62%, 0.25)`);
      grad.addColorStop(1, `hsla(${hue}, 96%, 68%, 0.95)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, height - h, Math.max(1, barWidth - 2), h);
    }

    // linia bazowa
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, height - 1, width, 1);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  return {
    stop() {
      running = false;
    },
  };
}
