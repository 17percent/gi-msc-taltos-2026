import type {
  AdminUser,
  CreateMembershipRequest,
  CreateSpaceRequestRequest,
  MembershipDecisionResult,
  MembershipRequestDecision,
  RequestCreated,
  RequestState,
  SpaceRequestDecision,
  SpaceRequestDecisionResult,
  SpaceColor,
  SpaceDetail,
  SpaceMember,
  SpaceRole,
  SpaceSummary,
  SystemRole,
  UserRef,
} from '@taltos/shared';
import type { Actor } from '../policy/targets.js';

/** A tár üzleti hibái: a B5 katalógus kódjai (a `can()` elutasításain kívül), a HTTP-réteg Problem Details-szé fordítja. */
export type StoreFailureCode =
  | 'not_found'
  | 'forbidden'
  | 'space_closed'
  | 'request_pending'
  | 'request_closed'
  | 'last_space_manager'
  | 'last_admin'
  | 'owner_handover_required'
  | 'invalid_new_owner'
  | 'validation_error';

export interface StoreFailure {
  ok: false;
  code: StoreFailureCode;
  /** Az ember által olvasható magyarázat (nincs benne személyes adat). */
  detail?: string;
}

export type StoreResult<T> = { ok: true; value: T } | StoreFailure;

export const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
export const fail = (code: StoreFailureCode, detail?: string): StoreFailure => ({
  ok: false,
  code,
  ...(detail === undefined ? {} : { detail }),
});

export interface NewSpace {
  name: string;
  type: 'team' | 'project';
  description: string;
  color: SpaceColor;
  initialManagerId: string;
}

export interface SpacePatch {
  name?: string;
  description?: string;
  color?: SpaceColor;
}

/**
 * A színterek, a tagság, a tulajdonjog-átadás és a rendszerszerepek adatelérési varrata (mint az `AuthStore`): egy
 * metódus egy használati eset, a 409/422-es védelmek eredmény-unióban jönnek vissza, nem kivételként. A PostgreSQL-
 * megvalósítás az éles, a tesztek memóriabeli párt használnak; a közös szerződést a `space-store-contract` teszt futtatja.
 *
 * Szabályok: minden írás egy tranzakció, a hozzá tartozó eseményekkel (`recordEvent`); a térszabályokat a `spaces`
 * sor `FOR UPDATE` zára, az admin-szabályt az összes `system_admin` sor `ORDER BY id FOR UPDATE` zára védi (B4 S8).
 * A `can()` döntést a hívó (route) hozta a betöltött célponton; a tár a zár alatt csak a versenyhelyzet-érzékeny
 * feltételeket (lezárt tér, tagság, tulajdonos) ellenőrzi újra.
 */
export interface SpaceStore {
  /** A hívó színterei; Rendszeradminnak az összes (csak metaadat, tartalom nélkül, B5). */
  listSpaces(actor: Actor): Promise<SpaceSummary[]>;
  getSpace(spaceId: string): Promise<SpaceDetail | undefined>;
  listMembers(spaceId: string): Promise<SpaceMember[]>;

  createSpace(actor: Actor, input: NewSpace, now: Date): Promise<StoreResult<SpaceDetail>>;
  updateSpace(
    actor: Actor,
    spaceId: string,
    patch: SpacePatch,
    now: Date,
  ): Promise<StoreResult<SpaceDetail>>;
  /** Projekt-tér lezárása (D55): a függő kérések visszavonása ugyanabban a tranzakcióban; a már lezárt tér idempotens. */
  closeSpace(
    actor: Actor,
    spaceId: string,
    now: Date,
  ): Promise<StoreResult<{ alreadyClosed: boolean; withdrawnRequests: number }>>;

  addMember(
    actor: Actor,
    spaceId: string,
    input: { userId: string; role: SpaceRole },
    now: Date,
  ): Promise<StoreResult<SpaceMember>>;
  changeRole(
    actor: Actor,
    spaceId: string,
    userId: string,
    role: SpaceRole,
    now: Date,
  ): Promise<StoreResult<SpaceMember>>;
  removeMember(
    actor: Actor,
    spaceId: string,
    userId: string,
    now: Date,
  ): Promise<StoreResult<null>>;

  /** `PUT /documents/:id/owner` (D55): tulajdonos (aki tag) vagy Színtérgazda, review nélkül. */
  transferOwnership(
    actor: Actor,
    input: { documentId: string; newOwnerId: string },
    now: Date,
  ): Promise<StoreResult<null>>;
  /** `POST /admin/users/:id/handover` (D56): a felhasználó adott színtérbeli összes (archivált is) dokumentuma az új, aktív tagra. */
  adminHandover(
    actor: Actor,
    input: { userId: string; spaceId: string; newOwnerId: string },
    now: Date,
  ): Promise<StoreResult<{ movedDocuments: number }>>;

  /**
   * Felvételi kérés (D44, D56): a térzár alatt újraellenőrzi a lezártságot és a tagságot; a függő kérés (a részleges
   * egyedi index 23505-ös hibája is) `request_pending`. A Rendszeradmin nem kérhet (`forbidden`).
   */
  createMembershipRequest(
    actor: Actor,
    spaceId: string,
    input: CreateMembershipRequest,
    now: Date,
  ): Promise<StoreResult<RequestCreated>>;
  /** A kérés színtere és állapota a döntés jogosultság-ellenőrzéséhez; `undefined`: nincs ilyen kérés. */
  getMembershipRequest(
    requestId: string,
  ): Promise<{ spaceId: string; state: RequestState } | undefined>;
  /**
   * Döntés: egy tranzakció (kérés zárolva, az állapot újraellenőrzése: `request_closed`; lezárt térben csak a
   * Rendszeradmin: `space_closed`); jóváhagyáskor tagfelvétel (alapszerep: Szerző) és `member_added`, majd
   * `membership_request_decided`.
   */
  decideMembershipRequest(
    actor: Actor,
    requestId: string,
    decision: MembershipRequestDecision,
    now: Date,
  ): Promise<StoreResult<MembershipDecisionResult>>;

  /** Projekt-tér kérése: a javasolt gazdának aktív allowlistes felhasználónak kell lennie (`validation_error`). */
  createSpaceRequest(
    actor: Actor,
    input: CreateSpaceRequestRequest,
    now: Date,
  ): Promise<StoreResult<RequestCreated>>;
  /**
   * Döntés: jóváhagyáskor ugyanaz a térlétrehozás, mint a `createSpace` (project típus, a cél a leírás, a javasolt gazda
   * a kezdeti gazda), egy tranzakcióban a kérés lezárásával és az eseményekkel; bármely hiba mindent visszagörget.
   */
  decideSpaceRequest(
    actor: Actor,
    requestId: string,
    decision: SpaceRequestDecision,
    now: Date,
  ): Promise<StoreResult<SpaceRequestDecisionResult>>;

  /** `GET /users?q=` (D56): név szerint, csak az aktív allowlistes felhasználók, legfeljebb `limit` találat. */
  searchUsers(query: string, limit: number): Promise<UserRef[]>;
  listAdminUsers(): Promise<AdminUser[]>;
  changeSystemRole(
    actor: Actor,
    userId: string,
    systemRole: SystemRole,
    now: Date,
  ): Promise<StoreResult<AdminUser>>;
}
