'use client';

import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

type ActionLink = {
  href: string;
  label: string;
  iconUrl?: string;
};

export type FeatureInfo = {
  title: string;
  highwayType: string;
  isResidential: boolean;
  distanceMeters?: number | null;
  froggerIndex?: number | null;
  lanes?: number | null;
  maxspeed?: string | null;
  lngLat: maplibregl.LngLat;
  zoom?: number;
  actions: ActionLink[];
  reportIssueUrl?: string | null;
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid rgba(0, 0, 0, 0.12)',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  background: 'rgba(255, 255, 255, 0.92)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

const iconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  flex: '0 0 auto',
  objectFit: 'contain',
  display: 'block',
};

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: '1px solid rgba(0, 0, 0, 0.12)',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.92)',
  color: 'inherit',
  cursor: 'pointer',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};

const tableKeyStyle: React.CSSProperties = {
  padding: '3px 6px 3px 0',
  verticalAlign: 'top',
  color: 'rgba(0, 0, 0, 0.75)',
  whiteSpace: 'nowrap',
};

const tableValueStyle: React.CSSProperties = {
  padding: '3px 0',
  verticalAlign: 'top',
};

function maybeParseSpeedMph(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function buildFroggerHref(params: {
  name: string | null;
  highway: string | null;
  lanes: number | null;
  speedMph: number | null;
  distToMarkedM: number | null;
  froggerIndex: number | null;
  lngLat?: maplibregl.LngLat;
  zoom?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.name) sp.set('name', params.name);
  if (params.highway) sp.set('highway', params.highway);
  if (typeof params.lanes === 'number' && Number.isFinite(params.lanes)) sp.set('lanes', String(params.lanes));
  if (typeof params.speedMph === 'number' && Number.isFinite(params.speedMph)) sp.set('speed', String(params.speedMph));
  if (typeof params.distToMarkedM === 'number' && Number.isFinite(params.distToMarkedM)) sp.set('dist', String(params.distToMarkedM));
  if (typeof params.froggerIndex === 'number' && Number.isFinite(params.froggerIndex)) sp.set('fi', String(params.froggerIndex));
  // Add lat/lng/z if available
  if (params.lngLat && typeof params.lngLat.lat === 'number' && typeof params.lngLat.lng === 'number') {
    sp.set('lat', params.lngLat.lat.toFixed(6));
    sp.set('lng', params.lngLat.lng.toFixed(6));
    if (typeof params.zoom === 'number' && Number.isFinite(params.zoom)) {
      sp.set('z', params.zoom.toFixed(2));
    }
  }
  let base = '';
  if (typeof window !== 'undefined') {
    base = window.location.origin;
    // If running on GitHub Pages, add repo name
    if (window.location.pathname.startsWith('/pedestrian-sketchiness-map')) {
      base += '/pedestrian-sketchiness-map';
    }
  }
  return `${base}/frogger?${sp.toString()}`;
}

function formatMaybeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const num = typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(num) ? num : null;
}

function froggerDifficultyLabel(froggerIndex: number): string {
  if (!Number.isFinite(froggerIndex)) return 'easy';
  if (froggerIndex < 0.2) return 'easy';
  if (froggerIndex < 0.4) return 'medium';
  if (froggerIndex < 0.6) return 'hard';
  // Spec defines 0.6–0.8 = Ft. Lauderdale; indexes above 0.8 are also Ft. Lauderdale.
  // Treat anything >=0.6 as this top bucket.
  return 'Ft. Lauderdale';
}

export default function FeatureInfoPanel({
  info,
  onShare,
  unitIndex,
}: {
  info: FeatureInfo;
  onShare: () => Promise<boolean>;
  unitIndex: number;
}) {
  const [tooltip, setTooltip] = useState<'hidden' | 'copy' | 'copied' | 'failed'>('hidden');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const onShareClick = async () => {
    const ok = await onShare();
    setTooltip(ok ? 'copied' : 'failed');

    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setTooltip('hidden'), 1200);
  };

  const lanes = formatMaybeNumber(info.lanes);
  const dist = formatMaybeNumber(info.distanceMeters);

  // Unit conversion logic
  let distDisplay: string | null = null;
  let unitLabel = '';
  if (typeof dist === 'number') {
    if (unitIndex === 0 || unitIndex === 3) {
      distDisplay = Math.round(dist).toString();
      unitLabel = 'm';
    } else if (unitIndex === 1) {
      distDisplay = Math.round(dist * 3.28084).toString();
      unitLabel = 'ft';
    } else if (unitIndex === 2) {
      // Football fields: 110m each, 1 decimal place
      distDisplay = (dist / 110).toFixed(1);
      unitLabel = 'football fields';
    } else if (unitIndex === 4) {
      // Bald eagles: 2m each, 1 decimal place
      distDisplay = (dist / 2).toFixed(1);
      unitLabel = 'bald eagles';
    }
  }
  const speedMph = formatMaybeNumber(info.maxspeed) ?? maybeParseSpeedMph(info.maxspeed);
  const froggerHref = buildFroggerHref({
    name: info.title ?? null,
    highway: info.highwayType ?? null,
    lanes,
    speedMph,
    distToMarkedM: dist,
    froggerIndex: typeof info.froggerIndex === 'number' && Number.isFinite(info.froggerIndex) ? info.froggerIndex : null,
    lngLat: info.lngLat,
    zoom: typeof info.zoom === 'number' ? info.zoom : undefined,
  });

  return (
    <div className="map-overlay map-overlay--info" aria-label="Selected street">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{info.title}</div>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              type="button"
              onClick={onShareClick}
              onMouseEnter={() => setTooltip('copy')}
              onMouseLeave={() => setTooltip('hidden')}
              aria-label="Copy link"
              title="Copy link"
              style={iconButtonStyle}
            >
              <i className="fa-solid fa-share-nodes" aria-hidden="true" />
            </button>
            <div
              style={{
                position: 'absolute',
                top: 34,
                right: 0,
                padding: '4px 6px',
                borderRadius: 6,
                border: '1px solid rgba(0, 0, 0, 0.12)',
                background: 'rgba(255, 255, 255, 0.92)',
                fontSize: 12,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                opacity: tooltip === 'hidden' ? 0 : 1,
                transform: tooltip === 'hidden' ? 'translateY(2px)' : 'translateY(0)',
                transition: 'opacity 120ms ease-out, transform 120ms ease-out',
              }}
            >
              {tooltip === 'copied' ? 'Copied!' : tooltip === 'failed' ? 'Copy failed' : 'Copy link'}
            </div>
          </div>
        </div>
        {/* Frogger Score Row */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1b5e20', margin: '2px 0 2px 0' }}>
          Frogger Difficulty Index: <span style={{ fontWeight: 900 }}>{typeof info.froggerIndex === 'number' && Number.isFinite(info.froggerIndex) ? info.froggerIndex.toFixed(2) : '—'}</span>
        </div>

        <table style={tableStyle}>
          <tbody>
            {typeof distDisplay === 'string' ? (
              <tr>
                <td style={tableKeyStyle}>Dist to marked crossing</td>
                <td style={tableValueStyle}>
                  <strong>{distDisplay}{unitIndex === 2 || unitIndex === 4 ? '' : unitLabel}</strong>{unitIndex === 2 || unitIndex === 4 ? ` ${unitLabel}` : ''}
                </td>
              </tr>
            ) : null}
            {typeof lanes === 'number' ? (
              <tr>
                <td style={tableKeyStyle}>Lanes</td>
                <td style={tableValueStyle}>
                  <strong>{lanes}</strong>
                </td>
              </tr>
            ) : null}
            {info.maxspeed ? (
              <tr>
                <td style={tableKeyStyle}>Speed limit</td>
                <td style={tableValueStyle}>
                  <strong>{info.maxspeed}</strong>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* Big Try Crossing Button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '12px 0 4px 0' }}>
          <a
            href={froggerHref}
            style={{
              display: 'inline-block',
              background: 'linear-gradient(90deg, #43e97b 0%, #38f9d7 100%)',
              color: '#111',
              fontWeight: 900,
              fontSize: 20,
              borderRadius: 12,
              padding: '18px 36px',
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(60,180,120,0.10)',
              marginBottom: 6,
              border: '2px solid #1b5e20',
              transition: 'background 0.2s',
            }}
            aria-label="Try crossing here"
          >
            Try crossing here*
          </a>
          <div style={{ fontSize: 13, color: '#1b5e20', fontWeight: 700, marginTop: 2 }}>
            *Frogger Difficulty: {froggerDifficultyLabel(typeof info.froggerIndex === 'number' && Number.isFinite(info.froggerIndex) ? info.froggerIndex : 0)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'nowrap' }}>
          {info.actions.map((action) => (
            <a
              key={action.href}
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...buttonStyle, flex: '0 0 auto' }}
            >
              {action.iconUrl ? <img src={action.iconUrl} alt="" style={iconStyle} /> : null}
              {action.label}
            </a>
          ))}
        </div>

        {info.reportIssueUrl ? (
          <div style={{ marginTop: 4, fontSize: 12 }}>
            <a href={info.reportIssueUrl} target="_blank" rel="noopener noreferrer">
              Report an issue
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
