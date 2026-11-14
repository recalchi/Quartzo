import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GROUP_COLORS } from '../lib/settings';

/* -------------------------------------------------------------------------
 * Camada de sobreposições globais: menu de contexto, caixa de texto e
 * seletor de cor. Funcionam igual no navegador, no Electron (que não tem
 * window.prompt) e no Android.
 * ---------------------------------------------------------------------- */

export type MenuItem =
  | 'sep'
  | { label: string; icon?: string; hint?: string; run?: () => void; disabled?: boolean; danger?: boolean; checked?: boolean; submenu?: MenuItem[] };

type Overlay =
  | { kind: 'menu'; x: number; y: number; items: MenuItem[] }
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; ok: string; resolve: (v: string | null) => void }
  | { kind: 'color'; x: number; y: number; title: string; value: string | null; resolve: (v: string | null | undefined) => void };

let current: Overlay | null = null;
const subs = new Set<() => void>();
const set = (o: Overlay | null) => { current = o; subs.forEach((f) => f()); };

/** Abre um menu de contexto na posição do evento. */
export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) {
  e.preventDefault?.();
  set({ kind: 'menu', x: e.clientX, y: e.clientY, items });
}

/** Pede um texto ao usuário (substitui window.prompt). Resolve null se cancelar. */
export function askText(title: string, value = '', opts: { placeholder?: string; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => set({ kind: 'prompt', title, value, placeholder: opts.placeholder, ok: opts.ok ?? 'OK', resolve }));
}

/** Seletor de cor. Resolve a cor, null para "remover cor" ou undefined se cancelar. */
export function pickColor(at: { clientX: number; clientY: number }, title: string, value: string | null): Promise<string | null | undefined> {
  return new Promise((resolve) => set({ kind: 'color', x: at.clientX, y: at.clientY, title, value, resolve }));
}

export function Overlays() {
  const o = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => current);
  if (!o) return null;
  if (o.kind === 'menu') return <ContextMenu x={o.x} y={o.y} items={o.items} onClose={() => set(null)} />;
  if (o.kind === 'prompt') return <PromptBox o={o} />;
  return <ColorBox o={o} />;
}

/** Mantém um elemento flutuante dentro da janela. */
function useClamp(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6));
    const top = y + r.height > window.innerHeight - 6 ? Math.max(6, y - r.height) : y;
    setPos({ left, top });
  }, [x, y]);
  return { ref, pos };
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const { ref, pos } = useClamp(x, y);
  const [sub, setSub] = useState<{ i: number; top: number; left: number } | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); };
  }, [onClose]);

  const subItems = sub ? (items[sub.i] as Exclude<MenuItem, 'sep'>).submenu! : null;
  return (
    <div className="ctx-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} className="ctx-menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
        {items.map((it, i) => it === 'sep' ? <hr key={i} /> : (
          <button key={i} disabled={it.disabled} className={`${it.danger ? 'danger' : ''}${sub?.i === i ? ' open' : ''}`}
            onMouseEnter={(e) => {
              if (!it.submenu) return setSub(null);
              const r = e.currentTarget.getBoundingClientRect();
              setSub({ i, top: r.top - 6, left: r.right + 2 });
            }}
            onClick={(e) => {
              if (it.submenu) { const r = e.currentTarget.getBoundingClientRect(); setSub({ i, top: r.top - 6, left: r.right + 2 }); return; }
              onClose();
              it.run?.();
            }}>
            <span className="ctx-ico">{it.checked ? '✓' : it.icon ?? ''}</span>
            <span className="ctx-label">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
            {it.submenu && <span className="ctx-hint">›</span>}
          </button>
        ))}
      </div>
      {subItems && sub && <SubMenu items={subItems} top={sub.top} left={sub.left} onClose={onClose} />}
    </div>
  );
}

function SubMenu({ items, top, left, onClose }: { items: MenuItem[]; top: number; left: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top, left });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: left + r.width > window.innerWidth - 6 ? Math.max(6, left - r.width - 200) : left,
      top: Math.max(6, Math.min(top, window.innerHeight - r.height - 6)),
    });
  }, [top, left]);
  return (
    <div ref={ref} className="ctx-menu" style={pos} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) => it === 'sep' ? <hr key={i} /> : (
        <button key={i} disabled={it.disabled} className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.run?.(); }}>
          <span className="ctx-ico">{it.checked ? '✓' : it.icon ?? ''}</span>
          <span className="ctx-label">{it.label}</span>
          {it.hint && <span className="ctx-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function PromptBox({ o }: { o: Extract<Overlay, { kind: 'prompt' }> }) {
  const [v, setV] = useState(o.value);
  const done = (val: string | null) => { set(null); o.resolve(val); };
  return (
    <div className="modal-backdrop" onMouseDown={() => done(null)}>
      <form className="prompt-box" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); done(v.trim() || null); }}>
        <label>{o.title}</label>
        <input autoFocus value={v} placeholder={o.placeholder} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Escape' && done(null)} />
        <div className="row-btns">
          <button type="button" className="btn small ghost" onClick={() => done(null)}>Cancelar</button>
          <button type="submit" className="btn small primary">{o.ok}</button>
        </div>
      </form>
    </div>
  );
}

function ColorBox({ o }: { o: Extract<Overlay, { kind: 'color' }> }) {
  const { ref, pos } = useClamp(o.x, o.y);
  const done = (val: string | null | undefined) => { set(null); o.resolve(val); };
  const [custom, setCustom] = useState(o.value ?? '#5b9cf5');
  return (
    <div className="ctx-backdrop" onMouseDown={() => done(undefined)}>
      <div ref={ref} className="ctx-menu color-box" style={pos} onMouseDown={(e) => e.stopPropagation()}>
        <div className="color-title">{o.title}</div>
        <div className="swatches">
          {GROUP_COLORS.map((c) => (
            <button key={c} className={`swatch${o.value === c ? ' on' : ''}`} style={{ background: c }} onClick={() => done(c)} title={c} />
          ))}
          <label className="swatch custom" title="Cor personalizada">
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => custom !== o.value && done(custom)} />
          </label>
        </div>
        <div className="row-btns">
          {o.value && <button className="btn small ghost" onClick={() => done(null)}>Remover cor</button>}
          {custom !== (o.value ?? '#5b9cf5') && <button className="btn small primary" onClick={() => done(custom)}>Usar <i style={{ background: custom }} className="mini-dot" /></button>}
        </div>
      </div>
    </div>
  );
}
