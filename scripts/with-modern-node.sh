#!/bin/sh
set -eu

node_version() {
  "$1" -p "process.versions.node" 2>/dev/null || printf "0.0.0"
}

parse_version() {
  version="$1"
  old_ifs="$IFS"
  IFS=.
  set -- $version
  IFS="$old_ifs"
  printf "%s %s %s\n" "${1:-0}" "${2:-0}" "${3:-0}"
}

version_supported() {
  set -- $(parse_version "$1")
  major="$1"
  minor="$2"

  if [ "$major" -ge 23 ]; then
    return 0
  fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; then
    return 0
  fi
  if [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; then
    return 0
  fi
  return 1
}

version_newer_than() {
  candidate_version="$1"
  current_version="$2"

  set -- $(parse_version "$candidate_version")
  candidate_major="$1"
  candidate_minor="$2"
  candidate_patch="$3"

  set -- $(parse_version "$current_version")
  current_major="$1"
  current_minor="$2"
  current_patch="$3"

  if [ "$candidate_major" -gt "$current_major" ]; then
    return 0
  fi
  if [ "$candidate_major" -lt "$current_major" ]; then
    return 1
  fi
  if [ "$candidate_minor" -gt "$current_minor" ]; then
    return 0
  fi
  if [ "$candidate_minor" -lt "$current_minor" ]; then
    return 1
  fi
  [ "$candidate_patch" -gt "$current_patch" ]
}

find_compatible_node() {
  if [ -n "${RAIL_NODE_BIN:-}" ]; then
    if [ ! -x "$RAIL_NODE_BIN" ]; then
      echo "RAIL_NODE_BIN is not executable: $RAIL_NODE_BIN" >&2
      return 1
    fi
    explicit_version="$(node_version "$RAIL_NODE_BIN")"
    if version_supported "$explicit_version"; then
      dirname "$RAIL_NODE_BIN"
      return 0
    fi
    echo "RAIL_NODE_BIN must point to Node.js 20.19+ or 22.12+: $explicit_version" >&2
    return 1
  fi

  current_node="$(command -v node 2>/dev/null || true)"
  best_node=""
  best_version="0.0.0"

  for candidate in \
    "$current_node" \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node"
  do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue

    candidate_version="$(node_version "$candidate")"
    if version_supported "$candidate_version" && version_newer_than "$candidate_version" "$best_version"; then
      best_node="$candidate"
      best_version="$candidate_version"
    fi
  done

  [ -n "$best_node" ] || return 1
  dirname "$best_node"
}

NODE_DIR="$(find_compatible_node)" || {
  echo "RAIL requires Node.js 20.19+ for Vite 7. Install a newer Node or set RAIL_NODE_BIN." >&2
  exit 1
}

PATH="$NODE_DIR:$PATH"
export PATH

exec "$@"
