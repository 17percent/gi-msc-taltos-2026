# Tudásbázis — Munkacsomag-terv (H5, 9. verzió)

*A [[Tervezés/Tervezés (hatodik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v9]] D27 pontjának kifejtése, az NY6 (MVP-hatókör újraszámolása) lezárásaként. Felváltja a 7. verzióra épülő, Git-alapú H5-öt (`Tervezés (negyedik kör)`), amely változástörténetként megmarad. Minden csomag önállóan delegálható: céllal, függőségekkel és „kész"-kritériummal.*

## Sorrendi elvek

1. **Kockázat-előrehozás:** a legkockázatosabb, újszerű komponens a **valós idejű közös szerkesztés** (D29: Yjs + Hocuspocus + CodeMirror 6, szerkesztőcsere). Ezért a spike (WP3) közvetlenül az auth után jön, minden funkcionális csomag előtt. **Megállási feltétel:** ha a WP3 „kész"-kritériuma nem teljesül, a D29 az MVP-ből a második ütembe kerül, és az MVP 4. pontja visszaáll a D7 lock + heartbeat modellre (a prototípusban már működik). Ezt naplópontként kell rögzíteni.
2. **Gerinc először:** WP0–WP6 után végigjátszható mag: login → színtér → létrehozás → közös szerkesztés → checkpoint.
3. **Jogosultság a gerincben:** a színterek és a szerepkörök (WP4) korán jönnek, mert a közös szerkesztés `readOnly` módja (D29), a jóváhagyás (D32) és a felülvizsgálat címzettjei (D33) is rájuk épülnek.
4. **Hátulról védett demó-érték:** határidő-nyomásnál a csomagok a kiesési sorrend szerint esnek ki (lásd lent), elsőként az export (D21).
5. **Csomag-zárás:** CI-zöld tesztek + az érintett naplópontok visszaellenőrzése + rövid összefoglaló. Ami nincs a naplóban, nem épül meg (D21).

## Munkacsomagok

### WP0 — Skeleton, Compose, CI
**Tartalom:** monorepo (pnpm workspaces: `apps/backend`, `apps/frontend`, `packages/shared`); Docker Compose (frontend, backend, Postgres, assets-volume — D15; dev-ben Mailpit — D35); GitHub Actions: lint, typecheck, test, build; secret-váz (D13). A reverse proxy WebSocket-upgrade-et enged (D29).
**Kész:** `docker compose up` után a backend és a frontend válaszol, a `/collab` útvonal WebSocketet fogad; CI zöld.
**Függőség:** —

### WP1 — Adatbázis-séma, migrációk, seed
**Tartalom:** a v9 4. fejezetének sémája Drizzle-ben: `documents` (`space_id`, `kind`, `review_due_at`, kötelező tulajdonos), `document_revisions` (+ `contributors`), `document_collab_state`, `spaces`, `space_members`, `user_space_colors`, `tags`, `document_tags`, `favorites`, `events` (append-only trigger), `comments`, `notifications`, `subscriptions`, `allowlist`, `users` (`is_admin`); keresési infrastruktúra kézi migrációként (`tsvector` magyar, `pg_trgm`, GIN). Dummy seed (D11): a kilenc régi kategória `kind` érték, dokumentumonként 1–3 témacímke (D34, V33).
**Kész:** üres DB-ből a migráció hibátlan; a seed a B4-nek megfelelő (ellenőrző teszt).
**Függőség:** WP0

### WP2 — Autentikáció, allowlist, allowlist-védelem
**Tartalom:** OIDC code flow (D5); httpOnly session + CSRF (D26); kérésenkénti allowlist-middleware; `GET /me`; **allowlist-védelem** (D31): törlés tiltva, amíg a felhasználó dokumentum tulajdonosa (409 `owner_handover_required`), és az utolsó Admin nem törölhető (409 `last_admin`).
**Kész:** allowlistes user belép; levett user következő kérése 403; a két 409-es védőszabály tesztelt.
**Függőség:** WP1

### WP3 — Közös szerkesztés spike (K0) ⚠️ *(megállási ponttal)*
**Tartalom:** Hocuspocus a Fastify mellett, közös HTTP-szerveren; CodeMirror 6 + `y-codemirror.next` **élő előnézettel** (legalább címsor, félkövér/dőlt, lista, link rejtett jelölőkkel — D40); Awareness névcímkékkel; `rehype-sanitize` (D16); minimál perzisztencia.
**Kész:** két böngészőben két felhasználó egyszerre ír élő előnézetben, a névcímkék látszanak, ütközés nincs; szerver-újraindítás után a tartalom megmarad.
**Ha nem teljesül:** lásd a sorrendi elvek 1. pontját.
**Függőség:** WP2

### WP4 — Színterek és szerepkörök
**Tartalom:** `spaces` CRUD (Általános beépített; csapat- és projekt-tér; lezárás); tagság és szerepek (Olvasó, Szerző, Jóváhagyó, Színtérgazda, Admin — D31); jogosultság-middleware a REST-re; tulajdonosváltás csak szerkesztőre (`owner_changed`), Olvasóvá visszaminősítés tiltva, amíg tulajdonos; színtérváltó a sidebarban; események (`space_*`, `member_*`, `role_changed`).
**Kész:** szerepkör-mátrix teszt (minden szerep × minden művelet); négy szem elve tesztelt.
**Függőség:** WP2

### WP5 — Dokumentum-mag: létrehozás, fajta, címkék
**Tartalom:** „létrehozás forrásból" (D17) a színtér megadásával; **duplikálás = színterek közötti átvitel egyetlen módja** (D30); `kind` kötelező mező (D34); címke-megadás listából vagy szabad kézzel, normalizált egyezés automatikus cseréje, trigram ≥ 0,4 esetén max. 3 javaslat, árva címkék rejtése (D34); metaadat-PATCH.
**Kész:** létrehozás mindhárom úton; a címke-felajánlás tesztelt (pontos egyezés, ragozott alak, új címke); `kind` nélkül nem menthető.
**Függőség:** WP1, WP4

### WP6 — Közös szerkesztés élesítése (K1–K7)
**Tartalom:** `onAuthenticate` (session, allowlist, `Origin`, színtér-szerep → `readOnly`); perzisztencia (`document_collab_state` + materializált `documents.content`, debounce); checkpoint-logika és „Verzió mentése" (`contributors`); **publikált → draft** az első írási update-nél (D29, V6); jelenlét-UI (avatar-sor, „éppen szerkesztik" jelvény, kapcsolati állapot); offline (`y-indexeddb`); **szerkesztési élmény (D40):** teljes élő előnézet, helyi menü minden formázási és beszúrási ponttal, lebegő formázósáv kijelöléskor, hosszú nyomás érintőképernyőn, cellánkénti táblázatszerkesztés, billentyűparancsok, Tulajdonság-panel, forrásnézet-kapcsoló; keményítés (rate limit, méretkorlát, kapcsolatbontás visszavonáskor); a lock-kód és a lock-UI nem kerül át az SPA-ba.
**Kész:** konvergencia-teszt több böngészőkontextussal; read-only kapcsolat update-je elutasítva; publikált dokumentum az első írásra draftba esik; 20 egyidejű szerkesztő stabil; a helyi menü minden pontja billentyűzetről is elérhető, és a beszúrt markdown a forrásnézetben helyes.
**Függőség:** WP3, WP4, WP5

### WP7 — Verziótörténet, diff, visszaállítás
**Tartalom:** revíziólista, soronkénti diff két checkpoint között (alkalmazásszintű szövegdiff, D21); visszaállítás az élő Y.Doc-on direct connectionnel, új revízióként (D29).
**Kész:** két tetszőleges revízió diffje megjelenik; visszaállítás élő munkamenet közben is működik, a történet nem íródik át.
**Függőség:** WP6

### WP8 — Státusz-workflow jóváhagyással
**Tartalom:** négy státusz; `review → publikált` csak Jóváhagyónak, sajátot nem hagyhat jóvá (D32); elutasítás kötelező indoklással, kiemelt rendszerüzenetként (V22); publikáláskor kötelező felülvizsgálati esedékesség, alapérték 12 hónap (D33).
**Kész:** jogosultsági és négy szem-tesztek; indoklás nélküli elutasítás 422.
**Függőség:** WP4, WP6

### WP9 — Események, kommentfolyam, @említés, audit-nézet
**Tartalom:** eseménynaplózás minden mutációra; egyesített feed (lapos, időrendi — D35); komment-életciklus (D20); **@említés** (`@[név](user:uuid)`, bárki az allowlistről); globális audit-nézet.
**Kész:** minden korábbi csomag művelete nyomot hagy; említés kinyerése mentéskor tesztelt; az append-only trigger él.
**Függőség:** WP5 (a WP6–WP8 eseményei rákötődnek)

### WP10 — Értesítések (alkalmazáson belül)
**Tartalom:** `notifications` az eseményekből ugyanabban a tranzakcióban (D35); címzett-szabályok (jóváhagyási kérés, jóváhagyás/elutasítás, komment, @említés, követett dokumentum, tagság); 10 perces összevonás ugyanarról a kommentről (V22a); követés (`subscriptions`), a tulajdonos automatikusan követő; harang + olvasatlan-számláló, polling.
**Kész:** címzett-szabályok tesztelve; az összevonás tesztelt.
**Függőség:** WP9

### WP11 — Keresés, szűrők, rangsor
**Tartalom:** `GET /documents`: FTS magyar + trigram, snippet; **rangsor = relevancia + frissesség** (D36); facetek: Ma / Enyém / színtér / Kedvenc / Sablon / státusz / `kind` / címke / Felülvizsgálandó.
**Kész:** ragozott és elírt keresőszó talál; a frissebb dokumentum azonos relevanciánál előrébb kerül; a facetek kombinálhatók.
**Függőség:** WP5

### WP12 — Élő Atlasz az SPA-ban
**Tartalom:** a prototípus Atlaszának átvétele (D28 — a SPA-ba átvétel ezzel naplózott scope); közös térkép, aktuális színtér kiemelve (D30); **színezés a színtérből**, egyéni átszínezés kontraszt-figyelmeztetéssel, színátmenet nincs (D37); lista mint akadálymentes elsődleges nézet.
**Kész:** a térkép és a lista egy store-ból szinkronizál; az egyéni szín privát (két userrel tesztelt).
**Függőség:** WP4, WP11

### WP13 — Archívum
**Tartalom:** soft delete (D8), archívum-lista és visszaállítás; jogosultság: Színtérgazda (D31).
**Kész:** törlés → archívum → visszaállítás; események naplózva.
**Függőség:** WP4, WP9

### WP14 — Backup *(üzemeltetési MVP-elem, nem halasztható)*
**Tartalom:** ütemezett `pg_dump` külön tárolóra (D4), a `document_collab_state`-tel együtt; visszaállítási próba jegyzőkönyvvel.
**Kész:** friss környezetben a dumpból teljes rendszer áll vissza.
**Függőség:** WP1 (érdemben WP9 után)

### WP15 — Kedvencek
**Tartalom:** privát kedvencek (D18), Kedvenc facet.
**Kész:** privátság két userrel tesztelt.
**Függőség:** WP11

### WP16 — Vágólap + nyers .md letöltés
**Tartalom:** kliensoldali másolás, `GET …/raw` (D21).
**Kész:** mindkettő működik a dokumentumnézetből.
**Függőség:** WP5

### WP17 — Felülvizsgálat
**Tartalom:** napi cron-job (D22): `review_due_soon` (7 nappal előtte), `review_due`, heti `review_reminder`; „Felülvizsgálandó" jelvény és facet; „Még aktuális" megerősítés Szerző joggal (D33); címzettek: tulajdonos + közreműködők.
**Kész:** az ütemezés időutazásos teszttel ellenőrizve; megerősítés új esedékességet ad revízió nélkül.
**Függőség:** WP8, WP10

### WP18 — E-mail értesítés
**Tartalom:** SMTP-relay vagy Microsoft Graph (nyitott); dev-ben Mailpit, éles cím nem kaphat levelet (D11); ütemezett összefoglaló + azonnali jóváhagyási kérés; levélben csak cím + link; felhasználói beállítás és leiratkozás.
**Kész:** Mailpitben a levelek a szabályok szerint jelennek meg.
**Függőség:** WP10

### WP19 — Duplikátum-figyelmeztetés
**Tartalom:** létrehozáskor és első mentéskor cím + tartalom `pg_trgm`-hasonlóság, max. 5 javaslat, nem tilt (D36).
**Kész:** egy ismert duplikátum felajánlódik; a forrásdokumentum duplikálásnál kimarad.
**Függőség:** WP5, WP11

### WP21 — Kapcsolatok és visszahivatkozások
**Tartalom:** `document_links` (D39); „Kapcsolat beszúrása” a helyi menüben (WP6) dokumentumkeresővel és típusválasztóval, `[cím](doc:uuid)` tárolás és kinyerés mentéskor; kapcsolatok a Tulajdonság-panelen, frontmatterként az .md-letöltésben és az exportban (D39, V42); renderelés az aktuális címmel; `származik` a duplikálásból (WP5); kapcsolat-szerkesztő (`épít_rá`, `helyettesíti`) Szerző joggal a forrás színterében; „elavult" jelzés; értesítés a cél tulajdonosának (WP10); link és kapcsolat egy egységként (törlés mindkét irányban), panelről felvett kapcsolat a „Kapcsolódó dokumentumok” szakaszba; a cél tulajdonosának `helyettesíti`-törlése rendszer-revízióként (V50); archivált cél halványan; „Visszahivatkozások" panel; Atlasz-élek rugóként, egységes erővel (WP12).
**Kész:** átnevezés után a hivatkozás az új címet mutatja; a kapcsolat-szerkesztő jogosultsága tesztelt; a `helyettesíti` jelzés és értesítés megjelenik.
**Függőség:** WP5, WP9, WP10 (az Atlasz-élekhez WP12)

### WP22 — Pilot-előkészítés (D41)
**Tartalom:** pilot-korpusz (60–80 dummy dokumentum, közte hasonló és `helyettesíti`-vel elavult darabok, a második hétre eső felülvizsgálati esedékességek); ugyanennek a korpusznak a betöltése a jelenlegi megoldás (Confluence vagy SharePoint) teszt-terébe; négy színtér; résztvevői allowlist; feladatlapok (T1–T8), moderátori forgatókönyv, hozzájárulási nyilatkozat, SUS-űrlap; naplóadat-lekérdezések az `events` táblára.
**Kész:** próba-session egy résztvevővel mindkét eszközben lefut; a naplólekérdezések a 2. szakasz mérőszámait adják.
**Függőség:** WP0–WP16 (az MVP 1–14. pontja)

### WP20 — Export (.pdf/.docx) 🔻 *(elsőként esik ki, D21)*
**Tartalom:** pandoc a backend-image-ben; `GET …/export` szinkron streaminggel.
**Kész:** mindkét formátum ékezethelyes.
**Függőség:** WP5

## Kiesési sorrend határidő-nyomásnál

1. WP20 Export
2. WP19 Duplikátum-figyelmeztetés
3. WP18 E-mail értesítés (a felülvizsgálat és a jóváhagyási kérés ekkor csak alkalmazáson belül értesít)
4. WP21 Kapcsolatok (a `duplicated_from` esemény marad)
5. A WP12-n belül az egyéni átszínezés (az alapszínek maradnak)
6. WP17 Felülvizsgálat (a kötelező esedékesség mező a WP8-ban megmarad, csak az ütemezett értesítés esik ki)

Ami nem eshet ki: WP0–WP11, WP13, WP14. Ha a WP3 megállási feltétele teljesül, a WP6 helyére a D7 lock kerül.

## Függőségi térkép

```
WP0 ─ WP1 ─ WP2 ─┬─ WP3 ⚠️ ──────────┐
                 └─ WP4 ─┬─ WP5 ──────┴─ WP6 ─┬─ WP7
                         │     │              └─ WP8 ─┐
                         │     ├─ WP9 ─ WP10 ─┬───────┴─ WP17
                         │     │              └─ WP18
                         │     ├─ WP11 ─┬─ WP12
                         │     │        ├─ WP15
                         │     │        └─ WP19
                         │     ├─ WP16
                         │     ├─ WP21 (WP9, WP10 után)
                         │     └─ WP20 (utolsó)
                         └─ WP13
WP14: WP1 után bármikor, érdemben WP9 után
```

## MVP-lefedettség (napló v9, 5. fejezet → csomagok)

| MVP-pont | Csomag |
|---|---|
| 1. OIDC + allowlist + allowlist-védelem | WP2 |
| 2. Színterek + szerepkörök + kötelező gazda | WP4 |
| 3. Létrehozás forrásból + fajta + címkék | WP5 |
| 4. Valós idejű közös szerkesztés | WP3, WP6 |
| 5. Verziótörténet + diff + visszaállítás | WP7 |
| 6. Státusz-workflow jóváhagyással | WP8 |
| 7. Keresés + szűrők + rangsor | WP11 |
| 8. Élő Atlasz | WP12 |
| 9. Események + kommentfolyam + @említés | WP9 |
| 10. Értesítések (alkalmazáson belül) | WP10 |
| 11. Archívum | WP13 |
| 12. Backup | WP14 |
| 13. Kedvencek | WP15 |
| 14. Vágólap + .md | WP16 |
| 15. Felülvizsgálat | WP17 |
| 16. Kapcsolatok | WP21 |
| 17. E-mail értesítés | WP18 |
| 18. Duplikátum-figyelmeztetés | WP19 |
| 19. Export | WP20 |

*(A WP21 a D39 utólagos felvétele miatt kapott új számot; a csomagszámok nem ütemezési sorrendet jelentenek, azt a függőségi térkép és a kiesési sorrend adja.)*

Mind a 19 pont lefedett, árva csomag nincs.
