declare const CESIUM_BASE_URL: string;
const BASE = (typeof CESIUM_BASE_URL === 'string' ? CESIUM_BASE_URL : '/cesium') as string;

let bgPromise: Promise<HTMLCanvasElement> | null = null;
/** NaturalEarthII level-2 tiles (8×4 TMS, 256 px) stitched into a 2048×1024 equirectangular image. Bundled with Cesium → works offline. */
export function loadBackground(): Promise<HTMLCanvasElement> {
  return (bgPromise ??= new Promise((resolve) => {
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#0a1a2f'; ctx.fillRect(0, 0, 2048, 1024);
    let left = 32;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 4; y++) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, x * 256, (3 - y) * 256); if (--left === 0) resolve(cv); };
      img.onerror = () => { if (--left === 0) resolve(cv); };
      img.src = `${BASE}/Assets/Textures/NaturalEarthII/2/${x}/${y}.jpg`;
    }
  }));
}

/** Water test for a NaturalEarthII pixel: oceans are blue-dominant, land is green/brown/tan, ice is near-white. */
export const isWater = (r: number, g: number, b: number): boolean => b > r + 14 && b >= g - 6;

export interface SchematicPalette { waterDeep: [number, number, number]; waterShallow: [number, number, number]; landLow: [number, number, number]; landHigh: [number, number, number] }
export const SCHEMATIC_PALETTE: SchematicPalette = {
  waterDeep: [34, 112, 214], waterShallow: [76, 164, 252], landLow: [130, 188, 245], landHigh: [226, 242, 255],
};

/**
 * Technical-globe base texture: flat blue oceans with subtle depth shading, lighter land with relief shading, white polar ice.
 * Derived from the bundled NaturalEarthII raster (so it is offline and license-clean); only the land/water classification and luminance are used.
 */
export function schematicTexture(src: HTMLCanvasElement, pal: SchematicPalette = SCHEMATIC_PALETTE): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const sctx = src.getContext('2d')!, octx = out.getContext('2d')!;
  const img = sctx.getImageData(0, 0, w, h), dst = octx.createImageData(w, h);
  const lerp = (a: number[], b: number[], t: number, i: number) => a[i] + (b[i] - a[i]) * t;
  for (let p = 0; p < w * h; p++) {
    const r = img.data[4 * p], g = img.data[4 * p + 1], b = img.data[4 * p + 2];
    const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255, k = 4 * p;
    const water = isWater(r, g, b);
    const t = Math.min(1, Math.max(0, water ? (lum - 0.25) / 0.6 : (lum - 0.2) / 0.7));
    const A = water ? pal.waterDeep : pal.landLow, B = water ? pal.waterShallow : pal.landHigh;
    dst.data[k] = lerp(A, B, t, 0); dst.data[k + 1] = lerp(A, B, t, 1); dst.data[k + 2] = lerp(A, B, t, 2); dst.data[k + 3] = 255;
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

/** Lat/lon graticule as polylines in degrees: meridians pole-to-pole and parallels (excluding the poles), every `step` degrees. */
export function graticuleLines(step = 15, resolution = 3): { lon: number; lat: number }[][] {
  const lines: { lon: number; lat: number }[][] = [];
  for (let lon = -180; lon < 180; lon += step) {
    const l: { lon: number; lat: number }[] = [];
    for (let lat = -90; lat <= 90; lat += resolution) l.push({ lon, lat });
    lines.push(l);
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    const l: { lon: number; lat: number }[] = [];
    for (let lon = -180; lon <= 180; lon += resolution) l.push({ lon, lat });
    lines.push(l);
  }
  return lines;
}
