#!/usr/bin/env bash
# Transcodes every .usm under extracted/Resource/Movie to MP4 in extracted/converted/video/ (parallel).
# ffmpeg demuxes the MPEG-1 video but cannot decode the CRI audio track, so audio goes through vgmstream and is muxed back in.
# Run via: nix shell nixpkgs#ffmpeg nixpkgs#vgmstream --command bash cmd/extract/convert-video.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
export src=extracted/Resource/Movie
export out=extracted/converted/video
export fail_log="$PWD/convert-video.failed.log"
: > "$fail_log"

convert_one() {
  f="$1"
  rel="${f#$src/}"
  dest="$out/${rel%.usm}.mp4"
  [ -s "$dest" ] && return 0
  mkdir -p "$(dirname "$dest")"
  tmp=$(mktemp -d)
  # Even dimensions are required for yuv420p H.264.
  if ffmpeg -v error -nostdin -y -i "$f" -map 0:v:0 -an -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -c:v libx264 -preset veryfast -crf 18 -threads 2 -pix_fmt yuv420p "$tmp/video.mp4" 2>/dev/null; then
    if vgmstream-cli -o "$tmp/audio.wav" "$f" >/dev/null 2>&1 && [ -s "$tmp/audio.wav" ]; then
      ffmpeg -v error -nostdin -y -i "$tmp/video.mp4" -i "$tmp/audio.wav" -c:v copy -c:a aac -shortest "$tmp/final.mp4" \
        && mv "$tmp/final.mp4" "$dest" || echo "$f" >> "$fail_log"
    else
      mv "$tmp/video.mp4" "$dest"
    fi
  else
    echo "$f" >> "$fail_log"
  fi
  rm -rf "$tmp"
}
export -f convert_one

find "$src" -type f -name '*.usm' -size +1k -print0 | sort -z | xargs -0 -r -P "$(( $(nproc) / 2 ))" -n 1 bash -c 'convert_one "$0"'
echo "failures: $(wc -l < "$fail_log") (see convert-video.failed.log)"
