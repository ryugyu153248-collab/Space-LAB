import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type BottomTab, type CameraMode } from '@/stores/store';
import { clock } from '@/engine/simulation/runtime';
import { sceneRegistry } from '@/engine/cesium/registry';
import { USER_EVENT_TYPES, handlers } from '@/engine/events/EventManager';
import { TIME_RATES } from '@/engine/simulation/SimulationClock';
import { localPut } from '@/engine/data/localStore';
import { downloadText, safeName } from '@/engine/exporters/files';
import { serializeScenario } from '@/engine/data/scenario';

function Menu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  return (
    <div ref={ref} className="relative">
      <button className={`px-2 py-1 rounded hover:bg-slate-800 ${open ? 'bg-slate-800 text-accent' : ''}`} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className="absolute left-0 top-full mt-1 z-40 min-w-[220px] bg-panel border border-edge rounded shadow-xl py-1" onClick={() => setOpen(false)}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
const Item = ({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) => (
  <button disabled={disabled} className="block w-full text-left px-3 py-1 hover:bg-slate-800 disabled:opacity-40" onClick={onClick}>{children}</button>
);

const CAMS: [CameraMode, string][] = [['earth', 'Earth view'], ['follow', 'Satellite follow'], ['orbit', 'Orbit view'], ['groundstation', 'Ground station view'], ['relative', 'Relative view (A→B)'], ['dual', 'Dual satellite comparison'], ['free', 'Free camera']];
const TABS: [BottomTab, string][] = [['orbit', 'Orbit charts'], ['access', 'Ground station access'], ['maneuver', 'Maneuvers'], ['conjunction', 'Conjunction & avoidance'], ['events', 'Events'], ['coverage', 'Coverage & targets'], ['telemetry', 'Telemetry (simulated)'], ['report', 'Reports & export']];

export function Toolbar() {
  const s = useStore();
  const { panels, togglePanel, setDialog, cameraMode, setCameraMode, selectedId, scenarioName, presentation, setPresentation, setBottomTab, createEvent, setEditingEvent, views, setViews } = s;
  const c = s.clock;
  const quickSave = async () => { try { await localPut(s.snapshot()); s.notify('Scenario saved to this browser'); } catch (e) { s.notify(String(e)); } };
  return (
    <div className="h-9 flex items-center gap-1 px-3 bg-panel border-b border-edge shrink-0 relative z-30">
      <span className="font-semibold tracking-[0.25em] text-accent text-[13px] mr-2">ORBITAL LAB</span>
      <Menu label="File">{() => <>
        <Item onClick={() => setDialog('scenario')}>Scenarios… (new / load / import)</Item><Item onClick={quickSave}>Save to this browser</Item>
        <Item onClick={() => downloadText(serializeScenario(s.snapshot()), `${safeName(scenarioName)}.scenario.json`, 'application/json')}>Export scenario JSON</Item></>}</Menu>
      <Menu label="Mission">{() => <><Item onClick={() => setDialog('scenario')}>Scenario manager…</Item><Item onClick={() => setBottomTab('maneuver')}>Maneuver planning</Item><Item onClick={() => setBottomTab('events')}>Mission timeline / events</Item></>}</Menu>
      <Menu label="Insert">{() => <>
        <Item onClick={() => setDialog('import')}>Satellite (TLE / elements)…</Item><Item onClick={() => setDialog('station')}>Ground station…</Item>
        <div className="px-3 pt-1 text-[10px] uppercase tracking-widest text-slate-500">Event</div>
        {USER_EVENT_TYPES.map((k) => <Item key={k} onClick={() => { const objs = k === 'collision' || k === 'docking' ? [s.selectedId, s.secondId].filter(Boolean) as string[] : s.selectedId ? [s.selectedId] : []; const e = createEvent(k, clock.time, objs); setBottomTab('events'); setEditingEvent(e.id); }}>{handlers[k].label}</Item>)}</>}</Menu>
      <Menu label="Analysis">{() => <>{TABS.map(([k, l]) => <Item key={k} onClick={() => setBottomTab(k)}>{l}</Item>)}</>}</Menu>
      <Menu label="Simulation">{() => <>
        <Item onClick={() => { clock.setReverse(false); clock.play(); }}>Play</Item><Item onClick={() => { clock.setReverse(true); clock.play(); }}>Reverse</Item><Item onClick={() => clock.pause()}>Pause</Item><Item onClick={() => clock.stop()}>Stop / reset</Item>
        <div className="px-3 pt-1 text-[10px] uppercase tracking-widest text-slate-500">Speed</div>
        {TIME_RATES.map((r) => <Item key={r} onClick={() => clock.setRate(r)}>{r}× {c.rate === r ? '✓' : ''}</Item>)}</>}</Menu>
      <Menu label="Export">{() => <><Item onClick={() => setBottomTab('report')}>Reports & data (CSV / JSON / HTML)…</Item><Item onClick={() => setDialog('capture')}>Screenshot / video / event recording…</Item></>}</Menu>
      <Menu label="Settings">{() => <>
        <Item onClick={() => setPresentation(!presentation)}>{presentation ? 'Switch to Engineering mode' : 'Presentation mode'}</Item>
        {(['left', 'right', 'bottom'] as const).map((k) => <Item key={k} onClick={() => togglePanel(k)}>{panels[k] ? 'Hide' : 'Show'} {k} panel</Item>)}</>}</Menu>
      <div className="w-px h-5 bg-edge mx-2" />
      <button className="btn" onClick={() => setDialog('import')}>+ Satellite</button>
      <select className="btn" value={cameraMode} onChange={(e) => setCameraMode(e.target.value as CameraMode)} title="Camera mode">{CAMS.map(([k, l]) => <option key={k} value={k} disabled={k === 'follow' && !selectedId}>{l}</option>)}</select>
      <button className="btn" title="Save current camera view" onClick={() => { const v = sceneRegistry.scene?.saveView(`View ${views.length + 1}`); if (v) setViews([...views, v]); }}>＋View</button>
      {views.length > 0 && <select className="btn" value="" onChange={(e) => { const v = views[Number(e.target.value)]; if (v) sceneRegistry.scene?.applyView(v); }}><option value="">Saved views…</option>{views.map((v, i) => <option key={i} value={i}>{v.name}</option>)}</select>}
      <div className="flex-1" />
      <span className="text-slate-500 text-[10px] truncate max-w-[260px]" title={scenarioName}>{scenarioName}</span>
      <span className={`text-[10px] px-1.5 rounded border ${presentation ? 'text-fuchsia-300 border-fuchsia-700' : 'text-slate-400 border-edge'}`}>{presentation ? 'PRESENTATION' : 'ENGINEERING'}</span>
      <button className="btn" onClick={() => setDialog('capture')}>● Capture</button>
      <button className={`btn ${presentation ? 'btn-on' : ''}`} onClick={() => setPresentation(!presentation)}>Present</button>
    </div>
  );
}
