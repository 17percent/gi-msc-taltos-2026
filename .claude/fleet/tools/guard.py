#!/usr/bin/env python3
"""PreToolUse hook: deterministic guardrails for FLEET agents (project-level). The main session and non-fleet agents get
rule 3 (database writes) only: it is an absolute owner rule; push there is covered by the installer's permissions.ask.
The main session (fleet `auto` mode) also gets a one-time, non-blocking workflow reminder on its first code edit before
loop_tier.py ran (see workflow_reminder).

Turns four rules of the fleet runtime contract into enforcement instead of prompt text:
  1. external / irreversible  - no git push, history destruction, publishing, deploys, cloud mutations, sudo,
                                pipe-to-shell, rm -rf outside the project. The orchestrator does these after approval.
  2. secrets                  - no reading .env / private keys / credential files, no environment dumps.
  3. database writes          - fleet agents are read-only on databases: no write SQL through sqlcmd/psql/Invoke-Sqlcmd,
                                no `dotnet ef database update`, `sqlpackage` publish, `bcp in`. Scripts may be written as
                                proposals, never executed. (Cannot see writes done by code a test run executes.)
  4. read-only roles          - agents defined without Edit/Write (reviewers, gates) cannot write via Bash either
                                (redirection, tee, sed -i, rm/mv/cp, git add/commit/..., package installs);
                                writing under a temp dir stays allowed.
Heuristic and best effort: a guardrail against mistakes and prompt-injected instructions, not a sandbox.
Fails open (exit 0, no output) on any internal error so it can never break a session. Stdlib only.
Hook input: tool_name, tool_input, agent_type (present only inside a subagent; measured on Claude Code 2.1).
"""
import json
import os
import re
import shlex
import sys
import tempfile

TEMP_PREFIXES = ("/tmp/", "/var/tmp/", "/dev/null", "$TMPDIR", "${TMPDIR")

W = r"[^\s|;&]+\s+"   # one shell word + space, never crossing a pipe/separator
G = r"\bgit\s+(?:(?:-C|-c|--git-dir|--work-tree|--namespace)\s+\S+\s+|-\S+\s+)*"   # git + global options
EXTERNAL = [
    (G + r"push\b", "git push (publishing to a remote is the orchestrator's step, after approval)"),
    (G + r"reset\s+(?:" + W + r")*--hard\b", "git reset --hard (discards work)"),
    (G + r"clean\s+(?:" + W + r")*-\w*f", "git clean -f (deletes untracked files)"),
    (G + r"branch\s+(?:" + W + r")*-D\b", "git branch -D"),
    (G + r"(?:filter-branch|filter-repo)\b", "history rewrite"),
    (r"\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bdotnet\s+nuget\s+push\b", "package publish"),
    (r"\bdocker\s+(?:image\s+)?push\b", "docker push"),
    (r"\bgh\s+(?:release\s+(?:create|delete|upload|edit)|pr\s+merge|repo\s+(?:delete|create|edit)|secret\s+set|workflow\s+run)\b", "GitHub mutation via gh"),
    (r"\bkubectl\s+(?:apply|create|delete|replace|patch|scale|rollout|drain|cordon|edit|set)\b", "cluster mutation (kubectl)"),
    (r"\bhelm\s+(?:install|upgrade|uninstall|delete|rollback)\b", "cluster mutation (helm)"),
    (r"\bterraform\s+(?:apply|destroy|import)\b|\btofu\s+(?:apply|destroy)\b|\bpulumi\s+(?:up|destroy)\b", "infrastructure apply/destroy"),
    (r"\b(?:az|aws|gcloud)\s+(?:" + W + r")*?(?:delete|purge|create|update|deploy|apply|put|set|start|stop|restart)\b", "cloud resource mutation (az/aws/gcloud)"),
    (r"\bsudo\b", "sudo"),
    (r"\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b", "pipe-to-shell install"),
    (r"\bmkfs(?:\.\w+)?\b|\bdd\s+[^;|&]*\bof=/dev/", "disk-level write"),
    (r"(?i)\bdrop\s+(?:database|schema)\b", "DROP DATABASE/SCHEMA"),
    (r":\(\)\s*\{\s*:\|:&\s*\}\s*;", "fork bomb"),
]

_SECRET_COMMON = (r"\.env(?:\.(?!example\b|sample\b|template\b|dist\b|defaults\b)[\w.-]+)?"
                  r"|id_(?:rsa|ed25519|ecdsa|dsa)(?!\.pub)\b[\w.-]*"
                  r"|[\w.-]+\.(?:pem|p12|pfx|kdbx|jks|keystore)"
                  r"|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.aws[/\\]credentials|\.docker[/\\]config\.json|\.kube[/\\]config")
_DELIM_L, _DELIM_R = r"(?:^|[\s'\"=/\\<>:(])(", r")(?=$|[\s'\";|&)<>])"   # '\\' too: Windows paths
# file paths of Read/Grep/Edit/...: any *.key file counts too
SECRET_PATH = re.compile(_DELIM_L + _SECRET_COMMON + r"|[\w.-]+\.key" + _DELIM_R)
# Bash text: '*.key' only with a key-like stem, so code such as `grep "item.key"` is not blocked
SECRET_CMD = re.compile(_DELIM_L + _SECRET_COMMON + r"|(?:private|server|client|tls|ssl|signing|secret)[\w-]*\.key" + _DELIM_R)
ENV_DUMP = re.compile(r"(?:^|[;&|(]\s*)(?:printenv\b|env\s*(?:$|[|;&>)])|set\s*(?:$|\|)|export\s+-p\b|declare\s+-x\b)"
                      r"|(?i:\b(?:Get-ChildItem|gci|dir|ls|Get-Item)\s+env:(?:\s|$|\\?\*|[|;)'\"]))")   # PowerShell env: drive
# database clients / deploy tools; write SQL is only inspected when one of them is in the command (so `grep "INSERT INTO" src` is fine)
DB_CLIENT = re.compile(r"(?i)\b(?:sqlcmd|osql|mssql-cli|usql|Invoke-Sqlcmd|Invoke-DbaQuery|psql|mysql|mariadb|sqlite3|sqlplus)(?:\.exe)?\b")
DB_WRITE_SQL = re.compile(
    r"(?i)\b(?:insert\s+into|delete\s+from|truncate\s+table|merge\s+(?:into\s+)?[\w#\[\]\".]+\s+(?:as\s+\w+\s+)?using|"
    r"update\s+(?:statistics\b|[\w#\[\]\".]+\s+set\b)|(?:create|alter|drop)\s+(?:or\s+alter\s+)?\w+|"
    r"grant\b|revoke\b|backup\s+(?:database|log)|restore\s+(?:database|log)|xp_cmdshell|identity_insert|"
    r"select\b[^;]*?\binto\s+[#@\[\w]|exec(?:ute)?\s+(?!sp_help|sp_columns|sp_spaceused|sp_who|sp_estimate_data_compression_savings|sp_describe_))")
DB_SCRIPT_FILE = re.compile(r"(?i)\b(?:sqlcmd|osql)(?:\.exe)?\b[^|;&]*\s-i\b|\bInvoke-Sqlcmd\b[^|;&]*-InputFile\b|\bpsql\b[^|;&]*\s(?:-f|--file)\b")
DB_PIPED_SCRIPT = re.compile(r"(?i)(?:\b(?:cat|type|Get-Content|gc)\s+[^|;&]*\.sql\b[^;&]*\||<\s*[^\s|;&<>]+\.sql\b)")   # script fed via pipe/redirect
DB_TOOLS = [
    (r"(?i)\bdotnet\s+ef\s+database\s+(?:update|drop)\b|\b(?:Update|Drop)-Database\b", "database update/drop (migration run)"),
    (r"(?i)\bsqlpackage(?:\.exe)?\b[^|;&]*(?:/|--?)(?:a|action)[:=\s]+(?:publish|import)\b", "sqlpackage publish/import"),
    (r"(?i)\bbcp\b[^|;&]*\s+in\s", "bcp import"),
    (r"(?i)\bprisma\s+(?:migrate\s+(?:deploy|dev|reset)|db\s+(?:push|execute))\b|\bpg_restore\b", "database migration/restore run"),
]
SECRET_PATH_TOOLS = ("Read", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit")

WRITE_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
GIT_WRITE = {"add", "commit", "apply", "am", "stash", "checkout", "switch", "restore", "reset", "merge", "rebase",
             "cherry-pick", "revert", "tag", "mv", "rm", "init", "clone", "pull", "worktree"}
PKG_WRITE = {("npm", "install"), ("npm", "i"), ("npm", "ci"), ("npm", "uninstall"), ("npm", "update"), ("npm", "link"),
             ("pnpm", "install"), ("pnpm", "add"), ("pnpm", "remove"), ("yarn", "add"), ("yarn", "install"),
             ("yarn", "remove"), ("pip", "install"), ("pip3", "install"), ("pip", "uninstall"), ("uv", "add"),
             ("uv", "pip"), ("poetry", "add"), ("dotnet", "add"), ("cargo", "add"), ("go", "get")}
FILE_WRITERS = {"rm", "rmdir", "mv", "touch", "mkdir", "truncate", "chmod", "chown", "unlink", "shred"}  # every arg is written
# PowerShell cmdlets that write files. Copilot on Windows (and Claude Code's PowerShell tool) runs them directly, without a
# `powershell -Command` wrapper (measured 2026-10-13: a read-only appsec wrote via `Set-Content`), so the full names count
# everywhere; the short aliases (sc, ac, del, copy ...) only next to an explicit powershell/pwsh call.
PS_WRITE = re.compile(r"(?i)(?<![\w-])(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|"
                      r"Clear-Content|Set-ItemProperty|Expand-Archive|Compress-Archive|Export-Csv|Export-Clixml)\b"
                      r"|\[(?:System\.)?IO\.(?:File|Directory)\]::\s*(?:Write|Append|Create|Delete|Copy|Move|Replace)")
PS_ALIAS_WRITE = re.compile(r"(?i)\b(?:ni|ri|del|erase|rd|rmdir|mi|move|cpi|copy|ren|sc|ac)\b(?=\s)")
COPIERS = {"cp", "ln", "install", "rsync"}                                                             # only the last arg is


AGENT_TAIL = ("Do not try to work around it; if this step is really needed, finish with STATUS BLOCKED or PARTIAL and "
              "put the exact step under NEXT ACTION for the orchestrator.")
MAIN_TAIL = ("Owner rule: nobody writes to a database, the orchestrator included. Do not work around it; give the owner the "
             "statement/script as a proposal (benefit, cost, risk, rollback) and let the owner run it.")


FORMAT = "claude"   # "copilot" when the payload is GitHub Copilot's (toolName/toolArgs); the answer must use its shape

# GitHub Copilot hooks (CLI `.github/hooks/*.json`, also read by VS Code): payload {sessionId, cwd, toolName, toolArgs},
# measured 2026-10-08 (CLI 1.0.9x on Windows: toolName "powershell" / "view" ...). VS Code's own tool names are mapped too
# (UNVERIFIED there: no headless VS Code run). Everything is normalised to the Claude Code names the rules below use.
COPILOT_TOOLS = {"bash": "Bash", "powershell": "Bash", "shell": "Bash", "run_in_terminal": "Bash",
                 "view": "Read", "read_file": "Read", "grep": "Grep", "grep_search": "Grep", "file_search": "Glob", "glob": "Glob",
                 "create": "Write", "create_file": "Write", "edit": "Edit", "str_replace": "Edit", "str_replace_editor": "Edit",
                 "apply_patch": "Edit", "replace_string_in_file": "Edit", "insert_edit_into_file": "Edit", "task": "Agent"}


COORDINATOR = "fleet-orchestrator"   # the Copilot coordinator agent is the orchestrator, not a specialist
# Copilot built-in agents that have a fleet specialist with the fleet's rules (measured 2026-10-08: the coordinator picked
# the built-in `security-review` twice, even when told not to). explore / general-purpose stay allowed (ephemeral work).
BUILTIN_TO_FLEET = {"security-review": "appsec", "code-review": "code-reviewer"}
PUSH = re.compile(G + r"push\b|\bgh\s+pr\s+merge\b")


# --- Copilot subagent identity ----------------------------------------------------------------------------------------
# Copilot's preToolUse payload carries no agent name; a subagent's calls come with their OWN sessionId (measured). The
# subagentStart event names the agent but not that id, subagentStop names both. So: the session that launches a subagent
# (`task` call) is a main session; after a subagentStart the next unknown sessionId is bound to the oldest pending agent;
# subagentStop unbinds it. ponytail: file-based, unlocked; two subagents started in the same instant may swap names
# (then both still get the specialist rules), and a start older than 1 h is dropped.
def copilot_state_path(root):
    import hashlib
    d = os.path.join(tempfile.gettempdir(), "agentic-fleet-session")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, hashlib.sha1(os.path.normcase(os.path.realpath(root)).encode()).hexdigest()[:10] + "-copilot.json")


def copilot_state(root, update=None):
    import time
    path = copilot_state_path(root)
    try:
        with open(path, encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        st = {}
    st.setdefault("pending", []); st.setdefault("bound", {}); st.setdefault("mains", [])
    st["pending"] = [x for x in st["pending"] if time.time() - x.get("ts", 0) < 3600]
    if update:
        update(st)
        st["mains"] = st["mains"][-50:]
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(st, fh)
        os.replace(tmp, path)
    return st


def copilot_subagent_event(raw):
    """subagentStart {agentName} -> pending; subagentStop {agentId, agentName} -> unbind."""
    import time
    root = os.environ.get("CLAUDE_PROJECT_DIR") or raw.get("cwd") or os.getcwd()
    agent, sid = raw.get("agentName"), raw.get("agentId")

    def upd(st):
        if sid:                                                    # stop
            st["bound"].pop(sid, None)
            for i, x in enumerate(st["pending"]):
                if x["agent"] == agent:
                    del st["pending"][i]
                    break
        else:                                                      # start
            st["pending"].append({"agent": agent, "ts": time.time()})
    copilot_state(root, upd)


def copilot_agent_for(root, sid, tool):
    """The fleet agent behind a Copilot tool call (None = a main session)."""
    if not sid:
        return None
    found = {}

    def upd(st):
        if sid in st["bound"]:
            found["a"] = st["bound"][sid]
        elif not st["pending"] or sid in st["mains"] or tool == "task":
            if sid not in st["mains"]:
                st["mains"].append(sid)
        else:
            found["a"] = st["bound"][sid] = st["pending"].pop(0)["agent"]
    copilot_state(root, upd)
    return found.get("a")


PATCH_FILE = re.compile(r"^\*\*\* (?:Update|Add|Delete) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$", re.M)


def patch_paths(text):
    """Files named in an apply_patch text (`*** Begin Patch` / `*** Update File: <path>` ...)."""
    return [a or b for a, b in PATCH_FILE.findall(text or "")]


def normalize(data):
    """Copilot payload -> the Claude Code shape (tool_name, tool_input with file_path, agent_type, session_id)."""
    global FORMAT
    if "tool_name" in data or "toolName" not in data:
        if data.get("tool_name") == "PowerShell":           # Claude Code's PowerShell tool (Windows): the same shell rules
            data["tool_name"], data["powershell"] = "Bash", True
        return data
    FORMAT = "copilot"
    args = data.get("toolArgs") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {"patch": args} if "*** Begin Patch" in args else {"command": args}
    if not isinstance(args, dict):
        args = {"command": str(args)}
    ti = dict(args)
    files = patch_paths(ti.get("patch") or ti.get("input") or "")     # apply_patch: raw text (CLI) or {"input": ...} (VS Code)
    if files and "file_path" not in ti:
        ti["file_paths"] = files
        ti["file_path"] = next((f for f in files if f.lower().endswith(CODE_EXT)), files[0])   # code first: the workflow gate
    if "path" in ti and "file_path" not in ti:
        ti["file_path"] = ti["path"]
    out = {"tool_name": COPILOT_TOOLS.get(str(data.get("toolName")).lower(), data.get("toolName")), "tool_input": ti,
           "cwd": data.get("cwd"), "session_id": data.get("sessionId") or data.get("session_id")}
    agent = data.get("agentName") or data.get("agent_type") or data.get("agentType")
    if not agent:
        root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
        agent = copilot_agent_for(root, out["session_id"], str(data.get("toolName")).lower())
    if agent and agent != COORDINATOR:
        out["agent_type"] = agent
    return out


# --- the workflow checkpoint is changed only through flow_state.py ------------------------------------------------------
# Measured 2026-10-09 (Copilot CLI, auto model): to get past the review gate the main agent read flow_state.py, then
# (1) closed with `--force` on its own and (2) edited the checkpoint JSON directly (phase DONE). Both are owner decisions.
STATE_DIR = re.compile(r"(?i)\.claude[\\/]+fleet[\\/]+state(?:[\\/]|\b)")
NULL_REDIRECT = re.compile(r"(?i)\d?>>?\s*(?:/dev/null|\$null|nul)\b|\d>&\d")
STATE_WRITE = re.compile(r"(?i)\b(?:rm|del|erase|rmdir|rd|mv|move|ren|ri|Remove-Item|Set-Content|Add-Content|Out-File|Clear-Content|"
                         r"Move-Item|Rename-Item|Copy-Item|New-Item|tee|sed|truncate)\b|>|os\.remove|unlink|rmtree|\.write|json\.dump")
FORCE_CLOSE = re.compile(r"flow_state\.py\b[^;&|\n]*\bclose\b[^;&|\n]*--force\b")


def state_tamper(tool, ti):
    if tool in WRITE_TOOLS:
        paths = ti.get("file_paths") or [ti.get("file_path") or ti.get("notebook_path") or ""]
        return any(STATE_DIR.search(p or "") for p in paths)
    if tool == "Bash":
        cmd = NULL_REDIRECT.sub(" ", ti.get("command") or "")
        return bool(STATE_DIR.search(cmd) and STATE_WRITE.search(cmd))
    return False


def ask(reason):
    if FORMAT == "copilot":
        print(json.dumps({"permissionDecision": "ask", "permissionDecisionReason": reason}))
    else:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                                 "permissionDecisionReason": reason}}))
    sys.exit(0)


def deny(reason, tail=AGENT_TAIL):
    text = f"Blocked by the fleet guard: {reason}. {tail}"
    if FORMAT == "copilot":
        print(json.dumps({"permissionDecision": "deny", "permissionDecisionReason": text}))
    else:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                 "permissionDecisionReason": text}}))
    sys.exit(0)


# --- workflow reminder (main session, fleet in `auto` mode): NOT a block -------------------------------------------------
# The M3 evals showed the orchestrator editing code without the plan-time estimate and, on a bug, fixing before reproducing.
# On the first code edit of a session that has not run loop_tier.py yet, the model gets one short reminder
# (additionalContext, no permissionDecision: the normal permission flow is untouched). Copilot: the same reminder in its shape.
CODE_EXT = (".cs", ".cshtml", ".razor", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".sql", ".ts", ".tsx", ".js", ".jsx", ".py",
            ".ps1", ".psm1", ".sh", ".fs", ".vb", ".java", ".go", ".rs")
NUDGE = ("Fleet reminder (not a block): you are editing code before loop_tier.py ran in this session. Policy for code changes: "
         "estimate first (`python3 .claude/fleet/tools/loop_tier.py --planned <files> --planned-text \"<task>\"`, Windows: "
         "`python`) and state the tier and flow in one line; bug-fix: reproduce (red test or a run) BEFORE fixing; refactor: run "
         "the existing tests first; at the end re-classify the real diff and run the gate. Details: .claude/fleet/skills/feature-flow/SKILL.md")


def fleet_mode(root):
    try:
        with open(os.path.join(root, ".claude", "fleet", ".installed"), encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("mode "):
                    return line.split()[1]
    except OSError:
        pass
    return None


FLEET_SWITCH = re.compile(r"fleet_switch\.py\b(?:\s+(on|off)\b)?", re.I)


def fleet_active(root, session):
    """The fleet's workflow hooks run when the fleet is ON in this session: `auto` mode unless switched off, `on-demand`
    mode only after the owner switched it on (fleet_switch.py, which /agent-fleet and the policy run)."""
    if os.path.exists(session_marker(root, session, "fleet-off")):
        return False
    return os.path.exists(session_marker(root, session, "fleet-on")) or fleet_mode(root) == "auto"


def session_marker(root, session, kind):
    import hashlib
    d = os.path.join(tempfile.gettempdir(), "agentic-fleet-session")
    os.makedirs(d, exist_ok=True)
    key = hashlib.sha1(os.path.normcase(os.path.realpath(root)).encode()).hexdigest()[:10]
    return os.path.join(d, f"{key}-{re.sub(r'[^A-Za-z0-9_-]', '', session)[:64]}.{kind}")


def workflow_reminder(data, root, tool, ti):
    """Main session only, only while the fleet is ON in this session (fleet_active). Never blocks Claude Code."""
    session = data.get("session_id") or ""
    if not session:
        return
    m = FLEET_SWITCH.search(ti.get("command") or "") if tool == "Bash" else None
    if m:                                                 # the owner's /agent-fleet on|off (measured gap: on-demand + /agent-fleet)
        on = (m.group(1) or "on").lower() == "on"
        open(session_marker(root, session, "fleet-on" if on else "fleet-off"), "a").close()
        try:
            os.remove(session_marker(root, session, "fleet-off" if on else "fleet-on"))
        except OSError:
            pass
        return
    if not fleet_active(root, session):
        return
    if tool == "Bash":
        cmd = ti.get("command") or ""
        for script, kind in (("loop_tier.py", "tier"), ("flow_state.py", "flow")):
            if script in cmd:
                open(session_marker(root, session, kind), "a").close()
        return
    if tool == "Agent":                                   # the stop gate's "a review round ran" (fleet name, any case)
        name = str(ti.get("agent_type") or ti.get("agentType") or ti.get("subagent_type") or ti.get("name") or "")
        if re.match(r"^[A-Za-z0-9_.-]+$", name):
            open(session_marker(root, session, "seen-" + name.lower()), "a").close()
        return
    if tool not in WRITE_TOOLS:
        return                                            # reading code is not editing it (measured: a Copilot `view` was denied)
    path = (ti.get("file_path") or ti.get("notebook_path") or "").replace("\\", "/")
    if not path.lower().endswith(CODE_EXT) or "/.claude/" in path:
        return
    open(session_marker(root, session, "edited"), "a").close()
    if os.path.exists(session_marker(root, session, "tier")) or os.path.exists(session_marker(root, session, "nudged")):
        return
    open(session_marker(root, session, "nudged"), "a").close()      # once per session
    if FORMAT == "copilot":
        # the Copilot CLI ignores additionalContext on preToolUse (only permissionDecision/Reason/modifiedArgs reach the model):
        # the reminder is a ONE-TIME deny of the first code edit; the retry after the estimate goes through
        print(json.dumps({"permissionDecision": "deny", "permissionDecisionReason": "Fleet workflow (blocked once, retry "
                          "after the estimate): " + NUDGE.replace("Fleet reminder (not a block): ", "")}))
    else:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": NUDGE}}))
    sys.exit(0)


# --- orchestration without a coordinator agent (Copilot hooks: agentStop, subagentStart) ---------------------------------
# Measured 2026-10-08/09 on the Copilot CLI: policy text alone did not make the default agent resume from the checkpoint or
# run the M/L review round; a mechanical gate did. So the hooks carry the sequence, the policy stays short:
#  - stop: the main session may not finish code work that skipped loop_tier, M/L work without a fleet review round, or an
#    M/L checkpoint it worked on without closing it; a session that never looked at an open checkpoint is pointed to it
#    once (`decision: block` = the reason comes back as the next instruction);
#  - subagentStart: the specialist gets the checkpoint line (FLOW / PHASE / TASK-ID).
# The CLI (1.0.9, read in its source) honours only these outputs of command hooks: preToolUse permissionDecision/Reason,
# agentStop/subagentStop decision/reason, subagentStart additionalContext; a userPromptSubmitted result is discarded.
# `auto` fleet mode only (on-demand: the fleet may be OFF). Registered for Copilot only: Claude Code passes these evals on
# the policy text (2026-10-09); its `Stop` payload is handled too, one settings.json entry would enable it.
REVIEWERS = ("code-reviewer", "appsec", "qa-automation")
STOP_CAPS = {"tier": 1, "review": 2, "close": 1, "resume": 1}   # blocks per session and reason: a gate, never an endless loop
RANK = {"S": 0, "M": 1, "L": 2}


def estimate_path(root):
    """loop_tier.py writes its last estimate here (temp dir, never the repo); same key as session_marker."""
    return session_marker(root, "estimate", "json")


def open_checkpoints(root, max_age_h):
    d = os.path.join(root, ".claude", "fleet", "state")
    out = []
    if os.path.isdir(d):
        import time
        for f in os.listdir(d):
            p = os.path.join(d, f)
            if f.endswith(".json") and time.time() - os.path.getmtime(p) < max_age_h * 3600:
                try:
                    with open(p, encoding="utf-8") as fh:
                        st = json.load(fh)
                    if isinstance(st, dict) and "id" in st:
                        out.append((os.path.getmtime(p), st))
                except (OSError, ValueError):
                    pass
    return [st for _, st in sorted(out, key=lambda x: x[0], reverse=True)]


def stop_gate(raw, root):
    sid = raw.get("sessionId") or raw.get("session_id") or ""
    if not sid or not fleet_active(root, sid):
        return
    if "sessionId" in raw and sid not in copilot_state(root)["mains"]:
        return                         # Copilot fires agentStop for subagent sessions too (measured): only the main agent
    has = lambda k: os.path.exists(session_marker(root, sid, k))
    edited, flow = has("edited"), has("flow")
    if not edited and not flow:
        old = open_checkpoints(root, 24 * 14)
        if not old or has("stop-resume-0"):
            return                                            # no code work in this session (or a subagent's session)
        open(session_marker(root, sid, "stop-resume-0"), "a").close()
        c = old[0]
        print(json.dumps({"decision": "block", "reason": (
            f"Fleet: an open workflow checkpoint exists: {c['id']} (flow {c.get('flow')}, tier {c.get('tier')}, phase "
            f"{c.get('phase')}, updated {c.get('updated')}). If the owner's request continues it, resume it now: `python3 "
            f".claude/fleet/tools/flow_state.py show {c['id']}` (Windows: `python`), then continue at its phase. Otherwise "
            "ignore this and finish.")}))
        return
    tier = "S"
    if has("tier"):
        try:
            with open(estimate_path(root), encoding="utf-8") as fh:
                tier = json.load(fh).get("tier", "S")
        except (OSError, ValueError):
            pass
    cp = (open_checkpoints(root, 24) or [None])[0] if flow else None
    if cp and RANK.get(cp.get("tier"), 0) > RANK.get(tier, 0):
        tier = cp["tier"]
    reviewed = any(has("seen-" + r) for r in REVIEWERS) or bool(cp and set(REVIEWERS) & set(cp.get("agents_seen") or []))
    py = "`python3` (Windows: `python`)"
    if edited and not has("tier"):
        key, why = "tier", (f"Fleet: you changed code in this session but loop_tier.py has not run. Re-classify the real diff "
                            f"({py} .claude/fleet/tools/loop_tier.py), run the gate (build/tests), state the tier in one line, "
                            "then continue per the tier (M/L: an independent review round).")
    elif RANK.get(tier, 0) >= 1 and not reviewed:
        key, why = "review", (f"Fleet: this is tier {tier} work and no independent review round ran. Start the fleet "
                              "`code-reviewer` as a subagent"
                              # M: one round only (measured 2026-10-13: an "L: ..." hint here made the main agent add an
                              # appsec round to M work)
                              + (", then a second round with another focus (appsec / qa-automation)" if tier == "L" else
                                 " (M: one round; appsec only if loop_tier.py flagged security)")
                              + ", fix Blocker/Major, run the gate again, then finish. Only the owner can waive the review.")
    elif cp and RANK.get(cp.get("tier"), 0) >= 1:
        key, why = "close", (f"Fleet: checkpoint {cp['id']} is still open. If the work is done: {py} "
                             f".claude/fleet/tools/flow_state.py close {cp['id']}. If the owner asked to pause, leave it open "
                             "and say so in one line.")
    else:
        return
    n = sum(has(f"stop-{key}-{i}") for i in range(STOP_CAPS[key]))
    if n >= STOP_CAPS[key]:
        return                                                # reminded already: the owner sees the result
    open(session_marker(root, sid, f"stop-{key}-{n}"), "a").close()
    print(json.dumps({"decision": "block", "reason": why}))   # same shape for the Copilot agentStop and the Claude Stop hook


def route_specialist(raw, data, root, ti):
    """Adaptive specialist model routing (Copilot CLI): the deterministic resolver (model_router.py, no model call) picks
    the model and the hook writes it into the `task` call (preToolUse modifiedArgs: no approval, no terminal command).
    An explicit model in the call, fleet OFF, routing disabled, an unknown agent or any error -> untouched (inherit)."""
    agent = str(ti.get("agent_type") or ti.get("agentType") or "")
    if not agent or not fleet_active(root, data.get("session_id") or ""):
        return
    try:
        args = raw.get("toolArgs")
        args = json.loads(args) if isinstance(args, str) else dict(args or {})
    except (ValueError, TypeError):
        return
    if not isinstance(args, dict):
        return
    changed = False
    if not ti.get("model"):
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import model_router
            r = model_router.route(root, agent, str(ti.get("prompt") or ""), "copilot-cli")
            model = ((r or {}).get("primary") or {}).get("model")
            if model:
                args["model"], changed = model, True
        except Exception:
            pass
    # owner decision 2026-10-13: the Copilot main agent did not name an allowed project skill in its packet (measured), so
    # the hook reminds the specialist of its allowlist in the packet itself (a reminder, not enforcement)
    skills = project_skills(root, agent, "copilot")
    prompt = args.get("prompt")
    if skills and isinstance(prompt, str) and SKILLS_NOTE not in prompt:
        args["prompt"], changed = skills_note(prompt, skills, "skill"), True
    if changed:
        print(json.dumps({"modifiedArgs": args}))
        sys.exit(0)


SKILLS_NOTE = "Project skills allowed for you (owner-approved, /configure-fleet-skills):"


def skills_note(prompt, skills, tool):
    return (prompt.rstrip() + f"\n\n{SKILLS_NOTE} " + ", ".join(f"`{s}`" for s in skills)
            + f". If one fits this task, call it with the `{tool}` tool before you start; no other skill.")


def claude_skill_note(data, root, ti):
    """Claude Code: the same packet reminder as on Copilot (owner decision 2026-10-14: the policy rule alone was not
    followed, measured 1 of 2 runs), via PreToolUse updatedInput on the Agent call."""
    agent = str(ti.get("subagent_type") or "")
    prompt = ti.get("prompt")
    if not agent or not isinstance(prompt, str) or SKILLS_NOTE in prompt or not fleet_active(root, data.get("session_id") or ""):
        return
    skills = project_skills(root, agent, "claude")
    if not skills:
        return
    # ponytail: updatedInput needs a decision; "allow" only skips the permission prompt of this Agent call (no prompt by
    # default anyway), deny rules still apply
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                             "permissionDecisionReason": "fleet: project-skill reminder added to the packet",
                                             "updatedInput": dict(ti, prompt=skills_note(prompt, skills, "Skill"))}}))
    sys.exit(0)


def project_skills(root, agent, tool):
    try:
        with open(os.path.join(root, ".claude", "fleet", "project", "skills.json"), encoding="utf-8-sig") as fh:
            names = ((json.load(fh).get("agents") or {}).get(agent) or {}).get(tool) or []
        return [n for n in names if isinstance(n, str)] if isinstance(names, list) else []
    except (OSError, ValueError, AttributeError):
        return []


def subagent_context(root):
    cps = open_checkpoints(root, 24)
    if cps:
        c = cps[0]
        print(json.dumps({"additionalContext": f"FLOW {c.get('flow')} / PHASE {c.get('phase')} / TASK-ID {c['id']} (fleet "
                                               "checkpoint; the packet below is authoritative)"}))


def check_db_main(cmd):
    """Main session / non-fleet agents: the same database rule, but only when a DB client or tool is actually RUN (command
    position), so a commit message or a grep that merely mentions `psql ... create` is not blocked. Once a client runs,
    the whole command is inspected (SQL may arrive through a pipe)."""
    runs_client = False
    for seg in segments(cmd):
        seg = strip_prefix(seg)
        if not seg:
            continue
        text = " ".join(seg)
        if any(re.match(pat, text) for pat, _ in DB_TOOLS):
            check_db(text, MAIN_TAIL)
        runs_client |= bool(DB_CLIENT.fullmatch(os.path.basename(seg[0].replace("\\", "/"))))
    if runs_client:
        check_db(cmd, MAIN_TAIL)


def check_db(cmd, tail=AGENT_TAIL):
    """The database rule holds for EVERY session (fleet agents, the main session, other agents): read-only on databases."""
    for pat, why in DB_TOOLS:
        if re.search(pat, cmd):
            deny(f"{why}: database writes are proposals only (the owner runs them)", tail)
    if DB_CLIENT.search(cmd):
        if DB_SCRIPT_FILE.search(cmd) or DB_PIPED_SCRIPT.search(cmd):
            deny("database client running a script file (content cannot be verified read-only); pass a read-only statement "
                 "inline (-Q / -c) or hand the script over as a proposal", tail)
        if DB_WRITE_SQL.search(cmd):
            deny("write SQL through a database client: databases are read-only; hand the statement over as a proposal "
                 "(the owner runs it)", tail)


PROJECT_ROOT = None   # set in main(); a project that itself lives under /tmp is never "temp"


def is_temp(path):
    win_tmp = os.environ.get("TEMP") or os.environ.get("TMP") or ""
    if not (path.startswith(TEMP_PREFIXES) or (win_tmp and os.path.normcase(path).startswith(os.path.normcase(win_tmp)))):
        return False
    if PROJECT_ROOT and os.path.isabs(path):
        root = os.path.normcase(os.path.realpath(PROJECT_ROOT))
        full = os.path.normcase(os.path.realpath(path))
        if full == root or full.startswith(root + os.sep):
            return False
    return True


def segments(cmd):
    """Split a shell command into simple commands (best effort; quotes respected). Yields token lists."""
    try:
        lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()<>")
        lex.whitespace_split = True
        lex.commenters = ""
        toks = list(lex)
    except ValueError:
        toks = cmd.split()
    cur = []
    for t in toks:
        if t in (";", "&&", "||", "|", "&", "(", ")", "\n", "|&"):
            if cur:
                yield cur
            cur = []
        else:
            cur.append(t)
    if cur:
        yield cur


def strip_prefix(seg):
    """Drop leading VAR=value assignments and wrappers like `env X=1`, `time`, `nice`, `command`."""
    i = 0
    while i < len(seg) and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", seg[i]) or seg[i] in ("env", "time", "nice", "command", "exec", "nohup")):
        i += 1
    return seg[i:]


def outside_project(path, cwd, root):
    p = os.path.expanduser(os.path.expandvars(path))
    if p in ("/", "~", "*", ".", "..") or path in ("$HOME", "${HOME}", "~/"):
        return True
    full = os.path.normcase(os.path.realpath(os.path.join(cwd, p)))
    rootr = os.path.normcase(os.path.realpath(root))
    return full == rootr or not (full + os.sep).startswith(rootr.rstrip(os.sep) + os.sep)   # os.sep: "\" on Windows


def check_rm(seg, cwd, root):
    if not seg or seg[0] != "rm":
        return
    flags = "".join(t.lstrip("-") for t in seg[1:] if t.startswith("-") and not t.startswith("--"))
    longs = [t for t in seg[1:] if t.startswith("--")]
    recursive = "r" in flags or "R" in flags or "--recursive" in longs
    if not recursive:
        return
    for t in seg[1:]:
        if t.startswith("-") or is_temp(t):
            continue
        if outside_project(t, cwd, root):
            deny(f"rm -r on '{t}' (outside the project or the project root itself)")


def check_readonly_bash(cmd):
    """Detect file-system writes in a Bash command of a read-only agent."""
    try:
        lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()<>")
        lex.whitespace_split = True
        lex.commenters = ""
        toks = list(lex)
    except ValueError:
        toks = cmd.split()
    for i, t in enumerate(toks):
        if t in (">", ">>", ">|", "&>", "&>>"):
            target = toks[i + 1] if i + 1 < len(toks) else ""
            if t == ">" and i > 0 and toks[i - 1].isdigit() and target.startswith("&"):
                continue
            if target.startswith("&") or is_temp(target):
                continue
            return f"output redirection to '{target}'"
        if t == ">&" and i + 1 < len(toks) and not toks[i + 1].isdigit() and not is_temp(toks[i + 1]):
            return f"output redirection to '{toks[i + 1]}'"
    if PS_WRITE.search(cmd) or (re.search(r"(?i)\b(?:powershell|pwsh)(?:\.exe)?\b", cmd) and PS_ALIAS_WRITE.search(cmd)):
        return "file-writing PowerShell cmdlet"
    for seg in segments(cmd):
        seg = strip_prefix(seg)
        if not seg:
            continue
        exe = os.path.basename(seg[0])
        args = [a for a in seg[1:] if not a.startswith("-")]
        if exe in FILE_WRITERS and any(not is_temp(a) for a in args):
            return f"`{exe}` on project files"
        if exe in COPIERS and args and not is_temp(args[-1]):
            return f"`{exe}` into project files"
        if exe == "tee" and any(not is_temp(a) for a in args):
            return "tee to a project file"
        if exe in ("sed", "perl", "ruby") and any(re.match(r"^-[A-Za-z]*i", a) or a.startswith("--in-place") for a in seg[1:]):
            return f"in-place edit with {exe}"
        if exe == "git":
            rest = [a for a in seg[1:] if not a.startswith("-")]
            sub = rest[0] if rest else ""
            listing = sub in ("tag", "stash", "worktree") and (len(rest) == 1 and sub != "stash" or
                                                              (len(rest) > 1 and rest[1] in ("list", "show")) or
                                                              any(a in ("-l", "--list") for a in seg[1:]))
            if sub in GIT_WRITE and not listing:
                return f"git {sub}"
        if exe in ("patch",):
            return "patch"
        if len(seg) > 1 and (exe, seg[1]) in PKG_WRITE:
            return f"{exe} {seg[1]} (dependency change)"
    return None


def fleet_agent(root, agent):
    """Fleet agent = installed by the fleet installer (manifest) or, in the fleet source repo, any project agent.
    Claude Code agents live in .claude/agents/<a>.md, Copilot agents in .github/agents/<a>.agent.md."""
    if not agent or agent == COORDINATOR or not re.match(r"^[A-Za-z0-9_.-]+$", agent):
        return None
    candidates = [(os.path.join(root, ".claude", "agents", agent + ".md"), f"agent {agent}.md"),
                  (os.path.join(root, ".github", "agents", agent + ".agent.md"), f"cagent {agent}.agent.md")]
    manifest = os.path.join(root, ".claude", "fleet", ".installed")
    listed = None
    if os.path.isfile(manifest):
        with open(manifest, encoding="utf-8") as fh:
            listed = set(fh.read().splitlines())
    for path, line in candidates:
        if os.path.isfile(path) and (listed is None or line in listed):
            return path
    return None


def read_only(agent_file):
    with open(agent_file, encoding="utf-8") as fh:
        head = fh.read(4000)
    m = re.search(r"^tools:\s*(.+)$", head, re.M)
    if not m:
        return False
    tools = {t.strip().strip("[]\"' ").lower() for t in m.group(1).split(",")}   # Claude: Edit, Write; Copilot: ["edit", ...]
    return not ({"edit", "write", "multiedit"} & tools)


def main():
    global PROJECT_ROOT
    raw = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))   # hooks send UTF-8; Windows stdin default is the code page
    if "toolName" not in raw and "tool_name" not in raw:
        root = os.environ.get("CLAUDE_PROJECT_DIR") or raw.get("cwd") or os.getcwd()
        if raw.get("agentName"):
            copilot_subagent_event(raw)                              # Copilot subagentStart / subagentStop
            if not raw.get("agentId"):
                subagent_context(root)
        elif "stopReason" in raw or raw.get("hook_event_name") == "Stop":
            stop_gate(raw, root)                                     # Copilot agentStop / Claude Stop
        return
    data = normalize(raw)
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    PROJECT_ROOT = root
    agent_file = fleet_agent(root, data.get("agent_type"))
    tool = data.get("tool_name") or ""
    ti = data.get("tool_input") or {}
    if FORMAT == "copilot" and tool == "Agent" and fleet_active(root, data.get("session_id") or ""):   # owner 2026-10-13: fleet ON only
        want = str(ti.get("agent_type") or ti.get("agentType") or "").lower()
        if want == COORDINATOR:
            deny(f"`{COORDINATOR}` is the orchestrator role of the MAIN agent, not a subagent (depth 1: a specialist cannot "
                 "start further agents); delegate to the specialist directly (e.g. agent_type `backend`, `code-reviewer`)", tail="")
        fleet = BUILTIN_TO_FLEET.get(want)
        if fleet and (os.path.isfile(os.path.join(root, ".github", "agents", fleet + ".agent.md"))
                      or os.path.isfile(os.path.join(root, ".claude", "agents", fleet + ".md"))):
            deny(f"`{want}` is a Copilot built-in agent without the fleet's rules; start the fleet specialist `{fleet}` "
                 f"instead (same task, agent_type `{fleet}`)", tail="")
    if state_tamper(tool, ti):                            # everyone, the orchestrator included
        deny("a workflow checkpoint (.claude/fleet/state/) changes only through flow_state.py (set / close); reading it is "
             "fine", tail="If the close gate refuses, run the missing step (e.g. the review subagent); only the owner waives it.")
    if tool == "Bash" and FORCE_CLOSE.search(ti.get("command") or ""):
        ask("Fleet: `flow_state.py close --force` closes M/L work WITHOUT its independent review round. Only the owner may "
            "waive the review: approve only if you (the owner) decided so.")
    if not agent_file:
        # main session, built-in or non-fleet agent: only the absolute database rule (push is covered by permissions.ask)
        if tool == "Bash":
            check_db_main(ti.get("command") or "")
            if (FORMAT == "copilot" or data.get("powershell")) and PUSH.search(ti.get("command") or ""):
                # Copilot has no permissions.ask, and its Bash(git push:*) rule misses Claude Code's PowerShell tool: the
                # hook asks instead (scoped owner approval before any push/merge)
                ask("Fleet: push / PR merge only with the owner's explicit approval for exactly these facts "
                    "(branch, commits, target remote).")
        if not data.get("agent_type"):                    # the orchestrator itself, not a built-in/other agent
            workflow_reminder(data, root, tool, ti)
            if FORMAT == "copilot" and tool == "Agent":
                route_specialist(raw, data, root, ti)
            elif FORMAT == "claude" and tool in ("Agent", "Task"):
                claude_skill_note(data, root, ti)
        return
    cwd = data.get("cwd") or root
    ro = read_only(agent_file)

    if tool in SECRET_PATH_TOOLS:
        for p in ti.get("file_paths") or [ti.get("file_path") or ti.get("notebook_path") or ti.get("path") or ""]:
            if p and SECRET_PATH.search(" " + p):
                deny(f"secret/credential file '{os.path.basename(p)}' (ask the orchestrator for the non-secret value you need)")
    if ro and tool in WRITE_TOOLS:
        p = ti.get("file_path") or ti.get("notebook_path") or ""
        if not is_temp(p):
            deny(f"{tool} by a read-only role")
    if tool != "Bash":
        return
    cmd = ti.get("command") or ""
    for pat, why in EXTERNAL:
        if re.search(pat, cmd):
            deny(why)
    check_db(cmd)
    if SECRET_CMD.search(" " + cmd):
        deny("command touches a secret/credential file")
    if ENV_DUMP.search(cmd):
        deny("environment dump (may print secrets)")
    for seg in segments(cmd):
        check_rm(strip_prefix(seg), cwd, root)
    if ro:
        why = check_readonly_bash(cmd)
        if why:
            deny(f"{why} — this role is read-only; report the change under NEXT ACTION instead")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # fail open: never break the session
        pass
    sys.exit(0)
