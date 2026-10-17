import { describe, expect, it } from 'vitest';
import { combatPilot, DT, shootDown } from './testkit';
import { OVERDRIVE_TIME, TOW_MAX, comboMult, createMission, missionById, objectiveView, secondariesMet, stepMission, type MissionId, type MissionState, type Vec } from './sim';

const make = (id: MissionId, seed = 11) => createMission(missionById(id), seed);

function steer(m: MissionState, t: Vec): { x: number; y: number } {
  const dx = t.x - m.ship.x;
  const dy = t.y - m.ship.y;
  const d = Math.hypot(dx, dy) || 1;
  return d < 6 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
}

/** The shared combat pilot: aims and fires through the real controls (see testkit). */
const escortPilot = (m: MissionState) => {
  combatPilot(m);
  return null;
};

describe('Mission 02 · Alien Pursuit (escort)', () => {
  it('the transport flies its route; raiders target it; the mission is won when it reaches the gate', () => {
    const m = make('alien-pursuit');
    const t = m.allies[0];
    const y0 = t.y;
    let raidersOnTransport = 0;
    while (m.status === 'playing' && m.realTime < 120) {
      escortPilot(m);
      raidersOnTransport = Math.max(raidersOnTransport, m.drones.filter((d) => d.kind === 'raider' && d.targetAlly === t.id).length);
    }
    expect(t.y).toBeLessThan(y0 - 1500);
    expect(raidersOnTransport).toBeGreaterThan(0);
    expect(m.status).toBe('won');
    expect(t.arrived).toBe(true);
  });

  it('losing the transport fails the mission, naming it', () => {
    const m = make('alien-pursuit');
    m.allies[0].hp = 1;
    m.bullets.push({ id: 900, x: m.allies[0].x, y: m.allies[0].y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 2 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/Kestrel was destroyed/);
  });

  it('the player entering the jump gate does not win: the transport has to get there', () => {
    const m = make('alien-pursuit');
    m.ship.x = m.portal!.x;
    m.ship.y = m.portal!.y;
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('playing');
  });
});

describe('Mission 08 · The Convoy', () => {
  it('one hauler lost: the convoy carries on; a second loss fails it', () => {
    const m = make('convoy');
    m.allies[0].hp = 0.5;
    m.bullets.push({ id: 901, x: m.allies[0].x, y: m.allies[0].y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 2 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.allies[0].destroyed).toBe(true);
    expect(m.status).toBe('playing');
    expect(objectiveView(m).text).toMatch(/2\/3/);
    m.allies[1].hp = 0.5;
    m.bullets.push({ id: 902, x: m.allies[1].x, y: m.allies[1].y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 2 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('lost');
  });

  it('a defended convoy reaches the relay and wins; "all three survive" is tracked', () => {
    const m = make('convoy');
    while (m.status === 'playing' && m.realTime < 140) escortPilot(m);
    expect(m.status).toBe('won');
    expect(m.allies.filter((a) => !a.destroyed && a.arrived).length).toBeGreaterThanOrEqual(2);
    expect(secondariesMet(m)[0]).toBe(m.allies.every((a) => !a.destroyed));
  });
});

describe('Mission 03 · The Rescue', () => {
  it('the tractor beam holds two pods at a time; pods are saved in the rescue bay; all five win', () => {
    const m = make('rescue');
    m.rocks = [];
    m.drones = [];
    m.waves = [];
    // Invariant checked on every step: no survivor is landed while the bay is sealed.
    const savedNow = () => m.pods.filter((p) => p.state === 'saved').length;
    let sealedSaves = 0;
    const tick = (inp: { x: number; y: number; fire?: boolean }) => {
      const before = savedNow();
      const sealed = m.flags.bayLocked === 1;
      m.ship.invuln = 5; // rules test: the pilot does not dodge
      stepMission(m, inp, DT);
      if (sealed && savedNow() > before) sealedSaves++;
    };
    const go = (p: Vec) => {
      for (let i = 0; i < 60 * 12 && m.status === 'playing' && Math.hypot(p.x - m.ship.x, p.y - m.ship.y) > 10; i++) {
        m.rocks = [];
        tick(steer(m, p));
      }
    };
    const hover = (sec: number) => {
      for (let i = 0; i < 60 * sec && m.status === 'playing'; i++) tick({ x: 0, y: 0 });
    };
    go(m.pods[0]);
    go(m.pods[1]);
    go(m.pods[2]);
    expect(m.pods.filter((p) => p.state === 'towed').length).toBe(TOW_MAX); // third pod not taken
    expect(m.pods[2].state).toBe('drifting');
    go(m.rescueZone!);
    hover(1); // wait in the bay while the trailing pod is pulled in
    expect(m.pods.filter((p) => p.state === 'saved').length).toBe(2);
    go(m.pods[2]);
    go(m.rescueZone!);
    hover(1);
    expect(m.pods.filter((p) => p.state === 'saved').length).toBe(3);
    // Phase 2: raiders close on the rescue ship and the bay seals.
    expect(m.flags.bayLocked).toBe(1);
    expect(m.drones.filter((d) => d.tag === 'boarders')).toHaveLength(3);
    // Shoot the boarders down (any that ram the ship are destroyed too).
    while (m.drones.some((d) => d.tag === 'boarders' && d.hp > 0) && m.realTime < 200) {
      m.ship.invuln = 5;
      m.rocks = [];
      const t = m.drones.find((d) => d.tag === 'boarders' && d.hp > 0 && d.spawnIn === 0) ?? null;
      if (!t) tick({ x: 0, y: 0 });
      else shootDown(m, () => t, () => t.hp <= 0, 6, false);
    }
    go(m.pods[3]);
    expect(m.flags.bayLocked).toBe(0);
    go(m.rescueZone!);
    hover(1);
    expect(m.pods[3].state).toBe('saved');
    go(m.pods[4]);
    go(m.rescueZone!);
    hover(1);
    expect(m.pods.every((p) => p.state === 'saved')).toBe(true);
    expect(sealedSaves).toBe(0);
    expect(m.status).toBe('won'); // docked: the ship is inside the bay
    expect(m.phasesDone).toEqual(['Recover the first survivors', 'Secure the rescue area', 'Recover the remaining survivors', 'Dock with the rescue ship']);
  });

  it('while raiders threaten the rescue ship the bay is sealed: a towed pod is held, not saved', () => {
    const m = make('rescue');
    m.drones = [];
    m.waves = [];
    m.rocks = [];
    // Bring three survivors home to trigger the raid.
    for (const p of m.pods.slice(0, 3)) p.state = 'saved';
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.def.phases[m.phase].id).toBe('secure');
    expect(m.flags.bayLocked).toBe(1);
    for (const d of m.drones) d.spawnIn = 999; // keep the raiders inert for this rules check
    const pod = m.pods[3];
    pod.state = 'towed';
    m.ship.x = m.rescueZone!.x;
    m.ship.y = m.rescueZone!.y;
    pod.x = m.ship.x;
    pod.y = m.ship.y + 10;
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(pod.state).toBe('towed');
    expect(m.status).toBe('playing');
  });

  it('life support runs out: a timeout fails the mission with a clear reason', () => {
    const m = make('rescue');
    m.drones = [];
    m.waves = [];
    for (let i = 0; i < 60 * 115 && m.status === 'playing'; i++) {
      m.rocks = [];
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/life support/i);
  });

  it('debris straight ahead breaks apart only when the player fires at it', () => {
    const m = make('rescue');
    m.drones = [];
    m.waves = [];
    const rock = m.rocks[0];
    m.rocks = [{ ...rock, x: m.ship.x, y: m.ship.y - 200, vx: 0, vy: 0, hp: 3 }];
    for (let i = 0; i < 90; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.rocks).toHaveLength(1); // nothing fires by itself
    expect(m.target).toBe(-2 - rock.id); // but it is in the line of fire
    for (let i = 0; i < 90; i++) stepMission(m, { x: 0, y: 0, fire: true }, DT);
    expect(m.rocks).toHaveLength(0);
  });

  it('the scanner locates pods within range; towing never fires at a pod', () => {
    const m = make('rescue');
    m.drones = [];
    m.waves = [];
    m.rocks = [];
    expect(m.pods.every((p) => !p.found)).toBe(true);
    const p = m.pods[0];
    m.ship.x = p.x;
    m.ship.y = p.y + 200;
    stepMission(m, { x: 0, y: -0.05, fire: true }, DT);
    expect(p.found).toBe(true);
    expect(m.events.some((e) => e.type === 'comms' && /located/i.test(e.text))).toBe(true);
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: -0.05, fire: true }, DT);
    expect(p.state).not.toBe('saved');
    expect(m.target).toBeNull(); // pods are never targets
  });
});

describe('Mission 09 · The Last Jump', () => {
  it('the jump drive charges over time; when full the Meridian jumps and the mission is won', () => {
    const m = make('last-jump');
    let peak = 0;
    while (m.status === 'playing' && m.realTime < 100) {
      escortPilot(m);
      peak = Math.max(peak, m.drones.length);
    }
    expect(m.status).toBe('won');
    expect(m.jump!.charge).toBe(m.jump!.duration);
    expect(peak).toBeGreaterThan(3); // real pressure throughout
  });

  it('if the capital ship is destroyed the mission fails', () => {
    const m = make('last-jump');
    m.allies[0].hp = 1;
    m.bullets.push({ id: 903, x: m.allies[0].x, y: m.allies[0].y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 2 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/Meridian was destroyed/);
  });
});

describe('power-ups, chains and skill bonuses', () => {
  it('a shield absorbs exactly one hit', () => {
    const m = make('first-contact');
    m.rocks = [];
    m.ship.invuln = 0;
    m.power.pickup = { kind: 'shield', x: m.ship.x, y: m.ship.y, life: 5 };
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.power.shield).toBe(true);
    m.rocks = [{ id: 99, x: m.ship.x, y: m.ship.y, vx: 0, vy: 0, r: 20, spin: 0 }];
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.ship.hp).toBe(m.def.maxHp);
    expect(m.power.shield).toBe(false);
    m.ship.invuln = 0;
    m.rocks = [{ id: 98, x: m.ship.x, y: m.ship.y, vx: 0, vy: 0, r: 20, spin: 0 }];
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.ship.hp).toBe(m.def.maxHp - 1);
  });

  it('overdrive doubles the fire rate for a limited time; repair restores one hull point', () => {
    const m = make('breach-protocol');
    m.power.pickup = { kind: 'overdrive', x: m.ship.x, y: m.ship.y, life: 5 };
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.power.overdrive).toBeGreaterThan(OVERDRIVE_TIME - 0.1);
    for (let i = 0; i < 60 * (OVERDRIVE_TIME + 0.2); i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.power.overdrive).toBe(0);
    const n = make('first-contact');
    n.ship.hp = 1;
    n.power.pickup = { kind: 'repair', x: n.ship.x, y: n.ship.y, life: 5 };
    stepMission(n, { x: 0, y: 0 }, DT);
    expect(n.ship.hp).toBe(2);
  });

  it('pickups appear occasionally and only when useful (no repair at full hull, no overdrive without weapons)', () => {
    const m = make('shattered-orbit'); // an unarmed navigation mission
    const kinds: string[] = [];
    for (let i = 0; i < 60 * 60 && m.status === 'playing'; i++) {
      m.ship.invuln = 5;
      stepMission(m, { x: 0, y: 0 }, DT);
      for (const e of m.events) if (e.type === 'power-spawn') kinds.push(e.kind);
    }
    expect(kinds.length).toBeGreaterThanOrEqual(1);
    expect(kinds.length).toBeLessThanOrEqual(4);
    expect(kinds.every((k) => k === 'shield')).toBe(true);
  });

  it('kill chains raise the multiplier up to x4 and reset after a pause', () => {
    expect(comboMult(1)).toBe(1);
    expect(comboMult(3)).toBe(2);
    expect(comboMult(20)).toBe(4);
    const m = make('breach-protocol');
    m.waves = [];
    m.drones = [];
    m.killsNeeded = 99;
    for (let k = 0; k < 3; k++) m.drones.push({ id: 500 + k, kind: 'scout', x: 500, y: 500, vx: 0, vy: 0, hp: 0, maxHp: 5, fireIn: 9, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.combo.count).toBe(3);
    expect(m.events.some((e) => e.type === 'combo')).toBe(true);
    for (let i = 0; i < 60 * 3; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.combo.count).toBe(0);
  });

  it('a near miss scores once per pass, not every frame', () => {
    const m = make('first-contact');
    m.ship.invuln = 0;
    m.rocks = [{ id: 77, x: m.ship.x + 13 + 20 + 8, y: m.ship.y, vx: 0, vy: 0, r: 20, spin: 0 }];
    for (let i = 0; i < 30; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.nearMisses).toBe(1);
  });

  it('Singularity: the black hole pulls a ship that does not fight it', () => {
    const m = make('guardian');
    m.ship.invuln = 99;
    const y0 = m.ship.y;
    for (let i = 0; i < 60; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.ship.y).toBeLessThan(y0 - 20);
  });
});
