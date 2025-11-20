#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${SQLITE_DB_PATH:-}" ]]; then
  mkdir -p "$(dirname "${SQLITE_DB_PATH}")"
fi

npm run migrate >/dev/null 2>&1 || npm run migrate

MODE="${APP_MODE:-server}"

case "$MODE" in
  server)
    exec node dist/server.js "$@"
    ;;
  cli|worker)
    exec node dist/index.js "$@"
    ;;
  *)
    echo "Unknown APP_MODE '$MODE'. Use 'server' or 'cli'." >&2
    exit 1
    ;;
esac
