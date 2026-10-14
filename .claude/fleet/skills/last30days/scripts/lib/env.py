"""SLIM: minimal, side-effect-free configuration loader for last30days-slim.

Replaces the upstream env.py (1870 lines: Keychain, pass(1), browser cookies,
agentcookie/CDP sidecars, X/YouTube/TikTok/... credential discovery). This
loader reads exactly two things:

  1. process environment variables (whitelisted keys only), and
  2. ONE optional ``.env`` file: ``$LAST30DAYS_CONFIG_DIR/.env``.

It never reads ~/.config, browsers, keychains, project-level files or any
other directory, and it never spawns a subprocess. When LAST30DAYS_CONFIG_DIR
is unset or empty, no file is read at all.

Any config value that names a source outside the slim set
(INCLUDE_SOURCES / EXCLUDE_SOURCES / LAST30DAYS_DEFAULT_SEARCH) is a hard
error (ConfigError), never a silent skip.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from . import schema


class ConfigError(ValueError):
    """Raised when configuration asks for something this slim build cannot do."""


def read_secret_env(name: str, default: str | None = None) -> str | None:
    """Read an environment variable by name (plain os.environ lookup)."""
    return os.environ.get(name, default)


_config_override = os.environ.get("LAST30DAYS_CONFIG_DIR")
if _config_override:
    CONFIG_DIR: Path | None = Path(_config_override)
    CONFIG_FILE: Path | None = CONFIG_DIR / ".env"
else:
    # SLIM: no default of ~/.config/last30days; unset/empty means "no config file".
    CONFIG_DIR = None
    CONFIG_FILE = None

# Keys the slim build understands. Everything else found in the environment or
# the .env file is ignored (names are reported on stderr, values never).
CONFIG_KEYS: tuple[str, ...] = (
    "GITHUB_TOKEN",
    "LAST30DAYS_DEBUG",
    "LAST30DAYS_MEMORY_DIR",
    "LAST30DAYS_DEFAULT_SEARCH",
    "LAST30DAYS_STRICT_EXIT",
    "LAST30DAYS_REGISTER",
    "EXCLUDE_SOURCES",
    "INCLUDE_SOURCES",
    "FUN_LEVEL",
)
_SOURCE_LIST_KEYS = ("INCLUDE_SOURCES", "EXCLUDE_SOURCES", "LAST30DAYS_DEFAULT_SEARCH")
_ALIASES = {"hn": "hackernews"}


def _truthy(value: Any) -> bool:
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def load_env_file(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE lines from ``path`` (comments, ``export``, quotes). {} if absent."""
    values: dict[str, str] = {}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return values
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        if key:
            values[key] = value
    return values


def _validate_source_list(key: str, raw: str) -> None:
    for token in raw.split(","):
        token = token.strip().lower()
        if not token:
            continue
        token = _ALIASES.get(token, token)
        if token not in schema.SLIM_SOURCES:
            raise ConfigError(
                f"{key} names unsupported source {token!r}: this slim build only "
                f"supports {', '.join(schema.SLIM_SOURCES)}"
            )


def get_config() -> dict[str, Any]:
    """Return the resolved configuration (environment wins over the .env file)."""
    file_env = load_env_file(CONFIG_FILE) if CONFIG_FILE else {}
    config: dict[str, Any] = {}
    for key in CONFIG_KEYS:
        value = os.environ.get(key)
        if value is None or value == "":
            value = file_env.get(key)
        config[key] = value if value not in (None, "") else None
    config["FUN_LEVEL"] = config.get("FUN_LEVEL") or "medium"
    for key in _SOURCE_LIST_KEYS:
        if config.get(key):
            _validate_source_list(key, str(config[key]))
    ignored = sorted(k for k in file_env if k not in CONFIG_KEYS)
    if ignored:
        sys.stderr.write(
            "[last30days] ignored config keys not supported in the slim build: "
            + ", ".join(ignored) + "\n"
        )
    config["_CONFIG_SOURCE"] = f"file:{CONFIG_FILE}" if file_env else "env"
    if _truthy(config.get("LAST30DAYS_DEBUG")):
        os.environ.setdefault("LAST30DAYS_DEBUG", "1")
    return config
