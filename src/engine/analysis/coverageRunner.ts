import { computeCoverage, type CoverageInput, type CoverageResult } from './coverage';

let worker: Worker | null = null;
let seq = 0;

/** Run coverage in a Web Worker (UI stays responsive); falls back to the main thread when Workers are unavailable. */
export function runCoverage(input: CoverageInput, onProgress: (f: number) => void): Promise<CoverageResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(computeCoverage(input, onProgress));
  if (!worker) worker = new Worker(new URL('../../workers/coverage.worker.ts', import.meta.url), { type: 'module' });
  const w = worker, id = ++seq;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      if (e.data.progress !== undefined) onProgress(e.data.progress);
      else { w.removeEventListener('message', on); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); }
    };
    w.addEventListener('message', on);
    w.postMessage({ id, input });
  });
}
