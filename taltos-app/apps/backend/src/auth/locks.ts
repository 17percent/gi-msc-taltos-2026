/**
 * Tranzakciós tanácsadó zárak (`pg_advisory_xact_lock`). A kulcsok az alkalmazáson belül egyediek,
 * a tranzakció végén maguktól feloldódnak.
 */

/** Új felhasználó létrehozása és a rendszerindítás (D52): egyszerre egy ilyen tranzakció futhat. */
export const LOCK_USER_PROVISIONING = 5_203_001;

/** Az allowlist induláskori szinkronja: több backend-példány indulása sem fut át egymáson. */
export const LOCK_ALLOWLIST_SYNC = 5_203_002;
