export type Coord = [number, number];
export type MultiPoly = Coord[][][];
export type MultiLine = Coord[][];
export type MultiPoint = Coord[];

const r = (n: number) => Math.round(n * 1e8) / 1e8;
const c = (p: Coord) => `${r(p[0])} ${r(p[1])}`;
const ring = (rg: Coord[]) => `(${rg.map(c).join(',')})`;

export const multiPolygonWkt = (mp: MultiPoly) =>
  `MULTIPOLYGON(${mp.map((poly) => `(${poly.map(ring).join(',')})`).join(',')})`;
export const multiLineWkt = (ml: MultiLine) => `MULTILINESTRING(${ml.map(ring).join(',')})`;
export const multiPointWkt = (pts: MultiPoint) =>
  `MULTIPOINT(${pts.map((p) => `(${c(p)})`).join(',')})`;

function parseRing(s: string): Coord[] {
  return s
    .trim()
    .split(',')
    .map((pt) => {
      const [x, y] = pt.trim().split(/\s+/).map(Number);
      return [x, y] as Coord;
    });
}

/** Découpe « (a),(b) » en [a, b] en respectant les parenthèses. */
function splitGroups(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (s[i] === ')') {
      depth--;
      if (depth === 0) out.push(s.slice(start, i));
    }
  }
  return out;
}

/** Lit un POLYGON ou MULTIPOLYGON WKT (2D) en MultiPolygon. */
export function parseWkt(wkt: string): MultiPoly {
  const t = wkt.trim();
  const m = /^(MULTIPOLYGON|POLYGON)\s*(\(.*\))$/is.exec(t);
  if (!m) throw new Error('WKT non supporté');
  const body = m[2];
  const polys = /^MULTIPOLYGON$/i.test(m[1]) ? splitGroups(body.slice(1, -1)) : [body.slice(1, -1)];
  return polys.map((poly) => splitGroups(poly).map(parseRing));
}
