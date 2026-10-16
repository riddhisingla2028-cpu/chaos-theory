import { describe, expect, it } from 'vitest';
import {
  HISTORY_KEEP,
  MAX_ACCOUNT_LEVEL,
  TRAILS,
  VICTORIES,
  addHistory,
  applyChallenges,
  challengeById,
  currentChallenges,
  levelFromXp,
  runXp,
  unlockedBetween,
  weekKeyOf,
  xpForNext,
  type RunFacts,
} from './progression';
import { PROGRESS_KEY, applyRun, defaultProgress, loadProgress } from './progress';
import type { KeyValueStore } from './storage';

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  mode: 'stage',
  won: false,
  time: 10,
  orbs: 0,
  nearMisses: 0,
  bosses: 0,
  stars: 0,
  firstClear: false,
  ...over,
});

describe('account levels', () => {
  it('starts at level 1 and levels up at the right XP', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, need: xpForNext(1) });
    expect(levelFromXp(xpForNext(1)).level).toBe(2);
    expect(levelFromXp(xpForNext(1) - 1).level).toBe(1);
    expect(levelFromXp(xpForNext(1) + xpForNext(2)).level).toBe(3);
  });

  it('caps at the maximum level and ignores nonsense XP', () => {
    expect(levelFromXp(1e9).level).toBe(MAX_ACCOUNT_LEVEL);
    expect(levelFromXp(-50).level).toBe(1);
  });
});

describe('run XP', () => {
  it('itemises survival, orbs, near misses and clears, with caps', () => {
    const lines = runXp(facts({ won: true, time: 500, orbs: 100, nearMisses: 100, stars: 3, firstClear: true }));
    const total = Object.fromEntries(lines.map((l) => [l.label.split(' ')[0], l.xp]));
    expect(total.Survived).toBe(120);
    expect(lines.find((l) => l.label.includes('orbs'))!.xp).toBe(150);
    expect(lines.find((l) => l.label.includes('near'))!.xp).toBe(60);
    expect(lines.find((l) => l.label.includes('Level cleared'))!.xp).toBe(100);
    expect(lines.find((l) => l.label === 'First clear')!.xp).toBe(100);
  });

  it('a lost level run still earns survival XP but no clear bonus', () => {
    const lines = runXp(facts({ time: 20 }));
    expect(lines).toEqual([{ label: 'Survived 20s', xp: 20 }]);
  });
});

describe('daily and weekly challenges', () => {
  const day = new Date(2026, 9, 16, 12);

  it('are the same for everyone on the same day and change the next day', () => {
    const a = currentChallenges({ daily: null, weekly: null }, day);
    const b = currentChallenges({ daily: null, weekly: null }, new Date(2026, 9, 16, 20));
    const c = currentChallenges({ daily: null, weekly: null }, new Date(2026, 9, 17, 9));
    expect(a.daily!.ids).toEqual(b.daily!.ids);
    expect(a.daily!.ids).toHaveLength(3);
    expect(a.weekly!.ids).toHaveLength(3);
    expect(c.daily!.key).not.toBe(a.daily!.key);
  });

  it('uses ISO weeks starting on Monday', () => {
    expect(weekKeyOf(new Date(2026, 9, 12))).toBe(weekKeyOf(new Date(2026, 9, 18))); // Mon..Sun
    expect(weekKeyOf(new Date(2026, 9, 19))).not.toBe(weekKeyOf(new Date(2026, 9, 18)));
    expect(weekKeyOf(new Date(2026, 0, 1))).toBe('2026-W01');
  });

  it('accumulate across runs and report each completion exactly once', () => {
    let state = currentChallenges({ daily: null, weekly: null }, day);
    // Force a known challenge into the daily set.
    state = { ...state, daily: { key: state.daily!.key, ids: ['d-runs'], progress: [0], done: [false] } };
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = applyChallenges(state, facts(), day);
      state = r.state;
      seen.push(...r.completed.filter((c) => c.scope === 'daily').map((c) => c.def.id));
    }
    expect(seen).toEqual(['d-runs']);
    expect(state.daily!.progress[0]).toBe(challengeById('d-runs')!.target);
  });

  it('"single run" challenges take the best run, not the sum', () => {
    let state = currentChallenges({ daily: null, weekly: null }, day);
    state = { ...state, daily: { key: state.daily!.key, ids: ['d-survive'], progress: [0], done: [false] } };
    state = applyChallenges(state, facts({ time: 30 }), day).state;
    state = applyChallenges(state, facts({ time: 30 }), day).state;
    expect(state.daily!.progress[0]).toBe(30);
    expect(state.daily!.done[0]).toBe(false);
  });
});

describe('match history and cosmetics', () => {
  it('keeps the most recent matches, newest first', () => {
    let h: ReturnType<typeof addHistory> = [];
    for (let i = 0; i < HISTORY_KEEP + 5; i++) h = addHistory(h, { mode: 'endless', label: 'x', won: false, score: i, time: 1, xp: 1, date: '' });
    expect(h).toHaveLength(HISTORY_KEEP);
    expect(h[0].score).toBe(HISTORY_KEEP + 4);
  });

  it('every trail and victory effect can be earned, and the first of each is free', () => {
    for (const list of [TRAILS, VICTORIES]) {
      expect(list[0].level).toBe(1);
      for (const c of list) expect(c.level).toBeLessThanOrEqual(MAX_ACCOUNT_LEVEL);
    }
    expect(unlockedBetween(0, 1e9).length).toBe(TRAILS.length + VICTORIES.length - 2);
  });
});

describe('progression inside saves', () => {
  it('a run adds XP, history and per-level records (attempts, deaths, fastest clear)', () => {
    const now = new Date(2026, 9, 16);
    let p = defaultProgress();
    let o = applyRun(p, { mode: 'stage', stage: 0, won: false, score: 50, time: 7, nearMisses: 0, peakMultiplier: 1, chaosSurvived: [] }, now);
    p = o.progress;
    o = applyRun(p, { mode: 'stage', stage: 0, won: true, score: 300, time: 15.4, nearMisses: 2, peakMultiplier: 1, chaosSurvived: [] }, now);
    p = o.progress;
    expect(p.stageStats[0]).toEqual({ attempts: 2, deaths: 1, fastest: 15.4 });
    expect(o.xpGained).toBe(o.xpLines.reduce((n, l) => n + l.xp, 0));
    expect(o.xpLines.some((l) => l.label === 'First clear')).toBe(true);
    expect(p.xp).toBe(o.xpBefore + o.xpGained);
    expect(p.history.map((h) => h.won)).toEqual([true, false]);
  });

  it('an old save (version 3) loads with its progress intact and fresh XP and challenges', () => {
    const old = { ...defaultProgress(), saveVersion: 3, levelsVersion: 2, stages: { 0: { stars: 2, best: 400 } }, runs: 12 } as Record<string, unknown>;
    delete old.xp;
    delete old.history;
    delete old.challenges;
    delete old.stageStats;
    const s = old.settings as Record<string, unknown>;
    delete s.sfxVolume;
    delete s.trail;
    const store: KeyValueStore = { getItem: (k) => (k === PROGRESS_KEY ? JSON.stringify(old) : null), setItem: () => {} };
    const p = loadProgress(store);
    expect(p.stages[0]).toEqual({ stars: 2, best: 400 });
    expect(p.runs).toBe(12);
    expect(p.xp).toBe(0);
    expect(p.history).toEqual([]);
    expect(p.settings.sfxVolume).toBe(0.8);
    expect(p.settings.trail).toBe('classic');
  });

  it('rejects a corrupt volume rather than playing at a surprising level', () => {
    const bad = { ...defaultProgress(), settings: { ...defaultProgress().settings, sfxVolume: 40, musicVolume: 'loud' } };
    const store: KeyValueStore = { getItem: () => JSON.stringify(bad), setItem: () => {} };
    const p = loadProgress(store);
    expect(p.settings.sfxVolume).toBe(1);
    expect(p.settings.musicVolume).toBe(0.6);
  });
});
