import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

/**
 * Élő előnézet (D40, spike-hatókör): a markdown-jelölők rejtettek, és azokon a soron válnak
 * láthatóvá, amelyen a kurzor vagy a kijelölés van. A forrás a Lezer markdown szintaxisfa.
 *
 * Biztonság: a dekorációk csak osztályt, elrejtést és egy szöveges DOM-csomópontú widgetet adnak;
 * HTML-t soha nem szúrnak be. A nyers HTML a szövegben forrásként látszik (nincs rá csomópont-kezelés).
 */

export type PreviewItem =
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'bullet'; from: number; to: number }
  | { kind: 'mark'; from: number; to: number; className: string }
  | { kind: 'line'; from: number; className: string };

const HEADING = /^ATXHeading([1-6])$/;

/** Azok a sorok (kezdőpozíciók), amelyekhez kurzor vagy kijelölés ér. */
function activeLineStarts(state: EditorState): Set<number> {
  const starts = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      starts.add(state.doc.line(n).from);
    }
  }
  return starts;
}

/** Az élő előnézet elemei a teljes dokumentumra; tiszta függvény, tesztelhető. */
export function computePreviewItems(state: EditorState): PreviewItem[] {
  // Rövid időkorláttal bevárjuk a teljes fát, hogy a rejtés ne villogjon félkész elemzésnél.
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const active = activeLineStarts(state);
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).from);
  const items: PreviewItem[] = [];

  const hide = (from: number, to: number) => {
    if (to > from && !isActive(from)) items.push({ kind: 'hide', from, to });
  };

  tree.iterate({
    enter(node) {
      const heading = HEADING.exec(node.name);
      if (heading) {
        items.push({
          kind: 'line',
          from: state.doc.lineAt(node.from).from,
          className: `cm-lp-h${heading[1]}`,
        });
        return;
      }

      switch (node.name) {
        case 'HeaderMark': {
          if (!node.node.parent || !HEADING.test(node.node.parent.name)) return;
          // A záró `#`-ok (sor végén) és a nyitó jel utáni egyetlen szóköz is rejtett.
          const lineEnd = state.doc.lineAt(node.from).to;
          const spaceAfter =
            node.to < lineEnd && state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
          hide(node.from, node.to + spaceAfter);
          return;
        }
        case 'StrongEmphasis':
          items.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-lp-strong' });
          return;
        case 'Emphasis':
          items.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-lp-em' });
          return;
        case 'EmphasisMark':
          hide(node.from, node.to);
          return;
        case 'Link': {
          const link = node.node;
          const url = link.getChild('URL');
          const marks = link.getChildren('LinkMark');
          // Hivatkozás-definíciós (`[a][b]`) linkeket nem érintünk: forrásként látszanak.
          if (!url || marks.length < 2) return;
          const open = marks[0];
          const close = marks[1];
          if (!open || !close) return;
          // Üres szövegű linknél (`[](url)`) nincs mit megjelölni.
          if (close.from > open.to) {
            items.push({ kind: 'mark', from: open.to, to: close.from, className: 'cm-lp-link' });
          }
          hide(open.from, open.to);
          hide(close.from, node.to);
          return;
        }
        case 'ListMark': {
          const list = node.node.parent?.parent?.name;
          if (list === 'BulletList') {
            if (!isActive(node.from)) items.push({ kind: 'bullet', from: node.from, to: node.to });
          } else if (list === 'OrderedList') {
            items.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-lp-ordered' });
          }
          return;
        }
      }
    },
  });

  return items;
}

/** Csak a rejtett (és felcserélt) tartományok; a tesztek és a hibakeresés kedvéért. */
export function hiddenRanges(state: EditorState): { from: number; to: number }[] {
  return computePreviewItems(state)
    .filter((i) => i.kind === 'hide' || i.kind === 'bullet')
    .map((i) => ({ from: i.from, to: (i as { to: number }).to }));
}

/** A felsoroláspont: szöveges DOM-csomópont, nem HTML. */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-lp-bullet';
    span.textContent = '•';
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const hideDecoration = Decoration.replace({});
const bulletDecoration = Decoration.replace({ widget: new BulletWidget() });

function buildDecorations(state: EditorState): DecorationSet {
  // Üres mark-tartomány RangeError-t dobna, és minden tranzakciót megbénítana: védőháló.
  const items = computePreviewItems(state).filter(
    (item) => item.kind !== 'mark' || item.from < item.to,
  );
  const ranges: Range<Decoration>[] = items.map((item) => {
    switch (item.kind) {
      case 'hide':
        return hideDecoration.range(item.from, item.to);
      case 'bullet':
        return bulletDecoration.range(item.from, item.to);
      case 'mark':
        return Decoration.mark({ class: item.className }).range(item.from, item.to);
      case 'line':
        return Decoration.line({ class: item.className }).range(item.from);
    }
  });
  // A második paraméter a startpozíció szerinti rendezést kéri.
  return Decoration.set(ranges, true);
}

/** A dekorációs mező: dokumentum-, kijelölés- vagy szintaxisfa-változáskor épül újra. */
export const livePreview = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
