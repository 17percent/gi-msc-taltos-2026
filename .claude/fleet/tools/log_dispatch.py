#!/usr/bin/env python3
"""SubagentStop hook: appends one measured row per fleet-agent run to .claude/fleet/dispatch-log.md.

Reads the hook JSON from stdin (agent_type, agent_transcript_path, effort, cwd, last_assistant_message), sums the
token usage of the agent's own transcript (unique assistant messages), counts tool calls and wall time, and records
the result packet's STATUS (DONE|PARTIAL|BLOCKED|?) so quality shows up next to cost. Stdlib only.
Never blocks and never fails the session: every error ends in exit 0 without output.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

USAGE_KEYS = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
STATUS = re.compile(r"STATUS\W{0,6}(DONE|PARTIAL|BLOCKED)", re.I)


def result_status(message):
    """STATUS of the agent's result packet (DONE|PARTIAL|BLOCKED), '?' if the packet has none."""
    m = STATUS.search(message or "")
    return m.group(1).upper() if m else "?"


def read_transcript(path):
    tokens = tools = 0
    seen = set()
    stamps = []
    if not os.path.isfile(path):
        return tokens, tools, stamps
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("timestamp"):
                stamps.append(row["timestamp"])
            msg = row.get("message")
            if not isinstance(msg, dict) or msg.get("role") != "assistant":
                continue
            for block in msg.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tools += 1
            mid = msg.get("id")
            usage = msg.get("usage") or {}
            if mid and mid not in seen and usage:
                seen.add(mid)
                tokens += sum(v for k, v in usage.items() if k in USAGE_KEYS and isinstance(v, int))
    return tokens, tools, stamps


def from_copilot(data):
    """GitHub Copilot subagentStop payload (measured 2026-10-08: {sessionId, cwd, transcriptPath, agentId, agentName,
    response, stopReason}) -> the Claude Code SubagentStop shape this hook reads. Copilot's transcript is its own event
    log (events.jsonl), read by copilot_events()."""
    if "agent_type" in data or "agentName" not in data:
        return data
    return {"agent_type": data.get("agentName"), "last_assistant_message": data.get("response") or "", "cwd": data.get("cwd"),
            "copilot": True, "agent_id": data.get("agentId"), "copilot_events": data.get("transcriptPath")}


def copilot_events(path, agent):
    """This run's facts from the Copilot session log (events.jsonl; the CLI and VS Code's Copilot CLI chat, which writes no
    usage database): the agent's last `subagent.started` and the `subagent.completed` of that same tool call (model,
    tokens, tool calls, duration). Copilot writes `completed` only AFTER the subagentStop hooks returned (measured
    2026-10-13), so a live hook gets {"pending": True}: model, counted tool calls and elapsed time, no tokens yet."""
    started = done = None
    tools = 0
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"subagent.' not in line and '"tool.execution_start"' not in line:
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                d = ev.get("data") if isinstance(ev, dict) else None
                if not isinstance(d, dict):
                    continue
                t = ev.get("type")
                if t == "subagent.started" and d.get("agentName") == agent:
                    started, done, tools = dict(d, at=ev.get("timestamp")), None, 0   # a new run of this agent
                elif t == "tool.execution_start" and started and started.get("toolCallId") \
                        and d.get("parentToolCallId") == started["toolCallId"]:
                    tools += 1
                elif t == "subagent.completed" and d.get("agentName") == agent and done is None \
                        and (not started or d.get("toolCallId") == started.get("toolCallId")):
                    done = d                                   # the first one: a later `cancelled` copy repeats it
    except (OSError, TypeError):
        return None
    if done or not started:
        return done
    out = {"model": started.get("model"), "totalToolCalls": tools, "pending": True}
    try:
        t0 = datetime.fromisoformat(str(started.get("at")).replace("Z", "+00:00"))
        out["durationMs"] = (datetime.now(timezone.utc) - t0).total_seconds() * 1000
    except (ValueError, TypeError):   # TypeError: a timestamp without offset
        pass
    return out


AWAIT = "AGENTIC_FLEET_LOG_AWAIT"


def defer(raw):
    """Re-run this hook detached, so it can wait for Copilot's `subagent.completed` (written after the hook returns).
    False if it could not start (then the row is written now, without tokens)."""
    import subprocess
    import tempfile
    fd, tmp = tempfile.mkstemp(prefix="fleet-dispatch-", suffix=".json")
    with os.fdopen(fd, "wb") as fh:
        fh.write(raw)
    kw = {"creationflags": 0x00000008 | 0x00000200} if os.name == "nt" else {"start_new_session": True}   # DETACHED, NEW_GROUP
    try:
        subprocess.Popen([sys.executable, os.path.abspath(__file__), tmp], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, close_fds=True, env=dict(os.environ, **{AWAIT: "1"}), **kw)
        return True
    except OSError:
        os.remove(tmp)
        return False


def is_fleet_agent(root, agent):
    """Claude Code agent (.claude/agents/<a>.md) or Copilot agent (.github/agents/<a>.agent.md): either install counts."""
    return bool(agent) and (os.path.isfile(os.path.join(root, ".claude", "agents", agent + ".md"))
                            or os.path.isfile(os.path.join(root, ".github", "agents", agent + ".agent.md")))


def transcript_model(path):
    """The model the subagent actually ran on (last assistant message), or '?'."""
    model = "?"
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if '"model"' in line:
                    try:
                        m = (json.loads(line).get("message") or {}).get("model")
                    except ValueError:
                        continue
                    if m:
                        model = m
    except OSError:
        pass
    return model


def active_task(root, agent):
    """Open workflow checkpoint (flow_state.py), if any: (task-class column, note suffix). The hook, not the model, links
    the dispatch to the task and records the agent in it."""
    d = os.path.join(root, ".claude", "fleet", "state")
    files = sorted((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json")), key=os.path.getmtime) if os.path.isdir(d) else []
    if not files:
        return "auto", ""
    path = files[-1]   # ponytail: newest open task; with parallel open tasks it may pick the wrong one (then pass the id in the packet)
    with open(path, encoding="utf-8") as fh:
        st = json.load(fh)
    # a forgotten checkpoint must not swallow unrelated work: only a task the orchestrator touched in the last 24 h counts
    # (`updated` is written by flow_state.py only, never by this hook)
    if not isinstance(st, dict) or datetime.now() - datetime.strptime(st.get("updated", ""), "%Y-%m-%d %H:%M") > timedelta(hours=24):
        return "auto", ""
    agents = st["agents"] if isinstance(st.get("agents"), list) else []
    seen = st["agents_seen"] if isinstance(st.get("agents_seen"), list) else []
    if agent not in agents or agent not in seen:
        st["agents"] = agents + ([agent] if agent not in agents else [])
        st["agents_seen"] = seen + ([agent] if agent not in seen else [])   # hook-owned: flow_state's review gate trusts only this
        tmp = f"{path}.{os.getpid()}.tmp"   # atomic: flow_state.py may read it at the same moment
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(st, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    return st.get("flow", "auto"), f" task={st.get('id')} phase={st.get('phase')} tier={st.get('tier')}"


def main():
    if os.environ.get(AWAIT) and len(sys.argv) > 1:      # the detached re-run: payload from the temp file
        with open(sys.argv[1], "rb") as fh:
            raw = fh.read()
        os.remove(sys.argv[1])
    else:
        raw = sys.stdin.buffer.read()
    data = from_copilot(json.loads(raw.decode("utf-8", "replace")))   # hooks send UTF-8
    agent = data.get("agent_type") or "?"
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    if not re.match(r"^[A-Za-z0-9_.-]+$", agent) or not is_fleet_agent(root, agent):
        return  # only fleet/project agents, not built-ins like Explore or general-purpose
    log = os.path.join(root, ".claude", "fleet", "dispatch-log.md")
    if not os.path.isfile(log):
        return
    path = data.get("agent_transcript_path") or ""
    # The hook can fire a moment before the agent's last message is flushed to its transcript: retry briefly.
    tokens, tools, stamps = 0, 0, []
    for _ in range(10 if path else 1):
        tokens, tools, stamps = read_transcript(path)
        if tokens:
            break
        time.sleep(0.5)
    secs = "UNKNOWN"
    if len(stamps) >= 2:
        try:
            parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
            secs = f"{(parse(stamps[-1]) - parse(stamps[0])).total_seconds():.0f} s"
        except ValueError:
            pass
    try:   # before a deferred row: flow_state's review gate reads agents_seen right after the agent returns
        flow, task = active_task(root, agent)
    except Exception:   # a broken checkpoint must never cost the telemetry row
        flow, task = "auto", ""
    effort = data.get("effort")
    level = effort.get("level", "?") if isinstance(effort, dict) else "?"
    model, credits = transcript_model(path), ""
    if data.get("copilot"):   # Copilot: the actual model / tokens / AI credits of this subagent from the CLI's usage records
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from model_router import usage_for_agent
            u = usage_for_agent(data.get("agent_id"))
        except Exception:
            u = None
        if u:
            model, tokens, level = u["model"], u["tokens"] or tokens, u["effort"] or level
            credits = f" credits={u['credits']}"
        else:   # VS Code's Copilot CLI chat: no usage records, but the session's own event log has the facts
            ev = copilot_events(data.get("copilot_events"), agent)
            if ev and ev.get("pending"):
                if not os.environ.get(AWAIT):
                    if defer(raw):
                        return
                else:
                    for _ in range(40):                     # ponytail: 20 s ceiling; after it, the row has no tokens
                        time.sleep(0.5)
                        ev = copilot_events(data.get("copilot_events"), agent) or ev
                        if not ev.get("pending"):
                            break
            if ev:
                model = ev.get("model") or model
                tokens = ev.get("totalTokens") or tokens
                tools = ev.get("totalToolCalls", tools)
                if isinstance(ev.get("durationMs"), (int, float)):
                    secs = f"{ev['durationMs'] / 1000:.0f} s"
    row = (f"| {datetime.now().strftime('%Y-%m-%d %H:%M')} | {flow} | {agent} | {tokens if tokens else 'UNKNOWN'} "
           f"| {tools} | {secs} | effort={level} model={model}{credits}{' via=copilot' if data.get('copilot') else ''} status={result_status(data.get('last_assistant_message'))}{task} |\n")
    with open(log, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(row)


if __name__ == "__main__":
    try:
        main()
    except Exception:  # never disturb the session
        pass
    sys.exit(0)
