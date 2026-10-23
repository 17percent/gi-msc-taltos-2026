import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildOptions } from '../app.js';
import { csrfTokenFor } from '../auth/csrf.js';
import { sessionCookieName } from '../auth/guard.js';
import { LoginRejected, type LoginTransaction, type OidcFlow } from '../auth/oidc.js';
import { SessionService, TOUCH_INTERVAL_MS } from '../auth/session-service.js';
import type { Clock, OidcIdentity } from '../auth/types.js';
import type { AppConfig } from '../config.js';
import { MemoryAuthStore } from './memory-store.js';

export const TEST_ORIGIN = 'http://localhost:5173';

export const TEST_CONFIG: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  version: 'test',
  allowedOrigins: [TEST_ORIGIN],
  trustProxy: false,
  publicOrigin: 'http://localhost:8080',
  oidcIssuer: 'https://idp.example/',
  oidcClientId: 'teszt-kliens',
  cookieSecure: false,
  bootstrapAdminEmail: 'owner@example.test',
  allowlistFile: '/nincs/allowlist.txt',
  sessionAbsoluteMs: 8 * 60 * 60_000,
  sessionIdleMs: 60 * 60_000,
};

/** Kézzel léptethető óra az időutazásos tesztekhez. */
export class TestClock {
  private current: number;

  constructor(start: Date = new Date('2026-10-23T08:00:00Z')) {
    this.current = start.getTime();
  }

  readonly now: Clock = () => new Date(this.current);

  advance(ms: number): void {
    this.current += ms;
  }
}

/** Az OIDC-varrat tesztpárja (nem IdP-mock: az éles flow-t az `openid-client` adja, ez csak a hívás kimenetét szabja). */
export class FakeOidc implements OidcFlow {
  /** Az utolsó `finish` hívás paraméterei. */
  finished: { url: URL; tx: LoginTransaction } | undefined;
  /** `Error`: a `finish` ezt dobja; identitás: ezt adja vissza. */
  result: OidcIdentity | Error = new LoginRejected('no_email');
  tx: LoginTransaction = { state: 'state-1', nonce: 'nonce-1', codeVerifier: 'verifier-1' };

  start(): Promise<{ url: URL; tx: LoginTransaction }> {
    return Promise.resolve({
      url: new URL(`https://idp.example/authorize?state=${this.tx.state}`),
      tx: this.tx,
    });
  }

  finish(url: URL, tx: LoginTransaction): Promise<OidcIdentity> {
    this.finished = { url, tx };
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

export interface TestContext {
  app: FastifyInstance;
  store: MemoryAuthStore;
  clock: TestClock;
  oidc: FakeOidc;
  config: AppConfig;
  /** Session-injektálás (D49): kész süti és CSRF-token egy allowlistes felhasználónak. */
  signIn(email: string, role?: 'user' | 'system_admin'): Promise<TestSession>;
}

export interface TestSession {
  userId: string;
  token: string;
  cookie: string;
  csrf: string;
  /** Fejlécek egy böngészős, mutáló kéréshez. */
  headers: Record<string, string>;
}

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: BuildOptions = {},
): Promise<TestContext> {
  const config = { ...TEST_CONFIG, ...overrides };
  const store = new MemoryAuthStore(config.bootstrapAdminEmail);
  const clock = new TestClock();
  const oidc = new FakeOidc();
  const app = await buildApp(
    config,
    { store, oidc, cookieSecret: 'teszt-kulcs', clock: clock.now },
    options,
  );
  const sessions = new SessionService(
    store,
    {
      absoluteMs: config.sessionAbsoluteMs,
      idleMs: config.sessionIdleMs,
      touchIntervalMs: TOUCH_INTERVAL_MS,
    },
    clock.now,
  );

  return {
    app,
    store,
    clock,
    oidc,
    config,
    async signIn(email, role = 'user') {
      store.allow(email);
      const user = store.addUser(email, role);
      const { token } = await sessions.issue(user.id);
      const csrf = csrfTokenFor(token);
      const cookie = `${sessionCookieName(config.cookieSecure)}=${token}`;
      return {
        userId: user.id,
        token,
        cookie,
        csrf,
        headers: { cookie, origin: TEST_ORIGIN, 'x-csrf-token': csrf },
      };
    },
  };
}
