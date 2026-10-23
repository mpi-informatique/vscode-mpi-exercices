import { runTests } from '@vscode/test-electron';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
delete process.env.ELECTRON_RUN_AS_NODE;
const temporary = await mkdtemp(join(tmpdir(), 'mpi-tp-test-'));
const tp = { type: 'tp', id: 'tp-test', titre: 'TP test', fichier: 'tp-test.typ', chapitres: ['automates-finis'], langages: ['OCaml'], niveaux: ['MPI'], algorithmes: [], structures: [], difficulte: 2, pdfs: { enonce: 'enonce.pdf' }, tp: { ouvrir: 'main.ml', fichiers: [{ url: 'main.ml', chemin: 'main.ml' }], corrige: [] } };
// PDF autonome d'une page pour vérifier le rendu réel de PDF.js.
const stream = 'BT /F1 20 Tf 40 750 Td (TP MPI) Tj ET';
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (const [i, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const server = createServer((request, response) => {
  const data = request.url === '/banque/catalogue.json' ? JSON.stringify([tp]) : request.url === '/menu.md' ? '- TP\n  - tp-test\n' : request.url === '/main.ml' ? 'let x = 0\n' : request.url === '/enonce.pdf' ? pdf : undefined;
  response.writeHead(data === undefined ? 404 : 200); response.end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const workspace = join(temporary, 'test.code-workspace');
await writeFile(workspace, JSON.stringify({ folders: [{ path: temporary }], settings: { 'mpiTp.siteUrl': base, 'mpiTp.courseMenuUrl': base + 'menu.md', 'mpiTp.directory': 'travaux' } }));
try {
  await runTests({ extensionDevelopmentPath: resolve('.'), extensionTestsPath: resolve('dist/integration.js'),
    launchArgs: [workspace, '--force-device-scale-factor=2', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-extensions', '--user-data-dir', join(temporary, 'user')],
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH ?? (process.platform === 'darwin' && existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined) });
} finally { server.close(); await rm(temporary, { recursive: true, force: true }); }
