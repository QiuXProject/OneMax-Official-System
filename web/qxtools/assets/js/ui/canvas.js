/**
 * QXTools — drobne pomocniki canvas 2D.
 * roundRect jest w nowoczesnych przeglądarkach, ale nie wszędzie — mamy zapasową ścieżkę.
 */

/**
 * Rysuje zaokrąglony prostokąt jako ścieżkę (bez fill/stroke).
 * @param {CanvasRenderingContext2D} ctx
 */
export function roundRectPath(ctx, x, y, width, height, radius) {
  const w = Math.max(0.5, width);
  const h = Math.max(0.5, height);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
