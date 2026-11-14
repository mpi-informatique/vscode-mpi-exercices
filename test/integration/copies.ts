import * as vscode from 'vscode';
import * as path from 'node:path';
import { stat, mkdtemp, mkdir, writeFile, rm, cp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { Runner } from '../../src/runner';
import { contestFromTemplate, exerciseFromTemplate } from '../../src/typst';
import { documentTemplates } from '../../src/authoring';
import { identify } from '../../src/documents';
import { until } from './helpers';
import { copyInputs } from '../../src/copy-inputs';
import { Previews } from '../../src/preview';
import { environment, libraryRoot } from '../../src/environment';
export async function run(api: any, extension: vscode.Extension<any>): Promise<void> {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'mpi-corrections-test-')));
  const project = { root: temporary, name: 'Corrections fictives', scope: vscode.Uri.file(temporary) };
  const runner = new Runner();
  const previews = new Previews({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, async () => undefined);
  const previousMode = process.env.EXERCICES_MODE;
  // La banque fictive n'a pas de clone public voisin ; conserver les packages verrouillés attendus ici.
  process.env.EXERCICES_MODE = 'locked';
  try {
    const root = process.env.MPI_PRIVATE_ROOT!;
    for (const file of ['lib', 'templates', 'scripts', 'justfile', 'flake.nix', 'flake.lock', 'load.typ'])
      await cp(path.join(root, file), path.join(temporary, file), { recursive: true });
    const source = 'corrections/2026/ds/test/copies/exemple.typ';
    await mkdir(path.dirname(path.join(temporary, source)), { recursive: true });
    const template = await readFile(path.join(temporary, 'templates/copie.typ'), 'utf8');
    const document = contestFromTemplate(template, 'Copie fictive').replace('evaluations: (:),', 'evaluations: ("1.1": (reponse: "Réponse fictive.", raisonnement: "À corriger.", reussite: none),),');
    assert.equal(identify(document)?.type, 'copie');
    await writeFile(path.join(temporary, source), document);
    await writeFile(path.join(temporary, 'corrections/2026/liste-classe.csv'), 'MPI;Nom;Prénom\n');
    const env = await environment(project);
    assert.ok(env.TYPST_PACKAGE_PATH?.startsWith('/nix/store/'), 'Packages fournis par Nix, sans installation utilisateur');
    const library = await libraryRoot(project);
    assert.ok(library.startsWith('/nix/store/'), 'Vocabulaire issu de la bibliothèque verrouillée');
    assert.ok((await readFile(path.join(library, 'lib/meta.typ'), 'utf8')).includes('chapitres-programme'));
    const exercise = 'chapitres/graphes/exercices/test-prive.typ';
    await mkdir(path.dirname(path.join(temporary, exercise)), { recursive: true });
    await writeFile(path.join(temporary, exercise), exerciseFromTemplate(await readFile(path.join(temporary, 'templates/exercice.typ'), 'utf8'), {
      title: 'Exercice fictif privé', chapters: ['graphes'], algorithms: [], structures: [], languages: [], levels: ['MPI'], difficulty: 2, minutes: 20
    }));
    await runner.run(project, ['c', exercise]);
    for (const variant of ['enonce', 'corrige']) assert.ok((await stat(path.join(temporary, 'build/chapitres/graphes/exercices/test-prive', `test-prive${variant === 'corrige' ? '-cor' : ''}.pdf`))).size > 0);
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0,
      { uri: project.scope, name: project.name });
    await until(async () => {
      try { return (await api.revealSheet(source)).source === source; } catch { return false; }
    }, 'Le dépôt de corrections est découvert');
    assert.ok((await documentTemplates(project)).some(template => template.type === 'copie'));
    await runner.run(project, ['c', source]);
    for (const variant of ['enonce', 'corrige'])
      assert.ok((await stat(path.join(temporary, 'build/corrections/2026/ds/test/copies/exemple', variant === 'corrige' ? 'exemple-cor.pdf' : 'exemple.pdf'))).size > 0);
    const notes = (await readFile(path.join(temporary, 'corrections/2026/ds/test/notes.csv'), 'utf8')).replace(/^\uFEFF/, '').trim().split('\n');
    const recap = (await readFile(path.join(temporary, 'corrections/2026/ds/test/recapitulatif.csv'), 'utf8')).replace(/^\uFEFF/, '').trim().split('\n');
    assert.equal(notes.length, 6, 'Une copie et quatre lignes de barème/statistiques');
    assert.deepEqual(notes[1].split(';').slice(0, 3), ['MPI', 'Nom', 'Prénom']);
    assert.equal(notes[1].split(';')[3], '', 'Réponse non évaluée : cellule vide');
    assert.equal(notes[1].split(';').at(-1), '', 'Total incomplet : cellule vide');
    assert.equal(recap.length, 2);
    const effectif = recap[0].split(';').indexOf('effectif');
    assert.ok(effectif >= 0);
    assert.equal(recap[1].split(';')[effectif], '0', 'Aucune copie entièrement corrigée');
    const inputs = await copyInputs(path.join(temporary, source));
    assert.equal(inputs[1], 'notes=' + notes.join('\n') + '\n');
    assert.equal(inputs[3], 'recap=' + recap.join('\n') + '\n');
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(temporary, source)));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)), editor.document.getText().replace(/\bfeuille: "[^"]*"/, `feuille: "${exercise}"`));
    await vscode.workspace.applyEdit(edit);
    await vscode.commands.executeCommand('mpiExercices.currentEnonce');
    assert.equal(api.previewCount(), 1, 'Le bouton ouvre l’énoncé de la copie');
    await vscode.commands.executeCommand('mpiExercices.currentSubject');
    assert.equal(api.previewCount(), 2, 'Le bouton du sujet ouvre un document distinct, même depuis l’aperçu');
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('mpiExercices.pdf'));
    await vscode.window.tabGroups.close(tabs);
    const scanFile = path.join(temporary, 'corrections/2026/ds/test/tmp/usb-images/Exémple.PDF');
    await mkdir(path.dirname(scanFile), { recursive: true });
    await cp(path.join(temporary, 'build/corrections/2026/ds/test/copies/exemple/exemple.pdf'), scanFile);
    const preview = await previews.open(project, source, 'enonce');
    assert.ok(preview.native);
    // Cliquer le vrai bouton du lecteur, sans dépendre d'une copie nominative.
    let scanButton = false;
    const buttonListener = preview.panel.webview.onDidReceiveMessage(message => { if (message.type === 'scanButtonTest') scanButton = message.visible; });
    const html = preview.panel.webview.html;
    const nonce = /<script nonce="([^"]+)"/.exec(html)![1];
    preview.panel.webview.html = html.replace('<script nonce=', `<script nonce="${nonce}">
      const testApi = acquireVsCodeApi();
      window.acquireVsCodeApi = () => testApi;
      let clicked = false;
      window.addEventListener('message', ({ data }) => {
        if (data?.type !== 'show' || clicked) return;
        clicked = true;
        setTimeout(() => {
          const button = document.getElementById('scan');
          testApi.postMessage({ type: 'scanButtonTest', visible: !button.hidden });
          button.click();
        }, 0);
      });
    </script><script nonce=`);
    const key = path.join(temporary, source);
    await until(() => previews.scans.entries.has(key), 'Le bouton ouvre le scan préparé');
    assert.equal(scanButton, true, 'Le bouton est visible pour une copie');
    const scan = previews.scans.entries.get(key)!;
    let rendered = false;
    let pages = 0;
    const errors: string[] = [];
    const scanListener = scan.webview.onDidReceiveMessage(message => {
      if (message.type === 'pdfReady') rendered = true;
      if (message.type === 'pageProgress') pages = message.total;
      if (['pdfError', 'clientError'].includes(message.type)) errors.push(message.error);
    });
    await until(() => rendered && pages > 0, 'Le scan est rendu et paginé dans VS Code');
    assert.deepEqual(errors, []);
    assert.equal(scan.viewColumn, preview.panel.viewColumn! + 1, 'Le scan est placé à côté de la correction');
    assert.equal(await previews.scans.open(project, source, preview.panel.viewColumn), scan, 'Un second clic réutilise le volet');
    scanListener.dispose();
    buttonListener.dispose();
    const initial = preview.sessions.get('enonce');
    await writeFile(path.join(temporary, 'corrections/2026/ds/test/notes.csv'), notes.join('\n') + '\n');
    await until(() => preview.sessions.get('enonce') !== initial && !!preview.sessions.get('enonce'), 'Statistiques CSV rechargées dans Tinymist');
    console.log('Corrections : découverte, modèle, notes, exports et scan voisin rendu avec pagination vérifiés.');
  } finally {
    if (previousMode === undefined) delete process.env.EXERCICES_MODE;
    else process.env.EXERCICES_MODE = previousMode;
    runner.dispose();
    previews.dispose();
    const index = vscode.workspace.workspaceFolders?.findIndex(folder => folder.uri.fsPath === temporary) ?? -1;
    if (index >= 0) vscode.workspace.updateWorkspaceFolders(index, 1);
    await rm(temporary, { recursive: true, force: true });
  }
}
