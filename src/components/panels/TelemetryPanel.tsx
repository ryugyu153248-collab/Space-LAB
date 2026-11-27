import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useStore } from '@/stores/store';
import { sampleAt, simulateTelemetry } from '@/engine/telemetry/model';
import { formatUtc } from '@/engine/orbital/time';
import { Chip, Field, Sim } from '../common/ui';

export function TelemetryPanel() {
  const { satellites, selectedId, stations, settings, setSettings, layers, toggleLayer } = useStore();
  const clock = useStore((s) => s.clock);
  const sat = satellites.find((s) => s.id === selectedId);
  const res = useMemo(() => (sat ? simulateTelemetry(sat, stations, clock.start, clock.end, settings.stormLevel, 60) : null), [sat, stations, clock.start, clock.end, settings.stormLevel]);
  if (!sat || !res) return <div className="p-3 text-slate-500">Select a satellite.</div>;
  const cur = sampleAt(res, clock.time);
  const chart = (key: string, title: string, color: string, fmt: (v: number) => string, dom: [number | string, number | string] = ['auto', 'auto']) => (
    <div className="min-w-0 h-40 flex flex-col">
      <div className="px-2 text-[10px] uppercase tracking-widest text-slate-500">{title}</div>
      <div className="flex-1 min-h-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={res.samples} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}><CartesianGrid stroke="#1e293b" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toISOString().slice(5, 13)} stroke="#64748b" fontSize={10} />
        <YAxis domain={dom} stroke="#64748b" fontSize={10} width={42} tickFormatter={fmt} />
        <Line type="monotone" dataKey={key} stroke={color} dot={false} isAnimationActive={false} strokeWidth={1.2} /><ReferenceLine x={clock.time} stroke="#f43f5e" /></LineChart></ResponsiveContainer></div>
    </div>
  );
  const item = (l: string, v: string, bad = false) => <div className="flex justify-between gap-3"><span className="text-slate-400">{l}</span><span className={`num ${bad ? 'text-red-400' : 'text-slate-100'}`}>{v}</span></div>;
  return (
    <div className="text-[11px]">
      <div className="p-2 space-y-1 border-b border-edge">
        <div className="flex items-center gap-2"><span className="text-slate-100 font-semibold truncate">{sat.name}</span><Sim /></div>
        {cur && (<>
          {item('Battery', `${cur.batteryPct.toFixed(1)} % · ${cur.batteryV.toFixed(1)} V`, cur.batteryPct < 20)}
          {item('Solar power', `${cur.solarW.toFixed(0)} W (sun ${(cur.sunFraction * 100).toFixed(0)} %)`)}
          {item('Load', `${cur.loadW.toFixed(0)} W`)}
          {item('Temperature', `${cur.tempK.toFixed(0)} K`, cur.tempK > 340 || cur.tempK < 250)}
          {item('Fuel', `${cur.fuelKg.toFixed(2)} kg`)}
          {item('Thruster', cur.thrusting ? 'FIRING' : 'idle')}
          {item('Communication', cur.inContact ? 'link up' : 'no contact')}
          {item('Attitude', cur.attitude)}
          {item('SAA', cur.inSaa ? 'INSIDE zone' : 'outside', cur.inSaa)}
          {item('Dose rate', `${cur.doseRate.toFixed(0)} µGy/h`)}
        </>)}
        <Field label={`Solar storm scenario (G${settings.stormLevel})`}><input type="range" min={0} max={5} value={settings.stormLevel} onChange={(e) => setSettings({ stormLevel: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-1"><input type="checkbox" checked={layers.saa} onChange={() => toggleLayer('saa')} />Show SAA zone on globe</label>
        <div className="text-slate-500">All telemetry, SAA and radiation values are SIMULATED from simple models (assumptions in <code>telemetry/model.ts</code>); no real telemetry is used.</div>
      </div>
      <div className="border-b border-edge max-h-32 overflow-y-auto">
        <div className="px-2 py-1 text-slate-500 uppercase tracking-widest text-[10px] sticky top-0 bg-panel">Event log / warnings</div>
        {res.warnings.map((w, i) => <div key={i} className="px-2 py-0.5 border-b border-edge/40"><Chip level={w.level === 'critical' ? 'red' : 'yellow'}>{w.level}</Chip> <span className="num text-slate-400">{formatUtc(w.t).slice(5)}</span> {w.message}</div>)}
        {!res.warnings.length && <div className="px-2 py-1 text-slate-600">No threshold crossings.</div>}
      </div>
      <div className="grid grid-cols-1">{chart('batteryPct', 'Battery [%]', '#22c55e', (v) => v.toFixed(0), [0, 100])}{chart('solarW', 'Solar power [W]', '#facc15', (v) => v.toFixed(0))}{chart('tempK', 'Temperature [K]', '#fb7185', (v) => v.toFixed(0))}{chart('fuelKg', 'Fuel [kg]', '#38bdf8', (v) => v.toFixed(1))}</div>
    </div>
  );
}
