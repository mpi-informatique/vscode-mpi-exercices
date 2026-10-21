import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

type Snippet = { prefix: string; body: string | string[] };

export async function run(_api: unknown, extension: vscode.Extension<unknown>): Promise<void> {
  const snippets: Record<string, Snippet> = JSON.parse(await readFile(path.join(extension.extensionPath, 'snippets/typst.json'), 'utf8'));
  const prefixes = Object.values(snippets).map(snippet => snippet.prefix);
  assert.ok(prefixes.every(prefix => typeof prefix === 'string' && prefix.startsWith('!')), 'Un seul préfixe avec ! par snippet');
  assert.equal(new Set(prefixes).size, prefixes.length, 'Préfixes uniques');
  for (const functionName of ['theoreme', 'definition', 'proposition', 'lemme', 'corollaire', 'propriete', 'exemple-bloc', 'exercice', 'probleme', 'algorithme']) {
    assert.ok(prefixes.includes(`!${functionName}`), `Bloc ${functionName}`);
    assert.ok(prefixes.includes(`!${functionName}-titre`), `Variante titrée ${functionName}`);
  }
  const document = await vscode.workspace.openTextDocument({ language: 'typst', content: '' });
  const editor = await vscode.window.showTextDocument(document);
  try {
    for (const [prefix, functionName, title] of [['solution', 'solution'], ['theoreme', 'theoreme'], ['slides-only', 'slides-only'], ['article-only', 'article-only'], ['exercice-titre', 'exercice', 'Titre'], ['algorithme-titre', 'algorithme', 'Titre']]) {
      await vscode.commands.executeCommand('leaveSnippet');
      await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      const name = Object.keys(snippets).find(name => snippets[name].prefix === `!${prefix}`);
      assert.ok(name, `Snippet !${prefix} enregistré`);
      // Choisir le snippet par son nom évite les changements de focus du menu natif au démarrage de VS Code.
      await vscode.commands.executeCommand('editor.action.insertSnippet', { langId: 'typst', name });
      const opening = `#${functionName}${title ? '(titre: [Titre])' : ''}[`;
      assert.equal(document.getText(), `${opening}\n  \n]\n`);
      if (title) {
        assert.equal(document.getText(editor.selection), title, 'Premier champ : titre du bloc');
        await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
      }
      assert.equal(editor.selection.active.line, 1, 'Curseur dans le corps du snippet');
      await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
      assert.equal(editor.selection.active.line, 3, 'Tab rejoint la sortie du bloc');
    }
  } finally {
    await vscode.commands.executeCommand('leaveSnippet');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  console.log('Snippets : préfixes uniques, variantes titrées, insertion et tabulations vérifiés.');
}
