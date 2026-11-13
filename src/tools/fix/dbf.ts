/** Lecture et modification en place d'un fichier dBase (.dbf) : la structure du fichier est conservée à l'octet près. */

export interface DbfField {
  name: string;
  type: string;
  length: number;
  offset: number; // décalage du champ dans l'enregistrement (après l'octet de suppression)
}

const encoderFor = (encoding: string) => {
  if (/utf-?8/i.test(encoding)) return (s: string) => new TextEncoder().encode(s);
  // 8 bits (windows-1252 / ISO-8859-1) : un caractère = un octet, '?' si hors table
  return (s: string) => Uint8Array.from(s, (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
};

/** Encodage déduit du contenu du .cpg voisin (ex. « UTF-8 », « ISO-8859-1 », « 1252 »). */
export function encodingFromCpg(cpg: string | undefined): string {
  const v = (cpg ?? '').trim();
  if (/utf-?8/i.test(v)) return 'utf-8';
  return 'windows-1252';
}

export class Dbf {
  readonly fields: DbfField[] = [];
  readonly count: number;
  private readonly view: DataView;
  private readonly headerLength: number;
  private readonly recordLength: number;
  private readonly decoder: TextDecoder;
  private readonly encode: (s: string) => Uint8Array;
  private data: Uint8Array;

  constructor(bytes: Uint8Array, encoding = 'windows-1252') {
    this.data = bytes.slice();
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    if (this.data.length < 33) throw new Error('Fichier .dbf invalide');
    this.count = this.view.getUint32(4, true);
    this.headerLength = this.view.getUint16(8, true);
    this.recordLength = this.view.getUint16(10, true);
    this.decoder = new TextDecoder(encoding);
    this.encode = encoderFor(encoding);
    let offset = 1;
    for (let p = 32; p + 32 <= this.headerLength && this.data[p] !== 0x0d; p += 32) {
      const raw = this.data.subarray(p, p + 11);
      const end = raw.indexOf(0);
      const name = new TextDecoder('latin1').decode(end < 0 ? raw : raw.subarray(0, end));
      const length = this.data[p + 16];
      this.fields.push({ name, type: String.fromCharCode(this.data[p + 11]), length, offset });
      offset += length;
    }
  }

  get header(): string[] {
    return this.fields.map((f) => f.name);
  }

  private recordStart(row: number): number {
    return this.headerLength + row * this.recordLength;
  }

  isDeleted(row: number): boolean {
    return this.data[this.recordStart(row)] === 0x2a;
  }

  get(row: number, col: number): string {
    const f = this.fields[col];
    const start = this.recordStart(row) + f.offset;
    const text = this.decoder.decode(this.data.subarray(start, start + f.length));
    return f.type === 'N' || f.type === 'F' ? text.trim() : text.replace(/[ \0]+$/, '');
  }

  /** Remplace la valeur d'une cellule texte (C) ou date (D). Renvoie false si elle ne tient pas dans la largeur du champ. */
  set(row: number, col: number, value: string): boolean {
    const f = this.fields[col];
    if (f.type !== 'C' && f.type !== 'D') return false;
    const bytes = this.encode(value);
    if (bytes.length > f.length) return false;
    const start = this.recordStart(row) + f.offset;
    this.data.fill(0x20, start, start + f.length);
    this.data.set(bytes, start);
    return true;
  }

  rows(): string[][] {
    const out: string[][] = [];
    for (let r = 0; r < this.count; r++) out.push(this.fields.map((_, c) => this.get(r, c)));
    return out;
  }

  bytes(): Uint8Array {
    return this.data;
  }
}
