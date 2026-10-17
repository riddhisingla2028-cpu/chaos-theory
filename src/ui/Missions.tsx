import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Fx } from '../game/fx';
import { Input } from '../game/input';
import type { Sfx } from '../game/audio';
import { createRenderMemory, drawMission, type MissionLook } from '../mission/render';
import { CHRONO_DURATION, MISSIONS, createMission, objectiveView, secondariesMet, starsFor, stepMission, type MissionEvent, type MissionState } from '../mission/sim';
import { isMissionUnlocked, missionsCompleted, nextMission, type MissionOutcome, type MissionResult, type Progress } from '../progress';
import { levelFromXp } from '../progression';
import { AdSlot } from './AdSlot';
import { BackButton, LockIcon, PauseIcon, PlayIcon, Stars } from './common';

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type View = { kind: 'select' } | { kind: 'brief'; i: number } | { kind: 'play'; i: number; run: number };

export function MissionsScreen(props: {
  progress: Progress;
  sfx: Sfx;
  look: MissionLook;
  isTouch: boolean;
  start: number | null; // open straight into a mission briefing
  onRecord: (r: MissionResult) => MissionOutcome;
  onActive: (playing: boolean) => void;
  onBack: () => void;
}) {
  const [view, setView] = useState<View>(() => (props.start !== null ? { kind: 'brief', i: props.start } : { kind: 'select' }));
  const onActive = useRef(props.onActive);
  onActive.current = props.onActive;
  useEffect(() => onActive.current(view.kind === 'play'), [view.kind]);
  useEffect(() => () => onActive.current(false), []);

  if (view.kind === 'select') return <MissionSelect progress={props.progress} onPick={(i) => setView({ kind: 'brief', i })} onBack={props.onBack} />;
  if (view.kind === 'brief')
    return <Briefing progress={props.progress} i={view.i} isTouch={props.isTouch} onLaunch={() => setView({ kind: 'play', i: view.i, run: Date.now() })} onBack={() => setView({ kind: 'select' })} />;
  return (
    <MissionPlay
      key={view.run}
      i={view.i}
      seed={view.run % 100000}
      progress={props.progress}
      sfx={props.sfx}
      look={props.look}
      isTouch={props.isTouch}
      onRecord={props.onRecord}
      onRetry={() => setView({ kind: 'play', i: view.i, run: Date.now() })}
      onNext={() => setView({ kind: 'brief', i: Math.min(MISSIONS.length - 1, view.i + 1) })}
      onMissions={() => setView({ kind: 'select' })}
    />
  );
}

// ---------- Mission select ----------

function MissionSelect({ progress: p, onPick, onBack }: { progress: Progress; onPick: (i: number) => void; onBack: () => void }) {
  const done = missionsCompleted(p);
  const next = nextMission(p);
  return (
    <div className="screen missions">
      <header className="screen-top">
        <BackButton onClick={onBack} />
        <h2 className="screen-heading">Missions</h2>
        <span className="player-chip">
          {done}/{MISSIONS.length}
        </span>
      </header>
      <div className="screen-scroll levels-scroll">
        <div className="levels-progress" aria-label={`${done} of ${MISSIONS.length} missions completed`}>
          <div className="campaign-bar">
            <span style={{ transform: `scaleX(${done / MISSIONS.length})` }} />
          </div>
          <span className="campaign-text">Campaign {done}/{MISSIONS.length} · tap a mission for its briefing</span>
        </div>
        <ol className="level-list">
          {MISSIONS.map((m, i) => {
            const open = isMissionUnlocked(p, i);
            const rec = p.missions[m.id];
            const isNext = i === next && !rec?.completed;
            return (
              <li key={m.id} style={{ '--lvl': rgb(m.accent) } as CSSProperties}>
                <button
                  type="button"
                  className={`level-card mission-card${open ? '' : ' locked'}${isNext ? ' current' : ''}`}
                  onClick={() => open && onPick(i)}
                  aria-disabled={!open}
                  aria-label={`${open ? 'Mission' : 'Locked: mission'} ${m.code}, ${m.name}. ${m.objective}`}
                >
                  <span className="lc-num" aria-hidden="true">
                    {open ? m.code : <LockIcon />}
                  </span>
                  <span className="lc-main">
                    <span className="lc-name">{m.name}</span>
                    <span className="lc-meta">{m.objective}</span>
                    <span className="lc-desc">{open ? m.tagline : `Complete Mission ${MISSIONS[i - 1].code} to unlock`}</span>
                  </span>
                  <span className="lc-side">
                    {rec?.completed ? <Stars count={rec.stars} /> : null}
                    <span className={`lc-status${isNext ? ' lc-next' : ''}`}>{!open ? 'Locked' : rec?.completed ? `Best ${rec.best.toLocaleString()}` : isNext ? 'Next ▸' : 'Brief ▸'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <AdSlot placement="level_select_banner" />
      </div>
    </div>
  );
}

// ---------- Briefing ----------

function Briefing({ progress: p, i, isTouch, onLaunch, onBack }: { progress: Progress; i: number; isTouch: boolean; onLaunch: () => void; onBack: () => void }) {
  const m = MISSIONS[i];
  const rec = p.missions[m.id];
  return (
    <div className="screen briefing" style={{ '--lvl': rgb(m.accent) } as CSSProperties}>
      <header className="screen-top">
        <BackButton onClick={onBack} />
        <h2 className="screen-heading">Briefing</h2>
        <span />
      </header>
      <div className="screen-scroll narrow">
        <section className="brief-card">
          <p className="eyebrow eyebrow-lvl">Mission {m.code}</p>
          <h3 className="brief-name">{m.name}</h3>
          <p className="brief-text">{m.briefing}</p>
          <div className="brief-obj">
            <span className="brief-label">Primary objective</span>
            <span className="brief-primary">{m.objective}</span>
          </div>
          <div className="brief-obj">
            <span className="brief-label">Optional objectives</span>
            <ul className="brief-list">
              {m.secondaries.map((s, k) => (
                <li key={s.id} className={rec?.secondaries[k] ? 'done' : ''}>
                  {rec?.secondaries[k] ? '✓ ' : '○ '}
                  {s.text}
                </li>
              ))}
            </ul>
          </div>
          <ul className="brief-tips">
            <li>{isTouch ? 'Drag anywhere to fly.' : 'Fly with WASD or the arrow keys. P or Esc pauses.'}</li>
            <li>Hull: {m.maxHp} hits. {m.weapons ? 'Your blaster locks on and fires automatically at targets in range.' : 'No weapons on this mission: avoid everything red or orange.'}</li>
            <li>Watch for the rare CHRONO SHIFT pickup: it slows everything except your ship for a few seconds.</li>
          </ul>
          {rec?.completed && (
            <p className="brief-record">
              <Stars count={rec.stars} /> Best {rec.best.toLocaleString()}
              {rec.fastest !== null && ` · fastest ${rec.fastest.toFixed(1)}s`}
            </p>
          )}
          <button type="button" className="btn btn-primary btn-wide btn-launch" onClick={onLaunch} autoFocus>
            Launch mission
          </button>
        </section>
      </div>
    </div>
  );
}

// ---------- Live mission ----------

const JOY_R = 56;
const PAD_ROOM = 112;

interface Hud {
  objective: ReturnType<typeof objectiveView>;
  hp: number;
  maxHp: number;
  time: number;
  timeLeft: number | null;
  score: number;
  chrono: number;
  boss: { hp: number; max: number; shielded: boolean } | null;
}

function hudOf(m: MissionState): Hud {
  return {
    objective: objectiveView(m),
    hp: Math.max(0, m.ship.hp),
    maxHp: m.def.maxHp,
    time: m.time,
    timeLeft: m.def.timeLimit !== null ? Math.max(0, m.def.timeLimit - m.time) : null,
    score: m.score,
    chrono: m.chrono.active,
    boss: m.boss ? { hp: Math.max(0, m.boss.hp), max: m.boss.maxHp, shielded: m.boss.shielded } : null,
  };
}

function MissionPlay(props: {
  i: number;
  seed: number;
  progress: Progress;
  sfx: Sfx;
  look: MissionLook;
  isTouch: boolean;
  onRecord: (r: MissionResult) => MissionOutcome;
  onRetry: () => void;
  onNext: () => void;
  onMissions: () => void;
}) {
  const def = MISSIONS[props.i];
  const mRef = useRef<MissionState>(createMission(def, props.seed || 1));
  if (import.meta.env.DEV) (window as unknown as { __chaosMission?: () => MissionState }).__chaosMission = () => mRef.current;
  const fxRef = useRef(new Fx());
  const memRef = useRef(createRenderMemory(props.seed || 1));
  const inputRef = useRef(new Input());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [phase, setPhase] = useState<'launch' | 'playing' | 'paused' | 'done'>('launch');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [hud, setHud] = useState<Hud>(() => hudOf(mRef.current));
  const [result, setResult] = useState<{ r: MissionResult; o: MissionOutcome; reason: string | null } | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const recorded = useRef(false);
  const lookRef = useRef(props.look);
  lookRef.current = props.look;
  // Follows rotation: the touch pad sits under the arena only in portrait on touch screens.
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && window.innerHeight > window.innerWidth);
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const showPad = props.isTouch && portrait;

  const say = useCallback((text: string) => setToast({ key: Date.now(), text }), []);

  // Size the square arena to the space available (never stretched).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize(Math.max(200, Math.floor(Math.min(el.clientWidth, el.clientHeight - (showPad ? PAD_ROOM : 0)))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showPad]);

  // Launch countdown
  useEffect(() => {
    props.sfx.play('start');
    const t = setTimeout(() => setPhase((p) => (p === 'launch' ? 'playing' : p)), 1300);
    return () => clearTimeout(t);
  }, [props.sfx]);

  const pause = useCallback(() => setPhase((p) => (p === 'playing' ? 'paused' : p)), []);
  const resume = useCallback(() => setPhase((p) => (p === 'paused' ? 'playing' : p)), []);

  // Keyboard, blur and visibility. Listeners are removed when the mission screen unmounts.
  useEffect(() => {
    const input = inputRef.current;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (input.handleKey(e.code, true)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (phaseRef.current === 'playing') pause();
        else if (phaseRef.current === 'paused') resume();
      }
    };
    const up = (e: KeyboardEvent) => input.handleKey(e.code, false);
    const blur = () => {
      input.reset();
      pause();
    };
    const vis = () => document.hidden && blur();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [pause, resume]);

  const handleEvents = useCallback(
    (events: MissionEvent[]) => {
      const fx = fxRef.current;
      const sfx = props.sfx;
      for (const e of events) {
        switch (e.type) {
          case 'core':
            fx.burst(e.x, e.y, 18, 260, false, 6);
            fx.ring(e.x, e.y, 'rgba(79, 227, 240, 0.9)', 0, 500);
            fx.popup(e.x, e.y - 24, '+150');
            sfx.play('orb');
            break;
          case 'gate':
            fx.ring(e.x, e.y, 'rgba(155, 123, 255, 0.9)', 0, 700);
            fx.popup(e.x, e.y - 30, 'GATE');
            sfx.play('pass');
            break;
          case 'reactor':
            fx.ring(e.x, e.y, 'rgba(255, 213, 74, 0.95)', 0, 700);
            fx.burst(e.x, e.y, 24, 300, false, 6);
            fx.popup(e.x, e.y - 34, 'ONLINE');
            sfx.play('unlock');
            break;
          case 'portal-open':
            fx.ring(e.x, e.y, 'rgba(79, 227, 240, 0.9)', 0, 900);
            sfx.play('levelup');
            say('Portal open · fly in to extract');
            break;
          case 'shoot':
            sfx.play('shoot');
            break;
          case 'enemy-shoot':
            sfx.play('enemyShot');
            break;
          case 'hit':
            fx.addShake(14);
            fx.flash = 0.9;
            fx.burst(e.x, e.y, 16, 320, true, 6);
            sfx.play('hit');
            if (navigator.vibrate) {
              try {
                navigator.vibrate(60);
              } catch {
                // unsupported
              }
            }
            break;
          case 'near':
            sfx.play('near');
            break;
          case 'enemy-hit':
            fx.burst(e.x, e.y, 4, 160, true, 4, 0.3);
            break;
          case 'explode':
            fx.burst(e.x, e.y, e.big ? 60 : 26, e.big ? 520 : 360, true, e.big ? 9 : 6, e.big ? 1.1 : 0.7);
            fx.ring(e.x, e.y, 'rgba(255, 140, 66, 0.9)', 0, e.big ? 900 : 600);
            fx.addShake(e.big ? 22 : 8);
            sfx.play('explode');
            break;
          case 'warn':
            sfx.play('warning');
            break;
          case 'boss-phase':
            fx.addShake(16);
            sfx.play('chaos');
            say(e.phase === 1 ? 'The Guardian is enraged · beams incoming' : 'Final phase · ring bursts');
            break;
          case 'boss-vulnerable':
            sfx.play('combo');
            say('Shield down · fire!');
            break;
          case 'chrono-spawn':
            say('CHRONO SHIFT pickup nearby');
            break;
          case 'chrono-on':
            fx.ring(e.x, e.y, 'rgba(150, 210, 255, 0.9)', 0, 1100);
            fx.ring(e.x, e.y, 'rgba(155, 123, 255, 0.7)', 0.15, 900);
            sfx.play('chronoOn');
            break;
          case 'chrono-off':
            fx.ring(e.x, e.y, 'rgba(255, 79, 216, 0.9)', 0, 1300);
            fx.addShake(10);
            sfx.play('chronoOff');
            break;
          case 'won':
            fx.victory(lookRef.current.ship === 'phantom' ? 'supernova' : 'shockwave', mRef.current.ship.x, mRef.current.ship.y, ['#4FE3F0', '#FF4FD8', '#FFD54A', '#F3F0EA']);
            sfx.play('win');
            break;
          case 'lost':
            fx.addShake(24);
            sfx.play('death');
            break;
        }
      }
    },
    [props.sfx, say],
  );

  const finish = useCallback(() => {
    if (recorded.current) return;
    recorded.current = true;
    const m = mRef.current;
    const met = m.status === 'won' ? secondariesMet(m) : [false, false];
    const r: MissionResult = {
      id: m.def.id,
      won: m.status === 'won',
      score: m.score,
      time: Math.round(m.time * 10) / 10,
      stars: starsFor(m),
      secondaries: met,
      coresTaken: m.cores.filter((c) => c.taken).length,
      kills: m.kills,
      bossDefeated: !!m.boss && m.status === 'won',
    };
    const o = props.onRecord(r);
    setResult({ r, o, reason: m.failReason });
    setPhase('done');
    if (o.newShips.length || o.newCosmetics.length) setTimeout(() => props.sfx.play('unlock'), 700);
  }, [props]);

  // The frame loop: one per mission run; cancelled on unmount. Paused = the simulation is not stepped.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    let endClock = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = mRef.current;
      const ph = phaseRef.current;
      if (ph === 'playing') {
        stepMission(m, inputRef.current.vector(), dt);
        handleEvents(m.events);
        if (m.status !== 'playing') {
          endClock += dt;
          if (endClock > (m.status === 'won' ? 1.4 : 1.1)) finish();
        }
      }
      if (ph !== 'paused') fxRef.current.update(m.chrono.active > 0 ? dt * 0.4 : dt);
      const ctx = canvasRef.current?.getContext('2d');
      const px = canvasRef.current ? canvasRef.current.width / dpr : 0;
      if (ctx && px > 0) drawMission(ctx, m, memRef.current, fxRef.current, lookRef.current, px, dpr, now / 1000);
      hudClock += dt;
      if (hudClock > 0.08) {
        hudClock = 0;
        setHud(hudOf(m));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [finish, handleEvents]);

  // Floating touch joystick anywhere on the play area.
  const joy = (e: ReactPointerEvent, kind: 'down' | 'move' | 'up') => {
    if (e.pointerType === 'mouse') return;
    const j = inputRef.current.joy;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (kind === 'down') {
      Object.assign(j, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      if (base) {
        base.hidden = false;
        base.style.left = `${e.clientX - JOY_R}px`;
        base.style.top = `${e.clientY - JOY_R}px`;
      }
    } else if (kind === 'move' && j.active && j.id === e.pointerId) {
      let dx = e.clientX - j.ox;
      let dy = e.clientY - j.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) {
        dx = (dx / d) * JOY_R;
        dy = (dy / d) * JOY_R;
      }
      j.x = dx / JOY_R;
      j.y = dy / JOY_R;
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (kind === 'up' && j.id === e.pointerId) {
      Object.assign(j, { active: false, id: -1, x: 0, y: 0 });
      if (base) base.hidden = true;
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    }
  };

  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const o = hud.objective;
  const chronoFrac = hud.chrono / CHRONO_DURATION;
  return (
    <div className="screen mission-play" style={{ '--lvl': rgb(def.accent) } as CSSProperties}>
      <header className="m-hud" aria-label="Mission status">
        <div className="m-hud-row">
          <span className="m-title">
            <span className="m-code">{def.code}</span> {def.name}
          </span>
          <span className="m-stat" aria-label="Score">
            <span className="m-stat-label">Score</span>
            {hud.score.toLocaleString()}
          </span>
          <span className={`m-stat${hud.timeLeft !== null && hud.timeLeft < 15 ? ' m-urgent' : ''}`} aria-label={hud.timeLeft !== null ? 'Time left' : 'Mission time'}>
            <span className="m-stat-label">{hud.timeLeft !== null ? 'Left' : 'Time'}</span>
            {fmtTime(hud.timeLeft ?? hud.time)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={phase === 'paused' ? resume : pause}
            disabled={phase !== 'playing' && phase !== 'paused'}
            aria-label={phase === 'paused' ? 'Resume mission' : 'Pause mission'}
          >
            {phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </button>
        </div>
        <div className="m-hud-row m-hud-obj">
          <span className="m-obj" aria-live="polite">
            <span className="m-obj-text">{o.text}</span>
            {o.count && <span className="m-obj-count">{o.count}</span>}
          </span>
          <span className="m-hull" aria-label={`Hull ${hud.hp} of ${hud.maxHp}`}>
            <span className="m-stat-label">Hull</span>
            {Array.from({ length: hud.maxHp }, (_, k) => (
              <span key={k} className={k < hud.hp ? 'on' : ''} />
            ))}
          </span>
        </div>
        <div className="m-obj-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${o.progress})` }} />
        </div>
      </header>

      <div className="m-stage" ref={wrapRef} onPointerDown={(e) => joy(e, 'down')} onPointerMove={(e) => joy(e, 'move')} onPointerUp={(e) => joy(e, 'up')} onPointerCancel={(e) => joy(e, 'up')}>
        <div className="m-arena" style={{ width: size, height: size }}>
          <canvas ref={canvasRef} width={size * dpr} height={size * dpr} style={{ width: size, height: size }} aria-label={`${def.name} mission arena`} />
          {hud.boss && (
            <div className={`m-boss${hud.boss.shielded ? ' shielded' : ''}`} aria-label={`Guardian ${hud.boss.hp} of ${hud.boss.max}`}>
              <span className="m-boss-name">The Guardian {hud.boss.shielded ? '· shielded' : '· VULNERABLE'}</span>
              <span className="m-boss-bar">
                <span style={{ transform: `scaleX(${hud.boss.hp / hud.boss.max})` }} />
              </span>
            </div>
          )}
          {hud.chrono > 0 && (
            <div className="m-chrono" role="status" aria-live="polite">
              <span className="m-chrono-title">Chrono Shift</span>
              <span className="m-chrono-bar">
                <span style={{ transform: `scaleX(${chronoFrac})` }} />
              </span>
              <span className="m-chrono-time">{hud.chrono.toFixed(1)}s</span>
            </div>
          )}
          {toast && phase === 'playing' && (
            <div key={toast.key} className="m-toast" role="status">
              {toast.text}
            </div>
          )}
          {phase === 'launch' && (
            <div className="m-launch" role="status">
              <span className="m-launch-kicker">Mission {def.code}</span>
              <span className="m-launch-name">{def.name}</span>
              <span className="m-launch-obj">{def.objective}</span>
            </div>
          )}
        </div>
        {showPad && (
          <div className="touch-pad m-pad" aria-hidden="true">
            <span className="touch-pad-ring" />
            <span className="touch-pad-text">Drag here or anywhere to fly</span>
          </div>
        )}
      </div>
      <div className="joystick mp-joystick" ref={baseRef} hidden style={{ width: JOY_R * 2, height: JOY_R * 2 }}>
        <div className="joystick-knob" ref={knobRef} />
      </div>

      {phase === 'paused' && (
        <div className="m-overlay" role="dialog" aria-label="Paused">
          <div className="m-panel">
            <p className="m-kicker">Paused</p>
            <h3 className="m-panel-title">{def.name}</h3>
            <p className="m-panel-text">{o.text}{o.count ? ` · ${o.count}` : ''}</p>
            <div className="m-actions">
              <button type="button" className="btn btn-primary btn-wide" onClick={resume} autoFocus>
                Resume
              </button>
              <button type="button" className="btn" onClick={props.onRetry}>
                Restart mission
              </button>
              <button type="button" className="btn" onClick={props.onMissions}>
                Abort to missions
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && result && <MissionResultPanel def={def} result={result} onRetry={props.onRetry} onNext={props.onNext} onMissions={props.onMissions} />}
    </div>
  );
}

function MissionResultPanel(props: {
  def: (typeof MISSIONS)[number];
  result: { r: MissionResult; o: MissionOutcome; reason: string | null };
  onRetry: () => void;
  onNext: () => void;
  onMissions: () => void;
}) {
  const { r, o, reason } = props.result;
  const def = props.def;
  const hasNext = def.index < MISSIONS.length - 1;
  const level = levelFromXp(o.xpBefore + o.xpGained);
  const unlocked = [...(o.firstClear && hasNext ? [`Mission ${MISSIONS[def.index + 1].code} · ${MISSIONS[def.index + 1].name}`] : []), ...o.newShips, ...o.newCosmetics, ...o.challengesCompleted.map((c) => `${c.scope === 'daily' ? 'Daily' : 'Weekly'} challenge: ${c.def.text}`)];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyR') props.onRetry();
      else if (e.code === 'Enter' && document.activeElement?.tagName !== 'BUTTON') (r.won && hasNext ? props.onNext : props.onRetry)();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [props, r.won, hasNext]);
  return (
    <div className="m-overlay" role="dialog" aria-label={r.won ? 'Mission complete' : 'Mission failed'}>
      <div className={`m-panel m-result ${r.won ? 'won' : 'lost'}`}>
        <p className="m-kicker">{r.won ? 'Mission complete' : 'Mission failed'}</p>
        <h3 className="m-panel-title">{def.name}</h3>
        {!r.won && reason && <p className="m-reason">{reason}</p>}
        {r.won && <Stars count={r.stars} animate />}
        <div className="m-result-stats">
          <span>
            <span className="m-stat-label">Score</span>
            {r.score.toLocaleString()}
          </span>
          <span>
            <span className="m-stat-label">Time</span>
            {r.time.toFixed(1)}s
          </span>
          {o.isNewBest && o.previous?.completed && (
            <span className="m-best">
              <span className="m-stat-label">Record</span>New best
            </span>
          )}
        </div>
        <ul className="m-secondary">
          {def.secondaries.map((s, k) => (
            <li key={s.id} className={r.secondaries[k] ? 'met' : ''}>
              <span aria-hidden="true">{r.secondaries[k] ? '✓' : '○'}</span> {s.text}
              {!r.won && <span className="dim"> (complete the mission to count)</span>}
            </li>
          ))}
        </ul>
        <div className="m-xp">
          <span className="earned-xp">+{o.xpGained} XP</span>
          <span className="dim"> · account level {level.level}</span>
        </div>
        {unlocked.length > 0 && (
          <ul className="rewards">
            {unlocked.map((u) => (
              <li key={u}>
                <span className="reward-kind">Unlocked</span>
                <span className="reward-name">{u}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="m-actions">
          {r.won && hasNext ? (
            <button type="button" className="btn btn-primary btn-wide" onClick={props.onNext} autoFocus>
              Next mission · {MISSIONS[def.index + 1].code}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-wide" onClick={props.onRetry} autoFocus>
              {r.won ? 'Fly it again' : 'Retry mission'}
            </button>
          )}
          {r.won && hasNext && (
            <button type="button" className="btn" onClick={props.onRetry}>
              Replay
            </button>
          )}
          <button type="button" className="btn" onClick={props.onMissions}>
            Missions
          </button>
        </div>
        <AdSlot placement="results_banner" className="ad-results" />
      </div>
    </div>
  );
}
