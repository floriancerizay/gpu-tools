// Génère puis valide (validator-cli) tous les modèles correspondant à un filtre, avec des géométries factices.
// usage : npx tsx scripts/validate-all.ts <regex-modèle> [--optional]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateDocument } from '../src/tools/generator/generate';
import { buildGeometries } from '../src/tools/generator/geometry';
import { parseFolder } from '../src/tools/generator/regex';
import { fsSource } from '../tests/helpers';

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

const filter = new RegExp(process.argv[2] ?? '.');
const optional = process.argv.includes('--optional');
const index = (
  JSON.parse(readFileSync('public/config/index.json', 'utf8')) as { name: string }[]
).filter((m) => filter.test(m.name));
let bad = 0;
for (const m of index) {
  try {
    const name = pickName(m.name);
    parseFolder(name);
    const doc = await generateDocument({
      folder: name,
      modelName: m.name,
      includeOptional: optional,
      source: fsSource,
      fetchFn: () => {
        throw new Error('pas de réseau');
      },
      geometries,
      today: '2026-11-09',
    });
    if (process.argv.includes('--show')) {
      console.log([...doc.files.keys()]);
      for (const [k, v] of doc.files)
        if (k.endsWith('.csv')) console.log(`${k}\n${String(v).slice(0, 500)}`);
    }
    const dir = mkdtempSync(join(tmpdir(), 'val-'));
    for (const d of doc.dirs) mkdirSync(join(dir, name, d), { recursive: true });
    for (const [p, c] of doc.files) {
      const f = join(dir, name, p);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, c);
    }
    const out = mkdtempSync(join(tmpdir(), 'val-out-'));
    try {
      execFileSync(
        'java',
        [
          '-jar',
          'bin/validator-cli.jar',
          'document_validator',
          '--model',
          `file://${process.cwd()}/node_modules/validator-config-gpu/config/${m.name}/files.json`,
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
      /* lire le rapport */
    }
    const errs = readFileSync(join(out, 'validation.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((d) => d.level === 'ERROR');
    if (errs.length) {
      bad++;
      console.log(`KO ${m.name} (${name})`);
      for (const e of errs.slice(0, 6))
        console.log(`   ${e.code} ${e.file} ${e.attribute} | ${String(e.message).slice(0, 140)}`);
    } else console.log(`ok ${m.name}`);
  } catch (e) {
    bad++;
    console.log(`KO ${m.name} : ${(e as Error).message}`);
  }
}
console.log(`${index.length - bad}/${index.length} sans erreur`);
process.exit(bad ? 1 : 0);

/** Nom de document représentatif pour un modèle. */
function pickName(model: string): string {
  const date = '20240101';
  if (/^cnig_SCoT/.test(model)) return `200040715_SCOT_${date}`;
  if (/^GPU_MEC/.test(model)) return `25349_PLU_MEC1_${date}`;
  const sup = /^cnig_SUP_(.+)_\d{4}$/.exec(model);
  if (sup) return `123456789_${sup[1]}_25349_${date}`;
  return `25349_PLU_${date}`;
}
