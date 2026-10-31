import { mask } from './typst';

export { typeLabels, typeLabel } from '@mpi-informatique/exercices-core';
export const sourceExclusions = '**/{build,lib,templates,ressources,docs,scripts,tmp,node_modules,web,shared,.*}/**';
export const technicalFolders = new Set(['build', 'lib', 'templates', 'ressources', 'docs', 'scripts', 'tmp', 'node_modules', 'web', 'shared']);
export interface SourceKind { kind: 'exercice' | 'document'; type?: string; direct: boolean }

// Literal type declarations are indexable without compiling every file while typing.
export function identify(text: string, source = ''): SourceKind | undefined {
  const code = mask(text);
  if (/#show\s*:\s*cours-et-presentation\.with\s*\(/.test(code)) return { kind: 'document', type: 'cours-presentation', direct: true };
  for (const show of code.matchAll(/#show\s*:\s*([\w-]+)\.with\s*\(/g)) {
    const start = show.index! + show[0].length;
    let end = start; let depth = 1;
    while (end < code.length && depth) { if (code[end] === '(') depth++; if (code[end] === ')') depth--; end++; }
    const body = mask(text, false).slice(start, end - 1);
    const type = /\btype\s*:\s*"([^"\n]+)"/.exec(body)?.[1];
    if (show[1] === 'cours') return { kind: 'document', type: type ?? 'cours', direct: true };
    if (show[1] === 'feuille' || type) return { kind: 'document', type: type ?? 'td', direct: true };
  }
  const reexports = [...code.matchAll(/#import\s+:\s*([^\n]+)/g)].some(match => match[1].split(',').some(member => /^(?:ex|[\w-]+\s+as\s+ex)$/.test(member.trim())));
  if (/#let\s+ex\s*=/.test(code) || reexports) return { kind: 'exercice', direct: false };
  return undefined;
}
