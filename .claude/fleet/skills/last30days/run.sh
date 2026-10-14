#!/usr/bin/env bash
# SLIM: wrapper that runs last30days-slim in a clean environment with every
# writable location pinned under $LAST30DAYS_DATA_ROOT (default: $TMPDIR/last30days).
set -euo pipefail

ROOT="${LAST30DAYS_DATA_ROOT:-${TMPDIR:-/tmp}/last30days}"
DATA="$ROOT/last30days-data"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$DATA/home" "$DATA/data" "$DATA/config" "$DATA/cache" "$DATA/output" "$DATA/pycache"

cd "$HERE"
exec env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  HOME="$DATA/home" \
  XDG_DATA_HOME="$DATA/data" \
  XDG_CONFIG_HOME="$DATA/config" \
  XDG_CACHE_HOME="$DATA/cache" \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONPYCACHEPREFIX="$DATA/pycache" \
  LAST30DAYS_CONFIG_DIR="$HERE/.config-empty" \
  LAST30DAYS_MEMORY_DIR="$DATA/output" \
  FROM_BROWSER=off \
  AGENTCOOKIE=off \
  SETUP_COMPLETE=true \
  LAST30DAYS_SKIP_KEYCHAIN=1 \
  python3 scripts/last30days.py "$@"
