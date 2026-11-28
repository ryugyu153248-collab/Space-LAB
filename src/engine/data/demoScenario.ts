import type { ClassicalElements, GroundStation, Satellite } from '@/types';
import { DEG, R_EARTH, TWO_PI } from '../orbital/constants';
import { propagateTwoBody } from '../orbital/propagators/twobody';
import { norm } from '../orbital/vec';
import { eccentricToMean, eccentricToTrue, solveKepler, trueToEccentric } from '../orbital/elements';

export const DEMO_T0 = Date.UTC(2026, 0, 15, 0, 0, 0);
/** Intended encounter epoch used only to DESIGN the initial states (the analysis then finds the real TCA/miss distance). */
export const DEMO_ENCOUNTER = DEMO_T0 + 2.5 * 3600_000;

/** SpOC ground station (13.9418° N, 100.5888° E, 10 m, 5° elevation mask) — default operations station of the NAPA-2 scenario. */
export function spocStation(color = '#f59e0b'): GroundStation {
  return { id: 'gs-spoc', name: 'SpOC', lat: 13.9418 * DEG, lon: 100.5888 * DEG, alt: 10, minElevation: 5 * DEG, color };
}

export function bangkokStation(color = '#22c55e'): GroundStation {
  return { id: 'gs-bangkok', name: 'Bangkok Ground Station', lat: 13.7563 * DEG, lon: 100.5018 * DEG, alt: 0, minElevation: 10 * DEG, color };
}

/**
 * Design of the "LEO Collision Avoidance" demonstration — from real orbital geometry, not a prescribed miss distance:
 *  1. Satellite A: circular, h = 500 km, i = 53°, Ω = 20°, ν0 = 0 (two-body).
 *  2. Propagate A to the intended encounter time t_c → position r_A(t_c).
 *  3. Satellite B: a_B = a_A + 1 km, e = 0.0005 (a different period, so encounters do not repeat every half orbit),
 *     inclination 98° (crossing plane, ~11 km/s closing speed). Its orbit plane contains r_A(t_c):
 *       u = asin(z / (|r| sin i_B)),  Ω_B = atan2(y,x) − atan2(cos i_B sin u, cos u)
 *       (circular-orbit position: x = r(cosΩ cos u − sinΩ cos i sin u), y = r(sinΩ cos u + cosΩ cos i sin u), z = r sin i sin u)
 *     and the true anomaly ν* where B's radius equals |r_A|:  r = a(1−e²)/(1+e cosν)  ⇒  cosν* = (a_B(1−e²)/|r_A| − 1)/e,
 *     with ω_B = u − ν*.
 *  4. B is phased by δ = 0.02° of argument of latitude (≈ 2.4 km along-track timing error) and back-propagated to the epoch
 *     through Kepler's equation. Miss distance and TCA are *outputs* of the conjunction analysis.
 */
export function designConjunction(phaseOffsetDeg = 0.02): { a: ClassicalElements; b: ClassicalElements; epoch: number } {
  const radius = R_EARTH + 500e3;
  const a: ClassicalElements = { a: radius, e: 0, i: 53 * DEG, raan: 20 * DEG, argp: 0, nu: 0 };
  const rA = propagateTwoBody(a, DEMO_T0, DEMO_ENCOUNTER).r;
  const iB = 98 * DEG, aB = radius + 1000, eB = 0.0005;
  const u = Math.asin(rA[2] / norm(rA) / Math.sin(iB));
  const raanB = Math.atan2(rA[1], rA[0]) - Math.atan2(Math.cos(iB) * Math.sin(u), Math.cos(u));
  const nuStar = Math.acos((aB * (1 - eB * eB) / norm(rA) - 1) / eB);
  const argpB = u - nuStar;
  const nuTc = nuStar + phaseOffsetDeg * DEG;
  const nB = Math.sqrt(3.986004418e14 / aB ** 3);
  const Mtc = eccentricToMean(trueToEccentric(nuTc, eB), eB);
  const M0 = Mtc - nB * ((DEMO_ENCOUNTER - DEMO_T0) / 1000);
  const nu0 = eccentricToTrue(solveKepler(M0, eB), eB);
  const wrap = (x: number) => ((x % TWO_PI) + TWO_PI) % TWO_PI;
  return { a, b: { a: aB, e: eB, i: iB, raan: wrap(raanB), argp: wrap(argpB), nu: wrap(nu0) }, epoch: DEMO_T0 };
}

export function buildCollisionDemoSatellites(): Satellite[] {
  const d = designConjunction();
  const mk = (id: string, name: string, el: ClassicalElements, color: string): Satellite => ({
    id, name, source: { kind: 'elements', elements: el, epoch: d.epoch }, origin: 'SIMULATED',
    provenance: 'Simulated – analytic two-body, designed from encounter geometry', epoch: d.epoch, color,
    props: { massKg: 500, propellantKg: 40, cd: 2.2, area: 4, sensorHalfAngle: 20 * DEG, panelArea: 4, panelEfficiency: 0.28, batteryWh: 400, busLoadW: 180, commLoadW: 60 },
  });
  return [mk('sat-a', 'SAT-A (primary)', d.a, '#38bdf8'), mk('sat-b', 'SAT-B (secondary)', d.b, '#f97316')];
}
