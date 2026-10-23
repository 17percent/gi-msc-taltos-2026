/** A `GET /api/v1/me` válasza (B5; a frontend erre kódol). */
export interface MeResponse {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  systemRole: 'user' | 'system_admin';
  /** A felhasználó aktív színterei a szerepével. */
  spaces: Array<{
    id: string;
    name: string;
    type: 'general' | 'team' | 'project';
    role: 'author' | 'space_manager';
  }>;
  /** Double-submit CSRF-token: minden mutáló kérésben az `X-CSRF-Token` fejlécben kell visszaküldeni. */
  csrfToken: string;
}

/**
 * A bejelentkezés hibakódja a `/?error=<kód>` átirányításban. `not_on_allowlist`: a szolgáltatónál
 * hitelesített, de nem engedélyezett cím (nincs session); `setup_pending`: még nincs
 * Rendszeradminisztrátor, és csak a `BOOTSTRAP_ADMIN_EMAIL` léphet be elsőként (D54);
 * `login_failed`: bármely más hiba (érvénytelen állapot, nem megerősített e-mail, szolgáltatói hiba).
 */
export type LoginError = 'not_on_allowlist' | 'setup_pending' | 'login_failed';
