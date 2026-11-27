import type { Satellite, Vec3 } from '@/types';
import { DEG, R_EARTH } from '../orbital/constants';
import { eciToEcef, geodeticToEcef } from '../orbital/frames';
import { propagateSatellite } from '../orbital/propagate';
import { norm } from '../orbital/vec';
import { intervalsWhere } from './intervals';
import { lookAngles } from '../orbital/lookangles';

export interface CoverageInput {
  sats: Satellite[];
  /** conic sensor half-angle per satellite id, rad (nadir pointing) */
  halfAngles: Record<string, number>;
  t0: number; t1: number; stepSec: number;
  /** grid spacing, deg */
  gridDeg: number;
  /** optional region (deg). Default: global */
  region?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
}

export interface CoverageResult {
  nLat: number; nLon: number; latMin: number; lonMin: number; gridDeg: number;
  /** number of distinct observation passes per cell */
  passes: Uint16Array;
  /** seconds covered per cell */
  coveredSec: Float32Array;
  /** longest gap (s) between observations incl. window edges; = window length if never covered */
  maxGapSec: Float32Array;
  /** area-weighted percentage of cells observed at least once */
  coveragePct: number;
  /** area-weighted mean of (window / passes) over covered cells, s */
  meanRevisitSec: number;
  windowSec: number;
}

/**
 * Coverage / revisit analysis for nadir-pointing conic sensors on the geometry of the real propagated states:
 *   a cell (WGS84 ground point) is observed when the angle between the sensor boresight (−r̂_sat) and the line of sight
 *   to the cell is ≤ half-angle α AND the satellite is above the cell's local horizon.
 * Reject test uses the Earth-central angle bound λmax first (cheap), then the exact angle test.
 * Limitations: nadir pointing only (off-nadir/targeting handled by target access), time-sampled at stepSec
 * (swath crossing is missed if narrower than v·step), spherical cell-area weighting cos(lat).
 */
export function computeCoverage(inp: CoverageInput, onProgress?: (f: number) => void): CoverageResult {
  const g = inp.gridDeg;
  const r = inp.region ?? { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };
  const nLat = Math.max(1, Math.round((r.latMax - r.latMin) / g)), nLon = Math.max(1, Math.round((r.lonMax - r.lonMin) / g));
  const N = nLat * nLon;
  const cell = new Float64Array(N * 3), up = new Float64Array(N * 3), w = new Float64Array(N);
  for (let i = 0; i < nLat; i++) {
    const lat = (r.latMin + (i + 0.5) * g) * DEG;
    for (let j = 0; j < nLon; j++) {
      const lon = (r.lonMin + (j + 0.5) * g) * DEG, k = i * nLon + j;
      const p = geodeticToEcef({ lat, lon, alt: 0 });
      cell[3 * k] = p[0]; cell[3 * k + 1] = p[1]; cell[3 * k + 2] = p[2];
      up[3 * k] = Math.cos(lat) * Math.cos(lon); up[3 * k + 1] = Math.cos(lat) * Math.sin(lon); up[3 * k + 2] = Math.sin(lat);
      w[k] = Math.cos(lat);
    }
  }
  const passes = new Uint16Array(N), covered = new Float32Array(N), maxGap = new Float32Array(N);
  const lastEnd = new Float64Array(N).fill(inp.t0), inCov = new Uint8Array(N);
  const step = inp.stepSec * 1000, nSteps = Math.floor((inp.t1 - inp.t0) / step);

  for (let s = 0; s <= nSteps; s++) {
    const t = inp.t0 + s * step;
    const seen = new Uint8Array(N);
    for (const sat of inp.sats) {
      const alpha = inp.halfAngles[sat.id];
      if (!alpha) continue;
      const st = propagateSatellite(sat, t);
      if (!st) continue;
      const p = eciToEcef(st.r, t);
      const pn = norm(p), cosAlpha = Math.cos(alpha);
      const ux = p[0] / pn, uy = p[1] / pn, uz = p[2] / pn;
      // central-angle bound: cosλ ≥ R cosη.. use generous λmax from α and altitude (spherical)
      const sinEta = Math.min(1, (pn / R_EARTH) * Math.sin(alpha));
      const lamMax = Math.asin(sinEta) - alpha > 0 ? Math.PI - Math.asin(sinEta) - alpha : Math.acos(Math.min(1, R_EARTH / pn));
      const cosLamMax = Math.cos(Math.min(lamMax, Math.acos(Math.min(1, R_EARTH / pn))) + 0.02);
      for (let k = 0; k < N; k++) {
        if (seen[k]) continue;
        const cx = up[3 * k], cy = up[3 * k + 1], cz = up[3 * k + 2];
        if (ux * cx + uy * cy + uz * cz < cosLamMax) continue;
        const dx = cell[3 * k] - p[0], dy = cell[3 * k + 1] - p[1], dz = cell[3 * k + 2] - p[2];
        const dn = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const cosOff = -(dx * ux + dy * uy + dz * uz) / dn; // angle between nadir (−r̂) and LOS to the cell
        if (cosOff >= cosAlpha && -(dx * cx + dy * cy + dz * cz) / dn > 0) seen[k] = 1;
      }
    }
    for (let k = 0; k < N; k++) {
      if (seen[k]) {
        covered[k] += inp.stepSec;
        if (!inCov[k]) { passes[k]++; maxGap[k] = Math.max(maxGap[k], (t - lastEnd[k]) / 1000); inCov[k] = 1; }
        lastEnd[k] = t;
      } else inCov[k] = 0;
    }
    if (onProgress && s % 50 === 0) onProgress(s / nSteps);
  }
  const windowSec = (inp.t1 - inp.t0) / 1000;
  let wSum = 0, wCov = 0, wRev = 0, wRevN = 0;
  for (let k = 0; k < N; k++) {
    maxGap[k] = Math.max(maxGap[k], (inp.t1 - lastEnd[k]) / 1000);
    if (passes[k] === 0) maxGap[k] = windowSec;
    wSum += w[k];
    if (passes[k] > 0) { wCov += w[k]; wRev += w[k] * (windowSec / passes[k]); wRevN += w[k]; }
  }
  onProgress?.(1);
  return {
    nLat, nLon, latMin: r.latMin, lonMin: r.lonMin, gridDeg: g, passes, coveredSec: covered, maxGapSec: maxGap,
    coveragePct: (100 * wCov) / wSum, meanRevisitSec: wRevN ? wRev / wRevN : Infinity, windowSec,
  };
}

export interface TargetWindow { start: number; end: number; duration: number; minOffNadir: number; tMin: number; rangeAtMin: number; clippedStart: boolean; clippedEnd: boolean }

/** Off-nadir angle (rad) from satellite to a ground target, or null if below horizon. */
export function offNadir(sat: Satellite, target: { lat: number; lon: number; alt: number }, t: number): { off: number; range: number } | null {
  const st = propagateSatellite(sat, t);
  if (!st) return null;
  const p = eciToEcef(st.r, t);
  const la = lookAngles(target, p);
  if (la.el <= 0) return null;
  const tg = geodeticToEcef(target);
  const d: Vec3 = [tg[0] - p[0], tg[1] - p[1], tg[2] - p[2]];
  const cos = -(d[0] * p[0] + d[1] * p[1] + d[2] * p[2]) / (norm(d) * norm(p));
  return { off: Math.acos(Math.max(-1, Math.min(1, cos))), range: la.range };
}

/** Windows in which a ground target lies inside the sensor cone (nadir-pointing; half-angle α). */
export function computeTargetWindows(
  sat: Satellite, target: { lat: number; lon: number; alt: number }, alpha: number, t0: number, t1: number, stepSec = 20,
): TargetWindow[] {
  const inside = (t: number) => { const o = offNadir(sat, target, t); return !!o && o.off <= alpha; };
  return intervalsWhere(inside, t0, t1, stepSec * 1000).map((iv) => {
    let best = Infinity, tMin = iv.start, rng = 0;
    for (let k = 0; k <= 40; k++) {
      const t = iv.start + ((iv.end - iv.start) * k) / 40, o = offNadir(sat, target, t);
      if (o && o.off < best) { best = o.off; tMin = t; rng = o.range; }
    }
    return { start: iv.start, end: iv.end, duration: (iv.end - iv.start) / 1000, minOffNadir: best, tMin, rangeAtMin: rng, clippedStart: iv.clippedStart, clippedEnd: iv.clippedEnd };
  });
}
