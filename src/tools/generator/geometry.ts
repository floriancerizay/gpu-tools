import polygonClipping from 'polygon-clipping';
import { parseWkt, type Coord, type MultiLine, type MultiPoint, type MultiPoly } from './wkt';

export type FetchFn = (url: string) => Promise<Response>;

export interface Commune {
  insee: string;
  title: string;
}

/** Jeu de géométries factices dérivées du territoire (parcelles d'une commune ou communes d'un EPCI). */
export interface Geometries {
  communes: Commune[];
  /** partition factice en zones (disjointes) */
  zones: MultiPoly[];
  /** surfaces pour prescriptions / informations / habillage */
  surfaces: MultiPoly[];
  lines: MultiLine[];
  points: MultiPoint[];
  /** emprise [ouest, sud, est, nord] en WGS84 */
  bbox: [number, number, number, number];
}

const GRID = 'https://www.geoportail-urbanisme.gouv.fr/api/grid';
const WFS = 'https://data.geopf.fr/wfs/ows';
export const MAX_PARCELS = 60;
export const MAX_COMMUNES = 12;
export const ZONE_COUNT = 3;

async function json<T>(fetchFn: FetchFn, url: string): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Échec de la requête (${res.status}) : ${url}`);
  return (await res.json()) as T;
}

export async function fetchParcels(fetchFn: FetchFn, insee: string): Promise<MultiPoly[]> {
  const q = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
    OUTPUTFORMAT: 'application/json',
    CQL_FILTER: `code_insee='${insee}'`,
    COUNT: String(MAX_PARCELS),
  });
  const fc = await json<{ features: { geometry: { type: string; coordinates: unknown } }[] }>(
    fetchFn,
    `${WFS}?${q}`,
  );
  const cells = fc.features
    .filter((f) => f.geometry?.type === 'MultiPolygon')
    .map((f) => f.geometry.coordinates as MultiPoly);
  if (cells.length === 0) throw new Error(`Aucune parcelle trouvée pour la commune ${insee}`);
  return cells;
}

interface GridNode {
  name: string;
  title: string;
  type: string;
  geometry?: string;
}

export async function fetchGridCommunes(fetchFn: FetchFn, id: string): Promise<Commune[]> {
  const children = await json<GridNode[]>(fetchFn, `${GRID}/${id}/children`);
  const communes = children.filter((c) => c.type === 'municipality');
  if (communes.length > 0) return communes.map((c) => ({ insee: c.name, title: c.title }));
  // France ou région : on descend jusqu'au premier département, pour rester léger
  const dept = children.find((c) => c.type === 'departement');
  if (dept) return fetchGridCommunes(fetchFn, dept.name);
  const region = children.find((c) => c.type === 'region');
  return region ? fetchGridCommunes(fetchFn, region.name) : [];
}

export async function fetchGridGeometry(fetchFn: FetchFn, id: string): Promise<MultiPoly> {
  const node = await json<GridNode>(fetchFn, `${GRID}/${id}`);
  if (!node.geometry) throw new Error(`Pas de géométrie pour ${id}`);
  return parseWkt(node.geometry);
}

export async function fetchCommuneTitle(fetchFn: FetchFn, insee: string): Promise<Commune> {
  const node = await json<GridNode>(fetchFn, `${GRID}/${insee}`);
  return { insee, title: node.title };
}

const centroid = (mp: MultiPoly): Coord => {
  const ring = mp[0][0];
  const n = ring.length - 1 || 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
};

export function unionAll(cells: MultiPoly[]): MultiPoly {
  if (cells.length === 1) return cells[0];
  const [first, ...rest] = cells;
  return polygonClipping.union(first as never, ...(rest as never[])) as unknown as MultiPoly;
}

function bboxOf(cells: MultiPoly[]): [number, number, number, number] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const mp of cells)
    for (const poly of mp)
      for (const [x, y] of poly[0]) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
  return [w, s, e, n];
}

/** Construit les géométries factices à partir de cellules (parcelles ou communes). */
export function buildGeometries(
  cells: MultiPoly[],
  communes: Commune[],
  zoneCount: number,
): Geometries {
  const sorted = [...cells].sort(
    (a, b) => centroid(a)[0] - centroid(b)[0] || centroid(a)[1] - centroid(b)[1],
  );
  const k = Math.max(1, Math.min(zoneCount, sorted.length));
  const size = Math.ceil(sorted.length / k);
  const zones: MultiPoly[] = [];
  for (let i = 0; i < sorted.length; i += size) zones.push(unionAll(sorted.slice(i, i + size)));
  return {
    communes,
    zones,
    surfaces: sorted.slice(0, 2),
    lines: [sorted[0][0].slice(0, 1)],
    points: [[centroid(sorted[0])]],
    bbox: bboxOf(cells),
  };
}

/**
 * Commune (INSEE, 5 car.) : parcelles du cadastre (WFS Géoplateforme).
 * EPCI, SCoT, département, région ou France : communes via l'API GpU (nombre limité).
 */
export async function loadGeometries(fetchFn: FetchFn, code: string): Promise<Geometries> {
  if (code.length === 5) {
    const [parcels, commune] = await Promise.all([
      fetchParcels(fetchFn, code),
      fetchCommuneTitle(fetchFn, code).catch(() => ({ insee: code, title: code })),
    ]);
    return buildGeometries(parcels, [commune], ZONE_COUNT);
  }
  const communes = await fetchGridCommunes(fetchFn, code);
  if (communes.length === 0) throw new Error(`Aucune commune trouvée pour ${code}`);
  const shapes = await Promise.all(
    communes.slice(0, MAX_COMMUNES).map((c) => fetchGridGeometry(fetchFn, c.insee)),
  );
  return buildGeometries(shapes, communes, shapes.length);
}
