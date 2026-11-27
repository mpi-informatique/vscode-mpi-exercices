import * as path from 'node:path';

export interface CodeClickContext {
  line: string;
  before?: string[];
  after?: string[];
}

export function isCodeExtractFile(filepath: string): boolean {
  return /[/\\]code-extract[/\\][^/\\]+[/\\]lib\.typ$/.test(filepath);
}

const normalizeLine = (line: string) => line.trim().replace(/\s+/g, ' ');

function lineScore(candidate: string, query: string): number {
  if (!candidate || !query) return 0;
  if (candidate === query) return 100;
  if (query.length >= 3 && candidate.includes(query)) return 30;
  if (candidate.length >= 3 && query.includes(candidate)) return 20;
  return 0;
}

/** Retrouver le fichier de code et la ligne correspondant au texte cliqué dans l'aperçu. */
export function matchCodeLocation(
  files: { source: string; text: string }[],
  context: CodeClickContext,
  preferredDir?: string
): { source: string; line: number } | undefined {
  const target = normalizeLine(context.line);
  if (!target) return undefined;
  const before = (context.before ?? []).map(normalizeLine).filter(Boolean);
  const after = (context.after ?? []).map(normalizeLine).filter(Boolean);
  let best: { source: string; line: number; score: number } | undefined;
  for (const file of files) {
    const lines = file.text.split(/\r?\n/).map(normalizeLine);
    const dirBonus = preferredDir && path.posix.dirname(file.source) === preferredDir ? 5 : 0;
    for (let i = 0; i < lines.length; i++) {
      const base = lineScore(lines[i], target);
      if (!base) continue;
      let score = base + dirBonus;
      let k = i - 1;
      for (let b = before.length - 1; b >= 0; b--) {
        while (k >= 0 && !lines[k]) k--;
        if (k < 0) break;
        const match = lineScore(lines[k], before[b]);
        if (match >= 100) score += 40;
        else if (match > 0) score += 15;
        k--;
      }
      let m = i + 1;
      for (let a = 0; a < after.length; a++) {
        while (m < lines.length && !lines[m]) m++;
        if (m >= lines.length) break;
        const match = lineScore(lines[m], after[a]);
        if (match >= 100) score += 40;
        else if (match > 0) score += 15;
        m++;
      }
      if (!best || score > best.score) best = { source: file.source, line: i, score };
    }
  }
  return best ? { source: best.source, line: best.line } : undefined;
}
