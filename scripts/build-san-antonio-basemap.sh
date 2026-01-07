#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"

# Use the Texas extract we already downloaded
PBF_PATH="$DATA_DIR/texas.osm.pbf"
OUT_PATH="$DATA_DIR/basemap-san-antonio.pmtiles"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required (install Docker Desktop)." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

echo "Building San Antonio basemap PMTiles (this may download extra sources into ./data)…"

docker run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx4g" \
  -v "$DATA_DIR":/data \
  ghcr.io/onthegomap/planetiler:latest \
  generate-openmaptiles \
  --download \
  --osm-path=/data/texas.osm.pbf \
  --bbox="-98.66,29.15,-98.36,29.55" \
  --output=/data/basemap-san-antonio.pmtiles \
  --force

echo "Wrote: $OUT_PATH"
