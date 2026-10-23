import { randomUUID } from 'node:crypto';
import type { MeResponse } from '@taltos/shared';
import type { AuthStore, LoginOutcome, OidcIdentity, SessionRow } from '../auth/types.js';

interface MemoryUser {
  id: string;
  sub: string | null;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  systemRole: 'user' | 'system_admin';
}

interface MemorySession {
  userId: string;
  lastSeenAt: Date;
  expiresAt: Date;
}

/**
 * Memóriabeli `AuthStore` az adatbázis nélküli tesztekhez. Csak a varrat szerződését tükrözi (munkamenetek,
 * allowlist-kapu, egyszerű első-belépés); a tényleges SQL-t, a rendszerindítást és a versenyhelyzetet a
 * PostgreSQL elleni integrációs tesztek bizonyítják.
 */
export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, MemoryUser>();
  readonly allowlist = new Set<string>();
  private readonly sessions = new Map<string, MemorySession>();
  private readonly spaceRoles = new Map<string, MeResponse['spaces'][number]>();
  /** A `touchSession` által ténylegesen elvégzett írások száma (a ritkítás ellenőrzéséhez). */
  touchWrites = 0;

  /** A rendszerindító e-mail (D54); alapból a tesztkonfig értéke. */
  constructor(private readonly bootstrapAdminEmail = 'owner@example.test') {}

  allow(email: string): void {
    this.allowlist.add(email.toLowerCase());
  }

  disallow(email: string): void {
    this.allowlist.delete(email.toLowerCase());
  }

  addUser(email: string, systemRole: MemoryUser['systemRole'] = 'user'): MemoryUser {
    const user: MemoryUser = {
      id: randomUUID(),
      sub: `sub-${email}`,
      email: email.toLowerCase(),
      displayName: email.split('@')[0] ?? email,
      avatarUrl: null,
      systemRole,
    };
    this.users.set(user.id, user);
    return user;
  }

  addMembership(userId: string, space: MeResponse['spaces'][number]): void {
    this.spaceRoles.set(`${userId}:${space.id}`, space);
  }

  createSession(input: { id: Buffer; userId: string; now: Date; expiresAt: Date }): Promise<void> {
    this.sessions.set(input.id.toString('hex'), {
      userId: input.userId,
      lastSeenAt: input.now,
      expiresAt: input.expiresAt,
    });
    return Promise.resolve();
  }

  findSession(id: Buffer): Promise<SessionRow | undefined> {
    const session = this.sessions.get(id.toString('hex'));
    const user = session && this.users.get(session.userId);
    if (!session || !user) return Promise.resolve(undefined);
    return Promise.resolve({
      userId: user.id,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      systemRole: user.systemRole,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      onAllowlist: this.allowlist.has(user.email),
    });
  }

  touchSession(id: Buffer, now: Date, staleBefore: Date): Promise<void> {
    const session = this.sessions.get(id.toString('hex'));
    if (session && session.lastSeenAt < staleBefore) {
      session.lastSeenAt = now;
      this.touchWrites += 1;
    }
    return Promise.resolve();
  }

  revokeSession(id: Buffer, now: Date): Promise<void> {
    const session = this.sessions.get(id.toString('hex'));
    if (session && now < session.expiresAt) session.expiresAt = now;
    return Promise.resolve();
  }

  login(identity: OidcIdentity): Promise<LoginOutcome> {
    if (!this.allowlist.has(identity.email)) return Promise.resolve({ status: 'not_on_allowlist' });
    const adminExists = [...this.users.values()].some((user) => user.systemRole === 'system_admin');
    if (!adminExists && identity.email !== this.bootstrapAdminEmail) {
      return Promise.resolve({ status: 'setup_pending' });
    }
    const existing = [...this.users.values()].find(
      (user) => user.sub === identity.sub || user.email === identity.email,
    );
    if (existing) return Promise.resolve({ status: 'ok', userId: existing.id });
    const first = !adminExists;
    const user = this.addUser(identity.email, first ? 'system_admin' : 'user');
    user.sub = identity.sub;
    this.addMembership(user.id, {
      id: 'general',
      name: 'Általános',
      type: 'general',
      role: first ? 'space_manager' : 'author',
    });
    return Promise.resolve({ status: 'ok', userId: user.id });
  }

  spacesOf(userId: string): Promise<MeResponse['spaces']> {
    return Promise.resolve(
      [...this.spaceRoles.entries()]
        .filter(([key]) => key.startsWith(`${userId}:`))
        .map(([, space]) => space),
    );
  }
}
