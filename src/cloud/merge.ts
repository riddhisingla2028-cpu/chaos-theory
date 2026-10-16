// Merging two saves of the same player (this device and the cloud) without losing progress.
// Every rule picks the better of the two values, so merging is safe in either direction and
// merging the same saves again changes nothing. Settings and local-only flags stay with the device.

import type { Progress, RecordEntry, StageStats } from '../progress';
import type { ChallengeSet } from '../progression';
import { HISTORY_KEEP } from '../progression';

const maxRecord = (a: Record<number, number>, b: Record<number, number>) => {
  const out: Record<number, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[+k] = Math.max(out[+k] ?? 0, v);
  return out;
};

const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];

function mergeRecords(a: RecordEntry[], b: RecordEntry[]): RecordEntry[] {
  const seen = new Set<string>();
  const all = [...a, ...b].filter((r) => {
    const key = `${r.mode}|${r.label}|${r.score}|${r.time}|${r.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const modes = union(all.map((r) => r.mode), []);
  return modes.flatMap((m) =>
    all
      .filter((r) => r.mode === m)
      .sort((x, y) => y.score - x.score)
      .slice(0, 10),
  );
}

function mergeStageStats(a: Record<number, StageStats>, b: Record<number, StageStats>): Record<number, StageStats> {
  const out: Record<number, StageStats> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[+k];
    if (!cur) {
      out[+k] = v;
      continue;
    }
    const fastest = cur.fastest === null ? v.fastest : v.fastest === null ? cur.fastest : Math.min(cur.fastest, v.fastest);
    out[+k] = { attempts: Math.max(cur.attempts, v.attempts), deaths: Math.max(cur.deaths, v.deaths), fastest };
  }
  return out;
}

function mergeChallengeSet(a: ChallengeSet | null, b: ChallengeSet | null): ChallengeSet | null {
  if (!a || !b) return a ?? b;
  if (a.key !== b.key) return a.key > b.key ? a : b; // the newer day or week wins
  return {
    key: a.key,
    ids: a.ids,
    progress: a.progress.map((v, i) => Math.max(v, b.progress[i] ?? 0)),
    done: a.done.map((v, i) => v || !!b.done[i]),
  };
}

/**
 * Combine this device's save with the cloud save. `local` keeps its settings (they are per device).
 * XP and lifetime totals take the larger value rather than adding, so the same runs are never
 * counted twice when a device syncs again.
 */
export function mergeProgress(local: Progress, cloud: Progress): Progress {
  const stages: Progress['stages'] = { ...local.stages };
  for (const [k, v] of Object.entries(cloud.stages)) {
    const cur = stages[+k];
    stages[+k] = cur ? { stars: Math.max(cur.stars, v.stars), best: Math.max(cur.best, v.best) } : v;
  }
  const modeBests = { ...local.modeBests };
  for (const [k, v] of Object.entries(cloud.modeBests) as [keyof Progress['modeBests'], Progress['modeBests'][keyof Progress['modeBests']]][]) {
    const cur = modeBests[k];
    modeBests[k] = cur
      ? { score: Math.max(cur.score, v.score), time: Math.max(cur.time, v.time), orbs: Math.max(cur.orbs, v.orbs), events: Math.max(cur.events, v.events), bosses: Math.max(cur.bosses, v.bosses) }
      : v;
  }
  const historyKeys = new Set<string>();
  const history = [...local.history, ...cloud.history]
    .filter((h) => {
      const key = `${h.date}|${h.mode}|${h.score}`;
      if (historyKeys.has(key)) return false;
      historyKeys.add(key);
      return true;
    })
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    .slice(0, HISTORY_KEEP);

  const daily =
    local.daily && cloud.daily
      ? local.daily.date === cloud.daily.date
        ? { date: local.daily.date, best: Math.max(local.daily.best, cloud.daily.best) }
        : local.daily.date > cloud.daily.date
          ? local.daily
          : cloud.daily
      : (local.daily ?? cloud.daily);

  return {
    ...local,
    stages,
    stageTime: maxRecord(local.stageTime, cloud.stageTime),
    stageStats: mergeStageStats(local.stageStats, cloud.stageStats),
    fails: local.fails,
    skipped: union(local.skipped, cloud.skipped).filter((i) => !stages[i]),
    modeBests,
    endlessBest: Math.max(local.endlessBest, cloud.endlessBest),
    daily,
    dailyPlays: Math.max(local.dailyPlays, cloud.dailyPlays),
    trialBest: maxRecord(local.trialBest, cloud.trialBest),
    achievements: union(local.achievements, cloud.achievements),
    chaosSurvived: union(local.chaosSurvived, cloud.chaosSurvived),
    runs: Math.max(local.runs, cloud.runs),
    totalTime: Math.max(local.totalTime, cloud.totalTime),
    orbsTotal: Math.max(local.orbsTotal, cloud.orbsTotal),
    records: mergeRecords(local.records, cloud.records),
    tutorialSeen: local.tutorialSeen || cloud.tutorialSeen,
    xp: Math.max(local.xp, cloud.xp),
    challenges: { daily: mergeChallengeSet(local.challenges.daily, cloud.challenges.daily), weekly: mergeChallengeSet(local.challenges.weekly, cloud.challenges.weekly) },
    history,
    // Never synced: device settings, and the cosmetics preview flag (not a purchase).
    settings: local.settings,
    premiumDemo: local.premiumDemo,
  };
}
