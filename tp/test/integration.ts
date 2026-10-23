import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
export async function run() {
  const extension = vscode.extensions.getExtension('qfortier.vscode-mpi-tp')!;
  const api = await extension.activate();
  assert.equal(api.entries.length, 1);
  assert.equal(api.course[0].id, 'tp-test');
  await api.open('tp-test');
  assert.equal(api.started.length, 1);
  const deadline = Date.now() + 20000;
  while (!api.previewStatus.get(api.started[0].directory)?.pages && Date.now() < deadline) {
    assert.equal(api.previewStatus.get(api.started[0].directory)?.error, undefined);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(api.previewStatus.get(api.started[0].directory)?.pages, 1);
  const rendering = () => api.previewStatus.get(api.started[0].directory);
  const first = rendering();
  assert.equal(first.pixelRatio, 2, 'Le test utilise un écran de densité double');
  assert(Math.abs(first.width - first.displayWidth * first.pixelRatio) <= 1, 'Le bitmap couvre les pixels physiques de la page');
  await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
  const resizedDeadline = Date.now() + 20000;
  while (rendering().displayWidth === first.displayWidth && Date.now() < resizedDeadline) {
    assert.equal(rendering().error, undefined);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.notEqual(rendering().displayWidth, first.displayWidth, 'Redimensionner le panneau recalcule le PDF');
  assert(Math.abs(rendering().width - rendering().displayWidth * rendering().pixelRatio) <= 1);

  // Vérifier les pixels du papier, pas seulement la détection clair/sombre.
  const settings = vscode.workspace.getConfiguration('workbench');
  const previousTheme = settings.get<string>('colorTheme');
  const previousColors = settings.get('colorCustomizations');
  try {
    for (const [theme, background, foreground, rgb] of [
      ['Default Light Modern', '#e8dfcc', '#302010', [232, 223, 204]],
      ['Default Dark Modern', '#243648', '#eef3f8', [36, 54, 72]],
      ['Default High Contrast', '#101820', '#ffffff', [16, 24, 32]],
    ] as const) {
      await settings.update('colorTheme', theme, vscode.ConfigurationTarget.Workspace);
      await settings.update('colorCustomizations', { 'editor.background': background, 'editor.foreground': foreground }, vscode.ConfigurationTarget.Workspace);
      // Le filtre de couleurs PDF.js peut arrondir une composante d'un niveau.
      const matchesPaper = () => rendering().background?.[3] === 255 && rgb.every((value, i) => Math.abs(rendering().background[i] - value) <= 1);
      const themeDeadline = Date.now() + 20000;
      while (!matchesPaper() && Date.now() < themeDeadline) {
        assert.equal(rendering().error, undefined);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(rendering().pageColors.background, background, `Couleurs de l'éditeur : ${theme}`);
      assert.equal(rendering().pageColors.foreground, foreground);
      assert(matchesPaper(), `Le papier adopte le thème : ${theme}`);
    }
  } finally {
    await settings.update('colorTheme', previousTheme, vscode.ConfigurationTarget.Workspace);
    await settings.update('colorCustomizations', previousColors, vscode.ConfigurationTarget.Workspace);
  }

  const file = path.join(api.started[0].directory, 'main.ml');
  await writeFile(file, 'let travail = 42\n');
  await api.open('tp-test');
  assert.equal(await readFile(file, 'utf8'), 'let travail = 42\n');
  assert.equal(vscode.window.tabGroups.all.length, 2);
  const groups = vscode.window.tabGroups.all;
  assert(groups[0].tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === file));
  assert(groups[1].tabs.some(tab => tab.input instanceof vscode.TabInputWebview));
  await vscode.commands.executeCommand('mpiTp.search');
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
}
