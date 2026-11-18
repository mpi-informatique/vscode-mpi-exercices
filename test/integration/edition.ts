import * as vscode from 'vscode';
import * as path from 'node:path';
import { stat, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Runner } from '../../src/runner';
import { sheetFromTemplate, contestFromTemplate, creationPath } from '../../src/typst';
import { Browser } from '../../src/browser';
import { searchItem, searchPicker } from '../../src/search';
import { isFolder } from '../../src/tree';
import { Sheets, memberItem } from '../../src/sheets';
import { relocated, moveSource, directories } from '../../src/files';
import { sheetList, sourceMetadata } from '../../src/sheet-model';
import { Drag } from '../../src/drag';
import { identify } from '../../src/documents';
import { fixture, until } from './helpers';
import { associatedCodes, CodeLinks, openAssociatedCode } from '../../src/code-files';
export async function run(_api: any, _extension?: unknown): Promise<void> {
  const { temporary, previewBank, customTemplate, relative, generated, file } = await fixture();
  const bank = process.env.MPI_EXERCICES_ROOT!;
  const runner = new Runner();
  try {
    const exerciseEditor = await vscode.window.showTextDocument(vscode.Uri.file(file));
    await vscode.commands.executeCommand('mpiExercices.goToQuestion', '1');
    assert.match(exerciseEditor.document.lineAt(exerciseEditor.selection.active.line).text, /\bquestion(?:\(|\[)/);
    const copyFile = path.join(temporary, 'copie-fictive.typ');
    await writeFile(copyFile, `#show: feuille.with(type: "copie")
#let donnees = (evaluations: (
  "1.1": (reponse: "Une réponse."),
  "2.1": (reponse: "Autre réponse."),
  "2.15": (reponse: "Dernière réponse."),
))`);
    const copyEditor = await vscode.window.showTextDocument(vscode.Uri.file(copyFile));
    for (const [input, key] of [['15', '2.15'], ['2.1', '2.1']] as const) {
      await vscode.commands.executeCommand('mpiExercices.goToQuestion', input);
      assert.equal(copyEditor.document.offsetAt(copyEditor.selection.active), copyEditor.document.getText().indexOf(`"${key}"`));
    }
    await codeAccess(previewBank, _api);
    const entries = [{ bank: previewBank, ex: {
      ...sourceMetadata(generated, relative), titre: 'Automates et monoïdes', concours: { nom: 'ENS' },
    } }];
    const state = { get: (_key: string, fallback: unknown) => fallback, update: async () => undefined } as unknown as vscode.Memento;
    const browser = new Browser('exercices', state);
    browser.entries = entries.map(item => ({ ...item, source: item.ex.fichier }));
    const choice = searchItem(browser.entries[0]);
    assert.ok(choice.description?.includes(browser.entries[0].source));
    assert.ok(choice.detail?.includes('ENS'));
    assert.equal(browser.search('monoides').length, 1);
    const chooseFile = searchPicker(browser);
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    assert.equal(await chooseFile, browser.entries[0]);
    const cancelSearch = searchPicker(browser);
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    assert.equal(await cancelSearch, undefined);
    assert.equal(browser.getTreeItem(browser.entries[0]).resourceUri?.fsPath, path.join(previewBank.root, browser.entries[0].source));
    assert.equal(browser.search('absent').length, 0);
    assert.equal(browser.visible.length, 1, 'La recherche ne filtre pas la vue');
    assert.ok(isFolder(browser.getChildren()[0]));
    assert.equal(browser.searching, false);
    browser.filters = { concours: 'ENS' }; assert.equal(browser.searching, true); browser.filters = {};
    const parent = browser.getParent(browser.entries[0]);
    assert.ok(parent && isFolder(parent));
    assert.equal(browser.getTreeItem(parent).resourceUri?.fsPath, parent.folder);
    assert.equal(browser.getParent(browser.entries[0]), parent, 'Identité du dossier stable');
    assert.ok(browser.getParent(parent), 'Dossier physique exercices conservé');
    browser.toggle(); assert.ok(!isFolder(browser.getChildren()[0]));
    assert.equal(browser.getParent(browser.entries[0]), undefined);
    browser.dispose();
    const sheetBrowser = new Browser('documents', state);
    sheetBrowser.entries = [{ bank: previewBank, source: 'exercices/feuilles/td.typ', documentType: 'td', metadata: [sourceMetadata('titre: "Série spéciale"', 'exercices/feuilles/td.typ'), entries[0].ex] }];
    sheetBrowser.filters = { concours: 'ENS' };
    assert.equal(sheetBrowser.search('speciale monoides').length, 1, 'Titre de feuille combiné aux métadonnées de ses exercices');
    sheetBrowser.filters = { concours: 'X' }; assert.equal(sheetBrowser.visible.length, 0);
    sheetBrowser.entries.push(
      { bank: previewBank, source: 'exercices/devoirs/2026-2027/ds.typ', documentType: 'devoir', metadata: [sourceMetadata('titre: "Devoir test"', 'exercices/devoirs/2026-2027/ds.typ')] },
      { bank: previewBank, source: 'exercices/concours/24/sujet.typ', documentType: 'concours', metadata: [sourceMetadata('titre: "Concours test"', 'exercices/concours/24/sujet.typ')] });
    sheetBrowser.filters = {};
    const roots = sheetBrowser.getChildren();
    assert.deepEqual(roots.map(root => isFolder(root) && root.title), ['exercices']);
    assert.deepEqual(sheetBrowser.getChildren(roots[0]).map(root => isFolder(root) && root.title), ['concours', 'devoirs', 'feuilles']);
    const devoirParent = sheetBrowser.getParent(sheetBrowser.entries[1]);
    assert.ok(devoirParent && isFolder(devoirParent) && devoirParent.title === '2026-2027');
    const devoirRoot = sheetBrowser.getParent(devoirParent);
    assert.ok(devoirRoot && isFolder(devoirRoot) && devoirRoot.title === 'devoirs');
    sheetBrowser.filters = { type: 'concours' };
    assert.equal(sheetBrowser.visible.length, 1);
    assert.equal(sheetBrowser.search('Concours').length, 1);
    assert.equal(sheetBrowser.getChildren().length, 1);
    sheetBrowser.filters = { type: 'absent' };
    assert.deepEqual(sheetBrowser.getChildren(), [], 'Aucun dossier sans fichier correspondant aux filtres');
    const originalEntries = [...sheetBrowser.entries];
    const otherBank = { ...previewBank, root: temporary + '-autre', name: 'Autre banque' };
    sheetBrowser.entries.push({ ...originalEntries[0], bank: otherBank });
    sheetBrowser.filters = { type: 'concours' };
    const filteredRoots = sheetBrowser.getChildren();
    assert.equal(filteredRoots.length, 1, 'Aucune racine de banque vide');
    assert.ok(isFolder(filteredRoots[0]) && filteredRoots[0].title === 'exercices');
    const concoursRoot = sheetBrowser.getChildren(filteredRoots[0])[0];
    assert.ok(isFolder(concoursRoot) && concoursRoot.title === 'concours');
    sheetBrowser.filters = {};
    sheetBrowser.entries = [];
    assert.deepEqual(sheetBrowser.getChildren(), [], 'La suppression du dernier fichier retire ses dossiers');
    sheetBrowser.entries = originalEntries;
    sheetBrowser.filters = {};
    sheetBrowser.toggle(); assert.equal(sheetBrowser.getChildren().length, 3);
    assert.ok(sheetBrowser.getChildren().every(node => !isFolder(node)));
    sheetBrowser.dispose();
    const sheet = sheetFromTemplate(await readFile(path.join(bank, 'templates/feuille.typ'), 'utf8'), 'Feuille de test', [relative]);
    await writeFile(path.join(temporary, 'exercices/feuilles/test-creation.typ'), sheet);
    const sheetEditor = new Sheets(() => [previewBank], () => [{ bank: previewBank, ex: sourceMetadata(generated, relative) }]);
    const members = await sheetEditor.members(previewBank, 'exercices/feuilles/test-creation.typ');
    assert.equal(members[0].title, 'Test création');
    assert.equal(memberItem(members[0]).resourceUri?.fsPath, path.join(previewBank.root, relative));
    await sheetEditor.change(members[0]);
    const sheetDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(temporary, 'exercices/feuilles/test-creation.typ')));
    assert.equal(sheetList(sheetDocument.getText(), 'exercices/feuilles/test-creation.typ').entries.length, 0);
    assert.ok(!sheetDocument.isDirty, 'Retrait enregistré automatiquement');
    assert.ok(!sheetDocument.getText().includes('/' + relative), 'Import retiré');
    await sheetEditor.add(previewBank, relative, 'exercices/feuilles/test-creation.typ');
    assert.equal(sheetList(sheetDocument.getText(), 'exercices/feuilles/test-creation.typ').entries.length, 1);
    assert.ok(!sheetDocument.isDirty, 'Ajout enregistré automatiquement');
    await assert.rejects(sheetEditor.change({ ...members[0], snapshot: 'obsolete' }));
    sheetEditor.selected = { bank: previewBank, source: 'exercices/feuilles/selection.typ' };
    sheetEditor.current = { bank: previewBank, source: 'exercices/feuilles/autre.typ' };
    assert.equal(sheetEditor.target?.source, 'exercices/feuilles/selection.typ');
    const moved: string[] = [];
    const drag = new Drag<any>(() => sheetEditor, async (_from, to) => { moved.push(to); }, error => { throw error; });
    const transfer = new vscode.DataTransfer();
    drag.handleDrag([{ bank: previewBank, source: relative }], transfer);
    await drag.handleDrop({ bank: previewBank, source: 'exercices', folder: 'exercices' }, transfer);
    assert.deepEqual(moved, ['exercices/test-creation.typ']);
    const devoirPath = 'exercices/devoirs/2026-2027/ds-test.typ';
    const devoir = sheetFromTemplate(await readFile(path.join(bank, 'templates/devoir.typ'), 'utf8'), 'Devoir de test', []);
    await writeFile(path.join(temporary, devoirPath), devoir);
    const devoirDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(temporary, devoirPath)));
    assert.equal(sheetEditor.locate(devoirDocument.uri)?.source, devoirPath);
    await sheetEditor.add(previewBank, relative, devoirPath);
    const devoirMembers = await sheetEditor.members(previewBank, devoirPath);
    assert.equal(devoirMembers[0].title, 'Test création');
    assert.ok(!devoirDocument.isDirty);
    await sheetEditor.change(devoirMembers[0]);
    assert.ok(!devoirDocument.getText().includes('/' + relative));
    // Exercise-to-devoir drops compose; blank unified-view drops keep the physical type.
    const sheetDrag = new Drag<any>(() => sheetEditor, async (_from, to) => { moved.push(to); }, error => { throw error; });
    await sheetDrag.handleDrop({ bank: previewBank, source: devoirPath }, transfer);
    assert.equal((await sheetEditor.members(previewBank, devoirPath)).length, 1);
    const devoirTransfer = new vscode.DataTransfer();
    sheetDrag.handleDrag([{ bank: previewBank, source: devoirPath }], devoirTransfer);
    await sheetDrag.handleDrop(undefined, devoirTransfer);
    assert.equal(moved.at(-1), 'ds-test.typ');
    await assert.rejects(sheetEditor.add(previewBank, relative, relative));
    await sheetDocument.save(); sheetEditor.dispose();
    await runner.run(previewBank, ['c', 'exercices/feuilles/test-creation.typ']);
    await runner.run(previewBank, ['c', devoirPath]);
    for (const variant of ['enonce', 'corrige']) assert.ok((await stat(path.join(temporary, `build/exercices/devoirs/2026-2027/ds-test/ds-test${variant === 'corrige' ? '-cor' : ''}.pdf`))).size > 1000);
    // No category prefix, no mandatory year folder, and a new type without code changes.
    const customSource = sheetFromTemplate(customTemplate, 'Colle à la racine', [relative]);
    await writeFile(path.join(temporary, 'colle-test.typ'), customSource);
    assert.equal(identify(customSource, 'colle-test.typ')?.type, 'colle');
    await runner.run(previewBank, ['c', 'colle-test.typ']);
    assert.ok((await stat(path.join(temporary, 'build/colle-test/colle-test-cor.pdf'))).size > 1000);
    const contestPath = creationPath('exercices/concours/24', 'sujet-test');
    await mkdir(path.join(temporary, 'exercices/concours/24'), { recursive: true });
    await writeFile(path.join(temporary, contestPath), contestFromTemplate(await readFile(path.join(temporary, 'templates/sujet-concours.typ'), 'utf8'), 'Sujet de test'));
    await runner.run(previewBank, ['c', contestPath]);
    for (const variant of ['enonce', 'corrige']) assert.ok((await stat(path.join(temporary, 'build/exercices/concours/24/sujet-test', `sujet-test${variant === 'corrige' ? '-cor' : ''}.pdf`))).size > 1000);
    assert.equal(relocated('#import "../../../lib/exercice.typ": exercice\n#image("../../../ressources/a.png")', relative, relative, 'exercices/test-creation.typ'), '#import "../lib/exercice.typ": exercice\n#image("../ressources/a.png")');
    assert.ok((await directories(previewBank, 'exercices')).some(item => item.source === 'exercices/banque/graphes'));
    await moveSource({ bank: previewBank, source: relative }, 'test-creation.typ');
    assert.ok(sheetDocument.getText().includes('/test-creation.typ'), 'Références actualisées après déplacement à la racine');
    assert.ok((await stat(path.join(temporary, 'test-creation.typ'))).size > 0);
    await assert.rejects(stat(file));
  } finally { runner.dispose(); await vscode.commands.executeCommand('workbench.action.closeAllEditors'); await rm(temporary, { recursive: true, force: true }); }
  console.log('Édition, recherche, déplacements et exports vérifiés.');
}

async function codeAccess(bank: { root: string; name: string; scope: vscode.Uri }, api: any): Promise<void> {
  const directory = path.join(bank.root, 'exercices/codes');
  await mkdir(directory, { recursive: true });
  const source = 'exercices/codes/codes.typ';
  const text = '#import "helper.typ"\n#let code = read("corrige.ml")\n// read("ignore.c")\n```typst\n#read("ignore.c")\n```\n#read("absent.ml")\n#read("externe.ml")';
  for (const [name, content] of Object.entries({ 'codes.typ': text, 'helper.typ': '#import "codes.typ"\n#read("../importe.sql")', 'corrige.ml': 'let réponse = 42', 'programme.py': 'print(42)', 'ignore.c': 'int x;' })) await writeFile(path.join(directory, name), content);
  await writeFile(path.join(bank.root, 'exercices/importe.sql'), 'select 42;');
  await symlink(path.join(process.env.MPI_PUBLIC_ROOT!, 'load.typ'), path.join(directory, 'externe.ml'));
  const files = await associatedCodes({ bank, source });
  assert.deepEqual(files, ['exercices/codes/corrige.ml', 'exercices/codes/ignore.c', 'exercices/codes/programme.py', 'exercices/importe.sql'], 'Imports cycliques, plusieurs codes voisins, fichiers absents et liens externes');
  const uri = vscode.Uri.file(path.join(bank.root, source));
  const document = await vscode.workspace.openTextDocument(uri);
  const provider = new CodeLinks(() => [bank]);
  const cancellation = new vscode.CancellationTokenSource();
  const registration = vscode.languages.registerDocumentLinkProvider({ scheme: 'file', pattern: directory + '/*.typ' }, provider);
  try {
    const registeredLinks = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', uri);
    assert.ok(registeredLinks.some(link => link.target?.fsPath === path.join(directory, 'corrige.ml')), 'Le fournisseur est accessible par l’API VS Code');
    const links = await provider.provideDocumentLinks(document, cancellation.token);
    assert.equal(links.filter(link => link.target?.fsPath === path.join(directory, 'corrige.ml')).length, 1);
    assert.ok(!links.some(link => link.target?.fsPath.endsWith('externe.ml') || link.target?.fsPath.endsWith('ignore.c')));
    const link = links.find(link => link.target?.fsPath === path.join(directory, 'corrige.ml'))!;
    assert.equal(document.getText(link.range), 'corrige.ml', 'Lien exactement sur le nom, sans les guillemets');
    await vscode.window.showTextDocument(uri);
    const opening = openAssociatedCode({ bank, source });
    await until(async () => {
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      return vscode.window.activeTextEditor?.document.uri.fsPath === path.join(directory, 'corrige.ml');
    }, 'Le choix parmi plusieurs codes doit ouvrir le fichier sélectionné');
    await opening;
  } finally { registration.dispose(); cancellation.dispose(); }
  const single = 'exercices/lien-code.typ';
  await writeFile(path.join(bank.root, single), '#read("importe.sql")');
  await openAssociatedCode({ bank, source: single });
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(bank.root, 'exercices/importe.sql'));
  const edit = new vscode.WorkspaceEdit();
  const singleDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, single)));
  edit.replace(singleDocument.uri, new vscode.Range(singleDocument.positionAt(0), singleDocument.positionAt(singleDocument.getText().length)), '#read("codes/corrige.ml")');
  await vscode.workspace.applyEdit(edit);
  assert.ok(singleDocument.isDirty);
  await openAssociatedCode({ bank, source: single });
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(directory, 'corrige.ml'), 'Les modifications non enregistrées sont prises en compte');
  await vscode.window.showTextDocument(singleDocument);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  let commandChecked = false;
  for (const entry of api.getEntries()) {
    const codes = await associatedCodes({ bank: { root: entry.bank, name: 'Banque ouverte', scope: vscode.Uri.file(entry.bank) }, source: entry.fichier });
    if (codes.length !== 1) continue;
    await vscode.commands.executeCommand('mpiExercices.code', vscode.Uri.file(path.join(entry.bank, entry.fichier)));
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(entry.bank, codes[0]), 'La commande réelle ouvre le code de la banque');
    commandChecked = true;
    break;
  }
  assert.ok(commandChecked, 'Au moins un exercice de la banque possède un code pour vérifier la commande');
  await rm(path.join(bank.root, 'exercices/lien-code.typ'));
  await rm(path.join(bank.root, 'exercices/importe.sql'));
  await rm(directory, { recursive: true, force: true });
}
