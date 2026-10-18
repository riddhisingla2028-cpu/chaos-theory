import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contactView } from '../mission/encounters';
import { coopMissionById, createMission, objectiveView, stepMission, type MissionEvent, type MissionState } from '../mission/sim';
import { coopSquad } from '../mission/testkit';
import { applyCoopSnapshot, coopSnapshot, createClientMission, createCoopMatch, stepCoop, type CoopMatch, type NetInput } from './coop';
import { ClientRoom, HostRoom, OP_MAX_PLAYERS, PROTOCOL, type Conn, type RoomView } from './room';
import { flush, pipe } from './testnet';

// P2.3: co-op operations over the existing rooms. The host runs the only mission; clients send controls
// and rebuild the mission from snapshots.

const DT = 1 / 60;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `pilot-${i}-token`);
/** One squad step on the host's match, with the scripted squad's controls (invulnerable: rules, not dodging). */
function squadStep(c: CoopMatch) {
  for (const p of c.mission.ships) p.invuln = 5;
  const inputs = coopSquad(c.mission);
  stepCoop(c, Object.fromEntries(c.slots.map((id, i) => [id, inputs[i] as NetInput])), DT);
}

/** Positions travel at 0.1-unit precision; compare both sides at that precision. */
const r1 = (n: number) => Math.round(n * 10) / 10;
/** What a player sees: the HUD's objective line, the enemy contact line, and the state behind them. */
function seen(m: MissionState) {
  const v = objectiveView(m);
  const ph = m.def.phases[Math.min(m.phase, m.def.phases.length - 1)];
  return {
    phase: v.phase,
    title: v.title,
    text: v.text,
    count: v.count,
    progress: Math.round(v.progress * 100) / 100,
    contact: contactView(m, ph.clear)?.name ?? null,
    status: m.status,
    pilots: m.ships.map((p) => [r1(p.x), r1(p.y), p.hp, p.downed, p.online]),
    drones: m.drones.map((d) => [d.id, d.kind, r1(d.x), r1(d.y), Math.ceil(r1(d.hp))]),
    bullets: m.bullets.length,
    pods: m.pods.map((p) => [p.state, p.towedBy ?? null]),
    encounters: m.encounters.map((e) => `${e.id}:${e.status}:${e.spawned}`),
    phasesDone: m.phasesDone,
    uplink: m.uplink ? [Math.round(m.uplink.charge * 100) / 100, m.uplink.active] : null,
    linked: m.linked ? [m.linked.done, m.linked.firstAt === null] : null,
    portal: m.portal?.open ?? null,
    score: m.score,
    kills: m.kills,
  };
}

describe('the co-op snapshot', () => {
  it('a client that applies the snapshots sees what the host sees, all the way through an operation', () => {
    for (const n of [2, 4]) {
      const host = createCoopMatch('twin-lock', 77, ids(n));
      const client = createClientMission('twin-lock', 77, n);
      let checks = 0;
      for (let i = 0; i < 60 * 300 && host.mission.status === 'playing'; i++) {
        squadStep(host);
        if (i % 3 === 0) {
          // A snapshot goes over the wire as JSON.
          applyCoopSnapshot(client, JSON.parse(JSON.stringify(coopSnapshot(host))));
          expect(seen(client)).toEqual(seen(host.mission));
          checks++;
        }
      }
      expect(host.mission.status).toBe('won');
      applyCoopSnapshot(client, JSON.parse(JSON.stringify(coopSnapshot(host))));
      expect(seen(client)).toEqual(seen(host.mission));
      expect(checks).toBeGreaterThan(400);
    }
  });

  it('every event reaches the client exactly once, in order', () => {
    const host = createCoopMatch('twin-lock', 5, ids(3));
    const reference = createMission(coopMissionById('twin-lock'), 5, 3); // the same mission, run alongside
    const emitted: MissionEvent[] = [];
    const received: MissionEvent[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      for (const p of host.mission.ships) p.invuln = 5;
      for (const p of reference.ships) p.invuln = 5;
      const inputs = coopSquad(host.mission);
      stepCoop(host, Object.fromEntries(host.slots.map((id, k) => [id, inputs[k] as NetInput])), DT);
      stepMission(reference, inputs, DT);
      emitted.push(...reference.events);
      if (i % 3 === 0) received.push(...JSON.parse(JSON.stringify(coopSnapshot(host))).ev);
    }
    received.push(...coopSnapshot(host).ev);
    expect(emitted.length).toBeGreaterThan(100);
    expect(received).toEqual(JSON.parse(JSON.stringify(emitted)));
  });

  it('stays small: a few kilobytes at 20 snapshots a second, even with four pilots in a fight', () => {
    const host = createCoopMatch('twin-lock', 9, ids(4));
    let worst = 0;
    let total = 0;
    let count = 0;
    for (let i = 0; i < 60 * 120 && host.mission.status === 'playing'; i++) {
      squadStep(host);
      if (i % 3 === 0) {
        const bytes = JSON.stringify(coopSnapshot(host)).length;
        worst = Math.max(worst, bytes);
        total += bytes;
        count++;
      }
    }
    expect(worst).toBeLessThan(16_000);
    expect(total / count).toBeLessThan(6_000);
  });

  it('a malformed snapshot cannot break a client', () => {
    const m = createClientMission('twin-lock', 1, 2);
    const junk: unknown[] = [null, 42, 'x', {}, { t: 'osnap', s: 'no', d: [[1, 99], 'x', null], b: [[]], r: [null], a: 5, o: { c: 'x', re: [5], sw: null }, st: [1], rest: null, ev: 'x' }];
    for (const j of junk) expect(() => applyCoopSnapshot(m, j as never)).not.toThrow();
    expect(m.ships).toHaveLength(2);
  });
});

// ---------- Rooms ----------

describe('co-op operations in rooms (in-memory network)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  function setup() {
    const host = new HostRoom('OPSAB', 'coop', { id: 'host-token-1', name: 'Host', shape: 'star' }, () => 4242);
    const links: Conn[] = [];
    const join = (token: string, name: string) => {
      const client = new ClientRoom(
        async () => {
          const [c, h] = pipe();
          links.push(h);
          host.accept(h);
          return c;
        },
        'OPSAB',
        { token, name, shape: 'diamond' },
        () => 0,
      );
      let view: RoomView = client.view;
      client.subscribe((v) => (view = v));
      return { client, view: () => view, token, name };
    };
    return { host, join, links };
  }

  async function lobby(n: number) {
    const s = setup();
    const players = [];
    for (let i = 1; i < n; i++) {
      const p = s.join(`client-token-${i}`, `Wing ${i}`);
      await p.client.open();
      await flush();
      p.client.setReady(true);
      players.push(p);
    }
    await flush();
    s.host.setOperation('twin-lock');
    await flush();
    return { ...s, players };
  }

  /** Drive the room: each pilot decides on ITS OWN copy of the mission (the host on the real one) and sends controls. */
  async function play(r: Awaited<ReturnType<typeof lobby>>, seconds: number, opts: { invulnerable?: boolean } = {}) {
    for (let i = 0; i < seconds * 30 && r.host.view().phase === 'playing'; i++) {
      const hm = r.host.coop!.mission;
      if (opts.invulnerable !== false) for (const p of hm.ships) p.invuln = 5;
      r.host.setHostInput(coopSquad(hm)[0]);
      for (const p of r.players) {
        const c = p.client.coop;
        if (!c) continue;
        const slot = c.slots.indexOf(p.token);
        p.client.input(coopSquad(c.mission)[slot] as NetInput, 1 / 30);
      }
      await flush();
      r.host.tick(1 / 30);
      await flush();
    }
  }

  it('lobby → operation → start → everyone flies their own pilot → team results → rematch', async () => {
    for (const n of [2, 3, 4]) {
      const r = await lobby(n);
      expect(r.players.every((p) => p.view().op === 'twin-lock')).toBe(true);
      expect(r.host.canStart()).toBe(true);
      expect(r.host.start()).toBe(true);
      await flush();
      // Every client built its copy of the mission with one pilot per player, in seat order.
      for (const p of r.players) {
        expect(p.view().phase).toBe('playing');
        expect(p.client.coop!.mission.ships).toHaveLength(n);
        expect(p.client.coop!.slots).toEqual(r.host.coop!.slots);
        expect(p.client.coop!.slots[0]).toBe('host-token-1');
      }
      await play(r, 240);
      expect(r.host.view().phase, `${n} players`).toBe('results');
      for (const p of [r.host.view(), ...r.players.map((x) => x.view())]) {
        expect(p.phase).toBe('results');
        expect(p.results!.team).toBe(true);
        expect(p.results!.won).toBe(true);
        expect(p.results!.op!.phases).toEqual(['Lock both uplinks', 'Escort the data core', 'Synchronised strike', 'Extract together']);
        expect(p.results!.op!.rows).toHaveLength(n);
        expect(p.results!.rows.map((x) => x.name)).toEqual(['Host', ...r.players.map((x) => x.name)]);
      }
      const op = r.host.view().results!.op!;
      expect(op.rows.reduce((k, x) => k + x.kills, 0)).toBe(op.kills);
      // Every client's own copy reached the same end.
      for (const p of r.players) expect(p.client.coop!.mission.status).toBe('won');
      r.host.rematch();
      await flush();
      expect(r.players[0].view().phase).toBe('lobby');
      expect(r.players[0].view().op).toBe('twin-lock');
      expect(r.host.coop).toBeNull();
    }
  });

  it('pulling the trigger travels over the network; only a real `true` fires', async () => {
    const r = await lobby(2);
    r.host.start();
    await flush();
    const me = r.players[0];
    const pilot = () => r.host.coop!.mission.ships[1];
    for (let i = 0; i < 30; i++) {
      me.client.input({ x: 0, y: 0, fire: true }, 1 / 30);
      await flush();
      r.host.tick(1 / 30);
    }
    expect(pilot().stats.shots).toBeGreaterThan(3);
    const shots = pilot().stats.shots;
    // A hand-made message with a truthy-but-not-true trigger does not fire.
    const raw = r.links[0];
    void raw; // the host side of the link; the client side sends below
    for (let i = 0; i < 30; i++) {
      (me.client as unknown as { conn: Conn }).conn.send({ t: 'input', x: 0, y: 0, fire: 'yes' });
      await flush();
      r.host.tick(1 / 30);
    }
    expect(pilot().stats.shots).toBe(shots);
  });

  it('a client controls only its own pilot, and junk input is ignored', async () => {
    const r = await lobby(3);
    r.host.start();
    await flush();
    const ships = r.host.coop!.mission.ships;
    const start = ships.map((p) => ({ x: p.x, y: p.y }));
    const conn = (r.players[0].client as unknown as { conn: Conn }).conn;
    for (const junk of [{ t: 'input', x: 'left', y: 0 }, { t: 'input', x: NaN, y: 1 }, { t: 'input', x: Infinity, y: 0 }, { t: 'input' }, { t: 'move', slot: 2, x: 999 }, 'garbage', null, [1, 2]]) conn.send(junk);
    for (let i = 0; i < 20; i++) {
      conn.send({ t: 'input', x: 50, y: 0 }); // oversized: clamped to full stick
      await flush();
      r.host.tick(1 / 30);
    }
    expect(ships[1].x).toBeGreaterThan(start[1].x + 100); // pilot 1 is the sender
    expect(ships[1].x - start[1].x).toBeLessThan(400 * (20 / 30) + 5); // no faster than full stick
    expect(Math.hypot(ships[2].x - start[2].x, ships[2].y - start[2].y)).toBeLessThan(1); // nobody else moved
    expect(Math.hypot(ships[0].x - start[0].x, ships[0].y - start[0].y)).toBeLessThan(1);
  });

  it('start rules: 2 to 4 ready players for an operation; Arcade modes still start with 2 or more', async () => {
    const r = await lobby(5);
    expect(r.host.view().players).toHaveLength(5);
    expect(r.host.canStart()).toBe(false); // five is too many for a co-op operation
    expect(r.host.start()).toBe(false);
    r.host.setMode('lps'); // back to Arcade: the op is cleared
    await flush();
    expect(r.players[0].view().op).toBeNull();
    expect(r.host.canStart()).toBe(true);
    expect(r.host.start()).toBe(true);
    expect(r.host.match).not.toBeNull();
    expect(r.host.coop).toBeNull();
    const solo = setup();
    solo.host.setOperation('twin-lock');
    expect(solo.host.canStart()).toBe(false); // the host alone
    expect(OP_MAX_PLAYERS).toBe(4);
  });

  it('a dropped player’s pilot goes offline and comes back on reconnect, with the mission brought up to date at once', async () => {
    const r = await lobby(3);
    r.host.start();
    await flush();
    await play(r, 3);
    const leaver = r.players[0];
    const slot = r.host.coop!.slots.indexOf(leaver.token);
    r.links[0].close(); // the network drops
    await flush();
    expect(r.host.coop!.mission.ships[slot].online).toBe(false);
    expect(leaver.view().status).toBe('reconnecting');
    const otherBefore = r.players[1].client.coop!.snapshots;
    await play(r, 2);
    expect(r.players[1].client.coop!.snapshots).toBeGreaterThan(otherBefore); // the others carry on
    vi.advanceTimersByTime(2000);
    await flush();
    await flush();
    expect(leaver.view().status).toBe('open');
    expect(r.host.coop!.mission.ships[slot].online).toBe(true);
    // Rebuilt and caught up immediately: the rejoined client already shows the host's positions.
    const mine = leaver.client.coop!.mission;
    const host = r.host.coop!.mission;
    expect(mine.ships.map((p) => [r1(p.x), r1(p.y)])).toEqual(host.ships.map((p) => [r1(p.x), r1(p.y)]));
    expect(mine.phase).toBe(host.phase);
  });

  it('a catch-up snapshot for a rejoining player does not take anyone else’s events', () => {
    const c = createCoopMatch('twin-lock', 3, ids(2));
    for (let i = 0; i < 300; i++) squadStep(c);
    const pending = c.pending.length;
    expect(pending).toBeGreaterThan(0);
    expect(coopSnapshot(c, false).ev).toEqual([]);
    expect(c.pending).toHaveLength(pending);
    expect(coopSnapshot(c).ev).toHaveLength(pending);
  });

  it('a team wipe ends the operation for everyone as a team loss', async () => {
    const r = await lobby(2);
    r.host.start();
    await flush();
    await play(r, 2);
    for (const p of r.host.coop!.mission.ships) {
      p.invuln = 0;
      p.hp = 1;
      r.host.coop!.mission.bullets.push({ id: 9000 + p.slot, x: p.x, y: p.y, vx: 0, vy: 0, r: 9, from: 'enemy', life: 1 });
    }
    await play(r, 3, { invulnerable: false });
    for (const v of [r.host.view(), r.players[0].view()]) {
      expect(v.phase).toBe('results');
      expect(v.results!.won).toBe(false);
      expect(v.results!.text).toMatch(/squadron is down/);
    }
  });

  it('the host leaving mid-operation closes the room for everyone with a clear message', async () => {
    const r = await lobby(3);
    r.host.start();
    await flush();
    await play(r, 2);
    r.host.close();
    await flush();
    vi.advanceTimersByTime(300);
    await flush();
    for (const p of r.players) {
      expect(p.view().status).toBe('closed');
      expect(p.view().notice).toMatch(/host left/i);
    }
  });

  it('late joiners cannot enter a running operation, and an old client is refused by version', async () => {
    const r = await lobby(2);
    r.host.start();
    await flush();
    const late = r.join('late-token-9', 'Late');
    await late.client.open();
    await flush();
    expect(late.view().status).toBe('closed');
    expect(late.view().notice).toMatch(/already started/);
    const [c, h] = pipe();
    r.host.accept(h);
    const replies: unknown[] = [];
    c.onData((m) => replies.push(m));
    c.send({ t: 'hello', v: PROTOCOL - 1, name: 'Old', shape: 'square', token: 'old-client-token' });
    await flush();
    expect(replies).toEqual([{ t: 'reject', reason: 'version' }]);
  });
});

describe('snapshot precision', () => {
  it('clocks, timers and flags travel exactly; positions to a tenth', () => {
    const host = createCoopMatch('twin-lock', 2, ids(2));
    for (let i = 0; i < 60 * 8; i++) squadStep(host);
    host.mission.flags.testClock = 12.3456789;
    const snap = JSON.parse(JSON.stringify(coopSnapshot(host)));
    expect(snap.rest.time).toBe(host.mission.time);
    expect(snap.rest.realTime).toBe(host.mission.realTime);
    expect(snap.rest.flags.testClock).toBe(12.3456789);
    const p = host.mission.ships[0];
    expect(Math.abs(snap.s[0][1] - p.x)).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});
