#!/usr/bin/env python3
"""Skills this host offers the fleet's agents, per tool, and the per-agent skill allowlist (/configure-fleet-skills).

Stdlib only, no model call. Claude Code and GitHub Copilot see DIFFERENT skill sets, so everything is per tool:
  Claude Code: ~/.claude/skills, the project's .claude/skills, enabled plugins (invoked as `<plugin>:<skill>`)
  Copilot:     ~/.copilot/skills, ~/.agents/skills, the project's .github/skills, .claude/skills, .agents/skills
The fleet's own skills (.claude/fleet/skills) and its project skills (/agent-fleet ...) are never offered.

  inventory [--json]   visible skills per installed tool, with conflict flags (heuristic hints, the owner decides)
  show                 the current allowlists (.claude/fleet/project/skills.json), with skills no longer installed
  apply <plan.json>    validate a plan {"agents": {"<agent>": {"claude": [...], "copilot": [...]}}, "overrides": {...}},
                       write skills.json, then apply it to the agent files (apply_project_overlay.py)
  remove <agent>|--all drop allowlists, then re-apply

Owner decisions 2026-10-13: agents get the skill tool plus a written allowlist (no guard enforcement); conflicting skills
are excluded with a reason; the skill proposes, the owner approves before anything is written.
"""
import argparse
import json
import os
import re
import subprocess
import sys

FLEET_PROJECT_SKILLS = {"agent-fleet", "configure-fleet", "configure-fleet-skills", "configure-copilot-models",
                        "setup-agentic-fleet", "fleet"}
# Heuristic conflict hints with the fleet's rules (a specialist cannot ask the owner, start agents, push/merge or publish).
FLAGS = {
    "asks-owner": r"AskUserQuestion|\bask (?:the |your )?(?:user|human partner|owner)\b|\binterview\b|\bgrill|one question at a time"
                  r"|wait for (?:the )?(?:user|approval|confirmation)",
    "starts-agents": r"\bsub-?agents?\b|\bdispatch(?:es|ing)? (?:\w+ ){0,2}agents?\b|\bTask tool\b|\bAgent tool\b|\bspawn(?:s|ing)? (?:\w+ ){0,2}agents?\b",
    "git-remote": r"\bgit push\b|\bgit merge\b|\bpull request\b|\bgh pr\b|force-push|merge (?:it )?(?:in)?to (?:main|master)",
    "publishes": r"issue tracker|\bgh issue\b|\bcreate (?:an |a )?issue\b|\bpublish|\bLinear\b|\bJira\b|\bSlack\b",
    "takes-over": r"MUST (?:use|invoke)[^.\n]{0,80}before any|Use when starting any conversation",
}
TOOLS = ("claude", "copilot")


def home(a):
    return a.home or os.environ.get("AGENTIC_FLEET_HOME") or os.path.expanduser("~")


def read(p, n=None):
    try:
        with open(p, encoding="utf-8-sig", errors="replace") as fh:
            return fh.read(n) if n else fh.read()
    except OSError:
        return ""


def frontmatter(text):
    m = re.match(r"---\s*\n(.*?)\n---", text, re.S)
    fm = {}
    for line in (m.group(1).splitlines() if m else []):
        k, _, v = line.partition(":")
        if v and not line.startswith((" ", "\t")):
            fm[k.strip()] = v.strip().strip("'\"")
    return fm


def installed_tools(root):
    for line in read(os.path.join(root, ".claude", "fleet", ".installed")).splitlines():
        if line.startswith("tool "):
            t = line.split()[1]
            return list(TOOLS) if t == "both" else [t]
    return list(TOOLS)   # the fleet source repo has no manifest: both


def fleet_skills(root):
    d = os.path.join(root, ".claude", "fleet", "skills")
    return {n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))} if os.path.isdir(d) else set()


def skill_dirs(base):
    if not os.path.isdir(base):
        return []
    return [os.path.join(base, n) for n in sorted(os.listdir(base)) if os.path.isfile(os.path.join(base, n, "SKILL.md"))]


def claude_plugins(h, root):
    """Enabled Claude Code plugins -> [(plugin name, install path)] (installed_plugins.json + enabledPlugins)."""
    enabled = {}
    for s in (os.path.join(h, ".claude", "settings.json"), os.path.join(root, ".claude", "settings.json"),
              os.path.join(root, ".claude", "settings.local.json")):
        try:
            enabled.update(json.loads(read(s) or "{}").get("enabledPlugins") or {})
        except ValueError:
            pass
    try:
        inst = json.loads(read(os.path.join(h, ".claude", "plugins", "installed_plugins.json")) or "{}").get("plugins") or {}
    except ValueError:
        inst = {}
    out = []
    for key, entries in sorted(inst.items()):
        if enabled.get(key) is False or not isinstance(entries, list):
            continue
        for e in entries:
            proj = e.get("projectPath")
            if e.get("scope") == "project" and (not proj or os.path.normcase(os.path.abspath(proj)) != os.path.normcase(os.path.abspath(root))):
                continue
            if e.get("installPath"):
                out.append((key.split("@")[0], e["installPath"]))
                break
    return out


def sources(h, root, tool):
    """[(invocation prefix, source label, [skill dirs])] for one tool."""
    if tool == "claude":
        src = [("", "user ~/.claude/skills", os.path.join(h, ".claude", "skills")),
               ("", "project .claude/skills", os.path.join(root, ".claude", "skills"))]
        src = [(pre, label, skill_dirs(base)) for pre, label, base in src]
        for name, path in claude_plugins(h, root):
            try:   # plugin.json may list its skill folders (e.g. nested skills/<category>/<skill>)
                listed = json.loads(read(os.path.join(path, ".claude-plugin", "plugin.json")) or "{}").get("skills")
            except ValueError:
                listed = None
            listed = [listed] if isinstance(listed, str) else listed
            dirs = ([os.path.normpath(os.path.join(path, d)) for d in listed if isinstance(d, str)] if isinstance(listed, list)
                    else skill_dirs(os.path.join(path, "skills")))
            src.append((f"{name}:", f"plugin {name}", [d for d in dirs if os.path.isfile(os.path.join(d, "SKILL.md"))]
                        or skill_dirs(os.path.join(path, "skills"))))
        return src
    return [("", label, skill_dirs(base)) for label, base in (
        ("user ~/.copilot/skills", os.path.join(h, ".copilot", "skills")), ("user ~/.agents/skills", os.path.join(h, ".agents", "skills")),
        ("project .github/skills", os.path.join(root, ".github", "skills")), ("project .claude/skills", os.path.join(root, ".claude", "skills")),
        ("project .agents/skills", os.path.join(root, ".agents", "skills")))]


def inventory(h, root):
    own = fleet_skills(root)
    inv = {}
    for tool in installed_tools(root):
        seen = {}
        for prefix, label, dirs in sources(h, root, tool):
            for d in dirs:
                text = read(os.path.join(d, "SKILL.md"))
                fm = frontmatter(text)
                short = fm.get("name") or os.path.basename(d)
                if short in FLEET_PROJECT_SKILLS:
                    continue
                name = prefix + short
                if name in seen:          # first source wins (user before project, as listed)
                    continue
                flags = [f for f, rx in FLAGS.items() if re.search(rx, text, re.I)]
                if fm.get("disable-model-invocation", "").lower() == "true":
                    flags.append("user-invocable-only")
                if short in own:
                    flags.append("duplicate-of-fleet")
                seen[name] = {"name": name, "source": label, "path": os.path.join(d, "SKILL.md"),
                              "description": fm.get("description", "")[:300], "flags": flags}
        if tool == "copilot":
            # measured 2026-10-13 (CLI 1.0.96): Copilot offered an agent only the first 23 model-invocable skills in
            # alphabetical order (a size budget); later ones were never listed, so the agent could not pick them.
            # ponytail: count heuristic for a size budget; replace with a live listing check if Copilot exposes one
            listed = sorted(n for n, s in seen.items() if "user-invocable-only" not in s["flags"])
            for n in listed[COPILOT_LISTED:]:
                seen[n]["flags"].append("copilot-may-not-list")
        inv[tool] = seen
    return inv


COPILOT_LISTED = 23


def skills_path(root):
    return os.path.join(root, ".claude", "fleet", "project", "skills.json")


def load_allow(root):
    try:
        d = json.loads(read(skills_path(root)) or "{}")
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


def fleet_agent_names(root):
    """The fleet's own specialists installed here (manifest), never the Copilot coordinator or a user's agent."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from apply_project_overlay import fleet_agents
    return {os.path.basename(p).split(".")[0] for p in fleet_agents(root)}


def validate(plan, inv, root):
    errs = []
    agents = plan.get("agents") if isinstance(plan, dict) else None
    overrides = (plan.get("overrides") or {}) if isinstance(plan, dict) else {}
    if not isinstance(agents, dict) or not isinstance(overrides, dict):
        return ['plan needs {"agents": {"<agent>": {"claude": [...], "copilot": [...]}}}']
    fleet = fleet_agent_names(root)
    for agent, spec in agents.items():
        if agent not in fleet:
            errs.append(f"{agent}: not one of the fleet's installed specialists (user agents and the coordinator are never changed)")
            continue
        if not isinstance(spec, dict):
            errs.append(f"{agent}: needs {{\"claude\": [...], \"copilot\": [...]}}")
            continue
        for tool, names in spec.items():
            if tool not in TOOLS or not isinstance(names, list) or not all(isinstance(n, str) for n in names):
                errs.append(f"{agent}: '{tool}' must be one of {TOOLS} with a list of skill names")
                continue
            for n in names:
                s = inv.get(tool, {}).get(n)
                if not s:
                    errs.append(f"{agent}/{tool}: skill '{n}' is not visible to {tool} on this host")
                    continue
                hard = [f for f in s["flags"] if f in ("user-invocable-only", "duplicate-of-fleet")]
                soft = [f for f in s["flags"] if f not in hard]
                if hard:
                    errs.append(f"{agent}/{tool}: '{n}' excluded ({', '.join(hard)})")
                elif soft and not str(overrides.get(n, "")).strip():
                    errs.append(f"{agent}/{tool}: '{n}' is flagged ({', '.join(soft)}): exclude it, or give the reason the flag "
                                f"is a false positive in \"overrides\"")
    return errs


def reapply(root):
    tool = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apply_project_overlay.py")
    r = subprocess.run([sys.executable, tool, "--target", root], capture_output=True, text=True)
    print((r.stdout + r.stderr).strip())
    return r.returncode


def save_and_apply(root, data):
    """Write skills.json and apply it; on failure restore the previous file (nothing half-applied is left behind)."""
    p = skills_path(root)
    before = read(p) if os.path.isfile(p) else None
    save(root, data)
    rc = reapply(root)
    if rc:
        if before is None:
            os.remove(p)
        else:
            with open(p, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(before)
        print("skills.json: NOT changed (applying failed, see above)")
    return rc


def save(root, data):
    p = skills_path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=("inventory", "show", "apply", "remove"))
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--target", default=os.environ.get("CLAUDE_PROJECT_DIR") or ".")
    ap.add_argument("--home", help="home directory to survey (default: the user's)")
    a = ap.parse_args()
    root, h = os.path.abspath(a.target), home(a)

    if a.cmd == "inventory":
        inv = inventory(h, root)
        if a.json:
            print(json.dumps(inv, ensure_ascii=False, indent=1))
            return 0
        for tool, skills in inv.items():
            ok = sum(1 for s in skills.values() if not s["flags"])
            print(f"== {tool}: {len(skills)} skill(s), {ok} without flags")
            for s in skills.values():
                print(f"  {s['name'][:44]:44} {','.join(s['flags']) or '-':38} {s['description'][:90]}")
        return 0

    if a.cmd == "show":
        allow, inv = load_allow(root), inventory(h, root)
        agents = allow.get("agents") or {}
        if not agents:
            print("skill allowlists: none (run /configure-fleet-skills)")
        for agent, spec in sorted(agents.items()):
            for tool, names in sorted(spec.items()):
                gone = [n for n in names if n not in inv.get(tool, {})]
                print(f"  {agent:24} {tool:8} {', '.join(names)}" + (f"   MISSING on this host: {', '.join(gone)}" if gone else ""))
        return 0

    if a.cmd == "apply":
        if not a.arg:
            ap.error("apply needs a plan file")
        try:
            plan = json.loads(read(a.arg))
        except ValueError as e:
            print(f"plan: invalid JSON: {e}")
            return 3
        errs = validate(plan, inventory(h, root), root)
        if errs:
            print("plan rejected, nothing written:\n  - " + "\n  - ".join(errs))
            return 3
        allow = load_allow(root)
        merged = {ag: dict(s) for ag, s in (allow.get("agents") or {}).items() if isinstance(s, dict)}
        for ag, spec in plan["agents"].items():     # merge: only the planned agents change; [] removes that tool's list
            cur = merged.setdefault(ag, {})
            for t, n in spec.items():
                if n:
                    cur[t] = sorted(set(n))
                else:
                    cur.pop(t, None)
            if not cur:
                merged.pop(ag)
        overrides = dict(allow.get("overrides") or {}, **(plan.get("overrides") or {}))
        print(f"skills.json: {len(merged)} agent(s) with an allowlist; changed: {', '.join(sorted(plan['agents'])) or '-'}")
        return save_and_apply(root, {"version": 1, "agents": merged, "overrides": overrides})

    allow = load_allow(root)                                     # remove
    agents = allow.get("agents") or {}
    if a.all:
        agents = {}
    elif a.arg:
        agents.pop(a.arg, None)
    else:
        ap.error("remove needs an agent name or --all")
    return save_and_apply(root, dict(allow, version=1, agents=agents))


if __name__ == "__main__":
    sys.exit(main())
