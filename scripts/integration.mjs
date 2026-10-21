import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
const root = path.resolve(import.meta.dirname, '..');
const supported = ['snippets', 'decouverte', 'edition', 'apercu', 'demarrage', 'corrections', 'documents'];
const suite = process.argv.find(arg => arg.startsWith('--suite='))?.slice('--suite='.length)
  ?? (process.env.MPI_PRIVATE_TEST ? 'corrections' : '');
if (suite && !supported.includes(suite)) throw new Error(`Suite inconnue : ${suite}. Choisir ${supported.join(', ')}.`);
const bank = process.env.MPI_EXERCICES_ROOT ?? path.resolve(root, '../exercices');
// VS Code doit démarrer comme application, même depuis un terminal hébergé par Electron.
delete process.env.ELECTRON_RUN_AS_NODE;
await mkdir(path.join(root, '.vscode-test'), { recursive: true });
const userData = await mkdtemp(path.join(tmpdir(), 'exercices-vscode-'));
// L'ajout de dossiers à une fenêtre mono-dossier redémarre l'hôte d'extensions.
// Démarrer en espace de travail pour garder les suites et leur API dans la même session.
const workspace = path.join(userData, 'integration.code-workspace');
await writeFile(workspace, JSON.stringify({ folders: [{ path: bank }] }));
const extensions = path.join(homedir(), '.vscode/extensions');
const installed = await readdir(extensions).catch(() => []);
const tinymist = process.env.TINYMIST_PATH ?? path.join(extensions, installed.filter(name => name.startsWith('myriad-dreamin.tinymist-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? 'missing');
const localCode = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
try {
  await runTests({
    extensionDevelopmentPath: existsSync(tinymist) ? [root, tinymist] : [root],
    extensionTestsPath: path.join(root, 'dist/integration.js'),
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE ?? (process.platform === 'darwin' && existsSync(localCode) ? localCode : undefined),
    // Garder le rendu et la pagination actifs lorsque la fenêtre de test reste en arrière-plan.
    launchArgs: [workspace, '--new-window', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--user-data-dir', userData],
    extensionTestsEnv: {
      MPI_EXERCICES_ROOT: bank,
      MPI_PUBLIC_ROOT: process.env.MPI_PUBLIC_ROOT ?? path.resolve(root, '../exercices'),
      MPI_PRIVATE_ROOT: process.env.MPI_PRIVATE_ROOT ?? path.resolve(root, '../exercices-prive'),
      MPI_INTEGRATION_SUITE: suite,
      PREVIEW_REVIEW: process.env.PREVIEW_REVIEW ?? ''
    }
  });
} finally {
  await rm(userData, { recursive: true, force: true });
}
