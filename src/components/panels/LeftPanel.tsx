import { useState, type ReactNode } from 'react';
import { useStore, type Layers } from '@/stores/store';
import { Badge } from '../common/Row';
import { tleStaleness } from '@/engine/data/tle';
import { propsOf } from '@/engine/orbital/propagate';
import { EVENT_COLORS } from '@/engine/events/EventTypes';
import { sceneRegistry } from '@/engine/cesium/registry';

function Section({ title, count, children, open = true, action }: { title: string; count?: number; children: ReactNode; open?: boolean; action?: ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <div className="border-b border-edge">
      <div className="flex items-center pr-2">
        <button className="flex-1 flex items-center gap-1 px-3 py-1.5 text-left text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-200" onClick={() => setO(!o)}>
          <span className="w-3">{o ? '▾' : '▸'}</span>{title}{count !== undefined && <span className="text-slate-600">({count})</span>}
        </button>{action}
      </div>
      {o && <div className="pb-2">{children}</div>}
    </div>
  );
}

const GROUPS: [string, [keyof Layers, string][]][] = [
  ['Display', [['satellites', 'Satellites'], ['models', '3D spacecraft models'], ['labels', 'Labels'], ['debris', 'Debris'], ['atmosphere', 'Atmosphere'], ['lighting', 'Day/night lighting (Sun)']]],
  ['Imagery (online)', [['hiresImagery', 'High-res imagery (Esri World Imagery)'], ['cityLights', 'City lights at night']]],
  ['Orbits & tracks', [['orbits', 'Orbit paths (past / future / pre-maneuver)'], ['groundTracks', 'Ground tracks'], ['nadirLine', 'Sub-satellite point / nadir']]],
  ['Sensors & attitude', [['footprints', 'Sensor cone & footprint'], ['bodyAxes', 'Body axes']]],
  ['Ground & links', [['stations', 'Ground stations'], ['visibilityCones', 'Visibility cones'], ['commLinks', 'Communication links']]],
  ['Events & analysis', [['conjunction', 'Conjunction line'], ['eventEffects', 'Burn vector / plume / impact'], ['coverage', 'Coverage heatmap'], ['saa', 'South Atlantic Anomaly (sim.)']]],
];

function Eye({ id }: { id: string }) {
  const hidden = useStore((s) => s.hidden[id]);
  const toggle = useStore((s) => s.toggleHidden);
  return <button title={hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); toggle(id); }} className={`w-4 text-center ${hidden ? 'text-slate-600' : 'text-accent'}`}>{hidden ? '○' : '●'}</button>;
}

export function LeftPanel() {
  const { satellites, selectedId, secondId, select, setSecond, removeSatellite, baseSatellites, layers, toggleLayer, clock, stations, selectedStationId, selectStation, removeStation, updateStation, setDialog, views, setViews, events, scenarioName, setEditingEvent } = useStore();
  const list = satellites.filter((s) => s.kind !== 'debris');
  const debris = satellites.filter((s) => s.kind === 'debris');
  const [openSat, setOpenSat] = useState<Record<string, boolean>>({});
  const row = (active: boolean, depth = 0) => `flex items-center gap-1 pr-2 py-[3px] cursor-pointer border-l-2 ${active ? 'bg-slate-800/70 border-accent' : 'border-transparent hover:bg-slate-800/40'} ${depth ? 'pl-9' : 'pl-3'}`;
  return (
    <div className="h-full bg-panel overflow-y-auto">
      <Section title="Object browser" count={list.length + stations.length + events.length}>
        <div className="px-3 py-1 text-slate-300 flex items-center gap-1">🌐 <span className="truncate">{scenarioName}</span></div>
        <div className="px-3 pt-1 text-[10px] uppercase tracking-widest text-slate-500 flex items-center">Satellites<span className="flex-1" /><button className="btn !py-0" onClick={() => setDialog('import')}>+</button></div>
        {list.map((s) => {
          const age = s.source.kind === 'tle' ? tleStaleness(s.epoch, clock.time) : null;
          const canRemove = baseSatellites.some((b) => b.id === s.id);
          const open = openSat[s.id] ?? selectedId === s.id;
          const kids = [`Propagator: ${s.source.kind === 'tle' ? 'SGP4' : s.source.kind === 'elements' ? 'two-body' : 'numerical'}`, ...(propsOf(s).sensorHalfAngle ? [`Sensor: ${(propsOf(s).sensorHalfAngle! * 180 / Math.PI).toFixed(0)}° half-angle`] : []), ...(s.maneuvers ?? []).map((m) => `Burn: ${m.name}`), ...(s.attitude ?? []).map((a) => `Attitude: ${a.mode}`)];
          return (
            <div key={s.id}>
              <div onClick={() => select(s.id)} className={row(selectedId === s.id)}>
                <button className="w-3 text-slate-500" onClick={(e) => { e.stopPropagation(); setOpenSat({ ...openSat, [s.id]: !open }); }}>{open ? '▾' : '▸'}</button>
                <Eye id={s.id} />
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="flex-1 truncate text-slate-100">{s.name}</span>
                {selectedId !== s.id && <button className={`text-[10px] px-1 rounded border ${secondId === s.id ? 'border-accent text-accent' : 'border-edge text-slate-500'}`} title="Use as secondary object (conjunction, relative/dual camera)" onClick={(e) => { e.stopPropagation(); setSecond(s.id); }}>2nd</button>}
                {canRemove && <button className="text-slate-500 hover:text-red-400" title="Remove" onClick={(e) => { e.stopPropagation(); removeSatellite(s.id); }}>✕</button>}
              </div>
              {open && <>
                <div className="pl-9 pr-2 flex gap-1 flex-wrap pb-0.5">
                  <Badge tone={s.origin === 'SIMULATED' ? 'sim' : 'real'}>{s.origin === 'SIMULATED' ? 'Simulated' : s.origin === 'USER_TLE' ? 'User TLE' : 'Real TLE'}</Badge>
                  {age && <Badge tone={age.level === 'fresh' ? 'ok' : age.level === 'aging' ? 'warn' : 'bad'}>TLE {age.days.toFixed(1)} d</Badge>}
                </div>
                {kids.map((k, i) => <div key={i} className="pl-9 pr-2 text-slate-500 truncate">└ {k}</div>)}
              </>}
            </div>
          );
        })}
        {debris.length > 0 && <div className="px-3 py-1 text-slate-600 flex items-center gap-1">▸ Debris ({debris.length})</div>}
        <div className="px-3 pt-2 text-[10px] uppercase tracking-widest text-slate-500 flex items-center">Facilities<span className="flex-1" /><button className="btn !py-0" onClick={() => setDialog('station')}>+</button></div>
        {stations.map((g) => (
          <div key={g.id}>
            <div onClick={() => selectStation(g.id)} className={row(selectedStationId === g.id)}>
              <span className="w-3" /><Eye id={g.id} /><span className="w-2 h-2 rotate-45 shrink-0" style={{ background: g.color }} /><span className="flex-1 truncate text-slate-100">{g.name}</span>
              <button className="text-slate-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); removeStation(g.id); }}>✕</button>
            </div>
            {selectedStationId === g.id && <div className="pl-9 pr-2 pb-1">
              <div className="num text-[10px] text-slate-500">{(g.lat * 180 / Math.PI).toFixed(4)}°N {(g.lon * 180 / Math.PI).toFixed(4)}°E · {g.alt.toFixed(0)} m</div>
              <label className="flex items-center gap-2 text-slate-400">Min el
                <input type="range" min={0} max={60} step={1} value={Math.round(g.minElevation * 180 / Math.PI)} className="flex-1" onChange={(e) => updateStation(g.id, { minElevation: Number(e.target.value) * Math.PI / 180 })} />
                <span className="num w-8 text-right">{Math.round(g.minElevation * 180 / Math.PI)}°</span></label></div>}
          </div>
        ))}
        <div className="px-3 pt-2 text-[10px] uppercase tracking-widest text-slate-500">Events</div>
        {events.map((e) => <div key={e.id} className={row(false)} onClick={() => setEditingEvent(e.id)}><span className="w-3" /><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: EVENT_COLORS[e.type] }} /><span className={`flex-1 truncate ${e.enabled ? 'text-slate-200' : 'text-slate-600 line-through'}`}>{e.name}</span></div>)}
        {!events.length && <div className="px-3 text-slate-600">none</div>}
      </Section>
      <Section title="Saved views" count={views.length} open={false} action={<button className="btn !py-0" onClick={() => { const v = sceneRegistry.scene?.saveView(`View ${views.length + 1}`); if (v) setViews([...views, v]); }}>＋</button>}>
        {views.map((v, i) => <div key={i} className="flex items-center px-3 py-0.5"><button className="flex-1 text-left text-accent" onClick={() => sceneRegistry.scene?.applyView(v)}>{v.name}</button><button className="text-slate-500 hover:text-red-400" onClick={() => setViews(views.filter((_, k) => k !== i))}>✕</button></div>)}
        {!views.length && <div className="px-3 text-slate-600">Save the current camera with ＋.</div>}
      </Section>
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-slate-500">Globe manager</div>
      {GROUPS.map(([title, items], gi) => (
        <Section key={title} title={title} open={gi < 2}>
          {items.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 px-3 py-[3px] cursor-pointer hover:bg-slate-800/40"><input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} /><span>{label}</span></label>
          ))}
        </Section>
      ))}
      <div className="px-3 py-3 text-[10px] text-slate-500 leading-relaxed">
        Base imagery: {import.meta.env.VITE_CESIUM_ION_TOKEN ? 'Cesium World Imagery (Ion)' : 'NaturalEarthII offline + NASA GIBS (online). Set VITE_CESIUM_ION_TOKEN for Cesium imagery/terrain.'}
      </div>
    </div>
  );
}
