-- Create a table of crosswalks
DROP TABLE IF EXISTS crosswalks;
CREATE TABLE crosswalks AS
SELECT way AS geom FROM planet_osm_point WHERE highway = 'crossing'
UNION ALL
SELECT way AS geom FROM planet_osm_line WHERE highway = 'footway' AND tags->'footway' = 'crossing';

CREATE INDEX idx_crosswalks_geom ON crosswalks USING GIST (geom);

-- Create a table of streets to analyze, segmented into ~20m chunks
DROP TABLE IF EXISTS streets_analyzed;
CREATE TABLE streets_analyzed AS
WITH simple_lines AS (
    -- Ensure we have single LineStrings
    SELECT osm_id, name, highway, (ST_Dump(way)).geom AS geom
    FROM planet_osm_line
    WHERE highway IN ('residential', 'tertiary', 'secondary', 'primary', 'trunk')
    -- TEST MODE: Filter to a small area (Downtown/Belltown)
    AND ST_Intersects(way, ST_Transform(ST_MakeEnvelope(-122.36, 47.60, -122.32, 47.62, 4326), 3857))
),
segmented AS (
    SELECT
        osm_id,
        name,
        highway,
        ST_LineSubstring(
            geom,
            n * 20.0 / ST_Length(geom),
            LEAST((n + 1) * 20.0 / ST_Length(geom), 1.0)
        ) AS geom
    FROM
        simple_lines
    CROSS JOIN LATERAL
        generate_series(0, CEIL(ST_Length(geom) / 20.0)::int - 1) AS n
    WHERE
        ST_Length(geom) > 0
)
SELECT * FROM segmented;

CREATE INDEX idx_streets_analyzed_geom ON streets_analyzed USING GIST (geom);

-- Add a column for sketchiness (distance to nearest crosswalk)
ALTER TABLE streets_analyzed ADD COLUMN dist_to_crossing_meters FLOAT;

-- Calculate distance using KNN
-- Using geography type for accurate meters
UPDATE streets_analyzed s
SET dist_to_crossing_meters = (
  SELECT ST_Distance(ST_Transform(s.geom, 4326)::geography, ST_Transform(c.geom, 4326)::geography)
  FROM crosswalks c
  ORDER BY s.geom <-> c.geom
  LIMIT 1
);
