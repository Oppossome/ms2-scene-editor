#!/usr/bin/env bash
# Converts every .dds under extracted/ (except extracted/converted) to PNG in extracted/converted/textures/, in parallel.
# Run via: nix shell nixpkgs#imagemagick --command bash cmd/extract/convert-textures.sh [subdir-under-extracted ...]
set -uo pipefail
cd "$(dirname "$0")/../.."
roots=("${@:-Resource}")
export out="$PWD/extracted/converted/textures"
fail_log="$PWD/convert-textures.failed.log"
: > "$fail_log"

convert_one() {
  src="$1"
  rel="${src#extracted/}"
  dest="$out/${rel%.*}.png"
  [ -s "$dest" ] && return 0
  mkdir -p "$(dirname "$dest")"
  if ! magick "$src" "$dest" 2>/dev/null; then
    rm -f "$dest"
    echo "$src" >> "$fail_log"
  fi
}
export -f convert_one
export fail_log

for r in "${roots[@]}"; do
  find "extracted/$r" -type f -iname '*.dds' -print0
done | xargs -0 -r -P "$(nproc)" -n 1 bash -c 'convert_one "$0"'

echo "failures: $(wc -l < "$fail_log") (see convert-textures.failed.log)"
