import type { BurnDirection, Vec3 } from '@/types';
import { G0, MU_EARTH } from './constants';
import { cross, norm, scale } from './vec';

/**
 * Unit vector of a burn direction in the inertial frame, evaluated from the instantaneous state.
 *   prograde = v̂, normal = ĥ = (r×v)/|r×v| (orbit normal), radial = r̂ (outward from Earth centre).
 * For eccentric orbits "radial" is not perpendicular to v (it is the geometric radial direction).
 */
export function burnDirection(dir: BurnDirection, r: Vec3, v: Vec3): Vec3 {
  const vh = scale(v, 1 / norm(v));
  const h = cross(r, v);
  const nh = scale(h, 1 / norm(h));
  const rh = scale(r, 1 / norm(r));
  switch (dir) {
    case 'prograde': return vh;
    case 'retrograde': return scale(vh, -1);
    case 'radial': return rh;
    case 'antiradial': return scale(rh, -1);
    case 'normal': return nh;
    case 'antinormal': return scale(nh, -1);
  }
}

/** Tsiolkovsky rocket equation: Δv = Isp g0 ln(m0/mf)   [Isp s, g0 m/s², masses kg → m/s]. Ideal; no gravity/steering loss. */
export const rocketDv = (isp: number, m0: number, mf: number): number => isp * G0 * Math.log(m0 / mf);
/** Propellant mass needed for Δv: mp = m0 (1 − exp(−Δv/(Isp g0))). */
export const propellantForDv = (isp: number, m0: number, dv: number): number => m0 * (1 - Math.exp(-dv / (isp * G0)));
/** Burn duration for a constant-thrust finite burn delivering ideal Δv: t = (m0 Isp g0 / T)(1 − exp(−Δv/(Isp g0))). */
export const finiteBurnDuration = (isp: number, m0: number, thrust: number, dv: number): number =>
  (propellantForDv(isp, m0, dv) * isp * G0) / thrust;

export interface HohmannResult {
  /** m/s at departure (tangential) */ dv1: number;
  /** m/s at arrival (circularisation) */ dv2: number;
  total: number;
  /** s, time of flight = π sqrt(a_t³/μ) */ tof: number;
  /** transfer-orbit semi-major axis, m */ aTransfer: number;
}

/**
 * Hohmann transfer between coplanar circular orbits r1 → r2 (m from Earth centre):
 *   dv1 = sqrt(μ/r1) (sqrt(2 r2/(r1+r2)) − 1),  dv2 = sqrt(μ/r2) (1 − sqrt(2 r1/(r1+r2))),  TOF = π sqrt(a_t³/μ)
 * Signed: dv1, dv2 are positive for raising (prograde) and negative for lowering (retrograde).
 * Assumptions: two-body, impulsive burns, coplanar circular orbits.
 */
export function hohmann(r1: number, r2: number, mu = MU_EARTH): HohmannResult {
  const dv1 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
  const aT = (r1 + r2) / 2;
  return { dv1, dv2, total: Math.abs(dv1) + Math.abs(dv2), tof: Math.PI * Math.sqrt((aT * aT * aT) / mu), aTransfer: aT };
}

/** Pure plane change at speed v by Δi: Δv = 2 v sin(Δi/2)  (burn along ±orbit-normal at a node). */
export const planeChangeDv = (v: number, dInc: number): number => 2 * v * Math.sin(Math.abs(dInc) / 2);
