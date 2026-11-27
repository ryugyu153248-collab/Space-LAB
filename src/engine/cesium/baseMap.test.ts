import { describe, expect, it } from 'vitest';
import { graticuleLines, isWater } from './baseMap';

describe('schematic base map helpers', () => {
  it('classifies typical NaturalEarthII pixels: ocean blue → water; forest, desert, ice → land', () => {
    expect(isWater(110, 160, 210)).toBe(true);   // ocean
    expect(isWater(60, 120, 200)).toBe(true);    // deep ocean
    expect(isWater(70, 110, 60)).toBe(false);    // forest
    expect(isWater(200, 180, 130)).toBe(false);  // desert
    expect(isWater(235, 238, 240)).toBe(false);  // ice
  });
  it('graticule: 24 meridians + 11 parallels at 15°, every line closed range, no pole parallels', () => {
    const g = graticuleLines(15, 3);
    expect(g).toHaveLength(24 + 11);
    expect(g[0][0]).toEqual({ lon: -180, lat: -90 }); expect(g[0].at(-1)).toEqual({ lon: -180, lat: 90 });
    const par = g[24]; expect(par[0].lat).toBe(-75); expect(par.at(-1)!.lon).toBe(180);
    expect(g.slice(24).every((l) => Math.abs(l[0].lat) < 90)).toBe(true);
  });
});
