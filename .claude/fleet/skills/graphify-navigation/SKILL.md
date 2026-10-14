---
name: graphify-navigation
description: Use before exploring a codebase (finding where something lives, what calls what, what a change affects) when the project may have a graphify knowledge graph in graphify-out/. Covers detecting a usable graph, querying it, keeping it fresh, and what to do when graphify is missing.
---

# Graphify navigation (works in Claude Code and GitHub Copilot)

graphify turns a project into a knowledge graph (`graphify-out/graph.json`, `GRAPH_REPORT.md`). Asking the graph is far cheaper than grepping and reading dozens of files. The `graphify` CLI works in any shell, so this skill is identical for Claude Code and Copilot; in Claude Code the global `/graphify` skill does the same.

**The graph lives in the PROJECT this fleet is installed into** (its root: `graphify-out/` next to `.git`), never in the fleet source repo. Run every command from the project root.

## 1. Is there a usable graph? (10 seconds, then move on)

```bash
graphify god-nodes --top 5      # exits non-zero / "graph file not found" when there is no loadable graph
```

Usable means ALL of:
- the command above prints hubs (the graph loads and is not empty);
- `graphify-out/GRAPH_REPORT.md` exists (read its first screen: size, communities, what is covered);
- it covers the area you work in (the report/god-nodes mention that part of the code). If C#, Razor, C++ or T-SQL files you need are not represented, treat the graph as partial and use grep/Read for those parts;
- it is not clearly stale: code changed after `graphify-out/graph.json` was written (compare its timestamp with `git log -1 --format=%cd` and `git status --short`).

Not usable (or a trivial task, e.g. one known file)? **Do not stall: work without it** (grep/Glob/Read). The graph is an accelerator, not a prerequisite.

## 2. Use it BEFORE broad exploration

| Need | Command |
|---|---|
| Where does X live / how does it connect | `graphify query "OrderService"` (BFS, broad); `--dfs` to trace one chain; `--budget 1500` caps the output |
| Plain-language summary of one symbol | `graphify explain "OrderService"` |
| How does A reach B | `graphify path "OrderController" "SqlOrderRepository"` |
| What breaks if I change X (blast radius) | `graphify affected "OrderService" --depth 2` |
| Architectural hubs / layers | `graphify god-nodes --top 15`, and read `graphify-out/GRAPH_REPORT.md` |

Rules for good queries:
- graphify matches **node labels by substring** (no stemming, synonyms or Hungarian-to-English translation). Query with identifiers as they appear in the code (class, method, file, table names), not with prose. Empty result? Retry once with 2-3 other identifier tokens, then fall back to grep.
- The graph is a **map, not the truth**. Edges tagged INFERRED or AMBIGUOUS are hypotheses. Open the cited `source_location` and verify before you rely on it, and never report a graph fact as verified without that.
- Use the graph to choose WHICH files to read, then read them. Do not paste graph output into results; cite files and symbols.

## 3. Role-specific use

| Role | Use for |
|---|---|
| backend, frontend-web, integration-engineer, python-engineer | locate the code to change, `affected` before touching a shared symbol, `path` from UI/controller to data access / ERP interface |
| code-reviewer, qa-automation | `affected` on the changed symbols: what else is impacted and which tests should run or be added |
| appsec | `path` from an untrusted entry point (controller, Blazor event, ERP input) to sinks (SQL, file, native C++ call) |
| architect, engineering-lead | `god-nodes`, communities in the report, layering violations; ground the dispatch plan in real module boundaries |
| database-data-engineer | which code builds or sends a given query/table access, to find every caller of the SQL you optimize |
| sre-observability | trace an incident symptom to the code path |

## 4. Keeping it fresh (orchestrator / write-capable roles; code only, no LLM, no API key)

```bash
graphify update .          # re-extract changed code files, rebuild graph.json and GRAPH_REPORT.md
graphify hook install      # optional, owner's choice: rebuild after every git commit
```

Read-only roles never rebuild: they report a stale graph under NEXT ACTION.

## 5. graphify is not installed / there is no graph yet

- Specialists (subagents) never install anything: continue without the graph and note "graphify missing" or "no graph" under NEXT ACTION.
- The orchestrator (main session) installs it once per project when a non-trivial code task would benefit (the owner's standing preference; global tool, installs nothing into the project): `uv tool install graphifyy`, else `pipx install graphifyy`, else `pip install graphifyy`; verify with `graphify --help`. If the install fails or is not allowed, **move on without it**.
- No graph yet and the project is non-trivial: build a code-only graph, which needs no API key and uses no LLM: `graphify extract . --code-only` (run from the project root). Docs/papers/images and the semantic (LLM) pass cost tokens: only on the owner's request.
- Before the first build, make sure build output and secrets are excluded: graphify honors `.gitignore`; add a `.graphifyignore` for anything else (`bin/`, `obj/`, `.vs/`, `node_modules/`, `wwwroot/lib/`, generated code, `.env*`). Whether to commit `graphify-out/` or ignore it is the owner's decision.

## 6. Handing graph knowledge to specialists

A subagent cannot see your session. When you already queried the graph, put the **distilled facts** (the 5-10 relevant files/symbols, the call path, the affected set) into the task packet under RELEVANT FILES and KNOWN DECISIONS, marked as graph-derived, so the specialist starts from them instead of re-exploring. Tell it `graphify-out/` exists so it can query further.
