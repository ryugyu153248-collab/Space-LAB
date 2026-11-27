import type { Vec3 } from '@/types';
import type { Conjunction } from './conjunction';
import { ricBasis } from './conjunction';
import { cross, dot, norm, scale, sub } from '../orbital/vec';

/** 1σ position uncertainties in the object's own RIC frame, metres (uncorrelated / diagonal covariance). */
export interface RicSigma { radial: number; intrack: number; crosstrack: number }

export interface PcInput {
  conj: Conjunction;
  covPrimary: RicSigma | null;
  covSecondary: RicSigma | null;
  /** combined hard-body radius (sum of the two object radii), m */
  hbr: number;
}

export interface PcResult {
  pc: number | null;
  /** why Pc is not available, or the model used */
  note: string;
  /** encounter-plane quantities for reporting */
  encounter?: { missInPlane: number; sigmaMajor: number; sigmaMinor: number };
}

/**
 * Probability of collision — short-term encounter, 2-D Foster/Alfano model.
 *  Assumptions (all must hold, else Pc is not reliable): (1) relative motion is rectilinear and fast during the encounter;
 *  (2) position errors are Gaussian, uncorrelated between objects, constant over the encounter; (3) objects are spheres,
 *  combined hard-body radius HBR; (4) covariances are supplied by the user (not estimated here).
 *  Procedure: project the combined covariance C = C_p + C_s onto the plane ⟂ relative velocity,
 *    Pc = 1/(2π√det C₂) ∬_{x²+y²≤HBR²} exp(−½ (p−μ)ᵀ C₂⁻¹ (p−μ)) dA,   μ = projected miss vector.
 *  The integral is evaluated by polar midpoint quadrature (200 × 360 cells).
 * If either covariance is missing no number is produced: distance alone is NOT a probability.
 */
export function collisionProbability(inp: PcInput): PcResult {
  if (!inp.covPrimary || !inp.covSecondary) {
    return { pc: null, note: 'Pc not assessable: covariance missing for one or both objects (miss distance and relative velocity shown instead).' };
  }
  const { conj } = inp;
  const w = scale(conj.relVel, 1 / norm(conj.relVel));
  const rel = conj.relPos;
  let u = sub(rel, scale(w, dot(rel, w)));
  if (norm(u) < 1e-9) u = cross(w, Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  u = scale(u, 1 / norm(u));
  const v = cross(w, u);

  const covEci = (r: Vec3, vv: Vec3, s: RicSigma): number[][] => {
    const { R, I, C } = ricBasis(r, vv);
    const cols = [R, I, C], sg = [s.radial, s.intrack, s.crosstrack];
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += sg[k] * sg[k] * cols[k][i] * cols[k][j];
    return m;
  };
  const A = covEci(conj.rPrimary, conj.vPrimary, inp.covPrimary), B = covEci(conj.rSecondary, conj.vSecondary, inp.covSecondary);
  const Cm = A.map((row, i) => row.map((x, j) => x + B[i][j]));
  const proj = (p: Vec3, q: Vec3): number => { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += p[i] * Cm[i][j] * q[j]; return s; };
  const cxx = proj(u, u), cxy = proj(u, v), cyy = proj(v, v);
  const det = cxx * cyy - cxy * cxy;
  if (!(det > 0)) return { pc: null, note: 'Pc not assessable: degenerate combined covariance.' };
  const mx = dot(rel, u), my = dot(rel, v); // my ≈ 0
  const ixx = cyy / det, ixy = -cxy / det, iyy = cxx / det;
  const NR = 200, NT = 360;
  let sum = 0;
  for (let i = 0; i < NR; i++) {
    const rr = ((i + 0.5) / NR) * inp.hbr;
    for (let j = 0; j < NT; j++) {
      const th = ((j + 0.5) / NT) * 2 * Math.PI;
      const dx = rr * Math.cos(th) - mx, dy = rr * Math.sin(th) - my;
      sum += Math.exp(-0.5 * (ixx * dx * dx + 2 * ixy * dx * dy + iyy * dy * dy)) * rr;
    }
  }
  const pc = (sum * (inp.hbr / NR) * ((2 * Math.PI) / NT)) / (2 * Math.PI * Math.sqrt(det));
  const tr = cxx + cyy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return {
    pc: Math.min(1, pc), note: '2-D short-term encounter model (Foster/Alfano), user-supplied covariances',
    encounter: { missInPlane: Math.hypot(mx, my), sigmaMajor: Math.sqrt(tr / 2 + disc), sigmaMinor: Math.sqrt(Math.max(0, tr / 2 - disc)) },
  };
}

export type RiskLevel = 'green' | 'yellow' | 'red';
export interface Risk { level: RiskLevel; label: string; basis: 'Pc' | 'miss-distance screening' }

/**
 * Colour classification. With Pc: red ≥ 1e-4, yellow ≥ 1e-5 (common operational thresholds, user-adjustable in future).
 * Without covariance: SCREENING level from miss distance only (red < 1 km, yellow < 5 km) — explicitly not a probability.
 */
export function classifyRisk(miss: number, pc: number | null): Risk {
  if (pc !== null) {
    if (pc >= 1e-4) return { level: 'red', label: 'High', basis: 'Pc' };
    if (pc >= 1e-5) return { level: 'yellow', label: 'Medium', basis: 'Pc' };
    return { level: 'green', label: 'Low', basis: 'Pc' };
  }
  if (miss < 1000) return { level: 'red', label: 'High (screening)', basis: 'miss-distance screening' };
  if (miss < 5000) return { level: 'yellow', label: 'Medium (screening)', basis: 'miss-distance screening' };
  return { level: 'green', label: 'Low (screening)', basis: 'miss-distance screening' };
}
