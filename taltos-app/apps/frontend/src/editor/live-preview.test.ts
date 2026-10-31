import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { computePreviewItems, hiddenRanges, livePreview } from './live-preview';

function stateOf(doc: string, anchor = 0, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown()],
  });
}

/** A rejtett tartományok szövege, hogy a teszt olvasható legyen. */
function hiddenTexts(state: EditorState): string[] {
  return hiddenRanges(state).map((r) => state.sliceDoc(r.from, r.to));
}

describe('élő előnézet: címsor', () => {
  const doc = 'Bevezető\n\n## Fejezet cím\n\nvége';

  it('más sorra álló kurzornál a jelölő és a szóköz rejtett', () => {
    expect(hiddenTexts(stateOf(doc, 0))).toEqual(['## ']);
  });

  it('a címsor során a jelölő látható', () => {
    expect(hiddenTexts(stateOf(doc, doc.indexOf('Fejezet') + 3))).toEqual([]);
  });

  it('a sor osztályt kap a szintje szerint', () => {
    const items = computePreviewItems(stateOf(doc, 0));
    expect(items).toContainEqual({ kind: 'line', from: doc.indexOf('##'), className: 'cm-lp-h2' });
  });

  it('a záró #-jel is rejtett', () => {
    expect(hiddenTexts(stateOf('x\n\n# Cím #\n', 0))).toEqual(['# ', '#']);
  });
});

describe('élő előnézet: kiemelés', () => {
  const doc = 'elöl\n\n**vastag** és *dőlt*\n';

  it('kívül álló kurzornál a csillagok rejtettek, a szöveg megjelölt', () => {
    const state = stateOf(doc, 0);
    expect(hiddenTexts(state)).toEqual(['**', '**', '*', '*']);
    const marks = computePreviewItems(state).filter((i) => i.kind === 'mark');
    expect(
      marks.map((m) => [
        state.sliceDoc(m.from, (m as { to: number }).to),
        m.kind === 'mark' && m.className,
      ]),
    ).toEqual([
      ['**vastag**', 'cm-lp-strong'],
      ['*dőlt*', 'cm-lp-em'],
    ]);
  });

  it('a kurzort tartalmazó soron semmi sem rejtett', () => {
    expect(hiddenTexts(stateOf(doc, doc.indexOf('vastag') + 2))).toEqual([]);
  });

  it('többsoros kijelölés minden érintett sort felfed', () => {
    const state = stateOf('# A\n\n**b**\n\n*c*\n', 0, 10);
    expect(hiddenTexts(state)).toEqual(['*', '*']);
  });
});

describe('élő előnézet: lista', () => {
  const doc = 'elöl\n\n- egy\n- kettő\n\n1. első\n';

  it('a felsoroláspont cserélt, a számozás látható marad', () => {
    const state = stateOf(doc, 0);
    const bullets = computePreviewItems(state).filter((i) => i.kind === 'bullet');
    expect(bullets.map((b) => state.sliceDoc(b.from, (b as { to: number }).to))).toEqual([
      '-',
      '-',
    ]);
    const ordered = computePreviewItems(state).filter(
      (i) => i.kind === 'mark' && i.className === 'cm-lp-ordered',
    );
    expect(ordered).toHaveLength(1);
    expect(hiddenTexts(state)).toEqual(['-', '-']);
  });

  it('az aktív soron a felsoroláspont a forrásjel marad', () => {
    expect(hiddenTexts(stateOf(doc, doc.indexOf('- egy') + 3))).toEqual(['-']);
  });
});

describe('élő előnézet: link', () => {
  const doc = 'elöl\n\n[szöveg](https://example.test/x)\n';

  it('a zárójelek és az URL rejtettek, a szöveg link-stílust kap', () => {
    const state = stateOf(doc, 0);
    expect(hiddenTexts(state)).toEqual(['[', '](https://example.test/x)']);
    const link = computePreviewItems(state).find((i) => i.kind === 'mark');
    expect(link && state.sliceDoc(link.from, (link as { to: number }).to)).toBe('szöveg');
  });

  it('az aktív soron a teljes forrás látható', () => {
    expect(hiddenTexts(stateOf(doc, doc.indexOf('szöveg') + 1))).toEqual([]);
  });

  it('az üres szövegű link nem dob, a jelölői rejtettek', () => {
    const empty = 'elöl\n\n[](https://example.test/x)\n';
    const state = EditorState.create({
      doc: empty,
      selection: { anchor: 0 },
      extensions: [markdown(), livePreview],
    });
    expect(() => state.field(livePreview)).not.toThrow();
    expect(
      () => state.update({ changes: { from: empty.length, insert: 'x' } }).state,
    ).not.toThrow();
    expect(computePreviewItems(state).some((i) => i.kind === 'mark')).toBe(false);
    expect(hiddenTexts(state)).toEqual(['[', '](https://example.test/x)']);
  });

  it('a hivatkozás-definíciós link forrásként marad', () => {
    expect(hiddenTexts(stateOf('x\n\n[szöveg][ref]\n\n[ref]: https://example.test/\n', 0))).toEqual(
      [],
    );
  });
});

describe('élő előnézet: nyers HTML', () => {
  it('a nyers HTML forrásként látszik, nem kap dekorációt', () => {
    const doc = 'x\n\n<script>alert(1)</script>\n\nszó <b>fél</b>\n';
    const state = stateOf(doc, 0);
    expect(computePreviewItems(state)).toEqual([]);
  });
});
