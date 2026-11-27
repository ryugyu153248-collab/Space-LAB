import { useStore } from '@/stores/store';
import { propagateSatellite } from '@/engine/orbital/propagate';
import { derivedElements, rvToElements } from '@/engine/orbital/elements';
import { ecefToGeodetic, eciToEcef } from '@/engine/orbital/frames';
import { norm } from '@/engine/orbital/vec';
import { jumpTo } from '@/engine/simulation/runtime';
import { tleStaleness } from '@/engine/data/tle';
import { formatUtc } from '@/engine/orbital/time';
import { lookAngles } from '@/engine/orbital/lookangles';
import { nextContact } from '@/engine/analysis/access';
import { useAccess } from '@/hooks/useAccess';
import { DEG } from '@/engine/orbital/constants';
import { MODEL_LABEL, modelKindFor } from '@/engine/cesium/models/templates';
import { Badge, Row } from '../common/Row';
import { deg, duration, fmt, km } from '@/utils/format';

export function RightPanel() {
  const { satellites, selectedId, clock: snap } = useStore();
  const { stn, result } = useAccess();
  const sat = satellites.find((s) => s.id === selectedId);
  if (!sat) return <div className="p-3 text-slate-500">No satellite selected</div>;

  const t = snap.time;
  const st = propagateSatellite(sat, t);
  const age = sat.source.kind === 'tle' ? tleStaleness(sat.epoch, t) : null;
  const model = sat.source.kind === 'tle' ? 'SGP4/SDP4 (TLE mean elements)' : 'Analytic two-body (no perturbations)';
  const fidelity = sat.source.kind === 'tle'
    ? '~1 km at epoch, grows ~1–3 km/day'
    : 'Ideal Keplerian – no J2/drag; for demo/short horizons';

  const ended = sat.endTime !== undefined && t >= sat.endTime;
  const notYet = sat.source.kind === 'state' && t < sat.source.epoch;
  let body: React.ReactNode = <div className="px-3 py-2 text-amber-300">{ended ? `Object no longer exists (collision / re-entry at ${formatUtc(sat.endTime!)}).` : notYet ? `Object does not exist yet (created ${formatUtc(sat.source.kind === 'state' ? sat.source.epoch : 0)}).` : 'No valid state at this time (SGP4 error, decayed, or re-entered below 100 km).'}</div>;
  if (st) {
    const rE = eciToEcef(st.r, t);
    const g = ecefToGeodetic(rE);
    const el = rvToElements(st.r, st.v);
    const d = derivedElements(el);
    const la = stn ? lookAngles(stn, rE) : null;
    const inContact = la && stn ? la.el >= stn.minElevation : false;
    const next = result ? nextContact(result, t) : null;
    body = (
      <>
        {stn && la && (
          <>
            <div className="sect">Link to {stn.name}</div>
            <Row label="Status" value={<Badge tone={inContact ? 'ok' : 'warn'}>{inContact ? 'In contact' : 'No contact'}</Badge>} />
            <Row label="Azimuth (from N, cw)" value={deg(la.az, 2)} unit="°" />
            <Row label="Elevation" value={deg(la.el, 2)} unit="°" title={`Mask ${(stn.minElevation / DEG).toFixed(1)}°`} />
            <Row label="Slant range" value={km(la.range, 1)} unit="km" />
            <Row label={inContact ? 'LOS in' : 'Next AOS in'}
              value={next ? duration(Math.max(0, ((inContact ? next.los : next.aos) - t) / 1000)) : 'none in window'} />
            {next && <Row label="Next pass max el" value={deg(next.maxEl, 1)} unit="°" />}
          </>
        )}
        <div className="sect">Position — WGS84 geodetic (UTC)</div>
        <Row label="Latitude" value={deg(g.lat)} unit="° N" />
        <Row label="Longitude" value={deg(g.lon)} unit="° E" />
        <Row label="Altitude" value={km(g.alt)} unit="km" />
        <details className="group"><summary className="sect cursor-pointer select-none hover:text-slate-300">▸ State vector — {st.frame} (inertial)</summary>
        <Row label="X" value={km(st.r[0])} unit="km" />
        <Row label="Y" value={km(st.r[1])} unit="km" />
        <Row label="Z" value={km(st.r[2])} unit="km" />
        <Row label="Vx" value={km(st.v[0], 5)} unit="km/s" />
        <Row label="Vy" value={km(st.v[1], 5)} unit="km/s" />
        <Row label="Vz" value={km(st.v[2], 5)} unit="km/s" />
        <Row label="Speed" value={km(norm(st.v), 5)} unit="km/s" />
        <Row label="|r|" value={km(norm(st.r))} unit="km" />
        </details>
        <details><summary className="sect cursor-pointer select-none hover:text-slate-300">▸ Orbital elements (osculating)</summary>
        <Row label="Semi-major axis a" value={km(el.a)} unit="km" />
        <Row label="Eccentricity e" value={fmt(el.e, 6)} />
        <Row label="Inclination i" value={deg(el.i)} unit="°" />
        <Row label="RAAN Ω" value={deg(el.raan)} unit="°" />
        <Row label="Arg. of perigee ω" value={deg(el.argp)} unit="°" />
        <Row label="True anomaly ν" value={deg(el.nu)} unit="°" />
        <Row label="Perigee altitude" value={km(d.perigeeAlt)} unit="km" title="Above equatorial radius 6378.137 km" />
        <Row label="Apogee altitude" value={km(d.apogeeAlt)} unit="km" title="Above equatorial radius 6378.137 km" />
        <Row label="Period" value={duration(d.period)} />
        <Row label="Specific energy ε" value={fmt(d.specificEnergy / 1e6, 4)} unit="MJ/kg" />
        </details>
        <div className="px-3 pt-1 text-[10px] text-slate-500">
          Osculating elements differ from the TLE mean elements (SGP4 uses Kozai/Brouwer means).
        </div>
      </>
    );
  }

  return (
    <div className="pb-4">
      <div className="px-3 pt-3 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: sat.color }} />
        <span className="text-sm text-slate-100 font-semibold truncate">{sat.name}</span>
      </div>
      <div className="px-3 pt-1 flex gap-1 flex-wrap">
        <Badge tone={sat.origin === 'SIMULATED' ? 'sim' : 'real'}>{sat.origin === 'SIMULATED' ? 'Simulated data' : 'Real element set'}</Badge>
        {age && <Badge tone={age.level === 'fresh' ? 'ok' : age.level === 'aging' ? 'warn' : 'bad'}>{age.level}</Badge>}
      </div>
      <details><summary className="sect cursor-pointer select-none hover:text-slate-300">▸ Source</summary>
      <Row label="NORAD ID" value={sat.noradId ?? 'n/a (simulated)'} />
      <Row label="Epoch" value={formatUtc(sat.epoch)} />
      {age && <Row label="Epoch offset @ sim time" value={`${age.days >= 0 ? '+' : ''}${age.days.toFixed(2)} d`} />}
      <Row label="Propagator" value={model} />
      {sat.kind !== 'debris' && <Row label="3D model" value={MODEL_LABEL[modelKindFor(sat)]} title="Simplified procedural illustration, not CAD" />}
      <div className="px-3 text-[10px] text-slate-500 leading-snug">{sat.provenance}. Fidelity: {fidelity}.</div>
      </details>
      {age && age.level === 'stale' && (
        <div className="mx-3 mt-2 p-2 rounded border border-red-700 bg-red-950/40 text-red-300 text-[11px]">
          ⚠ Element set is {Math.abs(age.days).toFixed(1)} days from sim time — predicted position may be off by tens to thousands of km.
          <button className="btn ml-2" onClick={() => jumpTo(sat.epoch)}>Go to epoch</button>
        </div>
      )}
      {body}
    </div>
  );
}
