import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type AnyTab, type CameraMode } from '@/stores/store';
import { clock } from '@/engine/simulation/runtime';
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

const CAMS: [CameraMode, string][] = [['earth', 'Earth overview (Thailand)'], ['thailand', 'Thailand close view'], ['leo', 'Low Earth orbit view'], ['follow', 'Satellite follow'], ['closeup', 'Model close-up'], ['orbit', 'Orbit view'], ['groundstation', 'Ground station view'], ['relative', 'Relative satellite view (A→B)'], ['dual', 'Dual satellite comparison'], ['coverage', 'Global coverage view'], ['free', 'Free camera']];
const TABS: [AnyTab, string][] = [['info', 'Properties (right)'], ['maneuver', 'Maneuvers (right)'], ['conjunction', 'Conjunction & avoidance (right)'], ['events', 'Events (right)'], ['coverage', 'Coverage & targets (right)'], ['report', 'Reports & export (right)'], ['telemetry', 'Telemetry — simulated (right)'], ['orbit', 'Orbit charts (bottom)'], ['access', 'Ground station access (bottom)']];

export function Toolbar() {
  const s = useStore();
  const { panels, togglePanel, setDialog, cameraMode, setCameraMode, selectedId, scenarioName, presentation, setPresentation, setBottomTab, createEvent, setEditingEvent, setModelView } = s;
  const c = s.clock;
  void setBottomTab;
  const quickSave = async () => { try { await localPut(s.snapshot()); s.notify('Scenario saved to this browser'); } catch (e) { s.notify(String(e)); } };
  return (
    <div className="h-9 flex items-center gap-1 px-3 bg-panel border-b border-edge shrink-0 relative z-30">
      <span className="font-semibold tracking-[0.25em] text-accent text-[13px] mr-2">SPACE LAB</span>
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
        {(['left', 'right', 'bottom'] as const).map((k) => <Item key={k} onClick={() => togglePanel(k)}>{panels[k] ? 'Hide' : 'Show'} {k} panel</Item>)}
        <Item onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}>Browser full screen</Item></>}</Menu>
      <div className="w-px h-5 bg-edge mx-2" />
      <select className="btn" value={cameraMode} onChange={(e) => setCameraMode(e.target.value as CameraMode)} title="Camera mode">{CAMS.map(([k, l]) => <option key={k} value={k} disabled={(k === 'follow' || k === 'closeup' || k === 'leo') && !selectedId}>{l}</option>)}</select>
      <button className="btn" title="Show / hide all side panels (simple ⇄ engineering layout)" onClick={() => { const any = panels.left || panels.right || panels.bottom; useStore.setState({ panels: { left: !any, right: !any, bottom: !any } }); }}>☰ Panels</button>
      <button className="btn btn-on" disabled={!selectedId} title="Full-screen view of the selected spacecraft model" onClick={() => setModelView(true)}>🛰 Model view</button>
      <div className="flex-1" />
      <span className="text-slate-500 text-[10px] truncate max-w-[200px] hidden 2xl:inline" title={scenarioName}>{scenarioName}</span>
      
      <button className="btn" onClick={() => setDialog('capture')}>● Capture</button>
      <button className={`btn ${presentation ? 'btn-on' : ''}`} onClick={() => setPresentation(!presentation)}>Present</button>
    </div>
  );
}
