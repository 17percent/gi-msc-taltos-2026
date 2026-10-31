/**
 * A `can(user, action, resource)` policy műveletei (D43, D44, D56; mátrix: Szerepkörök.md).
 * Soronként egy név; a szabályok a megvalósításhoz (WP4a S3) kontraktusok. „Tag”: a színtér
 * aktív tagja. Lezárt projekt-térben minden módosítás `space_closed`, ahol nincs más kivétel jelölve.
 */
export const ACTIONS = [
  /** Színtér metaadata: tag, Rendszeradmin. */
  'space.view',
  /** Taglista: tag, Rendszeradmin (tagság nélkül is, D56). */
  'space.members.view',
  /** Tartalom olvasása a színtérben: kizárólag tag (a Rendszeradmin nem, D44). */
  'space.content.read',
  /** Színtér létrehozása: Rendszeradmin. */
  'space.create',
  /** Leírás és szín módosítása: Színtérgazda, Rendszeradmin; lezárt térben `space_closed`. */
  'space.update',
  /** Név módosítása: Rendszeradmin; lezárt térben `space_closed`. A típus nem változtatható. */
  'space.rename',
  /** Lezárás: Rendszeradmin; csak projekt-tér, egyébként `forbidden`; a már lezárt tér újbóli lezárása idempotens. */
  'space.close',
  /** Tag felvétele: Színtérgazda, Rendszeradmin; lezárt térben csak a Rendszeradmin. */
  'space.members.add',
  /** Tag eltávolítása: Színtérgazda, Rendszeradmin; lezárt térben csak a Rendszeradmin; az Általánosból `forbidden`. */
  'space.members.remove',
  /** Szerepváltás: Színtérgazda, Rendszeradmin; lezárt térben csak a Rendszeradmin. */
  'space.members.role',
  /** Felvétel kérése: nem tag; Rendszeradminnak `forbidden` (helyette önfelvétel, D56). */
  'space.membership.request',
  /** Felvételi kérés döntése: Színtérgazda, Rendszeradmin. */
  'space.membership.decide',
  /** Projekt-tér kérése: bármely belépett felhasználó, a Rendszeradmin is. */
  'space_request.create',
  /** Projekt-tér kérésének döntése: Rendszeradmin. */
  'space_request.decide',
  /** Felhasználókeresés (`GET /users`): bármely belépett felhasználó. */
  'users.search',
  /** Felhasználólista (`GET /admin/users`): Rendszeradmin. */
  'system.users.view',
  /** Rendszerszerep váltása: Rendszeradmin. */
  'system.role.change',
  /** Dokumentum olvasása: tag; nem tagnak `not_space_member`. */
  'document.read',
  /** Szerkesztés: tag, Piszkozat vagy Átdolgozandó állapotban, nem lezárt térben. */
  'document.edit',
  /** Tulajdonjog-átadás (D55): a tulajdonos, ha tag, vagy Színtérgazda; lezárt térben `space_closed`. */
  'document.owner.transfer',
  /** Adminisztratív átadás (D56): Rendszeradmin; lezárt térben is. */
  'document.owner.admin_handover',
  /** Az alábbiak a mátrix szerepfeltételét viszik; a végpontjaikat a saját WP-jük köti rá. */
  'document.comment',
  'document.favorite',
  'document.submit',
  'document.review.decide',
  'document.request.withdraw',
  'document.confirm_current',
  'space.audit.view',
  'system.audit.view',
  'system.kinds.manage',
  /** Adminisztratív tulajdonos-átadás egy színtérre (`POST /admin/users/:id/handover`, D56): Rendszeradmin, lezárt térben is. */
  'system.users.handover',
] as const;

export type Action = (typeof ACTIONS)[number];
