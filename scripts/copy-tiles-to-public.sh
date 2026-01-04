#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
PUBLIC_DIR="$ROOT_DIR/public"

mkdir -p "$PUBLIC_DIR"

for f in basemap-seattle.pmtiles sketchiness.pmtiles; do
  if [[ ! -f "$DATA_DIR/$f" ]]; then
    echo "Error: missing $DATA_DIR/$f" >&2
    echo "Run the tile build/export first (see README)." >&2
    exit 1
  fi

done

cp -f "$DATA_DIR/basemap-seattle.pmtiles" "$PUBLIC_DIR/basemap-seattle.pmtiles"
cp -f "$DATA_DIR/sketchiness.pmtiles" "$PUBLIC_DIR/sketchiness.pmtiles"

echo "Copied PMTiles into $PUBLIC_DIR"
ls -lah "$PUBLIC_DIR" | sed -n '1,20p'
