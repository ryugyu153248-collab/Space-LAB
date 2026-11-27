import { describe, expect, it } from 'vitest';
import { DEMO_T0, buildCollisionDemoSatellites } from '../data/demoScenario';
import { deriveScenario, newEvent } from './EventManager';
import { propagateSatellite, propsOf } from '../orbital/propagate';
import { simulateTelemetry } from '../telemetry/model';
import { inSaa } from '../orbital/environment';
import { DEG } from '../orbital/constants';
import { norm } from '../orbital/vec';

const base = buildCollisionDemoSatellites();
const HORIZON = DEMO_T0 + 86_400_000;

describe('event engine', () => {
  it('burn event makes the satellite NUMERICAL after t_burn, base untouched; disabling the event restores the original orbit', () => {
    const e = newEvent('burn', DEMO_T0 + 3600_000, ['sat-a']);
    const on = deriveScenario(base, [e], HORIZON, DEMO_T0);
    const off = deriveScenario(base, [{ ...e, enabled: false }], HORIZON, DEMO_T0);
    const t = DEMO_T0 + 2 * 3600_000;
    expect(propagateSatellite(on.satellites.find((s) => s.id === 'sat-a')!, t)!.model).toBe('NUMERICAL');
    expect(propagateSatellite(off.satellites.find((s) => s.id === 'sat-a')!, t)!.model).toBe('TWOBODY');
    expect(base[0].maneuvers).toBeUndefined();
    expect(off.status[e.id].status).toBe('disabled');
  });
  it('deployment spawns an object whose state at deployment = parent state + Δv (and does not exist earlier)', () => {
    const e = newEvent('deployment', DEMO_T0 + 1800_000, ['sat-a']);
    e.params = { ...e.params, dv: 2, direction: 'prograde' };
    const d = deriveScenario(base, [e], HORIZON, DEMO_T0);
    const child = d.satellites.find((s) => s.id === `${e.id}-obj`)!;
    const parent = propagateSatellite(d.satellites.find((s) => s.id === 'sat-a')!, e.start)!;
    const c0 = propagateSatellite(child, e.start)!;
    expect(norm([c0.v[0] - parent.v[0], c0.v[1] - parent.v[1], c0.v[2] - parent.v[2]])).toBeCloseTo(2, 4);
    expect(propagateSatellite(child, e.start - 1000)).toBeNull();
  });
  it('collision: parents end at the event, debris conserve momentum (mean Δv = CM velocity), are reproducible, and count matches', () => {
    const e = newEvent('collision', DEMO_T0 + 3600_000, ['sat-a', 'sat-b']);
    e.params = { fragments: 40, spreadMps: 120, seed: 7 };
    const d1 = deriveScenario(base, [e], HORIZON, DEMO_T0), d2 = deriveScenario(base, [e], HORIZON, DEMO_T0);
    const deb = d1.satellites.filter((s) => s.kind === 'debris');
    expect(deb).toHaveLength(40);
    expect(propagateSatellite(d1.satellites.find((s) => s.id === 'sat-a')!, e.start + 1000)).toBeNull();
    const a = propagateSatellite(base[0], e.start)!, b = propagateSatellite(base[1], e.start)!;
    const mean = [0, 1, 2].map((i) => deb.reduce((s, x) => s + (x.source as { v: number[] }).v[i], 0) / deb.length);
    const cm = [0, 1, 2].map((i) => (propsOf(base[0]).massKg * a.v[i] + propsOf(base[1]).massKg * b.v[i]) / (propsOf(base[0]).massKg + propsOf(base[1]).massKg));
    for (let i = 0; i < 3; i++) expect(mean[i]).toBeCloseTo(cm[i], 6);
    expect(JSON.stringify(d1.satellites.map((s) => s.source))).toBe(JSON.stringify(d2.satellites.map((s) => s.source)));
  });
  it('dependency ordering: an event depending on a later/missing event fails with a message and is not applied', () => {
    const b1 = newEvent('burn', DEMO_T0 + 4000_000, ['sat-a'], 'b1');
    const b2 = newEvent('burn', DEMO_T0 + 1000_000, ['sat-a'], 'b2');
    b2.dependsOn = ['b1'];
    const d = deriveScenario(base, [b1, b2], HORIZON, DEMO_T0);
    expect(d.status.b2.status).toBe('failed');
    expect(d.status.b2.messages.join(' ')).toMatch(/starts after/);
    expect(d.satellites.find((s) => s.id === 'sat-a')!.maneuvers).toHaveLength(1);
  });
  it('re-entry: with drag and a deorbit burn from 200 km the object crosses 100 km within days and then disappears', () => {
    const low = base.map((s) => (s.id === 'sat-a' && s.source.kind === 'elements' ? { ...s, source: { ...s.source, elements: { ...s.source.elements, a: 6378137 + 200e3 } } } : s));
    const e = newEvent('reentry', DEMO_T0 + 600_000, ['sat-a']);
    e.params = { ...e.params, dv: 30, cd: 2.2, area: 4 };
    const d = deriveScenario(low, [e], DEMO_T0 + 10 * 86_400_000, DEMO_T0);
    expect(d.status[e.id].messages.join(' ')).toMatch(/re-entry interface/);
    expect(propagateSatellite(d.satellites.find((s) => s.id === 'sat-a')!, DEMO_T0 + 20 * 86_400_000)).toBeNull();
  });
});

describe('telemetry & environment (simulated)', () => {
  it('battery stays within [0,100]; shadow lowers it, sunlight charges; deterministic; SAA membership', () => {
    const a = simulateTelemetry(base[0], [], DEMO_T0, DEMO_T0 + 6 * 3600_000);
    const b = simulateTelemetry(base[0], [], DEMO_T0, DEMO_T0 + 6 * 3600_000);
    expect(a.samples.map((s) => s.batteryPct)).toEqual(b.samples.map((s) => s.batteryPct));
    for (const s of a.samples) { expect(s.batteryPct).toBeGreaterThanOrEqual(0); expect(s.batteryPct).toBeLessThanOrEqual(100); }
    const shade = a.samples.filter((s) => s.sunFraction === 0), sun = a.samples.filter((s) => s.sunFraction === 1);
    expect(shade.length).toBeGreaterThan(0);
    expect(sun[0].solarW).toBeGreaterThan(1000);
    expect(shade[0].solarW).toBe(0);
    expect(inSaa(-26 * DEG, -50 * DEG)).toBe(true);
    expect(inSaa(40 * DEG, 100 * DEG)).toBe(false);
  });
});
