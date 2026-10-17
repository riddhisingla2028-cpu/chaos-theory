// Player progression: level stars, bests, achievements, cosmetic unlocks, records and settings.
// Everything is cosmetic or bragging rights; nothing changes gameplay power.

import { CHAOS_KINDS, type ChaosKind, type GameMode } from './game/engine';
import { ENDLESS_MODES, STAGES, TRIALS, starsFor, type EndlessId } from './game/stages';
import { BEST_KEY, loadBest, type KeyValueStore } from './storage';
import { PURCHASES_AVAILABLE } from './monetization/entitlements';
import type { ShipId } from './mission/render';
import { MISSIONS, type MissionId } from './mission/sim';
import {
  addHistory,
  applyChallenges,
  levelFromXp,
  runXp,
  unlockedBetween,
  type ChallengeState,
  type CompletedChallenge,
  type MatchEntry,
  type TrailId,
  type VictoryId,
  type XpLine,
} from './progression';

export const PROGRESS_KEY = 'chaos-theory.progress.v1';
const LEVELS_VERSION = 2; // bumped when the level list changes, so old level records are not misapplied
export const SAVE_VERSION = 4; // overall save structure version (3: per-mode Endless bests, 4: XP, challenges, history)

export type ShapeId = 'square' | 'diamond' | 'triangle' | 'circle' | 'hexagon' | 'star' | 'nova' | 'spark';
export type ThemeId = 'obsidian' | 'ember' | 'glacier' | 'verdant' | 'aurum' | 'synthwave' | 'aurora';
export type JoyMode = 'float' | 'fixed';
export type JoySize = 'S' | 'M' | 'L';

export type MotionPref = 'system' | 'reduced' | 'full';

export interface Settings {
  muted: boolean;
  music: boolean;
  sfxVolume: number; // 0..1
  musicVolume: number; // 0..1
  reducedMotion: MotionPref;
  highContrast: boolean;
  trail: TrailId;
  victory: VictoryId;
  ship: ShipId;
  shake: boolean;
  aimAssist: boolean; // missions: straighten shots aimed within a few degrees of a target
  joyMode: JoyMode;
  joySize: JoySize;
  shape: ShapeId;
  theme: ThemeId;
}

export interface RecordEntry {
  mode: GameMode;
  label: string;
  score: number;
  time: number;
  date: string; // ISO date
}

/** Personal bests for one Endless mode. Every field only ever goes up. */
export interface ModeBest {
  score: number;
  time: number;
  orbs: number;
  events: number;
  bosses: number;
}

const emptyBest = (): ModeBest => ({ score: 0, time: 0, orbs: 0, events: 0, bosses: 0 });

export const isEndlessMode = (mode: GameMode): mode is EndlessId =>
  mode === 'endless' || mode === 'orbrush' || mode === 'chaos' || mode === 'bossrush';

export interface Progress {
  saveVersion: number;
  levelsVersion: number;
  modeBests: Record<EndlessId, ModeBest>;
  stages: Record<number, { stars: number; best: number }>; // cleared levels only
  stageTime: Record<number, number>; // longest survival per level, cleared or not
  fails: Record<number, number>; // failed attempts since the last clear, per level
  skipped: number[]; // levels skipped (demo purchase); they unlock the next level but award no stars
  endlessBest: number;
  daily: { date: string; best: number } | null;
  dailyPlays: number;
  trialBest: Record<number, number>;
  achievements: string[];
  chaosSurvived: ChaosKind[];
  runs: number;
  totalTime: number; // lifetime seconds survived across all runs
  orbsTotal: number;
  records: RecordEntry[];
  premiumDemo: boolean; // "Chaos+" unlocked through the DEMO checkout (no real payment)
  tutorialSeen: boolean;
  settings: Settings;
  xp: number;
  challenges: ChallengeState;
  history: MatchEntry[];
  /** Per level: attempts, failed attempts (deaths) and the fastest clear in seconds. */
  stageStats: Record<number, StageStats>;
  /** Spacecraft campaign records, per mission id. */
  missions: Record<string, MissionRecord>;
}

export interface MissionRecord {
  completed: boolean;
  stars: number; // best: 1 for completion + 1 per optional objective
  best: number; // best score of a completed run
  fastest: number | null; // seconds, completed runs only
  secondaries: boolean[]; // optional objectives ever achieved (in a completed run)
  attempts: number;
  failures: number;
}

export interface StageStats {
  attempts: number;
  deaths: number;
  fastest: number | null;
}

export interface RunSummary {
  mode: GameMode;
  stage: number;
  won: boolean;
  score: number;
  time: number;
  nearMisses: number;
  peakMultiplier: number;
  chaosSurvived: ChaosKind[];
  orbs?: number;
  events?: number;
  bosses?: number;
  label?: string;
  dateKey?: string;
}

export interface Unlock {
  kind: 'shape' | 'theme';
  id: string;
  name: string;
}

export interface RunOutcome {
  progress: Progress;
  best: number;
  previousBest: number;
  isNewBest: boolean;
  stars: number;
  previousStars: number;
  firstClear: boolean;
  newBests: (keyof ModeBest)[]; // Endless modes: which personal bests this run improved
  newAchievements: Achievement[];
  newUnlocks: Unlock[];
  xpLines: XpLine[]; // itemised XP for this run, challenges and achievements included
  xpGained: number;
  xpBefore: number;
  challengesCompleted: CompletedChallenge[];
  newCosmetics: string[]; // trails and victory effects unlocked by levelling up
}

function defaultModeBests(): Record<EndlessId, ModeBest> {
  return Object.fromEntries(ENDLESS_MODES.map((m) => [m.id, emptyBest()])) as Record<EndlessId, ModeBest>;
}

export function defaultProgress(): Progress {
  return {
    saveVersion: SAVE_VERSION,
    levelsVersion: LEVELS_VERSION,
    modeBests: defaultModeBests(),
    stages: {},
    stageTime: {},
    fails: {},
    skipped: [],
    endlessBest: 0,
    daily: null,
    dailyPlays: 0,
    trialBest: {},
    achievements: [],
    chaosSurvived: [],
    runs: 0,
    totalTime: 0,
    orbsTotal: 0,
    records: [],
    premiumDemo: false,
    tutorialSeen: false,
    settings: {
      muted: false,
      music: true,
      sfxVolume: 0.8,
      musicVolume: 0.6,
      reducedMotion: 'system',
      highContrast: false,
      trail: 'classic',
      victory: 'confetti',
      ship: 'arrow',
      shake: true,
      aimAssist: true,
      joyMode: 'float',
      joySize: 'M',
      shape: 'square',
      theme: 'obsidian',
    },
    xp: 0,
    challenges: { daily: null, weekly: null },
    history: [],
    stageStats: {},
    missions: {},
  };
}

// ---------- Queries ----------

export const accountLevel = (p: Progress) => levelFromXp(p.xp);
// Chaos+ items unlock only with a server-verified purchase (set by the app from the entitlement
// service). While purchases are not live, the free, clearly labelled preview may show them instead.
let verifiedChaosPlus = false;
export function setVerifiedChaosPlus(on: boolean): void {
  verifiedChaosPlus = on;
}
export const hasVerifiedChaosPlus = () => verifiedChaosPlus;
export const chaosPlusUnlocked = (p: Progress) => verifiedChaosPlus || (!PURCHASES_AVAILABLE && p.premiumDemo);
/** The cosmetics preview only exists until real purchases open. */
export const PREVIEW_AVAILABLE = !PURCHASES_AVAILABLE;

export const isCleared = (p: Progress, stage: number) => p.stages[stage] !== undefined;
export const isSkipped = (p: Progress, stage: number) => p.skipped.includes(stage);
export const isStageUnlocked = (p: Progress, stage: number) =>
  stage === 0 || isCleared(p, stage - 1) || isSkipped(p, stage - 1);
export const totalStars = (p: Progress) => Object.values(p.stages).reduce((n, s) => n + s.stars, 0);
export const maxStars = () => STAGES.length * 3;
export const levelsCleared = (p: Progress) => Object.keys(p.stages).length;

/** The level "Play" should jump to: the first one neither cleared nor skipped, or -1 when done. */
export function nextStage(p: Progress): number {
  for (let i = 0; i < STAGES.length; i++) if (!isCleared(p, i) && !isSkipped(p, i)) return i;
  return -1;
}

/** Skips are offered only to players who are genuinely stuck. */
export const SKIP_AFTER_FAILS = 3;
export const canOfferSkip = (p: Progress, stage: number) =>
  stage < STAGES.length - 1 && !isCleared(p, stage) && !isSkipped(p, stage) && (p.fails[stage] ?? 0) >= SKIP_AFTER_FAILS;

// ---------- Achievements ----------

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  test: (p: Progress, run: RunSummary) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-run', name: 'First Contact', desc: 'Finish your first run', test: (p) => p.runs >= 1 },
  { id: 'level-3', name: 'Orb Hunter', desc: 'Clear Level 3', test: (p) => isCleared(p, 2) },
  { id: 'level-5', name: 'Halfway There', desc: 'Clear Level 5', test: (p) => isCleared(p, 4) },
  { id: 'level-10', name: 'Core Breaker', desc: 'Defeat the Core in the Final Showdown', test: (p) => isCleared(p, 9) },
  { id: 'purist', name: 'Purist', desc: 'Clear all 10 levels without skipping', test: (p) => STAGES.every((_, i) => isCleared(p, i)) && p.skipped.length === 0 },
  { id: 'three-stars', name: 'Perfectionist', desc: 'Earn 3 stars on any level', test: (p) => Object.values(p.stages).some((s) => s.stars >= 3) },
  { id: 'survive-30', name: 'Hold the Line', desc: 'Survive 30 seconds in one run', test: (_, r) => r.time >= 30 },
  { id: 'survive-90', name: 'Ninety', desc: 'Survive 90 seconds in Endless or Daily', test: (_, r) => (r.mode === 'endless' || r.mode === 'daily') && r.time >= 90 },
  { id: 'graze-10', name: 'Grazer', desc: '10 near misses in one run', test: (_, r) => r.nearMisses >= 10 },
  { id: 'combo-3', name: 'Momentum', desc: 'Reach a ×3.0 multiplier', test: (_, r) => r.peakMultiplier >= 3 - 1e-9 },
  { id: 'score-2000', name: 'High Voltage', desc: 'Score 2,000 in a single run', test: (_, r) => r.score >= 2000 },
  { id: 'orbs-50', name: 'Collector', desc: 'Collect 50 orbs in total', test: (p) => p.orbsTotal >= 50 },
  { id: 'chaos-all', name: 'Chaos Theorist', desc: 'Survive all nine chaos events', test: (p) => CHAOS_KINDS.every((k) => p.chaosSurvived.includes(k)) },
  { id: 'daily', name: 'Daily Ritual', desc: 'Play a daily challenge', test: (p) => p.dailyPlays >= 1 },
  { id: 'classic-120', name: 'Two Minutes', desc: 'Survive 2 minutes in Classic Survival', test: (_, r) => r.mode === 'endless' && r.time >= 120 },
  { id: 'orbrush-30', name: 'Orb Glutton', desc: 'Collect 30 orbs in one Orb Rush run', test: (_, r) => r.mode === 'orbrush' && (r.orbs ?? 0) >= 30 },
  { id: 'chaos-10', name: 'Unfazed', desc: 'Survive 10 events in one Chaos Survival run', test: (_, r) => r.mode === 'chaos' && (r.events ?? 0) >= 10 },
  { id: 'bossrush-3', name: 'Core Collector', desc: 'Defeat 3 bosses in one Boss Rush run', test: (_, r) => r.mode === 'bossrush' && (r.bosses ?? 0) >= 3 },
  { id: 'runs-25', name: 'Relentless', desc: 'Play 25 runs', test: (p) => p.runs >= 25 },
];

// ---------- Cosmetics ----------

export interface ShapeDef {
  id: ShapeId;
  name: string;
  req: string;
  premium?: boolean;
  unlocked: (p: Progress) => boolean;
}

export const SHAPES: readonly ShapeDef[] = [
  { id: 'square', name: 'Square', req: 'Default', unlocked: () => true },
  { id: 'diamond', name: 'Diamond', req: 'Clear Level 2', unlocked: (p) => isCleared(p, 1) },
  { id: 'circle', name: 'Circle', req: 'Earn “Hold the Line”', unlocked: (p) => p.achievements.includes('survive-30') },
  { id: 'triangle', name: 'Triangle', req: 'Clear Level 4', unlocked: (p) => isCleared(p, 3) },
  { id: 'hexagon', name: 'Hexagon', req: 'Clear Level 7', unlocked: (p) => isCleared(p, 6) },
  { id: 'star', name: 'Star', req: 'Defeat the Core', unlocked: (p) => isCleared(p, 9) },
  { id: 'nova', name: 'Nova', req: 'Chaos+', premium: true, unlocked: chaosPlusUnlocked },
  { id: 'spark', name: 'Spark', req: 'Chaos+', premium: true, unlocked: chaosPlusUnlocked },
];

export interface ThemeDef {
  id: ThemeId;
  name: string;
  req: string;
  arena: string;
  accent: [number, number, number];
  premium?: boolean;
  unlocked: (p: Progress) => boolean;
}

export const THEMES: readonly ThemeDef[] = [
  { id: 'obsidian', name: 'Obsidian', req: 'Default', arena: '#121216', accent: [200, 75, 75], unlocked: () => true },
  { id: 'glacier', name: 'Glacier', req: 'Clear Level 5', arena: '#0e1318', accent: [91, 155, 213], unlocked: (p) => isCleared(p, 4) },
  { id: 'verdant', name: 'Verdant', req: 'Play a daily challenge', arena: '#0f1511', accent: [79, 163, 116], unlocked: (p) => p.dailyPlays >= 1 },
  { id: 'ember', name: 'Ember', req: 'Earn 10 stars', arena: '#15110d', accent: [217, 120, 59], unlocked: (p) => totalStars(p) >= 10 },
  { id: 'aurum', name: 'Aurum', req: 'Earn 6 achievements', arena: '#14120c', accent: [201, 165, 75], unlocked: (p) => p.achievements.length >= 6 },
  { id: 'synthwave', name: 'Synthwave', req: 'Chaos+', arena: '#120a1c', accent: [255, 79, 216], premium: true, unlocked: chaosPlusUnlocked },
  { id: 'aurora', name: 'Aurora', req: 'Chaos+', arena: '#08141a', accent: [79, 227, 240], premium: true, unlocked: chaosPlusUnlocked },
];

export const themeById = (id: ThemeId) => THEMES.find((t) => t.id === id) ?? THEMES[0];

function unlockedSet(p: Progress): Set<string> {
  const set = new Set<string>();
  for (const s of SHAPES) if (s.unlocked(p)) set.add(`shape:${s.id}`);
  for (const t of THEMES) if (t.unlocked(p)) set.add(`theme:${t.id}`);
  return set;
}

/** The next locked (free) cosmetic, used to give players a concrete reason to keep going. */
export function nextUnlockHint(p: Progress): string | null {
  const shape = SHAPES.find((s) => !s.premium && !s.unlocked(p));
  if (shape) return `${shape.req} to unlock the ${shape.name} shape`;
  const theme = THEMES.find((t) => !t.premium && !t.unlocked(p));
  if (theme) return `${theme.req} to unlock the ${theme.name} theme`;
  return null;
}

// ---------- Records ----------

const RECORDS_PER_MODE = 10;

function addRecord(p: Progress, run: RunSummary): void {
  if (run.score <= 0) return;
  const entry: RecordEntry = { mode: run.mode, label: run.label ?? run.mode, score: run.score, time: run.time, date: new Date().toISOString() };
  const same = p.records.filter((r) => r.mode === run.mode);
  const others = p.records.filter((r) => r.mode !== run.mode);
  p.records = [...others, ...[...same, entry].sort((a, b) => b.score - a.score).slice(0, RECORDS_PER_MODE)];
}

// ---------- Applying a run ----------

export function applyRun(prev: Progress, run: RunSummary, now: Date = new Date()): RunOutcome {
  const p: Progress = structuredClone(prev);
  const before = unlockedSet(prev);
  p.runs++;
  p.totalTime += run.time;
  p.orbsTotal += run.orbs ?? 0;
  for (const k of run.chaosSurvived) if (!p.chaosSurvived.includes(k)) p.chaosSurvived.push(k);

  let previousBest = 0;
  let best = 0;
  let stars = 0;
  let previousStars = 0;
  let firstClear = false;
  const newBests: (keyof ModeBest)[] = [];

  if (isEndlessMode(run.mode)) {
    const prevBest = { ...emptyBest(), ...(p.modeBests[run.mode] ?? {}) };
    const now: ModeBest = { score: run.score, time: run.time, orbs: run.orbs ?? 0, events: run.events ?? 0, bosses: run.bosses ?? 0 };
    const next = { ...prevBest };
    for (const k of Object.keys(now) as (keyof ModeBest)[]) {
      if (now[k] > prevBest[k]) {
        next[k] = now[k]; // a lower result never overwrites a higher best
        if (now[k] > 0) newBests.push(k);
      }
    }
    p.modeBests = { ...p.modeBests, [run.mode]: next };
    previousBest = prevBest.score;
    best = next.score;
    if (run.mode === 'endless') p.endlessBest = Math.max(p.endlessBest, next.score);
  } else if (run.mode === 'stage') {
    const rec = p.stages[run.stage];
    previousStars = rec?.stars ?? 0;
    previousBest = rec?.best ?? 0;
    p.stageTime[run.stage] = Math.max(p.stageTime[run.stage] ?? 0, run.time);
    const st: StageStats = { ...(p.stageStats[run.stage] ?? { attempts: 0, deaths: 0, fastest: null }) };
    st.attempts++;
    if (run.won) st.fastest = st.fastest === null ? run.time : Math.min(st.fastest, run.time);
    else st.deaths++;
    p.stageStats = { ...p.stageStats, [run.stage]: st };
    if (run.won) {
      firstClear = !rec;
      stars = starsFor(run.stage, run.score);
      p.stages[run.stage] = { stars: Math.max(previousStars, stars), best: Math.max(previousBest, run.score) };
      p.fails[run.stage] = 0;
    } else {
      p.fails[run.stage] = (p.fails[run.stage] ?? 0) + 1;
    }
    best = p.stages[run.stage]?.best ?? 0;
  } else if (run.mode === 'trial') {
    previousBest = p.trialBest[run.stage] ?? 0;
    p.trialBest[run.stage] = Math.max(previousBest, run.score);
    best = p.trialBest[run.stage];
  } else {
    const key = run.dateKey ?? '';
    previousBest = p.daily && p.daily.date === key ? p.daily.best : 0;
    best = Math.max(previousBest, run.score);
    p.daily = { date: key, best };
    p.dailyPlays++;
  }
  addRecord(p, run);

  const newAchievements = awardAchievements(p, run);

  // XP: the run itself, then any challenges it completed, then achievements.
  const facts = {
    mode: run.mode,
    won: run.won,
    time: run.time,
    orbs: run.orbs ?? 0,
    nearMisses: run.nearMisses,
    bosses: run.bosses ?? 0,
    stars,
    firstClear,
  };
  const xpLines = runXp(facts);
  const ch = applyChallenges(p.challenges, facts, now);
  p.challenges = ch.state;
  for (const c of ch.completed) xpLines.push({ label: `${c.scope === 'daily' ? 'Daily' : 'Weekly'} challenge: ${c.def.text}`, xp: c.def.xp });
  for (const a of newAchievements) xpLines.push({ label: `Achievement: ${a.name}`, xp: 50 });
  const xpGained = xpLines.reduce((n, l) => n + l.xp, 0);
  const xpBefore = p.xp;
  p.xp += xpGained;
  p.history = addHistory(p.history, {
    mode: run.mode,
    label: run.label ?? run.mode,
    won: run.won,
    score: run.score,
    time: run.time,
    xp: xpGained,
    date: now.toISOString(),
  });

  return {
    progress: p,
    best,
    previousBest,
    isNewBest: run.score > previousBest && (run.mode !== 'stage' || run.won),
    stars,
    previousStars,
    firstClear,
    newBests,
    newAchievements,
    newUnlocks: diffUnlocks(before, p),
    xpLines,
    xpGained,
    xpBefore,
    challengesCompleted: ch.completed,
    newCosmetics: unlockedBetween(xpBefore, p.xp),
  };
}

function awardAchievements(p: Progress, run: RunSummary | null): Achievement[] {
  const earned: Achievement[] = [];
  const probe: RunSummary = run ?? { mode: 'stage', stage: -1, won: false, score: 0, time: 0, nearMisses: 0, peakMultiplier: 1, chaosSurvived: [] };
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements.includes(a.id) && a.test(p, probe)) {
      p.achievements.push(a.id);
      earned.push(a);
    }
  }
  return earned;
}

function diffUnlocks(before: Set<string>, p: Progress): Unlock[] {
  const out: Unlock[] = [];
  for (const key of unlockedSet(p)) {
    if (before.has(key)) continue;
    const [kind, id] = key.split(':') as ['shape' | 'theme', string];
    const def = kind === 'shape' ? SHAPES.find((s) => s.id === id) : THEMES.find((t) => t.id === id);
    if (def) out.push({ kind, id, name: def.name });
  }
  return out;
}

/** Skip a level (DEMO purchase). Unlocks the next level; awards no stars. */
export function skipLevel(prev: Progress, stage: number): Progress {
  const p: Progress = structuredClone(prev);
  if (!p.skipped.includes(stage) && !isCleared(p, stage)) p.skipped.push(stage);
  return p;
}

/** Toggle the DEMO premium entitlement. Returns the new progress and any cosmetics it unlocked. */
export function setPremiumDemo(prev: Progress, on: boolean): { progress: Progress; unlocks: Unlock[] } {
  const before = unlockedSet(prev);
  const p: Progress = structuredClone(prev);
  p.premiumDemo = on;
  if (!on) {
    // Fall back to free cosmetics when the demo entitlement is removed.
    if (SHAPES.find((s) => s.id === p.settings.shape)?.premium) p.settings.shape = 'square';
    if (THEMES.find((t) => t.id === p.settings.theme)?.premium) p.settings.theme = 'obsidian';
  }
  return { progress: p, unlocks: diffUnlocks(before, p) };
}

export const TRIAL_COUNT = TRIALS.length;

// ---------- Persistence ----------

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadProgress(storage: KeyValueStore | null = browserStorage()): Progress {
  const base = defaultProgress();
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Progress>;
      const merged: Progress = {
        ...base,
        ...saved,
        settings: { ...base.settings, ...(saved.settings ?? {}) },
        modeBests: { ...base.modeBests, ...(saved.modeBests ?? {}) },
        saveVersion: SAVE_VERSION,
      };
      // Saves from before XP and challenges: start those fresh, keep everything else.
      if (typeof merged.xp !== 'number' || !Number.isFinite(merged.xp) || merged.xp < 0) merged.xp = 0;
      if (!Array.isArray(merged.history)) merged.history = [];
      if (!merged.challenges || typeof merged.challenges !== 'object') merged.challenges = { daily: null, weekly: null };
      if (!merged.stageStats || typeof merged.stageStats !== 'object') merged.stageStats = {};
      if (!merged.missions || typeof merged.missions !== 'object' || Array.isArray(merged.missions)) merged.missions = {};
      for (const k of ['sfxVolume', 'musicVolume'] as const) {
        const v = merged.settings[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) merged.settings[k] = base.settings[k];
        else merged.settings[k] = Math.min(1, Math.max(0, v));
      }
      // Saves from before per-mode bests: carry the Classic best score over.
      merged.modeBests.endless = { ...emptyBest(), ...merged.modeBests.endless, score: Math.max(merged.modeBests.endless?.score ?? 0, merged.endlessBest) };
      if (saved.levelsVersion !== LEVELS_VERSION) {
        // The level list changed: old per-level records refer to different levels.
        merged.levelsVersion = LEVELS_VERSION;
        merged.stages = {};
        merged.stageTime = {};
        merged.fails = {};
        merged.skipped = [];
        merged.stageStats = {};
      }
      return merged;
    }
  } catch {
    // Corrupt or blocked storage: start fresh rather than crash.
  }
  // First load on this version: carry over the personal best from v1 of the game.
  base.endlessBest = loadBest(storage);
  base.modeBests.endless.score = base.endlessBest;
  return base;
}

export function saveProgress(p: Progress, storage: KeyValueStore | null = browserStorage()): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(p));
    // Keep the original key in sync so older builds still see the best score.
    storage?.setItem(BEST_KEY, String(p.endlessBest));
  } catch {
    // Storage unavailable: progress lasts for this session only.
  }
}

// ---------- Spacecraft missions ----------

export interface ShipDef {
  id: ShipId;
  name: string;
  req: string;
  premium?: boolean;
  unlocked: (p: Progress) => boolean;
}

const missionDone = (p: Progress, i: number) => !!p.missions[MISSIONS[i].id]?.completed;
/** Unlocks are tied to mission ids, so reordering the campaign never takes a ship away. */
const missionIdDone = (p: Progress, id: MissionId) => !!p.missions[id]?.completed;

/** Spacecraft hulls. Purely cosmetic: every hull has the same size, speed and hit circle. */
export const SHIPS: readonly ShipDef[] = [
  { id: 'arrow', name: 'Arrow', req: 'Default', unlocked: () => true },
  { id: 'interceptor', name: 'Interceptor', req: 'Complete Shattered Orbit', unlocked: (p) => missionIdDone(p, 'shattered-orbit') },
  { id: 'manta', name: 'Manta', req: 'Complete Orbital Collapse', unlocked: (p) => missionIdDone(p, 'collapse') },
  { id: 'phantom', name: 'Phantom', req: 'Chaos+', premium: true, unlocked: () => hasVerifiedChaosPlus() },
];

export const equippedShip = (p: Progress): ShipId => {
  const s = SHIPS.find((x) => x.id === p.settings.ship);
  return s && s.unlocked(p) ? s.id : 'arrow';
};

/** Open if it is the first, the previous one is complete, or the player has already flown it (so reordering never locks anyone out). */
export const isMissionUnlocked = (p: Progress, i: number) => i === 0 || missionDone(p, i - 1) || !!p.missions[MISSIONS[i].id];
export const missionsCompleted = (p: Progress) => MISSIONS.filter((m) => p.missions[m.id]?.completed).length;
/** The mission to play next: the first one not yet completed (or the last, once all are done). */
export const nextMission = (p: Progress) => {
  const i = MISSIONS.findIndex((m) => !p.missions[m.id]?.completed);
  return i < 0 ? MISSIONS.length - 1 : i;
};

export interface MissionResult {
  id: MissionId;
  won: boolean;
  score: number;
  time: number;
  stars: number;
  secondaries: boolean[];
  coresTaken: number;
  kills: number;
  bossDefeated: boolean;
}

export interface MissionOutcome {
  progress: Progress;
  previous: MissionRecord | null;
  firstClear: boolean;
  isNewBest: boolean;
  xpLines: XpLine[];
  xpGained: number;
  xpBefore: number;
  challengesCompleted: CompletedChallenge[];
  newShips: string[];
  newCosmetics: string[];
}

/** Records a finished mission run. Rewards come only from what actually happened in the run. */
export function applyMission(prev: Progress, r: MissionResult, now: Date = new Date()): MissionOutcome {
  const p: Progress = structuredClone(prev);
  const shipsBefore = SHIPS.filter((s) => s.unlocked(prev)).map((s) => s.id);
  const old = p.missions[r.id] ?? null;
  const rec: MissionRecord = old ? { ...old, secondaries: [...old.secondaries] } : { completed: false, stars: 0, best: 0, fastest: null, secondaries: [false, false], attempts: 0, failures: 0 };
  rec.attempts += 1;
  const firstClear = r.won && !rec.completed;
  const isNewBest = r.won && r.score > rec.best;
  if (r.won) {
    rec.completed = true;
    rec.stars = Math.max(rec.stars, r.stars);
    rec.best = Math.max(rec.best, r.score);
    rec.fastest = rec.fastest === null ? r.time : Math.min(rec.fastest, r.time);
    rec.secondaries = rec.secondaries.map((v, i) => v || !!r.secondaries[i]);
  } else rec.failures += 1;
  p.missions = { ...p.missions, [r.id]: rec };
  p.runs++;
  p.totalTime += r.time;
  p.orbsTotal += r.coresTaken;

  const xpLines: XpLine[] = [];
  if (r.won) {
    xpLines.push({ label: 'Mission complete', xp: 120 });
    const met = r.secondaries.filter(Boolean).length;
    if (met) xpLines.push({ label: `${met} optional objective${met === 1 ? '' : 's'}`, xp: met * 40 });
    if (firstClear) xpLines.push({ label: 'First completion', xp: 150 });
  } else {
    const flown = Math.min(60, Math.floor(r.time));
    if (flown > 0) xpLines.push({ label: `Flew ${flown}s`, xp: flown });
  }
  if (r.kills > 0) xpLines.push({ label: `${r.kills} drone${r.kills === 1 ? '' : 's'} destroyed`, xp: Math.min(100, r.kills * 6) });
  const ch = applyChallenges(
    p.challenges,
    { mode: 'stage', won: r.won, time: r.time, orbs: r.coresTaken, nearMisses: 0, bosses: r.bossDefeated ? 1 : 0, stars: r.won ? r.stars : 0, firstClear },
    now,
  );
  p.challenges = ch.state;
  for (const c of ch.completed) xpLines.push({ label: `${c.scope === 'daily' ? 'Daily' : 'Weekly'} challenge: ${c.def.text}`, xp: c.def.xp });
  const xpGained = xpLines.reduce((n, l) => n + l.xp, 0);
  const xpBefore = p.xp;
  p.xp += xpGained;
  const def = MISSIONS.find((m) => m.id === r.id)!;
  p.history = addHistory(p.history, { mode: 'mission', label: `${def.code} ${def.name}`, won: r.won, score: r.score, time: r.time, xp: xpGained, date: now.toISOString() });
  const newShips = SHIPS.filter((s) => !shipsBefore.includes(s.id) && s.unlocked(p)).map((s) => `${s.name} spacecraft`);
  return { progress: p, previous: old, firstClear, isNewBest, xpLines, xpGained, xpBefore, challengesCompleted: ch.completed, newShips, newCosmetics: unlockedBetween(xpBefore, p.xp) };
}
