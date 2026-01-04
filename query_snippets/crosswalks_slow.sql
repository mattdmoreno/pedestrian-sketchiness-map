DROP TABLE IF EXISTS crosswalks_raw_points;
CREATE UNLOGGED TABLE crosswalks_raw_points AS
WITH params AS (
        SELECT ARRAY[
                'living_street',
                'motorway','motorway_link',
                'primary','primary_link',
                'residential',
                'secondary','secondary_link',
                'service',
                'tertiary','tertiary_link',
                'trunk','trunk_link'
        ]::text[] AS road_highways
)
SELECT
        p.*,
        way AS geom,
        (p.tags->'crossing') IN ('controlled', 'marked', 'pedestrian_signals', 'traffic_signals', 'zebra') AS marked,
        (p.tags->'crossing') = 'unmarked' AS unmarked,
        COALESCE(
                (
                        SELECT array_agg(l.osm_id ORDER BY l.osm_id)
                        FROM planet_osm_line AS l
                        CROSS JOIN params
                        WHERE l.highway = ANY (params.road_highways)
                          AND ST_DWithin(p.way, l.way, 1.0)
                ),
                '{}'::bigint[]
        ) AS on_line_osm_ids
FROM planet_osm_point as p
WHERE highway = 'crossing';

DROP TABLE IF EXISTS crosswalks_raw_lines;
CREATE TABLE crosswalks_raw_lines AS
SELECT
        l.*,
        way AS geom,
        COALESCE(NULLIF(l.tags->'crossing', ''), 'unknown') AS crossing_type,
		(l.tags->'crossing') IN ('controlled', 'marked', 'pedestrian_signals', 'traffic_signals', 'zebra') AS marked,
        (l.tags->'crossing') = 'unmarked' AS unmarked
FROM planet_osm_line as l
WHERE highway = 'footway' AND (l.tags->'crossing') IN ('unmarked', 'controlled', 'marked', 'pedestrian_signals', 'traffic_signals', 'zebra');