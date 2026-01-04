'use client';

import type maplibregl from 'maplibre-gl';

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

export default function FeatureInfoPanel({ info }: { info: FeatureInfo }) {
  return (
    <div className="map-overlay map-overlay--info" aria-label="Selected street">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{info.title}</div>

        <div style={{ fontSize: 12 }}>
          <div>Type: {info.highwayType}</div>
          {!info.isResidential && typeof info.distanceMeters === 'number' ? (
            <div>
              Dist to Crosswalk: <strong>{info.distanceMeters}m</strong>
            </div>
          ) : null}
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
