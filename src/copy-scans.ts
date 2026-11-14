import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, stat } from 'node:fs/promises';
import { copyDirectory } from './copy-inputs';
import { mask } from './typst';

const name = (file: string) => path.basename(file, path.extname(file)).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const missing = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

// Les liens Drive restent dans les métadonnées ; les PDF préparés sont voisins du DS, dans tmp/.
export async function copyScans(root: string, source: string, text: string): Promise<string[]> {
  const field = /\bsource\s*:/.exec(mask(text));
  const literal = field && /^"(?:[^"\\]|\\.)*"/.exec(text.slice(field.index + field[0].length).trimStart());
  if (literal) {
    const reference: string = JSON.parse(literal[0]);
    if (/\.pdf$/i.test(reference) && !/^(?!file:)[a-z][a-z\d+.-]*:/i.test(reference)) {
      const file = reference.startsWith('file:') ? fileURLToPath(reference) : reference.startsWith('/') ? path.join(root, reference) : path.resolve(root, path.dirname(source), reference);
      try { if ((await stat(file)).isFile()) return [file]; }
      catch (error) { if (!missing(error)) throw error; }
    }
  }
  const directory = copyDirectory(path.join(root, source));
  const matches: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (missing(error)) return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['node_modules', '__pycache__', 'originaux'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.pdf$/i.test(entry.name) && name(entry.name) === name(source)) matches.push(file);
    }
  }
  for (const folder of ['tmp', 'scans', 'sources']) await visit(path.join(directory, folder));
  return matches.sort((a, b) => a.localeCompare(b, 'fr'));
}
