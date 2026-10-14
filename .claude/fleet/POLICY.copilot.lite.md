# Agent-flotta: ALAPÁLLAPOT KI (csak a központi Copilot chat dolgozik)

> Ha te egy flotta-specialista agent vagy (`.github/agents/*.agent.md`), ez a blokk **nem rád vonatkozik**: a saját agent-fájlod Runtime contractját kövesd.

A projektben telepítve van egy 28 szakértős agent-flotta (`.github/agents/`), de **ebben a chatben alapból KI van kapcsolva**. Te vagy az egyetlen ügynök: magad dolgozol, és **nem hívsz custom agentet és nem delegálsz magadtól**.

## Be- és kikapcsolás (a tulajdonos egy mondatával, a chatre érvényes)

- **BE**: ha a tulajdonos kéri a flottát („flotta be”, „használd a flottát”, „használd az ügynök csapatot”, „fleet on”, „indítsd a csapatot”): olvasd el TELJESEN a `.claude/fleet/POLICY.copilot.md`-t, és attól kezdve a chat végéig orchestrátorként, annak szabályai szerint működj. Egy mondatban jelezd: „Flotta BE.” Bekapcsoláskor futtasd: `python3 .claude/fleet/tools/fleet_switch.py on` (Windows: `python`) (a hookok ebből tudják). A kapcsoló skill neve `/agent-fleet` (on|off|status); a Copilot saját, beépített `/fleet` parancsa más (párhuzamos subagent-futtatás), azzal ne keverd.
- **KI**: ha a tulajdonos kikapcsolja („flotta ki”, „fleet off”, „ne használd a flottát”, „csak te dolgozz”): ismét magad dolgozol, nem delegálsz, és a `POLICY.copilot.md` szabályait nem alkalmazod. Jelezd: „Flotta KI.” Kikapcsoláskor futtasd: `python3 .claude/fleet/tools/fleet_switch.py off` (Windows: `python`). A specialisták modelljét bekapcsolt flottánál a flotta választja (`/configure-copilot-models`); a te modelled a tiéd marad.
- **Egy konkrét agent kérése** (a tulajdonos kiválaszt vagy megnevez egy agentet): csak azt az egyet használd, a flotta bekapcsolása nélkül; önálló packettel (TASK / CONTEXT / CONSTRAINTS / ACCEPTANCE CRITERIA).
- Új chat = újra KI.

## Mindig érvényes (a flotta állapotától függetlenül)

Copilotban a telepítő guard-hookja (`.github/hooks/agentic-fleet.json`, ha volt Python) az adatbázis-írást mechanikusan blokkolja; a többi szabály (push, titok) itt fegyelem.

- **Adatbázisba nem írunk**: minden elérhető adatbázison csak olvasás (SELECT, terv, katalógus/DMV). Index, séma, statisztika, migráció, adatjavítás = futtatható script-JAVASLAT (haszon, írási költség, méret, kockázat, rollback), a futtatás a tulajdonosé. Ha a munkád SQL-t érint (natív vagy ORM), optimalizáld idő és tér szerint: `.claude/fleet/ref/sql-optimization.md`.
- **Visszafordíthatatlan/külső lépés** (push bármely távoli branchre, a `develop`-ra is; PR-merge, release, külső levél, törlés): előbb kifejezett jóváhagyás, egy lépésre szólóan. A kérdésbe írd bele az ellenőrzött tényeket (ág, commitok, cél), adj opciókat; a jóváhagyás csak a választott opcióra és ezekre a tényekre szól, változás esetén kérdezz újra; amit nem tudtál ellenőrizni, ott a kockázatosabb esetet feltételezd.
- **Kérdések**: ha homályos a kérés, kérdezz a chatben és állj meg a válaszig; az ajánlott válaszod csak javaslat, SOHA nem alapértelmezés. Amit a repo megválaszol, azt olvasd ki.
- **Stack**: TypeScript end-to-end (Node.js + Fastify, PostgreSQL + Drizzle, Vite + React SPA, pnpm monorepo) + aktív vanília JS prototípus a Táltos Design Systemmel; UI-munka előtt: `Prototypes/.claude/CLAUDE.md`. Kódolás előtt: `.claude/fleet/ref/stack-profile.md`. Ha a projekt gyökerében van használható `graphify-out/graph.json`, a kódfeltárást a gráffal kezdd: `.claude/fleet/skills/graphify-navigation/SKILL.md`.
