import { describe, expect, it } from 'vitest';
import { PROGRESS_KEY, SHIPS, applyMission, defaultProgress, equippedShip, isMissionUnlocked, loadProgress, missionsCompleted, nextMission, type MissionResult } from '../progress';
import { mergeProgress } from '../cloud/merge';
import type { KeyValueStore } from '../storage';
import { MISSIONS } from './sim';

const result = (over: Partial<MissionResult> = {}): MissionResult => ({
  id: 'first-contact',
  won: true,
  score: 2400,
  time: 38,
  stars: 2,
  secondaries: [true, false],
  coresTaken: 5,
  kills: 0,
  bossDefeated: false,
  ...over,
});

describe('mission progression', () => {
  it('only the first mission is open at the start; completing one unlocks the next', () => {
    let p = defaultProgress();
    expect(isMissionUnlocked(p, 0)).toBe(true);
    expect(isMissionUnlocked(p, 1)).toBe(false);
    expect(nextMission(p)).toBe(0);
    p = applyMission(p, result()).progress;
    expect(isMissionUnlocked(p, 1)).toBe(true);
    expect(isMissionUnlocked(p, 2)).toBe(false);
    expect(nextMission(p)).toBe(1);
    expect(missionsCompleted(p)).toBe(1);
  });

  it('a failed mission records the attempt but awards no completion, stars or unlock', () => {
    const o = applyMission(defaultProgress(), result({ won: false, stars: 0, secondaries: [false, false], time: 12 }));
    const rec = o.progress.missions['first-contact'];
    expect(rec).toMatchObject({ completed: false, stars: 0, best: 0, attempts: 1, failures: 1 });
    expect(isMissionUnlocked(o.progress, 1)).toBe(false);
    expect(o.xpLines.some((l) => /complete/i.test(l.label))).toBe(false);
    expect(o.firstClear).toBe(false);
  });

  it('keeps best stars, best score, fastest time and every optional objective ever met', () => {
    let p = applyMission(defaultProgress(), result({ stars: 2, score: 2400, time: 40, secondaries: [true, false] })).progress;
    p = applyMission(p, result({ stars: 2, score: 1800, time: 33, secondaries: [false, true] })).progress;
    const rec = p.missions['first-contact'];
    expect(rec.stars).toBe(2);
    expect(rec.best).toBe(2400);
    expect(rec.fastest).toBe(33);
    expect(rec.secondaries).toEqual([true, true]);
    expect(rec.attempts).toBe(2);
  });

  it('first completion pays a bonus once; XP matches the itemised lines', () => {
    const a = applyMission(defaultProgress(), result());
    expect(a.firstClear).toBe(true);
    expect(a.xpLines.some((l) => l.label === 'First completion')).toBe(true);
    expect(a.xpGained).toBe(a.xpLines.reduce((n, l) => n + l.xp, 0));
    const b = applyMission(a.progress, result());
    expect(b.firstClear).toBe(false);
    expect(b.xpLines.some((l) => l.label === 'First completion')).toBe(false);
  });

  it('ship hulls unlock from mission completions and are cosmetic only', () => {
    let p = defaultProgress();
    expect(SHIPS.filter((s) => s.unlocked(p)).map((s) => s.id)).toEqual(['arrow']);
    p = applyMission(p, result()).progress;
    const o = applyMission(p, result({ id: 'shattered-orbit' }));
    expect(o.newShips).toEqual(['Interceptor spacecraft']);
    // An equipped hull that is not unlocked falls back to the default.
    const q = { ...defaultProgress(), settings: { ...defaultProgress().settings, ship: 'manta' as const } };
    expect(equippedShip(q)).toBe('arrow');
  });

  it('older saves (before missions) load with their progress intact and no missions', () => {
    const old = { ...defaultProgress(), stages: { 0: { stars: 3, best: 500 } }, xp: 900 } as Record<string, unknown>;
    delete old.missions;
    const store: KeyValueStore = { getItem: (k) => (k === PROGRESS_KEY ? JSON.stringify(old) : null), setItem: () => {} };
    const p = loadProgress(store);
    expect(p.stages[0]).toEqual({ stars: 3, best: 500 });
    expect(p.xp).toBe(900);
    expect(p.missions).toEqual({});
    expect(p.settings.ship).toBe('arrow');
  });

  it('cloud merge keeps the best mission records from both devices', () => {
    const a = applyMission(defaultProgress(), result({ score: 3000, time: 50, stars: 2 })).progress;
    const b = applyMission(defaultProgress(), result({ score: 2000, time: 30, stars: 3, secondaries: [true, true] })).progress;
    const m = mergeProgress(a, b).missions['first-contact'];
    expect(m).toMatchObject({ completed: true, stars: 3, best: 3000, fastest: 30, secondaries: [true, true] });
  });

  it('every mission id has a matching definition', () => {
    for (const m of MISSIONS) expect(typeof m.build).toBe('function');
  });
});
