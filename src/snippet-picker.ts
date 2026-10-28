import * as vscode from 'vscode';

interface Snippet { prefix: string; body: string | string[]; description?: string }
interface Choice extends vscode.QuickPickItem { body: string }

/** Load the choices once and open a local menu instead of waiting for completion providers. */
export function registerSnippetPicker(snippets: Record<string, Snippet>): vscode.Disposable {
  const choices: Choice[] = Object.entries(snippets).map(([name, snippet]) => ({
    label: snippet.prefix,
    description: name,
    detail: snippet.description,
    body: Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body
  })).sort((a, b) => a.label.localeCompare(b.label));
  let pending: vscode.CancellationTokenSource | undefined;

  async function pick(editor: vscode.TextEditor, range: vscode.Range, version: number, token: vscode.CancellationToken): Promise<void> {
    void vscode.commands.executeCommand('hideSuggestWidget');
    const choice = await vscode.window.showQuickPick(choices, {
      title: 'Snippets MPI', placeHolder: 'Choisir un snippet — saisir son nom ou son préfixe',
      matchOnDescription: true, matchOnDetail: true
    }, token);
    if (!choice || token.isCancellationRequested || editor.document.isClosed || editor.document.version !== version || editor.document.getText(range) !== '!') return;
    // Le ! est un préfixe à remplacer, pas du texte sélectionné à insérer dans le premier champ.
    const body = choice.body.replace(/\$\{TM_SELECTED_TEXT\}|\$TM_SELECTED_TEXT\b/g, '');
    await editor.insertSnippet(new vscode.SnippetString(body), range);
  }

  const listener = vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (pending || !editor || editor.document !== event.document || event.document.languageId !== 'typst' || event.reason !== undefined || editor.selections.length !== 1 || event.contentChanges.length !== 1) return;
    const change = event.contentChanges[0];
    if (change.text !== '!' || change.rangeLength !== 0) return;
    const range = new vscode.Range(change.range.start, change.range.start.translate(0, 1));
    const cancellation = new vscode.CancellationTokenSource();
    pending = cancellation;
    void pick(editor, range, event.document.version, cancellation.token)
      .catch(error => console.error('Snippets MPI', error))
      .finally(() => { if (pending === cancellation) pending = undefined; cancellation.dispose(); });
  });
  return new vscode.Disposable(() => { listener.dispose(); pending?.cancel(); });
}
