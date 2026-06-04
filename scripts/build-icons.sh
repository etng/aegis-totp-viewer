#!/usr/bin/env bash
set -euo pipefail

source_url="https://getaegis.app/assets/static/icon.zQelnL_w.png"
out_dir="${1:-public/icons}"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick is required. Install it and rerun this script." >&2
  exit 1
fi

mkdir -p "$out_dir"
curl -fsSL "$source_url" -o "$tmp_dir/aegis.png"

magick -size 1024x1024 xc:none \
  -fill '#101219' -stroke '#d4a64a' -strokewidth 42 \
  -draw 'roundrectangle 70,70 954,954 210,210' \
  \( "$tmp_dir/aegis.png" -resize 760x760 \) -gravity center -composite \
  -fill '#d4a64a' -stroke '#0c0d10' -strokewidth 24 \
  -draw 'circle 774,774 910,774' \
  -fill '#1a1404' -stroke none \
  -draw 'roundrectangle 718,742 850,810 24,24' \
  "$tmp_dir/icon-1024.png"

for size in 16 32 48 96 128 256 512; do
  magick "$tmp_dir/icon-1024.png" -resize "${size}x${size}" "$out_dir/icon-${size}.png"
done

echo "Generated extension icons in $out_dir"
