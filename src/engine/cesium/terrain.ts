import { CustomHeightmapTerrainProvider, WebMercatorTilingScheme } from 'cesium';

/**
 * Keyless global terrain: AWS/Mapzen "Terrarium" elevation tiles (public dataset, CORS enabled) wrapped as a Cesium heightmap provider.
 * Terrarium encodes height in RGB: h = R·256 + G + B/256 − 32768 [m]. Bathymetry is clamped to 0 so oceans stay flat.
 * Streaming + LOD are handled by Cesium's quadtree (tiles are requested per level as the camera zooms; maximum level 12 ≈ 38 m/px at the equator).
 * Fidelity: SRTM/ASTER-class (≈30–90 m); no vertical-datum (geoid) correction, so sea level is ±100 m off the WGS84 ellipsoid.
 * If the network blocks the tiles the provider reports "unavailable" and Cesium keeps the (flat) parent tile — nothing breaks.
 * With VITE_CESIUM_ION_TOKEN the app uses Cesium World Terrain instead.
 */
export const TERRARIUM_URL = (z: number, x: number, y: number): string => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const MAX_TERRAIN_LEVEL = 12;
const SIZE = 256;

export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** RGBA pixel buffer → heights (m, ≥ 0). */
export function terrariumToHeights(rgba: Uint8ClampedArray | Uint8Array, count = SIZE * SIZE): Float32Array {
  const h = new Float32Array(count);
  for (let i = 0; i < count; i++) h[i] = Math.max(0, decodeTerrarium(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]));
  return h;
}

async function loadTile(z: number, x: number, y: number): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(TERRARIUM_URL(z, x, y), { mode: 'cors' });
    if (!res.ok) return undefined;
    const bmp = await createImageBitmap(await res.blob());
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    const ctx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    bmp.close?.();
    return terrariumToHeights(ctx.getImageData(0, 0, SIZE, SIZE).data);
  } catch { return undefined; }
}

export function createTerrariumProvider(): CustomHeightmapTerrainProvider {
  return new CustomHeightmapTerrainProvider({
    width: SIZE, height: SIZE, tilingScheme: new WebMercatorTilingScheme(),
    credit: 'Terrain: Mapzen / AWS Terrain Tiles (Terrarium)',
    callback: (x, y, level) => (level > MAX_TERRAIN_LEVEL ? undefined : (loadTile(level, x, y) as Promise<Float32Array>)),
  });
}
