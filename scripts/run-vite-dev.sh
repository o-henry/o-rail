#!/bin/sh
set -eu

PORT="${RAIL_VITE_PORT:-1420}"
CURRENT_CWD="$(pwd -P)"

existing_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"

if [ -n "$existing_pid" ]; then
  existing_cwd="$(lsof -a -p "$existing_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  if [ "$existing_cwd" = "$CURRENT_CWD" ]; then
    printf 'Reusing existing Vite dev server on port %s (pid %s).\n' "$PORT" "$existing_pid"
    exit 0
  fi
  printf 'Port %s is already in use by pid %s (cwd: %s).\n' "$PORT" "$existing_pid" "${existing_cwd:-unknown}" >&2
  exit 1
fi

exec ./scripts/with-modern-node.sh vite --host localhost --port "$PORT" --strictPort
