import * as vscode from 'vscode';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { identify, sourceExclusions } from '../../src/documents';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { until } from './helpers';
import { SourceChanges } from '../../src/source-changes';

export async function run(api: any, extension: vscode.Extension<any>): Promise<void> {
  const manifest = extension.packageJSON.contributes;
  const commands = await vscode.commands.getCommands(true);
  assert.deepEqual(manifest.views.mpiExercices.map((view: { id: string }) => view.id), ['mpiExercices.current', 'mpiExercices.library', 'mpiExercices.sheets']);
  for (const section of ['current', 'library', 'sheets']) {
    await vscode.commands.executeCommand(`mpiExercices.${section}.focus`);
    assert.ok((await vscode.commands.getCommands(true)).includes(`workbench.actions.treeView.mpiExercices.${section}.collapseAll`));
    await vscode.commands.executeCommand(`mpiExercices.collapse${section}`);
  }
  for (const binding of manifest.keybindings) assert.ok(commands.includes(binding.command), binding.command);
  const sheetFiles: vscode.Uri[] = [];
  for (const uri of await vscode.workspace.findFiles('**/*.typ', sourceExclusions)) {
    const source = path.relative(process.env.MPI_EXERCICES_ROOT!, uri.fsPath).split(path.sep).join('/');
    if (identify((await vscode.workspace.openTextDocument(uri)).getText(), source)?.kind !== 'document') continue;
    sheetFiles.push(uri);
    assert.equal((await api.revealSheet(source)).source, source, 'Les compositions locales et calculées restent consultables');
  }
  const nestedSheet = sheetFiles.find(uri => path.relative(process.env.MPI_EXERCICES_ROOT!, uri.fsPath).split(path.sep).length > 2) ?? sheetFiles[0];
  assert.ok(nestedSheet, 'Une feuille existante pour tester reveal');
  const revealed = await api.revealSheet(path.relative(process.env.MPI_EXERCICES_ROOT!, nestedSheet.fsPath));
  assert.equal(revealed.source, path.relative(process.env.MPI_EXERCICES_ROOT!, nestedSheet.fsPath), 'Sélection réelle de la feuille avec TreeView.reveal');
  await parentWorkspace(api);
  await contentNotifications();
  console.log('Découverte et commandes vérifiées.');
}

async function contentNotifications(): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'mpi-watch-content-')));
  const file = path.join(directory, 'exemple.typ');
  const changes = new SourceChanges();
  const observed: boolean[] = [];
  const errors: unknown[] = [];
  let watcher: vscode.FileSystemWatcher | undefined;
  try {
    await writeFile(file, 'Contenu fictif.');
    await changes.prime([file]);
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, '*.typ'));
    const changed = (uri: vscode.Uri) => { void changes.changed(uri.fsPath).then(value => { observed.push(value); }, error => { errors.push(error); }); };
    watcher.onDidChange(changed);
    watcher.onDidCreate(changed);
    watcher.onDidDelete(changed);
    // Watch registration is asynchronous: repeat an identical write until VS Code is listening.
    await until(async () => {
      await writeFile(file, 'Contenu fictif.');
      return observed.length > 0 || errors.length > 0;
    }, 'Notification VS Code pour une réécriture identique');
    assert.deepEqual(errors, []);
    assert.ok(observed.every(value => !value), 'Une vraie notification sans changement de contenu est ignorée');
    await writeFile(file, 'Contenu modifié.');
    await until(() => observed.filter(Boolean).length === 1 || errors.length > 0, 'Détection du changement de contenu');
    assert.deepEqual(errors, []);
    await rm(file);
    await until(() => observed.filter(Boolean).length === 2 || errors.length > 0, 'Détection de la suppression');
    assert.deepEqual(errors, []);
    await writeFile(file, 'Contenu modifié.');
    await until(() => observed.filter(Boolean).length === 3 || errors.length > 0, 'Détection de la recréation');
    assert.deepEqual(errors, []);
  } finally {
    watcher?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function parentWorkspace(api: any): Promise<void> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'exercices-parent-')));
  const roots = ['exercices', 'exercices-prive'].map(name => path.join(parent, name));
  const entries = () => api.getEntries().filter((entry: { bank: string }) => roots.includes(entry.bank));
  try {
    for (const root of roots) {
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await mkdir(path.join(root, 'templates'));
      await writeFile(path.join(root, 'scripts/build.py'), '');
      await writeFile(path.join(root, 'templates/td.typ'), '#show: feuille.with(type: "td")');
      await writeFile(path.join(root, 'exemple.typ'), '#let ex = (titre: "Exercice fictif",)');
    }
    assert.ok(vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0, { uri: vscode.Uri.file(parent) }));
    await until(() => entries().length === 2, 'Les deux dépôts doivent être découverts depuis leur dossier parent');
    assert.deepEqual(entries().map((entry: { bank: string }) => entry.bank).sort(), [...roots].sort());
    assert.ok(vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0, { uri: vscode.Uri.file(roots[0]) }));
    await until(() => !!vscode.workspace.workspaceFolders?.some(folder => folder.uri.fsPath === roots[0]), 'Le dépôt doit être ajouté à l’espace de travail');
    // The refresh command waits for the queued workspace discovery.
    await vscode.commands.executeCommand('mpiExercices.refresh');
    assert.equal(entries().length, 2, 'Un dépôt ouvert aussi directement ne doit pas apparaître deux fois');
  } finally {
    for (const root of [roots[0], parent]) {
      const index = vscode.workspace.workspaceFolders?.findIndex(folder => folder.uri.fsPath === root) ?? -1;
      if (index >= 0) {
        vscode.workspace.updateWorkspaceFolders(index, 1);
        await until(() => !vscode.workspace.workspaceFolders?.some(folder => folder.uri.fsPath === root), 'Le dossier doit être retiré de l’espace de travail');
        await vscode.commands.executeCommand('mpiExercices.refresh');
      }
    }
    await until(() => entries().length === 0, 'Les dépôts retirés doivent disparaître');
    await rm(parent, { recursive: true, force: true });
  }
}
