// Co-op operation screens (P2.4): the live match and the team debrief. The host's screen draws the real
// mission; a client's screen draws its copy, kept in step by snapshots and smoothed between them. Both
// reuse the solo mission renderer, HUD styles, controls and effects.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Sfx } from '../game/audio';
import { Fx } from '../game/fx';
import { Input } from '../game/input';
import { contactView } from '../mission/encounters';
import { createRenderMemory, drawMission, type MissionLook } from '../mission/render';
import { CHRONO_SCALE, objectiveView, type MissionEvent, type MissionState } from '../mission/sim';
import { Predictor } from '../net/predict';
import type { ClientRoom, HostRoom, RoomView } from '../net/room';
import { COOP_HULLS, coopCallout, playerColor, resultsView, teamRows, type PilotRow } from './coopView';
import { Stars } from './common';

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;
const JOY_R = 56;
const PAD_ROOM = 112;

type CoopSession = { kind: 'host'; room: HostRoom } | { kind: 'client'; room: ClientRoom };

/** The mission this screen shows: the host's own, or the client's copy. */
const missionOf = (s: CoopSession): { m: MissionState; slots: string[] } | null => {
  if (s.kind === 'host') return s.room.coop ? { m: s.room.coop.mission, slots: s.room.coop.slots } : null;
  return s.room.coop ? { m: s.room.coop.mission, slots: s.room.coop.slots } : null;
};

/**
 * Smooths a client's view between snapshots (20 a second): moving things are carried forward along their
 * velocity for up to a tenth of a second, and the camera eases to its new position. The host's screen
 * needs none of this.
 */
class Smoother {
  private at = 0;
  private ships: { x: number; y: number; vx: number; vy: number }[] = [];
  private drones = new Map<number, { x: number; y: number; vx: number; vy: number }>();
  private bullets = new Map<number, { x: number; y: number; vx: number; vy: number }>();
  private cam = { x: 0, y: 0 };
  private camFrom = { x: 0, y: 0 };

  snapshot(m: MissionState, now: number): void {
    this.camFrom = this.at ? this.current() : { x: m.camX, y: m.camY };
    this.at = now;
    this.ships = m.ships.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy }));
    this.drones = new Map(m.drones.map((d) => [d.id, { x: d.x, y: d.y, vx: d.vx, vy: d.vy }]));
    this.bullets = new Map(m.bullets.map((b) => [b.id, { x: b.x, y: b.y, vx: b.vx, vy: b.vy }]));
    this.cam = { x: m.camX, y: m.camY };
  }

  private camK = 0;
  private current() {
    return { x: this.camFrom.x + (this.cam.x - this.camFrom.x) * this.camK, y: this.camFrom.y + (this.cam.y - this.camFrom.y) * this.camK };
  }

  /** `own`: this screen's pilot when it is predicted locally (left to the predictor). */
  apply(m: MissionState, now: number, own = -1): void {
    if (!this.at) return;
    const age = Math.min(0.1, Math.max(0, now - this.at));
    const world = m.chrono.active > 0 ? age * CHRONO_SCALE : age;
    m.ships.forEach((p, i) => {
      const b = this.ships[i];
      if (!b || p.downed || !p.online || i === own) return;
      p.x = b.x + b.vx * age;
      p.y = b.y + b.vy * age;
    });
    for (const d of m.drones) {
      const b = this.drones.get(d.id);
      if (b) {
        d.x = b.x + b.vx * world;
        d.y = b.y + b.vy * world;
      }
    }
    for (const x of m.bullets) {
      const b = this.bullets.get(x.id);
      if (b) {
        const t = x.from === 'player' ? age : world;
        x.x = b.x + b.vx * t;
        x.y = b.y + b.vy * t;
      }
    }
    this.camK = Math.min(1, age / 0.05);
    const c = this.current();
    m.camX = c.x;
    m.camY = c.y;
  }
}

interface CoopHud {
  title: string;
  phase: number;
  phases: number;
  text: string;
  count: string | null;
  progress: number;
  contact: ReturnType<typeof contactView>;
  hold: string | null;
  time: number;
  score: number;
  rows: PilotRow[];
  callout: ReturnType<typeof coopCallout>;
}

export function CoopMatchView(props: { session: CoopSession; view: RoomView; isTouch: boolean; sfx?: Sfx; reducedMotion: boolean; aimAssist: boolean; onLeave: () => void }) {
  const { session, view } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(new Input());
  const fxRef = useRef(new Fx());
  const memRef = useRef(createRenderMemory(7));
  const smootherRef = useRef(new Smoother());
  const predictorRef = useRef(new Predictor());
  const pausedRef = useRef(view.paused);
  pausedRef.current = view.paused;
  const [size, setSize] = useState(0);
  const [hud, setHud] = useState<CoopHud | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string; tag: 'Alert' | 'Comms' | 'Objective' } | null>(null);
  const playersRef = useRef(view.players);
  playersRef.current = view.players;
  const sfxRef = useRef(props.sfx);
  sfxRef.current = props.sfx;
  const meRef = useRef(view.me);
  meRef.current = view.me;
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && window.innerHeight > window.innerWidth);
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const showPad = props.isTouch && portrait;
  if (import.meta.env.DEV) {
    // Test hook (development builds only): the mission this screen is showing.
    (window as unknown as { __chaosCoop?: () => { m: MissionState; slots: string[] } | null }).__chaosCoop = () => missionOf(session);
  }

  const say = useCallback((text: string, tag: 'Alert' | 'Comms' | 'Objective' = 'Alert') => setToast({ key: Date.now() + Math.random(), text, tag }), []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize(Math.max(200, Math.floor(Math.min(el.clientWidth, el.clientHeight - (showPad ? PAD_ROOM : 0)))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showPad]);

  // Keyboard and mouse. Unlike solo, a co-op match never pauses: the others keep flying.
  useEffect(() => {
    const input = inputRef.current;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (input.handleKey(e.code, true)) e.preventDefault();
      if (e.code === 'Space') e.preventDefault();
      if (!e.repeat) input.handleFireKey(e.code, true);
    };
    const up = (e: KeyboardEvent) => {
      input.handleKey(e.code, false);
      input.handleFireKey(e.code, false);
    };
    const mouseUp = () => input.setMouseFire(false);
    const blur = () => input.reset();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerup', mouseUp);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', mouseUp);
      input.releaseFire();
    };
  }, []);

  // The host's game going into the background: browsers throttle hidden tabs (timers slow to a crawl and
  // animation frames stop), so the operation is paused for everyone rather than left to stall or drift.
  useEffect(() => {
    if (session.kind !== 'host') return;
    const room = session.room;
    const vis = () => {
      inputRef.current.reset();
      room.setPaused(document.hidden ? 'The host’s game is in the background' : null);
    };
    document.addEventListener('visibilitychange', vis);
    if (document.hidden) vis();
    return () => {
      document.removeEventListener('visibilitychange', vis);
      room.setPaused(null);
    };
  }, [session]);

  // Mission events: each arrives once (the host's from its own ticks, a client's with each snapshot).
  const handleEvents = useCallback(
    (events: MissionEvent[], m: MissionState, slots: string[]) => {
      const fx = fxRef.current;
      const vfx = memRef.current.vfx;
      const sfx = sfxRef.current;
      const mySlot = slots.indexOf(meRef.current);
      const nameOf = (slot: number) => playersRef.current.find((p) => p.id === slots[slot])?.name ?? `Pilot ${slot + 1}`;
      for (const e of events) {
        switch (e.type) {
          case 'shoot':
            vfx.muzzle(e.x, e.y, e.angle);
            // Only your own blaster is heard (four blasters at once would drown everything out).
            if (mySlot >= 0 && Math.hypot(e.x - m.ships[mySlot].x, e.y - m.ships[mySlot].y) < 40) sfx?.play('shoot');
            break;
          case 'enemy-shoot':
            vfx.flash(e.x, e.y, 22, 0.1, [255, 159, 64]);
            break;
          case 'enemy-hit':
            vfx.impact(e.x, e.y, [255, 190, 120]);
            break;
          case 'deflect':
            vfx.shock(e.x, e.y, 120, 0.25, [120, 190, 255], 2);
            vfx.impact(e.x, e.y, [150, 210, 255]);
            break;
          case 'explode':
            vfx.explosion(e.x, e.y, e.big ? 2 : 1);
            fx.addShake(e.big ? 10 : 3);
            sfx?.play('explode');
            break;
          case 'hit':
            vfx.hullHit(e.x, e.y);
            if (e.slot === undefined || e.slot === mySlot) {
              fx.addShake(9);
              fx.flash = 0.9;
              memRef.current.hurt = 0.28;
              sfx?.play('hit');
            }
            break;
          case 'shield-block':
            vfx.shieldHit(e.x, e.y);
            sfx?.play('pass');
            break;
          case 'warn':
            sfx?.play('warning');
            break;
          case 'comms':
            say(e.text, e.alert ? 'Alert' : 'Comms');
            if (e.alert) sfx?.play('warning');
            break;
          case 'objective':
            say(e.next ? `${e.done} ✓ · Next: ${e.next}` : `${e.done} ✓`, 'Objective');
            sfx?.play('unlock');
            break;
          case 'switch':
            vfx.flash(e.x, e.y, 120, 0.4, [91, 240, 138]);
            vfx.burst(e.x, e.y, 16, [91, 240, 138], 260);
            sfx?.play('pass');
            break;
          case 'pod-tow':
            fx.ring(e.x, e.y, 'rgba(255, 213, 74, 0.9)', 0, 500);
            sfx?.play('orb');
            break;
          case 'pod-saved':
            fx.ring(e.x, e.y, 'rgba(91, 240, 138, 0.9)', 0, 700);
            fx.popup(e.x, e.y - 26, 'CORE DELIVERED');
            sfx?.play('unlock');
            break;
          case 'portal-open':
            fx.ring(e.x, e.y, 'rgba(76, 157, 255, 0.9)', 0, 900);
            sfx?.play('levelup');
            break;
          // Downs and revives: no toast (it would cover the wreck). The HUD callout, the team strip and the
          // label on the wreck carry the message; the world shows the moment.
          case 'pilot-down':
            vfx.explosion(e.x, e.y, 1);
            fx.popup(e.x, e.y - 30, e.slot === mySlot ? 'YOU ARE DOWN' : `${nameOf(e.slot).toUpperCase()} DOWN`);
            sfx?.play('capitalDown');
            break;
          case 'pilot-revived':
            fx.ring(e.x, e.y, 'rgba(91, 240, 138, 0.95)', 0, 700);
            fx.popup(e.x, e.y - 30, e.slot === mySlot ? `REVIVED BY ${nameOf(e.by).toUpperCase()}` : `${nameOf(e.slot).toUpperCase()} REVIVED`);
            sfx?.play('levelup');
            break;
          case 'linked-reboot':
            vfx.flash(e.x, e.y, 90, 0.4, [255, 72, 88]);
            break;
          case 'encounter-clear':
            fx.popup(m.ships[Math.max(0, mySlot)].x, m.ships[Math.max(0, mySlot)].y - 40, `${e.name.toUpperCase()} CLEARED`);
            break;
          case 'won':
            sfx?.play('levelup');
            break;
          case 'lost':
            sfx?.play('capitalDown');
            break;
        }
      }
    },
    [say],
  );

  useEffect(() => {
    if (session.kind === 'host') return session.room.onCoopUpdate((ev, m) => handleEvents(ev, m, session.room.coop?.slots ?? []));
    return session.room.onCoopUpdate((ev, m) => {
      smootherRef.current.snapshot(m, performance.now() / 1000);
      // Restart this guest's own ship from the host's position and replay what the host has not applied yet.
      const c = session.room.coop;
      if (c) predictorRef.current.reconcile(m, c.slots.indexOf(meRef.current), c.ack, !!pausedRef.current);
      handleEvents(ev, m, session.room.coop?.slots ?? []);
    });
  }, [session, handleEvents]);

  // The frame loop: send controls (the host steps the mission), smooth, draw, refresh the HUD.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const input = inputRef.current;
      let controls = { ...input.vector(), fire: input.consumeFire(), assist: props.aimAssist };
      if (import.meta.env.DEV) {
        // Test hook (development builds only): a browser test may fly this screen's pilot with scripted controls.
        const drive = (window as unknown as { __coopDrive?: (m: MissionState, slot: number) => typeof controls | null }).__coopDrive;
        const cur = drive && missionOf(session);
        const scripted = cur ? drive(cur.m, cur.slots.indexOf(view.me)) : null;
        if (scripted) controls = scripted;
      }
      if (session.kind === 'host') {
        session.room.setHostInput(controls);
        session.room.tick(dt);
      } else session.room.input(controls, dt);
      const cur = missionOf(session);
      if (cur) {
        const { m, slots } = cur;
        if (session.kind === 'client') {
          // A guest's own ship answers its controls at once (predicted); everything else is the host's.
          const slot = slots.indexOf(view.me);
          const room = session.room;
          const pred = predictorRef.current;
          // Fly with the controls held right now; tagged with the number they go out under (sent this frame, or next).
          const seq = room.lastSent.seq === room.nextSeq - 1 && room.lastSent.x === Math.round(controls.x * 100) / 100 && room.lastSent.y === Math.round(controls.y * 100) / 100 ? room.lastSent.seq : room.nextSeq;
          pred.frame(m, slot, seq, { x: controls.x, y: controls.y }, dt, !!pausedRef.current);
          if (!pausedRef.current) smootherRef.current.apply(m, now / 1000, pred.active ? slot : -1);
          pred.apply(m, slot);
        }
        fxRef.current.update(dt);
        const players = playersRef.current;
        const look: MissionLook = {
          ship: 'arrow',
          trail: 'classic',
          reducedMotion: props.reducedMotion,
          aimAssist: props.aimAssist,
          coop: { me: Math.max(0, slots.indexOf(view.me)), names: slots.map((id, i) => players.find((p) => p.id === id)?.name ?? `Pilot ${i + 1}`), colors: slots.map((id) => playerColor(players.find((p) => p.id === id))), hulls: slots.map((_, i) => COOP_HULLS[i % COOP_HULLS.length]) },
        };
        const ctx = canvasRef.current?.getContext('2d');
        const px = canvasRef.current ? canvasRef.current.width / dpr : 0;
        if (ctx && px > 0) drawMission(ctx, m, memRef.current, fxRef.current, look, px, dpr, now / 1000);
        hudClock += dt;
        if (hudClock > 0.1) {
          hudClock = 0;
          const o = objectiveView(m);
          const ph = m.def.phases[Math.min(m.phase, m.def.phases.length - 1)];
          const rows = teamRows(m, slots, players, view.me);
          setHud({ title: o.title, phase: o.phase, phases: o.phases, text: o.text, count: o.count, progress: o.progress, contact: contactView(m, ph.clear), hold: o.hold, time: m.time, score: m.score, rows, callout: coopCallout(m, rows) });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [session, view.me, props.aimAssist, props.reducedMotion]);

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

  const fireButton = props.isTouch ? (
    <button
      type="button"
      className="m-fire"
      aria-label="Fire"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        e.currentTarget.classList.add('down');
        inputRef.current.setTouchFire(e.pointerId, true);
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
  const name = missionOf(session)?.m.def.name ?? 'Co-op operation';
  return (
    <div className="screen mission-play coop-play" style={{ '--lvl': rgb([120, 200, 255]) } as CSSProperties}>
      <header className="m-hud" aria-label="Operation status">
        <div className="m-hud-row">
          <span className="m-title">
            <span className="m-code">Co-op</span> {name}
            <span className="m-op">Op. {name} · {hud?.rows.length ?? 0} pilots</span>
          </span>
          <span className="m-stat" aria-label="Team score">
            <span className="m-stat-label">Team score</span>
            {(hud?.score ?? 0).toLocaleString()}
          </span>
          <span className="m-stat" aria-label="Operation time">
            <span className="m-stat-label">Time</span>
            {fmt(hud?.time ?? 0)}
          </span>
          <button type="button" className="btn btn-small" onClick={props.onLeave}>
            Leave
          </button>
        </div>
        {hud && (
          <>
            <div className="m-hud-row m-hud-obj">
              <span className="m-obj" aria-live="polite">
                <span className="m-phase" title={hud.title}>
                  Phase {hud.phase}/{hud.phases}
                </span>
                <span className="m-obj-text">{hud.text}</span>
                {hud.count && <span className="m-obj-count">{hud.count}</span>}
              </span>
            </div>
            <div className="m-obj-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${hud.progress})` }} />
            </div>
            {(hud.contact || hud.hold) && (
              <div className={`m-contact${hud.contact?.state === 'inbound' ? ' inbound' : ''}`} role="status" data-testid="m-contact">
                {hud.contact && (
                  <>
                    <span className="m-stat-label">{hud.contact.state === 'inbound' ? 'Inbound' : 'Engaged'}</span>
                    <span className="m-contact-name">{hud.contact.name}</span>
                    {hud.contact.from && <span className="m-contact-from">from the {hud.contact.from === 'here' ? 'nearby' : hud.contact.from}</span>}
                    {hud.contact.state === 'engaged' && hud.contact.left > 0 && <span className="m-contact-left">{hud.contact.left} left</span>}
                  </>
                )}
                {hud.hold && <span className="m-contact-hold">{hud.hold}</span>}
              </div>
            )}
            <ul className="co-team" aria-label="Squadron">
              {hud.rows.map((r) => (
                <li key={r.slot} className={`co-pilot co-${r.state}${r.me ? ' co-me' : ''}`} style={{ '--pc': rgb(r.color) } as CSSProperties} data-testid={`co-pilot-${r.slot}`}>
                  <span className="co-dot" aria-hidden="true" />
                  <span className="co-name">
                    {r.name}
                    {r.me && <span className="dim"> (you)</span>}
                  </span>
                  <span className="co-state">
                    {r.state === 'offline' ? 'Offline' : r.state === 'downed' ? (r.revive > 0 ? `Reviving ${Math.round(r.revive * 100)}%` : 'DOWN · revive!') : r.carrying ? 'Carrying core' : ''}
                  </span>
                  {r.state === 'flying' && (
                    <span className="co-hull" aria-label={`Hull ${r.hp} of ${r.maxHp}`}>
                      {Array.from({ length: r.maxHp }, (_, k) => (
                        <span key={k} className={k < r.hp ? 'on' : ''} />
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {hud.callout && (
              <div className={`co-callout co-callout-${hud.callout.tone}`} role="alert" data-testid="co-callout">
                {hud.callout.text}
              </div>
            )}
          </>
        )}
      </header>

      <div
        className="m-stage"
        ref={wrapRef}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button === 0) inputRef.current.setMouseFire(true);
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
          <canvas ref={canvasRef} width={size * dpr} height={size * dpr} style={{ width: size, height: size }} aria-label={`${name} co-op arena`} />
          {!showPad && fireButton}
          {view.paused && (
            <div className="m-overlay co-paused" role="alert" data-testid="co-paused">
              <div className="m-panel">
                <p className="m-kicker">Operation paused</p>
                <p className="m-panel-text">{session.kind === 'host' ? 'You switched away, so the operation paused for everyone. It continues now that you are back.' : `${view.paused}. Nothing moves until they return; the operation continues automatically.`}</p>
              </div>
            </div>
          )}
          {toast && (
            <div key={toast.key} className={`m-toast m-toast-${toast.tag.toLowerCase()}`} role="status">
              <span className="m-toast-tag">{toast.tag}</span>
              {toast.text}
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
      {view.status === 'reconnecting' && <p className="mp-warn mp-warn-float">{view.notice}</p>}
      <div className="joystick mp-joystick" ref={baseRef} hidden style={{ width: JOY_R * 2, height: JOY_R * 2 }}>
        <div className="joystick-knob" ref={knobRef} />
      </div>
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The team debrief, the same on every screen (it is built from the host's results message). */
export function CoopResultsPanel(props: { view: RoomView; isHost: boolean; onRematch: () => void; onLeave: () => void }) {
  const r = props.view.results!;
  const v = useMemo(() => resultsView(r.op!, props.view.players, props.view.me), [r, props.view.players, props.view.me]);
  return (
    <section className="mp-card mp-results co-results" data-testid="co-results">
      <p className={`stamp${v.won ? '' : ' stamp-dim'}`}>{v.title}</p>
      <p className="mp-result-text">
        {v.mission} · {v.text}
      </p>
      <div className="co-summary">
        <span>
          <span className="m-stat-label">Time</span>
          {v.time}
        </span>
        <span>
          <span className="m-stat-label">Team score</span>
          {v.score}
        </span>
        {v.won && (
          <span>
            <span className="m-stat-label">Rating</span>
            <Stars count={v.stars} max={3} />
          </span>
        )}
      </div>
      <ol className="co-phases" aria-label="Phases">
        {v.phases.map((p) => (
          <li key={p.title} className={p.done ? 'done' : ''}>
            <span aria-hidden="true">{p.done ? '✓' : '✗'}</span> {p.title}
          </li>
        ))}
      </ol>
      <div className="co-table-wrap">
        <table className="co-table">
          <thead>
            <tr>
              <th scope="col">Pilot</th>
              <th scope="col">Kills</th>
              <th scope="col">Revives</th>
              <th scope="col">Downed</th>
              <th scope="col">Objective</th>
              <th scope="col">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((row) => (
              <tr key={row.id} className={row.me ? 'co-me' : ''} style={{ '--pc': rgb(row.color) } as CSSProperties}>
                <th scope="row">
                  <span className="co-dot" aria-hidden="true" />
                  {row.name}
                  {row.me && <span className="dim"> (you)</span>}
                </th>
                <td>{row.kills}</td>
                <td>{row.revives}</td>
                <td>{row.downs}</td>
                <td>{row.objective}</td>
                <td>{row.accuracy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mp-actions">
        {props.isHost ? (
          <button type="button" className="btn btn-primary btn-wide" onClick={props.onRematch} autoFocus>
            Rematch
          </button>
        ) : (
          <p className="mp-hint">Waiting for the host to start a rematch…</p>
        )}
        <button type="button" className="btn btn-small" onClick={props.onLeave}>
          Leave room
        </button>
      </div>
    </section>
  );
}
