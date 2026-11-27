import { useEffect, useRef } from 'react';
import { useStore } from '@/stores/store';
import { clock } from '@/engine/simulation/runtime';
import { propagateSatellite, propsOf } from '@/engine/orbital/propagate';
import { ecefToGeodetic, eciToEcef } from '@/engine/orbital/frames';
import { derivedElements, rvToElements } from '@/engine/orbital/elements';
import { lookAngles, visibilityCentralAngle } from '@/engine/orbital/lookangles';
import { sunPositionEci } from '@/engine/orbital/sun';
import { saaOutline } from '@/engine/orbital/environment';
import { sensorFootprint } from '@/engine/orbital/attitude';
import { DEG, R_EARTH } from '@/engine/orbital/constants';
import { norm } from '@/engine/orbital/vec';
import { loadBackground } from '@/engine/cesium/baseMap';
import { loadBorders, type BorderLine } from '@/engine/cesium/borders';
import type { Satellite, Vec3 } from '@/types';

/**
 * 2-D map window (STK "2D Graphics"): equirectangular map with ground tracks, sub-satellite points, sensor footprints,
 * ground stations with visibility circles, communication links, day/night terminator, coverage heatmap and target.
 * Everything is drawn from the same propagated states as the 3-D view. Wheel = zoom, drag = pan, double-click = reset, click = set target.
 */
interface Track { key: string; tRef: number; period: number; pts: { t: number; lat: number; lon: number }[] }

const wrapLon = (l: number) => ((l + 540) % 360) - 180;

function trackFor(cache: Map<string, Track>, sat: Satellite, t: number): Track | null {
  const key = JSON.stringify([sat.id, sat.source, sat.maneuvers, sat.dynamics, sat.endTime]);
  const hit = cache.get(sat.id);
  if (hit && hit.key === key && Math.abs(t - hit.tRef) < hit.period * 1000 * 0.1) return hit;
  const st = propagateSatellite(sat, t);
  if (!st) return null;
  const period = derivedElements(rvToElements(st.r, st.v)).period;
  if (!isFinite(period) || period <= 0 || period > 86400 * 2) return null;
  const t0 = t - period * 1000 * 0.7, t1 = t + period * 1000 * 1.2, n = 240;
  const pts: Track['pts'] = [];
  for (let k = 0; k <= n; k++) {
    const tk = t0 + ((t1 - t0) * k) / n, s = propagateSatellite(sat, tk);
    if (!s) continue;
    const g = ecefToGeodetic(eciToEcef(s.r, tk));
    pts.push({ t: tk, lat: g.lat / DEG, lon: g.lon / DEG });
  }
  const tr = { key, tRef: t, period, pts };
  cache.set(sat.id, tr);
  return tr;
}

export function Map2D() {
  const ref = useRef<HTMLCanvasElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const view = useRef({ cLon: 0, cLat: 0, zoom: 1 });
  const cache = useRef(new Map<string, Track>());
  const bg = useRef<HTMLCanvasElement | null>(null);
  const borders = useRef<BorderLine[] | null>(null);

  useEffect(() => {
    let raf = 0, alive = true;
    loadBackground().then((c) => { bg.current = c; });
    loadBorders().then((b) => { borders.current = b; });
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let lastKey = '';
    const draw = () => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); lastKey = ''; }
      const S = useStore.getState();
      const t = clock.time, v = view.current;
      const key = `${t}|${v.cLon}|${v.cLat}|${v.zoom}|${w}|${h}|${!!bg.current}|${!!borders.current}|${S.layers.borders}|${S.satellites.length}|${S.selectedId}|${S.layers.saa}|${S.heatmap ? 1 : 0}|${S.target?.lat}|${JSON.stringify(S.hidden)}|${S.stations.length}|${S.stations.map((g) => g.minElevation).join()}`;
      if (key === lastKey) return;
      lastKey = key;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = Math.min(w / 360, h / 180) * v.zoom;
      const X = (lon: number) => w / 2 + (lon - v.cLon) * k, Y = (lat: number) => h / 2 - (lat - v.cLat) * k;
      ctx.fillStyle = '#050a14'; ctx.fillRect(0, 0, w, h);
      if (bg.current) ctx.drawImage(bg.current, X(-180), Y(90), 360 * k, 180 * k);
      else { ctx.fillStyle = '#0a1a2f'; ctx.fillRect(X(-180), Y(90), 360 * k, 180 * k); }

      // day / night
      const sun = eciToEcef(sunPositionEci(t), t), sr = norm(sun as Vec3);
      const dec = Math.asin(sun[2] / sr), lonS = Math.atan2(sun[1], sun[0]);
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 2) {
        const d = lon * DEG - lonS, lat = Math.atan(-Math.cos(d) / Math.tan(Math.abs(dec) < 1e-4 ? 1e-4 : dec)) / DEG;
        lon === -180 ? ctx.moveTo(X(lon), Y(lat)) : ctx.lineTo(X(lon), Y(lat));
      }
      const poleLat = dec >= 0 ? -90 : 90;
      ctx.lineTo(X(180), Y(poleLat)); ctx.lineTo(X(-180), Y(poleLat)); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,10,0.5)'; ctx.fill();
      // sub-solar point
      ctx.beginPath(); ctx.arc(X(wrapLon(lonS / DEG)), Y(dec / DEG), 6, 0, 7); ctx.fillStyle = '#facc15'; ctx.fill();

      if (S.layers.borders && borders.current) { ctx.beginPath(); for (const l of borders.current) l.forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la)))); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.8; ctx.stroke(); }
      // grid
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(148,163,184,0.25)'; ctx.fillStyle = 'rgba(203,213,225,0.7)'; ctx.font = '10px ui-monospace, monospace';
      for (let lon = -180; lon <= 180; lon += 30) { ctx.beginPath(); ctx.moveTo(X(lon), Y(90)); ctx.lineTo(X(lon), Y(-90)); ctx.stroke(); if (lon < 180) ctx.fillText(`${lon}`, X(lon) + 2, Y(-90) - 3); }
      for (let lat = -90; lat <= 90; lat += 30) { ctx.beginPath(); ctx.moveTo(X(-180), Y(lat)); ctx.lineTo(X(180), Y(lat)); ctx.stroke(); ctx.fillText(`${lat}`, X(-180) + 3, Y(lat) - 2); }
      ctx.strokeStyle = 'rgba(148,163,184,0.6)'; ctx.strokeRect(X(-180), Y(90), 360 * k, 180 * k);

      const L = S.layers;
      if (L.coverage && S.heatmap) { const r = S.heatmap.rect; ctx.globalAlpha = 0.65; ctx.drawImage(S.heatmap.canvas, X(r.west), Y(r.north), (r.east - r.west) * k, (r.north - r.south) * k); ctx.globalAlpha = 1; }
      if (L.saa) { ctx.beginPath(); saaOutline().forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la)))); ctx.closePath(); ctx.fillStyle = 'rgba(244,63,94,0.2)'; ctx.fill(); ctx.strokeStyle = '#f43f5e'; ctx.stroke(); }

      const sats = S.satellites.filter((s) => s.kind !== 'debris' && !S.hidden[s.id]);
      const sel = sats.find((s) => s.id === S.selectedId);
      const selSt = sel ? propagateSatellite(sel, t) : null;
      // station visibility circles (sized for the selected satellite's altitude) and links
      for (const g of S.stations) {
        if (S.hidden[g.id] || !L.stations) continue;
        const gx = X(g.lon / DEG), gy = Y(g.lat / DEG);
        if (selSt && L.visibilityCones) {
          const lam = visibilityCentralAngle(R_EARTH, norm(selSt.r), g.minElevation);
          ctx.beginPath(); let jump = false, px = 0;
          for (let a = 0; a <= 360; a += 4) {
            const br = a * DEG, lat0 = g.lat, lon0 = g.lon;
            const lat = Math.asin(Math.sin(lat0) * Math.cos(lam) + Math.cos(lat0) * Math.sin(lam) * Math.cos(br));
            const lon = lon0 + Math.atan2(Math.sin(br) * Math.sin(lam) * Math.cos(lat0), Math.cos(lam) - Math.sin(lat0) * Math.sin(lat));
            const x = X(wrapLon(lon / DEG)), y = Y(lat / DEG);
            if (a === 0) ctx.moveTo(x, y); else if (Math.abs(x - px) > w / 2) { jump = true; ctx.moveTo(x, y); } else ctx.lineTo(x, y);
            px = x;
          }
          if (!jump) { ctx.fillStyle = g.color + '22'; ctx.fill(); }
          ctx.strokeStyle = g.color + 'aa'; ctx.stroke();
        }
        ctx.save(); ctx.translate(gx, gy); ctx.rotate(Math.PI / 4); ctx.fillStyle = g.color; ctx.fillRect(-4, -4, 8, 8); ctx.restore();
        if (L.labels) { ctx.fillStyle = g.color; ctx.font = '11px ui-monospace, monospace'; ctx.fillText(g.name, gx + 8, gy - 6); }
      }
      // satellites
      for (const s of sats) {
        const st = propagateSatellite(s, t);
        if (!st) continue;
        const gg = ecefToGeodetic(eciToEcef(st.r, t));
        const lat = gg.lat / DEG, lon = gg.lon / DEG;
        if (L.groundTracks) {
          const tr = trackFor(cache.current, s, t);
          if (tr) {
            const drawSeg = (from: number, to: number, dash: number[], alpha: string) => {
              ctx.beginPath(); ctx.setLineDash(dash); ctx.strokeStyle = s.color + alpha; ctx.lineWidth = s.id === S.selectedId ? 2 : 1.2;
              let prev: { lon: number } | null = null;
              for (const p of tr.pts) {
                if (p.t < from || p.t > to) continue;
                if (!prev || Math.abs(p.lon - prev.lon) > 180) ctx.moveTo(X(p.lon), Y(p.lat)); else ctx.lineTo(X(p.lon), Y(p.lat));
                prev = p;
              }
              ctx.stroke(); ctx.setLineDash([]);
            };
            drawSeg(t - tr.period * 500, t, [], '88'); drawSeg(t, t + tr.period * 1000, [6, 4], 'ee');
          }
        }
        // sensor footprint (nadir pointing)
        const alpha = propsOf(s).sensorHalfAngle;
        if (alpha && L.footprints && s.id === S.selectedId) {
          const p = eciToEcef(st.r, t), pn = norm(p as Vec3);
          const ring = sensorFootprint(p as Vec3, [-p[0] / pn, -p[1] / pn, -p[2] / pn], alpha, 48);
          if (ring.every((q) => q)) {
            const pts = (ring as Vec3[]).map((q) => { const g2 = ecefToGeodetic(q); return [g2.lon / DEG, g2.lat / DEG]; });
            const lons = pts.map((q) => q[0]);
            if (Math.max(...lons) - Math.min(...lons) < 180) { ctx.beginPath(); pts.forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la)))); ctx.closePath(); ctx.fillStyle = 'rgba(34,211,238,0.25)'; ctx.fill(); ctx.strokeStyle = '#22d3ee'; ctx.stroke(); }
          }
        }
        // links
        for (const g of S.stations) if (L.commLinks && L.stations && !S.hidden[g.id] && lookAngles(g, eciToEcef(st.r, t)).el >= g.minElevation) {
          ctx.beginPath(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#22c55e'; ctx.moveTo(X(g.lon / DEG), Y(g.lat / DEG)); ctx.lineTo(X(lon), Y(lat)); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.beginPath(); ctx.arc(X(lon), Y(lat), s.id === S.selectedId ? 6 : 4.5, 0, 7); ctx.fillStyle = s.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
        if (L.labels) { ctx.fillStyle = '#e2e8f0'; ctx.font = '11px ui-monospace, monospace'; ctx.fillText(s.name, X(lon) + 8, Y(lat) + 4); }
      }
      if (S.target) { const tx = X(S.target.lon), ty = Y(S.target.lat); ctx.strokeStyle = '#e879f9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 6, 0, 7); ctx.moveTo(tx - 10, ty); ctx.lineTo(tx + 10, ty); ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty + 10); ctx.stroke(); ctx.fillStyle = '#e879f9'; ctx.fillText('TARGET', tx + 9, ty - 8); }
      ctx.lineWidth = 1;
    };
    draw();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  const toLonLat = (e: React.MouseEvent): [number, number] => {
    const cv = ref.current!, r = cv.getBoundingClientRect(), v = view.current;
    const k = Math.min(r.width / 360, r.height / 180) * v.zoom;
    return [v.cLon + (e.clientX - r.left - r.width / 2) / k, v.cLat - (e.clientY - r.top - r.height / 2) / k];
  };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <div className="relative w-full h-full bg-black">
      <canvas ref={ref} className="w-full h-full block cursor-crosshair"
        onWheel={(e) => { const v = view.current; const [lo, la] = toLonLat(e); const z = Math.min(16, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.25 : 0.8))); const f = z / v.zoom; v.cLon = lo - (lo - v.cLon) / f; v.cLat = la - (la - v.cLat) / f; v.zoom = z; if (z === 1) { v.cLon = 0; v.cLat = 0; } }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          const [lo, la] = toLonLat(e);
          if (hover.current) hover.current.textContent = `${la.toFixed(2)}°, ${lo.toFixed(2)}°`;
          const d = drag.current; if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) { const r = ref.current!.getBoundingClientRect(), v = view.current, k = Math.min(r.width / 360, r.height / 180) * v.zoom; v.cLon -= dx / k; v.cLat += dy / k; d.x = e.clientX; d.y = e.clientY; }
        }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) { const [lo, la] = toLonLat(e); if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) { const s = useStore.getState(); s.setTarget({ lat: la, lon: lo, radiusKm: s.target?.radiusKm }); s.notify(`Target set: ${la.toFixed(2)}°, ${lo.toFixed(2)}°`); } } }}
        onDoubleClick={() => { view.current = { cLon: 0, cLat: 0, zoom: 1 }; }} />
      <div className="absolute left-2 top-2 text-[10px] text-slate-300 bg-black/50 rounded px-2 py-0.5 pointer-events-none">2D Map · wheel zoom · drag pan · click = target · dbl-click reset</div>
      <div ref={hover} className="absolute left-2 bottom-2 num text-[10px] text-slate-200 bg-black/50 rounded px-2 py-0.5 pointer-events-none">—</div>
    </div>
  );
}
