// Tükrözi a `MeResponse` típust a `@taltos/shared`-ből (merge után az import cserélendő).
export type MeResponse = {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  systemRole: 'user' | 'system_admin';
  spaces: Array<{
    id: string;
    name: string;
    type: 'general' | 'team' | 'project';
    role: 'author' | 'space_manager';
  }>;
  csrfToken: string;
};

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
};
