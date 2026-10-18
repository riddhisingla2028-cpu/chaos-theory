// Mission simulation for the spacecraft campaign. Pure and deterministic (seeded RNG, no DOM),
// so every objective, failure and power-up rule is unit tested. Rendering lives in render.ts.
//
// World units: worlds are 1000 wide (some much taller); the camera shows a 720 x 720 window and
// follows the ship in both directions. Time: `step` takes real seconds. The ship always moves in real time; the rest
// of the world moves in "world time", which runs slower during CHRONO SHIFT.
//
// Enemies come only from scripted encounters (encounters.ts): each mission lists them, and its phases
// name the ones that must be cleared before the operation can move on.

import { blockingEncounters, contactView, encounterProgress, encounterState, initEncounters, startWaitingFight, updateEncounters, type ContactView, type EncounterDef, type EncounterHooks, type EncounterState, type Entry } from './encounters';

export type MissionId =
  | 'first-contact'
  | 'alien-pursuit'
  | 'rescue'
  | 'shattered-orbit'
  | 'collapse'
  | 'meltdown'
  | 'breach-protocol'
  | 'convoy'
  | 'last-jump'
  | 'guardian';

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A solid neon structure. Blocks the ship; does no damage. Can slide back and forth. */
export interface Wall extends Rect {
  move?: { dx: number; dy: number; period: number; phase: number };
}

/** An energy barrier between two points: harmless while off, damaging while on, flickers before switching on. */
export interface Barrier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  period: number;
  on: number; // seconds on per period
  offset: number;
}

export interface Rock {
  id: number;
  hp?: number; // destructible debris (The Rescue): the blaster can break it
  grazed?: boolean; // a near miss was already counted for this rock
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  spin: number;
  tag?: string; // spawned for an objective
}

// generator: a stationary shield generator (the Guardian's shield holds while any is up).
// hive: a stationary alien carrier that launches raiders. commander: a command raider that directs
// the attack and tries to escape off the map.
export type DroneKind = 'scout' | 'gunner' | 'raider' | 'turret' | 'generator' | 'hive' | 'commander';

/** Kinds that hold position (they never fly, and they do not hold up the next wave). */
export const STATIONARY: readonly DroneKind[] = ['turret', 'generator', 'hive'];

/** Friendly ships the player must protect. Enemies attack them; losing them fails the mission. */
export type AllyKind = 'transport' | 'cargo' | 'frigate' | 'capital';

export interface Ally {
  id: number;
  kind: AllyKind;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  r: number; // collision radius for incoming fire (matches the drawn hull)
  path: Vec[]; // waypoints it flies along (empty = holds position)
  pathIdx: number;
  speed: number;
  arrived: boolean;
  destroyed: boolean;
  hitFlash: number;
}

/** Escape pods for The Rescue: touch one to tow it, bring it into the rescue zone to save it. */
export interface Pod {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: 'drifting' | 'towed' | 'saved';
  found: boolean; // located by the ship's scanner (The Rescue)
  towedBy?: number; // co-op: the slot of the pilot whose tractor beam holds it
  heavy?: boolean; // co-op data core: its carrier flies at HEAVY_TOW speed and cannot fire
}

export type PowerKind = 'shield' | 'overdrive' | 'repair';

export interface Drone {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  fireIn: number; // world seconds until the next shot
  aim: number; // > 0 while telegraphing a shot (world seconds left)
  hitFlash: number;
  spawnIn: number; // > 0 while warping in (cannot hurt or be hurt)
  targetAlly: number | null; // raiders and some gunners go for a friendly ship instead of the player
  tag?: string; // spawned for an objective (counted by that objective)
  gone?: boolean; // left the battlefield (escaped): removed without an explosion or a kill
  enc?: string; // the encounter that sent it
  lastHitBy?: number; // co-op: slot of the pilot whose bolt last hit it (credited with the kill)
  lastHitAt?: number; // world time of the last hit (for shield regeneration)
  regen?: number; // hull points regained per second once it has not been hit for REGEN_DELAY
  hunt?: 'carrier'; // goes for whoever is carrying the data core (co-op)
}

export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  from: 'player' | 'enemy';
  life: number;
  drive?: boolean; // a bomber's shot at the Meridian's drive core: a hit knocks the jump charge back
  owner?: number; // player bolts: slot of the pilot who fired it
}

/** A spacecraft's flight state. */
export interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  invuln: number;
  fireCd: number;
  thrust: number;
}

/** What each pilot did, for team results. */
export interface PilotStats {
  kills: number;
  shots: number;
  shotsHit: number;
  hitsTaken: number;
  downs: number;
  revives: number; // teammates this pilot brought back
  objectiveTime: number; // seconds spent working an objective (charging a switch or reactor, towing)
}

/**
 * One pilot's spacecraft. Solo missions have exactly one (it is also `MissionState.ship`); co-op has up
 * to MAX_PILOTS. A pilot whose hull runs out in co-op is downed, not killed: a teammate who stays close
 * revives them. Pilots who are offline (disconnected) are frozen and ignored by everything.
 */
export interface Pilot extends Ship {
  slot: number;
  downed: boolean;
  reviveCharge: number; // 0..1 while a teammate is reviving them
  online: boolean;
  aimTarget: number | null; // what is in this pilot's line of fire (see MissionState.target)
  stats: PilotStats;
}


export interface Pickup {
  id: number;
  x: number;
  y: number;
  taken: boolean;
}

export interface Gate {
  x: number;
  y: number;
  r: number;
  passed: boolean;
}

export interface Reactor {
  x: number;
  y: number;
  r: number;
  charge: number; // 0..1
  active: boolean;
}

/** An emergency switch: hold position on it to open its blast door (Orbital Collapse). */
export interface Switch {
  x: number;
  y: number;
  r: number;
  charge: number; // 0..1
  active: boolean;
  door: Wall; // removed from the world when the switch is thrown
  name: string;
}

/**
 * One step of an operation. Phases run in order; each must be completed by real gameplay state
 * (its `done` check), and completing the last one wins the mission.
 */
export interface Phase {
  id: string;
  title: string;
  /** Objective line and progress for the HUD. */
  view: (m: MissionState) => { text: string; progress: number; count: string | null };
  done: (m: MissionState) => boolean;
  /** Runs when the phase begins (spawns, comms). */
  enter?: (m: MissionState) => void;
  /** Runs when the phase is completed. */
  complete?: (m: MissionState) => void;
  /** Encounters that must be cleared before this phase can complete (it waits on them). */
  clear?: string[];
  /** Escorted ships stop at this waypoint index until this phase's encounters are cleared. */
  holdAllies?: number;
}

export interface Pulse {
  r: number; // current radius
  warn: number; // seconds of warning left before it expands
  gap: number; // angle of the safe gap in the ring (fixed for the pulse's life)
}

export interface Boss {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  phase: number; // 0, 1, 2
  shielded: boolean;
  cycle: number; // world seconds into the shield cycle
  attackIn: number;
  beam: { angle: number; warn: number; fire: number; sweep: number } | null;
  hitFlash: number;
  dying: number; // > 0 during the victory sequence
}

export interface ChronoPickup {
  x: number;
  y: number;
  life: number; // real seconds before it fades
}

export type MissionStatus = 'playing' | 'won' | 'lost';

export type MissionEvent =
  | { type: 'core'; x: number; y: number }
  | { type: 'gate'; x: number; y: number }
  | { type: 'reactor'; x: number; y: number }
  | { type: 'portal-open'; x: number; y: number }
  | { type: 'shoot'; x: number; y: number; angle: number }
  | { type: 'enemy-shoot'; x: number; y: number }
  | { type: 'hit'; x: number; y: number; slot?: number }
  | { type: 'near'; x: number; y: number; slot?: number }
  | { type: 'enemy-hit'; x: number; y: number }
  | { type: 'explode'; x: number; y: number; big: boolean }
  | { type: 'warn'; x: number; y: number }
  | { type: 'boss-phase'; phase: number }
  | { type: 'boss-vulnerable' }
  | { type: 'chrono-spawn'; x: number; y: number }
  | { type: 'chrono-on'; x: number; y: number }
  | { type: 'chrono-off'; x: number; y: number }
  | { type: 'ally-hit'; x: number; y: number }
  | { type: 'ally-lost'; x: number; y: number; name: string }
  | { type: 'pod-tow'; x: number; y: number }
  | { type: 'pod-saved'; x: number; y: number }
  | { type: 'power-spawn'; kind: PowerKind; x: number; y: number }
  | { type: 'power-on'; kind: PowerKind; x: number; y: number }
  | { type: 'shield-block'; x: number; y: number; slot?: number }
  | { type: 'combo'; count: number; mult: number; x: number; y: number }
  | { type: 'jump'; x: number; y: number }
  | { type: 'escape' }
  | { type: 'comms'; text: string; alert: boolean }
  | { type: 'objective'; done: string; next: string | null }
  | { type: 'switch'; x: number; y: number }
  | { type: 'deflect'; x: number; y: number }
  | { type: 'incoming'; id: string; name: string; from: Entry; x: number; y: number }
  | { type: 'encounter-clear'; id: string; name: string }
  | { type: 'pilot-down'; slot: number; reason: string; x: number; y: number }
  | { type: 'pilot-revived'; slot: number; by: number; x: number; y: number }
  | { type: 'linked-reboot'; x: number; y: number }
  | { type: 'won' }
  | { type: 'lost'; reason: string };

export interface Secondary {
  id: string;
  text: string;
}

/** Co-op operations (2-4 pilots). Kept apart from the solo campaign and its saved records. */
export type CoopMissionId = 'twin-lock';

export type AnyMissionId = MissionId | CoopMissionId;

/** A mission. Solo campaign definitions have MissionId ids; co-op operations have CoopMissionId ids. */
export interface MissionDef<Id extends AnyMissionId = MissionId> {
  id: Id;
  index: number;
  code: string; // "01"
  name: string;
  tagline: string;
  briefing: string;
  objective: string; // primary objective, one line
  secondaries: [Secondary, Secondary];
  world: { w: number; h: number };
  maxHp: number;
  weapons: boolean;
  timeLimit: number | null; // world seconds; failing to finish in time loses the mission
  accent: [number, number, number];
  build: (m: MissionState, rnd: () => number) => void;
  /** The operation, in order. Completing the last phase wins. */
  phases: Phase[];
  /** Scripted enemy encounters. The only source of enemies besides objective structures. */
  encounters?: EncounterDef[];
  /** A deliberate survival mode: the only kind of mission allowed endless ambient enemies. */
  arcade?: boolean;
  /** Co-op operations: how many pilots it is built for. */
  coop?: { min: number; max: number };
}

export interface MissionState {
  def: MissionDef<AnyMissionId>;
  seed: number;
  rng: () => number;
  status: MissionStatus;
  failReason: string | null;
  realTime: number;
  time: number; // world time
  /** The first pilot (the only one in solo). Same object as ships[0]. */
  ship: Pilot;
  /** Every pilot in the mission, by slot. */
  ships: Pilot[];
  camX: number; // left of the visible VIEW x VIEW window
  camY: number; // top of the visible window
  walls: Wall[];
  barriers: Barrier[];
  rocks: Rock[];
  rockSpawn: { every: number; next: number; speed: number; fromTop: boolean } | null;
  drones: Drone[];
  encounters: EncounterState[]; // runtime state of def.encounters, in the same order
  bullets: Bullet[];
  cores: Pickup[];
  coresNeeded: number;
  gates: Gate[];
  reactors: Reactor[];
  pulses: Pulse[];
  pulseEvery: number;
  pulseNext: number;
  portal: { x: number; y: number; r: number; open: boolean } | null;
  collapseY: number | null; // world y; everything below has collapsed
  collapseSpeed: number;
  boss: Boss | null;
  chrono: { active: number; pickup: ChronoPickup | null; nextSpawn: number; used: number };
  power: { pickup: { kind: PowerKind; x: number; y: number; life: number } | null; nextSpawn: number; shield: boolean; overdrive: number };
  combo: { count: number; timer: number; best: number };
  nearMisses: number;
  turretsKilled: number;
  cleared: number; // attackers removed by any means (shot down, or crashed into a friendly ship)
  allies: Ally[];
  alliesNeeded: number; // how many friendly ships must survive (escort/defence missions)
  pods: Pod[];
  rescueZone: { x: number; y: number; r: number } | null;
  jump: { charge: number; duration: number } | null; // The Last Jump
  gravity: { x: number; y: number; reach: number; pull: number; horizon: number } | null; // Singularity
  escaping: boolean; // Singularity: the boss is down, now get out
  kills: number;
  killsNeeded: number;
  hitsTaken: number;
  score: number;
  /** What is in the blaster's line of fire right now (drone id, -1 boss, -2 - rock id), or null. */
  target: number | null;
  phase: number; // index into def.phases
  phaseTime: number; // world seconds since the current phase began
  phasesDone: string[]; // titles of completed phases, in order (debrief)
  switches: Switch[];
  stability: number | null; // Reactor Meltdown: 0..100; at 0 the core goes critical
  /** Co-op uplinks: pads that charge only while every one of them is held at the same moment. */
  uplink: { pads: { x: number; y: number; r: number }[]; charge: number; active: boolean } | null;
  /**
   * Co-op synchronised strike: targets (tagged `tag`) that must all fall within `window` real seconds of
   * the first. If the window closes with any still up, the fallen ones reboot. Their shields only drop
   * for a ship within `range`: bolts fired from further away are deflected, so each needs a pilot beside it.
   */
  linked: { tag: string; kind: DroneKind; spots: Vec[]; hp: number; regen: number; window: number; range: number; firstAt: number | null; done: boolean } | null;
  /** Mission-specific state (ids of spawned objective targets, one-time alerts, outcomes). */
  flags: Record<string, number>;
  events: MissionEvent[];
  nextId: number;
}

// ---------- Tuning ----------

export const VIEW = 720; // visible window, world units
export const SHIP_R = 13; // collision radius: matches the drawn hull's core
const SHIP_SPEED = 400;
const SHIP_RESPONSE = 12;
const INVULN = 1.2;
const FIRE_EVERY = 0.16;
export const FIRE_RANGE = 620; // a bolt's travel before it expires
export const BOLT_SPEED = 1100;
export const BOLT_R = 5;
export const ASSIST_CONE = 0.14; // radians (about 8 degrees) either side of the nose
/** Distance from the ship's centre to the blaster muzzle at the nose (matches the drawn hulls, 22..30). */
export const MUZZLE = 30;
/** Hit radii for player bolts (match the drawn silhouettes). */
export const HIT_R: Record<DroneKind, number> = { scout: 18, gunner: 22, raider: 18, turret: 24, generator: 22, hive: 46, commander: 24 };
const ENEMY_BOLT_SPEED = 260;
const AIM_TIME = 0.6; // drones glow before firing
export const CHRONO_DURATION = 4; // real seconds
export const CHRONO_SCALE = 0.3; // world speed during CHRONO SHIFT
const CHRONO_FIRST = 9; // world seconds before the first pickup can appear
const CHRONO_EVERY = 24; // world seconds between pickups (if not collected)
const CHRONO_LIFE = 9; // real seconds a pickup waits before fading
const REACTOR_TIME = 2.2; // seconds inside a reactor ring to activate it
const POWER_FIRST = 14; // world seconds before the first shield/overdrive/repair pickup
const POWER_EVERY = 19;
const POWER_LIFE = 9;
export const OVERDRIVE_TIME = 6; // real seconds of doubled fire rate
const COMBO_WINDOW = 2.5; // seconds between kills to keep a chain going
export const TOW_MAX = 2; // escape pods the tractor beam can hold at once
export const HEAVY_TOW = 0.45; // co-op: a pilot carrying the data core flies at this fraction of full speed
export const UPLINK_TIME = 12; // co-op: seconds both uplinks must be held together
export const REGEN_DELAY = 1.5; // seconds without a hit before a regenerating shield starts to recover

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- Geometry ----------

export function wallAt(w: Wall, t: number): Rect {
  if (!w.move) return w;
  const k = (Math.sin(((t + w.move.phase) / w.move.period) * Math.PI * 2) + 1) / 2;
  return { x: w.x + w.move.dx * k, y: w.y + w.move.dy * k, w: w.w, h: w.h };
}

export type BarrierState = 'off' | 'warning' | 'on';
const BARRIER_WARN = 0.8;

export function barrierState(b: Barrier, t: number): BarrierState {
  const k = (((t + b.offset) % b.period) + b.period) % b.period;
  if (k < b.on) return 'on';
  if (k > b.period - BARRIER_WARN) return 'warning';
  return 'off';
}

function segDist(p: Vec, b: Barrier): number {
  const dx = b.x2 - b.x1;
  const dy = b.y2 - b.y1;
  const len2 = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((p.x - b.x1) * dx + (p.y - b.y1) * dy) / len2));
  return Math.hypot(p.x - (b.x1 + dx * k), p.y - (b.y1 + dy * k));
}

/** Push a circle out of every wall and keep it inside the world. */
function resolve(m: MissionState, p: { x: number; y: number; vx?: number; vy?: number }, r: number): boolean {
  let touched = false;
  for (let pass = 0; pass < 2; pass++) {
    p.x = Math.min(m.def.world.w - r, Math.max(r, p.x));
    p.y = Math.min(m.def.world.h - r, Math.max(r, p.y));
    for (const w0 of m.walls) {
      const w = wallAt(w0, m.time);
      const cx = Math.max(w.x, Math.min(p.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= r) continue;
      touched = true;
      if (d > 0.0001) {
        p.x = cx + (dx / d) * r;
        p.y = cy + (dy / d) * r;
      } else {
        const opts = [
          [p.x - w.x, w.x - r, p.y],
          [w.x + w.w - p.x, w.x + w.w + r, p.y],
        ];
        const vert = [
          [p.y - w.y, p.x, w.y - r],
          [w.y + w.h - p.y, p.x, w.y + w.h + r],
        ];
        const best = [...opts.map((o) => ({ d: o[0], x: o[1], y: o[2] })), ...vert.map((o) => ({ d: o[0], x: o[1], y: o[2] }))].sort((a, b) => a.d - b.d)[0];
        p.x = best.x;
        p.y = best.y;
      }
    }
  }
  return touched;
}

function insideWall(m: MissionState, x: number, y: number, pad: number): boolean {
  return m.walls.some((w0) => {
    const w = wallAt(w0, m.time);
    return x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad;
  });
}

/** A fair spot: inside the world, clear of walls, barriers, debris and enemies, and in front of the collapse. */
function fairSpot(m: MissionState, rnd: () => number, near: Vec, minD: number, maxD: number): Vec | null {
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2;
    const d = minD + rnd() * (maxD - minD);
    const p = { x: near.x + Math.cos(a) * d, y: near.y + Math.sin(a) * d };
    if (p.x < Math.max(70, m.camX + 60) || p.x > Math.min(m.def.world.w - 70, m.camX + VIEW - 60)) continue;
    if (p.y < Math.max(70, m.camY + 60) || p.y > Math.min(m.def.world.h - 70, m.camY + VIEW - 60)) continue;
    if (insideWall(m, p.x, p.y, 50)) continue;
    if (m.barriers.some((b) => segDist(p, b) < 60)) continue;
    if (m.rocks.some((r) => dist(r, p) < r.r + 110)) continue;
    if (m.drones.some((dr) => dist(dr, p) < 140)) continue;
    if (m.collapseY !== null && p.y > m.collapseY - 260) continue;
    if (m.boss && dist(m.boss, p) < 220) continue;
    return p;
  }
  return null;
}

// ---------- Mission definitions ----------

const W = 1000; // world width

const rockAt = (m: MissionState, x: number, y: number, vx: number, vy: number, r: number): Rock => ({ id: m.nextId++, x, y, vx, vy, r, spin: (x * 7 + y) % 3 });

function ally(m: MissionState, kind: AllyKind, name: string, x: number, y: number, hp: number, r: number, path: Vec[], speed: number): Ally {
  return { id: m.nextId++, kind, name, x, y, hp, maxHp: hp, r, path, pathIdx: 0, speed, arrived: path.length === 0, destroyed: false, hitFlash: 0 };
}


// ---------- Operations: each mission is a sequence of phases ----------

/** A radio message from command, triggered by something that just happened in the mission. */
function comms(m: MissionState, text: string, alert = false): void {
  m.events.push({ type: 'comms', text, alert });
}

const tagged = (m: MissionState, tag: string) => m.drones.filter((d) => d.tag === tag && d.hp > 0);
/**
 * The whole squadron is inside a zone: solo, the ship; co-op, every online pilot, standing (a downed
 * teammate must be revived first: nobody is left behind).
 */
const squadIn = (m: MissionState, zone: Vec, r: number) => {
  const online = m.ships.filter((p) => p.online);
  return online.length > 0 && online.every((p) => !p.downed && dist(p, zone) < r);
};
const inPortal = (m: MissionState) => !!m.portal?.open && squadIn(m, m.portal, m.portal.r - 6);
const pct = (k: number) => `${Math.round(Math.max(0, Math.min(1, k)) * 100)}%`;
const living = (m: MissionState) => m.allies.filter((a) => !a.destroyed);
/** How far the slowest surviving escorted ship has got along its route (0..1). */
const convoyProgress = (m: MissionState) => {
  const l = living(m);
  return l.length ? Math.min(...l.map((a) => (a.arrived ? 1 : a.path.length ? a.pathIdx / a.path.length : 1))) : 0;
};
/** The escorted ship furthest along (the lead of a convoy), or the player if none is left. */
const leadShip = (m: MissionState): Vec => {
  const l = living(m);
  return l.length ? l.reduce((a, b) => (b.y < a.y ? b : a), l[0]) : m.ship;
};
/** The middle of the escorted group. */
const convoyMid = (m: MissionState): Vec => {
  const l = living(m);
  return l.length ? { x: l.reduce((k, a) => k + a.x, 0) / l.length, y: l.reduce((k, a) => k + a.y, 0) / l.length } : m.ship;
};
const offset = (f: (m: MissionState) => Vec, dx: number, dy: number) => (m: MissionState): Vec => {
  const p = f(m);
  return { x: p.x + dx, y: p.y + dy };
};
/** Destroyed out of total for an encounter, as an objective counter. */
const encCount = (m: MissionState, id: string, fallback: number) => {
  const p = encounterProgress(m, id);
  const total = p.total || fallback;
  return { done: Math.max(0, Math.min(total, p.done)), total };
};

/**
 * Place objective structures (the Guardian's shield generators), counted down by tag. These are part of
 * the boss mechanic, not enemies sent at the player: every other enemy comes from an encounter.
 */
function spawnTagged(m: MissionState, tag: string, kind: DroneKind, spots: Vec[]): void {
  for (const p of spots) {
    const d = spawnDrone(m, kind, Math.max(40, Math.min(m.def.world.w - 40, p.x)), Math.max(40, Math.min(m.def.world.h - 40, p.y)));
    d.tag = tag;
  }
  m.flags[`${tag}Total`] = spots.length;
}
const killedOf = (m: MissionState, tag: string) => (m.flags[`${tag}Total`] ?? 0) - tagged(m, tag).length;

const extractPhase = (title: string, text: string): Phase => ({
  id: 'extract',
  title,
  view: () => ({ text, progress: 1, count: null }),
  done: inPortal,
});

const P_FIRST_CONTACT: Phase[] = [
  {
    id: 'cores',
    title: 'Recover the fuel cores',
    view: (m) => {
      const got = m.cores.filter((c) => c.taken).length;
      return { text: 'Recover the fuel cores', progress: got / m.coresNeeded, count: `${got}/${m.coresNeeded}` };
    },
    done: (m) => m.cores.filter((c) => c.taken).length >= m.coresNeeded,
  },
  {
    id: 'lane',
    title: 'Clear the extraction lane',
    enter: (m) => {
      for (const [x, y] of [
        [430, 200],
        [500, 260],
        [570, 200],
      ])
        m.rocks.push({ ...rockAt(m, x, y, 0, 0, 30), hp: 4, tag: 'blocker' });
      comms(m, 'Tanks full. Extraction lane is blocked by debris: line up and break it with your blaster.', true);
    },
    view: (m) => {
      const left = m.rocks.filter((r) => r.tag === 'blocker').length;
      return { text: 'Blast the debris blocking extraction', progress: (3 - left) / 3, count: `${3 - left}/3` };
    },
    done: (m) => !m.rocks.some((r) => r.tag === 'blocker'),
    complete: (m) => {
      openPortal(m);
      comms(m, 'Lane clear. Extraction portal is powering up.');
    },
  },
  extractPhase('Reach extraction', 'Fly into the extraction portal'),
];

const P_SHATTERED: Phase[] = [
  {
    id: 'gates',
    title: 'Pass the navigation gates',
    view: (m) => {
      const n = m.gates.filter((g) => g.passed).length;
      return { text: 'Fly through the navigation gates in order', progress: n / m.gates.length, count: `${n}/${m.gates.length}` };
    },
    done: (m) => m.gates.every((g) => g.passed),
    complete: (m) => comms(m, 'All gates passed. Exit portal is open.'),
  },
  extractPhase('Reach the exit portal', 'Reach the exit portal'),
];

const P_SWARM: Phase[] = [
  {
    id: 'hold',
    title: 'Hold the line',
    view: (m) => {
      const c = encCount(m, 'swarm', 7);
      return { text: 'Hold the line around the Aegis', progress: c.done / c.total, count: `${c.done}/${c.total}` };
    },
    done: () => true,
    clear: ['swarm'],
  },
  {
    id: 'hive',
    title: 'Destroy the hive carrier',
    enter: (m) => {
      m.flags.hiveNext = 2.5;
    },
    view: (m) => {
      const h = tagged(m, 'hive')[0];
      if (!h && !(encounterState(m, 'hive')?.spawned ?? 0)) return { text: 'Hive carrier inbound', progress: 0, count: null };
      return { text: 'Destroy the hive carrier', progress: h ? 1 - h.hp / h.maxHp : 1, count: h ? `${h.hp}/${h.maxHp}` : null };
    },
    // Done once the hive has actually arrived and been destroyed (not in the moment before it warps in).
    done: (m) => (encounterState(m, 'hive')?.spawned ?? 0) > 0 && tagged(m, 'hive').length === 0,
    complete: (m) => comms(m, 'Hive carrier destroyed. Mop up the survivors.'),
  },
  {
    id: 'mop',
    title: 'Clear the remaining attackers',
    view: (m) => ({ text: 'Clear the remaining attackers', progress: m.drones.length ? 0.5 : 1, count: `${m.drones.length} left` }),
    done: () => true,
    clear: ['swarm', 'hive'],
  },
];

const P_COLLAPSE: Phase[] = [
  {
    id: 'door-a',
    title: 'Open blast door A',
    enter: (m) => comms(m, 'Blast doors are sealed ahead. Hold on each emergency switch to open them.', true),
    view: (m) => ({ text: 'Hold on the emergency switch · blast door A', progress: m.switches[0].charge, count: null }),
    done: (m) => m.switches[0].active,
  },
  {
    id: 'door-b',
    title: 'Open blast door B',
    view: (m) => ({ text: 'Hold on the emergency switch · blast door B', progress: m.switches[1].charge, count: null }),
    done: (m) => m.switches[1].active,
  },
  extractPhase('Reach the escape portal', 'Escape north to the portal'),
];

const P_MELTDOWN: Phase[] = [
  {
    id: 'reactors',
    title: 'Stabilise the reactors',
    view: (m) => {
      const n = m.reactors.filter((r) => r.active).length;
      return { text: 'Stabilise the reactors', progress: n / m.reactors.length, count: `${n}/${m.reactors.length}` };
    },
    done: (m) => m.reactors.every((r) => r.active),
    complete: (m) => comms(m, 'Core stable for now. Evacuation portal open: get out!'),
  },
  extractPhase('Evacuate', 'Evacuate through the portal'),
];

const P_GUARDIAN: Phase[] = [
  {
    id: 'guardian',
    title: 'Destroy the Guardian',
    view: (m) => {
      const b = m.boss!;
      if (b.shielded) {
        const k = killedOf(m, 'generator');
        const n = m.flags.generatorTotal ?? 0;
        return { text: 'Destroy the shield generators', progress: n ? k / n : 0, count: `${k}/${n}` };
      }
      return { text: 'Shield down: hit the core!', progress: 1 - b.hp / b.maxHp, count: `${Math.max(0, b.hp)}/${b.maxHp}` };
    },
    done: (m) => m.escaping,
  },
  extractPhase('Escape the singularity', 'ESCAPE! Fly south to the portal'),
];

const P_PURSUIT: Phase[] = [
  {
    id: 'escort',
    title: 'Escort the Kestrel',
    view: (m) => ({ text: 'Escort the Kestrel north', progress: convoyProgress(m), count: pct(convoyProgress(m)) }),
    done: (m) => living(m).every((a) => a.pathIdx >= 2),
    clear: ['pursuers', 'flank'],
    holdAllies: 2,
  },
  {
    id: 'commander',
    title: 'Intercept the command raider',
    enter: (m) => {
      m.flags.cmdEscapeAt = m.time + 22;
    },
    view: (m) => {
      const c = tagged(m, 'commander')[0];
      const sent = (encounterState(m, 'commander')?.spawned ?? 0) > 0;
      return { text: c ? 'Destroy the command raider' : sent ? 'Command raider gone' : 'Command raider inbound', progress: c ? 1 - c.hp / c.maxHp : sent ? 1 : 0, count: c ? `${c.hp}/${c.maxHp}` : null };
    },
    done: () => true,
    clear: ['commander'],
    holdAllies: 4, // the Kestrel will not make for the gate while the commander is out there
    complete: (m) => {
      // The outcome changes what comes next: an escaped commander calls in a reprisal raid (encounter 'reprisal').
      if (m.flags.cmdKilled) comms(m, 'Command raider down. The raids are breaking up.');
      else comms(m, 'The command raider escaped. Expect a reprisal raid.', true);
    },
  },
  {
    id: 'gate',
    title: 'Reach the jump gate',
    view: (m) => ({ text: 'Get the Kestrel through the jump gate', progress: convoyProgress(m), count: pct(convoyProgress(m)) }),
    done: (m) => living(m).length >= m.alliesNeeded && living(m).every((a) => a.arrived),
    clear: ['last-stand'],
    holdAllies: 4,
    complete: escortArrived,
  },
];

const P_RESCUE: Phase[] = [
  {
    id: 'recover',
    title: 'Recover the first survivors',
    enter: (m) => comms(m, 'Distress beacons are weak. Sweep the belt: your scanner locates pods within range.'),
    view: (m) => rescueView(m),
    done: (m) => m.pods.filter((p) => p.state === 'saved').length >= 3,
  },
  {
    id: 'secure',
    title: 'Secure the rescue area',
    enter: (m) => {
      m.flags.bayLocked = 1;
    },
    view: (m) => {
      const c = encCount(m, 'boarders', 3);
      return { text: 'Secure the rescue area · bay sealed', progress: c.done / c.total, count: `${c.done}/${c.total}` };
    },
    done: () => true,
    clear: ['boarders'],
    complete: (m) => {
      m.flags.bayLocked = 0;
      comms(m, 'Rescue area secure. Bay doors open.');
    },
  },
  {
    id: 'recover-rest',
    title: 'Recover the remaining survivors',
    view: (m) => rescueView(m),
    done: (m) => m.pods.every((p) => p.state === 'saved'),
    complete: (m) => comms(m, 'All survivors aboard. Dock with the rescue ship.'),
  },
  {
    id: 'dock',
    title: 'Dock with the rescue ship',
    view: () => ({ text: 'Dock with the rescue ship', progress: 1, count: null }),
    done: (m) => !!m.rescueZone && squadIn(m, m.rescueZone, m.rescueZone.r),
  },
];

function rescueView(m: MissionState) {
  const saved = m.pods.filter((p) => p.state === 'saved').length;
  const towing = m.pods.some((p) => p.state === 'towed');
  return { text: towing ? 'Tow the pods into the rescue bay' : 'Locate and recover escape pods', progress: saved / m.pods.length, count: `${saved * 8}/${m.pods.length * 8} survivors` };
}

const P_CONVOY: Phase[] = [
  {
    id: 'escort',
    title: 'Escort the convoy to the checkpoint',
    view: (m) => ({ text: `Escort the convoy · ${living(m).length}/${m.allies.length} ships`, progress: convoyProgress(m), count: pct(convoyProgress(m)) }),
    done: (m) => living(m).every((a) => a.pathIdx >= 2),
    clear: ['raid-1', 'raid-2'],
    holdAllies: 2,
  },
  {
    id: 'ambush',
    title: 'Break the ambush',
    view: (m) => {
      const c = encCount(m, 'ambush', 3);
      return { text: 'Break the ambush', progress: c.done / c.total, count: `${c.done}/${c.total}` };
    },
    done: () => true,
    clear: ['ambush'],
    holdAllies: 2, // the convoy halts until the ambush is broken
    complete: (m) => comms(m, 'Ambush broken. Get the haulers to the relay.'),
  },
  {
    id: 'deliver',
    title: 'Deliver the convoy',
    view: (m) => ({ text: `Deliver the haulers to the relay · ${living(m).length}/${m.allies.length}`, progress: convoyProgress(m), count: pct(convoyProgress(m)) }),
    done: (m) => living(m).length >= m.alliesNeeded && living(m).every((a) => a.arrived),
    clear: ['final-raid'],
    holdAllies: 3,
    complete: escortArrived,
  },
];

const P_LAST_JUMP: Phase[] = [
  {
    id: 'hold',
    title: 'Hold the line',
    view: (m) => ({ text: 'Protect the Meridian · jump drive charging', progress: m.jump!.charge / m.jump!.duration, count: pct(m.jump!.charge / m.jump!.duration) }),
    done: (m) => m.jump!.charge >= m.jump!.duration / 2,
    clear: ['probe', 'pincer', 'gunline', 'crossfire'],
  },
  {
    id: 'bombers',
    title: 'Destroy the bomber wing',
    view: (m) => {
      const c = encCount(m, 'bombers', 3);
      return { text: 'Destroy the bomber wing', progress: c.done / c.total, count: `${c.done}/${c.total}` };
    },
    done: () => true,
    clear: ['bombers'],
  },
  {
    id: 'jump',
    title: 'Protect the Meridian until the jump',
    view: (m) => ({ text: 'Protect the Meridian until it jumps', progress: m.jump!.charge / m.jump!.duration, count: pct(m.jump!.charge / m.jump!.duration) }),
    done: (m) => m.jump!.charge >= m.jump!.duration,
    clear: ['breach', 'final-push'],
    complete: (m) => {
      for (const a of living(m)) m.score += Math.round(800 * (a.hp / a.maxHp));
      const cap = living(m)[0];
      m.events.push({ type: 'jump', x: cap?.x ?? 500, y: cap?.y ?? 500 });
    },
  },
];

// ---------- Encounters: every enemy a mission sends, where it comes from, and when ----------

const pt = (kind: DroneKind, x: number, y: number, from: Entry = 'here') => ({ kind, count: 1, at: { x, y }, from });

const E_SWARM: EncounterDef[] = [
  {
    id: 'swarm',
    name: 'Swarm vanguard',
    trigger: { on: 'start', delay: 1 },
    warn: 1.5,
    callout: 'Swarm contacts closing from the north!',
    waves: [
      { groups: [pt('scout', 200, 180, 'north'), pt('raider', 500, 120, 'north'), pt('scout', 800, 180, 'north')] },
      { delay: 1, callout: 'Second wave: gunships on both flanks!', groups: [pt('gunner', 160, 300, 'west'), pt('gunner', 840, 300, 'east'), pt('raider', 120, 120, 'west'), pt('raider', 880, 120, 'east')] },
      { delay: 2.5, callout: 'They are surrounding the Aegis! Contacts on every side!', groups: [{ kind: 'raider', count: 5, formation: 'ring', spacing: 380, at: { x: 500, y: 600 }, target: 'ally' }] },
    ],
  },
  {
    id: 'hive',
    name: 'Hive carrier',
    tag: 'hive',
    trigger: { on: 'phase', phase: 'hive' },
    warn: 1.5,
    callout: 'Contact! A hive carrier is launching the swarm. Destroy it before it overwhelms the Aegis!',
    waves: [{ groups: [pt('hive', 500, 320)] }],
  },
];

/** An encounter is done (or was never scripted, as in stripped-down tests). */
const encDone = (m: MissionState, id: string) => {
  const st = encounterState(m, id);
  return !st || st.status === 'cleared' || st.status === 'cancelled';
};
const kestrelAt = (m: MissionState, idx: number) => living(m).some((a) => a.pathIdx >= idx);
const commanderAt = (m: MissionState): Vec => tagged(m, 'commander')[0] ?? { x: leadShip(m).x > 500 ? 120 : 880, y: m.camY + 90 };

// Alien Pursuit: a running escort. Each leg of the route has its own fight, one at a time: raiders chase
// from behind, gunships cut in from the flank, the command raider makes the player choose between
// hunting it and guarding the Kestrel, and a blockade waits at the gate.
const E_PURSUIT: EncounterDef[] = [
  {
    id: 'pursuers',
    name: 'Pursuit wing',
    trigger: { on: 'start', delay: 3 },
    warn: 2,
    callout: 'Raiders closing on the Kestrel from the south!',
    waves: [
      { groups: [{ kind: 'raider', count: 3, formation: 'vee', from: 'south', at: offset(leadShip, 0, 220), target: 'ally' }] },
      { delay: 2.5, callout: 'Hunters coming for you from the west!', groups: [{ kind: 'scout', count: 2, formation: 'line', from: 'west', at: (m) => m.ship }] },
    ],
  },
  {
    // Only once the pursuers are beaten and the Kestrel is under way again: one fight at a time.
    id: 'flank',
    name: 'Gunship flight',
    trigger: { on: 'when', test: (m) => encDone(m, 'pursuers') && kestrelAt(m, 1) },
    warn: 2,
    callout: 'Gunships cutting in from the east, raiders ahead!',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, formation: 'line', from: 'east', at: offset(leadShip, 160, -140), target: 'ally' },
          { kind: 'raider', count: 2, formation: 'vee', from: 'north', at: offset(leadShip, 0, -300), target: 'ally' },
        ],
      },
    ],
  },
  {
    id: 'commander',
    name: 'Command raider',
    tag: 'commander',
    trigger: { on: 'phase', phase: 'commander' },
    callout: 'Command raider detected, directing the raids. Take it down before it escapes!',
    waves: [{ groups: [{ kind: 'commander', count: 1, target: 'ally', at: commanderAt }] }],
  },
  {
    // Arrives with the commander and goes for the Kestrel: chase the commander, or guard the transport?
    id: 'screen',
    name: 'Raider screen',
    trigger: { on: 'phase', phase: 'commander', delay: 0.5 },
    warn: 1.5,
    until: 'commander',
    callout: 'Its raiders are diving on the Kestrel!',
    waves: [{ groups: [{ kind: 'raider', count: 3, formation: 'vee', from: 'south', at: offset(leadShip, 0, 200), target: 'ally' }] }],
  },
  {
    id: 'reprisal',
    name: 'Reprisal raid',
    trigger: { on: 'flag', flag: 'cmdEscaped', delay: 3 },
    warn: 2,
    callout: 'Reprisal raid inbound from the north!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 3, formation: 'vee', from: 'north', at: offset(leadShip, 0, -260), target: 'ally' },
          { kind: 'gunner', count: 2, formation: 'line', from: 'west', at: offset(leadShip, -160, 0) },
        ],
      },
    ],
  },
  {
    // The gate is blockaded: gunships hold position in front of it while raiders close the trap from behind.
    id: 'last-stand',
    name: 'Gate blockade',
    trigger: { on: 'when', test: (m) => m.phase >= 2 && kestrelAt(m, 4) },
    warn: 2,
    callout: 'Blockade at the jump gate! Gunships ahead, raiders behind. Clear it so the Kestrel can make the run.',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, formation: 'line', spacing: 240, from: 'north', at: { x: 500, y: 420 }, target: 'ally' },
          { kind: 'raider', count: 2, formation: 'line', from: 'south', at: offset(leadShip, 0, 260), target: 'ally' },
        ],
      },
    ],
  },
  {
    // Lone raiders keep picking at the Kestrel between the set fights (they go for the transport, not you).
    id: 'stragglers',
    name: 'Stragglers',
    trigger: { on: 'start', delay: 12 },
    until: 'gate',
    ambient: { budget: 7, every: 6, maxAlive: 1, kinds: ['raider'] },
  },
];

const E_RESCUE: EncounterDef[] = [
  {
    id: 'patrol',
    name: 'Raider patrol',
    trigger: { on: 'start', delay: 1.5 },
    warn: 1.5,
    waves: [{ groups: [pt('scout', 160, 500, 'west'), pt('scout', 840, 260, 'east')] }],
  },
  {
    id: 'boarders',
    name: 'Boarding raiders',
    tag: 'boarders',
    trigger: { on: 'phase', phase: 'secure' },
    warn: 1.5,
    callout: 'Raiders closing on the rescue ship! The bay is sealed until they are destroyed.',
    waves: [{ groups: [pt('scout', 220, 1400, 'west'), pt('scout', 780, 1400, 'east'), pt('scout', 500, 1240, 'north')] }],
  },
];

const E_MELTDOWN: EncounterDef[] = [
  // The station's defences are in place from the start (no warning); they drain core stability while they live.
  { id: 'defences', name: 'Defence turrets', trigger: { on: 'start' }, waves: [{ groups: [pt('turret', 90, 620), pt('turret', 910, 620)] }] },
];

const E_CONVOY: EncounterDef[] = [
  {
    id: 'raid-1',
    name: 'Raider pack',
    trigger: { on: 'start', delay: 3 },
    warn: 2,
    callout: 'Raiders on the west flank!',
    waves: [
      { groups: [{ kind: 'raider', count: 3, formation: 'vee', from: 'west', at: convoyMid, target: 'ally' }] },
      {
        delay: 2,
        callout: 'More from the south and east!',
        groups: [
          { kind: 'scout', count: 2, formation: 'line', from: 'south', at: (m) => m.ship },
          { kind: 'raider', count: 2, formation: 'column', from: 'east', at: convoyMid, target: 'ally' },
        ],
      },
    ],
  },
  {
    id: 'raid-2',
    name: 'Gunship patrol',
    trigger: { on: 'when', test: (m) => encDone(m, 'raid-1') && living(m).some((a) => a.pathIdx >= 1) },
    warn: 2,
    callout: 'Gunships ahead of the convoy, raiders to the east!',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, formation: 'line', from: 'north', at: offset(leadShip, 0, -320), spacing: 200, target: 'ally' },
          { kind: 'raider', count: 3, formation: 'column', from: 'east', at: convoyMid, target: 'ally' },
        ],
      },
    ],
  },
  {
    id: 'ambush',
    name: 'Ambush',
    tag: 'ambush',
    trigger: { on: 'phase', phase: 'ambush' },
    warn: 1.5,
    callout: 'Ambush! Gunships ahead of the convoy. The haulers are holding until it is broken.',
    waves: [{ groups: [{ kind: 'gunner', count: 3, formation: 'line', spacing: 260, at: offset(leadShip, 0, -380), target: 'ally' }] }],
  },
  {
    id: 'ambush-flank',
    name: 'Flanking raiders',
    trigger: { on: 'phase', phase: 'ambush', delay: 3 },
    warn: 1.5,
    until: 'ambush',
    waves: [{ groups: [{ kind: 'raider', count: 2, formation: 'vee', from: 'west', at: convoyMid, target: 'ally' }] }],
  },
  {
    id: 'final-raid',
    name: 'Last raid',
    trigger: { on: 'when', test: (m) => living(m).some((a) => a.pathIdx >= 3) },
    warn: 2,
    callout: 'Last raid! Raiders on both flanks, a gunship from the north!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 2, formation: 'vee', from: 'west', at: convoyMid, target: 'ally' },
          { kind: 'raider', count: 2, formation: 'vee', from: 'east', at: convoyMid, target: 'ally' },
          { kind: 'gunner', count: 1, from: 'north', at: offset(leadShip, 0, -300), target: 'ally' },
        ],
      },
    ],
  },
  {
    // Stray raiders between the set fights, all the way to the relay (a fixed budget of six).
    id: 'raiders',
    name: 'Raiders',
    trigger: { on: 'start', delay: 8 },
    until: 'deliver',
    ambient: { budget: 6, every: 7.5, maxAlive: 2, kinds: ['raider', 'raider', 'scout'] },
  },
];

const MERIDIAN = { x: 500, y: 560 };
/** Seconds of jump charge the Meridian has built up. */
const charge = (m: MissionState) => m.jump?.charge ?? 0;

// The Last Jump: a static last stand whose waves are paced by the jump charge, not the clock. Each
// assault comes at a charge mark, so there is no dead time waiting for the drive, and every raider
// ram or bomber hit on the drive costs charge: poor defence makes the stand longer, and repeated
// disruption draws in reinforcements.
const E_LAST_JUMP: EncounterDef[] = [
  {
    id: 'probe',
    name: 'Probing raid',
    trigger: { on: 'when', test: (m) => charge(m) >= 2 },
    warn: 2,
    callout: 'First wave inbound from the north! Keep them off the Meridian.',
    waves: [{ groups: [{ kind: 'raider', count: 3, formation: 'vee', from: 'north', at: { x: 500, y: 200 }, target: 'ally' }] }],
  },
  {
    // Two flanks at once: one ship cannot cover both, so the player chooses which side to meet.
    id: 'pincer',
    name: 'Pincer attack',
    trigger: { on: 'when', test: (m) => encDone(m, 'probe') && charge(m) >= 9 },
    warn: 2.5,
    callout: 'Raiders on both flanks! Pick a side, fast!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 2, formation: 'column', from: 'east', at: { x: 820, y: 560 }, target: 'ally' },
          { kind: 'raider', count: 2, formation: 'column', from: 'west', at: { x: 180, y: 560 }, target: 'ally' },
        ],
      },
    ],
  },
  {
    // Gunships shell the Meridian from range while hunters keep the player busy.
    id: 'gunline',
    name: 'Gunship line',
    trigger: { on: 'when', test: (m) => encDone(m, 'pincer') && charge(m) >= 18 },
    warn: 2,
    callout: 'Gunships shelling the Meridian from the south, and hunters on your tail!',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, formation: 'line', from: 'south', at: { x: 500, y: 900 }, spacing: 260, target: 'ally' },
          { kind: 'scout', count: 2, formation: 'line', from: 'west', at: (m) => m.ship, target: 'player' },
        ],
      },
    ],
  },
  {
    // The other axis: raiders dive from north and south at once, straight down the Meridian's spine.
    id: 'crossfire',
    name: 'Crossing run',
    trigger: { on: 'when', test: (m) => encDone(m, 'gunline') && charge(m) >= 27 },
    warn: 2.5,
    callout: 'Raiders diving from north and south!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 2, formation: 'line', from: 'north', at: { x: 500, y: 220 }, target: 'ally' },
          { kind: 'raider', count: 2, formation: 'line', from: 'south', at: { x: 500, y: 900 }, target: 'ally' },
        ],
      },
    ],
  },
  {
    id: 'bombers',
    name: 'Bomber wing',
    tag: 'bombers',
    trigger: { on: 'phase', phase: 'bombers' },
    warn: 2,
    callout: 'Bomber wing inbound! Every hit on the drive core costs us charge!',
    waves: [{ groups: [{ ...pt('gunner', 80, 120, 'north'), target: 'ally' }, { ...pt('gunner', 920, 120, 'north'), target: 'ally' }, { ...pt('gunner', 500, 60, 'north'), target: 'ally' }] }],
  },
  {
    id: 'bomber-escort',
    name: 'Bomber escort',
    trigger: { on: 'phase', phase: 'bombers', delay: 1 },
    warn: 2,
    until: 'bombers',
    waves: [{ groups: [{ kind: 'scout', count: 3, formation: 'vee', from: 'north', at: { x: 500, y: 240 }, target: 'player' }] }],
  },
  {
    // Boarding run: raiders warp in all around the Meridian at once.
    id: 'breach',
    name: 'Boarding run',
    trigger: { on: 'when', test: (m) => m.phase >= 2 && charge(m) >= 44 },
    warn: 2.5,
    callout: 'Contacts all around the Meridian! Boarding run!',
    waves: [{ groups: [{ kind: 'raider', count: 4, formation: 'ring', spacing: 420, at: MERIDIAN, target: 'ally' }] }],
  },
  {
    id: 'final-push',
    name: 'Final push',
    trigger: { on: 'when', test: (m) => encDone(m, 'breach') && charge(m) >= 55 },
    warn: 2,
    callout: 'Final push! They are throwing everything they have left at the Meridian!',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, formation: 'line', from: 'north', at: { x: 500, y: 200 }, spacing: 300, target: 'ally' },
          { kind: 'raider', count: 3, formation: 'vee', from: 'south', at: { x: 500, y: 900 }, target: 'ally' },
        ],
      },
    ],
  },
  {
    // The drive is nearly there: a last desperate arc of raiders (optional: the jump does not wait for it).
    id: 'last-gasp',
    name: 'Last gasp',
    trigger: { on: 'when', test: (m) => encDone(m, 'final-push') && charge(m) >= 63 },
    warn: 2,
    callout: 'Last attack run from the north! Seconds to jump!',
    waves: [{ groups: [{ kind: 'raider', count: 4, formation: 'arc', from: 'north', at: { x: 500, y: 260 }, spacing: 110, target: 'ally' }] }],
  },
  {
    // The consequence of a leaky defence: after repeated drive disruption the enemy smells blood.
    id: 'reinforcements',
    name: 'Reinforcements',
    trigger: { on: 'when', test: (m) => (m.flags.disruptions ?? 0) >= 4 },
    warn: 2,
    callout: 'They have seen the drive falter: reinforcements inbound from the east!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 3, formation: 'vee', from: 'east', at: { x: 800, y: 400 }, target: 'ally' },
          { kind: 'gunner', count: 1, from: 'east', at: { x: 860, y: 640 }, target: 'ally' },
        ],
      },
    ],
  },
  {
    // Lone raiders between the assaults: each one that reaches the Meridian costs drive charge.
    id: 'harassers',
    name: 'Harassers',
    trigger: { on: 'start', delay: 8 },
    until: 'jump',
    ambient: { budget: 9, every: 7.5, maxAlive: 1, kinds: ['raider'] },
  },
];

const E_GUARDIAN: EncounterDef[] = [
  // Each time the Guardian enters a new phase, two escorts warp in beside it.
  {
    id: 'escorts-1',
    name: 'Guardian escorts',
    trigger: { on: 'when', test: (m) => !!m.boss && m.boss.phase >= 1 },
    warn: 1,
    until: 'guardian',
    waves: [{ groups: [pt('scout', 200, 200), pt('scout', 800, 200)] }],
  },
  {
    id: 'escorts-2',
    name: 'Guardian escorts',
    trigger: { on: 'when', test: (m) => !!m.boss && m.boss.phase >= 2 },
    warn: 1,
    until: 'guardian',
    waves: [{ groups: [pt('scout', 200, 200), pt('scout', 800, 200)] }],
  },
];

function escortArrived(m: MissionState): void {
  const l = living(m);
  for (const a of l) m.score += Math.round(400 * (a.hp / a.maxHp));
  if (l[0]) m.events.push({ type: 'jump', x: l[0].x, y: l[0].y });
}

/** Co-op synchronised strike: put the linked targets up (all of them, at full strength). */
function raiseLinked(m: MissionState): void {
  const L = m.linked!;
  m.drones = m.drones.filter((d) => d.tag !== L.tag);
  spawnTagged(m, L.tag, L.kind, L.spots);
  for (const d of tagged(m, L.tag)) {
    d.hp = d.maxHp = L.hp;
    d.regen = L.regen;
  }
  L.firstAt = null;
}

/**
 * Co-op synchronised strike: the first one down starts the clock; all of them must be down before the
 * window closes. Otherwise the fallen ones reboot at full strength and the strike starts over.
 */
function updateLinked(m: MissionState): void {
  const L = m.linked;
  if (!L || L.done) return;
  const up = tagged(m, L.tag);
  const total = m.flags[`${L.tag}Total`] ?? L.spots.length;
  if (up.length === total) return; // all standing (warping in or untouched)
  if (L.firstAt === null) L.firstAt = m.realTime;
  if (up.length === 0) {
    L.done = true;
    m.score += 1200;
    return;
  }
  if (m.realTime - L.firstAt > L.window) {
    // Too slow: the fallen ones come back.
    const alive = new Set(up.map((d) => `${d.x},${d.y}`));
    for (const spot of L.spots) {
      if (alive.has(`${spot.x},${spot.y}`)) continue;
      const d = spawnDrone(m, L.kind, spot.x, spot.y);
      d.tag = L.tag;
      d.hp = d.maxHp = L.hp;
      d.regen = L.regen;
      m.events.push({ type: 'linked-reboot', x: spot.x, y: spot.y });
    }
    L.firstAt = null;
    comms(m, 'Generators rebooted! They cover for each other: bring them down together.', true);
  }
}

/** Raise the Guardian's shield generators (they warp in); the shield holds while any is up. */
function raiseGenerators(m: MissionState, n: number): void {
  const spots = [
    { x: 170, y: 470 },
    { x: 830, y: 470 },
    { x: 500, y: 600 },
  ].slice(0, n);
  for (const d of tagged(m, 'generator')) d.hp = 0; // never two sets at once
  m.drones = m.drones.filter((d) => d.tag !== 'generator');
  spawnTagged(m, 'generator', 'generator', spots);
}

const MISSION_DEFS: MissionDef[] = [
  {
    id: 'first-contact',
    index: 0,
    code: '01',
    name: 'Asteroid Run',
    tagline: 'Fuel up inside a drifting asteroid field and reach extraction.',
    briefing: 'Your scout ship came out of the jump inside an asteroid field with dry tanks. Recover five fuel cores drifting between the rocks. Debris has drifted across the extraction lane: line your nose up with it and fire to break it apart, then fly into the portal. Rocks rip through hull plating: keep moving.',
    objective: 'Recover 5 fuel cores, blast the blocked lane, reach extraction',
    secondaries: [
      { id: 'no-damage', text: 'Take no hull damage' },
      { id: 'fast', text: 'Finish in under 45s' },
    ],
    world: { w: W, h: W },
    maxHp: 3,
    weapons: true,
    timeLimit: null,
    accent: [110, 170, 255],
    phases: P_FIRST_CONTACT,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 820;
      m.walls = [
        { x: 230, y: 420, w: 120, h: 26 },
        { x: 650, y: 560, w: 120, h: 26 },
      ];
      m.cores = [
        { x: 160, y: 620 },
        { x: 840, y: 760 },
        { x: 500, y: 520 },
        { x: 820, y: 300 },
        { x: 180, y: 220 },
      ].map((c) => ({ id: m.nextId++, ...c, taken: false }));
      m.coresNeeded = 5;
      m.rocks = [
        rockAt(m, 300, 300, 55, 35, 26),
        rockAt(m, 700, 220, -45, 50, 30),
        rockAt(m, 820, 520, -40, -55, 22),
        rockAt(m, 140, 420, 60, -30, 24),
        rockAt(m, 480, 340, -70, 40, 20),
        rockAt(m, 600, 820, 65, -45, 24),
      ];
      m.portal = { x: 500, y: 110, r: 46, open: false };
    },
  },
  {
    id: 'shattered-orbit',
    index: 1,
    code: '02',
    name: 'Shattered Orbit',
    tagline: 'Thread the wreckage, pass every gate, open the exit.',
    briefing: 'A shattered station blocks the orbit lane. Fly through all three navigation gates to power the exit portal. Sliding hull plates and energy barriers guard the narrow passages.',
    objective: 'Pass all 3 gates, then reach the exit portal',
    secondaries: [
      { id: 'no-damage', text: 'Take no hull damage' },
      { id: 'fast', text: 'Finish in under 55s' },
    ],
    world: { w: W, h: 2600 },
    maxHp: 3,
    weapons: false,
    timeLimit: null,
    accent: [130, 140, 230],
    phases: P_SHATTERED,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 2480;
      const H = 2600;
      m.walls = [
        // Narrow passage 1: two plates leave a gap that slides side to side.
        { x: 0, y: H - 560, w: 330, h: 30, move: { dx: 220, dy: 0, period: 6, phase: 0 } },
        { x: 560, y: H - 560, w: 440, h: 30, move: { dx: 220, dy: 0, period: 6, phase: 0 } },
        // Debris field pillars.
        { x: 170, y: H - 1020, w: 60, h: 180 },
        { x: 470, y: H - 1100, w: 60, h: 180 },
        { x: 770, y: H - 1020, w: 60, h: 180 },
        // Narrow passage 2: a fixed corridor.
        { x: 0, y: H - 1720, w: 400, h: 30 },
        { x: 600, y: H - 1720, w: 400, h: 30 },
        { x: 380, y: H - 1720, w: 20, h: 200 },
        { x: 600, y: H - 1720, w: 20, h: 200 },
        // Final crusher: plates closing and opening.
        { x: 0, y: H - 2200, w: 380, h: 30, move: { dx: 90, dy: 0, period: 4, phase: 1 } },
        { x: 620, y: H - 2200, w: 380, h: 30, move: { dx: -90, dy: 0, period: 4, phase: 1 } },
      ];
      m.barriers = [
        { x1: 0, y1: H - 800, x2: 1000, y2: H - 800, period: 5, on: 1.8, offset: 0 },
        { x1: 400, y1: H - 1520, x2: 600, y2: H - 1520, period: 4, on: 1.4, offset: 2 },
        { x1: 0, y1: H - 1950, x2: 500, y2: H - 1950, period: 4.5, on: 1.8, offset: 1 },
        { x1: 500, y1: H - 1950, x2: 1000, y2: H - 1950, period: 4.5, on: 1.8, offset: 3.25 },
      ];
      m.gates = [
        { x: 500, y: H - 680, r: 70, passed: false },
        { x: 500, y: H - 1400, r: 70, passed: false },
        { x: 500, y: H - 2060, r: 70, passed: false },
      ];
      m.rocks = [rockAt(m, 300, H - 1250, 70, 0, 24), rockAt(m, 700, H - 1300, -60, 0, 26), rockAt(m, 500, H - 2350, 80, 0, 22)];
      m.portal = { x: 500, y: 140, r: 50, open: false };
    },
  },
  {
    id: 'breach-protocol',
    index: 2,
    code: '03',
    name: 'Alien Swarm',
    tagline: 'Hold the line around a crippled frigate.',
    briefing: 'The frigate Aegis is dead in space and an alien swarm is closing in. Hold the line through the first waves, then find and destroy whatever is launching them. Raiders dive at the frigate; hunters chase you; gunners glow before they fire. The Aegis must survive.',
    objective: 'Hold the line, destroy the hive carrier, keep the Aegis alive',
    secondaries: [
      { id: 'one-hit', text: 'Take at most 1 hit' },
      { id: 'fast', text: 'Finish in under 100s' },
    ],
    world: { w: W, h: W },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [240, 120, 50],
    phases: P_SWARM,
    encounters: E_SWARM,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 820;
      m.walls = [
        { x: 200, y: 470, w: 90, h: 90 },
        { x: 710, y: 470, w: 90, h: 90 },
      ];
      m.killsNeeded = 0;
      m.allies = [ally(m, 'frigate', 'Frigate Aegis', 500, 600, 26, 46, [], 0)];
      m.alliesNeeded = 1;
    },
  },
  {
    id: 'collapse',
    index: 3,
    code: '04',
    name: 'Orbital Collapse',
    tagline: 'The orbital ring is breaking apart beneath you. Run.',
    briefing: 'The orbital ring has lost its stabilisers and is tearing itself apart from the south. Two blast doors have sealed the way north: hold position on each emergency switch to open its door, then reach the escape portal before the collapse catches you. Wreckage is falling through the shafts.',
    objective: 'Open both blast doors, then reach the portal ahead of the collapse',
    secondaries: [
      { id: 'cores', text: 'Recover all 3 data cores on the way' },
      { id: 'no-damage', text: 'Take no hull damage' },
    ],
    world: { w: W, h: 2400 },
    maxHp: 3,
    weapons: false,
    timeLimit: null,
    accent: [255, 110, 70],
    phases: P_COLLAPSE,
    build(m) {
      const H = 2400;
      m.ship.x = 500;
      m.ship.y = H - 160;
      m.walls = [
        { x: 0, y: H - 620, w: 300, h: 30 },
        { x: 460, y: H - 620, w: 540, h: 30 },
        { x: 0, y: H - 1150, w: 540, h: 30 },
        { x: 700, y: H - 1150, w: 300, h: 30 },
        { x: 120, y: H - 1600, w: 300, h: 30, move: { dx: 460, dy: 0, period: 7, phase: 0 } },
        { x: 0, y: H - 1950, w: 360, h: 30 },
        { x: 640, y: H - 1950, w: 360, h: 30 },
      ];
      // Blast doors seal the two gaps until their emergency switches are thrown.
      const doorA: Wall = { x: 540, y: H - 1150, w: 160, h: 30 };
      const doorB: Wall = { x: 360, y: H - 1950, w: 280, h: 30 };
      m.walls.push(doorA, doorB);
      m.switches = [
        { x: 620, y: H - 1020, r: 58, charge: 0, active: false, door: doorA, name: 'A' },
        { x: 500, y: H - 1830, r: 58, charge: 0, active: false, door: doorB, name: 'B' },
      ];
      m.cores = [
        { x: 850, y: H - 860 },
        { x: 150, y: H - 1380 },
        { x: 820, y: H - 1780 },
      ].map((c) => ({ id: m.nextId++, ...c, taken: false }));
      m.coresNeeded = 0; // optional here
      m.rockSpawn = { every: 0.9, next: 1, speed: 210, fromTop: true };
      m.collapseY = H + 40;
      m.collapseSpeed = 78;
      m.portal = { x: 500, y: 120, r: 52, open: true };
    },
  },
  {
    id: 'meltdown',
    index: 4,
    code: '05',
    name: 'Reactor Meltdown',
    tagline: 'Stabilise three reactors under fire, then escape.',
    briefing: 'The research station is heading for meltdown. Core stability is falling: every reactor you bring online slows the decline, and the defence turrets are cutting the coolant lines, so destroying them helps too. Hold position inside each stabiliser ring until it comes online, then evacuate. Heat pulses roll out from the core: slip through the gap in each ring.',
    objective: 'Stabilise 3 reactors, then escape through the portal',
    secondaries: [
      { id: 'turrets', text: 'Destroy both defence turrets' },
      { id: 'fast', text: 'Finish in under 50s' },
    ],
    world: { w: W, h: W },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [255, 200, 80],
    phases: P_MELTDOWN,
    encounters: E_MELTDOWN,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 860;
      m.reactors = [
        { x: 170, y: 250, r: 70, charge: 0, active: false },
        { x: 830, y: 250, r: 70, charge: 0, active: false },
        { x: 500, y: 640, r: 70, charge: 0, active: false },
      ];
      m.walls = [
        { x: 470, y: 330, w: 60, h: 120 },
        { x: 300, y: 820, w: 110, h: 24 },
        { x: 590, y: 820, w: 110, h: 24 },
      ];
      m.barriers = [
        { x1: 60, y1: 470, x2: 330, y2: 470, period: 4.4, on: 1.6, offset: 0 },
        { x1: 670, y1: 470, x2: 940, y2: 470, period: 4.4, on: 1.6, offset: 2.2 },
      ];
      m.pulseEvery = 4.2;
      m.pulseNext = 3;
      m.stability = 100;
      m.rocks = [rockAt(m, 300, 120, 50, 20, 22), rockAt(m, 700, 760, -55, -35, 24)];
      m.portal = { x: 500, y: 460, r: 46, open: false };
    },
  },
  {
    id: 'guardian',
    index: 5,
    code: '06',
    name: 'Singularity',
    tagline: 'Destroy the Guardian at the edge of a black hole, then outrun it.',
    briefing: 'The Guardian draws its power from a singularity that pulls everything towards it. Its shield is fed by generators around the arena: destroy every generator to drop the shield, then pour fire into the core before they reboot. Red lines mean a beam is coming. When it falls, the singularity will collapse: fly south to the escape portal.',
    objective: 'Destroy the Guardian, then escape the singularity',
    secondaries: [
      { id: 'two-hits', text: 'Take at most 2 hits' },
      { id: 'fast', text: 'Win in under 100s' },
    ],
    world: { w: W, h: W },
    maxHp: 5,
    weapons: true,
    timeLimit: null,
    accent: [229, 72, 77],
    phases: P_GUARDIAN,
    encounters: E_GUARDIAN,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 840;
      m.boss = { x: 500, y: 300, hp: 60, maxHp: 60, phase: 0, shielded: true, cycle: 0, attackIn: 3.4, beam: null, hitFlash: 0, dying: 0 };
      m.gravity = { x: 500, y: 90, reach: 1100, pull: 60, horizon: 36 };
      m.portal = { x: 500, y: 935, r: 50, open: false };
      raiseGenerators(m, 2);
    },
  },
  {
    id: 'alien-pursuit',
    index: 0,
    code: '',
    name: 'Alien Pursuit',
    tagline: 'Escort a crippled transport through alien fighters.',
    briefing: 'The transport Kestrel is limping north to the jump gate with forty colonists aboard and alien raiders in pursuit. Raiders dive straight at the transport; hunters come for you. A command raider is coordinating them: when it shows itself, hunt it down before it escapes.',
    objective: 'Escort the Kestrel, intercept the command raider, reach the jump gate',
    secondaries: [
      { id: 'ally-half', text: 'The transport keeps over half its hull' },
      { id: 'commander', text: 'Destroy the command raider' },
    ],
    world: { w: W, h: 2400 },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [255, 170, 70],
    phases: P_PURSUIT,
    encounters: E_PURSUIT,
    build(m) {
      m.ship.x = 400;
      m.ship.y = 2260;
      const path = [{ x: 500, y: 1950 }, { x: 360, y: 1550 }, { x: 620, y: 1150 }, { x: 430, y: 720 }, { x: 500, y: 240 }];
      m.allies = [ally(m, 'transport', 'Transport Kestrel', 500, 2250, 16, 34, path, 58)];
      m.alliesNeeded = 1;
      m.portal = { x: 500, y: 200, r: 60, open: true };
      m.walls = [
        { x: 120, y: 1300, w: 120, h: 26 },
        { x: 760, y: 900, w: 120, h: 26 },
      ];
    },
  },
  {
    id: 'rescue',
    index: 0,
    code: '',
    name: 'The Rescue',
    tagline: 'Five escape pods, failing life support, a field of debris.',
    briefing: 'A liner broke apart in the debris belt and five escape pods, forty survivors, are drifting with failing life support. Sweep the belt to locate them, lock your tractor beam on (two at a time) and tow them into the rescue ship’s bay. If raiders threaten the rescue ship, the bay seals until they are gone. Your blaster can break up debris; it never targets the pods.',
    objective: 'Locate and recover 40 survivors, secure the rescue area, dock',
    secondaries: [
      { id: 'fast', text: 'Finish in under 75s' },
      { id: 'no-damage', text: 'Take no hull damage' },
    ],
    world: { w: W, h: 1800 },
    maxHp: 3,
    weapons: true,
    timeLimit: 110,
    accent: [140, 200, 255],
    phases: P_RESCUE,
    encounters: E_RESCUE,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 1540;
      m.rescueZone = { x: 500, y: 1660, r: 115 };
      m.pods = [
        { x: 170, y: 1240 },
        { x: 830, y: 1080 },
        { x: 280, y: 680 },
        { x: 760, y: 430 },
        { x: 480, y: 170 },
      ].map((p) => ({ id: m.nextId++, x: p.x, y: p.y, vx: 0, vy: 0, state: 'drifting' as const, found: false }));
      const rocks: [number, number, number, number, number][] = [
        [380, 1300, 40, -20, 26], [650, 1220, -35, 25, 30], [520, 900, 45, 15, 24], [200, 880, -30, -30, 28],
        [820, 760, -40, 20, 26], [420, 520, 30, 35, 30], [640, 300, -45, -15, 24], [250, 320, 35, 25, 26],
      ];
      m.rocks = rocks.map(([x, y, vx, vy, r]) => ({ ...rockAt(m, x, y, vx, vy, r), hp: 3 }));
      m.killsNeeded = 0;
    },
  },
  {
    id: 'convoy',
    index: 0,
    code: '',
    name: 'The Convoy',
    tagline: 'Three cargo haulers. One escort. Escalating raids.',
    briefing: 'Three haulers carry the colony’s medical stores to the relay station. Alien raids will come from every side, and they will get heavier the further north you go. Keep at least two haulers alive; the mission fails if two are lost.',
    objective: 'Escort the convoy, break the ambush, deliver at least 2 haulers',
    secondaries: [
      { id: 'all-allies', text: 'All three cargo ships survive' },
      { id: 'kills-15', text: 'Destroy 15 raiders' },
    ],
    world: { w: W, h: 2600 },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [225, 190, 130],
    phases: P_CONVOY,
    encounters: E_CONVOY,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 2300;
      const lane = (x: number) => [{ x, y: 1800 }, { x: x + 60, y: 1300 }, { x: x - 40, y: 800 }, { x, y: 300 }];
      m.allies = [
        ally(m, 'cargo', 'Hauler One', 380, 2420, 11, 30, lane(380), 52),
        ally(m, 'cargo', 'Hauler Two', 500, 2480, 11, 30, lane(500), 52),
        ally(m, 'cargo', 'Hauler Three', 620, 2420, 11, 30, lane(620), 52),
      ];
      m.alliesNeeded = 2;
      m.portal = { x: 500, y: 230, r: 70, open: true };
    },
  },
  {
    id: 'last-jump',
    index: 0,
    code: '',
    name: 'The Last Jump',
    tagline: 'Hold off a fleet while the capital ship charges its jump drive.',
    briefing: 'The capital ship Meridian is the last ship out, and its jump drive needs seventy seconds of charge. Raiders that slam into her hull knock the drive charge back, and a bomber wing will come for the drive core. Protect the Meridian until it jumps, and it will take you with it.',
    objective: 'Protect the capital ship until its jump drive charges',
    secondaries: [
      { id: 'ally-half', text: 'The capital ship keeps over half its hull' },
      { id: 'two-hits', text: 'Take at most 2 hits' },
    ],
    world: { w: W, h: W },
    maxHp: 5,
    weapons: true,
    timeLimit: null,
    accent: [76, 157, 255],
    phases: P_LAST_JUMP,
    encounters: E_LAST_JUMP,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 830;
      m.allies = [ally(m, 'capital', 'Capital ship Meridian', 500, 560, 90, 70, [], 0)];
      m.alliesNeeded = 1;
      m.jump = { charge: 0, duration: 70 };
    },
  },
];

// ---------- Co-op operations (2-4 pilots) ----------
//
// Op. Twin Lock: three objectives no single pilot can complete alone.
//   1. Two uplinks at opposite ends of the platform charge only while both are held at once.
//   2. The data core is heavy: its carrier flies slowly and cannot fire, and the raids go for them.
//   3. Three shield generators cover for each other: all must fall within three seconds or they reboot.
//      Each only takes damage from a ship close by, and a damaged one recharges when left alone, so one
//      pilot cannot wear them down in turn: it takes a pilot at each (or two moving fast and together).
// Then the whole squadron extracts together (a downed pilot must be revived first).

// The platform, south to north: start, uplinks, vault; the long escort to the uplink bay; the generators;
// the extraction portal at the far north end.
const TL_PADS = [
  { x: 170, y: 2600, r: 55 },
  { x: 830, y: 2600, r: 55 },
];
const TL_VAULT = { x: 500, y: 2450 };
const TL_BAY = { x: 500, y: 1300, r: 90 };
const TL_GENERATORS = [
  { x: 170, y: 820 },
  { x: 500, y: 670 },
  { x: 830, y: 820 },
];
export const TL_STRIKE_WINDOW = 3; // real seconds (CHRONO SHIFT does not stretch it)
export const TL_STRIKE_RANGE = 200; // a generator's shield only drops for a ship this close
const coreOf = (m: MissionState) => m.pods.find((p) => p.heavy) ?? null;
const coreAt = (m: MissionState): Vec => coreOf(m) ?? m.ship;

const P_TWIN_LOCK: Phase[] = [
  {
    id: 'uplinks',
    title: 'Lock both uplinks',
    enter: (m) => comms(m, 'Two uplinks, one at each end of the platform. They only charge while both are held at the same time: split up, hold them, and cover each other.'),
    view: (m) => {
      const up = m.uplink!;
      const held = up.pads.filter((pad) => pilotsNear(m, pad, pad.r).length).length;
      return { text: held === up.pads.length ? 'Uplinks locking · hold both!' : 'Hold both uplinks at the same time', progress: up.charge, count: `${held}/${up.pads.length} held` };
    },
    done: (m) => !!m.uplink?.active,
    complete: (m) => comms(m, 'Uplinks locked. The vault is open: one pilot takes the data core, the rest keep them alive.'),
  },
  {
    id: 'core',
    title: 'Escort the data core',
    enter: (m) => {
      m.pods.push({ id: m.nextId++, x: TL_VAULT.x, y: TL_VAULT.y, vx: 0, vy: 0, state: 'drifting', found: true, heavy: true });
      m.rescueZone = { ...TL_BAY };
    },
    view: (m) => {
      const core = coreOf(m);
      const k = core ? Math.max(0, Math.min(1, (TL_VAULT.y - core.y) / (TL_VAULT.y - TL_BAY.y))) : 0;
      if (core?.state === 'saved') return { text: 'Data core delivered', progress: 1, count: null };
      return { text: core?.state === 'towed' ? 'Escort the carrier to the uplink bay' : 'Pick up the data core', progress: k, count: pct(k) };
    },
    done: (m) => coreOf(m)?.state === 'saved',
    clear: ['core-raid-1', 'core-raid-2', 'core-raid-3'],
    complete: (m) => comms(m, 'Core delivered. Three shield generators guard the exit, and they cover for each other.'),
  },
  {
    id: 'strike',
    title: 'Synchronised strike',
    enter: (m) => {
      m.linked = { tag: 'sync', kind: 'generator', spots: TL_GENERATORS, hp: 10, regen: 4, window: TL_STRIKE_WINDOW, range: TL_STRIKE_RANGE, firstAt: null, done: false };
      raiseLinked(m);
      comms(m, `All three generators must fall within ${TL_STRIKE_WINDOW} seconds of each other, or they reboot. Their shields only drop at close range and recharge when left alone: one pilot per generator, then strike together!`, true);
    },
    view: (m) => {
      const L = m.linked!;
      const down = L.spots.length - tagged(m, L.tag).length;
      const left = L.firstAt === null ? null : Math.max(0, L.window - (m.realTime - L.firstAt));
      return { text: left === null ? 'Close in and destroy all three generators together' : `Strike window · ${left.toFixed(1)}s`, progress: down / L.spots.length, count: `${down}/${L.spots.length}` };
    },
    done: (m) => !!m.linked?.done,
    complete: (m) => {
      openPortal(m);
      comms(m, 'Shield down! Extraction portal open: everyone in, nobody left behind.');
    },
  },
  extractPhase('Extract together', 'Get the whole squadron into the portal'),
];

const E_TWIN_LOCK: EncounterDef[] = [
  {
    // Harassment while the uplinks charge: whoever is holding a pad is the nearest target.
    id: 'pad-raid',
    name: 'Uplink raiders',
    trigger: { on: 'phase', phase: 'uplinks', delay: 2 },
    warn: 2,
    until: 'uplinks',
    callout: 'Raiders inbound on both uplinks!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 1, extraPerPilot: 0.5, from: 'north', at: { x: 170, y: 2450 }, target: 'player' },
          { kind: 'raider', count: 1, extraPerPilot: 0.5, from: 'north', at: { x: 830, y: 2450 }, target: 'player' },
        ],
      },
      {
        delay: 1.5,
        callout: 'Gunships over both pads, hunters from the south!',
        groups: [
          { ...pt('gunner', 170, 2330, 'north'), target: 'player' },
          { ...pt('gunner', 830, 2330, 'north'), target: 'player' },
          { kind: 'scout', count: 2, extraPerPilot: 1, formation: 'line', spacing: 120, from: 'south', at: { x: 500, y: 2800 } },
        ],
      },
      {
        delay: 1.5,
        callout: 'Raiders on both flanks, they are going for the pads!',
        groups: [
          { kind: 'raider', count: 2, extraPerPilot: 0.5, formation: 'vee', from: 'west', at: { x: 200, y: 2600 }, target: 'player' },
          { kind: 'raider', count: 2, extraPerPilot: 0.5, formation: 'vee', from: 'east', at: { x: 800, y: 2600 }, target: 'player' },
        ],
      },
    ],
  },
  {
    id: 'core-raid-1',
    name: 'Core raiders',
    trigger: { on: 'flag', flag: 'coreTowed', delay: 2 },
    warn: 2,
    callout: 'Raiders closing on the core carrier!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 3, extraPerPilot: 1, formation: 'vee', from: 'north', at: offset(coreAt, 0, -300), target: 'carrier' },
          { kind: 'scout', count: 1, extraPerPilot: 1, from: 'west', at: coreAt },
        ],
      },
    ],
  },
  {
    id: 'core-raid-2',
    name: 'Gunship cordon',
    trigger: { on: 'when', test: (m) => (coreOf(m)?.y ?? Infinity) < 2050 },
    warn: 2,
    callout: 'Gunships cutting off the carrier from the east, raiders from the west!',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, extraPerPilot: 0.5, formation: 'line', spacing: 220, from: 'east', at: offset(coreAt, 220, -150), target: 'carrier' },
          { kind: 'raider', count: 2, extraPerPilot: 1, formation: 'column', from: 'west', at: coreAt, target: 'carrier' },
        ],
      },
    ],
  },
  {
    // The last stretch to the bay: interceptors dive from the north, straight at the carrier.
    id: 'core-raid-3',
    name: 'Interceptors',
    trigger: { on: 'when', test: (m) => encDone(m, 'core-raid-2') && (coreOf(m)?.y ?? Infinity) < 1750 },
    warn: 2,
    callout: 'Interceptors diving on the carrier from the north! Keep them off!',
    waves: [
      {
        groups: [
          { kind: 'raider', count: 3, extraPerPilot: 1, formation: 'arc', spacing: 110, from: 'north', at: offset(coreAt, 0, -280), target: 'carrier' },
          { kind: 'gunner', count: 1, extraPerPilot: 0.5, from: 'north', at: { x: 500, y: 1150 }, target: 'carrier' },
        ],
      },
    ],
  },
  {
    id: 'strike-guard',
    name: 'Generator guard',
    trigger: { on: 'phase', phase: 'strike', delay: 1 },
    warn: 2,
    until: 'strike',
    callout: 'Gunships guarding the generators!',
    waves: [
      {
        groups: [
          { kind: 'gunner', count: 2, extraPerPilot: 0.5, formation: 'line', spacing: 420, from: 'north', at: { x: 500, y: 920 }, target: 'player' },
          { kind: 'scout', count: 2, extraPerPilot: 1, formation: 'line', from: 'south', at: (m) => squadFocus(m) },
        ],
      },
    ],
  },
  {
    id: 'extract-chase',
    name: 'Last pursuit',
    trigger: { on: 'phase', phase: 'extract' },
    warn: 1.5,
    callout: 'Contacts closing from every side. Get to the portal!',
    waves: [{ groups: [{ kind: 'raider', count: 4, extraPerPilot: 1, formation: 'ring', spacing: 340, at: (m) => squadFocus(m), target: 'player' }] }],
  },
];

const COOP_DEFS: MissionDef<CoopMissionId>[] = [
  {
    id: 'twin-lock',
    index: 0,
    code: 'C1',
    name: 'Twin Lock',
    tagline: 'Two uplinks, one data core, three generators. Nobody does this alone.',
    briefing:
      'A relay platform holds the last copy of the colony’s star charts. Lock both uplinks at once to open the vault, escort whoever carries the heavy data core (they cannot fire) to the uplink bay, then destroy all three shield generators together before they reboot. Downed pilots can be revived by a teammate who stays close. Extract as a squadron.',
    objective: 'Lock the uplinks together, escort the core, synchronise the strike, extract together',
    secondaries: [
      { id: 'no-downs', text: 'Nobody goes down' },
      { id: 'fast', text: 'Finish in under 180s' },
    ],
    world: { w: W, h: 3000 },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [120, 200, 255],
    coop: { min: 2, max: 4 },
    phases: P_TWIN_LOCK,
    encounters: E_TWIN_LOCK,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 2840;
      m.uplink = { pads: TL_PADS.map((p) => ({ ...p })), charge: 0, active: false };
      m.walls = [
        // Bulkheads north of the vault (one gap, in the middle), a block mid-route, and the generator deck.
        { x: 0, y: 2280, w: 330, h: 26 },
        { x: 670, y: 2280, w: 330, h: 26 },
        { x: 420, y: 1900, w: 160, h: 26 },
        { x: 120, y: 1180, w: 200, h: 26 },
        { x: 680, y: 1180, w: 200, h: 26 },
      ];
      m.portal = { x: 500, y: 200, r: 60, open: false };
      // No overdrive or shield pickups: a doubled fire rate would let one pilot do the synchronised strike alone.
      m.power.nextSpawn = Infinity;
    },
  },
];

/** Co-op operations, for 2-4 pilots. Not part of the solo campaign (no unlocks, no saved records). */
export const COOP_MISSIONS: readonly MissionDef<CoopMissionId>[] = COOP_DEFS;
export const coopMissionById = (id: CoopMissionId) => COOP_MISSIONS.find((m) => m.id === id) ?? COOP_MISSIONS[0];

/** Campaign order. Codes ("01"…) follow this order; ids, and the saved records keyed by them, never change. */
const ORDER: MissionId[] = ['first-contact', 'alien-pursuit', 'rescue', 'shattered-orbit', 'collapse', 'meltdown', 'breach-protocol', 'convoy', 'last-jump', 'guardian'];

export const MISSIONS: readonly MissionDef[] = ORDER.map((id, index) => ({ ...MISSION_DEFS.find((d) => d.id === id)!, index, code: String(index + 1).padStart(2, '0') }));

export type Threat = 'LOW' | 'GUARDED' | 'ELEVATED' | 'HIGH' | 'SEVERE' | 'CRITICAL';
export const THREATS: Threat[] = ['LOW', 'GUARDED', 'ELEVATED', 'HIGH', 'SEVERE', 'CRITICAL'];

/** Each mission is a different military operation: a codename, its type and a threat classification. */
export const OPERATIONS: Record<MissionId, { op: string; kind: string; threat: Threat }> = {
  'first-contact': { op: 'Op. Starfall', kind: 'Asteroid interception', threat: 'LOW' },
  'alien-pursuit': { op: 'Op. Shepherd', kind: 'Transport defence', threat: 'GUARDED' },
  rescue: { op: 'Op. Lifeline', kind: 'Search and rescue', threat: 'GUARDED' },
  'shattered-orbit': { op: 'Op. Needle', kind: 'Wreck navigation', threat: 'ELEVATED' },
  collapse: { op: 'Op. Falling Sky', kind: 'Orbital evacuation', threat: 'ELEVATED' },
  meltdown: { op: 'Op. Cold Core', kind: 'Reactor emergency', threat: 'HIGH' },
  'breach-protocol': { op: 'Op. Bulwark', kind: 'Swarm defence', threat: 'HIGH' },
  convoy: { op: 'Op. Iron Caravan', kind: 'Convoy protection', threat: 'SEVERE' },
  'last-jump': { op: 'Op. Last Light', kind: 'Capital-ship defence', threat: 'SEVERE' },
  guardian: { op: 'Op. Event Horizon', kind: 'Singularity strike', threat: 'CRITICAL' },
};

export const missionById = (id: MissionId) => MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];

// ---------- Creation ----------

export const MAX_PILOTS = 4;
/** Co-op: how close a teammate must stay, and for how long, to bring a downed pilot back. */
export const REVIVE_R = 70;
export const REVIVE_TIME = 2.5;
/** Co-op: the squadron stays on one screen; no two pilots can be further apart than this on either axis. */
export const LEASH_SPAN = VIEW - 2 * 50;
/** Where pilots 2-4 start, relative to the mission's starting position. */
const WING_OFFSETS: Vec[] = [
  { x: 0, y: 0 },
  { x: -70, y: 40 },
  { x: 70, y: 40 },
  { x: 0, y: 80 },
];

function newPilot(slot: number, def: MissionDef<AnyMissionId>): Pilot {
  return {
    x: def.world.w / 2,
    y: def.world.h - 150,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    hp: def.maxHp,
    invuln: 1,
    fireCd: 0,
    thrust: 0,
    slot,
    downed: false,
    reviveCharge: 0,
    online: true,
    aimTarget: null,
    stats: { kills: 0, shots: 0, shotsHit: 0, hitsTaken: 0, downs: 0, revives: 0, objectiveTime: 0 },
  };
}

/**
 * Start a mission. `pilots` > 1 is co-op: the extra pilots start in formation around the first, and
 * every rule applies to each of them (solo missions are exactly what they were with one pilot).
 */
export function createMission(def: MissionDef<AnyMissionId>, seed = 1, pilots = 1): MissionState {
  const n = Math.max(1, Math.min(MAX_PILOTS, Math.floor(pilots)));
  const m: MissionState = {
    def,
    seed,
    rng: mulberry32(seed),
    status: 'playing',
    failReason: null,
    realTime: 0,
    time: 0,
    ship: newPilot(0, def),
    ships: [],
    camX: 0,
    camY: 0,
    walls: [],
    barriers: [],
    rocks: [],
    rockSpawn: null,
    drones: [],
    encounters: initEncounters(def, n),
    bullets: [],
    cores: [],
    coresNeeded: 0,
    gates: [],
    reactors: [],
    pulses: [],
    pulseEvery: 0,
    pulseNext: Infinity,
    portal: null,
    collapseY: null,
    collapseSpeed: 0,
    boss: null,
    chrono: { active: 0, pickup: null, nextSpawn: CHRONO_FIRST, used: 0 },
    power: { pickup: null, nextSpawn: POWER_FIRST, shield: false, overdrive: 0 },
    combo: { count: 0, timer: 0, best: 0 },
    nearMisses: 0,
    turretsKilled: 0,
    cleared: 0,
    allies: [],
    alliesNeeded: 0,
    pods: [],
    rescueZone: null,
    jump: null,
    gravity: null,
    escaping: false,
    kills: 0,
    killsNeeded: 0,
    hitsTaken: 0,
    score: 0,
    target: null,
    phase: 0,
    phaseTime: 0,
    phasesDone: [],
    switches: [],
    stability: null,
    uplink: null,
    linked: null,
    flags: {},
    events: [],
    nextId: 1,
  };
  m.ships = [m.ship];
  def.build(m, m.rng);
  for (let i = 1; i < n; i++) {
    const p = newPilot(i, def);
    p.x = m.ship.x + WING_OFFSETS[i].x;
    p.y = m.ship.y + WING_OFFSETS[i].y;
    p.angle = m.ship.angle;
    resolve(m, p, SHIP_R);
    m.ships.push(p);
  }
  def.phases[0]?.enter?.(m);
  updateEncounters(m, 0, encounterHooks(m)); // encounters present from the start (defences) are in place at once
  if (m.ships.length > 1) {
    const f = squadFocus(m);
    m.camX = clampCamX(m, f.x - VIEW / 2);
    m.camY = clampCam(m, f.y - VIEW / 2);
  } else {
    m.camX = clampCamX(m, m.ship.x - VIEW / 2);
    m.camY = clampCam(m, m.ship.y - VIEW * 0.6);
  }
  return m;
}

function clampCam(m: MissionState, y: number): number {
  return Math.max(0, Math.min(m.def.world.h - VIEW, y));
}

function clampCamX(m: MissionState, x: number): number {
  return Math.max(0, Math.min(m.def.world.w - VIEW, x));
}

// ---------- Objectives ----------

export interface ObjectiveView {
  text: string;
  progress: number; // 0..1
  count: string | null; // "3/5"
  phase: number; // 1-based
  phases: number;
  title: string; // current phase title
  /** A countdown or critical resource for this mission, if any. */
  timer: { label: string; value: string; urgent: boolean } | null;
  /** The enemy group in play: inbound (with its entry edge) or engaged, and whether this phase waits on it. */
  contact: ContactView | null;
  /** Why the operation is not moving on although the phase's own goal is met, or null. */
  hold: string | null;
}

/** What the HUD shows: the current phase of the operation, its progress, and any countdown. */
export function objectiveView(m: MissionState): ObjectiveView {
  const phases = m.def.phases;
  const i = Math.min(m.phase, phases.length - 1);
  const ph = phases[i];
  const v = ph.view(m);
  const contact = m.status === 'playing' ? contactView(m, ph.clear) : null;
  let hold: string | null = null;
  if (m.status === 'playing' && m.phase < phases.length) {
    const waiting = blockingEncounters(m, ph.clear);
    const name = waiting[0] ? m.def.encounters!.find((e) => e.id === waiting[0].id)!.name : null;
    if (name && allyHold(m) !== null && m.allies.some((a) => !a.destroyed && !a.arrived && a.pathIdx >= ph.holdAllies!)) hold = `Escort holding · clear the ${name.toLowerCase()}`;
    else if (name && ph.done(m)) hold = `Clear the ${name.toLowerCase()} to continue`;
  }
  return { ...v, phase: i + 1, phases: phases.length, title: ph.title, timer: missionTimer(m), contact, hold };
}

function missionTimer(m: MissionState): ObjectiveView['timer'] {
  if (m.stability !== null) return { label: 'Core stability', value: `${Math.max(0, Math.ceil(m.stability))}%`, urgent: m.stability < 30 };
  if (m.collapseY !== null) {
    // The pilot nearest the collapse (solo: the ship).
    const back = m.ships.length > 1 ? Math.max(...(standing(m).length ? standing(m) : [m.ship]).map((p) => p.y)) : m.ship.y;
    const gap = Math.max(0, Math.round(m.collapseY - back));
    return { label: 'Collapse behind', value: `${gap}m`, urgent: gap < 260 };
  }
  const cmd = m.drones.find((d) => d.tag === 'commander' && d.hp > 0);
  if (cmd && m.flags.cmdEscapeAt !== undefined) {
    const left = Math.max(0, m.flags.cmdEscapeAt - m.time);
    return { label: left > 0 ? 'Escapes in' : 'Escaping', value: `${Math.ceil(left)}s`, urgent: left < 10 };
  }
  if (m.def.timeLimit !== null && m.def.id === 'rescue') {
    const left = Math.max(0, m.def.timeLimit - m.time);
    return { label: 'Life support', value: `${Math.ceil(left)}s`, urgent: left < 20 };
  }
  if (m.jump) return { label: 'Jump drive', value: `${Math.floor((m.jump.charge / m.jump.duration) * 100)}%`, urgent: false };
  return null;
}

/** Which optional objectives were achieved (evaluated at the end of a won mission). */
export function secondariesMet(m: MissionState): boolean[] {
  return m.def.secondaries.map((s) => {
    switch (s.id) {
      case 'no-damage':
        return m.hitsTaken === 0;
      case 'one-hit':
        return m.hitsTaken <= 1;
      case 'two-hits':
        return m.hitsTaken <= 2;
      case 'cores':
        return m.cores.every((c) => c.taken);
      case 'ally-half':
        return m.allies.every((a) => !a.destroyed && a.hp > a.maxHp / 2);
      case 'all-allies':
        return m.allies.every((a) => !a.destroyed);
      case 'kills-12':
        return m.kills >= 12;
      case 'no-downs':
        return m.ships.every((p) => p.stats.downs === 0);
      case 'commander':
        return m.flags.cmdKilled === 1;
      case 'kills-15':
        return m.kills >= 15;
      case 'turrets':
        return m.turretsKilled >= 2;
      case 'fast': {
        const limit = Number(s.text.match(/(\d+)s/)?.[1] ?? Infinity);
        return m.time < limit;
      }
      default:
        return false;
    }
  });
}

/** 1 star for completing the mission, +1 for each optional objective. */
export const starsFor = (m: MissionState) => (m.status === 'won' ? 1 + secondariesMet(m).filter(Boolean).length : 0);

// ---------- Step ----------

export interface MissionInput {
  x: number;
  y: number;
  /** Primary fire held (Space, mouse button or the touch FIRE button). */
  fire?: boolean;
  /**
   * Optional aim assist (a player setting): a shot whose heading is within ASSIST_CONE of a target is
   * straightened onto it. Shots still only fire on input and only from the nose; with it off they fly
   * exactly along the heading.
   */
  assist?: boolean;
}

function win(m: MissionState): void {
  if (m.status !== 'playing') return;
  m.status = 'won';
  m.chrono.active = 0;
  const online = m.ships.filter((p) => p.online);
  const hullBonus = m.ships.length > 1 ? Math.round((online.reduce((k, p) => k + Math.max(0, p.hp), 0) / Math.max(1, online.length)) * 150) : m.ship.hp * 150;
  const timeBonus = Math.max(0, Math.round(1500 - m.time * 12));
  m.score += 1000 + hullBonus + timeBonus;
  m.events.push({ type: 'won' });
}

function lose(m: MissionState, reason: string): void {
  if (m.status !== 'playing') return;
  m.status = 'lost';
  m.failReason = reason;
  m.chrono.active = 0;
  m.events.push({ type: 'explode', x: m.ship.x, y: m.ship.y, big: true });
  m.events.push({ type: 'lost', reason });
}

function damage(m: MissionState, s: Pilot, from: Vec, reason: string): void {
  if (s.invuln > 0 || m.status !== 'playing' || s.downed || !s.online) return;
  const coop = m.ships.length > 1;
  if (m.power.shield) {
    // The shield power-up absorbs one hit (in co-op it covers the squadron: the first pilot hit uses it).
    m.power.shield = false;
    s.invuln = 0.6;
    m.events.push(coop ? { type: 'shield-block', x: s.x, y: s.y, slot: s.slot } : { type: 'shield-block', x: s.x, y: s.y });
    return;
  }
  s.hp -= 1;
  m.hitsTaken += 1;
  s.stats.hitsTaken++;
  s.invuln = INVULN;
  // Knock the ship away from what hit it.
  const d = Math.hypot(s.x - from.x, s.y - from.y) || 1;
  s.vx += ((s.x - from.x) / d) * 380;
  s.vy += ((s.y - from.y) / d) * 380;
  m.events.push(coop ? { type: 'hit', x: s.x, y: s.y, slot: s.slot } : { type: 'hit', x: s.x, y: s.y });
  if (s.hp <= 0) {
    if (coop) downPilot(m, s, reason);
    else lose(m, reason);
  }
}

/** Lost to something no hull can survive (the collapse, the event horizon): solo loses, co-op downs the pilot. */
function destroy(m: MissionState, s: Pilot, reason: string): void {
  if (m.ships.length > 1) {
    if (!s.downed) downPilot(m, s, reason);
  } else lose(m, reason);
}

function openPortal(m: MissionState): void {
  if (m.portal && !m.portal.open) {
    m.portal.open = true;
    m.events.push({ type: 'portal-open', x: m.portal.x, y: m.portal.y });
  }
}

const DRONE_HP: Record<DroneKind, number> = { scout: 4, gunner: 7, raider: 3, turret: 12, generator: 8, hive: 36, commander: 16 };
const DRONE_SCORE: Record<DroneKind, number> = { scout: 120, gunner: 180, raider: 140, turret: 250, generator: 200, hive: 1200, commander: 900 };

function spawnDrone(m: MissionState, kind: DroneKind, x: number, y: number): Drone {
  const living = m.allies.filter((a) => !a.destroyed);
  // Raiders always hunt a friendly ship; gunners do half the time when there is one to protect.
  const hunts = living.length > 0 && (kind === 'raider' || (kind === 'gunner' && m.rng() < 0.5));
  const targetAlly = hunts ? living[Math.floor(m.rng() * living.length)].id : null;
  const d: Drone = { id: m.nextId++, kind, x, y, vx: 0, vy: 0, hp: DRONE_HP[kind], maxHp: DRONE_HP[kind], fireIn: 1.2 + m.rng() * 1.0, aim: 0, hitFlash: 0, spawnIn: 0.8, targetAlly };
  m.drones.push(d);
  return d;
}

function encounterHooks(m: MissionState): EncounterHooks {
  return {
    spawn: (kind, x, y) => spawnDrone(m, kind, x, y),
    comms: (text, alert) => comms(m, text, alert),
    livingAllies: () => m.allies.filter((a) => !a.destroyed),
  };
}

const TIMEOUT_REASON: Partial<Record<AnyMissionId, string>> = {
  meltdown: 'The reactor core went critical',
  rescue: 'Life support on the escape pods ran out',
};

/** Advance the mission by `dt` real seconds. */
/**
 * Advance the mission by `dt` real seconds. Solo: one input for the one pilot. Co-op: one input per pilot,
 * by slot (a missing one means hands off the controls).
 */
export function stepMission(m: MissionState, input: MissionInput | readonly MissionInput[], dt: number): void {
  const inputs: readonly MissionInput[] = Array.isArray(input) ? input : [input as MissionInput];
  m.events = [];
  if (m.status !== 'playing') {
    if (m.boss && m.boss.dying > 0) m.boss.dying = Math.max(0, m.boss.dying - dt);
    return;
  }
  dt = Math.min(dt, 0.05);
  m.realTime += dt;

  // CHRONO SHIFT: the world runs slower; the ship and its blaster do not.
  if (m.chrono.active > 0) {
    m.chrono.active = Math.max(0, m.chrono.active - dt);
    if (m.chrono.active === 0) m.events.push({ type: 'chrono-off', x: m.ship.x, y: m.ship.y });
  }
  const wdt = m.chrono.active > 0 ? dt * CHRONO_SCALE : dt;
  m.time += wdt;

  // Co-op: where everyone was before this step (the leash holds whoever flies away, against these).
  const before = m.ships.length > 1 ? m.ships.map((p) => ({ x: p.x, y: p.y })) : null;
  for (const p of m.ships) moveShip(m, p, inputs[p.slot] ?? IDLE, dt);
  if (before) {
    leash(m, before);
    updateRevives(m, dt);
    updateStranded(m, dt);
  }
  updateCamera(m, dt);
  updateWorld(m, wdt);
  updateAllies(m, wdt);
  updateEncounters(m, wdt, encounterHooks(m));
  updateCombat(m, dt, wdt, inputs);
  updatePods(m, dt);
  updateObjectives(m, dt, wdt);
  updateChrono(m, dt);
  updatePower(m, dt);
  checkHazards(m);
  m.combo.timer = Math.max(0, m.combo.timer - dt);
  if (m.combo.timer === 0) m.combo.count = 0;
  if (m.def.timeLimit !== null && m.time >= m.def.timeLimit && m.status === 'playing') lose(m, TIMEOUT_REASON[m.def.id] ?? 'Out of time');
}

const IDLE: MissionInput = { x: 0, y: 0 };

/** Co-op: this pilot is carrying the (heavy) data core. */
const carrying = (m: MissionState, p: Pilot) => m.pods.length > 0 && m.pods.some((x) => x.heavy && x.state === 'towed' && x.towedBy === p.slot);
/** Co-op: the pilot carrying the data core, if anyone is. */
export const carrierOf = (m: MissionState): Pilot | null => {
  const core = m.pods.find((x) => x.heavy && x.state === 'towed');
  return core ? (m.ships[core.towedBy ?? 0] ?? null) : null;
};

/** Pilots who can act: online and not downed. */
export const standing = (m: MissionState) => m.ships.filter((p) => p.online && !p.downed);

/** The standing pilot nearest to a point: who enemies go for (solo: always the one ship). */
function nearestPilot(m: MissionState, from: Vec): Pilot {
  if (m.ships.length === 1) return m.ship;
  let best: Pilot | null = null;
  let bd = Infinity;
  for (const p of m.ships) {
    if (!p.online || p.downed) continue;
    const d = dist(p, from);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best ?? m.ship;
}

/**
 * Fly one pilot for `dt` real seconds (the same flight model every step uses). Exported so a co-op guest
 * can predict its own ship between snapshots; the host's simulation stays the authority.
 */
export function flyPilot(m: MissionState, s: Pilot, input: MissionInput, dt: number): void {
  moveShip(m, s, input, dt);
}

function moveShip(m: MissionState, s: Pilot, input: MissionInput, dt: number): void {
  if (!s.online || s.downed) {
    // Offline pilots are frozen; a downed ship is a drifting-dead wreck waiting for a teammate.
    s.vx = 0;
    s.vy = 0;
    s.thrust = 0;
    return;
  }
  const len = Math.hypot(input.x || 0, input.y || 0);
  const ix = len > 1 ? input.x / len : input.x || 0;
  const iy = len > 1 ? input.y / len : input.y || 0;
  const k = Math.min(1, dt * SHIP_RESPONSE);
  const top = carrying(m, s) ? SHIP_SPEED * HEAVY_TOW : SHIP_SPEED;
  s.vx += (ix * top - s.vx) * k;
  s.vy += (iy * top - s.vy) * k;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  // Singularity: a current that drags the ship towards the black hole, stronger up close.
  const g = m.gravity;
  if (g) {
    const dx = g.x - s.x;
    const dy = g.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < g.reach) {
      const k = g.pull * (0.35 + 0.65 * (1 - d / g.reach));
      s.x += (dx / d) * k * dt;
      s.y += (dy / d) * k * dt;
    }
  }
  resolve(m, s, SHIP_R);
  s.thrust = Math.min(1, Math.hypot(s.vx, s.vy) / SHIP_SPEED);
  if (len > 0.05) {
    // Turn smoothly towards the direction of travel.
    const want = Math.atan2(iy, ix);
    let diff = want - s.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    s.angle += diff * Math.min(1, dt * 14);
  }
  s.invuln = Math.max(0, s.invuln - dt);
}

function updateCamera(m: MissionState, dt: number): void {
  if (m.ships.length > 1) {
    // Co-op: one shared camera on the middle of the squadron (the leash keeps everyone inside it).
    const f = squadFocus(m);
    const k = Math.min(1, dt * 10);
    m.camX += (clampCamX(m, f.x - VIEW / 2) - m.camX) * k;
    m.camY += (clampCam(m, f.y - VIEW / 2) - m.camY) * k;
    return;
  }
  const k = Math.min(1, dt * 6);
  m.camX += (clampCamX(m, m.ship.x - VIEW / 2) - m.camX) * k;
  m.camY += (clampCam(m, m.ship.y - VIEW * 0.6) - m.camY) * k;
}

/** Co-op: the middle of the box around every online pilot (downed wrecks included, so they stay in view). */
export function squadFocus(m: MissionState): Vec {
  const ps = m.ships.filter((p) => p.online);
  if (!ps.length) return { x: m.ship.x, y: m.ship.y };
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * Co-op: no pilot may get further than LEASH_SPAN from any other online pilot on either axis, so the
 * shared camera can always show the whole squadron. A pilot pushing past the limit is held at it.
 */
function leash(m: MissionState, before: Vec[]): void {
  // First hold each pilot against where the others were before this step: whoever flies away is stopped at
  // the limit, and nobody is dragged along by a teammate. Then the same check against where everyone is now,
  // for the rare step in which two pilots fly apart at once.
  for (const p of m.ships) if (p.online && !p.downed) leashPilot(m, p, before);
  for (const p of m.ships) if (p.online && !p.downed) leashPilot(m, p);
}

/**
 * Co-op: hold one pilot within LEASH_SPAN of every other online pilot (at the positions given, or where
 * they are now). Exported so a guest's prediction of its own ship (which may be a private copy: matched by
 * slot) stops at the leash exactly as the host does.
 */
export function leashPilot(m: MissionState, p: Pilot, at?: Vec[]): void {
  {
    const others = m.ships.filter((o) => o.online && o.slot !== p.slot).map((o) => at?.[o.slot] ?? o);
    if (!others.length) return;
    const xs = others.map((o) => o.x);
    const ys = others.map((o) => o.y);
    const loX = Math.max(...xs) - LEASH_SPAN;
    const hiX = Math.min(...xs) + LEASH_SPAN;
    const loY = Math.max(...ys) - LEASH_SPAN;
    const hiY = Math.min(...ys) + LEASH_SPAN;
    if (p.x < loX) {
      p.x = loX;
      p.vx = Math.max(0, p.vx);
    } else if (p.x > hiX) {
      p.x = hiX;
      p.vx = Math.min(0, p.vx);
    }
    if (p.y < loY) {
      p.y = loY;
      p.vy = Math.max(0, p.vy);
    } else if (p.y > hiY) {
      p.y = hiY;
      p.vy = Math.min(0, p.vy);
    }
  }
}

/** Co-op: a teammate who stays within REVIVE_R of a downed pilot brings them back after REVIVE_TIME. */
function updateRevives(m: MissionState, dt: number): void {
  for (const p of m.ships) {
    if (!p.downed || !p.online) continue;
    const helpers = m.ships.filter((h) => h !== p && h.online && !h.downed && dist(h, p) < REVIVE_R);
    if (!helpers.length) {
      p.reviveCharge = Math.max(0, p.reviveCharge - dt * 0.5);
      continue;
    }
    p.reviveCharge = Math.min(1, p.reviveCharge + dt / REVIVE_TIME);
    if (p.reviveCharge < 1) continue;
    const by = helpers.reduce((a, b) => (dist(b, p) < dist(a, p) ? b : a));
    p.downed = false;
    p.reviveCharge = 0;
    p.hp = Math.ceil(m.def.maxHp / 2);
    p.invuln = 2;
    by.stats.revives++;
    m.events.push({ type: 'pilot-revived', slot: p.slot, by: by.slot, x: p.x, y: p.y });
  }
}

/** Co-op: a pilot's hull is gone. They are downed (a teammate can revive them); if nobody is left standing, the mission is lost. */
function downPilot(m: MissionState, p: Pilot, reason: string): void {
  p.downed = true;
  p.reviveCharge = 0;
  p.hp = 0;
  p.vx = 0;
  p.vy = 0;
  p.stats.downs++;
  for (const pod of m.pods) {
    if (pod.state === 'towed' && pod.towedBy === p.slot) {
      pod.state = 'drifting'; // the tractor beam lets go
      pod.towedBy = undefined;
    }
  }
  m.events.push({ type: 'explode', x: p.x, y: p.y, big: false });
  m.events.push({ type: 'pilot-down', slot: p.slot, reason, x: p.x, y: p.y });
  checkWipe(m, reason);
}

/** Co-op: a pilot who was still flying when they lost connection could rejoin and revive the others. */
const couldReturn = (m: MissionState) => m.ships.some((p) => !p.online && !p.downed);

/**
 * Co-op: the mission is lost when every online pilot is down at once, unless a disconnected pilot who was
 * still flying could rejoin and revive them (then the squadron waits; see STRANDED_LIMIT).
 */
function checkWipe(m: MissionState, reason: string): void {
  if (m.ships.length === 1 || m.status !== 'playing') return;
  const online = m.ships.filter((p) => p.online);
  if (online.length && online.every((p) => p.downed) && !couldReturn(m)) lose(m, `The whole squadron is down · ${reason}`);
}

/** Co-op: how long the squadron waits for a disconnected pilot to rejoin when nobody online can fly. */
export const STRANDED_LIMIT = 30;

/**
 * Co-op: nobody online is flying, but a disconnected pilot could come back. Count the wait (in flags, so
 * every screen can show it) and give up after STRANDED_LIMIT seconds.
 */
function updateStranded(m: MissionState, dt: number): void {
  const flying = m.ships.some((p) => p.online && !p.downed);
  if (flying || !couldReturn(m)) {
    if (m.flags.stranded !== undefined) delete m.flags.stranded;
    return;
  }
  m.flags.stranded = (m.flags.stranded ?? 0) + dt;
  if (m.flags.stranded >= STRANDED_LIMIT) lose(m, 'The squadron lost contact: nobody was left flying to revive the downed pilots');
}

/** Co-op: a pilot drops out (disconnects) or comes back. Offline pilots are frozen and ignored. */
export function setPilotOnline(m: MissionState, slot: number, online: boolean): void {
  const p = m.ships[slot];
  if (!p || p.online === online) return;
  p.online = online;
  if (!online) {
    p.vx = 0;
    p.vy = 0;
    for (const pod of m.pods) {
      if (pod.state === 'towed' && pod.towedBy === slot) {
        pod.state = 'drifting';
        pod.towedBy = undefined;
      }
    }
    checkWipe(m, 'the last pilot flying disconnected');
  } else {
    p.invuln = Math.max(p.invuln, 2);
    // Back online, but the others went down while they were away and nobody is left to wait for.
    checkWipe(m, 'nobody left flying');
  }
}

/** Where the current objective is, for the off-screen pointer. */
export function objectiveTarget(m: MissionState, viewer: Vec = m.ship): Vec | null {
  const near = <T extends Vec>(xs: T[]) => xs.sort((a, b) => dist(a, viewer) - dist(b, viewer))[0] ?? null;
  const phase = m.def.phases[Math.min(m.phase, m.def.phases.length - 1)].id;
  if (phase === 'extract' && m.portal?.open) return m.portal;
  switch (m.def.id) {
    case 'first-contact':
      return phase === 'cores' ? near(m.cores.filter((c) => !c.taken)) : near(m.rocks.filter((r) => r.tag === 'blocker'));
    case 'shattered-orbit':
      return m.gates.find((g) => !g.passed) ?? null;
    case 'meltdown':
      return near(m.reactors.filter((r) => !r.active));
    case 'breach-protocol':
      return phase === 'hive' ? tagged(m, 'hive')[0] ?? null : near(m.drones.filter((d) => d.spawnIn === 0));
    case 'collapse':
      return m.switches.find((w) => !w.active) ?? m.portal;
    case 'guardian':
      if (m.escaping) return m.portal;
      return m.boss?.shielded ? near(tagged(m, 'generator')) ?? m.boss : m.boss;
    case 'alien-pursuit':
    case 'convoy':
    case 'last-jump': {
      const priority = near(m.drones.filter((d) => d.tag && d.hp > 0 && d.spawnIn === 0));
      if (priority) return priority;
      // Otherwise point at the friendly ship in most danger.
      return living(m).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] ?? null;
    }
    case 'twin-lock': {
      if (phase === 'uplinks' && m.uplink) return near(m.uplink.pads.filter((pad) => !pilotsNear(m, pad, pad.r).length)) ?? null;
      if (phase === 'core') {
        const core = coreOf(m);
        return core?.state === 'towed' ? m.rescueZone : core;
      }
      if (phase === 'strike') return near(tagged(m, 'sync'));
      return m.portal;
    }
    case 'rescue': {
      if (phase === 'secure') return near(tagged(m, 'boarders'));
      if (phase === 'dock' || m.pods.some((p) => p.state === 'towed')) return m.rescueZone;
      return near(m.pods.filter((p) => p.state === 'drifting'));
    }
  }
}

function updateWorld(m: MissionState, wdt: number): void {
  const H = m.def.world.h;
  // Debris
  if (m.rockSpawn) {
    m.rockSpawn.next -= wdt;
    if (m.rockSpawn.next <= 0) {
      m.rockSpawn.next = m.rockSpawn.every * (0.7 + m.rng() * 0.6);
      const x = 60 + m.rng() * (W - 120);
      m.rocks.push(rockAt(m, x, m.camY - 40, (m.rng() - 0.5) * 60, m.rockSpawn.speed * (0.8 + m.rng() * 0.4), 18 + m.rng() * 14));
    }
  }
  for (const r of m.rocks) {
    r.x += r.vx * wdt;
    r.y += r.vy * wdt;
    if (!m.rockSpawn) {
      // Drifting debris bounces around the world.
      if (r.x < r.r || r.x > m.def.world.w - r.r) r.vx *= -1;
      if (r.y < r.r || r.y > H - r.r) r.vy *= -1;
      r.x = Math.max(r.r, Math.min(m.def.world.w - r.r, r.x));
      r.y = Math.max(r.r, Math.min(H - r.r, r.y));
      for (const w0 of m.walls) {
        const w = wallAt(w0, m.time);
        if (r.x + r.r > w.x && r.x - r.r < w.x + w.w && r.y + r.r > w.y && r.y - r.r < w.y + w.h) {
          const pens = [r.x + r.r - w.x, w.x + w.w - (r.x - r.r), r.y + r.r - w.y, w.y + w.h - (r.y - r.r)];
          const i = pens.indexOf(Math.min(...pens));
          if (i < 2) r.vx *= -1;
          else r.vy *= -1;
          r.x += i === 0 ? -pens[0] : i === 1 ? pens[1] : 0;
          r.y += i === 2 ? -pens[2] : i === 3 ? pens[3] : 0;
        }
      }
    }
  }
  if (m.rockSpawn) m.rocks = m.rocks.filter((r) => r.y < m.camY + VIEW + 80 && r.y < H + 60);

  // Collapse line moves north and speeds up.
  if (m.collapseY !== null) {
    m.collapseSpeed += wdt * 1.8;
    m.collapseY -= m.collapseSpeed * wdt;
  }

  // Heat pulses from the reactor core (Core Meltdown).
  if (m.pulseEvery > 0) {
    m.pulseNext -= wdt;
    if (m.pulseNext <= 0) {
      m.pulseNext = m.pulseEvery;
      m.pulses.push({ r: 30, warn: 1.1, gap: m.rng() * Math.PI * 2 });
      m.events.push({ type: 'warn', x: 500, y: 500 });
    }
    for (const p of m.pulses) {
      if (p.warn > 0) p.warn -= wdt;
      else p.r += 240 * wdt;
    }
    m.pulses = m.pulses.filter((p) => p.r < 760);
  }
}

export const PULSE_BAND = 16;
export const PULSE_GAP = 0.6; // half-width of the safe gap, radians

function allyById(m: MissionState, id: number | null): Ally | null {
  if (id === null) return null;
  const a = m.allies.find((x) => x.id === id);
  return a && !a.destroyed ? a : null;
}

/** Jump-drive seconds lost to a raider ramming the Meridian, and to a bomber's shot at its drive core. */
export const RAM_DISRUPT = 3;
export const BOMB_DISRUPT = 2;

/** The Last Jump: knock the drive charge back and count it (repeated disruption draws reinforcements). */
function disruptDrive(m: MissionState, seconds: number, message: string): void {
  if (!m.jump) return;
  m.jump.charge = Math.max(0, m.jump.charge - seconds);
  m.flags.disruptions = (m.flags.disruptions ?? 0) + 1;
  if (m.time - (m.flags.disruptAt ?? -99) > 4) comms(m, message, true);
  m.flags.disruptAt = m.time;
}

function allyDamage(m: MissionState, a: Ally, amount: number): void {
  if (a.destroyed || m.status !== 'playing') return;
  a.hp -= amount;
  a.hitFlash = 0.15;
  m.events.push({ type: 'ally-hit', x: a.x, y: a.y });
  if (a.hp > 0 && a.hp / a.maxHp < 0.35 && !m.flags[`crit${a.id}`]) {
    m.flags[`crit${a.id}`] = 1;
    comms(m, `${a.name} is taking critical damage!`, true);
  }
  if (a.hp <= 0) {
    a.hp = 0;
    a.destroyed = true;
    m.events.push({ type: 'explode', x: a.x, y: a.y, big: true });
    m.events.push({ type: 'ally-lost', x: a.x, y: a.y, name: a.name });
    const lost = m.allies.filter((x) => x.destroyed).length;
    if (m.allies.length - lost < m.alliesNeeded) lose(m, `${a.name} was destroyed`);
  }
}

/** Kill chain: kills in quick succession raise the score multiplier (up to x4). */
export const comboMult = (count: number) => 1 + Math.min(3, Math.max(0, count - 1) * 0.5);

function registerKill(m: MissionState, d: Drone): void {
  m.combo.count = m.combo.timer > 0 ? m.combo.count + 1 : 1;
  m.combo.timer = COMBO_WINDOW;
  m.combo.best = Math.max(m.combo.best, m.combo.count);
  const mult = comboMult(m.combo.count);
  m.score += Math.round(DRONE_SCORE[d.kind] * mult);
  if (m.combo.count >= 2) m.events.push({ type: 'combo', count: m.combo.count, mult, x: d.x, y: d.y });
  if (d.kind === 'turret') m.turretsKilled++;
}

/** Where along the segment p0→p1 (0..1) it first comes within `r` of point c, or null if it never does. */
export function segmentHit(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // already touching at the start
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const k = (-b - Math.sqrt(disc)) / (2 * a);
  return k >= 0 && k <= 1 ? k : null;
}

/** Segment against an axis-aligned rectangle: the first point of entry (0..1), or null. */
function segmentRect(x0: number, y0: number, x1: number, y1: number, w: Rect): number | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - w.x],
    [dx, w.x + w.w - x0],
    [-dy, y0 - w.y],
    [dy, w.y + w.h - y0],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const k = q / p;
      if (p < 0) t0 = Math.max(t0, k);
      else t1 = Math.min(t1, k);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

interface BoltHit {
  kind: 'drone' | 'boss' | 'rock' | 'wall';
  k: number;
  x: number;
  y: number;
  drone?: Drone;
  rock?: Rock;
}

/** The first thing a player bolt moving from (x0,y0) to (x1,y1) would strike. Walls stop bolts. */
function firstHit(m: MissionState, x0: number, y0: number, x1: number, y1: number, br: number): BoltHit | null {
  let best: BoltHit | null = null;
  const consider = (h: BoltHit) => {
    if (!best || h.k < best.k) best = h;
  };
  for (const w0 of m.walls) {
    const k = segmentRect(x0, y0, x1, y1, wallAt(w0, m.time));
    if (k !== null) consider({ kind: 'wall', k, x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k });
  }
  for (const d of m.drones) {
    if (d.spawnIn > 0 || d.hp <= 0) continue;
    const k = segmentHit(x0, y0, x1, y1, d.x, d.y, HIT_R[d.kind] + br);
    if (k !== null) consider({ kind: 'drone', k, x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, drone: d });
  }
  const boss = m.boss;
  if (boss && boss.dying === 0 && boss.hp > 0) {
    // While shielded the bolt stops on the shield bubble; otherwise on the hull.
    const k = segmentHit(x0, y0, x1, y1, boss.x, boss.y, (boss.shielded ? 96 : 66) + br);
    if (k !== null) consider({ kind: 'boss', k, x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k });
  }
  for (const r of m.rocks) {
    const k = segmentHit(x0, y0, x1, y1, r.x, r.y, r.r + br);
    if (k !== null) consider({ kind: 'rock', k, x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, rock: r });
  }
  return best;
}

/**
 * Where a shot fired now would go, and what it would hit: straight along the heading, or (with aim
 * assist) straightened onto the best target within ASSIST_CONE of the nose with a clear line of fire.
 */
function aimSolution(m: MissionState, s: Ship, assist: boolean): { angle: number; target: number | null } {
  const straight = { angle: s.angle, target: lineOfFire(m, s, s.angle) };
  if (!assist) return straight;
  const mx = s.x + Math.cos(s.angle) * MUZZLE;
  const my = s.y + Math.sin(s.angle) * MUZZLE;
  const cands: { x: number; y: number; id: number }[] = [];
  for (const d of m.drones) if (d.spawnIn === 0 && d.hp > 0) cands.push({ x: d.x, y: d.y, id: d.id });
  if (m.boss && m.boss.dying === 0 && m.boss.hp > 0 && !m.boss.shielded) cands.push({ x: m.boss.x, y: m.boss.y, id: -1 });
  for (const r of m.rocks) if (r.hp !== undefined) cands.push({ x: r.x, y: r.y, id: -2 - r.id });
  let best: { angle: number; target: number; off: number } | null = null;
  for (const c of cands) {
    const dd = Math.hypot(c.x - mx, c.y - my);
    if (dd > FIRE_RANGE) continue;
    const a = Math.atan2(c.y - my, c.x - mx);
    // The heading is not wrapped (it accumulates as the ship turns), so wrap the difference fully.
    const off = Math.abs(Math.atan2(Math.sin(a - s.angle), Math.cos(a - s.angle)));
    if (off > ASSIST_CONE) continue;
    // Only if the straightened shot really reaches this target first (no wall or other body in the way).
    if (lineOfFire(m, s, a) !== c.id) continue;
    if (!best || off < best.off) best = { angle: a, target: c.id, off };
  }
  return best ?? straight;
}

/** What a bolt fired now along `angle` would hit (within range): the HUD's "in your sights" target. */
function lineOfFire(m: MissionState, s: Ship, angle: number): number | null {
  const mx = s.x + Math.cos(s.angle) * MUZZLE;
  const my = s.y + Math.sin(s.angle) * MUZZLE;
  const h = firstHit(m, mx, my, mx + Math.cos(angle) * FIRE_RANGE, my + Math.sin(angle) * FIRE_RANGE, BOLT_R);
  if (!h || h.kind === 'wall') return null;
  if (h.kind === 'rock' && h.rock!.hp === undefined) return null; // an indestructible asteroid is in the way
  return h.kind === 'drone' ? h.drone!.id : h.kind === 'boss' ? -1 : -2 - h.rock!.id;
}

function updateCombat(m: MissionState, dt: number, wdt: number, inputs: readonly MissionInput[]): void {
  for (const d of m.drones) {
    d.hitFlash = Math.max(0, d.hitFlash - dt);
    if (d.spawnIn > 0) {
      d.spawnIn = Math.max(0, d.spawnIn - wdt);
      continue;
    }
    // Raiders whose target was lost pick another friendly ship, or the player.
    if (d.targetAlly !== null && !allyById(m, d.targetAlly)) {
      const living = m.allies.filter((a) => !a.destroyed);
      d.targetAlly = living.length ? living[Math.floor(m.rng() * living.length)].id : null;
    }
    // Enemies after a pilot go for the nearest one still standing (or the data core's carrier).
    const carrier = d.hunt === 'carrier' ? carrierOf(m) : null;
    const s = carrier && carrier.online && !carrier.downed ? carrier : nearestPilot(m, d);
    if (d.regen && d.hp > 0 && d.hp < d.maxHp && m.time - (d.lastHitAt ?? -Infinity) >= REGEN_DELAY) d.hp = Math.min(d.maxHp, d.hp + d.regen * wdt);
    const prey: Vec = allyById(m, d.targetAlly) ?? s;
    const dx = prey.x - d.x;
    const dy = prey.y - d.y;
    const dd = Math.hypot(dx, dy) || 1;
    if (d.kind === 'scout') {
      // Hunters chase the player, a little slower than the ship.
      const ex = s.x - d.x;
      const ey = s.y - d.y;
      const ed = Math.hypot(ex, ey) || 1;
      d.vx += ((ex / ed) * 165 - d.vx) * Math.min(1, wdt * 2.2);
      d.vy += ((ey / ed) * 165 - d.vy) * Math.min(1, wdt * 2.2);
    } else if (d.kind === 'raider') {
      // Raiders make attack runs straight at their target.
      d.vx += ((dx / dd) * 175 - d.vx) * Math.min(1, wdt * 1.8);
      d.vy += ((dy / dd) * 175 - d.vy) * Math.min(1, wdt * 1.8);
    } else if (d.kind === 'commander') {
      // The command raider shadows the transport from a distance, then makes a run for the map edge.
      const escaping = m.flags.cmdEscapeAt !== undefined && m.time >= m.flags.cmdEscapeAt;
      if (escaping && !m.flags.cmdEscapeWarned) {
        m.flags.cmdEscapeWarned = 1;
        comms(m, 'The command raider is breaking away! Stop it!', true);
      }
      let tx: number;
      let ty: number;
      if (escaping) {
        tx = d.x < m.def.world.w / 2 ? -200 : m.def.world.w + 200;
        ty = d.y - 120;
      } else {
        const side = Math.sin(m.time * 0.35) > 0 ? 1 : -1;
        tx = prey.x + side * 240;
        ty = prey.y - 160;
      }
      const ex = tx - d.x;
      const ey = ty - d.y;
      const ed = Math.hypot(ex, ey) || 1;
      const sp = escaping ? 230 : 150;
      d.vx += ((ex / ed) * sp - d.vx) * Math.min(1, wdt * 1.6);
      d.vy += ((ey / ed) * sp - d.vy) * Math.min(1, wdt * 1.6);
      if (escaping && (d.x < 30 || d.x > m.def.world.w - 30)) {
        d.hp = 0;
        d.gone = true;
        m.flags.cmdEscaped = 1;
      }
    } else if (d.kind === 'hive') {
      // The hive carrier launches raiders at the frigate while it lives (a few at a time).
      m.flags.hiveNext = (m.flags.hiveNext ?? 2.5) - wdt;
      if (m.flags.hiveNext <= 0 && m.drones.filter((x) => x.tag === 'brood' && x.hp > 0).length < 4) {
        m.flags.hiveNext = 3.2;
        const r = spawnDrone(m, 'raider', d.x + (m.rng() - 0.5) * 80, d.y + 50);
        r.tag = 'brood';
        r.enc = d.enc; // the brood belongs to the hive's encounter
      }
    } else if (d.kind === 'gunner') {
      // Gunners keep their distance from their target and strafe.
      const want = dd < 300 ? -1 : dd > 420 ? 1 : 0;
      const sp = 110;
      d.vx += ((dx / dd) * sp * want + (-dy / dd) * 70 - d.vx) * Math.min(1, wdt * 1.6);
      d.vy += ((dy / dd) * sp * want + (dx / dd) * 70 - d.vy) * Math.min(1, wdt * 1.6);
    }
    if (d.kind === 'gunner' || d.kind === 'turret' || d.kind === 'commander') {
      d.fireIn -= wdt;
      if (d.fireIn <= 0 && d.aim <= 0 && (d.kind !== 'turret' || dist(d, s) < 650)) {
        d.aim = AIM_TIME;
        m.events.push({ type: 'warn', x: d.x, y: d.y });
      }
      if (d.aim > 0) {
        d.aim -= wdt;
        if (d.aim <= 0) {
          d.fireIn = (d.kind === 'turret' ? 2.4 : d.kind === 'commander' ? 2.2 : 1.6) + m.rng() * 1.0;
          const tgt = d.kind === 'turret' ? s : prey;
          const a = Math.atan2(tgt.y - d.y, tgt.x - d.x);
          const b: Bullet = { id: m.nextId++, x: d.x, y: d.y, vx: Math.cos(a) * ENEMY_BOLT_SPEED, vy: Math.sin(a) * ENEMY_BOLT_SPEED, r: 9, from: 'enemy', life: 5 };
          if (d.tag === 'bombers') b.drive = true;
          m.bullets.push(b);
          m.events.push({ type: 'enemy-shoot', x: d.x, y: d.y });
        }
      }
    }
    if (!STATIONARY.includes(d.kind)) {
      d.x += d.vx * wdt;
      d.y += d.vy * wdt;
      // The escaping command raider may leave the world; everything else stays inside it.
      if (!(d.kind === 'commander' && m.flags.cmdEscapeAt !== undefined && m.time >= m.flags.cmdEscapeAt)) resolve(m, d, 18);
    }
    // A raider that reaches a friendly ship slams into it.
    const victim = allyById(m, d.targetAlly);
    if (d.kind === 'raider' && victim && dist(d, victim) < victim.r + 14) {
      allyDamage(m, victim, 2);
      if (m.jump && victim.kind === 'capital') disruptDrive(m, RAM_DISRUPT, 'Impact on the Meridian: jump drive charge disrupted!');
      d.hp = -999; // destroyed in the impact; not counted as a kill
    }
  }

  // Boss
  if (m.boss) updateBoss(m, wdt);

  // Player blasters: each fires only when its pilot asks, straight ahead along the ship's heading, from
  // the muzzle at the nose. Overdrive halves the cooldown. Nothing is auto-aimed.
  for (const s of m.ships) {
    if (!s.online || s.downed) {
      s.aimTarget = null;
      if (s === m.ship) m.target = null;
      continue;
    }
    const input = inputs[s.slot] ?? IDLE;
    s.fireCd = Math.max(0, s.fireCd - dt);
    // Carrying the data core takes the ship's power: no blaster until it is handed over.
    const armed = m.def.weapons && !carrying(m, s);
    const aim = armed ? aimSolution(m, s, !!input.assist) : null;
    s.aimTarget = aim ? aim.target : null;
    if (s === m.ship) m.target = s.aimTarget;
    if (armed && input.fire && s.fireCd === 0 && aim) {
      s.fireCd = m.power.overdrive > 0 ? FIRE_EVERY / 2 : FIRE_EVERY;
      const mx = s.x + Math.cos(s.angle) * MUZZLE;
      const my = s.y + Math.sin(s.angle) * MUZZLE;
      const ux = Math.cos(aim.angle);
      const uy = Math.sin(aim.angle);
      m.bullets.push({ id: m.nextId++, x: mx, y: my, vx: ux * BOLT_SPEED, vy: uy * BOLT_SPEED, r: BOLT_R, from: 'player', life: FIRE_RANGE / BOLT_SPEED, owner: s.slot });
      m.events.push({ type: 'shoot', x: mx, y: my, angle: aim.angle });
      m.flags.shots = (m.flags.shots ?? 0) + 1;
      s.stats.shots++;
    }
  }

  // Bullets: player bolts in real time, enemy shots in world time.
  for (const b of m.bullets) {
    const t = b.from === 'player' ? dt : wdt;
    const x0 = b.x;
    const y0 = b.y;
    // A bolt never travels further than its remaining life allows.
    const tt = Math.min(t, Math.max(0, b.life));
    b.x += b.vx * tt;
    b.y += b.vy * tt;
    b.life -= t;
    if (b.from === 'enemy') {
      if (insideWall(m, b.x, b.y, 0)) b.life = 0;
      if (b.life <= 0) continue;
      for (const a of m.allies) {
        if (!a.destroyed && dist(b, a) < a.r + b.r) {
          b.life = 0;
          allyDamage(m, a, 1);
          if (b.drive && m.jump && a.kind === 'capital') disruptDrive(m, BOMB_DISRUPT, 'Bomber hit on the drive core: jump charge lost!');
          break;
        }
      }
      continue;
    }
    // Player bolts: swept along the path travelled this step, so the result does not depend on the
    // frame rate. The first thing on the path (wall, enemy, boss or debris) takes the hit.
    const hit = firstHit(m, x0, y0, b.x, b.y, b.r);
    if (!hit) continue;
    b.life = 0;
    b.x = hit.x;
    b.y = hit.y;
    // Accuracy: bolts that struck a target (not walls or solid asteroids).
    const shooter = b.owner !== undefined ? m.ships[b.owner] : undefined;
    if (hit.kind === 'drone' || hit.kind === 'boss' || (hit.kind === 'rock' && hit.rock!.hp !== undefined)) {
      m.flags.shotsHit = (m.flags.shotsHit ?? 0) + 1;
      if (shooter) shooter.stats.shotsHit++;
    }
    if (hit.kind === 'drone' && m.linked && hit.drone!.tag === m.linked.tag && (!shooter || dist(shooter, hit.drone!) > m.linked.range)) {
      // Co-op synchronised strike: the shield only drops for a ship close by.
      m.events.push({ type: 'deflect', x: hit.x, y: hit.y });
    } else if (hit.kind === 'drone') {
      const d = hit.drone!;
      d.hp -= 1;
      d.lastHitBy = b.owner;
      if (d.regen) d.lastHitAt = m.time;
      d.hitFlash = 0.12;
      m.events.push({ type: 'enemy-hit', x: hit.x, y: hit.y });
    } else if (hit.kind === 'boss') {
      const boss = m.boss!;
      if (!boss.shielded) {
        boss.hp -= 1;
        boss.hitFlash = 0.1;
        m.score += 20;
        m.events.push({ type: 'enemy-hit', x: hit.x, y: hit.y });
      } else m.events.push({ type: 'deflect', x: hit.x, y: hit.y }); // the Guardian's shield stops it
    } else if (hit.kind === 'rock') {
      const r = hit.rock!;
      m.events.push({ type: 'enemy-hit', x: hit.x, y: hit.y });
      if (r.hp === undefined) continue; // solid asteroid: the bolt breaks on it
      r.hp -= 1;
      if (r.hp <= 0) {
        m.score += 60;
        m.events.push({ type: 'explode', x: r.x, y: r.y, big: false });
      }
    }
  }
  m.rocks = m.rocks.filter((r) => r.hp === undefined || r.hp > 0);
  for (const d of m.drones) {
    if (d.hp > 0) continue;
    if (d.gone) continue; // escaped: no explosion, no kill
    if (m.linked && d.tag === m.linked.tag) {
      // A linked target is an objective structure that may reboot: no kill or score for it (the strike pays out once).
      m.events.push({ type: 'explode', x: d.x, y: d.y, big: false });
      continue;
    }
    m.cleared++;
    if (d.hp <= -999) m.events.push({ type: 'explode', x: d.x, y: d.y, big: false });
    else {
      m.events.push({ type: 'explode', x: d.x, y: d.y, big: d.kind === 'hive' || d.kind === 'commander' });
      m.kills++;
      if (d.lastHitBy !== undefined && m.ships[d.lastHitBy]) m.ships[d.lastHitBy].stats.kills++;
      registerKill(m, d);
      if (d.kind === 'commander') m.flags.cmdKilled = 1;
    }
  }
  m.drones = m.drones.filter((d) => d.hp > 0);
  updateLinked(m);
  m.bullets = m.bullets.filter((b) => b.life > 0 && b.x > -40 && b.x < m.def.world.w + 40 && b.y > -40 && b.y < m.def.world.h + 40);
}

function updateBoss(m: MissionState, wdt: number): void {
  const b = m.boss!;
  b.hitFlash = Math.max(0, b.hitFlash - wdt);
  if (b.dying > 0) {
    b.dying = Math.max(0.001, b.dying - wdt); // fades out during the escape; stays "defeated"
    return;
  }
  if (b.hp <= 0) {
    b.dying = 1.6;
    b.beam = null;
    m.score += 2500;
    m.events.push({ type: 'explode', x: b.x, y: b.y, big: true });
    if (m.gravity && m.portal) {
      // The Guardian falls and the singularity collapses: escape to the portal.
      m.escaping = true;
      m.drones = [];
      m.bullets = m.bullets.filter((x) => x.from === 'player');
      openPortal(m);
      m.events.push({ type: 'escape' });
    } else win(m);
    return;
  }
  const phase = b.hp > b.maxHp * 0.66 ? 0 : b.hp > b.maxHp * 0.33 ? 1 : 2;
  if (phase !== b.phase) {
    // A new phase: the shield slams back up behind a full set of generators, and escorts join
    // (encounters 'escorts-1' and 'escorts-2').
    b.phase = phase;
    b.shielded = true;
    b.cycle = 0;
    raiseGenerators(m, 3);
    m.events.push({ type: 'boss-phase', phase });
  }
  // The shield is fed by real generators: it holds while any is up. Once they are all down the core is
  // exposed until the generators reboot.
  const openTime = [7, 6, 5.5][phase];
  if (b.shielded) {
    if (tagged(m, 'generator').length === 0 && (m.flags.generatorTotal ?? 0) > 0) {
      b.shielded = false;
      b.cycle = 0;
      m.events.push({ type: 'boss-vulnerable' });
    }
  } else {
    b.cycle += wdt;
    if (b.cycle >= openTime) {
      b.shielded = true;
      b.cycle = 0;
      raiseGenerators(m, phase === 0 ? 2 : 3);
      comms(m, 'Shield generators rebooting!', true);
    }
  }
  // Slow drift side to side.
  b.x = 500 + Math.sin(m.time * 0.4) * 160;

  // Beam: a telegraphed line from the boss that then sweeps.
  if (b.beam) {
    if (b.beam.warn > 0) b.beam.warn -= wdt;
    else {
      b.beam.fire -= wdt;
      b.beam.angle += b.beam.sweep * wdt;
      if (b.beam.fire <= 0) b.beam = null;
    }
  }

  if (!b.shielded) return; // it only attacks while shielded
  b.attackIn -= wdt;
  if (b.attackIn > 0) return;
  const s = nearestPilot(m, b);
  const toShip = Math.atan2(s.y - b.y, s.x - b.x);
  const pick = m.rng();
  if (phase >= 1 && pick < 0.4 && !b.beam) {
    b.beam = { angle: toShip - 0.5 * (pick < 0.2 ? 1 : -1), warn: 1.1, fire: 1.6, sweep: 0.62 * (pick < 0.2 ? 1 : -1) };
    m.events.push({ type: 'warn', x: b.x, y: b.y });
    b.attackIn = 3;
  } else if (phase === 2 && pick < 0.7) {
    // Ring burst with a gap aimed away from nothing in particular.
    const gap = m.rng() * Math.PI * 2;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      if (Math.abs(((a - gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.45) continue;
      m.bullets.push({ id: m.nextId++, x: b.x, y: b.y, vx: Math.cos(a) * 180, vy: Math.sin(a) * 180, r: 9, from: 'enemy', life: 6 });
    }
    m.events.push({ type: 'enemy-shoot', x: b.x, y: b.y });
    b.attackIn = 2.2;
  } else {
    // Aimed fan volley.
    const n = [3, 5, 5][phase];
    for (let i = 0; i < n; i++) {
      const a = toShip + (i - (n - 1) / 2) * 0.22;
      m.bullets.push({ id: m.nextId++, x: b.x, y: b.y + 40, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230, r: 9, from: 'enemy', life: 6 });
    }
    m.events.push({ type: 'enemy-shoot', x: b.x, y: b.y });
    b.attackIn = [1.8, 1.5, 1.3][phase];
  }
}

export const BEAM_LENGTH = 1300;
export const BEAM_HALF = 16;

/** Standing pilots within `r` of a point (solo: the ship, if it is there). */
const pilotsNear = (m: MissionState, at: Vec, r: number) => m.ships.filter((p) => p.online && !p.downed && dist(p, at) < r);

function updateObjectives(m: MissionState, dt: number, wdt: number): void {
  for (const c of m.cores) {
    if (!c.taken && pilotsNear(m, c, SHIP_R + 20).length) {
      c.taken = true;
      m.score += 150;
      m.events.push({ type: 'core', x: c.x, y: c.y });
    }
  }

  for (const g of m.gates) {
    if (g.passed) continue;
    const next = m.gates.find((x) => !x.passed);
    if (next === g && pilotsNear(m, g, g.r).length) {
      g.passed = true;
      m.score += 250;
      m.events.push({ type: 'gate', x: g.x, y: g.y });
    }
  }
  if (m.gates.length && m.gates.every((g) => g.passed)) openPortal(m);

  for (const r of m.reactors) {
    if (r.active) continue;
    // Charges while any pilot holds position in the ring (more pilots do not charge it faster).
    const inside = pilotsNear(m, r, r.r);
    for (const p of inside) p.stats.objectiveTime += dt;
    if (inside.length) r.charge = Math.min(1, r.charge + dt / REACTOR_TIME);
    else r.charge = Math.max(0, r.charge - dt * 0.5);
    if (r.charge >= 1) {
      r.active = true;
      m.score += 300;
      if (m.stability !== null) m.stability = Math.min(100, m.stability + 12);
      m.events.push({ type: 'reactor', x: r.x, y: r.y });
    }
  }

  // Orbital Collapse: hold on an emergency switch to open its blast door (in order).
  const sw = m.switches.find((w) => !w.active);
  if (sw) {
    const on = pilotsNear(m, sw, sw.r);
    for (const p of on) p.stats.objectiveTime += dt;
    if (on.length) sw.charge = Math.min(1, sw.charge + dt / 0.8);
    else sw.charge = Math.max(0, sw.charge - dt * 0.6);
    if (sw.charge >= 1) {
      sw.active = true;
      m.walls = m.walls.filter((w) => w !== sw.door);
      m.score += 250;
      m.events.push({ type: 'switch', x: sw.door.x + sw.door.w / 2, y: sw.door.y });
      comms(m, `Blast door ${sw.name} open.`);
    }
  }

  // Co-op uplinks: they charge only while every pad is held at the same moment, and drain otherwise.
  const up = m.uplink;
  if (up && !up.active) {
    const held = up.pads.map((pad) => pilotsNear(m, pad, pad.r));
    for (const on of held) for (const p of on) p.stats.objectiveTime += dt;
    if (held.every((on) => on.length > 0)) up.charge = Math.min(1, up.charge + dt / UPLINK_TIME);
    else up.charge = Math.max(0, up.charge - dt * 0.4); // leaving a pad loses the link
    if (up.charge >= 1) {
      up.active = true;
      m.score += 400;
      for (const pad of up.pads) m.events.push({ type: 'switch', x: pad.x, y: pad.y });
    }
  }

  // Reactor Meltdown: core stability falls; online reactors slow it, live turrets speed it up.
  if (m.stability !== null && m.status === 'playing') {
    const active = m.reactors.filter((r) => r.active).length;
    const turrets = m.drones.filter((d) => d.kind === 'turret').length;
    const drain = active === m.reactors.length ? 0.25 : 1.8 - 0.45 * active + 0.35 * turrets;
    m.stability = Math.max(0, m.stability - drain * wdt);
    if (m.stability < 30 && !m.flags.stabilityAlert) {
      m.flags.stabilityAlert = 1;
      comms(m, 'Core stability critical!', true);
    }
    if (m.stability <= 0) lose(m, 'The reactor core went critical');
  }
  if (m.reactors.length && m.reactors.every((r) => r.active)) openPortal(m);

  // The Last Jump: the drive charges in world time (raiders that hit the Meridian knock it back).
  if (m.jump && m.status === 'playing') {
    const full = m.jump.charge >= m.jump.duration;
    m.jump.charge = Math.min(m.jump.duration, m.jump.charge + wdt);
    if (!full && m.jump.charge >= m.jump.duration && m.def.phases[m.phase]?.id !== 'jump') comms(m, 'Jump drive fully charged. Clear the bombers so the Meridian can jump!', true);
  }

  // Singularity: the event horizon grows and the pull strengthens during the escape.
  if (m.escaping && m.gravity) {
    m.gravity.pull = Math.min(230, m.gravity.pull + wdt * 30);
    m.gravity.horizon += wdt * 36;
  }

  runPhases(m, wdt);
}

/** Advance the operation: when the current phase's goal is met, record it, announce it and start the next. */
function runPhases(m: MissionState, wdt: number): void {
  m.phaseTime += wdt;
  const phases = m.def.phases;
  // Several phases can resolve in one step (e.g. an escort that arrives the moment an ambush ends).
  for (let guard = 0; guard < phases.length && m.status === 'playing'; guard++) {
    const ph = phases[m.phase];
    if (!ph || !ph.done(m)) return;
    // The phase's own goal is met; it still waits on the encounters it names. One that has not started
    // yet (its trigger never came, e.g. the convoy got there first) starts as soon as no other fight it
    // waits on is in progress: a fight cannot be skipped, and they still come one at a time.
    const waiting = blockingEncounters(m, ph.clear);
    if (waiting.length) {
      startWaitingFight(m, ph.clear);
      return;
    }
    ph.complete?.(m);
    m.phasesDone.push(ph.title);
    m.phase++;
    m.score += 200;
    const next = phases[m.phase];
    m.events.push({ type: 'objective', done: ph.title, next: next?.title ?? null });
    if (!next) {
      win(m);
      return;
    }
    m.phaseTime = 0;
    next.enter?.(m);
  }
}

/** The waypoint escorted ships wait at while the current phase's encounters are still being fought, if any. */
function allyHold(m: MissionState): number | null {
  const ph = m.def.phases[m.phase];
  if (!ph || ph.holdAllies === undefined || !blockingEncounters(m, ph.clear).length) return null;
  return ph.holdAllies;
}

function updateAllies(m: MissionState, wdt: number): void {
  const hold = allyHold(m);
  if (hold !== null) {
    // Everyone still under way is waiting at the hold point: the fight they wait for must happen now,
    // even if its own trigger has not come (otherwise the escort could wait forever).
    const moving = m.allies.filter((a) => !a.destroyed && !a.arrived && a.path.length);
    if (moving.length && moving.every((a) => a.pathIdx >= hold)) startWaitingFight(m, m.def.phases[m.phase].clear);
  }
  for (const a of m.allies) {
    a.hitFlash = Math.max(0, a.hitFlash - wdt);
    if (a.destroyed || a.arrived || !a.path.length) continue;
    if (hold !== null && a.pathIdx >= hold) {
      if (!m.flags[`held${m.phase}`]) {
        m.flags[`held${m.phase}`] = 1;
        comms(m, `${a.name} is holding position until the attackers are cleared.`, true);
      }
      continue;
    }
    const wp = a.path[a.pathIdx];
    const dx = wp.x - a.x;
    const dy = wp.y - a.y;
    const d = Math.hypot(dx, dy);
    const step = a.speed * wdt;
    if (d <= step + 1) {
      a.x = wp.x;
      a.y = wp.y;
      a.pathIdx++;
      if (a.pathIdx >= a.path.length) a.arrived = true;
    } else {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
    }
  }
}

/** The Rescue: tow pods with the tractor beam (two at a time) into the rescue ship's bay. */
function updatePods(m: MissionState, dt: number): void {
  if (!m.pods.length) return;
  const towing = (q: Pilot) => m.pods.filter((x) => x.state === 'towed' && (x.towedBy ?? 0) === q.slot).length;
  for (const p of m.pods) {
    if (p.state === 'drifting') {
      if (!p.found && pilotsNear(m, p, 330).length) {
        p.found = true;
        m.events.push({ type: 'comms', text: `Escape pod located · ${m.pods.filter((x) => x.found).length}/${m.pods.length}`, alert: false });
      }
      p.x += Math.sin(m.time * 0.7 + p.id) * 8 * dt;
      p.y += Math.cos(m.time * 0.5 + p.id) * 8 * dt;
      // Each pilot's tractor beam holds up to TOW_MAX pods.
      const tug = pilotsNear(m, p, SHIP_R + 24).find((q) => towing(q) < TOW_MAX);
      // The data core is a full load: only a pilot with nothing in tow can take it, and then nothing else.
      const free = tug && (!p.heavy || towing(tug) === 0) && !carrying(m, tug);
      if (tug && free) {
        p.state = 'towed';
        p.towedBy = tug.slot;
        if (p.heavy && !m.flags.coreTowed) {
          m.flags.coreTowed = 1;
          comms(m, 'Data core secured. It is draining your ship: no blaster while you carry it. Escort the carrier to the uplink bay!', true);
        }
        p.found = true;
        m.score += 100;
        m.events.push({ type: 'pod-tow', x: p.x, y: p.y });
      }
    }
  }
  // Each towed pod trails the one in front of it on a short tether, starting from its pilot.
  const leaders = new Map<number, Vec>(m.ships.map((q) => [q.slot, q]));
  for (const q of m.ships) if (towing(q) > 0) q.stats.objectiveTime += dt;
  for (const p of m.pods) {
    if (p.state !== 'towed') continue;
    const slot = p.towedBy ?? 0;
    const leader = leaders.get(slot) ?? m.ship;
    const dx = leader.x - p.x;
    const dy = leader.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const slack = 36;
    if (d > slack) {
      p.x += (dx / d) * (d - slack) * Math.min(1, dt * 8);
      p.y += (dy / d) * (d - slack) * Math.min(1, dt * 8);
    }
    leaders.set(slot, p);
    const z = m.rescueZone;
    if (z && dist(p, z) < z.r && !m.flags.bayLocked) {
      p.state = 'saved';
      m.score += 300;
      m.events.push({ type: 'pod-saved', x: p.x, y: p.y });
    }
  }
}

/** Shield, overdrive and repair pickups: occasional, in fair spots, only when they would help. */
function updatePower(m: MissionState, dt: number): void {
  const pw = m.power;
  pw.overdrive = Math.max(0, pw.overdrive - dt);
  if (pw.pickup) {
    pw.pickup.life -= dt;
    if (pw.pickup.life <= 0) {
      pw.pickup = null;
      pw.nextSpawn = m.time + POWER_EVERY * 0.6;
    } else if (pilotsNear(m, pw.pickup, SHIP_R + 22).length) {
      // Shield and overdrive cover the squadron; a repair goes to the pilot who picked it up.
      const taker = pilotsNear(m, pw.pickup, SHIP_R + 22)[0];
      const k = pw.pickup.kind;
      if (k === 'shield') pw.shield = true;
      else if (k === 'overdrive') pw.overdrive = OVERDRIVE_TIME;
      else taker.hp = Math.min(m.def.maxHp, taker.hp + 1);
      m.events.push({ type: 'power-on', kind: k, x: pw.pickup.x, y: pw.pickup.y });
      pw.pickup = null;
      pw.nextSpawn = m.time + POWER_EVERY;
    }
    return;
  }
  if (m.time < pw.nextSpawn || m.status !== 'playing') return;
  const options: PowerKind[] = [];
  if (!pw.shield) options.push('shield');
  if (m.def.weapons) options.push('overdrive', 'overdrive');
  if (standing(m).some((p) => p.hp < m.def.maxHp)) options.push('repair', 'repair');
  if (!options.length) {
    pw.nextSpawn = m.time + 5;
    return;
  }
  const spot = fairSpot(m, m.rng, m.ships.length > 1 ? squadFocus(m) : m.ship, 160, 380);
  if (!spot || (m.chrono.pickup && dist(spot, m.chrono.pickup) < 120)) {
    pw.nextSpawn = m.time + 2;
    return;
  }
  const kind = options[Math.floor(m.rng() * options.length)];
  pw.pickup = { kind, x: spot.x, y: spot.y, life: POWER_LIFE };
  m.events.push({ type: 'power-spawn', kind, x: spot.x, y: spot.y });
}

function updateChrono(m: MissionState, dt: number): void {
  const c = m.chrono;
  if (c.pickup) {
    c.pickup.life -= dt;
    if (c.pickup.life <= 0) {
      c.pickup = null;
      c.nextSpawn = m.time + CHRONO_EVERY * 0.6;
    } else if (pilotsNear(m, c.pickup, SHIP_R + 22).length) {
      // A pickup collected while already active refreshes the timer; it never stacks.
      c.active = CHRONO_DURATION;
      c.used += 1;
      m.events.push({ type: 'chrono-on', x: c.pickup.x, y: c.pickup.y });
      c.pickup = null;
      c.nextSpawn = m.time + CHRONO_EVERY;
    }
    return;
  }
  if (c.active > 0 || m.time < c.nextSpawn) return;
  const spot = fairSpot(m, m.rng, m.ships.length > 1 ? squadFocus(m) : m.ship, 180, 420);
  if (!spot) {
    c.nextSpawn = m.time + 2;
    return;
  }
  c.pickup = { x: spot.x, y: spot.y, life: CHRONO_LIFE };
  m.events.push({ type: 'chrono-spawn', x: spot.x, y: spot.y });
}

function checkHazards(m: MissionState): void {
  for (const s of m.ships) {
    if (m.status !== 'playing') return;
    if (s.online && !s.downed) pilotHazards(m, s);
  }
}

function pilotHazards(m: MissionState, s: Pilot): void {
  const coop = m.ships.length > 1;
  for (const r of m.rocks) {
    const d = dist(s, r);
    if (d < r.r + SHIP_R - 3) damage(m, s, r, 'Hull breached by debris');
    else if (d < r.r + SHIP_R + 14 && s.invuln === 0 && !r.grazed) {
      // Near miss: a skill bonus, once per rock per pass.
      r.grazed = true;
      m.nearMisses++;
      m.score += Math.round(40 * comboMult(m.combo.count));
      m.events.push(coop ? { type: 'near', x: s.x, y: s.y, slot: s.slot } : { type: 'near', x: s.x, y: s.y });
    } else if (d > r.r + SHIP_R + 60) r.grazed = false;
  }
  for (const b of m.barriers) {
    if (barrierState(b, m.time) === 'on' && segDist(s, b) < SHIP_R + 4) damage(m, s, { x: s.x, y: s.y + 1 }, 'Burned by an energy barrier');
  }
  for (const d of m.drones) {
    if (d.spawnIn === 0 && dist(s, d) < SHIP_R + 16) {
      damage(m, s, d, d.kind === 'raider' ? 'Rammed by an alien raider' : d.kind === 'turret' ? 'Flew into a defence turret' : 'Rammed by a hunter drone');
      if (d.kind === 'scout' || d.kind === 'raider') {
        d.hp = 0;
        d.lastHitBy = s.slot; // destroyed against this pilot's hull: their kill
      }
    }
  }
  for (const b of m.bullets) {
    if (b.from === 'enemy' && b.life > 0 && dist(s, b) < b.r + SHIP_R - 2) {
      b.life = 0;
      damage(m, s, b, 'Shot down');
    }
  }
  m.pulses.forEach((p) => {
    if (p.warn > 0) return;
    const d = Math.hypot(s.x - 500, s.y - 500);
    if (Math.abs(d - p.r) > PULSE_BAND + SHIP_R) return;
    const a = Math.atan2(s.y - 500, s.x - 500);
    const off = Math.abs(((a - p.gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (off > PULSE_GAP) damage(m, s, { x: 500, y: 500 }, 'Caught in a heat pulse');
  });
  if (m.boss?.beam && m.boss.beam.warn <= 0) {
    const b = m.boss;
    const a = b.beam!.angle;
    const ex = b.x + Math.cos(a) * BEAM_LENGTH;
    const ey = b.y + Math.sin(a) * BEAM_LENGTH;
    if (segDist(s, { x1: b.x, y1: b.y, x2: ex, y2: ey, period: 1, on: 1, offset: 0 }) < BEAM_HALF + SHIP_R) damage(m, s, b, 'Cut down by the Guardian’s beam');
  }
  if (m.boss && m.boss.dying === 0 && dist(s, m.boss) < 80 + SHIP_R) damage(m, s, m.boss, 'Crushed against the Guardian');
  if (m.collapseY !== null && s.y + SHIP_R > m.collapseY) destroy(m, s, 'Swallowed by the collapse');
  if (m.gravity && dist(s, m.gravity) < m.gravity.horizon + SHIP_R) destroy(m, s, 'Pulled past the event horizon');
}

export function isChronoActive(m: MissionState): boolean {
  return m.chrono.active > 0;
}
