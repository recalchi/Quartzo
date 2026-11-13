import type { Note } from './db';
import { normalizeKey, titleOf } from './notes';

const WIKILINK = /!?\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const HEADING = /^(#{1,6})\s+(.+)$/gm;

/** Remove blocos e trechos de código para não capturar links/tags dentro deles. */
function stripCode(md: string) {
  return md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(md).matchAll(WIKILINK)) out.add(m[1].trim());
  return [...out];
}

export function extractTags(md: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(md).matchAll(TAG)) {
    if (!/^\d+$/.test(m[2])) out.add(m[2]);
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
  for (const n of notes) {
    const k = normalizeKey(titleOf(n.path));
    if (!byTitle.has(k)) byTitle.set(k, n);
    const full = normalizeKey(n.path.replace(/\.md$/i, ''));
    if (!byTitle.has(full)) byTitle.set(full, n);
  }
  const outgoing = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  const tags = new Map<string, string[]>();
  for (const n of notes) {
    const outs: string[] = [];
    const missing: string[] = [];
    for (const l of extractLinks(n.content)) {
      const target = byTitle.get(normalizeKey(l));
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

export function resolveLink(index: VaultIndex, target: string): Note | undefined {
  return index.byTitle.get(normalizeKey(target));
}
