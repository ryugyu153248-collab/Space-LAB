import { create } from 'zustand';
import type { ClassicalElements, GroundStation, Satellite } from '@/types';
import { clock } from '@/engine/simulation/runtime';
import type { ClockSnapshot } from '@/engine/simulation/SimulationClock';
import { forgetSatellite } from '@/engine/orbital/propagate';
import { nextColor, satelliteFromTle, type ParsedTle } from '@/engine/data/tle';
import { deriveScenario, newEvent } from '@/engine/events/EventManager';
import type { EventStatus, EventType, SimEvent } from '@/engine/events/EventTypes';
import { SCHEMA_VERSION, type CameraView, type ScenarioFile } from '@/engine/data/scenario';
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, buildCollisionDemo } from '@/engine/data/demoFile';
import type { CoverageResult } from '@/engine/analysis/coverage';
import type { CameraMode } from '@/engine/cesium/CesiumScene';

export type Layers = Record<'satellites' | 'labels' | 'orbits' | 'groundTracks' | 'nadirLine' | 'atmosphere' | 'lighting' | 'stations' | 'visibilityCones' | 'commLinks' | 'debris' | 'saa' | 'coverage' | 'eventEffects' | 'bodyAxes' | 'footprints' | 'conjunction' | 'models' | 'hiresImagery' | 'cityLights', boolean>;
export type { CameraMode };
export type BottomTab = 'orbit' | 'access' | 'telemetry';
export type RightTab = 'info' | 'maneuver' | 'conjunction' | 'events' | 'coverage' | 'report';
export type AnyTab = BottomTab | RightTab;
const RIGHT_TABS: RightTab[] = ['info', 'maneuver', 'conjunction', 'events', 'coverage', 'report'];
export type Dialog = null | 'import' | 'station' | 'scenario' | 'export' | 'capture';

export interface Settings { stormLevel: number; covPrimary: number; covSecondary: number; hbr: number; useCovariance: boolean }
export interface EventInfo { status: EventStatus; messages: string[] }
export interface Heatmap { result: CoverageResult; canvas: HTMLCanvasElement; rect: { west: number; south: number; east: number; north: number }; label: string }

interface State {
  scenarioId: string;
  scenarioName: string;
  baseSatellites: Satellite[];
  events: SimEvent[];
  /** derived: base + events applied (maneuvers, deployed objects, debris…) */
  satellites: Satellite[];
  eventInfo: Record<string, EventInfo>;
  stations: GroundStation[];
  selectedId: string | null;
  secondId: string | null;
  selectedStationId: string | null;
  layers: Layers;
  clock: ClockSnapshot;
  cameraMode: CameraMode;
  views: CameraView[];
  panels: { left: boolean; right: boolean; bottom: boolean };
  bottomTab: BottomTab;
  rightTab: RightTab;
  sizes: { left: number; right: number; bottom: number };
  modelView: boolean;
  dialog: Dialog;
  editingEvent: string | null;
  settings: Settings;
  heatmap: Heatmap | null;
  target: { lat: number; lon: number } | null;
  pickMode: boolean;
  conjunctionPair: [string, string] | null;
  presentation: boolean;
  uiHidden: boolean;
  toast: string | null;

  addTles: (tles: ParsedTle[], source?: { origin: Satellite['origin']; provenance: string }) => void;
  addSimulated: (el: ClassicalElements, name: string, epoch: number) => void;
  removeSatellite: (id: string) => void;
  updateSatellite: (id: string, patch: Partial<Satellite>) => void;
  select: (id: string | null) => void;
  setSecond: (id: string | null) => void;
  addStation: (g: Omit<GroundStation, 'id' | 'color'>) => void;
  updateStation: (id: string, patch: Partial<GroundStation>) => void;
  removeStation: (id: string) => void;
  selectStation: (id: string | null) => void;
  addEvent: (e: SimEvent) => void;
  createEvent: (type: EventType, start: number, objects: string[]) => SimEvent;
  updateEvent: (id: string, patch: Partial<SimEvent>) => void;
  removeEvent: (id: string) => void;
  duplicateEvent: (id: string) => void;
  toggleLayer: (k: keyof Layers) => void;
  setCameraMode: (m: CameraMode) => void;
  setViews: (v: CameraView[]) => void;
  togglePanel: (k: 'left' | 'right' | 'bottom') => void;
  setBottomTab: (t: AnyTab) => void;
  setRightTab: (t: RightTab) => void;
  setSize: (k: 'left' | 'right' | 'bottom', v: number) => void;
  setModelView: (b: boolean) => void;
  setDialog: (d: Dialog) => void;
  setEditingEvent: (id: string | null) => void;
  setSettings: (p: Partial<Settings>) => void;
  setHeatmap: (h: Heatmap | null) => void;
  setTarget: (t: { lat: number; lon: number } | null) => void;
  setPickMode: (b: boolean) => void;
  setConjunctionPair: (p: [string, string] | null) => void;
  setPresentation: (b: boolean) => void;
  setUiHidden: (b: boolean) => void;
  notify: (m: string | null) => void;
  loadScenario: (f: ScenarioFile) => void;
  snapshot: () => ScenarioFile;
}

const STATION_COLORS = ['#22c55e', '#f59e0b', '#ec4899', '#06b6d4'];
const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

function derive(base: Satellite[], events: SimEvent[]) {
  const c = clock.snapshot();
  const d = deriveScenario(base, events, c.end, c.time);
  return { satellites: d.satellites, eventInfo: d.status };
}

const demo = buildCollisionDemo();
clock.setRange(demo.clock.start, demo.clock.end, demo.clock.time);
const firstDerived = derive(demo.satellites, demo.events);

export const useStore = create<State>((set, get) => ({
  scenarioId: demo.id, scenarioName: demo.name, baseSatellites: demo.satellites, events: demo.events,
  ...firstDerived,
  stations: demo.stations, selectedId: demo.satellites[0].id, secondId: demo.satellites[1]?.id ?? null, selectedStationId: demo.stations[0]?.id ?? null,
  layers: { ...DEFAULT_LAYERS } as Layers, clock: clock.snapshot(), cameraMode: 'earth', views: [],
  panels: { left: true, right: true, bottom: true }, bottomTab: 'orbit', rightTab: 'info', sizes: { left: 250, right: 400, bottom: 200 }, modelView: false, dialog: null, editingEvent: null,
  settings: { ...DEFAULT_SETTINGS }, heatmap: null, target: null, pickMode: false, conjunctionPair: [demo.satellites[0].id, demo.satellites[1].id],
  presentation: false, uiHidden: false, toast: null,

  addTles: (tles, source) => set((s) => {
    const added = tles.map((t) => satelliteFromTle(t, source?.origin ?? 'USER_TLE', source?.provenance ?? 'User-supplied TLE (imported)'));
    const base = [...s.baseSatellites, ...added];
    return { baseSatellites: base, ...derive(base, s.events), selectedId: added[0]?.id ?? s.selectedId };
  }),
  addSimulated: (elements, name, epoch) => set((s) => {
    const sat: Satellite = { id: rid('sim'), name, source: { kind: 'elements', elements, epoch }, origin: 'SIMULATED', provenance: 'Simulated – analytic two-body, user-defined classical elements', epoch, color: nextColor() };
    const base = [...s.baseSatellites, sat];
    return { baseSatellites: base, ...derive(base, s.events), selectedId: sat.id };
  }),
  removeSatellite: (id) => set((s) => {
    forgetSatellite(id);
    const base = s.baseSatellites.filter((x) => x.id !== id);
    const events = s.events.filter((e) => !e.objects.includes(id));
    const d = derive(base, events);
    return { baseSatellites: base, events, ...d, selectedId: s.selectedId === id ? base[0]?.id ?? null : s.selectedId, secondId: s.secondId === id ? null : s.secondId };
  }),
  updateSatellite: (id, patch) => set((s) => { const base = s.baseSatellites.map((x) => (x.id === id ? { ...x, ...patch } : x)); return { baseSatellites: base, ...derive(base, s.events) }; }),
  select: (id) => set({ selectedId: id }),
  setSecond: (id) => set({ secondId: id }),
  addStation: (g) => set((s) => {
    const st: GroundStation = { ...g, id: rid('gs'), color: STATION_COLORS[s.stations.length % STATION_COLORS.length] };
    return { stations: [...s.stations, st], selectedStationId: st.id };
  }),
  updateStation: (id, patch) => set((s) => ({ stations: s.stations.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  removeStation: (id) => set((s) => {
    const stations = s.stations.filter((x) => x.id !== id);
    return { stations, selectedStationId: s.selectedStationId === id ? stations[0]?.id ?? null : s.selectedStationId };
  }),
  selectStation: (selectedStationId) => set({ selectedStationId }),
  addEvent: (e) => set((s) => { const events = [...s.events, e]; return { events, ...derive(s.baseSatellites, events) }; }),
  createEvent: (type, start, objects) => { const e = newEvent(type, start, objects); get().addEvent(e); return e; },
  updateEvent: (id, patch) => set((s) => { const events = s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)); return { events, ...derive(s.baseSatellites, events) }; }),
  removeEvent: (id) => set((s) => {
    const events = s.events.filter((e) => e.id !== id).map((e) => ({ ...e, dependsOn: e.dependsOn.filter((d) => d !== id) }));
    return { events, ...derive(s.baseSatellites, events), editingEvent: s.editingEvent === id ? null : s.editingEvent };
  }),
  duplicateEvent: (id) => set((s) => {
    const src = s.events.find((e) => e.id === id);
    if (!src) return {};
    const copy: SimEvent = { ...src, id: rid('ev'), name: `${src.name} (copy)`, params: { ...src.params }, dependsOn: [], start: src.start + 60_000 };
    const events = [...s.events, copy];
    return { events, ...derive(s.baseSatellites, events) };
  }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setViews: (views) => set({ views }),
  togglePanel: (k) => set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } })),
  // function panels (forms/tables) live in the right dock, time-series in the bottom dock
  setBottomTab: (t) => RIGHT_TABS.includes(t as RightTab)
    ? set({ rightTab: t as RightTab, panels: { ...get().panels, right: true } })
    : set({ bottomTab: t as BottomTab, panels: { ...get().panels, bottom: true } }),
  setRightTab: (rightTab) => set({ rightTab, panels: { ...get().panels, right: true } }),
  setSize: (k, v) => set((s) => ({ sizes: { ...s.sizes, [k]: Math.round(Math.min(k === 'bottom' ? 520 : 760, Math.max(k === 'bottom' ? 120 : 200, v))) } })),
  setModelView: (modelView) => set((s) => ({ modelView, cameraMode: modelView ? 'closeup' : s.cameraMode === 'closeup' ? 'earth' : s.cameraMode })),
  setDialog: (dialog) => set({ dialog }),
  setEditingEvent: (editingEvent) => set({ editingEvent }),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setHeatmap: (heatmap) => set({ heatmap }),
  setTarget: (target) => set({ target }),
  setPickMode: (pickMode) => set({ pickMode }),
  setConjunctionPair: (conjunctionPair) => set({ conjunctionPair }),
  setPresentation: (presentation) => set((s) => ({ presentation, panels: presentation ? { left: false, right: false, bottom: false } : s.panels.left || s.panels.right ? s.panels : { left: true, right: true, bottom: true } })),
  setUiHidden: (uiHidden) => set({ uiHidden }),
  notify: (toast) => set({ toast }),

  loadScenario: (f) => {
    for (const s of get().satellites) forgetSatellite(s.id);
    clock.setRange(f.clock.start, f.clock.end, f.clock.time);
    clock.setRate(f.clock.rate);
    const d = derive(f.satellites, f.events);
    set({
      scenarioId: f.id, scenarioName: f.name, baseSatellites: f.satellites, events: f.events, ...d, stations: f.stations,
      selectedId: f.satellites[0]?.id ?? null, secondId: f.satellites[1]?.id ?? null, selectedStationId: f.stations[0]?.id ?? null,
      layers: { ...DEFAULT_LAYERS, ...f.layers } as Layers, views: f.camera.views as CameraView[], cameraMode: 'earth',
      settings: { ...DEFAULT_SETTINGS, ...f.settings }, heatmap: null, target: null,
      conjunctionPair: f.satellites.length > 1 ? [f.satellites[0].id, f.satellites[1].id] : null, dialog: null,
    });
  },
  snapshot: () => {
    const s = get(), c = clock.snapshot();
    return {
      schemaVersion: SCHEMA_VERSION, id: s.scenarioId, name: s.scenarioName, savedAt: new Date().toISOString(),
      clock: { start: c.start, end: c.end, time: c.time, rate: c.rate }, satellites: s.baseSatellites, stations: s.stations, events: s.events,
      camera: { mode: s.cameraMode, views: s.views }, layers: s.layers, settings: s.settings,
    };
  },
}));

clock.subscribe((snap) => useStore.setState({ clock: snap }));
