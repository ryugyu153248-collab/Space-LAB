import { z } from 'zod';
import type { GroundStation, Satellite } from '@/types';
import type { SimEvent } from '../events/EventTypes';

export const SCHEMA_VERSION = 1;

export interface CameraView { name: string; position: [number, number, number]; direction: [number, number, number]; up: [number, number, number] }

export interface ScenarioFile {
  schemaVersion: number;
  id: string;
  name: string;
  savedAt: string;
  clock: { start: number; end: number; time: number; rate: number };
  /** satellites as authored (maneuvers/attitude/debris are DERIVED from `events`, not stored) */
  satellites: Satellite[];
  stations: GroundStation[];
  events: SimEvent[];
  camera: { mode: string; views: CameraView[] };
  layers: Record<string, boolean>;
  settings: { stormLevel: number; covPrimary: number; covSecondary: number; hbr: number; useCovariance: boolean };
}

const Num = z.number().finite();
const Vec = z.tuple([Num, Num, Num]);
const SatSchema = z.object({
  id: z.string().min(1), name: z.string(), origin: z.enum(['REAL_TLE', 'USER_TLE', 'SIMULATED']), provenance: z.string(), epoch: Num, color: z.string(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tle'), name: z.string(), line1: z.string().length(69), line2: z.string().length(69) }),
    z.object({ kind: z.literal('elements'), epoch: Num, elements: z.object({ a: Num, e: Num, i: Num, raan: Num, argp: Num, nu: Num }) }),
    z.object({ kind: z.literal('state'), epoch: Num, r: Vec, v: Vec }),
  ]),
}).passthrough();
const StationSchema = z.object({ id: z.string(), name: z.string(), lat: Num, lon: Num, alt: Num, minElevation: Num, color: z.string() });
const EventSchema = z.object({
  id: z.string(), name: z.string(), type: z.string(), start: Num, objects: z.array(z.string()), params: z.record(z.string(), z.any()), enabled: z.boolean(),
  priority: Num, dependsOn: z.array(z.string()), visual: z.object({ kind: z.string() }).passthrough(), handlerId: z.string(),
}).passthrough();

export const ScenarioSchema = z.object({
  schemaVersion: z.number().int().min(0),
  id: z.string(), name: z.string().min(1), savedAt: z.string(),
  clock: z.object({ start: Num, end: Num, time: Num, rate: Num }),
  satellites: z.array(SatSchema), stations: z.array(StationSchema), events: z.array(EventSchema),
  camera: z.object({ mode: z.string(), views: z.array(z.any()) }),
  layers: z.record(z.string(), z.boolean()),
  settings: z.object({ stormLevel: Num, covPrimary: Num, covSecondary: Num, hbr: Num, useCovariance: z.boolean() }),
});

/**
 * Migrations run in order from the file's version up to SCHEMA_VERSION. Add `case n:` steps when the format changes.
 * Version 0 = pre-release exports without `settings`/`camera` (kept as an example of a forward-compat shim).
 */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Scenario file is not a JSON object');
  const o = { ...(raw as Record<string, unknown>) };
  let v = typeof o.schemaVersion === 'number' ? o.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new Error(`Scenario schema v${v} is newer than this app (v${SCHEMA_VERSION}). Update ORBITAL LAB.`);
  while (v < SCHEMA_VERSION) {
    switch (v) {
      case 0:
        o.settings ??= { stormLevel: 0, covPrimary: 100, covSecondary: 100, hbr: 10, useCovariance: false };
        o.camera ??= { mode: 'earth', views: [] };
        o.layers ??= {};
        o.events ??= [];
        o.stations ??= [];
        break;
    }
    v++;
  }
  o.schemaVersion = SCHEMA_VERSION;
  return o;
}

export function parseScenario(text: string): ScenarioFile {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('File is not valid JSON'); }
  const r = ScenarioSchema.safeParse(migrate(json));
  if (!r.success) throw new Error('Invalid scenario: ' + r.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data as unknown as ScenarioFile;
}

export const serializeScenario = (s: ScenarioFile): string => JSON.stringify(s, null, 2);
