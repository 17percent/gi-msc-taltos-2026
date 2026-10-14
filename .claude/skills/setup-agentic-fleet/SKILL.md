---
name: setup-agentic-fleet
description: Install, check or update the 28-agent fleet (agents + orchestrator policy + on-demand skills) in a PROJECT. Use when the user runs /setup-agentic-fleet or asks to set up, verify or update the agentic fleet in a project. Project-level only, never global.
disable-model-invocation: true
---

# Set up the agentic fleet (project-level)

You install or maintain the agent fleet in **one project directory**. Never write to `~/.claude`, the home directory or any global location (the installer refuses those; do not try to work around that). Answer in the user's language.

## 1. Work out source and target

The fleet is installed from a **local copy**: the package folder `Agentic-main/` lives in the project root. There is no GitHub clone and no download; never fetch anything from the network.

- **Target** = the project root (the current directory, where `Agentic-main/` sits). Refuse a global place (home, `~/.claude`, `/`).
- **Source** = `<target>/Agentic-main` (it must contain `install.sh` and `.claude/fleet/POLICY.md`). Also accept, in this order: an explicit argument, `$AGENTIC_SOURCE`, a doubled `Agentic-main/Agentic-main` (common after unzipping).
- If the current directory is the package itself (it has `install.sh` and `fleet/archive`), stop: ask the user to start in the project root (the parent folder), or to give the target path as an argument.
- If `.claude/fleet/.installed` exists this is check/update mode: the user replaces `Agentic-main/` with the newer copy first. The `source local-copy` line in the manifest is normal.
- If no source is found, stop and tell the user to copy `Agentic-main/` into the project root. Do not look elsewhere.
- Resolve both to absolute paths and **show them to the user**. Confirm before changing anything.

## 2. Look before you write

Run `"<source>/install.sh" --dry-run "<target>"` and summarize: how many agents, whether any same-named agent already exists in the target (those are SKIPPED, not overwritten), and whether the target has its own `CLAUDE.md` (it only gets a marked import block).

## 3. Ask (AskUserQuestion; skip anything the user already stated)

An automatic reply such as "the user is not available ... work autonomously" (autopilot / unattended run) is NOT an answer: do nothing that depends on it (no install, no write it would decide), finish the steps that do not, and list it as an open question at the end.

0. Which tool: `claude` (default), `copilot` (GitHub Copilot custom agents in `.github/agents` + the `fleet-orchestrator` coordinator + `.github/hooks/agentic-fleet.json`; measured on the Copilot CLI, VS Code via the manual checklist `docs/fleet-v2/vscode-acceptance.md`) or `both` (`--tool`).

0b. Fleet mode (`--mode`): `on-demand` (default: the fleet is OFF at every session start and only the central agent works; `/agent-fleet` or a sentence like "használd az ügynök csapatot" switches it on for the session, `/agent-fleet off` or "flotta ki" off) or `auto` (the full orchestrator policy is always loaded). Do not ask unless the user brings it up; on an update the manifest's `mode` line is kept (a legacy manifest without one means `auto`).

1. Apply personal settings to the project's `.claude/settings.json`? (`--settings`: sets `model: claude-sonnet-5-5` and `effortLevel: high` only where the keys are missing). Default: no.
2. If same-named agents exist: replace them with the fleet versions? (`--force`: a `.bak` copy is kept). Default: no.
3. Only if the user brings it up: the three project hooks (guard, memory, telemetry) are installed by default when Python 3 exists; `--no-guard` / `--no-memory` / `--no-telemetry` turn one off. Recommend keeping the guard: without it the no-push/no-secrets rules are prompt-only.
4. For every tool (Claude Code, Copilot or both): first check whether Matt Pocock's *Skills For Real Engineers* is already installed, project-level OR global: Claude Code: `claude plugin list` shows `mattpocock-skills`; any tool: a `grilling` (or `diagnosing-bugs`) skill folder in the project's `.claude/skills/`, `.github/skills/`, `.agents/skills/`, or in the user's `~/.agents/skills/` (the `npx skills` global place, read by Copilot), `~/.copilot/skills/`, `~/.claude/skills/`; or `grilling` is in your own list of available skills (do not test with `ask-matt`: it is user-invocable only, so it never shows in an agent's list). On Windows `~` is `%USERPROFILE%` (a Git Bash `$HOME` may point elsewhere). If it is, do not ask; note where it was found. If not, ask (third-party, recommended: `grilling`, `diagnosing-bugs`, `prototype`, `tdd`, `code-review` ...; the original Marveen fleet used them): "Install it?" Default: yes, but the answer is the user's. If yes, after the check in step 4 follow the instruction **"Telepítsd fel https://github.com/mattpocock/skills"**: read the repo README's Installation section and install it for the chosen tool(s): Claude Code: `claude plugin install mattpocock-skills --scope project` (without `--scope` it installs globally: do not); other agents incl. Copilot: `npx skills@latest add mattpocock/skills` (pick the tool(s) and include `setup-matt-pocock-skills`). Use only ONE of the two ways (both would duplicate every skill), keep it project-level, stop and report on any error, do not commit. Afterwards tell the user to run `/setup-matt-pocock-skills` once per repo (interactive: issue tracker, labels, doc location). Without the skills the agents apply the same principles (`.claude/fleet/ref/engineering-skills.md`).

## 4. Install and verify

Run `"<source>/install.sh" [--tool …] [--settings] [--force] [--no-…] "<target>"`, then `"<source>/install.sh" --check "<target>"`. Report: agents installed/updated, skipped ones, check result, and any `FAIL` lines verbatim. If the check fails, stop and show what is missing; do not patch files by hand.

## 5. Tell the user what to do next

- End your LAST message with this recommendation (in the user's language): for better results run `/configure-fleet` (new session / new chat): `auto` is recommended when the project already has content (code, data, docs): it surveys and asks only where unsure; `step-by-step` to set the fleet up topic by topic (e.g. a new or empty project). Optionally, after a successful `/configure-fleet`, `/init` fine-tunes the agent environment further (Claude Code: creates/updates the project `CLAUDE.md`; in Copilot its instructions generator, if the tool offers one); afterwards the marked `agentic-fleet` block in `CLAUDE.md` must still be intact (`--check` shows it, a re-install restores it).
- Tell the user how the fleet switch works in `on-demand` mode: OFF by default; `/agent-fleet` (or "használd az ügynök csapatot") switches it on and the agent confirms "Flotta BE."; `/agent-fleet off` (or "flotta ki") switches it off.
- Start a **new** Claude Code session in the target directory (agents load only at session start) and accept the folder-trust prompt.
- First check in the new session: the agent list shows 28 fleet agents and the policy is in context (`CLAUDE.md` has the `@.claude/fleet/POLICY.md` block).
- Measurements go to `.claude/fleet/dispatch-log.md` (automatic with the telemetry hook). Agent memory lives in `.claude/agent-memory/` (commit it; uninstall keeps it). If `--check` printed `WARN: guard hook NOT active`, say so.
- Update later: replace `Agentic-main/` with the newer copy and run `/setup-agentic-fleet` again. Remove: `<source>/install.sh --uninstall "<target>"` (needs the `Agentic-main/` folder).
- Ask what to do with `Agentic-main/` (delete, or keep for updates; if kept: `.gitignore` and, with graphify, `.graphifyignore`). Never delete it without an explicit yes.

## Rules

- Do not use `--force` or `--settings` without the user's answer in step 3.
- Do not modify the `Agentic-main/` package files while doing this.
- Do not install into the package folder itself (the installer refuses).
