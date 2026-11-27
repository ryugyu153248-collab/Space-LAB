/**
 * PROCEDURAL cloud layer (offline, no weather data): fractal 3-D value noise sampled on the unit sphere (seamless at the date line and poles),
 * shaped by latitude (more cloud in the ITCZ and mid-latitude storm tracks, less in the subtropical highs). It is a visual layer only —
 * it does NOT represent real-time weather. Real-time cloud imagery would need an online source (e.g. NASA GIBS) and is not bundled.
 */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647 ^ 0x5bd1e995) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const v = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return L(L(L(v(0, 0, 0), v(1, 0, 0), xf), L(v(0, 1, 0), v(1, 1, 0), xf), yf), L(L(v(0, 0, 1), v(1, 0, 1), xf), L(v(0, 1, 1), v(1, 1, 1), xf), yf), zf);
}

export function cloudDensity(lat: number, lon: number, seed = 7): number {
  const cl = Math.cos(lat), x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = Math.sin(lat);
  let amp = 0.5, f = 2.2, sum = 0, norm = 0;
  for (let o = 0; o < 6; o++) { sum += amp * noise3(x * f + 11.3, y * f + 5.1, z * f + 2.7, seed + o); norm += amp; amp *= 0.5; f *= 2.07; }
  const n = sum / norm;
  // + ITCZ band near the equator, + mid-latitude storm tracks (~60°), − subtropical highs (~25°)
  const bias = 0.04 * Math.exp(-((lat / 0.2) ** 2)) + 0.05 * Math.exp(-(((Math.abs(lat) - 1.05) / 0.25) ** 2)) - 0.05 * Math.exp(-(((Math.abs(lat) - 0.45) / 0.18) ** 2));
  return n + bias;
}

/** RGBA (white, alpha = cloud cover) equirectangular image, w × h, row 0 = north. */
export function generateCloudData(w: number, h: number, seed = 7): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const lo = 0.56, hi = 0.7; // soft threshold → ≈ 30 % cover
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      const t = Math.min(1, Math.max(0, (cloudDensity(lat, lon, seed) - lo) / (hi - lo)));
      const a = t * t * (3 - 2 * t);
      const k = 4 * (j * w + i);
      out[k] = 255; out[k + 1] = 255; out[k + 2] = 255; out[k + 3] = Math.round(a * 200);
    }
  }
  return out;
}

export function cloudCanvas(w = 1024, h = 512, seed = 7): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.putImageData(new ImageData(generateCloudData(w, h, seed), w, h), 0, 0);
  return cv;
}
