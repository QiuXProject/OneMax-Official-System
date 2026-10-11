/**
 * QXTools — pole gwiazd w tle: powoli dryfujące punkty z parallaksą od kursora.
 */
export function startStarfield() {
  if (document.querySelector('.qx-stars')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'qx-stars';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let stars = [];
  let pointerX = 0.5;
  let pointerY = 0.5;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(150, (width * height) / 15000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.5 + 0.35,
      depth: Math.random() * 0.85 + 0.15,
      speed: Math.random() * 0.16 + 0.03,
      phase: Math.random() * Math.PI * 2,
    }));
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener(
    'pointermove',
    (event) => {
      pointerX = event.clientX / window.innerWidth;
      pointerY = event.clientY / window.innerHeight;
    },
    { passive: true },
  );

  let running = true;
  const draw = (time) => {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);
    const t = time / 1000;
    for (const star of stars) {
      const parallaxX = (pointerX - 0.5) * 46 * star.depth;
      const parallaxY = (pointerY - 0.5) * 30 * star.depth;
      const y = (star.y - t * star.speed * 22) % height;
      const x = star.x + parallaxX;
      const yy = (y < 0 ? y + height : y) + parallaxY;
      const twinkle = 0.45 + 0.55 * Math.sin(t * 1.6 + star.phase);
      ctx.beginPath();
      ctx.fillStyle = `rgba(${190 + Math.round(60 * star.depth)}, ${205}, 255, ${(0.18 + 0.5 * twinkle) * star.depth})`;
      ctx.arc(x, yy, star.r * star.depth, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
    } else if (!running) {
      running = true;
      requestAnimationFrame(draw);
    }
  });
}
