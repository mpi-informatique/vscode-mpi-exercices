import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { until } from './helpers';

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
      const opening = `#${functionName}${title ? '([Titre])' : ''}[`;
      const compact = prefix === 'slides-only' && snippets[name].body.length === 2;
      assert.equal(document.getText(), compact ? `${opening}]\n` : `${opening}\n  \n]\n`);
      if (title) {
        assert.equal(document.getText(editor.selection), title, 'Premier champ : titre du bloc');
        await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
      }
      assert.equal(editor.selection.active.line, compact ? 0 : 1, 'Curseur dans le corps du snippet');
      await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
      assert.equal(editor.selection.active.line, compact ? 1 : 3, 'Tab rejoint la sortie du bloc');
    }
    await vscode.commands.executeCommand('leaveSnippet');
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'Contenu sélectionné.'));
    editor.selection = new vscode.Selection(document.positionAt(0), document.positionAt(document.getText().length));
    await vscode.commands.executeCommand('editor.action.insertSnippet', { langId: 'typst', name: 'MPI — Colonnes du cours' });
    assert.equal(document.getText(), '#colonnes-cours(\n  columns: (1fr, 1fr),\n  [\n    Contenu sélectionné.\n  ],\n  [\n    \n  ],\n)\n');
    assert.equal(document.getText(editor.selection), 'Contenu sélectionné.', 'La sélection remplit la première colonne');
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
    assert.equal(editor.selection.active.line, 6, 'Tab rejoint la seconde colonne');
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
    assert.equal(editor.selection.active.line, 9, 'Tab quitte les colonnes');

    await vscode.commands.executeCommand('leaveSnippet');
    await vscode.commands.executeCommand('hideSuggestWidget');
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const releaseCompletions: (() => void)[] = [];
    const generalProvider = vscode.languages.registerCompletionItemProvider({ language: 'typst' }, {
      provideCompletionItems() {
        return new Promise<vscode.CompletionItem[]>(resolve => releaseCompletions.push(() => resolve([])));
      }
    }, '!');
    try {
      await vscode.commands.executeCommand('default:type', { text: '!' });
      await until(async () => {
        await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        return document.getText().startsWith('#algorithme[');
      }, 'Le menu local doit insérer son premier snippet sans attendre le fournisseur déclenché par !');
      assert.equal(document.getText(), '#algorithme[\n  \n]\n', 'Le ! ne remplit pas le premier champ');
    } finally {
      for (const release of releaseCompletions) release();
      generalProvider.dispose();
    }

    await vscode.commands.executeCommand('leaveSnippet');
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('editor.action.insertSnippet', { langId: 'typst', name: 'MPI — Liste du cours' });
    assert.equal(document.getText(), '#liste-cours(\n  columns: 2,\n  [],\n  [],\n)\n');
    assert.equal(editor.selection.active.line, 2, 'Premier champ : premier élément de la liste');
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
    assert.equal(editor.selection.active.line, 3, 'Tab rejoint le second élément');
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
    assert.equal(editor.selection.active.line, 5, 'Tab quitte la liste');

    await vscode.commands.executeCommand('leaveSnippet');
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('default:type', { text: '!' });
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    assert.equal(document.getText(), '!', 'Annuler le menu conserve le texte saisi');

    await vscode.commands.executeCommand('leaveSnippet');
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('editor.action.insertSnippet', { langId: 'typst', name: 'MPI — Nouvelle diapositive' });
    assert.equal(document.getText(), '#nouvelle-diapositive()');

    await vscode.commands.executeCommand('leaveSnippet');
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), ''));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('editor.action.insertSnippet', { langId: 'typst', name: 'MPI — Lien vers une ressource' });
    assert.equal(document.getText(), '#lien("")[]');
    assert.equal(editor.selection.active.character, 7, 'Le premier champ attend un identifiant');
    const suggestions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active);
    const tp = suggestions.items.find(item => typeof item.label !== 'string' && item.label.label === 'tp-automates');
    assert.ok(tp, 'Le provider enregistré propose les TP publics');
    assert.match(tp.detail!, /^TP — /);
    assert.equal(tp.insertText, 'tp-automates');
    assert.ok(suggestions.items.some(item => typeof item.label !== 'string' && item.label.label === 'residuels-minimisation'), 'Les exercices sont aussi proposés');
    await vscode.commands.executeCommand('hideSuggestWidget');
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
    assert.equal(editor.selection.active.character, 10, 'Tab rejoint le texte du lien');
    await vscode.commands.executeCommand('leaveSnippet');

    for (const [content, cursor] of [['#lien("tp-ancien")[Texte]', 10], ['// #lien("")', 10], ['`#lien("")`', 8], ['#lien("tp-automates")[Texte]', 24]] as const) {
      await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content));
      const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(cursor));
      const resource = result.items.find(item => typeof item.label !== 'string' && item.label.label === 'tp-automates');
      if (content.includes('tp-ancien')) {
        assert.ok(resource, 'Complétion au milieu d’un identifiant');
        assert.ok(resource.range instanceof vscode.Range);
        assert.equal(document.getText(resource.range), 'tp-ancien', 'Remplacement de tout l’identifiant, suffixe compris');
      } else assert.equal(resource, undefined, 'Pas de suggestions de ressources dans les commentaires, le code brut ou le texte du lien');
    }
  } finally {
    await vscode.commands.executeCommand('leaveSnippet');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  console.log('Snippets : préfixes uniques, variantes titrées, insertion et tabulations vérifiés.');
}
