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
