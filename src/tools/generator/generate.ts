import JSZip from 'jszip';
import { loadGeometries, type FetchFn, type Geometries } from './geometry';
import { buildMetadata } from './metadata';
import { loadModel, type DocumentModel, type FileEntry, type ModelSource } from './model';
import { fakePdf } from './pdf';
import { generateFromPattern, parseFolder, type DocInfo } from './regex';
import { buildTable, toCsv } from './tables';

export interface GenerateOptions {
  folder: string;
  modelName: string;
  /** inclure aussi les entrées facultatives */
  includeOptional: boolean;
  source: ModelSource;
  fetchFn: FetchFn;
  /** géométries déjà calculées (tests) */
  geometries?: Geometries;
  today?: string;
}

const ANY = '[^\\/]*';

function splitEntryPath(path: string): { dir: string; file: string } {
  if (path.endsWith(`/${ANY}`)) return { dir: path.slice(0, -ANY.length - 1), file: ANY };
  if (path === ANY) return { dir: '', file: ANY };
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', file: path } : { dir: path.slice(0, i), file: path.slice(i + 1) };
}

/** Répertoire d'une entrée, motifs éventuels (ex. Secteur_[0-9]{2}) instanciés. */
function entryDir(e: FileEntry, info: DocInfo): string {
  const { dir } = splitEntryPath(e.path);
  return dir ? generateFromPattern(dir, info) : '';
}

/** Nom (sans extension) d'une entrée : le motif générique `[^/]*` est remplacé par un nom lisible. */
function entryStem(e: FileEntry, info: DocInfo): string {
  const { file } = splitEntryPath(e.path);
  if (file === ANY) return e.type === 'metadata' ? info.folder : 'annexe';
  return generateFromPattern(file, info);
}

export interface GeneratedDocument {
  /** chemins relatifs au dossier du document → contenu */
  files: Map<string, string | Uint8Array>;
  /** répertoires (y compris vides) */
  dirs: Set<string>;
  info: DocInfo;
  model: DocumentModel;
}

export async function generateDocument(opts: GenerateOptions): Promise<GeneratedDocument> {
  const info = parseFolder(opts.folder);
  const model = await loadModel(opts.source, opts.modelName);
  const geo = opts.geometries ?? (await loadGeometries(opts.fetchFn, info.code));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const files = new Map<string, string | Uint8Array>();
  const pdfBytes = await fakePdf();
  const pdfs: string[] = [];
  const dirs = new Set<string>();
  const pdfEntries = model.files.filter((f) => f.type === 'pdf');

  const wanted = model.files.filter((f) => opts.includeOptional || f.mandatory !== 'OPTIONAL');

  for (const e of wanted.filter((f) => f.type === 'directory'))
    dirs.add(generateFromPattern(e.path, info));

  for (const e of wanted.filter((f) => f.type === 'pdf')) {
    const dir = entryDir(e, info);
    const name = `${entryStem(e, info)}.pdf`;
    files.set(dir ? `${dir}/${name}` : name, pdfBytes);
    pdfs.push(name);
  }

  const registerPdf = (name: string) => {
    if (pdfs.includes(name)) return;
    const stem = name.replace(/\.pdf$/, '');
    const entry = pdfEntries.find((e) => {
      const { file } = splitEntryPath(e.path);
      return file !== ANY && new RegExp(`^(?:${file})$`).test(stem);
    });
    const dir = entry ? entryDir(entry, info) : 'Pieces_ecrites';
    files.set(`${dir}/${name}`, pdfBytes);
    pdfs.push(name);
  };

  for (const e of wanted.filter((f) => f.type === 'table')) {
    const dir = entryDir(e, info);
    const table = buildTable(model.tables[e.name], { info, model, geo, pdfs, registerPdf });
    files.set(dir ? `${dir}/${entryStem(e, info)}.csv` : `${entryStem(e, info)}.csv`, toCsv(table));
  }

  for (const e of wanted.filter((f) => f.type === 'metadata')) {
    const { file } = splitEntryPath(e.path);
    const dir = entryDir(e, info);
    if (file !== ANY) continue; // règlement XML (standard SRU) : hors périmètre
    const territory = geo.communes.length === 1 ? geo.communes[0].title : `${info.code}`;
    files.set(
      dir ? `${dir}/${entryStem(e, info)}.xml` : `${entryStem(e, info)}.xml`,
      buildMetadata({
        info,
        modelName: model.name,
        spec: model.metadataSpecification,
        bbox: geo.bbox,
        territory,
        today,
      }),
    );
  }

  return { files, dirs, info, model };
}

export async function zipDocument(doc: GeneratedDocument): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder(doc.info.folder)!;
  for (const d of doc.dirs) root.folder(d);
  for (const [path, content] of doc.files) root.file(path, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
