import { ENDLESS_CONFIG, WARMUP, type ChaosKind, type GameConfig, type Objective } from './engine';

/** Background pattern drawn behind each level, giving it its own visual identity. */
export type Motif = 'grid' | 'mirror' | 'frame' | 'dots' | 'currents' | 'speed' | 'scan' | 'void' | 'rings' | 'noise';

export interface StageDef {
  name: string;
  tagline: string;
  objective: Objective;
  difficulty: 1 | 2 | 3 | 4 | 5;
  accent: [number, number, number]; // the level's neon colour for the environment, orbs and UI
  motif: Motif;
  heat: number; // 0..1 strength of the accent vignette
  mechanics: string[]; // short labels shown on the level card
  teaser: string; // shown on the locked preview, hints without spoiling
  overrides: Partial<GameConfig>;
  stars: [number, number]; // score needed for 2 and 3 stars
}

/** Shared settings for short, focused levels. */
const LEVEL_BASE: GameConfig = {
  ...ENDLESS_CONFIG,
  mode: 'stage',
  events: [],
  firstEvent: null,
  firstChaosAt: 3,
  gapBase: 3,
  gapMin: 1.2,
  gapPerLevel: 0,
  gapRandom: 2,
  warning: 1,
  activeDuration: 4,
  warmup: 1.5,
  ramp: 3,
  difficultyOffset: 0,
  difficultyRate: 1,
  seekersFrom: Infinity,
  patterns: [],
  patternFirst: 3,
  patternGap: 4,
};

export const STAGES: readonly StageDef[] = [
  {
    name: 'Beginner',
    tagline: 'Slow hazards. Learn to move.',
    objective: { type: 'survive', seconds: 5 },
    difficulty: 1,
    accent: [79, 227, 240],
    motif: 'grid',
    heat: 0,
    mechanics: ['Movement'],
    teaser: 'Your first five seconds.',
    overrides: { warmup: 5, ramp: 2, hazardSpeed: 0.9 },
    stars: [58, 70],
  },
  {
    name: 'Speed Rush',
    tagline: 'Same rules. Much faster.',
    objective: { type: 'survive', seconds: 8 },
    difficulty: 1,
    accent: [255, 181, 71],
    motif: 'speed',
    heat: 0.15,
    mechanics: ['Fast hazards'],
    teaser: 'Everything moves at double time.',
    overrides: { warmup: 1, ramp: 2, difficultyOffset: 6, hazardSpeed: 1.45 },
    stars: [92, 112],
  },
  {
    name: 'Orb Hunt',
    tagline: 'Collect 3 orbs while dodging.',
    objective: { type: 'orbs', orbs: 3 },
    difficulty: 2,
    accent: [91, 240, 138],
    motif: 'dots',
    heat: 0.15,
    mechanics: ['Orbs'],
    teaser: 'Something worth chasing appears.',
    overrides: { warmup: 1.5, ramp: 3, difficultyOffset: 6 },
    stars: [280, 300],
  },
  {
    name: 'Reverse Control',
    tagline: 'Your controls flip at random. Watch for the warning.',
    objective: { type: 'survive', seconds: 8 },
    difficulty: 2,
    accent: [255, 79, 216],
    motif: 'mirror',
    heat: 0.2,
    mechanics: ['Random inversion'],
    teaser: 'Left is right. Until it isn’t.',
    overrides: {
      warmup: 1,
      ramp: 3,
      events: [{ kind: 'INVERSION', from: 0 }],
      firstChaosAt: 1.5,
      warning: 0.7,
      gapBase: 1.4,
      gapMin: 0.8,
      gapRandom: 1.2,
      activeDuration: 1.6,
      difficultyOffset: 0,
      spawnMul: 1.4,
    },
    stars: [115, 140],
  },
  {
    name: 'The Vanishing Zone',
    tagline: 'Parts of the arena blink out of existence.',
    objective: { type: 'survive', seconds: 10 },
    difficulty: 3,
    accent: [155, 123, 255],
    motif: 'void',
    heat: 0.25,
    mechanics: ['Vanishing floor'],
    teaser: 'The floor is not as solid as it looks.',
    overrides: { voids: true, warmup: 1.5, ramp: 3, difficultyOffset: 4, spawnMul: 1.35 },
    stars: [145, 175],
  },
  {
    name: 'Double Chaos',
    tagline: 'Two rules at once. Collect 5 orbs.',
    objective: { type: 'orbs', orbs: 5 },
    difficulty: 3,
    accent: [255, 122, 61],
    motif: 'currents',
    heat: 0.3,
    mechanics: ['Paired chaos', 'Orbs'],
    teaser: 'One rule was never the problem.',
    overrides: {
      pairs: [
        ['GRAVITY', 'INVERSION'],
        ['COLLAPSE', 'SURGE'],
        ['AFTERIMAGE', 'GRAVITY'],
        ['SURGE', 'INVERSION'],
      ],
      firstChaosAt: 2.5,
      warning: 1.2,
      activeDuration: 3.5,
      gapBase: 2.5,
      gapRandom: 1.5,
      difficultyOffset: 4,
      spawnMul: 1.35,
    },
    stars: [900, 1050],
  },
  {
    name: 'Glitch Attack',
    tagline: 'Distortion. Teleports. Nothing moves straight.',
    objective: { type: 'survive', seconds: 10 },
    difficulty: 4,
    accent: [198, 255, 74],
    motif: 'noise',
    heat: 0.35,
    mechanics: ['Glitch', 'Teleporting hazards'],
    teaser: 'Signal lost.',
    overrides: {
      events: [{ kind: 'GLITCH', from: 0 }],
      firstChaosAt: 1.2,
      warning: 0.8,
      activeDuration: 20,
      teleport: true,
      warmup: 1,
      difficultyOffset: 18,
      spawnMul: 0.7,
      hazardSpeed: 1.15,
    },
    stars: [145, 175],
  },
  {
    name: 'Shrinking Arena',
    tagline: 'The walls never stop moving in.',
    objective: { type: 'survive', seconds: 12 },
    difficulty: 4,
    accent: [255, 59, 92],
    motif: 'frame',
    heat: 0.4,
    mechanics: ['Shrinking walls'],
    teaser: 'Room to breathe is a luxury.',
    overrides: { shrink: { from: 1.5, rate: 32, max: 340 }, warmup: 1, difficultyOffset: 16, spawnMul: 0.85 },
    stars: [170, 205],
  },
  {
    name: 'Chaos Combo',
    tagline: 'Random mixes of every rule. 7 orbs in 15 seconds.',
    objective: { type: 'orbs', orbs: 7, timeLimit: 15 },
    difficulty: 5,
    accent: [61, 139, 255],
    motif: 'rings',
    heat: 0.45,
    mechanics: ['Random combos', 'Orbs', 'Time limit'],
    teaser: 'Everything you have learned. At once.',
    overrides: {
      events: (['INVERSION', 'GRAVITY', 'SURGE', 'GLITCH', 'AFTERIMAGE', 'COLLAPSE'] as ChaosKind[]).map((kind) => ({ kind, from: 0 })),
      pairChance: 0.45,
      firstChaosAt: 2,
      warning: 1,
      activeDuration: 3,
      gapBase: 2,
      gapRandom: 1.5,
      warmup: 1,
      difficultyOffset: 7,
      spawnMul: 1.35,
      orbCount: 2,
    },
    stars: [1240, 1350],
  },
  {
    name: 'Final Showdown',
    tagline: 'The Core awakens. Feed it 5 orbs to break it.',
    objective: { type: 'boss' },
    difficulty: 5,
    accent: [255, 213, 74],
    motif: 'scan',
    heat: 0.6,
    mechanics: ['Boss', 'Beams', 'Bursts'],
    teaser: 'Something is waiting at the centre.',
    overrides: { boss: { hp: 5 }, warmup: 2, ramp: 4, difficultyOffset: 8, spawnMul: 2.4 },
    stars: [1040, 1200],
  },
];

export function stageConfig(index: number): GameConfig {
  const st = STAGES[index];
  return { ...LEVEL_BASE, ...st.overrides, mode: 'stage', stage: index, objective: st.objective };
}

export function starThresholds(index: number): [number, number] {
  return STAGES[index].stars;
}

/** 1 star for clearing; 2 and 3 for scoring well (combos, near misses, speed). */
export function starsFor(index: number, score: number): number {
  const [two, three] = starThresholds(index);
  return score >= three ? 3 : score >= two ? 2 : 1;
}

/** Plain-language objective, e.g. "Survive 8s" or "Collect 7 orbs in 15s". */
export function objectiveText(o: Objective): string {
  if (o.type === 'survive') return `Survive ${o.seconds}s`;
  if (o.type === 'orbs') return `Collect ${o.orbs} orbs${o.timeLimit ? ` in ${o.timeLimit}s` : ''}`;
  return 'Defeat the Core';
}

// ---------- Trials (bonus challenges in the demo premium tier) ----------

export interface TrialDef {
  name: string;
  tagline: string;
  objective: Objective;
  accent: [number, number, number];
  motif: Motif;
  config: Partial<GameConfig>;
}

export const TRIALS: readonly TrialDef[] = [
  {
    name: 'Orb Frenzy',
    tagline: 'Grab as many orbs as you can in 45 seconds.',
    objective: { type: 'survive', seconds: 45 },
    accent: [91, 240, 138],
    motif: 'dots',
    config: {
      orbField: true,
      events: (['GRAVITY', 'SURGE', 'INVERSION'] as ChaosKind[]).map((kind) => ({ kind, from: 0 })),
      firstChaosAt: 6,
      gapBase: 5,
      gapRandom: 3,
      warmup: 2,
      difficultyOffset: 8,
    },
  },
  {
    name: 'Boss Rush',
    tagline: 'A tougher Core with 8 hit points and no mercy.',
    objective: { type: 'boss' },
    accent: [255, 59, 92],
    motif: 'scan',
    config: { boss: { hp: 8 }, warmup: 2, ramp: 3, difficultyOffset: 16, spawnMul: 1.9 },
  },
];

export function trialConfig(index: number): GameConfig {
  const t = TRIALS[index];
  return { ...LEVEL_BASE, ...t.config, mode: 'trial', stage: index, objective: t.objective };
}

// ---------- Daily challenge ----------

export interface Mutator {
  id: string;
  name: string;
  desc: string;
  apply: (c: GameConfig) => GameConfig;
}

export const MUTATORS: readonly Mutator[] = [
  { id: 'overclock', name: 'Overclock', desc: 'Difficulty ramps 35% faster', apply: (c) => ({ ...c, difficultyRate: 1.35 }) },
  { id: 'storm', name: 'Chaos Storm', desc: 'Chaos events arrive far more often', apply: (c) => ({ ...c, gapBase: c.gapBase * 0.55, gapMin: 2.5 }) },
  { id: 'long', name: 'Long Shadows', desc: 'Chaos events last 9 seconds', apply: (c) => ({ ...c, activeDuration: 9 }) },
  { id: 'swarm', name: 'Swarm', desc: '25% more hazards', apply: (c) => ({ ...c, spawnMul: 0.75 }) },
];

/** Local calendar date, e.g. "2026-10-17". */
export function dailyKey(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function dailySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailyChallenge(key: string = dailyKey()): { key: string; seed: number; mutator: Mutator; config: GameConfig } {
  const seed = dailySeed(key);
  const mutator = MUTATORS[seed % MUTATORS.length];
  const base: GameConfig = {
    ...ENDLESS_CONFIG,
    mode: 'daily',
    // New mechanics and formations join twice as fast as in Endless.
    events: ENDLESS_CONFIG.events.map((e) => ({ ...e, from: e.from / 2 })),
    patterns: ENDLESS_CONFIG.patterns.map((p) => ({ ...p, from: Math.max(WARMUP + 7, p.from / 2) })),
  };
  return { key, seed, mutator, config: mutator.apply(base) };
}
