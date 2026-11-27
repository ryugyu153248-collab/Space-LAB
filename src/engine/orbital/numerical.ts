import type { BurnDirection, Dynamics, Maneuver, Vec3 } from '@/types';
import { G0, J2_EARTH, MU_EARTH, OMEGA_EARTH, R_EARTH } from './constants';
import { density } from './atmosphere';
import { burnDirection } from './maneuvers';
import { norm } from './vec';

/**
 * Numerical orbit propagation (RK4, fixed step) with two-body + optional J2 + optional drag + thrust.
 *
 *   r̈ = −μ r/|r|³                                                   (two-body)
 *      − (3/2) J2 μ Re²/|r|⁵ [ (1−5z²/r²)x, (1−5z²/r²)y, (3−5z²/r²)z ] (J2, Earth pole = inertial z; TEME≈mean pole)
 *      − ½ ρ(h) (Cd A/m) |v_rel| v_rel,   v_rel = v − Ω_E ẑ × r        (drag, rotating atmosphere)
 *      + (T/m) d̂                                                     (thrust, d̂ from burn direction)
 *   ṁ = −T/(Isp g0)
 *
 * Determinism: fixed steps aligned to burn boundaries; identical inputs always give identical node tables, so
 * replay/scrubbing backwards reads the same table (no re-integration, no RNG).
 * Limitations: static exponential atmosphere, no SRP / third body / higher-order gravity, point-mass spacecraft,
 * thrust direction fixed in the V/N/R frame (ideal attitude control).
 */

export interface InitState { t: number; r: Vec3; v: Vec3; m: number }
export interface TrajNode { t: number; r: Vec3; v: Vec3; m: number }

export interface BurnReport {
  id: string;
  name: string;
  start: number;
  end: number;
  /** achieved Δv (m/s) – equals requested unless propellant ran out */
  dvAchieved: number;
  massBefore: number;
  massAfter: number;
  propellantUsed: number;
  truncated: boolean;
}

export interface TrajectoryOptions {
  dynamics: Dynamics;
  /** m² , dimensionless */
  cdA?: { cd: number; area: number };
  /** structural mass (kg): thrusting stops when m would drop below it */
  dryMass: number;
  dtCoast?: number; // s
  dtBurn?: number; // s
  /** altitude (m above R_EARTH) below which the object is considered re-entered */
  reentryAltitude?: number;
}

const gravity = (r: Vec3, j2: boolean): Vec3 => {
  const rn = norm(r), r3 = rn * rn * rn;
  let ax = (-MU_EARTH * r[0]) / r3, ay = (-MU_EARTH * r[1]) / r3, az = (-MU_EARTH * r[2]) / r3;
  if (j2) {
    const k = (-1.5 * J2_EARTH * MU_EARTH * R_EARTH * R_EARTH) / (r3 * rn * rn);
    const z2 = (r[2] * r[2]) / (rn * rn);
    ax += k * (1 - 5 * z2) * r[0];
    ay += k * (1 - 5 * z2) * r[1];
    az += k * (3 - 5 * z2) * r[2];
  }
  return [ax, ay, az];
};

export class Trajectory {
  readonly nodes: TrajNode[] = [];
  readonly reports: BurnReport[] = [];
  /** set when the object reached the re-entry altitude */
  reentryTime: number | null = null;
  private t0: number;
  private ts = 0; // seconds since t0
  private r: Vec3; private v: Vec3; private m: number;
  private burns: (Maneuver & { s: number; e: number; done?: boolean; used?: number; mStart?: number })[];
  private active: { idx: number; thrust: number; mdot: number; dir: BurnDirection } | null = null;
  private stopped = false;
  private opts: Required<Omit<TrajectoryOptions, 'cdA'>> & Pick<TrajectoryOptions, 'cdA'>;

  constructor(init: InitState, burns: Maneuver[], opts: TrajectoryOptions) {
    this.t0 = init.t; this.r = [...init.r]; this.v = [...init.v]; this.m = init.m;
    this.opts = { dtCoast: 10, dtBurn: 2, reentryAltitude: 100e3, ...opts };
    this.burns = [...burns]
      .sort((a, b) => a.start - b.start)
      .filter((b) => b.start >= init.t)
      .map((b) => ({ ...b, s: (b.start - init.t) / 1000, e: (b.start - init.t) / 1000 + (b.kind === 'finite' ? b.duration ?? 0 : 0) }));
    this.nodes.push({ t: init.t, r: [...init.r], v: [...init.v], m: init.m });
  }

  get start(): number { return this.t0; }
  get endTime(): number { return this.t0 + this.ts * 1000; }

  private accel(r: Vec3, v: Vec3, m: number, thrustDir: Vec3 | null, thrust: number): Vec3 {
    const a = gravity(r, this.opts.dynamics.j2);
    if (this.opts.dynamics.drag && this.opts.cdA) {
      const h = norm(r) - R_EARTH;
      const rho = density(h);
      const vr: Vec3 = [v[0] + OMEGA_EARTH * r[1], v[1] - OMEGA_EARTH * r[0], v[2]];
      const vn = norm(vr);
      const k = -0.5 * rho * ((this.opts.cdA.cd * this.opts.cdA.area) / m) * vn;
      a[0] += k * vr[0]; a[1] += k * vr[1]; a[2] += k * vr[2];
    }
    if (thrustDir && thrust > 0) {
      const f = thrust / m;
      a[0] += f * thrustDir[0]; a[1] += f * thrustDir[1]; a[2] += f * thrustDir[2];
    }
    return a;
  }

  private rk4(h: number, dir: BurnDirection | null, thrust: number, mdot: number): void {
    // Thrust direction is re-evaluated at each stage from that stage's state.
    const f = (r: Vec3, v: Vec3, m: number): [Vec3, Vec3, number] => {
      const d = dir && thrust > 0 ? burnDirection(dir, r, v) : null;
      return [v, this.accel(r, v, m, d, thrust), -mdot];
    };
    const add = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
    const [k1r, k1v, k1m] = f(this.r, this.v, this.m);
    const [k2r, k2v, k2m] = f(add(this.r, k1r, h / 2), add(this.v, k1v, h / 2), this.m + (k1m * h) / 2);
    const [k3r, k3v, k3m] = f(add(this.r, k2r, h / 2), add(this.v, k2v, h / 2), this.m + (k2m * h) / 2);
    const [k4r, k4v, k4m] = f(add(this.r, k3r, h), add(this.v, k3v, h), this.m + k3m * h);
    for (let i = 0; i < 3; i++) {
      this.r[i] += (h / 6) * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]);
      this.v[i] += (h / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
    }
    this.m += (h / 6) * (k1m + 2 * k2m + 2 * k3m + k4m);
  }

  private applyImpulse(b: NonNullable<(typeof this.burns)[number]>, d: Vec3): void {
    const isp = b.isp, dvReq = b.dv ?? 0;
    const ve = isp * G0;
    const mBefore = this.m;
    const maxDv = ve * Math.log(mBefore / this.opts.dryMass);
    const dv = Math.max(0, Math.min(dvReq, maxDv));
    this.v = [this.v[0] + d[0] * dv, this.v[1] + d[1] * dv, this.v[2] + d[2] * dv];
    this.m = mBefore * Math.exp(-dv / ve);
    this.reports.push({
      id: b.id, name: b.name, start: b.start, end: b.start, dvAchieved: dv, massBefore: mBefore, massAfter: this.m,
      propellantUsed: mBefore - this.m, truncated: dv < dvReq - 1e-9,
    });
    // duplicate-time node: pre-impulse node already exists, add post-impulse node
    this.nodes.push({ t: this.t0 + this.ts * 1000, r: [...this.r], v: [...this.v], m: this.m });
  }

  /** Integrate forward until the node table covers `tMs` (no-op if already covered or object ended). */
  ensure(tMs: number): void {
    const target = (tMs - this.t0) / 1000;
    const EPS = 1e-9;
    while (!this.stopped && this.ts < target - EPS) {
      // impulses scheduled at the current instant
      // Impulses at the same instant share one direction basis evaluated on the pre-burn state (so a Δv vector split into
      // V/R/N components is applied as a true vector). Mass is debited per component (slightly conservative).
      const due = this.burns.filter((b) => !b.done && b.kind === 'impulsive' && Math.abs(b.s - this.ts) < EPS);
      if (due.length) {
        const r0: Vec3 = [...this.r], v0: Vec3 = [...this.v];
        for (const b of due) { b.done = true; this.applyImpulse(b, burnDirection(b.direction, r0, v0)); }
      }
      // finite burn start/stop at the current instant
      if (!this.active) {
        const idx = this.burns.findIndex((b) => !b.done && b.kind === 'finite' && Math.abs(b.s - this.ts) < EPS && (b.duration ?? 0) > 0);
        if (idx >= 0) {
          const b = this.burns[idx];
          b.mStart = this.m; b.used = 0;
          this.active = { idx, thrust: b.thrust ?? 0, mdot: (b.thrust ?? 0) / (b.isp * G0), dir: b.direction };
        }
      }
      let h = this.active ? this.opts.dtBurn : this.opts.dtCoast;
      // clip to next boundary
      for (const b of this.burns) {
        if (b.done) continue;
        for (const edge of [b.s, b.e]) if (edge > this.ts + EPS && edge - this.ts < h) h = edge - this.ts;
      }
      let thrust = 0, mdot = 0;
      if (this.active) {
        const room = this.m - this.opts.dryMass;
        if (room > 1e-9) {
          thrust = this.active.thrust; mdot = this.active.mdot;
          if (mdot * h > room) h = room / mdot; // propellant runs out inside this step
        }
      }
      this.rk4(h, this.active ? this.active.dir : null, thrust, mdot);
      this.ts += h;
      if (this.active) {
        const b = this.burns[this.active.idx];
        b.used = (b.used ?? 0) + mdot * h;
        if (Math.abs(this.ts - b.e) < EPS || (thrust === 0)) {
          b.done = true;
          const used = b.mStart! - this.m;
          const dv = b.isp * G0 * Math.log(b.mStart! / this.m);
          this.reports.push({
            id: b.id, name: b.name, start: b.start, end: this.t0 + this.ts * 1000, dvAchieved: dv, massBefore: b.mStart!,
            massAfter: this.m, propellantUsed: used, truncated: this.ts < b.e - 1e-6,
          });
          this.active = null;
        }
      }
      this.nodes.push({ t: this.t0 + this.ts * 1000, r: [...this.r], v: [...this.v], m: this.m });
      if (norm(this.r) - R_EARTH < this.opts.reentryAltitude) {
        this.stopped = true; this.reentryTime = this.t0 + this.ts * 1000;
      }
    }
  }

  /** State at time t (cubic Hermite between nodes). null before start / after re-entry. */
  stateAt(tMs: number): { r: Vec3; v: Vec3; m: number } | null {
    if (tMs < this.t0) return null;
    this.ensure(tMs + 60_000);
    const n = this.nodes;
    if (this.reentryTime !== null && tMs >= this.reentryTime) return null;
    // last node with t <= tMs
    let lo = 0, hi = n.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (n[mid].t <= tMs) lo = mid; else hi = mid - 1; }
    const a = n[lo], b = n[Math.min(lo + 1, n.length - 1)];
    if (b.t <= a.t) return { r: [...a.r], v: [...a.v], m: a.m };
    const h = (b.t - a.t) / 1000, s = (tMs - a.t) / (b.t - a.t);
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const r: Vec3 = [0, 0, 0], v: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      r[i] = h00 * a.r[i] + h10 * h * a.v[i] + h01 * b.r[i] + h11 * h * b.v[i];
      // derivative of the Hermite polynomial → velocity
      const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
      v[i] = (d00 * a.r[i] + d01 * b.r[i]) / h + d10 * a.v[i] + d11 * b.v[i];
    }
    return { r, v, m: a.m + (b.m - a.m) * s };
  }
}
