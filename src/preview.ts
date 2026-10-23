import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Variant, availableVariants, pdfTarget, pdfFilename, variantLabels } from './core';
import { Bank, Runner } from './runner';
import * as tinymist from './tinymist';
import { errorStatus } from './errors';
import { copyDirectory } from './copy-inputs';
import { identify } from './documents';
import { Preparation } from './preparation';
import { associatedCodes, openAssociatedCode } from './code-files';
import { pdfViewerHtml } from '@mpi-informatique/exercices-core/pdf-viewer';
import { scrollbarStyle } from './scrollbars';

export interface Preview {
  bank: Bank; source: string; variant: Variant; panel: vscode.WebviewPanel;
  documentType?: string;
  sessions: Map<Variant, tinymist.Session>;
  jumps: boolean;
  native: boolean;
  dark?: boolean;
  toggleJumps(): Promise<void>;
  toggleTheme(): Promise<void>;
  select(variant: Variant): Promise<void>;
  restart(): Promise<void>;
}
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Previews implements vscode.Disposable {
  readonly entries = new Map<string, Preview>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private editor = vscode.window.activeTextEditor;
  private fallback = new Runner();
  private prepared = new Preparation<tinymist.Session>();
  private disposed = false;
  private preparationEpoch = 0;
  constructor(private readonly context: vscode.ExtensionContext, private readonly exportPdf: (preview: Preview, variant: Variant) => Promise<void>, private readonly hasTinymist = () => !!vscode.extensions.getExtension('myriad-dreamin.tinymist'), private readonly startTinymist = tinymist.start) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.path.endsWith('.typ')) this.editor = editor; }), vscode.window.onDidChangeTextEditorSelection(event => {
      const mode = vscode.workspace.getConfiguration('tinymist').get<string>('preview.scrollSync', 'onSelectionChangeByMouse');
      if (mode === 'never' || event.kind === vscode.TextEditorSelectionChangeKind.Command || (mode === 'onSelectionChangeByMouse' && event.kind !== vscode.TextEditorSelectionChangeKind.Mouse)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.sync(event.textEditor).catch(this.report); }, 120);
    }), vscode.window.onDidChangeActiveColorTheme(() => { this.clearPreparation(); this.restart(); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('mpiExercices') || event.affectsConfiguration('tinymist.serverPath')) this.clearPreparation();
      if (event.affectsConfiguration('mpiExercices.previewTheme')) this.restart();
    }),
    vscode.workspace.onDidSaveTextDocument(doc => { for (const preview of this.entries.values()) if (!preview.native && doc.uri.fsPath.startsWith(preview.bank.root + path.sep)) void preview.restart().catch(this.report); }));
    const statistics = vscode.workspace.createFileSystemWatcher('**/{notes,recapitulatif}.csv');
    const updateStatistics = (uri: vscode.Uri) => {
      this.clearPreparation();
      for (const preview of this.entries.values()) {
        if (path.dirname(uri.fsPath) === copyDirectory(path.join(preview.bank.root, preview.source)))
          void preview.restart().catch(this.report);
      }
    };
    statistics.onDidChange(updateStatistics);
    statistics.onDidCreate(updateStatistics);
    statistics.onDidDelete(updateStatistics);
    const packages = vscode.workspace.createFileSystemWatcher('**/{*.nix,flake.lock,typst.toml,typst-packages.json}');
    const invalidatePackages = () => this.clearPreparation();
    packages.onDidChange(invalidatePackages);
    packages.onDidCreate(invalidatePackages);
    packages.onDidDelete(invalidatePackages);
    this.subscriptions.push(statistics, packages);
  }
  private preparationKey(bank: Bank, source: string, documentType?: string): string {
    const config = vscode.workspace.getConfiguration('mpiExercices', bank.scope);
    return JSON.stringify([bank.root, source, documentType, config.get('execution'), config.get('nixPath'), config.get('pythonPath'), config.get('previewTheme'), vscode.window.activeColorTheme.kind, vscode.workspace.getConfiguration('tinymist', bank.scope).get('serverPath')]);
  }

  clearPreparation(): void { this.preparationEpoch++; this.prepared.clear(); }

  async prepare(bank: Bank, source: string): Promise<void> {
    if (this.disposed || !this.hasTinymist() || !vscode.workspace.isTrusted) return;
    const current = this.entries.get(`${bank.root}/${source}`);
    if (current && (!current.native || current.dark !== undefined)) return;
    const epoch = ++this.preparationEpoch;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, source)));
    if (this.disposed || epoch !== this.preparationEpoch || this.entries.get(`${bank.root}/${source}`) !== current) return;
    const info = identify(document.getText(), source);
    if (!info) { this.prepared.clear(); return; }
    const variants = availableVariants(info.type).filter(variant => !current || (variant !== current.variant && !current.sessions.has(variant)));
    if (!variants.length) return;
    await this.prepared.warm(this.preparationKey(bank, source, info.type), variants,
      (variant, signal) => this.startTinymist(bank, source, variant as Variant, { signal, background: true, canJump: () => false }),
      error => { if (!this.disposed) this.fallback.output.appendLine(`Préparation de Tinymist [${source}] : ${error}`); });
  }

  private report = (error: unknown): void => {
    if (!errorStatus.has(error)) {
      this.fallback.output.appendLine(String(error));
      errorStatus.set('preview', 'Erreur aperçu', error);
    }
  };
  private restart(): void { for (const preview of this.entries.values()) if (preview.dark === undefined) void preview.restart().catch(this.report); }

  async sync(editor = this.editor): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file') return;
    for (const preview of this.entries.values()) {
      const session = preview.sessions.get(preview.variant);
      if (preview.jumps && session && preview.panel.visible && editor.document.uri.fsPath.startsWith(preview.bank.root + path.sep)) await tinymist.forward(session, editor);
    }
  }

  async open(bank: Bank, source: string, variant: Variant): Promise<Preview> {
    const key = `${bank.root}/${source}`;
    const existing = this.entries.get(key);
    if (existing) { existing.panel.reveal(undefined, true); await existing.select(variant); return existing; }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, source)));
    const documentType = identify(document.getText(), source)?.type;
    const labels = variantLabels(documentType);
    const variants = availableVariants(documentType);
    if (!variants.includes(variant)) variant = variants[0];
    const panel = vscode.window.createWebviewPanel('mpiExercices.pdf', pdfFilename(source, variant, documentType), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'viewer'), vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')]
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdf.svg');
    const sessions = new Map<Variant, tinymist.Session>();
    const pdfs = new Map<Variant, string>();
    const errors = new Map<Variant, string>();
    const channel = randomBytes(18).toString('hex');
    const post = (message: object) => panel.webview.postMessage({ ...message, channel });
    let disposed = false;
    let ready = false;
    let queue = Promise.resolve();
    const enqueue = (action: () => Promise<void>) => { const next = queue.catch(() => undefined).then(action); queue = next; return next; };
    const isDark = () => {
      const theme = vscode.workspace.getConfiguration('mpiExercices', bank.scope).get<string>('previewTheme', 'auto');
      return preview.dark ?? (theme === 'dark' || (theme === 'auto' && [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind)));
    };
    const describe = async () => {
      panel.title = pdfFilename(source, preview.variant, documentType);
      const hasCode = (await associatedCodes({ bank, source })).length > 0;
      if (ready && !disposed) await post({ type: 'compileError', message: errors.get(preview.variant) ?? '' });
      if (ready && !disposed) await post({ type: 'show', variant: preview.variant, labels, hasCode, native: preview.native, jumps: preview.jumps, dark: isDark(), pdf: pdfs.get(preview.variant), sessions: Object.fromEntries([...sessions].map(([v, s]) => [v, s.url])), tokens: Object.fromEntries([...sessions].map(([v, s]) => [v, s.id])) });
    };
    const select = async (value: Variant) => {
      if (disposed || !variants.includes(value)) return;
      if (!preview.native && !pdfs.has(value)) {
        if (vscode.workspace.textDocuments.some(doc => doc.isDirty && doc.uri.fsPath.startsWith(bank.root + path.sep))) throw new Error('Sans Tinymist, enregistrez les fichiers de la banque pour actualiser l’aperçu PDF.');
        await post({ type: 'status', message: 'Compilation du PDF…' });
        const target = pdfTarget(source, value, documentType === 'copie', documentType);
        await this.fallback.run(bank, ['c', source]);
        pdfs.set(value, (await readFile(path.join(bank.root, target))).toString('base64'));
      }
      if (preview.native && !sessions.has(value)) {
        await post({ type: 'status', message: 'Démarrage de Tinymist…' });
        const options: tinymist.SessionOptions = { dark: isDark(), canJump: () => preview.jumps && preview.variant === value && panel.visible,
          onError: message => { errors.set(value, message); if (ready && !disposed && preview.variant === value) void post({ type: 'compileError', message }); }
        };
        let session = preview.dark === undefined ? await this.prepared.take(this.preparationKey(bank, source, documentType), value) : undefined;
        if (session && !session.alive) { session.dispose(); session = undefined; }
        session ??= await this.startTinymist(bank, source, value, options);
        session.attach(options);
        if (disposed) { await tinymist.stop(session); return; }
        sessions.set(value, session);
      }
      preview.variant = value;
      errorStatus.clear('preview');
      await describe();
    };
    const preview: Preview = {
      bank, source, documentType, variant, panel, sessions, native: this.hasTinymist(), jumps: this.hasTinymist(),
      toggleJumps: async () => { preview.jumps = preview.native && !preview.jumps; await describe(); },
      toggleTheme: async () => { preview.dark = !isDark(); if (preview.native) await preview.restart(); else await describe(); },
      select: value => enqueue(() => select(value)),
      restart: () => enqueue(async () => {
        if (disposed) return;
        this.prepared.clear(this.preparationKey(bank, source, documentType));
        await post({ type: 'reset' });
        pdfs.clear();
        errors.clear();
        const previous = [...sessions.values()]; sessions.clear();
        await Promise.all(previous.map(session => tinymist.stop(session).catch(() => undefined)));
        await select(preview.variant);
      })
    };
    this.entries.set(key, preview);
    const listener = panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'ready') { ready = true; await describe(); }
        else if (variants.includes(message?.type)) await preview.select(message.type);
        else if (message?.type === 'jumps') await preview.toggleJumps();
        else if (message?.type === 'theme') await preview.toggleTheme();
        else if (message?.type === 'fullscreen') await vscode.commands.executeCommand('workbench.action.toggleZenMode');
        else if (message?.type === 'restart') await preview.restart();
        else if (message?.type === 'sync') await this.sync();
        else if (message?.type === 'save') await this.exportPdf(preview, preview.variant);
        else if (message?.type === 'code') await openAssociatedCode({ bank, source });
      } catch (error) { if (!disposed) { this.report(error); await post({ type: 'status', message: String(error) }); } }
    });
    panel.onDidDispose(() => {
      this.prepared.clear(this.preparationKey(bank, source, documentType));
      disposed = true; listener.dispose(); this.entries.delete(key);
      for (const session of sessions.values()) void tinymist.stop(session).catch(() => undefined);
      sessions.clear();
    });
    const webview = panel.webview;
    const uri = (file: string) => escape(webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'viewer', file)).toString());
    const nonce = randomBytes(18).toString('base64');
    // Frame URLs originate only from the extension, never from source contents.
    webview.html = pdfViewerHtml({ nonce, channel, cspSource: webview.cspSource,
      pdfjs: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')).toString(),
      uri, variants, labels, variant, scrollbarStyle });
    try {
      await preview.select(variant);
      void this.prepare(bank, source).catch(error => { if (!this.disposed) this.fallback.output.appendLine(String(error)); });
      return preview;
    }
    catch (error) { panel.dispose(); throw error; }
  }

  dispose(): void { this.disposed = true; this.prepared.dispose(); errorStatus.clear('preview'); this.fallback.dispose(); clearTimeout(this.timer); for (const sub of this.subscriptions) sub.dispose(); for (const preview of [...this.entries.values()]) preview.panel.dispose(); }
}
