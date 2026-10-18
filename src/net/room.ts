// Private multiplayer rooms: lobby, ready-up, host-started matches, live input and snapshots,
// results and rematches, plus leave, disconnect, reconnect and host-departure handling.
//
// Authority: the host's game is the only simulation. Clients send stick input (clamped and
// rate-limited by the host) and render what the host sends back. A client cannot set positions,
// scores or outcomes for itself or anyone else.
//
// The transport is abstract (see Conn): PeerJS/WebRTC in the browser, an in-memory network in tests.
//
// Two kinds of match share the same rooms, lobby, reconnect and results: the Arcade arena (match.ts)
// and co-op operations (coop.ts: the spacecraft mission simulation with one pilot per player). The room's
// `op` picks a co-op operation; with no `op` it plays the Arcade `mode`.

import type { MissionState } from '../mission/sim';
import { applyCoopSnapshot, coopOver, coopResults, coopSnapshot, createClientMission, createCoopMatch, isCoopOp, setCoopConnected, stepCoop, type CoopMatch, type CoopResults, type CoopSnapshot, type NetInput } from './coop';
import type { InputAck } from './predict';
import { MAX_PLAYERS, createMatch, matchMode, setConnected, snapshot, standings, stepMatch, type Match, type MatchMode, type Snapshot, type Vec } from './match';
import type { CoopMissionId, MissionEvent } from '../mission/sim';

/** 2: co-op operations (fire and aim-assist in the input message, co-op start and snapshots). */
export const PROTOCOL = 2;
/** Co-op operations take 2-4 pilots. */
export const OP_MIN_PLAYERS = 2;
export const OP_MAX_PLAYERS = 4;

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
  /** The co-op operation this room plays, or null for the Arcade `mode`. */
  op: CoopMissionId | null;
  /** Why the running match is paused (the host's game is in the background), or null. */
  paused: string | null;
  players: LobbyPlayer[];
  results: { rows: ResultRow[]; text: string; winners: string[]; team: boolean; won: boolean; op?: CoopResults } | null;
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
  notice: string | null;
}

// ---------- Messages ----------

type ClientMsg =
  | { t: 'hello'; v: number; name: string; shape: string; token: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; x: number; y: number; fire?: boolean; assist?: boolean; seq?: number }
  | { t: 'leave' };

type HostMsg =
  | { t: 'welcome'; you: string }
  | { t: 'lobby'; code: string; mode: MatchMode; op: CoopMissionId | null; phase: RoomPhase; players: LobbyPlayer[]; paused?: string | null }
  | { t: 'start'; mode: MatchMode; seed: number; op?: { id: CoopMissionId; slots: string[] } }
  | Snapshot
  | (CoopSnapshot & { n?: number; k?: (InputAck | null)[] })
  | { t: 'end'; rows: ResultRow[]; text: string; winners: string[]; team: boolean; won: boolean; op?: CoopResults }
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
  input: NetInput;
  /** Sequence number of the input in use (co-op guests number their inputs; -1 = none yet). */
  inputSeq: number;
  /** Simulation seconds the input in use has been applied for (counted in steps, for guests' prediction). */
  appliedFor: number;
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
  private op: CoopMissionId | null = null;
  private paused: string | null = null;
  /** Snapshots sent so far in this match (each carries its number, so a stale one is never applied). */
  private snapN = 0;
  match: Match | null = null;
  /** The running co-op operation (host side), if the room plays one. */
  coop: CoopMatch | null = null;
  private coopListeners = new Set<(events: MissionEvent[], m: MissionState) => void>();
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
      inputSeq: -1,
      appliedFor: 0,
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
      op: this.op,
      paused: this.paused,
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
    this.broadcast({ t: 'lobby', code: this.code, mode: this.mode, op: this.op, phase: this.phase, players: this.lobbyPlayers(), paused: this.paused });
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
      existing.inputSeq = -1; // a rejoining client numbers its inputs from the start again
      if (this.match) setConnected(this.match, existing.player.id, true);
      if (this.coop) setCoopConnected(this.coop, existing.player.id, true);
      this.notice = `${existing.player.name} reconnected`;
      conn.send({ t: 'welcome', you: existing.player.id } satisfies HostMsg);
      this.emit();
      if (this.match && this.phase === 'playing') conn.send({ t: 'start', mode: this.mode, seed: this.match.seed } satisfies HostMsg);
      if (this.coop && this.phase === 'playing') {
        // Rebuild their copy of the mission, then bring it up to date at once (without taking anyone's events).
        conn.send({ t: 'start', mode: this.mode, seed: this.coop.seed, op: { id: this.coop.op, slots: this.coop.slots } } satisfies HostMsg);
        conn.send({ ...coopSnapshot(this.coop, false), n: this.snapN, k: this.acks(this.coop) });
      }
      return existing;
    }
    if (this.phase !== 'lobby') return reject('in-progress');
    if (this.seats.size >= MAX_PLAYERS) return reject('full');
    const seat: Seat = {
      player: { id: hello.token, name: cleanName(hello.name), shape: SHAPES.has(hello.shape) ? hello.shape : 'square', color: this.freeColor(), ready: false, connected: true, host: false },
      conn,
      input: { x: 0, y: 0 },
      inputSeq: -1,
      appliedFor: 0,
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
        if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
        const x = msg.x;
        const y = msg.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        // Numbered inputs (co-op guests): one that is older than the input in use arrived late or twice: ignore it.
        if (msg.seq !== undefined) {
          if (typeof msg.seq !== 'number' || !Number.isSafeInteger(msg.seq) || msg.seq < 0) return;
          if (msg.seq <= seat.inputSeq) return;
          seat.inputSeq = msg.seq;
          seat.appliedFor = 0;
        }
        const len = Math.hypot(x, y);
        // Only a real `true` counts as pulling the trigger (or asking for aim assist).
        seat.input = { ...(len > 1 ? { x: x / len, y: y / len } : { x, y }), fire: msg.fire === true, assist: msg.assist === true };
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
      if (this.coop) setCoopConnected(this.coop, seat.player.id, false);
    } else {
      seat.player.connected = false;
      seat.conn = null;
      this.notice = `${seat.player.name} disconnected. They can rejoin with the same code`;
      if (this.match) setConnected(this.match, seat.player.id, false);
      if (this.coop) setCoopConnected(this.coop, seat.player.id, false);
    }
    this.emit();
  }

  setMode(mode: MatchMode): void {
    if (this.phase === 'playing') return;
    this.mode = mode;
    this.op = null;
    this.emit();
  }

  /** Play a co-op operation in this room (or null to go back to the Arcade mode). */
  setOperation(op: CoopMissionId | null): void {
    if (this.phase === 'playing' || (op !== null && !isCoopOp(op))) return;
    this.op = op;
    this.emit();
  }

  /** Host only. Needs at least two connected players, all ready (and no more than four for a co-op operation). */
  canStart(): boolean {
    const ps = this.lobbyPlayers().filter((p) => p.connected);
    if (this.phase === 'playing' || ps.length < 2 || !ps.every((p) => p.ready)) return false;
    return this.op === null || (ps.length >= OP_MIN_PLAYERS && ps.length <= OP_MAX_PLAYERS);
  }

  start(): boolean {
    if (!this.canStart()) return false;
    // Players who dropped out between matches give up their seat.
    for (const [id, s] of this.seats) if (!s.player.connected) this.seats.delete(id);
    const seed = this.seedSource();
    if (this.op) {
      // One pilot per player, in seat order (the host flies slot 0).
      this.match = null;
      this.coop = createCoopMatch(this.op, seed, this.lobbyPlayers().map((p) => p.id));
    } else {
      this.coop = null;
      this.match = createMatch(
        seed,
        this.mode,
        this.lobbyPlayers().map((p) => ({ id: p.id, name: p.name, shape: p.shape, color: p.color })),
      );
    }
    for (const s of this.seats.values()) {
      s.input = { x: 0, y: 0 };
      s.inputSeq = -1;
      s.inputAt = this.clock;
    }
    this.snapN = 0;
    this.paused = null;
    this.phase = 'playing';
    this.results = null;
    this.notice = null;
    this.acc = 0;
    this.sinceSnap = SNAP_EVERY;
    this.broadcast(this.coop ? { t: 'start', mode: this.mode, seed, op: { id: this.coop.op, slots: this.coop.slots } } : { t: 'start', mode: this.mode, seed });
    this.emit();
    return true;
  }

  /** The host's own controls. */
  setHostInput(v: NetInput): void {
    const seat = this.seats.get(this.hostId);
    if (!seat) return;
    const len = Math.hypot(v.x, v.y);
    seat.input = { ...(len > 1 ? { x: v.x / len, y: v.y / len } : { x: v.x, y: v.y }), fire: v.fire === true, assist: v.assist === true };
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
    if (this.paused && this.phase === 'playing') return; // nothing moves until the host is back
    if (this.coop && this.phase === 'playing') return this.tickCoop(dt, this.coop);
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

  private freshInputs(): Record<string, NetInput> {
    const inputs: Record<string, NetInput> = {};
    for (const s of this.seats.values()) {
      const fresh = s.player.id === this.hostId || this.clock - s.inputAt < INPUT_STALE;
      inputs[s.player.id] = fresh ? s.input : { x: 0, y: 0 };
    }
    return inputs;
  }

  /**
   * The host's own screen: called after each tick with that tick's mission events (each event once).
   * Local only: nothing extra is sent to anyone.
   */
  onCoopUpdate(fn: (events: MissionEvent[], m: MissionState) => void): () => void {
    this.coopListeners.add(fn);
    return () => this.coopListeners.delete(fn);
  }

  private tickCoop(dt: number, c: CoopMatch): void {
    this.acc += Math.min(dt, 0.25);
    const events: MissionEvent[] = [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      stepCoop(c, this.freshInputs(), STEP);
      for (const s of this.seats.values()) s.appliedFor += STEP;
      events.push(...c.mission.events); // this step's events (each step starts a fresh list)
      if (coopOver(c)) break;
    }
    for (const fn of this.coopListeners) fn(events, c.mission);
    this.sinceSnap += dt;
    const over = coopOver(c);
    if (this.sinceSnap >= SNAP_EVERY || over) {
      this.sinceSnap = 0;
      this.broadcast({ ...coopSnapshot(c), n: ++this.snapN, k: this.acks(c) });
    }
    if (over) this.finishCoop(c);
  }

  /** For each pilot: the input the host is applying (its number) and for how long, so a guest can predict from there. */
  private acks(c: CoopMatch): (InputAck | null)[] {
    return c.slots.map((id) => {
      const seat = this.seats.get(id);
      return seat && seat.inputSeq >= 0 ? [seat.inputSeq, Math.round(seat.appliedFor * 1000) / 1000] : null;
    });
  }

  /**
   * Pause the running match (the host's game went into the background, where browsers throttle it) or
   * resume it (null). Everyone is told why. While paused nothing is simulated, so nothing drifts.
   */
  setPaused(reason: string | null): void {
    if (this.phase !== 'playing' || this.closed || this.paused === reason) return;
    this.paused = reason;
    if (!reason) {
      // Back: start counting from now (no catch-up burst, no inputs treated as stale), and update everyone at once.
      this.acc = 0;
      this.sinceSnap = SNAP_EVERY;
      for (const s of this.seats.values()) s.inputAt = this.clock;
    }
    this.emit();
  }

  private finishCoop(c: CoopMatch): void {
    const r = coopResults(c);
    const name = (id: string) => this.seats.get(id)?.player.name ?? 'Pilot';
    // Rows in the shape every results screen understands, plus the co-op details in `op`.
    const rows: ResultRow[] = r.rows.map((x) => ({ id: x.id, name: name(x.id), orbs: 0, aliveTime: r.time, hits: x.hitsTaken, place: null }));
    this.results = { rows, text: r.text, winners: r.won ? c.slots : [], team: true, won: r.won, op: r };
    this.phase = 'results';
    this.paused = null;
    for (const s of this.seats.values()) s.player.ready = s.player.host;
    this.broadcast({ t: 'end', ...this.results });
    this.emit();
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
    this.coop = null;
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
    return this.op ? (this.coop?.mission.def.name ?? this.op) : matchMode(this.mode).name;
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
  private lastFire = false;
  private lastAssist = false;
  private seq = 0;
  private lastN = -1;
  /** The controls this client last sent (what the host applies to its pilot), and their number. */
  lastSent: { seq: number; x: number; y: number; fire: boolean; assist: boolean } = { seq: -1, x: 0, y: 0, fire: false, assist: false };
  /** The latest two snapshots with their arrival times, for smooth interpolation. */
  snaps: { at: number; snap: Snapshot }[] = [];
  /** Co-op: this client's copy of the mission (kept in step by the host's snapshots), the pilots' player ids by slot, and when it last updated. */
  coop: { mission: MissionState; slots: string[]; at: number; snapshots: number; ack: InputAck | null } | null = null;
  private coopListeners = new Set<(events: MissionEvent[], m: MissionState) => void>();

  constructor(
    private readonly connect: () => Promise<Conn>,
    readonly code: string,
    private readonly me: { token: string; name: string; shape: string },
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    this.viewState = { role: 'client', code, me: me.token, phase: 'lobby', mode: 'coop', op: null, paused: null, players: [], results: null, status: 'connecting', notice: null };
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

  /** Co-op: called after each snapshot is applied, with the events it carried (explosions, radio calls…). */
  onCoopUpdate(fn: (events: MissionEvent[], m: MissionState) => void): () => void {
    this.coopListeners.add(fn);
    return () => this.coopListeners.delete(fn);
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
        this.set({ phase: msg.phase, mode: msg.mode, op: isCoopOp(msg.op) ? msg.op : null, paused: typeof msg.paused === 'string' ? msg.paused.slice(0, 120) : null, players: Array.isArray(msg.players) ? msg.players : [] });
        break;
      case 'start': {
        this.snaps = [];
        this.coop = null;
        this.lastN = -1;
        const op = msg.op;
        if (op && isCoopOp(op.id) && Array.isArray(op.slots) && op.slots.length >= 1 && op.slots.length <= OP_MAX_PLAYERS && op.slots.every((x) => typeof x === 'string') && Number.isFinite(msg.seed)) {
          this.coop = { mission: createClientMission(op.id, msg.seed, op.slots.length), slots: [...op.slots], at: this.now(), snapshots: 0, ack: null };
        }
        this.set({ phase: 'playing', mode: msg.mode, results: null });
        break;
      }
      case 'osnap': {
        const c = this.coop;
        if (!c) return;
        // A snapshot older than one already shown (possible only on an unordered link) is never applied.
        if (typeof msg.n === 'number') {
          if (msg.n <= this.lastN) return;
          this.lastN = msg.n;
        }
        applyCoopSnapshot(c.mission, msg);
        const mine = c.slots.indexOf(this.me.token);
        const ack = Array.isArray(msg.k) ? msg.k[mine] : null;
        c.ack = Array.isArray(ack) && ack.length === 2 && Number.isSafeInteger(ack[0]) && Number.isFinite(ack[1]) ? [ack[0], ack[1]] : null;
        c.at = this.now();
        c.snapshots++;
        const events = Array.isArray(msg.ev) ? msg.ev : [];
        for (const fn of this.coopListeners) fn(events, c.mission);
        break;
      }
      case 'snap':
        this.snaps = [...this.snaps.slice(-1), { at: this.now(), snap: msg }];
        for (const fn of this.snapListeners) fn(msg);
        break;
      case 'end':
        this.set({ phase: 'results', results: { rows: msg.rows, text: msg.text, winners: msg.winners, team: msg.team, won: msg.won, ...(msg.op ? { op: msg.op } : {}) } });
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

  /** The number the next input sent will carry (controls not sent yet will go out under it). */
  get nextSeq(): number {
    return this.seq;
  }

  /** Call every frame with the stick vector (and, in co-op, the trigger); sends at most 30 times a second. */
  input(v: Vec & { fire?: boolean; assist?: boolean }, dt: number): void {
    this.sinceInput += dt;
    const fire = v.fire === true;
    const assist = v.assist === true;
    const changed = Math.abs(v.x - this.lastInput.x) > 0.02 || Math.abs(v.y - this.lastInput.y) > 0.02 || fire !== this.lastFire || assist !== this.lastAssist;
    // Co-op guests send every change at once (so the host applies it when the guest's prediction does), and
    // otherwise steadily 30 times a second (so the host's acknowledgements pin down what it has applied).
    // Arcade keeps its original pacing.
    if (this.coop ? !changed && this.sinceInput < INPUT_EVERY : this.sinceInput < INPUT_EVERY || (!changed && this.sinceInput < 0.2)) return;
    this.sinceInput = 0;
    this.lastInput = { x: v.x, y: v.y };
    this.lastFire = fire;
    this.lastAssist = assist;
    const msg: ClientMsg = { t: 'input', x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100, seq: this.seq++ };
    if (fire) msg.fire = true;
    if (assist) msg.assist = true;
    if (!this.conn) return;
    this.conn.send(msg);
    this.lastSent = { seq: msg.seq!, x: msg.x, y: msg.y, fire, assist };
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
