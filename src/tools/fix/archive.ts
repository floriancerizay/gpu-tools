import JSZip from 'jszip';
import { matchModels, type ModelIndexEntry } from '../generator/model';
import { parseFolder, type DocInfo } from '../generator/regex';
import { openTable, tableKind, type TableFile } from './table';

export interface RetargetOptions {
  /** nouveau code territoire (INSEE, SIREN, département...) */
  code?: string;
  /** nouvelle date AAAAMMJJ */
  date?: string;
  /** si fourni, le nouveau nom de dossier doit correspondre à l'un de ces standards */
  models?: ModelIndexEntry[];
}

export interface RetargetReport {
  folder: string;
  renamedFiles: number;
  changedCells: number;
  changedXml: number;
  warnings: string[];
}

/** Colonnes de date remplacées lorsqu'elles valent l'ancienne date. */
const DATE_COLUMNS = new Set([
  'DATAPPRO',
  'DATVALID',
  'DATEMAJ',
  'DATEDECIS',
  'DATEPUB',
  'DATEFIN',
  'DATEREF',
]);
/** Colonnes de code territoire remplacées lorsqu'elles valent l'ancien code. */
const CODE_COLUMNS = new Set(['INSEE', 'SIREN', 'EPCI', 'IDGEST']);
/** Colonnes géométriques : jamais modifiées. */
const isGeometry = (col: string, cell: string) => col === 'WKT' || /^MULTI/i.test(cell);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remplace `from` par `to` lorsqu'il forme un mot entier (délimité par autre chose que lettre ou chiffre). */
function replaceToken(text: string, from: string, to: string): string {
  if (!from || from === to) return text;
  return text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(from)}(?![A-Za-z0-9])`, 'g'), to);
}

export function folderName(info: DocInfo, code: string, date: string): string {
  switch (info.kind) {
    case 'sup':
      return `${info.idgest}_${info.category}_${code}_${date}`;
    case 'mec':
      return `${code}_${info.family}_MEC${info.mec}_${date}`;
    default:
      return `${code}_${info.family}_${date}${info.suffix}`;
  }
}

const isoDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Document d'urbanisme en mémoire : dossier racine, fichiers (chemins relatifs) et répertoires. */
export class DocArchive {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();

  private constructor(public folder: string) {}

  get info(): DocInfo {
    return parseFolder(this.folder);
  }

  static async load(data: Blob | ArrayBuffer | Uint8Array): Promise<DocArchive> {
    const zip = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data);
    const entries = Object.values(zip.files);
    const roots = new Set(entries.map((e) => e.name.split('/')[0]));
    if (roots.size !== 1)
      throw new Error("L'archive doit contenir un seul dossier racine (le nom du document).");
    const folder = [...roots][0];
    parseFolder(folder); // nom de document valide, sinon erreur explicite
    const doc = new DocArchive(folder);
    for (const e of entries) {
      const rel = e.name.slice(folder.length + 1).replace(/\/$/, '');
      if (!rel) continue;
      if (e.dir) doc.dirs.add(rel);
      else doc.files.set(rel, await e.async('uint8array'));
    }
    doc.syncDirs();
    return doc;
  }

  /** Les répertoires parents de tous les fichiers existent. */
  private syncDirs() {
    for (const p of this.files.keys()) for (let d = dirname(p); d; d = dirname(d)) this.dirs.add(d);
  }

  async toZip(): Promise<Uint8Array> {
    const zip = new JSZip();
    const root = zip.folder(this.folder)!;
    for (const d of [...this.dirs].sort()) root.folder(d);
    for (const [p, c] of this.files) root.file(p, c);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /** Tables (CSV, dBase) du document ; `fn` peut modifier les cellules, les changements sont ensuite enregistrés. */
  private editTables(fn: (path: string, table: TableFile) => void) {
    for (const [path, bytes] of [...this.files]) {
      const kind = tableKind(path);
      if (!kind) continue;
      const cpg = this.files.get(path.replace(/\.dbf$/i, '.cpg'));
      const table = openTable(kind, bytes, cpg ? new TextDecoder().decode(cpg) : undefined);
      fn(path, table);
      const next = table.commit();
      if (next) this.files.set(path, next);
    }
  }

  /** Lignes d'une table concernées par le document : celles de l'IDURBA courant, ou toutes s'il n'y a pas d'IDURBA. */
  private rowsOf(table: TableFile): number[] {
    const idurba = table.header.indexOf('IDURBA');
    return table.rows.flatMap((r, i) => (idurba < 0 || r[idurba] === this.folder ? [i] : []));
  }

  /** Déplace ou renomme un fichier ; les références au nom de fichier dans les tables sont mises à jour. */
  renameFile(from: string, to: string): number {
    if (!this.files.has(from)) throw new Error(`Fichier introuvable : ${from}`);
    if (from === to) return 0;
    if (this.files.has(to)) throw new Error(`Un fichier existe déjà : ${to}`);
    let changed = 0;
    const [oldName, newName] = [basename(from), basename(to)];
    if (oldName !== newName && /\.pdf$/i.test(oldName)) {
      this.editTables((_, t) => {
        for (const i of this.rowsOf(t)) {
          t.header.forEach((_c, c) => {
            if (t.rows[i][c] === oldName && t.set(i, c, newName)) changed++;
          });
        }
      });
    }
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
    this.syncDirs();
    return changed;
  }

  /** Déplace ou renomme un répertoire et son contenu. */
  renameDir(from: string, to: string) {
    if (!this.dirs.has(from)) throw new Error(`Dossier introuvable : ${from}`);
    if (this.dirs.has(to)) throw new Error(`Un dossier existe déjà : ${to}`);
    for (const p of [...this.files.keys()]) {
      if (p.startsWith(`${from}/`)) this.renameFile(p, `${to}${p.slice(from.length)}`);
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        this.dirs.delete(d);
        this.dirs.add(`${to}${d.slice(from.length)}`);
      }
    }
    this.syncDirs();
  }

  addFile(path: string, bytes: Uint8Array) {
    if (this.files.has(path)) throw new Error(`Un fichier existe déjà : ${path}`);
    this.files.set(path, bytes);
    this.syncDirs();
  }

  addDir(path: string) {
    this.dirs.add(path);
    this.syncDirs();
  }

  removeFile(path: string) {
    this.files.delete(path);
  }

  removeDir(path: string) {
    for (const p of [...this.files.keys()]) if (p.startsWith(`${path}/`)) this.files.delete(p);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(`${path}/`)) this.dirs.delete(d);
  }

  /**
   * Change le code territoire et/ou la date dans tout le document : nom du dossier, noms de fichiers, lignes des tables
   * (CSV et dBase) dont IDURBA est celui du document, métadonnées XML. Les géométries (WKT, .shp, .shx, .prj) et les PDF
   * ne sont jamais modifiés.
   */
  retarget(opts: RetargetOptions): RetargetReport {
    const info = this.info;
    const oldFolder = this.folder;
    const code = opts.code?.trim() || info.code;
    const date = opts.date?.trim() || info.date;
    if (!/^\d{8}$/.test(date)) throw new Error('La date doit être au format AAAAMMJJ.');
    if (!/^[A-Za-z0-9]{2,9}$/.test(code))
      throw new Error('Le code doit comporter de 2 à 9 caractères alphanumériques.');
    const newFolder = folderName(info, code, date);
    const parsed = parseFolder(newFolder);
    if (parsed.code !== code || parsed.date !== date)
      throw new Error(`Nom de document invalide : ${newFolder}`);
    if (opts.models && matchModels(opts.models, newFolder).length === 0) {
      throw new Error(`Le nom ${newFolder} ne correspond à aucun standard.`);
    }

    const renameTokens = (s: string) =>
      replaceToken(replaceToken(s, info.code, code), info.date, date);
    const warnings: string[] = [];
    if (code !== info.code)
      warnings.push(
        'Les géométries n’ont pas été modifiées : elles correspondent toujours à l’ancien territoire.',
      );
    let changedCells = 0;
    let tooNarrow = 0;

    this.editTables((_, table) => {
      for (const i of this.rowsOf(table)) {
        table.header.forEach((col, c) => {
          const cell = table.rows[i][c];
          if (!cell || isGeometry(col, cell)) return;
          let next = cell;
          if (cell === info.date && DATE_COLUMNS.has(col)) next = date;
          else if (cell === info.code && CODE_COLUMNS.has(col)) next = code;
          else {
            next = cell.split(oldFolder).join(newFolder);
            if (/^\S+$/.test(next)) next = renameTokens(next);
          }
          if (next === cell) return;
          if (table.set(i, c, next)) changedCells++;
          else tooNarrow++;
        });
      }
    });
    if (tooNarrow)
      warnings.push(
        `${tooNarrow} valeur(s) n’ont pas pu être écrites dans un fichier .dbf (champ trop étroit).`,
      );

    let changedXml = 0;
    let renamedFiles = 0;
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of this.files) {
      const next = path.split('/').map(renameTokens).join('/');
      if (next !== path) renamedFiles++;
      if (/\.xml$/i.test(path)) {
        const before = new TextDecoder().decode(bytes);
        let text = before.split(oldFolder).join(newFolder);
        if (date !== info.date && !/^0+$/.test(info.date)) {
          text = text
            .split(`<gco:Date>${isoDate(info.date)}</gco:Date>`)
            .join(`<gco:Date>${isoDate(date)}</gco:Date>`);
        }
        if (text !== before) changedXml++;
        files.set(next, text === before ? bytes : new TextEncoder().encode(text));
      } else files.set(next, bytes);
    }
    this.files = files;
    this.dirs = new Set([...this.dirs].map((d) => d.split('/').map(renameTokens).join('/')));
    this.folder = newFolder;
    return { folder: newFolder, renamedFiles, changedCells, changedXml, warnings };
  }
}
