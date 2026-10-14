"""v3.0.0 orchestration pipeline."""

from __future__ import annotations

# SLIM: stdlib imports reduced to what the remaining code uses (dropped contextlib,
# copy, math, queue, sqlite3, Counter, dataclasses, pathlib, shutil.which).
from collections.abc import Iterable, Mapping
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any

# SLIM: imports reduced to the modules the four slim sources and the report
# pipeline need (all other source/keyed/browser modules were deleted).
from . import (
    dates,
    dedupe,
    github,
    hackernews,
    health,
    http,
    log,
    normalize,
    planner,
    polymarket,
    query,
    reddit_public,
    relevance,
    rerank,
    schema,
    signals,
    snippet,
)
from .cluster import cluster_candidates
from . import fusion
from . import render
from .fusion import collapse_duplicate_urls, weighted_rrf

# SLIM: removed DISCOVERY_SOURCES, _DISCOVERY_GENERIC_DOMAIN_TERMS (non-slim feature)


DEPTH_SETTINGS = {
    "quick": {"per_stream_limit": 6, "pool_limit": 15, "rerank_limit": 12},
    "default": {"per_stream_limit": 12, "pool_limit": 40, "rerank_limit": 40},
    "deep": {"per_stream_limit": 20, "pool_limit": 60, "rerank_limit": 60},
}

# SLIM: only the "hn" alias remains; every other alias/source is rejected.
SEARCH_ALIAS = {
    "hn": "hackernews",
}

# SLIM: per-source fetch caps for the removed paid/CLI sources are gone.
MAX_SOURCE_FETCHES: dict[str, int] = {}

# SLIM: removed THIN_RETRY_EXEMPT, STREAM_ARTIFACT_LIFT_KEYS, _lift_stream_artifacts
# SLIM:   (non-slim feature)


_FAILURE_SPECIFICITY = {
    health.AUTH_FAILED: 0,
    health.PAYMENT_REQUIRED: 1,
    health.RATE_LIMITED: 2,
    health.SCHEMA_DRIFT: 3,
    health.TIMEOUT: 4,
    health.UNREACHABLE: 5,
    health.ERROR: 6,
}


# SLIM: removed PaidSourceBudget (non-slim feature)


def _source_fetch_cap(source: str, config: dict[str, Any]) -> int | None:
    """Return the effective per-run cap for one source (SLIM: no capped sources)."""
    override = config.get("_max_source_fetches")
    cap = MAX_SOURCE_FETCHES.get(source)
    if cap is not None and override is not None:
        return int(override)
    return cap


def _resolve_depth_settings(depth: str, config: dict[str, Any]) -> dict[str, int]:
    """Depth profile with optional CLI cap overrides applied (issue #716).

    Returns a copy so the module-level DEPTH_SETTINGS is never mutated. Overrides
    are set directly (not max()) so callers can also lower a cap. `--max-results`
    raises the final ranked pool (pool_limit/rerank_limit); `--max-per-source`
    raises the per-stream truncation applied before pooling. The per-source fetch
    cap (`--max-source-fetches`) is applied separately at the fetch site.
    """
    settings = dict(DEPTH_SETTINGS[depth])
    # `is not None` (not truthiness) so an explicit 0 is honored as a real lower
    # bound rather than ignored as "unset" — matches how main() stashes these.
    max_per_source = config.get("_max_per_source")
    if max_per_source is not None:
        settings["per_stream_limit"] = int(max_per_source)
    max_results = config.get("_max_results")
    if max_results is not None:
        settings["pool_limit"] = int(max_results)
        settings["rerank_limit"] = int(max_results)
    return settings

# SLIM: removed FROM_LANE_COUNT_PER, MENTION_LANE_COUNT_PER, RELATED_HANDLE_COUNT_PER,
# SLIM:   _has_perplexity_provider (non-slim feature)


# SLIM: the mock source list is the slim source set.
MOCK_AVAILABLE_SOURCES = list(schema.SLIM_SOURCES)


def normalize_requested_sources(sources: list[str] | None) -> list[str] | None:
    if not sources:
        return None
    normalized = []
    for source in sources:
        key = SEARCH_ALIAS.get(source.lower(), source.lower())
        # SLIM: any source outside the slim set is a hard error (never silently skipped).
        if key not in schema.SLIM_SOURCES:
            raise ValueError(
                f"Unsupported source {source!r}: this slim build only supports "
                + ", ".join(schema.SLIM_SOURCES)
            )
        if key not in normalized:
            normalized.append(key)
    return normalized


def available_sources(
    config: dict[str, Any],
    requested_sources: list[str] | None = None,
    **_unused: Any,
) -> list[str]:
    """List the sources the next run can serve.

    SLIM: the source set is exactly reddit, hackernews, polymarket and github
    (all keyless; GitHub works on the unauthenticated REST tier).
    """
    available: list[str] = list(schema.SLIM_SOURCES)
    exclude = {s.strip().lower() for s in (config.get("EXCLUDE_SOURCES") or "").split(",") if s.strip()}
    if exclude:
        available = [s for s in available if s not in exclude]
    return available


# SLIM: removed _mock_discovery_items, _matches_discovery_domain,
# SLIM:   _fetch_discovery_source, _discovery_engagement, _discovery_momentum,
# SLIM:   nominate_candidates, Nomination, _cluster_entity_counts,
# SLIM:   _DISAMBIGUATION_TOKEN_LIMIT, _disambiguated_topic_name, nominate_topic_pool,
# SLIM:   nominate_topics, ENRICH_LIMIT, ENRICH_DEPTH, ENRICH_MAX_WORKERS,
# SLIM:   ENRICH_BUDGET_SECONDS, EnrichedTopic, enrich_nominations,
# SLIM:   _enriched_evidence_items, _best_community_comment, _DiscoverySweep,
# SLIM:   _discovery_sweep, _degraded_discovery_sources, DiscoverNominateResult,
# SLIM:   run_discover_nominate, nominate_nothing_solid_report, _floor_survivor_records,
# SLIM:   _fold_same_story_records, _records_to_discovery_topics,
# SLIM:   _discovery_report_warnings, run_discover, RESUME_DEEP_ENRICH_DEPTH,
# SLIM:   RESUME_DEEP_ENRICH_MAX_WORKERS, RESUME_DEEP_ENRICH_BUDGET_SECONDS,
# SLIM:   _resume_enrich_budget_seconds, DiscoverResumeResult, run_discover_resume (non-
# SLIM:   slim feature)


def diagnose(
    config: dict[str, Any],
    requested_sources: list[str] | None = None,
    *,
    safe: bool = False,
    **_unused: Any,
) -> dict[str, Any]:
    # SLIM: network-free status report. No provider/cookie/credential/CLI probing.
    requested_sources = normalize_requested_sources(requested_sources)
    local_writes: list[dict[str, str]] = []
    if config.get("LAST30DAYS_MEMORY_DIR"):
        local_writes.append({"kind": "report", "path": str(config.get("LAST30DAYS_MEMORY_DIR"))})
    return {
        "mode": "slim",
        "supported_sources": list(schema.SLIM_SOURCES),
        "available_sources": available_sources(config, requested_sources),
        "has_github_token": bool(config.get("GITHUB_TOKEN")),
        "network_allow_list": sorted(http.ALLOWED_HOSTS),
        "safe": safe,
        "config_source": config.get("_CONFIG_SOURCE"),
        "local_writes": local_writes,
    }


def _inner_max_workers(stream_count: int, *, internal_subrun: bool) -> int:
    """Worker-pool size for the per-stream fanout inside a single pipeline run.

    Top-level runs use up to 16 workers. Subruns of ``run_competitor_fanout``
    cap the inner pool to 4 so a six-way competitor fan-out stays below
    roughly 30 worker threads in aggregate instead of ~96.
    """
    if internal_subrun:
        return max(2, min(4, stream_count or 1))
    return max(4, min(16, stream_count or 1))


# SLIM: removed _load_library_context (non-slim feature)


# SLIM: deterministic local runtime (the keyed LLM provider clients were removed).
_LOCAL_RUNTIME = schema.ProviderRuntime(
    reasoning_provider="local",
    planner_model="deterministic",
    rerank_model="local-score",
)


def run(
    *,
    topic: str,
    config: dict[str, Any],
    depth: str,
    requested_sources: list[str] | None = None,
    mock: bool = False,
    external_plan: dict | None = None,
    subreddits: list[str] | None = None,
    lookback_days: int = 30,
    as_of_date: str | None = None,
    github_user: str | None = None,
    github_repos: list[str] | None = None,
    internal_subrun: bool = False,
) -> schema.Report:
    # SLIM: signature reduced to the slim sources (no x/tiktok/instagram/trustpilot/
    # corpus/hiring/save_dir/envelope arguments).
    settings = _resolve_depth_settings(depth, config)
    requested_sources = normalize_requested_sources(requested_sources)
    run_started = time.monotonic()
    from_date, to_date = dates.get_date_range(lookback_days, as_of_date=as_of_date)
    runtime = _LOCAL_RUNTIME
    reasoning_provider = None
    if mock:
        available = list(requested_sources or MOCK_AVAILABLE_SOURCES)
    else:
        available = available_sources(config, requested_sources)
        if requested_sources:
            available = [source for source in available if source in requested_sources]
    if not available:
        raise RuntimeError("No sources are available for this run.")

    planner_requested_sources = requested_sources

    if external_plan is not None:
        # External plan provided (e.g., from Claude Code via --plan flag).
        # Explicit input is a contract: validate it before permissive sanitization.
        planner.validate_external_plan(external_plan)
        plan = planner._sanitize_plan(
            external_plan, topic, available, planner_requested_sources, depth,
            honor_plan_sources=True,
        )
        plan_source = "external"
    else:
        plan = planner.plan_query(
            topic=topic,
            available_sources=available,
            requested_sources=planner_requested_sources,
            depth=depth,
            provider=None,
            model=None,
            context="",
            internal_subrun=internal_subrun,
        )
        # SLIM: no LLM planner path; the plan is always deterministic here.
        plan_source = "deterministic"

    # Always-on planner trace. Stderr only; does not leak into the stdout synthesis.
    print(
        f"[Planner] Plan: intent={plan.intent}, freshness={plan.freshness_mode}, "
        f"cluster_mode={plan.cluster_mode}, subqueries={len(plan.subqueries)}, "
        f"source={plan_source}",
        file=sys.stderr,
    )
    if plan.subqueries:
        for index, sq in enumerate(plan.subqueries, start=1):
            sources_str = ",".join(sq.sources) if sq.sources else "(none)"
            print(
                f"[Planner]   sq{index} label={sq.label} "
                f'search="{sq.search_query}" sources=[{sources_str}]',
                file=sys.stderr,
            )
    else:
        print("[Planner]   (no subqueries in plan)", file=sys.stderr)

    bundle = schema.RetrievalBundle(artifacts={"grounding": []})
    # Handles the user named explicitly (GitHub user and @mentions in the topic):
    # first-party evidence is protected from the entity-miss demotion in rerank.
    explicit_first_party = {
        h.lstrip("@").strip().lower()
        for h in [github_user]
        if h and h.strip()
    }
    explicit_first_party |= _topic_first_party_candidates(topic)

    for source in (requested_sources or []):
        if source not in available:
            bundle.record_failure(
                source,
                schema.SKIPPED_UNCONFIGURED,
                "Source was requested but is not enabled for this run.",
                attempted=False,
            )
    bundle.artifacts["plan_source"] = plan_source

    # Project-mode or person-mode GitHub: run once before the main subquery loop
    _github_custom_done = False
    _github_enriched_repos: set[str] = set()

    # Project mode takes priority over person mode
    if github_repos and "github" in available:
        bundle.mark_attempted("github")
        try:
            project_items = github.search_github_project(
                github_repos, from_date, to_date,
                depth=depth, token=config.get("GITHUB_TOKEN"),
            )
            if project_items:
                normalized = _normalize_score_dedupe(
                    "github", project_items, from_date, to_date,
                    freshness_mode=plan.freshness_mode,
                    ranking_query=f"What are {', '.join(github_repos)} doing on GitHub?",
                )
                primary_label = plan.subqueries[0].label if plan.subqueries else "primary"
                bundle.add_items(primary_label, "github", normalized)
                _github_custom_done = True
                _github_enriched_repos = {r.lower() for r in github_repos}
        except Exception as exc:
            bundle.errors_by_source["github"] = f"Project-mode failed: {exc}"
            state, attempted = _classify_source_failure(exc)
            bundle.record_failure("github", state, str(exc), attempted=attempted)

    _github_person_done = False
    if github_user and "github" in available and not _github_custom_done:
        bundle.mark_attempted("github")
        _github_person_done = True
        try:
            person_items = github.search_github_person(
                github_user, from_date, to_date,
                depth=depth, token=config.get("GITHUB_TOKEN"),
            )
            if person_items:
                normalized = _normalize_score_dedupe(
                    "github", person_items, from_date, to_date,
                    freshness_mode=plan.freshness_mode,
                    ranking_query=f"What is @{github_user} doing on GitHub?",
                )
                # Use the first subquery's label so RRF can look up the weight
                primary_label = plan.subqueries[0].label if plan.subqueries else "primary"
                bundle.add_items(primary_label, "github", normalized)
            else:
                # A pinned --github-user that yields nothing must not be
                # silently backfilled by generic keyword search: the report
                # would then present unrelated repos as this person's work.
                bundle.record_failure(
                    "github",
                    "no-results",
                    f"Person mode found no activity for @{github_user} in the window",
                )
        except Exception as exc:
            bundle.errors_by_source["github"] = f"Person-mode failed: {exc}"
            state, attempted = _classify_source_failure(exc)
            bundle.record_failure("github", state, str(exc), attempted=attempted)

    # Thread-safe set prevents redundant fetches after a source returns 429
    rate_limited_sources: set[str] = set()
    rate_limit_lock = threading.Lock()

    futures = {}
    # Per-source fetch budget prevents redundant API calls
    source_fetch_count: dict[str, int] = {}
    stream_count = sum(
        1
        for subquery in plan.subqueries
        for source in subquery.sources
        if source in available
    )
    max_workers = _inner_max_workers(stream_count, internal_subrun=internal_subrun)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for subquery in plan.subqueries:
            for source in subquery.sources:
                if source not in available:
                    continue
                # Skip GitHub keyword search if person-mode already ran
                if source == "github" and (_github_person_done or _github_custom_done):
                    continue
                cap = _source_fetch_cap(source, config)
                if cap is not None:
                    if cap <= 0:
                        continue
                    current = source_fetch_count.get(source, 0)
                    if current >= cap:
                        continue
                    source_fetch_count[source] = current + 1
                bundle.mark_attempted(source)
                futures[
                    executor.submit(
                        _retrieve_stream,
                        topic=topic,
                        subquery=subquery,
                        source=source,
                        config=config,
                        depth=depth,
                        date_range=(from_date, to_date),
                        runtime=runtime,
                        mock=mock,
                        rate_limited_sources=rate_limited_sources,
                        rate_limit_lock=rate_limit_lock,
                        raw_topic=topic,
                        subreddits=subreddits,
                        run_started=run_started,
                    )
                ] = (subquery, source)

        for future in as_completed(futures):
            subquery, source = futures[future]
            try:
                raw_items, artifact = future.result()
            except Exception as exc:
                # Share 429 signal so pending futures skip this source
                if _is_rate_limit_error(exc):
                    with rate_limit_lock:
                        rate_limited_sources.add(source)
                    bundle.errors_by_source[source] = str(exc)
                    state, attempted = _classify_source_failure(exc)
                    bundle.record_failure(source, state, str(exc), attempted=attempted)
                    continue
                # Retry once for transient 5xx errors
                if _is_transient_error(exc):
                    time.sleep(3)
                    try:
                        raw_items, artifact = _retrieve_stream(
                            topic=topic, subquery=subquery, source=source,
                            config=config, depth=depth, date_range=(from_date, to_date),
                            runtime=runtime, mock=mock,
                            rate_limited_sources=rate_limited_sources,
                            rate_limit_lock=rate_limit_lock,
                            raw_topic=topic,
                            subreddits=subreddits,
                            run_started=run_started,
                        )
                    except Exception as retry_exc:
                        detail = f"{exc} (retried once, still failed: {retry_exc})"
                        bundle.errors_by_source[source] = detail
                        state, attempted = _classify_source_failure(retry_exc)
                        bundle.record_failure(source, state, detail, attempted=attempted)
                        continue
                else:
                    bundle.errors_by_source[source] = str(exc)
                    state, attempted = _classify_source_failure(exc)
                    bundle.record_failure(source, state, str(exc), attempted=attempted)
                    continue
            outcome_note = None
            if isinstance(artifact, dict) and artifact.get("_source_outcome"):
                artifact = dict(artifact)
                outcome_note = artifact.pop("_source_outcome")
                bundle.record_failure(
                    source,
                    outcome_note["state"],
                    outcome_note["detail"],
                    attempted=outcome_note.get("attempted", True),
                )
            if isinstance(artifact, dict) and artifact.get("_source_outcome_detail"):
                artifact = dict(artifact)
                lane_state = artifact.pop("_source_outcome_detail_state", None)
                bundle.record_detail(
                    source, artifact.pop("_source_outcome_detail"), state=lane_state
                )
                if lane_state == health.RATE_LIMITED:
                    # Do not re-fan-out against a host still inside its window.
                    with rate_limit_lock:
                        rate_limited_sources.add(source)
            normalized = _normalize_score_dedupe(
                source, raw_items, from_date, to_date,
                freshness_mode=plan.freshness_mode,
                ranking_query=subquery.ranking_query,
                first_party_handles=explicit_first_party,
            )
            normalized = _apply_reddit_stream_keepers(
                source, normalized, settings["per_stream_limit"], topic
            )
            bundle.add_items(subquery.label, source, normalized)
            if artifact:
                bundle.artifacts.setdefault("grounding", []).append(artifact)

    # SLIM: Phase 2 supplemental (X handle) searches removed.

    # Phase 2b: retry thin sources with simplified query
    # Note: _github_skip_sources tells the retry to not re-run GitHub keyword search
    # when project-mode or person-mode already provided authoritative data.
    _github_skip_retry: set[str] = set()
    if _github_person_done or _github_custom_done:
        _github_skip_retry.add("github")
    _retry_thin_sources(
        topic=topic,
        bundle=bundle,
        plan=plan,
        config=config,
        depth=depth,
        date_range=(from_date, to_date),
        runtime=runtime,
        mock=mock,
        rate_limited_sources=rate_limited_sources,
        rate_limit_lock=rate_limit_lock,
        settings=settings,
        skip_sources=_github_skip_retry,
        subreddits=subreddits,
        first_party_handles=explicit_first_party,
        run_started=run_started,
    )

    # Reclassify partial failures as DEGRADED instead of silently dropping them.
    degraded_by_source: dict[str, str] = {}
    for source in list(bundle.errors_by_source):
        if bundle.items_by_source.get(source):
            degraded_by_source[source] = bundle.errors_by_source[source]
            del bundle.errors_by_source[source]

    items_by_source = _finalize_items_by_source(
        bundle.items_by_source, topic=topic, config=config, depth=depth, mock=mock,
        elapsed=time.monotonic() - run_started,
    )
    source_status = _finalize_source_status(bundle.source_status, items_by_source)
    resolved_handles = set(explicit_first_party)

    candidates = weighted_rrf(
        bundle.items_by_source_and_query,
        plan,
        pool_limit=settings["pool_limit"],
        range_from=from_date,
        range_to=to_date,
        first_party_handles=resolved_handles,
    )
    ranked_candidates = rerank.rerank_candidates(
        topic=topic,
        plan=plan,
        candidates=candidates,
        provider=None,
        model=None,
        shortlist_size=settings["rerank_limit"],
        resolved_handles=resolved_handles,
    )
    ranked_candidates = rerank.prune_fallback_entity_misses(ranked_candidates, topic=topic)
    ranked_candidates = sorted(
        ranked_candidates,
        key=lambda candidate: (
            1 if schema.candidate_out_of_window(candidate) else 0,
            -candidate.final_score,
            -(candidate.engagement or -1),
            min(candidate.native_ranks.values(), default=999),
            candidate.title,
        ),
    )
    rerank.score_fun(
        topic=topic,
        candidates=ranked_candidates,
        provider=None,
        model=None,
    )

    # Phase 3: post-rerank GitHub star enrichment (api.github.com only).
    # SLIM: fixture record/replay removed.
    if "github" in available and not mock:
        github.enrich_candidates_with_stars(
            ranked_candidates,
            token=config.get("GITHUB_TOKEN"),
            already_enriched=_github_enriched_repos,
        )

    clusters = cluster_candidates(ranked_candidates, plan)
    warnings = _warnings(items_by_source, ranked_candidates, bundle.errors_by_source, degraded_by_source)

    return schema.Report(
        topic=topic,
        range_from=from_date,
        range_to=to_date,
        generated_at=datetime.now(timezone.utc).isoformat(),
        provider_runtime=runtime,
        query_plan=plan,
        clusters=clusters,
        ranked_candidates=ranked_candidates,
        items_by_source=items_by_source,
        errors_by_source=bundle.errors_by_source,
        source_status=source_status,
        warnings=warnings,
        artifacts=bundle.artifacts,
        library_context=[],
    )


# SLIM: removed _candidate_is_duplicate, merge_drill_report, _batch_subject_handles
# SLIM:   (non-slim feature)


# Reddit engagement keepers: per stream, the top-N threads by upvotes plus
# comments that clear the relevance floor and name the primary entity survive
# per_stream_limit truncation even when their local rank score is low. The
# stream order is 65% title relevance, so the month's most-discussed on-topic
# thread (16K upvotes, 0.19 relevance) was otherwise cut behind one-upvote
# posts with better title overlap.
REDDIT_STREAM_KEEPERS = 3


def _apply_reddit_stream_keepers(
    source: str,
    items: list[schema.SourceItem],
    limit: int,
    topic: str,
) -> list[schema.SourceItem]:
    """Truncate a stream to *limit*, holding slots for Reddit engagement keepers."""
    kept = list(items[:limit])
    if source != "reddit" or len(items) <= limit:
        return kept
    entity = rerank._primary_entity(topic or "") if topic else ""
    floor = fusion.relevance_floor_for_entity(entity)
    keepers = [
        item
        for item in sorted(items, key=fusion.raw_engagement, reverse=True)
        if fusion.reddit_thread_qualifies(item, entity, floor)
    ][:REDDIT_STREAM_KEEPERS]
    keeper_ids = {id(item) for item in keepers}
    for keeper in keepers:
        if any(item is keeper for item in kept):
            continue
        # Displace the lowest-ranked non-keeper so the slice stays at limit;
        # when the slice is already all keepers there is nothing to trade.
        displaced = False
        for index in range(len(kept) - 1, -1, -1):
            if id(kept[index]) not in keeper_ids:
                del kept[index]
                displaced = True
                break
        if displaced or len(kept) < limit:
            kept.append(keeper)
    return kept[:limit]



# SLIM: removed _creator_first_party_by_source, _creator_only_handles (non-slim feature)


def _log_prune_drop(
    source: str, before: int, after: int, scope: str | None = None
) -> None:
    """Log when the relevance prune removes items from a stream.

    The prune is silent by design inside ``signals`` (a pure function), but a
    silent drop is invisible to the user: issue #1101 fetched 36 creator reels
    and reported zero with no line explaining why. Log the count and the reason
    class here, next to the other per-stream retrieval logs. The all-weak
    ``filtered or items`` rescue keeps the originals, so before == after and
    nothing is logged - a rescue is not a drop.
    """
    dropped = before - after
    if dropped <= 0:
        return
    scope_note = f" ({scope})" if scope else ""
    log.source_log(
        render.SOURCE_LABELS.get(source, source.capitalize()),
        f"relevance prune dropped {dropped} of {before} items below the "
        f"relevance/engagement floor{scope_note}",
        tty_only=False,
    )


def _normalize_score_dedupe(
    source: str,
    raw_items: list[dict],
    from_date: str,
    to_date: str,
    freshness_mode: str,
    ranking_query: str,
    first_party_handles: Iterable[str] | None = None,
    first_party_by_source: Mapping[str, Iterable[str]] | None = None,
    defer_relevance_prune: bool = False,
) -> list[schema.SourceItem]:
    """Normalize, annotate, prune, dedupe, and extract snippets for a batch of raw items.

    ``defer_relevance_prune`` skips the relevance floor here so the caller can
    apply it once the run has resolved who the topic's subject is. Pruning X
    before handle resolution is the ordering bug behind the whole first-party
    evidence loss: the floor cannot exempt an author nobody has identified yet,
    and no amount of guessing at prune time substitutes for knowing.

    ``first_party_handles`` names accounts this run is explicitly searching, so
    their own posts survive the relevance floor (see signals.prune_low_relevance).
    """
    normalized = normalize.normalize_source_items(
        source, raw_items, from_date, to_date,
        freshness_mode=freshness_mode,
    )
    prepared_query = relevance.PreparedQuery(ranking_query)
    lookback_window_days = (
        datetime.strptime(to_date, "%Y-%m-%d").date()
        - datetime.strptime(from_date, "%Y-%m-%d").date()
    ).days
    normalized = signals.annotate_stream(
        normalized,
        prepared_query,
        freshness_mode,
        reference_date=to_date,
        max_days=lookback_window_days,
    )
    if not defer_relevance_prune:  # SLIM: jobs exemption removed
        floor_handles = set(first_party_handles or ())
        # SLIM: X-handle subject-batch union (_batch_subject_handles) removed.
        pre_prune_count = len(normalized)
        normalized = signals.prune_low_relevance(
            normalized,
            first_party_handles=floor_handles,
            first_party_by_source=first_party_by_source,
        )
        _log_prune_drop(source, pre_prune_count, len(normalized))
    normalized = dedupe.dedupe_items(normalized)
    for item in normalized:
        item.snippet = snippet.extract_best_snippet(item, prepared_query)
    return normalized


def _finalize_items_by_source(
    items_by_source_raw: dict[str, list[schema.SourceItem]],
    topic: str = "",
    config: dict | None = None,
    depth: str = "default",
    mock: bool = False,
    elapsed: float = 0.0,
) -> dict[str, list[schema.SourceItem]]:
    finalized = {}
    for source, items in items_by_source_raw.items():
        items = sorted(items, key=lambda item: item.local_rank_score or 0.0, reverse=True)
        # Same thread from two subquery streams: fold the enriched copy into
        # the first before the text-similarity dedupe, which would otherwise
        # keep whichever copy ranked higher and drop its comments.
        items = collapse_duplicate_urls(items)
        items = dedupe.dedupe_items(items)
        # SLIM: youtube/digg/amazon post-ranking enrichment (and fixture replay) removed.
        # Post-merge topic-relevance filter for Polymarket: comparison queries
        # fan out into per-entity subqueries ("Hermes", "OpenClaw") whose topic
        # is too narrow for Gamma API to filter meaningfully. Re-validating the
        # merged list against the full original topic drops off-topic markets
        # (e.g., WTI crude oil, Elon tweet counts) before footer emission.
        if source == "polymarket" and topic:
            items = polymarket.filter_items_against_topic(topic, items)
            # --polymarket-keywords (via config): additional keyword filter
            # for ambiguous single-token topics (e.g., "Warriors" → nba,gsw).
            keywords = config.get("_polymarket_keywords") if isinstance(config, dict) else None
            if keywords:
                items = polymarket.filter_items_against_keywords(items, keywords)
        finalized[source] = items
    return finalized


# SLIM: removed _merge_replayed_enrichment, _apply_hiring_signal_gate,
# SLIM:   _ensure_jobs_in_plan, _ensure_perplexity_in_plan, _company_topic_likely,
# SLIM:   _comparison_side_company_like (fixture replay was removed; non-slim feature)


def _warnings(
    items_by_source: dict[str, list[schema.SourceItem]],
    candidates: list[schema.Candidate],
    errors_by_source: dict[str, str],
    degraded_by_source: dict[str, str] | None = None,
) -> list[str]:
    warnings: list[str] = []
    if not candidates:
        warnings.append("No candidates survived retrieval and ranking.")
    if len(candidates) < 5:
        warnings.append("Evidence is thin for this topic.")
    top_sources = {
        source
        for candidate in candidates[:5]
        for source in schema.candidate_sources(candidate)
    }
    if len(top_sources) <= 1 and len(candidates) >= 3:
        warnings.append("Top evidence is highly concentrated in one source.")
    if errors_by_source:
        warnings.append(f"Some sources failed: {', '.join(sorted(errors_by_source))}")
    if degraded_by_source:
        # Partial failures: the source returned some items but errored/timed out
        # on at least one subquery, so its coverage is likely incomplete. Kept
        # distinct from hard failures so the signal is not silently dropped.
        warnings.append(
            f"Some sources returned partial results (degraded): {', '.join(sorted(degraded_by_source))}"
        )
    if not items_by_source:
        warnings.append("No source returned usable items.")
    return warnings


def _is_rate_limit_error(exc: Exception) -> bool:
    """Detect 429 rate-limit errors by status code or message text."""
    if hasattr(exc, "status_code") and getattr(exc, "status_code", None) == 429:
        return True
    return "429" in str(exc)


class SourceRunError(RuntimeError):
    """Source-specific failure that survived a module's fallback logic."""

    def __init__(self, message: str, state: schema.RunOutcomeState | None = None):
        super().__init__(message)
        self.outcome_state = state or http.classify_failure(message=message)


def _classify_source_failure(exc: Exception) -> tuple[schema.RunOutcomeState, bool]:
    """Classify HTTP, subprocess, and module-specific failures consistently."""
    detail = str(exc)
    lowered = detail.lower()
    if any(marker in lowered for marker in ("not configured", "no api key", "not installed")):
        return schema.SKIPPED_UNCONFIGURED, False
    if any(
        marker in lowered
        for marker in (
            "cookie expired",
            "expired cookie",
            "login required",
            "not logged in",
            "grok session expired",
            "session expired or was revoked",
            "invalid_grant",
            "not signed in",
        )
    ):
        return schema.AUTH_FAILED, True
    state = getattr(exc, "outcome_state", None) or http.classify_failure(
        status_code=getattr(exc, "status_code", None),
        message=detail,
    )
    return state, True


def _outcome_artifact(
    state: schema.RunOutcomeState,
    detail: str,
    *,
    attempted: bool = True,
) -> dict[str, Any]:
    return {
        "_source_outcome": {
            "state": state,
            "detail": detail,
            "attempted": attempted,
        }
    }


def _classify_reddit_failure(detail: str) -> str:
    """Map Reddit anti-bot responses that do not carry an HTTP status.

    SLIM: copied from the deleted keyed module reddit.py (classify_run_failure).
    """
    text = detail.lower()
    if any(marker in text for marker in ("interstitial", "blocked by reddit", "too many requests")):
        return health.RATE_LIMITED
    if any(marker in text for marker in ("login required", "invalid token", "expired token")):
        return health.AUTH_FAILED
    return http.classify_failure(message=detail)


def _result_outcome_artifact(source: str, result: Any) -> dict[str, Any]:
    """Convert a legacy {"error": ...} source result into typed status."""
    if not isinstance(result, dict) or not result.get("error"):
        return {}
    detail = str(result["error"])
    if source == "reddit":
        state = _classify_reddit_failure(detail)
        attempted = True
    else:
        state, attempted = _classify_source_failure(SourceRunError(detail))
    return _outcome_artifact(state, detail, attempted=attempted)


def _legacy_artifact_outcome(
    source: str,
    artifact: Any,
) -> dict[str, Any] | None:
    """Map known pre-outcome artifact contracts to a typed outcome note."""
    if not isinstance(artifact, dict):
        return None
    explicit = artifact.get("_source_outcome")
    if isinstance(explicit, dict):
        return explicit
    # SLIM: perplexity / grounding legacy artifact contracts removed.
    return None


def _summarize_lane_failures(failures: list[http.HTTPError], source: str = "") -> str:
    """One line naming what a source lost to swallowed sub-request failures.

    ``"3 sub-requests rate-limited (HTTP 429); 1 sub-request blocked (HTTP 403)"``.
    Used as ``SourceOutcome.detail`` on a source that still delivered items,
    so the loss is visible to ``doctor --postmortem`` without branding the
    source partial (issue #985 wording; PR #959 semantics).
    """
    counts: dict[tuple[str, int | None], int] = {}
    for failure in failures:
        state = getattr(failure, "outcome_state", None) or health.ERROR
        code = getattr(failure, "status_code", None)
        counts[(state, code)] = counts.get((state, code), 0) + 1
    labels = {
        health.RATE_LIMITED: "rate-limited",
        health.AUTH_FAILED: "blocked",
        health.PAYMENT_REQUIRED: health.credits_exhausted_label(source),
        health.TIMEOUT: "timed out",
        health.UNREACHABLE: "unreachable",
        health.SCHEMA_DRIFT: "returned an unexpected shape",
    }
    parts = []
    for (state, code), n in sorted(counts.items(), key=lambda kv: -kv[1]):
        noun = "sub-request" if n == 1 else "sub-requests"
        label = labels.get(state, "failed")
        suffix = f" (HTTP {code})" if code else ""
        parts.append(f"{n} {noun} {label}{suffix}")
    return "; ".join(parts)


def _resolve_stream_outcome(
    source: str,
    artifact: Any,
    failures: list[http.HTTPError],
) -> dict[str, Any] | None:
    """Choose the most specific artifact or captured HTTP outcome."""
    artifact_outcome = _legacy_artifact_outcome(source, artifact)
    if not failures:
        return artifact_outcome
    # Pick the most specific failure rather than the last-appended one:
    # parallel workers append in nondeterministic order, and an auth failure
    # must not be masked by a later 429 (wrong doctor prescription).
    failure = min(
        failures,
        key=lambda f: _FAILURE_SPECIFICITY.get(f.outcome_state, 9),
    )
    captured_outcome = _outcome_artifact(
        failure.outcome_state,
        str(failure),
    )["_source_outcome"]
    if artifact_outcome is None:
        return captured_outcome
    if (
        artifact_outcome.get("state") == health.ERROR
        and failure.outcome_state != health.ERROR
    ):
        return captured_outcome
    return artifact_outcome


def _finalize_source_status(
    outcomes: dict[str, schema.SourceOutcome],
    items_by_source: dict[str, list[schema.SourceItem]],
) -> dict[str, schema.SourceOutcome]:
    """Sync outcome counts to the final post-filter evidence set."""
    finalized: dict[str, schema.SourceOutcome] = {}
    for source, outcome in outcomes.items():
        count = len(items_by_source.get(source, []))
        state = outcome.state
        detail = outcome.detail
        fix_hint = outcome.fix_hint
        if state == schema.NO_RESULTS and count:
            state = health.OK
            detail = None
            fix_hint = None
        elif state == health.OK and not count:
            state = outcome.lane_failure_state or schema.NO_RESULTS
        elif state == schema.PARTIAL and not count:
            state = http.classify_failure(message=detail or "")
        finalized[source] = schema.SourceOutcome(
            source=source,
            state=state,
            items_returned=count,
            attempted=outcome.attempted,
            detail=detail,
            at=outcome.at,
            fix_hint=fix_hint,
            lane_failure_state=outcome.lane_failure_state,
        )
    return finalized


def _is_transient_error(exc: Exception) -> bool:
    """Detect 5xx server errors that are worth retrying."""
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and 500 <= status < 600:
        return True
    msg = str(exc)
    return any(code in msg for code in ("500", "502", "503", "504"))


# SLIM: removed _topic_handle_mentions (X-handle helper, unused)


def _topic_first_party_candidates(topic: str) -> set[str]:
    """Handle-shaped tokens in the topic itself, usable before any retrieval.

    Phase 1 runs before automatic handle resolution, and a quick-depth run
    skips that resolution entirely, so neither has access to the extracted
    handle set. Without this a quick search for "Peter Steinberger steipete"
    still drops every post steipete wrote, which is the exact failure this
    branch exists to fix.

    Deliberately permissive about what looks like a handle and strict about
    what it does: a candidate only ever matters if a retrieved post's *author*
    matches it, so an ordinary word like "lunch" costs nothing -- no author is
    named "lunch". The realistic false positive is an account named after a
    topic word, which the frequency-ranked path could surface anyway.
    """
    tokens = set()
    for mention in re.findall(r"@([A-Za-z0-9_]{1,15})", topic or ""):
        tokens.add(mention.lower())
    for word in re.findall(r"[A-Za-z0-9_]{3,15}", topic or ""):
        lowered = word.lower()
        if lowered not in relevance.STOPWORDS:
            tokens.add(lowered)
    return tokens


# SLIM: removed _name_lane_subject, _run_supplemental_searches (X-handle helper, unused;
# SLIM:   non-slim feature)


def _retry_thin_sources(
    *,
    topic: str,
    bundle: schema.RetrievalBundle,
    plan: schema.QueryPlan,
    config: dict[str, Any],
    depth: str,
    date_range: tuple[str, str],
    runtime: schema.ProviderRuntime,
    mock: bool,
    rate_limited_sources: set[str],
    rate_limit_lock: threading.Lock,
    settings: dict[str, Any],
    skip_sources: set[str] | None = None,
    subreddits: list[str] | None = None,
    first_party_handles: Iterable[str] | None = None,
    run_started: float | None = None,
) -> None:
    # SLIM: signature reduced (no web_backend / tiktok / instagram / creator args).
    """Retry sources with thin results using simplified core subject query."""
    if depth == "quick":
        return

    planned_sources: list[str] = []
    for subquery in plan.subqueries:
        for source in subquery.sources:
            if source not in planned_sources:
                planned_sources.append(source)
    _skip = set(skip_sources or set())  # SLIM: THIN_RETRY_EXEMPT removed
    thin_sources = [
        source
        for source in planned_sources
        if len(bundle.items_by_source.get(source, [])) < 3
        and source not in bundle.errors_by_source
        and source not in _skip
    ]

    if not thin_sources:
        return

    core = query.extract_core_subject(topic, max_words=3)
    if not core:
        return
    # Note: we intentionally do NOT skip when core == topic. For short topics
    # like "Kanye West", the 3-word core IS the topic — but the planner may
    # have sent a different (worse) query to the source. Retrying with the
    # raw core subject is still valuable.

    from_date, to_date = date_range

    # Create a retry subquery with the simplified core subject
    retry_subquery = schema.SubQuery(
        label="retry",
        search_query=core,
        ranking_query=f"What recent evidence from the last 30 days matters for {core}?",
        sources=thin_sources,
        weight=0.3,
    )

    def _retry_one_source(
        source: str,
    ) -> tuple[str, list[schema.SourceItem], dict[str, Any] | None]:
        raw_items, artifact = _retrieve_stream(
            topic=topic,
            subquery=retry_subquery,
            source=source,
            config=config,
            depth=depth,
            date_range=date_range,
            runtime=runtime,
            mock=mock,
            rate_limited_sources=rate_limited_sources,
            rate_limit_lock=rate_limit_lock,
            raw_topic=topic,
            subreddits=subreddits,
            run_started=run_started,
        )
        outcome_note = artifact.get("_source_outcome") if isinstance(artifact, dict) else None
        detail_note = artifact.get("_source_outcome_detail") if isinstance(artifact, dict) else None
        detail_state = artifact.get("_source_outcome_detail_state") if isinstance(artifact, dict) else None
        normalized = _normalize_score_dedupe(
            source,
            raw_items,
            from_date,
            to_date,
            freshness_mode=plan.freshness_mode,
            ranking_query=retry_subquery.ranking_query,
            first_party_handles=first_party_handles,
        )
        normalized = _apply_reddit_stream_keepers(
            source, normalized, settings["per_stream_limit"], topic
        )
        return source, normalized, outcome_note, (detail_note, detail_state)

    retryable = [s for s in thin_sources if s not in rate_limited_sources]

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=min(4, len(retryable) or 1)) as executor:
        futures = {executor.submit(_retry_one_source, s): s for s in retryable}
        for future in as_completed(futures):
            source = futures[future]
            try:
                source, normalized, outcome_note, (detail_note, detail_state) = future.result()
                if outcome_note:
                    bundle.record_failure(
                        source,
                        outcome_note["state"],
                        outcome_note["detail"],
                        attempted=outcome_note.get("attempted", True),
                    )
                if detail_note:
                    bundle.record_detail(source, detail_note, state=detail_state)
                existing_urls = {item.url for item in bundle.items_by_source.get(source, []) if item.url}
                new_items = [item for item in normalized if item.url not in existing_urls]

                if new_items:
                    primary_label = plan.subqueries[0].label if plan.subqueries else "primary"
                    bundle.add_items(primary_label, source, new_items)
            except Exception as exc:
                print(f"[Pipeline] Retry failed for {source}: {type(exc).__name__}: {exc}", file=sys.stderr)
                state, attempted = _classify_source_failure(exc)
                bundle.record_failure(
                    source,
                    state,
                    f"Simplified-query retry failed: {exc}",
                    attempted=attempted,
                )


# SLIM: removed _fetch_x_backend, _reddit_post_key, _merge_reddit_items (non-slim
# SLIM:   feature)


def _retrieve_stream(*args, **kwargs) -> tuple[list[dict], dict]:
    """Run one stream and retain HTTP failures swallowed by source adapters."""
    # SLIM: HTTP fixture record/replay removed.
    try:
        with http.capture_failures() as failures:
            items, artifact = _retrieve_stream_impl(*args, **kwargs)
    except Exception as exc:
        recorded_exc = exc
        if failures and not getattr(exc, "outcome_state", None):
            failure = failures[-1]
            recorded_exc = SourceRunError(str(exc), failure.outcome_state)
        if recorded_exc is not exc:
            raise recorded_exc from exc
        raise
    outcome_note = _resolve_stream_outcome(
        str(kwargs.get("source") or ""),
        artifact,
        failures,
    )
    if outcome_note:
        # Lane-level HTTP failures (e.g. a blocked shreddit partial on a
        # datacenter IP) are captured by the sink even when the source
        # delivered items. Only attach them when the run produced nothing,
        # or when the impl attached its own explicit outcome artifact (e.g.
        # "primary failed; fallback returned N items"). A swallowed lane
        # failure must not brand a successful source auth-failed/partial.
        # An adapter-declared outcome (typed ``_source_outcome`` or a legacy
        # ``{"error": ...}`` / per-leg artifact) is explicit and always
        # brands the source, even with items; only failures the adapter
        # swallowed into the capture sink are demoted to detail.
        explicit = isinstance(artifact, dict) and (
            bool(artifact.get("_source_outcome"))
            or _legacy_artifact_outcome(str(kwargs.get("source") or ""), artifact) is not None
        )
        if explicit or not items:
            artifact = dict(artifact or {})
            artifact["_source_outcome"] = outcome_note
        elif failures:
            # The source delivered items. Keep it ``ok`` but carry what the
            # swallowed sub-requests lost, so doctor can still show it, and
            # the most specific failure state so a later empty filter result
            # or the thin-source retry can act on it.
            # Append to any detail the impl already set (e.g. a Reddit
            # backfill note) rather than overwriting it.
            artifact = dict(artifact or {})
            summary = _summarize_lane_failures(failures, str(kwargs.get("source") or ""))
            prior = artifact.get("_source_outcome_detail")
            artifact["_source_outcome_detail"] = f"{prior}; {summary}" if prior else summary
            states = [f.outcome_state for f in failures]
            if artifact.get("_source_outcome_detail_state"):
                states.append(artifact["_source_outcome_detail_state"])
            artifact["_source_outcome_detail_state"] = min(
                states, key=lambda state: _FAILURE_SPECIFICITY.get(state, 9)
            )
    return items, artifact


# SLIM: removed _serve_envelope_topic, _serve_envelope_lanes (non-slim feature)


def _retrieve_stream_impl(
    *,
    topic: str,
    subquery: schema.SubQuery,
    source: str,
    config: dict[str, Any],
    depth: str,
    date_range: tuple[str, str],
    runtime: schema.ProviderRuntime,
    mock: bool,
    rate_limited_sources: set[str] | None = None,
    rate_limit_lock: threading.Lock | None = None,
    raw_topic: str = "",
    subreddits: list[str] | None = None,
    run_started: float | None = None,
) -> tuple[list[dict], dict]:
    # SLIM: dispatch is limited to reddit, hackernews, polymarket and github; any
    # other source is a hard error. Reddit uses the keyless public path only.
    if source not in schema.SLIM_SOURCES:
        raise RuntimeError(f"Unsupported source: {source}")
    # Early exit if source was rate-limited by a sibling future
    if rate_limited_sources is not None and source in rate_limited_sources:
        return [], {}
    from_date, to_date = date_range
    if mock:
        return _mock_stream_results(source, subquery)
    if source == "reddit":
        # Use raw_topic so expand_reddit_queries() generates diverse variants
        # from the original user topic, not the planner's narrowed search_query.
        reddit_query = raw_topic or subquery.search_query
        dedicated_subreddits = config.get("_dedicated_subreddits") or None
        try:
            public_results = reddit_public.search_reddit_public(
                reddit_query, from_date, to_date, depth=depth,
                subreddits=subreddits, dedicated_subreddits=dedicated_subreddits,
            ) or []
        except Exception as exc:
            sys.stderr.write(f"[Reddit] Public search failed ({type(exc).__name__}: {exc})\n")
            state, _attempted = _classify_source_failure(exc)
            raise SourceRunError(f"Reddit public search failed: {exc}", state) from exc
        return public_results, {}
    if source == "hackernews":
        result = hackernews.search_hackernews(subquery.search_query, from_date, to_date, depth=depth)
        return (
            hackernews.parse_hackernews_response(result, query=subquery.search_query),
            _result_outcome_artifact(source, result),
        )
    if source == "polymarket":
        result = polymarket.search_polymarket(subquery.search_query, from_date, to_date, depth=depth)
        # Relevance filtering keys off the stable original research topic, not the
        # per-subquery search_query (which narrows differently on each fanout pass
        # and would let off-topic markets through on broad subqueries while dropping
        # everything on narrow ones).
        relevance_topic = raw_topic or topic or subquery.search_query
        return (
            polymarket.parse_polymarket_response(result, topic=relevance_topic),
            _result_outcome_artifact(source, result),
        )
    if source == "github":
        # Resolve once at the pipeline boundary so search and enrich share the result.
        token = github.resolve_token(config.get("GITHUB_TOKEN"))
        response = github.search_github(subquery.search_query, from_date, to_date, depth=depth, token=token)
        items = github.parse_github_response(response)
        # Note: an unauth rate-limit (response["error"]) is expected on the
        # tokenless anon tier and returns empty here rather than raising.
        items = github.enrich_with_comments(items, depth=depth, token=token)
        return items, _result_outcome_artifact(source, response)
    raise RuntimeError(f"Unsupported source: {source}")


# SLIM: removed _google_key (non-slim feature)


def _mock_stream_results(source: str, subquery: schema.SubQuery) -> tuple[list[dict], dict]:
    # Namespace URLs and the canned comment by topic: real runs never hand two
    # distinct stories byte-identical evidence, and discovery's same-story fold
    # (correctly) collapses topics that share it. Mock enrichment sub-runs feed
    # this fixture one topic per subquery, so the slug keeps them distinct.
    slug = re.sub(r"[^a-z0-9]+", "-", subquery.search_query.lower()).strip("-") or "topic"
    payloads = {
        "reddit": [
            {
                "id": "R1",
                "title": f"{subquery.search_query} discussion thread",
                "url": f"https://reddit.com/r/example/comments/{slug}-1",
                "subreddit": "example",
                "date": dates.get_date_range(5)[0],
                "engagement": {"score": 120, "num_comments": 48, "upvote_ratio": 0.91},
                "selftext": f"Community discussion about {subquery.search_query}.",
                "top_comments": [{"excerpt": f"Strong firsthand feedback from {subquery.search_query} users."}],
                "relevance": 0.82,
                "why_relevant": "Mock Reddit result",
            }
        ],
        # SLIM: mock payloads for the removed sources deleted; only reddit remains.
    }
    return payloads.get(source, []), {}
