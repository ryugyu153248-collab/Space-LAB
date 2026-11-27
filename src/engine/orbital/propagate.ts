import type { Dynamics, Satellite, SpacecraftProps, StateVector } from '@/types';
import { createSgp4, propagateSgp4, type Sgp4Model } from './propagators/sgp4';
import { propagateTwoBody } from './propagators/twobody';
import { Trajectory, type BurnReport } from './numerical';

export const DEFAULT_PROPS: SpacecraftProps = {
  massKg: 500, propellantKg: 50, cd: 2.2, area: 4, panelArea: 4, panelEfficiency: 0.28,
  batteryWh: 400, busLoadW: 180, commLoadW: 60,
};

export const propsOf = (s: Satellite): SpacecraftProps => ({ ...DEFAULT_PROPS, ...(s.props ?? {}) });

/**
 * Default dynamics follow the data source so that "before" and "after a maneuver" use consistent physics:
 *  - TLE (SGP4 already contains J2 secular effects) → numerical J2 on;
 *  - analytic two-body elements → numerical two-body (J2 off) so a zero-thrust numerical trajectory equals the analytic one.
 */
export const dynamicsOf = (s: Satellite): Dynamics =>
  s.dynamics ?? { j2: s.source.kind !== 'elements', drag: false };

const sgp4Cache = new Map<string, { key: string; model: Sgp4Model }>();
function getSgp4(s: Satellite): Sgp4Model {
  if (s.source.kind !== 'tle') throw new Error('not a TLE satellite');
  const key = s.source.line1 + s.source.line2;
  const hit = sgp4Cache.get(s.id);
  if (hit && hit.key === key) return hit.model;
  const model = createSgp4(s.source.line1, s.source.line2);
  sgp4Cache.set(s.id, { key, model });
  return model;
}

/** Original (pre-maneuver) analytic/SGP4 state. Never used after a maneuver for the maneuvered object. */
function propagateOriginal(s: Satellite, t: number): StateVector | null {
  if (s.source.kind === 'tle') return propagateSgp4(getSgp4(s), t);
  if (s.source.kind === 'elements') return propagateTwoBody(s.source.elements, s.source.epoch, t);
  return null;
}

type TrajKind = 'maneuvered' | 'baseline';
const trajCache = new Map<string, { key: string; traj: Trajectory | null }>();

const keyOf = (s: Satellite, kind: TrajKind): string =>
  JSON.stringify([kind, s.source, s.maneuvers ?? [], s.dynamics, s.props, s.endTime]);

/** Starting time of the numerical trajectory, or null if the object is purely analytic. */
function trajectoryStart(s: Satellite): number | null {
  if (s.source.kind === 'state') return s.source.epoch;
  const first = (s.maneuvers ?? []).reduce<number | null>((m, b) => (m === null || b.start < m ? b.start : m), null);
  return first;
}

function getTrajectory(s: Satellite, kind: TrajKind): Trajectory | null {
  const k = keyOf(s, kind);
  const hit = trajCache.get(s.id + kind);
  if (hit && hit.key === k) return hit.traj;
  let traj: Trajectory | null = null;
  const t0 = trajectoryStart(s);
  if (t0 !== null) {
    let r: StateVector | { r: [number, number, number]; v: [number, number, number] } | null;
    if (s.source.kind === 'state') r = { r: s.source.r, v: s.source.v };
    else r = propagateOriginal(s, t0); // state at burn time → NEW numerical initial state (never the TLE afterwards)
    if (r) {
      const p = propsOf(s);
      traj = new Trajectory({ t: t0, r: r.r, v: r.v, m: p.massKg }, kind === 'baseline' ? [] : s.maneuvers ?? [], {
        dynamics: dynamicsOf(s), cdA: { cd: p.cd, area: p.area }, dryMass: Math.max(1, p.massKg - p.propellantKg),
      });
    }
  }
  trajCache.set(s.id + kind, { key: k, traj });
  return traj;
}

export function forgetSatellite(id: string): void {
  sgp4Cache.delete(id); trajCache.delete(id + 'maneuvered'); trajCache.delete(id + 'baseline');
}

function fromTraj(traj: Trajectory, t: number, model: StateVector['model'] = 'NUMERICAL'): StateVector | null {
  const st = traj.stateAt(t);
  return st ? { t, r: st.r, v: st.v, frame: 'ECI', model } : null;
}

/**
 * Single entry point for state at time t (UTC ms).
 *  - before the first burn: SGP4 / two-body (state.model tells which);
 *  - from the first burn on: numerical trajectory started from the state at burn time;
 *  - deployed objects / debris: numerical trajectory from their initial state (null before they exist);
 *  - null after `endTime` (collision/re-entry) or when SGP4 fails.
 */
export function propagateSatellite(s: Satellite, t: number): StateVector | null {
  if (s.endTime !== undefined && t >= s.endTime) return null;
  const t0 = trajectoryStart(s);
  if (s.source.kind === 'state') {
    if (t < s.source.epoch) return null;
    const tr = getTrajectory(s, 'maneuvered');
    return tr ? fromTraj(tr, t) : null;
  }
  if (t0 !== null && t >= t0) {
    const tr = getTrajectory(s, 'maneuvered');
    if (tr) return fromTraj(tr, t);
  }
  return propagateOriginal(s, t);
}

/** Same numerical dynamics but WITHOUT the burns (apples-to-apples "before" for comparisons). Falls back to the original. */
export function propagateBaseline(s: Satellite, t: number): StateVector | null {
  const t0 = trajectoryStart(s);
  if (t0 === null || t < t0 || s.source.kind === 'state') return propagateSatellite({ ...s, maneuvers: [] }, t);
  const tr = getTrajectory(s, 'baseline');
  return tr ? fromTraj(tr, t) : propagateOriginal(s, t);
}

/** Burn reports (achieved Δv, mass flow) after integrating through all burns. */
export function burnReports(s: Satellite): BurnReport[] {
  const tr = getTrajectory(s, 'maneuvered');
  if (!tr) return [];
  const last = Math.max(0, ...(s.maneuvers ?? []).map((b) => b.start + (b.duration ?? 0) * 1000));
  tr.ensure(last + 1000);
  return [...tr.reports].sort((a, b) => a.start - b.start);
}

/** Time the object crossed the re-entry altitude, if the numerical trajectory got that far (ensure up to `until`). */
export function reentryTime(s: Satellite, until: number): number | null {
  const tr = getTrajectory(s, 'maneuvered');
  if (!tr) return null;
  tr.ensure(until);
  return tr.reentryTime;
}

export function massAt(s: Satellite, t: number): number {
  const tr = getTrajectory(s, 'maneuvered');
  const st = tr?.stateAt(t);
  return st ? st.m : propsOf(s).massKg;
}
