import { describe, expect, it } from 'vitest';
import { DEMO_TLE_TEXT } from './demo';
import { parseTleText, tleChecksum, tleStaleness } from './tle';

describe('TLE parsing', () => {
  it('parses bundled demo TLEs (valid checksums, epochs)', () => {
    const r = parseTleText(DEMO_TLE_TEXT);
    expect(r.errors).toEqual([]);
    expect(r.tles).toHaveLength(1);
    expect(r.tles[0].noradId).toBe('25544');
    // 08264.51782528 → 2008 day 264.5178 → 2008-09-20 12:25:40 UTC
    expect(new Date(r.tles[0].epoch).toISOString().slice(0, 16)).toBe('2008-09-20T12:25');
  });
  it('accepts 2-line sets without name', () => {
    const lines = DEMO_TLE_TEXT.split('\n').slice(1, 3).join('\n');
    expect(parseTleText(lines).tles[0].name).toBe('SAT 25544');
    // multiple sets in one file
    expect(parseTleText(DEMO_TLE_TEXT + '\n' + DEMO_TLE_TEXT).tles).toHaveLength(2);
  });
  it('rejects bad checksum and bad length with readable errors', () => {
    const bad = DEMO_TLE_TEXT.replace('563537', '563538');
    const r = parseTleText(bad);
    expect(r.errors.join(' ')).toMatch(/checksum/);
    expect(parseTleText('1 123\n2 456').errors.length).toBeGreaterThan(0);
    expect(parseTleText('').errors).toEqual(['No TLE data found']);
  });
  it('checksum function', () => {
    const l = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927';
    expect(tleChecksum(l)).toBe(7);
  });
  it('staleness thresholds', () => {
    const d = 86_400_000;
    expect(tleStaleness(0, 2 * d).level).toBe('fresh');
    expect(tleStaleness(0, 10 * d).level).toBe('aging');
    expect(tleStaleness(0, 30 * d).level).toBe('stale');
  });
});
