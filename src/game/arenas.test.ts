import { describe, expect, it } from 'vitest';
import { ARENAS, standable, type ArenaDef } from './arenas';
import { PLAYER_HIT_RADIUS, PLAYER_SPEED } from './engine';
import { STAGES } from './stages';

const CELL = 19; // the player moves one cell per step at full speed
const DT = CELL / PLAYER_SPEED;
const N = Math.ceil(1000 / CELL);
const centre = (i: number) => i * CELL + CELL / 2;

function standableCells(a: ArenaDef, t: number): Uint8Array {
  const out = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out[j * N + i] = standable(a, t, centre(i), centre(j), PLAYER_HIT_RADIUS) ? 1 : 0;
  return out;
}

/**
 * Plays the arena forward ignoring hazards: each step the player may move one cell or stay put,
 * but only onto ground that exists. Returns the first time the player would have nowhere left
 * to stand, or null if some route survives the whole window. Also counts every cell ever reached.
 */
function survivable(a: ArenaDef, seconds: number): { strandedAt: number | null; everReached: Uint8Array } {
  let reach = new Uint8Array(N * N);
  const everReached = new Uint8Array(N * N);
  const si = Math.floor(a.spawn.x / CELL);
  const sj = Math.floor(a.spawn.y / CELL);
  reach[sj * N + si] = 1;
  for (let t = 0; t <= seconds; t += DT) {
    const next = new Uint8Array(N * N);
    let any = false;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let from = false;
        for (let dj = -1; dj <= 1 && !from; dj++)
          for (let di = -1; di <= 1 && !from; di++) {
            const x = i + di;
            const y = j + dj;
            if (x >= 0 && y >= 0 && x < N && y < N && reach[y * N + x]) from = true;
          }
        if (from && standable(a, t, centre(i), centre(j), PLAYER_HIT_RADIUS)) {
          next[j * N + i] = 1;
          everReached[j * N + i] = 1;
          any = true;
        }
      }
    if (!any) return { strandedAt: t, everReached };
    reach = next;
  }
  return { strandedAt: null, everReached };
}

const ALL = Object.values(ARENAS);

describe('arena geometry', () => {
  it('there are ten different campaign arenas, one per level', () => {
    const ids = STAGES.map((s) => s.arena.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('every arena spawns the player on safe ground, clear of walls', () => {
    for (const a of ALL) expect(standable(a, 0, a.spawn.x, a.spawn.y, PLAYER_HIT_RADIUS, 2), a.id).toBe(true);
  });

  it('there is always enough room to stand (at least the area of a 150 x 150 square)', () => {
    for (const a of ALL)
      for (let t = 0; t <= 60; t += 0.5) {
        const room = standableCells(a, t).reduce((n, c) => n + c, 0) * CELL * CELL;
        expect(room, `${a.id} at ${t}s`).toBeGreaterThan(150 * 150);
      }
  });

  it('a player who keeps moving can never be stranded by the floor or walls (60s, hazards ignored)', () => {
    for (const a of ALL) expect(survivable(a, 60).strandedAt, a.id).toBeNull();
  }, 120_000);

  it('every island in the Void can be reached', () => {
    const { everReached } = survivable(ARENAS.void, 30);
    for (const [x, y] of [[170, 170], [830, 170], [170, 830], [830, 830], [500, 500]]) {
      expect(everReached[Math.floor(y / CELL) * N + Math.floor(x / CELL)], `${x},${y}`).toBe(1);
    }
  });

  it('every Void island always has at least one bridge to the centre', () => {
    // Route A runs down the side, route B across the top or bottom; they alternate.
    for (let t = 0; t < 14; t += 0.1) {
      const solid = (x: number, y: number) => standable(ARENAS.void, t, x, y, PLAYER_HIT_RADIUS);
      for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]]) {
        const m = (x: number, y: number): [number, number] => [fx ? 1000 - x : x, fy ? 1000 - y : y];
        const a = solid(...m(180, 440)) && solid(...m(180, 330));
        const b = solid(...m(440, 180)) && solid(...m(330, 180));
        expect(a || b, `corner ${fx},${fy} at ${t.toFixed(1)}s`).toBe(true);
      }
    }
  });
});
