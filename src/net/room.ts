// Private multiplayer rooms: lobby, ready-up, host-started matches, live input and snapshots,
// results and rematches, plus leave, disconnect, reconnect and host-departure handling.
//
// Authority: the host's game is the only simulation. Clients send stick input (clamped and
// rate-limited by the host) and render what the host sends back. A client cannot set positions,
// scores or outcomes for itself or anyone else.
//
// The transport is abstract (see Conn): PeerJS/WebRTC in the browser, an in-memory network in tests.

import { MAX_PLAYERS, createMatch, matchMode, setConnected, snapshot, standings, stepMatch, type Match, type MatchMode, type Snapshot, type Vec } from './match';

export const PROTOCOL = 1;

export interface Conn {
  send(msg: unknown): void;
  close(): void;
  onData(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  shape: string;
  color: number;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface ResultRow {
  id: string;
  name: string;
  orbs: number;
  aliveTime: number;
  hits: number;
  place: number | null;
}

export type RoomPhase = 'lobby' | 'playing' | 'results';

/** Everything the room screen needs, for host and client alike. */
export interface RoomView {
  role: 'host' | 'client';
  code: string;
  me: string;
  phase: RoomPhase;
  mode: MatchMode;
  players: LobbyPlayer[];
  results: { rows: ResultRow[]; text: string; winners: string[]; team: boolean; won: boolean } | null;
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
  notice: string | null;
}

// ---------- Messages ----------

type ClientMsg =
  | { t: 'hello'; v: number; name: string; shape: string; token: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; x: number; y: number }
  | { t: 'leave' };

type HostMsg =
  | { t: 'welcome'; you: string }
  | { t: 'lobby'; code: string; mode: MatchMode; phase: RoomPhase; players: LobbyPlayer[] }
  | { t: 'start'; mode: MatchMode; seed: number }
  | Snapshot
  | { t: 'end'; rows: ResultRow[]; text: string; winners: string[]; team: boolean; won: boolean }
  | { t: 'reject'; reason: 'full' | 'in-progress' | 'version' | 'bad-hello' }
  | { t: 'closed'; reason: string };

const SHAPES = new Set(['square', 'diamond', 'triangle', 'circle', 'hexagon', 'star', 'nova', 'spark']);

/** Names are shown to other players: trim, strip control characters, cap the length. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return cleaned || 'Player';
}

const isObj = (m: unknown): m is Record<string, unknown> => typeof m === 'object' && m !== null && !Array.isArray(m);

// ---------- Room codes ----------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const CODE_LENGTH = 5;

export function makeRoomCode(rand: () => number = Math.random): string {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return c;
}

export function normaliseCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}

// ---------- Host ----------

const SNAP_EVERY = 0.05; // 20 snapshots a second
const STEP = 1 / 60;
const INPUT_STALE = 0.5; // a client that goes quiet stops moving rather than drifting
const INPUT_MAX_RATE = 90; // per second; more than this is ignored

interface Seat {
  player: LobbyPlayer;
  conn: Conn | null;
  input: Vec;
  inputAt: number;
  inputCount: number;
  inputWindow: number;
}

export class HostRoom {
  private seats = new Map<string, Seat>();
  private listeners = new Set<(v: RoomView) => void>();
  private phase: RoomPhase = 'lobby';
  private results: RoomView['results'] = null;
  private notice: string | null = null;
  match: Match | null = null;
  private acc = 0;
  private sinceSnap = 0;
  private clock = 0;
  private closed = false;

  constructor(
    readonly code: string,
    private mode: MatchMode,
    me: { id: string; name: string; shape: string },
    private readonly seedSource: () => number = () => Math.floor(Math.random() * 2 ** 31),
  ) {
    this.seats.set(me.id, {
      player: { id: me.id, name: cleanName(me.name), shape: SHAPES.has(me.shape) ? me.shape : 'square', color: 0, ready: true, connected: true, host: true },
      conn: null,
      input: { x: 0, y: 0 },
      inputAt: 0,
      inputCount: 0,
      inputWindow: 0,
    });
    this.hostId = me.id;
  }

  private readonly hostId: string;

  subscribe(fn: (v: RoomView) => void): () => void {
    this.listeners.add(fn);
    fn(this.view());
    return () => this.listeners.delete(fn);
  }

  view(): RoomView {
    return {
      role: 'host',
      code: this.code,
      me: this.hostId,
      phase: this.phase,
      mode: this.mode,
      players: this.lobbyPlayers(),
      results: this.results,
      status: this.closed ? 'closed' : 'open',
      notice: this.notice,
    };
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.seats.values()].map((s) => s.player);
  }

  private emit(): void {
    const v = this.view();
    for (const fn of this.listeners) fn(v);
    this.broadcast({ t: 'lobby', code: this.code, mode: this.mode, phase: this.phase, players: this.lobbyPlayers() });
  }

  private broadcast(msg: HostMsg): void {
    for (const s of this.seats.values()) {
      try {
        s.conn?.send(msg);
      } catch {
        // a broken connection is handled by its close event
      }
    }
  }

  private freeColor(): number {
    const used = new Set([...this.seats.values()].map((s) => s.player.color));
    for (let c = 0; c < MAX_PLAYERS; c++) if (!used.has(c)) return c;
    return 0;
  }

  /** A new connection from the transport. It must say hello before anything else. */
  accept(conn: Conn): void {
    let seat: Seat | null = null;
    const timer = setTimeout(() => !seat && conn.close(), 8000);
    conn.onData((raw) => {
      if (!isObj(raw)) return;
      const msg = raw as ClientMsg;
      if (!seat) {
        if (msg.t !== 'hello') return;
        clearTimeout(timer);
        seat = this.join(conn, msg);
        return;
      }
      this.handle(seat, msg);
    });
    conn.onClose(() => {
      clearTimeout(timer);
      if (seat && seat.conn === conn) this.drop(seat, false);
    });
  }

  private join(conn: Conn, hello: Extract<ClientMsg, { t: 'hello' }>): Seat | null {
    const reject = (reason: Extract<HostMsg, { t: 'reject' }>['reason']) => {
      conn.send({ t: 'reject', reason } satisfies HostMsg);
      setTimeout(() => conn.close(), 200);
      return null;
    };
    if (hello.v !== PROTOCOL) return reject('version');
    if (typeof hello.token !== 'string' || hello.token.length < 8 || hello.token.length > 64 || hello.token === this.hostId) return reject('bad-hello');
    const existing = this.seats.get(hello.token);
    if (existing) {
      // Reconnect: same player, same seat, even mid-match.
      existing.conn?.close();
      existing.conn = conn;
      existing.player.connected = true;
      existing.input = { x: 0, y: 0 };
      if (this.match) setConnected(this.match, existing.player.id, true);
      this.notice = `${existing.player.name} reconnected`;
      conn.send({ t: 'welcome', you: existing.player.id } satisfies HostMsg);
      this.emit();
      if (this.match && this.phase === 'playing') conn.send({ t: 'start', mode: this.mode, seed: this.match.seed } satisfies HostMsg);
      return existing;
    }
    if (this.phase !== 'lobby') return reject('in-progress');
    if (this.seats.size >= MAX_PLAYERS) return reject('full');
    const seat: Seat = {
      player: { id: hello.token, name: cleanName(hello.name), shape: SHAPES.has(hello.shape) ? hello.shape : 'square', color: this.freeColor(), ready: false, connected: true, host: false },
      conn,
      input: { x: 0, y: 0 },
      inputAt: 0,
      inputCount: 0,
      inputWindow: 0,
    };
    this.seats.set(seat.player.id, seat);
    this.notice = `${seat.player.name} joined`;
    conn.send({ t: 'welcome', you: seat.player.id } satisfies HostMsg);
    this.emit();
    return seat;
  }

  private handle(seat: Seat, msg: ClientMsg): void {
    switch (msg.t) {
      case 'ready':
        if (this.phase === 'lobby' || this.phase === 'results') {
          seat.player.ready = !!msg.ready;
          this.emit();
        }
        break;
      case 'input': {
        if (this.phase !== 'playing') return;
        seat.inputCount++;
        if (seat.inputCount > INPUT_MAX_RATE) return; // flood guard: per-second budget, reset in tick()
        const x = Number(msg.x);
        const y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const len = Math.hypot(x, y);
        seat.input = len > 1 ? { x: x / len, y: y / len } : { x, y };
        seat.inputAt = this.clock;
        break;
      }
      case 'leave':
        this.drop(seat, true);
        break;
    }
  }

  private drop(seat: Seat, left: boolean): void {
    if (left || this.phase === 'lobby') {
      this.seats.delete(seat.player.id);
      seat.conn?.close();
      this.notice = `${seat.player.name} left`;
      if (this.match) setConnected(this.match, seat.player.id, false);
    } else {
      seat.player.connected = false;
      seat.conn = null;
      this.notice = `${seat.player.name} disconnected. They can rejoin with the same code`;
      if (this.match) setConnected(this.match, seat.player.id, false);
    }
    this.emit();
  }

  setMode(mode: MatchMode): void {
    if (this.phase === 'playing') return;
    this.mode = mode;
    this.emit();
  }

  /** Host only. Needs at least two connected players, all ready. */
  canStart(): boolean {
    const ps = this.lobbyPlayers().filter((p) => p.connected);
    return this.phase !== 'playing' && ps.length >= 2 && ps.every((p) => p.ready);
  }

  start(): boolean {
    if (!this.canStart()) return false;
    // Players who dropped out between matches give up their seat.
    for (const [id, s] of this.seats) if (!s.player.connected) this.seats.delete(id);
    const seed = this.seedSource();
    this.match = createMatch(
      seed,
      this.mode,
      this.lobbyPlayers().map((p) => ({ id: p.id, name: p.name, shape: p.shape, color: p.color })),
    );
    for (const s of this.seats.values()) {
      s.input = { x: 0, y: 0 };
      s.inputAt = this.clock;
    }
    this.phase = 'playing';
    this.results = null;
    this.notice = null;
    this.acc = 0;
    this.sinceSnap = SNAP_EVERY;
    this.broadcast({ t: 'start', mode: this.mode, seed });
    this.emit();
    return true;
  }

  /** The host's own stick input. */
  setHostInput(v: Vec): void {
    const seat = this.seats.get(this.hostId);
    if (!seat) return;
    const len = Math.hypot(v.x, v.y);
    seat.input = len > 1 ? { x: v.x / len, y: v.y / len } : v;
    seat.inputAt = this.clock;
  }

  /** Drive the match from the host's frame loop. */
  tick(dt: number): void {
    this.clock += dt;
    for (const s of this.seats.values()) {
      if (this.clock - s.inputWindow >= 1) {
        s.inputWindow = this.clock;
        s.inputCount = 0;
      }
    }
    const m = this.match;
    if (!m || this.phase !== 'playing') return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const inputs: Record<string, Vec> = {};
      for (const s of this.seats.values()) {
        const fresh = s.player.id === this.hostId || this.clock - s.inputAt < INPUT_STALE;
        inputs[s.player.id] = fresh ? s.input : { x: 0, y: 0 };
      }
      stepMatch(m, inputs, STEP);
      if (m.status === 'over') break;
    }
    this.sinceSnap += dt;
    if (this.sinceSnap >= SNAP_EVERY || m.status === 'over') {
      this.sinceSnap = 0;
      this.broadcast(snapshot(m));
    }
    if (m.status === 'over') this.finish(m);
  }

  private finish(m: Match): void {
    const o = m.outcome!;
    const rows = standings(m).map((p) => ({ id: p.id, name: p.name, orbs: p.orbs, aliveTime: Math.round(p.aliveTime * 10) / 10, hits: p.hits, place: p.place }));
    this.results = { rows, text: o.text, winners: o.winners, team: o.team, won: o.won };
    this.phase = 'results';
    for (const s of this.seats.values()) s.player.ready = s.player.host;
    this.broadcast({ t: 'end', ...this.results });
    this.emit();
  }

  /** Back to the lobby for another round with the same room. */
  rematch(): void {
    if (this.phase !== 'results') return;
    this.phase = 'lobby';
    this.match = null;
    this.emit();
  }

  /** The host leaves: tell everyone first so they are not left waiting. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.broadcast({ t: 'closed', reason: 'The host closed the room' });
    for (const s of this.seats.values()) setTimeout(() => s.conn?.close(), 150);
    for (const fn of this.listeners) fn(this.view());
  }

  get modeName(): string {
    return matchMode(this.mode).name;
  }
}

// ---------- Client ----------

const INPUT_EVERY = 1 / 30;

export class ClientRoom {
  private listeners = new Set<(v: RoomView) => void>();
  private snapListeners = new Set<(s: Snapshot) => void>();
  private conn: Conn | null = null;
  private viewState: RoomView;
  private left = false;
  private lastInput: Vec = { x: 0, y: 0 };
  private sinceInput = 0;
  private reconnectUntil = 0;
  /** The latest two snapshots with their arrival times, for smooth interpolation. */
  snaps: { at: number; snap: Snapshot }[] = [];

  constructor(
    private readonly connect: () => Promise<Conn>,
    readonly code: string,
    private readonly me: { token: string; name: string; shape: string },
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    this.viewState = { role: 'client', code, me: me.token, phase: 'lobby', mode: 'coop', players: [], results: null, status: 'connecting', notice: null };
  }

  subscribe(fn: (v: RoomView) => void): () => void {
    this.listeners.add(fn);
    fn(this.viewState);
    return () => this.listeners.delete(fn);
  }

  onSnapshot(fn: (s: Snapshot) => void): () => void {
    this.snapListeners.add(fn);
    return () => this.snapListeners.delete(fn);
  }

  get view(): RoomView {
    return this.viewState;
  }

  private set(patch: Partial<RoomView>): void {
    this.viewState = { ...this.viewState, ...patch };
    for (const fn of this.listeners) fn(this.viewState);
  }

  async open(): Promise<void> {
    try {
      const conn = await this.connect();
      if (this.left) return conn.close();
      this.conn = conn;
      conn.onData((m) => this.receive(m));
      conn.onClose(() => this.lost(conn));
      conn.send({ t: 'hello', v: PROTOCOL, name: this.me.name, shape: this.me.shape, token: this.me.token } satisfies ClientMsg);
    } catch {
      if (this.viewState.status === 'reconnecting') return this.retryLater();
      this.set({ status: 'closed', notice: 'Could not find that room. Check the code, or ask the host for a new invite.' });
    }
  }

  private receive(raw: unknown): void {
    if (!isObj(raw)) return;
    const msg = raw as HostMsg;
    switch (msg.t) {
      case 'welcome':
        this.set({ status: 'open', notice: this.viewState.status === 'reconnecting' ? 'Reconnected' : null });
        break;
      case 'lobby':
        this.set({ phase: msg.phase, mode: msg.mode, players: Array.isArray(msg.players) ? msg.players : [] });
        break;
      case 'start':
        this.snaps = [];
        this.set({ phase: 'playing', mode: msg.mode, results: null });
        break;
      case 'snap':
        this.snaps = [...this.snaps.slice(-1), { at: this.now(), snap: msg }];
        for (const fn of this.snapListeners) fn(msg);
        break;
      case 'end':
        this.set({ phase: 'results', results: { rows: msg.rows, text: msg.text, winners: msg.winners, team: msg.team, won: msg.won } });
        break;
      case 'reject':
        this.left = true;
        this.set({
          status: 'closed',
          notice:
            msg.reason === 'full'
              ? 'That room is full.'
              : msg.reason === 'in-progress'
                ? 'That match has already started. Ask the host to invite you to the next one.'
                : 'Could not join that room.',
        });
        this.conn?.close();
        break;
      case 'closed':
        this.left = true;
        this.set({ status: 'closed', notice: 'The host left, so the room has closed.' });
        this.conn?.close();
        break;
    }
  }

  private lost(conn: Conn): void {
    if (conn !== this.conn) return;
    this.conn = null;
    if (this.left) return;
    // Unexpected drop: try to get back into the same seat for a while.
    if (this.viewState.status !== 'reconnecting') this.reconnectUntil = this.now() + 20;
    this.set({ status: 'reconnecting', notice: 'Connection lost. Reconnecting…' });
    this.retryLater();
  }

  private retryLater(): void {
    if (this.left) return;
    if (this.now() > this.reconnectUntil) {
      this.set({ status: 'closed', notice: 'Lost the connection to the host. The room may have closed.' });
      return;
    }
    setTimeout(() => void this.open(), 2000);
  }

  setReady(ready: boolean): void {
    this.conn?.send({ t: 'ready', ready } satisfies ClientMsg);
  }

  /** Call every frame with the stick vector; sends at most 30 times a second. */
  input(v: Vec, dt: number): void {
    this.sinceInput += dt;
    const changed = Math.abs(v.x - this.lastInput.x) > 0.02 || Math.abs(v.y - this.lastInput.y) > 0.02;
    if (this.sinceInput < INPUT_EVERY || (!changed && this.sinceInput < 0.2)) return;
    this.sinceInput = 0;
    this.lastInput = v;
    this.conn?.send({ t: 'input', x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100 } satisfies ClientMsg);
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    try {
      this.conn?.send({ t: 'leave' } satisfies ClientMsg);
    } catch {
      // already gone
    }
    setTimeout(() => this.conn?.close(), 100);
    this.set({ status: 'closed', notice: null });
  }
}
