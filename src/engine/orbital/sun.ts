import type { Vec3 } from '@/types';
import { DEG } from './constants';
import { julianDate } from './time';

export const AU = 1.495978707e11;
export const R_SUN = 6.957e8;

/**
 * Low-precision geocentric Sun position (Astronomical Almanac / Meeus Ch. 25 low-accuracy series).
 *   L = 280.460° + 0.9856474° n,  g = 357.528° + 0.9856003° n,  λ = L + 1.915° sin g + 0.020° sin 2g
 *   ε = 23.439° − 4e-7° n,        R = 1.00014 − 0.01671 cos g − 0.00014 cos 2g  [AU]
 * n = days since J2000.0 (UTC≈TT here). Frame: mean equator & equinox of date ≈ TEME axes (diff ≲ 0.01°).
 * Accuracy: ~0.01° in direction, ~1e-4 AU in distance (1950–2050). Output metres.
 */
export function sunPositionEci(utcMs: number): Vec3 {
  const n = julianDate(utcMs) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lam = L + 1.915 * DEG * Math.sin(g) + 0.02 * DEG * Math.sin(2 * g);
  const eps = (23.439 - 4e-7 * n) * DEG;
  const R = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU;
  return [R * Math.cos(lam), R * Math.cos(eps) * Math.sin(lam), R * Math.sin(eps) * Math.sin(lam)];
}
