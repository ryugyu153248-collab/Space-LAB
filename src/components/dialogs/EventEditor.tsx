import { useEffect, useState } from 'react';
import { useStore } from '@/stores/store';
import { EVENT_COLORS, type SimEvent } from '@/engine/events/EventTypes';
import { handlers } from '@/engine/events/EventManager';
import { planRendezvous } from '@/engine/analysis/rendezvous';
import { newEvent } from '@/engine/events/EventManager';
import { Field, Num, inputCls, fmtUtcInput, parseUtc } from '../common/ui';

const DIRS = ['prograde', 'retrograde', 'radial', 'antiradial', 'normal', 'antinormal'];
const MODES = ['nadir', 'sun', 'target', 'inertial'];

export function EventEditor() {
  const { editingEvent, events, satellites, updateEvent, setEditingEvent, removeEvent, addEvent, eventInfo } = useStore();
  const ev = events.find((e) => e.id === editingEvent);
  const [draft, setDraft] = useState<SimEvent | null>(null);
  const [startTxt, setStartTxt] = useState('');
  const [msg, setMsg] = useState('');
  const [transfer, setTransfer] = useState(2800);
  useEffect(() => { setDraft(ev ? { ...ev, params: { ...ev.params } } : null); setStartTxt(ev ? fmtUtcInput(ev.start) : ''); setMsg(''); }, [editingEvent]); // eslint-disable-line
  if (!ev || !draft) return null;
  const P = (k: string, v: number | string | boolean | undefined) => setDraft({ ...draft, params: { ...draft.params, [k]: v } });
  const pn = (k: string, d = 0) => (typeof draft.params[k] === 'number' ? (draft.params[k] as number) : d);
  const nObj = draft.type === 'collision' || draft.type === 'docking' ? 2 : 1;
  const real = satellites.filter((s) => s.kind !== 'debris');
  const objSel = (i: number) => (
    <select className={inputCls} value={draft.objects[i] ?? ''} onChange={(e) => { const o = [...draft.objects]; o[i] = e.target.value; setDraft({ ...draft, objects: o }); }}>
      <option value="">—</option>{real.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
  const save = () => {
    const t = parseUtc(startTxt);
    if (!isFinite(t)) return setMsg('Start time must be a valid UTC date, e.g. 2026-01-15 03:00:00');
    updateEvent(draft.id, { ...draft, start: t }); setEditingEvent(null);
  };
  const plan = () => {
    const chaser = satellites.find((s) => s.id === draft.objects[0]), target = satellites.find((s) => s.id === draft.objects[1]);
    const t = parseUtc(startTxt);
    if (!chaser || !target || !isFinite(t)) return setMsg('Pick chaser and target and a valid docking time first.');
    // strip previously planned rendezvous burns of this event, plan against the chaser's current derived orbit
    const p = planRendezvous(chaser, target, t - transfer * 1000, transfer);
    if (!p) return setMsg('Cannot plan: no valid states.');
    p.burns.forEach((b, i) => { const e = newEvent('burn', b.start, [chaser.id]); e.name = `${b.name} (${i + 1})`; e.params = { kind: 'impulsive', direction: b.direction, dv: b.dv, isp: b.isp }; e.dependsOn = []; addEvent(e); });
    setMsg(`Planned 2-impulse CW rendezvous: Δv1 ${p.dv1.toFixed(3)} + Δv2 ${p.dv2.toFixed(3)} = ${p.total.toFixed(3)} m/s over ${transfer} s (linear model; actual miss is shown by the docking check).`);
  };
  const info = eventInfo[ev.id];

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditingEvent(null)}>
      <div className="w-[560px] max-w-[96vw] max-h-[90vh] overflow-y-auto bg-panel border border-edge rounded-lg p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: EVENT_COLORS[draft.type] }} /><span className="text-slate-100 font-semibold">{handlers[draft.type].label}</span>
          {handlers[draft.type].affectsOrbit && <span className="text-[10px] text-amber-300 border border-amber-700 rounded px-1">changes orbit → recompute</span>}</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name"><input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Start (UTC)"><input className={inputCls} value={startTxt} onChange={(e) => setStartTxt(e.target.value)} /></Field>
          <Field label={nObj === 2 ? (draft.type === 'docking' ? 'Chaser' : 'Object A') : 'Satellite'}>{objSel(0)}</Field>
          {nObj === 2 && <Field label={draft.type === 'docking' ? 'Target' : 'Object B'}>{objSel(1)}</Field>}
          <Field label="Priority"><Num value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} /></Field>
          <Field label="Depends on">
            <select multiple className={inputCls + ' h-14'} value={draft.dependsOn} onChange={(e) => setDraft({ ...draft, dependsOn: [...e.target.selectedOptions].map((o) => o.value) })}>
              {events.filter((x) => x.id !== draft.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        </div>
        {draft.type === 'burn' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Kind"><select className={inputCls} value={String(draft.params.kind)} onChange={(e) => P('kind', e.target.value)}><option value="impulsive">impulsive</option><option value="finite">finite</option></select></Field>
            <Field label="Direction"><select className={inputCls} value={String(draft.params.direction)} onChange={(e) => P('direction', e.target.value)}>{DIRS.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Isp [s]"><Num value={pn('isp', 220)} onChange={(v) => P('isp', v)} /></Field>
            {draft.params.kind === 'finite' ? (<><Field label="Thrust [N]"><Num value={pn('thrust')} onChange={(v) => P('thrust', v)} /></Field><Field label="Duration [s]"><Num value={pn('duration')} onChange={(v) => P('duration', v)} /></Field></>) : <Field label="Δv [m/s]"><Num value={pn('dv')} onChange={(v) => P('dv', v)} /></Field>}
          </div>)}
        {draft.type === 'attitude' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Mode"><select className={inputCls} value={String(draft.params.mode)} onChange={(e) => P('mode', e.target.value)}>{MODES.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Slew time [s]"><Num value={pn('slewSec', 60)} onChange={(v) => P('slewSec', v)} /></Field>
            {draft.params.mode === 'target' && <><Field label="Target lat [°]"><Num value={pn('lat')} onChange={(v) => P('lat', v)} /></Field><Field label="Target lon [°]"><Num value={pn('lon')} onChange={(v) => P('lon', v)} /></Field></>}
          </div>)}
        {draft.type === 'deployment' && (
          <div className="grid grid-cols-4 gap-2">
            <Field label="Name"><input className={inputCls} value={String(draft.params.name ?? '')} onChange={(e) => P('name', e.target.value)} /></Field>
            <Field label="Separation Δv [m/s]"><Num value={pn('dv', 1)} onChange={(v) => P('dv', v)} /></Field>
            <Field label="Direction"><select className={inputCls} value={String(draft.params.direction)} onChange={(e) => P('direction', e.target.value)}>{DIRS.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Mass [kg]"><Num value={pn('massKg', 20)} onChange={(v) => P('massKg', v)} /></Field>
          </div>)}
        {draft.type === 'collision' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Fragments"><Num value={pn('fragments', 60)} onChange={(v) => P('fragments', v)} /></Field>
            <Field label="Ejection spread [m/s rms]"><Num value={pn('spreadMps', 150)} onChange={(v) => P('spreadMps', v)} /></Field>
            <Field label="Seed"><Num value={pn('seed', 1)} onChange={(v) => P('seed', v)} /></Field>
            <div className="col-span-3 text-amber-300 text-[11px]">Simplified debris model (isotropic Gaussian ejection about the centre-of-mass velocity, momentum conserving). Not an engineering break-up model.</div>
          </div>)}
        {draft.type === 'docking' && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Max range [m]"><Num value={pn('maxRange', 10)} onChange={(v) => P('maxRange', v)} /></Field>
            <Field label="Max rel. speed [m/s]"><Num value={pn('maxRelSpeed', 0.1)} onChange={(v) => P('maxRelSpeed', v)} /></Field>
            <Field label="Transfer time [s]"><Num value={transfer} onChange={setTransfer} /></Field>
            <div className="col-span-3 flex items-center gap-2"><button className="btn" onClick={plan}>Plan CW rendezvous burns</button><span className="text-[11px] text-amber-300">Prototype: criteria check only (range / relative speed at docking time); no contact dynamics.</span></div>
          </div>)}
        {draft.type === 'reentry' && (
          <div className="grid grid-cols-4 gap-2">
            <Field label="Deorbit Δv [m/s]"><Num value={pn('dv')} onChange={(v) => P('dv', v)} /></Field>
            <Field label="Direction"><select className={inputCls} value={String(draft.params.direction)} onChange={(e) => P('direction', e.target.value)}>{DIRS.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Cd"><Num value={pn('cd', 2.2)} onChange={(v) => P('cd', v)} /></Field>
            <Field label="Area [m²]"><Num value={pn('area', 4)} onChange={(v) => P('area', v)} /></Field>
            <div className="col-span-4 text-[11px] text-slate-500">Enables drag (Vallado exponential atmosphere) and integrates until 100 km altitude. Simplified: no heating/breakup, no ground impact point.</div>
          </div>)}
        {info?.messages.length ? <ul className="text-[11px] text-amber-300 list-disc pl-4">{info.messages.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
        {msg && <div className="text-[11px] text-slate-300">{msg}</div>}
        <div className="flex gap-2 justify-between pt-1">
          <button className="btn" onClick={() => { removeEvent(ev.id); }}>Delete</button>
          <div className="flex gap-2"><button className="btn" onClick={() => setEditingEvent(null)}>Cancel</button><button className="btn btn-on" onClick={save}>Save</button></div>
        </div>
      </div>
    </div>
  );
}
