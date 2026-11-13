import { parseCsv } from '../generator/model';
import { toCsv } from '../generator/tables';
import { Dbf, encodingFromCpg } from './dbf';

/** Table modifiable, CSV ou dBase. Les modifications se font cellule par cellule ; `commit` produit le nouveau contenu. */
export interface TableFile {
  header: string[];
  rows: string[][];
  /** remplace la cellule ; renvoie false si la valeur ne peut pas être écrite (champ dBase trop étroit) */
  set(row: number, col: number, value: string): boolean;
  /** contenu mis à jour, ou undefined si rien n'a changé */
  commit(): Uint8Array | undefined;
}

export type TableKind = 'csv' | 'dbf';

export const tableKind = (path: string): TableKind | undefined => {
  if (/\.csv$/i.test(path)) return 'csv';
  if (/\.dbf$/i.test(path)) return 'dbf';
  return undefined;
};

export function openTable(kind: TableKind, bytes: Uint8Array, cpg?: string): TableFile {
  if (kind === 'csv') {
    const t = parseCsv(new TextDecoder().decode(bytes));
    let dirty = false;
    return {
      header: t.header,
      rows: t.rows,
      set(row, col, value) {
        if (t.rows[row][col] !== value) {
          t.rows[row][col] = value;
          dirty = true;
        }
        return true;
      },
      commit: () =>
        dirty ? new TextEncoder().encode(toCsv({ header: t.header, rows: t.rows })) : undefined,
    };
  }
  const dbf = new Dbf(bytes, encodingFromCpg(cpg));
  const rows = dbf.rows();
  let dirty = false;
  return {
    header: dbf.header,
    rows,
    set(row, col, value) {
      if (rows[row][col] === value) return true;
      if (!dbf.set(row, col, value)) return false;
      rows[row][col] = value;
      dirty = true;
      return true;
    },
    commit: () => (dirty ? dbf.bytes() : undefined),
  };
}
