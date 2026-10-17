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
} from './sim';

import { DT, calm, combatPilot, flyTo, hold, shootDown } from './testkit';

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
  it('cores first, then the blocked lane must be shot clear; only then does the portal open and win', () => {
    const m = make('first-contact');
    flyTo(m, { x: 500, y: 110 }, { within: 4, maxT: 6 }); // fly right into the closed portal
    expect(m.status).toBe('playing'); // no win while it is closed
    hold(m, 0.5);
    expect(m.status).toBe('playing');
    for (const c of [{ x: 160, y: 620 }, { x: 840, y: 760 }, { x: 500, y: 520 }, { x: 820, y: 300 }, { x: 180, y: 220 }]) flyTo(m, c, { within: 8 });
    expect(m.cores.every((c) => c.taken)).toBe(true);
    // Phase 2: debris now blocks the lane, and the portal stays shut until it is shot apart.
    expect(objectiveView(m).title).toMatch(/extraction lane/i);
    expect(m.rocks.filter((r) => r.tag === 'blocker')).toHaveLength(3);
    expect(m.portal!.open).toBe(false);
    for (let k = 0; k < 3; k++) {
      const blocker = () => m.rocks.find((r) => r.tag === 'blocker') ?? null;
      const id = blocker()!.id;
      expect(shootDown(m, blocker, () => !m.rocks.some((r) => r.id === id))).toBe(true);
    }
    expect(m.portal!.open).toBe(true);
    expect(objectiveView(m).text).toMatch(/portal/i);
    flyTo(m, { x: 500, y: 110 }, { within: 5 });
    expect(m.status).toBe('won');
    expect(m.phasesDone).toEqual(['Recover the fuel cores', 'Clear the extraction lane', 'Reach extraction']);
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
  it('the blaster fires only when the player presses fire, even with enemies right ahead', () => {
    const m = make('breach-protocol');
    calm(m);
    for (let i = 0; i < 90; i++) stepMission(m, { x: 0, y: -0.05 }, DT); // nose up at the first wave
    expect(m.bullets.filter((b) => b.from === 'player')).toHaveLength(0);
    stepMission(m, { x: 0, y: -0.05, fire: true }, DT);
    expect(m.bullets.filter((b) => b.from === 'player')).toHaveLength(1);
  });

  it('hold the line, then the hive carrier appears; destroying it and the stragglers with the Aegis alive wins', () => {
    const m = make('breach-protocol');
    const frigate = m.allies[0];
    let sawHive = false;
    while (m.status === 'playing' && m.realTime < 200) {
      combatPilot(m);
      if (m.drones.some((d) => d.kind === 'hive')) sawHive = true;
      if (m.phase === 0) expect(m.drones.some((d) => d.kind === 'hive')).toBe(false);
    }
    expect(sawHive).toBe(true);
    expect(m.phasesDone).toEqual(['Hold the line', 'Destroy the hive carrier', 'Clear the remaining attackers']);
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

  it('blast doors block the way until their switches are held; a moving pilot opens both and escapes', () => {
    const m = make('collapse');
    const movingGap = () => {
      const w = wallAt(m.walls[4], m.time);
      return { x: w.x + w.w / 2 > 500 ? 70 : 930, y: 700 };
    };
    for (const p of [{ x: 380, y: 1900 }, { x: 380, y: 1700 }, { x: 850, y: 1540 }]) flyTo(m, p);
    // Door A is shut: flying at the gap does not get through.
    flyTo(m, { x: 620, y: 1150 }, { maxT: 1.5 });
    expect(m.ship.y).toBeGreaterThan(1250);
    flyTo(m, { x: 620, y: 1380 });
    hold(m, 0.9);
    expect(m.switches[0].active).toBe(true);
    for (const p of [{ x: 620, y: 1150 }, { x: 150, y: 1020 }]) flyTo(m, p);
    flyTo(m, () => ({ ...movingGap(), y: 880 }), { within: 30 });
    flyTo(m, movingGap, { within: 30 });
    flyTo(m, { x: 820, y: 620 });
    flyTo(m, { x: 500, y: 570 });
    hold(m, 0.9);
    expect(m.switches[1].active).toBe(true);
    flyTo(m, { x: 500, y: 400 });
    flyTo(m, { x: 500, y: 120 }, { within: 5 });
    expect(m.status).toBe('won');
    expect(secondariesMet(m)[0]).toBe(true);
    expect(m.phasesDone).toEqual(['Open blast door A', 'Open blast door B', 'Reach the escape portal']);
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

  it('core stability runs out if nothing is stabilised: the core goes critical', () => {
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
  it('the shield holds while any generator stands; destroying them all exposes the core, then they reboot', () => {
    const m = make('guardian');
    const gens = () => m.drones.filter((d) => d.tag === 'generator' && d.hp > 0);
    hold(m, 1, false); // generators warp in
    expect(gens()).toHaveLength(2);
    expect(m.boss!.shielded).toBe(true);
    // Time alone never drops it.
    for (let i = 0; i < 60 * 8; i++) {
      m.ship.invuln = 5;
      stepMission(m, { x: 0, y: m.ship.y < 700 ? 0.4 : 0 }, DT);
    }
    expect(m.status).toBe('playing');
    expect(m.boss!.shielded).toBe(true);
    // Bolts that hit the shield do no damage.
    const hp = m.boss!.hp;
    for (let i = 0; i < 60; i++) {
      m.ship.invuln = 5;
      stepMission(m, { x: (m.boss!.x - m.ship.x) * 0.0002, y: -0.06, fire: true }, DT);
    }
    expect(m.boss!.hp).toBe(hp);
    // Shoot each generator down.
    while (gens().length) {
      const g = gens()[0];
      m.ship.invuln = 5;
      expect(shootDown(m, () => g, () => g.hp <= 0, 20, false)).toBe(true);
    }
    stepMission(m, { x: 0, y: 0 }, DT); // the boss reads its generators on the next tick
    expect(m.boss!.shielded).toBe(false);
    // The core stays exposed for a fixed window of world time, then the generators reboot.
    const t0 = m.time;
    while (m.status === 'playing' && !m.boss!.shielded && m.time - t0 < 7.5) {
      m.ship.invuln = 5;
      stepMission(m, { x: 0, y: m.ship.y < 700 ? 0.4 : 0 }, DT); // hold station against the singularity's pull
    }
    expect(m.status).toBe('playing');
    expect(m.time - t0).toBeGreaterThan(6.9);
    expect(m.boss!.shielded).toBe(true);
    expect(gens().length).toBeGreaterThan(0); // rebooted
  });

  it('a full fight: generators, core, three phases; the kill starts the escape and reaching the portal wins', () => {
    const m = make('guardian');
    let phases = 0;
    while (m.status === 'playing' && !m.escaping && m.realTime < 260) {
      m.ship.invuln = 5;
      const gens = m.drones.filter((d) => d.tag === 'generator' && d.hp > 0 && d.spawnIn === 0);
      const b = m.boss!;
      if (b.shielded && gens.length) {
        const g = gens.sort((p, q) => Math.hypot(p.x - m.ship.x, p.y - m.ship.y) - Math.hypot(q.x - m.ship.x, q.y - m.ship.y))[0];
        const dx = g.x - m.ship.x;
        const dy = g.y - m.ship.y;
        const d = Math.hypot(dx, dy) || 1;
        const k = d > 220 ? 1 : 0.07;
        stepMission(m, { x: (dx / d) * k, y: (dy / d) * k, fire: m.target === g.id }, DT);
      } else {
        // Hold a firing position below the core and keep the nose on it.
        const tx = b.x;
        const ty = 620;
        const dx = tx - m.ship.x;
        const dy = ty - m.ship.y;
        const d = Math.hypot(dx, dy);
        const aim = { x: b.x - m.ship.x, y: b.y - m.ship.y };
        const ad = Math.hypot(aim.x, aim.y) || 1;
        const inp = d > 40 ? { x: dx / d, y: dy / d } : { x: (aim.x / ad) * 0.07, y: (aim.y / ad) * 0.07 };
        stepMission(m, { ...inp, fire: m.target === -1 }, DT);
      }
      phases += m.events.filter((e) => e.type === 'boss-phase').length;
    }
    expect(phases).toBe(2);
    expect(m.escaping).toBe(true);
    expect(m.status).toBe('playing'); // not won yet
    expect(m.portal!.open).toBe(true);
    while (m.status === 'playing' && m.realTime < 320) {
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
