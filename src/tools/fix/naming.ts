import type { FileEntry, ModelSource } from '../generator/model';
import { fullMatch, substitute, type DocInfo } from '../generator/regex';
import type { DocArchive } from './archive';

/** Entrées (fichiers et répertoires attendus) d'un standard. */
export async function loadEntries(source: ModelSource, modelName: string): Promise<FileEntry[]> {
  return JSON.parse(await source.text(`${modelName}/files.json`)).files as FileEntry[];
}

const TABLE_EXT = /\.(shp|shx|dbf|prj|cpg|qpj|csv)$/i;

const matches = (entries: FileEntry[], info: DocInfo, candidate: string) =>
  entries.some((e) => {
    try {
      return fullMatch(substitute(e.path, info), candidate);
    } catch {
      return false;
    }
  });

/** Nom conforme ou non au standard, pour chaque fichier et chaque répertoire du document (chemins relatifs). */
export function checkNaming(doc: DocArchive, entries: FileEntry[]): Map<string, boolean> {
  const info = doc.info;
  const byType = (t: string) => entries.filter((e) => e.type === t);
  const result = new Map<string, boolean>();
  for (const d of doc.dirs) result.set(d, matches(byType('directory'), info, d));
  for (const path of doc.files.keys()) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const name = path.slice(dir.length);
    let ok = false;
    if (TABLE_EXT.test(name))
      ok = matches(byType('table'), info, dir + name.replace(TABLE_EXT, ''));
    else if (/\.pdf$/i.test(name))
      ok = matches(byType('pdf'), info, dir + name.replace(/\.pdf$/i, ''));
    else if (/\.xml$/i.test(name))
      ok = matches(byType('metadata'), info, dir + name.replace(/\.xml$/i, ''));
    result.set(path, ok);
  }
  return result;
}
