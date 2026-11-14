import { useSyncExternalStore } from 'react';

export interface GraphGroup {
  id: string;
  /** "tag:#fpa", "path:Projetos", "file:Forecast" ou texto livre (busca no título) */
  query: string;
  color: string;
}

export interface GraphSettings {
  // Filtros
  search: string;
  showTags: boolean;
  showOrphans: boolean;
  showUnresolved: boolean;
  // Grupos (cores por tag/pasta)
  groups: GraphGroup[];
  // Exibição
  arrows: boolean;
  textFadeThreshold: number; // zoom a partir do qual os nomes aparecem
  nodeSize: number; // multiplicador
  linkThickness: number;
  /** cor padrão das bolinhas de nota / de tag (null = cor do tema) */
  nodeColor: string | null;
  tagNodeColor: string | null;
  // Forças
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  accent: string;
  editorSize: number;
  graph: GraphSettings;
  localGraphDepth: number;
}

/** Paleta de destaque. Padrão neutro (grafite); o usuário escolhe outra se quiser. */
export const ACCENTS: { name: string; value: string }[] = [
  { name: 'Grafite', value: '#a3a3a3' },
  { name: 'Prata', value: '#d4d4d4' },
  { name: 'Azul', value: '#5b9cf5' },
  { name: 'Verde', value: '#4ec38a' },
  { name: 'Ametista', value: '#a882ff' },
  { name: 'Rosa', value: '#e0679a' },
  { name: 'Âmbar', value: '#e0a03c' },
  { name: 'Vermelho', value: '#e5534b' },
];

export const GROUP_COLORS = ['#e5534b', '#f08a4b', '#e0a03c', '#d6c94a', '#4ec38a', '#45c4c4', '#5b9cf5', '#7b7ff0', '#a882ff', '#e0679a', '#c7c7c7', '#8a8a8a'];

export const DEFAULT_GRAPH: GraphSettings = {
  search: '',
  showTags: false,
  showOrphans: true,
  showUnresolved: false,
  groups: [],
  arrows: false,
  textFadeThreshold: 0.9,
  nodeSize: 1,
  linkThickness: 1,
  nodeColor: null,
  tagNodeColor: null,
  centerForce: 0.5,
  repelForce: 10,
  linkForce: 1,
  linkDistance: 250,
};

export const DEFAULTS: Settings = {
  theme: 'dark',
  accent: ACCENTS[0].value,
  editorSize: 16,
  graph: DEFAULT_GRAPH,
  localGraphDepth: 1,
};

const KEY = 'quartzo.settings';
let state: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw, graph: { ...DEFAULT_GRAPH, ...(raw.graph ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

export function getSettings() {
  return state;
}

export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  applyTheme();
  listeners.forEach((l) => l());
}

export function setGraph(patch: Partial<GraphSettings>) {
  setSettings({ graph: { ...state.graph, ...patch } });
}

const tagKey = (q: string) => q.trim().toLowerCase().replace(/^tag:/, '').replace(/^#/, '');

/** Cor definida para uma tag (grupo "tag:#x" do grafo), ou null. */
export function tagColor(tag: string, groups = state.graph.groups): string | null {
  const t = tag.toLowerCase().replace(/^#/, '');
  const g = groups.find((gr) => /^(tag:|#)/i.test(gr.query.trim()) && tagKey(gr.query) === t);
  return g?.color ?? null;
}

/** Define (ou remove, com null) a cor de uma tag — vira um grupo do grafo. */
export function setTagColor(tag: string, color: string | null) {
  const t = tag.toLowerCase().replace(/^#/, '');
  const groups = state.graph.groups;
  const i = groups.findIndex((gr) => /^(tag:|#)/i.test(gr.query.trim()) && tagKey(gr.query) === t);
  if (color === null) return setGraph({ groups: groups.filter((_, j) => j !== i) });
  if (i >= 0) return setGraph({ groups: groups.map((g, j) => (j === i ? { ...g, color } : g)) });
  setGraph({ groups: [...groups, { id: Math.random().toString(36).slice(2), query: `tag:#${tag.replace(/^#/, '')}`, color }] });
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** Aplica tema e cor de destaque nas variáveis CSS. */
export function applyTheme() {
  const root = document.documentElement;
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const mode = state.theme === 'system' ? (prefersLight ? 'light' : 'dark') : state.theme;
  root.dataset.theme = mode;
  root.style.setProperty('--accent', state.accent);
  root.style.setProperty('--accent-ink', readableInk(state.accent));
  root.style.setProperty('--editor-size', `${state.editorSize}px`);
}

function readableInk(hex: string) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

applyTheme();
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (state.theme === 'system') applyTheme();
});
