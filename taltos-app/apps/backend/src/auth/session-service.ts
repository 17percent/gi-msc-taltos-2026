import { createHash, randomBytes } from 'node:crypto';
import { csrfTokenFor } from './csrf.js';
import type { AuthStore, Clock, SessionRow } from './types.js';

export interface SessionPolicy {
  /** Abszolút lejárat a létrehozástól (8 óra, B5 A1). */
  absoluteMs: number;
  /** Tétlenségi idő az utolsó aktivitástól (60 perc). */
  idleMs: number;
  /** A `last_seen_at` írásának legkisebb köze (percenként egyszer, D51a). */
  touchIntervalMs: number;
}

export const TOUCH_INTERVAL_MS = 60_000;

/** A hitelesített kérés munkamenete; `id` a token SHA-256 hash-e (a nyers token nem tárolódik). */
export interface AuthSession {
  id: Buffer;
  userId: string;
  systemRole: SessionRow['systemRole'];
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  onAllowlist: boolean;
  csrfToken: string;
}

/** 32 véletlen bájt, base64url: pontosan 43 karakter. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * A munkamenet életciklusa: kiadás, érvényesítés (abszolút + tétlenségi lejárat, ritkított aktivitás-jelzés),
 * visszavonás. Az idő az injektált órából jön. A `last_seen_at` legfeljebb egy `touchIntervalMs`-nyit késik,
 * ezért a tétlenségi kiléptetés legfeljebb ennyivel korábban léphet életbe a névleges 60 percnél.
 */
export class SessionService {
  constructor(
    private readonly store: AuthStore,
    private readonly policy: SessionPolicy,
    private readonly clock: Clock,
  ) {}

  async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.policy.absoluteMs);
    await this.store.createSession({ id: hashToken(token), userId, now, expiresAt });
    return { token, expiresAt };
  }

  /** `undefined`: nincs (vagy lejárt / érvénytelen / visszavont) munkamenet. Érvényesnél jelzi az aktivitást. */
  async authenticate(token: string | undefined): Promise<AuthSession | undefined> {
    if (token === undefined || !TOKEN_PATTERN.test(token)) return undefined;
    const row = await this.loadValid(hashToken(token));
    if (row === undefined) return undefined;
    return { ...toSession(hashToken(token), row), csrfToken: csrfTokenFor(token) };
  }

  /**
   * WebSocket-forgalom: a munkamenet még érvényes-e és a cím még az allowlisten van-e; ha igen, aktivitásnak
   * számít (ritkítva). Az allowlistről levett felhasználó munkamenete itt is visszavonódik.
   */
  async recheck(id: Buffer): Promise<boolean> {
    const row = await this.loadValid(id);
    if (row === undefined) return false;
    if (!row.onAllowlist) {
      await this.revoke(id);
      return false;
    }
    return true;
  }

  async revoke(id: Buffer): Promise<void> {
    await this.store.revokeSession(id, this.clock());
  }

  private async loadValid(id: Buffer): Promise<SessionRow | undefined> {
    const row = await this.store.findSession(id);
    if (row === undefined) return undefined;
    const now = this.clock();
    if (now >= row.expiresAt) return undefined;
    const idleFor = now.getTime() - row.lastSeenAt.getTime();
    if (idleFor >= this.policy.idleMs) return undefined;
    if (idleFor >= this.policy.touchIntervalMs) {
      await this.store.touchSession(id, now, new Date(now.getTime() - this.policy.touchIntervalMs));
    }
    return row;
  }
}

function toSession(id: Buffer, row: SessionRow): Omit<AuthSession, 'csrfToken'> {
  return {
    id,
    userId: row.userId,
    systemRole: row.systemRole,
    displayName: row.displayName,
    email: row.email,
    avatarUrl: row.avatarUrl,
    onAllowlist: row.onAllowlist,
  };
}
