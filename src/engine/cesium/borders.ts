import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

/**
 * Country boundaries (shared land borders only — coastlines come from the base map), Natural Earth 1:50m admin-0 via the `world-atlas`
 * package (public domain), bundled with the app → offline. Loaded lazily (≈750 KB JSON, its own chunk) the first time borders are shown.
 * Note: Natural Earth depicts de-facto boundaries; disputed areas follow its conventions.
 */
export type BorderLine = [number, number][];
let cache: Promise<BorderLine[]> | null = null;

export function loadBorders(): Promise<BorderLine[]> {
  return (cache ??= import('world-atlas/countries-50m.json').then((m) => {
    const topo = (m.default ?? m) as unknown as Topology;
    const g = mesh(topo, topo.objects.countries as GeometryCollection, (a, b) => a !== b);
    return g.coordinates as BorderLine[];
  }));
}
