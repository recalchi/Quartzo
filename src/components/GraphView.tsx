import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../lib/db';
import type { VaultIndex } from '../lib/links';
import { extractTags } from '../lib/links';
import { normalizeKey, titleOf } from '../lib/notes';
import { GraphEngine, type GraphData } from '../lib/graphEngine';
import {
  DEFAULT_GRAPH, GROUP_COLORS, setGraph, setSettings, setTagColor, tagColor, useSettings, type GraphGroup, type GraphSettings,
} from '../lib/settings';
import { pickColor } from './Overlays';

interface Props {
  notes: Note[];
  index: VaultIndex;
  activeId: string | null;
  onOpen: (id: string, newTab: boolean) => void;
  /** grafo local: só a vizinhança da nota ativa */
  local?: boolean;
}

/** Testa se uma nota pertence a um grupo ("tag:#x", "#x", "path:Pasta", "file:Nome" ou texto). */
function matches(q: string, n: Note, tags: string[]): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return false;
  if (query.startsWith('tag:') || query.startsWith('#')) {
    const t = query.replace(/^tag:/, '').replace(/^#/, '');
    return tags.some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(`${t}/`));
  }
  if (query.startsWith('path:')) return n.path.toLowerCase().startsWith(query.slice(5).trim());
  if (query.startsWith('file:')) return titleOf(n.path).toLowerCase().includes(query.slice(5).trim());
  return n.path.toLowerCase().includes(query);
}

export function buildGraphData(notes: Note[], index: VaultIndex, g: GraphSettings, local: { center: string | null; depth: number } | null): GraphData {
  const tagsOf = new Map(notes.map((n) => [n.id, extractTags(n.content)]));
  const nodes: GraphData['nodes'] = [];
  const links: GraphData['links'] = [];
  const search = g.search.trim().toLowerCase();
  // referência de "nota grande" deste cofre (percentil 90), para o tamanho usar bem a faixa disponível
  const sizes = notes.map((n) => n.content.trim().length).sort((a, b) => a - b);
  const ref = Math.max(240, sizes[Math.floor(sizes.length * 0.9)] ?? 0);
  const contrast = g.sizeContrast ?? 1;

  for (const n of notes) {
    if (search && !n.path.toLowerCase().includes(search) && !n.content.toLowerCase().includes(search)) continue;
    const words = n.content.match(/\S+/g)?.length ?? 0;
    const degree = (index.outgoing.get(n.id)?.length ?? 0) + (index.backlinks.get(n.id)?.length ?? 0);
    // área da bolinha ∝ volume de conteúdo (caracteres), com um extra pelas conexões
    const vol = Math.min(1.3, Math.sqrt(n.content.trim().length / ref));
    const radius = Math.min(30, 4.2 + 15 * contrast * vol + Math.sqrt(degree) * 1.3);
    const info = `${words} ${words === 1 ? 'palavra' : 'palavras'} · ${degree} ${degree === 1 ? 'conexão' : 'conexões'}`;
    const group = g.groups.find((gr) => matches(gr.query, n, tagsOf.get(n.id)!));
    nodes.push({ id: n.id, kind: 'note', label: titleOf(n.path), radius, color: group?.color || null, createdAt: n.createdAt, info });
  }
  const ids = new Set(nodes.map((n) => n.id));

  for (const [from, tos] of index.outgoing) {
    if (!ids.has(from)) continue;
    for (const to of tos) if (ids.has(to)) links.push({ source: from, target: to });
  }

  if (g.showUnresolved) {
    for (const [from, missing] of index.unresolved) {
      if (!ids.has(from)) continue;
      for (const m of missing) {
        const id = `missing:${normalizeKey(m)}`;
        if (!ids.has(id)) {
          ids.add(id);
          nodes.push({ id, kind: 'missing', label: m, radius: 3.5, color: null, createdAt: Date.now(), info: 'nota ainda não criada' });
        }
        links.push({ source: from, target: id });
      }
    }
  }

  if (g.showTags) {
    for (const n of notes) {
      if (!ids.has(n.id)) continue;
      for (const t of tagsOf.get(n.id)!) {
        const id = `tag:${t.toLowerCase()}`;
        if (!ids.has(id)) {
          ids.add(id);
          const count = index.tags.get(t)?.length ?? 1;
          nodes.push({ id, kind: 'tag', label: `#${t}`, radius: Math.min(14, 3 + Math.sqrt(count) * 2), color: tagColor(t, g.groups) || null, createdAt: 0, info: `${count} ${count === 1 ? 'nota' : 'notas'}` });
        }
        links.push({ source: n.id, target: id });
      }
    }
  }

  let outNodes = nodes;
  let outLinks = links;

  if (local) {
    // vizinhança até N saltos da nota ativa
    const adj = new Map<string, Set<string>>();
    for (const l of links) {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source)!.add(l.target);
      adj.get(l.target)!.add(l.source);
    }
    const keep = new Set<string>();
    if (local.center && ids.has(local.center)) {
      let frontier = [local.center];
      keep.add(local.center);
      for (let d = 0; d < local.depth; d++) {
        const next: string[] = [];
        for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!keep.has(nb)) { keep.add(nb); next.push(nb); }
        frontier = next;
      }
    }
    outNodes = nodes.filter((n) => keep.has(n.id));
    outLinks = links.filter((l) => keep.has(l.source) && keep.has(l.target));
  } else if (!g.showOrphans) {
    const linked = new Set(links.flatMap((l) => [l.source, l.target]));
    outNodes = nodes.filter((n) => linked.has(n.id));
  }
  return { nodes: outNodes, links: outLinks };
}

export function GraphView({ notes, index, activeId, onOpen, local = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GraphEngine | null>(null);
  const settings = useSettings();
  const g = settings.graph;
  const [panel, setPanel] = useState(false);
  const [offscreen, setOffscreen] = useState(0);

  const data = useMemo(
    () => buildGraphData(notes, index, g, local ? { center: activeId, depth: settings.localGraphDepth } : null),
    // forças e exibição não exigem recalcular os dados
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, index, g.search, g.showTags, g.showOrphans, g.showUnresolved, g.groups, g.sizeContrast, local, local ? activeId : null, settings.localGraphDepth],
  );

  useEffect(() => {
    const e = new GraphEngine(canvas.current!, g);
    e.onOffscreen = setOffscreen;
    engine.current = e;
    return () => e.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { engine.current?.setData(data); }, [data]);
  useEffect(() => { if (engine.current) engine.current.onOpen = onOpen; }, [onOpen]);
  useEffect(() => { if (engine.current) engine.current.activeId = activeId; }, [activeId]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.settings = g;
    e.applyForces();
  }, [g.centerForce, g.repelForce, g.linkForce, g.linkDistance]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.settings = g;
    e.refreshPalette();
  }, [g, settings.accent, settings.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTags = useMemo(() => [...index.tags.entries()].sort((a, b) => b[1].length - a[1].length), [index]);
  const topTags = allTags.slice(0, 8).map(([t]) => t);
  const [tagQuery, setTagQuery] = useState('');

  const addGroup = (query = '') => {
    const color = GROUP_COLORS[g.groups.length % GROUP_COLORS.length];
    setGraph({ groups: [...g.groups, { id: Math.random().toString(36).slice(2), query, color }] });
  };
  const updGroup = (id: string, patch: Partial<GraphGroup>) =>
    setGraph({ groups: g.groups.map((gr) => (gr.id === id ? { ...gr, ...patch } : gr)) });
  const delGroup = (id: string) => setGraph({ groups: g.groups.filter((gr) => gr.id !== id) });

  return (
    <div className={`graph-pane${local ? ' local' : ''}`}>
      <canvas ref={canvas} />
      {!local && (() => {
        const shown = data.nodes.filter((n) => n.kind === 'note').length;
        const hidden = notes.length - shown;
        return (
          <div className="graph-count">
            {shown} {shown === 1 ? 'nota' : 'notas'}
            {hidden > 0 && (
              <button className="link-btn" title="Mostrar todas" onClick={() => setGraph({ showOrphans: true, search: '' })}>
                · {hidden} oculta{hidden > 1 ? 's' : ''} pelos filtros{!g.showOrphans ? ' (órfãs desligadas)' : ''} — mostrar
              </button>
            )}
            {offscreen > 0 && (
              <button className="link-btn" title="Enquadrar todas as notas" onClick={() => engine.current?.fit()}>
                · {offscreen} fora da tela — centralizar
              </button>
            )}
          </div>
        );
      })()}
      <div className="graph-tools">
        <button className="icon-btn" title="Animar crescimento do vault" onClick={() => engine.current?.animate()}>✨</button>
        <button className="icon-btn" title="Centralizar" onClick={() => engine.current?.fit()}>⤢</button>
        {!local && <button className="icon-btn" title="Aproximar" onClick={() => engine.current?.zoomBy(1.25)}>＋</button>}
        {!local && <button className="icon-btn" title="Afastar" onClick={() => engine.current?.zoomBy(0.8)}>－</button>}
        <button className={`icon-btn${panel ? ' on' : ''}`} title="Configurações do grafo" onClick={() => setPanel((p) => !p)}>⚙</button>
      </div>
      {panel && (
        <div className="graph-settings">
          {local && (
            <Section title="Grafo local" open>
              <Slider label="Profundidade" min={1} max={4} step={1} value={settings.localGraphDepth} onChange={(v) => setSettings({ localGraphDepth: v })} />
            </Section>
          )}
          <Section title="Filtros" open>
            <input className="gs-input" placeholder="Buscar arquivos…" value={g.search} onChange={(e) => setGraph({ search: e.target.value })} />
            <Toggle label="Tags" value={g.showTags} onChange={(v) => setGraph({ showTags: v })} />
            <Toggle label="Links sem nota" value={g.showUnresolved} onChange={(v) => setGraph({ showUnresolved: v })} />
            {!local && <Toggle label="Órfãs" value={g.showOrphans} onChange={(v) => setGraph({ showOrphans: v })} />}
          </Section>
          <Section title="Grupos" open={!local}>
            {g.groups.map((gr) => (
              <div className="gs-group" key={gr.id}>
                <input className="gs-input" placeholder="tag:#fpa · path:Projetos" value={gr.query} onChange={(e) => updGroup(gr.id, { query: e.target.value })} />
                <input type="color" value={gr.color} onChange={(e) => updGroup(gr.id, { color: e.target.value })} title="Cor do grupo" />
                <button className="icon-btn tiny" onClick={() => delGroup(gr.id)} title="Remover">✕</button>
              </div>
            ))}
            <button className="btn small" onClick={() => addGroup()}>Novo grupo</button>
            {topTags.length > 0 && (
              <div className="gs-suggest">
                {topTags.filter((t) => !g.groups.some((gr) => gr.query === `tag:#${t}`)).map((t) => (
                  <button key={t} className="chip" onClick={() => addGroup(`tag:#${t}`)}>+ #{t}</button>
                ))}
              </div>
            )}
          </Section>
          <Section title="Cores" open>
            <ColorRow label="Bolinhas das notas" value={g.nodeColor} onChange={(c) => setGraph({ nodeColor: c })} />
            <ColorRow label="Bolinhas das tags" value={g.tagNodeColor} onChange={(c) => setGraph({ tagNodeColor: c })} />
            <div className="gs-sub">Cor por tag <small>(pinta as notas com a tag)</small></div>
            {allTags.length > 8 && <input className="gs-input" placeholder="Filtrar tags…" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} />}
            <div className="gs-tags">
              {allTags.filter(([t]) => !tagQuery || t.toLowerCase().includes(tagQuery.toLowerCase().replace(/^#/, ''))).slice(0, 60).map(([t, ids]) => (
                <ColorRow key={t} label={`#${t}`} count={ids.length} value={tagColor(t, g.groups)} onChange={(c) => setTagColor(t, c)} />
              ))}
              {!allTags.length && <p className="muted small">Nenhuma tag ainda — escreva #tag numa nota.</p>}
            </div>
          </Section>
          <Section title="Exibição">
            <Toggle label="Setas" value={g.arrows} onChange={(v) => setGraph({ arrows: v })} />
            <Slider label="Limite para texto" min={0.2} max={2} step={0.05} value={g.textFadeThreshold} onChange={(v) => setGraph({ textFadeThreshold: v })} />
            <Toggle label="Movimento (flutuar e molas)" value={g.motion !== false} onChange={(v) => setGraph({ motion: v })} />
            <Toggle label="Pulsos nos fios em foco" value={g.particles !== false} onChange={(v) => setGraph({ particles: v })} />
            <Slider label="Tamanho pelo conteúdo" min={0} max={2} step={0.05} value={g.sizeContrast ?? 1} onChange={(v) => setGraph({ sizeContrast: v })} />
            <Slider label="Tamanho dos nós" min={0.4} max={2.5} step={0.05} value={g.nodeSize} onChange={(v) => setGraph({ nodeSize: v })} />
            <Slider label="Espessura dos fios" min={0.3} max={4} step={0.1} value={g.linkThickness} onChange={(v) => setGraph({ linkThickness: v })} />
          </Section>
          <Section title="Forças">
            <Slider label="Força central" min={0} max={1} step={0.01} value={g.centerForce} onChange={(v) => setGraph({ centerForce: v })} />
            <Slider label="Repulsão" min={0} max={20} step={0.5} value={g.repelForce} onChange={(v) => setGraph({ repelForce: v })} />
            <Slider label="Força dos fios" min={0} max={1} step={0.01} value={g.linkForce} onChange={(v) => setGraph({ linkForce: v })} />
            <Slider label="Distância dos fios" min={30} max={500} step={5} value={g.linkDistance} onChange={(v) => setGraph({ linkDistance: v })} />
          </Section>
          <button className="btn small ghost" onClick={() => setGraph({ ...DEFAULT_GRAPH, groups: g.groups })}>Restaurar padrão</button>
        </div>
      )}
    </div>
  );
}

function Section({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="gs-section" open={open}>
      <summary>{title}</summary>
      <div className="gs-body">{children}</div>
    </details>
  );
}

function ColorRow({ label, value, count, onChange }: { label: string; value: string | null; count?: number; onChange: (c: string | null) => void }) {
  return (
    <div className="gs-row color-row">
      <span>{label}{count !== undefined && <small> {count}</small>}</span>
      <button type="button" className={`swatch sm${value ? '' : ' empty'}`} style={value ? { background: value } : undefined} title={value ? 'Trocar cor' : 'Definir cor'}
        onClick={async (e) => { const c = await pickColor(e, label, value); if (c !== undefined) onChange(c); }} />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="gs-row">
      <span>{label}</span>
      <button type="button" className={`switch${value ? ' on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value}><i /></button>
    </label>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="gs-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
