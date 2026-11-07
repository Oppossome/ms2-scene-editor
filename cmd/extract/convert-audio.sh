#!/usr/bin/env bash
# Converts every FMOD bank in extracted/Sound to per-stream OGG files in extracted/converted/audio/<bank>/.
# Run via: nix shell nixpkgs#vgmstream nixpkgs#ffmpeg --command bash cmd/extract/convert-audio.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
src=extracted/Sound
out=extracted/converted/audio
mkdir -p "$out"

for fsb in "$src"/*.fsb; do
  bank=$(basename "$fsb" .fsb)
  dest="$out/$bank"
  if [ -f "$dest/.done" ]; then echo "skip $bank"; continue; fi
  mkdir -p "$dest"
  echo "== $bank"
  # -S 0 decodes all subsongs; ?04s is the zero-padded index (stream names can repeat), ?n the stream name.
  vgmstream-cli -S 0 -o "$dest/?04s_?n.wav" "$fsb" > /dev/null
  for wav in "$dest"/*.wav; do
    ffmpeg -v error -y -i "$wav" -c:a libvorbis -q:a 6 "${wav%.wav}.ogg" && rm "$wav"
  done
  touch "$dest/.done"
done
