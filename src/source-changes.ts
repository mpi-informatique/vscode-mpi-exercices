import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ignoredFolders = ['.git', '.direnv', '.typst', 'build', 'tmp', '__pycache__', 'node_modules'];
export const sourceWatchExclusions = `**/{${ignoredFolders.join(',')}}/**`;
export const watchedSource = (parts: string[]): boolean => !parts.some(part => ignoredFolders.includes(part));

/** Compare disk contents rather than trusting file watcher notifications or timestamps. */
export class SourceChanges {
  private fingerprints = new Map<string, string | undefined>();
  private pending = new Map<string, Promise<boolean>>();

  async prime(files: string[]): Promise<void> {
    await Promise.all(files.map(async file => this.fingerprints.set(file, await this.fingerprint(file))));
  }

  changed(file: string): Promise<boolean> {
    // Serialize notifications for the same path so duplicate events cannot both report a change.
    const result = (this.pending.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const current = await this.fingerprint(file);
      const previous = this.fingerprints.get(file);
      this.fingerprints.set(file, current);
      return current !== previous;
    });
    this.pending.set(file, result);
    const clear = () => { if (this.pending.get(file) === result) this.pending.delete(file); };
    void result.then(clear, clear);
    return result;
  }

  private async fingerprint(file: string): Promise<string | undefined> {
    try { return createHash('sha256').update(await readFile(file)).digest('hex'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
