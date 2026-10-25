// Only the shared library needs the linked-package cache workaround.
// Exercises and documents already update through Tinymist's live sessions.
export function isLibrarySource(parts: string[]): boolean {
  return parts[0] === 'lib' && parts[1] !== 'tests' || parts.length === 1 && parts[0] === 'load.typ';
}

// Coalesce saved changes; a change during a build requests one subsequent build.
export class Refresh {
  private dirty = false;
  private running = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(private rebuild: () => Promise<void>, private report: (error: unknown) => void, interval = 5000) {
    this.timer = setInterval(() => { void this.flush(); }, interval);
  }
  mark(): void { if (!this.disposed) this.dirty = true; }
  async flush(): Promise<void> {
    if (this.disposed || this.running || !this.dirty) return;
    this.dirty = false; this.running = true;
    try { await this.rebuild(); } catch (error) { if (!this.disposed) this.report(error); }
    finally { this.running = false; }
  }
  dispose(): void { this.disposed = true; clearInterval(this.timer); }
}
