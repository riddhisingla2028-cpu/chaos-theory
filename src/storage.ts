// Personal best persistence. Every access is guarded: storage can be missing or
// throw (private browsing, blocked site data), and the game must still work.

export const BEST_KEY = 'chaos-theory.best';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadBest(storage: KeyValueStore | null = browserStorage()): number {
  try {
    const value = Number(storage?.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function recordBest(
  score: number,
  storage: KeyValueStore | null = browserStorage(),
): { best: number; isNew: boolean } {
  const previous = loadBest(storage);
  if (score <= previous) return { best: previous, isNew: false };
  try {
    storage?.setItem(BEST_KEY, String(score));
  } catch {
    // Storage unavailable: the best still shows for this session.
  }
  return { best: score, isNew: true };
}
