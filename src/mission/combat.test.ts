import { describe, expect, it } from 'vitest';
import { BOLT_SPEED, CHRONO_SCALE, FIRE_RANGE, MUZZLE, createMission, missionById, segmentHit, stepMission, type Drone, type MissionState } from './sim';
import { DT } from './testkit';

// World coordinates: x grows to the right, y grows DOWN (canvas convention). A heading is the angle
// of atan2(dy, dx), so "up" is -PI/2.

/** An armed mission with nothing else in it: no enemies, walls, debris or pickups. */
function range(): MissionState {
  const m = createMission(missionById('breach-protocol'), 3);
  m.drones = [];
  m.waves = [];
  m.walls = [];
  m.rocks = [];
  m.allies = [];
  m.alliesNeeded = 0;
  m.phase = m.def.phases.length; // no operation script on the test range (nothing spawns)
  m.chrono.nextSpawn = Infinity;
  m.power.nextSpawn = Infinity;
  m.ship.x = 500;
  m.ship.y = 500;
  m.ship.vx = 0;
  m.ship.vy = 0;
  m.ship.invuln = 99;
  return m;
}

const playerBolts = (m: MissionState) => m.bullets.filter((b) => b.from === 'player');

function dummy(m: MissionState, x: number, y: number, hp = 50): Drone {
  const d: Drone = { id: m.nextId++, kind: 'turret', x, y, vx: 0, vy: 0, hp, maxHp: hp, fireIn: 999, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null };
  m.drones.push(d);
  return d;
}

/** Face a heading by holding a feather-light input that way (turns the ship, barely moves it). */
function face(m: MissionState, angle: number): void {
  for (let i = 0; i < 40; i++) stepMission(m, { x: Math.cos(angle) * 0.06, y: Math.sin(angle) * 0.06 }, DT);
}

describe('player shooting: direction and muzzle', () => {
  for (const [name, angle, dx, dy] of [
    ['up', -Math.PI / 2, 0, -1],
    ['right', 0, 1, 0],
    ['down', Math.PI / 2, 0, 1],
    ['left', Math.PI, -1, 0],
  ] as const) {
    it(`a ship facing ${name} fires ${name}, from the muzzle at its nose`, () => {
      const m = range();
      face(m, angle);
      const sx = m.ship.x;
      const sy = m.ship.y;
      stepMission(m, { x: 0, y: 0, fire: true }, DT);
      const [b] = playerBolts(m);
      expect(b).toBeDefined();
      // Velocity points exactly along the heading at bolt speed.
      expect(b.vx / BOLT_SPEED).toBeCloseTo(dx, 2);
      expect(b.vy / BOLT_SPEED).toBeCloseTo(dy, 2);
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BOLT_SPEED, 3);
      // It starts at the muzzle (MUZZLE ahead of the centre), then moved one step along the heading.
      const along = (b.x - sx) * dx + (b.y - sy) * dy;
      const across = Math.abs((b.x - sx) * -dy + (b.y - sy) * dx);
      expect(along).toBeGreaterThanOrEqual(MUZZLE - 1);
      expect(across).toBeLessThan(1);
      // The shoot event (which drives the muzzle flash) is at the muzzle and carries the heading.
      const ev = m.events.find((e) => e.type === 'shoot');
      expect(ev && ev.type === 'shoot' && Math.hypot(ev.x - (sx + dx * MUZZLE), ev.y - (sy + dy * MUZZLE))).toBeLessThan(1);
    });
  }

  it('a rotated ship (45° down-right) spawns its bolt on the rotated muzzle point, not inside the hull', () => {
    const m = range();
    const a = Math.PI / 4;
    face(m, a);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    // The shot leaves from where the ship is at the moment it fires (after this step's movement).
    const sx = m.ship.x;
    const sy = m.ship.y;
    const ang = m.ship.angle;
    const ev = m.events.find((e) => e.type === 'shoot')!;
    expect(ev.type === 'shoot' && ev.angle).toBeCloseTo(ang, 6);
    if (ev.type !== 'shoot') throw new Error('no shot');
    expect(ev.x).toBeCloseTo(sx + Math.cos(ang) * MUZZLE, 6);
    expect(ev.y).toBeCloseTo(sy + Math.sin(ang) * MUZZLE, 6);
    expect(Math.hypot(ev.x - sx, ev.y - sy)).toBeGreaterThan(20); // clear of the 13-unit hit core
  });

  it('bolts keep a straight line and constant speed for their whole life, then expire at their range', () => {
    const m = range();
    m.ship.x = 150; // room for a full-range shot inside the 1000-wide world
    face(m, 0.3);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    const b = playerBolts(m)[0];
    const vx = b.vx;
    const vy = b.vy;
    const x0 = b.x;
    const y0 = b.y;
    let travelled = 0;
    while (m.bullets.includes(b)) {
      stepMission(m, { x: 0, y: 0 }, DT);
      expect(b.vx).toBe(vx);
      expect(b.vy).toBe(vy);
      // Always on the original line
      const cross = (b.x - x0) * vy - (b.y - y0) * vx;
      expect(Math.abs(cross) / BOLT_SPEED).toBeLessThan(1e-6);
      travelled = Math.hypot(b.x - x0, b.y - y0);
    }
    expect(travelled).toBeLessThanOrEqual(FIRE_RANGE);
    expect(travelled).toBeGreaterThan(FIRE_RANGE * 0.85);
  });

  it('no bolt ever appears without a fire input', () => {
    const m = range();
    dummy(m, 500, 300); // a target right ahead
    for (let i = 0; i < 300; i++) stepMission(m, { x: 0, y: -0.05 }, DT);
    expect(playerBolts(m)).toHaveLength(0);
    expect(m.target).not.toBeNull(); // in the sights, but nothing fires on its own
  });
});

describe('player shooting: hits follow the actual trajectory', () => {
  it('a target on the line of fire is hit; one beside it is not', () => {
    const m = range();
    face(m, -Math.PI / 2);
    const onLine = dummy(m, m.ship.x, m.ship.y - 300);
    const beside = dummy(m, m.ship.x + 120, m.ship.y - 300);
    for (let i = 0; i < 30; i++) stepMission(m, { x: 0, y: -0.001, fire: true }, DT);
    expect(onLine.hp).toBeLessThan(onLine.maxHp);
    expect(beside.hp).toBe(beside.maxHp);
  });

  it('the first target along the path takes the hit (no shooting through enemies)', () => {
    const m = range();
    face(m, 0);
    const near = dummy(m, m.ship.x + 200, m.ship.y);
    const far = dummy(m, m.ship.x + 400, m.ship.y);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    for (let i = 0; i < 40; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(near.hp).toBe(near.maxHp - 1);
    expect(far.hp).toBe(far.maxHp);
  });

  it('a target outside the range is never hit', () => {
    const m = range();
    face(m, 0);
    const far = dummy(m, m.ship.x + FIRE_RANGE + MUZZLE + 60, m.ship.y);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(far.hp).toBe(far.maxHp);
  });

  it('walls stop bolts', () => {
    const m = range();
    face(m, 0);
    m.walls = [{ x: m.ship.x + 120, y: m.ship.y - 50, w: 20, h: 100 }];
    const behind = dummy(m, m.ship.x + 300, m.ship.y);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    for (let i = 0; i < 40; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(behind.hp).toBe(behind.maxHp);
    expect(playerBolts(m)).toHaveLength(0);
  });

  it('hits do not depend on the frame rate: a huge time step still connects (swept test)', () => {
    const m = range();
    face(m, 0);
    const d = dummy(m, m.ship.x + 260, m.ship.y);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    stepMission(m, { x: 0, y: 0 }, 0.05); // 1100 units/s * 0.05 = 55 units per step, wider than the target
    stepMission(m, { x: 0, y: 0 }, 0.05);
    stepMission(m, { x: 0, y: 0 }, 0.05);
    stepMission(m, { x: 0, y: 0 }, 0.05);
    stepMission(m, { x: 0, y: 0 }, 0.05);
    expect(d.hp).toBe(d.maxHp - 1);
  });

  it('segment/circle maths: entry point, misses and starting inside', () => {
    expect(segmentHit(0, 0, 100, 0, 50, 0, 10)).toBeCloseTo(0.4, 6);
    expect(segmentHit(0, 0, 100, 0, 50, 30, 10)).toBeNull();
    expect(segmentHit(0, 0, 100, 0, 0, 0, 10)).toBe(0);
    expect(segmentHit(0, 0, 100, 0, 150, 0, 10)).toBeNull(); // beyond the end
  });
});

describe('player shooting: control and state', () => {
  it('holding fire repeats at the cooldown rate; releasing stops immediately', () => {
    const m = range();
    face(m, 0);
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      stepMission(m, { x: 0, y: 0, fire: true }, DT);
      shots += m.events.filter((e) => e.type === 'shoot').length;
    }
    expect(shots).toBeGreaterThanOrEqual(6); // ~0.16s cooldown over one second
    expect(shots).toBeLessThanOrEqual(7);
    let after = 0;
    for (let i = 0; i < 60; i++) {
      stepMission(m, { x: 0, y: 0, fire: false }, DT);
      after += m.events.filter((e) => e.type === 'shoot').length;
    }
    expect(after).toBe(0);
  });

  it('a tap fires at once when the weapon is ready', () => {
    const m = range();
    face(m, 0);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    expect(m.events.filter((e) => e.type === 'shoot')).toHaveLength(1);
  });

  it('moving and firing at the same time: bolts follow the heading the ship is flying', () => {
    const m = range();
    let fired = 0;
    for (let i = 0; i < 60; i++) {
      stepMission(m, { x: 1, y: 0, fire: true }, DT);
      for (const e of m.events) {
        if (e.type !== 'shoot') continue;
        fired++;
        expect(e.angle).toBeCloseTo(m.ship.angle, 6);
      }
    }
    expect(fired).toBeGreaterThan(4);
    expect(m.ship.x).toBeGreaterThan(560); // it flew while firing
    const bolts = playerBolts(m);
    const last = bolts[bolts.length - 1];
    expect(last.vx).toBeGreaterThan(BOLT_SPEED * 0.99); // heading right
  });

  it('an unarmed mission never fires', () => {
    const m = createMission(missionById('shattered-orbit'), 3);
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: -1, fire: true }, DT);
    expect(playerBolts(m)).toHaveLength(0);
  });

  it('pausing (no steps) freezes bolts and cooldown; after a win or loss nothing more fires', () => {
    const m = range();
    face(m, 0);
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    const b = { ...playerBolts(m)[0] };
    // Pause = the game simply stops stepping: nothing moves in between.
    expect(playerBolts(m)[0].x).toBe(b.x);
    m.status = 'won';
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    expect(m.events.filter((e) => e.type === 'shoot')).toHaveLength(0);
    m.status = 'lost';
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    expect(m.events.filter((e) => e.type === 'shoot')).toHaveLength(0);
  });

  it('a restart starts clean: no bolts, weapon ready, no target, phase one', () => {
    const a = range();
    face(a, 0);
    for (let i = 0; i < 20; i++) stepMission(a, { x: 0, y: 0, fire: true }, DT);
    const b = createMission(missionById('breach-protocol'), 3);
    expect(b.bullets).toHaveLength(0);
    expect(b.ship.fireCd).toBe(0);
    expect(b.target).toBeNull();
    expect(b.phase).toBe(0);
    expect(b.phasesDone).toEqual([]);
    expect(b.flags).not.toBe(a.flags);
  });

  it('CHRONO SHIFT: player bolts keep full speed while enemy fire slows', () => {
    const m = range();
    face(m, 0);
    m.chrono.active = 3;
    m.bullets.push({ id: 900, x: 100, y: 100, vx: 200, vy: 0, r: 9, from: 'enemy', life: 5 });
    stepMission(m, { x: 0, y: 0, fire: true }, DT);
    const mine = playerBolts(m)[0];
    const x0 = mine.x;
    const enemy = m.bullets.find((b) => b.id === 900)!;
    const e0 = enemy.x;
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(mine.x - x0).toBeCloseTo(BOLT_SPEED * DT, 3);
    expect(enemy.x - e0).toBeCloseTo(200 * DT * CHRONO_SCALE, 3);
  });
});

describe('enemy fire is aimed, never random', () => {
  it('a gunner fires straight at its target after telegraphing', () => {
    const m = range();
    const g: Drone = { id: 77, kind: 'gunner', x: 500, y: 200, vx: 0, vy: 0, hp: 9, maxHp: 9, fireIn: 0, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null };
    m.drones.push(g);
    let shot = null as null | { vx: number; vy: number; x: number; y: number };
    for (let i = 0; i < 90 && !shot; i++) {
      stepMission(m, { x: 0, y: 0 }, DT);
      const b = m.bullets.find((x) => x.from === 'enemy');
      if (b) shot = { vx: b.vx, vy: b.vy, x: g.x, y: g.y };
    }
    expect(shot).not.toBeNull();
    const want = Math.atan2(m.ship.y - shot!.y, m.ship.x - shot!.x);
    expect(Math.atan2(shot!.vy, shot!.vx)).toBeCloseTo(want, 1);
  });
});

describe('optional aim assist', () => {
  const offAxis = (deg: number) => {
    const m = range();
    face(m, -Math.PI / 2); // nose straight up
    const a = -Math.PI / 2 + (deg * Math.PI) / 180;
    const d = dummy(m, m.ship.x + Math.cos(a) * 320, m.ship.y + Math.sin(a) * 320);
    return { m, d };
  };

  it('off: a target 7° off the nose is missed (bolts fly exactly along the heading)', () => {
    const { m, d } = offAxis(7);
    for (let i = 0; i < 40; i++) stepMission(m, { x: 0, y: 0, fire: true, assist: false }, DT);
    expect(d.hp).toBe(d.maxHp);
  });

  it('on: a target 7° off the nose is hit, and the HUD shows it in the sights', () => {
    const { m, d } = offAxis(7);
    stepMission(m, { x: 0, y: 0, assist: true }, DT);
    expect(m.target).toBe(d.id);
    for (let i = 0; i < 40; i++) stepMission(m, { x: 0, y: 0, fire: true, assist: true }, DT);
    expect(d.hp).toBeLessThan(d.maxHp);
  });

  it('on: a target 15° off the nose is outside the cone and is missed', () => {
    const { m, d } = offAxis(15);
    for (let i = 0; i < 40; i++) stepMission(m, { x: 0, y: 0, fire: true, assist: true }, DT);
    expect(d.hp).toBe(d.maxHp);
    expect(m.target).toBeNull();
  });

  it('on: still nothing fires without input, and a wall in the way blocks the assisted shot', () => {
    const { m, d } = offAxis(4);
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: 0, assist: true }, DT);
    expect(playerBolts(m)).toHaveLength(0);
    m.walls = [{ x: d.x - 60, y: d.y + 60, w: 120, h: 16 }];
    for (let i = 0; i < 40; i++) stepMission(m, { x: 0, y: 0, fire: true, assist: true }, DT);
    expect(d.hp).toBe(d.maxHp);
  });

  it('on: the bolt still leaves from the muzzle at the nose', () => {
    const { m } = offAxis(5);
    stepMission(m, { x: 0, y: 0, fire: true, assist: true }, DT);
    const e = m.events.find((x) => x.type === 'shoot');
    if (!e || e.type !== 'shoot') throw new Error('no shot');
    expect(e.x).toBeCloseTo(m.ship.x + Math.cos(m.ship.angle) * MUZZLE, 6);
    expect(e.y).toBeCloseTo(m.ship.y + Math.sin(m.ship.angle) * MUZZLE, 6);
  });
});
