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
- ~~Honnan jön az első Rendszeradminisztrátor és az Általános színtér kezdeti Színtérgazdája?~~ **Döntve (D52, 2026-10-23):** a friss telepítésen elsőként belépő felhasználó (a tulajdonos) lesz mindkettő; egyszeri, sorosított rendszerindítás, `system_bootstrapped` eseménnyel. Az első élesítéskor ezért a tulajdonos lépjen be elsőként. Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].
- ❓ **Nyitott (NY18 a naplóban):** az MVP-ben a konfigból töltött allowlist szemantikája (konfigból törlés = soft delete és a védelmek futtatása, újrafelvétel).
- ~~Entra ID csoportalapú belépés?~~ **Döntve (D43):** jövőbeli munka; addig az allowlist az egyetlen belépési feltétel.
- ~~Ki az allowlist gazdája?~~ **Döntve (2026-10-23):** a Rendszeradminisztrátor (a korábbi Admin). Új tiltás: utolsó Színtérgazda sem törölhető az allowlistről. Lásd [[Felhasználók/Szerepkörök|Szerepkörök]].

## Kapcsolódó egységek

[[Felhasználók/Bejelentkezés|Bejelentkezés]] · [[Felhasználók/Jogosultságok|Jogosultságok]]
