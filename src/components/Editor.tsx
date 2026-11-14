import { useEffect, useRef } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { openMenu, type MenuItem } from './Overlays';
import {
  copySel, insertBlock, insertText, linePrefix, nowStamp, pasteText, run, selectedText, todayIso, wrap,
} from '../lib/editorCommands';

export interface EditorActions {
  /** cria uma nota com o texto e devolve o título (para trocar a seleção por [[título]]) */
  extract?: (text: string) => Promise<string | null>;
  /** busca o texto em todas as notas */
  search?: (text: string) => void;
  /** abre a nota de um [[link]] */
  openLink?: (target: string, newTab: boolean) => void;
}

/** Itens do menu do botão direito do editor (estilo Obsidian). */
export function editorMenu(v: EditorView, actions: EditorActions): MenuItem[] {
  const sel = selectedText(v);
  const has = sel.length > 0;
  const pos = v.state.selection.main.head;
  const line = v.state.doc.lineAt(pos);
  // [[link]] sob o cursor
  let link: string | null = null;
  for (const m of line.text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const a = line.from + m.index!, b = a + m[0].length;
    if (pos >= a && pos <= b) link = m[1].trim();
  }
  const linkItems: MenuItem[] = link ? [
    { label: `Abrir “${link}”`, icon: '↗', run: () => actions.openLink?.(link!, false) },
    { label: 'Abrir em nova aba', icon: '⧉', run: () => actions.openLink?.(link!, true) },
    'sep',
  ] : [];
  return [
    ...linkItems,
    { label: 'Recortar', icon: '✂', hint: 'Ctrl+X', disabled: !has, run: () => void copySel(v, true) },
    { label: 'Copiar', icon: '⎘', hint: 'Ctrl+C', disabled: !has, run: () => void copySel(v) },
    { label: 'Colar', icon: '📋', hint: 'Ctrl+V', run: () => void pasteText(v) },
    { label: 'Colar sem formatação', icon: '📄', hint: 'Ctrl+Shift+V', run: () => void pasteText(v, true) },
    { label: 'Selecionar tudo', icon: '▭', hint: 'Ctrl+A', run: () => { run.selectAll(v); v.focus(); } },
    'sep',
    {
      label: 'Formatar', icon: 'A', submenu: [
        { label: 'Negrito', icon: 'B', hint: 'Ctrl+B', run: () => wrap(v, '**') },
        { label: 'Itálico', icon: 'I', hint: 'Ctrl+I', run: () => wrap(v, '*') },
        { label: 'Tachado', icon: 'S', run: () => wrap(v, '~~') },
        { label: 'Destacar', icon: '🖍', run: () => wrap(v, '==') },
        { label: 'Código', icon: '‹›', run: () => wrap(v, '`', '`', 'código') },
        { label: 'Comentário (oculto na leitura)', icon: '%', run: () => wrap(v, '%%', '%%', 'comentário') },
        'sep',
        { label: 'Limpar formatação', icon: '⌫', disabled: !has, run: () => insertText(v, sel.replace(/(\*\*|__|~~|==|`|\*|_)/g, '')) },
      ],
    },
    {
      label: 'Parágrafo', icon: '¶', submenu: [
        { label: 'Título 1', icon: 'H1', run: () => linePrefix(v, '# ') },
        { label: 'Título 2', icon: 'H2', run: () => linePrefix(v, '## ') },
        { label: 'Título 3', icon: 'H3', run: () => linePrefix(v, '### ') },
        { label: 'Título 4', icon: 'H4', run: () => linePrefix(v, '#### ') },
        'sep',
        { label: 'Lista com marcadores', icon: '•', run: () => linePrefix(v, '- ') },
        { label: 'Lista numerada', icon: '1.', run: () => linePrefix(v, (i) => `${i + 1}. `) },
        { label: 'Lista de tarefas', icon: '☐', run: () => linePrefix(v, '- [ ] ') },
        { label: 'Citação', icon: '❝', run: () => linePrefix(v, '> ') },
        { label: 'Texto normal', icon: '¶', run: () => linePrefix(v, '') },
      ],
    },
    {
      label: 'Inserir', icon: '＋', submenu: [
        { label: 'Link para nota  [[ ]]', icon: '🔗', run: () => wrap(v, '[[', ']]', '') },
        { label: 'Link externo', icon: '🌐', hint: 'Ctrl+K', run: () => (has ? insertText(v, `[${sel}](https://)`, sel.length + 3) : insertText(v, '[texto](https://)', 1)) },
        { label: 'Tag', icon: '#', run: () => insertText(v, '#') },
        { label: 'Tabela', icon: '▦', run: () => insertBlock(v, '| Coluna 1 | Coluna 2 |\n| --- | --- |\n| $SEL | |\n', 2) },
        { label: 'Bloco de código', icon: '{}', run: () => insertBlock(v, '```\n$SEL\n```\n', 4) },
        { label: 'Callout / destaque', icon: 'ℹ', run: () => insertBlock(v, '> [!tip] Título\n> $SEL\n', 9) },
        { label: 'Linha horizontal', icon: '—', run: () => insertBlock(v, '\n---\n', 5) },
        { label: 'Nota de rodapé', icon: '¹', run: () => insertText(v, '[^1]') },
        'sep',
        { label: 'Data de hoje', icon: '📅', run: () => insertText(v, todayIso()) },
        { label: 'Data e hora', icon: '🕒', run: () => insertText(v, nowStamp()) },
      ],
    },
    'sep',
    { label: 'Extrair seleção para nova nota', icon: '⇱', disabled: !has || !actions.extract, run: async () => {
      const r = v.state.selection.main;
      const title = await actions.extract!(sel);
      if (title) v.dispatch({ changes: { from: r.from, to: r.to, insert: `[[${title}]]` } });
    } },
    { label: 'Buscar seleção no cofre', icon: '⌕', disabled: !has || !actions.search, run: () => actions.search!(sel.slice(0, 120)) },
    { label: 'Localizar e substituir', icon: '🔍', hint: 'Ctrl+F', run: () => run.search(v) },
    'sep',
    { label: 'Desfazer', icon: '↶', hint: 'Ctrl+Z', run: () => { run.undo(v); v.focus(); } },
    { label: 'Refazer', icon: '↷', hint: 'Ctrl+Y', run: () => { run.redo(v); v.focus(); } },
  ];
}

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
  actions?: EditorActions;
}

export function Editor({ docId, value, titles, onChange, onReady, actions }: Props) {
  const actionsRef = useRef<EditorActions>({});
  actionsRef.current = actions ?? {};
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
        // Enter continua listas/tarefas/citações; Enter em item vazio encerra a lista
        Prec.high(keymap.of([
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Backspace', run: deleteMarkupBackward },
        ])),
        keymap.of([
          { key: 'Mod-b', run: (v) => (wrap(v, '**'), true) },
          { key: 'Mod-i', run: (v) => (wrap(v, '*'), true) },
          { key: 'Mod-k', run: (v) => { const s = selectedText(v); insertText(v, s ? `[${s}](https://)` : '[texto](https://)', s ? s.length + 3 : 1); return true; } },
          { key: 'Mod-Shift-v', run: (v) => (void pasteText(v, true), true) },
          { key: 'Mod-y', run: (v) => run.redo(v) },
          indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap,
        ]),
        EditorView.domEventHandlers({
          contextmenu: (e, v) => {
            // no celular (toque) mantém a barra nativa de seleção do sistema
            if (!window.matchMedia('(pointer: fine)').matches) return false;
            // clique direito fora da seleção move o cursor para o ponto clicado
            const at = v.posAtCoords({ x: e.clientX, y: e.clientY });
            const r = v.state.selection.main;
            if (at !== null && (r.empty || at < r.from || at > r.to)) v.dispatch({ selection: { anchor: at } });
            openMenu(e, editorMenu(v, actionsRef.current));
            return true;
          },
        }),
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
      // aplica só o trecho que mudou (preserva cursor e deixa o Ctrl+Z preciso)
      let a = 0;
      while (a < cur.length && a < value.length && cur[a] === value[a]) a++;
      let b = 0;
      while (b < cur.length - a && b < value.length - a && cur[cur.length - 1 - b] === value[value.length - 1 - b]) b++;
      v.dispatch({ changes: { from: a, to: cur.length - b, insert: value.slice(a, value.length - b) } });
    }
  }, [value]);

  return <div className="editor" ref={host} />;
}
