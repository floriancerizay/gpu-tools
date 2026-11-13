import type { Column, DocumentModel, TableModel } from './model';
import { fullMatch, generateFromPattern, type DocInfo } from './regex';
import { unionAll, type Geometries } from './geometry';
import { multiLineWkt, multiPointWkt, multiPolygonWkt } from './wkt';

export interface TableCtx {
  info: DocInfo;
  model: DocumentModel;
  geo: Geometries;
  /** noms (avec extension) des PDF déjà générés */
  pdfs: string[];
  /** ajoute un PDF manquant (référencé par une colonne Filename) et renvoie son nom */
  registerPdf(name: string): void;
}

export interface Table {
  header: string[];
  rows: string[][];
}

const PREFERRED: Record<string, (info: DocInfo) => string[]> = {
  TYPEZONE: () => ['U', 'AU', 'A', 'N'],
  ETAT: () => ['03'],
  TYPEDOC: (info) => [info.family.toUpperCase()],
};

/** Lignes à produire et géométrie associée, selon le type de la colonne géométrique. */
function geometryRows(
  table: TableModel,
  geo: Geometries,
): { col: Column; wkts: string[] } | undefined {
  const col = table.columns.find((c) => /^Multi(Polygon|LineString|Point)$/.test(c.type));
  if (!col) return undefined;
  if (col.type === 'MultiPolygon') {
    // périmètres : une seule ligne couvrant tout le territoire
    if (table.name === 'PERIMETRE_SCOT' || table.name === 'MEC')
      return { col, wkts: [multiPolygonWkt(unionAll(geo.zones))] };
    const list = table.name === 'ZONE_URBA' ? geo.zones : geo.surfaces;
    return { col, wkts: list.map(multiPolygonWkt) };
  }
  if (col.type === 'MultiLineString') return { col, wkts: geo.lines.map(multiLineWkt) };
  return { col, wkts: geo.points.map(multiPointWkt) };
}

function codeList(col: Column, table: TableModel, model: DocumentModel) {
  const names = new Set(table.columns.map((c) => c.name));
  const found = Object.entries(model.codes).filter(
    ([, l]) =>
      l.header.includes(col.name) &&
      (l.header.length === 1 || l.header.some((h) => h !== col.name && names.has(h))),
  );
  if (found.length === 0) return undefined;
  if (found.length === 1) return found[0];
  const letter = table.name.endsWith('_SURF') ? 'S' : table.name.endsWith('_LIN') ? 'L' : 'P';
  return found.find(([n]) => n.includes(`${letter}Urba`)) ?? found[0];
}

function pickRow(
  listName: string,
  rows: string[][],
  idx: number,
  prefer: string[] | undefined,
  headerIdx: number,
  i: number,
) {
  void listName;
  if (prefer) {
    const ok = rows.filter((r) => prefer.includes(r[headerIdx]));
    if (ok.length > 0) return ok[i % ok.length];
  }
  return rows[(i + idx) % rows.length];
}

function resolveFilename(col: Column, ctx: TableCtx, register = true): string {
  const pattern = col.constraints?.pattern;
  if (pattern) {
    const hit = ctx.pdfs.find((n) => fullMatch(pattern, n));
    if (hit) return hit;
    if (!register) return '';
    const name = generateFromPattern(pattern, ctx.info);
    ctx.registerPdf(name);
    return name;
  }
  // pièce dont le type figure dans le nom de la colonne (ex. colonne DOO -> *_doo_*.pdf)
  const byColumn = ctx.pdfs.find((n) => n.toLowerCase().includes(`_${col.name.toLowerCase()}_`));
  if (byColumn) return byColumn;
  return (
    ctx.pdfs.find((n) => /_reglement_\d{8}/.test(n)) ??
    ctx.pdfs.find((n) => n.includes('reglement')) ??
    ctx.pdfs[0] ??
    `${ctx.info.code}_reglement_${ctx.info.date}.pdf`
  );
}

function fallbackString(col: Column): string {
  const k = col.constraints ?? {};
  let v = 'Test';
  while (k.minLength && v.length < k.minLength) v += 'x';
  return k.maxLength ? v.slice(0, k.maxLength) : v;
}

/**
 * Colonnes à renseigner pour satisfaire une règle « A IS NOT NULL OR <autre condition> » :
 * la première colonne (si facultative) est remplie, ce qui rend la règle vraie dans tous les cas.
 */
function conditionalFills(table: TableModel): Set<string> {
  const out = new Set<string>();
  const optional = (n: string) =>
    table.columns.some((c) => c.name === n && !c.constraints?.required);
  for (const cond of table.constraints?.conditions ?? []) {
    const m = /^\s*(\w+) IS NOT NULL OR /.exec(cond);
    if (m && optional(m[1])) out.add(m[1]);
  }
  return out;
}

/** Valeurs imposées par une règle « COL LIKE 'X' » (ex. INTERCO LIKE 'T' pour les PLUi 2014). */
function forcedValues(table: TableModel): Map<string, string> {
  const out = new Map<string, string>();
  for (const cond of table.constraints?.conditions ?? []) {
    const m = /^\s*(\w+) LIKE '([^'%_]*)'\s*$/.exec(cond);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** Identifiants reliant les tables d'une SUP : SERVITUDE (IDSUP) > ACTE (IDACTE) et GENERATEUR (IDGEN) > ASSIETTE (IDASS). */
/** Acte instituant la servitude : le PDF existant, ou un PDF ajouté (facultatif dans le standard 2013, mais référencé par ACTE_SUP). */
function supActe(ctx: TableCtx): string {
  const hit = ctx.pdfs.find((n) => /_act\.pdf$/.test(n));
  if (hit) return hit;
  const name = `${ctx.info.category}_A_${ctx.info.date}_act.pdf`;
  ctx.registerPdf(name);
  return name;
}

function supValue(col: Column, i: number, ctx: TableCtx): string | undefined {
  const { info } = ctx;
  const sup = `${info.category}-${info.idgest}-1`;
  if (col.type === 'Integer' && /^ID(SUP|ACTE|GEN|ASS)$/.test(col.name)) {
    // standard 2013 : identifiants entiers (SERVITUDE et ACTE_SUP : 1 ligne ; un générateur et une assiette par ligne)
    return String(col.name === 'IDGEN' || col.name === 'IDASS' ? i + 1 : 1);
  }
  switch (col.name) {
    case 'IDGEST':
      return info.idgest;
    case 'CATEGORIE':
      return info.category!;
    case 'IDSUP':
      return sup;
    case 'IDACTE':
      return `${sup}-1`;
    case 'IDGEN':
      return `${sup}-${i + 1}`;
    case 'IDASS':
      return `${sup}-${i + 1}-1`;
    case 'FICHIER':
      return supActe(ctx);
    case 'NOMACTE':
      return supActe(ctx).replace(/\.pdf$/, '');
    default:
      return undefined;
  }
}

export function buildTable(table: TableModel, ctx: TableCtx): Table {
  const mustFill = conditionalFills(table);
  const forced = forcedValues(table);
  const { info, model, geo } = ctx;
  const geom = geometryRows(table, geo);
  let count = geom ? geom.wkts.length : 1;
  if (table.name === 'DOC_URBA_COM') count = geo.communes.length;
  if (table.name === 'TITRES_PIECES_ECRITES') count = Math.max(1, ctx.pdfs.length);

  const rows: string[][] = [];
  for (let i = 0; i < count; i++) {
    const chosenRows = new Map<string, string[]>();
    const row = table.columns.map((col) => {
      const k = col.constraints ?? {};
      if (geom && col === geom.col) return geom.wkts[i];
      if (forced.has(col.name)) return forced.get(col.name)!;
      if (info.kind === 'sup') {
        const v = supValue(col, i, ctx);
        if (v !== undefined) return v;
      }
      if (col.name === 'IDURBA') return info.folder;
      if (table.name === 'DOC_URBA_COM' && col.name === 'INSEE') return geo.communes[i].insee;
      if (table.name === 'TITRES_PIECES_ECRITES') {
        const f = ctx.pdfs[i] ?? 'document.pdf';
        return col.name === 'TITRE' ? f.replace(/\.pdf$/, '').slice(0, k.maxLength ?? 80) : f;
      }
      // Règles conditionnelles (constraints.conditions) : documents et date d'approbation renseignés
      // dès qu'ils existent, pour satisfaire les règles du type « NOMREG IS NOT NULL OR URLREG IS NOT NULL ».
      if (!k.required && !mustFill.has(col.name)) {
        if (col.type === 'Filename' || /\\\.pdf/.test(k.pattern ?? ''))
          return resolveFilename(col, ctx, false);
        if (col.name === 'DATAPPRO') return info.date;
        return '';
      }
      if (k.enum && k.enum.length > 0) return k.enum[0];
      const list = codeList(col, table, model);
      if (list) {
        const [name, l] = list;
        const key = `${name}`;
        const h = l.header.indexOf(col.name);
        let r = chosenRows.get(key);
        const names = new Set(table.columns.map((c) => c.name));
        const complete = l.rows.filter((row) =>
          l.header.every((hd, k) => !names.has(hd) || row[k] !== ''),
        );
        if (!r || !PREFERRED[col.name])
          r = pickRow(
            name,
            complete.length > 0 ? complete : l.rows,
            0,
            PREFERRED[col.name]?.(info),
            h,
            info.kind === 'sup' ? 0 : i,
          );
        chosenRows.set(key, r);
        return r[h];
      }
      if (col.type === 'Filename') return resolveFilename(col, ctx);
      if (k.pattern) {
        if (k.unique && /\[0-9\]\+$/.test(k.pattern)) {
          return generateFromPattern(k.pattern.replace(/\[0-9\]\+$/, String(i + 1)), info);
        }
        return generateFromPattern(k.pattern, info);
      }
      if (col.type === 'Url') return 'https://example.org/test';
      if (col.type === 'Integer') return '1';
      if (col.type === 'Double') return '1.0';
      if (col.type === 'Boolean') return 'T';
      return fallbackString(col);
    });
    if (table.name === 'ZONE_URBA') {
      const t = table.columns.findIndex((c) => c.name === 'TYPEZONE');
      const l = table.columns.findIndex((c) => c.name === 'LIBELLE');
      if (t >= 0 && l >= 0) row[l] = `${row[t]}${i + 1}`.slice(0, 12);
    }
    rows.push(row);
  }
  return { header: table.columns.map((c) => c.name), rows };
}

const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(t: Table): string {
  return [t.header, ...t.rows].map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
