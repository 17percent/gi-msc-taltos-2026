---
name: configure-fleet-skills
description: Let fleet specialists use skills installed on THIS machine. Surveys the skills Claude Code and/or GitHub Copilot can see (user, project, plugins), checks them against the fleet's own skills and rules (excludes conflicting ones with a reason), proposes which agent gets which skill, and after the owner's approval gives those agents the skill tool plus a written allowlist. `/configure-fleet-skills` (full flow) | `show` | `remove <agent>|all`.
argument-hint: (empty) | show | remove <agent>|all
disable-model-invocation: true
---

# Fleet skills: which installed skills a specialist may use

The fleet's specialists normally have no skill tool: they read the fleet's own skills (`.claude/fleet/skills/`) as files. This skill opens a **chosen, conflict-free set** of the skills installed on this machine to chosen agents: the agent gets the skill tool (Claude Code `Skill`, Copilot `skill`) and a "Project skills (allowlist)" section naming exactly what it may call. Talk to the user in their language. Works with the fleet ON or OFF. Python: `python3` (Windows: `python`). Run from the project root.

**Claude Code and Copilot see different skills** (Claude: `~/.claude/skills`, the project's `.claude/skills`, enabled plugins as `<plugin>:<skill>`; Copilot: `~/.copilot/skills`, `~/.agents/skills`, the project's `.github/skills`, `.claude/skills`, `.agents/skills`). The survey covers only the tool(s) the fleet is installed for, and every allowlist is **per tool**: an agent may get `superpowers:writing-plans` in Claude Code and `tdd` in Copilot.

## Rules

- **Propose, then ask; never write without the owner's approval** (owner decision 2026-10-13). Claude Code: `AskUserQuestion`; Copilot: ask in the chat and stop until the owner answers. A recommended option is a suggestion, never the default.
- **Conflicting skills are excluded, with a one-line reason** in the report. A specialist cannot ask the owner, cannot start agents, must not merge/push or publish to an external system, and must not be taken over by an "always use me" skill. `user-invocable-only` skills cannot be called by an agent at all; a `duplicate-of-fleet` skill loses to the fleet's own version.
- The flags are **heuristic hints** (regexes over the SKILL.md). Read a flagged skill's SKILL.md before deciding. If a flag is a clear false positive (e.g. the conflicting step is only an optional final hand-off the agent will not do), you may keep the skill: put it into `overrides` with the reason, and show that reason to the owner.
- **Copilot lists only part of the installed skills** (measured 2026-10-13: the first 23 model-invocable skills in alphabetical order; a size budget). A skill flagged `copilot-may-not-list` is probably never offered to the agent, so it cannot pick it even when the packet names it. Prefer a skill from the listed part, or tell the owner that fewer skills installed for Copilot (`~/.agents/skills` etc.) make room; keep it only with an override reason.
- Keep the independent gates out unless the owner insists: `code-reviewer`, `appsec`, `challenger`, `quality-lead`, `release-manager` (their judgement must stay predictable). `trend-scout` runs on a small model: skip it too.
- Fewer is better: every skill-enabled agent receives the whole installed skill list in its context on each call (token cost). Suggest at most ~6 skills per agent, only ones that clearly fit its capabilities.
- Agents rarely call an allowed skill on their own (measured 2026-10-13), so the orchestrator policy names a fitting allowed skill in the task packet's CONSTRAINTS (owner decision 2026-10-13) and the guard appends the agent's list to every packet it sends (Claude Code and Copilot, owner decision 2026-10-14). Tell the owner this.
- The allowlist is a written rule, not enforced by the guard (owner decision 2026-10-13); the guard's other rules (no push, no secrets, no DB writes, read-only roles) still apply to everything a skill makes the agent do.

## Flow (no argument)

1. **Survey:** `python .claude/fleet/tools/skill_survey.py show` (what already exists), then `python .claude/fleet/tools/skill_survey.py inventory` (add `--json` for the full paths). It prints, per installed tool, every visible skill with its flags.
2. **Filter:** drop `user-invocable-only` and `duplicate-of-fleet`; for every other flagged skill read its SKILL.md and either exclude it (reason) or keep it as a reviewed false positive (reason for `overrides`).
3. **Match:** for each remaining skill pick the agents whose capabilities fit, using `.claude/fleet/docs/capability-registry.md` and the agent descriptions (`.claude/agents/*.md` or `.github/agents/*.agent.md`). Typical fits: planning skills -> engineering-lead / platform-lead / architect; debugging, TDD, prototyping -> the implementers (backend, frontend-web, database-data-engineer, integration-engineer, python-engineer) and qa-automation; observability skills -> sre-observability / devops-engineer; UX and design skills -> ux-ui-designer / product-experience / frontend-web; document formats and diagrams -> technical-writer; research -> technical-researcher.
4. **Show the proposal** as one table per tool (agent | skills | why), followed by the excluded skills with their reasons. Ask the owner: approve all / approve per agent / change. Apply only what was approved.
5. **Write:** save the approved plan to a temp file as
   `{"agents": {"<agent>": {"claude": ["<skill>", ...], "copilot": ["<skill>", ...]}}, "overrides": {"<skill>": "<why the flag is a false positive>"}}`
   and run `python .claude/fleet/tools/skill_survey.py apply <plan.json>`. It validates the plan against this machine (unknown, user-invocable-only, duplicate or unreviewed flagged skills, and any agent that is not one of the fleet's installed specialists, are rejected and nothing is written), **merges** it into `.claude/fleet/project/skills.json` per agent (only the planned agents change; an empty list removes that agent's list for that tool; start from `show` so the owner sees what already exists) and applies it to the agent files. If applying fails, `skills.json` stays as it was and the command exits non-zero: report that, do not claim a change. The installer re-applies it after every fleet update; uninstall keeps it.
6. **Tell the owner:** which agents changed, per tool; that Claude Code loads agents at session start (start a new session) and VS Code needs a window reload / new chat; that `skills.json` can be committed so the team gets the same allowlist, but a colleague's machine must have the same skills installed (`show` lists the missing ones).

## show / remove

- `show`: `python .claude/fleet/tools/skill_survey.py show`: the current allowlists per agent and tool, with skills that are no longer installed on this machine (MISSING). Suggest re-running the flow or `remove` for those.
- `remove <agent>` / `remove all`: `python .claude/fleet/tools/skill_survey.py remove <agent>` (or `--all`): the agent loses the skill tool and the allowlist section, then the files are re-applied.

## Not this skill's job

Project stack tailoring is `/configure-fleet`; the Copilot specialist model is `/configure-copilot-models`. Never edit the agent files by hand for this: the next fleet update would overwrite them (`skills.json` is the source).
