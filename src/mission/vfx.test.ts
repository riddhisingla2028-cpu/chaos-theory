import { describe, expect, it } from 'vitest';
import { Vfx } from './vfx';

describe('combat effects pool', () => {
  it('an explosion spawns effects that all expire within a few seconds', () => {
    const v = new Vfx();
    v.explosion(100, 100, 2);
    expect(v.live).toBeGreaterThan(20);
    for (let i = 0; i < 60 * 4; i++) v.update(1 / 60);
    expect(v.live).toBe(0);
  });

  it('is bounded: a huge fight cannot grow the pools without limit', () => {
    const v = new Vfx();
    for (let i = 0; i < 400; i++) v.explosion(i, i, 3);
    expect(v.live).toBeLessThanOrEqual(260 + 70 + 60 + 24 + 16);
  });

  it('reduced density spawns fewer particles but still marks the blast', () => {
    const full = new Vfx();
    const low = new Vfx();
    low.density = 0.35;
    full.explosion(0, 0, 2);
    low.explosion(0, 0, 2);
    expect(low.live).toBeLessThan(full.live);
    expect(low.live).toBeGreaterThan(3); // flash and shockwave always remain
  });

  it('a destruction chain fires its blasts over time, ending in a final large one', () => {
    const v = new Vfx();
    v.chain(0, 0, 50, 5, 1);
    expect(v.live).toBe(0);
    let peak = 0;
    for (let i = 0; i < 70; i++) {
      v.update(1 / 60);
      peak = Math.max(peak, v.live);
    }
    expect(peak).toBeGreaterThan(30);
  });

  it('reset clears everything, including queued blasts', () => {
    const v = new Vfx();
    v.chain(0, 0, 50, 5, 1);
    v.explosion(0, 0, 1);
    v.reset();
    for (let i = 0; i < 90; i++) v.update(1 / 60);
    expect(v.live).toBe(0);
  });
});
