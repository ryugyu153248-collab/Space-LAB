import { useEffect, useState } from 'react';
import { useStore } from '@/stores/store';
import { localDelete, localGet, localList, localPut } from '@/engine/data/localStore';
import { parseScenario, serializeScenario } from '@/engine/data/scenario';
import { buildCollisionDemo, buildIssSample, buildNapa2Demo, emptyScenario } from '@/engine/data/demoFile';
import { downloadText, safeName } from '@/engine/exporters/files';
import { clock } from '@/engine/simulation/runtime';
import { inputCls } from '../common/ui';

export function ScenarioDialog() {
  const { dialog, setDialog, snapshot, loadScenario, scenarioName } = useStore();
  const [name, setName] = useState(scenarioName);
  const [local, setLocal] = useState<{ id: string; name: string; savedAt: string }[]>([]);
  const [msg, setMsg] = useState('');
  const open = dialog === 'scenario';
  const run = async (f: () => Promise<void>) => { try { setMsg(''); await f(); } catch (e) { setMsg(e instanceof Error ? e.message : String((e as { message?: string }).message ?? e)); } };
  const refresh = () => run(async () => {
    setLocal(await localList().catch(() => []));
  });
  useEffect(() => { if (open) { setName(scenarioName); refresh(); } }, [open]); // eslint-disable-line
  if (!open) return null;
  const snap = () => ({ ...snapshot(), name });
  const onFile = (f?: File) => f && run(async () => { loadScenario(parseScenario(await f.text())); });

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setDialog(null)}>
      <div className="w-[640px] max-w-[96vw] max-h-[90vh] overflow-y-auto bg-panel border border-edge rounded-lg p-4 space-y-3 text-[11px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center"><span className="text-slate-100 font-semibold text-sm flex-1">Scenarios</span><button className="text-slate-500" onClick={() => setDialog(null)}>✕</button></div>
        <div className="flex gap-2 items-center"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-on whitespace-nowrap" onClick={() => run(async () => { await localPut(snap()); await refresh(); setMsg('Saved to this browser (IndexedDB).'); })}>Save locally</button>
          <button className="btn whitespace-nowrap" onClick={() => downloadText(serializeScenario(snap()), `${safeName(name)}.scenario.json`, 'application/json')}>Export JSON</button></div>
        <div className="flex gap-2 items-center flex-wrap"><span className="text-slate-400">New / built-in:</span>
          <button className="btn" onClick={() => loadScenario(buildNapa2Demo())}>NAPA-2 CubeSat demo</button>
          <button className="btn" onClick={() => loadScenario(buildCollisionDemo())}>LEO collision-avoidance demo</button>
          <button className="btn" onClick={() => loadScenario(buildIssSample())}>ISS historic TLE sample</button>
          <button className="btn" onClick={() => loadScenario(emptyScenario('Untitled scenario', [], clock.time, 1))}>Empty</button>
          <label className="btn cursor-pointer">Import JSON…<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label></div>
        <div>
          <div className="text-slate-500 uppercase tracking-widest text-[10px] mb-1">Saved in this browser</div>
          {local.map((s) => <div key={s.id} className="flex items-center gap-2 border-b border-edge/40 py-0.5"><span className="flex-1 truncate">{s.name}</span><span className="num text-slate-500">{s.savedAt.slice(0, 19)}</span>
            <button className="btn !py-0" onClick={() => run(async () => { const f = await localGet(s.id); if (f) loadScenario(parseScenario(JSON.stringify(f))); })}>load</button>
            <button className="btn !py-0" onClick={() => run(async () => { const f = await localGet(s.id); if (f) await localPut({ ...f, id: `scn-${Math.random().toString(36).slice(2, 10)}`, name: f.name + ' (copy)', savedAt: new Date().toISOString() }); await refresh(); })}>duplicate</button>
            <button className="btn !py-0" onClick={() => run(async () => { await localDelete(s.id); await refresh(); })}>delete</button></div>)}
          {!local.length && <div className="text-slate-600">Nothing saved yet.</div>}
        </div>
        {msg && <div className="text-amber-300">{msg}</div>}
        <div className="text-slate-500">Scenario files carry a schema version (v1); older files are migrated on import and newer ones are rejected with a message. Maneuvers, deployed objects and debris are re-derived from the saved events.</div>
      </div>
    </div>
  );
}
