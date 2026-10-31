import type { UserRef } from './users.js';

/** Rendszerszintű szerep (D43). */
export type SystemRole = 'user' | 'system_admin';
/** Színtérbeli szerep (D43). */
export type SpaceRole = 'author' | 'space_manager';
/** A szerepek értékkészlete (kérés-sémákhoz, a szerepnevek így nem szóródnak szét a szolgáltatásokban). */
export const SYSTEM_ROLES = ['user', 'system_admin'] as const satisfies readonly SystemRole[];
export const SPACE_ROLES = ['author', 'space_manager'] as const satisfies readonly SpaceRole[];
/** Színtér típusa: a `general` az Általános (egyetlen, seedelt); létrehozni csak `team` és `project` lehet. */
export type SpaceType = 'general' | 'team' | 'project';

/**
 * A színtér-szín rögzített hex-palettája (D56): létrehozáskor, módosításkor és projekt-tér
 * kérésének jóváhagyásakor csak ebből választható. Az első öt a seed színe.
 */
export const SPACE_COLOR_PALETTE = [
  '#3B6FB6',
  '#2E8B6F',
  '#B5651D',
  '#8A4F9E',
  '#B23A48',
  '#2A7F8E',
  '#C2872B',
  '#5B5FA8',
] as const;

export type SpaceColor = (typeof SPACE_COLOR_PALETTE)[number];

/** `GET /api/v1/spaces` egy eleme (a Rendszeradminnak az összes színtér, csak metaadat). */
export interface SpaceSummary {
  id: string;
  name: string;
  type: SpaceType;
  description: string;
  color: SpaceColor;
  closed: boolean;
}

/** `GET /api/v1/spaces/:id` (tag, Rendszeradmin). */
export interface SpaceDetail extends SpaceSummary {
  managers: UserRef[];
  memberCount: number;
}

/** `POST /api/v1/spaces` (Rendszeradmin); az Általános nem hozható létre. */
export interface CreateSpaceRequest {
  name: string;
  type: Exclude<SpaceType, 'general'>;
  description: string;
  color: SpaceColor;
  initialManagerId: string;
}

/** `PATCH /api/v1/spaces/:id`: típus nem módosítható (D56); a `name` csak Rendszeradmin; lezárt térben 403 `space_closed`. */
export interface UpdateSpaceRequest {
  name?: string;
  description?: string;
  color?: SpaceColor;
}

/** `GET /api/v1/spaces/:id/members` egy eleme. */
export interface SpaceMember {
  user: UserRef;
  role: SpaceRole;
}

/** `POST /api/v1/spaces/:id/members`. */
export interface AddMemberRequest {
  userId: string;
  role: SpaceRole;
}

/** `PATCH /api/v1/spaces/:id/members/:userId`; utolsó gazdánál 409 `last_space_manager`. */
export interface ChangeRoleRequest {
  role: SpaceRole;
}

/** `PUT /api/v1/documents/:id/owner` (D55); nem aktív tag vagy a jelenlegi tulajdonos: 422 `invalid_new_owner`. */
export interface TransferOwnershipRequest {
  userId: string;
}

/** `POST /api/v1/space-requests`: projekt-tér kérése (a javasolt gazda a `GET /users` keresőből). */
export interface CreateSpaceRequestRequest {
  name: string;
  purpose: string;
  proposedManagerId: string;
}

/** `POST /api/v1/space-requests/:id/decision`; jóváhagyáskor a `color` kötelező, elutasításnál nincs indoklás (D56). */
export type SpaceRequestDecision = { approve: true; color: SpaceColor } | { approve: false };

/** `POST /api/v1/spaces/:id/membership-requests`. */
export interface CreateMembershipRequest {
  viaDocumentId?: string;
  message?: string;
}

/** `POST /api/v1/membership-requests/:id/decision`; a `role` jóváhagyáskor adható meg. */
export interface MembershipRequestDecision {
  approve: boolean;
  role?: SpaceRole;
}

/**
 * A 403 `not_space_member` `details` mezője (B5 A10, D44). A hívó nem tag, ezért csak a színtér
 * neve és a gazdák látszanak; dokumentumcím, darabszám vagy taglétszám soha.
 */
export interface NotSpaceMemberDetails {
  space: { id: string; name: string };
  managers: UserRef[];
  /** `false` a Rendszeradminnak (önfelvétel, D56) és ha már van függő kérés. */
  canRequestMembership: boolean;
}
