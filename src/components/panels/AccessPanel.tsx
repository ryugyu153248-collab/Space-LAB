import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useAccess } from '@/hooks/useAccess';
import { useStore } from '@/stores/store';
import { jumpTo } from '@/engine/simulation/runtime';
import { eciToEcef } from '@/engine/orbital/frames';
import { lookAngles } from '@/engine/orbital/lookangles';
import { propagateSatellite } from '@/engine/orbital/propagate';
import { DEG } from '@/engine/orbital/constants';
import { formatUtc } from '@/engine/orbital/time';

const hhmmss = (ms: number) => new Date(ms).toISOString().slice(5, 19).replace('T', ' ');

export function AccessPanel() {
  const { sat, stn, result } = useAccess();
  const t = useStore((s) => s.clock.time);
  const HOUR = 3_600_000;
  const centre = Math.round(t / HOUR) * HOUR;

  const series = useMemo(() => {
    if (!sat || !stn) return [];
    const out: { t: number; el: number }[] = [];
    for (let k = -3 * HOUR; k <= 3 * HOUR; k += 30_000) {
      const tk = centre + k;
      const st = propagateSatellite(sat, tk);
      if (st) out.push({ t: tk, el: lookAngles(stn, eciToEcef(st.r, tk)).el / DEG });
    }
    return out;
  }, [sat, stn, centre]);

  if (!sat || !stn || !result) return <div className="p-3 text-slate-500">Select a satellite and a ground station.</div>;

  return (
    <div className="flex h-full">
      <div className="w-[56%] overflow-y-auto border-r border-edge">
        <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-slate-500 sticky top-0 bg-panel">
          Access: {sat.name} ↔ {stn.name} · mask {(stn.minElevation / DEG).toFixed(1)}° · {result.passes.length} passes · geometric line-of-sight (no terrain/refraction)
        </div>
        <table className="w-full num text-[11px]">
          <thead className="text-slate-500 text-left sticky top-5 bg-panel">
            <tr><th className="px-2">#</th><th>AOS (UTC)</th><th>LOS (UTC)</th><th>Dur [s]</th><th>Max el [°]</th><th>AOS az [°]</th><th>LOS az [°]</th><th>Min rng [km]</th></tr>
          </thead>
          <tbody>
            {result.passes.map((p, i) => {
              const active = t >= p.aos && t <= p.los;
              return (
                <tr key={i} onClick={() => jumpTo(p.aos)} title="Jump to AOS"
                  className={`cursor-pointer hover:bg-slate-800/60 ${active ? 'bg-emerald-900/30 text-emerald-300' : ''}`}>
                  <td className="px-2">{i + 1}</td>
                  <td>{p.clippedStart ? '≤ ' : ''}{hhmmss(p.aos)}</td>
                  <td>{hhmmss(p.los)}{p.clippedEnd ? ' ≥' : ''}</td>
                  <td>{p.duration.toFixed(0)}</td>
                  <td>{(p.maxEl / DEG).toFixed(1)}</td>
                  <td>{(p.aosAz / DEG).toFixed(1)}</td>
                  <td>{(p.losAz / DEG).toFixed(1)}</td>
                  <td>{(p.minRange / 1000).toFixed(0)}</td>
                </tr>
              );
            })}
            {result.passes.length === 0 && <tr><td colSpan={8} className="px-3 py-2 text-slate-500">No passes in {formatUtc(result.windowStart)} … {formatUtc(result.windowEnd)}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-3 pt-1 text-[10px] uppercase tracking-widest text-slate-500">Elevation vs Time (UTC) [°] · red = sim clock · amber = mask</div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toISOString().slice(11, 16)} stroke="#64748b" fontSize={10} />
              <YAxis domain={[-90, 90]} ticks={[-90, -45, 0, 45, 90]} stroke="#64748b" fontSize={10} width={36} />
              <Line type="monotone" dataKey="el" stroke="#22c55e" dot={false} isAnimationActive={false} strokeWidth={1.5} />
              <ReferenceLine y={stn.minElevation / DEG} stroke="#f59e0b" strokeDasharray="4 3" />
              <ReferenceLine x={t} stroke="#f43f5e" strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
