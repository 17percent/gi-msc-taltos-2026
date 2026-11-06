---
tags:
  - taltos/egyseg
  - taltos/ux-spec
allapot: jóváhagyva (2026-11-06, a D60 döntéseivel)
mvp: 3
munkacsomag: WP5b
szerzo: ux-ui-designer
datum: 2026-11-06
---

# Létrehozás és duplikálás – felület (WP5b UX-spec)

> [!warning] Javaslat — kód csak jóváhagyás után
> A WP5b (a WP5a backend felülete) UX-specifikációja. A **nyitott kérdések** (14. szakasz) a jóváhagyás előtt dőlnek el. Forrás: D34, D40, D44, D45, D46, D47, D57, D58, D59 (`Arch/tudasbazis-architektura-dontesi-naplo.md`), a B5 kontraktus („Dokumentumok”, „Címkék, fajta, kapcsolatok”, hibakódok), `@taltos/shared` `documents.ts`, a backend `documents/routes.ts` és `tags/routes.ts`, a [[Felhasználók/Adminisztráció és színtér-beállítások|WP4b spec]] (szerkezet, minták), `taltos-design-system.md`.

## Cél

A felhasználó négy dolgot tudjon gyorsan, hibamentesen elvégezni:

1. **Új, üres dokumentumot létrehozni** a megfelelő színtérben, fajtával és címkékkel.
2. **Meglévő dokumentumot duplikálni** (akár másik saját színtérbe), és tudja, *melyik változatból* készül a másolat.
3. **Címkét választani úgy, hogy ne keletkezzen redundáns címke**: választás listából, felajánlás („Ezt kerested?”), és csak tudatos döntéssel új címke.
4. **A soha be nem küldött Piszkozatot eldobni**, és ha nem lehet, megértse, miért.
5. A dokumentumoldalon **első pillantásra lássa**: mi a címe, fajtája, címkéi, és milyen állapotban van.

Hatókörön kívül (nem tervezzük; D21): dokumentumlista és dokumentum-sor menü (WP11), dashboard (WP23), meglévő Piszkozat címkéinek, címének és fajtájának szerkesztése (Tulajdonság-panel, WP6; D59 g), review-ra küldés (WP8), sablonból létrehozás és fájlimport (2. ütem; D47), duplikátum-figyelmeztetés a címnél (a `GET /documents/similar` a WP5a-ban nem készült el, lásd NK4), tulajdonjog-átadás (D55). Ha a felülethez ezek közül kellene valami, az NK-kérdésként szerepel.

## Felhasznált források és előfeltevések

| Mit | Honnan |
|---|---|
| Létrehozás: üres / duplikálás, Piszkozat, első revízió | D45, D47, D59 d; `POST /documents` |
| Duplikálás forrása: a legutóbbi **Jóváhagyott** revízió; ha nincs, az élő állapot; kezdőérték a revízió metaadatából | D58; `DocumentDetail.approvedMetadata` |
| Címkék: globális készlet, láthatóság szerinti szűrés, normalizált pontos egyezés auto-csere, max. 3 javaslat (≥ 0,4), új csak tudatos döntéssel | D34, D58; [[Dokumentumok/Címkék\|Címkék]] V34; `GET/POST /tags` |
| Eldobás: tulajdonos vagy Színtérgazda, soha be nem küldött Piszkozat | D45, D59 e; `DELETE /documents/:id/draft` |
| Zárt színterek, `not_space_member` | D44, B5 A10, `NotSpaceMemberDetails` |
| Jogosultság | [[Felhasználók/Szerepkörök\|Szerepkörök]] mátrix (létrehozás; eldobás ⁶) |
| Állapotok | D45, [[Dokumentumok/Státusz-workflow\|Státusz-workflow]] |

Ellenőrizve a kódban (nem csak a dokumentumban):

- `POST /documents` validáció: cím 1–200 karakter, nem csak szóköz/láthatatlan karakter, NUL tilos; `kind` 1–64 karakter; `tagIds` legfeljebb 50, egyediek; ismeretlen/törölt fajta vagy ismeretlen címke-azonosító → `400 validation_error` **mezőjelölés és stabil alkód nélkül**.
- Nem tag célszíntérre vagy forrásra `403 not_space_member` (a forrás címe nélkül), lezárt célszíntérre `403 space_closed`.
- `POST /tags`: 1–64 karakter; mindkét ágon `200 {id,name}`; a **visszaadott név a már létező címke írásmódja lehet**, nem feltétlenül a beírt (D58).
- `GET /tags?q=`: `{exact, similar}`; a kliens és a szerver ugyanazt a `normalizeTagName`-et használja (`@taltos/shared`).
- A migrációkban a `document_kinds` táblához **nincs seed** (csak `CREATE` és az FK): friss adatbázisban a fajta-lista üres (NK3).
- Nincs a kontraktusban fajta átnevezés/törlés (`GET`/`POST /kinds` csak).

**Nem ellenőriztem:** hogy a WP3 `/collab` szerkesztő egy `document_collab_state` nélküli, frissen létrehozott dokumentumot hibátlanul megnyit-e (a `createDocument` kommentje szerint a kezdő szöveg a `content`-ben van); a `cmdk` `aria-activedescendant` viselkedése a csoportos listában; a `ConfirmDialog`, `RowMenu`, `FormError` komponensek API-ját (csak a létezésüket).

---

## 1. Belépési pontok (lista még nincs)

```
Oldalsáv:   [Színtérváltó]
            [ + Új dokumentum ]          ← elsődleges gomb, az aktuális színtérre
            Kezdőlap · Színtér beállításai · Adminisztráció
Dokumentumoldal (/documents/:id):
            fejléc ... [ Műveletek ⋯ ]   ← Duplikálás · Piszkozat eldobása
```

| Út | Hol indul | Mikor látszik |
|---|---|---|
| **Új dokumentum** | Az oldalsáv tetején, a Színtérváltó alatt, a navigációs elemek **fölött** elsődleges gomb (`Plus` ikon + „Új dokumentum”); mobilon ugyanez a Sheetben. Nem navigációs elem (nincs `aria-current`), hanem művelet. | Ha a felhasználó legalább egy **nem lezárt** színtér tagja (Szerző vagy Színtérgazda). Egyébként elrejtve (a Színtérváltó üres állapota már megmondja a teendőt). |
| **Duplikálás** | A dokumentumoldal fejlécének „Műveletek” menüjében („Duplikálás”, `Copy` ikon). Lista (WP11) után a sor-menü is ide kötődik, ugyanazt a dialógot nyitja. | Ha van legalább egy nem lezárt színtér, amelynek tagja a felhasználó (a forrás színtere lehet lezárt is: onnan olvasni szabad). |
| **Eldobás** | Ugyanott: „Piszkozat eldobása” (3. szakasz). | 7. szakasz mátrixa szerint. |

Indok: a kezdőoldal a WP23-ig helyőrző (D46), ezért az „Új dokumentum” nem lehet a kezdőoldal tartalma; az oldalsáv minden oldalon elérhető (Fitts, 1–2 kattintás), és az aktuális színtér már ott él. Az NK1 alternatívákat ad.

**Létrehozás után:** a böngésző a `/documents/:id` útvonalra navigál (push, így a „vissza” a kiindulóhoz visz); a fókusz az oldal `h1`-ére kerül (WP4b 2.1), és sonner-toast: „Piszkozat létrehozva: „{cím}”.” (duplikálásnál: „A másolat létrejött Piszkozatként: „{cím}”.”). A toast csak megerősítés: az eredmény a fejlécben (Piszkozat jelvény) is látszik.

## 2. Dialógusok

Mindkét dialógus ugyanaz a komponens (`CreateDocumentDialog`, `mode: 'blank' | 'duplicate'`), shadcn **Dialog** (Modal recept), a WP4b dialógjaival egyező viselkedés: kívülre kattintás **nem** zár (véletlen érintés mobilon), Esc és „Mégse” zár; a fókusz megnyitáskor a Cím mezőn; bezáráskor az indító elemre tér vissza (duplikálásnál a menügombra); beküldés közben a „Mégse” és az Esc-zárás letiltott.

### 2.1 Szerkezet

| | Új dokumentum | Duplikálás |
|---|---|---|
| Cím (`h2`) | „Új dokumentum” | „Dokumentum duplikálása” |
| Bevezető sor | `--text-muted`: „Üres Piszkozatként jön létre, te leszel a tulajdonosa.” | Forrásjelzés (2.4) |
| Mezők | Színtér · Cím · Fajta · Címkék | ugyanezek, előtöltve |
| Elsődleges gomb | „Dokumentum létrehozása” | „Másolat létrehozása” |

Lábléc: „Mégse” (körvonal) · elsődleges gomb. Mobilon (< sm) a lábléc gombjai egymás alatt, teljes szélességben; a dialógus belül görgethető, `--space-4` margó.

### 2.2 Mezők

| Mező | Komponens | Kezdőérték (üres / duplikálás) | Szabály és hiba |
|---|---|---|---|
| **Színtér** | shadcn **Select** (a Színtérváltó mintája: színpont + név). Lehetőségek: a felhasználó **nem lezárt** tagsági színterei; a lezártak **tiltott** sorként látszanak lakat ikonnal és „Lezárt” felirattal (hogy értsd, miért hiányoznak). Ha csak egy választható színtér van: nem Select, hanem szöveg („Színtér: {név}”). | az aktuális színtér; ha az lezárt vagy nem tag, az első választható (név szerint). Duplikálásnál is az aktuális (NK5). | Kötelező. Ha az aktuális színtér lezárt: `--text-sm` sor a mező alatt: „A(z) „{név}” lezárt, ezért itt nem hozható létre dokumentum.” |
| **Cím** | Input, `<label>`, `autocomplete=off`; számláló `--text-xs --text-subtle` („0 / 200”) | üres / a **Jóváhagyott** változat címe + „ (másolat)”, szöveg kijelölve a fókuszkor, hogy gépeléssel felülírható (ha nincs `approvedMetadata`: az élő cím) | Kötelező; 1–200 karakter; csak szóköz vagy láthatatlan karakter nem elég. Hiba (küldéskor és blur után): „Add meg a dokumentum címét.” / „A cím legfeljebb 200 karakter lehet.” A hosszú cím **nem csonkolódik csendben**: ha a „ (másolat)” utótag miatt 200 fölé kerülne, a hibaüzenet jelzi, a szerkesztés a felhasználóé. |
| **Fajta** | shadcn **Select** (`KindRef.label` a lista, a `key` az érték) | nincs előválasztva (tudatos döntés, Hick: néhány elem) / a `approvedMetadata.kind`; ha ez már nincs a listában: üres, és a mező alatt „A forrás fajtája már nem választható. Válassz másikat.” | Kötelező. Hiba: „Válassz fajtát.” A fajta egyértékű; a címke a témát jelöli (súgó: „A fajta azt mondja meg, mi ez a dokumentum; a címkék a témáját.”) |
| **Címkék** | `TagPicker` (3. szakasz) | üres / a `approvedMetadata.tags` chipként | Nem kötelező; legfeljebb 50. |

Mezőhiba: a mező alatt `--danger` szöveg **ikonnal**, `aria-invalid` és `aria-describedby`; az első hibás mezőre kerül a fókusz (WP4b minta). Inline validáció csak blur után és küldéskor, gépelés közben nem (nem szidjuk, mielőtt befejezte).

### 2.3 Állapotok

| Állapot | Megjelenés |
|---|---|
| **Betöltés** (a dialógus megnyitásakor `GET /kinds`, `GET /tags`; duplikálásnál ha a forrás részletei még nincsenek meg: `GET /documents/:id`) | A mezők helyén skeleton (Select és Input magasságban), `aria-busy`; az elsődleges gomb letiltott. A Cím mező **nem** tiltott, a gépelt szöveg megmarad. |
| **Fajta-lista üres** (friss rendszer, NK3) | A Fajta mező helyén `Alert` (warning, ikon): „Még nincs felvéve egyetlen fajta sem, ezért nem hozható létre dokumentum.” Rendszeradminisztrátornak + link: „Fajta felvétele az Adminisztrációban” (NK2 szerint); másnak: „Kérd meg a Rendszeradminisztrátort, hogy vegyen fel fajtákat.” Az elsődleges gomb letiltott. |
| **Fajta-lista nem töltődött be** | `Alert` (danger): „A fajták listája nem töltődött be.” + „Újrapróbálás”. Gomb letiltott. |
| **Címkelista nem töltődött be** | Nem blokkol: a TagPicker „kereső módban” működik, lásd 3.4. |
| **Nincs választható színtér** | A dialógus nem nyílhat meg (a belépési pont rejtett); ha mégis (a tagság közben megszűnt): `Alert`: „Jelenleg nincs olyan színtered, ahol dokumentumot hozhatsz létre.” |
| **Folyamatban** | Elsődleges gomb letiltott, felirata „Létrehozás…”, `aria-busy`; kettős küldés tilos. |
| **Hiba (küldéskor)** | `Alert` (danger, `role="alert"`) a lábléc fölött; a dialógus nyitva marad, **minden mező megmarad**; a fókusz a gomb mellett marad (WP4b 2.5). Lásd 6. szakasz. |

### 2.4 Duplikálás: a forrás kimondása

A dialógus tetején, `Alert` (info, `Copy` ikon) — **egy mondat** a lényeg, utána egy rövid kiegészítés:

- Ha van `approvedMetadata`: „A másolat a(z) „{forrás címe}” legutóbbi **Jóváhagyott** változatából (v{iteration}) készül; a cím, a fajta és a címkék is onnan származnak. A Jóváhagyás óta tett, még nem jóváhagyott módosítások nem kerülnek bele.”
- Ha `approvedMetadata` nincs (a forrás még soha nem volt Jóváhagyott): „A(z) „{forrás címe}” még nem volt Jóváhagyott, ezért a másolat az **aktuális, Piszkozat** állapotából készül.”
- Mindkét esetben a kiegészítés: „A másolat új Piszkozat: te leszel a tulajdonosa, és a célszínterében két review-er hagyja jóvá.” (D44, D45)

A forrás színterét a mondat nem nevezi meg (a mező a célszíntér); a forrás címe az, amit a felhasználó már látott. A `approvedMetadata.links` nem jelenik meg és nem szerkeszthető (a `származik` kapcsolat automatikus, D59 c; kapcsolat-felület a WP21-gyel jön). A forrás archivált is lehet (D59 i): a szöveg ugyanaz.

---

## 3. Címkeválasztó (`TagPicker`)

shadcn **Command** (`cmdk`, `shouldFilter={false}`), a lista **a mező alatt, a dialógus folyamában** (WP4b `UserPicker` mintája: nincs portál- és fókuszcsapda-gond, nincs Popover). Recept: DS 6.1 „Kereső-lista”, „Chip”. Nincs új csomag.

### 3.1 Elrendezés

```
Címkék  (nem kötelező)
[ Prompt × ] [ Gyorsindítás × ] [ Ügyfélszolgálat × ]     ← kiválasztott chipek (<ul>)
[ Írd be a címkét…                                  ]     ← combobox
 ┌────────────────────────────────────────────────┐
 │ MEGLÉVŐ CÍMKÉK        (csoportcím)             │
 │  Promptok                                      │
 │ EZT KERESTED?                                  │
 │  Prompt                                        │
 │ ───────────────────────────────────────────── │
 │  + Mégis új címke: „Promtp”                    │
 └────────────────────────────────────────────────┘
Súgó: Legfeljebb 50 címke. Enter: kiválasztás.
```

A chipek a mező **fölött** vannak (DOM-sorrendben is), így Tab-bal elérhetők, és a lista nem tolja el őket. Chip: avatar nélkül, név + „×” ikongomb (`aria-label`: „„{név}” címke törlése”); a név hosszú esetén törik, nem vágódik. A chip-sor `<ul aria-label="Kiválasztott címkék">`; üres: nincs lista.

### 3.2 A viselkedés fő szabályai

1. **Betöltés:** a dialógus megnyitásakor egyszer `GET /tags` (név + darabszám). A **darabszámot a felület nem jeleníti meg** (D58: felhasználónként számolt, nem globális), csak rendezésre használja (gyakoribb elöl).
2. **Lista nyitása:** gépelésre (≥ 1 karakter), ↓ billentyűre vagy az üres mezőre kattintásra. Tab-fókuszra **nem** nyílik (mobilon a billentyűzet ne takarja a mezőket). Üres mezőnél a lista az első 8 (nem kiválasztott) meglévő címkét mutatja, „Meglévő címkék” csoportcím alatt.
3. **Szűrés:** a beírt szöveg `normalizeTagName`-je alapján, két forrásból: (a) a betöltött lista kliensoldali szűrése (tartalmazza; a prefix-egyezés elöl; max. 5 sor, a lista görgethető), (b) rövid késleltetés (250 ms) után, ≥ 2 normalizált karakternél `GET /tags?q=` → `{exact, similar}`.
4. **Pontos egyezés (`exact`) = automatikus csere:** a beírt szöveg nem lesz új címke. A lista első sora a meglévő címke („Meglévő címke” csoport, előkiemelve), Enter ezt választja, a chip a **tárolt** nevet mutatja. Ha a beírt és a tárolt írásmód eltér, a chip-sor alatt `role="status"` sor: „„{beírt}” helyett a meglévő „{tárolt}” címkét adtuk hozzá.” (`--text-sm --text-muted`, a következő műveletig látszik). Ha a címke már ki van választva: „Ez a címke már hozzá van adva.” (nem duplázunk).
5. **Javaslatok (`similar`, legfeljebb 3):** „Ezt kerested?” csoportcím alatt, csak név (darabszám nélkül). Ha vannak javaslatok vagy meglévő találatok, **nincs alapértelmezetten kiemelt sor**: Enter kiemelés nélkül nem hoz létre semmit, hanem a státuszsor mondja: „Válassz a javaslatok közül, vagy a „Mégis új címke” lehetőséget.” (D34: új címke csak a felajánlás utáni tudatos döntésre.) A javaslat választása hozzáadja a meglévő címkét.
6. **Új címke:** a lista legalján, elválasztóval, külön „művelet-sor”: ha van találat/javaslat: „Mégis új címke: „{szöveg}””; ha nincs semmi: „Új címke: „{szöveg}”” (ekkor ez az egyetlen sor, és **alapértelmezetten kiemelt**, Enter létrehozza). Választáskor `POST /tags` `{name}` → a válasz `{id,name}` chip lesz **a visszaadott névvel**. A felület **nem állítja**, hogy új címke jött létre (a szerver csendben a meglévőt is visszaadhatja, D58); a 4. pont státuszsora fedi az eltérő írásmódot.
7. **Kapuzási invariáns:** a „Új címke” sor csak akkor aktív, ha az **aktuális szövegre** a `?q=` keresés sikeresen lezárult. Amíg fut: „Ellenőrizzük, létezik-e hasonló címke…” (`aria-busy`), az „Új címke” sor letiltott. Ha a keresés hibás: „A javaslatok nem töltődtek be.” + „Újrapróbálás”, és az új címke sor letiltott marad (inkább lassú, mint redundáns címke). Ez csak UX: a helyesség a szerveré (a `POST /tags` normalizált ütközésnél a meglévőt adja).
8. **Szöveg-validáció (kliens, a szerverrel egyező):** `displayTagName` után 1–64 karakter; csak láthatatlan/formázó karakter nem elég. Hiba a lista helyén: „A címke legfeljebb 64 karakter lehet.” / „Adj meg legalább egy látható karaktert.” (a hibás szövegnél az „Új címke” sor nem jelenik meg).
9. **Korlát:** 50 címkénél a mező letiltott, súgó: „Elérted a legfeljebb 50 címkét. Törölj egyet, hogy másikat adhass hozzá.”
10. **Zárás/törlés:** az első Esc a listát zárja (és megállítja az Esc továbbterjedését, hogy a dialógus ne záruljon: a `PICKER_OPEN_ATTR` mechanizmus, mint a `UserPicker`-nél), a második a dialógust. Chip törlése után a fókusz a beviteli mezőre kerül.
11. **Fantomcímke:** a `POST /tags` a kiválasztáskor azonnal lefut, a dokumentum létrehozásától függetlenül. Ha a dialógus „Mégse”-vel bezárul, a címke árva marad (V30: rejtve, ugyanaz tér vissza újrabeíráskor). Ezt a felület nem említi; a trade-off az NK7-ben.

### 3.3 Állapotok

| Állapot | Megjelenés |
|---|---|
| Alap (üres, nincs fókusz) | Súgó: „Írj be egy témát, vagy válassz a meglévők közül.” |
| Betöltés (`GET /tags`) | A mező alatt „Címkék betöltése…” (`role="status"`); a gépelés már működik (kereső mód). |
| **Üres rendszer** (nincs címke) | Súgó: „Még nincs címke a rendszerben. Írj be egyet, és ez lesz az első.” (Nem ígér globális számot.) |
| Keresés | Lásd 3.2/7. pont |
| Nincs találat | Csak az „Új címke: „{szöveg}”” sor. |
| Hiba: lista | `GET /tags` hiba: „A meglévő címkék listája nem töltődött be.” + „Újrapróbálás”; a mező a `?q=` kereséssel tovább használható. |
| Hiba: `POST /tags` | A művelet-sor alatt `--danger` szöveg: `validation_error` → „Ezt a címkét nem tudtuk hozzáadni: ellenőrizd a szöveget (1–64 karakter).”; egyéb → általános üzenet + „Újrapróbálás”; a beírt szöveg megmarad. |
| Folyamatban (`POST /tags`) | A művelet-sor „Hozzáadás…”, letiltott, `aria-busy`. |

### 3.4 Billentyűzet és képernyőolvasó

- A mező `role="combobox"`, `aria-expanded`, `aria-controls` (a `listbox`), `aria-activedescendant` (a `cmdk` adja; **a megvalósításnál a csoportos listán ellenőrizendő**). ↓/↑ a sorok között, Enter választ, Esc zár, Home/End a lista elején/végén.
- A csoportok `role="group"` és címkéjük („Meglévő címkék”, „Ezt kerested?”) a csoport nevét adja; a művelet-sor szövege önmagában érthető („Új címke létrehozása: „{szöveg}””).
- Élő régió (`role="status"`, udvarias): találatszám („3 javaslat”), hozzáadás/törlés („„Prompt” hozzáadva. 3 címke kiválasztva.”), a csere-státusz. Nincs színnel jelzett jelentés.
- Érintés: sor magassága `--space-12`; a chip-törlés érintési célja `--space-10`+ (a chip magassága `--space-8`, a gomb körül extra találati terület).
- Minden művelet billentyűzettel is elvégezhető; chip törlése: Tab a „×”-re, Enter/Space.

---

## 4. Dokumentumoldal fejléce (`DocumentHeader`)

A `DocumentPage` a `GET /documents/:id` adataival renderel; **amíg ez nem sikerült, a szerkesztő (és a `/collab` kapcsolat) nem töltődik be**.

```
● Csapat Alfa  [Lezárt 🔒]                      [ Műveletek ⋯ ]   ← színpont + színtér neve (link: Színtér beállításai)
Ügyfélszolgálati gyorsválaszok                                    ← h1 (display, a cím töredezés nélkül tör)
[✎ Piszkozat] [▦ Fajta: Prompt]  (Prompt) (Gyorsindítás) (+3 további)
Tulajdonos: Kovács Anna · A Jóváhagyott változat (v2) érvényben marad.
```

| Elem | Specifikáció |
|---|---|
| Színtér-sor | `--text-sm --text-muted`; színpont (DS) + név; lezárt térnél „Lezárt” Badge lakattal. Link a `/spaces/:id/settings` oldalra (csak tagnak van értelme; itt az olvasó mindig tag). |
| Cím | `h1`, display (Fraunces), `--text-3xl` (< sm: `--text-2xl`), a hosszú cím **törik** (`break-words`), nincs csonkolás: a cím a feladat. `document.title`: „{cím} – Táltos”. |
| **Állapotjelvény** | Badge **ikonnal és felirattal** (nem csak szín): 4.1 táblázat. |
| Fajta | Neutral Badge, `Shapes` ikon, felirat „Fajta: {label}” (a „Fajta:” képernyőolvasónak is él). A címkéktől vizuálisan és szövegesen is elkülönül. |
| Címkék | `<ul aria-label="Címkék">` csak olvasható, körvonalas chipek (nincs „×”), `Tag` ikon nélkül (a fajtától a forma különbözteti meg). Legfeljebb 6 látszik; felette „+N további” **gomb** (`aria-expanded`), kibontva az összes. Nincs címke: a sor nem jelenik meg (nincs „Nincs címke” zaj). A szerkesztés a WP6-é; itt nincs szerkesztő affordance. |
| Tulajdonos / verzió | `--text-sm --text-muted`: „Tulajdonos: {név}”; ha `iteration > 0`: „ · Jóváhagyott verzió: v{iteration}”. Ha az állapot nem Jóváhagyott, de van `approvedRevisionId`: „ · A Jóváhagyott változat érvényben marad.” (D45: az MCP és az export azt adja.) |
| Műveletek menü | shadcn **DropdownMenu**; trigger ikongomb `MoreHorizontal`, `aria-label` „Dokumentum műveletei”, mobilon `--space-12`. Elemek: „Duplikálás”, elválasztó, „Piszkozat eldobása” (veszély szín). Ha egy elem sem elérhető, a menü nem jelenik meg. Helyet hagy a WP8 elsődleges „Review-ra küldés” gombjának. |

### 4.1 Állapotjelvény (D45)

| `reviewState` | Felirat | Badge variáns | Ikon (Lucide) | Megjegyzés |
|---|---|---|---|---|
| `draft` | Piszkozat | neutral | `PencilLine` | |
| `pending` | Review-ra vár | info | `Hourglass` | |
| `approved` | Jóváhagyott | success | `CircleCheck` | |
| `changes_requested` | Átdolgozandó | warning | `RotateCcw` | |

Kiegészítő jelvény: `archived` → neutral „Archivált” (`Archive`); a fejléc ilyenkor csak olvasható (nincs szerkesztő affordance, az eldobás nem érhető el).

### 4.2 Fejléc-állapotok

| Állapot | Megjelenés |
|---|---|
| Betöltés | Skeleton: színtér-sor, cím (két sor), jelvény-sor; `aria-busy`; a szerkesztő nem tölt be. |
| Hiba (hálózat/500) | `Alert` (danger): „A dokumentum adatai nem töltődtek be.” + „Újrapróbálás”. |
| 404 `not_found` | Oldalszintű állapot: „A dokumentum nem található. Lehet, hogy eldobták, vagy hibás a hivatkozás.” + „Vissza a Kezdőlapra”. (Érvénytelen azonosító formátum: a meglévő semleges üzenet marad.) |
| **403 `not_space_member`** | A WP4b `NoAccessState` mintája (4.7), dokumentumra igazítva: `h1`: „Nincs hozzáférésed ehhez a dokumentumhoz”; törzs: „Ez a dokumentum egy olyan színtérben van, amelynek nem vagy tagja. A(z) „{details.space.name}” tartalmát csak a tagjai látják.”; a `details.managers` listája („Felvételért fordulj valamelyik Színtérgazdához:”), üres lista esetén a Rendszeradminisztrátor-szöveg; „Vissza a Kezdőlapra”. **Nincs dokumentumcím, állapot, címke.** Nincs „Felvétel kérése” gomb (WP4b NK8 döntése). Rendszeradminisztrátornak kiegészítés: „Rendszeradminisztrátorként a színtér beállításaiban felveheted magad.” + link `/spaces/{details.space.id}/settings`. A komponens `subject: 'space' \| 'document'` paramétert kap (csak a `h1` és az első mondat különbözik). |
| Új, még szerkesztetlen | A fejléc ugyanaz; a szerkesztő a WP3/WP6 dolga. |

---

## 5. Piszkozat eldobása

**Ki látja a menüelemet:** a dokumentum tulajdonosa (Szerző) vagy a Színtérgazda, ha a `reviewState = draft`, nincs `approvedRevisionId`, a dokumentum nem archivált, és a színtér nem lezárt. A felület más esetben **elrejti**; a backend dönt (WP4b elv).

**Korlát (kimondva):** a „soha be nem küldött” feltételt a `DocumentDetail` nem fejezi ki teljesen (egy visszavont review-kérés után a dokumentum újra `draft`, de a backend `409 has_approved_revision`-t ad, D59 e). Ezért a gomb ritkán egy olyan Piszkozaton is látszhat, amit nem lehet eldobni; a 409 üzenete ezt kezeli. Pontosabb jelzés: NK6.

### 5.1 Megerősítés (shadcn **AlertDialog**, a fókusz alapból a „Mégse”-n)

- Cím: „„{cím}” eldobása”.
- Törzs (rövid mondatok):
  - „Az eldobás végleges: a Piszkozat nem nyitható meg újra, és a felületen nem állítható vissza.”
  - „Ha mások is szerkesztik, az ő szerkesztésük megszakad.”
  - „A művelet naplózódik.” (átláthatóság)
- Gombok: „Mégse” · „Piszkozat eldobása” (veszély recept). Nincs „Visszavonás” a toastban: a művelet nem visszafordítható a felületről, ezért van megerősítés (Nielsen: hibamegelőzés ott, ahol undo nincs).
- Beküldés közben: gomb „Eldobás…”, letiltott. Hiba esetén a dialógus **nyitva marad** (Radix alapértelmezett zárás `preventDefault`), a hibát `Alert` (danger) mutatja a törzs fölött.

### 5.2 Siker

`204` → navigálás a **Kezdőlapra** (lista még nincs; a dokumentumoldal már nem létezik; `replace`, hogy a „vissza” ne az eldobott oldalra vigyen), toast: „A Piszkozat eldobva: „{cím}”.” A fókusz az oldal `h1`-ére kerül. A megnyitott szerkesztőkapcsolat a szerveren bontódik; a kliens a navigációval lezárja.

### 5.3 Hibák

| `code` (HTTP) | Üzenet (Alert, `role="alert"`) | Teendő a felületen |
|---|---|---|
| `request_pending` (409) | „Közben review-ra küldték ezt a dokumentumot, ezért nem dobható el. Az oldal frissült.” | A dokumentum adatai újratöltődnek; a gomb eltűnik; a dialógus „Bezár”-ral zárható. |
| `has_approved_revision` (409) | „Ezt a dokumentumot már beküldték review-ra, vagy volt Jóváhagyott változata, ezért nem dobható el. A tartalmát továbbra is szerkesztheted.” | Adatok újratöltése; „Bezár”. (A törlés review-n át a D45 szerint későbbi csomag; ez a spec nem ígér ilyen gombot.) |
| `space_closed` (403) | „Ez a projekt-tér közben lezárult, ezért a Piszkozat már nem dobható el.” | Adatok újratöltése; a fejléc lezárt jelölést kap. |
| `forbidden` (403) | „Piszkozatot csak a tulajdonosa vagy a Színtérgazda dobhat el.” | A menüelem eltűnik (a szerep változhatott: `GET /me` újratöltés). |
| `not_found` (404) | „A dokumentum már nem található. Lehet, hogy közben valaki eldobta.” | „Vissza a Kezdőlapra”. |
| `not_space_member` (403) | Oldalszintű hozzáférés-állapot (4.2). | |
| `internal_error` / hálózat | „Valami félresikerült nálunk, a Piszkozat még nem lett eldobva. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.” | „Újrapróbálás”. (Hálózati megszakadásnál az eldobás megtörténhetett: az újrapróbálás `404`-et kaphat, ami fent kezelt.) |

---

## 6. Hibaüzenetek a létrehozásnál és duplikálásnál

Szabály (WP4b 6.): a szöveg megmondja, **mi történt** és **mi a következő lépés**; nem hibáztat, nem mutat kódot; a `title`/`detail` szövegre nem építünk, a `code` dönt. Az üzenetek a meglévő `ERROR_MESSAGES` táblába kerülnek (új `ErrorAction`-ök: `create-document`, `duplicate-document`, `discard-draft`, `create-tag`, `load-kinds`, `load-tags`).

| `code` (HTTP) | Hol | Üzenet | Teendő |
|---|---|---|---|
| `validation_error` (400) | létrehozás/duplikálás | „Nem sikerült létrehozni: a megadott adatok nem megfelelők. Lehet, hogy a fajta már nem választható, vagy egy címke már nem létezik. Ellenőrizd a mezőket, és próbáld újra.” | Mezők megmaradnak; a fajta- és címkelista újratöltődik; a fókusz az első mezőre. (Stabil alkód és mezőjelölés híján ez tartalék-üzenet; kliensoldali előellenőrzés a 2.2 szerint.) |
| `validation_error` (400) | `POST /tags` | lásd 3.3 | |
| `not_space_member` (403) | létrehozás | „Már nem vagy tagja a kiválasztott színtérnek (vagy a másolandó dokumentum színterének), ezért nem hozható létre a dokumentum. A színterek listája frissült.” | `GET /me` és `GET /spaces` újratöltés; a Színtér mező frissül; a dialógus nyitva marad. |
| `space_closed` (403) | létrehozás | „A(z) „{színtér}” projekt-tér közben lezárult, ezért nem hozható benne létre dokumentum. Válassz másik színteret.” | Színterek újratöltése; a lezárt sor tiltottá válik. |
| `forbidden` (403) | bármely | „Ehhez a művelethez nincs jogosultságod. Ha szerinted kellene, kérd a Színtérgazdát vagy a Rendszeradminisztrátort.” | `GET /me` újratöltés. |
| `not_found` (404) | létrehozás | „A kiválasztott színtér már nem található. Válassz másikat.” | Színterek újratöltése. |
| `not_found` (404) | duplikálás | „A másolandó dokumentum már nem található. Lehet, hogy közben eldobták.” | Csak „Bezár”; nincs értelmes újrapróbálás. |
| `request_pending`, `has_approved_revision` | — | Létrehozásnál nem fordulhatnak elő; ha mégis: általános szöveg, kód nélkül. | |
| `csrf_failed`, `unauthenticated`, `not_on_allowlist` | bármely | A WP4b 6.2 szövegei változatlanul. | |
| `internal_error` (500) | létrehozás | „Valami félresikerült nálunk, a dokumentum nem jött létre. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.” | „Újrapróbálás”, mezők megmaradnak. |
| hálózati hiba / időtúllépés | létrehozás | „A kapcsolat megszakadt, ezért nem tudjuk, létrejött-e a dokumentum. Próbáld újra; ha kétszer is létrejönne, a felesleges Piszkozatot eldobhatod.” | „Újrapróbálás”. (A `POST` nem idempotens; lásd Kockázatok.) |

---

## 7. Szerep × állapot mátrix (a vezérlők láthatósága)

A felület csak elrejt; a döntés a backendé (`can()`). ✓ látszik/elérhető · – nincs (rejtett) · (✓) feltétellel. Rendszeradmin = **nem tag** Rendszeradminisztrátor (ha tag is, a tagi szerepe érvényes). Az „Új dokumentum” és a „Duplikálás” dialógus célja csak nem lezárt tagsági színtér.

| Vezérlő | Szerző (saját dok.) | Szerző (más dok.) | Színtérgazda | Rendszeradmin (nem tag) | Lezárt tér |
|---|---|---|---|---|---|
| Oldalsáv „Új dokumentum” | ✓ | ✓ | ✓ | – (nem tagként nincs `document.create`) | – ha nincs más nem lezárt tagsági tér; egyébként ✓ és a dialógus a többi színtérbe vezet |
| Színtér-lehetőség a dialógusban | ✓ tag, nem lezárt | ✓ | ✓ | – | tiltott sor, lakat + „Lezárt” |
| Fejléc megtekintése | ✓ | ✓ | ✓ | `NoAccessState` (nincs tartalom) | ✓ (olvasható, „Lezárt” jelölés) |
| „Duplikálás” menüelem | ✓ | ✓ | ✓ | – | ✓ ha a felhasználónak van másik, nem lezárt tagsági tere; a lezárt forrás duplikálható |
| „Piszkozat eldobása” menüelem | ✓ (`draft`, nincs Jóváhagyott, nem archivált) | – | ✓ (ugyanez) | – | – (a `space_closed` miatt rejtett) |
| Állapotjelvény, fajta, címkék | ✓ | ✓ | ✓ | – | ✓ |
| Fajta-kezelés (`POST /kinds`, NK2) | – | – | – | ✓ | n.a. |

A mátrix a [[Felhasználók/Szerepkörök|Szerepkörök]] két új sorát követi (létrehozás; eldobás ⁶). A komponensteszt (12. szakasz) cellánként ellenőrzi. Megjegyzés: a Rendszeradminisztrátor **nem tagként nem hozhat létre dokumentumot**; tagként igen — nem kínálunk neki „vedd fel magad” gyorsutat a dialógusból (hatókör: WP4b önfelvétel az Adminisztrációban).

---

## 8. Komponensek (shadcn + DS) és a ténylegesen szükséges lista

Csak a már bemásolt vagy a WP4b-ben jóváhagyott komponensek; **új Radix-csomag és új runtime-függőség nincs**.

| Komponens | Használat | Megjegyzés |
|---|---|---|
| Button, Input, Label, Alert, Badge, Card, Avatar | mezők, jelvények, hibák | meglévő (`components/ui/*`) |
| **Dialog** | `CreateDocumentDialog` | meglévő (`NewSpaceDialog` mintája) |
| **AlertDialog** | eldobás megerősítés | meglévő `ConfirmDialog.tsx` újrahasznosítható (**API-ját nem olvastam**; ha nem engedi a nyitva maradást hibánál, bővítendő) |
| **Select** | Színtér, Fajta | meglévő (`select.tsx`); disabled elem + „Lezárt” felirat |
| **DropdownMenu** | „Műveletek” a fejlécben | meglévő (`dropdown-menu.tsx`, `RowMenu.tsx` mintája) |
| **Command** (`cmdk`) | `TagPicker` | meglévő (`command.tsx`, `UserPicker` mintája); csoportcímek (`CommandGroup`) |
| Skeleton, EmptyState | betöltés, oldalszintű állapotok | DS 6.1 receptek |
| Sonner | siker-toast | meglévő (`sonner.tsx`) |
| `NoAccessState` | 403 dokumentum | meglévő, kis bővítés (`subject`) |
| Ikonok (`lucide-react`) | `Plus`, `Copy`, `MoreHorizontal`, `PencilLine`, `Hourglass`, `CircleCheck`, `RotateCcw`, `Archive`, `Shapes`, `Lock`, `X`, `Trash2` | a Lucide-ban elérhetők a nevek a megvalósításkor ellenőrizendők |

**Nem kerül be:** Tooltip (a jelvények szövegesek), Popover (a lista a folyamban él), Radix Collapsible (a „+N további” sima gomb `aria-expanded`-del), Combobox-csomag a `cmdk` mellett.

---

## 9. DS-hiányok (javaslatok, jóváhagyás után kerülnek a `taltos-design-system.md` 6.1-be)

| Javasolt recept | Meghatározás (csak tokenek) | Indok |
|---|---|---|
| **Állapotjelvény** (Badge-variáns ikonnal) | A Badge recept + előtag-ikon `--space-4`; leképezés: draft → neutral, pending → info, approved → success, changes_requested → warning (4.1) | A DS Badge-nek van státusz-variánsa, de az állapot→variáns és az ikon-szabály nincs rögzítve; a következő felületek ugyanazt használják. |
| **Chip, csak olvasható** | A Chip recept törlés-gomb nélkül, `bg: transparent; border: 1px --border-strong; color: --text` | A fejléc címkéi; a szerkeszthető chiptől (háttér) vizuálisan és funkcionálisan elkülönül. |
| **Kereső-lista csoportcímmel és művelet-sorral** | A „Kereső-lista” recept + csoportcím `--text-xs --weight-semibold --text-muted` (eyebrow), elválasztó `1px --border`, művelet-sor `--primary-soft-text`, `Plus` ikon | A TagPicker csoportjai és az „új címke” sor. |
| **Dokumentumfejléc** | Rács: színtér-sor / `h1` / jelvény-sor / meta-sor, térköz `--space-2`–`--space-3`, jobb oldalt műveletgomb; < sm egy oszlop | A WP6/WP8 ugyanezt bővíti. |
| **Select tiltott elem magyarázattal** | A Menü recept `disabled` (opacity .45) + a szöveg végén ikon és felirat („Lezárt”) | A tiltás oka ne csak halványítás legyen (nem csak szín/átlátszóság). |

Új token nincs.

## 10. Reszponzív, hozzáférhetőség, sötét téma

- **360 px:** egy oszlop; a dialógus szélessége a képernyőhöz igazodik (`--space-4` margó), belül görgethető; a lábléc gombjai egymás alatt; a TagPicker listája max. `calc(var(--space-12) * 5)` magas, a megnyitáskor a mező a látótérbe görgetődik (billentyűzet fölött); a fejléc jelvény-sora törik (nincs vízszintes görgetés); a Műveletek ikongomb `--space-12`.
- **Billentyűzet:** minden vezérlő elérhető; a Dialog/AlertDialog Radix-fókuszcsapdája; bezáráskor a fókusz az indító elemre tér vissza; a TagPicker 3.4 szerinti.
- **Fókusz navigáció után:** `h1`; toast `aria-live="polite"`, nem a fókuszt viszi.
- **Nem csak szín:** állapot (ikon + felirat), kiválasztás, hiba (ikon + szöveg), „Lezárt” (lakat + felirat), fajta (felirat).
- **Címkék:** `<label>` a mezőhöz; placeholder nincs mint címke.
- **Kontraszt:** a DS szemantikus tokenjeire támaszkodik, mindkét témában; **nem mértem újra**. A színtér-színpont jelölő, névvel (WP4b NK2).
- **Mozgás:** CSS-átmenet a tokenekből; `prefers-reduced-motion`: csak áttetszőség.
- **Téma:** csak szemantikus token, komponensenként nincs sötét-override.
- **Hang:** tegező, cselekvő; „színtér”, „Piszkozat”, „Jóváhagyott”, „review”, „címke”, „fajta”; nincs „entitás”, „metaadat” a felületen (a „metaadat” csak ebben a specben szakszó), nincs misztikum.

## 11. Mikroszöveg-összefoglaló (i18n-barát: egy helyen, kulcsokkal)

| Kulcs | Szöveg |
|---|---|
| `doc.new.button` | Új dokumentum |
| `doc.new.title` / `doc.dup.title` | Új dokumentum / Dokumentum duplikálása |
| `doc.new.submit` / `doc.dup.submit` | Dokumentum létrehozása / Másolat létrehozása |
| `doc.title.label` | Cím |
| `doc.kind.label` / `doc.kind.placeholder` | Fajta / Válassz fajtát |
| `doc.tags.label` / `doc.tags.optional` | Címkék / nem kötelező |
| `doc.tags.group.existing` / `.similar` | Meglévő címkék / Ezt kerested? |
| `doc.tags.new` / `.newAnyway` | Új címke: „{szöveg}” / Mégis új címke: „{szöveg}” |
| `doc.discard.menu` / `.confirm` | Piszkozat eldobása / Piszkozat eldobása |
| `doc.menu.aria` | Dokumentum műveletei |

A gombfeliratok cselekvést neveznek meg (nem „OK”). A hosszabb magyar szövegek (ékezetek, összetett szavak) törnek, nem vágódnak.

## 12. Átadás a `frontend-web`nek

1. `CreateDocumentDialog` (egy komponens, két mód), `TagPicker`, `DocumentHeader`, `DiscardDraftDialog`; az oldalsáv „Új dokumentum” gombja és a `DocumentPage` átdolgozása (a szerkesztő csak sikeres `GET /documents/:id` után töltődik).
2. A 6. és 5.3 hibatáblák a meglévő `ERROR_MESSAGES`-be (egy helyen), új `ErrorAction`-ökkel.
3. A `normalizeTagName` és `displayTagName` a `@taltos/shared`-ből (ne másold le).
4. Tesztek: a 7. mátrix minden cellája (megjelenik/nem jelenik meg); a TagPicker állapotai (üres rendszer, betöltés, pontos egyezés auto-csere és státuszsor, 1–3 javaslat, nincs-találat, keresési hiba → az „új címke” sor tiltott, 64 karakter, 50 címke, Esc-sorrend, aria-attribútumok); a dialógus (betöltés, üres fajta-lista, minden hibakód üzenettel, adatmegőrzés hibánál, kettős küldés tilos); az eldobás (fókusz a „Mégse”-n, 409-ek, siker-navigáció); a 403 `NoAccessState` a dokumentumoldalon; kézi ellenőrzés 360 px-en és sötét témában, képernyőolvasóval a combobox.
5. A `HomePage` változatlan.

## 13. Megfelelőségi checklist (spec-szint; a build utáni futtatás a `frontend-web` dolga)

| DS-checklist pont | Állapot |
|---|---|
| Nincs nyers hex/px | Specben csak token (a színtér-szín adat, WP4b NK2) |
| Csak szemantikus token | Igen |
| Téma | Komponensenkénti override nincs; kontraszt **nem mért** |
| Fókusz | `--focus-ring` minden interaktív elemen |
| Nem csak szín | Állapot, hiba, kiválasztás, „Lezárt”: ikon és/vagy felirat |
| Tipográfia | Display csak `h1`; Inter a törzs |
| Reszponzív | 360 px-ig leírva; reduced-motion leírva |
| Szöveg | Cselekvő, tegező, zsargonmentes |

---

## Döntések (D60, 2026-11-06)

A tulajdonos minden NK-ban az ajánlást fogadta el: **NK1** (a) oldalsáv-gomb · **NK2** (a) „Fajták” fül az Adminisztrációban (`/admin/kinds`) · **NK3** (a) a dialógus blokkol, és a kilenc alap-fajta idempotens adat-migrációval kerül be · **NK4** (a) a duplikátum-figyelmeztetés nem a WP5b része · **NK5** (a) aktuális színtér + „ (másolat)” · **NK6** (a) kliensoldali szabály · **NK7** (a) azonnali `POST /tags` · **NK8** (a) elfogadva. **E1** — a B5 sora pontosítva (a jelentés a D59 szerinti volt). **E2** — a „ (másolat)” utótag a D60-nal naplópont. Az alábbi 14. szakasz a döntés előtti állapot.

## 14. Eltérések és nyitott kérdések

**Eltérések (nem oldottam fel csendben):**

- **E1 — A kontraktus 64. sora zavaros.** A `DELETE /documents/:id/draft` megjegyzése („Függő kérésnél 409 `request_pending`, ha volt Jóváhagyott revízió vagy review-kérés, 409 `has_approved_revision`”) nem egyezik a D59 e szövegével (függő kérésnél `request_pending`, egyébként `has_approved_revision`). A spec a D59-et követi; a kontraktus-sor javítandó.
- **E2 — Kezdőérték a D58 szerint, az utótag nem.** A D58 a cím, fajta, címkék kezdőértékét a Jóváhagyott metaadatból veszi; a „ (másolat)” utótag **az én javaslatom** (azonos című dokumentumok elkerülése), nem naplópont (NK5).

**Nyitott kérdések** (opciók és ajánlás; nem döntöttem):

- **NK1 — Hol legyen az „Új dokumentum” belépési pont (lista és dashboard híján)?** *Opciók:* (a) az oldalsáv elsődleges gombja, az aktuális színtérre; (b) a Kezdőlap tartalma (a WP23 dashboardja felváltja), az oldalsáv nélkül; (c) globális fejlécgomb. *Kompromisszum:* (a) minden oldalról 1 kattintás, de az oldalsáv a mobilon a Sheetben van (2 lépés); (b) mobilon kényelmes, de csak a Kezdőlapról érhető el, és a WP23 átírja; (c) a fejlécben már a fiókmenü van, zsúfoltabb. *Ajánlás:* (a); a WP23 a Kezdőlapra kiteheti a másodlagos útvonalat.
- **NK2 — A fajták Rendszeradmin-felülete (`POST /kinds`) ide tartozik-e?** *Opciók:* (a) az Adminisztráció új füle, „Fajták” (`/admin/kinds`): lista + „Új fajta” dialógus (név + a kulcs automatikusan a névből, a `^[a-z][a-z0-9_]{0,31}$` szerint, ékezetmentesítve, szerkeszthető előnézettel); (b) most nincs felület, a fajtákat a tulajdonos/üzemeltetés szkripttel veszi fel, a felület a WP11-ben jön; (c) inline „Új fajta” a létrehozás dialógusában. *Kompromisszum:* (a) kis, a WP4b Adminisztráció mintájára épülő bővítés, de hatókör-bővítés és új útvonal, és **átnevezés/törlés nincs a kontraktusban**, egy elírt fajta végleges; (b) nulla felület, de üres rendszerben a WP5b kipróbálhatatlan UI-ból; (c) a Rendszeradmin nem tag, ezért nem is hozhat létre dokumentumot, így a dialógusában sosem lenne. *Ajánlás:* (a), vagy ha a tulajdonos szűkít, (b) + a migrációs seed (NK3); (c) elvetem.
- **NK3 — Mi legyen, ha nincs egyetlen fajta sem?** Friss adatbázisban a lista üres (a migrációkban nincs seed; a [[Dokumentumok/Címkék|Címkék]] V33 a seed-migrációt a kilenc fajtával ígéri). *Opciók:* (a) a dialógus blokkol, az `Alert` megmondja a teendőt (2.3), a gomb letiltott; (b) az „Új dokumentum” gomb el is tűnik, ha nincs fajta (ehhez a gomb is betölti a fajta-listát); (c) rendszerszintű tartalék-fajta („Egyéb”) a seedben, így sosem üres. *Kompromisszum:* (a) őszinte, de a felhasználó zsákutcába futhat; (b) elrejti a hibát, a felhasználó nem érti, hova lett a gomb; (c) backend/seed változás, de a UI-nak nem kell kezelnie a zsákutcát (az (a) tartalékként marad). *Ajánlás:* (a) a felületen **és** a kilenc fajta seed-elése a pilot előtt (c nélkül); kérdés: bekerül-e a seed a WP5b-be (ez nem felület, az orchestrátor/`engineering-lead` hatásköre).
- **NK4 — Duplikátum-figyelmeztetés a címnél („Ezt kerested?”, V13, D49)?** A B5 kontraktusban van `GET /documents/similar`, a WP5a nem építette meg (a kódban nincs). *Opciók:* (a) nem a WP5b része, a WP11-gyel (lista, keresés) együtt jön; (b) a WP5b-be előrehozzuk (backend + egy `Alert` a Cím mező alatt, nem tilt). *Ajánlás:* (a); a duplikálásnál az „(másolat)” utótag részben enyhíti.
- **NK5 — Duplikálás: alapértelmezett célszínter és címutótag.** *Opciók:* (a) az aktuális színtér (a feladat szerint), utótag „ (másolat)”; (b) a forrás színtere, utótag nélkül (üres cím a gépeléshez). *Kompromisszum:* (a) ha az aktuális tér más, mint a forráshoz tartozó, váratlan lehet; mindkét esetben a Select látható és a tárolt értéket a „Létrehozás” előtt látja a felhasználó. *Ajánlás:* (a).
- **NK6 — Az eldobás gomb pontos láthatósága.** A `DocumentDetail` nem mondja meg, volt-e valaha review-kérés. *Opciók:* (a) kliensoldali szabály + a 409 üzenetei (jelen spec); (b) a `GET /documents/:id` új, csak olvasható mezőt kap (`discardable: boolean`), a gomb pontosan ezt követi (kontraktus-bővítés, WP5a-javítás). *Ajánlás:* (a) most; (b), ha a pilotban zavar.
- **NK7 — Mikor jöjjön létre az „új” címke: azonnal vagy a dokumentum-létrehozással?** *Opciók:* (a) a kiválasztáskor azonnal `POST /tags` (jelen spec, a kontraktus változatlan; a dialógus elvetésekor árva címke és `tag_created` esemény marad); (b) a `POST /documents` kapna `newTagNames`-t (kontraktus-bővítés, nincs árva címke, atomi). *Ajánlás:* (a); az árva címke V30 szerint rejtett, a hatás csekély.
- **NK8 — Hálózati megszakadás után a kettős létrehozás.** A `POST /documents` nem idempotens; a spec az őszinte üzenettel kezeli (6.). *Opciók:* (a) elfogadjuk; (b) `Idempotency-Key` fejléc (backend-változás). *Ajánlás:* (a) a pilot előtt; az eldobás kezeli a felesleges Piszkozatot.

## Kockázatok

- A `POST /tags` kiválasztáskor fut, a dokumentum létrehozásától függetlenül (NK7); a visszaadott név eltérhet a beírttól (a felület ezt kimondja, de a „nem ígér új címkét” szöveg-szabályt a tesztnek is védenie kell).
- A fajta nem szerkeszthető utólag (WP6-ig sem), és nincs átnevezés: a létrehozáskor választott fajta elírása a WP6-ig javíthatatlan a felületen.
- Friss rendszerben (seed nélkül) a WP5b nem próbálható ki fajta nélkül (NK2, NK3).
- A hosszú címkelista (nincs lapozás a `GET /tags`-ben) kliensoldali szűrése nagy készletnél lassulhat; **nem mért**, a pilotban figyelendő.

## Kapcsolódó döntések és egységek

D34, D40, D44, D45, D46, D47, D57, D58, D59, D60 · [[Szerkesztés/Létrehozás forrásból|Létrehozás forrásból]] · [[Dokumentumok/Címkék|Címkék]] · [[Dokumentumok/Státusz-workflow|Státusz-workflow]] · [[Felhasználók/Szerepkörök|Szerepkörök]] · [[Felhasználók/Adminisztráció és színtér-beállítások|Adminisztráció és színtér-beállítások]] · [[Szerkesztés/Markdown szerkesztő|Markdown szerkesztő]] · [[Kollaboráció/Színterek|Színterek]]
