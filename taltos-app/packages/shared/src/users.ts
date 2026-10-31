import type { SystemRole } from './spaces.js';

/** Felhasználó-hivatkozás: csak azonosító, név és avatar; e-mail soha (D56). */
export interface UserRef {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** A `GET /api/v1/users?q=` válasza (D56): legalább 2 karakteres név, legfeljebb 10 találat. */
export type UserSearchResponse = UserRef[];

/** A Rendszeradmin felhasználólistájának egy sora (`GET /api/v1/admin/users`). */
export interface AdminUser extends UserRef {
  /** Csak a Rendszeradmin látja (az allowlist e-mail-alapú). */
  email: string;
  systemRole: SystemRole;
  lastLoginAt: string | null;
}

/** `PUT /api/v1/admin/users/:id/system-role`; utolsó adminnál 409 `last_admin`. */
export interface ChangeSystemRoleRequest {
  systemRole: SystemRole;
}

/** `POST /api/v1/admin/users/:id/handover` (D56): a felhasználó adott színtérbeli összes dokumentuma az új, aktív tagra kerül. */
export interface AdminHandoverRequest {
  spaceId: string;
  newOwnerId: string;
}

/** Az adminisztratív átadás válasza: az áthelyezett (archivált is) dokumentumok száma. */
export interface AdminHandoverResponse {
  movedDocuments: number;
}
