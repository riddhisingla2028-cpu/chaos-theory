// Mission simulation for the spacecraft campaign. Pure and deterministic (seeded RNG, no DOM),
// so every objective, failure and power-up rule is unit tested. Rendering lives in render.ts.
//
// World units: worlds are 1000 wide (some much taller); the camera shows a 720 x 720 window and
// follows the ship in both directions. Time: `step` takes real seconds. The ship always moves in real time; the rest
// of the world moves in "world time", which runs slower during CHRONO SHIFT.

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
  | { type: 'hit'; x: number; y: number }
  | { type: 'near'; x: number; y: number }
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
  | { type: 'shield-block'; x: number; y: number }
  | { type: 'combo'; count: number; mult: number; x: number; y: number }
  | { type: 'jump'; x: number; y: number }
  | { type: 'escape' }
  | { type: 'comms'; text: string; alert: boolean }
  | { type: 'objective'; done: string; next: string | null }
  | { type: 'switch'; x: number; y: number }
  | { type: 'deflect'; x: number; y: number }
  | { type: 'won' }
  | { type: 'lost'; reason: string };

export interface Secondary {
  id: string;
  text: string;
}

export interface MissionDef {
  id: MissionId;
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
}

export interface MissionState {
  def: MissionDef;
  seed: number;
  rng: () => number;
  status: MissionStatus;
  failReason: string | null;
  realTime: number;
  time: number; // world time
  ship: { x: number; y: number; vx: number; vy: number; angle: number; hp: number; invuln: number; fireCd: number; thrust: number };
  camX: number; // left of the visible VIEW x VIEW window
  camY: number; // top of the visible window
  walls: Wall[];
  barriers: Barrier[];
  rocks: Rock[];
  rockSpawn: { every: number; next: number; speed: number; fromTop: boolean } | null;
  drones: Drone[];
  waves: { spawn: { kind: DroneKind; x: number; y: number }[] }[]; // each wave arrives when the previous one is cleared
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
  spawner: { every: number; next: number; kinds: DroneKind[]; maxAlive: number; edge: 'top' | 'sides' | 'around' } | null;
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
const inPortal = (m: MissionState) => !!m.portal?.open && dist(m.ship, m.portal) < m.portal.r - 6;
const pct = (k: number) => `${Math.round(Math.max(0, Math.min(1, k)) * 100)}%`;
const living = (m: MissionState) => m.allies.filter((a) => !a.destroyed);
/** How far the slowest surviving escorted ship has got along its route (0..1). */
const convoyProgress = (m: MissionState) => {
  const l = living(m);
  return l.length ? Math.min(...l.map((a) => (a.arrived ? 1 : a.path.length ? a.pathIdx / a.path.length : 1))) : 0;
};
/** Spawn a group of enemies for an objective; the objective counts them down by tag. */
function spawnTagged(m: MissionState, tag: string, kind: DroneKind, spots: Vec[], ally?: Ally): void {
  for (const p of spots) {
    const d = spawnDrone(m, kind, Math.max(40, Math.min(m.def.world.w - 40, p.x)), Math.max(40, Math.min(m.def.world.h - 40, p.y)));
    d.tag = tag;
    if (ally) d.targetAlly = ally.id;
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
    view: (m) => ({ text: 'Hold the line around the Aegis', progress: Math.min(1, m.cleared / 7), count: `${Math.min(7, m.cleared)}/7` }),
    done: (m) => m.waves.length === 0 && m.drones.every((d) => STATIONARY.includes(d.kind)) && m.phaseTime > 0.5,
  },
  {
    id: 'hive',
    title: 'Destroy the hive carrier',
    enter: (m) => {
      spawnTagged(m, 'hive', 'hive', [{ x: 500, y: 320 }]);
      m.flags.hiveNext = 2.5;
      comms(m, 'Contact! A hive carrier is launching the swarm. Destroy it before it overwhelms the Aegis!', true);
    },
    view: (m) => {
      const h = tagged(m, 'hive')[0];
      return { text: 'Destroy the hive carrier', progress: h ? 1 - h.hp / h.maxHp : 1, count: h ? `${h.hp}/${h.maxHp}` : null };
    },
    done: (m) => tagged(m, 'hive').length === 0,
    complete: (m) => comms(m, 'Hive carrier destroyed. Mop up the survivors.'),
  },
  {
    id: 'mop',
    title: 'Clear the remaining attackers',
    view: (m) => ({ text: 'Clear the remaining attackers', progress: m.drones.length ? 0.5 : 1, count: `${m.drones.length} left` }),
    done: (m) => m.drones.length === 0,
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
  },
  {
    id: 'commander',
    title: 'Intercept the command raider',
    enter: (m) => {
      const k = living(m)[0];
      const x = k && k.x > 500 ? 120 : 880;
      spawnTagged(m, 'commander', 'commander', [{ x, y: m.camY + 90 }], k);
      m.flags.cmdEscapeAt = m.time + 22;
      comms(m, 'Command raider detected, directing the raids. Take it down before it escapes!', true);
    },
    view: (m) => {
      const c = tagged(m, 'commander')[0];
      return { text: c ? 'Destroy the command raider' : 'Command raider gone', progress: c ? 1 - c.hp / c.maxHp : 1, count: c ? `${c.hp}/${c.maxHp}` : null };
    },
    done: (m) => tagged(m, 'commander').length === 0,
    complete: (m) => {
      if (m.flags.cmdKilled) {
        comms(m, 'Command raider down. The raids are breaking up.');
        if (m.spawner) m.spawner.every *= 1.3;
      } else {
        comms(m, 'The command raider escaped. Expect heavier raids.', true);
        if (m.spawner) m.spawner.every *= 0.8;
      }
    },
  },
  {
    id: 'gate',
    title: 'Reach the jump gate',
    view: (m) => ({ text: 'Get the Kestrel through the jump gate', progress: convoyProgress(m), count: pct(convoyProgress(m)) }),
    done: (m) => living(m).length >= m.alliesNeeded && living(m).every((a) => a.arrived),
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
      const z = m.rescueZone!;
      spawnTagged(m, 'boarders', 'scout', [
        { x: z.x - 280, y: z.y - 260 },
        { x: z.x + 280, y: z.y - 260 },
        { x: z.x, y: z.y - 420 },
      ]);
      m.flags.bayLocked = 1;
      comms(m, 'Raiders closing on the rescue ship! The bay is sealed until they are destroyed.', true);
    },
    view: (m) => ({ text: 'Secure the rescue area · bay sealed', progress: killedOf(m, 'boarders') / 3, count: `${killedOf(m, 'boarders')}/3` }),
    done: (m) => tagged(m, 'boarders').length === 0,
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
    done: (m) => !!m.rescueZone && dist(m.ship, m.rescueZone) < m.rescueZone.r,
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
  },
  {
    id: 'ambush',
    title: 'Break the ambush',
    enter: (m) => {
      const l = living(m);
      const lead = l.reduce((a, b) => (b.y < a.y ? b : a), l[0]);
      spawnTagged(
        m,
        'ambush',
        'gunner',
        [-260, 0, 260].map((dx) => ({ x: lead.x + dx, y: lead.y - 380 })),
        undefined,
      );
      for (const d of tagged(m, 'ambush')) d.targetAlly = l[Math.floor(m.rng() * l.length)].id;
      comms(m, 'Ambush! Gunships ahead of the convoy.', true);
    },
    view: (m) => ({ text: 'Break the ambush', progress: killedOf(m, 'ambush') / 3, count: `${killedOf(m, 'ambush')}/3` }),
    done: (m) => tagged(m, 'ambush').length === 0,
    complete: (m) => comms(m, 'Ambush broken. Get the haulers to the relay.'),
  },
  {
    id: 'deliver',
    title: 'Deliver the convoy',
    view: (m) => ({ text: `Deliver the haulers to the relay · ${living(m).length}/${m.allies.length}`, progress: convoyProgress(m), count: pct(convoyProgress(m)) }),
    done: (m) => living(m).length >= m.alliesNeeded && living(m).every((a) => a.arrived),
    complete: escortArrived,
  },
];

const P_LAST_JUMP: Phase[] = [
  {
    id: 'hold',
    title: 'Hold the line',
    view: (m) => ({ text: 'Protect the Meridian · jump drive charging', progress: m.jump!.charge / m.jump!.duration, count: pct(m.jump!.charge / m.jump!.duration) }),
    done: (m) => m.jump!.charge >= m.jump!.duration / 2,
  },
  {
    id: 'bombers',
    title: 'Destroy the bomber wing',
    enter: (m) => {
      const cap = living(m)[0];
      spawnTagged(m, 'bombers', 'gunner', [
        { x: 80, y: 120 },
        { x: 920, y: 120 },
        { x: 500, y: 60 },
      ], cap);
      comms(m, 'Bomber wing inbound, targeting the Meridian’s drive core!', true);
    },
    view: (m) => ({ text: 'Destroy the bomber wing', progress: killedOf(m, 'bombers') / 3, count: `${killedOf(m, 'bombers')}/3` }),
    done: (m) => tagged(m, 'bombers').length === 0,
  },
  {
    id: 'jump',
    title: 'Protect the Meridian until the jump',
    view: (m) => ({ text: 'Protect the Meridian until it jumps', progress: m.jump!.charge / m.jump!.duration, count: pct(m.jump!.charge / m.jump!.duration) }),
    done: (m) => m.jump!.charge >= m.jump!.duration,
    complete: (m) => {
      for (const a of living(m)) m.score += Math.round(800 * (a.hp / a.maxHp));
      const cap = living(m)[0];
      m.events.push({ type: 'jump', x: cap?.x ?? 500, y: cap?.y ?? 500 });
    },
  },
];

function escortArrived(m: MissionState): void {
  const l = living(m);
  for (const a of l) m.score += Math.round(400 * (a.hp / a.maxHp));
  if (l[0]) m.events.push({ type: 'jump', x: l[0].x, y: l[0].y });
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
    build(m) {
      m.ship.x = 500;
      m.ship.y = 820;
      m.walls = [
        { x: 200, y: 470, w: 90, h: 90 },
        { x: 710, y: 470, w: 90, h: 90 },
      ];
      m.waves = [
        { spawn: [{ kind: 'scout', x: 200, y: 180 }, { kind: 'raider', x: 500, y: 120 }, { kind: 'scout', x: 800, y: 180 }] },
        { spawn: [{ kind: 'gunner', x: 160, y: 300 }, { kind: 'gunner', x: 840, y: 300 }, { kind: 'raider', x: 120, y: 120 }, { kind: 'raider', x: 880, y: 120 }] },
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
      spawnDrone(m, 'turret', 90, 620);
      spawnDrone(m, 'turret', 910, 620);
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
    build(m) {
      m.ship.x = 400;
      m.ship.y = 2260;
      const path = [{ x: 500, y: 1950 }, { x: 360, y: 1550 }, { x: 620, y: 1150 }, { x: 430, y: 720 }, { x: 500, y: 240 }];
      m.allies = [ally(m, 'transport', 'Transport Kestrel', 500, 2250, 16, 34, path, 58)];
      m.alliesNeeded = 1;
      m.spawner = { every: 2.3, next: 3, kinds: ['raider', 'raider', 'scout', 'gunner'], maxAlive: 6, edge: 'around' };
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
      m.waves = [{ spawn: [{ kind: 'scout', x: 160, y: 500 }, { kind: 'scout', x: 840, y: 260 }] }];
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
      m.spawner = { every: 2, next: 3, kinds: ['raider', 'raider', 'gunner', 'scout', 'raider'], maxAlive: 7, edge: 'around' };
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
    build(m) {
      m.ship.x = 500;
      m.ship.y = 830;
      m.allies = [ally(m, 'capital', 'Capital ship Meridian', 500, 560, 90, 70, [], 0)];
      m.alliesNeeded = 1;
      m.jump = { charge: 0, duration: 70 };
      m.spawner = { every: 3, next: 2, kinds: ['raider', 'gunner', 'raider', 'scout'], maxAlive: 7, edge: 'around' };
    },
  },
];

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

export function createMission(def: MissionDef, seed = 1): MissionState {
  const m: MissionState = {
    def,
    seed,
    rng: mulberry32(seed),
    status: 'playing',
    failReason: null,
    realTime: 0,
    time: 0,
    ship: { x: def.world.w / 2, y: def.world.h - 150, vx: 0, vy: 0, angle: -Math.PI / 2, hp: def.maxHp, invuln: 1, fireCd: 0, thrust: 0 },
    camX: 0,
    camY: 0,
    walls: [],
    barriers: [],
    rocks: [],
    rockSpawn: null,
    drones: [],
    waves: [],
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
    spawner: null,
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
    flags: {},
    events: [],
    nextId: 1,
  };
  def.build(m, m.rng);
  def.phases[0]?.enter?.(m);
  m.camX = clampCamX(m, m.ship.x - VIEW / 2);
  m.camY = clampCam(m, m.ship.y - VIEW * 0.6);
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
}

/** What the HUD shows: the current phase of the operation, its progress, and any countdown. */
export function objectiveView(m: MissionState): ObjectiveView {
  const phases = m.def.phases;
  const i = Math.min(m.phase, phases.length - 1);
  const v = phases[i].view(m);
  return { ...v, phase: i + 1, phases: phases.length, title: phases[i].title, timer: missionTimer(m) };
}

function missionTimer(m: MissionState): ObjectiveView['timer'] {
  if (m.stability !== null) return { label: 'Core stability', value: `${Math.max(0, Math.ceil(m.stability))}%`, urgent: m.stability < 30 };
  if (m.collapseY !== null) {
    const gap = Math.max(0, Math.round(m.collapseY - m.ship.y));
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
  const hullBonus = m.ship.hp * 150;
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

function damage(m: MissionState, from: Vec, reason: string): void {
  const s = m.ship;
  if (s.invuln > 0 || m.status !== 'playing') return;
  if (m.power.shield) {
    // The shield power-up absorbs one hit.
    m.power.shield = false;
    s.invuln = 0.6;
    m.events.push({ type: 'shield-block', x: s.x, y: s.y });
    return;
  }
  s.hp -= 1;
  m.hitsTaken += 1;
  s.invuln = INVULN;
  // Knock the ship away from what hit it.
  const d = Math.hypot(s.x - from.x, s.y - from.y) || 1;
  s.vx += ((s.x - from.x) / d) * 380;
  s.vy += ((s.y - from.y) / d) * 380;
  m.events.push({ type: 'hit', x: s.x, y: s.y });
  if (s.hp <= 0) lose(m, reason);
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

const TIMEOUT_REASON: Partial<Record<MissionId, string>> = {
  meltdown: 'The reactor core went critical',
  rescue: 'Life support on the escape pods ran out',
};

/** Advance the mission by `dt` real seconds. */
export function stepMission(m: MissionState, input: MissionInput, dt: number): void {
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

  moveShip(m, input, dt);
  updateCamera(m, dt);
  updateWorld(m, wdt);
  updateAllies(m, wdt);
  updateSpawner(m, wdt);
  updateCombat(m, dt, wdt, !!input.fire, !!input.assist);
  updatePods(m, dt);
  updateObjectives(m, dt, wdt);
  updateChrono(m, dt);
  updatePower(m, dt);
  checkHazards(m);
  m.combo.timer = Math.max(0, m.combo.timer - dt);
  if (m.combo.timer === 0) m.combo.count = 0;
  if (m.def.timeLimit !== null && m.time >= m.def.timeLimit && m.status === 'playing') lose(m, TIMEOUT_REASON[m.def.id] ?? 'Out of time');
}

function moveShip(m: MissionState, input: MissionInput, dt: number): void {
  const s = m.ship;
  const len = Math.hypot(input.x || 0, input.y || 0);
  const ix = len > 1 ? input.x / len : input.x || 0;
  const iy = len > 1 ? input.y / len : input.y || 0;
  const k = Math.min(1, dt * SHIP_RESPONSE);
  s.vx += (ix * SHIP_SPEED - s.vx) * k;
  s.vy += (iy * SHIP_SPEED - s.vy) * k;
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
  const k = Math.min(1, dt * 6);
  m.camX += (clampCamX(m, m.ship.x - VIEW / 2) - m.camX) * k;
  m.camY += (clampCam(m, m.ship.y - VIEW * 0.6) - m.camY) * k;
}

/** Where the current objective is, for the off-screen pointer. */
export function objectiveTarget(m: MissionState): Vec | null {
  const near = <T extends Vec>(xs: T[]) => xs.sort((a, b) => dist(a, m.ship) - dist(b, m.ship))[0] ?? null;
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
function aimSolution(m: MissionState, assist: boolean): { angle: number; target: number | null } {
  const s = m.ship;
  const straight = { angle: s.angle, target: lineOfFire(m, s.angle) };
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
    let off = Math.abs(a - s.angle);
    off = Math.min(off, Math.PI * 2 - off);
    if (off > ASSIST_CONE) continue;
    // Only if the straightened shot really reaches this target first (no wall or other body in the way).
    if (lineOfFire(m, a) !== c.id) continue;
    if (!best || off < best.off) best = { angle: a, target: c.id, off };
  }
  return best ?? straight;
}

/** What a bolt fired now along `angle` would hit (within range): the HUD's "in your sights" target. */
function lineOfFire(m: MissionState, angle: number): number | null {
  const s = m.ship;
  const mx = s.x + Math.cos(s.angle) * MUZZLE;
  const my = s.y + Math.sin(s.angle) * MUZZLE;
  const h = firstHit(m, mx, my, mx + Math.cos(angle) * FIRE_RANGE, my + Math.sin(angle) * FIRE_RANGE, BOLT_R);
  if (!h || h.kind === 'wall') return null;
  if (h.kind === 'rock' && h.rock!.hp === undefined) return null; // an indestructible asteroid is in the way
  return h.kind === 'drone' ? h.drone!.id : h.kind === 'boss' ? -1 : -2 - h.rock!.id;
}

function updateCombat(m: MissionState, dt: number, wdt: number, fire: boolean, assist: boolean): void {
  const s = m.ship;
  // Enemy waves arrive when the previous wave is cleared (turrets do not hold up the next wave).
  if (m.waves.length && m.drones.every((d) => STATIONARY.includes(d.kind))) {
    const wave = m.waves.shift()!;
    for (const sp of wave.spawn) spawnDrone(m, sp.kind, sp.x, sp.y);
  }

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
          m.bullets.push({ id: m.nextId++, x: d.x, y: d.y, vx: Math.cos(a) * ENEMY_BOLT_SPEED, vy: Math.sin(a) * ENEMY_BOLT_SPEED, r: 9, from: 'enemy', life: 5 });
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
      if (m.jump && victim.kind === 'capital') {
        // Impacts disrupt the jump drive and knock its charge back.
        m.jump.charge = Math.max(0, m.jump.charge - 1.5);
        if (m.time - (m.flags.disruptAt ?? -99) > 4) comms(m, 'Impact on the Meridian: jump drive charge disrupted!', true);
        m.flags.disruptAt = m.time;
      }
      d.hp = -999; // destroyed in the impact; not counted as a kill
    }
  }

  // Boss
  if (m.boss) updateBoss(m, wdt);

  // Player blaster: fires only when the player asks, straight ahead along the ship's heading, from
  // the muzzle at the nose. Overdrive halves the cooldown. Nothing is auto-aimed.
  s.fireCd = Math.max(0, s.fireCd - dt);
  const aim = m.def.weapons ? aimSolution(m, assist) : null;
  m.target = aim ? aim.target : null;
  if (m.def.weapons && fire && s.fireCd === 0 && aim) {
    s.fireCd = m.power.overdrive > 0 ? FIRE_EVERY / 2 : FIRE_EVERY;
    const mx = s.x + Math.cos(s.angle) * MUZZLE;
    const my = s.y + Math.sin(s.angle) * MUZZLE;
    const ux = Math.cos(aim.angle);
    const uy = Math.sin(aim.angle);
    m.bullets.push({ id: m.nextId++, x: mx, y: my, vx: ux * BOLT_SPEED, vy: uy * BOLT_SPEED, r: BOLT_R, from: 'player', life: FIRE_RANGE / BOLT_SPEED });
    m.events.push({ type: 'shoot', x: mx, y: my, angle: aim.angle });
    m.flags.shots = (m.flags.shots ?? 0) + 1;
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
    if (hit.kind === 'drone' || hit.kind === 'boss' || (hit.kind === 'rock' && hit.rock!.hp !== undefined)) m.flags.shotsHit = (m.flags.shotsHit ?? 0) + 1;
    if (hit.kind === 'drone') {
      const d = hit.drone!;
      d.hp -= 1;
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
    m.cleared++;
    if (d.hp <= -999) m.events.push({ type: 'explode', x: d.x, y: d.y, big: false });
    else {
      m.events.push({ type: 'explode', x: d.x, y: d.y, big: d.kind === 'hive' || d.kind === 'commander' });
      m.kills++;
      registerKill(m, d);
      if (d.kind === 'commander') m.flags.cmdKilled = 1;
    }
  }
  m.drones = m.drones.filter((d) => d.hp > 0);
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
    // A new phase: the shield slams back up behind a full set of generators, and escorts join.
    b.phase = phase;
    b.shielded = true;
    b.cycle = 0;
    raiseGenerators(m, 3);
    m.events.push({ type: 'boss-phase', phase });
    if (phase >= 1) {
      spawnDrone(m, 'scout', 200, 200);
      spawnDrone(m, 'scout', 800, 200);
    }
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
  const s = m.ship;
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

function updateObjectives(m: MissionState, dt: number, wdt: number): void {
  const s = m.ship;
  for (const c of m.cores) {
    if (!c.taken && dist(s, c) < SHIP_R + 20) {
      c.taken = true;
      m.score += 150;
      m.events.push({ type: 'core', x: c.x, y: c.y });
    }
  }

  for (const g of m.gates) {
    if (g.passed) continue;
    const next = m.gates.find((x) => !x.passed);
    if (next === g && dist(s, g) < g.r) {
      g.passed = true;
      m.score += 250;
      m.events.push({ type: 'gate', x: g.x, y: g.y });
    }
  }
  if (m.gates.length && m.gates.every((g) => g.passed)) openPortal(m);

  for (const r of m.reactors) {
    if (r.active) continue;
    if (dist(s, r) < r.r) r.charge = Math.min(1, r.charge + dt / REACTOR_TIME);
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
    if (dist(s, sw) < sw.r) sw.charge = Math.min(1, sw.charge + dt / 0.8);
    else sw.charge = Math.max(0, sw.charge - dt * 0.6);
    if (sw.charge >= 1) {
      sw.active = true;
      m.walls = m.walls.filter((w) => w !== sw.door);
      m.score += 250;
      m.events.push({ type: 'switch', x: sw.door.x + sw.door.w / 2, y: sw.door.y });
      comms(m, `Blast door ${sw.name} open.`);
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

function updateAllies(m: MissionState, wdt: number): void {
  for (const a of m.allies) {
    a.hitFlash = Math.max(0, a.hitFlash - wdt);
    if (a.destroyed || a.arrived || !a.path.length) continue;
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

/** Continuous enemy raids (escort and defence missions): from just outside the view, capped. */
function updateSpawner(m: MissionState, wdt: number): void {
  const sp = m.spawner;
  if (!sp || m.status !== 'playing') return;
  sp.next -= wdt;
  if (sp.next > 0) return;
  const heat = m.jump ? m.jump.charge / m.jump.duration : 0;
  sp.next = sp.every * (1 - 0.5 * heat) * (0.8 + m.rng() * 0.4);
  // Raids come in groups that grow with the pressure (and the further an escort has got).
  const progress = Math.max(heat, ...m.allies.map((al) => (al.path.length ? al.pathIdx / al.path.length : 0)));
  const group = 1 + (progress > 0.35 ? 1 : 0) + (m.rng() < 0.25 + progress * 0.4 ? 1 : 0);
  const a0 = m.rng() * Math.PI * 2;
  for (let k = 0; k < group; k++) {
    if (m.drones.length >= sp.maxAlive + Math.round(progress * 3)) return;
    const kind = sp.kinds[Math.floor(m.rng() * sp.kinds.length)];
    const a = a0 + (k - (group - 1) / 2) * 0.35;
    const cx = m.camX + VIEW / 2;
    const cy = m.camY + VIEW / 2;
    const x = Math.max(30, Math.min(m.def.world.w - 30, cx + Math.cos(a) * VIEW * 0.62));
    const y = Math.max(30, Math.min(m.def.world.h - 30, cy + Math.sin(a) * VIEW * 0.62));
    spawnDrone(m, kind, x, y);
  }
}

/** The Rescue: tow pods with the tractor beam (two at a time) into the rescue ship's bay. */
function updatePods(m: MissionState, dt: number): void {
  if (!m.pods.length) return;
  const s = m.ship;
  let leader: Vec = s;
  for (const p of m.pods) {
    if (p.state === 'drifting') {
      if (!p.found && dist(s, p) < 330) {
        p.found = true;
        m.events.push({ type: 'comms', text: `Escape pod located · ${m.pods.filter((x) => x.found).length}/${m.pods.length}`, alert: false });
      }
      p.x += Math.sin(m.time * 0.7 + p.id) * 8 * dt;
      p.y += Math.cos(m.time * 0.5 + p.id) * 8 * dt;
      if (dist(s, p) < SHIP_R + 24 && m.pods.filter((x) => x.state === 'towed').length < TOW_MAX) {
        p.state = 'towed';
        p.found = true;
        m.score += 100;
        m.events.push({ type: 'pod-tow', x: p.x, y: p.y });
      }
    }
  }
  for (const p of m.pods) {
    if (p.state !== 'towed') continue;
    // Each towed pod trails the one in front of it on a short tether.
    const dx = leader.x - p.x;
    const dy = leader.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const slack = 36;
    if (d > slack) {
      p.x += (dx / d) * (d - slack) * Math.min(1, dt * 8);
      p.y += (dy / d) * (d - slack) * Math.min(1, dt * 8);
    }
    leader = p;
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
    } else if (dist(m.ship, pw.pickup) < SHIP_R + 22) {
      const k = pw.pickup.kind;
      if (k === 'shield') pw.shield = true;
      else if (k === 'overdrive') pw.overdrive = OVERDRIVE_TIME;
      else m.ship.hp = Math.min(m.def.maxHp, m.ship.hp + 1);
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
  if (m.ship.hp < m.def.maxHp) options.push('repair', 'repair');
  if (!options.length) {
    pw.nextSpawn = m.time + 5;
    return;
  }
  const spot = fairSpot(m, m.rng, m.ship, 160, 380);
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
    } else if (dist(m.ship, c.pickup) < SHIP_R + 22) {
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
  const spot = fairSpot(m, m.rng, m.ship, 180, 420);
  if (!spot) {
    c.nextSpawn = m.time + 2;
    return;
  }
  c.pickup = { x: spot.x, y: spot.y, life: CHRONO_LIFE };
  m.events.push({ type: 'chrono-spawn', x: spot.x, y: spot.y });
}

function checkHazards(m: MissionState): void {
  const s = m.ship;
  if (m.status !== 'playing') return;
  for (const r of m.rocks) {
    const d = dist(s, r);
    if (d < r.r + SHIP_R - 3) damage(m, r, 'Hull breached by debris');
    else if (d < r.r + SHIP_R + 14 && s.invuln === 0 && !r.grazed) {
      // Near miss: a skill bonus, once per rock per pass.
      r.grazed = true;
      m.nearMisses++;
      m.score += Math.round(40 * comboMult(m.combo.count));
      m.events.push({ type: 'near', x: s.x, y: s.y });
    } else if (d > r.r + SHIP_R + 60) r.grazed = false;
  }
  for (const b of m.barriers) {
    if (barrierState(b, m.time) === 'on' && segDist(s, b) < SHIP_R + 4) damage(m, { x: s.x, y: s.y + 1 }, 'Burned by an energy barrier');
  }
  for (const d of m.drones) {
    if (d.spawnIn === 0 && dist(s, d) < SHIP_R + 16) {
      damage(m, d, d.kind === 'raider' ? 'Rammed by an alien raider' : d.kind === 'turret' ? 'Flew into a defence turret' : 'Rammed by a hunter drone');
      if (d.kind === 'scout' || d.kind === 'raider') {
        d.hp = 0;
      }
    }
  }
  for (const b of m.bullets) {
    if (b.from === 'enemy' && b.life > 0 && dist(s, b) < b.r + SHIP_R - 2) {
      b.life = 0;
      damage(m, b, 'Shot down');
    }
  }
  m.pulses.forEach((p) => {
    if (p.warn > 0) return;
    const d = Math.hypot(s.x - 500, s.y - 500);
    if (Math.abs(d - p.r) > PULSE_BAND + SHIP_R) return;
    const a = Math.atan2(s.y - 500, s.x - 500);
    const off = Math.abs(((a - p.gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (off > PULSE_GAP) damage(m, { x: 500, y: 500 }, 'Caught in a heat pulse');
  });
  if (m.boss?.beam && m.boss.beam.warn <= 0) {
    const b = m.boss;
    const a = b.beam!.angle;
    const ex = b.x + Math.cos(a) * BEAM_LENGTH;
    const ey = b.y + Math.sin(a) * BEAM_LENGTH;
    if (segDist(s, { x1: b.x, y1: b.y, x2: ex, y2: ey, period: 1, on: 1, offset: 0 }) < BEAM_HALF + SHIP_R) damage(m, b, 'Cut down by the Guardian’s beam');
  }
  if (m.boss && m.boss.dying === 0 && dist(s, m.boss) < 80 + SHIP_R) damage(m, m.boss, 'Crushed against the Guardian');
  if (m.collapseY !== null && s.y + SHIP_R > m.collapseY) lose(m, 'Swallowed by the collapse');
  if (m.gravity && dist(s, m.gravity) < m.gravity.horizon + SHIP_R) lose(m, 'Pulled past the event horizon');
}

export function isChronoActive(m: MissionState): boolean {
  return m.chrono.active > 0;
}
