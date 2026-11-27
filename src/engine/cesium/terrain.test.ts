import { describe, expect, it } from 'vitest';
import { decodeTerrarium, terrariumToHeights, TERRARIUM_URL } from './terrain';
import { cloudDensity, generateCloudData } from './clouds';

describe('terrain (Terrarium)', () => {
  it('decodes known heights: sea level (128,0,0)=0 m, Everest-like (168,… ) and negative values clamp to 0', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 10, 128)).toBeCloseTo(10.5, 6);            // 0 + 10 + 128/256
    expect(decodeTerrarium(162, 160, 0)).toBeCloseTo(34 * 256 + 160, 6);    // 8864 m
    const px = new Uint8ClampedArray([127, 0, 0, 255, 128, 0, 0, 255]);      // −256 m (bathymetry) and 0 m
    expect(Array.from(terrariumToHeights(px, 2))).toEqual([0, 0]);
  });
  it('builds XYZ tile URLs', () => { expect(TERRARIUM_URL(3, 4, 2)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/3/4/2.png'); });
});

describe('procedural clouds', () => {
  const w = 256, h = 128, d = generateCloudData(w, h, 7);
  it("is deterministic, alpha-only varying, 10–50 % mean opacity", () => {
    expect(Array.from(generateCloudData(32, 16, 7)).slice(0, 64)).toEqual(Array.from(generateCloudData(32, 16, 7)).slice(0, 64));
    let sum = 0; for (let i = 3; i < d.length; i += 4) sum += d[i] / 255;
    const cover = sum / (w * h);
    expect(cover).toBeGreaterThan(0.1); expect(cover).toBeLessThan(0.5);
    expect(d[0]).toBe(255);
  });
  it('is seamless across the date line (density at lon=±π equal) and well defined at the poles', () => {
    expect(cloudDensity(0.3, Math.PI)).toBeCloseTo(cloudDensity(0.3, -Math.PI), 9);
    expect(Number.isFinite(cloudDensity(Math.PI / 2, 0))).toBe(true);
    expect(cloudDensity(Math.PI / 2, 0)).toBeCloseTo(cloudDensity(Math.PI / 2, 2), 9);
  });
});
