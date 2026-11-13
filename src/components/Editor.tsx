import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';

const quartzHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', color: 'var(--h1)' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700', color: 'var(--h2)' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600', color: 'var(--h3)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--h3)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', color: 'var(--code)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--faint)' },
  { tag: t.list, color: 'var(--accent)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: 'var(--text)', fontSize: 'var(--editor-size)' },
  '.cm-content': { fontFamily: 'var(--sans)', padding: '24px 0 40vh', maxWidth: '760px', margin: '0 auto', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 24px', lineHeight: '1.7' },
  '.cm-activeLine': { background: 'var(--active-line)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--selection) !important' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-tooltip-autocomplete': { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px' },
  '.cm-panels': { background: 'var(--panel)', color: 'var(--text)' },
});

interface Props {
  docId: string;
  value: string;
  titles: string[];
  onChange: (v: string) => void;
  onReady?: (view: EditorView) => void;
}

export function Editor({ docId, value, titles, onChange, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const titlesRef = useRef(titles);
  const changeRef = useRef(onChange);
  titlesRef.current = titles;
  changeRef.current = onChange;

  // Autocompletar [[links]] com os títulos do vault
  const linkCompletion = (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!m) return null;
    return {
      from: m.from + 2,
      options: titlesRef.current.map((label) => ({ label, apply: `${label}]]`, type: 'text' })),
      validFor: /^[^\]\n]*$/,
    };
  };

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(quartzHighlight),
        autocompletion({ override: [linkCompletion], icons: false }),
        placeholder('Comece a escrever… use [[ para ligar notas'),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) changeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    onReady?.(v);
    return () => v.destroy();
    // recria o editor ao trocar de nota (histórico de desfazer por nota)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Atualização vinda do sync enquanto a nota está aberta
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value && !v.hasFocus) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  return <div className="editor" ref={host} />;
}
