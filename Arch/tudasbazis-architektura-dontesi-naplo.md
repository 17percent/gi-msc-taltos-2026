# Vállalati tudásbázis — architektúra-terv és döntési napló

Egyedi fejlesztésű, webes tudásbázis-rendszer ~200 fős vállalat számára, markdown alapú tartalommal. Szakdolgozati projekt; a fejlesztés saját infrastruktúrán indul, az éles üzem céges környezetben valósul meg.

*Verzió: 10. — **Szerepkörök, zárt színterek és review-folyamat (2026-10-23):** a vault nyitott kérdéseinek és naplóütközéseinek átvizsgálása nyomán új D42–D49. Felülírva: D15 csatolmány-tilalma (D42), D30 nyitott olvasása (D44), D31 szerepkörei (D43), D32 jóváhagyása és a D29 V6–V7 szabálya (D45); módosítva: D17 (D47), D35 (D46), D4, D33, D36, D38, D39. NY3, NY4 lezárva, NY5 elvetve, NY8–NY10 új. Az MVP 20 pontos (új: személyes dashboard). A 9. verzió a `Tervezés (hatodik kör)` mappában változatlanul megmarad.*

*10. verzió kiegészítése (2026-10-23, WP0): **D50** — reverse proxy (nginx a frontend-konténerben) és a fejlesztői eszközlánc.*

*10. verzió kiegészítése (2026-10-23, a B4 átvizsgálása): **D51** — tíz séma-pontosítás a WP1 előtt (munkamenet-tár, review-er kiesése, „Módosítás indítása”, rendszeresemények, piszkozat/Jóváhagyott metaadat, esedékesség, `unarchive`, retenció és FK-k, checkpoint-retenció, fizikai törlés kivételei); új nyitott kérdések: NY11–NY19. A 2. és 4. fejezet a v10 állapotához igazítva.*

*10. verzió kiegészítése (2026-10-23, WP1 CI): **D13 pontosítva** — a secret-fájlok jogosultsága (fejlesztés/CI: `0644` dummy; éles: konténer-felhasználóknak olvasható, világnak nem).*

*10. verzió kiegészítése (2026-10-23, WP2 előtt): **D52** — rendszerindítás: az első felhasználó (a tulajdonos) az első Rendszeradminisztrátor és az Általános színtér kezdő Színtérgazdája. Az NY18 első fele lezárva, a második (a konfigból töltött allowlist szemantikája) nyitott marad.*

*10. verzió kiegészítése (2026-10-23, WP2 előtt): **D53** — allowlist-szinkron a konfigból védelmekkel (az NY18 lezárva), `openid-client` + `@fastify/cookie`, saját double-submit CSRF, minimális belépő felület; a Google OAuth-klienst a tulajdonos hozza létre.*

*10. verzió kiegészítése (2026-10-23, a WP2 review-ja): **D54** — a rendszerindítás csak a `BOOTSTRAP_ADMIN_EMAIL` címmel (a D52 módosítása; addig mások `setup_pending`), az archivált dokumentum tulajdonosa kivehető az allowlistből (a D53 pontosítása).*

*Előző verzió: 9. — **Versenytárs-elemzés átvezetése (2026-10-19):** a [[Versenytárs-elemzés]] V1–V60 döntései D29–D41 naplópontként; a D28 (Élő Atlasz) átvéve az `Arch/` naplóból. D7 kiváltva (D29), D6 írási oldala felülírva (D31, D32), D19 felülírva (D34), D16, D26 és D28 módosítva. A 8. verzió a `Tervezés (ötödik kör)` mappában változatlanul megmarad.*

*8. verzió: — **Postgres-only tárolási architektúra** (D1 felülvizsgálat): a Git-alapú tartalomtárolás elhagyva, a tartalom és a teljes revíziótörténet közvetlenül PostgreSQL-ben él. D3, D9, D12, D24 megszűnt/tárgytalanná vált; D1, D2, D4, D10, D11, D13, D15, D17, D19, D21, D22, D26, D27 ennek megfelelően átdolgozva; NY2 megszűnt, NY5 új javaslatként felvéve. A korábbi (Git+Postgres) verzió indoklása a D1 alatt, változástörténetként megőrizve.*

## 1. Követelmények

- Markdown (.md) formátumú tudásanyagok tárolása — **kizárólag szöveges tartalom**, közvetlenül a PostgreSQL-ben; statikus képek (`.svg`, `.png`, `.jpeg` — ábrák, guide-ok, felületi design) megjelenítése az **alkalmazás szintjén kezelt assets mappából**, képfeltöltés nincs (lásd D15); **második ütemben HTML-riport, `.skill` csomag, PDF és Excel is (D42)**
- Dokumentum-létrehozás: **üres** és **duplikálás** (MVP); **sablonból** és **forrásból (fájlimport)** hátrasorolva (D17, D47)
- Teljes szövegű keresés (magyar nyelvi támogatással)
- ~~Kategorizálás: lapos címke-rendszer (D19)~~ → **Címkék és fajta (D34):** globális, szabadon megadott címkék redundancia-szűréssel + kötelező `kind` mező
- **Zárt színterek (D30, D44)**; **Rendszeradminisztrátor, Színtérgazda, Szerző (D43)**
- **Valós idejű közös szerkesztés (D29)**
- **Felülvizsgálati esedékesség és értesítések (D33, D35)**
- **Kedvencek:** privát, felhasználónkénti megjelölés és szűrés (D18)
- ~~Státuszkezelés (draft → review → tesztelt → publikált) jóváhagyási lépéssel (D32)~~ → **Review-folyamat (D45):** Piszkozat → Review-ra vár → Jóváhagyott / Átdolgozandó, minden változáshoz két review-er
- **Személyes feladat-dashboard főoldalként (D46)**
- Tulajdonos és módosító személyek nyilvántartása, teljes auditálhatóság
- Teszteltség / iterációk követése — a verziófogalom kettős: **revízió-történet** (minden mentés egy sor a `document_revisions` táblában) + `iteration` mező a `documents` táblán; harmadik, kézi „verziószám" tudatosan nincs
- Verziókezelés, korábbi állapotok visszaállítása, **diff-nézet (MVP, D21)**
- Komment szekció tudásanyagonként, rendszereseményekkel; komment-szerkesztés és -törlés auditnyommal (D20)
- **Törlés-elv: minden törlés soft delete**, végleges törlés csak data retention policy szerinti időzített folyamatként (D20, D48); kivétel a privát kapcsoló- és párosítótáblák (kedvenc, követés, saját szín, címke-hozzárendelés) sora (D51j)
- Hordozható szoftver: új környezetben új adatbázissal és új autentikációval üzembe helyezhető — **a Git-alapú tárolás elhagyásával ez immár szó szerint két elemre redukálódik: új PostgreSQL-instance + új OIDC-konfiguráció, nincs harmadik mozgó alkatrész (repo/kulcs)**
- **Vágólapra másolás és exportálhatóság** `.md`, `.pdf` és `.docx` formátumba — **MVP (D21)**

## 2. Architektúra áttekintés

*(10. verzió szerinti állapot, D29, D45, D46, D50, D51; a táblák teljes listája: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|B4 séma]].)*

```
Felhasználó (böngésző)
        │
        ▼
nginx a frontend-konténerben (D50) — kiszolgálja az SPA-t, proxyzza a backendet
        │
React SPA — Vite + React Router (CodeMirror 6 élő előnézettel, feladat-dashboard, Élő Atlasz)
        │  REST /api/v1   ·   WebSocket /collab (Yjs)   ·   WebSocket /ws/notifications
        ▼
Backend — Node.js + Fastify + Hocuspocus (TypeScript)  ──► OIDC szolgáltató
   │   can() policy · láthatósági szűrés · ReviewService        (fejlesztés: Google,
   │   eseménynaplózás · diff-számítás · cron (D22)              éles: Microsoft Entra ID)
   ▼
PostgreSQL — EGYETLEN adatréteg (nincs külön forrás és index):
   documents (élő állapot + generált tsvector), document_revisions (teljes szövegű pillanatkép)
   document_collab_state (Yjs), change_requests + review-erek (D45)
   spaces, space_members, users, sessions (D51), allowlist
   tags, document_tags, document_links, events, comments, notifications, subscriptions, favorites
   ← mind elsődleges, mentendő adat (pg_dump, ill. WAL-alapú PITR mérlegelendő)
```

*(Korábban, a 8. verzióig: react-md-editor, lock-kezelés a backendben, `categories` és `locks` tábla — kiváltva: D29, D34, D40.)*

**Felelősség-megosztás:**

| Réteg | Feladata |
|---|---|
| PostgreSQL | Egyetlen adatréteg: tartalom + teljes revíziótörténet + keresőindex (generált oszlop) + Yjs-állapot + review-kérések + események/audit + kommentek + értesítések + munkamenetek — minden elsődleges, mentendő adat |
| Backend API | Minden írás egyetlen kapuja (D2); a jogosultság az egyetlen `can()` policy-n, minden olvasás a láthatósági lekérdezés-építőn át (D44); a Jóváhagyott állapotot kizárólag a `ReviewService` írja (D45); eseménynaplózás; diff-számítás alkalmazásszinten; a `/collab` és a `/ws/notifications` csatorna |
| Frontend | Szerkesztés (közös, élő előnézettel), böngészés, keresés, dashboard, kommentfolyam, diff-megjelenítés |
| OIDC szolgáltató | Csak autentikáció (jelszó- és identitáskezelés kiszervezve) |

*(A korábbi verzióban itt szerepelt még a „Lokális Git clone" és „Remote repo" sor — ezek a Postgres-only pivottal megszűntek, lásd D1.)*

## 3. Döntési napló

### D1 — Tárolás: PostgreSQL — tartalom, revíziótörténet és keresőindex egyben *(felülvizsgálva — Postgres-only pivot)*

**Korábbi döntés (a változástörténet kedvéért megőrizve):** Git (source of truth) + PostgreSQL index. Indoklása akkor: a Git ingyen adja a verziótörténetet, a diffet, a visszaállítást és a fájlrendszer-szintű hordozhatóságot; a Postgres a keresés és a metaadat-lekérdezés gyengeségét pótolja. Ára akkor: két mozgó alkatrész, a commit↔index varratot kezelni kellett (korábbi D4), a lokális clone↔remote varratot a korábbi D12 kezelte.

**Alternatívák (jelen felülvizsgálatnál):** a fenti Git+Postgres modell megtartása; hálózati meghajtó / Obsidian vault; kész platform (Outline, Wiki.js, BookStack).

**Döntés indoklása:** a tartalom és a teljes revíziótörténet közvetlenül a PostgreSQL-ben él — nincs külön forrás (repo) és külön index, tehát nincs a kettő közti varrat sem. Minden mentés **egyetlen ACID-tranzakció**: új sor a `document_revisions`-ban + a `documents` jelenlegi állapotának frissítése + a keresőindex (`tsvector`) generált oszlopként újraszámolódik — mindez egy tranzakción belül, konzisztencia-kockázat nélkül. A diffet és a visszaállítást alkalmazásszintű logika adja (két revízió-pillanatkép összevetése), nem a Git.

**Mit veszítünk a korábbi döntéshez képest:** a repo „ingyen" verziótörténete/diffje helyett most a diff-motort magunknak kell futtatni — ez azonban a diff-nézet UI-t (D21) amúgy is meg kellett volna építeni, csak korábban a diff-forrás a `git diff` volt, most egy alkalmazásszintű szövegdiff-könyvtár. A „repo klónozható vészhelyzetben" képesség (korábbi D10) elesik — lásd 6. fejezet és az új NY5-javaslat.

**Mit nyerünk:** megszűnik a teljes Git-alréteg (SSH-kulcs, deploy key / service account, remote GitHub/Azure Repos, lokális clone, push-retry, lemaradás-monitoring, GitService-absztrakció) — ezzel **D3, D9, D12, D24 tárgytalanná válik**, D4 lényegesen egyszerűsödik, és a korábbi **NY2 (Azure Repos branch policy) architektúra-blokkoló kockázata magától megszűnik**. A hordozhatóság is erősödik: új környezet = új DB + új OIDC-konfig, nincs harmadik elem.

**Vállalt ára:** a teljes revíziótörténet (minden mentés teljes szövegű pillanatkép, nem delta) a Postgres-adatbázis méretét a mentésszámmal arányosan növeli — markdown szövegnél 200 fős szervezetben ez valószínűleg nem szűk keresztmetszet, de becslés/benchmark ajánlott (lásd 6. fejezet). A pg_dump immár az **egyetlen** backup-mechanizmus (korábban a tartalom a remote git-en is élt másodpéldányként) — ez a backup-fegyelmet kritikusabbá teszi (lásd D4).

### D2 — Minden írás kizárólag a webes API-n keresztül *(megerősítve, Git-keret nélkül)*

A közvetlen adatbázis-módosítás (kézi SQL, admin eszköz) szervezetileg tiltott, kizárólag dokumentált migráció vagy adminisztrátori beavatkozás keretében történhet, naplózva. Így a lock-mechanizmus, az eseménynaplózás és a keresőindex mindig konzisztens marad az alkalmazás állapotával. *(A korábbi indoklás — hogy a repo közvetlen módosítása [GitHub/Azure Repos felületen vagy klónon át] szervezetileg tiltott — tárgytalanná vált, mivel nincs többé repo; a képfeltöltési kivétel kérdése is okafogyottá vált, mert a képek eleve nem a tartalom-táblákban élnek, lásd D15.)*

### D3 — MEGSZŰNT: Backend-hitelesítés a repo felé *(törölve — Postgres-only pivot)*

Tárgytalan: nincs többé remote repo, amihez a backendnek hitelesítenie kellene magát. Az SSH-kulcspár, a GitHub deploy key és az Azure Repos dedikált service account koncepciója elesik. A backend hitelesítése kizárólag az adatbázis felé (connection string, lásd D13) és az OIDC szolgáltató felé (D5) marad releváns.

### D4 — Keresőindex: generált oszlop, nincs külön konzisztencia-varrat *(lényegesen egyszerűsödve — Postgres-only pivot)*

A `documents.search_vector` (`tsvector`, magyar konfiguráció) **generált oszlopként** (`GENERATED ALWAYS AS ... STORED`) él, közvetlenül a jelenlegi tartalomból számolva — ugyanabban a tranzakcióban frissül, mint maga a tartalom. Nincs külön „index" és „forrás", tehát nincs őket összefésülő reindex-mechanizmus, és nincs mit konzisztencia-ellenőrizni: a generált oszlop garantáltan szinkronban van a tartalommal, adatbázis-szinten.

**Ezzel törlődik a korábbi döntés két eleme:** a `reindex` parancs és az ütemezett „konzisztencia-őr" (clone HEAD vs. indexelt hash összevetés) — mindkettő a Git-forrás/Postgres-index kettősségre épült, ami megszűnt.

**Backup-stratégia (kötelező, megerősítve és szigorítva):** ütemezett `pg_dump`, külön tárolóra (nem ugyanarra a diszkre/gépre), definiált retencióval; a visszaállítási eljárás dokumentált és legalább egyszer kipróbált. **Mivel a pg_dump immár az egyetlen backup-mechanizmus** (nincs másodlagos tartalom-másolat egy remote repóban), a napi gyakoriság felülvizsgálandó — érdemes megfontolni a WAL-archiválást / point-in-time recovery-t (pl. `pgBackRest`, `WAL-G`) a szorosabb RPO érdekében, különösen élesben.

### D5 — Cserélhető autentikáció: generikus OIDC réteg

Fejlesztés alatt Google login, éles üzemben Microsoft Entra ID (céges App Registration). Az alkalmazás OIDC-szabványra épül, a szolgáltató konfigurációs kérdés — ez adja a hordozhatóságot is.
**Beléptetési kapu:** e-mail allowlist (Postgres-ben tárolva; kezdetben seed/konfig, később felületi karbantartás). A Google-login belső hálózatról is működik, csak a redirect URI-t kell regisztrálni.
**Kiegészítés:** az allowlist-tagság **minden API-kérésnél ellenőrzött**, nem csak beléptetéskor — az allowlistből eltávolított felhasználó hozzáférése azonnal megszűnik, nem a session lejártakor. Szigorú redirect URI-egyeztetés, teljes token-validálás (issuer, audience, lejárat) és CSRF-védelem az API-n.

### D6 — Nincs jogosultságkezelés: mindenki mindent lát és tehet *(kiegészítve; **írási oldala felülírva: D31, D32**; **10. verzió: olvasási oldala is felülírva: D44**)*

Minden belépett (allowlistes) felhasználó minden funkciót elér, és **minden tartalmat lát — ez kimondott cél, nem mellékhatás**: a tudásbázis rendeltetése a szervezeten belüli kollaboráció elősegítése, a teljes olvasási nyitottság ennek eszköze.
**Következmény (tartalompolitikai korlát):** a tudásbázisba kizárólag olyan tartalom kerülhet, amelyet a szervezet bármely tagja megismerhet. Ez bevezetéskor kimondandó szervezeti szabály.
**Kompenzáció az írási oldalon:** teljes átláthatóság — minden művelet (szerkesztés, státuszváltás, törlés, visszaállítás) eseményként naplózódik és a kommentfolyamban rendszerüzenetként megjelenik. A workflow-fegyelem szervezeti szabály, nem technikai kényszer: „technikailag nyitott, szervezetileg szabályozott."
**Vállalt korlát:** az auditnyom az írást fedi, az olvasást nem (olvasásnaplózás tudatosan nincs).

### D7 — Egyidejű szerkesztés: pesszimista lock + heartbeat *(**kiváltva: D29** — a prototípusban marad)*

Szerkesztő mód aktiválásakor a backend lockolja a dokumentumot; más felhasználó tájékoztató üzenetet kap. A nyitott szerkesztő 30–60 mp-enként heartbeatet küld; a lock heartbeat nélkül 2–5 perc után automatikusan lejár (lecsukott laptop, bezárt fül eseteit magától kezeli). A kliens piszkozatot őriz, így a lejárat nem jár munkavesztéssel. „Lock átvétele" funkció: második ütem.

### D8 — Törlés: archívum + felületi visszaállítás

Törléskor a dokumentum archív állapotba kerül (nem vész el; a teljes revíziótörténet is őrzi, lásd D1/4. fejezet). Az archívumnak webes listázó/visszaállító felülete van; karbantartása kijelölt személy szervezeti felelőssége.

### D9 — MEGSZŰNT: Események és kommentek a Postgres-ben *(összevonva D1-be — Postgres-only pivot)*

Tárgytalan különálló döntésként: miután minden adat (tartalom is) a Postgresben él, az „események és kommentek nem a Gitben, hanem a Postgresben" megkülönböztetés értelmét veszti. Lásd D1.

### D10 — Hosting: fejlesztés alatt saját szerver, élesben céges infrastruktúra *(módosítva — vészhelyzeti elérés elesik)*

Docker Compose-ban futó teljes stack (frontend, backend, Postgres) — ez adja a környezetfüggetlenséget: az éles üzembe állítás konfiguráció (domain, OIDC, DB-elérés), nem átépítés. Publikus PaaS free tier (Vercel/Netlify) elvetve: licenc- és kapacitáskorlátok, plusz nem futtatnak tartós backendet és adatbázist.

**Vészhelyzeti elérés (elvesző képesség, kimondva):** a korábbi Git-alapú architektúrában szerverleállás esetén a repo klónozható és Obsidiannal olvasható volt. Ez a Postgres-only architektúrában **megszűnik**: teljes leállás esetén nincs azonnal olvasható, alternatív másodpéldány — a helyreállítás a pg_dump backupon és a szolgáltatás újraindításán múlik. **Vállalt korlát** — enyhítési lehetőség: lásd az új NY5-javaslatot (7. fejezet).

### D11 — Fejlesztési adathatár *(módosítva — a Git remote-specifikus rész tárgytalan)*

Éles céges tartalom nem kerülhet a fejlesztői környezetbe (otthoni szerver, saját dev-adatbázis); a fejlesztés **kizárólag dummy adatokkal** történik. Éles adat csak a céges környezetben (céges Postgres-instance) születik.

*(A korábbi kiterjesztés — GitHub kizárólag fejlesztési környezet, Azure Repos élesben, mirror push az átálláskor — tárgytalanná vált: nincs többé git remote, amihez ezt a szabályt kötni kellene. Az éles/fejlesztői környezet elhatárolása most kizárólag a Postgres-instance-ok szintjén értelmezett, ami egyszerűbb és kevésbé hibázható.)*

### D12 — MEGSZŰNT: Git-hozzáférés (git protokoll + lokális clone) *(törölve — Postgres-only pivot)*

Tárgytalan: nincs lokális clone, nincs push, nincs lemaradás-monitoring, nincs „provider API tilos" szabály, mert nincs git-provider a tartalom oldalán. A korábbi sorosítási igény (a döntés utolsó pontja) is megszűnik — lásd D22 felülvizsgálatát: a Postgres natívan kezeli a konkurens írásokat tranzakciós szinten, nincs szükség külön worker-queue-alapú sorosításra a mentések között.

### D13 — Kulcs- és secret-kezelés *(egyszerűsödve — nincs SSH-kulcs)*

- A secretek (OIDC client secret, DB jelszó) **soha nem kerülnek Docker image-be, repóba vagy commitolható `.env` fájlba**.
- Betöltés Docker Compose secrets-ként (vagy bind-mount `0600`, root-only jogosultsággal); kizárólag a backend konténer kapja meg.
- ***Pontosítás (10. verzió, 2026-10-23, WP1):*** *a Compose a fájl-secretet bind-mountként, a host jogosultságával csatolja, és a konténerek nem rootként olvassák (Postgres: uid 70, node: uid 1000). A „`0600`, root-only” ezért nem működik: a fejlesztői és CI-s dummy secret-fájlok `0644`-esek; élesben az üzemeltetés adja a fájlokat a világ számára nem olvashatóan, a fájlt olvasó konténer-felhasználóknak (root tulajdonos, közös csoport, `0440`, vagy szolgáltatásonként külön fájl `0400`-zal). Az „app-secretet csak a backend kapja” változatlan; a DB-szerver a saját szerepköreinek jelszavát kapja (B4 S23).*
- Élesben opcionálisan Azure Key Vault, ha a céges infrastruktúra adja.
- *(A korábbi SSH-kulcs-specifikus pontok — környezetenkénti kulcspár, dedikált service account a repóhoz, rotációs eljárás a remote-nál — tárgytalanná váltak: nincs többé SSH-alapú repo-hitelesítés.)*

### D14 — Frontend stack: shadcn/ui + Tailwind + Motion *(új)*

A shadcn nem futásidejű függőség, hanem **bemásolt, saját tulajdonú komponenskód** — busz-faktor-1 projektnél előny: nincs breaking upgrade-kényszer, a karbantartás saját kézben van. A Tailwind-elköteleződés vállalt és kimondott. A Motion animációk funkcionális UX-visszajelzésre szolgálnak (mentés, lock-állapot, kommentfolyam-frissülés), nem öncélú effektekre.

### D15 — Tartalom-scope: szöveg a Postgresben; képek alkalmazásszintű statikus assets-ként; export MVP-ben *(módosítva — Postgres-only pivot; **10. verzió: a csatolmány-tilalom felülírva: D42**)*

- A tudásanyag szövege **kizárólag a `documents`/`document_revisions` táblákban** él (nem fájlrendszeren, nem repóban); képfeltöltés és csatolmány-kezelés nem funkciója a rendszernek.
- **Statikus képek** (`.svg`, `.png`, `.jpeg` — ábrák, guide-ok, felületi design) **az alkalmazás szintjén kezelt assets mappából** jelennek meg (mountolt volume, esetleg object storage), **nem a Postgresben** (nagy bináris blobok elkerülése) — a markdown az alkalmazás saját assets-útvonalára hivatkozik. Javasolt forma: mountolt volume (nem az image részeként) — új kép hozzáadása fájlmásolás, nem rebuild+redeploy.
- **Következmények (vállalva):** kép hozzáadása fejlesztői/üzemeltetői művelet, nem szerzői; a képek nem verziózódnak a tartalommal (csere visszamenőleg minden dokumentumverzióban érvényesül).
- **Export** `.md`, `.pdf` és `.docx` formátumba: MVP-be emelve (D21); a `.pdf`/`.docx` szerveroldali konverzióként tervezendő (pandoc — a tartalom a DB-ből egy ideiglenes fájlba írva a konverzió idejére); a `.md` letöltés és a vágólap-másolás kliensoldali, triviális.

### D16 — Markdown szerkesztő: @uiw/react-md-editor *(új; **módosítva: D29, D40** — a szerkesztő CodeMirror 6 élő előnézettel, helyi menüvel; a `rehype-sanitize` és a képforrás-korlát marad)*

Könnyű, textarea-alapú szerkesztő élő előnézettel — illik a markdown-fegyelmű, csak-szöveg scope-hoz (D15), nem WYSIWYG-absztrakció.
**Kötelező kiegészítések:**
- **rehype-sanitize** mind a szerkesztő-előnézetben, mind az olvasó nézetben — a nyers HTML átengedése betárolt XSS-t jelentene (200 szerző, mindenki olvas).
- **Képforrás-korlátozás a sanitize-sémában:** kép (`img` / markdown képszintaxis) kizárólag az alkalmazás saját assets-útvonaláról renderelődik; külső URL-ű képhivatkozás nem jelenik meg (privacy-szivárgás és megbízhatósági kockázat ellen).
- Az olvasó nézet **ugyanazzal a remark/rehype pipeline-nal** renderel, mint a szerkesztő előnézete.
- A piszkozat-őrzés (D7) a szerkesztő körüli saját felelősség, nem a komponensé.

### D17 — Sablonok: a sablon is tudásanyag; „létrehozás forrásból" egységes művelet *(módosítva — Postgres-only pivot; **10. verzió: módosítva: D47** — a „forrásból” fájlimportot jelent, a sablon hátrasorolva)*

**Döntés:** a sablon ugyanolyan tudásanyag-sor a `documents` táblában, mint bármely más dokumentum — sablon-mivolta **metaadat** (`is_template` oszlop, a felületen kategóriaszerű szűrőként jelenik meg). Nincs külön sablon-alrendszer: tárolás és kezelés a normál dokumentum-CRUD-on át (D2-vel és D15-tel konzisztens), teljes revíziótörténettel.
**Vállalt következmény (D6):** a sablonokat bárki módosíthatja — a sablonfegyelem szervezeti szabály, az auditnyom a védvonal.
**Implementációs egyesítés:** a *sablonból létrehozás* és a *duplikálás* ugyanaz a művelet — **„létrehozás forrásból"** —, csak a forrás más. Szemantika: az új dokumentum **új UUID-t** kap; a jelenlegi tartalomból egy új, első `document_revisions` sor és kategória-hozzárendelések másolódnak; **státusz = draft, owner = a létrehozó, iteration reset**; a forrás kommentjei és eseményei **nem** másolódnak; keletkezik `duplicated_from` esemény, amely mindkét dokumentumnál megjelenik. MVP.
*(Egyszerűsödés a korábbi verzióhoz képest: nincs többé repó-fájl másolási/útvonal-kezelési kérdés — a művelet tisztán relációs beszúrásokra redukálódik.)*

### D18 — Kedvencek: privát, felhasználónkénti; az első valódi per-user elsődleges adat *(új)*

**Döntés:** kedvencek funkció MVP-elemként — a felhasználó dokumentumokat kedvencnek jelölhet, a listák/keresés kedvencekre szűrhető.
**Láthatóság: privát** — kizárólag az adott felhasználó látja a saját kedvenceit. Ez konzisztens a D6 vállalt korlátjával: az átláthatóság az írási oldalt fedi, az olvasói preferencia nem naplózott, nem publikus.
**Adat-kategorizálási következmény:** a `favorites` tábla **elsődleges, sehonnan újra nem építhető adat** → a pg_dump backup-körbe tartozik. Ezzel a `users` tábla sem tisztán eldobható cache többé.

### D19 — Kategóriák: lapos címke-rendszer, alkalmazásszintű entitásként *(módosítva — Postgres-only pivot; **felülírva: D34**)*

**Döntés:** a kategorizálás **lapos** (nincs hierarchia); egy dokumentum **több kategóriába** is tartozhat (címke-szemantika); a kategória **entitás az alkalmazásban**, CRUD-műveletekkel.
**Szabályok:** új kategóriát **bárki** létrehozhat (D6-tal konzisztens); **használatban lévő kategória nem törölhető és nem nevezhető át** — módosítás/törlés csak akkor, ha egyetlen dokumentum sem hivatkozik rá. Kategória-műveletek eseményként naplózódnak.
**Egyszerűsödés a korábbi verzióhoz képest:** a `document_categories` kapcsolótábla **tisztán relációs, elsődleges adat** — nincs többé frontmatter-alapú „repo-önállóság" szempont, nincs mit reindex-ből újraépíteni, mert nincs második forrás (repo), amivel szinkronban kellene tartani. Ez megszünteti a korábbi döntés legbonyolultabb részét (a frontmatter-név stabilitásának biztosítását a törlési szabály miatt) — maga a szabály (használatban lévő kategória nem törölhető/nevezhető át) megmarad, de már nem egy szinkronizációs varrat védelmében, hanem önmagában, egyszerű adatintegritási okból.

### D20 — Komment-életciklus és általános törlés-elv: soft delete + retention *(új)*

**Komment szerkesztése:** megengedett a szerzőjének; a módosítás **nyomot hagy** — `comment_edited` esemény őrzi a korábbi tartalmat (JSONB details), a felületen „szerkesztve" jelölés.
**Komment törlése:** **soft delete** — a felületen a komment *helye* megmarad („törölt komment" placeholder), az adatbázisban a rekord megjelölve, nem törölve; `comment_deleted` esemény naplózódik.
**Általános elv (rendszerszintű):** a rendszerben **minden törlés soft delete** — dokumentum (D8 archívum), komment, kategória. Végleges (fizikai) törlés kizárólag **data retention policy** szerinti, időzített, automatizált folyamatként történik. A policy részletei később kerülnek kidolgozásra: **NY4**.

### D21 — Scope-emelés az MVP-be: vágólap, .md letöltés, diff-nézet, export *(módosítva — Postgres-only pivot)*

**Döntés:** a korábban második ütembe sorolt tételek közül MVP-be kerül: **vágólapra másolás** és **nyers .md letöltés** (kliensoldali, triviális); **diff-nézet UI** két verzió között; **.pdf/.docx export** szerveroldali pandoc-pipeline-nal.
**Diff-motor (módosítva):** a korábbi tervben a diff-motor „ingyen" volt (lokális `git diff`); a Postgres-only architektúrában a diffet alkalmazásszinten kell számolni egy szövegdiff-könyvtárral (pl. `diff`/jsdiff a két `document_revisions.content` pillanatkép között). **Ez a diff-nézet UI-t (react-diff-viewer / diff2html) érintő korábbi költségbecslést nem növeli lényegesen** — a diffszámítás két szöveg-string között triviális, csak a forrása változik (git parancs → könyvtárhívás).
**Kimondott ár:** a pandoc-export az egyetlen MVP-elem, amely új szerveroldali függőséget hoz és önálló munkacsomag — az MVP korábban 9-ről 13 pontra nőtt, most a reindex-tétel törlésével 12-re csökken (lásd 5. fejezet). A delegálási ütemtervben az export **hátrasorolt, utolsó csomag**.
**Scope-fegyelem szabály:** új funkcióigény kizárólag a döntési naplón keresztül léphet be — ami nincs a naplóban, az nem épül meg.

### D22 — Backend stack: TypeScript end-to-end, Node.js + Fastify; **worker queue elhagyva** *(felülvizsgálva — Postgres-only pivot)*

**Alternatívák:** NestJS (teljes keretrendszer); más nyelv a backendre (Python/Go/C#); a mentés-írás sorosítására worker queue (pg-boss vagy BullMQ/Redis) vs. natív Postgres-tranzakció.
**Döntés indoklása:** egyetlen nyelv a teljes stackben — busz-faktor-1 projektnél a kontextusváltás-költség és a duplikált tooling megszűnése többet ér, mint bármely nyelv részelőnye. A Fastify könnyű, gyors, sémavezérelt (JSON Schema validáció — a B5 API-kontraktushoz illeszkedik), keretrendszer-kényszer nélkül.
**A worker queue (pg-boss) elhagyása:** a korábbi indoklás kizárólag a Git-írások sorosítására vonatkozott (konkurens `index.lock` ütközés elkerülése egy fájlrendszer-alapú repón). Ez a probléma Postgres-only architektúrában **nem létezik**: egy mentés egyetlen ACID-tranzakció (revízió-beszúrás + állapotfrissítés + generált `tsvector`), és a Postgres natívan, sorosítás nélkül is helyesen kezeli a konkurens tranzakciókat (sor-szintű lockolás, MVCC). Külön worker-infrastruktúra erre nincs szükség.
**Ha mégis felmerül async-igény:** a data retention ütemezett törlése (NY4) és az esetleges nagy dokumentumokra vonatkozó export-időzítés egyszerű **cron-alapú ütemezett feladattal** (pl. `node-cron` a backend-folyamaton belül, vagy `pg_cron` extension, ha a céges Postgres engedélyezi) megoldható — ez nem igényel teljes job-queue keretrendszert, mert nincs olyan volumenű vagy megbízhatósági igény (retry, dead-letter), ami indokolná.
**Vállalt ár:** a NestJS strukturális kényszereiről lemondunk — a struktúrát a saját szerviz-rétegzés adja (services/repositories réteg, lásd D24).
**Egyenes következmény:** ezzel a korábban legkockázatosabbnak jelölt komponens (Git-írási alrendszer + pg-boss queue) **megszűnik** — a projekt kockázati profilja érdemben csökken (lásd D27 felülvizsgálatát).

### D23 — Frontend app-keretrendszer: Vite + React SPA, React Router *(új)*

**Alternatívák:** Next.js (SSR/RSC); más SPA-keretrendszer (Vue, Svelte).
**Döntés indoklása:** a rendszer belső, login mögötti alkalmazás — SEO és SSR-igény nincs, a Next.js csak komplexitást (szerver-runtime, RSC-mentálmodell) hozna. A Vite + React SPA a legkisebb mozgó alkatrész; a már eldöntött komponens-ökoszisztéma (react-md-editor D16, shadcn/ui D14, diff-viewer D21) natívan ebben él. Kliensoldali routing React Routerrel.
**Vállalt ár:** SPA-jelleg — első betöltési bundle-méret és kliensoldali state-kezelés; belső eszköznél elfogadható, kód-splitting szükség szerint.

### D24 — MEGSZŰNT: Git-hívás a backendben (simple-git, GitService) *(törölve — Postgres-only pivot)*

Tárgytalan: nincs git-hívás a backendben. Az adatelérési réteget a Drizzle (D25) query buildere és egy saját, vékony repository/service réteg adja (dokumentum-, revízió-, esemény-, kommentkezelés) — ugyanaz a rétegzési elv (a perzisztencia-részletek egy modul mögé rejtve), csak nincs mögötte külső CLI-folyamat, amit egy helyen cserélni kellene.

### D25 — Adatbázis-réteg és migráció: Drizzle *(új)*

**Alternatívák:** node-pg-migrate (nyers SQL-migrációk, query-réteg külön megoldandó); Prisma (kényelmes DX, de saját sémanyelv és futásidejű réteg).
**Döntés indoklása:** a Drizzle TypeScript-sémadefiníciót, generált migrációkat és **típusos query buildert** ad egyben, miközben SQL-közeli marad — nem klasszikus ORM. Illeszkedik a D22-es end-to-end TypeScript elvhez: a séma típusai a backend-kódban közvetlenül érvényesülnek. A Prisma elvetve: a séma gerincét adó `tsvector` (magyar konfiguráció), `pg_trgm` és generált oszlopok nála kézi kerülőutat igényelnek — **ez a Postgres-only pivottal még hangsúlyosabb szempont, mert a `document_revisions` és a generált `search_vector` oszlop most a séma központi eleme, nem csak egy kiegészítő index.**
**Kikötés:** a keresési infrastruktúra (extension-ök, generált `tsvector` oszlop, GIN indexek) **kézzel írt SQL-migrációként** él a Drizzle migrációs láncában (custom migration).
**Konkrét DDL:** a teljes séma külön tervdokumentumban (`tudasbazis-db-sema-b4.md`) — **ez a dokumentum a Postgres-only pivot után frissítésre szorul** (lásd a fejezet végi összefoglalót).

### D26 — API-kontraktus: REST `/api/v1`, cookie-session + CSRF, RFC 9457 hibák, code-first OpenAPI *(módosítva — mentés-szemantika egyszerűsödött; **ismét módosítva: D29** — új `/collab` WebSocket-végpont, a `PUT …/content` + `baseRevisionId` nem elsődleges mentési út többé)*

**Döntés (elvek, részletek: `tudasbazis-api-kontraktus-b5.md` — felülvizsgálandó, lásd megjegyzés):**
- **Session httpOnly cookie-ban** (az OIDC-token soha nem jár a böngésző JS-terében), `SameSite=Lax` + CSRF-token a mutáló kéréseken — a D5 CSRF-követelményének realizálása.
- **Hibaformátum: RFC 9457 Problem Details** + stabil gépi `code` mező.
- **Mentés-szemantika (egyszerűsödve):** a `PUT …/content` egyetlen szinkron DB-tranzakciót vár meg (200 + új `revisionId`) — **nincs többé „lokális commit szinkron, push aszinkron" kettősség, mert nincs push.** **Kötelező `baseRevisionId`** optimista ellenőrzéssel (412) a lock-lejárat utáni kései mentés ellen — a lock (D7) mellé második védvonal, ugyanaz a szerep, mint korábban a `baseCommitHash`-nek.
- **Code-first kontraktus:** a Fastify JSON Schema validáció (D22) az egyetlen forrás, az OpenAPI belőle generálódik (`@fastify/swagger`).
- Lapozás `limit`/`offset`; kommentek + rendszeresemények egyetlen szerverin fésült `feed` végpontból; export szinkron streaminggel.
**Vállalt ár:** a cookie-session a frontendet same-origin üzemre köti; a szinkron export nagy dokumentumnál timeout-kockázat.
**Megjegyzés:** a `tudasbazis-api-kontraktus-b5.md` külön dokumentum a `baseCommitHash` → `baseRevisionId` átnevezést és a push-related szakaszok törlését igényli — ez a jelen napló hatókörén kívül eső, de érintett dokumentum.

### D27 — Megvalósítási sorrend: munkacsomagok, kockázat-előrehozással *(módosítva — a legkockázatosabb komponens megszűnt; **ismét módosítva, 9. verzió:** a kockázat-előrehozás célja a D29 K0-spike, megállási feltétellel; részletek: [[Tervezés/Tervezés (hatodik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomag-terv (9. verzió)]])*

**Döntés:** a fejlesztés delegálható munkacsomagokban halad (részletek: `tudasbazis-munkacsomagok-h5.md` — felülvizsgálandó, lásd megjegyzés), sorrendi elvekkel:
1. **Kockázat-előrehozás (átértékelve):** a korábban legkockázatosabbnak jelölt komponens (Git-írási alrendszer: GitService + pg-boss queue) **megszűnt** — nincs többé git-írási kísérletezést igénylő alrendszer. Az így felszabaduló legkockázatosabb hátralévő elem a **keresőindex + generált `tsvector` oszlop (magyar konfiguráció, `pg_trgm`)** és a **diff-motor** — ezeket érdemes az új „korán derítendő kockázat" helyére tenni, közvetlenül a séma után.
2. **Gerinc először:** a séma után végigjátszható mag épül (login → létrehozás → mentés = DB-tranzakció); a levél-funkciók erre rakódnak, egymástól függetlenül, párhuzamosíthatóan.
3. **Hátulról védett demó-érték:** határidő-nyomásnál a csomagok hátulról előre esnek ki, elsőként az export — összhangban D21 hátrasorolásával.
4. **Csomag-zárási fegyelem:** minden csomag CI-zöld tesztekkel + a naplópontok visszaellenőrzésével zárul; új igény csak a naplón át.
**Egyenes következmény:** a korábbi munkacsomag-listából a Git-írási alrendszerre épülő csomag törlődik — a teljes ütemterv valószínűleg rövidebb és kevésbé kockázatos lett. **A `tudasbazis-munkacsomagok-h5.md` dokumentum újratervezése szükséges** (lásd a fejezet végi összefoglalót).

### D28 — Élő Atlasz: élő erő-szimulációs elrendezés, Obsidian-szerű interakcióval *(új, 2026-10-18 — átvéve az `Arch/` naplóból; **módosítva: D37**)*
**Döntés:** az Atlasz térképének elrendezését élő, d3-force-egyenértékű erő-szimuláció adja (középre húzás, taszítás, rugó, ütközés). Saját implementáció, könyvtár nélkül, determinisztikus kezdőállapottal. A csomópontok húzhatók; hoverre kiemelődnek a szomszédok, a többi halványul; a címkék zoomfüggően jelennek meg; az erők egy beállításpanelen hangolhatók. A paraméterek az Obsidian gráfnézetének elemzéséből jönnek (`Prototypes/atlasz-obsidian-graf-elemzes.md`).
**Részdöntések:**
- A klaszterezettséget kizárólag az élek adják, kategória-vonzás erő nincs (tiszta Obsidian-erők).
- A csomópont-méret egységes marad.
- A fókusz helyben marad: a kiválasztott dokumentum állítható mélységű (BFS) környezete kiemelt, a többi halvány, nem tűnik el.
**Felülírja:** a `taltos-home-handoff.md` §9 Tier 0 előírását („klaszterezett, nem force-directed”) és a `graphModel.js` zárt formulás klaszter-elrendezését.
**Kimondott ár:** a „konstrukció szerint nincs átfedés” garancia „nyugalomban nincs átfedés” garanciára gyengül. Egy korábbi erő-szimulációs változat 50+ dokumentumnál klaszter nélküli gubancot adott; ezt a kockázatot vállaljuk, a hangolás a panelen történik. A csomópont-húzás csak elrendezés-finomítás: a térkép minden funkciója húzás nélkül is elérhető (WCAG 2.5.7).
**Scope (D21):** a prototípusra (`Prototypes/tudasbazis-prototype/home/`) vonatkozik; a React SPA-ba (D23) átvételhez külön naplópont kell.

### D29 — Valós idejű közös szerkesztés: Yjs + Hocuspocus + CodeMirror 6 *(új, 2026-10-19 — kiváltja D7-et; **10. verzió:** a „publikált dokumentum szerkesztése” bekezdést a D45 váltja; a szerkesztés a Piszkozat állapotban folyik)*

**Alternatívák:** a lock + heartbeat megtartása (D7) „lock átvételével"; OT (ShareDB); Automerge; SaaS-szinkron (Liveblocks, Tiptap Cloud); WYSIWYG szerkesztő (Tiptap/Milkdown).
**Döntés:** a dokumentumot többen szerkeszthetik egyszerre, Google Docs-szerűen, névcímkés távoli kurzorokkal. CRDT-modell **Yjs**-szel; szerver a **Hocuspocus**, amely a Fastify-jal közös Node-folyamatban fut, `/collab` WebSocket-útvonalon (egy deploy-egység marad); szerkesztő a **CodeMirror 6 + `y-codemirror.next`** (a `@uiw/react-md-editor` cseréje, lásd D16); jelenlét az **Awareness**-protokollal; offline piszkozat `y-indexeddb`-vel (kiváltja a D7 kliensoldali piszkozatát).
**Mentés két szintje:** (1) folyamatos perzisztálás kb. 2 mp-es debounce-szal egy tranzakcióban (`document_collab_state` + materializált `documents.content`, így a generált `search_vector` (D4) magától frissül), revízió nélkül; (2) revízió-checkpoint (`document_revisions` + `edited` esemény a résztvevők `contributors` listájával) kézi „Verzió mentése", az utolsó szerkesztő kilépése vagy 10 perc tétlenség után.
**Publikált dokumentum szerkesztése (V6–V7):** egy `publikált` dokumentumon az írási joggal rendelkező kapcsolat első update-je után a szerver ugyanabban a tranzakcióban `draft`-ra állítja a státuszt (`status_changed`, ok: `edited_while_published`). Munkapéldány nincs; az olvasók az élő tartalmat látják draft jelvénnyel, a dokumentum kikerül a „publikált" szűrőből és a D38 MCP-elérésből.
**Biztonság:** a WebSocket-upgrade a meglévő session-cookie-t használja (D26); `onAuthenticate` ellenőrzi a sessiont, az allowlistet (D5) és a színtér-szerepet (D31); kötelező `Origin`-ellenőrzés (CSWSH ellen); írási jog nélkül `readOnly` kapcsolat; a felhasználó nevét és színét az Awareness-állapotba a szerver tölti. A `rehype-sanitize` (D16) változatlanul minden renderelésnél fut.
**Érvényben marad:** D2 (minden írás a backenden át, csak a csatorna WebSocket), D11 (self-hosted, nincs SaaS), D22 (nincs Redis egy példánynál).
**Vállalt ár:** WebSocket-infrastruktúra (reverse proxy, idle timeout); a Yjs-állapot mérete a tombstone-ok miatt nő (GC + időszakos tömörítés); szerkesztőcsere. Ütemezés: K0–K8 munkacsomagok, lásd [[Kollaboráció/Valós idejű közös szerkesztés]].

### D30 — Színterek: csapat- és projekt-terek, nyitott olvasással *(új, 2026-10-19; **10. verzió: a nyitott olvasás felülírva: D44**)*

**Döntés:** a tudás színterekben (`spaces`) él; a színtér `type` mezője szerint **csapat-munkatér** (tartós) vagy **projekt-tér** (lezárható). Beépített alapszíntér: **Általános**.
- **Olvasás mindig nyitott:** minden színtér tartalmát minden belépett felhasználó látja, keresi és az Atlaszon is megjelenik; a színtér csak írási és jóváhagyási határ (a D6 olvasási elve megmarad). Zárt színtér nincs.
- **Egy dokumentum = egy színtér** (`documents.space_id`), a jogosultság onnan jön.
- **Nincs áthelyezés (V26):** másik színtérbe csak duplikálással (D17, `származik` kapcsolat) kerülhet a tartalom; az eredeti szükség szerint archiválható.
- **Atlasz (V25):** egy közös térkép; alapból az aktuális színtér kiemelve, a többi halvány; a színtér facetként szűrhető. A színtér nem befolyásolja a helyet (D28).
- Események: `space_created`, `space_closed`, `member_added`, `member_removed`, `role_changed`.

### D31 — Jogosultságok: színterenkénti szerepkörök, kötelező gazda *(új, 2026-10-19 — felülírja D6 írási oldalát; **10. verzió: a szerepkörök felülírva: D43** — a kötelező gazda, a négy szem elve és az allowlist-védelem marad)*

**Döntés:** a jogosultság egysége a színtér (D30). Szerepek: **Olvasó** (minden belépett felhasználó minden színtérben), **Szerző** (létrehoz, szerkeszt), **Jóváhagyó** (+ `review → publikált`), **Színtérgazda** (+ tagság, archívum); globálisan csak az **Admin** (allowlist). Ellenőrzés a backendben (middleware), a felület csak elrejt.
- **Négy szem elve:** saját dokumentumot nem lehet saját magának jóváhagyni.
- **Kötelező gazda (V12):** minden dokumentumnak pontosan egy tulajdonosa van a színtér szerkesztői közül; tulajdonos nélküli dokumentum nem létezhet. Tulajdonosváltás csak másik szerkesztőre (`owner_changed`).
- **Allowlist-védelem (V12):** felhasználó nem törölhető az allowlistről, amíg dokumentum tulajdonosa (409 `owner_handover_required`); az allowlist nem csökkenhet nullára, legalább egy Admin marad (409 `last_admin`).
- A komment-szabály (D20) változatlan.
**Egyetlen kivétel az írási határ alól (D39, V50):** a dokumentum tulajdonosa a rá mutató `helyettesíti` kapcsolatot más színtérben is törölheti (rendszer-revízió a forráson).
**Mit ír felül:** a D6 „mindenki mindent tehet" elvét az írási oldalon; az olvasási nyitottság és a teljes írási audit megmarad.

### D32 — Státusz-workflow jóváhagyással *(új, 2026-10-19 — felülírja D6 „soft workflow" elvét; **10. verzió: felülírva: D45**)*

**Döntés:** a `review → publikált` váltás a színtér Jóváhagyójához kötött (D31, négy szem elve). Az első szerkesztés egy publikált dokumentumon visszaviszi `draft`-ba (D29, V6). **Elutasítás kötelező indoklással (V22):** a `review → draft` elutasítás csak indoklással menthető; az indoklás a `status_changed` esemény JSONB részleteiben tárolódik, kiemelt rendszerüzenetként jelenik meg a kommentfolyamban, és a tulajdonos értesítést kap (D35).

### D33 — Felülvizsgálat: kötelező esedékesség és értesítés *(új, 2026-10-19; **10. verzió:** „publikáláskor” = a Jóváhagyott állapotba kerüléskor; a „Még aktuális” bármely színtér-tag joga, review nélkül (D45); komment nem zárja le (D49))*

**Probléma:** a versenytárs-elemzés (Confluence) legnagyobb azonosított gyengesége a tartalom észrevétlen elavulása.
**Döntés (V2–V4, V8–V11):**
- Publikáláskor a szerző **kötelezően** megad egy felülvizsgálati esedékességet (`documents.review_due_at`), **alapértéke 12 hónap**.
- Címzettek: a **tulajdonos és az utolsó publikált revízió közreműködői**; csatorna: alkalmazáson belül + e-mail (D35).
- Időzítés: **7 nappal előtte és esedékességkor**; utána **heti emlékeztető**, a „Felülvizsgálandó" jelvény megmarad. Eszkaláció és automatikus visszaminősítés nincs; címzett nélküli dokumentum a D31 kötelező gazdája miatt nem fordulhat elő.
- Lezárás: „Még aktuális" (új esedékesség, revízió nélkül, `review_confirmed`; bárki, akinek Szerző joga van a színtérben, jóváhagyás nélkül), vagy szerkesztés → `draft` → újrapublikálás új esedékességgel.
- Ütemezés: a D22 szerinti cron-alapú feladat, naponta.

### D34 — Címkék és fajta *(új, 2026-10-19 — felülírja D19-et)*

**Döntés:**
- A **kategória** fogalma megszűnik, helyette **címke** (`tags`, `document_tags`). A készlet **globális**, minden színtér osztozik rajta (V23). Típusos metaadat nincs (V5).
- **Nincs külön létrehozó felület (V24):** a címke a dokumentum létrehozásakor vagy szerkesztésekor adható meg, listából vagy szabad kézzel. Szabad kézi megadásnál a normalizált (kisbetűs, ékezet nélküli, szóköz-normalizált) pontos egyezést a rendszer automatikusan a meglévő címkére cseréli; `pg_trgm`-hasonlóság ≥ 0,4 esetén legfeljebb 3 meglévő címkét ajánl fel (V34). Új címke csak a felajánlás elutasítása után jön létre (`tag_created`).
- **Utólagos összevonás, átnevezés nincs (V29);** az árva címkék rejtve maradnak, a rekord megmarad (V30). A D19 „használatban lévő kategória védett" szabálya tárgytalan.
- **Fajta (V27):** a dokumentum fajtája (prompt, skill, agent-definíció, MCP-szerver …) külön, kötelező, egyértékű `documents.kind` mező rögzített listából (Admin bővítheti).
- **Seed-migráció (V33):** a kilenc korábbi kategória `kind` érték lesz; a seed dokumentumonként 1–3 generált témacímkét kap.

### D35 — Értesítések, @említés és a kommentfolyam *(új, 2026-10-19; **10. verzió: módosítva: D46** — WebSocket polling helyett, napi összefoglaló, dashboard; @említés csak a színtér tagjai közül, D44)*

**Döntés:** az értesítés az eseménynaplóból származik (ugyanabban a tranzakcióban `notifications` sor), MVP-ben **alkalmazáson belül (polling) + e-mail** (ütemezett összefoglaló; a jóváhagyási kérés azonnali). Követés (`subscriptions`) a kedvenctől (D18) független.
- **@említés (V16, V21):** bárki említhető az allowlistről; tárolás `@[név](user:uuid)` formában; az említett értesítést kap. Komment szerkesztésekor minden említett újra értesítést kap (V20), de ugyanarról a kommentről egy említett **10 percen belül legfeljebb egyet** (V22a).
- **Kommentfolyam:** marad lapos, időrendi; válaszszálak (V17) és „Megoldott" lezárás (V18) nincs. Szövegrészhez kötött komment: második ütem, a D29 után (V19).

### D36 — Keresés: rangsor és duplikátum-figyelmeztetés *(új, 2026-10-19 — kiegészíti D4-et; **10. verzió:** duplikátum-figyelmeztetés csak cím alapján, keresés csak a saját színterekben: D44, D49)*

**Döntés:** a rangsor **szöveges relevancia** (`ts_rank` + trigram) **és frissesség** (utolsó revízió vagy `review_confirmed`, enyhe időbeli lecsengéssel); a státusz nem rangsorol, arra szűrni lehet (V14). A kommentek nem kereshetők, a `search_vector` változatlan (V15). Létrehozáskor és az első mentéskor a cím és a tartalom `pg_trgm`-hasonlósága alapján legfeljebb 5 hasonló dokumentumot ajánlunk fel; nem tilt (V13).

### D37 — Élő Atlasz színezése a színtérből *(új, 2026-10-19 — módosítja D28-at)*

**Döntés:** a csomópont színe a **színtér** színe (`spaces.color`, a Design System palettájából; több színtérnél az alapszínek ismétlődhetnek, V32). Minden felhasználó saját magának átszínezheti (`user_space_colors`, privát, nem naplózott); szabad színválasztó kontraszt-figyelmeztetéssel (WCAG 1.4.11, 3:1 világos és sötét háttérrel szemben — V52), amely nem tilt (V31). **Nincs színátmenet** (V28): egy dokumentum egy színtérhez tartozik. A címkék és a fajta szűrőként kiemelnek („kiemel, nem töröl").

### D38 — MCP- és API-elérés AI-asszisztenseknek *(új, 2026-10-19 — második ütem; **10. verzió:** „publikált” = a Jóváhagyott revízió (`approved_revision_id`, D45); csak a felhasználó színterei (D44); REST az alap (D49))*

**Döntés (V1):** az AI-asszisztensek (Claude, Copilot) csak olvasási MCP-elérést kapnak a **publikált** dokumentumokhoz (`search_documents`, `get_document`, `list_tags`). Most terv; megvalósítás a második ütemben. Nyitott: felhasználóhoz kötött hozzáférési token (új hitelesítési út a D26 mellett), az MCP-olvasás naplózása (D18-cal ütközik).

### D39 — Kapcsolatok: explicit, típusos dokumentum-kapcsolatok *(új, 2026-10-19 — az NY7 lezárásaként; **10. verzió:** kapcsolat csak olyan színtér dokumentumára, amelynek a felhasználó tagja; idegen cél csonkként (D44))*

**Döntés:** irányított kapcsolatok a `document_links` táblában (`from_id`, `to_id`, `type`, `created_by`, `created_at`, `deleted_at`), négy típussal:
- `hivatkozik` — automatikus, a tartalomból kinyerve: a szövegben `[cím](doc:uuid)` (átnevezésbiztos), kinyerés mentéskor, ugyanabban a tranzakcióban. **Beszúrás nem szintaxissal, hanem a D40 helyi menüjéből** (V41; a V37 `[[`-szintaxisa elvetve): cél dokumentumkeresőből, típus listából; a kijelölt szöveg linkké válik, a kapcsolat a típusával a Tulajdonságok panelen jelenik meg (V43).
- **Frontmatter (V42):** a kapcsolatok és típusuk a Tulajdonságok panelen láthatók és szerkeszthetők, és frontmatterként kerülnek az `.md`-letöltésbe, az exportba és az MCP-be (D38). Az igazság a `document_links` tábla; a 4. fejezet „a frontmatter kimeneti formátum” elve érvényben marad.
- `származik` — automatikus, duplikálásból és sablonból (D17; a színterek közötti átvitel egyetlen útja, D30).
- `épít_rá` és `helyettesíti` — kézi, kapcsolat-szerkesztővel a dokumentumnézetben. Hozzáadás: a **forrás színterében Szerző jog** elég (V35).
- `helyettesíti` a célt „elavult" jelzéssel látja el a listában és az Atlaszon; a cél tulajdonosa beleegyezés helyett **értesítést kap**, és a kapcsolatot törölheti (V36, D35).
- **Link és kapcsolat egy egység (V48):** ha a link eltűnik a szövegből, a kapcsolat is megszűnik, típustól függetlenül; a panelen törölt kapcsolat a szövegbeli linket is eltávolítja. A Tulajdonságok panelen felvett kapcsolat a dokumentum végi „Kapcsolódó dokumentumok” szakaszba kerül linkként (V49).
- **A cél tulajdonosának joga (V50):** a rá mutató `helyettesíti` kapcsolatot törölheti; ez rendszer által írt revízió a forráson (`link_removed_by_target`, értesítés a forrás tulajdonosának) — **egyetlen kifejezett kivétel a D31 színtér-írási határa alól.** A publikált forrás ettől nem esik `draft`-ba (V53, szűk kivétel a D29/V6 alól).
- **Linkenként egy kapcsolat (V54):** több link ugyanarra a célra külön kapcsolat a saját típusával; a panel célonként csoportosít, az Atlaszon célonként egy él.
- **Archivált cél (V51):** a link halvány, „archivált” jelöléssel; az Atlaszon az él nem látszik.
- Kapcsolat átléphet színterek között; a cél a nyitott olvasás (D30) miatt mindig látható. „Visszahivatkozások" panel a dokumentumnézetben. Események: `link_added`, `link_removed`.
- **Atlasz (V39):** minden explicit kapcsolat egységes erejű rugó az erőszimulációban (D28); a típust a vonalstílus jelzi; a közös címke halvány él.
**Ütemezés (V38):** MVP-levélcsomag, a kiesési sorrendben az e-mail után.

### D40 — Szerkesztési élmény markdown-tudás nélkül: élő előnézet, helyi menü, Tulajdonság-panel *(új, 2026-10-19 — módosítja D16-ot és D29-et)*

**Cél:** a felhasználóknak ne kelljen markdown-szintaxist tanulniuk.
**Alternatívák:** valódi WYSIWYG (Tiptap/Milkdown + `y-prosemirror`) — elvetve, mert a markdown-forrás pontos megőrzése nehezebb, és újranyitná a D29 szerkesztőválasztását; osztott nézet + helyi menü — elvetve, mert a szintaxis látható marad.
**Döntés:**
- **CodeMirror 6 élő előnézettel (V40)**, az Obsidian modellje szerint: a forrás markdown marad (a D29 Yjs-kötése, a D21 diff, a D4 keresés és az export változatlan), a jelölők rejtve vannak, a formázás azonnal látszik. Az osztott nézet megszűnik.
- **Helyi menü jobb kattintásra (V41)** minden formázási és beszúrási lehetőséggel (formázás, bekezdéstípusok, listák, táblázat, külső link, dokumentum-kapcsolat típussal, @említés, assets-kép); billentyűparancsokkal és billentyűzetről is elérhető.
- **Tulajdonság-panel (V42):** fajta, címkék, színtér, tulajdonos, esedékesség és kapcsolatok a dokumentum tetején; frontmatterként csak kimenetben jelenik meg, az igazság a DB.
- **Forrásnézet-kapcsoló (V44)** haladóknak; alapértelmezés az élő nézet.
- **Táblázat (V45):** cellánkénti helybeni szerkesztés; **lebegő formázósáv kijelöléskor (V46)**; érintőképernyőn hosszú nyomás + formázósáv (V47).
- A `rehype-sanitize` és a képforrás-korlát (D16) az élő nézet renderelésére is vonatkozik.
**Vállalt ár:** az élő előnézet saját CodeMirror-dekorációkat igényel (rejtett jelölők, táblázat-, lista- és linkmegjelenítés) — ez a szerkesztőcsere (D29, K3) legmunkaigényesebb része, és a K0-spike-nak is érintenie kell.

### D41 — Értékelési módszertan: pilot a jelenlegi gyakorlathoz viszonyítva *(új, 2026-10-19; **10. verzió:** a jelenlegi eszköz és a hozzáférés nyitott: NY8, NY9)*

**Döntés (V55–V60):** a Táltost a szervezet jelenlegi megoldásához (**Confluence vagy SharePoint**) viszonyítjuk, résztvevőn belüli, kiegyensúlyozott sorrendű összehasonlítással. **8–12 résztvevő legalább 3 csapatból**, vegyesen fejlesztők és nem fejlesztők. Forma: 45 perces moderált feladat-session (T1–T8) mindkét eszközben, majd **2 hetes használat** a Táltosban naplóadatokkal, a végén SUS és interjú. Mérőszámok: **megtalálási idő és siker, dokumentumkészítés ideje és hibái, SUS, adminisztrációs ráfordítás.** Környezet: **fejlesztői környezet, dummy korpusz** (D11), ugyanaz a korpusz a jelenlegi megoldás teszt-terében is. Kiértékelés: **csak leíró**, előre rögzített célértékek nélkül.
**Vállalt ár:** a dummy tartalom és a fejlesztői környezet miatt a 2 hetes szakasz mesterséges; a kis minta miatt következtetéses statisztika nincs. Részletek: [[Értékelés/Pilot-terv]].

### D42 — Többformátumú tartalom: tartalom-címzett blobok Postgresben, formátumonkénti kezelő-registry *(új, 2026-10-23 — felülírja a D15 csatolmány-tilalmát; második ütem)*

**Probléma:** a tudásanyag egy része nem markdown: generált HTML-riportok, `.skill` csomagok (ZIP: `SKILL.md` + szkriptek), PDF, Excel. Ezek verziózása és diffje a D15 alapján eddig nem volt cél.
**Döntés:** a rendszer ezeket is tárolja és verziózza; **megvalósítás a második ütemben**, az adatmodell már most így készül.
- **Tárolás Postgresben (a D1 egy igazságforrás elve marad):** `blobs` (SHA-256 → `bytea`, `STORAGE EXTERNAL`, deduplikáció), `revision_files (revision_id, path, blob_sha256)` fájllista, `blob_derivatives` (kinyert szöveg, cellák, oldalképek; újragenerálható). **Korlát: 25 MB fájlonként**, a `.skill` csomag kibontva is. Object storage (MinIO) csak akkor, ha a pilot indokolja.
- `documents.format` (`markdown`, `html_report`, `skill_bundle`, `pdf`, `xlsx`, `md_file`) a `kind` (D34) mellett külön tengely.
- **A `.skill` csomag kibontva tárolódik** (fájlfa); a csomagon belüli `.md` és `.py` fájlok **egyszemélyes CodeMirror-szerkesztővel** módosíthatók (közös szerkesztés nélkül); a mentés piszkozat-revízió, és a D45 review-ján megy át. Letöltéskor a ZIP újra összeáll. Ellenőrzés: zip slip, zip bomb, kötelező `SKILL.md`.
- **HTML-riport:** csak a generált kimenet tárolódik (a generáló forrás nem). Megjelenítés külön originről, `<iframe sandbox="allow-scripts">`-ben, `allow-same-origin` nélkül, szigorú CSP-vel. Diff: normalizált HTML szövegdiff + képernyőkép-alapú vizuális diff.
- **PDF:** oldalankénti szövegdiff, pdf.js-megjelenítés. **Excel:** cellaszintű diff (sorillesztés később).
- **Export (D21):** nem markdown formátumnál az eredeti fájl letöltése. **MCP (D38):** a kinyert szöveg + letöltési link az eredetihez.
- A kinyerés a mentéssel azonos tranzakcióban fut (D22: nincs worker queue); a `search_vector` a `documents.search_text`-re is kiterjed (D4).
- Részletek: [[Adattárolás/Többformátumú tartalom és verziókövetés]].
**Mit ír felül:** a D15 „képfeltöltés és csatolmány-kezelés nem funkció” mondatát a fenti formátumokra. A statikus képek (assets) kezelése változatlan.
**Vállalt ár:** nagyobb adatbázis és `pg_dump`; formátumonkénti kinyerő- és diff-kód; a HTML-riportok izolálása külön originnel.

### D43 — Szerepkörök: Rendszeradminisztrátor, Színtérgazda, Szerző *(új, 2026-10-23 — felülírja a D31 szerepkör-részét)*

**Döntés:**
- **Globálisan** egy adminisztratív szerep van: a **Rendszeradminisztrátor** (a korábbi Admin összevont utódja): allowlist, színterek létrehozása és lezárása, a kezdeti Színtérgazda kijelölése, fajta-lista (D34), rendszerszintű audit. **Tartalmi joga nincs**: tartalmat csak akkor lát és szerkeszt, ha az adott színtérnek tagja. **Saját magát bármely színtérbe felveheti** további feltétel nélkül; ez eseményként naplózódik (`member_added`, `self_assigned`).
- **Színtéren belül két szerep:** **Szerző** (olvas, szerkeszt, változást indítványoz, review-er lehet) és **Színtérgazda** (+ tagok felvétele és eltávolítása, előléptetés Színtérgazdává, visszaminősítés, színtér leírása és színe). A korábbi Olvasó és Jóváhagyó szerep megszűnik.
- **Delegált tagság:** a kezdeti Színtérgazdát a Rendszeradminisztrátor jelöli ki, utána a Színtérgazda kezeli a tagságot. A Rendszeradminisztrátor bármikor felülírhat. *(Az első Rendszeradminisztrátor és az Általános színtér kezdő Színtérgazdája: D52.)*
- **Projekt-tér kérése:** bármely felhasználó kérheti (név, cél, javasolt Színtérgazda); a Rendszeradminisztrátor hagyja jóvá és hozza létre (a kérés a dashboardján jelenik meg, D46).
- **Az Általános színtérben minden allowlistre felvett felhasználó automatikusan Szerző.** Színtérgazdáját a Rendszeradminisztrátor jelöli ki.
- **A Tulajdonos megmarad** (D31 kötelező gazda, D33 címzett): felelősséget jelent, jogot nem.
- **Védelmek:** legalább egy Rendszeradminisztrátor (409 `last_admin`); minden színtérben legalább egy Színtérgazda (409 `last_space_manager`); utolsó Színtérgazda és dokumentum-tulajdonos nem törölhető az allowlistről; egy színtérben a review-hoz legalább három tag kell (409 `not_enough_reviewers`).
- **Ellenőrzés:** egyetlen backendoldali policy-függvény (`can(user, action, resource)`) a REST middleware-ben (D26) és a Hocuspocus `onAuthenticate`-ben (D29); a jogosultsági mátrix minden cellája táblavezérelt teszteset.
- **Entra ID csoport-claimek** (automatikus belépés vagy tagság): jövőbeli munka.
- Adatmodell: `users.is_admin` → `users.system_role`; `space_members.role ∈ {author, space_manager}`; `space_requests`, `membership_requests`.
Részletek és jogosultsági mátrix: [[Felhasználók/Szerepkörök]].

### D44 — Zárt színterek *(új, 2026-10-23 — felülírja a D30 nyitott olvasását)*

**Döntés:** a színtér tartalmát **csak a tagjai látják**. Minden olvasó út a tagságra szűr: lista, keresés (D4, D36), Atlasz (D28), kapcsolatok és visszahivatkozások (D39), értesítések (D35), export, MCP (D38). A szűrés egyetlen „látható dokumentumok” lekérdezés-építőben él (Postgres RLS mérlegelendő), és minden olvasó végpontra van teszt.
- **Idegen színtérbe mutató link:** a link szövege megmarad, a cél címe rejtve; kattintásra „Ez a dokumentum egy olyan színtérben van, amelynek nem vagy tagja” üzenet, a színtér Színtérgazdáival és **„Felvétel kérése”** gombbal. A kérés a Színtérgazdák dashboardján jelenik meg (D46). Az Atlaszon ilyen él nincs.
- **Kapcsolat csak olyan színtér dokumentumára hozható létre, amelynek a felhasználó tagja** (a V35 „a célszíntérben nem kell jog” úgy módosul: tagság kell, írási jog nem); a dokumentumkereső eleve csak a saját színtereket mutatja.
- **Duplikálás (V26):** bármely színtérbe, amelynek a felhasználó tagja; a másolat Piszkozatként indul, és a célszíntér review-ján megy át (D45).
- **Lezárt projekt-tér:** a dokumentumok és a tagság megmarad, minden csak olvasható.
- **Sablonok (D47):** a Jóváhagyott sablonok minden felhasználónak felkínálhatók — az egyetlen kivétel a zártság alól.
- **Atlasz:** alapból az aktuális színtér Jóváhagyott dokumentumai; a felhasználó további színterei facetként bekapcsolhatók (a V25 „a többi halványan látszik” módosul); 300 csomópont fölött a kevés kapcsolatú csomópontok címkefürtbe vonódnak.
**Mit ír felül:** a D30 „olvasás mindig nyitott” elvét, a D6 olvasási nyitottságát és a D39 „a cél a nyitott olvasás miatt mindig látható” mondatát.
**Vállalt ár:** a láthatósági szűrés minden olvasó úton kötelező — egy kifelejtett végpont adatszivárgás. A közös tudás csak az Általános színtérben marad mindenkinek elérhető.

### D45 — Review-folyamat két review-errel *(új, 2026-10-23 — felülírja a D32-t és a D29 V6–V7 szabályát)*

**Döntés:** minden tartalmi változás — új dokumentum vagy feltöltés, tartalommódosítás, metaadat-frissítés, visszaállítás régi verzióra, bármilyen törlés — csak **két megjelölt review-er jóváhagyásával** válik véglegessé.
- **Állapotok:** **Piszkozat** (közös szerkesztés, D29) → **Review-ra vár** (beküldve, tartalom befagyva) → **Jóváhagyott** (mindkét review-er jóváhagyta) vagy **Átdolgozandó** (legalább egy elutasította). A korábbi `draft`, `review`, `tesztelt`, `publikált` státusz megszűnik.
- **Review-erek:** a beküldő (indítványozó) jelöl meg két különböző színtér-tagot, saját magán kívül. A piszkozat közreműködői lehetnek review-erek.
- **Elutasítás** csak indoklással; az indoklás kommentként jelenik meg az eseményfolyamban, és a másik függő döntés megszűnik.
- **Elakadt review:** az indítványozó vagy a Színtérgazda kicserélheti a review-ert; helyette dönteni senki nem dönthet. Emlékeztető a napi összefoglalóban (D46).
- Dokumentumonként **egyszerre egy függő kérés**; Review-ra várás alatt a tartalom csak visszavonás után módosítható. A soha be nem küldött piszkozat review nélkül eldobható.
- **Az alapnézet a legutóbbi változatot mutatja** (a függőt is), állapotjelvénnyel; a legutóbbi Jóváhagyott állapot a Verziók fülön érhető el. Az MCP (D38) és az export csak a Jóváhagyott revíziót adja (`documents.approved_revision_id`).
- **Nem megy át review-n:** kommentek (D20), kedvencek, követés, tagság- és szerepkezelés, és a **„Még aktuális” megerősítés** (D33, mert a tartalom nem változik).
- **Verziószám:** az `iteration` a Jóváhagyott változások száma (v1, v2 …). A változásleírás mindig opcionális. Diff: soronkénti, a módosult sorokon belül szószintű kiemeléssel (D21).
- **Adatmodell:** `change_requests (document_id, kind, base_revision_id, proposed_revision_id, initiator_id, state)` részleges egyedi indexszel a függő kérésre; `change_request_reviewers (reviewer_id, decision, reason)`. A döntés, a kérés lezárása és a `documents` frissítése egy tranzakció (`SELECT … FOR UPDATE`).
- **Események:** `review_requested`, `review_approved`, `review_rejected`, `review_withdrawn`, `reviewer_replaced`, `change_approved`, `change_rejected`.
Részletek: [[Dokumentumok/Státusz-workflow]].
**Mit ír felül:** a D32 Jóváhagyó-szerepét és a D6 „nem kikényszerített workflow” elvét; a D29 „publikált dokumentum szerkesztése draftba viszi” szabályát (V6–V7) és a V53 kivételt (a `helyettesíti` kapcsolat cél általi törlése is változás, de rendszer-revízióként review nélkül marad, mint eddig).
**Vállalt ár:** jelentős review-terhelés (minden apró javítás két embert vesz igénybe); kis színtér nem működik három tag alatt.

### D46 — Személyes feladat-dashboard és értesítési csatornák *(új, 2026-10-23 — módosítja a D35-öt; MVP)*

**Döntés:**
- **Belépés után a főoldal a személyes dashboard** (az Atlasz egy kattintásra): rám váró review-k, saját függő indítványaim, Átdolgozandó anyagaim, esedékes felülvizsgálatok (a hozzájuk írt kommentekkel kiemelve), @említések; Színtérgazdáknak a felvételi kérések; Rendszeradminisztrátornak a színtér-kérések. Forrása az értesítési réteg (D35).
- **Csatorna:** alkalmazáson belül **WebSocket** (a `/collab` mellett egy értesítési csatorna; a D35 polling helyett). E-mail: azonnali a review-kérés, minden emlékeztető (felülvizsgálat, elakadt review) **napi összefoglalóba** vonva.
- **E-mail-küldés:** SMTP-absztrakció (Nodemailer); fejlesztésben Mailpit-mock (D11), élesben céges SMTP-relay; Microsoft Graph-adapter jövőbeli munka. **Levéltörzs:** eseménytípus, cím, színtér, kezdeményező és link; tartalom nem.

### D47 — Létrehozási utak: üres és duplikálás MVP, sablon és fájlimport hátrasorolva *(új, 2026-10-23 — módosítja a D17-et)*

**Döntés:** új markdown dokumentum négy úton jöhet létre:
- **Üres** és **duplikálás** — MVP (3. pont).
- **Létrehozás sablonból** — hátrasorolva (második ütem). Sablonként jelölés (`is_template`) metaadat-változás, ezért két review-er hagyja jóvá (D45); a Jóváhagyott sablonok globálisan használhatók (D44 kivétel).
- **Létrehozás forrásból = fájlimport** — hátrasorolva (második ütem). Egyenként egy `.txt`, `.md` vagy `.docx` fájl; szerveroldali pandoc (`-t gfm`), előnézet mentés előtt, `rehype-sanitize`; a `.docx` képei kimaradnak (D15). Az eredeti fájl nem tárolódik, az `imported_from` esemény rögzíti a nevét. Tömeges import: jövőbeli munka.
**Fogalomváltás:** a D17 „létrehozás forrásból” gyűjtőneve megszűnik; „forrásból” ettől kezdve csak a fájlimportot jelenti. A D17 megvalósítási egyesítése (új UUID, első revízió, `származik` kapcsolat) a duplikálásra és a sablonból létrehozásra érvényes; a státusz Piszkozat (D45).

### D48 — Adatmegőrzés és mentés *(új, 2026-10-23 — lezárja az NY4-et)*

**Döntés — „a tudás megmarad, a zaj törlődik”:**

| Adat | Végleges törlés |
|---|---|
| Dokumentum, Jóváhagyott revízió | nincs automatikus törlés |
| Archivált dokumentum | 2 év után |
| Törölt komment | 90 nap után |
| Értesítés | 90 nap után |
| Elutasított vagy visszavont kérés piszkozat-revíziói, hivatkozás nélküli blobok (D42) | 1 év után |
| Eseménynapló | 5 év után |

- **Kilépő munkavállaló:** a neve a revíziókban és eseményekben a retenciós ideig marad (jogos érdek), utána pszeudonimizálva („Volt munkatárs #id”); a tulajdonjogot kilépéskor kötelező átadni.
- **Végleges törlés:** automatikus, a D22 szerinti cron-feladat a policy szerint; a Rendszeradminisztrátor előtte heti listát kap, és egy tételt visszatarthat (legal hold).
- **Backup (D4 kiegészítése):** napi `pg_dump`, 30 napos és 12 havi megőrzés, külön gépen vagy tárolón titkosítva, havi visszaállítási próba. A véglegesen törölt adat a mentésekből a megőrzési idő lejártával tűnik el.

### D49 — Kisebb döntések a 2026-10-23-i átvizsgálásból *(új)*

- **Keresés (D4, D36):** a `search_vector` a címkéket és a fajtát kis súllyal tartalmazza, a szerzőnevet nem (arra facet van). Szemantikus keresés (pgvector): jövőbeli munka, a pilot méri a `pg_trgm` elégségét. **Duplikátum-figyelmeztetés (V13): csak a cím alapján**, a felhasználó színterein belül.
- **Szűrők:** a „Csapat” facet helyett Színtér facet (csak a saját színterek); a szűrők az URL-ben élnek; mentett nézetek: második ütem.
- **Kedvenc és követés** külön fogalom (D18, D35). **Vágólap:** alapból frontmatter nélkül (csak a szöveg), második opcióként frontmatterrel.
- **Közös szerkesztés (D29):** a szerzőséghez elég a checkpointonkénti résztvevőlista; „Kövesd X-et” nincs (második ütem); a jelenlét-sorban minden, a dokumentumot néző tag látszik.
- **Bejelentkezés (D5):** OIDC-mock nincs; fejlesztésben is valódi Google OIDC, a tesztekben session-injektálás.
- **MCP és API (D38):** a dokumentált `/api/v1` REST az alap, az MCP-szerver vékony réteg fölötte (egy jogosultsági pont). **Export (D21):** a `.docx` egy Táltos-arculatú `reference.docx` sablont használ ([[Branding]]).
- **Allowlist (NY3 lezárva):** MVP-ben konfigurációból; második ütemben Rendszeradminisztrátor-felület „inaktív tulajdonosok” listával.
- **Felülvizsgálat (D33):** egy hibát jelző komment nem zárja le az esedékességet; csak a „Még aktuális” vagy egy Jóváhagyott módosítás.
- **Munkamenet (NY10, D26):** abszolút lejárat 8 óra, tétlenségi kiléptetés 60 perc; a WebSocket-forgalom aktivitásnak számít.
- **Dashboard (D46):** egy review 3 munkanap után számít elakadtnak (kiemelés, napi összefoglaló); a blokkok időrendben, színtér-szűrővel.
- **Vészhelyzeti tükör (NY5): elvetve.** A backup elég; az elveszett vészhelyzeti olvashatóság vállalt korlát marad.

### D50 — Reverse proxy és fejlesztői eszközlánc (WP0) *(új, 2026-10-23)*

**Alternatívák:** külön Caddy-konténer automatikus TLS-sel; csak Vite dev-proxy, az éles proxy döntése később.
**Döntés:**
- **Reverse proxy: nginx a frontend-konténerben.** Ugyanaz az nginx szolgálja ki a buildelt SPA-t, és proxyzza a backendre a `/api/`, a `/healthz`, a `/collab` és a `/ws/notifications` útvonalat, az utóbbi kettőt WebSocket-upgrade-del és 1 órás idle timeouttal (D29, D46). Fejlesztésben ugyanezt a Vite dev-proxy végzi. Az alkalmazásszintű statikus képek (D15) az `assets` volume-ról a `/static/` útvonalon jelennek meg.
- **Eszközlánc:** Node.js 24 LTS; pnpm a corepackon át (a verzió a `packageManager` mezőben); TypeScript 6.0 (a natív 7.x fordítót a typescript-eslint még nem támogatja); ESLint (typescript-eslint, típusinformációval) + Prettier; Vitest (backend, shared; frontend: jsdom + Testing Library). A Hocuspocus 4 egy `@fastify/websocket`-útvonalra kötve fut a Fastify-jal közös HTTP-szerveren.
- **Elhelyezés:** a monorepo a kódrepó `taltos-app/` mappájában él; a CI a gyökér `.github/workflows/` mappájában, `taltos-app` munkakönyvtárral, a Compose-füstpróbával együtt.
- **Compose:** `compose.yaml` (postgres, backend, frontend, assets-volume) + `compose.override.yaml` csak fejlesztésre (Mailpit). A secretek fájlból jönnek (`*_FILE`, D13); a Postgres csak a saját jelszavát kapja.

**Indoklás:** nincs plusz konténer (a WP0 szolgáltatáslistája marad), és a böngésző egyetlen origint lát: a cookie- és CSRF-kezelés egyszerű marad (D26), a WebSocket-upgrade Origin-ellenőrzése (B5 A1) egy engedélyezett originre szűkül.
**Vállalt ár:** TLS-terminálás nincs benne (élesben a céges infrastruktúra adja, vagy később kiegészítendő); az nginx-konfiguráció a frontend-image része, változása frontend-rebuildet kíván.

### D51 — Séma-pontosítások a WP1 előtt *(új, 2026-10-23 — a B4 két független átvizsgálása nyomán; kiegészíti a D26, D29, D33, D45, D48 pontot)*

**Előzmény:** a B4 átvizsgálása tíz olyan pontot talált, amelyet a dokumentumok leírnak, de a séma nem enged, vagy amely sehol nincs rögzítve. A tulajdonos mindegyikben döntött (2026-10-23):

- **(a) Munkamenet-tár (D26, NY10):** Postgres `sessions` tábla (`id`, `user_id`, `created_at`, `last_seen_at`, `expires_at`). A `last_seen_at` írása ritkítva (legfeljebb percenként egyszer), a WebSocket-forgalom is frissíti. Újraindítást túlél; a kijelentkezés és az allowlistről levétel azonnal visszavonja. Nincs új infrastruktúra (D1).
- **(b) Review-er kiesése (D43, D45):** ha egy megjelölt review-er kikerül a színtérből vagy az allowlistről, a sora „megszűnt” jelölést kap, a másik review-er döntése megmarad, az indítványozó új review-ert jelöl; a kérés addig nem dönthető el. Invariáns: beküldéskor pontosan két aktív review-er, később legfeljebb kettő. Új esemény: `reviewer_removed`; a dashboard jelzi a pótlást.
- **(c) Jóváhagyott → Piszkozat:** explicit „Módosítás indítása” lépés (külön végpont) nyit új piszkozatot a legutóbbi Jóváhagyott revízióból; addig a szerkesztő csak olvasható. Az állapotot a `ReviewService` írja, eseményt naplóz (`edit_started`).
- **(d) Rendszeresemények:** az `events.actor_id` nullable, de csak a rendszer-eseménytípusoknál lehet NULL (CHECK); a felület „Rendszer”-ként mutatja. Nincs ál-felhasználó.
- **(e) Piszkozat és Jóváhagyott metaadat (D45):** az alkalmazáson belüli nézetek (lista, keresés, facetek, Atlasz) a legutóbbi (élő) metaadatot mutatják, állapotjelzővel. A Jóváhagyott változat a revízió `metadata`-pillanatképéből jön az export, az MCP, a nyers letöltés és a vágólap számára. Visszaállításkor a pillanatkép egy tranzakcióban íródik vissza az élő táblákba.
- **(f) Felülvizsgálati esedékesség (D33):** a beküldéskor kötelező, 12 hónapra előtöltött `change_requests.proposed_review_due_at`; a két review-er ezzel együtt hagyja jóvá, jóváhagyáskor kerül a `documents.review_due_at`-be. Minden `create`, `update`, `metadata`, `restore` kérés új esedékességet ad; a `delete` és az `unarchive` nem.
- **(g) Archívumból visszahozás:** külön `unarchive` kérésfajta (nincs javasolt revízió; jóváhagyáskor `deleted_at = NULL`, a legutóbbi Jóváhagyott revízió marad érvényes), külön `unarchived` eseménnyel. A `restore` ettől kezdve csak régi revízióra visszaállítást jelent.
- **(h) Retenció és hivatkozások (D48):** az `events` dokumentum-, színtér- és kérés-hivatkozása FK nélküli uuid (mint az S12 többi naplóhivatkozásánál); a törölt dokumentumra mutató esemény „törölt dokumentum”-ként jelenik meg. A lezárt kérés javasolt revíziója törölhető: javasolt revízió csak függő kérésnél kötelező, `delete` és `unarchive` kérésnél mindig üres.
- **(i) Checkpoint-revíziók és eldobott piszkozatok (D48 kiegészítése):** a köztes checkpoint-revízió (se nem Jóváhagyott, se nem függő kérés javaslata) 1 évvel azután törlődik, hogy egy újabb Jóváhagyott revízió meghaladta; a soha be nem küldött, eldobott piszkozat a revízióival együtt 1 évvel az eldobás után. A Jóváhagyott és a függő kérés revíziói soha nem törlődnek automatikusan.
- **(j) Fizikai törlés kivételei (D20):** a privát kapcsoló- és párosítótáblák (`favorites`, `subscriptions`, `user_space_colors`, `document_tags`) sorai fizikailag törölhetők, mert nincs auditértékük (a címkék története a revízió-pillanatképben él). Az alkalmazás DB-szerepe csak ezekre kap DELETE-jogot.

**Indoklás:** a B4 jelenlegi formájában a review-er eltávolítása hibát dobott volna, a Jóváhagyott dokumentum nem lett volna szerkeszthető, a cron-események nem lettek volna naplózhatók, és a második ütemes retenció az FK-k miatt nem lett volna megvalósítható; ezeket utólag, éles adattal drága javítani.
**Vállalt ár:** az `events` hivatkozásait nem védi FK (az alkalmazás és a tesztek felelőssége); egy új tábla (`sessions`) és néhány új mező/enum-érték. A részletek a B4-ben (10. verzió, D51-kiegészítés).

### D52 — Rendszerindítás: az első felhasználó az első Rendszeradminisztrátor és az Általános színtér gazdája *(új, 2026-10-23 — lezárja az NY18 első felét; kiegészíti a D43-at; **módosítva: D54** — csak a `BOOTSTRAP_ADMIN_EMAIL` címmel)*

**Alternatívák:** a konfigurációban megadott e-mail kapja a jogot (pl. `BOOTSTRAP_ADMIN_EMAIL`); kézi SQL-beavatkozás az első telepítés után.
**Döntés (tulajdonos):**
- **Az első Rendszeradminisztrátor a tulajdonos**, a jog a rendszerben **elsőként létrejövő felhasználóhoz** kötődik: aki egy friss telepítés után elsőként lép be sikeresen (OIDC + allowlist, D5), annak a `users` sora `system_role = system_admin` értékkel jön létre.
- **Az Általános színtér kezdő Színtérgazdája ugyanez a felhasználó.** Ha az Általános színtér még nem létezik, ugyanebben a tranzakcióban jön létre, vele mint Színtérgazdával (a D31 kötelező gazdája így az első pillanattól megvan).
- **Egyszeri:** a rendszerindítás csak akkor fut, ha még nincs Rendszeradminisztrátor; a feltétel ellenőrzése és a jogok kiosztása egy tranzakcióban, zárolással történik (két egyidejű első belépésből csak az egyik kap jogot). Minden további felhasználó első belépéskor Szerző az Általánosban (D43). A további Rendszeradminisztrátorokat és Színtérgazdákat már a meglévők nevezik ki.
- **Napló:** a rendszerindítás egyetlen aktor nélküli rendszeresemény (D51d): `system_bootstrapped` (részletei: a felhasználó, az Általános színtér, és hogy most jött-e létre). Külön típus, hogy a `system_admin_granted` és a színtér-események továbbra is csak emberi aktorral legyenek írhatók; a rendszer-típusok CHECK-listáját a WP2 egy új migrációval bővíti (B4 S16).
- **Fejlesztésben** a dummy seed saját Rendszeradminisztrátort és Általános színteret hoz létre, így ott a rendszerindítás nem fut le.

**Indoklás:** nincs külön konfigurációs kulcs vagy kézi SQL-lépés; a tulajdonos az első telepítés után egyszerűen belép, és azonnal kezelheti az allowlistet és a színtereket.
**Vállalt ár:** a jogot az kapja, aki elsőként lép be. Az első élesítéskor ezért az allowlistben a tulajdonos lépjen be elsőként (célszerűen addig csak ő szerepeljen benne); ezt az üzembe helyezési útmutató rögzíti (WP2).

### D53 — A WP2 döntései: allowlist-szinkron, auth-függőségek, minimális belépő felület *(új, 2026-10-23 — lezárja az NY18-at; kiegészíti a D5, D26, D49 pontot)*

**Döntés (tulajdonos):**
- **A konfigurációból töltött allowlist (NY18 lezárva):** a konfiguráció a forrás, a backend induláskor szinkronizál. Új cím → felvétel; a konfigból eltávolított cím → soft delete, de csak ha a 409-es védelmek engedik (nem dokumentum-tulajdonos, nem utolsó Színtérgazda, nem utolsó Rendszeradminisztrátor) — különben aktív marad, és figyelmeztetés megy a naplóba; újra felvett cím → ugyanaz a sor újra aktív. Események: `allowlist_added`, `allowlist_removed`, aktor nélkül (D51d).
- **Auth-függőségek:** `openid-client` (6.x; OpenID-tanúsított: discovery, Authorization Code + PKCE, state és nonce, teljes token-validálás — Google-re és Entra ID-ra is) és `@fastify/cookie`. A double-submit CSRF saját, kis kód (a token a `GET /me` válaszában, B5 A1); külön CSRF-csomag nincs.
- **Minimális belépő felület a WP2-ben:** Bejelentkezés gomb (a backend `/auth/login`-ra irányít), a fejlécben név és Kijelentkezés a `GET /me` alapján, érthető üzenet `not_on_allowlist` esetén — a Táltos DS tokenjeivel. A prototípus csillagképes belépő képernyője (`Prototypes/taltos-login-handoff.md`) egy későbbi felület-csomag.
- **Google OAuth-kliens:** a tulajdonos hozza létre a WP2 végén (redirect URI: `http://localhost:8080/auth/callback`, `http://localhost:5173/auth/callback`); a secret a Compose-secretbe kerül (D13). OIDC-mock nincs (D49).

**Indoklás:** a konfig-szinkron az MVP-ben is lehetővé teszi egy távozó kolléga kivételét, a védelmek pedig megakadályozzák, hogy ezzel gazdátlan dokumentum vagy színtér maradjon; a tanúsított OIDC-kliens csökkenti a saját kód hibalehetőségét a legérzékenyebb részen.
**Vállalt ár:** két új futásidejű függőség; a konfigból „eltávolított”, de védett felhasználó aktív marad, amíg a tulajdonjogot át nem adják (NY15).

### D54 — A WP2 review-jának döntései: a rendszerindítás szigorítása, archivált dokumentumok és az allowlist *(új, 2026-10-23 — módosítja a D52-t és pontosítja a D53-at)*

**Előzmény:** a WP2 kód- és biztonsági review-ja két tulajdonosi kérdést vetett fel.
**Döntés (tulajdonos):**
- **Rendszerindítás csak a megadott címmel (a D52 módosítása):** az első Rendszeradminisztrátor és az Általános színtér kezdő Színtérgazdája **csak a konfigurációban megadott `BOOTSTRAP_ADMIN_EMAIL`** címmel belépő felhasználó lehet (a tulajdonos). Amíg nincs Rendszeradminisztrátor, más (allowlistes) felhasználó nem léphet be: munkamenet nélkül a `/?error=setup_pending` címre kerül („a rendszer még nincs beállítva”), mert az Általános színtérnek még nincs gazdája. A D52 többi része változatlan: egyszeri, sorosított, egyetlen `system_bootstrapped` esemény; a dummy seed fejlesztésben saját Rendszeradmint hoz.
- **Archivált dokumentumok és az allowlist (a D53 pontosítása):** az `owner_handover_required` védelem csak az archiválatlan dokumentumokra él; aki csak archivált dokumentumok tulajdonosa, kivehető az allowlistből. Egy ilyen dokumentum archívumból visszahozásakor (`unarchive`, D51g) a tulajdonost át kell adni — ennek módja az NY15-tel együtt dől el.

**Indoklás:** a „bárki, aki elsőként belép” kockázat (D52 vállalt ára) egy konfigurációs értékkel megszűnik; az archívum a régi anyagok helye, nem akadályozhatja egy távozó kolléga kivételét.
**Vállalt ár:** egy új kötelező konfigurációs érték; a rendszer az első Rendszeradmin belépéséig mások számára zárva van; az archívumban lehetnek távozott tulajdonosú dokumentumok.

## 4. Adatmodell-vázlat (PostgreSQL) *(módosítva — Postgres-only pivot)*

*Az érvényes séma a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|B4 (10. verzió, D51-kiegészítéssel)]]. Az alábbi alaplista a 8. verzió állapota, változástörténetként; az azóta történt változásokat a lenti „Változások” blokkok sorolják fel. A `categories`, `document_categories` és `locks` tábla megszűnt (D29, D34), a revízión nincs `iteration` (a jóváhagyott verziószám a `change_requests.iteration`-ben, D51).*

- `documents` — **stabil `id` (UUID, a rendszer generálja, soha nem változik)**; cím, slug/URL-út (attribútum, átnevezéskor változhat — az id nem!), státusz, tulajdonos, **sablon-jelölés (is_template)**, **jelenlegi tartalom** (vagy pointer a legfrissebb `document_revisions` sorra — implementációs részlet), **`search_vector` generált oszlop** (`tsvector`, magyar konfiguráció + `pg_trgm` a ragozás-tűrő kereséshez, mindig szinkronban a tartalommal), soft delete jelölés (archívum, D8)
- **`document_revisions` *(új tábla, a Git-történet helyettesítője)*** — dokumentum (id), **teljes szövegű pillanatkép** (a mentéskori tartalom), szerző, időbélyeg, iteration-szám, opcionális `restored_from_revision_id` (ha visszaállításból jött) — *elsődleges adat, mentendő; korábban ezt a szerepet a Git-történet töltötte be*
- `categories` — kategória mint entitás: név (egyedi), leírás; *mentendő adat*; használatban lévő nem törölhető/nevezhető át
- `document_categories` — dokumentum↔kategória kapcsolótábla (több-a-többhöz) — **tisztán relációs, elsődleges adat** *(korábban: „a repóból újraépíthető" — ez a megkülönböztetés megszűnt, mert nincs második forrás)*
- `favorites` — felhasználó↔dokumentum (privát kedvencek) — elsődleges adat, mentendő
- `events` — dokumentum (id-ra hivatkozik), típus (created/edited/status_changed/deleted/restored/renamed/duplicated_from/comment_edited/comment_deleted/category_created stb.), felhasználó, időbélyeg, részletek (JSONB) — elsődleges adat, mentendő
- `comments` — dokumentum (id), szerző, tartalom, időbélyeg, szerkesztve-jelölés, soft delete jelölés; rendszerüzenetek az `events`-ből vetítve — elsődleges adat, mentendő
- `locks` — dokumentum (id), felhasználó, megszerzés ideje, utolsó heartbeat
- `allowlist` — engedélyezett e-mail címek — elsődleges adat, mentendő
- `users` — OIDC-ből érkező identitások (név, e-mail, avatar); a `favorites` hivatkozásai miatt nem tisztán eldobható cache

**Változások a 9. verzióban (D29–D38):**
- `documents`: + `space_id`, `kind`, `review_due_at`; a tulajdonos kötelező (D31)
- `categories` → `tags` (`normalized_name UNIQUE`), `document_categories` → `document_tags` (D34)
- új: `spaces` (`color` is, D37), `space_members (space_id, user_id, role)`, `user_space_colors`, `users.is_admin` (D30, D31)
- új: `document_collab_state` (Yjs-állapot, `bytea`); `document_revisions` + `contributors` (D29)
- megszűnik: `locks` (D29)
- új: `notifications`, `subscriptions` (D35); `document_links` (D39)
**Változások a 10. verzióban (D42–D49):**
- `users.is_admin` → `users.system_role` (`user` | `system_admin`); `space_members.role ∈ {author, space_manager}` (D43)
- új: `space_requests`, `membership_requests` (D43, D44)
- új: `change_requests`, `change_request_reviewers`; `documents` + `approved_revision_id`, `review_state` (gyorsítótár); a `status` oszlop megszűnik (D45)
- második ütem: `blobs`, `revision_files`, `blob_derivatives`; `documents` + `format`, `search_text` (D42)
- új eseménytípusok: `review_requested`, `review_approved`, `review_rejected`, `review_withdrawn`, `reviewer_replaced`, `change_approved`, `change_rejected`, `space_requested`, `membership_requested`, `system_admin_granted`, `system_admin_revoked`, `imported_from`

**Változások a 10. verzió D51-kiegészítésében:**
- új: `sessions` (D51a); `change_requests` + `proposed_review_due_at` (D51f), `iteration` (a jóváhagyáskor kiadott verziószám); `change_kind` + `unarchive` (D51g); `document_collab_state` + a checkpoint előtti résztvevők
- `change_request_reviewers`: megszűnt hely jelölése, ugyanaz a személy újra jelölhető (D51b); `events.actor_id` nullable a rendszereseményeknél (D51d); az `events` dokumentum-, színtér- és kérés-hivatkozása FK nélküli (D51h)
- adatbázis-szerepek: `taltos_owner` (migráció), `taltos_app` (alkalmazás, DELETE csak a D51j kivételtábláin), `taltos_retention` (második ütem)
- új eseménytípusok: `reviewer_removed`, `edit_started`, `unarchived`, `review_stalled`, `space_updated`, `kind_created`, `draft_discarded`

**(9. verzió:)**
- új eseménytípusok: `owner_changed`, `review_due_set`, `review_due_soon`, `review_due`, `review_reminder`, `review_confirmed`, `tag_created`, `space_*`, `member_*`, `role_changed`

**Megszűnt koncepció: a frontmatter mint önálló forrás.** A korábbi tervben a .md fájl elején élő YAML frontmatter hordozta a metaadatokat (id, status, owner, iteration, categories, template-jelölés), és a repo emiatt volt „önmagában is teljes értékű". Ez a szerep a Postgres-only architektúrában **tárgytalanná válik**: minden metaadat közvetlen relációs oszlop/tábla, egyetlen forrásból (a DB-ből) olvasva. Az exportált `.md` fájl (D15/D21) továbbra is tartalmazhat egy minimális frontmatter-blokkot a hordozhatóság kedvéért, de ez immár **kimeneti formátum**, nem a rendszer belső forrás-igazsága.

## 5. MVP scope és ütemezés *(módosítva — Postgres-only pivot)*

**MVP (kötelező a demóhoz) — 9. verzió, az NY6 lezárásaként:**
1. OIDC login + allowlist (kérésenkénti ellenőrzéssel) + allowlist-védelem (D5, D31)
2. Zárt színterek + Rendszeradminisztrátor, Színtérgazda, Szerző + kötelező gazda (D30, D31, D43, D44)
3. Dokumentum létrehozása üresen vagy duplikálással (D17, D47) + kötelező fajta + címkék felajánlással (D34)
4. **Valós idejű közös szerkesztés** (D29) — a korábbi „Lock heartbeat-tel" pont helyett; **megállási feltétel:** ha a K0-spike (H5 WP3) nem teljesül, a pont visszaáll a D7 lock-modellre, és a D29 a második ütembe kerül
5. Verziótörténet + diff + visszaállítás (checkpoint-revíziókból, D21, D29)
6. Review-folyamat két review-errel, kötelező elutasítási indoklással, és felülvizsgálati esedékesség (D45, D33)
7. Teljes szövegű keresés (magyar) + facetek + rangsor relevanciával és frissességgel (D4, D36)
8. Élő Atlasz az SPA-ban, színtér szerinti színezéssel (D28, D37)
9. Eseménynaplózás + lapos kommentfolyam + @említés (D20, D35)
10. Értesítések alkalmazáson belül, WebSocketen (D35, D46)
11. Archívum + visszaállítás (D8)
12. Postgres backup (D4) — üzemeltetési MVP-elem, nem halasztható
13. Kedvencek (D18)
14. Vágólap + nyers .md letöltés (D21)
15. Felülvizsgálati értesítések ütemezve (D33)
16. Kapcsolatok és visszahivatkozások (D39)
17. E-mail értesítés (D35)
18. Duplikátum-figyelmeztetés cím alapján (D36, D49)
19. Export .pdf/.docx (D21) — *hátrasorolt: határidő-nyomásnál elsőként esik ki*
20. **Személyes feladat-dashboard főoldalként (D46)** — *új a 10. verzióban; a review-folyamat (6.) belépési pontja, ezért nem eshet ki*

**Kiesési sorrend határidő-nyomásnál (hátulról):** 19 → 18 → 17 → 16 → a 8. ponton belül az egyéni átszínezés → 15. Az 1–14. és a 20. pont nem eshet ki. Részletek és munkacsomagok: [[Tervezés/Tervezés (hetedik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomag-terv (10. verzió)]].

**Kimondott ár:** az MVP a 8. verzió 12 pontjáról a 9. verzióban 19, a 10. verzióban 20 pontra nőtt (új a személyes dashboard, D46). Új: színterek és szerepkörök, jóváhagyás, Atlasz az SPA-ban, értesítések, felülvizsgálat, kapcsolatok, e-mail, duplikátum-figyelmeztetés; a lock helyére a közös szerkesztés lép, a kategóriakezelés a címkékbe olvad. A D21 scope-fegyelme és a kiesési sorrend ezért kritikusabb, mint eddig; a legnagyobb egyedi kockázat a 4. pont, amelyet a megállási feltétel véd.

**Értékelés (D41):** a pilot az MVP 1–14. pontjának elkészülte után indul (H5 WP22 előkészítéssel); a kiesett MVP-pontok a pilotban nem mérhetők.

**Második ütem:** többformátumú tartalom (D42), létrehozás sablonból és fájlimport (D47), allowlist-felület „inaktív tulajdonosok” listával (D49), mentett szűrőnézetek, „Kövesd X-et” (D49), MCP-elérés (D38), szövegrészhez kötött kommentek (D35), ~~lock-átvétel~~ (tárgytalan, D29), allowlist-karbantartó felület, státusz-riportok, data retention szerinti időzített végleges törlés (NY4).

**Jövőbeli munka (szakdolgozatban fejezetként):** Microsoft Entra ID integráció (App Registration, csoport-claimek → belépés és színtér-tagság, D43), Microsoft Graph e-mail-adapter (D46), szemantikus keresés (pgvector, D49), tömeges fájlimport (D47), céges domain + TLS. *(Az olvasó-tükör elvetve: NY5.)* *(A korábbi „Azure Repos-ra állás [mirror push + konfigcsere]" pont törölve — tárgytalan.)*

## 6. Ismert korlátok, vállalt kockázatok *(módosítva — Postgres-only pivot)*

- ~~A státusz-workflow nem kikényszerített (D6).~~ **10. verzió:** a review-folyamat kikényszerített (D45). **Új kockázat: review-terhelés** — minden apró javítás két review-ert kíván; három tag alatti színtérben nincs review (D43).
- **Az audit megbízhatósági gyökere az alkalmazás-backend:** a revíziókat és eseményeket a backend írja a saját adatbázis-hozzáférésével; a szerző-mező (`author`/`user_id`) általa írt metaadat, kriptográfiai kötés nélkül. Az auditnyom hitelessége az alkalmazás integritásán és az adatbázis-hozzáférés korlátozásán áll — belső rendszernél vállalt kockázat, kimondva. *(Ugyanaz a vállalt kockázat, mint korábban a Git commit-authoré volt — csak a mechanizmus más.)*
- Az átláthatóság az írást fedi, az olvasást nem. **10. verzió:** a színterek zártak (D44); **új kockázat: a láthatósági szűrés minden olvasó úton kötelező**, egy kifelejtett végpont adatszivárgás — védelem: egyetlen lekérdezés-építő és végpontonkénti teszt.
- **Revízió-identitás és adatvédelem:** a felhasználó neve/e-mailje a `document_revisions.author`/`events.user_id` mezőkben megmarad, kilépő munkavállaló esetén is. Jogalapja a munkaköri tevékenység dokumentálása (jogos érdek); a szakdolgozat adatkezelési fejezetében rögzítendő. **Enyhülés a korábbi helyzethez képest:** mivel ez egy adatbázis-sor, nem egy kriptográfiailag láncolt, elvileg megváltoztathatatlan Git-history-bejegyzés, a data retention policy (NY4) szükség esetén technikailag könnyebben tud pszeudonimizálást/törlést végrehajtani rajta — ez a Postgres-only pivot egyik apró, de valós GDPR-előnye.
- **Elveszett képesség: nincs offline/klónozható vészhelyzeti olvasási mód.** A korábbi tervben szerverleállás esetén a repo klónozható és Obsidiannal olvasható volt. Ez megszűnt: teljes leállás esetén a helyreállítás kizárólag a pg_dump backupon és a szolgáltatás újraindításán múlik. **Vállalt korlát** — az NY5 olvasó-tükör a 10. verzióban elvetve, a korlát végleges.
- A magyar full-text keresés stemmer-minősége korlátos; a `pg_trgm` kombináció enyhíti, szemantikus keresés (pgvector) későbbi opció.
- ~~Valós idejű közös szerkesztés (Google Docs-élmény) tudatosan nincs — a lock-modell zárja ki az ütközést.~~ **Megszűnt korlát (D29).** Új kockázatok: WebSocket-infrastruktúra, Yjs-állapot mérete, szerkesztőcsere.
- ~~**Publikált dokumentum javítása (D29, D32)**~~ **10. verzió (D45):** egy javítás alatt a dokumentum alapnézete a függő változatot mutatja; az MCP és az export a legutóbbi Jóváhagyott revíziót adja, így nem esik ki.
- **Kilépő munkavállaló (D31):** az allowlistről törlés tulajdonjog-átadást igényel; az Entra ID-ban letiltott, de allowlisten maradt fiók felderítése a második ütem „inaktív tulajdonosok” listája (D49); pszeudonimizálás a retenciós idő után (D48).
- **Címke-redundancia (D34):** utólagos összevonás nincs, a védelem kizárólag a beíráskori felajánlás.
- **Egyéni Atlasz-színek (D37):** két felhasználó ugyanazt a térképet eltérő színekkel láthatja.
- **Új, korábban nem létező kockázat: a teljes revíziótörténet tárhelyigénye.** Minden mentés teljes szövegű pillanatkép (nem delta) — ez egyszerűbb és megbízhatóbb, mint egy delta-lánc, de a mentésszámmal arányosan növeli az adatbázis méretét. 200 fős szervezetnél, markdown szövegnél ez valószínűleg nem válik szűk keresztmetszetté, de egy becslés (várható dokumentumszám × várható mentés/dokumentum × átlagos dokumentumméret) érdemes lenne a dolgozatba, hogy a döntés ne csak érveléssel, hanem számmal is alá legyen támasztva.
- Az MVP a Postgres-only pivottal 13-ról 12 pontra csökkent (a reindex/konzisztencia-ellenőrzés tétel tárgytalanná vált) — a scope-fegyelem szabály (D21) és az export-csomag hátrasorolása változatlanul él.
- Egyszemélyes fejlesztés és üzemeltetés a bevezetésig: busz-faktor 1; a dokumentáció és az átadási terv ezért a projekt része.

## 7. Nyitott kérdések *(módosítva — Postgres-only pivot)*

- **NY1 — Statikus képek bekerülési útja: LEZÁRVA.** A képek nem a Postgresben, hanem az alkalmazás szintjén kezelt assets mappában élnek (javasoltan mountolt volume); feltöltési funkció nincs, hozzáadásuk fejlesztői/üzemeltetői művelet. Részletek: D15.
- ~~**NY2 — Azure Repos branch policy**~~ **— MEGSZŰNT, tárgytalanná vált a Postgres-only pivottal.** Nincs többé Azure Repos-függés a tartalom-tárolásban, tehát nincs branch-policy-ütközés a „mentés = szinkron írás" modellel. *(Ez volt az előző kritikai átvizsgálás legsúlyosabb, architektúra-blokkoló kockázata — a pivot ezt önmagában megoldja.)*
- **NY3 — Allowlist-karbantartás módja: LEZÁRVA (10. verzió)** — MVP-ben konfiguráció, második ütemben Rendszeradminisztrátor-felület (D49).
- **NY4 — Data retention policy: LEZÁRVA (10. verzió)** — D48. *Eredeti kérdés:* a soft delete-elt rekordok (kommentek, dokumentumok, kategóriák, **és immár a `document_revisions` sorok is**) végleges törlésének retenciós ideje, köre és GDPR-vonatkozásai; időzített, automatizált törlési folyamatként tervezendő (lásd D22 — cron-alapú megoldás elegendő). **Egyszerűsödés a korábbi állapothoz képest:** korábban nyitva maradt a kérdés, hogy a retention policy kiterjedhet-e a Git-történetre (ami elvileg nem felejt) — ez most tárgytalan, mert nincs külön, a policy hatókörén kívül eső történeti forrás: minden törölhető adat a Postgresben van, tehát a retention policy egységesen, kivétel nélkül alkalmazható rá.
- **NY5 — Vészhelyzeti olvashatóság pótlása: ELVETVE (10. verzió)** — a backup (D48) elég, a korlát vállalt. *Eredeti javaslat:* megfontolandó egy **ütemezett, egyirányú `.md`-exportáló job** (pl. napi, a backup mellett), amely minden dokumentum jelenlegi állapotát sima `.md` fájlként ír egy mountolt volume-ra/object storage-ba — nem verziózott, csak egy olvasható tükörpéldány. Ez részben pótolná az elvesztett „klónozható és Obsidiannal olvasható" képességet, minimális extra komplexitással (egy egyszerű, cron-vezérelt export-szkript, nem egy teljes git-alréteg). Eldöntendő: megéri-e az MVP-be vagy elég a második ütembe.

- **NY6 — MVP-hatókör újraszámolása: LEZÁRVA (9. verzió).** 19 pontos MVP (a D39-cel) kiesési sorrenddel és megállási feltétellel, lásd 5. fejezet és [[Tervezés/Tervezés (hatodik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomag-terv (9. verzió)]].
- **NY7 — Kapcsolatok: LEZÁRVA (9. verzió)** — D39.
- **NY8 — A pilot összehasonlítási alapja *(új, 10. verzió)*:** Confluence vagy SharePoint a szervezet tényleges eszköze, és létrehozható-e benne dummy teszt-tér (D41).
- **NY9 — A pilot hozzáférése és moderálása *(új, 10. verzió)*:** hogyan érik el a résztvevők a fejlesztői környezetet (alagút vagy céges VPN), és ki moderál (fejlesztő vagy semleges kolléga).
- **NY10 — Munkamenet-élettartam: LEZÁRVA (10. verzió)** — abszolút lejárat 8 óra, tétlenségi kiléptetés 60 perc; a nyitott közös szerkesztés (WebSocket-forgalom) aktívnak számít (D49). A tárolás: Postgres `sessions` tábla (D51a).

*Új nyitott kérdések a B4 átvizsgálásából (2026-10-23). Egyik sem blokkolja a WP1-et; a zárójelben jelölt munkacsomag előtt kell eldönteni őket. A tárolásuk a sémában additív.*

- **NY11 — Az @említés formátuma (D35; WP12 előtt):** a jelenlegi `@[név](user:uuid)` a megjelenítendő nevet a komment és a revízió szövegébe másolja, így a pszeudonimizálás (D48) nem éri el. Opciók: `@(user:uuid)`, a név megjelenítéskor a `users`-ből; vagy a névmaradás vállalása. Kell-e kinyert `comment_mentions` tábla?
- **NY12 — A címkék láthatósága a zárt színterek között (D34, D44; WP5 előtt):** a globális címkelista, a darabszámok és a `tag_exists` 409 más színterek létezését árulhatják el. Opciók: a lista, a javaslat és a darabszám a látható dokumentumokra szűrve; vagy a kockázat dokumentált vállalása.
- **NY13 — Kapcsolatok tárolása (D39; WP16 előtt):** a kapcsolattípus nem szerepel a szövegbeli linkben (`[cím](doc:uuid)`), így előfordulásonként nem párosítható; a „link eltűnik ⇒ kapcsolat megszűnik” szabály a `származik`-ot is törölné. A V50 (a `helyettesíti` cél általi törlése) review nélküli rendszer-revízió: kap-e `approved_revision_id`-t, `iteration`-t, és mi történik függő kérés vagy élő piszkozat mellett?
- **NY14 — Kapcsolat-értesítés idegen színtérbe (D39 V36/V50, D44; WP16 előtt):** a cél tulajdonosa nem biztos, hogy tagja a forrás színterének. Kapjon csonk-értesítést és törlési jogot, vagy a V36/V50 csak közös tagságnál él?
- **NY15 — Tulajdonjog-átadás (D31, D48; WP4 előtt):** a 409 `owner_handover_required` felkínálja, de csak adminisztratív átadás-végpont van. Ki adhat át (tulajdonos, Színtérgazda), és review-köteles-e?
- **NY16 — E-mail-beállítások és leiratkozás (D46; WP18 előtt):** a H5 WP18 említi, de nincs napló-pontja; D21 szerint addig nem épül.
- **NY17 — A Rendszeradmin audit-láthatósága (D43; WP9 előtt):** a rendszerszintű audit és a retenciós előnézet címet és komment-szöveget adhat, holott a Rendszeradminnak nincs tartalmi joga. Mely mezőket láthatja?
- **NY18 — Az első Rendszeradmin és a konfigurációból töltött allowlist: LEZÁRVA** — az első Rendszeradmin és az Általános kezdő Színtérgazdája: D52; a konfig-szinkron szemantikája: D53.
- **NY19 — Kisebb szabályok:** a duplikálás forrása (élő piszkozat vagy Jóváhagyott; WP5); eldobható-e egy beküldött, majd elutasított új dokumentum (WP8); a függő review sorsa a projekt-tér lezárásakor (WP4); munkanap-naptár a „3 munkanaphoz” (WP23); a Yjs-állapot generációja a visszaállítás utáni helyi gyorsítótárakhoz (WP3, WP14); a legal hold hatóköre (WP33).

## 8. Kapcsolódó dokumentumok — frissítés-igénnyel *(új, a Postgres-only pivot nyomán)*

A jelen napló hatóköre a fő architektúra-döntésekre terjed ki; a következő, a naplóból hivatkozott részletdokumentumok **szintén érintettek** a pivot által, de nem részei a jelen fájlnak:

- **`tudasbazis-db-sema-b4.md`** — a konkrét DDL frissítendő: `document_revisions` tábla felvétele, `search_vector` generált oszlop szintaxisa, a `documents.last_commit_hash`-jellegű mezők törlése.
- **`tudasbazis-api-kontraktus-b5.md`** — `baseCommitHash` → `baseRevisionId` átnevezés; a „lokális commit szinkron / push aszinkron" szakaszok törlése, egyszerű szinkron tranzakciós mentés-leírásra cserélve.
- **A 9. verzió nyomán:** a B4 séma a D29–D38 táblaváltozásaival, a B5 API-kontraktus a `/collab` végponttal és az új erőforrásokkal (színterek, címkék, értesítések), a H5 munkacsomagok ✅ újratervezve: [[Tervezés/Tervezés (hatodik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomag-terv (9. verzió)]].
- **A 10. verzió nyomán ✅:** [[Tervezés/Tervezés (hetedik kör)/tudasbazis-db-sema-b4|B4 séma (10. verzió)]], [[Tervezés/Tervezés (hetedik kör)/tudasbazis-api-kontraktus-b5|B5 API-kontraktus (10. verzió)]], [[Tervezés/Tervezés (hetedik kör)/tudasbazis-munkacsomagok-h5|H5 munkacsomag-terv (10. verzió)]]. A korábbi B4 és B5 (negyedik kör) és a H5 (hatodik kör) változástörténetként megmarad.
- **`tudasbazis-munkacsomagok-h5.md`** — a Git-írási alrendszerre épülő munkacsomag törlése/átalakítása; a kockázat-előrehozás elve (D27) új célpontra (keresőindex + diff-motor) irányítandó át.
