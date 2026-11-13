// Copie les modèles de validator-config-gpu (communes et EPCI) vers public/config et génère index.json.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = 'node_modules/validator-config-gpu/config';
const dest = 'public/config';
const FAMILIES =
  /^(cnig_(PLU|PLUi|POS|CC|PSMV)_\d{4}|cnig_SCoT_\d{4}|cnig_SUP_\w+_\d{4}|GPU_MEC_\d{4})$/;

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const index = [];
for (const name of readdirSync(src)
  .filter((n) => FAMILIES.test(n))
  .sort()) {
  cpSync(join(src, name), join(dest, name), { recursive: true });
  const files = JSON.parse(readFileSync(join(src, name, 'files.json'), 'utf8'));
  index.push({ name, folderName: files.constraints.folderName });
}
writeFileSync(join(dest, 'index.json'), JSON.stringify(index, null, 1));
console.log(`copy-config : ${index.length} modèles`);
