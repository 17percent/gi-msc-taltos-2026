---
tags:
  - taltos/egyseg
allapot: prototípusban
mvp: 1
---

# Allowlist

## Cél

Csak kifejezetten engedélyezett e-mail-címek léphessenek be, minden kérésnél ellenőrizve.

## Működés a prototípusban

„Szabó Kata” szándékosan nincs az allowlisten: belépéskor 403 `not_on_allowlist` hibát kap. Karbantartó felület nincs.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D5 (kérésenkénti ellenőrzés middleware-ben). Második ütem: allowlist-karbantartó felület.

## Nyitott kérdések

- **Döntve ([[Versenytárs-elemzés]] V12):**
  - Felhasználó nem törölhető az allowlistről, amíg dokumentum tulajdonosa: előbb át kell adni a tulajdonjogot (409 `owner_handover_required`, a felület felkínálja az átadást).
  - Az allowlist nem csökkenhet nullára: legalább egy Rendszeradminisztrátor mindig marad (409 `last_admin`).
- ~~Inaktív tulajdonosok?~~ **Döntve (D49):** második ütem: Rendszeradminisztrátor-felület „inaktív tulajdonosok” listával (X napja nem lépett be), az átadáshoz. Kilépéskor a tulajdonjog átadása kötelező (D48).
- ~~NY3: felület vagy konfiguráció?~~ **Döntve (D49):** MVP-ben konfiguráció, második ütemben felület.
- ~~Honnan jön az első Rendszeradminisztrátor és az Általános színtér kezdeti Színtérgazdája?~~ **Döntve (D52, módosítva: D54, 2026-10-23):** a friss telepítésen a konfigurált `BOOTSTRAP_ADMIN_EMAIL` címmel (a tulajdonos) elsőként belépő felhasználó lesz mindkettő; egyszeri, sorosított rendszerindítás, `system_bootstrapped` eseménnyel. Amíg ez nem történt meg, más nem léphet be („a rendszer még nincs beállítva”, `setup_pending`).
- **Archivált dokumentumok (D54):** a tulajdonos-védelem csak az archiválatlan dokumentumokra él; aki csak archivált dokumentumok tulajdonosa, kivehető. Archívumból visszahozáskor a tulajdonost át kell adni (NY15). Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
- ~~A konfigból töltött allowlist szemantikája?~~ **Döntve (D53, 2026-10-23):** a konfiguráció a forrás, a backend induláskor szinkronizál. Új cím → felvétel; eltávolított cím → soft delete, de csak ha a 409-es védelmek engedik (különben aktív marad, figyelmeztetéssel); újra felvett cím → ugyanaz a sor újra aktív. Az események aktor nélküliek (`allowlist_added`, `allowlist_removed`).
- ~~Entra ID csoportalapú belépés?~~ **Döntve (D43):** jövőbeli munka; addig az allowlist az egyetlen belépési feltétel.
- ~~Ki az allowlist gazdája?~~ **Döntve (2026-10-23):** a Rendszeradminisztrátor (a korábbi Admin). Új tiltás: utolsó Színtérgazda sem törölhető az allowlistről. Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].

## Kapcsolódó egységek

[[Felhasználók/Bejelentkezés|Bejelentkezés]] · [[Felhasználók/Jogosultságok|Jogosultságok]]
