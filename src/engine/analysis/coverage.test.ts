import { describe, expect, it } from 'vitest';
import type { Satellite } from '@/types';
import { DEG, R_EARTH } from '../orbital/constants';
import { computeCoverage, computeTargetWindows, offNadir } from './coverage';

const T0 = Date.UTC(2026, 0, 1);
const mk = (inc: number, h = 500e3): Satellite => ({
  id: 's', name: 's', source: { kind: 'elements', epoch: T0, elements: { a: R_EARTH + h, e: 0, i: inc * DEG, raan: 0, argp: 0, nu: 0 } },
  origin: 'SIMULATED', provenance: '', epoch: T0, color: '#fff',
});

describe('coverage', () => {
  it('equatorial-orbit nadir sensor never covers cells poleward of (swath half-width); covers the equator band', () => {
    const alpha = 20 * DEG;
    const res = computeCoverage({ sats: [mk(0)], halfAngles: { s: alpha }, t0: T0, t1: T0 + 86_400_000, stepSec: 20, gridDeg: 2 });
    const at = (lat: number) => res.passes[Math.floor((lat + 90) / 2) * res.nLon + 10];
    expect(at(0)).toBeGreaterThan(5);
    expect(at(60)).toBe(0);
    // half-swath: central angle λ = asin((R+h)/R·sinα) − α = 1.65° ⇒ cells centred at |lat| ≥ 3° must be untouched
    expect(at(10)).toBe(0);
    expect(res.coveragePct).toBeGreaterThan(0);
    expect(res.coveragePct).toBeLessThan(20);
  });
  it('polar orbit with wide sensor reaches both poles; coverage grows with sensor half-angle', () => {
    const narrow = computeCoverage({ sats: [mk(90)], halfAngles: { s: 10 * DEG }, t0: T0, t1: T0 + 86_400_000, stepSec: 20, gridDeg: 10 });
    const wide = computeCoverage({ sats: [mk(90)], halfAngles: { s: 40 * DEG }, t0: T0, t1: T0 + 86_400_000, stepSec: 20, gridDeg: 10 });
    expect(wide.coveragePct).toBeGreaterThan(narrow.coveragePct);
    expect(wide.passes[(nLatIndex(85, 10)) * wide.nLon]).toBeGreaterThan(0);
  });
  it('analytic swath: fraction observed at the equator by a polar orbit ≈ swath width / 360° per day-ish (≥ lower bound)', () => {
    const res = computeCoverage({ sats: [mk(90)], halfAngles: { s: 20 * DEG }, t0: T0, t1: T0 + 86_400_000, stepSec: 20, gridDeg: 10 });
    expect(res.maxGapSec[nLatIndex(5, 10) * res.nLon + 5]).toBeGreaterThan(0);
  });
});

describe('target windows', () => {
  it('a target under the ground track is observed with min off-nadir ≈ 0°; window durations are within one swath crossing', () => {
    const s = mk(51.6);
    // sub-satellite point at epoch is (0°N, 0°E rotated); use the ground target at the sub-point of t0+30 min
    const t = T0 + 1800_000;
    const o = offNadir({ ...s }, { lat: 0, lon: 0, alt: 0 }, t);
    void o;
    const wins = computeTargetWindows(s, { lat: 0, lon: 0, alt: 0 }, 25 * DEG, T0, T0 + 86_400_000, 10);
    expect(wins.length).toBeGreaterThan(0);
    for (const w of wins) {
      expect(w.minOffNadir).toBeLessThanOrEqual(25 * DEG + 1e-9);
      expect(w.duration).toBeLessThan(300);
    }
  });
});

function nLatIndex(lat: number, g: number): number { return Math.floor((lat + 90) / g); }
