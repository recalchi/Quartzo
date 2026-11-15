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
  /** resumo mostrado no cartão ao passar o mouse (ex.: "120 palavras · 3 conexões") */
  info?: string;
  rc: number; // raio desenhado (anima até `radius` quando a nota cresce)
  hs: number; // escala de destaque (mola): hover, vizinho, proximidade do cursor
  hv: number; // velocidade da mola
  ph: number; // fase da flutuação ambiente
  prox: number; // 0..1 proximidade do cursor
  rx: number; // posição desenhada (x/y da simulação + flutuação)
  ry: number;
}

export interface GLink extends SimulationLinkDatum<GNode> {
  source: string | GNode;
  target: string | GNode;
}

export interface GraphData {
  nodes: Omit<GNode, 'focus' | 'appear' | 'appearAt' | 'x' | 'y' | 'vx' | 'vy' | 'rc' | 'hs' | 'hv' | 'ph' | 'prox' | 'rx' | 'ry'>[];
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
/** mesma cor com alfa 0 (fim do gradiente de brilho) */
const fadeOf = (c: string) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return 'rgba(128,128,128,0)';
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},0)`;
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
  /** onde o toque/clique começou (tela), para distinguir toque de arrasto */
  private downAt: { x: number; y: number; t: number; touch: boolean } | null = null;
  private pinch: { d: number; scale: number } | null = null;
  private raf = 0;
  /** zoom suave: a escala desliza até o alvo mantendo o ponto âncora parado */
  private zoomAnim: { target: number; ax: number; ay: number } | null = null;
  /** inércia do arrasto do fundo */
  private fling: { vx: number; vy: number } | null = null;
  private panLast: { x: number; y: number; t: number; vx: number; vy: number } | null = null;
  private mouse: { x: number; y: number } | null = null;
  private ripples: { x: number; y: number; t: number; color: string }[] = [];
  private card: { node: GNode | null; a: number } = { node: null, a: 0 };
  private fontFamily = 'sans-serif';
  private reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    this.fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
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
            rc: n.radius, hs: 1, hv: 0, ph: Math.random() * Math.PI * 2, prox: 0, rx: 0, ry: 0,
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
    // o enquadramento automático do loop leva a câmera até lá, deslizando
    this.userMoved = false;
    this.zoomAnim = null;
    this.fling = null;
  }

  zoomBy(f: number) { this.zoomAt(f, this.w / 2, this.h / 2); }

  private zoomAt(f: number, ax: number, ay: number) {
    this.userMoved = true;
    const base = this.zoomAnim?.target ?? this.scale;
    this.zoomAnim = { target: clamp(base * f, 0.08, 6), ax, ay };
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
    if (this.zoomAnim) {
      const z = this.zoomAnim;
      const before = this.toWorld(z.ax, z.ay);
      const done = this.reduce || Math.abs(z.target - this.scale) < z.target * 0.003;
      this.scale = done ? z.target : this.scale + (z.target - this.scale) * 0.2;
      const after = this.toWorld(z.ax, z.ay);
      this.tx += (after.x - before.x) * this.scale;
      this.ty += (after.y - before.y) * this.scale;
      if (done) this.zoomAnim = null;
    }
    if (this.fling && !this.pan && !this.pinch) {
      this.tx += this.fling.vx;
      this.ty += this.fling.vy;
      this.fling.vx *= 0.93;
      this.fling.vy *= 0.93;
      if (Math.hypot(this.fling.vx, this.fling.vy) < 0.2) this.fling = null;
    }
    // enquadramento automático e suave enquanto o layout assenta
    if (!this.userMoved && !this.drag) {
      const t = this.fitTarget();
      if (t) {
        const k = this.fitted ? 0.09 : 1;
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

    const focusNode = this.drag ?? this.hover;
    const focusId = focusNode?.id ?? null;
    const focusSet = focusId ? this.neighbors.get(focusId) : null;
    const motion = s.motion !== false && !this.reduce;
    const amb = motion ? 2 / Math.sqrt(this.scale) : 0;
    const mw = this.mouse && !this.drag && !this.pan ? this.toWorld(this.mouse.x, this.mouse.y) : null;
    const lens = 120 / this.scale; // raio da "lente" em volta do cursor

    // estado animado de cada nó: entrada, foco, raio, mola de destaque e flutuação
    for (const n of this.nodes) {
      n.appear = clamp((now - n.appearAt) / 450, 0, 1);
      const target = !focusId || n.id === focusId || focusSet?.has(n.id) ? 1 : 0.14;
      n.focus += (target - n.focus) * 0.14;
      n.rc += (n.radius - n.rc) * 0.1;

      let prox = 0;
      if (mw) {
        const d = Math.hypot(n.x! - mw.x, n.y! - mw.y);
        if (d < lens) prox = (1 - d / lens) ** 2;
      }
      n.prox += (prox - n.prox) * 0.2;

      let hs = 1 + n.prox * 0.22;
      if (n === this.drag) hs = this.dragMoved ? 1.2 : 0.86; // "afunda" ao pressionar
      else if (n === this.hover) hs = 1.34;
      else if (focusSet?.has(n.id)) hs = 1.12;
      if (this.reduce) { n.hs = hs; n.hv = 0; }
      else {
        n.hv = (n.hv + (hs - n.hs) * 0.2) * 0.7;
        n.hs += n.hv;
      }

      const a = n === this.drag ? 0 : amb;
      n.rx = n.x! + Math.sin(now * 0.00055 + n.ph) * a;
      n.ry = n.y! + Math.cos(now * 0.00047 + n.ph * 1.7) * a;
    }

    // fios (links)
    const lw = (s.linkThickness * 1) / this.scale;
    const hiLinks: { a: GNode; b: GNode; vis: number }[] = [];
    for (const l of this.links) {
      const a = l.source as GNode, b = l.target as GNode;
      const vis = Math.min(a.appear, b.appear);
      if (vis <= 0.4) continue;
      const hi = focusId && (a.id === focusId || b.id === focusId);
      if (hi) { hiLinks.push(a.id === focusId ? { a, b, vis } : { a: b, b: a, vis }); continue; }
      const near = Math.max(a.prox, b.prox);
      ctx.globalAlpha = (0.5 + near * 0.35) * Math.min(a.focus, b.focus) * ((vis - 0.4) / 0.6);
      ctx.strokeStyle = p.line;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(a.rx, a.ry);
      ctx.lineTo(b.rx, b.ry);
      ctx.stroke();
      if (s.arrows) this.arrow(a, b, lw * 4);
    }
    // fios do nó em foco por cima, com "pulsos" correndo até os vizinhos
    const hiColor = focusNode?.color ?? p.lineHi;
    for (const { a, b, vis } of hiLinks) {
      const k = (vis - 0.4) / 0.6;
      ctx.globalAlpha = 0.9 * k;
      ctx.strokeStyle = hiColor;
      ctx.lineWidth = lw * 1.7;
      ctx.beginPath();
      ctx.moveTo(a.rx, a.ry);
      ctx.lineTo(b.rx, b.ry);
      ctx.stroke();
      if (s.arrows) this.arrow(a, b, lw * 4);
      if (motion && s.particles !== false) {
        const len = Math.hypot(b.rx - a.rx, b.ry - a.ry);
        const count = len * this.scale > 160 ? 2 : 1;
        ctx.fillStyle = hiColor;
        for (let i = 0; i < count; i++) {
          const t = (now / 1300 + b.ph + i / count) % 1;
          ctx.globalAlpha = Math.sin(Math.PI * t) * k;
          ctx.beginPath();
          ctx.arc(a.rx + (b.rx - a.rx) * t, a.ry + (b.ry - a.ry) * t, Math.max(lw * 2.2, 2.2 / this.scale), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ondas de toque/clique
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      const t = (now - rp.t) / 520;
      if (t >= 1) { this.ripples.splice(i, 1); continue; }
      const e = 1 - (1 - t) ** 3;
      ctx.globalAlpha = (1 - t) * 0.55;
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 2 / this.scale;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, (10 + e * 34) / Math.sqrt(this.scale), 0, Math.PI * 2);
      ctx.stroke();
    }

    // nós
    for (const n of this.nodes) {
      if (n.appear <= 0) continue;
      const k = easeOutBack(n.appear);
      const r = Math.max(0.5, this.nodeR(n) * k);
      const isActive = n.id === this.activeId;
      const isFocus = n === focusNode;
      const base = n.color ?? (isActive ? p.active : n.kind === 'tag' ? p.tag : n.kind === 'missing' ? p.missing : p.node);
      const fill = isFocus ? n.color ?? p.lineHi : base;
      if (isFocus || isActive) {
        // brilho suave: mais forte no nó em foco, pulsante na nota aberta
        const pulse = isFocus ? 1 : 1 + Math.sin(now / 450) * 0.08;
        const gr = r * (isFocus ? 3 : 2.2) * pulse;
        const g = ctx.createRadialGradient(n.rx, n.ry, r * 0.9, n.rx, n.ry, gr);
        g.addColorStop(0, fill);
        g.addColorStop(1, fadeOf(fill));
        ctx.globalAlpha = (isFocus ? 0.4 : 0.28) * n.focus;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.rx, n.ry, gr, 0, Math.PI * 2);
        ctx.fill();
      } else if (n.prox > 0.05) {
        ctx.globalAlpha = 0.14 * n.prox * n.focus;
        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.arc(n.rx, n.ry, r * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = n.focus;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(n.rx, n.ry, r, 0, Math.PI * 2);
      ctx.fill();
      if (isActive || isFocus) {
        ctx.strokeStyle = p.ring;
        ctx.globalAlpha = (isActive ? 1 : 0.7) * n.focus;
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
          ctx.arc(n.rx, n.ry, r + 4 + t * 26 / Math.sqrt(this.scale), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // rótulos: surgem com o zoom; notas maiores aparecem antes, e as próximas do cursor também
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fs = 12 / Math.sqrt(this.scale);
    ctx.font = `${fs}px ${this.fontFamily}`;
    ctx.fillStyle = p.text;
    for (const n of this.nodes) {
      if (n.appear < 0.8 || n === focusNode) continue;
      const weight = 0.75 + Math.min(n.rc, 24) / 28; // 0.9 (pequena) .. 1.6 (grande)
      const base = clamp((this.scale * weight - s.textFadeThreshold * 0.6) / 0.5, 0, 1);
      const inFocus = focusId && focusSet?.has(n.id);
      const a = inFocus ? 1 : Math.max(n.id === this.activeId ? 0.85 : 0, base, n.prox * 1.4) * n.focus;
      if (a < 0.03) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillText(n.label, n.rx, n.ry + this.nodeR(n) + 4 / this.scale);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    this.drawCard(focusNode);
  }

  /** raio desenhado do nó (mundo) */
  private nodeR(n: GNode) {
    return n.rc * this.settings.nodeSize * n.hs;
  }

  /** Cartão do nó em foco: título + resumo (palavras · conexões), em pixels de tela. */
  private drawCard(focus: GNode | null) {
    const c = this.card;
    if (focus) c.node = focus;
    c.a += ((focus ? 1 : 0) - c.a) * (this.reduce ? 1 : 0.22);
    const n = c.node;
    if (!n || c.a < 0.02 || n.x === undefined || !this.byId.has(n.id)) { if (!focus) c.node = null; return; }
    const { ctx, palette: p } = this;
    const sx = this.w / 2 + this.tx + n.rx * this.scale;
    const sy = this.h / 2 + this.ty + n.ry * this.scale;
    const r = this.nodeR(n) * this.scale;
    const title = n.label.length > 42 ? `${n.label.slice(0, 41)}…` : n.label;
    const info = n.info ?? '';
    ctx.font = `600 13px ${this.fontFamily}`;
    const tw = ctx.measureText(title).width;
    ctx.font = `11px ${this.fontFamily}`;
    const iw = info ? ctx.measureText(info).width : 0;
    const bw = Math.max(tw, iw) + 20;
    const bh = info ? 42 : 26;
    // no toque o dedo cobre o que fica embaixo: o cartão sobe
    const above = (this.drag && this.downAt?.touch) || sy + r + 10 + bh > this.h - 4;
    const x = clamp(sx - bw / 2, 4, Math.max(4, this.w - bw - 4));
    const y = above ? sy - r - 10 - bh - (1 - c.a) * 4 : sy + r + 10 + (1 - c.a) * 4;
    ctx.globalAlpha = c.a * 0.94;
    ctx.fillStyle = p.bg;
    ctx.strokeStyle = n.color ?? p.lineHi;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, bw, bh, 8);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
    ctx.globalAlpha = c.a * 0.5;
    ctx.stroke();
    ctx.globalAlpha = c.a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = p.ring;
    ctx.font = `600 13px ${this.fontFamily}`;
    ctx.fillText(title, x + bw / 2, y + 6);
    if (info) {
      ctx.globalAlpha = c.a * 0.7;
      ctx.fillStyle = p.text;
      ctx.font = `11px ${this.fontFamily}`;
      ctx.fillText(info, x + bw / 2, y + 24);
    }
    ctx.globalAlpha = 1;
  }

  private arrow(a: GNode, b: GNode, size: number) {
    const ang = Math.atan2(b.ry - a.ry, b.rx - a.rx);
    const r = this.nodeR(b) + 2 / this.scale;
    const x = b.rx - Math.cos(ang) * r, y = b.ry - Math.sin(ang) * r;
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

  private pick(px: number, py: number, slopPx = 4): GNode | null {
    const p = this.toWorld(px, py);
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (n.appear <= 0) continue;
      const r = this.nodeR(n) + slopPx / this.scale;
      const d = ((n.rx || n.x!) - p.x) ** 2 + ((n.ry || n.y!) - p.y) ** 2;
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
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ponteiro já liberado */ }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
      this.drag = null;
      this.pan = null;
      return;
    }
    const touch = e.pointerType !== 'mouse';
    this.fling = null;
    this.zoomAnim = null;
    this.downAt = { x: p.x, y: p.y, t: performance.now(), touch };
    // dedo é menos preciso que o mouse: área de toque maior
    const hit = this.pick(p.x, p.y, touch ? 18 : 4);
    this.dragMoved = false;
    if (hit) {
      this.drag = hit;
      hit.fx = hit.x;
      hit.fy = hit.y;
      this.sim.alphaTarget(0.3).restart();
    } else {
      this.pan = { x: p.x, y: p.y, tx: this.tx, ty: this.ty };
      this.panLast = { x: p.x, y: p.y, t: performance.now(), vx: 0, vy: 0 };
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pos(e);
    if (e.pointerType === 'mouse') this.mouse = p;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.userMoved = true;
      this.scale = clamp(this.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d), 0.08, 6);
      return;
    }
    if (this.drag) {
      const w = this.toWorld(p.x, p.y);
      // só vira arrasto depois de mexer de verdade (o dedo sempre treme alguns pixels)
      const tol = this.downAt?.touch ? 10 : 4;
      if (!this.dragMoved && this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) <= tol) return;
      this.dragMoved = true;
      this.drag.fx = w.x;
      this.drag.fy = w.y;
    } else if (this.pan) {
      this.userMoved = true;
      this.tx = this.pan.tx + (p.x - this.pan.x);
      this.ty = this.pan.ty + (p.y - this.pan.y);
      const now = performance.now();
      const l = this.panLast;
      if (l && now - l.t > 4) {
        const dt = now - l.t;
        this.panLast = { x: p.x, y: p.y, t: now, vx: ((p.x - l.x) / dt) * 16, vy: ((p.y - l.y) / dt) * 16 };
      }
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
      if (!this.dragMoved) this.ripples.push({ x: n.rx, y: n.ry, t: performance.now(), color: n.color ?? this.palette.lineHi });
      if (!this.dragMoved && n.kind === 'note') this.onOpen(n.id, e.ctrlKey || e.metaKey);
      this.downAt = null;
      // solta o nó: ele volta a "flutuar" preso aos fios
      n.fx = null;
      n.fy = null;
      this.sim.alphaTarget(0);
      this.drag = null;
    }
    // soltou o fundo em movimento: a câmera continua deslizando e freia
    const l = this.panLast;
    if (this.pan && l && !this.reduce && performance.now() - l.t < 90 && Math.hypot(l.vx, l.vy) > 1.5) {
      this.fling = { vx: clamp(l.vx, -60, 60), vy: clamp(l.vy, -60, 60) };
    }
    this.panLast = null;
    this.pan = null;
  };

  private onLeave = () => {
    this.hover = null;
    this.mouse = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.pos(e);
    this.fling = null;
    this.zoomAt(Math.exp(-e.deltaY * 0.0018), p.x, p.y);
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
