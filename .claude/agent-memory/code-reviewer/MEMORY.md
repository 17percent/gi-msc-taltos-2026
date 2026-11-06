# code-reviewer — projekt-memória (Táltos)

- (2026-11-06, WP5a) A `visibleDocumentsWhere` a `documents` táblára teljes minősítéssel hivatkozik: a raw SQL-ben a `documents` táblát alias nélkül kell használni (`documents/pg-document-store.ts`, `tags/pg-tag-store.ts`).
- (2026-11-06, WP5a) A `single-point.test.ts` csak a fájl-szintű `visibleDocumentsWhere` szöveget keresi: egy fájlon belüli, nem builderes dokumentum-olvasást nem jelez, ezt kézzel kell nézni.
- (2026-11-06, WP5a) Eldobás és beküldés: a `documents` sort `FOR UPDATE`-tel kell zárolni a feltételes UPDATE előtt (az EvalPlanQual a `NOT EXISTS` al-lekérdezést régi pillanatképpel értékeli). A WP8 beküldésénél ellenőrizd a zársorrendet: színtér `FOR SHARE`, majd dokumentum `FOR UPDATE` (B4 nyitott pontjai).
- (2026-11-06, WP5a) Revízió-pillanatképből kiadott hivatkozás (`approvedMetadata.links`) a D44 szerint szűrendő: a nem látható cél `{hidden:true, spaceId}`.
