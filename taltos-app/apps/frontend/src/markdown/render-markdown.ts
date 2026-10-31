import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/**
 * A markdown → HTML útvonal egyetlen belépési pontja (D16): minden nézet, amely markdownból
 * HTML-t renderel, ezt használja. A kimenet nem megbízható forrásból jön, ezért:
 *  - a nyers HTML-t a remark-rehype nem engedi át (`allowDangerousHtml` kikapcsolva);
 *  - a rehype-sanitize az alap (GitHub-szerű) sémával szűr: nincs script, eseménykezelő attribútum,
 *    `javascript:` link;
 *  - kép csak az alkalmazás saját `/static/` útvonaláról jöhet (D15), külső URL-t nem töltünk be.
 */

/** Az alkalmazás saját, feltöltött képeinek útvonala (D15). */
const OWN_IMAGE_PATH = /^\/static\/[^/\\][^\\]*$/;

/** Az URL-séma nélküli, de külső (`//host/…`) vagy kiszökő (`..`) címeket is kiszűri. */
export function isOwnImageSource(src: unknown): src is string {
  if (typeof src !== 'string' || !OWN_IMAGE_PATH.test(src)) return false;
  return !src.split(/[/?#]/).includes('..') && !src.includes('//');
}

export const sanitizeOptions: SanitizeOptions = {
  ...defaultSchema,
  // Üres lista: az `src` nem kaphat sémás (http:, data: …) értéket; a relatív címeket lent szűrjük.
  protocols: { ...defaultSchema.protocols, src: [] },
};

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** A sanitize után: minden `<img>`, amelynek forrása nem a saját `/static/` útvonal, alt-szövegre cserélődik. */
function restrictImages() {
  const walk = (node: HastNode): void => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'element' && child.tagName === 'img') {
        if (isOwnImageSource(child.properties?.src)) return [child];
        const alt = child.properties?.alt;
        return typeof alt === 'string' && alt !== '' ? [{ type: 'text', value: alt }] : [];
      }
      walk(child);
      return [child];
    });
  };
  return (tree: HastNode) => {
    walk(tree);
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize, sanitizeOptions)
  .use(restrictImages)
  .use(rehypeStringify);

/** Markdown → szanitizált HTML-karakterlánc. */
export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}
