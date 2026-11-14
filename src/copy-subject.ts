import { mask } from './typst';

export function copySubject(text: string): string | undefined {
  const field = /\bfeuille\s*:/.exec(mask(text));
  const literal = field && /^"(?:[^"\\]|\\.)*"/.exec(text.slice(field.index + field[0].length).trimStart());
  if (!literal) return;
  const source: string = JSON.parse(literal[0]);
  if (!source.endsWith('.typ') || source.startsWith('/') || source.includes('\\') || source.split('/').includes('..') || /^[a-z][a-z\d+.-]*:/i.test(source)) return;
  return source;
}
