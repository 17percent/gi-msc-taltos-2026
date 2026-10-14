---
name: feature-flow
description: Use when the fleet is ON and the owner asks for a code change (feature, bug fix, refactor, architecture change, business requirement): the phase-gated workflow catalog (scope/safety -> requirements -> plan -> implement -> review/QA -> release prep, with per-flow phase variants) and a plan sized to the risk (S: one line, M: short plan, L: full plan with owner approval). Works in Claude Code and GitHub Copilot.
---

# Feature flow: the workflow catalog (phase gates, sized to the risk)

The fleet already has the pieces (grilling, dispatch plans, the dev loop, review rounds, release-manager, push approval). This skill puts them in one order with a gate per phase. **It is not an engine**: you (the orchestrator) walk the phases; deterministic parts are scripts. Same file for Claude Code and GitHub Copilot.

**When:** fleet ON and a request that changes code. Not for questions, explanations or analysis. The owner can override in one sentence: "nem kell terv, csináld" (skip the plan phase, the gates stay) or "előbb mutasd a tervet" (full plan whatever the size).

**A phase is not an agent.** Requirement ≠ `business-analyst`, plan ≠ `engineering-lead`, review only by tier. You do each phase yourself unless the plan names one specialist for a reason (minimum necessary team, depth 1).

## Flows (pick one; the shared phases below stay, only the listed phases change)

The plan-time estimate prints the flow from the task text (`flow: ...` line, below). `?` means several flows matched: you decide and say which in the status line. No match = `feature`.

| Flow | Use for | Phases that change | Extra gate |
|---|---|---|---|
| `feature` | new or changed behaviour (default) | none | none |
| `bug-fix` | wrong behaviour, exception, regression | **1 = REPRODUCE -> DIAGNOSE -> ROOT CAUSE** (repro first, theory second: `diagnosing-bugs` in `.claude/fleet/ref/engineering-skills.md`); 2 = the minimal fix; 3 = regression test red first, then the fix (`test-driven-development` skill) | no implementation without a failing repro test or documented evidence of the cause; if a repro is technically impossible, say why and what evidence replaces it |
| `refactor` | structure changes, behaviour must not | **1 = BASELINE: characterization tests** of the current behaviour, green before any change; 4 = review focus "behaviour preserved" | phase 3 gate: the same tests green and no existing test assertion changed (`git diff` of the test files shows additions only); any intended behaviour change is a separate, owner-approved item |
| `architecture-change` | structural or hard-to-reverse decision | **1-2 = PROBLEM -> CONSTRAINTS -> OPTIONS -> TRADE-OFFS -> OWNER DECISION -> ADR -> implementation plan**; `architect` only if the decision is not trivial, `challenger` only if big, irreversible, costly or highly uncertain | the owner decides between options (always a decision); implementation then continues as `feature` |
| `requirement-to-code` | a business need, not yet a spec | **1 = ambiguity check -> acceptance criteria -> system impact -> technical impact**; `business-analyst` / `systems-organizer` only for a business-process change across roles; then `feature` | acceptance criteria approved by the owner before phase 2 |

**Security is a flag, not a flow:** in any flow, the estimate's appsec signals (auth, secrets, crypto, PII, payment, interop ...) make an `appsec` review round mandatory for M/L. An incident (production down) is not covered here: `sre-observability` per the routing matrix.

## Checkpoint (M/L work that may outlive the session)

- Open: `python3 .claude/fleet/tools/flow_state.py new --flow <flow> --tier <tier> --title "<task>"` (Windows: `python`). S work needs none.
- At each phase change: `flow_state.py set --done <PHASE> --phase <NEXT>`; also `--approval`, `--evidence`, `--finding`, `--round`, `--artifact <path>=<owner>`. In Claude Code the telemetry hook adds each fleet agent and links its log row to the task; in Copilot record them yourself (`--agent <name>`).
- **Resume** (new session, or the owner says "folytasd"): `flow_state.py show` -> continue at the current phase, do not redo finished phases, but treat earlier evidence as stale: run the gate again before any "green" claim. An approval holds only for the facts it named.
- Close: `flow_state.py close` (Copilot / no hook: `close --log`) prints the record line and deletes the state file. This is routine bookkeeping of the fleet's own runtime state, not a deletion that needs the owner's approval: just run it. For M/L it refuses to close until an independent review round ran (with the telemetry hook installed, only the reviewer the hook saw counts; never mark REVIEW done yourself, only the owner waives it with `close --force`).

## Phases and gates

| Phase | What happens | Gate (when to move on) |
|---|---|---|
| **0. Scope and safety** | Check the request against the always-valid rules: database writes, secrets, external/irreversible steps, push. | Nothing forbidden is needed, or the owner decided (a DB change becomes a proposal script). |
| **1. Requirement** | Clarify goal and acceptance criteria. Read what the repo answers; ask the owner the rest for real (grilling: `AskUserQuestion` / Copilot chat; a recommended answer is never the default). | Open questions answered; acceptance criteria written down. |
| **2. Plan** | Estimate the size BEFORE coding (below), then plan at that depth. | S: none. M: no approval unless the plan contains a decision. L, or any decision: **owner approves the plan**. |
| **3. Implement** | The dev loop's gate loop (`.claude/fleet/skills/dev-loop/SKILL.md`): build/test/analyzers, max 3 attempts. Delegate per the plan, or do it yourself. | Green gate. Re-classify the real diff with `loop_tier.py` (it may raise the tier). |
| **4. Review / QA** | The dev loop's review rounds for the tier (M: 1, L: 2), fix rounds with intervention levels and the diff gate. | No open Blocker/Major, or the owner decided at the cap. |
| **5. Release prep** | Summary: what changed, evidence (graded claims), what was not verified, risks, rollback. For a real release: `release-manager`. | **Owner approves any push / PR merge** (scoped confirmation: checked facts in the question). Without approval the work stays on the local branch. |

S-size work goes 0 -> 1 (usually nothing to ask) -> 3 -> 5: no plan text, no review round.

## Phase 2 in detail: estimate, then plan

**Estimate (no model cost, no diff needed):**
```bash
python3 .claude/fleet/tools/loop_tier.py --planned <files or folders the plan will touch> --planned-text "<the task in one sentence>"
```
(Windows: `python`.) It also prints the **flow** (`flow: bug-fix` / `feature` / `?`). It uses the same path signals as the dev loop plus sensitive topics in the task text (auth, secrets, crypto, personal data, SQL/schema, ERP/ForSharp/billing, payment, C++/interop, public contracts, build/dependencies), the project's `.claude/fleet/loop-tiers.json`, and optionally `--affected <N>` from graphify. It prints the tier and whether owner approval is needed. If you cannot name the files yet, run it with `--planned-text` only and repeat once the plan names them. You may raise the tier with a reason (`--raise L --reason "..."`), never lower it.

**Plan depth by tier:**

| Tier | Plan | Owner approval |
|---|---|---|
| **S** | One line: "S: <what I change>, verified by <gate>." | none |
| **M** | 4-6 lines: what changes, where, who does it (you or one specialist), how it is verified (gate + 1 review round). | only if the plan contains a decision (below); otherwise state the plan and proceed |
| **L** | Full plan (template below). | always: options "mehet" / "módosítsd" / "csak egy része" |

**A decision always needs the owner, whatever the tier:** scope beyond the request, a structural change (public signature, contract, schema, file layout), a new dependency, a database proposal script, anything touching a risky area the owner has not signed off.

**Full plan (L):**
1. Goal and acceptance criteria (from phase 1).
2. Scope and non-goals.
3. Affected areas and blast radius (graphify `affected` when a graph exists).
4. Approach and who does what: you; one specialist; or, for a large/unclear epic, an `engineering-lead` dispatch plan. Packets carry PRIORITY and the constraints (no DB writes, SQL optimisation, graded claims).
5. Verification: the gate commands (project profile "Gates") and the review rounds for L (round 2 with a different focus: appsec / database / QA as the estimate says).
6. Risks and rollback.
7. Open decisions, each with options (the recommended one marked, never assumed).

## While working

- **Tier changes are allowed upward only.** If phase 3 or 4 finds more risk (bigger diff, a security issue), raise the tier; if that adds a decision, ask before continuing.
- **Status lines, not chatter:** one line per phase transition ("Terv kész (M), megvalósítás indul", "Kapu zöld, review 1/1").
- **Stop rules** come from the dev loop; at a cap, give the owner the remaining findings, do not extend on your own.

## Record

At the end, one line in the result (and in `.claude/fleet/dispatch-log.md` where the telemetry hook does not run, e.g. Copilot): flow, estimated tier -> final tier, phases run, approvals asked, gate attempts, review rounds, findings fixed / dropped / open. With a checkpoint, `flow_state.py close` prints this line.
