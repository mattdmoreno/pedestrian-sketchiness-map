'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pmtiles from 'pmtiles';

import FeatureInfoPanel, { type FeatureInfo } from './FeatureInfoPanel';
import UnmarkedCrossingInfoPanel, { type UnmarkedCrossingInfo } from './UnmarkedCrossingInfoPanel';

const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

const SKETCHINESS_LAYER_IDS = ['sketchiness-lines-out', 'sketchiness-lines-in'] as const;

type ViewportParams = {
  lat: number;
  lng: number;
  zoom: number;
};

type PinnedParams = {
  lngLat: maplibregl.LngLat;
  zoom?: number;
};

function buildUnmarkedCrossingTitle(roadName: string | null): string {
  const trimmed = (roadName ?? '').trim();
  if (!trimmed) return 'Unmarked crossing';
  return `Unmarked crossing on ${trimmed}`;
}

function parseInitialViewportFromUrl(): ViewportParams | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const latRaw = params.get('lat');
  const lngRaw = params.get('lng');
  const zoomRaw = params.get('z') ?? params.get('zoom');

  if (!latRaw || !lngRaw || !zoomRaw) return null;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const zoom = Number(zoomRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng, zoom };
}

function parsePinnedParamsFromUrl(): PinnedParams | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const pinRaw = params.get('pin');
  const hasPin = pinRaw === '1' || pinRaw === 'true' || pinRaw === 't' || pinRaw === 'yes' || pinRaw === 'y';
  if (!hasPin) return null;

  const latRaw = params.get('lat');
  const lngRaw = params.get('lng');
  if (!latRaw || !lngRaw) return null;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const zoomRaw = params.get('z') ?? params.get('zoom');
  const zoom = zoomRaw ? Number(zoomRaw) : undefined;

  return {
    lngLat: new maplibregl.LngLat(lng, lat),
    zoom: typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : undefined,
  };
}

function setUrlViewport({ lat, lng, zoom }: ViewportParams) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.set('lat', lat.toFixed(6));
  url.searchParams.set('lng', lng.toFixed(6));
  url.searchParams.set('z', zoom.toFixed(2));
  url.searchParams.delete('zoom');

  window.history.replaceState(null, '', url.toString());
}

function clearUrlPin() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has('pin')) return;

  url.searchParams.delete('pin');
  window.history.replaceState(null, '', url.toString());
}

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
      ['interpolate', ['linear'], ['get', 'dist_to_crossing_meters'], 0, '#4caf50', 100, '#fdd835', 200, '#e53935', 500, '#b71c1c'],
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

      // Unmarked crossings hit-test layer (DOM markers are rendered separately).
      // Keep this invisible but queryable so we can place Font Awesome markers for
      // currently-visible points.
      {
        id: 'unmarked-crossings-hit',
        type: 'circle',
        source: 'sketchiness',
        'source-layer': 'unmarked_crossings',
        filter: ['>', ['get', 'frogger_index'], 0.2],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 10, 20, 14],
          'circle-color': '#000000',
          'circle-opacity': 0.0,
          'circle-stroke-width': 0,
        },
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
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const unmarkedCrossingMarkersRef = useRef<Map<number, maplibregl.Marker>>(new globalThis.Map());
  const selectedUnmarkedIdRef = useRef<number | null>(null);
  const previouslyHadSelectionRef = useRef(false);
  const unitsRejectTimeoutRef = useRef<number | null>(null);

  const [selected, setSelected] = useState<FeatureInfo | null>(null);
  const [selectedUnmarked, setSelectedUnmarked] = useState<UnmarkedCrossingInfo | null>(null);
  const [unitsRejected, setUnitsRejected] = useState(false);

  useEffect(() => {
    selectedUnmarkedIdRef.current = selectedUnmarked?.id ?? null;
  }, [selectedUnmarked]);

  useEffect(() => {
    if (!unitsRejected) {
      if (unitsRejectTimeoutRef.current !== null) {
        window.clearTimeout(unitsRejectTimeoutRef.current);
        unitsRejectTimeoutRef.current = null;
      }
      return;
    }

    if (unitsRejectTimeoutRef.current !== null) {
      window.clearTimeout(unitsRejectTimeoutRef.current);
    }

    unitsRejectTimeoutRef.current = window.setTimeout(() => {
      setUnitsRejected(false);
      unitsRejectTimeoutRef.current = null;
    }, 1500);

    return () => {
      if (unitsRejectTimeoutRef.current !== null) {
        window.clearTimeout(unitsRejectTimeoutRef.current);
        unitsRejectTimeoutRef.current = null;
      }
    };
  }, [unitsRejected]);

  // If this page was opened via a share link (pin=1), we keep `pin` in the URL
  // while the feature panel is open. Once the panel closes, remove it.
  useEffect(() => {
    const hasSelection = Boolean(selected) || Boolean(selectedUnmarked);
    if (previouslyHadSelectionRef.current && !hasSelection) {
      clearUrlPin();
    }
    previouslyHadSelectionRef.current = hasSelection;
  }, [selected, selectedUnmarked]);

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (typeof window === 'undefined') return false;

    // Prefer modern Clipboard API when available.
    try {
      if (navigator.clipboard && (window.isSecureContext || window.location.hostname === 'localhost')) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to legacy fallback
    }

    // Legacy fallback: temporarily select a hidden textarea and execCommand('copy').
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.left = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleShare = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    if (!selected && !selectedUnmarked) return false;

    const map = mapRef.current;
    const zoom = map ? map.getZoom() : 11;
    const url = new URL(window.location.href);
    const lngLat = selected ? selected.lngLat : selectedUnmarked!.lngLat;
    url.searchParams.set('lat', lngLat.lat.toFixed(6));
    url.searchParams.set('lng', lngLat.lng.toFixed(6));
    url.searchParams.set('z', zoom.toFixed(2));
    url.searchParams.set('pin', '1');
    url.searchParams.delete('zoom');

    const shareText = url.toString();

    return await copyTextToClipboard(shareText);
  };

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

    const initialViewport = parseInitialViewportFromUrl();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: initialViewport ? ([initialViewport.lng, initialViewport.lat] as [number, number]) : SEATTLE_CENTER,
      zoom: initialViewport ? initialViewport.zoom : 11,
      minZoom: 2,
      maxZoom: 20,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    mapRef.current = map;

    const UNMARKED_FROGGER_THRESHOLD = 0.2;

    const createUnmarkedCrossingMarkerElement = () => {
      const el = document.createElement('div');
      el.className = 'unmarked-crossing-marker';
      el.innerHTML =
        '<svg viewBox="-2.4 -2.4 28.80 28.80" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="#ffffff" aria-hidden="true">'
        + '<g stroke-width="0"><rect x="-2.4" y="-2.4" width="28.80" height="28.80" rx="14.4" fill="#ffffff" strokewidth="0"></rect></g>'
        + '<g stroke-linecap="round" stroke-linejoin="round"></g>'
        + '<g>'
        + '<path opacity="0.1" d="M10.2501 5.147L3.64909 17.0287C2.9085 18.3618 3.87244 20 5.39741 20H18.5994C20.1243 20 21.0883 18.3618 20.3477 17.0287L13.7467 5.147C12.9847 3.77538 11.0121 3.77538 10.2501 5.147Z" fill="#ff0000"></path>'
        + '<path d="M12 10V13" stroke="#ff0000" stroke-width="2" stroke-linecap="round"></path>'
        + '<path d="M12 16V15.9888" stroke="#ff0000" stroke-width="2" stroke-linecap="round"></path>'
        + '<path d="M10.2515 5.147L3.65056 17.0287C2.90997 18.3618 3.8739 20 5.39887 20H18.6008C20.1258 20 21.0897 18.3618 20.3491 17.0287L13.7482 5.147C12.9861 3.77538 11.0135 3.77538 10.2515 5.147Z" stroke="#ff0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '</g>'
        + '</svg>';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', 'Unmarked crossing');
      return el;
    };

    const syncUnmarkedCrossingMarkers = () => {
      // Only attempt when the style/layers are loaded.
      if (!map.isStyleLoaded()) return;

      const canvas = map.getCanvas();
      // Use rendered features so geometry coordinates are lng/lat.
      const features = map.queryRenderedFeatures(
        [
          [0, 0],
          [canvas.clientWidth, canvas.clientHeight],
        ],
        { layers: ['unmarked-crossings-hit'] },
      );

      const bounds = map.getBounds();
      const zoom = map.getZoom();

      // Simple decluttering: keep at most one marker per NxN screen grid cell.
      // Smaller cells at higher zoom means "show more" as you zoom in.
      const cellSizePx = Math.round(Math.max(14, Math.min(36, 60 - 2.5 * zoom)));
      const occupiedCells = new Set<string>();

      const nextIds = new Set<number>();

      for (const feature of features) {
        const props = feature.properties;
        if (!props) continue;

        const idRaw = (props as Record<string, unknown>).point_osm_id;
        const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
        if (!Number.isFinite(id)) continue;

        // Defensive: if the filter changes or tiles have weird types.
        const froggerRaw = (props as Record<string, unknown>).frogger_index;
        const frogger = typeof froggerRaw === 'number' ? froggerRaw : Number(froggerRaw);
        if (!Number.isFinite(frogger) || frogger <= UNMARKED_FROGGER_THRESHOLD) continue;

        if (feature.geometry.type !== 'Point') continue;
        const coords = feature.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

        // Keep only markers actually in the viewport.
        if (!bounds.contains([lng, lat])) continue;

        const screen = map.project([lng, lat]);
        if (screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) continue;

        const cellX = Math.floor(screen.x / cellSizePx);
        const cellY = Math.floor(screen.y / cellSizePx);
        const cellKey = `${cellX}:${cellY}`;
        const selectedId = selectedUnmarkedIdRef.current;
        if (selectedId !== id) {
          if (occupiedCells.has(cellKey)) continue;
          occupiedCells.add(cellKey);
        }

        nextIds.add(id);

        const lngLat = new maplibregl.LngLat(lng, lat);
        const existing = unmarkedCrossingMarkersRef.current.get(id);
        if (existing) {
          existing.setLngLat(lngLat);
          existing
            .getElement()
            .classList.toggle('unmarked-crossing-marker--selected', selectedUnmarkedIdRef.current === id);
          continue;
        }

        const element = createUnmarkedCrossingMarkerElement();
        element.classList.toggle('unmarked-crossing-marker--selected', selectedUnmarkedIdRef.current === id);
        element.addEventListener('click', (evt) => {
          evt.stopPropagation();

          // If a share-link pin or previous street selection marker is present, clear it.
          markerRef.current?.remove();
          markerRef.current = null;

          const googleFaviconUrl = 'https://www.google.com/s2/favicons?domain=google.com&sz=32';
          const osmFaviconUrl = 'https://www.google.com/s2/favicons?domain=openstreetmap.org&sz=32';
          const latLng = `${lngLat.lat},${lngLat.lng}`;
          const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLng)}`;
          const osmViewUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lngLat.lat))}&mlon=${encodeURIComponent(
            String(lngLat.lng),
          )}#map=19/${encodeURIComponent(String(lngLat.lat))}/${encodeURIComponent(String(lngLat.lng))}`;

          const reportIssueUrl = reportIssueUrlTemplate ? buildReportIssueUrl(reportIssueUrlTemplate, lngLat, map.getZoom()) : null;

          const p = feature.properties as Record<string, unknown>;
          const froggerIndexRaw = p.frogger_index;
          const froggerIndex = typeof froggerIndexRaw === 'number' ? froggerIndexRaw : Number(froggerIndexRaw);

          const lanesRaw = p.frogger_lanes;
          const lanes = typeof lanesRaw === 'number' ? lanesRaw : lanesRaw != null ? Number(lanesRaw) : null;

          const maxspeed = typeof p.frogger_maxspeed === 'string' ? p.frogger_maxspeed : null;

          const speedMphRaw = p.frogger_speed_mph;
          const speedMph = typeof speedMphRaw === 'number' ? speedMphRaw : speedMphRaw != null ? Number(speedMphRaw) : null;

          const distRaw = p.frogger_dist_to_marked_crosswalk_m;
          const distanceToMarkedCrosswalkMeters =
            typeof distRaw === 'number' ? distRaw : distRaw != null ? Number(distRaw) : null;

          const roadName = typeof p.frogger_road_name === 'string' ? p.frogger_road_name : null;
          const roadHighway = typeof p.frogger_road_highway === 'string' ? p.frogger_road_highway : null;

          setSelected(null);
          selectedUnmarkedIdRef.current = id;
          setSelectedUnmarked({
            id,
            title: buildUnmarkedCrossingTitle(roadName),
            roadName,
            lngLat,
            froggerIndex: Number.isFinite(froggerIndex) ? froggerIndex : 0,
            lanes: Number.isFinite(lanes as number) ? (lanes as number) : null,
            maxspeed,
            speedMph: Number.isFinite(speedMph as number) ? (speedMph as number) : null,
            distanceToMarkedCrosswalkMeters: Number.isFinite(distanceToMarkedCrosswalkMeters as number)
              ? (distanceToMarkedCrosswalkMeters as number)
              : null,
            roadHighway,
            actions: [
              { href: streetViewUrl, label: 'Street View', iconUrl: googleFaviconUrl },
              { href: osmViewUrl, label: 'OSM', iconUrl: osmFaviconUrl },
            ],
            reportIssueUrl,
          });
        });

        element.addEventListener('keydown', (evt) => {
          if (evt.key !== 'Enter' && evt.key !== ' ') return;
          evt.preventDefault();
          element.click();
        });

        const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(lngLat).addTo(map);
        unmarkedCrossingMarkersRef.current.set(id, marker);
      }

      // Remove markers that are no longer in view.
      for (const [id, marker] of unmarkedCrossingMarkersRef.current.entries()) {
        if (nextIds.has(id)) continue;
        marker.remove();
        unmarkedCrossingMarkersRef.current.delete(id);
      }
    };

    const buildFeatureInfoFromProps = (props: maplibregl.GeoJSONFeature['properties'], coordinates: maplibregl.LngLat) => {
      if (!props) return null;

      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

      let displayName = props.name;
      const highwayType = props.highway ? capitalize(props.highway) : 'Unknown Type';
      const isResidential = props.highway === 'residential';

      if (!displayName) {
        displayName = `${highwayType} Road`;
      }

      const distanceMeters =
        typeof props.dist_to_crossing_meters === 'number' ? Math.round(props.dist_to_crossing_meters) : null;

      const froggerIndexRaw = (props as Record<string, unknown>).frogger_index;
      const froggerIndex = typeof froggerIndexRaw === 'number' ? froggerIndexRaw : froggerIndexRaw != null ? Number(froggerIndexRaw) : null;

      const lanesRaw = (props as Record<string, unknown>).lanes;
      const lanes = typeof lanesRaw === 'number' ? lanesRaw : lanesRaw != null ? Number(lanesRaw) : null;

      const maxspeed = typeof (props as Record<string, unknown>).maxspeed === 'string' ? ((props as Record<string, unknown>).maxspeed as string) : null;

      const latLng = `${coordinates.lat},${coordinates.lng}`;
      const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLng)}`;

      const osmViewUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
        String(coordinates.lat),
      )}&mlon=${encodeURIComponent(String(coordinates.lng))}#map=19/${encodeURIComponent(
        String(coordinates.lat),
      )}/${encodeURIComponent(String(coordinates.lng))}`;

      const googleFaviconUrl = 'https://www.google.com/s2/favicons?domain=google.com&sz=32';
      const osmFaviconUrl = 'https://www.google.com/s2/favicons?domain=openstreetmap.org&sz=32';

      const reportIssueUrl = reportIssueUrlTemplate ? buildReportIssueUrl(reportIssueUrlTemplate, coordinates, map.getZoom()) : null;

      return {
        title: displayName,
        highwayType,
        isResidential,
        distanceMeters,
        froggerIndex: typeof froggerIndex === 'number' && Number.isFinite(froggerIndex) ? froggerIndex : null,
        lanes: typeof lanes === 'number' && Number.isFinite(lanes) ? lanes : null,
        maxspeed,
        lngLat: coordinates,
        actions: [
          { href: streetViewUrl, label: 'Street View', iconUrl: googleFaviconUrl },
          { href: osmViewUrl, label: 'OSM', iconUrl: osmFaviconUrl },
        ],
        reportIssueUrl,
      } satisfies FeatureInfo;
    };

    const buildUnmarkedCrossingInfoFromProps = (
      props: maplibregl.GeoJSONFeature['properties'],
      coordinates: maplibregl.LngLat,
    ): UnmarkedCrossingInfo | null => {
      if (!props) return null;

      const googleFaviconUrl = 'https://www.google.com/s2/favicons?domain=google.com&sz=32';
      const osmFaviconUrl = 'https://www.google.com/s2/favicons?domain=openstreetmap.org&sz=32';

      const latLng = `${coordinates.lat},${coordinates.lng}`;
      const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLng)}`;
      const osmViewUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
        String(coordinates.lat),
      )}&mlon=${encodeURIComponent(String(coordinates.lng))}#map=19/${encodeURIComponent(
        String(coordinates.lat),
      )}/${encodeURIComponent(String(coordinates.lng))}`;

      const reportIssueUrl = reportIssueUrlTemplate
        ? buildReportIssueUrl(reportIssueUrlTemplate, coordinates, map.getZoom())
        : null;

      const p = props as Record<string, unknown>;

      const idRaw = p.point_osm_id;
      const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
      if (!Number.isFinite(id)) return null;

      const froggerIndexRaw = p.frogger_index;
      const froggerIndex = typeof froggerIndexRaw === 'number' ? froggerIndexRaw : Number(froggerIndexRaw);

      const lanesRaw = p.frogger_lanes;
      const lanes = typeof lanesRaw === 'number' ? lanesRaw : lanesRaw != null ? Number(lanesRaw) : null;

      const distRaw = p.frogger_dist_to_marked_crosswalk_m;
      const distanceToMarkedCrosswalkMeters =
        typeof distRaw === 'number' ? distRaw : distRaw != null ? Number(distRaw) : null;

      const maxspeed = typeof p.frogger_maxspeed === 'string' ? p.frogger_maxspeed : null;
      const roadName = typeof p.frogger_road_name === 'string' ? p.frogger_road_name : null;
      const roadHighway = typeof p.frogger_road_highway === 'string' ? p.frogger_road_highway : null;

      // Keep speedMph in the model in case we want it later,
      // but the panel currently doesn't display it.
      const speedMphRaw = p.frogger_speed_mph;
      const speedMph = typeof speedMphRaw === 'number' ? speedMphRaw : speedMphRaw != null ? Number(speedMphRaw) : null;

      return {
        id,
        title: buildUnmarkedCrossingTitle(roadName),
        roadName,
        lngLat: coordinates,
        froggerIndex: Number.isFinite(froggerIndex) ? froggerIndex : 0,
        lanes: Number.isFinite(lanes as number) ? (lanes as number) : null,
        maxspeed,
        speedMph: Number.isFinite(speedMph as number) ? (speedMph as number) : null,
        distanceToMarkedCrosswalkMeters: Number.isFinite(distanceToMarkedCrosswalkMeters as number)
          ? (distanceToMarkedCrosswalkMeters as number)
          : null,
        roadHighway,
        actions: [
          { href: streetViewUrl, label: 'Street View', iconUrl: googleFaviconUrl },
          { href: osmViewUrl, label: 'OSM', iconUrl: osmFaviconUrl },
        ],
        reportIssueUrl,
      } satisfies UnmarkedCrossingInfo;
    };

    const applyPinnedLocationFromUrl = () => {
      const pinned = parsePinnedParamsFromUrl();
      if (!pinned) return;

      const coordinates = pinned.lngLat;

      // Try to resolve the actual feature at this point so the info panel opens.
      const point = map.project(coordinates);
      const pad = 6;
      const features = map.queryRenderedFeatures(
        [
          [point.x - pad, point.y - pad],
          [point.x + pad, point.y + pad],
        ],
        { layers: [...SKETCHINESS_LAYER_IDS, 'unmarked-crossings-hit'] },
      );

      if (features.length === 0) return;

      const top = features[0];
      if (top.layer.id === 'unmarked-crossings-hit') {
        // For unmarked crossings, open the panel but don't add a pin marker.
        markerRef.current?.remove();
        markerRef.current = null;

        const info = buildUnmarkedCrossingInfoFromProps(top.properties, coordinates);
        if (!info) return;
        setSelected(null);
        selectedUnmarkedIdRef.current = info.id;
        setSelectedUnmarked(info);

        // The first `idle` event may have already created markers before we knew
        // which one is selected; resync immediately so the selected one gets the
        // highlighted style.
        syncUnmarkedCrossingMarkers();
        return;
      }

      // For streets, keep the existing share-link behavior: drop a pin marker.
      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker().setLngLat(coordinates).addTo(map);
      } else {
        markerRef.current.setLngLat(coordinates);
      }

      const info = buildFeatureInfoFromProps(top.properties, coordinates);
      if (!info) return;
      setSelectedUnmarked(null);
      selectedUnmarkedIdRef.current = null;
      setSelected(info);
    };

    const syncUrlToMapViewport = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setUrlViewport({ lat: center.lat, lng: center.lng, zoom });
    };

    map.on('load', syncUrlToMapViewport);
    map.on('moveend', syncUrlToMapViewport);

    // Keep unmarked crossing DOM markers in sync with what tiles are visible.
    map.on('idle', syncUnmarkedCrossingMarkers);
    map.on('moveend', syncUnmarkedCrossingMarkers);

    // If this URL was created via Share (pin=1), drop a marker (and select the feature if possible).
    map.once('idle', applyPinnedLocationFromUrl);

    // Add click handler for sketchiness lines
    const onSketchinessClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;
      
      if (!props) return;

      const lngLatLike = (e as unknown as { lngLat?: maplibregl.LngLatLike }).lngLat;
      if (!lngLatLike) return;
      const coordinates = maplibregl.LngLat.convert(lngLatLike);

      const info = buildFeatureInfoFromProps(props, coordinates);
      if (!info) return;

      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker().setLngLat(coordinates).addTo(map);
      } else {
        markerRef.current.setLngLat(coordinates);
      }

      setSelected(info);
      setSelectedUnmarked(null);
      selectedUnmarkedIdRef.current = null;
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

    // Clear selection when clicking away from a feature.
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [...SKETCHINESS_LAYER_IDS, 'unmarked-crossings-hit'],
      });
      if (features.length > 0) return;

      markerRef.current?.remove();
      markerRef.current = null;
      setSelected(null);
      setSelectedUnmarked(null);
      selectedUnmarkedIdRef.current = null;
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;

      for (const marker of unmarkedCrossingMarkersRef.current.values()) {
        marker.remove();
      }
      unmarkedCrossingMarkersRef.current.clear();

      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, [style]);

  return (
    <div className={selected || selectedUnmarked ? 'map-shell map-shell--has-selection' : 'map-shell'}>
      <div id="map" ref={mapContainerRef} />

      {selected ? <FeatureInfoPanel info={selected} onShare={handleShare} /> : null}
      {selectedUnmarked ? <UnmarkedCrossingInfoPanel info={selectedUnmarked} onShare={handleShare} /> : null}

      <div className="map-overlay map-overlay--title" role="heading" aria-level={1}>
        Seattle Crosswalk Availability Map
      </div>

      <div className="map-overlay map-overlay--legend" aria-label="Legend">
        <div className="legend-title">Legend</div>
        <div className="legend-row">
          <span className="legend-line legend-line--green" />
          <span>0–100m to crossing (and residential streets)</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--yellow" />
          <span>100–200m</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--red" />
          <span>200–500m</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--darkred" />
          <span>500m+</span>
        </div>

        <div className="legend-actions">
          {unitsRejected ? (
            <span className="legend-no" aria-live="polite">
              no! 🙂
            </span>
          ) : (
            <button type="button" className="legend-button" onClick={() => setUnitsRejected(true)}>
              Change units
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
