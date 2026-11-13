// Génère un document en ligne de commande : npm run generate -- <nom> <modèle> <dossier de sortie> [--all]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateDocument } from '../src/tools/generator/generate';
import { fsSource } from '../tests/helpers';

const [folder, modelName, out = 'out', flag] = process.argv.slice(2);
if (!folder || !modelName) {
  console.error('usage : npm run generate -- <nom-document> <modèle> [dossier] [--all]');
  process.exit(1);
}
const doc = await generateDocument({
  folder,
  modelName,
  includeOptional: flag === '--all',
  source: fsSource,
  fetchFn: (u) => fetch(u),
});
for (const d of doc.dirs) await mkdir(join(out, folder, d), { recursive: true });
for (const [path, content] of doc.files) {
  const full = join(out, folder, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}
console.log(`${doc.files.size} fichiers écrits dans ${join(out, folder)}`);
