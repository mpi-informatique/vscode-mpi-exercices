import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parseCatalogue, parseCourse, canCorrect, searchTp, safePath, resourceUrl } from '../src/core';
import { install, listStarted, unzip } from '../src/storage';
const tp = parseCatalogue(JSON.stringify([{ type: 'tp', id: 'tp-test', titre: 'Équivalence des automates', fichier: 'langages/tp-test.typ', chapitres: ['automates-finis'], langages: ['OCaml'], niveaux: ['MPI'], algorithmes: [], structures: [], difficulte: 2, pdfs: { enonce: 'pdf/enonce.pdf', corrige: 'pdf/corrige.pdf' }, tp: { ouvrir: 'main.ml', fichiers: [{ url: 'main.ml', chemin: 'main.ml' }, { url: 'data.zip', chemin: 'data.zip', extraire: 'donnees' }], corrige: [] } }]))[0];

test('menu : rubrique TP, sous-rubriques, liens et publication des corrigés', () => {
  const course = parseCourse('- Langages\n  - td: cor\n- TP\n  - OCaml\n    - [Automates](tp-test): cor\n    - tp-cache\n  - [Ancien](doc:tp/ancien)\n- Autre\n  - autre\n');
  assert.deepEqual(course, [{ id: 'tp-test', title: 'Automates', cor: true }, { id: 'tp-cache', title: undefined, cor: false }]);
  assert(canCorrect(tp, course));
  assert(!canCorrect(tp, [{ id: tp.id, cor: false }]));
  assert(canCorrect(tp, []));
  assert(!canCorrect(tp, undefined));
});

test('recherche commune : accents, mots, chapitre et langage', () => {
  assert.equal(searchTp([tp], 'equivalence ocaml automates').length, 1);
  assert.equal(searchTp([tp], 'python').length, 0);
});

test('refuser chemins et archives hors du dossier de travail', () => {
  for (const value of ['../secret', '/tmp/file', 'a/../../b', 'a\\b', '.mpi/a', 'C:/file']) assert.throws(() => safePath(value));
  assert.throws(() => resourceUrl('https://example.org/file', 'https://mpi.test/exercices/'));
  assert.throws(() => resourceUrl('../file', 'https://mpi.test/exercices/'));
  assert.throws(() => unzip(zipSync({ '../secret': strToU8('test') })));
});

test('installation atomique, extraction ZIP et reprise sans téléchargement ni écrasement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tp-unit-'));
  const resources: Record<string, Uint8Array> = { 'enonce.pdf': strToU8('%PDF-1.4'), 'main.ml': strToU8('let x = 0'), 'data.zip': zipSync({ 'graphe.txt': strToU8('0 1') }) };
  let requests = 0;
  const fetchFile = async (url: string) => { requests++; return resources[url.split('/').pop()!]!; };
  try {
    const record = await install(tp, root, 'https://mpi.test/', fetchFile);
    assert.equal(await readFile(path.join(record.directory, 'donnees/graphe.txt'), 'utf8'), '0 1');
    await writeFile(path.join(record.directory, 'main.ml'), 'let travail = 42');
    const count = requests;
    await install(tp, root, 'https://mpi.test/', fetchFile);
    assert.equal(requests, count);
    assert.equal(await readFile(path.join(record.directory, 'main.ml'), 'utf8'), 'let travail = 42');
    assert.equal((await listStarted(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('un téléchargement interrompu ne crée pas un faux TP commencé', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tp-unit-'));
  try {
    await assert.rejects(install(tp, root, 'https://mpi.test/', async url => { if (url.endsWith('.pdf')) return strToU8('%PDF-1.4'); throw new Error('réseau'); }));
    assert.deepEqual(await listStarted(root), []);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
