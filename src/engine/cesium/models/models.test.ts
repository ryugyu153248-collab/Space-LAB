import { describe, expect, it } from 'vitest';
import { MODEL_KINDS, SUBSYSTEMS, buildModelGlb, hasSubsystemView, modelKindFor } from './templates';
import { buildCollisionDemoSatellites } from '../../data/demoScenario';
import { parseTleText, satelliteFromTle } from '../../data/tle';
import { DEMO_TLE_TEXT } from '../../data/demo';

describe('procedural spacecraft models', () => {
  it.each(MODEL_KINDS)('%s builds a valid GLB (header, JSON+BIN chunks, accessor counts, finite vertices)', (k) => {
    const buf = buildModelGlb(k);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);            // "glTF"
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(buf.byteLength);
    const jlen = dv.getUint32(12, true);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a);            // JSON
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jlen)));
    const binOff = 20 + jlen;
    expect(dv.getUint32(binOff + 4, true)).toBe(0x004e4942);    // BIN
    expect(json.meshes[0].primitives.length).toBeGreaterThan(1);
    expect(json.buffers[0].byteLength).toBe(dv.getUint32(binOff, true));
    for (const a of json.accessors.filter((x: { type: string }) => x.type === 'VEC3')) expect(a.count).toBeGreaterThan(0);
    const floats = new Float32Array(buf.slice(binOff + 8, binOff + 8 + json.accessors[0].count * 12));
    expect(floats.every(Number.isFinite)).toBe(true);
  });
  it('NAPA-2 has a subsystem view: translucent shell + 6 colour-coded internals, valid GLB', () => {
    expect(hasSubsystemView('napa2')).toBe(true); expect(hasSubsystemView('generic')).toBe(false);
    const buf = buildModelGlb('napa2', 'subsystems'), dv = new DataView(buf);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true))));
    expect(json.materials.length).toBeGreaterThanOrEqual(SUBSYSTEMS.length + 1);
    expect(json.materials.some((m: { alphaMode: string }) => m.alphaMode === 'BLEND')).toBe(true);
    expect(modelKindFor({ ...buildCollisionDemoSatellites()[0], name: 'NAPA-2' })).toBe('napa2');
  });
  it('maps real vehicles to their template by NORAD id / name; unknown LEO → generic', () => {
    const iss = satelliteFromTle(parseTleText(DEMO_TLE_TEXT).tles[0], 'REAL_TLE', 't');
    expect(modelKindFor(iss)).toBe('iss');
    expect(modelKindFor({ ...iss, name: 'HST', noradId: '20580' })).toBe('hubble');
    expect(modelKindFor({ ...iss, name: 'STARLINK-1234', noradId: '99999' })).toBe('starlink');
    expect(modelKindFor({ ...iss, name: 'NAVSTAR 81 (USA 319)', noradId: '99998' })).toBe('gps');
    expect(modelKindFor(buildCollisionDemoSatellites()[0])).toBe('generic');
  });
});
