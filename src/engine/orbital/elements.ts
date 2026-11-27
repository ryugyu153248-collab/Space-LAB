import type { ClassicalElements, Vec3 } from '@/types';
import { MU_EARTH, R_EARTH, TWO_PI } from './constants';
import { cross, dot, norm, wrap2Pi } from './vec';

const EPS = 1e-11;

/**
 * Cartesian state -> classical elements (Vallado Alg. 9).
 * Inputs: r [m], v [m/s] in an inertial frame; mu [m^3/s^2].
 * Special cases (Vallado): circular → argp := 0 and ν measured as argument of latitude from the node;
 * equatorial → RAAN := 0 (ν from the line of nodes = x-axis); circular-equatorial → true longitude.
 * Limitation: valid for elliptical orbits (e < 1) only.
 */
export function rvToElements(r: Vec3, v: Vec3, mu = MU_EARTH): ClassicalElements {
  const rn = norm(r), vn = norm(v);
  const h = cross(r, v);
  const hn = norm(h);
  const nvec: Vec3 = [-h[1], h[0], 0]; // k × h
  const nn = norm(nvec);
  const rv = dot(r, v);
  const evec: Vec3 = [0, 1, 2].map((k) => ((vn * vn - mu / rn) * r[k] - rv * v[k]) / mu) as Vec3;
  const e = norm(evec);
  const energy = (vn * vn) / 2 - mu / rn;
  const a = -mu / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));

  const circular = e < EPS;
  const equatorial = nn < EPS * hn || i < 1e-9 || Math.abs(i - Math.PI) < 1e-9;

  let raan = equatorial ? 0 : Math.acos(Math.max(-1, Math.min(1, nvec[0] / nn)));
  if (!equatorial && nvec[1] < 0) raan = TWO_PI - raan;

  let argp: number, nu: number;
  if (!circular) {
    if (!equatorial) {
      argp = Math.acos(Math.max(-1, Math.min(1, dot(nvec, evec) / (nn * e))));
      if (evec[2] < 0) argp = TWO_PI - argp;
    } else {
      argp = Math.atan2(evec[1], evec[0]);
      if (h[2] < 0) argp = -argp;
      argp = wrap2Pi(argp);
    }
    nu = Math.acos(Math.max(-1, Math.min(1, dot(evec, r) / (e * rn))));
    if (rv < 0) nu = TWO_PI - nu;
  } else {
    argp = 0;
    if (!equatorial) {
      nu = Math.acos(Math.max(-1, Math.min(1, dot(nvec, r) / (nn * rn)))); // argument of latitude
      if (r[2] < 0) nu = TWO_PI - nu;
    } else {
      nu = Math.acos(Math.max(-1, Math.min(1, r[0] / rn))); // true longitude
      if (r[1] < 0) nu = TWO_PI - nu;
      if (h[2] < 0) nu = TWO_PI - nu;
    }
  }
  return { a, e, i, raan: wrap2Pi(raan), argp: wrap2Pi(argp), nu: wrap2Pi(nu) };
}

/** Kepler's equation E - e sinE = M (elliptic), Newton iteration. M, E in rad. */
export function solveKepler(M: number, e: number): number {
  M = wrap2Pi(M);
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 50; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

export const trueToEccentric = (nu: number, e: number): number =>
  2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
export const eccentricToTrue = (E: number, e: number): number =>
  2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
export const eccentricToMean = (E: number, e: number): number => E - e * Math.sin(E);

/**
 * Classical elements -> Cartesian state (perifocal PQW → inertial via 3-1-3 rotation (Ω, i, ω)).
 *   p = a(1-e²); r_pqw = [p cosν, p sinν, 0]/(1+e cosν); v_pqw = sqrt(mu/p)[-sinν, e+cosν, 0]
 * Elliptical orbits only. Output units: m, m/s.
 */
export function elementsToRv(el: ClassicalElements, mu = MU_EARTH): { r: Vec3; v: Vec3 } {
  const { a, e, i, raan, argp, nu } = el;
  const p = a * (1 - e * e);
  const rmag = p / (1 + e * Math.cos(nu));
  const rp: Vec3 = [rmag * Math.cos(nu), rmag * Math.sin(nu), 0];
  const k = Math.sqrt(mu / p);
  const vp: Vec3 = [-k * Math.sin(nu), k * (e + Math.cos(nu)), 0];
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const R = [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
    [sw * si, cw * si, ci],
  ];
  const rot = (x: Vec3): Vec3 => [
    R[0][0] * x[0] + R[0][1] * x[1], R[1][0] * x[0] + R[1][1] * x[1], R[2][0] * x[0] + R[2][1] * x[1],
  ];
  return { r: rot(rp), v: rot(vp) };
}

export interface DerivedElements {
  /** s */ period: number;
  /** rad/s */ meanMotion: number;
  /** m, above R_EARTH (spherical reference radius) */ perigeeAlt: number;
  apogeeAlt: number;
  /** J/kg, ε = -mu/(2a) */ specificEnergy: number;
  /** m^2/s, h = sqrt(mu p) */ angularMomentum: number;
  /** rad, mean anomaly */ meanAnomaly: number;
}

/**
 * Derived quantities.  T = 2π sqrt(a³/mu);  n = sqrt(mu/a³);  r_p = a(1-e), r_a = a(1+e);  ε = -mu/(2a).
 * Altitudes are measured above the equatorial radius R_EARTH (spherical approximation – differs from true
 * geodetic height by up to ~21 km).
 */
export function derivedElements(el: ClassicalElements, mu = MU_EARTH): DerivedElements {
  const n = Math.sqrt(mu / (el.a * el.a * el.a));
  return {
    period: TWO_PI / n,
    meanMotion: n,
    perigeeAlt: el.a * (1 - el.e) - R_EARTH,
    apogeeAlt: el.a * (1 + el.e) - R_EARTH,
    specificEnergy: -mu / (2 * el.a),
    angularMomentum: Math.sqrt(mu * el.a * (1 - el.e * el.e)),
    meanAnomaly: eccentricToMean(trueToEccentric(el.nu, el.e), el.e),
  };
}

/** Vis-viva: v = sqrt(mu (2/r - 1/a)). r, a in m → m/s. Valid for any conic (a<0 for hyperbola). */
export function visViva(r: number, a: number, mu = MU_EARTH): number {
  return Math.sqrt(mu * (2 / r - 1 / a));
}
