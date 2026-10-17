// Account progression: XP, account levels, daily and weekly challenges, match history,
// and the trail and victory-effect cosmetics that account levels unlock.
// Everything here is earned by playing; none of it changes gameplay power.

import type { GameMode } from './game/engine';

// ---------- XP and account levels ----------

export const MAX_ACCOUNT_LEVEL = 50;

/** XP needed to go from `level` to `level + 1`. Gentle at first, steadier later. */
export const xpForNext = (level: number) => 120 + 40 * (level - 1);

export interface LevelInfo {
  level: number;
  into: number; // XP earned inside the current level
  need: number; // XP needed for the next level (0 at max)
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_ACCOUNT_LEVEL && left >= xpForNext(level)) {
    left -= xpForNext(level);
    level++;
  }
  return { level, into: level >= MAX_ACCOUNT_LEVEL ? 0 : left, need: level >= MAX_ACCOUNT_LEVEL ? 0 : xpForNext(level) };
}

/** What a run feeds into progression. A subset of the full run summary. */
export interface RunFacts {
  mode: GameMode;
  won: boolean;
  time: number;
  orbs: number;
  nearMisses: number;
  bosses: number;
  stars: number; // stars earned this run (levels only)
  firstClear: boolean;
}

export interface XpLine {
  label: string;
  xp: number;
}

/** XP for one run, itemised so the rewards screen can explain exactly where it came from. */
export function runXp(r: RunFacts): XpLine[] {
  const lines: XpLine[] = [];
  const survived = Math.min(120, Math.floor(r.time));
  if (survived > 0) lines.push({ label: `Survived ${survived}s`, xp: survived });
  if (r.orbs > 0) lines.push({ label: `${r.orbs} orb${r.orbs === 1 ? '' : 's'}`, xp: Math.min(150, r.orbs * 4) });
  if (r.nearMisses > 0) lines.push({ label: `${r.nearMisses} near miss${r.nearMisses === 1 ? '' : 'es'}`, xp: Math.min(60, r.nearMisses * 2) });
  if (r.bosses > 0) lines.push({ label: `${r.bosses} Core${r.bosses === 1 ? '' : 's'} defeated`, xp: r.bosses * 60 });
  if (r.mode === 'stage' && r.won) lines.push({ label: `Level cleared (${r.stars}★)`, xp: 40 + r.stars * 20 });
  if (r.firstClear) lines.push({ label: 'First clear', xp: 100 });
  return lines;
}

// ---------- Challenges ----------

export type ChallengeMetric =
  | 'orbs' // orbs collected (summed over runs)
  | 'survive' // longest single run, seconds
  | 'clears' // campaign levels won
  | 'near' // near misses (summed)
  | 'endless' // seconds survived in Endless modes (summed)
  | 'three' // three-star clears
  | 'runs' // runs played
  | 'bosses'; // Cores defeated (any mode)

export interface ChallengeDef {
  id: string;
  metric: ChallengeMetric;
  target: number;
  xp: number;
  text: string;
}

const DAILY_POOL: ChallengeDef[] = [
  { id: 'd-orbs', metric: 'orbs', target: 15, xp: 80, text: 'Collect 15 orbs' },
  { id: 'd-survive', metric: 'survive', target: 45, xp: 80, text: 'Survive 45s in a single run' },
  { id: 'd-clear', metric: 'clears', target: 2, xp: 90, text: 'Clear 2 campaign levels' },
  { id: 'd-near', metric: 'near', target: 25, xp: 70, text: 'Pull off 25 near misses' },
  { id: 'd-endless', metric: 'endless', target: 90, xp: 80, text: 'Survive 90s in total in Endless modes' },
  { id: 'd-three', metric: 'three', target: 1, xp: 100, text: 'Earn three stars on any level' },
  { id: 'd-runs', metric: 'runs', target: 5, xp: 60, text: 'Play 5 runs' },
  { id: 'd-boss', metric: 'bosses', target: 1, xp: 120, text: 'Defeat a Core (Final Showdown or Boss Rush)' },
];

const WEEKLY_POOL: ChallengeDef[] = [
  { id: 'w-orbs', metric: 'orbs', target: 120, xp: 300, text: 'Collect 120 orbs' },
  { id: 'w-survive', metric: 'survive', target: 120, xp: 300, text: 'Survive 2 minutes in a single run' },
  { id: 'w-clear', metric: 'clears', target: 8, xp: 320, text: 'Clear 8 campaign levels' },
  { id: 'w-near', metric: 'near', target: 200, xp: 260, text: 'Pull off 200 near misses' },
  { id: 'w-endless', metric: 'endless', target: 600, xp: 300, text: 'Survive 10 minutes in total in Endless modes' },
  { id: 'w-three', metric: 'three', target: 4, xp: 350, text: 'Earn three stars on 4 levels' },
  { id: 'w-boss', metric: 'bosses', target: 4, xp: 400, text: 'Defeat 4 Cores' },
];

export interface ChallengeSet {
  key: string; // the day (YYYY-MM-DD) or week (YYYY-Www) these challenges belong to
  ids: string[];
  progress: number[];
  done: boolean[];
}

export interface ChallengeState {
  daily: ChallengeSet | null;
  weekly: ChallengeSet | null;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Picks `n` distinct challenges from the pool, the same for everyone for a given key. */
function pick(pool: ChallengeDef[], key: string, n: number): ChallengeDef[] {
  const order = pool.map((c) => ({ c, k: hash(`${key}:${c.id}`) })).sort((a, b) => a.k - b.k);
  return order.slice(0, n).map((o) => o.c);
}

export const challengeById = (id: string) => [...DAILY_POOL, ...WEEKLY_POOL].find((c) => c.id === id);

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** ISO-8601 week key, e.g. 2026-W42. Weeks start on Monday. */
export function weekKeyOf(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

function freshSet(pool: ChallengeDef[], key: string, n: number): ChallengeSet {
  const ids = pick(pool, key, n).map((c) => c.id);
  return { key, ids, progress: ids.map(() => 0), done: ids.map(() => false) };
}

/** Current challenges, rolling over to new ones when the day or week changes. */
export function currentChallenges(state: ChallengeState, now: Date): ChallengeState {
  const day = dayKeyOf(now);
  const week = weekKeyOf(now);
  return {
    daily: state.daily?.key === day ? state.daily : freshSet(DAILY_POOL, day, 3),
    weekly: state.weekly?.key === week ? state.weekly : freshSet(WEEKLY_POOL, week, 3),
  };
}

function amountFor(metric: ChallengeMetric, r: RunFacts): { add?: number; max?: number } {
  switch (metric) {
    case 'orbs':
      return { add: r.orbs };
    case 'survive':
      return { max: Math.floor(r.time) };
    case 'clears':
      return { add: r.mode === 'stage' && r.won ? 1 : 0 };
    case 'near':
      return { add: r.nearMisses };
    case 'endless':
      return { add: r.mode === 'endless' || r.mode === 'orbrush' || r.mode === 'chaos' || r.mode === 'bossrush' ? Math.floor(r.time) : 0 };
    case 'three':
      return { add: r.mode === 'stage' && r.won && r.stars === 3 ? 1 : 0 };
    case 'runs':
      return { add: 1 };
    case 'bosses':
      return { add: r.bosses };
  }
}

export interface CompletedChallenge {
  def: ChallengeDef;
  scope: 'daily' | 'weekly';
}

/** Applies a run to the current challenges. Completed challenges are reported once, with their XP. */
export function applyChallenges(state: ChallengeState, r: RunFacts, now: Date): { state: ChallengeState; completed: CompletedChallenge[] } {
  const cur = currentChallenges(state, now);
  const completed: CompletedChallenge[] = [];
  const update = (set: ChallengeSet, scope: 'daily' | 'weekly'): ChallengeSet => {
    const next: ChallengeSet = { ...set, progress: [...set.progress], done: [...set.done] };
    set.ids.forEach((id, i) => {
      const def = challengeById(id);
      if (!def || next.done[i]) return;
      const a = amountFor(def.metric, r);
      next.progress[i] = Math.min(def.target, a.max !== undefined ? Math.max(next.progress[i], a.max) : next.progress[i] + (a.add ?? 0));
      if (next.progress[i] >= def.target) {
        next.done[i] = true;
        completed.push({ def, scope });
      }
    });
    return next;
  };
  return { state: { daily: update(cur.daily!, 'daily'), weekly: update(cur.weekly!, 'weekly') }, completed };
}

// ---------- Match history ----------

export interface MatchEntry {
  mode: GameMode | 'mission';
  label: string;
  won: boolean;
  score: number;
  time: number;
  xp: number;
  date: string; // ISO
}

export const HISTORY_KEEP = 25;

export function addHistory(history: MatchEntry[], entry: MatchEntry): MatchEntry[] {
  return [entry, ...history].slice(0, HISTORY_KEEP);
}

// ---------- Trail and victory cosmetics (unlocked by account level) ----------

export type TrailId = 'classic' | 'comet' | 'beads' | 'prism' | 'halo';
export type VictoryId = 'confetti' | 'shockwave' | 'fireworks' | 'starfall' | 'supernova';

export interface LevelCosmetic<T extends string> {
  id: T;
  name: string;
  level: number; // account level that unlocks it
  blurb: string;
  /** Chaos+ only: needs a server-verified purchase, never unlocked by playing. */
  premium?: boolean;
}

export const TRAILS: readonly LevelCosmetic<TrailId>[] = [
  { id: 'classic', name: 'Classic', level: 1, blurb: 'A soft neon streak.' },
  { id: 'comet', name: 'Comet', level: 3, blurb: 'A brighter tail that tapers away.' },
  { id: 'beads', name: 'Beads', level: 6, blurb: 'A string of fading lights.' },
  { id: 'prism', name: 'Prism', level: 10, blurb: 'Shifts through the spectrum as you move.' },
  { id: 'halo', name: 'Halo', level: 1, blurb: 'Golden rings trail behind you. Chaos+ supporters only.', premium: true },
];

export const VICTORIES: readonly LevelCosmetic<VictoryId>[] = [
  { id: 'confetti', name: 'Confetti', level: 1, blurb: 'The classic celebration.' },
  { id: 'shockwave', name: 'Shockwave', level: 4, blurb: 'Rings of light ripple out.' },
  { id: 'fireworks', name: 'Fireworks', level: 8, blurb: 'Bursts across the whole arena.' },
  { id: 'starfall', name: 'Starfall', level: 12, blurb: 'Light rains down from above.' },
  { id: 'supernova', name: 'Supernova', level: 1, blurb: 'A golden blast that fills the arena. Chaos+ supporters only.', premium: true },
];

export const cosmeticUnlocked = (c: LevelCosmetic<string>, xp: number, chaosPlus = false) => (c.premium ? chaosPlus : levelFromXp(xp).level >= c.level);

/** Cosmetics that became available between two XP totals (for the rewards screen). */
export function unlockedBetween(before: number, after: number): string[] {
  const a = levelFromXp(before).level;
  const b = levelFromXp(after).level;
  return [...TRAILS.map((t) => ({ ...t, kind: 'trail' })), ...VICTORIES.map((v) => ({ ...v, kind: 'victory effect' }))]
    .filter((c) => !c.premium && c.level > a && c.level <= b)
    .map((c) => `${c.name} ${c.kind}`);
}

/** The equipped cosmetic if it is unlocked at this XP, otherwise the free default. */
export function equipped<T extends string>(list: readonly LevelCosmetic<T>[], id: string, xp: number, chaosPlus = false): T {
  const c = list.find((x) => x.id === id);
  return c && cosmeticUnlocked(c, xp, chaosPlus) ? c.id : list[0].id;
}
