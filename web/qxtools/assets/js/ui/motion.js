/**
 * QXTools — wspólne zachowania interfejsu: tło, pole gwiazd, kursor-reflektor,
 * animacje wejścia, liczniki, pochylenie kart i nawigacja.
 */
import { startStarfield } from './starfield.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Warstwy tła (aurora, siatka, szum, winieta). */
export function mountBackground(root = document.body) {
  if (root.querySelector('.qx-bg')) return;
  const bg = document.createElement('div');
  bg.className = 'qx-bg';
  bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML = `
    <div class="qx-bg__aurora"><span></span><span></span><span></span><span></span></div>
    <div class="qx-bg__grid"></div>
    <div class="qx-bg__noise"></div>
    <div class="qx-bg__vignette"></div>
  `;
  root.prepend(bg);

  const spot = document.createElement('div');
  spot.className = 'qx-spotlight';
  spot.setAttribute('aria-hidden', 'true');
  root.appendChild(spot);

  if (reducedMotion) return;
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let x = targetX;
  let y = targetY;

  window.addEventListener('pointermove', (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
  }, { passive: true });

  const tick = () => {
    x += (targetX - x) * 0.09;
    y += (targetY - y) * 0.09;
    spot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Nawigacja: cień po przewinięciu + aktywny link. */
export function mountNav() {
  const nav = document.querySelector('.qx-nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const here = new URL(window.location.href).pathname.split('/').filter(Boolean).pop() || 'index.html';
  for (const link of nav.querySelectorAll('.qx-nav__link')) {
    const target = (link.getAttribute('href') || '').split('/').filter(Boolean).pop();
    if (target === here) link.classList.add('is-active');
  }
}

/** Pojawianie się elementów przy przewijaniu. */
export function mountReveal(root = document) {
  const items = [...root.querySelectorAll('.reveal')];
  if (!items.length) return;
  if (!('IntersectionObserver' in window) || reducedMotion) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );
  items.forEach((el) => observer.observe(el));
}

/** Liczniki animowane do wartości z data-count. */
export function mountCounters(root = document) {
  const nodes = [...root.querySelectorAll('[data-count]')];
  if (!nodes.length) return;
  const run = (node) => {
    const target = parseFloat(node.dataset.count);
    const decimals = parseInt(node.dataset.decimals || '0', 10);
    const suffix = node.dataset.suffix || '';
    if (reducedMotion) {
      node.textContent = `${target.toFixed(decimals)}${suffix}`;
      return;
    }
    const duration = 1500;
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = `${(target * eased).toFixed(decimals)}${suffix}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!('IntersectionObserver' in window)) {
    nodes.forEach(run);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      run(entry.target);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.5 });
  nodes.forEach((node) => observer.observe(node));
}

/** Pochylenie karty za kursorem (3D tilt). */
export function mountTilt(selector = '[data-tilt]') {
  if (reducedMotion || !window.matchMedia('(hover: hover)').matches) return;
  for (const card of document.querySelectorAll(selector)) {
    let frame = 0;
    const onMove = (event) => {
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.transform = `perspective(900px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 9).toFixed(2)}deg) translateY(-4px)`;
        card.style.setProperty('--tilt-x', `${(px * 100 + 50).toFixed(1)}%`);
        card.style.setProperty('--tilt-y', `${(py * 100 + 50).toFixed(1)}%`);
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      card.style.transform = '';
    };
    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerleave', reset);
  }
}

/** Podwaja zawartość paska przewijanego tekstu, żeby pętla była płynna. */
export function mountMarquee() {
  for (const track of document.querySelectorAll('.qx-marquee__track')) {
    if (track.dataset.cloned) continue;
    track.dataset.cloned = '1';
    track.innerHTML += track.innerHTML;
  }
}

/** Pasek postępu przewijania na samej górze strony. */
export function mountScrollProgress() {
  if (document.querySelector('.qx-scroll-progress')) return;
  const bar = document.createElement('div');
  bar.className = 'qx-scroll-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.width = `${(ratio * 100).toFixed(2)}%`;
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
}

/** Formatowanie rozmiaru pliku. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** mm:ss (albo h:mm:ss dla długich). */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Jedno miejsce inicjalizacji dla każdej strony. */
export function initChrome() {
  mountBackground();
  mountScrollProgress();
  startStarfield();
  mountNav();
  mountReveal();
  mountCounters();
  mountTilt();
  mountMarquee();
}
