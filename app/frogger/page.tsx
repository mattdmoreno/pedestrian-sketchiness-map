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

const LANE_H_DESKTOP = 60;
const SAFE_H_DESKTOP = 72;
const SAFE_H_MOBILE = 44;
const START_COUNTDOWN_MS = 3000;
const KEY_MOVE_COOLDOWN_MS = 90;

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

function formatRoadType(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Unknown';

  // Turn things like "primary" or "living_street" into "Primary" / "Living Street".
  const normalized = trimmed.replace(/_/g, ' ').replace(/\s{2,}/g, ' ');
  return normalized.replace(/\b\w/g, (m) => m.toUpperCase());
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

function InfoList({
  lanes,
  roadType,
  speedMph,
  froggerIndex,
  difficulty,
  attempts,
}: {
  lanes: number;
  roadType: string;
  speedMph: number | null;
  froggerIndex: number | null;
  difficulty: string;
  attempts: number;
}) {
  const speedText = typeof speedMph === 'number' && Number.isFinite(speedMph) ? `${Math.round(speedMph)} mph` : '—';

  return (
    <div
      className="infoList"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        fontSize: 14,
        fontWeight: 800,
        lineHeight: 1.15,
        minWidth: 220,
      }}
    >
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Lanes:</span> {lanes}
      </div>
      <div className="speedInList">
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Speed:</span> {speedText}
      </div>
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Road type:</span> {roadType}
      </div>
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Frogger difficulty index:</span>{' '}
        {typeof froggerIndex === 'number' ? froggerIndex.toFixed(2) : '—'} ({difficulty})
      </div>
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Attempts:</span> {attempts}
      </div>
    </div>
  );
}

function abbreviateStreetDirections(name: string): string {
  let out = name;

  // Handle combined directions first so we don't convert "Northwest" -> "Nwest".
  const combos: Array<[RegExp, string]> = [
    [/\b(north\s*-?\s*west|northwest)\b/gi, 'NW'],
    [/\b(north\s*-?\s*east|northeast)\b/gi, 'NE'],
    [/\b(south\s*-?\s*west|southwest)\b/gi, 'SW'],
    [/\b(south\s*-?\s*east|southeast)\b/gi, 'SE'],
  ];

  for (const [re, replacement] of combos) {
    out = out.replace(re, replacement);
  }

  const singles: Array<[RegExp, string]> = [
    [/\bnorth\b/gi, 'N'],
    [/\bsouth\b/gi, 'S'],
    [/\beast\b/gi, 'E'],
    [/\bwest\b/gi, 'W'],
  ];

  for (const [re, replacement] of singles) {
    out = out.replace(re, replacement);
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}

function StreetNameSign({ name, className }: { name: string; className?: string }) {
  const displayName = abbreviateStreetDirections(name);
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px 22px',
        borderRadius: 10,
        border: '5px solid rgba(255, 255, 255, 0.95)',
        background: '#1b5e20',
        color: '#fff',
        fontSize: 26,
        fontWeight: 900,
        fontFamily: 'Overpass, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        letterSpacing: 0.2,
        lineHeight: 1,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 'min(680px, calc(100% - 24px))',
        boxShadow: '0 1px 0 rgba(0,0,0,0.10)',
        userSelect: 'none',
      }}
      aria-label="Street name"
    >
      {displayName}
    </div>
  );
}

function DistanceArrowInline({ meters }: { meters: number }) {
  const label = `${Math.round(meters)}m to nearest marked crosswalk`;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        fontSize: 13,
        fontWeight: 800,
        color: 'rgba(0, 0, 0, 0.80)',
        whiteSpace: 'nowrap',
      }}
      aria-label="Distance to nearest marked crosswalk"
      title={label}
    >
      <span>{label}</span>
      <svg width="120" height="14" viewBox="0 0 120 14" role="img" aria-label="Distance arrow">
        <defs>
          <marker id="arrowHeadSmall" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0,0 8,4 0,8" fill="#111" />
          </marker>
        </defs>
        <line x1="0" y1="7" x2="116" y2="7" stroke="#111" strokeWidth="2.5" markerEnd="url(#arrowHeadSmall)" />
      </svg>
    </div>
  );
}

export default function FroggerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const params = useMemo(() => parseParams(searchParams), [searchParams]);

  const [isSmallScreen, setIsSmallScreen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setIsSmallScreen(mq.matches);
    apply();

    // Safari < 14 uses addListener/removeListener.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  const safeH = isSmallScreen ? SAFE_H_MOBILE : SAFE_H_DESKTOP;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const laneHRef = useRef<number>(LANE_H_DESKTOP);

  const animationRef = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);

  const carsRef = useRef<Car[]>([]);
  const playerRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 16, h: 16 });
  const spawnRef = useRef<SpawnState | null>(null);

  const [status, setStatus] = useState<'countdown' | 'playing' | 'hit' | 'won'>('countdown');
  const [resetToken, setResetToken] = useState(0);
  const [attempts, setAttempts] = useState(1);

  const winCooldownUntilRef = useRef<number>(0);
  const startCooldownUntilRef = useRef<number>(0);
  const lastKeyboardMoveAtRef = useRef<number>(0);

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const restartGame = () => {
    setAttempts((a) => a + 1);
    setResetToken((t) => t + 1);
  };

  const restartFromInput = () => {
    if (status === 'won' && nowMs() < winCooldownUntilRef.current) return;
    restartGame();
  };

  const movePlayer = (dx: number, dy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (status === 'countdown') return;

    if (status !== 'playing') {
      restartFromInput();
      return;
    }

    const p = playerRef.current;
    p.x += dx;
    p.y += dy;

    p.x = clampNumber(p.x, 0, canvas.width - p.w);
    p.y = clampNumber(p.y, 0, canvas.height - p.h);

    // Win condition: reach the top safe zone.
    if (p.y <= Math.floor((safeH - p.h) / 2)) {
      winCooldownUntilRef.current = nowMs() + 3000;
      setStatus('won');
    }
  };


  // Make randomSpawnDelaySec available everywhere in the component
  function randomSpawnDelaySec(speedMph: number | null) {
    // Faster streets feel "busier" by spawning slightly more often.
    const mph = typeof speedMph === 'number' && Number.isFinite(speedMph) ? speedMph : 25;
    const base = clampNumber(1.6 - mph / 80, 0.7, 1.6);
    // Adjust by road type
    let roadType = (params.highway || '').toLowerCase();
    let typeMult = 1;
    if (roadType.includes('residential')) typeMult = 6;
    else if (roadType.includes('tertiary')) typeMult = 3;
    else if (roadType.includes('secondary')) typeMult = 2;
    else if (roadType.includes('primary')) typeMult = 1;
    else if (roadType.includes('trunk')) typeMult = 0.75;
    return { base, typeMult, delay: base * (0.6 + Math.random() * 0.9) * typeMult };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const laneHDesktop = LANE_H_DESKTOP;

    const resize = () => {
      const width = Math.max(280, Math.min(720, Math.floor(container.getBoundingClientRect().width)));
      const laneH = isSmallScreen
        ? clampNumber(
            Math.floor(
              ((canvasWrapRef.current?.getBoundingClientRect().height ?? safeH + params.lanes * laneHDesktop + safeH) -
                2 * safeH) /
                params.lanes
            ),
            34,
            64
          )
        : laneHDesktop;

      laneHRef.current = laneH;
      const height = safeH + params.lanes * laneH + safeH;
      canvas.width = width;
      canvas.height = height;

      // Reset player position whenever size/params change.
      playerRef.current.w = 22;
      playerRef.current.h = 22;
      playerRef.current.x = Math.floor(width / 2 - playerRef.current.w / 2);
      playerRef.current.y = height - safeH + Math.floor((safeH - playerRef.current.h) / 2);

      // Re-seed cars.
      const assumedSpeed = params.speedMph ?? 25;
      // Map MPH -> px/s: higher posted speeds should feel faster, clamped for playability.
      const basePx = clampNumber((assumedSpeed / 25) * 210, 90, 640);

      carsRef.current = [];
      spawnRef.current = {
        t: 0,
        nextSpawnByLane: Array.from({ length: params.lanes }, (_, laneIdx) => {
          // If this is the middle lane (for odd lane counts), double the spawn delay
          const { delay } = randomSpawnDelaySec(params.speedMph);
          if (params.lanes % 2 === 1 && laneIdx === Math.floor(params.lanes / 2)) {
            return 0 + delay * 8;
          }
          return 0 + delay;
        }),
        carSpeedPxPerSec: basePx,
      };

      // Prevent "dash across" at the start.
      startCooldownUntilRef.current = nowMs() + START_COUNTDOWN_MS;
      setStatus('countdown');
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [params.lanes, params.speedMph, resetToken, safeH, isSmallScreen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key.startsWith('Arrow')) evt.preventDefault();

      if (status === 'countdown') return;

      if (status !== 'playing') {
        // Any key restarts (ignore pure modifier keys).
        if (evt.key !== 'Shift' && evt.key !== 'Alt' && evt.key !== 'Control' && evt.key !== 'Meta') {
          restartFromInput();
        }
        return;
      }

      const laneH = laneHRef.current;
      const stepX = 26;
      const stepY = Math.max(18, Math.round(Math.min(26, laneH * 0.45)));
      let dx = 0;
      let dy = 0;

      const key = evt.key.toLowerCase();
      if (evt.key === 'ArrowLeft' || key === 'a') dx = -stepX;
      if (evt.key === 'ArrowRight' || key === 'd') dx = stepX;
      if (evt.key === 'ArrowUp' || key === 'w') dy = -stepY;
      if (evt.key === 'ArrowDown' || key === 's') dy = stepY;

      if (!dx && !dy) return;

      // Limit movement rate (avoid OS key repeat spamming).
      const now = nowMs();
      if (now - lastKeyboardMoveAtRef.current < KEY_MOVE_COOLDOWN_MS) return;
      lastKeyboardMoveAtRef.current = now;

      movePlayer(dx, dy);
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown as any);
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const laneH = laneHRef.current;
    const safeHLocal = safeH;

    const tick = (t: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const lastT = lastTRef.current;
      lastTRef.current = t;
      const dt = typeof lastT === 'number' ? Math.min(0.05, (t - lastT) / 1000) : 0;

      const carsActive = status === 'playing' || status === 'countdown';

      // Background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Safe zones
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillRect(0, 0, canvas.width, safeHLocal);
      ctx.fillRect(0, canvas.height - safeHLocal, canvas.width, safeHLocal);

      // Road
      const roadY = safeHLocal;
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

        // For all odd-lane roads, draw a double divider (same as centerline) at the top and bottom of the middle lane
        if (params.lanes % 2 === 1 && params.lanes >= 3) {
          const midIdx = Math.floor(params.lanes / 2);
          // Top of middle lane
          const yTop = roadY + midIdx * laneH;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, yTop - 5);
          ctx.lineTo(canvas.width, yTop - 5);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, yTop + 5);
          ctx.lineTo(canvas.width, yTop + 5);
          ctx.stroke();
          // Bottom of middle lane
          const yBottom = roadY + (midIdx + 1) * laneH;
          ctx.beginPath();
          ctx.moveTo(0, yBottom - 5);
          ctx.lineTo(canvas.width, yBottom - 5);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, yBottom + 5);
          ctx.lineTo(canvas.width, yBottom + 5);
          ctx.stroke();
          ctx.lineWidth = 2;
        }

      // Double center line
      if (params.lanes >= 2) {
        // Put the divider between the two directions of travel.
        // If the lane count is odd, bias so the top half has fewer lanes.
        // Example: 5 lanes => 2 lanes above the divider, 3 below.
        const dividerY = roadY + Math.floor(params.lanes / 2) * laneH;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, dividerY - 5);
        ctx.lineTo(canvas.width, dividerY - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, dividerY + 5);
        ctx.lineTo(canvas.width, dividerY + 5);
        ctx.stroke();
      }

      // Spawn cars at random times
      if (carsActive && dt > 0) {
        const spawn = spawnRef.current;
        if (spawn) {
          spawn.t += dt;

          for (let laneIndex = 0; laneIndex < params.lanes; laneIndex++) {
            while (spawn.t >= spawn.nextSpawnByLane[laneIndex]) {
              let dir: 1 | -1;
              const midIdx = Math.floor(params.lanes / 2);
              if (params.lanes % 2 === 1 && laneIndex === midIdx) {
                // Middle lane: random direction
                dir = Math.random() < 0.5 ? 1 : -1;
              } else if (laneIndex < params.lanes / 2) {
                // Top half: right to left
                dir = -1;
              } else {
                // Bottom half: left to right
                dir = 1;
              }
              const widthVar = 70 + Math.floor(Math.random() * 50);
              const startX = dir === 1 ? -widthVar - 10 : canvas.width + widthVar + 10;
              carsRef.current.push({
                laneIndex,
                x: startX,
                width: widthVar,
                speedPxPerSec: spawn.carSpeedPxPerSec,
                dir,
              });

              // Use the same spawn delay logic as in resize, with typeMult
              const { base, typeMult } = randomSpawnDelaySec(params.speedMph);
              let delay;
              if (params.lanes % 2 === 1 && laneIndex === Math.floor(params.lanes / 2)) {
                delay = 2 * base * (0.6 + Math.random() * 0.9) * typeMult;
              } else {
                delay = base * (0.6 + Math.random() * 0.9) * typeMult;
              }
              spawn.nextSpawnByLane[laneIndex] += delay;
            }
          }
        }
      }

      // Cars
      const cars = carsRef.current;
      if (carsActive && dt > 0 && cars.length) {
        for (const car of cars) {
          car.x += car.dir * car.speedPxPerSec * dt;
        }

        // Drop cars that are well offscreen.
        carsRef.current = cars.filter((car) => !(car.x < -car.width - 120 || car.x > canvas.width + car.width + 120));
      }

      for (const car of carsRef.current) {

        const yCenter = roadY + car.laneIndex * laneH + laneH / 2;
        const carH = 22;
        const carY = Math.floor(yCenter - carH / 2);

        ctx.fillStyle = '#e53935';
        ctx.fillRect(Math.floor(car.x), carY, car.width, carH);
      }

      // Player
      const p = playerRef.current;
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.w, p.h);

      // Start countdown overlay
      if (status === 'countdown') {
        const remainingMs = startCooldownUntilRef.current - nowMs();
        if (remainingMs <= 0) {
          setStatus('playing');
        } else {
          const secs = Math.max(1, Math.ceil(remainingMs / 1000));
          ctx.save();
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';

          const pad = 14;
          const x = canvas.width - pad;
          ctx.font = '900 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
          ctx.fillText('Starting in', x, 12);
          ctx.font = '900 44px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
          ctx.fillText(String(secs), x, 32);
          ctx.restore();
        }
      }

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
      if (status === 'hit') {
        ctx.fillStyle = '#e53935';
        ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Hit! Press any key to restart.', 14, canvas.height - 18);
      }
      if (status === 'won') {
        ctx.fillStyle = '#4caf50';
        ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Made it! Press any key to play again.', 14, canvas.height - 18);
      }

      animationRef.current = window.requestAnimationFrame(tick);
    };

    animationRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      lastTRef.current = null;
    };
  }, [params.lanes, params.speedMph, status, safeH]);

  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  const onReset = () => {
    restartGame();
  };

  const difficulty = froggerDifficultyLabel(params.froggerIndex);
  const roadType = formatRoadType(params.highway);

  return (
    <div
      className="page"
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
        className="card"
        style={{
          width: 'min(960px, 100%)',
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 8,
          padding: '14px 16px',
        }}
      >
        <div
          className="topRow"
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}
        >
          <div className="froggerControls" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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

          <div className="infoTop" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="speedSign">
              <SpeedLimitSign speedMph={params.speedMph} />
            </div>
            <InfoList
              lanes={params.lanes}
              roadType={roadType}
              speedMph={params.speedMph}
              froggerIndex={params.froggerIndex}
              difficulty={difficulty}
              attempts={attempts}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }} />
        </div>

        <div ref={canvasWrapRef} className="canvasWrap" style={{ marginTop: 10, position: 'relative' }}>
          <div
            className="streetSignWrap"
            style={{
              position: 'absolute',
              left: 12,
              top: isSmallScreen ? Math.max(8, safeH - 50) : safeH,
              zIndex: 1,
              pointerEvents: 'none',
            }}
          >
            <StreetNameSign name={params.name} className="streetSign" />
          </div>

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

        <div
          className="bottomRow"
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div className="instructions" style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0, 0, 0, 0.75)' }}>
            Goal: reach the top sidewalk. Controls: arrow keys / WASD.
          </div>
          {typeof params.distToMarkedM === 'number' ? (
            <div className="distanceArrow">
              <DistanceArrowInline meters={params.distToMarkedM} />
            </div>
          ) : null}
        </div>

        <div className="infoBottom">
          <InfoList
            lanes={params.lanes}
            roadType={roadType}
            speedMph={params.speedMph}
            froggerIndex={params.froggerIndex}
            difficulty={difficulty}
            attempts={attempts}
          />
        </div>

        <div className="touchControls" aria-label="Touch controls">
          <button
            type="button"
            className="touchBtn"
            onPointerDown={(e) => {
              e.preventDefault();
              movePlayer(0, -26);
            }}
            style={{
              width: 64,
              height: 56,
              border: '1px solid rgba(0, 0, 0, 0.12)',
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.92)',
              fontSize: 18,
              fontWeight: 900,
              userSelect: 'none',
              touchAction: 'manipulation',
            }}
            aria-label="Move up"
          >
            ↑
          </button>

          <div className="touchRow" style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="touchBtn"
              onPointerDown={(e) => {
                e.preventDefault();
                movePlayer(-26, 0);
              }}
              style={{
                width: 64,
                height: 56,
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.92)',
                fontSize: 18,
                fontWeight: 900,
                userSelect: 'none',
                touchAction: 'manipulation',
              }}
              aria-label="Move left"
            >
              ←
            </button>

            <button
              type="button"
              className="touchBtn"
              onPointerDown={(e) => {
                e.preventDefault();
                movePlayer(0, 26);
              }}
              style={{
                height: 56,
                width: 64,
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.92)',
                fontSize: 18,
                fontWeight: 900,
                userSelect: 'none',
                touchAction: 'manipulation',
              }}
              aria-label="Move down"
            >
              ↓
            </button>

            <button
              type="button"
              className="touchBtn"
              onPointerDown={(e) => {
                e.preventDefault();
                movePlayer(26, 0);
              }}
              style={{
                width: 64,
                height: 56,
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.92)',
                fontSize: 18,
                fontWeight: 900,
                userSelect: 'none',
                touchAction: 'manipulation',
              }}
              aria-label="Move right"
            >
              →
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .streetSignWrap {
          transform: translateY(-50%);
        }

        .infoBottom {
          display: none;
          margin-top: 10px;
        }

        .infoTop {
          display: block;
        }

        .speedInList {
          display: none;
        }

        .touchControls {
          display: none;
        }

        .distanceArrow {
          display: block;
        }

        @media (max-width: 640px) {
          .page {
            padding: 0 !important;
            align-items: stretch !important;
          }

          .card {
            width: 100vw !important;
            height: 100vh !important;
            border-radius: 0 !important;
            padding: 10px 10px calc(14px + 84px) 10px !important;
          }

          .canvasWrap {
            flex: 1;
            min-height: 0;
          }

          .topRow {
            justify-content: flex-end !important;
          }

          .froggerControls {
            display: none !important;
          }

          .speedSign {
            display: none !important;
          }

          .speedInList {
            display: block;
          }

          .infoList {
            font-size: 11px !important;
            padding: 8px 10px !important;
            min-width: 170px !important;
            gap: 4px !important;
          }

          .infoTop {
            display: none !important;
          }

          .infoBottom {
            display: block;
          }

          .instructions {
            font-size: 12px !important;
          }

          .distanceArrow {
            display: none !important;
          }

          .streetSign {
            font-size: 16px !important;
            padding: 8px 12px !important;
            border-width: 3px !important;
            border-radius: 8px !important;
            max-width: calc(100% - 24px) !important;
          }

          .streetSignWrap {
            transform: translateY(calc(-50% - 30px));
          }

          .touchControls {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            margin-top: 0;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
            background: rgba(248, 248, 248, 0.92);
            border-top: 1px solid rgba(0, 0, 0, 0.12);
          }
        }

        @media (max-width: 380px) {
          .page {
            padding: 6px !important;
          }

          .card {
            padding: 10px !important;
          }

          .topRow {
            gap: 8px !important;
          }

          .canvasWrap {
            margin-top: 8px !important;
          }

          .bottomRow {
            margin-top: 8px !important;
            gap: 8px !important;
          }

          .infoList {
            font-size: 10px !important;
            padding: 6px 8px !important;
            min-width: 0 !important;
            gap: 4px !important;
          }

          .instructions {
            font-size: 11px !important;
            line-height: 1.15 !important;
          }

          .touchControls {
            margin-top: 10px !important;
            gap: 8px !important;
          }

          .touchRow {
            gap: 8px !important;
          }

          .touchBtn {
            width: 56px !important;
            height: 48px !important;
            border-radius: 10px !important;
            font-size: 16px !important;
          }
        }
      `}</style>
    </div>
  );
}
