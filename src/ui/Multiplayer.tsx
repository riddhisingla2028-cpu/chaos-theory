import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Input } from '../game/input';
import { MP_COLORS, drawMatch, type MatchRenderData } from '../game/render';
import { MATCH_MODES, matchMode, type MatchMode } from '../net/match';
import { ClientRoom, HostRoom, cleanName, makeRoomCode, normaliseCode, type RoomView } from '../net/room';
import { hostRoom, joinRoom, type HostEndpoint } from '../net/peer';
import { BackButton, ShapePreview } from './common';
import { track } from '../analytics';
import type { ShapeId } from '../progress';

const NAME_KEY = 'chaos-theory.mp.name';
const TOKEN_KEY = 'chaos-theory.mp.token';

const rgb = (c: [number, number, number]) => `rgb(${c.join(',')})`;

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** One id per browser tab, so a dropped player can rejoin into the same seat. */
function tabToken(): string {
  const s = storage('session');
  const existing = s?.getItem(TOKEN_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const t = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  s?.setItem(TOKEN_KEY, t);
  return t;
}

export const inviteCodeFromUrl = (): string | null => {
  try {
    return normaliseCode(new URLSearchParams(window.location.search).get('room') ?? '');
  } catch {
    return null;
  }
};

type Session = { kind: 'host'; room: HostRoom; endpoint: HostEndpoint } | { kind: 'client'; room: ClientRoom };

export function MultiplayerScreen(props: { shape: ShapeId; isTouch: boolean; initialCode: string | null; onBack: () => void; onInMatch: (on: boolean) => void }) {
  const [name, setName] = useState(() => storage('local')?.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(props.initialCode ?? '');
  const [mode, setMode] = useState<MatchMode>('coop');
  const [busy, setBusy] = useState<null | 'create' | 'join'>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const token = useMemo(tabToken, []);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  if (import.meta.env.DEV) (window as unknown as { __chaosMp?: () => Session | null }).__chaosMp = () => sessionRef.current;

  const finalName = cleanName(name || 'Player');
  const remember = () => storage('local')?.setItem(NAME_KEY, finalName);

  const leave = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.kind === 'host') {
      s.room.close();
      setTimeout(() => s.endpoint.close(), 400);
    } else s.room.leave();
    sessionRef.current = null;
    setSession(null);
    setView(null);
  }, []);

  // Leaving the screen or closing the tab tells the others straight away.
  useEffect(() => {
    const bye = () => leave();
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      leave();
    };
  }, [leave]);

  useEffect(() => {
    if (!session) return;
    return session.room.subscribe(setView);
  }, [session]);

  const inMatch = view?.phase === 'playing' && view.status !== 'closed';
  const onInMatch = useRef(props.onInMatch);
  onInMatch.current = props.onInMatch;
  useEffect(() => onInMatch.current(!!inMatch), [inMatch]);

  const create = async () => {
    setBusy('create');
    setError(null);
    remember();
    for (let attempt = 0; attempt < 3; attempt++) {
      const roomCode = makeRoomCode();
      const room = new HostRoom(roomCode, mode, { id: token, name: finalName, shape: props.shape });
      try {
        const endpoint = await hostRoom(
          roomCode,
          (c) => room.accept(c),
          () => setError('Lost contact with the matchmaking service. Players already in the room can keep playing.'),
        );
        setSession({ kind: 'host', room, endpoint });
        track('mp_room_created', { mode });
        setBusy(null);
        return;
      } catch (e) {
        if (e instanceof Error && e.message === 'taken') continue;
        setError('Could not create a room. Check your internet connection and try again.');
        setBusy(null);
        return;
      }
    }
    setError('Could not find a free room code. Please try again.');
    setBusy(null);
  };

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    const c = normaliseCode(code);
    if (!c) {
      setError('Room codes are 5 letters and numbers, like K7QXM.');
      return;
    }
    setBusy('join');
    setError(null);
    remember();
    const room = new ClientRoom(() => joinRoom(c), c, { token, name: finalName, shape: props.shape });
    setSession({ kind: 'client', room });
    await room.open();
    if (room.view.status !== 'closed') track('mp_room_joined');
    setBusy(null);
  };

  // ---------- Views ----------

  if (session && view) {
    if (view.status === 'closed') {
      return (
        <Shell title="Multiplayer" onBack={leave}>
          <div className="mp-card">
            <p className="mp-notice">{view.notice ?? 'You left the room.'}</p>
            <button type="button" className="btn btn-primary" onClick={leave} autoFocus>
              Back to multiplayer
            </button>
          </div>
        </Shell>
      );
    }
    if (view.phase === 'playing') return <MatchView session={session} view={view} isTouch={props.isTouch} onLeave={leave} />;
    if (view.phase === 'results') return <Results session={session} view={view} onLeave={leave} />;
    return <Lobby session={session} view={view} onLeave={leave} />;
  }

  return (
    <Shell title="Multiplayer" onBack={props.onBack}>
      <div className="mp-menu">
        <label className="mp-field">
          Your name
          <input value={name} maxLength={16} placeholder="Player" autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
        </label>

        <section className="mp-card">
          <h3 className="mp-h">Create a private room</h3>
          <div className="mp-modes" role="radiogroup" aria-label="Game mode">
            {MATCH_MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`mp-mode${mode === m.id ? ' mp-mode-on' : ''}`} onClick={() => setMode(m.id)}>
                <span className="mp-mode-name">{m.name}</span>
                <span className="mp-mode-blurb">{m.blurb}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary btn-wide" disabled={!!busy} onClick={() => void create()}>
            {busy === 'create' ? 'Creating…' : 'Create room'}
          </button>
        </section>

        <form className="mp-card" onSubmit={(e) => void join(e)}>
          <h3 className="mp-h">Join a friend</h3>
          <label className="mp-field">
            Room code
            <input
              className="mp-code-input"
              value={code}
              maxLength={7}
              placeholder="K7QXM"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoFocus={!!props.initialCode}
            />
          </label>
          <button type="submit" className="btn btn-wide" disabled={!!busy}>
            {busy === 'join' ? 'Joining…' : 'Join room'}
          </button>
        </form>
        {error && (
          <p className="mp-error" role="alert">
            {error}
          </p>
        )}
        <p className="mp-fine">
          Rooms are private: only people with the code or invite link can join, up to 6 players. Players connect directly to each other (peer to peer), so
          they can see each other&rsquo;s network address. Boss Co-op is not available yet.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="screen multiplayer">
      <header className="screen-top">
        <BackButton onClick={onBack} />
        <h2 className="screen-heading">{title}</h2>
        <span />
      </header>
      <div className="screen-scroll narrow">{children}</div>
    </div>
  );
}

function PlayerList({ view }: { view: RoomView }) {
  return (
    <ul className="mp-players">
      {view.players.map((p) => (
        <li key={p.id} className={p.connected ? '' : 'mp-gone'} style={{ '--pc': rgb(MP_COLORS[p.color % MP_COLORS.length]) } as CSSProperties}>
          <span className="mp-avatar" aria-hidden="true">
            <ShapePreview shape={p.shape as ShapeId} size={22} />
          </span>
          <span className="mp-name">
            {p.name}
            {p.id === view.me && <span className="dim"> (you)</span>}
          </span>
          {p.host && <span className="mp-tag">Host</span>}
          <span className={`mp-ready${p.ready ? ' mp-ready-on' : ''}`}>{!p.connected ? 'Reconnecting…' : p.ready ? '✓ Ready' : 'Not ready'}</span>
        </li>
      ))}
    </ul>
  );
}

function Lobby({ session, view, onLeave }: { session: Session; view: RoomView; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?room=${view.code}`;
  const me = view.players.find((p) => p.id === view.me);
  const host = session.kind === 'host' ? session.room : null;
  const connected = view.players.filter((p) => p.connected);
  const startable = host?.canStart() ?? false;
  const why = connected.length < 2 ? 'Waiting for at least one more player' : !connected.every((p) => p.ready) ? 'Waiting for everyone to be ready' : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (view.status === 'connecting') {
    return (
      <Shell title="Joining" onBack={onLeave}>
        <div className="mp-card" aria-busy="true">
          <p className="mp-notice">Connecting to room {view.code}…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Room" onBack={onLeave}>
      <section className="mp-card mp-room">
        <p className="mp-label">Room code</p>
        <p className="mp-code" aria-label={`Room code ${view.code.split('').join(' ')}`}>
          {view.code}
        </p>
        <div className="mp-invite">
          <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-small" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {view.status === 'reconnecting' && <p className="mp-warn">{view.notice}</p>}
      </section>

      <section className="mp-card">
        <div className="section-head">
          <h3>Players</h3>
          <span className="dim">{view.players.length}/6</span>
        </div>
        <PlayerList view={view} />
      </section>

      <section className="mp-card">
        <div className="section-head">
          <h3>Mode</h3>
        </div>
        {host ? (
          <div className="mp-modes" role="radiogroup" aria-label="Game mode">
            {MATCH_MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={view.mode === m.id} className={`mp-mode${view.mode === m.id ? ' mp-mode-on' : ''}`} onClick={() => host.setMode(m.id)}>
                <span className="mp-mode-name">{m.name}</span>
                <span className="mp-mode-blurb">{m.blurb}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mp-mode-static">
            <strong>{matchMode(view.mode).name}</strong> · {matchMode(view.mode).blurb}
          </p>
        )}
      </section>

      <div className="mp-actions">
        {host ? (
          <>
            <button type="button" className="btn btn-primary btn-wide" disabled={!startable} onClick={() => host.start() && track('mp_match_started', { mode: view.mode, players: connected.length })}>
              Start match
            </button>
            {!startable && <p className="mp-hint">{why}</p>}
          </>
        ) : (
          <>
            <button type="button" className={`btn btn-wide${me?.ready ? '' : ' btn-primary'}`} onClick={() => (session as { room: ClientRoom }).room.setReady(!me?.ready)}>
              {me?.ready ? 'Not ready' : "I'm ready"}
            </button>
            <p className="mp-hint">The host starts the match when everyone is ready.</p>
          </>
        )}
        <button type="button" className="btn btn-small" onClick={onLeave}>
          Leave room
        </button>
      </div>
      {view.notice && view.status === 'open' && <p className="mp-toast">{view.notice}</p>}
    </Shell>
  );
}

function Results({ session, view, onLeave }: { session: Session; view: RoomView; onLeave: () => void }) {
  const r = view.results!;
  const mode = view.mode;
  const youWon = r.team ? r.won : r.winners.includes(view.me);
  return (
    <Shell title="Results" onBack={onLeave}>
      <section className="mp-card mp-results">
        <p className={`stamp${youWon ? '' : ' stamp-dim'}`}>{r.team ? (r.won ? 'Team victory' : 'Team defeated') : youWon ? 'You win' : 'Match over'}</p>
        <p className="mp-result-text">{r.text}</p>
        <ol className="mp-rank">
          {r.rows.map((row, i) => (
            <li key={row.id} className={r.winners.includes(row.id) ? 'mp-winner' : ''}>
              <span className="mp-pos">{i + 1}</span>
              <span className="mp-name">
                {row.name}
                {row.id === view.me && <span className="dim"> (you)</span>}
              </span>
              <span className="mp-stat">{mode === 'orbs' ? `${row.orbs} orbs` : `${row.aliveTime.toFixed(1)}s alive`}</span>
              <span className="mp-stat dim">{row.hits} hits</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="mp-actions">
        {session.kind === 'host' ? (
          <button type="button" className="btn btn-primary btn-wide" onClick={() => session.room.rematch()} autoFocus>
            Rematch
          </button>
        ) : (
          <p className="mp-hint">Waiting for the host to start a rematch…</p>
        )}
        <button type="button" className="btn btn-small" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </Shell>
  );
}

// ---------- The live match ----------

const JOY_R = 56;

function MatchView({ session, view, isTouch, onLeave }: { session: Session; view: RoomView; isTouch: boolean; onLeave: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(new Input());
  const [size, setSize] = useState(0);
  const [hud, setHud] = useState<{ time: number; rows: { name: string; value: string; color: number; me: boolean; alive: boolean }[] }>({ time: 0, rows: [] });
  const def = matchMode(view.mode);
  const playersRef = useRef(view.players);
  playersRef.current = view.players;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.floor(Math.min(el.clientWidth, el.clientHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    const down = (e: KeyboardEvent) => {
      if (input.handleKey(e.code, true)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => input.handleKey(e.code, false);
    const blur = () => input.reset();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const v = inputRef.current.vector();
      const roster = new Map(playersRef.current.map((p) => [p.id, p]));
      let data: MatchRenderData | null = null;
      let rows: { id: string; value: number; alive: boolean }[] = [];
      let time = 0;
      if (session.kind === 'host') {
        session.room.setHostInput(v);
        session.room.tick(dt);
        const m = session.room.match;
        if (m) {
          time = m.time;
          data = {
            time: m.time,
            arena: def.arena,
            players: m.players.map((p) => ({ id: p.id, name: p.name, shape: p.shape, color: p.color, x: p.x, y: p.y, alive: p.alive, connected: p.connected, grace: Math.max(0, p.graceUntil - m.time) })),
            hazards: m.hazards,
            orbs: m.orbs,
            me: view.me,
          };
          rows = m.players.filter((p) => p.connected).map((p) => ({ id: p.id, value: view.mode === 'orbs' ? p.orbs : p.aliveTime, alive: p.alive }));
        }
      } else {
        const room = session.room;
        room.input(v, dt);
        const snaps = room.snaps;
        const cur = snaps[snaps.length - 1];
        if (cur) {
          const prev = snaps.length > 1 ? snaps[0] : cur;
          const span = Math.max(0.001, cur.at - prev.at);
          const k = Math.min(1.25, Math.max(0, (now / 1000 - 0.05 - prev.at) / span));
          const lerp = (a: number, b: number) => a + (b - a) * k;
          const prevPlayers = new Map(prev.snap.players.map((p) => [p[0], p]));
          const sameHazards = prev.snap.hazards.length === cur.snap.hazards.length;
          time = cur.snap.time;
          data = {
            time: lerp(prev.snap.time, cur.snap.time),
            arena: def.arena,
            players: cur.snap.players.map((p) => {
              const q = prevPlayers.get(p[0]) ?? p;
              const info = roster.get(p[0]);
              return { id: p[0], name: info?.name ?? 'Player', shape: info?.shape ?? 'square', color: info?.color ?? 0, x: lerp(q[1], p[1]), y: lerp(q[2], p[2]), alive: !!p[3], connected: !!p[4], grace: p[8] };
            }),
            hazards: cur.snap.hazards.map((h, i) => {
              const ph = sameHazards ? prev.snap.hazards[i] : h;
              return { x: lerp(ph[0], h[0]), y: lerp(ph[1], h[1]), r: h[2], seek: !!h[3] };
            }),
            orbs: cur.snap.orbs.map(([x, y]) => ({ x, y })),
            me: view.me,
          };
          rows = cur.snap.players.filter((p) => p[4]).map((p) => ({ id: p[0], value: view.mode === 'orbs' ? p[5] : p[6], alive: !!p[3] }));
        }
      }
      const ctx = canvasRef.current?.getContext('2d');
      const px = canvasRef.current ? canvasRef.current.width / dpr : 0;
      if (ctx && data && px > 0) drawMatch(ctx, data, px, dpr, now / 1000);
      hudClock += dt;
      if (hudClock > 0.2) {
        hudClock = 0;
        setHud({
          time,
          rows: rows
            .sort((a, b) => b.value - a.value)
            .map((r) => ({
              name: roster.get(r.id)?.name ?? 'Player',
              value: view.mode === 'orbs' ? String(r.value) : `${r.value.toFixed(0)}s`,
              color: roster.get(r.id)?.color ?? 0,
              me: r.id === view.me,
              alive: r.alive,
            })),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [session, view.me, view.mode, def.arena]);

  // Floating touch joystick, anywhere on the arena.
  const joy = (e: ReactPointerEvent, phase: 'down' | 'move' | 'up') => {
    if (e.pointerType === 'mouse') return;
    const j = inputRef.current.joy;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (phase === 'down') {
      Object.assign(j, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (base) {
        base.hidden = false;
        base.style.left = `${e.clientX - JOY_R}px`;
        base.style.top = `${e.clientY - JOY_R}px`;
      }
    } else if (phase === 'move' && j.active && j.id === e.pointerId) {
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
    } else if (phase === 'up' && j.id === e.pointerId) {
      Object.assign(j, { active: false, id: -1, x: 0, y: 0 });
      if (base) base.hidden = true;
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    }
  };

  const left = def.duration ? Math.max(0, def.duration - hud.time) : null;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  return (
    <div className="screen mp-match">
      <header className="mp-hud">
        <span className="mp-hud-mode">{def.name}</span>
        <span className="mp-hud-time">{left !== null ? `${left.toFixed(0)}s left` : `${hud.time.toFixed(0)}s`}</span>
        <button type="button" className="btn btn-small" onClick={onLeave}>
          Leave
        </button>
      </header>
      <ol className="mp-board" aria-label="Live scores">
        {hud.rows.map((r, i) => (
          <li key={i} className={`${r.me ? 'mp-board-me' : ''}${r.alive ? '' : ' mp-board-down'}`} style={{ '--pc': rgb(MP_COLORS[r.color % MP_COLORS.length]) } as CSSProperties}>
            <span className="mp-dot" aria-hidden="true" />
            <span className="mp-board-name">{r.name}</span>
            <span className="mp-board-val">{r.alive ? r.value : view.mode === 'lps' ? 'out' : 'down'}</span>
          </li>
        ))}
      </ol>
      {view.status === 'reconnecting' && <p className="mp-warn mp-warn-float">{view.notice}</p>}
      <div
        className="mp-arena"
        ref={wrapRef}
        onPointerDown={(e) => joy(e, 'down')}
        onPointerMove={(e) => joy(e, 'move')}
        onPointerUp={(e) => joy(e, 'up')}
        onPointerCancel={(e) => joy(e, 'up')}
      >
        <canvas ref={canvasRef} width={size * dpr} height={size * dpr} style={{ width: size, height: size }} aria-label={`${def.name} arena`} />
      </div>
      {isTouch && <p className="mp-touch-hint">Drag anywhere to move</p>}
      <div className="joystick mp-joystick" ref={baseRef} hidden style={{ width: JOY_R * 2, height: JOY_R * 2 }}>
        <div className="joystick-knob" ref={knobRef} />
      </div>
    </div>
  );
}
