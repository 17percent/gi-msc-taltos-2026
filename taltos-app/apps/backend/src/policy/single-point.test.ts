import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Egyetlen policy-pont (D56, WP4a): jogosultsági döntés csak a `policy/` modulon át születik, és dokumentumot csak
 * a láthatósági feltétellel (vagy az engedélyezett tár-adapterekben) olvasunk. A teszt a forrást olvassa:
 *  - szerep-összehasonlítás (`systemRole ===`, `.role ===`, `'space_manager'`, `'system_admin'`) csak az engedélyezőlistán;
 *  - `from(t.documents)` (és illesztései) csak az engedélyezőlistán, VAGY ha a fájl a `visibleDocumentsWhere`-t is használja.
 * Új kivételt itt, indoklással kell felvenni: az a felülvizsgálat tárgya.
 */

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Engedélyezett fájlok (a `src`-hez képest, `/`-jellel) és az indoklásuk; a `dir/` előtag a teljes könyvtárat jelenti. */
export const ALLOWED: Record<string, string> = {
  'policy/': 'a policy maga: can(), célpontok, tár-adapter, láthatóság',
  'testing/': 'tesztsegédek és memóriabeli tárak',
  'review/': 'a ReviewService írja egyedül a Jóváhagyott állapotot (D45)',
  'db/': 'séma és seed (adatmodell, nem döntés)',
  'auth/allowlist.ts': 'az allowlist-szinkron védelmei (utolsó gazda/admin), SQL-ben',
  'auth/pg-store.ts': 'a bejelentkezés tárolója: rendszerindítás, első belépés szerepei',
  'auth/types.ts': 'a munkamenet-sor típusa (a szerep adat, nem döntés)',
  'http/api.ts': 'a /me válasz-sémájának enumjai (alak, nem döntés)',
  'spaces/guards.ts': 'az aktív Színtérgazda/admin közös SQL-feltétele (WP2 és WP4a)',
  'spaces/space-store-contract.ts': 'tár-szerződés teszt (fixture-szerepek, nem döntés)',
  'spaces/pg-space-store.ts': 'a tagkezelés SQL-je (térzár, utolsó gazda/admin védelem)',
  'realtime/pg-collab-store.ts':
    'a /collab tartalom-betöltése és -mentése (nincs döntés; a mentés TOCTOU-újraellenőrzése nem policy)',
};

const ROLE_PATTERNS: readonly RegExp[] = [
  /systemRole\s*[!=]==/,
  /\.role\s*[!=]==/,
  /'space_manager'/,
  /'system_admin'/,
];
const DOCUMENT_READ = /\b(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*t\.documents\b/;

const isAllowed = (path: string): boolean =>
  Object.keys(ALLOWED).some((entry) =>
    entry.endsWith('/') ? path.startsWith(entry) : path === entry,
  );

/** A megjegyzések kihagyása, hogy a leírás ne okozzon találatot (egyszerű, de a fájlformátumunkra elég). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function violations(path: string, source: string): string[] {
  if (isAllowed(path)) return [];
  const code = stripComments(source);
  const found: string[] = [];
  for (const pattern of ROLE_PATTERNS) {
    if (pattern.test(code)) found.push(`${path}: szerep-összehasonlítás (${pattern.source})`);
  }
  if (DOCUMENT_READ.test(code) && !code.includes('visibleDocumentsWhere')) {
    found.push(`${path}: dokumentum-olvasás látható-feltétel nélkül`);
  }
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('egyetlen policy-pont', () => {
  it('az alkalmazás forrásában nincs szerep-összehasonlítás és védetlen dokumentum-olvasás az engedélyezőlistán kívül', () => {
    const all = sources(SRC).flatMap((file) =>
      violations(relative(SRC, file).split(sep).join('/'), readFileSync(file, 'utf8')),
    );
    expect(all).toEqual([]);
  });

  it('az engedélyezőlista minden bejegyzése létező fájlra vagy könyvtárra mutat', () => {
    const files = sources(SRC).map((file) => relative(SRC, file).split(sep).join('/'));
    for (const entry of Object.keys(ALLOWED)) {
      const hit = entry.endsWith('/')
        ? files.some((file) => file.startsWith(entry))
        : files.includes(entry);
      // a `review/` a WP5-ig még nincs: az előre engedélyezett könyvtár nem hiba
      if (entry !== 'review/') expect(hit, entry).toBe(true);
    }
  });

  describe('az őr tényleg pirosat ad', () => {
    it('szerep-összehasonlítás egy szolgáltatásban', () => {
      expect(
        violations('spaces/service.ts', "if (actor.systemRole === 'user') return;"),
      ).not.toEqual([]);
      expect(violations('spaces/service.ts', 'if (member.role === x) return;')).not.toEqual([]);
      expect(violations('spaces/service.ts', "const r = 'space_manager';")).not.toEqual([]);
    });

    it('dokumentum-olvasás látható-feltétel nélkül, de nem vele', () => {
      const bare = 'db.select().from(t.documents).where(eq(t.documents.id, id));';
      expect(violations('documents/list.ts', bare)).not.toEqual([]);
      expect(violations('documents/list.ts', `${bare} visibleDocumentsWhere(viewerId);`)).toEqual(
        [],
      );
    });

    it('a megjegyzésben említett szerep nem találat, az engedélyezett fájl nem hibás', () => {
      expect(violations('spaces/service.ts', "// a 'space_manager' szerep\nconst a = 1;")).toEqual(
        [],
      );
      expect(violations('policy/policy.ts', "x.systemRole === 'system_admin'")).toEqual([]);
    });
  });
});
