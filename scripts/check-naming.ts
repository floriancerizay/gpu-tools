// Vérifie que le contrôle des noms du Correcteur accepte les documents générés pour tous les modèles.
import { readFileSync } from 'node:fs';
import { DocArchive } from '../src/tools/fix/archive';
import { checkNaming, loadEntries } from '../src/tools/fix/naming';
import { generateDocument, zipDocument } from '../src/tools/generator/generate';
import { buildGeometries } from '../src/tools/generator/geometry';
import { fsSource } from '../tests/helpers';

const sq = (x: number): [number, number][][][] => [
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
  [0, 1, 2].map((i) => sq(i * 2)),
  [{ insee: '25349', title: 'L' }],
  3,
);
const pick = (m: string) =>
  /^cnig_SCoT/.test(m)
    ? '200040715_SCOT_20240101'
    : /^GPU_MEC/.test(m)
      ? '25349_PLU_MEC1_20240101'
      : /^cnig_SUP_(.+)_\d{4}$/.test(m)
        ? `123456789_${/^cnig_SUP_(.+)_\d{4}$/.exec(m)![1]}_25349_20240101`
        : `25349_${m.split('_')[1]}_20240101`;
let bad = 0;
const models = (
  JSON.parse(readFileSync('public/config/index.json', 'utf8')) as { name: string }[]
).map((m) => m.name);
for (const m of models) {
  let folder = pick(m);
  if (/^cnig_PLUi/.test(m) || /_PLUi_/.test(folder)) folder = folder.replace('25349', '200040715');
  try {
    const doc = await generateDocument({
      folder,
      modelName: m,
      includeOptional: true,
      source: fsSource,
      fetchFn: () => {
        throw new Error('x');
      },
      geometries,
      today: '2026-11-09',
    });
    const arch = await DocArchive.load(await zipDocument(doc));
    const res = [...checkNaming(arch, await loadEntries(fsSource, m))].filter(([, ok]) => !ok);
    if (res.length) {
      bad++;
      console.log(`KO ${m}: ${JSON.stringify(res.slice(0, 3).map(([p]) => p))}`);
    }
  } catch (e) {
    bad++;
    console.log(`KO ${m}: ${(e as Error).message}`);
  }
}
console.log(`${models.length - bad}/${models.length} modèles sans nom non conforme`);
