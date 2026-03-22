#!/bin/sh
set -eu

PORT="${RAIL_VITE_PORT:-1420}"
CURRENT_CWD="$(pwd -P)"

existing_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"

if [ -n "$existing_pid" ]; then
  existing_cwd="$(lsof -a -p "$existing_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  if [ "$existing_cwd" = "$CURRENT_CWD" ]; then
    if curl -g -fsS --max-time 2 "http://[::1]:$PORT/" >/dev/null 2>&1 \
      || curl -fsS --max-time 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 \
      || curl -fsS --max-time 2 "http://localhost:$PORT/" >/dev/null 2>&1; then
      printf 'Reusing existing Vite dev server on port %s (pid %s).\n' "$PORT" "$existing_pid"
      exit 0
    fi
    printf 'Existing Vite dev server on port %s (pid %s) is unresponsive. Restarting it.\n' "$PORT" "$existing_pid" >&2
    kill "$existing_pid" 2>/dev/null || true
    sleep 1
  fi
  printf 'Port %s is already in use by pid %s (cwd: %s).\n' "$PORT" "$existing_pid" "${existing_cwd:-unknown}" >&2
  exit 1
fi

exec ./scripts/with-modern-node.sh vite --host localhost --port "$PORT" --strictPort
