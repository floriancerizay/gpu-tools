import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDocument, zipDocument } from '../src/tools/generator/generate';
import { buildGeometries } from '../src/tools/generator/geometry';
import { loadIndex, matchModels, parseCsv } from '../src/tools/generator/model';
import {
  fullMatch,
  generateFromPattern,
  parseFolder,
  substitute,
} from '../src/tools/generator/regex';
import { multiPolygonWkt, parseWkt } from '../src/tools/generator/wkt';
import { fsSource } from './helpers';

const square = (x: number, y: number): [number, number][][][] => [
  [
    [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ],
  ],
];
const geometries = buildGeometries(
  [0, 1, 2, 3, 4, 5].map((i) => square(i * 2, 0)),
  [{ insee: '25349', title: 'LORAY' }],
  3,
);

describe('regex', () => {
  const info = parseFolder('25349_PLU_20240101_a');
  it('parse le nom du dossier', () => {
    expect(info).toMatchObject({ code: '25349', family: 'PLU', date: '20240101', suffix: '_a' });
  });
  it('instancie un motif avec code, date et suffixe', () => {
    const p =
      '[AB0-9]{5}_PLU_([0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])|00000000)(_[a-zA-Z])?_ZO[0-9]+';
    expect(substitute(p, info)).toBe('25349_PLU_20240101_a_ZO[0-9]+');
    expect(fullMatch(p, generateFromPattern(p, info))).toBe(true);
  });
});

describe('noms de documents', () => {
  it('SCoT', () => {
    expect(parseFolder('200040715_SCOT_20240101')).toMatchObject({
      kind: 'scot',
      code: '200040715',
      family: 'SCOT',
    });
  });
  it('SUP : gestionnaire, catégorie, territoire, date', () => {
    expect(parseFolder('123456789_PM1bis_25349_20240101')).toMatchObject({
      kind: 'sup',
      idgest: '123456789',
      category: 'PM1bis',
      code: '25349',
      date: '20240101',
    });
    expect(parseFolder('123456789_AC1_FR_20240101')).toMatchObject({ kind: 'sup', code: 'FR' });
  });
  it('MEC', () => {
    expect(parseFolder('25349_PLU_MEC12_20240101')).toMatchObject({
      kind: 'mec',
      code: '25349',
      family: 'PLU',
      mec: '12',
    });
  });
  it('instancie catégorie et numéro de MEC', () => {
    const sup = parseFolder('123456789_AC1_25349_20240101');
    expect(substitute('Actes/[A-Za-z]{1,3}[0-9]{1,2}(bis)?_ACTE_SUP', sup)).toBe(
      'Actes/AC1_ACTE_SUP',
    );
    const mec = parseFolder('25349_PLU_MEC3_20240101');
    expect(substitute('(\\d{9}|(2A|2B|\\d{2})\\d{3})_MEC[0-9]+_0', mec)).toContain('25349_MEC3_0');
  });
});

describe('modèles', () => {
  it('trouve les millésimes dont le folderName accepte le nom', async () => {
    const index = await loadIndex({
      text: async () =>
        JSON.stringify([
          { name: 'cnig_PLU_2013', folderName: '[AB0-9]{5}_PLU_[0-9]{8}' },
          { name: 'cnig_CC_2013', folderName: '[AB0-9]{5}_CC_[0-9]{8}' },
        ]),
    });
    expect(matchModels(index, '25349_PLU_20240101').map((m) => m.name)).toEqual(['cnig_PLU_2013']);
  });
  it('lit un CSV avec champs entre guillemets', () => {
    expect(parseCsv('A,B\n1,"x, y"\n').rows).toEqual([['1', 'x, y']]);
  });
});

describe('wkt', () => {
  it('relit ce qu’il écrit', () => {
    const mp = [...square(0, 0), ...square(5, 5)];
    expect(parseWkt(multiPolygonWkt(mp))).toEqual(mp);
  });
});

describe('génération', () => {
  it("les modèles de communes et d'EPCI sont embarqués", async () => {
    const index = JSON.parse(await readFile('public/config/index.json', 'utf8')) as {
      name: string;
    }[];
    expect(index.length).toBeGreaterThan(0);
  });

  it('PLU 2024 : arborescence obligatoire et archive', async () => {
    const doc = await generateDocument({
      folder: '25349_PLU_20240101',
      modelName: 'cnig_PLU_2024',
      includeOptional: false,
      source: fsSource,
      fetchFn: () => {
        throw new Error('pas de réseau');
      },
      geometries,
      today: '2026-11-09',
    });
    const paths = [...doc.files.keys()];
    expect(paths).toContain('25349_PLU_20240101.xml');
    expect(paths).toContain('Pieces_ecrites/3_Reglement/25349_reglement_20240101.pdf');
    expect(paths.some((p) => p.endsWith('ZONE_URBA_20240101.csv'))).toBe(true);
    expect(paths.every((p) => !p.startsWith('/'))).toBe(true);
    const zip = await zipDocument(doc);
    expect(zip.length).toBeGreaterThan(1000);
  });
});

const jar = 'bin/validator-cli.jar';
describe.skipIf(!existsSync(jar))('conformité (validator-cli)', () => {
  for (const [folder, model] of [
    ['25349_PLU_20240101', 'cnig_PLU_2024'],
    ['25349_CC_20200101', 'cnig_CC_2022'],
    ['25349_POS_20100101', 'cnig_POS_2014'],
    ['200040715_SCOT_20240101', 'cnig_SCoT_2024'],
    ['200040715_SCOT_20180101', 'cnig_SCoT_2018'],
    ['25349_PLU_MEC1_20240101', 'GPU_MEC_2025'],
    ['123456789_AC1_25349_20240101', 'cnig_SUP_AC1_2016'],
    ['123456789_PM1bis_25349_20240101', 'cnig_SUP_PM1bis_2016'],
    ['123456789_A8_25349_20240101', 'cnig_SUP_A8_2013'],
  ]) {
    it(`${model} sans erreur`, async () => {
      const doc = await generateDocument({
        folder,
        modelName: model,
        includeOptional: true,
        source: fsSource,
        fetchFn: () => {
          throw new Error('pas de réseau');
        },
        geometries,
        today: '2026-11-09',
      });
      const dir = mkdtempSync(join(tmpdir(), 'gdg-'));
      for (const d of doc.dirs) mkdirSync(join(dir, folder, d), { recursive: true });
      for (const [p, c] of doc.files) {
        const full = join(dir, folder, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, c);
      }
      const out = mkdtempSync(join(tmpdir(), 'gdg-out-'));
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
            join(dir, folder),
            '--srs',
            'CRS:84',
            '--enable-conditions',
            '-O',
            out,
          ],
          { stdio: 'ignore' },
        );
      } catch {
        /* le code retour n'est pas significatif, on lit le rapport */
      }
      const { readFileSync } = await import('node:fs');
      const errors = readFileSync(join(out, 'validation.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((d) => d.level === 'ERROR');
      expect(errors.map((e) => `${e.code} ${e.file} ${e.attribute}`)).toEqual([]);
    });
  }
});
