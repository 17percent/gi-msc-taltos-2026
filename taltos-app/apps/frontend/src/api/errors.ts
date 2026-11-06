import type { ErrorCode } from '@taltos/shared';
import { isApiError } from './client';

/** Melyik művelet közben történt a hiba (a spec 6. szakasza ettől függően más szöveget ad). */
export type ErrorAction =
  | 'load'
  | 'search'
  | 'create-space'
  | 'rename-space'
  | 'update-space'
  | 'close-space'
  | 'add-member'
  | 'change-role'
  | 'remove-member'
  | 'self-assign'
  | 'grant-admin'
  | 'revoke-admin'
  | 'switch-space'
  | 'create-document'
  | 'duplicate-document'
  | 'discard-draft'
  | 'create-tag'
  | 'create-kind'
  | 'load-kinds'
  | 'load-tags';

export type ErrorContext = {
  action: ErrorAction;
  /** Az érintett felhasználó neve (üzenetbe szúrva). */
  name?: string;
  /** A színtér az Általános (az eltávolítás tiltott). */
  general?: boolean;
  /** A célszíntér neve (a lezárt tér üzenetébe szúrva). */
  spaceName?: string;
};

type Message = (context: ErrorContext) => string;

const GENERIC =
  'Valami félresikerült nálunk, a változtatás nem mentődött el. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.';
const GENERIC_LOAD =
  'Valami félresikerült nálunk. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.';
const FORBIDDEN =
  'Ehhez a művelethez nincs jogosultságod. Ha szerinted kellene, kérd a Színtérgazdát vagy a Rendszeradminisztrátort.';
const VALIDATION_FALLBACK =
  'Nem sikerült menteni. Ilyen nevű színtér már lehet, vagy a megadott adatok nem megfelelők. Válassz másik nevet, és ellenőrizd a többi mezőt.';

const DOCUMENT_CREATE = new Set<ErrorAction>(['create-document', 'duplicate-document']);
const isLoad = (action: ErrorAction) =>
  action === 'load' || action === 'search' || action === 'load-kinds' || action === 'load-tags';

const CREATE_VALIDATION =
  'Nem sikerült létrehozni: a megadott adatok nem megfelelők. Lehet, hogy a fajta már nem választható, vagy egy címke már nem létezik. Ellenőrizd a mezőket, és próbáld újra.';
const CREATE_NOT_MEMBER =
  'Már nem vagy tagja a kiválasztott színtérnek (vagy a másolandó dokumentum színterének), ezért nem hozható létre a dokumentum. A színterek listája frissült.';
const CREATE_INTERNAL =
  'Valami félresikerült nálunk, a dokumentum nem jött létre. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.';
const CREATE_NETWORK =
  'A kapcsolat megszakadt, ezért nem tudjuk, létrejött-e a dokumentum. Próbáld újra; ha kétszer is létrejönne, a felesleges Piszkozatot eldobhatod.';
const DISCARD_INTERNAL =
  'Valami félresikerült nálunk, a Piszkozat még nem lett eldobva. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.';
const TAG_VALIDATION = 'Ezt a címkét nem tudtuk hozzáadni: ellenőrizd a szöveget (1–64 karakter).';
const KIND_VALIDATION =
  'Ezt a fajtát nem tudtuk felvenni: a név vagy a kulcs nem megfelelő, vagy ilyen kulcsú fajta már van. Ellenőrizd a mezőket, és próbáld újra.';

const who = (context: ErrorContext) => context.name ?? 'A felhasználó';

/**
 * Az egyetlen hely, ahol a hibakód → magyar üzenet leképezés él (spec 6. szakasz).
 * A szerver `title`/`detail` szövegét sosem mutatjuk.
 */
export const ERROR_MESSAGES: Partial<Record<ErrorCode, Message>> = {
  last_space_manager: (context) =>
    context.action === 'remove-member'
      ? `Ennek a színtérnek legalább egy Színtérgazdája kell legyen, ezért ${who(context)} nem távolítható el. Előbb léptess elő másik tagot Színtérgazdává.`
      : `Ennek a színtérnek legalább egy Színtérgazdája kell legyen. Előbb léptess elő másik tagot Színtérgazdává, utána minősítsd vissza ${who(context)} szerepét.`,
  last_admin: () =>
    'Legalább egy Rendszeradminisztrátornak maradnia kell. Előbb jelölj ki másik Rendszeradminisztrátort, utána vond vissza ezt a jogot.',
  owner_handover_required: (context) =>
    `${who(context)} még nem archivált dokumentumok tulajdonosa, ezért nem távolítható el. Előbb át kell adni a dokumentumait a színtér egy másik tagjának; ezt a tulajdonos vagy a Színtérgazda teheti meg.`,
  space_closed: (context) => {
    if (DOCUMENT_CREATE.has(context.action)) {
      return `A(z) „${context.spaceName ?? 'kiválasztott'}” projekt-tér közben lezárult, ezért nem hozható benne létre dokumentum. Válassz másik színteret.`;
    }
    if (context.action === 'discard-draft') {
      return 'Ez a projekt-tér közben lezárult, ezért a Piszkozat már nem dobható el.';
    }
    return 'Ez a projekt-tér közben lezárult, ezért már csak olvasható. A tagságot a Rendszeradminisztrátor módosíthatja.';
  },
  request_pending: (context) =>
    context.action === 'discard-draft'
      ? 'Közben review-ra küldték ezt a dokumentumot, ezért nem dobható el. Az oldal frissült.'
      : GENERIC,
  has_approved_revision: (context) =>
    context.action === 'discard-draft'
      ? 'Ezt a dokumentumot már beküldték review-ra, vagy volt Jóváhagyott változata, ezért nem dobható el. A tartalmát továbbra is szerkesztheted.'
      : GENERIC,
  forbidden: (context) => {
    if (context.action === 'discard-draft') {
      return 'Piszkozatot csak a tulajdonosa vagy a Színtérgazda dobhat el.';
    }
    if (context.action === 'remove-member' && context.general) {
      return 'Az Általános színtér tagsága automatikus, ezért tagot nem lehet eltávolítani. A szerepe módosítható.';
    }
    if (context.action === 'close-space') return 'Csak projekt-tér zárható le.';
    return FORBIDDEN;
  },
  validation_error: (context) => {
    if (DOCUMENT_CREATE.has(context.action)) return CREATE_VALIDATION;
    if (context.action === 'create-tag') return TAG_VALIDATION;
    if (context.action === 'create-kind') return KIND_VALIDATION;
    if (context.action === 'add-member' || context.action === 'self-assign') {
      return 'Ezt a felhasználót nem tudtuk felvenni: lehet, hogy már tag, vagy már nem szerepel a belépésre jogosultak között. Frissítsd a tagok listáját, és próbáld újra.';
    }
    if (
      context.action === 'create-space' ||
      context.action === 'rename-space' ||
      context.action === 'update-space'
    ) {
      return VALIDATION_FALLBACK;
    }
    return GENERIC;
  },
  not_found: (context) => {
    if (context.action === 'grant-admin' || context.action === 'revoke-admin') {
      return 'A felhasználó már nem található. Frissítsd a listát.';
    }
    if (context.action === 'create-document') {
      return 'A kiválasztott színtér már nem található. Válassz másikat.';
    }
    if (context.action === 'duplicate-document') {
      return 'A másolandó dokumentum már nem található. Lehet, hogy közben eldobták.';
    }
    if (context.action === 'discard-draft') {
      return 'A dokumentum már nem található. Lehet, hogy közben valaki eldobta.';
    }
    return 'Ez az elem már nem található. Frissítsd az oldalt.';
  },
  not_space_member: (context) => {
    // A váltó `PUT /me/current-space` hívása: a tagság közben megszűnt. Más helyen a hozzáférés-állapot oldal kezeli.
    if (context.action === 'switch-space') {
      return 'Ennek a színtérnek már nem vagy a tagja, ezért nem választható. A lista frissült.';
    }
    return DOCUMENT_CREATE.has(context.action) ? CREATE_NOT_MEMBER : FORBIDDEN;
  },
  unauthenticated: () => 'A munkameneted lejárt. Jelentkezz be újra.',
  not_on_allowlist: () => 'A fiókod már nem jogosult a belépésre. Fordulj a rendszergazdához.',
  csrf_failed: () =>
    'A művelet nem sikerült, mert a munkameneted frissítésre szorul. Töltsd újra az oldalt, és próbáld újra.',
  internal_error: (context) => {
    if (isLoad(context.action)) return GENERIC_LOAD;
    if (DOCUMENT_CREATE.has(context.action)) return CREATE_INTERNAL;
    if (context.action === 'discard-draft') return DISCARD_INTERNAL;
    return GENERIC;
  },
};

/** Hibaobjektumból felhasználói üzenet; ismeretlen vagy hálózati hiba az általános szöveget adja, kódot nem mutat. */
export function messageFor(error: unknown, context: ErrorContext): string {
  if (isApiError(error) && error.code === 'network' && DOCUMENT_CREATE.has(context.action)) {
    // A POST nem idempotens: hálózati megszakadásnál nem tudjuk, létrejött-e a dokumentum.
    return CREATE_NETWORK;
  }
  if (isApiError(error) && error.code !== 'network') {
    const message = ERROR_MESSAGES[error.code];
    if (message) return message(context);
  }
  return ERROR_MESSAGES.internal_error?.(context) ?? GENERIC;
}

/** Újrapróbálható-e értelmesen ugyanaz a kérés (szerverhiba, hálózat, lejárt CSRF-token). */
export function isRetryable(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return (
    error.code === 'network' || error.code === 'internal_error' || error.code === 'csrf_failed'
  );
}
