import * as vscode from 'vscode';
import * as path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { Runner } from '../../src/runner';
import { documentTemplates } from '../../src/authoring';
import { contestFromTemplate } from '../../src/typst';
import { until } from './helpers';

export async function run(api: any, _extension?: unknown): Promise<void> {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'mpi-documents-test-')));
  const project = { root: temporary, name: 'Cours fictifs', scope: vscode.Uri.file(temporary) };
  const runner = new Runner();
  try {
    for (const directory of ['lib', 'templates', 'scripts', 'chapitres/automates'])
      await mkdir(path.join(temporary, directory), { recursive: true });
    for (const filename of ['flake.nix', 'flake.lock', 'nix', 'scripts/package.py', 'typst.toml', 'load.typ'])
      await cp(path.join(process.env.MPI_PUBLIC_ROOT!, filename), path.join(temporary, filename), { recursive: true });
    await writeFile(path.join(temporary, 'lib/cours.typ'), `#let cours(type: "poly", titre: "Cours", body) = {
  if type == "presentation" { set page(width: 160mm, height: 90mm) }
  [#heading(titre) #body]
}
`);
    await writeFile(path.join(temporary, 'chapitres/automates/contenu.typ'), 'Un automate possède des états et des transitions.\n');
    await writeFile(path.join(temporary, 'scripts/build.py'), `import sys, subprocess
from pathlib import Path
if sys.argv[1] != 'c':
    raise SystemExit('Commande inconnue')
source = Path(sys.argv[2])
for variant in ('enonce', 'corrige'):
    output = Path('build') / source.with_suffix('') / (source.stem + ('-cor' if variant == 'corrige' else '') + '.pdf')
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['typst', 'compile', '--root', '.', '--input', 'corrige=' + str(variant == 'corrige').lower(), str(source), str(output)], check=True)
`);
    for (const type of ['cours', 'poly', 'presentation']) {
      const template = `#import "/lib/cours.typ": cours
#show: cours.with(
  ${type === 'cours' ? '' : `type: "${type}",`}
  titre: "Support de cours",
)
#include "contenu.typ"
`;
      await writeFile(path.join(temporary, 'templates', type + '.typ'), template);
      await writeFile(path.join(temporary, 'chapitres/automates', type + '.typ'), contestFromTemplate(template, 'Automates'));
    }
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0,
      { uri: project.scope, name: project.name });
    await until(async () => {
      try { return (await api.revealSheet('chapitres/automates/poly.typ')).bank.root === temporary; }
      catch { return false; }
    }, 'Un dépôt de cours sans bibliothèque d\'exercices est découvert');
    assert.deepEqual((await documentTemplates(project)).map(template => template.type).sort(), ['cours', 'poly', 'presentation']);
    for (const type of ['cours', 'poly', 'presentation']) {
      const source = `chapitres/automates/${type}.typ`;
      const document = await api.revealSheet(source);
      assert.equal(document.documentType, type);
      assert.equal(document.compositionError, undefined, 'Un cours sans composition d\'exercices reste un document ordinaire');
      for (const variant of ['enonce', 'corrige']) {
        await runner.run(project, ['c', source]);
        assert.ok((await stat(path.join(temporary, `build/chapitres/automates/${type}/${type}${variant === 'corrige' ? '-cor' : ''}.pdf`))).size > 0);
      }
    }
    // Aucun catalogue ni aucune cible catalogue n'est nécessaire à ce dépôt.
    await vscode.commands.executeCommand('mpiExercices.refresh');
    await assert.rejects(readFile(path.join(temporary, 'build/catalogue.json')));
    console.log('Dépôt de documents : modèles, polys, présentations et exports vérifiés.');
  } finally {
    runner.dispose();
    const index = vscode.workspace.workspaceFolders?.findIndex(folder => folder.uri.fsPath === temporary) ?? -1;
    if (index >= 0) vscode.workspace.updateWorkspaceFolders(index, 1);
    await rm(temporary, { recursive: true, force: true });
  }
}
