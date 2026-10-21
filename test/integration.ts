import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import * as discovery from './integration/discovery';
import * as copies from './integration/copies';
import * as edition from './integration/edition';
import * as preview from './integration/preview';
import * as documents from './integration/documents';
import * as startup from './integration/startup';
import * as snippets from './integration/snippets';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('qfortier.vscode-mpi-exercices');
  assert.ok(extension, 'Extension chargée');
  const api = await extension.activate();
  const suites = { snippets, decouverte: discovery, corrections: copies, edition, apercu: preview, demarrage: startup, documents };
  const selected = process.env.MPI_INTEGRATION_SUITE;
  const failures: unknown[] = [];
  for (const [name, suite] of Object.entries(suites)) {
    if (selected && name !== selected) continue;
    console.log(`Suite : ${name}`);
    try { await suite.run(api, extension); }
    catch (error) { console.error(`Échec de la suite ${name}`, error); failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Échecs des tests d'intégration");
}
