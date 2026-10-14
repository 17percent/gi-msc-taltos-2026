"""HTTP utilities for last30days skill (stdlib only)."""

import json
from collections import OrderedDict
import math
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import Future
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from typing import Any, Callable, Dict, Optional, Union
from urllib.parse import urlencode, urlsplit, urlunsplit, quote

from . import health
from . import log as _log

DEFAULT_TIMEOUT = 30


def log(msg: str):
    """Log debug message to stderr."""
    _log.debug(msg)


MAX_RETRIES = 5
MAX_429_RETRIES = 2
RETRY_DELAY = 2.0


# Longest a 429 retry may sleep on any host. Reddit's x-ratelimit-reset can say
# 540s and GitHub's is an epoch timestamp; neither is worth parking a worker
# (or the main thread) for. Past this bound the retry is not worth taking, so
# the caller's own fallback backoff applies and the request fails fast.
MAX_RETRY_DELAY_SECONDS = 60.0
# A reset value this large is an absolute epoch timestamp, not delta-seconds.
_EPOCH_RESET_THRESHOLD = 100_000_000.0


def retry_delay_from_headers(headers, fallback):
    """Seconds to wait after a 429, read from whichever header the host sent.

    ``Retry-After`` is the standard, but Reddit's keyless search endpoints answer an
    anonymous 429 with ``x-ratelimit-reset`` (seconds until the window rolls) and
    no ``Retry-After`` at all::

        HTTP/2 429
        x-ratelimit-used: 1
        x-ratelimit-remaining: 0.0
        x-ratelimit-reset: 42

    Reading only ``Retry-After`` means the caller falls back to exponential
    backoff -- 3s, 5s, 9s -- every one of which is shorter than the ~42s Reddit
    actually requires. Each retry re-429s, the budget drains, and the source is
    reported dead when it was merely early. Honouring the reset header turns a
    guaranteed zero into a result at the cost of one wait.

    Returns ``fallback`` when neither header is present or parseable.
    """
    if not headers:
        return fallback
    for name in ("Retry-After", "x-ratelimit-reset"):
        raw = headers.get(name)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value >= _EPOCH_RESET_THRESHOLD:
            # GitHub-style absolute reset time.
            value = value - time.time()
        if value > 0:
            return min(value, MAX_RETRY_DELAY_SECONDS)
    return fallback

# DNS resolution failures (gaierror) are transient — typically resolved by a
# brief backoff and retry. Use a dedicated minimum attempt count + exponential
# delays (1s, 2s, 4s) so callers that pass a small `retries` value still get a
# meaningful chance to recover from a transient resolution failure.
MIN_DNS_RETRIES = 3
USER_AGENT = "last30days-skill/3.0 (Assistant Skill)"

# urllib copies almost all headers across 3xx; strip credentials when origin changes (#1062).
_CROSS_ORIGIN_AUTH_HEADERS = frozenset(
    {"authorization", "x-api-key", "x-csrf-token", "x-subscription-token"}
)


def _request_origin(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if parts.port is not None:
        port = parts.port
    elif scheme == "https":
        port = 443
    elif scheme == "http":
        port = 80
    else:
        port = 0
    return scheme, host, port


# SLIM: HARD-CODED OUTBOUND HOST ALLOW-LIST (the single choke point).
# Every outbound request in this tree goes through request()/open_url(), which
# call check_url_allowed() BEFORE any socket is opened; _open_request() checks
# again right before the opener runs, and every redirect target is re-checked
# by _AllowListRedirect. Exact host match, https only, no userinfo, no port
# override, no wildcard/suffix matching, no IP literals (an IP is never in the
# list). Anything else raises HostNotAllowedError (a hard error, not retried).
#
# APPSEC FLAG: ``www.reddit.com`` is listed separately from ``reddit.com``
# because the code really fetches https://www.reddit.com/... (listings, search,
# shreddit, .json); ``old.reddit.com`` is not used by the code and is NOT listed.
ALLOWED_HOSTS = frozenset({
    "reddit.com",
    "www.reddit.com",
    "arctic-shift.photon-reddit.com",
    "hn.algolia.com",
    "news.ycombinator.com",
    "gamma-api.polymarket.com",
    "api.github.com",
})


class HostNotAllowedError(BaseException):
    """Raised before any socket is opened when a URL is not on the allow-list.

    Deliberately a BaseException (not Exception): the source adapters wrap their
    fetches in ``except Exception`` and degrade to "no results", which would
    silently swallow a blocked host. A BaseException passes through those
    handlers, aborts the run and reaches the CLI, which prints it and exits 2.
    """


_SAFE_URL_CHARS = re.compile(r"[\x21-\x7e]+")


def check_url_allowed(url: Any) -> str:
    """Return ``url`` unchanged if it is allowed, else raise HostNotAllowedError."""
    if not isinstance(url, str) or not _SAFE_URL_CHARS.fullmatch(url) or "\\" in url:
        raise HostNotAllowedError("blocked: URL is not a plain printable-ASCII string")
    try:
        parts = urlsplit(url)
        port = parts.port  # raises ValueError on a malformed port
    except ValueError as exc:
        raise HostNotAllowedError(f"blocked: unparsable URL ({exc})") from exc
    if parts.scheme != "https":
        raise HostNotAllowedError(f"blocked: scheme {parts.scheme!r} is not https")
    host = parts.hostname or ""
    # netloc must be exactly the host: this rejects userinfo ("a@b"), ports
    # (":443", even the default one), brackets, trailing dots and odd casing tricks.
    if port is not None or parts.netloc != host or host not in ALLOWED_HOSTS:
        raise HostNotAllowedError(
            f"blocked: host {parts.netloc!r} is not on the allow-list"
        )
    return url


class _AllowListRedirect(urllib.request.HTTPRedirectHandler):
    """Re-check every redirect target against the allow-list, then strip auth
    headers when the origin changes (#1062)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url_allowed(newurl)  # hard error: never follow a redirect off-list
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        if _request_origin(req.full_url) != _request_origin(new.full_url):
            for store in (new.headers, getattr(new, "unredirected_hdrs", None)):
                if not store:
                    continue
                for name in list(store):
                    if name.lower() in _CROSS_ORIGIN_AUTH_HEADERS:
                        del store[name]
        return new


# SLIM: an explicit empty ProxyHandler makes the opener ignore http(s)_proxy
# environment variables (build_opener would otherwise add a default ProxyHandler).
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _AllowListRedirect)


def _open_request(req, timeout):
    """Open ``req`` through the allow-listed, proxy-less opener (socket choke point)."""
    check_url_allowed(req.full_url)
    return _opener.open(req, timeout=timeout)


def open_url(url: str, headers: Optional[Dict[str, str]] = None, timeout: float = DEFAULT_TIMEOUT):
    """SLIM: allow-listed GET for modules that parse the response themselves.

    Replaces direct urllib.request.urlopen calls (github.py, reddit_public.py)
    so that no module outside this file touches urllib.request.
    """
    check_url_allowed(url)
    req = urllib.request.Request(url, headers=dict(headers or {}), method="GET")
    return _open_request(req, timeout)


_failure_sink: ContextVar[Optional[list["HTTPError"]]] = ContextVar(
    "last30days_http_failure_sink",
    default=None,
)
_expected_miss_statuses: ContextVar[frozenset[int]] = ContextVar(
    "last30days_http_expected_miss_statuses",
    default=frozenset(),
)

# SLIM: removed


# caller-chosen file paths and is only a test facility).


def _is_dns_failure(err: urllib.error.URLError) -> bool:
    """Return True if a URLError was caused by DNS resolution (gaierror)."""
    # SLIM: compare by class name so this module does not import ``socket``
    # (socket.gaierror is the DNS-failure exception).
    return type(getattr(err, "reason", None)).__name__ == "gaierror"


class HTTPError(Exception):
    """HTTP request error with status code."""
    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        body: Optional[str] = None,
        outcome_state: Optional[str] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.body = body
        self.outcome_state = outcome_state or classify_failure(
            status_code=status_code,
            message=message,
        )


class DeadlineExceeded(HTTPError):
    """The caller's shared wall deadline expired across request retries."""

    def __init__(self):
        super().__init__(
            "Request deadline exceeded",
            outcome_state=health.TIMEOUT,
        )


@contextmanager
def capture_failures():
    """Capture terminal request failures in the current retrieval context.

    Source modules historically catch ``HTTPError`` and return an empty result.
    The context-local sink lets the pipeline retain that failure without shared
    mutable state across its worker threads.
    """
    failures: list[HTTPError] = []
    token = _failure_sink.set(failures)
    try:
        yield failures
    finally:
        _failure_sink.reset(token)


@contextmanager
def tee_failures():
    """Observe failures locally WITHOUT hiding them from the enclosing sink.

    ``capture_failures()`` *replaces* the context-local sink, so nesting it
    inside a retrieval context swallows the very failure the pipeline needs.
    This yields a local list and forwards its contents to the parent sink on
    exit, so a swallow site (``get_text`` returns None and drops the status)
    can recover what it lost while the pipeline still sees the failure.
    """
    parent = _failure_sink.get()
    local: list[HTTPError] = []
    token = _failure_sink.set(local)
    try:
        yield local
    finally:
        _failure_sink.reset(token)
        if parent is not None:
            parent.extend(local)


@contextmanager
def expected_misses(*status_codes: int):
    """Exclude adapter-declared probe misses from captured run failures."""
    token = _expected_miss_statuses.set(
        _expected_miss_statuses.get().union(status_codes)
    )
    try:
        yield
    finally:
        _expected_miss_statuses.reset(token)


def submit_with_context(executor, func, /, *args, **kwargs) -> Future:
    """Submit a worker with the caller's failure-capture context."""
    context = copy_context()
    return executor.submit(context.run, func, *args, **kwargs)


def _record_failure(error: HTTPError) -> None:
    if error.status_code in _expected_miss_statuses.get():
        return
    sink = _failure_sink.get()
    if sink is not None:
        sink.append(error)


def _raise(error: HTTPError) -> None:
    _record_failure(error)
    raise error


def classify_failure(*, status_code: Optional[int] = None, message: str = "") -> str:
    """Map a request failure to the doctor-aligned per-run vocabulary."""
    text = message.lower()
    if status_code == 429 or any(
        marker in text for marker in ("http 429", "status 429", "rate limit", "too many requests")
    ):
        return health.RATE_LIMITED
    # Credit exhaustion is checked before the auth branch: a 402 (or a body
    # saying the account has no credits) asks the user to top up, not to
    # re-authenticate. Markers stay narrow on purpose: the bare word "credits"
    # is not one ("10,000 free credits" is onboarding copy, not a failure).
    if status_code == 402 or any(
        marker in text
        for marker in (
            "http 402",
            "status 402",
            "payment required",
            "insufficient credits",
            "does not have any credits",
            "out of credits",
        )
    ):
        return health.PAYMENT_REQUIRED
    if status_code in (401, 403) or any(
        marker in text
        for marker in (
            "http 401",
            "http 403",
            "status 401",
            "status 403",
            "unauthorized",
            "forbidden",
            "authentication failed",
            "expired token",
            "not signed in",
            "not logged in",
            "invalid_grant",
            "refresh token",
            "session expired",
            "grok session expired",
        )
    ):
        return health.AUTH_FAILED
    if status_code == 408 or "timed out" in text or "timeout" in text:
        return health.TIMEOUT
    if any(
        marker in text
        for marker in (
            "invalid json",
            "json decode",
            "schema",
            "interstitial",
            "non-json",
        )
    ):
        return health.SCHEMA_DRIFT
    if any(
        marker in text
        for marker in (
            "url error",
            "connection error",
            "connection refused",
            "connection reset",
            "name or service not known",
            "temporary failure in name resolution",
            "nodename nor servname",
            "dns",
            "network is unreachable",
        )
    ):
        return health.UNREACHABLE
    return health.ERROR


def request(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = MAX_RETRIES,
    max_429_retries: int = MAX_429_RETRIES,
    raw: bool = False,
    deadline_monotonic: float | None = None,
) -> Union[Dict[str, Any], str]:
    """Make an HTTP request and return JSON response.

    Args:
        method: HTTP method (GET, POST, etc.)
        url: Request URL
        headers: Optional headers dict
        json_data: Optional JSON body (for POST)
        params: Optional query-string params. Values are stringified. None values
            are dropped. If ``url`` already has a query string, ``params`` is appended.
        timeout: Request timeout in seconds
        retries: Number of retries on failure
        max_429_retries: Maximum 429 retries before giving up (separate cap)
        raw: If True, return raw response text instead of parsed JSON
        deadline_monotonic: Optional absolute monotonic deadline shared by all
            attempts and retry delays.

    Returns:
        Parsed JSON response as dict, or raw text string if raw=True.

    Raises:
        HTTPError: On request failure
    """
    headers = headers or {}
    headers.setdefault("User-Agent", USER_AGENT)

    if params:
        filtered = {k: str(v) for k, v in params.items() if v is not None}
        if filtered:
            separator = "&" if ("?" in url) else "?"
            url = f"{url}{separator}{urlencode(filtered)}"
    # Encode any non-ASCII characters to prevent UnicodeEncodeError from
    # http.client.HTTPConnection.putrequest (which uses latin-1 internally).
    # Only encode path, query, and fragment — not the hostname (netloc), which
    # needs IDNA encoding instead of percent-encoding for non-ASCII domains.
    parts = urlsplit(url)
    safe = '/:@!$&\'()*+,;=-._~%?#[]=+'
    url = urlunsplit((
        parts.scheme,
        parts.netloc,
        quote(parts.path, safe=safe),
        quote(parts.query, safe=safe),
        quote(parts.fragment, safe=safe),
    ))

    # SLIM: fixture replay/record removed; the host allow-list is enforced here
    # (and again at the socket choke point in _open_request).
    check_url_allowed(url)

    data = None
    if json_data is not None:
        data = json.dumps(json_data).encode('utf-8')
        headers.setdefault("Content-Type", "application/json")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    def log_request(message: str) -> None:
        log(message)

    safe_url = re.sub(r'([?&])(key|api_key|token|secret)=[^&]*', r'\1\2=***', url)
    log_request(f"{method} {safe_url}")

    last_error = None
    rate_limit_count = 0
    # DNS failures get a dedicated minimum attempt count + exponential backoff.
    # `effective_retries` is the actual loop bound; we expand it on the first
    # gaierror if the caller passed a smaller `retries` value than MIN_DNS_RETRIES.
    effective_retries = retries
    dns_attempts = 0
    attempt = 0

    def raise_recorded(error: HTTPError) -> None:
        _raise(error)

    def deadline_error() -> HTTPError:
        return DeadlineExceeded()

    def sleep_before_retry(delay: float) -> bool:
        """Sleep only when the full delay fits inside the caller's deadline."""
        nonlocal last_error
        if deadline_monotonic is not None:
            remaining = deadline_monotonic - time.monotonic()
            if remaining <= 0 or delay >= remaining:
                last_error = deadline_error()
                return False
        time.sleep(delay)
        return True

    def open_and_read(
        request_timeout: float,
    ) -> tuple[int, str | None, urllib.error.HTTPError | None]:
        try:
            with _open_request(req, request_timeout) as response:
                return response.status, response.read().decode('utf-8'), None
        except urllib.error.HTTPError as error:
            # Error bodies can stall just like successful bodies. Read both
            # inside the same deadline-protected worker before classification.
            body = None
            try:
                body = error.read().decode('utf-8')
            except (OSError, UnicodeDecodeError):
                pass
            return error.code, body, error

    def open_and_read_before_deadline(
        request_timeout: float,
    ) -> tuple[int, str | None, urllib.error.HTTPError | None]:
        """Stop waiting at the wall deadline, even during DNS or body reads."""
        if deadline_monotonic is None:
            return open_and_read(request_timeout)
        remaining = deadline_monotonic - time.monotonic()
        if remaining <= 0:
            raise deadline_error()
        future: Future = Future()

        def worker() -> None:
            try:
                future.set_result(open_and_read(request_timeout))
            except BaseException as exc:
                future.set_exception(exc)

        threading.Thread(target=worker, daemon=True).start()
        try:
            return future.result(timeout=remaining)
        except TimeoutError as exc:
            # A worker-side socket TimeoutError is a transport failure, not
            # proof that the command-wide wall deadline expired. Re-read a
            # completed future so its original exception reaches the normal
            # transport classifier below.
            if future.done():
                return future.result()
            raise deadline_error() from exc

    while attempt < effective_retries:
        request_timeout = timeout
        if deadline_monotonic is not None:
            remaining = deadline_monotonic - time.monotonic()
            if remaining <= 0:
                last_error = deadline_error()
                break
            request_timeout = min(timeout, remaining)
        try:
            response_status, body, response_error = open_and_read_before_deadline(request_timeout)
            if (
                deadline_monotonic is not None
                and time.monotonic() >= deadline_monotonic
            ):
                raise_recorded(deadline_error())
            if response_error is not None:
                raise response_error
            body = body or ""
            log_request(f"Response: {response_status} ({len(body)} bytes)")
            if raw:
                return body
            parsed = json.loads(body) if body else {}
            return parsed
        except DeadlineExceeded as exc:
            raise_recorded(exc)
        except urllib.error.HTTPError as e:
            log_request(f"HTTP Error {e.code}: {e.reason}")
            if body:
                snippet = " ".join(body.split())
                log_request(f"Error body: {snippet[:200]}")
            last_error = HTTPError(f"HTTP {e.code}: {e.reason}", e.code, body)

            # Don't retry client errors (4xx) except rate limits
            if 400 <= e.code < 500 and e.code != 429:
                raise_recorded(last_error)

            # Cap 429 retries separately to avoid wasting latency
            if e.code == 429:
                rate_limit_count += 1
                if rate_limit_count >= max_429_retries:
                    raise_recorded(last_error)

            # HTTP errors respect the caller's original `retries`; only DNS
            # failures get the widened `effective_retries` budget.
            if attempt < retries - 1:
                if e.code == 429:
                    # Respect Retry-After or x-ratelimit-reset (Reddit sends the
                    # latter), falling back to exponential backoff: 3s, 5s, 9s...
                    delay = retry_delay_from_headers(
                        getattr(e, "headers", None),
                        RETRY_DELAY * (2 ** attempt) + 1,
                    )
                    log_request(f"Rate limited (429). Waiting {delay:.1f}s before retry {attempt + 2}/{retries}")
                else:
                    delay = RETRY_DELAY * (2 ** attempt)
                if not sleep_before_retry(delay):
                    break
            else:
                # Caller's original retry budget exhausted; an earlier DNS
                # failure may have widened `effective_retries`, but that
                # widening is DNS-only — don't grant extra HTTP attempts.
                break
        except urllib.error.URLError as e:
            log_request(f"URL Error: {e.reason}")
            reason = getattr(e, "reason", None)
            # urllib commonly wraps socket.timeout (an alias of TimeoutError
            # since 3.10) in URLError; classify those as timeouts, not
            # unreachable hosts, so the recovery guidance is right.
            wrapped_timeout = isinstance(reason, TimeoutError) or "timed out" in str(reason).lower()
            last_error = HTTPError(
                f"URL Error: {e.reason}",
                outcome_state=health.TIMEOUT if wrapped_timeout else health.UNREACHABLE,
            )
            if _is_dns_failure(e):
                # DNS resolution failures are transient; expand the retry budget
                # to MIN_DNS_RETRIES if the caller passed fewer, and use
                # exponential backoff (1s, 2s, 4s, ...) instead of the linear
                # default. Counts DNS attempts separately so other URLError
                # causes don't bypass the regular retry budget.
                dns_attempts += 1
                if effective_retries < MIN_DNS_RETRIES:
                    log_request(
                        f"DNS resolution failed; expanding retry budget from "
                        f"{effective_retries} to {MIN_DNS_RETRIES}"
                    )
                    effective_retries = MIN_DNS_RETRIES
                if attempt < effective_retries - 1:
                    delay = 2 ** (dns_attempts - 1)  # 1s, 2s, 4s, 8s, ...
                    log_request(
                        f"DNS resolution failure (attempt {dns_attempts}); "
                        f"retrying in {delay:.1f}s"
                    )
                    if not sleep_before_retry(delay):
                        break
            elif attempt < retries - 1:
                # Non-DNS URLError (e.g. ConnectionRefused) respects the
                # caller's original retry budget, not the DNS-widened bound.
                if not sleep_before_retry(RETRY_DELAY * (attempt + 1)):
                    break
            else:
                # Caller's original retry budget exhausted; an earlier DNS
                # failure widening `effective_retries` does not carry over
                # to non-DNS error paths.
                break
        except json.JSONDecodeError as e:
            log_request(f"JSON decode error: {e}")
            last_error = HTTPError(
                f"Invalid JSON response: {e}",
                outcome_state=health.SCHEMA_DRIFT,
            )
            raise_recorded(last_error)
        except (OSError, TimeoutError, ConnectionResetError) as e:
            # Handle socket-level errors (connection reset, timeout, etc.)
            log_request(f"Connection error: {type(e).__name__}: {e}")
            state = health.TIMEOUT if isinstance(e, TimeoutError) else health.UNREACHABLE
            last_error = HTTPError(
                f"Connection error: {type(e).__name__}: {e}",
                outcome_state=state,
            )
            if attempt < retries - 1:
                # Socket errors respect the caller's original retry budget.
                if not sleep_before_retry(RETRY_DELAY * (attempt + 1)):
                    break
            else:
                # Original budget exhausted; DNS widening doesn't apply here.
                break

        attempt += 1

    if last_error:
        raise_recorded(last_error)
    error = HTTPError("Request failed with no error details")
    raise_recorded(error)


def get(url: str, headers: Optional[Dict[str, str]] = None, **kwargs) -> Dict[str, Any]:
    """Make a GET request."""
    return request("GET", url, headers=headers, **kwargs)


def post(url: str, json_data: Dict[str, Any], headers: Optional[Dict[str, str]] = None, **kwargs) -> Dict[str, Any]:
    """Make a POST request with JSON body."""
    return request("POST", url, headers=headers, json_data=json_data, **kwargs)


def post_raw(url: str, json_data: Dict[str, Any], headers: Optional[Dict[str, str]] = None, **kwargs) -> str:
    """Make a POST request with JSON body and return raw text."""
    return request("POST", url, headers=headers, json_data=json_data, raw=True, **kwargs)


BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def get_text(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = 2,
    accept: str = "*/*",
    headers: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    """Fetch a URL and return decoded text, or None on any failure.

    Keyless helper for Reddit site search and shreddit HTML endpoints, the free path
    that replaced the now-403 ``.json`` endpoints. Sends a browser User-Agent
    and never raises: returns None on HTTP error, network failure, or timeout
    so tiered callers can fall through to the next source.

    Args:
        url: Request URL
        timeout: HTTP timeout per attempt in seconds
        retries: Number of retries on failure (kept low — these tiers fail fast)
        accept: Accept header value (e.g. "text/html")
        headers: Optional extra headers merged over the defaults

    Returns:
        Decoded response body as text, or None on failure.
    """
    merged = {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
    }
    if headers:
        merged.update(headers)
    try:
        return request(
            "GET", url, headers=merged, timeout=timeout, retries=retries, raw=True
        )
    except HTTPError as e:
        log(f"get_text failed ({e}): {url}")
        return None


class RateLimiter:
    """Thread-safe token-bucket throttle for an endpoint family.

    The keyless source tiers run under the pipeline's ThreadPoolExecutor, so a
    multi-subquery run can fire many requests at the same host at once. A bare
    per-request retry budget does not prevent that stampede — it only reacts
    after a 429. A token bucket bounds the *sustained* rate while still allowing
    a short burst, so legitimate parallelism is preserved (unlike a strict
    min-interval gate that would serialize every concurrent caller and could
    push later futures past their result timeouts).

    ``rate_per_sec`` tokens refill per second; ``burst`` is the bucket capacity
    (max simultaneous calls before throttling kicks in). The lock is released
    while sleeping so waiting threads don't serialize on each other.
    """

    def __init__(self, rate_per_sec: float, burst: int | None = None):
        self.rate = rate_per_sec
        self.capacity = burst if burst is not None else max(1, int(rate_per_sec))
        self._tokens = float(self.capacity)
        self._last = time.monotonic()
        self._lock = threading.Lock()
        # Threads currently blocked in acquire(). Callers that wait on a batch
        # of throttled futures size their timeouts from this queue depth.
        self._waiting = 0

    @property
    def waiting(self) -> int:
        """Threads currently blocked in :meth:`acquire`."""
        with self._lock:
            return self._waiting

    def acquire(self) -> None:
        """Consume one token, blocking only when the bucket is empty."""
        queued = False
        try:
            while True:
                with self._lock:
                    now = time.monotonic()
                    # Clamp elapsed to >= 0: a backward clock reading must never
                    # drive tokens negative (which would spin this loop forever).
                    elapsed = max(0.0, now - self._last)
                    self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
                    self._last = now
                    if self._tokens >= 1.0:
                        self._tokens -= 1.0
                        return
                    if not queued:
                        self._waiting += 1
                        queued = True
                    wait = (1.0 - self._tokens) / self.rate
                time.sleep(wait)
        finally:
            if queued:
                with self._lock:
                    self._waiting -= 1


# Shared across all keyless Reddit tiers (site search, listing, shreddit) so their
# combined fan-out is throttled as one family. Burst lets the parallel
# enrichment workers proceed; sustained rate caps the stampede.
# 1 req/sec is slow enough that home IPs survive search + listing + shreddit
# fan-out; raise LAST30DAYS_REDDIT_KEYLESS_RATE to trade 429s for wall-clock.
REDDIT_KEYLESS_RATE_ENV = "LAST30DAYS_REDDIT_KEYLESS_RATE"
DEFAULT_REDDIT_KEYLESS_RATE = 1.0
DEFAULT_REDDIT_KEYLESS_BURST = 2
_REDDIT_429_RETRY_SLEEP_SEC = 1.0
_REDDIT_429_RETRY_JITTER_SEC = 0.5


def parse_reddit_keyless_rate(raw: Optional[str]) -> float:
    """Parse LAST30DAYS_REDDIT_KEYLESS_RATE; invalid/non-positive -> default."""
    text = (raw or "").strip()
    if not text:
        return DEFAULT_REDDIT_KEYLESS_RATE
    try:
        rate = float(text)
    except (TypeError, ValueError):
        return DEFAULT_REDDIT_KEYLESS_RATE
    if not math.isfinite(rate) or rate <= 0:
        return DEFAULT_REDDIT_KEYLESS_RATE
    return rate


def make_reddit_keyless_limiter(
    environ: Optional[Dict[str, str]] = None,
) -> RateLimiter:
    envmap = os.environ if environ is None else environ
    return RateLimiter(
        rate_per_sec=parse_reddit_keyless_rate(envmap.get(REDDIT_KEYLESS_RATE_ENV)),
        burst=DEFAULT_REDDIT_KEYLESS_BURST,
    )


REDDIT_KEYLESS_LIMITER = make_reddit_keyless_limiter()


def _sync_reddit_keyless_rate() -> None:
    """Apply a process-env override without resetting in-flight tokens."""
    rate = parse_reddit_keyless_rate(os.environ.get(REDDIT_KEYLESS_RATE_ENV))
    if REDDIT_KEYLESS_LIMITER.rate != rate:
        REDDIT_KEYLESS_LIMITER.rate = rate


def _failures_are_429(failures: list[HTTPError]) -> bool:
    if not failures:
        return False
    last = failures[-1]
    return last.status_code == 429 or last.outcome_state == health.RATE_LIMITED


def _sleep_reddit_429_retry() -> None:
    """Short jittered pause before the single in-lane 429 retry."""
    time.sleep(
        _REDDIT_429_RETRY_SLEEP_SEC
        + random.uniform(0.0, _REDDIT_429_RETRY_JITTER_SEC)
    )


# Run-scoped memo for keyless Reddit GETs. Subreddit listing partials, site
# search pages, arctic supplements, and shreddit comment pages depend only on
# the subreddit, sort, or raw topic, and the Reddit lane is dispatched with the
# raw topic for every subquery, so a four-subquery run requested each of them
# four times.
# Memoizing successful bodies for the life of one command turns ~184 requests
# into ~50 on the measured 2026-08-31 run shape. Concurrent requesters for the
# same URL wait on the first fetch instead of issuing their own (all four
# subquery streams start at once, so a result-only cache would miss).
REDDIT_KEYLESS_MEMO_MAX = 512
_REDDIT_KEYLESS_MEMO: "OrderedDict[str, str]" = OrderedDict()
_REDDIT_KEYLESS_INFLIGHT: Dict[str, threading.Event] = {}
_REDDIT_KEYLESS_MEMO_LOCK = threading.Lock()


# Queue depth only counts threads already blocked in acquire(). The other
# lanes' workers submit their requests as they go, so a batch's last fetch can
# start well after the depth seen at wait time. This flat allowance covers
# that (the 2026-08-31 smoke lost three feeds at ~35s with the depth term
# alone; a full run's ~50 distinct keyless requests take ~50s at 1 req/s).
REDDIT_KEYLESS_CONTENTION_SECONDS = 45.0


def reddit_keyless_wait_allowance(batch_size: int) -> float:
    """Seconds a batch of *batch_size* throttled fetches may spend waiting for tokens.

    Every keyless Reddit lane in a run shares one bucket, so a lane's futures
    can sit behind other lanes' requests before their own fetch starts. Size
    per-future result timeouts as ``base + this`` instead of a fixed number;
    at 1 req/s a fixed 20-second timeout expired on real runs while the fetch
    was still queued (issue #985 follow-up).
    """
    _sync_reddit_keyless_rate()
    limiter = REDDIT_KEYLESS_LIMITER
    rate = limiter.rate if limiter.rate > 0 else 1.0
    return (limiter.waiting + max(0, batch_size)) / rate + REDDIT_KEYLESS_CONTENTION_SECONDS


def reset_reddit_keyless_memo() -> None:
    """Forget memoized keyless Reddit bodies. Called once per command, and by tests."""
    with _REDDIT_KEYLESS_MEMO_LOCK:
        _REDDIT_KEYLESS_MEMO.clear()
        _REDDIT_KEYLESS_INFLIGHT.clear()


def _reddit_memo_get(url: str) -> Optional[str]:
    with _REDDIT_KEYLESS_MEMO_LOCK:
        text = _REDDIT_KEYLESS_MEMO.get(url)
        if text is not None:
            _REDDIT_KEYLESS_MEMO.move_to_end(url)
        return text


def _reddit_memo_put(url: str, text: str) -> None:
    with _REDDIT_KEYLESS_MEMO_LOCK:
        _REDDIT_KEYLESS_MEMO[url] = text
        _REDDIT_KEYLESS_MEMO.move_to_end(url)
        while len(_REDDIT_KEYLESS_MEMO) > REDDIT_KEYLESS_MEMO_MAX:
            _REDDIT_KEYLESS_MEMO.popitem(last=False)


def reddit_keyless_get_text(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = 2,
    accept: str = "*/*",
    headers: Optional[Dict[str, str]] = None,
    validate: Optional[Callable[[str], Optional[str]]] = None,
) -> Optional[str]:
    """get_text for the keyless Reddit tiers, memoized per run and throttled.

    Same contract as :func:`get_text` (returns None on any failure) but a URL
    already fetched this command is served from the run memo without spending
    a limiter token, concurrent requesters for one URL share the in-flight
    fetch, and cold fetches are spaced via :data:`REDDIT_KEYLESS_LIMITER` so a
    broad multi-query run does not stampede Reddit's keyless endpoints.

    ``validate`` lets a caller reject a fetched body before it is memoized. It
    returns None for a body the caller recognizes, or a short reason string.
    A rejected body is recorded into the failure sink as schema drift and the
    call returns None, so an HTTP 200 challenge page is neither reported as a
    clean empty result nor served from the memo to later streams.
    """
    cached = _reddit_memo_get(url)
    if cached is not None:
        return cached
    # Elect one owner per URL. A waiter whose owner failed re-enters the
    # election rather than fetching un-gated, so a failed fetch costs one
    # retry for the whole group, not one per waiter.
    for _round in range(3):
        with _REDDIT_KEYLESS_MEMO_LOCK:
            cached = _REDDIT_KEYLESS_MEMO.get(url)
            if cached is not None:
                return cached
            gate = _REDDIT_KEYLESS_INFLIGHT.get(url)
            owner = gate is None
            if owner:
                gate = threading.Event()
                _REDDIT_KEYLESS_INFLIGHT[url] = gate
        if owner:
            break
        # The owner may itself be queued in the shared bucket; wait for that
        # queue, not just for one socket timeout.
        gate.wait(
            timeout=timeout * max(1, retries) + reddit_keyless_wait_allowance(1)
        )
        cached = _reddit_memo_get(url)
        if cached is not None:
            return cached
    else:
        # Three failed owners in a row: give up quietly rather than pile on.
        return None
    try:
        _sync_reddit_keyless_rate()
        REDDIT_KEYLESS_LIMITER.acquire()
        text = get_text(url, timeout=timeout, retries=retries, accept=accept, headers=headers)
        if text is not None and validate is not None:
            problem = validate(text)
            if problem:
                _record_failure(HTTPError(
                    f"Unrecognized response ({problem}): {url}",
                    outcome_state=health.SCHEMA_DRIFT,
                ))
                return None
        if text is not None:
            _reddit_memo_put(url, text)
        return text
    finally:
        with _REDDIT_KEYLESS_MEMO_LOCK:
            _REDDIT_KEYLESS_INFLIGHT.pop(url, None)
        gate.set()


def reddit_keyless_get_text_retry_429(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    accept: str = "*/*",
    headers: Optional[Dict[str, str]] = None,
    validate: Optional[Callable[[str], Optional[str]]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Limiter-throttled GET with one extra limiter-respecting retry on 429.

    Returns ``(body, error)``. The first attempt is captured locally so a
    recovered 429 is not left in the pipeline sink. A second 429, or any
    non-429 miss, is recorded as before. Internal ``get_text`` retries are
    skipped (``retries=1``) so the in-lane retry is the one that re-acquires
    the bucket. ``validate`` is passed through to
    :func:`reddit_keyless_get_text`; a rejected body is a non-429 miss.
    """
    # retries=1 on purpose: letting request() sleep out a 42-60s
    # x-ratelimit-reset inside a lane worker starves the whole batch (the
    # 2026-08-31 smoke lost 14 feeds to future timeouts with retries=2 versus
    # 6 with 1). A keyless 429 fails fast, the lane retries once after a short
    # jittered pause through the bucket, and the memo keeps the other streams
    # from re-requesting the same URL.
    kwargs: Dict[str, Any] = {
        "timeout": timeout,
        "retries": 1,
        "accept": accept,
        "headers": headers,
        "validate": validate,
    }
    with capture_failures() as first:
        text = reddit_keyless_get_text(url, **kwargs)
    if text is not None:
        return text, None
    if _failures_are_429(first):
        _sleep_reddit_429_retry()
        with tee_failures() as second:
            text = reddit_keyless_get_text(url, **kwargs)
        if text is not None:
            return text, None
        err = second[-1] if second else (first[-1] if first else None)
        return None, str(err) if err is not None else "no response"
    for err in first:
        _record_failure(err)
    err = first[-1] if first else None
    return None, str(err) if err is not None else "no response"


# SLIM: removed scrapecreators_headers (keyed third-party service)


def get_reddit_json(path: str, timeout: int = DEFAULT_TIMEOUT, retries: int = MAX_RETRIES) -> Dict[str, Any]:
    """Fetch Reddit thread JSON.

    Args:
        path: Reddit path (e.g., /r/subreddit/comments/id/title)
        timeout: HTTP timeout per attempt in seconds
        retries: Number of retries on failure

    Returns:
        Parsed JSON response
    """
    # Ensure path starts with /
    if not path.startswith('/'):
        path = '/' + path

    # Remove trailing slash and add .json
    path = path.rstrip('/')
    if not path.endswith('.json'):
        path = path + '.json'

    url = f"https://www.reddit.com{path}?raw_json=1"

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    return get(url, headers=headers, timeout=timeout, retries=retries)
