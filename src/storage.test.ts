import { describe, expect, it } from 'vitest';
import { BEST_KEY, loadBest, recordBest, type KeyValueStore } from './storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('personal best storage', () => {
  it('starts at zero and saves a new best', () => {
    const store = memoryStore();
    expect(loadBest(store)).toBe(0);
    expect(recordBest(120, store)).toEqual({ best: 120, isNew: true });
    expect(store.data.get(BEST_KEY)).toBe('120');
    expect(loadBest(store)).toBe(120);
  });

  it('keeps the higher score', () => {
    const store = memoryStore();
    recordBest(300, store);
    expect(recordBest(200, store)).toEqual({ best: 300, isNew: false });
    expect(loadBest(store)).toBe(300);
  });

  it('ignores corrupted values', () => {
    const store = memoryStore();
    store.setItem(BEST_KEY, 'not-a-number');
    expect(loadBest(store)).toBe(0);
  });

  it('survives storage that throws or is missing', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadBest(broken)).toBe(0);
    expect(recordBest(50, broken)).toEqual({ best: 50, isNew: true });
    expect(loadBest(null)).toBe(0);
  });
});
