import { useMemo, useState } from 'react';
import type { BurnDirection } from '@/types';
import { useStore } from '@/stores/store';
import { clock, jumpTo } from '@/engine/simulation/runtime';
import { newEvent } from '@/engine/events/EventManager';
import { burnReports, massAt, propagateBaseline, propagateSatellite, propsOf } from '@/engine/orbital/propagate';
import { derivedElements, rvToElements } from '@/engine/orbital/elements';
import { finiteBurnDuration, hohmann, planeChangeDv, propellantForDv, rocketDv } from '@/engine/orbital/maneuvers';
import { DEG, R_EARTH } from '@/engine/orbital/constants';
import { norm } from '@/engine/orbital/vec';
import { formatUtc } from '@/engine/orbital/time';
import { Field, Num, inputCls, fmtUtcInput, parseUtc } from '../common/ui';

const DIRS: BurnDirection[] = ['prograde', 'retrograde', 'radial', 'antiradial', 'normal', 'antinormal'];

export function ManeuverPanel() {
  const { satellites, selectedId, events, addEvent, removeEvent, updateEvent } = useStore();
  const t = useStore((s) => s.clock.time);
  const sat = satellites.find((s) => s.id === selectedId);
  const [kind, setKind] = useState<'impulsive' | 'finite'>('impulsive');
  const [dir, setDir] = useState<BurnDirection>('prograde');
  const [startTxt, setStartTxt] = useState('');
  const [dv, setDv] = useState(1);
  const [thrust, setThrust] = useState(100);
  const [isp, setIsp] = useState(220);
  const [alt, setAlt] = useState(800);
  const [dInc, setDInc] = useState(5);
  const [msg, setMsg] = useState('');
  const startMs = startTxt ? parseUtc(startTxt) : t;

  const mine = events.filter((e) => e.type === 'burn' && e.objects[0] === selectedId);
  const reports = useMemo(() => (sat ? burnReports(sat) : []), [sat]);
  const p = sat ? propsOf(sat) : null;
  const m0 = sat ? massAt(sat, startMs) : 0;

  if (!sat || !p) return <div className="p-3 text-slate-500">Select a satellite.</div>;
  const st0 = propagateSatellite(sat, startMs);
  const el0 = st0 ? rvToElements(st0.r, st0.v) : null;
  const r0 = st0 ? norm(st0.r) : 0;
  const hoh = el0 && el0.e < 0.02 ? hohmann(r0, R_EARTH + alt * 1000) : null;
  const dvPlane = st0 ? planeChangeDv(norm(st0.v), dInc * DEG) : 0;
  const finDur = kind === 'finite' ? finiteBurnDuration(isp, m0, thrust, dv) : 0;

  const add = (e = newEvent('burn', startMs, [sat.id])) => {
    e.params = kind === 'finite' ? { kind, direction: dir, thrust, duration: Math.round(finDur * 10) / 10, isp } : { kind, direction: dir, dv, isp };
    e.name = `${kind === 'finite' ? 'Finite' : 'Impulsive'} burn ${dir}`;
    addEvent(e);
  };
  const addHohmann = () => {
    if (!hoh) return setMsg('Hohmann needs a near-circular starting orbit (e < 0.02).');
    const up = hoh.dv1 >= 0;
    const mk = (tt: number, d: number, n: string) => { const e = newEvent('burn', tt, [sat.id]); e.name = n; e.params = { kind: 'impulsive', direction: d >= 0 ? 'prograde' : 'retrograde', dv: Math.abs(d), isp }; addEvent(e); };
    mk(startMs, hoh.dv1, `Hohmann burn 1 (${up ? 'raise' : 'lower'})`);
    mk(startMs + hoh.tof * 1000, hoh.dv2, 'Hohmann burn 2 (circularize)');
    setMsg(`Added 2 burn events; transfer takes ${(hoh.tof / 60).toFixed(1)} min. Extend the scenario window if needed.`);
  };
  const addPlane = () => {
    const e = newEvent('burn', startMs, [sat.id]); e.name = `Plane change ${dInc}°`; e.params = { kind: 'impulsive', direction: 'normal', dv: dvPlane, isp }; addEvent(e);
    setMsg('Normal burn added. A pure plane change should be executed at an orbit node (ascending/descending); the burn is applied at the start time chosen.');
  };

  const tAfter = Math.max(t, ...(sat.maneuvers ?? []).map((m) => m.start + (m.duration ?? 0) * 1000 + 60_000));
  const cmpAt = sat.maneuvers?.length ? tAfter : t;
  const rowFor = (kindLabel: 'before' | 'after') => {
    const st = kindLabel === 'before' ? propagateBaseline(sat, cmpAt) : propagateSatellite(sat, cmpAt);
    if (!st) return null;
    const el = rvToElements(st.r, st.v);
    return { el, d: derivedElements(el), model: st.model };
  };
  const before = sat.maneuvers?.length ? rowFor('before') : null, after = sat.maneuvers?.length ? rowFor('after') : null;
  const lines: [string, (x: NonNullable<typeof before>) => number, number, string][] = [
    ['a [km]', (x) => x.el.a / 1000, 3, ''], ['e', (x) => x.el.e, 6, ''], ['i [°]', (x) => x.el.i / DEG, 4, ''], ['RAAN Ω [°]', (x) => x.el.raan / DEG, 3, ''],
    ['Perigee alt [km]', (x) => x.d.perigeeAlt / 1000, 2, ''], ['Apogee alt [km]', (x) => x.d.apogeeAlt / 1000, 2, ''], ['Period [min]', (x) => x.d.period / 60, 3, ''], ['ε [MJ/kg]', (x) => x.d.specificEnergy / 1e6, 4, ''],
  ];
  const totalDv = reports.reduce((a, r) => a + r.dvAchieved, 0), used = reports.reduce((a, r) => a + r.propellantUsed, 0);

  return (
    <div className="flex h-full overflow-hidden text-[11px]">
      <div className="w-[30%] min-w-[260px] overflow-y-auto border-r border-edge p-2 space-y-2">
        <div className="text-slate-500 uppercase tracking-widest text-[10px]">New burn for {sat.name}</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as never)}><option value="impulsive">Impulsive</option><option value="finite">Finite (thrust)</option></select></Field>
          <Field label="Direction"><select className={inputCls} value={dir} onChange={(e) => setDir(e.target.value as never)}>{DIRS.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Start (UTC)" className="col-span-2"><input className={inputCls} placeholder={fmtUtcInput(t)} value={startTxt} onChange={(e) => setStartTxt(e.target.value)} /></Field>
          <Field label={kind === 'finite' ? 'Target Δv [m/s]' : 'Δv [m/s]'}><Num value={dv} onChange={setDv} /></Field>
          <Field label="Isp [s]"><Num value={isp} onChange={setIsp} /></Field>
          {kind === 'finite' && <Field label="Thrust [N]"><Num value={thrust} onChange={setThrust} /></Field>}
          {kind === 'finite' && <Field label="Duration [s] (from Δv, mass)"><span className="num">{finDur.toFixed(1)}</span></Field>}
        </div>
        <div className="text-slate-500">Mass at start {m0.toFixed(1)} kg · propellant for Δv {propellantForDv(isp, m0, dv).toFixed(2)} kg of {p.propellantKg} kg · ideal Δv from full tank {rocketDv(isp, p.massKg, p.massKg - p.propellantKg).toFixed(0)} m/s</div>
        <button className="btn btn-on" onClick={() => add()}>Add burn event</button>
        <div className="text-slate-500 uppercase tracking-widest text-[10px] pt-2">Hohmann transfer (circular → circular)</div>
        <div className="flex items-end gap-2"><Field label="Target altitude [km]" className="flex-1"><Num value={alt} onChange={setAlt} /></Field><button className="btn" onClick={addHohmann}>Add 2 burns</button></div>
        {hoh && <div className="num text-slate-300">Δv1 {hoh.dv1.toFixed(2)} · Δv2 {hoh.dv2.toFixed(2)} · Σ {hoh.total.toFixed(2)} m/s · TOF {(hoh.tof / 60).toFixed(1)} min</div>}
        <div className="text-slate-500 uppercase tracking-widest text-[10px] pt-2">Plane change</div>
        <div className="flex items-end gap-2"><Field label="Δi [°]" className="flex-1"><Num value={dInc} onChange={setDInc} /></Field><button className="btn" onClick={addPlane}>Add burn</button></div>
        <div className="num text-slate-300">Δv = 2 v sin(Δi/2) = {dvPlane.toFixed(1)} m/s</div>
        {msg && <div className="text-amber-300">{msg}</div>}
        <div className="text-slate-500">Station keeping: not implemented (no fake results).</div>
      </div>
      <div className="w-[26%] min-w-[220px] overflow-y-auto border-r border-edge">
        <div className="px-2 py-1 text-slate-500 uppercase tracking-widest text-[10px] sticky top-0 bg-panel">Burns ({mine.length})</div>
        {mine.map((e) => {
          const r = reports.find((x) => x.id === e.id);
          return (
            <div key={e.id} className={`px-2 py-1 border-b border-edge/50 ${e.enabled ? '' : 'opacity-50'}`}>
              <div className="flex gap-1 items-center"><button className="text-accent text-left flex-1 truncate" onClick={() => jumpTo(e.start)}>{e.name}</button>
                <button className="btn !py-0" onClick={() => updateEvent(e.id, { enabled: !e.enabled })}>{e.enabled ? 'on' : 'off'}</button>
                <button className="text-slate-500 hover:text-red-400" onClick={() => removeEvent(e.id)}>✕</button></div>
              <div className="num text-slate-400">{formatUtc(e.start)}</div>
              <div className="num text-slate-300">{e.params.kind === 'finite' ? `${e.params.thrust} N × ${e.params.duration} s` : `${e.params.dv} m/s`} {String(e.params.direction)}{r ? ` · Δv ${r.dvAchieved.toFixed(3)} · −${r.propellantUsed.toFixed(2)} kg${r.truncated ? ' ⚠ tank empty' : ''}` : ''}</div>
            </div>
          );
        })}
        {!mine.length && <div className="p-2 text-slate-600">No burns.</div>}
        {reports.length > 0 && <div className="p-2 num text-slate-300 border-t border-edge">Σ Δv {totalDv.toFixed(3)} m/s · propellant {used.toFixed(2)} kg · remaining mass {reports[reports.length - 1].massAfter.toFixed(1)} kg</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-slate-500 uppercase tracking-widest text-[10px]">Orbit comparison {before ? `@ ${formatUtc(cmpAt)}` : ''}</div>
        {before && after ? (
          <table className="w-full num"><thead className="text-slate-500 text-left"><tr><th>Element</th><th>Before ({before.model === 'NUMERICAL' ? 'numerical, no burns' : before.model})</th><th>After ({after.model})</th><th>Δ</th></tr></thead>
            <tbody>{lines.map(([l, f, d]) => { const a = f(before), b = f(after); return <tr key={l}><td>{l}</td><td>{a.toFixed(d)}</td><td>{b.toFixed(d)}</td><td className={b - a === 0 ? '' : 'text-accent'}>{(b - a >= 0 ? '+' : '') + (b - a).toFixed(d)}</td></tr>; })}</tbody></table>
        ) : <div className="text-slate-600">Add and enable a burn to compare. “Before” = same dynamics without burns, so Δ is caused by the burns only. The 3D view draws it as a white dashed orbit.</div>}
        <div className="text-slate-500 pt-2">After a burn, the TLE/elements are NOT reused: a numerical trajectory (RK4, {sat.dynamics?.j2 ?? sat.source.kind !== 'elements' ? 'two-body + J2' : 'two-body'}{sat.dynamics?.drag ? ' + drag' : ''}) starts from the state at burn time.</div>
        <button className="btn mt-2" onClick={() => clock.setTime(tAfter)}>Go to end of burns</button>
      </div>
    </div>
  );
}
