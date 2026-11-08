import * as vscode from 'vscode';
import * as path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, cp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { exerciseFromTemplate } from '../../src/typst';
import { documentTemplates } from '../../src/authoring';

export async function fixture() {
  const bank = process.env.MPI_EXERCICES_ROOT!;
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'exercices-test-')));
  const previewBank = { root: temporary, name: 'Test isolé', scope: vscode.Uri.file(temporary) };
  try {
    for (const file of ['lib', 'templates', 'scripts', 'justfile', 'nix', 'flake.nix', 'flake.lock', 'typst.toml', 'load.typ']) await cp(path.join(bank, file), path.join(temporary, file), { recursive: true });
    for (const directory of ['exercices/banque/graphes', 'exercices/feuilles', 'exercices/devoirs/2026-2027', 'exercices/concours']) await mkdir(path.join(temporary, directory), { recursive: true });
    const customTemplate = (await readFile(path.join(temporary, 'templates/devoir.typ'), 'utf8')).replace('type: "devoir"', 'type: "colle"');
    await writeFile(path.join(temporary, 'templates/colle.typ'), customTemplate);
    assert.ok((await documentTemplates(previewBank)).some(template => template.type === 'colle'));
    const relative = 'exercices/banque/graphes/test-creation.typ';
    const statement = '#heading(level: 2)[Repère du test]\n      Un texte unique avec une formule $x^2 + y^2 = z^2$.';
    const solution = '#heading(level: 2)[Repère du corrigé] Une correction.';
    const generated = exerciseFromTemplate(await readFile(path.join(bank, 'templates/exercice.typ'), 'utf8'), {
      title: 'Test création', chapters: ['graphes'], algorithms: [], structures: [], languages: [], levels: ['MPI'], difficulty: 2, minutes: 20
    }).replace('#question[Énoncé à compléter.]', `#question[${statement}][${solution}]`).replace('Énoncé à compléter.', statement).replace('solution: none', `solution: [${solution}]`);
    const file = path.join(temporary, relative);
    await writeFile(file, generated);
    return { temporary, previewBank, customTemplate, relative, generated, file };
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

export async function until(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}

export async function pdfText(data: Uint8Array): Promise<string> {
  const { getDocument, GlobalWorkerOptions } = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const loading = getDocument({ data: Uint8Array.from(data) });
  const pdf = await loading.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const { items } = await (await pdf.getPage(n)).getTextContent();
      pages.push(items.map((item: { str?: string }) => item.str ?? '').join(' '));
    }
    return pages.join('\n');
  } finally { await loading.destroy(); }
}
