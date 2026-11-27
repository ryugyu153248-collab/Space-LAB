/**
 * Simulation clock (UTC epoch-ms). Independent from render frame rate:
 * every call to `tick(wallNowMs)` advances simulated time by  Δwall × rate × direction,
 * with Δwall clamped (tab-suspend protection) so a long frame can't teleport the simulation.
 */
export const TIME_RATES = [0.1, 1, 10, 100, 1000, 10000] as const;

export interface ClockSnapshot {
  time: number;
  start: number;
  end: number;
  rate: number;
  playing: boolean;
  reverse: boolean;
}

type Listener = (s: ClockSnapshot) => void;

export class SimulationClock {
  private _time: number;
  private _start: number;
  private _end: number;
  private _rate = 1;
  private _playing = false;
  private _reverse = false;
  private lastWall: number | null = null;
  private listeners = new Set<Listener>();
  static readonly MAX_WALL_DT_MS = 250;

  constructor(start: number, durationMs = 3 * 86_400_000) {
    this._time = this._start = start;
    this._end = start + durationMs;
  }

  get time(): number { return this._time; }
  snapshot(): ClockSnapshot {
    return { time: this._time, start: this._start, end: this._end, rate: this._rate, playing: this._playing, reverse: this._reverse };
  }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit() { const s = this.snapshot(); this.listeners.forEach((l) => l(s)); }

  play(): void { this._playing = true; this.lastWall = null; this.emit(); }
  pause(): void { this._playing = false; this.lastWall = null; this.emit(); }
  stop(): void { this._playing = false; this._reverse = false; this._time = this._start; this.lastWall = null; this.emit(); }
  reset(): void { this.stop(); }
  setReverse(r: boolean): void { this._reverse = r; this.emit(); }
  setRate(rate: number): void { this._rate = rate; this.emit(); }
  setTime(t: number): void { this._time = Math.min(this._end, Math.max(this._start, t)); this.emit(); }
  /** Move the time window (e.g. when loading a scenario). */
  setRange(start: number, end: number, time = start): void {
    this._start = start; this._end = end; this._time = Math.min(end, Math.max(start, time)); this.emit();
  }

  /** Advance with wall-clock timestamp (ms, e.g. performance.now()). Returns true if time changed. */
  tick(wallNow: number): boolean {
    if (!this._playing) { this.lastWall = null; return false; }
    if (this.lastWall === null) { this.lastWall = wallNow; return false; }
    const dt = Math.min(wallNow - this.lastWall, SimulationClock.MAX_WALL_DT_MS);
    this.lastWall = wallNow;
    let next = this._time + dt * this._rate * (this._reverse ? -1 : 1);
    if (next >= this._end) { next = this._end; this._playing = false; this.emit(); }
    else if (next <= this._start) { next = this._start; this._playing = false; this.emit(); }
    this._time = next;
    return true;
  }
}
