import { describe, expect, it } from 'vitest';
import {
  ARENA,
  CHAOS_ACTIVE,
  CHAOS_WARNING,
  COLLAPSE_INSET,
  createGame,
  difficulty,
  scoreFor,
  startChaos,
  step,
  type GameState,
  type Vec,
} from './engine';

const DT = 1 / 120;
const NONE: Vec = { x: 0, y: 0 };

/** A game with hazard spawning disabled so a single mechanic can be tested in isolation. */
function quietGame(seed = 1): GameState {
  const g = createGame(seed);
  g.spawnTimer = Infinity;
  g.nextChaosIn = Infinity;
  return g;
}

function run(g: GameState, seconds: number, input: Vec | ((g: GameState) => Vec) = NONE): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && g.status === 'playing'; i++) {
    step(g, typeof input === 'function' ? input(g) : input, DT);
  }
}

/**
 * Steers in a wide circle around the arena centre, so the player never re-crosses recent trail.
 * Call startOffCentre first: at the exact centre the tangent is undefined.
 */
function startOffCentre(g: GameState): void {
  g.player.x = ARENA / 2 + 200;
}

const circle = (g: GameState): Vec => {
  const dx = g.player.x - ARENA / 2;
  const dy = g.player.y - ARENA / 2;
  return { x: -dy / (Math.hypot(dx, dy) || 1), y: dx / (Math.hypot(dx, dy) || 1) };
};

describe('scoring and difficulty', () => {
  it('score is based on survival time', () => {
    const g = quietGame();
    run(g, 2);
    expect(g.status).toBe('playing');
    expect(g.time).toBeCloseTo(2, 1);
    expect(scoreFor(g.time)).toBe(20);
  });

  it('difficulty increases over time', () => {
    const early = difficulty(0);
    const late = difficulty(60);
    expect(late.level).toBeGreaterThan(early.level);
    expect(late.speedMul).toBeGreaterThan(early.speedMul);
    expect(late.spawnInterval).toBeLessThan(early.spawnInterval);
    expect(late.seekerChance).toBeGreaterThan(early.seekerChance);
  });

  it('hazards spawn during normal play', () => {
    const g = createGame(7);
    g.nextChaosIn = Infinity;
    startOffCentre(g);
    run(g, 3, circle);
    expect(g.hazards.length + g.stats.hazardsDodged).toBeGreaterThan(0);
  });
});

describe('movement', () => {
  it('moves the player in the input direction', () => {
    const g = quietGame();
    run(g, 0.5, { x: 1, y: 0 });
    expect(g.player.x).toBeGreaterThan(ARENA / 2 + 100);
    expect(g.player.y).toBeCloseTo(ARENA / 2, 5);
  });

  it('keeps the player inside the arena walls', () => {
    const g = quietGame();
    run(g, 5, { x: -1, y: -1 });
    expect(g.player.x).toBeGreaterThan(0);
    expect(g.player.y).toBeGreaterThan(0);
    expect(g.status).toBe('playing');
  });
});

describe('collisions', () => {
  it('ends the game when a hazard hits the player', () => {
    const g = quietGame();
    g.hazards.push({ id: 99, kind: 'drifter', x: g.player.x + 5, y: g.player.y, vx: 0, vy: 0, r: 12, age: 0, life: Infinity });
    step(g, NONE, DT);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('drifter');
  });

  it('counts hazards that leave the arena as dodged', () => {
    const g = quietGame();
    g.hazards.push({ id: 1, kind: 'drifter', x: 50, y: 50, vx: -2000, vy: 0, r: 10, age: 0, life: Infinity });
    run(g, 0.2);
    expect(g.hazards).toHaveLength(0);
    expect(g.stats.hazardsDodged).toBe(1);
  });
});

describe('chaos events', () => {
  it('schedules an event with a warning before it activates', () => {
    const g = createGame(3);
    g.spawnTimer = Infinity;
    startOffCentre(g);
    run(g, 6.05, circle);
    expect(g.chaos?.phase).toBe('warning');
    run(g, CHAOS_WARNING, circle);
    expect(g.chaos?.phase).toBe('active');
  });

  it('counts an event as survived once it ends', () => {
    const g = quietGame();
    startChaos(g, 'INVERSION', 'active');
    run(g, CHAOS_ACTIVE + 0.1);
    expect(g.chaos).toBeNull();
    expect(g.stats.eventsSurvived).toBe(1);
  });

  it('never repeats the same event twice in a row', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = quietGame(seed);
      g.lastChaos = 'COLLAPSE';
      g.nextChaosIn = 0;
      step(g, NONE, DT);
      expect(g.chaos?.kind).not.toBe('COLLAPSE');
    }
  });

  it('INVERSION reverses movement controls', () => {
    const g = quietGame();
    startChaos(g, 'INVERSION', 'active');
    run(g, 0.5, { x: 1, y: 0 });
    expect(g.player.x).toBeLessThan(ARENA / 2 - 100);
  });

  it('COLLAPSE shrinks the arena and kills a player at the edge', () => {
    const g = quietGame();
    g.player.x = 60;
    startChaos(g, 'COLLAPSE', 'active');
    run(g, 2);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('collapse');
  });

  it('COLLAPSE spares a player in the centre, then the arena reopens', () => {
    const g = quietGame();
    startChaos(g, 'COLLAPSE', 'active');
    run(g, 2);
    expect(g.inset).toBeCloseTo(COLLAPSE_INSET, 5);
    expect(g.status).toBe('playing');
    run(g, CHAOS_ACTIVE);
    expect(g.inset).toBe(0);
  });

  it('AFTERIMAGE makes the trail lethal for a player who stops moving', () => {
    const g = quietGame();
    startChaos(g, 'AFTERIMAGE', 'active');
    run(g, 1.5);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('afterimage');
  });

  it('AFTERIMAGE spares a player who keeps moving', () => {
    const g = quietGame();
    startOffCentre(g);
    startChaos(g, 'AFTERIMAGE', 'active');
    run(g, CHAOS_ACTIVE - 0.1, circle);
    expect(g.status).toBe('playing');
  });

  it('AFTERIMAGE ignores trail laid down before the event began', () => {
    const g = quietGame();
    run(g, 1.5); // stand still, leaving trail under the player
    startChaos(g, 'AFTERIMAGE', 'active');
    run(g, 0.2);
    expect(g.status).toBe('playing');
  });

  it('GRAVITY SHIFT pushes the player without input', () => {
    const g = quietGame();
    startChaos(g, 'GRAVITY', 'active');
    g.chaos!.gravity = { x: 1, y: 0 };
    run(g, 0.5);
    expect(g.player.x).toBeGreaterThan(ARENA / 2 + 80);
  });

  it('GRAVITY SHIFT can be resisted by pushing against it', () => {
    const g = quietGame();
    startChaos(g, 'GRAVITY', 'active');
    g.chaos!.gravity = { x: 1, y: 0 };
    run(g, 0.5, { x: -1, y: 0 });
    expect(g.player.x).toBeLessThan(ARENA / 2);
  });
});
