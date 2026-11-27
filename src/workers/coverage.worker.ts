/// <reference lib="webworker" />
import { computeCoverage, type CoverageInput } from '@/engine/analysis/coverage';

// Heavy grid × time computation runs off the UI thread; progress is streamed back.
self.onmessage = (e: MessageEvent<{ id: number; input: CoverageInput }>) => {
  const { id, input } = e.data;
  try {
    const res = computeCoverage(input, (f) => (self as unknown as Worker).postMessage({ id, progress: f }));
    (self as unknown as Worker).postMessage({ id, result: res }, [res.passes.buffer, res.coveredSec.buffer, res.maxGapSec.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
