#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
PUBLIC_DIR="$ROOT_DIR/public"

mkdir -p "$PUBLIC_DIR"

# Ensure the San Antonio PMTiles exist
PMTILES="$DATA_DIR"/basemap-san-antonio.pmtiles"
if [[ ! -f "$PMTILES" ]]; then
  echo "Error: missing $PMTILES" >&2
  echo "Run the tile build first (see README)." >&2
  exit 1
fi

# Copy to public/
cp -f "$PMTILES" "$PUBLIC_DIR/basemap-san-antonio.pmtiles"

echo "Copied PMTiles into $PUBLIC_DIR"
ls -lah "$PUBLIC_DIR" | head -n 20

