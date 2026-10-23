import { test } from 'node:test';
import { searchPriority } from '../src/search-order';
import assert from 'node:assert/strict';
import { identify } from '../src/documents';
import { Exercise, executionCommand, matches, parseCatalogue, parseDiagnostics, pdfTarget, pdfFilename, previewArguments, variantLabels } from '../src/core';
import { exerciseFromTemplate, sheetFromTemplate, outline, vocabulary, mask } from '../src/typst';
import { hierarchy, isFolder } from '../src/tree';
import { sheetList, editSheet, sourceMetadata } from '../src/sheet-model';
import { bridgeHtml } from '../src/preview-bridge';
import { creationPath, contestFromTemplate } from '../src/typst';
import { Refresh } from '../src/refresh';
import { EnvironmentCache } from '../src/environment-cache';
import { Preparation } from '../src/preparation';
import { bankCandidates } from '../src/discovery';
import { copyDirectory, copyInputs } from '../src/copy-inputs';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';

test('environnement : réutiliser Nix, invalider les sources et réglages, réessayer après une erreur', async () => {
  const cache = new EnvironmentCache<object>();
  let calls = 0;
  const load = async () => ({ version: ++calls });
  const first = cache.get('public', 'nix', load);
  assert.equal(cache.get('public', 'nix', load), first, 'Les demandes simultanées partagent le même chargement');
  const value = await first;
  assert.equal(await cache.get('public', 'nix', load), value, 'Le résultat reste disponible après le chargement');
  assert.equal(calls, 1);
  cache.invalidate('public');
  assert.notEqual(await cache.get('public', 'nix', load), value);
  assert.equal(calls, 2);
  await cache.get('public', 'nouveaux réglages', load);
  assert.equal(calls, 3);
  const privateValue = await cache.get('private', 'nix', load);
  cache.invalidate('public');
  assert.equal(await cache.get('private', 'nix', load), privateValue, 'Les banques ont des caches distincts');
  const failed = cache.get('public', 'nix', async () => { throw new Error('Nix indisponible'); });
  await assert.rejects(failed, /Nix indisponible/);
  assert.ok(await cache.get('public', 'nix', load));
  let finish!: (value: object) => void;
  const old = cache.get('public', 'ancienne configuration', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.invalidate('public');
  const fresh = await cache.get('public', 'nix', load);
  finish({});
  await old;
  assert.equal(await cache.get('public', 'nix', load), fresh, 'Un ancien chargement ne restaure pas une entrée invalidée');
  cache.clear();
  assert.notEqual(await cache.get('private', 'nix', load), privateValue);
});
test('préparation : deux variantes partagées, transfert de propriété et nettoyage des réserves', async () => {
  const preparation = new Preparation<{ dispose(): void }>();
  const stopped: string[] = [];
  let starts = 0;
  const load = async (variant: string) => { starts++; return { dispose: () => { stopped.push(variant); } }; };
  await Promise.all([
    preparation.warm('cours', ['enonce', 'corrige'], load, error => { throw error; }),
    preparation.warm('cours', ['enonce', 'corrige'], load, error => { throw error; })
  ]);
  assert.equal(starts, 2);
  const course = await preparation.take('cours', 'enonce');
  assert.ok(course);
  assert.equal(await preparation.take('autre', 'corrige'), undefined);
  preparation.clear();
  await Promise.resolve();
  assert.deepEqual(stopped, ['corrige'], 'Seule la variante encore en réserve est arrêtée');
  course.dispose();
  assert.deepEqual(stopped, ['corrige', 'enonce']);
  preparation.dispose();
  await preparation.warm('autre', ['enonce'], load, error => { throw error; });
  assert.equal(starts, 2, 'Une préparation détruite ne redémarre aucun moteur');
});
test('préparation : abandon et récupération pendant le démarrage, puis reprise après erreur', async () => {
  const preparation = new Preparation<{ dispose(): void }>();
  let finish!: (value: { dispose(): void }) => void;
  let stopped = 0;
  let signal!: AbortSignal;
  const pending = (_variant: string, nextSignal: AbortSignal) => new Promise<{ dispose(): void }>(resolve => { finish = resolve; signal = nextSignal; });
  const resource = () => ({ dispose: () => { stopped++; } });
  const abandoned = preparation.warm('ancien', ['enonce'], pending, error => { throw error; });
  await Promise.resolve();
  preparation.clear();
  assert.equal(signal.aborted, true, 'Le chargement abandonné reçoit aussi un signal d’annulation');
  finish(resource());
  await abandoned;
  assert.equal(stopped, 1, 'Un moteur abandonné est arrêté dès la fin de son démarrage');
  const warming = preparation.warm('cours', ['enonce'], pending, error => { throw error; });
  await Promise.resolve();
  const taken = preparation.take('cours', 'enonce');
  preparation.clear();
  assert.equal(signal.aborted, false, 'La récupération transfère aussi la responsabilité de l’annulation');
  finish(resource());
  await warming;
  const owned = await taken;
  assert.ok(owned);
  assert.equal(stopped, 1, 'Une demande F5 conserve le moteur même si le fichier actif change entre-temps');
  owned.dispose();
  const failures: unknown[] = [];
  await preparation.warm('cours', ['enonce'], async () => { throw new Error('échec provisoire'); }, error => failures.push(error));
  assert.equal(failures.length, 1);
  await preparation.warm('cours', ['enonce'], async () => resource(), error => { throw error; });
  const retried = await preparation.take('cours', 'enonce');
  assert.ok(retried, 'Une préparation échouée peut être relancée');
  retried.dispose();
  preparation.dispose();
});
test('documents : polys et présentations avec leur propre fonction de mise en page', () => {
  const poly = '#show: cours.with(type: "poly", titre: "Automates",)';
  const slides = '#show: diapositives.with(type: "presentation", titre: "Résumé",)';
  assert.deepEqual(identify(poly), { kind: 'document', type: 'poly', direct: true });
  assert.deepEqual(identify(slides), { kind: 'document', type: 'presentation', direct: true });
  assert.equal(sourceMetadata(poly, 'chapitres/automates/poly.typ').titre, 'Automates');
  assert.equal(identify('#show: text.with(font: "Arial")'), undefined);
  assert.equal(identify('// #show: cours.with(type: "poly")'), undefined);
  assert.throws(() => sheetList(poly, 'poly.typ'));
});

test('cours et présentation : reconnaissance, paramètres et sorties distinctes', () => {
  const source = 'chapitres/automates/support.typ';
  const text = '#show: cours-et-presentation.with(titre: "Automates")';
  assert.deepEqual(identify(text), { kind: 'document', type: 'cours-presentation', direct: true });
  assert.equal(identify('// ' + text), undefined);
  assert.equal(identify('`' + text + '`'), undefined);
  assert.equal(identify('/* ' + text + ' */'), undefined);
  const type = identify(text)!.type;
  assert.deepEqual(variantLabels(type), { enonce: 'Cours', corrige: 'Cours corrigé', presentation: 'Présentation' });
  assert.deepEqual(variantLabels('td'), { enonce: 'Énoncé', corrige: 'Corrigé', presentation: '' });
  for (const [variant, format] of [['enonce', 'cours'], ['corrige', 'cours'], ['presentation', 'presentation']] as const) {
    assert.deepEqual(previewArguments('/bank', source, variant, true, type), ['--root', '/bank', '--ignore-system-fonts', '--input', `format=${format}`, '--input', `corrige=${variant === 'corrige'}`, `/bank/${source}`]);
    assert.equal(pdfTarget(source, variant, false, type), `build/chapitres/automates/support/${format}-support${variant === 'corrige' ? '-cor' : ''}.pdf`);
    assert.equal(pdfFilename(source, variant, type), `${format}-support${variant === 'corrige' ? '-cor' : ''}.pdf`);
    assert.equal(pdfFilename('chapitres/langages/cours-kleene.typ', variant, type), `${format}-kleene${variant === 'corrige' ? '-cor' : ''}.pdf`);
  }
});

test('copies : lire les CSV du DS, gérer le BOM et les fichiers absents', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mpi-copy-inputs-'));
  try {
    const copies = path.join(temporary, 'copies');
    await mkdir(copies);
    const source = path.join(copies, 'exemple.typ');
    assert.equal(copyDirectory(source), temporary);
    assert.equal(copyDirectory(path.join(temporary, 'exemple.typ')), temporary);
    assert.deepEqual(await copyInputs(source), ['--input', 'notes=', '--input', 'recap=']);
    await writeFile(path.join(temporary, 'notes.csv'), '\uFEFFclasse;nom;prenom\nMPI;Nom;Prénom\n');
    await writeFile(path.join(temporary, 'recapitulatif.csv'), 'classe;note\nMPI;12,5\n');
    assert.deepEqual(await copyInputs(source), ['--input', 'notes=classe;nom;prenom\nMPI;Nom;Prénom\n', '--input', 'recap=classe;note\nMPI;12,5\n']);
    await rm(path.join(temporary, 'notes.csv'));
    await mkdir(path.join(temporary, 'notes.csv'));
    await assert.rejects(copyInputs(source), /EISDIR/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('catalogue automatique : inactif sans changements, regroupement, relance et erreurs', async () => {
  let calls = 0; let release!: () => void;
  const errors: unknown[] = [];
  const refresh = new Refresh(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, error => errors.push(error), 60000);
  try {
    await refresh.flush(); assert.equal(calls, 0);
    refresh.mark(); refresh.mark(); const first = refresh.flush(); assert.equal(calls, 1);
    refresh.mark(); await refresh.flush(); assert.equal(calls, 1);
    release(); await first;
    const second = refresh.flush(); assert.equal(calls, 2); release(); await second;
    await refresh.flush(); assert.equal(calls, 2);
  } finally { refresh.dispose(); }
  const failure = new Refresh(async () => { throw new Error('Typst invalide'); }, error => errors.push(error), 60000);
  try {
    failure.mark(); await failure.flush(); await failure.flush(); assert.equal(errors.length, 1);
    failure.mark(); await failure.flush(); assert.equal(errors.length, 2);
    failure.dispose(); failure.mark(); await failure.flush(); assert.equal(errors.length, 2);
  } finally { failure.dispose(); }
});

test('création dans un dossier libre ou à la racine, sans traversée', () => {
  assert.equal(creationPath('exercices/devoirs/2026-2027', 'ds-1'), 'exercices/devoirs/2026-2027/ds-1.typ');
  assert.equal(creationPath('classe/chapitre', 'td-test'), 'classe/chapitre/td-test.typ');
  assert.equal(creationPath('', 'sujet'), 'sujet.typ');
  assert.equal(creationPath('corrections/2026/ds/ds1/copies', 'nom-prenom'), 'corrections/2026/ds/ds1/copies/nom-prenom.typ');
  for (const folder of ['..', 'exercices/feuilles/../concours', '/feuilles']) assert.throws(() => creationPath(folder, 'test'));
  assert.throws(() => creationPath('feuilles', '../test'));
  const template = 'titre: "Modèle",\nconcours: none,\ncontenu: (question([Question]),)';
  assert.equal(contestFromTemplate(template, 'Titre "cité"'), 'titre: "Titre \\"cité\\"",\nconcours: none,\ncontenu: (question([Question]),)'.replaceAll('\\\\', '\\'));
  assert.throws(() => contestFromTemplate('modèle incompatible', 'Titre'));
});

const exercise: Exercise = {
  titre: 'Automates et monoïdes', fichier: 'exercices/banque/langages/automates-monoides.typ',
  chapitres: ['automates-finis'], algorithmes: [], structures: [], langages: ['OCaml'],
  niveaux: ['MPI'], difficulte: 4, duree: [1, 30], concours: { nom: 'ENS', annee: 2022, filiere: 'MP' }
};
const editableSheet = '#import "/exercices/a.typ": ex as a\n#import "../../exercices/b.typ": ex as b\n#import "/exercices/unused.typ": ex as unused\n#show: feuille.with(titre: "TD", exercices: (a, /* second */ b,),)\nTexte personnalisé.';
test('composition : ordre réel, imports inutilisés ignorés, références relatives', () => {
  const list = sheetList(editableSheet, 'exercices/feuilles/test.typ');
  assert.deepEqual(list.entries.map(entry => entry.source), ['exercices/a.typ', 'exercices/b.typ']);
  const moved = editSheet(editableSheet, 'exercices/feuilles/test.typ', { index: 1, direction: -1 });
  assert.deepEqual(sheetList(moved, 'exercices/feuilles/test.typ').entries.map(entry => entry.alias), ['b', 'a']);
  assert.ok(moved.includes('/* second */'));
  assert.ok(moved.endsWith('Texte personnalisé.'));
  const removed = editSheet(moved, 'exercices/feuilles/test.typ', { index: 0 });
  assert.equal(sheetList(removed, 'exercices/feuilles/test.typ').entries.length, 1);
  assert.ok(!removed.includes('ex as b'), 'Import retiré avec l’exercice');
  const added = editSheet(removed, 'exercices/feuilles/test.typ', { add: 'exercices/c.typ' });
  assert.deepEqual(sheetList(added, 'exercices/feuilles/test.typ').entries.map(entry => entry.source), ['exercices/a.typ', 'exercices/c.typ']);
  assert.throws(() => editSheet(added, 'exercices/feuilles/test.typ', { add: 'exercices/a.typ' }));
});
test('compositions calculées, ambiguës ou alias redéfinis : aucune réécriture', () => {
  for (const list of ['(..autres,)', '(a,)+autres', '(a.with(meta: (:)),)', '(inconnu,)', '(a)']) {
    assert.throws(() => sheetList(editableSheet.replace('(a, /* second */ b,)', list), 'exercices/feuilles/test.typ'));
  }
  assert.throws(() => sheetList(editableSheet + '\n#let a = autre', 'exercices/feuilles/test.typ'));
});
test('anciennes feuilles sans virgule finale et nouvelle feuille vide', () => {
  const old = editableSheet.replace('(a, /* second */ b,)', '(a, b)');
  assert.deepEqual(sheetList(old, 'exercices/feuilles/test.typ').entries.map(entry => entry.alias), ['a', 'b']);
  const removed = editSheet(old, 'exercices/feuilles/test.typ', { index: 1 });
  assert.ok(!removed.includes('ex as b'));
  assert.equal(sheetList(removed, 'exercices/feuilles/test.typ').entries.length, 1);
  assert.throws(() => editSheet(old + '\n#b.meta.titre', 'exercices/feuilles/test.typ', { index: 1 }));
  const empty = sheetFromTemplate('#import "/templates/exercice.typ": ex\n#show: feuille.with(\n titre: "TD",\n exercices: (ex,),\n)', 'Vide', []);
  assert.equal(sheetList(empty, 'exercices/feuilles/test.typ').entries.length, 0);
  assert.ok(!empty.includes('/templates/exercice.typ'));
});
test('pont Tinymist : messages du parent et URL de l’aperçu', () => {
  const html = bridgeHtml('<head><style>.hover .typst-text {x:y}.typst-text:hover {x:y}</style></head>new URL("/", window.location.href)', 'http://127.0.0.1:123', 'secret');
  assert.ok(html.includes('event.source !== parent'));
  assert.ok(!html.includes('new URL("/", window.location.href)'));
});
test('navigation Tinymist : choisir une page, ignorer les messages étrangers et respecter les champs de saisie', () => {
  const html = bridgeHtml('<head></head>', 'http://127.0.0.1:123', 'secret');
  const listeners = new Map<string, (event?: any) => void>();
  const messages: any[] = [];
  const queued: (() => void)[] = [];
  let scrollTop = 0;
  const viewport = { get scrollTop() { return scrollTop; }, scrollTo: ({ top }: { top: number }) => { scrollTop = top; }, getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }) };
  const pages = [0, 1, 2].map(index => ({ getAttribute: () => String(index), getBoundingClientRect: () => ({ top: index * 100 - scrollTop, bottom: (index + 1) * 100 - scrollTop }) }));
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  runInNewContext(/<script>([\s\S]*?)<\/script>/.exec(html)![1], {
    parent,
    document: { getElementById: (id: string) => id === 'typst-container-main' ? viewport : {}, querySelectorAll: () => pages },
    addEventListener: (type: string, listener: (event?: any) => void) => listeners.set(type, listener),
    requestAnimationFrame: (callback: () => void) => queued.push(callback), cancelAnimationFrame: () => undefined,
    MutationObserver: class { observe() {} }
  });
  const flush = () => { while (queued.length) queued.shift()!(); };
  listeners.get('DOMContentLoaded')!(); flush();
  assert.equal(messages.at(-1).current, 1);
  assert.equal(messages.at(-1).total, 3);
  const jump = (page: number, token = 'secret', source = parent) => { listeners.get('message')!({ source, data: { type: 'goToPage', token, page } }); flush(); };
  jump(2, 'incorrect'); assert.equal(scrollTop, 0);
  jump(2, 'secret', {} as typeof parent); assert.equal(scrollTop, 0);
  jump(2); assert.equal(scrollTop, 100); assert.equal(messages.at(-1).current, 2);
  jump(3); assert.equal(messages.at(-1).current, 3);
  for (const page of [0, -1, 4, 1.5, NaN]) jump(page);
  assert.equal(scrollTop, 200, 'Une page absente ou invalide ne déplace pas le lecteur');
  let prevented = false;
  const key = { key: 'ArrowLeft', target: { closest: () => null }, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => undefined };
  listeners.get('keydown')!(key);
  assert.equal(prevented, true);
  assert.equal(messages.at(-1).type, 'pageStep');
  assert.equal(messages.at(-1).delta, -1);
  for (const [keyName, boundary] of [['Home', 'start'], ['End', 'end']]) {
    prevented = false;
    listeners.get('keydown')!({ ...key, key: keyName });
    assert.equal(prevented, true);
    assert.equal(messages.at(-1).type, 'pageBoundary');
    assert.equal(messages.at(-1).boundary, boundary);
    assert.equal(messages.at(-1).token, 'secret');
  }
  for (const keyName of ['ArrowLeft', 'Home', 'End']) {
    const count = messages.length;
    listeners.get('keydown')!({ ...key, key: keyName, target: { closest: () => ({}) } });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'defaultPrevented']) listeners.get('keydown')!({ ...key, key: keyName, [modifier]: true });
    assert.equal(messages.length, count, 'Les champs de saisie et les raccourcis modifiés restent utilisables');
  }
  for (const [keyName, variant] of [['F5', 'enonce'], ['F6', 'corrige'], ['F7', 'presentation']]) {
    prevented = false;
    listeners.get('keydown')!({ ...key, key: keyName, target: { closest: () => ({}) } });
    assert.equal(prevented, true);
    assert.equal(messages.at(-1).type, 'selectVariant');
    assert.equal(messages.at(-1).variant, variant);
    assert.equal(messages.at(-1).token, 'secret');
    const count = messages.length;
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'defaultPrevented']) listeners.get('keydown')!({ ...key, key: keyName, [modifier]: true });
    assert.equal(messages.length, count);
  }
});
test('lecteur : raccourcis de variantes et début/fin depuis le PDF, la barre et l’iframe active', async () => {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const messages: any[] = [];
  const elements = new Map<string, any>();
  const element = () => ({ dataset: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, append() {}, remove() {}, contentWindow: { postMessage() {} } });
  const document = {
    body: { dataset: { channel: 'test' }, classList: { toggle() {} } },
    getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    querySelectorAll: () => ['enonce', 'corrige', 'presentation'].map(id => ({ id }))
  };
  const window = { addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, [...listeners.get(type) ?? [], listener]) };
  runInNewContext(await readFile(path.join(process.cwd(), 'dist/viewer/viewer.mjs'), 'utf8'), {
    document, window, URL,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
    MutationObserver: class { observe() {} },
    ResizeObserver: class { observe() {} }
  });
  elements.get('presentation').onclick();
  assert.equal(messages.at(-1).type, 'presentation', 'La troisième variante est sélectionnable');
  const dispatch = (type: string, event: any) => listeners.get(type)?.forEach(listener => listener(event));
  for (const [key, variant] of [['F5', 'enonce'], ['F6', 'corrige'], ['F7', 'presentation']]) {
    for (const input of [false, true]) {
      let prevented = false, stopped = false;
      const event = { key, target: { closest: () => input ? {} : null }, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } };
      dispatch('keydown', event);
      assert.equal(messages.at(-1).type, variant);
      assert.equal(prevented && stopped, true);
      const count = messages.length;
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'defaultPrevented']) dispatch('keydown', { ...event, [modifier]: true });
      assert.equal(messages.length, count);
    }
  }
  dispatch('message', { data: { channel: 'test', type: 'show', hasCode: true, native: true, variant: 'enonce', labels: { enonce: 'Cours', corrige: 'Cours corrigé', presentation: 'Présentation' }, sessions: { enonce: 'http://localhost:123/enonce', corrige: 'http://localhost:123/corrige' }, tokens: { enonce: 'secret', corrige: 'other' } } });
  assert.equal(elements.get('code').hidden, false, 'Le bouton de code apparaît pour les feuilles avec code');
  elements.get('code').onclick();
  assert.equal(messages.at(-1).type, 'code', 'Le bouton demande l’ouverture du code à l’extension');
  // Frames are created in session order; retain their windows to exercise origin/source checks.
  const frames: any[] = [];
  document.createElement = () => { const frame = element(); frames.push(frame); return frame; };
  dispatch('message', { data: { channel: 'test', type: 'reset' } });
  dispatch('message', { data: { channel: 'test', type: 'show', native: true, variant: 'enonce', labels: { enonce: 'Énoncé', corrige: 'Corrigé', presentation: '' }, sessions: { enonce: 'http://localhost:123/enonce', corrige: 'http://localhost:123/corrige' }, tokens: { enonce: 'secret', corrige: 'other' } } });
  assert.equal(elements.get('code').hidden, true, 'Le bouton disparaît pour une feuille sans code');
  const event = { source: frames[0].contentWindow, origin: 'http://localhost:123', data: { type: 'selectVariant', token: 'secret', variant: 'corrige' } };
  const count = messages.length;
  dispatch('message', { ...event, origin: 'http://foreign.invalid' });
  dispatch('message', { ...event, source: {} });
  dispatch('message', { ...event, data: { ...event.data, token: 'incorrect' } });
  dispatch('message', { ...event, data: { ...event.data, variant: 'save' } });
  dispatch('message', { ...event, source: frames[1].contentWindow, data: { ...event.data, token: 'other' } });
  assert.equal(messages.length, count, 'Les messages étrangers, invalides ou provenant d’une variante masquée sont ignorés');
  dispatch('message', event);
  assert.equal(messages.length, count + 1);
  assert.equal(messages.at(-1).type, 'corrige');
  const navigations: any[] = [];
  frames[0].contentWindow.postMessage = (message: any) => navigations.push(message);
  dispatch('message', { ...event, data: { type: 'pageProgress', token: 'secret', current: 3, total: 7 } });
  const key = { target: { closest: () => null }, preventDefault() {} };
  for (const [keyName, page] of [['End', 7], ['Home', 1]] as const) {
    dispatch('keydown', { ...key, key: keyName });
    assert.equal(navigations.at(-1).type, 'goToPage');
    assert.equal(navigations.at(-1).page, page);
    assert.equal(navigations.at(-1).token, 'secret');
    const count = navigations.length;
    dispatch('keydown', { ...key, key: keyName, target: { closest: () => ({}) } });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'defaultPrevented']) dispatch('keydown', { ...key, key: keyName, [modifier]: true });
    assert.equal(navigations.length, count, 'Début/Fin préservent les saisies et les raccourcis modifiés');
  }
  const boundary = { ...event, data: { type: 'pageBoundary', token: 'secret', boundary: 'end' } };
  dispatch('message', boundary);
  assert.equal(navigations.at(-1).page, 7);
  dispatch('message', { ...boundary, data: { ...boundary.data, boundary: 'start' } });
  assert.equal(navigations.at(-1).page, 1);
  const navigationCount = navigations.length;
  dispatch('message', { ...boundary, origin: 'http://foreign.invalid' });
  dispatch('message', { ...boundary, source: {} });
  dispatch('message', { ...boundary, data: { ...boundary.data, token: 'incorrect' } });
  dispatch('message', { ...boundary, data: { ...boundary.data, boundary: 'middle' } });
  dispatch('message', { ...boundary, source: frames[1].contentWindow, data: { ...boundary.data, token: 'other' } });
  assert.equal(navigations.length, navigationCount, 'Seule l’iframe active authentifiée peut demander un saut');

  dispatch('message', { data: { channel: 'test', type: 'show', native: false, variant: 'enonce', sessions: {} } });
  const host = elements.get('viewers');
  host.scrollTop = 200;
  host.getBoundingClientRect = () => ({ top: 0 });
  host.querySelector = (selector: string) => ({ getBoundingClientRect: () => ({ top: (Number(/data-page="(\d+)"/.exec(selector)![1]) - 1) * 100 - host.scrollTop }) });
  host.scrollTo = ({ top }: { top: number }) => { host.scrollTop = top; };
  dispatch('keydown', { ...key, key: 'End' });
  assert.equal(host.scrollTop, 600, 'Fin rejoint la dernière page du PDF de secours');
  dispatch('keydown', { ...key, key: 'Home' });
  assert.equal(host.scrollTop, 0, 'Début rejoint la première page du PDF de secours');
  dispatch('message', { data: { channel: 'test', type: 'reset' } });
  dispatch('keydown', { ...key, key: 'End' });
  assert.equal(host.scrollTop, 0, 'Aucun saut avant que la pagination soit disponible');

});
test('commentaires imbriqués et code brut ne créent pas de faux éléments', () => {
  const text = '/* externe /* interne */ question([faux]) */\n`question([faux])`\nquestion([Vrai])';
  assert.equal(mask(text).length, text.length);
  assert.equal(outline(text).length, 1);
  assert.equal(outline(text)[0].title, '1. Vrai');
});
test('recherche de métadonnées littérales des sujets', () => {
  const ex = sourceMetadata('// titre: "Ignoré"\n#let ex = exercice(meta: (titre: "Sujet été", langages: ("OCaml",), niveaux: ("MPI",), concours: (nom: "ENS", annee: 2024),))', 'exercices/concours/24/test.typ');
  assert.equal(matches(ex, 'ete ENS 2024', { langages: 'OCaml' }), true);
  assert.equal(matches(ex, '', { difficulteMax: 5 }), false, 'Difficulté inconnue non inventée');
});
test('catalogue actuel : tableau et identifiant déduit du chemin', () => {
  assert.deepEqual(parseCatalogue(JSON.stringify([exercise])), [exercise]);
  assert.throws(() => parseCatalogue('{}'));
  assert.throws(() => parseCatalogue(JSON.stringify([exercise, { ...exercise, fichier: 'exercices/autre/automates-monoides.typ' }])));
});
test('validation des métadonnées avant leur utilisation', () => {
  for (const change of [{ titre: null }, { niveaux: null }, { difficulte: 6 }, { duree: [0, 60] }, { concours: { nom: 3 } }]) {
    assert.throws(() => parseCatalogue(JSON.stringify([{ ...exercise, ...change }])));
  }
});
test('recherche multi-mots, insensible à la casse et aux accents', () => {
  assert.equal(matches(exercise, 'MONOIDES ens 2022', {}), true);
  assert.equal(matches(exercise, 'monoides 2021', {}), false);
  assert.equal(matches(exercise, 'automates-monoides', {}), true);
});
test('tous les filtres se cumulent avec la recherche', () => {
  assert.equal(matches(exercise, 'automates', { chapitres: 'automates-finis', langages: 'OCaml', concours: 'ENS', niveaux: 'MPI', difficulteMax: 4 }), true);
  assert.equal(matches(exercise, '', { difficulteMax: 3 }), false);
  assert.equal(matches(exercise, '', { langages: 'Python' }), false);
  assert.equal(matches({ ...exercise, concours: null }, '', { concours: 'ENS' }), false);
});
test('chemins PDF conformes aux scripts Python, feuilles imbriquées incluses', () => {
  assert.equal(pdfTarget('exercices/devoirs/2026-2027/ds-1.typ', 'enonce'), 'build/exercices/devoirs/2026-2027/ds-1/ds-1.pdf');
  assert.equal(pdfTarget('exercices/devoirs/2026-2027/ds-1.typ', 'corrige'), 'build/exercices/devoirs/2026-2027/ds-1/ds-1-cor.pdf');
  assert.equal(pdfTarget(exercise.fichier, 'enonce'), 'build/exercices/banque/langages/automates-monoides/automates-monoides.pdf');
  assert.equal(pdfTarget('exercices/concours/22/oral/test.typ', 'corrige'), 'build/exercices/concours/22/oral/test/test-cor.pdf');
  assert.equal(pdfTarget('exercices/feuilles/langages/td.typ', 'enonce'), 'build/exercices/feuilles/langages/td/td.pdf');
  assert.equal(pdfTarget('exercices/feuilles/langages/td.typ', 'corrige'), 'build/exercices/feuilles/langages/td/td-cor.pdf');
  assert.equal(pdfTarget('corrections/2026/ds/ds1/copies/exemple.typ', 'corrige', true), 'build/corrections/2026/ds/ds1/copies/exemple/exemple-cor.pdf');
  assert.equal(pdfTarget('corrections/2026/ds/ds1/copies/exemple.typ', 'enonce', true), 'build/corrections/2026/ds/ds1/copies/exemple/exemple.pdf');
});
test('rejet de chemins sortant de la banque et de chemins non pris en charge', () => {
  for (const source of ['../test.typ', 'exercices/../test.typ', '/exercices/test.typ', 'exercices/$(shell x).typ', 'exercices/test;exit.typ', 'exercices/test\n.typ']) assert.throws(() => pdfTarget(source, 'enonce'));
});
test('Nix automatique pour flake ; exécution directe configurable', () => {
  assert.deepEqual(executionCommand('auto', true, '/path with spaces/nix', 'python3', ['catalogue']), { command: '/path with spaces/nix', args: ['develop', '.', '-c', 'python3', 'scripts/build.py', 'catalogue'] });
  assert.deepEqual(executionCommand('direct', true, 'nix', '/path with spaces/python', ['c', 'exercices/banque/test.typ']), { command: '/path with spaces/python', args: ['scripts/build.py', 'c', 'exercices/banque/test.typ'] });
  assert.equal(executionCommand('auto', false, 'nix', 'python3', []).command, 'python3');
  assert.equal(executionCommand('nix', false, 'nix', 'python3', []).command, 'nix');
});
test('diagnostics Typst : erreurs, avertissements, coordonnées à base zéro', () => {
  assert.deepEqual(parseDiagnostics('error: unknown variable: foo\n  ┌─ exercices/test.typ:8:4\nwarning: font missing\n  ┌─ lib/exercices.typ:2:1'), [
    { file: 'exercices/test.typ', line: 7, column: 3, message: 'unknown variable: foo', warning: false },
    { file: 'lib/exercices.typ', line: 1, column: 0, message: 'font missing', warning: true }
  ]);
});
test('noms PDF : énoncé et corrigé partagent le nom de source', () => {
  assert.equal(pdfFilename('exercices/feuilles/langages/td-kleene.typ', 'enonce'), 'td-kleene.pdf');
  assert.equal(pdfFilename('exercices/feuilles/langages/td-kleene.typ', 'corrige'), 'td-kleene-cor.pdf');
  assert.equal(pdfFilename(exercise.fichier, 'corrige'), exercise.fichier.split('/').at(-1)!.replace('.typ', '-cor.pdf'));
});
test('aperçu : modèles et variantes cohérents avec les exports Python, sans PDF intermédiaire', () => {
  const devoirArgs = previewArguments('/bank', 'exercices/devoirs/2026-2027/ds-1.typ', 'corrige', true);
  assert.equal(devoirArgs.at(-1), '/bank/exercices/devoirs/2026-2027/ds-1.typ');
  assert.ok(devoirArgs.includes('corrige=true'));
  assert.ok(!devoirArgs.some(arg => arg.startsWith('exercice=')));
  const exerciseArgs = previewArguments('/bank', exercise.fichier, 'corrige');
  assert.ok(exerciseArgs.includes('corrige=true'));
  assert.ok(exerciseArgs.includes(`exercice=/${exercise.fichier}`));
  assert.equal(exerciseArgs.at(-1), '/bank/templates/fiche.typ');
  const sheetArgs = previewArguments('/bank', 'exercices/feuilles/langages/td.typ', 'enonce', true);
  assert.equal(sheetArgs.at(-1), '/bank/exercices/feuilles/langages/td.typ');
  assert.equal(sheetArgs.includes('templates/fiche.typ'), false);
});
test('plan, vocabulaire et création à partir des modèles Typst', () => {
  const source = '#let ex = exercice(\n  meta: (\n    titre: "Exemple",\n    chapitres: (),\n    algorithmes: (),\n    structures: (),\n    langages: (),\n    niveaux: (),\n    difficulte: 2,\n    duree: none,\n    concours: none,\n  ),\n  contenu: (\n    // question([Commentaire ignoré])\n    partie("I", "Test", contenu: (question([Une question ?]),)),\n  ),\n)';
  assert.equal(outline(source).find(item => item.kind === 'partie')?.children?.length, 1);
  assert.equal(outline(source).find(item => item.kind === 'partie')?.children?.[0].title, '1. Une question ?');
  assert.deepEqual(vocabulary('#let chapitres-programme = (\n// "ignoré"\n"graphes", "logique",\n)', 'chapitres-programme'), ['graphes', 'logique']);
  const created = exerciseFromTemplate(source, { title: 'Titre "cité"', chapters: ['graphes'], algorithms: [], structures: [], languages: ['C'], levels: ['MPI'], difficulty: 3, minutes: 90 });
  assert.ok(created.includes('titre: "Titre \\"cité\\"",'.replaceAll('\\\\', '\\')));
  assert.ok(created.includes('duree: (1, 30),'));
  assert.equal(outline(created).filter(item => item.kind === 'question').length, 1);
  assert.ok(!created.includes('Une question ?'));
  const annotated = '/// Aide du modèle\n/* Bloc /* imbriqué */ à retirer */\n#let lien = "https://example.org/*texte*/"\n#let code = `// commentaire de code`\n' + source.replace('  meta: (', '  meta: ( // Métadonnées du modèle').replace('    concours: none,', '    concours: none,\n    // Champs supplémentaires libres') + '\n// Fin du modèle\n';
  const clean = exerciseFromTemplate(annotated, { title: 'SQL // titre', chapters: [], algorithms: [], structures: [], languages: ['SQL'], levels: ['MPI'], difficulty: 1, minutes: null });
  for (const comment of ['Aide du modèle', 'imbriqué', 'Métadonnées du modèle', 'Champs supplémentaires libres', 'Fin du modèle']) assert.ok(!clean.includes(comment));
  assert.ok(clean.includes('"https://example.org/*texte*/"'));
  assert.ok(clean.includes('`// commentaire de code`'));
  assert.ok(clean.includes('"SQL // titre"'));
  const minimal = source.replace(/^.*(?:algorithmes|structures|langages|concours):.*\n/gm, '');
  const enriched = exerciseFromTemplate(minimal, { title: 'Minimal', chapters: ['graphes'], algorithms: [], structures: [], languages: ['OCaml'], levels: ['MPI'], difficulty: 2, minutes: 20 });
  assert.ok(enriched.includes('langages: ("OCaml",),'));
  assert.ok(enriched.includes('concours: none,'));
  const sheet = sheetFromTemplate('#import "/templates/exercice.typ": ex\n#show: feuille.with(\n  titre: "TD",\n  exercices: (ex,),\n)\n', 'Feuille', [exercise.fichier, 'exercices/banque/graphes/test.typ']);
  assert.ok(sheet.includes('ex as ex2'));
  assert.ok(sheet.includes('exercices: (ex1, ex2,),'));
});
test('parties imbriquées : les questions suivantes ne restent pas dans une partie fermée', () => {
  const items = outline('partie("I", "Parent", contenu: (\npartie("A", "Enfant", contenu: (question([Alpha]),)),\nquestion([Beta]),)),\nquestion([Gamma])');
  assert.equal(items.length, 2);
  assert.equal(items[0].children?.length, 2);
  assert.equal(items[0].children?.[0].children?.[0].title, '1. Alpha');
  assert.equal(items[0].children?.[1].title, '2. Beta');
  assert.equal(items[1].title, '3. Gamma');
});
test('arborescence : dossiers imbriqués et fichiers de même nom dans des dossiers différents', () => {
  const files = ['b/test.typ', 'a/nested/test.typ', 'a/test.typ', 'root.typ'];
  const tree = hierarchy(files, value => value);
  assert.equal(tree.length, 3);
  assert.ok(isFolder(tree[0]));
  assert.equal(tree[0].title, 'a');
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[2], 'root.typ');
});

test('titre de feuille : feuille.with prime sur les exercices locaux', () => {
  const source = '#let local = exercice(meta: (titre: "Algorithme de déterminisation", niveaux: ("MP",)))\n#show: feuille.with(titre: "TD : Automates", niveau: "MPI", exercices: (local,))';
  const meta = sourceMetadata(source, 'exercices/feuilles/langages/td-automate.typ');
  assert.equal(meta.titre, 'TD : Automates');
  assert.deepEqual(meta.niveaux, ['MPI']);
  assert.deepEqual(meta.chapitres, []);
  assert.equal(sourceMetadata(source, 'exercices/devoirs/2026-2027/ds.typ').titre, 'TD : Automates');
});

test('composition : protéger le barème personnalisé, conserver les barèmes hérités', () => {
  const source = 'exercices/devoirs/2026-2027/ds.typ';
  for (const bareme of ['(1, 2,)', 'calcul()', 'none + autre']) {
    const text = editableSheet.replace('titre: "TD",', `titre: "TD", bareme: ${bareme},`);
    for (const operation of [{ index: 0 }, { index: 1, direction: -1 }, { add: 'exercices/c.typ' }]) {
      assert.throws(() => editSheet(text, source, operation));
    }
  }
  const inherited = editableSheet.replace('titre: "TD",', 'titre: "TD", bareme: none,');
  assert.equal(sheetList(editSheet(inherited, source, { index: 0 }), source).entries.length, 1);
  assert.ok(editSheet(editableSheet + '\n// bareme: (1,)', source, { index: 0 }));
});

test('documents : type déclaré, indépendant du dossier, anciens appels compatibles', () => {
  assert.equal(outline('question(points: 1.5, [Question notée], solution: [Réponse])')[0].title, '1. Question notée');
  for (const source of ['ds.typ', 'classe/graphes/ds.typ', 'exercices/test.typ']) {
    assert.deepEqual(identify('#show: feuille.with(type: "devoir", exercices: ())', source), { kind: 'document', type: 'devoir', direct: true });
  }
  assert.equal(identify('#show: feuille.with(type: "colle", exercices: ())')?.type, 'colle');
  assert.equal(identify('#show: feuille.with(exercices: ())')?.type, 'td');
  assert.equal(identify('#let ex = exercice()', 'racine.typ')?.kind, 'exercice');
  assert.deepEqual(identify('#let ex = exercice()', 'exercices/concours/24/extrait.typ'), { kind: 'exercice', direct: false });
  assert.equal(identify('#import "/sujet.typ": ex', 'alias.typ')?.kind, 'exercice');
  assert.equal(identify('#import "/sujet.typ": autre as ex', 'alias.typ')?.kind, 'exercice');
  for (const source of ['// #show: feuille.with()', '/* #let ex = exercice() */', '`#let ex = exercice()`', '#let texte = "#show: feuille.with()"']) assert.equal(identify(source), undefined);
  const feuille = editableSheet.replace('feuille.with(', 'feuille.with(type: "devoir",');
  assert.equal(sheetList(editSheet(feuille, 'libre.typ', { index: 0 }), 'libre.typ').entries.length, 1);
});

test('recherche : fichiers ouverts, historique récent, puis titres', () => {
  const opened = new Set(['/bank/a.typ', '/bank/z.typ']);
  const recent = ['/bank/b.typ', '/bank/z.typ', '/bank/c.typ'];
  const files = ['/bank/d.typ', '/bank/c.typ', '/bank/b.typ', '/bank/a.typ', '/bank/z.typ', '/other/z.typ'];
  files.sort((a, b) => searchPriority(a, opened, recent) - searchPriority(b, opened, recent) || a.localeCompare(b));
  assert.deepEqual(files, ['/bank/z.typ', '/bank/a.typ', '/bank/b.typ', '/bank/c.typ', '/bank/d.typ', '/other/z.typ']);
  assert.equal(searchPriority('/bank/a.typ', opened, []), 0);
  assert.equal(searchPriority('/bank/b.typ', opened, []), 1);
});

test('découverte : dépôt ouvert, dossier parent et chemin explicite', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mpi-discovery-'));
  try {
    const roots = ['exercices', 'exercices-prive', 'autre-banque'].map(name => path.join(temporary, name));
    for (const root of roots) {
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await writeFile(path.join(root, 'scripts/build.py'), '');
    }
    await mkdir(path.join(temporary, 'sans-banque'));
    assert.deepEqual((await bankCandidates(temporary)).sort(), [...roots].sort());
    assert.deepEqual(await bankCandidates(roots[0]), [roots[0]]);
    assert.deepEqual(await bankCandidates(temporary, 'exercices-prive'), [roots[1]]);
    assert.deepEqual(await bankCandidates(temporary, roots[2]), [roots[2]]);
    assert.deepEqual(await bankCandidates(temporary, 'sans-banque'), []);
    await mkdir(path.join(roots[0], 'imbrique/scripts'), { recursive: true });
    await writeFile(path.join(roots[0], 'imbrique/scripts/build.py'), '');
    assert.deepEqual(await bankCandidates(roots[0]), [roots[0]], 'Ne pas chercher dans un dépôt déjà reconnu');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
