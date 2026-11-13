import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDocument, zipDocument } from '../src/tools/generator/generate';
import { buildGeometries } from '../src/tools/generator/geometry';
import { DocArchive } from '../src/tools/fix/archive';
import { Dbf } from '../src/tools/fix/dbf';
import { checkNaming, loadEntries } from '../src/tools/fix/naming';
import { fsSource } from './helpers';

const square = (x: number): [number, number][][][] => [
  [
    [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
      [x, 0],
    ],
  ],
];
const geometries = buildGeometries(
  [0, 1, 2, 3, 4, 5].map((i) => square(i * 2)),
  [
    { insee: '25349', title: 'LORAY' },
    { insee: '25350', title: 'AUTRE' },
  ],
  3,
);

async function generated(
  folder: string,
  modelName: string,
  includeOptional = false,
): Promise<DocArchive> {
  const doc = await generateDocument({
    folder,
    modelName,
    includeOptional,
    source: fsSource,
    fetchFn: () => {
      throw new Error('pas de réseau');
    },
    geometries,
    today: '2026-11-09',
  });
  return DocArchive.load(await zipDocument(doc));
}

/** Fichier dBase minimal (champs texte) pour les tests. */
function buildDbf(fields: [string, number][], rows: string[][]): Uint8Array {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((s, [, l]) => s + l, 0);
  const out = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const v = new DataView(out.buffer);
  out[0] = 3;
  v.setUint32(4, rows.length, true);
  v.setUint16(8, headerLength, true);
  v.setUint16(10, recordLength, true);
  fields.forEach(([name, len], i) => {
    const p = 32 + i * 32;
    out.set(new TextEncoder().encode(name), p);
    out[p + 11] = 'C'.charCodeAt(0);
    out[p + 16] = len;
  });
  out[headerLength - 1] = 0x0d;
  rows.forEach((r, i) => {
    let p = headerLength + i * recordLength;
    out[p++] = 0x20;
    r.forEach((cell, c) => {
      out.fill(0x20, p, p + fields[c][1]);
      out.set(new TextEncoder().encode(cell), p);
      p += fields[c][1];
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}

describe('dbf', () => {
  it('lit et modifie en place', () => {
    const bytes = buildDbf(
      [
        ['IDURBA', 30],
        ['DATAPPRO', 8],
      ],
      [
        ['25349_PLU_20240101', '20240101'],
        ['autre', '19990101'],
      ],
    );
    const dbf = new Dbf(bytes);
    expect(dbf.header).toEqual(['IDURBA', 'DATAPPRO']);
    expect(dbf.rows()[1]).toEqual(['autre', '19990101']);
    expect(dbf.set(0, 1, '20250202')).toBe(true);
    expect(dbf.set(0, 1, '202502021')).toBe(false); // trop long : champ inchangé
    const again = new Dbf(dbf.bytes());
    expect(again.rows()).toEqual([
      ['25349_PLU_20240101', '20250202'],
      ['autre', '19990101'],
    ]);
    expect(dbf.bytes().length).toBe(bytes.length);
  });
});

describe('correcteur : changement de date et de code', () => {
  it('PLU : tout le document suit la nouvelle date, les géométries restent', async () => {
    const doc = await generated('25349_PLU_20240101', 'cnig_PLU_2024', true);
    const zones = [...doc.files.keys()].find((p) => p.includes('ZONE_URBA'))!;
    const wkt = new TextDecoder().decode(doc.files.get(zones)).match(/MULTIPOLYGON[^"]*/)![0];
    const r = doc.retarget({ date: '20250305' });
    expect(r.folder).toBe('25349_PLU_20250305');
    expect([...doc.files.keys()].every((p) => !p.includes('20240101'))).toBe(true);
    const zones2 = [...doc.files.keys()].find((p) => p.includes('ZONE_URBA'))!;
    const csv = new TextDecoder().decode(doc.files.get(zones2));
    expect(csv).toContain('25349_PLU_20250305');
    expect(csv).not.toContain('20240101');
    expect(csv).toContain(wkt);
    const xml = new TextDecoder().decode(doc.files.get('25349_PLU_20250305.xml'));
    expect(xml).toContain('<gco:Date>2025-03-05</gco:Date>');
  });

  it('ne touche que les lignes dont IDURBA est celui du document (.dbf)', async () => {
    const doc = await generated('25349_PLU_20240101', 'cnig_PLU_2024');
    const dbf = buildDbf(
      [
        ['IDURBA', 30],
        ['DATAPPRO', 8],
        ['NOM_FIC', 60],
      ],
      [
        ['25349_PLU_20240101', '20240101', '25349_reglement_20240101.pdf'],
        ['25349_PLU_19990101', '19990101', '25349_reglement_19990101.pdf'],
      ],
    );
    doc.addFile('Donnees_geographiques/25349_ZONE_URBA_20240101.dbf', dbf);
    doc.retarget({ date: '20250305' });
    const out = new Dbf(doc.files.get('Donnees_geographiques/25349_ZONE_URBA_20250305.dbf')!);
    expect(out.rows()).toEqual([
      ['25349_PLU_20250305', '20250305', '25349_reglement_20250305.pdf'],
      ['25349_PLU_19990101', '19990101', '25349_reglement_19990101.pdf'],
    ]);
  });

  it('renommer un PDF met à jour ses références dans les tables', async () => {
    const doc = await generated('25349_PLU_20240101', 'cnig_PLU_2024');
    const pdf = 'Pieces_ecrites/3_Reglement/25349_reglement_20240101.pdf';
    const n = doc.renameFile(pdf, 'Pieces_ecrites/3_Reglement/25349_reglement_20240102.pdf');
    expect(n).toBeGreaterThan(0);
    const all = [...doc.files]
      .filter(([p]) => p.endsWith('.csv'))
      .map(([, c]) => new TextDecoder().decode(c))
      .join('\n');
    expect(all).toContain('25349_reglement_20240102.pdf');
    expect(all).not.toContain('25349_reglement_20240101.pdf');
  });

  it('refuse un nom qui ne correspond à aucun standard et un doublon', async () => {
    const doc = await generated('25349_PLU_20240101', 'cnig_PLU_2024');
    expect(() => doc.retarget({ date: '2025' })).toThrow();
    expect(() => doc.retarget({ code: 'x' })).toThrow();
    const [a, b] = [...doc.files.keys()];
    expect(() => doc.renameFile(a, b)).toThrow();
  });
});

describe('contrôle des noms', () => {
  it('un document généré est conforme, un nom altéré est signalé', async () => {
    const doc = await generated('25349_PLU_20240101', 'cnig_PLU_2024', true);
    const entries = await loadEntries(fsSource, 'cnig_PLU_2024');
    expect([...checkNaming(doc, entries)].filter(([, ok]) => !ok)).toEqual([]);
    doc.renameFile(
      'Pieces_ecrites/3_Reglement/25349_reglement_20240101.pdf',
      'Pieces_ecrites/3_Reglement/reglement.pdf',
    );
    doc.addDir('Dossier_inconnu');
    const bad = [...checkNaming(doc, entries)]
      .filter(([, ok]) => !ok)
      .map(([p]) => p)
      .sort();
    expect(bad).toEqual(['Dossier_inconnu', 'Pieces_ecrites/3_Reglement/reglement.pdf']);
  });
});

const jar = 'bin/validator-cli.jar';
describe.skipIf(!existsSync(jar))('conformité après correction (validator-cli)', () => {
  const cases: [string, string, { code?: string; date?: string }][] = [
    ['25349_PLU_20240101', 'cnig_PLU_2024', { date: '20250305' }],
    ['25349_PLU_20240101', 'cnig_PLU_2024', { code: '25351' }],
    ['200040715_SCOT_20240101', 'cnig_SCoT_2024', { code: '200040716', date: '20250101' }],
    ['25349_PLU_MEC1_20240101', 'GPU_MEC_2025', { code: '25350', date: '20250202' }],
    ['123456789_AC1_25349_20240101', 'cnig_SUP_AC1_2016', { code: '25350', date: '20250202' }],
    ['123456789_A8_25349_20240101', 'cnig_SUP_A8_2013', { date: '20250202' }],
  ];
  for (const [folder, model, change] of cases) {
    it(`${model} ${JSON.stringify(change)} sans erreur`, async () => {
      const doc = await generated(folder, model, true);
      const { folder: name } = doc.retarget(change);
      const dir = mkdtempSync(join(tmpdir(), 'fix-'));
      for (const d of doc.dirs) mkdirSync(join(dir, name, d), { recursive: true });
      for (const [p, c] of doc.files) {
        const full = join(dir, name, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, c);
      }
      const out = mkdtempSync(join(tmpdir(), 'fix-out-'));
      try {
        execFileSync(
          'java',
          [
            '-jar',
            jar,
            'document_validator',
            '--model',
            `file://${process.cwd()}/node_modules/validator-config-gpu/config/${model}/files.json`,
            '--input',
            join(dir, name),
            '--srs',
            'CRS:84',
            '--enable-conditions',
            '-O',
            out,
          ],
          { stdio: 'ignore' },
        );
      } catch {
        /* on lit le rapport */
      }
      const errors = readFileSync(join(out, 'validation.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((d) => d.level === 'ERROR');
      expect(errors.map((e) => `${e.code} ${e.file} ${e.attribute}`)).toEqual([]);
    });
  }
});
