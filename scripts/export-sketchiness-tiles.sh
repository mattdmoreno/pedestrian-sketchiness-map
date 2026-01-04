#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"

TIPPECANOE_READ_PARALLEL="${TIPPECANOE_READ_PARALLEL:-1}"

echo "Exporting streets_analyzed to PMTiles..."

# Ensure data directory exists
mkdir -p "$DATA_DIR"

OUT_MBTILES="$DATA_DIR/sketchiness.mbtiles"
OUT_PMTILES="$DATA_DIR/sketchiness.pmtiles"

rm -f "$OUT_MBTILES" "$OUT_PMTILES"

# Export GeoJSONSeq to a temp file (tippecanoe reads from files)
# Use a system temp dir to avoid repo permission/ownership issues (e.g., if `data/tmp` was created by Docker as root).
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

STREETS_GJ="$TMP_DIR/streets.geojsonseq"

ogr2ogr -f GeoJSONSeq "$STREETS_GJ" \
  "PG:host=localhost port=5432 dbname=seattle_pedestrians user=postgres password=postgres" \
  -sql "SELECT osm_id, name, highway, COALESCE(LEAST(dist_to_crossing_meters, 500.0), 500.0) AS dist_to_crossing_meters, nearest_crossing_marked, geom FROM streets_analyzed"

tippecanoe -o "$OUT_MBTILES" \
  --force \
  --layer=streets \
  --minimum-zoom=10 --maximum-zoom=16 \
  $( [ "$TIPPECANOE_READ_PARALLEL" = "1" ] && printf %s "--read-parallel" ) \
  --drop-densest-as-needed
echo "Tiles generated at $OUT_MBTILES"

# Convert MBTiles (SQLite) -> PMTiles.
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required to convert MBTiles to PMTiles (install Docker)." >&2
  exit 1
fi

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$DATA_DIR":/data \
  ghcr.io/protomaps/go-pmtiles:latest \
  convert /data/sketchiness.mbtiles /data/sketchiness.pmtiles

echo "Tiles generated at $OUT_PMTILES"
