---
name: dev-loop
description: Use for code changes on a LOCAL branch when quality matters: classify the change (S/M/L) with the deterministic loop_tier.py, run the build/test gate loop, then 0-2 independent review rounds, with hard caps and stop rules. Never push, never PR-based. Works in Claude Code and GitHub Copilot.
---

# Dev loop (local branch only, bounded, evidence-gated)

A loop earns its cost only where each round has a cheap, checkable gate. Everything here works on the **working tree and local commits** against the merge-base with `develop`/`main`/`master`. **No push, no PR, no remote reviewer bot** (any push needs the owner's explicit approval; this loop never asks for one).

Run Python as `python3` (Windows: `python`). Both Claude Code and GitHub Copilot run the same script and read this same file.

Before any code exists (planning), estimate instead: `python3 .claude/fleet/tools/loop_tier.py --planned <files/areas> --planned-text "<task>"` (see `.claude/fleet/skills/feature-flow/SKILL.md`, phase 2). Once there is a diff, the classification below wins.

## 0. Classify the change (no model cost)

```bash
python3 .claude/fleet/tools/loop_tier.py            # human-readable
python3 .claude/fleet/tools/loop_tier.py --json     # machine-readable: tier, reasons, signals, plan
```

It reads `git diff` vs the merge-base (plus untracked files) and returns **S / M / L** with reasons:

| Tier | Typical | Plan |
|---|---|---|
| **S** | docs/tests/styles only, or a small change (<= ~40 lines, <= 2 files) with a test, no sensitive signal | gate loop only |
| **M** | medium change (<= ~400 lines, <= 8 files, <= 3 projects), or a small code change without any test | gate loop + **1** review round |
| **L** | any sensitive signal (auth, secrets, crypto, SQL/migrations, ForSharp/ERP, C++/interop, contracts/DTOs, raw SQL, P/Invoke, `unsafe`, `Process.Start`, ...), large change, large blast radius | gate loop + **2** review rounds (+ appsec / database review as the plan says) |

Rules:
- Signals can only **raise** the tier. Ties go up.
- You may raise it further when you see risk the script cannot (e.g. a one-line change in a pricing rule): `--raise L --reason "..."`. You never lower it.
- Optional: with a graphify graph pass the blast radius: `--affected <N>` (from `graphify affected`).
- The owner can override in one sentence ("legyen L", "elég a teszt"): `--set S|M|L --reason "..."`.
- **Announce it in one line before starting**: tier + the reasons that matter (e.g. "Tier M: 3 fájl, 85 sor, nincs érzékeny jel -> kapuk + 1 review kör").
- Exit code 2 (not a git repo, no base ref): assume **M** and say so.
- Re-run it at the start of every round: the actual diff beats the first estimate, and a finding such as a security issue can raise the tier.
- Project tuning (optional, survives updates; `/configure-fleet` writes it from the confirmed risky areas and the branch model): `.claude/fleet/loop-tiers.json`, e.g. `{"small": {"lines": 60, "files": 3}, "path_signals": {"billing": ["L", "(?i)billing|invoice"]}}`.

## 1. Gate loop (every tier)

The gate is deterministic: build, tests, analyzers, format check. **Use the verified commands from the project profile's "Gates" section** (`.claude/fleet/ref/stack-profile.md`, written by `/configure-fleet`, including which test suites are safe to run without database writes). Without that: `dotnet build`, `dotnet test`, `dotnet format --verify-no-changes`; C++: the repo's build and `ctest`. The implementer repeats: change -> gate -> fix.

- **At most 3 attempts.** If the same failure comes back twice, STOP guessing: switch to diagnosis (`diagnosing-bugs`: reproduce first, theory second).
- Never "fix" a red gate by weakening, skipping or deleting a test, or by silencing an analyzer.
- Database rule holds inside the loop: no database writes, no running write tests; DB-touching logic is tested against fakes. SQL changes: one read-only measure -> rewrite -> measure round (`sql-optimization.md`); no measurable gain = stop.
- Gate still red after 3 attempts: report PARTIAL with the evidence; do not start review rounds.

## 2. Review rounds (M: 1, L: 2) on a green gate

- **Round 1 - `code-reviewer`, fresh context** (not the author). The packet: diff vs the merge-base (`git diff <merge-base>`), acceptance criteria, changed files, graph-derived facts if any, the tier reasons. Ask for **Blocker/Major only**, each with evidence (file:line, why it fails, how to reproduce). Minor/Nit are not looped.
- **Round 2 (L only) - a different view, not the same review again:** a security / data / concurrency-focused pass (`appsec` when the plan says so, `database-data-engineer` for SQL changes, `qa-automation` when behaviour changed without tests). Prefer a different focus over a repeat.
- **Different model (optional, owner's call only):** the same model shares blind spots, so a different model adds the most. Never automatic and never assumed available. Only when the owner asks for it:
  - Claude Code session: the owner may allow a read-only review through another installed CLI (e.g. `copilot -p` / read-only tools) **only if it is on the PATH**; check with `command -v` first and skip silently if absent.
  - Copilot chat: the owner may switch the chat model for the review round, or allow `claude -p` the same way.
  - Send the diff and the acceptance criteria only, never `.env`, keys or secrets. Treat the reply as hypotheses.

## 3. Fix loop

1. **Reproduce every Blocker/Major before touching code** (failing test or concrete evidence); drop what you cannot reproduce.
2. **List the accepted findings** (id, `file:line`, one-line fix intent) and **classify each fix**:
   - **Local**: confined to the finding's code, no public signature, contract, schema or file-layout change. Proceed.
   - **Structural**: changes a signature/contract/schema, or spans several files or layers. Ask the owner before doing it (options: do it / minimal local workaround / defer).
   - **Rewrite**: replaces a component. Never inside the loop: stop and hand it to the owner as a separate decision.
3. **Mark the round start** before fixing: `git stash create` prints a snapshot of the working tree without changing it (empty output = use `HEAD`).
4. The implementer who owns the code fixes it (Claude Code: `SendMessage` to the same agent; Copilot: stay in the chat thread).
5. **Diff gate:** review `git diff <round-start>` hunk by hunk; every change must map to an accepted finding. Restore anything that does not (`git checkout <round-start> -- <file>` for a whole file, or edit the hunk back) and mention it. No "while I was there" refactors, renames or formatting sweeps in a fix round.
6. **Re-run the gate**, then re-review only what changed, with the previous findings listed.

## 4. Stop rules (first one that applies wins)

- gate green **and** no open Blocker/Major;
- **no progress**: the same finding returns twice;
- **diminishing returns**: the latest round found only Minor items;
- **cap reached** (gate: 3 attempts, review: the tier's rounds): STOP and give the owner the remaining findings with your recommendation; do not extend the loop on your own.

## 5. Where NOT to loop

Vague requirements (ask the owner: `grilling`), architecture decisions, subjective work (UI look, wording, docs), and S-tier changes beyond the gate.

## 6. Record it

One line in the result (and in `.claude/fleet/dispatch-log.md` where the telemetry hook is not running, e.g. Copilot): tier + reasons, gate attempts, review rounds, findings fixed / dropped / left open.
