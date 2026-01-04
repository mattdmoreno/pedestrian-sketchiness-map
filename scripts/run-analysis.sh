#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running sketchiness analysis..."

PSQL_VARS=()
if [ -n "${MIN_LON:-}" ]; then PSQL_VARS+=( -v "min_lon=$MIN_LON" ); fi
if [ -n "${MIN_LAT:-}" ]; then PSQL_VARS+=( -v "min_lat=$MIN_LAT" ); fi
if [ -n "${MAX_LON:-}" ]; then PSQL_VARS+=( -v "max_lon=$MAX_LON" ); fi
if [ -n "${MAX_LAT:-}" ]; then PSQL_VARS+=( -v "max_lat=$MAX_LAT" ); fi
if [ -n "${BBOX_BUFFER_M:-}" ]; then PSQL_VARS+=( -v "bbox_buffer_m=$BBOX_BUFFER_M" ); fi

echo "Phase 1/3: Build crosswalk/road linkage tables"
docker compose exec -T db psql \
	-U postgres \
	-d seattle_pedestrians \
	-X \
	"${PSQL_VARS[@]}" \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	< "$ROOT_DIR/query_snippets/crosswalks.sql"

echo "Phase 2/3: Build 20m segments + crosswalk distances"
docker compose exec -T db psql \
	-U postgres \
	-d seattle_pedestrians \
	-X \
	"${PSQL_VARS[@]}" \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	< "$ROOT_DIR/query_snippets/crosswalk_distances.sql"

echo "Phase 3/3: Materialize streets_analyzed for serving/export"
docker compose exec -T db psql \
	-U postgres \
	-d seattle_pedestrians \
	-X \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	<<'SQL'
DROP TABLE IF EXISTS streets_analyzed;
CREATE UNLOGGED TABLE streets_analyzed AS
SELECT
	row_number() OVER (ORDER BY road_osm_id, segment_no)::bigint AS osm_id,
	name,
	highway,
	dist_to_marked_crosswalk_m AS dist_to_crossing_meters,
	(nearest_marked_crosswalk_id IS NOT NULL) AS nearest_crossing_marked,
	geom
FROM road_segments_20m_crosswalk_dist;

ANALYZE streets_analyzed;
SQL
echo "Analysis complete!"
