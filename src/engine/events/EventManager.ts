import type { AttitudeSegment, Maneuver, Satellite, Vec3 } from '@/types';
import { dynamicsOf, propagateSatellite, propsOf, reentryTime } from '../orbital/propagate';
import { burnDirection } from '../orbital/maneuvers';
import { dockingCheck } from '../analysis/rendezvous';
import type { EventStatus, EventType, SimEvent } from './EventTypes';

/**
 * Event engine. The scenario is a pure function of (base satellites, events):
 *     derived satellites = apply(events sorted by start, priority, id)(base satellites)
 * so every recompute is deterministic, replayable, and orbit-changing events (burn, deployment, collision, re-entry)
 * automatically rebuild the affected trajectories (numerical propagation restarts from the state at the event time).
 */

export interface DeriveContext {
  sats: Map<string, Satellite>;
  horizon: number;
  messages: Map<string, string[]>;
  say: (id: string, m: string) => void;
}

export interface EventHandler {
  type: EventType;
  label: string;
  /** true if the event changes orbital state and therefore requires trajectory recomputation */
  affectsOrbit: boolean;
  defaults: (start: number) => Partial<SimEvent>;
  validate: (e: SimEvent, ctx: DeriveContext) => string[];
  apply: (e: SimEvent, ctx: DeriveContext) => void;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);

/** Mulberry32 PRNG — seeded, so debris clouds are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const gauss = (rnd: () => number): number => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());

const sat0 = (e: SimEvent, ctx: DeriveContext, i = 0): Satellite | undefined => ctx.sats.get(e.objects[i]);
const needSat = (e: SimEvent, ctx: DeriveContext, n = 1): string[] =>
  Array.from({ length: n }, (_, i) => (ctx.sats.has(e.objects[i]) ? '' : `object #${i + 1} not found`)).filter(Boolean);

export const handlers: Record<EventType, EventHandler> = {
  burn: {
    type: 'burn', label: 'Burn', affectsOrbit: true,
    defaults: (start) => ({ params: { kind: 'impulsive', direction: 'prograde', dv: 1, isp: 220 }, visual: { kind: 'burn-vector', color: '#f97316' }, start }),
    validate: (e, ctx) => {
      const out = needSat(e, ctx);
      if (e.params.kind === 'finite') { if (!(num(e.params.thrust, 0) > 0) || !(num(e.params.duration, 0) > 0)) out.push('finite burn needs thrust > 0 N and duration > 0 s'); }
      else if (!(num(e.params.dv, -1) >= 0)) out.push('impulsive burn needs Δv ≥ 0');
      if (!(num(e.params.isp, 0) > 0)) out.push('Isp must be > 0');
      return out;
    },
    apply: (e, ctx) => {
      const s = sat0(e, ctx)!;
      const m: Maneuver = {
        id: e.id, name: e.name, start: e.start, kind: e.params.kind === 'finite' ? 'finite' : 'impulsive',
        direction: (e.params.direction as Maneuver['direction']) ?? 'prograde', dv: num(e.params.dv, 0),
        thrust: num(e.params.thrust, 0), duration: num(e.params.duration, 0), isp: num(e.params.isp, 220),
      };
      ctx.sats.set(s.id, { ...s, maneuvers: [...(s.maneuvers ?? []), m] });
    },
  },
  attitude: {
    type: 'attitude', label: 'Attitude change', affectsOrbit: false,
    defaults: (start) => ({ params: { mode: 'sun', slewSec: 120 }, visual: { kind: 'label' }, start }),
    validate: (e, ctx) => {
      const out = needSat(e, ctx);
      if (e.params.mode === 'target' && (e.params.lat === undefined || e.params.lon === undefined)) out.push('target pointing needs lat/lon');
      return out;
    },
    apply: (e, ctx) => {
      const s = sat0(e, ctx)!;
      const seg: AttitudeSegment = {
        id: e.id, start: e.start, mode: (e.params.mode as AttitudeSegment['mode']) ?? 'nadir', slewSec: num(e.params.slewSec, 60),
        target: e.params.mode === 'target' ? { lat: (num(e.params.lat, 0) * Math.PI) / 180, lon: (num(e.params.lon, 0) * Math.PI) / 180, alt: num(e.params.alt, 0) } : undefined,
      };
      ctx.sats.set(s.id, { ...s, attitude: [...(s.attitude ?? []), seg] });
    },
  },
  deployment: {
    type: 'deployment', label: 'Deployment', affectsOrbit: true,
    defaults: (start) => ({ params: { name: 'DEPLOYED-1', dv: 1.5, direction: 'retrograde', massKg: 20 }, visual: { kind: 'label', color: '#22d3ee' }, start }),
    validate: (e, ctx) => needSat(e, ctx),
    apply: (e, ctx) => {
      const parent = sat0(e, ctx)!;
      const st = propagateSatellite(parent, e.start);
      if (!st) return ctx.say(e.id, 'parent has no valid state at deployment time');
      const d = burnDirection((e.params.direction as Maneuver['direction']) ?? 'retrograde', st.r, st.v);
      const dv = num(e.params.dv, 0);
      const v: Vec3 = [st.v[0] + d[0] * dv, st.v[1] + d[1] * dv, st.v[2] + d[2] * dv];
      const pp = propsOf(parent);
      const child: Satellite = {
        id: `${e.id}-obj`, name: String(e.params.name ?? 'DEPLOYED'), source: { kind: 'state', epoch: e.start, r: st.r, v },
        origin: 'SIMULATED', provenance: `Simulated – deployed from ${parent.name} (Δv ${dv} m/s ${e.params.direction})`, epoch: e.start,
        color: '#22d3ee', parentId: parent.id, dynamics: dynamicsOf(parent),
        props: { ...pp, massKg: num(e.params.massKg, 20), propellantKg: 0 },
      };
      ctx.sats.set(child.id, child);
    },
  },
  collision: {
    type: 'collision', label: 'Collision (simplified debris)', affectsOrbit: true,
    defaults: (start) => ({ params: { fragments: 60, spreadMps: 150, seed: 1 }, visual: { kind: 'debris-cloud', color: '#ef4444' }, start }),
    validate: (e, ctx) => needSat(e, ctx, 2),
    apply: (e, ctx) => {
      const a = sat0(e, ctx, 0)!, b = sat0(e, ctx, 1)!;
      const sa = propagateSatellite(a, e.start), sb = propagateSatellite(b, e.start);
      if (!sa || !sb) return ctx.say(e.id, 'an object has no valid state at the collision time');
      const ma = propsOf(a).massKg, mb = propsOf(b).massKg, mt = ma + mb;
      // Perfectly inelastic CM state: momentum conservation (equal-fragment masses ⇒ mean fragment velocity = CM velocity)
      const vcm: Vec3 = [0, 1, 2].map((i) => (ma * sa.v[i] + mb * sb.v[i]) / mt) as Vec3;
      const rcm: Vec3 = [0, 1, 2].map((i) => (sa.r[i] + sb.r[i]) / 2) as Vec3;
      const n = Math.max(1, Math.round(num(e.params.fragments, 60)));
      const spread = num(e.params.spreadMps, 150);
      const rnd = mulberry32(hashStr(e.id) ^ Math.round(num(e.params.seed, 1)));
      const dvs: Vec3[] = Array.from({ length: n }, () => [gauss(rnd), gauss(rnd), gauss(rnd)].map((g) => (g * spread) / Math.sqrt(3)) as Vec3);
      const mean = [0, 1, 2].map((i) => dvs.reduce((s, d) => s + d[i], 0) / n);
      dvs.forEach((d, k) => {
        const v: Vec3 = [vcm[0] + d[0] - mean[0], vcm[1] + d[1] - mean[1], vcm[2] + d[2] - mean[2]];
        ctx.sats.set(`${e.id}-deb-${k}`, {
          id: `${e.id}-deb-${k}`, name: `DEBRIS ${k + 1}`, kind: 'debris', source: { kind: 'state', epoch: e.start, r: rcm, v },
          origin: 'SIMULATED', provenance: 'Simulated – SIMPLIFIED debris model (isotropic Gaussian ejection about the CM; not NASA SBM)',
          epoch: e.start, color: '#fca5a5', parentId: a.id, dynamics: dynamicsOf(a),
          props: { ...propsOf(a), massKg: mt / n, propellantKg: 0, area: 0.05 },
        });
      });
      ctx.sats.set(a.id, { ...a, endTime: e.start });
      ctx.sats.set(b.id, { ...b, endTime: e.start });
    },
  },
  docking: {
    type: 'docking', label: 'Docking (criteria check)', affectsOrbit: false,
    defaults: (start) => ({ params: { maxRange: 10, maxRelSpeed: 0.1 }, visual: { kind: 'label', color: '#34d399' }, start }),
    validate: (e, ctx) => needSat(e, ctx, 2),
    apply: () => { /* no orbital effect: success/failure is evaluated by evaluateEvents() */ },
  },
  reentry: {
    type: 'reentry', label: 'Re-entry (drag decay)', affectsOrbit: true,
    defaults: (start) => ({ params: { dv: 0, direction: 'retrograde', isp: 220, cd: 2.2, area: 4 }, visual: { kind: 'label', color: '#fb7185' }, start }),
    validate: (e, ctx) => needSat(e, ctx),
    apply: (e, ctx) => {
      const s = sat0(e, ctx)!;
      const m: Maneuver = { id: e.id, name: e.name, kind: 'impulsive', start: e.start, direction: (e.params.direction as Maneuver['direction']) ?? 'retrograde', dv: num(e.params.dv, 0), isp: num(e.params.isp, 220) };
      ctx.sats.set(s.id, {
        ...s, maneuvers: [...(s.maneuvers ?? []), m], dynamics: { ...dynamicsOf(s), drag: true },
        props: { ...propsOf(s), cd: num(e.params.cd, 2.2), area: num(e.params.area, 4) },
      });
    },
  },
  eclipse: { type: 'eclipse', label: 'Eclipse (computed)', affectsOrbit: false, defaults: (start) => ({ start, params: {} }), validate: () => ['computed from geometry; not user-schedulable'], apply: () => {} },
  access: { type: 'access', label: 'Access (computed)', affectsOrbit: false, defaults: (start) => ({ start, params: {} }), validate: () => ['computed from geometry; not user-schedulable'], apply: () => {} },
  communication: { type: 'communication', label: 'Communication (computed)', affectsOrbit: false, defaults: (start) => ({ start, params: {} }), validate: () => ['computed from geometry; not user-schedulable'], apply: () => {} },
};

export const USER_EVENT_TYPES: EventType[] = ['burn', 'attitude', 'deployment', 'collision', 'docking', 'reentry'];

export function newEvent(type: EventType, start: number, objects: string[], id = `ev-${Math.random().toString(36).slice(2, 8)}`): SimEvent {
  const d = handlers[type].defaults(start);
  return { id, name: handlers[type].label, type, start, objects, params: {}, enabled: true, priority: 0, dependsOn: [], visual: { kind: 'none' }, handlerId: type, ...d };
}

export interface DeriveResult {
  satellites: Satellite[];
  status: Record<string, { status: EventStatus; messages: string[] }>;
}

/** Derive the live satellite list and per-event status for the given scenario time. */
export function deriveScenario(base: Satellite[], events: SimEvent[], horizon: number, now: number): DeriveResult {
  const ctx: DeriveContext = { sats: new Map(base.map((s) => [s.id, { ...s, maneuvers: [], attitude: [] }])), horizon, messages: new Map(), say(id, m) { (this.messages.get(id) ?? this.messages.set(id, []).get(id)!).push(m); } };
  const sorted = [...events].sort((a, b) => a.start - b.start || b.priority - a.priority || a.id.localeCompare(b.id));
  const failed = new Set<string>();
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const e of sorted) {
    if (!e.enabled) continue;
    const h = handlers[e.handlerId];
    const errs = h.validate(e, ctx);
    for (const d of e.dependsOn) {
      const dep = byId.get(d);
      if (!dep || !dep.enabled) errs.push(`dependency ${d} missing/disabled`);
      else if (dep.start > e.start) errs.push(`dependency "${dep.name}" starts after this event`);
      else if (failed.has(d)) errs.push(`dependency "${dep.name}" failed`);
    }
    if (errs.length) { errs.forEach((m) => ctx.say(e.id, m)); failed.add(e.id); continue; }
    try { h.apply(e, ctx); } catch (err) { ctx.say(e.id, String(err)); failed.add(e.id); }
  }
  const satellites = [...ctx.sats.values()];
  const status: DeriveResult['status'] = {};
  for (const e of events) {
    const msgs = ctx.messages.get(e.id) ?? [];
    let st: EventStatus = !e.enabled ? 'disabled' : failed.has(e.id) ? 'failed' : now < e.start ? 'scheduled' : e.end && now < e.end ? 'active' : 'completed';
    if (e.type === 'docking' && e.enabled && !failed.has(e.id)) {
      const c = ctx.sats.get(e.objects[0]), t = ctx.sats.get(e.objects[1]);
      const chk = c && t ? dockingCheck(c, t, e.start, num(e.params.maxRange, 10), num(e.params.maxRelSpeed, 0.1)) : null;
      if (chk) {
        msgs.push(`range ${chk.range.toFixed(1)} m, rel. speed ${chk.relSpeed.toFixed(3)} m/s at the docking time — ${chk.ok ? 'criteria MET' : 'criteria NOT met'}`);
        if (!chk.ok && now >= e.start) st = 'failed';
      }
    }
    if (e.type === 'reentry' && e.enabled && !failed.has(e.id)) {
      const s = ctx.sats.get(e.objects[0]);
      const tr = s ? reentryTime(s, Math.max(horizon, now)) : null;
      msgs.push(tr ? `re-entry interface (100 km) crossed at ${new Date(tr).toISOString().slice(0, 19)}Z` : 'no re-entry within the scenario window');
    }
    status[e.id] = { status: st, messages: msgs };
  }
  return { satellites, status };
}
