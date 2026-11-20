import * as vscode from 'vscode';
import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import { Bank } from './runner';
import { identify } from './documents';
import { copyDirectory } from './copy-inputs';
import { copyScans } from './copy-scans';

export async function chooseScan(bank: Bank, source: string, workspaceState: vscode.Memento): Promise<string | undefined> {
  const key = path.join(bank.root, source);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(key));
  if (identify(document.getText(), source)?.type !== 'copie') throw new Error('Le scan est disponible pour les copies.');
  let files = await copyScans(bank.root, source, document.getText());
  const association = `scan:${key}`;
  const saved = workspaceState?.get<string>(association);
  if (!files.length && saved) {
    try { if ((await stat(saved)).isFile()) files = [saved]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let file: string | undefined;
  if (files.length > 1) file = (await vscode.window.showQuickPick(files.map(file => ({ label: path.basename(file), description: path.relative(copyDirectory(key), file), file })), { title: 'Choisir le scan de la copie' }))?.file;
  else file = files[0];
  if (!files.length) {
    file = (await vscode.window.showOpenDialog({ title: 'Choisir le scan de la copie', openLabel: 'Afficher le scan', canSelectMany: false, filters: { PDF: ['pdf'] }, defaultUri: vscode.Uri.file(copyDirectory(key)) }))?.[0]?.fsPath;
    if (file) await workspaceState?.update(association, file);
  }
  return file;
}
