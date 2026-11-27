import { useMemo } from 'react';
import { useStore } from '@/stores/store';
import { computeAccess, type AccessResult } from '@/engine/analysis/access';

/**
 * Access result for the selected satellite × selected station over the scenario window.
 * Recomputed only when the satellite source, station geometry/mask or window changes — not every clock tick.
 * (3 days × 20 s ≈ 13k propagations ≈ tens of ms; moves to a Web Worker when many pairs are analysed — Phase 4.)
 */
export function useAccess() {
  const { satellites, selectedId, stations, selectedStationId } = useStore();
  const start = useStore((s) => s.clock.start);
  const end = useStore((s) => s.clock.end);
  const sat = satellites.find((s) => s.id === selectedId);
  const stn = stations.find((g) => g.id === selectedStationId);
  const result = useMemo<AccessResult | null>(() => {
    if (!sat || !stn) return null;
    try { return computeAccess(sat, stn, start, end); } catch (e) { console.error(e); return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sat?.id, sat?.source, stn?.id, stn?.lat, stn?.lon, stn?.alt, stn?.minElevation, start, end]);
  return { sat, stn, result };
}
