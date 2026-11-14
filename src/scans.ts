import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pdfViewerHtml, escapeHtml } from '@mpi-informatique/exercices-core/pdf-viewer';
import { variantLabels } from './core';
import { Bank } from './runner';
import { identify } from './documents';
import { copyDirectory } from './copy-inputs';
import { copyScans } from './copy-scans';
import { scrollbarStyle } from './scrollbars';

export class Scans implements vscode.Disposable {
  readonly entries = new Map<string, vscode.WebviewPanel>();
  private disposed = false;
  constructor(private readonly context: vscode.ExtensionContext) {}

  async open(bank: Bank, source: string, beside?: vscode.ViewColumn): Promise<vscode.WebviewPanel | undefined> {
    const key = path.join(bank.root, source);
    const existing = this.entries.get(key);
    const anchor = beside ?? vscode.window.visibleTextEditors.find(editor => editor.document.uri.fsPath === key)?.viewColumn;
    const column = anchor && anchor > 0 ? anchor + 1 : vscode.ViewColumn.Beside;
    if (existing) { existing.reveal(beside ? column : undefined, true); return existing; }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(key));
    if (identify(document.getText(), source)?.type !== 'copie') throw new Error('Le scan est disponible pour les copies.');
    let files = await copyScans(bank.root, source, document.getText());
    const association = `scan:${key}`;
    const saved = this.context.workspaceState?.get<string>(association);
    if (!files.length && saved) {
      try { if ((await stat(saved)).isFile()) files = [saved]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    let file: string | undefined;
    if (files.length > 1) file = (await vscode.window.showQuickPick(files.map(file => ({ label: path.basename(file), description: path.relative(copyDirectory(key), file), file })), { title: 'Choisir le scan de la copie' }))?.file;
    else file = files[0];
    if (!files.length) {
      file = (await vscode.window.showOpenDialog({ title: 'Choisir le scan de la copie', openLabel: 'Afficher le scan', canSelectMany: false, filters: { PDF: ['pdf'] }, defaultUri: vscode.Uri.file(copyDirectory(key)) }))?.[0]?.fsPath;
      if (file) await this.context.workspaceState?.update(association, file);
    }
    if (!file) return;
    let pdf = (await readFile(file)).toString('base64');
    if (this.disposed) return;
    const opened = this.entries.get(key);
    if (opened) { opened.reveal(beside ? column : undefined, true); return opened; }
    const panel = vscode.window.createWebviewPanel('mpiExercices.scan', `Scan — ${path.basename(file)}`, { viewColumn: column, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'viewer'), vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')]
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdf.svg');
    this.entries.set(key, panel);
    const channel = randomBytes(18).toString('hex');
    let dark = false;
    const show = () => panel.webview.postMessage({ channel, type: 'show', variant: 'enonce', labels: variantLabels(), native: false, jumps: false, dark, pdf, sessions: {}, tokens: {} });
    const listener = panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'ready') await show();
        else if (message?.type === 'theme') { dark = !dark; await show(); }
        else if (message?.type === 'fullscreen') await vscode.commands.executeCommand('workbench.action.toggleZenMode');
        else if (message?.type === 'restart') { pdf = (await readFile(file)).toString('base64'); await show(); }
        else if (message?.type === 'save') {
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(file), filters: { PDF: ['pdf'] } });
          if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(pdf, 'base64'));
        }
      } catch (error) { await panel.webview.postMessage({ channel, type: 'status', message: String(error) }); }
    });
    panel.onDidDispose(() => { listener.dispose(); this.entries.delete(key); });
    panel.webview.html = pdfViewerHtml({ nonce: randomBytes(18).toString('base64'), channel, cspSource: panel.webview.cspSource,
      pdfjs: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')).toString(),
      uri: file => escapeHtml(panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'viewer', file)).toString()),
      variants: [], labels: variantLabels(), variant: 'enonce', scrollbarStyle });
    return panel;
  }

  dispose(): void { this.disposed = true; for (const panel of [...this.entries.values()]) panel.dispose(); }
}
