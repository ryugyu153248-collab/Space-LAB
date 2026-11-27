/// <reference lib="webworker" />
import { screenConjunctions } from '@/engine/analysis/conjunction';
import type { Satellite } from '@/types';

// Conjunction screening (many objects × long windows) runs off the UI thread.
self.onmessage = (e: MessageEvent<{ id: number; primary: Satellite; others: Satellite[]; t0: number; t1: number; screen: number }>) => {
  const { id, primary, others, t0, t1, screen } = e.data;
  try { (self as unknown as Worker).postMessage({ id, result: screenConjunctions(primary, others, t0, t1, { screenDistance: screen }) }); }
  catch (err) { (self as unknown as Worker).postMessage({ id, error: String(err) }); }
};
