import { describe, expect, it } from 'vitest';
import { MISSIONS, createMission, missionById, objectiveView, secondariesMet, stepMission, type MissionId, type MissionState } from './sim';
import { DT, attackStep, calm, combatPilot, flyTo, hold, shootDown } from './testkit';

const make = (id: MissionId, seed = 5) => createMission(missionById(id), seed);
const phaseId = (m: MissionState) => m.def.phases[Math.min(m.phase, m.def.phases.length - 1)].id;

describe('operation structure', () => {
  it('every mission is a sequence of at least two phases, with the HUD showing phase n of N', () => {
    for (const def of MISSIONS) {
      expect(def.phases.length).toBeGreaterThanOrEqual(2);
      const m = createMission(def, 1);
      const v = objectiveView(m);
      expect(v.phase).toBe(1);
      expect(v.phases).toBe(def.phases.length);
      expect(v.title).toBe(def.phases[0].title);
      expect(v.text.length).toBeGreaterThan(5);
    }
  });

  it('a completed phase announces itself and the next one; no phase completes on its own', () => {
    const m = make('meltdown');
    for (let i = 0; i < 60 * 5; i++) {
      calm(m);
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.phase).toBe(0); // idling achieves nothing
    for (const r of [{ x: 500, y: 640 }, { x: 170, y: 250 }, { x: 830, y: 250 }]) {
      flyTo(m, r);
      hold(m, 2.4);
    }
    expect(m.phasesDone).toEqual(['Stabilise the reactors']);
    expect(phaseId(m)).toBe('extract');
  });
});

describe('02 · Alien Pursuit: the command raider', () => {
  const toCommander = (m: MissionState) => {
    while (m.status === 'playing' && m.phase === 0 && m.realTime < 120) combatPilot(m);
    expect(phaseId(m)).toBe('commander');
    stepMission(m, { x: 0, y: 0 }, DT); // the commander warps in on the next step
  };

  it('appears after the first leg; if ignored it escapes off the map, the optional objective fails and the escort goes on', () => {
    const m = make('alien-pursuit');
    toCommander(m);
    const cmd = m.drones.find((d) => d.kind === 'commander')!;
    expect(cmd).toBeDefined();
    expect(objectiveView(m).timer?.label).toMatch(/escape/i);
    // Defend the Kestrel from raiders but leave the commander alone (never fire with it in the sights).
    while (m.status === 'playing' && m.phase === 1 && m.realTime < 200) {
      m.ship.invuln = 5;
      const k = m.allies[0];
      const threat = m.drones
        .filter((d) => d.kind !== 'commander' && d.spawnIn === 0 && d.hp > 0)
        .sort((p, q) => Math.hypot(p.x - k.x, p.y - k.y) - Math.hypot(q.x - k.x, q.y - k.y))[0];
      if (threat) attackStep(m, threat, 200, threat.id);
      else {
        const dx = k.x - m.ship.x;
        const dy = k.y + 100 - m.ship.y;
        const d = Math.hypot(dx, dy);
        stepMission(m, d > 20 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }, DT);
      }
    }
    expect(m.flags.cmdEscaped).toBe(1);
    expect(m.flags.cmdKilled).toBeUndefined();
    expect(m.status).not.toBe('lost'); // escaping is not a mission failure
    expect(m.phasesDone).toContain('Intercept the command raider');
    while (m.status === 'playing' && m.realTime < 300) combatPilot(m);
    expect(m.status).toBe('won');
    expect(secondariesMet(m)[1]).toBe(false);
  });

  it('shot down before it escapes: the optional objective is met', () => {
    const m = make('alien-pursuit');
    toCommander(m);
    const cmd = m.drones.find((d) => d.kind === 'commander')!;
    m.ship.invuln = 99;
    shootDown(m, () => (cmd.hp > 0 ? cmd : null), () => cmd.hp <= 0, 40, false);
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.flags.cmdKilled).toBe(1);
    expect(phaseId(m)).toBe('gate');
    while (m.status === 'playing' && m.realTime < 300) combatPilot(m);
    expect(m.status).toBe('won');
    expect(secondariesMet(m)[1]).toBe(true);
  });
});

describe('05 · Orbital Collapse: blast doors', () => {
  it('a door blocks the ship until its switch is held; leaving the switch drains its charge', () => {
    const m = make('collapse');
    m.collapseY = null; // freeze the collapse for this rules check
    flyTo(m, { x: 380, y: 1900 });
    flyTo(m, { x: 380, y: 1700 });
    flyTo(m, { x: 620, y: 1150 }, { maxT: 3 });
    expect(m.ship.y).toBeGreaterThan(1250); // stopped by door A
    flyTo(m, { x: 620, y: 1380 });
    hold(m, 0.4);
    const half = m.switches[0].charge;
    expect(half).toBeGreaterThan(0.3);
    flyTo(m, { x: 800, y: 1450 });
    hold(m, 0.5);
    expect(m.switches[0].charge).toBeLessThan(half);
    expect(m.switches[0].active).toBe(false);
    flyTo(m, { x: 620, y: 1380 });
    hold(m, 0.9);
    expect(m.switches[0].active).toBe(true);
    expect(m.events.some((e) => e.type === 'comms') || m.phase === 1).toBe(true);
    flyTo(m, { x: 620, y: 1150 });
    expect(m.ship.y).toBeLessThan(1200); // through the open door
  });
});

describe('06 · Reactor Meltdown: core stability', () => {
  it('falls over time, rises when a reactor comes online, and falls faster while turrets live', () => {
    const a = make('meltdown');
    const b = make('meltdown');
    b.drones = b.drones.filter((d) => d.kind !== 'turret'); // turrets destroyed
    for (let i = 0; i < 60 * 5; i++) {
      calm(a);
      calm(b);
      stepMission(a, { x: 0, y: 0 }, DT);
      stepMission(b, { x: 0, y: 0 }, DT);
    }
    expect(a.stability!).toBeLessThan(100);
    expect(b.stability!).toBeGreaterThan(a.stability!);
    flyTo(a, { x: 500, y: 640 });
    const before = a.stability!;
    hold(a, 2.4);
    expect(a.reactors[2].active).toBe(true);
    expect(a.stability!).toBeGreaterThan(before - 6 + 12 - 1);
    expect(objectiveView(a).timer?.label).toMatch(/stability/i);
  });

  it('warns when critical and fails the mission at zero', () => {
    const m = make('meltdown');
    let warned = false;
    for (let i = 0; i < 60 * 80 && m.status === 'playing'; i++) {
      calm(m);
      stepMission(m, { x: 0, y: 0 }, DT);
      if (m.events.some((e) => e.type === 'comms' && /critical/i.test(e.text))) warned = true;
    }
    expect(warned).toBe(true);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/critical/);
  });
});

describe('07 · Alien Swarm: the hive carrier', () => {
  it('launches raiders at the frigate while it lives', () => {
    const m = make('breach-protocol');
    m.encounters.find((e) => e.id === 'swarm')!.status = 'cleared'; // the line has held
    m.drones = [];
    for (let i = 0; i < 45; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(phaseId(m)).toBe('hive');
    for (let i = 0; i < 60 * 3 && !m.drones.some((d) => d.kind === 'hive'); i++) stepMission(m, { x: 0, y: 0 }, DT); // it warps in after its warning
    const launched = new Set<number>();
    let allAtFrigate = true;
    for (let i = 0; i < 60 * 8; i++) {
      m.ship.invuln = 99;
      stepMission(m, { x: 0, y: 0 }, DT);
      for (const d of m.drones.filter((x) => x.tag === 'brood')) {
        launched.add(d.id);
        if (d.targetAlly !== m.allies[0].id) allAtFrigate = false;
      }
    }
    expect(launched.size).toBeGreaterThanOrEqual(2);
    expect(allAtFrigate).toBe(true);
  });
});

describe('08 · The Convoy: ambush', () => {
  it('gunships ambush the convoy at the checkpoint; delivery waits until the ambush is broken', () => {
    const m = make('convoy');
    while (m.status === 'playing' && m.phase === 0 && m.realTime < 120) combatPilot(m);
    expect(phaseId(m)).toBe('ambush');
    // Announced first (incoming markers), then the gunships warp in ahead of the convoy.
    const amb = m.encounters.find((e) => e.id === 'ambush')!;
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(amb.status).toBe('warning');
    expect(amb.incoming).toHaveLength(3);
    while (amb.status === 'warning') stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.drones.filter((d) => d.tag === 'ambush')).toHaveLength(3);
    while (m.status === 'playing' && m.realTime < 260) combatPilot(m);
    expect(m.status).toBe('won');
    expect(m.phasesDone).toEqual(['Escort the convoy to the checkpoint', 'Break the ambush', 'Deliver the convoy']);
  });
});

describe('09 · The Last Jump: drive disruption and the bomber wing', () => {
  it('a raider slamming into the Meridian knocks the jump charge back', () => {
    const m = make('last-jump');
    m.jump!.charge = 20;
    m.drones = [];
    const cap = m.allies[0];
    m.drones.push({ id: 900, kind: 'raider', x: cap.x, y: cap.y - cap.r, vx: 0, vy: 0, hp: 3, maxHp: 3, fireIn: 9, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: cap.id });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.jump!.charge).toBeLessThan(19);
  });

  it('a full drive does not jump while the bombers live', () => {
    const m = make('last-jump');
    for (const e of m.encounters) if (e.id !== 'bombers') e.status = 'cancelled'; // only the bomber wing flies
    m.drones = [];
    m.jump!.charge = m.jump!.duration / 2;
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(phaseId(m)).toBe('bombers');
    for (let i = 0; i < 60 * 4 && m.drones.filter((d) => d.tag === 'bombers').length < 3; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.drones.filter((d) => d.tag === 'bombers')).toHaveLength(3);
    for (const d of m.drones) d.spawnIn = 999; // keep them inert
    m.jump!.charge = m.jump!.duration;
    for (let i = 0; i < 120; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('playing');
    for (const d of m.drones) d.spawnIn = 0;
    while (m.status === 'playing' && m.realTime < 120) combatPilot(m);
    expect(m.status).toBe('won');
  });
});

describe('restart and replay leave no stale state', () => {
  // Functions (rng, phase hooks) are dropped by JSON; everything else must match a never-played start.
  const snapshot = (m: MissionState) => JSON.stringify({ ...m, rng: undefined });

  for (const def of MISSIONS) {
    it(`${def.code} ${def.name}: a fresh start after a played-out run equals a never-played start`, () => {
      const pristine = snapshot(createMission(def, 9));
      // Play it out: fly, fire, take hits, until the mission ends (lost or won) or 120s pass.
      const m = createMission(def, 9);
      for (let i = 0; i < 60 * 120 && m.status === 'playing'; i++) {
        m.ship.invuln = 0;
        if (i % 30 === 0) m.rocks.push({ id: 5000 + i, x: m.ship.x, y: m.ship.y, vx: 0, vy: 0, r: 20, spin: 0 });
        stepMission(m, { x: Math.sin(i / 50), y: -0.6, fire: true, assist: true }, DT);
      }
      expect(m.status).not.toBe('playing');
      const again = createMission(def, 9);
      expect(snapshot(again)).toBe(pristine);
      expect(again.phase).toBe(0);
      expect(again.bullets).toHaveLength(0);
      expect(again.switches.every((s) => !s.active)).toBe(true);
      expect(again.pods.every((p) => !p.found && p.state === 'drifting')).toBe(true);
    });
  }
});
