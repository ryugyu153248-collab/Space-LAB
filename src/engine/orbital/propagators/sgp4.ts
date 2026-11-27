import * as sat from 'satellite.js';
import type { StateVector } from '@/types';
import { KM } from '../constants';

export interface Sgp4Model {
  satrec: sat.SatRec;
  /** UTC epoch-ms of the TLE */
  epoch: number;
}

export function createSgp4(line1: string, line2: string): Sgp4Model {
  const satrec = sat.twoline2satrec(line1, line2);
  // jdsatepoch is UTC Julian date; convert to epoch-ms
  const epoch = (satrec.jdsatepoch - 2440587.5) * 86_400_000;
  return { satrec, epoch };
}

/**
 * SGP4 propagation. Output frame: TEME (position m, velocity m/s). Time: UTC.
 * Model fidelity: SGP4/SDP4 mean-element theory; accuracy ~1 km at epoch, degrading ~1-3 km/day.
 * Returns null if SGP4 reports an error (e.g. decayed orbit).
 */
export function propagateSgp4(m: Sgp4Model, utcMs: number): StateVector | null {
  const res = sat.propagate(m.satrec, new Date(utcMs));
  if (!res || !res.position || !res.velocity) return null;
  const p = res.position, v = res.velocity;
  if (typeof p === 'boolean' || typeof v === 'boolean') return null;
  return {
    t: utcMs,
    r: [p.x * KM, p.y * KM, p.z * KM],
    v: [v.x * KM, v.y * KM, v.z * KM],
    frame: 'TEME',
    model: 'SGP4',
  };
}
