import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { EditorView } from '@codemirror/view';
import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Logo } from './components/Logo';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { QuickSwitcher, type Command } from './components/QuickSwitcher';
import { GraphView } from './components/GraphView';
import { SettingsView } from './components/SettingsView';
import { openSpace, getDB, type Note } from './lib/db';
import {
  createNote, deleteNote, folderOf, openOrCreateDaily, renameNote, restoreNote, seedIfEmpty, titleOf, updateNote,
} from './lib/notes';
import { buildIndex, extractHeadings, resolveLink, type VaultIndex } from './lib/links';
import { renderMarkdown, toggleTask } from './lib/markdown';
import { SyncEngine, type SyncState } from './lib/sync';
import { download, exportZip, importFiles } from './lib/importExport';
import { MANAGE_URL } from './lib/firebase';
import { getSettings, setSettings } from './lib/settings';

type Mode = 'edit' | 'preview' | 'split';
type Tab =
  | { key: string; kind: 'note'; id: string; mode: Mode; back: string[] }
  | { key: string; kind: 'graph' }
  | { key: string; kind: 'trash' }
  | { key: string; kind: 'settings' };
interface Pane { tabs: Tab[]; active: string }
interface Layout { panes: Pane[]; focused: number }

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
const tabKey = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const api = useAuth();
  const { session } = api;

  if (session.kind === 'loading') {
    return (
      <div className="splash">
        <Logo size={72} />
      </div>
    );
  }
  if (session.kind === 'signed-out') return <Login api={api} />;

  const space = session.kind === 'user' ? session.user.uid : 'local';
  const label = session.kind === 'user' ? session.user.email ?? 'Conta Recalchi' : 'Somente neste dispositivo';
  return <Workspace key={space} space={space} uid={session.kind === 'user' ? session.user.uid : null} account={label} onLogout={api.logout} />;
}

function Workspace({ space, uid, account, onLogout }: { space: string; uid: string | null; account: string; onLogout: () => void }) {
  // abre o banco do espaço antes do primeiro render (o live query já nasce assinando o banco certo)
  useState(() => openSpace(space));
  const [sync, setSync] = useState<{ s: SyncState; d?: string }>({ s: uid ? 'idle' : 'local' });
  const engine = useRef<SyncEngine | null>(null);

  useEffect(() => {
    if (uid) {
      const e = new SyncEngine(uid);
      engine.current = e;
      const off = e.onState((s, d) => setSync({ s, d }));
      e.start();
      return () => { off(); e.stop(); };
    }
    void seedIfEmpty();
  }, [space, uid]);

  return <Shell account={account} onLogout={onLogout} sync={sync} engine={engine} />;
}

function loadLayout(): Layout {
  try {
    const l = JSON.parse(localStorage.getItem('quartzo.layout') || 'null') as Layout | null;
    if (l?.panes?.length) return l;
  } catch { /* ignore */ }
  return { panes: [{ tabs: [], active: '' }], focused: 0 };
}

function Shell({ account, onLogout, sync, engine }: {
  account: string;
  onLogout: () => void;
  sync: { s: SyncState; d?: string };
  engine: React.MutableRefObject<SyncEngine | null>;
}) {
  const db = getDB();
  const allNotes = useLiveQuery(() => db.notes.toArray(), [db], [] as Note[]);
  const notes = useMemo(() => allNotes.filter((n) => !n.deleted), [allNotes]);
  const trash = useMemo(() => allNotes.filter((n) => n.deleted).sort((a, b) => b.updatedAt - a.updatedAt), [allNotes]);
  const index = useMemo(() => buildIndex(notes), [notes]);
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [mobile, setMobile] = useState(isMobile);
  const [sidebar, setSidebar] = useState(() => !isMobile());
  const [panel, setPanel] = useState(() => !isMobile() && window.innerWidth > 1200);
  const [switcher, setSwitcher] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [lastNoteId, setLastNoteId] = useState<string | null>(() => safeGet('quartzo.active'));
  const editorViews = useRef(new Map<string, EditorView>());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const fn = () => setMobile(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  useEffect(() => safeSet('quartzo.layout', JSON.stringify(layout)), [layout]);

  const focusedPane = layout.panes[Math.min(layout.focused, layout.panes.length - 1)];
  const focusedTab = focusedPane.tabs.find((t) => t.key === focusedPane.active) ?? null;
  // nota "em foco": a da aba ativa, ou a última nota vista (quando o foco está no grafo)
  const activeId = focusedTab?.kind === 'note' ? focusedTab.id : lastNoteId;
  const active = activeId ? byId.get(activeId) ?? null : null;

  useEffect(() => {
    if (focusedTab?.kind === 'note') { setLastNoteId(focusedTab.id); safeSet('quartzo.active', focusedTab.id); }
  }, [focusedTab]);

  // remove abas de notas apagadas; se não sobrar nada, abre a mais recente
  useEffect(() => {
    if (!allNotes.length && !notes.length) return;
    setLayout((l) => {
      let changed = false;
      const panes = l.panes.map((p) => {
        const tabs = p.tabs.filter((t) => t.kind !== 'note' || byId.has(t.id));
        if (tabs.length !== p.tabs.length) changed = true;
        const activeKey = tabs.some((t) => t.key === p.active) ? p.active : tabs[tabs.length - 1]?.key ?? '';
        if (activeKey !== p.active) changed = true;
        return { tabs, active: activeKey };
      });
      const empty = panes.every((p) => !p.tabs.length);
      if (empty && notes.length) {
        const recent = byId.get(safeGet('quartzo.active') ?? '') ?? [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const t: Tab = { key: tabKey(), kind: 'note', id: recent.id, mode: (safeGet('quartzo.mode') as Mode) || 'edit', back: [] };
        return { panes: [{ tabs: [t], active: t.key }], focused: 0 };
      }
      const nonEmpty = panes.filter((p) => p.tabs.length);
      if (nonEmpty.length !== panes.length) changed = true;
      return changed ? { panes: nonEmpty.length ? nonEmpty : panes.slice(0, 1), focused: Math.min(l.focused, Math.max(0, nonEmpty.length - 1)) } : l;
    });
  }, [byId, notes, allNotes.length]);

  // ------------------------------------------------------------ navegação
  const updatePane = (pi: number, fn: (p: Pane) => Pane) =>
    setLayout((l) => ({ ...l, panes: l.panes.map((p, i) => (i === pi ? fn(p) : p)) }));

  const openTab = useCallback((tab: Tab, paneIndex?: number) => {
    setLayout((l) => {
      const pi = paneIndex ?? Math.min(l.focused, l.panes.length - 1);
      const panes = l.panes.map((p, i) => (i === pi ? { tabs: [...p.tabs, tab], active: tab.key } : p));
      return { panes, focused: pi };
    });
  }, []);

  /** Abre uma nota. Vindo do grafo, abre no painel ao lado (nota | grafo). */
  const open = useCallback((id: string, opts: { newTab?: boolean; fromGraph?: boolean } = {}) => {
    setLayout((l) => {
      let pi = Math.min(l.focused, l.panes.length - 1);
      if (opts.fromGraph && l.panes.length > 1) {
        const graphPane = l.panes.findIndex((p) => p.tabs.find((t) => t.key === p.active)?.kind === 'graph');
        if (graphPane >= 0) pi = graphPane === 0 ? 1 : 0;
      }
      const pane = l.panes[pi];
      const cur = pane.tabs.find((t) => t.key === pane.active);
      const existing = pane.tabs.find((t) => t.kind === 'note' && t.id === id);
      let next: Pane;
      if (existing) next = { ...pane, active: existing.key };
      else if (!opts.newTab && cur?.kind === 'note') {
        next = { ...pane, tabs: pane.tabs.map((t) => (t === cur ? { ...cur, id, back: [...cur.back.slice(-30), cur.id] } : t)) };
      } else {
        const t: Tab = { key: tabKey(), kind: 'note', id, mode: (safeGet('quartzo.mode') as Mode) || 'edit', back: [] };
        next = { tabs: [...pane.tabs, t], active: t.key };
      }
      return { panes: l.panes.map((p, i) => (i === pi ? next : p)), focused: pi };
    });
    if (isMobile()) setSidebar(false);
  }, []);

  const back = () => {
    if (focusedTab?.kind !== 'note' || !focusedTab.back.length) return;
    const prev = focusedTab.back[focusedTab.back.length - 1];
    updatePane(layout.focused, (p) => ({
      ...p,
      tabs: p.tabs.map((t) => (t.key === focusedTab.key && t.kind === 'note' ? { ...t, id: prev, back: t.back.slice(0, -1) } : t)),
    }));
  };

  const closeTab = (pi: number, key: string) => {
    setLayout((l) => {
      const p = l.panes[pi];
      const idx = p.tabs.findIndex((t) => t.key === key);
      const tabs = p.tabs.filter((t) => t.key !== key);
      if (!tabs.length && l.panes.length > 1) {
        return { panes: l.panes.filter((_, i) => i !== pi), focused: 0 };
      }
      const activeKey = p.active === key ? (tabs[idx] ?? tabs[idx - 1])?.key ?? '' : p.active;
      return { ...l, panes: l.panes.map((pp, i) => (i === pi ? { tabs, active: activeKey } : pp)) };
    });
  };

  /** Divide a tela: a aba escolhida vai para um novo painel à direita. */
  const splitWith = useCallback((tab: Tab) => {
    if (isMobile()) return openTab(tab);
    setLayout((l) => {
      if (l.panes.length >= 2) {
        const other = l.focused === 0 ? 1 : 0;
        const p = l.panes[other];
        return { panes: l.panes.map((pp, i) => (i === other ? { tabs: [...p.tabs, tab], active: tab.key } : pp)), focused: other };
      }
      return { panes: [...l.panes, { tabs: [tab], active: tab.key }], focused: 1 };
    });
  }, [openTab]);

  const openGraph = useCallback(() => {
    // se já existe uma aba de grafo, só traz ela para frente
    for (let pi = 0; pi < layout.panes.length; pi++) {
      const t = layout.panes[pi].tabs.find((x) => x.kind === 'graph');
      if (t) { updatePane(pi, (p) => ({ ...p, active: t.key })); setLayout((l) => ({ ...l, focused: pi })); return; }
    }
    splitWith({ key: tabKey(), kind: 'graph' });
  }, [layout, splitWith]);

  const openSingleton = (kind: 'trash' | 'settings') => {
    for (let pi = 0; pi < layout.panes.length; pi++) {
      const t = layout.panes[pi].tabs.find((x) => x.kind === kind);
      if (t) { updatePane(pi, (p) => ({ ...p, active: t.key })); setLayout((l) => ({ ...l, focused: pi })); return; }
    }
    openTab({ key: tabKey(), kind });
  };

  const create = useCallback(async (path = 'Sem título', content = '', newTab = false) => {
    const n = await createNote(path, content);
    open(n.id, { newTab });
    engine.current?.schedulePush();
    return n;
  }, [open, engine]);

  const openLink = useCallback(async (target: string, newTab = false) => {
    const hit = resolveLink(index, target);
    if (hit) open(hit.id, { newTab });
    else await create(target, `# ${target}\n\n`, newTab);
  }, [index, open, create]);

  const daily = useCallback(async () => {
    const n = await openOrCreateDaily();
    open(n.id);
    engine.current?.schedulePush();
  }, [open, engine]);

  // salvar com debounce por nota (dois painéis podem editar notas diferentes)
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onChange = useCallback((id: string, value: string) => {
    const timers = saveTimers.current;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(async () => {
      timers.delete(id);
      await updateNote(id, { content: value });
      engine.current?.schedulePush();
    }, 350));
  }, [engine]);

  const remove = async (n: Note) => {
    if (!confirm(`Mover “${titleOf(n.path)}” para a lixeira?`)) return;
    await deleteNote(n.id);
    engine.current?.schedulePush();
  };

  const setMode = (pi: number, key: string, mode: Mode) => {
    safeSet('quartzo.mode', mode);
    updatePane(pi, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.key === key && t.kind === 'note' ? { ...t, mode } : t)) }));
  };

  const toggleTheme = () => {
    const cur = document.documentElement.dataset.theme;
    setSettings({ theme: cur === 'light' ? 'dark' : 'light' });
  };

  const exportVault = async () => download(await exportZip(), `quartzo-${new Date().toISOString().slice(0, 10)}.zip`);

  const commands: Command[] = useMemo(() => [
    { id: 'new', label: 'Nova nota', hint: 'Ctrl+N', run: () => void create() },
    { id: 'new-tab', label: 'Nova nota em nova aba', hint: 'Ctrl+T', run: () => void create('Sem título', '', true) },
    { id: 'daily', label: 'Abrir nota do dia', hint: 'Ctrl+D', run: () => void daily() },
    { id: 'graph', label: 'Abrir grafo ao lado', hint: 'Ctrl+G', run: openGraph },
    { id: 'split', label: 'Dividir à direita (nota atual)', run: () => activeId && splitWith({ key: tabKey(), kind: 'note', id: activeId, mode: 'preview', back: [] }) },
    { id: 'import', label: 'Importar pasta de notas (.md / vault do Obsidian)', run: () => fileInput.current?.click() },
    { id: 'export', label: 'Exportar vault (.zip)', run: () => void exportVault() },
    { id: 'trash', label: 'Abrir lixeira', run: () => openSingleton('trash') },
    { id: 'settings', label: 'Configurações e aparência', run: () => openSingleton('settings') },
    { id: 'theme', label: 'Alternar tema claro/escuro', run: toggleTheme },
    { id: 'logout', label: 'Sair da conta', run: onLogout },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [create, daily, onLogout, openGraph, activeId, splitWith]);

  // Atalhos globais (fase de captura: prioridade sobre os atalhos do editor)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const actions: Record<string, () => void> = {
        p: () => setSwitcher(true),
        o: () => setSwitcher(true),
        n: () => void create(),
        t: () => void create('Sem título', '', true),
        d: () => void daily(),
        g: openGraph,
        ',': () => openSingleton('settings'),
        w: () => focusedTab && closeTab(layout.focused, focusedTab.key),
        '\\': () => setSidebar((s) => !s),
        e: () => focusedTab?.kind === 'note' && setMode(layout.focused, focusedTab.key, focusedTab.mode === 'edit' ? 'preview' : 'edit'),
      };
      const act = actions[k];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Botão voltar do Android
  useEffect(() => {
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', () => {
        if (switcher) setSwitcher(false);
        else if (sidebar && isMobile()) setSidebar(false);
        else if (focusedTab?.kind === 'note' && focusedTab.back.length) back();
        else if (focusedTab && focusedPane.tabs.length > 1) closeTab(layout.focused, focusedTab.key);
        else void CapApp.minimizeApp();
      }).then((h) => (remove = () => void h.remove()));
    }).catch(() => void 0);
    return () => remove?.();
  });

  const headings = useMemo(() => (active ? extractHeadings(active.content) : []), [active]);
  const backlinks = active ? (index.backlinks.get(active.id) ?? []).map((id) => byId.get(id)!).filter(Boolean) : [];
  const unresolved = active ? index.unresolved.get(active.id) ?? [] : [];
  const tagList = useMemo(() => [...index.tags.entries()].sort((a, b) => b[1].length - a[1].length), [index]);
  const tagIds = filterTag ? new Set(index.tags.get(filterTag) ?? []) : null;

  const goToLine = (line: number) => {
    const pi = layout.panes.findIndex((p) => p.tabs.find((t) => t.key === p.active && t.kind === 'note' && t.id === activeId));
    const pane = layout.panes[pi];
    const tab = pane?.tabs.find((t) => t.key === pane.active);
    if (!tab || tab.kind !== 'note') return;
    if (tab.mode === 'preview') setMode(pi, tab.key, 'edit');
    setTimeout(() => {
      const view = editorViews.current.get(tab.key);
      if (!view) return;
      const pos = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    }, 40);
  };

  const graphOpen = (id: string, newTab: boolean) => open(id, { newTab, fromGraph: true });
  const visiblePanes = mobile ? [layout.panes[Math.min(layout.focused, layout.panes.length - 1)]] : layout.panes;

  return (
    <div className={`app${sidebar ? ' with-sidebar' : ''}${panel ? ' with-panel' : ''}`}>
      <input ref={fileInput} type="file" multiple hidden
        // @ts-expect-error atributo não padronizado, suportado por Chromium/WebView
        webkitdirectory=""
        onChange={async (e) => {
          if (!e.target.files?.length) return;
          const n = await importFiles(e.target.files);
          engine.current?.schedulePush();
          alert(`${n} nota(s) importada(s).`);
          e.target.value = '';
        }} />

      <header className="topbar">
        <button className="icon-btn" title="Painel lateral (Ctrl+\)" onClick={() => setSidebar((s) => !s)}>☰</button>
        <div className="brand"><Logo size={20} /><span>Quartzo</span></div>
        <button className="icon-btn" title="Voltar" disabled={focusedTab?.kind !== 'note' || !focusedTab.back.length} onClick={back}>←</button>
        <button className="search-pill" onClick={() => setSwitcher(true)}>⌕ <span>Buscar ou criar nota</span><kbd>Ctrl P</kbd></button>
        <div className="spacer" />
        <SyncBadge state={sync.s} detail={sync.d} />
        <button className="icon-btn" title="Nova nota (Ctrl+N)" onClick={() => void create()}>＋</button>
        <button className="icon-btn" title="Nota do dia (Ctrl+D)" onClick={() => void daily()}>📅</button>
        <button className="icon-btn" title="Grafo ao lado (Ctrl+G)" onClick={openGraph}><GraphIcon /></button>
        <button className="icon-btn hide-sm" title="Painel de conexões" onClick={() => setPanel((p) => !p)}>⫶</button>
        <div className="menu-wrap">
          <button className="icon-btn" title="Mais" onClick={() => setMenu((m) => !m)}>⋯</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)} onClick={() => setMenu(false)}>
              <div className="menu-account">{account}</div>
              <button onClick={() => openSingleton('settings')}>⚙ Configurações e aparência</button>
              <button onClick={() => fileInput.current?.click()}>📥 Importar pasta (.md / Obsidian)</button>
              <button onClick={() => void exportVault()}>📦 Exportar vault (.zip)</button>
              <button onClick={() => openSingleton('trash')}>🗑 Lixeira ({trash.length})</button>
              <button onClick={toggleTheme}>◐ Alternar tema</button>
              {MANAGE_URL && <button onClick={() => window.open(MANAGE_URL, '_blank', 'noopener')}>🏢 Abrir Recalchi Manage</button>}
              <hr />
              <button onClick={onLogout}>⎋ Sair</button>
            </div>
          )}
        </div>
      </header>

      <aside className="sidebar">
        <Sidebar
          notes={notes}
          activeId={activeId}
          onOpen={(id) => open(id)}
          onNewInFolder={(f) => void create(`${f}/Sem título`)}
          filterTag={filterTag}
          onClearTag={() => setFilterTag(null)}
          tagIds={tagIds}
          showSync={sync.s !== 'local'}
        />
        {tagList.length > 0 && (
          <div className="tags-cloud">
            {tagList.slice(0, 30).map(([t, ids]) => (
              <button key={t} className={`chip${filterTag === t ? ' on' : ''}`} onClick={() => setFilterTag(filterTag === t ? null : t)}>
                #{t} <small>{ids.length}</small>
              </button>
            ))}
          </div>
        )}
      </aside>
      {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}

      <main className={`main panes-${visiblePanes.length}`}>
        {visiblePanes.map((pane) => {
          const pi = layout.panes.indexOf(pane);
          const tab = pane.tabs.find((t) => t.key === pane.active) ?? null;
          return (
            <section key={pi} className={`pane${pi === layout.focused ? ' focused' : ''}`} onMouseDown={() => layout.focused !== pi && setLayout((l) => ({ ...l, focused: pi }))}>
              <div className="tabbar">
                <div className="tabs">
                  {/* no celular só um painel aparece: a barra mostra as abas de todos */}
                  {(mobile ? layout.panes.flatMap((p, i) => p.tabs.map((t) => ({ t, ti: i }))) : pane.tabs.map((t) => ({ t, ti: pi }))).map(({ t, ti }) => (
                    <div key={t.key} className={`tab${t.key === layout.panes[ti].active && ti === pi ? ' on' : ''}`}
                      onClick={() => setLayout((l) => ({ panes: l.panes.map((p, i) => (i === ti ? { ...p, active: t.key } : p)), focused: ti }))}
                      onAuxClick={(e) => e.button === 1 && closeTab(ti, t.key)}>
                      <span className="tab-ico">{t.kind === 'graph' ? <GraphIcon /> : t.kind === 'trash' ? '🗑' : t.kind === 'settings' ? '⚙' : ''}</span>
                      <span className="tab-title">{tabTitle(t, byId)}</span>
                      <button className="tab-x" onClick={(e) => { e.stopPropagation(); closeTab(ti, t.key); }}>×</button>
                    </div>
                  ))}
                  <button className="tab-new" title="Nova aba (Ctrl+T)" onClick={() => { setLayout((l) => ({ ...l, focused: pi })); void create('Sem título', '', true); }}>＋</button>
                </div>
                {!mobile && (
                  <button className="icon-btn tiny" title="Dividir à direita" onClick={() => tab && splitWith({ ...tab, key: tabKey() } as Tab)}>◫</button>
                )}
              </div>
              <div className="pane-body">
                {tab?.kind === 'note' && byId.get(tab.id) && (
                  <NotePane
                    key={tab.key + tab.id}
                    note={byId.get(tab.id)!}
                    mode={tab.mode}
                    index={index}
                    titles={notes.map((n) => titleOf(n.path))}
                    onMode={(m) => setMode(pi, tab.key, m)}
                    onChange={onChange}
                    onRename={async (n, p) => { await renameNote(n, p); engine.current?.schedulePush(); }}
                    onTogglePin={async (n) => { await updateNote(n.id, { pinned: n.pinned ? 0 : 1 }); engine.current?.schedulePush(); }}
                    onDelete={remove}
                    onOpenLink={openLink}
                    onTag={(t) => { setFilterTag(t); setSidebar(true); }}
                    onEditorReady={(v) => editorViews.current.set(tab.key, v)}
                    backlinkCount={(index.backlinks.get(tab.id) ?? []).length}
                    onSaveTask={async (n, i) => { await updateNote(n.id, { content: toggleTask(n.content, i) }); engine.current?.schedulePush(); }}
                  />
                )}
                {tab?.kind === 'graph' && <GraphView notes={notes} index={index} activeId={lastNoteId} onOpen={graphOpen} />}
                {tab?.kind === 'trash' && (
                  <div className="trash">
                    <h2>Lixeira</h2>
                    {!trash.length && <p className="muted">A lixeira está vazia.</p>}
                    {trash.map((n) => (
                      <div key={n.id} className="trash-row">
                        <span>{n.path}</span>
                        <small className="muted">{new Date(n.updatedAt).toLocaleString('pt-BR')}</small>
                        <button className="btn small" onClick={async () => { await restoreNote(n.id); engine.current?.schedulePush(); open(n.id, { newTab: true }); }}>Restaurar</button>
                      </div>
                    ))}
                  </div>
                )}
                {tab?.kind === 'settings' && (
                  <SettingsView account={account} sync={sync.s} onImport={() => fileInput.current?.click()} onExport={() => void exportVault()} onLogout={onLogout} noteCount={notes.length} />
                )}
                {!tab && (
                  <div className="empty-state">
                    <Logo size={64} />
                    <p>Nenhuma aba aberta.</p>
                    <button className="btn primary" onClick={() => void create()}>Criar nota</button>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </main>

      <aside className="panel">
        <section className="local-graph">
          <h4>Grafo local</h4>
          {active ? <GraphView notes={notes} index={index} activeId={active.id} onOpen={(id, nt) => open(id, { newTab: nt })} local /> : <p className="muted small">Abra uma nota.</p>}
        </section>
        <section>
          <h4>Sumário</h4>
          {headings.length ? headings.map((h, i) => (
            <div key={i} className="outline-item" style={{ paddingLeft: (h.level - 1) * 12 }} onClick={() => goToLine(h.line)}>{h.text}</div>
          )) : <p className="muted small">Sem títulos.</p>}
        </section>
        <section>
          <h4>Backlinks <small>{backlinks.length}</small></h4>
          {backlinks.length ? backlinks.map((n) => (
            <div key={n.id} className="link-item" onClick={() => open(n.id)}>{titleOf(n.path)}</div>
          )) : <p className="muted small">Nenhuma nota aponta para esta.</p>}
        </section>
        {unresolved.length > 0 && (
          <section>
            <h4>Links sem nota</h4>
            {unresolved.map((t) => (
              <div key={t} className="link-item unresolved" onClick={() => void openLink(t)}>＋ {t}</div>
            ))}
          </section>
        )}
      </aside>

      {switcher && (
        <QuickSwitcher notes={notes} commands={commands} onOpen={(id) => open(id)} onCreate={(t) => void create(t, `# ${t}\n\n`)} onClose={() => setSwitcher(false)} />
      )}
    </div>
  );
}

function tabTitle(t: Tab, byId: Map<string, Note>) {
  if (t.kind === 'graph') return 'Grafo';
  if (t.kind === 'trash') return 'Lixeira';
  if (t.kind === 'settings') return 'Configurações';
  const n = byId.get(t.id);
  return n ? titleOf(n.path) : '…';
}

interface NotePaneProps {
  note: Note;
  mode: Mode;
  index: VaultIndex;
  titles: string[];
  backlinkCount: number;
  onMode: (m: Mode) => void;
  onChange: (id: string, v: string) => void;
  onRename: (n: Note, path: string) => void;
  onTogglePin: (n: Note) => void;
  onDelete: (n: Note) => void;
  onOpenLink: (target: string, newTab: boolean) => void;
  onTag: (t: string) => void;
  onEditorReady: (v: EditorView) => void;
  onSaveTask: (n: Note, i: number) => void;
}

function NotePane({ note, mode, index, titles, backlinkCount, onMode, onChange, onRename, onTogglePin, onDelete, onOpenLink, onTag, onEditorReady, onSaveTask }: NotePaneProps) {
  const html = useMemo(() => (mode !== 'edit' ? renderMarkdown(note.content, index) : ''), [note.content, mode, index]);
  const words = note.content.match(/\S+/g)?.length ?? 0;

  const onPreviewClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.dataset.task) { onSaveTask(note, Number(el.dataset.task)); return; }
    const link = el.closest('a') as HTMLAnchorElement | null;
    if (!link) return;
    if (link.dataset.note) { e.preventDefault(); onOpenLink(link.dataset.note, e.ctrlKey || e.metaKey); }
    else if (link.dataset.tag) { e.preventDefault(); onTag(link.dataset.tag); }
    else if (link.href && /^https?:/.test(link.href)) { e.preventDefault(); window.open(link.href, '_blank', 'noopener'); }
  };

  return (
    <>
      <div className="note-head">
        <TitleInput key={note.id + note.path} note={note} onRename={(p) => onRename(note, p)} />
        <div className="modes">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => onMode('edit')} title="Edição">✎</button>
          <button className={`hide-sm${mode === 'split' ? ' on' : ''}`} onClick={() => onMode('split')} title="Edição + leitura">◧</button>
          <button className={mode === 'preview' ? 'on' : ''} onClick={() => onMode('preview')} title="Leitura (Ctrl+E)">👁</button>
          <button onClick={() => onTogglePin(note)} title={note.pinned ? 'Desafixar' : 'Fixar'}>{note.pinned ? '★' : '☆'}</button>
          <button onClick={() => onDelete(note)} title="Mover para a lixeira">🗑</button>
        </div>
      </div>
      <div className={`note-body mode-${mode}`}>
        {mode !== 'preview' && (
          <Editor docId={note.id} value={note.content} titles={titles} onChange={(v) => onChange(note.id, v)} onReady={onEditorReady} />
        )}
        {mode !== 'edit' && <article className="preview markdown" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
      <footer className="statusbar">
        <span>{folderOf(note.path) || 'Raiz'}</span>
        <span>{words} palavras</span>
        <span>{backlinkCount} backlinks</span>
        <span>Editado {new Date(note.updatedAt).toLocaleString('pt-BR')}</span>
      </footer>
    </>
  );
}

function TitleInput({ note, onRename }: { note: Note; onRename: (path: string) => void }) {
  const [v, setV] = useState(titleOf(note.path));
  const commit = () => {
    const t = v.trim();
    if (!t || t === titleOf(note.path)) return setV(titleOf(note.path));
    const folder = folderOf(note.path);
    onRename(folder ? `${folder}/${t}` : t);
  };
  return (
    <input className="title-input" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(titleOf(note.path)); }}
      title="Renomear (use / para mover para pasta)" />
  );
}

function SyncBadge({ state, detail }: { state: SyncState; detail?: string }) {
  const map: Record<SyncState, [string, string]> = {
    local: ['●', 'Somente neste dispositivo'],
    idle: ['●', 'Sincronizado'],
    syncing: ['◌', 'Sincronizando…'],
    offline: ['○', 'Offline — salvo no aparelho'],
    error: ['▲', 'Erro de sincronização'],
  };
  const [icon, text] = map[state];
  return <span className={`sync sync-${state}`} title={detail ? `${text}: ${detail}` : text}>{icon}<span className="hide-sm"> {text}</span></span>;
}

function GraphIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="8" r="2.4" /><circle cx="9" cy="18" r="2.4" /><circle cx="19" cy="19" r="1.6" />
      <path d="M8 7l8 1M7 8l1.6 7.6M11 17l6-7.5M11.2 18.4l6.3.5" />
    </svg>
  );
}

// tema aplicado na carga (settings.ts já aplica; aqui só garantimos compatibilidade com a versão anterior)
(() => {
  const t = safeGet('quartzo.theme');
  if (t && !localStorage.getItem('quartzo.settings')) setSettings({ theme: t as 'dark' | 'light' });
  void getSettings();
})();

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
