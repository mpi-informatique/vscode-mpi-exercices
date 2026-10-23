import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pdfViewerHtml } from '@mpi-informatique/exercices-core/pdf-viewer';
import { variantLabels, type Variant } from '@mpi-informatique/exercices-core';
import type { Started } from './storage';
import { download } from './storage';
import { resourceUrl, type Tp } from './core';

export class Previews implements vscode.Disposable {
  readonly status = new Map<string, { pages?: number; error?: string; pixelRatio?: number; width?: number; displayWidth?: number; pageColors?: { background: string; foreground: string }; background?: number[] }>();
  private permissions = new Map<string, () => void>();
  revalidate() { for (const update of this.permissions.values()) update(); }
  private panels = new Map<string, vscode.WebviewPanel>();
  constructor(private context: vscode.ExtensionContext) {}
  dispose() { for (const panel of this.panels.values()) panel.dispose(); }
  open(record: Started, current: Tp, allowCorrection: () => boolean, site: string, openCode: () => Promise<void>): vscode.WebviewPanel {
    const existing = this.panels.get(record.directory);
    if (existing) { existing.reveal(vscode.ViewColumn.Two, true); this.revalidate(); return existing; }
    const panel = vscode.window.createWebviewPanel('mpiTp.pdf', current.titre, { viewColumn: vscode.ViewColumn.Two, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    });
    this.panels.set(record.directory, panel);
    this.status.set(record.directory, {});
    const webview = panel.webview;
    const channel = randomBytes(18).toString('hex');
    const labels = variantLabels();
    let variant: Variant = 'enonce';
    const isDark = () => [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind);
    let darkOverride: boolean | undefined;
    let ready = false;
    const pdfs = new Map<Variant, string>();
    const post = (data: object) => webview.postMessage({ ...data, channel });
    const show = async () => {
      const selected = variant;
      if (selected === 'corrige' && (!allowCorrection() || !current.pdfs.corrige)) throw new Error('Corrigé non publié pour ce TP.');
      if (!pdfs.has(selected)) {
        if (selected === 'corrige') {
          const bytes = await download(resourceUrl(current.pdfs.corrige!, site));
          if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Corrigé PDF invalide.');
          pdfs.set(selected, Buffer.from(bytes).toString('base64'));
        } else pdfs.set(selected, (await readFile(path.join(record.directory, '.mpi/enonce.pdf'))).toString('base64'));
      }
      if (selected === 'corrige' && !allowCorrection()) { variant = 'enonce'; await show(); return; }
      await post({ type: 'show', variant: selected, labels, pdf: pdfs.get(selected), native: false, dark: darkOverride ?? isDark(), theme: darkOverride === undefined ? 'vscode' : undefined, allowedVariants: allowCorrection() && current.pdfs.corrige ? ['enonce', 'corrige'] : ['enonce'], hasCode: true, sessions: {}, jumps: false });
    };
    let queue = Promise.resolve();
    const listener = webview.onDidReceiveMessage(message => {
      queue = queue.then(async () => {
        if (message?.type === 'pdfReady') this.status.set(record.directory, { pages: message.pages, pixelRatio: message.pixelRatio, width: message.width, displayWidth: message.displayWidth, pageColors: message.pageColors, background: message.background });
        else if (['pdfError', 'clientError'].includes(message?.type)) this.status.set(record.directory, { error: message.error });
        else if (message?.type === 'ready') { ready = true; await show(); }
        else if (message?.type === 'enonce' || message?.type === 'corrige') { variant = message.type; await show(); }
        else if (message?.type === 'theme') { darkOverride = !(darkOverride ?? isDark()); await show(); }
        else if (message?.type === 'restart') { pdfs.clear(); await post({ type: 'reset' }); await show(); }
        else if (message?.type === 'code') await openCode();
        else if (message?.type === 'fullscreen') await vscode.commands.executeCommand('workbench.action.toggleZenMode');
        else if (message?.type === 'save' && ready) {
          const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(record.directory, `${current.id}${variant === 'corrige' ? '-cor' : ''}.pdf`)), filters: { PDF: ['pdf'] } });
          if (uri && pdfs.has(variant)) await writeFile(uri.fsPath, Buffer.from(pdfs.get(variant)!, 'base64'));
        }
      }).catch(async error => { variant = 'enonce'; await post({ type: 'status', message: String(error) }); });
    });
    const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      darkOverride = undefined;
      queue = queue.then(async () => { if (ready) await show(); })
        .catch(async error => { await post({ type: 'status', message: String(error) }); });
    });
    this.permissions.set(record.directory, () => {
      // Une ancienne vue ne doit pas conserver un corrigé retiré du menu.
      queue = queue.then(async () => {
        if (!allowCorrection()) variant = 'enonce';
        if (ready) await show();
      }).catch(async error => { await post({ type: 'status', message: String(error) }); });
    });
    webview.html = pdfViewerHtml({ nonce: randomBytes(18).toString('base64'), channel, cspSource: webview.cspSource,
      pdfjs: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist/pdfjs')).toString(),
      uri: file => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist/viewer', file)).toString(),
      variants: current.pdfs.corrige ? ['enonce', 'corrige'] : ['enonce'], hiddenVariants: allowCorrection() ? [] : ['corrige'], labels, variant });
    panel.onDidDispose(() => { listener.dispose(); themeListener.dispose(); this.permissions.delete(record.directory); if (this.panels.get(record.directory) === panel) this.panels.delete(record.directory); });
    return panel;
  }
}
