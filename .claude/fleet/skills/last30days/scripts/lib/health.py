"""Typed source health: classify a source/tool outcome honestly.

The pipeline historically collapsed every failure into "returned nothing" or a
flat ``errors_by_source`` entry, which hides the difference between a tool that
is *absent*, one that is *present but broken* (the classic stale-venv-shim after
a Python upgrade), one that *timed out*, and one that merely *degraded* (fewer
results than expected). This module gives callers a small typed vocabulary so
warnings can say what actually happened and prescribe the right fix.

It complements ``preflight.py`` (which gates doomed *queries*); this gates
doomed *sources/tools*.
"""

from __future__ import annotations

# SLIM: dropped os/shutil/subprocess/pathlib/typing imports (only dataclass is still needed)
from dataclasses import dataclass

# Health states, best to worst.
OK = "ok"
DEGRADED = "degraded"        # ran, but returned less than expected
MISSING = "missing"          # tool/binary/credential absent
BROKEN = "broken"            # present but won't execute (stale shim, bad perms)
TIMEOUT = "timeout"          # exceeded the probe deadline
ERROR = "error"              # ran and failed for another reason

# Per-run outcomes. Doctor does not emit these: it predicts source readiness
# before retrieval, while Report.source_status records what happened in one run.
NO_RESULTS = "no-results"
PARTIAL = "partial"
RATE_LIMITED = "rate-limited"
AUTH_FAILED = "auth-failed"
PAYMENT_REQUIRED = "payment-required"  # HTTP 402 / credits exhausted: top up, not re-login
UNREACHABLE = "unreachable"
SCHEMA_DRIFT = "schema-drift"
SKIPPED_UNCONFIGURED = "skipped-unconfigured"


def credits_exhausted_label(source: str) -> str:
    """Human label for a ``PAYMENT_REQUIRED`` outcome on ``source``.

    The X source names the API whose credits ran out; every other source
    gets the generic phrasing so the same label serves render summaries and
    the doctor post-mortem without each surface hand-writing its own.
    """
    return "X API credits exhausted" if source == "x" else "credits exhausted"


@dataclass
class SourceHealth:
    """Typed outcome for a source or the tool backing it.

    ``state`` is one of the module-level constants. ``reason`` is a short,
    human-readable explanation suitable for a run warning.
    """

    name: str
    state: str
    reason: str = ""

    @property
    def ok(self) -> bool:
        return self.state == OK

    @property
    def usable(self) -> bool:
        """True when the source produced something worth keeping (ok/degraded)."""
        return self.state in (OK, DEGRADED)


# SLIM: removed


# (they ran external binaries via subprocess); only the state vocabulary remains.
