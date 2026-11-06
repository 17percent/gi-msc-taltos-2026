import { randomBytes } from 'node:crypto';

/** A slug alapjának felső hossza; az ütközési utótag ezen felül jön (`-` + 6 hexa). */
export const SLUG_BASE_MAX = 80;

/** Az egyedi slug keresésének kísérletei: az első az utótag nélküli alak, a többi rövid véletlen utótaggal. */
export const SLUG_ATTEMPTS = 6;

/**
 * A címből képzett slug (D59 g): kisbetű, az ékezet lemosva (NFD), minden más karakter-sorozat egy kötőjel.
 * Csak ASCII betű és számjegy marad; ha ebből semmi sem marad (pl. csak írásjel), a `dokumentum` az alap.
 */
export function slugify(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, '');
  return base === '' ? 'dokumentum' : base;
}

/** A `n`. kísérlet slugja: 0 az alap, utána `alap-xxxxxx` (a `documents_space_slug_uq` az archiváltakra is érvényes). */
export function slugAttempt(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
}
