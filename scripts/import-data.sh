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

# Reset Database
echo "Resetting database..."
docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS seattle_pedestrians;"
docker compose exec -T db psql -U postgres -c "CREATE DATABASE seattle_pedestrians;"

# Enable extensions
echo "Enabling PostGIS and hstore extensions..."
docker compose exec -T db psql -U postgres -d seattle_pedestrians -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T db psql -U postgres -d seattle_pedestrians -c "CREATE EXTENSION IF NOT EXISTS hstore;"

# Import data
echo "Importing Seattle.osm.pbf into PostGIS..."
PGPASSWORD=postgres osm2pgsql   --create --slim --hstore   -d seattle_pedestrians   -U postgres   -H localhost   -P 5432   ./data/Seattle.osm.pbf

echo "Import complete!"
