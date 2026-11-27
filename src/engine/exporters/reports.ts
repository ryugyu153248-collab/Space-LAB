import type { GroundStation, Satellite } from '@/types';
import { computeAccess } from '../analysis/access';
import { screenConjunctions, type Conjunction } from '../analysis/conjunction';
import { classifyRisk, collisionProbability } from '../analysis/collisionRisk';
import { computeEclipses } from '../analysis/eclipse';
import { burnReports, propagateSatellite, propsOf, dynamicsOf } from '../orbital/propagate';
import { derivedElements, rvToElements } from '../orbital/elements';
import { ecefToGeodetic, eciToEcef } from '../orbital/frames';
import { DEG } from '../orbital/constants';
import { formatUtc } from '../orbital/time';
import { deriveScenario } from '../events/EventManager';
import type { SimEvent } from '../events/EventTypes';
import { toCsv } from './files';

export interface ReportInput {
  name: string;
  base: Satellite[];
  events: SimEvent[];
  stations: GroundStation[];
  t0: number;
  t1: number;
  primaryId: string | null;
  secondaryId: string | null;
  cov: { use: boolean; primary: number; secondary: number; hbr: number };
}

const km = (m: number, d = 3) => (m / 1000).toFixed(d);
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const table = (head: string[], rows: (string | number)[][]) =>
  `<table><thead><tr>${head.map((x) => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${h(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const css = `body{font:14px/1.5 system-ui,sans-serif;max-width:980px;margin:2rem auto;padding:0 1rem;color:#111}h1{border-bottom:2px solid #0ea5e9}h2{margin-top:2rem;color:#0369a1}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:12px}th,td{border:1px solid #cbd5e1;padding:3px 6px;text-align:left}th{background:#f1f5f9}
.note{background:#fef9c3;border-left:4px solid #eab308;padding:.4rem .8rem;margin:.6rem 0}.bad{color:#b91c1c}.ok{color:#15803d}code{background:#f1f5f9;padding:0 3px}`;

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title><style>${css}</style></head><body><h1>${h(title)}</h1><p>Generated ${new Date().toISOString()} by ORBITAL LAB (UTC). All values are computed from the simulation state; see model-fidelity notes.</p>${body}</body></html>`;

const fidelity = (s: Satellite) => {
  const d = dynamicsOf(s);
  return s.source.kind === 'tle' ? 'SGP4 mean-element theory (~1 km at epoch, 1–3 km/day growth)' + (s.maneuvers?.length ? `; numerical after first burn (RK4, two-body${d.j2 ? ' + J2' : ''}${d.drag ? ' + drag' : ''})` : '')
    : s.source.kind === 'elements' ? 'Analytic two-body' + (s.maneuvers?.length ? `; numerical after first burn (RK4, two-body${d.j2 ? ' + J2' : ''}${d.drag ? ' + drag' : ''})` : '')
    : `Numerical RK4 (two-body${d.j2 ? ' + J2' : ''}${d.drag ? ' + drag' : ''})`;
};

const sats = (list: Satellite[]) => table(['Name', 'Origin / data quality', 'Epoch (UTC)', 'Model fidelity'],
  list.filter((s) => s.kind !== 'debris').map((s) => [s.name, `${s.origin} – ${s.provenance}`, formatUtc(s.epoch), fidelity(s)]));

export function accessSection(sat: Satellite, stations: GroundStation[], t0: number, t1: number): { html: string; csv: (string | number)[][] } {
  const csv: (string | number)[][] = [['satellite', 'station', 'mask_deg', 'aos_utc', 'los_utc', 'duration_s', 'max_el_deg', 'max_el_time_utc', 'aos_az_deg', 'los_az_deg', 'min_range_km', 'clipped_start', 'clipped_end']];
  let html = '';
  for (const g of stations) {
    const r = computeAccess(sat, g, t0, t1);
    html += `<h3>${h(sat.name)} ↔ ${h(g.name)} (mask ${(g.minElevation / DEG).toFixed(1)}°, ${r.passes.length} passes)</h3>` +
      table(['#', 'AOS', 'LOS', 'Dur [s]', 'Max el [°]', 'AOS az', 'LOS az', 'Min range [km]'], r.passes.map((p, i) => [i + 1, formatUtc(p.aos), formatUtc(p.los), p.duration.toFixed(0), (p.maxEl / DEG).toFixed(1), (p.aosAz / DEG).toFixed(1), (p.losAz / DEG).toFixed(1), km(p.minRange, 0)]));
    for (const p of r.passes) csv.push([sat.name, g.name, g.minElevation / DEG, new Date(p.aos).toISOString(), new Date(p.los).toISOString(), p.duration, p.maxEl / DEG, new Date(p.maxElTime).toISOString(), p.aosAz / DEG, p.losAz / DEG, p.minRange / 1000, String(p.clippedStart), String(p.clippedEnd)]);
  }
  return { html: html + '<div class="note">Geometric line-of-sight only: no terrain, refraction or antenna pattern. Scan step 20 s.</div>', csv };
}

export interface ConjSummary { conj: Conjunction; pc: number | null; pcNote: string; risk: ReturnType<typeof classifyRisk> }
export function conjunctionSummary(list: Satellite[], a: string | null, b: string | null, t0: number, t1: number, cov: ReportInput['cov']): ConjSummary[] {
  const A = list.find((s) => s.id === a);
  const B = list.filter((s) => (b ? s.id === b : s.id !== a));
  if (!A) return [];
  return screenConjunctions(A, B, t0, t1, { screenDistance: 100_000 }).sort((x, y) => x.tca - y.tca).map((conj) => {
    const r = collisionProbability({ conj, covPrimary: cov.use ? { radial: cov.primary, intrack: cov.primary * 3, crosstrack: cov.primary } : null, covSecondary: cov.use ? { radial: cov.secondary, intrack: cov.secondary * 3, crosstrack: cov.secondary } : null, hbr: cov.hbr });
    return { conj, pc: r.pc, pcNote: r.note, risk: classifyRisk(conj.miss, r.pc) };
  });
}

const conjTable = (list: ConjSummary[], names: Map<string, string>) => table(
  ['Primary', 'Secondary', 'TCA (UTC)', 'Miss [m]', 'Rel. speed [m/s]', 'Radial [m]', 'In-track [m]', 'Cross-track [m]', 'Pc', 'Risk'],
  list.map(({ conj: c, pc, risk }) => [names.get(c.primaryId) ?? c.primaryId, names.get(c.secondaryId) ?? c.secondaryId, formatUtc(c.tca, true), c.miss.toFixed(1), c.relSpeed.toFixed(1), c.ric.radial.toFixed(1), c.ric.intrack.toFixed(1), c.ric.crosstrack.toFixed(1), pc === null ? 'not assessable' : pc.toExponential(2), `${risk.label} [${risk.basis}]`]));

export function conjunctionCsv(list: ConjSummary[]): string {
  return toCsv([['primary', 'secondary', 'tca_utc', 'miss_m', 'rel_speed_mps', 'radial_m', 'intrack_m', 'crosstrack_m', 'pc', 'risk', 'risk_basis'],
    ...list.map(({ conj: c, pc, risk }) => [c.primaryId, c.secondaryId, new Date(c.tca).toISOString(), c.miss, c.relSpeed, c.ric.radial, c.ric.intrack, c.ric.crosstrack, pc ?? 'n/a', risk.label, risk.basis])]);
}

export function maneuverRows(list: Satellite[]): (string | number)[][] {
  const rows: (string | number)[][] = [['satellite', 'burn', 'kind', 'direction', 'start_utc', 'end_utc', 'dv_requested_mps', 'dv_achieved_mps', 'mass_before_kg', 'mass_after_kg', 'propellant_kg', 'truncated']];
  for (const s of list) {
    const reps = burnReports(s);
    for (const m of s.maneuvers ?? []) {
      const r = reps.find((x) => x.id === m.id);
      rows.push([s.name, m.name, m.kind, m.direction, new Date(m.start).toISOString(), r ? new Date(r.end).toISOString() : '', m.kind === 'impulsive' ? m.dv ?? 0 : '', r ? r.dvAchieved : '', r ? r.massBefore : '', r ? r.massAfter : '', r ? r.propellantUsed : '', r ? String(r.truncated) : '']);
    }
  }
  return rows;
}

function orbitRow(s: Satellite, t: number): (string | number)[] {
  const st = propagateSatellite(s, t);
  if (!st) return ['n/a'];
  const el = rvToElements(st.r, st.v), d = derivedElements(el), g = ecefToGeodetic(eciToEcef(st.r, t));
  return [st.model, km(el.a), el.e.toFixed(6), (el.i / DEG).toFixed(4), (el.raan / DEG).toFixed(3), (el.argp / DEG).toFixed(3), km(d.perigeeAlt), km(d.apogeeAlt), (d.period / 60).toFixed(3), (g.alt / 1000).toFixed(2)];
}

export function maneuverReportHtml(inp: ReportInput): string {
  const noEv = deriveScenario(inp.base, inp.events.map((e) => (e.type === 'burn' ? { ...e, enabled: false } : e)), inp.t1, inp.t0).satellites;
  const withEv = deriveScenario(inp.base, inp.events, inp.t1, inp.t0).satellites;
  let body = '';
  for (const s of withEv.filter((x) => x.maneuvers?.length)) {
    const before = noEv.find((x) => x.id === s.id)!;
    const last = Math.max(...s.maneuvers!.map((m) => m.start + (m.duration ?? 0) * 1000)) + 60_000;
    const head = ['Case', 'Model', 'a [km]', 'e', 'i [°]', 'Ω [°]', 'ω [°]', 'Perigee alt [km]', 'Apogee alt [km]', 'Period [min]', 'Geodetic alt [km]'];
    const reps = burnReports(s);
    body += `<h2>${h(s.name)}</h2>` + table(['Burn', 'Kind', 'Dir', 'Start (UTC)', 'Δv achieved [m/s]', 'Mass before→after [kg]', 'Propellant [kg]'],
      reps.map((r) => { const m = s.maneuvers!.find((x) => x.id === r.id)!; return [r.name, m.kind, m.direction, formatUtc(r.start), r.dvAchieved.toFixed(3), `${r.massBefore.toFixed(2)} → ${r.massAfter.toFixed(2)}`, r.propellantUsed.toFixed(3) + (r.truncated ? ' (TRUNCATED: tank empty)' : '')]; })) +
      `<p>Total Δv ${reps.reduce((a, r) => a + r.dvAchieved, 0).toFixed(3)} m/s · propellant ${reps.reduce((a, r) => a + r.propellantUsed, 0).toFixed(3)} kg · remaining mass ${reps.length ? reps[reps.length - 1].massAfter.toFixed(2) : propsOf(s).massKg} kg (of ${propsOf(s).massKg} kg)</p>` +
      `<h3>Orbit comparison at ${formatUtc(last)}</h3>` + table(head, [['Before (no burns)', ...orbitRow(before, last)], ['After (with burns)', ...orbitRow(s, last)]]) +
      `<div class="note">"Before" = original orbit (${h(fidelity(before))}). Burn directions: prograde = v̂, normal = r×v, radial = r̂. Ideal rocket-equation mass flow; no gravity/steering loss for impulsive burns.</div>`;
  }
  return page(`Maneuver report – ${inp.name}`, body || '<p>No maneuvers defined (or all disabled).</p>');
}

export function accessReportHtml(inp: ReportInput): { html: string; csv: string } {
  const s = inp.base.find((x) => x.id === inp.primaryId) ?? inp.base[0];
  const r = accessSection(s, inp.stations, inp.t0, inp.t1);
  return { html: page(`Access report – ${inp.name}`, `<p>Window ${formatUtc(inp.t0)} … ${formatUtc(inp.t1)}</p>${r.html}`), csv: toCsv(r.csv) };
}

export function conjunctionReportHtml(inp: ReportInput): { html: string; csv: string } {
  const withEv = deriveScenario(inp.base, inp.events, inp.t1, inp.t0).satellites;
  const noBurn = deriveScenario(inp.base, inp.events.map((e) => (e.type === 'burn' ? { ...e, enabled: false } : e)), inp.t1, inp.t0).satellites;
  const names = new Map(withEv.map((s) => [s.id, s.name]));
  const now = conjunctionSummary(withEv, inp.primaryId, inp.secondaryId, inp.t0, inp.t1, inp.cov);
  const before = conjunctionSummary(noBurn, inp.primaryId, inp.secondaryId, inp.t0, inp.t1, inp.cov);
  const hasBurns = inp.events.some((e) => e.type === 'burn' && e.enabled);
  const body = (hasBurns ? `<h2>Before maneuvers</h2>${conjTable(before, names)}<h2>After maneuvers (current scenario)</h2>` : '<h2>Conjunctions</h2>') + conjTable(now, names) +
    `<div class="note">${inp.cov.use ? `Pc from user-assumed 1σ RIC position sigmas (primary ${inp.cov.primary} m, secondary ${inp.cov.secondary} m; in-track ×3), HBR ${inp.cov.hbr} m. These are <b>assumed</b> covariances, not tracking data.` : 'No covariance supplied: Pc is <b>not assessable</b>. Colours are miss-distance screening levels only (red &lt; 1 km, yellow &lt; 5 km), not probabilities.'}</div>`;
  return { html: page(`Conjunction report – ${inp.name}`, body), csv: conjunctionCsv(now) };
}

export function missionReportHtml(inp: ReportInput): string {
  const d = deriveScenario(inp.base, inp.events, inp.t1, inp.t0);
  const names = new Map(d.satellites.map((s) => [s.id, s.name]));
  const primary = d.satellites.find((s) => s.id === inp.primaryId) ?? d.satellites[0];
  let body = `<h2>1. Scenario</h2><p>Window ${formatUtc(inp.t0)} … ${formatUtc(inp.t1)} (UTC)</p><h2>2. Objects</h2>${sats(d.satellites)}`;
  body += `<h2>3. Ground stations</h2>` + table(['Name', 'Lat [°]', 'Lon [°]', 'Alt [m]', 'Min elevation [°]'], inp.stations.map((g) => [g.name, (g.lat / DEG).toFixed(4), (g.lon / DEG).toFixed(4), g.alt, (g.minElevation / DEG).toFixed(1)]));
  body += `<h2>4. Events</h2>` + table(['Name', 'Type', 'Start (UTC)', 'State', 'Notes'], inp.events.map((e) => [e.name, e.type, formatUtc(e.start), d.status[e.id]?.status ?? '', (d.status[e.id]?.messages ?? []).join(' · ')]));
  const conj = conjunctionSummary(d.satellites, inp.primaryId, inp.secondaryId, inp.t0, inp.t1, inp.cov);
  body += `<h2>5. Conjunction assessment</h2>${conj.length ? conjTable(conj, names) : '<p>No encounters below 100 km in the window.</p>'}`;
  const burns = d.satellites.filter((s) => s.maneuvers?.length);
  if (burns.length) body += `<h2>6. Maneuvers</h2>` + table(['Satellite', 'Burn', 'Δv [m/s]', 'Propellant [kg]'], burns.flatMap((s) => burnReports(s).map((r) => [s.name, r.name, r.dvAchieved.toFixed(3), r.propellantUsed.toFixed(3)])));
  if (primary) {
    const a = accessSection(primary, inp.stations, inp.t0, inp.t1);
    body += `<h2>7. Ground-station access (${h(primary.name)})</h2>${a.html}`;
    const ecl = computeEclipses(primary, inp.t0, inp.t1);
    body += `<h2>8. Eclipses (${h(primary.name)})</h2>` + table(['Shadow entry', 'Shadow exit', 'Umbra [s]', 'Duration [s]'], ecl.map((x) => [formatUtc(x.start), formatUtc(x.end), x.umbraStart ? ((x.umbraEnd! - x.umbraStart) / 1000).toFixed(0) : '0', ((x.end - x.start) / 1000).toFixed(0)])) + '<div class="note">Conical Earth shadow; low-precision Sun (~0.01°).</div>';
  }
  body += `<h2>9. Model fidelity & data quality</h2><ul><li>Frames: ECI ≙ TEME axes; ECEF via GMST (UT1≈UTC, no polar motion).</li><li>Simulated data is labelled SIMULATED. Telemetry, radiation and SAA are simulated models, not measurements.</li><li>Debris from collisions uses a simplified isotropic ejection model.</li><li>Pc requires user-supplied covariance; otherwise not reported.</li></ul>`;
  return page(`Mission report – ${inp.name}`, body);
}
