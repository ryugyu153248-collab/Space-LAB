import type { Satellite } from '@/types';
import { DEG, R_EARTH } from '../orbital/constants';
import { nextColor, parseTleText, satelliteFromTle } from './tle';

/**
 * Historic reference TLEs (real element set, NOT current). Epoch 2008 → valid only near the epoch,
 * so the demo scenario starts at the ISS epoch and the UI labels them "historic".
 */
export const DEMO_TLE_TEXT = `ISS (ZARYA)
1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`;

export function buildDemoSatellites(): { sats: Satellite[]; startTime: number } {
  const { tles } = parseTleText(DEMO_TLE_TEXT);
  const sats = tles.map((t) =>
    satelliteFromTle(t, 'REAL_TLE', 'Historic reference TLE (not current) – bundled sample'),
  );
  const iss = tles[0];
  const sim: Satellite = {
    id: 'sim-leo-500',
    name: 'SIM-LEO-500 (two-body)',
    source: {
      kind: 'elements',
      epoch: iss.epoch,
      elements: { a: R_EARTH + 500e3, e: 0, i: 97.4 * DEG, raan: 40 * DEG, argp: 0, nu: 0 },
    },
    origin: 'SIMULATED',
    provenance: 'Simulated – analytic two-body, circular 500 km, i=97.4°',
    epoch: iss.epoch,
    color: nextColor(),
  };
  return { sats: [...sats, sim], startTime: iss.epoch };
}
