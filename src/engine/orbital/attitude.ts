import type { AttitudeSegment, Vec3 } from '@/types';
import { cross, dot, norm, scale } from './vec';
import { geodeticToEcef, ecefToEci } from './frames';
import { E2_EARTH, R_EARTH } from './constants';

/** Quaternion [w, x, y, z], body → inertial (ECI). */
export type Quat = [number, number, number, number];
export const IDENTITY: Quat = [1, 0, 0, 0];

export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  // rotation matrix with columns x,y,z (body axes expressed in ECI)
  const m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return quatNormalize(q);
}

export const quatNormalize = (q: Quat): Quat => { const n = Math.hypot(...q); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };

/** Rotate vector v by quaternion q (body→ECI): v' = q v q*. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const t: Vec3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}

/** Spherical linear interpolation (shortest path). */
export function slerp(a: Quat, b: Quat, s: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb: Quat = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return quatNormalize([0, 1, 2, 3].map((i) => a[i] + s * (bb[i] - a[i])) as Quat);
  const th = Math.acos(d), st = Math.sin(th);
  const k1 = Math.sin((1 - s) * th) / st, k2 = Math.sin(s * th) / st;
  return [0, 1, 2, 3].map((i) => k1 * a[i] + k2 * bb[i]) as Quat;
}

const unit = (v: Vec3): Vec3 => scale(v, 1 / norm(v));

/**
 * Body frame convention: +Z = sensor boresight / pointing axis, +X = "along-track/secondary" axis, +Y = Z × X.
 * Given the desired boresight direction z (ECI) and a reference direction for X (orbit normal), build a right-handed basis.
 */
export function attitudeFromBoresight(zDesired: Vec3, ref: Vec3): Quat {
  const z = unit(zDesired);
  ref = unit(ref);
  let x = sub3(ref, scale(z, dot(ref, z)));
  // degenerate (reference ∥ boresight, e.g. β = 90° sun pointing): pick any axis least aligned with z
  if (norm(x) < 1e-6) x = cross(z, Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  x = unit(x);
  const y = cross(z, x);
  return quatFromBasis(x, y, z);
}
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export interface AttitudeContext {
  r: Vec3; v: Vec3; sunEci: Vec3; utcMs: number;
}

/** Commanded (target) attitude of a mode at the given orbital state. Nadir: +Z → Earth centre; Sun: +Z → Sun; Target: +Z → ground point. */
export function targetQuat(seg: Pick<AttitudeSegment, 'mode' | 'target'>, c: AttitudeContext): Quat {
  const h = cross(c.r, c.v);
  switch (seg.mode) {
    case 'nadir': return attitudeFromBoresight(scale(c.r, -1), cross(h, c.r)); // X toward velocity side
    case 'sun': return attitudeFromBoresight(c.sunEci, h);
    case 'target': {
      if (!seg.target) return attitudeFromBoresight(scale(c.r, -1), h);
      const tEci = ecefToEci(geodeticToEcef(seg.target), c.utcMs);
      return attitudeFromBoresight([tEci[0] - c.r[0], tEci[1] - c.r[1], tEci[2] - c.r[2]], h);
    }
    case 'inertial': return IDENTITY;
  }
}

/**
 * Attitude at time t given ordered segments. Before the first segment the satellite is nadir pointing.
 * Slew: slerp from the attitude at segment start (previous commanded attitude) to the (moving) commanded attitude over slewSec.
 * Limitations: kinematic slew (no inertia/torque limits).
 */
export function attitudeAt(segs: AttitudeSegment[] | undefined, t: number, ctxAt: (t: number) => AttitudeContext | null): Quat | null {
  const sorted = [...(segs ?? [])].sort((a, b) => a.start - b.start);
  const rec = (idx: number, tt: number): Quat | null => {
    const c = ctxAt(tt);
    if (!c) return null;
    if (idx < 0) return targetQuat({ mode: 'nadir' }, c);
    const seg = sorted[idx];
    if (tt < seg.start) return rec(idx - 1, tt);
    const cmd = targetQuat(seg, c);
    const f = seg.slewSec > 0 ? Math.min(1, (tt - seg.start) / (seg.slewSec * 1000)) : 1;
    if (f >= 1) return cmd;
    const prev = rec(idx - 1, seg.start);
    return prev ? slerp(prev, cmd, f) : cmd;
  };
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) if (sorted[i].start <= t) idx = i;
  return rec(idx, t);
}

/** Ray (origin o, unit direction d, ECEF m) → nearest WGS84 ellipsoid intersection, or null (miss). */
export function rayEllipsoid(o: Vec3, d: Vec3): Vec3 | null {
  const b = R_EARTH * Math.sqrt(1 - E2_EARTH);
  const k = R_EARTH / b;
  const o2: Vec3 = [o[0], o[1], o[2] * k], d2: Vec3 = [d[0], d[1], d[2] * k];
  const A = dot(d2, d2), B = 2 * dot(o2, d2), C = dot(o2, o2) - R_EARTH * R_EARTH;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0) return null;
  return [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
}

/**
 * Ground footprint of a conical sensor (half-angle α) with boresight `bore` (unit, ECEF), from satellite position `pos` (ECEF, m).
 * Returns ring points (ECEF, m) or null where the edge ray misses the Earth (limb-clipped).
 */
export function sensorFootprint(pos: Vec3, bore: Vec3, alpha: number, n = 48): (Vec3 | null)[] {
  const b = unit(bore);
  const ref: Vec3 = Math.abs(b[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(b, ref)), w = cross(b, u);
  const out: (Vec3 | null)[] = [];
  for (let i = 0; i < n; i++) {
    const phi = (2 * Math.PI * i) / n;
    const dir: Vec3 = [0, 1, 2].map((k) => Math.cos(alpha) * b[k] + Math.sin(alpha) * (Math.cos(phi) * u[k] + Math.sin(phi) * w[k])) as Vec3;
    out.push(rayEllipsoid(pos, dir));
  }
  return out;
}
