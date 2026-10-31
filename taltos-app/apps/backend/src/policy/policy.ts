import type { Action } from '@taltos/shared';
import type {
  Actor,
  Decision,
  DenyCode,
  DocumentTarget,
  SpaceTarget,
  SystemTarget,
} from './targets.js';

/**
 * Az egyetlen jogosultsági döntés (D43, D44, D56; mátrix: `Szerepkörök.md`). Tiszta függvény: nem olvas, nem
 * naplóz, nem dob; a bemenetet az `AccessStore` tölti be, a hívó pedig a `Decision`-ből csinál Problem Details-t.
 *
 * Kiértékelési sorrend (tesztelt):
 *  1. hiányzó vagy törölt célpont: nem itt dől el (a betöltő `undefined`-ja, 404 `not_found`);
 *  2. nem tag, és a művelet nem Rendszeradmin-kivétel: `not_space_member`;
 *  3. elégtelen szerep vagy művelet-specifikus feltétel: `forbidden`;
 *  4. író művelet lezárt térben: `space_closed` (kivétel: a Rendszeradmin tagkezelése és adminisztratív átadása, D56);
 *  5. állapotfeltétel (pl. a szerkeszthetőség): `forbidden`.
 * Az üzleti védelmek (utolsó gazda, utolsó admin, tulajdonos eltávolítása) nem ide tartoznak, azokat a szolgáltatás adja.
 */

type Scope = 'system' | 'space' | 'document';

/** Ki végezheti (a Rendszeradmin-kivételek a `nonMemberAdmin`-ban). */
type Need =
  /** Bármely belépett felhasználó. */
  | 'signed_in'
  /** Rendszeradmin. */
  | 'admin'
  /** A színtér aktív tagja. */
  | 'member'
  /** Színtérgazda tagság. */
  | 'manager'
  /** Színtérgazda tagság vagy Rendszeradmin. */
  | 'manager_or_admin'
  /** Csak nem tag (felvétel kérése). */
  | 'non_member';

/** Lezárt térben: `read` olvasás, `blocked` tiltott, `admin_ok` csak a Rendszeradmin végezheti, `allowed` nem író. */
type ClosedRule = 'read' | 'blocked' | 'admin_ok' | 'allowed';

interface Rule {
  scope: Scope;
  need: Need;
  /** A Rendszeradmin tagság nélkül is végezheti (D43, D56): a színtér adminisztrációja, nem a tartalma. */
  nonMemberAdmin?: true;
  closed: ClosedRule;
}

const RULES = {
  'space.view': { scope: 'space', need: 'member', nonMemberAdmin: true, closed: 'read' },
  'space.members.view': { scope: 'space', need: 'member', nonMemberAdmin: true, closed: 'read' },
  'space.content.read': { scope: 'space', need: 'member', closed: 'read' },
  'space.create': { scope: 'system', need: 'admin', closed: 'allowed' },
  'space.update': {
    scope: 'space',
    need: 'manager_or_admin',
    nonMemberAdmin: true,
    closed: 'blocked',
  },
  'space.rename': { scope: 'space', need: 'admin', nonMemberAdmin: true, closed: 'blocked' },
  // Az újbóli lezárás idempotens (200): ezt a végpont adja, a can() ezért nem tiltja a lezárt térben.
  'space.close': { scope: 'space', need: 'admin', nonMemberAdmin: true, closed: 'allowed' },
  'space.members.add': {
    scope: 'space',
    need: 'manager_or_admin',
    nonMemberAdmin: true,
    closed: 'admin_ok',
  },
  'space.members.remove': {
    scope: 'space',
    need: 'manager_or_admin',
    nonMemberAdmin: true,
    closed: 'admin_ok',
  },
  'space.members.role': {
    scope: 'space',
    need: 'manager_or_admin',
    nonMemberAdmin: true,
    closed: 'admin_ok',
  },
  'space.membership.request': { scope: 'space', need: 'non_member', closed: 'blocked' },
  'space.membership.decide': {
    scope: 'space',
    need: 'manager_or_admin',
    nonMemberAdmin: true,
    closed: 'admin_ok',
  },
  'space_request.create': { scope: 'system', need: 'signed_in', closed: 'allowed' },
  'space_request.decide': { scope: 'system', need: 'admin', closed: 'allowed' },
  'users.search': { scope: 'system', need: 'signed_in', closed: 'allowed' },
  'system.users.view': { scope: 'system', need: 'admin', closed: 'allowed' },
  'system.role.change': { scope: 'system', need: 'admin', closed: 'allowed' },
  'document.read': { scope: 'document', need: 'member', closed: 'read' },
  'document.edit': { scope: 'document', need: 'member', closed: 'blocked' },
  'document.owner.transfer': { scope: 'document', need: 'member', closed: 'blocked' },
  'document.owner.admin_handover': {
    scope: 'document',
    need: 'admin',
    nonMemberAdmin: true,
    closed: 'admin_ok',
  },
  'document.comment': { scope: 'document', need: 'member', closed: 'blocked' },
  // a kedvenc privát jelző, lezárt térben is megy (D56)
  'document.favorite': { scope: 'document', need: 'member', closed: 'allowed' },
  'document.submit': { scope: 'document', need: 'member', closed: 'blocked' },
  'document.review.decide': { scope: 'document', need: 'member', closed: 'blocked' },
  'document.request.withdraw': { scope: 'document', need: 'member', closed: 'blocked' },
  'document.confirm_current': { scope: 'document', need: 'member', closed: 'blocked' },
  'space.audit.view': { scope: 'space', need: 'manager', closed: 'read' },
  'system.audit.view': { scope: 'system', need: 'admin', closed: 'allowed' },
  'system.kinds.manage': { scope: 'system', need: 'admin', closed: 'allowed' },
} as const satisfies Record<Action, Rule>;

type ActionsOf<S extends Scope> = {
  [A in Action]: (typeof RULES)[A]['scope'] extends S ? A : never;
}[Action];

export type SystemAction = ActionsOf<'system'>;
export type SpaceAction = ActionsOf<'space'>;
export type DocumentAction = ActionsOf<'document'>;

/** A művelet hatóköre: a hívó (route-helper) ebből tudja, mit kell betölteni. */
export function scopeOf(action: Action): Scope {
  return RULES[action].scope;
}

const ALLOW: Decision = { ok: true };
const deny = (code: DenyCode): Decision => ({ ok: false, code });

const isAdmin = (actor: Actor): boolean => actor.systemRole === 'system_admin';

/** A Rendszeradmin-státusz egyetlen kérdezési pontja a policy-n kívülről (a szerepet máshol nem hasonlítjuk össze). */
export const isSystemAdmin = isAdmin;

export function can(actor: Actor, action: SystemAction, target?: SystemTarget): Decision;
export function can(actor: Actor, action: SpaceAction, target: SpaceTarget): Decision;
export function can(actor: Actor, action: DocumentAction, target: DocumentTarget): Decision;
export function can(actor: Actor, action: Action, target?: SpaceTarget | DocumentTarget): Decision {
  const rule: Rule = RULES[action];

  if (rule.scope === 'system') {
    return rule.need === 'signed_in' || isAdmin(actor) ? ALLOW : deny('forbidden');
  }

  // A célpont-típus eltérése programozási hiba; a döntés ilyenkor is elutasít (zárt alapértelmezés).
  const document = rule.scope === 'document' ? asDocument(target) : undefined;
  const space = rule.scope === 'document' ? document?.space : asSpace(target);
  if (space === undefined) return deny('forbidden');

  // 2. nem tag
  if (
    rule.need !== 'non_member' &&
    space.membership === null &&
    !(rule.nonMemberAdmin && isAdmin(actor))
  ) {
    return deny('not_space_member');
  }

  // 3. szerep és művelet-specifikus feltétel
  if (!roleSufficient(actor, rule, space) || !conditionHolds(actor, action, space, document)) {
    return deny('forbidden');
  }

  // 4. lezárt tér
  if (
    space.closed &&
    (rule.closed === 'blocked' || (rule.closed === 'admin_ok' && !isAdmin(actor)))
  ) {
    return deny('space_closed');
  }

  // 5. állapotfeltétel
  if (document !== undefined && !stateAllows(action, document)) return deny('forbidden');

  return ALLOW;
}

function roleSufficient(actor: Actor, rule: Rule, space: SpaceTarget): boolean {
  // a Rendszeradmin-kivétel a tagsági követelményt is kiváltja (a nem tag admin látja a tér adatait)
  if (rule.nonMemberAdmin && isAdmin(actor)) return true;
  switch (rule.need) {
    case 'signed_in':
      return true;
    case 'admin':
      return isAdmin(actor);
    case 'member':
      return space.membership !== null;
    case 'manager':
      return space.membership === 'space_manager';
    case 'manager_or_admin':
      return space.membership === 'space_manager' || isAdmin(actor);
    case 'non_member':
      return space.membership === null;
  }
}

/** Művelet-specifikus szerepfeltételek (a mátrix lábjegyzetei és a D55/D56 különszabályai). */
function conditionHolds(
  actor: Actor,
  action: Action,
  space: SpaceTarget,
  document: DocumentTarget | undefined,
): boolean {
  switch (action) {
    // csak projekt-tér zárható le (D56)
    case 'space.close':
      return space.type === 'project';
    // az Általánosból tag nem távolítható el (D56)
    case 'space.members.remove':
      return space.type !== 'general';
    // a Rendszeradmin nem kér felvételt, hanem önfelvétellel lép be (D56)
    case 'space.membership.request':
      return !isAdmin(actor);
    // tulajdonjog-átadás: a tulajdonos (aki tag) vagy a Színtérgazda (D55)
    case 'document.owner.transfer':
      return space.membership === 'space_manager' || document?.ownerId === actor.userId;
    // review-er csak a megjelölt, az indítványozó sosem a saját kérését dönti el (mátrix ²)
    case 'document.review.decide':
      return document?.isDesignatedReviewer === true && document.initiatorId !== actor.userId;
    // visszavonni csak a saját indítványt lehet
    case 'document.request.withdraw':
      return document?.initiatorId === actor.userId;
    default:
      return true;
  }
}

/** Szerkeszthetőség (D45): csak Piszkozat vagy Átdolgozandó; az archivált dokumentum csak olvasható. */
function stateAllows(action: Action, document: DocumentTarget): boolean {
  switch (action) {
    case 'document.edit':
      return (
        !document.archived &&
        (document.reviewState === 'draft' || document.reviewState === 'changes_requested')
      );
    case 'document.submit':
      return !document.archived;
    default:
      return true;
  }
}

function asSpace(target: SpaceTarget | DocumentTarget | undefined): SpaceTarget | undefined {
  return target !== undefined && 'spaceId' in target ? target : undefined;
}

function asDocument(target: SpaceTarget | DocumentTarget | undefined): DocumentTarget | undefined {
  return target !== undefined && 'documentId' in target ? target : undefined;
}
