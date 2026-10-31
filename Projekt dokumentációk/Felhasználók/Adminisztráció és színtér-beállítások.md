---
tags:
  - taltos/egyseg
  - taltos/ux-spec
allapot: tervezet – a D57 döntéseivel, tulajdonosi jóváhagyásra vár
mvp: 2
munkacsomag: WP4b
szerzo: ux-ui-designer
datum: 2026-10-31
---

# Adminisztráció és színtér-beállítások (WP4b UX-spec)

> [!warning] Tervezet — kód csak jóváhagyás után
> A WP4b (a WP4 felülete) UX-specifikációja. A backend (WP4a) kész; a felület pontosan a [[Felhasználók/Szerepkörök|Szerepkörök]] mátrixát, a B5 végpontjait és hibakódjait használja. A **nyitott kérdések** (utolsó szakasz) a jóváhagyás előtt dőlnek el. Forrás: D14, D43, D44, D55, D56, B5 („Színterek és tagság”, „Audit és adminisztráció”, hibakód-katalógus), `taltos-design-system.md`, `Prototypes/.claude/CLAUDE.md`.

## Cél

A felhasználó négy dolgot tudjon gyorsan és hibamentesen elvégezni:

1. **Színtért váltani**, és mindig lássa, melyikben van (minden felhasználó).
2. **Színteret létrehozni, átnevezni, lezárni**, Rendszeradminisztrátort kijelölni vagy visszavonni, magát színtérbe felvenni (Rendszeradminisztrátor).
3. **A színtér tagjait és szerepeit kezelni**, a leírást és a színt módosítani (Színtérgazda; a Rendszeradminisztrátor felülírhat).
4. Ha valamit **nem tehet meg, megértse, miért, és mi a következő lépés** (minden védőszabály és jogosultsági hiba).

Hatókörön kívül (nem tervezzük): tulajdonjog-átadás gomb (WP5/WP11), felvételi és projekt-tér kérés felülete (WP23), egyéni színtér-szín (WP12), a kezdőoldal/dashboard (WP23), allowlist-karbantartó (második ütem). „A felület elrejt, a backend véd”: minden elrejtett vezérlő hívása is biztonságos, mert a `can()` dönt; a felület a visszaadott hibát ugyanúgy kezeli (lásd Hibaüzenetek).

## Felhasznált források és előfeltevések

| Mit | Honnan |
|---|---|
| Szerepek, mátrix, védelmek | [[Felhasználók/Szerepkörök|Szerepkörök]], D43, D56 |
| Zárt tér, `not_space_member` | D44, B5 A10, `NotSpaceMemberDetails` |
| Lezárás (visszavonás), kivételek lezárt térben | D55, D56, `POST /spaces/:id/close` |
| Típusok | `@taltos/shared`: `SpaceSummary`, `SpaceDetail`, `SpaceMember`, `UserRef`, `AdminUser`, `SPACE_COLOR_PALETTE`, `MeResponse` |
| Vizuális és hangnemi szabályok | Táltos Design System (tokenek, receptek, hang), tegező hang (a meglévő belépő felülettel egyezően) |

Ellenőrizve a backend kódjában (nem csak a dokumentumban): a névütközés és a „már tag, más szerepben” eset `400 validation_error` **stabil kód és mezőjelölés nélkül** (csak magyar `detail` szöveg); a lezárás válasza `SpaceDetail` (nincs benne a visszavont kérések száma); a névegyediség kis-nagybetű-független; a név 1–80 karakter és nem csak szóköz, a leírás legfeljebb 2000 karakter, üres is lehet.

---

## 1. Navigáció és szerkezet (információs architektúra)

```
Fejléc (minden oldalon)
Oldalsáv:  [Színtérváltó]
           Kezdőlap                    /
           Színtér beállításai         /spaces/:spaceId/settings   (az aktuális színtér; tagoknak)
           Adminisztráció              /admin  → /admin/spaces | /admin/admins   (csak Rendszeradminisztrátor)
Tartalom:  oldal
```

Az útvonalak javaslatok (szabad sáv, nem naplópont). A fülek az Adminisztráción **útvonalak** (nem JS-fül): a nézet az URL-ben él (D49), a vissza gomb működik, nincs plusz Radix-csomag.

| Szerep | Oldalsáv | Elérhető oldalak |
|---|---|---|
| Szerző | Színtérváltó, Kezdőlap, Színtér beállításai (csak olvasható) | saját színterek beállításai olvasásra |
| Színtérgazda | ugyanez | a saját színtere beállításai szerkeszthetően |
| Rendszeradminisztrátor | + Adminisztráció | Adminisztráció; bármely színtér beállításai (nem tagként: metaadat + tagok, tartalom nélkül) |

Az **Adminisztráció** elem nem jelenik meg nem Rendszeradminisztrátornak; ha mégis beírja az URL-t, az oldal „Nincs jogosultságod” állapotot mutat (a végpontok `403 forbidden`-t adnak).

## 2. Alkalmazás-keret (App shell)

### 2.1 Elrendezés

| Elem | Desktop (≥ lg, 1024) | Tablet/mobil (< lg) |
|---|---|---|
| Fejléc | sticky (`--z-sticky`), `--surface`, alul `1px --border`; bal: logó (Fraunces, `--text-xl`) + jobb: felhasználói menü | + bal oldalt hamburger ikongomb (menü megnyitása) |
| Oldalsáv | fix, szélesség `--sidebar-w`, `--surface`, jobb oldalt `1px --border`, belső térköz `--space-4` | **Sheet** (balról kicsúszó panel, Modal-recept alapján), szélesség `min(var(--sidebar-w), 85%)`; bezár: navigáció, színtérváltás, Esc, kívülre kattintás |
| Tartalom | `--bg`, max `--content-max`, oldalsó térköz `--space-6`; < sm: `--space-4` | egy oszlop |

Első fókuszolható elem minden oldalon: „Ugrás a tartalomra” link (látható fókuszkor). Tájékozódási pontok: `<header>`, `<nav aria-label="Fő navigáció">`, `<main>`. Útvonalváltáskor a fókusz az oldal `h1`-ére kerül (`tabindex="-1"`), és a `document.title` frissül („Adminisztráció – Táltos”).

### 2.2 Színtérváltó

- Hely: az oldalsáv teteje; felette `eyebrow` címke: „SZÍNTÉR”.
- Komponens: shadcn **Select** (Radix). A trigger az Input/Select recept (magasság 40px-es recept-érték, `--border-strong`, fókuszban `--border-focus` + `--focus-ring`); tartalma: **színpont + név**; lezárt térnél a név után „Lezárt” felirat és lakat ikon.
- Elemek sorrendje: Általános, majd csapat-munkaterek név szerint, majd projekt-terek név szerint (csoportcímkék: „Csapatok”, „Projektek”; az Általános külön, címke nélkül az élen).
- Adatforrás: a **tagság és a szerep** a `GET /me` `spaces` listájából jön, a **szín és a lezárt-állapot** a `GET /spaces` listából (a `me.spaces` nem tartalmazza őket). A Rendszeradminisztrátornak a `GET /spaces` az összes színteret adja, de a váltóban **csak azok jelennek meg, amelyeknek tagja** (a `me.spaces` szerint); a többi az Adminisztrációból érhető el.
- Váltás hatása: az aktuális színtér megváltozik (`SpaceContext`). Ha a felhasználó a `/spaces/:id/settings` oldalon van, a váltás az **új színtér beállításaira** navigál; máshol marad az oldalon. A WP4b-ben az aktuális színtér csak a váltó feliratát és a „Színtér beállításai” linket vezérli; a későbbi csomagok (Atlasz, lista, WP5) ebből a kontextusból olvasnak.
- Kezdőérték: a `GET /me` `currentSpaceId`-je (szerveroldalon tárolt utolsó választás, ha még tag; különben az Általános, különben az első). Váltáskor `PUT /api/v1/me/current-space` (D57, az NK4 döntése).
- **Üres állapot (nincs színtere):** a trigger szövege „Nincs színtered”, alatta `--text-sm --text-muted`: „Kérd meg valamelyik Színtérgazdát, hogy vegyen fel.” Rendszeradminisztrátornak: „Vedd fel magad az Adminisztrációban.” (link).
- **Betöltés:** a trigger helyén skeleton (`--surface-sunken`, `--radius-md`), `aria-busy`.
- **Hiba (a lista nem töltődött be):** `Alert` (danger) az oldalsávban: „A színterek listája nem töltődött be.” + „Újrapróbálás” gomb (szellem, sm).

### 2.3 Navigációs elemek

Nav-elem recept (javaslat, NK1): magasság `--space-10`, padding `0 var(--space-3)`, `--radius-md`, szöveg `--text-muted`, `--text-sm`, `--weight-medium`; hover `--surface-sunken`; aktív: `--primary-soft` háttér, `--primary-soft-text` szín, `--weight-semibold`, `aria-current="page"` (az aktív állapot **nem csak színnel** jelzett: súly és attribútum is). Minden elem ikon + felirat; az ikon dekoratív (`aria-hidden`).

| Elem | Felirat | Mikor látszik |
|---|---|---|
| Kezdőlap | „Kezdőlap” | mindig (a tartalom a WP23-ig helyőrző) |
| Színtér beállításai | „Színtér beállításai” | ha van aktuális színtér, és a felhasználó tagja (Szerzőnek is: csak olvasható nézet) |
| Adminisztráció | „Adminisztráció” | csak Rendszeradminisztrátornak (`me.systemRole === 'system_admin'`) |

### 2.4 Felhasználói menü (fejléc)

- shadcn **DropdownMenu** (Radix). Trigger: avatar + név (a név < sm alatt rejtett, a trigger `aria-label`: „Fiókmenü: {név}”). Az avatar a meglévő, kezdőbetűs/képes megoldás; érintési célméret mobilon `--space-12`.
- Tartalom: címke-sor (név, alatta `--text-xs --text-muted`: „Rendszeradminisztrátor” ha az; **e-mail nem jelenik meg**), elválasztó, „Kijelentkezés”.
- Hiba: sikertelen kijelentkezésnél az oldal tetején `Alert` (danger, `role="alert"`): „A kijelentkezés nem sikerült. Próbáld újra.” (a meglévő viselkedés megtartva).

### 2.5 Közös visszajelzési minták (nincs toast)

- **Siker/tájékoztatás:** az oldal tetején egy `Alert` sáv (`role="status"`, `aria-live="polite"`), ikon + szöveg + „Bezár” gomb; **nem tűnik el magától** (WCAG 2.2.1), a következő művelet vagy a bezárás törli. Űrlapmentésnél a „Mentés” gomb mellett is megjelenik: „✓ Mentve.”
- **Hiba:** műveletenként a megnyitott dialógusban (a dialóg nyitva marad, a megadott adatok megmaradnak) vagy az oldal tetején (`role="alert"`); a fókusz nem ugrik el, a hibaüzenet a gomb mellett/felett marad.
- **Folyamatban:** a gomb letiltott, felirata „Mentés…”/„Hozzáadás…”, `aria-busy`; kettős küldés tilos.
- A szerveroldali eredményre várunk (nincs optimista frissítés): minden műveletnél a szerver a forrás.
- **Frissítési szabály:** minden olyan sikeres művelet után, amely a *saját* szerepet vagy tagságot érinti (önfelvétel, saját szerep módosítása, saját eltávolítás, saját Rendszeradmin-jog visszavonása, olyan színtér létrehozása, ahol magam vagyok a kezdeti gazda), a `GET /me` és a `GET /spaces` újratöltődik, hogy a váltó és a navigáció igaz maradjon.

---

## 3. „Adminisztráció” oldal (`/admin`, Rendszeradminisztrátor)

Fejléc: `h1` „Adminisztráció” (display, `--text-4xl`; < sm: `--text-3xl`), alatta `--text-muted`: „Színterek és Rendszeradminisztrátorok kezelése.” Alatta útvonal-alapú fülek (Tabs recept): **Színterek** · **Rendszeradminisztrátorok** (`<nav aria-label="Adminisztráció">`, aktív: `aria-current="page"`).

### 3.1 Színterek (`/admin/spaces`)

**Eszköztár:** jobb oldalt elsődleges gomb „Új színtér” (ikon: plusz).

**Lista** (`GET /spaces`, minden színtér, lezártak is; metaadat):

| Oszlop | Tartalom |
|---|---|
| Színtér | színpont + név (`--weight-semibold`); alatta `--text-sm --text-muted` a leírás első sora (levágva) |
| Típus | Badge: „Általános” (primary), „Csapat” (neutral), „Projekt” (info) |
| Állapot | „Aktív” (success, pipa ikon) vagy „Lezárt” (warning, lakat ikon) |
| Tagságom | a `me.spaces` szerint: Badge „Színtérgazda” / „Szerző”, vagy `--text-muted` „Nem vagy tag” |
| Műveletek | DropdownMenu, `aria-label` „Műveletek: {színtér neve}” |

Sorrend: Általános, majd aktívak név szerint, a lezártak a lista alján „Lezárt színterek” csoportcímke alatt. A taglétszám és a gazdák **nincsenek a listában** (a `SpaceSummary` nem tartalmazza; soronkénti `GET /spaces/:id` N+1 lenne): ezeket a „Beállítások” oldal mutatja.

**Soronkénti menü** (az elem csak akkor látszik, ha a szabály engedi):

| Menüelem | Mikor | Hatás |
|---|---|---|
| Beállítások megnyitása | mindig | `/spaces/:id/settings` |
| Átnevezés | nem lezárt | átnevezés dialóg (3.1.2) |
| Felvétel magamat | nem tag | önfelvétel dialóg (3.1.4); lezárt térben is |
| Lezárás | csak `type = project`, nem lezárt | lezárás megerősítés (3.1.3) |

Üres/betöltés/hiba:
- **Betöltés:** 5 skeleton sor (táblázat-fejléc valódi), `aria-busy` a konténeren, rejtett „Színterek betöltése…” állapotszöveg.
- **Üres:** nem fordulhat elő (az Általános mindig létezik); ha mégis: üres állapot „Még nincs színtér.” + „Új színtér” gomb.
- **Hiba:** `Alert` (danger): „A színterek listája nem töltődött be. Próbáld újra.” + „Újrapróbálás”.

#### 3.1.1 Új színtér (Dialog, shadcn **Dialog**)

Cím: „Új színtér”. Mezők (mind `<label>`-lel, nem csak placeholder):

| Mező | Komponens | Szabály |
|---|---|---|
| Név | Input | kötelező, 1–80 karakter, nem csak szóköz; ütközés ellenőrzés a betöltött lista alapján (kis-nagybetű nélkül): „Ilyen nevű színtér már van. Válassz másik nevet.” |
| Típus | két rádiógomb (natív, DS Radio recept): „Csapat-munkatér” (alatta: „Tartós, a csapat közös tere.”), „Projekt-tér” (alatta: „Időben korlátos, később lezárható.”) | kötelező; **nincs előválasztás**, hogy tudatos döntés legyen; a típus később **nem módosítható**, ezt a mező alatti súgó jelzi |
| Leírás | Textarea | nem kötelező, legfeljebb 2000 karakter, számláló `--text-xs --text-subtle` („0 / 2000”) |
| Szín | színválasztó (3.4) | kötelező; előválasztva az első olyan paletta-szín, amelyet még nem használ színtér |
| Kezdeti Színtérgazda | felhasználókereső (3.5) | kötelező; súgó: „Ő veheti fel a többi tagot. Később más is Színtérgazda lehet.” |

Lábléc: „Mégse” (körvonal) · „Színtér létrehozása” (elsődleges). Küldéskor a kötelező mezők hibája mezőnként, a mező alatt `--danger` szöveggel és ikonnal, `aria-describedby`/`aria-invalid`; az első hibás mezőre kerül a fókusz.
Siker: a dialóg bezárul, a lista frissül, az új sor rövid ideig kiemelt (`--primary-soft`), a státuszsáv: „A(z) „{név}” színtér létrejött. Kezdeti Színtérgazda: {gazda neve}.” A fókusz az „Új színtér” gombra tér vissza.
Hibák: lásd 6. szakasz (`validation_error`, `forbidden`, `csrf_failed`, `internal_error`).

#### 3.1.2 Átnevezés (Dialog)

Egy mező (Név, előtöltve), „Mégse” · „Átnevezés”. A típus nem szerkeszthető. A dialóg nem jelenik meg lezárt térnél (a backend `space_closed`-et adna). Siker: státuszsáv „Átnevezve: „{új név}”.”

#### 3.1.3 Projekt-tér lezárása (shadcn **AlertDialog**)

Az alapértelmezett fókusz a „Mégse” gombon van (a Radix AlertDialog így működik). Cím: „„{név}” lezárása”.

Törzs (rövid mondatok, felsorolás):
- „A lezárás után a színtér tartalma és tagsága csak olvasható.”
- „A függőben lévő review-kérések automatikusan visszavonódnak. Az érintett dokumentumok Piszkozat állapotba kerülnek, de nem szerkeszthetők; a beküldött változatok a revíziótörténetben megmaradnak.”
- „A tagságot ezután is csak te, Rendszeradminisztrátorként tudod módosítani (például ha egy kolléga távozik).”
- „Ebben a verzióban a lezárást nem lehet visszavonni.” *(előfeltétel: NK7)*

Gombok: „Mégse” · „Színtér lezárása” (veszély recept). A szöveg **nem ígér értesítést** az érintetteknek (lásd E3). Siker: státuszsáv „A(z) „{név}” projekt-tér lezárva.”; a sor „Lezárt” jelölést kap; a fókusz a sor menügombjára tér vissza. Ismételt lezárás (a backend idempotens 200-zal válaszol) ugyanígy sikeresnek látszik.

#### 3.1.4 Önfelvétel (Dialog) — D56

Cím: „Felvétel a(z) „{név}” színtérbe”. Mező: Szerepkör, két natív rádió: „Szerző” (alapérték) és „Színtérgazda”. Tájékoztató sor: „A felvétel naplózódik, a színtér tagjai nem kapnak róla értesítést.” (átláthatóság; a mátrix szerint a tartalmi jogot ez adja meg, nem az admin szerep). Gombok: „Mégse” · „Felvétel”. Siker: `GET /me` újratöltés; státuszsáv „Felvetted magad a(z) „{név}” színtérbe {szerepkör}ként. Mostantól látod a tartalmát.” A színtér megjelenik a váltóban. Ha már tag: a menüelem nem látszik (a szerepet a Beállítások oldalon a tagok között lehet módosítani).

### 3.2 Rendszeradminisztrátorok (`/admin/admins`)

Adatforrás: `GET /admin/users` (a lista teljes; a szűrés kliensoldali `systemRole` szerint, a felhasználószám kb. 200, lapozás nincs a kontraktusban, lásd NK9).

**Aktuális Rendszeradminisztrátorok** (Card + Table): Név (avatar + név; saját soron Badge „Te”), E-mail (`--text-sm`; csak a Rendszeradminisztrátor látja ezt az endpointot), Utolsó belépés (magyar dátum-idő; hiányzik: „Még nem lépett be”), Műveletek: „Jog visszavonása” (szellem, veszély szín, ikon + felirat).

**Új Rendszeradminisztrátor kijelölése** (Card az alatta): az 3.5 szerinti kereső, de itt a jelöltek az `GET /admin/users` listából szűrődnek kliensoldalon (név vagy e-mail részlet, legalább 2 karakter), mert ez a lista e-mailt is ad, így az azonos nevű kollégák megkülönböztethetők. Csak a nem-admin felhasználók jelennek meg. Gomb: „Jog megadása”.

Megerősítés (AlertDialog) megadáskor: cím „{név} legyen Rendszeradminisztrátor?”; törzs: „Kezelheti a színtereket és a Rendszeradminisztrátorokat, és bármely színtérbe felveheti magát. A színterek tartalmát csak tagként látja.” Gombok: „Mégse” · „Jog megadása” (elsődleges).

Megerősítés visszavonáskor: cím „{név} Rendszeradminisztrátori jogának visszavonása”; törzs: „Utána nem látja az Adminisztráció oldalt, és nem hozhat létre vagy zárhat le színteret. A színtér-tagságai nem változnak.” Saját jognál kiegészítés: „A saját jogodat vonod vissza: utána te sem fogod látni az Adminisztrációt.” Gombok: „Mégse” · „Jog visszavonása” (veszély). Siker saját jognál: `GET /me` újratöltés, átirányítás a Kezdőlapra, státuszsáv „Visszavontad a saját Rendszeradminisztrátori jogodat.”

Hibák: `last_admin` (lásd 6.), `forbidden`, `not_found` („A felhasználó már nem található. Frissítsd a listát.”).
Állapotok: betöltés (skeleton sorok), üres (nem fordulhat elő, legalább egy admin van), hiba (Alert + „Újrapróbálás”); a kereső külön üres/hiba állapota a 3.5-ben.

### 3.3 Mobil (< md): a táblázatok kártya-listává válnak

Egy elem = egy kártya (Card recept, `--space-4` padding): első sor név + műveletgomb, alatta Badge-ek, majd a mezők „címke: érték” párokban. A műveletgomb érintési célmérete `--space-12`. Egyidejűleg csak az egyik megjelenítés van a DOM-ban (nincs duplikált tartalom a képernyőolvasónak). A dialógok mobilon a képernyő szélességéhez igazodnak (`--space-4` margó), tartalmuk belül görgethető, a lábléc gombjai egymás alatt, teljes szélességben.

### 3.4 Színválasztó (komponens: `SpaceColorPicker`)

- A `SPACE_COLOR_PALETTE` 8 színe, egy `<fieldset>` + `<legend>Szín</legend>`, natív rádiógombokkal (képernyőolvasó és nyílbillentyű ingyen).
- Egy elem: kör (`--space-8`, `--radius-full`), `2px --border-strong` körvonallal; a szín az API/`@taltos/shared` érték, **inline `style`-ból** jön (adat, nem komponens-CSS; NK2).
- Kiválasztott állapot **nem csak színnel**: külső gyűrű (`--text`, rés `--surface`) **és** a kör sarkán kis `--surface` korong pipa ikonnal. Fókusz: `--focus-ring`. Hover: gyűrű `--border-strong`.
- Minden elemnek hozzáférhető neve van (pl. „Kék”); a nevek **javaslatok** (a paletta csak hexet ad, NK2): Kék, Zöld, Barna, Lila, Bordó, Kékeszöld, Okker, Indigó (a paletta sorrendjében).
- Szöveg a színen soha nem jelenik meg; a szín csak jelölő (színpont a váltóban, a listában, a fejlécben), mindig név mellett.
- Csak olvasható módban (nincs jog, vagy lezárt tér): a választó helyett színpont + színnév szöveg.

### 3.5 Felhasználókereső (komponens: `UserPicker`)

Saját, könnyű ARIA combobox (nincs `cmdk`; NK3), a **listát a mező alatt, a dialóg folyamában** jeleníti meg (nem lebegő popover, így nincs portál- és fókuszcsapda-gond).

| Állapot | Megjelenés |
|---|---|
| Alap (< 2 karakter) | súgó: „Írd be a kolléga nevét (legalább 2 betű).” Nem küld kérést |
| Keresés | rövid késleltetéssel (debounce) `GET /users?q=`; a lista helyén „Keresés…” sor, `aria-busy` |
| Találatok | legfeljebb 10; sor: avatar + név (`role="option"`); a már tag (ha ismert) sor `aria-disabled`, szövege „Már tag”; a találatszámot élő régió mondja: „3 találat” |
| Nincs találat | „Nincs találat erre: „{szöveg}”. Ellenőrizd a nevet; csak azok kereshetők, akik beléphetnek.” |
| Hiba | „A keresés nem sikerült.” + „Újrapróbálás” gomb; a már beírt szöveg megmarad |
| Kiválasztva | a mező helyén „chip”: avatar + név + „Törlés” (× ikon, név: „{név} törlése”); a kereső újra elérhető a törléssel |

Billentyűzet: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; Fel/Le a sorok között, Enter választ, Esc először a listát zárja (és megállítja az Esc továbbterjedését, hogy a dialóg ne záruljon be), második Esc a dialógot. Érintésnél a sor magassága `--space-12`.
Korlát (kontraktus): a találat csak `id`, név és avatar; **azonos nevű felhasználók nem különböztethetők meg** (NK9).

---

## 4. „Színtér beállításai” oldal (`/spaces/:spaceId/settings`)

### 4.1 Adatok és jogosultságok levezetése

Betöltés: `GET /spaces/:id` (+ `GET /spaces/:id/members`), a saját szerep a `me.spaces`-ből. A felület az alábbi képességeket **kliensoldalon levezeti**, a backend minden esetben újra dönt:

| Képesség | Feltétel |
|---|---|
| leírás és szín szerkesztése | (Színtérgazda vagy Rendszeradmin) **és** nem lezárt |
| név szerkesztése | Rendszeradmin **és** nem lezárt |
| tagok felvétele, szerepváltás | (Színtérgazda **és** nem lezárt) vagy Rendszeradmin (lezárt térben is) |
| tag eltávolítása | ugyanez **és** a színtér nem az Általános |
| önfelvétel gomb | Rendszeradmin és nem tag |
| bármi más | csak olvasható |

### 4.2 Szerkezet

`h1`: színpont + színtér neve (display); alatta Badge-ek: típus (Általános / Csapat / Projekt), állapot („Lezárt” lakattal), és a saját viszonyom: „Színtérgazda” / „Szerző” / „Nem vagy tag”. Fent morzsa (breadcrumb): Rendszeradminisztrátornak „Adminisztráció › Színterek › {név}”, mindenki másnak nincs morzsa. Alatta (ha vonatkozik) **helyzetjelző Alert** (4.3), majd két Card (egy oszlop, max `--content-max`; ≥ lg: Alapadatok `--read-width`-nél nem szélesebb):

**Card 1 — „Alapadatok”** (egy űrlap, `<form>`):

| Mező | Szerkeszthető | Csak olvasható megjelenés |
|---|---|---|
| Név | Input (csak Rendszeradmin) | szöveg |
| Típus | soha | szöveg + súgó „A típus létrehozás után nem módosítható.” |
| Leírás | Textarea, max 2000, számláló | szöveg; üres: „Nincs leírás.” (`--text-subtle`) |
| Szín | `SpaceColorPicker` | színpont + színnév |

Gombsor (csak szerkeszthető állapotban): „Mentés” (elsődleges, csak ha van változás) · „Változtatások elvetése” (szellem). A PATCH **csak a módosult mezőket** küldi (így a Színtérgazda kérésébe nem kerül `name`, ami `forbidden`-t okozna). Nem mentett változás esetén a gombsor mellett `--text-sm`: „Nem mentett módosítások.” (navigációs blokkoló nincs, egyszerűség, NK10). Siker: „✓ Mentve.” + státuszsáv.

**Card 2 — „Tagok”** (`h2`, mellette a létszám: „Tagok (7)”):
- Jobb felül „Tag hozzáadása” (elsődleges, sm), ha a képesség adott.
- Általánosnál a cím alatt `--text-sm --text-muted`: „Az Általános színtér tagsága automatikus: aki be tud lépni, az tag. Tagot nem lehet eltávolítani, csak a szerepét lehet módosítani.”
- **Kevés tag figyelmeztetés** (Alert, info, ha a tagok száma < 3): „Ebben a színtérben kevesebb mint három tag van, ezért nem lehet változást review-ra küldeni (két review-er kell az indítványozón kívül). Vegyél fel további tagokat.” (A tagjai közt nem Színtérgazdának: „Kérd a Színtérgazdát, hogy vegyen fel további tagokat.”)
- Táblázat: **Név** (avatar + név; saját soron Badge „Te”), **Szerepkör** (Badge: „Színtérgazda” primary + ikon, „Szerző” neutral + ikon), **Műveletek** (DropdownMenu, `aria-label` „Műveletek: {név}”; ha nincs elérhető művelet, az oszlop üres, nincs üres menügomb). Sorrend: Színtérgazdák, utána név szerint. E-mail soha nem jelenik meg (D56).
- Menüelemek: „Legyen Színtérgazda” (ha Szerző), „Legyen Szerző” (ha Színtérgazda), „Eltávolítás” (veszély színnel, ha adott). Elválasztó az Eltávolítás előtt.

### 4.3 Helyzetjelző sávok (egyszerre egy, fontossági sorrendben)

| Helyzet | Alert | Szöveg |
|---|---|---|
| Lezárt projekt-tér | warning, lakat | „Ez a projekt-tér le van zárva: a tartalma és a beállításai csak olvashatók.” + Rendszeradminnak: „Rendszeradminisztrátorként a tagságot továbbra is kezelheted.”; mindenki másnak: „A tagságot csak a Rendszeradminisztrátor módosíthatja.” |
| Nem tag Rendszeradmin | info, szem-kereszt ikon | „Nem vagy tagja ennek a színtérnek, ezért csak az adatait és a tagjait látod, a tartalmat nem.” + gomb „Felvétel magamat” (önfelvétel dialóg, 3.1.4) |
| Szerző (nem Színtérgazda) | info | „A beállításokat a Színtérgazdák módosítják: {gazdák nevei}.” |

### 4.4 Tagfelvétel (Dialog)

Cím: „Tag hozzáadása”. Mezők: `UserPicker` (kötelező) és Szerepkör (két natív rádió: „Szerző” alapérték; „Színtérgazda”). Gombok: „Mégse” · „Tag hozzáadása”. Siker: a dialóg bezárul, a lista frissül, a státuszsáv: „{név} felvéve {szerepkör}ként.”, a fókusz a „Tag hozzáadása” gombra tér vissza. A fókusz megnyitáskor a kereső mezőn van.

### 4.5 Szerepváltás

Azonnali, megerősítés nélkül (visszafordítható: a másik menüelemmel visszaállítható; „felhasználói kontroll”). Kivétel: ha a Színtérgazda **saját magát** minősíti vissza Szerzővé (és nem Rendszeradmin), AlertDialog: „Visszaminősíted magad Szerzővé?” / „Utána nem módosíthatod a színtér beállításait és tagjait.” · „Mégse” · „Visszaminősítés”. Siker: státuszsáv „{név} mostantól {szerepkör}.”; a saját szerep változásakor `GET /me` frissül, és az oldal a csak olvasható nézetre vált.

### 4.6 Eltávolítás (AlertDialog)

Cím: „{név} eltávolítása a(z) „{színtér}” színtérből”. Törzs:
- „{név} többé nem látja a színtér tartalmát.”
- „Ha van függő review-kérése, az visszavonódik. Ha review-erként meg volt jelölve, a helye megszűnik, és az indítványozónak új review-ert kell jelölnie.”

Saját eltávolításnál kiegészítés: „Magadat távolítod el: utána nem fogod látni a színteret.” Gombok: „Mégse” · „Eltávolítás” (veszély). Siker: státuszsáv „{név} eltávolítva.”, a fókusz a „Tagok” `h2`-re kerül (a sor megszűnt). Lásd a hibákat a 6. szakaszban.

### 4.7 Nem tag látja a színteret (`not_space_member`)

Ha egy nem tag, nem Rendszeradmin felhasználó megnyitja a hivatkozást (`GET /spaces/:id` → `403 not_space_member`), az oldal nem a szokásos szerkezetet, hanem egy **középre igazított hozzáférés-állapotot** mutat (Card, lakat ikon `--primary-soft` körben):

- `h1`: „Nincs hozzáférésed ehhez a színtérhez”
- Törzs: „A(z) „{details.space.name}” tartalmát és beállításait csak a tagjai látják.”
- „Felvételért fordulj valamelyik Színtérgazdához:” és a `details.managers` listája (avatar + név).
- Ha a lista üres: „Ennek a színtérnek jelenleg nincs elérhető Színtérgazdája. Fordulj a Rendszeradminisztrátorhoz.”
- Gombok: „Vissza a Kezdőlapra”. *(A „Felvétel kérése” gomb a WP23 hatókörébe esik, lásd NK8.)*

Szigorúan: **nincs dokumentumcím, darabszám, taglétszám**; a megjelenített adat kizárólag a `NotSpaceMemberDetails` mezői. A Rendszeradminisztrátor nem ezt látja (neki `space.view` és `space.members.view` engedett).

Más oldalszintű állapotok: **404** `not_found` — „A színtér nem található. Lehet, hogy törölték, vagy hibás a hivatkozás.” + „Vissza a Kezdőlapra”; **betöltés** — skeleton fejléc + két skeleton Card; **hálózati/ismeretlen hiba** — `Alert` + „Újrapróbálás”.

## 5. Jogosultsági és állapot-mátrix (mit lát, mit tehet)

Jelölés: ✓ elérhető · – nincs (elrejtve vagy csak olvasható). „Rendszeradmin” = nem tag Rendszeradminisztrátor (ha tag is, a Rendszeradmin oszlop érvényes, mert a jogai bővebbek).

| Vezérlő | Szerző | Színtérgazda | Rendszeradmin | Lezárt térben (Szerző / Gazda / Admin) | Általánosban |
|---|---|---|---|---|---|
| Beállítások megtekintése (metaadat, tagok) | ✓ | ✓ | ✓ | ✓ / ✓ / ✓ | ✓ |
| Név módosítása | – | – | ✓ | – / – / – | admin ✓ |
| Leírás, szín módosítása | – | ✓ | ✓ | – / – / – | gazda, admin ✓ |
| Tag felvétele | – | ✓ | ✓ | – / – / ✓ | ✓ |
| Szerepváltás | – | ✓ | ✓ | – / – / ✓ | ✓ |
| Tag eltávolítása | – | ✓ | ✓ | – / – / ✓ | **senki** |
| Önfelvétel | – | – | ✓ (nem tagként) | – / – / ✓ | ✓ |
| Adminisztráció elem, oldal | – | – | ✓ | – | – |
| Színtér létrehozása | – | – | ✓ | – | – |
| Lezárás | – | – | ✓ (csak projekt, nem lezárt) | – | nem projekt: nincs |
| Rendszeradmin kijelölése/visszavonása | – | – | ✓ | – | – |

A mátrix a [[Felhasználók/Szerepkörök|Szerepkörök]] mátrixának sorait és a D56 kivételeit követi; a WP4a táblavezérelt tesztje a forrás, ezt a táblát a felületi tesztnek (9. szakasz, 3. pont) kell cellánként ellenőriznie.

---

## 6. Hibaüzenetek és következő lépés

Szabály: a hibaüzenet megmondja, **mi történt** és **mi a következő lépés**, nem hibáztatja a felhasználót, nem tartalmaz kódot vagy belső részletet. A `title`/`detail` szövegre **nem építünk** (B5: szabadon változhat), a felület a `code` alapján választ saját szöveget.

### 6.1 Védőszabály-hibák (a WP4b-ben elérhető műveleteknél)

| `code` (HTTP) | Hol | Üzenet (Alert, `role="alert"`) | Teendő a felületen |
|---|---|---|---|
| `last_space_manager` (409) | szerepváltás (visszaminősítés) | „Ennek a színtérnek legalább egy Színtérgazdája kell legyen. Előbb léptess elő másik tagot Színtérgazdává, utána minősítsd vissza {név} szerepét.” | a lista változatlan; a menüben marad a művelet |
| `last_space_manager` (409) | eltávolítás | „Ennek a színtérnek legalább egy Színtérgazdája kell legyen, ezért {név} nem távolítható el. Előbb léptess elő másik tagot Színtérgazdává.” | dialóg bezár, az Alert az oldal tetején |
| `last_admin` (409) | jog visszavonása | „Legalább egy Rendszeradminisztrátornak maradnia kell. Előbb jelölj ki másik Rendszeradminisztrátort, utána vond vissza ezt a jogot.” | a „Jog megadása” kereső kiemelése (fókusz oda) |
| `owner_handover_required` (409) | eltávolítás | „{név} még nem archivált dokumentumok tulajdonosa, ezért nem távolítható el. Előbb át kell adni a dokumentumait a színtér egy másik tagjának; ezt a tulajdonos vagy a Színtérgazda teheti meg.” | *a tulajdonjog-átadás felülete a WP5/WP11-gyel jön: addig a felhasználó nem tudja a felületen megoldani, NK6* |
| `space_closed` (403) | bármely módosítás (leírás, szín, név, tagság Színtérgazdának) | „Ez a projekt-tér közben lezárult, ezért már csak olvasható. A tagságot a Rendszeradminisztrátor módosíthatja.” | a színtér adatai újratöltődnek, a nézet csak olvasható lesz; a beírt adat a dialógban nem vész el, amíg az nyitva |
| `forbidden` (403) | bármely művelet | „Ehhez a művelethez nincs jogosultságod. Ha szerinted kellene, kérd a Színtérgazdát vagy a Rendszeradminisztrátort.” | `GET /me` újratöltés (a szerep változhatott), a vezérlők frissülnek |
| `forbidden` (403) | tag eltávolítása az Általánosból | „Az Általános színtér tagsága automatikus, ezért tagot nem lehet eltávolítani. A szerepe módosítható.” | – |
| `forbidden` (403) | nem projekt-tér lezárása | „Csak projekt-tér zárható le.” | – |
| `validation_error` (400) | létrehozás, átnevezés | mezőhibák: „Add meg a színtér nevét.”, „A név legfeljebb 80 karakter lehet.”, „A leírás legfeljebb 2000 karakter lehet.”, „Válassz színt.”, „Válaszd ki a kezdeti Színtérgazdát.”; stabil kód híján, ha a szerver mezőjelölés nélkül utasít el: „Nem sikerült menteni. Ilyen nevű színtér már lehet, vagy a megadott adatok nem megfelelők. Válassz másik nevet, és ellenőrizd a többi mezőt.” | a dialóg nyitva marad, minden mező megmarad, a fókusz az első hibás mezőre (NK9) |
| `validation_error` (400) | tagfelvétel | „Ezt a felhasználót nem tudtuk felvenni: lehet, hogy már tag, vagy már nem szerepel a belépésre jogosultak között. Frissítsd a tagok listáját, és próbáld újra.” | a tagok listája újratöltődik |
| `not_found` (404) | bármely | „Ez az elem már nem található. Frissítsd az oldalt.” (színtér esetén lásd 4.7) | lista újratöltés |

### 6.2 Általános (minden művelet)

| `code` (HTTP) | Üzenet | Teendő |
|---|---|---|
| `not_space_member` (403) | lásd 4.7 | hozzáférés-állapot oldal |
| `unauthenticated` (401) | „A munkameneted lejárt. Jelentkezz be újra.” | átirányítás a belépő oldalra (a meglévő kezelővel) |
| `not_on_allowlist` (403) | „A fiókod már nem jogosult a belépésre. Fordulj a rendszergazdához.” | kijelentkeztetett állapot |
| `csrf_failed` (403) | „A művelet nem sikerült, mert a munkameneted frissítésre szorul. Töltsd újra az oldalt, és próbáld újra.” | a `GET /me` újratöltése új tokent ad |
| `internal_error` (500) / hálózati hiba / időtúllépés | „Valami félresikerült nálunk, a változtatás nem mentődött el. Próbáld újra; ha ismétlődik, jelezd a rendszergazdának.” | „Újrapróbálás” gomb, a beírt adatok megmaradnak |

A kontraktus egyéb kódjai (`request_pending`, `request_closed`, `not_enough_reviewers`, `invalid_new_owner`, …) ebben a csomagban nem fordulhatnak elő. Ha mégis, az általános (`internal_error`) szöveg jelenik meg, és nem kódot mutatunk.

---

## 7. Komponensek (shadcn/ui + Radix, D14) és DS-leképezés

Bemásolt, saját tulajdonú komponensek; **csak a ténylegesen használtak** kerülnek be. A Radix-csomagok D14 szerint (2026-10-31 pontosítás) a komponensekhez tartoznak.

| Komponens | Radix-csomag | Használat | DS recept / token |
|---|---|---|---|
| Button | `react-slot` (asChild link-gombhoz) | minden gomb; variánsok: elsődleges, körvonal, szellem, veszély; méret sm/alap | **Gomb** recept; disabled `opacity .45`; fókusz `--focus-ring` |
| Input, Textarea, Label | – (natív) | űrlapmezők | **Input** recept; hiba `--danger` + ikon + szöveg |
| Radio (natív) | – | típus, szerepkör | **Checkbox/Radio** recept |
| Select | `react-select` | színtérváltó | Input recept + menü (NK1) |
| DropdownMenu | `react-dropdown-menu` | felhasználói menü, sor-műveletek | menü recept (NK1) |
| Dialog | `react-dialog` | űrlap-dialógok (létrehozás, átnevezés, önfelvétel, tagfelvétel) | **Modal** recept (`--radius-xl`, `--shadow-xl`, lábléc `--surface-sunken`) |
| AlertDialog | `react-alert-dialog` | lezárás, eltávolítás, jogvisszavonás, önvisszaminősítés | Modal recept; fókusz a „Mégse”-n |
| Sheet (mobil oldalsáv) | `react-dialog` (nincs új csomag) | oldalsáv < lg | Modal recept balról, `--shadow-xl` |
| Badge, Alert, Card, Table, Skeleton, EmptyState, Avatar, NavItem | – | állapotok, szerkezet | Badge/Alert/Card/Table/Avatar recept; Skeleton, NavItem, EmptyState: NK1 |
| `UserPicker`, `SpaceColorPicker` | – (saját) | 3.5, 3.4 | Input, Radio, Menü recept alapján |

**Nem kerül be** (indoklással): toast (`sonner`), combobox (`cmdk`), tooltip, tabs, avatar-Radix, ikon-könyvtár, `motion` — lásd NK3. A mozgás CSS-átmenet (`--duration-fast/base`, `--ease-standard`, `--ease-enter/exit`): dialóg és menü áttetszőség + enyhe elmozdulás; **`prefers-reduced-motion`**: az elmozdulás kikapcsol, csak azonnali (vagy `--duration-fast` áttetszőség) váltás marad.

### 7.1 Javasolt új DS-receptek (NK1, jóváhagyásra)

A DS nem tartalmaz receptet ezekre; tokenekből állítottam össze, bevezetésük a DS-fájl bővítése (nem felülírása).

| Recept | Meghatározás |
|---|---|
| Menü (dropdown/select-lista) | `bg:--surface-raised; border:1px --border; radius:--radius-md; shadow:--shadow-lg; padding:--space-1; z:--z-overlay`; elem `min-height:--space-10; padding:0 --space-3; font:--text-sm`; kiemelt/fókuszált `bg:--surface-sunken`; kiválasztott: pipa ikon + `--weight-semibold`; veszély elem `color:--danger`; disabled `opacity .45` |
| NavItem / oldalsáv | oldalsáv `width:--sidebar-w; bg:--surface; border-right:1px --border; padding:--space-4`; elem lásd 2.3 |
| Skeleton | `bg:--surface-sunken; radius:--radius-sm`; lüktetés `--duration-slower` áttetszőséggel; reduced-motion: statikus |
| Scrim (dialóg/sheet mögött) | `color-mix(in srgb, var(--surface-inverse) 55%, transparent)`; z `--z-overlay`; dialóg `--z-modal` |
| EmptyState | középre igazítva; ikon `--primary-soft` körben (`--radius-full`), cím H3-szerep, törzs `--text-muted`, egy elsődleges gomb; térköz `--space-4`–`--space-8` |
| Színpont | `--space-3` kör, `--radius-full`, `1px --border-strong` gyűrű (a szín az adatból); nagy változat `--space-8` a választóban |
| Combobox-lista | `border:1px --border; radius:--radius-md; bg:--surface; max-height:calc(var(--space-12) * 5); overflow:auto`; sor `min-height:--space-12` |

## 8. Reszponzív, akadálymentesség, sötét téma

- **Töréspontok:** a DS-é (sm 640 / md 768 / lg 1024). Oldalsáv lg alatt Sheet; táblázat md alatt kártya-lista; a szerkezet 360 px-ig egy oszlop, vízszintes görgetés nincs (hosszú nevek `truncate` + `title`-mentes: a teljes név a kártyán/sorban törik, nem vágódik, ahol a név a feladat).
- **Érintés:** minden interaktív elem legalább `--space-10` magas (40px, a DS gombmérete); mobilon az ikongombok és a lista-sorok `--space-12` (≈44px ajánlás). Hamburger, menügomb, szín-választó elemek is.
- **Billentyűzet:** minden művelet egérrel és billentyűzettel is elvégezhető; a Radix komponensek biztosítják a fókuszcsapdát, az Esc-et és a fókusz visszaadását; a `UserPicker` kézi kezelése a 3.5-ben leírt. Nincs kattintható `div`.
- **Fókusz:** `:focus-visible` mindenhol `--focus-ring`; dialógból bezáráskor a kiváltó elemre (ha az megszűnt: a legközelebbi címsorra) kerül.
- **Képernyőolvasó:** táblázat `<caption>` (rejtett) és `scope="col"`; ikonok `aria-hidden` vagy névvel; Badge-ek szöveggel; a státuszsáv `role="status"`, a hibák `role="alert"`; az `aria-busy` betöltéskor; a mezőhibák `aria-describedby`-val kötve.
- **Nem csak szín:** szerep, állapot, hiba, kiválasztás minden esetben ikon és/vagy felirat is.
- **Kontraszt:** a DS szemantikus tokenjei mindkét témában a DS szerint kontraszt-rendezettek; a **színpontok** (paletta) csak jelölők, névvel; a becslésem alapján a paletta egyes színei (pl. Okker, Indigó, Bordó) sötét felületen a 3:1 küszöb közelében lehetnek, ezt **nem mértem le** (NK2).
- **Téma:** csak szemantikus token; komponensenként nincs sötét-stílus. A Radix-portálok a `<body>`-ba renderelnek, így a DS-csapda (fixed popover `backdrop-filter`-es szülő alatt) a menükre/select-re nem vonatkozik; a fejléc `backdrop-filter`-e emiatt biztonságos.
- **Hang:** tegező, cselekvő, nincs zsargon: a felületen „színtér”, „Színtérgazda”, „Szerző”, „Rendszeradminisztrátor”, „review”; nincs „entitás”, „policy”, „tranzakció”, nincs misztikus megfogalmazás.

## 9. Átadás a `frontend-web`nek

1. A tokenek már a `src/styles/tokens.css`-ben vannak; a recepteket az 7. szakasz szerint, csak szemantikus tokennel.
2. Közös `apiFetch` (CSRF-fejléc, Problem Details → `ErrorCode` típus) és a 6. szakasz hibaleképezése egyetlen táblában (kód → üzenet), nem szétszórva.
3. Tesztek: komponensteszt a 5. szakasz mátrixának minden cellájára (megjelenik/nem jelenik meg), minden hibakódra a 6.1 szerint (üzenet és fókusz), az állapotokra (betöltés, üres, hiba, nincs jog), billentyűs út a dialógokban és a `UserPicker`-ben; kézi ellenőrzés 360 px-en és sötét témában.
4. A `HomePage` és a `DocumentPage` változatlan marad; csak a keret (`RootLayout`) cserélődik.

## 10. Megfelelőségi checklist (DS-checklist leképezése)

*Ez a spec-szint ellenőrzése; a build utáni futtatás a `frontend-web` feladata.*

| DS-checklist pont | Állapot a specben |
|---|---|
| Nincs nyers hex/px | Specben csak token. **Kivétel:** a színtér-szín az API/`@taltos/shared` adata, inline `style`-ból (NK2) |
| Csak szemantikus token | Igen; primitívet nem hivatkozunk (a Scrim a szemantikus `--surface-inverse`-ből keveri) |
| Téma | Komponensenkénti sötét-override nincs; **nem ellenőrzött** a színpontok kontrasztja |
| Fókusz | Minden elemen `--focus-ring` (7., 8.) |
| Kontraszt | DS-tokenekre támaszkodik; **nem mértem újra**; színpontoknál NK2 |
| Nem csak szín | Szerep, állapot, hiba, kiválasztás ikon/felirat is |
| Tipográfia | Display csak `h1`; kártyacímek `h2`, H3-szerepű stílus (Inter); adat/azonosító: nincs mono-igény (nincs azonosító a felületen) |
| Ritmus | Térköz/sugár/árnyék skálából; `--read-width`, `--content-max` |
| Reszponzív | 360 px-ig leírva (3.3, 8.); reduced-motion leírva (7.) |
| Szöveg | Cselekvő, tegező, zsargonmentes (6., 8.) |

---

## Döntések (D57, 2026-10-31)

A lenti nyitott kérdésekre a tulajdonos döntött; ahol eltér a spec ajánlásától, a döntés az érvényes:
- **NK1:** az új receptek a `taltos-design-system.md`-be kerülnek (a).
- **NK2:** a paletta adatként marad, kontrasztméréssel mindkét témában (a).
- **NK3 — eltér az ajánlástól:** a szokásos shadcn-kísérőcsomagok bekerülnek (`lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `sonner`; a `motion` a D14 része). Saját ikonkészlet, saját `cn()` és saját kombinált kereső helyett ezek használandók.
- **NK4 — eltér az ajánlástól:** az aktuális színtér szerveroldalon él (`users.current_space_id`, `PUT /api/v1/me/current-space`, `GET /me` → `currentSpaceId`).
- **NK5, NK10, E2–E4:** az ajánlás szerint.
- **NK6:** őszinte szöveg, admin-átadó felület nincs (a). **NK7:** a lezárás végleges (a). **NK8:** most nincs „Felvétel kérése” gomb (a). **NK9:** kliensoldali előellenőrzés és tartalék-üzenet (a).
- **E1:** a Szerző csak olvasható beállítás-nézetet kap.

## Eltérések és nyitott kérdések

Eltérések, ellentmondások (nem oldottam fel csendben):

- **E1 — Mit lát a Szerző?** A mátrix szerint a taglista látható a tagoknak (B5: `members.view` tag), a [[Felhasználók/Szerepkörök|Szerepkörök]] „Felület az MVP-ben” viszont csak *Színtérgazdának* említi a „Színtér beállításai” oldalt. A spec a Szerzőnek **csak olvasható** nézetet ad (ki a gazda, kik a tagok); ez a megkötött feladatleírással egyezik. *Ajánlás:* maradjon így (a Szerzőnek tudnia kell, kitől kérjen felvételt/szerepet); ha nem kívánt, a link a Szerzőnek elrejthető, a backend változatlan.
- **E2 — A lezárás nem bontható vissza és nincs archiválás.** A [[Kollaboráció/Színterek|Színterek]] szerint a lezárt tér archiválása ❓ nyitott; visszanyitó végpont nincs a B5-ben. A lezárási megerősítés ezért kimondja, hogy nem vonható vissza (NK7).
- **E3 — Értesítés a lezáráskor.** A D55 szövege szerint az indítványozó és a review-erek értesítést kapnak; a D56 szerint a WP4 csak eseményt ír, az értesítés a WP10-é. A felületi szöveg ezért **nem ígér értesítést**; a WP10 után a lezárási szöveg bővítendő.
- **E4 — `/me.spaces` kevesebb adatot ad, mint a váltó kellene** (nincs benne szín, lezárt-állapot): a váltó a `GET /spaces`-szel egészül ki. Nem eltérés a kontraktustól, de két forrás összefésülését jelenti. **Nem ellenőriztem**, hogy a `GET /spaces` nem-adminnak a lezárt tereket is visszaadja-e (feltételezés: igen, a `closed` mező ezért van a `SpaceSummary`-ben).

Nyitott kérdések (opciók és ajánlás; nem döntöttem):

- **NK1 — DS-hiányok.** A DS-ben nincs recept: menü/lista, oldalsáv-elem, skeleton, scrim, üres állapot, színpont, combobox-lista, sheet. *Opciók:* (a) a 7.1 javaslatai bekerülnek a `taltos-design-system.md`-be jóváhagyás után; (b) csak a komponens-kódban élnek. *Ajánlás:* (a), különben a következő felület más értékeket talál ki.
- **NK2 — A színtér-paletta a DS-en kívül él.** A `SPACE_COLOR_PALETTE` nyers hex (D56), nem DS-token; a nevek (Kék, Okker, …) az én javaslataim; a sötét felületi kontraszt nem mért. *Opciók:* (a) a paletta adatként marad, inline `style`, a kontrasztot a jóváhagyás előtt mérjük mindkét témában; (b) DS-tokenekbe (`--space-color-1…8`, téma-függően) emeljük, ami a D56 palettájának módosítása. *Ajánlás:* (a) most, a mérés a frontend-review része; (b) csak ha a mérés bukik.
- **NK3 — Függőségek, amelyeket a bemásolt shadcn-komponensek vagy a DS vinne.** A D14-pontosítás csak a **Radix**-csomagokat fedi (itt: `react-slot`, `-dialog`, `-alert-dialog`, `-dropdown-menu`, `-select`). Nincs naplóban és nincs a `package.json`-ban: `lucide-react` (a DS „Lucide”-t ajánl), `class-variance-authority`/`clsx`/`tailwind-merge` (a shadcn `cn`/variáns-segédje), `cmdk` (combobox), `sonner` (toast), `motion` (D14 említi). *Opciók:* (a) naplópontot nyitunk ezekre; (b) a szükséges ~15 Lucide-ikon SVG-jét bemásoljuk (ISC licenc) egy `icons.tsx`-be, saját `cn()` és változat-térkép, saját combobox, státuszsáv toast helyett, CSS-átmenet `motion` helyett. *Ajánlás:* (b), nulla új függőség, a meglévő `buttons.tsx` stílusával egyezik.
- **NK4 — Hol él az „aktuális színtér”?** A naplóban nincs szerver-oldali beállítás. *Opciók:* (a) kliensoldali (böngésző, felhasználónként), plusz az URL ott, ahol színtérhez kötött oldal van; (b) szerveroldali preferencia (új végpont, naplópont). *Ajánlás:* (a).
- **NK5 — A „Beállítások” oldal útvonala és a navigáció elnevezése** (`/spaces/:id/settings`) szabad sáv; ha más a konvenció, módosítható. Kérdés csak akkor, ha a tulajdonos más struktúrát szán (pl. a színtér lapja a WP23 után).
- **NK6 — `owner_handover_required` zsákutca.** A felület kimondja a teendőt (adni át a dokumentumokat), de a tulajdonjog-átadás gombja csak a WP5/WP11-gyel jön; az adminisztratív átadásnak (`POST /admin/users/:id/handover`) a WP4b hatókörében nincs felülete, és a hiba nem sorolja fel, mely dokumentumok akadályozzák. *Opciók:* (a) elfogadjuk, amíg a WP5/WP11 nincs kész, a szöveg őszintén jelzi; (b) a WP4b-be felveszünk egy kis „Dokumentumok átadása” dialógot az Adminisztrációba (a végpont kész), ez hatókör-bővítés; (c) a WP5/WP11 előrehozása. *Ajánlás:* (a), a hatókör szerint; a zsákutcát a pilot előtt a WP5/WP11 oldja.
- **NK7 — Visszanyitás/archiválás.** Lásd E2. *Opciók:* (a) a lezárás a verzióban végleges, és a szöveg ezt mondja; (b) „visszanyitás” végpont naplóponttal. *Ajánlás:* (a) most; (b) csak ha a pilot igényli.
- **NK8 — „Felvétel kérése” gomb a hozzáférés-állapotban.** A D44 szerint a csonk gombot kap; a felvételi kérés felülete a feladatleírás szerint a WP23-é, bár a végpont és a `canRequestMembership` kész. *Opciók:* (a) most nincs gomb, csak a gazdák nevei; (b) egy egyszerű dialóg (opcionális üzenet) a kész végpontra. *Ajánlás:* (a) a megadott hatókör szerint; a zsákutca enyhített (gazdák neve látszik).
- **NK9 — Kontraktus-hiányok a hibakezelésben és a keresésben.** (1) A „név foglalt”, „már tag”, „felhasználó nem található” mind `validation_error`, stabil kód és mezőjelölés nélkül, csak magyar `detail` szöveggel (amelyre a B5 szerint nem építhetünk). (2) A `GET /users` nem ad egyértelműsítő mezőt, **azonos nevű kollégák nem különböztethetők meg** (e-mail szándékosan nincs, D56). (3) A `GET /admin/users` lapozásáról a kontraktus hallgat. *Opciók:* (a) kliensoldali előellenőrzés (név-ütközés a betöltött listán, „Már tag” jelölés) + általános tartalék-üzenet (a 6.1 szerint); (b) stabil `code`-ok/`details.field` felvétele a B5-be (kisebb backend-változás, naplópont). Azonos nevekre: (c) elfogadjuk, az Adminisztráció admin-listája (e-mail) enyhít. *Ajánlás:* (a)+(c) most; (b) ha a pilotban zavar.
- **NK10 — Kisebb, kérdés nélkül vállalt feltevések** (jelöltem, mert nem forrásból jönnek): a „Nem mentett módosítások” csak jelzés, navigációs blokkoló nincs; az Általánosnál a „Tag hozzáadása” elérhető marad (a backend megengedi; nem tudom, mikor jön létre az automatikus tagság egy még be nem lépett felhasználónál); az Általános átnevezhető (a backend nem tiltja); a lezáráskor nincs előzetes darabszám a visszavont kérésekről (nincs rá végpont).

## Kapcsolódó döntések és egységek

D14 (shadcn + Radix-pontosítás), D43, D44, D46, D55, D56 · [[Felhasználók/Szerepkörök|Szerepkörök]] · [[Kollaboráció/Színterek|Színterek]] · [[Felhasználók/Jogosultságok|Jogosultságok]] · [[Felhasználók/Allowlist|Allowlist]] · [[Felhasználók/Bejelentkezés|Bejelentkezés]] · [[Branding]]
