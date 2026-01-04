
-- Builds 20m road segments for display, each annotated with distance to the nearest
-- marked crosswalk POINT on any road with the same name (within 500m).
-- Also materializes `streets_analyzed` (the table used by the map/tiles) so you don't
-- need the older analyze-sketchiness flow.
--
-- Assumes you've already run query_snippets/crosswalks.sql to create:
--   - roads (road_osm_id, name, highway, geom)
--   - road_crosswalks (road_osm_id, point_osm_id, ...)
--   - crosswalk_raw_points (point_osm_id, marked, geom)
--
-- Notes:
-- - Geometries are expected in EPSG:3857 so distances are ~meters.

DROP TABLE IF EXISTS marked_crosswalk_road;
DROP TABLE IF EXISTS road_segments_20m;
DROP TABLE IF EXISTS road_segments_20m_crosswalk_dist;
DROP TABLE IF EXISTS streets_analyzed;

-- Ensure base road geometry has a GiST index (needed for many spatial ops; harmless if already present)
CREATE INDEX IF NOT EXISTS roads_geom_gist ON roads USING GIST (geom);
CREATE INDEX IF NOT EXISTS roads_name_idx ON roads (name);
ANALYZE roads;

-- Marked crosswalk points attached to roads (uses precomputed intersections in road_crosswalks)
CREATE UNLOGGED TABLE marked_crosswalk_road AS
SELECT DISTINCT
    rc.road_osm_id,
    rp.point_osm_id AS crosswalk_id,
    rp.geom
FROM road_crosswalks rc
JOIN crosswalk_raw_points rp
  ON rp.point_osm_id = rc.point_osm_id
WHERE rc.point_osm_id IS NOT NULL
  AND rp.marked IS TRUE;

CREATE INDEX marked_crosswalk_road_road_idx ON marked_crosswalk_road (road_osm_id);
CREATE INDEX marked_crosswalk_road_geom_gist ON marked_crosswalk_road USING GIST (geom);

ANALYZE marked_crosswalk_road;

-- Segment roads into ~20m chunks.
CREATE UNLOGGED TABLE road_segments_20m AS
WITH params AS (
    SELECT 20.0::double precision AS segment_len_m
),
road_parts AS (
    SELECT
        r.road_osm_id,
        r.name,
        r.highway,
        (ST_Dump(ST_LineMerge(r.geom))).geom AS geom
    FROM roads r
    WHERE r.geom IS NOT NULL
),
road_parts_len AS (
    SELECT
        road_osm_id,
        name,
        highway,
        geom,
        ST_Length(geom) AS geom_len
    FROM road_parts
    WHERE NOT ST_IsEmpty(geom)
      AND ST_Length(geom) > 0
),
segmented AS (
    SELECT
        r.road_osm_id,
        r.name,
        r.highway,
        n AS segment_no,
        ST_LineSubstring(
            r.geom,
            (n * params.segment_len_m) / r.geom_len,
            LEAST(((n + 1) * params.segment_len_m) / r.geom_len, 1.0)
        ) AS geom
    FROM road_parts_len r
    CROSS JOIN params
    CROSS JOIN LATERAL generate_series(
        0,
        GREATEST(CEIL(r.geom_len / params.segment_len_m)::int - 1, 0)
    ) AS n
)
SELECT
    road_osm_id,
    name,
    highway,
    row_number() OVER (PARTITION BY road_osm_id ORDER BY segment_no) - 1 AS segment_no,
    geom
FROM segmented;

CREATE INDEX road_segments_20m_road_idx ON road_segments_20m (road_osm_id);
CREATE INDEX road_segments_20m_geom_gist ON road_segments_20m USING GIST (geom);

ANALYZE road_segments_20m;

-- Nearest marked crosswalk distance per segment, considering crosswalks on roads with the same name.
-- Only searches within 500m; if none found, distance is set to 500m.
CREATE UNLOGGED TABLE road_segments_20m_crosswalk_dist AS
SELECT
    s.road_osm_id,
    s.name,
    s.highway,
    s.segment_no,
    s.geom,
    nearest.crosswalk_id AS nearest_marked_crosswalk_id,
    COALESCE(nearest.dist_m, 500.0::double precision) AS dist_to_marked_crosswalk_m
FROM road_segments_20m s
LEFT JOIN LATERAL (
    SELECT
        m.crosswalk_id,
        ST_Distance(s.geom, m.geom) AS dist_m
    FROM marked_crosswalk_road m
    JOIN roads r2
      ON r2.road_osm_id = m.road_osm_id
    WHERE s.name IS NOT NULL
      AND btrim(s.name) <> ''
      AND r2.name = s.name
      AND ST_DWithin(s.geom, m.geom, 500.0)
    ORDER BY s.geom <-> m.geom
    LIMIT 1
) AS nearest ON true;

CREATE INDEX road_segments_20m_crosswalk_dist_road_idx ON road_segments_20m_crosswalk_dist (road_osm_id);
CREATE INDEX road_segments_20m_crosswalk_dist_geom_gist ON road_segments_20m_crosswalk_dist USING GIST (geom);

ANALYZE road_segments_20m_crosswalk_dist;

-- Canonical serving/export table (keeps the property names the map style expects).
CREATE UNLOGGED TABLE streets_analyzed AS
SELECT
    row_number() OVER (ORDER BY road_osm_id, segment_no)::bigint AS osm_id,
    name,
    highway,
    dist_to_marked_crosswalk_m AS dist_to_crossing_meters,
    (nearest_marked_crosswalk_id IS NOT NULL) AS nearest_crossing_marked,
    geom
FROM road_segments_20m_crosswalk_dist;

CREATE INDEX streets_analyzed_geom_gist ON streets_analyzed USING GIST (geom);
CREATE INDEX streets_analyzed_osm_id_idx ON streets_analyzed (osm_id);

ANALYZE streets_analyzed;

