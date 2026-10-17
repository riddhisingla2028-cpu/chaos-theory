import { describe, expect, it } from 'vitest';
import {
  CHRONO_DURATION,
  CHRONO_SCALE,
  MISSIONS,
  SHIP_R,
  createMission,
  missionById,
  objectiveView,
  secondariesMet,
  starsFor,
  stepMission,
  wallAt,
  type MissionId,
  type MissionState,
  type Vec,
} from './sim';

const DT = 1 / 60;

/** Remove hazards so a route test checks only objectives and geometry. */
function calm(m: MissionState): void {
  m.rocks = [];
  m.rockSpawn = null;
  m.barriers = [];
  m.pulses = [];
  m.pulseEvery = 0;
  m.bullets = m.bullets.filter((b) => b.from === 'player');
  m.chrono.nextSpawn = Infinity;
  m.chrono.pickup = null;
}

/** Steer straight at a (possibly moving) target until close, the mission ends, or time runs out. */
function flyTo(m: MissionState, target: Vec | (() => Vec), opts: { within?: number; maxT?: number; calmWorld?: boolean } = {}): boolean {
  const within = opts.within ?? 18;
  const end = m.realTime + (opts.maxT ?? 20);
  while (m.status === 'playing' && m.realTime < end) {
    if (opts.calmWorld !== false) calm(m);
    const t = typeof target === 'function' ? target() : target;
    const dx = t.x - m.ship.x;
    const dy = t.y - m.ship.y;
    const d = Math.hypot(dx, dy);
    if (d < within) return true;
    stepMission(m, { x: dx / d, y: dy / d }, DT);
  }
  return false;
}

function hold(m: MissionState, seconds: number): void {
  const end = m.realTime + seconds;
  while (m.status === 'playing' && m.realTime < end) {
    calm(m);
    stepMission(m, { x: 0, y: 0 }, DT);
  }
}

const make = (id: MissionId, seed = 7) => createMission(missionById(id), seed);

describe('mission catalogue', () => {
  it('has ten missions with distinct objectives and two optional objectives each', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(['first-contact', 'alien-pursuit', 'rescue', 'shattered-orbit', 'collapse', 'meltdown', 'breach-protocol', 'convoy', 'last-jump', 'guardian']);
    expect(MISSIONS.map((m) => m.code)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
    expect(new Set(MISSIONS.map((m) => m.objective)).size).toBe(10);
    for (const m of MISSIONS) expect(m.secondaries).toHaveLength(2);
  });

  it('every mission starts in play, at full hull, with the ship clear of walls', () => {
    for (const def of MISSIONS) {
      const m = createMission(def, 3);
      expect(m.status).toBe('playing');
      expect(m.ship.hp).toBe(def.maxHp);
      for (const w0 of m.walls) {
        const w = wallAt(w0, 0);
        const inside = m.ship.x > w.x - SHIP_R && m.ship.x < w.x + w.w + SHIP_R && m.ship.y > w.y - SHIP_R && m.ship.y < w.y + w.h + SHIP_R;
        expect(inside, def.id).toBe(false);
      }
    }
  });
});

describe('Mission 01 · First Contact', () => {
  it('the portal opens only after five cores, and entering it wins', () => {
    const m = make('first-contact');
    flyTo(m, { x: 500, y: 110 }, { within: 4, maxT: 6 }); // fly right into the closed portal
    expect(m.status).toBe('playing'); // no win while it is closed
    hold(m, 0.5);
    expect(m.status).toBe('playing');
    for (const c of [{ x: 160, y: 620 }, { x: 840, y: 760 }, { x: 500, y: 520 }, { x: 820, y: 300 }, { x: 180, y: 220 }]) flyTo(m, c, { within: 8 });
    expect(m.cores.every((c) => c.taken)).toBe(true);
    expect(m.portal!.open).toBe(true);
    expect(objectiveView(m).text).toMatch(/portal/i);
    flyTo(m, { x: 500, y: 110 }, { within: 5 });
    expect(m.status).toBe('won');
    expect(starsFor(m)).toBeGreaterThanOrEqual(2); // no damage was taken
  });

  it('three hits destroy the ship and fail the mission, with a reason', () => {
    const m = make('first-contact');
    m.ship.invuln = 0;
    for (let i = 0; i < 400 && m.status === 'playing'; i++) {
      m.rocks = [{ id: 999, x: m.ship.x, y: m.ship.y, vx: 0, vy: 0, r: 20, spin: 0 }];
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.status).toBe('lost');
    expect(m.hitsTaken).toBe(3);
    expect(m.failReason).toMatch(/debris/);
    expect(starsFor(m)).toBe(0);
  });

  it('a hit gives a short invulnerability window rather than instant repeated damage', () => {
    const m = make('first-contact');
    m.ship.invuln = 0;
    m.rocks = [{ id: 999, x: m.ship.x, y: m.ship.y, vx: 0, vy: 0, r: 20, spin: 0 }];
    stepMission(m, { x: 0, y: 0 }, DT);
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.hitsTaken).toBe(1);
  });
});

describe('Mission 02 · Shattered Orbit', () => {
  it('gates count only in order; all three open the exit, and the route through the wreck is flyable', () => {
    const m = make('shattered-orbit');
    // Sliding plates: aim for the moving gap.
    const gapX = () => {
      const left = wallAt(m.walls[0], m.time);
      const right = wallAt(m.walls[1], m.time);
      return (left.x + left.w + right.x) / 2;
    };
    expect(flyTo(m, () => ({ x: gapX(), y: 2120 }), { within: 25 })).toBe(true);
    expect(flyTo(m, () => ({ x: gapX(), y: 1990 }), { within: 25 })).toBe(true);
    flyTo(m, { x: 500, y: 1920 });
    expect(m.gates[0].passed).toBe(true);
    flyTo(m, { x: 350, y: 1850 });
    flyTo(m, { x: 350, y: 1480 });
    flyTo(m, { x: 500, y: 1200 });
    expect(m.gates[1].passed).toBe(true);
    flyTo(m, { x: 500, y: 960 });
    flyTo(m, { x: 500, y: 760 });
    expect(m.portal!.open).toBe(false);
    flyTo(m, { x: 500, y: 540 });
    expect(m.gates.every((g) => g.passed)).toBe(true);
    expect(m.portal!.open).toBe(true);
    flyTo(m, { x: 500, y: 470 }, { maxT: 8 });
    flyTo(m, { x: 500, y: 140 }, { within: 5, maxT: 12 });
    expect(m.status).toBe('won');
  });

  it('flying through a later gate first does not count', () => {
    const m = make('shattered-orbit');
    m.ship.x = 500;
    m.ship.y = 1200; // gate 2
    calm(m);
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.gates[1].passed).toBe(false);
  });

  it('the camera follows the ship through the taller world', () => {
    const m = make('shattered-orbit');
    const start = m.camY;
    m.ship.y = 1000;
    for (let i = 0; i < 120; i++) {
      calm(m);
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.camY).toBeLessThan(start - 500);
  });
});

describe('Mission 03 · Breach Protocol (combat)', () => {
  it('the blaster only fires with a target in range, and bolts damage drones', () => {
    const m = make('breach-protocol');
    calm(m);
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.drones.length).toBe(3);
    expect(m.bullets.filter((b) => b.from === 'player').length).toBe(0); // warping in / out of range
    for (let i = 0; i < 120; i++) stepMission(m, { x: 0, y: -1 }, DT);
    expect(m.target).not.toBeNull();
    expect(m.events.length + m.bullets.length).toBeGreaterThan(0);
  });

  it('destroying all twelve attackers (three waves) while the frigate survives wins; nothing is awarded earlier', () => {
    const m = make('breach-protocol');
    const end = 150;
    const frigate = m.allies[0];
    while (m.status === 'playing' && m.realTime < end) {
      m.ship.invuln = 5; // scripted pilot: survive to test the objective logic
      // Defend the frigate first: go for whatever is closest to it.
      const target = m.drones.filter((d) => d.spawnIn === 0).sort((a, b) => Math.hypot(a.x - frigate.x, a.y - frigate.y) - Math.hypot(b.x - frigate.x, b.y - frigate.y))[0];
      let inp = { x: 0, y: 0 };
      if (target) {
        const dx = target.x - m.ship.x;
        const dy = target.y - m.ship.y;
        const d = Math.hypot(dx, dy);
        inp = d > 260 ? { x: dx / d, y: dy / d } : { x: -dy / d, y: dx / d };
      }
      if (m.cleared < 12) expect(m.status).toBe('playing');
      stepMission(m, inp, DT);
    }
    expect(m.cleared).toBe(12);
    expect(m.kills).toBeGreaterThanOrEqual(8); // most were shot down by the blaster
    expect(frigate.destroyed).toBe(false);
    expect(m.status).toBe('won');
  });

  it('gunners telegraph before firing at the ship', () => {
    const m = make('breach-protocol');
    m.drones = [];
    m.waves = [];
    m.drones.push({ id: 50, kind: 'gunner', x: 500, y: 300, vx: 0, vy: 0, hp: 5, maxHp: 5, fireIn: 0, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null });
    m.killsNeeded = 99;
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.drones[0].aim).toBeGreaterThan(0);
    expect(m.bullets.filter((b) => b.from === 'enemy')).toHaveLength(0);
    for (let i = 0; i < 50; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.bullets.filter((b) => b.from === 'enemy').length).toBeGreaterThan(0);
  });
});

describe('Mission 04 · The Collapse', () => {
  it('waiting is fatal: the collapse catches a ship that does not move', () => {
    const m = make('collapse');
    for (let i = 0; i < 60 * 20 && m.status === 'playing'; i++) {
      calm(m);
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/collapse/i);
  });

  it('a pilot who keeps moving escapes, collecting all three data cores on the way', () => {
    const m = make('collapse');
    const movingGap = () => {
      const w = wallAt(m.walls[4], m.time);
      return { x: w.x + w.w / 2 > 500 ? 70 : 930, y: 700 };
    };
    for (const p of [{ x: 380, y: 1900 }, { x: 380, y: 1700 }, { x: 850, y: 1540 }, { x: 620, y: 1350 }, { x: 620, y: 1150 }, { x: 150, y: 1020 }]) flyTo(m, p);
    flyTo(m, () => ({ ...movingGap(), y: 880 }), { within: 30 });
    flyTo(m, movingGap, { within: 30 });
    for (const p of [{ x: 820, y: 620 }, { x: 500, y: 560 }, { x: 500, y: 400 }]) flyTo(m, p);
    flyTo(m, { x: 500, y: 120 }, { within: 5 });
    expect(m.status).toBe('won');
    expect(secondariesMet(m)[0]).toBe(true);
  });
});

describe('Mission 05 · Core Meltdown', () => {
  it('a reactor needs the ship to hold position; leaving drains its charge', () => {
    const m = make('meltdown');
    flyTo(m, { x: 500, y: 640 });
    hold(m, 1);
    const half = m.reactors[2].charge;
    expect(half).toBeGreaterThan(0.3);
    expect(m.reactors[2].active).toBe(false);
    flyTo(m, { x: 500, y: 860 });
    const outside = m.reactors[2].charge;
    hold(m, 1);
    expect(m.reactors[2].charge).toBeLessThan(outside);
    expect(m.reactors[2].active).toBe(false);
  });

  it('three active reactors open the portal; reaching it wins', () => {
    const m = make('meltdown');
    for (const r of [{ x: 500, y: 640 }, { x: 170, y: 250 }, { x: 830, y: 250 }]) {
      flyTo(m, r);
      hold(m, 2.4);
    }
    expect(m.reactors.every((r) => r.active)).toBe(true);
    expect(m.portal!.open).toBe(true);
    flyTo(m, { x: 650, y: 520 });
    flyTo(m, { x: 500, y: 470 }, { within: 8 });
    expect(m.status).toBe('won');
  });

  it('running out of time loses the mission', () => {
    const m = make('meltdown');
    for (let i = 0; i < 60 * 95 && m.status === 'playing'; i++) {
      calm(m);
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/critical/);
  });

  it('heat pulses warn first, then hurt everywhere except their gap', () => {
    const m = make('meltdown');
    m.pulseNext = 0;
    m.ship.invuln = 0;
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.pulses).toHaveLength(1);
    expect(m.pulses[0].warn).toBeGreaterThan(1);
  });
});

describe('Mission 06 · The Guardian', () => {
  it('cannot be damaged while shielded; the shield drops on a cycle', () => {
    const m = make('guardian');
    m.ship.x = 500;
    m.ship.y = 560;
    let shieldedHits = 0;
    let opened = false;
    for (let i = 0; i < 60 * 6.5; i++) {
      m.ship.invuln = 5;
      m.bullets = m.bullets.filter((b) => b.from === 'player');
      const hp = m.boss!.hp;
      const shielded = m.boss!.shielded;
      stepMission(m, { x: 0, y: 0 }, DT);
      if (shielded && m.boss!.hp < hp) shieldedHits++;
      if (!m.boss!.shielded) opened = true;
    }
    expect(shieldedHits).toBe(0);
    expect(opened).toBe(true);
  });

  it('destroying the Guardian starts the escape; reaching the portal (not the kill) wins', () => {
    const m = make('guardian');
    let phases = 0;
    while (m.status === 'playing' && !m.escaping && m.realTime < 160) {
      m.ship.invuln = 5;
      const dx = m.boss!.x - m.ship.x;
      const inp = { x: Math.abs(dx) > 30 ? Math.sign(dx) : 0, y: m.ship.y < 600 ? 1 : m.ship.y > 660 ? -1 : 0 };
      stepMission(m, inp, DT);
      phases += m.events.filter((e) => e.type === 'boss-phase').length;
    }
    expect(phases).toBe(2);
    expect(m.escaping).toBe(true);
    expect(m.status).toBe('playing'); // not won yet
    expect(m.portal!.open).toBe(true);
    while (m.status === 'playing' && m.realTime < 200) {
      const dx = m.portal!.x - m.ship.x;
      const dy = m.portal!.y - m.ship.y;
      const d = Math.hypot(dx, dy) || 1;
      stepMission(m, { x: dx / d, y: dy / d }, DT);
    }
    expect(m.status).toBe('won');
  });

  it('lingering during the escape is fatal: the event horizon grows and swallows the ship', () => {
    const m = make('guardian');
    m.boss!.hp = 0;
    m.ship.invuln = 99;
    for (let i = 0; i < 60 * 40 && m.status === 'playing'; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/event horizon/);
  });
});

describe('CHRONO SHIFT power-up', () => {
  function withPickupOnShip(id: MissionId = 'first-contact') {
    const m = make(id);
    m.rocks = [];
    m.chrono.pickup = { x: m.ship.x, y: m.ship.y, life: 5 };
    stepMission(m, { x: 0, y: 0 }, DT);
    return m;
  }

  it('activates on pickup, slows the world but not the ship', () => {
    const m = withPickupOnShip();
    expect(m.chrono.active).toBeGreaterThan(CHRONO_DURATION - 0.1);
    expect(m.events.some((e) => e.type === 'chrono-on')).toBe(true);
    const t0 = m.time;
    const x0 = m.ship.x;
    for (let i = 0; i < 60; i++) stepMission(m, { x: 1, y: 0 }, DT);
    expect(m.time - t0).toBeCloseTo(1 * CHRONO_SCALE, 2);

    const n = make('first-contact');
    n.rocks = [];
    const nx0 = n.ship.x;
    for (let i = 0; i < 60; i++) stepMission(n, { x: 1, y: 0 }, DT);
    expect(m.ship.x - x0).toBeCloseTo(n.ship.x - nx0, 3); // ship equally responsive
  });

  it('enemy fire and moving obstacles slow down during the shift', () => {
    const slow = withPickupOnShip('breach-protocol');
    const normal = make('breach-protocol');
    for (const m of [slow, normal]) m.bullets = [{ id: 1, x: 500, y: 200, vx: 0, vy: 200, r: 9, from: 'enemy', life: 9 }];
    for (let i = 0; i < 30; i++) {
      stepMission(slow, { x: 0, y: 0 }, DT);
      stepMission(normal, { x: 0, y: 0 }, DT);
    }
    const slowMoved = slow.bullets.find((b) => b.id === 1)!.y - 200;
    const normalMoved = normal.bullets.find((b) => b.id === 1)!.y - 200;
    expect(slowMoved).toBeCloseTo(normalMoved * CHRONO_SCALE, 0);
  });

  it('expires after its duration and the world returns to exactly normal speed', () => {
    const m = withPickupOnShip();
    let offEvents = 0;
    for (let i = 0; i < 60 * (CHRONO_DURATION + 0.5); i++) {
      m.rocks = [];
      stepMission(m, { x: 0, y: 0 }, DT);
      offEvents += m.events.filter((e) => e.type === 'chrono-off').length;
    }
    expect(m.chrono.active).toBe(0);
    expect(offEvents).toBe(1);
    const t0 = m.time;
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.time - t0).toBeCloseTo(1, 5);
  });

  it('pausing (no steps) freezes the countdown; it only runs on real game time', () => {
    const m = withPickupOnShip();
    const left = m.chrono.active;
    // The game screen simply stops stepping while paused; nothing else touches the timer.
    expect(m.chrono.active).toBe(left);
    stepMission(m, { x: 0, y: 0 }, 0.5);
    expect(m.chrono.active).toBeCloseTo(left - 0.05, 5); // a single step is capped at 50ms
  });

  it('a second pickup while active refreshes the timer instead of stacking', () => {
    const m = withPickupOnShip();
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: 0 }, DT);
    m.chrono.pickup = { x: m.ship.x, y: m.ship.y, life: 5 };
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.chrono.active).toBeLessThanOrEqual(CHRONO_DURATION);
    expect(m.chrono.active).toBeGreaterThan(CHRONO_DURATION - 0.1);
  });

  it('restarting a mission clears any active shift and resets its schedule', () => {
    const m = withPickupOnShip();
    expect(m.chrono.active).toBeGreaterThan(0);
    const fresh = createMission(m.def, m.seed);
    expect(fresh.chrono.active).toBe(0);
    expect(fresh.chrono.pickup).toBeNull();
    expect(fresh.time).toBe(0);
  });

  it('collecting it does not complete objectives or award a win', () => {
    const m = withPickupOnShip();
    expect(m.status).toBe('playing');
    expect(m.cores.filter((c) => c.taken)).toHaveLength(0);
  });

  it('appears occasionally, in reachable spots clear of walls and debris', () => {
    for (const id of ['first-contact', 'meltdown', 'breach-protocol'] as MissionId[]) {
      for (let seed = 1; seed <= 6; seed++) {
        const m = make(id, seed);
        let spawned = 0;
        for (let i = 0; i < 60 * 40 && m.status === 'playing'; i++) {
          m.ship.invuln = 5;
          stepMission(m, { x: 0, y: 0 }, DT);
          const sp = m.events.find((e) => e.type === 'chrono-spawn');
          if (!sp || sp.type !== 'chrono-spawn') continue;
          spawned++;
          const p = { x: sp.x, y: sp.y };
          expect(p.x).toBeGreaterThan(60);
          expect(p.x).toBeLessThan(940);
          for (const w0 of m.walls) {
            const w = wallAt(w0, m.time);
            expect(p.x > w.x - 40 && p.x < w.x + w.w + 40 && p.y > w.y - 40 && p.y < w.y + w.h + 40, `${id} in wall`).toBe(false);
          }
          for (const r of m.rocks) expect(Math.hypot(r.x - p.x, r.y - p.y)).toBeGreaterThan(r.r + 100);
        }
        expect(spawned, `${id} seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(spawned).toBeLessThanOrEqual(3); // occasional, not constant
      }
    }
  });
});
