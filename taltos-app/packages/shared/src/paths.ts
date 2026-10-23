/** A REST API előtagja (B5). */
export const API_PREFIX = '/api/v1';

/** Liveness-végpont (B5 2. szakasz, `GET /healthz`). */
export const HEALTH_PATH = '/healthz';

/** Hocuspocus közös szerkesztési csatorna (D29, A12). */
export const COLLAB_PATH = '/collab';

/** Értesítési és dashboard-frissítési csatorna (D46, A12). */
export const NOTIFICATIONS_PATH = '/ws/notifications';

/** Bejelentkezés: átirányítás az OIDC-szolgáltatóhoz (B5, `/api/v1`-en kívül). */
export const AUTH_LOGIN_PATH = '/auth/login';

/** Az OIDC code flow lezárása (a szolgáltató ide irányít vissza). */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/** Kijelentkezés (`POST`, CSRF-tokennel). */
export const AUTH_LOGOUT_PATH = '/auth/logout';

/** A CSRF-token fejléce a mutáló kéréseken (D26, B5 A1). */
export const CSRF_HEADER = 'x-csrf-token';
