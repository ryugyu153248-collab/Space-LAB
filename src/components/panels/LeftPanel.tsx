import { useState, type ReactNode } from 'react';
import { useStore, type Layers } from '@/stores/store';
import { Badge } from '../common/Row';
import { tleStaleness } from '@/engine/data/tle';
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
  ['Imagery (online)', [['hiresImagery', 'High-res imagery (NASA GIBS)'], ['cityLights', 'City lights at night']]],
  ['Orbits & tracks', [['orbits', 'Orbit paths (past / future / pre-maneuver)'], ['groundTracks', 'Ground tracks'], ['nadirLine', 'Sub-satellite point / nadir']]],
  ['Sensors & attitude', [['footprints', 'Sensor cone & footprint'], ['bodyAxes', 'Body axes']]],
  ['Ground & links', [['stations', 'Ground stations'], ['visibilityCones', 'Visibility cones'], ['commLinks', 'Communication links']]],
  ['Events & analysis', [['conjunction', 'Conjunction line'], ['eventEffects', 'Burn vector / plume / impact'], ['coverage', 'Coverage heatmap'], ['saa', 'South Atlantic Anomaly (sim.)']]],
];

export function LeftPanel() {
  const { satellites, selectedId, secondId, select, setSecond, removeSatellite, baseSatellites, layers, toggleLayer, clock, stations, selectedStationId, selectStation, removeStation, updateStation, setDialog, views, setViews } = useStore();
  const list = satellites.filter((s) => s.kind !== 'debris');
  const debris = satellites.length - list.length;
  return (
    <div className="h-full bg-panel overflow-y-auto">
      <Section title="Satellites" count={list.length} action={<button className="btn !py-0" onClick={() => setDialog('import')}>+</button>}>
        {list.map((s) => {
          const age = s.source.kind === 'tle' ? tleStaleness(s.epoch, clock.time) : null;
          const canRemove = baseSatellites.some((b) => b.id === s.id);
          return (
            <div key={s.id} onClick={() => select(s.id)} className={`px-3 py-1.5 cursor-pointer border-l-2 ${selectedId === s.id ? 'bg-slate-800/70 border-accent' : 'border-transparent hover:bg-slate-800/40'}`}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="flex-1 truncate text-slate-100">{s.name}</span>
                {selectedId !== s.id && <button className={`text-[10px] px-1 rounded border ${secondId === s.id ? 'border-accent text-accent' : 'border-edge text-slate-500'}`} title="Use as secondary object (conjunction, relative/dual camera)" onClick={(e) => { e.stopPropagation(); setSecond(s.id); }}>2nd</button>}
                {canRemove && <button className="text-slate-500 hover:text-red-400" title="Remove" onClick={(e) => { e.stopPropagation(); removeSatellite(s.id); }}>✕</button>}
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                <Badge tone={s.origin === 'SIMULATED' ? 'sim' : 'real'}>{s.origin === 'SIMULATED' ? 'Simulated' : s.origin === 'USER_TLE' ? 'User TLE' : 'Real TLE'}</Badge>
                {age && <Badge tone={age.level === 'fresh' ? 'ok' : age.level === 'aging' ? 'warn' : 'bad'}>TLE {age.days.toFixed(1)} d</Badge>}
                {!!s.maneuvers?.length && <Badge tone="warn">{s.maneuvers.length} burn{s.maneuvers.length > 1 ? 's' : ''}</Badge>}
              </div>
            </div>
          );
        })}
        {debris > 0 && <div className="px-3 py-1 text-slate-600">+ {debris} debris objects</div>}
      </Section>
      <Section title="Ground stations" count={stations.length} action={<button className="btn !py-0" onClick={() => setDialog('station')}>+</button>}>
        {stations.map((g) => (
          <div key={g.id} onClick={() => selectStation(g.id)} className={`px-3 py-1.5 cursor-pointer border-l-2 ${selectedStationId === g.id ? 'bg-slate-800/70 border-accent' : 'border-transparent hover:bg-slate-800/40'}`}>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rotate-45 shrink-0" style={{ background: g.color }} /><span className="flex-1 truncate text-slate-100">{g.name}</span>
              <button className="text-slate-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); removeStation(g.id); }}>✕</button></div>
            <div className="num text-[10px] text-slate-500 mt-0.5">{(g.lat * 180 / Math.PI).toFixed(4)}°N {(g.lon * 180 / Math.PI).toFixed(4)}°E · {g.alt.toFixed(0)} m</div>
            {selectedStationId === g.id && (
              <label className="flex items-center gap-2 mt-1 text-slate-400" onClick={(e) => e.stopPropagation()}>Min el
                <input type="range" min={0} max={60} step={1} value={Math.round(g.minElevation * 180 / Math.PI)} className="flex-1" onChange={(e) => updateStation(g.id, { minElevation: Number(e.target.value) * Math.PI / 180 })} />
                <span className="num w-8 text-right">{Math.round(g.minElevation * 180 / Math.PI)}°</span></label>)}
          </div>
        ))}
      </Section>
      <Section title="Saved views" count={views.length} open={false} action={<button className="btn !py-0" onClick={() => { const v = sceneRegistry.scene?.saveView(`View ${views.length + 1}`); if (v) setViews([...views, v]); }}>＋</button>}>
        {views.map((v, i) => <div key={i} className="flex items-center px-3 py-0.5"><button className="flex-1 text-left text-accent" onClick={() => sceneRegistry.scene?.applyView(v)}>{v.name}</button><button className="text-slate-500 hover:text-red-400" onClick={() => setViews(views.filter((_, k) => k !== i))}>✕</button></div>)}
        {!views.length && <div className="px-3 text-slate-600">Save the current camera with ＋.</div>}
      </Section>
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
