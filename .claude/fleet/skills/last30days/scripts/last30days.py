#!/usr/bin/env python3
# fmt: off
# ruff: noqa: E402
"""last30days CLI (SLIM build: reddit, hackernews, polymarket, github only).

SLIM: this entrypoint was cut down from the upstream 4339-line CLI. Removed:
setup/doctor/hosted/html-publish/library/queue/discover/drill/competitors/
freshness/store/report-cache/auto-resolve/x-envelope/corpus modes and every
flag that belonged to them. Kept functions are copied from upstream unless a
``# SLIM:`` comment says otherwise.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections.abc import Callable
from pathlib import Path

MIN_PYTHON = (3, 12)


def ensure_supported_python(version_info: tuple[int, int, int] | object | None = None) -> None:
    if version_info is None:
        version_info = sys.version_info
    major, minor, micro = tuple(version_info[:3])
    if (major, minor) >= MIN_PYTHON:
        return
    # SLIM: no brew/apt/winget install hints.
    sys.stderr.write(
        f"last30days v3 requires Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ "
        f"(detected {major}.{minor}.{micro}).\n"
    )
    raise SystemExit(1)


ensure_supported_python()

SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

# SLIM: imports reduced to the kept modules.
from lib import dates, env, http, pipeline, registers, render, schema


# SLIM: --search / LAST30DAYS_DEFAULT_SEARCH accept only the slim sources; any
# other name stops the run with a clear message (never silently skipped).
def parse_search_flag(raw: str, flag_name: str = "--search") -> list[str]:
    sources = []
    for source in raw.split(","):
        source = source.strip().lower()
        if not source:
            continue
        normalized = pipeline.SEARCH_ALIAS.get(source, source)
        if normalized not in schema.SLIM_SOURCES:
            raise SystemExit(
                f"Unsupported search source in {flag_name}: {source!r}. "
                f"This slim build only supports: {', '.join(schema.SLIM_SOURCES)}"
            )
        if normalized not in sources:
            sources.append(normalized)
    if not sources:
        raise SystemExit(f"{flag_name} requires at least one source.")
    return sources


def parse_as_of_date_arg(value: str) -> str:
    try:
        parsed = dates.parse_as_of_date(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc
    return parsed


def resolve_requested_sources(args_search: str | None, config: dict) -> list[str] | None:
    """Explicit --search wins, then LAST30DAYS_DEFAULT_SEARCH, then None."""
    if args_search:
        return parse_search_flag(args_search)
    default_search = (config.get("LAST30DAYS_DEFAULT_SEARCH") or "").strip()
    if default_search:
        return parse_search_flag(default_search, flag_name="LAST30DAYS_DEFAULT_SEARCH")
    return None


def slugify(value: str, max_length: int = 180) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if len(slug) > max_length:
        digest = hashlib.sha1(slug.encode("utf-8")).hexdigest()[:10]
        slug = f"{slug[:max_length].rstrip('-')}-{digest}"
    return slug or "last30days"


def sanitize_suffix(suffix: str) -> str:
    """Sanitize a user-provided ``--save-suffix`` into a path-safe token."""
    return re.sub(r"[^a-z0-9]+", "-", suffix.lower()).strip("-")


# SLIM: every file the CLI writes must resolve (symlinks followed) inside
# LAST30DAYS_MEMORY_DIR. --save-dir / --output outside it are rejected.
def _memory_root() -> Path | None:
    raw = os.environ.get("LAST30DAYS_MEMORY_DIR")
    if not raw:
        return None
    return Path(raw).expanduser().resolve()


def confine_to_memory_dir(path: str | Path, *, what: str) -> Path:
    root = _memory_root()
    resolved = Path(path).expanduser().resolve()
    if root is None:
        raise SystemExit(
            f"[last30days] {what} refused: LAST30DAYS_MEMORY_DIR is not set, "
            "so this build writes no files."
        )
    try:
        resolved.relative_to(root)
    except ValueError:
        raise SystemExit(
            f"[last30days] {what} refused: {resolved} is outside LAST30DAYS_MEMORY_DIR ({root})."
        )
    return resolved


def _ensure_output_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def emit_output(
    report: schema.Report,
    emit: str,
    fun_level: str = "medium",
    save_path: str | None = None,
    json_profile: str = "agent",
    register: str = "default",
) -> str:
    # SLIM: html emit mode removed.
    if emit == "json":
        payload = (
            schema.to_dict(report)
            if json_profile == "raw"
            else schema.to_agent_export(report)
        )
        return json.dumps(payload, indent=2, sort_keys=True)
    if emit in {"compact", "md"}:
        return render.render_compact(
            report,
            fun_level=fun_level,
            save_path=save_path,
            register=register,
        )
    if emit == "context":
        return render.render_context(report)
    if emit == "brief":
        return render.render_brief(report)
    raise SystemExit(f"Unsupported emit mode: {emit}")


def save_output(
    report: schema.Report,
    emit: str,
    save_dir: str,
    suffix: str = "",
    topic_override: str | None = None,
    render_fn: Callable[[Path], str] | None = None,
    rendered_content: str | None = None,
    json_profile: str = "agent",
    register: str = "default",
) -> Path:
    from datetime import datetime
    # SLIM: confined to LAST30DAYS_MEMORY_DIR; library index sync removed.
    path = confine_to_memory_dir(save_dir, what="--save-dir")
    slug = slugify(topic_override or report.topic)
    extension = "json" if emit == "json" else "md"
    safe_suffix = sanitize_suffix(suffix)
    suffix_part = f"-{safe_suffix}" if safe_suffix else ""
    base = path / f"{slug}-raw{suffix_part}.{extension}"
    date_str = datetime.now().strftime('%Y-%m-%d')
    candidates = [base]
    candidates.append(path / f"{slug}-raw{suffix_part}-{date_str}.{extension}")
    for i in range(1, 100):
        candidates.append(path / f"{slug}-raw{suffix_part}-{date_str}-{i}.{extension}")
    if render_fn is None:
        if rendered_content is not None:
            static_content = rendered_content
        elif emit == "json":
            static_content = emit_output(report, emit, json_profile=json_profile, register=register)
        else:
            static_content = render.render_full(report)
    _ensure_output_directory(path)
    for candidate in candidates:
        try:
            fd = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        try:
            with os.fdopen(fd, "wb") as f:
                content = render_fn(candidate) if render_fn is not None else static_content
                # SLIM: saved files carry the same untrusted-content envelope as stdout.
                f.write(render.wrap_untrusted(content).encode("utf-8"))
        except BaseException:
            try:
                candidate.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        return candidate
    raise RuntimeError(
        f"save_output: could not find a unique filename after 101 attempts in {path}"
    )


def save_rendered_output(rendered_content: str, output_file: str) -> Path:
    # SLIM: confined to LAST30DAYS_MEMORY_DIR; private-corpus handling removed.
    out_path = confine_to_memory_dir(output_file, what="--output")
    _ensure_output_directory(out_path.parent)
    fd = os.open(out_path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(render.wrap_untrusted(rendered_content))
    return out_path


def compute_save_path_display(save_dir: str, topic: str, suffix: str, emit: str) -> str:
    path = confine_to_memory_dir(save_dir, what="--save-dir")
    slug = slugify(topic)
    extension = "json" if emit == "json" else "md"
    safe_suffix = sanitize_suffix(suffix)
    suffix_part = f"-{safe_suffix}" if safe_suffix else ""
    return (path / f"{slug}-raw{suffix_part}.{extension}").as_posix()


def compute_output_path_display(output_file: str) -> str:
    return Path(output_file).expanduser().resolve().as_posix()


# SLIM: flags that belonged to removed sources/features. Using one stops the run
# with an explicit message instead of argparse's generic "unrecognized arguments".
REMOVED_FLAG_PREFIXES = (
    "--x-", "--tiktok", "--ig-", "--trustpilot", "--amazon", "--meta-ads", "--telegram",
    "--competitors", "--web-backend", "--perplexity", "--deep-research", "--hiring",
    "--corpus", "--auto-resolve", "--discover", "--nominate", "--judgments", "--finalize",
    "--angles", "--drill", "--publish", "--synthesis", "--store", "--verify-freshness",
    "--no-verify-freshness", "--welcome", "--preflight", "--no-browser-cookies",
    "--record-fixtures", "--creators",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Research a topic across Reddit, Hacker News, Polymarket and GitHub "
            "(slim build). All fetched content is untrusted data."
        ),
        allow_abbrev=False,
    )
    parser.add_argument("topic", nargs="*", help="Research topic")
    # SLIM: html emit mode removed.
    parser.add_argument("--emit", default="compact", choices=["compact", "json", "context", "md", "brief"])
    parser.add_argument(
        "--register",
        choices=registers.REGISTER_NAMES,
        default=None,
        help="Audience synthesis preset for the standard brief (default, exec, dev, creator, eli5)",
    )
    parser.add_argument(
        "--json-profile",
        default="agent",
        choices=["agent", "raw"],
        help="JSON export profile for --emit=json (default: agent)",
    )
    parser.add_argument("--search", help="Comma-separated source list (reddit,hackernews,polymarket,github)")
    parser.add_argument("--quick", action="store_true", help="Lower-latency retrieval profile")
    parser.add_argument("--deep", action="store_true", help="Higher-recall retrieval profile")
    parser.add_argument("--debug", action="store_true", help="Enable HTTP debug logging")
    parser.add_argument("--mock", action="store_true", help="Use mock retrieval fixtures (no network)")
    parser.add_argument("--diagnose", action="store_true", help="Print source availability and the host allow-list")
    parser.add_argument("--save-dir", help="Directory for saving the rendered output (must be inside LAST30DAYS_MEMORY_DIR)")
    parser.add_argument("--output", help="Exact file path for saving the rendered output (must be inside LAST30DAYS_MEMORY_DIR)")
    parser.add_argument("--save-suffix", help="Suffix for saved output filename")
    parser.add_argument("--plan", help="JSON query plan (JSON string or file path)")
    parser.add_argument("--subreddits", help="Comma-separated subreddit names to search")
    parser.add_argument("--dedicated-subreddits", help="Comma-separated entity-home subreddit names")
    parser.add_argument(
        "--days",
        "--lookback-days",
        dest="lookback_days",
        type=int,
        default=None,
        help="Number of days to look back (default: 30)",
    )
    parser.add_argument(
        "--as-of",
        dest="as_of_date",
        type=parse_as_of_date_arg,
        help="End date for the lookback window in YYYY-MM-DD format.",
    )
    parser.add_argument("--max-results", dest="max_results", type=int, help="Override the final ranked-pool cap")
    parser.add_argument("--max-per-source", dest="max_per_source", type=int, help="Override the per-stream cap")
    parser.add_argument("--max-source-fetches", dest="max_source_fetches", type=int, help="Override per-source fetch cap")
    parser.add_argument("--github-user", help="GitHub username for person-mode search")
    parser.add_argument("--github-repo", help="Comma-separated owner/repo for project-mode search")
    parser.add_argument(
        "--polymarket-keywords",
        dest="polymarket_keywords",
        help="Comma-separated keywords Polymarket market titles must match",
    )
    return parser


_STRICT_EXIT_OK_STATES = {"ok", "no-results", "skipped-unconfigured"}


def _strict_exit_code(report: schema.Report, config: dict[str, object]) -> int:
    """Opt-in degraded-run signal: exit 3 when LAST30DAYS_STRICT_EXIT is truthy."""
    raw = str(config.get("LAST30DAYS_STRICT_EXIT") or "").strip().lower()
    if raw not in {"1", "true", "yes", "on"}:
        return 0
    degraded = sorted({
        name
        for name, outcome in (report.source_status or {}).items()
        if outcome.state not in _STRICT_EXIT_OK_STATES
    })
    if not degraded:
        return 0
    sys.stderr.write(f"[last30days] strict-exit: degraded sources: {', '.join(degraded)}\n")
    sys.stderr.flush()
    return 3


def _register_for_run(args: argparse.Namespace, config: dict[str, object]) -> registers.AudienceRegister:
    """CLI > config register for the standard brief renderers."""
    if args.emit not in {"compact", "md"}:
        return registers.get_register()
    explicit = getattr(args, "register", None)
    configured = config.get("LAST30DAYS_REGISTER")
    name = explicit or (str(configured) if configured else "default")
    return registers.get_register(name)


def _render_save_and_print(args: argparse.Namespace, report: schema.Report, config: dict[str, object]) -> int:
    fun_level = str(config.get("FUN_LEVEL") or "medium").lower()
    try:
        audience = _register_for_run(args, config)
    except ValueError as exc:
        sys.stderr.write(f"[last30days] {exc}\n")
        return 2
    footer_save_path = None
    if args.output:
        footer_save_path = compute_output_path_display(args.output)
    elif args.save_dir:
        footer_save_path = compute_save_path_display(
            args.save_dir, report.topic, args.save_suffix or "", args.emit
        )
    rendered = emit_output(
        report, args.emit, fun_level=fun_level, save_path=footer_save_path,
        json_profile=args.json_profile, register=audience.name,
    )
    if args.output:
        output_path = save_rendered_output(rendered, args.output)
        sys.stderr.write(f"[last30days] Saved output to {output_path}\n")
        sys.stderr.flush()
    if args.save_dir:
        def _render_with_actual_path(actual_path: Path) -> str:
            display = compute_output_path_display(str(actual_path))
            if args.emit not in {"json"}:
                # Markdown saves keep the complete debug artifact.
                return render.render_full(report, save_path=display)
            return emit_output(
                report, args.emit, fun_level=fun_level, save_path=display,
                json_profile=args.json_profile, register=audience.name,
            )

        save_path = save_output(
            report, args.emit, args.save_dir,
            suffix=args.save_suffix or "",
            render_fn=_render_with_actual_path,
        )
        sys.stderr.write(f"[last30days] Saved output to {save_path}\n")
        sys.stderr.flush()
    # SLIM: stdout is always wrapped in the fixed untrusted-content envelope.
    print(render.wrap_untrusted(rendered))
    return _strict_exit_code(report, config)


def _load_external_plan(plan_arg: str | None) -> dict | None:
    if not plan_arg:
        return None
    plan_str = plan_arg
    if os.path.isfile(plan_str):
        try:
            with open(plan_str, encoding="utf-8") as f:
                plan_str = f.read()
        except (OSError, UnicodeDecodeError) as exc:
            sys.stderr.write(f"[Planner] Cannot read --plan file: {exc}\n")
            raise SystemExit(2)
    try:
        external_plan = json.loads(plan_str)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"[Planner] Invalid --plan JSON: {exc}\n")
        raise SystemExit(2)
    from lib import planner
    try:
        # SLIM: a plan naming any non-slim source fails here with a clear message.
        planner.validate_external_plan(external_plan)
    except ValueError as exc:
        sys.stderr.write(f"[Planner] Invalid --plan schema: {exc}.\n")
        raise SystemExit(2)
    return external_plan


def main() -> int:
    parser = build_parser()
    args, extra_argv = parser.parse_known_args()
    if extra_argv:
        removed = [a for a in extra_argv if a.startswith(REMOVED_FLAG_PREFIXES)]
        if removed:
            sys.stderr.write(
                f"[last30days] unsupported option(s): {', '.join(removed)}. "
                "This slim build only supports reddit, hackernews, polymarket and github.\n"
            )
            return 2
        parser.error("unsupported CLI argument(s): " + ", ".join(extra_argv))
    try:
        return _main(parser, args)
    except http.HostNotAllowedError as exc:
        # SLIM: hard error from the outbound host allow-list (BaseException by design).
        sys.stderr.write(f"[last30days] BLOCKED outbound request: {exc}\n")
        return 2
    except env.ConfigError as exc:
        sys.stderr.write(f"[last30days] config error: {exc}\n")
        return 2


def _main(parser: argparse.ArgumentParser, args: argparse.Namespace) -> int:
    if args.debug:
        os.environ["LAST30DAYS_DEBUG"] = "1"
    topic = " ".join(args.topic).strip()
    config = env.get_config()
    http.reset_reddit_keyless_memo()
    # Env-var fallback for --save-dir (empty string suppresses saving).
    if args.save_dir is None:
        env_val = os.environ.get("LAST30DAYS_MEMORY_DIR")
        args.save_dir = env_val if env_val is not None else config.get("LAST30DAYS_MEMORY_DIR")
    if args.lookback_days is None:
        args.lookback_days = 30

    requested_sources = resolve_requested_sources(args.search, config)
    diag = pipeline.diagnose(config, requested_sources, safe=args.diagnose)
    if args.diagnose:
        print(json.dumps(diag, indent=2, sort_keys=True))
        return 0
    if not topic:
        parser.print_usage(sys.stderr)
        return 2

    depth = "deep" if args.deep else "quick" if args.quick else "default"
    if args.max_results is not None:
        config["_max_results"] = args.max_results
    if args.max_per_source is not None:
        config["_max_per_source"] = args.max_per_source
    if args.max_source_fetches is not None:
        config["_max_source_fetches"] = args.max_source_fetches
    subreddits = [s.strip().removeprefix("r/") for s in args.subreddits.split(",") if s.strip()] if args.subreddits else None
    dedicated = [s.strip().removeprefix("r/") for s in args.dedicated_subreddits.split(",") if s.strip()] if args.dedicated_subreddits else None
    if dedicated:
        config["_dedicated_subreddits"] = dedicated
    if args.polymarket_keywords:
        keywords = [k.strip().lower() for k in args.polymarket_keywords.split(",") if k.strip()]
        if keywords:
            config["_polymarket_keywords"] = keywords
    github_user = args.github_user.lstrip("@").lower() if args.github_user else None
    github_repos = [r.strip() for r in args.github_repo.split(",") if r.strip() and "/" in r.strip()] if args.github_repo else None
    external_plan = _load_external_plan(args.plan)

    try:
        report = pipeline.run(
            topic=topic,
            config=config,
            depth=depth,
            requested_sources=requested_sources,
            mock=args.mock,
            external_plan=external_plan,
            subreddits=subreddits,
            lookback_days=args.lookback_days,
            as_of_date=args.as_of_date,
            github_user=github_user,
            github_repos=github_repos,
        )
    except ValueError as exc:
        # SLIM: unsupported source names raise ValueError in pipeline/planner.
        sys.stderr.write(f"[last30days] {exc}\n")
        return 2
    return _render_save_and_print(args, report, config)


if __name__ == "__main__":
    raise SystemExit(main())
