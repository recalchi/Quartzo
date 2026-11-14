import { useEffect, useMemo, useState } from 'react';
import type { Note } from '../lib/db';
import { folderOf, titleOf } from '../lib/notes';

interface TreeNode {
  name: string;
  path: string;
  folders: Map<string, TreeNode>;
  notes: Note[];
}

function buildTree(notes: Note[]): TreeNode {
  const root: TreeNode = { name: '', path: '', folders: new Map(), notes: [] };
  for (const n of notes) {
    const folder = folderOf(n.path);
    let node = root;
    if (folder) {
      let acc = '';
      for (const seg of folder.split('/')) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (!node.folders.has(seg)) node.folders.set(seg, { name: seg, path: acc, folders: new Map(), notes: [] });
        node = node.folders.get(seg)!;
      }
    }
    node.notes.push(n);
  }
  return root;
}

interface Props {
  notes: Note[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNewInFolder: (folder: string) => void;
  filterTag: string | null;
  onClearTag: () => void;
  tagIds: Set<string> | null;
  showSync?: boolean;
  onNoteMenu: (e: React.MouseEvent, n: Note) => void;
  onFolderMenu: (e: React.MouseEvent, folder: string) => void;
  onRootMenu: (e: React.MouseEvent) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
}

export function Sidebar({ notes, activeId, onOpen, onNewInFolder, filterTag, onClearTag, tagIds, showSync = true, onNoteMenu, onFolderMenu, onRootMenu, onNewNote, onNewFolder }: Props) {
  const [query, setQuery] = useState('');
  // "Buscar seleção no cofre" (menu do editor)
  useEffect(() => {
    const fn = (e: Event) => setQuery(String((e as CustomEvent).detail ?? ''));
    window.addEventListener('quartzo:search', fn);
    return () => window.removeEventListener('quartzo:search', fn);
  }, []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('quartzo.collapsed') || '{}');
    } catch {
      return {};
    }
  });

  const toggle = (p: string) =>
    setCollapsed((c) => {
      const next = { ...c, [p]: !c[p] };
      try {
        localStorage.setItem('quartzo.collapsed', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return notes
      .map((n) => {
        const title = titleOf(n.path).toLowerCase();
        const idx = n.content.toLowerCase().indexOf(q);
        const score = title.includes(q) ? 2 : idx >= 0 ? 1 : 0;
        const snippet = idx >= 0 ? n.content.slice(Math.max(0, idx - 30), idx + 60).replace(/\n/g, ' ') : '';
        return { n, score, snippet };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.n.updatedAt - a.n.updatedAt)
      .slice(0, 80);
  }, [q, notes]);

  const visible = tagIds ? notes.filter((n) => tagIds.has(n.id)) : notes;
  const pinned = visible.filter((n) => n.pinned);
  const tree = useMemo(() => buildTree(visible), [visible]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const files = [...node.notes].sort((a, b) => titleOf(a.path).localeCompare(titleOf(b.path), 'pt-BR'));
    return (
      <>
        {folders.map((f) => (
          <div key={f.path}>
            <div className="tree-row folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggle(f.path)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onFolderMenu(e, f.path); }}>
              <span className="chev">{collapsed[f.path] ? '▸' : '▾'}</span>
              <span className="name">{f.name}</span>
              <button className="icon-btn tiny" title="Nova nota aqui" onClick={(e) => { e.stopPropagation(); onNewInFolder(f.path); }}>＋</button>
            </div>
            {!collapsed[f.path] && renderNode(f, depth + 1)}
          </div>
        ))}
        {files.map((n) => (
          <div
            key={n.id}
            className={`tree-row file${n.id === activeId ? ' active' : ''}`}
            style={{ paddingLeft: 24 + depth * 14 }}
            onClick={() => onOpen(n.id)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onNoteMenu(e, n); }}
            title={n.path}
          >
            <span className="name">{titleOf(n.path)}</span>
            {showSync && !n.synced && <span className="dot" title="Aguardando sincronização" />}
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="sidebar-inner">
      <div className="side-actions">
        <button className="icon-btn tiny" title="Nova nota (Ctrl+N)" onClick={onNewNote}>＋</button>
        <button className="icon-btn tiny" title="Nova pasta" onClick={onNewFolder}>📁</button>
        <button className="icon-btn tiny" title="Recolher todas as pastas" onClick={() => {
          const all: Record<string, boolean> = {};
          for (const n of notes) { const f = folderOf(n.path); let acc = ''; for (const seg of f ? f.split('/') : []) { acc = acc ? `${acc}/${seg}` : seg; all[acc] = true; } }
          const anyOpen = Object.keys(all).some((k) => !collapsed[k]);
          const next = anyOpen ? all : {};
          setCollapsed(next);
          try { localStorage.setItem('quartzo.collapsed', JSON.stringify(next)); } catch { /* ignore */ }
        }}>⇕</button>
      </div>
      <div className="search">
        <input placeholder="Buscar em todas as notas…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <button className="icon-btn tiny" onClick={() => setQuery('')}>✕</button>}
      </div>
      {filterTag && (
        <div className="tag-filter">
          Filtrando <b>#{filterTag}</b>
          <button className="icon-btn tiny" onClick={onClearTag}>✕</button>
        </div>
      )}
      <div className="tree" onContextMenu={(e) => { e.preventDefault(); onRootMenu(e); }}>
        {results ? (
          results.length ? (
            results.map(({ n, snippet }) => (
              <div key={n.id} className={`search-hit${n.id === activeId ? ' active' : ''}`} onClick={() => onOpen(n.id)}>
                <div className="name">{titleOf(n.path)}</div>
                {snippet && <div className="snippet">…{snippet}…</div>}
              </div>
            ))
          ) : (
            <div className="empty">Nada encontrado.</div>
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="section-label">Fixadas</div>
                {pinned.map((n) => (
                  <div key={`p-${n.id}`} className={`tree-row file${n.id === activeId ? ' active' : ''}`} style={{ paddingLeft: 14 }} onClick={() => onOpen(n.id)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onNoteMenu(e, n); }}>
                    <span className="name">📌 {titleOf(n.path)}</span>
                  </div>
                ))}
                <div className="section-label">Notas</div>
              </>
            )}
            {renderNode(tree, 0)}
            {!notes.length && (
              <div className="empty">
                Este cofre está vazio.<br />
                <button className="btn small" style={{ marginTop: 8 }} onClick={onNewNote}>＋ Criar nota</button>
                <div className="small muted" style={{ marginTop: 8 }}>Dica: botão direito aqui para mais opções.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
