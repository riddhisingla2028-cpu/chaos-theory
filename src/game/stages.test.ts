import { describe, expect, it } from 'vitest';
import { configForPhase, createGame, step } from './engine';
import { createAutopilot } from './autopilot';
import { ENDLESS_MODES, MUTATORS, STAGES, TRIALS, dailyChallenge, dailyKey, objectiveText, stageConfig, starThresholds, starsFor, trialConfig } from './stages';

describe('level definitions', () => {
  it('has exactly the 10 designed levels, in order', () => {
    expect(STAGES.map((s) => s.name)).toEqual([
      'Beginner',
      'Speed Rush',
      'Orb Hunt',
      'Reverse Control',
      'The Vanishing Zone',
      'Double Chaos',
      'Glitch Attack',
      'Shrinking Arena',
      'Chaos Combo',
      'Final Showdown',
    ]);
  });

  it('matches the specified objectives', () => {
    expect(STAGES.map((s) => objectiveText(s.objective))).toEqual([
      'Survive 15s',
      'Survive 24s',
      'Collect 10 orbs',
      'Survive 24s',
      'Survive 28s',
      'Collect 12 orbs',
      'Survive 28s',
      'Survive 30s',
      'Collect 15 orbs in 50s',
      'Defeat the Core',
    ]);
  });

  it('gives every level its own colour and mechanic', () => {
    expect(new Set(STAGES.map((s) => s.accent.join())).size).toBe(STAGES.length);
    for (const s of STAGES) expect(s.mechanics.length).toBeGreaterThan(0);
  });

  it('difficulty ratings never decrease', () => {
    for (let i = 1; i < STAGES.length; i++) expect(STAGES[i].difficulty).toBeGreaterThanOrEqual(STAGES[i - 1].difficulty);
  });

  it('each level config switches on its signature mechanic', () => {
    const last = (i: number) => configForPhase(stageConfig(i), 3);
    expect(last(1).hazardSpeed).toBeGreaterThan(1.3);
    expect(stageConfig(2).objective?.type).toBe('orbs');
    expect(last(3).events.map((e) => e.kind)).toEqual(['INVERSION']);
    expect(stageConfig(4).voids).toBe(true);
    expect(last(5).pairs.length).toBeGreaterThan(0);
    expect(last(6).teleport).toBe(true);
    expect(last(7).shrink).not.toBeNull();
    expect(last(8).pairChance).toBeGreaterThan(0);
    expect(stageConfig(9).boss).not.toBeNull();
    expect(last(9).bossTier).toBe(3);
  });

  it('awards 1 to 3 stars by score', () => {
    const [two, three] = starThresholds(0);
    expect(starsFor(0, two - 1)).toBe(1);
    expect(starsFor(0, two)).toBe(2);
    expect(starsFor(0, three)).toBe(3);
  });

  it('every level and trial can actually be won (the autopilot clears each at least once)', () => {
    const configs = [...STAGES.map((_, i) => stageConfig(i)), ...TRIALS.map((_, i) => trialConfig(i))];
    for (const cfg of configs) {
      let wins = 0;
      for (let seed = 1; seed <= 30 && wins === 0; seed++) {
        const g = createGame(seed * 7919, cfg);
        const pilot = createAutopilot();
        while (g.status === 'playing' && g.time < 120) step(g, pilot(g), 1 / 120);
        if (g.status === 'won') wins++;
      }
      expect(wins, `${cfg.mode} ${cfg.stage}`).toBe(1);
    }
  });
});

describe('Endless modes are genuinely playable', () => {
  it('the autopilot survives a while in every mode and beats at least one Boss Rush boss', () => {
    for (const m of ENDLESS_MODES) {
      let best = 0;
      let bosses = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const g = createGame(seed * 104729, m.config);
        const pilot = createAutopilot();
        while (g.status === 'playing' && g.time < 90) step(g, pilot(g), 1 / 120);
        best = Math.max(best, g.time);
        bosses = Math.max(bosses, g.stats.bosses);
      }
      expect(best, m.name).toBeGreaterThan(25);
      if (m.id === 'bossrush') expect(bosses).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('daily challenge', () => {
  it('formats the date as YYYY-MM-DD', () => {
    expect(dailyKey(new Date(2026, 9, 7))).toBe('2026-10-07');
  });

  it('is the same for everyone on the same day', () => {
    const a = dailyChallenge('2026-10-17');
    const b = dailyChallenge('2026-10-17');
    expect(a.seed).toBe(b.seed);
    expect(a.mutator.id).toBe(b.mutator.id);
    expect(a.config.mode).toBe('daily');
  });

  it('changes from day to day and uses every mutator', () => {
    const seen = new Set<string>();
    const seeds = new Set<number>();
    for (let d = 1; d <= 28; d++) {
      const c = dailyChallenge(`2026-11-${String(d).padStart(2, '0')}`);
      seen.add(c.mutator.id);
      seeds.add(c.seed);
    }
    expect(seeds.size).toBe(28);
    expect(seen.size).toBe(MUTATORS.length);
  });
});
