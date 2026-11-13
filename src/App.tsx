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
import { openSpace, getDB, type Note } from './lib/db';
import {
  createNote, deleteNote, folderOf, openOrCreateDaily, renameNote, restoreNote, seedIfEmpty, titleOf, updateNote,
} from './lib/notes';
import { buildIndex, extractHeadings, resolveLink } from './lib/links';
import { renderMarkdown, toggleTask } from './lib/markdown';
import { SyncEngine, type SyncState } from './lib/sync';
import { download, exportZip, importFiles } from './lib/importExport';
import { MANAGE_URL } from './lib/firebase';

type Mode = 'edit' | 'preview' | 'split';
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

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

  const [activeId, setActiveId] = useState<string | null>(() => safeGet('quartzo.active'));
  const [mode, setMode] = useState<Mode>(() => (safeGet('quartzo.mode') as Mode) || 'edit');
  const [sidebar, setSidebar] = useState(() => !isMobile());
  const [panel, setPanel] = useState(() => !isMobile() && window.innerWidth > 1200);
  const [switcher, setSwitcher] = useState(false);
  const [graph, setGraph] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const editorView = useRef<EditorView | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const active = notes.find((n) => n.id === activeId) ?? null;

  useEffect(() => { if (activeId) safeSet('quartzo.active', activeId); }, [activeId]);
  useEffect(() => safeSet('quartzo.mode', mode), [mode]);
  // abre a nota mais recente se a ativa sumiu
  useEffect(() => {
    if (!active && notes.length) setActiveId([...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  }, [active, notes]);

  const open = useCallback((id: string) => {
    setActiveId((cur) => {
      if (cur && cur !== id) setHistory((h) => [...h.slice(-30), cur]);
      return id;
    });
    setShowTrash(false);
    if (isMobile()) setSidebar(false);
  }, []);

  const back = () => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) setActiveId(prev);
      return h.slice(0, -1);
    });
  };

  const create = useCallback(async (path = 'Sem título', content = '') => {
    const n = await createNote(path, content);
    open(n.id);
    engine.current?.schedulePush();
    setMode((m) => (m === 'preview' ? 'edit' : m));
    return n;
  }, [open, engine]);

  const openLink = useCallback(async (target: string) => {
    const hit = resolveLink(index, target);
    if (hit) open(hit.id);
    else await create(target, `# ${target}\n\n`);
  }, [index, open, create]);

  const daily = useCallback(async () => {
    const n = await openOrCreateDaily();
    open(n.id);
    engine.current?.schedulePush();
  }, [open, engine]);

  // Salvar conteúdo com debounce leve
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useCallback((value: string) => {
    if (!active) return;
    const id = active.id;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await updateNote(id, { content: value });
      engine.current?.schedulePush();
    }, 350);
  }, [active, engine]);

  const remove = async (n: Note) => {
    if (!confirm(`Mover “${titleOf(n.path)}” para a lixeira?`)) return;
    await deleteNote(n.id);
    engine.current?.schedulePush();
  };

  const commands: Command[] = useMemo(() => [
    { id: 'new', label: 'Nova nota', hint: 'Ctrl+N', run: () => void create() },
    { id: 'daily', label: 'Abrir nota do dia', hint: 'Ctrl+D', run: () => void daily() },
    { id: 'graph', label: 'Abrir grafo', hint: 'Ctrl+G', run: () => setGraph(true) },
    { id: 'mode-edit', label: 'Modo: edição', run: () => setMode('edit') },
    { id: 'mode-preview', label: 'Modo: leitura', run: () => setMode('preview') },
    { id: 'mode-split', label: 'Modo: lado a lado', run: () => setMode('split') },
    { id: 'import', label: 'Importar pasta de notas (.md / vault do Obsidian)', run: () => fileInput.current?.click() },
    { id: 'export', label: 'Exportar vault (.zip)', run: async () => download(await exportZip(), `quartzo-${new Date().toISOString().slice(0, 10)}.zip`) },
    { id: 'trash', label: 'Abrir lixeira', run: () => setShowTrash(true) },
    { id: 'theme', label: 'Alternar tema claro/escuro', run: toggleTheme },
    { id: 'logout', label: 'Sair da conta', run: onLogout },
  ], [create, daily, onLogout]);

  // Atalhos globais
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const actions: Record<string, () => void> = {
        p: () => setSwitcher(true),
        o: () => setSwitcher(true),
        n: () => void create(),
        e: () => setMode((m) => (m === 'edit' ? 'preview' : 'edit')),
        d: () => void daily(),
        g: () => setGraph(true),
        '\\': () => setSidebar((s) => !s),
      };
      const act = actions[k];
      if (!act || e.shiftKey || e.altKey) return;
      // fase de captura: tem prioridade sobre os atalhos internos do editor
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [create, daily]);

  // Botão voltar do Android
  useEffect(() => {
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', () => {
        if (switcher) setSwitcher(false);
        else if (graph) setGraph(false);
        else if (history.length) back();
        else void CapApp.minimizeApp();
      }).then((h) => (remove = () => void h.remove()));
    }).catch(() => void 0);
    return () => remove?.();
  }, [switcher, graph, history.length]);

  const html = useMemo(() => (active && mode !== 'edit' ? renderMarkdown(active.content, index) : ''), [active, mode, index]);

  const onPreviewClick = async (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const link = el.closest('a') as HTMLAnchorElement | null;
    if (el instanceof HTMLInputElement && el.dataset.task && active) {
      await updateNote(active.id, { content: toggleTask(active.content, Number(el.dataset.task)) });
      engine.current?.schedulePush();
      return;
    }
    if (!link) return;
    if (link.dataset.note) { e.preventDefault(); void openLink(link.dataset.note); }
    else if (link.dataset.tag) { e.preventDefault(); setFilterTag(link.dataset.tag); setSidebar(true); }
    else if (link.href && /^https?:/.test(link.href)) { e.preventDefault(); window.open(link.href, '_blank', 'noopener'); }
  };

  const headings = useMemo(() => (active ? extractHeadings(active.content) : []), [active]);
  const backlinks = active ? (index.backlinks.get(active.id) ?? []).map((id) => notes.find((n) => n.id === id)!).filter(Boolean) : [];
  const unresolved = active ? index.unresolved.get(active.id) ?? [] : [];
  const tagList = useMemo(() => [...index.tags.entries()].sort((a, b) => b[1].length - a[1].length), [index]);
  const tagIds = filterTag ? new Set(index.tags.get(filterTag) ?? []) : null;

  const goToLine = (line: number) => {
    const v = editorView.current;
    if (mode === 'preview') setMode('edit');
    setTimeout(() => {
      const view = editorView.current ?? v;
      if (!view) return;
      const pos = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    }, 30);
  };

  const words = active ? (active.content.match(/\S+/g)?.length ?? 0) : 0;

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
        <div className="brand"><Logo size={22} /><span>Quartzo</span></div>
        <button className="icon-btn" title="Voltar" disabled={!history.length} onClick={back}>←</button>
        <button className="search-pill" onClick={() => setSwitcher(true)}>🔍 <span>Buscar ou criar nota</span><kbd>Ctrl P</kbd></button>
        <div className="spacer" />
        <SyncBadge state={sync.s} detail={sync.d} />
        <button className="icon-btn" title="Nova nota (Ctrl+N)" onClick={() => void create()}>＋</button>
        <button className="icon-btn" title="Nota do dia (Ctrl+D)" onClick={() => void daily()}>📅</button>
        <button className="icon-btn" title="Grafo (Ctrl+G)" onClick={() => setGraph(true)}>🕸️</button>
        <button className="icon-btn hide-sm" title="Painel de conexões" onClick={() => setPanel((p) => !p)}>🔗</button>
        <div className="menu-wrap">
          <button className="icon-btn" title="Mais" onClick={() => setMenu((m) => !m)}>⋯</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)} onClick={() => setMenu(false)}>
              <div className="menu-account">{account}</div>
              <button onClick={() => fileInput.current?.click()}>📥 Importar pasta (.md / Obsidian)</button>
              <button onClick={async () => download(await exportZip(), `quartzo-${new Date().toISOString().slice(0, 10)}.zip`)}>📦 Exportar vault (.zip)</button>
              <button onClick={() => setShowTrash(true)}>🗑️ Lixeira ({trash.length})</button>
              <button onClick={toggleTheme}>🌓 Alternar tema</button>
              <button onClick={() => setPanel((p) => !p)}>🔗 Conexões e sumário</button>
              {MANAGE_URL && <button onClick={() => window.open(MANAGE_URL, '_blank', 'noopener')}>🏢 Abrir Recalchi Manage</button>}
              <hr />
              <button onClick={onLogout}>🚪 Sair</button>
            </div>
          )}
        </div>
      </header>

      <aside className="sidebar">
        <Sidebar
          notes={notes}
          activeId={activeId}
          onOpen={open}
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

      <main className="main">
        {showTrash ? (
          <div className="trash">
            <h2>🗑️ Lixeira</h2>
            {!trash.length && <p className="muted">A lixeira está vazia.</p>}
            {trash.map((n) => (
              <div key={n.id} className="trash-row">
                <span>{n.path}</span>
                <small className="muted">{new Date(n.updatedAt).toLocaleString('pt-BR')}</small>
                <button className="btn small" onClick={async () => { await restoreNote(n.id); engine.current?.schedulePush(); open(n.id); }}>Restaurar</button>
              </div>
            ))}
          </div>
        ) : active ? (
          <>
            <div className="note-head">
              <TitleInput key={active.id + active.path} note={active} onRename={async (p) => { await renameNote(active, p); engine.current?.schedulePush(); }} />
              <div className="modes">
                <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} title="Edição">✎</button>
                <button className={`hide-sm${mode === 'split' ? ' on' : ''}`} onClick={() => setMode('split')} title="Lado a lado">◫</button>
                <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')} title="Leitura (Ctrl+E)">👁</button>
                <button onClick={async () => { await updateNote(active.id, { pinned: active.pinned ? 0 : 1 }); engine.current?.schedulePush(); }} title="Fixar">{active.pinned ? '📌' : '📍'}</button>
                <button onClick={() => void remove(active)} title="Mover para a lixeira">🗑</button>
              </div>
            </div>
            <div className={`note-body mode-${mode}`}>
              {mode !== 'preview' && (
                <Editor
                  docId={active.id}
                  value={active.content}
                  titles={notes.map((n) => titleOf(n.path))}
                  onChange={onChange}
                  onReady={(v) => (editorView.current = v)}
                />
              )}
              {mode !== 'edit' && (
                <article className="preview markdown" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
              )}
            </div>
            <footer className="statusbar">
              <span>{folderOf(active.path) || 'Raiz'}</span>
              <span>{words} palavras</span>
              <span>{backlinks.length} backlinks</span>
              <span>Editado {new Date(active.updatedAt).toLocaleString('pt-BR')}</span>
            </footer>
          </>
        ) : (
          <div className="empty-state">
            <Logo size={80} />
            <p>Nenhuma nota aberta.</p>
            <button className="btn primary" onClick={() => void create()}>Criar nota</button>
          </div>
        )}
      </main>

      <aside className="panel">
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
        <QuickSwitcher notes={notes} commands={commands} onOpen={open} onCreate={(t) => void create(t, `# ${t}\n\n`)} onClose={() => setSwitcher(false)} />
      )}
      {graph && <GraphView notes={notes} index={index} activeId={activeId} onOpen={open} onClose={() => setGraph(false)} />}
    </div>
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
    local: ['💾', 'Somente neste dispositivo'],
    idle: ['☁️', 'Sincronizado'],
    syncing: ['🔄', 'Sincronizando…'],
    offline: ['📴', 'Offline — alterações salvas no aparelho'],
    error: ['⚠️', 'Erro de sincronização'],
  };
  const [icon, text] = map[state];
  return <span className={`sync sync-${state}`} title={detail ? `${text}: ${detail}` : text}>{icon}<span className="hide-sm"> {text}</span></span>;
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  safeSet('quartzo.theme', next);
}
(() => {
  const t = safeGet('quartzo.theme');
  if (t) document.documentElement.dataset.theme = t;
})();

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
