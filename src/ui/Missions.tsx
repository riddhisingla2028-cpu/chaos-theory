import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Fx } from '../game/fx';
import { Input } from '../game/input';
import type { Sfx } from '../game/audio';
import { createRenderMemory, drawMission, type MissionLook } from '../mission/render';
import {
  CHRONO_DURATION,
  MISSIONS,
  OPERATIONS,
  THREATS,
  OVERDRIVE_TIME,
  comboMult,
  createMission,
  objectiveTarget,
  objectiveView,
  secondariesMet,
  starsFor,
  stepMission,
  type MissionEvent,
  type MissionState,
} from '../mission/sim';
import { SHIPS, isMissionUnlocked, missionsCompleted, nextMission, type MissionOutcome, type MissionResult, type Progress } from '../progress';
import { levelFromXp } from '../progression';
import { AdSlot } from './AdSlot';
import { BackButton, LockIcon, PauseIcon, PlayIcon, Stars } from './common';
import { MissionArt } from './MissionArt';

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

/** A real campaign reward tied to this mission (hull unlocks), if any. */
const missionReward = (name: string) => SHIPS.find((sh) => !sh.premium && sh.req === `Complete ${name}`)?.name ?? null;

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
          <span className="campaign-text">
            Campaign {done}/{MISSIONS.length} · tap a mission for its briefing
          </span>
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
                  <span className="mc-art">
                    <MissionArt id={m.id} locked={!open} />
                    <span className="mc-code" aria-hidden="true">
                      {open ? m.code : <LockIcon />}
                    </span>
                    <span className={`mc-state${rec?.completed ? ' done' : isNext ? ' next' : !open ? ' locked' : ''}`}>
                      {rec?.completed ? 'Complete' : isNext ? 'Next' : open ? 'Available' : 'Locked'}
                    </span>
                  </span>
                  <span className="lc-main">
                    <span className="lc-op">
                      {OPERATIONS[m.id].op} · {OPERATIONS[m.id].kind}
                    </span>
                    <span className="lc-name">{m.name}</span>
                    <span className="lc-meta">{m.objective}</span>
                    <span className="lc-desc">{open ? m.tagline : `Complete Mission ${MISSIONS[i - 1].code} to unlock`}</span>
                    <span className="mc-reward">
                      {rec?.completed ? <Stars count={rec.stars} /> : <span className="mc-stars-empty">☆☆☆</span>}
                      {missionReward(m.name) ? <span className="mc-unlock">Unlocks {missionReward(m.name)}</span> : null}
                      {rec?.completed ? <span className="mc-best">Best {rec.best.toLocaleString()}</span> : null}
                    </span>
                  </span>
                  <span className="lc-side">
                    <span className={`threat threat-${OPERATIONS[m.id].threat.toLowerCase()}`}>{OPERATIONS[m.id].threat}</span>
                    <span className={`lc-status${isNext ? ' lc-next' : ''}`}>{!open ? 'Locked' : isNext ? 'Launch ▸' : 'Brief ▸'}</span>
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
          <p className="eyebrow eyebrow-lvl">
            Mission {m.code} · {OPERATIONS[m.id].op} · {OPERATIONS[m.id].kind}
          </p>
          <h3 className="brief-name">{m.name}</h3>
          <span className="threat-meter threat-meter-lg" aria-label={`Threat ${OPERATIONS[m.id].threat}`}>
            <span className="m-stat-label">Threat · {OPERATIONS[m.id].threat}</span>
            {THREATS.map((th, k) => (
              <span key={th} className={k <= THREATS.indexOf(OPERATIONS[m.id].threat) ? 'on' : ''} />
            ))}
          </span>
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
          <div className="brief-obj">
            <span className="brief-label">Operation plan</span>
            <ol className="brief-plan">
              {m.phases.map((ph, k) => (
                <li key={ph.id}>
                  <span className="brief-plan-n">{k + 1}</span>
                  {ph.title}
                </li>
              ))}
            </ol>
          </div>
          <div className="brief-controls" aria-label="Controls">
            <span className="brief-label">Controls</span>
            {isTouch ? (
              <span>
                <kbd>Drag</kbd> anywhere to fly
                {m.weapons ? (
                  <>
                    {' '}
                    · hold <kbd>FIRE</kbd> to shoot
                  </>
                ) : null}
              </span>
            ) : (
              <span>
                <kbd>WASD</kbd>/<kbd>Arrows</kbd> fly
                {m.weapons ? (
                  <>
                    {' '}
                    · <kbd>Space</kbd> or hold the <kbd>left mouse button</kbd> to fire
                  </>
                ) : null}{' '}
                · <kbd>P</kbd>/<kbd>Esc</kbd> pause
              </span>
            )}
          </div>
          <ul className="brief-tips">
            <li>
              Hull: {m.maxHp} hits.{' '}
              {m.weapons
                ? 'Your blaster fires straight ahead from the nose: point the ship at a target, then fire. Brackets show what is in your sights.'
                : 'No weapons on this mission: avoid everything red or orange.'}
            </li>
            <li>Watch for the rare CHRONO SHIFT pickup (it slows everything but you) and for shield, overdrive and repair cells.</li>
            <li>Shoot down enemies in quick succession to build a score chain up to x4.</li>
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
  shield: boolean;
  overdrive: number;
  chain: number;
  allies: { id: number; name: string; frac: number; down: boolean }[];
  weapons: boolean;
  hostiles: number;
  incoming: boolean;
  entrance: boolean;
  locked: boolean;
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
    boss:
      m.boss && !m.escaping
        ? {
            hp: Math.max(0, m.boss.hp),
            max: m.boss.maxHp,
            shielded: m.boss.shielded,
          }
        : null,
    shield: m.power.shield,
    overdrive: m.power.overdrive,
    chain: m.combo.count >= 2 ? comboMult(m.combo.count) : 0,
    allies: m.allies.map((a) => ({
      id: a.id,
      name: a.name,
      frac: a.hp / a.maxHp,
      down: a.destroyed,
    })),
    weapons: m.def.weapons,
    hostiles: m.drones.filter((d) => d.spawnIn === 0).length + (m.boss && m.boss.hp > 0 ? 1 : 0),
    // Something is about to fire at the player: a gunner/turret charging at you, or a beam warming up.
    incoming: m.drones.some((d) => d.aim > 0 && (d.kind === 'turret' || d.targetAlly === null)) || !!(m.boss?.beam && m.boss.beam.warn > 0),
    entrance: m.def.id === 'guardian' && m.time < 3,
    locked: m.target !== null,
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
  if (import.meta.env.DEV) {
    // Test hooks (development builds only): read-only views of the running mission.
    const w = window as unknown as {
      __chaosMission?: () => MissionState;
      __chaosObjective?: () => { x: number; y: number } | null;
    };
    w.__chaosMission = () => mRef.current;
    w.__chaosObjective = () => objectiveTarget(mRef.current);
  }
  const fxRef = useRef(new Fx());
  const memRef = useRef(createRenderMemory(props.seed || 1));
  const sfxRef = useRef(props.sfx);
  sfxRef.current = props.sfx;
  // The engine loop never outlives the mission screen
  useEffect(() => () => sfxRef.current.setEngine(null), []);
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
  // HUD feedback: a red flash when the hull takes damage, a sweep when the objective advances.
  const [hitKey, setHitKey] = useState(0);
  const [objKey, setObjKey] = useState(0);
  const prevHud = useRef(hud);
  useEffect(() => {
    const prev = prevHud.current;
    prevHud.current = hud;
    if (hud.hp < prev.hp) setHitKey((k) => k + 1);
    if (hud.objective.progress > prev.objective.progress + 0.001 && hud.objective.count !== prev.objective.count) setObjKey((k) => k + 1);
  }, [hud]);
  const [result, setResult] = useState<{
    r: MissionResult;
    o: MissionOutcome;
    reason: string | null;
    debrief: Debrief;
  } | null>(null);
  const [toast, setToast] = useState<{
    key: number;
    text: string;
    tag: 'Alert' | 'Comms' | 'Objective';
  } | null>(null);
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

  const say = useCallback((text: string, tag: 'Alert' | 'Comms' | 'Objective' = 'Alert') => setToast({ key: Date.now() + Math.random(), text, tag }), []);

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

  // Launch countdown (the Guardian's arrival sounds the alarm)
  useEffect(() => {
    props.sfx.play('launch');
    if (def.id === 'guardian') props.sfx.play('alarm');
    const t = setTimeout(() => setPhase((p) => (p === 'launch' ? 'playing' : p)), 1300);
    return () => clearTimeout(t);
  }, [props.sfx, def.id]);

  const pause = useCallback(() => setPhase((p) => (p === 'playing' ? 'paused' : p)), []);
  // Nothing may stay stuck firing across a pause, an intro or the end of a mission.
  useEffect(() => {
    if (phase !== 'playing') inputRef.current.releaseFire();
  }, [phase]);
  const resume = useCallback(() => setPhase((p) => (p === 'paused' ? 'playing' : p)), []);

  // Keyboard, blur and visibility. Listeners are removed when the mission screen unmounts.
  useEffect(() => {
    const input = inputRef.current;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (input.handleKey(e.code, true)) e.preventDefault();
      if (e.code === 'Space') e.preventDefault(); // never scroll the page
      if (e.repeat) return;
      if (phaseRef.current === 'launch' && (e.code === 'Space' || e.code === 'Enter')) {
        setPhase('playing'); // skip the intro (this press does not fire)
        return;
      }
      if (phaseRef.current === 'playing') input.handleFireKey(e.code, true);
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (phaseRef.current === 'playing') pause();
        else if (phaseRef.current === 'paused') resume();
      }
    };
    const up = (e: KeyboardEvent) => {
      input.handleKey(e.code, false);
      input.handleFireKey(e.code, false);
    };
    // A mouse button released anywhere (even outside the arena) stops firing.
    const mouseUp = () => input.setMouseFire(false);
    const blur = () => {
      input.reset();
      pause();
    };
    const vis = () => document.hidden && blur();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerup', mouseUp);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pointerup', mouseUp);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [pause, resume]);

  const handleEvents = useCallback(
    (events: MissionEvent[]) => {
      const fx = fxRef.current;
      const vfx = memRef.current.vfx;
      const ship = mRef.current.ship;
      const sfx = props.sfx;
      for (const e of events) {
        switch (e.type) {
          case 'core':
            vfx.burst(e.x, e.y, 14, [140, 200, 255], 260);
            vfx.flash(e.x, e.y, 50, 0.25, [140, 200, 255]);
            fx.ring(e.x, e.y, 'rgba(76, 157, 255, 0.9)', 0, 500);
            fx.popup(e.x, e.y - 24, '+150');
            sfx.play('orb');
            break;
          case 'gate':
            fx.ring(e.x, e.y, 'rgba(125, 150, 235, 0.9)', 0, 700);
            fx.popup(e.x, e.y - 30, 'GATE');
            sfx.play('pass');
            break;
          case 'reactor':
            fx.ring(e.x, e.y, 'rgba(255, 213, 74, 0.95)', 0, 700);
            vfx.burst(e.x, e.y, 20, [255, 213, 74], 300);
            vfx.flash(e.x, e.y, 80, 0.35, [255, 213, 74]);
            fx.popup(e.x, e.y - 34, 'ONLINE');
            sfx.play('unlock');
            break;
          case 'portal-open':
            fx.ring(e.x, e.y, 'rgba(76, 157, 255, 0.9)', 0, 900);
            sfx.play('levelup');
            say('Portal open · fly in to extract');
            break;
          case 'shoot':
            // The flash sits exactly where the bolt left: the muzzle and heading reported by the sim.
            vfx.muzzle(e.x, e.y, e.angle);
            sfx.play('shoot');
            break;
          case 'comms':
            say(e.text, e.alert ? 'Alert' : 'Comms');
            if (e.alert) sfx.play('warning');
            break;
          case 'objective':
            say(e.next ? `${e.done} ✓ · Next: ${e.next}` : `${e.done} ✓`, 'Objective');
            sfx.play('unlock');
            break;
          case 'deflect':
            // A bolt stopped by an enemy shield: a blue ripple where it struck, no damage
            vfx.shock(e.x, e.y, 120, 0.25, [120, 190, 255], 2);
            vfx.impact(e.x, e.y, [150, 210, 255]);
            break;
          case 'switch':
            vfx.flash(e.x, e.y, 120, 0.4, [255, 190, 120]);
            vfx.burst(e.x, e.y, 16, [255, 190, 120], 260);
            fx.addShake(4);
            sfx.play('pass');
            break;
          case 'enemy-shoot':
            vfx.flash(e.x, e.y, 22, 0.1, [255, 159, 64]);
            sfx.play('enemyShot');
            break;
          case 'hit':
            fx.addShake(9);
            fx.flash = 0.9;
            vfx.hullHit(e.x, e.y);
            memRef.current.hurt = 0.28;
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
            vfx.impact(e.x, e.y, [255, 190, 120], Math.atan2(e.y - ship.y, e.x - ship.x) + Math.PI);
            break;
          case 'explode':
            // Flash, shockwave, sparks, tumbling hull fragments and smoke (pooled, render-only)
            vfx.explosion(e.x, e.y, e.big ? 2 : 1);
            fx.addShake(e.big ? 12 : 4);
            // A big blast away from the player is a capital-class hull (the Guardian, a friendly ship)
            sfx.play(e.big && Math.hypot(e.x - ship.x, e.y - ship.y) > 1 ? 'capitalDown' : 'explode');
            break;
          case 'warn':
            sfx.play('warning');
            break;
          case 'boss-phase':
            fx.addShake(10);
            if (mRef.current.boss) vfx.shock(mRef.current.boss.x, mRef.current.boss.y, 420, 0.7, [229, 72, 77], 4);
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
            fx.ring(e.x, e.y, 'rgba(125, 150, 235, 0.7)', 0.15, 900);
            vfx.flash(e.x, e.y, 140, 0.5, [150, 210, 255]);
            vfx.burst(e.x, e.y, 18, [170, 220, 255], 300);
            sfx.play('chronoOn');
            break;
          case 'chrono-off':
            fx.ring(e.x, e.y, 'rgba(255, 159, 64, 0.9)', 0, 1300);
            vfx.shock(e.x, e.y, 700, 0.6, [255, 190, 120], 3);
            fx.addShake(6);
            sfx.play('chronoOff');
            break;
          case 'ally-hit':
            vfx.impact(e.x, e.y, [255, 190, 120]);
            break;
          case 'ally-lost':
            vfx.chain(e.x, e.y, 34, 4, 0.7);
            fx.addShake(10);
            say(`${e.name} is down`);
            break;
          case 'pod-tow':
            fx.ring(e.x, e.y, 'rgba(150, 210, 255, 0.9)', 0, 400);
            fx.popup(e.x, e.y - 26, 'POD SECURED');
            sfx.play('orb');
            break;
          case 'pod-saved':
            fx.ring(e.x, e.y, 'rgba(91, 240, 138, 0.9)', 0, 600);
            fx.popup(e.x, e.y - 26, '+300 RESCUED');
            sfx.play('unlock');
            break;
          case 'power-spawn':
            say(e.kind === 'shield' ? 'Shield cell nearby' : e.kind === 'overdrive' ? 'Overdrive cell nearby' : 'Repair kit nearby');
            break;
          case 'power-on':
            fx.ring(e.x, e.y, e.kind === 'overdrive' ? 'rgba(255, 140, 66, 0.9)' : e.kind === 'repair' ? 'rgba(91, 240, 138, 0.9)' : 'rgba(120, 200, 255, 0.9)', 0, 600);
            fx.popup(e.x, e.y - 26, e.kind === 'shield' ? 'SHIELD' : e.kind === 'overdrive' ? 'OVERDRIVE' : 'HULL +1');
            sfx.play('unlock');
            break;
          case 'shield-block':
            vfx.shieldHit(e.x, e.y);
            sfx.play('pass');
            say('Shield absorbed the hit');
            break;
          case 'combo':
            fx.popup(e.x, e.y - 30, `x${e.mult} CHAIN`, e.count >= 5);
            sfx.play('combo');
            break;
          case 'jump':
            fx.ring(e.x, e.y, 'rgba(125, 150, 235, 0.95)', 0, 1400);
            fx.ring(e.x, e.y, 'rgba(255, 255, 255, 0.8)', 0.15, 1200);
            vfx.flash(e.x, e.y, 260, 0.8, [170, 210, 255]);
            fx.flash = 0;
            sfx.play('levelup');
            break;
          case 'escape':
            fx.addShake(14);
            sfx.play('chaos');
            say('The singularity is collapsing · ESCAPE SOUTH');
            break;
          case 'won':
            fx.victory(lookRef.current.ship === 'phantom' ? 'supernova' : 'shockwave', mRef.current.ship.x, mRef.current.ship.y, ['#4C9DFF', '#FF9F40', '#FFD54A', '#F3F0EA']);
            sfx.play('win');
            break;
          case 'lost':
            fx.addShake(14);
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
    setResult({ r, o, reason: m.failReason, debrief: debriefOf(m) });
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
        stepMission(
          m,
          {
            ...inputRef.current.vector(),
            fire: inputRef.current.consumeFire(),
            assist: lookRef.current.aimAssist !== false,
          },
          dt,
        );
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
        // Engine rumble follows thrust while flying; silent when paused or once the mission ends
        sfxRef.current.setEngine(ph === 'playing' && m.status === 'playing' ? m.ship.thrust : null);
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
      Object.assign(j, {
        active: true,
        id: e.pointerId,
        ox: e.clientX,
        oy: e.clientY,
        x: 0,
        y: 0,
      });
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

  // Touch FIRE button: in the control pad on portrait phones (clear of the arena), else over the arena corner.
  const fireButton =
    props.isTouch && def.weapons && (phase === 'playing' || phase === 'launch') ? (
      <button
        type="button"
        className="m-fire"
        aria-label="Fire"
        onPointerDown={(e) => {
          e.stopPropagation(); // never starts the movement joystick
          e.preventDefault();
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          e.currentTarget.classList.add('down');
          if (phaseRef.current === 'playing') inputRef.current.setTouchFire(e.pointerId, true);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          e.currentTarget.classList.remove('down');
          inputRef.current.setTouchFire(e.pointerId, false);
        }}
        onPointerCancel={(e) => {
          e.currentTarget.classList.remove('down');
          inputRef.current.setTouchFire(e.pointerId, false);
        }}
        onLostPointerCapture={(e) => {
          e.currentTarget.classList.remove('down');
          inputRef.current.setTouchFire(e.pointerId, false);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        Fire
      </button>
    ) : null;
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const o = hud.objective;
  const chronoFrac = hud.chrono / CHRONO_DURATION;
  return (
    <div className="screen mission-play" style={{ '--lvl': rgb(def.accent) } as CSSProperties}>
      <header className={`m-hud${hud.hp === 1 ? ' m-critical' : ''}`} aria-label="Mission status">
        {hitKey > 0 && <span key={hitKey} className="m-hit-flash" aria-hidden="true" />}
        <div className="m-hud-row">
          <span className="m-title">
            <span className="m-code">{def.code}</span> {def.name}
            <span className="m-op">{OPERATIONS[def.id].op}</span>
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
          {objKey > 0 && <span key={objKey} className="m-obj-flash" aria-hidden="true" />}
          <span className="m-obj" aria-live="polite">
            <span className="m-phase" title={o.title}>
              Phase {o.phase}/{o.phases}
            </span>
            <span className="m-obj-text">{o.text}</span>
            {o.count && <span className="m-obj-count">{o.count}</span>}
          </span>
          <span key={`hull-${hitKey}`} className={`m-hull${hitKey > 0 ? ' m-jolt' : ''}`} aria-label={`Hull ${hud.hp} of ${hud.maxHp}`}>
            <span className="m-stat-label">{hud.hp === 1 ? 'Hull critical' : 'Hull'}</span>
            {Array.from({ length: hud.maxHp }, (_, k) => (
              <span key={k} className={k < hud.hp ? 'on' : ''} />
            ))}
          </span>
        </div>
        <div className="m-obj-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${o.progress})` }} />
        </div>
        {o.timer && (
          <div className={`m-timer${o.timer.urgent ? ' urgent' : ''}`} role="status" aria-label={`${o.timer.label} ${o.timer.value}`}>
            <span className="m-stat-label">{o.timer.label}</span>
            <span className="m-timer-value">{o.timer.value}</span>
          </div>
        )}
        <div className="m-hud-row m-status" aria-label="Ship systems">
          <span className={`m-sys${hud.shield ? ' on' : ''}`}>
            <span className="m-stat-label">Shield</span>
            {hud.shield ? 'Online' : 'Offline'}
          </span>
          <span className={`m-sys${hud.weapons ? ' on' : ''}${hud.overdrive > 0 ? ' od' : ''}`}>
            <span className="m-stat-label">Weapon</span>
            {!hud.weapons ? 'Unarmed' : hud.overdrive > 0 ? 'Overdrive' : hud.locked ? 'Target in sights' : 'Blaster ready'}
            {hud.overdrive > 0 && (
              <span className="m-chip-bar">
                <span
                  style={{
                    transform: `scaleX(${hud.overdrive / OVERDRIVE_TIME})`,
                  }}
                />
              </span>
            )}
          </span>
          <span className={`m-sys${hud.hostiles > 0 ? ' hostile' : ''}`}>
            <span className="m-stat-label">Hostiles</span>
            {hud.hostiles}
          </span>
          {hud.chain > 0 && <span className="m-chip m-chip-chain">x{hud.chain} chain</span>}
          {hud.incoming && (
            <span className="m-incoming" role="alert">
              Incoming
            </span>
          )}
          {hud.allies.map((a) => (
            <span key={a.id} className={`m-ally${a.down ? ' down' : a.frac < 0.35 ? ' low' : ''}`} aria-label={`${a.name} hull ${Math.round(a.frac * 100)}%`}>
              <span className="m-ally-name">{a.name.replace(/^(Transport|Capital ship|Frigate) /, '')}</span>
              <span className="m-ally-bar">
                <span style={{ transform: `scaleX(${a.down ? 0 : a.frac})` }} />
              </span>
            </span>
          ))}
        </div>
      </header>

      <div
        className="m-stage"
        ref={wrapRef}
        onPointerDown={(e) => {
          // Desktop: hold the left mouse button over the arena to fire.
          if (e.pointerType === 'mouse' && e.button === 0 && phaseRef.current === 'playing') inputRef.current.setMouseFire(true);
          joy(e, 'down');
        }}
        onPointerMove={(e) => joy(e, 'move')}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse') inputRef.current.setMouseFire(false);
          joy(e, 'up');
        }}
        onPointerCancel={(e) => {
          if (e.pointerType === 'mouse') inputRef.current.setMouseFire(false);
          joy(e, 'up');
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') inputRef.current.setMouseFire(false);
        }}
      >
        <div className="m-arena" style={{ width: size, height: size }}>
          <canvas ref={canvasRef} width={size * dpr} height={size * dpr} style={{ width: size, height: size }} aria-label={`${def.name} mission arena`} />
          {!showPad && fireButton}
          {hud.entrance && phase === 'playing' && (
            <div className="m-entrance" role="alert">
              <span className="m-entrance-kicker">Warning · capital-class hostile</span>
              <span className="m-entrance-name">The Guardian</span>
              <span className="m-entrance-hint">Shielded by generators. Destroy them all, then strike the core.</span>
            </div>
          )}
          {hud.boss && !hud.entrance && (
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
            <div key={toast.key} className={`m-toast m-toast-${toast.tag.toLowerCase()}`} role="status">
              <span className="m-toast-tag">{toast.tag}</span>
              {toast.text}
            </div>
          )}
          {phase === 'launch' && (
            <div className="m-launch" role="status" onPointerDown={() => setPhase('playing')}>
              <span className="m-launch-bar top" aria-hidden="true" />
              <span className="m-launch-kicker">
                Mission {def.code} · {OPERATIONS[def.id].op}
              </span>
              <span className="m-launch-name">{def.name}</span>
              <span className="m-launch-obj">{def.objective}</span>
              <span className={`m-launch-threat threat threat-${OPERATIONS[def.id].threat.toLowerCase()}`}>
                Threat <strong>{OPERATIONS[def.id].threat}</strong>
              </span>
              <span className="m-launch-bar bottom" aria-hidden="true" />
            </div>
          )}
        </div>
        {showPad && (
          <div className="touch-pad m-pad">
            <span className="touch-pad-ring" aria-hidden="true" />
            <span className="touch-pad-text" aria-hidden="true">
              Drag here or anywhere to fly
            </span>
            {fireButton}
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
            <p className="m-panel-text">
              {o.text}
              {o.count ? ` · ${o.count}` : ''}
            </p>
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

const MEDALS = ['', 'Bronze', 'Silver', 'Gold'];

interface Debrief {
  phases: { title: string; done: boolean; current: boolean }[];
  stats: [string, string][];
}

/** The debrief comes straight from the final mission state: what was completed, and what happened. */
function debriefOf(m: MissionState): Debrief {
  const phases = m.def.phases.map((ph, i) => ({
    title: ph.title,
    done: i < m.phase,
    current: i === m.phase && m.status !== 'won',
  }));
  const stats: [string, string][] = [];
  if (m.def.weapons) {
    const shots = m.flags.shots ?? 0;
    stats.push(['Kills', String(m.kills)], ['Accuracy', shots ? `${Math.round(((m.flags.shotsHit ?? 0) / shots) * 100)}%` : '–']);
  }
  stats.push(['Hits taken', String(m.hitsTaken)]);
  if (m.pods.length) stats.push(['Survivors', `${m.pods.filter((p) => p.state === 'saved').length * 8}/${m.pods.length * 8}`]);
  if (m.allies.length) stats.push(['Ships saved', `${m.allies.filter((a) => !a.destroyed).length}/${m.allies.length}`]);
  if (m.stability !== null) stats.push(['Core stability', `${Math.max(0, Math.round(m.stability))}%`]);
  if (m.def.id === 'alien-pursuit' && m.flags.commanderTotal) stats.push(['Command raider', m.flags.cmdKilled ? 'Destroyed' : 'Escaped']);
  return { phases, stats };
}

/** A short, specific suggestion for the reason the mission failed. */
export function failTip(reason: string): string {
  if (/debris/i.test(reason)) return 'Rocks drift in straight lines: watch their heading and pass behind them.';
  if (/barrier/i.test(reason)) return 'Barriers flicker before they switch on. Wait for the dashed line to go dim.';
  if (/shot down/i.test(reason)) return 'Gunners glow and draw a dashed line before firing. Move sideways when you see it.';
  if (/raider|hunter|drone/i.test(reason)) return 'Keep moving: hunters are slower than you. Let the blaster work at range.';
  if (/destroyed/i.test(reason)) return 'Stay close to the ships you protect and break up raider runs early.';
  if (/collapse/i.test(reason)) return 'Do not stop for long: the collapse speeds up the longer it runs.';
  if (/heat pulse/i.test(reason)) return 'Each pulse has a gap. Line up with it before the ring reaches you.';
  if (/core went critical/i.test(reason)) return 'Every reactor you bring online slows the decline, and destroying the turrets helps too.';
  if (/critical|life support|time/i.test(reason)) return 'Plan a route between objectives and skip the long detours.';
  if (/beam|Guardian/i.test(reason)) return 'A red dashed line means a beam: get off the line before it fires.';
  if (/horizon/i.test(reason)) return 'Head for the portal the moment the Guardian falls; the pull keeps getting stronger.';
  if (/turret/i.test(reason)) return 'Turrets do not move. Destroy them from range.';
  return 'Retry: every mission plays out the same way, so you can learn it.';
}

function MissionResultPanel(props: {
  def: (typeof MISSIONS)[number];
  result: {
    r: MissionResult;
    o: MissionOutcome;
    reason: string | null;
    debrief: Debrief;
  };
  onRetry: () => void;
  onNext: () => void;
  onMissions: () => void;
}) {
  const { r, o, reason, debrief } = props.result;
  const def = props.def;
  const hasNext = def.index < MISSIONS.length - 1;
  const level = levelFromXp(o.xpBefore + o.xpGained);
  const unlocked = [
    ...(o.firstClear && hasNext ? [`Mission ${MISSIONS[def.index + 1].code} · ${MISSIONS[def.index + 1].name}`] : []),
    ...o.newShips,
    ...o.newCosmetics,
    ...o.challengesCompleted.map((c) => `${c.scope === 'daily' ? 'Daily' : 'Weekly'} challenge: ${c.def.text}`),
  ];
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
        <span className="m-result-art" aria-hidden="true">
          <MissionArt id={def.id} />
        </span>
        <p className="m-kicker">{r.won ? 'Mission complete' : 'Mission failed'}</p>
        <h3 className="m-panel-title">{def.name}</h3>
        <p className="m-result-op">
          {OPERATIONS[def.id].op} · Threat {OPERATIONS[def.id].threat}
        </p>
        {!r.won && reason && <p className="m-reason">{reason}</p>}
        {!r.won && reason && <p className="m-tip">Tip: {failTip(reason)}</p>}
        {r.won && (
          <div className="m-medal">
            <Stars count={r.stars} animate />
            <span className={`m-medal-name medal-${r.stars}`}>{MEDALS[r.stars]} medal</span>
          </div>
        )}
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
        <div className="m-debrief" aria-label="Operation debrief">
          <span className="m-stat-label">Primary objective · {r.won ? 'complete' : 'failed'}</span>
          <ol className="m-phases">
            {debrief.phases.map((ph) => (
              <li key={ph.title} className={ph.done ? 'met' : ph.current ? 'current' : ''}>
                <span aria-hidden="true">{ph.done ? '✓' : ph.current ? '✕' : '·'}</span> {ph.title}
              </li>
            ))}
          </ol>
          <div className="m-debrief-stats">
            {debrief.stats.map(([label, value]) => (
              <span key={label}>
                <span className="m-stat-label">{label}</span>
                {value}
              </span>
            ))}
          </div>
        </div>
        <span className="m-stat-label m-optional-label">Optional objectives</span>
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
