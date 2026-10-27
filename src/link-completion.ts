import * as vscode from 'vscode';
import { sourceId } from './core';
import { typeLabel } from './documents';
import { Source } from './browser';
import { mask } from './typst';

/** Complete only the first string argument of a link to a public resource. */
export class LinkCompletion implements vscode.CompletionItemProvider {
  constructor(private sources: () => Promise<Source[]>) {}

  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.slice(0, offset);
    const match = /\blien(?:-exercice)?\s*\(\s*"([^"\\\n]*)$/.exec(before);
    if (!match || !mask(before).slice(match.index).startsWith('lien')) return [];
    const start = offset - match[1].length;
    const end = offset + /^[^"\\\n]*/.exec(text.slice(offset))![0].length;
    const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
    const seen = new Set<string>();
    return (await this.sources()).flatMap(source => {
      const id = sourceId(source.source);
      if (seen.has(id)) return [];
      seen.add(id);
      const title = source.ex?.titre ?? source.metadata?.[0]?.titre ?? id;
      const item = new vscode.CompletionItem({ label: id, description: title }, vscode.CompletionItemKind.Reference);
      item.detail = `${typeLabel(source.documentType ?? 'exercice')} — ${title}`;
      item.filterText = `${id} ${title}`;
      item.insertText = id;
      item.range = range;
      return [item];
    });
  }
}
