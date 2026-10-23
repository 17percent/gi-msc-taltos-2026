---
tags:
  - taltos/egyseg
allapot: döntve
utem: második
mvp: "2. ütem"
---

# MCP és API

> [!warning] Javaslat — második ütem
> A [[Versenytárs-elemzés]] V1 döntése alapján (Outline-minta). Nem része az MVP-nek. Naplópont: **D38** (Döntési napló v9).

## Cél

Az AI-asszisztensek (Claude, Copilot) közvetlenül, kimásolás nélkül érjék el a publikált promptokat, skilleket és agent-definíciókat. Ez egyben a márka „útmutató” szerepét is kiszolgálja ([[Branding]]).

## Javaslat

- **Csak olvasás, csak a Jóváhagyott revízió** (D45), csak a felhasználó színtereiből (D44).
- **MCP-eszközök (vázlat):** `search_documents` (szűrés kategóriára és színtérre), `get_document` (nyers Markdown, opcionális frontmatter), `list_categories`.
- **Hitelesítés:** felhasználóhoz kötött hozzáférési token (allowlist-ellenőrzéssel); ez új hitelesítési út a D26 cookie-sessionje mellett, ezért külön biztonsági döntés kell róla.
- **Naplózás:** az MCP-hozzáférés naplózandó-e? A D18 szerint az olvasás ma nincs naplózva.

## Nyitott kérdések

- **Zárt színterek és review (D44, D45):** a token a felhasználó színtereit éri el, és a dokumentumok legutóbbi **Jóváhagyott** revízióját adja ki (`approved_revision_id`). Ez a korábbi kérdést (draftba esés) is megoldja. Lásd [[Dokumentumok/Státusz-workflow|Státusz-workflow]].
- ~~REST alap, MCP vékony réteg?~~ **Döntve (D49):** igen, az MCP-szerver a `/api/v1` olvasó végpontjait hívja (egy jogosultsági pont).
- ~~Draftba esés?~~ **Tárgytalan (D45):** az MCP mindig a legutóbbi Jóváhagyott revíziót adja.
- **Többformátum (D42):** nem markdown formátumnál a kinyert szöveg + letöltési link az eredetihez.
- Nyitott (D38): az MCP-olvasás naplózása.

## Kapcsolódó egységek

[[Kimenet/Vágólap és letöltés|Vágólap és letöltés]] · [[Felfedezés/Keresés|Keresés]] · [[Felhasználók/Bejelentkezés|Bejelentkezés]]
