import * as vscode from 'vscode';
import * as path from 'node:path';
import { stat, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Previews } from '../../src/preview';
import { Runner } from '../../src/runner';
import { errorStatus } from '../../src/errors';
import { forward } from '../../src/tinymist';
import { fixture, until } from './helpers';
export async function run(api: any, extension: vscode.Extension<any>): Promise<void> {
  const { temporary, previewBank, relative, generated, file } = await fixture();
  const previews = new Previews({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, async () => undefined);
  const runner = new Runner();
  const sockets: WebSocket[] = [];
  try {
    await writeFile(path.join(path.dirname(file), 'corrige.ml'), 'let réponse = 42\n');
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.One });
    const before = Date.now();
    const opening = previews.open(previewBank, relative, 'enonce');
    await until(() => previews.entries.has(`${previewBank.root}/${relative}`), 'Création du panneau d’aperçu');
    const preview = previews.entries.get(`${previewBank.root}/${relative}`)!;
    let frames = 0;
    const nativeProgress: { current: number; total: number }[] = [];
    const listener = preview.panel.webview.onDidReceiveMessage(message => { if (message.type === 'frameReady') frames++; if (message.type === 'pageProgress' && message.total) nativeProgress.push(message); });
    await opening;
    assert.equal(preview.panel.title, 'test-creation.pdf');
    console.log('Démarrage aperçu (ms)', Date.now() - before);
    await until(() => frames > 0, "L'iframe Tinymist ne se charge pas");
    await until(() => nativeProgress.some(progress => progress.current === 1 && progress.total >= 1), 'Pagination du rendu Tinymist');
    const codeEdit = new vscode.WorkspaceEdit();
    codeEdit.insert(editor.document.uri, editor.document.positionAt(editor.document.getText().length), '\n#let source-code = read("corrige.ml")\n');
    await vscode.workspace.applyEdit(codeEdit);
    const post = preview.panel.webview.postMessage.bind(preview.panel.webview);
    let hasCode: boolean | undefined;
    preview.panel.webview.postMessage = message => { if (message.type === 'show') hasCode = message.hasCode; return post(message); };
    await preview.select('enonce');
    assert.equal(hasCode, true, 'L’aperçu reçoit la disponibilité du code pour afficher son bouton');
    assert.match(preview.panel.webview.html, /id="code"/);
    preview.panel.webview.postMessage = post;
    const enonce = preview.sessions.get('enonce')!;
    let documentOutline: any;
    enonce.connection.onNotification('tinymist/documentOutline', outline => { documentOutline = outline; });
    const socket = new WebSocket(`ws://127.0.0.1:${enonce.port}`);
    sockets.push(socket);
    const messages: Buffer[] = [];
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', event => { const data = typeof event.data === 'string' ? Buffer.from(event.data) : Buffer.from(event.data as ArrayBuffer); messages.push(data); });
    await until(() => socket.readyState === WebSocket.OPEN, 'Connexion au rendu Tinymist');
    socket.send('current');
    await until(() => messages.some(data => /^(new|diff-v1),/.test(data.toString())), 'Rendu vectoriel initial');
    const dark = [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind);
    assert.ok(messages.some(data => data.toString().includes(`"rest":"${dark ? 'always' : 'never'}"`)), 'Thème de rendu correct');
    const count = messages.length;
    const edit = new vscode.WorkspaceEdit();
    const line = generated.split('\n').findIndex(text => text.includes('Un texte unique'));
    edit.insert(editor.document.uri, new vscode.Position(line, 7), 'MODIFICATION ');
    await vscode.workspace.applyEdit(edit);
    await until(() => messages.slice(count).some(data => /^(new|diff-v1),/.test(data.toString())), 'Mise à jour sans enregistrer');
    const startJump = messages.length;
    editor.selection = new vscode.Selection(line, 20, line, 20);
    await forward(enonce, editor);
    await until(() => messages.slice(startJump).some(data => data.toString().startsWith('jump,')), 'Saut source vers aperçu');
    await until(() => !!documentOutline?.items?.length, 'Plan exact produit par Tinymist');
    assert.ok(!JSON.stringify(documentOutline).includes('Repère du corrigé'), 'Énoncé sans solution');
    const headingLine = generated.split('\n').findIndex(text => text.includes('Repère du test'));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await enonce.connection.sendRequest('workspace/executeCommand', { command: 'tinymist.scrollPreview', arguments: [enonce.id, { event: 'sourceScrollBySpan', span: documentOutline.items[0].span }] });
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file && vscode.window.activeTextEditor.selection.start.line === headingLine, 'Saut inverse vers la position source exacte');
    await preview.toggleJumps();
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const noJump = messages.length;
    await previews.sync(editor);
    await enonce.connection.sendRequest('workspace/executeCommand', { command: 'tinymist.scrollPreview', arguments: [enonce.id, { event: 'sourceScrollBySpan', span: documentOutline.items[0].span }] });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(editor.selection.start.line, 0, 'Saut inverse désactivé');
    assert.ok(!messages.slice(noJump).some(data => data.toString().startsWith('jump,')), 'Saut direct désactivé');
    await preview.toggleJumps();
    await preview.select('corrige');
    assert.equal(preview.panel.title, 'test-creation-cor.pdf');
    let correctedOutline: any;
    preview.sessions.get('corrige')!.connection.onNotification('tinymist/documentOutline', outline => { correctedOutline = outline; });
    const secondEdit = new vscode.WorkspaceEdit();
    secondEdit.insert(editor.document.uri, new vscode.Position(line, 7), 'SUITE ');
    await vscode.workspace.applyEdit(secondEdit);
    await until(() => JSON.stringify(correctedOutline)?.includes('Repère du corrigé') ?? false, 'Le corrigé affiche réellement les solutions');
    assert.equal(preview.sessions.size, 2);
    const switchStart = Date.now();
    await preview.select('enonce');
    assert.equal(preview.sessions.get('enonce'), enonce, 'La bascule réutilise le compilateur');
    console.log('Bascule chaude (ms)', Date.now() - switchStart);
    const compilationMessages: string[] = [];
    const originalPost = preview.panel.webview.postMessage.bind(preview.panel.webview);
    preview.panel.webview.postMessage = message => { if (message.type === 'compileError') compilationMessages.push(message.message); return originalPost(message); };
    const validText = editor.document.getText();
    const invalid = new vscode.WorkspaceEdit();
    invalid.insert(editor.document.uri, editor.document.positionAt(validText.length), '\n#let broken = (');
    await vscode.workspace.applyEdit(invalid);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(!compilationMessages.some(Boolean), 'Pas de bandeau pendant la saisie');
    await until(() => compilationMessages.some(Boolean), 'Erreur de compilation transmise au bandeau PDF');
    const repair = new vscode.WorkspaceEdit();
    repair.delete(editor.document.uri, new vscode.Range(editor.document.positionAt(validText.length), editor.document.positionAt(editor.document.getText().length)));
    await vscode.workspace.applyEdit(repair);
    await until(() => compilationMessages.at(-1) === '', 'Bandeau effacé après correction');
    preview.panel.webview.postMessage = originalPost;
    await assert.rejects(stat(path.join(temporary, 'build')), 'Aucun export PDF pour afficher ou basculer');
    await editor.document.save();
    await runner.run(previewBank, ['c', relative]);
    let journalOpened = 0;
    const originalShow = runner.output.show.bind(runner.output);
    runner.output.show = () => { journalOpened++; };
    await assert.rejects(runner.run(previewBank, ['missing-test-target']));
    assert.equal(journalOpened, 0, "L'erreur n'ouvre pas le journal automatiquement");
    await vscode.commands.executeCommand('mpiExercices.showErrorDetails');
    assert.equal(journalOpened, 0, "Le clic ouvre Problems, jamais le journal");
    errorStatus.clear(`build:${previewBank.root}:missing-test-target`);
    runner.output.show = originalShow;
    for (const variant of ['enonce', 'corrige']) assert.ok((await stat(path.join(temporary, 'build/exercices/banque/graphes/test-creation', `test-creation${variant === 'corrige' ? '-cor' : ''}.pdf`))).size > 1000);
    const fallback = new Previews({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, async () => undefined, () => false);
    try {
      const pdfOpening = fallback.open(previewBank, relative, 'enonce');
      await until(() => fallback.entries.has(`${previewBank.root}/${relative}`), 'Création du panneau PDF');
      const pdfPreview = fallback.entries.get(`${previewBank.root}/${relative}`)!;
      let pdfReady = 0;
      let pdfProgress: { current: number; total: number } | undefined;
      const pdfListener = pdfPreview.panel.webview.onDidReceiveMessage(message => { if (message.type === 'pdfError') console.error(message.error); if (message.type === 'pdfReady') pdfReady++; if (message.type === 'pageProgress' && message.total) pdfProgress = message; });
      await pdfOpening;
      assert.equal(pdfPreview.jumps, false); assert.equal(pdfPreview.native, false);
      pdfPreview.panel.reveal(vscode.ViewColumn.Beside);
      await pdfPreview.restart();
      await until(() => pdfReady > 0, 'PDF affiché sans Tinymist');
      await until(() => pdfProgress?.current === 1 && pdfProgress.total >= 1, 'Pagination du lecteur PDF de secours');
      await pdfPreview.toggleJumps(); assert.equal(pdfPreview.jumps, false);
      const firstRender = pdfReady;
      await pdfPreview.select('corrige');
      await until(() => pdfReady > firstRender, 'Corrigé PDF affiché sans Tinymist');
      pdfListener.dispose();
    } finally { fallback.dispose(); }
    await preview.toggleTheme();
    assert.equal(preview.dark, !dark, 'Thème inversé localement');
    const themed = preview.sessions.get('enonce')!;
    assert.notEqual(themed, enonce);
    const themedSocket = new WebSocket(`ws://127.0.0.1:${themed.port}`); sockets.push(themedSocket);
    const themedMessages: string[] = []; themedSocket.binaryType = 'arraybuffer';
    themedSocket.addEventListener('message', event => themedMessages.push(typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString()));
    await until(() => themedSocket.readyState === WebSocket.OPEN, 'Connexion au rendu avec thème inversé'); themedSocket.send('current');
    await until(() => themedMessages.some(data => data.includes(`"rest":"${dark ? 'never' : 'always'}"`)), 'Le moteur utilise le thème inversé');
    listener.dispose();
    if (process.env.PREVIEW_REVIEW) { console.log('Aperçu temporaire', enonce.url); await new Promise(resolve => setTimeout(resolve, 55_000)); }
    preview.panel.dispose();
    assert.equal(previews.entries.size, 0);
    const courseSource = 'support.typ';
    const courseUri = vscode.Uri.file(path.join(temporary, courseSource));
    await writeFile(courseUri.fsPath, `#import "/load.typ": cours-et-presentation, article-only, slides-only, solution
#show: cours-et-presentation.with(titre: "Support fictif")
= Partie commune
== Contenu commun
Un contenu partagé entre les deux formats.
#article-only[== Repère du cours
Une explication réservée au cours.]
#slides-only[== Repère de la présentation
Une indication réservée à la présentation.]
#solution[== Réponse réservée
Une solution de l'exercice.]
`);
    const courseEditor = await vscode.window.showTextDocument(courseUri, { viewColumn: vscode.ViewColumn.One });
    const coursePreview = await previews.open(previewBank, courseSource, 'enonce');
    const courseProgress: { current: number; total: number }[] = [];
    const courseListener = coursePreview.panel.webview.onDidReceiveMessage(message => { if (message.type === 'pageProgress' && message.total) courseProgress.push(message); });
    assert.equal(coursePreview.documentType, 'cours-presentation');
    assert.match(coursePreview.panel.webview.html, />Cours<\/button>/);
    assert.match(coursePreview.panel.webview.html, />Présentation<\/button>/);
    const courseSession = coursePreview.sessions.get('enonce');
    for (const [variant, marker, excluded, format] of [
      ['enonce', 'Repère du cours', 'Repère de la présentation', 'cours'],
      ['corrige', 'Repère du cours', 'Repère de la présentation', 'cours'],
      ['presentation', 'Repère de la présentation', 'Repère du cours', 'presentation']
    ] as const) {
      await coursePreview.select(variant);
      assert.equal(coursePreview.panel.title, `${format}-support${variant === 'corrige' ? '-cor' : ''}.pdf`);
      let renderedOutline: unknown;
      coursePreview.sessions.get(variant)!.connection.onNotification('tinymist/documentOutline', outline => { renderedOutline = outline; });
      const edit = new vscode.WorkspaceEdit();
      edit.insert(courseUri, courseEditor.document.positionAt(courseEditor.document.getText().length), '\n');
      await vscode.workspace.applyEdit(edit);
      await until(() => JSON.stringify(renderedOutline)?.includes(marker) ?? false, `${format} : contenu propre au format affiché`);
      assert.ok(!JSON.stringify(renderedOutline).includes(excluded), `${format} : contenu de l'autre format absent`);
      assert.equal(JSON.stringify(renderedOutline).includes('Réponse réservée'), variant !== 'enonce', 'La solution est masquée dans le cours normal');
      if (variant === 'presentation') {
        await until(() => courseProgress.some(progress => progress.total > 1), 'Nombre total de diapositives affiché');
      }
    }
    await coursePreview.select('enonce');
    assert.equal(coursePreview.sessions.get('enonce'), courseSession, 'La bascule cours/présentation réutilise la session');
    await courseEditor.document.save();
    courseListener.dispose();
    coursePreview.panel.dispose();
    const courseFallback = new Previews({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, async () => undefined, () => false);
    try {
      const pdf = await courseFallback.open(previewBank, courseSource, 'enonce');
      assert.equal(pdf.panel.title, 'cours-support.pdf');
      await pdf.select('corrige');
      assert.equal(pdf.panel.title, 'cours-support-cor.pdf');
      await pdf.select('presentation');
      assert.equal(pdf.panel.title, 'presentation-support.pdf');
      for (const filename of ['cours-support.pdf', 'cours-support-cor.pdf', 'presentation-support.pdf']) assert.ok((await stat(path.join(temporary, 'build/support', filename))).size > 1000);
    } finally { courseFallback.dispose(); }
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0, { uri: previewBank.scope, name: previewBank.name });
    await until(async () => {
      try { return (await api.revealSheet(courseSource)).bank.root === temporary; }
      catch { return false; }
    }, 'Le support cours/présentation est découvert');
    for (const [command, filename] of [['enonce', 'cours-support.pdf'], ['corrige', 'cours-support-cor.pdf']]) {
      await vscode.commands.executeCommand(`mpiExercices.${command}`, courseUri);
      assert.equal(api.previewCount(), 1, 'Les commandes F5/F6 réutilisent le même panneau');
      assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === filename)), `La commande ${command} affiche ${filename}`);
    }
    await vscode.commands.executeCommand('mpiExercices.enonce', courseUri);
    const notes = vscode.Uri.file(path.join(temporary, 'notes.md'));
    await writeFile(notes.fsPath, 'Notes fictives du test.');
    await vscode.window.showTextDocument(notes, { viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('mpiExercices.currentCorrige');
    assert.equal(api.previewCount(), 1, 'Le bouton du panneau Fichier réutilise le même aperçu');
    assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'cours-support-cor.pdf')), 'Le bouton ouvre le corrigé du fichier du plan, même si un autre éditeur a le focus');
  } finally {
    for (const socket of sockets) socket.close();
    previews.dispose(); runner.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const index = vscode.workspace.workspaceFolders?.findIndex(folder => folder.uri.fsPath === temporary) ?? -1;
    if (index >= 0) vscode.workspace.updateWorkspaceFolders(index, 1);
    await rm(temporary, { recursive: true, force: true });
  }
  console.log('Aperçus et synchronisation vérifiés sur des documents fictifs.');
}
