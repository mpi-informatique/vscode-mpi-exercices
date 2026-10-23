import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'Indiquer un tag stable au format v0.1.0.');
for (const directory of ['', 'tp/']) {
  const manifest = JSON.parse(await readFile(new URL(`../${directory}package.json`, import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL(`../${directory}package-lock.json`, import.meta.url), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, `${directory}package.json doit contenir une version stable.`);
  if (!directory) assert.equal(tag, `v${manifest.version}`, 'Le tag doit correspondre à la version de package.json.');
  assert.equal(lock.version, manifest.version, `Actualiser la version de ${directory}package-lock.json.`);
  assert.equal(lock.packages[''].version, manifest.version, `Actualiser la version racine de ${directory}package-lock.json.`);
  console.log(`Publication vérifiée : ${manifest.publisher}.${manifest.name} ${manifest.version}`);
}
