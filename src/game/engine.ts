// Pure game simulation for Chaos Theory. No DOM access, so it can be unit tested.
import { OPEN_ARENA, bounceHazard, onFloor, resolveBody, rotorHits, standable, type ArenaDef, type Rect } from './arenas';
// The arena is a fixed 1000 x 1000 logical space; the renderer scales it to the screen.

export const ARENA = 1000;

export const PLAYER_HALF = 12; // drawn shape is ~24 x 24
export const PLAYER_HIT_RADIUS = 10; // slightly forgiving circular hitbox
export const PLAYER_SPEED = 380;
const PLAYER_RESPONSE = 14; // how quickly velocity follows input

export const CHAOS_WARNING = 1.6; // default seconds of telegraph before an event starts
export const CHAOS_ACTIVE = 6; // default seconds an event lasts

export const COLLAPSE_INSET = 230; // how far each wall moves in during COLLAPSE
const COLLAPSE_SPEED = 260;
export const GRAVITY_STRENGTH = 230; // below PLAYER_SPEED so it can be resisted

const TRAIL_INTERVAL = 0.03;
const TRAIL_KEEP = 2;
export const AFTERIMAGE_ARM = 0.6; // trail becomes lethal once it is this old...
export const AFTERIMAGE_LIFE = 1.5; // ...and stays lethal until this age
export const TRAIL_HIT_RADIUS = 7;

export const SURGE_HAZARD_MUL = 1.7;
export const SURGE_PLAYER_MUL = 1.3;

export const SWEEP_SPEED = 300;
export const SWEEP_HALF = 8; // half thickness of a scanline beam
export const SWEEP_GAP_HALF = 95; // half width of the safe gap
const SWEEP_INTERVAL = 3;

export const HORIZON_START = 520;
export const HORIZON_MIN = 170;
const HORIZON_SHRINK = 75;
const HORIZON_DRIFT = 45;

const GLITCH_INTERVAL = 0.7;
export const TELEPORT_TELL = 0.45; // a ghost marks where a glitching hazard will reappear

// When a rule changes, hazards slow down for a beat so players can adapt instead of dying confused.
export const ADAPT_TIME = 1;
export const AFTERIMAGE_GRACE = 1; // the trail cannot kill during the first second of AFTERIMAGE

// Every run opens with a warm-up: slow, sparse hazards and no chaos, then a ramp to full difficulty.
export const WARMUP = 5;
const WARMUP_SPAWN_INTERVAL = 1.6;
const WARMUP_SPEED = 0.55;
const SPAWN_GRACE = 1.2;

// Early, frequent wins: survival milestones pay a bonus and feed the combo.
export const MILESTONES = [10, 20, 30, 45, 60, 90, 120, 180, 240, 300];
export const milestoneBonus = (index: number) => 25 * (index + 1);
const SEEKER_TURN_RATE = 1.5; // radians per second
const SEEKER_LIFE = 7;
const OFFSCREEN_MARGIN = 80;

export const POINTS_PER_SECOND = 10;
export const COMBO_WINDOW = 6; // seconds a combo survives without new feats
export const NEAR_MISS_DISTANCE = 16; // gap between hitboxes that counts as a near miss
const MAX_COMBO = 40; // caps the multiplier at x5.0

// Orbs: collectible objectives.
export const ORB_RADIUS = 16;
export const ORB_POINTS = 50;
const ORB_RESPAWN = 0.35;
const ORB_MIN_DISTANCE = 220; // new orbs never appear right under the player

// Vanishing Zone: the arena is a 4x4 grid of tiles that flicker out.
export const VOID_GRID = 4;
export const VOID_TILE = ARENA / VOID_GRID;
export const VOID_WARN = 1.0;
const VOID_ON = 1.7;
export const VOID_MARGIN = 14; // the player must be clearly inside a void to fall in

// Final Showdown boss.
export const BOSS_RADIUS = 46;
export const BOSS_TELL = 0.8;
export const BEAM_HALF = 10;
const BEAM_SPEED = 1.1; // radians per second
const BEAM_TIME = 3;
export const NOVA_SPEED = 280; // expanding shockwave ring
export const NOVA_HALF = 12; // half thickness of the ring
export const NOVA_GAP = 0.55; // half-width (radians) of the safe gap in the ring
const BOSS_SHIELD = 1.6; // seconds the Core is shielded (no attacks) after a phase change
const BOSS_RESPAWN = 2.6; // Boss Rush: breather between bosses

export const BONUS_ORB_POINTS = 150;
const BONUS_ORB_LIFE = 5;
export const FINISH_DELAY = 1.3; // celebration between completing an objective and the victory screen

export type ChaosKind =
  | 'INVERSION'
  | 'COLLAPSE'
  | 'AFTERIMAGE'
  | 'GRAVITY'
  | 'SURGE'
  | 'SCANLINE'
  | 'PHANTOM'
  | 'HORIZON'
  | 'GLITCH';

export const CHAOS_KINDS: readonly ChaosKind[] = [
  'INVERSION',
  'COLLAPSE',
  'AFTERIMAGE',
  'GRAVITY',
  'SURGE',
  'SCANLINE',
  'PHANTOM',
  'HORIZON',
  'GLITCH',
];

export const CHAOS_INFO: Record<ChaosKind, { name: string; hint: string; blurb: string }> = {
  INVERSION: { name: 'Inversion', hint: 'Your controls are reversed', blurb: 'Controls reverse.' },
  COLLAPSE: { name: 'Collapse', hint: 'The walls are closing in. Get to the centre', blurb: 'The walls close in. Edges kill.' },
  AFTERIMAGE: { name: 'Afterimage', hint: 'Your trail turns lethal. Keep moving', blurb: 'Your trail turns lethal.' },
  GRAVITY: { name: 'Gravity Shift', hint: 'A force is pulling you. Push against it', blurb: 'A force drags you off course.' },
  SURGE: { name: 'Surge', hint: 'Everything speeds up', blurb: 'Hazards and you move faster.' },
  SCANLINE: { name: 'Scanline', hint: 'Slip through the gap in the beam', blurb: 'Sweeping beams. Find the gap.' },
  PHANTOM: { name: 'Phantom', hint: 'You are invisible. Follow the pulse', blurb: 'You vanish. Track the pulse.' },
  HORIZON: { name: 'Event Horizon', hint: 'Stay inside the shrinking circle', blurb: 'A safe zone shrinks and drifts.' },
  GLITCH: { name: 'Glitch', hint: 'Hazards swerve and teleport', blurb: 'Hazards change course at random.' },
};

export type DeathCause =
  | 'drifter'
  | 'seeker'
  | 'collapse'
  | 'afterimage'
  | 'scanline'
  | 'horizon'
  | 'void'
  | 'timeout'
  | 'boss'
  | 'beam'
  | 'nova'
  | 'fall'
  | 'rotor';
export type GameMode = 'stage' | 'endless' | 'daily' | 'trial' | 'orbrush' | 'chaos' | 'bossrush';

/** Coordinated hazard formations that add variety on top of random spawns. */
export type PatternKind = 'wall' | 'pincer' | 'rain';

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
  grazed: boolean;
  blink?: { x: number; y: number; t: number }; // pending teleport
  weave?: number; // amplitude of a side-to-side wave (weaver hazards)
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface SweepPlan {
  axis: 'x' | 'y'; // 'x': a vertical beam travelling along x
  dir: 1 | -1;
  gap: number; // centre of the safe gap along the other axis
}

export interface Sweep extends SweepPlan {
  pos: number;
  prev: number;
  passed: boolean;
}

export interface Zone {
  x: number;
  y: number;
  r: number;
  tx: number;
  ty: number;
}

export interface Chaos {
  kind: ChaosKind;
  partner: ChaosKind | null; // a second rule running at the same time
  phase: 'warning' | 'active';
  remaining: number;
  duration: number;
  startedAt: number; // game time the current phase began
  gravity: Vec;
  clock: number; // seconds since the active phase began
  ticks: number; // per-event counter (beams launched, glitches fired)
  nextSweep: SweepPlan | null;
  zone: Zone | null;
}

export interface Orb {
  id: number;
  x: number;
  y: number;
  age: number;
  bonus: boolean; // worth more, but vanishes after a few seconds
}

export interface VoidTile {
  ix: number;
  iy: number;
  phase: 'warning' | 'active';
  timer: number;
}

export type BossAttackKind = 'burst' | 'beam' | 'summon' | 'nova' | 'twin';

export interface BossAttack {
  kind: BossAttackKind;
  phase: 'tell' | 'fire';
  timer: number;
  angle: number; // gap direction (burst, nova) or beam direction (beam, twin)
  spin: 1 | -1;
  radius: number; // nova: current ring radius
}

export interface Boss {
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  attack: BossAttack | null;
  cooldown: number;
  hitFlash: number;
  last: BossAttackKind | null;
  tier: number; // 0..4: unlocks attacks and speeds everything up
  shield: number; // seconds of phase-transition shield left
}

export interface GameStats {
  eventsSurvived: number;
  hazardsDodged: number;
  peakLevel: number;
  nearMisses: number;
  peakMultiplier: number;
  chaosSurvived: ChaosKind[];
  orbs: number;
  bonusOrbs: number;
  bosses: number; // bosses defeated this run
}

export type GameEvent =
  | { type: 'nearMiss'; x: number; y: number }
  | { type: 'gapPass'; x: number; y: number }
  | { type: 'chaosWarning'; kind: ChaosKind; partner: ChaosKind | null }
  | { type: 'chaosStart'; kind: ChaosKind; partner: ChaosKind | null }
  | { type: 'chaosEnd'; kind: ChaosKind }
  | { type: 'glitch' }
  | { type: 'teleport'; x: number; y: number }
  | { type: 'comboLost'; combo: number }
  | { type: 'death'; x: number; y: number; cause: DeathCause }
  | { type: 'warmupEnd' }
  | { type: 'milestone'; seconds: number; bonus: number }
  | { type: 'pattern'; kind: PatternKind }
  | { type: 'orb'; x: number; y: number; collected: number; target: number | null; bonus: boolean }
  | { type: 'phase'; index: number; count: number; name: string; hint: string }
  | { type: 'objectiveComplete' }
  | { type: 'bossSpawn'; tier: number; x: number; y: number }
  | { type: 'voidWarn' }
  | { type: 'bossTell'; kind: BossAttackKind }
  | { type: 'bossHit'; hp: number; x: number; y: number }
  | { type: 'bossDefeated'; x: number; y: number }
  | { type: 'victory' };

export interface EventSlot {
  kind: ChaosKind;
  from: number; // game time from which this event can be picked
}

export interface PatternSlot {
  kind: PatternKind;
  from: number;
}

/**
 * A phase of a level. Phases run in order; each starts when its trigger is met and layers its
 * settings on top of all earlier phases, so a level escalates step by step.
 */
export interface Phase {
  name: string;
  hint: string;
  at: { time?: number; orbs?: number; bossHp?: number }; // trigger (phase 0 starts immediately)
  set: Partial<GameConfig>;
  burst?: PatternKind; // a formation fired the moment the phase begins
}

/** How a run is won. Endless and Daily have no objective. */
export interface Objective {
  type: 'survive' | 'orbs' | 'boss';
  seconds?: number; // survive
  orbs?: number; // orbs
  timeLimit?: number; // orbs: fail when time runs out
}

export interface GameConfig {
  mode: GameMode;
  stage: number; // level/trial index, -1 otherwise
  objective: Objective | null;
  events: EventSlot[];
  firstEvent: ChaosKind | null; // forced first event (used to introduce a mechanic)
  firstChaosAt: number;
  gapBase: number;
  gapMin: number;
  gapPerLevel: number;
  gapRandom: number;
  warning: number; // chaos telegraph length
  activeDuration: number;
  pairs: [ChaosKind, ChaosKind][]; // if set, every event is one of these pairs
  pairChance: number; // chance an event gets a random partner from the pool
  warmup: number; // seconds of slow, chaos-free play at the start
  ramp: number; // seconds after the warm-up to reach full difficulty
  difficultyOffset: number; // seconds added to the difficulty clock
  difficultyRate: number; // how fast the difficulty clock runs
  spawnMul: number; // > 1 means fewer hazards
  hazardSpeed: number; // extra hazard speed multiplier
  seekersFrom: number; // game time seekers start appearing
  patterns: PatternSlot[];
  patternFirst: number; // game time of the first formation
  patternGap: number; // seconds between formations (plus up to 4s random)
  voids: boolean;
  shrink: { from: number; rate: number; max: number } | null;
  teleport: boolean; // GLITCH also teleports hazards
  boss: { hp: number } | null;
  orbField: boolean; // orbs spawn even without an orb objective (for score)
  orbCount: number; // orbs on the field at once
  orbMinDistance: number; // new orbs appear at least this far from the player
  bonusOrbChance: number;
  phases: Phase[];
  voidCount: number; // tiles that vanish per cycle
  voidCycle: number; // seconds between vanishing cycles
  voidWarn: number; // telegraph before a tile vanishes (kept >= 0.8 for fairness)
  weaveChance: number; // chance a hazard is a side-to-side weaver
  bossTier: number;
  bossRush: boolean; // endless chain of bosses instead of a single fight
  finishDelay: number;
  arena: ArenaDef; // playable geometry; a phase can swap in a new one
}

// Endless introduces one rule at a time, easiest first.
export const ENDLESS_CONFIG: GameConfig = {
  mode: 'endless',
  stage: -1,
  objective: null,
  events: [
    { kind: 'GRAVITY', from: 0 },
    { kind: 'COLLAPSE', from: 20 },
    { kind: 'INVERSION', from: 35 },
    { kind: 'AFTERIMAGE', from: 50 },
    { kind: 'SURGE', from: 65 },
    { kind: 'SCANLINE', from: 80 },
    { kind: 'PHANTOM', from: 95 },
    { kind: 'HORIZON', from: 110 },
    { kind: 'GLITCH', from: 125 },
  ],
  firstEvent: null,
  firstChaosAt: WARMUP + 5,
  gapBase: 8,
  gapMin: 3.5,
  gapPerLevel: 0.5,
  gapRandom: 3,
  warning: CHAOS_WARNING,
  activeDuration: CHAOS_ACTIVE,
  pairs: [],
  pairChance: 0,
  warmup: WARMUP,
  ramp: 10,
  difficultyOffset: 0,
  difficultyRate: 1,
  spawnMul: 1,
  hazardSpeed: 1,
  seekersFrom: 30,
  patterns: [
    { kind: 'wall', from: 25 },
    { kind: 'pincer', from: 45 },
    { kind: 'rain', from: 70 },
  ],
  patternFirst: WARMUP + 7,
  patternGap: 10,
  voids: false,
  shrink: null,
  teleport: false,
  boss: null,
  orbField: false,
  orbCount: 1,
  orbMinDistance: 220,
  bonusOrbChance: 0,
  phases: [],
  voidCount: 3,
  voidCycle: 2.3,
  voidWarn: 1,
  weaveChance: 0,
  bossTier: 0,
  bossRush: false,
  finishDelay: FINISH_DELAY,
  arena: OPEN_ARENA,
};

export interface GameState {
  config: GameConfig; // live settings: the base config plus every phase reached so far
  base: GameConfig;
  phase: number;
  finishing: number; // > 0 while the completion celebration plays
  bossRespawn: number; // Boss Rush: countdown to the next boss
  shrinkNow: number; // current Shrinking Arena border
  arenaStart: number; // game time the current arena geometry became active
  rng: () => number;
  time: number;
  status: 'playing' | 'over' | 'won';
  player: { x: number; y: number; vx: number; vy: number };
  hazards: Hazard[];
  sweeps: Sweep[];
  trail: TrailPoint[];
  orbs: Orb[];
  orbTimer: number;
  voids: VoidTile[];
  voidTimer: number;
  boss: Boss | null;
  trailClock: number;
  spawnTimer: number;
  patternTimer: number;
  milestoneIndex: number;
  warmupDone: boolean;
  chaos: Chaos | null;
  nextChaosIn: number;
  lastChaos: ChaosKind | null;
  firstEventUsed: boolean;
  inset: number;
  score: number;
  combo: number;
  comboTimer: number;
  stats: GameStats;
  cause: DeathCause | null;
  events: GameEvent[];
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const usesOrbs = (cfg: GameConfig) => cfg.orbField || cfg.boss !== null || cfg.objective?.type === 'orbs' || cfg.objective?.type === 'boss';

function newBoss(hp: number, tier: number, x = ARENA / 2, y = ARENA / 2): Boss {
  return { x, y, r: BOSS_RADIUS, hp, maxHp: hp, attack: null, cooldown: 0.6, hitFlash: 0, last: null, tier, shield: 0 };
}

/** Settings for a given phase: the base config with every phase's changes up to it applied in order. */
export function configForPhase(base: GameConfig, index: number): GameConfig {
  let c: GameConfig = base;
  for (let i = 0; i <= index && i < base.phases.length; i++) c = { ...c, ...base.phases[i].set };
  return c;
}

export function createGame(seed: number = Date.now(), base: GameConfig = ENDLESS_CONFIG): GameState {
  const config = configForPhase(base, 0);
  const s: GameState = {
    config,
    base,
    phase: 0,
    finishing: 0,
    bossRespawn: 0,
    shrinkNow: 0,
    arenaStart: 0,
    rng: mulberry32(seed),
    time: 0,
    status: 'playing',
    player: { x: config.arena.spawn.x, y: config.boss && config.arena === OPEN_ARENA ? ARENA * 0.8 : config.arena.spawn.y, vx: 0, vy: 0 },
    hazards: [],
    sweeps: [],
    trail: [],
    orbs: [],
    orbTimer: usesOrbs(config) ? Math.min(1, config.warmup) : Infinity,
    voids: [],
    voidTimer: 0.3, // counts down only once the warm-up is over

    boss: config.boss ? newBoss(config.boss.hp, config.bossTier, config.arena.circle?.cx ?? ARENA / 2, config.arena.circle?.cy ?? ARENA / 2) : null,
    trailClock: 0,
    spawnTimer: SPAWN_GRACE,
    patternTimer: config.patternFirst,
    milestoneIndex: 0,
    warmupDone: config.warmup <= 0,
    chaos: null,
    // Chaos never interrupts the warm-up.
    nextChaosIn: config.events.length > 0 || config.pairs.length > 0 ? Math.max(config.firstChaosAt, config.warmup + 0.5) : Infinity,
    lastChaos: null,
    firstEventUsed: false,
    inset: 0,
    score: 0,
    combo: 0,
    comboTimer: 0,
    stats: { eventsSurvived: 0, hazardsDodged: 0, peakLevel: 1, nearMisses: 0, peakMultiplier: 1, chaosSurvived: [], orbs: 0, bonusOrbs: 0, bosses: 0 },
    cause: null,
    events: [],
    nextId: 1,
  };
  return s;
}

// ---------- Arena ----------

/** Seconds since the current arena geometry became active (drives moving walls, bridges, collapses). */
export function arenaTime(s: GameState): number {
  return s.time - s.arenaStart;
}

const bounds = (s: GameState): Rect => s.config.arena.bounds;

// ---------- Phases ----------

function phaseReached(s: GameState, p: Phase): boolean {
  const at = p.at;
  if (at.time !== undefined && s.time < at.time) return false;
  if (at.orbs !== undefined && s.stats.orbs < at.orbs) return false;
  if (at.bossHp !== undefined && (!s.boss || s.boss.hp > at.bossHp)) return false;
  return true;
}

function updatePhases(s: GameState): void {
  const phases = s.base.phases;
  while (s.phase + 1 < phases.length && phaseReached(s, phases[s.phase + 1])) {
    s.phase++;
    const p = phases[s.phase];
    const hadChaos = s.config.events.length > 0 || s.config.pairs.length > 0;
    const oldArena = s.config.arena;
    s.config = configForPhase(s.base, s.phase);
    if (s.config.arena !== oldArena) s.arenaStart = s.time; // new geometry starts its own clock
    const hasChaos = s.config.events.length > 0 || s.config.pairs.length > 0;
    if (hasChaos && !hadChaos && !s.chaos) s.nextChaosIn = Math.min(s.nextChaosIn, 1.5);
    if (s.boss && s.boss.hp > 0) {
      // A new boss phase: brief shield, clear the board, then a harder pattern set.
      s.boss.tier = Math.max(s.boss.tier, s.config.bossTier);
      s.boss.attack = null;
      s.boss.shield = BOSS_SHIELD;
      s.boss.cooldown = BOSS_SHIELD;
      s.stats.hazardsDodged += s.hazards.length;
      s.hazards = [];
    }
    if (p.burst) spawnPattern(s, p.burst);
    s.events.push({ type: 'phase', index: s.phase, count: phases.length, name: p.name, hint: p.hint });
  }
}

/** 0 during the warm-up, rising smoothly to 1 over the ramp. */
export function rampOf(s: GameState): number {
  const { warmup, ramp } = s.config;
  if (ramp <= 0) return s.time >= warmup ? 1 : 0;
  return clamp((s.time - warmup) / ramp, 0, 1);
}

/**
 * The difficulty clock. It stands still during the warm-up; a stage's head start
 * is eased in over the ramp instead of applying from the first second.
 */
export function effectiveTime(s: GameState): number {
  return Math.max(0, s.time - s.config.warmup) * s.config.difficultyRate + s.config.difficultyOffset * rampOf(s);
}

/** Hazard speed scale: slow during the warm-up, full speed after the ramp. */
function paceOf(s: GameState): number {
  const ramp = rampOf(s);
  return (WARMUP_SPEED + (1 - WARMUP_SPEED) * ramp) * difficulty(effectiveTime(s)).speedMul * s.config.hazardSpeed;
}

export function multiplier(s: Pick<GameState, 'combo'>): number {
  return 1 + Math.min(s.combo, MAX_COMBO) * 0.1;
}

export function finalScore(s: GameState): number {
  return Math.floor(s.score + 1e-6);
}

/** Survival goal in seconds, if the objective has one. */
export function goalSeconds(cfg: GameConfig): number | null {
  return cfg.objective?.type === 'survive' ? cfg.objective.seconds ?? null : null;
}

export function chaosHas(c: Chaos | null, kind: ChaosKind): boolean {
  return c !== null && (c.kind === kind || c.partner === kind);
}

export function isActive(s: GameState, kind: ChaosKind): boolean {
  return s.chaos !== null && s.chaos.phase === 'active' && chaosHas(s.chaos, kind);
}

const GRAVITY_DIRECTIONS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function planSweep(s: GameState, previousAxis: 'x' | 'y' | null): SweepPlan {
  const axis = previousAxis ? (previousAxis === 'x' ? 'y' : 'x') : s.rng() < 0.5 ? 'x' : 'y';
  const dir = s.rng() < 0.5 ? 1 : -1;
  return { axis, dir, gap: 200 + s.rng() * 600 };
}

export function startChaos(s: GameState, kind: ChaosKind, phase: Chaos['phase'] = 'warning', partner: ChaosKind | null = null): void {
  const duration = phase === 'warning' ? s.config.warning : s.config.activeDuration;
  const both = (k: ChaosKind) => kind === k || partner === k;
  const gravity = both('GRAVITY') ? GRAVITY_DIRECTIONS[Math.floor(s.rng() * GRAVITY_DIRECTIONS.length)] : { x: 0, y: 0 };
  s.chaos = {
    kind,
    partner,
    phase,
    remaining: duration,
    duration,
    startedAt: s.time,
    gravity: { ...gravity },
    clock: 0,
    ticks: 0,
    nextSweep: both('SCANLINE') ? planSweep(s, null) : null,
    zone: both('HORIZON') ? { x: ARENA / 2, y: ARENA / 2, r: HORIZON_START, tx: ARENA / 2, ty: ARENA / 2 } : null,
  };
  s.lastChaos = kind;
  s.events.push(phase === 'warning' ? { type: 'chaosWarning', kind, partner } : { type: 'chaosStart', kind, partner });
}

// Pairs that would be unfair or visually unreadable together.
const INCOMPATIBLE: ReadonlyArray<[ChaosKind, ChaosKind]> = [
  ['COLLAPSE', 'HORIZON'],
  ['INVERSION', 'PHANTOM'],
  ['SCANLINE', 'HORIZON'],
];
export function compatible(a: ChaosKind, b: ChaosKind): boolean {
  return a !== b && !INCOMPATIBLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function pickChaos(s: GameState): [ChaosKind, ChaosKind | null] | null {
  const cfg = s.config;
  if (cfg.pairs.length > 0) {
    const options = cfg.pairs.length > 1 ? cfg.pairs.filter((p) => p[0] !== s.lastChaos) : cfg.pairs;
    const [a, b] = options[Math.floor(s.rng() * options.length)];
    return [a, b];
  }
  if (cfg.firstEvent && !s.firstEventUsed) {
    s.firstEventUsed = true;
    return [cfg.firstEvent, null];
  }
  const available = cfg.events.filter((e) => s.time >= e.from).map((e) => e.kind);
  if (available.length === 0) return null;
  const options = available.length > 1 ? available.filter((k) => k !== s.lastChaos) : available;
  const kind = options[Math.floor(s.rng() * options.length)];
  let partner: ChaosKind | null = null;
  if (cfg.pairChance > 0 && s.rng() < cfg.pairChance) {
    const partners = available.filter((k) => compatible(kind, k));
    if (partners.length > 0) partner = partners[Math.floor(s.rng() * partners.length)];
  }
  return [kind, partner];
}

function addCombo(s: GameState, amount: number): void {
  s.combo += amount;
  s.comboTimer = COMBO_WINDOW;
  s.stats.peakMultiplier = Math.max(s.stats.peakMultiplier, multiplier(s));
}

function updateChaos(s: GameState, dt: number): void {
  if (!s.chaos) {
    s.nextChaosIn -= dt;
    if (s.nextChaosIn <= 0) {
      const pick = pickChaos(s);
      if (pick) startChaos(s, pick[0], 'warning', pick[1]);
      else s.nextChaosIn = 2;
    }
    return;
  }
  const c = s.chaos;
  c.remaining -= dt;
  if (c.phase === 'active') c.clock += dt;
  if (c.remaining > 0) return;
  if (c.phase === 'warning') {
    c.phase = 'active';
    c.remaining = c.duration = s.config.activeDuration;
    c.startedAt = s.time;
    c.clock = 0;
    s.events.push({ type: 'chaosStart', kind: c.kind, partner: c.partner });
  } else {
    s.chaos = null;
    s.stats.eventsSurvived++;
    for (const k of [c.kind, c.partner]) if (k && !s.stats.chaosSurvived.includes(k)) s.stats.chaosSurvived.push(k);
    addCombo(s, c.partner ? 8 : 5);
    s.events.push({ type: 'chaosEnd', kind: c.kind });
    const cfg = s.config;
    const level = difficulty(effectiveTime(s)).level;
    s.nextChaosIn = Math.max(cfg.gapMin, cfg.gapBase - level * cfg.gapPerLevel) + s.rng() * cfg.gapRandom;
  }
}

function randomSpot(s: GameState, margin: number): Vec {
  const b = bounds(s);
  const mx = Math.min(margin, b.w / 2 - 1);
  const my = Math.min(margin, b.h / 2 - 1);
  return { x: b.x + mx + s.rng() * (b.w - 2 * mx), y: b.y + my + s.rng() * (b.h - 2 * my) };
}

function updateChaosEffects(s: GameState): void {
  const c = s.chaos;
  if (!c || c.phase !== 'active') return;
  if (chaosHas(c, 'SCANLINE')) {
    const total = Math.ceil(c.duration / SWEEP_INTERVAL);
    while (c.ticks < total && c.clock >= c.ticks * SWEEP_INTERVAL) {
      const plan = c.nextSweep ?? planSweep(s, null);
      const pos = plan.dir === 1 ? -SWEEP_HALF * 2 : ARENA + SWEEP_HALF * 2;
      s.sweeps.push({ ...plan, pos, prev: pos, passed: false });
      c.ticks++;
      c.nextSweep = c.ticks < total ? planSweep(s, plan.axis) : null;
    }
  } else if (chaosHas(c, 'GLITCH')) {
    while (c.ticks < Math.floor(c.clock / GLITCH_INTERVAL)) {
      c.ticks++;
      for (const h of s.hazards) {
        if (h.kind !== 'drifter' || h.blink) continue;
        if (s.config.teleport && s.rng() < 0.25) {
          // Teleport to a ring around the player and roughly re-aim at them. A ghost marks the spot
          // first and the hazard is intangible mid-jump, so it is threatening but never a cheap hit.
          const a = s.rng() * Math.PI * 2;
          const d = 230 + s.rng() * 100;
          const b = bounds(s);
          const x = clamp(s.player.x + Math.cos(a) * d, b.x + 30, b.x + b.w - 30);
          const y = clamp(s.player.y + Math.sin(a) * d, b.y + 30, b.y + b.h - 30);
          h.blink = { x, y, t: TELEPORT_TELL };
          continue;
        }
        const turn = (s.rng() < 0.5 ? -1 : 1) * (0.6 + s.rng() * 0.9);
        const speed = Math.hypot(h.vx, h.vy);
        const heading = Math.atan2(h.vy, h.vx) + turn;
        h.vx = Math.cos(heading) * speed;
        h.vy = Math.sin(heading) * speed;
      }
      s.events.push({ type: 'glitch' });
    }
  }
}

function updateZone(s: GameState, dt: number): void {
  const c = s.chaos;
  if (!c || !chaosHas(c, 'HORIZON') || c.phase !== 'active' || !c.zone) return;
  const z = c.zone;
  z.r = Math.max(HORIZON_MIN, z.r - HORIZON_SHRINK * dt);
  const dx = z.tx - z.x;
  const dy = z.ty - z.y;
  const dist = Math.hypot(dx, dy);
  const stepLen = HORIZON_DRIFT * dt;
  if (dist <= stepLen) {
    z.x = z.tx;
    z.y = z.ty;
    z.tx = 300 + s.rng() * 400;
    z.ty = 300 + s.rng() * 400;
  } else {
    z.x += (dx / dist) * stepLen;
    z.y += (dy / dist) * stepLen;
  }
}

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
  // Under INVERSION the player's own speed also eases in, so a wrong-way reflex is survivable.
  const adapt = isActive(s, 'INVERSION') ? adaptFactor(s) : 1;
  const speed = PLAYER_SPEED * (isActive(s, 'SURGE') ? SURGE_PLAYER_MUL : 1) * adapt;
  const p = s.player;
  const k = Math.min(1, dt * PLAYER_RESPONSE);
  p.vx += (ix * speed - p.vx) * k;
  p.vy += (iy * speed - p.vy) * k;

  let mx = p.vx;
  let my = p.vy;
  if (isActive(s, 'GRAVITY')) {
    mx += s.chaos!.gravity.x * GRAVITY_STRENGTH;
    my += s.chaos!.gravity.y * GRAVITY_STRENGTH;
  }
  p.x += mx * dt;
  p.y += my * dt;
  resolveBody(s.config.arena, arenaTime(s), p, PLAYER_HALF);
}

function updateTrail(s: GameState, dt: number): void {
  s.trailClock -= dt;
  if (s.trailClock <= 0) {
    s.trailClock = TRAIL_INTERVAL;
    s.trail.push({ x: s.player.x, y: s.player.y, t: s.time });
  }
  while (s.trail.length > 0 && s.time - s.trail[0].t > TRAIL_KEEP) s.trail.shift();
}

/** The steadily growing border of the Shrinking Arena, if any. */
export function shrinkInset(s: GameState): number {
  return s.shrinkNow;
}

function updateInset(s: GameState, dt: number): void {
  const sh = s.config.shrink;
  if (sh && s.time >= sh.from) s.shrinkNow = Math.min(sh.max, s.shrinkNow + sh.rate * dt);
  const target = Math.max(isActive(s, 'COLLAPSE') ? COLLAPSE_INSET : 0, shrinkInset(s));
  const delta = COLLAPSE_SPEED * dt;
  s.inset = s.inset < target ? Math.min(target, s.inset + delta) : Math.max(target, s.inset - delta);
}

// ---------- Vanishing Zone ----------

function updateVoids(s: GameState, dt: number): void {
  if (!s.config.voids) return;
  const kept: VoidTile[] = [];
  for (const v of s.voids) {
    v.timer -= dt;
    if (v.timer <= 0 && v.phase === 'warning') {
      v.phase = 'active';
      v.timer = VOID_ON;
    }
    if (v.timer > 0) kept.push(v);
  }
  s.voids = kept;
  if (s.time < s.config.warmup) return;
  s.voidTimer -= dt;
  if (s.voidTimer > 0) return;
  s.voidTimer = s.config.voidCycle;
  const count = s.config.voidCount;
  for (let n = 0, tries = 0; n < count && tries < 40; tries++) {
    const ix = Math.floor(s.rng() * VOID_GRID);
    const iy = Math.floor(s.rng() * VOID_GRID);
    if (s.voids.some((v) => v.ix === ix && v.iy === iy)) continue;
    s.voids.push({ ix, iy, phase: 'warning', timer: Math.max(0.8, s.config.voidWarn) });
    n++;
  }
  s.events.push({ type: 'voidWarn' });
}

export function inVoid(v: VoidTile, x: number, y: number, margin: number): boolean {
  const x0 = v.ix * VOID_TILE + margin;
  const y0 = v.iy * VOID_TILE + margin;
  return x > x0 && x < x0 + VOID_TILE - 2 * margin && y > y0 && y < y0 + VOID_TILE - 2 * margin;
}

// ---------- Orbs ----------

/** Whether a point is somewhere the player can safely stand right now (and will soon). */
function isSafeSpot(s: GameState, x: number, y: number, pad: number): boolean {
  // Orbs only go where the player can stand now and for the next three seconds.
  if (!standable(s.config.arena, arenaTime(s), x, y, Math.max(pad, PLAYER_HALF + 6), 3)) return false;
  const lo = Math.max(s.inset, shrinkInset(s) + (s.config.shrink ? s.config.shrink.rate * 2 : 0)) + pad;
  if (x < lo || x > ARENA - lo || y < lo || y > ARENA - lo) return false;
  if (s.voids.some((v) => inVoid(v, x, y, -pad))) return false;
  const z = s.chaos?.zone;
  if (z && chaosHas(s.chaos, 'HORIZON') && Math.hypot(x - z.x, y - z.y) > z.r - pad) return false;
  const b = s.boss;
  if (b && b.hp > 0 && Math.hypot(x - b.x, y - b.y) < b.r + 110) return false;
  return true;
}

function spawnOrb(s: GameState): void {
  let best: Vec | null = null;
  const minDistance = Math.max(ORB_MIN_DISTANCE, s.config.orbMinDistance);
  for (let i = 0; i < 60; i++) {
    const spot = randomSpot(s, 80);
    const far = Math.hypot(spot.x - s.player.x, spot.y - s.player.y) >= minDistance;
    if (isSafeSpot(s, spot.x, spot.y, 50) && far) {
      best = spot;
      break;
    }
    if (!best && isSafeSpot(s, spot.x, spot.y, 30)) best = spot;
  }
  const at = best ?? { x: ARENA / 2, y: ARENA * 0.25 };
  const bonus = s.config.bonusOrbChance > 0 && s.rng() < s.config.bonusOrbChance;
  s.orbs.push({ id: s.nextId++, x: at.x, y: at.y, age: 0, bonus });
}

function updateOrbs(s: GameState, dt: number): void {
  if (!usesOrbs(s.config)) return;
  for (const o of s.orbs) o.age += dt;
  // Relocate any orb that a closing wall, void or zone has made unreachable; bonus orbs expire.
  s.orbs = s.orbs.filter((o) => isSafeSpot(s, o.x, o.y, 20) && !(o.bonus && o.age > BONUS_ORB_LIFE));
  if (s.orbs.length < s.config.orbCount) {
    s.orbTimer -= dt;
    if (s.orbTimer <= 0) {
      spawnOrb(s);
      s.orbTimer = ORB_RESPAWN;
    }
  }
}

function collectOrbs(s: GameState): void {
  const p = s.player;
  const target = s.config.objective?.type === 'orbs' ? s.config.objective.orbs ?? null : null;
  for (const o of [...s.orbs]) {
    if (Math.hypot(o.x - p.x, o.y - p.y) > ORB_RADIUS + PLAYER_HIT_RADIUS + 4) continue;
    s.orbs = s.orbs.filter((x) => x !== o);
    s.stats.orbs++;
    if (o.bonus) s.stats.bonusOrbs++;
    s.score += (o.bonus ? BONUS_ORB_POINTS : ORB_POINTS) * multiplier(s);
    addCombo(s, o.bonus ? 6 : 3);
    s.orbTimer = ORB_RESPAWN;
    s.events.push({ type: 'orb', x: o.x, y: o.y, collected: s.stats.orbs, target, bonus: o.bonus });
    if (s.boss && s.boss.hp > 0 && s.boss.shield <= 0) damageBoss(s);
  }
}

// ---------- Boss ----------

function damageBoss(s: GameState): void {
  const b = s.boss!;
  b.hp = Math.max(0, b.hp - 1);
  b.hitFlash = 0.45;
  s.events.push({ type: 'bossHit', hp: b.hp, x: b.x, y: b.y });
  if (b.hp === 0) {
    b.attack = null;
    s.stats.bosses++;
    s.events.push({ type: 'bossDefeated', x: b.x, y: b.y });
    s.stats.hazardsDodged += s.hazards.length;
    s.hazards = [];
    if (s.config.bossRush) {
      s.score += 300 * s.stats.bosses * multiplier(s);
      s.bossRespawn = BOSS_RESPAWN;
    }
  }
}

/** Boss Rush: each new boss has more health and a higher tier. */
export function bossRushHp(defeated: number): number {
  return 3 + defeated * 2;
}

/** Where the next Boss Rush Core will appear: the centre if clear of the player, else the furthest inner spot. */
export function nextBossSpot(s: GameState): Vec {
  const p = s.player;
  const spots: Vec[] = [
    { x: ARENA / 2, y: ARENA / 2 },
    { x: 260, y: 260 },
    { x: ARENA - 260, y: 260 },
    { x: 260, y: ARENA - 260 },
    { x: ARENA - 260, y: ARENA - 260 },
  ];
  const dist = (v: Vec) => Math.hypot(v.x - p.x, v.y - p.y);
  return dist(spots[0]) >= BOSS_RADIUS + 200 ? spots[0] : spots.reduce((a, b) => (dist(b) > dist(a) ? b : a));
}

function updateBossRush(s: GameState, dt: number): void {
  const b = s.boss;
  if (!s.config.bossRush || !b || b.hp > 0) return;
  s.bossRespawn -= dt;
  if (s.bossRespawn > 0) return;
  const { x, y } = nextBossSpot(s);
  const tier = Math.min(4, s.stats.bosses);
  s.boss = newBoss(bossRushHp(s.stats.bosses), tier, x, y);
  s.boss.shield = 1;
  s.boss.cooldown = 1.2;
  s.events.push({ type: 'bossSpawn', tier, x, y });
}

function bossRage(b: Boss): number {
  return 1 - b.hp / b.maxHp;
}

/** Attacks unlocked at each boss tier. */
export function bossAttacks(tier: number): BossAttackKind[] {
  const list: BossAttackKind[] = ['burst', 'summon'];
  if (tier >= 1) list.push('beam');
  if (tier >= 2) list.push('nova');
  if (tier >= 3) list.push('twin');
  return list;
}

function updateBoss(s: GameState, dt: number): void {
  const b = s.boss;
  if (!b || b.hp <= 0) return;
  b.hitFlash = Math.max(0, b.hitFlash - dt);
  b.shield = Math.max(0, b.shield - dt);
  if (s.time < s.config.warmup || b.shield > 0) return;
  const rage = bossRage(b);
  const haste = 1 + b.tier * 0.1;
  if (!b.attack) {
    b.cooldown -= dt;
    if (b.cooldown > 0) return;
    const options = bossAttacks(b.tier);
    const fresh = options.filter((k) => k !== b.last);
    const kind = fresh[Math.floor(s.rng() * fresh.length)];
    const towardPlayer = Math.atan2(s.player.y - b.y, s.player.x - b.x);
    b.attack = {
      kind,
      phase: 'tell',
      // Shockwaves and twin beams are harder to read, so they get a longer warning.
      timer: (kind === 'nova' || kind === 'twin' ? BOSS_TELL + 0.3 : BOSS_TELL) * (1 - rage * 0.2),
      // A beam starts behind the Core, twin beams at right angles to you: never on top of the player.
      angle: kind === 'beam' ? towardPlayer + Math.PI : kind === 'twin' ? towardPlayer + Math.PI / 2 : s.rng() * Math.PI * 2,
      spin: s.rng() < 0.5 ? 1 : -1,
      radius: b.r,
    };
    b.last = kind;
    s.events.push({ type: 'bossTell', kind });
    return;
  }
  const a = b.attack;
  a.timer -= dt;
  if (a.phase === 'tell') {
    if (a.timer > 0) return;
    if (a.kind === 'burst') {
      const count = 14 + Math.round(rage * 4) + b.tier * 2;
      const speed = 190 * (1 + rage * 0.2) * haste * paceOf(s);
      for (let i = 3; i < count; i++) {
        const ang = a.angle + (i / count) * Math.PI * 2;
        addDrifter(s, b.x + Math.cos(ang) * b.r, b.y + Math.sin(ang) * b.r, Math.cos(ang) * speed, Math.sin(ang) * speed, 11);
      }
      endBossAttack(s);
    } else if (a.kind === 'summon') {
      const options: PatternKind[] = b.tier >= 2 ? ['pincer', 'wall', 'rain'] : ['pincer', 'wall'];
      spawnPattern(s, options[Math.floor(s.rng() * options.length)]);
      endBossAttack(s);
    } else {
      a.phase = 'fire';
      a.timer = a.kind === 'nova' ? Infinity : BEAM_TIME;
    }
    return;
  }
  if (a.kind === 'nova') {
    // Expanding shockwave: slip through its gap.
    a.radius += NOVA_SPEED * haste * dt;
    if (a.radius > ARENA * 1.5) endBossAttack(s);
    return;
  }
  // Beam firing: sweep around the boss.
  a.angle += a.spin * BEAM_SPEED * (1 + rage * 0.2) * (a.kind === 'twin' ? 0.8 : haste) * dt;
  if (a.timer <= 0) endBossAttack(s);
}

function endBossAttack(s: GameState): void {
  const b = s.boss!;
  b.attack = null;
  b.cooldown = (1.6 - bossRage(b) * 0.5) / (1 + b.tier * 0.12);
}

// ---------- Hazards ----------

function seekerChance(s: GameState): number {
  const since = s.time - Math.max(s.config.seekersFrom, s.config.warmup + s.config.ramp);
  return since < 0 ? 0 : Math.min(0.35, 0.12 + since * 0.004);
}

function addDrifter(s: GameState, x: number, y: number, vx: number, vy: number, r: number): void {
  s.hazards.push({ id: s.nextId++, kind: 'drifter', x, y, vx, vy, r, age: 0, life: Infinity, grazed: false });
}

/** A drifter entering from `side` (0 top, 1 right, 2 bottom, 3 left) at `along`, moving straight in. */
function addInward(s: GameState, side: number, along: number, speed: number, r: number): void {
  // `along` is 0..ARENA across the edge; map it onto this arena's bounds.
  const b = bounds(s);
  const ax = b.x + (along / ARENA) * b.w;
  const ay = b.y + (along / ARENA) * b.h;
  if (side === 0) addDrifter(s, ax, b.y - r, 0, speed, r);
  else if (side === 1) addDrifter(s, b.x + b.w + r, ay, -speed, 0, r);
  else if (side === 2) addDrifter(s, ax, b.y + b.h + r, 0, -speed, r);
  else addDrifter(s, b.x - r, ay, speed, 0, r);
}

function pickSide(s: GameState): number {
  const sides = s.config.arena.spawnSides ?? [0, 1, 2, 3];
  return sides[Math.floor(s.rng() * sides.length)];
}

export function spawnPattern(s: GameState, kind: PatternKind): void {
  const pace = paceOf(s);
  const side = pickSide(s);
  if (kind === 'wall') {
    // A slow line of hazards with a two-slot gap to slip through.
    const slots = 8;
    const gap = 1 + Math.floor(s.rng() * (slots - 3));
    for (let i = 0; i < slots; i++) {
      if (i === gap || i === gap + 1) continue;
      addInward(s, side, ((i + 0.5) * ARENA) / slots, 140 * pace, 16);
    }
  } else if (kind === 'rain') {
    // A fast parallel shower of small hazards from one edge.
    for (let i = 0; i < 6; i++) addInward(s, side, 40 + s.rng() * (ARENA - 80), (220 + s.rng() * 90) * pace, 8);
  } else {
    // Pincer: one hazard from each edge, all aimed where the player is now. Move to dodge.
    const p = s.player;
    const b = bounds(s);
    for (const edge of s.config.arena.spawnSides ?? [0, 1, 2, 3]) {
      const along = (edge % 2 === 0 ? p.x : p.y) + (s.rng() - 0.5) * 160;
      const cx = clamp(along, b.x + 20, b.x + b.w - 20);
      const cy = clamp(along, b.y + 20, b.y + b.h - 20);
      const [x, y] =
        edge === 0 ? [cx, b.y - 12] : edge === 1 ? [b.x + b.w + 12, cy] : edge === 2 ? [cx, b.y + b.h + 12] : [b.x - 12, cy];
      const a = Math.atan2(p.y - y, p.x - x);
      addDrifter(s, x, y, Math.cos(a) * 170 * pace, Math.sin(a) * 170 * pace, 12);
    }
  }
  s.events.push({ type: 'pattern', kind });
}

function updatePatterns(s: GameState, dt: number): void {
  const cfg = s.config;
  if (cfg.patterns.length === 0) return;
  s.patternTimer -= dt;
  if (s.patternTimer > 0) return;
  // Never stack a formation on top of a chaos warning.
  if (s.chaos?.phase === 'warning') {
    s.patternTimer = 1.5;
    return;
  }
  const available = cfg.patterns.filter((p) => s.time >= p.from);
  if (available.length === 0) {
    s.patternTimer = 2;
    return;
  }
  spawnPattern(s, available[Math.floor(s.rng() * available.length)].kind);
  s.patternTimer = cfg.patternGap + s.rng() * 4;
}

function updateMilestones(s: GameState): void {
  if (!s.warmupDone && s.time >= s.config.warmup) {
    s.warmupDone = true;
    s.events.push({ type: 'warmupEnd' });
  }
  while (s.milestoneIndex < MILESTONES.length && s.time >= MILESTONES[s.milestoneIndex]) {
    const bonus = milestoneBonus(s.milestoneIndex);
    s.score += bonus;
    addCombo(s, 2);
    s.events.push({ type: 'milestone', seconds: MILESTONES[s.milestoneIndex], bonus });
    s.milestoneIndex++;
  }
}

function spawnHazard(s: GameState): void {
  const seeker = s.rng() < seekerChance(s);
  const r = seeker ? 13 : 9 + s.rng() * 13;
  const side = pickSide(s);
  const b = bounds(s);
  const ax = b.x + s.rng() * b.w;
  const ay = b.y + s.rng() * b.h;
  let x: number;
  let y: number;
  if (side === 0) [x, y] = [ax, b.y - r];
  else if (side === 1) [x, y] = [b.x + b.w + r, ay];
  else if (side === 2) [x, y] = [ax, b.y + b.h + r];
  else [x, y] = [b.x - r, ay];

  // Aim at a random point in the middle of the arena so hazards always cross it.
  const tx = b.x + b.w * (0.2 + s.rng() * 0.6);
  const ty = b.y + b.h * (0.2 + s.rng() * 0.6);
  const speed = (seeker ? 120 : 170 + s.rng() * 90) * paceOf(s);
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
    grazed: false,
    weave: !seeker && s.config.weaveChance > 0 && s.rng() < s.config.weaveChance ? 70 + s.rng() * 50 : undefined,
  });
}

function updateSpawning(s: GameState, dt: number): void {
  if (s.boss && s.boss.hp <= 0) return;
  s.spawnTimer -= dt;
  if (s.spawnTimer > 0) return;
  spawnHazard(s);
  const surge = isActive(s, 'SURGE') ? 0.7 : 1;
  // Events that restrict where you can go get fewer hazards, so the rule is the challenge, not a pile-up.
  const restricting = isActive(s, 'AFTERIMAGE') || isActive(s, 'COLLAPSE') || isActive(s, 'HORIZON') ? 1.35 : 1;
  const ramp = rampOf(s);
  const full = difficulty(effectiveTime(s)).spawnInterval * s.config.spawnMul;
  const interval = WARMUP_SPAWN_INTERVAL * Math.max(1, s.config.spawnMul) + (full - WARMUP_SPAWN_INTERVAL * Math.max(1, s.config.spawnMul)) * ramp;
  s.spawnTimer += interval * surge * restricting * (0.75 + s.rng() * 0.5);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 0.5 at the moment a chaos event activates, easing back to 1 over ADAPT_TIME. */
export function adaptFactor(s: GameState): number {
  const c = s.chaos;
  if (!c || c.phase !== 'active' || c.clock >= ADAPT_TIME) return 1;
  return 0.5 + 0.5 * (c.clock / ADAPT_TIME);
}

function updateHazards(s: GameState, dt: number): void {
  const p = s.player;
  const pace = (isActive(s, 'SURGE') ? SURGE_HAZARD_MUL : 1) * adaptFactor(s);
  const kept: Hazard[] = [];
  for (const h of s.hazards) {
    h.age += dt;
    if (h.blink) {
      h.blink.t -= dt;
      if (h.blink.t <= 0) {
        h.x = h.blink.x;
        h.y = h.blink.y;
        h.blink = undefined;
        const speed = Math.hypot(h.vx, h.vy);
        const aim = Math.atan2(p.y - h.y, p.x - h.x) + (s.rng() - 0.5) * 0.7;
        h.vx = Math.cos(aim) * speed;
        h.vy = Math.sin(aim) * speed;
        s.events.push({ type: 'teleport', x: h.x, y: h.y });
      }
    }
    if (h.kind === 'seeker') {
      const speed = Math.hypot(h.vx, h.vy);
      const heading = Math.atan2(h.vy, h.vx);
      const wanted = Math.atan2(p.y - h.y, p.x - h.x);
      const turn = clamp(wrapAngle(wanted - heading), -SEEKER_TURN_RATE * dt, SEEKER_TURN_RATE * dt);
      h.vx = Math.cos(heading + turn) * speed;
      h.vy = Math.sin(heading + turn) * speed;
    }
    h.x += h.vx * dt * pace;
    h.y += h.vy * dt * pace;
    if (h.weave) {
      // Side-to-side wave across its path: unpredictable-looking but smooth and readable.
      const sp = Math.hypot(h.vx, h.vy) || 1;
      const side = h.weave * 2.6 * Math.cos(h.age * 2.6) * dt * pace;
      h.x += (-h.vy / sp) * side;
      h.y += (h.vx / sp) * side;
    }
    if (!h.blink) bounceHazard(s.config.arena, arenaTime(s), h);
    const bb = bounds(s);
    const inBounds =
      h.x > bb.x - OFFSCREEN_MARGIN && h.x < bb.x + bb.w + OFFSCREEN_MARGIN && h.y > bb.y - OFFSCREEN_MARGIN && h.y < bb.y + bb.h + OFFSCREEN_MARGIN;
    if (inBounds && h.age < h.life) kept.push(h);
    else s.stats.hazardsDodged++;
  }
  s.hazards = kept;
}

function updateSweeps(s: GameState, dt: number): void {
  const kept: Sweep[] = [];
  for (const sw of s.sweeps) {
    sw.prev = sw.pos;
    sw.pos += sw.dir * SWEEP_SPEED * dt;
    if (sw.pos > -SWEEP_HALF * 4 && sw.pos < ARENA + SWEEP_HALF * 4) kept.push(sw);
  }
  s.sweeps = kept;
}

function die(s: GameState, cause: DeathCause): void {
  s.status = 'over';
  s.cause = cause;
  s.events.push({ type: 'death', x: s.player.x, y: s.player.y, cause });
}

/** Whether the boss beam currently overlaps a point (with extra radius). */
function rayHits(b: Boss, angle: number, x: number, y: number, radius: number): boolean {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const rx = x - b.x;
  const ry = y - b.y;
  const along = rx * dx + ry * dy;
  if (along < b.r - 6) return false;
  return Math.abs(rx * dy - ry * dx) < BEAM_HALF + radius;
}

/** Whether the boss beam (or twin beams) currently overlaps a point (with extra radius). */
export function beamHits(b: Boss, x: number, y: number, radius: number): boolean {
  const a = b.attack;
  if (!a || a.phase !== 'fire') return false;
  if (a.kind === 'beam') return rayHits(b, a.angle, x, y, radius);
  if (a.kind === 'twin') return rayHits(b, a.angle, x, y, radius) || rayHits(b, a.angle + Math.PI, x, y, radius);
  return false;
}

/** Whether the expanding shockwave overlaps a point, outside its safe gap. */
export function novaHits(b: Boss, x: number, y: number, radius: number): boolean {
  const a = b.attack;
  if (!a || a.kind !== 'nova' || a.phase !== 'fire') return false;
  const d = Math.hypot(x - b.x, y - b.y);
  if (Math.abs(d - a.radius) > NOVA_HALF + radius) return false;
  const off = Math.atan2(Math.sin(Math.atan2(y - b.y, x - b.x) - a.angle), Math.cos(Math.atan2(y - b.y, x - b.x) - a.angle));
  return Math.abs(off) > NOVA_GAP;
}

function checkCollisions(s: GameState): void {
  const p = s.player;

  for (const h of s.hazards) {
    if (h.blink && h.blink.t < TELEPORT_TELL * 0.5) continue; // mid-teleport: intangible
    const gap = Math.hypot(h.x - p.x, h.y - p.y) - (h.r + PLAYER_HIT_RADIUS);
    if (gap < 0) return die(s, h.kind);
    if (!h.grazed && gap < NEAR_MISS_DISTANCE) {
      h.grazed = true;
      s.stats.nearMisses++;
      addCombo(s, 1);
      s.events.push({ type: 'nearMiss', x: (h.x + p.x) / 2, y: (h.y + p.y) / 2 });
    }
  }

  for (const sw of s.sweeps) {
    const along = sw.axis === 'x' ? p.x : p.y;
    const across = sw.axis === 'x' ? p.y : p.x;
    const inGap = Math.abs(across - sw.gap) < SWEEP_GAP_HALF - PLAYER_HIT_RADIUS;
    if (Math.abs(along - sw.pos) < SWEEP_HALF + PLAYER_HIT_RADIUS && !inGap) return die(s, 'scanline');
    if (!sw.passed && (sw.prev - along) * (sw.pos - along) <= 0) {
      sw.passed = true;
      addCombo(s, 2);
      s.events.push({ type: 'gapPass', x: p.x, y: p.y });
    }
  }

  if (s.inset > 0.5) {
    const lo = s.inset;
    const hi = ARENA - s.inset;
    if (p.x - PLAYER_HIT_RADIUS < lo || p.x + PLAYER_HIT_RADIUS > hi || p.y - PLAYER_HIT_RADIUS < lo || p.y + PLAYER_HIT_RADIUS > hi) {
      return die(s, 'collapse');
    }
  }

  for (const v of s.voids) if (v.phase === 'active' && inVoid(v, p.x, p.y, VOID_MARGIN)) return die(s, 'void');

  const arena = s.config.arena;
  const at = arenaTime(s);
  if (!onFloor(arena, at, p.x, p.y)) return die(s, 'fall');
  for (const rot of arena.rotors) if (rotorHits(rot, at, p.x, p.y, PLAYER_HIT_RADIUS)) return die(s, 'rotor');

  const b = s.boss;
  if (b && b.hp > 0) {
    if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + PLAYER_HIT_RADIUS) return die(s, 'boss');
    if (beamHits(b, p.x, p.y, PLAYER_HIT_RADIUS)) return die(s, 'beam');
    if (novaHits(b, p.x, p.y, PLAYER_HIT_RADIUS)) return die(s, 'nova');
  }

  if (isActive(s, 'HORIZON') && s.chaos!.zone) {
    const z = s.chaos!.zone;
    if (Math.hypot(p.x - z.x, p.y - z.y) + PLAYER_HIT_RADIUS > z.r) return die(s, 'horizon');
  }

  if (isActive(s, 'AFTERIMAGE') && s.chaos!.clock >= AFTERIMAGE_GRACE) {
    const since = s.chaos!.startedAt;
    for (const tp of s.trail) {
      if (tp.t < since) continue; // only trail laid down after the event began counts
      const age = s.time - tp.t;
      if (age < AFTERIMAGE_ARM || age > AFTERIMAGE_LIFE) continue;
      if (Math.hypot(tp.x - p.x, tp.y - p.y) < TRAIL_HIT_RADIUS + PLAYER_HIT_RADIUS) return die(s, 'afterimage');
    }
  }
}

/** Objective met: clear the board and play a short celebration before the victory screen. */
function win(s: GameState, bonus = 0): void {
  s.score += bonus;
  s.stats.hazardsDodged += s.hazards.length;
  s.hazards = [];
  s.sweeps = [];
  s.voids = [];
  s.chaos = null;
  s.finishing = Math.max(0.0001, s.config.finishDelay);
  s.events.push({ type: 'objectiveComplete' });
}

function checkObjective(s: GameState): void {
  const o = s.config.objective;
  if (!o || s.status !== 'playing') return;
  if (o.type === 'survive' && o.seconds !== undefined && s.time >= o.seconds) return win(s);
  if (o.type === 'orbs' && o.orbs !== undefined) {
    if (s.stats.orbs >= o.orbs) return win(s, o.timeLimit ? Math.max(0, o.timeLimit - s.time) * 20 : 0);
    if (o.timeLimit !== undefined && s.time >= o.timeLimit) return die(s, 'timeout');
  }
  if (o.type === 'boss' && s.boss && s.boss.hp <= 0) return win(s, 250);
}

/** Advance the simulation by dt seconds. Callers should keep dt small (<= 1/60). */
export function step(s: GameState, input: Vec, dt: number): void {
  if (s.status !== 'playing') return;
  if (s.finishing > 0) {
    // Celebration: the player can move, nothing can hurt them.
    updatePlayer(s, input, dt);
    s.finishing -= dt;
    if (s.finishing <= 0) {
      s.status = 'won';
      s.events.push({ type: 'victory' });
    }
    return;
  }
  s.time += dt;
  s.score += POINTS_PER_SECOND * multiplier(s) * dt;
  if (s.combo > 0) {
    s.comboTimer -= dt;
    if (s.comboTimer <= 0) {
      s.events.push({ type: 'comboLost', combo: s.combo });
      s.combo = 0;
    }
  }
  updateChaos(s, dt);
  updateChaosEffects(s);
  updatePlayer(s, input, dt);
  updateTrail(s, dt);
  updateInset(s, dt);
  updateZone(s, dt);
  updateVoids(s, dt);
  updateBoss(s, dt);
  updateBossRush(s, dt);
  updateSpawning(s, dt);
  updatePatterns(s, dt);
  updateHazards(s, dt);
  updateSweeps(s, dt);
  updateOrbs(s, dt);
  collectOrbs(s);
  checkCollisions(s);
  if (s.status === 'playing') updateMilestones(s);
  s.stats.peakLevel = Math.max(s.stats.peakLevel, difficulty(effectiveTime(s)).level);
  checkObjective(s);
  if (s.status === 'playing' && s.finishing <= 0) updatePhases(s);
}
