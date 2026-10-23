# Vállalati tudásbázis — architektúra-terv és döntési napló

Egyedi fejlesztésű, webes tudásbázis-rendszer ~200 fős vállalat számára, markdown alapú tartalommal. Szakdolgozati projekt; a fejlesztés saját infrastruktúrán indul, az éles üzem céges környezetben valósul meg.

*Verzió: 8. — **Postgres-only tárolási architektúra** (D1 felülvizsgálat): a Git-alapú tartalomtárolás elhagyva, a tartalom és a teljes revíziótörténet közvetlenül PostgreSQL-ben él. D3, D9, D12, D24 megszűnt/tárgytalanná vált; D1, D2, D4, D10, D11, D13, D15, D17, D19, D21, D22, D26, D27 ennek megfelelően átdolgozva; NY2 megszűnt, NY5 új javaslatként felvéve. A korábbi (Git+Postgres) verzió indoklása a D1 alatt, változástörténetként megőrizve.*

## 1. Követelmények

- Markdown (.md) formátumú tudásanyagok tárolása — **kizárólag szöveges tartalom**, közvetlenül a PostgreSQL-ben; statikus képek (`.svg`, `.png`, `.jpeg` — ábrák, guide-ok, felületi design) megjelenítése az **alkalmazás szintjén kezelt assets mappából**, képfeltöltés nincs (lásd D15)
- Dokumentum-létrehozás három úton: üres canvas, **sablonból**, **duplikálással** — egységes „létrehozás forrásból" műveletként (D17)
- Teljes szövegű keresés (magyar nyelvi támogatással)
- Kategorizálás: **lapos címke-rendszer** — a kategória alkalmazásszintű entitás (CRUD), egy dokumentum több kategóriába tartozhat (D19)
- **Kedvencek:** privát, felhasználónkénti megjelölés és szűrés (D18)
- Státuszkezelés (draft → review → tesztelt → publikált), soft workflow-val
- Tulajdonos és módosító személyek nyilvántartása, teljes auditálhatóság
- Teszteltség / iterációk követése — a verziófogalom kettős: **revízió-történet** (minden mentés egy sor a `document_revisions` táblában) + `iteration` mező a `documents` táblán; harmadik, kézi „verziószám" tudatosan nincs
- Verziókezelés, korábbi állapotok visszaállítása, **diff-nézet (MVP, D21)**
- Komment szekció tudásanyagonként, rendszereseményekkel; komment-szerkesztés és -törlés auditnyommal (D20)
- **Törlés-elv: minden törlés soft delete**, végleges törlés csak data retention policy szerinti időzített folyamatként (D20, részletek: NY4)
- Hordozható szoftver: új környezetben új adatbázissal és új autentikációval üzembe helyezhető — **a Git-alapú tárolás elhagyásával ez immár szó szerint két elemre redukálódik: új PostgreSQL-instance + új OIDC-konfiguráció, nincs harmadik mozgó alkatrész (repo/kulcs)**
- **Vágólapra másolás és exportálhatóság** `.md`, `.pdf` és `.docx` formátumba — **MVP (D21)**

## 2. Architektúra áttekintés

```
Felhasználó (böngésző)
        │
        ▼
React SPA — Vite + React Router (react-md-editor, kommentek, keresés)
        │  REST API
        ▼
Backend API — Node.js + Fastify (TypeScript)  ──► OIDC szolgáltató
   │   lock-kezelés · audit · diff-számítás        (fejlesztés: Google,
   │   (mentés = egyetlen DB-tranzakció)             éles: Microsoft Entra ID)
   ▼
PostgreSQL — EGYETLEN adatréteg (nincs külön forrás és index):
   documents (jelenlegi állapot + generált tsvector-index)
   document_revisions (teljes szövegű pillanatkép mentésenként — a Git-történet helyettesítője)
   events, comments, favorites, allowlist, categories, locks, users
   ← mind elsődleges, mentendő adat (pg_dump, ill. WAL-alapú PITR mérlegelendő)
```

**Felelősség-megosztás:**

| Réteg | Feladata |
|---|---|
| PostgreSQL | Egyetlen adatréteg: tartalom + teljes revíziótörténet + keresőindex (generált oszlop) + események/audit + kommentek + kedvencek + allowlist + lockok — minden elsődleges, mentendő adat |
| Backend API | Minden írás egyetlen kapuja; egy DB-tranzakcióban ír revíziót és frissíti a dokumentum jelenlegi állapotát; lock-kezelés; eseménynaplózás; diff-számítás alkalmazásszinten |
| Frontend | Szerkesztés, böngészés, keresés, kommentfolyam, diff-megjelenítés |
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

### D6 — Nincs jogosultságkezelés: mindenki mindent lát és tehet *(kiegészítve)*

Minden belépett (allowlistes) felhasználó minden funkciót elér, és **minden tartalmat lát — ez kimondott cél, nem mellékhatás**: a tudásbázis rendeltetése a szervezeten belüli kollaboráció elősegítése, a teljes olvasási nyitottság ennek eszköze.
**Következmény (tartalompolitikai korlát):** a tudásbázisba kizárólag olyan tartalom kerülhet, amelyet a szervezet bármely tagja megismerhet. Ez bevezetéskor kimondandó szervezeti szabály.
**Kompenzáció az írási oldalon:** teljes átláthatóság — minden művelet (szerkesztés, státuszváltás, törlés, visszaállítás) eseményként naplózódik és a kommentfolyamban rendszerüzenetként megjelenik. A workflow-fegyelem szervezeti szabály, nem technikai kényszer: „technikailag nyitott, szervezetileg szabályozott."
**Vállalt korlát:** az auditnyom az írást fedi, az olvasást nem (olvasásnaplózás tudatosan nincs).

### D7 — Egyidejű szerkesztés: pesszimista lock + heartbeat

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
- Élesben opcionálisan Azure Key Vault, ha a céges infrastruktúra adja.
- *(A korábbi SSH-kulcs-specifikus pontok — környezetenkénti kulcspár, dedikált service account a repóhoz, rotációs eljárás a remote-nál — tárgytalanná váltak: nincs többé SSH-alapú repo-hitelesítés.)*

### D14 — Frontend stack: shadcn/ui + Tailwind + Motion *(új)*

A shadcn nem futásidejű függőség, hanem **bemásolt, saját tulajdonú komponenskód** — busz-faktor-1 projektnél előny: nincs breaking upgrade-kényszer, a karbantartás saját kézben van. A Tailwind-elköteleződés vállalt és kimondott. A Motion animációk funkcionális UX-visszajelzésre szolgálnak (mentés, lock-állapot, kommentfolyam-frissülés), nem öncélú effektekre.

### D15 — Tartalom-scope: szöveg a Postgresben; képek alkalmazásszintű statikus assets-ként; export MVP-ben *(módosítva — Postgres-only pivot)*

- A tudásanyag szövege **kizárólag a `documents`/`document_revisions` táblákban** él (nem fájlrendszeren, nem repóban); képfeltöltés és csatolmány-kezelés nem funkciója a rendszernek.
- **Statikus képek** (`.svg`, `.png`, `.jpeg` — ábrák, guide-ok, felületi design) **az alkalmazás szintjén kezelt assets mappából** jelennek meg (mountolt volume, esetleg object storage), **nem a Postgresben** (nagy bináris blobok elkerülése) — a markdown az alkalmazás saját assets-útvonalára hivatkozik. Javasolt forma: mountolt volume (nem az image részeként) — új kép hozzáadása fájlmásolás, nem rebuild+redeploy.
- **Következmények (vállalva):** kép hozzáadása fejlesztői/üzemeltetői művelet, nem szerzői; a képek nem verziózódnak a tartalommal (csere visszamenőleg minden dokumentumverzióban érvényesül).
- **Export** `.md`, `.pdf` és `.docx` formátumba: MVP-be emelve (D21); a `.pdf`/`.docx` szerveroldali konverzióként tervezendő (pandoc — a tartalom a DB-ből egy ideiglenes fájlba írva a konverzió idejére); a `.md` letöltés és a vágólap-másolás kliensoldali, triviális.

### D16 — Markdown szerkesztő: @uiw/react-md-editor *(új)*

Könnyű, textarea-alapú szerkesztő élő előnézettel — illik a markdown-fegyelmű, csak-szöveg scope-hoz (D15), nem WYSIWYG-absztrakció.
**Kötelező kiegészítések:**
- **rehype-sanitize** mind a szerkesztő-előnézetben, mind az olvasó nézetben — a nyers HTML átengedése betárolt XSS-t jelentene (200 szerző, mindenki olvas).
- **Képforrás-korlátozás a sanitize-sémában:** kép (`img` / markdown képszintaxis) kizárólag az alkalmazás saját assets-útvonaláról renderelődik; külső URL-ű képhivatkozás nem jelenik meg (privacy-szivárgás és megbízhatósági kockázat ellen).
- Az olvasó nézet **ugyanazzal a remark/rehype pipeline-nal** renderel, mint a szerkesztő előnézete.
- A piszkozat-őrzés (D7) a szerkesztő körüli saját felelősség, nem a komponensé.

### D17 — Sablonok: a sablon is tudásanyag; „létrehozás forrásból" egységes művelet *(módosítva — Postgres-only pivot)*

**Döntés:** a sablon ugyanolyan tudásanyag-sor a `documents` táblában, mint bármely más dokumentum — sablon-mivolta **metaadat** (`is_template` oszlop, a felületen kategóriaszerű szűrőként jelenik meg). Nincs külön sablon-alrendszer: tárolás és kezelés a normál dokumentum-CRUD-on át (D2-vel és D15-tel konzisztens), teljes revíziótörténettel.
**Vállalt következmény (D6):** a sablonokat bárki módosíthatja — a sablonfegyelem szervezeti szabály, az auditnyom a védvonal.
**Implementációs egyesítés:** a *sablonból létrehozás* és a *duplikálás* ugyanaz a művelet — **„létrehozás forrásból"** —, csak a forrás más. Szemantika: az új dokumentum **új UUID-t** kap; a jelenlegi tartalomból egy új, első `document_revisions` sor és kategória-hozzárendelések másolódnak; **státusz = draft, owner = a létrehozó, iteration reset**; a forrás kommentjei és eseményei **nem** másolódnak; keletkezik `duplicated_from` esemény, amely mindkét dokumentumnál megjelenik. MVP.
*(Egyszerűsödés a korábbi verzióhoz képest: nincs többé repó-fájl másolási/útvonal-kezelési kérdés — a művelet tisztán relációs beszúrásokra redukálódik.)*

### D18 — Kedvencek: privát, felhasználónkénti; az első valódi per-user elsődleges adat *(új)*

**Döntés:** kedvencek funkció MVP-elemként — a felhasználó dokumentumokat kedvencnek jelölhet, a listák/keresés kedvencekre szűrhető.
**Láthatóság: privát** — kizárólag az adott felhasználó látja a saját kedvenceit. Ez konzisztens a D6 vállalt korlátjával: az átláthatóság az írási oldalt fedi, az olvasói preferencia nem naplózott, nem publikus.
**Adat-kategorizálási következmény:** a `favorites` tábla **elsődleges, sehonnan újra nem építhető adat** → a pg_dump backup-körbe tartozik. Ezzel a `users` tábla sem tisztán eldobható cache többé.

### D19 — Kategóriák: lapos címke-rendszer, alkalmazásszintű entitásként *(módosítva — Postgres-only pivot)*

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

### D26 — API-kontraktus: REST `/api/v1`, cookie-session + CSRF, RFC 9457 hibák, code-first OpenAPI *(módosítva — mentés-szemantika egyszerűsödött)*

**Döntés (elvek, részletek: `tudasbazis-api-kontraktus-b5.md` — felülvizsgálandó, lásd megjegyzés):**
- **Session httpOnly cookie-ban** (az OIDC-token soha nem jár a böngésző JS-terében), `SameSite=Lax` + CSRF-token a mutáló kéréseken — a D5 CSRF-követelményének realizálása.
- **Hibaformátum: RFC 9457 Problem Details** + stabil gépi `code` mező.
- **Mentés-szemantika (egyszerűsödve):** a `PUT …/content` egyetlen szinkron DB-tranzakciót vár meg (200 + új `revisionId`) — **nincs többé „lokális commit szinkron, push aszinkron" kettősség, mert nincs push.** **Kötelező `baseRevisionId`** optimista ellenőrzéssel (412) a lock-lejárat utáni kései mentés ellen — a lock (D7) mellé második védvonal, ugyanaz a szerep, mint korábban a `baseCommitHash`-nek.
- **Code-first kontraktus:** a Fastify JSON Schema validáció (D22) az egyetlen forrás, az OpenAPI belőle generálódik (`@fastify/swagger`).
- Lapozás `limit`/`offset`; kommentek + rendszeresemények egyetlen szerverin fésült `feed` végpontból; export szinkron streaminggel.
**Vállalt ár:** a cookie-session a frontendet same-origin üzemre köti; a szinkron export nagy dokumentumnál timeout-kockázat.
**Megjegyzés:** a `tudasbazis-api-kontraktus-b5.md` külön dokumentum a `baseCommitHash` → `baseRevisionId` átnevezést és a push-related szakaszok törlését igényli — ez a jelen napló hatókörén kívül eső, de érintett dokumentum.

### D27 — Megvalósítási sorrend: munkacsomagok, kockázat-előrehozással *(módosítva — a legkockázatosabb komponens megszűnt)*

**Döntés:** a fejlesztés delegálható munkacsomagokban halad (részletek: `tudasbazis-munkacsomagok-h5.md` — felülvizsgálandó, lásd megjegyzés), sorrendi elvekkel:
1. **Kockázat-előrehozás (átértékelve):** a korábban legkockázatosabbnak jelölt komponens (Git-írási alrendszer: GitService + pg-boss queue) **megszűnt** — nincs többé git-írási kísérletezést igénylő alrendszer. Az így felszabaduló legkockázatosabb hátralévő elem a **keresőindex + generált `tsvector` oszlop (magyar konfiguráció, `pg_trgm`)** és a **diff-motor** — ezeket érdemes az új „korán derítendő kockázat" helyére tenni, közvetlenül a séma után.
2. **Gerinc először:** a séma után végigjátszható mag épül (login → létrehozás → mentés = DB-tranzakció); a levél-funkciók erre rakódnak, egymástól függetlenül, párhuzamosíthatóan.
3. **Hátulról védett demó-érték:** határidő-nyomásnál a csomagok hátulról előre esnek ki, elsőként az export — összhangban D21 hátrasorolásával.
4. **Csomag-zárási fegyelem:** minden csomag CI-zöld tesztekkel + a naplópontok visszaellenőrzésével zárul; új igény csak a naplón át.
**Egyenes következmény:** a korábbi munkacsomag-listából a Git-írási alrendszerre épülő csomag törlődik — a teljes ütemterv valószínűleg rövidebb és kevésbé kockázatos lett. **A `tudasbazis-munkacsomagok-h5.md` dokumentum újratervezése szükséges** (lásd a fejezet végi összefoglalót).

## 4. Adatmodell-vázlat (PostgreSQL) *(módosítva — Postgres-only pivot)*

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

**Megszűnt koncepció: a frontmatter mint önálló forrás.** A korábbi tervben a .md fájl elején élő YAML frontmatter hordozta a metaadatokat (id, status, owner, iteration, categories, template-jelölés), és a repo emiatt volt „önmagában is teljes értékű". Ez a szerep a Postgres-only architektúrában **tárgytalanná válik**: minden metaadat közvetlen relációs oszlop/tábla, egyetlen forrásból (a DB-ből) olvasva. Az exportált `.md` fájl (D15/D21) továbbra is tartalmazhat egy minimális frontmatter-blokkot a hordozhatóság kedvéért, de ez immár **kimeneti formátum**, nem a rendszer belső forrás-igazsága.

## 5. MVP scope és ütemezés *(módosítva — Postgres-only pivot)*

**MVP (kötelező a demóhoz):**
1. Google OIDC login + e-mail allowlist (kérésenkénti ellenőrzéssel)
2. Dokumentum CRUD webes markdown szerkesztővel (react-md-editor; **mentés = új `document_revisions` sor egy DB-tranzakcióban**); létrehozás üres canvasból, sablonból vagy duplikálással — egységes „létrehozás forrásból" művelet (D17)
3. Verziótörténet nézet + korábbi verzió visszaállítása (**a `document_revisions` táblából**) + **diff-nézet UI két verzió között (alkalmazásszintű szövegdiff, D21)**
4. Teljes szövegű keresés (magyar konfig) + kategória(címke)/státusz szűrés + **kedvencek-szűrő**
5. Lock heartbeat-tel
6. Eseménynaplózás + kommentfolyam rendszerüzenetekkel; komment-szerkesztés és -törlés auditnyommal (D20)
7. ~~Reindex parancs + automatizált konzisztencia-ellenőrzés~~ — **törölve: tárgytalan, mert nincs külön index-forrás (D4)**
8. Archívum + visszaállítás felület
9. Postgres backup (ütemezett pg_dump — **immár az egyetlen backup-mechanizmus**, lásd D4) — üzemeltetési MVP-elem, nem halasztható
10. **Kategóriakezelés** — kategória-entitások CRUD-ja a védelmi szabályokkal (D19)
11. **Kedvencek** — privát megjelölés és szűrés (D18)
12. **Vágólapra másolás + nyers .md letöltés** (D21)
13. **Export .pdf/.docx** szerveroldali pandoc-pipeline-nal (D21) — *hátrasorolt csomag: határidő-nyomás esetén elsőként esik ki*

*(A törölt 7. pont miatt az MVP a korábbi 13 helyett most 12 megépítendő tételt tartalmaz — ez a Postgres-only pivot egyik közvetlen, mérhető nyeresége: kevesebb megépítendő infrastruktúra, nem kevesebb felhasználói érték.)*

**Második ütem:** lock-átvétel, allowlist-karbantartó felület, státusz-riportok, data retention szerinti időzített végleges törlés (NY4).

**Jövőbeli munka (szakdolgozatban fejezetként):** Microsoft Entra ID integráció (App Registration, csoport-claimek), céges domain + TLS, esetleges olvasó-tükör. *(A korábbi „Azure Repos-ra állás [mirror push + konfigcsere]" pont törölve — tárgytalan.)*

## 6. Ismert korlátok, vállalt kockázatok *(módosítva — Postgres-only pivot)*

- A státusz-workflow nem kikényszerített (D6) — szervezeti fegyelemre épül, az audit-nyom a védvonal.
- **Az audit megbízhatósági gyökere az alkalmazás-backend:** a revíziókat és eseményeket a backend írja a saját adatbázis-hozzáférésével; a szerző-mező (`author`/`user_id`) általa írt metaadat, kriptográfiai kötés nélkül. Az auditnyom hitelessége az alkalmazás integritásán és az adatbázis-hozzáférés korlátozásán áll — belső rendszernél vállalt kockázat, kimondva. *(Ugyanaz a vállalt kockázat, mint korábban a Git commit-authoré volt — csak a mechanizmus más.)*
- Az átláthatóság az írást fedi, az olvasást nem; a teljes olvasási nyitottság tartalompolitikai korlátot jelent (D6).
- **Revízió-identitás és adatvédelem:** a felhasználó neve/e-mailje a `document_revisions.author`/`events.user_id` mezőkben megmarad, kilépő munkavállaló esetén is. Jogalapja a munkaköri tevékenység dokumentálása (jogos érdek); a szakdolgozat adatkezelési fejezetében rögzítendő. **Enyhülés a korábbi helyzethez képest:** mivel ez egy adatbázis-sor, nem egy kriptográfiailag láncolt, elvileg megváltoztathatatlan Git-history-bejegyzés, a data retention policy (NY4) szükség esetén technikailag könnyebben tud pszeudonimizálást/törlést végrehajtani rajta — ez a Postgres-only pivot egyik apró, de valós GDPR-előnye.
- **Elveszett képesség: nincs offline/klónozható vészhelyzeti olvasási mód.** A korábbi tervben szerverleállás esetén a repo klónozható és Obsidiannal olvasható volt. Ez megszűnt: teljes leállás esetén a helyreállítás kizárólag a pg_dump backupon és a szolgáltatás újraindításán múlik. **Vállalt korlát** — enyhítési lehetőség: lásd az új NY5-javaslatot.
- A magyar full-text keresés stemmer-minősége korlátos; a `pg_trgm` kombináció enyhíti, szemantikus keresés (pgvector) későbbi opció.
- Valós idejű közös szerkesztés (Google Docs-élmény) tudatosan nincs — a lock-modell zárja ki az ütközést.
- **Új, korábban nem létező kockázat: a teljes revíziótörténet tárhelyigénye.** Minden mentés teljes szövegű pillanatkép (nem delta) — ez egyszerűbb és megbízhatóbb, mint egy delta-lánc, de a mentésszámmal arányosan növeli az adatbázis méretét. 200 fős szervezetnél, markdown szövegnél ez valószínűleg nem válik szűk keresztmetszetté, de egy becslés (várható dokumentumszám × várható mentés/dokumentum × átlagos dokumentumméret) érdemes lenne a dolgozatba, hogy a döntés ne csak érveléssel, hanem számmal is alá legyen támasztva.
- Az MVP a Postgres-only pivottal 13-ról 12 pontra csökkent (a reindex/konzisztencia-ellenőrzés tétel tárgytalanná vált) — a scope-fegyelem szabály (D21) és az export-csomag hátrasorolása változatlanul él.
- Egyszemélyes fejlesztés és üzemeltetés a bevezetésig: busz-faktor 1; a dokumentáció és az átadási terv ezért a projekt része.

## 7. Nyitott kérdések *(módosítva — Postgres-only pivot)*

- **NY1 — Statikus képek bekerülési útja: LEZÁRVA.** A képek nem a Postgresben, hanem az alkalmazás szintjén kezelt assets mappában élnek (javasoltan mountolt volume); feltöltési funkció nincs, hozzáadásuk fejlesztői/üzemeltetői művelet. Részletek: D15.
- ~~**NY2 — Azure Repos branch policy**~~ **— MEGSZŰNT, tárgytalanná vált a Postgres-only pivottal.** Nincs többé Azure Repos-függés a tartalom-tárolásban, tehát nincs branch-policy-ütközés a „mentés = szinkron írás" modellel. *(Ez volt az előző kritikai átvizsgálás legsúlyosabb, architektúra-blokkoló kockázata — a pivot ezt önmagában megoldja.)*
- **NY3 — Allowlist-karbantartás módja:** felület vs. konfig (korábbról nyitott; második ütem).
- **NY4 — Data retention policy:** a soft delete-elt rekordok (kommentek, dokumentumok, kategóriák, **és immár a `document_revisions` sorok is**) végleges törlésének retenciós ideje, köre és GDPR-vonatkozásai; időzített, automatizált törlési folyamatként tervezendő (lásd D22 — cron-alapú megoldás elegendő). **Egyszerűsödés a korábbi állapothoz képest:** korábban nyitva maradt a kérdés, hogy a retention policy kiterjedhet-e a Git-történetre (ami elvileg nem felejt) — ez most tárgytalan, mert nincs külön, a policy hatókörén kívül eső történeti forrás: minden törölhető adat a Postgresben van, tehát a retention policy egységesen, kivétel nélkül alkalmazható rá.
- **NY5 — Vészhelyzeti olvashatóság pótlása *(új, a Postgres-only pivot nyomán)*:** megfontolandó egy **ütemezett, egyirányú `.md`-exportáló job** (pl. napi, a backup mellett), amely minden dokumentum jelenlegi állapotát sima `.md` fájlként ír egy mountolt volume-ra/object storage-ba — nem verziózott, csak egy olvasható tükörpéldány. Ez részben pótolná az elvesztett „klónozható és Obsidiannal olvasható" képességet, minimális extra komplexitással (egy egyszerű, cron-vezérelt export-szkript, nem egy teljes git-alréteg). Eldöntendő: megéri-e az MVP-be vagy elég a második ütembe.

## 8. Kapcsolódó dokumentumok — frissítés-igénnyel *(új, a Postgres-only pivot nyomán)*

A jelen napló hatóköre a fő architektúra-döntésekre terjed ki; a következő, a naplóból hivatkozott részletdokumentumok **szintén érintettek** a pivot által, de nem részei a jelen fájlnak:

- **`tudasbazis-db-sema-b4.md`** — a konkrét DDL frissítendő: `document_revisions` tábla felvétele, `search_vector` generált oszlop szintaxisa, a `documents.last_commit_hash`-jellegű mezők törlése.
- **`tudasbazis-api-kontraktus-b5.md`** — `baseCommitHash` → `baseRevisionId` átnevezés; a „lokális commit szinkron / push aszinkron" szakaszok törlése, egyszerű szinkron tranzakciós mentés-leírásra cserélve.
- **`tudasbazis-munkacsomagok-h5.md`** — a Git-írási alrendszerre épülő munkacsomag törlése/átalakítása; a kockázat-előrehozás elve (D27) új célpontra (keresőindex + diff-motor) irányítandó át.
