/**
 * Ícone de uma nota, definido no frontmatter: `icon: apple`.
 *
 * Valores aceitos:
 *  - nome de marca do Simple Icons (`apple`, `amazonaws`, `nubank`) → logo oficial
 *  - domínio (`site:admtalentos.com.br` ou só `admtalentos.com.br`) → favicon do site
 *  - link de imagem (`https://…png/svg`)
 *  - emoji (`🚀`)
 */
export type NoteIcon = { kind: 'emoji'; text: string } | { kind: 'img'; url: string; fallback: string };

const EMOJI = /\p{Extended_Pictographic}/u;

export function parseIcon(raw: string | undefined | null, label = ''): NoteIcon | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const fallback = (label.trim()[0] ?? '?').toUpperCase();
  if (EMOJI.test(v) && v.length <= 8) return { kind: 'emoji', text: v };
  if (/^https:\/\//i.test(v)) return { kind: 'img', url: v, fallback };
  const site = v.replace(/^site:/i, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (/^site:/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(site)) {
    return { kind: 'img', url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(site)}.ico`, fallback };
  }
  const slug = v.toLowerCase().replace(/^si:/, '').replace(/[^a-z0-9]/g, '');
  if (!slug) return null;
  return { kind: 'img', url: `https://cdn.simpleicons.org/${slug}`, fallback };
}

type Entry = { img: HTMLImageElement; ok: boolean; failed: boolean };
const cache = new Map<string, Entry>();

/** Imagem já carregada (ou null enquanto carrega / se falhou). Carrega sob demanda. */
export function iconImage(url: string): HTMLImageElement | null | false {
  let e = cache.get(url);
  if (!e) {
    const img = new Image();
    // sem crossOrigin: favicons não mandam CORS; só desenhamos, nunca lemos pixels do canvas
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    e = { img, ok: false, failed: false };
    const entry = e;
    img.onload = () => { entry.ok = img.naturalWidth > 0; entry.failed = !entry.ok; };
    img.onerror = () => { entry.failed = true; };
    img.src = url;
    cache.set(url, e);
  }
  if (e.failed) return false;
  return e.ok ? e.img : null;
}

/** Define (ou remove, com valor vazio) o `icon:` no frontmatter da nota. */
export function withIcon(md: string, value: string): string {
  const v = value.trim();
  const fm = md.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (fm) {
    let body = fm[1].split('\n').filter((l) => !/^icon:/i.test(l));
    if (v) body = [`icon: ${v}`, ...body];
    const rest = md.slice(fm[0].length);
    return body.filter((l) => l.trim()).length ? `---\n${body.join('\n')}\n---\n${rest}` : rest.replace(/^\n/, '');
  }
  return v ? `---\nicon: ${v}\n---\n${md}` : md;
}
