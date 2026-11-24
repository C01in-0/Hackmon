import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionAsset } from '../src/production-assets.js';

// Run only against a release staging directory or the isolated Docker image.
export async function preparePublic(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:js|css)$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.name === 'developer-panel.js') { await rm(path); continue; }
    await writeFile(path, productionAsset('/' + entry.name, await readFile(path, 'utf8')));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await preparePublic(resolve(process.argv[2] || 'public'));
}
