import { describe, expect, it } from 'vitest';
import { displayTagName, NON_BLANK_NO_NUL_PATTERN, normalizeTagName } from './documents.js';

describe('normalizeTagName (D34, D59 g; Unicode-keményítés)', () => {
  it('kisbetű, ékezetmentesítés, szóközök összevonása', () => {
    expect(normalizeTagName('  Gépi   TANULÁS ')).toBe('gepi tanulas');
    expect(normalizeTagName('Őszi Űrlap')).toBe('oszi urlap');
  });

  it('a formázó karakterek (nulla szélességű szóköz stb.) kiesnek: "a​b" és "ab" azonos', () => {
    const plain = normalizeTagName('ab');
    for (const invisible of ['​', '‌', '‍', '⁠', '‮', '⁦', '﻿']) {
      expect(normalizeTagName(`a${invisible}b`), invisible).toBe(plain);
    }
  });

  it('az NFKC a kompatibilitási alakokat egyesíti: a teljes szélességű forma az ASCII megfelelője', () => {
    expect(normalizeTagName('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeTagName('ﬁle')).toBe('file');
  });

  it('a csak formázó karakterekből álló név normalizált alakja üres', () => {
    expect(normalizeTagName('​‍')).toBe('');
  });
});

describe('displayTagName', () => {
  it('a formázó karaktereket elhagyja, az írásmódot megtartja', () => {
    expect(displayTagName('  Gépi​   Tanulás ')).toBe('Gépi Tanulás');
  });
});

describe('NON_BLANK_NO_NUL_PATTERN', () => {
  const re = new RegExp(NON_BLANK_NO_NUL_PATTERN, 'u');
  it('elutasítja a csak szóköz-, formázó- vagy NUL-karakterből állót', () => {
    for (const bad of ['', '   ', '​', ' ​⁠ ', '﻿', 'a\u0000b']) {
      expect(re.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
  it('elfogadja a látható karaktert tartalmazót', () => {
    for (const good of ['a', ' a ', 'Ő', '​a​']) {
      expect(re.test(good), JSON.stringify(good)).toBe(true);
    }
  });
});
