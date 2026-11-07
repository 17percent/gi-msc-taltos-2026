# qa-automation — projekt-memória (Táltos)

- (2026-11-07, WP5b) A `RouteHandler` a `src/test/helpers.tsx`-ben `Promise<Response>`-t is visszaadhat: így tesztelhető a versenyhelyzet tetszőleges sorrendű válaszfeloldással (lásd `deferredSearch` a `TagPicker.test.tsx`-ben).
- (2026-11-07, WP5b) A `TagPicker` „Új címke” sora `key={newRowState}` miatt állapotváltáskor újra létrejön: a teszt ne tartson meg régi elemhivatkozást, mindig kérdezze le újra.
- (2026-11-07, WP5b) Nyitott Radix `AlertDialog` alatt a háttér `aria-hidden`, ezért a `getByRole('main')`-hez `{ hidden: true }` kell. Az oldalsáv is kiírja a „Lezárt” szót és a „Színtér beállításai” linket, ezért az ilyen assertiont a `main`-re kell szűkíteni.
- (2026-11-07, WP5b) A `DocumentPage.test.tsx` első tesztje viseli a lusta route-import hideg betöltését; a `beforeAll` előmelegítés a jelenlegi javítás, a gyökérok terhelés alatt nem igazolt.
