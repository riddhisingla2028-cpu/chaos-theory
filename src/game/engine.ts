// Pure game simulation for Chaos Theory. No DOM access, so it can be unit tested.
// The arena is a fixed 1000 x 1000 logical space; the renderer scales it to the screen.

export const ARENA = 1000;

export const PLAYER_HALF = 12; // drawn square is 24 x 24
export const PLAYER_HIT_RADIUS = 10; // slightly forgiving circular hitbox
export const PLAYER_SPEED = 380;
const PLAYER_RESPONSE = 14; // how quickly velocity follows input

export const CHAOS_WARNING = 1.6; // seconds of telegraph before an event starts
export const CHAOS_ACTIVE = 6; // seconds an event lasts
const FIRST_CHAOS_AT = 6;

export const COLLAPSE_INSET = 230; // how far each wall moves in during COLLAPSE
const COLLAPSE_SPEED = 260;
export const GRAVITY_STRENGTH = 230; // below PLAYER_SPEED so it can be resisted

const TRAIL_INTERVAL = 0.03;
const TRAIL_KEEP = 2;
export const AFTERIMAGE_ARM = 0.45; // trail becomes lethal once it is this old...
export const AFTERIMAGE_LIFE = 1.8; // ...and stays lethal until this age
export const TRAIL_HIT_RADIUS = 7;

const SPAWN_GRACE = 1;
const SEEKER_TURN_RATE = 1.5; // radians per second
const SEEKER_LIFE = 7;
const OFFSCREEN_MARGIN = 80;

export type ChaosKind = 'INVERSION' | 'COLLAPSE' | 'AFTERIMAGE' | 'GRAVITY';
export const CHAOS_KINDS: readonly ChaosKind[] = ['INVERSION', 'COLLAPSE', 'AFTERIMAGE', 'GRAVITY'];

export const CHAOS_INFO: Record<ChaosKind, { name: string; hint: string }> = {
  INVERSION: { name: 'Inversion', hint: 'Your controls are reversed' },
  COLLAPSE: { name: 'Collapse', hint: 'The walls are closing in. Get to the centre' },
  AFTERIMAGE: { name: 'Afterimage', hint: 'Your trail turns lethal. Keep moving' },
  GRAVITY: { name: 'Gravity Shift', hint: 'A force is pulling you. Push against it' },
};

export type DeathCause = 'drifter' | 'seeker' | 'collapse' | 'afterimage';

export interface Vec {
  x: number;
  y: number;
}

export interface Hazard {
  id: number;
  kind: 'drifter' | 'seeker';
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface Chaos {
  kind: ChaosKind;
  phase: 'warning' | 'active';
  remaining: number;
  duration: number;
  startedAt: number; // game time the current phase began
  gravity: Vec;
}

export interface GameStats {
  eventsSurvived: number;
  hazardsDodged: number;
  peakLevel: number;
}

export interface GameState {
  rng: () => number;
  time: number;
  status: 'playing' | 'over';
  player: { x: number; y: number; vx: number; vy: number };
  hazards: Hazard[];
  trail: TrailPoint[];
  trailClock: number;
  spawnTimer: number;
  chaos: Chaos | null;
  nextChaosIn: number;
  lastChaos: ChaosKind | null;
  inset: number;
  stats: GameStats;
  cause: DeathCause | null;
  nextId: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function difficulty(time: number) {
  return {
    level: 1 + Math.floor(time / 15),
    speedMul: Math.min(2.4, 1 + time * 0.012),
    spawnInterval: Math.max(0.22, 0.95 - time * 0.01),
    seekerChance: time < 30 ? 0 : Math.min(0.35, 0.12 + (time - 30) * 0.004),
  };
}

export function scoreFor(time: number): number {
  // Small epsilon so accumulated float error (1.9999999s) doesn't drop a point.
  return Math.floor(time * 10 + 1e-6);
}

export function createGame(seed: number = Date.now()): GameState {
  return {
    rng: mulberry32(seed),
    time: 0,
    status: 'playing',
    player: { x: ARENA / 2, y: ARENA / 2, vx: 0, vy: 0 },
    hazards: [],
    trail: [],
    trailClock: 0,
    spawnTimer: SPAWN_GRACE,
    chaos: null,
    nextChaosIn: FIRST_CHAOS_AT,
    lastChaos: null,
    inset: 0,
    stats: { eventsSurvived: 0, hazardsDodged: 0, peakLevel: 1 },
    cause: null,
    nextId: 1,
  };
}

export function isActive(s: GameState, kind: ChaosKind): boolean {
  return s.chaos !== null && s.chaos.kind === kind && s.chaos.phase === 'active';
}

const GRAVITY_DIRECTIONS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function startChaos(s: GameState, kind: ChaosKind, phase: Chaos['phase'] = 'warning'): void {
  const duration = phase === 'warning' ? CHAOS_WARNING : CHAOS_ACTIVE;
  const gravity =
    kind === 'GRAVITY' ? GRAVITY_DIRECTIONS[Math.floor(s.rng() * GRAVITY_DIRECTIONS.length)] : { x: 0, y: 0 };
  s.chaos = { kind, phase, remaining: duration, duration, startedAt: s.time, gravity: { ...gravity } };
  s.lastChaos = kind;
}

function pickChaos(s: GameState): ChaosKind {
  const options = CHAOS_KINDS.filter((k) => k !== s.lastChaos);
  return options[Math.floor(s.rng() * options.length)];
}

function updateChaos(s: GameState, dt: number): void {
  if (!s.chaos) {
    s.nextChaosIn -= dt;
    if (s.nextChaosIn <= 0) startChaos(s, pickChaos(s));
    return;
  }
  const c = s.chaos;
  c.remaining -= dt;
  if (c.remaining > 0) return;
  if (c.phase === 'warning') {
    c.phase = 'active';
    c.remaining = c.duration = CHAOS_ACTIVE;
    c.startedAt = s.time;
  } else {
    s.chaos = null;
    s.stats.eventsSurvived++;
    s.nextChaosIn = Math.max(3.5, 8 - difficulty(s.time).level * 0.5) + s.rng() * 3;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function updatePlayer(s: GameState, input: Vec, dt: number): void {
  let ix = input.x;
  let iy = input.y;
  const mag = Math.hypot(ix, iy);
  if (mag > 1) {
    ix /= mag;
    iy /= mag;
  }
  if (isActive(s, 'INVERSION')) {
    ix = -ix;
    iy = -iy;
  }
  const p = s.player;
  const k = Math.min(1, dt * PLAYER_RESPONSE);
  p.vx += (ix * PLAYER_SPEED - p.vx) * k;
  p.vy += (iy * PLAYER_SPEED - p.vy) * k;

  let mx = p.vx;
  let my = p.vy;
  if (isActive(s, 'GRAVITY')) {
    mx += s.chaos!.gravity.x * GRAVITY_STRENGTH;
    my += s.chaos!.gravity.y * GRAVITY_STRENGTH;
  }
  p.x = clamp(p.x + mx * dt, PLAYER_HALF, ARENA - PLAYER_HALF);
  p.y = clamp(p.y + my * dt, PLAYER_HALF, ARENA - PLAYER_HALF);
}

function updateTrail(s: GameState, dt: number): void {
  s.trailClock -= dt;
  if (s.trailClock <= 0) {
    s.trailClock = TRAIL_INTERVAL;
    s.trail.push({ x: s.player.x, y: s.player.y, t: s.time });
  }
  while (s.trail.length > 0 && s.time - s.trail[0].t > TRAIL_KEEP) s.trail.shift();
}

function updateInset(s: GameState, dt: number): void {
  const target = isActive(s, 'COLLAPSE') ? COLLAPSE_INSET : 0;
  const delta = COLLAPSE_SPEED * dt;
  s.inset = s.inset < target ? Math.min(target, s.inset + delta) : Math.max(target, s.inset - delta);
}

function spawnHazard(s: GameState): void {
  const d = difficulty(s.time);
  const seeker = s.rng() < d.seekerChance;
  const r = seeker ? 13 : 9 + s.rng() * 13;
  const side = Math.floor(s.rng() * 4);
  const along = s.rng() * ARENA;
  let x: number;
  let y: number;
  if (side === 0) [x, y] = [along, -r];
  else if (side === 1) [x, y] = [ARENA + r, along];
  else if (side === 2) [x, y] = [along, ARENA + r];
  else [x, y] = [-r, along];

  // Aim at a random point in the middle of the arena so hazards always cross it.
  const tx = ARENA * (0.2 + s.rng() * 0.6);
  const ty = ARENA * (0.2 + s.rng() * 0.6);
  const speed = (seeker ? 120 : 170 + s.rng() * 90) * d.speedMul;
  const angle = Math.atan2(ty - y, tx - x);
  s.hazards.push({
    id: s.nextId++,
    kind: seeker ? 'seeker' : 'drifter',
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    age: 0,
    life: seeker ? SEEKER_LIFE : Infinity,
  });
}

function updateSpawning(s: GameState, dt: number): void {
  s.spawnTimer -= dt;
  if (s.spawnTimer > 0) return;
  spawnHazard(s);
  s.spawnTimer += difficulty(s.time).spawnInterval * (0.75 + s.rng() * 0.5);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function updateHazards(s: GameState, dt: number): void {
  const p = s.player;
  const kept: Hazard[] = [];
  for (const h of s.hazards) {
    h.age += dt;
    if (h.kind === 'seeker') {
      const speed = Math.hypot(h.vx, h.vy);
      const heading = Math.atan2(h.vy, h.vx);
      const wanted = Math.atan2(p.y - h.y, p.x - h.x);
      const turn = clamp(wrapAngle(wanted - heading), -SEEKER_TURN_RATE * dt, SEEKER_TURN_RATE * dt);
      h.vx = Math.cos(heading + turn) * speed;
      h.vy = Math.sin(heading + turn) * speed;
    }
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    const inBounds =
      h.x > -OFFSCREEN_MARGIN && h.x < ARENA + OFFSCREEN_MARGIN && h.y > -OFFSCREEN_MARGIN && h.y < ARENA + OFFSCREEN_MARGIN;
    if (inBounds && h.age < h.life) kept.push(h);
    else s.stats.hazardsDodged++;
  }
  s.hazards = kept;
}

function die(s: GameState, cause: DeathCause): void {
  s.status = 'over';
  s.cause = cause;
}

function checkCollisions(s: GameState): void {
  const p = s.player;

  for (const h of s.hazards) {
    if (Math.hypot(h.x - p.x, h.y - p.y) < h.r + PLAYER_HIT_RADIUS) return die(s, h.kind);
  }

  if (s.inset > 0.5) {
    const lo = s.inset;
    const hi = ARENA - s.inset;
    if (p.x - PLAYER_HIT_RADIUS < lo || p.x + PLAYER_HIT_RADIUS > hi || p.y - PLAYER_HIT_RADIUS < lo || p.y + PLAYER_HIT_RADIUS > hi) {
      return die(s, 'collapse');
    }
  }

  if (isActive(s, 'AFTERIMAGE')) {
    const since = s.chaos!.startedAt;
    for (const tp of s.trail) {
      if (tp.t < since) continue; // only trail laid down after the event began counts
      const age = s.time - tp.t;
      if (age < AFTERIMAGE_ARM || age > AFTERIMAGE_LIFE) continue;
      if (Math.hypot(tp.x - p.x, tp.y - p.y) < TRAIL_HIT_RADIUS + PLAYER_HIT_RADIUS) return die(s, 'afterimage');
    }
  }
}

/** Advance the simulation by dt seconds. Callers should keep dt small (<= 1/60). */
export function step(s: GameState, input: Vec, dt: number): void {
  if (s.status !== 'playing') return;
  s.time += dt;
  updateChaos(s, dt);
  updatePlayer(s, input, dt);
  updateTrail(s, dt);
  updateInset(s, dt);
  updateSpawning(s, dt);
  updateHazards(s, dt);
  checkCollisions(s);
  s.stats.peakLevel = Math.max(s.stats.peakLevel, difficulty(s.time).level);
}
