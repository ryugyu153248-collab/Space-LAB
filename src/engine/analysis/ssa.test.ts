import { describe, expect, it } from 'vitest';
import type { Conjunction } from './conjunction';
import { screenConjunctions, closestApproachIn } from './conjunction';
import { classifyRisk, collisionProbability } from './collisionRisk';
import { evaluateAvoidance, minimumAvoidanceDv } from './avoidance';
import { DEMO_ENCOUNTER, DEMO_T0, buildCollisionDemoSatellites } from '../data/demoScenario';
import { norm } from '../orbital/vec';
import type { Vec3 } from '@/types';

const [A, B] = buildCollisionDemoSatellites();
const windowEnd = DEMO_T0 + 6 * 3600_000;

describe('conjunction analysis on the designed demo', () => {
  const all = screenConjunctions(A, [B], DEMO_T0, windowEnd, { screenDistance: 50_000 });
  // the designed encounter = the screened event closest in time to the design epoch
  const found = [...all].sort((x, y) => Math.abs(x.tca - DEMO_ENCOUNTER) - Math.abs(y.tca - DEMO_ENCOUNTER));
  it('finds the designed close approach (TCA within 10 s of the design time), high closing speed', () => {
    expect(found.length).toBeGreaterThanOrEqual(1);
    const c = found[0];
    expect(Math.abs(c.tca - DEMO_ENCOUNTER)).toBeLessThan(10_000);
    expect(c.miss).toBeLessThan(5000);
    expect(all.length).toBeLessThan(10); // encounters do not repeat every half orbit
    expect(c.relSpeed).toBeGreaterThan(8000);
  });
  it('miss distance is a computed result consistent with the design phase offset (δ=0.02° ⇒ ≤ ~2.5 km) and RIC sums to |Δr|', () => {
    const c = found[0];
    expect(c.miss).toBeLessThan(2500);
    expect(Math.hypot(c.ric.radial, c.ric.intrack, c.ric.crosstrack)).toBeCloseTo(c.miss, 3);
  });
  it('TCA is a true minimum: distance 5 s before/after is larger (relative-velocity ⟂ relative-position at TCA)', () => {
    const c = found[0];
    const d = (t: number) => closestApproachIn(A, B, t, t, 1)!.miss;
    expect(d(c.tca - 5000)).toBeGreaterThan(c.miss);
    expect(d(c.tca + 5000)).toBeGreaterThan(c.miss);
    const cosang = (c.relPos[0] * c.relVel[0] + c.relPos[1] * c.relVel[1] + c.relPos[2] * c.relVel[2]) / (c.miss * c.relSpeed);
    expect(Math.abs(cosang)).toBeLessThan(5e-3);
  });
  it('avoidance: a prograde burn one orbit before TCA raises the miss distance ≥ 10 km; minimum-Δv search meets the target', () => {
    const tca = found[0].tca;
    const lead = 5677;
    const best = minimumAvoidanceDv(A, B, tca, lead, 'prograde', 10_000)!;
    expect(best).not.toBeNull();
    expect(best.after!.miss).toBeGreaterThanOrEqual(10_000 - 1);
    expect(best.dv).toBeLessThan(5);
    expect(evaluateAvoidance(A, B, tca, lead, 'prograde', best.dv / 2).after!.miss).toBeLessThan(10_000);
  });
});

describe('collision probability', () => {
  const base = (miss: number): Conjunction => ({
    primaryId: 'a', secondaryId: 'b', tca: 0, miss, relSpeed: 10_000,
    relPos: [miss, 0, 0] as Vec3, relVel: [0, 10_000, 0] as Vec3, ric: { radial: 0, intrack: 0, crosstrack: 0 },
    rPrimary: [7e6, 0, 0], vPrimary: [0, 0, 7500], rSecondary: [7e6 + miss, 0, 0], vSecondary: [0, 10_000, 7500],
  });
  const cov = (s: number) => ({ radial: s, intrack: s, crosstrack: s });
  it('returns null Pc with an explanation when covariance is missing (never derives Pc from distance alone)', () => {
    const r = collisionProbability({ conj: base(500), covPrimary: null, covSecondary: cov(100), hbr: 10 });
    expect(r.pc).toBeNull();
    expect(r.note).toMatch(/covariance missing/);
  });
  it('zero offset, isotropic σ: Pc = 1 − exp(−R²/(2σ_c²)), σ_c² = 2σ² (rel. tol 1e-4)', () => {
    const sig = 100, R = 15;
    const r = collisionProbability({ conj: base(0), covPrimary: cov(sig), covSecondary: cov(sig), hbr: R });
    const exact = 1 - Math.exp(-(R * R) / (2 * 2 * sig * sig));
    expect(Math.abs(r.pc! / exact - 1)).toBeLessThan(1e-4);
  });
  it('offset case: small-HBR limit Pc ≈ πR²·pdf(miss) (tol 1 %) and Pc decreases with miss distance', () => {
    const sig = 100, R = 2, d = 150, s2 = 2 * sig * sig;
    const r = collisionProbability({ conj: base(d), covPrimary: cov(sig), covSecondary: cov(sig), hbr: R });
    const approx = (Math.PI * R * R * Math.exp(-(d * d) / (2 * s2))) / (2 * Math.PI * s2);
    expect(Math.abs(r.pc! / approx - 1)).toBeLessThan(0.01);
    const far = collisionProbability({ conj: base(400), covPrimary: cov(sig), covSecondary: cov(sig), hbr: R });
    expect(far.pc!).toBeLessThan(r.pc!);
  });
  it('risk classification: Pc thresholds, and miss-distance screening is labelled as such', () => {
    expect(classifyRisk(100, 2e-4).level).toBe('red');
    expect(classifyRisk(100, 3e-5).level).toBe('yellow');
    expect(classifyRisk(100, 1e-8).level).toBe('green');
    const s = classifyRisk(800, null);
    expect(s.level).toBe('red');
    expect(s.basis).toBe('miss-distance screening');
    expect(norm([1, 0, 0])).toBe(1);
  });
});
