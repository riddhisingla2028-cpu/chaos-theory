import { describe, expect, it } from 'vitest';
import { OVERDRIVE_TIME, TOW_MAX, comboMult, createMission, missionById, objectiveView, secondariesMet, stepMission, type MissionId, type MissionState, type Vec } from './sim';

const DT = 1 / 60;
const make = (id: MissionId, seed = 11) => createMission(missionById(id), seed);

function steer(m: MissionState, t: Vec): { x: number; y: number } {
  const dx = t.x - m.ship.x;
  const dy = t.y - m.ship.y;
  const d = Math.hypot(dx, dy) || 1;
  return d < 6 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
}

/** A scripted escort pilot: invulnerable (to test the rules, not the pilot), hunts whatever is closest to a friendly ship. */
function escortPilot(m: MissionState): { x: number; y: number } {
  m.ship.invuln = 5;
  const living = m.allies.filter((a) => !a.destroyed);
  const guard = living[0] ?? m.ship;
  const threat = m.drones
    .filter((d) => d.spawnIn === 0)
    .sort((a, b) => Math.min(...living.map((l) => Math.hypot(a.x - l.x, a.y - l.y))) - Math.min(...living.map((l) => Math.hypot(b.x - l.x, b.y - l.y))))[0];
  if (threat) {
    const d = Math.hypot(threat.x - m.ship.x, threat.y - m.ship.y);
    return d > 220 ? steer(m, threat) : steer(m, { x: guard.x + 80, y: guard.y + 60 });
  }
  return steer(m, { x: guard.x, y: guard.y + 90 });
}

describe('Mission 02 · Alien Pursuit (escort)', () => {
  it('the transport flies its route; raiders target it; the mission is won when it reaches the gate', () => {
    const m = make('alien-pursuit');
    const t = m.allies[0];
    const y0 = t.y;
    let raidersOnTransport = 0;
    while (m.status === 'playing' && m.realTime < 120) {
      stepMission(m, escortPilot(m), DT);
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
    while (m.status === 'playing' && m.realTime < 140) stepMission(m, escortPilot(m), DT);
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
    const go = (p: Vec) => {
      for (let i = 0; i < 60 * 12 && m.status === 'playing' && Math.hypot(p.x - m.ship.x, p.y - m.ship.y) > 10; i++) {
        m.rocks = [];
        stepMission(m, steer(m, p), DT);
      }
    };
    const hover = (sec: number) => {
      for (let i = 0; i < 60 * sec && m.status === 'playing'; i++) stepMission(m, { x: 0, y: 0 }, DT);
    };
    go(m.pods[0]);
    go(m.pods[1]);
    go(m.pods[2]);
    expect(m.pods.filter((p) => p.state === 'towed').length).toBe(TOW_MAX); // third pod not taken
    expect(m.pods[2].state).toBe('drifting');
    go(m.rescueZone!);
    hover(1); // wait in the bay while the trailing pod is pulled in
    expect(m.pods.filter((p) => p.state === 'saved').length).toBe(2);
    for (const i of [2, 3]) go(m.pods[i]);
    go(m.rescueZone!);
    hover(1);
    go(m.pods[4]);
    go(m.rescueZone!);
    hover(1);
    expect(m.pods.every((p) => p.state === 'saved')).toBe(true);
    expect(m.status).toBe('won');
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

  it('the blaster breaks up debris when no enemies are near', () => {
    const m = make('rescue');
    m.drones = [];
    m.waves = [];
    const rock = m.rocks[0];
    m.rocks = [{ ...rock, x: m.ship.x, y: m.ship.y - 200, vx: 0, vy: 0, hp: 3 }];
    for (let i = 0; i < 90; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.rocks).toHaveLength(0);
  });
});

describe('Mission 09 · The Last Jump', () => {
  it('the jump drive charges over time; when full the Meridian jumps and the mission is won', () => {
    const m = make('last-jump');
    let peak = 0;
    while (m.status === 'playing' && m.realTime < 100) {
      stepMission(m, escortPilot(m), DT);
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
    const m = make('first-contact');
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
