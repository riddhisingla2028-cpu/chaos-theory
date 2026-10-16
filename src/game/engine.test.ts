import { describe, expect, it } from 'vitest';
import {
  ARENA,
  CHAOS_ACTIVE,
  CHAOS_WARNING,
  COLLAPSE_INSET,
  COMBO_WINDOW,
  BOSS_RADIUS,
  ENDLESS_CONFIG,
  TELEPORT_TELL,
  VOID_TILE,
  WARMUP,
  beamHits,
  compatible,
  createGame,
  shrinkInset,
  difficulty,
  effectiveTime,
  finalScore,
  multiplier,
  spawnPattern,
  startChaos,
  step,
  type GameState,
  type Hazard,
  type Vec,
} from './engine';
import { stageConfig } from './stages';
import type { GameConfig } from './engine';

const DT = 1 / 120;
const NONE: Vec = { x: 0, y: 0 };

/** A game with hazard spawning and random events disabled so one mechanic can be tested in isolation. */
function quietGame(seed = 1): GameState {
  const g = createGame(seed);
  g.spawnTimer = Infinity;
  g.nextChaosIn = Infinity;
  g.patternTimer = Infinity;
  return g;
}

function run(g: GameState, seconds: number, input: Vec | ((g: GameState) => Vec) = NONE): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && g.status === 'playing'; i++) {
    step(g, typeof input === 'function' ? input(g) : input, DT);
  }
}

function hazard(over: Partial<Hazard>): Hazard {
  return { id: 99, kind: 'drifter', x: 0, y: 0, vx: 0, vy: 0, r: 12, age: 0, life: Infinity, grazed: false, ...over };
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
    expect(finalScore(g)).toBe(20);
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

describe('combo multiplier', () => {
  it('a near miss builds the combo and multiplier', () => {
    const g = quietGame();
    g.hazards.push(hazard({ x: g.player.x + 30, y: g.player.y })); // 8 units between hitboxes
    step(g, NONE, DT);
    expect(g.status).toBe('playing');
    expect(g.stats.nearMisses).toBe(1);
    expect(g.combo).toBe(1);
    expect(multiplier(g)).toBeCloseTo(1.1);
    expect(g.events.some((e) => e.type === 'nearMiss')).toBe(true);
  });

  it('each hazard counts as a near miss only once', () => {
    const g = quietGame();
    g.hazards.push(hazard({ x: g.player.x + 30, y: g.player.y }));
    run(g, 1);
    expect(g.stats.nearMisses).toBe(1);
  });

  it('the multiplier scales score gain', () => {
    const g = quietGame();
    g.combo = 10; // ×2.0
    g.comboTimer = 100;
    run(g, 1);
    expect(finalScore(g)).toBe(20);
  });

  it('the combo expires without new feats', () => {
    const g = quietGame();
    g.combo = 6;
    g.comboTimer = COMBO_WINDOW;
    run(g, COMBO_WINDOW + 0.1);
    expect(g.combo).toBe(0);
    expect(g.events.some((e) => e.type === 'comboLost' && e.combo === 6)).toBe(true);
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
    g.hazards.push(hazard({ x: g.player.x + 5, y: g.player.y }));
    step(g, NONE, DT);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('drifter');
    expect(g.events.some((e) => e.type === 'death')).toBe(true);
  });

  it('counts hazards that leave the arena as dodged', () => {
    const g = quietGame();
    g.hazards.push(hazard({ id: 1, x: 50, y: 50, vx: -2000, r: 10 }));
    run(g, 0.2);
    expect(g.hazards).toHaveLength(0);
    expect(g.stats.hazardsDodged).toBe(1);
  });
});

describe('chaos scheduling', () => {
  it('schedules an event with a warning before it activates', () => {
    const g = createGame(3);
    g.spawnTimer = Infinity;
    startOffCentre(g);
    run(g, 10.05, circle);
    expect(g.chaos?.phase).toBe('warning');
    run(g, CHAOS_WARNING, circle);
    expect(g.chaos?.phase).toBe('active');
  });

  it('surviving an event counts, records the type, and adds 5 to the combo', () => {
    const g = quietGame();
    startChaos(g, 'INVERSION', 'active');
    run(g, CHAOS_ACTIVE + 0.1);
    expect(g.chaos).toBeNull();
    expect(g.stats.eventsSurvived).toBe(1);
    expect(g.stats.chaosSurvived).toEqual(['INVERSION']);
    expect(g.combo).toBe(5);
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

  it('Endless introduces events one at a time, starting with the easiest (Gravity Shift)', () => {
    const original = ['INVERSION', 'COLLAPSE', 'AFTERIMAGE', 'GRAVITY'];
    const late = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const early = quietGame(seed);
      early.time = 10;
      early.nextChaosIn = 0;
      step(early, NONE, DT);
      expect(early.chaos?.kind).toBe('GRAVITY');

      const g = quietGame(seed);
      g.time = 100;
      g.nextChaosIn = 0;
      step(g, NONE, DT);
      late.add(g.chaos!.kind);
    }
    expect([...late].some((k) => !original.includes(k))).toBe(true);
  });
});

describe('original chaos events', () => {
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
    run(g, 1.5);
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

describe('new chaos events', () => {
  it('SURGE speeds up hazards and the player', () => {
    const normal = quietGame();
    normal.hazards.push(hazard({ x: 100, y: 100, vx: 100 }));
    run(normal, 0.5, { x: 1, y: 0 });

    const surge = quietGame();
    startChaos(surge, 'SURGE', 'active');
    surge.chaos!.clock = 2; // past the adaptation beat
    surge.hazards.push(hazard({ x: 100, y: 100, vx: 100 }));
    run(surge, 0.5, { x: 1, y: 0 });

    expect(surge.hazards[0].x - 100).toBeCloseTo((normal.hazards[0].x - 100) * 1.7, 1);
    expect(surge.player.x).toBeGreaterThan(normal.player.x + 40);
  });

  function scanlineGame(offset: number): GameState {
    const g = quietGame(5);
    startChaos(g, 'SCANLINE', 'active');
    step(g, NONE, DT); // launches the first beam
    const sw = g.sweeps[0];
    const across = sw.gap + offset;
    if (sw.axis === 'x') g.player.y = across;
    else g.player.x = across;
    return g;
  }

  it('SCANLINE launches a sweeping beam', () => {
    const g = scanlineGame(0);
    expect(g.sweeps).toHaveLength(1);
  });

  it('SCANLINE spares a player inside the gap and rewards threading it', () => {
    const g = scanlineGame(0);
    run(g, 2.2);
    expect(g.status).toBe('playing');
    expect(g.events.some((e) => e.type === 'gapPass')).toBe(true);
    expect(g.combo).toBeGreaterThanOrEqual(2);
  });

  it('SCANLINE kills a player outside the gap', () => {
    const probe = scanlineGame(0);
    const offset = probe.sweeps[0].gap > ARENA / 2 ? -300 : 300;
    const g = scanlineGame(offset);
    run(g, 2.2);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('scanline');
  });

  it('PHANTOM changes nothing about collisions (the player is only hidden)', () => {
    const g = quietGame();
    startChaos(g, 'PHANTOM', 'active');
    g.hazards.push(hazard({ x: g.player.x + 5, y: g.player.y }));
    step(g, NONE, DT);
    expect(g.status).toBe('over');
  });

  it('EVENT HORIZON kills a player outside the safe circle', () => {
    const g = quietGame();
    g.player.x = 40;
    g.player.y = 40;
    startChaos(g, 'HORIZON', 'active');
    step(g, NONE, DT);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('horizon');
  });

  it('EVENT HORIZON shrinks but spares a player who stays inside', () => {
    const g = quietGame();
    startChaos(g, 'HORIZON', 'active');
    const startR = g.chaos!.zone!.r;
    run(g, 2, (s) => {
      const z = s.chaos?.zone;
      if (!z) return NONE;
      const dx = z.x - s.player.x;
      const dy = z.y - s.player.y;
      const d = Math.hypot(dx, dy);
      return d > 5 ? { x: dx / d, y: dy / d } : NONE;
    });
    expect(g.status).toBe('playing');
    expect(g.chaos!.zone!.r).toBeLessThan(startR);
  });

  it('GLITCH makes hazards change direction', () => {
    const g = quietGame();
    startChaos(g, 'GLITCH', 'active');
    g.hazards.push(hazard({ x: 100, y: 100, vx: 50 }));
    run(g, 0.75);
    const h = g.hazards[0];
    expect(Math.abs(h.vy)).toBeGreaterThan(1);
    expect(Math.hypot(h.vx, h.vy)).toBeCloseTo(50, 5);
  });
});

describe('stages', () => {
  it('Stage 1 has no chaos events', () => {
    const g = createGame(1, stageConfig(0));
    g.spawnTimer = Infinity;
    run(g, 15);
    expect(g.chaos).toBeNull();
    expect(g.events.some((e) => e.type === 'chaosWarning')).toBe(false);
  });

  it('Reverse Control flips the controls soon after its short warm-up', () => {
    const g = createGame(1, stageConfig(3));
    g.spawnTimer = Infinity;
    startOffCentre(g);
    run(g, 1.55, circle);
    expect(g.chaos?.kind).toBe('INVERSION');
  });

  it('surviving the goal time wins the stage', () => {
    const g = createGame(1, stageConfig(0));
    g.spawnTimer = Infinity;
    run(g, 21);
    expect(g.status).toBe('won');
    expect(g.events.some((e) => e.type === 'victory')).toBe(true);
  });

  it('later stages start harder', () => {
    const early = createGame(1, stageConfig(0));
    const late = createGame(1, stageConfig(9));
    expect(late.config.difficultyOffset).toBeGreaterThan(early.config.difficultyOffset);
  });
});

describe('warm-up and pacing', () => {
  it('no chaos event starts during the warm-up, in any mode or stage', () => {
    const configs = [undefined, ...Array.from({ length: 10 }, (_, i) => stageConfig(i))];
    for (const cfg of configs) {
      const g = createGame(3, cfg);
      g.spawnTimer = Infinity;
      g.patternTimer = Infinity;
      startOffCentre(g);
      run(g, g.config.warmup, circle);
      expect(g.chaos).toBeNull();
      expect(g.events.some((e) => e.type === 'chaosWarning')).toBe(false);
    }
  });

  it('warm-up hazards are slow and sparse, then pick up', () => {
    const g = createGame(7);
    g.nextChaosIn = Infinity;
    g.patternTimer = Infinity;
    startOffCentre(g);
    run(g, WARMUP - 0.1, circle);
    const warmSpawns = g.nextId - 1;
    const warmMaxSpeed = Math.max(...g.hazards.map((h) => Math.hypot(h.vx, h.vy)));
    expect(warmSpawns).toBeLessThanOrEqual(4);
    expect(warmMaxSpeed).toBeLessThan(150); // full-speed drifters move at 170–260

    const late = quietGame(7);
    late.time = WARMUP + 15;
    late.spawnTimer = 0;
    for (let i = 0; i < 40; i++) step(late, NONE, 0.001);
    const lateSpeed = Math.hypot(late.hazards[0].vx, late.hazards[0].vy);
    expect(lateSpeed).toBeGreaterThan(165);
  });

  it('the difficulty clock is frozen during the warm-up and eases in a stage head start', () => {
    const g = createGame(1, stageConfig(9));
    const { warmup, ramp, difficultyRate: rate, difficultyOffset: offset } = g.config;
    expect(effectiveTime(g)).toBe(0);
    g.time = warmup;
    expect(effectiveTime(g)).toBe(0);
    g.time = warmup + ramp / 2;
    expect(effectiveTime(g)).toBeCloseTo((ramp / 2) * rate + offset * 0.5);
    g.time = warmup + ramp;
    expect(effectiveTime(g)).toBeCloseTo(ramp * rate + offset);
  });

  it('marks the end of the warm-up and pays an early milestone bonus at 10s', () => {
    const g = quietGame();
    run(g, 10.1);
    expect(g.events.some((e) => e.type === 'warmupEnd')).toBe(true);
    expect(g.events).toContainEqual({ type: 'milestone', seconds: 10, bonus: 25 });
    expect(finalScore(g)).toBeGreaterThanOrEqual(125);
    expect(g.combo).toBe(2);
  });
});

describe('fairness when rules change', () => {
  it('hazards slow to half speed as an event activates, then recover', () => {
    const g = quietGame();
    startChaos(g, 'INVERSION', 'active');
    g.hazards.push(hazard({ x: 100, y: 100, vx: 120 }));
    step(g, NONE, DT);
    const early = g.hazards[0].x - 100;
    expect(early).toBeCloseTo(120 * DT * 0.5, 1);
    run(g, 1.2);
    const before = g.hazards[0].x;
    step(g, NONE, DT);
    expect(g.hazards[0].x - before).toBeCloseTo(120 * DT, 3);
  });

  it('AFTERIMAGE cannot kill during its first second', () => {
    const g = quietGame();
    startChaos(g, 'AFTERIMAGE', 'active');
    run(g, 0.95);
    expect(g.status).toBe('playing');
  });
});

describe('hazard formations', () => {
  it('a wall is a line moving the same way, with a gap', () => {
    const g = quietGame(4);
    spawnPattern(g, 'wall');
    expect(g.hazards).toHaveLength(6);
    const dirs = new Set(g.hazards.map((h) => `${Math.sign(h.vx)},${Math.sign(h.vy)}`));
    expect(dirs.size).toBe(1);
  });

  it('rain is six small parallel hazards', () => {
    const g = quietGame(4);
    spawnPattern(g, 'rain');
    expect(g.hazards).toHaveLength(6);
    expect(g.hazards.every((h) => h.r === 8)).toBe(true);
  });

  it('a pincer closes in on the player from all four sides', () => {
    const g = quietGame(4);
    spawnPattern(g, 'pincer');
    expect(g.hazards).toHaveLength(4);
    for (const h of g.hazards) {
      const towards = (g.player.x - h.x) * h.vx + (g.player.y - h.y) * h.vy;
      expect(towards).toBeGreaterThan(0);
    }
  });

  it('formations appear once their time comes, never during the warm-up', () => {
    const g = createGame(2, { ...ENDLESS_CONFIG, patterns: [{ kind: 'wall', from: 0 }], patternFirst: WARMUP + 2 });
    g.spawnTimer = Infinity;
    g.nextChaosIn = Infinity;
    startOffCentre(g);
    run(g, WARMUP, circle);
    expect(g.events.some((e) => e.type === 'pattern')).toBe(false);
    run(g, 3, circle);
    expect(g.events.some((e) => e.type === 'pattern' && e.kind === 'wall')).toBe(true);
  });

  it('Endless holds formations back until 25s', () => {
    const g = createGame(2);
    g.spawnTimer = Infinity;
    g.nextChaosIn = Infinity;
    startOffCentre(g);
    run(g, 24, circle);
    expect(g.events.some((e) => e.type === 'pattern')).toBe(false);
  });
});

/** A quiet game built from a level config: no random hazards, no random chaos. */
function quietLevel(index: number, over: Partial<GameConfig> = {}): GameState {
  const g = createGame(5, { ...stageConfig(index), ...over });
  g.spawnTimer = Infinity;
  g.nextChaosIn = Infinity;
  g.patternTimer = Infinity;
  return g;
}

describe('orbs and objectives', () => {
  it('spawns an orb away from the player and collecting it scores and counts', () => {
    const g = quietLevel(2);
    run(g, 1.2);
    expect(g.orbs).toHaveLength(1);
    const o = g.orbs[0];
    expect(Math.hypot(o.x - g.player.x, o.y - g.player.y)).toBeGreaterThanOrEqual(200);
    const before = g.score;
    g.player.x = o.x;
    g.player.y = o.y;
    step(g, NONE, DT);
    expect(g.stats.orbs).toBe(1);
    expect(g.score - before).toBeGreaterThan(40);
    expect(g.events.some((e) => e.type === 'orb' && e.collected === 1 && e.target === 3)).toBe(true);
  });

  it('collecting the target number of orbs wins the level', () => {
    const g = quietLevel(2);
    for (let i = 0; i < 200 && g.status === 'playing'; i++) {
      run(g, 0.4);
      const o = g.orbs[0];
      if (o) {
        g.player.x = o.x;
        g.player.y = o.y;
      }
    }
    expect(g.status).toBe('won');
    expect(g.stats.orbs).toBe(3);
  });

  it('a time-limited orb objective fails when time runs out', () => {
    const g = quietLevel(8);
    run(g, 15.1);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('timeout');
  });

  it('Chaos Combo keeps two orbs on the field', () => {
    const g = quietLevel(8);
    run(g, 2);
    expect(g.orbs).toHaveLength(2);
  });
});

describe('level mechanics', () => {
  it('vanishing tiles warn first and only kill once active', () => {
    const g = quietLevel(4);
    g.voids = [{ ix: 1, iy: 1, phase: 'warning', timer: 1 }];
    g.player.x = VOID_TILE * 1.5;
    g.player.y = VOID_TILE * 1.5;
    step(g, NONE, DT);
    expect(g.status).toBe('playing');
    run(g, 1.1);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('void');
  });

  it('the Vanishing Zone keeps creating vanishing tiles', () => {
    const g = quietLevel(4);
    startOffCentre(g);
    run(g, 3, circle);
    expect(g.events.filter((e) => e.type === 'voidWarn').length).toBeGreaterThanOrEqual(1);
  });

  it('the Shrinking Arena closes in steadily and kills a player at the edge', () => {
    const g = quietLevel(7);
    expect(shrinkInset(g)).toBe(0);
    run(g, 6);
    expect(g.status).toBe('playing');
    expect(g.inset).toBeGreaterThan(100);
    g.player.x = 40;
    step(g, NONE, DT);
    expect(g.status).toBe('over');
    expect(g.cause).toBe('collapse');
  });

  it('Double Chaos runs two rules at the same time', () => {
    const g = quietLevel(5);
    startChaos(g, 'GRAVITY', 'active', 'INVERSION');
    g.chaos!.gravity = { x: 0, y: 1 };
    g.chaos!.clock = 2;
    run(g, 0.5, { x: 1, y: 0 });
    expect(g.player.x).toBeLessThan(ARENA / 2 - 50); // inverted
    expect(g.player.y).toBeGreaterThan(ARENA / 2 + 50); // pulled down
  });

  it('random combos never pair incompatible rules', () => {
    expect(compatible('COLLAPSE', 'HORIZON')).toBe(false);
    expect(compatible('INVERSION', 'INVERSION')).toBe(false);
    expect(compatible('GRAVITY', 'INVERSION')).toBe(true);
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame(seed, stageConfig(8));
      g.nextChaosIn = 0;
      g.spawnTimer = Infinity;
      step(g, NONE, DT);
      const c = g.chaos!;
      if (c.partner) expect(compatible(c.kind, c.partner)).toBe(true);
    }
  });

  it('Glitch Attack teleports hazards with a warning ghost, intangible mid-jump', () => {
    const g = quietLevel(6);
    startChaos(g, 'GLITCH', 'active');
    for (let i = 0; i < 12; i++) g.hazards.push(hazard({ id: 100 + i, x: 100 + i * 60, y: 900, vx: 30 }));
    run(g, 0.72);
    const blinking = g.hazards.filter((h) => h.blink);
    expect(blinking.length).toBeGreaterThan(0);
    const h = blinking[0];
    const target = { ...h.blink! };
    // Standing on the ghost while it is still half a tell away is safe.
    g.player.x = h.x;
    g.player.y = h.y;
    h.blink!.t = TELEPORT_TELL * 0.4;
    step(g, NONE, DT);
    expect(g.status).toBe('playing');
    run(g, TELEPORT_TELL);
    expect(g.events.some((e) => e.type === 'teleport')).toBe(true);
    expect(g.hazards.some((x) => Math.abs(x.x - target.x) < 40 && Math.abs(x.y - target.y) < 40)).toBe(true);
  });
});

describe('Final Showdown boss', () => {
  it('starts with the player away from the Core', () => {
    const g = quietLevel(9);
    const b = g.boss!;
    expect(Math.hypot(g.player.x - b.x, g.player.y - b.y)).toBeGreaterThan(BOSS_RADIUS + 150);
  });

  it('touching the Core kills', () => {
    const g = quietLevel(9);
    g.player.x = ARENA / 2;
    g.player.y = ARENA / 2 + BOSS_RADIUS;
    step(g, NONE, DT);
    expect(g.cause).toBe('boss');
  });

  it('attacks only after the warm-up, telegraphing first', () => {
    const g = quietLevel(9);
    run(g, g.config.warmup - 0.1);
    expect(g.events.some((e) => e.type === 'bossTell')).toBe(false);
    run(g, 1.5);
    expect(g.events.some((e) => e.type === 'bossTell')).toBe(true);
  });

  it('a burst always leaves a gap', () => {
    const g = quietLevel(9);
    g.time = g.config.warmup + 1; // the Core is idle during the warm-up
    g.boss!.attack = { kind: 'burst', phase: 'tell', timer: 0.001, angle: 0, spin: 1 };
    g.player.y = 950;
    step(g, NONE, DT);
    const n = g.hazards.length;
    expect(n).toBeGreaterThan(8);
    expect(n).toBeLessThan(14); // 14 slots minus a 3-slot gap
  });

  it('the beam kills whatever it sweeps over', () => {
    const g = quietLevel(9);
    const b = g.boss!;
    b.attack = { kind: 'beam', phase: 'fire', timer: 3, angle: Math.PI / 2, spin: 1 };
    expect(beamHits(b, b.x, b.y + 300, 10)).toBe(true);
    expect(beamHits(b, b.x + 300, b.y, 10)).toBe(false);
  });

  it('each orb damages the Core, and breaking it wins', () => {
    const g = quietLevel(9);
    g.boss!.cooldown = Infinity;
    for (let i = 0; i < 300 && g.status === 'playing'; i++) {
      run(g, 0.4);
      const o = g.orbs[0];
      if (o) {
        g.player.x = o.x;
        g.player.y = o.y;
      }
    }
    expect(g.status).toBe('won');
    expect(g.boss!.hp).toBe(0);
    expect(g.events.filter((e) => e.type === 'bossHit')).toHaveLength(5);
    expect(g.events.some((e) => e.type === 'bossDefeated')).toBe(true);
  });
});
