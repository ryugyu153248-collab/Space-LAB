import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useStore } from '@/stores/store';
import { clock, jumpTo } from '@/engine/simulation/runtime';
import { propsOf } from '@/engine/orbital/propagate';
import { computeTargetWindows, offNadir, type CoverageResult } from '@/engine/analysis/coverage';
import { runCoverage } from '@/engine/analysis/coverageRunner';
import { DEG } from '@/engine/orbital/constants';
import { formatUtc } from '@/engine/orbital/time';
import { Busy, Field, Num, inputCls } from '../common/ui';

function heatCanvas(r: CoverageResult, scale = 6): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = r.nLon * scale; cv.height = r.nLat * scale;
  const ctx = cv.getContext('2d')!;
  const max = Math.max(1, ...r.passes);
  for (let i = 0; i < r.nLat; i++) for (let j = 0; j < r.nLon; j++) {
    const p = r.passes[i * r.nLon + j];
    if (!p) continue;
    const f = p / max; // sequential ramp: dark blue → cyan → yellow
    const col = f < 0.5 ? `rgb(${Math.round(30 + 40 * f)},${Math.round(80 + 280 * f)},${Math.round(200 - 60 * f)})` : `rgb(${Math.round(255 * (f - 0.5) * 2)},${Math.round(220 + 35 * (f - 0.5))},${Math.round(130 - 130 * (f - 0.5) * 2)})`;
    ctx.fillStyle = col;
    ctx.fillRect(j * scale, (r.nLat - 1 - i) * scale, scale, scale);
  }
  return cv;
}

export function CoveragePanel() {
  const { satellites, selectedId, updateSatellite, setHeatmap, heatmap, target, setTarget, pickMode, setPickMode, baseSatellites } = useStore();
  const t = useStore((s) => s.clock.time);
  const sat = satellites.find((s) => s.id === selectedId);
  const [half, setHalf] = useState(sat ? (propsOf(sat).sensorHalfAngle ?? 20 * DEG) / DEG : 20);
  const [grid, setGrid] = useState(5);
  const [step, setStep] = useState(60);
  const [region, setRegion] = useState({ latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 });
  const [all, setAll] = useState(false);
  const [prog, setProg] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [tl, setTl] = useState({ lat: target?.lat ?? 13.7563, lon: target?.lon ?? 100.5018 });
  const [radius, setRadius] = useState(target?.radiusKm ?? 0);
  const tgt = target ?? tl;

  const setSensor = () => { if (sat && baseSatellites.some((b) => b.id === sat.id)) updateSatellite(sat.id, { props: { ...propsOf(sat), sensorHalfAngle: half * DEG } }); };
  const analyze = async () => {
    if (!sat) return;
    setErr(''); setProg(0);
    try {
      const list = (all ? satellites.filter((s) => s.kind !== 'debris') : [sat]);
      const halfAngles: Record<string, number> = {};
      list.forEach((s) => (halfAngles[s.id] = s.id === sat.id ? half * DEG : propsOf(s).sensorHalfAngle ?? half * DEG));
      const c = clock.snapshot();
      const res = await runCoverage({ sats: list, halfAngles, t0: c.start, t1: c.end, stepSec: step, gridDeg: grid, region }, setProg);
      setHeatmap({ result: res, canvas: heatCanvas(res), rect: { west: region.lonMin, south: region.latMin, east: region.lonMax, north: region.latMax }, label: `${list.map((s) => s.name).join(', ')} · half-angle ${half}° · nadir` });
    } catch (e) { setErr(String(e)); }
    setProg(null);
  };
  const h = heatmap?.result;

  const windows = useMemo(() => {
    if (!sat) return [];
    const c = clock.snapshot();
    return computeTargetWindows(sat, { lat: tgt.lat * DEG, lon: tgt.lon * DEG, alt: 0 }, half * DEG, c.start, c.end, 20, radius * 1000);
  }, [sat, tgt.lat, tgt.lon, half, radius]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => {
    if (!sat) return [];
    const out: { t: number; off: number | null }[] = [];
    const c = clock.snapshot();
    for (let k = c.start; k <= c.end; k += 120_000) { const o = offNadir(sat, { lat: tgt.lat * DEG, lon: tgt.lon * DEG, alt: 0 }, k); out.push({ t: k, off: o ? Math.min(90, o.off / DEG) : null }); }
    return out;
  }, [sat, tgt.lat, tgt.lon]);

  if (!sat) return <div className="p-3 text-slate-500">Select a satellite.</div>;
  return (
    <div className="flex h-full overflow-hidden text-[11px]">
      <div className="w-[34%] min-w-[290px] overflow-y-auto border-r border-edge p-2 space-y-2">
        <div className="text-slate-500 uppercase tracking-widest text-[10px]">Global / regional coverage — nadir conic sensor</div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Half-angle [°]"><Num value={half} onChange={setHalf} /></Field>
          <Field label="Grid [°]"><select className={inputCls} value={grid} onChange={(e) => setGrid(Number(e.target.value))}>{[2, 5, 10].map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Time step [s]"><Num value={step} onChange={setStep} /></Field>
          {(['latMin', 'latMax', 'lonMin', 'lonMax'] as const).map((k) => <Field key={k} label={k}><Num value={region[k]} onChange={(v) => setRegion({ ...region, [k]: v })} /></Field>)}
        </div>
        <div className="flex items-center gap-2 flex-wrap"><button className="btn" onClick={setSensor}>Set as satellite sensor</button>
          <label className="flex gap-1 items-center"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />all satellites</label>
          <button className="btn btn-on" disabled={prog !== null} onClick={analyze}>Analyze coverage</button>
          {prog !== null && <Busy text={`Calculating ${(prog * 100).toFixed(0)} % (Web Worker)`} />}</div>
        {err && <div className="text-red-400">{err}</div>}
        {h && heatmap && (<div className="num space-y-0.5">
          <div className="text-slate-400">{heatmap.label}</div>
          <div>Coverage (area-weighted): <b className="text-accent">{h.coveragePct.toFixed(1)} %</b></div>
          <div>Mean revisit: {isFinite(h.meanRevisitSec) ? (h.meanRevisitSec / 3600).toFixed(2) + ' h' : '—'} · max gap (worst cell): {(Math.max(...h.maxGapSec) / 3600).toFixed(1)} h</div>
          <div>Observation frequency: max {Math.max(...h.passes)} passes / {(h.windowSec / 86400).toFixed(1)} d in one cell</div>
          <button className="btn" onClick={() => setHeatmap(null)}>Clear heatmap</button>
        </div>)}
        <div className="text-slate-500">Geometry from propagated states; nadir pointing only; revisit counts distinct observation passes within the scenario window.</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <div className="text-slate-500 uppercase tracking-widest text-[10px]">Interactive target analysis</div>
        <div className="flex items-end gap-2 flex-wrap">
          <Field label="Lat [°]"><Num className="w-24" value={tgt.lat} onChange={(v) => { setTl({ ...tgt, lat: v }); setTarget({ lat: v, lon: tgt.lon, radiusKm: radius }); }} /></Field>
          <Field label="Lon [°]"><Num className="w-24" value={tgt.lon} onChange={(v) => { setTl({ ...tgt, lon: v }); setTarget({ lat: tgt.lat, lon: v, radiusKm: radius }); }} /></Field>
          <Field label="Area radius [km] (0 = point)"><Num className="w-24" value={radius} onChange={(v) => { setRadius(v); setTarget({ lat: tgt.lat, lon: tgt.lon, radiusKm: v }); }} /></Field>
          <button className={`btn ${pickMode ? 'btn-on' : ''}`} onClick={() => setPickMode(!pickMode)}>{pickMode ? 'Click on the globe…' : 'Pick target on globe'}</button>
          <button className="btn" onClick={() => setTarget({ lat: tgt.lat, lon: tgt.lon, radiusKm: radius })}>Show target</button>
          <span className="text-slate-500">Observed when the target (point, or circular area of the given radius — overlap with the footprint) is inside the sensor cone ({half}° half-angle, nadir) and above the horizon.</span>
        </div>
        <div className="flex gap-3">
          <div className="w-1/2 max-h-40 overflow-y-auto"><table className="w-full num"><thead className="text-slate-500 text-left"><tr><th>#</th><th>Start</th><th>Dur [s]</th><th>Min off-nadir [°]</th><th>Range [km]</th></tr></thead><tbody>
            {windows.map((w, i) => <tr key={i} className="cursor-pointer hover:bg-slate-800/60" onClick={() => jumpTo(w.tMin)}><td>{i + 1}</td><td>{formatUtc(w.start)}</td><td>{w.duration.toFixed(0)}</td><td>{(w.minOffNadir / DEG).toFixed(1)}</td><td>{(w.rangeAtMin / 1000).toFixed(0)}</td></tr>)}
            {!windows.length && <tr><td colSpan={5} className="text-slate-600 py-1">No observation windows.</td></tr>}</tbody></table>
            <div className="num text-slate-300 pt-1">{windows.length} windows · total {windows.reduce((a, w) => a + w.duration, 0).toFixed(0)} s</div></div>
          <div className="flex-1 h-36"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}><CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toISOString().slice(5, 13)} stroke="#64748b" fontSize={10} /><YAxis domain={[0, 90]} stroke="#64748b" fontSize={10} width={28} />
            <Line type="monotone" dataKey="off" stroke="#e879f9" dot={false} isAnimationActive={false} strokeWidth={1.2} connectNulls={false} /><ReferenceLine y={half} stroke="#f59e0b" strokeDasharray="4 3" /><ReferenceLine x={t} stroke="#f43f5e" /></LineChart></ResponsiveContainer>
            <div className="text-center text-slate-500 text-[10px]">Off-nadir angle to target vs time (amber = sensor half-angle, gaps = below horizon)</div></div>
        </div>
      </div>
    </div>
  );
}
