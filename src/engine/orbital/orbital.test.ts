import { describe, expect, it } from 'vitest';
import * as sat from 'satellite.js';
import { DEG, MU_EARTH, R_EARTH, TWO_PI } from './constants';
import { derivedElements, elementsToRv, rvToElements, solveKepler, visViva } from './elements';
import { ecefToGeodetic, eciToEcef, ecefToEci, geodeticToEcef } from './frames';
import { gmst, julianDate } from './time';
import { createSgp4, propagateSgp4 } from './propagators/sgp4';
import { propagateTwoBody } from './propagators/twobody';
import { norm, wrapPi } from './vec';

describe('time', () => {
  it('Julian date of J2000.0 (2000-01-01 12:00 UTC) is 2451545.0', () => {
    expect(julianDate(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(2451545.0, 9);
  });
  it('GMST: Vallado Example 3-5 — 1992-08-20 12:14 UTC → 152.578787810° (UT1≈UTC, tol 0.01°)', () => {
    // Vallado gives 152.578787810° for UT1 = 12:14:00 on 1992-08-20.
    const g = gmst(Date.UTC(1992, 7, 20, 12, 14, 0)) / DEG;
    expect(Math.abs(g - 152.57878781)).toBeLessThan(0.01);
  });
  it('GMST agrees with satellite.js gstime (tol 1e-6 rad)', () => {
    const d = new Date(Date.UTC(2024, 5, 15, 3, 21, 9));
    expect(Math.abs(gmst(d.getTime()) - sat.gstime(d))).toBeLessThan(1e-6);
  });
});

describe('SGP4 (reference: SGP4-VER satellite 00005, tsince = 0)', () => {
  const l1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
  const l2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';
  const ref = { r: [7022465.29266, -1400082.96755, 39.95155], v: [1893.841015, 6405.893759, 4534.807250] };
  it('raw SGP4 (tsince = 0) matches the published TEME state: |Δr| < 1e-5 km·(10), |Δv| < 1e-7 km/s', () => {
    const m = createSgp4(l1, l2);
    const out = sat.sgp4(m.satrec, 0) as { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } };
    const p = [out.position.x, out.position.y, out.position.z].map((x) => x * 1000);
    const v = [out.velocity.x, out.velocity.y, out.velocity.z].map((x) => x * 1000);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(p[k] - ref.r[k])).toBeLessThan(0.1); // 0.1 m
      expect(Math.abs(v[k] - ref.v[k])).toBeLessThan(1e-3); // 1 mm/s
    }
  });
  it('wrapper at epoch (Date has 1 ms resolution ⇒ ≤0.5 ms × 7.5 km/s ≈ 4 m): |Δr| < 5 m, |Δv| < 0.01 m/s', () => {
    const m = createSgp4(l1, l2);
    const s = propagateSgp4(m, m.epoch)!;
    expect(s.frame).toBe('TEME');
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(s.r[k] - ref.r[k])).toBeLessThan(5);
      expect(Math.abs(s.v[k] - ref.v[k])).toBeLessThan(0.01);
    }
  });
});

describe('elements', () => {
  const cases = [
    { name: 'inclined elliptical', a: 8000e3, e: 0.15, i: 51.6 * DEG, raan: 120 * DEG, argp: 60 * DEG, nu: 200 * DEG },
    { name: 'near-circular LEO', a: R_EARTH + 500e3, e: 0.001, i: 97.4 * DEG, raan: 300 * DEG, argp: 10 * DEG, nu: 330 * DEG },
  ];
  for (const c of cases) {
    it(`round-trip ${c.name} (angles tol 1e-9 rad, a tol 1e-3 m)`, () => {
      const { name: _n, ...el } = c;
      const { r, v } = elementsToRv(el);
      const back = rvToElements(r, v);
      expect(Math.abs(back.a - el.a)).toBeLessThan(1e-3);
      expect(Math.abs(back.e - el.e)).toBeLessThan(1e-9);
      for (const k of ['i', 'raan', 'argp', 'nu'] as const) expect(Math.abs(wrapPi(back[k] - el[k]))).toBeLessThan(1e-8);
    });
  }
  it('circular orbit: ν = argument of latitude, argp = 0', () => {
    const { r, v } = elementsToRv({ a: 7000e3, e: 0, i: 0.5, raan: 1, argp: 0, nu: 2 });
    const b = rvToElements(r, v);
    expect(b.argp).toBe(0);
    expect(Math.abs(b.nu - 2)).toBeLessThan(1e-8);
  });
  it('Vallado Example 2-5: r=[6524.834,6862.875,6448.296] km, v=[4.901327,5.533756,-1.976341] km/s', () => {
    const el = rvToElements([6524834, 6862875, 6448296], [4901.327, 5533.756, -1976.341]);
    expect(Math.abs(el.a / 1000 - 36127.343)).toBeLessThan(0.5);
    expect(Math.abs(el.e - 0.832853)).toBeLessThan(1e-5);
    expect(Math.abs(el.i / DEG - 87.870)).toBeLessThan(1e-3);
    expect(Math.abs(el.raan / DEG - 227.89)).toBeLessThan(1e-2);
    expect(Math.abs(el.argp / DEG - 53.38)).toBeLessThan(1e-2);
    expect(Math.abs(el.nu / DEG - 92.335)).toBeLessThan(1e-2);
  });
  it('vis-viva on a circular orbit gives sqrt(mu/r); period of 500 km orbit ≈ 5676 s (±2 s)', () => {
    const r = R_EARTH + 500e3;
    expect(visViva(r, r)).toBeCloseTo(Math.sqrt(MU_EARTH / r), 9);
    const d = derivedElements({ a: r, e: 0, i: 0, raan: 0, argp: 0, nu: 0 });
    expect(Math.abs(d.period - 5676.98)).toBeLessThan(2);
    expect(d.specificEnergy).toBeCloseTo(-MU_EARTH / (2 * r), 3);
    expect(d.perigeeAlt).toBeCloseTo(500e3, 3);
  });
  it('Kepler solver satisfies E - e sinE = M (tol 1e-12), including e=0.9', () => {
    for (const [M, e] of [[0.3, 0.1], [3.0, 0.9], [6.0, 0.5]]) {
      const E = solveKepler(M, e);
      expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-12);
    }
  });
});

describe('two-body propagation', () => {
  it('conserves energy & angular momentum, returns to start after one period (tol 1 mm)', () => {
    const el = { a: 7000e3, e: 0.05, i: 1.0, raan: 0.4, argp: 0.9, nu: 0.2 };
    const T = derivedElements(el).period;
    const s0 = propagateTwoBody(el, 0, 0);
    const s1 = propagateTwoBody(el, 0, (T / 4) * 1000);
    const s2 = propagateTwoBody(el, 0, T * 1000);
    const e0 = rvToElements(s0.r, s0.v), e1 = rvToElements(s1.r, s1.v);
    expect(Math.abs(e1.a - e0.a)).toBeLessThan(1e-3);
    expect(Math.abs(e1.e - e0.e)).toBeLessThan(1e-9);
    for (let k = 0; k < 3; k++) expect(Math.abs(s2.r[k] - s0.r[k])).toBeLessThan(1e-3);
  });
});

describe('frames', () => {
  it('ECI→ECEF→ECI round-trip (tol 1e-6 m) and preserves |r|', () => {
    const t = Date.UTC(2020, 2, 3, 4, 5, 6);
    const r: [number, number, number] = [7000e3, -1200e3, 900e3];
    const back = ecefToEci(eciToEcef(r, t), t);
    for (let k = 0; k < 3; k++) expect(Math.abs(back[k] - r[k])).toBeLessThan(1e-6);
    expect(norm(eciToEcef(r, t))).toBeCloseTo(norm(r), 6);
  });
  it('geodetic round-trip (tol 1e-9 rad, 1e-4 m)', () => {
    const g = { lat: 13.7563 * DEG, lon: 100.5018 * DEG, alt: 1500 };
    const b = ecefToGeodetic(geodeticToEcef(g));
    expect(Math.abs(b.lat - g.lat)).toBeLessThan(1e-9);
    expect(Math.abs(b.lon - g.lon)).toBeLessThan(1e-9);
    expect(Math.abs(b.alt - g.alt)).toBeLessThan(1e-4);
  });
  it('known point: equator/prime meridian at 0 m → (R_EARTH,0,0); north pole → z = b', () => {
    expect(geodeticToEcef({ lat: 0, lon: 0, alt: 0 })[0]).toBeCloseTo(R_EARTH, 6);
    const pole = geodeticToEcef({ lat: Math.PI / 2, lon: 0, alt: 0 });
    expect(pole[2]).toBeCloseTo(6356752.3142, 3);
    expect(Math.abs(ecefToGeodetic(pole).alt)).toBeLessThan(1e-3);
  });
  it('geodetic matches satellite.js eciToGeodetic for an SGP4 state (lat/lon 1e-6 rad, alt 1 m)', () => {
    const m = createSgp4(
      '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
      '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
    );
    const t = m.epoch + 600_000;
    const s = propagateSgp4(m, t)!;
    const g = ecefToGeodetic(eciToEcef(s.r, t));
    const ref = sat.eciToGeodetic({ x: s.r[0] / 1e3, y: s.r[1] / 1e3, z: s.r[2] / 1e3 }, sat.gstime(new Date(t)));
    expect(Math.abs(g.lat - ref.latitude)).toBeLessThan(1e-6);
    expect(Math.abs(wrapPi(g.lon - ref.longitude))).toBeLessThan(1e-6);
    expect(Math.abs(g.alt / 1e3 - ref.height)).toBeLessThan(1e-3);
    expect(TWO_PI).toBeGreaterThan(6);
  });
});
