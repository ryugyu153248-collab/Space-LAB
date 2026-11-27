import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '@/stores/store';
import { periodAt, sampleEphemeris, stepForPeriod } from '@/engine/orbital/ephemeris';
import { formatUtc } from '@/engine/orbital/time';

/** Window is recomputed only when the clock leaves the central half of the cached window. */
export function OrbitCharts() {
  const { satellites, selectedId, clock } = useStore();
  const sat = satellites.find((s) => s.id === selectedId);
  const t = clock.time;
  const P = sat ? periodAt(sat, t) : null;
  const span = P ? P * 1000 : 0;
  // quantise window centre to a quarter period so the memo only recomputes occasionally
  const centre = span ? Math.round(t / (span / 4)) * (span / 4) : 0;

  const data = useMemo(() => {
    if (!sat || !P) return [];
    return sampleEphemeris(sat, centre - span, centre + span, stepForPeriod(P, 120)).map((p) => ({
      t: p.t, alt: p.geo.alt / 1000, speed: p.speed / 1000,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sat?.id, sat?.source, centre, span]);

  if (!sat || !data.length) return <div className="p-3 text-slate-500">No data</div>;
  const tick = (v: number) => new Date(v).toISOString().slice(11, 16);
  const chart = (key: 'alt' | 'speed', title: string, unit: string, color: string) => (
    <div className="flex-1 min-w-0 h-full flex flex-col">
      <div className="px-3 pt-1 text-[10px] uppercase tracking-widest text-slate-500">{title} [{unit}] · {sat.name}</div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tick} stroke="#64748b" fontSize={10} />
            <YAxis domain={['auto', 'auto']} stroke="#64748b" fontSize={10} width={48} tickFormatter={(v) => v.toFixed(key === 'alt' ? 0 : 3)} />
            <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #1e293b' }} labelFormatter={(v) => formatUtc(Number(v))}
              formatter={(v) => [`${Number(v).toFixed(3)} ${unit}`, title]} />
            <Line type="monotone" dataKey={key} stroke={color} dot={false} isAnimationActive={false} strokeWidth={1.5} />
            <ReferenceLine x={t} stroke="#f43f5e" strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
  return (
    <div className="flex h-full">
      {chart('alt', 'Altitude vs Time (UTC, WGS84)', 'km', '#38bdf8')}
      {chart('speed', 'Inertial speed vs Time (UTC)', 'km/s', '#a3e635')}
    </div>
  );
}
