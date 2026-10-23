import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Double-submit CSRF-token (D26, D53), a munkamenethez kötve: a nyers session-token HMAC-je.
 * A session-token httpOnly sütiben él, a támadó oldal nem olvassa, ezért a belőle számított token sem
 * jósolható; a `GET /me` adja a SPA-nak, amely az `X-CSRF-Token` fejlécben küldi vissza. Külön szerver-kulcs
 * és külön tárolt érték nem kell: a token a session megszűnésével érvénytelen.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update('taltos-csrf-v1').digest('base64url');
}

/** Időzítés-biztos összehasonlítás; hiányzó vagy rossz hosszú érték egyszerűen hamis. */
export function csrfTokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
