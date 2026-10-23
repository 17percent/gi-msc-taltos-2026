---
tags:
  - taltos/egyseg
allapot: döntve
---

# Többformátumú tartalom és verziókövetés

## Cél

A tudásbázis a markdown mellett más formátumú tudásanyagot is tároljon és verziózzon:

- generált **HTML-riportok** és interaktív HTML-oldalak (projektdokumentáció vizualizálása),
- **`.skill` csomagok** (ZIP: `SKILL.md`, Python-szkriptek, segédfájlok),
- **PDF**-dokumentumok,
- **Excel**-táblázatok (`.xlsx`),
- önálló **`.md`** fájlok (feltöltésként, a szerkesztett markdown-dokumentumok mellett).

A [[Dokumentumok/Verziózás|Verziózás]] mindhárom képessége (történet, összehasonlítás, visszaállítás) minden formátumra működjön. A felület minden formátumot a saját megjelenítőjével és diff-nézetével mutasson.

> [!success] Döntve — D42 (Döntési napló v10, 2026-10-23), második ütem
> Felülírja a D15 „csatolmány-kezelés nem funkció” mondatát a fenti formátumokra. A megvalósítás a második ütemben; az adatmodell már most így készül.

## Javasolt megoldás

### 1. Alapelv: a revíziók nem módosíthatók, a tartalom hash alapján egyszer tárolódik

A meglévő modell (D1: `document_revisions`, teljes pillanatkép mentésenként, delta nélkül) megmarad. Két dolog változik:

1. **A tartalom egy SHA-256 hash alapján címzett `blobs` táblába kerül.** Azonos tartalom csak egyszer tárolódik: ha egy revízióban egy fájl nem változik, az új revízió ugyanarra a blobra hivatkozik.
2. **Egy revízió több fájlból is állhat.** Ilyenkor egy fájllista (manifest) tartozik hozzá, a Git fájlfájához hasonlóan. Ez a `.skill` csomagokhoz kell.

A **formátum** (`documents.format`) és a **fajta** (D34: `documents.kind`) két külön tengely. A fajta azt mondja meg, *mi* a dokumentum (prompt, skill, agent-definíció …). A formátum azt, *hogyan* tárolódik és jelenik meg. Például egy `kind = skill` dokumentum lehet egyetlen markdown is, és lehet `.skill` csomag is.

| `documents.format` | Szerkesztés | Új revízió keletkezése |
|---|---|---|
| `markdown` | élő, közös szerkesztés (D29, változatlan) | checkpoint (D29) |
| `html_report` | nincs, csak feltöltés | új fájl feltöltése |
| `skill_bundle` | feltöltés; a benne lévő `.md` és `.py` fájlok egyszemélyes CodeMirror-szerkesztővel módosíthatók (D42) | új csomag feltöltése vagy fájlmentés → Piszkozat → review (D45) |
| `pdf` | nincs, csak feltöltés | új fájl feltöltése |
| `xlsx` | nincs, csak feltöltés | új fájl feltöltése |
| `md_file` | feltöltés; átalakítható `markdown` dokumentummá („Létrehozás forrásból”, D17) | új fájl feltöltése |

### 2. Adatmodell-kiegészítés

```sql
-- Tartalom-címzett tároló: SHA-256 → bájtok
CREATE TABLE blobs (
  sha256      bytea PRIMARY KEY,           -- 32 bájt
  size_bytes  bigint      NOT NULL,
  mime_type   text        NOT NULL,        -- tartalom alapján ellenőrizve, nem a kiterjesztésből
  data        bytea       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- A PDF, az XLSX és a ZIP eleve tömörített; a TOAST újratömörítése csak CPU-t visz
ALTER TABLE blobs ALTER COLUMN data SET STORAGE EXTERNAL;

-- documents: új oszlopok
ALTER TABLE documents
  ADD COLUMN format      text NOT NULL DEFAULT 'markdown',
  ADD COLUMN search_text text;               -- kinyert szöveg (lásd 4. pont)

-- document_revisions: a revízió fájllistája
-- markdown esetén üres: a szöveg a meglévő content oszlopban marad
CREATE TABLE revision_files (
  revision_id uuid  NOT NULL REFERENCES document_revisions(id),
  path        text  NOT NULL,                -- 'SKILL.md', 'scripts/extract.py', vagy egyfájlos esetben a fájlnév
  blob_sha256 bytea NOT NULL REFERENCES blobs(sha256),
  PRIMARY KEY (revision_id, path)
);

-- Feltöltéskor kinyert, újragenerálható adat (nem elsődleges, nem kell menteni)
CREATE TABLE blob_derivatives (
  blob_sha256 bytea NOT NULL REFERENCES blobs(sha256),
  kind        text  NOT NULL,                -- 'text' | 'pages' | 'cells' | 'normalized_html' | 'snapshot_png'
  extractor   text  NOT NULL,                -- eszköz + verzió, pl. 'pdfjs@4.x'
  content     jsonb,
  preview     bytea,                         -- pl. oldalkép, képernyőkép
  PRIMARY KEY (blob_sha256, kind)
);
```

**Miért maradhat Postgresben (D1 „egy igazságforrás” elve):**

- A várható méret kicsi: riportok, skill-csomagok és szakmai PDF-ek, jellemzően néhány MB vagy kevesebb.
- A deduplikáció miatt egy változatlan fájl új revíziója nem foglal több helyet.
- A mentés továbbra is egyetlen ACID-tranzakció ([[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]]): egy blob, egy revízió és egy esemény vagy együtt jön létre, vagy egyik sem.
- A [[Üzemeltetés/Backup|Backup]] továbbra is egyetlen `pg_dump`.

**Javasolt korlát:** fájlonként **25 MB**, és a `.skill` csomag kicsomagolva is legfeljebb 25 MB. E fölött a dokumentum nem tölthető fel. Ha a pilot ([[Értékelés/Pilot-terv|Pilot-terv]]) ennél nagyobb igényt mutat, a `blobs.data` helyére object storage-hivatkozás kerülhet (`storage_uri`, MinIO), a séma többi része nem változik.

### 3. A `.skill` csomag kezelése

Feltöltéskor a csomag **kibontva tárolódik**: minden benne lévő fájl külön blob, a `revision_files` sorai adják a fájlfát. Letöltéskor a backend a fájlfából újra összeállítja a ZIP-et.

Ennek előnyei:

- Ha egy 20 fájlos csomagban egy `.py` változik, csak egy új blob jön létre.
- Két revízió fájlszintű különbsége egyetlen lekérdezés:

```sql
SELECT coalesce(a.path, b.path) AS path,
       CASE WHEN a.path IS NULL THEN 'added'
            WHEN b.path IS NULL THEN 'removed'
            WHEN a.blob_sha256 <> b.blob_sha256 THEN 'modified'
            ELSE 'unchanged' END AS change
FROM (SELECT * FROM revision_files WHERE revision_id = $old) a
FULL JOIN (SELECT * FROM revision_files WHERE revision_id = $new) b USING (path);
```

A módosult fájlokra ezután a formátumuknak megfelelő diff fut (lásd 5. pont). Egy `.py` vagy `.md` fájl például soronkénti szövegdiffet kap.

**Ellenőrzés kibontáskor:**

- Zip slip ellen: tilos az abszolút útvonal és a `..` szegmens.
- Zip bomb ellen: korlátozott a kibontott méret, a fájlszám és a tömörítési arány.
- Kötelező a `SKILL.md` a gyökérben, és érvényes frontmatterrel kell rendelkeznie.

### 4. Kinyerés és keresés

Feltöltéskor egy formátumfüggő **kinyerő** (`extract`) fut. Az eredménye a `blob_derivatives` táblába kerül, és ebből töltődik a `documents.search_text`, így a [[Adattárolás/Keresőindex|Keresőindex]] (D4) nem markdown dokumentumokban is keres. Ehhez a `search_vector` generált oszlop képletét ki kell bővíteni: `content` helyett `coalesce(content, search_text)`.

A kinyerés a mentéssel azonos tranzakcióban, szinkron fut. A 25 MB-os korlát mellett ez másodperces nagyságrendű, ezért nem kell hozzá worker queue (D22 érvényben marad). A képernyőképek (lásd HTML) kivételek: ezek mentés után, cron-szerűen vagy első megnyitáskor készülnek, mert hiányuk nem okoz inkonzisztenciát.

### 5. Formátumonkénti kezelés: kezelő-registry

A backendben (TypeScript, D22) minden formátumhoz egy kezelő tartozik egységes interfésszel. A frontendben ugyanígy tartozik hozzá egy megjelenítő és egy diff-komponens.

```ts
interface FormatHandler {
  format: DocumentFormat;
  accepts(mime: string, filename: string): boolean;
  validate(bytes: Buffer): Promise<void>;                 // méret, MIME, biztonság
  extract(bytes: Buffer): Promise<Derivative[]>;          // keresés, diff alapja
  diff(oldRev: RevisionRef, newRev: RevisionRef): Promise<DiffResult>;
}
```

| Formátum | Kinyerés | Diff | Megjelenítés a felületen |
|---|---|---|---|
| **markdown / md_file** | – (maga a szöveg) | soronkénti szövegdiff (jsdiff), a D21 meglévő diff-nézete | olvasó nézet, `rehype-sanitize` (D16) |
| **html_report** | normalizált HTML (formázás, generálási időbélyegek és véletlen id-k kiszűrése); látható szöveg; képernyőkép (Playwright) | (1) **szöveges** diff a normalizált HTML-en vagy a látható szövegen; (2) **vizuális** diff: két képernyőkép különbségképe (pixelmatch) | izolált `iframe` (lásd Biztonság), fülváltó: Előnézet · Forrás · Vizuális diff |
| **skill_bundle** | fájlfa; a `SKILL.md` frontmatterje (név, leírás) metaadatként | fájlfa-diff (fenti SQL), majd fájlonként a típusnak megfelelő diff | fájlfa + fájlnézet szintaxiskiemeléssel; ZIP-letöltés |
| **pdf** | oldalankénti szöveg (pdf.js), oldalképek | oldalankénti szövegdiff; ahol a szöveg változott, oldalkép-összevetés | PDF-néző, a változott oldalak jelölésével |
| **xlsx** | cellaszintű JSON: `{sheet, cell, value, formula, type}` (ExcelJS vagy SheetJS) | cellaszintű diff: új vagy törölt munkalap, érték- és képletváltozás | táblázatnézet, színezett cellák; munkalapváltó |

A diff mindig **lekérdezéskor számolódik** a két revízió kinyert adataiból. Tárolt delta nincs, ahogy a [[Adattárolás/Revíziók tárolása|Revíziók tárolása]] eddig is döntötte. Ha egy diff lassúnak bizonyul (nagy Excel), egy `diff_cache (old_rev, new_rev, result)` tábla gyorsítótárként bevezethető.

### 6. Nyomon követés és visszaállítás

> [!note] 2026-10-23
> Az új feltöltés, az új verzió és a fájl törlése is a két review-eres folyamaton megy át ([[Dokumentumok/Státusz-workflow|Státusz-workflow]]). A feltöltés egy függő `change_requests` sort hoz létre, és csak a két jóváhagyás után válik a dokumentum Jóváhagyott változatává. A blobok a feltöltéskor tárolódnak, elutasításkor a retenció szerint takarítódnak.

- **Feltöltés**: egy tranzakcióban jön létre az új `document_revisions` sor (szerző, idő, opcionális üzenet), a `revision_files` sorok, a hiányzó blobok és az `edited` esemény ([[Nyomonkövetés/Eseménynapló|Eseménynapló]]). Új eseményrészlet: `{format, files_added, files_removed, files_modified}`.
- **Visszaállítás**: ugyanúgy működik, mint ma. A régi revízió fájllistája új revízióként másolódik, `restored_from_revision_id`-vel. Új blob nem keletkezik, mert a régi blobok megvannak.
- **Egyidejű feltöltés**: a feltöltési végpont a D26 szerinti `baseRevisionId`-t kéri. Ha közben valaki más feltöltött, a válasz 412, és a felület megmutatja a két változat különbségét.
- **Jóváhagyott dokumentum**: új feltöltés után Review-ra vár; a legutóbbi Jóváhagyott változat az `approved_revision_id`-n át elérhető marad.

### 7. Biztonság

- **HTML-riport**: a riport saját JavaScriptje csak úgy futhat, hogy ne érje el a tudásbázis munkamenetét (betárolt XSS, D16). Ezért a riport
  - külön originről jön (pl. `reports.<domain>`, cookie nélkül),
  - `<iframe sandbox="allow-scripts">`-ben jelenik meg, `allow-same-origin` nélkül,
  - szigorú CSP-vel fut, külső hálózati hívás nélkül (`connect-src 'none'`).
- **MIME-ellenőrzés** tartalom alapján (magic bytes). Tiltott a makrós Office-fájl (`.xlsm`) és a futtatható tartalom.
- **A skill-szkriptek soha nem futnak a szerveren.** A rendszer csak tárol, megjelenít és diffel.
- A PDF a kliensen pdf.js-sel renderelődik, a beágyazott JavaScript nem fut.

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]:

- **D15**: felülírandó (csatolmány-kezelés, Postgres-blobok).
- **D1**: megmarad, a blobok is Postgresben élnek.
- **D4**: a `search_vector` a `search_text`-re is kiterjed.
- **D21**: a diff-nézet formátumonként bővül.
- **D22**: nincs worker queue.
- **D26**: új feltöltési végpont, `baseRevisionId`-vel.
- **D29**: a közös szerkesztés csak `markdown` formátumra vonatkozik.
- **D34**: a `kind` és a `format` két külön tengely.

Rögzítve: **D42 — Többformátumú tartalom: tartalom-címzett blobok Postgresben, formátumonkénti kezelő-registry.**

## Nyitott kérdések

- ~~Méretkorlát?~~ **Döntve (D42):** 25 MB fájlonként, Postgresben; object storage csak ha a pilot indokolja. A tárhely-becslés a dolgozatba kerül.
- ~~Skill-fájlok szerkesztése?~~ **Döntve (D42):** igen, egyszemélyes szerkesztővel; a mentés piszkozat-revízió, review-val.
- ~~HTML-riport forrása?~~ **Döntve (D42):** csak a generált kimenet tárolódik.
- ~~Excel-diff mélysége?~~ **Döntve (D42):** cellaszintű; sorillesztés később.
- ~~Export?~~ **Döntve (D42):** az eredeti fájl letöltése.
- ~~MCP?~~ **Döntve (D42):** a kinyert szöveg + letöltési link.
- ~~Retenció?~~ **Döntve (D48):** a hivatkozás nélküli blobok 1 év után törlődnek.
- ~~MVP vagy második ütem?~~ **Döntve (D42):** második ütem.

## Kapcsolódó egységek

[[Adattárolás/Adatmodell|Adatmodell]] · [[Adattárolás/Revíziók tárolása|Revíziók tárolása]] · [[Adattárolás/Keresőindex|Keresőindex]] · [[Adattárolás/Tranzakciós mentés|Tranzakciós mentés]] · [[Dokumentumok/Verziózás|Verziózás]] · [[Kimenet/Export|Export]] · [[Üzemeltetés/Backup|Backup]]
