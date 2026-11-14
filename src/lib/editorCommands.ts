import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { undo, redo, selectAll } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';

/** Envolve a seleção com marcadores (ou remove, se já estiver envolvida). */
export function wrap(view: EditorView, before: string, after = before, placeholder = 'texto') {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const outside = state.sliceDoc(r.from - before.length, r.from) === before && state.sliceDoc(r.to, r.to + after.length) === after;
    if (outside) {
      return {
        changes: [{ from: r.from - before.length, to: r.from }, { from: r.to, to: r.to + after.length }],
        range: EditorSelection.range(r.from - before.length, r.to - before.length),
      };
    }
    const text = state.sliceDoc(r.from, r.to);
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
      const inner = text.slice(before.length, text.length - after.length);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    const body = text || placeholder;
    return {
      changes: { from: r.from, to: r.to, insert: before + body + after },
      range: EditorSelection.range(r.from + before.length, r.from + before.length + body.length),
    };
  }));
  view.focus();
}

const PREFIX_RE = /^(\s*)(#{1,6} |> \[![^\]]*\] ?|> |- \[[ xX]\] |[-*+] |\d+\. )?/;

/** Aplica um prefixo de linha (título, lista, citação…) em todas as linhas selecionadas. */
export function linePrefix(view: EditorView, prefix: string | ((i: number) => string)) {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l);
  }
  const sample = typeof prefix === 'string' ? prefix : prefix(0);
  const all = [...lines].map((n) => state.doc.line(n));
  // se todas já têm esse prefixo, remove (alternar)
  const allHave = all.every((l) => (l.text.match(PREFIX_RE)?.[2] ?? '') === sample);
  const changes = all.map((l, i) => {
    const m = l.text.match(PREFIX_RE)!;
    const from = l.from + m[1].length;
    const to = from + (m[2]?.length ?? 0);
    return { from, to, insert: allHave ? '' : typeof prefix === 'string' ? prefix : prefix(i) };
  });
  view.dispatch({ changes });
  view.focus();
}

export function insertText(view: EditorView, text: string, cursorOffset = text.length) {
  const r = view.state.selection.main;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + cursorOffset } });
  view.focus();
}

/** Insere um bloco em linha própria (código, tabela, linha horizontal). */
export function insertBlock(view: EditorView, block: string, cursorInBlock: number) {
  const { state } = view;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.from);
  const sel = state.sliceDoc(r.from, r.to);
  const needNl = line.text.trim() && r.from !== line.from ? '\n' : '';
  const text = needNl + block.replace('$SEL', sel);
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + needNl.length + cursorInBlock } });
  view.focus();
}

export const selectedText = (view: EditorView) => {
  const r = view.state.selection.main;
  return view.state.sliceDoc(r.from, r.to);
};

export async function copySel(view: EditorView, cut = false) {
  const text = selectedText(view);
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { document.execCommand(cut ? 'cut' : 'copy'); return; }
  if (cut) { const r = view.state.selection.main; view.dispatch({ changes: { from: r.from, to: r.to } }); }
  view.focus();
}

export async function pasteText(view: EditorView, plain = false) {
  try {
    const text = await navigator.clipboard.readText();
    insertText(view, plain ? text.replace(/[*_`~]/g, '') : text);
  } catch {
    view.focus();
    document.execCommand('paste');
  }
}

export const run = { undo, redo, selectAll, search: openSearchPanel };

const pad = (n: number) => String(n).padStart(2, '0');
export const nowStamp = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
