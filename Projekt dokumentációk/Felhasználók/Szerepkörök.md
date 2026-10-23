---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 2
---

# Szerepkörök

> [!success] Döntve — D43, D44, D45 (Döntési napló v10, 2026-10-23)
> A színtéren belül **két szerep** van: **Színtérgazda** és **Szerző**. Minden tartalmi változáshoz **két review-er jóváhagyása** kell. A színterek **zártak**. A prototípusban még nincs megvalósítva.

## Cél

Egy helyen legyen leírva, milyen szerepek léteznek, ki osztja ki őket, és melyik szerep mit tehet. A tartalmi változások review-folyamata a [[Dokumentumok/Státusz-workflow|Státusz-workflow]] jegyzetben van, a színterek zártságának következményei a [[Kollaboráció/Színterek|Színterek]] jegyzetben.

## Döntések (2026-10-23)

1. **Rendszeradminisztrátor = a korábbi Admin, összevonva.** Egyetlen globális adminisztratív szerep: allowlist, színterek létrehozása és lezárása, fajta-lista (D34). **A színtér létrehozásakor ő jelöli ki a Színtérgazdát.**
2. **Delegált tagságkezelés.** A színtér résztvevőit a Színtérgazda veszi fel és távolítja el. Ő állítja a szerepüket is, Szerzőt Színtérgazdává is előléptethet. A Rendszeradminisztrátor bármikor felülírhatja.
3. **Az adminisztratív és a tartalmi jog szétválik.** A Rendszeradminisztrátor csak akkor lát és szerkeszt tartalmat, ha az adott színtérnek tagja.
4. **Két színtér-szerep: Színtérgazda és Szerző.** A Jóváhagyó és az Olvasó szerep megszűnik. A jóváhagyás nem szerephez, hanem a változásonként megjelölt két review-erhez kötött.
5. **Zárt színterek.** A színtér tartalmát csak a tagjai látják (keresés, Atlasz, MCP is). Ez a D30 „olvasás mindig nyitott” elvét felülírja.
6. **Négy szem elve, két review-errel.** Új feltöltéshez, tartalommódosításhoz, dokumentumfrissítéshez és bármilyen törléshez az indítványozónak két review-ert kell megjelölnie a színtér tagjai közül, saját magán kívül. A változás csak mindkettőjük jóváhagyásával válik véglegessé. Részletek: [[Dokumentumok/Státusz-workflow|Státusz-workflow]].

## Szerepkör-katalógus

### Globális szerepek

| Szerep | Ki kapja | Lényeg |
|---|---|---|
| **Felhasználó** | mindenki, aki az allowlisten van és belépett | beléphet; azokat a színtereket látja, amelyeknek tagja |
| **Rendszeradminisztrátor** | egy másik Rendszeradminisztrátor nevezi ki; az elsőt a rendszerindítás adja: a friss telepítésen a `BOOTSTRAP_ADMIN_EMAIL` címmel elsőként belépő felhasználó, aki egyben az Általános színtér kezdő Színtérgazdája (D52, D54) | allowlist, színterek, kezdeti Színtérgazda kijelölése, fajta-lista, rendszerszintű audit; **tartalmi jog csak tagként** |

### Színtér-szerepek

Egy felhasználónak színterenként legfeljebb egy szerepe van. Aki nem tag, az a színtér tartalmát nem látja.

| Szerep | Ki osztja ki | Lényeg |
|---|---|---|
| **Szerző** | Színtérgazda (vagy Rendszeradminisztrátor) | olvassa és szerkeszti a színtér tartalmát; változást indítványoz; review-erként jóváhagy vagy elutasít |
| **Színtérgazda** | létrehozáskor a Rendszeradminisztrátor; utána Színtérgazda léptet elő | a Szerző jogai + tagok felvétele és eltávolítása, szerepállítás (előléptetés, visszaminősítés), a színtér leírása és színe |

### Változásonkénti viszonyok (nem szerepek)

| Viszony | Jelentés |
|---|---|
| **Indítványozó** | aki a változást review-ra küldi; ő jelöli meg a két review-ert |
| **Review-er** | a változáshoz megjelölt színtér-tag (Szerző vagy Színtérgazda), az indítványozótól különböző; két különböző személy |
| **Tulajdonos** | a dokumentum gazdája (D31, V12); a felülvizsgálati értesítéseket kapja (D33). Megtartását lásd a Nyitott kérdések között |

## Jogosultsági mátrix

✓ = megengedett · (✓) = feltétellel · – = nem

| Művelet | Nem tag | Szerző | Színtérgazda | Rendszeradmin (nem tag) |
|---|---|---|---|---|
| A színtér és tartalmának látása (lista, keresés, Atlasz, MCP) | – | ✓ | ✓ | (✓) ¹ |
| Kommentelés, @említés, kedvencek | – | ✓ | ✓ | – |
| Szerkesztés piszkozatban (közös szerkesztés, D29) | – | ✓ | ✓ | – |
| Review-ra küldés (új dokumentum, módosítás, feltöltés, törlés) két review-errel | – | ✓ | ✓ | – |
| Review-erként jóváhagyás, elutasítás indoklással | – | (✓) ² | (✓) ² | – |
| Saját indítvány visszavonása | – | ✓ | ✓ | – |
| „Még aktuális” megerősítés (D33) | – | ✓ | ✓ | – |
| Tagok felvétele, eltávolítása | – | – | ✓ | ✓ |
| Előléptetés Színtérgazdává, visszaminősítés Szerzővé | – | – | ✓ | ✓ |
| Színtér leírása, színe (D37) | – | – | ✓ | ✓ |
| Színtér-szintű auditnézet, CSV-export | – | – | ✓ | – |
| Felvétel kérése egy színtérbe | ✓ | – | – | – |
| Projekt-tér kérése | ✓ | ✓ | ✓ | – |
| Színtér létrehozása a kezdeti Színtérgazdával, lezárása | – | – | – | ✓ |
| Allowlist, Rendszeradminisztrátorok, fajta-lista | – | – | – | ✓ |
| Rendszerszintű auditnapló, CSV-export | – | – | – | ✓ |

¹ Csak a színtér adatai látszanak (név, tagok, Színtérgazdák), a tartalom nem. Ezek kellenek az adminisztrációhoz.
² Csak ha az adott változáshoz review-erként megjelölték. Saját indítványát senki nem hagyhatja jóvá.

## Szabályok és védelmek

- **Legalább egy Rendszeradminisztrátor mindig van** (409 `last_admin`, változatlan).
- **Minden színtérnek legalább egy Színtérgazdája van:** az utolsó Színtérgazda nem távolítható el és nem minősíthető vissza (409 `last_space_manager`).
- **Egy színtérnek legalább három tagja kell legyen,** különben nincs két review-er az indítványozón kívül. Kevesebb tag esetén a Review-ra küldés nem érhető el, és a felület ezt jelzi (409 `not_enough_reviewers`).
- **Review-er eltávolítása (D51b):** ha egy megjelölt review-er kikerül a színtérből vagy az allowlistről, a sora „megszűnt” jelölést kap (`reviewer_removed`), és a slot üres marad. A másik review-er meglévő döntése megmarad; az indítványozó új review-ert jelöl, a kérés addig nem dönthető el, a dashboard jelzi a pótlást.
- **Allowlist-törlés:** nem törölhető, aki utolsó Színtérgazda, vagy aki dokumentum tulajdonosa (409 `owner_handover_required`, változatlan).
- **Rendszeradminisztrátor saját magát veszi fel egy színtérbe:** további feltétel nélkül megteheti; külön esemény jelöli (`member_added`, `self_assigned: true`), értesítés nincs.
- **Projekt-tér kérése:** bármely felhasználó kérheti (név, cél, javasolt Színtérgazda); a Rendszeradminisztrátor hagyja jóvá és hozza létre. A kérés a [[Nyomonkövetés/Feladat-dashboard|dashboardján]] jelenik meg.
- **Felvétel kérése:** idegen színtérbe mutató link csonkjáról a felhasználó felvételt kérhet; a kérés a Színtérgazdák dashboardján jelenik meg.
- **Általános színtér:** minden allowlistre felvett felhasználó automatikusan Szerző benne; Színtérgazdáját a Rendszeradminisztrátor jelöli ki.
- **Lezárt projekt-tér:** a dokumentumok és a tagság megmarad, minden csak olvasható.
- **Minden szerepváltás naplózott:** `member_added`, `member_removed`, `role_changed` (előléptetés, visszaminősítés), `space_manager_assigned`, `system_admin_granted`, `system_admin_revoked`.

## Megvalósítás

- **Adatmodell:**
  - `users.is_admin` → `users.system_role` (`user` | `system_admin`).
  - `space_members (space_id, user_id, role)`, ahol `role ∈ {author, space_manager}`.
  - A review-folyamat táblái: [[Dokumentumok/Státusz-workflow|Státusz-workflow]].
- **Ellenőrzés:** egyetlen backendoldali policy-függvény, `can(user, action, resource)`, amelyet a REST middleware (D26) és a Hocuspocus `onAuthenticate` (D29) is használ. A zártság miatt **minden olvasó lekérdezés** is a tagságra szűr: lista, keresés (D4, D36), Atlasz (D28), kapcsolatok (D39), értesítések (D35), MCP (D38). Ezt érdemes egyetlen helyen, egy „látható dokumentumok” lekérdezés-építőben megoldani. Postgres Row-Level Security is szóba jöhet.
- **Tesztelés:** a jogosultsági mátrix minden cellája egy táblavezérelt teszteset, ahogy a láthatósági szűrés minden olvasó végponton is.
- **Felület az MVP-ben:**
  - *Adminisztráció* (Rendszeradminisztrátor): színterek listája, létrehozás a kezdeti Színtérgazdával, lezárás, Rendszeradminisztrátorok.
  - *Színtér beállításai* (Színtérgazda): tagok, szerepek, leírás, szín.
  - *Review-ra küldés* párbeszédablak: két review-er választása a tagok közül; *Saját review-feladataim* lista.
  - Az allowlist-karbantartó felület továbbra is második ütem (NY3).

## További szerepjelöltek

| Jelölt | Javaslat |
|---|---|
| **Technikai kliens (MCP/API)** | Nem külön szerep: a felhasználóhoz kötött token (D38) a felhasználó színtereit és csak a Jóváhagyott tartalmat éri el. |
| **Auditor** | Opcionális, jövőbeli: a rendszerszintű auditnaplót látja, a tartalmat nem. |
| **Csak olvasó tag** | A döntés szerint nincs. Ha a pilot igényli, egy harmadik, `reader` szerep a `space_members` táblába később felvehető. |
| **Vendég, külső olvasó** | Elvetve. |

## Nyitott kérdések

- ~~Az Általános színtér?~~ **Döntve (D43):** minden felhasználó automatikusan Szerző benne.
- ~~A tulajdonos fogalma?~~ **Döntve (D43):** megmarad: felelősséget jelent (felülvizsgálati értesítések, D33), jogot nem.
- ~~Közreműködő mint review-er?~~ **Döntve (D45):** lehet; csak az indítványozó kizárt.
- ~~Elakadt review?~~ **Döntve (D45):** az indítványozó vagy a Színtérgazda kicserélheti a review-ert; helyette dönteni senki nem dönthet.
- ~~Színtér-szintű auditnézet?~~ **Döntve:** igen, CSV-exporttal ([[Transzparencia/Auditnapló|Auditnapló]]).
- ~~Entra ID csoportok?~~ **Döntve (D43):** jövőbeli munka.
- ~~Projekt-tér létrehozása?~~ **Döntve (D43):** kérés + Rendszeradminisztrátori jóváhagyás.
- ~~Lezárt projekt-tér szerepei?~~ **Döntve (D44):** megmaradnak, minden csak olvasható.
- ❓ **Nyitott (NY11–NY19 a naplóban):** a dokumentum-tulajdonos átadásának végpontja, jogosultja és review-köteles volta (D31); a Rendszeradminisztrátor felülírási joga a felvételi kérések döntésében; a rendszerszintű audit láthatósága.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]: **D43** (szerepkörök), **D44** (zárt színterek), **D45** (review-folyamat), D46 (dashboard). Felülírja a D30 nyitott olvasását, a D31 szerepköreit és a D32-t.

## Kapcsolódó egységek

[[Felhasználók/Jogosultságok|Jogosultságok]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Kollaboráció/Színterek|Színterek]] · [[Felhasználók/Allowlist|Allowlist]] · [[Transzparencia/Auditnapló|Auditnapló]] · [[Kimenet/MCP és API|MCP és API]]
