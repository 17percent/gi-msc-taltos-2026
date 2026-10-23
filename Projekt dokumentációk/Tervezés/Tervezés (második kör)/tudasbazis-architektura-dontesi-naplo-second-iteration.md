# Vállalati tudásbázis — architektúra-terv és döntési napló

Egyedi fejlesztésű, webes tudásbázis-rendszer ~200 fős vállalat számára, markdown alapú tartalommal. Szakdolgozati projekt; a fejlesztés saját infrastruktúrán indul, az éles üzem céges környezetben valósul meg.

*Verzió: 2. — a második grilling session (kulcskezelés, Git-hozzáférési mód, Azure Repos, tartalom-scope) eredményeivel frissítve.*

## 1. Követelmények

- Markdown (.md) formátumú tudásanyagok tárolása — **kizárólag szöveges tartalom a repóban**; statikus képek (`.svg`, `.png`, `.jpeg` — ábrák, guide-ok, felületi design) megjelenítése az **alkalmazás szintjén kezelt assets mappából**, képfeltöltés nincs (lásd D15)
- Teljes szövegű keresés (magyar nyelvi támogatással)
- Kategorizálás (mappastruktúra + metaadatok)
- Státuszkezelés (draft → review → tesztelt → publikált), soft workflow-val
- Tulajdonos és módosító személyek nyilvántartása, teljes auditálhatóság
- Teszteltség / iterációk követése
- Verziókezelés, korábbi állapotok visszaállítása, diff-nézet
- Komment szekció tudásanyagonként, rendszereseményekkel (státuszváltás, törlés stb.)
- Hordozható szoftver: új környezetben új adatbázissal és új autentikációval üzembe helyezhető
- Exportálhatóság `.pdf` és `.txt` (esetleg `.docx`) formátumba — második ütem

## 2. Architektúra áttekintés

```
Felhasználó (böngésző)
        │
        ▼
React frontend (react-md-editor, kommentek, keresés)
        │  REST API
        ▼
Backend API  ──────────────► OIDC szolgáltató
   │      │                  (fejlesztés: Google,
   │      │                   éles: Microsoft Entra ID)
   │      ▼
   │   Lokális Git clone (tartós volume)   ← olvasás: log/diff/show helyben
   │      │  git push (SSH, worker queue)
   │      ▼
   │   Remote repo                          ← tartalom source of truth + backup
   │      (fejlesztés: GitHub privát repo,
   │       éles: Azure Repos)
   ▼
PostgreSQL   ← keresőindex (eldobható) + ELSŐDLEGES adat:
                események, kommentek, allowlist (mentendő!),
                lockok, user-cache
```

**Felelősség-megosztás:**

| Réteg | Feladata |
|---|---|
| Lokális Git clone | A tudásanyagok (.md) munkapéldánya: minden olvasás (történet, diff, korábbi verzió) helyben, API-hívás nélkül |
| Remote repo | Source of truth + tartalmi backup; fejlesztésben GitHub, élesben Azure Repos |
| PostgreSQL | Keresőindex (újraépíthető) ÉS elsődleges adatok: események/audit, kommentek, allowlist; lockok, user-cache |
| Backend API | Minden írás egyetlen kapuja; commit a felhasználó nevében; Git-műveletek sorosítása; indexfrissítés; lock-kezelés; eseménynaplózás |
| Frontend | Szerkesztés, böngészés, keresés, kommentfolyam, diff-megjelenítés |
| OIDC szolgáltató | Csak autentikáció (jelszó- és identitáskezelés kiszervezve) |

## 3. Döntési napló

### D1 — Tárolás: Git (source of truth) + PostgreSQL index
**Alternatívák:** tisztán PostgreSQL; hálózati meghajtó / Obsidian vault; kész platform (Outline, Wiki.js).
**Döntés indoklása:** a Git ingyen adja a verziótörténetet, a diffet, a visszaállítást és a fájlrendszer-szintű hordozhatóságot (a teljes tudásbázis egy clone-nal menthető). A Postgres a keresés és a metaadat-lekérdezések gyengeségét pótolja.
**Vállalat ára:** két mozgó alkatrész, a varratot (commit ↔ index) kezelni kell (lásd D4), a lokális clone ↔ remote varratot a D12 kezeli.

### D2 — Minden írás kizárólag a webes API-n keresztül
A repo közvetlen módosítása (GitHub/Azure Repos felületen vagy klónon át) szervezetileg tiltott. Így a lock-mechanizmus, az eseménynaplózás és az indexfrissítés megkerülhetetlen; webhook/polling szinkron külső változásokra nem szükséges. **A döntés kivétel nélkül érvényes: a repóban kizárólag .md tartalom él, a képek nem a repóban tárolódnak (D15), így képfeltöltési kivétel sem kell.**

### D3 — Backend-hitelesítés a repo felé: SSH kulcs, provider-agnosztikusan *(módosítva)*
**Döntés:** a backend SSH kulcspárral hitelesít a remote felé — ez GitHubon (deploy key) és Azure Repos-on azonos mechanizmus, így az átállás konfigcsere.
Nem személyes PAT és nem provider-specifikus App: a hozzáférés a rendszerhez tartozik, nem fejlesztő személyéhez, és nem köt providerhez.
**Környezetek:**
- Fejlesztés: privát GitHub repo a fejlesztő fiókja alatt, repo-szintű deploy key-jel (write joggal).
- Éles: **Azure Repos** a céges DevOps-szervezetben. Figyelem: az Azure DevOps SSH-kulcs **fiókszintű**, nem repo-szintű — ezért **dedikált service account** kell, amely kizárólag a tudásbázis-repóhoz fér hozzá; a kulcs ennek a fiókjában él.
**Kulcsvédelem: lásd D13. Éles bevezetés előtt tisztázandó: NY2 (branch policy).**

### D4 — Konzisztencia-szabály: a Postgres **index** eldobható — a Postgres NEM az *(pontosítva)*
A mentés sorrendje: Git commit → indexfrissítés. Ha az indexelés hibázik, a mentés attól még sikeres; hibakezelés automatikus reindexet indít. Az első naptól létezik `reindex` parancs, amely a repót nulláról végigolvasva felépíti a teljes indexet.
**Pontosítás:** az eldobhatóság kizárólag az indexre (`documents` indexelt mezői) igaz. Az `events`, `comments` és `allowlist` táblák **elsődleges, sehonnan újra nem építhető adatok** — a teljes auditnyom (a D6 kompenzációs mechanizmusa!) és a kommentfolyam itt él.
**Backup-stratégia (kötelező):** ütemezett `pg_dump` (napi), külön tárolóra (nem ugyanarra a diszkre/gépre), definiált retencióval; a visszaállítási eljárás dokumentált és legalább egyszer kipróbált. A repo tartalmi backupja a remote maga.
**Automatizált konzisztencia-őr:** minden dokumentumnál tárolt utolsó commit hash; ütemezett ellenőrzés veti össze a clone HEAD-jét az indexelt hash-ekkel, eltérésnél automatikus reindex indul és esemény naplózódik. A reindex így nem kézi vészintézkedés, hanem önjavító mechanizmus.

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
Törléskor a dokumentum archív állapotba kerül (nem vész el; a Git-történet is őrzi). Az archívumnak webes listázó/visszaállító felülete van; karbantartása kijelölt személy szervezeti felelőssége.

### D9 — Események és kommentek a Postgres-ben
A kommentek és a rendszeresemények nem a Git-ben élnek: `events` tábla a művelet-történetnek (ki, mit, mikor), ebből épül a dokumentumonkénti rendszerüzenet-folyam és a globális audit-nézet. (Mentésükről a D4 backup-szabálya gondoskodik.)

### D10 — Hosting: fejlesztés alatt saját szerver, élesben céges infrastruktúra
Docker Compose-ban futó teljes stack (frontend, backend, Postgres) — ez adja a környezetfüggetlenséget: az éles üzembe állítás konfiguráció (domain, OIDC, repo-elérés), nem átépítés. Publikus PaaS free tier (Vercel/Netlify) elvetve: licenc- és kapacitáskorlátok, plusz nem futtatnak tartós backendet és adatbázist.
**Vészhelyzeti elérés:** szerverleállás esetén a repo klónozható és Obsidiannal olvasható — ezt belső oktatás ismerteti. (Azure Repos-on ugyanígy működik.)

### D11 — Fejlesztési adathatár *(megerősítve és kiterjesztve)*
Éles céges tartalom nem kerülhet a fejlesztői környezetbe (otthoni szerver, privát repo); a fejlesztés **kizárólag dummy adatokkal** történik. Éles adat csak a céges környezetben születik.
**Kiterjesztés:** a **GitHub kizárólag fejlesztési környezet** — éles céges tartalom **soha, semmilyen formában nem kerül GitHub-ra**. Az éles rendszer remote-ja a szervezeti struktúrában már használt **Azure Repos**. Az átállás nem „transfer", hanem mirror push az új remote-ra + konfigcsere (remote URL, SSH kulcs) — a teljes történet átmegy, provider-oldali metaadat-függés nincs (lásd D12).

### D12 — Git-hozzáférés: git protokoll + lokális clone, provider API tilos *(új)*
**Döntés:** a backend egy tartós volume-on tárolt **lokális clone**-nal dolgozik, és kizárólag a git protokollt használja (SSH). Provider-specifikus REST API-ra (GitHub Contents/Commits API, Azure DevOps API) **építeni tilos**.
**Indoklás:** minden olvasó művelet — verziótörténet, diff, korábbi verzió megtekintése — lokális, ezredmásodperces `git log/diff/show`, nulla hálózati hívás, nulla rate limit; a felület diff- és történet-nézetei így olcsók. Egyben ez adja a provider-függetlenséget: a GitHub → Azure Repos átállás remote URL + kulcs csere.
**A varrat kezelése (lokális clone ↔ remote):**
- **Sorosítás:** minden Git-műveletet (commit, push) a backend **worker queue-n** keresztül, egyesével hajt végre — konkurens `index.lock` ütközés kizárva.
- **Push retry:** a mentés a lokális committal sikeres; ha a push hibázik (hálózat, remote-leállás), automatikus újrapróbálkozás exponenciális visszavárakozással.
- **Lemaradás-monitoring:** a rendszer méri és felületen/riasztásban jelzi, hány commituval van lemaradva a remote a lokális clone-tól; tartós lemaradás üzemeltetői riasztás (ez jelzi a visszavont/lejárt kulcsot is).
- A konténer-újraindítást a volume-on perzisztált clone éli túl; sérült clone esetén friss clone a remote-ról + reindex.

### D13 — Kulcs- és secret-kezelés *(új)*
- Az SSH privát kulcs (és minden más secret: OIDC client secret, DB jelszó) **soha nem kerül Docker image-be, repóba vagy commitolható `.env` fájlba**.
- Betöltés **Docker Compose secrets**-ként (vagy bind-mount `0600`, root-only jogosultsággal); kizárólag a backend konténer kapja meg.
- **Környezetenként külön kulcspár:** a fejlesztői kulcs csak a GitHub dummy-repóhoz, az éles kulcs csak az Azure Repos-hoz érvényes — a fejlesztői környezet kompromittálódása nem érinti az élest.
- Élesben dedikált service account (lásd D3); opcionálisan Azure Key Vault, ha a céges infrastruktúra adja.
- **Rotációs eljárás dokumentálva:** új kulcspár generálása → regisztrálás a remote-nál → konfigcsere → régi kulcs visszavonása. A D12 push-monitoringja a visszavont kulcsot azonnal láthatóvá teszi.

### D14 — Frontend stack: shadcn/ui + Tailwind + Motion *(új)*
A shadcn nem futásidejű függőség, hanem **bemásolt, saját tulajdonú komponenskód** — busz-faktor-1 projektnél előny: nincs breaking upgrade-kényszer, a karbantartás saját kézben van. A Tailwind-elköteleződés vállalt és kimondott. A Motion animációk funkcionális UX-visszajelzésre szolgálnak (mentés, lock-állapot, kommentfolyam-frissülés), nem öncélú effektekre.

### D15 — Tartalom-scope: csak szöveg a repóban; képek alkalmazásszintű statikus assets-ként; export második ütemben *(módosítva a 2. grilling után)*
- A tartalom-repo **kizárólag szöveges .md fájlokat tartalmaz**; képfeltöltés és csatolmány-kezelés nem funkciója a rendszernek.
- **Statikus képek** (`.svg`, `.png`, `.jpeg` — ábrák, guide-ok, felületi design) **az alkalmazás szintjén kezelt assets mappából** jelennek meg; a markdown az alkalmazás saját assets-útvonalára hivatkozik. Javasolt forma: az assets **mountolt volume** (nem az image részeként) — így új kép hozzáadása fájlmásolás, nem rebuild+redeploy.
- **Következmények (vállalva):** kép hozzáadása fejlesztői/üzemeltetői művelet, nem szerzői; a képek nem verziózódnak a tartalommal (csere visszamenőleg minden dokumentumverzióban érvényesül); a repo önmagában a szöveget adja teljes értékűen, a képeket nem (lásd 6. fejezet, vészhelyzeti elérés korlátja).
- **Export** `.pdf` és `.txt` (opcionálisan `.docx`) formátumba: második ütem; szerveroldali konverzióként tervezendő (pl. pandoc), nem kliensoldali trükként.

### D16 — Markdown szerkesztő: @uiw/react-md-editor *(új)*
Könnyű, textarea-alapú szerkesztő élő előnézettel — illik a markdown-fegyelmű, csak-szöveg scope-hoz (D15), nem WYSIWYG-absztrakció.
**Kötelező kiegészítések:**
- **rehype-sanitize** mind a szerkesztő-előnézetben, mind az olvasó nézetben — a nyers HTML átengedése betárolt XSS-t jelentene (200 szerző, mindenki olvas).
- **Képforrás-korlátozás a sanitize-sémában:** kép (`img` / markdown képszintaxis) kizárólag az alkalmazás saját assets-útvonaláról renderelődik; külső URL-ű képhivatkozás nem jelenik meg (privacy-szivárgás — olvasói IP-k kiadása külső szervernek — és megbízhatósági kockázat ellen).
- Az olvasó nézet **ugyanazzal a remark/rehype pipeline-nal** renderel, mint a szerkesztő előnézete — a szerző mentés előtt pontosan azt lássa, amit az olvasó mentés után.
- A piszkozat-őrzés (D7) a szerkesztő körüli saját felelősség, nem a komponensé.

## 4. Adatmodell-vázlat (PostgreSQL)

- `documents` — **stabil `id` (UUID, a rendszer generálja, soha nem változik; a frontmatterben is tárolva)**; út a repóban (attribútum, átnevezéskor/átkategorizáláskor változhat — az id nem!), cím, kategória, státusz, tulajdonos, utolsó commit hash, indexelt tartalom (`tsvector`, magyar konfiguráció + `pg_trgm` a ragozás-tűrő kereséshez)
- `events` — dokumentum (**id-ra hivatkozik, nem útra**), típus (created/edited/status_changed/deleted/restored/renamed), felhasználó, időbélyeg, részletek (JSONB) — *elsődleges adat, mentendő*
- `comments` — dokumentum (id), szerző, tartalom, időbélyeg; rendszerüzenetek az `events`-ből vetítve — *elsődleges adat, mentendő*
- `locks` — dokumentum (id), felhasználó, megszerzés ideje, utolsó heartbeat
- `allowlist` — engedélyezett e-mail címek — *elsődleges adat, mentendő*
- `users` — OIDC-ből érkező identitások gyorsítótára (név, e-mail, avatar)

A frontmatter (YAML a .md fájl elején) hordozza a Gitben is a metaadatokat (**id**, status, owner, iteration, category) — az index ebből épül, így a repo önmagában is teljes értékű, és a dokumentum-identitás átnevezés után is megmarad (URL-ek, kommentek, események nem szakadnak el).

## 5. MVP scope és ütemezés

**MVP (kötelező a demóhoz):**
1. Google OIDC login + e-mail allowlist (kérésenkénti ellenőrzéssel)
2. Dokumentum CRUD webes markdown szerkesztővel (react-md-editor; mentés = commit a worker queue-n át)
3. Verziótörténet nézet + korábbi verzió visszaállítása (lokális clone-ból)
4. Teljes szövegű keresés (magyar konfig) + kategória/státusz szűrés
5. Lock heartbeat-tel
6. Eseménynaplózás + kommentfolyam rendszerüzenetekkel
7. Reindex parancs + automatizált konzisztencia-ellenőrzés (D4)
8. Archívum + visszaállítás felület
9. Postgres backup (ütemezett pg_dump) — üzemeltetési MVP-elem, nem halasztható

**Második ütem:** diff-nézet két verzió között, lock-átvétel, allowlist-karbantartó felület, státusz-riportok, export (.pdf/.txt/.docx).

**Jövőbeli munka (szakdolgozatban fejezetként):** Microsoft Entra ID integráció (App Registration, csoport-claimek), Azure Repos-ra állás (mirror push + konfigcsere), céges domain + TLS, esetleges olvasó-tükör.

## 6. Ismert korlátok, vállalt kockázatok

- A státusz-workflow nem kikényszerített (D6) — szervezeti fegyelemre épül, az audit-nyom a védvonal.
- **Az audit megbízhatósági gyökere az alkalmazás-backend:** a commitokat a backend készíti a rendszer-kulccsal, a commit author mező általa írt metaadat, kriptográfiai kötés nélkül. Az auditnyom hitelessége az alkalmazás integritásán áll — belső rendszernél vállalt kockázat, kimondva.
- Az átláthatóság az írást fedi, az olvasást nem; a teljes olvasási nyitottság tartalompolitikai korlátot jelent (D6).
- **Commit-identitás és adatvédelem:** a felhasználó neve/e-mailje a Git-történetben megváltoztathatatlanul megmarad, kilépő munkavállaló esetén is. Jogalapja a munkaköri tevékenység dokumentálása (jogos érdek); a szakdolgozat adatkezelési fejezetében rögzítendő.
- **A vészhelyzeti elérés (D10: clone + Obsidian) a szöveget adja, a képeket nem:** a képek az alkalmazás assets-ében élnek (D15), így a repo önálló olvasásakor a képhivatkozások törötten jelennek meg. A tudás szöveges lényege elérhető marad — a korlát vállalt és a belső oktatásban kimondandó.
- A magyar full-text keresés stemmer-minősége korlátos; a `pg_trgm` kombináció enyhíti, szemantikus keresés (pgvector) későbbi opció.
- Valós idejű közös szerkesztés (Google Docs-élmény) tudatosan nincs — a lock-modell zárja ki az ütközést.
- Egyszemélyes fejlesztés és üzemeltetés a bevezetésig: busz-faktor 1; a dokumentáció és az átadási terv ezért a projekt része.

## 7. Nyitott kérdések

- **NY1 — Statikus képek bekerülési útja: LEZÁRVA (2. grilling).** A képek nem a tartalom-repóban, hanem az alkalmazás szintjén kezelt assets mappában élnek (javasoltan mountolt volume); feltöltési funkció nincs, hozzáadásuk fejlesztői/üzemeltetői művelet. Részletek: D15.
- **NY2 — Azure Repos branch policy:** ha a céges DevOps-szabályzat kötelező PR-review-t ír elő a main branchre, az a „mentés = commit main-re" modellt ellehetetleníti. **A DevOps-adminnal egyeztetendő MOST, nem éles bevezetéskor** — szükség esetén a tudásbázis-repo policy-kivételt kap (a service account bypass jogot).
- **NY3 — Allowlist-karbantartás módja:** felület vs. konfig (korábbról nyitott; második ütem).
