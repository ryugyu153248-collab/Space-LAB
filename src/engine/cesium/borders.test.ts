import { describe, expect, it } from 'vitest';
import { loadBorders } from './borders';

describe('country borders (Natural Earth 50m, bundled)', () => {
  it('loads many valid lon/lat lines and contains the Thailand–Laos–Myanmar tri-point area and Thai–Cambodian border', async () => {
    const lines = await loadBorders();
    expect(lines.length).toBeGreaterThan(100);
    const pts = lines.flat();
    expect(pts.every(([lo, la]) => lo >= -180 && lo <= 180 && la >= -90 && la <= 90)).toBe(true);
    const near = (lo: number, la: number, d: number) => pts.some(([x, y]) => Math.hypot(x - lo, y - la) < d);
    expect(near(100.1, 20.35, 0.25)).toBe(true);   // Golden Triangle (Mekong tri-point)
    expect(near(102.55, 13.7, 0.25)).toBe(true);   // Poipet / Aranyaprathet crossing
    expect(near(-98, 31, 4)).toBe(true);           // US–Mexico border
  });
});

import { loadThailand } from './borders';
describe('Thailand full outline (land borders + coasts + islands)', () => {
  it('contains coastal points on both seas and the main islands, not only land borders', async () => {
    const t = await loadThailand();
    const pts = t.lines.flat();
    const near = (lo: number, la: number, d: number) => pts.some(([x, y]) => Math.hypot(x - lo, y - la) < d);
    expect(near(100.0, 13.4, 0.3)).toBe(true);    // upper Gulf of Thailand coast
    expect(near(99.9, 9.5, 0.4)).toBe(true);      // Gulf coast, Surat Thani / Samui area
    expect(near(98.3, 8.0, 0.4)).toBe(true);      // Andaman coast / Phuket
    expect(near(100.08, 20.35, 0.25)).toBe(true); // northern land border
    expect(near(100.9, 6.4, 0.5)).toBe(true);     // southern border with Malaysia
    expect(t.polygons.length).toBeGreaterThanOrEqual(5); // mainland + islands
    const mainland = t.polygons.reduce((a, b) => (b.length > a.length ? b : a));
    const lons = mainland.map((p) => p[0]), lats = mainland.map((p) => p[1]);
    expect(Math.min(...lons)).toBeLessThan(98); expect(Math.max(...lons)).toBeGreaterThan(105);
    expect(Math.min(...lats)).toBeLessThan(6.5); expect(Math.max(...lats)).toBeGreaterThan(20);
  });
});
