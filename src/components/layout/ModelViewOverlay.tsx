import { useStore } from '@/stores/store';
import { clock } from '@/engine/simulation/runtime';
import { TIME_RATES } from '@/engine/simulation/SimulationClock';
import { MODEL_LABEL, modelKindFor } from '@/engine/cesium/models/templates';
import { formatUtc } from '@/engine/orbital/time';
import { propagateSatellite } from '@/engine/orbital/propagate';
import { ecefToGeodetic, eciToEcef } from '@/engine/orbital/frames';
import { norm } from '@/engine/orbital/vec';

/** Full-screen "model view": the 3D canvas fills the window, the selected spacecraft is framed close-up. */
export function ModelViewOverlay() {
  const { satellites, selectedId, select, setModelView } = useStore();
  const c = useStore((s) => s.clock);
  const list = satellites.filter((s) => s.kind !== 'debris');
  const sat = list.find((s) => s.id === selectedId) ?? list[0];
  if (!sat) return null;
  const idx = list.indexOf(sat);
  const st = propagateSatellite(sat, c.time);
  const g = st ? ecefToGeodetic(eciToEcef(st.r, c.time)) : null;
  const step = (d: number) => select(list[(idx + d + list.length) % list.length].id);
  return (
    <>
      <div className="absolute left-4 top-4 bg-panel/75 backdrop-blur border border-edge rounded-lg px-4 py-3 max-w-[340px] pointer-events-auto">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: sat.color }} /><span className="text-lg font-semibold text-slate-100 truncate">{sat.name}</span></div>
        <div className="text-accent text-[11px] mt-0.5">{MODEL_LABEL[modelKindFor(sat)]} <span className="text-slate-500">(simplified model)</span></div>
        <div className="text-slate-400 text-[11px]">{sat.origin === 'SIMULATED' ? 'SIMULATED data' : `Real element set · epoch ${formatUtc(sat.epoch).slice(0, 10)}`}{sat.noradId ? ` · NORAD ${sat.noradId}` : ''}</div>
        {st && g && <div className="num text-[11px] text-slate-300 mt-2 space-y-0.5">
          <div>Alt {(g.alt / 1000).toFixed(1)} km · {(g.lat * 180 / Math.PI).toFixed(2)}°, {(g.lon * 180 / Math.PI).toFixed(2)}°</div>
          <div>Speed {(norm(st.v) / 1000).toFixed(3)} km/s · {st.model}</div></div>}
        <div className="text-[10px] text-slate-500 mt-2 flex gap-3"><span><b className="text-red-400">━</b> X along-track</span><span><b className="text-green-400">━</b> Y array axis</span><span><b className="text-blue-400">━</b> Z nadir</span></div>
        <div className="text-[10px] text-slate-600 mt-1">Drag = rotate · wheel = zoom · right-drag = pan</div>
      </div>
      <button className="btn absolute right-4 top-4 pointer-events-auto" onClick={() => setModelView(false)}>✕ Exit model view</button>
      <div className="absolute left-1/2 -translate-x-1/2 bottom-4 flex items-center gap-2 bg-panel/75 backdrop-blur border border-edge rounded-lg px-3 py-2 pointer-events-auto">
        <button className="btn" onClick={() => step(-1)} disabled={list.length < 2}>◀ Prev</button>
        <button className={`btn ${c.playing ? 'btn-on' : ''}`} onClick={() => (c.playing ? clock.pause() : (clock.setReverse(false), clock.play()))}>{c.playing ? '❚❚ Pause' : '▶ Play'}</button>
        <select className="btn" value={c.rate} onChange={(e) => clock.setRate(Number(e.target.value))}>{TIME_RATES.map((r) => <option key={r} value={r}>{r}×</option>)}</select>
        <span className="num text-slate-200 w-44 text-center">{formatUtc(c.time)}</span>
        <button className="btn" onClick={() => step(1)} disabled={list.length < 2}>Next ▶</button>
      </div>
    </>
  );
}
