import { describe, expect, it } from 'vitest';
import { starThresholds } from './game/stages';
import {
  PROGRESS_KEY,
  SAVE_VERSION,
  SKIP_AFTER_FAILS,
  applyRun,
  canOfferSkip,
  isSkipped,
  setPremiumDemo,
  skipLevel,
  defaultProgress,
  isStageUnlocked,
  loadProgress,
  nextStage,
  saveProgress,
  totalStars,
  type RunSummary,
} from './progress';
import { BEST_KEY, type KeyValueStore } from './storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function runOf(over: Partial<RunSummary>): RunSummary {
  return { mode: 'stage', stage: 0, won: false, score: 0, time: 0, nearMisses: 0, peakMultiplier: 1, chaosSurvived: [], ...over };
}

describe('stage progression', () => {
  it('only the first stage is unlocked at the start', () => {
    const p = defaultProgress();
    expect(isStageUnlocked(p, 0)).toBe(true);
    expect(isStageUnlocked(p, 1)).toBe(false);
    expect(nextStage(p)).toBe(0);
  });

  it('clearing a stage unlocks the next and awards stars', () => {
    const [, three] = starThresholds(0);
    const out = applyRun(defaultProgress(), runOf({ won: true, score: three, time: 20 }));
    expect(out.stars).toBe(3);
    expect(isStageUnlocked(out.progress, 1)).toBe(true);
    expect(nextStage(out.progress)).toBe(1);
    expect(totalStars(out.progress)).toBe(3);
  });

  it('a failed attempt records time but does not clear the stage', () => {
    const out = applyRun(defaultProgress(), runOf({ won: false, score: 120, time: 12 }));
    expect(out.progress.stageTime[0]).toBe(12);
    expect(isStageUnlocked(out.progress, 1)).toBe(false);
  });

  it('keeps the best stars when a later clear scores lower', () => {
    const [, three] = starThresholds(0);
    const first = applyRun(defaultProgress(), runOf({ won: true, score: three, time: 20 })).progress;
    const second = applyRun(first, runOf({ won: true, score: 40, time: 5 }));
    expect(second.progress.stages[0].stars).toBe(3);
    expect(second.progress.stages[0].best).toBe(three);
    expect(second.isNewBest).toBe(false);
  });
});

describe('endless and daily bests', () => {
  it('tracks the endless personal best', () => {
    const a = applyRun(defaultProgress(), runOf({ mode: 'endless', stage: -1, score: 500, time: 40 }));
    expect(a.isNewBest).toBe(true);
    const b = applyRun(a.progress, runOf({ mode: 'endless', stage: -1, score: 300, time: 25 }));
    expect(b.isNewBest).toBe(false);
    expect(b.progress.endlessBest).toBe(500);
  });

  it('keeps one daily best per date', () => {
    const a = applyRun(defaultProgress(), runOf({ mode: 'daily', stage: -1, score: 400, dateKey: '2026-10-16' }));
    const b = applyRun(a.progress, runOf({ mode: 'daily', stage: -1, score: 100, dateKey: '2026-10-17' }));
    expect(b.isNewBest).toBe(true); // first run of a new day
    expect(b.progress.daily).toEqual({ date: '2026-10-17', best: 100 });
    expect(b.progress.dailyPlays).toBe(2);
  });
});

describe('achievements and unlocks', () => {
  it('awards achievements once and unlocks cosmetics', () => {
    const out = applyRun(defaultProgress(), runOf({ mode: 'endless', stage: -1, score: 400, time: 31, nearMisses: 12, peakMultiplier: 3 }));
    const ids = out.newAchievements.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['first-run', 'survive-30', 'graze-10', 'combo-3']));
    expect(out.newUnlocks).toContainEqual({ kind: 'shape', id: 'circle', name: 'Circle' });

    const again = applyRun(out.progress, runOf({ mode: 'endless', stage: -1, score: 400, time: 31 }));
    expect(again.newAchievements.map((a) => a.id)).not.toContain('survive-30');
  });

  it('clearing stage 2 unlocks the diamond shape', () => {
    let p = applyRun(defaultProgress(), runOf({ stage: 0, won: true, score: 200, time: 20 })).progress;
    const out = applyRun(p, runOf({ stage: 1, won: true, score: 300, time: 30 }));
    p = out.progress;
    expect(out.newUnlocks.map((u) => u.id)).toContain('diamond');
  });

  it('accumulates lifetime survival time', () => {
    const a = applyRun(defaultProgress(), runOf({ time: 12.5 })).progress;
    const b = applyRun(a, runOf({ mode: 'endless', stage: -1, time: 30 })).progress;
    expect(b.totalTime).toBeCloseTo(42.5);
    expect(b.runs).toBe(2);
  });

  it('records which chaos types have been survived', () => {
    const out = applyRun(defaultProgress(), runOf({ chaosSurvived: ['INVERSION', 'SURGE'] }));
    expect(out.progress.chaosSurvived).toEqual(['INVERSION', 'SURGE']);
  });
});

describe('persistence', () => {
  it('round-trips progress through storage', () => {
    const store = memoryStore();
    const p = applyRun(defaultProgress(), runOf({ mode: 'endless', stage: -1, score: 777, time: 50 })).progress;
    saveProgress(p, store);
    expect(loadProgress(store)).toEqual(p);
    expect(store.data.get(BEST_KEY)).toBe('777');
  });

  it('migrates the personal best from the original version', () => {
    const store = memoryStore();
    store.setItem(BEST_KEY, '432');
    expect(loadProgress(store).endlessBest).toBe(432);
  });

  it('falls back to defaults on corrupt or blocked storage', () => {
    const store = memoryStore();
    store.setItem(PROGRESS_KEY, '{not json');
    expect(loadProgress(store).runs).toBe(0);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadProgress(broken).runs).toBe(0);
    expect(() => saveProgress(defaultProgress(), broken)).not.toThrow();
  });
});

describe('level skips (demo purchase)', () => {
  it('is only offered after repeated failures, never for the final level', () => {
    let p = defaultProgress();
    for (let i = 0; i < SKIP_AFTER_FAILS - 1; i++) p = applyRun(p, runOf({ stage: 0, time: 2 })).progress;
    expect(canOfferSkip(p, 0)).toBe(false);
    p = applyRun(p, runOf({ stage: 0, time: 2 })).progress;
    expect(canOfferSkip(p, 0)).toBe(true);
    expect(canOfferSkip({ ...p, fails: { 9: 10 } }, 9)).toBe(false);
  });

  it('skipping unlocks the next level without awarding stars', () => {
    const p = skipLevel(defaultProgress(), 0);
    expect(isSkipped(p, 0)).toBe(true);
    expect(isStageUnlocked(p, 1)).toBe(true);
    expect(totalStars(p)).toBe(0);
    expect(nextStage(p)).toBe(1);
  });

  it('clearing a level resets its failure count', () => {
    let p = applyRun(defaultProgress(), runOf({ stage: 0, time: 2 })).progress;
    p = applyRun(p, runOf({ stage: 0, won: true, score: 50, time: 5 })).progress;
    expect(p.fails[0]).toBe(0);
  });
});

describe('Chaos+ demo entitlement', () => {
  it('unlocks premium cosmetics and removing it falls back to free ones', () => {
    const on = setPremiumDemo(defaultProgress(), true);
    expect(on.progress.premiumDemo).toBe(true);
    expect(on.unlocks.map((u) => u.id).sort()).toEqual(['aurora', 'nova', 'spark', 'synthwave']);
    const equipped = { ...on.progress, settings: { ...on.progress.settings, shape: 'nova' as const, theme: 'synthwave' as const } };
    const off = setPremiumDemo(equipped, false).progress;
    expect(off.premiumDemo).toBe(false);
    expect(off.settings.shape).toBe('square');
    expect(off.settings.theme).toBe('obsidian');
  });
});

describe('records', () => {
  it('keeps the top 10 per mode, best first', () => {
    let p = defaultProgress();
    for (let i = 1; i <= 12; i++) p = applyRun(p, runOf({ mode: 'endless', stage: -1, score: i * 10, time: i, label: 'Endless' })).progress;
    const endless = p.records.filter((r) => r.mode === 'endless');
    expect(endless).toHaveLength(10);
    expect(endless[0].score).toBe(120);
    expect(endless[endless.length - 1].score).toBe(30);
  });

  it('tracks trial bests and lifetime orbs', () => {
    const out = applyRun(defaultProgress(), runOf({ mode: 'trial', stage: 0, won: true, score: 900, time: 45, orbs: 14 }));
    expect(out.progress.trialBest[0]).toBe(900);
    expect(out.progress.orbsTotal).toBe(14);
  });
});

describe('save migration', () => {
  it('drops per-level records from the old level list but keeps everything else', () => {
    const store = memoryStore();
    store.setItem(PROGRESS_KEY, JSON.stringify({ stages: { 0: { stars: 3, best: 999 } }, endlessBest: 1234, achievements: ['first-run'], runs: 7 }));
    const p = loadProgress(store);
    expect(p.stages).toEqual({});
    expect(p.endlessBest).toBe(1234);
    expect(p.achievements).toEqual(['first-run']);
    expect(p.runs).toBe(7);
  });
});

describe('Endless mode personal bests', () => {
  const endless = (mode: RunSummary['mode'], over: Partial<RunSummary>) => runOf({ mode, stage: -1, ...over });

  it('records each mode separately and reports which bests improved', () => {
    const a = applyRun(defaultProgress(), endless('orbrush', { score: 900, time: 40, orbs: 22 }));
    expect(a.progress.modeBests.orbrush).toMatchObject({ score: 900, time: 40, orbs: 22 });
    expect(a.newBests.sort()).toEqual(['orbs', 'score', 'time']);
    expect(a.progress.modeBests.chaos.score).toBe(0);
  });

  it('a lower result never overwrites a higher best, field by field', () => {
    let p = applyRun(defaultProgress(), endless('bossrush', { score: 2000, time: 60, bosses: 3 })).progress;
    const out = applyRun(p, endless('bossrush', { score: 2500, time: 30, bosses: 1 }));
    p = out.progress;
    expect(p.modeBests.bossrush).toMatchObject({ score: 2500, time: 60, bosses: 3 });
    expect(out.newBests).toEqual(['score']);
  });

  it('Classic Survival keeps the legacy endless best in sync', () => {
    const p = applyRun(defaultProgress(), endless('endless', { score: 777, time: 70 })).progress;
    expect(p.endlessBest).toBe(777);
    expect(p.modeBests.endless.score).toBe(777);
  });

  it('awards the new mode achievements', () => {
    const ids = (r: RunSummary) => applyRun(defaultProgress(), r).newAchievements.map((a) => a.id);
    expect(ids(endless('orbrush', { orbs: 31, score: 1 }))).toContain('orbrush-30');
    expect(ids(endless('chaos', { events: 10, score: 1 }))).toContain('chaos-10');
    expect(ids(endless('bossrush', { bosses: 3, score: 1 }))).toContain('bossrush-3');
    expect(ids(endless('endless', { time: 121, score: 1 }))).toContain('classic-120');
  });

  it('restarting does not reset lifetime stats or campaign progress', () => {
    let p = applyRun(defaultProgress(), runOf({ stage: 0, won: true, score: 220, time: 15 })).progress;
    p = applyRun(p, endless('chaos', { score: 300, time: 20, events: 2 })).progress;
    p = applyRun(p, endless('chaos', { score: 100, time: 8, events: 0 })).progress;
    expect(p.runs).toBe(3);
    expect(p.stages[0].stars).toBeGreaterThanOrEqual(1);
    expect(p.modeBests.chaos.score).toBe(300);
  });
});

describe('save version 3 migration', () => {
  it('upgrades an older save without losing campaign progress, and seeds the Classic best', () => {
    const store = memoryStore();
    store.setItem(
      PROGRESS_KEY,
      JSON.stringify({ levelsVersion: 2, stages: { 0: { stars: 2, best: 150 }, 1: { stars: 1, best: 300 } }, endlessBest: 640, achievements: ['first-run'], runs: 9, settings: { muted: true } }),
    );
    const p = loadProgress(store);
    expect(p.saveVersion).toBe(SAVE_VERSION);
    expect(p.stages[1]).toEqual({ stars: 1, best: 300 });
    expect(p.modeBests.endless.score).toBe(640);
    expect(p.modeBests.orbrush.score).toBe(0);
    expect(p.settings.muted).toBe(true); // mute preference survives
    expect(p.settings.music).toBe(true); // new settings get defaults
  });

  it('persists the mute preference', () => {
    const store = memoryStore();
    const p = defaultProgress();
    saveProgress({ ...p, settings: { ...p.settings, muted: true } }, store);
    expect(loadProgress(store).settings.muted).toBe(true);
  });
});
