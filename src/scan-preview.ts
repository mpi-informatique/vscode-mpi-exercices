import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { Bank } from './runner';
import { chooseScan } from './scans';

export class ScanPreview {
  private scan?: { file: string; pdf: string; dark: boolean };
  private visible = false;
  private opening?: Promise<void>;
  constructor(private readonly bank: Bank, private readonly source: string, private readonly workspaceState: vscode.Memento, private readonly post: (message: object) => Thenable<boolean>, private readonly isDisposed: () => boolean) {}

  show(): Promise<void> {
    return this.opening ??= this.open().finally(() => { this.opening = undefined; });
  }

  async toggle(): Promise<void> {
    if (!this.visible) return this.show();
    this.visible = false;
    await this.restore();
  }

  async restore(): Promise<void> {
    await this.post({ type: this.visible ? 'scanOpen' : 'scanClose' });
  }

  private async open(): Promise<void> {
    if (!this.scan) {
      const file = await chooseScan(this.bank, this.source, this.workspaceState);
      if (!file || this.isDisposed()) return;
      const pdf = (await readFile(file)).toString('base64');
      if (this.isDisposed()) return;
      this.scan = { file, pdf, dark: false };
    }
    this.visible = true;
    await this.restore();
  }

  async receive(type: string | undefined): Promise<void> {
    const scan = this.scan;
    if (!scan) return;
    try {
      if (type === 'theme') scan.dark = !scan.dark;
      else if (type === 'restart') scan.pdf = (await readFile(scan.file)).toString('base64');
      else if (type === 'fullscreen') { await vscode.commands.executeCommand('workbench.action.toggleZenMode'); return; }
      else if (type === 'save') {
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(scan.file), filters: { PDF: ['pdf'] } });
        if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(scan.pdf, 'base64'));
        return;
      } else if (type !== 'ready') return;
      await this.post({ type: 'scanMessage', message: { type: 'show', dark: scan.dark, pdf: scan.pdf, sessions: {} } });
    } catch (error) {
      await this.post({ type: 'scanMessage', message: { type: 'status', message: String(error) } });
    }
  }
}
