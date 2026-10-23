import type { MeResponse } from '@taltos/shared';

/** Az idő forrása; tesztben időutazásra cserélhető. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Az OIDC-szolgáltatótól kapott, ellenőrzött identitás (az `email` kisbetűs és megerősített). */
export interface OidcIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** A `sessions` sor a felhasználóval és az allowlist-állapottal együtt (egyetlen index-keresés). */
export interface SessionRow {
  userId: string;
  lastSeenAt: Date;
  expiresAt: Date;
  systemRole: 'user' | 'system_admin';
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  /** A felhasználó e-mailje aktív allowlist-bejegyzés (D5: kérésenkénti ellenőrzés). */
  onAllowlist: boolean;
}

export type LoginOutcome =
  | { status: 'ok'; userId: string }
  | { status: 'not_on_allowlist' }
  /** D54: még nincs Rendszeradmin, és a belépő nem a `BOOTSTRAP_ADMIN_EMAIL`: a rendszer még nincs beállítva. */
  | { status: 'setup_pending' }
  /** Az e-mail egy másik OIDC-azonosítóhoz tartozó sorhoz van kötve: nem adjuk át (az `oidc_sub` az identitás). */
  | { status: 'identity_conflict' };

/**
 * A hitelesítés adatelérési varrata. A PostgreSQL-megvalósítás az éles; a tesztek memóriabeli párt
 * használnak, a közös szerződést a `store-contract` teszt mindkettőn lefuttatja.
 * A lejárat- és tétlenség-döntés NEM itt van (a szolgáltatás hozza az órával), a tár csak ír és olvas.
 */
export interface AuthStore {
  createSession(input: { id: Buffer; userId: string; now: Date; expiresAt: Date }): Promise<void>;
  findSession(id: Buffer): Promise<SessionRow | undefined>;
  /** A `last_seen_at` előreléptetése, de csak ha az értéke régebbi a `staleBefore`-nál (ritkított írás, D51a). */
  touchSession(id: Buffer, now: Date, staleBefore: Date): Promise<void>;
  /** Visszavonás: `expires_at = legkorábbi(expires_at, now)` (az app szerepnek nincs DELETE joga a `sessions`-on). */
  revokeSession(id: Buffer, now: Date): Promise<void>;
  /** Első belépés: allowlist-kapu, `users` upsert, rendszerindítás (D52, D54: csak a bootstrap e-mail) vagy Szerző az Általánosban (D43). */
  login(identity: OidcIdentity, now: Date): Promise<LoginOutcome>;
  spacesOf(userId: string): Promise<MeResponse['spaces']>;
}
