import { describe, expect, it } from 'vitest';
import { LEASH_SPAN, MAX_PILOTS, STRANDED_LIMIT, MISSIONS, REVIVE_R, REVIVE_TIME, SHIP_R, VIEW, createMission, missionById, setPilotOnline, stepMission, type Drone, type MissionInput, type MissionState } from './sim';
import { DT } from './testkit';

// Co-op pilots in the mission simulation (P2.1): no networking here, just the rules for 2-4 ships.

/** An armed, empty test range with `n` pilots spread out in a line, nothing else in the world. */
function range(n: number, seed = 3): MissionState {
  const m = createMission(missionById('breach-protocol'), seed, n);
  m.encounters = [];
  m.drones = [];
  m.walls = [];
  m.rocks = [];
  m.allies = [];
  m.alliesNeeded = 0;
  m.phase = m.def.phases.length; // no operation script
  m.chrono.nextSpawn = Infinity;
  m.power.nextSpawn = Infinity;
  m.ships.forEach((p, i) => {
    p.x = 300 + i * 130;
    p.y = 600;
    p.vx = 0;
    p.vy = 0;
    p.invuln = 0;
  });
  return m;
}

const idle = (n: number): MissionInput[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));
const run = (m: MissionState, inputs: MissionInput[] | ((i: number) => MissionInput[]), steps: number) => {
  for (let i = 0; i < steps && m.status === 'playing'; i++) stepMission(m, typeof inputs === 'function' ? inputs(i) : inputs, DT);
};
function dummy(m: MissionState, x: number, y: number, hp = 50, kind: Drone['kind'] = 'turret'): Drone {
  const d: Drone = { id: m.nextId++, kind, x, y, vx: 0, vy: 0, hp, maxHp: hp, fireIn: 999, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null };
  m.drones.push(d);
  return d;
}
const shoot = (m: MissionState, slot: number, x: number, y: number) =>
  m.bullets.push({ id: m.nextId++, x, y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 }) && slot;
/** Knock a pilot's hull out with enemy fire. */
function downIt(m: MissionState, slot: number) {
  const p = m.ships[slot];
  p.hp = 1;
  p.invuln = 0;
  m.power.shield = false;
  shoot(m, slot, p.x, p.y);
  stepMission(m, idle(m.ships.length), DT);
}

describe('creating a mission with several pilots', () => {
  it('2-4 pilots start in formation around the mission start, at full hull, each with its own slot', () => {
    for (const def of MISSIONS) {
      for (const n of [2, 3, 4]) {
        const m = createMission(def, 1, n);
        expect(m.ships).toHaveLength(n);
        expect(m.ship).toBe(m.ships[0]);
        expect(m.ships.map((p) => p.slot)).toEqual([...Array(n).keys()]);
        expect(m.ships.every((p) => p.hp === def.maxHp && p.online && !p.downed)).toBe(true);
        const spots = new Set(m.ships.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
        expect(spots.size).toBe(n);
        for (const p of m.ships) {
          expect(p.x).toBeGreaterThanOrEqual(SHIP_R);
          expect(p.y).toBeLessThanOrEqual(def.world.h - SHIP_R);
        }
      }
    }
    expect(createMission(MISSIONS[0], 1, 9).ships).toHaveLength(MAX_PILOTS);
    expect(createMission(MISSIONS[0], 1, 0).ships).toHaveLength(1);
  });

  it('one pilot is exactly the solo mission, and a one-element input list is exactly a solo input', () => {
    for (const def of MISSIONS) {
      const strip = (m: MissionState) => JSON.stringify({ ...m, rng: undefined });
      expect(strip(createMission(def, 7, 1))).toBe(strip(createMission(def, 7)));
      const a = createMission(def, 7);
      const b = createMission(def, 7);
      for (let i = 0; i < 60 * 20 && a.status === 'playing'; i++) {
        const input = { x: Math.sin(i / 40), y: Math.cos(i / 70), fire: i % 50 < 30, assist: i % 200 < 100 };
        stepMission(a, input, DT);
        stepMission(b, [input], DT);
      }
      expect(strip(b)).toBe(strip(a));
    }
  });

  it('is deterministic with several pilots: the same seed and inputs give the same mission', () => {
    const play = () => {
      const m = createMission(missionById('last-jump'), 4, 3);
      run(m, (i) => [0, 1, 2].map((k) => ({ x: Math.sin(i / (30 + k * 7)), y: Math.cos(i / (45 + k)), fire: (i + k * 10) % 40 < 25, assist: true })), 60 * 30);
      return JSON.stringify({ ...m, rng: undefined });
    };
    expect(play()).toBe(play());
  });
});

describe('each pilot flies, aims and fires on their own', () => {
  it('movement follows each pilot’s own input; a missing input means hands off', () => {
    const m = range(3);
    const start = m.ships.map((p) => ({ x: p.x, y: p.y }));
    run(m, [{ x: 0, y: -1 }, { x: 1, y: 0 }], 30);
    expect(m.ships[0].y).toBeLessThan(start[0].y - 50);
    expect(Math.abs(m.ships[0].x - start[0].x)).toBeLessThan(2);
    expect(m.ships[1].x).toBeGreaterThan(start[1].x + 50);
    expect(Math.hypot(m.ships[2].x - start[2].x, m.ships[2].y - start[2].y)).toBeLessThan(0.01);
    expect(m.ships[0].angle).toBeCloseTo(-Math.PI / 2, 1);
    expect(m.ships[1].angle).toBeCloseTo(0, 1);
  });

  it('only the pilot who pulls the trigger fires, from their own nose; bolts, shots and kills are credited to them', () => {
    const m = range(3);
    const p = m.ships[2];
    p.angle = -Math.PI / 2;
    const d = dummy(m, p.x, p.y - 250, 3);
    run(m, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0, fire: true }], 60);
    expect(d.hp).toBeLessThanOrEqual(0);
    expect(m.drones).toHaveLength(0);
    expect(p.stats.shots).toBeGreaterThanOrEqual(3);
    expect(p.stats.shotsHit).toBe(3);
    expect(p.stats.kills).toBe(1);
    expect(m.kills).toBe(1);
    expect(m.ships[0].stats.shots + m.ships[1].stats.shots).toBe(0);
    expect(m.flags.shots).toBe(p.stats.shots);
  });

  it('each pilot has their own line of fire; the solo HUD target is the first pilot’s', () => {
    const m = range(2);
    m.ships[0].angle = 0; // facing right: nothing there
    m.ships[1].angle = -Math.PI / 2;
    const d = dummy(m, m.ships[1].x, m.ships[1].y - 200);
    run(m, idle(2), 1);
    expect(m.ships[1].aimTarget).toBe(d.id);
    expect(m.ships[0].aimTarget).toBeNull();
    expect(m.target).toBeNull();
  });

  it('enemies hunt the nearest pilot still standing', () => {
    const m = range(3);
    const scout = dummy(m, m.ships[2].x + 200, m.ships[2].y, 4, 'scout');
    run(m, idle(3), 20);
    expect(scout.x).toBeLessThan(m.ships[2].x + 200); // heading for pilot 3, the closest
    expect(Math.abs(scout.y - m.ships[2].y)).toBeLessThan(10);
    downIt(m, 2);
    const before = { x: scout.x, y: scout.y };
    run(m, idle(3), 30);
    // Pilot 3 is down: the scout now goes for pilot 2.
    const toward = Math.hypot(before.x - m.ships[1].x, before.y - m.ships[1].y) - Math.hypot(scout.x - m.ships[1].x, scout.y - m.ships[1].y);
    expect(toward).toBeGreaterThan(20);
  });
});

describe('damage, downed pilots and revives', () => {
  it('a hit damages only the pilot it strikes; the squadron’s total is counted too', () => {
    const m = range(3);
    shoot(m, 1, m.ships[1].x, m.ships[1].y);
    stepMission(m, idle(3), DT);
    expect(m.ships.map((p) => p.hp)).toEqual([m.def.maxHp, m.def.maxHp - 1, m.def.maxHp]);
    expect(m.ships[1].stats.hitsTaken).toBe(1);
    expect(m.hitsTaken).toBe(1);
    expect(m.events.find((e) => e.type === 'hit')).toMatchObject({ slot: 1 });
  });

  it('a pilot whose hull runs out is downed, not killed: the mission goes on and the wreck cannot act', () => {
    const m = range(3);
    downIt(m, 1);
    const p = m.ships[1];
    expect(p.downed).toBe(true);
    expect(p.stats.downs).toBe(1);
    expect(m.status).toBe('playing');
    expect(m.events.some((e) => e.type === 'pilot-down' && e.slot === 1)).toBe(true);
    const at = { x: p.x, y: p.y };
    const d = dummy(m, p.x, p.y - 200);
    p.angle = -Math.PI / 2;
    run(m, [{ x: 0, y: 0 }, { x: 1, y: 0, fire: true }, { x: 0, y: 0 }], 60);
    expect({ x: p.x, y: p.y }).toEqual(at); // cannot fly
    expect(p.stats.shots).toBe(0); // cannot fire
    expect(d.hp).toBe(50);
    shoot(m, 1, p.x, p.y);
    stepMission(m, idle(3), DT);
    expect(p.hp).toBe(0); // and is not hit again
  });

  it('a teammate who stays close for the revive time brings a downed pilot back', () => {
    const m = range(2);
    downIt(m, 1);
    const [a, b] = m.ships;
    // Fly over and hold position next to the wreck.
    for (let i = 0; i < 60 * 3 && Math.hypot(b.x - a.x, b.y - a.y) > 40; i++) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      stepMission(m, [{ x: dx / d, y: dy / d }, { x: 0, y: 0 }], DT);
    }
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(REVIVE_R);
    run(m, idle(2), Math.round(60 * (REVIVE_TIME - 0.5)));
    expect(b.downed).toBe(true); // not yet
    expect(b.reviveCharge).toBeGreaterThan(0.7);
    let revived = 0;
    for (let i = 0; i < 60; i++) {
      stepMission(m, idle(2), DT);
      revived += m.events.filter((e) => e.type === 'pilot-revived').length;
    }
    expect(b.downed).toBe(false);
    expect(revived).toBe(1);
    expect(b.hp).toBe(Math.ceil(m.def.maxHp / 2));
    expect(b.invuln).toBeGreaterThan(0);
    expect(a.stats.revives).toBe(1);
  });

  it('the revive only progresses while the teammate stays: leaving lets it drain away', () => {
    const m = range(2);
    downIt(m, 1);
    const [a, b] = m.ships;
    a.x = b.x + 30;
    a.y = b.y;
    run(m, idle(2), 60);
    const part = b.reviveCharge;
    expect(part).toBeGreaterThan(0.3);
    a.x = b.x + REVIVE_R + 120;
    run(m, idle(2), 60);
    expect(b.reviveCharge).toBeLessThan(part);
    expect(b.downed).toBe(true);
  });

  it('when every pilot is down at once the mission is lost; one standing pilot keeps it alive', () => {
    const m = range(3);
    downIt(m, 0);
    downIt(m, 2);
    expect(m.status).toBe('playing');
    downIt(m, 1);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/squadron is down/);
  });

  it('things no hull survives (the collapse) down a co-op pilot instead of ending the mission', () => {
    const m = createMission(missionById('collapse'), 1, 2);
    m.collapseY = m.ships[1].y + 5; // the collapse reaches pilot 2's tail
    stepMission(m, idle(2), DT);
    expect(m.ships[1].downed).toBe(true);
    expect(m.status).toBe('playing');
  });
});

describe('offline pilots', () => {
  it('are frozen and ignored: no damage, no part in a wipe, and they come back protected', () => {
    const m = range(3);
    setPilotOnline(m, 2, false);
    const p = m.ships[2];
    const at = { x: p.x, y: p.y };
    run(m, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1, fire: true }], 30);
    expect({ x: p.x, y: p.y }).toEqual(at);
    shoot(m, 2, p.x, p.y);
    stepMission(m, idle(3), DT);
    expect(p.hp).toBe(m.def.maxHp);
    downIt(m, 0);
    downIt(m, 1);
    // Everyone online is down, but pilot 3 was still flying when they dropped: the squadron waits for them.
    expect(m.status).toBe('playing');
    run(m, idle(3), 60 * 5);
    expect(m.flags.stranded).toBeCloseTo(5, 0);
    run(m, idle(3), 60 * (STRANDED_LIMIT - 5) + 5);
    expect(m.status).toBe('lost'); // they never came back
    expect(m.failReason).toMatch(/lost contact/);
    const n = range(2);
    setPilotOnline(n, 1, false);
    setPilotOnline(n, 0, false);
    expect(n.status).toBe('playing'); // nobody online: nothing to decide
    setPilotOnline(n, 1, true);
    expect(n.ships[1].invuln).toBeGreaterThan(0);
  });

  it('a pilot who drops while flying keeps the squadron alive, and can rejoin in time to revive the others', () => {
    const m = range(2);
    downIt(m, 0);
    setPilotOnline(m, 1, false); // the last pilot flying loses connection
    expect(m.status).toBe('playing');
    run(m, idle(2), 60 * 10);
    expect(m.status).toBe('playing');
    setPilotOnline(m, 1, true); // back after 10 s
    expect(m.flags.stranded).toBeGreaterThan(9); // still counted until the next step
    m.ships[1].x = m.ships[0].x + 30;
    m.ships[1].y = m.ships[0].y;
    run(m, idle(2), 1);
    expect(m.flags.stranded).toBeUndefined(); // someone is flying again
    run(m, idle(2), 60 * REVIVE_TIME + 10);
    expect(m.ships[0].downed).toBe(false);
    expect(m.status).toBe('playing');
  });

  it('a pilot who was already down when they dropped cannot save anyone: then a wipe is a wipe', () => {
    const m = range(2);
    downIt(m, 1);
    setPilotOnline(m, 1, false);
    downIt(m, 0);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/squadron is down/);
  });
});

describe('the shared camera', () => {
  it('keeps every pilot on screen however they fly, and nobody strays beyond the leash', () => {
    for (const n of [2, 3, 4]) {
      const m = createMission(missionById('alien-pursuit'), 2, n);
      for (const p of m.ships) p.invuln = 1e9;
      let worstOut = 0;
      let worstSpread = 0;
      for (let i = 0; i < 60 * 30 && m.status === 'playing'; i++) {
        // Everyone pulls in a different direction, changing every second.
        const inputs = m.ships.map((p) => {
          const a = Math.floor(i / 60) * 1.7 + p.slot * 2.1;
          return { x: Math.cos(a), y: Math.sin(a) };
        });
        for (const p of m.ships) p.invuln = 1e9;
        stepMission(m, inputs, DT);
        for (const p of m.ships) {
          const out = Math.max(m.camX - p.x, p.x - (m.camX + VIEW), m.camY - p.y, p.y - (m.camY + VIEW), 0);
          worstOut = Math.max(worstOut, out);
        }
        const xs = m.ships.map((p) => p.x);
        const ys = m.ships.map((p) => p.y);
        worstSpread = Math.max(worstSpread, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      }
      expect(worstOut, `${n} pilots`).toBe(0);
      expect(worstSpread, `${n} pilots`).toBeLessThanOrEqual(LEASH_SPAN + SHIP_R);
    }
  });
});

describe('the leash', () => {
  it('holds the pilot who flies away at the limit, and never drags an idle teammate along', () => {
    const m = range(2);
    m.ships[0].y = 150; // room to fly 620+ units south inside this 1000-unit world
    m.ships[1].y = 150;
    const idle = { x: m.ships[0].x, y: m.ships[0].y };
    // Pilot 2 flies straight away from pilot 1 for 3 s; pilot 1 has hands off the controls.
    run(m, [{ x: 0, y: 0 }, { x: 0, y: 1 }], 60 * 3);
    expect(Math.hypot(m.ships[0].x - idle.x, m.ships[0].y - idle.y)).toBeLessThan(0.01);
    expect(Math.abs(m.ships[1].y - m.ships[0].y)).toBeLessThanOrEqual(LEASH_SPAN + 0.01);
    expect(Math.abs(m.ships[1].y - m.ships[0].y)).toBeGreaterThan(LEASH_SPAN - 5); // it really reached the limit
  });

  it('two pilots flying apart at once both stop at the limit (nobody exceeds it for long)', () => {
    const m = range(2);
    m.ships[0].x = 500;
    m.ships[1].x = 500;
    m.ships[0].y = 500;
    m.ships[1].y = 500;
    let worst = 0;
    for (let i = 0; i < 60 * 3; i++) {
      stepMission(m, [{ x: 0, y: -1 }, { x: 0, y: 1 }], DT);
      worst = Math.max(worst, Math.abs(m.ships[1].y - m.ships[0].y));
    }
    expect(worst).toBeLessThanOrEqual(LEASH_SPAN + 0.01);
  });
});

describe('objectives with several pilots', () => {
  it('any pilot can collect fuel cores; a reactor charges with anyone inside but not faster with more', () => {
    const m = createMission(missionById('first-contact'), 1, 2);
    m.rocks = [];
    const c = m.cores[0];
    m.ships[1].x = c.x;
    m.ships[1].y = c.y;
    stepMission(m, idle(2), DT);
    expect(c.taken).toBe(true);

    const one = createMission(missionById('meltdown'), 1, 2);
    const two = createMission(missionById('meltdown'), 1, 2);
    for (const mm of [one, two]) {
      mm.drones = [];
      mm.encounters = [];
      mm.pulseEvery = 0;
      mm.barriers = [];
      mm.rocks = [];
    }
    const r1 = one.reactors[2];
    one.ships[1].x = r1.x;
    one.ships[1].y = r1.y;
    const r2 = two.reactors[2];
    for (const p of two.ships) {
      p.x = r2.x;
      p.y = r2.y;
    }
    run(one, idle(2), 60);
    run(two, idle(2), 60);
    expect(r1.charge).toBeGreaterThan(0.4);
    expect(r2.charge).toBeCloseTo(r1.charge, 6);
    expect(one.ships[1].stats.objectiveTime).toBeCloseTo(1, 1);
    expect(one.ships[0].stats.objectiveTime).toBe(0);
  });

  it('extraction needs the whole squadron in the portal, standing: a downed teammate must be revived first', () => {
    const m = createMission(missionById('shattered-orbit'), 1, 2);
    m.barriers = [];
    m.rocks = [];
    for (const g of m.gates) g.passed = true;
    stepMission(m, idle(2), DT);
    expect(m.portal!.open).toBe(true);
    const [a, b] = m.ships;
    // Pilot 2 is downed just outside the portal; pilot 1 waits inside it, close enough to revive them.
    a.x = 900;
    a.y = 600;
    b.x = m.portal!.x + 60;
    b.y = m.portal!.y;
    b.hp = 1;
    b.invuln = 0;
    m.bullets.push({ id: 9001, x: b.x, y: b.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    stepMission(m, idle(2), DT);
    expect(b.downed).toBe(true);
    a.x = m.portal!.x;
    a.y = m.portal!.y;
    run(m, idle(2), 30);
    expect(m.status).toBe('playing'); // not without them
    run(m, idle(2), 60 * REVIVE_TIME + 30); // pilot 1 is beside the wreck: it gets revived
    expect(b.downed).toBe(false);
    expect(m.status).toBe('playing'); // revived, but still outside
    b.x = m.portal!.x - 10;
    run(m, idle(2), 2);
    expect(m.status).toBe('won');
  });

  it('each pilot tows their own escape pods; a downed pilot’s tractor beam lets go', () => {
    const m = createMission(missionById('rescue'), 1, 2);
    m.rocks = [];
    m.drones = [];
    m.encounters = [];
    const [a, b] = m.ships;
    // Away from the rescue bay (a pod towed into it is saved at once).
    a.x = 400;
    a.y = 1200;
    b.x = 550;
    b.y = 1200;
    const pods = m.pods.slice(0, 3);
    // Bring three pods to the squadron: one at pilot 1, two at pilot 2.
    pods[0].x = a.x;
    pods[0].y = a.y;
    pods[1].x = b.x;
    pods[1].y = b.y;
    stepMission(m, idle(2), DT);
    pods[2].x = b.x;
    pods[2].y = b.y;
    stepMission(m, idle(2), DT);
    expect(pods.map((p) => [p.state, p.towedBy])).toEqual([
      ['towed', 0],
      ['towed', 1],
      ['towed', 1],
    ]);
    expect(b.stats.objectiveTime).toBeGreaterThan(0);
    b.hp = 1;
    b.invuln = 0;
    m.power.shield = false;
    m.bullets.push({ id: 9002, x: b.x, y: b.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    stepMission(m, idle(2), DT);
    expect(b.downed).toBe(true);
    expect(pods[1].state).toBe('drifting');
    expect(pods[2].state).toBe('drifting');
    expect(pods[0].state).toBe('towed');
  });

  it('a co-op squadron can play a combat mission to victory, and a restart is a clean start', () => {
    for (const n of [2, 3, 4]) {
      const def = missionById('breach-protocol');
      const pristine = JSON.stringify({ ...createMission(def, 5, n), rng: undefined });
      const m = createMission(def, 5, n);
      while (m.status === 'playing' && m.realTime < 240) {
        // Each pilot attacks the enemy nearest to them and fires when it is in their own sights.
        const inputs = m.ships.map((p) => {
          p.invuln = 5;
          const t = m.drones.filter((d) => d.spawnIn === 0).sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y))[0];
          if (!t) return { x: 0, y: 0 };
          const dx = t.x - p.x;
          const dy = t.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = d > 220 ? 1 : 0.07;
          return { x: (dx / d) * k, y: (dy / d) * k, fire: p.aimTarget !== null };
        });
        stepMission(m, inputs, DT);
      }
      expect(m.status, `${n} pilots`).toBe('won');
      expect(m.ships.reduce((k, p) => k + p.stats.kills, 0)).toBe(m.kills);
      expect(m.ships.filter((p) => p.stats.kills > 0).length).toBeGreaterThan(1); // the work was shared
      expect(JSON.stringify({ ...createMission(def, 5, n), rng: undefined })).toBe(pristine);
    }
  });
});
