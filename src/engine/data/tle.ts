import { z } from 'zod';
import type { Satellite } from '@/types';
import { tleEpochToMs } from '../orbital/time';

/** Modulo-10 checksum used by TLE lines: digits count as their value, '-' counts as 1, others 0. */
export function tleChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i];
    if (c >= '0' && c <= '9') sum += Number(c);
    else if (c === '-') sum += 1;
  }
  return sum % 10;
}

const LineSchema = (n: 1 | 2) =>
  z
    .string()
    .length(69, `Line ${n} must be exactly 69 characters`)
    .refine((l) => l[0] === String(n), `Line ${n} must start with "${n}"`)
    .refine((l) => tleChecksum(l) === Number(l[68]), `Line ${n} checksum mismatch`);

export const TleSchema = z
  .object({ name: z.string().min(1), line1: LineSchema(1), line2: LineSchema(2) })
  .refine((t) => t.line1.slice(2, 7) === t.line2.slice(2, 7), 'Catalog numbers of line 1 and 2 differ');

export interface ParsedTle {
  name: string;
  line1: string;
  line2: string;
  noradId: string;
  epoch: number;
}

export interface TleParseResult {
  tles: ParsedTle[];
  errors: string[];
}

/**
 * Parse 2-line or 3-line (with name) TLE text. Blank lines and `#` comments ignored.
 * Every set is validated (length, line numbers, checksum, matching catalog numbers).
 */
export function parseTleText(text: string): TleParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  const tles: ParsedTle[] = [];
  const errors: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let name: string;
    let l1: string, l2: string;
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      l1 = lines[i]; l2 = lines[i + 1];
      name = `SAT ${l1.slice(2, 7).trim()}`;
      i += 2;
    } else if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      name = lines[i].replace(/^0 /, '').trim();
      l1 = lines[i + 1]; l2 = lines[i + 2];
      i += 3;
    } else {
      errors.push(`Unrecognised line near "${lines[i].slice(0, 30)}"`);
      i += 1;
      continue;
    }
    const r = TleSchema.safeParse({ name, line1: l1, line2: l2 });
    if (!r.success) {
      errors.push(`${name}: ${r.error.issues.map((x) => x.message).join('; ')}`);
      continue;
    }
    const yy = Number(l1.slice(18, 20));
    const day = Number(l1.slice(20, 32));
    tles.push({ name, line1: l1, line2: l2, noradId: l1.slice(2, 7).trim(), epoch: tleEpochToMs(yy, day) });
  }
  if (tles.length === 0 && errors.length === 0) errors.push('No TLE data found');
  return { tles, errors };
}

export type Staleness = 'fresh' | 'aging' | 'stale';

/**
 * TLE age classification relative to a UTC time (SGP4 error grows ~1–3 km/day):
 *  fresh ≤ 3 d, aging ≤ 14 d, stale > 14 d (also applies for times *before* the epoch).
 */
export function tleStaleness(epoch: number, atMs: number): { days: number; level: Staleness } {
  const days = (atMs - epoch) / 86_400_000;
  const a = Math.abs(days);
  return { days, level: a <= 3 ? 'fresh' : a <= 14 ? 'aging' : 'stale' };
}

const PALETTE = ['#38bdf8', '#f97316', '#a3e635', '#e879f9', '#facc15', '#2dd4bf', '#f87171', '#818cf8'];
let colorIdx = 0;
export const nextColor = (): string => PALETTE[colorIdx++ % PALETTE.length];

export function satelliteFromTle(t: ParsedTle, origin: Satellite['origin'], provenance: string): Satellite {
  return {
    id: `sat-${t.noradId}-${Math.random().toString(36).slice(2, 7)}`,
    name: t.name,
    noradId: t.noradId,
    source: { kind: 'tle', name: t.name, line1: t.line1, line2: t.line2 },
    origin,
    provenance,
    epoch: t.epoch,
    color: nextColor(),
  };
}
