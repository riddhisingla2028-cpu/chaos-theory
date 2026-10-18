import { describe, expect, it } from 'vitest';
import { encounterTotal, forceEncounter, planWave, validateEncounters, type EncounterDef } from './encounters';
import { MISSIONS, createMission, missionById, objectiveView, stepMission, type MissionDef, type MissionState, type Phase } from './sim';
import { DT, combatPilot } from './testkit';

// A bare test range built from a real mission: no walls, debris, pickups or friendly ships unless a
// test adds them, and only the encounters and phases the test supplies.
const base = missionById('breach-protocol');
const fight = (clear: string[], extra: Partial<Phase> = {}): Phase => ({ id: 'fight', title: 'Fight', view: () => ({ text: 'Fight', progress: 0, count: null }), done: () => true, clear, ...extra });
const after: Phase = { id: 'after', title: 'After', view: () => ({ text: 'After', progress: 0, count: null }), done: () => false };

function range(encounters: EncounterDef[], phases: Phase[] = [fight(['a']), after], build?: (m: MissionState) => void): MissionState {
  const def: MissionDef = {
    ...base,
    encounters,
    phases,
    build(m) {
      m.ship.x = 500;
      m.ship.y = 820;
      build?.(m);
    },
  };
  const m = createMission(def, 3);
  m.chrono.nextSpawn = Infinity;
  m.power.nextSpawn = Infinity;
  m.ship.invuln = 1e9;
  return m;
}

const step = (m: MissionState, n = 1) => {
  for (let i = 0; i < n && m.status === 'playing'; i++) {
    m.ship.invuln = 1e9;
    stepMission(m, { x: 0, y: 0 }, DT);
  }
};
const seconds = (m: MissionState, s: number) => step(m, Math.round(s * 60));
const st = (m: MissionState, id: string) => m.encounters.find((e) => e.id === id)!;
/** Destroy every enemy that has finished warping in. */
const killAll = (m: MissionState) => {
  for (const d of m.drones) if (d.spawnIn === 0) d.hp = 0;
};
const wing = (id: string, extra: Partial<EncounterDef> = {}): EncounterDef => ({
  id,
  name: `Wing ${id}`,
  trigger: { on: 'start' },
  // Turrets hold position, so they stay alive until a test destroys them (fliers would ram the ship).
  waves: [{ groups: [{ kind: 'turret', count: 3, formation: 'line', spacing: 120, at: { x: 500, y: 400 } }] }],
  ...extra,
});

describe('encounter scripts in the campaign', () => {
  it('every mission script passes validation (finite, reachable, no endless enemies)', () => {
    for (const def of MISSIONS) expect(validateEncounters(def), def.name).toEqual([]);
  });

  it('validation catches unsafe scripts', () => {
    const bad = (encounters: EncounterDef[], phases: Phase[] = [fight(['a']), after], arcade = false) => validateEncounters({ ...base, encounters, phases, arcade });
    const endless: EncounterDef = { id: 'a', name: 'A', trigger: { on: 'start' }, ambient: { budget: Infinity, every: 1, maxAlive: 3, kinds: ['raider'] } };
    expect(bad([endless]).join()).toMatch(/endless/);
    expect(bad([endless], [fight([]), after], true)).toEqual([]); // allowed in an arcade mode that does not wait on it
    expect(bad([wing('a'), wing('a')]).join()).toMatch(/duplicate/);
    expect(bad([wing('a', { trigger: { on: 'phase', phase: 'nope' } })]).join()).toMatch(/unknown phase/);
    expect(bad([wing('a', { until: 'fight' })]).join()).toMatch(/cancelled/);
    expect(bad([wing('b')]).join()).toMatch(/unknown encounter a/);
  });

  it('missions that used to spawn raids without end now send a fixed number of enemies', () => {
    // The most each script can ever send, optional and consequence encounters included. The Last Jump is
    // the longest stand in the campaign: 38 in its set waves plus a budget of 9 lone harassers.
    const ceiling = { 'alien-pursuit': 35, convoy: 35, 'last-jump': 47 } as const;
    for (const id of ['alien-pursuit', 'convoy', 'last-jump'] as const) {
      const def = missionById(id);
      const total = (def.encounters ?? []).reduce((n, e) => n + encounterTotal(e), 0);
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeGreaterThan(10);
      expect(total, id).toBeLessThanOrEqual(ceiling[id]);
    }
  });

  it('no mission spawns enemies outside its encounters, and no encounter sends more than its total', () => {
    for (const def of MISSIONS) {
      const m = createMission(def, 4);
      const seen = new Map<number, string | undefined>();
      for (let i = 0; i < 60 * 240 && m.status === 'playing'; i++) {
        combatPilot(m);
        for (const d of m.drones) if (!seen.has(d.id)) seen.set(d.id, d.enc ?? (d.kind === 'generator' ? 'generators' : undefined));
      }
      const byEnc = new Map<string | undefined, number>();
      for (const e of seen.values()) byEnc.set(e, (byEnc.get(e) ?? 0) + 1);
      expect(byEnc.has(undefined), `${def.name}: an enemy with no encounter`).toBe(false);
      for (const e of def.encounters ?? []) {
        const n = byEnc.get(e.id) ?? 0;
        // The hive carrier's brood belong to its encounter on top of the carrier itself.
        if (e.id !== 'hive') expect(n, `${def.name} / ${e.id}`).toBeLessThanOrEqual(encounterTotal(e));
      }
    }
  });
});

describe('finite waves', () => {
  it('a wave is announced, warps in with the right count and kinds, and the encounter clears when it is destroyed', () => {
    const m = range([
      {
        id: 'a',
        name: 'Strike group',
        trigger: { on: 'start', delay: 1 },
        warn: 1.5,
        callout: 'Strike group inbound!',
        waves: [
          {
            groups: [
              { kind: 'raider', count: 3, formation: 'vee', from: 'north', at: { x: 500, y: 400 } },
              { kind: 'gunner', count: 2, formation: 'line', from: 'east', at: { x: 700, y: 600 } },
            ],
          },
        ],
      },
    ]);
    expect(st(m, 'a').status).toBe('pending');
    seconds(m, 0.9);
    expect(m.drones).toHaveLength(0);
    let announced = 0;
    let callouts = 0;
    for (let i = 0; i < 30; i++) {
      step(m);
      announced += m.events.filter((e) => e.type === 'incoming').length;
      callouts += m.events.filter((e) => e.type === 'comms' && /strike group/i.test(e.text)).length;
    }
    expect(st(m, 'a').status).toBe('warning');
    expect(st(m, 'a').incoming).toHaveLength(5);
    expect(m.drones).toHaveLength(0); // nothing yet: only markers
    expect(announced).toBe(1);
    expect(callouts).toBe(1);
    expect(objectiveView(m).contact).toMatchObject({ name: 'Strike group', state: 'inbound', required: true });
    seconds(m, 1.5);
    expect(st(m, 'a').status).toBe('active');
    expect(m.drones.map((d) => d.kind).sort()).toEqual(['gunner', 'gunner', 'raider', 'raider', 'raider']);
    expect(m.drones.every((d) => d.enc === 'a')).toBe(true);
    seconds(m, 1);
    expect(objectiveView(m).contact).toMatchObject({ state: 'engaged', left: 5 });
    killAll(m);
    let cleared = 0;
    for (let i = 0; i < 5; i++) {
      step(m);
      cleared += m.events.filter((e) => e.type === 'encounter-clear').length;
    }
    expect(st(m, 'a').status).toBe('cleared');
    expect(cleared).toBe(1);
    expect(m.phasesDone).toEqual(['Fight']);
    seconds(m, 60);
    expect(m.drones).toHaveLength(0); // never respawns
  });

  it('groups enter from their edge in formation: off-screen, spread out, flying inwards', () => {
    const m = range([]);
    const plan = planWave(m, {
      groups: [
        { kind: 'raider', count: 3, formation: 'vee', from: 'north', at: { x: 500, y: 400 } },
        { kind: 'scout', count: 4, formation: 'line', from: 'west', at: { x: 500, y: 600 }, spacing: 60 },
        { kind: 'gunner', count: 4, formation: 'ring', at: { x: 500, y: 500 }, spacing: 300 },
      ],
    });
    const north = plan.slice(0, 3);
    const west = plan.slice(3, 7);
    const ring = plan.slice(7);
    expect(north.every((p) => p.y < m.camY && p.vy > 0)).toBe(true);
    expect(new Set(north.map((p) => p.x)).size).toBe(3);
    expect(north[0].y).toBeGreaterThan(north[1].y); // the leader flies ahead of its wings
    expect(west.every((p) => p.x < m.camX && p.vx > 0)).toBe(true);
    expect(new Set(west.map((p) => Math.round(p.y))).size).toBe(4);
    expect(ring.every((p) => Math.abs(Math.hypot(p.x - 500, p.y - 500) - 300) < 1 || Math.hypot(p.x - m.ship.x, p.y - m.ship.y) >= 149)).toBe(true);
    expect(plan.every((p) => Math.hypot(p.x - m.ship.x, p.y - m.ship.y) >= 149)).toBe(true); // never on top of the player
  });

  it('the next wave comes only after the previous one is destroyed, after its delay', () => {
    const m = range([
      {
        id: 'a',
        name: 'A',
        trigger: { on: 'start' },
        waves: [{ groups: [{ kind: 'turret', count: 2, spacing: 150, at: { x: 500, y: 300 } }] }, { delay: 2, groups: [{ kind: 'hive', count: 1, at: { x: 500, y: 300 } }] }],
      },
    ]);
    seconds(m, 10);
    expect(m.drones.map((d) => d.kind)).toEqual(['turret', 'turret']); // still the first wave
    killAll(m);
    seconds(m, 1.5);
    expect(m.drones).toHaveLength(0);
    seconds(m, 1);
    expect(m.drones.filter((d) => d.tag !== 'brood').map((d) => d.kind)).toEqual(['hive']);
    expect(st(m, 'a').status).toBe('active');
    expect(m.phase).toBe(0);
    seconds(m, 1);
    killAll(m);
    step(m, 3);
    expect(st(m, 'a').status).toBe('cleared');
    expect(m.phase).toBe(1);
  });
});

describe('triggers', () => {
  const pair = (trigger: EncounterDef['trigger']) => [wing('a', { trigger: { on: 'start', delay: 99 } }), wing('b', { trigger })];

  it('phase: starts when its phase begins', () => {
    const m = range(pair({ on: 'phase', phase: 'after' }), [fight([]), after]);
    expect(st(m, 'b').status).toBe('idle');
    step(m, 2); // 'fight' completes at once
    expect(m.phase).toBe(1);
    step(m);
    expect(st(m, 'b').status).not.toBe('idle');
  });

  it('cleared: starts when another encounter is cleared', () => {
    const m = range([wing('a'), wing('b', { trigger: { on: 'cleared', encounter: 'a' } })], [fight([]), after]);
    seconds(m, 2);
    expect(st(m, 'b').status).toBe('idle');
    killAll(m);
    step(m, 3);
    expect(st(m, 'a').status).toBe('cleared');
    expect(st(m, 'b').status).not.toBe('idle');
  });

  it('area: starts when the ship (or an escorted ship) enters the zone', () => {
    const m = range(pair({ on: 'area', x: 500, y: 300, r: 80 }), [fight([]), after]);
    seconds(m, 2);
    expect(st(m, 'b').status).toBe('idle');
    m.ship.y = 320;
    step(m);
    expect(st(m, 'b').status).not.toBe('idle');
  });

  it('flag and condition: start on mission state', () => {
    const m = range([wing('a', { trigger: { on: 'flag', flag: 'alarm' } }), wing('b', { trigger: { on: 'when', test: (x) => x.time > 3 } })], [fight([]), after]);
    seconds(m, 2);
    expect(st(m, 'a').status).toBe('idle');
    expect(st(m, 'b').status).toBe('idle');
    m.flags.alarm = 1;
    seconds(m, 1.5);
    expect(st(m, 'a').status).not.toBe('idle');
    expect(st(m, 'b').status).not.toBe('idle');
  });

  it('duplicate triggers never start an encounter twice', () => {
    const m = range([wing('a', { trigger: { on: 'flag', flag: 'alarm' } })], [fight([]), after]);
    m.flags.alarm = 1;
    seconds(m, 1);
    forceEncounter(m, 'a');
    m.flags.alarm = 0;
    step(m);
    m.flags.alarm = 1; // the condition comes back, again and again
    forceEncounter(m, 'a');
    seconds(m, 5);
    expect(m.drones).toHaveLength(3);
    expect(st(m, 'a').spawned).toBe(3);
    killAll(m);
    step(m, 3);
    forceEncounter(m, 'a');
    m.flags.alarm = 1;
    seconds(m, 5);
    expect(m.drones).toHaveLength(0);
  });
});

describe('encounters and phases', () => {
  it('a phase whose own goal is met waits for its encounter, and says why', () => {
    const m = range([wing('a')]);
    seconds(m, 2);
    expect(m.phase).toBe(0);
    expect(objectiveView(m).hold).toMatch(/clear the wing a/i);
    killAll(m);
    step(m, 3);
    expect(m.phase).toBe(1);
    expect(objectiveView(m).hold).toBeNull();
  });

  it('a phase cannot skip its fight: an encounter whose trigger never came starts when the phase is otherwise ready', () => {
    const m = range([wing('a', { trigger: { on: 'when', test: () => false } })]);
    step(m, 2);
    expect(st(m, 'a').status).not.toBe('idle');
    seconds(m, 1);
    expect(m.drones).toHaveLength(3);
    expect(m.phase).toBe(0);
    killAll(m);
    step(m, 3);
    expect(m.phase).toBe(1);
  });

  it('optional enemies never block a phase, and `until` stops them once their phase is over', () => {
    const m = range(
      [wing('a'), { id: 'ambient', name: 'Raiders', trigger: { on: 'start' }, until: 'fight', ambient: { budget: 20, every: 0.5, maxAlive: 2, kinds: ['scout'] } }],
      [fight(['a']), after],
    );
    seconds(m, 2);
    killAll(m); // destroy the required wing (and whatever ambient raiders are up)
    step(m, 3);
    expect(m.phase).toBe(1); // ambient raiders alive or not, the phase moved on
    const sent = st(m, 'ambient').spawned;
    seconds(m, 20);
    expect(st(m, 'ambient').spawned).toBe(sent); // nothing more after 'fight'
    killAll(m);
    step(m, 3);
    expect(st(m, 'ambient').status).toBe('cleared');
  });

  it('escorted ships hold at their waypoint until the phase’s encounters are cleared', () => {
    const m = range([wing('a', { trigger: { on: 'start', delay: 1 } })], [fight(['a'], { holdAllies: 1, done: (x) => x.allies[0].pathIdx >= 2 }), after], (x) => {
      x.allies = [
        {
          id: 900,
          kind: 'transport',
          name: 'Test Barge',
          x: 500,
          y: 900,
          hp: 99,
          maxHp: 99,
          r: 30,
          path: [
            { x: 500, y: 850 },
            { x: 500, y: 600 },
          ],
          pathIdx: 0,
          speed: 100,
          arrived: false,
          destroyed: false,
          hitFlash: 0,
        },
      ];
      x.alliesNeeded = 1;
    });
    const barge = m.allies[0];
    seconds(m, 6);
    expect(barge.pathIdx).toBe(1);
    expect(barge.y).toBe(850); // holding at the waypoint
    expect(objectiveView(m).hold).toMatch(/escort holding/i);
    for (const d of m.drones) d.hp = 0;
    seconds(m, 4);
    expect(barge.pathIdx).toBe(2);
    expect(m.phase).toBe(1);
  });
});

describe('ambient budgets', () => {
  it('a budget is a hard limit, with never more than maxAlive at once', () => {
    const m = range([{ id: 'a', name: 'A', trigger: { on: 'start' }, ambient: { budget: 7, every: 0.4, maxAlive: 3, kinds: ['raider', 'scout'] } }]);
    let peak = 0;
    for (let i = 0; i < 60 * 40; i++) {
      step(m);
      peak = Math.max(peak, m.drones.length);
      if (i % 120 === 0) killAll(m);
    }
    expect(peak).toBeLessThanOrEqual(3);
    expect(st(m, 'a').spawned).toBe(7);
    killAll(m);
    step(m, 3);
    expect(st(m, 'a').status).toBe('cleared');
    expect(m.phase).toBe(1);
  });

  it('an arcade mode may run endless, escalating waves (and only an arcade mode)', () => {
    const endless: EncounterDef = { id: 'a', name: 'Endless', trigger: { on: 'start' }, ambient: { budget: Infinity, every: 2, maxAlive: 50, kinds: ['scout'], escalate: 0.9, floor: 0.4 } };
    const m = range([endless], [fight([]), after]);
    seconds(m, 10);
    const early = st(m, 'a').spawned;
    seconds(m, 30);
    const late = st(m, 'a').spawned - early;
    expect(late / 30).toBeGreaterThan(early / 10); // it gets faster
    expect(st(m, 'a').ambientEvery).toBeGreaterThanOrEqual(0.4);
    expect(validateEncounters({ ...base, arcade: false, encounters: [endless], phases: [fight([]), after] }).join()).toMatch(/endless/);
  });
});

describe('end of mission and restart', () => {
  it('nothing spawns after the mission is lost or won', () => {
    const lost = range([wing('a', { trigger: { on: 'start', delay: 2 } })]);
    step(lost);
    lost.ship.invuln = 0;
    lost.ship.hp = 1;
    lost.rocks.push({ id: 999, x: lost.ship.x, y: lost.ship.y, vx: 0, vy: 0, r: 30, spin: 0 });
    stepMission(lost, { x: 0, y: 0 }, DT);
    expect(lost.status).toBe('lost');
    for (let i = 0; i < 300; i++) stepMission(lost, { x: 0, y: 0 }, DT);
    expect(lost.drones).toHaveLength(0);
    expect(lost.encounters[0].status).toBe('pending');

    const won = range([wing('a'), wing('late', { trigger: { on: 'start', delay: 5 } })], [fight(['a'])]);
    seconds(won, 2);
    killAll(won);
    step(won, 3);
    expect(won.status).toBe('won');
    for (let i = 0; i < 600; i++) stepMission(won, { x: 0, y: 0 }, DT);
    expect(won.drones).toHaveLength(0);
  });

  it('a restart starts every encounter from scratch, and the mission definitions are never changed by play', () => {
    for (const def of MISSIONS) {
      const before = JSON.stringify(def.encounters ?? []);
      const fresh = JSON.stringify(createMission(def, 2).encounters);
      const m = createMission(def, 2);
      for (let i = 0; i < 60 * 90 && m.status === 'playing'; i++) combatPilot(m);
      expect(JSON.stringify(def.encounters ?? [])).toBe(before);
      expect(JSON.stringify(createMission(def, 2).encounters)).toBe(fresh);
    }
  });

  it('a pause (no steps) freezes encounter timers; CHRONO SHIFT slows them like the rest of the world', () => {
    const m = range([wing('a', { trigger: { on: 'start', delay: 2 } })]);
    step(m, 30);
    const t = st(m, 'a').timer;
    // Paused: the UI stops stepping, so nothing moves on.
    expect(st(m, 'a').timer).toBe(t);
    m.chrono.active = 2;
    step(m, 30);
    expect(t - st(m, 'a').timer).toBeCloseTo(0.5 * 0.3, 2);
  });
});

describe('campaign encounters in play', () => {
  it('Alien Pursuit: an escaped commander brings a reprisal raid; a killed one does not', () => {
    const escaped = createMission(missionById('alien-pursuit'), 5);
    escaped.flags.cmdEscaped = 1;
    for (let i = 0; i < 60 * 6; i++) {
      escaped.ship.invuln = 99;
      stepMission(escaped, { x: 0, y: 0 }, DT);
    }
    expect(st(escaped, 'reprisal').status).not.toBe('idle');
    const killed = createMission(missionById('alien-pursuit'), 5);
    killed.flags.cmdKilled = 1;
    for (let i = 0; i < 60 * 6; i++) {
      killed.ship.invuln = 99;
      stepMission(killed, { x: 0, y: 0 }, DT);
    }
    expect(st(killed, 'reprisal').status).toBe('idle');
  });

  it('Alien Swarm: mopping up waits for the hive’s brood as well as the carrier', () => {
    const m = createMission(missionById('breach-protocol'), 5);
    while (m.status === 'playing' && m.def.phases[m.phase].id !== 'mop' && m.realTime < 200) combatPilot(m);
    expect(m.def.phases[m.phase]?.id ?? 'done').not.toBe('hive');
    while (m.status === 'playing' && m.realTime < 260) combatPilot(m);
    expect(m.status).toBe('won');
    expect(m.drones).toHaveLength(0);
  });

  it('every combat mission can be won by an attacking pilot (finite enemies, no stalls)', () => {
    for (const id of ['alien-pursuit', 'breach-protocol', 'convoy', 'last-jump'] as const) {
      const m = createMission(missionById(id), 7);
      while (m.status === 'playing' && m.realTime < 400) combatPilot(m);
      expect(m.status, `${id}: ${m.failReason ?? ''}`).toBe('won');
    }
  });
});

describe('P1 mission design', () => {
  const play = (m: MissionState, pred: () => boolean, maxT = 200) => {
    while (m.status === 'playing' && !pred() && m.realTime < maxT) combatPilot(m);
  };

  it('The Last Jump: assaults come at jump-charge marks, one at a time, not on the clock', () => {
    const m = createMission(missionById('last-jump'), 3);
    play(m, () => st(m, 'pincer').status !== 'idle');
    expect(st(m, 'probe').status).toBe('cleared'); // the pincer waits for the probe to be beaten
    expect(m.jump!.charge).toBeGreaterThanOrEqual(9);
    // Hold the charge below the next mark: the gunline never comes, however long it takes.
    const frozen = createMission(missionById('last-jump'), 3);
    for (let i = 0; i < 60 * 60; i++) {
      frozen.jump!.charge = Math.min(frozen.jump!.charge, 15);
      combatPilot(frozen);
    }
    expect(st(frozen, 'gunline').status).toBe('idle');
  });

  it('The Last Jump: a raider ram and a bomber hit on the drive cost charge; repeated disruption draws reinforcements', () => {
    const m = createMission(missionById('last-jump'), 3);
    for (const e of m.encounters) e.status = 'cancelled';
    m.jump!.charge = 30;
    const cap = m.allies[0];
    m.drones.push({ id: 900, kind: 'raider', x: cap.x, y: cap.y - cap.r, vx: 0, vy: 0, hp: 3, maxHp: 3, fireIn: 9, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: cap.id });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.jump!.charge).toBeCloseTo(30 - 3 + DT, 3);
    const before = m.jump!.charge;
    m.bullets.push({ id: 901, x: cap.x, y: cap.y - cap.r - 4, vx: 0, vy: 50, r: 9, from: 'enemy', life: 2, drive: true });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.jump!.charge).toBeCloseTo(before - 2 + DT, 3);
    // An ordinary gunner's shot hurts the hull but not the drive.
    const c2 = m.jump!.charge;
    m.bullets.push({ id: 902, x: cap.x, y: cap.y - cap.r - 4, vx: 0, vy: 50, r: 9, from: 'enemy', life: 2 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.jump!.charge).toBeCloseTo(c2 + DT, 3);
    // Reinforcements: once, after the fourth disruption.
    const fresh = createMission(missionById('last-jump'), 3);
    fresh.flags.disruptions = 3;
    for (let i = 0; i < 30; i++) stepMission(fresh, { x: 0, y: 0 }, DT);
    expect(st(fresh, 'reinforcements').status).toBe('idle');
    fresh.flags.disruptions = 4;
    stepMission(fresh, { x: 0, y: 0 }, DT);
    expect(st(fresh, 'reinforcements').status).not.toBe('idle');
    fresh.flags.disruptions = 9;
    for (let i = 0; i < 60 * 6; i++) {
      fresh.ship.invuln = 99;
      stepMission(fresh, { x: 0, y: 0 }, DT);
    }
    expect(st(fresh, 'reinforcements').spawned).toBe(4);
  });

  it('The Last Jump: the jump waits for the boarding run and final push, but not for the optional last gasp', () => {
    const def = missionById('last-jump');
    expect(def.phases.find((p) => p.id === 'jump')!.clear).toEqual(['breach', 'final-push']);
    const m = createMission(def, 3);
    for (const e of m.encounters) if (e.id !== 'last-gasp') e.status = 'cleared';
    m.phase = 2;
    m.jump!.charge = 64;
    for (let i = 0; i < 60 * 3; i++) {
      m.ship.invuln = 99;
      stepMission(m, { x: 0, y: 0 }, DT);
      if (st(m, 'last-gasp').status === 'active') break;
    }
    expect(m.drones.length).toBeGreaterThan(0); // the last gasp is in the air
    while (m.status === 'playing' && m.realTime < 30) {
      m.ship.invuln = 99;
      stepMission(m, { x: 0, y: 0 }, DT);
    }
    expect(m.status).toBe('won');
  });

  it('Alien Pursuit: the flank attack waits for the pursuers, and the Kestrel holds for the commander', () => {
    const m = createMission(missionById('alien-pursuit'), 3);
    play(m, () => st(m, 'flank').status !== 'idle');
    expect(st(m, 'pursuers').status).toBe('cleared');
    play(m, () => m.def.phases[m.phase].id === 'commander');
    // Leave the commander alone: the Kestrel goes no further than its last waypoint before the gate.
    const k = m.allies[0];
    for (let i = 0; i < 60 * 20 && m.def.phases[m.phase].id === 'commander'; i++) {
      m.ship.invuln = 99;
      stepMission(m, { x: 0, y: 0 }, DT);
      expect(k.pathIdx).toBeLessThanOrEqual(4);
    }
    // The raider screen arrives while the commander is alive (the choice: hunt it or guard the Kestrel).
    expect(st(m, 'screen').spawned).toBeGreaterThan(0);
  });

  it('Alien Swarm: a third wave surrounds the Aegis from every side', () => {
    const m = createMission(missionById('breach-protocol'), 3);
    play(m, () => st(m, 'swarm').wave === 2 && st(m, 'swarm').status === 'warning');
    const ring = st(m, 'swarm').incoming;
    expect(ring).toHaveLength(5);
    const angles = ring.map((p) => Math.atan2(p.y - 600, p.x - 500));
    const spread = Math.max(...angles) - Math.min(...angles);
    expect(spread).toBeGreaterThan(Math.PI); // not all from one side
  });

  it('a held escort whose fight has not been triggered starts that fight instead of waiting forever', () => {
    const m = createMission(missionById('convoy'), 3);
    for (const e of m.encounters) if (e.id !== 'final-raid') e.status = 'cleared';
    const fr = missionById('convoy').encounters!.find((e) => e.id === 'final-raid')!;
    // Pretend its trigger can never fire.
    const never = { ...missionById('convoy'), encounters: [...missionById('convoy').encounters!.filter((e) => e.id !== 'final-raid'), { ...fr, trigger: { on: 'when' as const, test: () => false } }] };
    const n = createMission(never, 3);
    for (const e of n.encounters) if (e.id !== 'final-raid') e.status = 'cleared';
    n.phase = 2; // deliver
    for (const a of n.allies) {
      a.pathIdx = 3;
      a.x = a.path[2].x;
      a.y = a.path[2].y;
    }
    for (let i = 0; i < 60 * 4; i++) {
      n.ship.invuln = 99;
      stepMission(n, { x: 0, y: 0 }, DT);
    }
    expect(st(n, 'final-raid').status).not.toBe('idle');
    while (n.status === 'playing' && n.realTime < 200) combatPilot(n);
    expect(n.status).toBe('won');
    expect(m.status).toBe('playing');
  });
});

describe('edge cases in the redesigned missions', () => {
  const idle = (m: MissionState, s: number) => {
    for (let i = 0; i < s * 60 && m.status === 'playing'; i++) {
      m.ship.invuln = 99;
      stepMission(m, { x: 0, y: 0 }, DT);
    }
  };

  it('the player dies while an assault is announced: the mission ends and the encounter never arrives', () => {
    const m = createMission(missionById('last-jump'), 1);
    while (m.status === 'playing' && st(m, 'pincer').status !== 'warning' && m.realTime < 60) combatPilot(m);
    expect(st(m, 'pincer').status).toBe('warning');
    m.ship.invuln = 0;
    m.ship.hp = 1;
    m.power.shield = false;
    m.rocks.push({ id: 9999, x: m.ship.x, y: m.ship.y, vx: 0, vy: 0, r: 30, spin: 0 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('lost');
    const n = m.drones.length;
    for (let i = 0; i < 600; i++) stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.drones).toHaveLength(n);
    expect(st(m, 'pincer').spawned).toBe(0);
  });

  it('The Convoy: losing one hauler is survivable and the raids go on; losing a second fails the mission', () => {
    const m = createMission(missionById('convoy'), 1);
    idle(m, 6);
    const [one, two] = m.allies;
    one.hp = 1;
    m.bullets.push({ id: 8001, x: one.x, y: one.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(one.destroyed).toBe(true);
    expect(m.status).toBe('playing');
    const sent = m.encounters.reduce((k, e) => k + e.spawned, 0);
    idle(m, 10);
    expect(m.encounters.reduce((k, e) => k + e.spawned, 0)).toBeGreaterThan(sent); // the operation carries on
    two.hp = 1;
    m.bullets.push({ id: 8002, x: two.x, y: two.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    stepMission(m, { x: 0, y: 0 }, DT);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/Hauler Two/);
  });

  it('optional enemies never block progress: a pilot who shoots only required enemies finishes every escort and defence', () => {
    for (const id of ['alien-pursuit', 'convoy', 'last-jump', 'breach-protocol'] as const) {
      const m = createMission(missionById(id), 2);
      for (const a of m.allies) a.hp = a.maxHp = 9999; // the escort survives being ignored; this checks progression only
      const optional = new Set(m.def.encounters!.filter((e) => !m.def.phases.some((p) => p.clear?.includes(e.id))).map((e) => e.id));
      while (m.status === 'playing' && m.realTime < 300) {
        m.ship.invuln = 5;
        const req = m.drones.filter((d) => d.spawnIn === 0 && !optional.has(d.enc ?? ''));
        const t = req.sort((a, b) => Math.hypot(a.x - m.ship.x, a.y - m.ship.y) - Math.hypot(b.x - m.ship.x, b.y - m.ship.y))[0];
        if (!t) stepMission(m, { x: 0, y: 0 }, DT);
        else {
          const dx = t.x - m.ship.x;
          const dy = t.y - m.ship.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = d > 200 ? 1 : 0.07;
          stepMission(m, { x: (dx / d) * k, y: (dy / d) * k, fire: m.target === t.id }, DT);
        }
      }
      expect(m.status, id).toBe('won');
    }
  });

  it('a long pause does not make encounters catch up: the first frame after resuming advances at most 0.05 s', () => {
    const m = createMission(missionById('last-jump'), 2);
    idle(m, 3);
    const t = st(m, 'probe').timer;
    expect(st(m, 'probe').status).toBe('warning');
    stepMission(m, { x: 0, y: 0 }, 30);
    expect(st(m, 'probe').status).toBe('warning');
    expect(t - st(m, 'probe').timer).toBeCloseTo(0.05, 5);
  });

  it('a restart in the middle of a warned wave starts the mission from scratch', () => {
    const def = missionById('breach-protocol');
    const pristine = JSON.stringify(createMission(def, 4).encounters);
    const m = createMission(def, 4);
    idle(m, 2);
    expect(st(m, 'swarm').status).toBe('warning');
    expect(JSON.stringify(createMission(def, 4).encounters)).toBe(pristine);
  });
});
