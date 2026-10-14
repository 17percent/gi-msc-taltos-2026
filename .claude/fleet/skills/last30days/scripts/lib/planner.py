"""LLM-first query planning with deterministic guards for risky queries."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

from . import categories, entity_extract, log, query, relevance, schema

# SLIM: competitors.py (keyed web-search discovery) was removed; this constant was
# competitors.COMPETITORS_MAX + 1.
COMPARISON_ENTITY_MAX = 7

# Hebrew Unicode block: U+0590–U+05FF
_HEBREW_RE = re.compile(r'[\u0590-\u05FF]')

# SLIM: DISCOVERY_SOURCE_ORDER / build_discovery_plan removed (discovery mode was removed).


def detect_language(text: str) -> str | None:
    """Return 'he' if the text contains Hebrew characters, else None."""
    return 'he' if _HEBREW_RE.search(text) else None


ALLOWED_INTENTS = {
    "factual",
    "product",
    "concept",
    "opinion",
    "how_to",
    "comparison",
    "breaking_news",
    "prediction",
}
ALLOWED_CLUSTER_MODES = {"none", "story", "workflow", "market", "debate"}

# SLIM: the priority/capability tables below are restricted to the four slim sources.
QUICK_SOURCE_PRIORITY = {
    "factual": ["hackernews", "reddit"],
    "product": ["reddit", "hackernews"],
    "concept": ["hackernews", "reddit"],
    "opinion": ["reddit", "hackernews"],
    "how_to": ["reddit", "hackernews"],
    "comparison": ["reddit", "hackernews"],
    "breaking_news": ["reddit", "hackernews", "polymarket"],
    "prediction": ["polymarket", "hackernews", "reddit"],
}
SOURCE_PRIORITY = {
    "factual": ["hackernews", "reddit"],
    "product": ["reddit", "hackernews"],
    "concept": ["hackernews", "reddit"],
    "opinion": ["reddit", "hackernews"],
    "how_to": ["reddit", "hackernews"],
    "comparison": ["reddit", "hackernews"],
    "breaking_news": ["reddit", "hackernews", "polymarket"],
    "prediction": ["polymarket", "hackernews", "reddit"],
}
SOURCE_LIMITS = {
    "quick": {
        "factual": 2,
        "product": 2,
        "concept": 2,
        "opinion": 2,
        "how_to": 2,
        "comparison": 2,
        "breaking_news": 2,
        "prediction": 2,
    },
    # "default" intentionally absent: all available sources are searched
    # at default depth. Fusion and reranking handle quality. quick mode
    # uses tight budgets above for latency.
}
INTENT_SOURCE_EXCLUSIONS: dict[str, set[str]] = {
    "concept": {"polymarket"},
    "how_to": {"polymarket"},
}
SOURCE_CAPABILITIES = {
    "reddit": {"discussion", "social"},
    "hackernews": {"discussion", "link"},
    "polymarket": {"market"},
    "github": {"discussion", "link"},
}


def _unsupported_source_message(source: object) -> str:
    return (
        f"unsupported source {source!r}: this slim build only supports "
        + ", ".join(schema.SLIM_SOURCES)
    )


def validate_external_plan(raw: dict) -> None:
    """Validate explicit-plan structure before permissive sanitization.

    Enum-like metadata stays permissive because direct pipeline callers rely on
    the sanitizer to canonicalize those values.
    """
    if not isinstance(raw, dict):
        raise ValueError("top-level plan must be an object")
    for field in ("intent", "freshness_mode", "cluster_mode", "subqueries"):
        if field not in raw:
            raise ValueError(f"missing required field '{field}'")
    for field in ("intent", "freshness_mode", "cluster_mode"):
        if not isinstance(raw[field], str) or not raw[field].strip():
            raise ValueError(f"field '{field}' must be a non-empty string")

    source_weights = raw.get("source_weights")
    if source_weights is not None and not isinstance(source_weights, dict):
        raise ValueError("field 'source_weights' must be an object when provided")
    for source, weight in (source_weights or {}).items():
        if (
            not isinstance(source, str)
            or not source.strip()
            or isinstance(weight, bool)
            or not isinstance(weight, (int, float))
        ):
            raise ValueError("field 'source_weights' must map source names to numbers")
    # SLIM: a plan naming any source outside the slim set is a hard error.
    for source in (source_weights or {}):
        if source not in schema.SLIM_SOURCES:
            raise ValueError(_unsupported_source_message(source))
    subqueries = raw["subqueries"]
    if not isinstance(subqueries, list) or not subqueries:
        raise ValueError("field 'subqueries' must be a non-empty array")
    for index, subquery in enumerate(subqueries):
        if not isinstance(subquery, dict):
            raise ValueError(f"subqueries[{index}] must be an object")
        for field in ("search_query", "ranking_query"):
            if not isinstance(subquery.get(field), str) or not subquery[field].strip():
                raise ValueError(f"subqueries[{index}].{field} must be a non-empty string")
        sources = subquery.get("sources")
        if not isinstance(sources, list) or not sources or not all(
            isinstance(source, str) and source.strip() for source in sources
        ):
            raise ValueError(f"subqueries[{index}].sources must be a non-empty string array")
        for source in sources:
            if source not in schema.SLIM_SOURCES:
                raise ValueError(_unsupported_source_message(source))
        weight = subquery.get("weight")
        if weight is not None and (
            isinstance(weight, bool) or not isinstance(weight, (int, float))
        ):
            raise ValueError(f"subqueries[{index}].weight must be a number when provided")


DEFAULT_INTENT_CAPABILITIES = {
    "comparison": {"discussion", "video", "web", "reference", "social", "link", "market"},
    "how_to": {"discussion", "video", "web", "reference", "link"},
}


# SLIM: DrillTargetError / resolve_drill_clusters / build_drill_plan removed (drill mode was removed).


def plan_query(
    *,
    topic: str,
    available_sources: list[str],
    requested_sources: list[str] | None,
    depth: str,
    provider: object | None,  # SLIM: always None (providers.py, the keyed LLM clients, was removed)
    model: str | None,
    context: str = "",
    internal_subrun: bool = False,
) -> schema.QueryPlan:
    """Create a query plan. Comparison queries with extractable entities use a
    deterministic plan; other intents prefer the configured reasoning provider.

    internal_subrun: when True, suppress the LAW 7 "No --plan passed" stderr
    warning. LAW 7 targets the hosting-reasoning-model path; competitor
    fan-out sub-runs are engine-internal and the warning is a false positive
    there. Default False preserves the warning on every user-facing invocation.
    """
    if _should_force_deterministic_plan(topic):
        return _fallback_plan(
            topic,
            available_sources,
            requested_sources,
            depth,
            note="deterministic-comparison-plan",
        )
    # SLIM: the engine-internal LLM planner branch (provider.generate_json) was removed with providers.py.
    # No --plan was passed and no engine-internal provider is configured.
    # The deterministic fallback path produces weaker plans than either the
    # --plan path or the engine-internal LLM planner path. Surface this so
    # the HOSTING reasoning model (Claude Code, Codex, Hermes, Gemini, etc.)
    # realizes it is supposed to generate the plan itself and pass --plan.
    # The word "provider" in engine messages refers to the engine's INTERNAL
    # planner credentials - NOT a prerequisite the caller needs. If you are
    # the hosting reasoning model, YOU are the provider. LAW 7 / 2026-04-19
    # Hermes Agent Use Cases failure mode.
    if not internal_subrun:
        import sys
        print(
            "[Planner] No --plan passed. If you are the reasoning model hosting "
            "this skill (Claude Code, Codex, Hermes, Gemini, or any agent runtime), "
            "YOU ARE the planner: generate a JSON query plan yourself and pass it "
            "via --plan. You do not need an API key or credentials; you ARE the "
            "LLM. The deterministic fallback below is the headless/cron path only. "
            "See the 'Query plan' section of SKILL.md for the plan schema.",  # SLIM: wording
            file=sys.stderr,
        )
    return _fallback_plan(topic, available_sources, requested_sources, depth)


# SLIM: _build_prompt (LLM planner prompt) removed.


def _sanitize_plan(
    raw: dict,
    topic: str,
    available_sources: list[str],
    requested_sources: list[str] | None,
    depth: str,
    *,
    honor_plan_sources: bool = False,
) -> schema.QueryPlan:
    intent_hint = str(raw.get("intent") or _infer_intent(topic)).strip()
    if intent_hint not in ALLOWED_INTENTS:
        intent_hint = _infer_intent(topic)
    requested = set(requested_sources or [])
    available = set(available_sources)
    eligible_sources = [
        source for source in available_sources
        if (not requested or source in requested)
    ]
    source_weights = {
        source: float(weight)
        for source, weight in (raw.get("source_weights") or {}).items()
        if source in available
    }
    if requested:
        source_weights = {source: weight for source, weight in source_weights.items() if source in requested}
    if not source_weights:
        source_weights = _default_source_weights(_infer_intent(topic), eligible_sources)
    # Ensure all eligible sources are available for subqueries. The LLM may
    # assign high weights to its preferred sources, but omitted sources still
    # participate with base weight so retrieval can overfetch and let fusion
    # decide quality.
    for source in eligible_sources:
        source_weights.setdefault(source, 1.0)
    if intent_hint in DEFAULT_INTENT_CAPABILITIES and depth != "quick":
        for source in _default_sources_for_intent(intent_hint, eligible_sources):
            source_weights.setdefault(source, 1.0)
    source_weights = _normalize_weights(source_weights)

    subqueries: list[schema.SubQuery] = []
    for index, subquery in enumerate((raw.get("subqueries") or [])[:_max_subqueries(intent_hint, topic)], start=1):
        if not isinstance(subquery, dict):
            continue
        sources = [source for source in subquery.get("sources") or [] if source in source_weights]
        if requested:
            sources = [source for source in sources if source in requested]
        if not sources:
            if honor_plan_sources:
                label = str(subquery.get("label") or f"q{index}")
                log.source_log(
                    "Planner",
                    f"Skipping external-plan subquery {label}: none of its planned "
                    "sources are available under the current source configuration.",
                    tty_only=False,
                )
                continue
            sources = list(source_weights)
        search_query = str(subquery.get("search_query") or "").strip()
        ranking_query = str(subquery.get("ranking_query") or "").strip()
        if not search_query or not ranking_query:
            continue
        subqueries.append(
            schema.SubQuery(
                label=str(subquery.get("label") or f"q{index}").strip() or f"q{index}",
                search_query=search_query,
                ranking_query=ranking_query,
                sources=sources,
                weight=max(0.05, float(subquery.get("weight") or 1.0)),
            )
        )
    if depth == "quick" and subqueries:
        subqueries = subqueries[:1]
    if not subqueries:
        if honor_plan_sources:
            raise ValueError(
                "No available planned sources remain. Enable a source named in "
                "--plan or revise the plan/source configuration; no retrieval was started."
            )
        return _fallback_plan(topic, available_sources, requested_sources, depth)

    intent = intent_hint
    freshness_mode = str(raw.get("freshness_mode") or _default_freshness(intent)).strip()
    if intent == "how_to":
        freshness_mode = "evergreen_ok"
    cluster_mode = str(raw.get("cluster_mode") or _default_cluster_mode(intent)).strip()
    if cluster_mode not in ALLOWED_CLUSTER_MODES:
        cluster_mode = _default_cluster_mode(intent)

    return schema.QueryPlan(
        intent=intent,
        freshness_mode=freshness_mode,
        cluster_mode=cluster_mode,
        raw_topic=topic,
        subqueries=_normalize_subquery_weights(
            _trim_subqueries_for_depth(
                subqueries,
                intent,
                depth,
                eligible_sources,
                requested_sources=requested_sources,
                honor_plan_sources=honor_plan_sources,
            )
        ),
        source_weights=source_weights,
        notes=[str(note).strip() for note in raw.get("notes") or [] if str(note).strip()],
    )


def _normalize_subquery_weights(subqueries: list[schema.SubQuery]) -> list[schema.SubQuery]:
    total = sum(subquery.weight for subquery in subqueries) or 1.0
    return [
        schema.SubQuery(
            label=subquery.label,
            search_query=subquery.search_query,
            ranking_query=subquery.ranking_query,
            sources=subquery.sources,
            weight=subquery.weight / total,
        )
        for subquery in subqueries
    ]


def _normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    total = sum(max(weight, 0.0) for weight in weights.values()) or 1.0
    return {
        source: max(weight, 0.0) / total
        for source, weight in weights.items()
    }


def _trim_subqueries_for_depth(
    subqueries: list[schema.SubQuery],
    intent: str,
    depth: str,
    available_sources: list[str],
    requested_sources: list[str] | None = None,
    honor_plan_sources: bool = False,
) -> list[schema.SubQuery]:
    # At non-quick depth, expand sources: use capability routing for intents
    # that define it, or all available sources otherwise. The LLM planner may
    # assign narrow source lists; we override to let fusion decide quality.
    # Operator-supplied --plan is a contract: keep per-subquery sources.
    if depth != "quick" and not honor_plan_sources:
        expanded_sources = _default_sources_for_intent(intent, available_sources)
        return [
            schema.SubQuery(
                label=subquery.label,
                search_query=subquery.search_query,
                ranking_query=subquery.ranking_query,
                sources=expanded_sources,
                weight=subquery.weight,
            )
            for subquery in subqueries
        ]
    limits = SOURCE_LIMITS.get(depth)
    if not limits:
        return subqueries
    priority_table = QUICK_SOURCE_PRIORITY
    priority = priority_table.get(intent, priority_table["breaking_news"])
    limit = limits.get(intent, 3)
    ranked_sources = [source for source in priority if source in available_sources]
    if not ranked_sources:
        ranked_sources = list(available_sources)
    trimmed = []
    for subquery in subqueries:
        # Quick depth only reaches this block. Honor the plan's explicit
        # per-subquery sources: prefer priority-ranked plan sources first, then
        # append any plan sources absent from the priority table (e.g.
        # instagram). Explicit --search sources are user overrides, so they get
        # first claim on the quick slots when present. The final list remains
        # capped to the quick-depth limit.
        plan_sources = [s for s in ranked_sources if s in subquery.sources]
        for source in subquery.sources:
            if source not in plan_sources:
                plan_sources.append(source)
        if not plan_sources:
            plan_sources = ranked_sources[:limit]
        preferred_sources: list[str] = []
        if requested_sources:
            for source in requested_sources:
                if (
                    source in available_sources
                    and source in subquery.sources
                    and source not in preferred_sources
                ):
                    preferred_sources.append(source)
                    if len(preferred_sources) >= limit:
                        break
        for source in plan_sources:
            if len(preferred_sources) >= limit:
                break
            if source not in preferred_sources:
                preferred_sources.append(source)
        trimmed.append(
            schema.SubQuery(
                label=subquery.label,
                search_query=subquery.search_query,
                ranking_query=subquery.ranking_query,
                sources=preferred_sources,
                weight=subquery.weight,
            )
        )
    return trimmed


def _fallback_plan(
    topic: str,
    available_sources: list[str],
    requested_sources: list[str] | None,
    depth: str,
    note: str = "fallback-plan",
) -> schema.QueryPlan:
    intent = _infer_intent(topic)
    # SLIM: Hebrew web-search (grounding) elevation removed (no web-search source).
    allowed_sources = requested_sources or available_sources
    source_weights = _default_source_weights(intent, allowed_sources)
    core = query.extract_core_subject(topic, max_words=6, strip_suffixes=True)
    base_search = _keyword_query(topic, core)
    base_ranking = _ranking_query(topic, core)

    subqueries = [schema.SubQuery(
        label="primary",
        search_query=base_search,
        ranking_query=base_ranking,
        sources=list(source_weights),
        weight=1.0,
    )]

    if depth != "quick" and intent == "comparison":
        entities = _comparison_entities(topic)
        if entities:
            for index, entity in enumerate(entities, start=1):
                subqueries.append(
                    schema.SubQuery(
                        label=f"entity-{index}",
                        search_query=entity,
                        ranking_query=f"What recent evidence from the last 30 days is most relevant to {entity} in the comparison '{topic}'?",
                        sources=list(source_weights),
                        weight=0.65,
                    )
                )
    elif depth != "quick" and intent == "prediction":
        subqueries.append(
            schema.SubQuery(
                label="odds",
                search_query=f"{base_search} odds forecast",
                ranking_query=f"What are the current odds, forecasts, or market signals about {topic}?",
                sources=[source for source in source_weights if source in {"polymarket", "reddit"}] or list(source_weights),
                weight=0.7,
            )
        )
    elif depth != "quick" and intent == "breaking_news":
        subqueries.append(
            schema.SubQuery(
                label="reaction",
                search_query=f"{base_search} reaction update",
                ranking_query=f"What new reactions or follow-up reporting from the last 30 days matter for {topic}?",
                sources=[source for source in source_weights if source in {"reddit", "hackernews"}] or list(source_weights),
                weight=0.7,
            )
        )

    # Intent-modifier fanout: when topic contains a phrase like "use cases",
    # "workflows", "examples", "review" (see _INTENT_MODIFIER_PATTERNS),
    # paraphrase the intent across 3 extra subqueries rather than echoing
    # the literal phrase. Fixes 2026-04-19 Hermes Agent Use Cases failure.
    # Excluded for comparison/prediction since those already have dedicated
    # fanout (entity-per-subquery / odds).
    if depth != "quick" and intent not in {"comparison", "prediction"} and _has_intent_modifier(topic):
        subqueries.extend(_intent_modifier_subqueries(topic, core, base_search, source_weights))

    return schema.QueryPlan(
        intent=intent,
        freshness_mode=_default_freshness(intent),
        cluster_mode=_default_cluster_mode(intent),
        raw_topic=topic,
        subqueries=_normalize_subquery_weights(
            _trim_subqueries_for_depth(
                subqueries[:_max_subqueries(intent, topic)],
                intent,
                depth,
                list(source_weights),
                requested_sources=requested_sources,
            )
        ),
        source_weights=_normalize_weights(source_weights),
        notes=[note],
    )


def _infer_intent(topic: str) -> str:
    text = topic.lower().strip()
    if re.search(r"\b(vs|versus|compare|compared to|difference between)\b", text):
        return "comparison"
    # Slash-separated proper nouns: "React/Vue/Svelte" (not URLs, not acronyms like CI/CD or I/O)
    if not re.search(r"https?://", topic) and re.search(r"\b[A-Z][a-z]{2,}(?:/[A-Z][a-z]{2,})+\b", topic):
        return "comparison"
    if re.search(r"\b(odds|predict|prediction|forecast|chance|probability|will .* win)\b", text):
        return "prediction"
    if re.search(r"\b(how to|tutorial|guide|setup|step by step|deploy|install)\b", text):
        return "how_to"
    if re.search(r"\b(what is|what are|who is|who acquired|when did|parameter count|release date)\b", text):
        return "factual"
    if re.search(r"\b(thoughts on|worth it|should i|opinion|review)\b", text):
        return "opinion"
    if re.search(r"\b(latest|news|announced|just shipped|launched|released|update)\b", text):
        return "breaking_news"
    if re.search(r"\b(pricing|feature|features|best .* for|top .* for)\b", text):
        return "product"
    if re.search(r"\b(explain|concept|protocol|architecture|what does)\b", text):
        return "concept"
    if re.search(r"\b(tournament|championship|playoffs|march madness|world cup|olympics|super bowl|final four|ceremony|awards|keynote)\b", text):
        return "breaking_news"
    # Recency signals take priority when nothing more specific matched.
    if re.search(r"\b(trending|this week|right now|today|this month)\b", text):
        return "breaking_news"
    # Default changed from "breaking_news" to "concept" on 2026-04-19 after
    # the Hermes Agent Use Cases failure: unclassified topics were getting
    # strict_recent freshness, which over-weighted the last 7 days and
    # under-weighted older relevant material. "concept" defaults to
    # evergreen_ok freshness, a safer posture for unknown topics.
    return "concept"


def _default_freshness(intent: str) -> str:
    if intent in {"breaking_news", "prediction"}:
        return "strict_recent"
    if intent in {"concept", "how_to"}:
        return "evergreen_ok"
    return "balanced_recent"


def _default_cluster_mode(intent: str) -> str:
    return {
        "breaking_news": "story",
        "comparison": "debate",
        "opinion": "debate",
        "prediction": "market",
        "how_to": "workflow",
        "factual": "none",
        "product": "none",
        "concept": "none",
    }.get(intent, "none")


def _default_source_weights(intent: str, sources: list[str]) -> dict[str, float]:
    base = {source: 1.0 for source in sources}
    if intent == "prediction":
        for source, bonus in {"polymarket": 2.5}.items():
            if source in base:
                base[source] += bonus
    elif intent == "breaking_news":
        for source, bonus in {"reddit": 1.3, "hackernews": 0.8}.items():
            if source in base:
                base[source] += bonus
    elif intent == "how_to":
        for source, bonus in {"hackernews": 0.8}.items():
            if source in base:
                base[source] += bonus
    elif intent == "factual":
        for source, bonus in {"reddit": 0.8}.items():
            if source in base:
                base[source] += bonus
    elif intent == "product":
        for source, bonus in {}.items():
            if source in base:
                base[source] += bonus
    return base


def _keyword_query(topic: str, core: str) -> str:
    """Build a search_query string for the deterministic fallback.

    Quote ONLY title-cased multi-word proper nouns ("Hermes Agent",
    "Claude Code", "Nous Research") so platform search engines preserve the
    name as a phrase. Hyphenated compounds and lowercase terms are left as
    bare keywords, which broadens retrieval instead of narrowing it.

    Prior behavior quoted the entire compound including the user's typed
    topic, producing searches like `"Hermes Agent Actual Use Cases" hermes agent actual`
    that returned near-zero matches on X and Reddit because nobody posts
    that exact phrase. See 2026-04-19 Hermes Agent Use Cases failure.
    """
    compounds = query.extract_compound_terms(topic)
    # Only quote title-cased proper nouns (multi-word names). Hyphenated
    # compounds go unquoted so platform tokenizers can split and match.
    title_cased = [
        term for term in compounds
        if re.match(r"^(?:[A-Z][a-z]+\s+){1,}[A-Z][a-z]+$", term)
    ]
    selected = title_cased[:2]
    quoted = " ".join(f'"{term}"' for term in selected)
    remainder = core.strip() or topic.strip()
    # Drop words already carried by a quoted phrase. Emitting both produced
    # '"Peter Steinberger" peter steinberger steipete', which reads to a
    # provider as the phrase AND each of its words again -- strictly narrower
    # than the phrase alone, and on X it degraded to a bare token conjunction
    # once the quotes were stripped downstream. Distinct tokens (here
    # "steipete") are preserved.
    if selected and remainder:
        phrase_words = {
            word.lower()
            for term in selected
            for word in term.split()
        }
        remainder = " ".join(
            word for word in remainder.split()
            if word.strip('"').lower() not in phrase_words
        )
    keywords = [quoted.strip(), remainder.strip()]
    return " ".join(part for part in keywords if part).strip()


def _ranking_query(topic: str, core: str) -> str:
    if topic.strip().endswith("?"):
        return topic.strip()
    if core and core.lower() != topic.lower():
        return f"What recent evidence from the last 30 days is most relevant to {topic}, especially about {core}?"
    return f"What recent evidence from the last 30 days is most relevant to {topic}?"


_TRAILING_CONTEXT = re.compile(
    r"\s+\b(?:for|in|on|at|to|with|about|from|by|during|since|after|before|using|via)\b.*$",
    re.I,
)


def _comparison_entities(topic: str, *, uncapped: bool = False) -> list[str]:
    """Split a comparison topic into entity names.

    Caps at ``COMPARISON_ENTITY_MAX`` unless ``uncapped`` (caller
    truncates and may warn about dropped entities).
    """
    # "difference between X and Y" -> "X vs Y" (replace "and" only in this context)
    normalized = re.sub(
        r"\bdifference between\s+(.+?)\s+and\s+",
        r"\1 vs ",
        topic,
        flags=re.I,
    )
    normalized = re.sub(r"\b(compared to)\b", " vs ", normalized, flags=re.I)
    parts = [
        part.strip(" \t\r\n?.,:;!()[]{}\"'")
        for part in re.split(r"\bvs\.?\b|\bversus\b|/", normalized, flags=re.I)
        if part.strip(" \t\r\n?.,:;!()[]{}\"'")
    ]
    # Strip trailing context from parts ("Svelte for frontend in 2026" -> "Svelte")
    if len(parts) < 2:
        return []
    parts = [_TRAILING_CONTEXT.sub("", part).strip() or part for part in parts]
    deduped: list[str] = []
    for part in parts:
        if part and part not in deduped:
            deduped.append(part)
    if uncapped:
        return deduped
    return deduped[: COMPARISON_ENTITY_MAX]


def _should_force_deterministic_plan(topic: str) -> bool:
    return _infer_intent(topic) == "comparison" and len(_comparison_entities(topic)) >= 2


_INTENT_MODIFIER_PATTERNS = (
    "use cases", "use case", "workflows", "workflow",
    "examples", "example", "tutorial", "tutorials",
    "review", "reviews", "comparison", "applications",
    "in practice", "production use", "production",
    "how i use",
)


def _has_intent_modifier(topic: str) -> bool:
    """Return True if the topic contains an intent modifier phrase.

    See 2026-04-19 Hermes Agent Use Cases failure: a literal "Hermes Agent
    use cases" search returns near-zero matches because nobody posts that
    exact phrase. Intent modifiers should be stripped from search_query
    and paraphrased across multiple subqueries.
    """
    text = topic.lower()
    return any(pattern in text for pattern in _INTENT_MODIFIER_PATTERNS)


def _intent_modifier_subqueries(
    topic: str,
    core: str,
    base_search: str,
    source_weights: dict[str, float],
) -> list[schema.SubQuery]:
    """Produce paraphrased subqueries for intent-modifier topics.

    The deterministic fallback used to echo the user's literal phrase
    (e.g., "hermes agent use cases") into every search_query. This helper
    fans out 3 extra subqueries that each express the intent differently
    so retrieval pulls a broader corpus for reranking.
    """
    entity = core or topic.strip()
    sources = list(source_weights)
    return [
        schema.SubQuery(
            label="workflows",
            search_query=f"{entity} workflow pipeline",
            ranking_query=f"What real-world workflows or pipelines are people running with {entity}?",
            sources=sources,
            weight=0.6,
        ),
        schema.SubQuery(
            label="production",
            search_query=f"{entity} production real-world",
            ranking_query=f"What production deployments or real-world use cases of {entity} are people describing?",
            sources=sources,
            weight=0.55,
        ),
        schema.SubQuery(
            label="experience",
            search_query=f"{entity} experience review",
            ranking_query=f"What hands-on experience reports or reviews of {entity} exist in the last 30 days?",
            sources=sources,
            weight=0.5,
        ),
    ]


def _max_subqueries(intent: str, topic: str | None = None) -> int:
    # how_to/opinion/product/breaking_news/prediction benefit from 4-5
    # paraphrased subqueries when the topic carries an intent modifier
    # (use cases, workflows, examples, review, etc.). See 2026-04-19
    # Hermes Agent Use Cases failure: prior cap of 3 produced near-literal
    # echoes of the topic instead of a paraphrase fanout.
    if intent == "comparison":
        # primary + one dedicated subquery per entity (up to COMPARISON_ENTITY_MAX)
        return COMPARISON_ENTITY_MAX + 1
    # Intent-modifier topics get headroom for paraphrase fanout even when
    # the intent itself is factual/concept. Without this, a "Hermes Agent
    # use cases" query (classified "concept" after the 2026-04-19 default
    # change) would be capped at 2 and drop the fanout.
    if topic and _has_intent_modifier(topic):
        return 5
    if intent in {"factual", "concept"}:
        return 2
    return 5


def _default_sources_for_intent(intent: str, available_sources: list[str]) -> list[str]:
    if intent == "how_to":
        sources = _how_to_sources(available_sources)
    else:
        target_capabilities = DEFAULT_INTENT_CAPABILITIES.get(intent)
        if not target_capabilities:
            sources = list(available_sources)
        else:
            matched = [
                source
                for source in available_sources
                if SOURCE_CAPABILITIES.get(source, set()) & target_capabilities
            ]
            sources = matched or list(available_sources)
    excluded = INTENT_SOURCE_EXCLUSIONS.get(intent, set())
    if excluded:
        filtered = [s for s in sources if s not in excluded]
        return filtered or sources
    return sources


def _how_to_sources(available_sources: list[str]) -> list[str]:
    """Pick one source per role: web/reference, video (prefer longform), discussion."""
    selected: set[str] = set()
    has_video = False
    # Order matters: web first, then longform video, generic video, discussion.
    role_capabilities = [
        {"web", "reference"},
        {"video_longform"},
        {"video"},
        {"discussion"},
    ]
    for role in role_capabilities:
        is_video_role = role & {"video", "video_longform"}
        if is_video_role and has_video:
            continue
        for source in available_sources:
            if source in selected:
                continue
            if SOURCE_CAPABILITIES.get(source, set()) & role:
                selected.add(source)
                if is_video_role:
                    has_video = True
                break
    # After core role-based selection, include remaining sources with any
    # how_to-relevant capability (video, discussion, web, reference, link).
    how_to_caps = DEFAULT_INTENT_CAPABILITIES.get("how_to", set())
    for source in available_sources:
        if source not in selected and SOURCE_CAPABILITIES.get(source, set()) & how_to_caps:
            selected.add(source)
    if not selected:
        return list(available_sources)
    return [source for source in available_sources if source in selected]
