#!/usr/bin/env python3
"""Lightweight workflow checkpoint for M/L work that may outlive a session (stdlib only, no model call).

One JSON file per open task in .claude/fleet/state/<id>.json. It records WHERE the work is (flow, phase, tier, approvals,
agents, artifacts, open findings), never the evidence itself as truth: evidence from an earlier session is stale and
the gate must run again. `close` prints the record line (optionally appends it to the dispatch log) and DELETES the
file, so finished work leaves no runtime state behind. S-size work does not need a state file.

Usage:
  python flow_state.py new --flow bug-fix --tier M --title "Null reference in OrderService"   # prints the id
  python flow_state.py set [ID] --phase REVIEW --done IMPLEMENT --evidence "dotnet test: 41 passed" --agent backend
  python flow_state.py set [ID] --approval "plan approved (M): option 'mehet'" --finding "open: Major null check" --round 1
  python flow_state.py set [ID] --tier L                      # up only; lower needs --owner (owner override)
  python flow_state.py show [ID]                              # resume summary
  python flow_state.py close [ID] [--log]                     # record line (+ dispatch-log row), then delete
  python flow_state.py list
ID defaults to the most recently updated open task. Exit: 0 ok, 1 usage/state error.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime

ORDER = {"S": 0, "M": 1, "L": 2}
FLOWS = ("feature", "bug-fix", "refactor", "architecture-change", "requirement-to-code")   # = feature-flow "Flows" (tested)
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def root_dir(cwd):
    try:
        p = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout.strip()
    except OSError:
        pass
    return os.path.abspath(cwd)


def state_dir(root):
    return os.path.join(root, ".claude", "fleet", "state")


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def read_state(path):
    """The state dict, or None for a corrupt/foreign file (never a traceback)."""
    try:
        with open(path, encoding="utf-8") as fh:
            st = json.load(fh)
        return st if isinstance(st, dict) and "id" in st else None
    except (OSError, ValueError):
        return None


def open_tasks(root):
    d = state_dir(root)
    if not os.path.isdir(d):
        return []
    files = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json")]
    return sorted(files, key=os.path.getmtime, reverse=True)


def load(root, tid):
    if tid:
        if not ID_RE.match(tid):
            sys.exit(f"flow_state: invalid task id '{tid}'")
        path = os.path.join(state_dir(root), f"{tid}.json")
        if not os.path.isfile(path):
            sys.exit(f"flow_state: no open task '{tid}'")
        st = read_state(path)
        if st is None:
            sys.exit(f"flow_state: '{path}' is not a readable checkpoint (fix or delete it)")
        return path, st
    for path in open_tasks(root):   # ponytail: newest open task wins; name the id when several tasks are open in parallel
        st = read_state(path)
        if st is not None:
            return path, st
        print(f"flow_state: skipping unreadable {os.path.basename(path)}", file=sys.stderr)
    sys.exit("flow_state: no open task (start one with `new`)")


def save(path, st):
    """Atomic write: the telemetry hook may read the file at the same moment."""
    st["updated"] = now()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(st, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def telemetry_hook_on(root):
    """Is a hook installed that records subagents in the checkpoint (Claude Code settings or the Copilot hook file)?"""
    try:
        with open(os.path.join(root, ".claude", "fleet", ".installed"), encoding="utf-8") as fh:
            if "telemetry hook" in fh.read().splitlines():
                return True
    except OSError:
        pass
    try:
        with open(os.path.join(root, ".github", "hooks", "agentic-fleet.json"), encoding="utf-8") as fh:
            return "log_dispatch.py" in fh.read()
    except OSError:
        return False


def record_line(st):
    open_f = [f for f in st["findings"] if not f.lower().startswith(("fixed", "dropped"))]
    return (f"{st['id']} | flow={st['flow']} | tier {st['tier_estimated']}->{st['tier']} | phases: {', '.join(st['completed']) or '-'}"
            f" | approvals: {len(st['approvals'])} | agents: {', '.join(st['agents']) or 'none'} | review rounds: {st['rounds']}"
            f" | findings open: {len(open_f)} of {len(st['findings'])}")


def main():
    ap = argparse.ArgumentParser(description="Workflow checkpoint for M/L fleet work")
    ap.add_argument("--cwd", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("--flow", required=True, choices=FLOWS)
    n.add_argument("--tier", required=True, choices=list(ORDER))
    n.add_argument("--title", required=True)
    s = sub.add_parser("set")
    s.add_argument("id", nargs="?")
    s.add_argument("--phase")
    s.add_argument("--done", action="append", default=[])
    s.add_argument("--tier", choices=list(ORDER))
    s.add_argument("--owner", action="store_true", help="owner override: allows lowering the tier")
    s.add_argument("--flow", choices=FLOWS)
    for k in ("approval", "evidence", "finding", "agent", "artifact"):
        s.add_argument(f"--{k}", action="append", default=[])
    s.add_argument("--round", type=int)
    for name in ("show", "close"):
        c = sub.add_parser(name)
        c.add_argument("id", nargs="?")
        if name == "close":
            c.add_argument("--log", action="store_true", help="also append the record to .claude/fleet/dispatch-log.md (no telemetry hook, e.g. Copilot)")
            c.add_argument("--force", action="store_true", help="OWNER ONLY: close although no review round ran (the guard asks the owner)")
    sub.add_parser("list")
    a = ap.parse_args()
    root = root_dir(a.cwd)

    if a.cmd == "new":
        slug = re.sub(r"[^a-z0-9]+", "-", a.title.lower()).strip("-")[:32] or "task"
        base = tid = datetime.now().strftime("%Y%m%d-%H%M%S-") + slug
        n = 2
        while os.path.exists(os.path.join(state_dir(root), f"{tid}.json")):   # same title in the same second
            tid = f"{base}-{n}"
            n += 1
        st = {"id": tid, "title": a.title, "flow": a.flow, "tier_estimated": a.tier, "tier": a.tier, "phase": "SCOPE",
              "completed": [], "approvals": [], "agents": [], "artifacts": {}, "evidence": [], "findings": [], "rounds": 0,
              "created": now()}
        save(os.path.join(state_dir(root), f"{tid}.json"), st)
        print(tid)
        return

    if a.cmd == "list":
        for path in open_tasks(root):
            st = read_state(path)
            if st is None:
                print(f"(unreadable: {os.path.basename(path)})")
                continue
            print(f"{st['id']} | {st['flow']} | phase {st['phase']} | tier {st['tier']} | updated {st.get('updated')}")
        return

    path, st = load(root, a.id)
    if a.cmd == "set":
        if a.tier:
            if ORDER[a.tier] < ORDER[st["tier"]] and not a.owner:
                sys.exit(f"flow_state: tier {st['tier']} -> {a.tier} is a lowering; only the owner may do that (--owner)")
            st["tier"] = a.tier
        if a.flow:
            st["flow"] = a.flow
        for ph in a.done:
            if ph.upper() not in st["completed"]:
                st["completed"].append(ph.upper())
        if a.phase:
            st["phase"] = a.phase.upper()
        st["approvals"] += [f"{now()}: {x}" for x in a.approval]
        st["evidence"] += [f"{now()}: {x}" for x in a.evidence]
        st["findings"] += a.finding
        for ag in a.agent:
            if ag not in st["agents"]:
                st["agents"].append(ag)
        for art in a.artifact:
            k, _, owner = art.partition("=")
            st["artifacts"][k] = owner or "?"
        if a.round is not None:
            st["rounds"] = max(st["rounds"], a.round)
        save(path, st)
        print(f"{st['id']}: phase {st['phase']}, tier {st['tier']}")
    elif a.cmd == "show":
        print(f"TASK {st['id']}: {st['title']}")
        print(f"  flow {st['flow']} | tier {st['tier_estimated']}->{st['tier']} | current phase {st['phase']} | done: {', '.join(st['completed']) or '-'}")
        for k in ("approvals", "agents", "findings"):
            if st[k]:
                print(f"  {k}: " + "; ".join(st[k]))
        if st["artifacts"]:
            print("  artifacts (owner): " + "; ".join(f"{k}={v}" for k, v in st["artifacts"].items()))
        if st["evidence"]:
            print("  evidence (from earlier work): " + "; ".join(st["evidence"]))
        print("  RESUME: continue at the current phase; do not redo finished phases. Earlier evidence is STALE: run the gate "
              "again before claiming green. Approvals hold only for the facts they named.")
    elif a.cmd == "close":
        # completion gate: M/L work has at least one independent review round (dev-loop). Measured 2026-10-08: Copilot first
        # closed a REVIEW checkpoint without a reviewer, then (told to record it) self-reported `set --done REVIEW` without
        # running one. So when the telemetry hook is installed, only what the HOOK saw counts (agents_seen); self-reporting
        # counts only where no hook can see subagents.
        reviewers = ("code-reviewer", "appsec", "qa-automation")
        if telemetry_hook_on(root):
            reviewed = any(x in st.get("agents_seen", []) for x in reviewers)
        else:
            reviewed = "REVIEW" in st["completed"] or any(x in st["agents"] for x in reviewers)
        if st["tier"] in ("M", "L") and not reviewed and not a.force:
            sys.exit(f"flow_state: {st['id']} is tier {st['tier']} and no independent review round ran yet. Start the review "
                     "as a subagent (`code-reviewer`; L: a second round with another focus); the telemetry hook records it, "
                     "then close again. Do not mark REVIEW done yourself: only the owner may waive the review.")
        line = record_line(st)
        print(line)
        if a.log:
            log = os.path.join(root, ".claude", "fleet", "dispatch-log.md")
            if os.path.isfile(log):
                with open(log, "a", encoding="utf-8", newline="\n") as fh:
                    note = line.replace(" | ", "; ")   # one Note cell: keep the 7-column table intact
                    fh.write(f"| {now()} | {st['flow']} | {', '.join(st['agents']) or 'none'} | UNKNOWN | UNKNOWN | UNKNOWN | {note} |\n")
        os.remove(path)


if __name__ == "__main__":
    main()
