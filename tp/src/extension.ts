import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseCatalogue, parseCourse, canCorrect, searchTp, type Tp, type CourseEntry } from './core';
import { download, install, listStarted, correctedCode, type Started } from './storage';
import { Previews } from './preview';

type Section = 'started' | 'course' | 'all';
interface Item extends vscode.TreeItem { tp?: Tp; record?: Started }

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('TP MPI');
  const previews = new Previews(context);
  const change = new vscode.EventEmitter<void>();
  context.subscriptions.push(output, previews, change);
  let entries: Tp[] = [];
  let course: CourseEntry[] | undefined;
  let started: Started[] = [];
  let query = '';
  let active: Started | undefined;
  let loading: Promise<void> | undefined;
  const views: vscode.TreeView<Item>[] = [];
  const config = () => vscode.workspace.getConfiguration('mpiTp');
  const site = () => config().get<string>('siteUrl')!;
  const root = () => path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath, config().get<string>('directory', 'tp'));
  const permitted = (tp: Tp) => canCorrect(tp, course);
  const report = (error: unknown) => { output.appendLine(String(error)); void vscode.window.showErrorMessage(String(error)); };
  const current = (id: string) => entries.find(tp => tp.id === id) ?? started.find(record => record.tp.id === id)?.tp;
  const asItem = (tp: Tp, record?: Started): Item => {
    const title = course?.find(entry => entry.id === tp.id)?.title ?? tp.titre;
    return { label: title, description: tp.langages.join(', '), tooltip: [title, ...tp.chapitres, record?.directory].filter(Boolean).join('\n'),
      id: tp.id, tp, record, contextValue: 'tp', iconPath: new vscode.ThemeIcon(record ? 'edit' : 'file-code'),
      command: { command: 'mpiTp.open', title: 'Ouvrir le TP', arguments: [tp.id] } };
  };
  for (const section of ['started', 'course', 'all'] as Section[]) {
    const provider: vscode.TreeDataProvider<Item> = {
      onDidChangeTreeData: change.event,
      getTreeItem: item => item,
      getChildren: () => {
        let items: Item[];
        if (section === 'started') items = started.map(record => asItem(current(record.tp.id)!, record));
        else if (section === 'course') items = (course ?? []).map(entry => {
          const tp = entries.find(tp => tp.id === entry.id);
          return tp ? asItem(tp, started.find(record => record.tp.id === tp.id)) : { label: entry.title ?? entry.id, description: 'Absent du catalogue publié', iconPath: new vscode.ThemeIcon('warning') };
        });
        else items = searchTp(entries, query, new Set(started.map(record => record.tp.id))).map(tp => asItem(tp, started.find(record => record.tp.id === tp.id)));
        return items.length ? items : [{ label: section === 'started' ? 'Aucun TP commencé' : section === 'course' ? 'Aucun TP publié dans le cours' : 'Aucun TP trouvé' }];
      },
    };
    const view = vscode.window.createTreeView(`mpiTp.${section}`, { treeDataProvider: provider, showCollapseAll: false });
    views.push(view); context.subscriptions.push(view);
  }
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      started = await listStarted(root());
      change.fire();
      const results = await Promise.allSettled([
        download(new URL('banque/catalogue.json', site().replace(/\/?$/, '/')).href).then(bytes => parseCatalogue(Buffer.from(bytes).toString('utf8'))),
        download(config().get<string>('courseMenuUrl')!).then(bytes => parseCourse(Buffer.from(bytes).toString('utf8'))),
      ]);
      if (results[0].status === 'fulfilled') { entries = results[0].value; await context.globalState.update('catalogue', entries); }
      else {
        entries = parseCatalogue(JSON.stringify(context.globalState.get<Tp[]>('catalogue', []).map(tp => ({ ...tp, type: 'tp' }))));
        report(`Catalogue indisponible ; les TP téléchargés restent accessibles. ${results[0].reason}`);
      }
      if (results[1].status === 'fulfilled') course = results[1].value;
      else { course = undefined; report(`Menu du cours indisponible : corrigés désactivés. ${results[1].reason}`); }
      previews.revalidate();
      change.fire();
    })().finally(() => { loading = undefined; });
    return loading;
  }
  async function openSkeleton(record: Started) {
    const uri = vscode.Uri.file(path.join(record.directory, record.tp.tp.ouvrir));
    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: false });
  }
  // Sérialiser aussi les doubles clics : une seule installation et une seule disposition.
  let opening = Promise.resolve();
  async function open(id?: string) {
    if (!id) { await search(); return; }
    await loading;
    const tp = current(id);
    if (!tp) throw new Error(`TP inconnu : ${id}`);
    let record = started.find(record => record.tp.id === id);
    if (!record) record = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Préparation : ${tp.titre}` }, () => install(tp, root(), site()));
    started = await listStarted(root()); active = record; change.fire();
    await openSkeleton(record);
    previews.open(record, tp, () => permitted(current(id) ?? tp), site(), () => openSkeleton(record!));
  }
  async function search() {
    await loading;
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { tp: Tp }>();
    picker.title = 'Rechercher un TP'; picker.placeholder = 'Titre, chemin, chapitre, langage…'; picker.value = query;
    (picker as typeof picker & { sortByLabel: boolean }).sortByLabel = false;
    const update = () => {
      query = picker.value;
      picker.items = searchTp(entries, query, new Set(started.map(record => record.tp.id))).map(tp => ({ label: tp.titre, description: tp.fichier, detail: [...tp.langages, ...tp.niveaux, ...tp.chapitres].join(' · '), tp, alwaysShow: true }));
      picker.activeItems = picker.items.slice(0, 1);
      views[2].description = query || undefined;
      void vscode.commands.executeCommand('setContext', 'mpiTp.searchActive', !!query);
      change.fire();
    };
    const subscriptions = [picker.onDidChangeValue(update), picker.onDidAccept(() => {
      const tp = (picker.selectedItems[0] ?? picker.activeItems[0])?.tp;
      if (tp) { picker.hide(); void vscode.commands.executeCommand('mpiTp.open', tp.id); }
    }), picker.onDidHide(() => { for (const sub of subscriptions) sub.dispose(); picker.dispose(); })];
    update(); picker.show();
  }
  const register = (name: string, action: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`mpiTp.${name}`, (...args) => Promise.resolve().then(() => action(...args)).catch(report)));
  register('refresh', refresh);
  register('open', (id?: string) => { opening = opening.catch(() => undefined).then(() => open(id)); return opening; });
  register('search', search);
  register('resetSearch', () => { query = ''; views[2].description = undefined; void vscode.commands.executeCommand('setContext', 'mpiTp.searchActive', false); change.fire(); });
  register('correction', async () => {
    if (!active) throw new Error('Ouvrir un TP au préalable.');
    const tp = current(active.tp.id)!;
    if (!permitted(tp)) throw new Error('Corrigé non publié pour ce TP.');
    if (!tp.tp.corrige.length) throw new Error('Ce TP ne propose pas de code corrigé.');
    let files: string[];
    try { await readFile(path.join(active.directory, '.mpi/corrige', tp.tp.corrige[0].chemin)); files = tp.tp.corrige.map(file => path.join(active!.directory, '.mpi/corrige', file.chemin)); }
    catch { files = await correctedCode(tp.tp.corrige, active.directory, site()); }
    const file = files.length === 1 ? files[0] : (await vscode.window.showQuickPick(files.map(file => ({ label: path.basename(file), file }))))?.file;
    if (file) await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.One, preview: false });
  });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('mpiTp')) { previews.dispose(); void refresh().catch(report); } }));
  await refresh();
  return { refresh, previewStatus: previews.status, open: (id: string) => vscode.commands.executeCommand('mpiTp.open', id), get entries() { return entries; }, get started() { return started; }, get course() { return course; } };
}
