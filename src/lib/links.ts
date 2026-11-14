import type { Note } from './db';
import { normalizeKey, titleOf } from './notes';

const WIKILINK = /!?\[\[([^\]|#^]+)([#^][^\]|]*)?(\|[^\]]*)?\]\]/g;
/** [texto](Pasta/Nota.md) — links internos no formato Markdown (o Obsidian também aceita) */
const MDLINK = /!?\[[^\]\n]*\]\(<?([^)<>\n]+?)>?(?:\s+"[^"]*")?\)/g;
/** extensões de anexos: não viram nó "sem nota" no grafo */
const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|bmp|pdf|mp3|mp4|webm|mov|wav|ogg|m4a|zip|docx?|xlsx?|pptx?|csv|canvas|excalidraw)$/i;
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const HEADING = /^(#{1,6})\s+(.+)$/gm;

/** Remove código, comentários %% %% e o frontmatter para não capturar links/tags dentro deles. */
function stripCode(md: string) {
  return md
    .replace(/^---\n[\s\S]*?\n---(\n|$)/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/%%[\s\S]*?%%/g, '');
}

/** Lê o frontmatter YAML simples (chave: valor, listas inline [a, b] ou com "- item"). */
export function frontmatter(md: string): Record<string, string[]> {
  const m = md.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  const out: Record<string, string[]> = {};
  if (!m) return out;
  let key = '';
  for (const raw of m[1].split('\n')) {
    const item = raw.match(/^\s*-\s+(.*)$/);
    if (item && key) { out[key].push(clean(item[1])); continue; }
    const kv = raw.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1].toLowerCase();
    const v = kv[2].trim();
    out[key] = !v ? [] : v.startsWith('[') ? v.replace(/^\[|\]$/g, '').split(',').map(clean).filter(Boolean) : [clean(v)];
  }
  return out;
}
const clean = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();

/** Alvo de um link Markdown interno, ou null se for externo/âncora. */
function mdTarget(href: string): string | null {
  if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return null;
  let t = href.split('#')[0];
  try { t = decodeURIComponent(t); } catch { /* mantém */ }
  t = t.replace(/^\.?\//, '').replace(/^(\.\.\/)+/, '');
  return t || null;
}

export function extractLinks(md: string): string[] {
  const out = new Set<string>();
  const body = stripCode(md);
  for (const m of body.matchAll(WIKILINK)) out.add(m[1].trim());
  for (const m of body.matchAll(MDLINK)) {
    const t = mdTarget(m[1].trim());
    if (t) out.add(t);
  }
  return [...out].filter((l) => l && !ATTACHMENT.test(l));
}

export function extractTags(md: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(md).matchAll(TAG)) {
    if (!/^\d+$/.test(m[2])) out.add(m[2]);
  }
  // tags: [a, b] no frontmatter
  const fm = frontmatter(md);
  for (const t of [...(fm.tags ?? []), ...(fm.tag ?? [])]) {
    const v = t.replace(/^#/, '');
    if (v && !/^\d+$/.test(v)) out.add(v);
  }
  return [...out];
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export function extractHeadings(md: string): Heading[] {
  const res: Heading[] = [];
  const code = /```[\s\S]*?```/g;
  const clean = md.replace(code, (b) => b.replace(/[^\n]/g, ' '));
  for (const m of clean.matchAll(HEADING)) {
    const line = clean.slice(0, m.index).split('\n').length - 1;
    res.push({ level: m[1].length, text: m[2].trim(), line });
  }
  return res;
}

export interface VaultIndex {
  byTitle: Map<string, Note>;
  outgoing: Map<string, string[]>; // id -> ids
  backlinks: Map<string, string[]>; // id -> ids
  unresolved: Map<string, string[]>; // id -> títulos sem nota
  tags: Map<string, string[]>; // tag -> ids
}

export function buildIndex(notes: Note[]): VaultIndex {
  const byTitle = new Map<string, Note>();
  // prioridade: título > caminho completo > alias (o primeiro que chegar fica)
  for (const n of notes) {
    const k = normalizeKey(titleOf(n.path));
    if (!byTitle.has(k)) byTitle.set(k, n);
  }
  for (const n of notes) {
    const full = normalizeKey(n.path);
    if (!byTitle.has(full)) byTitle.set(full, n);
  }
  for (const n of notes) {
    const fm = frontmatter(n.content);
    for (const a of [...(fm.aliases ?? []), ...(fm.alias ?? [])]) {
      const k = normalizeKey(a);
      if (k && !byTitle.has(k)) byTitle.set(k, n);
    }
  }
  const lookup = (l: string) => byTitle.get(normalizeKey(l)) ?? bySuffix(notes, l);
  const outgoing = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  const tags = new Map<string, string[]>();
  for (const n of notes) {
    const outs: string[] = [];
    const missing: string[] = [];
    for (const l of extractLinks(n.content)) {
      const target = lookup(l);
      if (target) {
        if (target.id !== n.id && !outs.includes(target.id)) outs.push(target.id);
      } else missing.push(l);
    }
    outgoing.set(n.id, outs);
    if (missing.length) unresolved.set(n.id, missing);
    for (const t of outs) {
      const arr = backlinks.get(t) ?? [];
      arr.push(n.id);
      backlinks.set(t, arr);
    }
    for (const tag of extractTags(n.content)) {
      const arr = tags.get(tag) ?? [];
      arr.push(n.id);
      tags.set(tag, arr);
    }
  }
  return { byTitle, outgoing, backlinks, unresolved, tags };
}

/** [[Sub/Nota]] quando a nota está em "Pasta/Sub/Nota.md" */
function bySuffix(notes: Note[], l: string): Note | undefined {
  const k = normalizeKey(l);
  if (!k.includes('/')) return undefined;
  return notes.find((n) => normalizeKey(n.path).endsWith(`/${k}`));
}

export function resolveLink(index: VaultIndex, target: string): Note | undefined {
  const k = normalizeKey(target);
  const hit = index.byTitle.get(k);
  if (hit) return hit;
  if (!k.includes('/')) return undefined;
  for (const n of index.byTitle.values()) if (normalizeKey(n.path).endsWith(`/${k}`)) return n;
  return undefined;
}
