import type { Action, SpaceRole, SystemRole } from '@taltos/shared';
import type { Actor, DenyCode, DocumentTarget, SpaceTarget } from './targets.js';

/**
 * A jogosultsági mátrix átirata (`Projekt dokumentációk/Felhasználók/Szerepkörök.md`, „Jogosultsági mátrix” +
 * lábjegyzetek + D55/D56). Soronként egy művelet; a `line` a mátrix érintett sorát idézi. A teszt minden
 * (szerep × művelet) cellát külön esetként futtat. A feltételes (✓) cellák (²: megjelölt review-er, ⁴: tulajdonos)
 * a feltétel TELJESÜLÉSÉVEL szerepelnek itt; a nem teljesülő ágak az `EXTRA_ROWS`-ban vannak.
 */

export type RoleKey =
  'nonMember' | 'author' | 'manager' | 'adminNonMember' | 'adminAuthor' | 'adminManager';

export const ROLE_KEYS: readonly RoleKey[] = [
  'nonMember',
  'author',
  'manager',
  'adminNonMember',
  'adminAuthor',
  'adminManager',
];

export const ROLES: Record<RoleKey, { systemRole: SystemRole; membership: SpaceRole | null }> = {
  nonMember: { systemRole: 'user', membership: null },
  author: { systemRole: 'user', membership: 'author' },
  manager: { systemRole: 'user', membership: 'space_manager' },
  adminNonMember: { systemRole: 'system_admin', membership: null },
  adminAuthor: { systemRole: 'system_admin', membership: 'author' },
  adminManager: { systemRole: 'system_admin', membership: 'space_manager' },
};

export type Outcome = 'ok' | DenyCode;

const N: Outcome = 'not_space_member';
const F: Outcome = 'forbidden';
const OK: Outcome = 'ok';

type Cells = readonly [Outcome, Outcome, Outcome, Outcome, Outcome, Outcome];

export interface MatrixRow {
  /** A mátrix érintett sora (vagy a D-pont), amelyet a sor átír. */
  line: string;
  /** A cellák a `ROLE_KEYS` sorrendjében: nem tag, Szerző, Színtérgazda, nem tag admin, admin+Szerző, admin+Színtérgazda. */
  cells: Cells;
  space?: Partial<SpaceTarget>;
  /** A feltételes cellák feltételének teljesítése (a hívó azonosítójából). */
  document?: (actorId: string) => Partial<DocumentTarget>;
}

const OTHER = 'u-other';

export const MATRIX = {
  'space.view': {
    line: 'A színtér és tartalmának látása — (✓) ¹ (név, tagok, gazdák)',
    cells: [N, OK, OK, OK, OK, OK],
  },
  'space.members.view': {
    line: 'D56: a nem tag Rendszeradmin is látja a taglistát ¹',
    cells: [N, OK, OK, OK, OK, OK],
  },
  'space.content.read': {
    line: 'A színtér és tartalmának látása — tartalom: Rendszeradmin (nem tag) –',
    cells: [N, OK, OK, N, OK, OK],
  },
  'space.create': {
    line: 'Színtér létrehozása a kezdeti Színtérgazdával — csak Rendszeradmin',
    cells: [F, F, F, OK, OK, OK],
  },
  'space.update': {
    line: 'Színtér leírása, színe (D37) — Színtérgazda, Rendszeradmin',
    cells: [N, F, OK, OK, OK, OK],
  },
  'space.rename': {
    line: 'Színtér neve (a típus nem változik, D56) — csak Rendszeradmin',
    cells: [N, F, F, OK, OK, OK],
  },
  'space.close': {
    line: 'Színtér létrehozása …, lezárása (csak projekt-tér) — csak Rendszeradmin',
    cells: [N, F, F, OK, OK, OK],
    space: { type: 'project' },
  },
  'space.members.add': {
    line: 'Tagok felvétele, eltávolítása ³ — Színtérgazda, Rendszeradmin',
    cells: [N, F, OK, OK, OK, OK],
  },
  'space.members.remove': {
    line: 'Tagok felvétele, eltávolítása ³ — Színtérgazda, Rendszeradmin',
    cells: [N, F, OK, OK, OK, OK],
  },
  'space.members.role': {
    line: 'Előléptetés Színtérgazdává, visszaminősítés Szerzővé — Színtérgazda, Rendszeradmin',
    cells: [N, F, OK, OK, OK, OK],
  },
  'space.membership.request': {
    line: 'Felvétel kérése egy színtérbe — csak nem tag; Rendszeradmin: önfelvétel (D56)',
    cells: [OK, F, F, F, F, F],
  },
  'space.membership.decide': {
    line: 'Felvételi kérés döntése (D56) — Színtérgazda, Rendszeradmin',
    cells: [N, F, OK, OK, OK, OK],
  },
  'space_request.create': {
    line: 'Projekt-tér kérése — mindenki, a Rendszeradmin is (D56)',
    cells: [OK, OK, OK, OK, OK, OK],
  },
  'space_request.decide': {
    line: 'Színtér létrehozása a kezdeti Színtérgazdával — csak Rendszeradmin (a kérés jóváhagyása)',
    cells: [F, F, F, OK, OK, OK],
  },
  'users.search': {
    line: 'D56: felhasználókeresés — bármely belépett felhasználó',
    cells: [OK, OK, OK, OK, OK, OK],
  },
  'system.users.view': {
    line: 'Allowlist, Rendszeradminisztrátorok, fajta-lista — csak Rendszeradmin',
    cells: [F, F, F, OK, OK, OK],
  },
  'system.role.change': {
    line: 'Allowlist, Rendszeradminisztrátorok, fajta-lista — csak Rendszeradmin',
    cells: [F, F, F, OK, OK, OK],
  },
  'document.read': {
    line: 'A színtér és tartalmának látása — tag: ✓, Rendszeradmin (nem tag): – (tartalom)',
    cells: [N, OK, OK, N, OK, OK],
  },
  'document.edit': {
    line: 'Szerkesztés piszkozatban (közös szerkesztés, D29) — Szerző, Színtérgazda',
    cells: [N, OK, OK, N, OK, OK],
  },
  'document.owner.transfer': {
    line: 'Tulajdonjog-átadás (D55, D56) — (✓) ⁴ Szerző: saját; Színtérgazda ✓',
    cells: [N, OK, OK, N, OK, OK],
    document: (actorId) => ({ ownerId: actorId }),
  },
  'document.owner.admin_handover': {
    line: 'Tulajdonjog-átadás — Rendszeradmin ✓ ⁵ (admin_handover, tagság nélkül is)',
    cells: [N, F, F, OK, OK, OK],
  },
  'document.comment': {
    line: 'Kommentelés, @említés, kedvencek — Szerző, Színtérgazda',
    cells: [N, OK, OK, N, OK, OK],
  },
  'document.favorite': {
    line: 'Kommentelés, @említés, kedvencek — Szerző, Színtérgazda',
    cells: [N, OK, OK, N, OK, OK],
  },
  'document.submit': {
    line: 'Review-ra küldés (új dokumentum, módosítás, feltöltés, törlés) két review-errel',
    cells: [N, OK, OK, N, OK, OK],
  },
  'document.review.decide': {
    line: 'Review-erként jóváhagyás, elutasítás indoklással — (✓) ² megjelölt review-er',
    cells: [N, OK, OK, N, OK, OK],
    document: () => ({ isDesignatedReviewer: true, initiatorId: OTHER }),
  },
  'document.request.withdraw': {
    line: 'Saját indítvány visszavonása — Szerző, Színtérgazda (saját indítvány)',
    cells: [N, OK, OK, N, OK, OK],
    document: (actorId) => ({ initiatorId: actorId }),
  },
  'document.confirm_current': {
    line: '„Még aktuális” megerősítés (D33) — Szerző, Színtérgazda',
    cells: [N, OK, OK, N, OK, OK],
  },
  'space.audit.view': {
    line: 'Színtér-szintű auditnézet, CSV-export — csak Színtérgazda',
    cells: [N, F, OK, N, F, OK],
  },
  'system.audit.view': {
    line: 'Rendszerszintű auditnapló, CSV-export — csak Rendszeradmin',
    cells: [F, F, F, OK, OK, OK],
  },
  'system.kinds.manage': {
    line: 'Allowlist, Rendszeradminisztrátorok, fajta-lista — csak Rendszeradmin',
    cells: [F, F, F, OK, OK, OK],
  },
} as const satisfies Record<Action, MatrixRow>;

export const SYSTEM_ACTOR_IDS = { self: 'u-actor', other: OTHER } as const;

export function actorFor(role: RoleKey): Actor {
  return { userId: SYSTEM_ACTOR_IDS.self, systemRole: ROLES[role].systemRole };
}

export function spaceFor(role: RoleKey, overrides: Partial<SpaceTarget> = {}): SpaceTarget {
  return {
    spaceId: 's-1',
    type: 'team',
    closed: false,
    membership: ROLES[role].membership,
    ...overrides,
  };
}

export function documentFor(
  role: RoleKey,
  overrides: Partial<Omit<DocumentTarget, 'space'>> = {},
  space: Partial<SpaceTarget> = {},
): DocumentTarget {
  return {
    documentId: 'd-1',
    space: spaceFor(role, space),
    ownerId: OTHER,
    archived: false,
    reviewState: 'draft',
    ...overrides,
  };
}

/** Egy extra dimenziós eset: a mátrix cellákon túli ágak (zárt tér, Általános, tulajdonos, review-er, állapot). */
export interface ExtraRow {
  name: string;
  line: string;
  action: Action;
  role: RoleKey;
  space?: Partial<SpaceTarget>;
  document?: Partial<Omit<DocumentTarget, 'space'>>;
  expect: Outcome;
}

const WRITE_SPACE: Action[] = ['space.update', 'space.rename'];
const ADMIN_MEMBER_MGMT: Action[] = [
  'space.members.add',
  'space.members.remove',
  'space.members.role',
  'space.membership.decide',
];
const CLOSED = { type: 'project', closed: true } as const;
const FOOT3 =
  'Szerepkörök.md ³: lezárt projekt-térben minden módosítás tiltott, kivéve a Rendszeradmin tagkezelése és admin_handover (D56)';

function closedRows(): ExtraRow[] {
  const rows: ExtraRow[] = [];
  // olvasás lezárt térben is megy
  for (const action of ['space.view', 'space.members.view', 'space.content.read'] as Action[]) {
    rows.push({
      name: `${action} lezárt térben: tag olvashat`,
      line: FOOT3,
      action,
      role: 'author',
      space: CLOSED,
      expect: 'ok',
    });
  }
  rows.push({
    name: 'document.read lezárt térben: tag olvashat',
    line: FOOT3,
    action: 'document.read',
    role: 'author',
    space: CLOSED,
    expect: 'ok',
  });
  // író műveletek: a szerep előbb dönt (forbidden), utána a zártság
  for (const action of WRITE_SPACE) {
    rows.push({
      name: `${action} lezárt térben: Színtérgazda → space_closed`,
      line: FOOT3,
      action,
      role: 'manager',
      space: CLOSED,
      expect: action === 'space.rename' ? 'forbidden' : 'space_closed',
    });
    rows.push({
      name: `${action} lezárt térben: admin → space_closed`,
      line: FOOT3,
      action,
      role: 'adminNonMember',
      space: CLOSED,
      expect: 'space_closed',
    });
  }
  rows.push({
    name: 'space.update lezárt térben: Szerző → forbidden (a szerep a zártság előtt dönt)',
    line: FOOT3,
    action: 'space.update',
    role: 'author',
    space: CLOSED,
    expect: 'forbidden',
  });
  for (const action of ADMIN_MEMBER_MGMT) {
    rows.push({
      name: `${action} lezárt térben: Színtérgazda → space_closed`,
      line: FOOT3,
      action,
      role: 'manager',
      space: CLOSED,
      expect: 'space_closed',
    });
    for (const role of ['adminNonMember', 'adminAuthor', 'adminManager'] as RoleKey[]) {
      rows.push({
        name: `${action} lezárt térben: ${role} → ok (D56)`,
        line: FOOT3,
        action,
        role,
        space: CLOSED,
        expect: 'ok',
      });
    }
  }
  rows.push(
    {
      name: 'space.close lezárt térben: admin → ok (az idempotens 200 a végpontnál)',
      line: 'D56: a már lezárt tér újbóli lezárása idempotens',
      action: 'space.close',
      role: 'adminNonMember',
      space: CLOSED,
      expect: 'ok',
    },
    {
      name: 'space.membership.request lezárt térben: nem tag → space_closed',
      line: 'D56 bővítés: lezárt projekt-térbe nincs új felvételi kérés',
      action: 'space.membership.request',
      role: 'nonMember',
      space: CLOSED,
      expect: 'space_closed',
    },
    {
      name: 'space.membership.request lezárt térben: admin → forbidden (a szerep előbb)',
      line: 'D56: a Rendszeradmin nem kér felvételt',
      action: 'space.membership.request',
      role: 'adminNonMember',
      space: CLOSED,
      expect: 'forbidden',
    },
    {
      name: 'document.owner.admin_handover lezárt térben: admin tagság nélkül is → ok',
      line: FOOT3,
      action: 'document.owner.admin_handover',
      role: 'adminNonMember',
      space: CLOSED,
      expect: 'ok',
    },
    {
      name: 'document.owner.admin_handover lezárt térben: Színtérgazda → forbidden',
      line: FOOT3,
      action: 'document.owner.admin_handover',
      role: 'manager',
      space: CLOSED,
      expect: 'forbidden',
    },
  );
  for (const action of [
    'document.edit',
    'document.comment',
    'document.favorite',
    'document.submit',
    'document.confirm_current',
  ] as Action[]) {
    rows.push({
      name: `${action} lezárt térben: tag → space_closed`,
      line: FOOT3,
      action,
      role: 'manager',
      space: CLOSED,
      expect: 'space_closed',
    });
  }
  rows.push(
    {
      name: 'document.owner.transfer lezárt térben: tulajdonos-tag → space_closed',
      line: 'B5 PUT …/owner: lezárt projekt-térben 403 space_closed',
      action: 'document.owner.transfer',
      role: 'author',
      space: CLOSED,
      document: { ownerId: SYSTEM_ACTOR_IDS.self },
      expect: 'space_closed',
    },
    {
      name: 'document.owner.transfer lezárt térben: nem tag admin → not_space_member (admin_handover az útja)',
      line: 'D55/D56: a rendes átadás tagot kíván',
      action: 'document.owner.transfer',
      role: 'adminNonMember',
      space: CLOSED,
      expect: 'not_space_member',
    },
    {
      name: 'space.audit.view lezárt térben: Színtérgazda olvashat',
      line: 'Színtér-szintű auditnézet — olvasás',
      action: 'space.audit.view',
      role: 'manager',
      space: CLOSED,
      expect: 'ok',
    },
  );
  return rows;
}

export const EXTRA_ROWS: readonly ExtraRow[] = [
  // Általános színtér
  {
    name: 'space.members.remove az Általánosban: Színtérgazda → forbidden',
    line: 'Szerepkörök.md ³: az Általánosból tag nem távolítható el (D56)',
    action: 'space.members.remove',
    role: 'manager',
    space: { type: 'general' },
    expect: 'forbidden',
  },
  {
    name: 'space.members.remove az Általánosban: admin → forbidden',
    line: 'Szerepkörök.md ³',
    action: 'space.members.remove',
    role: 'adminNonMember',
    space: { type: 'general' },
    expect: 'forbidden',
  },
  {
    name: 'space.members.role az Általánosban: Színtérgazda → ok (szerepváltás engedett)',
    line: 'Szerepkörök.md ³: szerepe változtatható',
    action: 'space.members.role',
    role: 'manager',
    space: { type: 'general' },
    expect: 'ok',
  },
  // lezárás típusa
  {
    name: 'space.close csapat-térre: admin → forbidden',
    line: 'Színtér … lezárása (csak projekt-tér)',
    action: 'space.close',
    role: 'adminNonMember',
    space: { type: 'team' },
    expect: 'forbidden',
  },
  {
    name: 'space.close az Általánosra: admin → forbidden',
    line: 'Színtér … lezárása (csak projekt-tér)',
    action: 'space.close',
    role: 'adminManager',
    space: { type: 'general' },
    expect: 'forbidden',
  },
  // tulajdonos / nem tulajdonos
  {
    name: 'document.owner.transfer nem tulajdonos Szerző → forbidden',
    line: 'Tulajdonjog-átadás — (✓) ⁴ csak a saját dokumentum',
    action: 'document.owner.transfer',
    role: 'author',
    document: { ownerId: SYSTEM_ACTOR_IDS.other },
    expect: 'forbidden',
  },
  {
    name: 'document.owner.transfer nem tulajdonos admin+Szerző → forbidden',
    line: 'Tulajdonjog-átadás — a Rendszeradmin tagként is csak saját dokumentumot adhat át rendesen',
    action: 'document.owner.transfer',
    role: 'adminAuthor',
    document: { ownerId: SYSTEM_ACTOR_IDS.other },
    expect: 'forbidden',
  },
  {
    name: 'document.owner.transfer nem tulajdonos Színtérgazda → ok',
    line: 'Tulajdonjog-átadás — Színtérgazda ✓',
    action: 'document.owner.transfer',
    role: 'manager',
    document: { ownerId: SYSTEM_ACTOR_IDS.other },
    expect: 'ok',
  },
  {
    name: 'document.owner.transfer archivált dokumentumon is → ok (D54)',
    line: 'B5 PUT …/owner: archivált dokumentumon is',
    action: 'document.owner.transfer',
    role: 'manager',
    document: { archived: true },
    expect: 'ok',
  },
  // review-er / indítványozó
  {
    name: 'document.review.decide nem megjelölt tag → forbidden',
    line: 'Review-erként jóváhagyás — (✓) ² csak a megjelölt',
    action: 'document.review.decide',
    role: 'author',
    document: { isDesignatedReviewer: false, initiatorId: SYSTEM_ACTOR_IDS.other },
    expect: 'forbidden',
  },
  {
    name: 'document.review.decide függő kérés nélkül → forbidden',
    line: 'Review-erként jóváhagyás — (✓) ²',
    action: 'document.review.decide',
    role: 'manager',
    expect: 'forbidden',
  },
  {
    name: 'document.review.decide saját indítvány → forbidden',
    line: 'Szerepkörök.md ²: saját indítványát senki nem hagyhatja jóvá',
    action: 'document.review.decide',
    role: 'author',
    document: { isDesignatedReviewer: true, initiatorId: SYSTEM_ACTOR_IDS.self },
    expect: 'forbidden',
  },
  {
    name: 'document.request.withdraw más indítványa → forbidden',
    line: 'Saját indítvány visszavonása',
    action: 'document.request.withdraw',
    role: 'manager',
    document: { initiatorId: SYSTEM_ACTOR_IDS.other },
    expect: 'forbidden',
  },
  {
    name: 'document.request.withdraw függő kérés nélkül → forbidden',
    line: 'Saját indítvány visszavonása',
    action: 'document.request.withdraw',
    role: 'author',
    expect: 'forbidden',
  },
  // szerkeszthetőség (D45)
  {
    name: 'document.edit Átdolgozandó állapotban → ok',
    line: 'Szerkesztés piszkozatban (D45: draft | changes_requested)',
    action: 'document.edit',
    role: 'author',
    document: { reviewState: 'changes_requested' },
    expect: 'ok',
  },
  {
    name: 'document.edit Review-ra vár állapotban → forbidden',
    line: 'Szerkesztés piszkozatban (D45)',
    action: 'document.edit',
    role: 'author',
    document: { reviewState: 'pending' },
    expect: 'forbidden',
  },
  {
    name: 'document.edit Jóváhagyott állapotban → forbidden',
    line: 'Szerkesztés piszkozatban (D45; a „Módosítás indítása” előbb Piszkozatot nyit)',
    action: 'document.edit',
    role: 'manager',
    document: { reviewState: 'approved' },
    expect: 'forbidden',
  },
  {
    name: 'document.edit archivált dokumentumon → forbidden',
    line: 'Szerkesztés piszkozatban (D45; archivált csak olvasható)',
    action: 'document.edit',
    role: 'author',
    document: { archived: true },
    expect: 'forbidden',
  },
  {
    name: 'document.edit Jóváhagyott állapotban lezárt térben → space_closed (a zártság az állapot előtt dönt)',
    line: FOOT3,
    action: 'document.edit',
    role: 'author',
    space: CLOSED,
    document: { reviewState: 'approved' },
    expect: 'space_closed',
  },
  {
    name: 'document.read archivált dokumentumon: tag → ok',
    line: 'D54: archivált dokumentum olvasható',
    action: 'document.read',
    role: 'author',
    document: { archived: true },
    expect: 'ok',
  },
  ...closedRows(),
];
