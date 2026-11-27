import type { Vec3 } from '@/types';
import { R_EARTH } from './constants';
import { R_SUN } from './sun';
import { dot, norm, sub } from './vec';

/**
 * Fraction of the solar disc visible from satellite position r (1 = full sunlight, 0 = umbra, between = penumbra/annular).
 * Conical shadow model (Montenbruck & Gill §3.4.2): apparent angular radii
 *   a = asin(R_sun/|r_sun − r|),  b = asin(R_earth/|r|),  c = angle(−r, r_sun − r)  (angular separation of the two discs)
 *   c ≥ a+b → 1;  c ≤ b−a → 0 (total);  otherwise overlap area of two circles / (π a²).
 * Assumptions: spherical Earth (R_EARTH equatorial, ignores oblateness ≈ 0.3 %), no atmospheric refraction/absorption.
 */
export function sunlightFraction(r: Vec3, rSun: Vec3): number {
  const rs = sub(rSun, r);
  const a = Math.asin(R_SUN / norm(rs));
  const b = Math.asin(Math.min(1, R_EARTH / norm(r)));
  const c = Math.acos(Math.max(-1, Math.min(1, dot([-r[0], -r[1], -r[2]], rs) / (norm(r) * norm(rs)))));
  if (c >= a + b) return 1;
  if (c <= b - a) return 0;
  if (c <= a - b) return 1 - (b * b) / (a * a); // annular (not reachable for Earth)
  const x = (c * c + a * a - b * b) / (2 * c);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  const area = a * a * Math.acos(Math.max(-1, Math.min(1, x / a))) + b * b * Math.acos(Math.max(-1, Math.min(1, (c - x) / b))) - c * y;
  return 1 - area / (Math.PI * a * a);
}

export type LightState = 'sunlight' | 'penumbra' | 'umbra';
export const lightState = (f: number): LightState => (f >= 1 - 1e-9 ? 'sunlight' : f <= 1e-9 ? 'umbra' : 'penumbra');
