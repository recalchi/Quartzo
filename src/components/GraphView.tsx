import { useEffect, useRef } from 'react';
import type { Note } from '../lib/db';
import type { VaultIndex } from '../lib/links';
import { titleOf } from '../lib/notes';

interface Props {
  notes: Note[];
  index: VaultIndex;
  activeId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}

interface Node { id: string; label: string; x: number; y: number; vx: number; vy: number; deg: number }

/** Grafo de conexões com simulação de forças simples em canvas (sem dependências). */
export function GraphView({ notes, index, activeId, onOpen, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0;
    const resize = () => {
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const nodes: Node[] = notes.map((n, i) => {
      const a = i * 2.39996;
      const r = 30 + 18 * Math.sqrt(i);
      return { id: n.id, label: titleOf(n.path), x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: [Node, Node][] = [];
    for (const [from, tos] of index.outgoing) {
      const a = byId.get(from);
      if (!a) continue;
      for (const t of tos) {
        const b = byId.get(t);
        if (b) { edges.push([a, b]); a.deg++; b.deg++; }
      }
    }

    const styles = getComputedStyle(document.documentElement);
    const colAccent = styles.getPropertyValue('--accent').trim() || '#a77bff';
    const colNode = styles.getPropertyValue('--muted').trim() || '#999';
    const colLine = styles.getPropertyValue('--border').trim() || '#444';
    const colText = styles.getPropertyValue('--text').trim() || '#eee';

    let scale = 1, ox = 0, oy = 0;
    let hover: Node | null = null;
    let drag: Node | null = null;
    let pan: { x: number; y: number } | null = null;
    let alpha = 1;
    let raf = 0;

    const toWorld = (px: number, py: number) => ({ x: (px - w / 2 - ox) / scale, y: (py - h / 2 - oy) / scale });
    const pick = (px: number, py: number) => {
      const p = toWorld(px, py);
      return nodes.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < (6 + n.deg) ** 2 + 30) ?? null;
    };

    const step = () => {
      {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy || 0.01;
            if (d2 > 160000) continue;
            const f = (3200 / d2) * alpha;
            const d = Math.sqrt(d2);
            dx /= d; dy /= d;
            a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
          }
          a.vx -= a.x * 0.004 * alpha; a.vy -= a.y * 0.004 * alpha;
        }
        for (const [a, b] of edges) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = ((d - 120) / d) * 0.05 * alpha;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const n of nodes) {
          if (n === drag) continue;
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += n.vx; n.y += n.vy;
        }
        alpha *= 0.992;
      }
    };
    // pré-assenta o layout para o grafo já abrir organizado
    for (let i = 0; i < 400; i++) step();
    alpha = 0.3;

    const tick = () => {
      if (alpha > 0.005) step();
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + ox, h / 2 + oy);
      ctx.scale(scale, scale);
      ctx.lineWidth = 1 / scale;
      for (const [a, b] of edges) {
        const hl = hover && (a === hover || b === hover);
        ctx.strokeStyle = hl ? colAccent : colLine;
        ctx.globalAlpha = hl ? 0.9 : 0.6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const r = 4 + Math.min(10, n.deg * 1.2);
        ctx.fillStyle = n.id === activeId || n === hover ? colAccent : colNode;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (scale > 0.6 || n === hover || n.id === activeId) {
          ctx.fillStyle = colText;
          ctx.globalAlpha = n === hover ? 1 : 0.75;
          ctx.font = `${12 / Math.max(scale, 0.8)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y + r + 13 / Math.max(scale, 0.8));
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let downAt = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      const p = pos(e); downAt = p;
      c.setPointerCapture(e.pointerId);
      drag = pick(p.x, p.y);
      if (!drag) pan = { x: p.x - ox, y: p.y - oy };
    };
    const move = (e: PointerEvent) => {
      const p = pos(e);
      if (drag) { const wp = toWorld(p.x, p.y); drag.x = wp.x; drag.y = wp.y; alpha = Math.max(alpha, 0.3); }
      else if (pan) { ox = p.x - pan.x; oy = p.y - pan.y; }
      else { hover = pick(p.x, p.y); c.style.cursor = hover ? 'pointer' : 'grab'; }
    };
    const up = (e: PointerEvent) => {
      const p = pos(e);
      const clicked = Math.abs(p.x - downAt.x) + Math.abs(p.y - downAt.y) < 5;
      if (clicked && drag) { onOpen(drag.id); onClose(); }
      drag = null; pan = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      scale = Math.min(4, Math.max(0.2, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
    };
  }, [notes, index, activeId, onOpen, onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="graph" onMouseDown={(e) => e.stopPropagation()}>
        <div className="graph-head">
          <b>Grafo</b> <span className="muted">{notes.length} notas · arraste, role para zoom, clique para abrir</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <canvas ref={canvas} />
      </div>
    </div>
  );
}
