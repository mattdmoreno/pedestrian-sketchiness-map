#!/usr/bin/env bash
set -euo pipefail



ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
mkdir -p "$DATA_DIR"

# List of areas: name|url|filename
AREAS=(
  "San Antonio|https://download.bbbike.org/osm/extract/planet_-98.928,29.245_-98.025,29.718.osm.pbf"
)

download_pbf() {
  local name="$1"
  local url="$2"
  local filename="$3"
  local path="$DATA_DIR/$filename"
  if [[ -f "$path" ]]; then
    echo "Already exists: $path"
  else
    echo "Downloading $name extract…"
    curl -L --fail --retry 3 --retry-delay 2 -o "$path" "$url"
    echo "Downloaded: $path"
  fi
}

for area in "${AREAS[@]}"; do
  IFS='|' read -r name url filename <<< "$area"
  download_pbf "$name" "$url" "$filename"
done
