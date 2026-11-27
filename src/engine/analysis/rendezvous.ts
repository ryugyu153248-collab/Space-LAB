import type { BurnDirection, Maneuver, Satellite, Vec3 } from '@/types';
import { cross, dot, norm, scale, sub } from '../orbital/vec';
import { propagateSatellite } from '../orbital/propagate';

/**
 * Clohessy–Wiltshire (Hill) linearised relative motion about a CIRCULAR target orbit of mean motion n.
 * LVLH axes: x = radial (outward), y = along-track (≈ velocity), z = orbit normal. ρ = chaser − target, state in the rotating frame.
 *   ρ(t)  = Φrr ρ0 + Φrv ρ̇0,   ρ̇(t) = Φvr ρ0 + Φvv ρ̇0
 * Assumptions: target circular, |ρ| ≪ orbit radius (valid to a few % for ≲ 10–50 km), two-body, no perturbations.
 */
export interface CwState { r: Vec3; v: Vec3 }

const mat = (m: number[][], x: Vec3): Vec3 => [0, 1, 2].map((i) => m[i][0] * x[0] + m[i][1] * x[1] + m[i][2] * x[2]) as Vec3;

export function cwMatrices(n: number, t: number) {
  const s = Math.sin(n * t), c = Math.cos(n * t);
  return {
    rr: [[4 - 3 * c, 0, 0], [6 * (s - n * t), 1, 0], [0, 0, c]],
    rv: [[s / n, (2 * (1 - c)) / n, 0], [(-2 * (1 - c)) / n, (4 * s - 3 * n * t) / n, 0], [0, 0, s / n]],
    vr: [[3 * n * s, 0, 0], [-6 * n * (1 - c), 0, 0], [0, 0, -n * s]],
    vv: [[c, 2 * s, 0], [-2 * s, 4 * c - 3, 0], [0, 0, c]],
  };
}

export function cwPropagate(st: CwState, n: number, t: number): CwState {
  const m = cwMatrices(n, t);
  const a = mat(m.rr, st.r), b = mat(m.rv, st.v), c = mat(m.vr, st.r), d = mat(m.vv, st.v);
  return { r: [a[0] + b[0], a[1] + b[1], a[2] + b[2]], v: [c[0] + d[0], c[1] + d[1], c[2] + d[2]] };
}

const inv3 = (m: number[][]): number[][] => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
};

/**
 * Two-impulse CW rendezvous in `T` seconds: Δv1 sets ρ̇0⁺ = −Φrv⁻¹ Φrr ρ0 so that ρ(T)=0; Δv2 = −ρ̇(T) removes the residual
 * relative velocity. Returns LVLH Δv vectors (m/s).
 */
export function cwTwoImpulse(rho0: CwState, n: number, T: number): { dv1: Vec3; dv2: Vec3; total: number } {
  const m = cwMatrices(n, T);
  const need = scale(mat(inv3(m.rv), mat(m.rr, rho0.r)), -1);
  const dv1 = sub(need, rho0.v);
  const vEnd = [0, 1, 2].map((i) => mat(m.vr, rho0.r)[i] + mat(m.vv, need)[i]) as Vec3;
  const dv2 = scale(vEnd, -1);
  return { dv1, dv2, total: norm(dv1) + norm(dv2) };
}

export function lvlhBasis(rT: Vec3, vT: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const x = scale(rT, 1 / norm(rT));
  const z = scale(cross(rT, vT), 1 / norm(cross(rT, vT)));
  return { x, y: cross(z, x), z };
}

/** Relative state of chaser w.r.t. target in the target's LVLH rotating frame at time t. */
export function relativeLvlh(chaser: Satellite, target: Satellite, t: number): { st: CwState; n: number } | null {
  const c = propagateSatellite(chaser, t), g = propagateSatellite(target, t);
  if (!c || !g) return null;
  const { x, y, z } = lvlhBasis(g.r, g.v);
  const n = norm(g.v) / norm(g.r);
  const rho = sub(c.r, g.r);
  const w = scale(z, n);
  const vRot = sub(sub(c.v, g.v), cross(w, rho)); // ρ̇_rot = ρ̇_inertial − ω×ρ
  const pr = (v: Vec3): Vec3 => [dot(v, x), dot(v, y), dot(v, z)];
  return { st: { r: pr(rho), v: pr(vRot) }, n };
}

/** LVLH Δv (m/s, target frame at burn time) → impulsive burns of the chaser along its own V/R/N axes (same instant). */
export function lvlhDvToBurns(dvLvlh: Vec3, chaser: Satellite, target: Satellite, t: number, idBase: string, name: string, isp = 220): Maneuver[] {
  const c = propagateSatellite(chaser, t), g = propagateSatellite(target, t);
  if (!c || !g) return [];
  const { x, y, z } = lvlhBasis(g.r, g.v);
  const dvEci: Vec3 = [0, 1, 2].map((i) => dvLvlh[0] * x[i] + dvLvlh[1] * y[i] + dvLvlh[2] * z[i]) as Vec3;
  const V = scale(c.v, 1 / norm(c.v)), N = scale(cross(c.r, c.v), 1 / norm(cross(c.r, c.v))), R = scale(c.r, 1 / norm(c.r));
  const comps: [BurnDirection, BurnDirection, number][] = [['prograde', 'retrograde', dot(dvEci, V)], ['radial', 'antiradial', dot(dvEci, R)], ['normal', 'antinormal', dot(dvEci, N)]];
  // V, R are not orthogonal for eccentric orbits; for the near-circular chaser used here the error is second order.
  return comps.filter(([, , d]) => Math.abs(d) > 1e-6).map(([p, a, d], k) => ({
    id: `${idBase}-${k}`, name, kind: 'impulsive' as const, start: t, direction: d >= 0 ? p : a, dv: Math.abs(d), isp,
  }));
}

export interface RendezvousPlan { burns: Maneuver[]; dv1: number; dv2: number; total: number; transferSec: number }

/** Plan a two-impulse CW rendezvous starting at tStart over transferSec. */
export function planRendezvous(chaser: Satellite, target: Satellite, tStart: number, transferSec: number): RendezvousPlan | null {
  const rel = relativeLvlh(chaser, target, tStart);
  if (!rel) return null;
  const { dv1, dv2, total } = cwTwoImpulse(rel.st, rel.n, transferSec);
  const b1 = lvlhDvToBurns(dv1, chaser, target, tStart, `rdv1-${tStart}`, 'Rendezvous burn 1');
  // burn 2 geometry depends on the chaser state at arrival, which depends on burn 1 → evaluate on the chaser including burn 1
  const withB1 = { ...chaser, maneuvers: [...(chaser.maneuvers ?? []), ...b1] };
  const tEnd = tStart + transferSec * 1000;
  const b2 = lvlhDvToBurns(dv2, withB1, target, tEnd, `rdv2-${tEnd}`, 'Rendezvous burn 2');
  return { burns: [...b1, ...b2], dv1: norm(dv1), dv2: norm(dv2), total, transferSec };
}

export interface DockingCheck { range: number; relSpeed: number; ok: boolean }
export function dockingCheck(chaser: Satellite, target: Satellite, t: number, maxRange: number, maxRelSpeed: number): DockingCheck | null {
  const c = propagateSatellite(chaser, t), g = propagateSatellite(target, t);
  if (!c || !g) return null;
  const range = norm(sub(c.r, g.r)), relSpeed = norm(sub(c.v, g.v));
  return { range, relSpeed, ok: range <= maxRange && relSpeed <= maxRelSpeed };
}
void dot;
