import * as client from 'openid-client';
import type { OidcIdentity } from './types.js';

/** A bejelentkezési kísérlet egyszer használatos ellenőrző értékei (a böngészőnél, aláírt sütiben élnek). */
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** A hitelesítés nem fogadható el (érvénytelen válasz, nem megerősített e-mail); az ok csak naplóba megy. */
export class LoginRejected extends Error {
  constructor(readonly reason: 'no_email' | 'email_not_verified' | 'no_subject') {
    super(`A bejelentkezés elutasítva: ${reason}`);
    this.name = 'LoginRejected';
  }
}

/**
 * Az OIDC code flow varrata (D5, D49): az éles megvalósítás az `openid-client`; a tesztek ezen a
 * felületen át injektálnak (OIDC-mock szerver nincs, a session-eket a tesztek közvetlenül adják).
 */
export interface OidcFlow {
  start(): Promise<{ url: URL; tx: LoginTransaction }>;
  /** A callback-URL (a konfigurált origin-nel) feldolgozása: state, nonce, PKCE és az ID-token teljes ellenőrzése. */
  finish(callbackUrl: URL, tx: LoginTransaction): Promise<OidcIdentity>;
}

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const HTTP_TIMEOUT_MS = 10_000;

/** Az OIDC-szolgáltató felé menő minden kérésre időkorlát (a callback ne lógjon egy lassú szolgáltatón). */
const timeoutFetch: client.CustomFetch = (url, options) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });

/**
 * Authorization Code + PKCE (S256) + state + nonce. A discovery az első használatkor fut és gyorsítótárazódik;
 * hiba esetén a következő kísérlet újrapróbálja, így a szolgáltató átmeneti elérhetetlensége nem akadályozza
 * a backend indulását, és nem ragad be.
 */
export function createOidcFlow(settings: OidcSettings): OidcFlow {
  let discovered: Promise<client.Configuration> | undefined;
  const configuration = (): Promise<client.Configuration> => {
    discovered ??= client
      .discovery(
        new URL(settings.issuer),
        settings.clientId,
        settings.clientSecret,
        client.ClientSecretPost(settings.clientSecret),
        { [client.customFetch]: timeoutFetch },
      )
      .catch((error: unknown) => {
        discovered = undefined;
        throw error;
      });
    return discovered;
  };

  return {
    async start() {
      const config = await configuration();
      const tx: LoginTransaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: settings.redirectUri,
        scope: 'openid email profile',
        state: tx.state,
        nonce: tx.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(tx.codeVerifier),
        code_challenge_method: 'S256',
      });
      return { url, tx };
    },

    async finish(callbackUrl, tx) {
      const config = await configuration();
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: tx.codeVerifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (claims === undefined) throw new LoginRejected('no_subject');
      return identityFromClaims(claims);
    },
  };
}

/**
 * Az ID-token claim-jeiből identitás: csak `email_verified === true` fogadható el (a szigorú `true`:
 * a szövegként érkező "true" sem), az e-mail kisbetűs. A név hiányában az e-mail helyi része a megjelenítendő név.
 */
export function identityFromClaims(claims: Readonly<Record<string, unknown>>): OidcIdentity {
  const sub = claims.sub;
  if (typeof sub !== 'string' || sub === '') throw new LoginRejected('no_subject');
  const email = claims.email;
  if (typeof email !== 'string' || !email.includes('@')) throw new LoginRejected('no_email');
  if (claims.email_verified !== true) throw new LoginRejected('email_not_verified');
  const name =
    typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name.trim() : null;
  const picture =
    typeof claims.picture === 'string' && claims.picture !== '' ? claims.picture : null;
  return { sub, email: email.trim().toLowerCase(), name, picture };
}
