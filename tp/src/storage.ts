import { lstat, mkdir, readFile, rename, rm, writeFile, readdir, mkdtemp } from 'node:fs/promises';
import * as path from 'node:path';
import { unzipSync } from 'fflate';
import { safePath, resourceUrl, parseCatalogue, type Tp, type FileResource } from './core';

export const limit = 100 * 1024 * 1024;
export async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}) : ${url}`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Ressource trop volumineuse.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Réponse vide.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Ressource trop volumineuse.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export function unzip(data: Uint8Array): Record<string, Uint8Array> {
  let size = 0, count = 0;
  return unzipSync(data, { filter: file => {
    safePath(file.name.replace(/\/$/, ''));
    size += file.originalSize;
    if (++count > 10000 || size > limit) throw new Error('Archive trop volumineuse.');
    return !file.name.endsWith('/');
  } });
}

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export interface Started { tp: Tp; directory: string }
export async function listStarted(root: string): Promise<Started[]> {
  if (!await exists(root)) return [];
  const result: Started[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = path.join(root, entry.name);
    try {
      const text = await readFile(path.join(directory, '.mpi-tp.json'), 'utf8');
      const tp = parseCatalogue(text)[0];
      if (tp && tp.id === entry.name) result.push({ tp, directory });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`TP commencé illisible (${entry.name}) : ${error}`);
    }
  }
  return result;
}

// L'installation est préparée à part puis renommée : un échec reste réessayable.
export async function install(tp: Tp, root: string, site: string, fetchFile = download): Promise<Started> {
  const directory = path.join(root, tp.id);
  if (await exists(directory)) {
    const record = (await listStarted(root)).find(item => item.tp.id === tp.id);
    if (!record) throw new Error(`Le dossier existe déjà et n'est pas un TP commencé : ${directory}`);
    return record;
  }
  await mkdir(root, { recursive: true });
  const temporary = await mkdtemp(path.join(root, '.installation-'));
  const used = new Set<string>();
  async function save(relative: string, bytes: Uint8Array) {
    safePath(relative);
    if (used.has(relative)) throw new Error(`Ressource dupliquée : ${relative}`);
    used.add(relative);
    const output = path.join(temporary, relative);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: 'wx' });
  }
  try {
    const pdf = await fetchFile(resourceUrl(tp.pdfs.enonce, site));
    if (Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Énoncé PDF invalide.');
    await mkdir(path.join(temporary, '.mpi'));
    await writeFile(path.join(temporary, '.mpi/enonce.pdf'), pdf);
    for (const file of tp.tp.fichiers) {
      const bytes = await fetchFile(resourceUrl(file.url, site));
      await save(file.chemin, bytes);
      if (file.extraire) for (const [name, data] of Object.entries(unzip(bytes))) await save(`${file.extraire}/${name}`, data);
    }
    await writeFile(path.join(temporary, '.mpi-tp.json'), JSON.stringify([{ ...tp, type: 'tp' }]));
    // Ne jamais remplacer un dossier créé pendant le téléchargement.
    if (await exists(directory)) throw new Error('Le TP a été créé pendant le téléchargement. Relancer son ouverture.');
    await rename(temporary, directory);
    return { tp, directory };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function correctedCode(files: FileResource[], directory: string, site: string): Promise<string[]> {
  const root = path.join(directory, '.mpi/corrige');
  // Sous-dossier réservé aux téléchargements, séparé du travail de l'élève.
  if (await exists(root)) throw new Error('Le code corrigé est déjà téléchargé.');
  const temporary = await mkdtemp(path.join(directory, '.mpi/.corrige-'));
  try {
    const outputs = [];
    for (const file of files) {
      safePath(file.chemin);
      const output = path.join(temporary, file.chemin);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, await download(resourceUrl(file.url, site)), { flag: 'wx' });
      outputs.push(path.join(root, file.chemin));
    }
    await rename(temporary, root);
    return outputs;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
