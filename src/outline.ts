import * as vscode from 'vscode';
import * as path from 'node:path';
import { copyQuestions, outline, OutlineItem, mask } from './typst';
import { Sheets, SheetMember, memberItem } from './sheets';
import { identify } from './documents';

type Node = { title: string; children?: Node[]; uri?: vscode.Uri; line?: number; icon?: string; collapsed?: boolean; member?: SheetMember };
export class CurrentFile implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private nodes: Node[] = [];
  private current?: vscode.TextDocument;
  private subscriptions: vscode.Disposable[] = [];
  private revision = 0;
  constructor(context: vscode.ExtensionContext, private sheets?: Sheets, dragAndDropController?: vscode.TreeDragAndDropController<Node>) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.path.endsWith('.typ')) { this.current = editor.document; this.update(); } }),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document === this.current) this.update(); }));
    this.current = vscode.window.activeTextEditor?.document;
    if (sheets) this.subscriptions.push(sheets.changed.event(() => this.update()));
    this.update();
    context.subscriptions.push(vscode.window.createTreeView('mpiExercices.current', { treeDataProvider: this, showCollapseAll: false, dragAndDropController }));
  }
  private update(): void {
    const revision = ++this.revision;
    void vscode.commands.executeCommand('setContext', 'mpiExercices.currentIsCopy', !!this.current && identify(this.current.getText(), this.current.uri.fsPath)?.type === 'copie');
    if (!this.current?.uri.path.endsWith('.typ')) return;
    const document = this.current;
    const items = outline(document.getText());
    const node = (item: OutlineItem): Node => ({ title: item.title, line: item.line, uri: document.uri,
      icon: item.kind === 'question' ? 'list-ordered' : item.kind === 'partie' ? 'symbol-namespace' : 'symbol-property',
      children: item.children?.map(node), collapsed: item.kind === 'partie' });
    const bareme = /\b(?:points|bareme)\s*:/.exec(mask(document.getText()));
    const links: Node[] = [{ title: path.basename(document.uri.fsPath), uri: document.uri, line: 0, icon: 'file-code' },
      { title: 'Métadonnées', uri: document.uri, line: items.find(item => item.kind === 'meta')?.line ?? 0, icon: 'tag' }];
    if (bareme) links.push({ title: 'Barème', uri: document.uri, line: document.positionAt(bareme.index).line, icon: 'list-ordered' });
    this.nodes = [...links, ...items.filter(item => item.kind !== 'meta' && item.kind !== 'import').map(node)];
    this.emitter.fire();
    if (this.sheets) {
      const sheet = this.sheets.locate(document.uri);
      if (sheet && document.uri.fsPath === path.join(sheet.bank.root, sheet.source)) {
        void this.sheets.members(sheet.bank, sheet.source).then(members => {
          if (this.current !== document || revision !== this.revision) return;
          this.nodes = [...links, ...members.map(member => ({ title: member.title, member }))];
          this.emitter.fire();
        }).catch(() => undefined);
      }
    }
  }
  get uri(): vscode.Uri | undefined { return this.current?.uri; }
  getChildren(node?: Node): Node[] { return node?.children ?? (node ? [] : this.nodes); }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.member) return memberItem(node.member);
    const item = new vscode.TreeItem(node.title, node.children ? node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = `${this.current?.uri.toString()}:${node.line ?? 'metadata'}:${node.icon}`;
    item.iconPath = new vscode.ThemeIcon(node.icon ?? 'symbol-property');
    if (node.icon === 'file-code') item.resourceUri = node.uri;
    if (node.uri) item.command = { command: 'mpiExercices.reveal', title: 'Afficher dans la source', arguments: [node.uri, node.line] };
    return item;
  }
  dispose(): void { this.emitter.dispose(); for (const sub of this.subscriptions) sub.dispose(); }
}

type Question = { number: string; position: vscode.Position };

function outlineQuestions(items: OutlineItem[]): Question[] {
  return items.flatMap(item => item.kind === 'question'
    ? [{ number: item.title.split('.', 1)[0], position: new vscode.Position(item.line, 0) }]
    : outlineQuestions(item.children ?? []));
}

export async function goToQuestion(uri: vscode.Uri, number?: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const isCopy = identify(document.getText(), uri.path)?.type === 'copie';
  const questions = () => isCopy
    ? copyQuestions(document.getText()).map(({ number, offset }) => ({ number, position: document.positionAt(offset) }))
    : outlineQuestions(outline(document.getText()));
  if (!questions().length) throw new Error(isCopy ? 'Cette copie ne contient aucune question saisie.' : 'Ce fichier ne contient aucune question numérotée.');
  const locate = (input: string): Question | string => {
    const wanted = input.trim().replace(/^q\s*/i, '');
    if (!/^\d+(?:\.\d+)?$/.test(wanted)) return 'Saisissez un numéro de question, par exemple 15 ou 1.15.';
    const matches = questions().filter(({ number }) => number === wanted || number.split('.').at(-1) === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return `Précisez l’exercice (${matches.map(match => match.number).join(', ')}).`;
    return isCopy ? `La question ${wanted} n’a pas été saisie dans cette copie.` : `Question ${wanted} introuvable dans ce fichier.`;
  };
  const value = number ?? await vscode.window.showInputBox({
    title: 'Aller à la question',
    placeHolder: isCopy ? '15 ou 1.15' : '15',
    validateInput: input => {
      const match = locate(input);
      return typeof match === 'string' && input.trim() ? match : undefined;
    }
  });
  if (!value?.trim()) return;
  const match = locate(value);
  if (typeof match === 'string') throw new Error(match);
  await reveal(uri, match.position.line, match.position.character);
}

export async function reveal(uri: vscode.Uri, line = 0, character = 0): Promise<void> {
  const viewColumn = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString())?.viewColumn ?? vscode.ViewColumn.One;
  const editor = await vscode.window.showTextDocument(uri, { viewColumn });
  const position = editor.document.validatePosition(new vscode.Position(line, character));
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  await vscode.commands.executeCommand('mpiExercices.sync');
}
