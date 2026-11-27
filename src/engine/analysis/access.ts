import type { GroundStation, Satellite } from '@/types';
import { eciToEcef } from '../orbital/frames';
import { lookAngles } from '../orbital/lookangles';
import { propagateSatellite } from '../orbital/propagate';

export interface Pass {
  /** Acquisition of signal – first instant el ≥ mask (UTC ms). If the window starts in contact: window start. */
  aos: number;
  los: number;
  duration: number; // s
  maxEl: number; // rad
  maxElTime: number;
  aosAz: number;
  losAz: number;
  minRange: number; // m
  /** true when contact was already in progress at the start / still in progress at the end of the window */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface AccessResult {
  satId: string;
  stationId: string;
  windowStart: number;
  windowEnd: number;
  minElevation: number;
  passes: Pass[];
}

const elAt = (sat: Satellite, stn: GroundStation, t: number): { el: number; az: number; range: number } | null => {
  const st = propagateSatellite(sat, t);
  return st ? lookAngles(stn, eciToEcef(st.r, t)) : null;
};

/**
 * Access (AOS/LOS) search.
 *  1. Coarse scan of f(t) = el(t) − mask at `stepSec` (default 20 s; LEO passes last minutes, a pass shorter
 *     than the step could be missed — documented limitation, the step is configurable).
 *  2. Each sign change is refined by bisection to ≤ 1 ms.
 *  3. Maximum elevation inside each pass by golden-section search (el(t) unimodal within a pass).
 * Geometry only: SGP4/two-body state → ECEF → look angles. No terrain, no refraction.
 */
export function computeAccess(
  sat: Satellite, stn: GroundStation, t0: number, t1: number, stepSec = 20,
): AccessResult {
  const mask = stn.minElevation;
  const f = (t: number): number => { const a = elAt(sat, stn, t); return a ? a.el - mask : -Math.PI; };
  const bisect = (lo: number, hi: number): number => {
    let flo = f(lo);
    for (let k = 0; k < 40 && hi - lo > 1; k++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if ((fm >= 0) === (flo >= 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const step = stepSec * 1000;
  const passes: Pass[] = [];
  let prevT = t0, prevF = f(t0);
  let aos: number | null = prevF >= 0 ? t0 : null;
  let clippedStart = prevF >= 0;

  const finish = (start: number, end: number, cs: boolean, ce: boolean) => {
    // golden-section search for max elevation
    const g = (t: number) => elAt(sat, stn, t)?.el ?? -Math.PI;
    let a = start, b = end;
    const phi = (Math.sqrt(5) - 1) / 2;
    let c = b - phi * (b - a), d = a + phi * (b - a);
    for (let k = 0; k < 60 && b - a > 10; k++) {
      if (g(c) > g(d)) b = d; else a = c;
      c = b - phi * (b - a); d = a + phi * (b - a);
    }
    const tm = (a + b) / 2;
    // sampled safeguard: max can sit at an endpoint of a clipped pass
    const cands = [start, tm, end];
    let best = cands[0];
    for (const t of cands) if (g(t) > g(best)) best = t;
    const am = elAt(sat, stn, best)!;
    const as = elAt(sat, stn, start), ae = elAt(sat, stn, end);
    // min range: sample densely inside the pass
    let minRange = Infinity;
    const n = 60;
    for (let k = 0; k <= n; k++) {
      const r = elAt(sat, stn, start + ((end - start) * k) / n)?.range;
      if (r !== undefined && r < minRange) minRange = r;
    }
    passes.push({
      aos: start, los: end, duration: (end - start) / 1000, maxEl: am.el, maxElTime: best,
      aosAz: as?.az ?? 0, losAz: ae?.az ?? 0, minRange, clippedStart: cs, clippedEnd: ce,
    });
  };

  for (let t = t0 + step; ; t += step) {
    const tt = Math.min(t, t1);
    const ft = f(tt);
    if (aos === null && ft >= 0 && prevF < 0) { aos = bisect(prevT, tt); clippedStart = false; }
    else if (aos !== null && ft < 0 && prevF >= 0) { finish(aos, bisect(prevT, tt), clippedStart, false); aos = null; }
    prevT = tt; prevF = ft;
    if (tt >= t1) break;
  }
  if (aos !== null) finish(aos, t1, clippedStart, true);
  return { satId: sat.id, stationId: stn.id, windowStart: t0, windowEnd: t1, minElevation: mask, passes };
}

/** Next contact at or after time t (the pass in progress counts). */
export function nextContact(res: AccessResult, t: number): Pass | null {
  return res.passes.find((p) => p.los >= t) ?? null;
}
