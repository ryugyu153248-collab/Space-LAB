import { describe, expect, it } from 'vitest';
import * as sat from 'satellite.js';
import type { GroundStation, Satellite } from '@/types';
import { DEG } from '../orbital/constants';
import { eciToEcef, geodeticToEcef } from '../orbital/frames';
import { lookAngles, visibilityCentralAngle } from '../orbital/lookangles';
import { propagateSatellite } from '../orbital/propagate';
import { parseTleText, satelliteFromTle } from '../data/tle';
import { DEMO_TLE_TEXT } from '../data/demo';
import { computeAccess, nextContact } from './access';

const stn: GroundStation = {
  id: 'bkk', name: 'Bangkok', lat: 13.7563 * DEG, lon: 100.5018 * DEG, alt: 0, minElevation: 10 * DEG, color: '#fff',
};
const iss: Satellite = satelliteFromTle(parseTleText(DEMO_TLE_TEXT).tles[0], 'REAL_TLE', 'test');

describe('look angles', () => {
  it('object directly overhead: el = 90°, range = height', () => {
    const up = geodeticToEcef({ lat: stn.lat, lon: stn.lon, alt: 500e3 });
    const la = lookAngles(stn, up);
    expect(la.el / DEG).toBeCloseTo(90, 6);
    expect(la.range).toBeCloseTo(500e3, 3);
  });
  it('object due north on the horizon plane has az≈0; due east az≈90°', () => {
    const eq = { lat: 0, lon: 0, alt: 0 };
    const north = lookAngles(eq, geodeticToEcef({ lat: 0.05, lon: 0, alt: 0 }));
    const east = lookAngles(eq, geodeticToEcef({ lat: 0, lon: 0.05, alt: 0 }));
    expect(north.az / DEG).toBeCloseTo(0, 6) ;
    expect(east.az / DEG).toBeCloseTo(90, 6);
    expect(north.el).toBeLessThan(0); // below the local horizon (Earth curvature)
  });
  it('matches satellite.js ecfToLookAngles for an SGP4 state (az/el 1e-3°, range 1 m)', () => {
    const t = iss.epoch + 40 * 60_000;
    const s = propagateSatellite(iss, t)!;
    const e = eciToEcef(s.r, t);
    const mine = lookAngles(stn, e);
    const ref = sat.ecfToLookAngles(
      { latitude: stn.lat, longitude: stn.lon, height: 0 },
      { x: e[0] / 1e3, y: e[1] / 1e3, z: e[2] / 1e3 },
    );
    expect(Math.abs(mine.az - ref.azimuth)).toBeLessThan(1e-3 * DEG);
    expect(Math.abs(mine.el - ref.elevation)).toBeLessThan(1e-3 * DEG);
    expect(Math.abs(mine.range / 1e3 - ref.rangeSat)).toBeLessThan(1e-3);
  });
  it('visibility angle: sat at 500 km, mask 0° → ground radius = R·acos(R/(R+h)) ≈ 2 447 km (±1 km)', () => {
    const lam = visibilityCentralAngle(6378137, 6378137 + 500e3, 0);
    expect(Math.abs((6378137 * lam) / 1e3 - 2446.95)).toBeLessThan(1);
  });
});

describe('access (AOS/LOS)', () => {
  const t0 = iss.epoch, t1 = iss.epoch + 2 * 86_400_000;
  const res = computeAccess(iss, stn, t0, t1);
  it('finds passes, ordered and non-overlapping, with consistent fields', () => {
    expect(res.passes.length).toBeGreaterThan(3);
    for (let i = 0; i < res.passes.length; i++) {
      const p = res.passes[i];
      expect(p.los).toBeGreaterThan(p.aos);
      expect(p.duration).toBeCloseTo((p.los - p.aos) / 1000, 6);
      expect(p.maxEl).toBeGreaterThanOrEqual(stn.minElevation - 1e-6);
      expect(p.maxElTime).toBeGreaterThanOrEqual(p.aos);
      expect(p.maxElTime).toBeLessThanOrEqual(p.los);
      if (i) expect(p.aos).toBeGreaterThan(res.passes[i - 1].los);
      expect(p.duration).toBeLessThan(20 * 60); // LEO pass < 20 min
    }
  });
  it('elevation equals the mask at AOS/LOS (tol 0.01°) and is above it in between', () => {
    for (const p of res.passes.filter((x) => !x.clippedStart && !x.clippedEnd)) {
      for (const t of [p.aos, p.los]) {
        const el = lookAngles(stn, eciToEcef(propagateSatellite(iss, t)!.r, t)).el;
        expect(Math.abs(el - stn.minElevation) / DEG).toBeLessThan(0.01);
      }
      const mid = (p.aos + p.los) / 2;
      expect(lookAngles(stn, eciToEcef(propagateSatellite(iss, mid)!.r, mid)).el).toBeGreaterThan(stn.minElevation);
    }
  });
  it('agrees with brute-force 1 s scan: same pass count, durations within 3 s', () => {
    const brute: { a: number; l: number }[] = [];
    let inPass = false, a = 0;
    for (let t = t0; t <= t1; t += 1000) {
      const el = lookAngles(stn, eciToEcef(propagateSatellite(iss, t)!.r, t)).el;
      if (el >= stn.minElevation && !inPass) { inPass = true; a = t; }
      if (el < stn.minElevation && inPass) { inPass = false; brute.push({ a, l: t }); }
    }
    const full = res.passes.filter((p) => !p.clippedEnd);
    expect(full.length).toBe(brute.length);
    full.forEach((p, i) => {
      expect(Math.abs(p.aos - brute[i].a)).toBeLessThan(3000);
      expect(Math.abs(p.los - brute[i].l)).toBeLessThan(3000);
    });
  });
  it('a higher elevation mask never lengthens or adds passes', () => {
    const hi = computeAccess(iss, { ...stn, minElevation: 30 * DEG }, t0, t1);
    expect(hi.passes.length).toBeLessThanOrEqual(res.passes.length);
    expect(Math.max(0, ...hi.passes.map((p) => p.duration))).toBeLessThanOrEqual(Math.max(...res.passes.map((p) => p.duration)) + 1);
  });
  it('nextContact returns the first pass whose LOS is after t', () => {
    const p = res.passes[1];
    expect(nextContact(res, p.aos - 1000)).toBe(p);
    expect(nextContact(res, p.aos + 1000)).toBe(p);
    expect(nextContact(res, res.windowEnd + 1)).toBeNull();
  });
});

describe('NAPA-2 demo scenario', () => {
  it('assumed SSO orbit gives several Bangkok passes per day with a 10° mask', async () => {
    const { buildNapa2Demo } = await import('../data/demoFile');
    const f = buildNapa2Demo();
    const r = computeAccess(f.satellites[0], f.stations[0], f.clock.start, f.clock.end);
    expect(r.passes.length).toBeGreaterThanOrEqual(2);
    expect(f.satellites[0].origin).toBe('SIMULATED');
  });
});
