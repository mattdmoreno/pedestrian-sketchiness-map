'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';

type GameParams = {
  name: string;
  highway: string;
  lanes: number;
  speedMph: number | null;
  distToMarkedM: number | null;
  froggerIndex: number | null;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseParams(sp: URLSearchParams): GameParams {
  const name = (sp.get('name') ?? '').trim();
  const highway = (sp.get('highway') ?? '').trim();

  const lanesRaw = Number(sp.get('lanes'));
  const lanes = clampInt(lanesRaw, 1, 8);

  const speedRaw = sp.get('speed');
  const speedMph = speedRaw != null && speedRaw !== '' ? Number(speedRaw) : null;
  const speedMphClean = typeof speedMph === 'number' && Number.isFinite(speedMph) ? clampNumber(speedMph, 1, 80) : null;

  const distRaw = sp.get('dist');
  const dist = distRaw != null && distRaw !== '' ? Number(distRaw) : null;
  const distClean = typeof dist === 'number' && Number.isFinite(dist) ? Math.max(0, dist) : null;

  const froggerIndexRaw = sp.get('fi');
  const fi = froggerIndexRaw != null && froggerIndexRaw !== '' ? Number(froggerIndexRaw) : null;
  const froggerIndex = typeof fi === 'number' && Number.isFinite(fi) ? clampNumber(fi, 0, 1) : null;

  return {
    name: name || 'Unknown street',
    highway: highway || 'Unknown type',
    lanes,
    speedMph: speedMphClean,
    distToMarkedM: distClean,
    froggerIndex,
  };
}

function froggerDifficultyLabel(froggerIndex: number | null): string {
  if (typeof froggerIndex !== 'number' || !Number.isFinite(froggerIndex)) return 'easy';
  if (froggerIndex < 0.2) return 'easy';
  if (froggerIndex < 0.4) return 'medium';
  if (froggerIndex < 0.6) return 'hard';
  return 'Ft. Lauderdale';
}

type Car = {
  laneIndex: number;
  x: number;
  width: number;
  speedPxPerSec: number;
  dir: 1 | -1;
};

type SpawnState = {
  t: number;
  nextSpawnByLane: number[];
  carSpeedPxPerSec: number;
};

function SpeedLimitSign({ speedMph }: { speedMph: number | null }) {
  const speedText = typeof speedMph === 'number' && Number.isFinite(speedMph) ? String(Math.round(speedMph)) : '?';

  return (
    <div
      style={{
        width: 110,
        border: '3px solid rgba(0, 0, 0, 0.85)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        padding: '8px 10px',
        textAlign: 'center',
        lineHeight: 1,
        userSelect: 'none',
      }}
      aria-label="Speed limit"
    >
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.8 }}>SPEED</div>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.8, marginTop: 2 }}>LIMIT</div>
      <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>{speedText}</div>
      <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>MPH</div>
    </div>
  );
}

function LanesBadge({ lanes }: { lanes: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '3px solid rgba(0, 0, 0, 0.85)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        padding: '10px 14px',
        minWidth: 140,
        textAlign: 'center',
        lineHeight: 1,
        userSelect: 'none',
      }}
      aria-label="Lane count"
    >
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.8 }}>LANES</div>
      <div style={{ fontSize: 38, fontWeight: 900, marginTop: 8 }}>{lanes}</div>
    </div>
  );
}

export default function FroggerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const params = useMemo(() => parseParams(searchParams), [searchParams]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const animationRef = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);

  const carsRef = useRef<Car[]>([]);
  const playerRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 16, h: 16 });
  const spawnRef = useRef<SpawnState | null>(null);

  const [status, setStatus] = useState<'playing' | 'hit' | 'won'>('playing');
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const laneH = 70;
    const safeH = 86;

    const randomSpawnDelaySec = (speedMph: number | null) => {
      // Faster streets feel "busier" by spawning slightly more often.
      const mph = typeof speedMph === 'number' && Number.isFinite(speedMph) ? speedMph : 25;
      const base = clampNumber(1.6 - mph / 80, 0.7, 1.6);
      return base * (0.6 + Math.random() * 0.9);
    };

    const resize = () => {
      const width = Math.max(280, Math.min(720, Math.floor(container.getBoundingClientRect().width)));
      const height = safeH + params.lanes * laneH + safeH;
      canvas.width = width;
      canvas.height = height;

      // Reset player position whenever size/params change.
      playerRef.current.w = 24;
      playerRef.current.h = 24;
      playerRef.current.x = Math.floor(width / 2 - playerRef.current.w / 2);
      playerRef.current.y = height - safeH + Math.floor((safeH - playerRef.current.h) / 2);

      // Re-seed cars.
      const assumedSpeed = params.speedMph ?? 25;
      // Map MPH -> px/s: 25mph ≈ 140px/s, clamped.
      const basePx = clampNumber((assumedSpeed / 25) * 170, 80, 520);

      carsRef.current = [];
      spawnRef.current = {
        t: 0,
        nextSpawnByLane: Array.from({ length: params.lanes }, () => randomSpawnDelaySec(params.speedMph)),
        carSpeedPxPerSec: basePx,
      };
      setStatus('playing');
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [params.lanes, params.speedMph, resetToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const laneH = 70;
    const safeH = 86;

    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key.startsWith('Arrow')) evt.preventDefault();

      if (status !== 'playing') {
        if (evt.key === 'Enter' || evt.key === ' ') {
          setResetToken((t) => t + 1);
        }
        return;
      }

      const p = playerRef.current;
      const stepX = 30;
      const stepY = 30;

      let dx = 0;
      let dy = 0;

      const key = evt.key.toLowerCase();
      if (evt.key === 'ArrowLeft' || key === 'a') dx = -stepX;
      if (evt.key === 'ArrowRight' || key === 'd') dx = stepX;
      if (evt.key === 'ArrowUp' || key === 'w') dy = -stepY;
      if (evt.key === 'ArrowDown' || key === 's') dy = stepY;

      if (!dx && !dy) return;

      p.x += dx;
      p.y += dy;

      p.x = clampNumber(p.x, 0, canvas.width - p.w);
      p.y = clampNumber(p.y, 0, canvas.height - p.h);

      // Win condition: reach the top safe zone.
      if (p.y <= Math.floor((safeH - p.h) / 2)) {
        setStatus('won');
      }
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown as any);
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const laneH = 70;
    const safeH = 86;

    const tick = (t: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const lastT = lastTRef.current;
      lastTRef.current = t;
      const dt = typeof lastT === 'number' ? Math.min(0.05, (t - lastT) / 1000) : 0;

      // Background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Safe zones
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillRect(0, 0, canvas.width, safeH);
      ctx.fillRect(0, canvas.height - safeH, canvas.width, safeH);

      // Road
      const roadY = safeH;
      const roadH = params.lanes * laneH;
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(0, roadY, canvas.width, roadH);

      // Lane lines
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      for (let i = 1; i < params.lanes; i++) {
        const y = roadY + i * laneH;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Double center line
      if (params.lanes >= 2) {
        const midY = roadY + roadH / 2;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, midY - 5);
        ctx.lineTo(canvas.width, midY - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, midY + 5);
        ctx.lineTo(canvas.width, midY + 5);
        ctx.stroke();
      }

      // Spawn cars at random times
      if (status === 'playing' && dt > 0) {
        const spawn = spawnRef.current;
        if (spawn) {
          spawn.t += dt;

          for (let laneIndex = 0; laneIndex < params.lanes; laneIndex++) {
            if (spawn.t < spawn.nextSpawnByLane[laneIndex]) continue;

            const dir: 1 | -1 = laneIndex % 2 === 0 ? 1 : -1;
            const widthVar = 70 + Math.floor(Math.random() * 50);
            const startX = dir === 1 ? -widthVar - 10 : canvas.width + widthVar + 10;
            carsRef.current.push({
              laneIndex,
              x: startX,
              width: widthVar,
              speedPxPerSec: spawn.carSpeedPxPerSec,
              dir,
            });

            const mph = params.speedMph ?? 25;
            const base = clampNumber(1.6 - mph / 80, 0.7, 1.6);
            spawn.nextSpawnByLane[laneIndex] = spawn.t + base * (0.6 + Math.random() * 0.9);
          }
        }
      }

      // Cars
      const cars = carsRef.current;
      if (status === 'playing' && dt > 0 && cars.length) {
        for (const car of cars) {
          car.x += car.dir * car.speedPxPerSec * dt;
        }

        // Drop cars that are well offscreen.
        carsRef.current = cars.filter((car) => !(car.x < -car.width - 120 || car.x > canvas.width + car.width + 120));
      }

      for (const car of carsRef.current) {

        const yCenter = roadY + car.laneIndex * laneH + laneH / 2;
        const carH = 26;
        const carY = Math.floor(yCenter - carH / 2);

        ctx.fillStyle = '#e53935';
        ctx.fillRect(Math.floor(car.x), carY, car.width, carH);
      }

      // Player
      const p = playerRef.current;
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.w, p.h);

      // Collision
      if (status === 'playing') {
        const px1 = p.x;
        const py1 = p.y;
        const px2 = p.x + p.w;
        const py2 = p.y + p.h;

        for (const car of carsRef.current) {
          const yCenter = roadY + car.laneIndex * laneH + laneH / 2;
          const carH = 18;
          const carY1 = yCenter - carH / 2;
          const carY2 = carY1 + carH;
          const carX1 = car.x;
          const carX2 = car.x + car.width;

          const hit = px1 < carX2 && px2 > carX1 && py1 < carY2 && py2 > carY1;
          if (hit) {
            setStatus('hit');
            break;
          }
        }
      }

      // Overlay text
      ctx.fillStyle = '#111';
      ctx.font = 'bold 14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillText('Goal: reach the top sidewalk', 14, 22);

      if (status === 'hit') {
        ctx.fillStyle = '#e53935';
        ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Hit! Press Enter to restart.', 14, canvas.height - 18);
      }
      if (status === 'won') {
        ctx.fillStyle = '#4caf50';
        ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Made it! Press Enter to play again.', 14, canvas.height - 18);
      }

      animationRef.current = window.requestAnimationFrame(tick);
    };

    animationRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      lastTRef.current = null;
    };
  }, [params.lanes, params.speedMph, status]);

  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  const onReset = () => {
    setResetToken((t) => t + 1);
  };

  const difficulty = froggerDifficultyLabel(params.froggerIndex);

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: 12,
        background: '#f8f8f8',
        color: '#111',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: 'min(960px, 100%)',
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 8,
          padding: '14px 16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.92)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 800,
                lineHeight: 1.1,
              }}
              aria-label="Back to map"
            >
              <i className="fa-solid fa-arrow-left" aria-hidden="true" />
              Back to map
            </button>

            <button
              type="button"
              onClick={onReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.92)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 800,
                lineHeight: 1.1,
              }}
              aria-label="Reset"
            >
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
              Reset
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <LanesBadge lanes={params.lanes} />
            <SpeedLimitSign speedMph={params.speedMph} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>{params.name}</div>
        </div>

        <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: 'rgba(0, 0, 0, 0.75)' }}>
          {params.highway} oreach {params.lanes} lane{params.lanes === 1 ? '' : 's'}
          {typeof params.distToMarkedM === 'number' ? `  distance to nearest marked crosswalk: ${Math.round(params.distToMarkedM)}m` : ''}
        </div>

        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>
            Good luck!
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '10px 14px',
              border: '1px solid rgba(0, 0, 0, 0.12)',
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.92)',
              fontSize: 14,
              fontWeight: 900,
              whiteSpace: 'nowrap',
            }}
            aria-label="Frogger difficulty"
          >
            <span>Frogger:</span>
            <span>{typeof params.froggerIndex === 'number' ? params.froggerIndex.toFixed(2) : '—'}</span>
            <span style={{ fontWeight: 800, color: 'rgba(0, 0, 0, 0.75)' }}>({difficulty})</span>
          </div>
        </div>

        {typeof params.distToMarkedM === 'number' ? (
          <div style={{ marginTop: 12 }} aria-label="Distance to nearest marked crosswalk">
            <svg width="100%" height="44" viewBox="0 0 1000 44" role="img" aria-label="Distance arrow">
              <defs>
                <marker id="arrowHead" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto">
                  <polygon points="0,0 12,5 0,10" fill="#111" />
                </marker>
              </defs>
              <line x1="24" y1="22" x2="976" y2="22" stroke="#111" strokeWidth="4" markerEnd="url(#arrowHead)" />
              <text x="500" y="16" textAnchor="middle" fontSize="16" fontWeight="800" fill="#111">
                {Math.round(params.distToMarkedM)}m to nearest marked crosswalk
              </text>
            </svg>
          </div>
        ) : null}

        <div style={{ marginTop: 10 }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              borderRadius: 8,
              border: '1px solid rgba(0, 0, 0, 0.12)',
              background: '#f8f8f8',
            }}
            aria-label="Frogger game"
          />
        </div>

        <div style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: 'rgba(0, 0, 0, 0.75)' }}>
          Controls: arrow keys or WASD. Press Enter to restart.
        </div>
      </div>
    </div>
  );
}
