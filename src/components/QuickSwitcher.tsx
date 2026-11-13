import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../lib/db';
import { titleOf } from '../lib/notes';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  notes: Note[];
  commands: Command[];
  onOpen: (id: string) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}

/** Ctrl+P: abre notas por título; prefixo ">" lista comandos. */
export function QuickSwitcher({ notes, commands, onOpen, onCreate, onClose }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const isCmd = q.startsWith('>');
  const items = useMemo(() => {
    const term = (isCmd ? q.slice(1) : q).trim().toLowerCase();
    if (isCmd) {
      return commands
        .filter((c) => c.label.toLowerCase().includes(term))
        .map((c) => ({ key: c.id, label: c.label, hint: c.hint, act: c.run }));
    }
    const list = notes
      .filter((n) => !term || fuzzy(titleOf(n.path).toLowerCase(), term) || n.path.toLowerCase().includes(term))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map((n) => ({ key: n.id, label: titleOf(n.path), hint: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '', act: () => onOpen(n.id) }));
    if (term && !notes.some((n) => titleOf(n.path).toLowerCase() === term)) {
      list.push({ key: '__new', label: `Criar “${q.trim()}”`, hint: 'Enter', act: () => onCreate(q.trim()) });
    }
    return list;
  }, [q, notes, commands, isCmd, onOpen, onCreate]);

  useEffect(() => setSel(0), [q]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { it.act(); onClose(); } }
    else if (e.key === 'Escape') onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Buscar nota… (digite > para comandos)" />
        <div className="switcher-list">
          {items.map((it, i) => (
            <div key={it.key} className={`switcher-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { it.act(); onClose(); }}>
              <span>{it.label}</span>
              {it.hint && <span className="hint">{it.hint}</span>}
            </div>
          ))}
          {!items.length && <div className="empty">Nenhum resultado</div>}
        </div>
      </div>
    </div>
  );
}

function fuzzy(text: string, term: string) {
  let i = 0;
  for (const ch of text) if (ch === term[i]) i++;
  return i === term.length;
}
