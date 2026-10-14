#!/usr/bin/env python3
"""Deterministic change classifier for the fleet dev loop: S / M / L (no model call, stdlib only).

Looks at the LOCAL branch only (working tree + commits vs the merge-base with develop/main/master), never at a PR or a remote:
  size            lines, files, projects (*.csproj / *.vcxproj) touched
  sensitive paths auth, secrets, crypto, SQL/migrations, ForSharp/ERP, C++/interop, contracts/DTOs, build config
  sensitive code  added lines with [Authorize], crypto, raw SQL, P/Invoke, unsafe, Process.Start, BinaryFormatter ...
  low-risk kinds  docs, css, resx, images; tests-only changes
  no tests        code changed without any test file -> one tier up
Signals can only RAISE the tier. `--raise` (orchestrator judgment, with a reason) also only raises; `--set` is the owner's override.

Usage:
  python loop_tier.py --planned <files/areas ...> [--planned-text "task description"]   # PLAN-TIME estimate + flow (feature-flow)
  python loop_tier.py [--base REF] [--affected N] [--raise S|M|L --reason TEXT] [--set S|M|L --reason TEXT] [--config FILE] [--json] [--cwd DIR]
Exit: 0 = classified, 2 = could not classify (not a git repo, no base ref ...): the caller assumes tier M and says so.
Optional project config: .claude/fleet/loop-tiers.json (keys override DEFAULTS; dict keys are merged by name).
"""
import argparse
import json
import os
import re
import subprocess
import sys

ORDER = {"S": 0, "M": 1, "L": 2}
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"   # git's empty tree: the base of a repository with no commit
NAMES = ["S", "M", "L"]

DEFAULTS = {
    "base_candidates": ["develop", "main", "master"],
    "small": {"lines": 40, "files": 2},
    "medium": {"lines": 400, "files": 8},
    "max_projects_medium": 3,
    "affected_large": 25,
    "no_test_min_lines": 10,
    "ignore": [r"(^|/)(bin|obj|node_modules|\.vs|graphify-out|wwwroot/lib)/", r"\.Designer\.cs$", r"(packages|package)\.lock\.json$", r"\.min\.(js|css)$",
               r"(^|/)\.claude/", r"(^|/)\.github/(agents|prompts)/", r"(^|/)Agentic-main/",
               # agent instructions and the fleet's hook file: not product code (measured 2026-10-09: right after the
               # install they are uncommitted, and the first one-file fix became M)
               r"^\.github/copilot-instructions\.md$", r"^\.github/hooks/agentic-fleet\.json$", r"^(CLAUDE|AGENTS)\.md$"],
    # code signals are searched in source files only (never in data/config dumps such as .json or .csv)
    "code_extensions": [".cs", ".cshtml", ".razor", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".sql", ".ts", ".tsx", ".js", ".py", ".ps1", ".sh", ".psm1", ".fs", ".vb"],
    "test_paths": [r"(^|/)[^/]*tests?(/|$)", r"\.tests?\.", r"(Tests?|Spec)\.cs$", r"\.(spec|test)\.(js|ts|tsx)$", r"(^|/)test_[^/]*\.py$"],
    "low_risk_paths": [r"\.(md|txt|css|scss|resx|png|jpe?g|gif|svg|ico|woff2?)$", r"(^|/)docs?/"],
    # path signals: name -> [min tier, regex]  (checked on non-doc, non-test files)
    "path_signals": {
        "auth": ["L", r"(?i)(auth(?!or(?!iz))|identity|login|oauth|jwt|permission|credential|password)"],
        "secrets": ["L", r"(?i)(secret|apikey|\.env|keyvault)"],
        "crypto": ["L", r"(?i)(crypt|certificate|hashing)"],
        "sql": ["L", r"(?i)(\.sql$|(^|/)migrations?(/|$)|migration)"],
        "erp-forsharp": ["L", r"(?i:forsharp)|(?<![A-Za-z])(?:ERP|Erp|erp)(?![a-z])"],
        "native-interop": ["L", r"(?i)(\.(cpp|cc|cxx|hpp|h|c)$|interop|pinvoke|native)"],
        "contract": ["L", r"(?i)((^|/)(contracts?|dtos?|abstractions?)(/|$)|(Dto|Contract)s?\.cs$)"],
        "build-config": ["M", r"(?i)(\.csproj$|\.vcxproj$|CMakeLists\.txt$|directory\.build\.|nuget\.config$|global\.json$|appsettings.*\.json$|(^|/)\.github/workflows/|dockerfile|docker-compose)"],
    },
    # code signals on ADDED lines of code files: name -> [min tier, regex]
    "code_signals": {
        "authz": ["L", r"\[(Authorize|AllowAnonymous)\b|RequireAuthorization\(|AddAuthentication|AddAuthorization"],
        "crypto": ["L", r"System\.Security\.Cryptography|\b(Aes|RSA|SHA\d+|HMAC\w*|Rfc2898\w*|PasswordHasher)\b"],
        "secrets": ["L", r"(?i)\b(password|secret|api_?key|connection_?string|private_?key)\b\s*[:=]"],
        "raw-sql": ["L", r"FromSqlRaw|ExecuteSqlRaw|ExecuteSqlInterpolated|\bSqlCommand\b|\bSqlConnection\b|\bEXEC(UTE)?\s|\b(ALTER|DROP|CREATE|TRUNCATE)\s+(TABLE|INDEX|PROCEDURE|VIEW|DATABASE)\b|\bMERGE\s+"],
        "interop": ["L", r"\[DllImport|LibraryImport|extern\s+\"C\"|\bunsafe\b|Marshal\.|NativeLibrary|reinterpret_cast|\bmemcpy\b|\bmalloc\s*\("],
        "process-exec": ["L", r"Process\.Start|ProcessStartInfo|\bsystem\s*\("],
        "deserialization": ["L", r"BinaryFormatter|TypeNameHandling\.(All|Auto|Objects)"],
    },
    # plan-time keywords in the TASK TEXT (Hungarian and English): name -> [min tier, regex]; used by --planned / --planned-text
    "plan_keywords": {
        "auth": ["L", r"(?i)\b(auth\w*|jogosults\w*|bejelentkez\w*|login|jelsz[óo]\w*|password|szerepk[öo]r\w*)"],
        "secrets": ["L", r"(?i)\b(titok|titk[ao]\w*|secret\w*|api[- ]?kulcs\w*|api[- ]?key|connection ?string)"],
        "crypto": ["L", r"(?i)\b(titkos[íi]t\w*|encrypt\w*|decrypt\w*|crypt\w*|tan[úu]s[íi]tv[áa]ny\w*|certificate)"],
        "pii": ["L", r"(?i)\b(szem[ée]lyes adat\w*|pii|gdpr|adatv[ée]delm\w*)"],
        "sql": ["L", r"(?i)\b(sql|adatb[áa]zis\w*|database|migr[áa]ci\w*|migration|s[ée]m[áa]\w*|schema|t[áa]rolt elj[áa]r[áa]s\w*|stored procedure)"],
        "erp-forsharp": ["L", r"(?i)\b(erp|forsharp|sz[áa]ml[áa]z\w*|invoic\w*|k[öo]nyvel[ée]s\w*)"],
        "payment": ["L", r"(?i)\b(fizet[ée]s\w*|payment\w*|bankk[áa]rty\w*)"],
        "native-interop": ["L", r"(?i)(c\+\+|\binterop\b|\bnat[íi]v\w*|p/invoke|dllimport)"],
        "contract": ["L", r"(?i)(publikus api|public api|api[- ]szerz[őo]d[ée]s\w*|api contract|breaking change|visszafel[ée] kompatib\w*|backward[- ]compat\w*)"],
        "build-config": ["M", r"(?i)\b(pipeline|ci/cd|nuget|f[üu]gg[őo]s[ée]g\w*|dependenc\w*|global\.json|csproj)"],
    },
    # workflow variant of the TASK TEXT (feature-flow "Flows"): name -> regex. No match = feature; more than one = "?" (the
    # orchestrator decides, the script never fakes certainty). Projects may override in loop-tiers.json like plan_keywords.
    "flow_keywords": {
        # bug-fix: words for WRONG behaviour; not "exception/error handling", "regression test" or "hibaüzenet" (features)
        "bug-fix": r"(?i)\b(bugs?|bugfix|fix(es|ed|ing)?|hotfix|(ki)?jav[íi]ts(d|uk|a)?|kijav[íi]t\w*|hib[aá](s|t|ja|ás|ák|át|ához)?\b(?!\s*(kezel|üzenet|jelz))|null ?reference\w*|crash(es|ed|ing)?|[öo]sszeoml\w*|nem m[űu]k[öo]d\w*|elromlott|broken|regresszi[óo]\b|throws?)\b",
        "refactor": r"(?i)\b(refaktor\w*|refactor\w*|clean ?up|kitakar[íi]t\w*|duplik[áa]ci[óo]\w*|duplicat(ed|ion)\b(?!\s+key)|deduplicat\w*|[áa]tszervez\w*|restructur\w*|without (any )?behaviou?r change|viselked[ée]s(v[áa]ltoz[áa]s)? n[ée]lk[üu]l)",
        "architecture-change": r"(?i)\b(architekt[úu]r\w*|architectur\w*|adr|framework (change|switch|migration)|keretrendszer[- ]?(csere|v[áa]lt[áa]s|migr[áa]ci[óo])\w*|monolit\w*|microservices?|mikroszolg[áa]ltat[áa]s\w*)\b",
        "requirement-to-code": r"(?i)(üzleti ig[ée]ny\w*|business requirements?\b|\buser stor(y|ies)\b|felhaszn[áa]l[óo]i t[öo]rt[ée]net\w*|elfogad[áa]si krit[ée]rium\w*|acceptance criteri\w*)",
    },
    # signals that also call for the appsec reviewer
    "appsec_signals": ["auth", "secrets", "crypto", "authz", "deserialization", "process-exec", "native-interop", "interop", "pii", "payment"],
}


def deep_merge(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def git(args, cwd):
    p = subprocess.run(["git", "-c", "core.quotepath=false"] + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {p.stderr.strip()[:200]}")
    return p.stdout


def find_base(cfg, cwd, cli_base):
    if cli_base:
        return git(["merge-base", cli_base, "HEAD"], cwd).strip(), cli_base
    for cand in cfg["base_candidates"]:
        for ref in (cand, "origin/" + cand):
            if subprocess.run(["git", "rev-parse", "--verify", "-q", ref], cwd=cwd, capture_output=True).returncode == 0:
                return git(["merge-base", ref, "HEAD"], cwd).strip(), ref
    if subprocess.run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=cwd, capture_output=True).returncode != 0:
        # a repository without any commit yet: everything in it is the change (measured 2026-10-09: the M fallback here made
        # the orchestrator run review + QA on a one-file fix). With commits but no known base branch the M fallback stays:
        # diffing against HEAD would hide the work already committed on the branch.
        return EMPTY_TREE, "(no commits yet)"
    raise RuntimeError("no base ref found (tried " + ", ".join(cfg["base_candidates"]) + "); pass --base")


def read_untracked(root, rel):
    path = os.path.join(root, rel)
    try:
        if os.path.getsize(path) > 2_000_000:
            return 0, ""
        data = open(path, "rb").read()
    except OSError:
        return 0, ""
    if b"\0" in data[:8000]:
        return 1, ""
    text = data.decode("utf-8", "replace")
    return text.count("\n") + (0 if text.endswith("\n") or not text else 1), text


def collect(cfg, cwd, mb):
    root = git(["rev-parse", "--show-toplevel"], cwd).strip()
    ignore = [re.compile(p) for p in cfg["ignore"]]
    skip = lambda f: any(r.search(f) for r in ignore)
    files, added = {}, {}
    for line in git(["diff", "--numstat", "--no-renames", mb], root).splitlines():
        a, d, f = line.split("\t", 2)
        if skip(f):
            continue
        files[f] = (int(a) if a.isdigit() else 0) + (int(d) if d.isdigit() else 0)
    cur = None
    for line in git(["diff", "-U0", "--no-renames", mb], root).splitlines():
        if line.startswith("+++ b/"):
            cur = line[6:]
        elif line.startswith("+") and not line.startswith("+++") and cur and cur in files:
            added.setdefault(cur, []).append(line[1:])
    for f in git(["ls-files", "--others", "--exclude-standard"], root).splitlines():
        if skip(f) or f in files:
            continue
        n, text = read_untracked(root, f)
        files[f] = n
        added[f] = text.splitlines()
    return root, files, added


def project_of(root, rel, cache):
    d = os.path.dirname(rel)
    chain = []
    while True:
        if d in cache:
            res = cache[d]
            break
        full = os.path.join(root, d) if d else root
        try:
            hit = any(n.endswith((".csproj", ".vcxproj")) for n in os.listdir(full))
        except OSError:
            hit = False
        chain.append(d)
        if hit:
            res = d or "(root)"
            break
        if not d:
            res = "(none)"
            break
        d = os.path.dirname(d)
    for c in chain:
        cache[c] = res
    return res


def classify(cfg, cwd, base_ref=None, affected=None, raise_to=None, set_to=None, reason=""):
    mb, ref = find_base(cfg, cwd, base_ref)
    root, files, added = collect(cfg, cwd, mb)
    test_re = [re.compile(p, re.I) for p in cfg["test_paths"]]
    low_re = [re.compile(p, re.I) for p in cfg["low_risk_paths"]]
    is_test = lambda f: any(r.search(f) for r in test_re)
    is_low = lambda f: any(r.search(f) for r in low_re)
    tests = [f for f in files if is_test(f)]
    lows = [f for f in files if not is_test(f) and is_low(f)]
    code = [f for f in files if f not in tests and f not in lows]
    lines = sum(files.values())
    cache = {}
    projects = sorted({project_of(root, f, cache) for f in code} - {"(none)"})
    reasons, signals = [], []

    # 1) size
    sm, md = cfg["small"], cfg["medium"]
    if not files:
        tier = "S"; reasons.append("no changes against the base")
    elif not code:
        tier = "S" if lines <= md["lines"] else "M"
        reasons.append("only tests/docs/styles changed" + ("" if tier == "S" else f" but large ({lines} lines)"))
    elif lines <= sm["lines"] and len(files) <= sm["files"]:
        tier = "S"; reasons.append(f"small change: {len(files)} file(s), {lines} lines")
    elif lines <= md["lines"] and len(files) <= md["files"] and len(projects) <= cfg["max_projects_medium"]:
        tier = "M"; reasons.append(f"medium change: {len(files)} file(s), {lines} lines, {len(projects)} project(s)")
    else:
        tier = "L"; reasons.append(f"large change: {len(files)} file(s), {lines} lines, {len(projects)} project(s)")

    def bump(to, why, sig=None):
        nonlocal tier
        if sig:
            signals.append(sig)
        if ORDER[to] > ORDER[tier]:
            tier = to
        reasons.append(why)

    # 2) signals (raise only)
    for f in code:
        for name, (mn, rx) in cfg["path_signals"].items():
            if re.search(rx, f):
                bump(mn, f"sensitive path [{name}]: {f}", name)
        if os.path.splitext(f)[1].lower() not in cfg["code_extensions"]:
            continue
        for line in added.get(f, []):
            for name, (mn, rx) in cfg["code_signals"].items():
                if re.search(rx, line):
                    bump(mn, f"sensitive code [{name}] in {f}", name)
                    break
    signals = sorted(set(signals))
    if affected is not None and affected >= cfg["affected_large"]:
        bump("L", f"large blast radius: graphify reports {affected} affected nodes (>= {cfg['affected_large']})", "blast-radius")
    no_tests = bool(code) and not tests and sum(files[f] for f in code) >= cfg["no_test_min_lines"]
    if no_tests and tier != "L":
        bump(NAMES[ORDER[tier] + 1], "behaviour change without any test file: one tier up", "no-tests")
    elif no_tests:
        signals.append("no-tests")

    # 3) orchestrator judgment (raise only) and owner override
    notes = []
    if raise_to:
        if ORDER[raise_to] > ORDER[tier]:
            tier = raise_to
            notes.append(f"raised to {raise_to} by the orchestrator: {reason or 'no reason given'}")
        else:
            notes.append(f"--raise {raise_to} ignored (tier is already {tier}; the tier is never lowered this way)")
    if set_to:
        notes.append(f"owner override {tier} -> {set_to}: {reason or 'no reason given'}")
        tier = set_to

    rounds = {"S": 0, "M": 1, "L": 2}[tier]
    plan = {
        "gates": True,
        "review_rounds": rounds,
        "round_1": "code-reviewer (fresh context)" if rounds >= 1 else None,
        "round_2": "second independent view: different focus (security/data/concurrency) or appsec; a different model only if the owner asks" if rounds >= 2 else None,
        "appsec": bool(set(signals) & set(cfg["appsec_signals"])) and tier != "S",
        "database_review": any(s in signals for s in ("sql", "raw-sql")),
        "qa_automation": no_tests and tier != "S",
    }
    return {"tier": tier, "base": ref, "merge_base": mb[:10], "files": len(files), "lines": lines, "projects": len(projects),
            "tests_changed": len(tests), "signals": signals, "reasons": reasons, "notes": notes, "plan": plan, "fallback": False}



def flow_of(cfg, text):
    """Workflow variant from the task text: (flow, matches). One clear match -> that flow; none -> feature; several -> "?"."""
    hits = {}
    for name, rx in cfg.get("flow_keywords", {}).items():
        m = re.search(rx, text or "")
        if m:
            hits[name] = m.group(0)
    flow = "feature" if not hits else next(iter(hits)) if len(hits) == 1 else "?"
    return flow, hits


def estimate(cfg, root, planned, text="", affected=None, raise_to=None, set_to=None, reason=""):
    """Plan-time estimate BEFORE any code exists: from the planned files/areas and the task text (no git diff needed).
    Same tiers and the same raise-only rules as the diff classifier; the real diff re-classifies the work later."""
    ignore = [re.compile(p) for p in cfg["ignore"]]
    files = sorted({p.replace("\\", "/").strip("/") for p in planned if p.strip()} - {""})
    files = [f for f in files if not any(r.search(f) for r in ignore)]
    test_re = [re.compile(p, re.I) for p in cfg["test_paths"]]
    low_re = [re.compile(p, re.I) for p in cfg["low_risk_paths"]]
    tests = [f for f in files if any(r.search(f) for r in test_re)]
    lows = [f for f in files if f not in tests and any(r.search(f) for r in low_re)]
    code = [f for f in files if f not in tests and f not in lows]
    cache = {}
    projects = sorted({project_of(root, f, cache) for f in code} - {"(none)"})
    reasons, signals = [], []
    sm, md = cfg["small"], cfg["medium"]
    if not files and not text.strip():
        tier = "M"; reasons.append("nothing planned yet: assume M until the plan names the files/areas")
    elif not code:
        tier = "S"; reasons.append("only tests/docs/styles planned" if files else "no files named yet (text only)")
    elif len(files) <= sm["files"]:
        tier = "S"; reasons.append(f"small plan: {len(files)} file(s)")
    elif len(files) <= md["files"] and len(projects) <= cfg["max_projects_medium"]:
        tier = "M"; reasons.append(f"medium plan: {len(files)} file(s), {len(projects)} project(s)")
    else:
        tier = "L"; reasons.append(f"large plan: {len(files)} file(s), {len(projects)} project(s)")

    def bump(to, why, sig):
        nonlocal tier
        signals.append(sig)
        if ORDER[to] > ORDER[tier]:
            tier = to
        reasons.append(why)

    for f in code:
        for name, (mn, rx) in cfg["path_signals"].items():
            if re.search(rx, f):
                bump(mn, f"sensitive path [{name}]: {f}", name)
    for name, (mn, rx) in cfg["plan_keywords"].items():
        m = re.search(rx, text or "")
        if m:
            bump(mn, f"sensitive topic in the task [{name}]: \"{m.group(0)}\"", name)
    if affected is not None and affected >= cfg["affected_large"]:
        bump("L", f"large blast radius: graphify reports {affected} affected nodes", "blast-radius")
    no_tests = bool(code) and not tests
    if no_tests and tier != "L":
        bump(NAMES[ORDER[tier] + 1], "code planned without any test file: one tier up (plan the tests)", "no-tests")
    elif no_tests:
        signals.append("no-tests")
    signals = sorted(set(signals))
    notes = []
    if raise_to:
        if ORDER[raise_to] > ORDER[tier]:
            tier = raise_to
            notes.append(f"raised to {raise_to} by the orchestrator: {reason or 'no reason given'}")
        else:
            notes.append(f"--raise {raise_to} ignored (tier is already {tier})")
    if set_to:
        notes.append(f"owner override {tier} -> {set_to}: {reason or 'no reason given'}")
        tier = set_to
    decision_signals = set(signals) & {"contract", "sql", "raw-sql", "build-config", "erp-forsharp"}
    flow, flow_hits = flow_of(cfg, text)
    if flow == "architecture-change":
        decision_signals.add("architecture")
    approval = {"S": "none", "M": "only if the plan contains a decision", "L": "required"}[tier]
    if decision_signals and tier != "L":
        approval = "required (decision: " + ", ".join(sorted(decision_signals)) + ")"
    rounds = {"S": 0, "M": 1, "L": 2}[tier]
    return {"tier": tier, "estimate": True, "flow": flow, "flow_candidates": flow_hits, "planned_files": len(files), "projects": len(projects), "tests_planned": len(tests),
            "signals": signals, "reasons": reasons, "notes": notes, "approval": approval,
            "plan": {"gates": True, "review_rounds": rounds,
                     "appsec": bool(set(signals) & set(cfg["appsec_signals"])) and tier != "S",
                     "database_review": any(s in signals for s in ("sql", "raw-sql")),
                     "qa_automation": no_tests and tier != "S"},
            "fallback": False}


def remember(root, res):
    """The last estimate for the Copilot stop gate (guard.py reads it): temp dir, keyed like guard.session_marker."""
    try:
        import hashlib
        import tempfile
        d = os.path.join(tempfile.gettempdir(), "agentic-fleet-session")
        os.makedirs(d, exist_ok=True)
        key = hashlib.sha1(os.path.normcase(os.path.realpath(root)).encode()).hexdigest()[:10]
        with open(os.path.join(d, f"{key}-estimate.json"), "w", encoding="utf-8") as fh:
            json.dump({"tier": res.get("tier"), "flow": res.get("flow")}, fh)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser(description="Classify the local change as S/M/L for the fleet dev loop")
    ap.add_argument("--base")
    ap.add_argument("--affected", type=int, help="graphify `affected` node count, if known")
    ap.add_argument("--raise", dest="raise_to", choices=NAMES)
    ap.add_argument("--set", dest="set_to", choices=NAMES)
    ap.add_argument("--reason", default="")
    ap.add_argument("--config")
    ap.add_argument("--cwd", default=".")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--planned", nargs="*", help="PLAN-TIME estimate: the files/areas the plan will touch (no diff needed)")
    ap.add_argument("--planned-text", default="", help="PLAN-TIME estimate: the task description (sensitive topics raise the tier)")
    a = ap.parse_args()
    if a.planned is not None or a.planned_text:
        try:
            root = git(["rev-parse", "--show-toplevel"], a.cwd).strip()
        except Exception:
            root = os.path.abspath(a.cwd)          # a plan estimate does not need a git repository
        cfg = DEFAULTS
        cfg_path = a.config or os.path.join(root, ".claude", "fleet", "loop-tiers.json")
        if os.path.isfile(cfg_path):
            cfg = deep_merge(DEFAULTS, json.load(open(cfg_path, encoding="utf-8")))
        res = estimate(cfg, root, a.planned or [], a.planned_text, a.affected, a.raise_to, a.set_to, a.reason)
        remember(root, res)
        if a.json:
            print(json.dumps(res, ensure_ascii=False, indent=2))
        else:
            p = res["plan"]
            print(f"ESTIMATE {res['tier']} | {res['planned_files']} planned file(s), {res['projects']} project(s), "
                  f"tests planned: {res['tests_planned']} | owner approval: {res['approval']}")
            for r in res["reasons"] + res["notes"]:
                print("  - " + r)
            print(f"  plan: gates, {p['review_rounds']} review round(s)" + (", appsec" if p["appsec"] else "")
                  + (", database review" if p["database_review"] else "") + (", qa-automation" if p["qa_automation"] else ""))
            hits = ", ".join(f'{k} "{v}"' for k, v in res["flow_candidates"].items())
            print(f"  flow: {res['flow']}" + {"feature": " (default: no flow keyword)", "?": f" (ambiguous: {hits}; the orchestrator decides)"}
                  .get(res["flow"], f" ({hits})"))
        return
    try:
        root = git(["rev-parse", "--show-toplevel"], a.cwd).strip()
        cfg = DEFAULTS
        cfg_path = a.config or os.path.join(root, ".claude", "fleet", "loop-tiers.json")
        if os.path.isfile(cfg_path):
            cfg = deep_merge(DEFAULTS, json.load(open(cfg_path, encoding="utf-8")))
        res = classify(cfg, a.cwd, a.base, a.affected, a.raise_to, a.set_to, a.reason)
        remember(root, res)
    except Exception as e:  # not a git repo, no base, bad config: the caller falls back to M and says so
        print(json.dumps({"tier": "M", "fallback": True, "error": str(e)}) if a.json else f"TIER M (fallback: {e})", file=sys.stdout)
        sys.exit(2)
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        p = res["plan"]
        print(f"TIER {res['tier']} | base {res['base']} | {res['files']} file(s), {res['lines']} lines, {res['projects']} project(s), tests changed: {res['tests_changed']}")
        for r in res["reasons"] + res["notes"]:
            print("  - " + r)
        print(f"  plan: gates, {p['review_rounds']} review round(s)" + (", appsec" if p["appsec"] else "") + (", database review" if p["database_review"] else "")
              + (", qa-automation" if p["qa_automation"] else ""))


if __name__ == "__main__":
    main()
