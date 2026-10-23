import { matches, type Exercise } from '@mpi-informatique/exercices-core';

export interface FileResource { url: string; chemin: string; extraire?: string }
export interface Tp {
  id: string; titre: string; chapitres: string[]; langages: string[];
  niveaux: string[]; algorithmes: string[]; structures: string[]; difficulte: number | null;
  fichier: string; pdfs: { enonce: string; corrige?: string };
  tp: { ouvrir: string; fichiers: FileResource[]; corrige: FileResource[] };
}
export interface CourseEntry { id: string; cor: boolean; title?: string }

export function safePath(value: string): string {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f]/.test(value) || value.split('/').some(part => !part || part.startsWith('.'))) throw new Error(`Chemin TP invalide : ${value}`);
  return value;
}

export function resourceUrl(value: string, site: string): string {
  const base = new URL(site.endsWith('/') ? site : site + '/');
  const url = new URL(value, base);
  // Les fichiers du catalogue appartiennent au site configuré.
  safePath(decodeURIComponent(url.pathname.slice(base.pathname.length)));
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !['http:', 'https:'].includes(url.protocol) || url.search || url.hash) throw new Error('Ressource hors du site des TP.');
  return url.href;
}

export function parseCatalogue(text: string): Tp[] {
  const entries = JSON.parse(text);
  if (!Array.isArray(entries)) throw new Error('Catalogue des TP invalide.');
  const identifiers = new Set<string>();
  return entries.filter(entry => entry?.type === 'tp').map(entry => {
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id) || identifiers.has(entry.id) || typeof entry.titre !== 'string' || !entry.titre) throw new Error('Identifiant ou titre de TP invalide.');
    identifiers.add(entry.id);
    if (!entry.pdfs || typeof entry.pdfs.enonce !== 'string' || !entry.tp) throw new Error(`TP sans PDF ou manifeste : ${entry.id}`);
    safePath(entry.pdfs.enonce);
    if (entry.pdfs.corrige) safePath(entry.pdfs.corrige);
    safePath(entry.tp.ouvrir);
    for (const field of ['fichiers', 'corrige']) {
      if (!Array.isArray(entry.tp[field])) throw new Error(`Ressources TP invalides : ${entry.id}`);
      for (const item of entry.tp[field]) {
        safePath(item.url); safePath(item.chemin);
        if (item.extraire !== undefined) safePath(item.extraire);
      }
    }
    if (!entry.tp.fichiers.some((file: FileResource) => file.chemin === entry.tp.ouvrir && !file.extraire)) throw new Error(`Squelette initial absent : ${entry.id}`);
    for (const field of ['chapitres', 'langages', 'niveaux', 'algorithmes', 'structures']) {
      if (!Array.isArray(entry[field]) || !entry[field].every((x: unknown) => typeof x === 'string')) throw new Error(`Métadonnées TP invalides : ${entry.id}`);
    }
    return entry as Tp;
  });
}

export function parseCourse(markdown: string): CourseEntry[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => /^- TP\s*:?[ \t]*$/.test(line));
  if (start < 0) return [];
  const result: CourseEntry[] = [];
  for (let i = start + 1; i < lines.length && !/^- /.test(lines[i]); i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^( +)- (.+?)\s*$/.exec(line);
    if (!item) throw new Error(`Entrée du menu TP invalide : ${line}`);
    const next = lines.slice(i + 1).find(line => line.trim());
    const nextIndent = next ? /^( +)- /.exec(next)?.[1].length ?? 0 : 0;
    if (nextIndent > item[1].length) continue;
    const entry = /^(?:\[([^\]]+)\]\(([a-z0-9][a-z0-9-]*)\)|([a-z0-9][a-z0-9-]*))(?:\s*:\s*(cor))?$/.exec(item[2]);
    if (!entry) {
      if (/^\[[^\]]+\]\((?:doc:|https?:\/\/)/.test(item[2])) continue;
      throw new Error(`Entrée du menu TP invalide : ${line}`);
    }
    const id = entry[2] || entry[3];
    if (result.some(item => item.id === id)) throw new Error(`TP dupliqué : ${id}`);
    result.push({ id, title: entry[1], cor: entry[4] === 'cor' });
  }
  return result;
}

export function canCorrect(tp: Tp, course: CourseEntry[] | undefined): boolean {
  if (course === undefined) return false;
  const entry = course.find(entry => entry.id === tp.id);
  return !entry || entry.cor;
}

export function searchTp(entries: Tp[], query: string, started: ReadonlySet<string> = new Set()): Tp[] {
  return entries.filter(tp => matches({ ...tp, difficulte: tp.difficulte ?? 1, duree: null, concours: null } as Exercise, query, {}))
    .sort((a, b) => Number(started.has(b.id)) - Number(started.has(a.id)) || a.titre.localeCompare(b.titre, 'fr', { numeric: true }));
}
