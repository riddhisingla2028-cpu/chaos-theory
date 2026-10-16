import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  ARENA,
  CHAOS_INFO,
  CHAOS_KINDS,
  createGame,
  difficulty,
  scoreFor,
  step,
  type ChaosKind,
  type DeathCause,
  type GameState,
  type Vec,
} from './game/engine';
import { drawGame } from './game/render';
import { Input } from './game/input';
import { loadBest, recordBest } from './storage';

type Screen = 'start' | 'playing' | 'paused' | 'over';

interface Hud {
  score: number;
  time: number;
  level: number;
  chaos: { kind: ChaosKind; phase: 'warning' | 'active'; progress: number; gravity: Vec } | null;
  playerNearTop: boolean; // fade the banner so it never hides the player
}

interface Result {
  score: number;
  time: number;
  level: number;
  events: number;
  dodged: number;
  cause: DeathCause | null;
  best: number;
  isNew: boolean;
}

const CAUSE_TEXT: Record<DeathCause, string> = {
  drifter: 'Struck by a drifter',
  seeker: 'Hunted down by a seeker',
  collapse: 'Crushed by the collapse',
  afterimage: 'Caught in your own afterimage',
};

const EVENT_BLURB: Record<ChaosKind, string> = {
  INVERSION: 'Controls reverse.',
  COLLAPSE: 'The walls close in. Edges kill.',
  AFTERIMAGE: 'Your trail turns lethal.',
  GRAVITY: 'A force drags you off course.',
};

const JOY_RADIUS = 56; // px
const JOY_DEADZONE = 6; // px
const MAX_STEP = 1 / 120; // simulation substep, seconds
const HUD_INTERVAL = 0.066; // seconds between HUD refreshes
const RESTART_DELAY = 500; // ms after game over before keys can restart

function hudFrom(g: GameState): Hud {
  const c = g.chaos;
  return {
    score: scoreFor(g.time),
    time: g.time,
    level: difficulty(g.time).level,
    chaos: c ? { kind: c.kind, phase: c.phase, progress: 1 - c.remaining / c.duration, gravity: c.gravity } : null,
    playerNearTop: g.player.y < ARENA * 0.2,
  };
}

function arrowFor(v: Vec): string {
  if (v.x > 0) return '→';
  if (v.x < 0) return '←';
  if (v.y > 0) return '↓';
  return '↑';
}

function detectTouch(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export default function App() {
  const [screen, setScreenState] = useState<Screen>('start');
  const screenRef = useRef<Screen>('start');
  const gameRef = useRef<GameState>(createGame());
  const inputRef = useRef(new Input());
  const [hud, setHud] = useState<Hud>(() => hudFrom(gameRef.current));
  const [best, setBest] = useState(() => loadBest());
  const [result, setResult] = useState<Result | null>(null);
  const [isTouch] = useState(detectTouch);
  const overAtRef = useRef(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const joyBaseRef = useRef<HTMLDivElement>(null);
  const joyKnobRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const sizeRef = useRef(0);
  const dprRef = useRef(1);

  // Development-only hook for automated browser tests; removed from production builds.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __chaosGame: () => GameState }).__chaosGame = () => gameRef.current;
  }, []);

  const setScreen = useCallback((next: Screen) => {
    screenRef.current = next;
    setScreenState(next);
  }, []);

  const hideJoystick = useCallback(() => {
    if (joyBaseRef.current) joyBaseRef.current.hidden = true;
  }, []);

  const startGame = useCallback(() => {
    if (screenRef.current === 'playing') return;
    gameRef.current = createGame();
    inputRef.current.reset();
    hideJoystick();
    setResult(null);
    setHud(hudFrom(gameRef.current));
    setScreen('playing');
  }, [hideJoystick, setScreen]);

  const pause = useCallback(() => {
    if (screenRef.current !== 'playing') return;
    inputRef.current.reset();
    hideJoystick();
    setScreen('paused');
  }, [hideJoystick, setScreen]);

  const resume = useCallback(() => {
    if (screenRef.current === 'paused') setScreen('playing');
  }, [setScreen]);

  const toMenu = useCallback(() => {
    gameRef.current = createGame();
    inputRef.current.reset();
    hideJoystick();
    setResult(null);
    setHud(hudFrom(gameRef.current));
    setScreen('start');
  }, [hideJoystick, setScreen]);

  const endGame = useCallback(() => {
    const g = gameRef.current;
    const score = scoreFor(g.time);
    const record = recordBest(score);
    setBest(record.best);
    setResult({
      score,
      time: g.time,
      level: g.stats.peakLevel,
      events: g.stats.eventsSurvived,
      dodged: g.stats.hazardsDodged,
      cause: g.cause,
      best: record.best,
      isNew: record.isNew,
    });
    overAtRef.current = performance.now();
    inputRef.current.reset();
    hideJoystick();
    setHud(hudFrom(g));
    setScreen('over');
  }, [hideJoystick, setScreen]);

  // Keyboard controls and auto-pause when the tab loses focus.
  useEffect(() => {
    const input = inputRef.current;
    const canRestart = () => performance.now() - overAtRef.current > RESTART_DELAY;

    const onKeyDown = (e: KeyboardEvent) => {
      if (input.handleKey(e.code, true)) e.preventDefault();
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      const s = screenRef.current;
      switch (e.code) {
        case 'Space':
        case 'Enter':
        case 'NumpadEnter':
          if (s === 'start' || (s === 'over' && canRestart())) {
            e.preventDefault();
            startGame();
          } else if (s === 'paused') {
            e.preventDefault();
            resume();
          }
          break;
        case 'KeyP':
        case 'Escape':
          if (s === 'playing') pause();
          else if (s === 'paused') resume();
          break;
        case 'KeyR':
          if (s === 'paused' || (s === 'over' && canRestart())) startGame();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      input.handleKey(e.code, false);
    };
    const onBlur = () => {
      input.reset();
      pause();
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pause, resume, startGame]);

  // Keep the arena square and as large as the stage allows.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.max(200, Math.floor(Math.min(rect.width, rect.height)));
      sizeRef.current = next;
      setSize(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }, [size]);

  // Main loop: fixed substeps for the simulation, render every frame.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = gameRef.current;
      if (screenRef.current === 'playing') {
        const input = inputRef.current.vector();
        let remaining = dt;
        while (remaining > 0 && g.status === 'playing') {
          const h = Math.min(remaining, MAX_STEP);
          step(g, input, h);
          remaining -= h;
        }
        hudClock += dt;
        if (g.status === 'over') endGame();
        else if (hudClock >= HUD_INTERVAL) {
          hudClock = 0;
          setHud(hudFrom(g));
        }
      }
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && sizeRef.current) drawGame(ctx, g, sizeRef.current, dprRef.current, now / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [endGame]);

  // Floating touch joystick: touch anywhere in the play area and drag.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || screenRef.current !== 'playing') return;
    const joy = inputRef.current.joy;
    if (joy.active) return;
    Object.assign(joy, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = joyBaseRef.current;
    if (base) {
      base.style.left = `${e.clientX - JOY_RADIUS}px`;
      base.style.top = `${e.clientY - JOY_RADIUS}px`;
      base.hidden = false;
    }
    if (joyKnobRef.current) joyKnobRef.current.style.transform = 'translate(0px, 0px)';
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const joy = inputRef.current.joy;
    if (!joy.active || e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox;
    let dy = e.clientY - joy.oy;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_RADIUS) {
      dx = (dx / dist) * JOY_RADIUS;
      dy = (dy / dist) * JOY_RADIUS;
    }
    const live = dist > JOY_DEADZONE;
    joy.x = live ? dx / JOY_RADIUS : 0;
    joy.y = live ? dy / JOY_RADIUS : 0;
    if (joyKnobRef.current) joyKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const joy = inputRef.current.joy;
    if (!joy.active || e.pointerId !== joy.id) return;
    Object.assign(joy, { active: false, id: -1, x: 0, y: 0 });
    hideJoystick();
  };

  const inGame = screen === 'playing' || screen === 'paused';
  const chaos = inGame ? hud.chaos : null;

  return (
    <div className={`app screen-${screen}`}>
      <header className="hud">
        <span className="brand">Chaos Theory</span>
        <div className="hud-stats" aria-label="Game statistics">
          <Stat label="Score" value={String(hud.score)} />
          <Stat label="Time" value={`${hud.time.toFixed(1)}s`} />
          <Stat label="Level" value={String(hud.level)} />
          <Stat label="Best" value={String(best)} />
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={screen === 'paused' ? resume : pause}
          disabled={!inGame}
          aria-label={screen === 'paused' ? 'Resume game' : 'Pause game'}
        >
          {screen === 'paused' ? <PlayIcon /> : <PauseIcon />}
        </button>
      </header>

      <div
        className="stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="arena" style={{ width: size || undefined, height: size || undefined }}>
          <canvas ref={canvasRef} aria-label="Game arena" />
          {chaos && (
            <div
              className={`banner banner-${chaos.phase}${hud.playerNearTop ? ' banner-dim' : ''}`}
              role="status"
              aria-live="polite"
            >
              <span className="banner-kicker">{chaos.phase === 'warning' ? 'Incoming' : 'Chaos active'}</span>
              <span className="banner-name">
                {CHAOS_INFO[chaos.kind].name}
                {chaos.kind === 'GRAVITY' && <span className="banner-arrow"> {arrowFor(chaos.gravity)}</span>}
              </span>
              <span className="banner-hint">{CHAOS_INFO[chaos.kind].hint}</span>
              <span className="banner-bar">
                <span style={{ transform: `scaleX(${Math.max(0, 1 - chaos.progress)})` }} />
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="joystick" ref={joyBaseRef} hidden aria-hidden="true">
        <div className="joystick-knob" ref={joyKnobRef} />
      </div>

      {screen === 'start' && (
        <Overlay>
          <p className="kicker">A survival game in four rules</p>
          <h1 className="title">Chaos Theory</h1>
          <p className="lede">Survive the arena. The rules won&rsquo;t stay the same.</p>
          <ol className="events">
            {CHAOS_KINDS.map((kind, i) => (
              <li key={kind}>
                <span className="events-num">0{i + 1}</span>
                <span className="events-name">{CHAOS_INFO[kind].name}</span>
                <span className="events-desc">{EVENT_BLURB[kind]}</span>
              </li>
            ))}
          </ol>
          <p className="controls">
            {isTouch ? (
              <>Drag anywhere to move · Tap ❙❙ to pause</>
            ) : (
              <>
                <kbd>WASD</kbd> / <kbd>Arrows</kbd> move · <kbd>P</kbd> / <kbd>Esc</kbd> pause
              </>
            )}
          </p>
          {best > 0 && <p className="best-line">Personal best · {best}</p>}
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={startGame} autoFocus>
              Start
            </button>
          </div>
          {!isTouch && <p className="hint">or press Space</p>}
        </Overlay>
      )}

      {screen === 'paused' && (
        <Overlay>
          <p className="kicker">Paused</p>
          <h2 className="title title-sm">Take a breath</h2>
          <p className="lede">
            Score {hud.score} · {hud.time.toFixed(1)}s survived
          </p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={resume} autoFocus>
              Resume
            </button>
            <button type="button" className="btn" onClick={startGame}>
              Restart
            </button>
            <button type="button" className="btn" onClick={toMenu}>
              Menu
            </button>
          </div>
        </Overlay>
      )}

      {screen === 'over' && result && (
        <Overlay>
          <p className="kicker">Game over</p>
          <h2 className="score-big">{result.score}</h2>
          {result.isNew && <p className="badge">New personal best</p>}
          {result.cause && <p className="lede">{CAUSE_TEXT[result.cause]}</p>}
          <dl className="stats">
            <StatRow label="Survived" value={`${result.time.toFixed(1)}s`} />
            <StatRow label="Level reached" value={String(result.level)} />
            <StatRow label="Chaos survived" value={String(result.events)} />
            <StatRow label="Hazards dodged" value={String(result.dodged)} />
            <StatRow label="Personal best" value={String(result.best)} />
          </dl>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={startGame} autoFocus>
              Play again
            </button>
            <button type="button" className="btn" onClick={toMenu}>
              Menu
            </button>
          </div>
          {!isTouch && <p className="hint">or press R</p>}
        </Overlay>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="card">{children}</div>
    </div>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M7 5l12 7-12 7z" fill="currentColor" />
    </svg>
  );
}
