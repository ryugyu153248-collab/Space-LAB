import { describe, expect, it } from 'vitest';
import type { Satellite } from '@/types';
import { DEG, R_EARTH } from '../orbital/constants';
import { cwPropagate, cwTwoImpulse, dockingCheck, planRendezvous, relativeLvlh } from './rendezvous';

const T0 = Date.UTC(2026, 0, 1);
const a = R_EARTH + 500e3;
const n = Math.sqrt(3.986004418e14 / a ** 3);
const target: Satellite = { id: 't', name: 't', source: { kind: 'elements', elements: { a, e: 0, i: 51 * DEG, raan: 0, argp: 0, nu: 0 }, epoch: T0 }, origin: 'SIMULATED', provenance: '', epoch: T0, color: '#fff' };

describe('Clohessy-Wiltshire', () => {
  it('STM identities: t=0 gives identity; in-track drift ≈ −3 n x0 t·… for a radial offset (secular term 6(nt−sin nt)·x0 at small nt)', () => {
    const st = cwPropagate({ r: [100, 0, 0], v: [0, 0, 0] }, n, 0);
    expect(st.r).toEqual([100, 0, 0]);
    const t = 600; const out = cwPropagate({ r: [100, 0, 0], v: [0, 0, 0] }, n, t);
    expect(out.r[1]).toBeCloseTo(6 * (Math.sin(n * t) - n * t) * 100, 6);
  });
  it('two-impulse solution drives the linear model to the origin and zero relative velocity', () => {
    const rho0 = { r: [-500, -8000, 300] as [number, number, number], v: [0.2, 0.1, -0.05] as [number, number, number] };
    const T = 2400;
    const { dv1, dv2 } = cwTwoImpulse(rho0, n, T);
    const mid = cwPropagate({ r: rho0.r, v: [rho0.v[0] + dv1[0], rho0.v[1] + dv1[1], rho0.v[2] + dv1[2]] }, n, T);
    expect(Math.hypot(...mid.r)).toBeLessThan(1e-6);
    expect(Math.hypot(mid.v[0] + dv2[0], mid.v[1] + dv2[1], mid.v[2] + dv2[2])).toBeLessThan(1e-9);
  });
  it('planned burns evaluated with the FULL numerical propagator reach the target within 2 % of the initial separation', () => {
    // chaser 5 km behind, 1 km below, circular same orbit shape
    const phase = -5000 / a;
    const chEl = { a: a - 1000, e: 0, i: 51 * DEG, raan: 0, argp: 0, nu: phase };
    const chaser: Satellite = { ...target, id: 'c', source: { kind: 'elements', elements: chEl, epoch: T0 } };
    const tStart = T0 + 600_000;
    const rel0 = relativeLvlh(chaser, target, tStart)!;
    expect(Math.hypot(...rel0.st.r)).toBeGreaterThan(3000);
    const plan = planRendezvous(chaser, target, tStart, 2800)!;
    expect(plan.burns.length).toBeGreaterThan(0);
    const burned = { ...chaser, maneuvers: plan.burns };
    const d = dockingCheck(burned, target, tStart + 2800_000 + 1000, 1e9, 1e9)!;
    expect(d.range).toBeLessThan(0.02 * Math.hypot(...rel0.st.r));
    expect(d.relSpeed).toBeLessThan(1); // m/s
  });
});
