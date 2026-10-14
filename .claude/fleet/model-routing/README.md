# Adaptive specialist model routing (GitHub Copilot)

**What it decides:** the model of a fleet specialist subagent, after the orchestrator chose the specialist. The root/session model is never touched. Claude Code is not affected (its agents keep their role-based model alias).

**How (no extra model call, no approval, no terminal command):**
1. The orchestrator starts a specialist with the Copilot `task` tool.
2. The guard's `preToolUse` hook calls the resolver (`.claude/fleet/tools/model_router.py`).
3. The resolver writes `model` into the call (`modifiedArgs`).

The resolver does not run when the call already names a model, when the fleet is OFF, when routing is disabled, or when the agent is unknown. If it fails, the call is left unchanged: the specialist inherits the session model and the fleet carries on.

**Inputs:**

| File | What | Where |
|---|---|---|
| `agent-requirements.json` | per specialist, model-independent: workload profile, quality floor, base reasoning, cost / latency sensitivity, false-negative cost, ... | installed |
| `workload-profiles.json` | shared defaults and the evidence class of each workload | installed |
| `scoring-policy.json` | hard filters, quality-floor evidence gate, risk escalation, cost ranking, fallback count | installed |
| `factory-baseline.json` | evidence from the fleet's eval runs (built by `fleet/tools/build_model_routing_baseline.py` in the source package); an `auto`/unknown model never becomes evidence | installed |
| host inventory | the models this machine's Copilot CLI actually ran in the last 14 days, with their AI credits per call and multiplier (`~/.copilot/session-store.db`, read-only) | runtime |
| `host-models.local.json` | optional: every model the host offers (VS Code LM API), written by the VS Code companion (`.claude/fleet/integrations/vscode-model-inventory/`); the CLI's listed models join the inventory with an unknown cost | `.claude/fleet/project/model-routing/` |
| `local-agent-requirements.json`, `calibration.local.json`, `*.local.json` caches | user-added agents (deterministic profile; `"profileSource": "manual"` to pin), local evidence, cache | `.claude/fleet/project/model-routing/` (kept on update and uninstall; `*.local.json` git-ignored) |

**Order of decisions:**
1. Hard filters: the model was seen on this host, and it is not a verified failure for the workload class.
2. Quality floor: the agent's floor, raised by the subtask's risk.
   - Risk comes from the packet text (auth / secrets / crypto / PII / SQL / ERP / payment / interop / public contract → high), or from an optional `ROUTING: risk=… complexity=…` line.
   - S/M/L is not used.
   - A high or premium floor needs evidence in the same workload class. If no model has it, the best-evidenced model is used with confidence `low`.
3. Cost, only among the models that pass:
   - cost-sensitive roles → cheapest;
   - high-risk roles → best evidence first.

   An unknown cost is never assumed cheaper.

   **New models (owner decision 2026-10-12):** a newer version of an evidenced family (for example `claude-sonnet-5` → `claude-sonnet-5.5`) gets provisional trust with confidence `low`, and is ranked before the older version, even with an unknown cost. Failures never transfer, and the new model's own evidence overrides the transfer. A model of another family needs its own evidence (calibration).
4. The result: a primary model, up to 2 fallbacks, and final inheritance.

Only the primary runs; there is no ensemble.

**Host limits (measured / read in the source, 2026-10-12):**
- **Copilot CLI:** per-dispatch `model` is supported, per-dispatch reasoning effort is not. The requested effort is recorded but model-managed.
- **VS Code, Copilot CLI chat sessions:** same runtime, same behaviour (measured 2026-10-12): the fleet's hooks fire with the CLI payload, and the per-dispatch `model` is honoured. Routing is ACTIVE, with no agent-file change.
- **VS Code's own agent mode (`runSubagent`)** and **Visual Studio:** not verified, so specialists inherit there.
- **Why the agent files stay model-free:** measured in VS Code, an agent file's `model:` only works as `Name (vendor)`. It is read when the chat session starts, a list gives no fallback, and an unavailable model stops the subagent with an error. A shared, committed file must therefore never pin a model.

**Turn off:**
- `/configure-copilot-models off` (or the file `.claude/fleet/project/model-routing/disabled`);
- for one process, the environment variable `AGENTIC_FLEET_MODEL_ROUTING=off`.
