Scripts


- `get-seattle-osm-pbf.sh`: downloads Seattle and/or Bay Area OSM extracts from BBBike. Usage: `./get-seattle-osm-pbf.sh [seattle|bayarea|both]` (default: seattle)
- `import-data.sh`: imports OSM PBF into PostGIS. Usage: `./import-data.sh [seattle|bayarea]` (default: seattle)
- `run-analysis.sh`: runs the sketchiness analysis for the selected region. Usage: `./run-analysis.sh [seattle|bayarea]` (default: seattle)
- `export-sketchiness-tiles.sh`: exports tiles for the selected region. Usage: `./export-sketchiness-tiles.sh [seattle|bayarea]` (default: seattle)
- `build-seattle-basemap.sh`: builds `basemap-seattle.pmtiles` using Planetiler (Docker)
- `serve-data.sh`: serves `./data` locally for PMTiles testing
