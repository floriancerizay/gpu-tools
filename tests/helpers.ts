import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelSource } from '../src/tools/generator/model';

export const fsSource: ModelSource = {
  text: (p) => readFile(join('node_modules/validator-config-gpu/config', p), 'utf8'),
};
