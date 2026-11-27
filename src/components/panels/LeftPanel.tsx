import { useStore, type Layers } from '@/stores/store';
import { Badge } from '../common/Row';
import { tleStaleness } from '@/engine/data/tle';

const LAYER_LABELS: [keyof Layers, string][] = [
  ['satellites', 'Satellites'], ['models', '3D spacecraft models'], ['labels', 'Labels'], ['orbits', 'Orbit paths (past / future / pre-maneuver)'],
  ['groundTracks', 'Ground tracks'], ['nadirLine', 'Sub-satellite point / nadir'], ['footprints', 'Sensor cone & footprint'], ['bodyAxes', 'Body axes (attitude)'],
  ['stations', 'Ground stations'], ['visibilityCones', 'Visibility cones (ground circle)'], ['commLinks', 'Communication links'],
  ['conjunction', 'Conjunction line'], ['debris', 'Debris'], ['eventEffects', 'Event effects (burn vector, plume, impact)'],
  ['coverage', 'Coverage heatmap'], ['saa', 'South Atlantic Anomaly (simulated)'], ['hiresImagery', 'High-res imagery (NASA GIBS, online)'], ['cityLights', 'City lights at night (online)'], ['atmosphere', 'Atmosphere'], ['lighting', 'Day/night lighting (Sun)'],
];

export function LeftPanel() {
  const { satellites, selectedId, secondId, select, setSecond, removeSatellite, baseSatellites, layers, toggleLayer, clock, stations, selectedStationId, selectStation, removeStation, updateStation, setDialog } = useStore();
  const list = satellites.filter((s) => s.kind !== 'debris');
  const debris = satellites.length - list.length;
  return (
    <div className="w-60 shrink-0 bg-panel border-r border-edge overflow-y-auto">
      <div className="sect">Satellites ({list.length}){debris > 0 && <span className="text-slate-600"> · {debris} debris</span>}</div>
      {list.map((s) => {
        const age = s.source.kind === 'tle' ? tleStaleness(s.epoch, clock.time) : null;
        const canRemove = baseSatellites.some((b) => b.id === s.id);
        return (
          <div key={s.id} onClick={() => select(s.id)}
            className={`px-3 py-1.5 cursor-pointer border-l-2 ${selectedId === s.id ? 'bg-slate-800/70 border-accent' : 'border-transparent hover:bg-slate-800/40'}`}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
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
      <div className="sect flex items-center">Ground stations ({stations.length})<span className="flex-1" /><button className="btn !py-0" onClick={() => setDialog('station')}>+</button></div>
      {stations.map((g) => (
        <div key={g.id} onClick={() => selectStation(g.id)}
          className={`px-3 py-1.5 cursor-pointer border-l-2 ${selectedStationId === g.id ? 'bg-slate-800/70 border-accent' : 'border-transparent hover:bg-slate-800/40'}`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rotate-45" style={{ background: g.color }} />
            <span className="flex-1 truncate text-slate-100">{g.name}</span>
            <button className="text-slate-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); removeStation(g.id); }}>✕</button>
          </div>
          <div className="num text-[10px] text-slate-500 mt-0.5">{(g.lat * 180 / Math.PI).toFixed(4)}°N {(g.lon * 180 / Math.PI).toFixed(4)}°E · {g.alt.toFixed(0)} m</div>
          {selectedStationId === g.id && (
            <label className="flex items-center gap-2 mt-1 text-slate-400" onClick={(e) => e.stopPropagation()}>
              Min el
              <input type="range" min={0} max={60} step={1} value={Math.round(g.minElevation * 180 / Math.PI)} className="flex-1"
                onChange={(e) => updateStation(g.id, { minElevation: Number(e.target.value) * Math.PI / 180 })} />
              <span className="num w-8 text-right">{Math.round(g.minElevation * 180 / Math.PI)}°</span>
            </label>
          )}
        </div>
      ))}
      <div className="sect">Layers</div>
      {LAYER_LABELS.map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 px-3 py-[3px] cursor-pointer hover:bg-slate-800/40">
          <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} />
          <span>{label}</span>
        </label>
      ))}
      <div className="px-3 pt-3 pb-4 text-[10px] text-slate-500 leading-relaxed">
        Imagery: {import.meta.env.VITE_CESIUM_ION_TOKEN ? 'Cesium World Imagery (Ion)' : 'NaturalEarthII (offline, low-res). Set VITE_CESIUM_ION_TOKEN for hi-res imagery/terrain.'}
      </div>
    </div>
  );
}
