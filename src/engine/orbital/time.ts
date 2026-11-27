import { MS_PER_DAY, TWO_PI } from './constants';

/** Julian Date (UTC scale) for UTC epoch-ms. Unix epoch = JD 2440587.5. */
export function julianDate(utcMs: number): number {
  return utcMs / MS_PER_DAY + 2440587.5;
}

/**
 * Greenwich Mean Sidereal Time, IAU-1982 model (Vallado, "Fundamentals of Astrodynamics", eq. 3-47).
 *   theta(sec) = 67310.54841 + (876600 h + 8640184.812866) T + 0.093104 T^2 - 6.2e-6 T^3
 * T = Julian centuries (UT1) since J2000.0.
 * Assumption: UT1 ≈ UTC (|UT1-UTC| < 0.9 s  =>  <= ~0.42 km ground error). Polar motion ignored.
 * @returns radians in [0, 2π)
 */
export function gmst(utcMs: number): number {
  const jd = julianDate(utcMs);
  const T = (jd - 2451545.0) / 36525.0;
  let sec =
    67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
  sec = ((sec % 86400) + 86400) % 86400;
  return (sec / 86400) * TWO_PI;
}

/** Parse TLE epoch fields (2-digit year, fractional day-of-year) to UTC epoch-ms. */
export function tleEpochToMs(yy: number, dayOfYear: number): number {
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * MS_PER_DAY;
}

export function formatUtc(ms: number, withMs = false): string {
  const iso = new Date(ms).toISOString(); // always UTC
  return (withMs ? iso.replace('T', ' ').replace('Z', '') : iso.slice(0, 19).replace('T', ' ')) + ' UTC';
}
