import { ENDLESS_CONFIG, WARMUP, type ChaosKind, type GameConfig, type Objective, type PatternKind, type Phase } from './engine';
import { ARENAS, type ArenaDef } from './arenas';

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
  arena: ArenaDef; // the level's playable geometry
  mechanics: string[]; // short labels shown on the level card
  teaser: string; // shown on the locked preview, hints without spoiling
  overrides: Partial<GameConfig>;
  phases: Phase[]; // phase 0 starts immediately; later phases escalate the level
  stars: [number, number]; // score needed for 2 and 3 stars
}

const kinds = (...k: ChaosKind[]) => k.map((kind) => ({ kind, from: 0 }));
const pats = (...k: PatternKind[]) => k.map((kind) => ({ kind, from: 0 }));

/** Shared settings for focused campaign levels. */
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
    tagline: 'Learn to move, then prove it.',
    objective: { type: 'survive', seconds: 15 },
    difficulty: 1,
    accent: [76, 157, 255],
    motif: 'grid',
    heat: 0,
    arena: ARENAS.grid,
    mechanics: ['Movement', 'Formations'],
    teaser: 'Your first fifteen seconds.',
    overrides: { warmup: 5, ramp: 3, hazardSpeed: 0.9 },
    phases: [
      { name: 'Learn to move', hint: 'Slow hazards. Just keep moving', at: {}, set: {} },
      { name: 'Hazards arrive', hint: 'They speed up. Keep dodging', at: { time: 5 }, set: { difficultyOffset: 2 } },
      { name: 'Crossfire', hint: 'Hazards from every side', at: { time: 9 }, set: { difficultyOffset: 4, spawnMul: 0.9 }, burst: 'pincer' },
      { name: 'Final test', hint: 'Slip through the gap in the wall', at: { time: 12 }, set: {}, burst: 'wall' },
    ],
    stars: [210, 250],
  },
  {
    name: 'Speed Rush',
    tagline: 'Speed waves while the outer floor falls away.',
    objective: { type: 'survive', seconds: 24 },
    difficulty: 1,
    accent: [255, 170, 70],
    motif: 'speed',
    heat: 0.15,
    arena: ARENAS.collapse,
    mechanics: ['Speed waves', 'Collapsing floor'],
    teaser: 'Do not stand near the edge.',
    overrides: { warmup: 1, ramp: 2, difficultyOffset: 0, spawnMul: 1.55 },
    phases: [
      { name: 'Wave 1', hint: 'Fast hazards. The edge is starting to go', at: {}, set: { hazardSpeed: 1.1 } },
      { name: 'Wave 2', hint: 'Faster, and more of them', at: { time: 8 }, set: { hazardSpeed: 1.22, spawnMul: 1.2 } },
      { name: 'Wave 3', hint: 'Top speed. Rain incoming', at: { time: 15 }, set: { hazardSpeed: 1.3, patterns: pats('rain'), patternGap: 6 }, burst: 'rain' },
      { name: 'Final sprint', hint: 'Hold the centre. Almost there', at: { time: 21 }, set: { hazardSpeed: 1.36 } },
    ],
    stars: [380, 450],
  },
  {
    name: 'Orb Hunt',
    tagline: 'Hunt 10 orbs through a maze of corridors.',
    objective: { type: 'orbs', orbs: 10 },
    difficulty: 2,
    accent: [120, 200, 255],
    motif: 'dots',
    heat: 0.15,
    arena: ARENAS.maze,
    mechanics: ['Maze', 'Orbs', 'Seekers'],
    teaser: 'Something worth chasing appears.',
    overrides: { warmup: 1.5, ramp: 3, difficultyOffset: 1, spawnMul: 1.35 },
    phases: [
      { name: 'Gather', hint: 'Collect the glowing orbs', at: {}, set: {} },
      { name: 'Further out', hint: 'Orbs appear further away', at: { orbs: 3 }, set: { orbMinDistance: 320, difficultyOffset: 4 } },
      { name: 'Hunted', hint: 'Seekers join. Gold orbs are worth more', at: { orbs: 6 }, set: { seekersFrom: 0, weaveChance: 0.15, bonusOrbChance: 0.25, difficultyOffset: 6 } },
      { name: 'Last orb', hint: 'One more, under a rain of hazards', at: { orbs: 9 }, set: { patterns: pats('rain'), patternGap: 4 }, burst: 'rain' },
    ],
    stars: [2500, 2850],
  },
  {
    name: 'Reverse Control',
    tagline: 'A circular arena, a sweeping rotor and flipping controls.',
    objective: { type: 'survive', seconds: 24 },
    difficulty: 2,
    accent: [255, 120, 60],
    motif: 'mirror',
    heat: 0.2,
    arena: ARENAS.ring,
    mechanics: ['Rotor', 'Inversion', 'Weavers'],
    teaser: 'Left is right. Until it isn’t.',
    overrides: { warmup: 1, ramp: 3, difficultyOffset: 0, spawnMul: 1.85, warning: 0.9 },
    phases: [
      { name: 'Normal', hint: 'Controls behave. For now', at: {}, set: {} },
      { name: 'Reversed', hint: 'Controls flip. Watch for the warning', at: { time: 5 }, set: { events: kinds('INVERSION'), activeDuration: 3, gapBase: 1.3, gapMin: 1, gapRandom: 0.8 } },
      { name: 'Weavers', hint: 'Normal controls, slippery hazards', at: { time: 12 }, set: { events: [], weaveChance: 0.35, difficultyOffset: 2 } },
      { name: 'Flip storm', hint: 'Rapid flips and weaving hazards', at: { time: 17 }, set: { events: kinds('INVERSION'), activeDuration: 1.6, gapBase: 1.4, gapMin: 1, gapRandom: 0.8, weaveChance: 0.25, difficultyOffset: 3 } },
    ],
    stars: [490, 560],
  },
  {
    name: 'The Vanishing Zone',
    tagline: 'Two platforms, timed bridges. Each side floods in turn.',
    objective: { type: 'survive', seconds: 28 },
    difficulty: 3,
    accent: [130, 140, 230],
    motif: 'void',
    heat: 0.25,
    arena: ARENAS.split,
    mechanics: ['Drawbridges', 'Flooding platforms'],
    teaser: 'Pick a side. Then pick again.',
    overrides: { warmup: 1.5, ramp: 3, difficultyOffset: 2, spawnMul: 1.6 },
    phases: [
      { name: 'Left or right', hint: 'Your side will flood. Cross a bridge in time', at: {}, set: {} },
      { name: 'Crossfire', hint: 'Hazards sweep both platforms', at: { time: 8 }, set: { spawnMul: 1.45, difficultyOffset: 4 } },
      { name: 'Weavers', hint: 'Hazards weave across the bridges', at: { time: 15 }, set: { weaveChance: 0.3, difficultyOffset: 6 } },
      { name: 'Last crossing', hint: 'One more flood. Make it count', at: { time: 22 }, set: { spawnMul: 1.35 }, burst: 'pincer' },
    ],
    stars: [430, 510],
  },
  {
    name: 'Double Chaos',
    tagline: 'Orbs hidden along a spiral. Rules arrive in pairs.',
    objective: { type: 'orbs', orbs: 12 },
    difficulty: 3,
    accent: [255, 200, 90],
    motif: 'currents',
    heat: 0.3,
    arena: ARENAS.spiral,
    mechanics: ['Spiral', 'Paired chaos', 'Orbs'],
    teaser: 'One rule was never the problem.',
    overrides: { firstChaosAt: 2.5, warning: 1.3, activeDuration: 3.2, gapBase: 3, gapRandom: 1.5, difficultyOffset: 0, spawnMul: 2.1 },
    phases: [
      { name: 'One rule', hint: 'Single chaos events', at: {}, set: { events: kinds('GRAVITY', 'INVERSION', 'SURGE') } },
      {
        name: 'Two rules',
        hint: 'Now they come in pairs',
        at: { orbs: 4 },
        set: {
          pairs: [
            ['GRAVITY', 'INVERSION'],
            ['SURGE', 'GLITCH'],
            ['GLITCH', 'GRAVITY'],
            ['SURGE', 'INVERSION'],
          ],
        },
      },
      { name: 'Overload', hint: 'Pairs, faster, with formations', at: { orbs: 8 }, set: { gapBase: 2.5, activeDuration: 3.5, difficultyOffset: 2, patterns: pats('pincer', 'wall'), patternGap: 7 } },
      { name: 'Last orb', hint: 'Grab it through the storm', at: { orbs: 11 }, set: {}, burst: 'pincer' },
    ],
    stars: [3200, 3600],
  },
  {
    name: 'Glitch Attack',
    tagline: 'A narrow corridor. Waves of glitching hazards.',
    objective: { type: 'survive', seconds: 28 },
    difficulty: 4,
    accent: [170, 215, 255],
    motif: 'noise',
    heat: 0.35,
    arena: ARENAS.gauntlet,
    mechanics: ['Narrow corridor', 'Teleports', 'Waves'],
    teaser: 'Signal lost.',
    overrides: { events: kinds('GLITCH'), firstChaosAt: 1.2, warning: 0.8, activeDuration: 60, warmup: 1, difficultyOffset: 3, spawnMul: 1.3, hazardSpeed: 1 },
    phases: [
      { name: 'Interference', hint: 'Hazards swerve at random', at: {}, set: { teleport: false } },
      { name: 'Teleports', hint: 'Hazards blink. Ghosts show where', at: { time: 7 }, set: { teleport: true, difficultyOffset: 5 } },
      { name: 'Signal storm', hint: 'More, faster and weaving', at: { time: 14 }, set: { weaveChance: 0.25, difficultyOffset: 7, spawnMul: 1.15 } },
      { name: 'Blackout', hint: 'Rain through the static', at: { time: 21 }, set: { patterns: pats('rain'), patternGap: 4.5 }, burst: 'rain' },
    ],
    stars: [430, 510],
  },
  {
    name: 'Shrinking Arena',
    tagline: 'A shattered floor that keeps breaking. Sliding walls.',
    objective: { type: 'survive', seconds: 30 },
    difficulty: 4,
    accent: [229, 72, 77],
    motif: 'frame',
    heat: 0.4,
    arena: ARENAS.fracture,
    mechanics: ['Breaking floor', 'Sliding walls'],
    teaser: 'Room to breathe is a luxury.',
    overrides: { warmup: 1, difficultyOffset: 2, spawnMul: 1.45 },
    phases: [
      { name: 'Fault lines', hint: 'Walls slide. Watch the cracks', at: {}, set: {} },
      { name: 'First break', hint: 'The west floor is about to fall', at: { time: 9 }, set: { spawnMul: 1.35, difficultyOffset: 5 } },
      { name: 'Second break', hint: 'The north floor goes next', at: { time: 17 }, set: { weaveChance: 0.15, difficultyOffset: 7 } },
      { name: 'Hold the heart', hint: 'Only the centre will remain', at: { time: 24 }, set: { spawnMul: 1.3 }, burst: 'pincer' },
    ],
    stars: [540, 640],
  },
  {
    name: 'Chaos Combo',
    tagline: 'Islands in the void, bridges that come and go. 10 orbs in 50s.',
    objective: { type: 'orbs', orbs: 10, timeLimit: 50 },
    difficulty: 5,
    accent: [90, 130, 220],
    motif: 'rings',
    heat: 0.45,
    arena: ARENAS.void,
    mechanics: ['Islands', 'Bridges', 'Mixed rules', 'Time limit'],
    teaser: 'Everything you have learned. At once.',
    overrides: {
      events: kinds('SURGE', 'GLITCH'),
      firstChaosAt: 2,
      warning: 1,
      activeDuration: 3,
      gapBase: 2,
      gapRandom: 1.5,
      warmup: 1,
      difficultyOffset: 1,
      spawnMul: 2.2,
      hazardSpeed: 0.85,
      orbCount: 2,
    },
    phases: [
      { name: 'Island hopping', hint: 'Cross while the bridges hold', at: {}, set: { pairChance: 0 } },
      { name: 'Combos', hint: 'Rules start to pair up', at: { orbs: 3 }, set: { pairChance: 0.35, difficultyOffset: 2 } },
      {
        name: 'Everything',
        hint: 'Pairs, vanishing floor and formations',
        at: { orbs: 5 },
        set: { pairChance: 0.45, patterns: pats('pincer'), patternGap: 7 },
      },
      { name: 'Finale', hint: 'Last few orbs. Gold ones are worth more', at: { orbs: 8 }, set: { bonusOrbChance: 0.3 } },
    ],
    stars: [4750, 5150],
  },
  {
    name: 'Final Showdown',
    tagline: 'A four-phase fight with the Core. The arena changes as it breaks.',
    objective: { type: 'boss' },
    difficulty: 5,
    accent: [255, 213, 74],
    motif: 'scan',
    heat: 0.6,
    arena: ARENAS.coreA,
    mechanics: ['Boss', 'Beams', 'Shockwaves'],
    teaser: 'Something is waiting at the centre.',
    overrides: { boss: { hp: 10 }, warmup: 2, ramp: 4, difficultyOffset: 0, spawnMul: 3.2, orbCount: 2 },
    phases: [
      { name: 'Awakening', hint: 'Feed the Core orbs. Dodge its bursts', at: {}, set: { bossTier: 0 } },
      { name: 'Enraged', hint: 'Beams! Use the pillars to block bursts', at: { bossHp: 7 }, set: { bossTier: 1, difficultyOffset: 2, spawnMul: 3.4, arena: ARENAS.coreB } },
      { name: 'Shockwave', hint: 'The arena tightens. Find the gap in the ring', at: { bossHp: 4 }, set: { bossTier: 2, difficultyOffset: 4, arena: ARENAS.coreC } },
      { name: 'Desperation', hint: 'Twin beams and a rotor. Everything at once', at: { bossHp: 2 }, set: { bossTier: 3, difficultyOffset: 7, spawnMul: 2.6, arena: ARENAS.coreD } },
    ],
    stars: [2950, 3300],
  },
];

export function stageConfig(index: number): GameConfig {
  const st = STAGES[index];
  return { ...LEVEL_BASE, ...st.overrides, mode: 'stage', stage: index, objective: st.objective, phases: st.phases, arena: st.arena };
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
    name: 'Hard Core',
    tagline: 'The Core at full fury from the first second, with 10 hit points.',
    objective: { type: 'boss' },
    accent: [255, 59, 92],
    motif: 'scan',
    config: { boss: { hp: 10 }, bossTier: 2, warmup: 2, ramp: 3, difficultyOffset: 16, spawnMul: 1.9 },
  },
];

export function trialConfig(index: number): GameConfig {
  const t = TRIALS[index];
  return { ...LEVEL_BASE, ...t.config, mode: 'trial', stage: index, objective: t.objective };
}

// ---------- Endless modes ----------

export type EndlessId = 'endless' | 'orbrush' | 'chaos' | 'bossrush';

export interface EndlessModeDef {
  id: EndlessId;
  name: string;
  tagline: string;
  objective: string;
  rules: string[];
  accent: [number, number, number];
  motif: Motif;
  config: GameConfig;
}

const CLASSIC: GameConfig = {
  ...ENDLESS_CONFIG,
  phases: [
    { name: 'Calm', hint: 'Survive as long as you can', at: {}, set: {} },
    { name: 'Rising', hint: 'Faster hazards and new rules', at: { time: 30 }, set: { weaveChance: 0.12 } },
    { name: 'Storm', hint: 'Weavers and seekers everywhere', at: { time: 60 }, set: { weaveChance: 0.25 } },
    { name: 'Chaos', hint: 'Rules start pairing up', at: { time: 100 }, set: { pairChance: 0.3 } },
    { name: 'Singularity', hint: 'Nothing is safe now', at: { time: 150 }, set: { pairChance: 0.5, weaveChance: 0.35 } },
  ],
};

const ORB_RUSH: GameConfig = {
  ...ENDLESS_CONFIG,
  mode: 'orbrush',
  events: [],
  orbField: true,
  orbCount: 2,
  bonusOrbChance: 0.15,
  patterns: [],
  phases: [
    { name: 'Collect', hint: 'Grab orbs. Gold ones are worth triple', at: {}, set: {} },
    { name: 'Spread out', hint: 'Orbs appear further away', at: { time: 25 }, set: { orbMinDistance: 300, weaveChance: 0.15 } },
    { name: 'Rules join', hint: 'Gravity and Surge interfere', at: { time: 50 }, set: { events: kinds('GRAVITY', 'SURGE'), gapBase: 7, firstChaosAt: 0 } },
    { name: 'Gauntlet', hint: 'Far orbs, formations, weavers', at: { time: 80 }, set: { orbMinDistance: 380, bonusOrbChance: 0.25, weaveChance: 0.3, patterns: pats('rain', 'pincer'), patternGap: 6 } },
  ],
};

const CHAOS_SURVIVAL: GameConfig = {
  ...ENDLESS_CONFIG,
  mode: 'chaos',
  events: ENDLESS_CONFIG.events.map((e) => ({ ...e, from: 0 })),
  firstChaosAt: WARMUP + 1,
  warning: 1.4,
  activeDuration: 5,
  gapBase: 4.5,
  gapMin: 1.6,
  gapPerLevel: 0.35,
  gapRandom: 2,
  spawnMul: 1.25,
  patterns: [],
  phases: [
    { name: 'Single rules', hint: 'One rule at a time', at: {}, set: {} },
    { name: 'Combos', hint: 'Rules start to pair up', at: { time: 40 }, set: { pairChance: 0.35 } },
    { name: 'Overdrive', hint: 'Longer, more frequent pairs', at: { time: 80 }, set: { pairChance: 0.6, activeDuration: 6 } },
    { name: 'Pandemonium', hint: 'And now the floor vanishes too', at: { time: 120 }, set: { pairChance: 0.7, voids: true, voidCount: 3, voidCycle: 3, voidWarn: 1.2 } },
  ],
};

const BOSS_RUSH: GameConfig = {
  ...LEVEL_BASE,
  mode: 'bossrush',
  objective: null,
  boss: { hp: 3 },
  bossRush: true,
  warmup: 2,
  ramp: 4,
  difficultyOffset: 2,
  spawnMul: 2.8,
};

export const ENDLESS_MODES: readonly EndlessModeDef[] = [
  {
    id: 'endless',
    name: 'Classic Survival',
    tagline: 'The original. How long can you last?',
    objective: 'Survive as long as possible',
    rules: ['Hazards speed up and multiply over time', 'New chaos rules join at survival milestones', 'One hit ends the run'],
    accent: [76, 157, 255],
    motif: 'grid',
    config: CLASSIC,
  },
  {
    id: 'orbrush',
    name: 'Orb Rush',
    tagline: 'Greedy is good. Until it isn’t.',
    objective: 'Collect as many orbs as you can',
    rules: ['Two orbs on the field at all times', 'Gold bonus orbs are worth triple but vanish fast', 'Orbs drift further away as you go'],
    accent: [91, 240, 138],
    motif: 'dots',
    config: ORB_RUSH,
  },
  {
    id: 'chaos',
    name: 'Chaos Survival',
    tagline: 'Rule after rule after rule.',
    objective: 'Survive a constant stream of chaos events',
    rules: ['A random rule every few seconds, always announced', 'Rules begin to pair up the longer you last', 'Every run is a different sequence'],
    accent: [255, 159, 64],
    motif: 'rings',
    config: CHAOS_SURVIVAL,
  },
  {
    id: 'bossrush',
    name: 'Boss Rush',
    tagline: 'One Core down. Another rises.',
    objective: 'Defeat as many bosses as you can',
    rules: ['Collect orbs to damage each Core', 'Every new Core has more health and new attacks', 'A short breather between bosses'],
    accent: [255, 213, 74],
    motif: 'scan',
    config: BOSS_RUSH,
  },
];

export const endlessMode = (id: EndlessId) => ENDLESS_MODES.find((m) => m.id === id) ?? ENDLESS_MODES[0];

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
