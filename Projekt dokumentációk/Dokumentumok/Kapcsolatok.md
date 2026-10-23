---
tags:
  - taltos/egyseg
allapot: döntve
mvp: 16
---

# Kapcsolatok

> [!success] Döntve — D39
> Rögzítve a [[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]]-ben ([[Versenytárs-elemzés]] V35–V39). MVP 16. pont.

## Cél

A dokumentumok közötti valódi, jelentéssel bíró összefüggések rögzítése. Ma a kapcsolat csak származtatott (közös kategória vagy közös szerző).

## Működés a prototípusban

Az Élő Atlasz élei **származtatottak**: közös kategóriából (a közös szerző él `LINK_BY_COAUTHOR` kapcsoló mögött ki van kapcsolva; `Prototypes/tudasbazis-prototype/home/graphModel.js`). Kifejezett kapcsolat csak egy van: duplikáláskor a `duplicated_from` esemény mindkét dokumentumon.

## Javaslat

Explicit, irányított kapcsolatok egy `document_links` táblában (`from_id`, `to_id`, `type`, `created_by`, `created_at`, `deleted_at`).

| Típus | Jelentés | Példa |
|---|---|---|
| `hivatkozik` | a tartalomban `[cím](doc:uuid)` link (D39; ~~`[[…]]`-szintaxis~~, V41 elvetette), mentéskor kinyerve | guide → prompt |
| `épít_rá` | kézzel megadott függés | agent-definíció → rendszerutasítás |
| `helyettesíti` | elavult változat utódja | v2 prompt → v1 prompt |
| `származik` | duplikálásból vagy sablonból, automatikus | másolat → eredeti |

- A tartalmi hivatkozások mentéskor automatikusan frissülnek (ugyanabban a tranzakcióban).
- Az Atlasz élei: explicit kapcsolat erősebb vonallal, közös címke halványan. **Döntve (V39):** minden explicit kapcsolat egységes erejű rugóként hat az erőszimulációban; a típust csak a vonalstílus jelzi (pl. `helyettesíti` szaggatott, `származik` halvány).
- A dokumentumnézetben „Visszahivatkozások” panel (mint az Obsidian backlinks).
- **Mind a négy típus az első körben (döntve).** A `hivatkozik` és a `származik` automatikus; az `épít_rá` és a `helyettesíti` kézzel adható meg egy **kapcsolat-szerkesztővel** a dokumentumnézetben (cél kiválasztása kereséssel, típus legördülőből, törlés soft delete-tel).
- A `helyettesíti` kapcsolat célpontja „elavult” jelzést kap a listában és az Atlaszon.
- Kapcsolat átléphet színterek között, de ~~„mivel az olvasás mindig nyitott, a cél mindig látható”~~ (D30) → **D44:** csak olyan színtér dokumentumára hozható létre, amelynek a felhasználó tagja; az idegen színtérbe mutató link csonkként jelenik meg (lásd lent).
- **Metaadat (D45, D51e):** a kapcsolatok a piszkozat metaadatának részei, a review-ra küldéssel véglegesednek. A felület az élő (legutóbbi) kapcsolatokat mutatja állapotjelzővel; a Jóváhagyott pillanatkép az exportba, az MCP-be és a nyers letöltésbe kerül.
- Minden kézi kapcsolatváltozás eseményt naplóz (`link_added`, `link_removed`).

## Kapcsolódó döntések

[[Tervezés/Tervezés (hetedik kör)/tudasbazis-architektura-dontesi-naplo|Döntési napló v10]] — D17 (`duplicated_from`), D28, D30 (duplikálás színterek között), D33, **D39**.

## Nyitott kérdések

- ~~Ki adhat hozzá kézi kapcsolatot?~~ **Döntve (V35), módosítva (D44):** a forrásdokumentum színterében Szerző joggal rendelkező felhasználó; ~~a célszíntérben nem kell jog~~ → a célszíntérnek tagnak kell lennie (írási jog nem).
- ~~`helyettesíti` másik színtér dokumentumára?~~ **Döntve (V36):** beleegyezés nem kell; a cél tulajdonosa értesítést kap, és a kapcsolatot törölheti (`link_removed`).
- ~~Szintaxis (V37)?~~ **Felülírva (V41–V43):** nincs `[[`-gépelés. Kapcsolat a szerkesztő **helyi menüjéből** (jobb kattintás → „Kapcsolat beszúrása”) szúrható be: a célt dokumentumkeresőből, a típust (hivatkozik / épít_rá / helyettesíti) listából választja a felhasználó. A kijelölt szöveg linkké válik, a kapcsolat a típusával a **Tulajdonságok** panelen jelenik meg (V43). Belső tárolás változatlan: a szövegben `[cím](doc:uuid)`, a kapcsolat a `document_links` táblában.
- **Frontmatter (V42):** a kapcsolatok és a típusuk a Tulajdonságok panelen láthatók és szerkeszthetők, és frontmatterként kerülnek az `.md`-letöltésbe, az exportba és az MCP-be. Az igazság a `document_links` tábla (a 4. fejezet elve marad).
- ~~Link törlése?~~ **Döntve (V48):** a szövegbeli link és a kapcsolat **egy egység**: ha a link eltűnik a szövegből, a kapcsolat is megszűnik, típustól függetlenül (`link_removed`). Fordítva is: a kapcsolat törlése a Tulajdonságok panelen a szövegbeli linket is eltávolítja.
- ~~Felvétel a panelen?~~ **Döntve (V49):** igen; a panelen felvett kapcsolat linkként a dokumentum végén lévő „Kapcsolódó dokumentumok” szakaszba kerül (ha nincs, a rendszer létrehozza).
- ~~Több link ugyanarra a célra?~~ **Döntve (V54):** linkenként külön kapcsolat a saját típusával; a Tulajdonságok panel célonként csoportosít, az Atlaszon célonként egy él van.
- ~~Ütemezés?~~ **Döntve (V38):** MVP-levélcsomag (16. pont), a kiesési sorrendben az e-mail után.
- ~~Atlasz-rugó?~~ **Döntve (V39):** egységes erő.
- ~~A cél tulajdonosának törlési joga?~~ **Döntve (V50):** a cél tulajdonosa a rá mutató `helyettesíti` kapcsolatot törölheti; mivel a kapcsolat a forrás szövegéhez kötődik (V48), a szövegbeli link is eltűnik. Ez **rendszer által írt revízió** a forrásdokumentumon (a cél tulajdonosának nevében, `link_removed_by_target` eseménnyel, a forrás tulajdonosa értesítést kap) — **kifejezett kivétel** a színtér-írási határ (D31) alól, kizárólag erre a műveletre.
- ~~Draftba visz-e a V50?~~ **Döntve (V53, D45):** nem; a forrás Jóváhagyott marad, a rendszer-revízió review nélkül íródik; a forrás tulajdonosa értesítést kap. (~~V6 „publikált → draft”~~ a D45-tel megszűnt.) Hogy a rendszer-revízió növeli-e az `iteration`-t, és mi történik, ha a forrásnak függő kérése vagy élő piszkozata van: ❓ nyitott (NY11–NY19 a naplóban).
- ❓ **Nyitott (NY11–NY19 a naplóban):** a kapcsolat típusa hogyan tárolódik a szövegben, ha egy célra több, eltérő típusú link mutat (V54); a `származik` (nincs szövegbeli linkje) viszonya a „link és kapcsolat egy egység” (V48) szabályhoz; mi legyen, ha a `helyettesíti` célja tulajdonosa nem tagja a forrás színterének (értesítés és törlési jog, D44); az idegen színtérből érkező visszahivatkozások megjelenítése.
- ~~Archivált cél?~~ **Döntve (V51):** a link halványan, „archivált” jelöléssel jelenik meg; kattintásra az archivált dokumentum nézete nyílik (visszaállítás a jogosultaknak); az Atlaszon az él nem látszik.
- **Zárt színterek (D44):** kapcsolat csak olyan színtér dokumentumára hozható létre, amelynek a felhasználó tagja (a V35 módosul: tagság kell, írási jog nem). Ha egy nem tag olyan linket lát, amely idegen színtérbe mutat, csonkot kap: a cél címe rejtve, „Felvétel kérése” gombbal; az Atlaszon ilyen él nincs.

## Kapcsolódó egységek

[[Felfedezés/Élő Atlasz|Élő Atlasz]] · [[Dokumentumok/Címkék|Címkék]] · [[Szerkesztés/Létrehozás forrásból|Létrehozás forrásból]]
