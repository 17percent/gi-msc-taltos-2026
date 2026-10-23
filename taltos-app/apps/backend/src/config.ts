export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  version: string;
  /** A WebSocket-upgrade és a mutáló kérések kötelező `Origin`-ellenőrzésének engedélyezett értékei (B5 A1). */
  allowedOrigins: string[];
  /** A közvetlen reverse proxy címe/hálózata; a Compose-ban a frontend-konténer nginx-e. */
  trustProxy: false | string;
  /** A böngészőben látott origin; az OIDC redirect URI-ja ebből készül (`<origin>/auth/callback`). */
  publicOrigin: string;
  /** Az OIDC-szolgáltató issuer-címe (discovery); fejlesztésben a valódi Google (D49). */
  oidcIssuer: string;
  oidcClientId: string;
  /** A session-süti `Secure` jelzője. Kizárólag a konfigból jön, soha nem az X-Forwarded-Proto-ból. */
  cookieSecure: boolean;
  /** Az allowlist forrása: soronként egy e-mail, `#` megjegyzés (D53). */
  allowlistFile: string;
  /** Abszolút munkamenet-lejárat (B5 A1: 8 óra). */
  sessionAbsoluteMs: number;
  /** Tétlenségi kiléptetés (B5 A1: 60 perc). */
  sessionIdleMs: number;
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:8080'];
const DEV_PUBLIC_ORIGIN = 'http://localhost:8080';
const DEFAULT_OIDC_ISSUER = 'https://accounts.google.com';
const MINUTE_MS = 60_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const origins = parseList(env.ALLOWED_ORIGINS);
  if (production && origins.length === 0) {
    throw new Error('Élesben kötelező az ALLOWED_ORIGINS (vesszővel elválasztott origin-lista).');
  }
  if (production && !env.PUBLIC_ORIGIN) {
    throw new Error('Élesben kötelező a PUBLIC_ORIGIN (a böngészőben látott origin).');
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT ?? '3000'),
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    version: env.APP_VERSION ?? 'dev',
    allowedOrigins: origins.length > 0 ? origins : DEV_ORIGINS,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    publicOrigin: parseOrigin('PUBLIC_ORIGIN', env.PUBLIC_ORIGIN ?? DEV_PUBLIC_ORIGIN),
    oidcIssuer: parseIssuer(env.OIDC_ISSUER ?? DEFAULT_OIDC_ISSUER),
    oidcClientId: required('OIDC_CLIENT_ID', env.OIDC_CLIENT_ID),
    // Alapértelmezés: élesben Secure. A dev-környezet (http) kapcsolja ki kifejezetten.
    cookieSecure: parseBoolean('COOKIE_SECURE', env.COOKIE_SECURE, production),
    allowlistFile: required('ALLOWLIST_FILE', env.ALLOWLIST_FILE),
    sessionAbsoluteMs: parseMinutes('SESSION_ABSOLUTE_MINUTES', env.SESSION_ABSOLUTE_MINUTES, 480),
    sessionIdleMs: parseMinutes('SESSION_IDLE_MINUTES', env.SESSION_IDLE_MINUTES, 60),
  };
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '')
    throw new Error(`Hiányzó kötelező érték: ${name}`);
  return value.trim();
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Érvénytelen PORT: ${value}`);
  }
  return port;
}

function parseOrigin(name: string, value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protokoll');
    return url.origin;
  } catch {
    throw new Error(`Érvénytelen ${name}: ${value} (http(s)://host[:port] alakú origin kell)`);
  }
}

function parseIssuer(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protokoll');
    return url.href;
  } catch {
    throw new Error(`Érvénytelen OIDC_ISSUER: ${value}`);
  }
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Érvénytelen ${name}: ${value} (true vagy false)`);
}

function parseMinutes(name: string, value: string | undefined, fallbackMinutes: number): number {
  if (value === undefined || value === '') return fallbackMinutes * MINUTE_MS;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(`Érvénytelen ${name}: ${value} (pozitív egész percszám kell)`);
  }
  return minutes * MINUTE_MS;
}

/**
 * A közvetlen reverse proxy címe/hálózata (pl. `uniquelocal` vagy `172.18.0.0/16`), vagy `false`.
 * Csak ez az egy hop számít megbízhatónak (lásd http/trust-proxy.ts); `true` vagy hop-szám
 * szándékosan nem támogatott, mert a kliens-IP hamisíthatóvá válna.
 */
function parseTrustProxy(value: string | undefined): false | string {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true' || /^\d+$/.test(value)) {
    throw new Error(
      `Érvénytelen TRUST_PROXY: ${value} (a közvetlen proxy címét vagy hálózatát add meg)`,
    );
  }
  return value;
}
