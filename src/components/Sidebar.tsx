import { useMemo, useState } from 'react';
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
}

export function Sidebar({ notes, activeId, onOpen, onNewInFolder, filterTag, onClearTag, tagIds, showSync = true }: Props) {
  const [query, setQuery] = useState('');
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
            <div className="tree-row folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggle(f.path)}>
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
      <div className="tree">
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
                  <div key={`p-${n.id}`} className={`tree-row file${n.id === activeId ? ' active' : ''}`} style={{ paddingLeft: 14 }} onClick={() => onOpen(n.id)}>
                    <span className="name">📌 {titleOf(n.path)}</span>
                  </div>
                ))}
                <div className="section-label">Vault</div>
              </>
            )}
            {renderNode(tree, 0)}
          </>
        )}
      </div>
    </div>
  );
}
