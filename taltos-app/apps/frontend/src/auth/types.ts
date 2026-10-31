import type { MeResponse } from '@taltos/shared';

export type { MeResponse };

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; me: MeResponse }
  | { kind: 'not-allowlisted' }
  | { kind: 'error' };

export type AuthContextValue = {
  state: AuthState;
  /** Igaz, ha a kijelentkezés nem sikerült; a munkamenet ilyenkor változatlan. */
  logoutFailed: boolean;
  /** Az X-CSRF-Token értéke; csak bejelentkezve van. */
  csrfToken: string | null;
  logout: () => Promise<void>;
  /** A `/me` csendes újratöltése (szerep, tagság, CSRF-token frissítése); a felület nem megy betöltés-állapotba. */
  refreshMe: () => Promise<void>;
  /** Az API 401 / 403 not_on_allowlist hibájára: a munkamenet véget ért. */
  endSession: (reason: 'signed-out' | 'not-allowlisted') => void;
};
