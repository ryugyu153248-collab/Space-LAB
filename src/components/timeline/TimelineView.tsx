import { useMemo, useRef } from 'react';
import { useStore } from '@/stores/store';
import { clock, jumpTo } from '@/engine/simulation/runtime';
import { computeEclipses } from '@/engine/analysis/eclipse';
import { computeAccess } from '@/engine/analysis/access';
import { screenConjunctions } from '@/engine/analysis/conjunction';
import { EVENT_COLORS } from '@/engine/events/EventTypes';
import { burnReports } from '@/engine/orbital/propagate';
import { formatUtc } from '@/engine/orbital/time';

interface Bar { s: number; e: number; color: string; label: string }
interface Mark { t: number; color: string; label: string }
interface Row { label: string; sub?: string; bars: Bar[]; marks: Mark[] }

const HOUR = 3_600_000;

/**
 * STK-style "Timeline View": availability bars computed from geometry — sunlight / shadow per satellite, access intervals per
 * satellite–station pair, burns, scheduled events and conjunction TCAs — with a draggable "now" cursor tied to the Simulation Clock.
 */
export function TimelineView() {
  const { satellites, stations, events, selectedId, secondId, hidden } = useStore();
  const c = useStore((s) => s.clock);
  const track = useRef<HTMLDivElement>(null);
  const span = c.end - c.start;
  const tooLong = span > 3 * 86_400_000;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [{ label: 'Scenario', sub: 'availability', bars: [{ s: c.start, e: c.end, color: '#eab308', label: `${formatUtc(c.start)} → ${formatUtc(c.end)}` }], marks: [] }];
    if (tooLong) return out;
    const sats = satellites.filter((s) => s.kind !== 'debris' && !hidden[s.id]).slice(0, 6);
    for (const s of sats) {
      const ecl = computeEclipses(s, c.start, c.end, 60);
      const lit: Bar[] = []; let cur = c.start;
      for (const x of ecl) { if (x.start > cur) lit.push({ s: cur, e: x.start, color: '#facc15', label: 'Sunlight' }); cur = x.end; }
      if (cur < c.end) lit.push({ s: cur, e: c.end, color: '#facc15', label: 'Sunlight' });
      const shadow: Bar[] = ecl.flatMap((x) => [{ s: x.start, e: x.end, color: '#64748b', label: 'Penumbra' } as Bar, ...(x.umbraStart ? [{ s: x.umbraStart, e: x.umbraEnd!, color: '#1e293b', label: 'Umbra' } as Bar] : [])]);
      out.push({ label: s.name, sub: 'sunlight / umbra', bars: [...lit, ...shadow], marks: [] });
      for (const g of stations.filter((x) => !hidden[x.id]).slice(0, 3)) {
        const r = computeAccess(s, g, c.start, c.end);
        out.push({ label: `${s.name} → ${g.name}`, sub: 'access', bars: r.passes.map((p) => ({ s: p.aos, e: p.los, color: '#22c55e', label: `Access ${(p.duration / 60).toFixed(1)} min · max el ${(p.maxEl * 180 / Math.PI).toFixed(0)}°` })), marks: [] });
      }
      if (s.maneuvers?.length) {
        const reps = burnReports(s);
        out.push({ label: s.name, sub: 'maneuvers', bars: reps.filter((r) => r.end > r.start).map((r) => ({ s: r.start, e: r.end, color: '#f97316', label: r.name })), marks: (s.maneuvers ?? []).map((m) => ({ t: m.start, color: '#f97316', label: `${m.name} (${m.kind})` })) });
      }
    }
    if (events.length) out.push({ label: 'Events', sub: 'scheduled', bars: [], marks: events.filter((e) => e.enabled).map((e) => ({ t: e.start, color: EVENT_COLORS[e.type], label: `${e.name} (${e.type})` })) });
    const a = satellites.find((s) => s.id === selectedId), b = satellites.find((s) => s.id === secondId);
    if (a && b) out.push({ label: `${a.name} × ${b.name}`, sub: 'close approaches < 20 km', bars: [], marks: screenConjunctions(a, [b], c.start, c.end, { screenDistance: 20_000, stepSec: 60 }).map((x) => ({ t: x.tca, color: '#f43f5e', label: `TCA ${formatUtc(x.tca)} · miss ${(x.miss / 1000).toFixed(2)} km` })) });
    return out;
  }, [satellites, stations, events, selectedId, secondId, hidden, c.start, c.end, tooLong]);

  const pct = (t: number) => `${((t - c.start) / span) * 100}%`;
  const ticks = useMemo(() => {
    const step = [1, 2, 3, 6, 12, 24].map((h) => h * HOUR).find((s) => span / s <= 12) ?? 24 * HOUR;
    const out: number[] = []; for (let t = Math.ceil(c.start / step) * step; t <= c.end; t += step) out.push(t);
    return out;
  }, [c.start, c.end, span]);

  const seek = (e: React.PointerEvent) => { const r = track.current!.getBoundingClientRect(); clock.setTime(c.start + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * span); };
  const down = (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); seek(e); const mv = (ev: PointerEvent) => seek(ev as never); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); };

  return (
    <div className="h-full flex flex-col text-[11px]">
      <div className="flex shrink-0 border-b border-edge">
        <div className="w-[200px] shrink-0 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-500">Timeline view</div>
        <div ref={track} className="relative flex-1 h-6 cursor-ew-resize select-none" onPointerDown={down}>
          {ticks.map((t) => <div key={t} className="absolute top-0 h-full border-l border-edge pl-1 text-[10px] text-slate-500 num whitespace-nowrap" style={{ left: pct(t) }}>{new Date(t).toISOString().slice(5, 16).replace('T', ' ')}</div>)}
          <div className="absolute top-0 h-full w-[2px] bg-rose-500" style={{ left: pct(c.time) }} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto relative">
        {tooLong && <div className="p-2 text-amber-300">Window is longer than 3 days — only availability is drawn (shorten the scenario to see sunlight / access / event rows).</div>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-stretch border-b border-edge/40 hover:bg-slate-800/30">
            <div className="w-[200px] shrink-0 px-2 py-[3px] truncate" title={`${r.label} — ${r.sub ?? ''}`}><span className="text-slate-200">{r.label}</span> <span className="text-slate-500">{r.sub}</span></div>
            <div className="relative flex-1 h-[22px]" onPointerDown={down}>
              {r.bars.map((b, k) => <div key={k} title={`${b.label}\n${formatUtc(b.s)} → ${formatUtc(b.e)}`} className="absolute top-[3px] h-[16px] border-x border-black/30" style={{ left: pct(b.s), width: `max(2px, ${((b.e - b.s) / span) * 100}%)`, background: b.color }} />)}
              {r.marks.map((m, k) => <button key={k} title={`${m.label}\n${formatUtc(m.t)}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => jumpTo(m.t)} className="absolute top-[2px] w-[7px] h-[18px] rounded-sm hover:scale-125" style={{ left: `calc(${pct(m.t)} - 3px)`, background: m.color }} />)}
              <div className="absolute top-0 h-full w-[2px] bg-rose-500/80 pointer-events-none" style={{ left: pct(c.time) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
