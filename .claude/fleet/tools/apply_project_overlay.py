#!/usr/bin/env python3
"""Apply the PROJECT overlay written by /configure-fleet onto the installed fleet (deterministic, stdlib only, idempotent).

Why an overlay: the installed agent/policy/skill files are replaced on every fleet update. The project-specific tailoring
therefore lives in `.claude/fleet/project/` (kept by update and uninstall) and is re-applied by this script, which the
installer runs after every install/update.

Inputs (all optional):
  .claude/fleet/project/profile.md    project stack profile -> written to .claude/fleet/ref/stack-profile.md
  .claude/fleet/project/overlay.json  {"version": 1,
                                        "agents": {"<agent>": {"description": "...", "edits": [{"old": "...", "new": "..."}],
                                                               "sections": [{"id": "...", "after": "## Heading prefix", "text": "## ..."}]}},
                                        "files":  {"<path under .claude/fleet/>": {"edits": [...], "sections": [...]}}}
Agent entries apply to BOTH .claude/agents/<agent>.md (Claude Code) and .github/agents/<agent>.agent.md (Copilot), whichever exist.
Edits are literal replacements of the installed text: "applied" / "already" (new text present) / "stale" (neither: the base
changed, revisit the overlay). Sections are wrapped in markers, so re-applying replaces them and removed ids disappear.
Only the `description` frontmatter line may change; tools/model/maxTurns/omitClaudeMd are never touched.
After policy edits the managed block of .github/copilot-instructions.md is re-synced from the patched policy file.

Usage: python apply_project_overlay.py [--target DIR] [--check] [--quiet]
Exit: 0 = ok (stale edits are reported as warnings), 3 = invalid overlay (nothing written).
"""
import argparse
import json
import os
import re
import sys

BEGIN = "<!-- BEGIN agentic-fleet (managed by install.sh; do not edit inside) -->"
END = "<!-- END agentic-fleet -->"
ID_RX = re.compile(r"^[a-z0-9][a-z0-9._-]{0,60}$")


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, t):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(t)


def validate(ov):
    errs = []
    if not isinstance(ov, dict) or ov.get("version") != 1:
        errs.append('overlay must be an object with "version": 1')
        return errs
    for group in ("agents", "files"):
        g = ov.get(group, {})
        if not isinstance(g, dict):
            errs.append(f'"{group}" must be an object')
            continue
        for key, spec in g.items():
            if group == "files" and (key.startswith(("/", "\\")) or ".." in key.replace("\\", "/").split("/")):
                errs.append(f"files: unsafe path {key!r} (must be relative to .claude/fleet/)")
            if group == "agents" and not re.match(r"^[a-z0-9-]+$", key):
                errs.append(f"agents: bad agent name {key!r}")
            if not isinstance(spec, dict):
                errs.append(f"{group}.{key} must be an object")
                continue
            for e in spec.get("edits", []):
                if not (isinstance(e, dict) and isinstance(e.get("old"), str) and isinstance(e.get("new"), str) and e["old"]):
                    errs.append(f"{group}.{key}: every edit needs non-empty 'old' and a 'new' string")
            for s in spec.get("sections", []):
                if not (isinstance(s, dict) and isinstance(s.get("text"), str) and ID_RX.match(str(s.get("id", "")))):
                    errs.append(f"{group}.{key}: every section needs an 'id' ([a-z0-9._-]) and a 'text'")
            if "description" in spec and (group != "agents" or not isinstance(spec["description"], str) or not spec["description"].strip()):
                errs.append(f"{group}.{key}: 'description' is only allowed for agents and must be a non-empty string")
    return errs


def apply_edits(text, edits, report):
    for e in edits:
        # "already" first: an append-style edit (new contains old) must not be applied twice
        # (a very short `new` can occur by chance, so it never counts as "already applied")
        if len(e["new"].strip()) >= 12 and e["new"] in text and (e["old"] in e["new"] or e["old"] not in text):
            report["already"] += 1
        elif e["old"] in text:
            text = text.replace(e["old"], e["new"])
            report["applied"] += 1
        else:
            report["stale"].append(e["old"][:70])
    return text


def apply_sections(text, sections, report):
    wanted = {s["id"] for s in sections}
    # drop overlay blocks that are no longer in the overlay
    for old_id in set(re.findall(r"<!-- project-overlay:([a-z0-9._-]+) -->", text)) - wanted:
        text = re.sub(rf"\n?<!-- project-overlay:{re.escape(old_id)} -->.*?<!-- /project-overlay:{re.escape(old_id)} -->\n?", "\n", text, flags=re.S)
        report["removed"] += 1
    for s in sections:
        sid = s["id"]
        block = f"<!-- project-overlay:{sid} -->\n{s['text'].strip()}\n<!-- /project-overlay:{sid} -->"
        pat = re.compile(rf"<!-- project-overlay:{re.escape(sid)} -->.*?<!-- /project-overlay:{re.escape(sid)} -->", re.S)
        if pat.search(text):
            text = pat.sub(lambda m: block, text)
            report["sections"] += 1
            continue
        lines = text.split("\n")
        idx = None
        if s.get("after"):
            start = next((i for i, l in enumerate(lines) if l.startswith(s["after"])), None)
            if start is not None:
                idx = next((j for j in range(start + 1, len(lines)) if lines[j].startswith("## ")), len(lines))
        if idx is None:
            idx = next((i for i, l in enumerate(lines) if l.startswith("## Runtime contract")), len(lines))
        lines[idx:idx] = [block, ""]
        text = "\n".join(lines)
        report["sections"] += 1
    return re.sub(r"\n{3,}", "\n\n", text)


def set_description(text, desc, report):
    if not text.startswith("---"):
        report["stale"].append("frontmatter missing")
        return text
    end = text.find("\n---", 3)
    fm, rest = text[:end], text[end:]
    new = f"description: {json.dumps(desc.strip(), ensure_ascii=False)}"
    fm2, n = re.subn(r"(?m)^description:.*$", lambda m: new, fm, count=1)
    if n:
        report["applied" if fm2 != fm else "already"] += 1
    return fm2 + rest


def frontmatter_ok(text, name):
    if not text.startswith("---"):
        return False
    fm = text[: text.find("\n---", 3)]
    return re.search(rf"(?m)^name: {re.escape(name)}\s*$", fm) is not None and re.search(r"(?m)^description: \S", fm) is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default=".")
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.target)
    fleet = os.path.join(root, ".claude", "fleet")
    proj = os.path.join(fleet, "project")
    ov_path, prof_path = os.path.join(proj, "overlay.json"), os.path.join(proj, "profile.md")
    if not os.path.isfile(ov_path) and not os.path.isfile(prof_path):
        if not a.quiet:
            print("project overlay: none (run /configure-fleet to create one)")
        return 0
    ov = {"version": 1}
    if os.path.isfile(ov_path):
        try:
            ov = json.loads(read(ov_path))
        except ValueError as e:
            print(f"project overlay: INVALID JSON in {ov_path}: {e}")
            return 3
        errs = validate(ov)
        if errs:
            print("project overlay: INVALID, nothing written:\n  - " + "\n  - ".join(errs))
            return 3

    writes, lines_out = {}, []
    total = {"applied": 0, "already": 0, "stale": 0, "sections": 0, "removed": 0}

    def process(path, spec, label, agent=None):
        if not os.path.isfile(path):
            return
        text = writes.get(path, read(path))
        rep = {"applied": 0, "already": 0, "stale": [], "sections": 0, "removed": 0}
        if agent and spec.get("description"):
            text = set_description(text, spec["description"], rep)
        text = apply_edits(text, spec.get("edits", []), rep)
        text = apply_sections(text, spec.get("sections", []), rep)
        if agent and not frontmatter_ok(text, agent):
            print(f"project overlay: INVALID result for {label} (frontmatter broken), nothing written")
            sys.exit(3)
        writes[path] = text
        for k in ("applied", "already", "sections", "removed"):
            total[k] += rep[k]
        total["stale"] += len(rep["stale"])
        for s in rep["stale"]:
            lines_out.append(f"  WARN stale edit in {label}: {s!r} (the installed text changed; update overlay.json)")

    for agent, spec in ov.get("agents", {}).items():
        found = False
        for path in (os.path.join(root, ".claude", "agents", agent + ".md"), os.path.join(root, ".github", "agents", agent + ".agent.md")):
            if os.path.isfile(path):
                found = True
                process(path, spec, os.path.relpath(path, root), agent)
        if not found:
            lines_out.append(f"  WARN agent {agent!r} is not installed (no .claude/agents or .github/agents file)")
    for rel, spec in ov.get("files", {}).items():
        path = os.path.join(fleet, rel)
        if not os.path.isfile(path):
            lines_out.append(f"  WARN file .claude/fleet/{rel} not found")
            continue
        process(path, spec, ".claude/fleet/" + rel)

    if os.path.isfile(prof_path):
        writes[os.path.join(fleet, "ref", "stack-profile.md")] = (
            "<!-- project profile: generated by /configure-fleet; edit .claude/fleet/project/profile.md, then re-run apply_project_overlay.py -->\n"
            + read(prof_path).lstrip("﻿"))

    # re-sync the Copilot managed block from the (patched) policy file it was built from
    cinstr = os.path.join(root, ".github", "copilot-instructions.md")
    if os.path.isfile(cinstr):
        ct = read(cinstr)
        m = re.search(re.escape(BEGIN) + r"\n(.*?)\n" + re.escape(END), ct, re.S)
        if m:
            src = "POLICY.copilot.lite.md" if "ALAPÁLLAPOT KI" in m.group(1) else "POLICY.copilot.md"
            sp = os.path.join(fleet, src)
            body = writes.get(sp, read(sp) if os.path.isfile(sp) else None)
            if body is not None and body.rstrip() != m.group(1).rstrip():
                writes[cinstr] = ct[:m.start(1)] + body.rstrip() + ct[m.end(1):]

    changed = [p for p, t in writes.items() if not os.path.isfile(p) or read(p) != t]
    if not a.check:
        for p in changed:
            write(p, writes[p])
    if not a.quiet or total["stale"]:
        verb = "would change" if a.check else "changed"
        print(f"project overlay: {verb} {len(changed)} file(s); edits applied {total['applied']}, already {total['already']}, "
              f"stale {total['stale']}; sections {total['sections']}, removed {total['removed']}")
        for l in lines_out:
            print(l)
    return 0


if __name__ == "__main__":
    sys.exit(main())
