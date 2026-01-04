'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import * as pmtiles from 'pmtiles';

const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

const SKETCHINESS_LAYER_IDS = ['sketchiness-lines-out', 'sketchiness-lines-in'] as const;

function buildReportIssueUrl(template: string, lngLat: maplibregl.LngLat, zoom?: number): string {
  const lat = lngLat.lat.toFixed(6);
  const lng = lngLat.lng.toFixed(6);
  const zoomStr = typeof zoom === 'number' ? zoom.toFixed(2) : '';

  return template
    .replaceAll('{lat}', encodeURIComponent(lat))
    .replaceAll('{lng}', encodeURIComponent(lng))
    .replaceAll('{latLng}', encodeURIComponent(`${lat},${lng}`))
    .replaceAll('{zoom}', encodeURIComponent(zoomStr));
}

function buildBasicOpenMapTilesStyle(pmtilesUrl: string, sketchinessUrl: string): StyleSpecification {
  const SKETCHINESS_CAP_SWITCH_ZOOM = 15;

  const sketchinessLinePaint = {
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5, 20, 12],
    // Residential streets are always green; other roads scale by distance.
    'line-color': [
      'case',
      ['==', ['get', 'highway'], 'residential'],
      '#4caf50',
      ['interpolate', ['linear'], ['get', 'dist_to_crossing_meters'], 0, '#4caf50', 50, '#fdd835', 100, '#e53935', 150, '#b71c1c'],
    ],
    // Differentiate marked vs unmarked crossings.
    // If nearest crossing is unmarked, render as dashed.
    'line-opacity': 0.8,
  };

  return {
    version: 8,
    name: 'Seattle (PMTiles) – basic',
    // MapLibre validates `glyphs` as required. Using the public OpenMapTiles font server for now.
    // If/when you want fully offline hosting, serve your own glyph PBFs.
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      omtiles: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
      },
      sketchiness: {
        type: 'vector',
        url: `pmtiles://${sketchinessUrl}`,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f8f8f8' } },

      // Water
      {
        id: 'water',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#bcd3e6' },
      },

      // Parks (very rough)
      {
        id: 'park',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'park',
        paint: { 'fill-color': '#d6ead2' },
      },

      // Landuse (optional; helps the map feel "normal")
      {
        id: 'landuse',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'landuse',
        paint: { 'fill-color': '#efefef' },
      },

      // Buildings
      {
        id: 'building',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'building',
        paint: {
          'fill-color': '#e0e0e0',
          'fill-outline-color': '#d0d0d0',
        },
      },

      // Roads (OpenMapTiles: transportation)
      {
        id: 'roads',
        type: 'line',
        source: 'omtiles',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            1.5,
            14,
            5,
          ],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'roads-outline',
        type: 'line',
        source: 'omtiles',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#cfcfcf',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            0.8,
            10,
            2.2,
            14,
            6,
          ],
          'line-opacity': 0.7,
        },
      },
      // Sketchiness Layer
      {
        id: 'sketchiness-lines-out',
        type: 'line',
        source: 'sketchiness',
        'source-layer': 'streets',
        maxzoom: SKETCHINESS_CAP_SWITCH_ZOOM,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: sketchinessLinePaint,
      },
      {
        id: 'sketchiness-lines-in',
        type: 'line',
        source: 'sketchiness',
        'source-layer': 'streets',
        minzoom: SKETCHINESS_CAP_SWITCH_ZOOM,
        layout: {
          'line-join': 'round',
          'line-cap': 'butt',
        },
        paint: sketchinessLinePaint,
      },

      // Road labels (street names)
      {
        id: 'road_label',
        type: 'symbol',
        source: 'omtiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'coalesce',
            ['get', 'name:en'],
            ['get', 'name'],
            ['get', 'ref'],
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            10,
            16,
            13,
          ],
          'text-max-angle': 30,
          'text-padding': 2,
          'text-keep-upright': true,
        },
        paint: {
          'text-color': '#333333',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
          'text-halo-blur': 0.5,
        },
      },
      // Labels (Place names)
      {
        id: 'place_label',
        type: 'symbol',
        source: 'omtiles',
        'source-layer': 'place',
        minzoom: 10,
        layout: {
          'text-field': '{name}',
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#333333',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      },
    ],
  } as StyleSpecification;
}

export default function Map() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const tilesBaseUrl = process.env.NEXT_PUBLIC_TILES_BASE_URL;
  const reportIssueUrlTemplate = process.env.NEXT_PUBLIC_REPORT_ISSUE_URL_TEMPLATE;

  const pmtilesUrl = useMemo(() => {
    // If NEXT_PUBLIC_TILES_BASE_URL is set (local dev), use it.
    // Otherwise (static hosting), serve PMTiles from this site under basePath.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const root = tilesBaseUrl ?? `${origin}${basePath}`;
    return `${root}/basemap-seattle.pmtiles`;
  }, [basePath, tilesBaseUrl]);

  const sketchinessUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const root = tilesBaseUrl ?? `${origin}${basePath}`;
    return `${root}/sketchiness.pmtiles`;
  }, [basePath, tilesBaseUrl]);

  const style = useMemo(() => buildBasicOpenMapTilesStyle(pmtilesUrl, sketchinessUrl), [pmtilesUrl, sketchinessUrl]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    console.log('Initializing map with style:', style);

    if (mapRef.current) {
      mapRef.current.setStyle(style);
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: SEATTLE_CENTER,
      zoom: 11,
      minZoom: 2,
      maxZoom: 20,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    mapRef.current = map;

    // Add click handler for sketchiness lines
    const onSketchinessClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;
      
      if (!props) return;

      const coordinates = e.lngLat;
      
      // Helper to capitalize words
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      
      let displayName = props.name;
      const highwayType = props.highway ? capitalize(props.highway) : 'Unknown Type';
      const isResidential = props.highway === 'residential';

      // If no name, construct a descriptive name from the type
      if (!displayName) {
        displayName = `${highwayType} Road`;
      }

      const distance = typeof props.dist_to_crossing_meters === 'number' 
        ? Math.round(props.dist_to_crossing_meters) 
        : 'N/A';

      const markedRaw = (props as Record<string, unknown>).nearest_crossing_marked;
      const marked =
        typeof markedRaw === 'boolean'
          ? markedRaw
          : typeof markedRaw === 'number'
            ? markedRaw !== 0
            : typeof markedRaw === 'string'
              ? ['true', 't', '1', 'yes', 'y'].includes(markedRaw.toLowerCase())
              : null;

      const crossingLabel = marked === null ? 'Unknown' : marked ? 'Marked' : 'Unmarked';

      const latLng = `${coordinates.lat},${coordinates.lng}`;
      const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLng)}`;

      const osmViewUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
        String(coordinates.lat),
      )}&mlon=${encodeURIComponent(String(coordinates.lng))}#map=19/${encodeURIComponent(
        String(coordinates.lat),
      )}/${encodeURIComponent(String(coordinates.lng))}`;

      const googleFaviconUrl = 'https://www.google.com/s2/favicons?domain=google.com&sz=32';
      const osmFaviconUrl = 'https://www.google.com/s2/favicons?domain=openstreetmap.org&sz=32';

      const reportIssueUrl = reportIssueUrlTemplate
        ? buildReportIssueUrl(reportIssueUrlTemplate, coordinates, map.getZoom())
        : null;

      new maplibregl.Popup()
        .setLngLat(coordinates)
        .setHTML(`
          <div style="font-family: sans-serif; padding: 4px;">
            <h3 style="margin: 0 0 4px; font-size: 14px; font-weight: bold;">${displayName}</h3>
            <p style="margin: 0; font-size: 12px;">Type: ${highwayType}</p>
            ${isResidential ? '' : `<p style="margin: 0; font-size: 12px;">Dist to Crosswalk: <strong>${distance}m</strong></p>`}
            <div style="margin: 8px 0 0; display: flex; gap: 8px; flex-wrap: wrap;">
              <a
                href="${streetViewUrl}"
                target="_blank"
                rel="noopener noreferrer"
                style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid #d0d0d0; border-radius: 6px; text-decoration: none; color: inherit; background: #ffffff; font-size: 12px;"
              >
                <img src="${googleFaviconUrl}" alt="" width="16" height="16" style="display: block;" />
                Street View
              </a>
              <a
                href="${osmViewUrl}"
                target="_blank"
                rel="noopener noreferrer"
                style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid #d0d0d0; border-radius: 6px; text-decoration: none; color: inherit; background: #ffffff; font-size: 12px;"
              >
                <img src="${osmFaviconUrl}" alt="" width="16" height="16" style="display: block;" />
                OpenStreetMap
              </a>
            </div>
            ${reportIssueUrl ? `<div style="margin: 8px 0 0; font-size: 12px;"><a href="${reportIssueUrl}" target="_blank" rel="noopener noreferrer">Report an issue</a></div>` : ''}
          </div>
        `)
        .addTo(map);
    };

    for (const layerId of SKETCHINESS_LAYER_IDS) {
      map.on('click', layerId, onSketchinessClick);
    }

    // Change cursor on hover
    for (const layerId of SKETCHINESS_LAYER_IDS) {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, [style]);

  return (
    <div className="map-shell">
      <div id="map" ref={mapContainerRef} />

      <div className="map-overlay map-overlay--title" role="heading" aria-level={1}>
        Seattle Crosswalk Availability Map
      </div>

      <div className="map-overlay map-overlay--legend" aria-label="Legend">
        <div className="legend-title">Legend</div>
        <div className="legend-row">
          <span className="legend-line legend-line--green" />
          <span>0–50m to crossing (and residential streets)</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--yellow" />
          <span>50–100m</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--red" />
          <span>100–150m</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--darkred" />
          <span>150m+</span>
        </div>
      </div>
    </div>
  );
}
