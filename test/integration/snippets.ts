import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { until } from './helpers';

export async function run(): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ language: 'typst', content: '' });
  const editor = await vscode.window.showTextDocument(document);
  const configuration = vscode.workspace.getConfiguration('editor', document.uri);
  const previous = configuration.inspect('quickSuggestions')?.globalValue;
  try {
    // Le menu doit s'ouvrir avec !, même sans les suggestions automatiques ordinaires.
    await configuration.update('quickSuggestions', false, vscode.ConfigurationTarget.Global);
    for (const [prefix, functionName] of [['solution', 'solution'], ['theorem', 'theorem'], ['slides-only', 'slides-only'], ['articles-only', 'article-only']]) {
      await vscode.commands.executeCommand('leaveSnippet');
      await vscode.commands.executeCommand('hideSuggestWidget');
      await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await vscode.commands.executeCommand('type', { text: '!' });
      await new Promise(resolve => setTimeout(resolve, 500));
      await vscode.commands.executeCommand('type', { text: prefix });
      // Laisser le menu filtrer le préfixe avant d'accepter sa sélection.
      await new Promise(resolve => setTimeout(resolve, 500));
      await until(async () => {
        await vscode.commands.executeCommand('acceptSelectedSuggestion');
        return document.getText().startsWith(`#${functionName}[`);
      }, `!${prefix} doit proposer et insérer le bloc sans conserver le !`);
      assert.equal(document.getText(), `#${functionName}[\n  \n]\n`);
      assert.equal(editor.selection.active.line, 1, 'Curseur dans le corps du snippet');
      await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
      assert.equal(editor.selection.active.line, 3, 'Tab rejoint la sortie du bloc');
    }
  } finally {
    await configuration.update('quickSuggestions', previous, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('leaveSnippet');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  console.log('Snippets : déclenchement !, remplacement, alias et tabulations vérifiés.');
}
