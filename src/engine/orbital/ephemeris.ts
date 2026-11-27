import type { Geodetic, Satellite, StateVector, Vec3 } from '@/types';
import { eciToEcef, ecefToGeodetic } from './frames';
import { propagateSatellite } from './propagate';
import { norm } from './vec';
import { rvToElements, derivedElements } from './elements';

export interface EphemerisPoint {
  t: number;
  /** ECI/TEME position, m */
  rEci: Vec3;
  /** ECEF position, m */
  rEcef: Vec3;
  geo: Geodetic;
  /** m/s inertial speed */
  speed: number;
}

/** Sample a satellite's state over [t0, t1] with fixed step (s). Undefined samples (SGP4 errors) are skipped. */
export function sampleEphemeris(s: Satellite, t0: number, t1: number, stepSec: number): EphemerisPoint[] {
  const out: EphemerisPoint[] = [];
  const n = Math.max(1, Math.ceil((t1 - t0) / (stepSec * 1000)));
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    const st = propagateSatellite(s, t);
    if (!st) continue;
    out.push(pointFromState(st));
  }
  return out;
}

export function pointFromState(st: StateVector): EphemerisPoint {
  const rEcef = eciToEcef(st.r, st.t);
  return { t: st.t, rEci: st.r, rEcef, geo: ecefToGeodetic(rEcef), speed: norm(st.v) };
}

/** Orbital period (s) estimated from the satellite's osculating elements at time t. */
export function periodAt(s: Satellite, t: number): number | null {
  const st = propagateSatellite(s, t);
  if (!st) return null;
  return derivedElements(rvToElements(st.r, st.v)).period;
}

/** Sampling step (s) giving ~`pts` points per orbit; bounded to [5, 120] s. */
export function stepForPeriod(period: number, pts = 180): number {
  return Math.min(120, Math.max(5, period / pts));
}
