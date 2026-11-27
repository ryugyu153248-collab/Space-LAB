import { useEffect, useRef } from 'react';
import { CesiumScene } from '@/engine/cesium/CesiumScene';
import { sceneRegistry } from '@/engine/cesium/registry';
import { clock } from '@/engine/simulation/runtime';
import { formatUtc } from '@/engine/orbital/time';
import { useStore } from '@/stores/store';

export function CesiumView() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CesiumScene | null>(null);
  const { satellites, stations, layers, selectedId, secondId, selectedStationId, cameraMode, events, target, conjunctionPair, heatmap, pickMode } = useStore();

  useEffect(() => {
    let last = 0;
    const scene = new CesiumScene(ref.current!, clock, {
      onSelect: (id) => useStore.getState().select(id),
      onPick: (lat, lon) => { const s = useStore.getState(); s.setTarget({ lat, lon }); s.setPickMode(false); s.setBottomTab('coverage'); },
      // UI clock snapshot at ~10 Hz (rendering runs at display rate; simulation time is decoupled from it)
      onFrame: () => {
        const now = performance.now();
        if (now - last > 100 && clock.snapshot().playing) { last = now; useStore.setState({ clock: clock.snapshot() }); }
      },
    });
    scene.setOverlayProvider(() => {
      const s = useStore.getState();
      const sat = s.satellites.find((x) => x.id === s.selectedId);
      const t = clock.time;
      const ev = s.events.find((e) => e.enabled && t >= e.start && t < (e.end ?? e.start + 600_000));
      return { lines: [formatUtc(t), ...(sat ? [sat.name] : []), ...(ev ? [`EVENT: ${ev.name}`] : []), `SPACE LAB · ${s.scenarioName}`] };
    });
    sceneRef.current = scene;
    sceneRegistry.scene = scene;
    const st = useStore.getState();
    scene.setSatellites(st.satellites); scene.setStations(st.stations); scene.setLayers(st.layers); scene.select(st.selectedId); scene.setEvents(st.events, st.satellites);
    return () => { scene.dispose(); sceneRef.current = null; sceneRegistry.scene = null; };
  }, []);

  useEffect(() => { sceneRef.current?.setSatellites(satellites); }, [satellites]);
  useEffect(() => { sceneRef.current?.setStations(stations); }, [stations]);
  useEffect(() => { sceneRef.current?.setLayers(layers); }, [layers, satellites, stations, heatmap]);
  useEffect(() => { sceneRef.current?.setEvents(events, satellites); sceneRef.current?.setLayers(useStore.getState().layers); }, [events, satellites]);
  useEffect(() => { sceneRef.current?.select(selectedId); }, [selectedId, satellites]);
  useEffect(() => { sceneRef.current?.setCameraMode(cameraMode, { stationId: selectedStationId, secondId }); }, [cameraMode, selectedId, secondId, selectedStationId]);
  useEffect(() => { sceneRef.current?.setTarget(target); }, [target]);
  useEffect(() => { sceneRef.current?.setConjunction(conjunctionPair); }, [conjunctionPair]);
  useEffect(() => { sceneRef.current?.setHeatmap(heatmap?.canvas ?? null, heatmap?.rect); sceneRef.current?.setLayers(useStore.getState().layers); }, [heatmap]);
  useEffect(() => { sceneRef.current?.setPickMode(pickMode); }, [pickMode]);

  return <div ref={ref} className="absolute inset-0" />;
}
