import { describe, expect, it } from 'vitest';
import { DEG, R_EARTH } from './constants';
import { AU, sunPositionEci } from './sun';
import { sunlightFraction } from './eclipse';
import { attitudeAt, attitudeFromBoresight, quatRotate, rayEllipsoid, sensorFootprint, slerp, targetQuat } from './attitude';
import { derivedElements, elementsToRv } from './elements';
import { norm, dot } from './vec';
import type { Vec3 } from '@/types';

describe('Sun position (low precision, ~0.01°)', () => {
  it('June solstice 2024-06-20 20:51 UTC: declination 23.44° ±0.05°', () => {
    const s = sunPositionEci(Date.UTC(2024, 5, 20, 20, 51));
    expect(Math.abs(Math.asin(s[2] / norm(s)) / DEG - 23.44)).toBeLessThan(0.05);
  });
  it('March equinox 2024-03-20 03:06 UTC: declination ≈ 0 (±0.05°), RA ≈ 0', () => {
    const s = sunPositionEci(Date.UTC(2024, 2, 20, 3, 6));
    expect(Math.abs(Math.asin(s[2] / norm(s)) / DEG)).toBeLessThan(0.05);
    expect(Math.abs(Math.atan2(s[1], s[0]) / DEG)).toBeLessThan(0.1);
  });
  it('perihelion 2024-01-03 ≈ 0.9833 AU; aphelion 2024-07-05 ≈ 1.0167 AU (±0.0006)', () => {
    expect(Math.abs(norm(sunPositionEci(Date.UTC(2024, 0, 3))) / AU - 0.9833)).toBeLessThan(0.0006);
    expect(Math.abs(norm(sunPositionEci(Date.UTC(2024, 6, 5))) / AU - 1.0167)).toBeLessThan(0.0006);
  });
});

describe('eclipse (conical shadow)', () => {
  const sun: Vec3 = [AU, 0, 0];
  it('sub-solar LEO: full sunlight; anti-solar LEO: umbra; GEO anti-solar at equinox: umbra', () => {
    expect(sunlightFraction([R_EARTH + 500e3, 0, 0], sun)).toBe(1);
    expect(sunlightFraction([-(R_EARTH + 500e3), 0, 0], sun)).toBe(0);
    expect(sunlightFraction([-42164e3, 0, 0], sun)).toBe(0);
  });
  it('terminator crossing passes through penumbra with monotonic fraction in (0,1)', () => {
    const r = R_EARTH + 500e3;
    let prev = 1, sawPartial = false;
    for (let th = 60; th <= 130; th += 0.05) {
      const f = sunlightFraction([r * Math.cos(th * DEG) * -1 * -1, r * Math.sin(th * DEG), 0] as Vec3, sun); // angle from sun direction
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      if (f > 0 && f < 1) sawPartial = true;
      prev = f;
    }
    expect(sawPartial).toBe(true);
    expect(prev).toBe(0);
  });
  it('eclipse arc of a 500 km equatorial orbit at β=0 ≈ 2·asin(R/r)=136.0° of the orbit (±1°)', () => {
    const r = R_EARTH + 500e3; let inShadow = 0; const N = 36000;
    for (let k = 0; k < N; k++) {
      const u = (k / N) * 2 * Math.PI;
      if (sunlightFraction([r * Math.cos(u), r * Math.sin(u), 0], sun) < 1) inShadow++;
    }
    const arc = (inShadow / N) * 360;
    expect(Math.abs(arc - 2 * Math.asin(R_EARTH / r) / DEG)).toBeLessThan(1);
  });
});

describe('attitude & sensor', () => {
  it('nadir attitude: body +Z maps to −r̂, +X to the velocity side, right-handed', () => {
    const { r, v } = elementsToRv({ a: R_EARTH + 500e3, e: 0, i: 0.9, raan: 0.3, argp: 0, nu: 1 });
    const q = targetQuat({ mode: 'nadir' }, { r, v, sunEci: [AU, 0, 0], utcMs: 0 });
    const z = quatRotate(q, [0, 0, 1]), x = quatRotate(q, [1, 0, 0]);
    expect(dot(z, r) / norm(r)).toBeCloseTo(-1, 9);
    expect(dot(x, v) / norm(v)).toBeGreaterThan(0.999);
    expect(norm(quatRotate(q, [0, 1, 0]))).toBeCloseTo(1, 12);
  });
  it('slerp endpoints and 50 % rotation angle; slew to sun completes after slewSec', () => {
    const a = attitudeFromBoresight([0, 0, 1], [1, 0, 0]), b = attitudeFromBoresight([1, 0, 0], [0, 0, 1]);
    expect(slerp(a, b, 0)).toEqual(a);
    const ctx = { r: [7e6, 0, 0] as Vec3, v: [0, 7.5e3, 0] as Vec3, sunEci: [0, 0, AU] as Vec3, utcMs: 0 }; // Sun 90° from nadir (−x)
    const q = attitudeAt([{ id: 's', start: 0, mode: 'sun', slewSec: 100 }], 100_000, () => ctx)!;
    expect(dot(quatRotate(q, [0, 0, 1]), [0, 0, 1])).toBeCloseTo(1, 9);
    const mid = attitudeAt([{ id: 's', start: 0, mode: 'sun', slewSec: 100 }], 50_000, () => ctx)!;
    const zm = quatRotate(mid, [0, 0, 1]);
    expect(dot(zm, [0, 0, 1])).toBeCloseTo(Math.SQRT1_2, 6); // halfway through a 90° slew = 45°
  });
  it('nadir sensor footprint: edge ground range matches spherical geometry (η=10°, h=500 km → λ = asin((R+h)/R·sinη) − η), tol 0.2 %', () => {
    const pos: Vec3 = [R_EARTH + 500e3, 0, 0];
    const eta = 10 * DEG;
    const ring = sensorFootprint(pos, [-1, 0, 0], eta, 72);
    expect(ring.every((p) => p)).toBe(true);
    const lam = Math.asin(((R_EARTH + 500e3) / R_EARTH) * Math.sin(eta)) - eta;
    // the in-equatorial-plane edge point (|y| max, z≈0)
    const eq = ring.filter((p): p is Vec3 => !!p).reduce((best, p) => (Math.abs(p[2]) < Math.abs(best[2]) && p[1] > 0 ? p : best));
    const ang = Math.atan2(eq[1], eq[0]);
    expect(Math.abs(ang / lam - 1)).toBeLessThan(0.002);
  });
  it('rayEllipsoid misses when the ray points away; hits sub-satellite point for nadir', () => {
    expect(rayEllipsoid([8e6, 0, 0], [1, 0, 0])).toBeNull();
    const p = rayEllipsoid([8e6, 0, 0], [-1, 0, 0])!;
    expect(p[0]).toBeCloseTo(R_EARTH, 3);
    expect(derivedElements({ a: 7e6, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }).period).toBeGreaterThan(0);
  });
});
