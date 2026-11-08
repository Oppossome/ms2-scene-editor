#!/bin/sh
# Starts the app. The game's extracted files must be mounted at $MS2_EXTRACTED (read-only is fine); the indexes the
# app searches are built from them on the first start and kept in $MS2_DATA (mount a volume there to keep them).
set -eu

missing=""
for dir in Xml Resource converted; do
  [ -d "$MS2_EXTRACTED/$dir" ] || missing="$missing $dir"
done
if [ -n "$missing" ]; then
  echo "The extracted game files were not found in $MS2_EXTRACTED (missing:$missing)." >&2
  echo "Mount the 'extracted' folder made by the extraction scripts, e.g.  -v /path/to/extracted:$MS2_EXTRACTED:ro" >&2
  exit 1
fi

mkdir -p "$MS2_DATA" 2>/dev/null || true
if [ ! -w "$MS2_DATA" ]; then
  echo "$MS2_DATA is not writable by user $(id -u). Mount a volume there that this user can write to (or run with --user)." >&2
  exit 1
fi

if [ ! -f "$MS2_DATA/meta.json" ] || [ "${REINDEX:-}" = "1" ]; then
  echo "Building the indexes from $MS2_EXTRACTED (takes a minute or two)..."
  node scripts/build-index.ts
fi

exec "$@"
