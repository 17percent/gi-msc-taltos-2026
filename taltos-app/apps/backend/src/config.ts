export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  version: string;
  /** A WebSocket-upgrade kötelező `Origin`-ellenőrzésének engedélyezett értékei (B5 A1). */
  allowedOrigins: string[];
  /** A közvetlen reverse proxy címe/hálózata; a Compose-ban a frontend-konténer nginx-e. */
  trustProxy: false | string;
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:8080'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const origins = parseList(env.ALLOWED_ORIGINS);
  if (production && origins.length === 0) {
    throw new Error('Élesben kötelező az ALLOWED_ORIGINS (vesszővel elválasztott origin-lista).');
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT ?? '3000'),
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    version: env.APP_VERSION ?? 'dev',
    allowedOrigins: origins.length > 0 ? origins : DEV_ORIGINS,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };
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
