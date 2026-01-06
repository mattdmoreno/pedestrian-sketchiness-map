-- Parameters
-- NOTE: osm2pgsql geometries here are EPSG:3857, so distances are ~meters.
-- The bbox below is a small downtown-ish Seattle window for quick testing.
DROP TABLE IF EXISTS crosswalks_params;
CREATE TEMP TABLE crosswalks_params AS
SELECT
        0.2::double precision AS snap_dist,
        false::boolean AS use_bbox,
        ST_SetSRID(
                ST_MakeEnvelope(
                        -13618947.079671822,  -- minx
                        6040588.817409255,    -- miny
                        -13616947.079671822,  -- maxx
                        6042588.817409255     -- maxy
                ),
                3857
        ) AS test_bbox,
        ARRAY[
                'living_street',
                'primary','primary_link',
                'residential',
                'secondary','secondary_link',
                'tertiary','tertiary_link',
                'trunk','trunk_link'
        ]::text[] AS road_highways;

-- 1) Roads table
DROP TABLE IF EXISTS roads;
CREATE TABLE roads AS
SELECT  
        l.*,
        l.osm_id AS road_osm_id,
        l.way AS geom
FROM planet_osm_line AS l
CROSS JOIN crosswalks_params AS params
WHERE l.way IS NOT NULL
        AND l.highway = ANY (params.road_highways)
        AND (NOT params.use_bbox OR l.way && params.test_bbox);

-- Spatial index used by the road<->crosswalk join below
CREATE INDEX IF NOT EXISTS roads_geom_gist ON roads USING GIST (geom);
ANALYZE roads;

-- 2) Crosswalk points table
DROP TABLE IF EXISTS crosswalk_raw_points;
CREATE UNLOGGED TABLE crosswalk_raw_points AS
SELECT
        p.osm_id AS point_osm_id,
        p.highway,
        p.tags,
        COALESCE(NULLIF(p.tags->'crossing', ''), 'unknown') AS crossing_type,
        ((p.tags->'crossing') IN ('controlled', 'marked', 'pedestrian_signals', 'traffic_signals', 'zebra', 'uncontrolled')
         OR (p.tags->'crossing:markings' IS NOT NULL AND p.tags->'crossing:markings' != 'no')
         OR (p.tags->'crossing:signals' IS NOT NULL AND p.tags->'crossing:signals' != 'no')) AS marked,
        (p.tags->'crossing') = 'unmarked' AS unmarked,
        p.way AS geom
FROM planet_osm_point AS p
CROSS JOIN crosswalks_params AS params
WHERE p.highway = 'crossing'
        AND (NOT params.use_bbox OR p.way && params.test_bbox);

-- Spatial index used by the road<->crosswalk join below
CREATE INDEX IF NOT EXISTS crosswalk_raw_points_geom_gist ON crosswalk_raw_points USING GIST (geom);
ANALYZE crosswalk_raw_points;

-- 3) Link table: road <-> crosswalk feature
-- Supports lookup by road id, point id, or line id.
DROP TABLE IF EXISTS road_crosswalks;
CREATE UNLOGGED TABLE road_crosswalks AS
SELECT
        r.road_osm_id,
        'point'::text AS crosswalk_kind,
        cp.point_osm_id,
        NULL::bigint AS line_osm_id
FROM crosswalk_raw_points AS cp
JOIN crosswalks_params AS params ON true
JOIN roads AS r
  ON r.geom && ST_Expand(cp.geom, params.snap_dist)
 AND ST_DWithin(cp.geom, r.geom, params.snap_dist);

-- Helpful indexes for lookups
CREATE INDEX IF NOT EXISTS road_crosswalks_road_idx ON road_crosswalks (road_osm_id);
CREATE INDEX IF NOT EXISTS road_crosswalks_point_idx ON road_crosswalks (point_osm_id);
-- CREATE INDEX IF NOT EXISTS road_crosswalks_line_idx ON road_crosswalks (line_osm_id);

ANALYZE road_crosswalks;

-- 5) Crosswalks (points enriched with roads they cross)
DROP TABLE IF EXISTS crosswalk_points;
CREATE TABLE crosswalk_points AS
WITH roads_by_point AS (
        SELECT
                rc.point_osm_id,
                array_agg(DISTINCT rc.road_osm_id ORDER BY rc.road_osm_id) AS road_osm_ids
        FROM road_crosswalks AS rc
        WHERE rc.point_osm_id IS NOT NULL
        GROUP BY rc.point_osm_id
)
SELECT
        cp.*,
        rbp.road_osm_ids
FROM crosswalk_raw_points AS cp
JOIN roads_by_point AS rbp
  ON rbp.point_osm_id = cp.point_osm_id;

CREATE INDEX IF NOT EXISTS crosswalks_point_idx ON crosswalk_points (point_osm_id);
