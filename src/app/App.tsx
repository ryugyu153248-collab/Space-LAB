import { lazy, Suspense, useEffect, useRef } from 'react';
import { Toolbar } from '@/components/layout/Toolbar';
import { LeftPanel } from '@/components/panels/LeftPanel';
import { RightDock } from '@/components/layout/RightDock';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { ModelViewOverlay } from '@/components/layout/ModelViewOverlay';
import { TimelineBar } from '@/components/timeline/TimelineBar';
import { Map2D } from '@/components/layout/Map2D';
import { TimelineView } from '@/components/timeline/TimelineView';
import { OrbitCharts } from '@/components/charts/OrbitCharts';
import { AccessPanel } from '@/components/panels/AccessPanel';
import { TelemetryPanel } from '@/components/panels/TelemetryPanel';
import { StationDialog } from '@/components/dialogs/StationDialog';
import { ImportDialog } from '@/components/dialogs/ImportDialog';
import { ScenarioDialog } from '@/components/dialogs/ScenarioDialog';
import { CaptureDialog } from '@/components/dialogs/CaptureDialog';
import { EventEditor } from '@/components/dialogs/EventEditor';
import { useStore, type BottomTab } from '@/stores/store';
import { formatUtc } from '@/engine/orbital/time';
import { propagateSatellite } from '@/engine/orbital/propagate';
import { ecefToGeodetic, eciToEcef } from '@/engine/orbital/frames';

// Cesium is large: load it as its own chunk so the shell paints first.
const CesiumView = lazy(() => import('@/components/layout/CesiumView').then((m) => ({ default: m.CesiumView })));

const BOTTOM_TABS: [BottomTab, string][] = [['timeline', 'Timeline view'], ['orbit', 'Orbit charts'], ['access', 'Ground access'], ['telemetry', 'Telemetry (sim.)']];

function PresentationOverlay() {
  const { satellites, selectedId, events, setCameraMode } = useStore();
  const t = useStore((s) => s.clock.time);
  const sat = satellites.find((s) => s.id === selectedId);
  const ev = events.find((e) => e.enabled && t >= e.start && t < (e.end ?? e.start + 600_000));
  const lastEv = useRef<string | null>(null);
  // automatic camera: dual view for collision/docking events, follow for others
  useEffect(() => {
    if (ev && lastEv.current !== ev.id) { lastEv.current = ev.id; setCameraMode(ev.type === 'collision' || ev.type === 'docking' ? 'dual' : 'follow'); }
    if (!ev) lastEv.current = null;
  }, [ev, setCameraMode]);
  const st = sat ? propagateSatellite(sat, t) : null;
  const g = st ? ecefToGeodetic(eciToEcef(st.r, t)) : null;
  return (
    <div className="absolute left-4 bottom-4 pointer-events-none text-slate-100 space-y-1">
      <div className="num text-2xl font-semibold drop-shadow">{formatUtc(t)}</div>
      {sat && g && <div className="num drop-shadow">{sat.name} · alt {(g.alt / 1000).toFixed(1)} km · {(g.lat * 180 / Math.PI).toFixed(2)}°, {(g.lon * 180 / Math.PI).toFixed(2)}° · {sat.origin === 'SIMULATED' ? 'SIMULATED' : 'element set ' + formatUtc(sat.epoch).slice(0, 10)}</div>}
      {ev && <div className="num text-lg text-amber-300 drop-shadow">▶ {ev.name}</div>}
    </div>
  );
}

export function App() {
  const { panels, sizes, setSize, bottomTab, setBottomTab, presentation, uiHidden, modelView, toast, notify, mapMode, setMapMode } = useStore();
  const bare = uiHidden || presentation || modelView; // canvas-only layouts
  useEffect(() => { if (toast) { const id = setTimeout(() => notify(null), 3500); return () => clearTimeout(id); } }, [toast, notify]);
  useEffect(() => { // Esc leaves model view / presentation
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { const s = useStore.getState(); if (s.modelView) s.setModelView(false); else if (s.presentation) s.setPresentation(false); } };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, []);
  return (
    <div className="h-full flex flex-col relative">
      {!bare && <Toolbar />}
      <div className="flex-1 flex min-h-0">
        {!bare && panels.left && <><aside style={{ width: sizes.left }} className="shrink-0 min-h-0 border-r border-edge"><LeftPanel /></aside><ResizeHandle dir="x" onDrag={(d) => setSize('left', sizes.left + d)} /></>}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 flex">
            <div className={`relative min-w-0 ${mapMode === '2d' && !bare ? 'hidden' : 'flex-1'}`}>
              <Suspense fallback={<div className="p-4 text-slate-400">Loading 3D engine…</div>}><CesiumView /></Suspense>
              {presentation && !uiHidden && <><PresentationOverlay /><button className="absolute top-2 right-2 z-40 btn" onClick={() => useStore.getState().setPresentation(false)}>Exit presentation</button></>}
              {modelView && !uiHidden && <ModelViewOverlay />}
              {!bare && <div className="absolute right-2 top-2 flex gap-1 z-10">{(['3d', 'split', '2d'] as const).map((m) => <button key={m} className={`btn ${mapMode === m ? 'btn-on' : ''}`} onClick={() => setMapMode(m)}>{m === '3d' ? '3D' : m === '2d' ? '2D' : '3D + 2D'}</button>)}</div>}
            </div>
            {!bare && mapMode !== '3d' && <>{mapMode === 'split' && <ResizeHandle dir="x" onDrag={(d) => setSize('map', sizes.map - d)} />}<div style={mapMode === 'split' ? { width: sizes.map } : undefined} className={`min-w-0 relative ${mapMode === '2d' ? 'flex-1' : 'shrink-0'}`}><Map2D />{mapMode === '2d' && <div className="absolute right-2 top-2 flex gap-1 z-10">{(['3d', 'split', '2d'] as const).map((m) => <button key={m} className={`btn ${mapMode === m ? 'btn-on' : ''}`} onClick={() => setMapMode(m)}>{m === '3d' ? '3D' : m === '2d' ? '2D' : '3D + 2D'}</button>)}</div>}</div></>}
          </div>
          {!bare && (
            <div className="shrink-0 bg-panel border-t border-edge">
              <TimelineBar />
              {panels.bottom && (
                <>
                  <ResizeHandle dir="y" onDrag={(d) => setSize('bottom', sizes.bottom - d)} />
                  <div className="flex gap-1 px-2 pt-1 overflow-x-auto">
                    {BOTTOM_TABS.map(([k, l]) => <button key={k} className={`px-3 py-0.5 text-[11px] border-b-2 whitespace-nowrap ${bottomTab === k ? 'text-accent border-accent' : 'text-slate-500 border-transparent'}`} onClick={() => setBottomTab(k)}>{l}</button>)}
                  </div>
                  <div style={{ height: sizes.bottom }} className="overflow-hidden">
                    {bottomTab === 'timeline' && <TimelineView />}{bottomTab === 'orbit' && <OrbitCharts />}{bottomTab === 'access' && <AccessPanel />}{bottomTab === 'telemetry' && <TelemetryPanel />}
                  </div>
                </>
              )}
            </div>
          )}
        </main>
        {!bare && panels.right && <><ResizeHandle dir="x" onDrag={(d) => setSize('right', sizes.right - d)} /><aside style={{ width: sizes.right }} className="shrink-0 min-h-0 border-l border-edge"><RightDock /></aside></>}
      </div>
      <ImportDialog /><StationDialog /><ScenarioDialog /><CaptureDialog /><EventEditor />
      {toast && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-accent text-slate-100 px-3 py-1.5 rounded z-50">{toast}</div>}
    </div>
  );
}
