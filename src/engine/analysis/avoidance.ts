import type { BurnDirection, Maneuver, Satellite } from '@/types';
import { closestApproachIn, type Conjunction } from './conjunction';

export interface AvoidanceCandidate {
  burn: Maneuver;
  dv: number;
  /** closest approach after the manoeuvre in the evaluation window */
  after: Conjunction | null;
}

export const withManeuver = (s: Satellite, m: Maneuver): Satellite => ({ ...s, maneuvers: [...(s.maneuvers ?? []), m] });

export function makeAvoidanceBurn(tca: number, leadSec: number, direction: BurnDirection, dv: number, isp = 220): Maneuver {
  return { id: `avoid-${Math.round(tca / 1000)}`, name: 'Collision avoidance burn', kind: 'impulsive', start: tca - leadSec * 1000, direction, dv, isp };
}

/** Closest approach of (A with burn) vs B within ±windowSec of the original TCA. */
export function evaluateAvoidance(
  primary: Satellite, secondary: Satellite, tca: number, leadSec: number, direction: BurnDirection, dv: number, windowSec = 1800,
): AvoidanceCandidate {
  const burn = makeAvoidanceBurn(tca, leadSec, direction, dv);
  const after = closestApproachIn(withManeuver(primary, burn), secondary, tca - windowSec * 1000, tca + windowSec * 1000, 5);
  return { burn, dv, after };
}

/**
 * Smallest Δv (m/s) that achieves miss ≥ targetMiss: geometric bracket (×2) then bisection (16 iterations).
 * Returns null if even `maxDv` is insufficient.
 */
export function minimumAvoidanceDv(
  primary: Satellite, secondary: Satellite, tca: number, leadSec: number, direction: BurnDirection, targetMiss: number, maxDv = 20,
): AvoidanceCandidate | null {
  const miss = (dv: number) => evaluateAvoidance(primary, secondary, tca, leadSec, direction, dv).after?.miss ?? 0;
  let lo = 0, hi = 0.001;
  while (miss(hi) < targetMiss) { lo = hi; hi *= 2; if (hi > maxDv) return null; }
  for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (miss(mid) >= targetMiss) hi = mid; else lo = mid; }
  return evaluateAvoidance(primary, secondary, tca, leadSec, direction, hi);
}
