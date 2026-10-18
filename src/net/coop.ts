// Co-op operations over the network (P2.3). The HOST runs the only mission simulation (src/mission/sim.ts)
// with one pilot per player; clients send their controls and receive snapshots. A client rebuilds the
// mission's static world itself (same definition, seed and number of pilots), then copies each snapshot's
// changing state onto it, so the existing renderer and HUD logic can read it like a local mission.
//
// Snapshot format: the busy lists (pilots, enemies, bolts, debris) travel as compact number tuples; the
// rest of the changing state travels as plain JSON with numbers rounded. Events (explosions, radio calls,
// objective updates) that happened since the last snapshot ride along with it, so each arrives once.

import { coopMissionById, createMission, setPilotOnline, starsFor, stepMission, type CoopMissionId, type Drone, type DroneKind, type MissionEvent, type MissionInput, type MissionState, type Pilot } from '../mission/sim';

export const COOP_OPS: readonly CoopMissionId[] = ['twin-lock'];
export const isCoopOp = (x: unknown): x is CoopMissionId => typeof x === 'string' && (COOP_OPS as readonly string[]).includes(x);

/** One player's controls, as sent over the network. */
export interface NetInput {
  x: number;
  y: number;
  fire?: boolean;
  assist?: boolean;
}

// ---------- Host side ----------

export interface CoopMatch {
  op: CoopMissionId;
  seed: number;
  /** Player ids by pilot slot. */
  slots: string[];
  mission: MissionState;
  /** Events since the last snapshot. */
  pending: MissionEvent[];
  /** Seconds since the mission ended (results follow a moment later, so everyone sees the end). */
  endedFor: number;
}

export function createCoopMatch(op: CoopMissionId, seed: number, players: string[]): CoopMatch {
  const mission = createMission(coopMissionById(op), seed, players.length);
  return { op, seed, slots: [...players], mission, pending: [], endedFor: 0 };
}

const IDLE: MissionInput = { x: 0, y: 0 };

/** Advance the host's mission one step. `inputs` maps player id to their controls. */
export function stepCoop(c: CoopMatch, inputs: Record<string, NetInput>, dt: number): void {
  const m = c.mission;
  if (m.status !== 'playing') {
    c.endedFor += dt;
    stepMission(m, IDLE, dt); // lets end-of-mission sequences (the boss's fall) finish
    return;
  }
  const list = c.slots.map((id): MissionInput => {
    const v = inputs[id];
    return v ? { x: v.x, y: v.y, fire: !!v.fire, assist: !!v.assist } : IDLE;
  });
  stepMission(m, list, dt);
  for (const e of m.events) c.pending.push(e);
}

export function setCoopConnected(c: CoopMatch, id: string, connected: boolean): void {
  const slot = c.slots.indexOf(id);
  if (slot >= 0) setPilotOnline(c.mission, slot, connected);
}

export const coopOver = (c: CoopMatch, grace = 1.5) => c.mission.status !== 'playing' && c.endedFor >= grace;

export interface CoopResultRow {
  id: string;
  slot: number;
  kills: number;
  revives: number;
  downs: number;
  objectiveTime: number;
  accuracy: number | null; // 0..100, null if no shots
  hitsTaken: number;
}

export interface CoopResults {
  op: CoopMissionId;
  won: boolean;
  text: string;
  phases: string[];
  stars: number;
  time: number;
  score: number;
  kills: number;
  rows: CoopResultRow[];
}

export function coopResults(c: CoopMatch): CoopResults {
  const m = c.mission;
  const won = m.status === 'won';
  return {
    op: c.op,
    won,
    text: won ? `Operation complete: ${m.def.name}` : (m.failReason ?? 'Operation failed'),
    phases: [...m.phasesDone],
    stars: starsFor(m),
    time: Math.round(m.time * 10) / 10,
    score: m.score,
    kills: m.kills,
    rows: c.slots.map((id, slot) => {
      const s = m.ships[slot].stats;
      return {
        id,
        slot,
        kills: s.kills,
        revives: s.revives,
        downs: s.downs,
        objectiveTime: Math.round(s.objectiveTime * 10) / 10,
        accuracy: s.shots ? Math.round((s.shotsHit / s.shots) * 100) : null,
        hitsTaken: s.hitsTaken,
      };
    }),
  };
}

// ---------- Snapshot codec ----------

const KINDS: DroneKind[] = ['scout', 'gunner', 'raider', 'turret', 'generator', 'hive', 'commander'];
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Clocks and timers travel at full precision (a countdown on screen must read the same everywhere). */
const EXACT = new Set(['time', 'realTime', 'phaseTime', 'timer', 'firstAt', 'active', 'nextSpawn', 'life', 'overdrive']);
/** Round non-integer numbers in plain data (for the JSON part of a snapshot), except clocks and timers (and the flags, which hold times). */
const rounded = (v: Record<string, unknown>): unknown => {
  const flags = v.flags;
  return JSON.parse(
    JSON.stringify(v, function (this: unknown, k: string, x: unknown) {
      if (this === flags || EXACT.has(k)) return x;
      return typeof x === 'number' && !Number.isInteger(x) && Number.isFinite(x) ? r2(x) : x;
    }),
  );
};

type ShipT = [number, number, number, number, number, number, number, number, number, 0 | 1, number, 0 | 1, number | null, number];
type DroneT = [number, number, number, number, number, number, number, number, number, number, number, number | null, string | null, string | null, 0 | 1];
type BulletT = [number, number, number, number, number, number, 0 | 1, number, number | null, 0 | 1];
type RockT = [number, number, number, number, number, number, number | null, string | null];

/** Changing state outside the busy lists (copied straight onto the client's mission). */
const REST_KEYS = [
  'status', 'failReason', 'realTime', 'time', 'camX', 'camY', 'score', 'kills', 'hitsTaken', 'cleared', 'turretsKilled', 'nearMisses',
  'combo', 'chrono', 'power', 'phase', 'phaseTime', 'phasesDone', 'flags', 'encounters', 'target', 'portal', 'rescueZone', 'collapseY',
  'collapseSpeed', 'boss', 'jump', 'stability', 'gravity', 'escaping', 'uplink', 'linked', 'pulses', 'pods', 'nextId',
] as const satisfies readonly (keyof MissionState)[];

export interface CoopSnapshot {
  t: 'osnap';
  s: ShipT[];
  d: DroneT[];
  b: BulletT[];
  r: RockT[];
  a: [number, number, number, number, 0 | 1, 0 | 1, number, number][]; // allies: id, x, y, hp, destroyed, arrived, pathIdx, hitFlash
  o: { c: number[]; g: number[]; re: [number, 0 | 1][]; sw: [number, 0 | 1][] }; // cores taken, gates passed, reactors, switches
  st: number[][]; // pilot stats: kills, shots, shotsHit, hitsTaken, downs, revives, objectiveTime
  rest: Record<string, unknown>;
  ev: MissionEvent[];
}

/**
 * Everything a client needs to show the mission as it is now, plus the events since the last snapshot.
 * `consume` false: a catch-up snapshot for one rejoining player (no events, and nobody else's are taken).
 */
export function coopSnapshot(c: CoopMatch, consume = true): CoopSnapshot {
  const m = c.mission;
  const rest: Record<string, unknown> = {};
  for (const k of REST_KEYS) rest[k] = m[k];
  const snap: CoopSnapshot = {
    t: 'osnap',
    s: m.ships.map((p): ShipT => [p.slot, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.angle), p.hp, r2(p.invuln), r2(p.thrust), p.downed ? 1 : 0, r2(p.reviveCharge), p.online ? 1 : 0, p.aimTarget, r2(p.fireCd)]),
    d: m.drones.map((d): DroneT => [d.id, KINDS.indexOf(d.kind), r1(d.x), r1(d.y), r1(d.vx), r1(d.vy), r2(d.hp), d.maxHp, r2(d.aim), r2(d.hitFlash), r2(d.spawnIn), d.targetAlly, d.tag ?? null, d.enc ?? null, d.hunt ? 1 : 0]),
    b: m.bullets.map((b): BulletT => [b.id, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.r, b.from === 'player' ? 1 : 0, r2(b.life), b.owner ?? null, b.drive ? 1 : 0]),
    r: m.rocks.map((r): RockT => [r.id, r1(r.x), r1(r.y), r1(r.vx), r1(r.vy), r1(r.r), r.hp ?? null, r.tag ?? null]),
    a: m.allies.map((a) => [a.id, r1(a.x), r1(a.y), r2(a.hp), a.destroyed ? 1 : 0, a.arrived ? 1 : 0, a.pathIdx, r2(a.hitFlash)]),
    o: { c: m.cores.flatMap((x, i) => (x.taken ? [i] : [])), g: m.gates.flatMap((x, i) => (x.passed ? [i] : [])), re: m.reactors.map((x) => [r2(x.charge), x.active ? 1 : 0]), sw: m.switches.map((x) => [r2(x.charge), x.active ? 1 : 0]) },
    st: m.ships.map((p) => [p.stats.kills, p.stats.shots, p.stats.shotsHit, p.stats.hitsTaken, p.stats.downs, p.stats.revives, r1(p.stats.objectiveTime)]),
    rest: rounded(rest) as Record<string, unknown>,
    ev: consume ? c.pending : [],
  };
  if (consume) c.pending = [];
  return snap;
}

// ---------- Client side ----------

/** A client's copy of the mission: built locally from the operation, seed and pilot count, then kept in step by snapshots. */
export function createClientMission(op: CoopMissionId, seed: number, pilots: number): MissionState {
  return createMission(coopMissionById(op), seed, pilots);
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Copy a snapshot onto the client's mission. Tolerant of malformed input (a snapshot comes from another
 * machine): anything not shaped as expected is skipped rather than allowed to break the client.
 */
export function applyCoopSnapshot(m: MissionState, snap: CoopSnapshot): void {
  if (!snap || typeof snap !== 'object') return;
  if (Array.isArray(snap.s)) {
    for (const t of snap.s) {
      if (!Array.isArray(t)) continue;
      const p: Pilot | undefined = m.ships[num(t[0], -1)];
      if (!p) continue;
      p.x = num(t[1], p.x);
      p.y = num(t[2], p.y);
      p.vx = num(t[3]);
      p.vy = num(t[4]);
      p.angle = num(t[5], p.angle);
      p.hp = num(t[6], p.hp);
      p.invuln = num(t[7]);
      p.thrust = num(t[8]);
      p.downed = t[9] === 1;
      p.reviveCharge = num(t[10]);
      p.online = t[11] === 1;
      p.aimTarget = typeof t[12] === 'number' ? t[12] : null;
      p.fireCd = num(t[13]);
    }
  }
  if (Array.isArray(snap.st)) {
    snap.st.forEach((s, i) => {
      const p = m.ships[i];
      if (!p || !Array.isArray(s)) return;
      p.stats = { kills: num(s[0]), shots: num(s[1]), shotsHit: num(s[2]), hitsTaken: num(s[3]), downs: num(s[4]), revives: num(s[5]), objectiveTime: num(s[6]) };
    });
  }
  if (Array.isArray(snap.d)) {
    m.drones = snap.d
      .filter((t) => Array.isArray(t) && KINDS[num(t[1], -1)] !== undefined)
      .map((t): Drone => {
        const d: Drone = { id: num(t[0]), kind: KINDS[num(t[1])], x: num(t[2]), y: num(t[3]), vx: num(t[4]), vy: num(t[5]), hp: num(t[6]), maxHp: num(t[7], 1), fireIn: 0, aim: num(t[8]), hitFlash: num(t[9]), spawnIn: num(t[10]), targetAlly: typeof t[11] === 'number' ? t[11] : null };
        if (typeof t[12] === 'string') d.tag = t[12];
        if (typeof t[13] === 'string') d.enc = t[13];
        if (t[14] === 1) d.hunt = 'carrier';
        return d;
      });
  }
  if (Array.isArray(snap.b)) {
    m.bullets = snap.b
      .filter((t) => Array.isArray(t))
      .map((t) => {
        const b = { id: num(t[0]), x: num(t[1]), y: num(t[2]), vx: num(t[3]), vy: num(t[4]), r: num(t[5], 5), from: t[6] === 1 ? ('player' as const) : ('enemy' as const), life: num(t[7]) } as MissionState['bullets'][number];
        if (typeof t[8] === 'number') b.owner = t[8];
        if (t[9] === 1) b.drive = true;
        return b;
      });
  }
  if (Array.isArray(snap.r)) {
    m.rocks = snap.r
      .filter((t) => Array.isArray(t))
      .map((t) => {
        const r = { id: num(t[0]), x: num(t[1]), y: num(t[2]), vx: num(t[3]), vy: num(t[4]), r: num(t[5], 20), spin: num(t[0]) % 3 } as MissionState['rocks'][number];
        if (typeof t[6] === 'number') r.hp = t[6];
        if (typeof t[7] === 'string') r.tag = t[7];
        return r;
      });
  }
  if (Array.isArray(snap.a)) {
    for (const t of snap.a) {
      if (!Array.isArray(t)) continue;
      const a = m.allies.find((x) => x.id === t[0]);
      if (!a) continue;
      a.x = num(t[1], a.x);
      a.y = num(t[2], a.y);
      a.hp = num(t[3], a.hp);
      a.destroyed = t[4] === 1;
      a.arrived = t[5] === 1;
      a.pathIdx = num(t[6], a.pathIdx);
      a.hitFlash = num(t[7]);
    }
  }
  const o = snap.o;
  if (o && typeof o === 'object') {
    if (Array.isArray(o.c)) m.cores.forEach((c, i) => (c.taken = o.c.includes(i)));
    if (Array.isArray(o.g)) m.gates.forEach((g, i) => (g.passed = o.g.includes(i)));
    if (Array.isArray(o.re))
      m.reactors.forEach((r, i) => {
        const t = o.re[i];
        if (Array.isArray(t)) {
          r.charge = num(t[0]);
          r.active = t[1] === 1;
        }
      });
    if (Array.isArray(o.sw))
      m.switches.forEach((w, i) => {
        const t = o.sw[i];
        if (!Array.isArray(t)) return;
        w.charge = num(t[0]);
        if (t[1] === 1 && !w.active) {
          w.active = true;
          m.walls = m.walls.filter((x) => x !== w.door); // the blast door opened on the host
        }
      });
  }
  if (snap.rest && typeof snap.rest === 'object') {
    const target = m as unknown as Record<string, unknown>;
    for (const k of REST_KEYS) if (k in snap.rest) target[k] = (snap.rest as Record<string, unknown>)[k];
  }
}
