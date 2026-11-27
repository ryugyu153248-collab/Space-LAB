import type { Satellite } from '@/types';
import { screenConjunctions, type Conjunction } from './conjunction';

let worker: Worker | null = null;
let seq = 0;

/** Screen in a Web Worker (UI stays responsive); falls back to the main thread when Workers are unavailable. */
export function runConjunctions(primary: Satellite, others: Satellite[], t0: number, t1: number, screen: number): Promise<Conjunction[]> {
  if (typeof Worker === 'undefined') return Promise.resolve(screenConjunctions(primary, others, t0, t1, { screenDistance: screen }));
  if (!worker) worker = new Worker(new URL('../../workers/conjunction.worker.ts', import.meta.url), { type: 'module' });
  const w = worker, id = ++seq;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', on);
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result);
    };
    w.addEventListener('message', on);
    w.postMessage({ id, primary, others, t0, t1, screen });
  });
}
