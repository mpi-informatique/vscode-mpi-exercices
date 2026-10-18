import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { Filters, Variant, facets, labels, matches, parseCatalogue, pdfTarget, pdfFilename, safeSource } from './core';
import { identify, sourceExclusions, typeLabels, typeLabel } from './documents';
import { Bank, Runner } from './runner';
import { Previews } from './preview';
import { CurrentFile, reveal } from './outline';
import { BankEntry, newExercise, newSheet, selectBank, documentTemplates } from './authoring';
import { Browser, BrowserNode, Source } from './browser';
import { isFolder } from './tree';
import { Sheets, SheetMember } from './sheets';
import { sourceMetadata } from './sheet-model';
import { newFolder, moveSource, deleteSource, Location } from './files';
import { Drag } from './drag';
import { Refresh } from './refresh';
import { RecentSources, searchPicker } from './search';
import { errorStatus } from './errors';
import { mask } from './typst';
import { environment, disposeEnvironments } from './environment';
import { bankCandidates } from './discovery';
import { CodeLinks, openAssociatedCode } from './code-files';

export async function activate(context: vscode.ExtensionContext) {
  const runner = new Runner();
  const recentSources = new RecentSources(context.workspaceState);
  context.subscriptions.push(recentSources, { dispose: disposeEnvironments });
  const library = new Browser('exercices', context.workspaceState);
  const sheets = new Browser('documents', context.workspaceState);
  const browsers = [library, sheets];
  const drag = <T>() => new Drag<T>(() => sheetEditor, relocate, error => report(error));
  const view = vscode.window.createTreeView('mpiExercices.library', { treeDataProvider: library, showCollapseAll: false, canSelectMany: true, dragAndDropController: drag<BrowserNode>() });
  const sheetView = vscode.window.createTreeView('mpiExercices.sheets', { treeDataProvider: sheets, showCollapseAll: false, dragAndDropController: drag<BrowserNode>() });
  let banks: Bank[] = [];
  let watchers: vscode.Disposable[] = [];
  let disposed = false;
  let discovery = Promise.resolve();
  const saved = context.workspaceState.get<{ filters: Filters }>('search');
  if (saved) { library.filters = saved.filters; }
  const entries = (): BankEntry[] => library.entries.flatMap(item => item.ex ? [{ bank: item.bank, ex: item.ex }] : []);
  const sheetEditor = new Sheets(() => banks, entries);
  const currentFile = new CurrentFile(context, sheetEditor, drag());
  context.subscriptions.push(sheetView.onDidChangeSelection(event => {
    const node = event.selection[0];
    if (node && !isFolder(node)) {
      const source = 'sheet' in node ? node.sheet : node.source;
      if ('sheet' in node || node.documentType) sheetEditor.selected = { bank: node.bank, source };
    }
  }));
  const report = (error: unknown) => {
    if (disposed || error instanceof vscode.CancellationError) return;
    runner.output.appendLine(String(error));
    if (!errorStatus.has(error)) errorStatus.set('extension', 'Erreur Exercices MPI', error);
  };
  const update = () => {
    for (const [index, browser] of browsers.entries()) {
      const treeView = [view, sheetView][index];
      treeView.description = `${browser.visible.length} / ${browser.entries.length}`;
      treeView.message = [browser.filters.type && typeLabel(browser.filters.type), ...facets.filter(key => browser.filters[key]).map(key => `${labels[key]} : ${browser.filters[key]}`), browser.filters.difficulteMax && `Difficulté ≤ ${browser.filters.difficulteMax}`].filter(Boolean).join(' · ') || undefined;
      browser.changed.fire();
      void vscode.commands.executeCommand('setContext', `mpiExercices.searchActive.${['library', 'sheets'][index]}`, browser.searching);
      void context.workspaceState.update(browser === library ? 'search' : `search.${browser.category}`, { filters: browser.filters });
    }
  };
  for (const browser of [sheets]) {
    const saved = context.workspaceState.get<{ filters: Filters }>(`search.${browser.category}`);
    if (saved) { browser.filters = saved.filters; }
  }
  async function scan(bank: Bank, browser: Browser): Promise<void> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(bank.root), '**/*.typ'), sourceExclusions);
    const metadata = new Map(entries().filter(entry => entry.bank.root === bank.root).map(entry => [entry.ex.fichier, entry.ex]));
    const sources = await Promise.all(files.map(async uri => {
      const source = path.relative(bank.root, uri.fsPath).split(path.sep).join('/');
      if (source.split('/').includes('tmp')) return undefined;
      const text = (await vscode.workspace.openTextDocument(uri)).getText();
      const info = identify(text, source);
      if (!info || (browser === library) !== (info.kind === 'exercice')) return undefined;
      const item: Source = { bank, source, documentType: info.type, ex: metadata.get(source) };
      if (browser === library && !item.ex) item.ex = sourceMetadata(text, source);
      if (browser !== library) {
        item.metadata = [sourceMetadata(text, source)];
        if (info.direct && /#show\s*:\s*feuille\.with\s*\(/.test(mask(text))) {
          try { item.members = await sheetEditor.members(bank, source); item.metadata.push(...item.members.flatMap(member => metadata.get(member.source) ?? [])); }
          catch (error) { item.compositionError = String(error); }
        }
      }
      return item;
    }));
    if (disposed || !banks.includes(bank)) return;
    browser.entries = [...browser.entries.filter(entry => entry.bank.root !== bank.root), ...sources.filter((source): source is Source => !!source)];
    update();
  }
  const hasCatalogue = (bank: Bank) => existsSync(path.join(bank.root, 'scripts/catalogue.py'));
  async function load(bank: Bank): Promise<void> {
    if (!hasCatalogue(bank)) { await scan(bank, library); return; }
    const catalogue = parseCatalogue(await readFile(path.join(bank.root, 'build/catalogue.json'), 'utf8'));
    const metadata = new Map(catalogue.map(ex => [ex.fichier, ex]));
    await scan(bank, library);
    for (const item of library.entries) if (item.bank.root === bank.root) item.ex = metadata.get(item.source) ?? item.ex;
    update();
  }
  async function discover(): Promise<void> {
    for (const watcher of watchers) watcher.dispose(); watchers = [];
    banks = []; for (const browser of browsers) browser.entries = [];
    const seen = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      const configured = vscode.workspace.getConfiguration('mpiExercices', folder.uri).get<string>('bankPath', '');
      for (const candidate of await bankCandidates(folder.uri.fsPath, configured)) {
        const project = { root: candidate, name: path.basename(candidate), scope: folder.uri };
        if (!hasCatalogue(project) && !(await documentTemplates(project)).length) continue;
        const root = await realpath(candidate);
        if (seen.has(root)) continue; seen.add(root);
        const bank: Bank = { root, name: path.basename(root), scope: folder.uri }; banks.push(bank);
        if (vscode.extensions.getExtension('myriad-dreamin.tinymist') && vscode.workspace.isTrusted)
          void environment(bank).catch(error => { if (!disposed) runner.output.appendLine(`Préparation de l’environnement [${bank.name}] : ${error}`); });
        try {
          if (hasCatalogue(bank) && !existsSync(path.join(root, 'build/catalogue.json'))) await runner.run(bank, ['catalogue']);
          await load(bank);
        } catch (error) { report(error); await scan(bank, library); }
        await scan(bank, sheets);
        const catalogue = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), 'build/catalogue.json'));
        let timer: NodeJS.Timeout | undefined;
        const reload = () => { clearTimeout(timer); timer = setTimeout(() => { void load(bank).catch(report); }, 200); };
        catalogue.onDidChange(reload); catalogue.onDidCreate(reload);
        watchers.push(catalogue, { dispose: () => clearTimeout(timer) });
        const refresh = new Refresh(async () => {
          if (hasCatalogue(bank)) await runner.run(bank, ['catalogue']);
          if (disposed || !banks.includes(bank)) return;
          await load(bank);
          await scan(bank, sheets);
        }, report);
        // Imports can affect computed metadata: conservatively track all Typst sources.
        const sources = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*.typ'));
        const mark = (uri: vscode.Uri) => { if (!path.relative(root, uri.fsPath).split(path.sep).includes('build')) refresh.mark(); };
        sources.onDidChange(mark);
        sources.onDidCreate(mark);
        sources.onDidDelete(mark);
        watchers.push(refresh, sources);
        for (const browser of browsers) {
          const files = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*.typ'));
          const rescan = () => { void scan(bank, browser).catch(report); };
          files.onDidCreate(rescan); files.onDidDelete(rescan);
          if (browser !== library) files.onDidChange(rescan);
          watchers.push(files);
        }
      }
    }
    for (const browser of browsers) browser.changed.fire();
    update();
    sheetEditor.remember();
    sheetEditor.changed.fire();
    if (!banks.length) view.message = 'Ouvrir exercices, exercices-prive ou un dépôt avec scripts/build.py et des modèles Typst.';
  }
  const discoverQueued = () => { discovery = discovery.catch(() => undefined).then(discover); return discovery; };
  async function checkSource(source: Source): Promise<Source> {
    safeSource(source.source);
    if (!banks.some(bank => bank.root === source.bank.root)) throw new Error('Cette banque ne fait pas partie de cet espace de travail.');
    const file = await realpath(path.join(source.bank.root, source.source));
    if (!file.startsWith(source.bank.root + path.sep)) throw new Error('La source doit rester dans la banque.');
    return source;
  }
  async function chooseSource(argument?: BrowserNode | vscode.Uri): Promise<Source | undefined> {
    await discovery;
    if (argument && !(argument instanceof vscode.Uri)) {
      if (isFolder(argument)) return;
      return checkSource(argument);
    }
    const uri = argument ?? vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme === 'file') {
      const file = await realpath(uri.fsPath);
      const bank = banks.filter(bank => file.startsWith(bank.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
      if (bank) {
        const source = path.relative(bank.root, file).split(path.sep).join('/');
        const info = identify((await vscode.workspace.openTextDocument(uri)).getText(), source);
        if (info) return checkSource({ bank, source, documentType: info.type });
      }
      if (argument) throw new Error('Choisissez un exercice exportant ex ou un document déclarant son type.');
    }
    const picked = await vscode.window.showQuickPick(library.visible.map(item => ({ label: item.ex?.titre ?? item.source, description: item.bank.name, detail: item.source, item })), { placeHolder: 'Choisir un exercice', matchOnDetail: true });
    return picked ? checkSource(picked.item) : undefined;
  }
  async function compile(source: Source, targets = ['c', source.source]): Promise<void> {
    await checkSource(source);
    if (vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === 'file' && document.uri.fsPath.startsWith(source.bank.root + path.sep))) throw new Error('Enregistrez les fichiers modifiés de la banque avant d’exporter le PDF.');
    await runner.run(source.bank, targets);
  }
  async function exportPdf(preview: Source, variant: Variant): Promise<void> {
    const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(preview.bank.root, pdfFilename(preview.source, variant, preview.documentType))), filters: { PDF: ['pdf'] } });
    if (!destination) return;
    const target = pdfTarget(preview.source, variant, preview.documentType === 'copie', preview.documentType);
    await compile(preview);
    const from = vscode.Uri.file(path.join(preview.bank.root, target));
    if (from.toString() !== destination.toString()) await vscode.workspace.fs.copy(from, destination, { overwrite: true });
  }
  const previews = new Previews(context, exportPdf);
  let preparationTimer: NodeJS.Timeout | undefined;
  let preparationSource: string | undefined;
  function schedulePreparation(editor = vscode.window.activeTextEditor): void {
    clearTimeout(preparationTimer);
    // Focusing the viewer must keep the reserve for the displayed source.
    if (!editor) return;
    const uri = editor.document.uri;
    if (uri.toString() !== preparationSource) previews.clearPreparation();
    preparationSource = uri.toString();
    if (uri.scheme !== 'file' || !uri.path.endsWith('.typ')) return;
    preparationTimer = setTimeout(() => {
      void discovery.then(async () => {
        if (disposed || vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) return;
        const file = await realpath(uri.fsPath);
        if (disposed || vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) return;
        const bank = banks.filter(bank => file.startsWith(bank.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
        if (!bank) return;
        await previews.prepare(bank, path.relative(bank.root, file).split(path.sep).join('/'));
      }).catch(error => { if (!disposed) runner.output.appendLine(`Préparation de l’aperçu : ${error}`); });
    }, 600);
  }
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(schedulePreparation),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (document.uri.toString() !== preparationSource) return;
      clearTimeout(preparationTimer);
      previews.clearPreparation();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => schedulePreparation()),
    vscode.window.onDidChangeActiveColorTheme(() => schedulePreparation()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('mpiExercices') || event.affectsConfiguration('tinymist.serverPath')) schedulePreparation();
    }),
    { dispose: () => clearTimeout(preparationTimer) });
  const register = (name: string, action: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(`mpiExercices.${name}`, async (...args: unknown[]) => {
      try { const result = await action(...args); errorStatus.clear('extension'); return result; } catch (error) { if (error instanceof vscode.CancellationError) return; report(error); }
    }));
  };
  async function relocate(source: Location, destination: string): Promise<void> {
    await checkSource(source);
    await moveSource(source, destination);
    previews.entries.get(`${source.bank.root}/${source.source}`)?.panel.dispose();
    for (const key of ['current', 'selected'] as const) if (sheetEditor[key]?.bank.root === source.bank.root && sheetEditor[key]?.source === source.source) sheetEditor[key] = { bank: source.bank, source: destination };
    for (const browser of browsers) await scan(source.bank, browser);
  }
  for (const [index, browser] of browsers.entries()) {
  const suffix = ['', 'Sheets'][index];
  register('search' + suffix, async () => {
    await discovery;
    const result = await searchPicker(browser, recentSources);
    if (!result) return;
    const source = await checkSource(result);
    if (source.documentType) sheetEditor.selected = source;
    await [view, sheetView][index].reveal(source, { select: true });
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(source.bank.root, source.source)));
  });
  register('filters' + suffix, async () => {
    const options = [...(browser === sheets ? [{ label: 'Type de feuille', description: browser.filters.type ? typeLabel(browser.filters.type) : 'Tous', key: 'type' as const }] : []), ...facets.map(key => ({ label: labels[key], description: browser.filters[key] ?? 'Tous', key })), { label: 'Difficulté maximale', description: String(browser.filters.difficulteMax ?? 'Toutes'), key: 'difficulteMax' as const }];
    const chosen = await vscode.window.showQuickPick(options, { title: browser === sheets ? 'Filtrer les feuilles' : 'Filtrer les exercices' }); if (!chosen) return;
    const key = chosen.key;
    const metadata = browser.entries.flatMap(item => item.ex ? [item.ex] : item.metadata ?? []);
    const types = [...Object.keys(typeLabels), ...browser.entries.flatMap(item => item.documentType ?? []), ...(await Promise.all(banks.map(documentTemplates))).flat().map(template => template.type)];
    const values = key === 'type' ? [...new Set(types)] : key === 'difficulteMax' ? ['1', '2', '3', '4', '5'] : [...new Set(metadata.flatMap(ex => key === 'concours' ? ex.concours?.nom ? [ex.concours.nom] : [] : ex[key]))].sort((a, b) => a.localeCompare(b, 'fr'));
    const value = await vscode.window.showQuickPick([{ label: 'Tous / toutes', value: '' }, ...values.map(value => ({ label: key === 'type' ? typeLabel(value) : value, value }))], { title: chosen.label }); if (!value) return;
    if (!value.value) delete browser.filters[key]; else if (key === 'difficulteMax') browser.filters.difficulteMax = +value.value; else browser.filters[key] = value.value;
    update();
    await vscode.commands.executeCommand(`mpiExercices.${['library', 'sheets'][index]}.focus`);
  });
  register('reset' + suffix, () => { browser.filters = {}; update(); });
  }
  register('openPanel', () => vscode.commands.executeCommand('workbench.view.extension.mpiExercices'));
  for (const section of ['current', 'library', 'sheets']) register('collapse' + section, async () => {
    await vscode.commands.executeCommand(`mpiExercices.${section}.focus`);
    await vscode.commands.executeCommand(`workbench.actions.treeView.mpiExercices.${section}.collapseAll`);
  });
  async function revealSheet(source: Source): Promise<void> {
    sheets.filters = {}; update();
    if (source.documentType) sheetEditor.selected = source;
    await sheetView.reveal(source, { select: true, expand: true });
  }
  register('refresh', async () => { await discovery; if (!banks.length) await discoverQueued(); for (const bank of banks) { if (hasCatalogue(bank)) await runner.run(bank, ['catalogue']); await load(bank); await scan(bank, sheets); } });
  register('source', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await vscode.window.showTextDocument(vscode.Uri.file(path.join(source.bank.root, source.source))); });
  register('code', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await openAssociatedCode(source); });
  register('currentCorrige', async () => {
    if (currentFile.uri) await vscode.commands.executeCommand('mpiExercices.corrige', currentFile.uri);
  });
  for (const variant of ['enonce', 'corrige'] as const) register(variant, async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await previews.open(source.bank, source.source, variant); });
  for (const variant of ['enonce', 'corrige'] as const) register('download' + (variant === 'corrige' ? 'Corrige' : 'Enonce'), async (argument?: BrowserNode | vscode.Uri) => {
    const source = await chooseSource(argument);
    if (source) await exportPdf(source, variant);
  });
  register('compileBoth', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await compile(source); });
  register('output', () => runner.output.show(true));
  register('sync', () => previews.sync());
  register('reveal', reveal);
  register('toggleLibrary', () => library.toggle()); register('toggleSheets', () => sheets.toggle());
  register('newSheet', async (argument?: Location) => { await discovery; const bank = argument?.bank ?? await selectBank(banks); const uri = await newSheet(bank, argument?.bank ? argument.source : undefined); await scan(bank, sheets); const source = sheets.entries.find(item => path.join(bank.root, item.source) === uri.fsPath); if (source) { await revealSheet(source); } });
  register('newExercise', async (argument?: Location) => {
    await discovery;
    const bank = argument?.bank ?? await selectBank(banks.filter(bank => existsSync(path.join(bank.root, 'templates/exercice.typ'))));
    if (hasCatalogue(bank)) { await runner.run(bank, ['catalogue']); await load(bank); }
    const uri = await newExercise(bank, entries(), argument?.source);
    if (hasCatalogue(bank)) await runner.run(bank, ['catalogue']);
    await load(bank);
    await vscode.window.showTextDocument(uri);
  });
  for (const [name, direction] of [['memberUp', -1], ['memberDown', 1], ['memberRemove', undefined]] as const) register(name, async (argument: SheetMember | { member: SheetMember }) => { await sheetEditor.change('member' in argument ? argument.member : argument, direction); });
  register('addCurrent', async (argument?: BrowserNode) => {
    const source = await chooseSource(argument); if (!source) return;
    if (!library.entries.some(item => item.bank.root === source.bank.root && item.source === source.source)) throw new Error('Choisissez un exercice à ajouter.');
    let sheet = sheetEditor.target;
    if (!sheet || sheet.bank.root !== source.bank.root) {
      const picked = await vscode.window.showQuickPick(sheets.entries.filter(item => item.bank.root === source.bank.root && item.members).map(item => ({ label: item.metadata?.[0]?.titre ?? item.source, description: item.source, item })), { title: 'Choisir le document en cours' });
      if (!picked) return; sheet = picked.item; sheetEditor.selected = sheet;
    }
    await sheetEditor.add(source.bank, source.source, sheet.source);
    void vscode.window.showInformationMessage(`Ajouté à ${sheet.source}. Document enregistré.`);
  });
  for (const [suffix, browser] of [['Library', library], ['Sheets', sheets]] as const) register('newFolder' + suffix, async (argument?: Location) => {
    await discovery;
    const bank = argument?.bank ?? await selectBank(banks);
    const location = { bank, source: argument?.source ?? '' };
    await newFolder(location); await scan(location.bank, browser);
  });
  register('deleteSource', async (argument: BrowserNode) => {
    const source = await chooseSource(argument); if (!source || !await deleteSource(source)) return;
    previews.entries.get(`${source.bank.root}/${source.source}`)?.panel.dispose();
    if (sheetEditor.current?.bank.root === source.bank.root && sheetEditor.current.source === source.source) sheetEditor.current = undefined;
    if (sheetEditor.selected?.bank.root === source.bank.root && sheetEditor.selected.source === source.source) sheetEditor.selected = undefined;
    for (const browser of browsers) await scan(source.bank, browser);
  });
  let sheetTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(sheetEditor.changed.event(() => { clearTimeout(sheetTimer); sheetTimer = setTimeout(() => { for (const bank of banks) void scan(bank, sheets).catch(report); }, 120); }), { dispose: () => clearTimeout(sheetTimer) });
  context.subscriptions.push(runner, ...browsers, view, sheetView, previews, currentFile, sheetEditor, errorStatus,
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void discoverQueued().then(() => schedulePreparation()).catch(report); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('mpiExercices.bankPath')) void discoverQueued().catch(report); }),
    { dispose: () => { disposed = true; for (const watcher of watchers) watcher.dispose(); } });
  await discoverQueued();
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ scheme: 'file', pattern: '**/*.typ' }, new CodeLinks(() => banks)));
  schedulePreparation();
  return {
    getEntries: () => entries().map(({ bank, ex }) => ({ bank: bank.root, ...ex })),
    search: (query: string, filters: Filters = {}) => entries().filter(({ ex }) => matches(ex, query, filters)).map(({ ex }) => ex),
    previewCount: () => previews.entries.size,
    revealSheet: async (source: string) => { const item = sheets.entries.find(item => item.source === source); if (!item) throw new Error('Feuille introuvable'); await revealSheet(item); return sheetView.selection[0]; }
  };
}
