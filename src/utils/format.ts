export const fmt = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : '—');
export const km = (m: number, d = 3): string => fmt(m / 1000, d);
export const deg = (rad: number, d = 4): string => fmt((rad * 180) / Math.PI, d);
export function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m} min ${(sec - m * 60).toFixed(1)} s`;
}
