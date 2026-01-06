#!/bin/bash
set -e

# Ensure the database is running
echo "Checking if database is running..."
if ! docker compose ps | grep -q "Up"; then
    echo "Starting database..."
    docker compose up -d
    echo "Waiting for database to be ready..."
    sleep 10
fi

# Check for osm2pgsql
if ! command -v osm2pgsql &> /dev/null; then
    echo "osm2pgsql not found. Installing via Homebrew..."
    brew install osm2pgsql
fi



# Use a single database for all areas
DB_NAME="pedestrians_all"

# Reset Database
echo "Resetting database $DB_NAME..."
docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker compose exec -T db psql -U postgres -c "CREATE DATABASE $DB_NAME;"

# Enable extensions
echo "Enabling PostGIS and hstore extensions on $DB_NAME..."
docker compose exec -T db psql -U postgres -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T db psql -U postgres -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS hstore;"


# Import all .osm.pbf files in ./data with minimal parallelism to avoid connection exhaustion
OSM2PGSQL_PROCESSES=1
FIRST=1
for PBF_FILE in ./data/*.osm.pbf; do
    if [[ ! -f "$PBF_FILE" ]]; then
        echo "No .osm.pbf files found in ./data."
        exit 1
    fi
    if [[ $FIRST -eq 1 ]]; then
        MODE="--create"
        FIRST=0
    else
        MODE="--append"
    fi
    echo "Importing $PBF_FILE into PostGIS database $DB_NAME ($MODE, processes=$OSM2PGSQL_PROCESSES)..."
    PGPASSWORD=postgres osm2pgsql \
        $MODE --slim --hstore \
        --number-processes "$OSM2PGSQL_PROCESSES" \
        -d $DB_NAME \
        -U postgres \
        -H localhost \
        -P 5432 \
        "$PBF_FILE"
done

echo "All imports complete!"
