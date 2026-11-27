import type { Satellite } from '@/types';
import { sunlightFraction } from '../orbital/eclipse';
import { propagateSatellite } from '../orbital/propagate';
import { sunPositionEci } from '../orbital/sun';
import { intervalsWhere } from './intervals';

export interface EclipseInterval {
  /** entry into penumbra (shadow start) and exit (UTC ms) */
  start: number; end: number;
  /** umbra sub-interval, if the satellite reaches total shadow */
  umbraStart?: number; umbraEnd?: number;
  clippedStart: boolean; clippedEnd: boolean;
}

export const illumination = (sat: Satellite, t: number): number | null => {
  const st = propagateSatellite(sat, t);
  return st ? sunlightFraction(st.r, sunPositionEci(t)) : null;
};

/** Shadow intervals (penumbra+umbra) with umbra sub-intervals. Geometry: conical Earth shadow (see orbital/eclipse.ts). */
export function computeEclipses(sat: Satellite, t0: number, t1: number, stepSec = 30): EclipseInterval[] {
  const shadow = intervalsWhere((t) => (illumination(sat, t) ?? 1) < 1, t0, t1, stepSec * 1000);
  const umbra = intervalsWhere((t) => (illumination(sat, t) ?? 1) <= 1e-9, t0, t1, stepSec * 1000);
  return shadow.map((s) => {
    const u = umbra.find((x) => x.start >= s.start - 1 && x.end <= s.end + 1);
    return { start: s.start, end: s.end, umbraStart: u?.start, umbraEnd: u?.end, clippedStart: s.clippedStart, clippedEnd: s.clippedEnd };
  });
}
