import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { buildViewer } from '@mpi-informatique/exercices-core/build-viewer';
await buildViewer('node_modules/pdfjs-dist');
await mkdir('releases', { recursive: true });
await build({ entryPoints: { extension: 'src/extension.ts', 'core.test': 'test/core.test.ts', integration: 'test/integration.ts' }, bundle: true, platform: 'node', format: 'cjs', target: 'node20', outdir: 'dist', external: ['vscode'] });
