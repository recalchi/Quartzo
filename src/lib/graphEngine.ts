import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GraphSettings } from './settings';

export type NodeKind = 'note' | 'tag' | 'missing';

export interface GNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  radius: number;
  color: string | null; // cor de grupo (null = padrão do tema)
  createdAt: number;
  // estado visual (animado)
  focus: number; // 0..1 (esmaece quando outro nó está em foco)
  appear: number; // 0..1 (animação de entrada)
  appearAt: number; // timestamp em que começa a surgir
  bornAt?: number; // nó recém-criado: anel de destaque por alguns segundos
}

export interface GLink extends SimulationLinkDatum<GNode> {
  source: string | GNode;
  target: string | GNode;
}

export interface GraphData {
  nodes: Omit<GNode, 'focus' | 'appear' | 'appearAt' | 'x' | 'y' | 'vx' | 'vy'>[];
  links: { source: string; target: string }[];
}

interface Palette {
  bg: string;
  node: string;
  tag: string;
  missing: string;
  line: string;
  lineHi: string;
  text: string;
  active: string;
  ring: string;
}

const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Motor do grafo em canvas: simulação de forças (d3-force), zoom/pan (mouse,
 * roda e pinça), arrastar nós com "fios" elásticos, foco por vizinhança,
 * rótulos que surgem com o zoom e animação de crescimento do vault.
 */
export class GraphEngine {
  private ctx: CanvasRenderingContext2D;
  private sim: Simulation<GNode, GLink>;
  private nodes: GNode[] = [];
  private links: GLink[] = [];
  private byId = new Map<string, GNode>();
  private neighbors = new Map<string, Set<string>>();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private hover: GNode | null = null;
  private drag: GNode | null = null;
  private dragMoved = false;
  private pan: { x: number; y: number; tx: number; ty: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; scale: number } | null = null;
  private raf = 0;
  private palette!: Palette;
  private ro: ResizeObserver;
  private fitted = false;
  private followMoving = false;
  private followSince = 0;
  /** enquanto o usuário não mexe no zoom/pan, o grafo se enquadra sozinho */
  private userMoved = false;
  private _active: string | null = null;
  /** nota aberta: se estiver fora da tela, o grafo desliza até ela */
  private follow: string | null = null;
  get activeId() { return this._active; }
  set activeId(id: string | null) {
    if (id !== this._active) { this.follow = id; this.followSince = performance.now(); }
    this._active = id;
  }
  settings: GraphSettings;
  onOpen: (id: string, newTab: boolean) => void = () => {};
  /** avisa quantos nós de nota estão fora da área visível */
  onOffscreen: (count: number) => void = () => {};
  private lastOff = -1;
  private offCheck = 0;

  constructor(private canvas: HTMLCanvasElement, settings: GraphSettings) {
    this.ctx = canvas.getContext('2d')!;
    this.settings = settings;
    this.refreshPalette();
    this.sim = forceSimulation<GNode, GLink>([])
      .alphaDecay(0.0228)
      .velocityDecay(0.42)
      .on('tick', () => void 0);
    this.applyForces();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bind();
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.sim.stop();
    this.ro.disconnect();
    this.unbind();
  }

  refreshPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    this.palette = {
      bg: v('--graph-bg', '#1e1e1e'),
      node: this.settings.nodeColor || v('--graph-node', '#9a9a9a'),
      tag: this.settings.tagNodeColor || v('--graph-tag', '#6fb58a'),
      missing: v('--graph-missing', '#555555'),
      line: v('--graph-line', '#3a3a3a'),
      lineHi: v('--accent', '#a3a3a3'),
      text: v('--graph-text', '#dadada'),
      active: v('--graph-active', v('--accent', '#ffffff')),
      ring: v('--text', '#ffffff'),
    };
  }

  // ------------------------------------------------------------- dados
  setData(data: GraphData) {
    const now = performance.now();
    const old = this.byId;
    const first = old.size === 0;
    this.byId = new Map();
    // vizinhos já posicionados: um nó novo nasce ao lado deles (ou no centro da tela)
    const near = new Map<string, GNode>();
    for (const l of data.links) {
      const a = old.get(l.source), b = old.get(l.target);
      if (a && !old.has(l.target)) near.set(l.target, a);
      if (b && !old.has(l.source)) near.set(l.source, b);
    }
    const viewX = this.scale ? -this.tx / this.scale : 0;
    const viewY = this.scale ? -this.ty / this.scale : 0;
    this.nodes = data.nodes.map((n) => {
      const prev = old.get(n.id);
      const anchor = near.get(n.id);
      const spread = first ? 80 : 40 / Math.max(this.scale, 0.3);
      const node: GNode = prev
        ? Object.assign(prev, n)
        : {
            ...n,
            focus: 1,
            appear: 0,
            appearAt: now + (first ? Math.random() * 350 : 0),
            bornAt: first ? undefined : now,
            x: (first ? 0 : anchor?.x ?? viewX) + (Math.random() - 0.5) * spread,
            y: (first ? 0 : anchor?.y ?? viewY) + (Math.random() - 0.5) * spread,
          };
      this.byId.set(n.id, node);
      return node;
    });
    this.links = data.links
      .filter((l) => this.byId.has(l.source) && this.byId.has(l.target))
      .map((l) => ({ source: l.source, target: l.target }));
    this.neighbors = new Map(this.nodes.map((n) => [n.id, new Set<string>()]));
    for (const l of this.links) {
      this.neighbors.get(l.source as string)!.add(l.target as string);
      this.neighbors.get(l.target as string)!.add(l.source as string);
    }
    this.sim.nodes(this.nodes);
    (this.sim.force('link') as ReturnType<typeof forceLink<GNode, GLink>>).links(this.links);
    this.sim.alpha(first ? 1 : 0.5).restart();
    // nota nova entrou: volta a enquadrar tudo para ela não nascer fora da tela
    const added = !first && data.nodes.some((n) => !old.has(n.id));
    if (first || added) { if (first) this.fitted = false; this.userMoved = false; }
  }

  applyForces() {
    const s = this.settings;
    this.sim
      .force(
        'link',
        forceLink<GNode, GLink>(this.links)
          .id((d) => d.id)
          .distance(30 + s.linkDistance * 0.28)
          .strength(clamp(s.linkForce, 0, 1) * 0.7),
      )
      .force('charge', forceManyBody<GNode>().strength(-s.repelForce * 22).distanceMax(900))
      .force('x', forceX<GNode>(0).strength(s.centerForce * 0.16))
      .force('y', forceY<GNode>(0).strength(s.centerForce * 0.16))
      .force('collide', forceCollide<GNode>((d) => d.radius + 3).strength(0.7));
    this.sim.alpha(Math.max(this.sim.alpha(), 0.3)).restart();
  }

  /** "Varinha mágica": o vault cresce do centro, nota a nota, em ordem de criação. */
  animate() {
    this.userMoved = false;
    const sorted = [...this.nodes].sort((a, b) => a.createdAt - b.createdAt);
    const start = performance.now();
    const step = clamp(5000 / Math.max(1, sorted.length), 25, 160);
    sorted.forEach((n, i) => {
      n.appear = 0;
      n.appearAt = start + i * step;
      n.x = (Math.random() - 0.5) * 20;
      n.y = (Math.random() - 0.5) * 20;
      n.vx = n.vy = 0;
    });
    this.sim.alpha(1).alphaTarget(0.25).restart();
    setTimeout(() => this.sim.alphaTarget(0), sorted.length * step + 800);
  }

  private fitTarget() {
    if (!this.nodes.length || this.w < 10 || this.h < 10) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      const r = n.radius * this.settings.nodeSize;
      const half = Math.max(r, n.label.length * 3.6); // meia largura aproximada do rótulo
      minX = Math.min(minX, n.x! - half); maxX = Math.max(maxX, n.x! + half);
      minY = Math.min(minY, n.y! - r); maxY = Math.max(maxY, n.y! + r + 16);
    }
    const pad = Math.min(60, Math.min(this.w, this.h) * 0.12);
    const sx = (this.w - pad * 2) / Math.max(1, maxX - minX);
    const sy = (this.h - pad * 2) / Math.max(1, maxY - minY);
    const scale = clamp(Math.min(sx, sy), 0.15, 1.8);
    return { scale, tx: -((minX + maxX) / 2) * scale, ty: -((minY + maxY) / 2) * scale };
  }

  /** Centraliza o grafo (botão ⤢) e volta ao enquadramento automático. */
  fit() {
    const t = this.fitTarget();
    if (!t) return;
    this.userMoved = false;
    this.scale = t.scale; this.tx = t.tx; this.ty = t.ty;
  }

  zoomBy(f: number) {
    this.userMoved = true;
    this.scale = clamp(this.scale * f, 0.08, 6);
  }

  // ------------------------------------------------------------- render
  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, this.w * this.dpr);
    this.canvas.height = Math.max(1, this.h * this.dpr);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    // segue a nota aberta quando ela sai da área visível (com zoom/pan manual)
    if (this.follow && this.userMoved && !this.drag && !this.pan) {
      const n = this.byId.get(this.follow);
      // a nota pode chegar alguns instantes depois (acabou de ser criada)
      if (!n || n.x === undefined) { if (performance.now() - this.followSince > 2500) this.follow = null; }
      else {
        const sx = this.w / 2 + this.tx + n.x * this.scale;
        const sy = this.h / 2 + this.ty + n.y! * this.scale;
        const m = 50;
        const out = sx < m || sy < m || sx > this.w - m || sy > this.h - m;
        if (out || this.followMoving) {
          this.followMoving = true;
          const gx = -n.x * this.scale, gy = -n.y! * this.scale;
          this.tx += (gx - this.tx) * 0.12;
          this.ty += (gy - this.ty) * 0.12;
          if (Math.hypot(gx - this.tx, gy - this.ty) < 2) { this.follow = null; this.followMoving = false; }
        } else this.follow = null;
      }
    }
    // enquadramento automático e suave enquanto o layout assenta
    if (!this.userMoved && !this.drag) {
      const t = this.fitTarget();
      if (t) {
        const k = this.fitted ? 0.06 : 1;
        this.scale += (t.scale - this.scale) * k;
        this.tx += (t.tx - this.tx) * k;
        this.ty += (t.ty - this.ty) * k;
        this.fitted = true;
      }
    }
    this.draw();
    // conta nós de nota fora da tela (a cada ~400 ms)
    const t = performance.now();
    if (t - this.offCheck > 400) {
      this.offCheck = t;
      let off = 0;
      for (const n of this.nodes) {
        if (n.kind !== 'note' || n.x === undefined) continue;
        const sx = this.w / 2 + this.tx + n.x * this.scale;
        const sy = this.h / 2 + this.ty + n.y! * this.scale;
        if (sx < -4 || sy < -4 || sx > this.w + 4 || sy > this.h + 4) off++;
      }
      if (off !== this.lastOff) { this.lastOff = off; this.onOffscreen(off); }
    }
  };

  private draw() {
    const { ctx, palette: p, settings: s } = this;
    const now = performance.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.w / 2 + this.tx, this.h / 2 + this.ty);
    ctx.scale(this.scale, this.scale);

    const focusId = this.drag?.id ?? this.hover?.id ?? null;
    const focusSet = focusId ? this.neighbors.get(focusId) : null;

    // animação de entrada + foco suave
    for (const n of this.nodes) {
      const t = clamp((now - n.appearAt) / 450, 0, 1);
      n.appear = t;
      const target = !focusId || n.id === focusId || focusSet?.has(n.id) ? 1 : 0.18;
      n.focus += (target - n.focus) * 0.15;
    }

    // fios (links)
    const lw = (s.linkThickness * 1) / this.scale;
    for (const l of this.links) {
      const a = l.source as GNode, b = l.target as GNode;
      const vis = Math.min(a.appear, b.appear);
      if (vis <= 0.4) continue;
      const hi = focusId && (a.id === focusId || b.id === focusId);
      ctx.globalAlpha = (hi ? 0.95 : 0.55 * Math.min(a.focus, b.focus)) * ((vis - 0.4) / 0.6);
      ctx.strokeStyle = hi ? p.lineHi : p.line;
      ctx.lineWidth = hi ? lw * 1.6 : lw;
      ctx.beginPath();
      ctx.moveTo(a.x!, a.y!);
      ctx.lineTo(b.x!, b.y!);
      ctx.stroke();
      if (s.arrows) this.arrow(a, b, lw * 4);
    }

    // nós
    for (const n of this.nodes) {
      if (n.appear <= 0) continue;
      const k = easeOutBack(n.appear);
      const r = n.radius * s.nodeSize * k;
      const isActive = n.id === this.activeId;
      ctx.globalAlpha = n.focus;
      if (isActive) {
        // halo pulsante na nota aberta
        const pulse = 1 + Math.sin(now / 450) * 0.08;
        ctx.fillStyle = n.color ?? p.active;
        ctx.globalAlpha = 0.18 * n.focus;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r * 2.1 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = n.focus;
      }
      // a cor do grupo/tag vale também para a nota aberta (destacada pelo anel e pelo halo)
      ctx.fillStyle = n.color ?? (isActive ? p.active : n.kind === 'tag' ? p.tag : n.kind === 'missing' ? p.missing : p.node);
      if (n === this.hover || n === this.drag) ctx.fillStyle = n.color ?? p.lineHi;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = p.ring;
        ctx.lineWidth = 1.5 / this.scale;
        ctx.stroke();
      }
      // nó recém-criado: onda que se expande por ~2,5 s
      if (n.bornAt) {
        const t = (now - n.bornAt) / 2500;
        if (t >= 1) n.bornAt = undefined;
        else {
          ctx.globalAlpha = (1 - t) * 0.7;
          ctx.strokeStyle = n.color ?? p.lineHi;
          ctx.lineWidth = 2 / this.scale;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r + 4 + t * 26 / Math.sqrt(this.scale), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = n.focus;
        }
      }
    }

    // rótulos: surgem conforme o zoom (como no Obsidian); foco sempre visível
    const base = clamp((this.scale - s.textFadeThreshold * 0.6) / 0.5, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fs = 12 / Math.sqrt(this.scale);
    ctx.font = `${fs}px ${getComputedStyle(document.body).fontFamily}`;
    for (const n of this.nodes) {
      if (n.appear < 0.8) continue;
      const inFocus = focusId && (n.id === focusId || focusSet?.has(n.id));
      const a = inFocus ? 1 : n.id === this.activeId ? Math.max(base, 0.8) : base * n.focus;
      if (a < 0.03) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.text;
      ctx.fillText(n.label, n.x!, n.y! + n.radius * s.nodeSize + 4 / this.scale);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private arrow(a: GNode, b: GNode, size: number) {
    const ang = Math.atan2(b.y! - a.y!, b.x! - a.x!);
    const r = b.radius * this.settings.nodeSize + 2 / this.scale;
    const x = b.x! - Math.cos(ang) * r, y = b.y! - Math.sin(ang) * r;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(ang - 0.45) * size, y - Math.sin(ang - 0.45) * size);
    ctx.lineTo(x - Math.cos(ang + 0.45) * size, y - Math.sin(ang + 0.45) * size);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  // ------------------------------------------------------------- interação
  private toWorld(px: number, py: number) {
    return { x: (px - this.w / 2 - this.tx) / this.scale, y: (py - this.h / 2 - this.ty) / this.scale };
  }

  private pick(px: number, py: number): GNode | null {
    const p = this.toWorld(px, py);
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const r = n.radius * this.settings.nodeSize + 4 / this.scale;
      const d = (n.x! - p.x) ** 2 + (n.y! - p.y) ** 2;
      if (d < r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  private pos(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
      this.drag = null;
      this.pan = null;
      return;
    }
    const hit = this.pick(p.x, p.y);
    this.dragMoved = false;
    if (hit) {
      this.drag = hit;
      hit.fx = hit.x;
      hit.fy = hit.y;
      this.sim.alphaTarget(0.3).restart();
    } else {
      this.pan = { x: p.x, y: p.y, tx: this.tx, ty: this.ty };
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.userMoved = true;
      this.scale = clamp(this.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d), 0.08, 6);
      return;
    }
    if (this.drag) {
      const w = this.toWorld(p.x, p.y);
      if (Math.hypot(w.x - this.drag.x!, w.y - this.drag.y!) > 2 / this.scale) this.dragMoved = true;
      this.drag.fx = w.x;
      this.drag.fy = w.y;
    } else if (this.pan) {
      this.userMoved = true;
      this.tx = this.pan.tx + (p.x - this.pan.x);
      this.ty = this.pan.ty + (p.y - this.pan.y);
    } else if (e.pointerType === 'mouse') {
      this.hover = this.pick(p.x, p.y);
      this.canvas.style.cursor = this.hover ? 'pointer' : 'grab';
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag) {
      const n = this.drag;
      if (!this.dragMoved && n.kind === 'note') this.onOpen(n.id, e.ctrlKey || e.metaKey);
      // solta o nó: ele volta a "flutuar" preso aos fios
      n.fx = null;
      n.fy = null;
      this.sim.alphaTarget(0);
      this.drag = null;
    }
    this.pan = null;
  };

  private onLeave = () => {
    this.hover = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.userMoved = true;
    const p = this.pos(e);
    const before = this.toWorld(p.x, p.y);
    this.scale = clamp(this.scale * Math.exp(-e.deltaY * 0.0015), 0.08, 6);
    const after = this.toWorld(p.x, p.y);
    this.tx += (after.x - before.x) * this.scale;
    this.ty += (after.y - before.y) * this.scale;
  };

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private unbind() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('wheel', this.onWheel);
  }
}
