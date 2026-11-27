import type { AttitudeMode, GroundStation, Satellite } from '@/types';
import { eciToEcef, ecefToGeodetic } from '../orbital/frames';
import { lookAngles } from '../orbital/lookangles';
import { massAt, propagateSatellite, propsOf } from '../orbital/propagate';
import { sunlightFraction } from '../orbital/eclipse';
import { sunPositionEci } from '../orbital/sun';
import { doseRate, inSaa } from '../orbital/environment';

/**
 * SIMULATED satellite telemetry — generated from the same propagated geometry as everything else, but the power/thermal/battery
 * models are simple engineering placeholders with stated assumptions (not flight data):
 *  - Solar power  P = S · A · η · f_sun   (S = 1361 W/m², sun-tracking arrays so cos(incidence)=1, f_sun = conical-shadow illumination)
 *  - Load         P_load = P_bus + P_comm·[in contact with any ground station]
 *  - Battery      E' = E + (P − P_load) Δt, clamped to [0, capacity]; SoC = E/capacity; voltage 24 + 8·SoC V (linear, 8S Li-ion-like)
 *  - Temperature  first-order lag (τ = 1500 s) toward 305 K in sunlight and 255 K in shadow
 *  - Fuel         propellant remaining from the numerical trajectory mass
 * Deterministic: fixed Δt integration from the window start.
 */
export interface TelemetrySample {
  t: number;
  sunFraction: number;
  solarW: number;
  loadW: number;
  batteryPct: number;
  batteryV: number;
  tempK: number;
  fuelKg: number;
  inContact: boolean;
  thrusting: boolean;
  attitude: AttitudeMode;
  inSaa: boolean;
  doseRate: number;
}

export interface TelemetryWarning { t: number; level: 'warning' | 'critical'; message: string }

export interface TelemetryResult { samples: TelemetrySample[]; warnings: TelemetryWarning[]; dose: number[] }

export function simulateTelemetry(
  sat: Satellite, stations: GroundStation[], t0: number, t1: number, stormLevel = 0, stepSec = 60,
): TelemetryResult {
  const p = propsOf(sat);
  const cap = p.batteryWh * 3600; // J
  let E = cap * 0.9, T = 290, dose = 0;
  const samples: TelemetrySample[] = [], doses: number[] = [], warnings: TelemetryWarning[] = [];
  const dry = Math.max(1, p.massKg - p.propellantKg);
  const segs = [...(sat.attitude ?? [])].sort((a, b) => a.start - b.start);
  let lastBat = '', lastTemp = '';
  for (let t = t0; t <= t1; t += stepSec * 1000) {
    const st = propagateSatellite(sat, t);
    if (!st) continue;
    const f = sunlightFraction(st.r, sunPositionEci(t));
    const ecef = eciToEcef(st.r, t);
    const geo = ecefToGeodetic(ecef);
    const contact = stations.some((g) => lookAngles(g, ecef).el >= g.minElevation);
    const solar = 1361 * p.panelArea * p.panelEfficiency * f;
    const load = p.busLoadW + (contact ? p.commLoadW : 0);
    E = Math.min(cap, Math.max(0, E + (solar - load) * stepSec));
    T += ((f > 0.5 ? 305 : 255) - T) * (1 - Math.exp(-stepSec / 1500));
    const saa = inSaa(geo.lat, geo.lon);
    const rate = doseRate(saa, stormLevel);
    dose += (rate * stepSec) / 3600;
    const thrusting = (sat.maneuvers ?? []).some((m) => m.kind === 'finite' && t >= m.start && t < m.start + (m.duration ?? 0) * 1000);
    let att: AttitudeMode = 'nadir';
    for (const s of segs) if (s.start <= t) att = s.mode;
    const pct = (E / cap) * 100;
    samples.push({
      t, sunFraction: f, solarW: solar, loadW: load, batteryPct: pct, batteryV: 24 + 8 * (E / cap), tempK: T,
      fuelKg: Math.max(0, massAt(sat, t) - dry), inContact: contact, thrusting, attitude: att, inSaa: saa, doseRate: rate,
    });
    doses.push(dose);
    const bl = pct < 10 ? 'critical' : pct < 20 ? 'warning' : '';
    if (bl && bl !== lastBat) warnings.push({ t, level: bl, message: `Battery ${pct.toFixed(0)} % ${bl === 'critical' ? '(< 10 %)' : '(< 20 %)'}` });
    lastBat = bl;
    const tl = T > 340 ? 'critical' : T < 250 ? 'warning' : '';
    if (tl && tl !== lastTemp) warnings.push({ t, level: tl, message: `Temperature ${T.toFixed(0)} K out of 250–340 K` });
    lastTemp = tl;
  }
  return { samples, warnings, dose: doses };
}

export function sampleAt(res: TelemetryResult, t: number): TelemetrySample | null {
  const s = res.samples;
  if (!s.length) return null;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].t <= t) lo = m; else hi = m - 1; }
  return s[lo];
}
