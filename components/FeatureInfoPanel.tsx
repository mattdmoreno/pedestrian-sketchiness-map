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
}): string {
  const sp = new URLSearchParams();
  if (params.name) sp.set('name', params.name);
  if (params.highway) sp.set('highway', params.highway);
  if (typeof params.lanes === 'number' && Number.isFinite(params.lanes)) sp.set('lanes', String(params.lanes));
  if (typeof params.speedMph === 'number' && Number.isFinite(params.speedMph)) sp.set('speed', String(params.speedMph));
  if (typeof params.distToMarkedM === 'number' && Number.isFinite(params.distToMarkedM)) sp.set('dist', String(params.distToMarkedM));
  if (typeof params.froggerIndex === 'number' && Number.isFinite(params.froggerIndex)) sp.set('fi', String(params.froggerIndex));
  return `/frogger?${sp.toString()}`;
}

function froggerDifficultyLabel(froggerIndex: number): string {
  if (!Number.isFinite(froggerIndex)) return 'easy';
  if (froggerIndex < 0.2) return 'easy';
  if (froggerIndex < 0.4) return 'medium';
  if (froggerIndex < 0.6) return 'hard';
  return 'Ft. Lauderdale';
}

export default function FeatureInfoPanel({
  info,
  onShare,
}: {
  info: FeatureInfo;
  onShare: () => Promise<boolean>;
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

  const speedMph = maybeParseSpeedMph(info.maxspeed);
  const froggerHref = buildFroggerHref({
    name: info.title ?? null,
    highway: info.highwayType ?? null,
    lanes: typeof info.lanes === 'number' ? info.lanes : null,
    speedMph,
    distToMarkedM: typeof info.distanceMeters === 'number' ? info.distanceMeters : null,
    froggerIndex: typeof info.froggerIndex === 'number' && Number.isFinite(info.froggerIndex) ? info.froggerIndex : null,
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

        <table style={tableStyle}>
          <tbody>
            <tr>
              <td style={tableKeyStyle}>Type</td>
              <td style={tableValueStyle}>{info.highwayType}</td>
            </tr>
            {!info.isResidential && typeof info.distanceMeters === 'number' ? (
              <tr>
                <td style={tableKeyStyle}>Dist to marked</td>
                <td style={tableValueStyle}>
                  <strong>{info.distanceMeters}m</strong>
                </td>
              </tr>
            ) : null}
            {typeof info.lanes === 'number' ? (
              <tr>
                <td style={tableKeyStyle}>Lanes</td>
                <td style={tableValueStyle}>
                  <strong>{info.lanes}</strong>
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
            <tr>
              <td style={{ ...tableKeyStyle, paddingTop: 8 }}>Play Frogger</td>
              <td style={{ ...tableValueStyle, paddingTop: 8 }}>
                <a href={froggerHref} style={{ ...buttonStyle, padding: '6px 10px' }} aria-label="Play Frogger">
                  <i className="fa-solid fa-play" aria-hidden="true" />
                  Play
                </a>
              </td>
            </tr>
          </tbody>
        </table>

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
