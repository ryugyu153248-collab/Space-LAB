import { describe, expect, it } from 'vitest';
import { SimulationClock } from './SimulationClock';

describe('SimulationClock', () => {
  it('advances by wall dt × rate; deterministic for identical tick sequences', () => {
    const run = () => {
      const c = new SimulationClock(0, 1e9);
      c.setRate(100); c.play();
      for (const w of [0, 16, 33, 50, 66]) c.tick(w);
      return c.time;
    };
    expect(run()).toBe(66 * 100);
    expect(run()).toBe(run());
  });
  it('reverse, clamp at start, stop/reset, and wall-dt clamp', () => {
    const c = new SimulationClock(1000, 10_000);
    c.setRate(1); c.play(); c.tick(0); c.tick(5000); // clamped to 250 ms
    expect(c.time).toBe(1250);
    c.setReverse(true); c.tick(5100);
    expect(c.time).toBe(1150);
    c.setRate(10000); c.tick(5300);
    expect(c.time).toBe(1000);
    expect(c.snapshot().playing).toBe(false);
    c.setTime(5000); c.stop();
    expect(c.time).toBe(1000);
  });
});
