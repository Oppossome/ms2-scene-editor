#!/usr/bin/env bash
# Makes small JPEG thumbnails of the map backdrop images (extracted/converted/textures/Resource/Image/bg) for the
# background picker: extracted/converted/bg-thumbs/<name>.jpg. Run after convert-textures.sh, with ImageMagick:
#   nix shell nixpkgs#imagemagick --command bash cmd/extract/bg-thumbnails.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
src="extracted/converted/textures/Resource/Image/bg"
out="extracted/converted/bg-thumbs"
mkdir -p "$out"

make_one() {
  f="$1"
  dest="$out/$(basename "${f%.*}").jpg"
  [ -s "$dest" ] && return 0
  magick "$f" -background '#1b1d26' -flatten -resize 240x240 -quality 80 "$dest" 2>/dev/null || rm -f "$dest"
}
export -f make_one
export out

find "$src" -type f -iname '*.png' -print0 | xargs -0 -r -P "$(nproc)" -n 1 bash -c 'make_one "$0"'
echo "thumbnails: $(find "$out" -type f | wc -l)"
