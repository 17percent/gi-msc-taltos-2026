---
name: agent-fleet
description: Switch the 28-agent fleet ON or OFF for this session/chat. `/agent-fleet` (or `/agent-fleet on`) turns it on, `/agent-fleet off` turns it off, `/agent-fleet status` reports the state. By default the fleet is OFF and only the central agent works.
argument-hint: on | off | status
disable-model-invocation: true
---

# Fleet switch (this session / chat only)

Not to be confused with GitHub Copilot's own built-in `/fleet` command (parallel subagent execution): this skill switches the 28-agent fleet.

Argument: whatever follows `/agent-fleet` (empty or `on` = ON, `off` = OFF, `status` = report). The same switch works in plain words: "flotta be", "használd az ügynök csapatot", "fleet on" / "flotta ki", "csak te dolgozz", "fleet off".

The policy file depends on the tool you run in:
- **Claude Code** -> `.claude/fleet/POLICY.md`
- **GitHub Copilot** (VS Code chat, CLI, ...) -> `.claude/fleet/POLICY.copilot.md`

## ON (`/agent-fleet` or `/agent-fleet on`)

1. Run `python3 .claude/fleet/tools/fleet_switch.py on` (Windows: `python`): the fleet's hooks (workflow reminder, Copilot stop gate) follow the switch from this. Then read the policy file for your tool completely.
2. Reply with ONE line: **"Flotta BE."** and, in a short clause, what that means (you are now the orchestrator and delegate to the specialists when it pays off, per the policy).
3. From now until the end of this session/chat act as the orchestrator by that policy. Do not start any work the user did not ask for.

## OFF (`/agent-fleet off`)

1. Run `python3 .claude/fleet/tools/fleet_switch.py off` (Windows: `python`), then reply with ONE line: **"Flotta KI."**
2. From now on work alone as the central agent: do not delegate to fleet agents and do not apply the full policy. The "always valid" rules of the lite policy (`.claude/fleet/POLICY.lite.md` for Claude Code, `.claude/fleet/POLICY.copilot.lite.md` for Copilot) still apply: no database writes, approval before push/external steps, ask real questions.
3. A single specialist the user names explicitly may still be called.

## STATUS (`/agent-fleet status`)

Say whether the fleet is ON or OFF in this session/chat (OFF is the default at every start) and how to switch it.
