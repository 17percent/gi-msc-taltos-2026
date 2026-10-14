#!/usr/bin/env python3
"""Cheap, deterministic project inventory for /configure-fleet (no model call, stdlib only). Prints JSON.

What it reads: file NAMES (git ls-files, or a walk that skips build output), and the CONTENT of small build/manifest files
only (*.csproj, *.vcxproj, Directory.Packages.props, global.json, package.json, pyproject.toml, requirements*.txt,
CMakeLists.txt, vcpkg.json, pom.xml, build.gradle*, go.mod, Cargo.toml, CI workflow YAML).
What it never reads: .env*, keys/certificates, appsettings*.json, nuget.config, *secret* files (names only, values never).

Usage: python survey_project.py [--target DIR] [--max-files N]
"""
import argparse
import collections
import json
import os
import re
import shutil
import subprocess

SKIP_DIRS = {".git", "node_modules", "bin", "obj", ".vs", ".vscode", ".idea", "dist", "build", "out", "target", "packages",
             ".venv", "venv", "__pycache__", "graphify-out", ".claude", "Agentic-main", ".next", ".nuxt", "coverage", "TestResults"}
NEVER_READ = re.compile(r"(?i)(^|/)(\.env[^/]*|[^/]*\.(pem|pfx|p12|key|kdbx|jks|keystore)|appsettings[^/]*\.json|nuget\.config|[^/]*secret[^/]*)$")
MAX_READ = 512 * 1024

KNOWN_PACKAGES = {  # package id (exact or prefix*) -> label
    "Microsoft.AspNetCore.Components.WebAssembly": "Blazor WebAssembly", "Microsoft.AspNetCore.Components.Web": "Blazor/Razor components",
    "Telerik.UI.for.Blazor": "UI: Telerik UI for Blazor", "MudBlazor": "UI: MudBlazor", "Radzen.Blazor": "UI: Radzen Blazor",
    "Microsoft.FluentUI.AspNetCore.Components": "UI: Fluent UI Blazor", "Syncfusion.Blazor*": "UI: Syncfusion Blazor", "DevExpress.Blazor*": "UI: DevExpress Blazor",
    "Microsoft.EntityFrameworkCore.SqlServer": "DB: EF Core + SQL Server", "Microsoft.EntityFrameworkCore*": "data: EF Core",
    "Npgsql*": "DB: PostgreSQL", "Pomelo.EntityFrameworkCore.MySql": "DB: MySQL", "MySql.Data": "DB: MySQL", "Oracle.*": "DB: Oracle",
    "Microsoft.Data.SqlClient": "DB: SQL Server (SqlClient)", "System.Data.SqlClient": "DB: SQL Server (SqlClient)", "Dapper": "data: Dapper",
    "Microsoft.Data.Sqlite*": "DB: SQLite", "MongoDB.Driver": "DB: MongoDB",
    "xunit*": "test: xUnit", "NUnit*": "test: NUnit", "MSTest.TestFramework": "test: MSTest", "MSTest": "test: MSTest", "bunit*": "test: bUnit",
    "Microsoft.Playwright*": "test: Playwright", "Testcontainers*": "test: Testcontainers", "Moq": "test: Moq", "NSubstitute": "test: NSubstitute",
    "FluentAssertions": "test: FluentAssertions", "Shouldly": "test: Shouldly", "coverlet*": "test: coverlet", "Verify*": "test: Verify",
    "Microsoft.Identity.Web*": "auth: Microsoft Identity (Entra ID)", "Microsoft.AspNetCore.Authentication.JwtBearer": "auth: JWT bearer",
    "Microsoft.AspNetCore.Authentication.OpenIdConnect": "auth: OpenID Connect", "Duende.IdentityServer*": "auth: Duende IdentityServer",
    "Microsoft.AspNetCore.Identity*": "auth: ASP.NET Core Identity",
    "Serilog*": "obs: Serilog", "NLog*": "obs: NLog", "OpenTelemetry*": "obs: OpenTelemetry", "Microsoft.ApplicationInsights*": "obs: Application Insights",
    "MassTransit*": "msg: MassTransit", "Azure.Messaging.ServiceBus": "msg: Azure Service Bus", "RabbitMQ.Client": "msg: RabbitMQ",
    "Hangfire*": "jobs: Hangfire", "Quartz*": "jobs: Quartz", "Polly*": "resilience: Polly", "Microsoft.Extensions.Http.Resilience": "resilience: MS resilience",
    "FluentValidation*": "validation: FluentValidation", "AutoMapper*": "mapping: AutoMapper", "MediatR*": "pattern: MediatR",
    "Swashbuckle*": "api: Swagger/Swashbuckle", "NSwag*": "api: NSwag", "Grpc*": "api: gRPC", "CoreWCF*": "api: CoreWCF", "System.ServiceModel*": "api: WCF client",
    "Azure.*": "cloud: Azure SDK",
}
KNOWN_NPM = {"react": "web: React", "next": "web: Next.js", "vue": "web: Vue", "nuxt": "web: Nuxt", "@angular/core": "web: Angular", "svelte": "web: Svelte",
             "jest": "test: Jest", "vitest": "test: Vitest", "@playwright/test": "test: Playwright", "cypress": "test: Cypress",
             "tailwindcss": "css: Tailwind", "bootstrap": "css: Bootstrap", "@mui/material": "UI: MUI", "antd": "UI: Ant Design", "vuetify": "UI: Vuetify",
             "typescript": "lang: TypeScript", "express": "api: Express", "@nestjs/core": "api: NestJS", "fastify": "api: Fastify"}
KNOWN_PY = {"fastapi": "api: FastAPI", "django": "web: Django", "flask": "web: Flask", "pytest": "test: pytest", "pandas": "data: pandas",
            "torch": "ml: PyTorch", "tensorflow": "ml: TensorFlow", "sqlalchemy": "data: SQLAlchemy", "pyodbc": "DB: ODBC (pyodbc)"}


def list_files(root, max_files):
    try:
        p = subprocess.run(["git", "-c", "core.quotepath=false", "ls-files", "-co", "--exclude-standard"], cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if p.returncode == 0 and p.stdout.strip():
            files = [f for f in p.stdout.splitlines() if not (set(f.split("/")[:-1]) & SKIP_DIRS)]
            return files[:max_files], "git", len(files) > max_files
    except OSError:
        pass
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            out.append(os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, "/"))
            if len(out) >= max_files:
                return out, "walk", True
    return out, "walk", False


def small(root, rel):
    if NEVER_READ.search(rel):
        return ""
    p = os.path.join(root, rel)
    try:
        if os.path.getsize(p) > MAX_READ:
            return ""
        with open(p, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def match_pkg(name):
    for k, label in KNOWN_PACKAGES.items():
        if (k.endswith("*") and name.lower().startswith(k[:-1].lower())) or name.lower() == k.lower():
            return label
    return None


FIX_RX = re.compile(r"(?i)(\bfix(es|ed)?\b|\bbug(fix)?\b|\bhotfix\b|\bregression\b|\bhiba|\bjav[ií]t)")


def git_out(root, args, timeout=120):
    try:
        p = subprocess.run(["git", "-c", "core.quotepath=false"] + args, cwd=root, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
        return p.stdout if p.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def skip_path(path):
    parts = path.split("/")
    return bool(set(parts[:-1]) & SKIP_DIRS)


def area_of(path):
    parts = path.split("/")[:-1]
    return "/".join(parts[:2]) if parts else "(root)"


def hotspots(root, months, max_commits=5000):
    """Change-heavy and bug-fix-heavy areas (folder, 2 levels) from the local git history: candidates for L-tier signals."""
    log = git_out(root, ["log", f"--since={months} months ago", f"--max-count={max_commits}", "--no-merges", "--name-only", "--format=%x01%s"])
    churn, fixes, commits = collections.Counter(), collections.Counter(), 0
    for block in log.split("\x01")[1:]:
        lines = block.strip("\n").split("\n")
        subj, paths = lines[0], [l for l in lines[1:] if l.strip() and not skip_path(l)]
        if not paths:
            continue
        commits += 1
        for a in {area_of(x) for x in paths}:
            churn[a] += 1
            if FIX_RX.search(subj):
                fixes[a] += 1
    top = sorted(churn, key=lambda a: (fixes[a] * 3 + churn[a]), reverse=True)[:12]
    return {"since_months": months, "commits": commits,
            "areas": [{"area": a, "commits": churn[a], "fix_commits": fixes[a]} for a in top],
            "note": "score = 3 x fix commits + commits; confirm with the owner before turning any area into an L-tier signal"}


def find_cycles(graph):
    cycles, state = [], {}

    def dfs(n, stack):
        state[n] = 1
        stack.append(n)
        for m in graph.get(n, []):
            if state.get(m) == 1:
                cycles.append(stack[stack.index(m):] + [m])
            elif m in graph and not state.get(m):
                dfs(m, stack)
        stack.pop()
        state[n] = 2

    for n in graph:
        if not state.get(n):
            dfs(n, [])
    return cycles


def project_graph(root, files):
    """Who references whom (*.csproj / *.fsproj / *.vbproj / *.vcxproj ProjectReference): the raw material for layering rules."""
    projs = [f for f in files if f.lower().endswith((".csproj", ".fsproj", ".vbproj", ".vcxproj"))]
    name = lambda x: os.path.splitext(os.path.basename(x.replace("\\", "/")))[0]
    graph = {}
    for f in projs[:400]:
        refs = re.findall(r'<ProjectReference\s+Include="([^"]+)"', small(root, f))
        graph[name(f)] = sorted({name(r) for r in refs})
    referenced_by = collections.Counter(r for refs in graph.values() for r in refs)
    shown = dict(sorted(graph.items())[:80])
    return {"projects": len(graph), "references": shown, "truncated": len(graph) > 80,
            "most_referenced": dict(referenced_by.most_common(10)),
            "test_projects": sorted(n for n in graph if re.search(r"(?i)tests?$|\.tests?\.|unittest|integrationtest", n))[:40],
            "cycles": find_cycles(graph)[:5]}


def conventions(root, files):
    """Code-style and instruction sources the agents must follow (contents of style config only; never secrets)."""
    style_names = {".editorconfig", ".globalconfig", "stylecop.json", ".prettierrc", ".prettierrc.json", ".prettierrc.yml", "ruff.toml",
                   ".eslintrc", ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs", ".clang-format", ".clang-tidy",
                   "directory.build.props", "directory.build.targets"}
    instr = []
    style, msb = [], collections.Counter()
    ec = {}
    for f in files:
        low, b = f.lower(), os.path.basename(f.lower())
        if b in style_names:
            style.append(f)
        if b in ("claude.md", "agents.md", ".cursorrules", ".windsurfrules") or low == ".github/copilot-instructions.md" \
                or (low.startswith(".github/instructions/") and low.endswith(".instructions.md")):
            instr.append(f)
        if b.endswith((".csproj", ".fsproj")) or b == "directory.build.props":
            txt = small(root, f)
            for prop in ("Nullable", "TreatWarningsAsErrors", "WarningsAsErrors", "LangVersion", "AnalysisLevel", "AnalysisMode",
                         "EnforceCodeStyleInBuild", "ImplicitUsings", "GenerateDocumentationFile"):
                for v in re.findall(rf"<{prop}>([^<]+)</{prop}>", txt):
                    msb[f"{prop}={v.strip()[:40]}"] += 1
        if f == ".editorconfig":
            txt = small(root, f)
            ec = {"root": bool(re.search(r"(?m)^\s*root\s*=\s*true", txt)),
                  "indent_style": (re.findall(r"(?m)^\s*indent_style\s*=\s*(\w+)", txt) or [None])[0],
                  "diagnostic_rules": len(re.findall(r"(?m)^\s*dotnet_diagnostic\.", txt)),
                  "naming_rules": len(re.findall(r"(?m)^\s*dotnet_naming_rule\.", txt)),
                  "csharp_style_settings": len(re.findall(r"(?m)^\s*csharp_style_", txt))}
    return {"style_files": sorted(style)[:30], "msbuild_settings": dict(msb.most_common(20)), "editorconfig": ec,
            "instruction_files": sorted(instr)[:20],
            "note": "read the instruction files (outside any agentic-fleet block) and check them against the fleet rules for conflicts"}


def gate_candidates(root, files, labels):
    """Commands the dev loop would use as its gate; /configure-fleet runs them only with the owner's approval."""
    c = []
    slns = sorted(f for f in files if f.lower().endswith((".sln", ".slnx")))
    if slns:
        tgt = f' "{slns[0]}"' if len(slns) == 1 else " <solution>"
        note = "" if len(slns) == 1 else f"{len(slns)} solutions: ask the owner which one is the gate"
        c += [{"kind": "build", "cmd": "dotnet build" + tgt, "note": note},
              {"kind": "test", "cmd": "dotnet test" + tgt, "note": "may include integration tests: confirm they do not write to a reachable database before running"},
              {"kind": "format", "cmd": "dotnet format --verify-no-changes" + tgt, "note": "only if the repo enforces formatting"}]
    if "package.json" in files:
        try:
            scripts = json.loads(small(root, "package.json") or "{}").get("scripts", {})
        except ValueError:
            scripts = {}
        mgr = "pnpm" if "pnpm-lock.yaml" in files else "yarn" if "yarn.lock" in files else "npm"
        for s in ("build", "lint", "typecheck", "test"):
            if s in scripts:
                c.append({"kind": s, "cmd": f"{mgr} run {s}", "note": ""})
    if any(l.startswith("test: pytest") for l in labels):
        c.append({"kind": "test", "cmd": "pytest", "note": ""})
    if "CMakeLists.txt" in files:
        c += [{"kind": "build", "cmd": "cmake -S . -B build && cmake --build build", "note": "prefer CMakePresets.json if present"},
              {"kind": "test", "cmd": "ctest --test-dir build --output-on-failure", "note": ""}]
    return c


def ci_details(root, files):
    """Pipeline names, triggers, stages/jobs, runners and environment names (no secret names or values)."""
    out = []
    for f in files:
        low = f.lower()
        if not ((low.startswith(".github/workflows/") and low.endswith((".yml", ".yaml"))) or re.search(r"(^|/)azure-pipelines[^/]*\.ya?ml$", low)
                or low.endswith(".gitlab-ci.yml")):
            continue
        txt = small(root, f)
        envs = set(re.findall(r"(?m)^\s*environment:\s*['\"]?([\w.-]+)['\"]?\s*$", txt))
        envs |= set(re.findall(r"(?m)^\s*environment:\s*\n\s+name:\s*['\"]?([\w.-]+)", txt))
        runners = sorted(set(re.findall(r"(?m)^\s*runs-on:\s*\[?\s*['\"]?([\w.${}-]+)", txt)) | set(re.findall(r"vmImage:\s*['\"]?([\w.-]+)", txt)))
        stages = re.findall(r"(?m)^\s*-\s*stage:\s*['\"]?([\w.-]+)", txt)
        jobs = []
        m = re.search(r"(?m)^jobs:\s*$", txt)
        if m:
            jobs = re.findall(r"(?m)^  ([A-Za-z0-9_-]+):\s*$", txt[m.end():])
        branches = sorted(set(re.findall(r"(?m)^\s*-\s*['\"]?((?:main|master|develop|release[\w/*.-]*|hotfix[\w/*.-]*|feature[\w/*.-]*))['\"]?\s*$", txt)))
        for inline in re.findall(r"(?m)^\s*branches:\s*\[([^\]]+)\]", txt):
            branches = sorted(set(branches) | {x.strip(" '\"") for x in inline.split(",")})
        name = (re.findall(r"(?m)^name:\s*['\"]?(.+?)['\"]?\s*$", txt) or [None])[0]
        out.append({"file": f, "name": name, "environments": sorted(envs), "runners": runners[:8], "stages": stages[:12],
                    "jobs": jobs[:12], "branches": branches[:10], "deploys": bool(re.search(r"(?i)\b(deploy|publish|release)\b", txt))})
    return out[:15]


def glossary(root, files):
    """Domain-term candidates: entity/model/DTO file names and EF Core DbSet<T> names (names only)."""
    terms = collections.Counter()
    for f in files:
        low = f.lower()
        if low.endswith(".cs") and re.search(r"(^|/)(entities|entity|models?|domain|dtos?|aggregates|contracts?)/", low):
            terms[os.path.splitext(os.path.basename(f))[0]] += 1
        if low.endswith(".cs") and "dbcontext" in os.path.basename(low):
            for m in re.findall(r"DbSet<\s*(\w+)\s*>", small(root, f)):
                terms[m] += 2
    clean = collections.Counter()
    for term, n in terms.items():
        base = re.sub(r"(Dto|DTO|Entity|Model|ViewModel|Request|Response|Command|Query)$", "", term) or term
        if not base.startswith(("I", "_")) or not base[1:2].isupper():
            clean[base] += n
    return [t for t, _ in clean.most_common(40)]


def graphify_info(root):
    gdir = os.path.join(root, "graphify-out")
    gp = os.path.join(gdir, "graph.json")
    if not os.path.isfile(gp):
        return {"graph": False}
    info = {"graph": True}
    head = git_out(root, ["log", "-1", "--format=%ct"]).strip()
    if head.isdigit():
        info["stale_vs_last_commit"] = os.path.getmtime(gp) < int(head)
    rp = os.path.join(gdir, "GRAPH_REPORT.md")
    if os.path.isfile(rp):
        with open(rp, encoding="utf-8", errors="replace") as fh:
            info["report_headings"] = [l.strip() for l in fh.read(200_000).splitlines() if l.startswith("#")][:30]
    exe = shutil.which("graphify")
    info["cli"] = bool(exe)
    if exe:
        try:
            p = subprocess.run([exe, "god-nodes", "--top", "12", "--json"], cwd=root, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=90)
            if p.returncode == 0:
                try:
                    info["god_nodes"] = json.loads(p.stdout)
                except ValueError:
                    info["god_nodes_text"] = p.stdout[:1500]
        except (OSError, subprocess.TimeoutExpired):
            pass
    return info


def drift(prev, cur):
    """What changed since the snapshot saved by /configure-fleet (.claude/fleet/project/survey.json)."""
    pl, cl = set(prev.get("detected", {})), set(cur.get("detected", {}))
    pd, cd = set(prev.get("top_level_dirs", {})), set(cur.get("top_level_dirs", {}))
    pt, ct = set(prev.get("dotnet_target_frameworks", {})), set(cur.get("dotnet_target_frameworks", {}))
    pci = {c["file"] for c in prev.get("ci", [])}
    cci = {c["file"] for c in cur.get("ci", [])}
    d = {"new_signals": sorted(cl - pl), "gone_signals": sorted(pl - cl), "new_top_level_dirs": sorted(cd - pd),
         "gone_top_level_dirs": sorted(pd - cd), "target_frameworks_changed": sorted(pt ^ ct), "ci_files_changed": sorted(pci ^ cci)}
    d["needs_update"] = any(d[k] for k in d)
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default=".")
    ap.add_argument("--max-files", type=int, default=200000)
    ap.add_argument("--since-months", type=int, default=6, help="git history window for hotspots")
    ap.add_argument("--out", help="write the JSON to this file (UTF-8) instead of stdout; use this rather than shell redirection on Windows")
    ap.add_argument("--compare", help="previous survey JSON (e.g. .claude/fleet/project/survey.json): adds a drift section")
    a = ap.parse_args()
    root = os.path.abspath(a.target)
    files, source, truncated = list_files(root, a.max_files)
    ext = collections.Counter((os.path.splitext(f)[1].lower() or "(none)") for f in files)
    top = collections.Counter(f.split("/")[0] if "/" in f else "(root)" for f in files)
    ev = collections.defaultdict(set)          # label -> evidence paths
    tfms, sdks = collections.Counter(), collections.Counter()

    def hit(label, path):            # evidence capped at 4 paths per label
        if len(ev[label]) < 4:
            ev[label].add(path)

    for f in files:
        low = f.lower()
        base = os.path.basename(low)
        if low.endswith((".sln", ".slnx")):
            hit("dotnet: solution", f)
        if low.endswith((".csproj", ".fsproj", ".vbproj")) or base == "directory.packages.props":
            t = small(root, f)
            for tfm in re.findall(r"<TargetFrameworks?>([^<]+)</TargetFrameworks?>", t):
                for x in tfm.split(";"):
                    tfms[x.strip()] += 1
            m = re.search(r'<Project\s+Sdk="([^"]+)"', t)
            if m:
                sdks[m.group(1)] += 1
            for pkg in re.findall(r'<Package(?:Reference|Version)\s+Include="([^"]+)"', t):
                lab = match_pkg(pkg)
                if lab:
                    hit(lab, f)
            if low.endswith(".csproj"):
                hit("lang: C#", f)
        if low.endswith(".razor"):
            hit("web: Razor components (.razor)", f)
        if low.endswith((".vcxproj",)) or base in ("cmakelists.txt", "vcpkg.json", "conanfile.txt", "conanfile.py"):
            hit("native: C/C++ build", f)
        if base == "global.json":
            m = re.search(r'"version"\s*:\s*"([^"]+)"', small(root, f))
            hit(f"dotnet: SDK pinned {m.group(1)}" if m else "dotnet: global.json", f)
        if base == "package.json" and "node_modules" not in low:
            try:
                pj = json.loads(small(root, f) or "{}")
            except ValueError:
                pj = {}
            for dep in list(pj.get("dependencies", {})) + list(pj.get("devDependencies", {})):
                if dep in KNOWN_NPM:
                    hit(KNOWN_NPM[dep], f)
            hit("node: package.json", f)
        if base in ("pyproject.toml", "setup.py") or re.match(r"requirements.*\.txt$", base):
            t = small(root, f).lower()
            for k, lab in KNOWN_PY.items():
                if re.search(rf"(^|[\s\"'=,\[]){re.escape(k)}([\s\"'=<>~!,\]]|$)", t, re.M):
                    hit(lab, f)
            hit("lang: Python", f)
        if base in ("pom.xml", "build.gradle", "build.gradle.kts"):
            hit("lang: Java/Kotlin (JVM)", f)
        if base == "go.mod":
            hit("lang: Go", f)
        if base == "cargo.toml":
            hit("lang: Rust", f)
        if low.endswith(".sql"):
            hit("db: .sql scripts", f)
        if low.endswith(".sqlproj"):
            hit("db: SSDT/DACPAC project (.sqlproj)", f)
        if re.search(r"(^|/)migrations?/", low):
            hit("db: migrations folder", f)
        if low.endswith("modelsnapshot.cs"):
            hit("db: EF Core migrations", f)
        if low.startswith(".github/workflows/") and low.endswith((".yml", ".yaml")):
            hit("ci: GitHub Actions", f)
        if re.match(r"azure-pipelines.*\.ya?ml$", base) or low.startswith(".azuredevops/"):
            hit("ci: Azure DevOps Pipelines", f)
        if base == ".gitlab-ci.yml":
            hit("ci: GitLab CI", f)
        if base == "jenkinsfile":
            hit("ci: Jenkins", f)
        if base in ("dockerfile",) or base.startswith("docker-compose"):
            hit("deploy: Docker", f)
        if base == "chart.yaml":
            hit("deploy: Helm/Kubernetes", f)
        if low.endswith(".bicep"):
            hit("infra: Bicep (Azure)", f)
        if low.endswith(".tf"):
            hit("infra: Terraform", f)
        if base == "web.config":
            hit("deploy: IIS (web.config)", f)
        if low.endswith(".pubxml"):
            hit("deploy: publish profile (.pubxml)", f)
        m = re.match(r"(?i)appsettings\.([^.]+)\.json$", os.path.basename(f))
        if m:
            hit(f"env: {m.group(1)}", f)          # name only: the file content is never read
        if base in ("readme.md", "claude.md", "agents.md", "contributing.md") or low == ".github/copilot-instructions.md":
            hit("docs: " + base, f)
        if re.search(r"(^|/)(docs?/)?adrs?/", low):
            hit("docs: ADRs", f)
        if re.search(r"(?i)(erp|forsharp|integration|connector|interface)s?(/|\.)", f) and low.endswith((".csproj", ".py", "package.json")):
            hit("integration: project/module name hints", f)
        if base in ("nuget.config",):
            hit("dotnet: nuget.config present (content not read)", f)
    branches, cur = [], ""
    b = git_out(root, ["branch", "-a", "--format=%(refname:short)"])
    branches = sorted({x.replace("origin/", "") for x in b.split() if x and "HEAD" not in x})[:25]
    cur = git_out(root, ["branch", "--show-current"]).strip()
    detected = {k: sorted(v) for k, v in sorted(ev.items())}
    out = {
        "root": root, "file_source": source, "files": len(files), "truncated": truncated,
        "extensions_top": dict(ext.most_common(25)),
        "top_level_dirs": dict(top.most_common(20)),
        "dotnet_target_frameworks": dict(tfms.most_common()), "dotnet_project_sdks": dict(sdks.most_common()),
        "detected": detected,
        "projects": project_graph(root, files),
        "conventions": conventions(root, files),
        "gate_candidates": gate_candidates(root, set(files), list(detected)),
        "ci": ci_details(root, files),
        "glossary_candidates": glossary(root, files),
        "hotspots": hotspots(root, a.since_months) if cur or branches else {"note": "not a git repository"},
        "git": {"current_branch": cur, "branches": branches},
        "graphify": graphify_info(root),
        "note": "Detection is evidence, not truth: confirm uncertain items with the owner. File contents of secrets/config values were not read.",
    }
    if a.compare:
        try:
            with open(a.compare, encoding="utf-8") as fh:
                out["drift"] = drift(json.load(fh), out)
        except (OSError, ValueError) as e:
            out["drift"] = {"error": f"cannot read {a.compare}: {e}"}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text + "\n")
        print(f"survey written to {a.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
