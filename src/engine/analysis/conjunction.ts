import type { Satellite, Vec3 } from '@/types';
import { propagateSatellite } from '../orbital/propagate';
import { cross, dot, norm, scale, sub } from '../orbital/vec';

export interface Conjunction {
  primaryId: string;
  secondaryId: string;
  /** time of closest approach, UTC ms */
  tca: number;
  /** m */
  miss: number;
  /** m/s */
  relSpeed: number;
  /** secondary − primary, ECI (TEME axes), m and m/s */
  relPos: Vec3;
  relVel: Vec3;
  /** relative position in the primary's RIC frame: radial / in-track / cross-track (m) */
  ric: { radial: number; intrack: number; crosstrack: number };
  rPrimary: Vec3; vPrimary: Vec3; rSecondary: Vec3; vSecondary: Vec3;
}

/** RIC unit vectors (columns) of an inertial state: R = r̂, C = (r×v)/|r×v|, I = C×R. */
export function ricBasis(r: Vec3, v: Vec3): { R: Vec3; I: Vec3; C: Vec3 } {
  const R = scale(r, 1 / norm(r));
  const h = cross(r, v);
  const C = scale(h, 1 / norm(h));
  return { R, I: cross(C, R), C };
}

function stateDiff(a: Satellite, b: Satellite, t: number) {
  const sa = propagateSatellite(a, t), sb = propagateSatellite(b, t);
  if (!sa || !sb) return null;
  return { sa, sb, d: norm(sub(sb.r, sa.r)) };
}

/** Build the conjunction record at time t. */
export function conjunctionAt(a: Satellite, b: Satellite, t: number): Conjunction | null {
  const x = stateDiff(a, b, t);
  if (!x) return null;
  const relPos = sub(x.sb.r, x.sa.r), relVel = sub(x.sb.v, x.sa.v);
  const { R, I, C } = ricBasis(x.sa.r, x.sa.v);
  return {
    primaryId: a.id, secondaryId: b.id, tca: t, miss: norm(relPos), relSpeed: norm(relVel), relPos, relVel,
    ric: { radial: dot(relPos, R), intrack: dot(relPos, I), crosstrack: dot(relPos, C) },
    rPrimary: x.sa.r, vPrimary: x.sa.v, rSecondary: x.sb.r, vSecondary: x.sb.v,
  };
}

/** Minimise |r_b − r_a| on [lo, hi] (golden-section; distance is unimodal around a single encounter). */
export function refineTca(a: Satellite, b: Satellite, lo: number, hi: number): number {
  const f = (t: number) => stateDiff(a, b, t)?.d ?? Infinity;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo), fc = f(c), fd = f(d);
  for (let k = 0; k < 80 && hi - lo > 1; k++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = f(c); }
    else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = f(d); }
  }
  return (lo + hi) / 2;
}

export interface ConjunctionOptions {
  /** coarse scan step, s (relative speeds ≤ 15 km/s ⇒ ≤ 450 km between samples at 30 s) */
  stepSec?: number;
  /** keep encounters closer than this (m) */
  screenDistance?: number;
}

/**
 * Screen a primary against secondaries over [t0, t1]: coarse relative-distance scan → local minima → golden-section TCA.
 * Geometry only — uses the same propagated states as the 3D view.
 */
export function screenConjunctions(
  primary: Satellite, secondaries: Satellite[], t0: number, t1: number, opts: ConjunctionOptions = {},
): Conjunction[] {
  const step = (opts.stepSec ?? 30) * 1000;
  const screen = opts.screenDistance ?? 200_000;
  const out: Conjunction[] = [];
  for (const sec of secondaries) {
    if (sec.id === primary.id) continue;
    const ts: number[] = [], ds: number[] = [];
    for (let t = t0; t <= t1 + step - 1; t += step) {
      const tt = Math.min(t, t1);
      const x = stateDiff(primary, sec, tt);
      ts.push(tt); ds.push(x ? x.d : Infinity);
      if (tt >= t1) break;
    }
    for (let i = 0; i < ds.length; i++) {
      const left = i > 0 ? ds[i - 1] : Infinity, right = i < ds.length - 1 ? ds[i + 1] : Infinity;
      if (ds[i] < screen * 4 && ds[i] <= left && ds[i] <= right && isFinite(ds[i])) {
        const lo = ts[Math.max(0, i - 1)], hi = ts[Math.min(ts.length - 1, i + 1)];
        const tca = refineTca(primary, sec, lo, hi);
        const c = conjunctionAt(primary, sec, tca);
        if (c && c.miss <= screen) out.push(c);
      }
    }
  }
  return out.sort((a, b) => a.miss - b.miss);
}

/** Closest approach inside a (short) window at fine resolution — used to evaluate avoidance manoeuvres. */
export function closestApproachIn(a: Satellite, b: Satellite, t0: number, t1: number, stepSec = 5): Conjunction | null {
  let best = Infinity, bt = t0;
  for (let t = t0; t <= t1; t += stepSec * 1000) {
    const x = stateDiff(a, b, t);
    if (x && x.d < best) { best = x.d; bt = t; }
  }
  if (!isFinite(best)) return null;
  const tca = refineTca(a, b, Math.max(t0, bt - stepSec * 1000), Math.min(t1, bt + stepSec * 1000));
  return conjunctionAt(a, b, tca);
}
