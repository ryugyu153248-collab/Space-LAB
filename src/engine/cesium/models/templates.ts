import type { Satellite } from '@/types';
import { ModelBuilder, type Material } from './glb';
import { norm } from '../../orbital/vec';
import { propagateSatellite } from '../../orbital/propagate';

/**
 * Procedural spacecraft models (primitive geometry — no downloaded assets). Shapes follow the real vehicles' overall layout
 * and approximate proportions (metres) but are SIMPLIFIED illustrations, not CAD. Body frame: +Z nadir/sensor, +Y array axis, +X along-track.
 */
export type ModelKind = 'iss' | 'tiangong' | 'hubble' | 'starlink' | 'gps' | 'geocomsat' | 'weather' | 'cubesat' | 'generic';

export const MODEL_LABEL: Record<ModelKind, string> = {
  iss: 'ISS-like modular station', tiangong: 'Tiangong-like T-shape station', hubble: 'Hubble-like space telescope', starlink: 'Starlink-like flat-panel',
  gps: 'GNSS (GPS-like) satellite', geocomsat: 'GEO communications satellite', weather: 'Weather / Earth-observation satellite', cubesat: 'CubeSat', generic: 'Generic LEO satellite bus',
};

const M = {
  gold: { color: [0.83, 0.64, 0.2, 1], metallic: 0.9, roughness: 0.35 } as Material,
  silver: { color: [0.78, 0.8, 0.84, 1], metallic: 0.85, roughness: 0.3 } as Material,
  white: { color: [0.92, 0.93, 0.95, 1], metallic: 0.2, roughness: 0.55 } as Material,
  dark: { color: [0.12, 0.13, 0.15, 1], metallic: 0.5, roughness: 0.5 } as Material,
  cell: { color: [0.05, 0.1, 0.32, 1], metallic: 0.6, roughness: 0.25, emissive: [0.0, 0.01, 0.04] } as Material,
  cellGold: { color: [0.55, 0.4, 0.12, 1], metallic: 0.7, roughness: 0.3 } as Material,
  frame: { color: [0.7, 0.7, 0.72, 1], metallic: 0.8, roughness: 0.4 } as Material,
  radiator: { color: [0.96, 0.96, 0.98, 1], metallic: 0.1, roughness: 0.7 } as Material,
  red: { color: [0.8, 0.12, 0.1, 1], metallic: 0.3, roughness: 0.5 } as Material,
  lens: { color: [0.1, 0.4, 0.55, 1], metallic: 0.2, roughness: 0.1, emissive: [0.0, 0.05, 0.08] } as Material,
};

const generic = (b: ModelBuilder) => {
  b.box('gold', M.gold, [0, 0, 0], [2, 2, 3]);
  b.box('silver', M.silver, [0, 0, 1.6], [1.6, 1.6, 0.2]);
  b.cylinder('dark', M.dark, [0, 0, 2.2], 2, 0.9, 0.45, 0.5, 18);        // nadir sensor barrel
  b.cylinder('lens', M.lens, [0, 0, 2.7], 2, 0.05, 0.4);                  // lens
  b.wing(M.cell, M.frame, 0, 1.1, 1, 2, 2.2, 3.2);
  b.wing(M.cell, M.frame, 0, -1.1, -1, 2, 2.2, 3.2);
  b.dish('white', M.white, [-1.2, 0, 0.3], 0, -1, 0.7, 0.3);              // comm dish on the back
  b.cylinder('silver', M.silver, [-1.0, 0, 0.3], 0, 0.3, 0.06);
  b.cylinder('dark', M.dark, [-1.05, 0.7, -1.4], 0, 0.3, 0.12, 0.2);      // thrusters
  b.cylinder('dark', M.dark, [-1.05, -0.7, -1.4], 0, 0.3, 0.12, 0.2);
  b.box('dark', M.dark, [0.6, 0.5, -1.7], [0.3, 0.3, 0.3]);               // star tracker
};

const BUILD: Record<ModelKind, (b: ModelBuilder) => void> = {
  generic,
  cubesat: (b) => {
    b.box('gold', M.gold, [0, 0, 0], [1, 1, 3]);                          // 3U (shown larger than real 0.1×0.1×0.34 m)
    b.box('cell', M.cell, [0.52, 0, 0], [0.05, 0.9, 2.8]); b.box('cell', M.cell, [-0.52, 0, 0], [0.05, 0.9, 2.8]);
    b.wing(M.cell, M.frame, 0, 0.5, 1, 2, 0.9, 2.6, 0.04, 0); b.wing(M.cell, M.frame, 0, -0.5, -1, 2, 0.9, 2.6, 0.04, 0);
    b.cylinder('dark', M.dark, [0, 0, 1.6], 2, 0.2, 0.3);
  },
  weather: (b) => {
    generic(b);
    b.box('cell', M.cell, [0, 4.3, 0], [2.2, 6, 0.04]);                    // long single wing look
    b.cylinder('white', M.white, [0, -1.6, 1.0], 1, 1.2, 0.35);            // microwave sounder
  },
  starlink: (b) => {
    b.box('white', M.white, [0, 0, 0], [2.8, 1.6, 0.25]);                  // flat-panel bus
    b.box('dark', M.dark, [0, 0, 0.2], [2.4, 1.3, 0.12]);                  // phased-array antenna (nadir)
    b.wing(M.cell, M.frame, 0, 0.8, 1, 1, 2.8, 8.0, 0.05, -0.05);         // single large array
    b.cylinder('silver', M.silver, [0, -0.9, -0.3], 1, 0.25, 0.1);
  },
  gps: (b) => {
    b.box('gold', M.gold, [0, 0, 0], [2, 2, 3]);
    b.box('white', M.white, [0, 0, 1.7], [1.8, 1.8, 0.3]);                 // L-band array (nadir)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) b.cylinder('silver', M.silver, [-0.6 + i * 0.4, -0.6 + j * 0.4, 1.95], 2, 0.2, 0.08);
    b.wing(M.cell, M.frame, 0, 1.1, 1, 3, 1.8, 2.4); b.wing(M.cell, M.frame, 0, -1.1, -1, 3, 1.8, 2.4);
    b.dish('white', M.white, [-1.2, 0, 0.5], 0, -1, 0.5, 0.2);
  },
  geocomsat: (b) => {
    b.box('gold', M.gold, [0, 0, 0], [2.4, 2.4, 4]);
    b.dish('white', M.white, [1.2, 0, 0.8], 0, 1, 1.6, 0.7); b.dish('white', M.white, [-1.2, 0, -0.5], 0, -1, 1.3, 0.6);
    b.wing(M.cell, M.frame, 0, 1.3, 1, 4, 2.6, 4.4); b.wing(M.cell, M.frame, 0, -1.3, -1, 4, 2.6, 4.4);
    b.cylinder('dark', M.dark, [0, 0, -2.4], 2, 0.8, 0.5, 0.2);            // apogee motor nozzle (anti-nadir)
  },
  hubble: (b) => {
    b.cylinder('silver', M.silver, [0, 0, 0], 0, 13.2, 2.2, 2.2, 28);      // tube along X
    b.cylinder('dark', M.dark, [-6.9, 0, 0], 0, 1.2, 2.4, 2.4, 28);        // aft shroud
    b.cylinder('gold', M.gold, [4.2, 0, 0], 0, 5, 2.25, 2.25, 28);         // light shield band
    b.cylinder('dark', M.dark, [6.9, 0, 0], 0, 0.5, 2.2, 1.9, 28);         // aperture door
    b.wing(M.cell, M.frame, 0.5, 2.3, 1, 1, 2.6, 7.1, 0.05, 0.4); b.wing(M.cell, M.frame, 0.5, -2.3, -1, 1, 2.6, 7.1, 0.05, 0.4);
    b.dish('white', M.white, [-1.5, 0, 2.4], 0, 1, 0.6, 0.25);
    b.cylinder('silver', M.silver, [-1.5, 0, 2.2], 2, 0.5, 0.05);
  },
  iss: (b) => {
    b.box('frame', M.frame, [0, 0, 0], [1.2, 108, 1.2]);                    // integrated truss along Y (≈109 m)
    for (const s of [-1, 1]) for (const yy of [38, 50]) { // 4 solar-array wing pairs
      b.box('cell', M.cell, [-1.2, s * yy, 0], [12, 33, 0.08]); b.box('cell', M.cell, [1.2, s * yy, 0], [12, 33, 0.08]);
    }
    for (const s of [-1, 1]) b.box('radiator', M.radiator, [0, s * 16, -1.2], [3.2, 12, 0.1]);
    b.cylinder('white', M.white, [0, 0, 0], 0, 14, 2.2, 2.2, 20);          // US lab / node core along X
    b.cylinder('silver', M.silver, [-11, 0, 0], 0, 13, 2.1, 2.1, 20);      // Russian segment
    b.cylinder('gold', M.gold, [-17.5, 0, 0], 0, 1.4, 2.1, 1.6, 20);
    b.cylinder('white', M.white, [9, 0, 0], 0, 7, 2.1, 2.1, 20);           // Columbus / Kibo
    b.cylinder('white', M.white, [4, 4.5, 0], 1, 9, 2.0, 2.0, 20); b.cylinder('white', M.white, [4, -4.5, 0], 1, 9, 2.0, 2.0, 20);
    b.box('radiator', M.radiator, [0, 0, 2.4], [1.5, 1.5, 0.3]);
    b.cylinder('silver', M.silver, [2, 0, -3], 2, 8, 0.25);                  // Canadarm2-like boom
  },
  tiangong: (b) => {
    b.cylinder('white', M.white, [0, 0, 0], 0, 17.9, 2.1, 2.1, 20);        // Tianhe core along X
    b.cylinder('silver', M.silver, [-9.5, 0, 0], 0, 3.2, 2.1, 1.5, 20);
    for (const s of [-1, 1]) {                                              // Wentian / Mengtian T-arms
      b.cylinder('white', M.white, [6, s * 7, 0], 1, 14, 2.0, 2.0, 20);
      b.box('cell', M.cell, [6, s * 12, 0.5], [3.2, 26, 0.06]);
    }
    b.box('cell', M.cell, [0, 6, 2], [4.5, 20, 0.06]); b.box('cell', M.cell, [0, -6, 2], [4.5, 20, 0.06]);
    b.dish('white', M.white, [-2, 0, 2.4], 0, 1, 0.8, 0.3);
  },
};

/** Choose the closest real-vehicle template from NORAD id / name; otherwise from the orbit regime. */
export function modelKindFor(sat: Satellite): ModelKind {
  const n = `${sat.name} ${sat.noradId ?? ''}`.toUpperCase();
  const id = sat.noradId ?? '';
  if (id === '25544' || /\bISS\b|ZARYA/.test(n)) return 'iss';
  if (/TIANHE|CSS\b|TIANGONG|\b48274\b/.test(n)) return 'tiangong';
  if (id === '20580' || /HST|HUBBLE/.test(n)) return 'hubble';
  if (/STARLINK|ONEWEB/.test(n)) return 'starlink';
  if (/NAVSTAR|\bGPS\b|GALILEO|GLONASS|BEIDOU|BDS|QZS/.test(n)) return 'gps';
  if (/NOAA|METOP|GOES|HIMAWARI|METEOSAT|FENGYUN|\bFY-|LANDSAT|SENTINEL|TERRA|AQUA|SUOMI|JPSS|WORLDVIEW|THAICHOTE|THEOS/.test(n)) return 'weather';
  if (/CUBE|\bCUBESAT|\bLEMUR|\bDOVE|FLOCK|\bSAT-?\d?U\b/.test(n)) return 'cubesat';
  // fall back on the orbit regime at the satellite's epoch
  const st = propagateSatellite({ ...sat, maneuvers: [], endTime: undefined }, sat.epoch);
  if (st) {
    const r = norm(st.r) / 1000;
    if (r > 40000) return 'geocomsat';
    if (r > 24000) return 'gps';
  }
  return 'generic';
}

const cache = new Map<ModelKind, { url: string; radius: number }>();

/** Blob URL (cached) of the GLB for a kind plus its bounding radius in metres. */
export function modelUrl(kind: ModelKind): { url: string; radius: number } {
  const hit = cache.get(kind);
  if (hit) return hit;
  const b = new ModelBuilder();
  BUILD[kind](b);
  const glb = b.build();
  const out = { url: URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' })), radius: b.radius };
  cache.set(kind, out);
  return out;
}

export function buildModelGlb(kind: ModelKind): ArrayBuffer { const b = new ModelBuilder(); BUILD[kind](b); return b.build(); }
export const MODEL_KINDS = Object.keys(BUILD) as ModelKind[];
