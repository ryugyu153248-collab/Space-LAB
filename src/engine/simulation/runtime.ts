import { SimulationClock } from './SimulationClock';

/** The single Simulation Clock shared by rendering, panels and charts. */
export const clock = new SimulationClock(Date.UTC(2008, 8, 20, 12, 25, 40));

/** Jump to a UTC time, widening the scenario window if the target lies outside it. */
export function jumpTo(t: number): void {
  const s = clock.snapshot();
  const day = 86_400_000;
  if (t < s.start || t > s.end) clock.setRange(Math.min(s.start, t - day), Math.max(s.end, t + 3 * day), t);
  else clock.setTime(t);
}
