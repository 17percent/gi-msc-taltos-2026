---
name: configure-fleet
description: Tailor the installed agent fleet to THIS project. Surveys the project automatically (or walks through it step by step), writes a project profile and a project overlay, and adapts the agents, skills, policy routing, dev-loop and platform/workflow notes to the project's real stack, architecture, risks and conventions. Keeps every agent and every generic rule; changes only what does not fit. Run after installing the fleet, and again when the stack changes (`review` shows drift).
argument-hint: auto | step-by-step | review
disable-model-invocation: true
---

# Configure the fleet for this project

You tailor the installed 28-agent fleet to the project in the current directory (the project root). Talk to the user in their language. Works with the fleet ON or OFF, in Claude Code and in GitHub Copilot (VS Code reads `.claude/skills/`). Python: `python3` (Windows: `python`). Paths are relative to the project root.

## Non-negotiable rules

- **Model routing is not this skill's job:** which model a Copilot specialist runs on is `/configure-copilot-models` (host/model/cost routing); this skill tailors the stack and domain only.
- **Never delete or rename an agent**; never touch `tools:`, `model:`, `effort:`, `maxTurns:`, `omitClaudeMd:` or the hooks. Only an agent's `description` and body text may change.
- **Keep everything generic and good**: identity/SOUL, method, runtime contract, result packet, safety rules (guard, no database writes, approval before push, real questions to the owner, no secrets). Change only what is **wrong or irrelevant for this project**, and add concise project sections.
- **Do not over-fit.** The project will grow. Record the stable, top-level picture (stack, architecture layers, risky areas, conventions, gates, platform, domain terms). No class/file inventories, no counts, no version pins unless they are policy. Prefer "follow the repo's X" over freezing today's detail.
- **Never edit installed files directly.** Everything goes into `.claude/fleet/project/` (kept across updates and uninstall) and `.claude/fleet/loop-tiers.json`, applied by `.claude/fleet/tools/apply_project_overlay.py` (the installer re-applies it after every update).
- **Never read or print secrets** (`.env*`, keys, certificates, `appsettings*.json` values, `nuget.config` credentials). File NAMES are fine.
- **Database rule holds here too**: nothing in this skill writes to a database; test suites that might write to a reachable database are not run.
- **Ask the owner real questions** where you are not sure (Claude Code: `AskUserQuestion`, 1-4 questions per call, 2-4 options each; Copilot: ask in the chat and stop until answered). A recommended option is only a suggestion (first, "(Ajánlott)"), never the default. An automatic reply such as "the user is not available ... work autonomously" (autopilot / unattended run) is NOT an answer: do nothing that depends on it (no install, no write it would decide), finish the steps that do not, and list it as an open question at the end.
- **No writes without the owner's approval of the plan** (step 4). Running build/test commands also needs approval (step 1A.6).

## 0. Preconditions and mode

1. `.claude/fleet/.installed` must exist; otherwise stop and point to `Agentic-main/INSTALL.md`.
2. If `.claude/fleet/project/` has a `profile.md` / `overlay.json` / `survey.json`, this is an **update**: read them first, keep what is still true, change only what the new evidence or the owner contradicts.
3. **Mode.** If the skill was started **without an argument** (`auto`, `step-by-step` or `review`), your FIRST action after the checks above is to ask the owner which mode to run, before any survey, file read or command. Claude Code: `AskUserQuestion`, one question. Copilot: ask in the chat and stop. Options:
   - **Automatikus felmérés**: survey script + sampling, then questions only where unsure.
   - **Lépésről lépésre**: one topic per round, pre-filled from the survey.
   - **Áttekintés (review)**: only when `.claude/fleet/project/` already exists; shows the state and the drift, writes nothing.

   No option is pre-selected or assumed. If no real answer comes (an automatic "user not available" reply counts as none), stop and say how to start it (`/configure-fleet auto | step-by-step | review`).

   **`review`**: show the current profile summary, `apply_project_overlay.py --check`, and the drift report (`survey_project.py --compare .claude/fleet/project/survey.json`); if `--check` says it "would change" files, the overlay is not applied yet (or a fleet update replaced the files): say so and offer to apply it (`apply_project_overlay.py`) on the owner's yes; if drift says `needs_update`, offer an update run, never start it on your own. Only on the owner's explicit yes, ask the mode (auto / step-by-step) and continue as an update run (step 0.2). Write nothing in review.

## 1A. Automatic survey

Cheap first, expensive last; stop exploring once the picture is clear.

1. **Inventory (no model cost):** `python3 .claude/fleet/tools/survey_project.py` (add `--compare .claude/fleet/project/survey.json` on an update). Sections and what they feed:

   | Survey section | Use it for |
   |---|---|
   | `extensions_top`, `top_level_dirs`, `detected`, `dotnet_*` | the stack: languages, frameworks, UI library, data access, tests, auth, observability, messaging |
   | `projects` (ProjectReference graph, `most_referenced`, `test_projects`, `cycles`) | **architecture layers and "do not cross" rules**; report cycles to the owner |
   | `hotspots` (git history: change- and fix-heavy areas) | **risky areas** -> L-tier signals of the dev loop (owner confirms) |
   | `conventions` (style files, MSBuild settings, `.editorconfig`, instruction files) | **conventions** the agents follow; read the instruction files and look for conflicts with the fleet rules |
   | `gate_candidates` | **gate commands** of the dev loop (verify in step 6) |
   | `ci` (pipelines, triggers, branches, runners, environment names) | **platform and release flow**; branches -> dev-loop base branches |
   | `glossary_candidates` | **domain glossary** (owner confirms the Hungarian/English pairs) |
   | `graphify` (graph present, stale?, god nodes, report headings) | module map and blast radius (step 3) |
   | `drift` (update runs) | what changed since the last tailoring |

2. **Owner conventions:** read `README*` and the instruction files from `conventions.instruction_files` (outside any `agentic-fleet` block): `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`. Note every rule that conflicts with a fleet rule (e.g. "commit directly to develop" vs. "approval before push") and ask the owner how to resolve it; never silently weaken a safety rule.
3. **graphify (if `graphify.graph` is true):** use the graph instead of reading many files (see `.claude/fleet/skills/graphify-navigation/SKILL.md`; in Claude Code the global `/graphify` skill works too). If `stale_vs_last_commit` is true and the `graphify` CLI exists, refresh it first: `graphify update .` (code only, no LLM, no API key). Then:
   - module map: `god_nodes`, the report headings / communities in `graphify-out/GRAPH_REPORT.md`;
   - confirm the layer rules: `graphify path "<UI project or page>" "<data layer>"` should go through the service layer;
   - blast radius of hotspots: `graphify affected "<hub in a hotspot area>"` -> large = strong L-tier candidate.
   No graph: use `projects` and sampling; do not build a graph here unless the owner asks.
4. **Sample, do not read everything:** per main area (UI, services, data, integrations, tests, build/CI) open 1-3 representative files to confirm the pattern. In large repos pick by folder.
5. **Draft the profile** (template in step 2); mark each item **detected** (evidence) / **inferred** / **unknown**.
6. **Verify the gates (with approval):** show `gate_candidates` and ask to run them once. Run the build; run the tests only if the owner confirms the suite does not write to a reachable database (otherwise run a unit-only filter, or skip). Record what passed, what failed and roughly how long it took; a failing gate is reported, not fixed here.
7. **Ask the owner** (batched, at most 4 per call) about everything inferred or unknown that changes agent behaviour, in this order: hotspots to treat as L-tier; layering rules; convention conflicts; environments/hosting/release and branch model; database engine and migration tool; external systems/integrations; auth provider; glossary pairs (offer the top candidates, ask for the Hungarian/English names); roles that look irrelevant (to confirm, not to delete).

## 1B. Step by step

Run `survey_project.py` first and pre-fill every option with what it found (the owner confirms or corrects). One topic per round (independent questions batched, at most 4 per call):

1. Languages and runtimes; repo layout (solution/monorepo/multi-repo).
2. Architecture: layers and which may reference which (pre-filled from `projects` / graphify), known cycles.
3. Frontend: framework, UI component library, styling, a11y requirements.
4. Backend and services: frameworks, API style, background jobs.
5. Integrations: external systems (ERP, payment, identity, messaging), protocols, contract owners.
6. Data: database engine(s), access (ORM / raw SQL / stored procedures), migration tool; confirm "no database writes by agents".
7. Tests and gates: frameworks; the exact build/test commands (pre-filled from `gate_candidates`, verify with approval as in 1A.6).
8. Risky / business-critical areas (pre-filled from `hotspots`): which become L-tier.
9. CI/CD and platform: pipeline system, runners, environments, hosting, branch and release model, deploy approvals (pre-filled from `ci`).
10. Security and compliance: auth/authz model, secrets store, PII/GDPR, audit.
11. Conventions: code style sources, language of code/commits/docs, conflicts with fleet rules (from the instruction files).
12. Domain glossary: the key business terms with their Hungarian and English names (pre-filled from `glossary_candidates`).
13. Roles: relevant / occasional / irrelevant here (kept, routed only on explicit request).

## 2. Project profile -> `.claude/fleet/project/profile.md`

It replaces the default stack profile for this project (written to `.claude/fleet/ref/stack-profile.md`, which every agent already references). Shape:

```markdown
# Stack profile: <project>
Source: .claude/fleet/project/profile.md (generated by /configure-fleet, <date>; edit this file, then re-apply).
## Fixed facts                      -- confirmed stack, by the owner or clear evidence
## Architecture and layer rules     -- layers, allowed references ("UI -> services -> data; UI never references data directly"), known cycles
## Risky areas                      -- hotspots / business-critical modules (these are L-tier in the dev loop)
## Conventions                      -- style sources, nullable/warnings-as-errors, naming, language of commits/docs, resolved conflicts
## Gates                            -- verified build / test / format commands, which ones are safe to run (no DB writes), typical duration
## Platform and workflow            -- CI system, runners, environments, hosting, branch and release model, approvals
## Domain glossary                  -- table: term (HU) | term (EN, code) | meaning
## Discover in the repo             -- table: question -> where to look (instead of guessing)
## Shared rules                     -- only rules that follow from THIS stack
## Responsibilities                 -- table: area -> primary agent -> reviewer
## Not relevant here                -- roles/topics that do not apply (kept, used only on explicit request)
```
Keep the fleet-wide parts that remain true (database read-only, SQL optimisation, graphify).

## 3. Overlay -> `.claude/fleet/project/overlay.json` (+ `.claude/fleet/loop-tiers.json`)

Schema (version 1); an agent entry applies to both its Claude Code and its Copilot file:

```json
{
  "version": 1,
  "agents": {
    "frontend-web": {
      "description": "Frontend implementer (<project UI stack>) ...",
      "edits": [{"old": "<exact installed sentence that is wrong here>", "new": "<project-correct sentence>"}],
      "sections": [{"id": "project-stack", "after": "## Stack", "text": "## Project: <name> (UI)\n- ..."}]
    }
  },
  "files": {
    "POLICY.md":              {"sections": [{"id": "project-routing", "after": "## 2. Routing", "text": "**Projekt (...):** ..."}]},
    "POLICY.copilot.md":      {"sections": [...]},
    "POLICY.lite.md":         {"edits": [...]},
    "POLICY.copilot.lite.md": {"edits": [...]},
    "skills/test-driven-development/SKILL.md": {"sections": [...]}
  }
}
```

Go through ALL 28 agents (`.claude/agents/*.md`, or on a Copilot-only install `.github/agents/*.agent.md`; one overlay entry patches both) and decide per agent; most need one short section or nothing. The Copilot coordinator `fleet-orchestrator` needs no entry: it follows the policy, so project routing belongs in the `POLICY.copilot.md` sections.
- **Prefer `sections` over `edits`**: one concise "## Project: <name>" section per agent that needs it, after its stack/focus section. Point to the profile instead of copying it.
- **`edits` only for sentences that are wrong here**; copy `old` exactly from the installed file; keep the sentence's intent.
- **Descriptions** drive routing: fix the stack named in them; irrelevant roles get the prefix "Not used in this project unless explicitly requested." Never delete.
- **What goes where:**
  - architecture and layer rules -> `architect`, `code-reviewer`, implementers (`backend`, `frontend-web`, ...): "do not cross" list;
  - risky areas -> `code-reviewer`, `qa-automation`, `appsec` (if security-relevant), and `.claude/fleet/loop-tiers.json` `path_signals` as L;
  - conventions -> implementers and `code-reviewer`;
  - gates -> `qa-automation` and the profile's Gates section (the dev loop reads it);
  - platform -> `devops-engineer`, `platform-lead`, `release-manager`, `sre-observability`, `azure-cloud-engineer` (or mark it irrelevant if there is no Azure);
  - glossary -> profile; `business-analyst`, `technical-writer`, `product-owner` get a pointer;
  - orchestration -> a project routing section in `POLICY.md` and `POLICY.copilot.md` (area -> agent, irrelevant roles, project triggers); fix the stack line of the lite policies if it names the wrong stack;
  - skills -> stack notes that name the wrong stack (TDD skill table, the `ui-ux-pro-max --stack` hint);
  - capabilities -> `files["docs/capability-registry.md"]`: if the default-stack tags (csharp, dotnet, blazor, telerik-blazor, tsql, mssql, forsharp-erp, cpp ...) do not fit, `edits` on the affected agent rows (copy the row exactly), plus a `## Project capabilities` section `after` `## By capability` for the project's own tags (capability -> agent). Project routing rules go in a section `after` `## 2. Capability routing` of `files["docs/routing-matrix.md"]`; the workflow table (`## 1. Workflow routing`) stays generic.
- **`.claude/fleet/loop-tiers.json`**: `base_candidates` from the branch model, `path_signals` for the confirmed risky areas (e.g. `{"billing": ["L", "(?i)(^|/)src/Billing/"]}`), thresholds only if the owner wants others. Optional `flow_keywords` for the project's own words that name a workflow (e.g. a ticket prefix `{"bug-fix": "(?i)\\b(bug|fix|hiba|HB-\\d+)\\b"}`); a key replaces that flow's default pattern, so keep the generic words in it.

## 4. Show the plan, get approval

Show a short plan: the profile's key facts (detected vs. asked), per agent / file one line of change, the loop-tiers settings, the irrelevant roles, the convention conflicts and how they were resolved. Validate without writing:

```bash
python3 .claude/fleet/tools/apply_project_overlay.py --check
```

`stale` = the `old` text is not in the installed file: fix the overlay. Write nothing until the owner approves.

## 5. Apply, snapshot, verify

1. Apply: `python3 .claude/fleet/tools/apply_project_overlay.py` -> no `stale`, no `INVALID`.
2. Snapshot for drift detection: `python3 .claude/fleet/tools/survey_project.py --out .claude/fleet/project/survey.json` (use `--out`, not shell redirection: Windows PowerShell would write UTF-16).
3. Spot-check 2-3 changed agents in `.claude/agents/` and/or `.github/agents/` (whichever are installed); `.claude/fleet/ref/stack-profile.md` starts with the project-profile marker.
4. **Routing self-check (no agent calls):** take 6 typical tasks of this project (one per main area, one risky-area change, one platform/release task, one irrelevant-role bait). For each, decide from the routing section, the capability registry and the agent descriptions which agent (or none: the orchestrator) would get it, and run `loop_tier.py --planned <typical files> --planned-text "<task>"` for the tier and the `flow:` line (bug vs. feature vs. refactor must come out right for the project's own wording); compare with the profile's Responsibilities and Risky areas. Fix the overlay on any mismatch and re-apply.
5. Tell the owner: what changed (short list); that the tailoring survives fleet updates (the installer re-applies it) and uninstall keeps `.claude/fleet/project/`; to start a **new** Claude Code session / reload VS Code; that `/configure-fleet review` shows drift later. Suggest committing `.claude/fleet/project/` and `.claude/fleet/loop-tiers.json` with the project. Finally suggest (optional) `/init` to fine-tune the agent environment further (Claude Code: creates/updates the project `CLAUDE.md`; in Copilot its instructions generator, if offered); the marked `agentic-fleet` block in `CLAUDE.md` must stay intact (the installer's `--check` shows it).
