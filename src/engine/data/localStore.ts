import type { ScenarioFile } from './scenario';

/** Local scenario storage in IndexedDB (browser only). All calls reject with a readable error if IndexedDB is unavailable. */
const DB = 'orbital-lab', STORE = 'scenarios';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
};

export const localList = async (): Promise<{ id: string; name: string; savedAt: string }[]> =>
  ((await tx('readonly', (s) => s.getAll())) as ScenarioFile[]).map((x) => ({ id: x.id, name: x.name, savedAt: x.savedAt })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
export const localGet = (id: string): Promise<ScenarioFile | undefined> => tx('readonly', (s) => s.get(id));
export const localPut = async (f: ScenarioFile): Promise<void> => { await tx('readwrite', (s) => s.put(f)); };
export const localDelete = async (id: string): Promise<void> => { await tx('readwrite', (s) => s.delete(id)); };
