import { EditorView } from '@codemirror/view';

/**
 * A szerkesztő megjelenése: kizárólag szemantikus DS-token (`var(--…)`), így a sötét téma
 * a `data-theme="dark"` váltással ingyen jár. Nyers szín és px nincs.
 */
export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'var(--surface)',
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-base)',
    minHeight: '60dvh',
    borderRadius: 'var(--radius-lg)',
  },
  '&.cm-focused': { outline: 'none', boxShadow: 'var(--focus-ring)' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--leading-normal)' },
  '.cm-content': {
    padding: 'var(--space-4)',
    caretColor: 'var(--text)',
    maxWidth: 'var(--read-width)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--secondary-soft)' },

  // Élő előnézet (D40)
  '.cm-lp-h1': { fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-semibold)' },
  '.cm-lp-h2': { fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)' },
  '.cm-lp-h3': { fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)' },
  '.cm-lp-h4, .cm-lp-h5, .cm-lp-h6': {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--weight-semibold)',
  },
  '.cm-lp-h1, .cm-lp-h2, .cm-lp-h3, .cm-lp-h4, .cm-lp-h5, .cm-lp-h6': {
    lineHeight: 'var(--leading-snug)',
    paddingTop: 'var(--space-2)',
  },
  '.cm-lp-strong': { fontWeight: 'var(--weight-bold)' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-link': { color: 'var(--secondary)', textDecoration: 'underline' },
  '.cm-lp-bullet': { color: 'var(--text-muted)', paddingInline: 'var(--space-1)' },
  '.cm-lp-ordered': { color: 'var(--text-muted)' },

  // Távoli kurzorok: a névcímke szövege a háttérszínhez (mindkét témában) választott token.
  '.cm-ySelectionInfo': {
    color: 'var(--text-inverse)',
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-semibold)',
    // A névcímke mindig látszik (WP3 kész-kritérium), nem csak rámutatáskor.
    opacity: '1',
    paddingInline: 'var(--space-1)',
    borderRadius: 'var(--radius-sm)',
    zIndex: 'var(--z-raised)',
  },
});
