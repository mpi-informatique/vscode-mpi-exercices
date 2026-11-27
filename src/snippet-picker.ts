import * as vscode from 'vscode';

interface Snippet { prefix: string; body: string | string[]; description?: string }
interface Choice extends vscode.QuickPickItem { body: string }
interface SavedSelection { uri: string; range: vscode.Range; text: string }

function escapeSnippetText(text: string): string {
  return text.replace(/[\\$}]/g, '\\$&');
}

/** Load the choices once and open a local menu instead of waiting for completion providers. */
export function registerSnippetPicker(snippets: Record<string, Snippet>): vscode.Disposable {
  const choices: Choice[] = Object.entries(snippets).map(([name, snippet]) => ({
    label: snippet.prefix,
    description: name,
    detail: snippet.description,
    body: Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body
  })).sort((a, b) => a.label.localeCompare(b.label));
  let pending: vscode.CancellationTokenSource | undefined;
  let lastSelection: SavedSelection | undefined;

  function captureSelection(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== 'typst' || editor.selections.length !== 1 || editor.selection.isEmpty) {
      lastSelection = undefined;
      return;
    }
    const range = new vscode.Range(editor.selection.start, editor.selection.end);
    lastSelection = { uri: editor.document.uri.toString(), range, text: editor.document.getText(range) };
  }

  captureSelection(vscode.window.activeTextEditor);
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => captureSelection(event.textEditor));
  const editorListener = vscode.window.onDidChangeActiveTextEditor(editor => captureSelection(editor));

  async function pick(editor: vscode.TextEditor, range: vscode.Range, version: number, selectedText: string, token: vscode.CancellationToken): Promise<void> {
    void vscode.commands.executeCommand('hideSuggestWidget');
    const choice = await vscode.window.showQuickPick(choices, {
      title: 'Snippets MPI', placeHolder: 'Choisir un snippet — saisir son nom ou son préfixe',
      matchOnDescription: true, matchOnDetail: true
    }, token);
    if (!choice || token.isCancellationRequested || editor.document.isClosed || editor.document.version !== version || editor.document.getText(range) !== '²') return;
    // Le ² est un préfixe à remplacer ; si un texte sélectionné a été remplacé par ², on l'injecte dans TM_SELECTED_TEXT.
    const escaped = escapeSnippetText(selectedText);
    const body = choice.body.replace(/\$\{TM_SELECTED_TEXT\}|\$TM_SELECTED_TEXT\b/g, () => escaped);
    await editor.insertSnippet(new vscode.SnippetString(body), range);
  }

  const listener = vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (pending || !editor || editor.document !== event.document || event.document.languageId !== 'typst' || event.reason !== undefined || editor.selections.length !== 1 || event.contentChanges.length !== 1) return;
    const change = event.contentChanges[0];
    if (change.text !== '²') return;
    let selectedText = '';
    if (change.rangeLength > 0) {
      if (!lastSelection || lastSelection.uri !== event.document.uri.toString() || !change.range.isEqual(lastSelection.range)) return;
      selectedText = lastSelection.text;
    }
    lastSelection = undefined;
    const range = new vscode.Range(change.range.start, change.range.start.translate(0, 1));
    const cancellation = new vscode.CancellationTokenSource();
    pending = cancellation;
    void pick(editor, range, event.document.version, selectedText, cancellation.token)
      .catch(error => console.error('Snippets MPI', error))
      .finally(() => { if (pending === cancellation) pending = undefined; cancellation.dispose(); });
  });
  return new vscode.Disposable(() => {
    listener.dispose();
    selectionListener.dispose();
    editorListener.dispose();
    pending?.cancel();
  });
}
