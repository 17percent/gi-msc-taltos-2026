# Routing matrix

Elv: a legkisebb elegendő csapat. "Ne hívd automatikusan" = csak explicit indokkal. Két lépés, két kérdés: **1. workflow routing** (MIKOR, milyen sorrendben, milyen kapukkal: `feature-flow`) és **2. capability routing** (KI: a szükséges képesség gazdája). A workflow nem nevez meg agentet ott, ahol a capability dönt: például bug-fix → a hibaok egy T-SQL lekérdezés → `sql`/`query-optimization` capability → database-data-engineer.

## 1. Workflow routing (`.claude/fleet/skills/feature-flow/SKILL.md`)

A flow-t a `loop_tier.py --planned-text` adja (`flow:` sor; `?` = az orchestrátor dönt). Egy fázis nem jelent automatikusan agentet: alapból minden fázist az orchestrátor visz, specialista csak a 2. táblázat szerint, indokkal.

| Flow | Eltérő fázisok | Alapból | Specialista csak ha | Review (tier szerint) |
|---|---|---|---|---|
| feature | – (0-5 közös váz) | orchestrátor | a terv egy domain gazdáját nevezi meg | code-reviewer (M: 1 kör; L: 2 kör, a második más fókuszú) |
| bug-fix | 1 = reprodukció → diagnózis → hibaok; 3 = előbb piros regressziós teszt | orchestrátor | a hibaok egy domainhez köt (capability) | code-reviewer |
| refactor | 1 = characterization tesztek; 3 = ugyanazok zöldek, assertion nem változik | orchestrátor | nagy, több projektet érintő átszervezés | code-reviewer (fókusz: viselkedés megmaradt) |
| architecture-change | 1-2 = probléma → korlátok → opciók → tulajdonosi döntés → ADR | orchestrátor; architect ha nem triviális | – | challenger csak nagy/irreverzibilis/drága döntésnél |
| requirement-to-code | 1 = kétértelműség → elfogadási kritériumok → hatás | orchestrátor | business-analyst / systems-organizer: több szerepet érintő üzleti folyamatváltozás | product-owner csak scope/elfogadási döntésnél |
| (security flag, bármely flow) | appsec jel a becslésben | – | – | appsec (M/L) |

## 2. Capability routing

A „Capability” oszlop a generált `.claude/fleet/docs/capability-registry.md` tagjeire hivatkozik (ott látszik, ki szerkeszthet és ki futhat párhuzamosan).

| Feladattípus | Primary | Optional | Review | Ne hívd automatikusan | Capability |
|---|---|---|---|---|---|
| Backend bug | backend | database-data-engineer (ha query/schema érintett) | code-reviewer | architect, product-owner, qa-automation, appsec (kivéve security trigger), challenger | backend-bugfix |
| Backend endpoint / feature | backend | database-data-engineer, integration-engineer | code-reviewer; qa-automation L-nél (2. kör) vagy hiányos teszteknél | engineering-lead (single-domain), challenger | backend-api, business-logic |
| Egyszerű UI változás | frontend-web | ux-ui-designer (csak új flow) | code-reviewer | product-experience, quality-lead, qa-automation | ui-implementation |
| UI/UX új felület | ux-ui-designer → frontend-web | product-experience (jelentős ember-rendszer interakció) | code-reviewer | architect, business-analyst | ux-design, ui-implementation |
| SQL query / index | database-data-engineer | – | code-reviewer | architect, QA | query-optimization, sql |
| Schema / migráció | database-data-engineer | architect (ha cross-service), release-manager (éles migráció) | code-reviewer | challenger (kivéve irreverzibilis adat-művelet) | schema-design, migration-script |
| Python szolgáltatás / ETL | python-engineer | integration-engineer, database-data-engineer | code-reviewer | ml-cv-engineer, mlops-engineer | python, etl-pipeline |
| Dokumentáció | technical-writer | business-analyst (forrásanyag) | – | QA, code-reviewer, appsec | documentation |
| Cross-domain feature (FE+BE+DB) | kicsi/egyértelmű: az orchestrátor tervez (mérve: 3/3 jó terv lead nélkül); nagy/bizonytalan epic: engineering-lead (dispatch plan) → backend, frontend-web, database-data-engineer **csak az érintettek** | architect (ha contract nyitott) | code-reviewer, qa-automation | product-owner, challenger, platform-lead | technical-planning, dispatch-plan |
| Architektúra-kérdés | architect | technical-researcher (csak külső bizonyíték kell) | challenger (nagy/irreverzibilis) | engineering-lead (kivéve implementációs terv is kell) | architecture, adr |
| Technológia-összehasonlítás | technical-researcher (ephemeral) | trend-scout | – | architect, product-owner | framework-comparison, external-research |
| Követelmény-elemzés | business-analyst | systems-organizer, ux-ui-designer | product-owner (elfogadás) | architect, engineering-lead | requirements, acceptance-criteria |
| Scope / prioritás döntés | product-owner | project-manager | – | BA, architect | prioritization, acceptance-decision |
| Security-érintett (authn/z, tenant, secrets, PII, trust boundary, kripto, külső kitettség) | appsec | architect (security-architecture) | code-reviewer | challenger (kivéve nagy döntés) | security-review, threat-modeling |
| Pipeline / CI | devops-engineer | platform-lead (governance) | code-reviewer | release-manager, SRE | ci-cd |
| Azure infra | azure-cloud-engineer | devops-engineer, platform-lead | appsec ha identity/secrets | architect | cloud-infra |
| Incidens / observability | sre-observability | platform-lead, backend | – | quality-lead | incident-diagnosis, observability |
| ML/CV feature | ml-cv-engineer | mlops-engineer, python-engineer | code-reviewer | quality-lead | ml-training, computer-vision |
| Release | release-manager | platform-lead, project-manager | quality-lead (gate), qa-automation | challenger (kivéve jelentős release) | release-readiness, rollback-plan |
| Kódreview (PR/diff) | code-reviewer | appsec (mély security), qa-automation (gyenge teszt) | – | architect, quality-lead | code-review |
| Fókuszált 5 fájl elemzés (pl. race condition) | ephemeral subagent (Explore/general-purpose) | – | – | fleet-agent (kivéve ha ownership kell) | – |
| Nagy, irreverzibilis döntés | architect / product-owner | technical-researcher | **challenger** | – | decision-challenge, pre-mortem |

Stack (2026-10-05): .NET / C# / Blazor / ForSharp / C++ / MS SQL. Backend sor = C# szolgáltatás, ForSharp és natív C++ (nincs külön C++ agent); UI sor = Blazor; SQL sor = T-SQL; ERP-interface változás = integration-engineer + backend. Lásd `.claude/fleet/ref/stack-profile.md`.

Eszkalációs sorrend, ha a primary elakad: saját `reportsTo` lead (dispatch plan) → orchestrator (fő session) → a tulajdonos, azaz a felhasználó (valódi üzleti/architektúra trade-off).

<!-- project-overlay:project-routing -->
### Projekt: Táltos

| Feladattípus | Primary | Review | Megjegyzés |
|---|---|---|---|
| Prototípus-változás (vanília JS/CSS) | frontend-web (új flow: előtte ux-ui-designer) | code-reviewer | DS-checklist kötelező; külső könyvtár tilos |
| React SPA | frontend-web | code-reviewer | közös sanitize-pipeline |
| Fastify endpoint / üzleti logika | backend | code-reviewer | auth/mentés-útvonal: L-tier + appsec |
| Séma / migráció / keresőindex | database-data-engineer | code-reviewer | megírja, nem futtatja |
| OIDC-szolgáltató / export | integration-engineer (+ backend) | code-reviewer + appsec | |
| Compose / CI / backup | devops-engineer | code-reviewer | |
| Terv-dokumentum, README | technical-writer | – | döntés-tartalom: architect + tulajdonos |
| Azure infra | – | – | csak kifejezett kérésre (azure-cloud-engineer) |
<!-- /project-overlay:project-routing -->
