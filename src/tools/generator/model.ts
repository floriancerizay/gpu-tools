/** Chargement des modèles de validator-config-gpu (files.json, types/*.json, codes/*.csv). */

export interface ModelSource {
  text(path: string): Promise<string>;
}

export type FileType = 'directory' | 'table' | 'pdf' | 'metadata';

export interface FileEntry {
  type: FileType;
  path: string;
  mandatory: string;
  name: string;
  tableModel?: string;
}

export interface Column {
  name: string;
  type: string;
  constraints?: {
    required?: boolean;
    unique?: boolean;
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    enum?: string[];
  };
}

export interface TableModel {
  name: string;
  columns: Column[];
  constraints?: { conditions?: string[] };
}

export interface CodeList {
  header: string[];
  rows: string[][];
}

export interface DocumentModel {
  name: string;
  folderName: string;
  /** intitulé de la spécification de métadonnées, ex. « CNIG SCoT v2024 » */
  metadataSpecification?: string;
  files: FileEntry[];
  tables: Record<string, TableModel>;
  codes: Record<string, CodeList>;
}

export interface ModelIndexEntry {
  name: string;
  folderName: string;
}

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string): CodeList {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  return { header: splitCsvLine(lines[0] ?? ''), rows: lines.slice(1).map(splitCsvLine) };
}

export async function loadIndex(source: ModelSource): Promise<ModelIndexEntry[]> {
  return JSON.parse(await source.text('index.json')) as ModelIndexEntry[];
}

export async function loadModel(source: ModelSource, name: string): Promise<DocumentModel> {
  const doc = JSON.parse(await source.text(`${name}/files.json`));
  const tables: Record<string, TableModel> = {};
  for (const f of doc.files as FileEntry[]) {
    if (f.type === 'table' && f.tableModel) {
      const rel = f.tableModel.replace(/^\.\//, '');
      tables[f.name] = JSON.parse(await source.text(`${name}/${rel}`)) as TableModel;
    }
  }
  const codes: Record<string, CodeList> = {};
  for (const c of (doc.codes ?? []) as { name: string; data: string }[]) {
    codes[c.name] = parseCsv(await source.text(`${name}/${c.data.replace(/^\.\//, '')}`));
  }
  return {
    name,
    folderName: doc.constraints.folderName,
    metadataSpecification: doc.constraints.metadataSpecification,
    files: doc.files,
    tables,
    codes,
  };
}

/** Modèles dont `constraints.folderName` accepte le nom de document saisi. */
export function matchModels(index: ModelIndexEntry[], folder: string): ModelIndexEntry[] {
  return index.filter((m) => new RegExp(`^(?:${m.folderName})$`).test(folder));
}
