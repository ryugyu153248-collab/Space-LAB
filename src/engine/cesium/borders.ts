import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';

/**
 * Country boundaries from Natural Earth 1:50m admin-0 via the `world-atlas` package (public domain), bundled with the app → offline.
 * Loaded lazily (≈750 KB JSON, its own chunk) the first time borders are shown.
 *  - `loadBorders()`  : shared land borders between countries (coastlines come from the base map)
 *  - `loadThailand()` : the COMPLETE outline of Thailand — land borders, the Gulf of Thailand / Andaman coasts and all islands — plus its
 *                       polygons (for a subtle area fill), so the whole country is delineated.
 * Natural Earth depicts de-facto boundaries; disputed areas follow its conventions.
 */
export type BorderLine = [number, number][];
export interface ThailandShape { lines: BorderLine[]; polygons: [number, number][][] }

let topoPromise: Promise<Topology> | null = null;
const loadTopology = (): Promise<Topology> => (topoPromise ??= import('world-atlas/countries-50m.json').then((m) => (m.default ?? m) as unknown as Topology));

let bordersCache: Promise<BorderLine[]> | null = null;
export function loadBorders(): Promise<BorderLine[]> {
  return (bordersCache ??= loadTopology().then((topo) => mesh(topo, topo.objects.countries as GeometryCollection, (a, b) => a !== b).coordinates as BorderLine[]));
}

let thaiCache: Promise<ThailandShape> | null = null;
export function loadThailand(): Promise<ThailandShape> {
  return (thaiCache ??= loadTopology().then((topo) => {
    const geoms = (topo.objects.countries as GeometryCollection).geometries;
    const g = geoms.find((x) => (x.properties as { name?: string } | undefined)?.name === 'Thailand') as GeometryObject | undefined;
    if (!g) throw new Error('Thailand not found in the country dataset');
    const one = { type: 'GeometryCollection', geometries: [g] } as GeometryCollection;
    const lines = mesh(topo, one).coordinates as BorderLine[];            // every arc of the country, coasts included
    const f = feature(topo, g) as unknown as { geometry: { type: string; coordinates: number[][][] | number[][][][] } };
    const polys = (f.geometry.type === 'MultiPolygon' ? (f.geometry.coordinates as number[][][][]) : [f.geometry.coordinates as number[][][]]);
    return { lines, polygons: polys.map((p) => p[0] as [number, number][]) };  // outer rings (Thailand has no holes)
  }));
}
