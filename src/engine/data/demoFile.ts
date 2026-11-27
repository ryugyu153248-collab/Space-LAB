import type { Satellite } from '@/types';
import { DEMO_T0, bangkokStation, buildCollisionDemoSatellites } from './demoScenario';
import { buildDemoSatellites } from './demo';
import { newEvent } from '../events/EventManager';
import { screenConjunctions } from '../analysis/conjunction';
import { minimumAvoidanceDv } from '../analysis/avoidance';
import type { ScenarioFile } from './scenario';
import { SCHEMA_VERSION } from './scenario';
import { DEG } from '../orbital/constants';

export const DEFAULT_LAYERS: Record<string, boolean> = {
  satellites: true, labels: true, orbits: true, groundTracks: true, nadirLine: true, atmosphere: true, lighting: true,
  stations: true, visibilityCones: true, commLinks: true, debris: true, saa: false, coverage: true, eventEffects: true,
  bodyAxes: true, footprints: true, conjunction: true,
};
export const DEFAULT_SETTINGS = { stormLevel: 0, covPrimary: 100, covSecondary: 100, hbr: 10, useCovariance: false };

export function emptyScenario(name: string, sats: Satellite[], start: number, days = 1): ScenarioFile {
  return {
    schemaVersion: SCHEMA_VERSION, id: `scn-${Math.random().toString(36).slice(2, 10)}`, name, savedAt: new Date().toISOString(),
    clock: { start, end: start + days * 86_400_000, time: start, rate: 1 }, satellites: sats, stations: [bangkokStation()], events: [],
    camera: { mode: 'earth', views: [] }, layers: { ...DEFAULT_LAYERS }, settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * LEO COLLISION AVOIDANCE DEMONSTRATION. Initial states come from designConjunction(); the avoidance Δv below is the result of a
 * real search (minimumAvoidanceDv: bisection on the numerically propagated post-burn miss distance, target ≥ 10 km), not typed in.
 * The burn event is created DISABLED so the "before" situation is shown first; enable it to see the "after".
 */
export function buildCollisionDemo(): ScenarioFile {
  const sats = buildCollisionDemoSatellites();
  const f = emptyScenario('LEO Collision Avoidance Demonstration', sats, DEMO_T0, 1);
  const [a, b] = sats;
  const conj = screenConjunctions(a, [b], DEMO_T0, DEMO_T0 + 6 * 3600_000, { screenDistance: 50_000 }).sort((x, y) => x.tca - y.tca)[0];
  if (conj) {
    const lead = 5677; // ≈ one orbital period before TCA
    const best = minimumAvoidanceDv(a, b, conj.tca, lead, 'prograde', 10_000);
    const ev = newEvent('burn', conj.tca - lead * 1000, [a.id], 'ev-avoid');
    ev.name = 'Collision Avoidance Maneuver';
    ev.params = { kind: 'impulsive', direction: 'prograde', dv: best ? Math.ceil(best.dv * 100) / 100 : 1, isp: 220 };
    ev.enabled = false;
    f.events.push(ev);
  }
  f.settings = { ...DEFAULT_SETTINGS, covPrimary: 100, covSecondary: 100, hbr: 10, useCovariance: false };
  return f;
}

export function buildIssSample(): ScenarioFile {
  const { sats, startTime } = buildDemoSatellites();
  const f = emptyScenario('ISS historic TLE sample (2008)', sats, startTime, 3);
  f.stations = [{ ...bangkokStation() }];
  void DEG;
  return f;
}
