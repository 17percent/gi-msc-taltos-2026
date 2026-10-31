import { describe, expect, it } from 'vitest';
import { isOwnImageSource, renderMarkdown } from './render-markdown';

describe('renderMarkdown', () => {
  it('az alap markdownból HTML-t készít', () => {
    const html = renderMarkdown(
      '# Cím\n\n**vastag** és *dőlt*\n\n- egy\n- kettő\n\n[link](https://example.test/)',
    );
    expect(html).toContain('<h1>Cím</h1>');
    expect(html).toContain('<strong>vastag</strong>');
    expect(html).toContain('<em>dőlt</em>');
    expect(html).toContain('<li>egy</li>');
    expect(html).toContain('<a href="https://example.test/">link</a>');
  });

  it('a script elemet nem engedi át', () => {
    const html = renderMarkdown('előtte\n\n<script>alert(1)</script>\n\nutána');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('az eseménykezelő attribútumot nem engedi át', () => {
    const html = renderMarkdown(
      '<img src="/static/a.png" onerror="alert(1)">\n\n<p onclick="x()">szöveg</p>',
    );
    expect(html).not.toMatch(/onerror|onclick/i);
    expect(html).not.toContain('<img');
  });

  it('a javascript: linket kiszűri', () => {
    const html = renderMarkdown('[kattints](javascript:alert(1)) és [másik](JaVaScRiPt:alert(2))');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('kattints');
  });

  it('a külső képet nem tölti be', () => {
    for (const src of [
      'https://evil.test/x.png',
      'http://evil.test/x.png',
      '//evil.test/x.png',
      'data:image/png;base64,AAAA',
      '/static/../secret.png',
      '/static//evil.test/x.png',
      'x.png',
    ]) {
      const html = renderMarkdown(`![alt-szöveg](${src})`);
      expect(html, src).not.toContain('<img');
      expect(html, src).not.toContain('src=');
      expect(html, src).toContain('alt-szöveg');
    }
  });

  it('a nyers HTML-ben megadott külső képet is kiszűri', () => {
    expect(renderMarkdown('<img src="https://evil.test/x.png">')).not.toContain('<img');
  });

  it('az alkalmazás saját /static/ képét megtartja', () => {
    const html = renderMarkdown('![ábra](/static/abra.png)');
    expect(html).toContain('<img src="/static/abra.png" alt="ábra">');
  });
});

describe('isOwnImageSource', () => {
  it('csak a /static/ alatti, kiszökés nélküli utat fogadja el', () => {
    expect(isOwnImageSource('/static/a/b.png')).toBe(true);
    expect(isOwnImageSource('/static/')).toBe(false);
    expect(isOwnImageSource('/static/../a.png')).toBe(false);
    expect(isOwnImageSource('//static/a.png')).toBe(false);
    expect(isOwnImageSource('/staticx/a.png')).toBe(false);
    expect(isOwnImageSource(undefined)).toBe(false);
  });
});
