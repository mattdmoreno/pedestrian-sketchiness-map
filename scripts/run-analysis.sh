#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running sketchiness analysis..."

# Ensure the database container is running and ready.
echo "Checking if database is running..."
if ! docker compose ps --status running --services | grep -qx "db"; then
	echo "Starting database..."
	docker compose up -d db
fi



# Use a single unified database for all areas
DB_NAME="pedestrians_all"

echo "Waiting for database to be ready..."
for i in {1..60}; do
	if docker compose exec -T db pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
		break
	fi
	sleep 1
	if [ "$i" -eq 60 ]; then
		echo "Database did not become ready in time" >&2
		exit 1
	fi
done

PSQL_VARS=()
if [ -n "${MIN_LON:-}" ]; then PSQL_VARS+=( -v "min_lon=$MIN_LON" ); fi
if [ -n "${MIN_LAT:-}" ]; then PSQL_VARS+=( -v "min_lat=$MIN_LAT" ); fi
if [ -n "${MAX_LON:-}" ]; then PSQL_VARS+=( -v "max_lon=$MAX_LON" ); fi
if [ -n "${MAX_LAT:-}" ]; then PSQL_VARS+=( -v "max_lat=$MAX_LAT" ); fi
if [ -n "${BBOX_BUFFER_M:-}" ]; then PSQL_VARS+=( -v "bbox_buffer_m=$BBOX_BUFFER_M" ); fi

echo "Phase 1/3: Build crosswalk/road linkage tables"
docker compose exec -T db psql \
	-U postgres \
	-d "$DB_NAME" \
	-X \
	"${PSQL_VARS[@]}" \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	< "$ROOT_DIR/query_snippets/crosswalks.sql"

echo "Phase 2/3: Build 20m segments + crosswalk distances"
docker compose exec -T db psql \
	-U postgres \
	-d "$DB_NAME" \
	-X \
	"${PSQL_VARS[@]}" \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	< "$ROOT_DIR/query_snippets/crosswalk_distances.sql"

echo "Phase 3/3: Build unmarked crosswalks table"
docker compose exec -T db psql \
	-U postgres \
	-d "$DB_NAME" \
	-X \
	"${PSQL_VARS[@]}" \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	< "$ROOT_DIR/query_snippets/unmarked_crosswalks.sql"
echo "Analysis complete!"
