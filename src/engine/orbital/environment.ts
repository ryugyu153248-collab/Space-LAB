import { DEG } from './constants';

/**
 * SIMULATED space-environment models (clearly not measurements).
 * South Atlantic Anomaly: approximated by an ellipse in geodetic lat/lon centred at (−26° N, −50° E) with semi-axes 45° (lon) × 22° (lat),
 * roughly the >~ 100 nT-deficit region at 500 km. Fidelity: LOW (static, no altitude/epoch dependence, no drift of ~0.3°/yr).
 */
export const SAA = { lat: -26, lon: -50, semiLon: 45, semiLat: 22 } as const;

export const inSaa = (latRad: number, lonRad: number): boolean => {
  const dl = (((lonRad / DEG - SAA.lon + 540) % 360) - 180) / SAA.semiLon;
  const dp = (latRad / DEG - SAA.lat) / SAA.semiLat;
  return dl * dl + dp * dp <= 1;
};

/** Points of the SAA boundary (deg lon, lat) for drawing. */
export function saaOutline(n = 72): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [SAA.lon + SAA.semiLon * Math.cos(a), SAA.lat + SAA.semiLat * Math.sin(a)] as [number, number];
  });
}

/** Solar storm severity (NOAA G-scale 0–5, user-selected scenario input — simulated). Multiplier on the dose rate. */
export const stormFactor = (level: number): number => [1, 2, 4, 8, 16, 32][Math.max(0, Math.min(5, Math.round(level)))];

/**
 * Simulated radiation dose rate (µGy/h): quiet LEO background 5, ×40 inside the SAA, times the storm factor.
 * Placeholder magnitude for engineering UI exercises; NOT a radiation-environment model (no AP-8/AE-8 or AP-9/AE-9).
 */
export const doseRate = (inside: boolean, storm: number): number => 5 * (inside ? 40 : 1) * stormFactor(storm);
