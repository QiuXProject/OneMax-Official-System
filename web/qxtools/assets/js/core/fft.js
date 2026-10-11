/**
 * QXTools — szybka transformata Fouriera (radix-2, iteracyjna).
 * Działa w przeglądarce i w Node (brak zależności od Web API).
 */

/**
 * Tworzy wielokrotnego użytku kontekst FFT dla rozmiaru n (potęga dwójki).
 * @param {number} n
 */
export function createFFT(n) {
  if (n <= 0 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const levels = Math.round(Math.log2(n));
  const reverse = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let x = i;
    let r = 0;
    for (let j = 0; j < levels; j += 1) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    reverse[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return {
    n,
    levels,
    reverse,
    cos,
    sin,
    real: new Float64Array(n),
    imag: new Float64Array(n),
    /** Amplitudy dodatnich częstotliwości (n/2+1 wartości). */
    magnitudes: new Float64Array(n / 2 + 1),
  };
}

/**
 * FFT in-place na tablicach real/imag kontekstu.
 * @param {{n:number,reverse:Uint32Array,cos:Float64Array,sin:Float64Array,real:Float64Array,imag:Float64Array}} ctx
 * @param {Float64Array|Float32Array|number[]} input wartości trafiają do części rzeczywistej
 */
export function runFFT(ctx, input) {
  const { n, reverse, cos, sin, real, imag } = ctx;
  for (let i = 0; i < n; i += 1) {
    const j = reverse[i];
    real[j] = i < input.length ? input[i] : 0;
    imag[j] = 0;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j += 1, k += step) {
        const tReal = real[j + half] * cos[k] + imag[j + half] * sin[k];
        const tImag = imag[j + half] * cos[k] - real[j + half] * sin[k];
        real[j + half] = real[j] - tReal;
        imag[j + half] = imag[j] - tImag;
        real[j] += tReal;
        imag[j] += tImag;
      }
    }
  }
}

/**
 * FFT + widmo amplitudowe. Zwraca wewnętrzną tablicę ctx.magnitudes.
 * @param {ReturnType<typeof createFFT>} ctx
 * @param {Float64Array|Float32Array|number[]} input
 */
export function magnitudeSpectrum(ctx, input) {
  runFFT(ctx, input);
  const { real, imag, magnitudes } = ctx;
  for (let i = 0; i < magnitudes.length; i += 1) {
    magnitudes[i] = Math.hypot(real[i], imag[i]);
  }
  return magnitudes;
}

/** Okno Hanna. */
export function hannWindow(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
