import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = new URL('../scripts/check-release.mjs', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const check = tag => spawnSync(process.execPath, [fileURLToPath(script), ...(tag === undefined ? [] : [tag])], { encoding: 'utf8' });

test('publication : accepter uniquement le tag stable de la version courante', () => {
  assert.equal(check(`v${manifest.version}`).status, 0);
  for (const tag of [undefined, manifest.version, `v${manifest.version}-beta`, 'main', 'v999.999.999']) {
    const result = check(tag);
    assert.notEqual(result.status, 0, `Refuser ${tag}`);
  }
});

test('publication : vérifier les verrous des deux extensions et autoriser des versions distinctes', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'mpi-release-'));
  const fixtureScript = path.join(temporary, 'scripts/check-release.mjs');
  try {
    mkdirSync(path.dirname(fixtureScript));
    mkdirSync(path.join(temporary, 'tp'));
    copyFileSync(script, fixtureScript);
    const write = (file, data) => writeFileSync(path.join(temporary, file), JSON.stringify(data));
    const run = () => spawnSync(process.execPath, [fixtureScript, 'v1.2.3'], { encoding: 'utf8' });
    for (const [directory, version] of [['', '1.2.3'], ['tp/', '4.5.6']]) {
      write(`${directory}package.json`, { name: directory ? 'vscode-mpi-tp' : 'vscode-mpi-exercices', publisher: 'qfortier', version });
      write(`${directory}package-lock.json`, { version, packages: { '': { version } } });
    }
    assert.equal(run().status, 0, 'Les versions des deux extensions peuvent être distinctes.');
    for (const [directory, version] of [['', '1.2.3'], ['tp/', '4.5.6']]) {
      for (const lock of [
        { version: '0.0.0', packages: { '': { version } } },
        { version, packages: { '': { version: '0.0.0' } } }
      ]) {
        write(`${directory}package-lock.json`, lock);
        assert.notEqual(run().status, 0, `Refuser un verrou incohérent dans ${directory || 'la racine'}.`);
      }
      write(`${directory}package-lock.json`, { version, packages: { '': { version } } });
    }
    write('tp/package.json', { version: '4.5.6-beta' });
    assert.notEqual(run().status, 0, 'Une release stable ne doit pas embarquer une préversion de TP MPI.');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
