import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { Bank } from './runner';
import { Location, references } from './files';
import { mask } from './typst';
import { CodeClickContext, isCodeExtractFile, matchCodeLocation } from './code-jump';

export { CodeClickContext, isCodeExtractFile, matchCodeLocation };

const isCode = (file: string) => /\.(c|h|cc|cpp|hpp|ml|mli|py|sql|js|ts|java|rs|go|sh)$/i.test(file);

/** Chemins littéraux de code, avec les positions conservées pour les liens de l'éditeur. */
export function codeReferences(text: string, owner: string): { start: number; end: number; target: string }[] {
  return [...mask(text, false).matchAll(/"(?:\\.|[^"\\])*"/g)].flatMap(match => {
    let value: string;
    try { value = JSON.parse(match[0]); } catch { return []; }
    if (!isCode(value) || value.startsWith('@') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.includes('\\')) return [];
    const target = path.posix.normalize(value.startsWith('/') ? value.slice(1) : path.posix.join(path.posix.dirname(owner), value));
    return [{ start: match.index! + 1, end: match.index! + match[0].length - 1, target }];
  });
}

async function fileUri(bank: Bank, source: string): Promise<vscode.Uri | undefined> {
  const file = path.resolve(bank.root, source);
  if (!file.startsWith(bank.root + path.sep)) return;
  try {
    const actual = await realpath(file);
    if (actual.startsWith(bank.root + path.sep) && (await stat(actual)).isFile()) return vscode.Uri.file(file);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

/** Suivre les imports de la feuille et inclure les codes du dossier propre à chaque sujet. */
export async function associatedCodes(location: Location): Promise<string[]> {
  const visited = new Set<string>();
  const codes = new Set<string>();
  async function visit(source: string) {
    if (visited.has(source)) return;
    visited.add(source);
    const uri = await fileUri(location.bank, source);
    if (!uri) return;
    const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
    const text = document?.getText() ?? await readFile(uri.fsPath, 'utf8');
    const directory = path.posix.dirname(source);
    if (path.posix.basename(directory) === path.posix.basename(source, '.typ')) {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.dirname(uri.fsPath)))) {
        const target = path.posix.join(directory, name);
        if (type === vscode.FileType.File && isCode(name) && await fileUri(location.bank, target)) codes.add(target);
      }
    }
    for (const ref of codeReferences(text, source)) if (await fileUri(location.bank, ref.target)) codes.add(ref.target);
    for (const ref of references(text, source)) if (!ref.value.startsWith('@') && ref.target.endsWith('.typ')) await visit(ref.target);
  }
  await visit(location.source);
  return [...codes].sort((a, b) => a.localeCompare(b, 'fr'));
}

export async function openAssociatedCode(location: Location): Promise<void> {
  const files = await associatedCodes(location);
  if (!files.length) { void vscode.window.showInformationMessage('Aucun fichier de code associé à ce document.'); return; }
  const chosen = files.length === 1 ? files[0] : (await vscode.window.showQuickPick(files.map(source => ({ label: path.posix.basename(source), description: path.posix.dirname(source), source })), { title: 'Ouvrir un code associé', matchOnDescription: true }))?.source;
  if (!chosen) return;
  const uri = await fileUri(location.bank, chosen);
  if (uri) await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: false });
}

/** Ouvrir le fichier de code correspondant à un clic dans l'aperçu, à la ligne cliquée si trouvée. */
export async function openCodeAtClick(location: Location, context?: CodeClickContext): Promise<boolean> {
  const files = await associatedCodes(location);
  if (!files.length) return false;
  if (context?.line) {
    const loaded: { source: string; text: string }[] = [];
    for (const source of files) {
      const uri = await fileUri(location.bank, source);
      if (!uri) continue;
      const openDoc = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
      loaded.push({ source, text: openDoc?.getText() ?? await readFile(uri.fsPath, 'utf8') });
    }
    const matched = matchCodeLocation(loaded, context, path.posix.dirname(location.source));
    if (matched) {
      const uri = await fileUri(location.bank, matched.source);
      if (uri) {
        const column = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString())?.viewColumn ?? vscode.ViewColumn.One;
        const editor = await vscode.window.showTextDocument(uri, { viewColumn: column, preview: false });
        const line = Math.min(matched.line, Math.max(0, editor.document.lineCount - 1));
        editor.selection = new vscode.Selection(line, 0, line, 0);
        editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return true;
      }
    }
  }
  if (files.length === 1) {
    const uri = await fileUri(location.bank, files[0]);
    if (uri) {
      const column = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString())?.viewColumn ?? vscode.ViewColumn.One;
      await vscode.window.showTextDocument(uri, { viewColumn: column, preview: false });
      return true;
    }
    return false;
  }
  await openAssociatedCode(location);
  return true;
}

export class CodeLinks implements vscode.DocumentLinkProvider {
  constructor(private readonly banks: () => Bank[]) {}
  async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
    const bank = this.banks().filter(bank => document.uri.fsPath.startsWith(bank.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
    if (!bank) return [];
    const source = path.relative(bank.root, document.uri.fsPath).split(path.sep).join('/');
    const links: vscode.DocumentLink[] = [];
    for (const ref of codeReferences(document.getText(), source)) {
      if (token.isCancellationRequested) return [];
      const target = await fileUri(bank, ref.target);
      if (!target) continue;
      const link = new vscode.DocumentLink(new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end)), target);
      link.tooltip = 'Ouvrir le fichier de code';
      links.push(link);
    }
    return links;
  }
}
