---
tags:
  - taltos/elemzes
datum: 2026-10-19
---

# Versenytárs-elemzés

Mit veszünk át a Confluence, a SharePoint, az Outline és a BookStack működéséből, és melyik gyengeségükre ad választ a Táltos. Kiindulás: a 2026. októberi platform-összehasonlító riport (*Kollaboratív dokumentumkezelő platformok összehasonlítása*).

> [!note] Keretezés
> A riport általános IT-tudásbázist vizsgál. A Táltos korpusza **AI-eszközökből** áll (promptok, skillek, agent-definíciók, MCP-szerverek), a fő felhasználás a kimásolás ([[Kimenet/Vágólap és letöltés|Vágólap és letöltés]]). Ezért az Office-, intranet- és bővítmény-szempontok nem relevánsak, az AI-elérés és a tartalom frissessége viszont felértékelődik.

## Átvett minták

| Minta | Forrás | Táltos-egység | Állapot |
|---|---|---|---|
| Munkacsoportos terek | Confluence Space | [[Kollaboráció/Színterek\|Színterek]] | 💡 |
| Valós idejű közös szerkesztés, Markdown | Outline | [[Kollaboráció/Valós idejű közös szerkesztés\|Valós idejű közös szerkesztés]] | 💡 |
| Jóváhagyási lépés | SharePoint | [[Dokumentumok/Státusz-workflow\|Státusz-workflow]] + [[Felhasználók/Jogosultságok\|Jogosultságok]] | 💡 |
| Önhosztolás, egyszerű üzemeltetés | BookStack | [[Adattárolás/Adatmodell\|Adatmodell]] (Postgres-only) | ✅ |
| Hordozhatóság, export | BookStack | [[Kimenet/Vágólap és letöltés\|Vágólap és letöltés]], [[Üzemeltetés/Vészhelyzeti tükör\|Vészhelyzeti tükör]] | ✅ / ❓ |
| Backlinkek | Outline | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] | 💡 |
| API + MCP az AI-asszisztenseknek | Outline | [[Kimenet/MCP és API\|MCP és API]] | 💡 második ütem (döntve) |

## Gyengeségek és a Táltos válasza

| Gyengeség | Platform | Táltos-válasz |
|---|---|---|
| Szerkezeti rendezetlenség, elavult és duplikált oldalak | Confluence | [[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]] (szerző által megadott esedékesség + értesítés), „helyettesíti” kapcsolat |
| Beszállítófüggőség (makrók, bővítmények) | Confluence | Sima Markdown a forrás, a frontmatter csak kimeneti formátum |
| Jogosultsági burjánzás, egyedi megosztások | SharePoint | Egy dokumentum = egy színtér, nincs dokumentumszintű ACL, az olvasás mindig nyitott |
| Összetett információarchitektúra | SharePoint | Lapos kategóriák + Élő Atlasz |
| Kevés formalizált workflow | Outline | Négylépcsős státusz, négy szem elve |
| BSL-licenc, Community-korlátok | Outline | Saját fejlesztés, nincs licencréteg |
| Nincs valós idejű együttszerkesztés | BookStack | Yjs + Hocuspocus |
| Merev hierarchia, nem öröklődő polcjogok | BookStack | Nincs hierarchia, a jog a színtérből jön |
| Egyszerű keresés | BookStack | `tsvector` (magyar) + `pg_trgm` |
| Az AI-válasz jogosultság-érvényesítése | mind | Nyitott olvasás mellett kisebb kockázat; az MCP csak publikált tartalmat ad |

## Szándékosan nem vesszük át

Office-dokumentumtár, intranet- és hírfunkciók, bővítmény-ökoszisztéma, whiteboardok, oldalszintű egyedi jogosultságok, könyv–fejezet–oldal hierarchia, **típusos metaadatok** (SharePoint content type-ok).

## Döntések (2026-10-19)

| # | Kérdés | Döntés | Érintett egység |
|---|---|---|---|
| V1 | MCP/API-réteg | **Második ütem.** Most terv és D-pont, csak olvasás, csak `publikált` dokumentumok. | [[Kimenet/MCP és API\|MCP és API]] |
| V2 | Elavulás kezelése | **A szerzők értesítése a felülvizsgálat esedékességéről** (alkalmazáson belül + e-mail). | [[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]], [[Nyomonkövetés/Értesítések\|Értesítések]] |
| V3 | Az esedékesség forrása | **A szerző adja meg** publikáláskor. | [[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]] |
| V4 | Az értesítés címzettjei | **Tulajdonos + közreműködők** (az utolsó publikált revízió `contributors` listája). | [[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]] |
| V5 | Metaadat-modell | **Marad a lapos címke** (D19), típusos mezők nincsenek. | [[Dokumentumok/Címkék\|Címkék]] |
| V6 | Publikált dokumentum szerkesztése | **Visszaesik `draft`-ba** az első módosításkor. | [[Dokumentumok/Státusz-workflow\|Státusz-workflow]], [[Kollaboráció/Valós idejű közös szerkesztés\|Valós idejű közös szerkesztés]] |
| V7 | Mit lát közben az olvasó | **Az élő tartalmat, draft jelvénnyel.** A dokumentum az újrapublikálásig kikerül a „publikált” szűrőből és az MCP-ből. | ugyanazok |

| V8 | Kötelező-e a határidő | **Kötelező, 12 hónapos alapértékkel**, üresen nem hagyható. | [[Dokumentumok/Felülvizsgálat\|Felülvizsgálat]] |
| V9 | Értesítés időzítése | **7 nappal előtte + esedékességkor.** | ugyanaz |
| V10 | Ha senki nem reagál | **Heti emlékeztető** a tulajdonosnak és a közreműködőknek, a jelvény megmarad. Nincs eszkaláció. | ugyanaz |
| V11 | Ki erősítheti meg a „Még aktuális” állapotot | **Szerző jog a színtérben**, jóváhagyás nélkül. | ugyanaz, [[Felhasználók/Jogosultságok\|Jogosultságok]] |
| V12 | Gazdátlan dokumentumok | **Nem fordulhatnak elő.** Kötelező tulajdonos a szerkesztők közül; allowlistről törlés csak átadás után; az allowlist nem csökkenhet nullára. | [[Felhasználók/Allowlist\|Allowlist]], [[Felhasználók/Jogosultságok\|Jogosultságok]] |
| V13 | Duplikátum-figyelmeztetés | **Igen, cím + tartalom** alapján, létrehozáskor; nem tilt. | [[Szerkesztés/Létrehozás forrásból\|Létrehozás forrásból]] |
| V14 | Keresési rangsor | **Relevancia + frissesség.** A státusz nem rangsorol, arra szűrni lehet. | [[Felfedezés/Keresés\|Keresés]] |
| V15 | Keresés a kommentekben | **Nem**, csak cím + tartalom. | [[Felfedezés/Keresés\|Keresés]] |
| V16 | @említés kommentben | **Igen, értesítéssel** (alkalmazáson belül + e-mail). | [[Kollaboráció/Kommentek\|Kommentek]], [[Nyomonkövetés/Értesítések\|Értesítések]] |
| V17 | Válaszszálak | **Nincsenek**, marad a lapos folyam. | [[Kollaboráció/Kommentek\|Kommentek]] |
| V18 | „Megoldott” lezárás | **Nincs.** | [[Kollaboráció/Kommentek\|Kommentek]] |
| V19 | Szövegrészhez kötött komment | **Második ütem**, a Yjs-alapú közös szerkesztés után. | [[Kollaboráció/Kommentek\|Kommentek]] |
| V20 | Értesítés komment szerkesztésekor | **Minden említett újra** értesítést kap. | [[Kollaboráció/Kommentek\|Kommentek]] |
| V21 | Kit lehet említeni | **Bárkit az allowlistről.** | [[Kollaboráció/Kommentek\|Kommentek]] |
| V22 | Review-visszajelzések követése | **Elutasítás kötelező indoklással**, kiemelt rendszerüzenetként. | [[Dokumentumok/Státusz-workflow\|Státusz-workflow]] |
| V22a | Zajvédelem komment-szerkesztésnél | **Összevonás 10 percen belül.** | [[Kollaboráció/Kommentek\|Kommentek]] |
| V23 | Címkekészlet | **Csak globális**, minden színtér osztozik rajta. | [[Dokumentumok/Címkék\|Címkék]] |
| V24 | Kategória → **címke** | Nincs külön létrehozás; a dokumentumnál listából vagy szabad kézzel adható meg, szabad kézi megadásnál a meglévő hasonló címkét kínáljuk fel. | [[Dokumentumok/Címkék\|Címkék]] |
| V25 | Színterek az Atlaszon | **Közös térkép, színtér-szűrővel**; az aktuális színtér kiemelve. | [[Felfedezés/Élő Atlasz\|Élő Atlasz]] |
| V26 | Áthelyezés színterek között | **Nincs, csak duplikálás** (`származik` kapcsolattal). | [[Kollaboráció/Színterek\|Színterek]] |
| V27 | A dokumentum fajtája | **Külön, rögzített, kötelező `kind` mező**; a címke a témát jelöli. | [[Dokumentumok/Címkék\|Címkék]] |
| V28 | Atlasz-szín | **A színtér színe**, felhasználónként egyénileg átszínezhető; **nincs színátmenet.** | [[Felfedezés/Élő Atlasz\|Élő Atlasz]], [[Kollaboráció/Színterek\|Színterek]] |
| V29 | Címkék utólagos összevonása | **Senki**, a védelem a beíráskori felajánlás. | [[Dokumentumok/Címkék\|Címkék]] |
| V30 | Árva címkék | **Rejtve maradnak**, a rekord megmarad. | [[Dokumentumok/Címkék\|Címkék]] |
| V31 | Egyéni színválasztás | **Szabad színválasztó, kontraszt-figyelmeztetéssel.** | [[Felfedezés/Élő Atlasz\|Élő Atlasz]] |
| V32 | Több színtér, mint szín | **Ismétlődhetnek**, a szűrő és a kiemelés segít. | [[Felfedezés/Élő Atlasz\|Élő Atlasz]] |
| V33 | Seed-migráció | **Kategória → `kind`**, plusz generált 1–3 témacímke dokumentumonként. | [[Dokumentumok/Címkék\|Címkék]] |
| V34 | Címke-felajánlás küszöbe | **Normalizált egyezés + trigram ≥ 0,4, max. 3 javaslat.** | [[Dokumentumok/Címkék\|Címkék]] |
| V35 | Ki adhat kézi kapcsolatot | **A forrás színterének Szerzője.** | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V36 | `helyettesíti` más színtérben | **Beleegyezés nélkül**, a cél tulajdonosa értesítést kap és törölhet. | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V37 | Hivatkozás-szintaxis | ~~`[[` gépelésre kereső~~ → **felülírva: V41**; a `[cím](doc:uuid)` belső tárolás marad. | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V38 | Kapcsolatok ütemezése | **MVP-levélcsomag**, az e-mail után esik ki. | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V39 | Kapcsolatok az Atlaszon | **Rugóként, egységes erővel.** | [[Felfedezés/Élő Atlasz\|Élő Atlasz]] |
| V40 | Szerkesztőmodell | **CodeMirror 6 élő előnézettel** (Obsidian-modell), az osztott nézet megszűnik. | [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] |
| V41 | Beszúrás és formázás | **Helyi menü jobb kattintásra** minden lehetőséggel; a V37 `[[`-szintaxisa elvetve. | [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] |
| V42 | Kapcsolatok a frontmatterben | **Tulajdonság-panel**, frontmatter csak kimenetben; az igazság a DB. | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V43 | Beszúrt kapcsolat helye | **Szövegbe linkként + a Tulajdonságok közé típussal.** | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V44 | Forrásnézet | **Kapcsolóval elérhető**, alapból élő nézet. | [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] |
| V45 | Táblázatszerkesztés | **Cellánként, helyben.** | [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] |
| V46 | Formázósáv | **Lebegő sáv kijelöléskor.** | [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] |
| V47 | Érintőképernyő | **Hosszú nyomás + formázósáv.** | [[Szerkesztés/Markdown szerkesztő\|Markdown szerkesztő]] |
| V48 | Link törlése | **A kapcsolat is megszűnik**, minden típusnál (link = kapcsolat). | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V49 | Felvétel a panelen | **Igen**, a „Kapcsolódó dokumentumok” szakaszba kerül. | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V50 | A cél tulajdonosa és a `helyettesíti` | **Törölheti**, a forrás szövegéből is (rendszer-revízió, kivétel a D31 alól). | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V51 | Archivált cél | **Halványan, „archivált” jelöléssel.** | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V52 | Kontrasztküszöb | **WCAG 3:1.** | [[Felfedezés/Élő Atlasz\|Élő Atlasz]] |
| V53 | V50 és a draftba esés | **Publikált marad**, szűk kivétel a V6 alól. | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V54 | Több link ugyanarra a célra | **Linkenként külön kapcsolat.** | [[Dokumentumok/Kapcsolatok\|Kapcsolatok]] |
| V55 | Pilot-viszonyítás | **A jelenlegi gyakorlat: Confluence vagy SharePoint.** | [[Értékelés/Pilot-terv\|Pilot-terv]] |
| V56 | Résztvevők | **8–12 fő, legalább 3 csapatból.** | [[Értékelés/Pilot-terv\|Pilot-terv]] |
| V57 | Mérőszámok | **Megtalálás, dokumentumkészítés, SUS, adminisztráció.** | [[Értékelés/Pilot-terv\|Pilot-terv]] |
| V58 | Forma | **Moderált session + 2 hetes használat.** | [[Értékelés/Pilot-terv\|Pilot-terv]] |
| V59 | Környezet | **Fejlesztői környezet, dummy tartalom.** | [[Értékelés/Pilot-terv\|Pilot-terv]] |
| V60 | Kiértékelés | **Csak leíró eredmények.** | [[Értékelés/Pilot-terv\|Pilot-terv]] |

**Átvezetve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-be (2026-10-19):**

| D-pont | V-pontok |
|---|---|
| D29 Valós idejű közös szerkesztés | V6, V7 |
| D30 Színterek | V25, V26 |
| D31 Jogosultságok | V12 |
| D32 Státusz-workflow jóváhagyással | V6, V22 |
| D33 Felülvizsgálat | V2–V4, V8–V11 |
| D34 Címkék és fajta | V5, V23, V24, V27, V29, V30, V33, V34 |
| D35 Értesítések, @említés, kommentfolyam | V16–V21, V22a |
| D36 Keresés | V13–V15 |
| D37 Atlasz-színezés | V28, V31, V32 |
| D38 MCP és API | V1 |
| D39 Kapcsolatok | V35–V39, V42, V43, V48–V51, V53, V54 |
| D40 Szerkesztési élmény | V40, V41, V44–V47 |
| D37 kiegészítés | V52 |
| D41 Értékelési módszertan | V55–V60 |

### Tudatosan vállalt következmények

- **V6 + V7:** egy publikált prompt kisebb javítás közben is elveszíti a publikált státuszát, és újra jóváhagyás kell hozzá. A tartalom végig látható, de a stabil változat csak a [[Dokumentumok/Verziózás|Verziók]] fülön érhető el.
- **V7 + V1:** egy szerkesztés alatt álló dokumentum az MCP-ből is eltűnik az újrapublikálásig.
- **V3 + V8:** a határidőt a szerző választja, de a kötelező alapérték miatt minden publikált dokumentum egyszer esedékessé válik.
- **V10 + V12:** eszkaláció nincs, de gazdátlan dokumentum sem lehet, így minden emlékeztetőnek van címzettje. Az ár: a kilépő munkatárs törlése az allowlistről átadási lépést igényel.
- **V14:** egy elavult, de frissen kommentelt dokumentum nem kerül előre, mert a frissességet a revízió és a megerősítés adja, nem a komment. A publikált és a draft dokumentum azonos súllyal versenyez.
- **V17 + V18:** a Confluence és az Outline szálas, lezárható kommentjeit nem vesszük át. Ez egyszerűbb adatmodellt ad, de a review-visszajelzések nyitott/lezárt állapota nem látszik; ezt részben a V22 kötelező elutasítási indoklása pótolja, később a V19 inline kommentjei.
- **V20:** egy kommentben szereplő elírás javítása is újra értesít minden említettet; ez zajt okozhat (lásd a [[Kollaboráció/Kommentek|Kommentek]] nyitott kérdését).
- **V24:** a D19 „használatban lévő címke védett” szabálya és a Kategóriák nézet elveszti értelmét; a redundancia ellen a beíráskori felajánlás véd. Az Atlasz színe a V28 óta a színtérből jön, a fajta (V27) és a címkék szűrnek.
- **V29:** elírt vagy redundáns címke csak dokumentumonként, szerkesztéssel javítható; tömeges tisztításra nincs eszköz.
- **V28:** az egyéni átszínezés miatt két felhasználó ugyanazt a térképet eltérő színekkel látja; képernyőmegosztásnál vagy oktatásnál ez félreértést okozhat. A V31 szabad választója miatt a rossz kontrasztú színt csak figyelmeztetés jelzi, nem tiltja.
- **V26:** az áthelyezés hiánya miatt egy rossz színtérben létrehozott dokumentum javítása duplikálás + archiválás; a revíziótörténet és a kommentek az eredetinél maradnak.
- **V50:** a színtér-írási határ alól egy kivétel keletkezik: a cél tulajdonosa más színtér dokumentumának szövegét is módosíthatja (csak egy `helyettesíti`-link törlésével). Ezt a jogosultsági tesztekben külön esetként kell kezelni.

## Nyitott témák a következő körre

- ~~Összehasonlító pilot mérőszámai~~ → lezárva: D41, [[Értékelés/Pilot-terv]].
- B4 (DB-séma) és B5 (API-kontraktus) átírása a v9-re.
