#!/usr/bin/env python3
"""Adaptive model routing for GitHub Copilot fleet specialists (stdlib only, no model call, no network).

Agent routing (which specialist) stays with the orchestrator; this module only answers: which model should the already
chosen specialist run on for this subtask? The guard hook calls route() on a Copilot `task` call and writes the model into
the call (preToolUse `modifiedArgs`): no extra LLM call, no terminal command, no approval. The root/session model is never
touched. Any failure -> no override (the specialist inherits the session model) and the fleet carries on.

  python model_router.py status            # host, provider, inventory, per-agent primary/fallbacks
  python model_router.py resolve           # refresh inventory + resolved profiles (also done by the sessionStart hook)
  python model_router.py reset             # delete the local routing cache only (.claude/fleet/project/model-routing/*.local.json)
  python model_router.py route <agent> [--prompt TEXT]   # one decision, as JSON
  python model_router.py import-calibration <results.json>...   # local evidence from eval runs (CALIBRATE)

Host facts (Copilot CLI 1.0.9 source + measurements, 2026-10-12): the `task` tool takes an optional `model`; a preToolUse
hook may return `modifiedArgs`; per-dispatch reasoning effort does not exist (session level only); every model call is
recorded in ~/.copilot/session-store.db (assistant_usage_events). VS Code: its Copilot CLI chat sessions run the same
runtime and honour the per-dispatch model (measured); VS Code's own agent mode (runSubagent) and Visual Studio: not
verified -> inheritance there.
"""
import glob
import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
COORDINATOR = "fleet-orchestrator"
OFF = ("off", "0", "false", "no")


# --- files ---------------------------------------------------------------------------------------------------------
def static_dir(root):
    return os.path.join(root, ".claude", "fleet", "model-routing")


def local_dir(root):
    return os.path.join(root, ".claude", "fleet", "project", "model-routing")


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
    gi = os.path.join(os.path.dirname(path), ".gitignore")
    if not os.path.exists(gi):   # machine/account cache never committed by accident; local-agent-requirements.json is kept
        with open(gi, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("*.local.json\n*.local.jsonl\n")


def digest(obj):
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:12]


def disabled(root):
    return os.environ.get("AGENTIC_FLEET_MODEL_ROUTING", "").lower() in OFF or os.path.exists(os.path.join(local_dir(root), "disabled"))


# --- host and provider -----------------------------------------------------------------------------------------------
def detect_host(hint=None):
    """The runtime that executes the specialist call. A CLI-shaped hook payload (camelCase toolName/toolArgs, a `task`
    call) proves the Copilot CLI runtime, also inside VS Code: its Copilot CLI chat sessions run that runtime (measured
    2026-10-12: hooks fire with the CLI payload, a per-dispatch `model` in the task call is honoured)."""
    env = os.environ
    if hint == "copilot-cli" or env.get("COPILOT_CLI") == "1":
        return "copilot-cli"
    if env.get("VisualStudioVersion") or env.get("VSAPPIDDIR"):
        return "visual-studio"
    if env.get("VSCODE_PID") or env.get("TERM_PROGRAM") == "vscode":
        return "vscode"
    return hint or "unknown"


def copilot_home():
    return os.environ.get("COPILOT_HOME") or os.path.join(os.path.expanduser("~"), ".copilot")


def cli_inventory(max_age_days):
    """Models this machine's Copilot CLI actually ran recently, with official usage metadata. (models, state, source mtime)."""
    db = os.path.join(copilot_home(), "session-store.db")
    if not os.path.isfile(db):
        return [], "UNAVAILABLE", None
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).strftime("%Y-%m-%dT%H:%M:%S")
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        rows = con.execute(
            "select model, count(*), avg(total_nano_aiu), max(request_multiplier), group_concat(distinct reasoning_effort), "
            "max(created_at) from assistant_usage_events where created_at >= ? and model is not null group by model", (cutoff,)).fetchall()
        con.close()
    except sqlite3.Error:
        return [], "ERROR", None
    models = [{"id": m, "availability": "observed", "calls": n,
               "creditsPerCall": round(aiu / 1e9, 4) if aiu is not None else None,
               "multiplier": mult, "observedEfforts": sorted(x for x in (eff or "").split(",") if x), "lastSeen": last,
               "perDispatchEffort": False}   # the CLI task tool has no effort parameter
              for m, n, aiu, mult, eff, last in rows]
    return sorted(models, key=lambda x: x["id"]), ("READY" if models else "UNAVAILABLE"), os.path.getmtime(db)


def companion_models(root, vendor, max_age_days):
    """Models the optional VS Code companion exported (VS Code LM API) for one vendor: 'copilotcli' = what the Copilot CLI
    offers, 'copilot' = VS Code chat. Stale (older than max_age_days) or missing -> []."""
    doc = load(os.path.join(local_dir(root), "host-models.local.json"), {}) or {}
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(str(doc.get("generatedAt", "")).replace("Z", "+00:00"))
    except ValueError:
        return []
    if age > timedelta(days=max_age_days):
        return []
    return [m for m in doc.get("models", []) if isinstance(m, dict) and m.get("vendor") == vendor and m.get("id")]


def inventory(root, host, policy):
    """Normalized inventory for this host, cached; a provider that is not verified for the host yields no models.
    Copilot CLI: the models it actually ran (usage records: cost known) plus, if the VS Code companion exported it, every
    model the CLI offers ('listed': cost unknown until first used)."""
    path = os.path.join(local_dir(root), "model-inventory.local.json")
    if host != "copilot-cli":
        return {"host": host, "provider": None, "providerState": "UNAVAILABLE", "models": [], "inventoryHash": None}
    db = os.path.join(copilot_home(), "session-store.db")
    comp = os.path.join(local_dir(root), "host-models.local.json")
    cached = load(path)
    mtime = os.path.getmtime(db) if os.path.isfile(db) else None
    cmtime = os.path.getmtime(comp) if os.path.isfile(comp) else None
    if cached and cached.get("host") == host and cached.get("sourceMtime") == mtime and cached.get("companionMtime") == cmtime and mtime is not None:
        return cached
    models, state, mtime = cli_inventory(policy["inventory"]["maxAgeDays"])
    seen = {m["id"] for m in models}
    listed = companion_models(root, "copilotcli", policy["inventory"]["maxAgeDays"])
    models += [{"id": m["id"], "availability": "listed", "calls": 0, "creditsPerCall": None, "multiplier": None,
                "observedEfforts": [], "lastSeen": None, "perDispatchEffort": False, "contextLimit": m.get("maxInputTokens")}
               for m in listed if m["id"] not in seen]
    models.sort(key=lambda x: x["id"])
    if listed and state == "UNAVAILABLE":
        state = "READY"
    inv = {"host": host, "provider": "copilot-cli-usage-records" + ("+vscode-companion" if listed else ""), "providerState": state,
           "sourceMtime": mtime, "companionMtime": cmtime,
           "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "inventoryHash": digest([(m["id"], m["multiplier"]) for m in models]), "models": models}
    try:
        save(path, inv)
    except OSError:
        pass
    return inv


# --- requirements and evidence ---------------------------------------------------------------------------------------
def requirements(root):
    req = load(os.path.join(static_dir(root), "agent-requirements.json"), {}).get("agents", {})
    local = load(os.path.join(local_dir(root), "local-agent-requirements.json"), {})
    out = {k: dict(v, profileSource="factory") for k, v in req.items()}
    for k, v in (local or {}).items():
        if isinstance(v, dict):
            out[k] = dict(out.get(k, {}), **v)
    return out


def evidence(root):
    """{(workload, model): [samples, passes]} from the factory baseline and the local calibration."""
    ev = {}
    for doc in (load(os.path.join(static_dir(root), "factory-baseline.json"), {}),
                load(os.path.join(local_dir(root), "calibration.local.json"), {})):
        for e in (doc or {}).get("modelEvidence", []):
            k = (e.get("workload"), e.get("observedModel"))
            if None in k:
                continue
            s = ev.setdefault(k, [0, 0])
            s[0] += int(e.get("sampleCount", 0))
            s[1] += int(round(e.get("passRate", 0) * int(e.get("sampleCount", 0))))
    return ev


def evidence_from_results(paths, tasks_dir=None, requirements_map=None):
    """Model evidence from eval result files: only runs where ONE known specialist was graded and its actual model is
    known (delegate mode with an explicit --model, or recorded agent_models). Auto/unknown models never become evidence."""
    rows, sources, unknown = {}, [], 0
    for path in sorted(paths):
        doc = load(path)
        if not isinstance(doc, dict) or not isinstance(doc.get("runs"), list):
            continue
        used = False
        for r in doc["runs"]:
            if not isinstance(r, dict) or "copilot_credits" not in r or r.get("env_error"):
                continue
            agent = r.get("specialist")
            if not agent and tasks_dir:
                t = load(os.path.join(tasks_dir, str(r.get("task")), "task.json"), {})
                agent = t.get("agent") if t.get("mode", "delegate") == "delegate" else None
            models = r.get("agent_models") if isinstance(r.get("agent_models"), dict) else {}
            if not agent and r.get("mode") == "orchestrator" and len(r.get("agents") or []) == 1 and r["agents"][0] in models:
                agent = r["agents"][0]             # one specialist subagent, graded through its own answer
            model = models.get(agent) or models.get("main") if agent else None
            if not model and agent and doc.get("model") not in (None, "", "auto"):
                model = doc["model"]
            if not agent or not model:
                unknown += 1
                continue
            wl = (requirements_map or {}).get(agent, {}).get("workloadProfile")
            if not wl:
                continue
            k = (wl, model)
            s = rows.setdefault(k, {"workload": wl, "observedModel": model, "sampleCount": 0, "passes": 0,
                                    "credits": [], "source": "historical-eval"})
            s["sampleCount"] += 1
            s["passes"] += 1 if r.get("pass") else 0
            if isinstance(r.get("copilot_credits"), (int, float)):
                s["credits"].append(r["copilot_credits"])
            used = True
        if used:
            sources.append(os.path.basename(path))
    out = []
    for k in sorted(rows):
        s = rows[k]
        out.append({"workload": s["workload"], "observedModel": s["observedModel"], "sampleCount": s["sampleCount"],
                    "passRate": round(s["passes"] / s["sampleCount"], 3), "source": s["source"],
                    "avgCredits": round(sum(s["credits"]) / len(s["credits"]), 2) if s["credits"] else None})
    return out, sources, unknown


# --- task profile ----------------------------------------------------------------------------------------------------
ROUTING_LINE = re.compile(r"(?im)^\s*ROUTING:\s*(.+)$")


def task_profile(prompt):
    """risk / complexity of THIS subtask from the packet, deterministically (no model call). S/M/L is not used here."""
    prompt = prompt or ""
    prof = {"risk": "normal", "complexity": "normal", "riskSignals": []}
    m = ROUTING_LINE.search(prompt)
    if m:
        for k, v in re.findall(r"(risk|complexity)\s*=\s*([a-z-]+)", m.group(1).lower()):
            prof[k] = v
    try:
        sys.path.insert(0, HERE)
        from loop_tier import DEFAULTS
        for name, (tier, rx) in DEFAULTS["plan_keywords"].items():
            if tier == "L" and re.search(rx, prompt):
                prof["riskSignals"].append(name)
    except Exception:
        pass
    if prof["riskSignals"] and prof["risk"] == "normal":
        prof["risk"] = "high"
    return prof


# --- resolver --------------------------------------------------------------------------------------------------------
def step(order, value, delta):
    i = order.index(value) if value in order else 0
    return order[max(0, min(len(order) - 1, i + delta))]


def at_least(order, value, floor):
    return value if order.index(value) >= order.index(floor) else floor


def requested(req, prof, policy):
    qo, ro = policy["qualityOrder"], policy["reasoningOrder"]
    floor, reasoning = req.get("qualityFloor", "high"), req.get("baseReasoning", "medium")
    esc = policy["escalation"]
    if req.get("falseNegativeCost") == "very-high":
        floor = at_least(qo, floor, esc["falseNegativeVeryHigh"]["floorAtLeast"])
    if prof["risk"] == "high":
        floor, reasoning = step(qo, floor, esc["riskHigh"]["floor"]), step(ro, reasoning, esc["riskHigh"]["reasoning"])
    elif prof["risk"] == "elevated":
        floor = at_least(qo, floor, esc["riskElevated"]["floorAtLeast"])
    c = prof["complexity"]
    if c == "critical":
        floor, reasoning = step(qo, floor, esc["complexityCritical"]["floor"]), step(ro, reasoning, esc["complexityCritical"]["reasoning"])
    elif c == "complex":
        reasoning = step(ro, reasoning, esc["complexityComplex"]["reasoning"])
    elif c == "routine":
        reasoning = step(ro, reasoning, esc["complexityRoutine"]["reasoning"])
    return floor, reasoning


def family(model):
    """('vendor-pro', (5, 5)) for 'vendor-pro-5.5': the id without its numeric tokens, and the version from them."""
    toks = str(model).split("-")
    nums = [t for t in toks if re.fullmatch(r"\d+(?:\.\d+)*", t)]
    return "-".join(t for t in toks if t not in nums), tuple(int(x) for n in nums for x in n.split("."))


def evidence_level(model, workload, profiles, ev, policy, transfer=True):
    """(level, verified_fail, source) of a model for a workload: exact workload > same evidence class > any workload; a
    model without any evidence of its own inherits the best POSITIVE evidence of an OLDER version of the same family
    (owner decision 2026-10-12: a newer family version gets provisional trust, confidence low). Own evidence always wins."""
    lvl, failed = _own_level(model, workload, profiles, ev, policy)
    if lvl or failed or not transfer:
        return lvl, failed, ("own" if lvl else "none")
    fam, ver = family(model)
    older = {m for (_, m) in ev if m != model and family(m)[0] == fam and family(m)[1] < ver}
    best = max([_own_level(m, workload, profiles, ev, policy)[0] for m in older] or [0])
    return best, False, ("family" if best else "none")


def _own_level(model, workload, profiles, ev, policy):
    """(level, verified_fail) from the model's own evidence only."""
    e = policy["evidence"]
    ok = lambda s: s[0] >= e["minSamples"] and s[1] / s[0] >= e["minPassRate"]
    bad = lambda s: s[0] >= e["minSamples"] and s[1] / s[0] < e["minPassRate"]
    cls = profiles.get(workload, {}).get("evidenceClass")
    same_cls = [w for w, p in profiles.items() if p.get("evidenceClass") == cls]
    mine = {w: s for (w, m), s in ev.items() if m == model}
    if workload in mine and bad(mine[workload]):
        return 0, True
    if workload in mine and ok(mine[workload]):
        return e["levels"]["exact"], False
    cls_stats = [mine[w] for w in same_cls if w in mine]
    if cls_stats:
        tot = [sum(s[0] for s in cls_stats), sum(s[1] for s in cls_stats)]
        if bad(tot):
            return 0, True
        if ok(tot):
            return e["levels"]["class"], False
    if any(ok(s) for s in mine.values()):
        return e["levels"]["general"], False
    return 0, False


def rank(req, floor, models, profiles, ev, policy):
    wl = req.get("workloadProfile")
    need = policy["floorMinEvidence"].get(floor, 2)
    cands = []
    for m in models:
        lvl, failed, src = evidence_level(m["id"], wl, profiles, ev, policy)
        if failed:
            continue                                   # hard filter: a verified failure for this workload class
        known = m.get("creditsPerCall") is not None and m.get("calls", 0) >= policy["cost"]["minCallsForKnown"]
        cost = m["creditsPerCall"] if known else None
        cands.append({"model": m["id"], "level": lvl, "cost": cost, "evidenceSource": src,
                      "costEvidence": "known" if known else ("partial" if m.get("multiplier") is not None else "unknown")})
    eligible = [c for c in cands if c["level"] >= need]
    confidence, reason = None, None
    if not eligible and need > 0:
        eligible = [c for c in cands if c["level"] >= 1]
        confidence, reason = "low", "floor-unproven-best-evidence"
    mode = policy["cost"]["ranking"].get(req.get("costSensitivity", "medium"), "evidence-first")
    unk = lambda c: (c["cost"] is None, c["cost"] if c["cost"] is not None else 0)
    if mode == "cost-first":
        key = lambda c: (-min(c["level"], need) if need else 0, *unk(c), -c["level"])
    elif mode == "evidence-capped-then-cost":
        key = lambda c: (-min(c["level"], 2), *unk(c))
    else:
        key = lambda c: (-c["level"], *unk(c))
    eligible.sort(key=key)
    # a newer version of the same family goes right before an older one it is at least as good as (by evidence), so a new
    # model is actually used, not parked as an unused fallback because its cost is not known yet
    i = 0
    while i < len(eligible):
        fam, ver = family(eligible[i]["model"])
        j = next((k for k in range(i + 1, len(eligible)) if family(eligible[k]["model"])[0] == fam
                  and family(eligible[k]["model"])[1] > ver and eligible[k]["level"] >= eligible[i]["level"]), None)
        if j is None:
            i += 1
        else:
            eligible.insert(i, eligible.pop(j))
    return eligible, confidence, reason


def resolve(root, agent, prompt="", host_hint=None, state=None):
    """Ranked (model, effort) configurations: primary + up to N fallbacks + final inheritance."""
    st = state or context(root, host_hint)
    req = st["requirements"].get(agent)
    if not req and re.match(r"^[A-Za-z0-9_.-]+$", agent or "") and os.path.isfile(os.path.join(root, ".github", "agents", agent + ".agent.md")):
        discover(root)                       # a user-added agent used before any `resolve`: derive its profile now (no model call)
        st["requirements"] = requirements(root)
        req = st["requirements"].get(agent)
    base = {"agent": agent, "host": st["host"], "providerState": st["inventory"]["providerState"], "finalFallback": {"strategy": "inherit"}}
    if not req:
        return dict(base, routing="DEGRADED", reasonCode="no-requirements-profile", primary=None, fallbacks=[])
    prof = task_profile(prompt)
    floor, reasoning = requested(req, prof, st["policy"])
    base.update(workloadProfile=req.get("workloadProfile"), task=prof, qualityFloor=floor, requestedReasoning=reasoning)
    if st["inventory"]["providerState"] != "READY":
        return dict(base, routing="DEGRADED", reasonCode="provider-not-ready", primary=None, fallbacks=[])
    ranked, conf, reason = rank(req, floor, st["inventory"]["models"], st["profiles"], st["evidence"], st["policy"])
    if not ranked:
        return dict(base, routing="DEGRADED", reasonCode="no-candidate-meets-requirements", primary=None, fallbacks=[])
    effort = lambda m: {"requested": reasoning, "applied": False, "note": "host has no per-dispatch effort: model-managed"}
    cfg = lambda c, rc: {"strategy": "fixed", "model": c["model"], "reasoningEffort": effort(c["model"]),
                         "costEvidence": c["costEvidence"], "creditsPerCall": c["cost"], "evidenceLevel": c["level"],
                         "evidenceSource": c["evidenceSource"], "reasonCode": rc}
    lv = ranked[0]["level"]
    confidence = conf or ("low" if ranked[0]["evidenceSource"] == "family" else "high" if lv >= 3 else "medium" if lv == 2 else "low")
    if ranked[0]["evidenceSource"] == "family" and not reason:
        reason = "family-transfer-newer-version"
    primary_rc = reason or ("quality-floor-met-" + ("min-cost" if st["policy"]["cost"]["ranking"].get(req.get("costSensitivity")) == "cost-first" else "best-evidence"))
    return dict(base, routing="ACTIVE", confidence=confidence, primary=cfg(ranked[0], primary_rc),
                fallbacks=[cfg(c, "next-compatible") for c in ranked[1:1 + st["policy"]["fallbacks"]]],
                resolutionSource="factory+local-evidence+host-usage-records")


def context(root, host_hint=None):
    policy = load(os.path.join(static_dir(root), "scoring-policy.json"), {})
    profiles = load(os.path.join(static_dir(root), "workload-profiles.json"), {}).get("profiles", {})
    host = detect_host(host_hint)
    return {"host": host, "policy": policy, "profiles": profiles, "requirements": requirements(root),
            "evidence": evidence(root), "inventory": inventory(root, host, policy)}


# --- user-added agents (deterministic, no model call) ----------------------------------------------------------------
RULES = [("security-review", r"(?i)secur|appsec|threat|vulnerab|pentest"), ("independent-code-review", r"(?i)review"),
         ("test-engineering", r"(?i)\btest|qa\b|quality assurance"), ("writing", r"(?i)\bdoc|writer|technical writ"),
         ("deep-architecture", r"(?i)architect"), ("technical-planning", r"(?i)\bplan|lead\b|breakdown"),
         ("external-research", r"(?i)research"), ("incident-reliability", r"(?i)incident|reliab|observab|sre\b"),
         ("routine-coding", r"(?i)implement|developer|engineer|coding")]


def frontmatter(path):
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read(4000)
    except OSError:
        return {}
    m = re.match(r"---\s*\n(.*?)\n---", text, re.S)
    fm = {}
    for line in (m.group(1).splitlines() if m else []):
        k, _, v = line.partition(":")
        fm[k.strip()] = v.strip().strip("'\"")
    return fm


def discover(root):
    """User-added Copilot agents -> abstract requirements in local-agent-requirements.json (never a model)."""
    factory = load(os.path.join(static_dir(root), "agent-requirements.json"), {}).get("agents", {})
    profiles = load(os.path.join(static_dir(root), "workload-profiles.json"), {}).get("profiles", {})
    path = os.path.join(local_dir(root), "local-agent-requirements.json")
    local = load(path, {}) or {}
    found, warnings = [], []
    for f in sorted(glob.glob(os.path.join(root, ".github", "agents", "*.agent.md"))):
        agent = os.path.basename(f)[:-len(".agent.md")]
        if agent in factory or agent == COORDINATOR:
            continue
        fm = frontmatter(f)
        if re.search(r"(?i)\bagent\b|runSubagent|\btask\b", fm.get("tools", "")):
            warnings.append(f"{agent}: has a delegation tool; fleet specialists must be leaf agents (one-level delegation)")
        if local.get(agent, {}).get("profileSource") == "manual":
            continue
        text = f"{agent} {fm.get('description', '')}"
        wl = next((w for w, rx in RULES if re.search(rx, text)), None)
        conf = "medium" if wl else "low"
        wl = wl or "complex-engineering"           # conservative generic: a high quality floor
        d = profiles.get(wl, {}).get("defaults", {})
        local[agent] = dict(d, workloadProfile=wl, profileSource="derived", confidence=conf)
        found.append(agent)
    if found:
        save(path, local)
    return found, warnings


# --- commands --------------------------------------------------------------------------------------------------------
def refresh(root, host_hint=None):
    """RESOLVE: inventory + per-agent resolution (no task text) -> resolved-profiles/status cache. No model call."""
    found, warnings = discover(root)
    st = context(root, host_hint)
    agents = {a: resolve(root, a, "", host_hint, st) for a in sorted(st["requirements"])}
    active = [a for a, r in agents.items() if r.get("routing") == "ACTIVE"]
    status = {"generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "host": st["host"],
              "provider": st["inventory"].get("provider"), "providerState": st["inventory"]["providerState"],
              "routing": "DISABLED" if disabled(root) else ("ACTIVE" if active else "DEGRADED"),
              "inventoryHash": st["inventory"].get("inventoryHash"), "models": [m["id"] for m in st["inventory"]["models"]],
              "factoryBaseline": load(os.path.join(static_dir(root), "factory-baseline.json"), {}).get("version"),
              "calibration": "available" if os.path.exists(os.path.join(local_dir(root), "calibration.local.json")) else "none",
              "hashes": {"requirements": digest(st["requirements"]), "policy": digest(st["policy"]), "profiles": digest(st["profiles"])},
              "userAgents": found, "warnings": warnings, "agents": agents}
    try:
        save(os.path.join(local_dir(root), "resolved-profiles.local.json"), status)
    except OSError:
        pass
    return status


def route(root, agent, prompt, host_hint=None):
    """One decision for a task call; never raises (any error -> None = inherit)."""
    try:
        if disabled(root):
            return None
        r = resolve(root, agent, prompt, host_hint)
        log = os.path.join(local_dir(root), "decisions.local.jsonl")
        os.makedirs(os.path.dirname(log), exist_ok=True)
        with open(log, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps({"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "agent": agent,
                                 "routing": r.get("routing"), "model": (r.get("primary") or {}).get("model"),
                                 "confidence": r.get("confidence"), "floor": r.get("qualityFloor"),
                                 "risk": (r.get("task") or {}).get("risk"), "reason": (r.get("primary") or {}).get("reasonCode") or r.get("reasonCode")}) + "\n")
        return r
    except Exception:
        return None


def usage_for_agent(agent_id):
    """Actual model / credits / tokens / effort of one Copilot subagent run (usage records), or None."""
    db = os.path.join(copilot_home(), "session-store.db")
    if not agent_id or not os.path.isfile(db):
        return None
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        row = con.execute("select group_concat(distinct model), sum(total_nano_aiu), sum(input_tokens)+sum(output_tokens), "
                          "group_concat(distinct reasoning_effort) from assistant_usage_events where agent_id = ?", (agent_id,)).fetchone()
        con.close()
    except sqlite3.Error:
        return None
    if not row or row[0] is None:
        return None
    return {"model": row[0], "credits": round((row[1] or 0) / 1e9, 2), "tokens": row[2], "effort": row[3]}


def main():
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    a = sys.argv[1:] or ["status"]
    if a[0] == "reset":
        for f in glob.glob(os.path.join(local_dir(root), "*.local.json*")):
            os.remove(f)
        print("model routing: local cache cleared (requirements, policy, agents and local-agent-requirements.json kept)")
    elif a[0] in ("resolve", "status"):
        # run by hand or by the configure-copilot-models skill: the CLI's usage records are this machine's provider
        s = refresh(root, "copilot-cli" if os.path.isfile(os.path.join(copilot_home(), "session-store.db")) else None)
        print(f"Host: {s['host']} | Provider: {s['provider']} ({s['providerState']}) | Adaptive routing: {s['routing']}")
        print(f"Inventory: {len(s['models'])} model(s) {', '.join(s['models'])} | factory baseline v{s['factoryBaseline']} | calibration: {s['calibration']}")
        for w in s["warnings"]:
            print("WARN:", w)
        for ag, r in s["agents"].items():
            p = r.get("primary") or {}
            fb = ", ".join(f["model"] for f in r.get("fallbacks", []))
            print(f"  {ag:24} {r.get('workloadProfile') or '-':28} {r.get('routing'):8} -> {p.get('model') or 'inherit'}"
                  + (f" | fallbacks: {fb}" if fb else "") + f" | inherit | confidence: {r.get('confidence') or '-'}")
    elif a[0] == "route" and len(a) >= 2:
        prompt = a[a.index("--prompt") + 1] if "--prompt" in a else ""
        print(json.dumps(resolve(root, a[1], prompt, "copilot-cli"), ensure_ascii=False, indent=2))
    elif a[0] == "import-calibration":
        ev, sources, unknown = evidence_from_results(a[1:], None, requirements(root))
        save(os.path.join(local_dir(root), "calibration.local.json"), {"version": 1, "sources": sources, "modelEvidence": ev})
        print(f"calibration: {len(ev)} evidence row(s) from {len(sources)} file(s); {unknown} run(s) without a known model skipped")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
