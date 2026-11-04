import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, MessageConnection } from 'vscode-jsonrpc/node';
import { Variant, previewArguments } from './core';
import { Bank } from './runner';
import { bridge } from './preview-bridge';
import { errorStatus } from './errors';
import { identify } from './documents';
import { copyInputs } from './copy-inputs';
import { environment } from './environment';

export interface SessionOptions { signal?: AbortSignal; dark?: boolean; background?: boolean; canJump?: () => boolean; onError?: (message: string) => void }
export interface Session { id: string; url: string; port: number; connection: MessageConnection; readonly alive: boolean; exportPdf(): Promise<Uint8Array>; attach(options: SessionOptions): void; dispose(): void }

// Tinymist's shared LSP ignores per-preview root/inputs. An isolated LSP
// context reuses its installed engine without changing the user's settings.
export async function start(bank: Bank, source: string, variant: Variant, options: SessionOptions = {}): Promise<Session> {
  options.signal?.throwIfAborted();
  if (!vscode.workspace.isTrusted) throw new Error('Autorisez cet espace de travail pour ouvrir un aperçu.');
  const extension = vscode.extensions.getExtension('myriad-dreamin.tinymist');
  if (!extension) throw new Error('Installez Tinymist pour afficher les aperçus.');
  const binary = vscode.workspace.getConfiguration('tinymist', bank.scope).get<string | null>('serverPath') || path.join(extension.extensionPath, 'out', process.platform === 'win32' ? 'tinymist.exe' : 'tinymist');
  if (!existsSync(binary)) throw new Error('Moteur Tinymist introuvable. Vérifiez son installation ou tinymist.serverPath.');
  const id = `exercices-typst-${randomUUID()}`;
  const theme = vscode.workspace.getConfiguration('mpiExercices', bank.scope).get<string>('previewTheme', 'auto');
  const dark = options.dark ?? (theme === 'dark' || (theme === 'auto' && [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind)));
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, source)));
  const info = identify(document.getText(), source);
  const args = previewArguments(bank.root, source, variant, info?.direct, info?.type);
  // Les aperçus des copies utilisent les mêmes statistiques que les exports.
  if (info?.type === 'copie') args.splice(args.length - 1, 0, ...await copyInputs(document.uri.fsPath));
  const settings = { rootPath: bank.root, typstExtraArgs: args.slice(0, -1), exportPdf: 'never',
    preview: { refresh: 'onType', invertColors: JSON.stringify({ rest: dark ? 'always' : 'never', image: 'never' }) }, customizedShowDocument: true };
  const env = await environment(bank);
  options.signal?.throwIfAborted();
  const output = vscode.window.createOutputChannel(`Exercices MPI — ${path.basename(source)} (${variant})`);
  const child = spawn(binary, ['lsp'], { cwd: bank.root, stdio: 'pipe', windowsHide: true, env });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  const subscriptions: vscode.Disposable[] = [];
  const diagnostics = vscode.languages.createDiagnosticCollection(id);
  const errors = new Map<string, string[]>();
  const diagnosticValues = new Map<string, vscode.Diagnostic[]>();
  let alive = true;
  let quietUntil = 0;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  const publishErrors = () => {
    clearTimeout(errorTimer);
    if (stopped || options.background) return;
    if (Date.now() < quietUntil) { errorTimer = setTimeout(publishErrors, quietUntil - Date.now()); return; }
    const message = [...errors.values()].flat().join('\n');
    if (message) errorStatus.set(id, 'Erreur Typst', message);
    else errorStatus.clear(id);
    options.onError?.(message);
  };
  let stopped = false;
  let page: Awaited<ReturnType<typeof bridge>> | undefined;
  const dispose = () => {
    page?.dispose(); page = undefined;
    if (stopped) return; stopped = true; alive = false;
    clearTimeout(errorTimer);
    options.signal?.removeEventListener('abort', dispose);
    for (const sub of subscriptions) sub.dispose();
    errorStatus.clear(id); connection.dispose(); child.kill(); diagnostics.dispose(); output.dispose();
  };
  options.signal?.addEventListener('abort', dispose, { once: true });
  child.stderr.on('data', data => { if (!stopped) output.append(data.toString()); });
  child.on('error', error => { alive = false; if (!stopped) output.appendLine(error.message); connection.dispose(); });
  child.once('exit', () => { alive = false; if (!stopped) { connection.dispose(); if (!options.background) errorStatus.set(id, 'Erreur aperçu Typst', 'Le moteur d’aperçu s’est arrêté. Utilisez ↻ pour le redémarrer.'); } });
  connection.onRequest('workspace/configuration', (request: { items: unknown[] }) => request.items.map(() => settings));
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('client/unregisterCapability', () => null);
  connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; message: string; severity?: number }[] }) => {
    if (stopped) return;
    errors.set(params.uri, params.diagnostics.filter(d => (d.severity ?? 1) === 1).map(d => `${path.relative(bank.root, vscode.Uri.parse(params.uri).fsPath)}:${d.range.start.line + 1} : ${d.message}`));
    publishErrors();
    const values = params.diagnostics.map(d => new vscode.Diagnostic(new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character), d.message, (d.severity ?? 1) - 1));
    diagnosticValues.set(params.uri, values);
    if (!options.background) diagnostics.set(vscode.Uri.parse(params.uri), values);
  });
  const showSource = async (jump: { filepath: string; start: [number, number] | null; end: [number, number] | null }) => {
    if (options.background || options.canJump?.() === false || !jump.start || !jump.end || !path.resolve(jump.filepath).startsWith(bank.root + path.sep)) return;
    try {
      const uri = vscode.Uri.file(jump.filepath);
      const column = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString())?.viewColumn ?? vscode.ViewColumn.One;
      const editor = await vscode.window.showTextDocument(uri, { viewColumn: column });
      editor.selection = new vscode.Selection(...jump.start, ...jump.end);
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) { output.appendLine(String(error)); }
  };
  connection.onNotification('tinymist/preview/scrollSource', showSource);
  connection.onRequest('window/showDocument', async (request: { uri: string; selection?: { start: { line: number; character: number }; end: { line: number; character: number } } }) => {
    const uri = vscode.Uri.parse(request.uri);
    if (options.background || options.canJump?.() === false || uri.scheme !== 'file' || !uri.fsPath.startsWith(bank.root + path.sep)) return { success: false };
    const { start, end } = request.selection ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    await showSource({ filepath: uri.fsPath, start: [start.line, start.character], end: [end.line, end.character] });
    return { success: true };
  });
  connection.listen();
  try {
    await connection.sendRequest('initialize', { processId: process.pid, rootUri: vscode.Uri.file(bank.root).toString(), workspaceFolders: [{ uri: vscode.Uri.file(bank.root).toString(), name: bank.name }],
      capabilities: { general: { positionEncodings: ['utf-16'] }, window: { showDocument: { support: true } }, textDocument: { publishDiagnostics: {} }, workspace: { configuration: true } }, initializationOptions: settings });
    await connection.sendNotification('initialized', {});
    const belongs = (doc: vscode.TextDocument) => doc.uri.scheme === 'file' && doc.uri.fsPath.startsWith(bank.root + path.sep) && doc.uri.path.endsWith('.typ');
    const opened = new Set<string>();
    const notify = (method: string, params: object) => { if (!stopped) void connection.sendNotification(method, params).catch(error => { if (!stopped) output.appendLine(String(error)); }); };
    const open = (doc: vscode.TextDocument) => {
      if (!belongs(doc) || opened.has(doc.uri.toString())) return;
      opened.add(doc.uri.toString());
      notify('textDocument/didOpen', { textDocument: { uri: doc.uri.toString(), languageId: 'typst', version: doc.version, text: doc.getText() } });
    };
    // The catalogue opens clean documents for metadata. Mirroring all of them
    // makes each isolated LSP compile the entire bank before showing its preview.
    // Disk contents remain available to imports; only unsaved buffers need overlays.
    open(document);
    for (const candidate of vscode.workspace.textDocuments) if (candidate.isDirty) open(candidate);
    subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => { if (doc.isDirty || doc.uri.toString() === document.uri.toString()) open(doc); }),
      vscode.workspace.onDidChangeTextDocument(event => { if (belongs(event.document) && event.contentChanges.length) {
        quietUntil = Date.now() + 2000;
        errorStatus.clear(id); options.onError?.('');
        publishErrors();
        open(event.document); notify('textDocument/didChange', { textDocument: { uri: event.document.uri.toString(), version: event.document.version }, contentChanges: [{ text: event.document.getText() }] });
      } }),
      vscode.workspace.onDidCloseTextDocument(doc => { if (opened.delete(doc.uri.toString())) notify('textDocument/didClose', { textDocument: { uri: doc.uri.toString() } }); }));
    const result = await connection.sendRequest<{ staticServerPort: number }>('workspace/executeCommand', {
      command: 'tinymist.doStartPreview', arguments: [['--task-id', id, '--data-plane-host', '127.0.0.1:0', '--invert-colors', settings.preview.invertColors, args.at(-1)!]]
    });
    options.signal?.throwIfAborted();
    const port = result?.staticServerPort;
    if (!Number.isInteger(port) || port! < 1 || port! > 65535) throw new Error("Tinymist n'a pas démarré l'aperçu.");
    page = await bridge(port, id);
    options.signal?.throwIfAborted();
    const uri = await vscode.env.asExternalUri(vscode.Uri.parse(page.url));
    options.signal?.throwIfAborted();
    return { id, port, url: uri.toString(), connection, get alive() { return alive; }, dispose,
      async exportPdf() {
        // Export the session's entry (the wrapper for an exercise), with its inputs and unsaved buffers.
        const result = await connection.sendRequest<{ data?: string } | null>('workspace/executeCommand', {
          command: 'tinymist.exportPdf', arguments: [args.at(-1)!, {}, { write: false, open: false }]
        });
        if (!result?.data) throw new Error('Export PDF impossible. Vérifiez les erreurs de compilation de l’aperçu.');
        const data = Buffer.from(result.data, 'base64');
        if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('Tinymist n’a pas renvoyé de PDF valide.');
        return data;
      },
      attach(next) {
        options.signal?.removeEventListener('abort', dispose);
        options = next;
        for (const [uri, values] of diagnosticValues) diagnostics.set(vscode.Uri.parse(uri), values);
        publishErrors();
      }
    };
  } catch (error) { dispose(); throw error; }
}

export async function stop(session: Session): Promise<void> { session.dispose(); }

export async function forward(session: Session, editor: vscode.TextEditor): Promise<void> {
  await session.connection.sendRequest('workspace/executeCommand', { command: 'tinymist.scrollPreview', arguments: [session.id, {
    event: 'panelScrollTo', filepath: editor.document.uri.fsPath,
    line: editor.selection.active.line, character: editor.selection.active.character
  }] });
}
