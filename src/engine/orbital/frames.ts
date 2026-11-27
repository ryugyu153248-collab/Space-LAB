import type { Geodetic, StateVector, Vec3 } from '@/types';
import { E2_EARTH, OMEGA_EARTH, R_EARTH } from './constants';
import { gmst } from './time';

/**
 * ECI (TEME axes) -> ECEF position.  r_ecef = R3(θ) r_eci, θ = GMST (rad).
 * Assumptions: TEME->PEF only (no polar motion, no equation of equinoxes since TEME is already mean-equinox based).
 */
export function eciToEcef(r: Vec3, utcMs: number): Vec3 {
  const th = gmst(utcMs);
  const c = Math.cos(th), s = Math.sin(th);
  return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
}

/** ECEF -> ECI (inverse rotation). */
export function ecefToEci(r: Vec3, utcMs: number): Vec3 {
  const th = gmst(utcMs);
  const c = Math.cos(th), s = Math.sin(th);
  return [c * r[0] - s * r[1], s * r[0] + c * r[1], r[2]];
}

/** ECI velocity -> ECEF (Earth-relative) velocity: v_ecef = R3(θ)(v_eci - ω×r_eci). */
export function eciToEcefVelocity(r: Vec3, v: Vec3, utcMs: number): Vec3 {
  const rel: Vec3 = [v[0] + OMEGA_EARTH * r[1], v[1] - OMEGA_EARTH * r[0], v[2]];
  return eciToEcef(rel, utcMs);
}

export function stateToEcef(s: StateVector): { r: Vec3; v: Vec3 } {
  return { r: eciToEcef(s.r, s.t), v: eciToEcefVelocity(s.r, s.v, s.t) };
}

/**
 * ECEF -> WGS84 geodetic, iterative (converges to <1e-9 rad in ≤ 5 iterations for LEO..GEO).
 *   N = a / sqrt(1 - e² sin²φ);  h = p/cosφ - N;  φ = atan2(z + e² N sinφ, p)
 */
export function ecefToGeodetic(r: Vec3): Geodetic {
  const [x, y, z] = r;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - E2_EARTH));
  let alt = 0;
  for (let k = 0; k < 8; k++) {
    const sl = Math.sin(lat);
    const N = R_EARTH / Math.sqrt(1 - E2_EARTH * sl * sl);
    alt = p / Math.cos(lat) - N;
    const next = Math.atan2(z + E2_EARTH * N * sl, p);
    if (Math.abs(next - lat) < 1e-12) { lat = next; break; }
    lat = next;
  }
  // near the poles p/cosφ is ill-conditioned; use z-based height there
  if (Math.abs(lat) > 1.5) {
    const sl = Math.sin(lat);
    const N = R_EARTH / Math.sqrt(1 - E2_EARTH * sl * sl);
    alt = z / sl - N * (1 - E2_EARTH);
  }
  return { lat, lon, alt };
}

/** WGS84 geodetic -> ECEF (m). */
export function geodeticToEcef(g: Geodetic): Vec3 {
  const sl = Math.sin(g.lat), cl = Math.cos(g.lat);
  const N = R_EARTH / Math.sqrt(1 - E2_EARTH * sl * sl);
  return [(N + g.alt) * cl * Math.cos(g.lon), (N + g.alt) * cl * Math.sin(g.lon), (N * (1 - E2_EARTH) + g.alt) * sl];
}
