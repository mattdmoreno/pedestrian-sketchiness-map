-- Builds a table of unmarked crosswalk points enriched with attributes from the
-- associated road(s), plus distance to the nearest marked crosswalk point.
--
-- Assumes you've already run:
--   - query_snippets/crosswalks.sql
--   - query_snippets/crosswalk_distances.sql
-- which creates:
--   - roads (road_osm_id, tags, geom)
--   - road_crosswalks (road_osm_id, point_osm_id, ...)
--   - crosswalk_raw_points (point_osm_id, marked, unmarked, geom)
--   - road_segments_20m_crosswalk_dist (road_osm_id, segment_no, geom,
--       nearest_marked_crosswalk_id, dist_to_marked_crosswalk_m,
--       maxspeed, lanes, speed_mph,
--       speed_score, lanes_score, volume_score, distance_from_crosswalk_score, frogger_index)
--
-- Notes:
-- - Geometries are expected in EPSG:3857 (osm2pgsql default), so distances are ~meters.
-- - If an unmarked crossing touches multiple roads, this produces one row per
--   (unmarked_crosswalk_id, road_osm_id) pair.

DROP TABLE IF EXISTS unmarked_crosswalks;
DROP TABLE IF EXISTS unmarked_crosswalk_points_enriched;

-- Helpful indexes for spatial KNN and joins (harmless if they already exist)
CREATE INDEX IF NOT EXISTS roads_geom_gist ON roads USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_crosswalks_point_idx ON road_crosswalks (point_osm_id);
CREATE INDEX IF NOT EXISTS crosswalk_raw_points_geom_gist ON crosswalk_raw_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_segments_20m_crosswalk_dist_geom_gist ON road_segments_20m_crosswalk_dist USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_segments_20m_crosswalk_dist_road_idx ON road_segments_20m_crosswalk_dist (road_osm_id);
ANALYZE roads;
ANALYZE road_crosswalks;
ANALYZE crosswalk_raw_points;
ANALYZE road_segments_20m_crosswalk_dist;

CREATE TABLE unmarked_crosswalks AS
WITH unmarked AS (
    SELECT
        cp.point_osm_id AS unmarked_crosswalk_id,
        cp.highway AS crosswalk_highway,
        cp.tags AS crosswalk_tags,
        cp.crossing_type,
        cp.marked,
        cp.unmarked,
        cp.geom
    FROM crosswalk_raw_points cp
    WHERE cp.marked IS FALSE
),
unmarked_roads AS (
    SELECT DISTINCT
        rc.point_osm_id AS unmarked_crosswalk_id,
        rc.road_osm_id
    FROM road_crosswalks rc
    JOIN unmarked u
      ON u.unmarked_crosswalk_id = rc.point_osm_id
),
base AS (
    SELECT
        u.unmarked_crosswalk_id,
        ur.road_osm_id,

        -- Crosswalk attributes
        u.crosswalk_highway,
        u.crossing_type,
        u.crosswalk_tags,
        u.marked,
        u.unmarked,

        -- Road attributes (raw from OSM tags)
        r.name AS road_name,
        r.highway AS road_highway,
        r.tags AS road_tags,
        (r.tags->'maxspeed') AS maxspeed,

        attrs.lanes,

        -- Frogger inputs pulled from the snapped 20m segment (authoritative)
        seg.maxspeed AS frogger_maxspeed,
        seg.lanes AS frogger_lanes,
        seg.speed_mph AS frogger_speed_mph,
        seg.dist_to_marked_crosswalk_m AS frogger_dist_to_marked_crosswalk_m,

        -- Frogger component scores
        seg.speed_score AS frogger_speed_score,
        seg.lanes_score AS frogger_lanes_score,
        seg.volume_score AS frogger_volume_score,
        seg.distance_from_crosswalk_score AS frogger_distance_from_crosswalk_score,
        CASE
            WHEN r.highway IN ('residential', 'living_street', 'service') THEN 0.0
            ELSE seg.frogger_index
        END AS frogger_index,

        -- From the 20m road segment this point lies on.
        seg.nearest_marked_crosswalk_id,
        seg.dist_to_marked_crosswalk_m AS dist_to_nearest_marked_crosswalk_m,

        -- Full source rows (for "all attributes" without name collisions)
        to_jsonb(p_src) AS crosswalk_osm,
        to_jsonb(r) AS road,

        -- Geometry of the unmarked crosswalk point
        u.geom
    FROM unmarked u
    LEFT JOIN unmarked_roads ur
      ON ur.unmarked_crosswalk_id = u.unmarked_crosswalk_id
    LEFT JOIN planet_osm_point p_src
      ON p_src.osm_id = u.unmarked_crosswalk_id
    LEFT JOIN roads r
      ON r.road_osm_id = ur.road_osm_id
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN (r.tags->'lanes') ~ '^\d+$' THEN (r.tags->'lanes')::int
                WHEN (r.tags->'lanes:forward') ~ '^\d+$' AND (r.tags->'lanes:backward') ~ '^\d+$'
                    THEN (r.tags->'lanes:forward')::int + (r.tags->'lanes:backward')::int
                ELSE NULL::int
            END AS lanes,
            NULL::double precision AS maxspeed_mph
    ) AS attrs ON true
    LEFT JOIN LATERAL (
        -- Pick the closest segment on the associated road. Tight snap radius.
        SELECT
            s.nearest_marked_crosswalk_id,
            s.dist_to_marked_crosswalk_m,
            s.maxspeed,
            s.lanes_raw,
            s.lanes,
            s.speed_mph,
            s.speed_score,
            s.lanes_score,
            s.volume_score,
            s.distance_from_crosswalk_score,
            s.frogger_index
        FROM road_segments_20m_crosswalk_dist s
        WHERE s.road_osm_id = ur.road_osm_id
          AND ST_DWithin(u.geom, s.geom, 0.5)
        ORDER BY s.frogger_index DESC NULLS LAST, u.geom <-> s.geom
        LIMIT 1
    ) AS seg ON true
)
SELECT b.* FROM base b;

CREATE INDEX IF NOT EXISTS unmarked_crosswalks_crosswalk_idx ON unmarked_crosswalks (unmarked_crosswalk_id);
CREATE INDEX IF NOT EXISTS unmarked_crosswalks_road_idx ON unmarked_crosswalks (road_osm_id);
CREATE INDEX IF NOT EXISTS unmarked_crosswalks_geom_gist ON unmarked_crosswalks USING GIST (geom);
ANALYZE unmarked_crosswalks;

-- Marker-friendly table: one row per unmarked crosswalk point, choosing the "worst" (highest)
-- frogger_index among snapped road segments on its associated road(s).
CREATE UNLOGGED TABLE unmarked_crosswalk_points_enriched AS
SELECT
        cp.*,
        best.road_osm_id AS frogger_road_osm_id,
        rbest.name AS frogger_road_name,
        best.highway AS frogger_road_highway,
        best.maxspeed AS frogger_maxspeed,
        best.lanes_raw AS frogger_lanes_raw,
        best.lanes AS frogger_lanes,
        best.speed_mph AS frogger_speed_mph,
        best.dist_to_marked_crosswalk_m AS frogger_dist_to_marked_crosswalk_m,
        best.speed_score AS frogger_speed_score,
        best.lanes_score AS frogger_lanes_score,
        best.volume_score AS frogger_volume_score,
        best.distance_from_crosswalk_score AS frogger_distance_from_crosswalk_score,
        CASE
            WHEN best.highway IN ('residential', 'living_street', 'service') THEN 0.0
            ELSE best.frogger_index
        END AS frogger_index
FROM crosswalk_points cp
LEFT JOIN LATERAL (
        SELECT s.*
        FROM unnest(cp.road_osm_ids) AS rid(road_osm_id)
        JOIN road_segments_20m_crosswalk_dist s
            ON s.road_osm_id = rid.road_osm_id
        WHERE ST_DWithin(cp.geom, s.geom, 0.5)
        ORDER BY s.frogger_index DESC NULLS LAST, cp.geom <-> s.geom
        LIMIT 1
) AS best ON true
LEFT JOIN roads rbest
    ON rbest.road_osm_id = best.road_osm_id
WHERE cp.unmarked IS TRUE;

CREATE INDEX unmarked_crosswalk_points_enriched_point_idx ON unmarked_crosswalk_points_enriched (point_osm_id);
CREATE INDEX unmarked_crosswalk_points_enriched_geom_gist ON unmarked_crosswalk_points_enriched USING GIST (geom);
ANALYZE unmarked_crosswalk_points_enriched;
