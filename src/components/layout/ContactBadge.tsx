import { useStore } from '@/stores/store';
import { useAccess } from '@/hooks/useAccess';
import { propagateSatellite } from '@/engine/orbital/propagate';
import { eciToEcef } from '@/engine/orbital/frames';
import { lookAngles } from '@/engine/orbital/lookangles';
import { nextContact } from '@/engine/analysis/access';
import { DEG } from '@/engine/orbital/constants';
import { duration } from '@/utils/format';

/** Link-status badge over the 3D view: "In range / Out of range" between the selected satellite and station (real geometry, same clock). */
export function ContactBadge() {
  const t = useStore((s) => s.clock.time);
  const { sat, stn, result } = useAccess();
  if (!sat || !stn) return null;
  const st = propagateSatellite(sat, t);
  if (!st) return null;
  const la = lookAngles(stn, eciToEcef(st.r, t));
  const inRange = la.el >= stn.minElevation;
  const next = result ? nextContact(result, t) : null;
  const detail = inRange
    ? `el ${(la.el / DEG).toFixed(1)}° · ${(la.range / 1000).toFixed(0)} km${next ? ` · LOS in ${duration(Math.max(0, (next.los - t) / 1000))}` : ''}`
    : next ? `next AOS in ${duration(Math.max(0, (next.aos - t) / 1000))} · max el ${(next.maxEl / DEG).toFixed(0)}°` : 'no pass in window';
  return (
    <div className={`absolute left-1/2 -translate-x-1/2 top-3 z-10 pointer-events-none px-3 py-1.5 rounded-full border text-[12px] backdrop-blur ${inRange ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300' : 'bg-amber-950/60 border-amber-600 text-amber-300'}`}>
      <b>{inRange ? '● อยู่ในระยะ · In range' : '○ อยู่นอกระยะ · Out of range'}</b>
      <span className="text-slate-300"> — {stn.name} · {detail}</span>
    </div>
  );
}
