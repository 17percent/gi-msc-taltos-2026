# Agent-flotta: ALAPÁLLAPOT KI (csak a központi ügynök dolgozik)

> Ha te egy flotta-specialista vagy (`.claude/agents/*`), ez a dokumentum **nem rád vonatkozik**: a saját agent-fájlod Runtime contractját kövesd.

A projektben telepítve van egy 28 szakértős agent-flotta (`.claude/agents/`), de **ebben a sessionben alapból KI van kapcsolva**. Te vagy az egyetlen ügynök: magad dolgozol, és **nem delegálsz flotta-agentnek, nem hívsz specialistát és nem indítasz reviewert magadtól**, akkor sem, ha a feladat nagy vagy több területet érint.

## Be- és kikapcsolás (a tulajdonos egy mondatával, a sessionre érvényes)

- **BE**: ha a tulajdonos kéri a flottát (`/agent-fleet`, „flotta be”, „használd a flottát”, „használd az ügynök csapatot”, „fleet on”, „indítsd a csapatot”): olvasd el TELJESEN a `.claude/fleet/POLICY.md`-t, és attól kezdve a session végéig orchestrátorként, annak szabályai szerint működj. Egy mondatban jelezd: „Flotta BE.” Bekapcsoláskor futtasd: `python3 .claude/fleet/tools/fleet_switch.py on` (Windows: `python`) (a hookok ebből tudják).
- **KI**: ha a tulajdonos kikapcsolja (`/agent-fleet off`, „flotta ki”, „fleet off”, „ne használd a flottát”, „csak te dolgozz”): attól kezdve ismét magad dolgozol, nem delegálsz flotta-agentnek, és a `POLICY.md` szabályait nem alkalmazod. Jelezd: „Flotta KI.” Kikapcsoláskor futtasd: `python3 .claude/fleet/tools/fleet_switch.py off` (Windows: `python`).
- **Egy konkrét agent kérése** („kérdezd meg a backend agentet”, `@agent-backend`): csak azt az egy agentet hívhatod, a flotta bekapcsolása nélkül. A packet legyen önálló (TASK / CONTEXT / CONSTRAINTS / ACCEPTANCE CRITERIA), mert a specialista nem látja a beszélgetést.
- Új session = újra KI.

## Mindig érvényes (a flotta állapotától függetlenül)

- **Adatbázisba nem írunk**: minden elérhető adatbázison csak olvasás (SELECT, terv, katalógus/DMV). Index, séma, statisztika, migráció, adatjavítás = futtatható script-JAVASLAT (haszon, írási költség, méret, kockázat, rollback), a futtatás a tulajdonosé. Ha a munkád SQL-t érint (natív vagy ORM), optimalizáld idő és tér szerint: `.claude/fleet/ref/sql-optimization.md`.
- **Visszafordíthatatlan/külső lépés** (push bármely távoli branchre, a `develop`-ra is; PR-merge, release, külső levél, törlés): előbb kifejezett jóváhagyás, egy lépésre szólóan. A kérdésbe írd bele az ellenőrzött tényeket (ág, commitok, cél), adj opciókat; a jóváhagyás csak a választott opcióra és ezekre a tényekre szól, változás esetén kérdezz újra; amit nem tudtál ellenőrizni, ott a kockázatosabb esetet feltételezd.
- **Kérdések**: ha homályos a kérés, tedd fel a tulajdonosnak a terminálban (`AskUserQuestion`, döntésenként egy kérdés); az ajánlott válaszod csak javaslat (első opció, „Ajánlott” jelöléssel), SOHA nem alapértelmezés. Amit a repo megválaszol, azt olvasd ki.
- **Stack**: TypeScript end-to-end (Node.js + Fastify, PostgreSQL + Drizzle, Vite + React SPA, pnpm monorepo) + aktív vanília JS prototípus a Táltos Design Systemmel; UI-munka előtt: `Prototypes/.claude/CLAUDE.md`. Kódolás előtt: `.claude/fleet/ref/stack-profile.md`. Ha a projekt gyökerében van használható `graphify-out/graph.json`, a kódfeltárást a gráffal kezdd: `.claude/fleet/skills/graphify-navigation/SKILL.md`.
