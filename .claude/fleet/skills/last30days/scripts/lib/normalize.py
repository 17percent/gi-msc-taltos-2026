"""Normalization of source-specific payloads into the v3 generic item model."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from . import dates, schema


def filter_by_date_range(
    items: list[schema.SourceItem],
    from_date: str,
    to_date: str,
    require_date: bool = False,
) -> list[schema.SourceItem]:
    """Keep only items within the requested window."""
    filtered: list[schema.SourceItem] = []
    for item in items:
        if not item.published_at:
            if not require_date:
                filtered.append(item)
            continue
        if item.published_at < from_date or item.published_at > to_date:
            continue
        filtered.append(item)
    return filtered


def normalize_source_items(
    source: str,
    items: list[dict[str, Any]],
    from_date: str,
    to_date: str,
    freshness_mode: str = "balanced_recent",
) -> list[schema.SourceItem]:
    """Normalize raw source items, filter by date range, with evergreen fallback for how_to queries."""
    source = source.lower()
    # SLIM: only the four slim sources have a normalizer.
    normalizers = {
        "reddit": _normalize_reddit,
        "hackernews": _normalize_hackernews,
        "polymarket": _normalize_polymarket,
        "github": _normalize_github,
    }
    normalizer = normalizers.get(source)
    if normalizer is None:
        raise ValueError(f"Unsupported source: {source}")
    normalized = [
        normalizer(source, item, index, from_date, to_date)
        for index, item in enumerate(items)
    ]
    # SLIM: arxiv/jobs/grounding special cases removed.
    require_date = False
    filtered = filter_by_date_range(
        normalized, from_date, to_date, require_date=require_date
    )
    if filtered:
        return filtered
    # SLIM: youtube evergreen rescue removed.
    return filtered


def _remap_comments(
    raw: list[Any],
    score_keys: tuple[str, ...],
    excerpt_keys: tuple[str, ...],
    *,
    preserve_absent_score: bool = False,
) -> list[dict[str, Any]]:
    """Normalize comments from any source into the shared Reddit-compatible shape.

    Downstream code (signals._top_comment_score, render._top_comments_list,
    entity_extract, rerank) all expect `score` and `excerpt`. This helper maps
    per-source field names (YT: likes/text, TikTok: digg_count/text) onto that
    shape while preserving author/date/url passthrough.

    Sources that distinguish an absent vote from a measured zero can opt into
    preserving the absent value as ``None``.
    """
    out: list[dict[str, Any]] = []
    for raw_c in raw:
        if not isinstance(raw_c, dict):
            continue
        score = _first_present(
            raw_c,
            score_keys,
            default=None if preserve_absent_score else 0,
        )
        excerpt = _first_present(raw_c, excerpt_keys, default="")
        if score is None and preserve_absent_score:
            normalized_score = None
        else:
            try:
                normalized_score = int(score or 0)
            except (TypeError, ValueError):
                normalized_score = 0
        entry: dict[str, Any] = {
            "score": normalized_score,
            "excerpt": str(excerpt or "")[:400],
            "author": str(raw_c.get("author") or ""),
            "date": str(raw_c.get("date") or ""),
        }
        if raw_c.get("url"):
            entry["url"] = str(raw_c["url"])
        out.append(entry)
    return out


def _first_present(d: dict[str, Any], keys: tuple[str, ...], default: Any) -> Any:
    for key in keys:
        if key in d and d[key] not in (None, ""):
            return d[key]
    return default


def _join_comment_excerpts(
    top_comments: list[Any],
    key: str,
    limit: int = 3,
) -> str:
    """Space-join the `key` field from the first `limit` dict-shaped comments."""
    return " ".join(
        str(comment.get(key) or "").strip()
        for comment in top_comments[:limit]
        if isinstance(comment, dict)
    )


def _domain_from_url(url: str) -> str | None:
    if not url:
        return None
    domain = urlparse(url).netloc.strip().lower()
    return domain or None


def _date_confidence(
    item: dict[str, Any], from_date: str, to_date: str, default: str = "low"
) -> str:
    if item.get("date_confidence"):
        return str(item["date_confidence"])
    date_value = item.get("date")
    if not date_value:
        return default
    return dates.get_date_confidence(str(date_value), from_date, to_date)


def _source_item(
    *,
    item_id: str,
    source: str,
    title: str,
    body: str,
    url: str,
    published_at: str | None,
    date_confidence: str,
    relevance_hint: float,
    why_relevant: str,
    author: str | None = None,
    container: str | None = None,
    engagement: dict[str, float | int] | None = None,
    snippet: str = "",
    metadata: dict[str, Any] | None = None,
) -> schema.SourceItem:
    return schema.SourceItem(
        item_id=item_id,
        source=source,
        title=title.strip() or body.strip()[:160] or item_id,
        body=body.strip(),
        url=url.strip(),
        author=(author or "").strip() or None,
        container=(container or "").strip() or None,
        published_at=published_at,
        date_confidence=date_confidence,
        engagement=engagement or {},
        relevance_hint=max(0.0, min(1.0, float(relevance_hint or 0.0))),
        why_relevant=why_relevant.strip(),
        snippet=snippet.strip(),
        metadata=metadata or {},
    )


# SLIM: removed _normalize_stocktwits, _normalize_dripstack (non-slim source normalizer)


def _normalize_reddit(
    source: str,
    item: dict[str, Any],
    index: int,
    from_date: str,
    to_date: str,
) -> schema.SourceItem:
    top_comments = item.get("top_comments") or []
    comment_text = _join_comment_excerpts(top_comments, "excerpt")
    body = "\n".join(
        part
        for part in [
            str(item.get("title") or "").strip(),
            str(item.get("selftext") or "").strip(),
            comment_text,
        ]
        if part
    )
    return _source_item(
        item_id=str(item.get("id") or f"R{index + 1}"),
        source=source,
        title=str(item.get("title") or ""),
        body=body,
        url=str(item.get("url") or ""),
        author=None,
        container=str(item.get("subreddit") or ""),
        published_at=item.get("date"),
        date_confidence=_date_confidence(item, from_date, to_date),
        engagement=item.get("engagement") or {},
        relevance_hint=item.get("relevance", 0.5),
        why_relevant=str(item.get("why_relevant") or ""),
        snippet=comment_text or str(item.get("selftext") or "")[:400],
        metadata={
            "top_comments": top_comments,
            "comment_insights": item.get("comment_insights") or [],
        },
    )


# SLIM: removed _normalize_x, _normalize_jobs, _normalize_youtube,
# SLIM:   _normalize_shortform_video, _normalize_pinterest (non-slim source normalizer)


def _normalize_hackernews(
    source: str,
    item: dict[str, Any],
    index: int,
    from_date: str,
    to_date: str,
) -> schema.SourceItem:
    # HN comments arrive as {author, text, points}; downstream code keys on
    # score/excerpt, so remap here exactly as the YouTube and TikTok normalisers
    # do. Without this the per-source floor in render._top_comments_list reads a
    # `score` that is never present and rejects every HN comment.
    top_comments = _remap_comments(
        item.get("top_comments") or [],
        score_keys=("points", "score"),
        excerpt_keys=("text", "excerpt"),
        preserve_absent_score=True,
    )
    comment_text = _join_comment_excerpts(top_comments, "excerpt")
    title = str(item.get("title") or "").strip()
    body = "\n".join(
        part
        for part in [title, str(item.get("text") or "").strip(), comment_text]
        if part
    )
    return _source_item(
        item_id=str(item.get("id") or f"HN{index + 1}"),
        source=source,
        title=title or f"HN story {index + 1}",
        body=body,
        url=str(item.get("url") or item.get("hn_url") or ""),
        author=str(item.get("author") or ""),
        container="Hacker News",
        published_at=item.get("date"),
        date_confidence=_date_confidence(item, from_date, to_date, default="high"),
        engagement=item.get("engagement") or {},
        relevance_hint=item.get("relevance", 0.5),
        why_relevant=str(item.get("why_relevant") or ""),
        snippet=comment_text,
        metadata={
            "hn_url": item.get("hn_url"),
            "top_comments": top_comments,
            "comment_insights": item.get("comment_insights") or [],
        },
    )


# SLIM: removed _normalize_microblog, _normalize_digg, _normalize_arxiv,
# SLIM:   _normalize_techmeme, _normalize_meta_ads, _normalize_trustpilot,
# SLIM:   _normalize_amazon (non-slim source normalizer)


def _normalize_polymarket(
    source: str,
    item: dict[str, Any],
    index: int,
    from_date: str,
    to_date: str,
) -> schema.SourceItem:
    title = str(item.get("title") or "").strip()
    question = str(item.get("question") or "").strip()
    engagement = {
        "volume": item.get("volume1mo") or item.get("volume24hr") or 0,
        "liquidity": item.get("liquidity") or 0,
    }
    return _source_item(
        item_id=str(item.get("event_id") or item.get("id") or f"PM{index + 1}"),
        source=source,
        title=title or question or f"Polymarket event {index + 1}",
        body="\n".join(
            part
            for part in [title, question, str(item.get("price_movement") or "")]
            if part
        ),
        url=str(item.get("url") or ""),
        author=None,
        container="Polymarket",
        published_at=item.get("date"),
        date_confidence=_date_confidence(item, from_date, to_date, default="high"),
        engagement=engagement,
        relevance_hint=item.get("relevance", 0.5),
        why_relevant=str(item.get("why_relevant") or ""),
        snippet=str(item.get("price_movement") or ""),
        metadata={
            "event_id": item.get("event_id"),
            "question": question,
            "end_date": item.get("end_date"),
            "outcome_prices": item.get("outcome_prices") or [],
            "outcomes_remaining": item.get("outcomes_remaining"),
        },
    )


def _normalize_github(
    source: str,
    item: dict[str, Any],
    index: int,
    from_date: str,
    to_date: str,
) -> schema.SourceItem:
    title = str(item.get("title") or "").strip()
    snippet_text = str(item.get("snippet") or "").strip()
    top_comments = item.get("metadata", {}).get("top_comments") or []
    comment_text = _join_comment_excerpts(top_comments, "excerpt")
    body = "\n".join(part for part in [title, snippet_text, comment_text] if part)
    metadata = item.get("metadata") or {}
    return _source_item(
        item_id=str(item.get("id") or f"GH{index + 1}"),
        source=source,
        title=title or f"GitHub item {index + 1}",
        body=body,
        url=str(item.get("url") or ""),
        author=str(item.get("author") or ""),
        container=str(item.get("container") or ""),
        published_at=item.get("date"),
        date_confidence=_date_confidence(item, from_date, to_date, default="high"),
        engagement=item.get("engagement") or {},
        relevance_hint=item.get("relevance", 0.5),
        why_relevant=str(item.get("why_relevant") or ""),
        snippet=comment_text or snippet_text[:400],
        metadata={
            "top_comments": top_comments,
            "labels": metadata.get("labels") or [],
            "state": metadata.get("state", ""),
            "is_pr": metadata.get("is_pr", False),
        },
    )


# SLIM: removed _normalize_grounding, _normalize_linkedin (non-slim source normalizer)


