export interface Interval { start: number; end: number; clippedStart: boolean; clippedEnd: boolean }

/**
 * Time intervals in [t0, t1] (UTC ms) where `pred(t)` is true. Coarse scan at `stepMs`, transitions refined by bisection to ≤1 ms.
 * Limitation: features shorter than stepMs can be missed.
 */
export function intervalsWhere(pred: (t: number) => boolean, t0: number, t1: number, stepMs: number): Interval[] {
  const out: Interval[] = [];
  const bisect = (lo: number, hi: number): number => {
    const plo = pred(lo);
    for (let k = 0; k < 40 && hi - lo > 1; k++) { const mid = (lo + hi) / 2; if (pred(mid) === plo) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  let prevT = t0, prev = pred(t0);
  let start: number | null = prev ? t0 : null;
  let cs = prev;
  for (let t = t0 + stepMs; ; t += stepMs) {
    const tt = Math.min(t, t1), cur = pred(tt);
    if (cur && !prev) { start = bisect(prevT, tt); cs = false; }
    else if (!cur && prev && start !== null) { out.push({ start, end: bisect(prevT, tt), clippedStart: cs, clippedEnd: false }); start = null; }
    prevT = tt; prev = cur;
    if (tt >= t1) break;
  }
  if (start !== null) out.push({ start, end: t1, clippedStart: cs, clippedEnd: true });
  return out;
}
