import { buildViewer } from '@mpi-informatique/exercices-core/build-viewer';
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await buildViewer('node_modules/pdfjs-dist');
await mkdir('releases', { recursive: true });
await build({ entryPoints: { extension: 'src/extension.ts', 'core.test': 'test/core.test.ts', integration: 'test/integration.ts' }, bundle: true, platform: 'node', format: 'cjs', target: 'node20', outdir: 'dist', external: ['vscode'] });
await copyFile('node_modules/vscode-jsonrpc/License.txt', 'dist/LICENSE-vscode-jsonrpc.txt');
