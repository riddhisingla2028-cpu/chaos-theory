import { describe, expect, it } from 'vitest';
import { encounterTotal, groupCount, validateEncounters } from './encounters';
import { COOP_MISSIONS, HEAVY_TOW, MISSIONS, REGEN_DELAY, REVIVE_TIME, TL_STRIKE_WINDOW, UPLINK_TIME, carrierOf, coopMissionById, createMission, objectiveView, stepMission, type MissionInput, type MissionState } from './sim';
import { DT, coopSquad } from './testkit';

// Op. Twin Lock (P2.2): the co-op operation and its teamwork objectives.

const def = coopMissionById('twin-lock');
const idle = (n: number): MissionInput[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));
const phaseId = (m: MissionState) => m.def.phases[Math.min(m.phase, m.def.phases.length - 1)].id;
const st = (m: MissionState, id: string) => m.encounters.find((e) => e.id === id)!;
/** A quiet operation: no enemies (the encounters are switched off), pilots invulnerable unless a test says otherwise. */
function quiet(n: number, seed = 1): MissionState {
  const m = createMission(def, seed, n);
  for (const e of m.encounters) e.status = 'cancelled';
  return m;
}
const hold = (m: MissionState, seconds: number, inputs?: MissionInput[]) => {
  for (let i = 0; i < seconds * 60 && m.status === 'playing'; i++) {
    for (const p of m.ships) p.invuln = 5;
    stepMission(m, inputs ?? idle(m.ships.length), DT);
  }
};
const place = (m: MissionState, slot: number, x: number, y: number) => {
  m.ships[slot].x = x;
  m.ships[slot].y = y;
  m.ships[slot].vx = 0;
  m.ships[slot].vy = 0;
};
/** Skip to a phase with its objectives met by hand (setup only; the phase under test is then played for real). */
function toPhase(m: MissionState, id: string): void {
  if (id === 'uplinks') return;
  m.uplink!.charge = 1;
  m.uplink!.active = true;
  hold(m, 0.1);
  if (id === 'core') return;
  const core = m.pods.find((p) => p.heavy)!;
  core.state = 'saved';
  for (const e of m.encounters) if (e.id.startsWith('core-raid')) e.status = 'cleared';
  hold(m, 0.1);
}

describe('Op. Twin Lock: the co-op operation', () => {
  it('is a separate co-op list (not in the solo campaign) for 2-4 pilots, with a sound encounter script', () => {
    expect(COOP_MISSIONS.map((d) => d.id)).toEqual(['twin-lock']);
    expect(MISSIONS.some((d) => (d.id as string) === 'twin-lock')).toBe(false);
    expect(def.coop).toEqual({ min: 2, max: 4 });
    expect(validateEncounters(def)).toEqual([]);
    expect(def.phases.map((p) => p.title)).toEqual(['Lock both uplinks', 'Escort the data core', 'Synchronised strike', 'Extract together']);
  });

  it('a scripted squadron of 2, 3 or 4 pilots completes it (rules check: invulnerable pilots)', () => {
    for (const n of [2, 3, 4]) {
      const m = createMission(def, 1, n);
      while (m.status === 'playing' && m.realTime < 300) {
        for (const p of m.ships) p.invuln = 5;
        stepMission(m, coopSquad(m), DT);
      }
      expect(m.status, `${n} pilots`).toBe('won');
      expect(m.phasesDone).toEqual(['Lock both uplinks', 'Escort the data core', 'Synchronised strike', 'Extract together']);
      expect(m.ships.reduce((k, p) => k + p.stats.kills, 0)).toBe(m.kills);
      expect(m.ships.every((p) => p.stats.objectiveTime > 0 || p.stats.kills > 0)).toBe(true); // everyone contributed
    }
  });

  it('enemy groups grow with the squadron; solo missions are untouched by pilot count', () => {
    const total = (n: number) => createMission(def, 1, n).encounters.reduce((k, e) => k + e.total, 0);
    expect(total(3)).toBeGreaterThan(total(2));
    expect(total(4)).toBeGreaterThan(total(3));
    expect(groupCount({ kind: 'raider', count: 3, at: { x: 0, y: 0 }, extraPerPilot: 1 }, 4)).toBe(5);
    expect(groupCount({ kind: 'raider', count: 3, at: { x: 0, y: 0 }, extraPerPilot: 1 }, 2)).toBe(3);
    for (const d of MISSIONS) for (const e of d.encounters ?? []) expect(encounterTotal(e, 4)).toBe(encounterTotal(e, 1));
    // A scaled wave really sends the extra enemies.
    const m4 = createMission(def, 1, 4);
    const m2 = createMission(def, 1, 2);
    for (const m of [m2, m4]) hold(m, 6);
    expect(st(m4, 'pad-raid').spawned).toBeGreaterThan(st(m2, 'pad-raid').spawned);
  });
});

describe('teamwork 1: the uplinks charge only while both are held at once', () => {
  const pads = () => quiet(2).uplink!.pads;

  it('one pilot alone (or two on the same pad) never charges them', () => {
    const [a] = pads()!;
    const solo = quiet(1);
    place(solo, 0, a.x, a.y);
    hold(solo, UPLINK_TIME * 3);
    expect(solo.uplink!.charge).toBe(0);
    expect(phaseId(solo)).toBe('uplinks');
    const same = quiet(2);
    place(same, 0, a.x, a.y);
    place(same, 1, a.x + 10, a.y);
    hold(same, UPLINK_TIME * 3);
    expect(same.uplink!.charge).toBe(0);
    expect(objectiveView(same).count).toBe('1/2 held');
  });

  it('two pilots holding both pads lock them in UPLINK_TIME; leaving one drains the link', () => {
    const [a, b] = pads()!;
    const m = quiet(2);
    place(m, 0, a.x, a.y);
    place(m, 1, b.x, b.y);
    hold(m, UPLINK_TIME / 2);
    const half = m.uplink!.charge;
    expect(half).toBeCloseTo(0.5, 1);
    place(m, 1, b.x - 200, b.y);
    hold(m, 1);
    expect(m.uplink!.charge).toBeLessThan(half);
    place(m, 1, b.x, b.y);
    hold(m, UPLINK_TIME);
    expect(m.uplink!.active).toBe(true);
    expect(phaseId(m)).toBe('core');
    expect(m.ships[0].stats.objectiveTime).toBeGreaterThan(UPLINK_TIME);
    expect(m.ships[1].stats.objectiveTime).toBeGreaterThan(UPLINK_TIME);
  });

  it('a downed pilot on a pad does not hold it', () => {
    const [a, b] = pads()!;
    const m = quiet(2);
    place(m, 0, a.x, a.y);
    place(m, 1, b.x, b.y);
    m.ships[1].downed = true;
    hold(m, UPLINK_TIME);
    expect(m.uplink!.charge).toBe(0);
  });
});

describe('teamwork 2: the data core carrier is slow and unarmed, and the raids hunt them', () => {
  it('the carrier flies at HEAVY_TOW speed and cannot fire while the escort can', () => {
    const m = quiet(2);
    toPhase(m, 'core');
    const core = m.pods.find((p) => p.heavy)!;
    place(m, 0, core.x, core.y + 10);
    hold(m, 0.1);
    expect(carrierOf(m)).toBe(m.ships[0]);
    // Full stick north for a second: the carrier is slow, the escort is not.
    place(m, 1, core.x + 150, core.y);
    hold(m, 1, [{ x: 0, y: -1 }, { x: 0, y: -1 }]);
    expect(Math.abs(m.ships[0].vy)).toBeCloseTo(400 * HEAVY_TOW, -1);
    expect(Math.abs(m.ships[1].vy)).toBeGreaterThan(390);
    // A target straight ahead of both: only the escort's blaster fires.
    for (const p of m.ships) p.angle = -Math.PI / 2;
    m.drones.push({ id: 900, kind: 'turret', x: m.ships[0].x, y: m.ships[0].y - 250, vx: 0, vy: 0, hp: 50, maxHp: 50, fireIn: 999, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null });
    m.drones.push({ id: 901, kind: 'turret', x: m.ships[1].x, y: m.ships[1].y - 250, vx: 0, vy: 0, hp: 50, maxHp: 50, fireIn: 999, aim: 0, hitFlash: 0, spawnIn: 0, targetAlly: null });
    hold(m, 1, [{ x: 0, y: 0, fire: true }, { x: 0, y: 0, fire: true }]);
    expect(m.ships[0].stats.shots).toBe(0);
    expect(m.ships[0].aimTarget).toBeNull();
    expect(m.ships[1].stats.shots).toBeGreaterThan(3);
  });

  it('picking the core up starts the raid, and the raiders go for the carrier, not the nearest pilot', () => {
    const m = createMission(def, 1, 2);
    toPhase(m, 'core');
    for (const e of m.encounters) if (e.id !== 'core-raid-1') e.status = 'cancelled';
    m.drones = [];
    expect(st(m, 'core-raid-1').status).toBe('idle');
    const core = m.pods.find((p) => p.heavy)!;
    place(m, 0, core.x, core.y + 10);
    place(m, 1, core.x, core.y - 250); // the escort is closer to where the raid comes from
    hold(m, 0.2);
    expect(m.flags.coreTowed).toBe(1);
    hold(m, 5);
    const raiders = m.drones.filter((d) => d.hunt === 'carrier' && d.spawnIn === 0);
    expect(raiders.length).toBeGreaterThan(0);
    const before = raiders.map((d) => Math.hypot(d.x - m.ships[0].x, d.y - m.ships[0].y));
    hold(m, 0.5);
    const after = raiders.filter((d) => d.hp > 0).map((d) => Math.hypot(d.x - m.ships[0].x, d.y - m.ships[0].y));
    expect(after.length ? Math.min(...after) : 0).toBeLessThan(Math.min(...before));
  });

  it('a downed carrier drops the core; a teammate can pick it up; delivery waits for the raids', () => {
    const m = quiet(2);
    toPhase(m, 'core');
    const core = m.pods.find((p) => p.heavy)!;
    place(m, 0, core.x, core.y + 10);
    hold(m, 0.1);
    const carrier = m.ships[0];
    carrier.invuln = 0;
    carrier.hp = 1;
    m.bullets.push({ id: 950, x: carrier.x, y: carrier.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    stepMission(m, idle(2), DT);
    expect(carrier.downed).toBe(true);
    expect(core.state).toBe('drifting');
    expect(carrierOf(m)).toBeNull();
    place(m, 1, core.x + 5, core.y);
    hold(m, 0.1);
    expect(carrierOf(m)).toBe(m.ships[1]);
    // Deliver it with the raids never having started: the phase still makes them happen first.
    const n = createMission(def, 1, 2);
    toPhase(n, 'core');
    const c2 = n.pods.find((p) => p.heavy)!;
    c2.state = 'saved';
    hold(n, 1);
    expect(phaseId(n)).toBe('core');
    expect(n.encounters.filter((e) => e.id.startsWith('core-raid')).some((e) => e.status !== 'idle')).toBe(true);
  });
});

describe('teamwork 3: the synchronised strike', () => {
  const gens = (m: MissionState) => m.drones.filter((d) => d.tag === 'sync').sort((a, b) => a.x - b.x);

  it('three generators go up; one destroyed alone reboots once the window closes', () => {
    const m = quiet(2);
    toPhase(m, 'strike');
    expect(phaseId(m)).toBe('strike');
    hold(m, 1); // warp in
    expect(gens(m)).toHaveLength(3);
    gens(m)[0].hp = 0;
    hold(m, 0.1);
    expect(gens(m)).toHaveLength(2);
    expect(m.linked!.firstAt).not.toBeNull();
    let rebooted = 0;
    for (let i = 0; i < (TL_STRIKE_WINDOW + 0.5) * 60; i++) {
      for (const p of m.ships) p.invuln = 5;
      stepMission(m, idle(2), DT);
      rebooted += m.events.filter((e) => e.type === 'linked-reboot').length;
    }
    expect(rebooted).toBe(1);
    hold(m, 1);
    expect(gens(m)).toHaveLength(3);
    expect(gens(m).every((g) => g.hp === g.maxHp)).toBe(true);
    expect(phaseId(m)).toBe('strike');
  });

  it('all three down inside the window completes the strike and opens the portal (worth points once, not per generator)', () => {
    const m = quiet(2);
    toPhase(m, 'strike');
    hold(m, 1);
    const killsBefore = m.kills;
    const scoreBefore = m.score;
    gens(m)[0].hp = 0;
    hold(m, 1);
    gens(m)[0].hp = 0;
    hold(m, 1);
    gens(m)[0].hp = 0;
    hold(m, 0.1);
    expect(m.linked!.done).toBe(true);
    expect(m.portal!.open).toBe(true);
    expect(phaseId(m)).toBe('extract');
    expect(m.kills).toBe(killsBefore); // objective structures, not kills
    expect(m.score - scoreBefore).toBeGreaterThanOrEqual(1200);
  });

  it('a damaged generator’s shield recharges, so one pilot cannot wear them down one by one', () => {
    const m = quiet(2);
    toPhase(m, 'strike');
    hold(m, 1);
    const g = gens(m)[1];
    g.hp = 2;
    g.lastHitAt = m.time;
    hold(m, REGEN_DELAY - 0.2);
    expect(g.hp).toBe(2); // not yet
    hold(m, 0.2 + (g.maxHp - 2) / (g.regen ?? 1) + 0.2);
    expect(g.hp).toBe(g.maxHp); // fully recharged
  });

  it('a lone pilot cannot finish the strike, however it picks its targets (it takes the team)', () => {
    // Two-pilot squad; only pilot 2 fights. It flies in close (inside the shield range) and fires at will.
    const picks = {
      nearest: (gs: ReturnType<typeof gens>, p: { x: number; y: number }) => gs.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0],
      weakest: (gs: ReturnType<typeof gens>) => gs.sort((a, b) => a.hp - b.hp)[0],
    };
    for (const [name, pick] of Object.entries(picks)) {
      const m = quiet(2);
      toPhase(m, 'strike');
      hold(m, 1);
      // The idle teammate waits mid-deck (within the leash of every generator), so the lone pilot can reach them all.
      place(m, 0, 500, 1000);
      place(m, 1, 500, 1000);
      let attempts = 0;
      for (let i = 0; i < 60 * 60 && !m.linked!.done; i++) {
        const p = m.ships[1];
        const t = pick(gens(m).filter((g) => g.spawnIn === 0), p);
        let input: MissionInput = { x: 0, y: 0 };
        if (t) {
          const dx = t.x - p.x;
          const dy = t.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = d > 150 ? 1 : 0.07;
          input = { x: (dx / d) * k, y: (dy / d) * k, fire: p.aimTarget === t.id, assist: true };
        }
        const before = m.linked!.firstAt;
        for (const q of m.ships) q.invuln = 5;
        stepMission(m, [{ x: 0, y: 0 }, input], DT);
        if (before === null && m.linked!.firstAt !== null) attempts++;
      }
      expect(m.linked!.done, name).toBe(false);
      expect(attempts, name).toBeGreaterThan(5); // it really kept trying
    }
  });

  it('bolts from outside the shield range are deflected', () => {
    const m = quiet(2);
    toPhase(m, 'strike');
    hold(m, 1);
    const g = gens(m)[1];
    place(m, 0, g.x + 100, g.y + 400); // the teammate nearby (the leash keeps the squadron together)
    place(m, 1, g.x, g.y + 320); // well outside the range, nose up at it
    m.ships[1].angle = -Math.PI / 2;
    let deflected = 0;
    for (let i = 0; i < 60; i++) {
      for (const q of m.ships) q.invuln = 5;
      stepMission(m, [{ x: 0, y: 0 }, { x: 0, y: 0, fire: true }], DT);
      deflected += m.events.filter((e) => e.type === 'deflect').length;
    }
    expect(deflected).toBeGreaterThan(3);
    expect(g.hp).toBe(g.maxHp);
    place(m, 1, g.x, g.y + 150); // inside it
    hold(m, 1, [{ x: 0, y: 0 }, { x: 0, y: 0, fire: true }]);
    expect(g.hp).toBeLessThan(g.maxHp);
  });
});

describe('extraction, failure and restarts', () => {
  it('the squadron extracts together: a downed teammate must be revived first', () => {
    const m = quiet(2);
    toPhase(m, 'strike');
    hold(m, 1);
    for (const g of m.drones.filter((d) => d.tag === 'sync')) g.hp = 0;
    hold(m, 0.1);
    expect(phaseId(m)).toBe('extract');
    const portal = m.portal!;
    place(m, 0, portal.x, portal.y);
    place(m, 1, portal.x + 62, portal.y); // just outside the portal, within revive range
    m.ships[1].invuln = 0;
    m.ships[1].hp = 1;
    m.bullets.push({ id: 960, x: m.ships[1].x, y: m.ships[1].y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    stepMission(m, idle(2), DT);
    expect(m.ships[1].downed).toBe(true);
    hold(m, 1);
    expect(m.status).toBe('playing');
    hold(m, REVIVE_TIME + 0.5);
    expect(m.ships[1].downed).toBe(false);
    place(m, 1, portal.x, portal.y);
    hold(m, 0.1);
    expect(m.status).toBe('won');
  });

  it('a team wipe fails the operation and nothing more is sent', () => {
    const m = createMission(def, 1, 2);
    hold(m, 7);
    for (const p of m.ships) {
      p.invuln = 0;
      p.hp = 1;
      m.bullets.push({ id: 970 + p.slot, x: p.x, y: p.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    }
    stepMission(m, idle(2), DT);
    expect(m.status).toBe('lost');
    expect(m.failReason).toMatch(/squadron is down/);
    const sent = m.encounters.reduce((k, e) => k + e.spawned, 0);
    for (let i = 0; i < 600; i++) stepMission(m, idle(2), DT);
    expect(m.encounters.reduce((k, e) => k + e.spawned, 0)).toBe(sent);
  });

  it('after a win nothing more spawns, and a restart is a clean start', () => {
    for (const n of [2, 4]) {
      const pristine = JSON.stringify({ ...createMission(def, 3, n), rng: undefined });
      const m = createMission(def, 3, n);
      while (m.status === 'playing' && m.realTime < 300) {
        for (const p of m.ships) p.invuln = 5;
        stepMission(m, coopSquad(m), DT);
      }
      expect(m.status).toBe('won');
      const sent = m.encounters.reduce((k, e) => k + e.spawned, 0);
      for (let i = 0; i < 600; i++) stepMission(m, idle(n), DT);
      expect(m.encounters.reduce((k, e) => k + e.spawned, 0)).toBe(sent);
      expect(JSON.stringify({ ...createMission(def, 3, n), rng: undefined })).toBe(pristine);
    }
  });
});
