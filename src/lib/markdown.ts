import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import type { VaultIndex } from './links';
import { resolveLink } from './links';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CALLOUT_ICONS: Record<string, string> = {
  note: '📝', info: 'ℹ️', tip: '💡', warning: '⚠️', danger: '⛔', success: '✅', question: '❓', quote: '❝', todo: '☑️',
};

export function renderMarkdown(md: string, index: VaultIndex): string {
  const marked = new Marked({ gfm: true, breaks: true });

  marked.use({
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start: (src: string) => src.indexOf('[['),
        tokenizer(src: string) {
          const m = /^!?\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]*))?\]\]/.exec(src);
          if (!m) return undefined;
          return { type: 'wikilink', raw: m[0], target: m[1].trim(), alias: m[4]?.trim() };
        },
        renderer(token) {
          const t = token as unknown as { target: string; alias?: string };
          const exists = !!resolveLink(index, t.target);
          const label = esc(t.alias || t.target);
          return `<a class="wikilink${exists ? '' : ' unresolved'}" data-note="${esc(t.target)}" href="#">${label}</a>`;
        },
      },
      {
        name: 'tag',
        level: 'inline',
        start: (src: string) => {
          const i = src.search(/(^|\s)#[\p{L}_]/u);
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = /^(\s?)#([\p{L}_][\p{L}\p{N}_/-]*)/u.exec(src);
          if (!m) return undefined;
          return { type: 'tag', raw: m[0], lead: m[1], tag: m[2] };
        },
        renderer(token) {
          const t = token as unknown as { lead: string; tag: string };
          return `${t.lead}<a class="tag" data-tag="${esc(t.tag)}" href="#">#${esc(t.tag)}</a>`;
        },
      },
    ],
  });

  let html = marked.parse(md, { async: false }) as string;

  // Callouts estilo "> [!tip] Título"
  html = html.replace(
    /<blockquote>\s*<p>\[!(\w+)\]([^<\n]*)(?:<br>)?([\s\S]*?)<\/blockquote>/g,
    (_m, kind: string, title: string, rest: string) => {
      const k = kind.toLowerCase();
      const icon = CALLOUT_ICONS[k] ?? '📌';
      const head = title.trim() || k.charAt(0).toUpperCase() + k.slice(1);
      return `<div class="callout callout-${k}"><div class="callout-title">${icon} ${head}</div><div class="callout-body"><p>${rest}</div></div>`;
    },
  );

  // Checkboxes clicáveis: numera para mapear de volta à linha do markdown
  let i = 0;
  html = html.replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_m, checked) =>
    `<input type="checkbox" class="task" data-task="${i++}" ${checked ? 'checked' : ''}>`,
  );

  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-note', 'data-tag', 'data-task', 'target'] });
}

/** Alterna o n-ésimo checkbox "- [ ]" do markdown. */
export function toggleTask(md: string, n: number): string {
  let count = -1;
  return md.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/gm, (m, a, state, b) => {
    count++;
    if (count !== n) return m;
    return `${a}${state === ' ' ? 'x' : ' '}${b}`;
  });
}
