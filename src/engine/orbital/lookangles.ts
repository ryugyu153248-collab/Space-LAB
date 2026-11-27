import type { GroundStation, Vec3 } from '@/types';
import { geodeticToEcef } from './frames';
import { norm, wrap2Pi } from './vec';

export interface LookAngles {
  /** rad, 0 = North, clockwise (E = π/2) */
  az: number;
  /** rad, above local horizon (ellipsoid-normal vertical) */
  el: number;
  /** m, straight-line range */
  range: number;
}

/**
 * Topocentric look angles of a target (ECEF, m) from a WGS84 ground station.
 *   ρ = r_sat − r_stn;  rotate into local ENU:
 *   e = −sinλ ρx + cosλ ρy
 *   n = −sinφ cosλ ρx − sinφ sinλ ρy + cosφ ρz
 *   u =  cosφ cosλ ρx + cosφ sinλ ρy + sinφ ρz
 *   el = asin(u/|ρ|),  az = atan2(e, n) ∈ [0, 2π),  range = |ρ|
 * Assumptions: no atmospheric refraction, geometric (not terrain) horizon; vertical = ellipsoid normal.
 */
export function lookAngles(stn: Pick<GroundStation, 'lat' | 'lon' | 'alt'>, rEcef: Vec3): LookAngles {
  const s = geodeticToEcef(stn);
  const d: Vec3 = [rEcef[0] - s[0], rEcef[1] - s[1], rEcef[2] - s[2]];
  const sl = Math.sin(stn.lat), cl = Math.cos(stn.lat), so = Math.sin(stn.lon), co = Math.cos(stn.lon);
  const e = -so * d[0] + co * d[1];
  const n = -sl * co * d[0] - sl * so * d[1] + cl * d[2];
  const u = cl * co * d[0] + cl * so * d[1] + sl * d[2];
  const range = norm(d);
  return { az: wrap2Pi(Math.atan2(e, n)), el: Math.asin(Math.max(-1, Math.min(1, u / range))), range };
}

/**
 * Earth-central angle (rad) of the visibility circle for a satellite at radius rSat (m from Earth centre)
 * seen above elevation mask ε from a station on a spherical Earth of radius R:
 *   λ = acos( R cosε / rSat ) − ε.   Ground radius ≈ R·λ.  (Spherical approximation, used for drawing only.)
 */
export function visibilityCentralAngle(R: number, rSat: number, minEl: number): number {
  return Math.max(0, Math.acos(Math.min(1, (R * Math.cos(minEl)) / rSat)) - minEl);
}
