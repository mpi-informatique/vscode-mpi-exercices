export * from '@mpi-informatique/exercices-core';
import { compilationInputs, pdfFilename as exercisePdfFilename, safeSource, type Variant } from '@mpi-informatique/exercices-core';

export function pdfFilename(source: string, variant: Variant, documentType?: string): string {
  safeSource(source);
  return exercisePdfFilename(source, variant, documentType);
}

export function pdfTarget(source: string, variant: Variant, _copy = false, documentType?: string): string {
  safeSource(source);
  const stem = source.slice(0, -4);
  const filename = pdfFilename(source, variant, documentType);
  return `build/${stem}/${filename}`;
}

export function previewArguments(root: string, source: string, variant: Variant, direct = false, documentType?: string): string[] {
  safeSource(source);
  const args = ['--root', root, '--ignore-system-fonts'];
  for (const [name, value] of Object.entries(compilationInputs(variant, documentType))) args.push('--input', `${name}=${value}`);
  if (!direct) args.push('--input', `exercice=/${source}`);
  args.push(`${root}/${direct ? source : 'templates/fiche.typ'}`);
  return args;
}

export function executionCommand(mode: 'auto' | 'nix' | 'direct', flake: boolean, nix: string, python: string, targets: string[]): { command: string; args: string[] } {
  const args = ['scripts/build.py', ...targets];
  return mode === 'nix' || (mode === 'auto' && flake)
    ? { command: nix, args: ['develop', '.', '-c', python, ...args] }
    : { command: python, args };
}

export interface TypstDiagnostic { file: string; line: number; column: number; message: string; warning: boolean }
export function parseDiagnostics(output: string): TypstDiagnostic[] {
  const result: TypstDiagnostic[] = [];
  let message = ''; let warning = false;
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const heading = /^(error|warning): (.*)/.exec(line);
    if (heading) { message = heading[2]; warning = heading[1] === 'warning'; }
    const location = /(?:┌─|-->)[ \t]+(.+):(\d+):(\d+)\s*$/.exec(line);
    if (location && message) result.push({ file: location[1], line: Math.max(0, +location[2] - 1), column: Math.max(0, +location[3] - 1), message, warning });
  }
  return result;
}
