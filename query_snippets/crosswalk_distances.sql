
-- Builds 20m road segments for display, each annotated with distance to the nearest
-- marked crosswalk POINT on the same road.
--
-- Assumes you've already run query_snippets/crosswalks.sql to create:
--   - roads (road_osm_id, name, highway, geom)
--   - road_crosswalks (road_osm_id, point_osm_id, ...)
--   - crosswalk_raw_points (point_osm_id, marked, geom)
--
-- Notes:
-- - Geometries are expected in EPSG:3857 so distances are ~meters.

DROP TABLE IF EXISTS marked_crosswalk_road;
DROP TABLE IF EXISTS roads_same_name_endpoints;
DROP TABLE IF EXISTS roads_same_name_edges;
DROP TABLE IF EXISTS roads_same_name_connected;
DROP TABLE IF EXISTS road_segments_20m;
DROP TABLE IF EXISTS road_segments_20m_crosswalk_dist;

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

-- Build a same-name connectivity graph.
-- Definition (per your spec): two roads are connected when one road's start point equals
-- the other's end point (or vice-versa). We compute transitive connectivity per road.
CREATE UNLOGGED TABLE roads_same_name_endpoints AS
SELECT
    r.road_osm_id,
    r.name,
    ST_StartPoint(ST_LineMerge(r.geom)) AS start_pt,
    ST_EndPoint(ST_LineMerge(r.geom)) AS end_pt
FROM roads r
WHERE r.geom IS NOT NULL
  AND r.name IS NOT NULL
  AND btrim(r.name) <> ''
  AND GeometryType(ST_LineMerge(r.geom)) = 'LINESTRING';

CREATE INDEX roads_same_name_endpoints_name_idx ON roads_same_name_endpoints (name);
CREATE INDEX roads_same_name_endpoints_start_gist ON roads_same_name_endpoints USING GIST (start_pt);
CREATE INDEX roads_same_name_endpoints_end_gist ON roads_same_name_endpoints USING GIST (end_pt);

CREATE UNLOGGED TABLE roads_same_name_edges AS
SELECT
    a.road_osm_id AS from_road_osm_id,
    b.road_osm_id AS to_road_osm_id
FROM roads_same_name_endpoints a
JOIN roads_same_name_endpoints b
  ON a.road_osm_id <> b.road_osm_id
 AND a.name = b.name
 AND (ST_Equals(a.start_pt, b.end_pt) OR ST_Equals(a.end_pt, b.start_pt));

CREATE INDEX roads_same_name_edges_from_idx ON roads_same_name_edges (from_road_osm_id);
CREATE INDEX roads_same_name_edges_to_idx ON roads_same_name_edges (to_road_osm_id);

CREATE UNLOGGED TABLE roads_same_name_connected AS
WITH RECURSIVE reach AS (
    SELECT
        e.from_road_osm_id AS start_road_osm_id,
        e.from_road_osm_id AS road_osm_id,
        ARRAY[e.from_road_osm_id]::bigint[] AS path
    FROM (SELECT DISTINCT from_road_osm_id FROM roads_same_name_edges) e

    UNION ALL

    SELECT
        r.start_road_osm_id,
        e.to_road_osm_id AS road_osm_id,
        (r.path || e.to_road_osm_id)
    FROM reach r
    JOIN roads_same_name_edges e
      ON e.from_road_osm_id = r.road_osm_id
    WHERE NOT (e.to_road_osm_id = ANY (r.path))
)
SELECT DISTINCT start_road_osm_id, road_osm_id
FROM reach
UNION
SELECT road_osm_id AS start_road_osm_id, road_osm_id
FROM roads_same_name_endpoints;

CREATE INDEX roads_same_name_connected_start_idx ON roads_same_name_connected (start_road_osm_id);
CREATE INDEX roads_same_name_connected_road_idx ON roads_same_name_connected (road_osm_id);

-- Nearest marked crosswalk distance per segment across all connected roads with the same name
CREATE UNLOGGED TABLE road_segments_20m_crosswalk_dist AS
SELECT
    s.road_osm_id,
    s.name,
    s.highway,
    s.segment_no,
    s.geom,
    nearest.crosswalk_id AS nearest_marked_crosswalk_id,
    nearest.dist_m AS dist_to_marked_crosswalk_m
FROM road_segments_20m s
LEFT JOIN LATERAL (
    SELECT
        m.crosswalk_id,
        ST_Distance(s.geom, m.geom) AS dist_m
    FROM marked_crosswalk_road m
    JOIN roads_same_name_connected c
      ON c.road_osm_id = m.road_osm_id
    WHERE c.start_road_osm_id = s.road_osm_id
    ORDER BY s.geom <-> m.geom
    LIMIT 1
) AS nearest ON true;

CREATE INDEX road_segments_20m_crosswalk_dist_road_idx ON road_segments_20m_crosswalk_dist (road_osm_id);
CREATE INDEX road_segments_20m_crosswalk_dist_geom_gist ON road_segments_20m_crosswalk_dist USING GIST (geom);

