import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { isRetryable, messageFor, type ErrorContext } from './errors';

/** A spec 6. szakaszának minden sora: (kód, művelet, kontextus) → pontos magyar üzenet. */
const cases: Array<[string, ApiError, ErrorContext, string]> = [
  [
    '6.1 last_space_manager, szerepváltás',
    new ApiError('last_space_manager', 409),
    { action: 'change-role', name: 'Nagy Béla' },
    'Ennek a színtérnek legalább egy Színtérgazdája kell legyen. Előbb léptess elő másik tagot Színtérgazdává, utána minősítsd vissza Nagy Béla szerepét.',
  ],
  [
    '6.1 last_space_manager, eltávolítás',
    new ApiError('last_space_manager', 409),
    { action: 'remove-member', name: 'Nagy Béla' },
    'Ennek a színtérnek legalább egy Színtérgazdája kell legyen, ezért Nagy Béla nem távolítható el. Előbb léptess elő másik tagot Színtérgazdává.',
  ],
  [
    '6.1 last_admin',
    new ApiError('last_admin', 409),
    { action: 'revoke-admin', name: 'X' },
    'Legalább egy Rendszeradminisztrátornak maradnia kell. Előbb jelölj ki másik Rendszeradminisztrátort, utána vond vissza ezt a jogot.',
  ],
  [
    '6.1 owner_handover_required (őszinte szöveg, NK6)',
    new ApiError('owner_handover_required', 409),
    { action: 'remove-member', name: 'Szabó Csilla' },
    'Szabó Csilla még nem archivált dokumentumok tulajdonosa, ezért nem távolítható el. Előbb át kell adni a dokumentumait a színtér egy másik tagjának; ezt a tulajdonos vagy a Színtérgazda teheti meg.',
  ],
  [
    '6.1 space_closed',
    new ApiError('space_closed', 403),
    { action: 'update-space' },
    'Ez a projekt-tér közben lezárult, ezért már csak olvasható. A tagságot a Rendszeradminisztrátor módosíthatja.',
  ],
  [
    '6.1 forbidden, általános',
    new ApiError('forbidden', 403),
    { action: 'update-space' },
    'Ehhez a művelethez nincs jogosultságod. Ha szerinted kellene, kérd a Színtérgazdát vagy a Rendszeradminisztrátort.',
  ],
  [
    '6.1 forbidden, eltávolítás az Általánosból',
    new ApiError('forbidden', 403),
    { action: 'remove-member', general: true },
    'Az Általános színtér tagsága automatikus, ezért tagot nem lehet eltávolítani. A szerepe módosítható.',
  ],
  [
    '6.1 forbidden, nem projekt-tér lezárása',
    new ApiError('forbidden', 403),
    { action: 'close-space' },
    'Csak projekt-tér zárható le.',
  ],
  [
    '6.1 validation_error, létrehozás (NK9 tartalék)',
    new ApiError('validation_error', 400),
    { action: 'create-space' },
    'Nem sikerült menteni. Ilyen nevű színtér már lehet, vagy a megadott adatok nem megfelelők. Válassz másik nevet, és ellenőrizd a többi mezőt.',
  ],
  [
    '6.1 validation_error, átnevezés (NK9 tartalék)',
    new ApiError('validation_error', 400),
    { action: 'rename-space' },
    'Nem sikerült menteni. Ilyen nevű színtér már lehet, vagy a megadott adatok nem megfelelők. Válassz másik nevet, és ellenőrizd a többi mezőt.',
  ],
  [
    '6.1 validation_error, tagfelvétel',
    new ApiError('validation_error', 400),
    { action: 'add-member' },
    'Ezt a felhasználót nem tudtuk felvenni: lehet, hogy már tag, vagy már nem szerepel a belépésre jogosultak között. Frissítsd a tagok listáját, és próbáld újra.',
  ],
  [
    '6.1 not_found, általános',
    new ApiError('not_found', 404),
    { action: 'change-role' },
    'Ez az elem már nem található. Frissítsd az oldalt.',
  ],
  [
    '3.2 not_found, jogkezelés',
    new ApiError('not_found', 404),
    { action: 'grant-admin' },
    'A felhasználó már nem található. Frissítsd a listát.',
  ],
  [
    '6.2 unauthenticated',
    new ApiError('unauthenticated', 401),
    { action: 'load' },
    'A munkameneted lejárt. Jelentkezz be újra.',
  ],
  [
    '6.2 not_on_allowlist',
    new ApiError('not_on_allowlist', 403),
    { action: 'load' },
    'A fiókod már nem jogosult a belépésre. Fordulj a rendszergazdához.',
  ],
  [
    '6.2 csrf_failed',
    new ApiError('csrf_failed', 403),
    { action: 'add-member' },
    'A művelet nem sikerült, mert a munkameneted frissítésre szorul. Töltsd újra az oldalt, és próbáld újra.',
  ],
  [
    '6.2 internal_error',
    new ApiError('internal_error', 500),
    { action: 'add-member' },
    'Valami félresikerült nálunk, a változtatás nem mentődött el. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.',
  ],
  [
    '6.2 hálózati hiba',
    new ApiError('network', 0),
    { action: 'create-space' },
    'Valami félresikerült nálunk, a változtatás nem mentődött el. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.',
  ],
  [
    '6.2 a csomagban nem várt kód → általános szöveg, kód nélkül',
    new ApiError('request_pending', 409),
    { action: 'add-member' },
    'Valami félresikerült nálunk, a változtatás nem mentődött el. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.',
  ],
];

describe('hibakód → üzenet tábla (spec 6.)', () => {
  it.each(cases)('%s', (_label, error, context, expected) => {
    expect(messageFor(error, context)).toBe(expected);
  });

  it('nem ApiError-t is az általános szöveggel jelez', () => {
    expect(messageFor(new Error('boom'), { action: 'update-space' })).toContain(
      'Valami félresikerült nálunk',
    );
  });

  it('az üzenet nem tartalmaz kódot vagy a szerver szövegét', () => {
    for (const [, error, context] of cases) {
      const text = messageFor(error, context);
      expect(text).not.toMatch(/_error|_closed|_admin|request_|forbidden|HTTP/);
    }
  });

  it('újrapróbálhatónak csak a szerver-, hálózati és csrf-hibát tekinti', () => {
    expect(isRetryable(new ApiError('network', 0))).toBe(true);
    expect(isRetryable(new ApiError('internal_error', 500))).toBe(true);
    expect(isRetryable(new ApiError('csrf_failed', 403))).toBe(true);
    expect(isRetryable(new ApiError('last_admin', 409))).toBe(false);
    expect(isRetryable(new ApiError('validation_error', 400))).toBe(false);
  });
});
