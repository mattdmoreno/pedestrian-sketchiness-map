#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
PUBLIC_DIR="$ROOT_DIR/public"

mkdir -p "$PUBLIC_DIR"


for f in scripts/build-san-antonio-basemap.sh sketchiness-all.pmtiles; do
  if [[ ! -f "$DATA_DIR/$f" ]]; then
    echo "Error: missing $DATA_DIR/$f" >&2
    echo "Run the tile build/export first (see README)." >&2
    exit 1
  fi
done

cp -f "$DATA_DIR/scripts/build-san-antonio-basemap.sh" "$PUBLIC_DIR/scripts/build-san-antonio-basemap.sh"
cp -f "$DATA_DIR/sketchiness-all.pmtiles" "$PUBLIC_DIR/sketchiness-all.pmtiles"

echo "Copied PMTiles into $PUBLIC_DIR"
ls -lah "$PUBLIC_DIR" | sed -n '1,20p'
