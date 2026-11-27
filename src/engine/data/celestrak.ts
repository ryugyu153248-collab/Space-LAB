import { parseTleText, type TleParseResult } from './tle';

/**
 * Live element sets from CelesTrak's public GP API (no key). Called directly from the browser; if the network or CORS blocks it the caller
 * shows the error and the user can still paste TLEs manually. The fetched time is recorded in the satellite provenance.
 */
const BASE = 'https://celestrak.org/NORAD/elements/gp.php';

export type CelestrakQuery = { catnr: string } | { name: string } | { group: string };

export interface Preset { label: string; query: CelestrakQuery; limit?: number; note?: string }

export const PRESETS: Preset[] = [
  { label: 'ISS (ZARYA)', query: { catnr: '25544' } },
  { label: 'Hubble (HST)', query: { catnr: '20580' } },
  { label: 'Tiangong (CSS)', query: { catnr: '48274' } },
  { label: 'Space stations', query: { group: 'stations' }, limit: 12 },
  { label: 'Starlink (5)', query: { name: 'STARLINK' }, limit: 5 },
  { label: 'GPS operational (8)', query: { group: 'gps-ops' }, limit: 8 },
  { label: 'Weather (8)', query: { group: 'weather' }, limit: 8 },
  { label: 'Bright 20', query: { group: 'visual' }, limit: 20 },
];

export function celestrakUrl(q: CelestrakQuery): string {
  const p = new URLSearchParams();
  if ('catnr' in q) p.set('CATNR', q.catnr.trim());
  else if ('name' in q) p.set('NAME', q.name.trim());
  else p.set('GROUP', q.group);
  p.set('FORMAT', 'tle');
  return `${BASE}?${p.toString()}`;
}

export async function fetchCelestrak(q: CelestrakQuery, limit = 25, signal?: AbortSignal): Promise<TleParseResult> {
  let res: Response;
  try { res = await fetch(celestrakUrl(q), { signal }); }
  catch { throw new Error('Could not reach CelesTrak (network or CORS blocked). Paste the TLE manually instead.'); }
  if (!res.ok) throw new Error(`CelesTrak answered HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*(No GP data found|Invalid query)/i.test(text)) throw new Error(text.trim().slice(0, 120));
  const parsed = parseTleText(text);
  parsed.tles = parsed.tles.slice(0, limit);
  if (!parsed.tles.length) throw new Error(parsed.errors[0] ?? 'No TLE data returned');
  return parsed;
}
