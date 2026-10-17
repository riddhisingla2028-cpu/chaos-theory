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
}

export type DroneKind = 'scout' | 'gunner' | 'raider' | 'turret';

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
  | { type: 'shoot'; x: number; y: number }
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
  target: number | null; // id of the drone the blaster is locked on (-1 = boss)
  events: MissionEvent[];
  nextId: number;
}

// ---------- Tuning ----------

export const VIEW = 720; // visible window, world units
export const SHIP_R = 13; // collision radius: matches the drawn hull's core
const SHIP_SPEED = 400;
const SHIP_RESPONSE = 12;
const INVULN = 1.2;
const FIRE_EVERY = 0.2;
const FIRE_RANGE = 470;
const BOLT_SPEED = 900;
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

const MISSION_DEFS: MissionDef[] = [
  {
    id: 'first-contact',
    index: 0,
    code: '01',
    name: 'Asteroid Run',
    tagline: 'Fuel up inside a drifting asteroid field and reach extraction.',
    briefing: 'Your scout ship came out of the jump inside an asteroid field with dry tanks. Recover five fuel cores drifting between the rocks, then fly into the extraction portal once it powers up. Rocks rip through hull plating: keep moving.',
    objective: 'Collect 5 fuel cores, then reach extraction',
    secondaries: [
      { id: 'no-damage', text: 'Take no hull damage' },
      { id: 'fast', text: 'Finish in under 30s' },
    ],
    world: { w: W, h: W },
    maxHp: 3,
    weapons: false,
    timeLimit: null,
    accent: [79, 227, 240],
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
    accent: [155, 123, 255],
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
    briefing: 'The frigate Aegis is dead in space and an alien swarm is closing in. Raiders dive at the frigate; hunters chase you; gunners glow before they fire. Your blaster locks on and fires automatically: stay between the swarm and the Aegis.',
    objective: 'Clear all 12 attackers and keep the frigate alive',
    secondaries: [
      { id: 'one-hit', text: 'Take at most 1 hit' },
      { id: 'fast', text: 'Finish in under 60s' },
    ],
    world: { w: W, h: W },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [255, 140, 66],
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
        { spawn: [{ kind: 'gunner', x: 500, y: 130 }, { kind: 'raider', x: 120, y: 880 }, { kind: 'raider', x: 880, y: 880 }, { kind: 'gunner', x: 880, y: 500 }, { kind: 'scout', x: 120, y: 500 }] },
      ];
      m.killsNeeded = 12;
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
    briefing: 'The orbital ring has lost its stabilisers and is tearing itself apart from the south. Fly north through the failing sections to the escape portal before the collapse catches you. Wreckage is falling through the shafts, and the collapse speeds up as it goes.',
    objective: 'Reach the escape portal before the collapse catches you',
    secondaries: [
      { id: 'cores', text: 'Recover all 3 data cores on the way' },
      { id: 'no-damage', text: 'Take no hull damage' },
    ],
    world: { w: W, h: 2400 },
    maxHp: 3,
    weapons: false,
    timeLimit: null,
    accent: [255, 79, 92],
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
    briefing: 'The research station is heading for meltdown and its automated defences have turned on us. Hold position inside each stabiliser ring until it comes online; your blaster will engage the defence turrets. Heat pulses roll out from the core: slip through the gap in each ring.',
    objective: 'Stabilise 3 reactors, then escape through the portal',
    secondaries: [
      { id: 'turrets', text: 'Destroy both defence turrets' },
      { id: 'fast', text: 'Finish in under 50s' },
    ],
    world: { w: W, h: W },
    maxHp: 4,
    weapons: true,
    timeLimit: 90,
    accent: [255, 213, 74],
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
    briefing: 'The Guardian draws its power from a singularity that pulls everything towards it. It shields itself between attacks; when the shield drops, its core is exposed. Red lines mean a beam is coming. When it falls, the singularity will collapse: fly south to the escape portal before the event horizon reaches you.',
    objective: 'Destroy the Guardian, then escape the singularity',
    secondaries: [
      { id: 'two-hits', text: 'Take at most 2 hits' },
      { id: 'fast', text: 'Win in under 100s' },
    ],
    world: { w: W, h: W },
    maxHp: 5,
    weapons: true,
    timeLimit: null,
    accent: [255, 79, 216],
    build(m) {
      m.ship.x = 500;
      m.ship.y = 840;
      m.boss = { x: 500, y: 300, hp: 60, maxHp: 60, phase: 0, shielded: true, cycle: 0, attackIn: 2.2, beam: null, hitFlash: 0, dying: 0 };
      m.gravity = { x: 500, y: 90, reach: 1100, pull: 60, horizon: 36 };
      m.portal = { x: 500, y: 935, r: 50, open: false };
    },
  },
  {
    id: 'alien-pursuit',
    index: 0,
    code: '',
    name: 'Alien Pursuit',
    tagline: 'Escort a crippled transport through alien fighters.',
    briefing: 'The transport Kestrel is limping north to the jump gate with forty colonists aboard and alien raiders in pursuit. Raiders dive straight at the transport; hunters come for you. Your blaster locks on automatically: stay close to the Kestrel and break up every attack run.',
    objective: 'Escort the transport to the jump gate',
    secondaries: [
      { id: 'ally-half', text: 'The transport keeps over half its hull' },
      { id: 'kills-12', text: 'Destroy 12 alien fighters' },
    ],
    world: { w: W, h: 2400 },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [91, 240, 138],
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
    briefing: 'A liner broke apart in the debris belt and five escape pods are drifting with failing life support. Fly to each pod to lock your tractor beam on (two at a time), then tow them back into the rescue ship’s bay. Your blaster can break up debris in your way.',
    objective: 'Tow all 5 escape pods to the rescue ship before life support fails',
    secondaries: [
      { id: 'fast', text: 'Finish in under 75s' },
      { id: 'no-damage', text: 'Take no hull damage' },
    ],
    world: { w: W, h: 1800 },
    maxHp: 3,
    weapons: true,
    timeLimit: 110,
    accent: [79, 160, 255],
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
      ].map((p) => ({ id: m.nextId++, x: p.x, y: p.y, vx: 0, vy: 0, state: 'drifting' as const }));
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
    objective: 'Get at least 2 of the 3 cargo ships to the relay',
    secondaries: [
      { id: 'all-allies', text: 'All three cargo ships survive' },
      { id: 'kills-15', text: 'Destroy 15 raiders' },
    ],
    world: { w: W, h: 2600 },
    maxHp: 4,
    weapons: true,
    timeLimit: null,
    accent: [255, 181, 71],
    build(m) {
      m.ship.x = 500;
      m.ship.y = 2300;
      const lane = (x: number) => [{ x, y: 1800 }, { x: x + 60, y: 1300 }, { x: x - 40, y: 800 }, { x, y: 300 }];
      m.allies = [
        ally(m, 'cargo', 'Hauler One', 380, 2420, 9, 30, lane(380), 52),
        ally(m, 'cargo', 'Hauler Two', 500, 2480, 9, 30, lane(500), 52),
        ally(m, 'cargo', 'Hauler Three', 620, 2420, 9, 30, lane(620), 52),
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
    briefing: 'The capital ship Meridian is the last ship out, and its jump drive needs seventy seconds to charge. The enemy fleet knows it. Waves will grow heavier as the drive charges. Protect the Meridian until it jumps, and it will take you with it.',
    objective: 'Protect the capital ship until its jump drive charges',
    secondaries: [
      { id: 'ally-half', text: 'The capital ship keeps over half its hull' },
      { id: 'two-hits', text: 'Take at most 2 hits' },
    ],
    world: { w: W, h: W },
    maxHp: 5,
    weapons: true,
    timeLimit: null,
    accent: [155, 123, 255],
    build(m) {
      m.ship.x = 500;
      m.ship.y = 830;
      m.allies = [ally(m, 'capital', 'Capital ship Meridian', 500, 560, 70, 70, [], 0)];
      m.alliesNeeded = 1;
      m.jump = { charge: 0, duration: 70 };
      m.spawner = { every: 3, next: 2, kinds: ['raider', 'gunner', 'raider', 'scout'], maxAlive: 7, edge: 'around' };
    },
  },
];

/** Campaign order. Codes ("01"…) follow this order; ids, and the saved records keyed by them, never change. */
const ORDER: MissionId[] = ['first-contact', 'alien-pursuit', 'rescue', 'shattered-orbit', 'collapse', 'meltdown', 'breach-protocol', 'convoy', 'last-jump', 'guardian'];

export const MISSIONS: readonly MissionDef[] = ORDER.map((id, index) => ({ ...MISSION_DEFS.find((d) => d.id === id)!, index, code: String(index + 1).padStart(2, '0') }));

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
    events: [],
    nextId: 1,
  };
  def.build(m, m.rng);
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
}

/** What the HUD shows as the current objective. */
/** How far along its route a friendly ship is (0..1). */
function allyProgress(a: Ally): number {
  if (!a.path.length) return 1;
  if (a.arrived) return 1;
  return Math.min(0.99, a.pathIdx / a.path.length);
}

export function objectiveView(m: MissionState): ObjectiveView {
  const portalOpen = m.portal?.open ?? false;
  switch (m.def.id) {
    case 'first-contact': {
      const got = m.cores.filter((c) => c.taken).length;
      return portalOpen ? { text: 'Reach the extraction portal', progress: 1, count: null } : { text: 'Collect fuel cores', progress: got / m.coresNeeded, count: `${got}/${m.coresNeeded}` };
    }
    case 'alien-pursuit':
    case 'convoy': {
      const living = m.allies.filter((a) => !a.destroyed);
      const prog = living.length ? Math.min(...living.map(allyProgress)) : 0;
      const label = m.def.id === 'convoy' ? `Escort the convoy · ${living.length}/${m.allies.length} ships` : 'Escort the transport to the jump gate';
      return { text: label, progress: prog, count: `${Math.round(prog * 100)}%` };
    }
    case 'rescue': {
      const saved = m.pods.filter((p) => p.state === 'saved').length;
      const towing = m.pods.filter((p) => p.state === 'towed').length;
      return { text: towing ? `Tow ${towing === 1 ? 'the pod' : 'the pods'} to the rescue ship` : 'Find the escape pods', progress: saved / m.pods.length, count: `${saved}/${m.pods.length}` };
    }
    case 'last-jump': {
      const j = m.jump!;
      return { text: 'Protect the Meridian · jump drive charging', progress: j.charge / j.duration, count: `${Math.floor((j.charge / j.duration) * 100)}%` };
    }
    case 'shattered-orbit': {
      const n = m.gates.filter((g) => g.passed).length;
      return portalOpen ? { text: 'Reach the exit portal', progress: 1, count: null } : { text: 'Fly through the navigation gates', progress: n / m.gates.length, count: `${n}/${m.gates.length}` };
    }
    case 'breach-protocol':
      return { text: 'Clear the swarm · protect the Aegis', progress: m.cleared / m.killsNeeded, count: `${m.cleared}/${m.killsNeeded}` };
    case 'collapse': {
      const total = m.def.world.h - 300;
      const done = Math.max(0, Math.min(1, (m.def.world.h - 160 - m.ship.y) / total));
      return { text: 'Escape north to the portal', progress: done, count: `${Math.round(done * 100)}%` };
    }
    case 'meltdown': {
      const n = m.reactors.filter((r) => r.active).length;
      return portalOpen ? { text: 'Escape through the portal', progress: 1, count: null } : { text: 'Stabilise the reactors', progress: n / m.reactors.length, count: `${n}/${m.reactors.length}` };
    }
    case 'guardian': {
      const b = m.boss!;
      if (m.escaping) return { text: 'ESCAPE! Fly south to the portal', progress: 1, count: null };
      return { text: b.shielded ? 'Survive until the shield drops' : 'Shield down: fire at the core!', progress: 1 - b.hp / b.maxHp, count: `${Math.max(0, b.hp)}/${b.maxHp}` };
    }
  }
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

const DRONE_HP: Record<DroneKind, number> = { scout: 5, gunner: 9, raider: 4, turret: 14 };
const DRONE_SCORE: Record<DroneKind, number> = { scout: 120, gunner: 180, raider: 140, turret: 250 };

function spawnDrone(m: MissionState, kind: DroneKind, x: number, y: number): void {
  const living = m.allies.filter((a) => !a.destroyed);
  // Raiders always hunt a friendly ship; gunners do half the time when there is one to protect.
  const hunts = living.length > 0 && (kind === 'raider' || (kind === 'gunner' && m.rng() < 0.5));
  const targetAlly = hunts ? living[Math.floor(m.rng() * living.length)].id : null;
  m.drones.push({ id: m.nextId++, kind, x, y, vx: 0, vy: 0, hp: DRONE_HP[kind], maxHp: DRONE_HP[kind], fireIn: 1.2 + m.rng() * 1.0, aim: 0, hitFlash: 0, spawnIn: 0.8, targetAlly });
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
  updateCombat(m, dt, wdt);
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
  if (m.portal?.open) return m.portal;
  const near = <T extends Vec>(xs: T[]) => xs.sort((a, b) => dist(a, m.ship) - dist(b, m.ship))[0] ?? null;
  switch (m.def.id) {
    case 'first-contact':
      return near(m.cores.filter((c) => !c.taken));
    case 'shattered-orbit':
      return m.gates.find((g) => !g.passed) ?? null;
    case 'meltdown':
      return near(m.reactors.filter((r) => !r.active));
    case 'breach-protocol':
      return near(m.drones.filter((d) => d.spawnIn === 0));
    case 'collapse':
      return m.portal;
    case 'guardian':
      return m.escaping ? m.portal : m.boss;
    case 'alien-pursuit':
    case 'convoy':
    case 'last-jump': {
      // Point at the friendly ship in most danger.
      const living = m.allies.filter((a) => !a.destroyed);
      return living.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] ?? null;
    }
    case 'rescue': {
      if (m.pods.some((p) => p.state === 'towed')) return m.rescueZone;
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

function updateCombat(m: MissionState, dt: number, wdt: number): void {
  const s = m.ship;
  // Enemy waves arrive when the previous wave is cleared (turrets do not hold up the next wave).
  if (m.waves.length && m.drones.every((d) => d.kind === 'turret')) {
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
    } else if (d.kind === 'gunner') {
      // Gunners keep their distance from their target and strafe.
      const want = dd < 300 ? -1 : dd > 420 ? 1 : 0;
      const sp = 110;
      d.vx += ((dx / dd) * sp * want + (-dy / dd) * 70 - d.vx) * Math.min(1, wdt * 1.6);
      d.vy += ((dy / dd) * sp * want + (dx / dd) * 70 - d.vy) * Math.min(1, wdt * 1.6);
    }
    if (d.kind === 'gunner' || d.kind === 'turret') {
      d.fireIn -= wdt;
      if (d.fireIn <= 0 && d.aim <= 0 && (d.kind === 'gunner' || dist(d, s) < 650)) {
        d.aim = AIM_TIME;
        m.events.push({ type: 'warn', x: d.x, y: d.y });
      }
      if (d.aim > 0) {
        d.aim -= wdt;
        if (d.aim <= 0) {
          d.fireIn = (d.kind === 'turret' ? 2.4 : 1.6) + m.rng() * 1.0;
          const tgt = d.kind === 'turret' ? s : prey;
          const a = Math.atan2(tgt.y - d.y, tgt.x - d.x);
          m.bullets.push({ id: m.nextId++, x: d.x, y: d.y, vx: Math.cos(a) * ENEMY_BOLT_SPEED, vy: Math.sin(a) * ENEMY_BOLT_SPEED, r: 9, from: 'enemy', life: 5 });
          m.events.push({ type: 'enemy-shoot', x: d.x, y: d.y });
        }
      }
    }
    if (d.kind !== 'turret') {
      d.x += d.vx * wdt;
      d.y += d.vy * wdt;
      resolve(m, d, 18);
    }
    // A raider that reaches a friendly ship slams into it.
    const victim = allyById(m, d.targetAlly);
    if (d.kind === 'raider' && victim && dist(d, victim) < victim.r + 14) {
      allyDamage(m, victim, 2);
      d.hp = -999; // destroyed in the impact; not counted as a kill
    }
  }

  // Boss
  if (m.boss) updateBoss(m, wdt);

  // Player blaster: automatic, locked on the nearest target in range. Overdrive doubles the fire rate.
  if (m.def.weapons) {
    s.fireCd = Math.max(0, s.fireCd - dt);
    let best: { id: number; x: number; y: number; d: number } | null = null;
    for (const d of m.drones) {
      if (d.spawnIn > 0) continue;
      const dd = dist(s, d);
      if (dd < FIRE_RANGE && (!best || dd < best.d)) best = { id: d.id, x: d.x, y: d.y, d: dd };
    }
    if (m.boss && !m.boss.shielded && m.boss.dying === 0 && m.boss.hp > 0) {
      const dd = dist(s, m.boss);
      if (dd < FIRE_RANGE + 80 && (!best || dd < best.d)) best = { id: -1, x: m.boss.x, y: m.boss.y, d: dd };
    }
    if (!best) {
      // With no enemies in range, the blaster breaks up destructible debris (The Rescue).
      for (const r of m.rocks) {
        if (r.hp === undefined) continue;
        const dd = dist(s, r);
        if (dd < FIRE_RANGE * 0.75 && (!best || dd < best.d)) best = { id: -2 - r.id, x: r.x, y: r.y, d: dd };
      }
    }
    m.target = best ? best.id : null;
    if (best && s.fireCd === 0) {
      s.fireCd = m.power.overdrive > 0 ? FIRE_EVERY / 2 : FIRE_EVERY;
      const a = Math.atan2(best.y - s.y, best.x - s.x);
      m.bullets.push({ id: m.nextId++, x: s.x + Math.cos(a) * 18, y: s.y + Math.sin(a) * 18, vx: Math.cos(a) * BOLT_SPEED, vy: Math.sin(a) * BOLT_SPEED, r: 5, from: 'player', life: 0.7 });
      m.events.push({ type: 'shoot', x: s.x, y: s.y });
    }
  }

  // Bullets: player bolts in real time, enemy shots in world time.
  for (const b of m.bullets) {
    const t = b.from === 'player' ? dt : wdt;
    b.x += b.vx * t;
    b.y += b.vy * t;
    b.life -= t;
    if (insideWall(m, b.x, b.y, 0)) b.life = 0;
  }
  for (const b of m.bullets) {
    if (b.life <= 0) continue;
    if (b.from === 'enemy') {
      for (const a of m.allies) {
        if (!a.destroyed && dist(b, a) < a.r + b.r) {
          b.life = 0;
          allyDamage(m, a, 1);
          break;
        }
      }
      continue;
    }
    for (const d of m.drones) {
      if (d.spawnIn > 0 || d.hp <= 0 || dist(b, d) > 20 + b.r) continue;
      b.life = 0;
      d.hp -= 1;
      d.hitFlash = 0.12;
      m.events.push({ type: 'enemy-hit', x: d.x, y: d.y });
      break;
    }
    if (b.life > 0 && m.boss && m.boss.dying === 0 && m.boss.hp > 0 && dist(b, m.boss) < 70) {
      b.life = 0;
      if (!m.boss.shielded) {
        m.boss.hp -= 1;
        m.boss.hitFlash = 0.1;
        m.score += 20;
        m.events.push({ type: 'enemy-hit', x: b.x, y: b.y });
      }
    }
    if (b.life > 0) {
      for (const r of m.rocks) {
        if (r.hp === undefined || dist(b, r) > r.r + b.r) continue;
        b.life = 0;
        r.hp -= 1;
        m.events.push({ type: 'enemy-hit', x: b.x, y: b.y });
        if (r.hp <= 0) {
          m.score += 60;
          m.events.push({ type: 'explode', x: r.x, y: r.y, big: false });
        }
        break;
      }
    }
  }
  m.rocks = m.rocks.filter((r) => r.hp === undefined || r.hp > 0);
  for (const d of m.drones) {
    if (d.hp <= 0) m.cleared++;
    if (d.hp <= -999) m.events.push({ type: 'explode', x: d.x, y: d.y, big: false });
    else if (d.hp <= 0) {
      m.events.push({ type: 'explode', x: d.x, y: d.y, big: false });
      m.kills++;
      registerKill(m, d);
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
    b.phase = phase;
    b.shielded = true;
    b.cycle = 0;
    m.events.push({ type: 'boss-phase', phase });
    if (phase >= 1) {
      spawnDrone(m, 'scout', 200, 200);
      spawnDrone(m, 'scout', 800, 200);
    }
  }
  // Shield cycle: shielded (attacking), then vulnerable.
  const shieldTime = [5.5, 5, 4.5][phase];
  const openTime = [3.6, 3.2, 3][phase];
  b.cycle += wdt;
  if (b.shielded && b.cycle >= shieldTime) {
    b.shielded = false;
    b.cycle = 0;
    m.events.push({ type: 'boss-vulnerable' });
  } else if (!b.shielded && b.cycle >= openTime) {
    b.shielded = true;
    b.cycle = 0;
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
  if (m.def.id === 'first-contact' && m.cores.filter((c) => c.taken).length >= m.coresNeeded) openPortal(m);

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
      m.events.push({ type: 'reactor', x: r.x, y: r.y });
    }
  }
  if (m.reactors.length && m.reactors.every((r) => r.active)) openPortal(m);

  // Alien Swarm: every wave cleared with the frigate still flying.
  if (m.def.id === 'breach-protocol' && m.cleared >= m.killsNeeded && m.waves.length === 0 && m.drones.length === 0 && m.allies.every((a) => !a.destroyed)) win(m);

  // Escort missions: done when every surviving friendly ship has reached its destination.
  if (m.allies.length && m.allies.some((a) => a.path.length > 0)) {
    const living = m.allies.filter((a) => !a.destroyed);
    if (living.length >= m.alliesNeeded && living.every((a) => a.arrived)) {
      for (const a of living) m.score += Math.round(400 * (a.hp / a.maxHp));
      m.events.push({ type: 'jump', x: living[0].x, y: living[0].y });
      win(m);
    }
  }

  // The Rescue: every pod home.
  if (m.pods.length && m.pods.every((p) => p.state === 'saved')) win(m);

  // The Last Jump: the drive charges in world time; when full, the capital ship jumps (and takes you).
  if (m.jump && m.status === 'playing') {
    m.jump.charge = Math.min(m.jump.duration, m.jump.charge + wdt);
    if (m.jump.charge >= m.jump.duration) {
      const cap = m.allies[0];
      for (const a of m.allies) if (!a.destroyed) m.score += Math.round(800 * (a.hp / a.maxHp));
      m.events.push({ type: 'jump', x: cap?.x ?? 500, y: cap?.y ?? 500 });
      win(m);
    }
  }

  // Singularity: the event horizon grows and the pull strengthens during the escape.
  if (m.escaping && m.gravity) {
    m.gravity.pull = Math.min(230, m.gravity.pull + wdt * 30);
    m.gravity.horizon += wdt * 36;
  }

  // Entering an open portal completes missions where the player is the one who must get out.
  if (m.portal?.open && m.allies.length === 0 && dist(s, m.portal) < m.portal.r - 6) win(m);
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
      p.x += Math.sin(m.time * 0.7 + p.id) * 8 * dt;
      p.y += Math.cos(m.time * 0.5 + p.id) * 8 * dt;
      if (dist(s, p) < SHIP_R + 24 && m.pods.filter((x) => x.state === 'towed').length < TOW_MAX) {
        p.state = 'towed';
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
    if (z && dist(p, z) < z.r) {
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
