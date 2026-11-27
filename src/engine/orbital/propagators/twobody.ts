import type { ClassicalElements, StateVector } from '@/types';
import { MU_EARTH } from '../constants';
import { eccentricToMean, eccentricToTrue, elementsToRv, solveKepler, trueToEccentric } from '../elements';

/**
 * Analytic two-body (Keplerian) propagation of classical elements.
 *   M(t) = M0 + n (t - t0);  solve Kepler's eq. for E;  ν = f(E);  state via elementsToRv.
 * Assumptions: point-mass Earth, no J2/drag/SRP. Output frame: ECI (TEME axes), SI units.
 * Limitation: orbit elements do not precess — fine for demos/short horizons; Phase 3 adds J2 numerical.
 * Label in UI: "Simulated (two-body)".
 */
export function propagateTwoBody(el: ClassicalElements, epochMs: number, utcMs: number, mu = MU_EARTH): StateVector {
  const n = Math.sqrt(mu / (el.a * el.a * el.a));
  const M0 = eccentricToMean(trueToEccentric(el.nu, el.e), el.e);
  const M = M0 + n * ((utcMs - epochMs) / 1000);
  const E = solveKepler(M, el.e);
  const nu = eccentricToTrue(E, el.e);
  const { r, v } = elementsToRv({ ...el, nu }, mu);
  return { t: utcMs, r, v, frame: 'ECI', model: 'TWOBODY' };
}
