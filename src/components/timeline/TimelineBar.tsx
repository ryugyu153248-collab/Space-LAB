import { useMemo } from 'react';
import { clock, jumpTo } from '@/engine/simulation/runtime';
import { TIME_RATES } from '@/engine/simulation/SimulationClock';
import { formatUtc } from '@/engine/orbital/time';
import { useStore } from '@/stores/store';
import { EVENT_COLORS, type EventType } from '@/engine/events/EventTypes';
import { computeEclipses } from '@/engine/analysis/eclipse';
import { useAccess } from '@/hooks/useAccess';
import { screenConjunctions } from '@/engine/analysis/conjunction';

interface Marker { t: number; type: EventType | 'conjunction'; label: string }
const COLORS: Record<string, string> = { ...EVENT_COLORS, conjunction: '#f43f5e' };

export function TimelineBar() {
  const c = useStore((s) => s.clock);
  const { events, satellites, selectedId, secondId, panels } = useStore();
  const showMarks = panels.bottom;
  const { sat, result } = useAccess();
  // computed event markers (eclipse entries, access AOS, conjunction TCA) — only when the window is ≤ 3 days to keep this cheap
  const markers = useMemo<Marker[]>(() => {
    const m: Marker[] = events.filter((e) => e.enabled).map((e) => ({ t: e.start, type: e.type, label: e.name }));
    if (showMarks && c.end - c.start <= 3 * 86_400_000) {
      if (sat) computeEclipses(sat, c.start, c.end, 60).forEach((x) => m.push({ t: x.start, type: 'eclipse', label: `Eclipse entry (${sat.name})` }));
      result?.passes.forEach((p) => m.push({ t: p.aos, type: 'access', label: `AOS ${sat?.name}` }));
      const a = satellites.find((s) => s.id === selectedId), b = satellites.find((s) => s.id === secondId);
      if (a && b) screenConjunctions(a, [b], c.start, c.end, { screenDistance: 20_000, stepSec: 60 }).forEach((x) => m.push({ t: x.tca, type: 'conjunction', label: `TCA miss ${(x.miss / 1000).toFixed(2)} km` }));
    }
    return m;
  }, [events, sat, result, satellites, selectedId, secondId, c.start, c.end, showMarks]);
  const span = c.end - c.start;
  return (
    <div className="px-3 py-1.5 border-b border-edge bg-panel space-y-1">
      <div className="flex items-center gap-2">
        <button className={`btn ${c.playing && c.reverse ? 'btn-on' : ''}`} title="Play reverse" onClick={() => { clock.setReverse(true); clock.play(); }}>◀ Rev</button>
        <button className={`btn ${c.playing && !c.reverse ? 'btn-on' : ''}`} title="Play" onClick={() => { clock.setReverse(false); clock.play(); }}>▶ Play</button>
        <button className="btn" onClick={() => clock.pause()}>❚❚ Pause</button>
        <button className="btn" onClick={() => clock.stop()}>■ Stop</button>
        <button className="btn" onClick={() => clock.reset()}>⟲ Reset</button>
        <select className="btn" value={c.rate} onChange={(e) => clock.setRate(Number(e.target.value))} title="Time speed">{TIME_RATES.map((r) => <option key={r} value={r}>{r}×</option>)}</select>
        <div className="flex-1 relative h-6">
          <input type="range" className="absolute inset-x-0 top-0 w-full" min={c.start} max={c.end} step={1000} value={c.time} onChange={(e) => clock.setTime(Number(e.target.value))} />
          {showMarks && markers.map((m, i) => (
            <button key={i} title={`${m.label} · ${formatUtc(m.t)}`} onClick={() => jumpTo(m.t)} className="absolute top-4 w-[5px] h-2 rounded-sm hover:scale-150"
              style={{ left: `calc(${((m.t - c.start) / span) * 100}% - 2px)`, background: COLORS[m.type] }} />
          ))}
        </div>
        <span className="num text-slate-100 w-48 text-right">{formatUtc(c.time)}</span>
        <button className="btn" title="Set simulation time to current UTC" onClick={() => jumpTo(Date.now())}>Now</button>
        {satellites[0] && <button className="btn" onClick={() => jumpTo(satellites[0].epoch)}>Epoch</button>}
      </div>
      {showMarks && <div className="flex gap-3 text-[10px] text-slate-500 pl-1">
        {(['burn', 'eclipse', 'collision', 'deployment', 'access', 'docking', 'attitude', 'conjunction'] as const).map((k) => <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COLORS[k] }} />{k === 'conjunction' ? 'TCA' : k}</span>)}
        <span>— click a marker to jump</span>
      </div>}
    </div>
  );
}
