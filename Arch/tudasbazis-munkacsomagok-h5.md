# Tudásbázis — Munkacsomag-terv (H5, 10. verzió)

*A [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] D27 pontjának kifejtése, a 20 pontos MVP-re. Adatmodell: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|B4 (10. verzió)]], API: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-api-kontraktus-b5|B5 (10. verzió)]]. Felváltja a [[Tervezés/Tervezés (hatodik kör)/tudasbazis-munkacsomagok-h5|H5 9. verzióját]], amely változástörténetként megmarad. Minden csomag önállóan delegálható: céllal, függőségekkel és „kész”-kritériummal.*

*Változás a 9. verzióhoz képest: a WP4 a D43–D44 szerepkör- és láthatósági modellre épül; a WP8 státusz-workflow helyett a két review-eres folyamatot (D45) valósítja meg; a WP7 visszaállítása és a WP13 archiválása review-kéréssé vált; új a WP23 (feladat-dashboard, D46). Megszűnt a „publikált → draft” logika (WP6) és a sablonból létrehozás (WP5, második ütem, D47). Új „második ütem” szakasz a D42, D47, D48 és D49 csomagjaival.*

## Sorrendi elvek

1. **Kockázat-előrehozás:** a legkockázatosabb, újszerű komponens továbbra is a **valós idejű közös szerkesztés** (D29). A spike (WP3) közvetlenül az auth után jön. **Megállási feltétel:** ha a WP3 „kész”-kritériuma nem teljesül, a D29 a második ütembe kerül, és az MVP 4. pontja visszaáll a D7 lock + heartbeat modellre. A review-folyamat (D45) ettől független: a lock-modellben is a piszkozat beküldésével indul.
2. **Második kockázat: a láthatósági szűrés (D44).** Egy kifelejtett olvasó végpont adatszivárgás. Ezért a „látható dokumentumok” lekérdezés-építő és a végpontonkénti láthatósági teszt a WP4 része, és **minden későbbi olvasó csomag „kész”-kritériumában** szerepel.
3. **Gerinc először:** WP0–WP8 után végigjátszható mag: login → színtér → létrehozás → közös szerkesztés → review-ra küldés → két jóváhagyás → Jóváhagyott.
4. **Hátulról védett demó-érték:** határidő-nyomásnál a csomagok a kiesési sorrend szerint esnek ki, elsőként az export (D21).
5. **Csomag-zárás:** CI-zöld tesztek + az érintett naplópontok visszaellenőrzése + rövid összefoglaló. Ami nincs a naplóban, nem épül meg (D21).

## Munkacsomagok

### WP0 — Skeleton, Compose, CI
**Tartalom:** monorepo (pnpm workspaces: `apps/backend`, `apps/frontend`, `packages/shared`); Docker Compose (frontend, backend, Postgres, assets-volume — D15; dev-ben Mailpit — D46); GitHub Actions: lint, typecheck, test, build; secret-váz (D13). A reverse proxy WebSocket-upgrade-et enged a `/collab` és a `/ws/notifications` útvonalon (D29, D46); a proxy az nginx a frontend-konténerben, a monorepo helye a `taltos-app/` (D50).
**Kész:** `docker compose up` után a backend és a frontend válaszol, mindkét WebSocket-útvonal fogad; CI zöld.
**Függőség:** —

### WP1 — Adatbázis-séma, migrációk, seed
**Tartalom:** a B4 (10. verzió) 1. szakaszának sémája Drizzle-ben és a 3. szakasz kézi migrációi: keresési infrastruktúra (`search_vector` címkékkel és fajtával), append-only triggerek (`events`, `document_revisions`), review-invariánsok (egy függő kérés, két review-er, review-er ≠ indítványozó), részleges indexek; a `taltos_retention` DB-szerep létrehozása (használat: második ütem). Dummy seed (D11): Általános színtér minden seed-felhasználóval Szerzőként; legalább három csapat-tér 3–6 taggal; `document_kinds` a kilenc régi kategóriából; dokumentumonként 1–3 témacímke (V33); vegyes review-állapotok (Piszkozat, Review-ra vár, Átdolgozandó, Jóváhagyott).
**A D51 kiegészítése:** `sessions` tábla; adatbázis-szerepek (`taltos_owner` a migrációhoz, `taltos_app` az alkalmazáshoz DELETE-jog nélkül, kivéve a D51j kapcsolótábláit; `taltos_retention`); az `events` hivatkozásai FK nélkül; `unarchive` kérésfajta; a review-er megszűnt helye; `proposed_review_due_at`; a rendszeresemények NULL aktorral.
**Kész:** üres DB-ből a migráció hibátlan; a seed a B4-nek megfelelő (ellenőrző teszt); a DB-invariánsok negatív tesztjei (harmadik review-er, saját magát jelölő indítványozó, második függő kérés, beküldés két review-er nélkül) hibát dobnak — a halasztott (deferred) triggerek a COMMIT-kor, ezt a teszt kezeli; egy megszűnt review-er hely nem dob hibát. Az író tesztek megírva; a futtatás a tulajdonosé (adatbázis-szabály).
**Függőség:** WP0

### WP2 — Autentikáció, munkamenet, allowlist
**Tartalom:** OIDC code flow (D5) — fejlesztésben is valódi Google, mock nincs; tesztekben session-injektálás (D49); httpOnly session + CSRF (D26), abszolút lejárat 8 óra, tétlenségi kiléptetés 60 perc, a WebSocket-forgalom aktivitásnak számít (NY10); kérésenkénti allowlist-middleware; allowlist seedelése konfigurációból (D49); `GET /me`; allowlist-védelem: törlés tiltva, amíg a felhasználó tulajdonos (409 `owner_handover_required`) vagy utolsó Színtérgazda; legalább egy Rendszeradmin (409 `last_admin`). Új felhasználó első belépéskor automatikusan Szerző az Általánosban (D43). **Rendszerindítás (D52):** friss telepítésen az elsőként belépő felhasználó Rendszeradminisztrátor és az Általános színtér kezdő Színtérgazdája lesz (az Általános szükség esetén ugyanabban a tranzakcióban jön létre), egyszer, sorosítva; `system_bootstrapped` esemény (új migráció a CHECK-listához); az üzembe helyezési útmutatóban: az első élesítéskor a tulajdonos lépjen be elsőként.
**Kész:** a munkamenet a `sessions` táblában él és újraindítást túlél (D51a); üres adatbázison az első belépő Rendszeradmin és az Általános Színtérgazdája, a második belépő már csak Szerző; két egyidejű első belépésből csak egy kap jogot (versenyhelyzet-teszt); allowlistes user belép és az Általános tagja; levett user következő kérése 403; a lejárat és a tétlenségi kiléptetés időutazásos teszttel ellenőrizve; a 409-es védőszabályok teszteltek.
**Függőség:** WP1

### WP3 — Közös szerkesztés spike (K0) ⚠️ *(megállási ponttal)*
**Tartalom:** Hocuspocus a Fastify mellett, közös HTTP-szerveren; CodeMirror 6 + `y-codemirror.next` **élő előnézettel** (legalább címsor, félkövér/dőlt, lista, link rejtett jelölőkkel — D40); Awareness névcímkékkel; `rehype-sanitize` (D16); minimál perzisztencia.
**Kész:** két böngészőben két felhasználó egyszerre ír élő előnézetben, a névcímkék látszanak, ütközés nincs; szerver-újraindítás után a tartalom megmarad.
**Ha nem teljesül:** lásd a sorrendi elvek 1. pontját.
**Függőség:** WP2

### WP4 — Szerepkörök, zárt színterek, láthatóság
**Tartalom:**
- **Policy:** egyetlen `can(user, action, resource)` függvény a [[Felhasználók/Szerepkörök|jogosultsági mátrix]] szerint (Rendszeradmin, Színtérgazda, Szerző; D43). REST-middleware-ben és (a WP6-tól) a Hocuspocus `onAuthenticate`-ben is ezt hívja.
- **Láthatóság (D44):** „látható dokumentumok” lekérdezés-építő (aktív tagság), amelyet minden olvasó lekérdezés használ; nem tag → 403 `not_space_member` a színtér nevével és a Színtérgazdákkal, cím nélkül.
- **Színterek:** létrehozás a kezdeti Színtérgazdával (Rendszeradmin), lezárás (csak olvasható), leírás és szín (Színtérgazda); Általános egyetlen példányban.
- **Tagság:** felvétel, eltávolítás, előléptetés és visszaminősítés (Színtérgazda; Rendszeradmin felülírhat és saját magát is felveheti, `self_assigned`); 409 `last_space_manager`; tulajdonos eltávolítása átadás nélkül 409.
- **Kérések (API):** projekt-tér kérése és döntése (D43); felvételi kérés és döntése (D44). A felületük a WP23 dashboardja.
- **Felület:** *Adminisztráció* oldal (színterek, létrehozás, lezárás, Rendszeradminok); *Színtér beállításai* (tagok, szerepek, leírás, szín); színtérváltó a sidebarban.
- **Események:** `space_*`, `member_*`, `role_changed`, `system_admin_*`, `*_requested`, `*_request_decided`.
**Kész:** táblavezérelt mátrixteszt (minden szerep × minden művelet); **láthatósági teszt minden addigi olvasó végponton** (nem tag nem kap címet, tartalmat, darabszámot); a védőszabályok (utolsó gazda, utolsó admin) teszteltek.
**Függőség:** WP2

### WP5 — Dokumentum-mag: létrehozás, fajta, címkék
**Tartalom:** létrehozás Piszkozatként **üresen** vagy **duplikálással** (D47) a célszíntér megadásával; duplikálás bármely olyan színtérbe, amelynek a felhasználó tagja (D44), `szarmazik` kapcsolattal és `duplicated_from` eseménnyel mindkét oldalon; `kind` kötelező (D34, `document_kinds`); címke-megadás listából vagy szabad kézzel, normalizált egyezés automatikus cseréje, trigram ≥ 0,4 esetén max. 3 javaslat, árva címkék rejtése; `tag_text` denormalizálása a hozzárendeléssel azonos tranzakcióban (B4 S9); soha be nem küldött piszkozat eldobása.
**Kész:** létrehozás mindkét úton; duplikálás idegen (nem tag) színtérbe 403; a címke-felajánlás tesztelt; `kind` nélkül nem menthető; láthatósági teszt.
**Függőség:** WP1, WP4

### WP6 — Közös szerkesztés élesítése (K1–K7)
**Tartalom:** `onAuthenticate` (session, allowlist, `Origin`, tagság a WP4 policy-jával); **írás csak Piszkozat és Átdolgozandó állapotban**, Review-ra váró dokumentumon és lezárt térben `readOnly` (D45, D44); perzisztencia (`document_collab_state` + materializált `documents.content`, debounce); checkpoint-logika és „Verzió mentése” (`contributors`, opcionális üzenet); jelenlét-UI (minden néző tag az avatar-sorban, D49), kapcsolati állapot; offline (`y-indexeddb`); **szerkesztési élmény (D40):** teljes élő előnézet, helyi menü, lebegő formázósáv, hosszú nyomás érintőképernyőn, cellánkénti táblázatszerkesztés, billentyűparancsok, Tulajdonság-panel, forrásnézet-kapcsoló; keményítés (rate limit, méretkorlát, kapcsolatbontás tagság-visszavonáskor); a lock-kód és a lock-UI nem kerül át az SPA-ba. *(Megszűnt: „publikált → draft” az első írásra.)*
**Kész:** konvergencia-teszt több böngészőkontextussal; read-only kapcsolat update-je elutasítva (Jóváhagyott a „Módosítás indítása” előtt, Review-ra vár, lezárt tér, nem tag; D51c); tagság visszavonásakor a kapcsolat bontódik; 20 egyidejű szerkesztő stabil; a helyi menü minden pontja billentyűzetről is elérhető.
**Függőség:** WP3, WP4, WP5

### WP7 — Verziótörténet, diff
**Tartalom:** revíziólista Jóváhagyott jelöléssel és `iteration`-nel (v1, v2 …); **soronkénti diff szószintű kiemeléssel** + metaadat-diff (D45, B4 S10), alapból a legutóbbi Jóváhagyott és a legutóbbi változat között; „Visszaállítás erre” gomb, amely `restore` review-kérést indít (WP8).
**Kész:** két tetszőleges revízió diffje megjelenik, a módosult sorokon belül szókiemeléssel; a metaadat-változás (cím, fajta, címke, kapcsolat) a diffben látszik; láthatósági teszt.
**Függőség:** WP6 (a visszaállítás gombja a WP8-hoz kötődik)

### WP8 — Review-folyamat két review-errel ⚠️ *(a gerinc része)*
**Tartalom:** `ReviewService` mint a Jóváhagyott állapot egyetlen írója (B4 S13):
- **Módosítás indítása (D51c):** Jóváhagyott dokumentumon explicit lépés nyit új piszkozatot a legutóbbi Jóváhagyott revízióból (`edit_started`); addig a szerkesztő csak olvasható.
- **Beküldés** (`create`, `update`, `metadata`, `restore`, `delete`, `unarchive`): javasolt revízió a piszkozatból (`delete` és `unarchive` esetén nincs), két review-er választása a tagok közül (az indítványozón kívül; a közreműködők választhatók), opcionális üzenet; a tartalom befagy. Hibák: `request_pending`, `not_enough_reviewers` (3 tag alatt), `invalid_reviewers`, `stale_base_revision`.
- **Döntés:** jóváhagyás, illetve elutasítás kötelező indoklással (422 `reason_required`). Az elutasítás azonnal Átdolgozandó állapotba visz, az indoklás `review`-elemként jelenik meg a feedben. A második jóváhagyás egy tranzakcióban (`SELECT … FOR UPDATE`) véglegesít: `approved_revision_id`, `iteration + 1` (a kérésen is rögzítve), `review_due_at`, törlésnél `deleted_at`, `unarchive`-nál `deleted_at = NULL`, `restore`-nál a metaadat-pillanatkép visszaírása az élő táblákba (D51e).
- **Visszavonás, review-er csere** (indítványozó vagy Színtérgazda); kilépő review-er helye megszűnik, a kérés a pótlásig nem dönthető el (D51b, `reviewer_removed`).
- **Felülvizsgálat (D33, D51f):** az esedékesség a beküldéskor kötelező (12 hónapra előtöltve), a review tárgya, jóváhagyáskor lép érvénybe.
- **Felület:** „Review-ra küldés” párbeszédablak; review-nézet a diffel (WP7) és a döntés gombjaival; állapotjelvény és állapot-facet.
**Kész:** a teljes állapotgép tesztelt (minden átmenet és tiltott átmenet); versenyhelyzet-teszt (két egyidejű második jóváhagyás, két egyidejű beküldés); a négy szem elve és a review-er-szabályok teszteltek; az MCP, az export és a letöltés a Jóváhagyott revíziót adja.
**Függőség:** WP4, WP6, WP7

### WP9 — Események, kommentfolyam, @említés, audit-nézet
**Tartalom:** eseménynaplózás minden mutációra (B4 2. szakasz); egyesített feed (`comment`, `system`, `review`, D35); komment-életciklus (D20); **@említés** csak a színtér tagjai közül (D44); audit-nézetek: dokumentumon (tagok), színtér-szinten CSV-exporttal (Színtérgazda), rendszerszinten CSV-exporttal (Rendszeradmin).
**Kész:** minden korábbi csomag művelete nyomot hagy; az append-only trigger él; az audit-nézetek láthatósága tesztelt; nem tag nem említhető.
**Függőség:** WP5 (a WP6–WP8 eseményei rákötődnek)

### WP10 — Értesítések (alkalmazáson belül)
**Tartalom:** `notifications` az eseményekből ugyanabban a tranzakcióban, dashboard-kategóriával (D35, D46); címzett-szabályok (review-kérés, döntés, végeredmény, komment, @említés, követett dokumentum, tagság, kérések); 10 perces összevonás ugyanarról a kommentről (V22a); követés (`subscriptions`, a tulajdonos automatikusan követő, a kedvenctől független); **WebSocket-csatorna** (`/ws/notifications`) harang + olvasatlan-számláló élő frissítéssel; értesítés csak látható dokumentumról.
**Kész:** címzett-szabályok tesztelve; az összevonás tesztelt; tagság-visszavonás után nem jön értesítés a színtérből.
**Függőség:** WP9

### WP11 — Keresés, szűrők, rangsor
**Tartalom:** `GET /documents` a láthatósági lekérdezés-építőn át: FTS magyar + trigram, snippet; `search_vector` címkékkel és fajtával kis súllyal, szerzőnév nélkül (D49); **rangsor = relevancia + frissesség** (D36); facetek: Ma / Enyém / **Színtér** (csak a saját színterek) / Kedvenc / Sablon / **Állapot** (Piszkozat, Review-ra vár, Átdolgozandó, Jóváhagyott) / `kind` / címke / Felülvizsgálandó; a szűrők az URL-ben élnek (D49).
**Kész:** ragozott és elírt keresőszó talál; címkére keresve találat; a facetek kombinálhatók; **láthatósági teszt** (nem tag színterének dokumentuma semmilyen keresésben nem jelenik meg).
**Függőség:** WP5

### WP12 — Élő Atlasz az SPA-ban
**Tartalom:** a prototípus Atlaszának átvétele (D28); **csak a saját színterek**: alapból az aktuális színtér Jóváhagyott dokumentumai, a további saját színterek facetként bekapcsolhatók (D44); idegen színtérbe mutató él nincs; 300 csomópont fölött a kevés kapcsolatú csomópontok címkefürtbe vonódnak, kattintásra kinyílnak; színezés a színtérből, egyéni átszínezés kontraszt-figyelmeztetéssel (D37); lista mint akadálymentes elsődleges nézet.
**Kész:** a térkép és a lista egy store-ból szinkronizál; az egyéni szín privát; a fürtözés 300+ csomóponttal tesztelt; láthatósági teszt.
**Függőség:** WP4, WP11

### WP13 — Archívum
**Tartalom:** archiválás `delete` review-kéréssel, visszahozás archívumból `unarchive` review-kéréssel (WP8, D45, D51g); archívum-lista a saját színterekből, csak a valaha Jóváhagyott dokumentumokkal (az eldobott piszkozatok nélkül).
**Kész:** archiválás → két jóváhagyás → archívum → visszaállítás → két jóváhagyás; események naplózva; láthatósági teszt.
**Függőség:** WP8, WP9

### WP14 — Backup *(üzemeltetési MVP-elem, nem halasztható)*
**Tartalom:** napi `pg_dump` (D48), 30 napos és 12 havi megőrzés, külön gépen vagy tárolón titkosítva; havi visszaállítási próba jegyzőkönyvvel.
**Kész:** friss környezetben a dumpból teljes rendszer áll vissza (a `document_collab_state` nélkül is, a `documents.content`-ből); a megőrzési rotáció tesztelt.
**Függőség:** WP1 (érdemben WP9 után)

### WP15 — Kedvencek és követés a felületen
**Tartalom:** privát kedvencek (D18), Kedvenc facet; külön „Követés” gomb (D49).
**Kész:** privátság két userrel tesztelt; a kedvenc nem iratkoztat fel.
**Függőség:** WP10, WP11

### WP16 — Vágólap + nyers .md letöltés
**Tartalom:** kliensoldali másolás alapból frontmatter nélkül, második opcióként frontmatterrel (D49); `GET …/raw` a legutóbbi Jóváhagyott revízióból.
**Kész:** mindkét másolási mód és a letöltés működik a dokumentumnézetből.
**Függőség:** WP8

### WP17 — Felülvizsgálat
**Tartalom:** napi cron-job (D22): `review_due_soon` (7 nappal előtte), `review_due`, emlékeztető a napi összefoglalóban (D46); „Felülvizsgálandó” jelvény és facet; „Még aktuális” megerősítés **bármely színtér-tagnak, review nélkül** (D45); címzettek: tulajdonos + közreműködők; az esedékes dokumentumhoz írt komment nem zárja le az esedékességet, de a dashboardon kiemelve jelenik meg (D49).
**Kész:** az ütemezés időutazásos teszttel ellenőrizve; a megerősítés új esedékességet ad revízió és review nélkül.
**Függőség:** WP8, WP10

### WP18 — E-mail értesítés
**Tartalom:** SMTP-absztrakció Nodemailerrel (D46); dev-ben Mailpit, éles cím nem kaphat levelet (D11); **azonnali levél a review-kérésről**, minden emlékeztető (felülvizsgálat, 3 munkanapja függő review) **napi összefoglalóban**; levélben eseménytípus, cím, színtér, kezdeményező és link, tartalom nem. *A felhasználói beállítás és a leiratkozás nyitott (NY16): D-pont nélkül nem épül (D21).*
**Kész:** Mailpitben a levelek a szabályok szerint jelennek meg; a napi összefoglaló egy levél felhasználónként.
**Függőség:** WP10

### WP19 — Duplikátum-figyelmeztetés
**Tartalom:** létrehozáskor és az első beküldéskor **csak a cím** `pg_trgm`-hasonlósága, a saját színtereken belül, max. 5 javaslat, nem tilt (D36, D49).
**Kész:** egy ismert duplikátum felajánlódik; a forrásdokumentum duplikálásnál kimarad; nem tag színterének dokumentuma nem ajánlódik fel.
**Függőség:** WP5, WP11

### WP20 — Export (.pdf/.docx) 🔻 *(elsőként esik ki, D21)*
**Tartalom:** pandoc a backend-image-ben; `GET …/export` szinkron streaminggel, a legutóbbi Jóváhagyott revízióból; `.docx` Táltos-arculatú `reference.docx`-szel (D49).
**Kész:** mindkét formátum ékezethelyes, a `.docx` az arculati sablont használja.
**Függőség:** WP8

### WP21 — Kapcsolatok és visszahivatkozások
**Tartalom:** a 9. verzió szerinti tartalom (D39: helyi menüs beszúrás, `[cím](doc:uuid)`, Tulajdonság-panel, frontmatter a kimenetekben, `épít_rá` és `helyettesíti`, „elavult” jelzés, link és kapcsolat egy egység, `helyettesíti`-törlés a cél tulajdonosától rendszer-revízióként, Visszahivatkozások panel, Atlasz-élek), a 10. verzió változásaival:
- a dokumentumkereső csak a saját színterek dokumentumait mutatja; kapcsolat csak ilyen célra hozható létre (D44);
- az idegen színtérbe mutató link **csonkként** jelenik meg: rejtett cím, „nem elérhető” üzenet, a Színtérgazdák és a **„Felvétel kérése”** gomb (a kérés a WP23 dashboardjára fut);
- a kapcsolatok a piszkozat metaadatának részei, a review-ra küldéssel véglegesednek (D45).
**Kész:** átnevezés után a hivatkozás az új címet mutatja; idegen cél címe semmilyen válaszban nem szivárog (láthatósági teszt); a felvételi kérés a Színtérgazdánál megjelenik.
**Függőség:** WP5, WP8, WP9, WP10 (az Atlasz-élekhez WP12, a felvételi kérés felületéhez WP23)

### WP23 — Személyes feladat-dashboard *(új, MVP 20 — nem eshet ki)*
**Tartalom:** belépés utáni főoldal (D46), az Atlasz egy kattintásra; blokkok: rám váró review-k, függő indítványaim (review-er-cserével és a megszűnt helyek pótlásával, D51b), Átdolgozandó anyagaim (indoklással), esedékes felülvizsgálatok (kommentjelzéssel), @említések; Színtérgazdának felvételi kérések (elfogadás szereppel / elutasítás); Rendszeradminnak színtér-kérések (jóváhagyás a kezdeti Színtérgazdával / elutasítás). Időrend + színtér-szűrő; 3 munkanapja függő review kiemelve (D49); élő frissítés a WP10 WebSocket-csatornáján.
**Kész:** minden blokk a megfelelő szerepnek és csak neki jelenik meg; egy review-kérés a megjelölt review-ernél másodperceken belül megjelenik; a kérések elfogadása és elutasítása a dashboardról végigvihető; láthatósági teszt.
**Függőség:** WP4, WP8, WP10 (a felülvizsgálati blokkhoz WP17)

### WP22 — Pilot-előkészítés (D41)
**Tartalom:** pilot-korpusz (60–80 dummy dokumentum, közte hasonló és `helyettesíti`-vel elavult darabok, a második hétre eső felülvizsgálati esedékességek, és vegyes review-állapotok); ugyanennek a korpusznak a betöltése a jelenlegi megoldás teszt-terébe (**NY8:** Confluence vagy SharePoint — nyitott); négy színtér, mindegyikben legalább három résztvevővel a review-hoz; résztvevői allowlist; feladatlapok (T1–T8, köztük review-ra küldés és jóváhagyás), moderátori forgatókönyv (**NY9:** hozzáférés és moderátor — nyitott), hozzájárulási nyilatkozat, SUS-űrlap; naplóadat-lekérdezések az `events` táblára, **a review-terhelés mérésével** (átfutási idő, elutasítási arány).
**Kész:** próba-session egy résztvevővel mindkét eszközben lefut; a naplólekérdezések a mérőszámokat adják.
**Függőség:** az MVP 1–14. és 20. pontja (WP0–WP16, WP23); NY8, NY9 lezárása

## Kiesési sorrend határidő-nyomásnál

1. WP20 Export
2. WP19 Duplikátum-figyelmeztetés
3. WP18 E-mail értesítés (a review-kérés és a felülvizsgálat ekkor csak alkalmazáson belül és a dashboardon értesít)
4. WP21 Kapcsolatok (a `duplicated_from` esemény marad)
5. A WP12-n belül az egyéni átszínezés (az alapszínek maradnak)
6. WP17 Felülvizsgálat (a kötelező esedékesség mező a WP8-ban megmarad, csak az ütemezett értesítés esik ki)

Ami nem eshet ki: WP0–WP11, WP13, WP14, WP23. Ha a WP3 megállási feltétele teljesül, a WP6 helyére a D7 lock kerül.

## Függőségi térkép

```
WP0 ─ WP1 ─ WP2 ─┬─ WP3 ⚠️ ───────────────┐
                 └─ WP4 ─┬─ WP5 ───────────┴─ WP6 ─ WP7 ─ WP8 ⚠️ ─┬─ WP13
                         │     │                                  ├─ WP16
                         │     │                                  ├─ WP20 (utolsó)
                         │     ├─ WP9 ─ WP10 ─┬─ WP18             │
                         │     │              ├─ WP15             │
                         │     │              └──────┬────────────┴─ WP17
                         │     │                     └─ WP23 (WP4, WP8, WP10)
                         │     ├─ WP11 ─┬─ WP12
                         │     │        └─ WP19
                         │     └─ WP21 (WP8, WP9, WP10 után)
WP14: WP1 után bármikor, érdemben WP9 után
WP22: az MVP 1–14. és 20. pontja után
```

## MVP-lefedettség (napló v10, 5. fejezet → csomagok)

| MVP-pont | Csomag |
|---|---|
| 1. OIDC + allowlist + allowlist-védelem | WP2 |
| 2. Zárt színterek + Rendszeradmin, Színtérgazda, Szerző + kötelező gazda | WP4 |
| 3. Létrehozás üresen vagy duplikálással + fajta + címkék | WP5 |
| 4. Valós idejű közös szerkesztés | WP3, WP6 |
| 5. Verziótörténet + diff + visszaállítás | WP7, WP8 |
| 6. Review-folyamat két review-errel + felülvizsgálati esedékesség | WP8 |
| 7. Keresés + szűrők + rangsor | WP11 |
| 8. Élő Atlasz | WP12 |
| 9. Események + kommentfolyam + @említés | WP9 |
| 10. Értesítések (alkalmazáson belül, WebSocket) | WP10 |
| 11. Archívum | WP13 |
| 12. Backup | WP14 |
| 13. Kedvencek | WP15 |
| 14. Vágólap + .md | WP16 |
| 15. Felülvizsgálat | WP17 |
| 16. Kapcsolatok | WP21 |
| 17. E-mail értesítés | WP18 |
| 18. Duplikátum-figyelmeztetés (cím alapján) | WP19 |
| 19. Export | WP20 |
| 20. Személyes feladat-dashboard | WP23 |

*(A csomagszámok nem ütemezési sorrendet jelentenek, azt a függőségi térkép és a kiesési sorrend adja.)*

Mind a 20 pont lefedett, árva csomag nincs.

## Második ütem (nem MVP)

| Csomag | Tartalom | Naplópont |
|---|---|---|
| WP30 — Többformátumú tartalom | B4 6. szakasz migrációja; formátumonkénti kezelő-registry (`validate`, `extract`, `diff`); `.skill` csomag fájlfaként, egyszemélyes szerkesztés a csomagon belül; HTML-riport izolált originről, sandboxolt iframe-ben; PDF- és cellaszintű Excel-diff; export = eredeti fájl | D42 |
| WP31 — Sablonból létrehozás és fájlimport | sablonná jelölés review-val, globális sablonválasztó; egyenkénti `.txt`/`.md`/`.docx` import pandoc-kal, előnézettel | D47 |
| WP32 — Allowlist-felület | Rendszeradmin-felület, „inaktív tulajdonosok” lista az átadáshoz | D49, NY3 |
| WP33 — Retenció | cron a `taltos_retention` szereppel; heti előnézet és legal hold; pszeudonimizálás a kilépés utáni retenciós idő végén | D48 |
| WP34 — MCP-elérés | MCP-szerver a REST olvasó végpontjai fölött, felhasználóhoz kötött tokennel; csak Jóváhagyott revízió, csak saját színterek | D38, D49 |
| WP35 — Kisebb tételek | mentett szűrőnézetek, „Kövesd X-et”, szövegrészhez kötött kommentek | D49, D35 |
